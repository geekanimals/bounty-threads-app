# Phase 0A — Verification & Hardening

Companion to `docs/CREATOR_INTELLIGENCE_ARCHITECTURE.md`. Covers the legacy baseline strategy,
the dependency inventory, the migration-review findings/fixes, the two rollback modes, and the
verification status. **Design/implementation is dark and additive; nothing is applied to the
remote Supabase project.**

## 1. Legacy baseline strategy

The repo previously had no migration history — only `DATABASE_SETUP.sql` (run by hand in the SQL
editor). We first tried a **legacy baseline migration** (a reviewed copy of `DATABASE_SETUP.sql`)
so `supabase db reset` would build the production-like schema before the six CI migrations.

**The first CI run rejected that approach** with a real finding (P8): `DATABASE_SETUP.sql` is **not
clean-apply-safe.** It defines SQL-language functions (`my_applications()`,
`campaign_applications()`) that reference `public.applications` **before** that table is created
later in the same file. It only ever succeeded because it was re-run *idempotently over an
already-populated database*; a truly clean apply fails with
`relation "public.applications" does not exist (SQLSTATE 42P01)`.

**Adopted strategy:** the six CI migrations were hardened to be **fully self-contained** (their only
prior dependency on the legacy schema — a FK to `public.campaigns` — was removed, P1). They depend
only on objects the Supabase local stack provides: `auth.users`, roles
`anon`/`authenticated`/`service_role`, and `pgcrypto`. So **`supabase db reset` applies the six CI
migrations on a clean database with no legacy schema at all**, and CI verifies them directly. The
legacy baseline migration was **removed** — we do not bake a latent ordering bug into migration
history.

**Legacy co-existence is deferred, not lost.** Verifying "legacy schema + the six CI migrations
together" requires `DATABASE_SETUP.sql` to be made clean-apply-safe first (reorder: create the
`applications`/`campaigns` tables before the SQL functions that reference them, or convert those
functions to `plpgsql` whose bodies are not resolved at create time). That reorder touches the
legacy setup file and is tracked as a **separate follow-up** (P8) — it is **out of scope** for this
dark-foundation pass and was not performed. Production is unaffected (its schema was built
incrementally and already exists).

**No production access:** the environment has no Supabase CLI/credentials; the legacy file was not
diffed against the live project and **no production row data was accessed or exported**.

## 2. Dependency inventory (what each migration requires)

| Migration | Requires (pre-existing) | Creates |
|---|---|---|
| `…090001_ci_schemas_roles_helpers` | `pgcrypto`; roles `anon`/`authenticated`/`service_role` | schemas `intel`/`private`/`api`; helper fns `tg_set_updated_at`, `tg_block_mutation` |
| `…090002_ci_identity_foundation` | `intel` schema; `auth.users` (FKs); helper fns | identity/account/connection/actor/org/merge/link tables |
| `…090003_ci_profile_private` | `intel.ci_creator_identity`; `private` schema; `auth.users` | private personal/contact/address/provenance/edit-event |
| `…090004_ci_profile_professional` | `intel.ci_creator_identity`, `intel.ci_platform_account`; `auth.users` | professional profile/skills/resources/brand/experience/prefs/rate-card(+item)/aspiration/provenance/completion. **`campaign_id` is a soft ref — no FK to `public.campaigns`.** |
| `…090005_ci_control_foundation` | `intel.ci_creator_identity`, `ci_platform_connection`, `ci_identity_platform_account`; `auth.users` | app-scope/scope-grant/capability/consent/visibility + 3 append-only event ledgers |
| `…090006_ci_rls_grants` | all `intel`/`private` tables; roles | RLS enable + least-privilege grants (service_role) |

**Net external dependencies of the six CI migrations:** `auth.users`, roles
`anon`/`authenticated`/`service_role`, and `pgcrypto` — **all provided by the Supabase local
stack**. No hard dependency on the legacy `public` schema remains.

## 3. Migration-review findings on commit `35f6460` and fixes

| # | Finding | Severity | Fix |
|---|---|---|---|
| P1 | `ci_creator_brand_experience.campaign_id` had a **hard FK to `public.campaigns`** → clean reset fails without the legacy schema; couples `intel`→`public` | **High** | Removed the FK; `campaign_id` is a documented **soft reference** validated at write time in later phases |
| P2 | Migrations used `create table/index if not exists` → can **mask schema drift** and don't assert a known baseline | Med | Removed `IF NOT EXISTS` from all tables/indexes (kept only on `create schema`/`create extension`) |
| P3 | No **append-only event history** for capability/consent/visibility changes | Med | Added `ci_capability_switch_event`, `ci_processing_consent_event`, `ci_profile_visibility_event` (state/version only, no PII, block-mutation trigger) |
| P4 | Missing **indexes** on several FK/join columns | Med | Added indexes: connection `supersedes`/`authorised_by`, org-rel `assigned_manager`, link `identity_id`, brand-experience `brand_id`/`campaign_id`, aspiration `brand_id`, rate-card `platform_account_id`, brand `parent_brand_id`, event-table `identity_id`s |
| P5 | Helper trigger functions had **no fixed `search_path`** and were **executable by PUBLIC** | Med | Added `set search_path = pg_catalog`; `revoke all … from public, anon, authenticated`; `alter default privileges … revoke execute on functions from public` |
| P6 | Private `creator_profile_edit_event` stored **raw old/new PII values** | Med | Renamed to `old_value_hash`/`new_value_hash` — one-way hash / opaque ref only, never raw PII |
| P7 | Rollback was described only as "drop schema cascade" (destructive after data) | Low | Documented **two rollback modes** (§5) and corrected the architecture doc |
| P8 | **`DATABASE_SETUP.sql` is not clean-apply-safe** — SQL functions `my_applications()`/`campaign_applications()` reference `public.applications` before it is created; a clean `db reset` fails (`42P01`). Found by the **first CI run**, not statically. | **High** (legacy) | Removed the legacy baseline migration; CI verifies the self-contained CI migrations directly. Making the legacy file clean-apply-safe (reorder / use `plpgsql`) is a **deferred follow-up** that touches the legacy setup file — out of scope for the dark foundation, production unaffected. |

No incompatible FK types were found (all uuid↔uuid; `member_id`→`auth.users.id`). Partial-unique
constraints (one active connection; one default active address; unique active dream-brand rank)
were reviewed and are correct. RLS is enabled on **every** `intel`/`private` table via the 0006
sweep (which runs after the event tables are created in 0005).

## 4. Consent & control audit (event history)

Three append-only ledgers were added (current-state tables retained for efficient reads). Each row
records: `identity_id`, acting member, authority/evidence (where applicable), **previous state**,
**new state**, notice/version, purpose-or-capability, timestamp, reason/source. Rows are immutable
(UPDATE/DELETE blocked by `intel.tg_block_mutation`). They store **state/version only** — never
tokens, message content, addresses, phone, email or DOB (asserted by pgTAP `hasnt_column` tests).

## 5. Rollback — two modes

**Mode A — before any real data collection (isolated teardown).**
Disable the Phase-0A/0B feature flags. If removal is desired, drop the isolated new schemas:
`drop schema api cascade; drop schema private cascade; drop schema intel cascade;`
No backfill was performed, so this has **zero** effect on legacy `public` data. This is the only
mode in which destructive teardown is acceptable.

**Mode B — after any real personal/intelligence data exists (non-destructive).**
Do **not** drop schemas. Instead: turn off feature flags; stop ingestion workers; keep the `api`
schema unexposed and revoke any RPC grants — i.e. disable reads/workers/API exposure while
**retaining tables and data**. Any destructive schema deletion then requires a **separate approved
data-retention and migration plan** (export + legal/DPO review + change-controlled drop), because
personal data and legally-retained records are involved. Schema teardown is **not** the production
rollback once data exists.

## 6. Verification status — the dark foundation is VERIFIED (by CI)

This environment has **no Docker, no Supabase CLI, no `psql`, no local Postgres**, so nothing ran
locally. Verification runs in the **CI workflow** `.github/workflows/creator-intelligence-db.yml`
on a **disposable** Supabase stack (GitHub-hosted Docker) with **no production secrets** and **no
remote connection** (no `link`/`push`/`repair`).

**CI run history for this pass:**
- **Run 1** (`35328022109`, commit `3a63c13`) — **FAIL** at `db start`; surfaced **P8** (the legacy
  baseline is not clean-apply-safe). Fixed by removing the baseline migration + its two pgTAP
  assertions and simplifying the workflow.
- **Run 2** (`35328653370`, commit `146b4b6`) — **PASS, all steps green:**
  - `supabase --version` → v2.33.9 (pinned) ✓
  - `supabase migration list --local` ✓
  - `supabase db reset` (clean apply of the six CI migrations, no legacy schema) ✓
  - `supabase test db` → **`Files=1, Tests=90, Result: PASS`** ("All tests successful") ✓
  - `supabase db lint --level warning` → **"No schema errors found"** (api, extensions, intel,
    private, public) ✓
  - `supabase gen types typescript --local` (schema coherence, non-blocking) ✓
  - `supabase db reset` again (**deterministic replay**) ✓

**The Phase-0A dark database foundation is VERIFIED**: it applies cleanly from an empty database,
all 90 pgTAP assertions pass (schemas/tables/constraints/RLS/append-only/no-PII/index/privilege),
the schema lints clean, and replay is deterministic.

## 7. Remaining HOLD items (none block the dark foundation)

- **Legacy co-existence deferred** — reproducing "legacy schema + the six CI migrations together"
  needs `DATABASE_SETUP.sql` made clean-apply-safe first (P8 follow-up); not attempted here.
- **Production drift** of the legacy schema unverified (no CLI/creds here; no row data accessed).
- Standing **later-phase** gates (not Phase-0A blockers): external-KMS review, final legal retention
  durations, Meta runtime capability verification, pgmq scale test.
- **Remote application not done and not in scope** — no `db push`/`repair`; the remote project is
  untouched. Applying Phase 0A to production is a separate, explicitly-approved step.

> **Update (Prompt 2A-I):** legacy coexistence has since been **VERIFIED** by CI (Part II below);
> the "co-existence deferred" line above is superseded — reproducing it as a *numbered migration*
> (vs the test fixture) is what remains deferred.

---

# Part II — Legacy coexistence & production-compatibility (Prompt 2A-I)

## 8. Toolchain update

Pinned Supabase CLI **v2.117.0** (current stable at 2026-09-19; v2.118.x are betas). CI now runs
`actions/setup-node@v4` (Node 22) and a **capability-discovery** step (`supabase --version`,
`--help`, `db --help`, `test --help`) so we don't assume older syntax. Foundation tests re-run
green under v2.117.0 (see §15).

## 9. PII audit-log correction

`private.creator_profile_edit_event` was redesigned to **metadata-only** — it records *that* a
field changed, never a value and **never a plain/unsalted value hash** (phone/email/DOB/postal/
address are low-entropy and trivially reversible, so a plain hash is treated as PII). Columns now:
`event_id, identity_id, record_table, record_id, field_key, operation(created|changed|cleared),
acting_member_id, authority_source, reason, correlation_id, occurred_at`. It is append-only.
Value-change vs no-op is decided **server-side** before writing and reflected in `operation`. If a
value-comparison fingerprint is ever required it must be a **keyed HMAC** computed server-side with
a rotatable secret held outside any browser-reachable table (never a plain hash here) — documented
in the migration; not implemented. pgTAP proves the table has no `old_value`/`new_value`/
`*_value_hash`/phone/email/DOB/postal columns and that `operation` is constrained.

## 10. Legacy fixture & corrections

`supabase/tests-integration/fixtures/legacy_schema.sql` reconstructs the existing Geek schema on an
empty DB for the coexistence job. **Production `DATABASE_SETUP.sql` is unchanged.** Corrections made
in the fixture only:

| Correction | Class | Detail |
|---|---|---|
| Relocated `my_applications()` and `campaign_applications()` to **after** `public.applications` | **Ordering-only** | Both are `language sql` (body resolved at CREATE); defined before the table they read, a clean apply fails `42P01`. |

No syntax corrections, no obsolete-statement removals, and **no substantive behaviour changes**
(same functions, grants, RLS/authorization semantics). No demo/row seed exists to separate; the only
INSERT is the idempotent `storage.buckets` infra seed required by the storage policies. **No HOLD.**

## 11. Existing identity/type compatibility matrix (verified, not assumed)

| Object | Type | Relationship |
|---|---|---|
| `auth.users.id` | `uuid` | root auth identity |
| `public.members.id` | `uuid` | **PK that references `auth.users(id)`** → **identical** to the auth user id (1:1) |
| `public.members.org_id` | `uuid` | org identifier (not null, no FK — org is implicit) |
| `public.social_accounts.member_id` | `uuid` | **references `auth.users(id)`** → identical to the auth user id |
| `public.social_accounts.ig_user_id` | `text` | stable Instagram user id |
| `public.campaigns.id` | `uuid` | campaign id |
| `intel.ci_creator_identity.identity_id` | `uuid` | NEW canonical human id (unlinked in Phase 0A) |
| `intel.ci_identity_actor_access.member_id` | `uuid` → `auth.users(id)` | operator link |
| `intel.ci_platform_account.platform_user_id` | `text` | maps to `social_accounts.ig_user_id` (text↔text ✓) |
| `intel.…brand_experience.campaign_id` | `uuid` (soft ref) | maps to `campaigns.id` (uuid↔uuid ✓) |

**`member_id` vs `auth.users.id`: identical, verified from the schema** — `members.id` is a primary
key defined `references auth.users(id)`, and `social_accounts.member_id references auth.users(id)`.
So "member_id" across the legacy app **is** the auth user id (not merely related). All new UUID/FK
types are compatible with the legacy types; `platform_user_id text` matches `ig_user_id text`.

**Future mapping plan (NO backfill performed):**
`auth.users` → `public.members` (id == id) → `intel.ci_identity_actor_access` (`member_id`,
`access_role='self'`) → `intel.ci_creator_identity` → `intel.ci_identity_platform_account` →
`intel.ci_platform_account` (`platform_user_id` = `social_accounts.ig_user_id`). Backfill is a later
phase and is not started.

## 12. Public grants / RLS — before vs after

The six CI migrations contain **no statement referencing any legacy `public`-schema object** (the
only `public.` occurrences are comments; every `grant`/`revoke`/`alter default privileges` targets
`intel`/`private`/`api`, their functions, and the PUBLIC pseudo-role / `anon`/`authenticated`/
`service_role`). Therefore **all existing `public` grants, RLS policies, and role access are
unchanged by construction.** The coexistence job asserts this live: `public.{members,campaigns,
social_accounts,applications}` still have RLS enabled and policies present, `authenticated` retains
`SELECT` on `public.members`, `anon`/`authenticated` gain **no** access to `intel`/`private`, and
`service_role` remains the only reachable role for the internal schemas — all green.

## 13. Advisors

`supabase db lint --level warning` → **"No schema errors found"** (api/extensions/intel/private/
public). **`db lint` is NOT the security/performance advisors.** Those **require a linked (remote)
project** and cannot run on a purely local stack; they were **NOT RUN** (and must not use production
credentials in CI). They remain a gate for the eventual linked-project review.

## 14. Production drift — NOT VERIFIED

No Supabase CLI/credentials are available here and production credentials must not be placed in
GitHub Actions, so migration status / schema-only metadata / structure comparison against
`DATABASE_SETUP.sql` were **NOT performed**. Production drift is **NOT VERIFIED**. (No production row
data accessed; nothing applied; no `db push`/`repair`.)

## 15. Coexistence CI results & rollback

CI run `35420059599` (commit `20252cc`) — **both jobs green**:
- **foundation** — `db reset` → `supabase test db` **Files=1, Tests=104, Result: PASS** → lint clean
  → type-gen → deterministic replay. (CLI v2.117.0 confirmed in-log.)
- **legacy-coexistence** — legacy fixture applied FIRST, then the six CI migrations, then `pg_prove`
  over foundation + coexistence tests: **Files=2, Tests=152, Result: PASS** (104 foundation + 48
  coexistence).

**Rollback confirmed:** Creator Intelligence can be disabled/removed by acting only on
`intel`/`private`/`api`; the coexistence tests prove the legacy `public` schema is fully intact
after the migrations. Modes A/B per §5 stand; **no `DROP SCHEMA` rollback once real Creator
Intelligence data exists.**

## 16. Final status

- **PHASE 0A CORE: VERIFIED** (foundation job green; 104 pgTAP; deterministic replay; lint clean).
- **LEGACY COEXISTENCE: VERIFIED** (coexistence job green; legacy + CI migrations in production
  direction; 152 combined pgTAP; legacy public objects/RLS/grants intact; new schemas isolated).
- **SAFE TO BEGIN PHASE 2B: YES** (foundation + coexistence verified; 2B is additive in the `api`
  schema) — with two conditions gating any *remote* application (not local/dark work):
  production-drift verification and the security/performance advisors on a linked project. Phase 2B
  is **not** started in this pass.

**Remaining HOLDs:** production drift NOT VERIFIED (§14); security/performance advisors NOT RUN
(§13); legacy co-existence *as a numbered migration* deferred (the fixture is a test artifact, not a
migration — making `DATABASE_SETUP.sql` itself clean-apply-safe is a separate follow-up); standing
later-phase gates (external-KMS, legal retention durations, Meta runtime capability, pgmq scale).
