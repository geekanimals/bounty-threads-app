-- Settings OFF = OFF everywhere. ADDITIVE.
-- While WhatsApp or email is OFF in Super Admin → Settings, NOTHING goes out on that channel — campaign updates,
-- reminders, alerts, account approved / declined, Super Admin test messages, emails and WhatsApp the team writes by
-- hand. The only exception: login / OTP / password-recovery codes (otherwise nobody can sign in).
-- A campaign's own switch works the same way for that campaign.
create or replace function private.msg_block_reason(p_channel text, p_campaign uuid, p_key text)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when coalesce(p_key, '') ~* 'otp|login|recovery|password' then null
    when p_channel = 'whatsapp' and not coalesce((select wa_on from public.messaging_switches), true)
      then 'paused: WhatsApp messages are turned off (Settings)'
    when p_channel = 'email' and not coalesce((select email_on from public.messaging_switches), true)
      then 'paused: email messages are turned off (Settings)'
    when p_campaign is not null and p_channel = 'whatsapp'
         and not coalesce((select wa_on from intel.ci_campaign_messaging where campaign_id = p_campaign), true)
      then 'paused: WhatsApp is turned off for this campaign'
    when p_campaign is not null and p_channel = 'email'
         and not coalesce((select email_on from intel.ci_campaign_messaging where campaign_id = p_campaign), true)
      then 'paused: email is turned off for this campaign'
  end $$;
revoke all on function private.msg_block_reason(text, uuid, text) from public, anon, authenticated;

-- anything already waiting in the queue stops now too
do $$ begin
  if not coalesce((select wa_on from public.messaging_switches), true) then perform private.msg_hold_queued('whatsapp', null); end if;
  if not coalesce((select email_on from public.messaging_switches), true) then perform private.msg_hold_queued('email', null); end if;
end $$;

-- wa-send (the team's WhatsApp chat) checks the switches before sending
create or replace function api.messaging_allowed(p_channel text, p_campaign uuid default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ok', private.msg_block_reason(p_channel, case when p_campaign is null then null else intel.ci_resolve_campaign(p_campaign) end, 'team_chat') is null,
                            'reason', private.msg_block_reason(p_channel, case when p_campaign is null then null else intel.ci_resolve_campaign(p_campaign) end, 'team_chat')) $$;
revoke all on function api.messaging_allowed(text, uuid) from public, anon;
grant execute on function api.messaging_allowed(text, uuid) to authenticated, service_role;
