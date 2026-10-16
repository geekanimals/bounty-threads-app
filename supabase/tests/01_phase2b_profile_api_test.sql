-- Phase 2B — secure Creator Profile API boundary tests.
-- Ownership/logic is exercised by setting request.jwt.claims (auth.uid()); grant-layer isolation
-- is proven via catalog privilege checks. Runs in a transaction and rolls back.

begin;
select * from no_plan();

-- ---------- fixtures: two creators, each with a 'self' actor-access link ----------
insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-00000000000a','authenticated','authenticated','a-2b@test.local', now(), now()),
  ('00000000-0000-0000-0000-000000000000','bbbbbbbb-0000-0000-0000-00000000000b','authenticated','authenticated','b-2b@test.local', now(), now());
insert into intel.ci_creator_identity(identity_id, display_name) values
  ('aaaaaaaa-1111-1111-1111-11111111111a','Creator A'),
  ('bbbbbbbb-1111-1111-1111-11111111111b','Creator B');
insert into intel.ci_identity_actor_access(identity_id, member_id, access_role) values
  ('aaaaaaaa-1111-1111-1111-11111111111a','aaaaaaaa-0000-0000-0000-00000000000a','self'),
  ('bbbbbbbb-1111-1111-1111-11111111111b','bbbbbbbb-0000-0000-0000-00000000000b','self');

-- ===== A. feature flag OFF (kill switch) + M. fail-closed while OFF =====
-- The flag is ON in production since the creator profile went live (20261012*); switching it OFF must still close the API.
update intel.ci_feature_flag set enabled = false where flag = 'creator_profile_api';
select is(intel.ci_feature_enabled('creator_profile_api'), false, 'A: flag can be switched OFF');
select is(api.creator_profile_api_enabled(), false, 'A: introspection reports OFF');
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}';
select throws_ok($$ select api.get_my_profile_draft() $$, '0A000', null, 'M: read fails closed while flag OFF');
select throws_ok($$ select api.save_profile_section('personal', '{"first_name":"X"}'::jsonb) $$, '0A000', null, 'M: write fails closed while flag OFF');

-- turn the flag ON for the remaining tests
update intel.ci_feature_flag set enabled = true where flag = 'creator_profile_api';
select is(api.creator_profile_api_enabled(), true, 'flag now ON');

-- ===== B. unauthenticated caller cannot access =====
set local request.jwt.claims = '';
select throws_ok($$ select api.get_my_profile_draft() $$, '28000', null, 'B: unauthenticated read rejected');
select throws_ok($$ select api.save_profile_section('personal', '{"first_name":"X"}'::jsonb) $$, '28000', null, 'B: unauthenticated write rejected');

-- ===== C. authenticated creator can access & write ONLY their own =====
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}';
select lives_ok($$ select api.save_profile_section('personal', '{"first_name":"Asha","last_name":"K"}'::jsonb) $$, 'C: A saves own personal');
select is( api.get_my_profile_draft()->'personal'->>'first_name', 'Asha', 'C: A reads back own first_name');

-- ===== F. client-supplied identity cannot override auth.uid() ownership =====
select throws_ok($$ select api.save_profile_section('personal', '{"identity_id":"bbbbbbbb-1111-1111-1111-11111111111b"}'::jsonb) $$,
  '22023', null, 'F: identity_id in payload is rejected (unsupported field)');

-- ===== D/E. cannot read or affect another creator's profile =====
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-00000000000b","role":"authenticated"}';
select throws_ok($$ select api.get_professional_profile('aaaaaaaa-1111-1111-1111-11111111111a') $$,
  '42501', null, 'D: B cannot read A''s professional profile (not authorised)');
select lives_ok($$ select api.save_profile_section('personal', '{"first_name":"Bob"}'::jsonb) $$, 'E: B writes only its own record');
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}';
select is( api.get_my_profile_draft()->'personal'->>'first_name', 'Asha', 'E: A''s data unchanged by B''s write');

-- ===== G. professional read never serializes private (PII) data =====
select lives_ok($$ select api.save_profile_section('contact', '{"email":"secret-a@pii.test","whatsapp_e164":"+919812345678"}'::jsonb) $$, 'A saves contact');
select ok( not (api.get_professional_profile('aaaaaaaa-1111-1111-1111-11111111111a') ? 'contact'),  'G: professional output has no contact key');
select ok( not (api.get_professional_profile('aaaaaaaa-1111-1111-1111-11111111111a') ? 'personal'), 'G: professional output has no personal key');
select ok( not (api.get_professional_profile('aaaaaaaa-1111-1111-1111-11111111111a') ? 'addresses'),'G: professional output has no addresses key');
select is( position('secret-a@pii.test' in api.get_professional_profile('aaaaaaaa-1111-1111-1111-11111111111a')::text), 0,
  'G: private email never appears in professional output');

-- ===== H. invalid enum/value/domain input fails =====
select throws_ok($$ select api.save_profile_section('personal', '{"date_of_birth":"2999-01-01"}'::jsonb) $$, null, null, 'H: future DOB rejected');
select throws_ok($$ select api.save_profile_section('personal', '{"marital_status":"single","marriage_anniversary":"2020-01-01"}'::jsonb) $$, '23514', null, 'H: anniversary without married rejected');
select throws_ok($$ select api.save_profile_section('contact', '{"whatsapp_e164":"12345"}'::jsonb) $$, '23514', null, 'H: non-E.164 whatsapp rejected');
select throws_ok($$ select api.save_rate_card_item('{"deliverable_type":"Instagram Reel","amount":-5}'::jsonb) $$, '23514', null, 'H: negative rate rejected');

-- ===== I. unsupported / protected server-derived fields fail (not silently persisted) =====
select throws_ok($$ select api.save_profile_section('professional', '{"profile_image_status":"fresh"}'::jsonb) $$, '22023', null, 'I: server-derived profile_image_status rejected');
select throws_ok($$ select api.upsert_brand_experience('{"submitted_brand_name":"Nykaa","verification_status":"campaign_verified"}'::jsonb) $$, '22023', null, 'I: creator cannot self-set verification_status');

-- ===== L. idempotent child writes do not duplicate rows =====
select lives_ok($$ select api.upsert_skill('{"skill_key":"Acting","skill_level":"pro"}'::jsonb) $$, 'L: upsert skill #1');
select lives_ok($$ select api.upsert_skill('{"skill_key":"Acting","skill_level":"expert"}'::jsonb) $$, 'L: upsert skill #2 (same key)');
select is( (select count(*)::int from intel.ci_creator_skill where identity_id='aaaaaaaa-1111-1111-1111-11111111111a' and skill_key='Acting'), 1,
  'L: repeated skill upsert does not duplicate');

-- ===== J. writes produce correct metadata-only audit events =====
select ok( exists(select 1 from private.creator_profile_edit_event
    where identity_id='aaaaaaaa-1111-1111-1111-11111111111a' and field_key='personal' and operation='created'),
  'J: first personal save recorded a created event');
select ok( exists(select 1 from private.creator_profile_edit_event
    where identity_id='aaaaaaaa-1111-1111-1111-11111111111a' and field_key='first_name' and operation='changed'),
  'J: field change recorded a changed event');
select lives_ok($$ select api.save_profile_section('personal', '{"age_band":null}'::jsonb) $$, 'J: explicit clear');
select ok( exists(select 1 from private.creator_profile_edit_event
    where identity_id='aaaaaaaa-1111-1111-1111-11111111111a' and field_key='age_band' and operation='cleared'),
  'J: explicit null recorded a cleared event');

-- ===== K. audit table exposes no value/hash/PII columns =====
select hasnt_column('private','creator_profile_edit_event','old_value',      'K: no old_value');
select hasnt_column('private','creator_profile_edit_event','new_value',      'K: no new_value');
select hasnt_column('private','creator_profile_edit_event','old_value_hash', 'K: no old_value_hash');
select hasnt_column('private','creator_profile_edit_event','new_value_hash', 'K: no new_value_hash');

-- ===== N. service-role / internal access remains correct =====
select ok( has_table_privilege('service_role','intel.ci_feature_flag','UPDATE'), 'N: service_role can manage flags');
select ok( has_schema_privilege('service_role','intel','USAGE'),   'N: service_role retains USAGE on intel');

-- ===== O. anon/authenticated gain no direct intel/private privileges; api is the only surface =====
select ok( not has_schema_privilege('anon',          'intel',   'USAGE'), 'O: anon no USAGE on intel');
select ok( not has_schema_privilege('authenticated', 'intel',   'USAGE'), 'O: authenticated no USAGE on intel');
select ok( not has_schema_privilege('authenticated', 'private', 'USAGE'), 'O: authenticated no USAGE on private');
select ok( not has_table_privilege('authenticated', 'private.creator_contact', 'SELECT'), 'O: authenticated cannot select private tables');
select ok( has_schema_privilege('authenticated','api','USAGE'), 'O: authenticated has USAGE on api (the only surface)');
select ok( not has_schema_privilege('anon','api','USAGE'),      'O: anon has no USAGE on api (fail-closed)');
select ok( has_function_privilege('authenticated','api.get_my_profile_draft()','EXECUTE'), 'O: authenticated may execute api RPC');
select ok( not has_function_privilege('anon','api.get_my_profile_draft()','EXECUTE'),      'O: anon may not execute api RPC');

select * from finish();
rollback;
