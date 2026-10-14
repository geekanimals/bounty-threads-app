-- Bulk upload panel: can WhatsApp invites go out right now? (an approved update template is set by the
-- Super Admin). Agencies / brands see a yes / no — never the settings themselves. ADDITIVE.
create or replace function api.wa_invite_ready()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'whatsapp', coalesce((select nullif(btrim(update_template),'') is not null from public.wa_settings), false),
    'template', (select nullif(btrim(update_template),'') from public.wa_settings),
    'is_admin', public.is_platform_admin()) $$;
revoke all on function api.wa_invite_ready() from public, anon;
grant execute on function api.wa_invite_ready() to authenticated;
