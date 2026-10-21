-- WhatsApp help bot for creators (replies on the snapto number when the team has not replied).
--
--  • Every creator message that reaches wa-webhook (snapto "Meta Webhooks" → wa-webhook) is queued here.
--  • After a short wait (default 2 min) the bot answers — only if nobody from the team has replied to that number
--    in the last few hours (default 6 h). Team replies are seen from WhatsApp's own delivery statuses: a free-form
--    ("service") message to that number that the system / bot did not send = a person replied from the snapto inbox
--    or the app inbox → the bot stays quiet for that number.
--  • The answer is built from LIVE data for that phone number: is it registered, what is still missing (Instagram /
--    WhatsApp), every campaign it is in (stage, what is stuck, next step, deadline, courier, posts left) and bulk
--    invites for numbers that have not registered yet (with their join link). Nothing about anyone else is used.
--  • "Talk to the team" / anything the bot cannot answer → it says the team will reply, alerts the team and goes
--    quiet for that number.
--  Super Admin: on/off, wait, quiet hours, pause per number, and the log of every reply.

-- ---------------------------------------------------------------------------------------------------
-- tables
-- ---------------------------------------------------------------------------------------------------
create table if not exists private.wa_bot_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  reply_delay_min int not null default 2 check (reply_delay_min between 0 and 60),
  team_pause_hours int not null default 6 check (team_pause_hours between 1 and 72),
  use_ai boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into private.wa_bot_settings(id) values (true) on conflict do nothing;

create table if not exists private.wa_bot_job (
  job_id uuid primary key default gen_random_uuid(),
  phone_e164 text not null,
  wa_message_ids text[] not null default '{}',
  question text not null,
  received_at timestamptz not null default now(),
  due_at timestamptz not null default now(),
  status text not null default 'queued' check (status in ('queued','working','sent','skipped','failed')),
  reason text,
  reply text,
  sent_refs text[] not null default '{}',
  images int not null default 0,
  intent text,
  campaign_id uuid,
  handoff boolean not null default false,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  done_at timestamptz
);
create index if not exists wa_bot_job_due on private.wa_bot_job(status, due_at);
create index if not exists wa_bot_job_phone on private.wa_bot_job(phone_e164, created_at desc);
create index if not exists wa_bot_job_refs on private.wa_bot_job using gin (sent_refs);

create table if not exists private.wa_bot_pause (
  phone_e164 text primary key,
  until timestamptz not null,
  reason text not null default 'manual',      -- manual | team_reply | handoff
  set_by uuid,
  set_at timestamptz not null default now()
);

-- every message WhatsApp says went OUT from our number (status webhooks) — used to see team replies
create table if not exists private.wa_outbound_seen (
  wa_message_id text primary key,
  phone_e164 text not null,
  category text,
  seen_at timestamptz not null default now()
);
create index if not exists wa_outbound_seen_phone on private.wa_outbound_seen(phone_e164, seen_at desc);

alter table private.wa_bot_settings enable row level security;
alter table private.wa_bot_job enable row level security;
alter table private.wa_bot_pause enable row level security;
alter table private.wa_outbound_seen enable row level security;
revoke all on private.wa_bot_settings, private.wa_bot_job, private.wa_bot_pause, private.wa_outbound_seen from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------------------------------------
create or replace function intel.ci_e164(p_raw text)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_raw is null or btrim(p_raw) = '' then null
    when btrim(p_raw) like '+%' then '+' || regexp_replace(p_raw, '\D', '', 'g')
    when length(regexp_replace(p_raw, '\D', '', 'g')) = 10 then '+91' || regexp_replace(p_raw, '\D', '', 'g')
    when length(regexp_replace(p_raw, '\D', '', 'g')) = 11 and regexp_replace(p_raw, '\D', '', 'g') like '0%'
      then '+91' || right(regexp_replace(p_raw, '\D', '', 'g'), 10)
    else '+' || regexp_replace(p_raw, '\D', '', 'g') end $$;

-- did a PERSON from the team message this number since p_since? (free-form outbound not sent by the system/bot)
create or replace function intel.ci_bot_team_replied_at(p_phone text, p_since timestamptz)
returns timestamptz language sql stable security definer set search_path = '' as $$
  select max(o.seen_at) from private.wa_outbound_seen o
   where o.phone_e164 = p_phone and o.seen_at >= p_since
     and coalesce(nullif(o.category, ''), 'service') = 'service'
     and not exists (select 1 from intel.ci_outbox x where x.provider_ref = o.wa_message_id)
     and not exists (select 1 from private.wa_bot_job j where j.sent_refs @> array[o.wa_message_id])
     -- safety net when the provider gave no message id: an outbound right around the bot's own reply is the bot's
     and not exists (select 1 from private.wa_bot_job j where j.phone_e164 = o.phone_e164 and j.status = 'sent'
                        and cardinality(j.sent_refs) = 0 and o.seen_at between j.done_at - interval '2 minutes' and j.done_at + interval '3 minutes')
     and not exists (select 1 from public.wa_messages m where m.wa_message_id = o.wa_message_id and m.sender_user_id is null) $$;

-- what one phone number is in, LIVE (registered account → its campaigns; else its bulk invites)
create or replace function intel.ci_bot_context(p_phone text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_phone text := intel.ci_e164(p_phone); v_uid uuid; v_name text; v_role text; v_status text; v_camps jsonb := '[]'::jsonb; v_k jsonb := '{}'::jsonb;
        v_needs jsonb := '[]'::jsonb; v_inv jsonb; v_old_sub text; v_old_claims text; r jsonb; v_url text;
begin
  if v_phone is null then return jsonb_build_object('phone', null, 'registered', false); end if;
  select w.user_id into v_uid from public.wa_contacts w where w.phone_e164 = v_phone order by (w.verified_at is not null) desc, w.updated_at desc limit 1;
  if v_uid is null then
    select u.id into v_uid from auth.users u where u.phone is not null and regexp_replace(u.phone, '\D', '', 'g') = ltrim(v_phone, '+') limit 1;
  end if;
  if v_uid is null then
    select mm.id into v_uid from public.members mm where mm.whatsapp_e164 = v_phone limit 1;
  end if;
  if v_uid is not null then
    select mm.name, mm.role, mm.status into v_name, v_role, v_status from public.members mm where mm.id = v_uid;
    v_needs := intel.ci_join_needs(v_uid);
    -- read the campaigns exactly as the creator sees them in the app (same function, as that creator)
    v_old_sub := current_setting('request.jwt.claim.sub', true);
    v_old_claims := current_setting('request.jwt.claims', true);
    perform set_config('request.jwt.claim.sub', v_uid::text, true);
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
    begin
      v_camps := coalesce(api.get_my_campaigns(), '[]'::jsonb);
    exception when others then v_camps := '[]'::jsonb; end;
    -- contract + what is pending, for every campaign still running
    for r in select x from jsonb_array_elements(v_camps) x
              where coalesce(x->>'stage','') not in ('completed','rejected','ineligible','brand_declined','dropped') limit 6 loop
      begin
        v_k := v_k || jsonb_build_object(r->>'participation_id', jsonb_build_object(
                 'contract', api.get_my_contract((r->>'participation_id')::uuid),
                 'pending', intel.ci_pending_action((r->>'participation_id')::uuid),
                 'progress', intel.ci_deliverables_progress((r->>'participation_id')::uuid)));
      exception when others then null; end;
    end loop;
    perform set_config('request.jwt.claim.sub', coalesce(v_old_sub, ''), true);
    perform set_config('request.jwt.claims', coalesce(v_old_claims, ''), true);
  end if;

  -- bulk-upload rows for this number the creator has not joined yet (unregistered, or registered on another number)
  select coalesce(jsonb_agg(jsonb_build_object(
      'invite_id', i.invite_id, 'campaign_id', c.campaign_id, 'campaign', c.name,
      'brand', coalesce(c.submitted_brand_name, b.name), 'product', c.product,
      'name', nullif(btrim(coalesce(i.full_name,'')), ''), 'status', coalesce(i.status, case when i.approved then 'approved' else 'registered' end),
      'approved', i.approved, 'courier', i.courier, 'tracking_ref', i.tracking_ref, 'tracking_url', i.tracking_url,
      'video_url', i.video_url, 'posts', cardinality(i.post_links), 'ends_on', c.ends_on,
      'join_path', '/app.html?cinv=' || i.token) order by i.created_at desc), '[]'::jsonb)
    into v_inv
    from intel.ci_campaign_invite i
    join intel.ci_campaign c on c.campaign_id = i.campaign_id
    left join intel.ci_brand b on b.brand_id = c.brand_id
   where i.phone_e164 = v_phone and i.claimed_by is null
     and coalesce(c.lifecycle_status, '') not in ('archived','cancelled','deleted');

  select s.app_url into v_url from public.wa_settings s order by s.updated_at desc nulls last limit 1;
  return jsonb_build_object(
    'phone', v_phone, 'registered', v_uid is not null, 'user_id', v_uid,
    'name', coalesce(v_name, (select x->>'name' from jsonb_array_elements(v_inv) x where x->>'name' is not null limit 1)),
    'role', v_role, 'account_status', v_status, 'needs', v_needs,
    'campaigns', v_camps, 'extra', v_k, 'invites', v_inv, 'app_url', v_url);
end $$;
revoke all on function intel.ci_bot_context(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------
-- wa-webhook → queue (inbound) and outbound statuses
-- ---------------------------------------------------------------------------------------------------
create or replace function api.ops_bot_inbound(p_phone text, p_wamid text, p_text text, p_type text default 'text')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s private.wa_bot_settings; v_phone text := intel.ci_e164(p_phone); v_job uuid; v_txt text := left(btrim(coalesce(p_text, '')), 1500);
begin
  select * into s from private.wa_bot_settings where id;
  if s.id is null or not s.enabled then return jsonb_build_object('queued', false, 'why', 'bot off'); end if;
  if v_phone is null or v_txt = '' then return jsonb_build_object('queued', false, 'why', 'empty'); end if;
  if coalesce(p_type, 'text') in ('reaction','system','unsupported','ephemeral','order') then return jsonb_build_object('queued', false, 'why', 'type'); end if;
  if upper(v_txt) ~ '^(STOP|UNSUBSCRIBE|START|SUBSCRIBE)$' then return jsonb_build_object('queued', false, 'why', 'keyword'); end if;
  if exists (select 1 from public.wa_phone_optout o where o.phone_e164 = v_phone)
     or exists (select 1 from public.wa_contacts w where w.phone_e164 = v_phone and w.opt_out_at is not null) then
    return jsonb_build_object('queued', false, 'why', 'opted out');
  end if;
  if p_wamid is not null and exists (select 1 from private.wa_bot_job j where j.wa_message_ids @> array[p_wamid]) then
    return jsonb_build_object('queued', false, 'why', 'duplicate');
  end if;
  -- several messages in a row → one reply to all of them
  update private.wa_bot_job j set question = left(j.question || E'\n' || v_txt, 3000),
         wa_message_ids = case when p_wamid is null then j.wa_message_ids else array_append(j.wa_message_ids, p_wamid) end,
         due_at = now() + make_interval(mins => s.reply_delay_min)
   where j.job_id = (select x.job_id from private.wa_bot_job x where x.phone_e164 = v_phone and x.status = 'queued' order by x.created_at desc limit 1)
  returning j.job_id into v_job;
  if v_job is null then
    insert into private.wa_bot_job(phone_e164, wa_message_ids, question, due_at)
      values (v_phone, case when p_wamid is null then '{}' else array[p_wamid] end, v_txt, now() + make_interval(mins => s.reply_delay_min))
    returning job_id into v_job;
  end if;
  if s.reply_delay_min = 0 then perform private.ci_kick_worker('wa-bot-worker'); end if;
  return jsonb_build_object('queued', true, 'job_id', v_job);
end $$;
revoke all on function api.ops_bot_inbound(text, text, text, text) from public, anon, authenticated;
grant execute on function api.ops_bot_inbound(text, text, text, text) to service_role;

create or replace function api.ops_bot_outbound(p_wamid text, p_phone text, p_category text default null)
returns void language sql security definer set search_path = '' as $$
  insert into private.wa_outbound_seen(wa_message_id, phone_e164, category)
  select p_wamid, intel.ci_e164(p_phone), nullif(lower(p_category), '')
   where p_wamid is not null and intel.ci_e164(p_phone) is not null
  on conflict (wa_message_id) do update set category = coalesce(private.wa_outbound_seen.category, excluded.category) $$;
revoke all on function api.ops_bot_outbound(text, text, text) from public, anon, authenticated;
grant execute on function api.ops_bot_outbound(text, text, text) to service_role;

-- ---------------------------------------------------------------------------------------------------
-- worker: claim due messages (with live context) / report what was sent
-- ---------------------------------------------------------------------------------------------------
create or replace function api.ops_bot_claim(p_limit int default 10)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s private.wa_bot_settings; j record; v_out jsonb := '[]'::jsonb; v_team timestamptz; v_hist jsonb; v_img boolean;
begin
  select * into s from private.wa_bot_settings where id;
  -- a worker that died mid-reply: try again (max 3 times)
  update private.wa_bot_job set status = case when attempts >= 3 then 'failed' else 'queued' end,
         reason = case when attempts >= 3 then 'gave up after 3 tries' else reason end
   where status = 'working' and coalesce(done_at, due_at) < now() - interval '10 minutes';
  for j in select * from private.wa_bot_job where status = 'queued' and due_at <= now()
            order by due_at limit greatest(1, least(coalesce(p_limit, 10), 25)) for update skip locked loop
    if not coalesce(s.enabled, false) then
      update private.wa_bot_job set status = 'skipped', reason = 'bot turned off', done_at = now() where job_id = j.job_id; continue;
    end if;
    if exists (select 1 from private.wa_bot_pause p where p.phone_e164 = j.phone_e164 and p.until > now()) then
      update private.wa_bot_job set status = 'skipped', done_at = now(),
             reason = (select 'paused for this number (' || p.reason || ') till ' || to_char(p.until at time zone 'Asia/Kolkata', 'DD Mon HH24:MI')
                         from private.wa_bot_pause p where p.phone_e164 = j.phone_e164)
       where job_id = j.job_id; continue;
    end if;
    v_team := intel.ci_bot_team_replied_at(j.phone_e164, now() - make_interval(hours => s.team_pause_hours));
    if v_team is not null then
      insert into private.wa_bot_pause(phone_e164, until, reason) values (j.phone_e164, v_team + make_interval(hours => s.team_pause_hours), 'team_reply')
      on conflict (phone_e164) do update set until = greatest(private.wa_bot_pause.until, excluded.until), reason = 'team_reply', set_at = now();
      update private.wa_bot_job set status = 'skipped', reason = 'the team is replying to this number', done_at = now() where job_id = j.job_id; continue;
    end if;
    update private.wa_bot_job set status = 'working', attempts = attempts + 1, done_at = now() where job_id = j.job_id;
    select coalesce(jsonb_agg(jsonb_build_object('dir', h.direction, 'text', left(h.body, 500), 'at', h.created_at) order by h.created_at), '[]'::jsonb)
      into v_hist
      from (select m.direction, m.body, m.created_at from public.wa_messages m join public.wa_conversations c on c.id = m.conversation_id
             where c.contact_phone_e164 = j.phone_e164 and m.body is not null and m.created_at < j.received_at
             order by m.created_at desc limit 10) h;
    v_img := exists (select 1 from private.wa_bot_job x where x.phone_e164 = j.phone_e164 and x.images > 0 and x.done_at > now() - interval '24 hours');
    v_out := v_out || jsonb_build_array(jsonb_build_object('job_id', j.job_id, 'phone', j.phone_e164, 'question', j.question,
               'history', v_hist, 'images_sent_today', v_img, 'use_ai', s.use_ai, 'ctx', intel.ci_bot_context(j.phone_e164)));
  end loop;
  return v_out;
end $$;
revoke all on function api.ops_bot_claim(int) from public, anon, authenticated;
grant execute on function api.ops_bot_claim(int) to service_role;

create or replace function api.ops_bot_done(p_job uuid, p_status text, p_reply text default null, p_refs text[] default '{}',
  p_reason text default null, p_handoff boolean default false, p_intent text default null, p_campaign uuid default null, p_images int default 0)
returns void language plpgsql security definer set search_path = '' as $$
declare j private.wa_bot_job; s private.wa_bot_settings; v_conv uuid; v_uid uuid; v_name text; v_org uuid; v_ref text; i int := 0;
begin
  if p_status not in ('sent','skipped','failed','queued') then raise exception 'bad status' using errcode = '22023'; end if;
  -- a send that failed for a passing reason is tried again in 2 minutes (3 tries in all)
  update private.wa_bot_job set status = case when p_status = 'queued' and attempts >= 3 then 'failed' else p_status end,
         reply = left(p_reply, 4000), sent_refs = coalesce(p_refs, '{}'),
         reason = left(p_reason, 300), handoff = coalesce(p_handoff, false), intent = p_intent, campaign_id = p_campaign,
         images = coalesce(p_images, 0), done_at = now(),
         due_at = case when p_status = 'queued' then now() + interval '2 minutes' else due_at end
   where job_id = p_job returning * into j;
  if j.job_id is null then return; end if;
  select * into s from private.wa_bot_settings where id;
  if p_status = 'sent' and p_reply is not null then
    -- the bot's reply shows in the app's WhatsApp inbox too (sender = system)
    select w.user_id into v_uid from public.wa_contacts w where w.phone_e164 = j.phone_e164 limit 1;
    begin
      v_conv := public.wa_system_conversation(v_uid, j.phone_e164);
      foreach v_ref in array coalesce(p_refs, '{}') loop
        i := i + 1;
        insert into public.wa_messages(conversation_id, sender_user_id, direction, body, wa_message_id, status)
          values (v_conv, null, 'outbound', case when i = 1 then '🤖 ' || left(p_reply, 3900) else '🤖 (screenshot)' end, v_ref, 'sent')
          on conflict do nothing;
      end loop;
      update public.wa_conversations set last_message_at = now() where id = v_conv;
    exception when others then null; end;
  end if;
  if coalesce(p_handoff, false) then
    insert into private.wa_bot_pause(phone_e164, until, reason) values (j.phone_e164, now() + make_interval(hours => coalesce(s.team_pause_hours, 6)), 'handoff')
    on conflict (phone_e164) do update set until = greatest(private.wa_bot_pause.until, excluded.until), reason = 'handoff', set_at = now();
    select coalesce(mm.name, j.phone_e164) into v_name from public.wa_contacts w join public.members mm on mm.id = w.user_id where w.phone_e164 = j.phone_e164 limit 1;
    select c.org_id into v_org from intel.ci_campaign c where c.campaign_id = p_campaign;
    begin
      perform intel.ci_alert_admins('💬 Creator needs a reply on WhatsApp',
        coalesce(v_name, j.phone_e164) || ' (' || j.phone_e164 || '): “' || left(j.question, 220) || '”. The bot told them the team will reply and stays quiet for this number.',
        'admin', 'Open', 'action_required', null);
      if v_org is not null then
        perform intel.ci_alert_org(v_org, '💬 Creator needs a reply on WhatsApp',
          coalesce(v_name, j.phone_e164) || ' (' || j.phone_e164 || '): “' || left(j.question, 220) || '”', 'campaigns', 'Open', 'action_required', null);
      end if;
    exception when others then null; end;
  end if;
end $$;
revoke all on function api.ops_bot_done(uuid, text, text, text[], text, boolean, text, uuid, int) from public, anon, authenticated;
grant execute on function api.ops_bot_done(uuid, text, text, text[], text, boolean, text, uuid, int) to service_role;

-- every minute: kick the worker only when a reply is due; tidy old status rows
create or replace function private.ci_bot_tick()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from private.wa_bot_job where status = 'queued' and due_at <= now()) then
    perform private.ci_kick_worker('wa-bot-worker');
  end if;
  delete from private.wa_outbound_seen where seen_at < now() - interval '4 days';
  delete from private.wa_bot_pause where until < now() - interval '1 day';
end $$;
revoke all on function private.ci_bot_tick() from public, anon, authenticated;

-- the worker is allowed to be kicked
create or replace function private.ci_kick_worker(p_fn text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_secret text; v_url text;
begin
  if p_fn not in ('ops-notify-dispatch','ops-reminder-worker','wa-template-sync','ig-discover-worker','ci-post-insights-worker','wa-bot-worker') then return null; end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'ci_worker_secret' limit 1;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'ci_project_url' limit 1;
  if v_secret is null or v_url is null then return null; end if;
  return net.http_post(url := v_url || '/functions/v1/' || p_fn, body := '{}'::jsonb,
                       headers := jsonb_build_object('Content-Type','application/json','x-worker-secret', v_secret),
                       timeout_milliseconds := 25000);
exception when others then
  raise warning 'ci_kick_worker(%) skipped: %', p_fn, sqlerrm; return null;
end $$;
revoke all on function private.ci_kick_worker(text) from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('wa-bot-tick', '* * * * *', $c$select private.ci_bot_tick()$c$);
  end if;
exception when others then raise warning 'wa-bot cron not scheduled: %', sqlerrm; end $$;

-- ---------------------------------------------------------------------------------------------------
-- Super Admin
-- ---------------------------------------------------------------------------------------------------
create or replace function public.admin_bot_overview(p_limit int default 60)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare s private.wa_bot_settings;
begin
  if not public.is_platform_admin() then raise exception 'super admin only' using errcode = '42501'; end if;
  select * into s from private.wa_bot_settings where id;
  return jsonb_build_object(
    'settings', jsonb_build_object('enabled', s.enabled, 'reply_delay_min', s.reply_delay_min, 'team_pause_hours', s.team_pause_hours,
                                   'use_ai', s.use_ai, 'updated_at', s.updated_at),
    'today', (select jsonb_build_object('sent', count(*) filter (where status = 'sent'), 'skipped', count(*) filter (where status = 'skipped'),
                       'failed', count(*) filter (where status = 'failed'), 'handoff', count(*) filter (where handoff), 'waiting', count(*) filter (where status in ('queued','working')))
                from private.wa_bot_job where created_at > now() - interval '24 hours'),
    'paused', coalesce((select jsonb_agg(jsonb_build_object('phone', p.phone_e164, 'until', p.until, 'reason', p.reason,
                         'name', (select mm.name from public.wa_contacts w join public.members mm on mm.id = w.user_id where w.phone_e164 = p.phone_e164 limit 1))
                         order by p.until desc) from private.wa_bot_pause p where p.until > now()), '[]'::jsonb),
    'log', coalesce((select jsonb_agg(x order by x->>'at' desc) from (
              select jsonb_build_object('job_id', j.job_id, 'phone', j.phone_e164, 'question', left(j.question, 400), 'reply', left(j.reply, 1500),
                       'status', j.status, 'reason', j.reason, 'handoff', j.handoff, 'intent', j.intent, 'images', j.images,
                       'campaign', (select c.name from intel.ci_campaign c where c.campaign_id = j.campaign_id),
                       'name', (select mm.name from public.wa_contacts w join public.members mm on mm.id = w.user_id where w.phone_e164 = j.phone_e164 limit 1),
                       'at', j.created_at, 'done_at', j.done_at) x
                from private.wa_bot_job j order by j.created_at desc limit greatest(1, least(coalesce(p_limit, 60), 300))) t), '[]'::jsonb));
end $$;
revoke all on function public.admin_bot_overview(int) from public, anon;
grant execute on function public.admin_bot_overview(int) to authenticated;

create or replace function public.admin_bot_settings(p_enabled boolean default null, p_delay int default null, p_pause_hours int default null, p_use_ai boolean default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then raise exception 'super admin only' using errcode = '42501'; end if;
  update private.wa_bot_settings set enabled = coalesce(p_enabled, enabled), reply_delay_min = coalesce(p_delay, reply_delay_min),
         team_pause_hours = coalesce(p_pause_hours, team_pause_hours), use_ai = coalesce(p_use_ai, use_ai),
         updated_at = now(), updated_by = auth.uid() where id;
  return public.admin_bot_overview(1)->'settings';
end $$;
revoke all on function public.admin_bot_settings(boolean, int, int, boolean) from public, anon;
grant execute on function public.admin_bot_settings(boolean, int, int, boolean) to authenticated;

-- pause the bot for one number (hours) — 0 = let the bot answer this number again
create or replace function public.admin_bot_pause(p_phone text, p_hours int default 24)
returns void language plpgsql security definer set search_path = '' as $$
declare v text := intel.ci_e164(p_phone);
begin
  if not public.is_platform_admin() then raise exception 'super admin only' using errcode = '42501'; end if;
  if v is null then raise exception 'phone number needed' using errcode = '22023'; end if;
  if coalesce(p_hours, 0) <= 0 then
    delete from private.wa_bot_pause where phone_e164 = v;
  else
    insert into private.wa_bot_pause(phone_e164, until, reason, set_by) values (v, now() + make_interval(hours => least(p_hours, 24 * 365)), 'manual', auth.uid())
    on conflict (phone_e164) do update set until = excluded.until, reason = 'manual', set_by = excluded.set_by, set_at = now();
  end if;
end $$;
revoke all on function public.admin_bot_pause(text, int) from public, anon;
grant execute on function public.admin_bot_pause(text, int) to authenticated;

-- Super Admin "try it": what the bot sees for a number (the same live data it answers from)
create or replace function public.admin_bot_preview(p_phone text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then raise exception 'super admin only' using errcode = '42501'; end if;
  return intel.ci_bot_context(p_phone);
end $$;
revoke all on function public.admin_bot_preview(text) from public, anon;
grant execute on function public.admin_bot_preview(text) to authenticated;
