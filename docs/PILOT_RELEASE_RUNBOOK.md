# Creator Intelligence Restricted Pilot — Release Runbook

Candidate: `pilot-integration` @ `e8061da`, 32 migrations, **PR #1**. Production baseline **reported** 21
migrations (confirm in Phase 2 with the service role — **not** from anonymous probes). Executable script:
`scripts/release_pilot.sh` (run on a trusted runner; see its header). **After a human merges PR #1, deploy
from the resulting `main` commit.** The GitHub auto-review rejection is not bypassed.

## 1. The 11 pending migrations (all additive; no old migration changed)

| # | Migration (blob hash) | Purpose |
|---|---|---|
| 22 | `fbd7ed609bac` `20260922080737_ci_1c_feature_store.sql` | 1C feature store: append-only feature values + six explainable measures + provenance. |
| 23 | `ad1559aae394` `20260922080739_ci_1c_fk_indexes.sql` | 1C covering indexes on real FK/query paths. |
| 24 | `acc433eeba51` `20260923054333_ci_1d_serving_matching.sql` | 1D serving RPCs + relationship-scoped brand auth + evidence resolver + deterministic matcher. |
| 25 | `0a8ef7fd6bcd` `20260929090000_ci_pilot_cohort.sql` | Server-enforced pilot cohort gate (`pilot_cohort_enforced` flag + `ci_pilot_cohort`). |
| 26 | `174d932d6216` `20260929100000_ci_pilot_commercial_and_feedback.sql` | Brand decision fields (category/formats/brand-history/barter/rate, visibility-gated) + `ci_pilot_feedback`. |
| 27 | `6757c44270b9` `20260929110000_ci_ops_vocab.sql` | Controlled vocabularies (content format, campaign objective, participation role) + `operational_pilot` flag. |
| 28 | `42023d1f15f9` `20260929120000_ci_ops_campaign_core.sql` | Canonical `ci_campaign` + `ci_brand_org_profile` + `ci_campaign_brief` (legacy campaigns soft-linked only). |
| 29 | `234bdd0ba307` `20260929130000_ci_ops_participation_events.sql` | Participation + **append-only `ci_campaign_event`** ledger + deliverable/shipment/submission/approval + transition fns. |
| 30 | `19d6e16592bd` `20260929140000_ci_ops_agency_onboarding.sql` | `ci_agency_operator` allowlist + onboarding events + `ci_pilot_feedback.campaign_id`. |
| 31 | `cd8656bd1aad` `20260929150000_ci_ops_api.sql` | Operations api (create/invite/advance/ship/submit/approve/pipeline/onboarding-status/metrics). |
| 32 | `72880774d90f` `20260929160000_ci_ops_campaign_detail_read.sql` | Read-only operator/owning-brand `get_campaign_detail` (security-approved). |

> **Hash type:** the values above are **git blob object ids** (git's SHA-1 over `"blob <len>\0"+bytes`) — they
> pin exact file content *in git* and are what `preflight` verifies against HEAD. They are **not** SHA-256
> content digests; `preflight` also prints independent `sha256sum` values for each file if you want a
> content-addressed check. Do not conflate the two.

**Added operations scope (brief):** a dark, additive **barter-execution OS** over the existing identity/
profile/brand/matching/feature-store code — campaigns with an 11-stage lifecycle, append-only event history
(owner/timestamp/reason), deliverables/shipments/submissions/approvals, an internal agency-operator allowlist,
a creator "My Campaigns"/onboarding surface, and evidence-only metrics. **No** scores/ranking, **no** inferred
performance, **no** historical import, **no** change to existing intelligence models.

## 2. Script modes & activation order (`release_pilot.sh <mode>`)
The script is **modal and gated**; the **default is read-only `preflight`**. A single invocation never
proceeds from preflight into activation — each mutating stage is a separate, explicitly-named mode with a typed
confirmation. Required order (matches the brief): **deploy dark → verify → enforce cohort → one internal
creator → real Meta E2E → admit remaining cohort**.

- **`preflight`** *(default, READ-ONLY)* — CLI `--help` discovery; integrity (HEAD = merged-PR#1 commit; the 11
  **git blob ids** match; total = 32; old migrations preserved; plus independent **SHA-256** digests printed —
  see §1 note); authenticated drift/ledger (`migration list` + service-role flag query, not anon); backup +
  **restore-verify into a disposable local stack**; dry-run proposing **exactly** the 11. *Applies nothing.*
- **`deploy`** *(mutating, stays DARK — flags OFF)* — apply the 11 (`db push`, no repair); expose **only** `api`
  (keep `intel`/`private` unexposed); set secrets (reuse existing Instagram secrets, see §3); deploy
  `ig-oauth-start/-callback/-ingest-worker/-webhook`; schedule worker + retention; verify (migrations=32,
  exposure boundary, worker runs) — **with all feature flags still false**.
- **`activate`** *(mutating)* — seed the operator + **ONE** internal creator; **enforce cohort first**
  (`pilot_cohort_enforced` → `operational_pilot` → `creator_profile_api` → `creator_ig_connect`, each `UPDATE`
  asserted to touch **exactly 1 row**; 0 = failure); verify the one creator is allowed and a **non-cohort
  account is denied**. Then STOP and require the **real Meta E2E** (§5).
- **`admit`** *(mutating, only after E2E passes)* — insert the remaining cohort (brand org + any further
  creators), idempotently.
- **`rollback`** *(mutating, data-preserving)* — see §6.

**Required inputs by mode:** `deploy` → `SUPABASE_ACCESS_TOKEN`, `PROD_DB_URL`, (only if missing)
`INSTAGRAM_APP_ID`/`INSTAGRAM_APP_SECRET`. `activate` → `OP_AUTH_UID`, `CREATOR_AUTH_UID` (both
`auth.users.id`). `admit` → `BRAND_ORG_ID` (`public.members.org_id`).

## 3. Required human actions (cannot be scripted / not available in this session)
- **Merge PR #1** (GitHub review gate; auto-mode rejected automated merge).
- Provide the trusted runner with **`SUPABASE_ACCESS_TOKEN`** + `PROD_DB_URL` (service-role conn) + `INSTAGRAM_APP_ID`/`INSTAGRAM_APP_SECRET` in env.
- Supply cohort identifiers: `OP_AUTH_UID`, `CREATOR_AUTH_UID` (both **auth.users.id**), `BRAND_ORG_ID` (**public.members.org_id**).
- **Meta app:** register the callback `https://edibibytqfrrxfztukpm.functions.supabase.co/ig-oauth-callback` and (if using webhooks) configure the webhook with `IG_WEBHOOK_VERIFY_TOKEN`.
- Add **`api`** to Exposed schemas (Phase 6).
- Provide a **consenting Instagram professional account** for the live E2E (§5).

## 4. Cohort identifiers — NOT interchangeable (verified against the FKs)
- `ci_agency_operator.member_id` → **`auth.users(id)`** (= `auth.uid()`). Operator = an **auth user**.
- `ci_pilot_cohort.member_id` → **`auth.users(id)`** (creator rows). Creator allowlisted by **auth user id**.
- `ci_pilot_cohort.org_id` → **`public.members.org_id`** (brand rows; no hard FK — matched by `ci_caller_org()`). Brand allowlisted by **org**.
- `ci_pilot_cohort.identity_id` → `ci_creator_identity(identity_id)` (optional, documentation only; **not** used for enforcement).
Server enforcement: `ci_in_pilot_cohort()` matches `auth.uid()`→creator rows OR `ci_caller_org()`→brand rows; `ci_assert_api_enabled` raises `42501 not in pilot cohort` when enforced and unlisted. Phase 10 asserts each id resolves to its correct table before insert; inserts are idempotent.

## 5. Live E2E (required for GO — synthetic does NOT count)
With the named creator + brand, in a real browser: **sign in → Connect Instagram (real Meta consent, record granted scopes) → callback → queued ingestion → worker run → feature computation → creator intelligence view → operator shortlist/compare → brand decision**. Record **actual returned metrics and the fields that come back `unavailable`/`insufficient_data`**. Pending until performed on the activated pilot with a consenting account.
**On PASS →** `./release_pilot.sh admit`. **On FAIL →** `./release_pilot.sh rollback` (disables the pilot entry points, keeps enforcement + retention) and report the **specific failing stage and response** (OAuth redirect / Edge invocation / Meta token exchange / worker / feature computation / serving).

## 6. GO / BLOCKED criteria
**GO** when ALL hold:
- Phase 1 integrity (11 hashes, 32 total) ✓; Phase 2 ledger shows 21→32 applied and flags toggled as intended ✓.
- Backup taken **and restore-verified** ✓.
- `api` exposed, `intel`/`private` **not** exposed (authenticated reflection) ✓.
- Secrets set (names only confirmed; `CI_WORKER_SECRET` ≥32 bytes) ✓; callback three-way match ✓.
- Functions deployed; worker **drains a real queued ingestion** ✓; retention schedule active ✓.
- Cohort seeded with correct id types; **non-cohort denied**, operator/creator allowed ✓.
- **Live E2E (§5) passes with real Meta data** ✓.

**BLOCKED (current, external):**
1. **PR #1 merge** — human GitHub review (auto-merge rejected). *Do not bypass.*
2. **No Supabase access token / CLI / `PROD_DB_URL`** in this session → cannot apply, deploy, set secrets, seed, flip flags, or run authenticated verification.
3. **Consenting Instagram account** for the live E2E.

**Rollback (data-preserving):** `release_pilot.sh rollback` →
- `creator_profile_api`, `creator_ig_connect`, `operational_pilot` → **false** (closes api serving, creator
  connect, operations);
- **`pilot_cohort_enforced` stays TRUE** (defence-in-depth — the surface remains cohort-closed even if a flag
  is later toggled);
- **unschedule `ci-ingest-worker`** (stops ingestion invocation); **keep `ci-retention-purge` scheduled**;
- proves ingestion cannot restart: the sole processor (worker) is unscheduled, `ig-oauth-callback`/
  `ig_connect_start` are gated by `creator_ig_connect=false` (nothing new enqueues), and `ig-webhook` events are
  only drained by the (unscheduled) worker. Deployed functions remain but inert; no data dropped, no migration
  reverted; optional full-dark = remove `api` from Exposed schemas.

*Prepared this session: runbook + executable script + integrity hashes. The apply/deploy/activate phases and the live E2E require the human actions in §3 and the credentials this session does not hold.*
