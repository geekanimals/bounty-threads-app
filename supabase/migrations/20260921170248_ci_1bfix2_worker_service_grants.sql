-- Phase 1B-fix2 (migration 21): grant the BACKEND worker/scheduler identity (service_role) EXECUTE on
-- exactly the privileged internal functions it must call. ADDITIVE. Migrations 1–20 are NOT edited.
-- PUBLIC/anon/authenticated remain revoked (set in migrations 18–20) — so an ordinary authenticated
-- creator still cannot execute any of these; only service_role (the internal worker, gated at the Edge
-- by CI_WORKER_SECRET) and the definer chain may. Least-privilege: only these functions, only EXECUTE.
grant execute on function intel.ci_claim_stages(text, int, int)                                   to service_role;
grant execute on function intel.ci_release_stage(uuid, text, text, int, int, int, text, text, text) to service_role;
grant execute on function intel.ci_recover_abandoned_leases()                                      to service_role;
grant execute on function intel.ci_cancel_capability_stages(uuid, text)                            to service_role;
grant execute on function intel.ci_purge_expired(int)                                              to service_role;
grant execute on function intel.ci_destroy_connection_secret(uuid, uuid, uuid, text)               to service_role;
grant execute on function intel.ci_vault_destroy(text)                                             to service_role;
grant execute on function intel.ci_vault_store(text, text)                                         to service_role;
grant execute on function intel.ci_refresh_token(uuid, text, timestamptz, text)                    to service_role;
