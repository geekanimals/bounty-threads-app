-- Phase 1B (2/2): connection lifecycle, grant-truth/capability writers, ingestion writers, and the
-- authenticated api surface (disconnect / data access / ingestion status / audience). ADDITIVE + DARK.
-- All api functions: SECURITY DEFINER, search_path='', flag-gated, ownership from auth.uid(), execute
-- revoked from public/anon. Internal writers are service_role only. No token/secret/raw payload logged.

-- ---------- connection lifecycle columns + expanded state machine ----------
alter table intel.ci_platform_connection
  add column token_type      text,
  add column issued_at       timestamptz,
  add column last_refresh_at timestamptz,
  add column state_reason    text;
alter table intel.ci_platform_connection drop constraint ci_platform_connection_status_check;
alter table intel.ci_platform_connection add constraint ci_platform_connection_status_check
  check (status in ('active','superseded','revoked','expired','refresh_failed','disconnected','reconnect_required'));

-- Legacy transition (documentation only — NOT executed here):
--   A future, separately-approved migration may seed ci_platform_account/ci_platform_connection from
--   public.social_accounts + public.social_tokens (member_id == auth.users.id; ig_user_id -> stable
--   platform_user_id), storing the legacy token into Vault and setting token_reference. No legacy
--   token is read, migrated, or deleted in this phase.

-- ============================ INTERNAL: state + refresh (service_role) ============================
create or replace function intel.ci_mark_connection_state(p_connection uuid, p_status text, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update intel.ci_platform_connection
     set status = p_status, state_reason = p_reason,
         revoked_at = case when p_status in ('revoked','disconnected') then now() else revoked_at end,
         updated_at = now()
   where connection_id = p_connection;
end; $$;
revoke all on function intel.ci_mark_connection_state(uuid,text,text) from public, anon, authenticated;

-- Server-side token refresh: store the NEW token to Vault, rotate the reference, update lifecycle.
create or replace function intel.ci_refresh_token(p_connection uuid, p_token_secret text, p_expires_at timestamptz, p_token_type text default 'bearer')
returns void language plpgsql security definer set search_path = '' as $$
declare v_acc uuid; v_ref text;
begin
  select platform_account_id into v_acc from intel.ci_platform_connection where connection_id = p_connection;
  if v_acc is null then raise exception 'connection not found' using errcode = '42501'; end if;
  v_ref := intel.ci_vault_store('ig_refresh:'||v_acc::text||':'||encode(extensions.gen_random_bytes(6),'hex'), p_token_secret);
  update intel.ci_platform_connection
     set token_reference = v_ref, token_type = p_token_type, last_refresh_at = now(),
         expires_at = p_expires_at, status = 'active', state_reason = null, last_validated_at = now(), updated_at = now()
   where connection_id = p_connection;
end; $$;
revoke all on function intel.ci_refresh_token(uuid,text,timestamptz,text) from public, anon, authenticated;

-- Fail-closed ingest gate: active connection + (basic OR enabled capability) + valid scope grant.
create or replace function intel.ci_can_ingest(p_connection uuid, p_capability text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_ok boolean; v_acc uuid; v_ipa uuid; v_scope text;
begin
  select platform_account_id into v_acc from intel.ci_platform_connection
    where connection_id = p_connection and status = 'active';
  if v_acc is null then return false; end if;
  if p_capability is null then return true; end if;           -- basic account stage
  select scope into v_scope from intel.ci_scope_capability_map where provider='instagram' and capability = p_capability;
  if v_scope is null then return false; end if;
  if not exists (select 1 from intel.ci_scope_grant where connection_id = p_connection and scope = v_scope and valid) then
    return false;                                             -- grant truth: not granted => no ingest
  end if;
  select ipa.id into v_ipa from intel.ci_identity_platform_account ipa where ipa.platform_account_id = v_acc and ipa.valid_to is null order by ipa.valid_from limit 1;
  select coalesce((select enabled from intel.ci_capability_switch where identity_platform_account_id = v_ipa and capability = p_capability), false) into v_ok;
  return v_ok;
end; $$;
revoke all on function intel.ci_can_ingest(uuid,text) from public, anon, authenticated;

-- ============================ INTERNAL: ingestion writers (service_role) ============================
create or replace function intel.ci_enqueue_initial_ingest(p_connection uuid, p_correlation text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_run uuid; v_acc uuid; v_id uuid; s record;
begin
  if not intel.ci_feature_enabled('creator_ig_connect') then
    raise exception 'creator_ig_connect disabled' using errcode = '0A000';   -- fail-closed: only when enabled
  end if;
  select c.platform_account_id, ipa.identity_id into v_acc, v_id
    from intel.ci_platform_connection c
    join intel.ci_identity_platform_account ipa on ipa.platform_account_id = c.platform_account_id and ipa.valid_to is null
    where c.connection_id = p_connection and c.status = 'active' limit 1;
  if v_acc is null then raise exception 'no active connection' using errcode = '42501'; end if;

  insert into intel.ci_ingest_run(identity_id, platform_account_id, connection_id, trigger, api_version, status, correlation_id)
    values (v_id, v_acc, p_connection, 'initial_connect',
            (select api_version from intel.ci_provider_config where provider='instagram' and app_environment='prod'),
            'queued', p_correlation)
    returning run_id into v_run;
  -- queue every stage; capability-bearing stages start queued but the runner skips them when
  -- ci_can_ingest is false (capability_disabled) — never fabricating data.
  for s in select * from (values
      ('scope_verify',null),('account',null),('media',null),
      ('account_insights','performance_insights'),('media_insights','performance_insights'),
      ('audience','performance_insights'),('mentions','comment_intelligence'),('comments','comment_intelligence'),
      ('messaging','campaign_messaging_intelligence'),('completion',null)) as t(stage,cap) loop
    insert into intel.ci_ingest_stage(run_id, identity_id, platform_account_id, connection_id, stage, capability, status)
      values (v_run, v_id, v_acc, p_connection, s.stage, s.cap, 'queued');
  end loop;
  return v_run;
end; $$;
revoke all on function intel.ci_enqueue_initial_ingest(uuid,text) from public, anon, authenticated;

create or replace function intel.ci_record_stage(p_run uuid, p_stage text, p_status text,
  p_requested int default null, p_received int default null, p_written int default null,
  p_reason text default null, p_error_class text default null, p_cursor text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update intel.ci_ingest_stage set status = p_status, attempt = attempt + 1,
    records_requested = p_requested, records_received = p_received, records_written = p_written,
    availability_reason = p_reason, error_class = p_error_class, cursor = p_cursor,
    started_at = coalesce(started_at, now()),
    completed_at = case when p_status in ('complete','partial','insufficient_data','permission_missing','capability_disabled','threshold_not_met','unsupported','failed_terminal') then now() else completed_at end,
    updated_at = now()
  where run_id = p_run and stage = p_stage;
end; $$;
revoke all on function intel.ci_record_stage(uuid,text,text,int,int,int,text,text,text) from public, anon, authenticated;

-- Append-only account snapshot (idempotent). Unavailable metrics arrive as NULL, never 0.
create or replace function intel.ci_write_account_snapshot(p_run uuid, p_identity uuid, p_account uuid, p_metrics jsonb, p_idem text, p_observed timestamptz default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into intel.ci_account_snapshots(identity_id, platform_account_id, followers_count, follows_count, media_count,
    reach, accounts_engaged, total_interactions, source_observed_at, ingest_run_id, idempotency_key,
    api_version, payload_hash, status)
  values (p_identity, p_account,
    (p_metrics->>'followers_count')::int, (p_metrics->>'follows_count')::int, (p_metrics->>'media_count')::int,
    (p_metrics->>'reach')::int, (p_metrics->>'accounts_engaged')::int, (p_metrics->>'total_interactions')::int,
    coalesce(p_observed, now()), p_run, p_idem,
    (select api_version from intel.ci_provider_config where provider='instagram' and app_environment='prod'),
    encode(extensions.digest(coalesce(p_metrics::text,''),'sha256'),'hex'),
    coalesce(p_metrics->>'status','available'))
  on conflict (idempotency_key) do nothing;   -- idempotent retry dedupe
end; $$;
revoke all on function intel.ci_write_account_snapshot(uuid,uuid,uuid,jsonb,text,timestamptz) from public, anon, authenticated;

-- Append-only audience rows. Each row is one bucket; unavailable => value_count NULL + status/reason.
create or replace function intel.ci_write_audience(p_run uuid, p_identity uuid, p_account uuid, p_rows jsonb, p_idem_prefix text)
returns integer language plpgsql security definer set search_path = '' as $$
declare r jsonb; n int := 0; i int := 0;
begin
  for r in select * from jsonb_array_elements(p_rows) loop
    insert into intel.ci_audience_observations(identity_id, platform_account_id, metric_name, audience_type,
      breakdown_type, dimension_key, dimension_value, value_count, calculated_percentage, period, timeframe,
      sample_size, audience_total, source_observed_at, ingest_run_id, idempotency_key, api_version, status, suppression_reason)
    values (p_identity, p_account, r->>'metric_name', r->>'audience_type', r->>'breakdown_type',
      r->>'dimension_key', r->>'dimension_value',
      case when r ? 'value_count' and (r->>'value_count') is not null then (r->>'value_count')::int else null end,
      (r->>'calculated_percentage')::numeric, r->>'period', r->>'timeframe',
      (r->>'sample_size')::int, (r->>'audience_total')::int, now(), p_run,
      p_idem_prefix||':'||i::text,
      (select api_version from intel.ci_provider_config where provider='instagram' and app_environment='prod'),
      coalesce(r->>'status','available'), r->>'suppression_reason')
    on conflict (idempotency_key) do nothing;
    i := i + 1; n := n + 1;
  end loop;
  return n;
end; $$;
revoke all on function intel.ci_write_audience(uuid,uuid,uuid,jsonb,text) from public, anon, authenticated;

create or replace function intel.ci_complete_run(p_run uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update intel.ci_ingest_run set status = p_status, completed_at = now(), freshness_at = now() where run_id = p_run;
end; $$;
revoke all on function intel.ci_complete_run(uuid,text) from public, anon, authenticated;

-- ============================ api: DATA ACCESS + DISCONNECT (authenticated, own) ============================
create or replace function api.get_my_data_access()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform intel.ci_assert_api_enabled('creator_profile_api');
  v_id := intel.ci_caller_identity();
  return jsonb_build_object(
    'connections', coalesce((select jsonb_agg(jsonb_build_object('connection_id',c.connection_id,'status',c.status,
        'state_reason',c.state_reason,'connected_at',c.connected_at,'expires_at',c.expires_at,'last_refresh_at',c.last_refresh_at,
        'grants', coalesce((select jsonb_agg(jsonb_build_object('scope',g.scope,'valid',g.valid,'status',g.status_reason) order by g.scope)
                            from intel.ci_scope_grant g where g.connection_id=c.connection_id),'[]'::jsonb))
        order by c.connected_at desc)
      from intel.ci_identity_platform_account ipa
      join intel.ci_platform_connection c on c.platform_account_id = ipa.platform_account_id
      where ipa.identity_id = v_id and ipa.valid_to is null),'[]'::jsonb),
    'capabilities', coalesce((select jsonb_agg(jsonb_build_object('capability',cs.capability,'enabled',cs.enabled) order by cs.capability)
      from intel.ci_identity_platform_account ipa
      join intel.ci_capability_switch cs on cs.identity_platform_account_id = ipa.id
      where ipa.identity_id = v_id and ipa.valid_to is null),'[]'::jsonb)
    -- token_reference is NEVER selected
  );
end; $$;

create or replace function api.set_capability(p_capability text, p_enabled boolean, p_correlation text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_ipa uuid; v_prev boolean;
begin
  perform intel.ci_assert_api_enabled('creator_profile_api');
  v_id := intel.ci_caller_identity();
  if p_capability not in ('performance_insights','comment_intelligence','campaign_messaging_intelligence','publishing_scheduling') then
    raise exception 'unknown capability' using errcode = '22023';
  end if;
  select ipa.id into v_ipa from intel.ci_identity_platform_account ipa where ipa.identity_id = v_id and ipa.valid_to is null order by ipa.valid_from limit 1;
  if v_ipa is null then raise exception 'no connected account' using errcode = '42501'; end if;
  select enabled into v_prev from intel.ci_capability_switch where identity_platform_account_id = v_ipa and capability = p_capability;
  insert into intel.ci_capability_switch(identity_platform_account_id, capability, enabled, changed_by)
    values (v_ipa, p_capability, p_enabled, auth.uid())
  on conflict (identity_platform_account_id, capability) do update set enabled = excluded.enabled, changed_by = auth.uid(), changed_at = now(), updated_at = now();
  insert into intel.ci_capability_switch_event(identity_platform_account_id, identity_id, capability, previous_state, new_state, acting_member_id)
    values (v_ipa, v_id, p_capability, v_prev, p_enabled, auth.uid());
  -- disabling: cancel queued future work for that capability (never touches stored history)
  if not p_enabled then
    update intel.ci_ingest_stage set status='capability_disabled', updated_at=now()
      where capability = p_capability and status='queued'
        and run_id in (select run_id from intel.ci_ingest_run where identity_id = v_id and status in ('queued','running'));
  end if;
end; $$;

create or replace function api.disconnect_platform(p_connection_id uuid, p_correlation text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_own boolean;
begin
  perform intel.ci_assert_api_enabled('creator_profile_api');
  v_id := intel.ci_caller_identity();
  select exists (select 1 from intel.ci_platform_connection c
                 join intel.ci_identity_platform_account ipa on ipa.platform_account_id = c.platform_account_id and ipa.valid_to is null
                 where c.connection_id = p_connection_id and ipa.identity_id = v_id) into v_own;
  if not v_own then raise exception 'connection not found or not owned' using errcode = '42501'; end if;
  -- mark disconnected + clear the Vault reference (secret purge is a retention job); prevent refresh/ingest
  update intel.ci_platform_connection set status='disconnected', state_reason='creator_disconnected',
    token_reference = null, revoked_at = now(), updated_at = now() where connection_id = p_connection_id;
  update intel.ci_ingest_run set status='cancelled' where connection_id = p_connection_id and status in ('queued','running');
  update intel.ci_ingest_stage set status='failed_terminal', availability_reason='disconnected', updated_at=now()
    where connection_id = p_connection_id and status in ('queued','running');
  insert into intel.ci_connection_event(actor_member_id, identity_id, connection_id, action, result_status, authority_source, correlation_id)
    values (auth.uid(), v_id, p_connection_id, 'disconnect', 'ok', 'self', p_correlation);
  -- NOTE: the creator's manually-entered profile is intentionally NOT deleted here.
end; $$;

-- ============================ api: INGESTION STATUS + AUDIENCE (authenticated, own; read-only) ============================
create or replace function api.get_my_ingestion_status()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid; v_run uuid;
begin
  perform intel.ci_assert_api_enabled('creator_profile_api');
  v_id := intel.ci_caller_identity();
  select run_id into v_run from intel.ci_ingest_run where identity_id = v_id order by created_at desc limit 1;
  if v_run is null then return jsonb_build_object('run', null, 'stages', '[]'::jsonb); end if;
  return jsonb_build_object(
    'run', (select jsonb_build_object('run_id',run_id,'status',status,'freshness_at',freshness_at,'completed_at',completed_at)
            from intel.ci_ingest_run where run_id = v_run),
    'stages', coalesce((select jsonb_agg(jsonb_build_object('stage',stage,'capability',capability,'status',status,
                'records_written',records_written,'availability_reason',availability_reason) order by stage)
              from intel.ci_ingest_stage where run_id = v_run),'[]'::jsonb));
end; $$;

-- Audience coverage: AGGREGATED buckets + coverage/as-of + unavailable reasons. Never individual
-- follower identity; unavailable stays null/reasoned; distinct follower vs engaged.
create or replace function api.get_my_audience()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid; v_acc uuid;
begin
  perform intel.ci_assert_api_enabled('creator_profile_api');
  v_id := intel.ci_caller_identity();
  select ipa.platform_account_id into v_acc from intel.ci_identity_platform_account ipa
    where ipa.identity_id = v_id and ipa.valid_to is null order by ipa.valid_from limit 1;
  if v_acc is null then return jsonb_build_object('available', false, 'reason', 'no_connected_account'); end if;
  return jsonb_build_object(
    'as_of', (select max(captured_at) from intel.ci_audience_observations where platform_account_id = v_acc),
    'metrics', coalesce((
      select jsonb_agg(m) from (
        select jsonb_build_object('metric_name', a.metric_name, 'audience_type', a.audience_type,
                 'breakdown_type', a.breakdown_type, 'status', min(a.status),
                 'buckets', jsonb_agg(jsonb_build_object('key', a.dimension_key, 'value', a.value_count) order by a.dimension_key)
                              filter (where a.status='available' and a.value_count is not null),
                 'suppression_reason', min(a.suppression_reason)) as m
        from (select distinct on (platform_account_id, metric_name, breakdown_type, dimension_key)
                    platform_account_id, metric_name, audience_type, breakdown_type, dimension_key, value_count, status, suppression_reason
              from intel.ci_audience_observations where platform_account_id = v_acc
              order by platform_account_id, metric_name, breakdown_type, dimension_key, captured_at desc) a
        group by a.metric_name, a.audience_type, a.breakdown_type
      ) q ), '[]'::jsonb));
end; $$;

-- ============================ GRANTS ============================
do $$ declare fn text; begin
  foreach fn in array array['api.get_my_data_access()','api.set_capability(text,boolean,text)',
    'api.disconnect_platform(uuid,text)','api.get_my_ingestion_status()','api.get_my_audience()'] loop
    execute 'revoke all on function '||fn||' from public, anon';
    execute 'grant execute on function '||fn||' to authenticated, service_role';
  end loop; end $$;
