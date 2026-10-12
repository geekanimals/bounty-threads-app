#!/usr/bin/env bash
# Step 7 + 9 — dark verification. Reads secrets from the env file (never typed / never in history).
# Needs ANON key in env:  export SUPABASE_ANON_KEY=...   (public key; fine to export)
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
REF="${REF:-edibibytqfrrxfztukpm}"; BASE="https://$REF.supabase.co"
ENVF="supabase/.env.production"
SEC=$(grep -E '^CI_WORKER_SECRET=' "$ENVF" | cut -d= -f2-)
HOOK=$(grep -E '^WA_WEBHOOK_SECRET=' "$ENVF" | cut -d= -f2-)
: "${SUPABASE_ANON_KEY:?export SUPABASE_ANON_KEY first}"
fail=0
check() { local name="$1" want="$2" got="$3"; if [[ "$got" == "$want" ]]; then echo "✓ $name → $got"; else echo "✗ $name → $got (want $want)"; fail=1; fi; }
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }

echo "── workers (correct secret → 200, zero work while flag is OFF)"
for fn in ops-notify-dispatch ops-reminder-worker ops-tracking-worker ops-post-metrics-worker; do
  body=$(curl -s -w "\n%{http_code}" -X POST "$BASE/functions/v1/$fn" -H "x-worker-secret: $SEC" -H "Content-Type: application/json" -d '{}')
  check "$fn ok" 200 "$(tail -n1 <<<"$body")"; echo "    $(head -n1 <<<"$body")"
done
echo "── workers reject bad / missing secret / user JWT"
for fn in ops-notify-dispatch ops-reminder-worker ops-tracking-worker ops-post-metrics-worker ops-content-review; do
  check "$fn wrong secret"  401 "$(code -X POST "$BASE/functions/v1/$fn" -H 'x-worker-secret: wrong' -d '{}')"
  check "$fn no secret"     401 "$(code -X POST "$BASE/functions/v1/$fn" -d '{}')"
  check "$fn anon JWT"      401 "$(code -X POST "$BASE/functions/v1/$fn" -H "Authorization: Bearer $SUPABASE_ANON_KEY" -d '{}')"
done
echo "── webhook auth"
check "wa-webhook no secret"    401 "$(code -X POST "$BASE/functions/v1/wa-webhook" -d '{}')"
check "wa-webhook wrong secret" 401 "$(code -X POST "$BASE/functions/v1/wa-webhook" -H 'x-webhook-secret: wrong' -d '{}')"
check "wa-webhook good secret"  200 "$(code -X POST "$BASE/functions/v1/wa-webhook" -H "x-webhook-secret: $HOOK" -H 'Content-Type: application/json' -d '{"entry":[]}')"
echo "── OTP endpoints validate input (no message is sent)"
check "wa-otp-start bad phone"  400 "$(code -X POST "$BASE/functions/v1/wa-otp-start" -H 'Content-Type: application/json' -d '{"phone":"123"}')"
check "wa-otp-verify bad code"  400 "$(code -X POST "$BASE/functions/v1/wa-otp-verify" -H 'Content-Type: application/json' -d '{"phone":"+919800000000","code":"12"}')"
check "wa-send no JWT"          401 "$(code -X POST "$BASE/functions/v1/wa-send" -d '{}')"
echo "── Data API: intel/private must NOT be exposed"
check "intel schema hidden"   406 "$(code "$BASE/rest/v1/ci_campaign?select=campaign_id&limit=1" -H "apikey: $SUPABASE_ANON_KEY" -H 'Accept-Profile: intel')"
check "private schema hidden" 406 "$(code "$BASE/rest/v1/x?limit=1" -H "apikey: $SUPABASE_ANON_KEY" -H 'Accept-Profile: private')"
check "wa_otp not readable"   401 "$(code "$BASE/rest/v1/wa_otp?select=id&limit=1" -H "apikey: $SUPABASE_ANON_KEY")"
unset SEC HOOK
[[ $fail == 0 ]] && echo "ALL GREEN — safe to proceed to Step 10" || { echo "FAILURES above — do NOT activate"; exit 1; }
