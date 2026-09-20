-- Phase 1B-fix (2/3): dark ingestion-worker claim/lease model. ADDITIVE. service_role only.
-- Atomic stage claiming (FOR UPDATE SKIP LOCKED), lease owner+expiry, abandoned-lease recovery,
-- next_attempt_at scheduling, per-account concurrency, bounded backoff, and dead-letter state.
-- The ig-ingest-worker Edge Function drives these; nothing is deployed or scheduled.

alter table intel.ci_ingest_stage
  add column lease_owner      text,
  add column lease_expires_at timestamptz,
  add column next_attempt_at  timestamptz,
  add column max_attempts     integer not null default 6,
  add column dead_letter      boolean not null default false;

-- bounded exponential backoff (seconds) for retry scheduling
create or replace function intel.ci_backoff_seconds(p_attempt int)
returns integer language sql immutable set search_path = pg_catalog as $$
  select least(3600, (30 * power(2, greatest(p_attempt,0))))::int;   -- 30s..1h cap
$$;

-- Atomically claim eligible stages for one worker. Guarantees:
--  * two workers never claim the same stage (FOR UPDATE SKIP LOCKED)
--  * per-account concurrency: never claim a stage for an account that already has a live lease
--  * respects next_attempt_at; recovers expired leases; skips dead-letter/cancelled runs
create or replace function intel.ci_claim_stages(p_worker text, p_limit int default 1, p_lease_seconds int default 120)
returns setof intel.ci_ingest_stage language plpgsql security definer set search_path = '' as $$
begin
  return query
  with eligible as (
    select s.stage_id
    from intel.ci_ingest_stage s
    join intel.ci_ingest_run r on r.run_id = s.run_id
    where r.status in ('queued','running')
      and s.dead_letter = false
      and s.status in ('queued','failed_retryable')
      and (s.next_attempt_at is null or s.next_attempt_at <= now())
      and (s.lease_expires_at is null or s.lease_expires_at < now())   -- free or expired lease
      -- per-account concurrency: skip accounts already being processed under a live lease
      and not exists (
        select 1 from intel.ci_ingest_stage o
        where o.platform_account_id = s.platform_account_id
          and o.stage_id <> s.stage_id
          and o.status = 'running'
          and o.lease_expires_at is not null and o.lease_expires_at >= now())
    order by s.updated_at
    for update of s skip locked
    limit greatest(p_limit,1)
  )
  update intel.ci_ingest_stage t
     set status = 'running', lease_owner = p_worker,
         lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         attempt = t.attempt + 1, started_at = coalesce(t.started_at, now()), updated_at = now()
   from eligible e
  where t.stage_id = e.stage_id
  returning t.*;
end; $$;
revoke all on function intel.ci_claim_stages(text,int,int) from public, anon, authenticated;

-- Release a claimed stage with a terminal/partial/retryable outcome.
create or replace function intel.ci_release_stage(p_stage uuid, p_worker text, p_status text,
  p_requested int default null, p_received int default null, p_written int default null,
  p_reason text default null, p_error_class text default null, p_cursor text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_attempt int; v_max int;
begin
  select attempt, max_attempts into v_attempt, v_max from intel.ci_ingest_stage
    where stage_id = p_stage and lease_owner = p_worker for update;   -- only the lease owner may release
  if not found then raise exception 'stage not owned by worker' using errcode = '42501'; end if;

  if p_status = 'failed_retryable' then
    if v_attempt >= v_max then
      update intel.ci_ingest_stage set status='failed_terminal', dead_letter=true, lease_owner=null,
        lease_expires_at=null, availability_reason=coalesce(p_reason,'retry_exhausted'), error_class=p_error_class,
        completed_at=now(), updated_at=now() where stage_id = p_stage;   -- dead-letter
    else
      update intel.ci_ingest_stage set status='failed_retryable', lease_owner=null, lease_expires_at=null,
        next_attempt_at = now() + make_interval(secs => intel.ci_backoff_seconds(v_attempt)),
        availability_reason=p_reason, error_class=p_error_class, cursor=coalesce(p_cursor,cursor), updated_at=now()
      where stage_id = p_stage;   -- reschedule
    end if;
  else
    update intel.ci_ingest_stage set status=p_status, lease_owner=null, lease_expires_at=null,
      records_requested=p_requested, records_received=p_received, records_written=p_written,
      availability_reason=p_reason, error_class=p_error_class, cursor=coalesce(p_cursor,cursor),
      dead_letter = (p_status = 'failed_terminal'),
      completed_at = case when p_status in ('complete','partial','insufficient_data','permission_missing',
        'capability_disabled','threshold_not_met','unsupported','failed_terminal','reconnect_required','token_expired') then now() else completed_at end,
      updated_at=now()
    where stage_id = p_stage;
  end if;
end; $$;
revoke all on function intel.ci_release_stage(uuid,text,text,int,int,int,text,text,text) from public, anon, authenticated;

-- Recover leases abandoned by a crashed worker (expired lease still marked running).
create or replace function intel.ci_recover_abandoned_leases()
returns integer language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update intel.ci_ingest_stage set status='failed_retryable', lease_owner=null, lease_expires_at=null,
    next_attempt_at = now(), availability_reason='lease_expired_recovered', updated_at=now()
  where status='running' and lease_expires_at is not null and lease_expires_at < now();
  get diagnostics n = row_count;
  return n;
end; $$;
revoke all on function intel.ci_recover_abandoned_leases() from public, anon, authenticated;

-- Cancel queued/running stages+run for a capability that was just disabled (called by set_capability path).
create or replace function intel.ci_cancel_capability_stages(p_identity uuid, p_capability text)
returns integer language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update intel.ci_ingest_stage set status='capability_disabled', lease_owner=null, lease_expires_at=null, updated_at=now()
  where capability = p_capability and status in ('queued','running','failed_retryable')
    and run_id in (select run_id from intel.ci_ingest_run where identity_id = p_identity and status in ('queued','running'));
  get diagnostics n = row_count;
  return n;
end; $$;
revoke all on function intel.ci_cancel_capability_stages(uuid,text) from public, anon, authenticated;
