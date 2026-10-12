# Barter Pipeline — Go-Live Runbook

Turns on the WhatsApp login + barter campaign pipeline (Phases 1–6) that currently live **dark** on branch `creator-intelligence/flow-integration`. Everything stays additive and reversible; the whole surface is gated by the `operational_pilot` feature flag + the pilot cohort, so until the final activation step the production app is unchanged.

> **Conventions.** `$REF` = Supabase project ref (`edibibytqfrrxfztukpm` — confirm in the dashboard). All secret values below are **placeholders** — never commit real values to this file. Supabase CLI flags vary by version: verify with `supabase <cmd> --help` if a flag is rejected. This runbook assumes the Supabase CLI is installed and you are logged in (`supabase login`).
>
> **This runbook covers the WhatsApp + barter additions.** The base Creator Intelligence stack (phases 0A–1E migrations) ships in the same `db push`; review it against [`docs/PILOT_RELEASE_RUNBOOK.md`](PILOT_RELEASE_RUNBOOK.md) before pushing. Pipeline design: [`docs/BARTER_PIPELINE_PLAN.md`](BARTER_PIPELINE_PLAN.md).

---

## 0. Safety preconditions (read first)

- **Do not bypass the PR #1 review.** Deploy only from the commit that results after the branch is merged through GitHub review. If piloting from the branch before merge, use the exact reviewed commit SHA — do not force-merge.
- Deploy **dark**: migrations + functions + secrets + cron first, `operational_pilot` **stays OFF** until Step 9 verification passes.
- Never expose the `intel` or `private` schemas. Only `api` is exposed (Step 7).
- Keep a DB backup/point-in-time-restore window open before `db push` (Supabase dashboard → Database → Backups).
- No destructive migrations are involved; everything is `create … if not exists` / additive.

Pick the deploy commit:

```bash
# from the merged main (preferred), or the reviewed branch commit
git fetch origin
git checkout main && git pull            # after PR #1 is merged
git rev-parse --short HEAD               # record this SHA in the release log
```

Link the CLI to the project:

```bash
supabase link --project-ref edibibytqfrrxfztukpm
```

---

## 1. Apply migrations (dark)

`db push` applies every pending migration, including the 8 barter-pipeline ones
(`20261009100000` … `20261009170000`) and the WhatsApp flow-completion migration `20261012090000`
(worker RPCs `api.ops_outbox_claim` / `api.ops_outbox_complete` / `api.ops_run_due_reminders`, operator read
access to the WhatsApp inbox, per-notification outbox dedupe, client-read-only `wa_contacts` + `wa_set_opt_out`). The RPCs are created but unreachable until `api` is exposed (Step 7) and the flag is on (Step 10).

```bash
# review what will run, then push
supabase migration list --project-ref edibibytqfrrxfztukpm
supabase db push --project-ref edibibytqfrrxfztukpm
```

Sanity-check the new objects exist (Supabase SQL editor, service role):

```sql
select to_regclass('intel.ci_notification')              as notification,
       to_regclass('intel.ci_outbox')                    as outbox,
       to_regclass('intel.ci_reminder')                  as reminder,
       to_regclass('intel.ci_campaign_contract')         as contract,
       to_regclass('intel.ci_content_check')             as content_check,
       to_regclass('intel.ci_campaign_post')             as post,
       to_regclass('intel.ci_campaign_post_metric')      as post_metric;
-- the flag must still be OFF at this point
select flag, enabled from intel.ci_feature_flag where flag='operational_pilot';   -- expect false
```

---

## 2. Deploy the edge functions (dark)

Five pipeline workers + the WhatsApp functions. All are `verify_jwt = false` (set in `supabase/config.toml`); the workers additionally require the `x-worker-secret` header (Step 3).

```bash
REF=edibibytqfrrxfztukpm
# WhatsApp (login + 1:1 messaging + inbound)
supabase functions deploy wa-otp-start      --project-ref $REF
supabase functions deploy wa-otp-verify     --project-ref $REF
supabase functions deploy wa-send           --project-ref $REF
supabase functions deploy wa-webhook        --project-ref $REF
# Barter pipeline workers
supabase functions deploy ops-notify-dispatch    --project-ref $REF
supabase functions deploy ops-reminder-worker    --project-ref $REF
supabase functions deploy ops-tracking-worker    --project-ref $REF
supabase functions deploy ops-content-review     --project-ref $REF
supabase functions deploy ops-post-metrics-worker --project-ref $REF
```

Function URLs follow `https://$REF.supabase.co/functions/v1/<name>`.

---

## 3. Set secrets

Generate strong shared secrets first:

```bash
openssl rand -hex 32   # → CI_WORKER_SECRET
openssl rand -hex 32   # → OTP_PEPPER
openssl rand -hex 32   # → WA_WEBHOOK_SECRET
```

Put everything in an **uncommitted** env file and set it in one call (keeps secrets out of shell history):

```bash
# supabase/.env.production   (gitignored — DO NOT COMMIT)
# ---- workers ----
CI_WORKER_SECRET=<hex32>
APP_URL=<public app origin, e.g. https://bountythreads.app — WhatsApp/email CTAs link to $APP_URL/app.html?go=<page>>
# ---- WhatsApp via snapto (lead provider) ----
WA_PROVIDER=snapto
SNAPTO_API_KEY=<from snapto → Developer → API Keys>
SNAPTO_PHONE_ID=881923021676427
WA_OTP_TEMPLATE=<approved snapto AUTHENTICATION template name>
WA_OTP_LANG=en
OTP_PEPPER=<hex32>
WA_WEBHOOK_SECRET=<hex32>
WA_WEBHOOK_SECRET_HEADER=x-webhook-secret
# ---- email via Resend ----
EMAIL_PROVIDER=resend
RESEND_API_KEY=<resend key>
EMAIL_FROM="Bounty & Threads <campaigns@your-verified-domain.com>"
# ---- courier tracking (fill the carriers you use) ----
DTDC_TRACK_URL=https://<dtdc-tracking-endpoint>?trkRef={ref}
DTDC_API_KEY=<dtdc key>
DTDC_KEY_HEADER=X-Access-Token
DTDC_STATUS_PATH=status
AMAZON_TRACK_URL=
AMAZON_API_KEY=
# ---- AI brief-adherence review (Claude) ----
ANTHROPIC_API_KEY=<anthropic key>
ANTHROPIC_MODEL=claude-sonnet-5-5
# ---- Instagram post insights (15-day metrics) ----
IG_GRAPH_TOKEN=<long-lived IG graph token>
WHATSAPP_API_VER=v21.0
```

```bash
supabase secrets set --env-file ./supabase/.env.production --project-ref edibibytqfrrxfztukpm
supabase secrets list --project-ref edibibytqfrrxfztukpm   # confirm names (values are masked)
```

Notes:
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` are injected automatically — do **not** set them.
- The `{ref}` token in `DTDC_TRACK_URL` is substituted with the shipment's tracking number. Adjust `*_STATUS_PATH` (dot-notation) to the field in the carrier's JSON that holds the status string; the adapter classifies it (delivered / failed / in-transit) by keyword.
- `ANTHROPIC_MODEL` can be any current Claude id (e.g. `claude-opus-5-5` for stronger review, `claude-haiku-5-5` for cheapest). Each review is one small Messages API call.

---

## 4. WhatsApp: webhook + templates (snapto)

In the snapto dashboard (account `geekanimals`, number +916398566704):

1. **Developer → Webhooks → Create Webhook**
   - Type: **Meta Webhooks** (forwards the native Meta payload)
   - Webhook URL: `https://edibibytqfrrxfztukpm.supabase.co/functions/v1/wa-webhook`
   - Custom Header: name `x-webhook-secret`, value = the `WA_WEBHOOK_SECRET` from Step 3
   - Active: on
2. **Templates** — create + get Meta approval for:
   - an **AUTHENTICATION** template for login OTP → its name goes in `WA_OTP_TEMPLATE`
   - (recommended) one **UTILITY** template per outbound notification type you'll send outside the 24-hour window. Inside the 24-hour service window the dispatcher sends free-form text, so templates are only required to *re-open* a conversation. Set the template name on the matching row in `intel.ci_notification_template.wa_template_name` when approved.

Quick send test (after templates approved) — replace the number with a consented test phone:

```bash
curl -s -X POST "https://edibibytqfrrxfztukpm.supabase.co/functions/v1/wa-otp-start" \
  -H "Content-Type: application/json" -d '{"phone":"+9198XXXXXXXX"}'
```

---

## 5. (covered above)

---

## 6. (covered above)

---

## 7. Expose the `api` schema (keep intel/private hidden)

Dashboard → **Project Settings → API → Exposed schemas**: add `api`. Keep the list to `public, api` (and `graphql_public` if present). **Never** add `intel` or `private`.

SQL alternative (service role), then reload PostgREST:

```sql
alter role authenticator set pgrst.db_schemas = 'public, api';
notify pgrst, 'reload config';
```

Verify intel/private are NOT reachable via the Data API (should 404):

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  "https://edibibytqfrrxfztukpm.supabase.co/rest/v1/ci_campaign?select=campaign_id" \
  -H "apikey: <ANON_KEY>"   # expect 404 (intel not exposed)
```

---

## 8. Schedule the workers (pg_cron + pg_net + Vault)

Enable the extensions once (Dashboard → Database → Extensions, or SQL):

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault;
```

Store the base URL + worker secret in Vault so the cron bodies never contain the secret:

```sql
select vault.create_secret('https://edibibytqfrrxfztukpm.supabase.co/functions/v1', 'ops_functions_url');
select vault.create_secret('<CI_WORKER_SECRET from Step 3>', 'ci_worker_secret');
```

Schedule each worker. `net.http_post` reads the URL + secret from Vault at run time:

```sql
-- notifications: drain the outbox fast (WhatsApp + email) → responsive 1:1 pushes
select cron.schedule('ops-notify-dispatch', '* * * * *', $cron$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name='ops_functions_url') || '/ops-notify-dispatch',
    headers := jsonb_build_object('Content-Type','application/json',
                 'x-worker-secret',(select decrypted_secret from vault.decrypted_secrets where name='ci_worker_secret')),
    body    := '{}'::jsonb);
$cron$);

-- SLA reminders (3-day video, etc.) — every 5 minutes is plenty
select cron.schedule('ops-reminder-worker', '*/5 * * * *', $cron$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name='ops_functions_url') || '/ops-reminder-worker',
    headers := jsonb_build_object('Content-Type','application/json',
                 'x-worker-secret',(select decrypted_secret from vault.decrypted_secrets where name='ci_worker_secret')),
    body    := '{}'::jsonb);
$cron$);

-- courier tracking (DTDC/Amazon) — every 30 minutes
select cron.schedule('ops-tracking-worker', '*/30 * * * *', $cron$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name='ops_functions_url') || '/ops-tracking-worker',
    headers := jsonb_build_object('Content-Type','application/json',
                 'x-worker-secret',(select decrypted_secret from vault.decrypted_secrets where name='ci_worker_secret')),
    body    := '{}'::jsonb);
$cron$);

-- post insights snapshots (15-day window) — every 3 hours
select cron.schedule('ops-post-metrics-worker', '0 */3 * * *', $cron$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name='ops_functions_url') || '/ops-post-metrics-worker',
    headers := jsonb_build_object('Content-Type','application/json',
                 'x-worker-secret',(select decrypted_secret from vault.decrypted_secrets where name='ci_worker_secret')),
    body    := '{}'::jsonb);
$cron$);
```

`ops-content-review` is **on-demand** (not cron): call it when a submitted video needs the AI brief check.

```bash
curl -s -X POST "https://edibibytqfrrxfztukpm.supabase.co/functions/v1/ops-content-review" \
  -H "x-worker-secret: <CI_WORKER_SECRET>" -H "Content-Type: application/json" \
  -d '{"participation_id":"<uuid>","submission_id":"<uuid>","caption":"...","content_url":"https://..."}'
```

Inspect / remove schedules:

```sql
select jobid, jobname, schedule, active from cron.job order by jobname;
-- select cron.unschedule('ops-notify-dispatch');   -- to stop one (see Rollback)
```

---

## 9. Dark verification (flag still OFF)

While `operational_pilot` is OFF the triggers no-op and the RPCs fail closed. Confirm the plumbing without sending anything to real people:

```bash
REF=edibibytqfrrxfztukpm; SEC=<CI_WORKER_SECRET>
for fn in ops-notify-dispatch ops-reminder-worker ops-tracking-worker ops-post-metrics-worker; do
  echo -n "$fn → "; curl -s -X POST "https://$REF.supabase.co/functions/v1/$fn" -H "x-worker-secret: $SEC" -d '{}'; echo
done
# expect 200 JSON with zero processed/fired/checked (no data yet), and no sends
# wrong/missing secret must be rejected:
curl -s -o /dev/null -w "%{http_code}\n" -X POST "https://$REF.supabase.co/functions/v1/ops-notify-dispatch" -H "x-worker-secret: wrong" -d '{}'  # expect 401
```

```sql
-- outbox/notifications must be empty, flag still false
select (select count(*) from intel.ci_outbox) as outbox,
       (select count(*) from intel.ci_notification) as notes,
       (select enabled from intel.ci_feature_flag where flag='operational_pilot') as flag_on;
```

---

## 10. Activate (gated) — the only step that changes production

Follow this order; stop and roll back (Step 11) if the E2E fails.

**10a. Enable the creator-facing prerequisites + the ops flag.** (service role, SQL editor)

```sql
update intel.ci_feature_flag set enabled=true where flag in ('creator_profile_api','creator_ig_connect','operational_pilot');
```

**10b. Admit exactly ONE internal creator to the pilot cohort** before any real creator. The ops RPCs require cohort membership in addition to the flag — see [`docs/PILOT_RELEASE_RUNBOOK.md`](PILOT_RELEASE_RUNBOOK.md) for the `intel.ci_pilot_cohort` admit procedure and identifiers. Verify membership resolves against the real FK before proceeding.

**10c. Full live E2E with that one creator + one internal brand/operator:**
1. Creator logs in via WhatsApp OTP (confirms `WA_OTP_TEMPLATE` + snapto send works).
2. Operator creates a campaign; creator **applies**; operator **screens eligible** → **sends shortlist to brand**; brand **confirms**.
3. Operator **issues contract**; creator **signs** (ASCI ack) → **confirms address**.
4. Operator **records shipment**; `ops-tracking-worker` (or manual "mark delivered") flips to delivered → creator gets the **parcel-received push** on WhatsApp + email + in-app, and the 3-day SLA arms.
5. Creator **posts** from the app → caption/tag check runs; operator sees it live in the **brand report**; `ops-post-metrics-worker` records insights.
6. Confirm each transition produced an Alert (in-app) and a WhatsApp + email message with a working deep link.

If any step fails: **disable** the flag (Step 11), capture the failing function logs, fix, redeploy, retry. Do not admit more creators on a failed E2E.

**10d. Admit the rest of the cohort** once the E2E passes clean.

---

## 11. Rollback (reversible, non-destructive)

Flipping the flag off hides the entire surface immediately (RPCs fail closed, triggers no-op); data is retained.

```sql
-- turn the pipeline off (keep data)
update intel.ci_feature_flag set enabled=false where flag='operational_pilot';
-- optional: also hide the creator profile/connect surfaces
-- update intel.ci_feature_flag set enabled=false where flag in ('creator_profile_api','creator_ig_connect');
```

```sql
-- stop the schedulers
select cron.unschedule('ops-notify-dispatch');
select cron.unschedule('ops-reminder-worker');
select cron.unschedule('ops-tracking-worker');
select cron.unschedule('ops-post-metrics-worker');
```

Optionally deactivate the snapto webhook in its dashboard. No migration rollback is needed (objects are inert while the flag is off); if you must, the tables are additive and can be dropped in a dedicated down-migration — not required for a pause.

---

## 12. Monitoring / health queries

```sql
-- outbox health (stuck or failing sends)
select channel, status, count(*) from intel.ci_outbox group by 1,2 order by 1,2;
select outbox_id, channel, last_error, attempts, created_at
  from intel.ci_outbox where status='failed' order by created_at desc limit 50;

-- reminders due vs fired
select count(*) filter (where fired_at is null and cancelled_at is null and due_at<=now()) as due_now,
       count(*) filter (where fired_at is not null) as fired,
       count(*) filter (where cancelled_at is not null) as cancelled
  from intel.ci_reminder;

-- pipeline funnel across all live campaigns
select stage, count(*) from intel.ci_campaign_participation group by 1 order by 2 desc;

-- cron run history
select jobname, status, return_message, start_time
  from cron.job_run_details order by start_time desc limit 30;
```

---

## 13. Secret / env reference

| Secret | Used by | Notes |
|---|---|---|
| `CI_WORKER_SECRET` | all `ops-*` workers | `x-worker-secret` header; also in Vault for cron |
| `APP_URL` | ops-notify-dispatch | public app origin; builds the deep link in every WhatsApp/email push (unset → no link) |
| `WA_PROVIDER` | wa_provider | `snapto` (default) or `meta` |
| `SNAPTO_API_KEY`, `SNAPTO_PHONE_ID` | WhatsApp send | snapto Developer → API Keys; phone id `881923021676427` |
| `WA_OTP_TEMPLATE`, `WA_OTP_LANG` | wa-otp-start | approved AUTHENTICATION template |
| `OTP_PEPPER` | wa-otp-* | 32-byte hex; never rotate mid-flight |
| `WA_WEBHOOK_SECRET`, `WA_WEBHOOK_SECRET_HEADER` | wa-webhook | must match the snapto Custom Header; with no secret set the webhook now rejects everything (503) |
| `EMAIL_PROVIDER`, `RESEND_API_KEY`, `EMAIL_FROM` | email_provider | Resend; `EMAIL_FROM` must be a verified domain |
| `DTDC_*` / `AMAZON_*` / `CARRIER_*` | tracking_provider | `{ref}` in URL; `*_STATUS_PATH` = JSON path to status |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | content_reviewer | brief-adherence review (default `claude-sonnet-5-5`) |
| `IG_GRAPH_TOKEN`, `WHATSAPP_API_VER` | post-metrics-worker | IG insights; graph version reused from `WHATSAPP_API_VER` |

Meta-direct WhatsApp fallback (only if `WA_PROVIDER=meta`): `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_APP_SECRET`/`INSTAGRAM_APP_SECRET`, `WA_WEBHOOK_VERIFY_TOKEN`.

## 14. WhatsApp flow — end-to-end behaviour

- **Who gets WhatsApp pushes:** any user with a verified, non-opted-out row in `wa_contacts` — WhatsApp-login creators automatically, and email/Instagram creators after **Messages → Link WhatsApp** (OTP to the number, `wa-otp-verify` in link mode).
- **24-hour window:** inside it the dispatcher sends free text (title + body + deep link). Outside it, it sends `ci_notification_template.wa_template_name` if set; otherwise the WhatsApp copy is marked `skipped` (in-app + email still go out). Approve one UTILITY template per action-required template key to reach creators who haven't messaged in 24h.
- **Thread:** every WhatsApp push is mirrored into the creator's *Campaign updates* conversation, so delivery ticks update live and the creator's replies land in **Messages** — visible to the creator and every active agency operator.
- **Opt-out:** creator replies `STOP` (or uses *Pause updates* in Messages) → `opt_out_at` set, no further WhatsApp sends (checked at enqueue *and* at send). `START` / *Resume updates* re-enables.
- **Retries:** failed sends retry up to 3 attempts (5 min × attempt backoff); rows stuck in `sending` > 10 min are reclaimed.

Health check:

```sql
select channel, status, count(*), max(last_error) from intel.ci_outbox
 where created_at > now() - interval '1 day' group by 1,2 order by 1,2;
```

