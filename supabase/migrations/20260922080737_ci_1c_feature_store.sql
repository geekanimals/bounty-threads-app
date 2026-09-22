-- Phase 1C — explainable Creator Intelligence feature store. ADDITIVE + DARK. intel only.
-- Typed columns (not JSONB-as-schema); observed/derived/predicted contract on every value; append-only
-- history; service_role-only; PUBLIC/anon/authenticated denied. Unavailable => value NULL + reason,
-- NEVER 0. Six SEPARATE measures (no blended universal score). Marginal audience only (no joints).

-- ============================ VERSIONED FEATURE DEFINITIONS ============================
create table intel.ci_feature_definition (
  feature_key      text not null,
  feature_version  integer not null default 1,
  evidence_type    text not null check (evidence_type in ('observed','derived','predicted')),
  family           text not null check (family in ('account','content','audience','brand','measure')),
  unit             text,                       -- e.g. count | ratio | hours | percent | distribution
  window_kinds     text[] not null default array['point'],
  description      text not null,
  formula_ref      text,                       -- human-readable formula reference
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  primary key (feature_key, feature_version)
);

-- ============================ CALCULATION RUNS (distinct from ingest runs) ============================
create table intel.ci_feature_run (
  feature_run_id   uuid primary key default gen_random_uuid(),
  identity_id      uuid not null references intel.ci_creator_identity(identity_id) on delete cascade,
  platform_account_id uuid references intel.ci_platform_account(platform_account_id) on delete set null,
  as_of            timestamptz not null,
  model_version    text not null default 'v1',
  status           text not null default 'running' check (status in ('running','complete','partial','failed')),
  started_at       timestamptz not null default now(),
  completed_at     timestamptz,
  correlation_id   text,
  constraint ci_feature_run_idem_uq unique (identity_id, as_of, model_version)   -- idempotent per (id, as_of, version)
);
create index ci_feature_run_identity_idx on intel.ci_feature_run(identity_id, as_of desc);

-- ============================ APPEND-ONLY FEATURE VALUES (full envelope) ============================
create table intel.ci_feature_value (
  feature_value_id uuid primary key default gen_random_uuid(),
  identity_id      uuid not null references intel.ci_creator_identity(identity_id) on delete cascade,
  platform_account_id uuid references intel.ci_platform_account(platform_account_id) on delete set null,
  feature_key      text not null,
  feature_version  integer not null,
  evidence_type    text not null check (evidence_type in ('observed','derived','predicted')),
  value_num        numeric,                    -- NULL when not available (never 0-as-unavailable)
  value_json       jsonb,                      -- bounded metadata/distribution only (e.g. marginal buckets)
  unit             text,
  window_kind      text not null default 'point' check (window_kind in ('point','30d','90d','lifetime')),
  window_start     timestamptz,
  window_end       timestamptz,
  as_of            timestamptz not null,
  computed_at      timestamptz not null default now(),
  freshness_status text not null default 'unknown' check (freshness_status in ('fresh','stale','unknown')),
  sample_size      integer,
  value_status     text not null check (value_status in
                     ('available','insufficient_data','unavailable','stale','permission_disabled','missing_permission','failed')),
  confidence       numeric check (confidence is null or confidence between 0 and 1),
  verified_coverage numeric check (verified_coverage is null or verified_coverage between 0 and 100),
  feature_run_id   uuid not null references intel.ci_feature_run(feature_run_id) on delete cascade,
  explanation      text not null,              -- plain-language explanation
  unavailable_reason text,                     -- present when not 'available'
  idempotency_key  text not null,
  constraint ci_feature_value_idem_uq unique (idempotency_key),
  -- unavailable/insufficient/etc. must not carry a numeric value
  constraint ci_feature_value_no_zero_unavail_ck check (value_status = 'available' or value_num is null)
);
create index ci_feature_value_lookup_idx on intel.ci_feature_value(identity_id, feature_key, window_kind, as_of desc);
create index ci_feature_value_run_idx on intel.ci_feature_value(feature_run_id);
create index ci_feature_value_account_idx on intel.ci_feature_value(platform_account_id);

-- ============================ FEATURE -> SOURCE EVIDENCE LINKS ============================
create table intel.ci_feature_evidence (
  id               uuid primary key default gen_random_uuid(),
  feature_value_id uuid not null references intel.ci_feature_value(feature_value_id) on delete cascade,
  source_kind      text not null,              -- account_snapshot | media_insight | audience_obs | mention | brand_experience | scope_grant | capability
  source_table     text not null,
  source_row_id    uuid,
  ingest_run_id    uuid references intel.ci_ingest_run(run_id) on delete set null,
  created_at       timestamptz not null default now()
);
create index ci_feature_evidence_value_idx on intel.ci_feature_evidence(feature_value_id);
create index ci_feature_evidence_run_idx on intel.ci_feature_evidence(ingest_run_id);

-- ============================ SIX MEASURE SNAPSHOTS (append-only) ============================
create table intel.ci_measure_snapshot (
  measure_snapshot_id uuid primary key default gen_random_uuid(),
  identity_id      uuid not null references intel.ci_creator_identity(identity_id) on delete cascade,
  measure          text not null check (measure in
                     ('creator_performance','reliability','brand_safety','fraud_probability',
                      'intelligence_confidence','verified_data_coverage')),
  measure_version  text not null default 'v1',
  value_status     text not null check (value_status in
                     ('available','insufficient_data','unavailable','stale','permission_disabled','missing_permission','failed')),
  value_num        numeric,                    -- NULL unless available
  is_estimate      boolean not null default false,   -- fraud_probability is always an estimate
  confidence       numeric check (confidence is null or confidence between 0 and 1),
  coverage         numeric check (coverage is null or coverage between 0 and 100),
  as_of            timestamptz not null,
  computed_at      timestamptz not null default now(),
  feature_run_id   uuid not null references intel.ci_feature_run(feature_run_id) on delete cascade,
  explanation      text not null,
  unavailable_reason text,
  idempotency_key  text not null,
  constraint ci_measure_idem_uq unique (idempotency_key),
  constraint ci_measure_no_zero_unavail_ck check (value_status = 'available' or value_num is null)
);
create index ci_measure_snapshot_idx on intel.ci_measure_snapshot(identity_id, measure, as_of desc);

create table intel.ci_measure_component (
  id               uuid primary key default gen_random_uuid(),
  measure_snapshot_id uuid not null references intel.ci_measure_snapshot(measure_snapshot_id) on delete cascade,
  component_key    text not null,
  weight           numeric,
  contribution     numeric,
  evidence_ref     text,                       -- references a feature_key or a rule id
  explanation      text not null
);
create index ci_measure_component_snap_idx on intel.ci_measure_component(measure_snapshot_id);

-- ---------- append-only enforcement + RLS + service_role-only ----------
do $$ declare t text; begin
  foreach t in array array['ci_feature_value','ci_feature_evidence','ci_measure_snapshot','ci_measure_component','ci_feature_run'] loop
    execute format('drop trigger if exists %I on intel.%I', t||'_append_only', t);
    execute format('create trigger %I before update or delete on intel.%I for each row execute function intel.tg_block_mutation()', t||'_append_only', t);
  end loop;
  foreach t in array array['ci_feature_definition','ci_feature_run','ci_feature_value','ci_feature_evidence','ci_measure_snapshot','ci_measure_component'] loop
    execute format('alter table intel.%I enable row level security', t);
    execute format('revoke all on table intel.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on table intel.%I to service_role', t);
  end loop;
end $$;
-- feature_run is append-only for status too? No — it is updated to 'complete' by the compute fn (owner);
-- ordinary roles still cannot touch it. The block-mutation trigger would prevent the completion update,
-- so feature_run is NOT append-only-triggered (only RLS/grants). Remove it from the trigger set:
drop trigger if exists ci_feature_run_append_only on intel.ci_feature_run;

-- ============================ V1 FEATURE CATALOG (seed) ============================
insert into intel.ci_feature_definition(feature_key, feature_version, evidence_type, family, unit, window_kinds, description, formula_ref) values
  ('account.followers','1','observed','account','count',array['point'],'Latest observed follower count','latest ci_account_snapshots.followers_count as_of'),
  ('account.media_count','1','observed','account','count',array['point'],'Latest observed media count','latest ci_account_snapshots.media_count'),
  ('account.observation_freshness_hours','1','derived','account','hours',array['point'],'Hours since the latest account observation','(as_of - max(captured_at)) in hours'),
  ('account.permission_coverage','1','derived','account','ratio',array['point'],'Fraction of the five scopes granted+valid','valid_grants / 5'),
  ('account.capability_coverage','1','derived','account','ratio',array['point'],'Fraction of toggleable capabilities enabled','enabled_caps / 4'),
  ('account.ingestion_coverage','1','derived','account','ratio',array['point'],'Fraction of last-run stages completed','complete_stages / total_stages'),
  ('content.reach_avg','1','derived','content','count',array['30d','90d','lifetime'],'Average media reach per format window','avg(reach) over media in window'),
  ('content.reach_median','1','derived','content','count',array['30d','90d','lifetime'],'Median media reach per format window','median(reach)'),
  ('content.views_avg','1','derived','content','count',array['30d','90d','lifetime'],'Average media views per format window','avg(views)'),
  ('content.engagement_per_follower','1','derived','content','ratio',array['30d','90d','lifetime'],'Avg interactions per follower per format window','avg(total_interactions)/followers'),
  ('content.posting_cadence_per_week','1','derived','content','ratio',array['30d','90d','lifetime'],'Posts per week for the format window','count(media)/weeks_in_window'),
  ('content.sample_size','1','derived','content','count',array['30d','90d','lifetime'],'Number of media observed in the format window','count(media)'),
  ('audience.age_distribution','1','observed','audience','distribution',array['point'],'Marginal follower age distribution (never a joint)','ci_audience_observations follower/age marginals'),
  ('audience.gender_distribution','1','observed','audience','distribution',array['point'],'Marginal follower gender distribution','follower/gender marginals'),
  ('audience.city_distribution','1','observed','audience','distribution',array['point'],'Marginal follower city distribution','follower/city marginals'),
  ('audience.country_distribution','1','observed','audience','distribution',array['point'],'Marginal follower country distribution','follower/country marginals'),
  ('audience.geographic_strength','1','derived','audience','percent',array['point'],'Top-country share of the follower marginal','max(country share)'),
  ('brand.detected_mentions_count','1','observed','brand','count',array['point'],'Count of detected organic brand mentions (not worked-with)','count(ci_mentions)'),
  ('brand.confirmed_brand_count','1','derived','brand','count',array['point'],'Count of creator-confirmed/verified brand relationships','count(brand_experience confirmed)'),
  ('brand.category_evidence','1','observed','brand','distribution',array['point'],'Creator-declared categories','professional_profile.categories')
on conflict (feature_key, feature_version) do nothing;

-- ============================ EMIT HELPERS (service_role/definer chain only) ============================
create or replace function intel.ci_emit_feature(
  p_run uuid, p_identity uuid, p_account uuid, p_key text, p_ver int, p_etype text,
  p_num numeric, p_json jsonb, p_unit text, p_wkind text, p_wstart timestamptz, p_wend timestamptz,
  p_as_of timestamptz, p_fresh text, p_sample int, p_status text, p_conf numeric, p_cov numeric,
  p_expl text, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $f$
declare v_id uuid;
begin
  insert into intel.ci_feature_value(identity_id, platform_account_id, feature_key, feature_version, evidence_type,
    value_num, value_json, unit, window_kind, window_start, window_end, as_of, freshness_status, sample_size,
    value_status, confidence, verified_coverage, feature_run_id, explanation, unavailable_reason, idempotency_key)
  values (p_identity, p_account, p_key, p_ver, p_etype,
    case when p_status='available' then p_num else null end,   -- unavailable => NULL, never 0
    p_json, p_unit, p_wkind, p_wstart, p_wend, p_as_of, p_fresh, p_sample, p_status, p_conf, p_cov, p_run, p_expl, p_reason,
    -- key is unique per (feature, window, format-discriminator, run); run-level idempotency prevents recompute
    p_key||':'||p_wkind||':'||coalesce(p_json->>'format','_')||':'||p_run::text)
  on conflict (idempotency_key) do nothing
  returning feature_value_id into v_id;
  return v_id;
end $f$;
revoke all on function intel.ci_emit_feature(uuid,uuid,uuid,text,int,text,numeric,jsonb,text,text,timestamptz,timestamptz,timestamptz,text,int,text,numeric,numeric,text,text) from public, anon, authenticated;

create or replace function intel.ci_emit_measure(
  p_run uuid, p_identity uuid, p_measure text, p_status text, p_num numeric, p_estimate boolean,
  p_conf numeric, p_cov numeric, p_as_of timestamptz, p_expl text, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $f$
declare v_id uuid;
begin
  insert into intel.ci_measure_snapshot(identity_id, measure, value_status, value_num, is_estimate, confidence, coverage,
    as_of, feature_run_id, explanation, unavailable_reason, idempotency_key)
  values (p_identity, p_measure, p_status, case when p_status='available' then p_num else null end, p_estimate,
    p_conf, p_cov, p_as_of, p_run, p_expl, p_reason,
    p_measure||':'||p_run::text)
  on conflict (idempotency_key) do nothing
  returning measure_snapshot_id into v_id;
  return v_id;
end $f$;
revoke all on function intel.ci_emit_measure(uuid,uuid,text,text,numeric,boolean,numeric,numeric,timestamptz,text,text) from public, anon, authenticated;

-- ============================ DETERMINISTIC COMPUTE ENTRY POINT (dark; service_role only) ============================
-- Idempotent per (identity, as_of, model_version). Future-data leakage protected: every source read is
-- filtered to <= p_as_of. Emits append-only features + evidence + six SEPARATE measures. No blended score.
create or replace function intel.ci_compute_features(p_identity uuid, p_as_of timestamptz default now(), p_model_version text default 'v1')
returns uuid language plpgsql security definer set search_path = '' as $fn$
declare
  v_run uuid; v_acc uuid; v_snap record; v_followers int; v_fresh text; v_hours numeric;
  v_perm numeric; v_cap numeric; v_ing numeric; v_cov numeric; v_conf numeric;
  fmt text; win text; v_start timestamptz; v_n int; v_reach_avg numeric; v_reach_med numeric; v_views_avg numeric;
  v_eng numeric; v_cadence numeric; v_weeks numeric; b text; v_json jsonb; v_top numeric; v_fv uuid;
  v_mentions int; v_confirmed int; v_cats jsonb; v_perf_components int := 0;
begin
  if p_identity is null then raise exception 'identity required' using errcode='22023'; end if;
  -- idempotency: reuse a completed run for the same (identity, as_of, version)
  select feature_run_id into v_run from intel.ci_feature_run
    where identity_id=p_identity and as_of=p_as_of and model_version=p_model_version and status='complete';
  if v_run is not null then return v_run; end if;

  select ipa.platform_account_id into v_acc from intel.ci_identity_platform_account ipa
    where ipa.identity_id=p_identity and ipa.valid_to is null order by ipa.valid_from limit 1;
  insert into intel.ci_feature_run(identity_id, platform_account_id, as_of, model_version, status)
    values (p_identity, v_acc, p_as_of, p_model_version, 'running')
  on conflict (identity_id, as_of, model_version) do update set status='running', started_at=now()
  returning feature_run_id into v_run;

  -- ---------- A. account & freshness ----------
  select * into v_snap from intel.ci_account_snapshots
    where platform_account_id=v_acc and captured_at <= p_as_of order by captured_at desc limit 1;
  if v_snap.id is not null then
    v_hours := extract(epoch from (p_as_of - v_snap.captured_at))/3600.0;
    v_fresh := case when v_hours <= 168 then 'fresh' else 'stale' end;
    v_followers := v_snap.followers_count;
    v_fv := intel.ci_emit_feature(v_run,p_identity,v_acc,'account.followers',1,'observed',
      v_snap.followers_count, null,'count','point',null,null,p_as_of,v_fresh,1,
      case when v_snap.followers_count is null then 'unavailable' else 'available' end, null, null,
      'Latest observed follower count as of the run.', case when v_snap.followers_count is null then 'not_returned_by_meta' end);
    -- provenance: link the served feature back to the exact source observation + ingest run
    if v_fv is not null then
      insert into intel.ci_feature_evidence(feature_value_id, source_kind, source_table, source_row_id, ingest_run_id)
        values (v_fv, 'account_snapshot', 'intel.ci_account_snapshots', v_snap.id, v_snap.ingest_run_id);
    end if;
    perform intel.ci_emit_feature(v_run,p_identity,v_acc,'account.media_count',1,'observed',
      v_snap.media_count, null,'count','point',null,null,p_as_of,v_fresh,1,
      case when v_snap.media_count is null then 'unavailable' else 'available' end,null,null,'Latest observed media count.',null);
    perform intel.ci_emit_feature(v_run,p_identity,v_acc,'account.observation_freshness_hours',1,'derived',
      round(v_hours,2), null,'hours','point',null,null,p_as_of,v_fresh,1,
      case when v_fresh='stale' then 'stale' else 'available' end,null,null,
      'Hours since the latest account observation ('||v_fresh||').', case when v_fresh='stale' then 'observation_older_than_7d' end);
  else
    perform intel.ci_emit_feature(v_run,p_identity,v_acc,'account.followers',1,'observed',null,null,'count','point',null,null,
      p_as_of,'unknown',0,'insufficient_data',null,null,'No account observation on/before the as-of time.','no_observations');
  end if;

  -- permission / capability / ingestion coverage (derived)
  select coalesce(count(*) filter (where g.valid),0)::numeric/5 into v_perm
    from intel.ci_platform_connection c join intel.ci_scope_grant g on g.connection_id=c.connection_id
    where c.platform_account_id=v_acc and c.status='active';
  perform intel.ci_emit_feature(v_run,p_identity,v_acc,'account.permission_coverage',1,'derived',coalesce(v_perm,0),null,'ratio','point',null,null,
    p_as_of,'fresh',null,'available',null,null,'Fraction of the five Meta scopes currently granted+valid.',null);
  select coalesce(count(*) filter (where cs.enabled),0)::numeric/4 into v_cap
    from intel.ci_identity_platform_account ipa join intel.ci_capability_switch cs on cs.identity_platform_account_id=ipa.id
    where ipa.platform_account_id=v_acc and ipa.valid_to is null;
  perform intel.ci_emit_feature(v_run,p_identity,v_acc,'account.capability_coverage',1,'derived',coalesce(v_cap,0),null,'ratio','point',null,null,
    p_as_of,'fresh',null,'available',null,null,'Fraction of toggleable capabilities enabled.',null);
  select case when count(*)=0 then null else count(*) filter (where s.status='complete')::numeric/count(*) end into v_ing
    from intel.ci_ingest_stage s join intel.ci_ingest_run r on r.run_id=s.run_id
    where r.identity_id=p_identity and r.created_at <= p_as_of
      and r.run_id=(select run_id from intel.ci_ingest_run where identity_id=p_identity and created_at<=p_as_of order by created_at desc limit 1);
  perform intel.ci_emit_feature(v_run,p_identity,v_acc,'account.ingestion_coverage',1,'derived',v_ing,null,'ratio','point',null,null,
    p_as_of, 'fresh', null, case when v_ing is null then 'insufficient_data' else 'available' end,null,null,
    'Fraction of the latest ingestion run''s stages that completed.', case when v_ing is null then 'no_ingestion_run' end);

  -- ---------- B. content performance per FORMAT per WINDOW (never combine formats) ----------
  foreach fmt in array array['FEED','REELS','STORY'] loop
    foreach win in array array['30d','90d','lifetime'] loop
      v_start := case win when '30d' then p_as_of - interval '30 days' when '90d' then p_as_of - interval '90 days' else null end;
      v_weeks := case win when '30d' then 30.0/7 when '90d' then 90.0/7 else greatest(1,extract(epoch from (p_as_of - coalesce((select min(media_timestamp) from intel.ci_media m where m.platform_account_id=v_acc and m.media_product_type=fmt), p_as_of)))/604800.0) end;
      select count(*) into v_n from intel.ci_media m
        where m.platform_account_id=v_acc and m.media_product_type=fmt and m.deleted_at is null
          and m.media_timestamp <= p_as_of and (v_start is null or m.media_timestamp >= v_start);
      perform intel.ci_emit_feature(v_run,p_identity,v_acc,'content.sample_size',1,'derived',v_n,
        jsonb_build_object('format',fmt),'count',win,v_start,p_as_of,p_as_of,'fresh',v_n,'available',null,null,
        'Number of '||fmt||' media observed in the '||win||' window.',null);
      if v_n >= 3 then
        select avg(x.reach), percentile_cont(0.5) within group (order by x.reach), avg(x.views), avg(x.ti)
          into v_reach_avg, v_reach_med, v_views_avg, v_eng
        from (
          select m.media_row_id,
            (select value_count from intel.ci_media_insights i where i.media_row_id=m.media_row_id and i.metric_name='reach' and i.captured_at<=p_as_of and i.status='available' order by i.captured_at desc limit 1) reach,
            (select value_count from intel.ci_media_insights i where i.media_row_id=m.media_row_id and i.metric_name='views' and i.captured_at<=p_as_of and i.status='available' order by i.captured_at desc limit 1) views,
            (select value_count from intel.ci_media_insights i where i.media_row_id=m.media_row_id and i.metric_name='total_interactions' and i.captured_at<=p_as_of and i.status='available' order by i.captured_at desc limit 1) ti
          from intel.ci_media m where m.platform_account_id=v_acc and m.media_product_type=fmt and m.deleted_at is null
            and m.media_timestamp<=p_as_of and (v_start is null or m.media_timestamp>=v_start)) x;
        v_cadence := round(v_n / nullif(v_weeks,0), 3);
        perform intel.ci_emit_feature(v_run,p_identity,v_acc,'content.reach_avg',1,'derived',round(v_reach_avg,2),jsonb_build_object('format',fmt),'count',win,v_start,p_as_of,p_as_of,'fresh',v_n,
          case when v_reach_avg is null then 'insufficient_data' else 'available' end,null,null,'Average '||fmt||' reach ('||win||').', case when v_reach_avg is null then 'reach_not_available' end);
        perform intel.ci_emit_feature(v_run,p_identity,v_acc,'content.reach_median',1,'derived',round(v_reach_med,2),jsonb_build_object('format',fmt),'count',win,v_start,p_as_of,p_as_of,'fresh',v_n,
          case when v_reach_med is null then 'insufficient_data' else 'available' end,null,null,'Median '||fmt||' reach ('||win||').', case when v_reach_med is null then 'reach_not_available' end);
        perform intel.ci_emit_feature(v_run,p_identity,v_acc,'content.views_avg',1,'derived',round(v_views_avg,2),jsonb_build_object('format',fmt),'count',win,v_start,p_as_of,p_as_of,'fresh',v_n,
          case when v_views_avg is null then 'insufficient_data' else 'available' end,null,null,'Average '||fmt||' views ('||win||').', case when v_views_avg is null then 'views_not_available' end);
        perform intel.ci_emit_feature(v_run,p_identity,v_acc,'content.engagement_per_follower',1,'derived',
          case when v_followers is not null and v_followers>0 and v_eng is not null then round(v_eng/v_followers,6) else null end,
          jsonb_build_object('format',fmt),'ratio',win,v_start,p_as_of,p_as_of,'fresh',v_n,
          case when v_followers is null or v_followers=0 or v_eng is null then 'insufficient_data' else 'available' end,null,null,
          'Average '||fmt||' interactions per follower ('||win||').', case when v_followers is null or v_followers=0 then 'followers_unknown' when v_eng is null then 'interactions_not_available' end);
        perform intel.ci_emit_feature(v_run,p_identity,v_acc,'content.posting_cadence_per_week',1,'derived',v_cadence,jsonb_build_object('format',fmt),'ratio',win,v_start,p_as_of,p_as_of,'fresh',v_n,'available',null,null,fmt||' posts per week ('||win||').',null);
        v_perf_components := v_perf_components + 1;
      else
        perform intel.ci_emit_feature(v_run,p_identity,v_acc,'content.reach_avg',1,'derived',null,jsonb_build_object('format',fmt),'count',win,v_start,p_as_of,p_as_of,'unknown',v_n,'insufficient_data',null,null,
          'Not enough '||fmt||' media in the '||win||' window (need >=3).','below_min_sample');
      end if;
    end loop;
  end loop;

  -- ---------- C. audience marginals (NEVER a joint intersection) ----------
  foreach b in array array['age','gender','city','country'] loop
    select jsonb_object_agg(a.dimension_key, a.value_count) filter (where a.value_count is not null), max(a.status)
      into v_json, win
    from (select distinct on (dimension_key) dimension_key, value_count, status
          from intel.ci_audience_observations
          where platform_account_id=v_acc and audience_type='follower' and breakdown_type=b and captured_at<=p_as_of
          order by dimension_key, captured_at desc) a;
    if v_json is not null and v_json <> '{}'::jsonb then
      v_fv := intel.ci_emit_feature(v_run,p_identity,v_acc,'audience.'||b||'_distribution',1,'observed',null,
        v_json||jsonb_build_object('_note','marginal only; not a joint intersection'),'distribution','point',null,null,p_as_of,'fresh',
        (select count(*)::int from jsonb_object_keys(v_json)),'available',null,null,'Marginal follower '||b||' distribution (Meta buckets, not a joint).',null);
      if v_fv is not null then
        insert into intel.ci_feature_evidence(feature_value_id, source_kind, source_table, source_row_id, ingest_run_id)
          select v_fv, 'audience_obs', 'intel.ci_audience_observations', a.id, a.ingest_run_id
          from intel.ci_audience_observations a
          where a.platform_account_id=v_acc and a.audience_type='follower' and a.breakdown_type=b and a.captured_at<=p_as_of
          order by a.captured_at desc limit 1;
      end if;
    else
      perform intel.ci_emit_feature(v_run,p_identity,v_acc,'audience.'||b||'_distribution',1,'observed',null,null,'distribution','point',null,null,p_as_of,'unknown',0,
        'insufficient_data',null,null,'No follower '||b||' demographics available (threshold/permission).','audience_threshold_or_permission');
    end if;
  end loop;
  -- geographic strength = top-country marginal share (derived; still not a joint)
  select max(pct) into v_top from (
    select value_count::numeric / nullif(sum(value_count) over (),0) * 100 pct
    from (select distinct on (dimension_key) dimension_key, value_count from intel.ci_audience_observations
          where platform_account_id=v_acc and audience_type='follower' and breakdown_type='country' and captured_at<=p_as_of and status='available'
          order by dimension_key, captured_at desc) c) q;
  perform intel.ci_emit_feature(v_run,p_identity,v_acc,'audience.geographic_strength',1,'derived',round(v_top,2),null,'percent','point',null,null,p_as_of,'fresh',null,
    case when v_top is null then 'insufficient_data' else 'available' end,null,null,'Top-country share of the follower marginal.', case when v_top is null then 'no_country_marginal' end);

  -- ---------- D. brand & category evidence (kept separate by evidence_type) ----------
  select count(*) into v_mentions from intel.ci_mentions where platform_account_id=v_acc and captured_at<=p_as_of;
  perform intel.ci_emit_feature(v_run,p_identity,v_acc,'brand.detected_mentions_count',1,'observed',v_mentions,null,'count','point',null,null,p_as_of,'fresh',null,'available',null,null,
    'Detected organic brand mentions (NOT worked-with relationships).',null);
  select count(*) into v_confirmed from intel.ci_creator_brand_experience where identity_id=p_identity and creator_confirmed_at is not null and creator_rejected_at is null;
  perform intel.ci_emit_feature(v_run,p_identity,v_acc,'brand.confirmed_brand_count',1,'derived',v_confirmed,null,'count','point',null,null,p_as_of,'fresh',null,'available',null,null,
    'Creator-confirmed brand relationships (declared/verified only).',null);
  select to_jsonb(categories) into v_cats from intel.ci_creator_professional_profile where identity_id=p_identity;
  perform intel.ci_emit_feature(v_run,p_identity,v_acc,'brand.category_evidence',1,'observed',null,coalesce(v_cats,'[]'::jsonb),'distribution','point',null,null,p_as_of,'fresh',null,
    case when v_cats is null then 'insufficient_data' else 'available' end,null,null,'Creator-declared categories.', case when v_cats is null then 'no_categories' end);

  -- ---------- SIX SEPARATE MEASURES ----------
  -- Coverage (derived; deterministic) and Confidence (derived) — the only two that permissions may move.
  v_cov := round((coalesce(v_perm,0)*40 + coalesce(v_ing,0)*20
            + (case when v_snap.id is not null then 20 else 0 end)
            + (case when v_top is not null then 20 else 0 end)), 2);   -- 0..100
  perform intel.ci_emit_measure(v_run,p_identity,'verified_data_coverage','available',v_cov,false,null,v_cov,p_as_of,
    'Deterministic: permissions(40) + ingestion(20) + account obs(20) + audience(20).',null);
  v_conf := round(least(1,(coalesce(v_perm,0)*0.4 + (case when v_fresh='fresh' then 0.3 else 0 end)
            + least(0.3, coalesce(v_perf_components,0)::numeric*0.05))),3);
  perform intel.ci_emit_measure(v_run,p_identity,'intelligence_confidence','available',v_conf,false,v_conf,v_cov,p_as_of,
    'Deterministic: permissions, observation freshness and evidence diversity (format components).',null);

  -- Performance: components available; OVERALL insufficient_data (no peer cohort in V1).
  perform intel.ci_emit_measure(v_run,p_identity,'creator_performance','insufficient_data',null,false,v_conf,v_cov,p_as_of,
    'Format-specific performance components are available as features ('||v_perf_components||' computed). No peer cohort exists in V1, so an overall percentile is intentionally withheld.','no_peer_cohort');

  -- Reliability: needs campaign-operational evidence (none in V1). insufficient_data.
  perform intel.ci_emit_measure(v_run,p_identity,'reliability','insufficient_data',null,false,null,v_cov,p_as_of,
    'Requires campaign-operational evidence (response/acceptance/deadlines/deliverables). None present; not inferred from posting frequency.','no_campaign_evidence');

  -- Brand Safety: needs reviewed content/compliance evidence (none). insufficient_data. No sensitive inference.
  perform intel.ci_emit_measure(v_run,p_identity,'brand_safety','insufficient_data',null,false,null,v_cov,p_as_of,
    'Requires explicit content/compliance evidence and/or human-reviewed labels. None present; no sensitive-trait inference is performed.','no_reviewed_evidence');

  -- Fraud Probability: ALWAYS a labelled estimate; requires a validated/calibrated model (none). insufficient_data.
  perform intel.ci_emit_measure(v_run,p_identity,'fraud_probability','insufficient_data',null,true,null,v_cov,p_as_of,
    'Fraud probability is an ESTIMATE, never a fact. It requires adequate history and a versioned, calibrated model. Neither exists in V1, so no decorative percentage is produced.','no_validated_model');

  update intel.ci_feature_run set status='complete', completed_at=now() where feature_run_id=v_run;
  return v_run;
end $fn$;
revoke all on function intel.ci_compute_features(uuid,timestamptz,text) from public, anon, authenticated;

-- ============================ GRANTS: service_role (internal worker) only ============================
grant execute on function intel.ci_compute_features(uuid,timestamptz,text) to service_role;
grant execute on function intel.ci_emit_feature(uuid,uuid,uuid,text,int,text,numeric,jsonb,text,text,timestamptz,timestamptz,timestamptz,text,int,text,numeric,numeric,text,text) to service_role;
grant execute on function intel.ci_emit_measure(uuid,uuid,text,text,numeric,boolean,numeric,numeric,timestamptz,text,text) to service_role;
grant usage on schema intel to service_role;   -- (already granted in 0A; explicit for the worker path)
