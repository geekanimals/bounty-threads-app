-- On/off switches for automatic messages. ADDITIVE.
-- * Super Admin → Settings: WhatsApp ON/OFF and Email ON/OFF for the whole platform.
-- * Each campaign: WhatsApp ON/OFF and Email ON/OFF for that campaign only.
-- While a switch is OFF, every automatic message on that channel (invites, step updates, reminders, alerts)
-- is held at the queue ("skipped" with the reason) — it is NOT sent later when the switch goes back on.
-- Turning OFF also stops anything already waiting in the queue. Login / OTP codes, Super Admin test messages
-- and emails a team member writes by hand are never blocked. The global WhatsApp switch also pauses the bot.

create table if not exists public.messaging_switches (
  id         boolean primary key default true check (id),
  wa_on      boolean not null default true,
  email_on   boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.messaging_switches(id) values (true) on conflict (id) do nothing;
alter table public.messaging_switches enable row level security;
revoke all on public.messaging_switches from anon, authenticated;

create table if not exists intel.ci_campaign_messaging (
  campaign_id uuid primary key references intel.ci_campaign(campaign_id) on delete cascade,
  wa_on       boolean not null default true,
  email_on    boolean not null default true,
  updated_by  uuid references auth.users(id) on delete set null,
  updated_at  timestamptz not null default now()
);
alter table intel.ci_campaign_messaging enable row level security;
revoke all on intel.ci_campaign_messaging from anon, authenticated;

-- why a message on this channel / campaign may not go out right now (null = it may)
create or replace function private.msg_block_reason(p_channel text, p_campaign uuid, p_key text)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when coalesce(p_key, '') in ('test', 'team_email') or coalesce(p_key, '') ~* 'otp|login|recovery' then null
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

create or replace function private.outbox_respect_switches() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_r text;
begin
  if new.status = 'queued' and new.channel in ('whatsapp', 'email') then
    v_r := private.msg_block_reason(new.channel, new.campaign_id, new.template_key);
    if v_r is not null then new.status := 'skipped'; new.last_error := v_r; end if;
  end if;
  return new;
end $$;
drop trigger if exists outbox_respect_switches on intel.ci_outbox;
create trigger outbox_respect_switches before insert or update of status on intel.ci_outbox
  for each row execute function private.outbox_respect_switches();

-- stop whatever is already waiting
create or replace function private.msg_hold_queued(p_channel text, p_campaign uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  update intel.ci_outbox o set status = 'skipped', last_error = private.msg_block_reason(o.channel, o.campaign_id, o.template_key)
   where o.status = 'queued' and o.channel = p_channel and (p_campaign is null or o.campaign_id = p_campaign)
     and private.msg_block_reason(o.channel, o.campaign_id, o.template_key) is not null;
  get diagnostics v_n = row_count; return v_n;
end $$;

-- the dispatcher / bot worker read the global switches
create or replace function api.ops_messaging_switches()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce((select jsonb_build_object('wa_on', wa_on, 'email_on', email_on) from public.messaging_switches),
                  '{"wa_on":true,"email_on":true}'::jsonb) $$;
revoke all on function api.ops_messaging_switches() from public, anon, authenticated;
grant execute on function api.ops_messaging_switches() to service_role;

-- Super Admin: read / switch
create or replace function public.admin_messaging_switches()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then raise exception 'not a platform admin' using errcode = '42501'; end if;
  return (select jsonb_build_object('wa_on', s.wa_on, 'email_on', s.email_on, 'updated_at', s.updated_at,
            'updated_by', (select coalesce(nullif(m.name, ''), m.org_name) from public.members m where m.id = s.updated_by),
            'held_wa', (select count(*) from intel.ci_outbox o where o.channel = 'whatsapp' and o.last_error like 'paused:%' and o.created_at > now() - interval '7 days'),
            'held_email', (select count(*) from intel.ci_outbox o where o.channel = 'email' and o.last_error like 'paused:%' and o.created_at > now() - interval '7 days'),
            'campaigns_off', (select count(*) from intel.ci_campaign_messaging c where not c.wa_on or not c.email_on))
          from public.messaging_switches s);
end $$;
revoke all on function public.admin_messaging_switches() from public, anon;
grant execute on function public.admin_messaging_switches() to authenticated;

create or replace function public.admin_set_messaging_switch(p_channel text, p_on boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_n int := 0;
begin
  if not public.is_platform_admin() then raise exception 'not a platform admin' using errcode = '42501'; end if;
  if p_channel = 'whatsapp' then update public.messaging_switches set wa_on = p_on, updated_by = auth.uid(), updated_at = now();
  elsif p_channel = 'email' then update public.messaging_switches set email_on = p_on, updated_by = auth.uid(), updated_at = now();
  else raise exception 'channel must be whatsapp or email' using errcode = '22023'; end if;
  if not p_on then v_n := private.msg_hold_queued(p_channel, null); end if;
  begin
    insert into public.activity_log(member_id, kind, event, detail)
    values (auth.uid(), 'security', 'messaging_switch', jsonb_build_object('channel', p_channel, 'on', p_on, 'held', v_n));
  exception when others then null; end;
  return jsonb_build_object('channel', p_channel, 'on', p_on, 'held_now', v_n);
end $$;
revoke all on function public.admin_set_messaging_switch(text, boolean) from public, anon;
grant execute on function public.admin_set_messaging_switch(text, boolean) to authenticated;

-- Campaign team: read / switch one campaign
create or replace function api.campaign_messaging(p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  p_campaign := intel.ci_resolve_campaign(p_campaign);
  if p_campaign is null or not intel.ci_can_manage_campaign(p_campaign) then raise exception 'not your campaign' using errcode = '42501'; end if;
  return jsonb_build_object(
    'wa_on', coalesce((select wa_on from intel.ci_campaign_messaging where campaign_id = p_campaign), true),
    'email_on', coalesce((select email_on from intel.ci_campaign_messaging where campaign_id = p_campaign), true),
    'global_wa_on', coalesce((select wa_on from public.messaging_switches), true),
    'global_email_on', coalesce((select email_on from public.messaging_switches), true),
    'held_wa', (select count(*) from intel.ci_outbox o where o.campaign_id = p_campaign and o.channel = 'whatsapp' and o.last_error like 'paused:%'),
    'held_email', (select count(*) from intel.ci_outbox o where o.campaign_id = p_campaign and o.channel = 'email' and o.last_error like 'paused:%'));
end $$;
revoke all on function api.campaign_messaging(uuid) from public, anon;
grant execute on function api.campaign_messaging(uuid) to authenticated;

create or replace function api.set_campaign_messaging(p_campaign uuid, p_channel text, p_on boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_n int := 0;
begin
  p_campaign := intel.ci_resolve_campaign(p_campaign);
  if p_campaign is null or not intel.ci_can_manage_campaign(p_campaign) then raise exception 'not your campaign' using errcode = '42501'; end if;
  if p_channel not in ('whatsapp', 'email') then raise exception 'channel must be whatsapp or email' using errcode = '22023'; end if;
  insert into intel.ci_campaign_messaging(campaign_id) values (p_campaign) on conflict (campaign_id) do nothing;
  if p_channel = 'whatsapp' then update intel.ci_campaign_messaging set wa_on = p_on, updated_by = auth.uid(), updated_at = now() where campaign_id = p_campaign;
  else update intel.ci_campaign_messaging set email_on = p_on, updated_by = auth.uid(), updated_at = now() where campaign_id = p_campaign; end if;
  if not p_on then v_n := private.msg_hold_queued(p_channel, p_campaign); end if;
  return jsonb_build_object('channel', p_channel, 'on', p_on, 'held_now', v_n);
end $$;
revoke all on function api.set_campaign_messaging(uuid, text, boolean) from public, anon;
grant execute on function api.set_campaign_messaging(uuid, text, boolean) to authenticated;

revoke all on function private.msg_block_reason(text, uuid, text), private.outbox_respect_switches(),
                       private.msg_hold_queued(text, uuid) from public, anon, authenticated;
