-- WhatsApp campaign updates: one approved UTILITY template carries EVERY update (any campaign, any step).
-- Meta allows free-text WhatsApp only within 24 h of the creator's last message; everything else must use an
-- approved template. Until now that template could only be set as a server secret (WA_UPDATE_TEMPLATE), so
-- every WhatsApp update was held while email went out. The Super Admin now sets it in the app
-- (Super Admin → WhatsApp & email); saving it re-sends every held update straight away. ADDITIVE.

create table if not exists public.wa_settings (
  id              boolean primary key default true check (id),
  update_template text,
  update_lang     text not null default 'en',
  updated_by      uuid references auth.users(id) on delete set null,
  updated_at      timestamptz not null default now()
);
insert into public.wa_settings(id) values (true) on conflict (id) do nothing;
alter table public.wa_settings enable row level security;
revoke all on public.wa_settings from anon, authenticated;
grant select, insert, update on public.wa_settings to service_role;

-- dispatcher reads it on every run
create or replace function api.ops_wa_settings()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce((select jsonb_build_object('template', nullif(btrim(update_template),''), 'lang', update_lang) from public.wa_settings), '{}'::jsonb) $$;
revoke all on function api.ops_wa_settings() from public, anon, authenticated;
grant execute on function api.ops_wa_settings() to service_role;

-- Super Admin: read / set
create or replace function public.admin_wa_settings()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then raise exception 'not a platform admin' using errcode = '42501'; end if;
  return jsonb_build_object(
    'template', (select update_template from public.wa_settings), 'lang', (select update_lang from public.wa_settings),
    'updated_at', (select updated_at from public.wa_settings),
    'held', (select count(*) from intel.ci_outbox where channel = 'whatsapp' and status = 'skipped'
              and (last_error like 'WhatsApp 24h window closed%' or last_error like 'Waiting for WhatsApp template approval%')
              and created_at > now() - interval '3 days'),
    'no_number', (select count(*) from intel.ci_notification n where n.created_at > now() - interval '3 days'
                   and not exists (select 1 from public.wa_contacts w where w.user_id = n.recipient_member_id and w.verified_at is not null)),
    'opted_out', (select count(*) from public.wa_contacts where opt_out_at is not null));
end $$;

create or replace function public.admin_set_wa_settings(p_template text, p_lang text default 'en')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_t text := nullif(btrim(coalesce(p_template,'')),''); v_n int := 0;
begin
  if not public.is_platform_admin() then raise exception 'not a platform admin' using errcode = '42501'; end if;
  if v_t is not null and v_t !~ '^[a-z0-9_]{1,255}$' then
    raise exception 'template name must be lowercase letters, numbers and _ only (exactly as in snapto)' using errcode = '22023'; end if;
  update public.wa_settings set update_template = v_t, update_lang = coalesce(nullif(btrim(p_lang),''),'en'),
         updated_by = auth.uid(), updated_at = now();
  if v_t is not null then
    -- everything held in the last 3 days goes out now
    update intel.ci_outbox set status = 'queued', attempts = 0
     where channel = 'whatsapp' and status = 'skipped'
       and (last_error like 'WhatsApp 24h window closed%' or last_error like 'Waiting for WhatsApp template approval%')
       and created_at > now() - interval '3 days';
    get diagnostics v_n = row_count;
  end if;
  return jsonb_build_object('template', v_t, 'requeued', v_n);
end $$;
revoke all on function public.admin_wa_settings() from public, anon;
revoke all on function public.admin_set_wa_settings(text, text) from public, anon;
grant execute on function public.admin_wa_settings(), public.admin_set_wa_settings(text, text) to authenticated;
