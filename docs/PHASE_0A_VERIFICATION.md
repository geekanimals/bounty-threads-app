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
