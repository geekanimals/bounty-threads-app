-- Per-campaign WhatsApp templates, created automatically: the template worker now reports how it is set up
-- (Meta direct = fully automatic, or manual) and whether the Meta connection works, so the Super Admin sees it
-- and can kick a check. ADDITIVE.
alter table public.wa_settings add column if not exists template_mode text;
alter table public.wa_settings add column if not exists template_mode_error text;
alter table public.wa_settings add column if not exists template_mode_at timestamptz;

create or replace function api.ops_wa_template_mode(p_mode text, p_error text default null)
returns void language sql security definer set search_path = '' as $$
  update public.wa_settings set template_mode = left(p_mode, 40), template_mode_error = left(p_error, 400), template_mode_at = now() $$;
revoke all on function api.ops_wa_template_mode(text, text) from public, anon, authenticated;
grant execute on function api.ops_wa_template_mode(text, text) to service_role;

create or replace function public.admin_wa_template_status()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then raise exception 'not a platform admin' using errcode = '42501'; end if;
  return (select jsonb_build_object('mode', template_mode, 'error', template_mode_error, 'at', template_mode_at,
    'counts', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (select status, count(*) n from public.wa_campaign_templates group by 1) x))
    from public.wa_settings);
end $$;
create or replace function public.admin_wa_templates_check()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then raise exception 'not a platform admin' using errcode = '42501'; end if;
  -- anything that was waiting for a manual step gets another go now that the connection may be set up
  update public.wa_campaign_templates set status = 'queued', attempts = 0, updated_at = now() where status in ('manual','failed');
  perform private.ci_kick_worker('wa-template-sync');
end $$;
revoke all on function public.admin_wa_template_status(), public.admin_wa_templates_check() from public, anon;
grant execute on function public.admin_wa_template_status(), public.admin_wa_templates_check() to authenticated;

-- 'manual' rows are picked up again by the worker (so adding the Meta keys later turns them automatic)
create or replace function api.wa_templates_claim(p_limit int default 20)
returns setof public.wa_campaign_templates language sql security definer set search_path = '' as $$
  update public.wa_campaign_templates t set attempts = attempts + 1, updated_at = now()
   where t.campaign_id in (select campaign_id from public.wa_campaign_templates
                            where status in ('queued','submitted')
                               or (status = 'failed' and attempts < 5)
                               or (status = 'manual' and updated_at < now() - interval '1 hour')
                            order by updated_at limit greatest(p_limit,1) for update skip locked)
  returning t.* $$;
