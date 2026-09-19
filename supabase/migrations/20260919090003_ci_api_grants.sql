-- Phase 2B (3/3): controlled grants for the api surface. ADDITIVE.
-- Grants ONLY schema-usage + execute on the RPCs. The internal intel/private schemas stay locked;
-- the RPCs are SECURITY DEFINER and reach them as owner. anon receives nothing (fail-closed).
-- NOTE: this does NOT expose `api` to the Data API (config.toml is unchanged) — still dark.

grant usage on schema api to authenticated, service_role;

-- Functions default-grant EXECUTE to PUBLIC; lock that down, then grant only intended roles.
revoke execute on all functions in schema api from public;
alter default privileges in schema api revoke execute on functions from public;

grant execute on function api.creator_profile_api_enabled()            to authenticated, service_role;
grant execute on function api.get_my_profile_draft()                   to authenticated, service_role;
grant execute on function api.get_professional_profile(uuid)           to authenticated, service_role;
grant execute on function api.save_profile_section(text, jsonb, text)  to authenticated, service_role;
grant execute on function api.upsert_address(jsonb, text)              to authenticated, service_role;
grant execute on function api.delete_address(uuid, text)               to authenticated, service_role;
grant execute on function api.upsert_skill(jsonb, text)                to authenticated, service_role;
grant execute on function api.upsert_brand_experience(jsonb, text)     to authenticated, service_role;
grant execute on function api.upsert_dream_brand(jsonb, text)          to authenticated, service_role;
grant execute on function api.save_rate_card_item(jsonb, text)         to authenticated, service_role;
