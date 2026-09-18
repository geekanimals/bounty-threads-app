# Creator Intelligence Architecture — Canonical Specification v1.0

**Product:** "Bloomberg for Creators" — an additive Creator Intelligence Engine for Geek Influencer OS (Bounty & Threads).

**Status:** Design only. Canonical, internally consistent v1.0. No migrations, no code, no Edge Functions, no deployment. Readable front-to-back with a single design (no competing models).

**Prime directive:** *Additive and reversible.* Preserve every existing production behaviour. Introduce a stable identity model, immutable time-series, and a provenance-carrying feature store **alongside** today's name/free-text model; backfill; verify; then cut reads over — never a destructive rewrite.

**Changelog (history only — the body below is the single source of truth):**
- *v0.1 (Prompt 1/1A)* — initial audit + first architecture.
- *Amendment A (1B)* — added Instagram messaging + per-scope permission model.
- *Amendment B (1C)* — locked the one-time, all-five connection + internal capability switches + six-measure scoring.
- *Amendment C (1D)* — split identity/account/actor/org; audited merges; tenant-scoped brands; corrected audience model; true append-only; four control systems; missing-data ranking; security hardening; campaign-scoped messaging; retention matrix; queue ingestion; phased split; versioned capability matrix.
- **v1.0 (1E)** — all of the above merged into the primary sections; superseded schemas/authorization/API/phases removed.

---

## 0. Non-negotiables

1. **No scraping.** Only official Meta APIs.
2. **Consented professional-account data only.**
3. **Tokens never in browser-readable tables or client code.** Server-side only, encrypted at rest (§13).
4. **A fraud score is never a fact.** It is a labelled *estimate* with evidence, confidence, and appeal.
5. **No inference of sensitive personal characteristics.**
6. **No single universal opaque score.** Six separate, explainable measures (§11); any ranking is brief-specific and decomposable.
7. **Every derived/predicted value carries a provenance envelope:** source(s), method/model version, calculation date, input window, sample size, confidence, status. **Unavailable data is marked `unavailable`, never `0`.**
8. **Preserve existing production tables** until additive migrations and backfills are verified.
9. **Authorisation is enforced in the database** (RLS + hardened `SECURITY DEFINER` functions in an unexposed schema), never by UI role visibility.
10. **No implementation in the design phase.**

**Settled Instagram experience (must be preserved exactly):** one **Connect Instagram** CTA → request **all five** approved permissions together → **no** Geek permission-selection page before Meta OAuth → granted capabilities **default to enabled** → creators may **disable individual capabilities later** (with the agreed warning) → disabling may affect **Verified Data Coverage and Confidence only** (never auto-reduce Performance, never raise Fraud Probability, never label untrustworthy) → **no** repeated per-brand OAuth or progressive-consent flows.

---

## 1. Existing-state findings

### 1.1 What exists today

Static vanilla-JS frontend (`app.js`, `data.js`, `auth.js`, `login.js`, `consent.js`, `app.html`) + public pages `p.html` (creator media kit), `o.html` (org workspace); Supabase backend (Postgres + RLS, Auth, 6 Edge Functions, Storage bucket `ig-media`).

**Tables (16):** `members`, `invites`, `leads`, `creators`, `campaigns`, `barter_items`, `applications`, `dream_plans`, `story_deals`, `irm_contacts`, `social_accounts`, `org_profiles`, `social_tokens`, `platform_admins`, `ai_usage`, `audit_log`.
**Edge Functions (6):** `instagram-login`, `instagram-auth`, `instagram-refresh`, `instagram-publish`, `ai-chat`, `whatsapp-send` (+ `_shared/cors.ts`, `_shared/ig.ts`).

### 1.2 Security model (strong — extend, don't weaken)

Per-org RLS (`org_id = my_org()`); members provisioned only by the `handle_new_user` trigger; role/org immutable from client (column locks + `members_guard`); cross-org surfaces are explicit `SECURITY DEFINER` functions; tokens isolated in `social_tokens` (RLS on, no policies → service-role only).

### 1.3 Core gaps the engine must fix

- **No stable creator identity.** `social_accounts` (Meta-authoritative, keyed by `ig_user_id` + `member_id`) and `creators` (agency roster, free-text `name`/`handle`, no link) are disconnected islands.
- **Snapshots, not time-series.** `instagram-login`/`instagram-refresh` **overwrite** `social_accounts` every sync — history is discarded.
- **No provenance / feature store.** Derivations (engagement %, `matchScore()`) are ephemeral and client-side.
- **No brand entity, no campaign↔creator membership, no commercials, no conversions.**

### 1.4 Relationships that rely on names / free-text (migration targets → IDs)

| # | Location | Field(s) | Should reference | Severity |
|---|---|---|---|---|
| R1 | `creators` ↔ `social_accounts` | `name`, `handle` | canonical identity / platform account | **Critical** |
| R2 | `barter_items.creator` | text | identity | **Critical** |
| R3 | `barter_items.campaign` | text | `campaigns.id` | High |
| R4 | `applications.creator_name` | text | applicant identity | High |
| R5 | `campaigns.brand` | text | `ci_brand.brand_id` | High |
| R6 | `campaigns.creators` | integer count | `ci_campaign_participation` | High |
| R7–R9 | `story_deals.celebrity/brand/manager` | text | identity / brand / member | Medium |
| R10 | `irm_contacts.name/handle` | text | identity / platform account | Medium |
| R11 | `dream_plans.creator_email` | text | member / identity | Medium |
| R12 | `campaigns.platforms/hashtags` | text | enums / tag entities | Low |
| R13 | `creators.followers/eng/tier/cat` | text | typed values / enums | Low |
| R14 | `social_accounts.mentions[].username` | text | brand / identity | Low |

---

## 2. Data-flow architecture (target)

```
Instagram OAuth (one CTA, all five scopes)
  → server code exchange (Edge, service role) → token in Vault (never browser)
  → ci_platform_connection + ci_scope_grant (per-connection grant status)
  → granted-scope gate ─► durable queue (pgmq) ─► per-connection ingestion workers
        ├─ ci-ingest (append-only): ci_account_snapshots, ci_media(+versions),
        │    ci_media_insights, ci_audience_observations (follower/reached/engaged), ci_mentions, ci_comments
        └─ ci-messaging-sync (campaign-scoped only): ci_ig_conversations/messages (minimised),
             ci_ig_message_events (text-free ledger)
  → scheduled feature compute (SQL/materialized + workers, versioned recipes)
  → ci_metric (feature store: observed→derived→predicted, each with provenance + status)
  → serving via hardened SECURITY DEFINER functions (visibility-tier + capability gated):
        get_creator_intelligence() · ci_rank(brief) · nl_search() · get_campaign_inbox()
  → Browser (never touches raw tables; sees tier-appropriate views/aggregates only)

External conversion (UTM/promo/pixel) → ci_conversions → CPA/ROAS
Agency-entered terms → ci_commercials (org-private) → effective-cost metrics
```

**Invariants:** raw ingestion is **immutable append-only**, written only by service-role workers; the `intel` schema is **not exposed to the Supabase Data API**; the browser reads only through hardened functions/tier views; tokens & private message content stay server-side.

---

## 3. Canonical entity-relationship model

All new objects live in an **`intel` schema** (prose prefix `ci_`) that is **not exposed via the Data API**; clients reach them only through hardened functions or explicitly-granted `security_invoker` "latest" views (§7). Existing `public` tables gain only **nullable** FK columns (§5).

### 3.1 Identity, platform account, authorised actor, org relationship

- **`ci_creator_identity`** — the human/talent/creator entity. **No platform ID, no `member_id`.** Exists without a Geek login (e.g. agent-managed celebrity). `identity_id pk`, `display_name`, `kind` (`creator`|`celebrity`|`talent`), `is_claimed`, `created_at`.
- **`ci_platform_account`** — a real account on a platform. `platform_account_id pk`, `platform`, `platform_user_id`, `username`, `account_type`, `status`, `first_seen_at`, `last_verified_at`; **`unique(platform, platform_user_id)`**.
- **`ci_identity_platform_account`** — identity↔account over time. `identity_id`, `platform_account_id`, `relationship`, `is_primary`, `valid_from`, `valid_to`, `evidence`. One identity → **many** accounts.
- **`ci_platform_connection`** — a specific OAuth/token connection to a specific account. `connection_id pk`, `platform_account_id`, `authorised_by_member_id`, `token_reference` (→ Vault, never a raw token), `connected_at`, `expires_at`, `revoked_at`, `status`. Reconnection creates a **new** connection row; the account and identity persist.
- **`ci_identity_actor_access`** — who may operate an identity. `identity_id`, `member_id`, `access_role` (`self`|`agent`|`manager`|`authorised_operator`), `granted_by`, `granted_at`, `revoked_at`, `evidence`. Many operators per identity; one operator across many identities.
- **`ci_org_creator_relationship`** — **all** org-scoped CRM. `org_id`, `identity_id`, `relationship_type` (`roster`|`represented`|`managed`|`campaign_only`|`discovered`), `assigned_manager_member_id`, `status`, `source`, `created_at`, `ended_at`. Org notes/commercials/assignments attach here (or another org-scoped entity) — **never** to the global identity. No org may infer another org's relationship, notes or commercials.
- **`ci_identity_merge_event`** — append-only merge ledger (§3.4).
- **`ci_identity_link`** — **migration/reconciliation ledger only**; its polymorphic shape is never the runtime relationship model.

### 3.2 Brands (canonical + tenant-scoped)

- **`ci_brand`** — canonical brand identity. `brand_id pk`, `name`, `aliases text[]`, `domain`, `parent_brand_id null`.
- **`ci_org_brand_relationship`** — org-specific CRM: `org_id`, `brand_id`, account ownership, internal notes, commercial history, parent-corporate portfolio link, agency/client relationship, visibility boundary. A corporate account holds multiple brands without exposing one agency's private brand records to another.

### 3.3 Campaign participation & commercials

- **`ci_campaign_participation`** — campaign↔identity membership. `campaign_id` (→ `public.campaigns`), `identity_id`, `role`, `status` (`invited`|`applied`|`approved`|`live`|`delivered`|`dropped`), `agreed_deliverables jsonb`, `created_at`.
- **`ci_commercials`** — **org-private** negotiated terms. `org_id` (owner), `ci_org_creator_relationship` ref, `campaign_id`, `identity_id`, `fee_amount`, `currency`, `fee_basis`, `exclusivity jsonb`, `entered_by`, `entered_at`.
- **`ci_conversions`** — external outcomes for CPA/ROAS. `org_id`, `campaign_id`, `identity_id`, `source`, `event_type`, `count`, `revenue`, `occurred_on`, `evidence`.

### 3.4 Audited, reversible merges

**`ci_identity_merge_event`** (append-only): `source_identity_id`, `target_identity_id`, `reason`, `evidence`, `performed_by`, `performed_at`, `reversed_at`, `reversed_by`. Rules: **automatic merge only on exact verified stable platform ID**; handles/names **never** auto-prove ownership (they change and get recycled); fuzzy matches stay review candidates; **prevent merge cycles**; retain alias history; **support audited unmerge**; preserve all original source records. **`merged_into` is not a runtime mechanism.**

### 3.5 Observed (raw, immutable, append-only)

- **`ci_ingest_run`** — provenance of a run: `run_id`, `source`, `scope`, `connection_id`, `started_at`, `finished_at`, `status`, `api_calls`, `rows_written`, `error`.
- **`ci_account_snapshots`** — `snapshot_id`, `identity_id`, `platform_account_id`, `source_observed_at`, `captured_at`, `followers_count`, `follows_count`, `media_count`, `reach`, `impressions`, `profile_views`, `accounts_engaged`, `source`, `api_version`, `ingest_run_id`, `payload_hash`. **No `unique(identity_id, as_of)`** (§6).
- **`ci_media`** — stable post identity: `media_id pk`, `identity_id`, `platform_account_id`, `media_type`, `permalink`, `posted_at`, `first_seen_at`, `deleted_at null` (tombstone).
- **`ci_media_version`** — immutable caption/metadata versions: `media_id`, `version_no`, `caption`, `metadata jsonb`, `source_observed_at`, `captured_at`, `payload_hash`.
- **`ci_media_insights`** — `media_id`, `source_observed_at`, `captured_at`, `reach`, `impressions`, `saved`, `likes`, `comments`, `shares`, `plays`, `total_interactions`, `source`, `api_version`, `ingest_run_id`, `payload_hash`.
- **`ci_audience_observations`** — the corrected audience model (§8).
- **`ci_mentions`** — organic mentions: `identity_id`, `brand_id null`, `raw_brand`, `media_id null`, `mention_type`, `detected_at`, `source`, `evidence`.
- **`ci_comments`** + **`ci_comment_sentiment`** — retention-limited comment text; sentiment is *derived* with `model_version`/`confidence`.

### 3.6 Control & consent (four separate systems — §9)

- **`ci_scope_grant`** — Meta permission state, **owned by `ci_platform_connection`** (`connection_id` FK).
- **`ci_capability_switch`** — internal Geek feature controls, **owned by `ci_identity_platform_account`** so they **survive reconnection**.
- **`ci_processing_consent`** — `identity_id`, `accepting_actor_member_id`, `authority/evidence`, `notice_version`, `purposes jsonb`, `accepted_at`.
- **`ci_profile_visibility`** — visibility-tier authorisation (§7).
- **`ci_messaging_consent_events`** — **audit projection only** of processing-consent/capability events for messaging; **not** a fifth consent system.

### 3.7 Messaging (campaign-scoped — §12)

`ci_ig_conversations`, `ci_ig_messages` (minimised), `ci_ig_message_events` (text-free ledger), `conversation_assignments`, `ci_conversation_campaign_links`, `ci_response_metric_snapshots`, `ci_messaging_sync_jobs`.

### 3.8 Feature store, ranking, requests

- **`ci_metric`** — serving feature store (§10), one row per `(identity_id, metric_key, source_observed_at, method_version)` with the full provenance envelope + `status`.
- **`ci_ranking_run`** / **`ci_ranking_result`** — explainable brief-specific ranking (§11.2).
- **`ci_data_request`** — access/export/delete requests (retention, §13).

### 3.9 Canonical entity inventory (primary ownership / FKs)

| Entity | Owner / grain | Key FKs |
|---|---|---|
| `ci_creator_identity` | global human | — |
| `ci_platform_account` | global account | `unique(platform, platform_user_id)` |
| `ci_identity_platform_account` | identity↔account | `identity_id`, `platform_account_id` |
| `ci_platform_connection` | a connection | `platform_account_id`, `authorised_by_member_id`, `token_reference`→Vault |
| `ci_identity_actor_access` | operator grant | `identity_id`, `member_id` |
| `ci_org_creator_relationship` | **org** | `org_id`, `identity_id`, `assigned_manager_member_id` |
| `ci_identity_merge_event` | append-only ledger | `source_identity_id`, `target_identity_id` |
| `ci_identity_link` | migration ledger only | (polymorphic; non-runtime) |
| `ci_brand` | global brand | — |
| `ci_org_brand_relationship` | **org** | `org_id`, `brand_id` |
| `ci_campaign_participation` | campaign↔identity | `campaign_id`, `identity_id` |
| `ci_commercials` | **org** | `org_id`, `campaign_id`, `identity_id`, rel ref |
| `ci_conversions` | **org** | `org_id`, `campaign_id`, `identity_id` |
| `ci_account_snapshots` / `ci_media*` / `ci_media_insights` / `ci_audience_observations` / `ci_mentions` / `ci_comments*` | identity/account (raw) | `identity_id`, `platform_account_id`, `ingest_run_id` |
| `ci_scope_grant` | **connection** | `connection_id`, `scope` |
| `ci_capability_switch` | identity–account rel | `identity_id`, `platform_account_id`, `capability` |
| `ci_processing_consent` | identity | `identity_id`, `accepting_actor_member_id`, `notice_version` |
| `ci_profile_visibility` | identity/tier | `identity_id`, `tier` |
| `ci_ig_*` / `conversation_*` / `ci_response_metric_snapshots` | identity/campaign | `identity_id`, `conversation_id`, `campaign_id` |
| `ci_metric` | identity | `identity_id`, `metric_key` |
| `ci_ranking_run` / `ci_ranking_result` | request/identity | `run_id`, `identity_id` |

---

## 4. ER summary (text)

```
ci_creator_identity 1─* ci_identity_platform_account *─1 ci_platform_account 1─* ci_platform_connection 1─* ci_scope_grant
ci_creator_identity 1─* ci_identity_actor_access *─1 members
ci_creator_identity *─* orgs (via ci_org_creator_relationship) 1─* ci_commercials
ci_creator_identity 1─* ci_identity_merge_event (append-only; audited unmerge)
ci_identity_platform_account 1─* ci_capability_switch          ci_creator_identity 1─* ci_processing_consent
ci_creator_identity 1─* ci_profile_visibility
ci_platform_account 1─* ci_account_snapshots | ci_media(+ci_media_version, tombstone) 1─* ci_media_insights | ci_audience_observations | ci_mentions *─1 ci_brand
ci_brand 1─* ci_org_brand_relationship (org-scoped)
ci_creator_identity *─* public.campaigns (via ci_campaign_participation) ; public.campaigns 1─* ci_conversions
ci_creator_identity 1─* ci_ig_conversations 1─* ci_ig_messages ; ci_ig_conversations 1─* ci_ig_message_events (no text)
ci_ig_conversations *─1 conversation_assignments (→ members) ; ci_ig_conversations *─* public.campaigns (via ci_conversation_campaign_links)
ci_creator_identity 1─* ci_metric ; ci_ranking_run 1─* ci_ranking_result *─1 ci_creator_identity
every raw/derived row ──► ci_ingest_run (provenance)
```

---

## 5. Table-by-table additive migration & seeding

**Rule:** add **nullable** columns only; **dual-write** (keep text, add id when known); **backfill**; **verify**; then switch reads behind a feature flag. **No** `DROP`/`NOT NULL`/type change on legacy columns until ≥ N verified release cycles (a later, separately-approved migration).

**Identity seeding (Phase 0A/observed):**
1. Create/upsert **`ci_platform_account`** from the **verified stable platform ID** (`ig_user_id`) in `social_accounts`.
2. Connect it to a **`ci_creator_identity`** via **`ci_identity_platform_account`** (claimed identity).
3. For `creators` rows with no verified account → create a **shadow identity** (valid, `is_claimed=false`); **handles/names never auto-merge**. A later verified connection merges via **`ci_identity_merge_event`**.
4. `ci_identity_link` records provisional/fuzzy links for **reconciliation only**.

| Existing table | Additive column(s) | Backfill | Read cut-over flag |
|---|---|---|---|
| `social_accounts` | `identity_id`, `platform_account_id` | `ig_user_id` exact | `ci.identity` |
| `creators` | `identity_id` | handle_exact → else shadow | `ci.identity` |
| `campaigns` | `brand_id` | `ci_brand` alias match | `ci.brands` |
| `campaigns` (participation) | keep `creators` int as cached count | derive from `ci_campaign_participation` | `ci.participation` |
| `barter_items` | `creator_id`, `campaign_id` | identity/name→id | `ci.barter_ids` |
| `applications` | `applicant_identity_id` | applicant member→identity | `ci.app_ids` |
| `story_deals` | `celebrity_identity_id`, `brand_id`, `manager_member_id` | fuzzy + review | `ci.story_ids` |
| `irm_contacts` | `identity_id` | handle/name→identity | `ci.irm_ids` |
| `dream_plans` | `member_id` | email→member | `ci.dream_ids` |

---

## 6. Immutable ingestion & idempotency

- **Immutable append-only.** Historical rows are **never updated**. **No `unique(identity_id, as_of)`** — that would forbid legitimate multiple observations per day.
- **Every raw row carries:** `source_observed_at`, `captured_at`, `ingest_run_id`, `source_record_id` (where available), `payload_hash`/`idempotency_key`.
- **Dedupe:** a re-delivery of the *same* observation is ignored via the idempotency key. A **different** observation the same day (different `source_observed_at` or payload) creates **another immutable row**.
- **Serving:** current values come from **"latest" views / materialized views**, not by overwriting history.
- **Media mutability:** stable `ci_media`; editable caption/metadata as immutable `ci_media_version` rows; **deletion tombstone** (`ci_media.deleted_at`); edit history retained where Meta reports changes.

---

## 7. Authorisation & visibility

Authorisation is DB-enforced. **Visibility tiers** (no per-brand consent, ever):

`creator/private` · `authorised representative` · `organisation roster` · `marketplace summary` · `campaign-specific shared intelligence` · `public media kit`.

- **Campaign participation** enables **campaign-limited** access only — **never** unrestricted historical intelligence.
- **Commercials & org-private notes** always reference `ci_org_creator_relationship`/`org_id`; no cross-tenant inference.
- **Super-admin access is via audited administrative functions**, not broad client policies. Raw `intel` tables are **inaccessible to browser roles** entirely.

### 7.1 RLS & visibility matrix

Legend: **Own** = the creator's own identity · **Rep** = an authorised actor (`ci_identity_actor_access`) · **Org** = identities in the reader's `ci_org_creator_relationship` · **Campaign** = only within a shared campaign · **Mktsum** = marketplace summary tier · **Agg** = aggregated indicators only · **—** none · **Admin-fn** = audited admin function only.

| Object | Creator | Brand | Agency | Corporate | Manager | Super Admin |
|---|---|---|---|---|---|---|
| identity / platform account | Own/Rep | Mktsum | Org | Org | Org (talent) | Admin-fn |
| account & media snapshots/insights | Own/Rep | Campaign/Agg | Org | Org | Org | Admin-fn |
| audience observations (follower/reached/engaged) | Own/Rep | Campaign/Agg | Org | Org | Org | Admin-fn |
| `ci_metric` (derived signals) | Own/Rep | Mktsum/Campaign/Agg | Org | Org | Org | Admin-fn |
| `fraud_probability` (estimate) | Own (as estimate) | Agg + evidence | Org | Org | Org | Admin-fn |
| `ci_commercials` / org notes | Own rows | — | Org (owner) | Org | Org (own talent) | Admin-fn |
| `ci_campaign_participation` | Own | Own campaigns | Org | Org | Org | Admin-fn |
| `ci_conversions` | Own | Own campaigns (Agg) | Org | Org | Org | Admin-fn |
| ranking / NL search | — | Consented+coverage pool | Org pool | Org pool | Org pool | Admin-fn |
| raw messages **content** | Own/Rep | — | Authorised campaign convs, audited | Org (same) | Org (same) | Admin-fn (break-glass) |
| message **event ledger / metadata** | Own/Rep | Agg only | Org (campaign) | Org | Org | Admin-fn |
| responsiveness metrics | Own/Rep | **Agg indicators only** | Org | Org | Org | Admin-fn |
| control tables (scope/consent/capability/visibility) | Own manage | — | request/view | request/view | request/view | Admin-fn |
| tokens & private message content at rest | — | — | — | — | — | — (Vault/service only) |

**Notes:** brands never see raw DMs, participants, or message content — only aggregated response/reliability indicators respecting a minimum sample size; unrelated/private conversations never reach any scoring input; every message-content access is audited; message text is never logged.

### 7.2 Supabase-specific controls (defence in depth)

- The **`intel` schema is not exposed through the Data API** (not in the exposed schemas list); browser roles cannot select its tables.
- **Explicit** `GRANT`s on tables/functions; **RLS enabled** on all as defence in depth.
- **"latest" views** are `security_invoker` **or** reachable only through hardened functions.
- **`SECURITY DEFINER` functions live in an unexposed schema**, with **fixed `search_path`**, **schema-qualified** object references, **org derived from the authenticated context** (never caller-supplied `org_id`), **`REVOKE EXECUTE FROM PUBLIC`** then grant to intended roles only, **minimal return columns**, and **audited** sensitive reads.
- **pgTAP allow/deny tests** for **every role and tenant boundary** (positive and negative).

---

## 8. Audience-intelligence model

**`ci_audience_observations`** distinguishes three audience types and stores **separate marginal breakdown rows**:

- `audience_type` ∈ {`followers`, `reached`, `engaged`} → follower / reached-audience / engaged-audience demographics.
- One row per `breakdown_type` ∈ {`age`, `gender`, `country`, `city`} per `dimension_key`/`dimension_value`.
- Columns: `identity_id`, `platform_account_id`, `metric_name`, `audience_type`, `breakdown_type`, `dimension_key`, `dimension_value`, `value_count` (where supplied), `calculated_percentage` (where calculated), `period`, `timeframe`, `observed_at`, `captured_at`, `source`, `api_version`, `run_id`, `status` (`available`|`suppressed`|`insufficient_audience`|`permission_missing`|`token_expired`|`api_error`), `suppression_reason`, `sample_size`/`audience_total` (where supplied), `raw_payload_reference`/`response_hash`.

**Marginal vs joint:** Meta may return age, gender and city as **separate marginal distributions**. Geek **must not** claim a joint intersection ("women 25–34 in Bangalore") unless Meta explicitly returned that joint breakdown. **No estimated joint segments at launch.** If ever estimated later: label **`predicted`**, record method, provide confidence, never present as an observed Meta fact. No generic `age_gender` field unless the active API returns a combined dimension. Every metric/period/timeframe/breakdown is validated against the active Graph API version at implementation.

---

## 9. Consent & control model (four separate systems)

There is **no `ci_consent`, no `granted_to_org`, no `grant_consent(...)`, and no per-brand permission UX.**

1. **`ci_scope_grant`** — technical Meta permission state, per **connection** (`ci_platform_connection`). Five distinct, non-interchangeable statuses: **approved-by-Meta**, **requested-in-OAuth**, **granted-by-creator**, **currently-valid**, **revoked/expired**. Features gate on **currently-valid**.
2. **`ci_processing_consent`** — the Geek privacy-notice/purpose the creator accepted: `identity`, `accepting_actor`, `authority/evidence`, `notice_version`, `purposes`, `timestamp`.
3. **`ci_capability_switch`** — internal Geek feature controls (Performance Insights, Comment Intelligence, Campaign Messaging Intelligence, Publishing & Scheduling), owned by the **identity–platform-account** relationship so they **survive reconnection**. `instagram_business_basic` cannot be disabled independently (removal = Disconnect).
4. **`ci_profile_visibility` / relationship-based authorisation** — the tiers in §7.

**Existing users:** do **not** infer acceptance of expanded intelligence purposes from an old token. Record the **current notice version via a simple in-product acknowledgement** at reconnect/next relevant sign-in — **no extra Meta OAuth** for that acknowledgement.

**Capability disable semantics:** stop new API calls needing that permission; stop related ingestion; exclude that data from **future** intelligence; record `{date, user, notice/consent version}`; apply the stated retention treatment (§13); never silently re-enable; never claim Meta revocation unless Geek actually revoked via a supported Meta mechanism. **Re-enable:** resume immediately if the grant is still valid; require **one** reauthorization (with explanation) only if missing/expired/revoked.

---

## 10. Observed / Derived / Predicted + feature store

Every value is tagged `tier` and (for non-observed) carries the full **provenance envelope**: `method`/`model_version`, `computed_at`, `window`, `sample_size`, `confidence`, `is_estimate`, `inputs`, `run_id`, and a `status` (`ok`|`insufficient_data`|`unavailable`|`missing_permission`|`token_expired`|`api_error`).

- **Observed** — Meta facts + internal facts (commercials, conversions), stored verbatim & immutable.
- **Derived** — deterministic, versioned recipes (engagement, avg reach, effective CPM/CPC/CPA/ROAS, category affinity, geo strength, content quality, comment sentiment, reliability).
- **Predicted** — model outputs with uncertainty (fraud **estimate**, forecasts). `is_estimate=true` mandatory.

**Feature store (`ci_metric`):** compute writes **new** rows (new `source_observed_at`), never mutates history; confidence = f(sample_size, recency, completeness); per-metric freshness SLA; serving is consent/visibility-gated. **Unavailable is `unavailable`, never `0`.**

---

## 11. Scoring, confidence, coverage & ranking

### 11.1 Six separate, explainable measures (never one blend)

1. **Creator Performance Score** · 2. **Reliability Score** · 3. **Brand-Safety Score** · 4. **Fraud Probability** (labelled estimate) · 5. **Creator Intelligence Confidence** · 6. **Verified Data Coverage**.

**Rules:** disabling a capability / withdrawing a permission may lower **only Confidence and Coverage** — never auto-reduce Performance, raise Fraud, label untrustworthy, or fabricate a zero. Publishing & Scheduling is operational and affects **no** score. Response speed alone is never quality.

### 11.2 Missing-data ranking policy & storage

1. Missing data never becomes zero. 2. It never silently improves/reduces underlying performance. 3. A **mandatory hard-filter** signal that is unavailable returns **`insufficient_data`** or **`unknown` requiring explicit brand treatment**. 4. **Soft-signal missingness is not silently renormalised** to inflate a creator. 5. Ranking returns **separately**: `partial_fit_score`, `verified_coverage`, `ranking_confidence`, `missing_signal_list`, `signal_contributions` (so Σ = partial_fit_score). 6. Partial scores are **not** compared as if coverage were identical. 7. A brand may set a **Verified Data Coverage minimum** — a **visible brand-selected filter**, never embedded in performance, with **explainable** exclusions; **no default coverage exclusion** at launch. 8. Withdrawal may affect confidence/coverage/eligibility for an explicitly requested threshold, but never rewrites historical performance or fraud.

**Persist on every ranking:** `ranking_formula_version`, `normalization_version`, `missingness_policy_version`, and all `signal_contributions`. Fraud is a **separate advisory gate**, never a hidden term.

**Brand-side display when signals are missing:** "Partially verified Instagram profile — some intelligence signals are unavailable," plus Verified Data Coverage %, last successful verification date, available vs unavailable categories, and per-prediction confidence — in **neutral** language that never frames a privacy choice negatively.

**NL search:** an LLM parses the query into the structured brief (filters + weights) and calls the same `ci_rank` pipeline; it **translates intent only**, never invents metrics.

---

## 12. Messaging & creator responsiveness (campaign-scoped only)

**Not a general private-inbox surveillance system.** A conversation contributes to intelligence **only** when it is **initiated through a Geek campaign workflow** or **explicitly linked to a Geek campaign by an authorised user, with audit evidence**. **Unlinked conversations are never content-classified for intelligence.** Operational-inbox processing is kept **separate** from intelligence processing.

- **Gate:** requires a **currently-valid** `instagram_business_manage_messages` grant on the connection; else `missing_permission` (never `no_response`).
- **Storage — data minimisation default:** store platform message id, direction, timestamp, conversation category, campaign link, response timing, delivery/read state **where available**; **limited encrypted content only if the inbox needs it**, shortest TTL, audited. **No content or participants enter the feature store.**
- **Response ledger** (`ci_ig_message_events`) is **text-free**; responsiveness metrics derive from timing/events.
- **Classification:** 10 categories; only campaign-operational ones (invitation, active campaign, commercial negotiation, deliverable, revision/approval, logistics; inbound brand enquiry only once campaign-linked) feed intelligence; **ambiguous → excluded**.
- **Attribution honesty:** invitation response rate covers **Geek-tracked** invitations; acceptance/decline from explicit campaign state or a **labelled, confidence-bearing** classifier; agency-member SLA attributable **only** to messages sent **through Geek by an identified member** — **native IG messages are not auto-attributed** to an employee; **read/delivery states are nullable capabilities**, never assumed.
- **Responsiveness metrics** (`ci_metric`, derived, with `status`): invitation response rate, median & p75 first-response time, acceptance/decline rate, follow-ups before response, conversation-to-campaign conversion, unresolved campaign conversations, last campaign response, agency response SLA — each with `sample_size`, `confidence`, `window`, and the **distinct** statuses `no_response` / `missing_permission` / `token_expired` / `sync_error` / `insufficient_data` (never collapsed). Responsiveness enters ranking as **one capped, named sub-signal**, never as quality by itself.

---

## 13. Privacy, retention & disconnect

**Minimise** (aggregate demographics only; message timing not content; retention-limited comment text; tokens in Vault). **No sensitive inference.** **Purpose limitation.** Access/export via `ci_data_request`; all ingestion/admin actions audited.

### 13.1 Data-class retention matrix (design intent — durations are a legal/DPO gate)

For each class: default retention · deletion event · anonymisation · legal/contractual retention · legal hold · backup-deletion window · derived-invalidation · audit-evidence retained after deletion.

| Class | Default (confirm w/ counsel) | On deletion |
|---|---|---|
| OAuth transaction records | minutes | expire on use/timeout |
| Access tokens (Vault) | life of connection | delete on disconnect; verify revocation |
| Account/audience snapshots | rolling history then archive | anonymise on disconnect |
| Media insights | media life + window | tombstone on media delete |
| Comment text | short | delete; keep derived sentiment |
| Derived sentiment | rolling | invalidate on capability off |
| Message metadata | campaign life + audit | delete on disconnect (keep audit) |
| Temp message content | shortest (session/short TTL) | delete on TTL; never to feature store |
| Campaign records / commercials / conversions | contractual/financial | **not** auto-deleted on disconnect |
| Ranking results | recompute-cheap | recompute, not repair |
| Audit logs / consent evidence | long (compliance) | retained after subject deletion |
| Backups | defined window | purge propagates within window |

### 13.2 Disconnect

Stop new collection immediately; **invalidate current serving features immediately**; revoke/delete tokens (verified); delete/anonymise eligible personal intelligence; **retain only necessary contractual/financial/security/audit records**; record exactly what was deleted/anonymised/retained and why. **Do not blindly cascade-delete** campaign contracts, invoices, or legally required records. Fraud estimates are labelled, evidenced, and **appealable/disputable**.

---

## 14. Security hardening

- **OAuth:** cryptographically secure `state` (CSPRNG, **never `Math.random()`**); state stored **server-side** or in a securely bound short-lived transaction; **one-time use**, strict expiry, **bound to the initiating user/session**; exact redirect validation; **PKCE if supported** by the selected Meta flow; **`localStorage` alone is not proof** of OAuth state.
- **Tokens:** **Supabase Vault** for secrets; application-level/envelope encryption at rest; keys outside ordinary application tables; **restricted decrypted-view access**; key rotation; **redaction in logs/errors**; least-privilege service access; **revocation & deletion verified**. (RLS/no-policy isolation is necessary but **is not encryption**.)
- **`SECURITY DEFINER`:** unexposed schema; fixed `search_path`; schema-qualified references; explicit JWT/user/org validation; **org from auth context, never caller-supplied**; `REVOKE EXECUTE FROM PUBLIC`; minimal return columns; audited sensitive reads; negative cross-tenant tests.
- **Webhooks:** signature verification; replay protection; event idempotency; timestamp tolerance; secret rotation; dead-letter handling; **no raw message content in logs**.

---

## 15. Million-creator ingestion architecture

- **Queue:** **Supabase Queues / pgmq** for the first implementation, **subject to load-test gates** (revisit an external broker if gates fail).
- **Jobs:** durable, **per-creator/per-connection**; **leasing + visibility timeout**; **idempotent workers**; retry policy with **exponential backoff + jitter**; **dead-letter queue**.
- **Budgets & priority:** app-level and token-level API budgets; priority for **active campaigns** and **newly connected creators**; **hot/warm/cold** refresh tiers; **backpressure**; **webhook-triggered** work where available; **circuit breakers**.
- **Data:** **partitioning** for snapshot/message-event/metric tables; **archival**; indexes for **latest-per-creator** and **time-window** queries; cost budgets for API/storage/NLP/vision.
- **Monitoring:** job-lag & freshness metrics.
- **Honest initial sync:** Meta cannot supply unlimited historical private insights — record **what was requested, what was returned, and the earliest available observation** per connection.

---

## 16. API contracts (design-level)

All are hardened `SECURITY DEFINER` in the unexposed schema; each re-checks auth/org/visibility/capability and returns provenance + `status` on every non-observed value. **No `grant_consent`, no `granted_to_org`.**

| Contract | Kind | Purpose | Auth |
|---|---|---|---|
| `ig_oauth_start` / `ig_oauth_callback` | Edge | one-CTA all-five connect; server code exchange; token→Vault; write connection + scope grants | server |
| `ci_ingest(connection)` / `ci_messaging_sync(connection)` | worker | immutable ingestion (messaging campaign-scoped) | service role |
| `record_processing_consent(notice_version, purposes)` | RPC | write `ci_processing_consent` | self/rep |
| `set_capability(capability, enabled)` | RPC | toggle `ci_capability_switch` (+ warning gate client-side) | self/rep |
| `get_creator_intelligence(identity_id)` | RPC | metrics + provenance, visibility-gated | tiered |
| `ci_rank(brief)` | RPC | returns partial_fit/coverage/confidence/missing_list/contributions + versions | org/consent pool |
| `nl_search(query)` | Edge+RPC | LLM→brief→`ci_rank` | org/consent pool |
| `get_campaign_inbox(campaign_id)` | RPC | audited campaign inbox (metadata + fetch-on-view content) | agency + assignment |
| `get_creator_responsiveness(identity_id)` | RPC | responsiveness metrics; **brands get aggregates only** | tiered |
| `request_data(kind)` / `disconnect_platform(connection)` | RPC | access/export/delete; disconnect per §13.2 | self/rep |
| `dispute_metric(metric_ref)` | RPC | contest a derived/predicted value | self/rep |

---

## 17. Canonical implementation sequence (single phase list)

1. **Phase 0A — dark foundations:** `intel` schema (unexposed); identity/account/actor/org relationships + connection; merge-event ledger; **four control systems**; scope registry; **security hardening** (OAuth-state, Vault, `SECURITY DEFINER`, webhooks); feature flags; pgTAP allow/deny. **No user-visible change.**
2. **Phase 0B — connection release:** one-CTA all-five OAuth; disclosure copy; capability settings (Data Access page); **secure OAuth state**; existing-user reconciliation/reconnect + **notice-version acknowledgement**; seed platform accounts/identities.
3. **Observed-data ingestion:** immutable append-only snapshots + media versions/tombstones via the queue; latest-views; backfill seed.
4. **Campaign & brand relationships:** `ci_brand`, `ci_org_brand_relationship`, `ci_campaign_participation`, `ci_conversation_campaign_links`.
5. **Derived feature store:** `ci_metric` recipes (engagement, reach, category, geo, content quality, sentiment, reliability); six-measure scoring; consent/visibility-gated serving.
6. **Ranking & search:** `ci_rank` + `nl_search`; effective CPM/CPC; missing-data policy; replace client `matchScore()`.
7. **Predicted & external:** conversions (CPA/ROAS), fraud **estimate**, exclusivity/conflict.
8. **Messaging intelligence — LAST, only after** identity is resolved, a valid messaging scope exists, processing consent is recorded, capability is enabled, campaign-linking rules exist, the privacy filter exists, and deletion/retention controls are operational.

**Cut-over:** per table, switch reads to id-paths only after reconciliation passes; retain legacy text columns ≥ N cycles.

---

## 18. Meta permission & capability matrix (versioned)

**`public_profile` and `email` are account/login permissions — not Instagram audience-intelligence permissions** and are **excluded** from the field matrix below.

**Field status vocabulary:** `verified-in-prod` · `documented-not-verified` · `unavailable/deprecated` · `optional/nullable`. Grant verification uses the method supported by the **active Instagram Login flow + Graph API version** (**not** hardcoded `debug_token`). All delivery/read/message and insight fields are **capability-tested at runtime** (Meta may omit fields by account/version/threshold/endpoint).

| Permission | Endpoint / field | Graph API ver | Prod-verification status | Optional/nullable | Restrictions / thresholds | Last verified | Intelligence use |
|---|---|---|---|---|---|---|---|
| `instagram_business_basic` | profile (username, account_type, counts, bio, website); media (caption, type, permalink, timestamp, like/comments_count) | *(confirm at impl)* | documented-not-verified | some nullable | — | *(TBD)* | identity, cadence, engagement |
| `instagram_business_manage_insights` | account insights (reach, impressions, profile_views, accounts_engaged) | *(confirm)* | documented-not-verified | optional | account type/version | *(TBD)* | performance, avg reach |
| `instagram_business_manage_insights` | media insights (reach, impressions, saved, likes, comments, shares, plays, total_interactions) | *(confirm)* | documented-not-verified | optional | media type-dependent | *(TBD)* | content quality, CPM base |
| `instagram_business_manage_insights` | **follower** demographics (age / gender / country / city, **marginal**) | *(confirm)* | documented-not-verified | optional | **≥100 followers**, aggregate | *(TBD)* | audience (followers) |
| `instagram_business_manage_insights` | **reached-audience** demographics | *(confirm)* | documented-not-verified | optional | threshold/version | *(TBD)* | audience (reached) |
| `instagram_business_manage_insights` | **engaged-audience** demographics | *(confirm)* | documented-not-verified | optional | threshold/version | *(TBD)* | audience (engaged) |
| `instagram_business_manage_comments` | comments; mentions/tags | *(confirm)* | documented-not-verified | optional | — | *(TBD)* | sentiment, organic mentions |
| `instagram_business_content_publish` | media containers → publish | *(confirm)* | documented-not-verified | — | publish limits | *(TBD)* | operational only (no score) |
| `instagram_business_manage_messages` | conversations; messages (id, direction, timestamp); delivery/read state | *(confirm)* | documented-not-verified | **nullable** delivery/read | messaging window/opt-in | *(TBD)* | campaign responsiveness (timing) |

*All "documented-not-verified" rows must be moved to `verified-in-prod` (with a real Last-verified date) during implementation before the dependent feature ships.*

---

## 19. Acceptance tests (canonical)

- **Identity:** one identity holds ≥2 platform accounts; an identity with no `member_id` (agent-managed celebrity) works; ≥2 operators manage one identity; **connection-level** scope grants (grants live on `ci_platform_connection`, survive account, capabilities survive reconnection); org A cannot read org B's `ci_org_creator_relationship`/notes/commercials.
- **Merges:** auto-merge only on exact verified stable platform ID; handle/name never auto-merges; unmerge restores originals; cycles rejected; alias history retained; **no `merged_into` runtime path**.
- **Brands:** corporate holds multiple brands; agency A cannot read agency B's `ci_org_brand_relationship`.
- **Audience:** marginal-only data never rendered as a joint; **no estimated joints at launch**; status/suppression captured; `platform_account_id` present.
- **Immutable ingestion:** **no `unique(identity_id, as_of)`**; re-delivered observation deduped by key; a **differing same-day** observation creates a **new immutable row**; no historical row is ever updated; latest-view serves current value; media edit → version, delete → tombstone.
- **Four controls:** scope/consent/capability/visibility independently settable; **no per-brand consent UX/test**; campaign participation grants only campaign-scoped access.
- **Visibility tiers:** each tier (creator/private, authorised representative, org roster, marketplace summary, campaign-specific, public kit) exposes exactly its defined surface; **negative cross-tenant** tests pass.
- **Missing-data ranking:** unavailable mandatory signal ⇒ `insufficient_data`/`unknown` (not zero/pass); soft-missingness not renormalised to inflate; ranking returns partial_fit/coverage/confidence/missing-list + versions; brand coverage-threshold is a visible filter with explainable exclusions; withdrawal never rewrites historical performance/fraud.
- **Security:** OAuth state CSPRNG/server-bound/one-time/expiring; PKCE where supported; tokens in Vault, encrypted, restricted decrypted view; `SECURITY DEFINER` derives org from auth context and `REVOKE`s PUBLIC; webhook signature/replay/idempotency; no token/message content in logs; pgTAP allow/deny per role & tenant.
- **Messaging (campaign-scoped):** unlinked conversations never classified for intelligence; native IG messages not attributed to an employee; nullable read/delivery handled; ambiguous ⇒ excluded; no content/participants in feature store; ingestion blocked until all Phase-8 gates pass.
- **Retention/disconnect:** each data class honours its matrix row; disconnect invalidates serving features immediately, verifies token revocation, and does **not** delete contracts/invoices; deletion report records what/why.
- **Scoring:** disabling a capability lowers only Confidence + Coverage; Performance/Fraud/trust unchanged; unavailable renders `unavailable`, never `0`; Publishing disable changes no score.
- **Scale:** queue leasing prevents double-processing; DLQ captures poison jobs; budgets/circuit-breakers trip under load; latest-per-creator/time-window queries hit indexes; initial-sync limits recorded per connection.

---

## 20. Rollback plan

Additive-by-construction: `intel` objects can be disabled/dropped without touching `public`; no legacy column altered/dropped early. Feature flags gate every read cut-over (default off). Queue/workers have a kill switch; raw tables are append-only. Backfill links live in `ci_identity_link` (side ledger). Column retirement is a separate, explicitly-approved later migration. Bad metric versions are rolled back by **recompute from immutable raw**, not data surgery.

---

## 21. Remaining decisions, grouped by the phase they block

- **Blocks Phase 0A:** encryption/KMS boundary confirmation (Supabase Vault vs external KMS) and key-custody; final `intel`-schema exposure & grant policy; merge-verification threshold definition.
- **Blocks Phase 0B:** confirm PKCE/state specifics of the active Instagram Login flow; final privacy/data-use **notice version + copy** (legal/DPO); existing-user acknowledgement wording.
- **Blocks Observed ingestion / Feature store:** concrete **retention durations** + legal-hold + backup-deletion windows (legal/DPO); which capability-matrix fields are `verified-in-prod` (runtime capability test results).
- **Blocks Ranking:** visibility-tier exact payloads (marketplace summary vs campaign-shared); brand coverage-threshold defaults & exclusion presentation.
- **Blocks Predicted:** fraud-estimate governance (ownership, appeal SLA, human-in-the-loop); estimated-joint-segment policy (default: none).
- **Blocks Messaging (Phase 8):** confirmation that identity/consent/campaign-linking/privacy/deletion/retention gates are operational; messaging window/opt-in constraints verified in production.
- **Blocks Scale sign-off:** pgmq load-test gate results (fallback broker decision).

---

## 22. PASS / HOLD architecture-gate checklist

| # | Gate | State |
|---|---|---|
| 1 | Identity, platform account, connection, actor access, org relationship are separate; identity has no platform ID / `member_id` | **PASS** (design) |
| 2 | Merges append-only, evidence-based, cycle-safe, unmergeable; no `merged_into` runtime | **PASS** |
| 3 | Brands tenant-scoped; no cross-agency leakage | **PASS** |
| 4 | Audience split follower/reached/engaged; marginals never faked as joints; no estimated joints at launch | **PASS** |
| 5 | Ingestion immutable; no `unique(identity_id, as_of)`; idempotency keys + latest-views; media versioned/tombstoned | **PASS** |
| 6 | Four control systems + visibility tiers; no `ci_consent`/`granted_to_org`/per-brand UX | **PASS** |
| 7 | Missing-data ranking: unavailable≠zero; separate coverage/confidence/missing-list + versions | **PASS** |
| 8 | Security: secure OAuth state, Vault token encryption, hardened `SECURITY DEFINER`, webhook verification, pgTAP | **PASS** (design) |
| 9 | Messaging strictly campaign-scoped; ingestion gated to Phase 8 | **PASS** |
| 10 | Retention matrix defined; disconnect preserves legal/financial records | **PASS** (durations: **HOLD** — legal/DPO) |
| 11 | Queue-based (pgmq) million-creator ingestion; honest initial-sync limits | **PASS** (load-test: **HOLD**) |
| 12 | Single canonical phase list; messaging last | **PASS** |
| 13 | Capability matrix versioned & field-status-tagged; `public_profile`/`email` excluded from audience matrix | **PASS** (field verification: **HOLD** — runtime) |
| 14 | Encryption/KMS custody, retention durations, notice copy, PKCE specifics signed off | **HOLD** — see §21 |

**Overall:** architecture is **PASS to enter Phase 0A** once the §21 Phase-0A blockers (KMS custody, grant/exposure policy, merge threshold) are signed off. All remaining **HOLD** items are legal/DPO or runtime-verification gates tied to specific later phases.

*End of specification. Implementation is intentionally deferred. This is the single canonical design; there is no competing model elsewhere in this document.*
