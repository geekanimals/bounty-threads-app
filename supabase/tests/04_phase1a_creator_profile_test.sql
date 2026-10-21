-- Phase 1A — Creator Profile build tests. Ownership, idempotency, isolation, validation,
-- provenance/no-PII, brand/rate/dream constraints, visibility, privileged-helper lockdown.
-- Runs in a transaction and rolls back. The feature flag is enabled LOCALLY inside the txn only.

begin;
select * from no_plan();

-- fixtures: two creators
insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000','aa000000-0000-0000-0000-0000000000a1','authenticated','authenticated','p1@test.local', now(), now()),
  ('00000000-0000-0000-0000-000000000000','bb000000-0000-0000-0000-0000000000b1','authenticated','authenticated','p2@test.local', now(), now());
update intel.ci_feature_flag set enabled = true where flag = 'creator_profile_api';

-- ===== grant-layer: browser surface is authenticated-only; privileged helpers are locked =====
select ok(     has_function_privilege('authenticated','api.bootstrap_my_profile(text)','EXECUTE'), 'authenticated may bootstrap');
select ok( not has_function_privilege('anon','api.bootstrap_my_profile(text)','EXECUTE'),          'anon may not bootstrap');
select ok( not has_function_privilege('public','intel.ci_bootstrap_identity()','EXECUTE'),         'PUBLIC cannot exec ci_bootstrap_identity');
select ok( not has_function_privilege('anon','intel.ci_bootstrap_identity()','EXECUTE'),           'anon cannot exec ci_bootstrap_identity');
select ok( not has_function_privilege('authenticated','intel.ci_set_provenance(uuid,text,text,text,text)','EXECUTE'), 'authenticated cannot exec ci_set_provenance');
select ok( not has_function_privilege('anon','api.get_my_profile()','EXECUTE'),                    'anon may not read profile');

-- ===== flag fail-closed =====
set local request.jwt.claims = '{"sub":"aa000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
update intel.ci_feature_flag set enabled = false where flag = 'creator_profile_api';
select throws_ok($$ select api.bootstrap_my_profile() $$, '0A000', null, 'bootstrap fails closed when flag OFF');
update intel.ci_feature_flag set enabled = true where flag = 'creator_profile_api';

-- ===== anonymous denial =====
set local request.jwt.claims = '';
select throws_ok($$ select api.get_my_profile() $$, '28000', null, 'unauthenticated read rejected');
select throws_ok($$ select api.bootstrap_my_profile() $$, '28000', null, 'unauthenticated bootstrap rejected');

-- ===== bootstrap idempotency + ownership (creator A) =====
set local request.jwt.claims = '{"sub":"aa000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is( (api.bootstrap_my_profile())->>'created', 'true',  'first bootstrap creates the identity');
select is( (api.bootstrap_my_profile())->>'created', 'false', 'second bootstrap is idempotent');
select is( (select count(*)::int from intel.ci_identity_actor_access
            where member_id='aa000000-0000-0000-0000-0000000000a1' and access_role='self' and revoked_at is null),
          1, 'exactly one self identity for the member (no handle/name/email matching)');
-- creator without Instagram still bootstraps (no legacy social_accounts in the foundation DB)
select is( jsonb_typeof(api.get_my_profile()->'connection'), 'null', 'creator without Instagram: connection is null (not fabricated)');

-- capture A's identity
create temp table _p(k text primary key, v uuid);
insert into _p values ('a', intel.ci_caller_identity());

-- ===== manual value not overwritten by (re-)bootstrap prefill =====
select api.save_profile_section('professional', '{"display_name":"Manual Name"}');
select api.bootstrap_my_profile();  -- prefill must not clobber a set display_name
select is( (api.get_my_profile()->'professional'->>'display_name'), 'Manual Name', 'prefill never overwrites a creator-set value');

-- ===== personal validation: future DOB rejected; anniversary requires married =====
select throws_ok($$ select api.save_profile_section('personal','{"date_of_birth":"2999-01-01"}') $$, null, null, 'future DOB rejected');
select throws_ok($$ select api.save_profile_section('personal','{"marital_status":"single","marriage_anniversary":"2020-01-01"}') $$, null, null, 'anniversary without married rejected');
select lives_ok($$ select api.save_profile_section('personal','{"marital_status":"married","marriage_anniversary":"2020-01-01"}') $$, 'married + anniversary allowed');
-- age is not stored anywhere
select hasnt_column('private','creator_personal_profile','age', 'age is derived, never stored');

-- ===== contact validation: bad email / bad phone rejected =====
select throws_ok($$ select api.save_profile_section('contact','{"email":"not-an-email"}') $$, null, null, 'invalid email rejected');
select throws_ok($$ select api.save_profile_section('contact','{"whatsapp_e164":"12345"}') $$, null, null, 'non-E.164 phone rejected');
select lives_ok($$ select api.save_profile_section('contact','{"whatsapp_e164":"+919812345678","email":"a@b.com"}') $$, 'valid E.164 + email accepted');

-- ===== address: one active default =====
-- (a saved address needs everything the courier uses: name, mobile, PIN, flat, area, landmark, city, state)
select api.upsert_address('{"recipient_name":"Asha Rao","recipient_phone":"9812345678","postal_code":"411001","line1":"1 A Rd","line2":"Camp","landmark":"Near MG Road","city":"Pune","state":"Maharashtra","is_default":true}');
select api.upsert_address('{"recipient_name":"Asha Rao","recipient_phone":"+919812345678","postal_code":"411001","line1":"2 B Rd","line2":"Camp","landmark":"Near MG Road","city":"Pune","state":"maharashtra","is_default":true}');  -- must flip the previous default off
select is( (select count(*)::int from private.creator_address a where a.identity_id=(select v from _p where k='a') and a.is_default and a.deleted_at is null),
          1, 'only one active default address');

-- ===== brand experience: brand-or-raw-name required; manual is self-reported =====
select throws_ok($$ insert into intel.ci_creator_brand_experience(identity_id) values ((select v from _p where k='a')) $$, '23514', null, 'brand-or-raw-name constraint enforced');
select api.upsert_brand_experience('{"submitted_brand_name":"Nykaa","relationship_type":"paid"}');
select is( (select verification_status from intel.ci_creator_brand_experience where identity_id=(select v from _p where k='a') and submitted_brand_name='Nykaa'),
          'creator_confirmed', 'manual brand experience is self-reported (creator_confirmed, not campaign_verified)');
select is( (select source_type from intel.ci_creator_brand_experience where identity_id=(select v from _p where k='a') and submitted_brand_name='Nykaa'),
          'creator_declared', 'manual brand experience source is creator_declared');

-- ===== rate card: uniqueness per deliverable + negative amount rejected =====
select api.save_rate_card_item('{"deliverable_type":"IG Reel","amount":10000}');
select api.save_rate_card_item('{"deliverable_type":"IG Reel","amount":12000}');  -- upsert, not duplicate
select is( (select count(*)::int from intel.ci_creator_rate_card_item ri join intel.ci_creator_rate_card rc on rc.rate_card_id=ri.rate_card_id
            where rc.identity_id=(select v from _p where k='a') and ri.deliverable_type='IG Reel'),
          1, 'rate-card item unique per deliverable_type');
select throws_ok($$ select api.save_rate_card_item('{"deliverable_type":"IG Story","amount":-5}') $$, '23514', null, 'negative rate rejected');

-- ===== dream brands: rank uniqueness among active =====
select api.upsert_dream_brand('{"submitted_brand_name":"Apple","priority_rank":1}');
select throws_ok($$ select api.upsert_dream_brand('{"submitted_brand_name":"Sony","priority_rank":1}') $$, '23505', null, 'duplicate active dream-brand rank rejected');

-- ===== completion contains flags only (no PII) =====
select api.save_profile_section('personal','{"first_name":"Aisha","last_name":"K"}');
select api.save_profile_section('professional','{"categories":["Fashion"]}');
select api.save_profile_section('commercial_preference','{"accepts_barter":true}');
select api.upsert_skill('{"skill_key":"Makeup"}');
select ok( (api.get_profile_completion()->>'completion_pct')::int = 100, 'all six core groups complete → 100%');
select ok( (select section_flags::text not ilike '%aisha%' and section_flags::text not ilike '%nykaa%' and section_flags::text not ilike '%@%'
            from intel.ci_profile_completion where identity_id=(select v from _p where k='a')), 'completion section_flags contain no PII');

-- ===== edit-event log has no value/PII columns =====
select hasnt_column('private','creator_profile_edit_event','old_value', 'edit log has no old_value');
select hasnt_column('private','creator_profile_edit_event','new_value', 'edit log has no new_value');
select is( (select count(*)::int from information_schema.columns where table_schema='private' and table_name='creator_profile_edit_event' and column_name like '%value%'),
          0, 'edit log has no *value* columns at all');

-- ===== visibility set + enforced =====
select api.set_profile_visibility('rate_card','marketplace_summary', true);
select is( (select allowed from intel.ci_profile_visibility where identity_id=(select v from _p where k='a') and field_or_group='rate_card' and tier='marketplace_summary'),
          true, 'visibility toggle persisted');

-- ===== cross-creator isolation: B cannot read/write A's data =====
set local request.jwt.claims = '{"sub":"bb000000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select api.bootstrap_my_profile();
select throws_ok(format($$ select api.get_professional_profile(%L) $$, (select v from _p where k='a')), '42501', null, 'B cannot read A''s professional profile');
select is( (api.get_my_profile()->>'identity_id'), (intel.ci_caller_identity())::text, 'B reads only their own identity');
select isnt( (api.get_my_profile()->>'identity_id'), ((select v from _p where k='a'))::text, 'B''s profile is not A''s');

select * from finish();
rollback;
