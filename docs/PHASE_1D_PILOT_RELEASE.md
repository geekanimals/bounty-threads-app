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
