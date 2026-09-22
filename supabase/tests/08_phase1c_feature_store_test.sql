-- Phase 1C — feature store / six measures / provenance / privacy / index tests. Fixture-driven,
-- deterministic (fixed as-of). Runs in a transaction and rolls back.
begin;
select * from no_plan();

-- ===== contract: definitions carry observed/derived/predicted; feature tables are service-role only =====
select ok( (select count(distinct evidence_type)::int from intel.ci_feature_definition) >= 2, 'definitions span multiple evidence types');
select ok( exists(select 1 from intel.ci_feature_definition where evidence_type='observed'), 'observed features defined');
select ok( exists(select 1 from intel.ci_feature_definition where evidence_type='derived'),  'derived features defined');
select has_column('intel','ci_feature_value','evidence_type','feature values are typed observed/derived/predicted');
select ok( not has_table_privilege('anon','intel.ci_feature_value','SELECT'), 'anon cannot read feature values');
select ok( not has_table_privilege('authenticated','intel.ci_feature_value','SELECT'), 'authenticated cannot read feature values');
select ok( not has_table_privilege('authenticated','intel.ci_measure_snapshot','SELECT'), 'authenticated cannot read measures');
select ok( not has_function_privilege('authenticated','intel.ci_compute_features(uuid,timestamptz,text)','EXECUTE'), 'authenticated cannot invoke compute');
select ok( not has_function_privilege('anon','intel.ci_compute_features(uuid,timestamptz,text)','EXECUTE'), 'anon cannot invoke compute');
select ok( not has_function_privilege('public','intel.ci_emit_feature(uuid,uuid,uuid,text,int,text,numeric,jsonb,text,text,timestamptz,timestamptz,timestamptz,text,int,text,numeric,numeric,text,text)','EXECUTE'), 'PUBLIC cannot emit features');
select ok( has_function_privilege('service_role','intel.ci_compute_features(uuid,timestamptz,text)','EXECUTE'), 'service_role may invoke compute');

-- ===== no-PII columns on feature tables =====
select is( (select count(*)::int from information_schema.columns where table_schema='intel'
            and table_name in ('ci_feature_value','ci_measure_snapshot','ci_feature_evidence')
            and column_name ~* '(email|phone|whatsapp|dob|birth|address|first_name|last_name|postal)'), 0,
          'feature/measure tables contain no PII columns');

-- ===== fixtures: strong-Reels creator R with a connection, snapshot, 5 reels (+1 future), audience =====
insert into auth.users(instance_id,id,aud,role,email,created_at,updated_at) values
  ('00000000-0000-0000-0000-000000000000','c1000000-0000-0000-0000-0000000000c1','authenticated','authenticated','r@t.local',now(),now()),
  ('00000000-0000-0000-0000-000000000000','c2000000-0000-0000-0000-0000000000c2','authenticated','authenticated','n@t.local',now(),now());
update intel.ci_feature_flag set enabled=true where flag in ('creator_ig_connect','creator_profile_api');
create temp table _v(k text primary key, v text);

set local request.jwt.claims = '{"sub":"c1000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select api.bootstrap_my_profile();
insert into _v values ('st', (select api.ig_connect_start()->>'state'));
set local request.jwt.claims = '';
select intel.ci_ig_complete_connection((select v from _v where k='st'),'instagram','prod','IGR','reels.r','BUSINESS',
  array['instagram_business_basic','instagram_business_manage_insights','instagram_business_manage_comments','instagram_business_manage_messages','instagram_business_content_publish'],
  'SYNTH_R', now()+interval '60 days','notice-2026-09-18','c');
insert into _v values ('acc', (select platform_account_id::text from intel.ci_platform_account where platform_user_id='IGR'));
insert into _v values ('id',  (select identity_id::text from intel.ci_identity_platform_account where valid_to is null limit 1));

-- fixed as-of; observations placed strictly before it; one media AFTER it (must be excluded)
insert into _v values ('asof', '2026-09-22 00:00:00+00');
insert into intel.ci_account_snapshots(identity_id,platform_account_id,followers_count,media_count,captured_at,idempotency_key,status)
  values ((select v::uuid from _v where k='id'),(select v::uuid from _v where k='acc'),100000,80,'2026-09-20 00:00:00+00','snapR','available');
do $$ declare i int; mrow uuid; acc uuid; begin select v::uuid into acc from _v where k='acc';
  for i in 1..5 loop insert into intel.ci_media(platform_account_id,platform_media_id,media_type,media_product_type,media_timestamp)
      values (acc,'reel'||i,'VIDEO','REELS','2026-09-12 00:00:00+00') returning media_row_id into mrow;
    insert into intel.ci_media_insights(media_row_id,metric_name,value_count,captured_at,idempotency_key,status) values
      (mrow,'reach',10000+i*1000,'2026-09-13 00:00:00+00','r'||i,'available'),
      (mrow,'total_interactions',500+i*50,'2026-09-13 00:00:00+00','ti'||i,'available'); end loop;
  insert into intel.ci_media(platform_account_id,platform_media_id,media_type,media_product_type,media_timestamp)
    values (acc,'future','VIDEO','REELS','2026-09-25 00:00:00+00'); end $$;   -- AFTER as-of
insert into intel.ci_audience_observations(identity_id,platform_account_id,metric_name,audience_type,breakdown_type,dimension_key,value_count,captured_at,idempotency_key,status) values
  ((select v::uuid from _v where k='id'),(select v::uuid from _v where k='acc'),'follower_demographics','follower','age','25-34',42000,'2026-09-21 00:00:00+00','a1','available'),
  ((select v::uuid from _v where k='id'),(select v::uuid from _v where k='acc'),'follower_demographics','follower','country','IN',80000,'2026-09-21 00:00:00+00','c1','available'),
  ((select v::uuid from _v where k='id'),(select v::uuid from _v where k='acc'),'follower_demographics','follower','gender',null,null,'2026-09-21 00:00:00+00','g1','insufficient_audience');

-- ===== compute (fixed as-of) + idempotency + reproducibility =====
select is( intel.ci_compute_features((select v::uuid from _v where k='id'), (select v::timestamptz from _v where k='asof'), 'v1'),
           intel.ci_compute_features((select v::uuid from _v where k='id'), (select v::timestamptz from _v where k='asof'), 'v1'),
           'compute is idempotent for the same (identity, as-of, version)');
insert into _v values ('run', (intel.ci_compute_features((select v::uuid from _v where k='id'), (select v::timestamptz from _v where k='asof'), 'v1'))::text);
select is( (select count(distinct feature_run_id)::int from intel.ci_feature_value where identity_id=(select v::uuid from _v where k='id')), 1, 'only one feature run for the fixed as-of (reproducible)');

-- ===== no unavailable value serializes as zero =====
select is( (select count(*)::int from intel.ci_feature_value where value_status<>'available' and value_num is not null), 0, 'unavailable/insufficient never carry a numeric value');
select is( (select count(*)::int from intel.ci_measure_snapshot where value_status<>'available' and value_num is not null), 0, 'unavailable measures never carry a numeric value');

-- ===== future-data leakage excluded; formats not combined =====
select is( (select value_num::int from intel.ci_feature_value where feature_key='content.sample_size' and window_kind='30d' and value_json->>'format'='REELS' and feature_run_id=(select v::uuid from _v where k='run')), 5, 'future media excluded from as-of sample (5 not 6)');
select is( (select value_num from intel.ci_feature_value where feature_key='content.reach_avg' and window_kind='30d' and value_json->>'format'='REELS' and feature_run_id=(select v::uuid from _v where k='run')), 13000.00, 'REELS reach_avg computed only from REELS media');
select is( (select value_status from intel.ci_feature_value where feature_key='content.reach_avg' and window_kind='30d' and value_json->>'format'='STORY' and feature_run_id=(select v::uuid from _v where k='run')), 'insufficient_data', 'STORY (no story media) is insufficient_data, not mixed with REELS');

-- ===== audience marginal only; no joint; missing threshold => insufficient_data =====
select is( (select value_status from intel.ci_feature_value where feature_key='audience.age_distribution' and feature_run_id=(select v::uuid from _v where k='run')), 'available', 'age marginal available');
select is( (select value_status from intel.ci_feature_value where feature_key='audience.gender_distribution' and feature_run_id=(select v::uuid from _v where k='run')), 'insufficient_data', 'gender below threshold => insufficient_data');
select ok( (select value_json->>'_note' from intel.ci_feature_value where feature_key='audience.age_distribution' and feature_run_id=(select v::uuid from _v where k='run')) ilike '%marginal%', 'audience feature is labelled marginal (not a joint)');
select is( (select count(*)::int from intel.ci_feature_value where feature_key ilike 'audience.%joint%'), 0, 'no joint-intersection audience feature exists');

-- ===== provenance resolves to real source rows =====
select ok( exists(
  select 1 from intel.ci_feature_value fv
  join intel.ci_feature_evidence fe on fe.feature_value_id=fv.feature_value_id
  join intel.ci_account_snapshots s on s.id=fe.source_row_id
  where fv.feature_key='account.followers' and fv.feature_run_id=(select v::uuid from _v where k='run')),
  'account.followers provenance resolves to a real ci_account_snapshots row');

-- ===== SIX SEPARATE MEASURES, truthful V1 status =====
select is( (select value_status from intel.ci_measure_snapshot where measure='creator_performance' and feature_run_id=(select v::uuid from _v where k='run')), 'insufficient_data', 'performance overall insufficient_data (no peer cohort)');
select is( (select value_status from intel.ci_measure_snapshot where measure='reliability' and feature_run_id=(select v::uuid from _v where k='run')), 'insufficient_data', 'reliability insufficient_data (no campaign evidence)');
select is( (select value_status from intel.ci_measure_snapshot where measure='brand_safety' and feature_run_id=(select v::uuid from _v where k='run')), 'insufficient_data', 'brand_safety insufficient_data (no reviewed evidence)');
select is( (select value_status from intel.ci_measure_snapshot where measure='fraud_probability' and feature_run_id=(select v::uuid from _v where k='run')), 'insufficient_data', 'fraud_probability insufficient_data (no validated model)');
select is( (select is_estimate from intel.ci_measure_snapshot where measure='fraud_probability' and feature_run_id=(select v::uuid from _v where k='run')), true, 'fraud_probability is always labelled an estimate');
select is( (select value_status from intel.ci_measure_snapshot where measure='verified_data_coverage' and feature_run_id=(select v::uuid from _v where k='run')), 'available', 'coverage is deterministically available');
select is( (select value_status from intel.ci_measure_snapshot where measure='intelligence_confidence' and feature_run_id=(select v::uuid from _v where k='run')), 'available', 'confidence is deterministically available');
select is( (select count(distinct measure)::int from intel.ci_measure_snapshot where feature_run_id=(select v::uuid from _v where k='run')), 6, 'exactly six separate measures (no blended universal score)');

-- ===== permission/capability disable affects only Confidence/Coverage, never Performance/Reliability/Fraud =====
set local request.jwt.claims = '{"sub":"c1000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select api.set_capability('performance_insights', false);
select api.set_capability('publishing_scheduling', false);   -- publishing must affect nothing
set local request.jwt.claims = '';
insert into _v values ('run2', (intel.ci_compute_features((select v::uuid from _v where k='id'), (select v::timestamptz from _v where k='asof')+interval '1 hour', 'v1'))::text);
select is( (select value_status from intel.ci_measure_snapshot where measure='creator_performance' and feature_run_id=(select v::uuid from _v where k='run2')), 'insufficient_data', 'capability disable does not change performance status');
select is( (select value_status from intel.ci_measure_snapshot where measure='fraud_probability' and feature_run_id=(select v::uuid from _v where k='run2')), 'insufficient_data', 'capability disable does NOT raise fraud');
select is( (select value_num from intel.ci_measure_snapshot where measure='fraud_probability' and feature_run_id=(select v::uuid from _v where k='run2')), null, 'fraud has no fabricated value after disable');
-- capability_coverage feature dropped (2 of 4 now enabled)
select ok( (select value_num from intel.ci_feature_value where feature_key='account.capability_coverage' and feature_run_id=(select v::uuid from _v where k='run2')) < 1, 'capability_coverage reflects the disable (Coverage moved)');

-- ===== append-only history + browser roles cannot mutate =====
select throws_ok($$ update intel.ci_feature_value set value_num=0 $$, null, null, 'feature values are append-only (no UPDATE)');
select throws_ok($$ delete from intel.ci_measure_snapshot $$, null, null, 'measure snapshots are append-only (no DELETE)');

-- ===== sparse/new creator N: no observations => features insufficient, measures insufficient =====
set local request.jwt.claims = '{"sub":"c2000000-0000-0000-0000-0000000000c2","role":"authenticated"}';
select api.bootstrap_my_profile();
set local request.jwt.claims = '';
insert into _v values ('idN', (select a.identity_id::text from intel.ci_identity_actor_access a where a.member_id='c2000000-0000-0000-0000-0000000000c2' and a.access_role='self' limit 1));
insert into _v values ('runN', (intel.ci_compute_features((select v::uuid from _v where k='idN'), (select v::timestamptz from _v where k='asof'), 'v1'))::text);
select is( (select value_status from intel.ci_feature_value where feature_key='account.followers' and feature_run_id=(select v::uuid from _v where k='runN')), 'insufficient_data', 'sparse creator: no follower observation => insufficient_data (not 0)');
select is( (select value_status from intel.ci_measure_snapshot where measure='reliability' and feature_run_id=(select v::uuid from _v where k='runN')), 'insufficient_data', 'sparse creator: reliability insufficient_data');

-- ===== required FK/query indexes exist (from the hardening migration) =====
select ok( (select count(*)::int from pg_indexes where schemaname='intel' and indexname in
  ('ci_account_snap_identity_idx','ci_audience_identity_idx','ci_account_snap_run_idx','ci_audience_run_idx',
   'ci_ingest_run_account_idx','ci_ingest_run_connection_idx','ci_mentions_run_idx','ci_comments_run_idx',
   'ci_feature_value_lookup_idx','ci_feature_evidence_value_idx')) = 10, 'required FK/query indexes exist');

select * from finish();
rollback;
