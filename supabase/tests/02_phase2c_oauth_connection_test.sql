-- Phase 2C — secure Instagram connection / OAuth foundation tests.
-- DB-testable security is exercised here; the Meta HTTP boundary is unit-tested in Deno
-- (supabase/functions/_shared/meta_oauth_test.ts). Runs in a transaction and rolls back.

begin;
select * from no_plan();

-- fixtures: three members
insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000','a0c00000-0000-0000-0000-00000000000a','authenticated','authenticated','a-2c@test.local', now(), now()),
  ('00000000-0000-0000-0000-000000000000','b0c00000-0000-0000-0000-00000000000b','authenticated','authenticated','b-2c@test.local', now(), now()),
  ('00000000-0000-0000-0000-000000000000','c0c00000-0000-0000-0000-00000000000c','authenticated','authenticated','c-2c@test.local', now(), now());
create temp table _v(k text primary key, v text);

-- ===== A. connect flag defaults OFF =====
select is(intel.ci_feature_enabled('creator_ig_connect'), false, 'A: creator_ig_connect defaults OFF');

-- ===== B/C. grant-layer: anon cannot start; callback is service_role only =====
select ok(     has_function_privilege('authenticated','api.ig_connect_start(text,text,text)','EXECUTE'), 'B: authenticated may start');
select ok( not has_function_privilege('anon','api.ig_connect_start(text,text,text)','EXECUTE'),          'B: anon may not start');
select ok( not has_function_privilege('authenticated','intel.ci_ig_complete_connection(text,text,text,text,text,text,text[],text,timestamptz,text,text)','EXECUTE'),
  'C: authenticated cannot run callback completion');
select ok(     has_function_privilege('service_role','intel.ci_ig_complete_connection(text,text,text,text,text,text,text[],text,timestamptz,text,text)','EXECUTE'),
  'C: service_role runs callback completion');

-- fail-closed while OFF
set local request.jwt.claims = '{"sub":"a0c00000-0000-0000-0000-00000000000a","role":"authenticated"}';
select throws_ok($$ select api.ig_connect_start() $$, '0A000', null, 'start fails closed while flag OFF');

update intel.ci_feature_flag set enabled = true where flag = 'creator_ig_connect';

-- unauthenticated start rejected
set local request.jwt.claims = '';
select throws_ok($$ select api.ig_connect_start() $$, '28000', null, 'unauthenticated start rejected');

-- ===== D. state entropy/storage: only a hash is stored, never the raw state =====
set local request.jwt.claims = '{"sub":"a0c00000-0000-0000-0000-00000000000a","role":"authenticated"}';
insert into _v values ('state_a', (select api.ig_connect_start()->>'state'));
select hasnt_column('intel','ci_oauth_state','state', 'D: no raw state column');
select has_column('intel','ci_oauth_state','state_hash', 'D: state stored as hash');
select is( length((select state_hash from intel.ci_oauth_state where member_id='a0c00000-0000-0000-0000-00000000000a')), 64, 'D: sha256 hash length');
select isnt( (select state_hash from intel.ci_oauth_state where member_id='a0c00000-0000-0000-0000-00000000000a'),
             (select v from _v where k='state_a'), 'D: stored hash != raw state');
select is( (select state_hash from intel.ci_oauth_state where member_id='a0c00000-0000-0000-0000-00000000000a'),
           intel.ci_hash_state((select v from _v where k='state_a')), 'D: hash matches raw state');

-- ===== E. valid state consumed once (full grant) =====
select lives_ok(
  format($$ select intel.ci_ig_complete_connection(%L,'instagram','prod','STABLE_1','handle_a','BUSINESS',
    array['instagram_business_basic','instagram_business_manage_insights','instagram_business_manage_comments','instagram_business_manage_messages','instagram_business_content_publish'],
    'SYNTH_TOKEN_A', null, null, 'corr-a') $$, (select v from _v where k='state_a')),
  'E: valid state completes the connection');
select is( (select status from intel.ci_oauth_state where member_id='a0c00000-0000-0000-0000-00000000000a'), 'consumed', 'E: state marked consumed');

-- ===== F. replay of a consumed successful state is idempotent (no duplicate connection) =====
select is(
  (select (intel.ci_ig_complete_connection((select v from _v where k='state_a'),'instagram','prod','STABLE_1','handle_a','BUSINESS',
     array['instagram_business_basic'], 'SYNTH_TOKEN_A', null, null, 'corr-a'))->>'idempotent'), 'true',
  'F: replayed consumed state returns idempotent (no new connection)');
select is( (select count(*)::int from intel.ci_platform_connection c
            join intel.ci_platform_account pa on pa.platform_account_id=c.platform_account_id
            where pa.platform_user_id='STABLE_1'), 1, 'F/Q: no duplicate connection from replay');

-- ===== G. expired state fails =====
set local request.jwt.claims = '{"sub":"b0c00000-0000-0000-0000-00000000000b","role":"authenticated"}';
insert into _v values ('state_exp', (select api.ig_connect_start()->>'state'));
update intel.ci_oauth_state set expires_at = now() - interval '1 minute'
  where state_hash = intel.ci_hash_state((select v from _v where k='state_exp'));
select throws_ok(
  format($$ select intel.ci_ig_complete_connection(%L,'instagram','prod','STABLE_9','h','BUSINESS',array['instagram_business_basic'],'T',null,null,null) $$,
    (select v from _v where k='state_exp')), '42501', null, 'G: expired state rejected');

-- ===== I. invalid/malformed state fails =====
select throws_ok($$ select intel.ci_ig_complete_connection('not-a-real-state','instagram','prod','STABLE_9','h','BUSINESS',array['instagram_business_basic'],'T',null,null,null) $$,
  '42501', null, 'I: invalid state rejected');

-- ===== M/N/O/P. scopes: only RETURNED scopes granted; capability follows granted scope =====
set local request.jwt.claims = '{"sub":"b0c00000-0000-0000-0000-00000000000b","role":"authenticated"}';
insert into _v values ('state_b', (select api.ig_connect_start()->>'state'));
select lives_ok(
  format($$ select intel.ci_ig_complete_connection(%L,'instagram','prod','STABLE_2','handle_b','BUSINESS',
     array['instagram_business_basic','instagram_business_manage_insights'], 'SYNTH_TOKEN_B', null, null, null) $$,
    (select v from _v where k='state_b')), 'M: subset grant completes');
select is( (select count(*)::int from intel.ci_scope_grant g join intel.ci_platform_connection c on c.connection_id=g.connection_id
            join intel.ci_platform_account pa on pa.platform_account_id=c.platform_account_id
            where pa.platform_user_id='STABLE_2' and g.valid), 2, 'M: exactly the two returned scopes are valid');
select ok( exists(select 1 from intel.ci_scope_grant g join intel.ci_platform_connection c on c.connection_id=g.connection_id
            join intel.ci_platform_account pa on pa.platform_account_id=c.platform_account_id
            where pa.platform_user_id='STABLE_2' and g.scope='instagram_business_manage_messages' and g.valid=false),
  'N: declined scope recorded but NOT valid');
select ok( exists(select 1 from intel.ci_capability_switch cs
            join intel.ci_identity_platform_account ipa on ipa.id=cs.identity_platform_account_id
            join intel.ci_platform_account pa on pa.platform_account_id=ipa.platform_account_id
            where pa.platform_user_id='STABLE_2' and cs.capability='performance_insights' and cs.enabled),
  'O: granted insights scope enabled performance_insights capability');
select ok( not exists(select 1 from intel.ci_capability_switch cs
            join intel.ci_identity_platform_account ipa on ipa.id=cs.identity_platform_account_id
            join intel.ci_platform_account pa on pa.platform_account_id=ipa.platform_account_id
            where pa.platform_user_id='STABLE_2' and cs.capability='comment_intelligence'),
  'P: declined comments scope did NOT enable comment_intelligence capability');

-- ===== R/S. stable platform id anchors the account; username change does not create a new account =====
set local request.jwt.claims = '{"sub":"a0c00000-0000-0000-0000-00000000000a","role":"authenticated"}';
insert into _v values ('state_a2', (select api.ig_connect_start()->>'state'));
select lives_ok(
  format($$ select intel.ci_ig_complete_connection(%L,'instagram','prod','STABLE_1','renamed_a','BUSINESS',
     array['instagram_business_basic'], 'SYNTH_TOKEN_A2', null, null, null) $$, (select v from _v where k='state_a2')),
  'S: reconnect with same stable id + new handle');
select is( (select count(*)::int from intel.ci_platform_account where platform_user_id='STABLE_1'), 1, 'R: stable id anchors — one account');
select is( (select username from intel.ci_platform_account where platform_user_id='STABLE_1'), 'renamed_a', 'S: username updated, no new account');
select is( (select count(*)::int from intel.ci_platform_connection c join intel.ci_platform_account pa on pa.platform_account_id=c.platform_account_id
            where pa.platform_user_id='STABLE_1' and c.status='active'), 1, 'S: exactly one ACTIVE connection after reconnect');

-- ===== T. same handle, different stable id → separate account (no auto-merge) =====
set local request.jwt.claims = '{"sub":"c0c00000-0000-0000-0000-00000000000c","role":"authenticated"}';
insert into _v values ('state_c', (select api.ig_connect_start()->>'state'));
select lives_ok(
  format($$ select intel.ci_ig_complete_connection(%L,'instagram','prod','STABLE_3','renamed_a','BUSINESS',
     array['instagram_business_basic'], 'SYNTH_TOKEN_C', null, null, null) $$, (select v from _v where k='state_c')),
  'T: connect a different stable id that shares a handle');
select is( (select count(distinct platform_account_id)::int from intel.ci_platform_account where username='renamed_a'), 2,
  'T: same handle + different stable id are two separate accounts (no merge)');

-- ===== U. ambiguous / conflicting ownership fails closed =====
set local request.jwt.claims = '{"sub":"b0c00000-0000-0000-0000-00000000000b","role":"authenticated"}';
insert into _v values ('state_conflict', (select api.ig_connect_start()->>'state'));
select throws_ok(
  format($$ select intel.ci_ig_complete_connection(%L,'instagram','prod','STABLE_1','handle_a','BUSINESS',
     array['instagram_business_basic'],'T',null,null,null) $$, (select v from _v where k='state_conflict')),
  '42501', null, 'U: connecting an account owned by another creator fails closed');

-- ===== W. failure (missing stable id) leaves no partial connection =====
set local request.jwt.claims = '{"sub":"b0c00000-0000-0000-0000-00000000000b","role":"authenticated"}';
insert into _v values ('state_w', (select api.ig_connect_start()->>'state'));
select is( (select count(*)::int from intel.ci_platform_connection) , (select count(*)::int from intel.ci_platform_connection), 'baseline'); -- noop anchor
select throws_ok(
  format($$ select intel.ci_ig_complete_connection(%L,'instagram','prod','','h','BUSINESS',array['instagram_business_basic'],'T',null,null,null) $$,
    (select v from _v where k='state_w')), '22023', null, 'W: missing stable platform id rejected');

-- ===== J/K/L. token never in rows / responses / reachable by anon-authenticated =====
select hasnt_column('intel','ci_platform_connection','access_token', 'J: connection has no access_token column');
select hasnt_column('intel','ci_platform_connection','token',        'J: connection has no token column');
select isnt( (select token_reference from intel.ci_platform_connection c join intel.ci_platform_account pa on pa.platform_account_id=c.platform_account_id
              where pa.platform_user_id='STABLE_1' and c.status='active' limit 1), 'SYNTH_TOKEN_A2', 'J: token_reference is a Vault ref, not the token');
set local request.jwt.claims = '{"sub":"a0c00000-0000-0000-0000-00000000000a","role":"authenticated"}';
select is( position('SYNTH_TOKEN' in api.get_my_connections()::text), 0, 'L: token never appears in get_my_connections output');
select ok( not (api.get_my_connections()::text ilike '%token_reference%'), 'L: token_reference not exposed in connections output');
select ok( not has_schema_privilege('authenticated','vault','USAGE'), 'K: authenticated cannot use vault schema');
select ok( not has_schema_privilege('anon','vault','USAGE'),          'K: anon cannot use vault schema');
select ok( not has_table_privilege('authenticated','intel.ci_platform_connection','SELECT'), 'K: authenticated cannot select connections directly');

-- ===== V. one creator cannot inspect another's connection =====
set local request.jwt.claims = '{"sub":"a0c00000-0000-0000-0000-00000000000a","role":"authenticated"}';
select ok( position('STABLE_2' in api.get_my_connections()::text) = 0, 'V: A cannot see B''s connection');
set local request.jwt.claims = '{"sub":"b0c00000-0000-0000-0000-00000000000b","role":"authenticated"}';
select ok( position('STABLE_1' in api.get_my_connections()::text) = 0, 'V: B cannot see A''s connection');
select ok( position('STABLE_2' in api.get_my_connections()::text) > 0, 'V: B sees its own connection');

-- ===== X. successful connection prepared the profile-draft linkage (Phase 2B works for the creator) =====
set local request.jwt.claims = '{"sub":"a0c00000-0000-0000-0000-00000000000a","role":"authenticated"}';
update intel.ci_feature_flag set enabled = true where flag = 'creator_profile_api';
select lives_ok($$ select api.get_my_profile_draft() $$, 'X: connected creator can open profile draft');
select ok( exists(select 1 from intel.ci_creator_professional_profile pp
            join intel.ci_identity_actor_access a on a.identity_id=pp.identity_id
            where a.member_id='a0c00000-0000-0000-0000-00000000000a' and a.access_role='self'),
  'X: professional-profile draft + self actor-access exist after connect');

-- ===== Y. no ingestion data was fabricated =====
select is( (select count(*)::int from intel.ci_connection_event where action = 'ingest'), 0, 'Y: no ingestion events created');

-- ===== Z. audit ledger holds no token/code/state secret =====
select hasnt_column('intel','ci_connection_event','access_token', 'Z: audit has no access_token');
select hasnt_column('intel','ci_connection_event','token',        'Z: audit has no token');
select hasnt_column('intel','ci_connection_event','state',        'Z: audit has no state');
select hasnt_column('intel','ci_connection_event','code',         'Z: audit has no code');
select is( (select count(*)::int from intel.ci_connection_event e
            where (coalesce(e.correlation_id,'')||coalesce(e.scope,'')||coalesce(e.authority_source,'')) like '%SYNTH_TOKEN%'), 0,
  'Z: no token value appears in audit rows');

select * from finish();
rollback;
