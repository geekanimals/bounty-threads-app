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

## Amendment A (2026-09-18): Instagram Messaging & Creator Responsiveness

**Trigger.** Meta has now **approved all five** Instagram permissions for this app — adding **`instagram_business_manage_messages`** to the four already in use — and separately **renewed `public_profile` and `email`**. Two facts drive this amendment and must not be conflated:

- **App approval ≠ creator consent.** Meta approving a scope only makes it *requestable*. Each creator still has to grant it, per account.
- **The live OAuth scope string does not yet request `instagram_business_manage_messages`.** (It currently requests `instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_insights`, `instagram_business_manage_comments`.) So **no creator has granted messaging yet**, and existing creators must **reconnect** to grant it. This gap is now tracked as a first-class status (see revised §6).

**Sections changed by this amendment (exact list also reproduced in the closing changelog):**
- **§2.2 Data flow** — added the messaging ingestion path.
- **§3.6 ER model** — registered the messaging entity cluster (detailed in §17.2).
- **§5 RLS matrix** — added rows for conversations, individual messages, response metrics, campaign-linked metadata, messaging audits, and deletion/consent requests (revised matrix + notes).
- **§6 Meta capability matrix** — reworked to hold *approved / requested / granted / valid / revoked* as **distinct, non-interchangeable** statuses, backed by a per-creator scope registry, and to document the OAuth gap + reconnection.
- **§14 Implementation sequence** — messaging folded into the existing phases (not a separate subsystem).
- **§17 (new)** — Instagram Messaging & Creator Responsiveness: messaging design, entities, conversation classification, privacy boundary, responsiveness features, messaging data flow, and the storage decision (data-minimisation default).

Messaging inherits **every** non-negotiable of the base document — especially #2 (consented data only), #3 (tokens & private content stay server-side), #5 (no sensitive inference), #6 (no opaque score), and #7 (provenance envelope on every derived value).

---

## Amendment B (2026-09-18, Prompt 1C): Final consent model — one-time, all-five connection

**Supersedes** every earlier suggestion of progressive consent, staged permission requests, a pre-OAuth permission-selection page, per-permission toggles *before* the first Meta authorization, per-brand progressive grants, and multiple onboarding authorization journeys. **Product decision:** a **single, one-time Instagram connection that requests all five approved permissions together**, on the *existing* connect screen. After connecting, creators manage **internal Geek capability switches** — which are **distinct from Meta permission status** — under **Settings → Connected Accounts → Instagram → Data Access**.

Experience target: **Connect once → approve Meta permissions → intelligence builds automatically → manage access later only if desired.** Backend enforcement stays robust even though the UX is one click.

**Sections changed by this amendment:**
- **§6.3** — OAuth reframed: one request for all five; no staged flows; existing users reconnect **once** (migration).
- **§11** — consent lifecycle rewritten to the one-time model + capability switches (removes progressive/per-brand grants).
- **§14** — Phase 0/2 updated (single all-five scope string; Data Access page; capability switches; existing-user reconnect).
- **§15** — acceptance tests reference §18.12.
- **§18 (new)** — the authoritative Prompt 1C spec: connection flow, disclosure copy, final OAuth flow, Data Access settings, capability entity + semantics, permission-specific warning copy, the **six-measure** scoring/confidence model, brand-side display, re-enable, disconnect, and existing-user migration.

Still bound by the six non-negotiables — in particular, the six measures in §18.7 are **distinct, explainable indices, not one opaque blended score** (#6), and unavailable data is **marked unavailable, never zero** (#7).

---

## Amendment C (2026-09-18, Prompt 1D): Architecture-gate corrections

Design-only corrections from an independent architecture review. **Preserves** the settled one-click, all-five, no-progressive-consent decision (Amendment B) and all six non-negotiables. Where an earlier section conflicted with a correction, that section now carries a "corrected by §19.x" callout and **§19 is authoritative**.

**Sections changed:**
- **§3.1** — `ci_creator_identity` no longer carries `ig_user_id`/`member_id` (→ §19.1 identity/account/actor/org model).
- **§3.5 / §11 / §12** — single `ci_consent` (+ `granted_to_org`, `grant_consent(...)`) replaced by the **four-control model** (§19.6).
- **§6.1** — grant verification not hardcoded to `debug_token` (§19.13).
- **§8** — append-only made **truly immutable** with idempotency keys + "latest" views (§19.5).
- **§19 (new)** — the authoritative gate corrections A–M: identity/account/actor/org ERM; audited reversible merges; tenant-scoped brands; corrected audience model (follower/reached/engaged, marginal-vs-joint); append-only/idempotency + media versioning; four control concepts + visibility tiers; missing-data ranking policy; security hardening; campaign-scoped messaging; retention matrix; million-creator ingestion; corrected phases (0A/0B); versioned capability matrix; acceptance tests; unresolved decisions; and the architecture-gate checklist.

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

Instagram Messaging (webhooks + Conversations API)
   └► granted-scope registry gate (ci_scope_grant) ──► ci-messaging-sync (Edge, service role)
         └► ci_ig_conversations / ci_ig_messages   (MINIMISED: platform ids, direction,
              timestamps, delivery/read state; content encrypted, stored only if inbox needs it)
         └► conversation classification ──► privacy filter (campaign-operational only)
         └► ci_ig_message_events (response-event LEDGER, no text)
         └► ci_response_metric_snapshots ──► ci_metric (responsiveness, with provenance)
```

**Invariants:** raw ingestion is append-only and written only by service-role Edge Functions; the browser never touches raw metric tables directly — only consent- and RLS-gated views/RPCs; tokens never leave `social_tokens`.

---

## 3. Proposed entity-relationship model

All new objects live in a dedicated **`intel` schema** (prefixed `ci_` in prose) so they can be enabled/disabled/rolled back without touching `public`. Existing tables are extended only with **nullable** FK columns (Section 4).

### 3.1 Identity spine

- **`ci_creator_identity`** — the canonical **human/talent/creator entity**. **Corrected by Amendment C (§19.1):** it carries **no platform-specific ID and no `member_id`** — those move to `ci_platform_account` and `ci_identity_actor_access`. A creator can exist **without a Geek login** (e.g. an agent-managed celebrity) and can hold **multiple** platform accounts. Fields: `identity_id uuid pk`, `display_name text`, `kind` (`creator`|`celebrity`|`talent`), `is_claimed bool`, `created_at`. Merges are audited/reversible via `ci_identity_merge_event` (§19.2), not a bare `merged_into`. **The spine every metric hangs from.**
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

- **`ci_consent`** — **superseded by Amendment C (§19.6).** The single `ci_consent` conflated three separate concerns; it is replaced by **four independent systems**: `ci_scope_grant` (Meta permission state), `ci_processing_consent` (privacy-notice/purpose/version accepted), `ci_capability_switch` (internal feature controls), and **relationship-based visibility tiers** (not per-brand grants). The `granted_to_org` field and per-brand consent toggles are **removed** (§19.6).
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

— messaging cluster (see §17.2) —
ci_creator_identity 1─* ci_scope_grant           (per-scope status: approved/requested/granted/valid/revoked)
ci_creator_identity 1─* ci_ig_conversations 1─* ci_ig_messages
ci_ig_conversations 1─* ci_ig_message_events     (response-event ledger, no text)
ci_ig_conversations *─1 conversation_assignments (→ members)
ci_ig_conversations *─* public.campaigns         (via ci_conversation_campaign_links)
ci_creator_identity 1─* ci_response_metric_snapshots ──► ci_metric (responsiveness)
ci_messaging_sync_jobs ──► ci_ingest_run (provenance)   ci_creator_identity 1─* ci_messaging_consent_events
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
| **`ci_ig_conversations`** (metadata: ids, category, timing, state — **no text**) | Own | — | Org **campaign-operational** convs, when authorised | Org (same) | Org (assigned talent) | Metadata only |
| **`ci_ig_messages`** — **message content** | Own | — | Authorised campaign convs **only**, audited | Org (same) | Org (same) | **No routine access** (break-glass only, audited) |
| **`ci_ig_message_events`** (response-event ledger, no text) | Own | — | Org (campaign) | Org | Org | All (no text) |
| **campaign-linked message metadata** (`ci_conversation_campaign_links`) | Own | Own campaigns (metadata only) | Org (their campaigns) | Org | Org | All |
| **derived response metrics** (`ci_response_metric_snapshots` / responsiveness `ci_metric`) | Own | **Aggregated indicators only** | Org | Org | Org | All (values, no text) |
| **`conversation_assignments`** | Own (who's assigned) | — | Org | Org | Org | All |
| **messaging audit** (`audit_log`, msg-content access) | Own actions | — | Org (their workspace) | Org | Org | All |
| **messaging consent / deletion** (`ci_messaging_consent_events`, `ci_data_request`) | Own (manage) | — | request / view | request / view | request / view | All (view) |
| raw tokens (`social_tokens`) & private message content at rest | — | — | — | — | — | — (service role only) |

**Notes.** (a) A **brand** never sees a creator's data merely because the creator exists — only when the creator **consented to that brand** or **participated in that brand's campaign**. (b) **Agency/corporate/manager** see identities linked to *their own roster* (`org_id`), matching today's `creators` RLS. (c) Every cross-identity read (ranking, search) runs through a `SECURITY DEFINER` function that filters by consent + org before returning — the browser cannot enumerate identities. (d) **Brands never see raw DMs** — only aggregated response/reliability indicators. (e) **Super admins have no routine access to message content**; content reads are a separate, break-glass, *always-audited* path, and even then metadata/aggregates are the default. (f) **Unrelated / private conversations are excluded from every scoring input** — the privacy filter drops them before the response ledger (§17.4). (g) Message **content** rows carry RLS with **no client policies** (service-role only, like `social_tokens`); the operational inbox reads them through an audited, consent-checked `SECURITY DEFINER` function, never directly.

---

## 6. Meta permission capability matrix

> **Revised by Amendment A.** A permission is not one boolean. Five statuses below are **distinct and must never be treated as interchangeable** — most visibly, *app-approved* is not *creator-granted*, and *granted* is not *currently valid*. The engine tracks all five per creator in a **granted-scope registry** (`ci_scope_grant`, §17.2); features gate on **valid grant**, not on app approval.

### 6.1 The five permission statuses (per creator, per scope)

| Status | Meaning | Where tracked | Feature gate uses it? |
|---|---|---|---|
| **Approved by Meta** | App may *request* this scope in OAuth | App config (constant) | No — necessary, not sufficient |
| **Requested during OAuth** | The scope is in the live authorize URL's scope string | OAuth config → mirrored to `ci_scope_grant.requested` | No — determines what a creator is *asked* for |
| **Granted by creator** | This creator approved the scope at connect | `ci_scope_grant.granted_at` (from the **grant/scope-verification method supported by the active Instagram Login flow + Graph API version** — *not hardcoded to `debug_token`*, §19.13) | Precondition |
| **Currently valid** | Granted **and** token unexpired/unrevoked | `ci_scope_grant.valid` (derived from `social_tokens.expires_at` + last check) | **Yes — the real gate** |
| **Revoked / expired** | Previously valid, now not (creator removed the app, token lapsed, permission deauthorised) | `ci_scope_grant.revoked_at` / `valid=false` | Yes — disables features, triggers reconnect prompt |

**Consequence:** the engine must always distinguish these. A missing responsiveness metric because a creator *never granted messaging* is a different fact from *token expired* — and both differ from *no messages exist* (§17.5 makes this explicit).

### 6.2 App-approval state (verified 2026-09-18)

All five Instagram scopes are **approved by Meta**: `instagram_business_basic`, `instagram_business_manage_insights`, `instagram_business_manage_comments`, `instagram_business_content_publish`, **`instagram_business_manage_messages`** (new). `public_profile` and `email` are **renewed**.

### 6.3 OAuth request gap → single all-five request (revised by Amendment B)

The live OAuth scope string requests only **four** of the five: `instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_insights`, `instagram_business_manage_comments`. It **omits `instagram_business_manage_messages`**.

**Final decision (Prompt 1C):** the fix is a **single scope-string change** so the *one existing* connect flow requests **all five together** (§18.3). No staged flow, no pre-OAuth selection page, no multiple journeys. Consequences:

- **No creator has granted messaging yet** — even though Meta approved it — because the current string omits it.
- The scope string becomes exactly: `instagram_business_basic,instagram_business_manage_insights,instagram_business_manage_comments,instagram_business_manage_messages,instagram_business_content_publish` (Phase 0; **not implemented in this step**).
- **Existing creators reconnect once** to grant the new scope (migration, §18.11); a new connection grants all five up front. Reconnect status is surfaced from `ci_scope_grant` (e.g. a banner: "Reconnect Instagram to enable campaign messaging"). Messaging features stay dark for any creator without a **currently valid** messaging grant, labelled `missing_permission`, never `no_response`.

### 6.4 Capability → feature matrix

| Permission | Provides (raw) | Feeds engine features |
|---|---|---|
| `instagram_business_basic` | profile (id, username, name, account_type, followers/follows/media counts, picture, bio, website); media (caption, type, url, permalink, timestamp, like_count, comments_count, children) | identity, follower time-series, posting cadence, engagement rate |
| `instagram_business_manage_insights` | **account insights** (reach, impressions, profile_views, follower_count over time, accounts_engaged); **media insights** (reach, impressions, saved, likes, comments, shares, plays, total_interactions); **follower_demographics** (age·gender / country / city — *lifetime, aggregate, ≥100 followers*) | avg reach (with sample size), effective CPM/CPC base, geographic strength, category affinity (perf-weighted), content quality |
| `instagram_business_manage_comments` | comments on the creator's media; mentions/tags | comment sentiment, organic brand mentions, audience-response quality |
| `instagram_business_content_publish` | create/publish media (containers → publish) | *(publishing only — not analytics)* |
| **`instagram_business_manage_messages`** | **Instagram Conversations API + Messaging webhooks**: conversations, messages (id, direction, timestamp, delivery/read state, minimal content); the operational campaign inbox | **campaign inbox**; **creator responsiveness** (response times, acceptance/decline, follow-ups, conversion) — **derived from timing/metadata; raw content minimised & never scored** (§17) |
| `public_profile` | basic public profile | identity resolution, media-kit fallback |
| `email` | account email | account linkage, notifications |

### 6.5 Explicitly NOT available from Meta creator APIs (must be derived, estimated, or externally sourced)

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
- **Idempotency & immutability — corrected by Amendment C (§19.5):** snapshots are **truly append-only**; historical rows are **never updated**. Each carries `source_observed_at`, `captured_at`, `ingest_run_id`, `source_record_id` (where available), and a `payload_hash`/`idempotency_key`. Duplicate delivery of the *same* observation is ignored via the idempotency key; a second observation the same day whose `source_observed_at` **or** payload differs creates **another immutable row**. Current values are served from **"latest" views/materialized views**, not by overwriting history.
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

> **Revised by Amendment B (Prompt 1C).** Consent is a **one-time, all-five Instagram connection** (no progressive/staged/per-brand grants). Ongoing creator control is via **internal Geek capability switches**, which are **distinct from Meta permission status**. The authoritative spec — connection flow, disclosure copy, Data Access page, capability semantics, warnings, scoring, brand display, disconnect, migration — is **§18**. This section keeps the underlying data-protection invariants.

1. **Grant (one-time)** — at Instagram connect the creator approves **all five** Meta permissions together (§18.3). Record grant per scope in `ci_scope_grant` (status model, §6.1) and a connection consent record in `ci_consent` (`scope`, `purpose`, `consent_version`). Brand visibility is governed by **org-scope RLS + capability state + aggregation rules** (§18.8), **not** per-brand grant toggles.
2. **Minimize** — store Meta **aggregate** demographics only; store message **timing/metadata**, not content (content only if the inbox needs it, TTL'd — §17.7); retention-limit comment text; never store raw tokens outside `social_tokens`.
3. **No sensitive inference** — the engine must not infer ethnicity, religion, health, sexual orientation, or re-identify individual audience members. Category/geo features use Meta aggregates and public post text only.
4. **Purpose limitation** — metrics computed for evaluation/ranking; not sold, not cross-purposed.
5. **Capability disable vs. disconnect (two distinct levels)** — **Disabling a capability** (§18.4) is an *internal Geek switch*: it stops that capability's API calls/ingestion and excludes its data from future intelligence, records `{date, user, consent_version}`, and applies the stated historical-data retention/deletion treatment — but it does **not** claim the Meta permission was revoked unless Geek actually revoked it via a supported Meta mechanism. **Disconnect Instagram** (§18.10) is full removal: `ci_scope_grant`/`ci_consent` revoked, `ci-ingest`/`ci-messaging-sync` stop, and a purge job removes/anonymizes raw + derived rows within the SLA, cascading to `ci_metric`, `ci_ranking_result`, and messaging tables. Wired to the existing `data-deletion.html` flow and Meta's data-deletion callback.
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
| `record_processing_consent(notice_version, purposes)` / `set_capability(capability, enabled)` | RPC | four-control model (§19.6) — **replaces** `grant_consent(scope, granted_to_org?)`; **no per-brand grant** | self (creator) |
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

Messaging is **woven into** these phases, not bolted on as a separate system: it reuses the identity spine, the consent model, the provenance envelope, `ci_metric`, and the ranking pipeline.

- **Phase 0 — Foundations (no behaviour change):** create `intel` schema; `ci_creator_identity`, `ci_identity_link`, `ci_consent`, `ci_ingest_run`; feature flags. Seed identities from `social_accounts` + shadow identities from `creators`. **Messaging/consent (Amendment B):** add the **`ci_scope_grant`** registry and the **`ci_capability_switch`** table (internal toggles, §18.4); change the *single* OAuth scope string to request **all five** together (§18.3); add the first-run disclosure copy beside the existing Connect button (§18.2); build **Settings → Connected Accounts → Instagram → Data Access** (§18.5); add the reconnect banner surfaced from scope status. *Ship dark.*
- **Phase 1 — Observed time-series:** `ci-ingest` + append-only snapshot tables; backfill seed from `social_accounts`; daily cron. **Messaging:** stand up the **Messaging webhook receiver** + **`ci-messaging-sync`** job writing **minimised** `ci_ig_conversations` / `ci_ig_messages` / `ci_ig_message_events` (gated on a *valid* messaging grant); operational inbox read path (audited, consent-checked). Verify idempotency & provenance. *Still no user-facing scoring change.*
- **Phase 2 — Additive IDs & dual-write:** add nullable FK columns (Section 4); app dual-writes; backfill `ci_identity_link`; reconcile. **Messaging:** `ci_conversation_campaign_links` + `conversation_assignments` wired to existing campaigns; conversation **classification** (§17.3) runs; privacy filter drops non-campaign/private threads. Reads still legacy.
- **Phase 3 — Feature store (observed→derived):** `ci_metric` + recipes for engagement, avg reach, category, geo, content quality, sentiment, reliability. **Messaging:** `ci_response_metric_snapshots` → responsiveness metrics (first-response time, acceptance/decline, follow-ups, unresolved) into `ci_metric` with `insufficient_data` handling and the *no-response ≠ missing-permission ≠ expired-token ≠ API-failure* distinctions (§17.5). Consent-gated `get_creator_intelligence`; brand sees **aggregated indicators only**.
- **Phase 4 — Ranking & NL search:** `ci_brand`, `ci_campaign_participation`, `ci_commercials`; `ci_rank` + `nl_search`; effective CPM/CPC. Responsiveness enters ranking as **one named, capped sub-signal** (never as quality by itself). Replace the client `matchScore()` heuristic.
- **Phase 5 — Predicted & external:** `ci_conversions` ingestion (CPA/ROAS), fraud-risk **estimate** model, exclusivity/conflict detection, conversation-to-campaign conversion rate. Full presentation contract enforced.
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
- **Consent/connection/scoring (Amendment B):** the one-time all-five flow, capability switches, the six-measure scoring separation, unavailable≠zero, brand partial-verification display, and messaging privacy — full list in **§18.12**.

---

## 16. Rollback plan

- **Additive-by-construction.** New objects live in the `intel` schema and can be **disabled or dropped without touching `public`**. No legacy column is altered or dropped in early phases.
- **Feature flags** gate every read cut-over; flipping a flag reverts to the legacy text path instantly. Default-off until verified.
- **`ci-ingest` kill switch** (flag + cron disable) stops all new writes; raw tables are append-only so nothing legacy is corrupted.
- **Reversible backfill:** links live in `ci_identity_link` (a side table); the added FK columns are nullable and can be nulled/ignored without data loss.
- **Column retirement** (making an id `NOT NULL`, dropping a text column) happens only after ≥ N release cycles of verified dual-write, as a separate, explicitly-approved migration with its own rollback.
- **Recompute, not repair:** because raw is immutable and recipes are versioned, a bad metric version is rolled back by recomputing from raw with the previous version — no data surgery.

---

## 17. Instagram Messaging & Creator Responsiveness (Amendment A)

Messaging is an **additive extension** of the same engine: same identity spine, same consent model, same provenance envelope, same explainable ranking. It exists to (a) give agencies a campaign-operational inbox and (b) derive **responsiveness** signals — **never** to expose or mine private conversations.

### 17.1 Messaging architecture (components)

- **Granted-scope gate.** Every messaging read/sync first checks `ci_scope_grant` for a **currently valid** `instagram_business_manage_messages` grant for that creator (§6.1). No valid grant → feature is `missing_permission`, and a reconnect prompt is surfaced. Nothing is synced.
- **Webhook receiver.** A new Edge Function subscribes to Instagram **Messaging webhooks** (`messages`, `message_reactions`, delivery/read). Events are verified (signature), enqueued, and processed idempotently. Webhooks carry minimal payloads; the **Conversations API** backfills/repairs gaps.
- **Message sync jobs.** `ci-messaging-sync` (service role) reconciles conversations/messages for creators with a valid grant, on webhook trigger + a periodic sweep (catch missed events, respect rate limits, resume from a cursor). Provenance via `ci_messaging_sync_jobs` → `ci_ingest_run`.
- **Encrypted operational inbox.** Conversations/messages are stored **minimised** (§17.7). Any retained content is encrypted at rest and reachable only through an audited, consent-checked `SECURITY DEFINER` inbox function — never a direct table read, never the browser.
- **Conversation classification.** Each conversation is categorised (§17.3). Only **campaign-operational** categories may flow into intelligence; everything else is filtered out before the ledger.
- **Privacy filter.** Sits between classification and the response ledger. Drops `unrelated/private` and anything not tied to a campaign; strips content; emits **timing/metadata-only** events.
- **Response-event ledger.** `ci_ig_message_events` records *events* (`inbound_received`, `first_response_sent`, `follow_up_sent`, `accepted`, `declined`, `resolved`) with timestamps and links — **no message text**. This is the substrate for responsiveness metrics.
- **Conversation assignments.** `conversation_assignments` maps a campaign conversation to the responsible agency member (for SLA attribution and inbox routing).
- **Campaign-conversation links.** `ci_conversation_campaign_links` ties a conversation to a `public.campaigns` row (many-to-many), so responsiveness is measured *per campaign context*, not on private chatter.
- **Response-SLA events.** SLA breaches/targets are computed from the ledger (e.g. first-response > target) and stored as events feeding `agency response SLA` and `unresolved campaign conversations`.
- **Consent & revocation events.** `ci_messaging_consent_events` append-only records grant/reconnect/revoke transitions specific to messaging, driving sync eligibility and deletion.
- **Retention & deletion.** Content (if any) has the **shortest viable TTL**; a purge job removes content past TTL and on revoke/deletion, cascading to derived rows where required (§17.4, §17.7).

### 17.2 Required entities (adapted to repo `ci_`/`intel` conventions)

All in the `intel` schema; all raw/content tables are **service-role only** (RLS on, no client policies), read via audited functions. Names map to the brief's requested entities.

| Brief entity | This design | Shape (minimised) |
|---|---|---|
| *(scope registry — new prerequisite)* | **`ci_scope_grant`** | `identity_id`, `member_id`, `platform`, `scope`, `requested bool`, `granted_at`, `valid bool`, `revoked_at`, `last_checked_at`, `source` |
| instagram_conversations | **`ci_ig_conversations`** | `conversation_id` (platform id) PK, `identity_id`, `ig_thread_ref`, `counterparty_ref` (opaque/pseudonymised), `category` (§17.3), `is_campaign_operational bool`, `status`, `first_seen_at`, `last_event_at`, `msg_count` |
| instagram_messages | **`ci_ig_messages`** | `message_id` (platform id) PK, `conversation_id`, `direction` (`inbound`\|`outbound`), `sent_at`, `delivery_state`, `read_state`, `content_ref null` (encrypted blob ref **only if inbox needs it**), `content_ttl_at` |
| instagram_message_events | **`ci_ig_message_events`** | `id`, `conversation_id`, `event_type`, `at`, `campaign_id null`, `actor_member_id null` — **no text** |
| conversation_assignments | **`conversation_assignments`** | `conversation_id`, `assigned_member_id` (→ members), `assigned_at`, `state` |
| conversation_campaign_links | **`ci_conversation_campaign_links`** | `conversation_id`, `campaign_id` (→ public.campaigns), `linked_by`, `linked_at`, `link_method` |
| creator_response_metric_snapshots | **`ci_response_metric_snapshots`** | `identity_id`, `as_of`, `window`, `metric_key`, `value_num`, `sample_size`, `confidence`, `status` (`ok`\|`insufficient_data`\|`missing_permission`\|`token_expired`\|`sync_error`), `run_id` |
| messaging_sync_jobs | **`ci_messaging_sync_jobs`** | `job_id`, `identity_id`, `started_at`, `finished_at`, `cursor`, `status`, `events_processed`, `error`, `run_id` |
| messaging_consent_events | **`ci_messaging_consent_events`** | `id`, `identity_id`, `event` (`granted`\|`reconnected`\|`revoked`\|`deleted`), `scope`, `at`, `evidence` |

Responsiveness metrics also land in the shared **`ci_metric`** feature store (tier `derived`) so ranking and `get_creator_intelligence` treat them uniformly, each with the full provenance envelope.

### 17.3 Conversation classification

Every conversation gets exactly one category. Classification runs server-side (rule + model, versioned in the provenance envelope). **Only the campaign-operational categories (★) may contribute to Creator Intelligence**; the rest are inbox-only or excluded entirely.

| Category | Contributes to intelligence? |
|---|---|
| ★ campaign invitation | Yes |
| ★ active campaign | Yes |
| ★ commercial negotiation | Yes (timing only; commercials themselves live in `ci_commercials`) |
| ★ deliverable discussion | Yes |
| ★ revision or approval | Yes |
| ★ logistics | Yes |
| support | No (operational inbox only) |
| inbound brand enquiry | Yes, **only** once linked to a campaign; else inbox-only |
| unrelated / private | **Never** — dropped by the privacy filter, excluded from scoring |
| unclassified | **Never** used for scoring until confidently classified; may sit in inbox as "needs review" |

**Rule:** a conversation influences responsiveness metrics **only** if `is_campaign_operational = true` **and** it is linked to a campaign (`ci_conversation_campaign_links`). Uncertainty defaults to *exclude*.

### 17.4 Privacy boundary (enforced, not aspirational)

- **Agencies** access **campaign conversations in their own workspace** when authorised (assignment/role), through the audited inbox function — scoped by `org_id` + campaign link.
- **Creators** access **their own** conversations and their own derived metrics; they own the consent and deletion controls.
- **Brands** see **aggregated response/reliability indicators only** — never a message, never a thread, never a counterparty. Aggregates respect a minimum sample size (no re-identification).
- **Brands must never see raw creator DMs.** Enforced by RLS (no brand policy on content tables) + the aggregation-only read path.
- **Super admins** have **no routine access to message content.** Content access is a separate **break-glass** path, always audited, and justified; day-to-day admin uses metadata/aggregates.
- **Unrelated/private conversations cannot affect scoring** — filtered before the ledger; never reach `ci_metric`.
- **Content minimisation & TTL:** full message content is **not retained longer than necessary** (§17.7); default is to store no content at all.
- **Creator controls:** disconnect, revoke, delete, correct, and **dispute** (contest a derived metric) — each recorded with provenance; revoke/delete purge content + cascade derived rows.
- **Auditing:** **every** access to message content is written to `audit_log` (actor, conversation, purpose, timestamp).
- **Never log content:** message text must **never** be written to application logs, error traces, or analytics. Logs carry ids and event types only.
- **Server-side only:** tokens and any private message content remain server-side; the browser receives inbox views and aggregates through consent-checked functions, never raw rows.

### 17.5 New intelligence features (responsiveness)

Each is a distinct `ci_metric` key (tier `derived`) with the full provenance envelope (`sample_size`, `confidence`, `window`, `method`/`model_version`, `computed_at`) and an explicit **`status`**:

| Feature | metric_key | Notes |
|---|---|---|
| Campaign invitation response rate | `campaign_invite_response_rate` | responded invites ÷ invites |
| Median first-response time | `first_response_time_median` | over campaign-operational convs |
| p75 first-response time | `first_response_time_p75` | tail latency |
| Acceptance rate | `campaign_acceptance_rate` | accepted ÷ decided |
| Decline rate | `campaign_decline_rate` | declined ÷ decided |
| Follow-ups before response | `follow_ups_before_response` | agency nudges needed |
| Conversation-to-campaign conversion rate | `conversation_to_campaign_rate` | convs that became live participation |
| Unresolved campaign conversations | `unresolved_campaign_conversations` | open past SLA |
| Creator last campaign response | `last_campaign_response_at` | recency |
| Agency response SLA | `agency_response_sla` | attributed to the agency member, not the creator |
| Sample size / confidence / window | (envelope on every row) | mandatory |

**Non-negotiable distinctions (encoded in `status`, never collapsed to a single "no response"):**

- **`no_response`** — messages exist, creator did not reply. A real signal.
- **`missing_permission`** — creator never granted (a valid) `instagram_business_manage_messages`. **Not** a responsiveness fact; shows a reconnect prompt.
- **`token_expired`** — grant lapsed/revoked; sync paused. **Not** a responsiveness fact.
- **`sync_error`** — API/webhook failure or backlog. **Not** a responsiveness fact; ops alert.
- **`insufficient_data`** — below the minimum sample size for the window → the metric **returns `insufficient_data`**, not a number, and does not enter ranking.

**And:** **response speed is not creator quality by itself.** Responsiveness is one capped sub-signal in brief-specific ranking (§10/§17.6); it is never presented as an overall grade, and fast replies never override poor fit or content signals.

### 17.6 Updated data flow (messaging path)

```
Instagram OAuth (scope string now includes manage_messages)
  → granted-scope registry (ci_scope_grant: approved≠requested≠granted≠valid≠revoked)   ─ gate ─►
  → Conversations API + Messaging webhooks
  → ci-messaging-sync (service role, idempotent, provenance via ci_messaging_sync_jobs)
  → encrypted operational inbox (ci_ig_conversations / ci_ig_messages, MINIMISED, audited reads)
  → conversation classification (§17.3)
  → privacy filter (campaign-operational + campaign-linked only; content stripped)
  → response-event ledger (ci_ig_message_events — timing/metadata, NO text)
  → aggregated creator responsiveness features (ci_response_metric_snapshots → ci_metric, with status + confidence)
  → explainable brief-specific ranking (responsiveness = one named, capped sub-signal)
```

### 17.7 Architecture decision — store metadata, not message text (data-minimisation default)

**Decision:** Geek OS **does not store full message text by default.** For each message it stores: **platform message id, direction, timestamp, conversation category, campaign link, response timing, and delivery/read state where available.** **Limited encrypted content is stored only when strictly required for inbox functionality**, under the shortest viable TTL, encrypted at rest, access audited.

**Why:** it satisfies both goals (operational inbox + responsiveness) from **metadata and timing alone**; it minimises breach blast-radius and regulatory surface; it makes revoke/delete cheap and complete; and it structurally prevents private content from ever reaching scoring (the ledger is text-free). Full-text retention would add risk and compliance burden for **no** additional intelligence value, since responsiveness is a function of *events and timing*, not content.

**Consequences:** the inbox shows recent content live from the API (fetch-on-view) rather than a long-term text store; content columns (`ci_ig_messages.content_ref`) are nullable and TTL'd; classification runs on transient content server-side and persists only the resulting category, never the text; deletion is a metadata + short-TTL-content operation.

**Rejected alternative:** *store full conversation text for richer NLP.* Rejected — violates data minimisation (#2/#3/#5), enlarges breach/compliance exposure, complicates deletion, and yields no responsiveness signal that timing/events don't already provide.

### 17.8 Messaging API contracts (design-level)

| Contract | Kind | Purpose | Auth |
|---|---|---|---|
| `ig_messaging_webhook` | Edge (public, signed) | verify + enqueue Instagram webhook events | Meta signature |
| `ci_messaging_sync(identity)` | Edge | reconcile conversations/messages for a valid-grant creator | service role / cron |
| `get_campaign_inbox(campaign_id)` | RPC | audited, consent-checked inbox view (metadata + fetch-on-view content) | agency org + assignment |
| `classify_conversation(conversation_id)` | Edge | server-side category (versioned) | service role |
| `get_creator_responsiveness(identity_id)` | RPC | responsiveness `ci_metric` **with status + provenance**; brands get aggregates only | consent + RLS |
| `record_messaging_consent(event)` / `revoke_messaging(identity)` | RPC | consent lifecycle + purge trigger | self (creator) |
| `dispute_metric(metric_ref)` | RPC | creator contests a derived responsiveness value | self (creator) |

---

## 18. Consent, Capability Management & Scoring (Amendment B / Prompt 1C)

Authoritative spec for the final consent model. **Design only — not implemented.**

### 18.1 Connection UX principle

One flow, one click, all five permissions. **Connect once → approve Meta permissions → intelligence builds automatically → manage access later only if desired.** No progressive consent, no staged requests, no pre-OAuth selection page, no per-permission toggles before the first authorization, no multiple onboarding journeys. Backend enforcement (§5, §6.1, §17.4) stays robust regardless.

### 18.2 First-run disclosure copy (verbatim)

Shown beside the *existing* Connect Instagram button:

> **Build your verified Creator Intelligence profile.**
> Geek uses your Instagram data to build a verified Creator Intelligence profile — content performance, audience & geographic strength, engagement quality, category affinity, organic brand mentions, campaign responsiveness, reliability, fraud & anomaly signals, and platform performance.
> Links: **What Geek analyses** · **Privacy Policy** · **Data Use Policy** · **Disconnect Instagram**

**Primary CTA:** **“Connect Instagram & Build My Profile”**

On click → immediately open Meta's Instagram authorization requesting all five permissions together.

### 18.3 Final OAuth flow

1. **Scope string** (single request): `instagram_business_basic,instagram_business_manage_insights,instagram_business_manage_comments,instagram_business_manage_messages,instagram_business_content_publish`.
2. Creator approves at Meta → callback with `code`.
3. **Server** exchanges `code` for a token (Edge Function, service role). **Tokens never touch browser storage** (unchanged from today).
4. **Verify granted permissions** (`debug_token` / token response) — Meta may grant a subset. Write per-scope status to **`ci_scope_grant`** (approved/requested/granted/valid/revoked, §6.1).
5. **Store granted-permission state**; default all **capability switches** (§18.4) to *enabled* for scopes actually granted.
6. **Auto-start initial ingestion** (`ci-ingest` + `ci-messaging-sync`) for granted+valid scopes.
7. **Show ingestion progress** to the creator (a building-profile state).
8. **Generate the first intelligence profile** once sufficient data is collected (else `insufficient_data`, not zeros).
9. **Gracefully handle**: declined authorization, missing/partial permissions, expired tokens, revoked access — each a distinct, labelled state (never conflated with `no_response`/zero).

### 18.4 Capability model (internal switches ≠ Meta permission)

New table **`ci_capability_switch`**: `identity_id`, `capability`, `enabled bool`, `changed_at`, `changed_by`, `consent_version`, `retention_treatment`. **An internal Geek capability switch is distinct from Meta permission status** (`ci_scope_grant`). Capabilities:

| Capability | Backing scope | Operational vs intelligence |
|---|---|---|
| Performance Insights | `…manage_insights` | intelligence |
| Comment Intelligence | `…manage_comments` | intelligence |
| Campaign Messaging Intelligence | `…manage_messages` | intelligence |
| Publishing & Scheduling | `…content_publish` | **operational** (not a score input) |

`instagram_business_basic` **cannot be disabled independently** (required for the connection); removal is via **Disconnect Instagram** only.

**On disable, the engine:** stops all new API calls requiring that permission; stops related ingestion jobs; stops using that data in *future* intelligence calculations; records `{date, user, consent_version}`; applies & explains the historical-data retention/deletion treatment; **does not** silently re-enable; **does not** claim the Meta permission was revoked unless Geek revoked it via a supported Meta mechanism.

### 18.5 Data Access settings design

**Settings → Connected Accounts → Instagram → Data Access.** Lists the four toggles above (each: name, plain-language description, enabled state, last-changed) plus a distinct **Disconnect Instagram** action. Toggling **off** first shows the confirmation warning (§18.6). Toggling **on** follows §18.9 (resume vs. reauthorize). `basic` shown as always-on/required.

### 18.6 Permission-specific warning copy (verbatim)

General structure (shown before any disable):

> **Reduce Creator Intelligence coverage?**
> Turning off **[capability]** will reduce the Instagram information Geek can verify. Your account will remain active, but your Creator Intelligence Confidence may decrease and brands may see fewer verified signals when evaluating your profile.
> Buttons: **Keep Enabled** · **Turn Off [Capability]**

Per-capability impact line:

- **Performance Insights** — “Turning this off prevents verification of reach, impressions, audience composition and content performance. This materially reduces Creator Intelligence Confidence.”
- **Comment Intelligence** — “Turning this off prevents ongoing analysis of comment quality, sentiment, engagement authenticity and community response.”
- **Campaign Messaging Intelligence** — “Turning this off prevents Geek from calculating campaign response times and communication-reliability signals.”
- **Publishing and Scheduling** — “Turning this off disables Geek publishing, scheduling and campaign-posting workflows.” *(Operational only — must not lower authenticity or performance scores.)*

### 18.7 Scoring, Confidence & Coverage model

Six **separate, explainable** measures (not one opaque blend — honours #6):

1. **Creator Performance Score** — reach/engagement/content performance (from insights).
2. **Reliability Score** — responsiveness + fulfilment/deadline history.
3. **Brand-Safety Score** — content/comment signals + conflict/exclusivity.
4. **Fraud Probability** — a labelled **estimate** with evidence (never a fact).
5. **Creator Intelligence Confidence** — how much the engine trusts its own read (function of coverage + freshness + sample size).
6. **Verified Data Coverage** — % of intelligence categories currently verifiable given enabled capabilities + valid grants.

**Rules (enforced in compute + presentation):** disabling a capability / withdrawing a permission may **only** lower **Confidence** and **Coverage**. It must **not** automatically reduce actual campaign Performance, increase Fraud Probability, label the creator untrustworthy, or fabricate a zero. **Unavailable data is marked `unavailable`, never `0`.** Operational Publishing has **no** effect on any score. Response speed alone is never equated with quality (§17.5).

### 18.8 Brand-side display

When capabilities are disabled, brands see:

> **Partially verified Instagram profile — some intelligence signals are unavailable.**

Plus: **Verified Data Coverage %**, **last successful verification date**, **available** intelligence categories, **unavailable** categories, and a **confidence level per prediction**. Language is **neutral** — never reveal or frame a creator's privacy choice judgmentally or negatively. Brands receive **derived/aggregated** signals only — never raw DMs, never message content or participants (§17.4).

### 18.9 Re-enabling access

If a creator switches a capability back on: **resume immediately** if the Meta permission is still granted and the token is valid; require **one** Meta reauthorization **only** if the permission is missing/expired/revoked — and **explain why** before redirecting. No silent re-enable.

### 18.10 Full disconnection

A separate **Disconnect Instagram** action. Before disconnecting, explain: new Instagram ingestion stops; the profile loses ongoing verification; Creator Intelligence Confidence decreases over time; Instagram-dependent campaign features stop; historical data is handled per the published retention/deletion policy. Executes the full revoke + purge path (§11.5).

### 18.11 Existing-user migration

Existing creators were connected under the four-scope string, so they lack a **valid messaging grant** and (initially) any `ci_capability_switch`/`ci_scope_grant` rows. Migration: (a) backfill `ci_scope_grant` from current `social_tokens`/`social_accounts` for the four scopes; default their capabilities enabled; (b) messaging capability shows **`missing_permission`** with a **one-time reconnect** banner ("Reconnect Instagram to enable campaign messaging"); (c) reconnect uses the same all-five flow and grants messaging up front; (d) no feature silently assumes messaging until a valid grant exists — responsiveness reports `missing_permission`, never `no_response`/zero.

### 18.12 Acceptance tests

- **One flow, all five:** the connect CTA opens exactly one Meta authorization whose scope string is the five-scope string; no pre-OAuth selection page exists.
- **Token safety:** no Instagram token is ever present in browser storage/network to the client; exchange is server-side.
- **Granted-state truth:** partial grants are recorded per scope; features gate on **valid**, not on app-approval.
- **Auto-ingest + progress:** a successful connect starts ingestion and shows progress; first profile appears only after sufficient data, else `insufficient_data`.
- **Capability disable:** stops API calls/ingestion for that scope, excludes its data from future calc, records `{date,user,consent_version}`, applies stated retention, never silently re-enables, and does not assert Meta revocation unless actually performed.
- **Warning gate:** disabling shows the §18.6 warning with the correct per-capability impact; Publishing disable changes no score.
- **Scoring separation:** disabling a capability lowers only Confidence + Coverage; Performance/Fraud/trust unchanged; unavailable metrics render `unavailable`, never `0`.
- **Brand display:** partial profiles show the exact §18.8 copy + coverage %/last-verified/available/unavailable/per-prediction confidence, in neutral language; no raw DMs or message content/participants ever surface to brands.
- **Re-enable:** resumes without reauth when grant valid; requires one reauth (with explanation) when missing/expired/revoked.
- **Disconnect:** stops ingestion, executes purge per policy, shows the §18.10 explanation first.
- **Migration:** existing users show messaging as `missing_permission` + reconnect banner; reconnect grants all five; nothing reports `no_response` for a missing grant.

---

## 19. Architecture-gate corrections (Amendment C / Prompt 1D)

Authoritative over any conflicting earlier text. **Design only — nothing implemented.**

### 19.1 Identity ≠ platform account ≠ authorised user ≠ org relationship (correction A)

The old spine wrongly assumed *one Instagram account and one login per creator*. Split into five entities:

- **`ci_creator_identity`** — the human/talent/creator entity. **No platform ID, no `member_id`.** Can exist with no Geek login; can be an agent-managed celebrity. `identity_id`, `display_name`, `kind`, `is_claimed`, `created_at`.
- **`ci_platform_account`** — `platform_account_id`, `platform`, `platform_user_id`, `username`, `account_type`, `status`, `first_seen_at`, `last_verified_at`; **`unique(platform, platform_user_id)`**.
- **`ci_identity_platform_account`** — links identity↔account over time: `identity_id`, `platform_account_id`, `relationship`, `is_primary`, `valid_from`, `valid_to`, `evidence`. One creator → **many** IG/future accounts.
- **`ci_identity_actor_access`** — who may operate an identity: `identity_id`, `member_id`, `access_role` (`self`|`agent`|`manager`|`authorised_operator`), `granted_by`, `granted_at`, `revoked_at`, `evidence`. **Many users can manage one celebrity; one agent can manage many creators.**
- **`ci_org_creator_relationship`** — org-scoped CRM: `org_id`, `identity_id`, `relationship_type` (`roster`|`represented`|`managed`|`campaign_only`|`discovered`), `assigned_manager_member_id`, `status`, `source`, `created_at`, `ended_at`.

**Rule:** org-specific notes, commercials, assignments and CRM attach to `ci_org_creator_relationship` (or another org-scoped entity), **never** to the global identity. **One org must never infer another org's private roster relationship, notes or commercials** (RLS on the org-scoped tables; the global identity exposes no org data).

### 19.2 Audited, reversible identity merges (correction B)

Replace bare `merged_into` with an **append-only `ci_identity_merge_event`**: `source_identity_id`, `target_identity_id`, `reason`, `evidence`, `performed_by`, `performed_at`, `reversed_at`, `reversed_by`. Requirements: **automatic merge only after stable platform-ID verification**; **handles/names never auto-prove ownership** (handles change and get recycled); fuzzy matches stay **review candidates**; **prevent merge cycles**; **retain alias history**; **support audited unmerge**; **preserve all original source records**. `ci_identity_link` may remain as a *migration/reconciliation ledger* only — its polymorphic `entity_table/entity_id` shape **must not** become the permanent runtime relationship model (use the typed relations in §19.1).

### 19.3 Tenant-scoped brand relationships (correction C)

`ci_brand` stays the canonical brand identity. Add **`ci_org_brand_relationship`** for org-specific CRM: account ownership, internal notes, commercial history, parent-corporate portfolio, agency/client relationship, visibility boundaries. A corporate account may contain **multiple brands** without exposing one agency's private brand records to another (RLS: `org_id = my_org()`; corporate portfolio via an explicit parent link, not cross-tenant reads).

### 19.4 Corrected audience-intelligence model (correction D)

Replace the generic `ci_audience_snapshots`. The canonical model distinguishes **three audience types** — `follower_demographics`, `reached_audience_demographics`, `engaged_audience_demographics`. Each row: `identity_id`, `platform_account_id`, `metric_name`, `audience_type` (`followers`|`reached`|`engaged`), `breakdown_type` (`age`|`gender`|`country`|`city`), `dimension_key`, `dimension_value`, `value_count` (where supplied), `calculated_percentage` (where calculated), `period`, `timeframe`, `observed_at`, `captured_at`, `source`, `api_version`, `run_id`, `status` (`available`|`suppressed`|`insufficient_audience`|`permission_missing`|`token_expired`|`api_error`), `suppression_reason`, `sample_size`/`audience_total` (where supplied), `raw_payload_reference`/`response_hash`.

**Marginal vs joint:** Meta may return age, gender and city as **separate marginal distributions**. Geek **must not** claim an exact joint intersection ("women 25–34 in Bangalore") **unless Meta explicitly returned that joint breakdown**. If Geek *estimates* a combined segment: **label it `estimated`, record the method, provide confidence, never present it as an observed Meta fact.** No generic `age_gender` field unless the active Meta API explicitly returns a combined dimension. Every metric/period/timeframe/breakdown is validated against the active Graph API version at implementation.

### 19.5 True append-only + idempotency, and media versioning (correction E)

Snapshots are **immutable**; historical rows are never updated. Required columns: `source_observed_at`, `captured_at`, `ingest_run_id`, `source_record_id` (where available), `payload_hash`/`idempotency_key`. Duplicate delivery ⇒ ignored by idempotency key; a differing same-day observation ⇒ **another immutable row**. Serve current values from **"latest" views/materialized views**. **Media** (mutable captions/metadata): stable **`ci_media`** identity + **`ci_media_version`** (or media snapshot) for editable caption/metadata, a **deletion/tombstone** state, and **edit history** where Meta reports changes.

### 19.6 Four separate control concepts + visibility tiers (correction F)

Split the conflated consent model into four independent systems:

1. **`ci_scope_grant`** — technical Meta permission state (§6.1).
2. **`ci_processing_consent`** — the Geek privacy-notice/purpose/**version** the creator accepted; records the stated processing purposes.
3. **`ci_capability_switch`** — the creator's internal Geek feature controls (§18.4).
4. **`ci_profile_visibility` / relationship-based authorisation** — what marketplace users, agencies, managers, brands and campaign participants may see.

**Removed contradictions:** `ci_consent.granted_to_org`, `grant_consent(scope, granted_to_org?)`, and any per-brand consent toggle. **There is no repeated per-brand permission UX.** Visibility is by **explicit tiers**: `creator/private` · `authorised representative` · `organisation roster` · `marketplace summary` · `campaign-specific shared intelligence` · `public media kit`. **Campaign participation may enable campaign-limited brand access; it must not auto-grant unrestricted historical intelligence.** **Existing users:** do **not** infer acceptance of expanded Creator-Intelligence purposes from an old Instagram token — record the **current notice version via a simple in-product acknowledgement** at reconnect/next relevant sign-in. **No extra Meta OAuth flow** for that acknowledgement.

### 19.7 Missing-data ranking policy (correction G)

Resolves the confidence/down-weight/renormalisation contradiction:

1. Missing data **never** becomes zero.
2. Missing data must **not** silently improve or reduce underlying performance.
3. A **mandatory hard-filter** signal that is unavailable returns **`insufficient_data`** or **`unknown` requiring explicit brand treatment** (never a pass/fail by default).
4. **Soft-signal missingness must not be silently renormalised** in a way that inflates a creator.
5. Ranking returns **separately**: `partial_fit_score`, `verified_coverage`, `ranking_confidence`, `missing_signal_list`.
6. **Do not compare partial scores as if coverage were identical.**
7. A brand may set a **minimum Verified Data Coverage** filter, but it must be a **visible brand-selected filter**, never secretly embedded in performance, and every exclusion is **explainable**.
8. Permission withdrawal may affect confidence, coverage and eligibility for an explicitly requested verification threshold — but must **not** rewrite historical performance or fraud signals.
   Persist: **ranking-formula version, normalization version, missingness-policy version, and all signal contributions.**

### 19.8 Security hardening (correction H)

- **OAuth:** cryptographically secure `state`; state stored **server-side** (or in a securely bound short-lived transaction), **one-time use**, strict expiry, **bound to the initiating user/session**; exact redirect validation; **PKCE if supported**; **never `Math.random()`** as the security boundary; **`localStorage` alone is not proof** of OAuth state. *(Note: today's `connectInstagram()` uses `Math.random()` state in `localStorage` — this correction supersedes that for the intelligence flow.)*
- **Tokens:** application-level/envelope **encryption at rest**; keys **outside ordinary application tables**; **key rotation**; **redaction in logs/errors**; least-privilege service access; **revocation & deletion verified**. RLS/no-policy isolation is necessary but **is not encryption**.
- **`SECURITY DEFINER`:** fixed safe `search_path`; schema-qualified references; explicit JWT/user/org validation; **derive org from the authenticated context, never trust caller-supplied `org_id`**; **`REVOKE EXECUTE FROM PUBLIC`**, grant only to intended roles; minimal return columns; audited sensitive reads; **negative cross-tenant tests**.
- **Webhooks:** signature verification; replay protection; event idempotency; timestamp tolerance; secret rotation; dead-letter handling; **no raw message content in logs**.
- **Super-admin "All"** in the §5 matrix means access **only through explicit, audited administrative functions** — **not** direct client-table policies. Message-content access stays break-glass and audited (§17.4).

### 19.9 Campaign-scoped messaging (correction I)

**Not a general private-inbox surveillance system.** A conversation may contribute to intelligence **only** when it is **initiated through a Geek campaign workflow** *or* **explicitly linked to a Geek campaign by an authorised user, with audit evidence**. **Unlinked conversations are never content-classified for intelligence.** Any temporary processing for the operational inbox stays **separate** from intelligence processing. Clarifications: invitation response rate covers **Geek-tracked** invitations; acceptance/decline comes from **explicit campaign state** or a **labelled, confidence-bearing classifier**; agency-member SLA attribution is possible **only** for messages sent **through Geek by an identified member** — natively-sent Instagram messages **cannot** be auto-attributed to an employee; **read/delivery states are nullable capabilities**, never assumed; **ambiguous conversations default to excluded**; **no raw content or participants enter the feature store**. **Sequencing:** campaign links, privacy gates and consent controls must exist **before** messaging-intelligence ingestion is activated (§19.12).

### 19.10 Data-class retention matrix (correction J)

Replaces vague "shortest viable TTL"/"within SLA"/"N cycles". For **each class** specify: default retention · deletion event · anonymisation option · legal/contractual retention · legal hold · backup-deletion window · derived-data invalidation · audit-evidence retained after deletion.

| Data class | Default retention (design intent — confirm with counsel) | Deletion / anonymisation |
|---|---|---|
| OAuth transaction records | minutes (one-time state) | expire on use/timeout |
| Access tokens | life of connection | delete on disconnect; verify revocation |
| Account snapshots | rolling history (e.g. 24m) then archive | anonymise on disconnect |
| Audience snapshots | rolling history then archive | anonymise on disconnect |
| Media insights | life of media + window | tombstone on media delete |
| Comment text | short (e.g. 30–90d) | delete; keep derived sentiment |
| Derived comment sentiment | rolling | invalidate on capability off |
| Message metadata | campaign life + audit window | delete on disconnect (keep audit) |
| Temporary message content | **shortest** (inbox session/short TTL) | delete on TTL; never to feature store |
| Campaign records | contractual/financial | **not** auto-deleted on disconnect |
| Commercials | contractual/financial | retained per contract |
| Conversion records | contractual/analytics | retained per policy |
| Ranking results | recompute-cheap; short | recompute, not repair |
| Audit logs | long (compliance) | retained after subject deletion |
| Consent evidence | long (compliance) | retained after deletion (proof) |
| Backups | defined backup-deletion window | purge propagates within window |

**Disconnect** must: stop new collection immediately; **invalidate current serving features immediately**; revoke/delete tokens; delete/anonymise eligible personal intelligence; **retain only necessary contractual/financial/security/audit records**; and **record exactly what was deleted, anonymised or retained, and why**. **Do not blindly cascade-delete** campaign contracts, invoices or legally required transaction records.

### 19.11 Million-creator ingestion (correction K)

A single daily cron loop is insufficient. Design: **durable ingestion queue**; **per-creator/per-token jobs**; **leasing + visibility timeout**; idempotent workers; retry policy; **exponential backoff with jitter**; **dead-letter queue**; **app-level and token-level API budgets**; priority for **active campaigns** and **newly connected creators**; **hot/warm/cold refresh tiers**; **backpressure**; **webhook-triggered work** where available; **job-lag & freshness monitoring**; **circuit breakers**; **partitioning** for snapshot/message-event/metric tables; **archival**; indexes for **latest-per-creator** and **time-window** queries; **cost budgets** for API/storage/NLP/vision. **Honest initial-sync limits:** Meta cannot supply unlimited historical private insights — record **what was requested, what was returned, and the earliest available observation** per creator.

### 19.12 Corrected implementation phases (correction L)

Phase 0 cannot be "no behaviour change" while changing OAuth. Split:

- **Phase 0A — dark foundations:** schemas; identity/account/actor/org relationships (§19.1); merge-event ledger; consent models (§19.6); scope registry; **security hardening** (§19.8); feature flags. **No user-visible change.**
- **Phase 0B — connection release:** all-five OAuth; disclosure copy; capability settings; **secure OAuth state**; existing-user reconciliation/reconnect + notice-version acknowledgement.

Move **canonical brand, campaign participation, and campaign-conversation links** **before** messaging intelligence. **Do not activate messaging ingestion until** all hold: identity resolved · valid messaging scope · processing consent recorded · capability enabled · campaign-linkage rules exist · privacy filter exists · deletion/retention controls operational.

### 19.13 Versioned Meta capability matrix (correction M)

- Add **follower / reached / engaged** audience demographics as **separate** metrics (§19.4).
- Treat **`public_profile` and `email` as account/login permissions**, **not** Instagram audience-intelligence permissions.
- Mark **every** API field as one of: **verified in current production response** · **documented, not yet production-verified** · **unavailable/deprecated** · **optional/nullable**.
- **Do not hardcode `debug_token`** as the only grant-verification mechanism — use the method supported by the **active Instagram Login flow + Graph API version**.
- All delivery/read/message and insight fields are **capability-tested** at runtime (Meta may omit fields by account, version, threshold or endpoint).

### 19.14 New & revised acceptance tests (correction M cont.)

- **Identity model:** one identity can hold ≥2 platform accounts; an identity with no `member_id` (agent-managed celebrity) works; ≥2 members can operate one identity; org A cannot read org B's `ci_org_creator_relationship`/notes/commercials.
- **Merges:** auto-merge only on verified stable platform ID; handle/name never auto-merges; unmerge restores originals; cycles rejected; alias history retained.
- **Brands:** corporate holds multiple brands; agency A cannot read agency B's `ci_org_brand_relationship`.
- **Audience:** marginal-only data never rendered as a joint segment; estimated joints labelled `estimated` with method+confidence; status/suppression captured.
- **Append-only:** re-delivered observation deduped by key; differing same-day observation creates a new immutable row; no historical row is ever updated; latest-view serves current value; media edit/delete produces version/tombstone.
- **Four controls:** scope grant, processing consent, capability switch and visibility are independently settable; no per-brand consent UX exists; campaign participation grants only campaign-scoped access.
- **Missing-data ranking:** unavailable mandatory signal ⇒ `insufficient_data`/`unknown` (not zero/pass); soft-missingness not renormalised to inflate; ranking returns partial_fit/coverage/confidence/missing-list; brand coverage-threshold is a visible filter with explainable exclusions; withdrawal never rewrites historical performance/fraud.
- **Security:** OAuth state is CSPRNG, server-bound, one-time, expiring; PKCE where supported; tokens encrypted at rest with external keys; `SECURITY DEFINER` derives org from auth context and `REVOKE`s PUBLIC; webhook signature/replay/idempotency enforced; no token/message content in logs; negative cross-tenant tests pass.
- **Messaging scope:** unlinked conversations never classified for intelligence; native IG messages not attributed to an employee; nullable read/delivery states handled; ambiguous ⇒ excluded; no content/participants in feature store; messaging ingestion blocked until all §19.12 gates pass.
- **Retention/disconnect:** each data class honours its matrix row; disconnect invalidates serving features immediately, verifies token revocation, and does **not** delete contracts/invoices; a deletion report records what was deleted/anonymised/retained and why.
- **Scale:** queue leasing prevents double-processing; DLQ captures poison jobs; budgets/circuit-breakers trip under load; latest-per-creator/time-window queries hit indexes; initial-sync limits recorded per creator.

### 19.15 Remaining unresolved decisions requiring human sign-off (return N)

1. **Concrete retention durations** per §19.10 (legal/DPO + India DPDP / GDPR / Meta Platform Terms).
2. **Encryption/KMS choice** and key-custody boundary (Supabase Vault vs external KMS) for tokens/message content.
3. **Queue/worker technology** (pg-based queue vs external broker) given Supabase-first stack and million-creator target.
4. **Merge policy thresholds** — what counts as "stable platform-ID verification"; manual-review SLA.
5. **Visibility-tier defaults** — exactly what a `marketplace summary` exposes vs `campaign-specific shared intelligence`.
6. **Brand coverage-threshold semantics** — default minimums, and how exclusions are surfaced.
7. **Estimated-joint-segment policy** — whether Geek estimates joint demographics at all, and the confidence floor to display them.
8. **Fraud-estimate governance** — model ownership, appeal SLA, human-in-the-loop.
9. **PKCE / OAuth specifics** — confirm what the current Instagram Login flow supports.
10. **Legal-hold & backup-deletion windows** — contractual retention that overrides subject deletion.

### 19.16 Architecture-gate checklist

- [ ] Identity, platform account, actor access, and org relationship are **separate** entities (§19.1).
- [ ] Merges are **append-only, evidence-based, cycle-safe, unmergeable** (§19.2).
- [ ] Brand CRM is **tenant-scoped**; no cross-agency leakage (§19.3).
- [ ] Audience model separates **follower/reached/engaged**; marginals never faked as joints (§19.4).
- [ ] Snapshots are **immutable**; idempotency keys + latest-views; media versioned (§19.5).
- [ ] **Four control systems** + **visibility tiers**; no per-brand consent UX (§19.6).
- [ ] Missing-data ranking: **unavailable ≠ zero**, separate coverage/confidence, explainable exclusions (§19.7).
- [ ] Security: secure OAuth state, token encryption, hardened `SECURITY DEFINER`, webhook verification (§19.8).
- [ ] Messaging strictly **campaign-scoped**, gated behind the §19.12 preconditions (§19.9).
- [ ] **Retention matrix** defined; disconnect preserves legal/financial records (§19.10).
- [ ] **Queue-based** million-creator ingestion; honest initial-sync limits (§19.11).
- [ ] Phases split into **0A (dark) / 0B (connection)**; messaging last (§19.12).
- [ ] Capability matrix **versioned & field-status-tagged**; `public_profile`/`email` not audience perms (§19.13).
- [ ] Acceptance tests updated (§19.14); unresolved decisions logged for sign-off (§19.15).

---

*End of architecture. Implementation is intentionally deferred (constraint #10, Amendments A, B & C). Amendment A added messaging + `ci_scope_grant` (§17). Amendment B (1C) locked the one-time all-five consent model + six-measure scoring (§18). Amendment C (1D) corrected the identity/account/actor/org model, made merges audited/reversible, tenant-scoped brands, split the audience model (follower/reached/engaged) and the four control systems, fixed true append-only + idempotency, defined the missing-data ranking policy, hardened security, campaign-scoped messaging, added the retention matrix and million-creator ingestion, split Phase 0 into 0A/0B, and versioned the capability matrix (§19). The next step remains human sign-off on §19.15, then Phase 0A dark foundations — nothing is implemented.*
