# Phase 0A — Verification & Hardening

Companion to `docs/CREATOR_INTELLIGENCE_ARCHITECTURE.md`. Covers the legacy baseline strategy,
the dependency inventory, the migration-review findings/fixes, the two rollback modes, and the
verification status. **Design/implementation is dark and additive; nothing is applied to the
remote Supabase project.**

## 1. Legacy baseline strategy

The repo previously had no migration history — only `DATABASE_SETUP.sql` (run by hand in the SQL
editor). For deterministic local/CI verification we add a **legacy baseline migration**
`supabase/migrations/20250101000000_legacy_baseline.sql` — a **reviewed** copy of
`DATABASE_SETUP.sql`. On `supabase db reset` it builds the production-like schema **first**, then
the six additive Creator Intelligence migrations run on top (satisfying the "clean legacy baseline
followed by all six new migrations" gate).

Review of `DATABASE_SETUP.sql` before adopting it as a baseline:
- **No top-level data-dependent row INSERTs.** The only INSERTs are inside functions
  (`handle_new_user`, `apply_to_campaign`, `audit_trigger`, `admin_add_platform_admin`) plus one
  idempotent schema seed (`insert into storage.buckets ... on conflict do nothing`).
- **Fully idempotent** (16 `create table if not exists`, 27 `create or replace`, 48
  `drop policy if exists`).
- **Depends only on Supabase-provided objects**: `auth.users`, `auth.uid()`,
  `storage.{buckets,objects}`, roles `anon`/`authenticated`/`service_role`, extension `pgcrypto`.

**Caveats (explicit):**
- This is a **representative** baseline. It was **not** diffed against the live project — no
  Supabase CLI/credentials are available in this environment, so production drift is unverified.
  (No production **row data** was accessed or exported.)
- The six CI migrations were additionally hardened to be **self-contained** (the only prior hard
  dependency on the legacy schema — a FK to `public.campaigns` — was removed, §4). So `db reset`
  succeeds even without the baseline; the baseline is kept to verify **co-existence** on a realistic
  schema.
- **Do NOT `supabase db push` the baseline to the remote project** — the remote already has this
  schema. Before any remote use, the baseline must be marked already-applied
  (`supabase migration repair --status applied 20250101000000`) under a **separate approved plan**.
  That is out of scope here and was not performed.

## 2. Dependency inventory (what each migration requires)

| Migration | Requires (pre-existing) | Creates |
|---|---|---|
| `20250101000000_legacy_baseline` | `auth.users`, `auth.uid()`, `storage.{buckets,objects}`, roles `anon`/`authenticated`/`service_role`, `pgcrypto` | the legacy `public` app schema (members, campaigns, …) |
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

## 6. Verification status — HOLD (not yet VERIFIED)

Phase 0A **remains HOLD**. The six migrations + baseline + pgTAP are drafted and statically
reviewed, but **not executed**, because this environment has **no Docker, no Supabase CLI, no
`psql`, no local Postgres**. Per the rule "if a command cannot run, report it as NOT RUN; do not
mark Phase 0A verified," the following are **NOT RUN** locally:

- `supabase --version`, `supabase migration list --local` — **NOT RUN**
- `supabase db reset` (clean apply) — **NOT RUN**
- `supabase test db` (pgTAP) — **NOT RUN**
- `supabase db lint` / database advisors — **NOT RUN**
- TypeScript type generation — **NOT RUN**
- second `db reset` (deterministic replay) — **NOT RUN**

**Where verification happens:** the CI workflow `.github/workflows/creator-intelligence-db.yml`
runs all of the above on a **disposable** Supabase stack (GitHub-hosted Docker), with **no
production secrets** and **no remote connection** (no `link`/`push`/`repair`). Phase 0A becomes
**VERIFIED** only when that workflow passes on a run of this commit. Static checks that *were* done
locally: 30 `create table` across the CI migrations as expected, parenthesis balance per file, and
a full line-by-line review (findings in §3).

## 7. Remaining HOLD reasons

- **CI not yet executed** — needs a GitHub Actions run of the new workflow (Docker + CLI).
- **Production drift** of the legacy baseline unverified (no CLI/creds here).
- Standing later-phase gates unchanged: external-KMS review, final legal retention durations, Meta
  runtime capability verification, pgmq scale test.
