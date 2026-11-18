-- DB CPU relief.
-- 1) api.nav_counts (sidebar badges) is polled every 30 s by every open admin tab (new + old app) and
--    runs approvals_inbox + process_inbox each time. Cache the result per user for 45 s.
-- 2) cron.job_run_details had ~178k rows — keep 3 days, clean daily.

create table if not exists private.nav_counts_cache (
  uid uuid primary key,
  data jsonb not null,
  at timestamptz not null default now()
);
alter table private.nav_counts_cache enable row level security;
revoke all on private.nav_counts_cache from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api' and p.proname = 'nav_counts')
     and not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname = 'nav_counts_live') then
    alter function api.nav_counts() rename to nav_counts_live;
    alter function api.nav_counts_live() set schema private;
    revoke all on function private.nav_counts_live() from public, anon, authenticated;
  end if;
end $$;

create or replace function api.nav_counts() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v jsonb;
begin
  if v_uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  select c.data into v from private.nav_counts_cache c where c.uid = v_uid and c.at > now() - interval '45 seconds';
  if v is not null then return v; end if;
  v := private.nav_counts_live();
  insert into private.nav_counts_cache(uid, data, at) values (v_uid, v, now())
    on conflict (uid) do update set data = excluded.data, at = excluded.at;
  return v;
end $$;
revoke all on function api.nav_counts() from public, anon;
grant execute on function api.nav_counts() to authenticated, service_role;

delete from cron.job_run_details where end_time < now() - interval '3 days';
select cron.schedule('cron-history-cleanup', '17 3 * * *', $c$delete from cron.job_run_details where end_time < now() - interval '3 days'$c$)
 where not exists (select 1 from cron.job where jobname = 'cron-history-cleanup');
