# Phase 1D — Creator Intelligence Serving & Explainable Matching Layer

**Status:** additive + dark. Ships as migration `20260923054333_ci_1d_serving_matching.sql`, pgTAP suite
`supabase/tests/09_phase1d_serving_test.sql`, and the flag-gated UI module `intelligence.js`. Nothing is
exposed or enabled in production: the `api` schema stays off the Data API, the `creator_profile_api`
feature flag stays `false`, and the ledger/fingerprint of the legacy `public` schema is unchanged.

This phase turns the internal **1C feature store** (append-only feature values + six explainable measures,
each with full provenance and an `observed / derived / predicted` contract) into three controlled, explainable
surfaces — a creator self-view, a relationship-scoped brand view, and a deterministic brief-specific matcher —
without ever inventing a fact, blending an opaque score, or leaking PII / commercials / raw content / tokens.

```
                         ┌──────────────────────────────────────────────┐
                         │            1C FEATURE STORE (intel)           │
                         │  ci_feature_run · ci_feature_value            │
                         │  ci_measure_snapshot (6 measures)             │
                         │  ci_feature_evidence (provenance)             │
                         └───────────────┬──────────────────────────────┘
                                         │  SECURITY DEFINER, read-only
                    ┌────────────────────┴─────────────────────┐
                    │        INTELLIGENCE SERVING (intel)       │
                    │  ci_serve_intelligence(identity, tier)    │
                    │  ci_brand_can_view(identity)  ci_caller_org│
                    └───────┬───────────────────────┬───────────┘
                            │                       │
              ┌─────────────┴──────┐   ┌────────────┴─────────────┐   ┌───────────────────────────┐
              │  api.get_my_creator│   │ api.get_creator_         │   │ api.get_feature_evidence  │
              │  _intelligence()   │   │ intelligence(identity)   │   │ (feature_value_id)        │
              │  → self tier       │   │ → brand tier (scoped)    │   │ → source[]/calc/model_ver │
              └─────────┬──────────┘   └───────────┬──────────────┘   └───────────────────────────┘
                        │                          │
             ┌──────────┴─────────┐     ┌──────────┴──────────────┐
             │ Creator dashboard  │     │ Brand Intelligence Card │
             │ "My Intelligence"  │     │ (restricted projection) │
             └────────────────────┘     └──────────┬──────────────┘
                                                    │
                         ┌──────────────────────────┴─────────────────────────┐
                         │      EXPLAINABLE MATCHING (brief-specific only)      │
                         │  ci_matching_request (the brief) →                  │
                         │  ci_match_creators(request) [deterministic, no AI] → │
                         │  ci_match_result (matched_signals ✓ / missing −)    │
                         │  api.match_creators(requirements, campaign_id)       │
                         └─────────────────────────────────────────────────────┘
```

---

## 1. Design principles (non-negotiable)

1. **No opaque creator score.** There is no "Creator Score = 92", no "Best/Top/Winner Creator", and no
   blended universal number anywhere in the payloads or UI. The creator is described by **six separate,
   individually-explained measures** (performance, reliability, brand safety, fraud probability, intelligence
   confidence, verified data coverage) and, for matching, by an **explanation** of the signals a brief did and
   did not meet.
2. **Missing data is a status, never a zero.** Every measure and feature carries an explicit `value_status`.
   When evidence is absent the surface returns `insufficient_data` (with a reason) — never `0`, never a blank
   that reads as "fine". Fraud probability in particular is *always* an estimate and is shown as
   `insufficient_data` when signals are too sparse — never "0%".
3. **Ranking is brief-specific.** The matcher only ever answers "for *this* brief, over the creators *this org*
   manages, which signals are met?". There is no global "Top 100 creators in India", no cross-brief ranking,
   and no candidate pool beyond the caller's own relationships.
4. **The LLM is only an intent translator.** (Out of scope for 1D; documented as the future extension point in
   §7.) An LLM may translate a natural-language brief into the structured `requirements` JSON. It must never
   invent creator facts, compute a metric, override a feature value, classify fraud, or decide suitability.
5. **Least exposure.** Browsers never touch `intel`/`private`. Only four `api` functions are reachable, each
   `SECURITY DEFINER` with `search_path=''`, flag-gated by `ci_assert_api_enabled('creator_profile_api')`, and
   granted only to `authenticated` + `service_role`. In production the `api` schema is not exposed at all.

---

## 2. API contracts

All four are `SECURITY DEFINER`, `search_path=''`, and begin with `ci_assert_api_enabled('creator_profile_api')`.

### 2.1 `api.get_my_creator_intelligence() → jsonb` (creator self-view)
Resolves the caller's own identity via `intel.ci_caller_identity()` (self actor-access; ownership enforced —
a caller can only ever see their own intelligence). Returns the latest **complete** `ci_feature_run` projected
at the **`self`** tier:

```jsonc
{
  "creator_identity": { "identity_id": "…" },
  "tier": "self",
  "performance": {
    "status": "insufficient_data",           // explicit status, never a grade
    "reels_analysed": 15,                      // sum of content.sample_size (available only)
    "window": "last 90 days",
    "confidence_band": "Low",                  // Low/Medium/High from intelligence_confidence
    "metrics": [                               // self tier ONLY: per-format detail, each traceable
      { "feature": "content.engagement_per_follower", "format": "REELS", "window": "30d",
        "value": 0.081, "unit": "ratio", "status": "available", "evidence_type": "derived",
        "explanation": "…", "feature_value_id": "…" }    // ← handle for the evidence API
    ]
  },
  "audience": {                                // MARGINAL only — never a joint intersection
    "country": { "IN": 80000, "US": 20000 },
    "city":    { "Bengaluru, Karnataka": 50000, "Mumbai, Maharashtra": 30000 },
    "top_country_share": 80, "freshness": "fresh",
    "note": "marginal only; not a joint intersection"
  },
  "reliability":       { "status": "insufficient_data", "reason": "no_delivery_history", "explanation": "…" },
  "brand_safety":      { "status": "insufficient_data", "reason": "no_scan" },
  "fraud_probability": { "status": "insufficient_data", "is_estimate": true, "explanation": "…" },
  "confidence":        { "status": "available", "value": 0.42 },
  "coverage":          { "status": "available", "value": 55 },
  "generated_at": "2026-09-22T00:00:00Z"
}
```

Explicitly **excluded**: contact/address/DOB/WhatsApp/email, rate cards & negotiated commercials, raw comments
& messages, OAuth tokens. (Enforced by construction — those columns are never selected — and asserted by test.)

### 2.2 `api.get_creator_intelligence(p_identity_id uuid) → jsonb` (brand / agency view)
Authorised by `intel.ci_brand_can_view(identity)`, which grants access when the caller is **(a)** the creator
themself (self actor-access), **(b)** a platform admin (`public.platform_admins`, guarded), or **(c)** a member
of an org that holds an **active `ci_org_creator_relationship`** to the identity
(`roster / represented / managed / campaign_only / discovered`). Any other caller is denied with
`SQLSTATE 42501` `"not authorised to view this creator"`. Returns the **`brand`** tier: identical shape to §2.1
but the `performance.metrics` array is **empty** — brands get the evidence *summary* (status, reels analysed,
confidence band, marginal audience) but not the raw per-metric dump. No private personal data, no private
contact, no unauthorised rates, no raw messages.

### 2.3 `api.get_feature_evidence(p_feature_value_id uuid) → jsonb` (provenance resolver)
Authorised by the same `ci_brand_can_view` on the feature value's identity. Resolves a single feature value to
its provenance envelope:

```jsonc
{ "feature": "content.engagement_per_follower", "evidence_type": "derived",
  "value": 0.081, "unit": "ratio", "status": "available",
  "source": ["media_insight","account_snapshot"],       // distinct source kinds
  "source_rows": [ { "table": "…", "row_id": "…", "ingest_run_id": "…" } ],
  "calculation": "Median engagement per follower on reels (30d).",
  "sample_size": 5, "window": "30d", "as_of": "…", "calculated_at": "…",
  "model_version": "v1" }
```

### 2.4 `api.match_creators(p_requirements jsonb, p_campaign_id uuid = null) → jsonb` (explainable matching)
Resolves the caller's org (`ci_caller_org()`; error `42501` if none), inserts an immutable
`ci_matching_request`, runs the deterministic matcher, and returns:

```jsonc
{ "matching_request_id": "…", "requirements": { … },
  "results": [
    { "creator_identity_id": "…", "match_status": "match", "match_strength": "strong",
      "matched_signals": ["fitness category match","strong IN audience presence",
                          "strong REELS performance","prior brand campaign experience"],
      "missing_signals": ["reliability data insufficient","conversion data unavailable"],
      "feature_snapshot_id": "…" } ],
  "generated_at": "…" }
```

`requirements` shape: `{ category[], location[], platform, content_formats[], audience_gender, audience_age,
budget_range, deliverables[] }` (only `category`, `location`, `content_formats`, `platform` are used by the V1
matcher; the rest are stored for provenance and future use).

---

## 3. Authorization model

| Surface | Who is allowed | Mechanism | Denied result |
|---|---|---|---|
| Self view | The creator only | `ci_caller_identity()` (self actor-access) | own identity only — cannot pass another id |
| Brand view | Self, platform admin, or an org with an **active relationship** | `ci_brand_can_view(identity)` | `42501 not authorised to view this creator` |
| Evidence | Same as brand view, on the feature value's identity | `ci_brand_can_view(fv.identity_id)` | `42501 not authorised` |
| Matching | Caller's org; candidate pool = that org's active relationships | `ci_caller_org()` + relationship filter | empty candidate pool (org isolation) |

- **Ownership isolation:** the self view resolves the caller's *own* identity server-side; there is no
  identity parameter to spoof.
- **Org isolation:** an unrelated brand is denied the card (`42501`) *and* matches against an **empty** pool —
  there is no global creator directory to leak.
- **Internal helpers** (`ci_caller_org`, `ci_brand_can_view`, `ci_serve_intelligence`, `ci_match_creators`) are
  `REVOKE`d from `public/anon/authenticated` and granted only to `service_role`; browsers can reach only the
  four `api` functions.

---

## 4. Matching logic (deterministic, brief-specific, no AI)

`intel.ci_match_creators(request)` is pure SQL over the feature store — same inputs always produce the same
`ci_match_result` rows. For each candidate (a creator with an **active relationship to the request's org**):

**Hard filters** (a miss makes the creator ineligible for *this* brief, not "bad"):
- an **active platform connection** (`ci_identity_platform_account` valid + `ci_platform_connection` active);
- **category overlap** between the brief and the creator's professional categories.

**Soft signals** (each is an explainable, evidence-backed `matched_signal`; absence becomes an honest
`missing_signal`, never a penalty):
- **Requested-location audience** — share of a requested location within its *own* marginal distribution
  (country or city), computed without joining the two distributions and without a window function nested in an
  aggregate. Present ⇒ `"strong <loc> audience presence"`; absent ⇒ `"requested-location audience not evidenced"`.
- **Requested-format performance** — an `available` `content.engagement_per_follower` (30d) for the brief's
  format ⇒ `"strong <FORMAT> performance"`.
- **Confirmed brand experience** — a creator-confirmed, non-rejected `ci_creator_brand_experience` ⇒
  `"prior brand campaign experience"`.

**Always-honest limitations** are appended regardless: reliability `insufficient` ⇒
`"reliability data insufficient"`, and `"conversion data unavailable"` (V1 never has conversion data).

**Status & strength** are derived from the count of met signals, *not* from any score:
`match_status = no_match` (hard filter failed) · `insufficient_data` (connected but no computed run yet) ·
`match` (≥2 signals) · `partial` (connected, <2 signals). `match_strength = strong` (≥3) · `moderate` (2) ·
`weak` (<2). Results are append-only (`ci_match_result` blocks `UPDATE`/`DELETE`).

---

## 5. Frontend (`intelligence.js`, dark & flag-gated)

Boots exactly like `profile.js`: it calls `api.creator_profile_api_enabled()` and stays completely inert
unless the flag is on, so the nav entries and pages never appear in production. Two surfaces:

- **Creator "My Intelligence Profile"** (`renderIntelligence` / `ciIntel.loadSelf`): renders the six measures,
  each with an explicit status pill, an explanation, and a `Source · Updated · Confidence` meta line. Performance
  lists per-format metrics, each with a **View evidence** button that calls `api.get_feature_evidence`. Audience
  shows separate country/city distributions labelled "marginal only — never a joint intersection". Fraud always
  reads "estimate" and shows "No fabricated value" when insufficient. Coverage explains that disabling data
  sharing "lowers only this — it never lowers Performance, raises Fraud, or labels you unreliable".
- **Brand "Creator Intelligence Card" + matching** (`renderBrandIntel` / `ciIntel.loadBrand`): a brief form that
  calls `api.match_creators` and renders a **Match Explanation** per creator (✓ strong signals / − missing),
  with the header "No creator is called 'best' or given a score". Each result (and a direct look-up) opens the
  restricted brand card via `api.get_creator_intelligence`; a `42501` renders a clear "you don't have access"
  message rather than leaking anything.

No value is ever fabricated in the client: missing renders as "Insufficient data" / "—", never `0`.

---

## 6. Testing

`supabase/tests/09_phase1d_serving_test.sql` (pgTAP, 51 assertions, runs in a transaction and rolls back)
drives the **real** 1C compute pipeline to produce genuine feature runs, then exercises the serving/evidence/
matching layer. Coverage includes: matching store is service-role-only; browsers cannot execute the internal
helpers; no PII columns on the matching tables; self tier exposes traceable metrics and no PII; brand tier hides
the raw metric dump; the evidence resolver returns real sources + model version; the four required behaviours —

1. **strong creator ⇒ explainable match** (category ✓, location-audience ✓, format-performance ✓, brand-experience
   ✓; missing conversion −);
2. **new creator ⇒ insufficient_data** (self performance & fraud `insufficient_data`; never fabricated into a
   strong match);
3. **capability disable moves Coverage only** — disabling `performance_insights` lowers verified-data coverage
   while served **performance status is unchanged and fraud is not raised** (no fabricated value);
4. **unrelated brand ⇒ access denied** (`42501`) **and** an empty candidate pool (org isolation);

plus provenance existence and append-only match history. The suite is wired into the
`legacy-coexistence` CI job (`.github/workflows/creator-intelligence-db.yml`) alongside suites 00–08, and the
legacy `public` fingerprint assertion in `01_legacy_coexistence_test.sql` confirms the additive migration leaves
the existing app's schema unchanged.

---

## 7. Future AI extension points (explicitly NOT built in 1D)

The layer is shaped so that AI can be added later **without** touching the trust guarantees:

- **NL brief → structured `requirements`.** An LLM may populate the `ci_matching_request.requirements` JSON from
  a natural-language brief. It writes *only* that structured input; `ci_match_creators` remains the deterministic
  source of truth. The LLM never sees or writes feature values, measures, or match results.
- **Narrative summaries over served payloads.** An LLM may phrase the *already-computed* `matched_signals` /
  measures into prose. It must quote the served statuses verbatim and may not introduce a number, a score, or a
  suitability verdict the payload doesn't contain.
- **New measures / models** attach at the 1C feature-store layer (new `feature_key`s, a bumped `model_version`),
  and flow through the existing serving projection unchanged.

Out of scope for 1D and still off: NL search, AI chatbot, vector DB, autonomous creator selection, a fraud ML
model, global creator ranking, brand recommendations without evidence, a public creator marketplace, Meta live
activation, and production feature enablement.
