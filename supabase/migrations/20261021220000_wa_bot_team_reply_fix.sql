-- WhatsApp help bot — fix: it thought the team had replied when nobody had.
-- WhatsApp status updates without a price category (read / delivered receipts, snapto system messages) were counted
-- as "a person from the team replied", so every number went quiet. Now only a real free-form reply
-- (category 'service') counts. Marketing-lite broadcasts count as broadcasts. The wrong pauses are cleared and the
-- messages skipped for that reason in the last 90 minutes are answered now.

create or replace function intel.ci_bot_team_replied_at(p_phone text, p_since timestamptz)
returns timestamptz language sql stable security definer set search_path = '' as $$
  select max(o.seen_at) from private.wa_outbound_seen o
   where o.phone_e164 = p_phone and o.seen_at >= p_since
     and o.category = 'service'
     and not exists (select 1 from intel.ci_outbox x where x.provider_ref = o.wa_message_id)
     and not exists (select 1 from private.wa_bot_job j where j.sent_refs @> array[o.wa_message_id])
     and not exists (select 1 from private.wa_bot_job j where j.phone_e164 = o.phone_e164 and j.status = 'sent'
                        and cardinality(j.sent_refs) = 0 and o.seen_at between j.done_at - interval '2 minutes' and j.done_at + interval '3 minutes')
     and not exists (select 1 from public.wa_messages m where m.wa_message_id = o.wa_message_id and m.sender_user_id is null) $$;
revoke all on function intel.ci_bot_team_replied_at(text, timestamptz) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION intel.ci_bot_skip_reason(p_phone text, p_reply_to text[], p_question text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_last record; v_known boolean; r text;
begin
  -- 1) replying to a message we didn't send
  foreach r in array coalesce(p_reply_to, '{}') loop
    if r is not null and r <> '' and not intel.ci_bot_is_ours(r) then return 'reply to a snapto broadcast — the team handles it'; end if;
  end loop;
  -- 2) the newest message to this number (3 days) was a broadcast template from snapto
  select o.wa_message_id, o.category into v_last from private.wa_outbound_seen o
   where o.phone_e164 = p_phone and o.seen_at > now() - interval '3 days' order by o.seen_at desc limit 1;
  if v_last.wa_message_id is not null and coalesce(v_last.category, '') in ('marketing', 'marketing_lite', 'utility') and not intel.ci_bot_is_ours(v_last.wa_message_id) then
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
end $function$;
revoke all on function intel.ci_bot_skip_reason(text, text[], text) from public, anon, authenticated;

-- clear the wrong "team replied" pauses (a real team reply sets them again on the next message)
delete from private.wa_bot_pause p where p.reason = 'team_reply' and intel.ci_bot_team_replied_at(p.phone_e164, now() - interval '72 hours') is null;

-- answer what was skipped by mistake in the last 90 minutes (newest message per number only)
update private.wa_bot_job j set status = 'queued', reason = null, due_at = now(), done_at = null
 where j.status = 'skipped' and j.created_at > now() - interval '90 minutes'
   and (j.reason = 'the team is replying to this number' or j.reason like 'paused for this number (team_reply)%')
   and intel.ci_bot_team_replied_at(j.phone_e164, now() - interval '6 hours') is null
   and j.created_at = (select max(x.created_at) from private.wa_bot_job x where x.phone_e164 = j.phone_e164);
