-- Fix: the profile UI gate checked only the feature flag, not the pilot cohort, so once the flag was ON every
-- creator saw the Creator Profile page and got 403s from the cohort-gated RPCs behind it. The gate now mirrors
-- intel.ci_assert_api_enabled: flag AND (cohort not enforced OR caller allowlisted). Non-pilot users see the
-- legacy app unchanged. Also keeps the new IG-connect flow OFF until ig-oauth-start/callback are deployed.
create or replace function api.creator_profile_api_enabled()
returns boolean language sql stable security definer set search_path = '' as $$
  select intel.ci_feature_enabled('creator_profile_api') and intel.ci_in_pilot_cohort();
$$;
grant execute on function api.creator_profile_api_enabled() to authenticated, service_role;

update intel.ci_feature_flag set enabled = false where flag = 'creator_ig_connect';
