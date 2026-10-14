-- Bulk creator upload for a campaign (Google Sheet / Excel / CSV / Word table → preview → tick who is already
-- approved → upload). For every row:
--   * already on Geek OS  → added to the campaign straight away. Ticked (approved) → contract goes out on its
--     own; not ticked → the campaign shows up for them with "Apply" and goes to screening when they apply.
--   * not on Geek OS yet  → invited on WhatsApp (the sheet's number) AND email (the sheet's email) with a link.
--     When they register — WhatsApp login with that number, that email, that Instagram, or simply through the
--     link — the invite is claimed: the campaign appears (approved ones go straight to the contract) and every
--     update from then on goes to WhatsApp + email + the app. The sheet's WhatsApp number becomes their update
--     number if they don't have one.
-- The team sees every row live: invite sent (WhatsApp / email), registered, what is still missing, stage.
-- ADDITIVE.

-- ---------------------------------------------------------------------------------------------------
-- 1) Storage
-- ---------------------------------------------------------------------------------------------------
alter table intel.ci_campaign_invite alter column handle drop not null;
alter table intel.ci_campaign_invite add column if not exists source        text not null default 'handle';
alter table intel.ci_campaign_invite add column if not exists full_name     text;
alter table intel.ci_campaign_invite add column if not exists phone_e164    text;
alter table intel.ci_campaign_invite add column if not exists email         text;
alter table intel.ci_campaign_invite add column if not exists city          text;
alter table intel.ci_campaign_invite add column if not exists followers     bigint;
alter table intel.ci_campaign_invite add column if not exists extra         jsonb not null default '{}'::jsonb;
alter table intel.ci_campaign_invite add column if not exists approved      boolean not null default false;
alter table intel.ci_campaign_invite add column if not exists token         uuid not null default gen_random_uuid();
alter table intel.ci_campaign_invite add column if not exists reserved_by   uuid references auth.users(id) on delete set null;
alter table intel.ci_campaign_invite add column if not exists participation_id uuid references intel.ci_campaign_participation(participation_id) on delete set null;
alter table intel.ci_campaign_invite add column if not exists invites_sent  int not null default 0;
alter table intel.ci_campaign_invite add column if not exists last_invited_at timestamptz;
alter table intel.ci_campaign_invite add column if not exists batch_id      uuid;
create unique index if not exists ci_campaign_invite_token_uq on intel.ci_campaign_invite(token);
create unique index if not exists ci_campaign_invite_phone_uq on intel.ci_campaign_invite(campaign_id, phone_e164) where phone_e164 is not null;
create unique index if not exists ci_campaign_invite_email_uq on intel.ci_campaign_invite(campaign_id, lower(email)) where email is not null;
create index if not exists ci_campaign_invite_open_phone on intel.ci_campaign_invite(phone_e164) where claimed_at is null;
create index if not exists ci_campaign_invite_open_email on intel.ci_campaign_invite(lower(email)) where claimed_at is null;

-- invited without approval → "Apply" (goes to screening) instead of "Accept" (straight to contract)
alter table intel.ci_campaign_participation add column if not exists needs_approval boolean not null default false;

insert into intel.ci_notification_template(template_key, kind, title, body_md, action_route, action_label) values
  ('bulk_invited','action_required','{{brand}} wants you on {{campaign}} 🎯',
   '{{brand}} would love to have you on **{{campaign}}**.{{product_line}} Open it in My Campaigns and tap **Apply** — the brand confirms and your contract follows.',
   'mycampaigns','Open & apply'),
  ('bulk_waiting','action_required','A campaign is waiting for you: {{campaign}}',
   '{{brand}} added you to **{{campaign}}**. Finish setting up your Geek OS profile — the campaign opens for you the moment it''s done.',
   'profile','Finish my profile')
on conflict (template_key) do update set title = excluded.title, body_md = excluded.body_md,
  action_route = excluded.action_route, action_label = excluded.action_label;

-- ---------------------------------------------------------------------------------------------------
-- 2) Helpers
-- ---------------------------------------------------------------------------------------------------
-- "98765 43210" / "+91-98765-43210" / "919876543210" → "+919876543210" (null when it isn't a phone number)
create or replace function intel.ci_norm_phone(p text)
returns text language plpgsql immutable set search_path = '' as $$
declare d text := regexp_replace(coalesce(p,''), '\D', '', 'g');
begin
  if d = '' then return null; end if;
  if btrim(coalesce(p,'')) !~ '^\+' then
    d := regexp_replace(d, '^0+', '');
    if length(d) = 10 then d := '91' || d; end if;
  end if;
  if d !~ '^[1-9][0-9]{7,14}$' then return null; end if;
  return '+' || d;
end $$;

-- "https://www.instagram.com/asha.k/?hl=en" / "@Asha.K" → "asha.k"
create or replace function intel.ci_norm_handle(p text)
returns text language plpgsql immutable set search_path = '' as $$
declare v text := btrim(coalesce(p,''));
begin
  v := regexp_replace(v, '^https?://(www\.|m\.)?instagram\.com/', '', 'i');
  v := lower(regexp_replace(split_part(split_part(v, '?', 1), '/', 1), '^@', ''));
  if v !~ '^[a-z0-9._]{1,60}$' then return null; end if;
  return v;
end $$;

-- a creator account that matches any of these (Instagram, WhatsApp / phone, email)
create or replace function intel.ci_find_creator(p_phone text, p_email text, p_handle text)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v uuid; v_digits text := ltrim(coalesce(p_phone,''), '+');
begin
  if p_handle is not null then
    select sa.member_id into v from public.social_accounts sa join public.members m on m.id = sa.member_id
     where sa.platform = 'instagram' and lower(sa.username) = p_handle and coalesce(m.role,'creator') = 'creator' limit 1;
    if v is not null then return v; end if;
  end if;
  if p_phone is not null then
    select w.user_id into v from public.wa_contacts w join public.members m on m.id = w.user_id
     where w.phone_e164 = p_phone and coalesce(m.role,'creator') = 'creator' limit 1;
    if v is not null then return v; end if;
    select m.id into v from public.members m where m.whatsapp_e164 = p_phone and coalesce(m.role,'creator') = 'creator' limit 1;
    if v is not null then return v; end if;
    select u.id into v from auth.users u join public.members m on m.id = u.id
     where u.phone = v_digits and coalesce(m.role,'creator') = 'creator' limit 1;
    if v is not null then return v; end if;
  end if;
  if p_email is not null then
    select u.id into v from auth.users u join public.members m on m.id = u.id
     where lower(u.email) = p_email and coalesce(m.role,'creator') = 'creator' limit 1;
    if v is not null then return v; end if;
    select a.member_id into v from private.creator_contact c
      join intel.ci_identity_actor_access a on a.identity_id = c.identity_id and a.access_role = 'self' and a.revoked_at is null
     where lower(c.email) = p_email limit 1;
    if v is not null then return v; end if;
  end if;
  if p_phone is not null then
    select a.member_id into v from private.creator_contact c
      join intel.ci_identity_actor_access a on a.identity_id = c.identity_id and a.access_role = 'self' and a.revoked_at is null
     where c.whatsapp_e164 = p_phone limit 1;
  end if;
  return v;
end $$;

create or replace function intel.ci_member_identity(p_member uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select a.identity_id from intel.ci_identity_actor_access a
   where a.member_id = p_member and a.access_role = 'self' and a.revoked_at is null order by a.granted_at limit 1 $$;

-- approved on the sheet but already in the campaign at an earlier step → walk them to "approved"
create or replace function intel.ci_bulk_promote(p_part uuid, p_actor uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_stage text; v_guard int := 0;
begin
  loop
    select stage into v_stage from intel.ci_campaign_participation where participation_id = p_part;
    v_guard := v_guard + 1; exit when v_guard > 6;
    if v_stage = 'invited' then perform intel.ci_participation_advance(p_part, 'accepted', p_actor, 'approved on the bulk upload');
    elsif v_stage = 'applied' then perform intel.ci_participation_advance(p_part, 'eligible', p_actor, 'approved on the bulk upload');
    elsif v_stage = 'eligible' then perform intel.ci_participation_advance(p_part, 'sent_to_brand', p_actor, 'approved on the bulk upload');
    elsif v_stage = 'sent_to_brand' then perform intel.ci_participation_advance(p_part, 'brand_confirmed', p_actor, 'approved on the bulk upload');
    else exit; end if;
  end loop;
  return v_stage;
end $$;

-- put one invite row into the campaign for this member (needs their creator identity; else it waits)
create or replace function intel.ci_bulk_attach(p_invite uuid, p_member uuid, p_actor uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare i intel.ci_campaign_invite%rowtype; v_identity uuid; v_part uuid; v_stage text; v_name text; v_brand text; v_prod text;
begin
  select * into i from intel.ci_campaign_invite where invite_id = p_invite for update;
  if i.invite_id is null then return null; end if;
  v_identity := intel.ci_member_identity(p_member);
  select c.name, coalesce(c.submitted_brand_name, b.name), c.product into v_name, v_brand, v_prod
    from intel.ci_campaign c left join intel.ci_brand b on b.brand_id = c.brand_id where c.campaign_id = i.campaign_id;

  -- the sheet's WhatsApp number carries their updates when they have none of their own
  if i.phone_e164 is not null then
    update public.members set whatsapp_e164 = i.phone_e164
     where id = p_member and whatsapp_e164 is null and not exists (select 1 from public.wa_contacts w where w.user_id = p_member);
  end if;

  if v_identity is null then
    -- registered but hasn't set up the creator profile yet: hold it for them and say so (once)
    if i.reserved_by is distinct from p_member then
      update intel.ci_campaign_invite set reserved_by = p_member where invite_id = p_invite;
      perform intel.ci_notify(p_member, i.campaign_id, null, 'bulk_waiting',
        jsonb_build_object('campaign', coalesce(v_name,'a campaign'), 'brand', coalesce(v_brand,'A brand')));
    end if;
    return jsonb_build_object('status', 'waiting_profile', 'member_id', p_member);
  end if;

  select participation_id, stage into v_part, v_stage from intel.ci_campaign_participation
   where campaign_id = i.campaign_id and identity_id = v_identity;
  if v_part is null then
    insert into intel.ci_campaign_participation(campaign_id, identity_id, stage, needs_approval, applied_profile)
    values (i.campaign_id, v_identity, case when i.approved then 'brand_confirmed' else 'invited' end, not i.approved, i.handle)
    returning participation_id, stage into v_part, v_stage;
    insert into intel.ci_campaign_event(campaign_id, participation_id, entity, from_status, to_status, actor_member_id, reason)
    values (i.campaign_id, v_part, 'participation', null, case when i.approved then 'brand_confirmed' else 'invited' end, p_actor,
            case when i.approved then 'approved on the bulk upload' else 'invited from the bulk upload' end);
    if not i.approved then
      perform intel.ci_notify(p_member, i.campaign_id, v_part, 'bulk_invited',
        jsonb_build_object('campaign', coalesce(v_name,'a campaign'), 'brand', coalesce(v_brand,'A brand'),
                           'product_line', case when v_prod is null then '' else ' You get: ' || v_prod || '.' end));
    end if;
  elsif i.approved then
    v_stage := intel.ci_bulk_promote(v_part, p_actor);
  end if;
  select stage into v_stage from intel.ci_campaign_participation where participation_id = v_part;
  update intel.ci_campaign_invite set claimed_by = p_member, claimed_at = coalesce(claimed_at, now()), reserved_by = p_member,
         participation_id = v_part where invite_id = p_invite;
  return jsonb_build_object('status', 'joined', 'member_id', p_member, 'participation_id', v_part, 'stage', v_stage);
end $$;

-- WhatsApp + email invite to someone not on Geek OS yet (link carries the invite)
create or replace function intel.ci_send_bulk_invite(p_invite uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare i intel.ci_campaign_invite%rowtype; v_name text; v_brand text; v_prod text; v_title text; v_body text; v_n int := 0; v_route text; v_first text;
begin
  select * into i from intel.ci_campaign_invite where invite_id = p_invite;
  if i.invite_id is null or i.claimed_at is not null then return 0; end if;
  select c.name, coalesce(c.submitted_brand_name, b.name), c.product into v_name, v_brand, v_prod
    from intel.ci_campaign c left join intel.ci_brand b on b.brand_id = c.brand_id where c.campaign_id = i.campaign_id;
  v_first := coalesce(nullif(split_part(btrim(coalesce(i.full_name,'')), ' ', 1), ''), case when i.handle is not null then '@' || i.handle end, 'there');
  v_route := '/app.html?cinv=' || i.token::text;
  v_title := 'You''re invited: ' || coalesce(v_name,'a campaign') || ' 🎯';
  v_body := coalesce(v_brand,'A brand') || ' wants you on ' || coalesce(v_name,'their campaign')
         || case when v_prod is not null then ' (you get: ' || v_prod || ')' else '' end
         || case when i.approved then '. You''re already approved — ' else '. ' end
         || 'Register on Geek OS with WhatsApp' || case when i.phone_e164 is not null then ' (use this number)' else '' end
         || ' to join. Takes 2 minutes.' || case when i.note is not null then ' “' || i.note || '”' else '' end;
  if i.phone_e164 is not null and not exists (select 1 from public.wa_contacts w where w.phone_e164 = i.phone_e164 and w.opt_out_at is not null) then
    insert into intel.ci_outbox(channel, recipient_member_id, to_address, campaign_id, template_key, payload, dedupe_key)
    values ('whatsapp', null, i.phone_e164, i.campaign_id, 'bulk_invite',
            jsonb_build_object('title', v_title, 'text', v_body, 'action_route', v_route, 'action_label', 'Register & join', 'to_name', v_first),
            'binv:' || i.invite_id || ':wa:' || (i.invites_sent + 1));
    v_n := v_n + 1;
  end if;
  if i.email is not null then
    insert into intel.ci_outbox(channel, recipient_member_id, to_address, campaign_id, template_key, payload, dedupe_key)
    values ('email', null, i.email, i.campaign_id, 'bulk_invite',
            jsonb_build_object('subject', v_title, 'html', 'Hi ' || v_first || ', ' || v_body, 'action_route', v_route, 'action_label', 'Register & join'),
            'binv:' || i.invite_id || ':em:' || (i.invites_sent + 1));
    v_n := v_n + 1;
  end if;
  update intel.ci_campaign_invite set invites_sent = invites_sent + 1, last_invited_at = now() where invite_id = p_invite;
  return v_n;
end $$;

-- every open invite that belongs to this member → into the campaign (called on signup / Instagram connect /
-- WhatsApp verified / profile created, and by the app through the invite link)
create or replace function intel.ci_claim_member_invites(p_member uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare r record; v_n int := 0; v_phones text[]; v_emails text[]; v_handles text[]; v_res jsonb;
begin
  if p_member is null then return 0; end if;
  if exists (select 1 from public.members m where m.id = p_member and coalesce(m.role,'creator') <> 'creator') then return 0; end if;
  select array_remove(array[
           (select w.phone_e164 from public.wa_contacts w where w.user_id = p_member),
           (select m.whatsapp_e164 from public.members m where m.id = p_member),
           (select intel.ci_norm_phone(u.phone) from auth.users u where u.id = p_member and coalesce(u.phone,'') <> '')], null) into v_phones;
  select array_remove(array[
           (select lower(u.email::text) from auth.users u where u.id = p_member),
           (select lower(c.email) from private.creator_contact c where c.identity_id = intel.ci_member_identity(p_member))], null) into v_emails;
  select coalesce(array_agg(lower(sa.username)), '{}') into v_handles from public.social_accounts sa
   where sa.member_id = p_member and sa.platform = 'instagram' and coalesce(sa.username,'') <> '';

  for r in select invite_id from intel.ci_campaign_invite
            where claimed_at is null
              and (reserved_by = p_member or phone_e164 = any(v_phones) or lower(email) = any(v_emails) or lower(handle) = any(v_handles))
            order by created_at loop
    begin
      v_res := intel.ci_bulk_attach(r.invite_id, p_member, null);
      if v_res->>'status' = 'joined' then v_n := v_n + 1; end if;
    exception when others then raise warning 'invite claim skipped: %', sqlerrm;
    end;
  end loop;
  return v_n;
end $$;

-- the old Instagram-handle invites now go through the same claim
create or replace function intel.ci_claim_invites(p_member uuid, p_username text)
returns int language plpgsql security definer set search_path = '' as $$
begin return intel.ci_claim_member_invites(p_member); end $$;

create or replace function intel.tg_claim_on_identity()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.access_role = 'self' and new.revoked_at is null then perform intel.ci_claim_member_invites(new.member_id); end if;
  return null;
exception when others then return null;
end $$;
drop trigger if exists ci_claim_on_identity on intel.ci_identity_actor_access;
create trigger ci_claim_on_identity after insert on intel.ci_identity_actor_access
  for each row execute function intel.tg_claim_on_identity();

create or replace function intel.tg_claim_on_wa_contact()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.verified_at is not null and (tg_op = 'INSERT' or new.phone_e164 is distinct from old.phone_e164 or old.verified_at is null) then
    perform intel.ci_claim_member_invites(new.user_id);
  end if;
  return null;
exception when others then return null;
end $$;
drop trigger if exists ci_claim_on_wa_contact on public.wa_contacts;
create trigger ci_claim_on_wa_contact after insert or update on public.wa_contacts
  for each row execute function intel.tg_claim_on_wa_contact();

-- ---------------------------------------------------------------------------------------------------
-- 3) Team side: check the sheet, upload it, follow every row
-- ---------------------------------------------------------------------------------------------------
-- rows: [{name, handle, phone, email, city, followers, approved, extra}]
create or replace function api.bulk_preview(p_campaign uuid, p_rows jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare x jsonb; n int := 0; out jsonb := '[]'::jsonb; v_ph text; v_em text; v_h text; v_m uuid; v_stage text; v_who text;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  p_campaign := intel.ci_resolve_campaign(p_campaign);
  if p_campaign is null then raise exception 'campaign not found — save it first' using errcode = '22023'; end if;
  if not intel.ci_can_manage_campaign(p_campaign) then raise exception 'not your campaign' using errcode = '42501'; end if;
  for x in select * from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) loop
    v_ph := intel.ci_norm_phone(x->>'phone');
    v_em := nullif(lower(btrim(coalesce(x->>'email',''))), ''); if v_em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then v_em := null; end if;
    v_h := intel.ci_norm_handle(x->>'handle');
    v_m := intel.ci_find_creator(v_ph, v_em, v_h); v_stage := null; v_who := null;
    if v_m is not null then
      select coalesce((select '@'||sa.username from public.social_accounts sa where sa.member_id = v_m and sa.platform='instagram' limit 1), m.name)
        into v_who from public.members m where m.id = v_m;
      select p.stage into v_stage from intel.ci_campaign_participation p
       where p.campaign_id = p_campaign and p.identity_id = intel.ci_member_identity(v_m);
    end if;
    out := out || jsonb_build_array(jsonb_build_object('i', n, 'phone', v_ph, 'email', v_em, 'handle', v_h,
      'phone_bad', coalesce(x->>'phone','') <> '' and v_ph is null,
      'email_bad', coalesce(x->>'email','') <> '' and v_em is null,
      'no_contact', v_ph is null and v_em is null and v_h is null,
      'on_platform', v_m is not null, 'who', v_who, 'stage', v_stage));
    n := n + 1;
  end loop;
  return out;
end $$;

create or replace function api.bulk_import_creators(p_campaign uuid, p_rows jsonb, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare x jsonb; v_ph text; v_em text; v_h text; v_m uuid; v_id uuid; v_org uuid; v_batch uuid := gen_random_uuid();
        v_res jsonb; v_added int := 0; v_invited int := 0; v_waiting int := 0; v_skipped int := 0; v_msgs int := 0;
        v_note text := nullif(btrim(coalesce(p_note,'')),''); v_rows jsonb := '[]'::jsonb; v_approved boolean;
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
    v_approved := coalesce((x->>'approved')::boolean, false);
    if v_ph is null and v_em is null and v_h is null then v_skipped := v_skipped + 1; continue; end if;

    -- one row per person per campaign (matched on phone, then email, then Instagram)
    select invite_id into v_id from intel.ci_campaign_invite
     where campaign_id = p_campaign and ((v_ph is not null and phone_e164 = v_ph) or (v_em is not null and lower(email) = v_em)
                                          or (v_h is not null and lower(handle) = v_h))
     order by (phone_e164 = v_ph) desc nulls last limit 1;
    if v_id is null then
      insert into intel.ci_campaign_invite(campaign_id, platform, handle, note, invited_by, org_id, source, full_name, phone_e164, email,
                                           city, followers, extra, approved, batch_id, dm_status)
      values (p_campaign, 'instagram', v_h, v_note, auth.uid(), v_org, 'bulk', nullif(btrim(coalesce(x->>'name','')),''), v_ph, v_em,
              nullif(btrim(coalesce(x->>'city','')),''), nullif(regexp_replace(coalesce(x->>'followers',''), '[^0-9]', '', 'g'),'')::bigint,
              coalesce(x->'extra','{}'::jsonb), v_approved, v_batch, 'manual')
      returning invite_id into v_id;
    else
      update intel.ci_campaign_invite set
        handle = coalesce(handle, v_h), phone_e164 = coalesce(phone_e164, v_ph), email = coalesce(email, v_em),
        full_name = coalesce(nullif(btrim(coalesce(x->>'name','')),''), full_name), city = coalesce(nullif(btrim(coalesce(x->>'city','')),''), city),
        approved = approved or v_approved, note = coalesce(v_note, note), batch_id = v_batch, source = 'bulk'
       where invite_id = v_id;
    end if;

    v_m := intel.ci_find_creator(v_ph, v_em, v_h);
    if v_m is not null then
      v_res := intel.ci_bulk_attach(v_id, v_m, auth.uid());
      if v_res->>'status' = 'joined' then v_added := v_added + 1; else v_waiting := v_waiting + 1; end if;
    else
      if (select invites_sent from intel.ci_campaign_invite where invite_id = v_id) = 0 then
        v_msgs := v_msgs + intel.ci_send_bulk_invite(v_id);
      end if;
      v_invited := v_invited + 1;
    end if;
  end loop;

  insert into public.activity_log(member_id, kind, event, detail)
  values (auth.uid(), 'analytics', 'bulk_creator_upload', jsonb_build_object('campaign', p_campaign, 'added', v_added, 'invited', v_invited,
          'waiting', v_waiting, 'skipped', v_skipped));
  return jsonb_build_object('batch_id', v_batch, 'added', v_added, 'invited', v_invited, 'waiting_profile', v_waiting,
                            'skipped', v_skipped, 'messages', v_msgs);
end $$;

-- every uploaded row, live: invite sent? registered? what's missing? where are they in the process?
create or replace function api.bulk_invites(p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  p_campaign := intel.ci_resolve_campaign(p_campaign);
  if p_campaign is null then return '[]'::jsonb; end if;
  if not intel.ci_can_manage_campaign(p_campaign) then raise exception 'not your campaign' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(row order by (row->>'created_at') desc) from (
    select jsonb_build_object(
      'invite_id', i.invite_id, 'name', i.full_name, 'handle', i.handle, 'phone', i.phone_e164, 'email', i.email, 'city', i.city,
      'followers', i.followers, 'approved', i.approved, 'created_at', i.created_at, 'invites_sent', i.invites_sent,
      'last_invited_at', i.last_invited_at, 'claimed_at', i.claimed_at,
      'member_id', mem.mid,
      'status', case when p.participation_id is not null then 'joined' when mem.mid is not null then 'registered' else 'invited' end,
      'stage', p.stage, 'participation_id', p.participation_id,
      'instagram', (select '@'||sa.username from public.social_accounts sa where sa.member_id = mem.mid and sa.platform='instagram' limit 1),
      'missing', case when mem.mid is null then null
                      when intel.ci_member_identity(mem.mid) is null then jsonb_build_array('Creator profile not started')
                      else intel.ci_profile_requirements(intel.ci_member_identity(mem.mid))->'missing' end,
      'wa', (select jsonb_build_object('status', o.status, 'error', o.last_error, 'at', coalesce(o.sent_at, o.created_at)) from intel.ci_outbox o
              where o.dedupe_key like 'binv:' || i.invite_id || ':wa:%' order by o.created_at desc limit 1),
      'mail', (select jsonb_build_object('status', o.status, 'error', o.last_error, 'at', coalesce(o.sent_at, o.created_at)) from intel.ci_outbox o
              where o.dedupe_key like 'binv:' || i.invite_id || ':em:%' order by o.created_at desc limit 1)) as row
      from intel.ci_campaign_invite i
      left join lateral (select coalesce(i.claimed_by, i.reserved_by, intel.ci_find_creator(i.phone_e164, lower(i.email), lower(i.handle))) as mid) mem on true
      left join intel.ci_campaign_participation p on p.participation_id = i.participation_id
     where i.campaign_id = p_campaign and i.source = 'bulk') s), '[]'::jsonb);
end $$;

create or replace function api.bulk_resend_invite(p_invite uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_camp uuid; v_m uuid; i intel.ci_campaign_invite%rowtype;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  select * into i from intel.ci_campaign_invite where invite_id = p_invite;
  if i.invite_id is null or not intel.ci_can_manage_campaign(i.campaign_id) then raise exception 'not your campaign' using errcode = '42501'; end if;
  if i.claimed_at is not null then return jsonb_build_object('already', 'joined'); end if;
  v_m := intel.ci_find_creator(i.phone_e164, lower(i.email), lower(i.handle));
  if v_m is not null then return coalesce(intel.ci_bulk_attach(p_invite, v_m, auth.uid()), '{}'::jsonb); end if;
  if i.last_invited_at > now() - interval '1 hour' then raise exception 'invited less than an hour ago — give them a little time' using errcode = '22023'; end if;
  return jsonb_build_object('messages', intel.ci_send_bulk_invite(p_invite));
end $$;

create or replace function api.bulk_set_approved(p_invite uuid, p_approved boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare i intel.ci_campaign_invite%rowtype;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  select * into i from intel.ci_campaign_invite where invite_id = p_invite;
  if i.invite_id is null or not intel.ci_can_manage_campaign(i.campaign_id) then raise exception 'not your campaign' using errcode = '42501'; end if;
  update intel.ci_campaign_invite set approved = p_approved where invite_id = p_invite;
  if p_approved and i.participation_id is not null then perform intel.ci_bulk_promote(i.participation_id, auth.uid()); end if;
  return jsonb_build_object('approved', p_approved);
end $$;

create or replace function api.bulk_delete_invite(p_invite uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_camp uuid;
begin
  select campaign_id into v_camp from intel.ci_campaign_invite where invite_id = p_invite;
  if v_camp is null or not intel.ci_can_manage_campaign(v_camp) then raise exception 'not your campaign' using errcode = '42501'; end if;
  delete from intel.ci_campaign_invite where invite_id = p_invite and claimed_at is null;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 4) Creator side: the invite link
-- ---------------------------------------------------------------------------------------------------
-- signed-out: what is this invite for? (shown on the sign-in screen; no personal data)
create or replace function public.invite_preview(p_token uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select (select jsonb_build_object('campaign', c.name, 'brand', coalesce(c.submitted_brand_name, b.name), 'product', c.product,
            'first_name', nullif(split_part(btrim(coalesce(i.full_name,'')), ' ', 1), ''), 'approved', i.approved,
            'phone_hint', case when i.phone_e164 is not null then '••••' || right(i.phone_e164, 4) end,
            'joined', i.claimed_at is not null)
     from intel.ci_campaign_invite i join intel.ci_campaign c on c.campaign_id = i.campaign_id
     left join intel.ci_brand b on b.brand_id = c.brand_id where i.token = p_token) $$;

-- signed-in creator opened the link: the invite is theirs; it joins now (or the moment the profile exists)
create or replace function api.claim_my_invites(p_token uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_n int; v_part uuid; v_waiting int;
begin
  if v_uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  if p_token is not null then
    update intel.ci_campaign_invite set reserved_by = v_uid where token = p_token and claimed_at is null and reserved_by is null;
  end if;
  v_n := intel.ci_claim_member_invites(v_uid);
  select i.participation_id into v_part from intel.ci_campaign_invite i
   where i.claimed_by = v_uid and (p_token is null or i.token = p_token) order by i.claimed_at desc nulls last limit 1;
  select count(*) into v_waiting from intel.ci_campaign_invite where reserved_by = v_uid and claimed_at is null;
  return jsonb_build_object('joined', v_n, 'participation_id', v_part, 'waiting', v_waiting,
    'campaign', (select c.name from intel.ci_campaign_invite i join intel.ci_campaign c on c.campaign_id = i.campaign_id
                  where (i.reserved_by = v_uid or i.claimed_by = v_uid) and (p_token is null or i.token = p_token)
                  order by i.claimed_at desc nulls first, i.created_at desc limit 1));
end $$;

-- invited without approval: "Apply" sends them to screening instead of straight to the contract
create or replace function api.respond_to_campaign(p_participation uuid, p_accept boolean, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_owner uuid; v_uid uuid; v_need boolean;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  v_uid := auth.uid(); v_id := intel.ci_caller_identity();
  select identity_id, needs_approval into v_owner, v_need from intel.ci_campaign_participation where participation_id=p_participation;
  if v_owner is null or v_owner <> v_id then raise exception 'not your campaign participation' using errcode='42501'; end if;
  return jsonb_build_object('stage', intel.ci_participation_advance(p_participation,
    case when not p_accept then 'rejected' when v_need then 'applied' else 'accepted' end, v_uid, p_reason));
end $$;

-- grants
revoke all on function intel.ci_norm_phone(text), intel.ci_norm_handle(text) from public, anon, authenticated;
revoke all on function intel.ci_find_creator(text,text,text), intel.ci_member_identity(uuid), intel.ci_bulk_promote(uuid,uuid),
  intel.ci_bulk_attach(uuid,uuid,uuid), intel.ci_send_bulk_invite(uuid), intel.ci_claim_member_invites(uuid),
  intel.ci_claim_invites(uuid,text), intel.tg_claim_on_identity(), intel.tg_claim_on_wa_contact() from public, anon, authenticated;
revoke all on function api.bulk_preview(uuid,jsonb), api.bulk_import_creators(uuid,jsonb,text), api.bulk_invites(uuid),
  api.bulk_resend_invite(uuid), api.bulk_set_approved(uuid,boolean), api.bulk_delete_invite(uuid), api.claim_my_invites(uuid),
  api.respond_to_campaign(uuid,boolean,text) from public, anon;
grant execute on function api.bulk_preview(uuid,jsonb), api.bulk_import_creators(uuid,jsonb,text), api.bulk_invites(uuid),
  api.bulk_resend_invite(uuid), api.bulk_set_approved(uuid,boolean), api.bulk_delete_invite(uuid), api.claim_my_invites(uuid),
  api.respond_to_campaign(uuid,boolean,text) to authenticated;
revoke all on function public.invite_preview(uuid) from public;
grant execute on function public.invite_preview(uuid) to anon, authenticated;
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
          'invited',     jsonb_build_array('accepted','applied','rejected','dropped'),
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


-- My Campaigns: an invite that still needs the brand's approval shows "Apply" (not "Accept")
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
end $$;
