-- The bulk-upload panel names the templates that are really used now:
-- invites → geek_campaign_access, every step update → geek_campaign_step (geek_campaign_update is only the
-- automatic backup while a template waits for Meta).
create or replace function api.wa_invite_ready()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'whatsapp', true,
    'template', 'geek_campaign_access',
    'invite_template', 'geek_campaign_access',
    'update_template', 'geek_campaign_step',
    'backup_template', coalesce((select nullif(btrim(update_template),'') from public.wa_settings), 'geek_campaign_update'),
    'is_admin', public.is_platform_admin()) $$;
