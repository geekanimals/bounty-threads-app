-- STOP / unsubscribe for EVERYONE + one admin list of who opted out.
-- * Email "Stop update emails" link now works for people invited from a sheet who have no account yet
--   (before: their emails carried no unsubscribe link at all). Each email address gets its own token.
-- * An address that unsubscribed never gets another update email (checked when queued and at send time).
-- * WhatsApp opt-outs from the link are recorded per number too, so STOP reply + link land in one list.
-- * public.admin_optouts(): every WhatsApp number and email that opted out, who it is, how and when.
-- ADDITIVE.

create table if not exists private.email_token (
  email text primary key,
  token uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now()
);
create table if not exists public.email_optout (
  email      text primary key,
  opt_out_at timestamptz not null default now(),
  via        text
);
alter table public.email_optout enable row level security;
revoke all on public.email_optout from anon, authenticated;

create or replace function private.email_key(p text) returns text language sql immutable set search_path = '' as $$
  select nullif(lower(btrim(coalesce(p, ''))), '') $$;

-- carry over members who already unsubscribed
insert into public.email_optout(email, opt_out_at, via)
select private.email_key(u.email::text), m.email_opt_out_at, 'link'
  from public.members m join auth.users u on u.id = m.id
 where m.email_opt_out_at is not null and private.email_key(u.email::text) is not null
on conflict (email) do nothing;

-- the dispatcher: token + current choice for one email address (used when the recipient has no account)
create or replace function api.ops_email_prefs(p_email text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_e text := private.email_key(p_email); v_t uuid;
begin
  if v_e is null then return '{}'::jsonb; end if;
  insert into private.email_token(email) values (v_e) on conflict (email) do nothing;
  select token into v_t from private.email_token where email = v_e;
  return jsonb_build_object('token', v_t, 'email_off', exists (select 1 from public.email_optout o where o.email = v_e));
end $$;
revoke all on function api.ops_email_prefs(text) from public, anon, authenticated;
grant execute on function api.ops_email_prefs(text) to service_role;

-- the unsubscribe link: a member token (as before) OR an email-address token
create or replace function api.notify_unsubscribe(p_token uuid, p_channel text, p_off boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_e text; v_phone text;
begin
  select id into v_id from public.members where notify_token = p_token;
  if v_id is null then
    select email into v_e from private.email_token where token = p_token;
    if v_e is null or p_channel <> 'email' then raise exception 'link not valid' using errcode = '22023'; end if;
  else
    select private.email_key(u.email::text) into v_e from auth.users u where u.id = v_id;
  end if;

  if p_channel = 'email' then
    if v_id is not null then
      update public.members set email_opt_out_at = case when p_off then now() else null end where id = v_id;
    end if;
    if v_e is not null then
      if p_off then insert into public.email_optout(email, opt_out_at, via) values (v_e, now(), 'link')
                      on conflict (email) do update set opt_out_at = now(), via = 'link';
      else delete from public.email_optout where email = v_e; end if;
    end if;
    if p_off then
      update intel.ci_outbox set status = 'skipped', last_error = 'unsubscribed'
       where channel = 'email' and status = 'queued'
         and ((v_id is not null and recipient_member_id = v_id) or (v_e is not null and private.email_key(to_address) = v_e));
    end if;
  elsif p_channel = 'whatsapp' then
    update public.wa_contacts set opt_out_at = case when p_off then now() else null end,
                                  opt_in_at = case when p_off then opt_in_at else now() end where user_id = v_id;
    for v_phone in select private.wa_phone_key(phone_e164) from public.wa_contacts where user_id = v_id loop
      if v_phone is null then continue; end if;
      if p_off then insert into public.wa_phone_optout(phone_e164, opt_out_at, keyword) values (v_phone, now(), 'LINK')
                      on conflict (phone_e164) do update set opt_out_at = now(), keyword = 'LINK';
      else delete from public.wa_phone_optout where phone_e164 = v_phone; end if;
    end loop;
    if p_off then
      update intel.ci_outbox set status = 'skipped', last_error = 'unsubscribed'
       where recipient_member_id = v_id and channel = 'whatsapp' and status = 'queued';
    end if;
  else raise exception 'unknown channel' using errcode = '22023'; end if;
  return jsonb_build_object('ok', true, 'channel', p_channel, 'off', p_off);
end $$;
revoke all on function api.notify_unsubscribe(uuid, text, boolean) from public, anon, authenticated;
grant execute on function api.notify_unsubscribe(uuid, text, boolean) to service_role;

-- nothing new is queued by email to an address that unsubscribed
create or replace function private.email_outbox_respect_optout() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.channel = 'email' and new.status = 'queued'
     and exists (select 1 from public.email_optout o where o.email = private.email_key(new.to_address)) then
    new.status := 'skipped'; new.last_error := 'unsubscribed (email link)';
  end if;
  return new;
end $$;
drop trigger if exists email_outbox_respect_optout on intel.ci_outbox;
create trigger email_outbox_respect_optout before insert on intel.ci_outbox for each row execute function private.email_outbox_respect_optout();

-- Super Admin: everyone who stopped WhatsApp or email updates
create or replace function public.admin_optouts()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then raise exception 'not a platform admin' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(x order by x->>'at' desc) from (
    -- WhatsApp: STOP replies, the link, and older per-account opt-outs
    select jsonb_build_object('channel', 'whatsapp', 'to', w.phone, 'at', w.at,
             'via', case when w.kw = 'LINK' then 'Tapped the stop link' else 'Replied "' || initcap(coalesce(w.kw, 'STOP')) || '" on WhatsApp' end,
             'member_id', mb.id, 'name', coalesce(nullif(mb.name, ''), inv.full_name), 'handle', inv.handle,
             'campaign', inv.campaign, 'on_geek', mb.id is not null,
             'skipped', (select count(*) from intel.ci_outbox o where o.channel = 'whatsapp' and o.status = 'skipped'
                           and private.wa_phone_key(o.to_address) = w.phone and o.last_error ~* 'opted out|unsubscribed')) x
      from (select o.phone_e164 phone, o.opt_out_at at, o.keyword kw from public.wa_phone_optout o
            union all
            select private.wa_phone_key(c.phone_e164), c.opt_out_at, 'STOP' from public.wa_contacts c
             where c.opt_out_at is not null and not exists (select 1 from public.wa_phone_optout o where o.phone_e164 = private.wa_phone_key(c.phone_e164))) w
      left join lateral (select m.id, m.name from public.wa_contacts c join public.members m on m.id = c.user_id
                          where private.wa_phone_key(c.phone_e164) = w.phone limit 1) mb on true
      left join lateral (select i.full_name, i.handle, cp.name campaign from intel.ci_campaign_invite i
                           left join intel.ci_campaign cp on cp.campaign_id = i.campaign_id
                          where private.wa_phone_key(i.phone_e164) = w.phone order by i.created_at desc limit 1) inv on true
    union all
    -- Email: the "Stop update emails" link
    select jsonb_build_object('channel', 'email', 'to', e.email, 'at', e.opt_out_at, 'via', 'Clicked unsubscribe in an email',
             'member_id', mb.id, 'name', coalesce(nullif(mb.name, ''), inv.full_name), 'handle', inv.handle,
             'campaign', inv.campaign, 'on_geek', mb.id is not null,
             'skipped', (select count(*) from intel.ci_outbox o where o.channel = 'email' and o.status = 'skipped'
                           and private.email_key(o.to_address) = e.email and o.last_error ~* 'unsubscribed'))
      from public.email_optout e
      left join lateral (select m.id, m.name from auth.users u join public.members m on m.id = u.id
                          where private.email_key(u.email::text) = e.email limit 1) mb on true
      left join lateral (select i.full_name, i.handle, cp.name campaign from intel.ci_campaign_invite i
                           left join intel.ci_campaign cp on cp.campaign_id = i.campaign_id
                          where private.email_key(i.email) = e.email order by i.created_at desc limit 1) inv on true
  ) q), '[]'::jsonb);
end $$;
revoke all on function public.admin_optouts() from public, anon;
grant execute on function public.admin_optouts() to authenticated;

-- Super Admin: switch someone back on (only when they asked for it)
create or replace function public.admin_optout_clear(p_channel text, p_to text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then raise exception 'not a platform admin' using errcode = '42501'; end if;
  if p_channel = 'whatsapp' then
    delete from public.wa_phone_optout where phone_e164 = private.wa_phone_key(p_to);
    update public.wa_contacts set opt_out_at = null, opt_in_at = now() where private.wa_phone_key(phone_e164) = private.wa_phone_key(p_to);
  elsif p_channel = 'email' then
    delete from public.email_optout where email = private.email_key(p_to);
    update public.members m set email_opt_out_at = null from auth.users u
     where u.id = m.id and private.email_key(u.email::text) = private.email_key(p_to);
  end if;
end $$;
revoke all on function public.admin_optout_clear(text, text) from public, anon;
grant execute on function public.admin_optout_clear(text, text) to authenticated;

revoke all on function private.email_key(text), private.email_outbox_respect_optout() from public, anon, authenticated;
