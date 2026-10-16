#!/bin/zsh
# Apni env file (supabase/.env.production) TextEdit mein edit karo aur Supabase pe daal do:   ./edit-secrets.sh
#   1) file TextEdit mein khulti hai → badlo → Save (Cmd+S) → TextEdit band karo (Cmd+Q)
#   2) file ki saari values (# wali lines chhod ke) Supabase secrets mein set ho jaati hain
# Ye file git mein kabhi nahi jaati (.gitignore). ⚠️ TOKEN_ENC_KEY kabhi mat badalna.
cd "$(dirname "$0")" || exit 1
F="supabase/.env.production"
[ -f "$F" ] || { echo "✖ $F nahi mili."; exit 1; }

cp "$F" "$F.bak"                      # pichhli copy, galti ho toh wapas la sakte ho
echo "📝 $F TextEdit mein khul rahi hai — badlo, Cmd+S se save karo, phir Cmd+Q se TextEdit band karo…"
open -W -e "$F"

if cmp -s "$F" "$F.bak"; then echo "Kuch nahi badla."; exit 0; fi
echo "\nBadli hui lines:"; diff "$F.bak" "$F" | grep '^>' | sed -E 's/^> ([A-Z0-9_]+)=.*/   • \1/; s/^> #.*/   • (comment)/'
printf "\nSupabase pe set karun? (y/n) "; read ok
if [ "$ok" = "y" ] || [ "$ok" = "Y" ]; then
  supabase secrets set --env-file "$F" && echo "\n✅ Ho gaya — functions agli request se nayi values use karenge."
else
  echo "Supabase pe kuch nahi bheja (file mein changes save hain; pichhli copy: $F.bak)."
fi
