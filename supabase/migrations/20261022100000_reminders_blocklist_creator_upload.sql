-- 1) No automatic blocklist: only the Super Admin blocks a creator, by hand.
-- 2) Video reminders at 9:00 and 18:30 every day until the video is in — from the product reaching them (or 3 days
--    after it was shipped), getting firmer near the due date, and after the campaign ends a clear warning that they
--    will be put on the blocklist. Nothing is pre-scheduled (that broke when steps were set by hand / by upload).
-- 3) "Joined via": the campaign (or creator upload) that brought each creator onto Geek OS.
-- 4) Creator upload (Super Admin side bar): creators not tied to a campaign — saved to the creator pool, invited to
--    register on WhatsApp + email, reminded twice (day 2, day 5), marked joined once they register.

-- ============================== 1. manual blocklist only ==============================
update intel.ci_reminder set cancelled_at = now()
 where fired_at is null and cancelled_at is null and (kind = 'auto_block' or kind like 'video%');

create or replace function intel.ci_schedule_video_reminders(p_participation uuid, p_from timestamptz default now())
returns int language plpgsql security definer set search_path = '' as $$
begin
  -- video reminders now come from intel.ci_run_video_reminders (9:00 + 18:30); nothing is pre-scheduled
  update intel.ci_reminder set cancelled_at = now()
   where participation_id = p_participation and fired_at is null and cancelled_at is null and (kind like 'video%' or kind = 'auto_block');
  return 0;
end $$;
revoke all on function intel.ci_schedule_video_reminders(uuid, timestamptz) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION intel.ci_run_due_reminders(p_limit integer DEFAULT 200)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r record; v_identity uuid; v_infl uuid; v_name text; v_stage text; v_oper uuid; v_n int := 0;
begin
  if not intel.ci_feature_enabled('operational_pilot') then return 0; end if;
  for r in select * from intel.ci_reminder
            where due_at <= now() and fired_at is null and cancelled_at is null
            order by due_at limit greatest(p_limit,1)
            for update skip locked loop
    select p.identity_id, c.name, p.stage, c.created_by into v_identity, v_name, v_stage, v_oper
      from intel.ci_campaign_participation p join intel.ci_campaign c on c.campaign_id = p.campaign_id
     where p.participation_id = r.participation_id;
    -- a video reminder is pointless once the video is in (or the creator left the campaign)
    if (r.kind like 'video%' or r.kind = 'auto_block')
       and coalesce(v_stage,'') not in ('product_sent','content_created','changes_requested') then
      update intel.ci_reminder set cancelled_at = now() where reminder_id = r.reminder_id;
      continue;
    end if;
    v_infl := intel.ci_member_of_identity(v_identity);
    if r.kind = 'auto_block' or r.kind like 'video%' then
      -- no automatic blocking any more (the Super Admin blocks by hand); video reminders come from ci_run_video_reminders
      update intel.ci_reminder set cancelled_at = now() where reminder_id = r.reminder_id;
      continue;
    else
      perform intel.ci_notify(v_infl, r.campaign_id, r.participation_id, r.template_key,
        jsonb_build_object('campaign', coalesce(v_name,'your campaign'), 'participation_id', coalesce(r.participation_id::text,'')));
    end if;
    update intel.ci_reminder set fired_at = now() where reminder_id = r.reminder_id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $function$;

CREATE OR REPLACE FUNCTION api.blacklist_creator(p_participation uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_camp uuid; v_identity uuid; v_handle text; v_org uuid; v_id uuid;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  select p.campaign_id, p.identity_id into v_camp, v_identity from intel.ci_campaign_participation p where p.participation_id = p_participation;
  if v_camp is null then raise exception 'not found' using errcode = 'P0002'; end if;
  if not public.is_platform_admin() then raise exception 'Only the Super Admin can blocklist a creator.' using errcode = '42501'; end if;
  if coalesce(btrim(p_reason),'') = '' then raise exception 'add a reason' using errcode = '22023'; end if;
  select lower(sa.username) into v_handle from intel.ci_identity_actor_access a
    join public.social_accounts sa on sa.member_id = a.member_id and sa.platform = 'instagram'
   where a.identity_id = v_identity and a.access_role = 'self' and a.revoked_at is null limit 1;
  select c.org_id into v_org from intel.ci_campaign c where c.campaign_id = v_camp;
  insert into intel.ci_creator_blacklist(identity_id, handle, reason, campaign_id, org_id, added_by)
  values (v_identity, v_handle, btrim(p_reason), v_camp, v_org, auth.uid()) returning blacklist_id into v_id;
  begin perform intel.ci_participation_advance(p_participation, 'dropped', auth.uid(), 'Blacklisted — ' || btrim(p_reason));
  exception when others then null; end;
  return jsonb_build_object('blacklist_id', v_id);
end $function$;

-- ============================== 2. video reminders, 9:00 + 18:30 ==============================
insert into intel.ci_notification_template(template_key, kind, title, body_md, action_route, action_label, active)
values ('video_blacklist_warning', 'action_required', '⚠️ {{campaign}} has ended — submit your video',
  'The campaign **{{campaign}}** has ended and your video has not been received. As per your signed contract, creators who receive the product and do not deliver are added to the blocklist and do not get future campaigns. Please submit your video in the app today.',
  'mycampaigns', 'Submit video', true)
on conflict (template_key) do update set title = excluded.title, body_md = excluded.body_md, active = true;

insert into intel.ci_step_wa(template_key, wa_template, body, update_text) values
('video_blacklist_warning', 'geek_step_video_final', 'Hi *{{1}}*,

Thank you for being part of the campaign *{{2}}* with *{{3}}*. The campaign has ended and your video has not been received yet.

As per the contract you signed, if the video is not submitted, your account will be added to the blocklist and you will not get future campaigns.

Next, please submit your video link on the app today.

Submit your video here: {{4}}

Thank you!
Team Geek Animals', null)
on conflict (template_key) do update set wa_template = excluded.wa_template, body = excluded.body;
insert into private.ci_step_wa_status(wa_template, status) values ('geek_step_video_final', 'queued') on conflict (wa_template) do nothing;

create table if not exists private.ci_video_nudge (
  participation_id uuid not null,
  slot_at timestamptz not null,
  template_key text not null,
  created_at timestamptz not null default now(),
  primary key (participation_id, slot_at)
);
alter table private.ci_video_nudge enable row level security;
revoke all on private.ci_video_nudge from public, anon, authenticated;

-- one run = one slot (9:00 or 18:30 IST). Who: has the product (delivered, or shipped 3+ days ago), no video yet,
-- not blocked, campaign not cancelled, and not more than 30 days past the campaign end.
create or replace function intel.ci_run_video_reminders()
returns int language plpgsql security definer set search_path = '' as $$
declare r record; v_slot timestamptz; v_today date := (now() at time zone 'Asia/Kolkata')::date; v_key text; v_n int := 0;
        v_final_ok boolean;
begin
  if not intel.ci_feature_enabled('operational_pilot') then return 0; end if;
  v_slot := date_trunc('hour', now()) + case when extract(minute from now()) >= 30 then interval '30 minutes' else interval '0' end;
  v_final_ok := exists (select 1 from private.ci_step_wa_status s where s.wa_template = 'geek_step_video_final' and s.status = 'approved');
  for r in
    select p.participation_id, p.campaign_id, p.stage, intel.ci_member_of_identity(p.identity_id) as member, c.name, c.ends_on,
           coalesce((select min(d.expected_by) from intel.ci_campaign_deliverable d where d.participation_id = p.participation_id),
                    ((coalesce(sh.delivered_at, sh.shipped_at + interval '3 days') at time zone 'Asia/Kolkata')::date
                      + coalesce((select k.content_days from intel.ci_campaign_contract k where k.participation_id = p.participation_id), 7))) as due_on
      from intel.ci_campaign_participation p
      join intel.ci_campaign c on c.campaign_id = p.campaign_id
      left join lateral (select s.status, s.shipped_at, s.delivered_at from intel.ci_campaign_shipment s
                          where s.participation_id = p.participation_id order by s.created_at desc limit 1) sh on true
     where p.blocked_at is null
       and c.lifecycle_status <> 'cancelled'
       and (c.ends_on is null or c.ends_on >= v_today - 30)
       and (p.stage in ('content_created','changes_requested')
            or (p.stage = 'product_sent' and (sh.status = 'delivered' or sh.shipped_at < now() - interval '3 days')))
       and not exists (select 1 from intel.ci_creator_blacklist b where b.identity_id = p.identity_id and b.lifted_at is null)
  loop
    continue when r.member is null;
    v_key := case
      when r.ends_on is not null and r.ends_on < v_today then case when v_final_ok then 'video_blacklist_warning' else 'video_warning' end
      when r.due_on is not null and r.due_on < v_today then 'video_warning'
      when r.due_on is not null and r.due_on <= v_today + 1 then 'video_final_warning'
      when r.due_on is not null and r.due_on <= v_today + 2 then 'video_due'
      else 'video_nudge' end;
    begin
      insert into private.ci_video_nudge(participation_id, slot_at, template_key) values (r.participation_id, v_slot, v_key);
    exception when unique_violation then continue; end;
    begin
      perform intel.ci_notify(r.member, r.campaign_id, r.participation_id, v_key,
        jsonb_build_object('campaign', coalesce(r.name, 'your campaign'), 'participation_id', r.participation_id::text,
                           'due', coalesce(to_char(r.due_on, 'DD Mon'), '')));
      insert into intel.ci_reminder(participation_id, campaign_id, kind, template_key, due_at, fired_at)
      values (r.participation_id, r.campaign_id, 'video_slot', v_key, now(), now());
      v_n := v_n + 1;
    exception when others then raise warning 'video reminder skipped: %', sqlerrm; end;
  end loop;
  return v_n;
end $$;
revoke all on function intel.ci_run_video_reminders() from public, anon, authenticated;

-- ============================== 4. creator upload (no campaign) ==============================
create table if not exists intel.ci_creator_upload (
  id uuid primary key default gen_random_uuid(),
  org_id uuid,
  uploaded_by uuid,
  batch_id uuid,
  full_name text,
  handle text,
  phone_e164 text,
  email text,
  city text,
  state text,
  followers bigint,
  category text,
  note text,
  invites_sent int not null default 0,
  last_invited_at timestamptz,
  joined_member uuid,
  joined_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists ci_creator_upload_phone on intel.ci_creator_upload(phone_e164) where phone_e164 is not null;
create unique index if not exists ci_creator_upload_handle on intel.ci_creator_upload(handle) where handle is not null;
create unique index if not exists ci_creator_upload_email on intel.ci_creator_upload(lower(email)) where email is not null;
alter table intel.ci_creator_upload enable row level security;
revoke all on intel.ci_creator_upload from public, anon, authenticated;

-- ============================== 3. joined via ==============================
create or replace function intel.ci_joined_via(p_identity uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  with m as (select intel.ci_member_of_identity(p_identity) as id),
  src as (
    select 1 o, i.claimed_at at, c.name campaign, case when i.source in ('bulk','sheet','upload') then 'bulk upload' else 'invite' end how
      from intel.ci_campaign_invite i join intel.ci_campaign c on c.campaign_id = i.campaign_id, m
     where i.claimed_by = m.id and i.claimed_at is not null
    union all
    select 3, u.joined_at, null, 'creator upload' from intel.ci_creator_upload u, m where u.joined_member = m.id
    union all
    select 2, p.created_at, c.name, case when p.stage = 'invited' or p.invited_at is not null then 'invite' else 'applied' end
      from intel.ci_campaign_participation p join intel.ci_campaign c on c.campaign_id = p.campaign_id where p.identity_id = p_identity)
  select jsonb_strip_nulls(jsonb_build_object('campaign', campaign, 'how', how, 'at', at))
    from src order by at nulls last, o limit 1 $$;
revoke all on function intel.ci_joined_via(uuid) from public, anon, authenticated;

insert into intel.ci_step_wa(template_key, wa_template, body, update_text) values
('join_invite', 'geek_join_invite', 'Hi *{{1}}*,

Thank you for your interest in working with *{{2}}*. Your profile has been added to our creator network for upcoming brand campaigns.

Next, please register on the Geek app with this WhatsApp number and connect your Instagram. Once that is done, you will start getting campaigns that match your profile.

Register here: {{3}}

Thank you!
Team Geek Animals', null)
on conflict (template_key) do update set wa_template = excluded.wa_template, body = excluded.body;
insert into private.ci_step_wa_status(wa_template, status) values ('geek_join_invite', 'queued') on conflict (wa_template) do nothing;

create or replace function intel.ci_send_join_invite(p_id uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare u intel.ci_creator_upload%rowtype; v_first text; v_n int := 0; v_mail text; v_from text := 'Geek Creative Agency';
begin
  select * into u from intel.ci_creator_upload where id = p_id;
  if u.id is null or u.joined_member is not null then return 0; end if;
  v_first := coalesce(nullif(split_part(btrim(coalesce(u.full_name,'')), ' ', 1), ''), case when u.handle is not null then '@' || u.handle end, 'there');
  v_mail := 'Hi ' || v_first || E',\n\nThank you for your interest in working with ' || v_from
         || E'. Your profile has been added to our creator network for upcoming brand campaigns.\n\nNext, please register on the Geek app with your WhatsApp number and connect your Instagram. Once that is done, you will start getting campaigns that match your profile.'
         || E'\n\nClick the button below to register.';
  if u.phone_e164 is not null and not exists (select 1 from public.wa_contacts w where w.phone_e164 = u.phone_e164 and w.opt_out_at is not null) then
    insert into intel.ci_outbox(channel, recipient_member_id, to_address, campaign_id, template_key, payload, dedupe_key)
    values ('whatsapp', null, u.phone_e164, null, 'join_invite',
            jsonb_build_object('title', 'Join Geek Creative Agency', 'text', v_mail, 'action_route', '/app.html', 'action_label', 'Register', 'to_name', v_first,
                               'force_template', true, 'wa_template', 'geek_join_invite', 'wa_lang', 'en',
                               'wa_vars', jsonb_build_array(v_first, v_from, 'LINK')),
            'join:' || u.id || ':wa:' || (u.invites_sent + 1));
    v_n := v_n + 1;
  end if;
  if u.email is not null then
    insert into intel.ci_outbox(channel, recipient_member_id, to_address, campaign_id, template_key, payload, dedupe_key)
    values ('email', null, u.email, null, 'join_invite',
            jsonb_build_object('subject', 'Join the Geek creator network', 'html', v_mail, 'to_name', v_first, 'action_route', '/app.html', 'action_label', 'Register'),
            'join:' || u.id || ':em:' || (u.invites_sent + 1));
    v_n := v_n + 1;
  end if;
  if v_n > 0 then update intel.ci_creator_upload set invites_sent = invites_sent + 1, last_invited_at = now() where id = p_id; end if;
  return v_n;
end $$;
revoke all on function intel.ci_send_join_invite(uuid) from public, anon, authenticated;

-- check who registered since (phone / email / Instagram) and mark them joined
create or replace function intel.ci_creator_upload_sync()
returns int language plpgsql security definer set search_path = '' as $$
declare r record; v_m uuid; v_n int := 0;
begin
  for r in select * from intel.ci_creator_upload where joined_member is null loop
    v_m := intel.ci_find_creator(r.phone_e164, lower(r.email), lower(r.handle));
    if v_m is not null then update intel.ci_creator_upload set joined_member = v_m, joined_at = now() where id = r.id; v_n := v_n + 1; end if;
  end loop;
  return v_n;
end $$;
revoke all on function intel.ci_creator_upload_sync() from public, anon, authenticated;

create or replace function api.creator_upload(p_rows jsonb, p_send boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare x jsonb; v_uid uuid := auth.uid(); v_org uuid; v_batch uuid := gen_random_uuid(); v_phone text; v_email text; v_handle text;
        v_id uuid; v_m uuid; v_added int := 0; v_upd int := 0; v_joined int := 0; v_sent int := 0; v_skip int := 0; v_new boolean;
begin
  if not public.is_platform_admin() then raise exception 'Only the Super Admin can upload creators here.' using errcode = '42501'; end if;
  select org_id into v_org from public.members where id = v_uid;
  for x in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_phone := intel.ci_e164(nullif(btrim(coalesce(x->>'phone','')), ''));
    v_email := lower(nullif(btrim(coalesce(x->>'email','')), '')); if v_email !~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' then v_email := null; end if;
    v_handle := intel.ci_norm_handle(x->>'handle');
    if v_phone is null and v_email is null and v_handle is null then v_skip := v_skip + 1; continue; end if;
    select id into v_id from intel.ci_creator_upload
     where (v_phone is not null and phone_e164 = v_phone) or (v_handle is not null and handle = v_handle) or (v_email is not null and lower(email) = v_email)
     limit 1;
    v_new := v_id is null;
    if v_new then
      insert into intel.ci_creator_upload(org_id, uploaded_by, batch_id, full_name, handle, phone_e164, email, city, state, followers, category, note)
      values (v_org, v_uid, v_batch, nullif(btrim(x->>'name'),''), v_handle, v_phone, v_email, nullif(btrim(x->>'city'),''), nullif(btrim(x->>'state'),''),
              nullif(regexp_replace(coalesce(x->>'followers',''), '[^0-9]', '', 'g'), '')::bigint, nullif(btrim(x->>'category'),''), nullif(btrim(x->>'note'),''))
      on conflict do nothing returning id into v_id;
      if v_id is null then v_skip := v_skip + 1; continue; end if;
      v_added := v_added + 1;
    else
      update intel.ci_creator_upload set full_name = coalesce(full_name, nullif(btrim(x->>'name'),'')), handle = coalesce(handle, v_handle),
             phone_e164 = coalesce(phone_e164, v_phone), email = coalesce(email, v_email), city = coalesce(nullif(btrim(x->>'city'),''), city),
             state = coalesce(nullif(btrim(x->>'state'),''), state),
             followers = coalesce(nullif(regexp_replace(coalesce(x->>'followers',''), '[^0-9]', '', 'g'), '')::bigint, followers),
             category = coalesce(nullif(btrim(x->>'category'),''), category)
       where id = v_id;
      v_upd := v_upd + 1;
    end if;
    -- in discovery too (so they can be matched to campaigns)
    if v_handle is not null then
      begin
        insert into intel.ci_external_creator(platform, handle, display_name, followers, city, sources, found_by_org, first_seen_at, last_seen_at)
        values ('instagram', v_handle, nullif(btrim(x->>'name'),''), nullif(regexp_replace(coalesce(x->>'followers',''), '[^0-9]', '', 'g'), '')::int,
                nullif(btrim(x->>'city'),''), array['creator_upload'], v_org, now(), now())
        on conflict (platform, handle) do update set last_seen_at = now(),
          followers = coalesce(intel.ci_external_creator.followers, excluded.followers), city = coalesce(intel.ci_external_creator.city, excluded.city),
          sources = case when 'creator_upload' = any(intel.ci_external_creator.sources) then intel.ci_external_creator.sources else intel.ci_external_creator.sources || array['creator_upload'] end;
      exception when others then null; end;
    end if;
    v_m := intel.ci_find_creator(v_phone, v_email, v_handle);
    if v_m is not null then
      update intel.ci_creator_upload set joined_member = v_m, joined_at = coalesce(joined_at, now()) where id = v_id and joined_member is null;
      v_joined := v_joined + 1;
    elsif p_send and v_new then
      v_sent := v_sent + (case when intel.ci_send_join_invite(v_id) > 0 then 1 else 0 end);
    end if;
  end loop;
  return jsonb_build_object('added', v_added, 'updated', v_upd, 'already_on_geek', v_joined, 'invited', v_sent, 'skipped', v_skip, 'batch_id', v_batch);
end $$;
revoke all on function api.creator_upload(jsonb, boolean) from public, anon;
grant execute on function api.creator_upload(jsonb, boolean) to authenticated;

create or replace function api.creator_upload_list(p_q text default null, p_status text default 'all', p_limit int default 300)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_q text := nullif(lower(btrim(coalesce(p_q,''))), '');
begin
  if not public.is_platform_admin() then raise exception 'Super Admin only' using errcode = '42501'; end if;
  perform intel.ci_creator_upload_sync();
  return jsonb_build_object(
    'total', (select count(*) from intel.ci_creator_upload),
    'joined', (select count(*) from intel.ci_creator_upload where joined_member is not null),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.full_name, 'handle', u.handle, 'phone', u.phone_e164, 'email', u.email,
               'city', u.city, 'state', u.state, 'followers', u.followers, 'category', u.category, 'invites_sent', u.invites_sent,
               'last_invited_at', u.last_invited_at, 'joined', u.joined_member is not null, 'joined_at', u.joined_at, 'created_at', u.created_at,
               'member_name', (select m.name from public.members m where m.id = u.joined_member),
               'last_wa', (select jsonb_build_object('status', o.status, 'error', o.last_error, 'at', coalesce(o.sent_at, o.created_at))
                             from intel.ci_outbox o where o.template_key = 'join_invite' and o.channel = 'whatsapp' and o.to_address = u.phone_e164
                             order by o.created_at desc limit 1))
             order by u.created_at desc)
        from (select * from intel.ci_creator_upload x
               where (v_q is null or lower(concat_ws(' ', x.full_name, x.handle, x.phone_e164, x.email, x.city, x.category)) like '%' || v_q || '%')
                 and (coalesce(p_status,'all') = 'all' or (p_status = 'joined' and x.joined_member is not null) or (p_status = 'waiting' and x.joined_member is null))
               order by x.created_at desc limit greatest(10, least(coalesce(p_limit,300), 1000))) u), '[]'::jsonb));
end $$;
revoke all on function api.creator_upload_list(text, text, int) from public, anon;
grant execute on function api.creator_upload_list(text, text, int) to authenticated;

create or replace function api.creator_upload_resend(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u intel.ci_creator_upload%rowtype;
begin
  if not public.is_platform_admin() then raise exception 'Super Admin only' using errcode = '42501'; end if;
  select * into u from intel.ci_creator_upload where id = p_id;
  if u.id is null then raise exception 'not found' using errcode = 'P0002'; end if;
  if u.joined_member is not null then return jsonb_build_object('status', 'joined'); end if;
  if u.last_invited_at > now() - interval '2 minutes' then raise exception 'Sent just now — wait a couple of minutes.' using errcode = '22023'; end if;
  return jsonb_build_object('messages', intel.ci_send_join_invite(p_id));
end $$;
revoke all on function api.creator_upload_resend(uuid) from public, anon;
grant execute on function api.creator_upload_resend(uuid) to authenticated;

create or replace function api.creator_upload_delete(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then raise exception 'Super Admin only' using errcode = '42501'; end if;
  delete from intel.ci_creator_upload where id = p_id;
end $$;
revoke all on function api.creator_upload_delete(uuid) from public, anon;
grant execute on function api.creator_upload_delete(uuid) to authenticated;

-- reminders for creator uploads: 9:00 on day 2 and day 5 after the first message, then stop
create or replace function intel.ci_run_join_reminders()
returns int language plpgsql security definer set search_path = '' as $$
declare r record; v_n int := 0;
begin
  perform intel.ci_creator_upload_sync();
  for r in select id from intel.ci_creator_upload
            where joined_member is null and invites_sent between 1 and 2
              and last_invited_at < now() - case when invites_sent = 1 then interval '40 hours' else interval '70 hours' end loop
    v_n := v_n + intel.ci_send_join_invite(r.id);
  end loop;
  return v_n;
end $$;
revoke all on function intel.ci_run_join_reminders() from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('ci-video-am', '30 3 * * *', $c$select intel.ci_run_video_reminders()$c$);
    perform cron.schedule('ci-video-pm', '0 13 * * *', $c$select intel.ci_run_video_reminders()$c$);
    perform cron.schedule('ci-join-reminders', '32 3 * * *', $c$select intel.ci_run_join_reminders()$c$);
  end if;
exception when others then raise notice 'cron schedule skipped: %', sqlerrm;
end $$;

CREATE OR REPLACE FUNCTION api.admin_creator_full(p_participation uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare p intel.ci_campaign_participation%rowtype; v_id uuid; v_mid uuid;
begin
  select * into p from intel.ci_campaign_participation where participation_id = p_participation;
  if p.participation_id is null then raise exception 'not found' using errcode = 'P0002'; end if;
  if not (public.is_platform_admin() or intel.ci_is_agency_operator() or intel.ci_can_manage_participation(p_participation)) then
    raise exception 'not your campaign' using errcode = '42501'; end if;
  v_id := p.identity_id; v_mid := intel.ci_member_of_identity(v_id);
  return jsonb_build_object(
    'member_id', v_mid,
    'name', (select m.name from public.members m where m.id = v_mid),
    'login_email', (select nullif(u.email::text,'') from auth.users u where u.id = v_mid and u.email !~* '@creators\.bountythreads\.app$'),
    'whatsapp', (select jsonb_build_object('phone', w.phone_e164, 'verified', w.verified_at is not null, 'opted_out', w.opt_out_at is not null)
                   from public.wa_contacts w where w.user_id = v_mid order by w.verified_at desc nulls last limit 1),
    'personal', (select to_jsonb(x) - 'identity_id' - 'first_name_confirmed_at' - 'last_name_confirmed_at' - 'created_at' - 'updated_at'
                   from private.creator_personal_profile x where x.identity_id = v_id),
    'contact', (select to_jsonb(x) - 'identity_id' - 'comm_consent_version' - 'comm_consent_purpose' - 'created_at' - 'updated_at'
                  from private.creator_contact x where x.identity_id = v_id),
    'campaign_address_id', p.shipping_address_id,
    'addresses', coalesce((select jsonb_agg(to_jsonb(a) - 'identity_id' - 'deleted_at' - 'updated_at' order by (a.address_id = p.shipping_address_id) desc, a.is_default desc, a.created_at)
                             from private.creator_address a where a.identity_id = v_id and a.deleted_at is null), '[]'::jsonb),
    'professional', (select to_jsonb(x) - 'identity_id' - 'created_at' - 'updated_at' from intel.ci_creator_professional_profile x where x.identity_id = v_id),
    'skills', coalesce((select jsonb_agg(jsonb_build_object('key', s.skill_key, 'level', s.skill_level, 'years', s.years_experience, 'link', s.portfolio_link) order by s.skill_key)
                          from intel.ci_creator_skill s where s.identity_id = v_id), '[]'::jsonb),
    'resources', coalesce((select jsonb_agg(r.resource_key order by r.resource_key) from intel.ci_creator_resource r where r.identity_id = v_id), '[]'::jsonb),
    'commercial', (select to_jsonb(x) - 'identity_id' - 'created_at' - 'updated_at' - 'last_confirmed_at' from intel.ci_creator_commercial_preference x where x.identity_id = v_id),
    'rates', coalesce((select jsonb_agg(jsonb_build_object('type', ri.deliverable_type, 'amount', ri.amount, 'currency', rc.currency, 'negotiable', rc.negotiable,
                          'notes', ri.notes) order by ri.amount)
                         from intel.ci_creator_rate_card rc join intel.ci_creator_rate_card_item ri on ri.rate_card_id = rc.rate_card_id
                        where rc.identity_id = v_id), '[]'::jsonb),
    'brands_worked', coalesce((select jsonb_agg(jsonb_build_object('brand', coalesce(b.submitted_brand_name, (select br.name from intel.ci_brand br where br.brand_id = b.brand_id)),
                          'type', b.relationship_type, 'pay', b.compensation_type, 'from', b.start_date, 'to', b.end_date) order by b.start_date desc nulls last)
                         from intel.ci_creator_brand_experience b where b.identity_id = v_id and b.creator_rejected_at is null), '[]'::jsonb),
    'dream_brands', coalesce((select jsonb_agg(coalesce(d.submitted_brand_name, (select br.name from intel.ci_brand br where br.brand_id = d.brand_id)) order by d.priority_rank nulls last)
                         from intel.ci_creator_brand_aspiration d where d.identity_id = v_id and d.active), '[]'::jsonb),
    'travelling', (select jsonb_build_object('city', t.city, 'state', t.state, 'country', t.country, 'until', t.until_date)
                     from intel.ci_creator_travel t where t.identity_id = v_id and (t.until_date is null or t.until_date >= current_date) limit 1),
    'campaigns', coalesce((select jsonb_agg(jsonb_build_object('campaign', c.name, 'brand', c.submitted_brand_name, 'stage', x.stage, 'at', x.created_at,
                          'this', x.participation_id = p_participation) order by x.created_at desc)
                         from intel.ci_campaign_participation x join intel.ci_campaign c on c.campaign_id = x.campaign_id where x.identity_id = v_id), '[]'::jsonb),
    'blacklisted', exists (select 1 from intel.ci_creator_blacklist b where b.identity_id = v_id and b.lifted_at is null),
    'joined_via', intel.ci_joined_via(v_id));
end $function$;
