# Phase 1E — Pilot Operations (Internal Barter Execution OS) — DESIGN & GAP ANALYSIS

**Status: design + gap analysis for review. No code, no migrations, no production change.** Per the brief, this
document is produced *before* implementation and stops at review. It audits the existing 0A–1D + pilot systems,
identifies what is missing to run **2–3 real internal barter campaigns**, and proposes the minimum additive,
**dark** operational layer — reusing identity, profile, brand, feature-store and matching code, creating **no**
duplicate systems and **no** new intelligence features.

The goal is an **internal operating system** for Geek to run real campaigns and surface product gaps — not a
public marketplace, not more scoring/ranking/prediction.

### Relationship to the earlier `PHASE_1E_CAMPAIGN_INTELLIGENCE_DESIGN.md` (important — avoids duplication)
That earlier doc (design-only, never implemented) proposed `ci_campaign` + participation/deliverable/outcome
tables for **historical evidence import** (append-only, versioned, `geek_proprietary` provenance). This phase
needs **live, mutable execution** (a workflow state machine with owners and status history). To avoid two
`ci_campaign` entities, the resolution is: **define one operational `ci_campaign` entity now** (this doc); when
the historical-import track resumes it *attaches evidence to the same entity* rather than creating a parallel
one. The import track stays deferred (as previously decided); nothing here imports narrated campaign figures.

---

## 1. Phase 1E Pilot Gap Analysis

Format per required spec: **Existing capability · Missing capability · Recommended change · Tables affected ·
UI affected · Risk.** "Existing" = already built (0A–1D + pilot). "New(op)" = new operational table (additive,
dark). Nothing modifies existing intelligence models.

### G1 — Creator onboarding journey (1E-A)
- **Existing:** signup/login (auth); IG connect (`api.ig_connect_start` + 1B); all 13 profile fields
  (`ci_creator_professional_profile` category/languages/location/formats/availability;
  `ci_creator_commercial_preference` barter; `ci_creator_rate_card(_item)` rates;
  `ci_creator_brand_experience` previous brands; `ci_creator_brand_aspiration` dream brands);
  completion model (`ci_profile_completion` + `api.get_profile_completion`); profile UI (`profile.js`).
- **Missing:** a single **onboarding status** (`started → instagram_connected → profile_incomplete →
  profile_complete → campaign_ready`) and a funnel view; a guided funnel ordering; optional event log for
  funnel analytics.
- **Recommended:** `api.get_my_onboarding_status()` — a **derived** status computed from existing signals (no
  duplicate fields); a thin append-only `ci_creator_onboarding_event` for funnel timing only.
- **Tables:** reuse all profile tables + `ci_profile_completion`; **New(op):** `ci_creator_onboarding_event`.
- **UI:** creator "Get campaign-ready" funnel (new view over existing `profile.js`/`intelligence.js`).
- **Risk:** Low. Derivation only; no new field storage; misclassifying "campaign_ready" is a rule tweak.

### G2 — Brand onboarding journey (1E-B)
- **Existing:** `ci_brand` (canonical brand: name/aliases/domain); org directory (`public.members.org_id`);
  brand relationship scope (`ci_org_creator_relationship`); brand intelligence + matching UI (1D).
- **Missing:** a **company profile** (company vs brand, category, website, location, **contact person**) and a
  persistent **campaign brief** (objective/product/audience/cities/languages/deliverables/timeline/budget/
  comp-preference). `ci_matching_request` is a transient *matching query*, not a durable campaign.
- **Recommended:** **New(op)** `ci_brand_org_profile` (reuses `ci_brand` for the brand entity; adds org-level
  company/contact fields). Campaign brief becomes part of `ci_campaign` (G3); matching still runs through the
  existing `ci_matching_request`/`match_creators`.
- **Tables:** reuse `ci_brand`, `public.members`; **New(op):** `ci_brand_org_profile`.
- **UI:** brand onboarding form; campaign create form (agency/brand).
- **Risk:** Low–Med. Must not duplicate `ci_brand`; company profile references it, never replaces it.

### G3 — Campaign creation (1E-B/C/F)
- **Existing:** `ci_matching_request` (requirements jsonb, soft `campaign_id`); legacy `public.campaigns` (thin,
  text-only, org-scoped — insufficient: no FK to identity/brand, no lifecycle, no owners/history).
- **Missing:** a **structured, provenance-bearing campaign entity** with brand FK, comp type, budget, timeline,
  and the 11-stage lifecycle status.
- **Recommended:** **New(op)** `ci_campaign` (canonical operational campaign; FK `ci_brand`; created_by; comp
  type barter/cash/hybrid; lifecycle status; soft-links legacy `public.campaigns.id`). **Do not** extend the
  thin legacy table (would require a prod change and can't carry provenance/FKs cleanly).
- **Tables:** reuse `ci_brand`, `ci_matching_request`; **New(op):** `ci_campaign`, `ci_campaign_brief`.
- **UI:** campaign create (agency ops); brief drives matching (reuse 1D).
- **Risk:** Med. One canonical `ci_campaign` (see reconciliation note); legacy table remains untouched.

### G4 — Barter campaign execution workflow (1E-C) — HIGHEST PRIORITY
- **Existing:** nothing (no execution state machine anywhere). Legacy `barter_items.stage` is a free-text field
  with no history/owner/reason.
- **Missing:** the full lifecycle `DRAFT → CREATOR_DISCOVERY → SHORTLISTED → INVITED → ACCEPTED → PRODUCT_SENT →
  CONTENT_CREATED → CONTENT_APPROVAL → PUBLISHED → REPORTING → COMPLETED` with, at **every** stage: **owner,
  timestamp, status history, reason** for rejection/failure.
- **Recommended:** **New(op)** per-creator `ci_campaign_participation` carrying the stage; an append-only
  `ci_campaign_event` ledger recording every transition (entity, from→to, actor, reason, at) — this single
  ledger satisfies owner/timestamp/history/reason for all stages; a validated transition function.
- **Tables:** **New(op):** `ci_campaign_participation`, `ci_campaign_event` (append-only).
- **UI:** agency pipeline board; creator "My Campaigns" actions.
- **Risk:** Med–High (core). State-machine correctness + RLS; mitigated by a transition function + pgTAP.

### G5 — Creator–brand matching (1E-C)
- **Existing:** **fully built** — 1D `api.match_creators` (brief-specific, explainable ✓/− signals, no score),
  the compare view, and brand decision fields (pilot). **No gap.**
- **Missing:** only the *link* from a match result into campaign shortlisting/invite.
- **Recommended:** reuse `match_creators`; a campaign "shortlist" simply promotes a matched creator into
  `ci_campaign_participation` at stage `SHORTLISTED`. **No new matching.**
- **Tables:** reuse `ci_matching_request`/`ci_match_result`; write to `ci_campaign_participation`.
- **UI:** "Add to campaign" on a match/compare result.
- **Risk:** Low.

### G6 — Deliverable tracking (1E-C/D/F)
- **Existing:** `ci_media`/`ci_media_insights` (observed published content); content-format concept.
- **Missing:** *expected* deliverables per participation, and their submission/approval status.
- **Recommended:** **New(op)** `ci_campaign_deliverable` (expected content per participation; optional FK to a
  real `ci_media` row once published) + `ci_campaign_submission` (creator-submitted links).
- **Tables:** **New(op):** `ci_campaign_deliverable`, `ci_campaign_submission`; reuse `ci_media`.
- **UI:** creator upload/submit; agency "content pending".
- **Risk:** Low–Med. Store links/refs, never raw media/DMs.

### G7 — Approval workflow (1E-C/F)
- **Existing:** an app-approval-correction pattern (0B3A) exists conceptually, but **no content approval**.
- **Missing:** brand/agency approval of submissions with decision + reason.
- **Recommended:** **New(op)** `ci_campaign_approval` (submission_id, reviewer, decision, reason, decided_at);
  transitions logged to `ci_campaign_event`.
- **Tables:** **New(op):** `ci_campaign_approval`.
- **UI:** brand/agency "approvals pending" queue.
- **Risk:** Med. Authorization (only the brand/agency for that campaign may approve).

### G8 — Reporting workflow (1E-E/H)
- **Existing:** feature store / intelligence serving (observed metrics only). Legacy dashboards (`app.js`).
- **Missing:** **campaign** reporting — pipeline counts, cycle times, delivery/approval/completion rates.
- **Recommended:** **derived** read functions/views over the operational tables + `ci_campaign_event`
  timestamps. **No fabricated metrics** — reach/EMV only if sourced from `ci_media_insights` (observed);
  otherwise `unavailable`. No universal/campaign score.
- **Tables:** reuse operational tables + `ci_media_insights`; no new storage (views/functions).
- **UI:** agency ops dashboard; campaign report export.
- **Risk:** Low. Read-only aggregation; must never invent performance.

### G9 — Feedback loops (1E-D/F, Phase 4)
- **Existing:** `ci_pilot_feedback` + `api.submit_pilot_feedback` (creator/brand, stored separately) — **built**.
- **Missing:** only a **campaign link** on feedback for post-campaign, campaign-scoped capture.
- **Recommended:** reuse `ci_pilot_feedback`; add a nullable `campaign_id` (additive column) or a thin
  `ci_campaign_feedback` view. Prefer the additive column (no duplicate store).
- **Tables:** reuse `ci_pilot_feedback` (+ nullable `campaign_id`).
- **UI:** post-campaign feedback prompt (reuse pilot feedback forms).
- **Risk:** Low.

### G10 — Agency operations / internal admin (1E-E/G)
- **Existing:** `public.platform_admins` (internal admins); `ci_org_creator_relationship`; pilot cohort gate.
- **Missing:** an explicit **agency-operator** capability to create/manage campaigns, upload creator lists,
  invite, monitor, export — server-enforced, internal only (not public).
- **Recommended:** **New(op)** `ci_agency_operator` allowlist (or reuse `platform_admins`) + server-enforced
  checks on all campaign-write RPCs; a bulk creator-list import that resolves to `ci_creator_identity` (never
  creates identities silently — mirrors the conservative resolution rule).
- **Tables:** reuse `platform_admins`/`ci_org_creator_relationship`; **New(op):** `ci_agency_operator` (or a flag).
- **UI:** agency ops dashboard (internal-only, cohort/admin gated).
- **Risk:** Med. Authorization is the crux; server-enforced like the pilot cohort.

### G11 — Instrumentation (1E-H)
- **Existing:** `ci_pilot_feedback`; feature-store statuses; no funnel/campaign metrics.
- **Missing:** creator (onboarding %, IG %, profile %, acceptance %), brand (create/shortlist time, selection
  confidence, repeat usage), campaign (acceptance/delivery/approval-cycle/completion) metrics.
- **Recommended:** **derived** metric functions/views over onboarding events + operational tables + timestamps
  (`ci_campaign_event`). No new metric store; no fabricated numbers.
- **Tables:** reuse; views/functions only.
- **UI:** ops dashboard tiles; a pilot metrics export.
- **Risk:** Low.

**Net new operational tables (all additive, dark, in `intel`):** `ci_campaign`, `ci_campaign_brief`,
`ci_campaign_participation`, `ci_campaign_deliverable`, `ci_campaign_shipment`, `ci_campaign_submission`,
`ci_campaign_approval`, `ci_campaign_event` (append-only ledger), `ci_brand_org_profile`,
`ci_creator_onboarding_event`, `ci_agency_operator`; plus one additive column (`campaign_id`) on
`ci_pilot_feedback`. **Reused unchanged:** identity graph, all profile/commercial/rate tables,
`ci_profile_completion`, `ci_brand`, `ci_matching_request`/`ci_match_result`, `ci_media(_insights)`,
`ci_pilot_cohort`, `platform_admins`. **No intelligence model (`ci_feature_*`/`ci_measure_*`) is touched.**

---

## 2. Architecture (operational layer over the intelligence platform)

```
  EXISTING (unchanged)                          NEW — OPERATIONAL OS (intel, additive, dark)
  ┌───────────────────────────┐                 ┌──────────────────────────────────────────────┐
  │ Identity 0A / Profile 1A  │◀── reuse ───────│ ci_creator_onboarding_event (funnel timing)   │
  │ ci_creator_identity       │   FKs           │ api.get_my_onboarding_status() (DERIVED)       │
  │ profile/commercial/rate   │                 └──────────────────────────────────────────────┘
  │ ci_profile_completion     │
  ├───────────────────────────┤                 ┌──────────────────────────────────────────────┐
  │ Brand: ci_brand           │◀── reuse ───────│ ci_brand_org_profile (company + contact)       │
  ├───────────────────────────┤                 │ ci_campaign ── ci_brand                         │
  │ Matching 1D               │◀── reuse ───────│ ci_campaign_brief ─▶ match_creators (1D)        │
  │ ci_matching_request /     │   shortlist      │ ci_campaign_participation ── ci_creator_identity│
  │ ci_match_result           │─────────────────▶│   (per-creator stage)                          │
  ├───────────────────────────┤                 │ ci_campaign_deliverable ── ci_media (when pub) │
  │ Content 1B                │◀── reuse ───────│ ci_campaign_shipment / ci_campaign_submission  │
  │ ci_media / ci_media_insights                │ ci_campaign_approval                           │
  ├───────────────────────────┤                 │ ci_campaign_event (APPEND-ONLY status ledger:  │
  │ Serving 1D (read)         │                 │   entity, from→to, actor, reason, at)          │
  │ intelligence serving      │                 ├──────────────────────────────────────────────┤
  ├───────────────────────────┤                 │ ci_agency_operator (internal admin allowlist)  │
  │ Pilot: cohort + feedback  │◀── reuse ───────│ ci_pilot_feedback + campaign_id (additive col) │
  └───────────────────────────┘                 └──────────────────────────────────────────────┘
        │ all writes via SECURITY DEFINER api fns, flag+cohort/operator gated; browsers never touch intel │
        ▼
  DERIVED REPORTING (read-only functions/views): pipeline counts, cycle times, delivery/approval/completion
  rates, funnel %. No fabricated metrics; observed reach/EMV only from ci_media_insights; NO score/ranking.
```

**Principles (strict-rules compliance):** additive + **dark** (new `operational_pilot` flag defaults false;
api unexposed in prod); reuses identity/profile/brand/matching/content — **no duplicate systems**; adds **no**
intelligence features (no score, no ranking, no inferred performance); reporting is **evidence-only**; private
creator data never enters campaign/brand views (reuses 1D/commercial visibility rules); operational writes are
server-enforced to agency operators; append-only `ci_campaign_event` preserves provenance of every transition.

---

## 3. Database changes (proposal)

All in `intel`, RLS on, service-role + SECURITY DEFINER api only. Status enums are CHECK-constrained; the
transition **function** validates legal moves and writes the event ledger (no direct status UPDATE by clients).

- **`ci_brand_org_profile`** `(org_id pk, brand_id→ci_brand, company_name, category, website, location_city,
  location_state, contact_member_id→auth.users, created_by, created_at, updated_at)` — reuses `ci_brand`.
- **`ci_campaign`** `(campaign_id pk, brand_id→ci_brand, org_id, created_by→auth.users, name, objective,
  product, category, cities text[], languages text[], comp_type check(barter|cash|hybrid), budget numeric,
  currency default 'INR', starts_on date, ends_on date, lifecycle_status check(<11 stages>) default 'draft',
  legacy_campaign_id (soft ref), created_at, updated_at)`.
- **`ci_campaign_brief`** `(brief_id pk, campaign_id→ci_campaign, requirements jsonb, matching_request_id→
  ci_matching_request, created_at)` — links the durable campaign to a 1D matching query.
- **`ci_campaign_participation`** `(participation_id pk, campaign_id→ci_campaign, identity_id→
  ci_creator_identity, stage check(<per-creator stages>) default 'shortlisted', owner_member_id→auth.users,
  invited_at, accepted_at, rejected_at, reason, created_at, updated_at, unique(campaign_id, identity_id))`.
- **`ci_campaign_deliverable`** `(deliverable_id pk, participation_id→…, content_format text, quantity int,
  expected_by date, status check(expected|submitted|approved|published|missed) default 'expected',
  media_row_id→ci_media (nullable), created_at)`.
- **`ci_campaign_shipment`** `(shipment_id pk, participation_id→…, product, courier, tracking_ref, shipped_at,
  delivered_at, status check(pending|shipped|delivered|failed) default 'pending', created_at)`.
- **`ci_campaign_submission`** `(submission_id pk, deliverable_id→…, content_url, note, submitted_at,
  status check(submitted|withdrawn) default 'submitted', created_at)` — links only; never raw media/DMs.
- **`ci_campaign_approval`** `(approval_id pk, submission_id→…, reviewer_member_id→auth.users,
  decision check(approved|changes_requested|rejected), reason, decided_at, created_at)`.
- **`ci_campaign_event`** (APPEND-ONLY) `(event_id pk, campaign_id→…, participation_id (nullable), entity
  check(campaign|participation|deliverable|shipment|submission|approval), from_status, to_status,
  actor_member_id→auth.users, reason, at timestamptz default now())` — the single owner/timestamp/history/
  reason ledger; UPDATE/DELETE blocked by `tg_block_mutation`.
- **`ci_agency_operator`** `(id pk, member_id→auth.users, org_id, active bool, added_by, added_at)` —
  internal-admin allowlist (or reuse `platform_admins`; decision in §9).
- **`ci_creator_onboarding_event`** (append-only) `(id pk, identity_id→…, step, at)` — funnel timing only.
- **`ci_pilot_feedback`** — add nullable `campaign_id` (additive column; reuses the built feedback store).

**Provenance / no-fake-metrics:** every operational row records `created_by`/`actor_member_id` + timestamps;
status changes only through the transition function which appends to `ci_campaign_event`. Reporting reads these
facts; it never infers performance. Observed reach/EMV, if shown, comes only from `ci_media_insights`.

**Onboarding status (derived; no duplicate fields):** `api.get_my_onboarding_status()` returns one of
`started | instagram_connected | profile_incomplete | profile_complete | campaign_ready`, computed from IG
connection (1B) + `ci_profile_completion` + presence of barter readiness & (optional) rate card. Nothing new is
stored except the optional funnel-timing event.

---

## 4. Migration plan (additive, dark, reversible — after approval)

Each replayable on the disposable PG17 cluster; **no production apply**, **no flag enablement**
(`operational_pilot` ships false), no historical migration altered.

| Step | Migration (working name) | Contents |
|---|---|---|
| 1E-op.1 | `ci_1e_brand_org_and_campaign` | `ci_brand_org_profile`, `ci_campaign`, `ci_campaign_brief` + RLS + service-role grants + indexes |
| 1E-op.2 | `ci_1e_participation_and_events` | `ci_campaign_participation`, `ci_campaign_event` (append-only) + transition function `ci_campaign_transition(...)` |
| 1E-op.3 | `ci_1e_deliverables_shipments` | `ci_campaign_deliverable`, `ci_campaign_shipment`, `ci_campaign_submission`, `ci_campaign_approval` |
| 1E-op.4 | `ci_1e_agency_and_onboarding` | `ci_agency_operator`, `ci_creator_onboarding_event`, `ci_pilot_feedback.campaign_id`; `operational_pilot` flag (false) |
| 1E-op.5 | `ci_1e_operations_api` | SECURITY DEFINER api: create_campaign, add_participant(from a match), invite/accept/reject, record_shipment, submit_content, approve_content, get_my_campaigns (creator), get_campaign_pipeline (agency), get_my_onboarding_status; all flag+operator/cohort gated |
| 1E-op.6 | `ci_1e_reporting_and_metrics` | derived read functions/views for pipeline + instrumentation (no new storage) |
| 1E-op.7 | `ci_1e_fk_indexes` | covering indexes on real join/query paths only |
| pgTAP | `13_phase1e_operations_test.sql` | state machine, RLS, owner/timestamp/history, no-PII, no-fake-metrics, coexistence; wire into CI |

**Reversibility:** additive only; down = drop new `intel` objects + the added column + the flag. Legacy `public`
untouched → coexistence/fingerprint preserved. **Production is a separate, explicitly-approved step later.**

---

## 5. UI journey map

- **Creator onboarding funnel** (`onboarding` view, reuses `profile.js`/`ig-connect.js`): a stepper —
  Signup → Connect Instagram → Complete profile (personal, category, languages, location, formats) → Previous
  brands → Barter preference → Rate card → Dream brands → Availability → **Campaign-ready**. Progress from
  `get_my_onboarding_status()` + `get_profile_completion`.
- **Creator "My Campaigns"** (new view): per campaign — Brand / Campaign / Product / Deliverables / Deadline /
  Status; actions Accept, Reject (with reason), Upload content, Submit links, Ask question. Reads
  `get_my_campaigns`; writes via the transition/submit RPCs.
- **Brand onboarding** (new view): company profile form (company, brand→`ci_brand`, category, website,
  location, contact person) → campaign create form (objective/product/audience/cities/languages/deliverables/
  timeline/budget/comp preference) → runs 1D matching → shortlist.
- **Agency Operations dashboard** (new, internal-only): pipeline board across the 11 stages with counts
  (running, contacted, confirmed, shipped, content pending, approvals pending, completed) and filters (brand,
  campaign, category, status, creator); actions to create campaign, upload creator list, invite, monitor,
  export report. Reads `get_campaign_pipeline` + metrics.
- **Approvals queue** (brand/agency): submissions pending → approve / request changes / reject (reason).
- All new nav entries are **flag+operator/cohort gated** and hidden in production (like the pilot UI).

---

## 6. Test plan (disposable DB; CI must pass)

`supabase/tests/13_phase1e_operations_test.sql` (pgTAP, rolls back), asserting:
- **State machine:** legal transitions succeed and append exactly one `ci_campaign_event` (with actor + reason);
  illegal transitions are rejected; a rejection/failure requires a `reason`.
- **Provenance/history:** every stage change has owner + timestamp; `ci_campaign_event` is append-only
  (UPDATE/DELETE blocked); status is never changed except via the transition function.
- **Authorization/RLS:** `intel` operational tables are service-role only; agency-write RPCs require an active
  `ci_agency_operator` (or admin); a creator can act only on their own participation; a brand/agency approves
  only its own campaign; unrelated users denied.
- **Reuse/no-duplication:** participation FKs resolve to existing `ci_creator_identity`; campaign FKs to
  `ci_brand`; adding a participant reuses a `ci_match_result`; no new identity/brand created by ops flows.
- **Privacy:** creator/campaign payloads expose no private contact/address/raw comments/DMs/tokens; rates/
  brand-history follow the existing visibility rules.
- **No fake metrics / no score:** reporting fields are counts/timestamps/cycle-times or observed
  `ci_media_insights`; no `*_score`, no ranking, no inferred performance; missing → `unavailable`/
  `insufficient_data`, never 0.
- **Onboarding:** `get_my_onboarding_status()` returns the correct state across connect/complete/barter/rate
  fixtures; no duplicate field storage.
- **Coexistence:** full suite 00–12 + this + legacy fingerprint unchanged.
- Verification gates identical to prior phases: disposable-cluster clean apply + deterministic replay, full
  pgTAP, coexistence, secret scan, `db lint`; production dry-run of the new migrations on the current baseline.

---

## 7. Pilot execution checklist (2–3 real barter campaigns)

1. **Prep (dark):** merge approved ops branch; migrations applied on a disposable clone (dry-run green);
   `operational_pilot` + api flags **off** in prod until go.
2. **Operators:** add the Geek team to `ci_agency_operator` (server-enforced).
3. **Creators:** onboard the existing Geek network — connect Instagram, complete profile, declare barter
   readiness, add rates; confirm `get_my_onboarding_status = campaign_ready` for the cohort.
4. **Brand/company:** create the brand company profile (reuse `ci_brand`); create Campaign #1 (e.g. a real
   barter brief) with product, cities, deliverables, timeline, comp = barter.
5. **Discovery → shortlist:** run 1D matching over managed creators; shortlist into participation.
6. **Execute:** invite → accept (or reject w/ reason) → ship product (record shipment) → content created →
   submit links → brand approval (or changes/reject w/ reason) → published → reporting → completed. Each step
   logs owner/timestamp/reason.
7. **Report:** pipeline counts + cycle times + delivery/approval/completion rates (evidence-only).
8. **Feedback:** capture creator + brand feedback (campaign-scoped) and review out-of-band.
9. **Repeat** for campaigns #2–#3; collect the instrumentation metrics.
10. **Gap review:** consolidate product gaps; decide next build. **Rollback** at any point = flip
    `operational_pilot`/api flags off (dark, non-destructive).

---

## 8. Instrumentation (1E-H) — derived, evidence-only

- **Creator:** onboarding completion % (`get_my_onboarding_status` across cohort), IG connection %
  (`ci_platform_connection`), profile completion % (`ci_profile_completion`), campaign acceptance %
  (`ci_campaign_participation` accepted/invited).
- **Brand:** campaign creation time & shortlist time (`ci_campaign_event` timestamps), selection confidence
  (brand feedback), repeat usage (campaigns per org).
- **Campaign:** acceptance / delivery / approval-cycle / completion rates (participation + event ledger).
- All are queries/views over the operational tables — **no new metric store, no fabricated numbers**.

---

## 9. Strict-rules compliance + open questions for review

**Compliance:** (1) no universal creator score — none added; (2) no opaque ranking — matching stays the 1D
explainable engine; (3) no inferred performance — reporting is evidence-only; (4) no private data exposed —
reuses visibility rules; (5) existing intelligence models untouched — additive operational tables only;
(6) no production migration without approval — design only; (7) dark build first; (8) disposable-DB testing;
(9) CI green.

**Open questions (settle before coding):**
1. **Agency operator gate:** new `ci_agency_operator` table, or reuse `public.platform_admins` + the pilot
   cohort? (Proposal: `ci_agency_operator` for a clean, revocable internal allowlist.)
2. **`ci_campaign` canonicalization:** confirm one operational `ci_campaign` now, with the deferred
   historical-import design attaching evidence to it later (no second campaign entity).
3. **Content-format vocabulary:** reuse a documented text set now, or introduce the `ci_content_format_vocab`
   table from the earlier design in this phase?
4. **Legacy `public.campaigns`:** soft-link only (recommended), or also write a mirror row for the legacy app's
   dashboards during the pilot? (Prefer soft-link; no prod write.)
5. **Feedback:** additive `campaign_id` column on `ci_pilot_feedback` (recommended) vs a separate
   `ci_campaign_feedback` table.

*Design only. On approval, implementation proceeds migration-by-migration per §4 — additive, dark, disposable-DB
verified with the §6 plan, CI green — before any commit, and with no production change until explicitly approved.*

---

## 10. Frontend operational layer (built 2026-09-29) — dark, existing RPCs only

Delivered `operations.js` (flag-gated like `intelligence.js`/`profile.js`), wired into
`app.html`/`app.js`/`data.js`/`styles.css`. Boots by probing `api.ops_vocab()` (enabled = `operational_pilot`
on + caller in the pilot cohort) and `api.get_campaign_pipeline` (operator?). Hidden entirely in production.
**No fake data; missing data renders as "unavailable"/"—"; no scores/ranking; private creator data never shown.**

Four experiences (all via existing RPCs; one additive **read-only** RPC `api.get_campaign_detail` was needed
for the operator detail/actions — flagged for review, no table/contract redesign):

1. **Agency Operations** (`campaignops`, operators): a **10-column pipeline board** (Draft · Creator discovery ·
   Creators invited · Creators confirmed · Product dispatched · Content pending · Content submitted · Brand
   approval · Live · Completed) with totals; **Create campaign**; **campaign detail** (overview · creators &
   execution with shipment/submission/approval · **event-ledger timeline**) and actions — move stage
   (`set_campaign_status`), add creator (`add_campaign_participant`), record shipment (`record_shipment`),
   advance (`advance_participation`), approve/request-changes/reject (`approve_content`).
2. **Creator "My Campaigns"** (`mycampaigns`): cards grouped Upcoming / Active / Completed; **Accept / Reject**
   (`respond_to_campaign`), **Upload content link** with a note-to-Geek field (`submit_content`). Shows only the
   creator's own campaigns; no other creators, no brand-private data, no internal notes. Post-completion feedback
   (brief clear? execution smooth? participate again?) via `submit_pilot_feedback`.
3. **Creator Onboarding funnel** (`onboarding`): STARTED → PROFILE COMPLETE → CAMPAIGN READY funnel + an
   8-item checklist (Instagram connected · profile complete · categories · languages · location · brands · barter
   preference · rate card) from `get_my_onboarding_status` + existing `get_my_profile`. No duplicate fields.
4. **Brand Setup** (`brandsetup`, operators): company + campaign brief form → `create_campaign` (company/
   website/contact persisted inside the brief `requirements`, not a new store). Brand feedback
   (recommendations useful? faster? what was missing?) via `submit_pilot_feedback`.

**Browser-verified** (stubbed RPCs): 10 board columns render and place campaigns by stage; detail opens with
2 creators, shipment, submission link, 3-event ledger, and approve/advance actions; My Campaigns shows accept;
onboarding shows 8/8 checks at "campaign ready"; brand form renders. No `operations.js` console errors.

**Testing:** pgTAP `13` extended to **37** (adds `get_campaign_detail` operator read + unrelated-denied + no-PII);
full suite **00–13 + coexistence = 568/568**; 32 migrations apply clean; legacy `public` fingerprint unchanged;
all flags OFF. Not merged; no production migration.
