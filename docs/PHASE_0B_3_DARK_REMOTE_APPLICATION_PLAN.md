# Phase 0B.3 — Dark Remote Foundation Application Plan

**Type:** DESIGN / AUDIT ONLY. No remote execution. No `db push`, no `migration repair`, no DDL/DML,
no Edge deploy, no secrets, no flag changes, no Data API exposure. No migration SQL edited.

**Purpose:** define the safest first remote application of the 12 Creator Intelligence migrations to a
production database that already holds the legacy app schema but has **no app migration ledger**.

---

## A. Verified baseline
Project **Bounty n Threads** (`edibibytqfrrxfztukpm`, ap-south-1, PG 17.6). Production drift VERIFIED
(0B.1). Compatibility VERIFIED (0B.2): actual production schema + 12 migrations apply cleanly, legacy
`public` byte-identical (fingerprint `a4ec0fc6…770fd`), 249/249 pgTAP, deterministic. Snapshot
SHA-256 `86ea0ee0…f042fd`. Extensions `pgcrypto` + `supabase_vault` present. `intel`/`private`/`api`
absent remotely.

## B. Production migration-history state
`supabase_migrations.schema_migrations` **does not exist**; recorded app migrations = **0**. Legacy
`public` (16 tables / 27 functions / 40 policies) was hand-built via `DATABASE_SETUP.sql`, outside any
migration ledger.

## C. Exact local migration manifest (12; from disk)
```
1  20260918090001_ci_schemas_roles_helpers      intel/private/api + pgcrypto(no-op on prod)
2  20260918090002_ci_identity_foundation        intel
3  20260918090003_ci_profile_private            private
4  20260918090004_ci_profile_professional       intel
5  20260918090005_ci_control_foundation         intel
6  20260918090006_ci_rls_grants                 intel/private (RLS + grants)
7  20260919090001_ci_feature_flags_and_api_helpers  intel (+ flag creator_profile_api=false)
8  20260919090002_ci_profile_api                api (10 RPCs)
9  20260919090003_ci_api_grants                 api (grants)
10 20260919100001_ci_oauth_connection_foundation intel + supabase_vault(no-op) (+ flag creator_ig_connect=false)
11 20260919100002_ci_oauth_rpcs                 intel/api
12 20260919100003_ci_oauth_grants               api/intel (grants)
```
No baseline/legacy migration file exists; `DATABASE_SETUP.sql` is **not** represented as a migration;
no unrelated migration is mixed in. **Zero statements create/alter/drop/grant on any `public.` object**
(verified by grep; corroborated by the 0B.2 identical PRE/POST fingerprint).

## D. Verified Supabase CLI 2.117.0 first-push behaviour
From `db push --help` / `migration --help` (VERIFIED) + behaviour observed in 0B.1/0B.2 (marked):
- **A. Ledger absent →** `db push` **creates** `supabase_migrations.schema_migrations` on first push. *(VERIFIED behaviour of the push flow.)*
- **B. Object created:** the `supabase_migrations` schema + `schema_migrations` table. *(VERIFIED)*
- **C/D/E. Applies only migrations not in the remote history table, one file at a time, each in a transaction, recording each version after it succeeds.** *(VERIFIED — matches 0B.2 per-file `-1` apply.)*
- **F. If migration N fails:** its transaction rolls back; N is **not** recorded; push aborts. *(VERIFIED semantics.)*
- **G. Earlier successes retained/recorded** (1..N-1 committed + in ledger). *(VERIFIED)*
- **H. Does not inspect or recreate existing `public` objects** — it runs migration files verbatim. *(VERIFIED: migrations never touch public.)*
- **I. Executes only files missing from the ledger** (`--include-all` = "include all migrations not found on remote history table"). *(VERIFIED from help.)*
- **J/K. Does not infer state from schema contents; does not auto-baseline an existing schema.** *(VERIFIED — the ledger, not the schema, is the source of truth.)*
- **L. Never considers `DATABASE_SETUP.sql`.** *(VERIFIED — not a migration file.)*
- **M. `--include-all`:** include migrations missing from remote history even if out of sequence. Not needed here (all 12 are the initial set). *(VERIFIED from help.)*
- **N/O. `--dry-run`:** "Print the migrations that would be applied, but don't actually apply them" — a **read-only** preview (reads the remote history; applies nothing). *(VERIFIED from help.)*
- **P/Q. Connection:** `--linked` uses the Management-API path that **provisions a temporary login role** (observed in 0B.1 "Initialising login role…"); `--db-url <conn>` uses the **direct** connection with the supplied credentials (postgres) — no login-role provisioning. *(login-role on `--linked` = VERIFIED-observed; `--db-url` avoiding it = INFERENCE, confirm via `--dry-run` at execution.)*
- **R. Ledger creation can fail independently** of migration SQL (e.g., connectivity) — first push both creates the table and applies migration 1; a pre-migration-1 failure leaves no ledger. *(INFERENCE.)*
- **S. Interruption mid-run:** committed+recorded migrations persist; the in-flight one rolls back; re-running resumes from the first unrecorded version. *(VERIFIED semantics.)*
- **Vault:** "Vault secrets from config.toml are updated before migrations unless `--skip-vault`." `config.toml` defines **no** vault secrets, so this is a no-op; we pass `--skip-vault` as a safeguard. `supabase/roles.sql` and `supabase/seed.sql` **do not exist**, so `--include-roles`/`--include-seed` are irrelevant and omitted.

## E. Existing-production / no-ledger analysis
It is **technically valid and correct** for the first ledger entry to be `20260918090001`. Supabase
requires no baseline: `db push` creates the history table and applies exactly the files absent from it,
never inspecting existing `public`. The legacy schema legitimately stays outside the app ledger because
it predates migration management. No fabricated earlier migration is needed or desirable.

## F. Strategy comparison
| Strategy | Historical accuracy | Operational risk | Future maintainability | Verdict | Reason |
|---|---|---|---|---|---|
| **A. Direct first `db push` of the 12 CI migrations** | Truthful (management begins at CI) | Low (additive; public untouched; per-file txn) | High (Git == ledger from CI start) | **PREFERRED** | Official mechanism; 0B.2-proven; no fabrication |
| B. Baseline migration of legacy schema | Misleading (implies legacy was migrated) | Med–High (recreate-existing conflicts) | Med | NOT PREFERRED | Unneeded; risky; must special-case existing objects |
| C. `migration repair` to mark a historical baseline | False (marks unapplied SQL as applied) | Med | Low (Git≠prod truth) | **REJECT** | Fabricates history; not authorized |
| D. Manual psql apply + manipulate history | False/ambiguous | High | Low | **REJECT** | Bypasses CLI; ledger drift |
| E. Hand-create ledger before CLI | False | High | Low | **REJECT** | Fabrication |
| F. Empty "legacy predates" marker migration | Truthful but noisy | Low | Med | NOT PREFERRED | A governance **doc** records this better than a no-op migration |
| G. Any other official approach | — | — | — | — | None cleaner than A |

## G. Recommended migration-ledger strategy
**Strategy A** — first `supabase db push` applies exactly the 12 CI migrations, creating the ledger with
versions `20260918090001 … 20260919100003`. Legacy `public` remains intentionally outside the app
ledger (documented in governance, §W/§X). **Migration-ledger strategy: VERIFIED.**

## H. Legacy baseline decision
**Legacy baseline migration REQUIRED: NO.** Ledger validly starts at the first CI version. Governance
records that the legacy schema predates migration management (see §W).

## I. Migration-repair decision
`migration repair` "Repair the migration history table" — it **inserts/updates/deletes rows in
`schema_migrations`** to mark versions applied/reverted **without running SQL**. Using it here would
mark unapplied SQL as applied and create Git↔prod ambiguity. **Migration repair REQUIRED: NO.** Not to
be used.

## J. CLI vs direct-SQL decision
**Use the Supabase CLI `db push`.** It creates the ledger and records versions so future pushes stay
consistent; direct psql applies SQL but leaves no ledger (recreating today's problem). Recommend
`--db-url` (direct connection, no temporary login role) with the password supplied via `~/.pgpass`/env
(never chat), plus `--skip-vault`. `--linked` is acceptable but provisions a temporary login role (§K).

## K. Temporary login-role analysis
- **Occurs:** on `--linked` DB operations (observed in 0B.1). **Does not occur** with `--db-url`
  (direct connection). *(login-role-on-linked VERIFIED; db-url-avoids INFERENCE — confirm via dry-run.)*
- **What/when:** a short-lived CLI login role created via the Management API for the operation's
  connection; expected to be removed when the operation completes; privileges scoped to run the
  migrations. On failure it may linger and should be checked.
- **Alternative:** `--db-url` with a direct Postgres connection avoids it entirely — **recommended**,
  so the connection identity is fully understood and no transient role is provisioned.

## L. First-apply pre-flight (read-only; run at execution time, not now)
A) confirm ref `edibibytqfrrxfztukpm`; B) project `ACTIVE_HEALTHY`; C) on expected `main` commit;
D) clean `git status`; E) exactly the 12 migrations on disk; F/G) re-read ledger → still **absent**;
H) `intel/private/api` still absent; I) `pgcrypto`+`supabase_vault` present; J) fresh schema-only
snapshot; K) its SHA-256; L) fresh public fingerprint; M) equals `a4ec0fc6…770fd`; N) **no drift** vs
0B.1; O) confirm backup/PITR capability (§M); P) flags will default OFF (§Q); Q) `api` stays unexposed
(§R); R) Edge Functions **not** deployed in this step; S) no Meta credentials required; T) abort
conditions (any drift, ledger unexpectedly present, missing extension, snapshot mismatch, project not
healthy). Plus **`supabase db push --db-url <conn> --dry-run --skip-vault`** must list exactly the 12
versions and nothing else.

## M. Backup / recovery design
- **Supabase capability:** automated daily backups (plan-dependent); PITR is a paid add-on whose
  enabled-state is **UNKNOWN** without a dashboard read — confirm at execution. Do not rely on PITR
  unless confirmed.
- **Additional:** take a fresh **schema-only logical snapshot** (the 0B.1 artifact) as the pre-apply
  rollback reference; record its SHA-256 as the recovery point.
- **Modes:**
  - **A — migration fails before any CI data exists:** additive; roll back by dropping only the
    partially-created `intel`/`private`/`api` objects (or the whole isolated schemas) — **zero** effect
    on legacy `public`. Then diagnose and retry.
  - **B — migrations succeed, verification fails, flags still OFF (no CI data):** keep schemas, keep
    flags OFF, keep `api` unexposed; investigate; no destructive action needed (isolated + dark).
  - **C — dark foundation healthy:** retain; proceed to advisors (§V).
  - **D — later, real CI data exists:** **no `DROP SCHEMA` rollback**; disable flags + revoke `api`
    grants + keep unexposed (Architecture §27 Mode B); destructive teardown needs a separate DPO-approved
    data plan.

## N. Migration transaction / failure matrix
All 12 are **transactional** (no `CONCURRENTLY`; `create extension` runs in a txn). Each creates only
`intel`/`private`/`api` objects (+ `supabase_vault`/`pgcrypto` `if not exists` no-ops on prod). Seeds:
only migrations 7 (flag), 10 (provider config, scope map, app-scope, flag) — all `on conflict do
nothing`. RPC-body INSERTs are runtime-only (flag-gated), **not** applied at migration time.

| If it fails | Committed+recorded | Ledger | Retry safe? | Manual step? |
|---|---|---|---|---|
| 1 | none (ledger may not yet exist) | empty/absent | Yes (clean) | none |
| 2–6 | 1..N-1 | 1..N-1 | Yes (N re-runs clean; failed txn rolled back) | none |
| 7 (flags/helpers) | 1..6 | 1..6 | Yes | none |
| 8–9 (api) | 1..7 | 1..7 | Yes | none |
| 10 (oauth foundation/seeds) | 1..9 | 1..9 | Yes (seeds `on conflict do nothing`) | none |
| 11–12 (rpcs/grants) | 1..10/11 | 1..10/11 | Yes | none |
In every case legacy `public` is untouched and any not-yet-created flag reads fail-closed (helpers treat
a missing flag as OFF). Retry = re-run `db push` (resumes at the first unrecorded version). Verify §U
before retry.

## O. Seed / config review
| Seed (migration) | Classification |
|---|---|
| `ci_feature_flag('creator_profile_api', false)` (7) | **SAFE FOR DARK APPLY** (OFF) |
| `ci_feature_flag('creator_ig_connect', false)` (10) | **SAFE FOR DARK APPLY** (OFF) |
| `ci_scope_capability_map` 4 rows (10) | **SAFE** (static mapping; scope≠capability) |
| `ci_provider_config` (10): v21.0, 5 scopes, `client_id='__SET_VIA_CONFIG__'`, `redirect_uri='https://example.invalid/ig/callback'`, `notice-2026-09-18` | **SAFE PLACEHOLDER** for dark apply; **MUST CONFIGURE BEFORE LIVE OAUTH** (real client_id + redirect); Graph version **MUST VERIFY BEFORE LIVE** |
| `ci_app_scope_capability` 5 rows seeded `approved`/`2026-09-18` (10) | **EXTERNAL FACT MUST BE VERIFIED → see §P** |

## P. Meta approval seed finding
Migration 10 seeds all five scopes as `app_review_status='approved', approved_at='2026-09-18'`. The repo
holds **no evidence** of Meta App Review approval, and the canonical architecture explicitly marks every
scope **`documented-not-verified`** (§16) with Meta runtime verification a **HOLD** (§28). Seeding a
definitive `approved` with a specific date is therefore **semantically false / unverified** and
contradicts the architecture.
- While `creator_ig_connect=false`, these rows are **inert** — no OAuth/connection reads them for a live
  decision — so the **dark apply causes no live false claim** and is not itself unsafe.
- But the row is a latent correctness defect: when the flag is later enabled, capability gating would
  trust `approved` without a real check.

**Recommendation → HOLD — MIGRATION CORRECTION REQUIRED before first production apply.** Do **not** edit
the immutable, 0B.2-verified migration 10. Add a **new corrective migration**
`20260919100004_ci_app_scope_status_unverified.sql` that updates the five rows to
`app_review_status='documented-not-verified'`, `approved_at=NULL` (aligning with §16/§28), then re-run
the 0B.2 disposable compatibility test on the **13**-migration chain. This keeps the very first tracked
production state truthful. (If the business instead has real, documented Meta approval, the corrective
migration should set the true verified value + real date + evidence reference — but that external fact
must be produced first.)

## Q. Feature-flag proof
After apply: `creator_profile_api=false`, `creator_ig_connect=false` (only these two flags exist;
seeded false; `ci_feature_enabled` treats missing/false as OFF). Every `api` RPC calls
`ci_assert_api_enabled(...)` first → raises `0A000` while OFF. **Nothing is operational:** no
user-visible change, no legacy-path change, no ingestion (none built), no OAuth (start is flag-gated
OFF; callback is service_role-only and undeployed), no profile UI, no Meta call, no backfill. Nothing
activates automatically. **No BLOCKER.**

## R. API exposure proof
`config.toml` contains **no** Data-API schema-exposure config; `db push` does not change Data-API
settings. `intel`/`private`/`api` remain **unexposed** after apply (migration 1 also revokes
`usage` on all three from `anon`/`authenticated`). Exposure stays a **separate, later** decision — not
bundled here.

## S. Edge Function separation
First apply is **DATABASE FOUNDATION ONLY**. No `functions deploy` (ig-oauth-start/ig-oauth-callback stay
undeployed), no Meta secrets, no redirect registration, no frontend wiring, no live OAuth. Those follow
dark-DB verification + advisors in a later phase.

## T. Exact future apply command plan (DO NOT RUN NOW)
Connection uses `~/.pgpass`/env for the password (never printed). `<CONN>` =
`postgresql://postgres.edibibytqfrrxfztukpm@aws-0-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=require`
(percent-encoded; password from `~/.pgpass`).

**READ-ONLY PRE-FLIGHT**
```
supabase projects list                      # confirm ACTIVE_HEALTHY + ref
git status --short && git rev-parse HEAD     # clean tree, expected commit
ls supabase/migrations                       # exactly the intended set
pg_dump "<CONN>" --schema-only --no-owner -n public -n extensions -f /tmp/preflight_schema.sql
shasum -a 256 /tmp/preflight_schema.sql      # compare to 0B.1 baseline
supabase db push --db-url "<CONN>" --dry-run --skip-vault   # must list exactly the intended versions
```
**————— MUTATION BOUNDARY (requires separate explicit authorization) —————**
```
supabase db push --db-url "<CONN>" --skip-vault
```
**READ-ONLY POST-APPLY VERIFICATION** — see §U.
*(All flags verified against CLI 2.117.0 help; no invented flags. `--db-url` chosen to avoid the
`--linked` temporary login role.)*

## U. Post-apply verification plan (read-only)
A) `supabase_migrations.schema_migrations` exists; B) contains exactly the 12 (or 13 w/ corrective)
versions; C) no unexpected versions; D–F) `intel`/`private`/`api` exist; G) expected CI objects present
(intel 32 tables/11 fns, private 5, api 12 RPCs); H) public fingerprint == `a4ec0fc6…770fd`; I) public
table count 16; J) public function defs unchanged; K) public RLS/policies/grants unchanged; L) identity
types unchanged; M) `pgcrypto`+`supabase_vault` intact; N) both flags OFF; O) provider config still
placeholder (client_id `__SET_VIA_CONFIG__`, redirect `example.invalid`); P) `api` unexposed; Q)
`anon`/`authenticated` cannot select `intel`/`private` or use `vault`; R) `service_role` internal
privileges correct; S) `count(*)=0` in `intel.ci_creator_identity`/profile tables (no backfill); T)
`count(*)=0` in `intel.ci_platform_connection`/`ci_oauth_state` (no connections); U) no production user
behaviour changed. All via `information_schema`/`pg_catalog` (no row data).

## V. Advisor gate
After dark apply + §U passes: run **Supabase Security Advisor** and **Performance Advisor** against the
deployed schema (Management API / dashboard; read-only). Capture findings with level/category/object.
**Release-blocking:** any security ERROR (exposed `intel`/`private`, RLS-off reachable table,
`SECURITY DEFINER` without fixed `search_path`, PUBLIC-executable sensitive function). Performance ERRORs
→ investigate (accept documented low-risk with sign-off). Remediation via **new corrective migrations**
(never editing applied ones); re-run advisors after fixes, and **again if `api` is later exposed**.
`db lint` is **not** a substitute for advisors.

## W. Desired migration-ledger state after apply
`supabase_migrations.schema_migrations` = exactly the ordered CI versions `20260918090001 …
20260919100003` (or +`20260919100004` if the §P corrective migration is adopted). Legacy `public`
intentionally **not** represented. Governance note for future developers:
> *Bounty & Threads' legacy application schema predates Supabase migration management and was deployed
> via `DATABASE_SETUP.sql`. Formal, authoritative migration history begins with the Creator Intelligence
> foundation (`20260918090001`). The absence of earlier ledger rows is intentional and correct — it is
> not missing history to be "repaired."*
This is **valid and recommended**.

## X. Future migration governance
From the first successful apply onward: **every** production schema change is a versioned Supabase
migration; `DATABASE_SETUP.sql` becomes **historical/bootstrap reference only** and must not be re-run
against production; no ad-hoc SQL-editor DDL except a documented emergency procedure (which must be
back-filled as a migration); the ledger is authoritative from `20260918090001` forward. (A companion
`docs/PRODUCTION_SCHEMA_BASELINE.md` capturing ref, snapshot SHA `86ea0ee0…`, fingerprint `a4ec0fc6…`,
legacy origin, and "first tracked migration = 20260918090001" is recommended to be created **at
execution time**, not now.)

## Y. Remaining HOLDs
1. **§P Meta-approval seed** — corrective migration required before first apply (or documented real
   approval); then re-run 0B.2 on the extended chain.
2. **Advisors** — NOT RUN (post-dark-apply gate).
3. **PITR/backup capability** — confirm at execution (dashboard read).
4. **Provider config** — real `client_id`/redirect/Graph-version needed before live OAuth (not for dark
   apply).
5. **Migration-ledger governance doc / baseline doc** — author at execution time.
6. Standing later gates: `api` exposure decision, Edge deploy, legal notice copy/retention, ingestion.

## Z. Files / commit
This design document only. No migration/app/CI/remote change.

---

**PHASE 0B.3 DESIGN: VERIFIED**
**MIGRATION-LEDGER STRATEGY: VERIFIED** (Strategy A — direct first push; ledger starts at the CI version)
**DIRECT FIRST PUSH OF 12 CI MIGRATIONS: RECOMMENDED**
**LEGACY BASELINE MIGRATION REQUIRED: NO**
**MIGRATION REPAIR REQUIRED: NO**
**DARK REMOTE FOUNDATION APPLY PLAN: READY** (design complete)
**SAFE TO EXECUTE PHASE 0B.3 DARK APPLY: NO** — pending the §P app-scope-status corrective migration
(new `…100004`) + a 0B.2 re-verification of the extended chain.
**SAFE FOR PUBLIC RELEASE: NO**
