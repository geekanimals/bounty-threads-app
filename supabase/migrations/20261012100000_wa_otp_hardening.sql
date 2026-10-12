-- WhatsApp OTP hardening. ADDITIVE + reversible. Service-role only.
--   1. Atomic verify (row lock): parallel guesses can no longer all read attempts=0 and bypass the 5-try cap.
--   2. Per-phone rolling lockout across codes (10 wrong guesses / hour), so re-requesting codes does not
--      reset the brute-force budget.
--   3. Atomic issue with per-phone, per-IP and global rate limits (SMS-pumping / WhatsApp-cost abuse).
--   4. IP stored only as a peppered hash (computed at the Edge); old rows purged daily.

alter table public.wa_otp add column if not exists ip_hash text;
create index if not exists wa_otp_ip_idx      on public.wa_otp(ip_hash, created_at desc) where ip_hash is not null;
create index if not exists wa_otp_created_idx on public.wa_otp(created_at);

-- wa_otp is never client-readable (RLS on, no policies) — make the grants explicit too.
revoke all on public.wa_otp from public, anon, authenticated;
grant select, insert, update, delete on public.wa_otp to service_role;

-- ---------- issue: rate-limit + insert in one transaction ----------
-- returns 'ok' | 'rate_phone' | 'rate_ip' | 'rate_global'
create or replace function public.wa_otp_issue(
  p_phone text, p_code_hash text, p_ip_hash text,
  p_ttl_seconds int default 600,
  p_phone_max int default 5,    -- per phone / 10 min
  p_ip_max int default 10,      -- per IP / hour
  p_global_max int default 500  -- whole platform / hour
) returns text language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if p_phone !~ '^\+[1-9][0-9]{7,15}$' then raise exception 'bad phone' using errcode = '22023'; end if;
  if coalesce(length(p_code_hash), 0) <> 64 then raise exception 'bad hash' using errcode = '22023'; end if;
  -- serialise issuers for the same phone (count-then-insert is otherwise racy)
  perform pg_advisory_xact_lock(hashtextextended('wa_otp:' || p_phone, 0));

  select count(*) into n from public.wa_otp where phone_e164 = p_phone and created_at > now() - interval '10 minutes';
  if n >= p_phone_max then return 'rate_phone'; end if;

  if p_ip_hash is not null then
    select count(*) into n from public.wa_otp where ip_hash = p_ip_hash and created_at > now() - interval '1 hour';
    if n >= p_ip_max then return 'rate_ip'; end if;
  end if;

  select count(*) into n from public.wa_otp where created_at > now() - interval '1 hour';
  if n >= p_global_max then return 'rate_global'; end if;

  -- a new code supersedes any still-open one for this phone
  update public.wa_otp set consumed_at = now()
   where phone_e164 = p_phone and consumed_at is null;

  insert into public.wa_otp(phone_e164, code_hash, expires_at, ip_hash)
  values (p_phone, p_code_hash, now() + make_interval(secs => greatest(60, least(p_ttl_seconds, 900))), p_ip_hash);
  return 'ok';
end $$;
revoke all on function public.wa_otp_issue(text,text,text,int,int,int,int) from public, anon, authenticated;
grant execute on function public.wa_otp_issue(text,text,text,int,int,int,int) to service_role;

-- ---------- check: lock latest code, count the attempt, consume on match ----------
-- returns 'ok' | 'no_code' | 'expired' | 'locked' | 'bad'
create or replace function public.wa_otp_check(p_phone text, p_code_hash text)
returns text language plpgsql security definer set search_path = '' as $$
declare r public.wa_otp%rowtype; recent_fail int;
begin
  -- rolling per-phone lockout across all codes
  select coalesce(sum(attempts), 0) into recent_fail
    from public.wa_otp where phone_e164 = p_phone and created_at > now() - interval '1 hour';
  if recent_fail >= 10 then return 'locked'; end if;

  select * into r from public.wa_otp
   where phone_e164 = p_phone and consumed_at is null
   order by created_at desc limit 1
   for update;                                   -- concurrent verifies queue here
  if not found then return 'no_code'; end if;
  if r.expires_at < now() then return 'expired'; end if;
  if r.attempts >= 5 then return 'locked'; end if;

  if r.code_hash = p_code_hash then
    update public.wa_otp set consumed_at = now() where id = r.id;
    return 'ok';
  end if;
  update public.wa_otp set attempts = attempts + 1 where id = r.id;
  return 'bad';
end $$;
revoke all on function public.wa_otp_check(text,text) from public, anon, authenticated;
grant execute on function public.wa_otp_check(text,text) to service_role;

-- ---------- housekeeping (scheduled daily via pg_cron, see runbook) ----------
create or replace function public.wa_otp_purge()
returns int language sql security definer set search_path = '' as $$
  with d as (delete from public.wa_otp where created_at < now() - interval '1 day' returning 1)
  select count(*)::int from d $$;
revoke all on function public.wa_otp_purge() from public, anon, authenticated;
grant execute on function public.wa_otp_purge() to service_role, postgres;
