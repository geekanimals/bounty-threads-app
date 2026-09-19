-- Phase 0B.3A — corrective migration. ADDITIVE + DARK + TRUTHFUL.
-- Fixes a SEMANTIC defect in 20260919100001: that migration seeded all five Instagram
-- scopes in intel.ci_app_scope_capability as app_review_status='approved' with a concrete
-- approved_at, asserting external Meta App Review approval that has NOT been externally
-- verified. The canonical architecture marks every scope 'documented-not-verified' (§16) and
-- lists Meta runtime/app verification as a HOLD (§28). This migration makes the stored state
-- truthful WITHOUT editing the immutable prior migration.
--
-- Scope of change: ONLY the app-level review status of the five canonical instagram/prod scopes.
--   * app_review_status -> 'documented-not-verified' (architecture §16 vocabulary; column is
--     free-text `not null default 'unknown'` — no CHECK — so this value is valid data)
--   * approved_at       -> NULL  (no verified approval date exists)
--   * last_verified_at  -> NULL  (never verified)
--   * evidence          -> a truthful note that this is documentation/config intent, NOT a
--                          verified Meta approval, with the architecture reference
--   * api_version is preserved (it is configuration intent, not an approval claim)
--
-- It does NOT touch: canonical scope definitions, the scope->capability map, connection-level
-- grants (ci_scope_grant), internal capability switches, processing consent, feature flags,
-- or any legacy public-schema object. No feature is enabled.
--
-- NOTE (future enforcement): no function currently reads intel.ci_app_scope_capability, so the
-- corrected value cannot influence any live decision today. When the four-part eligibility gate
-- (valid app-level capability AND valid connection grant AND enabled internal capability AND
-- required processing consent — architecture §14.1) is implemented, the app-level term MUST be
-- fail-closed: 'documented-not-verified' (or anything other than a verified-approved state with
-- evidence) must NOT satisfy it. Real Meta App Review approval, when externally confirmed, is to
-- be recorded by a future migration/administrative action with real approved_at + evidence.

update intel.ci_app_scope_capability
set app_review_status = 'documented-not-verified',
    approved_at       = null,
    last_verified_at  = null,
    evidence          = jsonb_build_object(
                          'meta_app_review', 'not-externally-verified',
                          'meaning', 'scope documented/requested by architecture+config; Meta production app approval NOT verified',
                          'corrected_by', '20260919100004_ci_meta_app_approval_status_correction',
                          'architecture_ref', 'CREATOR_INTELLIGENCE_ARCHITECTURE §16, §28'),
    updated_at        = now()
where provider = 'instagram'
  and app_environment = 'prod'
  and scope in ('instagram_business_basic',
                'instagram_business_manage_insights',
                'instagram_business_manage_comments',
                'instagram_business_manage_messages',
                'instagram_business_content_publish');
