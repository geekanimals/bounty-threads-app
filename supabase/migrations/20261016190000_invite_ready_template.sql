-- The bulk-upload panel shows which WhatsApp template invites go out on: the invite template
-- geek_campaign_access (every campaign invite uses it), plus the update template used for the steps after.
create or replace function api.wa_invite_ready()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'whatsapp', true,
    'template', 'geek_campaign_access',
    'invite_template', 'geek_campaign_access',
    'update_template', coalesce((select nullif(btrim(update_template),'') from public.wa_settings), 'geek_campaign_update'),
    'is_admin', public.is_platform_admin()) $$;
