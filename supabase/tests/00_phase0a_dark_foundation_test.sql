-- pgTAP tests for Phase 0A dark foundation.
-- Run with: supabase test db   (requires the local Supabase stack / Docker).
-- Each run executes in a transaction and rolls back.

begin;
select * from no_plan();

-- ---------- schemas ----------
select has_schema('intel',   'intel schema exists');
select has_schema('private', 'private schema exists');
select has_schema('api',     'api schema exists');

-- ---------- identity foundation tables ----------
select has_table('intel','ci_creator_identity',        'ci_creator_identity exists');
select has_table('intel','ci_platform_account',        'ci_platform_account exists');
select has_table('intel','ci_identity_platform_account','ci_identity_platform_account exists');
select has_table('intel','ci_platform_connection',     'ci_platform_connection exists');
select has_table('intel','ci_identity_actor_access',   'ci_identity_actor_access exists');
select has_table('intel','ci_org_creator_relationship','ci_org_creator_relationship exists');
select has_table('intel','ci_identity_merge_event',    'ci_identity_merge_event exists');
select has_table('intel','ci_identity_link',           'ci_identity_link exists');

-- ---------- private profile tables ----------
select has_table('private','creator_personal_profile',        'creator_personal_profile exists');
select has_table('private','creator_contact',                 'creator_contact exists');
select has_table('private','creator_address',                 'creator_address exists');
select has_table('private','creator_profile_field_provenance','private provenance exists');
select has_table('private','creator_profile_edit_event',      'private edit event exists');

-- ---------- professional profile tables ----------
select has_table('intel','ci_creator_professional_profile','professional profile exists');
select has_table('intel','ci_creator_skill',               'skill exists');
select has_table('intel','ci_creator_resource',            'resource exists');
select has_table('intel','ci_brand',                       'brand exists');
select has_table('intel','ci_creator_brand_experience',    'brand experience exists');
select has_table('intel','ci_creator_commercial_preference','commercial preference exists');
select has_table('intel','ci_creator_rate_card',           'rate card exists');
select has_table('intel','ci_creator_rate_card_item',      'rate card item exists');
select has_table('intel','ci_creator_brand_aspiration',    'brand aspiration exists');
select has_table('intel','ci_profile_field_provenance',    'intel provenance exists');
select has_table('intel','ci_profile_completion',          'profile completion exists');

-- ---------- control tables ----------
select has_table('intel','ci_app_scope_capability','app scope capability exists');
select has_table('intel','ci_scope_grant',         'scope grant exists');
select has_table('intel','ci_capability_switch',   'capability switch exists');
select has_table('intel','ci_processing_consent',  'processing consent exists');
select has_table('intel','ci_profile_visibility',  'profile visibility exists');

-- ---------- identity has NO platform id / member id ----------
select hasnt_column('intel','ci_creator_identity','member_id',        'identity has no member_id');
select hasnt_column('intel','ci_creator_identity','platform_user_id', 'identity has no platform_user_id');
select hasnt_column('intel','ci_creator_identity','ig_user_id',       'identity has no ig_user_id');

-- ---------- age is not stored (calculated from DOB) ----------
select hasnt_column('private','creator_personal_profile','age', 'age is not stored');

-- ---------- platform account uniqueness ----------
select col_is_unique('intel','ci_platform_account', ARRAY['platform','platform_user_id'],
  'platform account unique on (platform, platform_user_id)');

-- ---------- profile completion stores NO PII ----------
select hasnt_column('intel','ci_profile_completion','first_name',    'completion has no first_name');
select hasnt_column('intel','ci_profile_completion','date_of_birth', 'completion has no DOB');
select hasnt_column('intel','ci_profile_completion','email',         'completion has no email');
select hasnt_column('intel','ci_profile_completion','whatsapp_e164', 'completion has no whatsapp');
select hasnt_column('intel','ci_profile_completion','line1',         'completion has no address');

-- ---------- RLS enabled (defence in depth) ----------
select ok((select relrowsecurity from pg_class where oid = 'intel.ci_creator_identity'::regclass),
  'RLS enabled on ci_creator_identity');
select ok((select relrowsecurity from pg_class where oid = 'private.creator_contact'::regclass),
  'RLS enabled on creator_contact');

-- ---------- anon/authenticated cannot read intel/private ----------
select ok(not has_table_privilege('anon',          'intel.ci_creator_identity', 'SELECT'), 'anon cannot select intel');
select ok(not has_table_privilege('authenticated', 'intel.ci_creator_identity', 'SELECT'), 'authenticated cannot select intel');
select ok(not has_table_privilege('anon',          'private.creator_contact',   'SELECT'), 'anon cannot select private');
select ok(not has_table_privilege('authenticated', 'private.creator_contact',   'SELECT'), 'authenticated cannot select private');

-- ================= behavioural tests (setup uses fixed uuids) =================
insert into intel.ci_creator_identity(identity_id, display_name, kind, is_claimed)
values ('11111111-1111-1111-1111-111111111111','Agent-Managed Celebrity','celebrity', false);

-- draft with incomplete optional data (only a first name) is allowed
select lives_ok($$ insert into private.creator_personal_profile(identity_id, first_name)
  values ('11111111-1111-1111-1111-111111111111','Priya') $$,
  'draft profile with incomplete optional data is allowed');

-- one identity, multiple platform accounts
insert into intel.ci_platform_account(platform_account_id, platform, platform_user_id)
values ('22222222-2222-2222-2222-222222222222','instagram','IG_A'),
       ('33333333-3333-3333-3333-333333333333','instagram','IG_B');
select lives_ok($$ insert into intel.ci_identity_platform_account(identity_id, platform_account_id)
  values ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222'),
         ('11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333') $$,
  'one identity can hold multiple platform accounts');

-- stable platform-id uniqueness
select throws_ok($$ insert into intel.ci_platform_account(platform, platform_user_id)
  values ('instagram','IG_A') $$, '23505', null, 'duplicate (platform, platform_user_id) rejected');

-- only one active connection per (account, app env)
insert into intel.ci_platform_connection(platform_account_id, provider_app_environment, status)
values ('22222222-2222-2222-2222-222222222222','instagram:prod','active');
select throws_ok($$ insert into intel.ci_platform_connection(platform_account_id, provider_app_environment, status)
  values ('22222222-2222-2222-2222-222222222222','instagram:prod','active') $$,
  '23505', null, 'second active connection per account/app-env rejected');
select lives_ok($$ insert into intel.ci_platform_connection(platform_account_id, provider_app_environment, status)
  values ('22222222-2222-2222-2222-222222222222','instagram:prod','superseded') $$,
  'a superseded connection alongside an active one is allowed');

-- future DOB rejected (fresh identity, since 11111111... already has a personal_profile row)
insert into intel.ci_creator_identity(identity_id, display_name) values ('aaaa0000-0000-0000-0000-000000000001','DOB test');
select throws_ok($$ insert into private.creator_personal_profile(identity_id, date_of_birth)
  values ('aaaa0000-0000-0000-0000-000000000001', current_date + 1) $$,
  null, null, 'future DOB rejected');

-- anniversary only when married
insert into intel.ci_creator_identity(identity_id, display_name) values ('aaaa0000-0000-0000-0000-000000000002','anniv test');
select throws_ok($$ insert into private.creator_personal_profile(identity_id, marital_status, marriage_anniversary)
  values ('aaaa0000-0000-0000-0000-000000000002','single','2020-01-01') $$,
  '23514', null, 'anniversary without married rejected');
select lives_ok($$ insert into private.creator_personal_profile(identity_id, marital_status, marriage_anniversary)
  values ('aaaa0000-0000-0000-0000-000000000002','married','2020-01-01') $$,
  'anniversary allowed when married');

-- one default active address per identity
insert into private.creator_address(identity_id, city, is_default) values ('11111111-1111-1111-1111-111111111111','Delhi', true);
select throws_ok($$ insert into private.creator_address(identity_id, city, is_default)
  values ('11111111-1111-1111-1111-111111111111','Mumbai', true) $$,
  '23505', null, 'second default active address rejected');
select lives_ok($$ insert into private.creator_address(identity_id, city, is_default)
  values ('11111111-1111-1111-1111-111111111111','Mumbai', false) $$,
  'non-default additional address allowed');

-- E.164 whatsapp validation
insert into intel.ci_creator_identity(identity_id, display_name) values ('aaaa0000-0000-0000-0000-000000000003','wa test');
select throws_ok($$ insert into private.creator_contact(identity_id, whatsapp_e164)
  values ('aaaa0000-0000-0000-0000-000000000003','98765') $$,
  '23514', null, 'non-E.164 whatsapp rejected');
select lives_ok($$ insert into private.creator_contact(identity_id, whatsapp_e164)
  values ('aaaa0000-0000-0000-0000-000000000003','+919876543210') $$,
  'E.164 whatsapp accepted');

-- rate card: duplicate deliverable + negative amount
insert into intel.ci_creator_rate_card(rate_card_id, identity_id)
values ('44444444-4444-4444-4444-444444444444','11111111-1111-1111-1111-111111111111');
insert into intel.ci_creator_rate_card_item(rate_card_id, deliverable_type, amount)
values ('44444444-4444-4444-4444-444444444444','Instagram Reel', 50000);
select throws_ok($$ insert into intel.ci_creator_rate_card_item(rate_card_id, deliverable_type, amount)
  values ('44444444-4444-4444-4444-444444444444','Instagram Reel', 60000) $$,
  '23505', null, 'duplicate deliverable within a rate card rejected');
select throws_ok($$ insert into intel.ci_creator_rate_card_item(rate_card_id, deliverable_type, amount)
  values ('44444444-4444-4444-4444-444444444444','Instagram Story — single', -1) $$,
  '23514', null, 'negative rate amount rejected');

-- dream-brand: duplicate active priority rank
insert into intel.ci_creator_brand_aspiration(identity_id, submitted_brand_name, priority_rank, active)
values ('11111111-1111-1111-1111-111111111111','Nykaa', 1, true);
select throws_ok($$ insert into intel.ci_creator_brand_aspiration(identity_id, submitted_brand_name, priority_rank, active)
  values ('11111111-1111-1111-1111-111111111111','boAt', 1, true) $$,
  '23505', null, 'duplicate active dream-brand rank rejected');

-- merge/unmerge append-only
insert into intel.ci_identity_merge_event(event_id, event_type, source_identity_id, target_identity_id)
values ('55555555-5555-5555-5555-555555555555','merge',
        'aaaa0000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111');
select throws_ok($$ update intel.ci_identity_merge_event set reason = 'x'
  where event_id = '55555555-5555-5555-5555-555555555555' $$,
  null, null, 'merge event cannot be updated');
select throws_ok($$ delete from intel.ci_identity_merge_event
  where event_id = '55555555-5555-5555-5555-555555555555' $$,
  null, null, 'merge event cannot be deleted');

-- ================= Prompt 2A-V hardening tests =================

-- NOTE: the six CI migrations are self-contained and do NOT depend on the legacy `public`
-- schema (DATABASE_SETUP.sql is not clean-apply-safe — see docs/PHASE_0A_VERIFICATION.md §1),
-- so no legacy-baseline presence is asserted here.

-- control-event history tables exist
select has_table('intel','ci_capability_switch_event',  'capability-switch event table exists');
select has_table('intel','ci_processing_consent_event', 'processing-consent event table exists');
select has_table('intel','ci_profile_visibility_event', 'profile-visibility event table exists');

-- event tables store no PII
select hasnt_column('intel','ci_capability_switch_event','whatsapp_e164', 'cap event has no phone');
select hasnt_column('intel','ci_processing_consent_event','email',        'consent event has no email');
select hasnt_column('intel','ci_processing_consent_event','date_of_birth','consent event has no DOB');
select hasnt_column('intel','ci_profile_visibility_event','line1',        'visibility event has no address');

-- control-event ledgers are append-only
insert into intel.ci_capability_switch_event(event_id, identity_id, capability, new_state)
  values ('66660000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','performance_insights', true);
select throws_ok($$ update intel.ci_capability_switch_event set new_state = false
  where event_id = '66660000-0000-0000-0000-000000000001' $$, null, null, 'capability event cannot be updated');
select throws_ok($$ delete from intel.ci_capability_switch_event
  where event_id = '66660000-0000-0000-0000-000000000001' $$, null, null, 'capability event cannot be deleted');

insert into intel.ci_processing_consent_event(event_id, identity_id, event_type, new_state, notice_version)
  values ('66660000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','accepted','accepted','v1');
select throws_ok($$ update intel.ci_processing_consent_event set new_state = 'withdrawn'
  where event_id = '66660000-0000-0000-0000-000000000002' $$, null, null, 'consent event cannot be updated');
select throws_ok($$ delete from intel.ci_processing_consent_event
  where event_id = '66660000-0000-0000-0000-000000000002' $$, null, null, 'consent event cannot be deleted');

insert into intel.ci_profile_visibility_event(event_id, identity_id, field_or_group, tier, new_allowed)
  values ('66660000-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','rate_card','marketplace_summary', true);
select throws_ok($$ update intel.ci_profile_visibility_event set new_allowed = false
  where event_id = '66660000-0000-0000-0000-000000000003' $$, null, null, 'visibility event cannot be updated');
select throws_ok($$ delete from intel.ci_profile_visibility_event
  where event_id = '66660000-0000-0000-0000-000000000003' $$, null, null, 'visibility event cannot be deleted');

-- PUBLIC / anon / authenticated cannot execute internal helper functions
select ok(not has_function_privilege('anon',          'intel.tg_block_mutation()', 'EXECUTE'), 'anon cannot execute tg_block_mutation');
select ok(not has_function_privilege('authenticated', 'intel.tg_block_mutation()', 'EXECUTE'), 'authenticated cannot execute tg_block_mutation');
select ok(not has_function_privilege('anon',          'intel.tg_set_updated_at()', 'EXECUTE'), 'anon cannot execute tg_set_updated_at');

-- anon / authenticated lack USAGE on intel and private schemas
select ok(not has_schema_privilege('anon',          'intel',   'USAGE'), 'anon lacks USAGE on intel');
select ok(not has_schema_privilege('authenticated', 'intel',   'USAGE'), 'authenticated lacks USAGE on intel');
select ok(not has_schema_privilege('anon',          'private', 'USAGE'), 'anon lacks USAGE on private');
select ok(not has_schema_privilege('authenticated', 'private', 'USAGE'), 'authenticated lacks USAGE on private');

-- intentional indexes on FK/join columns
select has_index('intel','ci_platform_connection','ci_conn_supersedes_idx', 'index on connection.supersedes_connection_id');
select has_index('intel','ci_creator_brand_experience','brand_exp_brand_idx', 'index on brand_experience.brand_id');
select has_index('intel','ci_creator_brand_aspiration','aspiration_brand_idx', 'index on aspiration.brand_id');
select has_index('intel','ci_capability_switch_event','ci_cap_event_identity_idx', 'index on capability event.identity_id');

-- RLS on the new event tables
select ok((select relrowsecurity from pg_class where oid = 'intel.ci_capability_switch_event'::regclass),
  'RLS enabled on ci_capability_switch_event');

-- private edit-event holds NO PII and NO value hashes (Prompt 2A-I §2)
select hasnt_column('private','creator_profile_edit_event','old_value',      'edit-event has no old_value');
select hasnt_column('private','creator_profile_edit_event','new_value',      'edit-event has no new_value');
select hasnt_column('private','creator_profile_edit_event','old_value_hash', 'edit-event has no old_value_hash');
select hasnt_column('private','creator_profile_edit_event','new_value_hash', 'edit-event has no new_value_hash');
select hasnt_column('private','creator_profile_edit_event','whatsapp_e164',  'edit-event has no phone');
select hasnt_column('private','creator_profile_edit_event','email',          'edit-event has no email');
select hasnt_column('private','creator_profile_edit_event','date_of_birth',  'edit-event has no DOB');
select hasnt_column('private','creator_profile_edit_event','postal_code',    'edit-event has no postal code');
select has_column('private','creator_profile_edit_event','operation',        'edit-event has operation');
select has_column('private','creator_profile_edit_event','record_table',     'edit-event has record_table');
select has_column('private','creator_profile_edit_event','correlation_id',   'edit-event has correlation_id');
-- operation is constrained
insert into intel.ci_creator_identity(identity_id, display_name) values ('bbbb0000-0000-0000-0000-000000000001','edit ev');
select lives_ok($$ insert into private.creator_profile_edit_event(identity_id, record_table, field_key, operation)
  values ('bbbb0000-0000-0000-0000-000000000001','creator_contact','whatsapp_e164','changed') $$,
  'valid edit event (metadata only) accepted');
select throws_ok($$ insert into private.creator_profile_edit_event(identity_id, record_table, field_key, operation)
  values ('bbbb0000-0000-0000-0000-000000000001','creator_contact','email','leaked') $$,
  '23514', null, 'invalid operation rejected');
select throws_ok($$ update private.creator_profile_edit_event set reason = 'x'
  where identity_id = 'bbbb0000-0000-0000-0000-000000000001' $$, null, null, 'edit event cannot be updated');

select * from finish();
rollback;
