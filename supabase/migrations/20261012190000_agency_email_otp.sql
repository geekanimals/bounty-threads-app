-- Agency / Brand onboarding: WhatsApp OTP (step 1) + official email OTP (step 2, first time only), then the
-- Super Admin approves. ADDITIVE. Email OTP mirrors the hardened WhatsApp OTP: only a peppered hash is
-- stored, verification is atomic (row lock), per-code and per-hour attempt caps, per-member/email/global
-- send limits. Codes are delivered by the email-otp-start Edge Function over SMTP.

alter table public.members add column if not exists official_email text;
alter table public.members add column if not exists email_verified_at timestamptz;
alter table public.members add column if not exists whatsapp_e164 text;

create table if not exists public.email_otp (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references auth.users(id) on delete cascade,
  email       text not null,
  code_hash   text not null,
  expires_at  timestamptz not null,
  attempts    int not null default 0,
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists email_otp_member_idx on public.email_otp(member_id, created_at desc);
create index if not exists email_otp_email_idx  on public.email_otp(lower(email), created_at desc);
alter table public.email_otp enable row level security;
revoke all on public.email_otp from public, anon, authenticated;
grant select, insert, update, delete on public.email_otp to service_role;

-- returns 'ok' | 'rate_member' | 'rate_email' | 'rate_global'
create or replace function public.email_otp_issue(p_member uuid, p_email text, p_code_hash text)
returns text language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'bad email' using errcode = '22023'; end if;
  if coalesce(length(p_code_hash),0) <> 64 then raise exception 'bad hash' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('email_otp:' || p_member::text, 0));
  select count(*) into n from public.email_otp where member_id = p_member and created_at > now() - interval '10 minutes';
  if n >= 5 then return 'rate_member'; end if;
  select count(*) into n from public.email_otp where lower(email) = lower(p_email) and created_at > now() - interval '1 hour';
  if n >= 8 then return 'rate_email'; end if;
  select count(*) into n from public.email_otp where created_at > now() - interval '1 hour';
  if n >= 300 then return 'rate_global'; end if;
  update public.email_otp set consumed_at = now() where member_id = p_member and consumed_at is null;
  insert into public.email_otp(member_id, email, code_hash, expires_at) values (p_member, lower(p_email), p_code_hash, now() + interval '10 minutes');
  return 'ok';
end $$;
revoke all on function public.email_otp_issue(uuid,text,text) from public, anon, authenticated;
grant execute on function public.email_otp_issue(uuid,text,text) to service_role;

-- returns 'ok' | 'no_code' | 'expired' | 'locked' | 'bad' ; on ok also returns the verified email via out param
create or replace function public.email_otp_check(p_member uuid, p_code_hash text, out status text, out email text)
language plpgsql security definer set search_path = '' as $$
declare r public.email_otp%rowtype; recent_fail int;
begin
  select coalesce(sum(attempts),0) into recent_fail from public.email_otp where member_id = p_member and created_at > now() - interval '1 hour';
  if recent_fail >= 10 then status := 'locked'; return; end if;
  select * into r from public.email_otp where member_id = p_member and consumed_at is null order by created_at desc limit 1 for update;
  if not found then status := 'no_code'; return; end if;
  if r.expires_at < now() then status := 'expired'; return; end if;
  if r.attempts >= 5 then status := 'locked'; return; end if;
  if r.code_hash = p_code_hash then
    update public.email_otp set consumed_at = now() where id = r.id;
    status := 'ok'; email := r.email; return;
  end if;
  update public.email_otp set attempts = attempts + 1 where id = r.id;
  status := 'bad';
end $$;
revoke all on function public.email_otp_check(uuid,text) from public, anon, authenticated;
grant execute on function public.email_otp_check(uuid,text) to service_role;

-- the Super Admin approval queue shows the verified official email + WhatsApp
create or replace function public.pending_members_v2()
returns table(id uuid, name text, email text, official_email text, email_verified_at timestamptz, whatsapp_e164 text,
              role text, org_name text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then raise exception 'not a platform admin' using errcode = '42501'; end if;
  return query select m.id, m.name, m.email, m.official_email, m.email_verified_at, m.whatsapp_e164, m.role, m.org_name, m.created_at
                 from public.members m where m.status = 'pending' order by m.created_at desc;
end $$;
revoke all on function public.pending_members_v2() from public, anon;
grant execute on function public.pending_members_v2() to authenticated;
