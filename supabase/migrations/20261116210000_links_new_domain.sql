-- Every link in messages / emails / admin screens now points at the new site (bounty.geekcreativeagency.com).
-- Old /app.html?... routes keep working there (the /legacy router). Rewrites any function that still has the old domain.
-- (The APP_URL function secret is set to https://bounty.geekcreativeagency.com as well.)
do $x$
declare r record; d text;
begin
  for r in select p.oid from pg_proc p join pg_namespace s on s.oid = p.pronamespace
            where s.nspname in ('public','api','intel','private') and p.prokind = 'f' and p.prosrc ilike '%bountythreads.geekcreativeagency.com%'
  loop
    d := pg_get_functiondef(r.oid);
    d := replace(d, 'https://www.bountythreads.geekcreativeagency.com', 'https://bounty.geekcreativeagency.com');
    d := replace(d, 'www.bountythreads.geekcreativeagency.com', 'bounty.geekcreativeagency.com');
    d := replace(d, 'bountythreads.geekcreativeagency.com', 'bounty.geekcreativeagency.com');
    execute d;
  end loop;
end $x$;
update public.wa_settings set app_url = 'https://bounty.geekcreativeagency.com', app_url_at = now() where id;
