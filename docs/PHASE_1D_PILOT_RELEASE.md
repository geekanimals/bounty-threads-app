# Creator Intelligence Pilot — Release Report & Activation Runbook

**Branch:** `creator-intelligence/pilot-integration` (off `phase-1d-serving`). **Production: unchanged**
(`main` = 21 migrations, flags off). This report is the release package; activation is a single reviewable
decision at the end (§8).

---

## 1. Phase 1C / 1D / 1E status (evidence)

| Phase | Implemented | Tested | Merged to `main` | In production | Activated |
|---|---|---|---|---|---|
| **1A+1B** creator profile + IG OAuth/ingestion | ✅ | ✅ | ✅ `8c4f85d` | ✅ (21 migrations) | ❌ flags off |
| **1C** feature store (6 measures, provenance) | ✅ `f231b92` | ✅ 41 pgTAP | ❌ | ❌ | ❌ |
| **1D** serving + explainable matching + `intelligence.js` | ✅ `13101ea`, `a6ac132` | ✅ 51 pgTAP (CI run `35826812362` green) | ❌ | ❌ | ❌ |
| **1E** campaign import | design only (`docs/PHASE_1E_…`) | — | ❌ | ❌ | ❌ |

- `origin/main` HEAD `8c4f85d`, **21 migrations** — matches the reported production baseline. 1C/1D are pushed
  feature branches, **not merged, not migrated, not activated**. Verified from git; no open PRs.
- **The full pilot stack already exists as code** on `phase-1d-serving` (main + 1C + 1D = **24 migrations**).
  The pilot integration branch adds only a brand **side-by-side comparison** UI (no schema/backend change).
- **Live production flag/Edge-deploy state could not be introspected from this session** (no Supabase access
  token; no production changes permitted). Confirm on the Supabase dashboard — inferred-off from git.

## 2. What I implemented this pass

- **Brand side-by-side comparison** (`intelligence.js` + `styles.css`): after a brief match, the brand ticks
  creators into a shortlist and compares them across match reasons, missing signals, performance status,
  confidence band, audience marginals (top country/city, freshness), reliability, fraud, coverage, confidence.
  It composes the **existing authorised** `get_creator_intelligence` payloads — no new data source, no ranking,
  no score; blanks render as their real status, never zero. Flag-gated/dark like the rest.
- **End-to-end journey proof** at the data layer on a disposable PG17 cluster (24 migrations), and the full
  pgTAP suite re-run green.

## 3. Exact user journey (verified end-to-end at the data layer)

1. **Creator signs in → `bootstrap_my_profile`** creates the identity + prefilled profile shell.
2. **Connect Instagram once** (`ig_connect_start` → Meta consent → `ci_ig_complete_connection`). A **partial
   grant** (basic only) records `granted_scopes:["instagram_business_basic"]`; a **reconnect** records the full
   scope set. Scopes stored as actually granted.
3. **Ingestion → `ci_compute_features`** produces the feature run.
4. **Creator intelligence** (`get_my_creator_intelligence`): sourced format-specific REELS engagement
   (available), **audience country/city/age as separate marginals** ("marginal only; not a joint
   intersection"), gender `insufficient_audience` (**not zeroed**), freshness `fresh`, coverage 80%, confidence
   0.85; **performance overall, reliability, brand_safety, fraud all `insufficient_data`** with honest reasons;
   fraud is flagged an **estimate**.
5. **Capability disable** (`set_capability('performance_insights',false)` → recompute): performance stays
   `insufficient_data`, **fraud stays `insufficient_data` (not raised)**, coverage unchanged — a disabled
   permission never lowers performance or raises fraud.
6. **Brand discovers & compares** (`match_creators` brief → results with ✓ reasons / − missing;
   `get_creator_intelligence` brand tier → **metrics hidden, no PII**, reliability/fraud insufficient; the new
   compare view). Unrelated brand is **denied (42501)**.
7. **Disconnect** (`disconnect_platform`): connection revoked, secret destroyed, 0 active connections.

## 4. Real Meta metrics vs. unavailable — HONEST STATEMENT

**No live Meta/Instagram API calls were made in this environment**, and no real IG account was connected. This
session cannot reach Meta (no deployed Edge Functions, no Meta app in the required mode, no consenting IG test
account, no production DB). Every metric shown above came from **synthetic observations** injected to exercise
the pipeline deterministically. What is proven: the browser→API→DB→display **contract, authorization, honesty,
and privacy** hold. What is **not** proven here: that real Meta returns these exact fields for a given account —
that requires the live stack (see blockers §7).

## 5. End-to-end test results

- **pgTAP: 497/497 green** across 00–09 + legacy-coexistence on the 24-migration stack (fresh apply).
- **Deterministic journey proof** (disposable cluster): partial-grant → reconnect → ingest → intelligence →
  capability-disable invariant → brand authorized view (PII-clean) → brief match → unrelated-brand denial →
  disconnect — all pass.
- **Brand compare UI**: browser-driven; two creators render side-by-side with correct evidence; no
  `intelligence.js` console errors.
- **CI** on `phase-1d-serving`: last run green (`35826812362`). The pilot branch re-runs the same suite.

## 6. Production changes

**None.** No migration applied to production, no flag flipped, no Edge Function deployed, nothing merged to
`main`. Production remains 21 migrations, `creator_ig_connect=false`, `creator_profile_api=false`.

## 7. Remaining blockers (owner · exact remedy)

| # | Blocker | Owner | Exact remedy |
|---|---|---|---|
| B1 | **Live Meta E2E not possible from here** — no deployed Edge Functions, no Meta app in Live/Advanced-access mode, no consenting IG test account. | You / Meta app admin | Deploy `ig-oauth-start`, `ig-oauth-callback`, `ig-ingest-worker`, `ig-webhook` to the Supabase project; confirm the Meta app has Instagram scopes approved and a test IG Business/Creator account added; then run the journey with one real creator. |
| B2 | **1C+1D not in production** (unmerged, unmigrated). | You (review) | Open PRs `phase-1c-feature-store` → `main` and `phase-1d-serving`/`pilot-integration` → `main`; on approval, apply migrations 22–24 to the project (`supabase db push` from a trusted runner with the access token — not from this session). |
| B3 | **Ingestion status surface** shows `run:null` until the **worker** runs — the honest "progress / last refreshed / missing permissions" is driven by `ci_ingest_run`, which the Edge worker creates (bypassed by the test fixture). | You / backend | After B1 deploy, trigger one real ingestion; verify `get_my_ingestion_status` shows a real run + freshness + missing permissions. |
| B4 | **Live prod flag/deploy state unverified** from this session (no token). | You | Confirm on the Supabase dashboard that `intel.ci_feature_flag` is off and no CI Edge Functions are live before/after activation. |
| B5 | **1E (Geek historical) pending** — no verified source file was accessible this session, so no Kurkure×Masaba evidence package was built. Narrated Kurkure/Lay's/Doritos figures are **not** imported as verified records. | You | Provide a verified source file (campaign brief/report with locations) to start the 1E-A extraction track separately; until then it stays pending and does not block the IG-powered pilot. |

## 8. Activation as a single reviewable decision

Once B1–B4 are cleared and the **live** E2E passes with one real creator + one authorized brand, activation is
one gated step (do **not** flip flags before that):

1. Merge `phase-1c` and `pilot-integration` to `main` (PRs, green CI).
2. Apply migrations 22→24 to the project from a trusted runner (not this session).
3. Deploy the CI Edge Functions.
4. **Flip flags on** (`creator_ig_connect=true`, `creator_profile_api=true`) — the single reviewable decision.
5. Smoke-test the live journey with the pilot cohort; roll back = flip flags off (additive/dark design makes
   this instant and non-destructive).

### Pilot rollout order — 10 creators, 2 brands
1. **Day 0 — 1 creator (internal):** full live journey (connect → profile → intelligence → disconnect);
   confirm real Meta fields vs. unavailable.
2. **Day 1–2 — +2 creators:** varied accounts (a Business + a Creator account; one with sparse data) to prove
   honest `insufficient_data`/`unavailable` on real data.
3. **Day 3 — Brand A (1 org):** relationship-scope 3 creators; run a brief, shortlist, compare; verify no PII
   and correct denials on unrelated creators.
4. **Day 4–6 — +4 creators (total 7)** across categories/cities to exercise matching signals.
5. **Day 7 — Brand B (2nd org):** confirm org isolation (Brand B sees only its own creators); repeat compare.
6. **Day 8–10 — +3 creators (total 10):** include reconnect, partial-grant, and disconnect on real accounts.
   Gate to broaden only after all honesty/privacy checks pass for the full cohort.

*Scope guard: this pilot is the Instagram-powered creator→brand journey only. It does not import historical
campaigns (1E stays a separate, pending evidence track) and adds no AI chat interface.*

---

## 9. Restricted Live Pilot — preparation results & GO/BLOCKED (2026-09-29)

All **reversible** preparation is complete and verified. The **live** steps (production migrate, Edge deploy,
real-Meta OAuth, worker run) are **BLOCKED** on production access + a consenting Instagram account, which this
session does not have. No live pilot is claimed to have passed, and no production change was made.

### 9.1 Commit ancestry & pending migrations (step 1) — DONE
- **1C ⊆ 1D ⊆ pilot-integration** (git ancestry verified).
- Branch tips: `main 8c4f85d` · `phase-1c f231b92` · `phase-1d a6ac132` · **`pilot-integration 12b0e75`**.
- **Pending migrations (branch − main), with blob hashes:**
  - `fbd7ed6…` `20260922080737_ci_1c_feature_store.sql`
  - `ad1559a…` `20260922080739_ci_1c_fk_indexes.sql`
  - `acc433e…` `20260923054333_ci_1d_serving_matching.sql`
  - **new** `20260929090000_ci_pilot_cohort.sql` (server-enforced cohort gate)
- **No tracked temporary preview files** (the browser harnesses were disk-only and removed; tree clean).
- **CI:** 1C/1D migration blobs are byte-identical to the green 1D run (`35826812362`); the cohort push
  triggered a fresh run (`36480619936`). Local full suite **00–11 + coexistence = 510/510**.

### 9.2 Server-enforced cohort authorization (step 4) — DONE (reversible)
Migration 25 adds `intel.ci_pilot_cohort` (service-role only) + `ci_in_pilot_cohort()`, and extends the shared
`ci_assert_api_enabled` so that — when `pilot_cohort_enforced` is on — the **entire** api surface (creator
intelligence *and* Instagram connect) requires an allowlisted creator (`member_id`) or brand org (`org_id`),
raising `42501` otherwise. It is **database-enforced**, not nav-hiding. Default **OFF** ⇒ zero behaviour change
until activation. **Immediate shutoff** = flip `creator_profile_api` off (proven to override cohort membership);
deactivating a cohort row revokes instantly. 13/13 pgTAP; 08/09 unaffected.

### 9.3 Production dry-run (step 2) — DONE on a restore-equivalent (NOT against prod)
On a fresh DB seeded with the legacy schema + **exactly the 21 `main` migrations** (the production baseline),
the **4 pending** migrations apply **cleanly and in order**; intel tables 43→52; feature-store + matching +
cohort present; **all flags remain OFF** (`creator_profile_api=false, creator_ig_connect=false,
pilot_cohort_enforced=false`). Re-applying the cohort migration is **idempotent**. This is the exact upgrade
path; running it against the live project requires the access token (blocked, below).

### 9.4 Worker path & retention (step 6) — VERIFIED (code + local)
- **Secure worker invocation:** `_shared/worker_auth.ts` requires a high-entropy `CI_WORKER_SECRET`, checked
  **constant-time before** any service-role client — no anon/JWT path into the worker.
- **Retention:** `ci_destroy_connection_secret` (secret destroyed on disconnect — E2E showed
  `secret_destroyed:true`), `ci_vault_destroy`, and `ci_purge_expired` (purges `private.ci_comment_raw` past
  retention) exist and are service-role only. *Operational* purge needs a schedule (deploy step, B3′ below).
- **No raw in brand payload:** serving explicitly excludes contact/address/DOB/WhatsApp/email/rates/
  commercials/raw comments/messages/tokens; brand tier returns `metrics:[]`; PII guard = clean.

### 9.5 GO / BLOCKED matrix

| Step | State | Evidence / blocked action |
|---|---|---|
| 1 Ancestry, hashes, cleanup, defect-fix | **GO** | §9.1; tree clean; 510/510 local |
| 2 Combined release **procedure + dry-run** | **GO (prepared)** | §9.3 dry-run clean on the 21-baseline; runbook §8/§9.6 |
| 2 **Apply 22–25 to production** | **BLOCKED** | needs `SUPABASE_ACCESS_TOKEN` on a trusted runner: `supabase db push` (no repair, no history edits). Not doable from this session. |
| 3 Deploy Edge Functions + Meta secrets + verify live scopes | **BLOCKED** | deploy `ig-oauth-start`, `ig-oauth-callback`, `ig-ingest-worker`, `ig-webhook`; set `CI_WORKER_SECRET`, Meta `CLIENT_ID`/`CLIENT_SECRET`/redirect/Graph version; then read the **actual** scopes at OAuth. Needs project + Meta app admin. |
| 4 Server-enforced cohort | **GO** | §9.2, migration 25, 13/13 |
| 5 Real IG journey (connect→…→disconnect) | **BLOCKED** | needs a consenting professional IG account + steps 2–3 live. Contract proven on synthetic data only (never presented as live). |
| 6 Worker secret path + retention + no-raw | **GO (verified)** | §9.4 |
| 7 GO/BLOCKED report | **GO** | this section |

### 9.6 Minimum human input to unblock (in order)
1. **Provide a trusted runner with `SUPABASE_ACCESS_TOKEN`** (or run yourself): `supabase link --project-ref
   edibibytqfrrxfztukpm`; `supabase db push` to apply 22–25; capture `supabase migration list` + Advisors.
2. **Set Edge secrets** in the project: `CI_WORKER_SECRET`, Meta `CLIENT_ID`/`CLIENT_SECRET`, OAuth redirect,
   Graph version; **deploy** the 4 IG functions; schedule `ci_purge_expired`.
3. **Name the pilot subjects** and insert them (service role):
   `insert into intel.ci_pilot_cohort(subject_kind,member_id,label) values('creator','<auth uid>','<name>');`
   and `insert into intel.ci_pilot_cohort(subject_kind,org_id,label) values('brand','<org_id>','<brand>');`
4. **Activate** (single decision): set `creator_profile_api=true`, `creator_ig_connect=true`,
   `pilot_cohort_enforced=true`. Roll back = set `creator_profile_api=false` (instant, non-destructive).
5. **Consenting IG account** connects; capture the real granted scopes, ingestion run, observed/unavailable
   fields, and creator+brand screenshots for the live GO report.
