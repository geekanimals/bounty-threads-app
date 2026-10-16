#!/bin/zsh
# Saare backend secrets ek file mein:   ./edit-secrets.sh
#   1) Supabase mein jo bhi secrets set hain, unke NAAM supabase/.env.production mein jud jaate hain
#      (Supabase values kabhi wapas nahi deta — isliye jo sirf Supabase mein the woh "# NAAM=" ban ke aate hain)
#   2) file TextEdit mein khulti hai → badlo → Save (Cmd+S) → TextEdit band karo (Cmd+Q)
#   3) jin lines mein value hai (# wali chhod ke) woh Supabase pe set ho jaati hain
# Ye file git mein kabhi nahi jaati. ⚠️ TOKEN_ENC_KEY kabhi mat badalna.
cd "$(dirname "$0")" || exit 1
F="supabase/.env.production"
[ -f "$F" ] || { echo "✖ $F nahi mili."; exit 1; }
cp "$F" "$F.bak"                      # pichhli copy, galti ho toh wapas la sakte ho

# --- 1) Supabase ke secrets ke naam merge karo ---
echo "🔄 Supabase se secrets ki list le raha hoon…"
NAMES=$(supabase secrets list 2>/dev/null | grep -oE '^[[:space:]]*[A-Z][A-Z0-9_]+[[:space:]]*\|' | tr -d ' |' | sort -u)
if [ -z "$NAMES" ]; then
  echo "   (list nahi mili — 'supabase login' / 'supabase link' check karo. File phir bhi khul rahi hai.)"
else
  ADDED=""
  for n in ${(f)NAMES}; do
    case "$n" in SUPABASE_URL|SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_DB_URL|SUPABASE_PUBLISHABLE_KEYS|SUPABASE_SECRET_KEYS|SUPABASE_JWKS|NAME) continue;; esac
    grep -qE "^#?[[:space:]]*$n=" "$F" || ADDED="$ADDED$n\n"
  done
  if [ -n "$ADDED" ]; then
    {
      echo ""
      echo "# ---- Ye Supabase mein pehle se SET hain (value Supabase wapas nahi dikhata) ----"
      echo "# Badalna ho toh aage ka # hatao aur NAYI value likho. # rehne do toh Supabase wali value hi chalegi."
      printf "$ADDED" | while read -r n; do
        [ -z "$n" ] && continue
        if [ "$n" = "TOKEN_ENC_KEY" ]; then echo "# TOKEN_ENC_KEY=   ⚠️ KABHI MAT BADALNA — Instagram connections toot jayenge"
        else echo "# $n="; fi
      done
    } >> "$F"
    echo "   ✓ $(printf "$ADDED" | grep -c .) naam file mein jode: $(printf "$ADDED" | tr '\n' ' ')"
  else
    echo "   ✓ Supabase ke saare secrets ke naam file mein pehle se hain."
  fi
fi

# --- 2) edit ---
echo "📝 $F TextEdit mein khul rahi hai — badlo, Cmd+S se save karo, phir Cmd+Q se TextEdit band karo…"
open -W -e "$F"

if cmp -s "$F" "$F.bak"; then echo "Kuch nahi badla."; exit 0; fi
CH=$(diff "$F.bak" "$F" | grep -E '^> [A-Z0-9_]+=' | sed -E 's/^> ([A-Z0-9_]+)=.*/\1/')
if [ -z "$CH" ]; then echo "Sirf naam / comments jude — Supabase pe kuch bhejne ki zaroorat nahi."; exit 0; fi
echo "\nYe secrets set honge:"; echo "$CH" | sed 's/^/   • /'
if echo "$CH" | grep -qx TOKEN_ENC_KEY; then echo "\n✖ TOKEN_ENC_KEY badla gaya hai — ye mana hai. File ko $F.bak se wapas lao."; exit 1; fi

# --- 3) push (sirf woh lines jinme value hai) ---
printf "\nSupabase pe set karun? (y/n) "; read ok
if [ "$ok" = "y" ] || [ "$ok" = "Y" ]; then
  T="$(mktemp)"; grep -E '^[A-Z0-9_]+=.+' "$F" | grep -v '^TOKEN_ENC_KEY=' > "$T"
  supabase secrets set --env-file "$T" && echo "\n✅ Ho gaya — functions agli request se nayi values use karenge."
  rm -f "$T"
else
  echo "Supabase pe kuch nahi bheja (file mein changes save hain; pichhli copy: $F.bak)."
fi
