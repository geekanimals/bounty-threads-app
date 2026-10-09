-- WhatsApp messaging foundation. ADDITIVE. Backend = Meta WhatsApp Cloud API (provider-agnostic at the Edge).
-- Two capabilities: (1) WhatsApp OTP login, (2) 1:1 integrated chat (agency/brand <-> a creator on WhatsApp).
-- Phone numbers are PII -> RLS-scoped to the owner/org; raw OTP codes are never stored (hash only).
-- Messages are written by the server (Edge Functions, service role); clients read via RLS + Realtime.

-- ---------- verified WhatsApp phone per app user (login + messaging target) ----------
create table if not exists public.wa_contacts (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  phone_e164  text not null,
  verified_at timestamptz,
  opt_in_at   timestamptz,                 -- explicit consent to be messaged on WhatsApp
  opt_out_at  timestamptz,
  display_name text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint wa_contacts_phone_uq unique (phone_e164),
  constraint wa_contacts_e164_ck  check (phone_e164 ~ '^\+[1-9][0-9]{7,15}$')
);

-- ---------- conversations: one app-side org/user <-> one external WhatsApp contact ----------
create table if not exists public.wa_conversations (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid,                         -- owning org (agency/brand) for RLS; set from my_org()
  campaign_id      uuid,                         -- soft link, optional
  subject          text,
  created_by       uuid references auth.users(id) on delete set null,
  contact_phone_e164 text not null,              -- the external party's WhatsApp number
  contact_user_id  uuid references auth.users(id) on delete set null,  -- set if that party is also an app user
  last_message_at  timestamptz,
  session_expires_at timestamptz,                -- Meta 24h customer-service window (freeform allowed until then)
  created_at       timestamptz not null default now(),
  constraint wa_conv_phone_ck check (contact_phone_e164 ~ '^\+[1-9][0-9]{7,15}$')
);
create index if not exists wa_conv_org_idx     on public.wa_conversations(org_id, last_message_at desc nulls last);
create index if not exists wa_conv_contact_idx on public.wa_conversations(contact_phone_e164);
create unique index if not exists wa_conv_uq   on public.wa_conversations(org_id, contact_phone_e164, coalesce(campaign_id,'00000000-0000-0000-0000-000000000000'::uuid));

-- ---------- messages (server-written; clients read via RLS + Realtime) ----------
create table if not exists public.wa_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.wa_conversations(id) on delete cascade,
  sender_user_id  uuid references auth.users(id) on delete set null,   -- null = inbound from external WhatsApp
  direction       text not null check (direction in ('outbound','inbound')),
  body            text,
  media_url       text,
  wa_message_id   text,                          -- Meta wamid; dedupes inbound + status callbacks
  status          text not null default 'queued'
                    check (status in ('queued','sent','delivered','read','failed','received')),
  error           text,
  created_at      timestamptz not null default now(),
  delivered_at    timestamptz,
  read_at         timestamptz,
  constraint wa_messages_wamid_uq unique (wa_message_id)
);
create index if not exists wa_msg_conv_idx on public.wa_messages(conversation_id, created_at);

-- ---------- OTP for WhatsApp login (hashed code, short-lived, rate-limited) ----------
create table if not exists public.wa_otp (
  id          uuid primary key default gen_random_uuid(),
  phone_e164  text not null,
  code_hash   text not null,                     -- digest(code || pepper); the code itself is never stored
  expires_at  timestamptz not null,
  attempts    int not null default 0,
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists wa_otp_phone_idx on public.wa_otp(phone_e164, created_at desc);

-- keep updated_at fresh on wa_contacts
create or replace function public.wa_touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists wa_contacts_touch on public.wa_contacts;
create trigger wa_contacts_touch before update on public.wa_contacts for each row execute function public.wa_touch_updated_at();

-- ---------- RLS ----------
alter table public.wa_contacts      enable row level security;
alter table public.wa_conversations enable row level security;
alter table public.wa_messages      enable row level security;
alter table public.wa_otp           enable row level security;   -- no policies => client-inaccessible (service role only)

-- a user may see/manage only their own contact row
drop policy if exists wa_contacts_own on public.wa_contacts;
create policy wa_contacts_own on public.wa_contacts for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- a conversation is visible to: its owning org members, its creator, or the external party if they're an app user
drop policy if exists wa_conv_read on public.wa_conversations;
create policy wa_conv_read on public.wa_conversations for select to authenticated
  using (org_id = public.my_org() or created_by = auth.uid() or contact_user_id = auth.uid());

-- messages are visible to anyone who can see their conversation
drop policy if exists wa_msg_read on public.wa_messages;
create policy wa_msg_read on public.wa_messages for select to authenticated
  using (exists (select 1 from public.wa_conversations c where c.id = conversation_id
                 and (c.org_id = public.my_org() or c.created_by = auth.uid() or c.contact_user_id = auth.uid())));
-- (no client INSERT/UPDATE policy on wa_messages: all writes go through the Edge Functions as service_role)

-- ---------- find-or-create a conversation for the caller's org (SECURITY DEFINER) ----------
create or replace function public.wa_get_or_create_conversation(p_contact_phone text, p_campaign_id uuid default null, p_subject text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_uid uuid; v_cuid uuid; v_id uuid;
begin
  v_uid := auth.uid(); if v_uid is null then raise exception 'unauthenticated' using errcode='28000'; end if;
  if p_contact_phone !~ '^\+[1-9][0-9]{7,15}$' then raise exception 'phone must be E.164 (e.g. +919812345678)' using errcode='22023'; end if;
  v_org := public.my_org();
  select user_id into v_cuid from public.wa_contacts where phone_e164 = p_contact_phone;  -- link if the contact is an app user
  select id into v_id from public.wa_conversations
    where org_id = v_org and contact_phone_e164 = p_contact_phone
      and coalesce(campaign_id,'00000000-0000-0000-0000-000000000000'::uuid) = coalesce(p_campaign_id,'00000000-0000-0000-0000-000000000000'::uuid);
  if v_id is null then
    insert into public.wa_conversations(org_id, campaign_id, subject, created_by, contact_phone_e164, contact_user_id)
      values (v_org, p_campaign_id, p_subject, v_uid, p_contact_phone, v_cuid)
      returning id into v_id;
  end if;
  return v_id;
end $$;
revoke all on function public.wa_get_or_create_conversation(text,uuid,text) from public, anon;
grant execute on function public.wa_get_or_create_conversation(text,uuid,text) to authenticated, service_role;

-- ---------- grants (Supabase also applies schema defaults; be explicit) ----------
grant select, insert, update on public.wa_contacts to authenticated;
grant select on public.wa_conversations to authenticated;
grant select on public.wa_messages to authenticated;
grant select, insert, update, delete on all tables in schema public to service_role;

-- ---------- Realtime (clients subscribe to new messages/conversations) ----------
do $$ begin
  if exists (select 1 from pg_publication where pubname='supabase_realtime') then
    begin execute 'alter publication supabase_realtime add table public.wa_messages'; exception when duplicate_object then null; end;
    begin execute 'alter publication supabase_realtime add table public.wa_conversations'; exception when duplicate_object then null; end;
  end if;
end $$;
