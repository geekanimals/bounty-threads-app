-- One campaign page for everything (the "command center"):
--  • Status changes ask for what they need: Courier sent → courier + tracking · Video submitted → the video link ·
--    Posted / Done → the link of EVERY post (e.g. 1 Reel + 2 Stories = 3 links). Without them the step isn't changed.
--  • Bulk sheet: new columns "Post link" and "Video link". A row with post links = Posted (links saved, numbers fetched);
--    "Posted" without a link waits on Client approved. Re-uploading the same campaign only moves people forward and adds
--    any new links / courier / address — even for creators who haven't registered yet: their links are kept on the
--    upload row and attached the moment they join.
--  • Creators already on Geek OS skip registration / connect steps and land straight on the sheet's step.
--  • Address confirmed → the video brief goes to the creator right away (app + email) so they can plan & practise;
--    the video deadline still starts when the parcel is delivered.
--  • The campaign page gets everyone in one list: invites (with links, courier) + participants (with Instagram attached).
-- ADDITIVE: new columns, functions, one trigger; existing functions redefined with the same signatures.

-- an old 3-argument copy of ci_bulk_fastforward (left over from an early version) makes 3-argument calls ambiguous
-- ("function … is not unique") — re-uploading a creator who is already in the campaign failed. The real one has defaults.
drop function if exists intel.ci_bulk_fastforward(uuid, uuid, uuid);

alter table intel.ci_campaign_invite add column if not exists video_url  text;
alter table intel.ci_campaign_invite add column if not exists post_links text[] not null default '{}';

create or replace function intel.ci_link_kind(p text)
returns text language sql immutable set search_path = '' as $$
  select case when p ~* '/stories/' then 'story' when p ~* '/(reel|reels|tv)/' then 'reel' else 'post' end $$;

-- the links on an upload row → the creator's campaign (video submission + posts), once they are in it
create or replace function intel.ci_apply_invite_links(p_invite uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare i intel.ci_campaign_invite%rowtype; v_del uuid; l text; v_n int := 0;
begin
  select * into i from intel.ci_campaign_invite where invite_id = p_invite;
  if i.participation_id is null then return 0; end if;
  if i.video_url is not null and not exists (select 1 from intel.ci_campaign_submission s join intel.ci_campaign_deliverable d on d.deliverable_id = s.deliverable_id
                                              where d.participation_id = i.participation_id) then
    perform intel.ci_ensure_deliverables(i.participation_id);
    select deliverable_id into v_del from intel.ci_campaign_deliverable where participation_id = i.participation_id order by created_at limit 1;
    if v_del is null then
      insert into intel.ci_campaign_deliverable(participation_id, content_format, quantity, status) values (i.participation_id, 'reel', 1, 'submitted')
      returning deliverable_id into v_del;
    end if;
    insert into intel.ci_campaign_submission(deliverable_id, content_url, note, status, submitted_at) values (v_del, i.video_url, 'video link from the team / sheet', 'submitted', now());
    update intel.ci_campaign_deliverable set status = case when status in ('expected','missed') then 'submitted' else status end, updated_at = now() where deliverable_id = v_del;
    v_n := v_n + 1;
  end if;
  foreach l in array coalesce(i.post_links, '{}') loop
    continue when exists (select 1 from intel.ci_campaign_post po where po.participation_id = i.participation_id and intel.ci_ig_code(po.permalink) = intel.ci_ig_code(l));
    insert into intel.ci_campaign_post(participation_id, campaign_id, media_type, permalink, posted_at)
    values (i.participation_id, i.campaign_id, intel.ci_link_kind(l), l, now());
    insert into intel.ci_campaign_event(campaign_id, participation_id, entity, from_status, to_status, actor_member_id, reason)
    values (i.campaign_id, i.participation_id, 'submission', null, 'posted', auth.uid(), intel.ci_link_kind(l) || ' — link added by the team');
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function intel.ci_apply_invite_links(uuid) from public, anon, authenticated;

create or replace function intel.tg_invite_links()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.participation_id is not null and (new.video_url is not null or cardinality(coalesce(new.post_links,'{}')) > 0)
     and (tg_op = 'INSERT' or new.participation_id is distinct from old.participation_id or new.video_url is distinct from old.video_url
          or new.post_links is distinct from old.post_links) then
    perform intel.ci_apply_invite_links(new.invite_id);
  end if;
  return null;
end $$;
drop trigger if exists ci_invite_links on intel.ci_campaign_invite;
create trigger ci_invite_links after insert or update on intel.ci_campaign_invite
  for each row execute function intel.tg_invite_links();

-- how many post links a campaign needs per creator (from its deliverables)
create or replace function intel.ci_campaign_post_need(p_campaign uuid)
returns int language sql stable security definer set search_path = '' as $$
  select greatest(coalesce(sum(greatest(coalesce(nullif(x->>'quantity','')::int,1),1)) filter (where x->>'format_key' in ('reel','story','static_post','carousel')), 0), 1)::int
    from jsonb_array_elements(coalesce(intel.ci_parse_deliverables((intel.ci_playbook(p_campaign)->'contract')->>'deliverables'), '[]'::jsonb)) x $$;

-- what a step needs before it can be set by hand (courier, video link, every post link)
create or replace function intel.ci_step_requirements(p_status text, p_have_courier boolean, p_have_video boolean, p_links int, p_need int)
returns text language sql immutable set search_path = '' as $$
  select case
    when intel.ci_bulk_rank(p_status) >= intel.ci_bulk_rank('posted') and p_links < p_need
      then 'add the link of every post — ' || p_need || ' needed, ' || p_links || ' added'
    when intel.ci_bulk_rank(p_status) between intel.ci_bulk_rank('video_submitted') and intel.ci_bulk_rank('client_approved') and not p_have_video
      then 'add the video link'
    when intel.ci_bulk_rank(p_status) in (intel.ci_bulk_rank('courier_sent'), intel.ci_bulk_rank('courier_delivered')) and not p_have_courier
      then 'add the courier name and the tracking ID / link'
  end $$;

-- the team moves an UPLOADED creator (registered or not) — with what the step needs
create or replace function api.invite_set_step(p_invite uuid, p_status text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare i intel.ci_campaign_invite%rowtype; v_st text := intel.ci_bulk_status(p_status); v_links text[]; v_trk text; v_cour text; v_vid text; v_miss text;
        v_part_links int := 0;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  select * into i from intel.ci_campaign_invite where invite_id = p_invite;
  if i.invite_id is null or not intel.ci_can_manage_campaign(i.campaign_id) then raise exception 'not your campaign' using errcode = '42501'; end if;
  if v_st is null then raise exception 'unknown status "%"', p_status using errcode = '22023'; end if;
  if intel.ci_bulk_rank(v_st) < intel.ci_bulk_rank(coalesce(i.status, 'registered')) then
    raise exception 'steps only move forward — they are already on %', replace(coalesce(i.status,'registered'), '_', ' ') using errcode = '22023'; end if;
  select coalesce(array_agg(distinct l), '{}') into v_links from (
    select btrim(x) l from jsonb_array_elements_text(case when jsonb_typeof(p_payload->'post_urls') = 'array' then p_payload->'post_urls' else '[]'::jsonb end) x
    union all select btrim(p_payload->>'post_url') where coalesce(p_payload->>'post_url','') <> ''
    union all select unnest(coalesce(i.post_links, '{}'))) s
   where l ~* '^https?://(www\.|m\.)?instagram\.com/(reel|reels|p|tv|stories)/';
  v_cour := coalesce(nullif(btrim(p_payload->>'courier'),''), i.courier);
  v_trk := coalesce(nullif(btrim(p_payload->>'tracking'),''), i.tracking_ref, i.tracking_url);
  v_vid := coalesce(nullif(btrim(p_payload->>'video_url'),''), i.video_url);
  if v_vid is not null and v_vid !~* '^https?://' then raise exception 'the video link must start with https://' using errcode = '22023'; end if;
  if i.participation_id is not null then
    select count(*) into v_part_links from intel.ci_campaign_post where participation_id = i.participation_id;
  end if;
  v_miss := intel.ci_step_requirements(v_st,
                (v_cour is not null and v_trk is not null)
                  or exists (select 1 from intel.ci_campaign_shipment sh where sh.participation_id = i.participation_id and coalesce(sh.tracking_ref, sh.tracking_url) is not null),
                v_vid is not null or cardinality(v_links) > 0
                  or exists (select 1 from intel.ci_campaign_submission su join intel.ci_campaign_deliverable d on d.deliverable_id = su.deliverable_id where d.participation_id = i.participation_id),
                                       greatest(cardinality(v_links), v_part_links), intel.ci_campaign_post_need(i.campaign_id));
  if v_miss is not null then raise exception 'Please %', v_miss using errcode = '22023'; end if;
  update intel.ci_campaign_invite set post_links = v_links, video_url = v_vid, courier = v_cour,
         tracking_ref = case when v_trk !~* '^https?://' then v_trk else tracking_ref end,
         tracking_url = case when v_trk ~* '^https?://' then v_trk else tracking_url end
   where invite_id = p_invite;
  return api.bulk_set_status(p_invite, p_status);
end $$;
revoke all on function api.invite_set_step(uuid, text, jsonb) from public, anon;
grant execute on function api.invite_set_step(uuid, text, jsonb) to authenticated;

-- "Address confirmed → your video brief" (app + email; the WhatsApp step messages stay as they are)
insert into intel.ci_notification_template(template_key, kind, title, body_md, action_route, action_label, active) values
  ('brief_preview', 'info', 'Your video brief for {{campaign}} 🎬',
   'Your address is confirmed ✓ — your parcel will be on its way soon. Here''s your **video brief** for **{{campaign}}** so you can plan and practise now. The deadline starts once the parcel reaches you.',
   'mycampaigns', 'Read the brief', true)
on conflict (template_key) do update set title = excluded.title, body_md = excluded.body_md, action_route = excluded.action_route,
  action_label = excluded.action_label, active = true;
insert into intel.ci_step_copy(template_key, did, next_step, then_we) values
  ('brief_preview', 'confirming your delivery address for {{campaign}}', 'read your video brief in the app and plan your video — you can start practising now',
   'ship your product; the video deadline starts once it reaches you')
on conflict (template_key) do update set did = excluded.did, next_step = excluded.next_step, then_we = excluded.then_we;


-- the app's dropdowns send step keys (contract_sent, courier_sent …): read them like the words
CREATE OR REPLACE FUNCTION intel.ci_bulk_status(p text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare v text := regexp_replace(lower(btrim(coalesce(p, ''))), '^\d+\s*[.)-]?\s*', '');
begin
  -- the step keys the app's dropdowns send (contract_sent, courier_sent …) read the same as the words
  v := regexp_replace(replace(v, '_', ' '), '\s+', ' ', 'g');
  if v in ('', 'registered', 'register', 'applied', 'invited', 'invite', 'new', 'pending', '-', '—') then return 'registered'; end if;
  if v in ('screened', 'eligible', 'shortlisted') then return 'screened'; end if;
  if v in ('sent to brand', 'sent to the brand', 'with brand') then return 'sent_to_brand'; end if;
  if v in ('approved', 'brand confirmed', 'brand approved', 'selected', 'confirmed', 'yes', 'y', 'ok', 'final', '✓', '✔') then return 'approved'; end if;
  if v in ('contract sent', 'contract') then return 'contract_sent'; end if;
  if v in ('contract signed', 'signed') then return 'contract_signed'; end if;
  if v in ('address confirmed', 'address', 'address done') then return 'address_confirmed'; end if;
  if v in ('courier sent', 'shipped', 'dispatched', 'in transit', 'product sent') then return 'courier_sent'; end if;
  if v in ('courier delivered', 'courier received', 'delivered', 'received', 'product received', 'product delivered') then return 'courier_delivered'; end if;
  if v in ('video brief sent', 'brief sent', 'video brief') then return 'video_brief_sent'; end if;
  if v in ('video submitted', 'submitted', 'video sent') then return 'video_submitted'; end if;
  if v in ('client approved', 'video approved', 'content approved') then return 'client_approved'; end if;
  -- Posted is the last step: posting completes the campaign
  if v in ('posted', 'live', 'published', 'reel posted', 'done', 'completed', 'complete') then return 'posted'; end if;
  return null;
end $function$;
-- the team sets a step by hand (same as before) — now with what the step needs, and every post link at once
CREATE OR REPLACE FUNCTION api.team_set_step(p_participation uuid, p_status text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare p intel.ci_campaign_participation%rowtype; v_st text := intel.ci_bulk_status(p_status); v_inv uuid; v_mid uuid;
        v_handle text; v_stage text; v_video text := btrim(coalesce(p_payload->>'video_url', ''));
        v_post text := btrim(coalesce(p_payload->>'post_url', '')); v_del uuid; v_notify boolean := coalesce((p_payload->>'notify')::boolean, true);
        v_rank_now int; v_rank_to int; v_links text[]; l text; v_have_courier boolean; v_have_video boolean; v_existing int; v_need int; v_miss text;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  select * into p from intel.ci_campaign_participation where participation_id = p_participation;
  if p.participation_id is null or not intel.ci_can_manage_participation(p_participation) then
    raise exception 'not your campaign' using errcode = '42501'; end if;
  if v_st is null then raise exception 'unknown step "%"', p_status using errcode = '22023'; end if;
  if p.stage in ('rejected','dropped','ineligible','brand_declined') then
    raise exception 'this creator was % — they can''t be moved on', replace(p.stage, '_', ' ') using errcode = '22023'; end if;
  -- where they are now, on the same 13-step scale as the sheet
  v_rank_now := case p.stage when 'invited' then 1 when 'shortlisted' then 1 when 'applied' then 1 when 'eligible' then 2
      when 'sent_to_brand' then 3 when 'brand_confirmed' then 4 when 'accepted' then 4 when 'contract_sent' then 5
      when 'contract_signed' then 6 when 'address_confirmed' then 7 when 'product_sent' then 8 when 'content_created' then 10
      when 'changes_requested' then 10 when 'content_submitted' then 11 when 'content_approved' then 12 else 13 end;
  v_rank_to := intel.ci_bulk_rank(v_st);
  if v_rank_to < v_rank_now then
    raise exception 'steps only move forward — they are already on a later step' using errcode = '22023'; end if;
  if v_video <> '' and v_video !~* '^https?://' then raise exception 'the video link must start with https://' using errcode = '22023'; end if;
  -- what this step needs: courier + tracking · the video link · the link of every post
  select coalesce(array_agg(distinct x), '{}') into v_links from (
    select btrim(y) x from jsonb_array_elements_text(case when jsonb_typeof(p_payload->'post_urls') = 'array' then p_payload->'post_urls' else '[]'::jsonb end) y
    union all select v_post where v_post <> '') q
   where x <> '';
  if exists (select 1 from unnest(v_links) x where x !~* '^https?://(www\.|m\.)?instagram\.com/(reel|reels|p|tv|stories)/') then
    raise exception 'paste Instagram post links (instagram.com/reel/… , /p/… or /stories/…)' using errcode = '22023'; end if;
  v_have_courier := (nullif(btrim(p_payload->>'courier'),'') is not null and coalesce(nullif(btrim(p_payload->>'tracking'),''), nullif(btrim(p_payload->>'tracking_url'),'')) is not null)
                 or exists (select 1 from intel.ci_campaign_shipment sh where sh.participation_id = p_participation and coalesce(sh.tracking_ref, sh.tracking_url) is not null);
  v_have_video := v_video <> '' or cardinality(v_links) > 0
                 or exists (select 1 from intel.ci_campaign_submission su join intel.ci_campaign_deliverable d on d.deliverable_id = su.deliverable_id where d.participation_id = p_participation);
  select count(*) into v_existing from intel.ci_campaign_post where participation_id = p_participation;
  v_need := greatest(coalesce((intel.ci_deliverables_progress(p_participation)->>'need')::int, 1), 1);
  v_miss := intel.ci_step_requirements(v_st, v_have_courier, v_have_video, v_existing + cardinality(v_links), v_need);
  if v_miss is not null and v_rank_to > v_rank_now then raise exception 'Please %', v_miss using errcode = '22023'; end if;
  v_mid := intel.ci_member_of_identity(p.identity_id);

  -- the invite row carries the step (bulk upload rows already have one; others get one now)
  select invite_id into v_inv from intel.ci_campaign_invite where participation_id = p_participation limit 1;
  if v_inv is null then
    v_handle := lower(coalesce(nullif(regexp_replace(coalesce(p.applied_profile, ''), '[^A-Za-z0-9._]', '', 'g'), ''),
                 (select regexp_replace(coalesce(sa.username, ''), '[^A-Za-z0-9._]', '', 'g') from public.social_accounts sa where sa.member_id = v_mid and sa.platform = 'instagram' limit 1),
                 'creator.' || left(replace(p_participation::text, '-', ''), 12)));
    select invite_id into v_inv from intel.ci_campaign_invite where campaign_id = p.campaign_id and platform = 'instagram' and lower(handle) = v_handle;
    if v_inv is null then
      insert into intel.ci_campaign_invite(campaign_id, platform, handle, source, status, approved, claimed_by, claimed_at, reserved_by,
                                           participation_id, invited_by, status_messaged)
      values (p.campaign_id, 'instagram', v_handle, 'manual', v_st, intel.ci_bulk_rank(v_st) >= 4, v_mid, now(), v_mid,
              p_participation, auth.uid(), case when v_notify then null else v_st end)
      returning invite_id into v_inv;
    else
      update intel.ci_campaign_invite set participation_id = coalesce(participation_id, p_participation), claimed_by = coalesce(claimed_by, v_mid),
             claimed_at = coalesce(claimed_at, now()) where invite_id = v_inv;
    end if;
  end if;
  update intel.ci_campaign_invite set status = v_st, approved = intel.ci_bulk_rank(v_st) >= 4,
         courier = coalesce(nullif(btrim(p_payload->>'courier'), ''), courier),
         tracking_ref = coalesce(nullif(btrim(p_payload->>'tracking'), ''), tracking_ref),
         tracking_url = coalesce(nullif(btrim(p_payload->>'tracking_url'), ''), tracking_url)
   where invite_id = v_inv;

  -- walk them there (quiet), then one message for where they land
  v_stage := intel.ci_bulk_fastforward(p_participation, v_inv, auth.uid(), v_notify);

  -- the team's video link = the creator's submitted video
  if v_video <> '' then
    select deliverable_id into v_del from intel.ci_campaign_deliverable where participation_id = p_participation order by created_at limit 1;
    if v_del is null then
      insert into intel.ci_campaign_deliverable(participation_id, content_format, quantity, status)
      values (p_participation, 'reel', 1, 'submitted') returning deliverable_id into v_del;
    end if;
    if not exists (select 1 from intel.ci_campaign_submission s where s.deliverable_id = v_del and s.content_url = v_video) then
      insert into intel.ci_campaign_submission(deliverable_id, content_url, note, status, submitted_at)
      values (v_del, v_video, 'added by the team', 'submitted', now());
      update intel.ci_campaign_deliverable set status = case when status in ('expected','missed') then 'submitted' else status end, updated_at = now()
       where deliverable_id = v_del;
    end if;
    insert into intel.ci_campaign_event(campaign_id, participation_id, entity, from_status, to_status, actor_member_id, reason)
      values (p.campaign_id, p_participation, 'submission', null, 'submitted', auth.uid(), 'video link added by the team');
  end if;

  -- the team's Instagram link = their post (completes the campaign)
  foreach l in array v_links loop
    continue when exists (select 1 from intel.ci_campaign_post po where po.participation_id = p_participation and intel.ci_ig_code(po.permalink) = intel.ci_ig_code(l));
    perform api.bp_add_post_link(p_participation, jsonb_build_object('permalink', l, 'media_type', intel.ci_link_kind(l)));
  end loop;
  if false then
  end if;

  return jsonb_build_object('stage', (select stage from intel.ci_campaign_participation where participation_id = p_participation), 'status', v_st);
end $function$;

-- the campaign page: links / courier / Instagram on every row
CREATE OR REPLACE FUNCTION api.campaign_people(p_campaign uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_camp uuid;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  v_camp := intel.ci_resolve_campaign(p_campaign);
  if v_camp is null then return jsonb_build_object('participants', '[]'::jsonb, 'invites', '[]'::jsonb); end if;
  if not intel.ci_can_manage_campaign(v_camp) then raise exception 'not your campaign' using errcode = '42501'; end if;
  return jsonb_build_object(
    'campaign_id', v_camp,
    'participants', coalesce((select jsonb_agg(x order by x->>'updated_at' desc) from (
      select jsonb_build_object(
        'participation_id', p.participation_id, 'stage', p.stage, 'applied_profile', p.applied_profile,
        'applied_at', p.created_at, 'updated_at', p.updated_at, 'reason', p.reason,
        'creator', intel.ci_public_creator_card(p.identity_id, p.applied_profile),
        'member_id', mem.mid, 'phone', intel.ci_member_phone(mem.mid), 'profile_pct', intel.ci_profile_pct(mem.mid),
        'needs', intel.ci_join_needs(mem.mid),
        'from_bulk', exists (select 1 from intel.ci_campaign_invite i where i.participation_id = p.participation_id),
        'invite_id', (select i.invite_id from intel.ci_campaign_invite i where i.participation_id = p.participation_id limit 1),
        'ig_connected', exists (select 1 from public.social_accounts sa where sa.member_id = mem.mid and sa.platform = 'instagram' and coalesce(sa.username,'') <> ''),
        'last_move', (select max(e.at) from intel.ci_campaign_event e where e.participation_id = p.participation_id),
        'last_wa', (select jsonb_build_object('key', o.template_key, 'status', o.status, 'at', coalesce(o.sent_at, o.created_at), 'error', o.last_error)
                      from intel.ci_outbox o where o.channel = 'whatsapp' and (o.participation_id = p.participation_id
                        or (o.recipient_member_id = mem.mid and o.campaign_id = v_camp)) order by o.created_at desc limit 1)) x
        from intel.ci_campaign_participation p
        left join lateral (select a.member_id mid from intel.ci_identity_actor_access a where a.identity_id = p.identity_id
                            and a.access_role = 'self' and a.revoked_at is null order by a.granted_at limit 1) mem on true
       where p.campaign_id = v_camp) s), '[]'::jsonb),
    'invites', coalesce((select jsonb_agg(x order by x->>'created_at' desc) from (
      select jsonb_build_object(
        'invite_id', i.invite_id, 'name', i.full_name, 'handle', i.handle, 'phone', i.phone_e164, 'email', i.email, 'city', i.city,
        'source', i.source, 'status', coalesce(i.status, case when i.approved then 'approved' else 'registered' end),
        'created_at', i.created_at, 'invites_sent', i.invites_sent, 'last_invited_at', i.last_invited_at,
        'post_links', to_jsonb(coalesce(i.post_links, '{}')), 'video_url', i.video_url, 'courier', i.courier, 'tracking', coalesce(i.tracking_ref, i.tracking_url),
        'has_address', i.ship_address is not null, 'followers', i.followers,
        'ig_connected', mem.mid is not null and exists (select 1 from public.social_accounts sa where sa.member_id = mem.mid and sa.platform = 'instagram' and coalesce(sa.username,'') <> ''),
        'member_id', mem.mid, 'registered', mem.mid is not null, 'needs', case when mem.mid is not null then intel.ci_join_needs(mem.mid) end,
        'profile_pct', case when mem.mid is not null then intel.ci_profile_pct(mem.mid) end,
        'last_wa', (select jsonb_build_object('status', o.status, 'at', coalesce(o.sent_at, o.created_at), 'error', o.last_error) from intel.ci_outbox o
                     where o.channel = 'whatsapp' and o.dedupe_key like 'binv:' || i.invite_id || ':wa:%' order by o.created_at desc limit 1)) x
        from intel.ci_campaign_invite i
        left join lateral (select coalesce(i.claimed_by, i.reserved_by, intel.ci_find_creator(i.phone_e164, lower(i.email), lower(i.handle))) as mid) mem on true
       where i.campaign_id = v_camp and i.claimed_at is null) s), '[]'::jsonb));
end $function$;

-- My Campaigns shows the video brief from Address confirmed
CREATE OR REPLACE FUNCTION api.get_my_campaigns()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      'video_brief', case when p.stage in ('address_confirmed','product_sent','content_created','content_submitted','changes_requested','content_approved','published','completed')
                          then intel.ci_playbook(c.campaign_id)->'brief' end,
      'submission', (select jsonb_build_object('url', s.content_url, 'note', s.note, 'submitted_at', s.submitted_at)
                       from intel.ci_campaign_submission s join intel.ci_campaign_deliverable d on d.deliverable_id = s.deliverable_id
                      where d.participation_id = p.participation_id order by s.submitted_at desc limit 1),
      'review', (select jsonb_build_object('decision', ap.decision, 'reason', ap.reason, 'at', ap.decided_at)
                   from intel.ci_campaign_approval ap join intel.ci_campaign_submission s on s.submission_id = ap.submission_id
                   join intel.ci_campaign_deliverable d on d.deliverable_id = s.deliverable_id
                  where d.participation_id = p.participation_id order by ap.decided_at desc limit 1),
      'posts', intel.ci_participation_posts(p.participation_id),
      'blocked_at', p.blocked_at, 'block_reason', p.block_reason, 'needs_approval', p.needs_approval,
      'feedback_requested_at', p.feedback_requested_at, 'feedback_at', p.feedback_at,
      'contract_signed', k.signed_at is not null,
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
end $function$;

CREATE OR REPLACE FUNCTION intel.tg_barter_autoflow()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      -- the video brief goes out now, so they can plan and practise before the parcel arrives (the deadline starts at delivery)
      begin
        perform intel.ci_notify(intel.ci_member_of_identity((select identity_id from intel.ci_campaign_participation where participation_id = new.participation_id)),
          new.campaign_id, new.participation_id, 'brief_preview',
          jsonb_build_object('campaign', coalesce((select name from intel.ci_campaign where campaign_id = new.campaign_id), 'your campaign')));
      exception when others then raise warning 'brief preview skipped: %', sqlerrm; end;

    elsif new.to_status = 'content_created' then
      -- the video brief is out: set the due date on every deliverable
      perform intel.ci_ensure_deliverables(new.participation_id);
      select coalesce(content_days, 7) into v_days from intel.ci_campaign_contract where participation_id = new.participation_id;
      v_days := coalesce(v_days, ((intel.ci_playbook(new.campaign_id)->'contract')->>'content_days')::int, 7);
      update intel.ci_campaign_deliverable set expected_by = current_date + v_days
       where participation_id = new.participation_id and expected_by is null;
      -- day 2–3 daily · day 4–6 morning + evening · day 7 block
      perform intel.ci_schedule_video_reminders(new.participation_id, now());

    elsif new.to_status = 'product_sent' then
      -- the clock only starts when the parcel is in their hands
      update intel.ci_reminder set cancelled_at = now()
       where participation_id = new.participation_id and kind = 'video_due' and fired_at is null and cancelled_at is null;

    elsif new.to_status = 'published' then
      update intel.ci_campaign_deliverable set status = 'published'
       where participation_id = new.participation_id and status in ('expected','submitted','approved');
      -- posted = done: the campaign completes now; feedback is optional (asked in the app, reminded on the next apply)
      update intel.ci_campaign_participation set feedback_requested_at = coalesce(feedback_requested_at, now())
       where participation_id = new.participation_id;
      -- complete only when EVERY deliverable is up (e.g. 1 Reel + 2 Stories = 3 links); otherwise tell them what's left
      perform intel.ci_after_post(new.participation_id, new.actor_member_id);
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
end $function$;

CREATE OR REPLACE FUNCTION api.bulk_import_creators(p_campaign uuid, p_rows jsonb, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare x jsonb; v_ph text; v_em text; v_h text; v_m uuid; v_id uuid; v_org uuid; v_batch uuid := gen_random_uuid();
        v_res jsonb; v_added int := 0; v_invited int := 0; v_waiting int := 0; v_skipped int := 0; v_msgs int := 0;
        v_note text := nullif(btrim(coalesce(p_note,'')),''); v_status text; v_addr jsonb; v_trk text; v_courier text; v_part uuid;
        v_dup int := 0; v_posts text[]; v_video text; v_nolink int := 0; seen_ph text[] := '{}'; seen_em text[] := '{}'; seen_h text[] := '{}'; v_prev intel.ci_campaign_invite%rowtype;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  p_campaign := intel.ci_resolve_campaign(p_campaign);
  if p_campaign is null then raise exception 'campaign not found — save it first' using errcode = '22023'; end if;
  if not intel.ci_can_manage_campaign(p_campaign) then raise exception 'not your campaign' using errcode = '42501'; end if;
  if jsonb_array_length(coalesce(p_rows,'[]'::jsonb)) > 2000 then raise exception 'upload at most 2000 creators at a time' using errcode = '22023'; end if;
  select org_id into v_org from public.members where id = auth.uid();

  for x in select * from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) loop
    v_ph := intel.ci_norm_phone(x->>'phone');
    v_em := nullif(lower(btrim(coalesce(x->>'email',''))), ''); if v_em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then v_em := null; end if;
    v_h := intel.ci_norm_handle(x->>'handle');
    v_status := coalesce(intel.ci_bulk_status(x->>'status'),
                         case when lower(coalesce(x->>'approved','')) in ('true','yes','1') then 'approved' else 'registered' end);
    v_addr := intel.ci_bulk_address(x);
    v_courier := nullif(btrim(coalesce(x->>'courier','')), '');
    v_trk := nullif(btrim(coalesce(x->>'tracking','')), '');
    -- post links (one or more, any separator) + the video link
    select coalesce(array_agg(distinct l), '{}') into v_posts from regexp_split_to_table(coalesce(x->>'post_link',''), '[\s,;|]+') l
     where l ~* '^https?://(www\.|m\.)?instagram\.com/(reel|reels|p|tv|stories)/';
    v_video := nullif(btrim(coalesce(x->>'video_link','')), ''); if v_video !~* '^https?://' then v_video := null; end if;
    if cardinality(v_posts) > 0 and intel.ci_bulk_rank(v_status) < intel.ci_bulk_rank('posted') then v_status := 'posted'; end if;
    if v_ph is null and v_em is null and v_h is null then v_skipped := v_skipped + 1; continue; end if;
    -- the same person twice in this sheet (same phone, email or Instagram) → only the first row counts
    if (v_ph is not null and v_ph = any(seen_ph)) or (v_em is not null and v_em = any(seen_em)) or (v_h is not null and v_h = any(seen_h)) then
      v_dup := v_dup + 1; continue; end if;
    if v_ph is not null then seen_ph := seen_ph || v_ph; end if;
    if v_em is not null then seen_em := seen_em || v_em; end if;
    if v_h is not null then seen_h := seen_h || v_h; end if;

    -- one row per person per campaign (matched on phone, then email, then Instagram)
    select invite_id into v_id from intel.ci_campaign_invite
     where campaign_id = p_campaign and ((v_ph is not null and phone_e164 = v_ph) or (v_em is not null and lower(email) = v_em)
                                          or (v_h is not null and lower(handle) = v_h))
     order by (phone_e164 = v_ph) desc nulls last limit 1;
    -- already uploaded before, and this row doesn't move them to a later step → skip (no second message)
    if v_id is not null then
      select * into v_prev from intel.ci_campaign_invite where invite_id = v_id;
      if intel.ci_bulk_rank(v_status) <= intel.ci_bulk_rank(coalesce(v_prev.status, 'registered')) and v_prev.batch_id is distinct from v_batch
         and (v_addr is null or v_prev.ship_address is not null) and (v_courier is null or v_prev.courier is not null)
         and (v_video is null or v_prev.video_url is not null) and v_posts <@ coalesce(v_prev.post_links, '{}') then
        v_dup := v_dup + 1; continue; end if;
    end if;
    if v_status = 'posted' and cardinality(v_posts) = 0
       and cardinality(coalesce((select post_links from intel.ci_campaign_invite where invite_id = v_id), '{}')) = 0 then
      v_status := 'client_approved'; v_nolink := v_nolink + 1;
    end if;
    if v_id is null then
      insert into intel.ci_campaign_invite(campaign_id, platform, handle, note, invited_by, org_id, source, full_name, phone_e164, email,
                                           city, followers, extra, approved, status, ship_address, courier, tracking_ref, tracking_url,
                                           batch_id, dm_status, video_url, post_links)
      values (p_campaign, 'instagram', v_h, v_note, auth.uid(), v_org, 'bulk', nullif(btrim(coalesce(x->>'name','')),''), v_ph, v_em,
              nullif(btrim(coalesce(x->>'city','')),''), nullif(regexp_replace(coalesce(x->>'followers',''), '[^0-9]', '', 'g'),'')::bigint,
              coalesce(x->'extra','{}'::jsonb), intel.ci_bulk_rank(v_status) >= 4, v_status, v_addr, v_courier,
              case when v_trk !~* '^https?://' then v_trk end, case when v_trk ~* '^https?://' then v_trk end, v_batch, 'manual', v_video, v_posts)
      returning invite_id into v_id;
    else
      update intel.ci_campaign_invite set
        handle = coalesce(handle, v_h), phone_e164 = coalesce(phone_e164, v_ph), email = coalesce(email, v_em),
        full_name = coalesce(nullif(btrim(coalesce(x->>'name','')),''), full_name), city = coalesce(nullif(btrim(coalesce(x->>'city','')),''), city),
        status = case when intel.ci_bulk_rank(v_status) > intel.ci_bulk_rank(coalesce(status,'registered')) then v_status else coalesce(status,'registered') end,
        approved = approved or intel.ci_bulk_rank(v_status) >= 4,
        ship_address = coalesce(v_addr, ship_address), courier = coalesce(v_courier, courier),
        tracking_ref = coalesce(case when v_trk !~* '^https?://' then v_trk end, tracking_ref),
        tracking_url = coalesce(case when v_trk ~* '^https?://' then v_trk end, tracking_url),
        note = coalesce(v_note, note), batch_id = v_batch, source = 'bulk',
        video_url = coalesce(v_video, video_url),
        post_links = (select coalesce(array_agg(distinct l), '{}') from unnest(coalesce(post_links, '{}') || v_posts) l)
       where invite_id = v_id;
    end if;

    -- their Instagram goes to the auto-fetch queue (followers, name, photo, bio) — the profile picks it up
    if v_h is not null then
      perform intel.ci_upsert_external(jsonb_build_object('handle', v_h, 'name', nullif(btrim(coalesce(x->>'name','')),''),
                                                          'city', nullif(btrim(coalesce(x->>'city','')),'')), v_org, 'bulk');
    end if;

    v_m := intel.ci_find_creator(v_ph, v_em, v_h);
    select participation_id into v_part from intel.ci_campaign_invite where invite_id = v_id;
    if v_part is not null then
      perform intel.ci_bulk_fastforward(v_part, v_id, auth.uid(), true);   -- already in: move them to the sheet's step
      v_added := v_added + 1;
    else
      -- already on Geek OS → registration / connect steps are skipped: straight onto the sheet's step
      if v_m is not null then
        perform set_config('geek.bulk_force', 'on', true);
        begin v_res := intel.ci_bulk_attach(v_id, v_m, auth.uid());
        exception when others then perform set_config('geek.bulk_force', 'off', true); raise; end;
        perform set_config('geek.bulk_force', 'off', true);
      else v_res := null; end if;
      if v_res->>'status' = 'joined' then v_added := v_added + 1;
      else
        if v_m is not null then v_waiting := v_waiting + 1; else v_invited := v_invited + 1; end if;
        -- not in the campaign yet: the message for their step (Approved → invite) — once per status
        if (select status_messaged is distinct from status from intel.ci_campaign_invite where invite_id = v_id) then
          v_msgs := v_msgs + intel.ci_send_bulk_invite(v_id);
        end if;
      end if;
    end if;
  end loop;

  insert into public.activity_log(member_id, kind, event, detail)
  values (auth.uid(), 'analytics', 'bulk_creator_upload', jsonb_build_object('campaign', p_campaign, 'added', v_added, 'invited', v_invited,
          'waiting', v_waiting, 'skipped', v_skipped, 'duplicates', v_dup, 'posted_without_link', v_nolink));
  return jsonb_build_object('batch_id', v_batch, 'added', v_added, 'invited', v_invited, 'waiting_profile', v_waiting,
                            'skipped', v_skipped, 'duplicates', v_dup, 'posted_without_link', v_nolink, 'messages', v_msgs);
end $function$;

CREATE OR REPLACE FUNCTION api.bulk_preview(p_campaign uuid, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare x jsonb; n int := 0; out jsonb := '[]'::jsonb; v_ph text; v_em text; v_h text; v_m uuid; v_stage text; v_who text;
        v_st text; v_ig jsonb; v_np int; v_hasvid boolean; seen_ph text[] := '{}'; seen_em text[] := '{}'; seen_h text[] := '{}'; v_dup boolean; v_inv intel.ci_campaign_invite%rowtype;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  p_campaign := intel.ci_resolve_campaign(p_campaign);
  if p_campaign is null then raise exception 'campaign not found — save it first' using errcode = '22023'; end if;
  if not intel.ci_can_manage_campaign(p_campaign) then raise exception 'not your campaign' using errcode = '42501'; end if;
  for x in select * from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) loop
    v_ph := intel.ci_norm_phone(x->>'phone');
    v_em := nullif(lower(btrim(coalesce(x->>'email',''))), ''); if v_em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then v_em := null; end if;
    v_h := intel.ci_norm_handle(x->>'handle');
    v_st := coalesce(intel.ci_bulk_status(x->>'status'), case when lower(coalesce(x->>'approved','')) in ('true','yes','1') then 'approved' end);
    select count(distinct l) into v_np from regexp_split_to_table(coalesce(x->>'post_link',''), '[\s,;|]+') l
     where l ~* '^https?://(www\.|m\.)?instagram\.com/(reel|reels|p|tv|stories)/';
    v_hasvid := coalesce(x->>'video_link','') ~* '^https?://';
    if v_np > 0 and intel.ci_bulk_rank(coalesce(v_st,'registered')) < intel.ci_bulk_rank('posted') then v_st := 'posted'; end if;
    v_dup := (v_ph is not null and v_ph = any(seen_ph)) or (v_em is not null and v_em = any(seen_em)) or (v_h is not null and v_h = any(seen_h));
    if v_ph is not null then seen_ph := seen_ph || v_ph; end if;
    if v_em is not null then seen_em := seen_em || v_em; end if;
    if v_h is not null then seen_h := seen_h || v_h; end if;
    v_inv := null;
    select * into v_inv from intel.ci_campaign_invite where campaign_id = p_campaign
       and ((v_ph is not null and phone_e164 = v_ph) or (v_em is not null and lower(email) = v_em) or (v_h is not null and lower(handle) = v_h)) limit 1;
    v_m := intel.ci_find_creator(v_ph, v_em, v_h); v_stage := null; v_who := null; v_ig := null;
    if v_m is not null then
      select coalesce(case when v_h is not null and intel.ci_member_has_handle(v_m, v_h) then '@'||v_h end,
                      (select '@'||sa.username from public.social_accounts sa where sa.member_id = v_m and sa.platform='instagram' limit 1), m.name)
        into v_who from public.members m where m.id = v_m;
      select p.stage into v_stage from intel.ci_campaign_participation p
       where p.campaign_id = p_campaign and p.identity_id = intel.ci_member_identity(v_m);
    end if;
    if v_h is not null then
      select jsonb_strip_nulls(jsonb_build_object('name', e.display_name, 'followers', e.followers, 'pic', e.profile_picture_url))
        into v_ig from intel.ci_external_creator e where e.platform = 'instagram' and e.handle = v_h;
    end if;
    out := out || jsonb_build_array(jsonb_build_object('i', n, 'phone', v_ph, 'email', v_em, 'handle', v_h,
      'phone_bad', coalesce(x->>'phone','') <> '' and v_ph is null,
      'email_bad', coalesce(x->>'email','') <> '' and v_em is null,
      'no_contact', v_ph is null and v_em is null and v_h is null,
      'status', coalesce(v_st, 'registered'), 'status_bad', coalesce(btrim(x->>'status'),'') <> '' and v_st is null,
      'message', intel.ci_bulk_status_key(coalesce(v_st, 'registered')),
      'needs_address', intel.ci_bulk_rank(v_st) between 7 and 9 and coalesce(btrim(x->>'address'),'') = '',
      'on_platform', v_m is not null, 'who', v_who, 'stage', v_stage, 'ig', v_ig,
      'duplicate', v_dup, 'post_links', v_np, 'video', v_hasvid,
      'needs_post_link', v_st = 'posted' and v_np = 0 and cardinality(coalesce(v_inv.post_links, '{}')) = 0,
      'live_stage', (select p.stage from intel.ci_campaign_participation p where p.participation_id = v_inv.participation_id),
      'already', v_inv.invite_id is not null and intel.ci_bulk_rank(coalesce(v_st,'registered')) <= intel.ci_bulk_rank(coalesce(v_inv.status,'registered'))
                 and v_np = 0 and not (v_hasvid and v_inv.video_url is null)));
    n := n + 1;
  end loop;
  return out;
end $function$;

-- "Mark complete" only when every post is up (Done = every deliverable posted, with its link)
create or replace function api.bp_mark_done(p_participation uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_stage text; pr jsonb;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  if not intel.ci_can_manage_participation(p_participation) then raise exception 'not your campaign' using errcode = '42501'; end if;
  select stage into v_stage from intel.ci_campaign_participation where participation_id = p_participation;
  if v_stage = 'completed' then return jsonb_build_object('stage', 'completed'); end if;
  if v_stage <> 'published' then raise exception 'the creator has not posted yet (now: %)', replace(v_stage,'_',' ') using errcode = '22023'; end if;
  pr := intel.ci_deliverables_progress(p_participation);
  if not coalesce((pr->>'all_done')::boolean, false) then
    raise exception 'Still to post: % — add the link of every post first', coalesce(nullif(pr->>'left',''), 'the remaining posts') using errcode = '22023'; end if;
  update intel.ci_campaign_participation set feedback_requested_at = coalesce(feedback_requested_at, now()) where participation_id = p_participation;
  perform intel.ci_participation_advance(p_participation, 'completed', auth.uid(), 'marked complete by the team');
  return jsonb_build_object('stage', 'completed');
end $$;
