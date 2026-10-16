#!/bin/zsh
# Supabase secrets ko TextEdit mein edit karo:   ./edit-secrets.sh
#   1) supabase/.env.secrets TextEdit mein khulti hai (ye file git mein kabhi nahi jaati)
#   2) jo secret badalna hai uske "=" ke baad nayi value likho → Save (Cmd+S) → TextEdit band karo (Cmd+Q)
#   3) jin lines mein value likhi hai sirf wahi Supabase pe set hoti hain; khaali lines ko chhoda jaata hai
cd "$(dirname "$0")" || exit 1
F="supabase/.env.secrets"

if [ ! -f "$F" ]; then
cat > "$F" <<'EOF'
# Supabase secrets — "=" ke baad value likho. KHAALI chhodi line Supabase pe jaisi hai waisi rehti hai.
# Save (Cmd+S) karke TextEdit band karo (Cmd+Q) — tab script values Supabase pe daalegi.
# ⚠️ TOKEN_ENC_KEY kabhi mat badalna (Instagram connections toot jayenge).

# --- Live domain ---
APP_URL=

# --- WhatsApp (snapto) ---
SNAPTO_API_KEY=
SNAPTO_PHONE_ID=
WA_PROVIDER=
WA_UPDATE_TEMPLATE=
WA_BACKUP_TEMPLATES=
WA_OTP_TEMPLATE=
WA_OTP_LANG=
WA_WEBHOOK_SECRET=

# --- Email ---
EMAIL_PROVIDER=
EMAIL_FROM=
RESEND_API_KEY=
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=

# --- Instagram ---
INSTAGRAM_APP_ID=
INSTAGRAM_APP_SECRET=
IG_REDIRECT_URI=

# --- Facebook (Discover) ---
FB_APP_ID=
FB_APP_SECRET=
FB_LOGIN_CONFIG_ID=
EOF
fi

echo "📝 TextEdit mein file khul rahi hai — value likho, Cmd+S se save karo, phir Cmd+Q se TextEdit band karo…"
open -W -e "$F"

# sirf woh lines jinme value hai (comments + khaali values hata ke)
T="$(mktemp)"
grep -E '^[A-Z0-9_]+=.+' "$F" | grep -v '^#' > "$T"
N=$(wc -l < "$T" | tr -d ' ')
if [ "$N" = "0" ]; then echo "Koi value nahi likhi — kuch nahi badla."; rm -f "$T"; exit 0; fi

echo "\nYe $N secret(s) Supabase pe set honge:"; cut -d= -f1 "$T" | sed 's/^/   • /'
printf "\nSet karun? (y/n) "; read ok
if [ "$ok" = "y" ] || [ "$ok" = "Y" ]; then
  supabase secrets set --env-file "$T" && echo "\n✅ Ho gaya — functions agli request se nayi value use karenge."
else
  echo "Kuch nahi badla."
fi
rm -f "$T"
# values file mein mat chhodo — next time khaali form khulega (secrets sirf Supabase mein rehte hain)
sed -i '' -E 's/^([A-Z0-9_]+)=.*/\1=/' "$F"
