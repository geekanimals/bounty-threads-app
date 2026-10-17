-- Instagram connect that survives a browser switch (phones).
-- On a phone the Instagram link often opens the Instagram APP, and when the app hands back it can land in a
-- different browser (Instagram's in-app browser, Safari instead of Chrome…) where the creator is not signed in
-- and the one-time "state" saved before leaving is missing — so the connect was silently dropped.
-- Now, before leaving for Instagram, a signed-in member gets a short-lived one-time ticket that travels inside
-- the OAuth state. When the code comes back without a session, instagram-login uses the ticket to connect the
-- Instagram to THAT member (never a new placeholder account) and signs the creator in on that browser.
--   • ticket is random (CSPRNG), only its sha256 is stored · single use · 15 minutes
-- ADDITIVE.

create table if not exists private.ig_connect_ticket (
  ticket_hash text primary key,
  member_id   uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  used_at     timestamptz
);
alter table private.ig_connect_ticket enable row level security;
revoke all on private.ig_connect_ticket from public, anon, authenticated;

-- signed-in member → a fresh ticket (raw value returned once, only its hash kept)
create or replace function public.ig_connect_begin()
returns text language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_t text;
begin
  if v_uid is null then return null; end if;
  delete from private.ig_connect_ticket where created_at < now() - interval '1 day';
  v_t := encode(extensions.gen_random_bytes(24), 'hex');
  insert into private.ig_connect_ticket(ticket_hash, member_id)
  values (encode(extensions.digest(v_t, 'sha256'), 'hex'), v_uid);
  return v_t;
end $$;

-- server only (instagram-login, service role): ticket → member, burns it
create or replace function public.ig_connect_claim(p_ticket text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_m uuid;
begin
  if coalesce(p_ticket, '') !~ '^[0-9a-f]{48}$' then return null; end if;
  update private.ig_connect_ticket set used_at = now()
   where ticket_hash = encode(extensions.digest(p_ticket, 'sha256'), 'hex')
     and used_at is null and created_at > now() - interval '15 minutes'
  returning member_id into v_m;
  return v_m;
end $$;

revoke all on function public.ig_connect_begin(), public.ig_connect_claim(text) from public, anon, authenticated;
grant execute on function public.ig_connect_begin() to authenticated;
grant execute on function public.ig_connect_claim(text) to service_role;
