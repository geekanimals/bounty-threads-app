# Phase 1E — Campaign Intelligence Ingestion Framework (DESIGN — approved; not yet implemented)

**Status: APPROVED for build (2026-09-23) with the decisions recorded in §9. No migrations written yet,
nothing applied, no flags enabled, and — per the approval — no production changes.** The approved scope is to
build **Phase 1E-A (the extraction pipeline)** on a disposable cluster *before* any production migration.
Sections 1–8 are the reviewed design; **§9 is authoritative** where it refines them (content-format vocabulary,
append-only/versioned imports, Geek-proprietary evidence as a first-class source, conservative brand resolution
thresholds, deferred reliability, and the no-score rule), and §9 also carries the Phase 1E-A migration plan and
the seed fixtures (Doritos, Kurkure × Masaba, Sting, Lay's Wafer Style).

This document is the design deliverable for Phase 1E: it audits the existing 0A–1D architecture, maps what is
reused vs. genuinely new, and specifies (1) an architecture, (2) a migration plan, (3) a database schema
proposal, (4) an extraction pipeline design, and (5) a validation framework.

The whole layer is **additive + dark**, exactly like 0A–1D: new objects live in the unexposed `intel` /
`private` schemas, reachable only through `SECURITY DEFINER` `api` functions that stay off the Data API in
production; every new flag defaults **false**; the legacy `public` schema is never modified, so its fingerprint
is unchanged. No campaign data is invented — every extracted data point carries **source, confidence,
extraction method, and timestamp**, and anything unavailable is stored as `NULL` with an explicit
`unavailable` status (never `0`, never a fabricated value).

---

## 1. Audit of the existing 0A–1D architecture

### 1.1 What already exists (relevant to campaigns / brands / creators / performance)

**Intelligence layer (`intel`, provenance-bearing):**

| Concern | Existing model | Notes |
|---|---|---|
| Brand entity | `intel.ci_brand` | canonical brand: `name, aliases[], domain, parent_brand_id`. **The** brand model. |
| Creator identity | `intel.ci_creator_identity` (+ `ci_identity_link`, `ci_identity_platform_account`, `ci_platform_account`) | canonical creator + identity graph. |
| Creator↔brand collaboration | `intel.ci_creator_brand_experience` | already has `campaign_id` (soft ref to `public.campaigns`), `compensation_type ∈ {paid,barter,hybrid,ambassador,affiliate,ugc,organic_mention}`, `source_type ∈ {geek_campaign_verified, imported_historical, …}`, `verification_status`. |
| Dream brands | `intel.ci_creator_brand_aspiration` | aspiration, not history. |
| Commercial preference | `intel.ci_creator_commercial_preference`, `ci_creator_rate_card(_item)` | declared **preferences/rates**, not campaign actuals. |
| Published content | `intel.ci_media`, `ci_media_version`, `ci_media_insights` | real posts + performance metrics. |
| Mentions/tags | `intel.ci_mentions`, `ci_comments` (+ `private.ci_comment_raw`) | organic brand-mention detection lives here. |
| Org↔creator scope | `intel.ci_org_creator_relationship` | relationship-scoped access (used by 1D auth). |
| Ingestion runs | `intel.ci_ingest_run`, `ci_ingest_stage` | run/staging model — but `identity_id NOT NULL` (creator-centric). |
| Feature store | `intel.ci_feature_definition`, `ci_feature_run`, `ci_feature_value`, `ci_measure_snapshot`, `ci_measure_component` | append-only, `observed/derived/predicted`, six explainable measures, `value_status`, `confidence`. |
| Provenance | `intel.ci_feature_evidence` | `source_kind, source_table, source_row_id, ingest_run_id` envelope. |
| Matching brief (1D) | `intel.ci_matching_request`, `ci_match_result` | a **matching query** + result — NOT a historical campaign brief. |
| Serving (1D) | `api.get_my_creator_intelligence`, `get_creator_intelligence`, `get_feature_evidence`, `match_creators` | explainable serving surface. |

**Operational layer (legacy `public`, thin per-org CRM — the *source* of historical campaign data):**

| Table | Shape (abridged) | Role as a 1E source |
|---|---|---|
| `public.campaigns` | `id, org_id, name, brand(text), type, status, progress, creators` | the historical campaign header |
| `public.applications` | `id, org_id, campaign_id, campaign_name, creator_name, status` | creator participation (by name) |
| `public.story_deals` | `id, org_id, celebrity, brand, manager, value, fee, stage, proof_url` | celebrity/brand deal economics |
| `public.barter_items` | `id, org_id, creator, product, campaign, stage, value, reach` | barter economics + reach outcome |
| `public.social_accounts` | `id, member_id, username, followers…, audience jsonb, mentions jsonb` | creator resolution + audience |
| `private`/`intel` sources | `ci_media`, `ci_mentions`, `ci_creator_brand_experience` | content-detected & creator-declared history |

### 1.2 Key observations that shape the design

- **Brands, creators, content, and provenance are already modelled.** 1E must **reuse** `ci_brand`,
  `ci_creator_identity`, `ci_media`, and the `ci_feature_value` / `ci_feature_evidence` contract — not build
  parallel brand/creator/performance models.
- **`ci_creator_brand_experience` is the natural anchor** for "which creator worked with which brand on which
  campaign" and already anticipates historical import (`source_type='imported_historical'`,
  `campaign_id` soft ref). 1E formalises the *campaign* side that this table's `campaign_id` points at.
- **The feature store already reserves `reliability` as `insufficient_data` for lack of campaign evidence**
  (see 1C/1D). Campaign facts are exactly the missing evidence — so campaign-**derived** creator performance
  history and brand-category intelligence should flow into the **existing** feature store as new feature keys +
  a new evidence `source_kind`, rather than a second metrics system.
- **`ci_ingest_run` is creator-centric (`identity_id NOT NULL`).** A campaign import is not scoped to one
  creator, so 1E needs its own import-run/staging axis (not a duplicate of ingestion — a different ingestion
  source), mirroring the same run/stage/provenance contract.

---

## 2. Anti-duplication decision table

| 1E requirement | Decision | Existing model reused |
|---|---|---|
| Brand entity / **brand category intelligence** | **Reuse** `ci_brand`; add thin observed `ci_brand_category` feeding **derived** features | `ci_brand` |
| Creator entity | **Reuse** — never a new creator table | `ci_creator_identity` (+ identity graph) |
| **Creator participation** | **New** `ci_campaign_participation` linking existing creator↔campaign; **link** to `ci_creator_brand_experience` | `ci_creator_identity`, `ci_creator_brand_experience` |
| **Historical Geek campaigns** | **New** `ci_campaign` (canonical); soft-links legacy `public.campaigns.id` | `ci_brand` for the brand FK |
| **Campaign briefs** | **New** `ci_campaign_brief` (a brief that *ran*) — distinct from 1D `ci_matching_request` (a matching *query*) | — (structurally like the 1D requirements jsonb) |
| **Deliverables / content formats** | **New** `ci_campaign_deliverable`; resolves to a real post via nullable FK to `ci_media` | `ci_media` |
| **Barter/cash/hybrid economics** | **New** `ci_campaign_economics`; **reuse** the `compensation_type` enum | `ci_creator_brand_experience.compensation_type` |
| **Campaign outcomes** | **New** `ci_campaign_outcome` (append-only, `value_status` like `ci_feature_value`) | feature-store value contract |
| **Creator performance history** | **No new table** — **derived** feature keys in the existing store | `ci_feature_value`, `ci_measure_snapshot` |
| **Brand feedback** | **New** `ci_campaign_brand_feedback`; raw text to `private` (like `ci_comment_raw`) | `private.ci_comment_raw` pattern |
| **Evidence provenance** | **Reuse** the envelope contract; per-fact provenance columns + a campaign evidence table mirroring `ci_feature_evidence` | `ci_feature_evidence` |
| **Ingestion** | **New** `ci_campaign_import_run` + `ci_campaign_stage` (campaign-scoped; `identity_id` nullable) — same contract as `ci_ingest_run`, different axis | `ci_ingest_run`/`ci_ingest_stage` pattern |

---

## 3. Architecture

```
 SOURCES (read-only)                 IMPORT / STAGING                 CANONICAL CAMPAIGN FACTS (intel, observed)
 ┌────────────────────┐   extract   ┌───────────────────┐  resolve+   ┌───────────────────────────────────────┐
 │ public.campaigns   │────────────▶│ ci_campaign_       │  promote   │ ci_campaign ── ci_brand (reuse)        │
 │ public.applications│             │  import_run        │───────────▶│ ci_campaign_brief                      │
 │ public.story_deals │             │ ci_campaign_stage  │            │ ci_campaign_participation ── ci_creator │
 │ public.barter_items│  (raw jsonb,│ (raw + mapping +   │            │   _identity (reuse) & ci_creator_brand_ │
 │ ci_media / mentions│   provenance│  confidence +      │            │   experience (link)                     │
 │ manual / CSV / API │   captured) │  resolution state) │            │ ci_campaign_deliverable ── ci_media     │
 │ brand-submitted    │             └───────────────────┘            │ ci_campaign_economics (compensation)   │
 └────────────────────┘                     │                        │ ci_campaign_outcome (append-only)      │
                                            │                        │ ci_campaign_brand_feedback (+private)  │
   Every promoted row carries:              │                        │ ci_brand_category                      │
   source · confidence · extraction_method ·│                        └──────────────────┬────────────────────┘
   extracted_at · value_status              │                                           │  observed evidence
                                            ▼                                           ▼  (source_kind='geek_campaign')
                                   HUMAN REVIEW for low-confidence /        EXISTING FEATURE STORE (1C) — DERIVED
                                   ambiguous entity resolution              ci_feature_value + ci_feature_evidence
                                   (unresolved ⇒ staged, never promoted)    new keys: campaign.participation_count,
                                                                            campaign.completion_rate,
                                                                            campaign.format_experience[…],
                                                                            campaign.category_experience[…],
                                                                            brand.category_affinity[…]
                                                                                          │
                                                                                          ▼
                                                          SIX MEASURES (1C) — reliability finally gains evidence;
                                                          SERVING + MATCHING (1D) unchanged, richer inputs
```

**Layering rules (unchanged from 0A–1D):**
- Browsers never touch `intel`/`private`. New reads (if any) go through `SECURITY DEFINER` `api` functions,
  flag-gated and unexposed in production. 1E is primarily an **ingestion** phase; serving continues through the
  1D surface, which simply gets richer feature inputs.
- Extraction/promotion functions are `SECURITY DEFINER`, `search_path=''`, granted to `service_role` only.
- Campaign **facts** are `observed`; creator performance history and brand-category intelligence are `derived`
  and live in the existing feature store — no parallel scoring, no opaque campaign "score".

---

## 4. Database schema proposal

### 4.1 The shared provenance envelope (applied to every canonical fact table)

Every extracted data point satisfies the "source · confidence · extraction_method · timestamp" rule via a
common column set (mirrors the 1C `ci_feature_value` contract):

```
  -- provenance envelope (NOT NULL where noted)
  source_kind        text not null,     -- legacy_campaigns | legacy_applications | legacy_story_deals |
                                        --   legacy_barter_items | ci_media_detected | brand_submitted |
                                        --   creator_declared | manual_entry | csv_import
  source_table       text,              -- exact origin table/system
  source_ref         text,              -- exact origin row id / external key (text: legacy ids are uuid, external may not be)
  extraction_method  text not null      -- exact_copy | parsed | derived | inferred | manual
        check (extraction_method in ('exact_copy','parsed','derived','inferred','manual')),
  confidence         numeric            -- 0..1; NULL when not applicable
        check (confidence is null or (confidence >= 0 and confidence <= 1)),
  extracted_at       timestamptz not null default now(),
  value_status       text not null default 'available'
        check (value_status in ('available','unavailable','insufficient_data','disputed')),
  import_run_id      uuid references intel.ci_campaign_import_run(import_run_id) on delete set null,
  created_at         timestamptz not null default now()
```

**Hard rule (no fabricated values):** on any table with a measured numeric column, a CHECK enforces
`value_status = 'available' OR <numeric column> IS NULL` — an unavailable/insufficient/disputed fact can never
carry a number. This is the same guard 1C uses on `ci_feature_value` / `ci_measure_snapshot`.

### 4.2 Canonical tables (all in `intel`, all new, all reusing existing FKs)

**`ci_campaign`** — one historical Geek campaign.
```
campaign_id        uuid pk
brand_id           uuid references intel.ci_brand(brand_id)         -- REUSE (nullable until resolved)
submitted_brand_name text                                          -- raw brand string when unresolved
org_id             uuid                                            -- owning org (from legacy public.campaigns.org_id)
legacy_campaign_id uuid                                            -- SOFT ref to public.campaigns(id); no hard FK (dark)
title              text
campaign_type      text check (campaign_type is null or campaign_type in ('barter','cash','hybrid','organic','unknown'))
status             text check (status is null or status in ('planned','live','in_production','completed','cancelled','unknown'))
started_on         date  ended_on date  check (ended_on is null or started_on is null or ended_on >= started_on)
+ provenance envelope
constraint ci_campaign_has_brand_ck check (brand_id is not null or submitted_brand_name is not null)
constraint ci_campaign_src_uq unique (source_kind, source_ref)     -- idempotent import; no duplicate campaigns
```

**`ci_campaign_brief`** — the brief that ran (distinct from the 1D matching query).
```
brief_id       uuid pk
campaign_id    uuid not null references intel.ci_campaign(campaign_id) on delete cascade
requirements   jsonb            -- {categories[],locations[],platforms[],content_formats[],deliverables[],audience{...}}
brief_text_ref text             -- pointer to private raw text if any (never inline PII)
+ provenance envelope
```

**`ci_campaign_participation`** — creator participation (reuses the creator identity + links declared experience).
```
participation_id   uuid pk
campaign_id        uuid not null references intel.ci_campaign(campaign_id) on delete cascade
identity_id        uuid references intel.ci_creator_identity(identity_id) on delete set null  -- REUSE (nullable until resolved)
submitted_creator_name text                                        -- raw name when unresolved
experience_id      uuid references intel.ci_creator_brand_experience(experience_id) on delete set null  -- LINK, no duplicate
role               text        -- creator | celebrity | ambassador
participation_status text check (participation_status is null or participation_status in
                     ('invited','applied','selected','delivered','completed','dropped','unknown'))
+ provenance envelope
constraint ci_part_has_creator_ck check (identity_id is not null or submitted_creator_name is not null)
constraint ci_part_src_uq unique (source_kind, source_ref)
```

**`ci_campaign_deliverable`** — deliverables + content formats; resolves to a real post when known.
```
deliverable_id  uuid pk
participation_id uuid not null references intel.ci_campaign_participation(participation_id) on delete cascade
content_format  text          -- reel | story | static | carousel | live | ugc_no_post | store_visit | usage_rights (open vocab, documented)
quantity        int check (value_status='available' or quantity is null)
media_row_id    uuid references intel.ci_media(media_row_id) on delete set null   -- REUSE when the post is identified
deliverable_status text check (deliverable_status is null or deliverable_status in
                    ('agreed','submitted','approved','published','missed','unknown'))
+ provenance envelope
```

**`ci_campaign_economics`** — barter/cash/hybrid economics (reuses the compensation vocabulary).
```
economics_id    uuid pk
campaign_id     uuid not null references intel.ci_campaign(campaign_id) on delete cascade
participation_id uuid references intel.ci_campaign_participation(participation_id) on delete cascade  -- null = campaign-level
compensation_type text check (compensation_type is null or compensation_type in
                   ('paid','barter','hybrid','ambassador','affiliate','ugc','organic_mention'))  -- REUSE enum from ci_creator_brand_experience
cash_amount     numeric  check (value_status='available' or cash_amount is null)
product_value   numeric  check (value_status='available' or product_value is null)
currency        text default 'INR'
+ provenance envelope
```

**`ci_campaign_outcome`** — append-only observed outcomes (shape mirrors `ci_feature_value`).
```
outcome_id      uuid pk
campaign_id     uuid not null references intel.ci_campaign(campaign_id) on delete cascade
participation_id uuid references intel.ci_campaign_participation(participation_id) on delete cascade
metric_key      text not null   -- outcome.reach | outcome.impressions | outcome.engagement | outcome.emv | outcome.deliverables_completed
value_num       numeric  check (value_status='available' or value_num is null)   -- unavailable => NULL, never 0
unit            text
observed_at     timestamptz
+ provenance envelope
constraint ci_outcome_src_uq unique (campaign_id, participation_id, metric_key, source_kind, source_ref)
-- append-only: UPDATE/DELETE blocked by trigger (reuse the intel.tg_block_mutation pattern)
```

**`ci_campaign_brand_feedback`** — brand feedback on a creator's participation (raw text stays private).
```
feedback_id     uuid pk
campaign_id     uuid not null references intel.ci_campaign(campaign_id) on delete cascade
participation_id uuid references intel.ci_campaign_participation(participation_id) on delete cascade
brand_id        uuid references intel.ci_brand(brand_id) on delete set null
rating          numeric check (rating is null or (rating >= 0 and rating <= 5)) check (value_status='available' or rating is null)
sentiment       text check (sentiment is null or sentiment in ('positive','neutral','negative','mixed'))
comment_ref     uuid    -- pointer to private.ci_campaign_feedback_raw(id); never inline text
+ provenance envelope
```
plus **`private.ci_campaign_feedback_raw`** `(id, feedback_id, raw_text, created_at)` — raw feedback text lives
in `private` only, exactly like `private.ci_comment_raw`; the intel row references it by id and never inlines it.

**`ci_brand_category`** — thin observed brand-category signal (feeds derived brand-category intelligence).
```
brand_category_id uuid pk
brand_id        uuid not null references intel.ci_brand(brand_id) on delete cascade  -- REUSE
category        text not null
+ provenance envelope   -- source_kind e.g. legacy_campaigns (brand ran fitness campaigns) | manual | inferred
constraint ci_brand_category_uq unique (brand_id, category, source_kind, source_ref)
```

### 4.3 Import run + staging (campaign-scoped ingestion axis)

**`ci_campaign_import_run`** (mirrors `ci_ingest_run`, but campaign-scoped; `identity_id` **nullable**):
```
import_run_id  uuid pk
source_kind    text not null           -- which source this run pulled from
trigger        text default 'manual'
status         text default 'queued' check (status in ('queued','running','complete','partial','failed_terminal','cancelled'))
started_at timestamptz  completed_at timestamptz  correlation_id text  created_at timestamptz default now()
counts         jsonb     -- {extracted, staged, promoted, needs_review, rejected}
```

**`ci_campaign_stage`** — raw extracted rows before promotion.
```
stage_id       uuid pk
import_run_id  uuid not null references intel.ci_campaign_import_run(import_run_id) on delete cascade
source_kind    text not null  source_table text  source_ref text
raw            jsonb not null                 -- verbatim source row (no transformation, no invention)
resolved_brand_id    uuid references intel.ci_brand(brand_id)
resolved_identity_id uuid references intel.ci_creator_identity(identity_id)
resolution_status text default 'unresolved' check (resolution_status in ('unresolved','auto_resolved','needs_review','resolved','rejected'))
resolution_confidence numeric check (resolution_confidence is null or (resolution_confidence between 0 and 1))
promoted_at    timestamptz
constraint ci_stage_src_uq unique (source_kind, source_ref)   -- idempotent staging
```

### 4.4 Feature-store extension (DERIVED — no new metrics tables)

New rows only, in the **existing** store:
- `intel.ci_feature_definition`: register `campaign.participation_count`, `campaign.completion_rate`,
  `campaign.format_experience`, `campaign.category_experience`, `campaign.avg_days_to_deliver`,
  `brand.category_affinity` — all `evidence_type='derived'` (or `observed` for raw counts).
- `intel.ci_feature_evidence.source_kind`: add the value **`geek_campaign`**; evidence rows resolve to real
  `ci_campaign_participation` / `ci_campaign_outcome` / `ci_campaign_deliverable` rows.
- The **`reliability`** measure (today `insufficient_data` for want of campaign evidence) can now be computed
  from completion/delivery facts — still with an explicit status, still never fabricated when data is thin.

### 4.5 Security posture (unchanged model)
- All new `intel`/`private` tables: `ENABLE ROW LEVEL SECURITY`; `REVOKE ALL … FROM anon, authenticated`;
  grants to `service_role` only. Append-only tables (`ci_campaign_outcome`, feedback) get the
  `tg_block_mutation` trigger. Raw feedback text is `private`-only.
- Extraction/promotion functions: `SECURITY DEFINER`, `search_path=''`, `REVOKE` from public/anon/authenticated,
  `GRANT EXECUTE` to `service_role`.
- No new `api` surface is required for 1E; if a read is later needed it is a flag-gated `SECURITY DEFINER`
  `api` function (unexposed in production), consistent with 1D.

---

## 5. Migration plan (additive, dark, reversible — to be written only after approval)

Ordered, each additive and independently replayable on a disposable cluster (no production apply, no `supabase
db push`, no flag enablement):

1. **`1E.1 campaign facts core`** — `ci_campaign`, `ci_campaign_brief`, `ci_campaign_participation`,
   `ci_campaign_deliverable`, `ci_campaign_economics` + provenance envelope + CHECKs + RLS + service_role grants
   + FK/query indexes.
2. **`1E.2 outcomes, feedback, brand category`** — `ci_campaign_outcome` (append-only),
   `ci_campaign_brand_feedback`, `private.ci_campaign_feedback_raw`, `ci_brand_category` + RLS + append-only
   triggers.
3. **`1E.3 import pipeline`** — `ci_campaign_import_run`, `ci_campaign_stage`; `SECURITY DEFINER`
   extractor functions (one per source: legacy campaigns/applications/story_deals/barter_items, plus a manual/CSV
   entrypoint) that **stage raw rows only**; a deterministic promoter that resolves brand/creator and writes
   canonical facts with confidence + extraction_method; all service_role-only, all guarded by
   `to_regclass('public.…')` so they no-op when a legacy source is absent.
4. **`1E.4 feature-store extension`** — register the new `campaign.*` / `brand.category_affinity` feature
   definitions and extend the campaign→feature derivation to emit `ci_feature_value` + `ci_feature_evidence`
   (`source_kind='geek_campaign'`); no change to the six-measure contract.
5. **`1E.5 FK/index hardening`** — covering indexes on the real query/join paths only (no speculative indexes).
6. **pgTAP `10_phase1e_campaign_intelligence_test.sql`** + wire into the `legacy-coexistence` CI job.

**Reversibility:** every migration is additive; a down path drops only the new `intel`/`private` objects and
the new feature definitions. The legacy `public` schema is never touched, so coexistence/fingerprint is
guaranteed. **Flags:** any new flag (e.g. `campaign_intelligence_import`) ships **false**.

---

## 6. Extraction pipeline design

**Principle — copy or label, never invent.** The extractor reads a source row and writes it **verbatim** into
`ci_campaign_stage.raw`. Promotion maps fields to canonical columns with an explicit `extraction_method`:
`exact_copy` (field present, taken as-is), `parsed` (structured out of a text field), `derived` (computed from
present fields), `inferred` (a labelled guess with a confidence < 1), or `manual`. A field absent in the source
becomes `NULL` with `value_status='unavailable'` — never `0`, never a placeholder.

**Sources (v1):** `public.campaigns` → `ci_campaign`; `public.applications` → `ci_campaign_participation`;
`public.story_deals` / `public.barter_items` → `ci_campaign_economics` + `ci_campaign_outcome` (reach); optional
`ci_media` / `ci_mentions` → content-detected deliverables/participation. Manual & CSV entrypoints for offline
historical campaigns. Each extractor is `to_regclass`-guarded so a missing legacy table is a clean no-op
(the same coexistence discipline the 1D test needed).

**Entity resolution (never fabricate an entity):**
- **Brand:** match the raw brand string against `ci_brand.name`/`aliases[]` (case/alias-normalised). Exact →
  `auto_resolved` (confidence 1.0); fuzzy → `needs_review`; none → stays `unresolved`, campaign keeps
  `submitted_brand_name` and `brand_id NULL`. No new brand row is created without review.
- **Creator:** resolve `creator_name` / handle via the identity graph
  (`ci_identity_platform_account`, `public.social_accounts.username`, `ci_creator_identity`). Ambiguous →
  `needs_review`; unresolved participation keeps `submitted_creator_name` and `identity_id NULL`.
- Where a promoted participation matches a creator's own declared history, **link** the existing
  `ci_creator_brand_experience.experience_id` rather than duplicating the collaboration.

**Confidence model:** `resolution_confidence` (entity match certainty) is recorded on the stage row;
`confidence` on each promoted fact reflects extraction certainty (`exact_copy` ⇒ high; `inferred` ⇒ the model's
stated value). A configurable **confidence floor** gates auto-promotion of `inferred` facts; below it, the row
is `needs_review` and never auto-promoted.

**Idempotency:** `(source_kind, source_ref)` unique on stage and on each canonical table — re-running an import
updates nothing silently and inserts no duplicates. Promotion is deterministic (same inputs ⇒ same canonical
rows), matching the 1C reproducibility discipline.

**Human-in-the-loop:** `needs_review` rows surface to an internal reviewer (a future flag-gated internal `api`);
promotion of ambiguous or inferred data requires review. Nothing is served to brands/creators from unreviewed,
low-confidence campaign facts.

**Feed to the feature store:** after promotion, a derivation step emits `campaign.*` feature values with
`ci_feature_evidence(source_kind='geek_campaign')` rows pointing at the exact participation/outcome/deliverable
rows — so every derived number is traceable end-to-end, and `get_feature_evidence` (1D) already resolves it.

---

## 7. Validation framework

**Invariants (each becomes ≥1 pgTAP assertion in `10_phase1e_*`):**

| # | Invariant |
|---|---|
| V1 | Every canonical fact row has `source_kind`, `extraction_method`, `extracted_at` (provenance completeness). |
| V2 | No fabricated values: `value_status <> 'available'` ⇒ the numeric column IS NULL (per-table CHECK). |
| V3 | `confidence` and `resolution_confidence` are NULL or within `[0,1]`. |
| V4 | FK integrity: every `brand_id`→`ci_brand`, `identity_id`→`ci_creator_identity`, `campaign_id`→`ci_campaign`, `media_row_id`→`ci_media` resolves (or is NULL with a `submitted_*` fallback + `unavailable`/`needs_review`). |
| V5 | No duplicate entities: `(source_kind, source_ref)` unique on campaign/participation/stage; a re-import creates zero duplicates. |
| V6 | Append-only: `UPDATE`/`DELETE` on `ci_campaign_outcome` and feedback are blocked. |
| V7 | Resolution never invents: an unresolved brand/creator leaves `*_id` NULL + `submitted_*` set + status `unresolved`/`needs_review`; no `ci_brand`/`ci_creator_identity` row is created by the extractor. |
| V8 | Every `campaign.*` derived feature value has evidence rows (`source_kind='geek_campaign'`) resolving to real campaign fact rows. |
| V9 | Isolation: `anon`/`authenticated` cannot read any `intel`/`private` 1E table; extractor/promoter functions are service_role-only; raw feedback text is private-only. |
| V10 | Dark & coexistence: new flags default false; `to_regclass`-guarded extractors no-op without legacy sources; the legacy `public` fingerprint is unchanged. |
| V11 | `unavailable`-not-`zero`: a fixture with a missing outcome yields `value_status='unavailable'` and `value_num IS NULL` (never a 0 row). |

**Test/verification plan (same gates as 0A–1D):** disposable PG17 cluster → clean apply of all migrations +
deterministic replay → full pgTAP suite (00–09 + new 10) → legacy-coexistence with the public-fingerprint
assertion → secret scan → `db lint` → type-gen (non-blocking). CI: add `10_phase1e_*` to the coexistence
`pg_prove` list. No production apply; production stays flags-off with `intel`/`private`/`api` unexposed.

---

## 8. Explicitly NOT in Phase 1E (and open questions for the review)

**Not in scope:** exposing any `api`/`intel`/`private` surface; enabling any flag; applying to production;
running real imports/backfills; an LLM extracting or inventing campaign facts (an LLM may later only *parse* a
provided text field into the structured `requirements` jsonb, labelled `extraction_method='parsed'` with a
confidence — never invent numbers, brands, creators, or outcomes); brand/creator auto-creation from
low-confidence matches; any global campaign ranking or opaque campaign score.

**Open questions — RESOLVED at approval; see §9 for the authoritative decisions and the refined schema.**
1. Economics granularity → **both** campaign-level and participation-level (nullable `participation_id`).
2. `content_format` → **TEXT + a controlled-vocabulary table** (`ci_content_format_vocab`); no hard enum.
3. Reviewer surface → **no UI/API reviewer in 1E**; review *states* exist, workflow stays out-of-band.
4. Reliability → **not activated in 1E**; land campaign evidence/features only; governance comes separately.
5. Brand resolution → **conservative**: ≥95% auto-link, 80–95% suggested-review, <80% unresolved; never
   silently merge.

*Design approved. Implementation proceeds Phase 1E-A first (extraction pipeline on a disposable cluster), dark
and additive, verified with the §7 framework before any commit — and with no production changes.*

---

## 9. Design Update v2 — approved decisions & Phase 1E-A migration plan (authoritative)

Approved 2026-09-23. This section is authoritative where it refines §§1–8. Nothing here is applied to
production; it defines what Phase **1E-A** builds and verifies on the disposable cluster first.

### 9.1 Approved decisions (locked)

1. **Economics grain — both.** `ci_campaign_economics.participation_id` is nullable: `NULL` = campaign-level,
   set = participation-level. Both may coexist for one campaign.
2. **Content format — TEXT + controlled-vocabulary table, no hard enum.** New table
   `intel.ci_content_format_vocab(format_key text primary key, label text, platform text, is_active boolean
   default true, notes text, created_at timestamptz default now())`, seeded (`reel, story, static_post,
   carousel, live, ugc_no_post, store_visit, usage_rights, paid_amplification, exclusivity_addon`).
   `ci_campaign_deliverable.content_format text references intel.ci_content_format_vocab(format_key)` — the
   vocabulary grows by inserting rows, not by code/enum changes.
3. **Reviewer surface — none in 1E.** Review *states* exist on the staging/canonical rows
   (`unresolved | needs_review | auto_resolved | resolved | rejected`), but there is **no** `api`/UI reviewer in
   1E. The review workflow is out-of-band; a reviewer surface is a later, separately-scoped phase.
4. **Reliability — not activated.** 1E lands campaign **evidence + `campaign.*` features** only. It does **not**
   compute or emit the `reliability` measure from campaign data and does not change the six-measure contract.
   Reliability governance (turning the measure on) is a separate phase.
5. **Brand/creator resolution — conservative, never silently merge.** On a `ci_campaign_stage` row,
   `resolution_confidence` gates the outcome: **≥ 0.95 → `auto_resolved`** (auto-link the existing entity);
   **0.80–0.95 → `needs_review`** (record `suggested_brand_id`/`suggested_identity_id`, do **not** link);
   **< 0.80 → `unresolved`** (keep the `submitted_*` string only). The promoter **never creates** a
   `ci_brand`/`ci_creator_identity` row and **never merges** two existing entities — merges are always explicit,
   human, and out-of-band.

### 9.2 Additional approved requirements (locked)

- **Geek proprietary evidence is first-class.** Add `source_authority text not null` to the provenance envelope
  with values `geek_proprietary | platform_api | brand_declared | creator_declared | third_party | inferred`.
  Geek's own verified campaign records import as `source_authority='geek_proprietary'`
  (`extraction_method='exact_copy'`) and are the highest-trust tier. **Authority precedence:** the current-
  revision resolver (see 9.3) prefers `geek_proprietary` over lower authorities, and a lower-authority import
  can **never** supersede a `geek_proprietary` current fact — preserving the proprietary moat and honouring
  "never silently merge/overwrite".
- **Append-only + versioned imports.** No canonical fact is ever updated or deleted in place. Corrections
  **append a new revision**; the effective value is computed by a "current" view. Provenance envelope gains:
  `revision int not null default 1`, `supersedes_id uuid` (prior revision this replaces, nullable),
  `content_hash text` (dedupe identical re-imports), `retracted_at timestamptz` (tombstone; a retraction is a
  new appended row, not a delete). Constraints: `unique (source_kind, source_ref, revision)`; **no** hard
  `unique(source_kind, source_ref)` (multiple revisions are expected). Append-only is enforced by the reused
  `intel.tg_block_mutation` trigger (blocks `UPDATE`/`DELETE`). `ci_campaign_import_run` is an immutable ledger
  (one row per run; append-only). A set of `*_current` views projects the latest non-retracted revision per
  logical key, respecting authority precedence.
- **No scores of any kind.** No `campaign_score`, `creator_score`, or `success_score`; no blended/aggregate
  "success" number anywhere in facts, features, or serving. Campaign outcomes remain **individual observed
  metrics** (`outcome.reach`, `outcome.emv`, …) each with `value_status`; the intelligence surface stays the
  six explainable measures (with reliability off), consistent with the 1D "no opaque score" rule.
- **Seed fixtures:** the extraction fixtures start with **Doritos**, **Kurkure × Masaba**, **Sting**, and
  **Lay's Wafer Style** (see 9.5). Fixtures are clearly synthetic test data — no real campaign performance is
  asserted as fact.
- **Build order:** **Phase 1E-A (extraction pipeline) is built and verified on the disposable cluster before
  any production migration.** No production changes in 1E-A.

### 9.3 Schema deltas vs. §4 (net changes)

- **Provenance envelope (§4.1)** gains: `source_authority` (NOT NULL, CHECK as above), `revision`,
  `supersedes_id`, `content_hash`, `retracted_at`. The no-fabrication CHECK (`value_status='available' OR
  numeric IS NULL`) and the `[0,1]` confidence CHECK are unchanged.
- **`ci_content_format_vocab`** added (9.1.2); `ci_campaign_deliverable.content_format` FKs to it.
- **Uniqueness** changes from `(source_kind, source_ref)` to `(source_kind, source_ref, revision)` on every
  versioned fact table; "current" is a **view**, not a column, so append-only holds.
- **`ci_campaign_stage`** gains `suggested_brand_id`, `suggested_identity_id`, and keeps
  `resolution_status` + `resolution_confidence` with the 9.1.5 thresholds.
- **Current-revision views:** `ci_campaign_current`, `ci_campaign_participation_current`, etc. — latest
  non-retracted revision per logical key, authority-preferring. Serving/derivation read the views, never
  raw revisions.
- **Feature store (§4.4):** register `campaign.participation_count`, `campaign.completed_count`,
  `campaign.format_experience`, `campaign.category_experience`, `campaign.avg_days_to_deliver`,
  `brand.category_affinity` (evidence_type `observed`/`derived`) and the `geek_campaign` evidence
  `source_kind`. **`reliability` is not emitted or changed.**

### 9.4 Phase 1E-A migration plan (disposable-cluster build; NO production apply)

Additive, dark, reversible, each replayable on the disposable PG17 harness. Nothing is pushed to production and
no flag is enabled (`campaign_intelligence_import` ships **false**).

| Step | Migration (working name) | Contents |
|---|---|---|
| 1E-A.1 | `ci_1e_vocab_and_provenance` | `ci_content_format_vocab` (+ seed); document the provenance envelope + `source_authority`; reuse `tg_block_mutation`. |
| 1E-A.2 | `ci_1e_campaign_facts_core` | `ci_campaign`, `ci_campaign_brief`, `ci_campaign_participation`, `ci_campaign_deliverable`, `ci_campaign_economics` — versioned/append-only, provenance envelope, CHECKs, RLS, service_role grants, append-only triggers. |
| 1E-A.3 | `ci_1e_outcomes_feedback_brandcat` | `ci_campaign_outcome` (append-only), `ci_campaign_brand_feedback`, `private.ci_campaign_feedback_raw`, `ci_brand_category`. |
| 1E-A.4 | `ci_1e_current_views` | `*_current` views (latest non-retracted revision, authority-preferring). |
| 1E-A.5 | `ci_1e_import_pipeline` | `ci_campaign_import_run` (ledger), `ci_campaign_stage`; `SECURITY DEFINER` `to_regclass`-guarded extractors (legacy campaigns/applications/story_deals/barter_items + manual/CSV); deterministic promoter honouring the 9.1.5 thresholds and authority precedence; service_role-only. |
| 1E-A.6 | `ci_1e_feature_extension` | register `campaign.*` / `brand.category_affinity` feature definitions + `geek_campaign` evidence source; derivation emits `ci_feature_value`+`ci_feature_evidence`. **No reliability emission.** |
| 1E-A.7 | `ci_1e_fk_indexes` | covering indexes on real join/query paths only. |
| 1E-A test | `supabase/tests/10_phase1e_campaign_intelligence_test.sql` | fixtures = the four seed campaigns; assert §7 + 9.6 invariants; wire into the `legacy-coexistence` CI job. |

**Reversibility:** additive-only; a down path drops the new `intel`/`private` objects, the views, and the new
feature definitions. Legacy `public` is untouched → coexistence/fingerprint guaranteed.
**Phase 1E-B (production migration) is a separate, later, explicitly-approved step — not part of 1E-A.**

### 9.5 Seed extraction fixtures (synthetic; drive the pipeline + tests)

Each fixture is a clearly-synthetic legacy-style source row set exercising a distinct pipeline path. No real
performance figures are represented as real; values exist only to test extraction/resolution/validation.

| Fixture | Path exercised |
|---|---|
| **Doritos** | Clean `legacy_campaigns` row, brand resolves by exact name (≥0.95 → `auto_resolved`), one participation auto-linked; `geek_proprietary` authority `exact_copy`. |
| **Kurkure × Masaba** | Brand **alias** resolution (`Kurkure`) + a creator (Masaba) landing in the **0.80–0.95** band → `needs_review`, recorded as `suggested_identity_id`, **not** linked. |
| **Sting** | **Barter/hybrid** economics (campaign- and participation-level) + an `outcome.reach`, plus a **missing** outcome stored as `value_status='unavailable'`, `value_num IS NULL` (proves no-zero). |
| **Lay's Wafer Style** | Brand alias (`Lay's`/`Lays`); a deliverable resolving to a `ci_media` post (content-detected); a **re-import** appends `revision=2` with a new `content_hash` (proves append-only/versioned idempotency and current-view resolution). |

### 9.6 Validation additions (on top of §7 V1–V11)

| # | Invariant |
|---|---|
| V12 | **No score:** no column, feature key, or served field is a `*_score` / blended success aggregate; outcomes stay individual observed metrics; the six-measure contract is unchanged and `reliability` is not emitted in 1E. |
| V13 | **Append-only/versioned:** `UPDATE`/`DELETE` on canonical facts are blocked; a correction appends `revision=n+1` with `supersedes_id`; the `*_current` view returns exactly one current row per logical key. |
| V14 | **Authority precedence:** a lower-authority re-import never supersedes a `geek_proprietary` current fact; `geek_proprietary` evidence is preserved as first-class. |
| V15 | **Vocab integrity:** every `ci_campaign_deliverable.content_format` exists in `ci_content_format_vocab`. |
| V16 | **Conservative resolution:** no `ci_brand`/`ci_creator_identity` row is created by the promoter; `<0.95` never auto-links; `0.80–0.95` records a suggestion without linking; `<0.80` stays unresolved. |
| V17 | **Idempotent re-import:** re-importing an unchanged source row (same `content_hash`) creates no new revision; a changed row appends exactly one new revision. |
