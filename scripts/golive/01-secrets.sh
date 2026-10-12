#!/usr/bin/env bash
# Step 3 — create supabase/.env.production (chmod 600, gitignored) and push it to Edge secrets.
# Generated secrets are written straight to the file and NEVER printed / never in shell history.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
REF="${REF:-edibibytqfrrxfztukpm}"
ENVF="supabase/.env.production"

git check-ignore -q "$ENVF" || { echo "✗ $ENVF is NOT gitignored — aborting"; exit 1; }

if [[ ! -f "$ENVF" ]]; then
  umask 077
  gen() { openssl rand -hex 32; }
  cat > "$ENVF" <<ENV
# ---- generated $(date -u +%FT%TZ) — DO NOT COMMIT ----
CI_WORKER_SECRET=$(gen)
OTP_PEPPER=$(gen)
WA_WEBHOOK_SECRET=$(gen)
WA_WEBHOOK_SECRET_HEADER=x-webhook-secret

APP_URL=__FILL_ME__                      # e.g. https://bountythreads.app (deep links in WhatsApp/email)

WA_PROVIDER=snapto
SNAPTO_API_KEY=__FILL_ME__
SNAPTO_PHONE_ID=881923021676427
WA_OTP_TEMPLATE=__FILL_ME__
WA_OTP_LANG=en
OTP_ALLOWED_COUNTRY_CODES=91
OTP_MAX_PER_IP_HOUR=10
OTP_MAX_GLOBAL_HOUR=500

EMAIL_PROVIDER=resend
RESEND_API_KEY=__FILL_ME__
EMAIL_FROM="Bounty & Threads <campaigns@your-verified-domain.com>"

DTDC_TRACK_URL=
DTDC_API_KEY=
DTDC_KEY_HEADER=X-Access-Token
DTDC_STATUS_PATH=status
AMAZON_TRACK_URL=
AMAZON_API_KEY=

ANTHROPIC_API_KEY=__FILL_ME__
ANTHROPIC_MODEL=claude-sonnet-5-5

IG_GRAPH_TOKEN=
WHATSAPP_API_VER=v21.0
ENV
  chmod 600 "$ENVF"
  echo "✓ Created $ENVF (600). Fill every __FILL_ME__, then re-run this script."
  exit 0
fi

chmod 600 "$ENVF"
if grep -q "__FILL_ME__" "$ENVF"; then
  echo "✗ Still has placeholders:"; grep -n "__FILL_ME__" "$ENVF" | cut -d= -f1; exit 1
fi
for k in CI_WORKER_SECRET OTP_PEPPER WA_WEBHOOK_SECRET; do
  v=$(grep -E "^$k=" "$ENVF" | cut -d= -f2-)
  [[ ${#v} -ge 64 ]] || { echo "✗ $k must be 64 hex chars (openssl rand -hex 32)"; exit 1; }
done
grep -qE '^EMAIL_FROM=.*your-verified-domain' "$ENVF" && { echo "✗ EMAIL_FROM still the placeholder domain"; exit 1; }

supabase secrets set --env-file "$ENVF" --project-ref "$REF"
supabase secrets list --project-ref "$REF"
echo "✓ Secrets set (values masked above)."
