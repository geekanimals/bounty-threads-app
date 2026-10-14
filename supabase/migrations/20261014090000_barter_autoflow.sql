-- Barter process on autopilot — one creator, start to finish, without anyone pushing buttons in between.
--
--   approve the creator (brand confirmed / invite accepted)
--     → the contract goes out AUTOMATICALLY, built from the terms saved on the campaign
--       (ASCI, ad rights, collab rights, product, deliverables, content deadline,
--        the non-delivery → blacklist clause and the "re-ship the product at your own cost" clause)
--     → creator signs in the app            → the board updates, creator is asked for the address
--     → creator confirms the address         → a "waiting for courier" shipment appears for the brand/agency
--     → brand / agency / Super Admin types the courier + tracking (manual until a courier API is plugged in)
--     → creator sees the courier + tracking link live
--     → delivered (marked by the team, by the courier worker, or by the creator "I got it")
--     → the VIDEO BRIEF saved on the campaign goes to the creator AUTOMATICALLY, with a due date
--     → creator submits the video          → the brand/agency approves or asks for changes (with a reason)
--     → creator posts and records the link → post metrics are collected → DONE automatically
--     → per-creator and whole-campaign analytics for the brand/agency; the creator sees their own.
--
-- The campaign's own workspace (owner / brand / manager) and the Super Admin can do every step.
-- ADDITIVE: nothing is dropped; existing RPCs keep their signatures. Same operational_pilot gate as before.

-- ===================================================================================================
-- 0) Where the contract terms + video brief live
-- ===================================================================================================
alter table public.campaigns add column if not exists contract_terms jsonb not null default '{}'::jsonb;
alter table public.campaigns add column if not exists video_brief    jsonb not null default '{}'::jsonb;

create table if not exists intel.ci_campaign_playbook (
  campaign_id    uuid primary key references intel.ci_campaign(campaign_id) on delete cascade,
  contract_terms jsonb not null default '{}'::jsonb,   -- {product, product_value, ad_rights_months, collab_rights, deliverables, content_days, blacklist_clause, reship_clause, extra_terms}
  video_brief    jsonb not null default '{}'::jsonb,   -- {what_to_shoot, key_messages, dos, donts, reference_links, caption, hashtags, mentions, posting_note}
  updated_by     uuid references auth.users(id) on delete set null,
  updated_at     timestamptz not null default now()
);
alter table intel.ci_campaign_playbook enable row level security;
revoke all on intel.ci_campaign_playbook from anon, authenticated;
grant select, insert, update, delete on intel.ci_campaign_playbook to service_role;

alter table intel.ci_campaign_contract
  add column if not exists clauses       jsonb not null default '[]'::jsonb,  -- [{key,title,text}] frozen at issue time
  add column if not exists content_days  int,
  add column if not exists product_value numeric,
  add column if not exists terms_ack     boolean not null default false;

alter table intel.ci_campaign_shipment add column if not exists tracking_url text;

-- ===================================================================================================
-- 1) Legal moves: an accepted invite also goes to the contract; any live creator can be dropped
--    (blacklist / product reassigned) up to the point they post.
-- ===================================================================================================
create or replace function intel.ci_participation_advance(p_participation uuid, p_to text, p_actor uuid, p_reason text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare v_from text; v_camp uuid; v_ok boolean; v_needs_reason boolean;
        v_legal jsonb := jsonb_build_object(
          'applied',        jsonb_build_array('eligible','ineligible','dropped'),
          'eligible',       jsonb_build_array('sent_to_brand','dropped'),
          'sent_to_brand',  jsonb_build_array('brand_confirmed','brand_declined','dropped'),
          'brand_confirmed',jsonb_build_array('contract_sent','dropped'),
          'contract_sent',  jsonb_build_array('contract_signed','dropped'),
          'contract_signed',jsonb_build_array('address_confirmed','dropped'),
          'address_confirmed', jsonb_build_array('product_sent','dropped'),
          'shortlisted', jsonb_build_array('invited','dropped'),
          'invited',     jsonb_build_array('accepted','rejected','dropped'),
          'accepted',    jsonb_build_array('contract_sent','product_sent','dropped'),
          'product_sent',jsonb_build_array('content_created','dropped'),
          'content_created', jsonb_build_array('content_submitted','dropped'),
          'content_submitted', jsonb_build_array('content_approved','changes_requested','rejected','dropped'),
          'changes_requested', jsonb_build_array('content_submitted','dropped'),
          'content_approved', jsonb_build_array('published','dropped'),
          'published',   jsonb_build_array('completed'));
begin
  select stage, campaign_id into v_from, v_camp from intel.ci_campaign_participation where participation_id=p_participation;
  if v_from is null then raise exception 'participation not found' using errcode='42501'; end if;
  v_ok := (v_legal ? v_from) and (v_legal->v_from) ? p_to;
  if not v_ok then raise exception 'illegal transition % -> %', v_from, p_to using errcode='22023'; end if;
  v_needs_reason := p_to in ('rejected','dropped','changes_requested','ineligible','brand_declined');
  if v_needs_reason and coalesce(btrim(p_reason),'')='' then
    raise exception 'a reason is required to % a participation', p_to using errcode='22023'; end if;

  update intel.ci_campaign_participation
    set stage=p_to, reason=case when v_needs_reason then p_reason else reason end,
        invited_at  = case when p_to='invited'  then now() else invited_at  end,
        accepted_at = case when p_to='accepted' then now() else accepted_at end,
        rejected_at = case when p_to in ('rejected','ineligible','brand_declined','dropped') then now() else rejected_at end,
        address_confirmed_at = case when p_to='address_confirmed' then now() else address_confirmed_at end
    where participation_id=p_participation;

  insert into intel.ci_campaign_event(campaign_id, participation_id, entity, from_status, to_status, actor_member_id, reason)
    values (v_camp, p_participation, 'participation', v_from, p_to, p_actor, p_reason);
  return p_to;
end $$;
revoke all on function intel.ci_participation_advance(uuid,text,uuid,text) from public, anon, authenticated;
grant execute on function intel.ci_participation_advance(uuid,text,uuid,text) to service_role;

-- ===================================================================================================
-- 2) Helpers
-- ===================================================================================================
-- can the caller run this creator's process? (campaign owner/brand/manager of the org, Geek operator, Super Admin)
create or replace function intel.ci_can_manage_participation(p_participation uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(intel.ci_can_manage_campaign(intel.ci_campaign_of_participation(p_participation)), false) $$;
revoke all on function intel.ci_can_manage_participation(uuid) from public, anon, authenticated;
grant execute on function intel.ci_can_manage_participation(uuid) to service_role;

-- "1 Reel + 2 Stories" → [{format:"Reel", format_key:"reel", quantity:1}, {format:"Stories", format_key:"story", quantity:2}]
create or replace function intel.ci_parse_deliverables(p_text text)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare part text; m text[]; v_label text; v_qty int; v_key text; out jsonb := '[]'::jsonb;
begin
  for part in select btrim(x) from regexp_split_to_table(coalesce(p_text,''), '\s*(\+|,|&|;|\n|\mand\M)\s*') x loop
    continue when part = '';
    m := regexp_match(part, '^(\d+)\s*[xX×]?\s*(.*)$');
    if m is not null then v_qty := greatest(least(m[1]::int, 50), 1); v_label := nullif(btrim(m[2]),''); else v_qty := 1; v_label := part; end if;
    v_label := coalesce(v_label, part);
    v_key := case when v_label ~* 'reel' then 'reel' when v_label ~* 'stor' then 'story' when v_label ~* 'carousel' then 'carousel'
                  when v_label ~* 'live' then 'live' when v_label ~* 'ugc' then 'ugc_no_post'
                  when v_label ~* '(post|static|feed)' then 'static_post' else null end;
    out := out || jsonb_build_array(jsonb_build_object('format', left(v_label, 80), 'format_key', v_key, 'quantity', v_qty));
  end loop;
  return out;
end $$;

-- the playbook for a campaign, with sensible defaults filled from the campaign itself
create or replace function intel.ci_playbook(p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare k jsonb; b jsonb; req jsonb; c record; v_tags text; v_ment text;
begin
  select * into c from intel.ci_campaign where campaign_id = p_campaign;
  if c.campaign_id is null then return null; end if;
  select coalesce(contract_terms,'{}'::jsonb), coalesce(video_brief,'{}'::jsonb) into k, b
    from intel.ci_campaign_playbook where campaign_id = p_campaign;
  k := coalesce(k, '{}'::jsonb); b := coalesce(b, '{}'::jsonb);
  select requirements into req from intel.ci_campaign_brief where campaign_id = p_campaign order by created_at desc limit 1;
  req := coalesce(req, '{}'::jsonb);
  select string_agg(x, ' ') into v_tags from jsonb_array_elements_text(coalesce(req->'hashtags','[]'::jsonb)) x;
  select string_agg('@'||ltrim(x,'@'), ' ') into v_ment from jsonb_array_elements_text(coalesce(req->'mentions','[]'::jsonb)) x;
  return jsonb_build_object(
    'contract', jsonb_build_object(
      'product',          coalesce(nullif(btrim(k->>'product'),''), c.product, coalesce(c.submitted_brand_name,'Brand')||' product'),
      'product_value',    coalesce(nullif(k->>'product_value','')::numeric, nullif(req->>'product_value','')::numeric),
      'ad_rights_months', coalesce(nullif(k->>'ad_rights_months','')::int, 1),
      'collab_rights',    coalesce((k->>'collab_rights')::boolean, true),
      'deliverables',     coalesce(nullif(btrim(k->>'deliverables'),''), nullif(btrim(req->>'deliverables_text'),''), '1 Reel'),
      'content_days',     greatest(coalesce(nullif(k->>'content_days','')::int, 7), 1),
      'blacklist_clause', coalesce((k->>'blacklist_clause')::boolean, true),
      'reship_clause',    coalesce((k->>'reship_clause')::boolean, true),
      'extra_terms',      nullif(btrim(k->>'extra_terms'),'')),
    'brief', jsonb_build_object(
      'what_to_shoot',   coalesce(nullif(btrim(b->>'what_to_shoot'),''), nullif(btrim(req->>'brief'),'')),
      'key_messages',    nullif(btrim(b->>'key_messages'),''),
      'dos',             nullif(btrim(b->>'dos'),''),
      'donts',           nullif(btrim(b->>'donts'),''),
      'reference_links', nullif(btrim(b->>'reference_links'),''),
      'caption',         nullif(btrim(b->>'caption'),''),
      'hashtags',        coalesce(nullif(btrim(b->>'hashtags'),''), v_tags),
      'mentions',        coalesce(nullif(btrim(b->>'mentions'),''), v_ment),
      'posting_note',    nullif(btrim(b->>'posting_note'),''),
      'deliverables_text', coalesce(nullif(btrim(k->>'deliverables'),''), nullif(btrim(req->>'deliverables_text'),''), '1 Reel'),
      'attachments',     coalesce(req->'attachments','[]'::jsonb)),
    'saved', exists (select 1 from intel.ci_campaign_playbook p where p.campaign_id = p_campaign));
end $$;
revoke all on function intel.ci_playbook(uuid) from public, anon, authenticated;
grant execute on function intel.ci_playbook(uuid) to service_role;

-- the written contract, clause by clause (what the creator reads and signs)
create or replace function intel.ci_contract_clauses(p_terms jsonb, p_brand text)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare v jsonb := '[]'::jsonb; n int := coalesce(nullif(p_terms->>'ad_rights_months','')::int,1);
        d int := coalesce(nullif(p_terms->>'content_days','')::int,7); val text;
begin
  val := case when nullif(p_terms->>'product_value','') is not null then ' (worth ₹'||(p_terms->>'product_value')||')' else '' end;
  v := v || jsonb_build_array(jsonb_build_object('key','product','title','Product',
        'text', 'You will receive '||coalesce(p_terms->>'product','the product')||val||' from '||coalesce(p_brand,'the brand')
                ||' free of cost, in exchange for the content below. Once your content is posted, the product is yours to keep.'));
  v := v || jsonb_build_array(jsonb_build_object('key','deliverables','title','What you will make',
        'text', 'You will create and post: '||coalesce(p_terms->>'deliverables','1 Reel')
                ||', within '||d||' day'||case when d>1 then 's' else '' end||' of receiving the product, following the video brief shared in the app.'));
  v := v || jsonb_build_array(jsonb_build_object('key','asci','title','ASCI disclosure',
        'text', 'Every post must clearly disclose the collaboration as per the ASCI Guidelines for Influencer Advertising in Digital Media — '
                ||'use the "Paid partnership" label and/or #ad / #collab at the start of the caption. Do not make claims the brand has not approved.'));
  v := v || jsonb_build_array(jsonb_build_object('key','ad_rights','title','Ad rights',
        'text', coalesce(p_brand,'The brand')||' may use your content (organic and as paid ads, including whitelisting) for '||n||' month'
                ||case when n>1 then 's' else '' end||' from the date you post.'));
  if coalesce((p_terms->>'collab_rights')::boolean, true) then
    v := v || jsonb_build_array(jsonb_build_object('key','collab','title','Collab rights',
          'text', 'You will add '||coalesce(p_brand,'the brand')||' as an Instagram collaborator on the post so it also appears on their profile.'));
  end if;
  if coalesce((p_terms->>'blacklist_clause')::boolean, true) then
    v := v || jsonb_build_array(jsonb_build_object('key','non_delivery','title','If you don''t deliver — blacklist',
          'text', 'If you receive the product and do not create and post the agreed content within '||d||' day'||case when d>1 then 's' else '' end
                  ||' of delivery (and do not respond to our reminders), you will be blacklisted from the Geek platform and will not be offered any further campaigns.'));
  end if;
  if coalesce((p_terms->>'reship_clause')::boolean, true) then
    v := v || jsonb_build_array(jsonb_build_object('key','reship','title','Return / re-ship at your own cost',
          'text', 'In that case you must also send the product, at your own cost, to another creator nominated by Geek or '
                  ||coalesce(p_brand,'the brand')||', within 7 days of being asked, in the condition you received it.'));
  end if;
  if nullif(btrim(p_terms->>'extra_terms'),'') is not null then
    v := v || jsonb_build_array(jsonb_build_object('key','extra','title','Other terms','text', btrim(p_terms->>'extra_terms')));
  end if;
  return v;
end $$;

-- ===================================================================================================
-- 3) Keep the playbook in step with the campaign form (public.campaigns.contract_terms / video_brief)
--    Trigger name sorts after campaign_to_pipeline, so the pipeline twin already exists.
-- ===================================================================================================
create or replace function public.tg_campaign_to_playbook()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  begin
    if tg_op = 'UPDATE' and new.contract_terms is not distinct from old.contract_terms
       and new.video_brief is not distinct from old.video_brief then return new; end if;
    if coalesce(new.contract_terms,'{}'::jsonb) = '{}'::jsonb and coalesce(new.video_brief,'{}'::jsonb) = '{}'::jsonb then return new; end if;
    select campaign_id into v_id from intel.ci_campaign where legacy_campaign_id = new.id order by created_at desc limit 1;
    if v_id is null then return new; end if;
    insert into intel.ci_campaign_playbook(campaign_id, contract_terms, video_brief, updated_by)
    values (v_id, coalesce(new.contract_terms,'{}'::jsonb), coalesce(new.video_brief,'{}'::jsonb), auth.uid())
    on conflict (campaign_id) do update set contract_terms = excluded.contract_terms, video_brief = excluded.video_brief,
      updated_by = excluded.updated_by, updated_at = now();
  exception when others then
    raise warning 'playbook sync skipped for %: %', new.id, sqlerrm;
  end;
  return new;
end $$;
revoke all on function public.tg_campaign_to_playbook() from public, anon, authenticated;
drop trigger if exists campaign_to_playbook on public.campaigns;
create trigger campaign_to_playbook after insert or update on public.campaigns
  for each row execute function public.tg_campaign_to_playbook();

create or replace function api.get_playbook(p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid := intel.ci_resolve_campaign(p_campaign);
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  if v_id is null or not intel.ci_can_manage_campaign(v_id) then raise exception 'not your campaign' using errcode = '42501'; end if;
  return intel.ci_playbook(v_id);
end $$;

create or replace function api.save_playbook(p_campaign uuid, p_contract jsonb, p_brief jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid := intel.ci_resolve_campaign(p_campaign); v_legacy uuid;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  if v_id is null or not intel.ci_can_manage_campaign(v_id) then raise exception 'not your campaign' using errcode = '42501'; end if;
  if jsonb_array_length(intel.ci_parse_deliverables(coalesce(p_contract->>'deliverables',''))) = 0 then
    raise exception 'add at least one deliverable (e.g. 1 Reel + 1 Story)' using errcode = '22023'; end if;
  insert into intel.ci_campaign_playbook(campaign_id, contract_terms, video_brief, updated_by)
  values (v_id, coalesce(p_contract,'{}'::jsonb), coalesce(p_brief,'{}'::jsonb), auth.uid())
  on conflict (campaign_id) do update set contract_terms = excluded.contract_terms, video_brief = excluded.video_brief,
    updated_by = excluded.updated_by, updated_at = now();
  select legacy_campaign_id into v_legacy from intel.ci_campaign where campaign_id = v_id;
  if v_legacy is not null then
    update public.campaigns set contract_terms = coalesce(p_contract,'{}'::jsonb), video_brief = coalesce(p_brief,'{}'::jsonb) where id = v_legacy;
  end if;
  return intel.ci_playbook(v_id);
end $$;

-- ===================================================================================================
-- 4) Contract: issued automatically from the playbook
-- ===================================================================================================
create or replace function intel.ci_issue_contract(p_participation uuid, p_actor uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_camp uuid; v_stage text; v_pb jsonb; v_k jsonb; v_brand text; v_cid uuid; v_months int; v_signed timestamptz;
begin
  select p.campaign_id, p.stage into v_camp, v_stage from intel.ci_campaign_participation p where p.participation_id = p_participation;
  if v_camp is null then return null; end if;
  if v_stage not in ('brand_confirmed','accepted','contract_sent') then return null; end if;
  select signed_at into v_signed from intel.ci_campaign_contract where participation_id = p_participation;
  if v_signed is not null then return null; end if;

  v_pb := intel.ci_playbook(v_camp); v_k := v_pb->'contract';
  select coalesce(b.name, c.submitted_brand_name) into v_brand
    from intel.ci_campaign c left join intel.ci_brand b on b.brand_id = c.brand_id where c.campaign_id = v_camp;
  v_months := coalesce((v_k->>'ad_rights_months')::int, 1);

  insert into intel.ci_campaign_contract(participation_id, campaign_id, terms_version, ad_rights_months, ad_rights_until,
      collab_rights, product, product_value, deliverables, content_days, clauses, issued_by)
  values (p_participation, v_camp, 'geek-barter-v2', v_months, (current_date + make_interval(months => v_months))::date,
      coalesce((v_k->>'collab_rights')::boolean, true), v_k->>'product', nullif(v_k->>'product_value','')::numeric,
      intel.ci_parse_deliverables(v_k->>'deliverables'), (v_k->>'content_days')::int,
      intel.ci_contract_clauses(v_k, v_brand), p_actor)
  on conflict (participation_id) do update set
      terms_version = excluded.terms_version, ad_rights_months = excluded.ad_rights_months, ad_rights_until = excluded.ad_rights_until,
      collab_rights = excluded.collab_rights, product = excluded.product, product_value = excluded.product_value,
      deliverables = excluded.deliverables, content_days = excluded.content_days, clauses = excluded.clauses,
      issued_by = excluded.issued_by, issued_at = now(), updated_at = now()
  returning contract_id into v_cid;

  insert into intel.ci_campaign_event(campaign_id, participation_id, entity, from_status, to_status, actor_member_id, reason)
    values (v_camp, p_participation, 'contract', null, 'issued', p_actor, 'issued automatically from the campaign terms');
  if v_stage in ('brand_confirmed','accepted') then
    perform intel.ci_participation_advance(p_participation, 'contract_sent', p_actor, 'contract sent automatically');
  end if;
  return v_cid;
end $$;
revoke all on function intel.ci_issue_contract(uuid, uuid) from public, anon, authenticated;
grant execute on function intel.ci_issue_contract(uuid, uuid) to service_role;

-- brand / agency / Super Admin: (re)send now — also used to refresh the terms before the creator signs
create or replace function api.bp_send_contract(p_participation uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_stage text; v_camp uuid; v_name text;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  if not intel.ci_can_manage_participation(p_participation) then raise exception 'not your campaign' using errcode = '42501'; end if;
  select stage, campaign_id into v_stage, v_camp from intel.ci_campaign_participation where participation_id = p_participation;
  if v_stage not in ('brand_confirmed','accepted','contract_sent') then
    raise exception 'the contract can be sent once the creator is approved (now: %)', replace(v_stage,'_',' ') using errcode = '22023'; end if;
  v_id := intel.ci_issue_contract(p_participation, auth.uid());
  if v_stage = 'contract_sent' then   -- a resend: nudge the creator again
    select name into v_name from intel.ci_campaign where campaign_id = v_camp;
    perform intel.ci_notify(intel.ci_member_of_identity((select identity_id from intel.ci_campaign_participation where participation_id = p_participation)),
      v_camp, p_participation, 'contract_sent', jsonb_build_object('campaign', coalesce(v_name,'your campaign')));
  end if;
  return jsonb_build_object('contract_id', v_id, 'stage', (select stage from intel.ci_campaign_participation where participation_id = p_participation));
end $$;

-- creator reads the full contract
create or replace function api.get_my_contract(p_participation uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid; v_owner uuid;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  v_id := intel.ci_caller_identity();
  select identity_id into v_owner from intel.ci_campaign_participation where participation_id=p_participation;
  if v_owner is null or v_owner <> v_id then raise exception 'not your participation' using errcode='42501'; end if;
  return (select jsonb_build_object(
      'contract_id', k.contract_id, 'terms_version', k.terms_version, 'ad_rights_months', k.ad_rights_months,
      'ad_rights_until', k.ad_rights_until, 'collab_rights', k.collab_rights, 'product', k.product, 'product_value', k.product_value,
      'deliverables', k.deliverables, 'content_days', k.content_days, 'clauses', k.clauses,
      'asci_ack', k.asci_ack, 'terms_ack', k.terms_ack, 'issued_at', k.issued_at, 'signed_at', k.signed_at, 'signature_name', k.signature_name,
      'campaign', c.name, 'brand', coalesce(b.name, c.submitted_brand_name))
    from intel.ci_campaign_contract k
    join intel.ci_campaign c on c.campaign_id = k.campaign_id
    left join intel.ci_brand b on b.brand_id = c.brand_id
   where k.participation_id=p_participation);
end $$;

-- creator signs: ASCI + (when present) the non-delivery / re-ship clauses must be accepted explicitly
create or replace function api.sign_contract_v2(p_participation uuid, p_signature_name text, p_asci_ack boolean, p_terms_ack boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_owner uuid; v_clauses jsonb;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  v_id := intel.ci_caller_identity();
  select identity_id into v_owner from intel.ci_campaign_participation where participation_id=p_participation;
  if v_owner is null or v_owner <> v_id then raise exception 'not your contract' using errcode='42501'; end if;
  select clauses into v_clauses from intel.ci_campaign_contract where participation_id = p_participation;
  if exists (select 1 from jsonb_array_elements(coalesce(v_clauses,'[]'::jsonb)) x where x->>'key' in ('non_delivery','reship'))
     and not coalesce(p_terms_ack,false) then
    raise exception 'please accept the non-delivery terms (blacklist + re-ship at your cost) to sign' using errcode='22023'; end if;
  update intel.ci_campaign_contract set terms_ack = coalesce(p_terms_ack,false) where participation_id = p_participation;
  return api.sign_contract(p_participation, p_signature_name, p_asci_ack);
end $$;

-- ===================================================================================================
-- 5) Courier (manual until a courier API is plugged in) — brand, agency and Super Admin
-- ===================================================================================================
create or replace function api.bp_record_courier(p_participation uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_stage text; v_camp uuid; s record; v_sid uuid; v_product text;
        v_courier text := nullif(btrim(p_payload->>'courier'),''); v_ref text := nullif(btrim(p_payload->>'tracking_ref'),'');
        v_url text := nullif(btrim(p_payload->>'tracking_url'),'');
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  if not intel.ci_can_manage_participation(p_participation) then raise exception 'not your campaign' using errcode = '42501'; end if;
  if v_courier is null then raise exception 'add the courier name' using errcode = '22023'; end if;
  if v_url is not null and v_url !~* '^https?://' then raise exception 'the tracking link must start with https://' using errcode = '22023'; end if;
  select stage, campaign_id into v_stage, v_camp from intel.ci_campaign_participation where participation_id = p_participation;
  if v_stage not in ('accepted','address_confirmed','product_sent','content_created') then
    raise exception 'the courier can be added once the creator has confirmed their address (now: %)', replace(v_stage,'_',' ') using errcode = '22023'; end if;
  v_product := coalesce(nullif(btrim(p_payload->>'product'),''),
                        (select product from intel.ci_campaign_contract where participation_id = p_participation),
                        (select product from intel.ci_campaign where campaign_id = v_camp));

  select * into s from intel.ci_campaign_shipment where participation_id = p_participation order by created_at desc limit 1;
  if s.shipment_id is not null and s.status in ('pending','shipped') then
    update intel.ci_campaign_shipment set courier = v_courier, tracking_ref = v_ref, tracking_url = v_url,
           product = coalesce(v_product, product), status = 'shipped', shipped_at = coalesce(shipped_at, now())
     where shipment_id = s.shipment_id returning shipment_id into v_sid;
  else
    insert into intel.ci_campaign_shipment(participation_id, product, courier, tracking_ref, tracking_url, shipped_at, status)
    values (p_participation, v_product, v_courier, v_ref, v_url, now(), 'shipped') returning shipment_id into v_sid;
  end if;
  if s.shipment_id is null or s.status is distinct from 'shipped' then
    insert into intel.ci_campaign_event(campaign_id, participation_id, entity, from_status, to_status, actor_member_id, reason)
      values (v_camp, p_participation, 'shipment', s.status, 'shipped', v_uid, coalesce(v_courier,'')||coalesce(' '||v_ref,''));
  end if;
  if v_stage in ('accepted','address_confirmed') then
    perform intel.ci_participation_advance(p_participation, 'product_sent', v_uid, 'courier sent — '||v_courier||coalesce(' '||v_ref,''));
  end if;
  return jsonb_build_object('shipment_id', v_sid, 'stage', (select stage from intel.ci_campaign_participation where participation_id = p_participation));
end $$;

create or replace function api.bp_mark_delivered(p_participation uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ship uuid;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  if not intel.ci_can_manage_participation(p_participation) then raise exception 'not your campaign' using errcode = '42501'; end if;
  select shipment_id into v_ship from intel.ci_campaign_shipment where participation_id = p_participation and status in ('shipped','pending')
   order by created_at desc limit 1;
  if v_ship is null then raise exception 'add the courier details first' using errcode = '22023'; end if;
  perform intel.ci_shipment_set_status(v_ship, 'delivered', auth.uid(), jsonb_build_object('note','marked delivered'));
  return jsonb_build_object('stage', (select stage from intel.ci_campaign_participation where participation_id = p_participation));
end $$;

-- the creator taps "I received it"
create or replace function api.creator_mark_received(p_participation uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_owner uuid; v_ship uuid;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  v_id := intel.ci_caller_identity();
  select identity_id into v_owner from intel.ci_campaign_participation where participation_id = p_participation;
  if v_owner is null or v_owner <> v_id then raise exception 'not your campaign' using errcode = '42501'; end if;
  select shipment_id into v_ship from intel.ci_campaign_shipment where participation_id = p_participation and status = 'shipped'
   order by created_at desc limit 1;
  if v_ship is null then raise exception 'your parcel has not been sent yet' using errcode = '22023'; end if;
  perform intel.ci_shipment_set_status(v_ship, 'delivered', auth.uid(), jsonb_build_object('note','creator confirmed delivery'));
  return jsonb_build_object('stage', (select stage from intel.ci_campaign_participation where participation_id = p_participation));
end $$;

-- ===================================================================================================
-- 6) Video: creator submits → brand/agency approves or asks for changes → creator posts
-- ===================================================================================================
create or replace function intel.ci_ensure_deliverables(p_participation uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare v_deliv jsonb; x jsonb; v_n int := 0; v_days int; v_key text;
begin
  if exists (select 1 from intel.ci_campaign_deliverable where participation_id = p_participation) then return 0; end if;
  select deliverables, content_days into v_deliv, v_days from intel.ci_campaign_contract where participation_id = p_participation;
  if v_deliv is null or jsonb_array_length(v_deliv) = 0 then
    v_deliv := intel.ci_parse_deliverables((intel.ci_playbook(intel.ci_campaign_of_participation(p_participation))->'contract')->>'deliverables');
  end if;
  for x in select * from jsonb_array_elements(coalesce(v_deliv,'[]'::jsonb)) loop
    v_key := coalesce(nullif(x->>'format_key',''), (intel.ci_parse_deliverables(x->>'format')->0)->>'format_key');
    if v_key is not null and not exists (select 1 from intel.ci_content_format_vocab where format_key = v_key) then v_key := null; end if;
    insert into intel.ci_campaign_deliverable(participation_id, content_format, quantity)
    values (p_participation, v_key, greatest(coalesce(nullif(x->>'quantity','')::int,1),1));
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function intel.ci_ensure_deliverables(uuid) from public, anon, authenticated;
grant execute on function intel.ci_ensure_deliverables(uuid) to service_role;

create or replace function api.submit_campaign_video(p_participation uuid, p_url text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_owner uuid; v_stage text; v_del uuid;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  v_id := intel.ci_caller_identity();
  select identity_id, stage into v_owner, v_stage from intel.ci_campaign_participation where participation_id = p_participation;
  if v_owner is null or v_owner <> v_id then raise exception 'not your campaign' using errcode = '42501'; end if;
  if v_stage not in ('product_sent','content_created','changes_requested') then
    raise exception 'you can submit your video once the product has reached you (now: %)', replace(v_stage,'_',' ') using errcode = '22023'; end if;
  if coalesce(btrim(p_url),'') !~* '^https?://' then
    raise exception 'paste a link to your video (Google Drive, Dropbox, WeTransfer, YouTube unlisted…) starting with https://' using errcode = '22023'; end if;
  perform intel.ci_ensure_deliverables(p_participation);
  select deliverable_id into v_del from intel.ci_campaign_deliverable where participation_id = p_participation
   order by (content_format = 'reel') desc nulls last, created_at limit 1;
  update intel.ci_campaign_deliverable set status = 'submitted'
   where participation_id = p_participation and status in ('expected','submitted');
  return api.submit_content(v_del, btrim(p_url), nullif(btrim(coalesce(p_note,'')),''));
end $$;

create or replace function api.bp_review_video(p_participation uuid, p_approve boolean, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_sub uuid; v_stage text; r jsonb;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  if not intel.ci_can_manage_participation(p_participation) then raise exception 'not your campaign' using errcode = '42501'; end if;
  select stage into v_stage from intel.ci_campaign_participation where participation_id = p_participation;
  if v_stage <> 'content_submitted' then raise exception 'there is no video waiting for review (now: %)', replace(v_stage,'_',' ') using errcode = '22023'; end if;
  if not p_approve and coalesce(btrim(p_reason),'') = '' then raise exception 'tell the creator what to change' using errcode = '22023'; end if;
  select s.submission_id into v_sub from intel.ci_campaign_submission s
    join intel.ci_campaign_deliverable d on d.deliverable_id = s.deliverable_id
   where d.participation_id = p_participation and s.status = 'submitted' order by s.submitted_at desc limit 1;
  if v_sub is null then raise exception 'no submitted video found' using errcode = '22023'; end if;
  -- approve_content authorises operators and the campaign's own org; the Super Admin is an operator
  r := api.approve_content(v_sub, case when p_approve then 'approved' else 'changes_requested' end, nullif(btrim(coalesce(p_reason,'')),''));
  if p_approve then
    update intel.ci_campaign_deliverable set status = 'approved' where participation_id = p_participation and status in ('expected','submitted');
  else
    update intel.ci_campaign_deliverable set status = 'expected' where participation_id = p_participation and status = 'submitted';
  end if;
  return r || jsonb_build_object('stage', (select stage from intel.ci_campaign_participation where participation_id = p_participation));
end $$;

-- ===================================================================================================
-- 7) Posting, analytics and DONE
-- ===================================================================================================
-- the Instagram media id behind a pasted permalink (so the metrics worker can read its insights)
create or replace function intel.ci_norm_permalink(p text)
returns text language sql immutable set search_path = '' as $$
  select nullif(rtrim(regexp_replace(regexp_replace(lower(btrim(coalesce(p,''))), '[?#].*$', ''), '^(https?://)?(www\.|m\.)?', ''), '/'), '') $$;

create or replace function intel.tg_post_resolve_media()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_member uuid; v_mid text;
begin
  if new.external_media_id is not null or new.permalink is null then return new; end if;
  select intel.ci_member_of_identity(p.identity_id) into v_member from intel.ci_campaign_participation p where p.participation_id = new.participation_id;
  select m->>'id' into v_mid
    from public.social_accounts sa, jsonb_array_elements(coalesce(sa.recent_media,'[]'::jsonb) || coalesce(sa.recent_stories,'[]'::jsonb)) m
   where sa.member_id = v_member and sa.platform = 'instagram'
     and intel.ci_norm_permalink(m->>'permalink') = intel.ci_norm_permalink(new.permalink)
   limit 1;
  new.external_media_id := v_mid;
  return new;
exception when others then return new;
end $$;
revoke all on function intel.tg_post_resolve_media() from public, anon, authenticated;
drop trigger if exists ci_post_resolve_media on intel.ci_campaign_post;
create trigger ci_post_resolve_media before insert on intel.ci_campaign_post
  for each row execute function intel.tg_post_resolve_media();

-- one post's latest numbers: the collected insight row, else the public like/comment counts from the creator's feed
create or replace function intel.ci_post_stats(p_post uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r jsonb; po record; v_member uuid; m jsonb;
begin
  select jsonb_build_object('reach', x.reach, 'impressions', x.impressions, 'views', x.views, 'likes', x.likes,
           'comments', x.comments, 'shares', x.shares, 'saves', x.saves, 'at', x.captured_at, 'source', 'insights')
    into r from intel.ci_campaign_post_metric x where x.post_id = p_post order by x.captured_at desc limit 1;
  if r is not null then return r; end if;
  select * into po from intel.ci_campaign_post where post_id = p_post;
  if po.post_id is null then return '{}'::jsonb; end if;
  select intel.ci_member_of_identity(p.identity_id) into v_member from intel.ci_campaign_participation p where p.participation_id = po.participation_id;
  select e into m from public.social_accounts sa, jsonb_array_elements(coalesce(sa.recent_media,'[]'::jsonb)) e
   where sa.member_id = v_member and sa.platform = 'instagram'
     and ((po.external_media_id is not null and e->>'id' = po.external_media_id)
          or intel.ci_norm_permalink(e->>'permalink') = intel.ci_norm_permalink(po.permalink))
   limit 1;
  if m is null then return '{}'::jsonb; end if;
  return jsonb_strip_nulls(jsonb_build_object('likes', nullif(m->>'like_count','')::bigint, 'comments', nullif(m->>'comments_count','')::bigint,
           'reach', nullif(m->>'reach','')::bigint, 'views', coalesce(nullif(m->>'plays','')::bigint, nullif(m->>'views','')::bigint),
           'source', 'public'));
end $$;
revoke all on function intel.ci_post_stats(uuid) from public, anon, authenticated;
grant execute on function intel.ci_post_stats(uuid) to service_role;

-- every post of one creator in a campaign, with numbers
create or replace function intel.ci_participation_posts(p_participation uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('post_id', po.post_id, 'media_type', po.media_type, 'permalink', po.permalink,
           'posted_at', po.posted_at, 'tracked', po.external_media_id is not null, 'stats', intel.ci_post_stats(po.post_id))
         order by po.posted_at), '[]'::jsonb)
    from intel.ci_campaign_post po where po.participation_id = p_participation $$;
revoke all on function intel.ci_participation_posts(uuid) from public, anon, authenticated;
grant execute on function intel.ci_participation_posts(uuid) to service_role;

-- the team can type numbers in (e.g. from a screenshot of the creator's insights) when Instagram can't be read
create or replace function api.bp_record_metrics(p_participation uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_post uuid;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  if not intel.ci_can_manage_participation(p_participation) then raise exception 'not your campaign' using errcode = '42501'; end if;
  select post_id into v_post from intel.ci_campaign_post where participation_id = p_participation
   and (p_payload->>'post_id' is null or post_id::text = p_payload->>'post_id') order by posted_at desc limit 1;
  if v_post is null then raise exception 'the creator has not posted yet' using errcode = '22023'; end if;
  perform intel.ci_record_post_metric(v_post, p_payload - 'post_id' || jsonb_build_object('source','manual'), auth.uid());
  return jsonb_build_object('post_id', v_post, 'stage', (select stage from intel.ci_campaign_participation where participation_id = p_participation));
end $$;

create or replace function api.bp_mark_done(p_participation uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_stage text;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  if not intel.ci_can_manage_participation(p_participation) then raise exception 'not your campaign' using errcode = '42501'; end if;
  select stage into v_stage from intel.ci_campaign_participation where participation_id = p_participation;
  if v_stage <> 'published' then raise exception 'the creator has not posted yet (now: %)', replace(v_stage,'_',' ') using errcode = '22023'; end if;
  return jsonb_build_object('stage', intel.ci_participation_advance(p_participation, 'completed', auth.uid(), 'campaign done — analytics collected'));
end $$;

-- metrics arrive for a posted creator → DONE automatically
create or replace function intel.tg_metric_completes()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_part uuid; v_stage text;
begin
  select po.participation_id into v_part from intel.ci_campaign_post po where po.post_id = new.post_id;
  select stage into v_stage from intel.ci_campaign_participation where participation_id = v_part;
  if v_stage = 'published' then
    perform intel.ci_participation_advance(v_part, 'completed', null, 'analytics collected');
  end if;
  return null;
exception when others then
  raise warning 'auto-complete skipped: %', sqlerrm; return null;
end $$;
revoke all on function intel.tg_metric_completes() from public, anon, authenticated;
drop trigger if exists ci_metric_completes on intel.ci_campaign_post_metric;
create trigger ci_metric_completes after insert on intel.ci_campaign_post_metric
  for each row execute function intel.tg_metric_completes();

-- ===================================================================================================
-- 8) THE AUTOPILOT — every step triggers the next one
-- ===================================================================================================
create or replace function intel.tg_barter_autoflow()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_stage text; v_days int; v_oper uuid; v_name text; v_prod text;
begin
  if not intel.ci_feature_enabled('operational_pilot') or new.participation_id is null then return null; end if;
  select stage into v_stage from intel.ci_campaign_participation where participation_id = new.participation_id;

  if new.entity = 'participation' then
    if new.to_status in ('brand_confirmed','accepted') then
      -- approved → the contract goes out on its own
      begin perform intel.ci_issue_contract(new.participation_id, new.actor_member_id);
      exception when others then raise warning 'auto contract skipped for %: %', new.participation_id, sqlerrm; end;

    elsif new.to_status = 'contract_signed' then
      perform intel.ci_ensure_deliverables(new.participation_id);
      select c.created_by, c.name into v_oper, v_name from intel.ci_campaign c where c.campaign_id = new.campaign_id;
      perform intel.ci_notify(v_oper, new.campaign_id, new.participation_id, 'contract_signed_ops',
        jsonb_build_object('campaign', coalesce(v_name,'your campaign')));

    elsif new.to_status = 'address_confirmed' then
      -- a "waiting for courier" row appears on Logistics and in the process board
      if not exists (select 1 from intel.ci_campaign_shipment where participation_id = new.participation_id and status in ('pending','shipped','delivered')) then
        select product into v_prod from intel.ci_campaign_contract where participation_id = new.participation_id;
        insert into intel.ci_campaign_shipment(participation_id, product, status)
        values (new.participation_id, coalesce(v_prod, (select product from intel.ci_campaign where campaign_id = new.campaign_id)), 'pending');
      end if;

    elsif new.to_status = 'content_created' then
      -- the video brief is out: set the due date on every deliverable
      perform intel.ci_ensure_deliverables(new.participation_id);
      select coalesce(content_days, 7) into v_days from intel.ci_campaign_contract where participation_id = new.participation_id;
      v_days := coalesce(v_days, ((intel.ci_playbook(new.campaign_id)->'contract')->>'content_days')::int, 7);
      update intel.ci_campaign_deliverable set expected_by = current_date + v_days
       where participation_id = new.participation_id and expected_by is null;
      update intel.ci_reminder set due_at = now() + make_interval(days => greatest(v_days - 1, 1))
       where participation_id = new.participation_id and kind = 'video_due' and fired_at is null and cancelled_at is null;

    elsif new.to_status = 'published' then
      update intel.ci_campaign_deliverable set status = 'published'
       where participation_id = new.participation_id and status in ('expected','submitted','approved');
    end if;

  elsif new.entity = 'shipment' and new.to_status = 'delivered' then
    -- parcel in hand → video brief goes to the creator (stage "Video brief sent")
    if v_stage in ('accepted','address_confirmed') then
      perform intel.ci_participation_advance(new.participation_id, 'product_sent', new.actor_member_id, 'product delivered');
      v_stage := 'product_sent';
    end if;
    if v_stage = 'product_sent' then
      perform intel.ci_participation_advance(new.participation_id, 'content_created', new.actor_member_id, 'video brief sent automatically');
    end if;
  end if;
  return null;
end $$;
revoke all on function intel.tg_barter_autoflow() from public, anon, authenticated;
drop trigger if exists ci_event_zz_autoflow on intel.ci_campaign_event;
create trigger ci_event_zz_autoflow after insert on intel.ci_campaign_event
  for each row execute function intel.tg_barter_autoflow();

-- a product reassigned to the next creator starts them at "brand confirmed" without an event → contract here
create or replace function intel.tg_participation_born_confirmed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.stage = 'brand_confirmed' and intel.ci_feature_enabled('operational_pilot') then
    begin perform intel.ci_issue_contract(new.participation_id, auth.uid());
    exception when others then raise warning 'auto contract skipped for %: %', new.participation_id, sqlerrm; end;
  end if;
  return null;
end $$;
revoke all on function intel.tg_participation_born_confirmed() from public, anon, authenticated;
drop trigger if exists ci_participation_born_confirmed on intel.ci_campaign_participation;
create trigger ci_participation_born_confirmed after insert on intel.ci_campaign_participation
  for each row execute function intel.tg_participation_born_confirmed();

-- ===================================================================================================
-- 9) The team can now run their own campaigns (not only Geek operators): screening, list, courier
-- ===================================================================================================
create or replace function api.advance_participation(p_participation uuid, p_to text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  if not intel.ci_can_manage_participation(p_participation) then raise exception 'not your campaign' using errcode='42501'; end if;
  return jsonb_build_object('stage', intel.ci_participation_advance(p_participation, p_to, auth.uid(), p_reason));
end $$;

create or replace function api.screen_participation(p_participation uuid, p_eligible boolean, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  if not intel.ci_can_manage_participation(p_participation) then raise exception 'not your campaign' using errcode='42501'; end if;
  return jsonb_build_object('stage', intel.ci_participation_advance(p_participation,
    case when p_eligible then 'eligible' else 'ineligible' end, auth.uid(), p_reason));
end $$;

create or replace function api.mark_shipment_status_by_participation(p_participation uuid, p_status text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ship uuid;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  if not intel.ci_can_manage_participation(p_participation) then raise exception 'not your campaign' using errcode='42501'; end if;
  select shipment_id into v_ship from intel.ci_campaign_shipment where participation_id=p_participation order by created_at desc limit 1;
  if v_ship is null then raise exception 'no shipment for this participation' using errcode='42501'; end if;
  return jsonb_build_object('status', intel.ci_shipment_set_status(v_ship, p_status, auth.uid(), '{}'::jsonb));
end $$;

-- ===================================================================================================
-- 10) Reads: the process board (brand/agency/Super Admin), analytics, and the creator's own journey
-- ===================================================================================================
create or replace function api.barter_tracker(p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid := intel.ci_resolve_campaign(p_campaign);
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  if v_id is null or not intel.ci_can_manage_campaign(v_id) then raise exception 'not your campaign' using errcode = '42501'; end if;

  return jsonb_build_object(
    'campaign', (select jsonb_build_object('campaign_id', c.campaign_id, 'name', c.name, 'brand', c.submitted_brand_name,
                   'product', c.product, 'starts_on', c.starts_on, 'ends_on', c.ends_on, 'status', c.lifecycle_status)
                   from intel.ci_campaign c where c.campaign_id = v_id),
    'outreach_at', (select updated_at from intel.ci_campaign_outreach o where o.campaign_id = v_id),
    'playbook', intel.ci_playbook(v_id),
    'creators', coalesce((select jsonb_agg(row order by (row->>'applied_at')) from (
      select jsonb_build_object(
        'participation_id', p.participation_id, 'stage', p.stage, 'reason', p.reason,
        'applied_profile', p.applied_profile, 'applied_at', p.created_at, 'updated_at', p.updated_at,
        'creator', intel.ci_public_creator_card(p.identity_id),
        'member_id', intel.ci_member_of_identity(p.identity_id),
        'blacklisted', exists (select 1 from intel.ci_creator_blacklist b where b.identity_id = p.identity_id and b.lifted_at is null),
        'has_address', p.shipping_address_id is not null,
        'ship_to', (select jsonb_build_object('name', coalesce(nullif(btrim(m.name),''), sa.name), 'line1', a.line1, 'line2', a.line2,
                       'landmark', a.landmark, 'city', a.city, 'state', a.state, 'postal_code', a.postal_code,
                       'phone', (select w.phone_e164 from public.wa_contacts w where w.user_id = a2.member_id and w.verified_at is not null limit 1))
                      from private.creator_address a
                      join intel.ci_identity_actor_access a2 on a2.identity_id = a.identity_id and a2.access_role = 'self' and a2.revoked_at is null
                      left join public.members m on m.id = a2.member_id
                      left join public.social_accounts sa on sa.member_id = a2.member_id and sa.platform = 'instagram'
                     where a.address_id = p.shipping_address_id and p.stage in ('address_confirmed','product_sent','content_created')
                     limit 1),
        'contract', (select jsonb_build_object('issued_at', k.issued_at, 'signed_at', k.signed_at, 'asci_ack', k.asci_ack, 'terms_ack', k.terms_ack,
                       'ad_rights_months', k.ad_rights_months, 'collab_rights', k.collab_rights, 'product', k.product,
                       'deliverables', k.deliverables, 'content_days', k.content_days, 'clauses', k.clauses, 'signature_name', k.signature_name)
                       from intel.ci_campaign_contract k where k.participation_id = p.participation_id),
        'shipment', (select jsonb_build_object('status', s.status, 'courier', s.courier, 'tracking_ref', s.tracking_ref, 'tracking_url', s.tracking_url,
                       'product', s.product, 'shipped_at', s.shipped_at, 'delivered_at', s.delivered_at)
                       from intel.ci_campaign_shipment s where s.participation_id = p.participation_id order by s.created_at desc limit 1),
        'due_on', (select min(d.expected_by) from intel.ci_campaign_deliverable d where d.participation_id = p.participation_id),
        'submission', (select jsonb_build_object('url', s.content_url, 'note', s.note, 'submitted_at', s.submitted_at,
                         'rounds', (select count(*) from intel.ci_campaign_submission s2 join intel.ci_campaign_deliverable d2 on d2.deliverable_id = s2.deliverable_id
                                     where d2.participation_id = p.participation_id))
                         from intel.ci_campaign_submission s join intel.ci_campaign_deliverable d on d.deliverable_id = s.deliverable_id
                        where d.participation_id = p.participation_id order by s.submitted_at desc limit 1),
        'review', (select jsonb_build_object('decision', ap.decision, 'reason', ap.reason, 'at', ap.decided_at)
                     from intel.ci_campaign_approval ap join intel.ci_campaign_submission s on s.submission_id = ap.submission_id
                     join intel.ci_campaign_deliverable d on d.deliverable_id = s.deliverable_id
                    where d.participation_id = p.participation_id order by ap.decided_at desc limit 1),
        'posts', intel.ci_participation_posts(p.participation_id),
        'deliverables', coalesce((select jsonb_agg(jsonb_build_object('deliverable_id', d.deliverable_id, 'format', d.content_format,
                           'quantity', d.quantity, 'expected_by', d.expected_by, 'status', d.status) order by d.created_at)
                         from intel.ci_campaign_deliverable d where d.participation_id = p.participation_id), '[]'::jsonb),
        'steps', (select coalesce(jsonb_object_agg(e.to_status, e.at), '{}'::jsonb) from (
                    select distinct on (ev.to_status) ev.to_status, ev.at from intel.ci_campaign_event ev
                     where ev.participation_id = p.participation_id and ev.entity = 'participation'
                     order by ev.to_status, ev.at) e)) row
        from intel.ci_campaign_participation p
       where p.campaign_id = v_id) s), '[]'::jsonb));
end $$;

-- whole-campaign + per-creator report
create or replace function api.campaign_analytics(p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid := intel.ci_resolve_campaign(p_campaign); v_rows jsonb; v_tot jsonb;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  if v_id is null or not intel.ci_can_manage_campaign(v_id) then raise exception 'not your campaign' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(r order by (r->'totals'->>'views')::bigint desc nulls last, (r->'totals'->>'likes')::bigint desc nulls last), '[]'::jsonb) into v_rows from (
    select jsonb_build_object('participation_id', p.participation_id, 'stage', p.stage,
             'creator', intel.ci_public_creator_card(p.identity_id), 'posts', x.posts,
             'totals', (select jsonb_build_object(
                  'reach', sum((e->'stats'->>'reach')::bigint), 'views', sum((e->'stats'->>'views')::bigint),
                  'likes', sum((e->'stats'->>'likes')::bigint), 'comments', sum((e->'stats'->>'comments')::bigint),
                  'shares', sum((e->'stats'->>'shares')::bigint), 'saves', sum((e->'stats'->>'saves')::bigint))
                from jsonb_array_elements(x.posts) e)) r
      from intel.ci_campaign_participation p
      cross join lateral (select intel.ci_participation_posts(p.participation_id) posts) x
     where p.campaign_id = v_id and p.stage in ('content_approved','published','completed')) s;
  select jsonb_build_object(
      'creators_live', (select count(*) from jsonb_array_elements(v_rows) e where jsonb_array_length(e->'posts') > 0),
      'posts', (select coalesce(sum(jsonb_array_length(e->'posts')),0) from jsonb_array_elements(v_rows) e),
      'followers', (select coalesce(sum((e->'creator'->>'followers')::bigint),0) from jsonb_array_elements(v_rows) e where jsonb_array_length(e->'posts') > 0),
      'reach', (select sum((e->'totals'->>'reach')::bigint) from jsonb_array_elements(v_rows) e),
      'views', (select sum((e->'totals'->>'views')::bigint) from jsonb_array_elements(v_rows) e),
      'likes', (select sum((e->'totals'->>'likes')::bigint) from jsonb_array_elements(v_rows) e),
      'comments', (select sum((e->'totals'->>'comments')::bigint) from jsonb_array_elements(v_rows) e),
      'shares', (select sum((e->'totals'->>'shares')::bigint) from jsonb_array_elements(v_rows) e),
      'saves', (select sum((e->'totals'->>'saves')::bigint) from jsonb_array_elements(v_rows) e)) into v_tot;
  return jsonb_build_object(
    'campaign', (select jsonb_build_object('name', c.name, 'brand', c.submitted_brand_name, 'starts_on', c.starts_on, 'ends_on', c.ends_on)
                   from intel.ci_campaign c where c.campaign_id = v_id),
    'funnel', coalesce((select jsonb_object_agg(stage, n) from (select stage, count(*) n from intel.ci_campaign_participation
                          where campaign_id = v_id group by stage) f), '{}'::jsonb),
    'totals', v_tot, 'creators', v_rows);
end $$;

-- the creator's own campaigns: everything they need at every step
create or replace function api.get_my_campaigns()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  v_id := intel.ci_caller_identity();
  return coalesce((select jsonb_agg(jsonb_build_object(
      'participation_id', p.participation_id, 'campaign_id', c.campaign_id, 'campaign', c.name,
      'brand', coalesce(b.name, c.submitted_brand_name), 'product', coalesce(k.product, c.product), 'comp_type', c.comp_type,
      'category', c.category, 'starts_on', c.starts_on, 'ends_on', c.ends_on, 'lifecycle_status', c.lifecycle_status,
      'org_name', (select m.org_name from public.members m where m.org_id = c.org_id and m.org_name is not null limit 1),
      'cities', coalesce(to_jsonb(c.cities), '[]'::jsonb), 'languages', coalesce(to_jsonb(c.languages), '[]'::jsonb),
      'brief', br.requirements->>'brief', 'deliverables_text', br.requirements->>'deliverables_text',
      'platforms', br.requirements->>'platforms', 'campaign_type', br.requirements->>'campaign_type',
      'barter_subtype', br.requirements->>'barter_subtype', 'product_link', br.requirements->>'product_link',
      'product_value', coalesce(to_jsonb(k.product_value), br.requirements->'product_value'),
      'hashtags', coalesce(br.requirements->'hashtags', '[]'::jsonb), 'mentions', coalesce(br.requirements->'mentions', '[]'::jsonb),
      'attachments', coalesce(br.requirements->'attachments', '[]'::jsonb),
      'stage', p.stage, 'reason', p.reason, 'reason_code', p.reason_code,
      'reason_label', (select v.label from public.rejection_reason_vocab v where v.code = p.reason_code),
      'applied_profile', p.applied_profile, 'applied_at', p.created_at, 'updated_at', p.updated_at,
      'deadline', (select min(expected_by) from intel.ci_campaign_deliverable d where d.participation_id = p.participation_id),
      'contract', case when k.contract_id is not null then jsonb_build_object('issued_at', k.issued_at, 'signed_at', k.signed_at,
                    'content_days', k.content_days, 'ad_rights_months', k.ad_rights_months, 'collab_rights', k.collab_rights) end,
      'shipment', (select jsonb_build_object('status', s.status, 'product', s.product, 'courier', s.courier,
                     'tracking_ref', s.tracking_ref, 'tracking_url', s.tracking_url, 'shipped_at', s.shipped_at, 'delivered_at', s.delivered_at)
                     from intel.ci_campaign_shipment s where s.participation_id = p.participation_id
                    order by s.created_at desc limit 1),
      -- the video brief unlocks once the product is in their hands
      'video_brief', case when p.stage in ('content_created','content_submitted','changes_requested','content_approved','published','completed')
                          then intel.ci_playbook(c.campaign_id)->'brief' end,
      'submission', (select jsonb_build_object('url', s.content_url, 'note', s.note, 'submitted_at', s.submitted_at)
                       from intel.ci_campaign_submission s join intel.ci_campaign_deliverable d on d.deliverable_id = s.deliverable_id
                      where d.participation_id = p.participation_id order by s.submitted_at desc limit 1),
      'review', (select jsonb_build_object('decision', ap.decision, 'reason', ap.reason, 'at', ap.decided_at)
                   from intel.ci_campaign_approval ap join intel.ci_campaign_submission s on s.submission_id = ap.submission_id
                   join intel.ci_campaign_deliverable d on d.deliverable_id = s.deliverable_id
                  where d.participation_id = p.participation_id order by ap.decided_at desc limit 1),
      'posts', intel.ci_participation_posts(p.participation_id),
      'steps', (select coalesce(jsonb_object_agg(e.to_status, e.at), '{}'::jsonb) from (
                  select distinct on (ev.to_status) ev.to_status, ev.at from intel.ci_campaign_event ev
                   where ev.participation_id = p.participation_id and ev.entity = 'participation'
                   order by ev.to_status, ev.at) e),
      'deliverables', coalesce((select jsonb_agg(jsonb_build_object(
            'deliverable_id', d.deliverable_id, 'format', d.content_format, 'quantity', d.quantity,
            'expected_by', d.expected_by, 'status', d.status,
            'permalink', m.permalink, 'media_type', m.media_type, 'posted_at', m.media_timestamp,
            'metrics', coalesce((select jsonb_object_agg(i.metric_name, i.value_count) from (
                  select distinct on (x.metric_name) x.metric_name, x.value_count
                    from intel.ci_media_insights x
                   where x.media_row_id = d.media_row_id and x.status = 'available' and x.value_count is not null
                   order by x.metric_name, x.captured_at desc) i), '{}'::jsonb)) order by d.created_at)
          from intel.ci_campaign_deliverable d
          left join intel.ci_media m on m.media_row_id = d.media_row_id
         where d.participation_id = p.participation_id), '[]'::jsonb))
      order by p.updated_at desc)
    from intel.ci_campaign_participation p
    join intel.ci_campaign c on c.campaign_id = p.campaign_id
    left join intel.ci_brand b on b.brand_id = c.brand_id
    left join intel.ci_campaign_contract k on k.participation_id = p.participation_id
    left join lateral (select requirements from intel.ci_campaign_brief x where x.campaign_id = c.campaign_id order by x.created_at desc limit 1) br on true
    where p.identity_id = v_id), '[]'::jsonb);
end $$;

-- Logistics shows the tracking link and the "waiting for courier" rows too
create or replace function api.shipments_board()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_admin boolean; v_org uuid;
begin
  if v_uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  v_admin := public.is_platform_admin() or intel.ci_is_agency_operator();
  select org_id into v_org from public.members where id = v_uid;

  return coalesce((select jsonb_agg(r order by (r->>'sort') desc) from (
    select jsonb_build_object(
      'shipment_id', s.shipment_id, 'participation_id', p.participation_id,
      'campaign_id', c.campaign_id, 'campaign', c.name,
      'brand', coalesce(b.name, c.submitted_brand_name),
      'org_name', (select m.org_name from public.members m where m.org_id = c.org_id and m.org_name is not null limit 1),
      'creator', intel.ci_public_creator_card(p.identity_id),
      'product', coalesce(s.product, c.product), 'courier', s.courier, 'tracking_ref', s.tracking_ref, 'tracking_url', s.tracking_url,
      'status', s.status, 'shipped_at', s.shipped_at, 'delivered_at', s.delivered_at,
      'stage', p.stage,
      'has_address', p.shipping_address_id is not null
                     or exists (select 1 from private.creator_address a where a.identity_id = p.identity_id and a.deleted_at is null),
      'sort', coalesce(s.delivered_at, s.shipped_at, s.created_at)) r
      from intel.ci_campaign_shipment s
      join intel.ci_campaign_participation p on p.participation_id = s.participation_id
      join intel.ci_campaign c on c.campaign_id = p.campaign_id
      left join intel.ci_brand b on b.brand_id = c.brand_id
     where v_admin or (c.org_id is not null and c.org_id = v_org)
     order by coalesce(s.delivered_at, s.shipped_at, s.created_at) desc
     limit 300) x), '[]'::jsonb);
end $$;

-- ===================================================================================================
-- 11) Messages that go out at each step
-- ===================================================================================================
insert into intel.ci_notification_template(template_key, kind, title, body_md, action_route, action_label) values
  ('contract_signed_ops','info','Contract signed — {{campaign}}','A creator signed their contract. They will confirm their address next; then add the courier.','campaigns','Open process')
on conflict (template_key) do update set title = excluded.title, body_md = excluded.body_md, action_route = excluded.action_route;

update intel.ci_notification_template set
  title = 'You''re selected for {{campaign}} 🎉', body_md = 'The brand picked you. Your contract is waiting in the app — read it and sign to get your product.',
  action_label = 'Sign contract' where template_key = 'brand_confirmed';
update intel.ci_notification_template set
  body_md = 'Your contract is ready: product, deliverables, ASCI, ad rights and the non-delivery terms. Read it and sign in the app.'
  where template_key = 'contract_sent';
update intel.ci_notification_template set
  body_md = 'Your product has been handed to the courier. Track it in the app — your video brief unlocks the moment it reaches you.',
  action_label = 'Track parcel' where template_key = 'product_shipped';
update intel.ci_notification_template set
  title = 'Parcel delivered — your video brief is ready ({{campaign}})',
  body_md = 'Your product reached you. Open the app for the full video brief and your due date, then shoot and submit your video.',
  action_label = 'Open brief' where template_key = 'parcel_received';
update intel.ci_notification_template set action_route = 'campaigns'
  where template_key in ('content_for_review','address_confirmed','published','applied_received','eligible_ready','sent_to_brand','brand_declined')
    and action_route = 'campaignops';
update intel.ci_notification_template set
  body_md = 'Your video is approved. Post it with the caption, hashtags and tags from the brief, then add the post link in the app.'
  where template_key = 'content_approved';
update intel.ci_notification_template set
  body_md = 'Your video is due. Submit it in the app — creators who receive a product and don''t deliver are blacklisted and must re-ship the product at their own cost.'
  where template_key = 'video_due';

-- ===================================================================================================
-- 12) Grants
-- ===================================================================================================
do $$ declare fn text; begin
  foreach fn in array array[
    'api.get_playbook(uuid)','api.save_playbook(uuid,jsonb,jsonb)','api.bp_send_contract(uuid)',
    'api.get_my_contract(uuid)','api.sign_contract_v2(uuid,text,boolean,boolean)',
    'api.bp_record_courier(uuid,jsonb)','api.bp_mark_delivered(uuid)','api.creator_mark_received(uuid)',
    'api.submit_campaign_video(uuid,text,text)','api.bp_review_video(uuid,boolean,text)',
    'api.bp_record_metrics(uuid,jsonb)','api.bp_mark_done(uuid)',
    'api.advance_participation(uuid,text,text)','api.screen_participation(uuid,boolean,text)',
    'api.mark_shipment_status_by_participation(uuid,text)',
    'api.barter_tracker(uuid)','api.campaign_analytics(uuid)','api.get_my_campaigns()','api.shipments_board()'] loop
    execute 'revoke all on function '||fn||' from public, anon';
    execute 'grant execute on function '||fn||' to authenticated, service_role';
  end loop; end $$;

-- ===================================================================================================
-- 13) Catch up creators who were approved before this existed (they get their contract now)
-- ===================================================================================================
do $$ declare r record; begin
  if intel.ci_feature_enabled('operational_pilot') then
    for r in select p.participation_id from intel.ci_campaign_participation p
              where p.stage = 'brand_confirmed'
                and not exists (select 1 from intel.ci_campaign_contract k where k.participation_id = p.participation_id) loop
      begin perform intel.ci_issue_contract(r.participation_id, null);
      exception when others then raise warning 'catch-up contract skipped for %: %', r.participation_id, sqlerrm; end;
    end loop;
    for r in select p.participation_id from intel.ci_campaign_participation p
              where p.stage in ('contract_signed','address_confirmed','product_sent','content_created','changes_requested') loop
      perform intel.ci_ensure_deliverables(r.participation_id);
    end loop;
  end if;
end $$;
