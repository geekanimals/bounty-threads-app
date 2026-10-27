-- ⏸ Pause messages for ONE creator (Super Admin). One switch stops WhatsApp AND email for that creator, everywhere:
-- every campaign update, reminder, invite, payment message, the team's hand-typed WhatsApp chat and the WhatsApp bot.
-- Only login / OTP / password-recovery codes still go. ▶ Resume turns both back on. Messages skipped while paused are
-- not sent later (same as the Settings switches). Works for creators on Geek OS and for people only invited from a sheet.
-- ADDITIVE.

create table if not exists private.creator_msg_pause (
  pause_id   uuid primary key default gen_random_uuid(),
  member_id  uuid references auth.users(id) on delete cascade,
  phone_e164 text,
  email      text,
  name       text,
  note       text,
  paused_by  uuid references auth.users(id) on delete set null,
  paused_at  timestamptz not null default now(),
  check (member_id is not null or phone_e164 is not null or email is not null)
);
create index if not exists creator_msg_pause_member_idx on private.creator_msg_pause(member_id) where member_id is not null;
create index if not exists creator_msg_pause_phone_idx on private.creator_msg_pause(phone_e164) where phone_e164 is not null;
create index if not exists creator_msg_pause_email_idx on private.creator_msg_pause(email) where email is not null;
alter table private.creator_msg_pause enable row level security;
revoke all on private.creator_msg_pause from public, anon, authenticated;

-- is this recipient paused? (by account, WhatsApp number or email)
create or replace function private.creator_paused(p_member uuid, p_addr text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.creator_msg_pause c
                  where (p_member is not null and c.member_id = p_member)
                     or (p_addr is not null and (c.phone_e164 = p_addr or c.email = lower(btrim(p_addr))))) $$;

-- the queue: a paused creator's WhatsApp / email is skipped (codes excepted)
create or replace function private.outbox_creator_pause() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'queued' and new.channel in ('whatsapp', 'email')
     and coalesce(new.template_key, '') !~* 'otp|login|recovery|password'
     and private.creator_paused(new.recipient_member_id, new.to_address) then
    new.status := 'skipped'; new.last_error := 'paused: messages are paused for this creator (Super Admin)';
  end if;
  return new;
end $$;
drop trigger if exists outbox_creator_pause on intel.ci_outbox;
create trigger outbox_creator_pause before insert or update of status on intel.ci_outbox
  for each row execute function private.outbox_creator_pause();

-- who a row on the screen is: account + WhatsApp + email (from a campaign creator, an uploaded invite or an account)
create or replace function private.creator_contacts(p_participation uuid, p_invite uuid, p_member uuid)
returns table(member_id uuid, phone text, email text, name text) language plpgsql stable security definer set search_path = '' as $$
declare v_m uuid := p_member; v_id uuid; v_ph text; v_em text; v_name text; i intel.ci_campaign_invite%rowtype;
begin
  if p_invite is not null then
    select * into i from intel.ci_campaign_invite where invite_id = p_invite;
    if found then
      v_ph := i.phone_e164; v_em := nullif(lower(btrim(coalesce(i.email, ''))), ''); v_name := coalesce(i.full_name, '@' || i.handle);
      if p_participation is null then p_participation := i.participation_id; end if;
    end if;
  end if;
  if p_participation is not null then
    select p.identity_id into v_id from intel.ci_campaign_participation p where p.participation_id = p_participation;
    if v_m is null and v_id is not null then
      select a.member_id into v_m from intel.ci_identity_actor_access a
       where a.identity_id = v_id and a.access_role = 'self' and a.revoked_at is null order by a.granted_at limit 1;
    end if;
  end if;
  if v_m is not null then
    v_ph := coalesce(v_ph, intel.ci_wa_number(v_m));
    select coalesce(v_em, nullif(lower(u.email::text), '')), coalesce(v_name, nullif(m.name, ''))
      into v_em, v_name from public.members m left join auth.users u on u.id = m.id where m.id = v_m;
    if v_id is null then v_id := intel.ci_member_identity(v_m); end if;
  end if;
  if v_id is not null then
    select coalesce(v_ph, c.whatsapp_e164), coalesce(v_em, nullif(lower(c.email), '')) into v_ph, v_em
      from private.creator_contact c where c.identity_id = v_id;
  end if;
  if v_em ~* '@creators\.bountythreads\.app$' then v_em := null; end if;   -- placeholder login emails never get mail
  return query select v_m, v_ph, v_em, v_name;
end $$;

-- Super Admin: pause / resume one creator. p: {participation?, invite?, member?, on: true = pause | false = resume, note?}
create or replace function api.admin_msg_pause(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c record; v_on boolean := coalesce((p->>'on')::boolean, true); v_n int := 0;
begin
  if not public.is_platform_admin() then raise exception 'only a Super Admin can pause a creator''s messages' using errcode = '42501'; end if;
  select * into c from private.creator_contacts(nullif(p->>'participation', '')::uuid, nullif(p->>'invite', '')::uuid, nullif(p->>'member', '')::uuid);
  if c.member_id is null and c.phone is null and c.email is null then
    raise exception 'no WhatsApp number, email or account found for this creator' using errcode = '22023';
  end if;
  if v_on then
    if not exists (select 1 from private.creator_msg_pause x where (c.member_id is not null and x.member_id = c.member_id)
                      or (c.phone is not null and x.phone_e164 = c.phone) or (c.email is not null and x.email = c.email)) then
      insert into private.creator_msg_pause(member_id, phone_e164, email, name, note, paused_by)
      values (c.member_id, c.phone, c.email, c.name, nullif(btrim(coalesce(p->>'note', '')), ''), auth.uid());
    end if;
    -- whatever is already waiting for them stops now
    update intel.ci_outbox o set status = 'skipped', last_error = 'paused: messages are paused for this creator (Super Admin)'
     where o.status = 'queued' and o.channel in ('whatsapp', 'email') and coalesce(o.template_key, '') !~* 'otp|login|recovery|password'
       and ((c.member_id is not null and o.recipient_member_id = c.member_id) or o.to_address in (c.phone, c.email));
    get diagnostics v_n = row_count;
  else
    delete from private.creator_msg_pause x where (c.member_id is not null and x.member_id = c.member_id)
       or (c.phone is not null and x.phone_e164 = c.phone) or (c.email is not null and x.email = c.email);
  end if;
  begin
    insert into public.activity_log(member_id, kind, event, detail)
    values (auth.uid(), 'security', 'creator_messages_' || case when v_on then 'paused' else 'resumed' end,
            jsonb_build_object('member', c.member_id, 'name', c.name, 'stopped_now', v_n));
  exception when others then null; end;
  return jsonb_build_object('paused', v_on, 'name', c.name, 'whatsapp', c.phone is not null, 'email', c.email is not null, 'stopped_now', v_n);
end $$;
revoke all on function api.admin_msg_pause(jsonb) from public, anon;
grant execute on function api.admin_msg_pause(jsonb) to authenticated;

-- Super Admin: everyone paused (the app marks their rows / buttons from this)
create or replace function api.admin_msg_pauses()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then raise exception 'not a platform admin' using errcode = '42501'; end if;
  return jsonb_build_object(
    'rows', coalesce((select jsonb_agg(jsonb_build_object('member', x.member_id, 'phone', x.phone_e164, 'email', x.email, 'name', x.name,
               'note', x.note, 'paused_at', x.paused_at,
               'by', (select coalesce(nullif(m.name, ''), m.org_name) from public.members m where m.id = x.paused_by)) order by x.paused_at desc)
             from private.creator_msg_pause x), '[]'::jsonb),
    'participations', coalesce((select jsonb_agg(distinct p.participation_id)
             from private.creator_msg_pause x
             join intel.ci_identity_actor_access a on a.member_id = x.member_id and a.access_role = 'self' and a.revoked_at is null
             join intel.ci_campaign_participation p on p.identity_id = a.identity_id), '[]'::jsonb),
    'invites', coalesce((select jsonb_agg(distinct i.invite_id) from private.creator_msg_pause x
             join intel.ci_campaign_invite i on (x.phone_e164 is not null and i.phone_e164 = x.phone_e164)
                                             or (x.email is not null and lower(i.email) = x.email)), '[]'::jsonb));
end $$;
revoke all on function api.admin_msg_pauses() from public, anon;
grant execute on function api.admin_msg_pauses() to authenticated;

-- workers (WhatsApp chat send, bot): is this number / email paused?
create or replace function api.ops_contact_paused(p_addr text)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.creator_paused((select w.user_id from public.wa_contacts w where w.phone_e164 = p_addr limit 1), p_addr) $$;
revoke all on function api.ops_contact_paused(text) from public, anon, authenticated;
grant execute on function api.ops_contact_paused(text) to service_role;

revoke all on function private.creator_paused(uuid, text), private.outbox_creator_pause(),
                       private.creator_contacts(uuid, uuid, uuid) from public, anon, authenticated;
