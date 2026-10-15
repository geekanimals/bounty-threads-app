#!/bin/zsh
# Ek command se sab LIVE:   ./deploy.sh "kya badla"
#   1) UI (html/js/css)      → GitHub → Vercel apne aap live site update karta hai
#   2) Database (migrations) → Supabase
#   3) Server functions      → Supabase Edge Functions
cd "$(dirname "$0")" || exit 1
MSG="${1:-update}"

echo "\n▶ 1/3  UI + code → GitHub (Vercel live karega)"
git add -A
git commit -q -m "$MSG" && echo "   saved: $MSG" || echo "   (koi naya change nahi)"
git push origin HEAD || { echo "✖ GitHub push fail — upar ka error dekho"; exit 1; }
git push origin HEAD:main || { echo "✖ main push fail — upar ka error dekho"; exit 1; }

echo "\n▶ 2/3  Database → Supabase"
supabase db push || { echo "✖ Database push fail — upar ka error dekho"; exit 1; }

echo "\n▶ 3/3  Server functions → Supabase"
supabase functions deploy || { echo "✖ Functions deploy fail — upar ka error dekho"; exit 1; }

echo "\n✅ Sab live ho gaya. Website 1-2 minute mein update ho jayegi (Vercel)."
