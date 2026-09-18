# Creator Intelligence Architecture

**Working title:** "Bloomberg for Creators" — an additive Creator Intelligence Engine for Geek Influencer OS (Bounty & Threads).

**Status:** Design only. No migrations, no code. This document is the blueprint that a later, phased implementation follows.

**Authors' stance:** principal software architect · data architect · ML product architect · privacy engineer.

**Prime directive:** *Additive and reversible.* Preserve every existing production behaviour. Introduce stable IDs, time-series, and a provenance-carrying feature store **alongside** the current name/free-text model, backfill, verify, then cut reads over — never a destructive rewrite.

---

## 0. Scope, principles, and non-negotiables

The engine must eventually serve: account & media time-series insights; campaign history; effective CPM / CPC / CPA / ROAS; category affinity; geographic strength; organic brand mentions; brand conflicts & exclusivity; content-quality analysis; comment sentiment; reliability & response behaviour; negotiated commercials; conversion behaviour; estimated fraud risk; brief-specific creator ranking; natural-language creator search; and — for **every** derived or predicted value — evidence, provenance, freshness, and confidence.

**Binding constraints (carried into every section below):**

1. **No scraping.** Only official Meta APIs.
2. **Consented professional-account data only.**
3. **Tokens never in browser-readable tables or client code.** They stay in `social_tokens` (service-role only) exactly as today.
4. **A fraud score is never stated as a fact.** It is an *estimate* with confidence, evidence, and an appeal path.
5. **No inference of sensitive personal characteristics** (ethnicity, religion, health, sexual orientation, precise individual identity of audience members, etc.).
6. **No single universal opaque creator score.** Intelligence is a set of named, explainable signals; any ranking is brief-specific and decomposable.
7. **Every derived/predicted result carries a provenance envelope:** source(s), model/rule version, calculation date, input window, sample size, confidence.
8. **Preserve existing production tables** until additive migrations and backfills are verified.
9. **Authorisation is enforced in the database** (RLS + `SECURITY DEFINER` functions), never by UI role visibility.
10. **Do not implement in this step.**

---

## 1. Existing-state findings

### 1.1 What exists today (inspected, not assumed)

**Frontend** is a static vanilla-JS app (`app.js` ~173 KB, `data.js`, `auth.js`, `login.js`, `consent.js`, `app.html`) plus public pages `p.html` (creator media kit) and `o.html` (org workspace). No build step; deployed on Vercel.

**Backend** is Supabase: Postgres + RLS, Auth (GoTrue), 6 Edge Functions, Storage bucket `ig-media`.

**Tables (16):** `members`, `invites`, `leads`, `creators`, `campaigns`, `barter_items`, `applications`, `dream_plans`, `story_deals`, `irm_contacts`, `social_accounts`, `org_profiles`, `social_tokens`, `platform_admins`, `ai_usage`, `audit_log`.

**Database functions (27):** identity/role (`my_org`, `my_role`, `members_guard`, `handle_new_user`), marketplace (`open_campaigns`, `my_applications`, `campaign_applications`, `apply_to_campaign`), public surfaces (`public_profile`, `public_org`), admin (`is_platform_admin`, `pending_members`, `set_member_status`, `admin_*` ×13, `audit_trigger`, `_admin_listable/_editable`).

**Edge Functions (6):** `instagram-login` (sign-in + first sync), `instagram-auth` (connect IG to an existing account), `instagram-refresh` (token refresh + re-sync; user + cron modes), `instagram-publish` (content publishing), `ai-chat` (OpenAI assistant, key server-side), `whatsapp-send` (WhatsApp Cloud API groundwork). Shared: `cors.ts`, `ig.ts` (`fetchProfileBundle`).

### 1.2 Multi-tenant security model (strong; keep it)

Every business table has `org_id` and RLS `org_id = my_org()`. `my_org()`/`my_role()` are `SECURITY DEFINER`. Members rows are created only by the `handle_new_user` trigger; a client cannot choose its `org_id` or escalate `role` (column-level `GRANT`, `members_guard` trigger). Cross-org surfaces are explicit `SECURITY DEFINER` functions (`open_campaigns`, `apply_to_campaign`, `public_*`, `admin_*`). Tokens are isolated in `social_tokens` (RLS on, **no** policies → service-role only). **This model is sound and the Creator Intelligence Engine must extend it, not weaken it.**

### 1.3 The core structural gap

There are **two disconnected notions of "creator"**:

- **`social_accounts`** — the *authoritative, Meta-sourced* creator: keyed by `ig_user_id` (stable Meta ID) + `member_id` (auth user). Holds real profile, `recent_media`, `avg_reach`, `audience`, `mentions`. Written only by Edge Functions.
- **`creators`** — the *agency roster* entry: `name`/`handle`/`followers`/`eng` as **free text**, `org_id`-scoped, **no** `ig_user_id`, **no** `member_id`, **no** link to `social_accounts`.

Nothing connects them except a name/handle string that may or may not match. Campaigns, barter, applications, IRM and story deals all reference creators (and brands) by **text**, not IDs. This is the single biggest obstacle to a trustworthy intelligence layer: **there is no stable creator identity spine.**

### 1.4 Data-shape findings

- **Snapshots, not time-series.** `social_accounts` is *overwritten* on every login/refresh (`upsert`/`update` on `(member_id, platform)` in `instagram-login` and `instagram-refresh`). Each refresh **discards** the previous numbers. No history → no trend, no time-series insight, no reliable "freshness."
- **No provenance anywhere.** `avg_reach` has no sample size, no `as_of`, no method. `audience`/`mentions` are opaque JSON blobs with no capture timestamp beyond the row's `updated_at`.
- **Derivations are ephemeral and client-side.** Engagement rate is computed in `p.html` at render time; the `matchScore()` heuristic in `app.js` is computed in the browser and never persisted. No feature store.
- **No brand entity.** `campaigns.brand`, `story_deals.brand` are text; Brand CRM/Portfolio are `GROUP BY brand`-string views.
- **No campaign↔creator membership.** `campaigns.creators` is an **integer count**. Approved participants are not linked to any creator row; `applications` capture intent (`campaign_id` uuid ✅, but applicant is `creator_name` text).
- **No commercials, no conversions.** Negotiated fees, exclusivity, CPA/ROAS inputs do not exist in the schema.

### 1.5 Existing relationships that rely on names / free-text instead of IDs

> This is the explicit inventory required by the brief. Each is a target for progressive ID migration.

| # | Location | Field(s) | Should reference | Current join method | Severity |
|---|----------|----------|------------------|---------------------|----------|
| R1 | `creators` ↔ `social_accounts` | `creators.name`, `creators.handle` | canonical creator identity / `ig_user_id` / `member_id` | none — string coincidence only | **Critical** |
| R2 | `barter_items.creator` | text name | `creator_id` → identity | `creators.ilike(name)` at reminder time (`remindBarter`) | **Critical** |
| R3 | `barter_items.campaign` | text name | `campaign_id` → `campaigns.id` | none | High |
| R4 | `applications.creator_name` | text | applicant identity / `member_id` | applicant known only via `org_id`; name denormalized | High |
| R5 | `campaigns.brand` | text | `brand_id` → brand entity | `GROUP BY` string (Brand CRM) | High |
| R6 | `campaigns.creators` | integer count | `campaign_participation` join rows | not modelled at all | High |
| R7 | `story_deals.celebrity` | text | creator/celebrity identity | none | Medium |
| R8 | `story_deals.brand` | text | `brand_id` | none | Medium |
| R9 | `story_deals.manager` | text | `members.id` (manager) | none | Medium |
| R10 | `irm_contacts.name`, `irm_contacts.handle` | text | creator identity / `social_accounts` | none | Medium |
| R11 | `dream_plans.creator_email` | text email | `member_id` | email-string match | Medium |
| R12 | `campaigns.platforms`, `campaigns.hashtags` | free text | normalized platform enum / tag entities | delimiter-parsed strings | Low |
| R13 | `creators.followers`, `creators.eng`, `creators.tier`, `creators.cat` | free text (`"128K"`, `"4.2%"`) | typed numerics / category enum | parsed ad hoc (`parseFollowers`) | Low |
| R14 | `social_accounts.mentions[].username` | text handle | brand/creator identity | none (raw Meta tag payload) | Low |

---

## 2. Data-flow architecture

### 2.1 Today (as-is)

```
Instagram (Meta Graph)
   │  OAuth code  ─────────────► instagram-login / instagram-auth (Edge, service role)
   │                                   │ exchange code → long-lived token
   │                                   │ fetchProfileBundle() (profile, 12 media, sampled reach, audience, tags)
   │                                   ▼
   │                          social_tokens  (token, service-role only)
   │                          social_accounts (SNAPSHOT — overwritten each sync)
   │
Browser (app.js, anon key + user JWT) ──RLS──► reads social_accounts / creators / campaigns …
   │                                   client-side ephemeral: engagement %, matchScore()
   └────────────────────────────────────────────────────────────────────────────────
Cron ──► instagram-refresh (x-cron-secret) ──► refresh token + OVERWRITE social_accounts
```

### 2.2 Target (to-be) — additive layer

```
Meta Graph ──► ci-ingest (Edge, service role, append-only)
                    │  writes provenance-stamped, immutable rows:
                    ▼
   ci_ingest_run ── ci_account_snapshots ── ci_media / ci_media_insights
                    ci_audience_snapshots ── ci_mentions ── ci_comments
                                            (raw / observed, time-series)
                    │
                    ▼  scheduled feature compute (SQL/materialized + Edge jobs)
             ci_metric  (feature store: observed→derived→predicted, each with provenance envelope)
                    │
        ┌───────────┴────────────┐
        ▼                        ▼
  ci_rank(brief) RPC        get_creator_intelligence() RPC   ── consent + RLS gated ──► Browser
  (explainable ranking)     (metrics + provenance)
        ▲
  nl_search() → LLM parses brief → ci_rank()   (LLM translates intent only; never invents metrics)

External conversion signals (UTM / promo / pixel) ──► ci_conversions ──► CPA/ROAS metrics
Agency-entered negotiated terms ──► ci_commercials (private) ──► effective-cost metrics
```

**Invariants:** raw ingestion is append-only and written only by service-role Edge Functions; the browser never touches raw metric tables directly — only consent- and RLS-gated views/RPCs; tokens never leave `social_tokens`.

---

## 3. Proposed entity-relationship model

All new objects live in a dedicated **`intel` schema** (prefixed `ci_` in prose) so they can be enabled/disabled/rolled back without touching `public`. Existing tables are extended only with **nullable** FK columns (Section 4).

### 3.1 Identity spine

- **`ci_creator_identity`** — the canonical creator. `identity_id uuid pk`, `ig_user_id text unique` (nullable for roster-only "shadow" creators), `member_id uuid null` (→ `auth.users`), `primary_username text`, `display_name text`, `is_claimed bool`, `merged_into uuid null` (soft-merge for de-dupe), `created_at`. **The spine every metric hangs from.**
- **`ci_identity_link`** — progressive backfill map. `identity_id`, `entity_schema`, `entity_table`, `entity_id`, `match_method` (`ig_user_id`|`member_id`|`handle_exact`|`name_fuzzy`|`manual`), `confidence numeric`, `linked_by`, `linked_at`. Lets us attach `creators`, `barter_items`, `irm_contacts`, `story_deals` rows to an identity **without** editing them yet, and records *how sure* we are.

### 3.2 Observed (raw, time-series, append-only)

- **`ci_ingest_run`** — one row per ingestion job: `run_id`, `source`, `scope`, `token_ref` (member_id/platform, **not** the token), `started_at`, `finished_at`, `status`, `api_calls`, `rows_written`, `error`.
- **`ci_account_snapshots`** — `identity_id`, `as_of`, `followers_count`, `follows_count`, `media_count`, `reach`, `impressions`, `profile_views`, `accounts_engaged`, `source`, `run_id`. Unique `(identity_id, as_of)`.
- **`ci_media`** — stable per-post record: `media_id text pk`, `identity_id`, `media_type`, `caption`, `permalink`, `posted_at`, `first_seen_at`.
- **`ci_media_insights`** — `media_id`, `as_of`, `reach`, `impressions`, `saved`, `likes`, `comments`, `shares`, `plays`, `total_interactions`, `source`, `run_id`. Unique `(media_id, as_of)`.
- **`ci_audience_snapshots`** — `identity_id`, `as_of`, `breakdown` (`age_gender`|`country`|`city`), `dimension`, `value`, `source`, `run_id`. (Meta aggregate demographics only; ≥100-follower gate respected.)
- **`ci_mentions`** — organic brand mentions: `identity_id`, `brand_id null`, `raw_brand text`, `media_id null`, `mention_type` (`tag`|`caption`|`hashtag`), `detected_at`, `source`, `evidence jsonb`.
- **`ci_comments`** + **`ci_comment_sentiment`** — comment text (retention-limited) and per-comment sentiment with `model_version`, `confidence`. (Sentiment is *derived*; see 3.4.)

### 3.3 Relationship & commercial entities (replace name/free-text)

- **`ci_brand`** — `brand_id`, `name`, `aliases text[]`, `domain`, `parent_brand_id null`. Normalizes R5/R8/R14.
- **`ci_campaign_participation`** — `campaign_id` (→ `public.campaigns`), `identity_id`, `role`, `status` (`invited`|`applied`|`approved`|`live`|`delivered`|`dropped`), `agreed_deliverables jsonb`, `created_at`. Models R6 and links R4.
- **`ci_commercials`** — **agency-private**: `campaign_id`, `identity_id`, `fee_amount`, `currency`, `fee_basis` (`flat`|`cpm`|`hybrid`), `exclusivity jsonb`, `entered_by`, `entered_at`. Feeds effective-cost metrics; never exposed to brand/creator without explicit grant.
- **`ci_conversions`** — external outcome events: `campaign_id`, `identity_id`, `source` (`utm`|`promo_code`|`pixel`|`manual`), `event_type` (`click`|`signup`|`purchase`), `count`, `revenue`, `occurred_on`, `evidence`. Feeds CPA/ROAS.

### 3.4 Derived & predicted (feature store)

- **`ci_metric`** — the serving feature store. One row per `(identity_id, metric_key, as_of, method_version)`:
  `metric_key` (e.g. `engagement_rate`, `avg_reach`, `effective_cpm`, `effective_cpc`, `effective_cpa`, `roas`, `category_affinity`, `geo_strength`, `content_quality`, `comment_sentiment`, `reliability`, `response_time`, `fraud_risk_estimate`), `value_num`, `value_json`, `unit`, `tier` (`observed`|`derived`|`predicted`), **provenance envelope** → `computed_at`, `window_start`, `window_end`, `sample_size`, `confidence numeric`, `method`, `model_version`, `inputs jsonb`, `run_id`. A `CHECK` constraint requires the envelope fields to be non-null for `tier <> 'observed'`. **`fraud_risk_estimate` is stored here like any other signal, tier=`predicted`, and always surfaced as an estimate with evidence.**
- **`ci_ranking_run`** — `run_id`, `brief jsonb` (normalized requirements + weights), `requested_by`, `created_at`.
- **`ci_ranking_result`** — `run_id`, `identity_id`, `rank`, `score`, `signal_contributions jsonb` (per-signal value × weight = contribution, so `Σ contributions = score`), `aggregate_confidence`, `hard_filters_passed jsonb`. **Explainable by construction; no opaque score.**

### 3.5 Consent & governance

- **`ci_consent`** — `identity_id`, `subject_member_id`, `scope text[]` (mirrors granted Meta scopes), `purpose`, `granted_to_org null` (null = own workspace), `granted_at`, `revoked_at null`, `evidence`. Drives ingestion eligibility and read authorisation.
- **`ci_data_request`** — access/export/delete requests (ties to `data-deletion.html` + Meta data-deletion callback): `identity_id`, `kind`, `status`, `requested_at`, `completed_at`.

### 3.6 ER summary (text)

```
ci_creator_identity 1─* ci_identity_link *─1 (creators | barter_items | irm_contacts | story_deals | applications | social_accounts)
ci_creator_identity 1─* ci_account_snapshots
ci_creator_identity 1─* ci_media 1─* ci_media_insights
ci_creator_identity 1─* ci_audience_snapshots
ci_creator_identity 1─* ci_mentions *─1 ci_brand
ci_creator_identity 1─* ci_metric
ci_creator_identity *─* public.campaigns   (via ci_campaign_participation)
ci_campaign_participation 1─1 ci_commercials
public.campaigns 1─* ci_conversions *─1 ci_creator_identity
ci_ranking_run 1─* ci_ranking_result *─1 ci_creator_identity
ci_creator_identity 1─* ci_consent
every raw/derived row ──► ci_ingest_run (provenance)
```

---

## 4. Table-by-table migration plan (additive, non-destructive)

**Rule for every row below:** add **nullable** columns only; **dual-write** from the app (keep writing the text field, additionally write the id when known); **backfill** via `ci_identity_link`/`ci_brand`; **verify** reconciliation; **then** switch reads to the id path behind a feature flag. **No `DROP`/`ALTER TYPE`/`NOT NULL` on legacy columns in Phase 1.** Legacy text columns are retained as fallback + audit for at least N release cycles after cut-over (Section 15).

| Existing table | Additive change | Backfill source | Read cut-over gated by |
|----------------|-----------------|-----------------|------------------------|
| `social_accounts` | `identity_id uuid null` FK → `ci_creator_identity` | `ig_user_id` exact (highest confidence) | flag `ci.identity` |
| `creators` | `identity_id uuid null`; keep `name/handle/followers/eng` text | `handle_exact` → else `name_fuzzy` (low confidence, needs review) | flag `ci.identity` |
| `campaigns` | `brand_id uuid null` FK → `ci_brand` | `ci_brand.name/aliases` match on `brand` text | flag `ci.brands` |
| `campaigns` | (participation moves out) keep `creators` int as cached count | derive count from `ci_campaign_participation` | flag `ci.participation` |
| `barter_items` | `creator_id uuid null`, `campaign_id uuid null` | link via identity (name→identity), campaign name→id | flag `ci.barter_ids` |
| `applications` | `applicant_identity_id uuid null` | applicant `member_id`→identity | flag `ci.app_ids` |
| `story_deals` | `celebrity_identity_id`, `brand_id`, `manager_member_id` (all null) | fuzzy + manual review | flag `ci.story_ids` |
| `irm_contacts` | `identity_id uuid null` | handle/name → identity | flag `ci.irm_ids` |
| `dream_plans` | `member_id uuid null` | `creator_email` → `members.email` | flag `ci.dream_ids` |

**Seeding the identity spine (Phase 0/1):** for every `social_accounts` row → upsert `ci_creator_identity` by `ig_user_id` (claimed identity). For every `creators` row with no IG match → create a **shadow identity** (`ig_user_id null`, `is_claimed=false`) so roster analytics have a stable key even before the creator connects Instagram. A later real IG connection **merges** the shadow into the claimed identity via `merged_into`.

---

## 5. RLS & authorisation matrix

Authorisation is enforced by RLS + `SECURITY DEFINER` read functions that **also check `ci_consent`** — never by the UI. Raw metric tables (`ci_account_snapshots`, `ci_media_insights`, …) have RLS **enabled with no client policies** (service-role writes only, like `social_tokens`); all client reads go through consent-checked functions/views.

Legend: **Own** = only their own identity's data · **Org** = identities linked to roster rows in their `org_id` · **Consented** = only where `ci_consent.granted_to_org` includes the reader's org (or via an approved `ci_campaign_participation`) · **—** = no access · **All** = cross-org.

| Object / capability | Creator | Brand | Agency (owner) | Corporate | Manager | Super Admin |
|---|---|---|---|---|---|---|
| `ci_creator_identity` (self) | Own | — | Org | Org | Org (talent) | All |
| `ci_account_snapshots` / `ci_media_insights` | Own | Consented | Org | Org | Org | All |
| `ci_audience_snapshots` (aggregate demo) | Own | Consented | Org | Org | Org | All |
| `ci_mentions` | Own | Consented | Org | Org | Org | All |
| `ci_metric` (derived signals) | Own | Consented | Org | Org | Org | All |
| `ci_metric` `fraud_risk_estimate` | Own (as estimate) | Consented (estimate + evidence) | Org | Org | Org | All |
| `ci_commercials` (negotiated) | Own rows | — | Org | Org | Org (own talent) | All |
| `ci_conversions` | Own | Consented (own campaigns) | Org | Org | Org | All |
| `ci_campaign_participation` | Own | Own campaigns | Org | Org | Org | All |
| `ci_rank(brief)` (ranking) | — | Consented pool | Org pool | Org pool | Org pool | All |
| `nl_search()` | — | Consented pool | Org pool | Org pool | Org pool | All |
| `ci_consent` (grant/revoke) | Own | — | request only | request only | request only | All (view) |
| raw tokens (`social_tokens`) | — | — | — | — | — | — (service role only) |

**Notes.** (a) A **brand** never sees a creator's data merely because the creator exists — only when the creator **consented to that brand** or **participated in that brand's campaign**. (b) **Agency/corporate/manager** see identities linked to *their own roster* (`org_id`), matching today's `creators` RLS. (c) Every cross-identity read (ranking, search) runs through a `SECURITY DEFINER` function that filters by consent + org before returning — the browser cannot enumerate identities.

---

## 6. Meta data capability matrix

Mapping the **approved** permissions to what is actually obtainable, and where each engine feature's raw inputs come from. Approved scopes: `instagram_business_basic`, `instagram_business_manage_insights`, `instagram_business_manage_comments`, `instagram_business_content_publish`, `instagram_business_manage_messages`, `public_profile`, `email`.

| Permission | Provides (raw) | Feeds engine features |
|---|---|---|
| `instagram_business_basic` | profile (id, username, name, account_type, followers/follows/media counts, picture, bio, website); media (caption, type, url, permalink, timestamp, like_count, comments_count, children) | identity, follower time-series, posting cadence, engagement rate |
| `instagram_business_manage_insights` | **account insights** (reach, impressions, profile_views, follower_count over time, accounts_engaged); **media insights** (reach, impressions, saved, likes, comments, shares, plays, total_interactions); **follower_demographics** (age·gender / country / city — *lifetime, aggregate, ≥100 followers*) | avg reach (with sample size), effective CPM/CPC base, geographic strength, category affinity (perf-weighted), content quality |
| `instagram_business_manage_comments` | comments on the creator's media; mentions/tags | comment sentiment, organic brand mentions, audience-response quality |
| `instagram_business_content_publish` | create/publish media (containers → publish) | *(publishing only — not analytics)* |
| `instagram_business_manage_messages` | conversations/messages metadata | reliability & **response behaviour** (response time) — **metadata/timing only; message content not stored** |
| `public_profile` | basic public profile | identity resolution, media-kit fallback |
| `email` | account email | account linkage, notifications |

**Explicitly NOT available from Meta creator APIs (must be derived, estimated, or externally sourced):**

| Target metric | Why Meta can't give it | Our source |
|---|---|---|
| Effective **CPM / CPC** | Meta gives delivery (reach/impressions), not price | reach/impressions (Meta) ÷ **negotiated fee** (`ci_commercials`, internal) → *derived* |
| **CPA / ROAS** | needs conversions & revenue | `ci_conversions` (UTM/promo/pixel, **external**) + `ci_commercials` → *derived* |
| **Fraud / authenticity** | Meta asserts no authenticity score | anomaly signals (engagement/follower ratios, spikes) → **`predicted` estimate, never fact** |
| **Category affinity / geo strength** | not a Meta field | NLP on captions/hashtags + demographics + perf → *derived* |
| **Brand conflicts / exclusivity** | not a Meta field | `ci_mentions` + campaign history + `ci_commercials.exclusivity` → *derived* |
| **Content quality** | not a Meta field | engagement consistency + optional vision analysis of `media_url` → *derived* |
| **Negotiated commercials** | private | agency-entered (`ci_commercials`) — *observed-internal* |
| **Conversion behaviour** | outside Meta | tracked links / promo codes / pixel — *external* |

---

## 7. Observed vs Derived vs Predicted data model

Every value in the engine is tagged `tier`:

- **Observed** — a fact retrieved from a source and stored verbatim, time-stamped. Meta metrics (`ci_account_snapshots`, `ci_media_insights`, `ci_audience_snapshots`) and internal facts (`ci_commercials`, `ci_conversions`). Provenance = `{source, as_of, run_id}`.
- **Derived** — deterministic computation over observed inputs by a **versioned rule** (`method` + `method_version`). Engagement rate, effective CPM/CPC/CPA/ROAS, category affinity, geo strength, content quality, comment sentiment (rule/model), reliability. Provenance = full envelope incl. `inputs`, `window`, `sample_size`, `confidence`.
- **Predicted** — model output with uncertainty; **may be wrong**. Fraud-risk **estimate**, forecast reach, conversion propensity. Provenance = envelope incl. `model_version`, `confidence`, and a mandatory `is_estimate=true` presentation flag.

**Presentation contract (enforced in API + UI):** derived and predicted values are **never** shown without their confidence and an "evidence" affordance (the inputs, window, sample size, and `as_of`). Fraud risk additionally shows the contributing signals and an appeal path, and is worded as an estimate. This is how requirement #4, #6, and #7 are honoured concretely.

---

## 8. Ingestion & refresh strategy

**Principle:** append-only, idempotent, provenance-stamped, service-role only.

- **New Edge Function `ci-ingest`** (or extend `instagram-refresh`) writes to `ci_*` snapshot tables using the token in `social_tokens`. Every run opens a `ci_ingest_run` and stamps `run_id` on every row.
- **Idempotency:** unique `(identity_id, as_of)` / `(media_id, as_of)`; a same-day re-run updates the day's row rather than duplicating, or is a no-op.
- **Cadence (per creator, consent-gated):**
  - Account snapshot — **daily** (cron; slow, cheap).
  - Media list + insights — on **new media** and a periodic **backfill** of recent posts (insights mature over ~48h; re-poll a post a few times then freeze).
  - Audience demographics — **weekly** (lifetime metric, slow-moving; skip if <100 followers).
  - Comments — **periodic / on-demand** for sentiment; retention-limited.
  - Messages metadata — **timing only**, for reliability; **no content stored**.
- **Backfill seed:** first run copies the current `social_accounts` snapshot into `ci_account_snapshots` + `ci_media` so history starts immediately (single point until daily accrues).
- **Token lifecycle** is unchanged: `instagram-refresh` keeps long-lived tokens alive (user-lazy + cron), tokens remain in `social_tokens`. `ci-ingest` reads tokens, **never** returns them.
- **Rate/limit safety:** per-run API budget in `ci_ingest_run.api_calls`; exponential backoff; partial-failure tolerant (one creator's failure never aborts the batch, mirroring today's `instagram-refresh` cron loop).
- **Consent gate:** `ci-ingest` skips any identity whose `ci_consent` is absent/revoked.

---

## 9. Feature-store design

- **Layers:** *raw* (`ci_*` observed, append-only) → *compute* (scheduled SQL / materialized views + Edge jobs) → *serving* (`ci_metric` + consent-gated read RPCs).
- **Compute:** each metric has a named, versioned recipe. Prefer set-based SQL (materialized views refreshed on a schedule) for deterministic derived metrics; use an Edge/worker job for NLP (sentiment, category) and model inference (fraud estimate). Each compute run writes new `ci_metric` rows (new `as_of`), never mutating prior rows → full history + freshness.
- **Confidence model:** `confidence = f(sample_size, recency, source_completeness)`, documented per metric; e.g. `avg_reach` confidence scales with number of posts sampled and falls as `as_of` ages past the freshness SLA.
- **Freshness SLA:** per `metric_key` (e.g. engagement_rate ≤ 24h stale, audience ≤ 8 days). Serving marks a metric `stale` past SLA; ranking down-weights stale signals via their confidence.
- **Serving API:** `get_creator_intelligence(identity_id)` (`SECURITY DEFINER`, consent + RLS) returns metrics **with** provenance envelopes. No raw-table access from the browser.
- **Backfill/replay:** because raw is immutable and recipes are versioned, any metric can be recomputed for an historical `as_of` (reproducibility + audit).

---

## 10. Ranking architecture

**No universal score.** Ranking is always **brief-specific** and **decomposable**.

1. **Brief normalization** → structured requirements: category, geo, min/max followers, platform, budget, deliverables, exclusivity constraints, hard filters vs soft preferences, and per-signal **weights**.
2. **Candidate generation** — apply *hard* filters (consented pool ∩ org scope ∩ constraint filters) over `ci_metric`/roster. Records `hard_filters_passed`.
3. **Scoring** — weighted sum of **named, normalized sub-signals**, each pulled from `ci_metric` with its own confidence: audience fit, category affinity, geo strength, cost efficiency (effective CPM/CPA), reliability, content quality, brand-safety. `score = Σ (normalized_signal × weight)`; `signal_contributions` stored so `Σ contributions = score` (auditable).
4. **Confidence** — `aggregate_confidence` combines sub-signal confidences; low-confidence signals contribute less and are flagged.
5. **Fraud is a separate gate, not a hidden term** — `fraud_risk_estimate` surfaces as an advisory flag with evidence; it can filter or annotate but is never silently folded into the score.
6. **Explainability** — every result returns its per-signal breakdown and evidence links. `ci_ranking_run`/`ci_ranking_result` persist the brief, weights, and contributions for audit and reproducibility.
7. **Natural-language search** — an LLM parses the query into the **structured brief** (filters + weights) and calls the same `ci_rank` pipeline. The LLM **translates intent only**; it never produces metric values, and every ranked result still carries DB-sourced provenance. (Provider note: the app already uses an OpenAI-backed `ai-chat`; the NL→brief parser should reuse that server-side pattern with the key server-side. Model/provider choice is an implementation decision, out of scope here.)

---

## 11. Privacy & consent lifecycle

1. **Grant** — at Instagram connect (scopes already requested today). Record `ci_consent` with `scope`, `purpose`, and default `granted_to_org = null` (own workspace). Sharing to a **brand** requires an explicit additional grant or an approved campaign participation.
2. **Minimize** — store Meta **aggregate** demographics only; store message **timing**, not content; retention-limit comment text; never store raw tokens outside `social_tokens`.
3. **No sensitive inference** — the engine must not infer ethnicity, religion, health, sexual orientation, or re-identify individual audience members. Category/geo features use Meta aggregates and public post text only.
4. **Purpose limitation** — metrics computed for evaluation/ranking; not sold, not cross-purposed.
5. **Revoke** — flips `ci_consent.revoked_at`; `ci-ingest` stops; a purge job removes/anonymizes that identity's raw + derived rows within the SLA and cascades to `ci_metric`, `ci_ranking_result`. Wired to the existing `data-deletion.html` flow and Meta's data-deletion callback.
6. **Access / export** — `ci_data_request` supports subject access and export; every ingestion and admin action is already audited (`audit_log`, `ci_ingest_run`).
7. **Fraud fairness** — estimates are labeled, evidenced, and appealable (a creator can contest; an override is recorded with provenance).

---

## 12. API contracts (design-level)

All are `SECURITY DEFINER`, re-check `is_platform_admin()`/`my_org()`/`ci_consent` internally, and return the provenance envelope on every derived/predicted value.

**Provenance envelope (returned with every non-observed value):**
```json
{
  "tier": "derived|predicted",
  "method": "engagement_rate.v2",
  "model_version": "sentiment-xx.2026-09",
  "computed_at": "2026-09-18T…Z",
  "window": { "start": "…", "end": "…" },
  "sample_size": 8,
  "confidence": 0.72,
  "is_estimate": false,
  "inputs": ["ci_media_insights:…"],
  "run_id": "…"
}
```

| Contract | Kind | Signature (design) | Auth |
|---|---|---|---|
| `ci_ingest(scope)` | Edge | run ingestion for an identity/batch → `ci_ingest_run` summary | service role / cron secret |
| `get_creator_intelligence(identity_id)` | RPC | → profile + `ci_metric[]` with envelopes | consent + RLS |
| `ci_rank(brief jsonb)` | RPC | → `ci_ranking_result[]` with `signal_contributions` | org/consent pool |
| `nl_search(query text)` | Edge+RPC | LLM → brief → `ci_rank` | org/consent pool |
| `grant_consent(scope, granted_to_org?)` / `revoke_consent()` | RPC | manage `ci_consent` | self (creator) |
| `enter_commercials(campaign_id, identity_id, terms)` | RPC | write `ci_commercials` | agency/corporate |
| `record_conversion(…)` | Edge | append `ci_conversions` | service role / signed source |
| `request_data(kind)` | RPC | file `ci_data_request` | self / admin |

---

## 13. Migration risks

| # | Risk | Mitigation |
|---|---|---|
| 1 | **Name-collision on backfill** (two creators, same name) — R1/R2/R10 fuzzy links | Store `match_method`+`confidence` in `ci_identity_link`; auto-link only on `ig_user_id`/`member_id`; queue fuzzy matches for manual review; never auto-merge low confidence |
| 2 | **Roster creators with no IG** never resolve to real data | Shadow identities (`is_claimed=false`); features marked low-confidence until claimed; merge on connect |
| 3 | **Snapshot→time-series gap** (history starts at go-live) | Seed from current `social_accounts`; communicate that trends need accrual time |
| 4 | **Meta API limits / demographics <100 followers / API changes** | Per-run budgets + backoff; capability-gate features; version the ingest against Graph fields |
| 5 | **RLS regression leaks cross-org / bypasses consent** | Consent checks inside `SECURITY DEFINER` fns; negative tests in CI; raw tables policy-less |
| 6 | **Token exposure** via a new surface | Tokens stay in `social_tokens`; `ci-ingest` reads, never returns; code review gate |
| 7 | **Dual-write drift** (id and text disagree) | Reconciliation tests; text remains source-of-truth until verified; flags gate cut-over |
| 8 | **Fraud estimate misread as fact** (reputational/legal) | Mandatory `is_estimate` presentation, evidence, appeal; contract-tested |
| 9 | **Cost blow-up** at scale (insights calls, NLP, vision) | Cadence tiering, sampling, caching, budget caps per `ci_ingest_run` |
| 10 | **Feature/model drift** silently degrades ranking | Versioned methods, golden datasets, monitoring; recompute is reproducible from immutable raw |
| 11 | **Privacy non-compliance** (revoke, deletion) | Consent lifecycle + purge job wired to `data-deletion.html` / Meta callback; audited |

---

## 14. Implementation sequence (do **not** start yet)

- **Phase 0 — Foundations (no behaviour change):** create `intel` schema; `ci_creator_identity`, `ci_identity_link`, `ci_consent`, `ci_ingest_run`; feature flags. Seed identities from `social_accounts` + shadow identities from `creators`. *Ship dark.*
- **Phase 1 — Observed time-series:** `ci-ingest` + append-only snapshot tables; backfill seed from `social_accounts`; daily cron. Verify idempotency & provenance. *Still no user-facing change.*
- **Phase 2 — Additive IDs & dual-write:** add nullable FK columns (Section 4); app dual-writes; backfill `ci_identity_link`; reconcile. Reads still legacy.
- **Phase 3 — Feature store (observed→derived):** `ci_metric` + recipes for engagement, avg reach, category, geo, content quality, sentiment, reliability; consent-gated `get_creator_intelligence`. Surface behind a flag with provenance UI.
- **Phase 4 — Ranking & NL search:** `ci_brand`, `ci_campaign_participation`, `ci_commercials`; `ci_rank` + `nl_search`; effective CPM/CPC. Replace the client `matchScore()` heuristic.
- **Phase 5 — Predicted & external:** `ci_conversions` ingestion (CPA/ROAS), fraud-risk **estimate** model, exclusivity/conflict detection. Full presentation contract enforced.
- **Cut-over:** per table, switch reads to id-paths only after reconciliation passes; retain legacy text columns ≥ N cycles.

---

## 15. Test strategy

- **Schema/constraint tests:** provenance envelope non-null for `tier<>'observed'` (constraint + test); append-only snapshots reject overwrite; unique `(identity_id, as_of)`.
- **RLS & consent (negative tests):** brand cannot read a non-consented creator; agency cannot read another org; revoked consent blocks reads and ingestion; raw metric tables unreadable by `authenticated`; tokens unreadable by everyone.
- **Backfill reconciliation:** row counts match; no orphan `ci_identity_link`; fuzzy links below threshold are quarantined, not applied; dual-write drift = 0 in steady state.
- **Idempotency:** re-running `ci-ingest` for a day produces no duplicates and no metric change.
- **Metric correctness:** golden datasets with hand-computed engagement/CPM/etc.; recompute from immutable raw reproduces the same value for a historical `as_of`.
- **Ranking explainability:** `Σ signal_contributions == score`; hard filters provably applied; same brief + same data = same ranking (determinism modulo model version).
- **Privacy:** revoke → purge within SLA verified end-to-end; export returns exactly the subject's data.
- **Fraud presentation:** API refuses to emit a fraud value without `is_estimate`, confidence, and evidence.
- **Load/cost:** insights ingestion at target creator count within API budget; NLP/vision within cost caps.

---

## 16. Rollback plan

- **Additive-by-construction.** New objects live in the `intel` schema and can be **disabled or dropped without touching `public`**. No legacy column is altered or dropped in early phases.
- **Feature flags** gate every read cut-over; flipping a flag reverts to the legacy text path instantly. Default-off until verified.
- **`ci-ingest` kill switch** (flag + cron disable) stops all new writes; raw tables are append-only so nothing legacy is corrupted.
- **Reversible backfill:** links live in `ci_identity_link` (a side table); the added FK columns are nullable and can be nulled/ignored without data loss.
- **Column retirement** (making an id `NOT NULL`, dropping a text column) happens only after ≥ N release cycles of verified dual-write, as a separate, explicitly-approved migration with its own rollback.
- **Recompute, not repair:** because raw is immutable and recipes are versioned, a bad metric version is rolled back by recomputing from raw with the previous version — no data surgery.

---

*End of architecture. Implementation is intentionally deferred (constraint #10). The next step is review and sign-off on the identity spine (`ci_creator_identity`) and the consent model, which everything else depends on.*
