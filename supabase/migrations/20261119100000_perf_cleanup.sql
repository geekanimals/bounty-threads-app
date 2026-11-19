-- Speed + cleanup (19 Nov 2026)
-- Campaign Creators page was slow (campaign_msg_stats ~3.2s, campaign_people ~2s on Nano) → stale lists on screen.
-- ci_outbox had no index on campaign / member / address / participation, so every creator row scanned the whole table.
create index if not exists ci_outbox_campaign_idx on intel.ci_outbox (campaign_id, channel, status);
create index if not exists ci_outbox_member_idx on intel.ci_outbox (recipient_member_id) where recipient_member_id is not null;
create index if not exists ci_outbox_to_idx on intel.ci_outbox (to_address);
create index if not exists ci_outbox_part_idx on intel.ci_outbox (participation_id) where participation_id is not null;
create index if not exists ci_invite_participation_idx on intel.ci_campaign_invite (participation_id) where participation_id is not null;

-- Security advisor fixes
alter table public.rejection_reason_vocab enable row level security;  -- read only through api.rejection_reasons (security definer)
alter function public.wa_touch_updated_at() set search_path = '';
do $x$ declare r record; begin
  for r in select p.oid::regprocedure f from pg_proc p join pg_namespace s on s.oid = p.pronamespace
    where s.nspname = 'public' and p.proname like 'admin\_%' and has_function_privilege('anon', p.oid, 'execute') loop
    execute format('revoke execute on function %s from anon, public', r.f);
  end loop;
end $x$;

-- Cron cleanup
do $x$ begin
  -- ci-notify-dispatch: off, and a duplicate of ops-notify-dispatch (same worker)
  if exists (select 1 from cron.job where jobid = 8) then perform cron.unschedule(8); end if;
  -- ci-wa-templates: old per-campaign template maker — only the new Utility templates are used now
  if exists (select 1 from cron.job where jobid = 12) then perform cron.alter_job(12, active := false); end if;
  -- keep 2 days of cron history (was 3; it was the biggest table)
  if exists (select 1 from cron.job where jobid = 40) then
    perform cron.alter_job(40, command := $c$delete from cron.job_run_details where end_time < now() - interval '2 days'$c$);
  end if;
end $x$;
