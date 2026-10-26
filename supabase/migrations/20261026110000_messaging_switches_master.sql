-- Settings switch = master switch for every campaign.
-- * Settings OFF → every campaign shows OFF (the app shows it; campaign switches are locked).
-- * Settings ON  → every campaign's switch for that channel is turned ON too, so all campaigns show ON.
-- * Necessary messages always go: login / OTP codes (sent directly, never queued), account approved / declined,
--   Super Admin test messages and emails a team member writes by hand.
create or replace function private.msg_block_reason(p_channel text, p_campaign uuid, p_key text)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when coalesce(p_key, '') in ('test', 'team_email') or coalesce(p_key, '') ~* '^account_|otp|login|recovery|password' then null
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

create or replace function public.admin_set_messaging_switch(p_channel text, p_on boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_n int := 0; v_c int := 0;
begin
  if not public.is_platform_admin() then raise exception 'not a platform admin' using errcode = '42501'; end if;
  insert into public.messaging_switches(id) values (true) on conflict (id) do nothing;
  if p_channel = 'whatsapp' then
    update public.messaging_switches set wa_on = p_on, updated_by = auth.uid(), updated_at = now() where id;
    if p_on then update intel.ci_campaign_messaging set wa_on = true, updated_by = auth.uid(), updated_at = now() where not wa_on;
                 get diagnostics v_c = row_count; end if;
  elsif p_channel = 'email' then
    update public.messaging_switches set email_on = p_on, updated_by = auth.uid(), updated_at = now() where id;
    if p_on then update intel.ci_campaign_messaging set email_on = true, updated_by = auth.uid(), updated_at = now() where not email_on;
                 get diagnostics v_c = row_count; end if;
  else raise exception 'channel must be whatsapp or email' using errcode = '22023'; end if;
  if not p_on then v_n := private.msg_hold_queued(p_channel, null); end if;
  begin
    insert into public.activity_log(member_id, kind, event, detail)
    values (auth.uid(), 'security', 'messaging_switch', jsonb_build_object('channel', p_channel, 'on', p_on, 'held', v_n, 'campaigns_turned_on', v_c));
  exception when others then null; end;
  return jsonb_build_object('channel', p_channel, 'on', p_on, 'held_now', v_n, 'campaigns_turned_on', v_c);
end $$;
revoke all on function public.admin_set_messaging_switch(text, boolean) from public, anon;
grant execute on function public.admin_set_messaging_switch(text, boolean) to authenticated;

-- a campaign switch can't be turned ON while Settings has that channel OFF
create or replace function api.set_campaign_messaging(p_campaign uuid, p_channel text, p_on boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_n int := 0;
begin
  p_campaign := intel.ci_resolve_campaign(p_campaign);
  if p_campaign is null or not intel.ci_can_manage_campaign(p_campaign) then raise exception 'not your campaign' using errcode = '42501'; end if;
  if p_channel not in ('whatsapp', 'email') then raise exception 'channel must be whatsapp or email' using errcode = '22023'; end if;
  if p_on and not coalesce((select case when p_channel = 'whatsapp' then wa_on else email_on end from public.messaging_switches), true) then
    raise exception '% is turned off for every campaign in Super Admin → Settings. Turn it on there first.',
      case when p_channel = 'whatsapp' then 'WhatsApp' else 'Email' end using errcode = '22023';
  end if;
  insert into intel.ci_campaign_messaging(campaign_id) values (p_campaign) on conflict (campaign_id) do nothing;
  if p_channel = 'whatsapp' then update intel.ci_campaign_messaging set wa_on = p_on, updated_by = auth.uid(), updated_at = now() where campaign_id = p_campaign;
  else update intel.ci_campaign_messaging set email_on = p_on, updated_by = auth.uid(), updated_at = now() where campaign_id = p_campaign; end if;
  if not p_on then v_n := private.msg_hold_queued(p_channel, p_campaign); end if;
  return jsonb_build_object('channel', p_channel, 'on', p_on, 'held_now', v_n);
end $$;
revoke all on function api.set_campaign_messaging(uuid, text, boolean) from public, anon;
grant execute on function api.set_campaign_messaging(uuid, text, boolean) to authenticated;
revoke all on function private.msg_block_reason(text, uuid, text) from public, anon, authenticated;
