# Phase 0B.2 — Disposable Production-Schema Compatibility Test

**Scope:** LOCAL / DISPOSABLE ONLY. No production contact, no remote mutation, no `db push`,
no `--linked` DB commands. Proves the additive Creator Intelligence migration chain applies
cleanly against the **actual production legacy schema** and leaves `public` untouched.

**Verdict:** VERIFIED. Actual production schema + 12 CI migrations = clean additive application;
legacy `public` byte-identical PRE/POST; all 249 pgTAP assertions green (incl. 48 coexistence
against the real production structure); deterministic on replay.

---

## A. Source production snapshot
- Path (outside repo): `/tmp/bounty_threads_phase0b_remote_schema.sql`
- Size: **72,891 bytes**
- **SHA-256: `86ea0ee082862c39cdc060aa472ec8dba9706aadedf604b99fedad59fff042fd`**
- Produced by Phase 0B.1 via `pg_dump --schema-only --no-owner -n public -n extensions`.

## B. Snapshot object counts / safety
16 `public` tables · 40 policies · 151 GRANTs · 0 `COPY … FROM stdin` · 0 `INSERT INTO` ·
0 `intel/private/api` references · 0 connection URIs. The only `secret`-keyword match is the
column definition `access_token text` in `public.social_tokens` (schema, not a value). Schema-only,
no row data, no credentials.

## C. Disposable environment
- **No Docker available** (so `supabase db start` / the real Supabase stack could not be used).
- A fresh **local Postgres 17.11 (Homebrew) cluster** was `initdb`-created under the session
  scratchpad, started on `127.0.0.1:54999` (TCP only, `unix_socket_directories=''`, `LC_ALL=C`).
- Two disposable databases: `compat` (primary run) and `compat2` (deterministic replay).
- **Documented harness** recreating Supabase platform prerequisites a vanilla cluster lacks
  (sanctioned as harness-only tooling; no migration SQL was altered):
  - Roles: `anon`, `authenticated`, `service_role` (+ NOLOGIN stubs `supabase_admin`,
    `dashboard_user`, `supabase_functions_admin`, `authenticator`, …) so production GRANTs resolve.
  - `extensions` schema with **`pgcrypto` and `uuid-ossp` installed *in* `extensions`** — mirrors
    production (pgcrypto 1.3 in `extensions`), so migration 1's `create extension if not exists
    pgcrypto` is a no-op exactly as in prod.
  - `auth` shim: `auth.users` + `auth.uid()/role()/jwt()` reading `request.jwt.claims`
    (Supabase semantics — the suites set the claim to simulate callers).
  - **`supabase_vault` SHIM extension** (a local test double): provides the `vault` schema and
    `vault.create_secret(text,text,text) → uuid` with the real signature. It is **not** the real
    pgsodium-backed extension; it is sufficient because the only asserted vault properties are
    *(a)* `create_secret` returns a non-token reference and *(b)* `anon`/`authenticated` lack
    `vault` USAGE — both are properties of the migration SQL, executed identically here.
  - Stub schemas (`graphql`, `graphql_public`, `net`, `pgsodium`, …) to absorb platform references
    from the dump; **none are `public` app objects**.
- **Fidelity caveat:** `auth`/`vault` are faithful shims, not the real Supabase C extensions. The
  security assertions under test (grants, RLS, `REVOKE … FROM PUBLIC`, `SECURITY DEFINER`
  `search_path`, scope→capability) are properties of the migration SQL and run byte-identically to
  the CI stack. The real-platform run of these same migrations is already **GREEN in CI**
  (`docs/PHASE_0A_VERIFICATION.md`, run `35425572631`).

## D. Tool versions
- `psql` / `pg_dump` / `initdb` / `postgres`: **17.11** (Homebrew).
- Disposable server: **PostgreSQL 17.11**. Production: **17.6** — a patch/minor difference, disclosed,
  not material to schema application.
- Supabase CLI: **2.117.0** (used only for the `db lint` attempt; not for any `--linked` DB command).
- pgTAP: **1.3.3** (downloaded, `make`/`make install` — pure SQL, no C).

## E. Production schema restore
Restored the snapshot into `compat` after loading the harness. **Only 2 errors, both harmless**
(`schema "public" already exists`, `schema "extensions" already exists` — pre-created by the
harness). **Zero errors on any `public` app object.** All **16** production tables materialized
with their columns, constraints, indexes, RLS, policies and grants. Each non-app statement was
classified: platform boilerplate (pg_graphql/pg_net/pgsodium) is EXPECTED-PLATFORM and irrelevant to
the app `public` schema, which depends only on `auth` + roles + `pgcrypto`.

## F. Pre-migration public baseline (normalized fingerprint)
641 lines — **16 tables · 182 columns · 23 constraints · 21 indexes · 27 functions · 40 policies ·
332 role-grant rows** (anon/authenticated/service_role). **SHA-256: `a4ec0fc646a3116c37a304bcf008b0ce77448e352fca8da41c75d52e740770fd`**.

## G. Migration chain (chronological, 12)
| # | Migration | Intended schemas | Result |
|---|---|---|---|
| 1 | 20260918090001_ci_schemas_roles_helpers | intel/private/api | OK |
| 2 | 20260918090002_ci_identity_foundation | intel | OK |
| 3 | 20260918090003_ci_profile_private | private | OK |
| 4 | 20260918090004_ci_profile_professional | intel | OK |
| 5 | 20260918090005_ci_control_foundation | intel | OK |
| 6 | 20260918090006_ci_rls_grants | intel/private | OK |
| 7 | 20260919090001_ci_feature_flags_and_api_helpers | intel | OK |
| 8 | 20260919090002_ci_profile_api | api | OK |
| 9 | 20260919090003_ci_api_grants | api | OK |
| 10 | 20260919100001_ci_oauth_connection_foundation | intel + vault ext | OK |
| 11 | 20260919100002_ci_oauth_rpcs | intel/api + vault | OK |
| 12 | 20260919100003_ci_oauth_grants | api/intel | OK |

**All 12 applied cleanly, in order, each in its own transaction (`-1 ON_ERROR_STOP=1`).**

## H. Post-migration public regression
Re-captured the same fingerprint. **SHA-256: `a4ec0fc6…740770fd` — IDENTICAL to PRE.** `diff PRE POST`
is **empty**. **The 12 CI migrations make zero executable changes to the legacy `public` schema**
(tables, columns, constraints, indexes, functions, RLS, policies, grants all unchanged).

## I. Creator Intelligence object verification
Schemas `intel`, `private`, `api` created. **intel: 32 tables, 11 functions; private: 5 tables;
api: 12 functions** (`creator_profile_api_enabled, get_my_profile_draft, get_professional_profile,
save_profile_section, upsert_address, delete_address, upsert_skill, upsert_brand_experience,
upsert_dream_brand, save_rate_card_item, ig_connect_start, get_my_connections`). 5 append-only event
ledgers present. Key objects confirmed present: `intel.ci_creator_identity`,
`intel.ci_platform_connection`, `intel.ci_oauth_state`, `private.creator_contact`,
`api.ig_connect_start`, `intel.ci_ig_complete_connection`. **Feature flags OFF:**
`creator_ig_connect=false`, `creator_profile_api=false`.

## J. Grants / RLS / privileges
- `anon` → `intel.ci_creator_identity` SELECT = **false**
- `authenticated` → `private.creator_contact` SELECT = **false**
- `anon` / `authenticated` → `vault` USAGE = **false**
- `authenticated` → `api.ig_connect_start` EXECUTE = **true**; `anon` = **false**
- Legacy public grants: **unchanged** (proven by the identical PRE/POST fingerprint, which includes
  the 332 role-grant rows).

## K. Phase 0A tests — **Files=1, Tests=104, PASS** (not_ok=0)
## L. Phase 2B tests — **Files=1, Tests=45, PASS** (not_ok=0)
## M. Phase 2C tests — **Files=1, Tests=52, PASS** (not_ok=0)
## N. Deno OAuth tests — **NOT re-run locally** (Deno absent). These are DB-independent Meta-boundary
mocks (`supabase/functions/_shared/meta_oauth_test.ts`); they do not touch the production schema, so
re-running adds nothing to this compatibility proof. Historically **5 PASS** in CI.

## O. Production-schema coexistence tests — **Files=1, Tests=48, PASS** (not_ok=0)
Run against the **actual restored production `public` schema** (not the fixture) + all 12 CI
migrations. This is the substantive upgrade over the earlier fixture-based coexistence proof.

## P. Test totals
| Suite | Expected | Actual | Result |
|---|---|---|---|
| Phase 0A | 104 | 104 | PASS |
| Phase 2B | 45 | 45 | PASS |
| Phase 2C | 52 | 52 | PASS |
| **Foundation** | **201** | **201** | PASS |
| Coexistence (prod schema) | 48 | 48 | PASS |
| **Combined** | **249** | **249** | PASS |
| Deno | 5 | (not re-run; green in CI) | — |

## Q. db lint
**NOT runnable on the disposable cluster** — `supabase db lint` requires the Supabase-only
`plpgsql_check` extension (`extension "plpgsql_check" is not available`), which vanilla local Postgres
lacks. The identical migrations previously linted clean ("No schema errors found") in CI on the real
platform (Phase 0A/2B/2C verification). Not re-provable locally without that extension.

## R. Deterministic replay
`compat2` dropped and recreated from the **same** snapshot → harness → restore (same 2 harmless
errors) → 12/12 migrations OK → **public PRE==POST identical, SHA `a4ec0fc6…740770fd` (same as run 1)**
→ suites re-run: 0A **104**, 2C **52**, coexistence **48**, all `not_ok=0`. Fully deterministic.

## S. Disposable migration-ledger result
Migrations were applied via raw `psql -f` (not the Supabase CLI runner), so
`supabase_migrations.schema_migrations` is **ABSENT** in the disposable DB. This mirrors production
(which also has no app ledger) and is **informational only** — it does **not** model a first
`supabase db push`. **The production first-apply / ledger strategy is deferred to Phase 0B.3** and
must not use `migration repair`.

## T. Production-only public function preservation
The production **public app function set matches `DATABASE_SETUP.sql` exactly** (27 vs 27; empty diff
both directions). The earlier 0B.1 "extra functions" observation was a *counting artifact* of the raw
dump (which includes `extensions`-schema platform functions like `grant_pg_graphql_access` and
overloaded signatures), **not** `public` app drift. All public functions are preserved unchanged by
the CI chain (identical PRE/POST fingerprint). No `DATABASE_SETUP.sql` change required.

## U. CI / automation decision
**Keep this as a LOCAL audited compatibility test.** The production snapshot is **not** committed
(§28). It contains no rows/secrets, but the default (§29) is local unless a sanitized fixture strategy
is adopted; the existing `tests-integration/fixtures/legacy_schema.sql` already provides the committed,
CI-run coexistence fixture. No production credentials and no production schema dump are added to CI.

## V. Remaining HOLDs
1. **Production migration-ledger strategy** — prod has no ledger; first-apply design is a **0B.3**
   task (no `migration repair`).
2. **Security/performance advisors — NOT RUN** (require the real linked/branch platform).
3. **db lint & Deno** re-run belong on the real platform (both already green in CI); not locally
   reproducible (plpgsql_check / Deno absent).
4. **Shim fidelity** — `auth`/`vault` are faithful test doubles, not the Supabase C extensions; the
   real-platform proof is the CI run. Server is 17.11 vs production 17.6 (patch-level).

## W. Files changed
None in application code or migrations. Harness (roles/auth/vault-shim/pgTAP install, cluster, dumps)
lives entirely in the session scratchpad and the local Homebrew toolchain and is removed on cleanup.
Only this verification document is added to the repo.

## X. Next phase
**Phase 0B.3 — Dark Remote Foundation Application Plan (design-first, no execution).** It must first
design the safe first-apply / migration-ledger strategy given that production has legacy schema but no
app ledger: legacy `public` must not be recreated; the 12 CI migrations are genuinely new; the first
remote application must not imply `DATABASE_SETUP.sql` was applied as a migration; no `migration
repair` unless separately justified and approved.

---

**PHASE 0B.2 DISPOSABLE COMPATIBILITY TEST: VERIFIED**
**ACTUAL PRODUCTION SCHEMA + 12 CI MIGRATIONS: PASS**
**LEGACY PUBLIC SCHEMA PRESERVED: YES**
**ALL REGRESSION TESTS: PASS** (249/249 pgTAP; Deno deferred, green in CI)
**MIGRATION-LEDGER STRATEGY FOR PRODUCTION: STILL REQUIRED**
**SAFE TO DESIGN PHASE 0B.3: YES**
**SAFE FOR REMOTE MIGRATION APPLICATION: NO**
**SAFE FOR PUBLIC RELEASE: NO**
