-- Phase 1B-fix — v26 config, worker claim/lease, retry/dead-letter, hardened disconnect (Vault
-- secret destruction), and retention purge. Fixture-driven; runs in a transaction and rolls back.

begin;
select * from no_plan();

-- ===== v26 provider config =====
select is( (select api_version from intel.ci_provider_config where provider='instagram' and app_environment='prod'), 'v26.0', 'provider config pinned to v26.0');
select is( (select count(distinct api_version)::int from intel.ci_app_scope_capability where provider='instagram'), 1, 'all app scopes share one api_version');
select is( (select distinct api_version from intel.ci_app_scope_capability where provider='instagram'), 'v26.0', 'app scopes on v26.0');

-- ===== worker/lease functions exist and are service-role locked =====
select has_function('intel','ci_claim_stages','claim function exists');
select ok( not has_function_privilege('authenticated','intel.ci_claim_stages(text,int,int)','EXECUTE'), 'authenticated cannot claim stages');
select ok( not has_function_privilege('public','intel.ci_vault_destroy(text)','EXECUTE'), 'PUBLIC cannot destroy vault secrets');

-- ===== fixtures: a connected creator with an enqueued run =====
update intel.ci_feature_flag set enabled=true where flag in ('creator_ig_connect','creator_profile_api');
insert into auth.users (instance_id,id,aud,role,email,created_at,updated_at) values
  ('00000000-0000-0000-0000-000000000000','e1000000-0000-0000-0000-0000000000e1','authenticated','authenticated','e1@test.local',now(),now());
set local request.jwt.claims = '{"sub":"e1000000-0000-0000-0000-0000000000e1","role":"authenticated"}';
select api.bootstrap_my_profile();
create temp table _v(k text primary key, v text);
insert into _v values ('state', (select api.ig_connect_start()->>'state'));
set local request.jwt.claims = '';
select intel.ci_ig_complete_connection((select v from _v where k='state'),'instagram','prod','IGE1','creator.e','BUSINESS',
  array['instagram_business_basic','instagram_business_manage_insights','instagram_business_manage_comments','instagram_business_manage_messages','instagram_business_content_publish'],
  'SYNTH_TOKEN_E1', now()+interval '60 days','notice-2026-09-18','c');
insert into _v values ('conn', (select connection_id::text from intel.ci_platform_connection where status='active' limit 1));
insert into _v values ('vref', (select token_reference from intel.ci_platform_connection where status='active' limit 1));
select intel.ci_enqueue_initial_ingest((select v::uuid from _v where k='conn'),'c');

-- token was stored in Vault (the ref resolves to a live secret)
select is( (select count(*)::int from vault.secrets where id = (select v::uuid from _v where k='vref')), 1, 'token secret exists in Vault before disconnect');

-- ===== atomic claim: two workers cannot claim the same stage; per-account concurrency holds =====
select is( (select count(*)::int from intel.ci_claim_stages('workerA', 1, 120)), 1, 'worker A claims exactly one stage');
select is( (select count(*)::int from intel.ci_claim_stages('workerB', 5, 120)), 0, 'worker B claims none (same-stage excluded + per-account concurrency)');
select is( (select count(*)::int from intel.ci_ingest_stage where lease_owner='workerA' and status='running'), 1, 'A holds a live lease on one running stage');

-- ===== retry scheduling: releasing failed_retryable sets next_attempt_at and frees the lease =====
select intel.ci_release_stage((select stage_id from intel.ci_ingest_stage where lease_owner='workerA' limit 1),'workerA','failed_retryable',null,null,null,'transient');
select is( (select count(*)::int from intel.ci_ingest_stage where status='failed_retryable' and next_attempt_at is not null and lease_owner is null), 1, 'retryable stage rescheduled with next_attempt_at, lease freed');

-- ===== expired-lease recovery =====
update intel.ci_ingest_stage set status='running', lease_owner='ghost', lease_expires_at=now()-interval '5 min'
  where stage='account';
select ok( intel.ci_recover_abandoned_leases() >= 1, 'abandoned (expired) leases recovered');
select is( (select status from intel.ci_ingest_stage where stage='account'), 'failed_retryable', 'recovered stage is retryable again');

-- ===== dead-letter on retry exhaustion =====
update intel.ci_ingest_stage set status='running', lease_owner='workerC', lease_expires_at=now()+interval '2 min',
  attempt=6, max_attempts=6 where stage='media';
select intel.ci_release_stage((select stage_id from intel.ci_ingest_stage where stage='media'),'workerC','failed_retryable',null,null,null,'still_failing');
select is( (select dead_letter from intel.ci_ingest_stage where stage='media'), true, 'retry-exhausted stage moves to dead-letter');
select is( (select status from intel.ci_ingest_stage where stage='media'), 'failed_terminal', 'dead-lettered stage is terminal');

-- ===== hardened disconnect: destroy the Vault secret (verified), clear ref, preserve profile =====
set local request.jwt.claims = '{"sub":"e1000000-0000-0000-0000-0000000000e1","role":"authenticated"}';
select is( (api.disconnect_platform((select v::uuid from _v where k='conn')))->>'secret_destroyed', 'true', 'disconnect reports secret destroyed');
select is( (select count(*)::int from vault.secrets where id = (select v::uuid from _v where k='vref')), 0, 'Vault secret is GONE (no orphaned readable token)');
select is( (select token_reference from intel.ci_platform_connection where connection_id=(select v::uuid from _v where k='conn')), null, 'token_reference cleared');
select is( (select status from intel.ci_platform_connection where connection_id=(select v::uuid from _v where k='conn')), 'disconnected', 'connection disconnected');
select ok( exists(select 1 from intel.ci_creator_professional_profile where identity_id=(select identity_id from intel.ci_identity_platform_account where valid_to is null limit 1)), 'manual profile preserved after disconnect');
select ok( (select count(*)::int from intel.ci_connection_event where connection_id=(select v::uuid from _v where k='conn') and action='provider_revoke' and result_status='provider_revoke_unavailable') = 1, 'provider revocation recorded as unavailable (no token material)');
set local request.jwt.claims = '';

-- ===== retention purge: expired raw removed, unexpired kept; profile never touched =====
insert into intel.ci_comments(id, platform_account_id, comment_ref, idempotency_key)
  select 'cccccccc-0000-0000-0000-0000000000aa', pa.platform_account_id, 'ref','ck1'
  from intel.ci_platform_account pa limit 1 on conflict do nothing;
insert into private.ci_comment_raw(id, comment_id, body, retain_until) values
  ('dddddddd-0000-0000-0000-0000000000a1','cccccccc-0000-0000-0000-0000000000aa','old body', now()-interval '1 day'),
  ('dddddddd-0000-0000-0000-0000000000a2','cccccccc-0000-0000-0000-0000000000aa','fresh body', now()+interval '30 days');
select is( (intel.ci_purge_expired(1000))->>'purged_raw_comments', '1', 'purge removes exactly the expired raw comment');
select is( (select count(*)::int from private.ci_comment_raw where retain_until < now()), 0, 'no expired raw comments remain');
select is( (select count(*)::int from private.ci_comment_raw where retain_until > now()), 1, 'unexpired raw comment retained');

select * from finish();
rollback;
