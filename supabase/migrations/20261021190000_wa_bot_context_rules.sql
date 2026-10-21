-- WhatsApp help bot — stays out of conversations it doesn't own.
-- Many creators write back to snapto broadcasts (e.g. a Google-form barter call) that are not app campaigns. The bot
-- must not answer those with app status or register steps. So it stays quiet (the team handles it) when:
--   1) the message is a reply to a WhatsApp message Bounty Threads did not send (a snapto broadcast / campaign);
--   2) the last message to that number in the past 3 days was a snapto broadcast template (not ours);
--   3) the number is not in the app at all (not registered, not in any bulk sheet) — unless they ask how to
--      register / log in / join the app.

alter table private.wa_bot_job add column if not exists reply_to text[] not null default '{}';
alter table public.wa_messages add column if not exists reply_to text;

-- is this WhatsApp message id one Bounty Threads (or its bot) sent?
create or replace function intel.ci_bot_is_ours(p_wamid text)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_wamid is not null and (
       exists (select 1 from intel.ci_outbox x where x.provider_ref = p_wamid)
    or exists (select 1 from public.wa_messages m where m.wa_message_id = p_wamid and m.direction = 'outbound')
    or exists (select 1 from private.wa_bot_job j where j.sent_refs @> array[p_wamid])) $$;
revoke all on function intel.ci_bot_is_ours(text) from public, anon, authenticated;

create or replace function intel.ci_bot_skip_reason(p_phone text, p_reply_to text[], p_question text)
returns text language plpgsql stable security definer set search_path = '' as $$
declare v_last record; v_known boolean; r text;
begin
  -- 1) replying to a message we didn't send
  foreach r in array coalesce(p_reply_to, '{}') loop
    if r is not null and r <> '' and not intel.ci_bot_is_ours(r) then return 'reply to a snapto broadcast — the team handles it'; end if;
  end loop;
  -- 2) the newest message to this number (3 days) was a broadcast template from snapto
  select o.wa_message_id, o.category into v_last from private.wa_outbound_seen o
   where o.phone_e164 = p_phone and o.seen_at > now() - interval '3 days' order by o.seen_at desc limit 1;
  if v_last.wa_message_id is not null and coalesce(v_last.category, '') in ('marketing', 'utility') and not intel.ci_bot_is_ours(v_last.wa_message_id) then
    return 'answer to a snapto broadcast — the team handles it';
  end if;
  -- 3) not in the app at all: only "how do I register / log in" gets the bot
  v_known := exists (select 1 from public.wa_contacts w where w.phone_e164 = p_phone)
          or exists (select 1 from public.members mm where mm.whatsapp_e164 = p_phone)
          or exists (select 1 from intel.ci_campaign_invite i where i.phone_e164 = p_phone);
  if not v_known and coalesce(p_question, '') !~* '(regist|sign ?up|log ?in|otp|code|account|app |app$|join|bounty|website|link|रजिस्टर|लॉगिन)' then
    return 'number not in the app — the team handles it';
  end if;
  return null;
end $$;
revoke all on function intel.ci_bot_skip_reason(text, text[], text) from public, anon, authenticated;

-- inbound now remembers which message it replies to
create or replace function api.ops_bot_inbound(p_phone text, p_wamid text, p_text text, p_type text, p_reply_to text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  v := api.ops_bot_inbound(p_phone, p_wamid, p_text, p_type);
  if p_reply_to is not null and p_reply_to <> '' then
    if p_wamid is not null then update public.wa_messages set reply_to = p_reply_to where wa_message_id = p_wamid and reply_to is null; end if;
    if coalesce((v->>'queued')::boolean, false) then
      update private.wa_bot_job set reply_to = array_append(reply_to, p_reply_to) where job_id = (v->>'job_id')::uuid;
    end if;
  end if;
  return v;
end $$;
revoke all on function api.ops_bot_inbound(text, text, text, text, text) from public, anon, authenticated;
grant execute on function api.ops_bot_inbound(text, text, text, text, text) to service_role;

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
    if v_skip is not null then
      update private.wa_bot_job set status = 'skipped', reason = v_skip, done_at = now() where job_id = j.job_id; continue;
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
end $function$;
revoke all on function api.ops_bot_claim(int) from public, anon, authenticated;
grant execute on function api.ops_bot_claim(int) to service_role;

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
  if v_skip is not null then
    insert into private.wa_bot_job(phone_e164, wa_message_ids, question, status, reason, done_at)
      values (v_phone, coalesce(v_ids, '{}'), v_q, 'skipped', v_skip, now());
    return jsonb_build_object('go', false, 'why', v_skip);
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
end $function$;
revoke all on function api.ops_bot_answer(text, text) from public, anon, authenticated;
grant execute on function api.ops_bot_answer(text, text) to service_role;
