-- Phase 1B-fix2 — database-side defense in depth for the privileged worker/lifecycle functions.
-- These must never be executable by PUBLIC/anon/authenticated; only service_role may run them.
-- (The Edge worker's internal-secret gate is unit-tested in Deno; this asserts the DB grant floor.)
begin;
select * from no_plan();

-- helper: assert a function is service_role-only
create or replace function _assert_service_only(p_sig text, p_label text) returns setof text language sql as $$
  select is( has_function_privilege('public', p_sig, 'EXECUTE'), false, p_label || ': PUBLIC cannot execute')
  union all select is( has_function_privilege('anon', p_sig, 'EXECUTE'), false, p_label || ': anon cannot execute')
  union all select is( has_function_privilege('authenticated', p_sig, 'EXECUTE'), false, p_label || ': authenticated cannot execute')
  union all select is( has_function_privilege('service_role', p_sig, 'EXECUTE'), true,  p_label || ': service_role may execute');
$$;

select _assert_service_only('intel.ci_claim_stages(text,int,int)', 'ci_claim_stages');
select _assert_service_only('intel.ci_release_stage(uuid,text,text,int,int,int,text,text,text)', 'ci_release_stage');
select _assert_service_only('intel.ci_recover_abandoned_leases()', 'ci_recover_abandoned_leases');
select _assert_service_only('intel.ci_destroy_connection_secret(uuid,uuid,uuid,text)', 'ci_destroy_connection_secret');
select _assert_service_only('intel.ci_vault_destroy(text)', 'ci_vault_destroy');
select _assert_service_only('intel.ci_purge_expired(int)', 'ci_purge_expired');
select _assert_service_only('intel.ci_cancel_capability_stages(uuid,text)', 'ci_cancel_capability_stages');

-- token-bearing internal writers stay service-role-only too
select _assert_service_only('intel.ci_refresh_token(uuid,text,timestamptz,text)', 'ci_refresh_token');
select _assert_service_only('intel.ci_vault_store(text,text)', 'ci_vault_store');

select * from finish();
rollback;
