-- One live domain for every link the server sends (WhatsApp, email, invites, unsubscribe): taken from the
-- APP_URL environment variable. The Supabase secret APP_URL wins; otherwise the domain set as APP_URL on Vercel
-- is reported here by the Super Admin's app (never typed by hand, never hard-coded). ADDITIVE.
alter table public.wa_settings add column if not exists app_url text;
alter table public.wa_settings add column if not exists app_url_at timestamptz;

create or replace function public.admin_sync_app_url(p_url text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v text := rtrim(btrim(coalesce(p_url,'')), '/');
begin
  if not public.is_platform_admin() then raise exception 'not a platform admin' using errcode = '42501'; end if;
  if v !~ '^https://[a-z0-9.-]+(:[0-9]+)?$' or v ~* '://(localhost|127\.|0\.0\.0\.0)' then
    raise exception 'app url must be the public https origin' using errcode = '22023'; end if;
  update public.wa_settings set app_url = v, app_url_at = now() where app_url is distinct from v;
  return jsonb_build_object('app_url', v);
end $$;
revoke all on function public.admin_sync_app_url(text) from public, anon;
grant execute on function public.admin_sync_app_url(text) to authenticated;

-- the dispatcher + template worker read it on every run
create or replace function api.ops_wa_settings()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce((select jsonb_build_object('template', nullif(btrim(update_template),''), 'lang', update_lang, 'app_url', app_url)
                     from public.wa_settings), '{}'::jsonb) $$;
revoke all on function api.ops_wa_settings() from public, anon, authenticated;
grant execute on function api.ops_wa_settings() to service_role;

-- the worker reports which domain its links use (shown in Super Admin → WhatsApp & email)
alter table public.wa_settings add column if not exists links_domain text;
alter table public.wa_settings add column if not exists links_source text;
create or replace function api.ops_report_links(p_domain text, p_source text)
returns void language sql security definer set search_path = '' as $$
  update public.wa_settings set links_domain = left(p_domain, 200), links_source = left(p_source, 40)
   where links_domain is distinct from left(p_domain, 200) or links_source is distinct from left(p_source, 40) $$;
revoke all on function api.ops_report_links(text, text) from public, anon, authenticated;
grant execute on function api.ops_report_links(text, text) to service_role;

create or replace function public.admin_links_status()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then raise exception 'not a platform admin' using errcode = '42501'; end if;
  return (select jsonb_build_object('app_url', app_url, 'app_url_at', app_url_at, 'links_domain', links_domain, 'links_source', links_source)
            from public.wa_settings);
end $$;
revoke all on function public.admin_links_status() from public, anon;
grant execute on function public.admin_links_status() to authenticated;
