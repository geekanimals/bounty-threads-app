-- Phase 1D — Intelligence Serving & Explainable Matching tests. Drives the REAL compute pipeline
-- (as 1C does) to produce genuine feature runs, then exercises the api serving + evidence + matching
-- layer. Asserts: RLS/ownership isolation, org isolation, no-PII leakage, provenance, append-only, and
-- the four required behaviours (strong creator => explainable match; new creator => insufficient_data;
-- capability disable moves Coverage only — never Performance/Fraud; unrelated brand => access denied).
-- Deterministic (fixed as-of). Runs in a transaction and rolls back.
begin;
select * from no_plan();

-- ============================================================================
-- STATIC: matching store is service-role only; browsers can't touch intel; api is authorised-only
-- ============================================================================
select ok( not has_table_privilege('anon','intel.ci_matching_request','SELECT'), 'anon cannot read matching requests');
select ok( not has_table_privilege('authenticated','intel.ci_matching_request','SELECT'), 'authenticated cannot read matching requests');
select ok( not has_table_privilege('authenticated','intel.ci_match_result','SELECT'), 'authenticated cannot read match results');
select ok( not has_table_privilege('anon','intel.ci_match_result','INSERT'), 'anon cannot write match results');
select ok( not has_function_privilege('anon','intel.ci_match_creators(uuid)','EXECUTE'), 'anon cannot invoke the matcher directly');
select ok( not has_function_privilege('authenticated','intel.ci_match_creators(uuid)','EXECUTE'), 'authenticated cannot invoke the matcher directly');
select ok( not has_function_privilege('authenticated','intel.ci_serve_intelligence(uuid,text)','EXECUTE'), 'authenticated cannot invoke the internal serving function');
select ok( not has_function_privilege('authenticated','intel.ci_brand_can_view(uuid)','EXECUTE'), 'authenticated cannot invoke the internal authoriser');
select ok( has_function_privilege('authenticated','api.get_my_creator_intelligence()','EXECUTE'), 'authenticated may call the creator self-view api');
select ok( has_function_privilege('authenticated','api.get_creator_intelligence(uuid)','EXECUTE'), 'authenticated may call the brand view api');
select ok( has_function_privilege('authenticated','api.get_feature_evidence(uuid)','EXECUTE'), 'authenticated may call the evidence api');
select ok( has_function_privilege('authenticated','api.match_creators(jsonb,uuid)','EXECUTE'), 'authenticated may call the matching api');
select ok( not has_function_privilege('anon','api.match_creators(jsonb,uuid)','EXECUTE'), 'anon cannot call the matching api');

-- no PII columns on the matching tables
select is( (select count(*)::int from information_schema.columns where table_schema='intel'
            and table_name in ('ci_matching_request','ci_match_result')
            and column_name ~* '(email|phone|whatsapp|dob|birth|address|first_name|last_name|postal|rate_card)'), 0,
          'matching tables contain no PII/commercial columns');

-- ============================================================================
-- FIXTURES
--   R  = strong, connected creator (real pipeline + compute) ; managed by brand B
--   N  = new/sparse creator (bootstrap + compute, no observations) ; managed by brand B
--   B  = brand user with a relationship to R and N
--   U  = unrelated brand user (no relationship)
-- ============================================================================
-- The org directory `public.members` is part of the legacy app (present in the coexistence run). The
-- foundation run applies ONLY the CI migrations, so it may be absent — provide a minimal, compatible
-- shim when it is. Both branches leave the real legacy table untouched (IF NOT EXISTS is a no-op there).
create table if not exists public.members(
  id uuid primary key, org_id uuid not null default gen_random_uuid(), role text, name text);

insert into auth.users(instance_id,id,aud,role,email,created_at,updated_at) values
  ('00000000-0000-0000-0000-000000000000','c1000000-0000-0000-0000-0000000000c1','authenticated','authenticated','r@t.local',now(),now()),
  ('00000000-0000-0000-0000-000000000000','c2000000-0000-0000-0000-0000000000c2','authenticated','authenticated','n@t.local',now(),now()),
  ('00000000-0000-0000-0000-000000000000','b3000000-0000-0000-0000-0000000000b3','authenticated','authenticated','brand@t.local',now(),now()),
  ('00000000-0000-0000-0000-000000000000','d4000000-0000-0000-0000-0000000000d4'::uuid,'authenticated','authenticated','other@t.local',now(),now());
-- Guarantee each brand user has a members row + org in BOTH envs. In coexistence the legacy
-- handle_new_user trigger already created these on the auth.users insert, so this is a no-op there.
insert into public.members(id, role, name) values
  ('b3000000-0000-0000-0000-0000000000b3','brand','Brand B'),
  ('d4000000-0000-0000-0000-0000000000d4'::uuid,'brand','Brand X')
  on conflict (id) do nothing;
update intel.ci_feature_flag set enabled=true where flag in ('creator_ig_connect','creator_profile_api');
create temp table _v(k text primary key, v text);
insert into _v values ('asof', '2026-09-22 00:00:00+00');
insert into _v values ('ob', (select org_id::text from public.members where id='b3000000-0000-0000-0000-0000000000b3'));
insert into _v values ('ou', (select org_id::text from public.members where id='d4000000-0000-0000-0000-0000000000d4'::uuid));

-- ---- R: bootstrap + IG connect + observations + compute ----
set local request.jwt.claims = '{"sub":"c1000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select api.bootstrap_my_profile();
insert into _v values ('st', (select api.ig_connect_start()->>'state'));
set local request.jwt.claims = '';
select intel.ci_ig_complete_connection((select v from _v where k='st'),'instagram','prod','IGR','reels.r','BUSINESS',
  array['instagram_business_basic','instagram_business_manage_insights','instagram_business_manage_comments','instagram_business_manage_messages','instagram_business_content_publish'],
  'SYNTH_R', now()+interval '60 days','notice-2026-09-18','c');
insert into _v values ('accR', (select platform_account_id::text from intel.ci_platform_account where platform_user_id='IGR'));
insert into _v values ('idR',  (select a.identity_id::text from intel.ci_identity_actor_access a where a.member_id='c1000000-0000-0000-0000-0000000000c1' and a.access_role='self' limit 1));
insert into intel.ci_account_snapshots(identity_id,platform_account_id,followers_count,media_count,captured_at,idempotency_key,status)
  values ((select v::uuid from _v where k='idR'),(select v::uuid from _v where k='accR'),100000,80,'2026-09-20 00:00:00+00','snapR','available');
do $$ declare i int; mrow uuid; acc uuid; begin select v::uuid into acc from _v where k='accR';
  for i in 1..5 loop insert into intel.ci_media(platform_account_id,platform_media_id,media_type,media_product_type,media_timestamp)
      values (acc,'reel'||i,'VIDEO','REELS','2026-09-12 00:00:00+00') returning media_row_id into mrow;
    insert into intel.ci_media_insights(media_row_id,metric_name,value_count,captured_at,idempotency_key,status) values
      (mrow,'reach',10000+i*1000,'2026-09-13 00:00:00+00','r'||i,'available'),
      (mrow,'total_interactions',500+i*50,'2026-09-13 00:00:00+00','ti'||i,'available'); end loop; end $$;
insert into intel.ci_audience_observations(identity_id,platform_account_id,metric_name,audience_type,breakdown_type,dimension_key,value_count,captured_at,idempotency_key,status) values
  ((select v::uuid from _v where k='idR'),(select v::uuid from _v where k='accR'),'follower_demographics','follower','country','IN',80000,'2026-09-21 00:00:00+00','cIN','available'),
  ((select v::uuid from _v where k='idR'),(select v::uuid from _v where k='accR'),'follower_demographics','follower','country','US',20000,'2026-09-21 00:00:00+00','cUS','available');
-- professional category + confirmed brand experience (hard filter + soft signal inputs)
update intel.ci_creator_professional_profile set categories=array['fitness','wellness'], content_formats=array['reels']
  where identity_id=(select v::uuid from _v where k='idR');
insert into intel.ci_creator_brand_experience(identity_id, submitted_brand_name, source_type, verification_status, creator_confirmed_at)
  values ((select v::uuid from _v where k='idR'),'Acme Sports','creator_declared','creator_confirmed', now());
insert into _v values ('runR', (intel.ci_compute_features((select v::uuid from _v where k='idR'), (select v::timestamptz from _v where k='asof'), 'v1'))::text);

-- ---- N: bootstrap + compute, but NO observations (new/sparse creator) ----
set local request.jwt.claims = '{"sub":"c2000000-0000-0000-0000-0000000000c2","role":"authenticated"}';
select api.bootstrap_my_profile();
set local request.jwt.claims = '';
insert into _v values ('idN', (select a.identity_id::text from intel.ci_identity_actor_access a where a.member_id='c2000000-0000-0000-0000-0000000000c2' and a.access_role='self' limit 1));
insert into _v values ('runN', (intel.ci_compute_features((select v::uuid from _v where k='idN'), (select v::timestamptz from _v where k='asof'), 'v1'))::text);

-- ---- brand B relationships (managed) to R and N; U has none ----
insert into intel.ci_org_creator_relationship(org_id, identity_id, relationship_type, status) values
  ((select v::uuid from _v where k='ob'),(select v::uuid from _v where k='idR'),'managed','active'),
  ((select v::uuid from _v where k='ob'),(select v::uuid from _v where k='idN'),'managed','active');

-- ============================================================================
-- SERVING — creator self-view (R)
-- ============================================================================
set local request.jwt.claims = '{"sub":"c1000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select is( (api.get_my_creator_intelligence()->>'tier'), 'self', 'self-view is served at the self tier');
select ok( jsonb_array_length(api.get_my_creator_intelligence()->'performance'->'metrics') > 0, 'self-view exposes explainable per-metric detail');
select is( (api.get_my_creator_intelligence()->'fraud_probability'->>'status'), 'insufficient_data', 'self fraud is insufficient_data (never a fabricated 0%)');
select is( (api.get_my_creator_intelligence()->'fraud_probability'->>'is_estimate'), 'true', 'self fraud is always labelled an estimate');
select is( (api.get_my_creator_intelligence()->'coverage'->>'status'), 'available', 'self coverage is available');
select ok( (api.get_my_creator_intelligence()->'performance'->>'status') is not null, 'self performance carries an explicit status');
-- NO opaque universal score anywhere in the payload
select is( (select count(*)::int from jsonb_object_keys(api.get_my_creator_intelligence()) k where k ~* '(creator_score|overall_score|rank|grade)'), 0, 'no opaque universal score/rank key in the payload');
-- NO PII / commercial / raw / token leakage
select ok( api.get_my_creator_intelligence()::text !~* '(whatsapp|"email"|"phone"|date_of_birth|rate_card|access_token|refresh_token|"token")',
           'self payload leaks no PII / commercial / token');

-- self metrics each carry a feature_value_id — the handle a caller uses to request evidence
select ok( (select bool_and((e->>'feature_value_id') is not null)
            from jsonb_array_elements(api.get_my_creator_intelligence()->'performance'->'metrics') e),
           'every self metric exposes a feature_value_id evidence handle');
-- provenance target: an observed feature (account.followers) that resolves to a real source row
insert into _v values ('fvR', (select feature_value_id::text from intel.ci_feature_value
   where feature_run_id=(select v::uuid from _v where k='runR') and feature_key='account.followers' and value_status='available' limit 1));

-- ============================================================================
-- SERVING — brand view (B, related) : restricted projection
-- ============================================================================
set local request.jwt.claims = '{"sub":"b3000000-0000-0000-0000-0000000000b3","role":"authenticated"}';
select is( (api.get_creator_intelligence((select v::uuid from _v where k='idR'))->>'tier'), 'brand', 'related brand is served at the brand tier');
select is( jsonb_array_length(api.get_creator_intelligence((select v::uuid from _v where k='idR'))->'performance'->'metrics'), 0,
           'brand tier does NOT expose the raw per-metric dump (summary only)');
select ok( (api.get_creator_intelligence((select v::uuid from _v where k='idR'))->'performance'->>'reels_analysed') is not null,
           'brand tier still shows an evidence summary (reels analysed)');
select ok( api.get_creator_intelligence((select v::uuid from _v where k='idR'))::text !~* '(whatsapp|"phone"|date_of_birth|rate_card|access_token|refresh_token)',
           'brand payload leaks no private contact / commercial / token');

-- ============================================================================
-- EVIDENCE api (related brand) — provenance + model version, authorised
-- ============================================================================
select ok( jsonb_array_length(api.get_feature_evidence((select v::uuid from _v where k='fvR'))->'source') > 0,
           'evidence resolves to at least one real source kind');
select is( (api.get_feature_evidence((select v::uuid from _v where k='fvR'))->>'model_version'), 'v1',
           'evidence carries the producing model version');
select ok( (api.get_feature_evidence((select v::uuid from _v where k='fvR'))->>'calculated_at') is not null,
           'evidence carries a calculated_at timestamp');

-- ============================================================================
-- MATCHING — brief-specific, explainable (B): R is a strong explainable match
-- ============================================================================
insert into _v values ('m', (api.match_creators('{"category":["fitness"],"location":["IN"],"content_formats":["reels"],"platform":"instagram"}'::jsonb))::text);
-- R present and matched
select ok( exists( select 1 from jsonb_array_elements((select v::jsonb from _v where k='m')->'results') e
                   where e->>'creator_identity_id'=(select v from _v where k='idR') and e->>'match_status' in ('match','partial')),
           'strong creator appears as an explainable match for the brief');
-- R's explainable positive signals (evidence-backed, no opaque score)
select ok( (select e->'matched_signals' ? 'fitness category match'
            from jsonb_array_elements((select v::jsonb from _v where k='m')->'results') e where e->>'creator_identity_id'=(select v from _v where k='idR')),
           'match explains the fitness category signal');
select ok( (select exists(select 1 from jsonb_array_elements_text(e->'matched_signals') s where s ilike '%audience presence%')
            from jsonb_array_elements((select v::jsonb from _v where k='m')->'results') e where e->>'creator_identity_id'=(select v from _v where k='idR')),
           'match explains the requested-location audience signal');
select ok( (select exists(select 1 from jsonb_array_elements_text(e->'matched_signals') s where s ilike '%REELS performance%')
            from jsonb_array_elements((select v::jsonb from _v where k='m')->'results') e where e->>'creator_identity_id'=(select v from _v where k='idR')),
           'match explains the requested-format performance signal');
select ok( (select e->'matched_signals' ? 'prior brand campaign experience'
            from jsonb_array_elements((select v::jsonb from _v where k='m')->'results') e where e->>'creator_identity_id'=(select v from _v where k='idR')),
           'match explains the confirmed brand-experience signal');
-- honest limitations are always surfaced (never fabricated)
select ok( (select e->'missing_signals' ? 'conversion data unavailable'
            from jsonb_array_elements((select v::jsonb from _v where k='m')->'results') e where e->>'creator_identity_id'=(select v from _v where k='idR')),
           'match honestly reports that conversion data is unavailable');
select ok( (select e->>'match_strength' in ('strong','moderate','weak')
            from jsonb_array_elements((select v::jsonb from _v where k='m')->'results') e where e->>'creator_identity_id'=(select v from _v where k='idR')),
           'match carries an explainable strength band (not an opaque score)');

-- brief-specificity: a brief for an unmet location does NOT invent a geo signal
insert into _v values ('m2', (api.match_creators('{"category":["fitness"],"location":["ZZ"],"content_formats":["reels"]}'::jsonb))::text);
select ok( (select e->'missing_signals' ? 'requested-location audience not evidenced'
            from jsonb_array_elements((select v::jsonb from _v where k='m2')->'results') e where e->>'creator_identity_id'=(select v from _v where k='idR')),
           'a brief for an unmet location surfaces the gap instead of fabricating a signal');

-- ============================================================================
-- NEW / SPARSE CREATOR (N)
-- ============================================================================
-- self-view: a new creator is insufficient_data, never a fabricated performance
set local request.jwt.claims = '{"sub":"c2000000-0000-0000-0000-0000000000c2","role":"authenticated"}';
select is( (api.get_my_creator_intelligence()->'performance'->>'status'), 'insufficient_data', 'new creator performance is insufficient_data (not 0)');
select is( (api.get_my_creator_intelligence()->'fraud_probability'->>'status'), 'insufficient_data', 'new creator fraud is insufficient_data (not 0)');
-- matcher: a new creator is never fabricated into a strong match
select ok( (select coalesce(e->>'match_strength','') <> 'strong' and jsonb_array_length(e->'matched_signals')=0
            from jsonb_array_elements((select v::jsonb from _v where k='m')->'results') e where e->>'creator_identity_id'=(select v from _v where k='idN')),
           'new creator is not fabricated into a strong match (no positive signals)');

-- ============================================================================
-- ORG ISOLATION — unrelated brand U : denied + empty candidate pool
-- ============================================================================
set local request.jwt.claims = '{"sub":"d4000000-0000-0000-0000-0000000000d4","role":"authenticated"}';
select throws_ok( $$ select api.get_creator_intelligence('00000000-0000-0000-0000-000000000000'::uuid) $$, null, null, 'unrelated brand cannot resolve a foreign creator (helper) ');
select throws_ok(
  format($$ select api.get_creator_intelligence(%L::uuid) $$, (select v from _v where k='idR')),
  '42501', 'not authorised to view this creator', 'unrelated brand is denied the brand view (42501)');
select throws_ok(
  format($$ select api.get_feature_evidence(%L::uuid) $$, (select v from _v where k='fvR')),
  '42501', null, 'unrelated brand is denied feature evidence (42501)');
select is( jsonb_array_length( api.match_creators('{"category":["fitness"],"location":["IN"]}'::jsonb)->'results'), 0,
           'unrelated brand matches against an EMPTY candidate pool (org isolation)');

-- ============================================================================
-- CAPABILITY DISABLE moves Coverage only — never Performance or Fraud
-- ============================================================================
set local request.jwt.claims = '{"sub":"c1000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select api.set_capability('performance_insights', false);
set local request.jwt.claims = '';
insert into _v values ('runR2', (intel.ci_compute_features((select v::uuid from _v where k='idR'), (select v::timestamptz from _v where k='asof')+interval '1 hour', 'v1'))::text);
set local request.jwt.claims = '{"sub":"c1000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select is( (api.get_my_creator_intelligence()->'performance'->>'status'), 'insufficient_data', 'capability disable does NOT change served performance status');
select is( (api.get_my_creator_intelligence()->'fraud_probability'->>'status'), 'insufficient_data', 'capability disable does NOT raise served fraud status');
select ok( (api.get_my_creator_intelligence()->'fraud_probability'->>'value') is null, 'served fraud carries no fabricated value after disable');
select ok(
  (select value_num from intel.ci_feature_value where feature_key='account.capability_coverage' and feature_run_id=(select v::uuid from _v where k='runR2'))
  < (select value_num from intel.ci_feature_value where feature_key='account.capability_coverage' and feature_run_id=(select v::uuid from _v where k='runR')),
  'capability disable lowers Coverage (capability_coverage moved down)');

-- ============================================================================
-- APPEND-ONLY match history
-- ============================================================================
select throws_ok( $$ update intel.ci_match_result set match_status='match' $$, null, null, 'match results are append-only (no UPDATE)');
select throws_ok( $$ delete from intel.ci_match_result $$, null, null, 'match results are append-only (no DELETE)');

select * from finish();
rollback;
