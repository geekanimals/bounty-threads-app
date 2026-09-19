# Phase 0B.2 Re-Verification — 13-Migration Chain (Phase 0B.3A)

**Type:** LOCAL / DISPOSABLE re-verification. No production contact, no remote mutation. Supersedes
nothing — the original `docs/PHASE_0B_2_COMPATIBILITY_VERIFICATION.md` remains truthful for the
**12-migration** chain it tested. This record covers the **13-migration** chain after the Phase 0B.3A
corrective migration.

## Reason re-verification was required
Phase 0B.3 identified a semantic defect: migration `20260919100001` seeded the five Instagram scopes in
`intel.ci_app_scope_capability` as `app_review_status='approved'` with a concrete `approved_at`,
asserting external Meta App Review approval that is **not externally verified** — contradicting the
architecture (`documented-not-verified`, §16; Meta verification a HOLD, §28). A new additive corrective
migration was written (the immutable prior migration was not edited), extending the chain to 13, which
requires a fresh compatibility proof against the actual production schema.

## Source snapshot (unchanged from 0B.1/0B.2)
- `/tmp/bounty_threads_phase0b_remote_schema.sql`
- **SHA-256 `86ea0ee082862c39cdc060aa472ec8dba9706aadedf604b99fedad59fff042fd`** — re-verified to match
  the recorded 0B.2 hash before use. No production reconnect.

## Corrective migration
`supabase/migrations/20260919100004_ci_meta_app_approval_status_correction.sql` — additive, `intel`-only,
zero `public` statements. For the five instagram/prod scopes it sets `app_review_status =
'documented-not-verified'`, `approved_at = NULL`, `last_verified_at = NULL`, and an `evidence` note that
Meta app approval is not externally verified. `app_review_status` is free-text (`not null default
'unknown'`, no CHECK), so `'documented-not-verified'` is valid data. It does not touch canonical scope
definitions, the scope→capability map, connection grants, capability switches, processing consent, or
feature flags.

## Semantic correction (exact)
`approved` (+ dated approval) → **`documented-not-verified` / `approved_at NULL` / `last_verified_at
NULL`**, meaning "scope documented/requested by architecture+config; Meta production app approval NOT
verified." **No function reads `ci_app_scope_capability`**, so the value cannot satisfy any live
eligibility gate today; the future four-part app-level gate (§14.1) must remain fail-closed.

## Disposable environment
No Docker → fresh local **Postgres 17.11** cluster (`initdb`, TCP `127.0.0.1`, `LC_ALL=C`) with the
documented harness (Supabase roles; `pgcrypto`/`uuid-ossp` in `extensions`; `auth` shim reading
`request.jwt.claims`; `supabase_vault` shim; pgTAP 1.3.3 built+installed). Databases `compat`/`comp9`.
Same approach as 0B.2; identical fidelity caveats (auth/vault are faithful shims; server 17.11 vs prod
17.6). Harness removed and cluster torn down on completion.

## 13-migration application (run 1)
Restore: only the 2 harmless `schema already exists` errors (harness-precreated), 0 on `public`.
PRE public fingerprint SHA-256 **`a4ec0fc646a3116c37a304bcf008b0ce77448e352fca8da41c75d52e740770fd`**.

| # | Migration | Result | Public changed? |
|---|---|---|---|
| 1–12 | `20260918090001 … 20260919100003` | OK | No |
| 13 | `20260919100004_ci_meta_app_approval_status_correction` | OK | No |

POST public fingerprint SHA-256 **`a4ec0fc6…770fd` — IDENTICAL to PRE**. Legacy `public` unchanged.
Corrected state confirmed: all five scopes `documented-not-verified`, `approved_at=NULL`.

## Regression (run 1)
| Suite | Assertions | Result |
|---|---|---|
| Phase 0A (`00`) | 104 | PASS |
| Phase 2B (`01`) | 45 | PASS |
| Phase 2C (`02`) | 52 | PASS |
| **Corrective (`03`, new)** | **15** | **PASS** |
| Coexistence (`tests-integration/01`, actual production schema) | 48 | PASS |
| **Foundation total (00–03)** | **216** | PASS |
| **Combined total** | **264** | **PASS** |

`not_ok=0` across all suites. (Prior 12-chain total was 249; the +15 corrective assertions raise the
combined total to **264** — the count increased because assertions were added, not held constant.)

## Deterministic replay (run 2)
Fresh DB `comp9` from the same snapshot → harness → restore → **all 13 migrations OK** → public
PRE==POST **identical, same SHA `a4ec0fc6…770fd`** → re-ran 0A (104), corrective (15), coexistence (48),
all `not_ok=0` → app-approval state `documented-not-verified`. **Deterministic.**

## db lint / Deno
- **db lint:** not runnable on the vanilla disposable cluster (needs Supabase-only `plpgsql_check`).
  Deferred to CI (`supabase db lint` in the foundation job) — must be "No schema errors found".
- **Deno OAuth tests:** DB-independent; not re-run locally (Deno absent). CI `edge-unit` job re-runs
  them (5) after this commit. Unaffected by the seed correction.

## Feature-flag proof
After the 13-chain: `creator_ig_connect=false`, `creator_profile_api=false` (asserted by the corrective
suite, cases H/H2). The corrective migration enables nothing.

## App-approval state
`app_review_status='documented-not-verified'`, `approved_at=NULL`, `last_verified_at=NULL` for all five
scopes; evidence documents "not-externally-verified". **TRUTHFUL.**

## Remaining HOLDs
1. **Real Meta App Review approval** — an external fact to be produced and recorded by a future
   migration with a real date + evidence before enabling `creator_ig_connect`.
2. **Advisors** — NOT RUN (post-dark-apply gate).
3. **db lint / Deno** — proven by CI on this commit (not locally).
4. Provider config real `client_id`/redirect/Graph-version before live OAuth; PITR/backup confirm at
   execution; governance/baseline docs at execution.

## Files
`supabase/migrations/20260919100004_…`, `supabase/tests/03_phase0b3a_app_approval_correction_test.sql`,
`.github/workflows/creator-intelligence-db.yml` (added the new test to the coexistence `pg_prove` list),
`docs/PHASE_0B_3_DARK_REMOTE_APPLICATION_PLAN.md` (12→13), and this record. No old migration, app code,
Edge Function, frontend, production config, or secret changed. Production snapshot not committed.

---

**META APP APPROVAL DEFAULT: TRUTHFUL**
**PHASE 0B.2 RE-VERIFICATION — 13 MIGRATIONS: VERIFIED**
**ACTUAL PRODUCTION SCHEMA + 13 CI MIGRATIONS: PASS**
**LEGACY PUBLIC SCHEMA PRESERVED: YES**
**ALL REGRESSION TESTS: PASS** (264/264 pgTAP; Deno via CI)
**MIGRATION-LEDGER STRATEGY: STILL VERIFIED**
**DARK REMOTE FOUNDATION APPLY PLAN: READY**
**SAFE TO SEEK EXPLICIT AUTHORIZATION FOR PHASE 0B.3 DARK APPLY: YES**
**SAFE FOR REMOTE MIGRATION APPLICATION: NO** (until authorized)
**SAFE FOR PUBLIC RELEASE: NO**
