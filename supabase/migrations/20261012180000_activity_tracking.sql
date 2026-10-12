-- Activity tracking for the Super Admin. ADDITIVE.
--   security  — always recorded (sign-in, sign-out, Instagram connect, publish, apply, contract): legitimate
--               security/fraud purpose, disclosed in the privacy policy and the cookie banner.
--   analytics — page views and time spent: recorded ONLY while the user's latest consent choice is "all"
--               (enforced here in the database, not just in the browser).
--   consent   — every banner choice, for the audit trail.
-- IP + user agent are read server-side from the request headers (not trusted from the client). City/region/
-- country come from Vercel's edge geo (/api/geo) and are approximate. Only platform admins can read the log.

create table if not exists public.activity_log (
  id          bigserial primary key,
  member_id   uuid not null references auth.users(id) on delete cascade,
  kind        text not null check (kind in ('security','analytics','consent')),
  event       text not null,
  page        text,
  detail      jsonb not null default '{}'::jsonb,
  duration_ms int,
  session_id  text,
  ip          text,
  user_agent  text,
  city        text,
  region      text,
  country     text,
  created_at  timestamptz not null default now()
);
create index if not exists activity_log_member_idx on public.activity_log(member_id, created_at desc);
create index if not exists activity_log_kind_idx   on public.activity_log(kind, created_at desc);
alter table public.activity_log enable row level security;          -- no policies: clients can't read/write
revoke all on public.activity_log from public, anon, authenticated;
grant select, insert, delete on public.activity_log to service_role;
grant usage, select on sequence public.activity_log_id_seq to service_role;

-- latest consent choice per member ('all' | 'essential' | null)
create or replace function public.activity_consent_of(p_member uuid)
returns text language sql stable security definer set search_path = '' as $$
  select detail->>'choice' from public.activity_log
   where member_id = p_member and kind = 'consent' order by created_at desc limit 1 $$;
revoke all on function public.activity_consent_of(uuid) from public, anon, authenticated;

-- client batch writer: [{kind, event, page?, detail?, duration_ms?, session_id?, city?, region?, country?}, …]
create or replace function public.log_activity(p_events jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid(); v_hdr jsonb; v_ip text; v_ua text; e jsonb; v_n int := 0; v_consent text; v_recent int;
begin
  if v_uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  if jsonb_typeof(p_events) <> 'array' then raise exception 'events must be an array' using errcode = '22023'; end if;
  -- abuse guard: ≤ 50 events per call, ≤ 1500 per member per hour
  select count(*) into v_recent from public.activity_log where member_id = v_uid and created_at > now() - interval '1 hour';
  if v_recent > 1500 then return 0; end if;

  begin v_hdr := current_setting('request.headers', true)::jsonb; exception when others then v_hdr := '{}'::jsonb; end;
  v_ip := coalesce(nullif(split_part(coalesce(v_hdr->>'x-forwarded-for',''), ',', 1), ''), v_hdr->>'cf-connecting-ip', v_hdr->>'x-real-ip');
  v_ua := left(v_hdr->>'user-agent', 300);

  for e in select * from jsonb_array_elements(p_events) limit 50 loop
    continue when coalesce(e->>'kind','') not in ('security','analytics','consent');
    if e->>'kind' = 'analytics' then
      v_consent := public.activity_consent_of(v_uid);
      continue when coalesce(v_consent, '') <> 'all';               -- no consent → analytics dropped
    end if;
    insert into public.activity_log(member_id, kind, event, page, detail, duration_ms, session_id, ip, user_agent, city, region, country)
    values (v_uid, e->>'kind', left(coalesce(e->>'event','event'), 60), left(e->>'page', 60),
            case when jsonb_typeof(e->'detail') = 'object' and length((e->'detail')::text) <= 2000 then e->'detail' else '{}'::jsonb end,
            least(greatest(coalesce((e->>'duration_ms')::int, 0), 0), 300000),
            left(e->>'session_id', 40), left(v_ip, 64), v_ua,
            left(e->>'city', 80), left(e->>'region', 80), left(e->>'country', 8));
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function public.log_activity(jsonb) from public, anon;
grant execute on function public.log_activity(jsonb) to authenticated;

-- Super Admin: one row per creator (and any other member who has activity)
create or replace function public.admin_activity_summary(p_days int default 30)
returns table(member_id uuid, name text, email text, role text, ig_username text, last_seen timestamptz,
              sessions bigint, minutes numeric, page_views bigint, last_ip text, last_city text, last_region text,
              last_country text, consent text, last_event text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then raise exception 'not a platform admin' using errcode = '42501'; end if;
  return query
  with a as (select * from public.activity_log where created_at > now() - make_interval(days => greatest(p_days,1)))
  select a.member_id, m.name, coalesce(m.email, u.email)::text, m.role, sa.username,
         max(a.created_at), count(distinct a.session_id),
         round(coalesce(sum(a.duration_ms) filter (where a.event = 'time'), 0) / 60000.0, 1),
         count(*) filter (where a.event = 'page_view'),
         (array_agg(a.ip order by a.created_at desc))[1],
         (array_agg(a.city order by a.created_at desc) filter (where a.city is not null))[1],
         (array_agg(a.region order by a.created_at desc) filter (where a.region is not null))[1],
         (array_agg(a.country order by a.created_at desc) filter (where a.country is not null))[1],
         public.activity_consent_of(a.member_id),
         (array_agg(a.event order by a.created_at desc))[1]
    from a
    join auth.users u on u.id = a.member_id
    left join public.members m on m.id = a.member_id
    left join public.social_accounts sa on sa.member_id = a.member_id and sa.platform = 'instagram'
   group by a.member_id, m.name, m.email, u.email, m.role, sa.username
   order by max(a.created_at) desc;
end $$;
revoke all on function public.admin_activity_summary(int) from public, anon;
grant execute on function public.admin_activity_summary(int) to authenticated;

-- Super Admin: one member's timeline
create or replace function public.admin_activity_timeline(p_member uuid, p_limit int default 200)
returns setof public.activity_log language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then raise exception 'not a platform admin' using errcode = '42501'; end if;
  return query select * from public.activity_log where member_id = p_member
                order by created_at desc limit least(greatest(p_limit,1), 1000);
end $$;
revoke all on function public.admin_activity_timeline(uuid, int) from public, anon;
grant execute on function public.admin_activity_timeline(uuid, int) to authenticated;

-- retention: analytics 180 days, security 365 days (daily)
create or replace function public.activity_log_purge()
returns int language sql security definer set search_path = '' as $$
  with d as (delete from public.activity_log
              where (kind = 'analytics' and created_at < now() - interval '180 days')
                 or (kind <> 'analytics' and created_at < now() - interval '365 days') returning 1)
  select count(*)::int from d $$;
revoke all on function public.activity_log_purge() from public, anon, authenticated;
grant execute on function public.activity_log_purge() to service_role, postgres;
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('activity-log-purge', '41 3 * * *', 'select public.activity_log_purge()');
  end if;
end $$;
