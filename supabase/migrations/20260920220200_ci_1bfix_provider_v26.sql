-- Phase 1B-fix (1/3): move the dark Instagram integration to Graph API v26.0. ADDITIVE.
-- Prior migrations are NOT edited; this migration UPDATES the seeded provider config + app-scope
-- api_version to v26.0 (v21.0 becomes unavailable 2027-01-21). Rows are the dark provider config
-- (no live effect: creator_ig_connect is OFF and api is unexposed).
update intel.ci_provider_config
   set api_version = 'v26.0', updated_at = now()
 where provider = 'instagram' and app_environment = 'prod' and api_version <> 'v26.0';

update intel.ci_app_scope_capability
   set api_version = 'v26.0', updated_at = now()
 where provider = 'instagram' and app_environment = 'prod' and coalesce(api_version,'') <> 'v26.0';
-- NOTE: app_review_status remains 'documented-not-verified' (Meta approval is still unverified).
