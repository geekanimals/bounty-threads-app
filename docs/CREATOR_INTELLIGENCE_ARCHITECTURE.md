# Creator Intelligence Architecture — v1.1

**Product:** "Bloomberg for Creators" — an additive Creator Intelligence Engine **and Creator Profile system** for Geek Influencer OS (Bounty & Threads).

**Status:** Architecture & product specification only. Canonical, internally consistent, readable front-to-back by a new team without any prior amendment. **No migrations, no implementation SQL, no code/Edge-Function/DB/deploy changes. Phase 0A not started.**

**Prime directive:** *Additive and reversible.* Preserve all existing production behaviour; introduce the identity model, private/professional profile, immutable time-series and a provenance-carrying feature store **alongside** today's model; backfill; verify; then cut over.

**Changelog (history only; the v1.1 body is authoritative):** v0.1 initial audit → messaging + per-scope permissions → one-time all-five connection + capability switches + six-measure scoring → identity/account/actor/org split, audited merges, tenant brands, corrected audience, true append-only, four control systems, retention matrix, queue ingestion → **v1.0 consolidation** → **v1.1: adds the Creator Profile system (private vs professional data), Meta-prefill source-of-truth rules, `api`/`intel`/`private` schema boundary, app-level vs connection-level scope model, reconnection/active-connection model, and the profile-aware phase sequence.**

---

## 1. Product objective & non-negotiables

**Objective.** Turn consented Instagram data + Geek campaign history + creator-supplied profile information into a **verified Creator Intelligence profile** — separating what a creator *tells us*, what platforms *verify*, and what Geek *derives or estimates* — so brands evaluate creators on explainable, provenance-tagged signals, and creators keep control of their private data.

**Non-negotiables.**
1. No scraping — official Meta APIs only.
2. Consented professional-account data only.
3. Tokens & private message content are server-side only, encrypted at rest; never in browser tables/code.
4. Fraud is a labelled **estimate**, never a fact.
5. No inference of sensitive personal characteristics.
6. **No single universal opaque score** — six separate explainable measures (§19); ranking is brief-specific and decomposable.
7. Every derived/predicted value carries a provenance envelope (source, method/model version, calc date, window, sample size, confidence, status). **Missing data is `unavailable`, never `0`.**
8. Preserve production tables until additive migrations + backfills are verified.
9. Authorisation is DB-enforced (RLS + hardened `SECURITY DEFINER` functions in unexposed schemas + the `api` boundary), never UI role visibility.
10. Design phase performs no implementation.

**Settled Instagram experience (preserved exactly).** One **Connect Instagram** CTA → immediately opens Meta authorization → requests **all five** approved permissions together → **no** Geek permission-selection page before OAuth → granted capabilities **default enabled** → creators may disable individual capabilities later (with the agreed warning) → disabling affects **Verified Data Coverage & Creator Intelligence Confidence only** (never auto-reduces Performance, raises Fraud Probability, or labels a creator untrustworthy) → **no progressive consent**, **no repeated per-brand Meta OAuth** → messaging intelligence is **campaign-scoped and implemented last** → raw Instagram/personal data, messages and tokens are **never** exposed to brands or browser tables.

---

## 2. Existing-state audit

**Frontend:** static vanilla-JS app (`app.js`, `data.js`, `auth.js`, `login.js`, `consent.js`) + public `p.html` (media kit), `o.html` (org page). **Backend:** Supabase (Postgres + RLS, Auth, 6 Edge Functions, Storage `ig-media`).

**Tables (16):** members, invites, leads, creators, campaigns, barter_items, applications, dream_plans, story_deals, irm_contacts, social_accounts, org_profiles, social_tokens, platform_admins, ai_usage, audit_log. **Edge Functions:** instagram-login, instagram-auth, instagram-refresh, instagram-publish, ai-chat, whatsapp-send.

**Strengths to keep:** per-org RLS (`org_id = my_org()`); trigger-provisioned members; immutable role/org from client; cross-org access only via `SECURITY DEFINER`; tokens isolated in `social_tokens` (service-role only).

**Gaps the engine fixes:** no stable creator identity (`creators` free-text roster vs `social_accounts` Meta data are unlinked); snapshots overwritten each sync (no history); no provenance/feature store; no brand entity, campaign↔creator membership, commercials, conversions, or profile system.

**Name/free-text relationships to migrate to IDs (targets):** `creators↔social_accounts` (name/handle), `barter_items.creator/campaign`, `applications.creator_name`, `campaigns.brand`, `campaigns.creators` (int count), `story_deals.celebrity/brand/manager`, `irm_contacts.name/handle`, `dream_plans.creator_email`, `campaigns.platforms/hashtags`, `creators.followers/eng/tier/cat`, `social_accounts.mentions[].username`.

---

## 3. User-role model

Same login, different faces. Roles: **Creator**, **Brand**, **Agency (owner)**, **Corporate (multi-brand)**, **Talent Manager**, **Super Admin** (platform-level, `platform_admins`). Creators onboard instantly; agency-side roles require platform approval (existing behaviour). **Operators** of a creator identity are modelled separately (§6 `ci_identity_actor_access`) so a manager/agent can operate an identity — including an **agent-managed celebrity with no creator login**. Organisation access is **relationship-scoped**, not blanket "Org" (§14.F, §10).

---

## 4. End-to-end connection & profile-completion flow

**One click, all five, then a guided profile.**

1. Creator taps **"Connect Instagram & Build My Profile."** Disclosure copy sits beside it (what Geek analyses, Privacy Policy, Data Use Policy, Disconnect Instagram).
2. Meta authorization opens **immediately**, requesting the five scopes together: `instagram_business_basic, instagram_business_manage_insights, instagram_business_manage_comments, instagram_business_manage_messages, instagram_business_content_publish`. (No pre-OAuth Geek selection page.)
3. Callback → **server** exchanges the code (Edge Function), stores the token in **Vault**, writes `ci_platform_connection` + `ci_scope_grant` (per-scope, per-connection), verifies which scopes Meta actually granted, and defaults granted capabilities to **enabled**.
4. **Initial ingestion starts automatically** (queue jobs), independent of profile completion.
5. Geek **creates/opens the creator's profile draft** and routes to **"Complete Your Creator Profile."**
6. Fields **legitimately returned by Meta are prefilled**, each showing its **source badge** (§5). Creator **reviews, corrects, confirms**; optional fields may be **skipped** and completed later. Profile completion **never stops ingestion**.
7. A permanent **"My Creator Profile"** section stays available for edits, export, and deletion of optional data.

**Profile cards (mobile-first, Save & Continue):** A Identity · B Contact · C Delivery Address · D Skills & Resources · E Brand Experience · F Collaboration Preferences (barter) · G Paid Rate Card · H Dream Brands · I Instagram Intelligence & Data Access.

**Two separate indicators, never merged:**
- **Profile Completion %** — how much information the creator supplied (transparent field weights).
- **Verified Data Coverage %** — what Geek can verify via connected platforms + internal campaign history.

An incomplete profile **must never** reduce Performance, raise Fraud Probability, or label the creator unreliable.

---

## 5. Source-of-truth & field-provenance model

Every profile field carries provenance: `source_type`, `source_reference`, `first_observed_at`, `last_updated_at`, `creator_confirmed_at`, `verification_status`, `verified_by`, `confidence` (where applicable). Provenance is **split by sensitivity**: personal identity/contact/address fields → **`private.creator_profile_field_provenance`** (in the unexposed `private` schema); professional/commercial fields → **`intel.ci_profile_field_provenance`**. **Private field values (DOB, phone, email, address) are never stored in `intel`.** Sensitive private fields keep an append-only **edit history** in **`private.creator_profile_edit_event`**; values never silently overwrite each other across sources.

**`source_type`:** From Instagram · From Geek account · Creator entered · Detected from content · Verified campaign history · Agency verified.
**`verification_status`:** API observed · creator confirmed · campaign verified · agency verified · detected/unconfirmed · disputed · unavailable.

**Prefill matrix — prefill *only* where the active production API actually returns the value.**

| Field group | Prefillable from Instagram (if API returns) | Never auto-prefilled as Instagram fact |
|---|---|---|
| Platform identity | platform_user_id, username, profile link (derived), display name, profile picture, biography, website, account type | — |
| Counts / media | followers, follows, media counts; public media + timestamps; supported account/media insights; supported audience aggregates | — |
| Personal identity | — | gender, age, DOB, marital status, anniversary, residential city/state |
| Contact | (an auth email may be *suggested* from Geek's auth system, clearly labelled "From Geek account") | WhatsApp number, private email, phone |
| Professional | — | skills, resources, rates, barter willingness, brands worked with, dream brands, residential address |

**Critical rule — audience ≠ creator.** Follower/reached/engaged demographics describe the **audience**: follower gender ≠ creator gender; follower age ≠ creator age; audience city ≠ creator residence; audience country ≠ creator nationality; content language ≠ confirmed creator language; a brand mention ≠ proof of paid collaboration. Meta `name` may be shown as a **suggested** full name but is **not** silently split into verified first/last names — the creator confirms.

---

## 6. Canonical ER model

New objects live in **unexposed** schemas — `intel` (professional intelligence) and `private` (PII) — reachable by the browser **only** through the `api` schema (§15). Existing `public` tables gain only **nullable** FK columns (§24).

### 6.1 Identity, account, connection, operator, org
- **`ci_creator_identity`** — the human/talent entity. **No platform ID, no `member_id`.** Exists without a Geek login. `identity_id`, `display_name`, `kind`(creator|celebrity|talent), `is_claimed`, `created_at`.
- **`ci_platform_account`** — a real platform account. `platform_account_id`, `platform`, `platform_user_id`, `username`, `account_type`, `status`, `first_seen_at`, `last_verified_at`; **`unique(platform, platform_user_id)`**.
- **`ci_identity_platform_account`** — identity↔account over time (`is_primary`, `valid_from/to`, `evidence`). One identity → many accounts.
- **`ci_platform_connection`** — a specific OAuth/token connection. `connection_id`, `platform_account_id`, `authorised_by_member_id`, `token_reference`→Vault, `connected_at`, `expires_at`, `revoked_at`, `status`, **`supersedes_connection_id`**, `activated_at`, `last_validated_at`. **Only one *active* connection per `platform_account_id + provider_app/environment`** (§14.D).
- **`ci_identity_actor_access`** — operators of an identity. `identity_id`, `member_id`, `access_role`(self|agent|manager|authorised_operator), `granted_by`, `granted_at`, `revoked_at`, `evidence`.
- **`ci_org_creator_relationship`** — **all** org CRM. `org_id`, `identity_id`, `relationship_type`(roster|represented|managed|campaign_only|discovered), `access_scope`, `assigned_manager_member_id`, `status`, `source`, `created_at`, `ended_at`. Org notes/commercials/assignments attach **here**, never to the global identity.
- **`ci_identity_merge_event`** — append-only merge/unmerge ledger (§14.B).
- **`ci_identity_link`** — migration/reconciliation ledger **only** (never runtime).

### 6.2 Brands & campaigns
- **`ci_brand`** — canonical brand (`brand_id`, `name`, `aliases[]`, `domain`, `parent_brand_id`).
- **`ci_org_brand_relationship`** — org-scoped brand CRM (ownership, notes, commercial history, portfolio, visibility). No cross-agency leakage.
- **`ci_campaign_participation`** — campaign↔identity membership (`status`, `agreed_deliverables`).
- **`ci_commercials`** — **org-private** negotiated terms (references `ci_org_creator_relationship`). Distinct from the creator's rate card (§11).
- **`ci_conversions`** — external outcomes (UTM/promo/pixel) for CPA/ROAS.

### 6.3 Profile entities (private + professional) — §7–§12
Private (`private` schema): `private.creator_personal_profile`, `private.creator_contact`, `private.creator_address`, `private.creator_profile_field_provenance`, `private.creator_profile_edit_event`.
Professional (`intel` schema): `ci_creator_professional_profile`, `ci_creator_skill`, `ci_creator_resource`, `ci_creator_brand_experience`, `ci_creator_commercial_preference`, `ci_creator_rate_card`, **`ci_creator_rate_card_item`** (deliverable lines — normalized), `ci_creator_brand_aspiration`, `ci_profile_field_provenance`, `ci_profile_completion`.

### 6.4 Observed, control, messaging, feature store
Raw: `ci_ingest_run`, `ci_account_snapshots`, `ci_media`(+`ci_media_version`, tombstone), `ci_media_insights`, `ci_audience_observations`, `ci_mentions`, `ci_comments`(+`ci_comment_sentiment`). Control: `ci_app_scope_capability`, `ci_scope_grant`, `ci_capability_switch`, `ci_processing_consent`, `ci_profile_visibility`, `ci_messaging_consent_events`(audit projection only). Messaging: `ci_ig_conversations`, `ci_ig_messages`, `ci_ig_message_events`, `conversation_assignments`, `ci_conversation_campaign_links`, `ci_response_metric_snapshots`, `ci_messaging_sync_jobs`. Feature store: `ci_metric`, `ci_ranking_run`, `ci_ranking_result`, `ci_data_request`.

**The creator profile attaches to `ci_creator_identity`, never to an Instagram handle.** Instagram data attaches via `ci_creator_identity → ci_identity_platform_account → ci_platform_account`, supporting multiple accounts, future YouTube/TikTok, agent-managed celebrities, username changes, and reconnection without losing profile data.

---

## 7. Private creator profile model (`private` schema)

**`private.creator_personal_profile`** — `identity_id`, `first_name`, `last_name`, `gender`, `date_of_birth`, `age_band` (nullable, used only if DOB incomplete), `marital_status`, `marriage_anniversary`, private provenance/timestamps.
- **Age is calculated from DOB**, not independently stored. Gender/DOB/marital status/anniversary are **optional** and **private by default**.
- These fields are **never inferred** from content, appearance, name, follower demographics or audience insights. Marital status/anniversary **never** affect ranking, fraud, brand-safety, performance or reliability. Instagram `name` may seed a suggested full name; the creator confirms/edits.

**`private.creator_contact`** — `identity_id`, `whatsapp_e164`, `whatsapp_verified_at`, `email`, `email_verified_at`, `preferred_contact_method`, `whatsapp_optin`, `email_optin`, communication consent evidence.
- Store WhatsApp in **E.164**; verify number via **OTP** and email via verification before marking verified. An auth email may be *suggested* from Geek's auth system. **Do not assume Instagram provides private email/phone.** Record communication-consent version/purpose/timestamp/withdrawal. **Contact is never marketplace-public.**

**`private.creator_address`** — `address_id`, `identity_id`, line1, line2, landmark, city, state, postal_code, country, delivery_instructions, `label`(Home|Office|Manager|Other), `is_default`, verified/confirmed timestamps.
- Full address is **private and protected/encrypted**; brands never receive it. Only authorised Geek/agency **logistics** functions may access it, **audited**. Multiple addresses allowed. A confirmed address is required **only before accepting a physical-product/hamper campaign** — never to create a profile. **Audience geography must never prefill residential address.**

---

## 8. Professional creator profile model (`intel` schema)

**`ci_creator_professional_profile`** — `identity_id`, `display_name`, coarse `city`/`state`, `categories`, `languages`, `bio`, visibility defaults, provenance. Marketplace-facing; **no** contact/address/personal PII here. Includes a **profile-image reference** (not treated as permanent): `profile_image_source_platform`, `profile_image_source_account_id`, `profile_image_url`, `profile_image_asset_ref`, `profile_image_observed_at`, `profile_image_status` (`fresh`|`stale`|`unavailable`) — the Instagram image can go stale/unavailable and is refreshed, never assumed permanent.

**`ci_creator_skill`** — `identity_id`, `skill_key` (controlled searchable taxonomy + optional custom), `skill_level`, `years_experience`, `portfolio_link`, `creator_confirmed_at`. Taxonomy seed: Acting, Dancing, Singing, Makeup, Styling, Photography, Videography, Editing, Scriptwriting, Comedy, Fitness, Yoga, Cooking, Gaming, Technology, Finance, Parenting, Travel, Public speaking, Regional-language content, Live hosting.

**`ci_creator_resource`** — `identity_id`, `resource_key` (structured + custom), `evidence` (optional), `creator_confirmed_at`. Seed: Smartphone, Professional camera, Microphone, Lighting, Home studio, Editing setup, Drone, Car/two-wheeler, Kitchen, Fitness space, Travel availability, Makeup/styling support, Content team, Photographer, Videographer, Manager/agent, Unique-location access. **Resources are creator-declared** and not represented as API-verified unless evidence exists.

---

## 9. Brand experience model

**`ci_creator_brand_experience`** — `experience_id`, `identity_id`, `brand_id` (nullable), `submitted_brand_name` (nullable), `relationship_type`, `compensation_type`, `campaign_id` (nullable), `start_date`, `end_date`, `deliverables`, `evidence`, `source_type`, `verification_status`, `verified_by`, `creator_confirmed_at`, `created_at`, `updated_at`.

**`source_type`:** Geek campaign verified · agency verified · creator declared · content-detected suggestion · organic brand mention · imported historical data.

**Critical distinction.** A brand detected via caption/hashtag/tag/mention is **not** automatically a "brand worked with." Detected mentions land in a **review area** — *"We found content mentioning these brands. Confirm which ones you have actually collaborated with."* — where the creator classifies each: Paid · Barter · Hybrid · Ambassador · Affiliate · UGC only · Organic mention only · Never worked with · Not sure/review later. **Only confirmed or campaign-verified relationships** enter "Brands Worked With"; organic mentions remain **separate** intelligence signals. Brands/agencies always see the label (**Geek verified / Agency verified / Creator declared / Detected organic mention**); creator-declared experience is **never** shown as independently verified.

---

## 10. Barter & commercial-preference model

**`ci_creator_commercial_preference`** — the prominent checkbox **"I'm open to barter collaborations with established/top brands"** plus optional structured preferences: `accepts_barter`(y/n), `barter_preference`(top/established only | selected brands only | any relevant), `preferred_categories`, `excluded_categories`, `min_product_value`, `product_only`, `product_plus_travel`, `product_plus_production_reimbursement`, `city_only`, `travel_ready`, `notes`, `last_confirmed_at`.

Stored as a **creator-declared preference — not an authenticity or performance signal.** "Top brand" is subjective; **no opaque Geek 'top brand' score in Phase 0A** — displayed exactly as selected; editable anytime.

---

## 11. Rate-card model

**Normalized into two tables** (card-level vs deliverable-level):
- **`ci_creator_rate_card`** (card) — `rate_card_id`, `identity_id`, `platform_account_id` (nullable), `status`(active|archived), `currency` (ISO-4217, default INR), `negotiable`, `accepts_paid`, `visibility`, `commercial_contact_type`(self|agent|manager), `valid_from`, `valid_until`, `confirmed_at`, `updated_at`.
- **`ci_creator_rate_card_item`** (deliverable line) — `rate_card_item_id`, `rate_card_id`, `deliverable_type`, `amount` (**≥ 0**), `unit_quantity` (**> 0**), `duration_minutes` (nullable), `includes_production`, `includes_editing`, `usage_rights_included`, `usage_rights_days` (nullable), `exclusivity_included`, `travel_included`, `taxes_extra`, `notes`. **`unique(rate_card_id, deliverable_type)`** prevents duplicate deliverables within a card.

**Deliverable types:** IG Reel, IG Collab Reel, IG Static Post, IG Carousel, IG Story (single), IG Story (set), IG Live, Brand/store/restaurant visit, Event appearance, Event hosting, UGC video (no posting), UGC photo set, Usage-rights add-on, Exclusivity add-on, Travel/outstation add-on, Custom.

Rates are **creator-declared commercial expectations** — not Meta facts, not performance scores, not public by default (visible only per creator settings + authorised marketplace/campaign rules). **Rate-card amount ≠ negotiated campaign amount:** historical negotiated commercials (`ci_commercials`) are stored **separately** and neither overwrites the other.

---

## 12. Dream-brand model

**`ci_creator_brand_aspiration`** — `aspiration_id`, `identity_id`, `brand_id` (nullable), `submitted_brand_name` (nullable), `priority_rank`, `preferred_collaboration_type`, `reason/notes` (nullable), `created_at`, `updated_at`, `active`. UX: searchable canonical selector, suggest-missing-brand, optional top-10 drag-to-rank, editable anytime.

Dream brands are **creator preferences** — not campaign history, not inferred from mentions, **not** used as proof of brand affinity — useful for opportunity matching and outreach. Brands may later discover creators who explicitly expressed interest, **subject to the creator's visibility preferences**.

---

## 13. Observed Creator Intelligence model (raw, immutable)

Raw observations are **immutable append-only**, written only by service-role workers, each carrying the **standard raw-observation fields** (§14.G): `source_observed_at`, `captured_at`, `ingest_run_id`, `source_record_id`, `payload_hash`, `idempotency_key`, `source`, `api_version`, `status`.

- **`ci_account_snapshots`** — followers/follows/media counts, reach, impressions, profile_views, accounts_engaged. **No `unique(identity_id, as_of)`** (multiple observations/day are legitimate).
- **`ci_media`** (stable) + **`ci_media_version`** (immutable caption/metadata versions) + `deleted_at` tombstone.
- **`ci_media_insights`** — reach, impressions, saved, likes, comments, shares, plays, total_interactions.
- **`ci_audience_observations`** — the audience model (§17).
- **`ci_mentions`** — organic mentions (feed the brand-experience review area, §9).
- **`ci_comments`** + **`ci_comment_sentiment`** (derived).

Dedupe by idempotency key; a differing same-day observation creates **another immutable row**. Current values served via **"latest" views/materialized views** (never overwriting history).

---

## 14. Consent, capability & visibility model + Phase-0A hardening

### 14.1 Four separate control systems (no `ci_consent`, no `granted_to_org`, no per-brand consent UX)
1. **`ci_app_scope_capability`** — **app-level** Meta approval: `provider`, `app/environment`, `scope`, `app_review_status`, `approved_at`, `last_verified_at`, `api_version`, `evidence`. (Meta approving the app ≠ a creator granting the scope.)
2. **`ci_scope_grant`** — **connection-level** grant: `connection_id`, `scope`, `requested_at`, `granted_at`, `last_checked_at`, `valid`, `revoked_at`, `status_reason`, `verification_method`. Owned by `ci_platform_connection`.
3. **`ci_capability_switch`** — internal Geek feature controls, owned by the **identity–platform-account relationship** (survive reconnection): Performance Insights, Comment Intelligence, Campaign Messaging Intelligence, Publishing & Scheduling. `instagram_business_basic` cannot be disabled independently (removal = Disconnect).
4. **`ci_processing_consent`** — `identity_id`, `accepting_actor_member_id`, `authority/evidence`, `notice_version`, `purposes`, `accepted_at`.

**A feature is enabled only when all hold:** valid **app-level** capability **and** valid **active-connection** grant **and** enabled **internal** capability **and** appropriate **processing consent**.

**Capability disable** stops new API calls/ingestion for that permission, excludes its data from **future** intelligence, records `{date, user, notice/consent version}`, applies the retention treatment (§22), never silently re-enables, and never claims Meta revocation unless actually performed. **Re-enable** resumes if the grant is still valid; requires one reauthorization (with explanation) only if missing/expired/revoked. **Existing users:** never infer expanded-purpose acceptance from an old token — record the current notice version via an **in-product acknowledgement** at reconnect/next sign-in (no extra Meta OAuth).

### 14.2 Visibility model (`ci_profile_visibility`) — field-level tiers
- **Private only:** WhatsApp number, private email, full DOB, marital status, anniversary, full delivery address, verification documents, OTP state.
- **Creator-controlled professional:** display name, coarse city/state, skills, resources, categories, languages, barter openness, paid-collaboration openness, rate-card visibility, brands worked with, dream-brand interest.
- **Marketplace summary:** display name, profile photo, IG handle/link, broad city/state, categories, skills, selected resources, **verified** brand-experience labels, collaboration openness, selected rate range (only if creator allows), marketplace-appropriate intelligence measures, Verified Data Coverage.
- **Campaign-specific:** only fields necessary for evaluation, commercials, logistics, deliverables, communication, conflict/exclusivity. **A brand never receives the full residential address merely by the creator joining its campaign** — logistics coordinate delivery without exposing unnecessary private details.
- **Public media kit:** never exposes contact/address/rates unless explicitly permitted.

### 14.3 Phase-0A hardening (decided)
- **A. Supabase API boundary (§15).** Three schemas: `intel` (private, unexposed), `private` (PII, unexposed), **`api`** (the only exposed surface — approved RPCs + minimal safe presentation views, **no raw tables**). Every browser-facing contract states whether it is an **`api` RPC** or an **Edge Function calling an internal routine**; a browser RPC is **never** described as directly calling an unexposed schema.
- **B. True append-only merge/unmerge.** `ci_identity_merge_event`: `event_id`, `event_type`(merge|unmerge), `source_identity_id`, `target_identity_id`, `reverses_event_id` (nullable), `reason`, `evidence`, `performed_by`, `performed_at`. An unmerge is a **new event**; the original is never updated.
- **C. App vs connection scope** — §14.1 items 1–2.
- **D. Active connection & reconnection.** One active connection per `platform_account_id + provider_app/environment`; on reconnect: create new connection → verify token+scopes → **atomically activate + supersede old** → stop old ingestion → revoke/delete old token → retain non-secret audit history → prevent duplicate ingestion. Capability switches stay on the identity–account relationship.
- **E. Safe identity backfill.** Stable verified platform ID may auto-link an account; unverified roster rows → **shadow identities**; handle/name/email/fuzzy matches create **review candidates only** (never auto-merge / never establish verified ownership); manual review records reviewer/evidence/timestamp/outcome.
- **F. Relationship-scoped org access.** "Org" is **not** blanket access: `represented`/`managed` → authorised operational + intelligence surfaces; `roster` → agreement/visibility-based; `campaign_only` → campaign-limited; `discovered` → marketplace summary only. `access_scope` stored explicitly.
- **G. Standard raw-observation fields** — §13.
- **H. Consent-terminology.** Use **"marketplace-visible eligible pool"**, not "consented+coverage pool"; no repeated per-brand consent.
- **I. Phase-0A decisions (recorded as decided):** Supabase **Vault** for Phase-0A token secrets; Supabase-managed project **root-key custody** for Phase 0A (external KMS is a later enterprise/compliance review); `intel` & `private` unexposed; `api` the minimal exposed RPC schema; automatic identity merge **only on exact verified platform ID**; **pgmq** initially, subject to load testing.

---

## 15. Supabase schema / API / RLS security model

- **Schemas:** `intel` (professional intelligence, unexposed), `private` (PII/addresses, unexposed), **`api`** (only exposed schema — approved RPCs + strictly necessary safe views, **no raw tables**). The exposed-schemas config lists **only** `api` (and existing `public`), never `intel`/`private`.
- **Grants:** explicit table/function grants; **revoke default privileges**; **`REVOKE EXECUTE FROM PUBLIC`** then grant to intended roles only.
- **RLS** enabled everywhere as defence in depth.
- **"latest" views** are `security_invoker` or reachable only through hardened functions.
- **Hardened `SECURITY DEFINER` functions** live in an unexposed schema: fixed safe `search_path`, schema-qualified references, explicit authenticated identity/org validation, **org derived from auth context (never caller-supplied `org_id`)**, minimal return fields, audit logging on sensitive reads.
- **Super-admin access** is via **audited administrative functions**, not broad client policies; raw `intel`/`private` tables are inaccessible to `anon` and ordinary `authenticated`.
- **Tests:** **pgTAP positive and negative** for every role and tenant boundary.

---

## 16. Meta capability matrix (versioned)

`public_profile` and `email` are **account/login** permissions — **excluded** from the audience-intelligence matrix. **Field status:** `verified-in-prod` · `documented-not-verified` · `unavailable/deprecated` · `optional/nullable`. Grant verification uses the method supported by the **active Instagram Login flow + Graph API version** (not hardcoded `debug_token`). All delivery/read/message and insight fields are **capability-tested at runtime**.

| Permission | Endpoint / field | API ver | Prod status | Optional/nullable | Restrictions | Last verified | Intelligence use |
|---|---|---|---|---|---|---|---|
| basic | profile (username, account_type, counts, bio, website); public media | *(confirm)* | documented-not-verified | some nullable | — | *(TBD)* | identity, cadence, engagement |
| manage_insights | account insights (reach, impressions, profile_views, accounts_engaged) | *(confirm)* | documented-not-verified | optional | account/version | *(TBD)* | performance |
| manage_insights | media insights (reach, impressions, saved, likes, comments, shares, plays, total_interactions) | *(confirm)* | documented-not-verified | optional | media-type | *(TBD)* | content quality, CPM base |
| manage_insights | **follower / reached / engaged** demographics (age/gender/country/city, **marginal**) | *(confirm)* | documented-not-verified | optional | **≥100 followers**, aggregate | *(TBD)* | audience (three types) |
| manage_comments | comments; mentions/tags | *(confirm)* | documented-not-verified | optional | — | *(TBD)* | sentiment, organic mentions |
| content_publish | media containers → publish | *(confirm)* | documented-not-verified | — | publish limits | *(TBD)* | operational only (no score) |
| manage_messages | conversations; messages (id, direction, timestamp); delivery/read | *(confirm)* | documented-not-verified | **nullable** delivery/read | messaging window/opt-in | *(TBD)* | campaign responsiveness (timing) |

*Every "documented-not-verified" row must become `verified-in-prod` with a real Last-verified date before the dependent feature ships.*

---

## 17. Audience-intelligence model

**`ci_audience_observations`** distinguishes **follower / reached / engaged** audiences and stores **separate marginal breakdown rows** (age, gender, country, city). Columns use the **canonical raw-observation names** (§13/§14.G — no parallel `observed_at`/`run_id`): `identity_id`, `platform_account_id`, `metric_name`, `audience_type`, `breakdown_type`, `dimension_key`, `dimension_value`, `value_count`, `calculated_percentage`, `period`, `timeframe`, `source_observed_at`, `captured_at`, `source`, `api_version`, `ingest_run_id`, `source_record_id`, `payload_hash`, `idempotency_key`, `status`(available|suppressed|insufficient_audience|permission_missing|token_expired|api_error), `suppression_reason`, `sample_size`/`audience_total`, `raw_payload_reference`/`response_hash`.

**Marginal vs joint:** Meta may return marginals only. Geek **must not** claim a joint intersection ("women 25–34 in Bangalore") unless Meta explicitly returns it. **No estimated joint segments at launch;** if ever estimated later, label **`predicted`** with method + confidence, never an observed fact. Audience data is **never** written into creator personal demographics (§5).

---

## 18. Ingestion & queue architecture (millions of creators)

- **Queue:** Supabase **Queues/pgmq** first, subject to load-test gates.
- **Jobs:** durable, per-creator/per-connection; **leasing + visibility timeout**; **idempotent** workers; retries with **exponential backoff + jitter**; **dead-letter queue**.
- **Budgets/priority:** app- and token-level API budgets; priority for **active campaigns** and **newly connected creators**; **hot/warm/cold** tiers; backpressure; webhook-triggered work; **circuit breakers**.
- **Data:** partitioning for snapshot/message-event/metric tables; archival; indexes for **latest-per-creator** and **time-window** queries; cost budgets (API/storage/NLP/vision).
- **Monitoring:** job-lag & freshness.
- **Honest initial sync:** record what was requested, returned, and the earliest available observation per connection (Meta cannot supply unlimited history).

---

## 19. Feature store & scoring

Provenance envelope on every non-observed value: `method`/`model_version`, `computed_at`, `window`, `sample_size`, `confidence`, `is_estimate`, `inputs`, `compute_run_id` (distinct from the raw `ingest_run_id`), `status`(ok|insufficient_data|unavailable|missing_permission|token_expired|api_error). Tiers: **observed / derived / predicted**. `ci_metric` compute writes **new** rows; unavailable is `unavailable`, never `0`.

**Six separate, explainable measures (never one blend):** Creator Performance · Reliability · Brand-Safety · **Fraud Probability** (labelled estimate) · **Creator Intelligence Confidence** · **Verified Data Coverage**. Disabling a capability / withdrawing a permission lowers **only Confidence and Coverage** — never auto-reduces Performance, raises Fraud, labels untrustworthy, or fabricates a zero. **Profile Completion is separate and never influences** Performance/Fraud/Brand-Safety/ROI/authenticity/reliability/Intelligence Confidence. Publishing & Scheduling is operational (no score effect). Response speed alone is never quality.

**Never silently transform:** brand mention → worked-with brand · rate-card rate → historical negotiated rate · address city → audience geographic strength · creator gender → audience gender · audience demographics → creator personal demographics · dream brand → brand affinity · profile completion → intelligence confidence.

---

## 20. Ranking & natural-language search

Brief-specific, decomposable. Candidate pool = **marketplace-visible eligible pool** (§14.H). Scoring = weighted, named sub-signals each pulled from `ci_metric` with its own confidence. **Ranking returns separately:** `partial_fit_score`, `verified_coverage`, `ranking_confidence`, `missing_signal_list`, `signal_contributions` (Σ = partial_fit_score). Persist `ranking_formula_version`, `normalization_version`, `missingness_policy_version`. **Missing-data policy:** unavailable ≠ zero; a missing **mandatory hard-filter** signal returns `insufficient_data`/`unknown` (never a default pass/fail); soft-signal missingness is never renormalised to inflate; partial scores are not compared as if coverage were identical. A brand may set a **visible** Verified-Data-Coverage minimum filter with **explainable** exclusions (**no default exclusion** at launch). Fraud is a **separate advisory gate**, never a hidden term. **NL search:** an LLM parses the query into the structured brief (filters + weights) and calls the same pipeline — it translates intent only, never invents metrics.

---

## 21. Campaign-scoped messaging intelligence (implemented last)

**Not a private-inbox surveillance system.** A conversation contributes to intelligence **only** when **initiated through a Geek campaign workflow** or **explicitly linked to a Geek campaign by an authorised user, with audit evidence**. Unlinked conversations are **never** content-classified for intelligence; operational-inbox processing stays separate. **Gate:** currently-valid `manage_messages` grant, else `missing_permission` (never `no_response`). **Storage (minimisation):** message id, direction, timestamp, category, campaign link, response timing, delivery/read state where available; **limited encrypted content only if the inbox needs it**, shortest TTL, audited — **no content/participants enter the feature store**. The response ledger (`ci_ig_message_events`) is **text-free**. **Attribution honesty:** invitation response rate covers Geek-tracked invitations; acceptance/decline from explicit campaign state or a labelled, confidence-bearing classifier; agency-member SLA only for messages sent **through Geek by an identified member** (native IG messages are not auto-attributed); nullable read/delivery states never assumed; ambiguous → excluded. Responsiveness metrics carry the distinct statuses `no_response`/`missing_permission`/`token_expired`/`sync_error`/`insufficient_data` and enter ranking as **one capped sub-signal**, never quality by itself. Brands receive **aggregated indicators only** — never raw DMs.

---

## 22. Retention & deletion

Per-class matrix (design intent; **final durations are a legal/DPO launch gate**). Classes now include profile data: personal fields, WhatsApp number, email, addresses, communication opt-ins, skills/resources, brand experience, rate cards, brand aspirations, profile field provenance, OTP verification records, profile edit history — plus tokens, account/audience/media observations, comment text/sentiment, message metadata/temp content, campaign records, commercials, conversions, ranking results, audit logs, consent evidence, backups.

**Rules:** personal data is correctable; optional data deletable; withdrawal stops **future** optional processing; addresses deleted/anonymised when no longer necessary (subject to campaign/legal obligations); expired rate cards may be archived but **not shown as current**; historical campaign commercials retained separately where contractually required; **deletion reports** explain what was deleted/anonymised/legally retained; export is human- and machine-readable. **Disconnect** stops new collection, **invalidates serving features immediately**, revokes/deletes tokens (verified), deletes/anonymises eligible personal intelligence, retains only necessary contractual/financial/security/audit records, and records exactly what/why — **without** blindly cascade-deleting contracts/invoices/legally required records.

---

## 23. API contracts (design-level)

All browser-facing contracts are **`api`-schema RPCs** or **Edge Functions calling internal routines** — explicitly labelled; none is a browser RPC into an unexposed schema. Each re-checks auth/org/visibility/capability and returns provenance + `status` on non-observed values.

| Contract | Kind | Purpose |
|---|---|---|
| `ig_oauth_start` / `ig_oauth_callback` | Edge → internal | one-CTA all-five connect; code exchange; token→Vault; connection + scope grants; start ingestion; create profile draft |
| `api.get_profile_draft()` / `api.save_profile_section(section, payload)` | api RPC | profile completion (per card), provenance-stamped |
| `api.verify_contact_otp(...)` / `api.verify_email(...)` | Edge/api | OTP + email verification (independent states) |
| `api.set_capability(capability, enabled)` / `api.record_processing_consent(notice_version, purposes)` | api RPC | four-control model (warning gate client-side) |
| `api.get_creator_intelligence(identity_id)` | api RPC | metrics + provenance, visibility-gated |
| `api.rank_creators(brief)` / `api.nl_search(query)` | api RPC / Edge | partial_fit/coverage/confidence/missing_list/contributions + versions |
| `api.get_marketplace_profile(identity_id)` | api RPC | marketplace summary tier only |
| `api.get_campaign_inbox(campaign_id)` / `api.get_creator_responsiveness(identity_id)` | api RPC | audited inbox; brands get aggregates only |
| `api.request_data(kind)` / `api.disconnect_platform(connection_id)` / `api.dispute_field(ref)` | api RPC | export/delete; disconnect (§22); dispute inferred/agency data |

---

## 24. Migration / backfill

Additive: nullable FK columns on `public` tables; dual-write; backfill; verify; flag-gated read cut-over; no destructive change to legacy columns until ≥ N verified cycles. **Identity seeding:** upsert `ci_platform_account` from the verified stable `ig_user_id`; connect to `ci_creator_identity` via `ci_identity_platform_account`; shadow identities for unverified roster rows; handle/name never auto-merge; merges via `ci_identity_merge_event`; `ci_identity_link` reconciliation-only. Targets: `social_accounts.identity_id/platform_account_id`, `creators.identity_id`, `campaigns.brand_id`, `barter_items.creator_id/campaign_id`, `applications.applicant_identity_id`, `story_deals.*_id`, `irm_contacts.identity_id`, `dream_plans.member_id`.

---

## 25. Implementation phases (single canonical sequence)

> **Release-packaging rule (authoritative).** The creator-profile **backend and UI are built dark, behind feature flags, in Phase 0A/0B and ship as part of the Phase-0B release package** — the profile must exist *before* the new Instagram connection journey is publicly enabled, never built after users are routed into it. The "Phase 1" grouping below is a work breakdown, **not** a release that follows a live connection journey.

- **Phase 0A — Dark foundations *(APPROVED — in progress; migrations added in `supabase/migrations/`, not applied remotely)*:** `intel`/`private`/`api` schemas; identity/account/connection/operator/org model; **private profile model**; **professional profile model** (incl. normalized rate card + profile-image reference); merge/unmerge ledger (append-only); permission/control model (`ci_app_scope_capability` + `ci_scope_grant` + `ci_capability_switch` + `ci_processing_consent` + `ci_profile_visibility`); **separated private/professional provenance**; RLS + least-privilege grants; pgTAP; feature flags. Vault wiring and the exposed `api` surface land in 0B. *No user-visible change.*
- **Phase 0B — Instagram connection release (ships the profile backend + UI, flag-gated):** one-click all-five OAuth; secure state; connection creation; permission verification; **initial ingestion**; **profile-draft creation**; **Meta prefill**; **profile-completion experience**; Data Access settings; existing-user reconnect/acknowledgement; the `api` RPC surface + Vault.
- **Phase 1 — Creator Profile (work breakdown, released with 0B):** personal/contact profile; OTP/email verification; address book; skills/resources; brand history (+ mention review); barter preferences; paid rate card; dream brands; provenance badges; profile completion.
- **Phase 2 — Observed intelligence ingestion:** immutable account/media/audience observations; queue; latest views; capability verification.
- **Phase 3 — Brand & campaign relationships:** canonical brands; org-brand relationships; campaign participation; campaign-verified brand experience; commercials.
- **Phase 4 — Derived feature store:** performance, audience, content, sentiment, reliability, confidence, coverage.
- **Phase 5 — Ranking & NL search.**
- **Phase 6 — External outcomes & predictions** (conversions/CPA/ROAS, fraud estimate).
- **Phase 7 — Campaign-scoped messaging intelligence — last**, only after identity/consent/campaign-linking/privacy/deletion/retention gates are operational.

---

## 26. Acceptance tests (design-level)

1. Successful IG connection creates a profile draft. 2. Only actual API-returned fields are prefilled. 3. Creator must confirm suggested personal identity fields. 4. Audience demographics never populate creator demographics. 5. Brand mention never auto-becomes brand experience. 6. Verified campaign history is distinguished from creator-declared. 7. WhatsApp/email verification states work independently. 8. Full address inaccessible to brands. 9. Logistics access narrow and audited. 10. Barter preference has no scoring effect. 11. Rate card has no performance/fraud effect. 12. Dream brands don't become brand affinity. 13. Profile Completion and Verified Data Coverage stay separate. 14. DOB and anniversary remain private. 15. Rate cards respect visibility. 16. Creator can edit/export/delete optional profile data. 17. Agent-managed celebrity profiles work without creator login. 18. Authorised agent completes a profile only with documented authority. 19. Multiple IG accounts attach to one creator profile. 20. Reconnection doesn't duplicate/erase profile information. 21. Cross-tenant access to private profile info fails. 22. `anon`/ordinary `authenticated` access to `private`/`intel` fails. 23. Public/media-kit output never exposes contact/address/rates unless explicitly permitted. 24. Handle/name matches create review candidates only. 25. Merge/unmerge fully append-only. 26. Only one active connection per account/app-environment.

*Plus carried-forward suites:* connection-level scope grants; immutable same-day observations (no `unique(identity_id, as_of)`); four-control independence & no per-brand consent; visibility-tier payloads; missing-data ranking; security (OAuth state/Vault/`SECURITY DEFINER`/webhooks/pgTAP); campaign-scoped messaging; retention/disconnect preserving legal records; scale (queue leasing/DLQ/budgets/indexes).

---

## 27. Rollback plan

Additive-by-construction: `intel`/`private`/`api` objects can be disabled/dropped without touching `public`; no legacy column altered/dropped early. Feature flags gate every read cut-over (default off). Queue/workers have a kill switch; raw tables are append-only. Backfill links live in `ci_identity_link`. Column retirement is a later, separately-approved migration. Bad metric versions roll back by **recompute from immutable raw**, not data surgery. Profile is additive — disabling the profile flag reverts to today's media-kit behaviour.

---

## 28. Remaining legal / runtime gates

- **Legal/DPO:** final retention durations (incl. profile PII, addresses, OTP records, edit history), legal-hold & backup-deletion windows; final privacy/data-use **notice version + copy**; export format sign-off.
- **Runtime/Meta:** confirm PKCE/OAuth-state specifics of the active Instagram Login flow; move capability-matrix fields from `documented-not-verified` to `verified-in-prod` (runtime capability tests); messaging window/opt-in constraints.
- **Infra:** external-KMS custody decision (post-Phase-0A); pgmq load-test gate result (fallback broker decision).
- **Product/policy:** marketplace-summary vs campaign-shared exact payloads; brand coverage-threshold defaults & exclusion presentation; fraud-estimate governance (ownership, appeal SLA, human-in-the-loop); "top brand" definition beyond self-declaration.

---

## 29. PASS / HOLD checklist

| # | Gate | State |
|---|---|---|
| 1 | Identity/account/connection/operator/org separate; identity carries no platform ID / `member_id` | **PASS** (design) |
| 2 | Private vs professional profile schemas separated; PII in `private`, marketplace data in `intel` | **PASS** |
| 3 | Profile attaches to identity, not handle; multiple accounts / agent-managed / reconnect supported | **PASS** |
| 4 | Meta prefill only where API returns; audience ≠ creator; provenance on every field | **PASS** |
| 5 | Brand mention ≠ brand experience; verified vs declared labelled | **PASS** |
| 6 | Barter/rate-card/dream-brands are declared preferences, no scoring effect | **PASS** |
| 7 | Profile Completion ≠ Verified Data Coverage ≠ Confidence; no cross-contamination | **PASS** |
| 8 | Four control systems (app/connection/capability/consent) + visibility tiers; no per-brand consent | **PASS** |
| 9 | `api`/`intel`/`private` boundary; RLS + pgTAP + hardened defs; `anon`/`authenticated` blocked from private/intel | **PASS** (design) |
| 10 | Immutable ingestion; no `unique(identity_id, as_of)`; latest-views; media versioned/tombstoned | **PASS** |
| 11 | Append-only merge/unmerge; exact-verified-ID auto-merge only; review candidates otherwise | **PASS** |
| 12 | Audience split follower/reached/engaged; marginals never faked as joints; no estimated joins at launch | **PASS** |
| 13 | Six-measure scoring; missing-data ranking (unavailable≠zero, separate coverage/confidence) | **PASS** |
| 14 | Messaging strictly campaign-scoped; Phase-7 last | **PASS** |
| 15 | Retention matrix incl. profile PII; disconnect preserves legal/financial records | **PASS** (durations: **HOLD** — legal/DPO) |
| 16 | Queue (pgmq) ingestion; honest initial-sync limits | **PASS** (load-test: **HOLD**) |
| 17 | Capability matrix versioned; `public_profile`/`email` excluded from audience | **PASS** (field verification: **HOLD** — runtime) |
| 18 | KMS custody / notice copy / PKCE specifics / product-policy defaults | **HOLD** — §28 |

**Overall: Phase 0A is APPROVED and under way.** The dark database foundation (schemas, identity/profile/control tables, RLS, least-privilege grants, pgTAP) exists as additive Supabase migrations in `supabase/migrations/` (created locally, **not applied to any remote project**). Phase-0A infra decisions are recorded as decided (Vault for token secrets, Supabase-managed root-key custody for now, exact-verified-ID auto-merge, pgmq subject to load test). The remaining **HOLD** items (external-KMS review, final legal retention durations, Meta runtime capability verification, pgmq scale test) are later-phase gates and **do not block** the dark foundation.

*End of specification. This is the single canonical v1.1 design; there is no competing model elsewhere in this document. Implementation is intentionally deferred.*
