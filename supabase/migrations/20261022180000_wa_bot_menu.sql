-- WhatsApp bot: menu first, then help — on every number on the snapto WhatsApp.
--  • Any new chat (or 24 h quiet) gets the Geek Bot welcome + 5 options. The bot answers only after an option is
--    picked (1 help · 2 profile · 3 campaign · 4 team · 5 something else); other messages before that get no reply.
--  • 4 / TEAM → the team is alerted and the bot goes quiet for that number (pause), as before.
--  • Replies to EVERY number (broadcast replies / numbers not in the app too) — no more "team handles it" skip.
--  • The bot reads the chat history from both sides: messages in our inbox (in + out, bot, app) AND what was sent
--    from snapto itself (broadcasts / templates / team replies, known from the snapto status webhook), plus the
--    creator's live account data from the website (campaigns, profile completion, invites).

create table if not exists private.wa_bot_session (
  phone_e164 text primary key,
  state text not null default 'menu',          -- menu · help · profile · campaign · other · team
  option text,
  menu_at timestamptz,
  last_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table private.wa_bot_session enable row level security;
revoke all on private.wa_bot_session from public, anon, authenticated;

create or replace function intel.ci_bot_session_of(p_phone text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select to_jsonb(s) from private.wa_bot_session s where s.phone_e164 = intel.ci_e164(p_phone) $$;
revoke all on function intel.ci_bot_session_of(text) from public, anon, authenticated;

create or replace function api.ops_bot_session(p_phone text, p_state text, p_option text default null, p_menu boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v text := intel.ci_e164(p_phone);
begin
  if v is null then return null; end if;
  if p_state not in ('menu','help','profile','campaign','other','team') then raise exception 'bad state' using errcode = '22023'; end if;
  insert into private.wa_bot_session(phone_e164, state, option, menu_at, last_at, updated_at)
  values (v, p_state, p_option, case when p_menu then now() end, now(), now())
  on conflict (phone_e164) do update set state = excluded.state, option = coalesce(excluded.option, private.wa_bot_session.option),
    menu_at = coalesce(excluded.menu_at, private.wa_bot_session.menu_at), last_at = now(), updated_at = now();
  return intel.ci_bot_session_of(v);
end $$;
revoke all on function api.ops_bot_session(text, text, text, boolean) from public, anon, authenticated;
grant execute on function api.ops_bot_session(text, text, text, boolean) to service_role;

-- the chat, both sides, newest 20 in the last 14 days: our inbox + what snapto sent (template / broadcast / team)
create or replace function intel.ci_bot_history(p_phone text, p_exclude text[], p_before timestamptz)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('dir', h.dir, 'text', h.txt, 'at', h.at, 'by', h.by) order by h.at), '[]'::jsonb)
  from (
    select * from (
      select m.direction dir, left(m.body, 500) txt, m.created_at at,
             case when m.direction = 'inbound' then 'creator' when m.sender_user_id is null then 'geek (auto)' else 'geek team (app)' end by
        from public.wa_messages m join public.wa_conversations c on c.id = m.conversation_id
       where c.contact_phone_e164 = p_phone and m.body is not null and m.created_at < coalesce(p_before, now())
         and m.created_at > now() - interval '14 days'
         and not (coalesce(m.wa_message_id, '') = any(coalesce(p_exclude, '{}')))
      union all
      select 'outbound', case when o.category in ('marketing','marketing_lite') then '[Geek sent a broadcast / promo message on snapto]'
                              when o.category = 'utility' then '[Geek sent a campaign update template on snapto]'
                              when o.category = 'authentication' then '[Geek sent a login code]'
                              else '[Geek team replied from the snapto inbox]' end,
             o.seen_at, 'geek (snapto)'
        from private.wa_outbound_seen o
       where o.phone_e164 = p_phone and o.seen_at < coalesce(p_before, now()) and o.seen_at > now() - interval '14 days'
         and not exists (select 1 from public.wa_messages m where m.wa_message_id = o.wa_message_id)
         and not exists (select 1 from intel.ci_outbox x where x.provider_ref = o.wa_message_id)
    ) a order by at desc limit 20) h $$;
revoke all on function intel.ci_bot_history(text, text[], timestamptz) from public, anon, authenticated;

-- the website side: everything ci_bot_context knows + profile completion (what is still missing)
create or replace function intel.ci_bot_context_plus(p_phone text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c jsonb := intel.ci_bot_context(p_phone); v_id uuid;
begin
  if (c->>'user_id') is not null then
    v_id := intel.ci_member_identity((c->>'user_id')::uuid);
    if v_id is not null then
      begin
        c := c || jsonb_build_object('profile', (select jsonb_build_object('complete', r->'complete', 'done', r->'done', 'total', r->'total', 'missing', r->'missing')
                                                  from (select intel.ci_profile_requirements(v_id) r) x));
      exception when others then null; end;
    else
      c := c || jsonb_build_object('profile', jsonb_build_object('complete', false, 'done', 0, 'total', null, 'missing', '[]'::jsonb, 'not_started', true));
    end if;
  end if;
  return c;
end $$;
revoke all on function intel.ci_bot_context_plus(text) from public, anon, authenticated;

-- reply to everyone (the menu decides what happens next)
create or replace function intel.ci_bot_skip_reason(p_phone text, p_reply_to text[], p_question text)
returns text language sql stable security definer set search_path = '' as $$ select null::text $$;
revoke all on function intel.ci_bot_skip_reason(text, text[], text) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION api.ops_bot_claim(p_limit integer DEFAULT 10)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s private.wa_bot_settings; j record; v_out jsonb := '[]'::jsonb; v_team timestamptz; v_hist jsonb; v_img boolean; v_skip text;
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
    v_skip := intel.ci_bot_skip_reason(j.phone_e164, j.reply_to, j.question);
    -- broadcast replies / numbers not in the app: one friendly "got it, the team will reply" (once per 12 h)
    if v_skip is not null and exists (select 1 from private.wa_bot_job x where x.phone_e164 = j.phone_e164 and x.intent = 'ack' and x.status = 'sent' and x.done_at > now() - interval '12 hours') then
      update private.wa_bot_job set status = 'skipped', reason = v_skip || ' (already told them the team will reply)', done_at = now() where job_id = j.job_id; continue;
    end if;
    update private.wa_bot_job set status = 'working', attempts = attempts + 1, done_at = now() where job_id = j.job_id;
    v_hist := intel.ci_bot_history(j.phone_e164, j.wa_message_ids, j.received_at);
    v_img := exists (select 1 from private.wa_bot_job x where x.phone_e164 = j.phone_e164 and x.images > 0 and x.done_at > now() - interval '24 hours');
    v_out := v_out || jsonb_build_array(jsonb_build_object('job_id', j.job_id, 'phone', j.phone_e164, 'question', j.question,
               'history', v_hist, 'images_sent_today', v_img, 'use_ai', s.use_ai, 'ack', null, 'session', intel.ci_bot_session_of(j.phone_e164), 'ctx', intel.ci_bot_context_plus(j.phone_e164)));
  end loop;
  return v_out;
end $function$;

CREATE OR REPLACE FUNCTION api.ops_bot_answer(p_phone text, p_text text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s private.wa_bot_settings; v_phone text := intel.ci_e164(p_phone); v_team timestamptz;
        v_ids text[]; v_q text; v_job uuid; v_hist jsonb; v_img boolean; v_skip text; v_txt text := nullif(btrim(coalesce(p_text, '')), '');
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

  v_skip := intel.ci_bot_skip_reason(v_phone, (select array_agg(m.reply_to) from public.wa_messages m where m.wa_message_id = any(coalesce(v_ids, '{}')) and m.reply_to is not null), v_q);
  if v_skip is not null and exists (select 1 from private.wa_bot_job x where x.phone_e164 = v_phone and x.intent = 'ack' and x.status = 'sent' and x.done_at > now() - interval '12 hours') then
    insert into private.wa_bot_job(phone_e164, wa_message_ids, question, status, reason, done_at)
      values (v_phone, coalesce(v_ids, '{}'), v_q, 'skipped', v_skip || ' (already told them the team will reply)', now());
    return jsonb_build_object('go', false, 'why', v_skip);
  end if;
  insert into private.wa_bot_job(phone_e164, wa_message_ids, question, status, attempts, done_at)
    values (v_phone, coalesce(v_ids, '{}'), v_q, 'working', 1, now()) returning job_id into v_job;
  v_hist := intel.ci_bot_history(v_phone, coalesce(v_ids, '{}'), now());
  v_img := exists (select 1 from private.wa_bot_job x where x.phone_e164 = v_phone and x.images > 0 and x.done_at > now() - interval '24 hours');
  return jsonb_build_object('go', true, 'job_id', v_job, 'phone', v_phone, 'question', v_q, 'history', v_hist,
    'images_sent_today', v_img, 'use_ai', s.use_ai, 'ack', null, 'session', intel.ci_bot_session_of(v_phone), 'ctx', intel.ci_bot_context_plus(v_phone));
end $function$;
