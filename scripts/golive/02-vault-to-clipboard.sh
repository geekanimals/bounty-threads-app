#!/usr/bin/env bash
# Step 8a — copies the Vault SQL (contains CI_WORKER_SECRET) to the macOS clipboard WITHOUT printing it.
# Paste into Supabase → SQL Editor → Run. Then DELETE that snippet from the editor's history.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
REF="${REF:-edibibytqfrrxfztukpm}"
SEC=$(grep -E '^CI_WORKER_SECRET=' supabase/.env.production | cut -d= -f2-)
[[ ${#SEC} -ge 64 ]] || { echo "✗ CI_WORKER_SECRET missing — run 01-secrets.sh first"; exit 1; }
cat <<SQL | pbcopy
-- idempotent: create or rotate
do \$\$ declare v uuid; begin
  select id into v from vault.secrets where name='ops_functions_url';
  if v is null then perform vault.create_secret('https://${REF}.supabase.co/functions/v1','ops_functions_url');
  else perform vault.update_secret(v, 'https://${REF}.supabase.co/functions/v1'); end if;
  select id into v from vault.secrets where name='ci_worker_secret';
  if v is null then perform vault.create_secret('${SEC}','ci_worker_secret');
  else perform vault.update_secret(v, '${SEC}'); end if;
end \$\$;
select name, created_at, updated_at from vault.secrets where name in ('ops_functions_url','ci_worker_secret');
SQL
unset SEC
echo "✓ Vault SQL copied to clipboard. Paste in SQL Editor → Run → then delete the snippet."
echo "  Next: run supabase/sql/barter_cron_schedule.sql in the SQL Editor (no secrets in it)."
