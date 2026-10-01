#!/usr/bin/env bash
# =============================================================================
# Creator Intelligence restricted pilot — one executable release script.
#
# RUN ON A TRUSTED RUNNER ONLY (not from CI auto-mode, not from the sandbox):
#   - supabase CLI installed and authenticated (SUPABASE_ACCESS_TOKEN in env)
#   - git checkout of the MERGED main commit (AFTER PR #1 is merged by a human)
#   - psql available; a direct DB connection string in $PROD_DB_URL for the
#     service-role-only steps (cohort seed, flag flips, verification)
#
# SECRETS: read from environment variables only. This script never prints or
# commits a secret value. It generates CI_WORKER_SECRET / webhook token locally
# and sets them without echoing.
#
# SAFETY: every destructive phase is gated by an explicit typed confirmation and
# by a preceding verification that must pass. It never applies from an unverified
# working tree (blob hashes are checked), never runs migration repair, never
# drops/resets data, never exposes intel/private.
# =============================================================================
set -euo pipefail

PROJECT_REF="edibibytqfrrxfztukpm"
PROD_BASELINE_MIGRATIONS=21        # reported production baseline (CONFIRM in Phase 2, not by anon probe)
EXPECTED_TOTAL_MIGRATIONS=32       # baseline 21 + 11 pending
CALLBACK_URL="https://${PROJECT_REF}.functions.supabase.co/ig-oauth-callback"

# The 11 pending migrations and their expected git blob hashes (integrity gate).
PENDING=(
  "20260922080737_ci_1c_feature_store.sql:fbd7ed609bac"
  "20260922080739_ci_1c_fk_indexes.sql:ad1559aae394"
  "20260923054333_ci_1d_serving_matching.sql:acc433eeba51"
  "20260929090000_ci_pilot_cohort.sql:0a8ef7fd6bcd"
  "20260929100000_ci_pilot_commercial_and_feedback.sql:174d932d6216"
  "20260929110000_ci_ops_vocab.sql:6757c44270b9"
  "20260929120000_ci_ops_campaign_core.sql:42023d1f15f9"
  "20260929130000_ci_ops_participation_events.sql:234bdd0ba307"
  "20260929140000_ci_ops_agency_onboarding.sql:19d6e16592bd"
  "20260929150000_ci_ops_api.sql:cd8656bd1aad"
  "20260929160000_ci_ops_campaign_detail_read.sql:72880774d90f"
)

confirm(){ read -r -p "$1 (type $2 to proceed): " _c; [ "$_c" = "$2" ] || { echo "aborted."; exit 1; }; }
need(){ : "${!1:?missing required env var $1}"; }

# -----------------------------------------------------------------------------
# PHASE 0 — discover supported CLI syntax (read-only; adapt below to your version)
# -----------------------------------------------------------------------------
phase0_help(){
  supabase --version
  supabase --help
  supabase db --help
  supabase db push --help
  supabase db dump --help
  supabase migration list --help
  supabase functions deploy --help
  supabase secrets set --help
  echo ">> Review the help above; if any subcommand/flag below differs in your CLI version, adjust before continuing."
}

# -----------------------------------------------------------------------------
# PHASE 1 — integrity: working tree must equal the approved merged release
# -----------------------------------------------------------------------------
phase1_integrity(){
  echo ">> HEAD: $(git rev-parse HEAD)  branch: $(git rev-parse --abbrev-ref HEAD)"
  echo ">> Confirm this HEAD is the main commit produced by merging PR #1."
  local f h got
  for p in "${PENDING[@]}"; do
    f="${p%%:*}"; h="${p##*:}"
    got="$(git ls-tree HEAD -- "supabase/migrations/$f" | awk '{print substr($3,1,12)}')"
    [ "$got" = "$h" ] || { echo "HASH MISMATCH $f: got ${got:-<absent>} expected $h"; exit 1; }
  done
  local total; total="$(git ls-tree -r HEAD -- supabase/migrations | wc -l | tr -d ' ')"
  [ "$total" = "$EXPECTED_TOTAL_MIGRATIONS" ] || { echo "migration count $total != $EXPECTED_TOTAL_MIGRATIONS"; exit 1; }
  echo ">> Integrity OK: 11 pending hashes match, $total migrations total. All old migrations preserved."
}

# -----------------------------------------------------------------------------
# PHASE 2 — link + production drift / ledger check (AUTHENTICATED, not anon)
# -----------------------------------------------------------------------------
phase2_drift(){
  supabase link --project-ref "$PROJECT_REF"
  echo ">> Remote vs local migration ledger (confirm remote applied == $PROD_BASELINE_MIGRATIONS, local adds exactly the 11):"
  supabase migration list
  echo ">> Confirm with the service role that Creator Intelligence is currently OFF and unexposed:"
  psql "$PROD_DB_URL" -v ON_ERROR_STOP=1 -c \
    "select flag, enabled from intel.ci_feature_flag where flag in ('creator_profile_api','creator_ig_connect','pilot_cohort_enforced','operational_pilot') order by flag;"
  confirm "Does the ledger show exactly the 21 baseline applied and the 4 flags present+false?" YES
}

# -----------------------------------------------------------------------------
# PHASE 3 — fresh backup + restore verification (prove the backup restores)
# -----------------------------------------------------------------------------
phase3_backup(){
  local ts; ts="$(date +%Y%m%d%H%M%S)"
  supabase db dump --linked -f "backup_roles_${ts}.sql" --role-only || true
  supabase db dump --linked -f "backup_schema_${ts}.sql"
  supabase db dump --linked -f "backup_data_${ts}.sql" --data-only
  echo ">> Restore-verify into a DISPOSABLE local stack (never against prod):"
  supabase start >/dev/null
  local LOCAL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
  psql "$LOCAL" -v ON_ERROR_STOP=1 -c "drop schema if exists public cascade; create schema public;" >/dev/null
  psql "$LOCAL" -v ON_ERROR_STOP=1 -f "backup_schema_${ts}.sql" >/dev/null
  psql "$LOCAL" -v ON_ERROR_STOP=1 -f "backup_data_${ts}.sql" >/dev/null
  echo ">> Restore OK (schema+data loaded into local). Spot check a legacy table:"
  psql "$LOCAL" -c "select count(*) as members_rows from public.members;"
  supabase stop >/dev/null
  echo ">> Keep backup_*_${ts}.sql off the repo and in secure storage."
}

# -----------------------------------------------------------------------------
# PHASE 4 — DRY-RUN: propose EXACTLY the 11 migrations (no apply)
# -----------------------------------------------------------------------------
phase4_dryrun(){
  echo ">> Pending migrations the push WILL apply (must be exactly these 11):"
  supabase migration list
  supabase db push --dry-run     # if your CLI lacks --dry-run, 'migration list' above is the proposal
}

# -----------------------------------------------------------------------------
# PHASE 5 — APPLY migrations (gated). No repair, no history edits.
# -----------------------------------------------------------------------------
phase5_apply(){
  confirm "Apply the 11 pending migrations to PRODUCTION ${PROJECT_REF}?" APPLY
  supabase db push
  echo ">> Confirm 32 applied:"; supabase migration list
}

# -----------------------------------------------------------------------------
# PHASE 6 — expose ONLY the api schema (keep intel/private unexposed)
# -----------------------------------------------------------------------------
phase6_expose(){
  cat <<'NOTE'
>> HUMAN/CONFIG STEP (api schema is reachable only when it is in the Data API's exposed list):
   Dashboard: Project Settings > API > Exposed schemas  ->  add "api"  (public already there).
   DO NOT add intel or private. (Function EXECUTE grants already exist from the migrations.)
   If you manage config as code, set in config.toml:  [api]\n  schemas = ["public", "api"]
   then push the config per your CLI (`supabase config push --help`).
NOTE
  confirm "Has 'api' been added to Exposed schemas (and intel/private NOT added)?" YES
  echo ">> Verify exposure boundary (api reachable; intel/private absent) AFTER flags are on, in Phase 11."
}

# -----------------------------------------------------------------------------
# PHASE 7 — secrets (generated/consumed from env; never printed)
# -----------------------------------------------------------------------------
phase7_secrets(){
  need INSTAGRAM_APP_ID; need INSTAGRAM_APP_SECRET   # already valid in prod; re-set only if you must
  local CI_WORKER_SECRET IG_WEBHOOK_VERIFY_TOKEN
  CI_WORKER_SECRET="$(openssl rand -base64 48)"          # >=32 cryptographically-random bytes
  IG_WEBHOOK_VERIFY_TOKEN="$(openssl rand -hex 24)"
  echo ">> Callback URL to be set and registered: ${CALLBACK_URL}"
  supabase secrets set \
    IG_REDIRECT_URI="${CALLBACK_URL}" \
    CI_WORKER_SECRET="${CI_WORKER_SECRET}" \
    IG_WEBHOOK_VERIFY_TOKEN="${IG_WEBHOOK_VERIFY_TOKEN}" \
    --project-ref "${PROJECT_REF}"
  unset CI_WORKER_SECRET IG_WEBHOOK_VERIFY_TOKEN
  echo ">> Secrets set (values not printed). INSTAGRAM_APP_ID/SECRET left as-is (confirmed valid)."
  cat <<NOTE
>> HUMAN: in the Meta app (Instagram Business login) register this EXACT redirect:
     ${CALLBACK_URL}
   Then verify three-way match: deployed function URL == IG_REDIRECT_URI secret ==
   the redirect_uri that ig-oauth-start actually sends == the URI registered in Meta.
NOTE
}

# -----------------------------------------------------------------------------
# PHASE 8 — deploy Edge Functions (pilot OAuth + ingestion worker + webhook)
# -----------------------------------------------------------------------------
phase8_functions(){
  supabase functions deploy ig-oauth-start ig-oauth-callback ig-ingest-worker ig-webhook --project-ref "${PROJECT_REF}"
  echo ">> Deployed. (instagram-login/instagram-auth already deployed for the legacy app — untouched.)"
}

# -----------------------------------------------------------------------------
# PHASE 9 — schedule worker (drains queued ingestion) + retention cleanup
# -----------------------------------------------------------------------------
phase9_schedule(){
  cat <<'NOTE'
>> Worker invocation + retention are scheduled via pg_cron calling the Edge endpoints with the
   CI_WORKER_SECRET header (store the secret in Vault; never inline). Example (run once, service role):
     select cron.schedule('ci-ingest-worker','*/2 * * * *', $$
       select net.http_post(
         url := 'https://edibibytqfrrxfztukpm.functions.supabase.co/ig-ingest-worker',
         headers := jsonb_build_object('x-ci-worker-secret', vault_read('CI_WORKER_SECRET')),
         body := '{}'::jsonb);$$);
     select cron.schedule('ci-retention-purge','17 3 * * *', $$ select intel.ci_purge_expired(1000); $$);
   Confirm pg_cron + pg_net (or supabase schedules) are enabled for the project.
NOTE
  confirm "Worker schedule + retention-purge schedule created?" YES
}

# -----------------------------------------------------------------------------
# PHASE 10 — seed operators + cohort (idempotent, CORRECT identifier types)
#   member_id = AUTH USER UUID (== auth.uid());  org_id = public.members.org_id;
#   identity_id (optional, docs) = ci_creator_identity.identity_id.  NOT interchangeable.
# -----------------------------------------------------------------------------
phase10_cohort(){
  need OP_AUTH_UID; need CREATOR_AUTH_UID; need BRAND_ORG_ID
  psql "$PROD_DB_URL" -v ON_ERROR_STOP=1 <<SQL
-- integrity: identifiers must resolve to the right FKs before insert
do \$\$ begin
  if not exists (select 1 from auth.users where id='${OP_AUTH_UID}') then raise exception 'OP_AUTH_UID not an auth.users id'; end if;
  if not exists (select 1 from auth.users where id='${CREATOR_AUTH_UID}') then raise exception 'CREATOR_AUTH_UID not an auth.users id'; end if;
  if not exists (select 1 from public.members where org_id='${BRAND_ORG_ID}') then raise exception 'BRAND_ORG_ID not a members.org_id'; end if;
end \$\$;
insert into intel.ci_agency_operator(member_id,label) values ('${OP_AUTH_UID}','geek operator')
  on conflict (member_id) do update set active=true;
insert into intel.ci_pilot_cohort(subject_kind,member_id,label) values ('creator','${CREATOR_AUTH_UID}','pilot creator')
  on conflict do nothing;
insert into intel.ci_pilot_cohort(subject_kind,org_id,label) values ('brand','${BRAND_ORG_ID}','pilot brand')
  on conflict do nothing;
select 'operators='||count(*) from intel.ci_agency_operator where active;
select 'cohort='||count(*) from intel.ci_pilot_cohort where active;
SQL
}

# -----------------------------------------------------------------------------
# PHASE 11 — enable flags IN ORDER (cohort enforcement FIRST), assert row counts
# -----------------------------------------------------------------------------
phase11_enable(){
  psql "$PROD_DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
do $$ declare n int;
begin
  -- enforcement BEFORE creator-facing surfaces; a zero-row UPDATE is a failure
  update intel.ci_feature_flag set enabled=true where flag='pilot_cohort_enforced'; get diagnostics n=row_count; if n<>1 then raise exception 'pilot_cohort_enforced row missing (expected 1, got %)', n; end if;
  update intel.ci_feature_flag set enabled=true where flag='operational_pilot';     get diagnostics n=row_count; if n<>1 then raise exception 'operational_pilot row missing (got %)', n; end if;
  update intel.ci_feature_flag set enabled=true where flag='creator_profile_api';    get diagnostics n=row_count; if n<>1 then raise exception 'creator_profile_api row missing (got %)', n; end if;
  update intel.ci_feature_flag set enabled=true where flag='creator_ig_connect';     get diagnostics n=row_count; if n<>1 then raise exception 'creator_ig_connect row missing (got %)', n; end if;
end $$;
select flag, enabled from intel.ci_feature_flag where flag in ('pilot_cohort_enforced','operational_pilot','creator_profile_api','creator_ig_connect') order by flag;
SQL
}

# -----------------------------------------------------------------------------
# PHASE 12 — post-enable verification (server-side enforcement + exposure boundary)
#   Requires JWTs for a cohort creator and a NON-cohort user (service-issued test tokens).
# -----------------------------------------------------------------------------
phase12_verify(){
  cat <<'NOTE'
>> Authenticated checks (use real user JWTs via the Data API, not the service role):
   1. Exposure: GET /rest/v1/rpc/get_my_creator_intelligence with a COHORT creator JWT -> 200;
      /rest/v1/ reflection must NOT list intel/private; api.* reachable only for the intended fns.
   2. Enforcement: the SAME call with a NON-cohort user JWT -> 403/exception "not in pilot cohort".
   3. Operator: get_campaign_pipeline with a non-operator JWT -> "not an agency operator"; with the
      seeded operator -> 200.
   Record the actual responses. This is required for GO; anon probes do NOT satisfy it.
NOTE
}

# -----------------------------------------------------------------------------
# ROLLBACK (data-preserving) — covers ALL deployed entry points. Keep retention running.
# -----------------------------------------------------------------------------
rollback(){
  echo ">> Rolling back (flags off; stop ingestion; preserve data; keep retention purge)."
  psql "$PROD_DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
update intel.ci_feature_flag set enabled=false
  where flag in ('creator_profile_api','creator_ig_connect','operational_pilot','pilot_cohort_enforced');
select flag, enabled from intel.ci_feature_flag where flag like 'creator_%' or flag in ('operational_pilot','pilot_cohort_enforced') order by flag;
SQL
  cat <<'NOTE'
>> Also, to cover every deployed entry point:
   - unschedule the worker:  select cron.unschedule('ci-ingest-worker');   (STOP ingestion invocation)
   - KEEP 'ci-retention-purge' scheduled (retention cleanup must keep running).
   - (optional, full dark) remove 'api' from Exposed schemas so the surface is unreachable.
   Entry-point coverage:
     api serving/profile RPCs      <- creator_profile_api=false
     creator IG connect (oauth)    <- creator_ig_connect=false (ig_connect_start gated)
     operations (campaign) RPCs    <- operational_pilot=false
     cohort restriction            <- pilot_cohort_enforced=false (surface closes with the api flag anyway)
     ingestion worker              <- cron unscheduled
   No data is dropped; no migration is reverted.
NOTE
}

main(){
  case "${1:-all}" in
    rollback) rollback;;
    *) phase0_help; phase1_integrity; phase2_drift; phase3_backup; phase4_dryrun;
       phase5_apply; phase6_expose; phase7_secrets; phase8_functions; phase9_schedule;
       phase10_cohort; phase11_enable; phase12_verify;
       echo ">> Preparation/apply phases complete. GO only after Phase 12 passes AND the live E2E in the runbook passes.";;
  esac
}
main "$@"
