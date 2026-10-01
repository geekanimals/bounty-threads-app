#!/usr/bin/env bash
# =============================================================================
# Creator Intelligence restricted pilot — release script (modal, gated).
#
# MODES (a single invocation NEVER silently proceeds from preflight to activation):
#   preflight   (DEFAULT, READ-ONLY)  CLI discovery, integrity, drift/ledger, backup+restore-verify, dry-run
#   deploy      (mutating, DARK)       apply 11 migrations, expose api, set secrets, deploy fns, schedule worker+retention — flags STAY OFF
#   activate    (mutating)             seed operator + ONE internal creator, enforce cohort, enable creator-facing — then STOP for live E2E
#   admit       (mutating)             after the real Meta E2E passes, admit the remaining cohort (brand org + other creators)
#   rollback    (mutating)             disable creator_profile_api/creator_ig_connect/operational_pilot; KEEP pilot_cohort_enforced=true;
#                                      stop ingestion invocation; keep retention cleanup; prove ingestion cannot restart
#
# RUN ON A TRUSTED RUNNER ONLY: supabase CLI authenticated (SUPABASE_ACCESS_TOKEN),
# git checkout of the MERGED main commit (after a human merges PR #1), psql + $PROD_DB_URL
# (service-role connection) for the DB-level steps. Secrets come from env; never printed or committed.
# Activation order (item 2): deploy dark -> verify -> enforce cohort -> ONE creator -> real Meta E2E -> admit rest.
# =============================================================================
set -euo pipefail

PROJECT_REF="edibibytqfrrxfztukpm"
PROD_BASELINE_MIGRATIONS=21
EXPECTED_TOTAL_MIGRATIONS=32
CALLBACK_URL="https://${PROJECT_REF}.functions.supabase.co/ig-oauth-callback"

# The 11 pending migrations and their expected GIT BLOB object names.
# NOTE: these are git blob ids = SHA-1 over the git blob ("blob <len>\0" + bytes). They pin exact file
# content IN GIT. They are NOT SHA-256 content digests. For an independent content digest use sha256sum
# (printed in preflight). Do not conflate the two.
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

# ------------------------------- PREFLIGHT (read-only) ------------------------------
phase_help(){
  supabase --version; supabase --help; supabase db --help; supabase db push --help
  supabase db dump --help; supabase migration list --help; supabase functions deploy --help; supabase secrets --help
  echo ">> Adjust any subcommand/flag below if your CLI version differs."
}
phase_integrity(){
  echo ">> HEAD $(git rev-parse HEAD) ($(git rev-parse --abbrev-ref HEAD)) — must be the main commit from merging PR #1."
  local f h got
  for p in "${PENDING[@]}"; do f="${p%%:*}"; h="${p##*:}"
    got="$(git ls-tree HEAD -- "supabase/migrations/$f" | awk '{print substr($3,1,12)}')"
    [ "$got" = "$h" ] || { echo "GIT-BLOB MISMATCH $f: got ${got:-<absent>} want $h"; exit 1; }; done
  local total; total="$(git ls-tree -r HEAD -- supabase/migrations | wc -l | tr -d ' ')"
  [ "$total" = "$EXPECTED_TOTAL_MIGRATIONS" ] || { echo "migration count $total != $EXPECTED_TOTAL_MIGRATIONS"; exit 1; }
  echo ">> git-blob integrity OK (11 pinned, $total total, old migrations preserved)."
  echo ">> Independent SHA-256 content digests (distinct from the git blob ids above):"
  for p in "${PENDING[@]}"; do f="${p%%:*}"; sha256sum "supabase/migrations/$f" 2>/dev/null || shasum -a 256 "supabase/migrations/$f"; done
}
phase_drift(){
  supabase link --project-ref "$PROJECT_REF"
  echo ">> Remote vs local ledger (confirm remote applied == $PROD_BASELINE_MIGRATIONS; local adds exactly the 11):"
  supabase migration list
  echo ">> Service-role flag check (authenticated — NOT anon probes):"
  psql "$PROD_DB_URL" -v ON_ERROR_STOP=1 -c "select flag,enabled from intel.ci_feature_flag where flag in ('creator_profile_api','creator_ig_connect','pilot_cohort_enforced','operational_pilot') order by flag;"
}
phase_backup(){
  local ts; ts="$(date +%Y%m%d%H%M%S)"
  supabase db dump --linked -f "backup_schema_${ts}.sql"
  supabase db dump --linked -f "backup_data_${ts}.sql" --data-only
  echo ">> Restore-verify into a DISPOSABLE local stack (never against prod):"
  supabase start >/dev/null; local L="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
  psql "$L" -v ON_ERROR_STOP=1 -f "backup_schema_${ts}.sql" >/dev/null
  psql "$L" -v ON_ERROR_STOP=1 -f "backup_data_${ts}.sql" >/dev/null
  psql "$L" -c "select count(*) as members_rows from public.members;"; supabase stop >/dev/null
  echo ">> Restore verified. Store backup_*_${ts}.sql securely, OUT of the repo."
}
phase_dryrun(){ echo ">> DRY-RUN — exactly these 11 will apply:"; supabase migration list; supabase db push --dry-run; }

preflight(){ phase_help; phase_integrity; phase_drift; phase_backup; phase_dryrun
  echo ">> PREFLIGHT complete (read-only). Nothing applied. Next: './release_pilot.sh deploy' when GO on §Phase2/3."; }

# ------------------------------- DEPLOY (dark; flags stay off) ----------------------
phase_apply(){ confirm "Apply the 11 pending migrations to PRODUCTION ${PROJECT_REF}?" APPLY
  supabase db push; echo ">> confirm 32:"; supabase migration list; }
phase_expose(){ cat <<'NOTE'
>> Add "api" to the Data API Exposed schemas (Settings>API, or config.toml [api] schemas=["public","api"] then config push).
   DO NOT expose intel or private. Grants (usage on api, execute on the api fns) already ship in the migrations.
NOTE
  confirm "Is 'api' exposed and intel/private NOT exposed?" YES; }
phase_secrets(){
  echo ">> Reusing existing Instagram secrets; only set if genuinely missing."
  local have; have="$(supabase secrets list --project-ref "$PROJECT_REF" 2>/dev/null || true)"
  if ! grep -q "INSTAGRAM_APP_ID" <<<"$have" || ! grep -q "INSTAGRAM_APP_SECRET" <<<"$have"; then
    need INSTAGRAM_APP_ID; need INSTAGRAM_APP_SECRET
    supabase secrets set INSTAGRAM_APP_ID="$INSTAGRAM_APP_ID" INSTAGRAM_APP_SECRET="$INSTAGRAM_APP_SECRET" --project-ref "$PROJECT_REF"
    echo ">> set missing INSTAGRAM_APP_ID/SECRET (values not printed)."
  else echo ">> INSTAGRAM_APP_ID/SECRET already present — left untouched (confirmed valid earlier)."; fi
  local CI_WORKER_SECRET IG_WEBHOOK_VERIFY_TOKEN
  CI_WORKER_SECRET="$(openssl rand -base64 48)"            # >=32 cryptographically-random bytes
  IG_WEBHOOK_VERIFY_TOKEN="$(openssl rand -hex 24)"
  supabase secrets set IG_REDIRECT_URI="$CALLBACK_URL" CI_WORKER_SECRET="$CI_WORKER_SECRET" IG_WEBHOOK_VERIFY_TOKEN="$IG_WEBHOOK_VERIFY_TOKEN" --project-ref "$PROJECT_REF"
  unset CI_WORKER_SECRET IG_WEBHOOK_VERIFY_TOKEN
  echo ">> HUMAN: register ${CALLBACK_URL} in Meta; verify deployed URL == IG_REDIRECT_URI == ig-oauth-start redirect == Meta."
}
phase_functions(){ supabase functions deploy ig-oauth-start ig-oauth-callback ig-ingest-worker ig-webhook --project-ref "$PROJECT_REF"
  echo ">> deployed (legacy instagram-login/auth untouched)."; }
phase_schedule(){ cat <<'NOTE'
>> Schedule (service role; secret from Vault, never inline):
   select cron.schedule('ci-ingest-worker','*/2 * * * *', $$ select net.http_post(
     url:='https://edibibytqfrrxfztukpm.functions.supabase.co/ig-ingest-worker',
     headers:=jsonb_build_object('x-ci-worker-secret', vault_read('CI_WORKER_SECRET')), body:='{}'::jsonb);$$);
   select cron.schedule('ci-retention-purge','17 3 * * *', $$ select intel.ci_purge_expired(1000); $$);
NOTE
  confirm "Worker + retention schedules created?" YES; }
phase_verify_dark(){
  echo ">> Verify (flags still OFF): migrations=32, api exposed/intel-private not, worker processes a queued run without error."
  echo ">> Confirm exposure with an AUTHENTICATED creator JWT (api.* reachable; intel/private absent from reflection)."
}
deploy(){ confirm "DEPLOY dark to PROD (apply migrations, expose api, secrets, functions, schedules; flags stay OFF)?" DEPLOY
  phase_integrity; phase_apply; phase_expose; phase_secrets; phase_functions; phase_schedule; phase_verify_dark
  echo ">> DEPLOY complete and DARK. Next: './release_pilot.sh activate' with OP_AUTH_UID + CREATOR_AUTH_UID."; }

# ------------------------------- ACTIVATE (one internal creator) --------------------
activate(){
  need OP_AUTH_UID; need CREATOR_AUTH_UID
  confirm "ACTIVATE for ONE internal creator (enforce cohort, enable creator-facing)?" ACTIVATE
  psql "$PROD_DB_URL" -v ON_ERROR_STOP=1 <<SQL
do \$\$ begin
  if not exists (select 1 from auth.users where id='${OP_AUTH_UID}') then raise exception 'OP_AUTH_UID is not an auth.users id'; end if;
  if not exists (select 1 from auth.users where id='${CREATOR_AUTH_UID}') then raise exception 'CREATOR_AUTH_UID is not an auth.users id'; end if;
end \$\$;
insert into intel.ci_agency_operator(member_id,label) values ('${OP_AUTH_UID}','geek operator') on conflict (member_id) do update set active=true;
insert into intel.ci_pilot_cohort(subject_kind,member_id,label) values ('creator','${CREATOR_AUTH_UID}','pilot creator #1') on conflict do nothing;
-- enforce cohort BEFORE creator-facing features; each UPDATE must touch exactly 1 row
do \$\$ declare n int; begin
  update intel.ci_feature_flag set enabled=true where flag='pilot_cohort_enforced'; get diagnostics n=row_count; if n<>1 then raise exception 'pilot_cohort_enforced missing (%).',n; end if;
  update intel.ci_feature_flag set enabled=true where flag='operational_pilot';     get diagnostics n=row_count; if n<>1 then raise exception 'operational_pilot missing (%).',n; end if;
  update intel.ci_feature_flag set enabled=true where flag='creator_profile_api';    get diagnostics n=row_count; if n<>1 then raise exception 'creator_profile_api missing (%).',n; end if;
  update intel.ci_feature_flag set enabled=true where flag='creator_ig_connect';     get diagnostics n=row_count; if n<>1 then raise exception 'creator_ig_connect missing (%).',n; end if;
end \$\$;
select flag,enabled from intel.ci_feature_flag order by flag;
SQL
  cat <<NOTE
>> ONE creator active. REQUIRED NEXT (human, real browser — synthetic does not count):
   Run the live Meta E2E as CREATOR_AUTH_UID: sign in -> Connect Instagram (real consent; record granted scopes)
   -> callback -> queued ingestion -> worker run -> feature computation -> creator intelligence view, recording
   ACTUAL returned metrics and the fields that come back unavailable/insufficient_data.
   Also confirm a NON-cohort account is denied (not in pilot cohort).
   PASS  -> './release_pilot.sh admit'
   FAIL  -> './release_pilot.sh rollback'  and report the SPECIFIC failing stage/response.
NOTE
}

# ------------------------------- ADMIT (rest of cohort, post-E2E) -------------------
admit(){
  need BRAND_ORG_ID
  confirm "E2E PASSED — admit the remaining pilot cohort (brand org + any extra creators)?" ADMIT
  psql "$PROD_DB_URL" -v ON_ERROR_STOP=1 <<SQL
do \$\$ begin
  if not exists (select 1 from public.members where org_id='${BRAND_ORG_ID}') then raise exception 'BRAND_ORG_ID is not a members.org_id'; end if;
end \$\$;
insert into intel.ci_pilot_cohort(subject_kind,org_id,label) values ('brand','${BRAND_ORG_ID}','pilot brand') on conflict do nothing;
-- add more creators here as 'creator' rows keyed by their auth.users.id (idempotent):
-- insert into intel.ci_pilot_cohort(subject_kind,member_id,label) values ('creator','<auth-uid>','pilot creator #N') on conflict do nothing;
select subject_kind, count(*) from intel.ci_pilot_cohort where active group by subject_kind;
SQL
  echo ">> Remaining cohort admitted. Flags already on; enforcement remains on."
}

# ------------------------------- ROLLBACK (data-preserving) -------------------------
# Disable creator-facing + ops entry points; KEEP pilot_cohort_enforced=true; stop ingestion; keep retention.
rollback(){
  confirm "ROLLBACK pilot (disable creator_profile_api/creator_ig_connect/operational_pilot; keep enforcement on; stop ingestion)?" ROLLBACK
  psql "$PROD_DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
-- keep pilot_cohort_enforced = true (surface stays closed-by-cohort even if a flag is later toggled)
update intel.ci_feature_flag set enabled=false where flag in ('creator_profile_api','creator_ig_connect','operational_pilot');
update intel.ci_feature_flag set enabled=true  where flag='pilot_cohort_enforced';
-- stop ingestion invocation; KEEP retention cleanup scheduled
do $$ begin
  if exists (select 1 from cron.job where jobname='ci-ingest-worker') then perform cron.unschedule('ci-ingest-worker'); end if;
end $$;
-- PROOF that ingestion cannot restart:
select 'flags' k, jsonb_object_agg(flag,enabled) v from intel.ci_feature_flag
  where flag in ('creator_profile_api','creator_ig_connect','operational_pilot','pilot_cohort_enforced')
union all
select 'ingest_worker_scheduled', to_jsonb(exists(select 1 from cron.job where jobname='ci-ingest-worker'))
union all
select 'retention_still_scheduled', to_jsonb(exists(select 1 from cron.job where jobname='ci-retention-purge'));
SQL
  cat <<'NOTE'
>> Ingestion-restart coverage (why nothing can re-queue or process):
   - ig-ingest-worker (sole processor)   : cron UNSCHEDULED -> no runner drains the queue.
   - ig-oauth-callback / ig_connect_start: creator_ig_connect=false -> no new connection -> nothing enqueued.
   - ig-webhook                          : may receive events, but only the (unscheduled) worker processes them.
   - api serving/ops                     : creator_profile_api / operational_pilot = false.
   - cohort                              : pilot_cohort_enforced stays TRUE (defence-in-depth).
   - retention                           : ci-retention-purge REMAINS scheduled.
   Confirm above: all three creator/ops flags=false, pilot_cohort_enforced=true,
   ingest_worker_scheduled=false, retention_still_scheduled=true. Deployed functions remain but inert.
   No data dropped; no migration reverted. (Full dark optional: remove 'api' from Exposed schemas.)
NOTE
}

usage(){ echo "usage: $0 [preflight|deploy|activate|admit|rollback]   (default: preflight, read-only)"; }
case "${1:-preflight}" in
  preflight) preflight;;
  deploy)    deploy;;
  activate)  activate;;
  admit)     admit;;
  rollback)  rollback;;
  -h|--help) usage;;
  *) usage; exit 1;;
esac
