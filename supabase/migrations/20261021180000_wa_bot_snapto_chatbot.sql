-- WhatsApp help bot — who sends the reply:
--   'direct' (default): Bounty Threads answers and sends on the snapto number by API (works on snapto's Basic plan).
--   'snapto': the snapto Advanced Chatbot "Geek Creator Help Bot" asks wa-bot-answer on every creator message (System
--             Api Call node) and sends the answer itself. Needs a snapto plan with Advanced Chatbot.
-- Never both: the backend queue (wa-bot-worker) only replies in 'direct', wa-bot-answer only in 'snapto'.

alter table private.wa_bot_settings add column if not exists mode text not null default 'direct';
do $$ begin
  alter table private.wa_bot_settings add constraint wa_bot_settings_mode_ck check (mode in ('snapto','direct'));
exception when duplicate_object then null; end $$;

-- the queue path stays quiet while the snapto chatbot answers
create or replace function api.ops_bot_inbound(p_phone text, p_wamid text, p_text text, p_type text default 'text')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s private.wa_bot_settings; v_phone text := intel.ci_e164(p_phone); v_job uuid; v_txt text := left(btrim(coalesce(p_text, '')), 1500);
begin
  select * into s from private.wa_bot_settings where id;
  if s.id is null or not s.enabled then return jsonb_build_object('queued', false, 'why', 'bot off'); end if;
  if s.mode = 'snapto' then return jsonb_build_object('queued', false, 'why', 'snapto chatbot replies'); end if;
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

-- snapto chatbot → "answer this number now": decides skip / no new message / go (with the live context)
create or replace function api.ops_bot_answer(p_phone text, p_text text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s private.wa_bot_settings; v_phone text := intel.ci_e164(p_phone); v_team timestamptz;
        v_ids text[]; v_q text; v_job uuid; v_hist jsonb; v_img boolean; v_txt text := nullif(btrim(coalesce(p_text, '')), '');
begin
  select * into s from private.wa_bot_settings where id;
  if s.id is null or not s.enabled then return jsonb_build_object('go', false, 'why', 'bot off'); end if;
  if s.mode <> 'snapto' then return jsonb_build_object('go', false, 'why', 'the backend bot replies (mode direct)'); end if;
  if v_phone is null then return jsonb_build_object('go', false, 'why', 'no number'); end if;
  if exists (select 1 from public.wa_phone_optout o where o.phone_e164 = v_phone)
     or exists (select 1 from public.wa_contacts w where w.phone_e164 = v_phone and w.opt_out_at is not null) then
    return jsonb_build_object('go', false, 'why', 'opted out');
  end if;
  if v_txt is not null and (v_txt like '%{{%' or upper(v_txt) ~ '^(STOP|UNSUBSCRIBE|START|SUBSCRIBE)$') then
    if upper(v_txt) ~ '^(STOP|UNSUBSCRIBE|START|SUBSCRIBE)$' then return jsonb_build_object('go', false, 'why', 'keyword'); end if;
    v_txt := null;                                  -- an unfilled chatbot variable: read the message from the webhook instead
  end if;

  -- the creator's messages not answered yet (stored by wa-webhook), newest 10 minutes
  select array_agg(m.wa_message_id order by m.created_at), string_agg(m.body, E'\n' order by m.created_at)
    into v_ids, v_q
    from public.wa_messages m join public.wa_conversations c on c.id = m.conversation_id
   where c.contact_phone_e164 = v_phone and m.direction = 'inbound' and m.created_at > now() - interval '10 minutes'
     and m.wa_message_id is not null
     and not exists (select 1 from private.wa_bot_job j where j.phone_e164 = v_phone and j.wa_message_ids @> array[m.wa_message_id]);
  if v_ids is null and v_txt is null then return jsonb_build_object('go', false, 'why', 'no new message', 'retry', true); end if;
  v_q := left(coalesce(nullif(btrim(v_q), ''), v_txt), 3000);
  if v_q is null or upper(btrim(v_q)) ~ '^(STOP|UNSUBSCRIBE|START|SUBSCRIBE)$' then return jsonb_build_object('go', false, 'why', 'keyword'); end if;

  -- team / pause rules
  if exists (select 1 from private.wa_bot_pause p where p.phone_e164 = v_phone and p.until > now()) then
    insert into private.wa_bot_job(phone_e164, wa_message_ids, question, status, reason, done_at)
      values (v_phone, coalesce(v_ids, '{}'), v_q, 'skipped', (select 'paused for this number (' || p.reason || ')' from private.wa_bot_pause p where p.phone_e164 = v_phone), now());
    return jsonb_build_object('go', false, 'why', 'paused');
  end if;
  v_team := intel.ci_bot_team_replied_at(v_phone, now() - make_interval(hours => s.team_pause_hours));
  if v_team is not null then
    insert into private.wa_bot_pause(phone_e164, until, reason) values (v_phone, v_team + make_interval(hours => s.team_pause_hours), 'team_reply')
    on conflict (phone_e164) do update set until = greatest(private.wa_bot_pause.until, excluded.until), reason = 'team_reply', set_at = now();
    insert into private.wa_bot_job(phone_e164, wa_message_ids, question, status, reason, done_at)
      values (v_phone, coalesce(v_ids, '{}'), v_q, 'skipped', 'the team is replying to this number', now());
    return jsonb_build_object('go', false, 'why', 'team replied');
  end if;

  insert into private.wa_bot_job(phone_e164, wa_message_ids, question, status, attempts, done_at)
    values (v_phone, coalesce(v_ids, '{}'), v_q, 'working', 1, now()) returning job_id into v_job;
  select coalesce(jsonb_agg(jsonb_build_object('dir', h.direction, 'text', left(h.body, 500), 'at', h.created_at) order by h.created_at), '[]'::jsonb)
    into v_hist
    from (select m.direction, m.body, m.created_at from public.wa_messages m join public.wa_conversations c on c.id = m.conversation_id
           where c.contact_phone_e164 = v_phone and m.body is not null and not (m.wa_message_id = any(coalesce(v_ids, '{}')))
           order by m.created_at desc limit 10) h;
  v_img := exists (select 1 from private.wa_bot_job x where x.phone_e164 = v_phone and x.images > 0 and x.done_at > now() - interval '24 hours');
  return jsonb_build_object('go', true, 'job_id', v_job, 'phone', v_phone, 'question', v_q, 'history', v_hist,
    'images_sent_today', v_img, 'use_ai', s.use_ai, 'ctx', intel.ci_bot_context(v_phone));
end $$;
revoke all on function api.ops_bot_answer(text, text) from public, anon, authenticated;
grant execute on function api.ops_bot_answer(text, text) to service_role;

-- screenshots sent after the reply
create or replace function api.ops_bot_images(p_job uuid, p_count int, p_refs text[] default '{}')
returns void language sql security definer set search_path = '' as $$
  update private.wa_bot_job set images = coalesce(p_count, 0), sent_refs = sent_refs || coalesce(p_refs, '{}') where job_id = p_job $$;
revoke all on function api.ops_bot_images(uuid, int, text[]) from public, anon, authenticated;
grant execute on function api.ops_bot_images(uuid, int, text[]) to service_role;

-- Super Admin: who sends the replies (snapto chatbot / backend)
create or replace function public.admin_bot_mode(p_mode text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then raise exception 'super admin only' using errcode = '42501'; end if;
  if p_mode not in ('snapto','direct') then raise exception 'mode must be snapto or direct' using errcode = '22023'; end if;
  update private.wa_bot_settings set mode = p_mode, updated_at = now(), updated_by = auth.uid() where id;
end $$;
revoke all on function public.admin_bot_mode(text) from public, anon;
grant execute on function public.admin_bot_mode(text) to authenticated;

create or replace function public.admin_bot_overview(p_limit int default 60)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare s private.wa_bot_settings;
begin
  if not public.is_platform_admin() then raise exception 'super admin only' using errcode = '42501'; end if;
  select * into s from private.wa_bot_settings where id;
  return jsonb_build_object(
    'settings', jsonb_build_object('enabled', s.enabled, 'reply_delay_min', s.reply_delay_min, 'team_pause_hours', s.team_pause_hours,
                                   'use_ai', s.use_ai, 'mode', s.mode, 'updated_at', s.updated_at),
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
