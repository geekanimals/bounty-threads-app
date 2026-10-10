# Barter Campaign Pipeline — Automation Plan

**Goal:** run the barter campaign process as a fully automated **1:1 case-communication system** across **app + WhatsApp + email**, pushing and reminding the influencer back to the app whenever an action is pending for them, and reporting every case live on the brand–campaign dashboard.

All work is **dark / additive**, gated by the existing `operational_pilot` feature flag (+ pilot cohort), verified on the disposable PG17 harness, and never activated in production without explicit approval.

---

## The process (as specified)

Get brief from brand/agency → make WhatsApp msg → reach out to the filtered DB (email / WhatsApp / profile notification) → influencer **applies on app** → geek/agency confirms brand eligibility criteria on app → geek/agency sends collated list to brand on app → brand confirms/declines (with reason) each influencer on app → if confirmed, re-confirm with influencer (WhatsApp + email) and get them on the app to **sign a contract** (ASCI guidelines, ad rights (1 month), collab rights, product, deliverables; if no deliverables → blacklist; if an issue → send product to the next influencer at their cost) → influencer **confirms address on app** → courier sent → video brief sent → courier tracked (DTDC / Amazon API) → parcel-received confirmation (WhatsApp / email) → influencer submits video within **3 days** (reminders on WhatsApp / email) → check video vs brief, suggest changes (ML) → send video to client → client approves (if required) → influencer **posts reel + story from our app** → check caption + tags vs brief → track reel analytics for **15 days** → all reported live on the brand–campaign dashboard.

---

## What already exists (dark Phase 1E ops layer)

- `intel.ci_campaign`, `ci_campaign_brief`, `ci_brand_org_profile`
- `intel.ci_campaign_participation` — a validated **state machine** (`shortlisted → invited → accepted → product_sent → content_created → content_submitted → content_approved → changes_requested → published → completed`, plus `rejected`/`dropped`) with the only legal mutation path through `intel.ci_participation_advance`
- Append-only `intel.ci_campaign_event` status ledger (owner · timestamp · from→to · reason)
- `intel.ci_campaign_deliverable` / `ci_campaign_shipment` (has `courier`, `tracking_ref`) / `ci_campaign_submission` / `ci_campaign_approval`
- api RPCs: `create_campaign`, `add_campaign_participant`, `advance_participation`, `record_shipment`, `respond_to_campaign`, `submit_content`, `approve_content`, `get_campaign_detail`, `get_campaign_pipeline`, `get_my_campaigns`, `get_pilot_metrics`, `ops_vocab`, `get_my_onboarding_status`
- WhatsApp send + inbound (`wa_*`, snapto provider); `instagram-publish`

## The biggest gaps

- **No notification layer at all** — no notifications/outbox table, **no email provider**, nothing fires app + WhatsApp + email on a transition, no reminder/SLA scheduler.
- State machine is **agency-push** (starts at `shortlisted`) — no application-first funnel, no brand-in-the-loop approval, **no contract entity**.

---

## Step → code status

| # | Step | Status |
|---|---|---|
| 1 | Brief from brand/agency | ✅ `ci_campaign` + `ci_campaign_brief` |
| 2 | WhatsApp msg → reach filtered DB (email/WA/notification) | ⚠️ matching exists; 3-channel push missing |
| 3 | Influencer applies on app | ⚠️ no `applied` entry stage |
| 4 | Geek confirms eligibility | ❌ no eligibility stage |
| 5 | Geek sends collated list to brand | ❌ no `sent_to_brand` stage / brand surface |
| 6 | Brand confirms/declines each (reason) | ❌ approval is content-only |
| 7 | Re-confirm + sign contract (ASCI, ad/collab rights, deliverables, blacklist) | ❌ no contract entity |
| 8 | Address confirm on app | ⚠️ address exists; no per-campaign gate |
| 9 | Courier sent | ✅ `ci_campaign_shipment` |
| 10 | Video brief sent | ⚠️ brief exists; per-influencer delivery = notification |
| 11 | Courier tracked (DTDC/Amazon) | ⚠️ columns exist; no carrier API |
| 12 | Parcel-received confirmation | ⚠️ `delivered` exists; no notification |
| 13 | Video ≤ 3 days + reminders | ⚠️ submit exists; no SLA/reminder scheduler |
| 14 | Check video vs brief (ML) | ❌ `changes_requested` exists; no ML |
| 15 | Send video to client | ⚠️ approval exists; no brand routing |
| 16 | Client approves | ⚠️ `approve_content` exists; not brand-facing |
| 17 | Post reel + story from app | ✅ `instagram-publish` |
| 18 | Check caption + tags vs brief | ❌ no validation |
| 19 | Track analytics 15 days | ⚠️ profile ingestion exists; no per-post tracking |
| 20 | Live brand-campaign dashboard | ⚠️ detail/pipeline exist; dashboard partial |

---

## Build phases

**Phase 1 — Notification spine + funnel backbone** *(additive; no external keys)* — **in progress**
- `ci_notification` (per-recipient in-app inbox, each with a deep link to the pending action + read/acted state)
- `ci_outbox` (dispatch queue: in-app / WhatsApp / email, with dedupe + status)
- `ci_reminder` (SLA rows that auto-cancel when the expected event arrives, e.g. 3-day video)
- `ci_notification_template` (copy per transition, editable, out of code)
- Extend the state machine with `applied → eligibility_review → eligible/ineligible → sent_to_brand → brand_confirmed/brand_declined → contract_sent → contract_signed → address_confirmed` before `product_sent`
- `ci_campaign_contract` (ASCI ack, ad-rights-until, collab rights, product, deliverables; blacklist-on-no-deliverable)
- A dispatcher that enqueues in-app + WhatsApp + email (deep link back to the app) on every transition, and `email_provider.ts` (Resend adapter, provider-agnostic — mirrors the WhatsApp adapter)
- A cron-invoked reminder worker

**Phase 2** — Application-first funnel UI + brand review (apply / eligibility screen / collated list / brand confirm-decline with reason).

**Phase 3** — Contract signing UI + per-campaign address-confirm gate.

**Phase 4** — Shipment tracking via DTDC / Amazon API + parcel-received push. *(needs carrier API keys)*

**Phase 5** — Video SLA + reminders + ML video-vs-brief check + caption/tag check. *(needs a model decision)*

**Phase 6** — Post reel + story from the app → caption/tag validation → 15-day per-post analytics → live brand-campaign dashboard.

---

## External decisions / keys needed (later phases)

- **Email:** Resend verified sending domain + `RESEND_API_KEY` (and `EMAIL_FROM`).
- **WhatsApp:** an approved template per notification type (to message outside Meta's 24-hour window).
- **Carrier tracking:** DTDC and/or Amazon API credentials — and which carriers are actually used.
- **ML checks:** how to judge "video matches brief" and "caption/tags correct" (Claude vision vs a heuristic).
- **Contract:** in-app typed signature + ASCI acknowledgment, or a real e-sign vendor.
