-- "Reply STOP to stop WhatsApp updates" works for EVERY number — registered creators and people who were only
-- invited from a bulk sheet (they have no account yet). STOP / UNSUBSCRIBE / STOP ALL / OPT OUT (any case, with
-- or without punctuation, typed or tapped as a button) → no more WhatsApp messages to that number; START turns
-- them back on. Pure database: works with the existing wa-webhook (it records every inbound message).
-- ADDITIVE.

create table if not exists public.wa_phone_optout (
  phone_e164   text primary key,
  opt_out_at   timestamptz not null default now(),
  keyword      text
);
alter table public.wa_phone_optout enable row level security;
revoke all on public.wa_phone_optout from anon, authenticated;

create or replace function private.wa_phone_key(p text) returns text language sql immutable set search_path = '' as $$
  select case when coalesce(regexp_replace(p, '\D', '', 'g'), '') = '' then null else '+' || regexp_replace(p, '\D', '', 'g') end
$$;

-- 1) an inbound WhatsApp message that is a STOP / START keyword
create or replace function private.wa_inbound_keyword() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_phone text; v_kw text;
begin
  if new.direction <> 'inbound' then return new; end if;
  v_kw := upper(btrim(regexp_replace(regexp_replace(coalesce(new.body, ''), '[^A-Za-z ]', '', 'g'), '\s+', ' ', 'g')));
  if v_kw not in ('STOP', 'STOP ALL', 'STOP UPDATES', 'UNSUBSCRIBE', 'OPT OUT', 'OPTOUT', 'START', 'SUBSCRIBE', 'UNSTOP') then return new; end if;
  select private.wa_phone_key(c.contact_phone_e164) into v_phone from public.wa_conversations c where c.id = new.conversation_id;
  if v_phone is null then return new; end if;
  if v_kw in ('START', 'SUBSCRIBE', 'UNSTOP') then
    delete from public.wa_phone_optout where phone_e164 = v_phone;
    update public.wa_contacts set opt_out_at = null, opt_in_at = now() where private.wa_phone_key(phone_e164) = v_phone;
  else
    insert into public.wa_phone_optout(phone_e164, opt_out_at, keyword) values (v_phone, now(), v_kw)
      on conflict (phone_e164) do update set opt_out_at = now(), keyword = excluded.keyword;
    update public.wa_contacts set opt_out_at = now() where private.wa_phone_key(phone_e164) = v_phone and opt_out_at is null;
    update intel.ci_outbox set status = 'skipped', last_error = 'opted out (replied ' || v_kw || ')', updated_at = now()
     where channel = 'whatsapp' and status = 'queued' and private.wa_phone_key(to_address) = v_phone;
  end if;
  return new;
end $$;
drop trigger if exists wa_inbound_keyword on public.wa_messages;
create trigger wa_inbound_keyword after insert on public.wa_messages for each row execute function private.wa_inbound_keyword();

-- 2) nothing new is queued on WhatsApp for a number that said STOP (invites, updates, reminders — everything)
create or replace function private.wa_outbox_respect_optout() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.channel = 'whatsapp' and new.status = 'queued'
     and exists (select 1 from public.wa_phone_optout o where o.phone_e164 = private.wa_phone_key(new.to_address)) then
    new.status := 'skipped'; new.last_error := 'opted out (replied STOP)';
  end if;
  return new;
end $$;
drop trigger if exists wa_outbox_respect_optout on intel.ci_outbox;
create trigger wa_outbox_respect_optout before insert on intel.ci_outbox for each row execute function private.wa_outbox_respect_optout();

-- 3) someone who said STOP before registering stays opted out after they sign up
create or replace function private.wa_contact_inherit_optout() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_at timestamptz;
begin
  select o.opt_out_at into v_at from public.wa_phone_optout o where o.phone_e164 = private.wa_phone_key(new.phone_e164);
  if v_at is not null and new.opt_out_at is null then new.opt_out_at := v_at; end if;
  return new;
end $$;
drop trigger if exists wa_contact_inherit_optout on public.wa_contacts;
create trigger wa_contact_inherit_optout before insert on public.wa_contacts for each row execute function private.wa_contact_inherit_optout();

-- registered creators who already said STOP are carried over
insert into public.wa_phone_optout(phone_e164, opt_out_at, keyword)
select private.wa_phone_key(phone_e164), min(opt_out_at), 'STOP' from public.wa_contacts
 where opt_out_at is not null and private.wa_phone_key(phone_e164) is not null group by 1
on conflict (phone_e164) do nothing;

revoke all on function private.wa_phone_key(text), private.wa_inbound_keyword(), private.wa_outbox_respect_optout(),
                       private.wa_contact_inherit_optout() from public, anon, authenticated;
