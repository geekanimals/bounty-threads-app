-- Phase 0B.3A — corrective-migration tests (20260919100004).
-- Proves the app-level Meta approval state is TRUTHFUL after correction, that no live path
-- consumes it (so the value cannot satisfy any eligibility gate today), that connection/
-- capability/consent layers are untouched, and that release flags remain OFF.
-- Runs in a transaction and rolls back.

begin;
select * from no_plan();

-- ---------- A. the five canonical app-scope rows still exist ----------
select is( (select count(*)::int from intel.ci_app_scope_capability
            where provider='instagram' and app_environment='prod'
              and scope in ('instagram_business_basic','instagram_business_manage_insights',
                            'instagram_business_manage_comments','instagram_business_manage_messages',
                            'instagram_business_content_publish')),
          5, 'A: all five instagram/prod app-scope rows still exist');

-- ---------- B/C. none is externally approved by default; approved_at is NULL ----------
select is( (select count(*)::int from intel.ci_app_scope_capability
            where provider='instagram' and app_environment='prod' and app_review_status='approved'),
          0, 'B: no instagram/prod app-scope row is seeded approved');
select is( (select count(*)::int from intel.ci_app_scope_capability
            where provider='instagram' and app_environment='prod' and approved_at is not null),
          0, 'C: approved_at is NULL for all instagram/prod app-scope rows');

-- ---------- D. the truthful status is recorded on all five ----------
select is( (select count(*)::int from intel.ci_app_scope_capability
            where provider='instagram' and app_environment='prod'
              and app_review_status='documented-not-verified'),
          5, 'D: all five app-scope rows are documented-not-verified');
select is( (select count(*)::int from intel.ci_app_scope_capability
            where provider='instagram' and app_environment='prod' and last_verified_at is not null),
          0, 'D2: last_verified_at is NULL (nothing falsely verified)');
select is( (select evidence->>'meta_app_review' from intel.ci_app_scope_capability
            where provider='instagram' and app_environment='prod' and scope='instagram_business_basic'),
          'not-externally-verified', 'D3: evidence records app review NOT externally verified');

-- ---------- E. fail-closed by construction: NO function consumes app_review_status ----------
-- (Since no live code reads ci_app_scope_capability, the corrected value cannot satisfy any
--  eligibility gate. When the app-level gate is later implemented it must remain fail-closed.)
select is( (select count(*)::int from pg_proc p
            join pg_namespace n on n.oid=p.pronamespace
            where n.nspname in ('intel','api','public')
              and (p.prosrc ilike '%ci_app_scope_capability%' or p.prosrc ilike '%app_review_status%')),
          0, 'E: no intel/api/public function reads ci_app_scope_capability / app_review_status');

-- ---------- F. connection-grant, capability, and consent layers are untouched (no runtime data) ----------
select is( (select count(*)::int from intel.ci_scope_grant),        0, 'F: no ci_scope_grant rows created by the correction');
select is( (select count(*)::int from intel.ci_capability_switch),  0, 'F2: no ci_capability_switch rows created by the correction');
select is( (select count(*)::int from intel.ci_processing_consent), 0, 'F3: no ci_processing_consent rows created by the correction');

-- ---------- G. scope model and provider config intent are preserved ----------
select is( (select count(*)::int from intel.ci_scope_capability_map where provider='instagram'),
          4, 'G: scope->capability map still has 4 instagram mappings');
select is( (select array_length(scopes,1) from intel.ci_provider_config
            where provider='instagram' and app_environment='prod'),
          5, 'G2: provider config still requests all five scopes');
select is( (select client_id from intel.ci_provider_config where provider='instagram' and app_environment='prod'),
          '__SET_VIA_CONFIG__', 'G3: provider client_id remains a placeholder (no live secret)');

-- ---------- H. release flags remain OFF ----------
select is( intel.ci_feature_enabled('creator_ig_connect'), false, 'H: creator_ig_connect remains OFF');
select is( intel.ci_feature_enabled('creator_profile_api'), false, 'H2: creator_profile_api remains OFF');

select * from finish();
rollback;
