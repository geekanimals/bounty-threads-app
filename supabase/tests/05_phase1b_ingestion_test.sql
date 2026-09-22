-- Phase 1B — ingestion / audience / connection-lifecycle / privacy tests. Fixture-driven, no network.
-- Runs in a transaction and rolls back. Flags enabled LOCALLY inside the txn only.

begin;
select * from no_plan();

-- ===== schema shape: append-only + no raw-secret columns + service-role isolation =====
select has_table('intel','ci_ingest_run','ingest run table exists');
select has_table('intel','ci_audience_observations','audience observations table exists');
select has_table('private','ci_comment_raw','restricted raw comment store is in private');
-- observation tables must not carry raw token/secret columns
select hasnt_column('intel','ci_account_snapshots','token', 'account snapshots have no token column');
select hasnt_column('intel','ci_platform_connection','access_token','connection has no raw token column');
select hasnt_column('intel','ci_platform_connection','token','connection has no token value column');
-- messaging store keeps NO raw body
select hasnt_column('intel','ci_messaging_operational','body','messaging store has no raw body');
select hasnt_column('intel','ci_messaging_operational','message_text','messaging store has no message text');
select ok( (select count(*)::int from information_schema.columns where table_schema='intel' and table_name='ci_messaging_operational' and column_name like '%body%')=0, 'messaging store has no *body* column');

-- ===== grant-layer: internal tables/writers locked; api reads authenticated-only =====
select ok( not has_table_privilege('anon','intel.ci_audience_observations','SELECT'), 'anon cannot select audience obs');
select ok( not has_table_privilege('authenticated','intel.ci_account_snapshots','SELECT'), 'authenticated cannot select raw snapshots');
select ok( not has_table_privilege('authenticated','private.ci_comment_raw','SELECT'), 'authenticated cannot select raw comments');
select ok( not has_function_privilege('public','intel.ci_write_account_snapshot(uuid,uuid,uuid,jsonb,text,timestamptz)','EXECUTE'), 'PUBLIC cannot exec snapshot writer');
select ok( not has_function_privilege('authenticated','intel.ci_enqueue_initial_ingest(uuid,text)','EXECUTE'), 'authenticated cannot enqueue ingest');
select ok( not has_function_privilege('anon','api.get_my_audience()','EXECUTE'), 'anon cannot read audience api');
select ok(     has_function_privilege('authenticated','api.get_my_audience()','EXECUTE'), 'authenticated may read audience api');
select ok(     has_function_privilege('authenticated','api.disconnect_platform(uuid,text)','EXECUTE'), 'authenticated may disconnect');

-- ===== fixtures: a creator with a full connection (all 5 scopes) =====
update intel.ci_feature_flag set enabled=true where flag in ('creator_ig_connect','creator_profile_api');
insert into auth.users (instance_id,id,aud,role,email,created_at,updated_at) values
  ('00000000-0000-0000-0000-000000000000','d1000000-0000-0000-0000-0000000000d1','authenticated','authenticated','d1@test.local',now(),now()),
  ('00000000-0000-0000-0000-000000000000','d2000000-0000-0000-0000-0000000000d2','authenticated','authenticated','d2@test.local',now(),now());
set local request.jwt.claims = '{"sub":"d1000000-0000-0000-0000-0000000000d1","role":"authenticated"}';
select api.bootstrap_my_profile();
create temp table _v(k text primary key, v text);
insert into _v values ('state1', (select api.ig_connect_start()->>'state'));
set local request.jwt.claims = '';
select intel.ci_ig_complete_connection((select v from _v where k='state1'),'instagram','prod','IGX1','creator.x','BUSINESS',
  array['instagram_business_basic','instagram_business_manage_insights','instagram_business_manage_comments','instagram_business_manage_messages','instagram_business_content_publish'],
  'SYNTH_TOKEN_X', now()+interval '60 days','notice-2026-09-18','c');
insert into _v values ('conn', (select connection_id::text from intel.ci_platform_connection where status='active' limit 1));
insert into _v values ('acc',  (select platform_account_id::text from intel.ci_platform_connection where status='active' limit 1));
insert into _v values ('ident',(select identity_id::text from intel.ci_identity_platform_account where valid_to is null limit 1));

-- ===== grant truth: only returned scopes valid; token stored as Vault ref (not raw) =====
select is( (select count(*)::int from intel.ci_scope_grant where connection_id=(select v::uuid from _v where k='conn') and valid), 5, 'all five scopes granted');
select isnt( (select token_reference from intel.ci_platform_connection where status='active' limit 1), 'SYNTH_TOKEN_X', 'token_reference is a Vault ref, not the raw token');
select is( (select count(*)::int from intel.ci_platform_connection where platform_account_id=(select v::uuid from _v where k='acc') and status='active'), 1, 'exactly one active connection');

-- ===== capability gate: enabled where granted; disabling blocks that capability's ingest =====
select is( intel.ci_can_ingest((select v::uuid from _v where k='conn'),'performance_insights'), true, 'perf ingest allowed when granted+enabled');
select is( intel.ci_can_ingest((select v::uuid from _v where k='conn'), null), true, 'basic account stage always allowed');
set local request.jwt.claims = '{"sub":"d1000000-0000-0000-0000-0000000000d1","role":"authenticated"}';
select api.set_capability('performance_insights', false);
select is( intel.ci_can_ingest((select v::uuid from _v where k='conn'),'performance_insights'), false, 'disabling capability blocks its ingest');
select api.set_capability('performance_insights', true);   -- re-enable (grant still valid → no reconnect)
select is( intel.ci_can_ingest((select v::uuid from _v where k='conn'),'performance_insights'), true, 're-enable resumes without reconnect');
set local request.jwt.claims = '';

-- ===== enqueue + observations: idempotent, append-only, no-zero-for-unavailable =====
select intel.ci_enqueue_initial_ingest((select v::uuid from _v where k='conn'),'c');
select is( (select count(*)::int from intel.ci_ingest_stage), 10, 'ten ingest stages queued');
select intel.ci_write_account_snapshot((select run_id from intel.ci_ingest_run limit 1),(select v::uuid from _v where k='ident'),(select v::uuid from _v where k='acc'),
  '{"followers_count":84000,"reach":null,"status":"available"}'::jsonb,'snap:a');
select intel.ci_write_account_snapshot((select run_id from intel.ci_ingest_run limit 1),(select v::uuid from _v where k='ident'),(select v::uuid from _v where k='acc'),
  '{"followers_count":84000}'::jsonb,'snap:a');   -- duplicate idem key
select is( (select count(*)::int from intel.ci_account_snapshots), 1, 'idempotent snapshot dedupe (retry writes no new row)');
select is( (select reach from intel.ci_account_snapshots limit 1), null, 'unavailable reach is NULL, never 0');
select throws_ok($$ update intel.ci_account_snapshots set followers_count=0 $$, null, null, 'snapshots are append-only (no UPDATE)');
select throws_ok($$ delete from intel.ci_account_snapshots $$, null, null, 'snapshots are append-only (no DELETE)');

-- ===== audience: follower vs engaged distinct; suppressed => null + reason; independent per metric =====
select intel.ci_write_audience((select run_id from intel.ci_ingest_run limit 1),(select v::uuid from _v where k='ident'),(select v::uuid from _v where k='acc'),
  '[{"metric_name":"follower_demographics","audience_type":"follower","breakdown_type":"age","dimension_key":"25-34","value_count":42000,"status":"available"},
    {"metric_name":"follower_demographics","audience_type":"follower","breakdown_type":"gender","value_count":null,"status":"insufficient_audience","suppression_reason":"below_threshold"},
    {"metric_name":"engaged_audience_demographics","audience_type":"engaged","breakdown_type":"city","dimension_key":"Mumbai","value_count":1200,"status":"available"}]'::jsonb,'aud:a');
select is( (select count(distinct audience_type)::int from intel.ci_audience_observations), 2, 'follower and engaged audiences kept distinct');
select is( (select value_count from intel.ci_audience_observations where breakdown_type='gender'), null, 'suppressed bucket value is NULL (not 0)');
select is( (select status from intel.ci_audience_observations where breakdown_type='gender'), 'insufficient_audience', 'suppressed bucket carries a reason');
select is( (select count(*)::int from intel.ci_audience_observations where value_count=0), 0, 'no audience bucket stored as 0-for-unavailable');
-- snapshot history preserved: a second (differing) same-day observation adds a NEW row
select intel.ci_write_account_snapshot((select run_id from intel.ci_ingest_run limit 1),(select v::uuid from _v where k='ident'),(select v::uuid from _v where k='acc'),
  '{"followers_count":84050}'::jsonb,'snap:b');
select is( (select count(*)::int from intel.ci_account_snapshots), 2, 'differing same-day observation preserved as new append-only row');

-- ===== owner reads; cross-creator + anon denial =====
set local request.jwt.claims = '{"sub":"d1000000-0000-0000-0000-0000000000d1","role":"authenticated"}';
select is( api.get_my_ingestion_status()->'run'->>'status', 'queued', 'owner sees own ingest run');
select ok( jsonb_array_length(api.get_my_audience()->'metrics') >= 1, 'owner sees aggregated audience metrics');
set local request.jwt.claims = '{"sub":"d2000000-0000-0000-0000-0000000000d2","role":"authenticated"}';
select api.bootstrap_my_profile();
select is( (api.get_my_audience()->>'available'), 'false', 'other creator has no audience (cannot see d1)');
select is( jsonb_typeof(api.get_my_ingestion_status()->'run'), 'null', 'other creator sees no run');
set local request.jwt.claims = '';
select throws_ok($$ select api.get_my_audience() $$, '28000', null, 'anon cannot read audience');

-- ===== disconnect: connection disconnected, token ref cleared, ingest blocked, runs cancelled =====
set local request.jwt.claims = '{"sub":"d1000000-0000-0000-0000-0000000000d1","role":"authenticated"}';
select api.disconnect_platform((select v::uuid from _v where k='conn'));
select is( (select status from intel.ci_platform_connection where connection_id=(select v::uuid from _v where k='conn')), 'disconnected', 'connection marked disconnected');
select is( (select token_reference from intel.ci_platform_connection where connection_id=(select v::uuid from _v where k='conn')), null, 'token reference cleared on disconnect');
select is( intel.ci_can_ingest((select v::uuid from _v where k='conn'),'performance_insights'), false, 'disconnected account cannot ingest');
select ok( (select count(*)::int from intel.ci_ingest_run where connection_id=(select v::uuid from _v where k='conn') and status='cancelled') >= 1, 'queued runs cancelled on disconnect');
-- manual profile is NOT deleted by disconnect
select ok( exists(select 1 from intel.ci_creator_professional_profile where identity_id=(select v::uuid from _v where k='ident')), 'disconnect does not delete the manual profile');

select * from finish();
rollback;
