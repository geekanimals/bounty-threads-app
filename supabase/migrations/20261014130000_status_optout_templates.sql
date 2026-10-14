-- 1) Campaign status is just Draft → Live → Completed. Completed happens on its own:
--      • the day after the end date, or • when every creator on it is done.
--    (Old campaigns can still be saved straight as Completed when their end date is already past.)
-- 2) Unsubscribe that really works, per channel:
--      • WhatsApp: reply STOP (already handled by wa-webhook) or tap the link → no more updates on WhatsApp;
--        WhatsApp login OTPs still go (they never use the outbox).
--      • Email: one-click link in every email (+ List-Unsubscribe header) → no more update emails;
--        account-recovery / login codes still go (email-otp never uses the outbox).
--      • Both can be switched back on from the app (profile card → Updates).
-- 3) Every new campaign gets its own WhatsApp UTILITY template, created automatically (wa-template-sync);
--    updates for that campaign use it once Meta approves it. Messages that were held because the 24-hour
--    window was closed are re-sent as soon as a template is approved.
-- ADDITIVE.

-- ===================================================================================================
-- 1) Status
-- ===================================================================================================
create or replace function public.auto_complete_campaigns()
returns int language plpgsql security definer set search_path = '' as $$
declare v_n int := 0; v_m int := 0; v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  update public.campaigns set status = 'Completed'
   where status in ('Live','Sourcing','In Production') and end_date is not null and end_date < v_today;
  get diagnostics v_n = row_count;
  -- every creator finished (and at least one posted) → the campaign is done
  update public.campaigns pc set status = 'Completed'
   where pc.status in ('Live','Sourcing','In Production')
     and exists (select 1 from intel.ci_campaign c join intel.ci_campaign_participation p on p.campaign_id = c.campaign_id
                  where c.legacy_campaign_id = pc.id and p.stage = 'completed')
     and not exists (select 1 from intel.ci_campaign c join intel.ci_campaign_participation p on p.campaign_id = c.campaign_id
                      where c.legacy_campaign_id = pc.id
                        and p.stage not in ('completed','dropped','rejected','ineligible','brand_declined'));
  get diagnostics v_m = row_count;
  return v_n + v_m;
end $$;
revoke all on function public.auto_complete_campaigns() from public, anon, authenticated;
grant execute on function public.auto_complete_campaigns() to service_role;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('ci-campaign-autocomplete', '20 * * * *', $c$select public.auto_complete_campaigns()$c$);
  end if;
exception when others then raise notice 'cron schedule skipped: %', sqlerrm;
end $$;

-- the Super Admin's status picker + approvals use the same three words
create or replace function public.admin_set_campaign_status(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'not a platform admin' using errcode = '42501'; end if;
  if p_status not in ('Draft','Sourcing','Approval','In Production','Live','Completed') then raise exception 'invalid status'; end if;
  update public.campaigns set status = p_status where id = p_id;
end $$;

-- ===================================================================================================
-- 2) Unsubscribe
-- ===================================================================================================
alter table public.members add column if not exists email_opt_out_at timestamptz;
alter table public.members add column if not exists notify_token uuid not null default gen_random_uuid();
create unique index if not exists members_notify_token_uq on public.members(notify_token);

-- ci_notify: no update emails to someone who unsubscribed (OTP / recovery mail never comes through here)
create or replace function intel.ci_notify(p_recipient uuid, p_campaign uuid, p_participation uuid, p_key text, p_vars jsonb default '{}')
returns uuid language plpgsql security definer set search_path = '' as $$
declare t intel.ci_notification_template%rowtype; v_title text; v_body text; v_route text; v_label text;
        v_kind text; v_nid uuid; v_email text; v_wa text; v_dedupe text; v_email_off boolean;
begin
  if p_recipient is null then return null; end if;
  if not intel.ci_feature_enabled('operational_pilot') then return null; end if;
  select * into t from intel.ci_notification_template where template_key=p_key and active;
  if found then
    v_title := intel.ci_render(t.title, p_vars); v_body := intel.ci_render(t.body_md, p_vars);
    v_route := nullif(intel.ci_render(coalesce(t.action_route,''), p_vars),''); v_label := coalesce(t.action_label,'Open'); v_kind := t.kind;
  else
    v_title := p_key; v_body := p_key; v_route := null; v_label := 'Open'; v_kind := 'info';
  end if;
  v_dedupe := p_key||':'||coalesce(p_participation::text, p_campaign::text, gen_random_uuid()::text);

  insert into intel.ci_notification(recipient_member_id, campaign_id, participation_id, kind, title, body, action_route, action_label, dedupe_key)
    values (p_recipient, p_campaign, p_participation, v_kind, v_title, v_body, v_route, v_label, v_dedupe)
    returning notification_id into v_nid;

  select m.email_opt_out_at is not null into v_email_off from public.members m where m.id = p_recipient;
  if not coalesce(v_email_off, false) then
    select nullif(u.email::text, '') into v_email from auth.users u where u.id = p_recipient;
    if v_email ~* '@creators\.bountythreads\.app$' then v_email := null; end if;
    if v_email is null then select nullif(m.official_email, '') into v_email from public.members m where m.id = p_recipient; end if;
    if v_email is null then
      select nullif(c.email, '') into v_email
        from intel.ci_identity_actor_access a join private.creator_contact c on c.identity_id = a.identity_id
       where a.member_id = p_recipient and a.access_role = 'self' and a.revoked_at is null
         and c.email !~* '@creators\.bountythreads\.app$'
       order by a.granted_at limit 1;
    end if;
    if v_email is not null then
      insert into intel.ci_outbox(channel, recipient_member_id, to_address, campaign_id, participation_id, notification_id, template_key, payload, dedupe_key)
        values ('email', p_recipient, v_email, p_campaign, p_participation, v_nid, p_key,
          jsonb_build_object('subject',v_title,'html',v_body,'action_route',v_route,'action_label',v_label), v_nid::text)
        on conflict (channel, dedupe_key) where dedupe_key is not null do nothing;
    end if;
  end if;

  select phone_e164 into v_wa from public.wa_contacts where user_id=p_recipient and verified_at is not null and opt_out_at is null;
  if v_wa is not null then
    insert into intel.ci_outbox(channel, recipient_member_id, to_address, campaign_id, participation_id, notification_id, template_key, payload, dedupe_key)
      values ('whatsapp', p_recipient, v_wa, p_campaign, p_participation, v_nid, p_key,
        jsonb_build_object('title', v_title, 'text', v_body, 'action_route', v_route, 'action_label', v_label,
                           'wa_template', t.wa_template_name, 'wa_vars', jsonb_build_array(coalesce(p_vars->>'campaign',''))), v_nid::text)
      on conflict (channel, dedupe_key) where dedupe_key is not null do nothing;
  end if;
  return v_nid;
end $$;
revoke all on function intel.ci_notify(uuid,uuid,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function intel.ci_notify(uuid,uuid,uuid,text,jsonb) to service_role;

-- the dispatcher needs each recipient's unsubscribe token + current choices at send time
create or replace function api.ops_recipient_prefs(p_member uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce((select jsonb_build_object('token', m.notify_token, 'email_off', m.email_opt_out_at is not null,
           'name', split_part(coalesce(nullif(btrim(m.name),''),'there'),' ',1),
           'wa_off', exists (select 1 from public.wa_contacts w where w.user_id = m.id and w.opt_out_at is not null))
      from public.members m where m.id = p_member), '{}'::jsonb) $$;
revoke all on function api.ops_recipient_prefs(uuid) from public, anon, authenticated;
grant execute on function api.ops_recipient_prefs(uuid) to service_role;

-- the unsubscribe link (no sign-in needed: the token is the key). channel = 'email' | 'whatsapp'
create or replace function api.notify_unsubscribe(p_token uuid, p_channel text, p_off boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  select id into v_id from public.members where notify_token = p_token;
  if v_id is null then raise exception 'link not valid' using errcode = '22023'; end if;
  if p_channel = 'email' then
    update public.members set email_opt_out_at = case when p_off then now() else null end where id = v_id;
  elsif p_channel = 'whatsapp' then
    update public.wa_contacts set opt_out_at = case when p_off then now() else null end,
                                  opt_in_at = case when p_off then opt_in_at else now() end where user_id = v_id;
  else raise exception 'unknown channel' using errcode = '22023'; end if;
  -- anything already queued for that channel is dropped
  if p_off then
    update intel.ci_outbox set status = 'skipped', last_error = 'unsubscribed'
     where recipient_member_id = v_id and channel = p_channel and status = 'queued';
  end if;
  return jsonb_build_object('ok', true, 'channel', p_channel, 'off', p_off);
end $$;
revoke all on function api.notify_unsubscribe(uuid, text, boolean) from public, anon, authenticated;
grant execute on function api.notify_unsubscribe(uuid, text, boolean) to service_role;

-- in the app: what am I subscribed to, and switch it
create or replace function public.my_notify_prefs()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'email_off', coalesce((select m.email_opt_out_at is not null from public.members m where m.id = auth.uid()), false),
    'whatsapp_linked', exists (select 1 from public.wa_contacts w where w.user_id = auth.uid() and w.verified_at is not null),
    'whatsapp_off', exists (select 1 from public.wa_contacts w where w.user_id = auth.uid() and w.opt_out_at is not null)) $$;
create or replace function public.set_email_updates(p_on boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  update public.members set email_opt_out_at = case when p_on then null else now() end where id = auth.uid();
  return public.my_notify_prefs();
end $$;
revoke all on function public.my_notify_prefs() from public, anon;
revoke all on function public.set_email_updates(boolean) from public, anon;
grant execute on function public.my_notify_prefs(), public.set_email_updates(boolean) to authenticated;

-- ===================================================================================================
-- 3) One WhatsApp UTILITY template per campaign
-- ===================================================================================================
create table if not exists public.wa_campaign_templates (
  campaign_id    uuid primary key references public.campaigns(id) on delete cascade,
  template_name  text not null unique,
  language       text not null default 'en',
  body           text not null,
  footer         text not null default 'Reply STOP to stop WhatsApp updates',
  status         text not null default 'queued' check (status in ('queued','submitted','approved','rejected','failed','manual')),
  provider       text,
  provider_ref   text,
  error          text,
  attempts       int not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
alter table public.wa_campaign_templates enable row level security;
revoke all on public.wa_campaign_templates from anon, authenticated;
grant select, insert, update on public.wa_campaign_templates to service_role;

create or replace function public.wa_template_name_for(p_name text, p_id uuid)
returns text language sql immutable set search_path = '' as $$
  select left('geek_' || coalesce(nullif(trim(both '_' from regexp_replace(lower(coalesce(p_name,'')), '[^a-z0-9]+', '_', 'g')), ''), 'campaign'), 60)
         || '_' || left(replace(p_id::text, '-', ''), 6) $$;

-- {{1}} first name · {{2}} the update · {{3}} link — never starts or ends with a variable (Meta rule)
create or replace function public.wa_template_body_for(p_name text, p_brand text)
returns text language sql immutable set search_path = '' as $$
  select 'Hi {{1}}, here is an update on your ' || left(regexp_replace(coalesce(nullif(btrim(p_name),''),'campaign'), '[{}\n\r\t*_~]+', ' ', 'g'), 60)
      || case when nullif(btrim(p_brand),'') is not null then ' campaign with ' || left(regexp_replace(btrim(p_brand), '[{}\n\r\t*_~]+', ' ', 'g'), 40) else ' campaign' end
      || ': {{2}}' || chr(10) || chr(10) || 'Open the app to see details and next steps: {{3}} — thank you!' $$;

create or replace function public.tg_campaign_wa_template()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  begin
    insert into public.wa_campaign_templates(campaign_id, template_name, body)
    values (new.id, public.wa_template_name_for(new.name, new.id), public.wa_template_body_for(new.name, new.brand))
    on conflict (campaign_id) do nothing;
    perform private.ci_kick_worker('wa-template-sync');
  exception when others then raise warning 'wa template queue skipped for %: %', new.id, sqlerrm; end;
  return new;
end $$;
revoke all on function public.tg_campaign_wa_template() from public, anon, authenticated;
drop trigger if exists campaign_wa_template on public.campaigns;
create trigger campaign_wa_template after insert on public.campaigns
  for each row execute function public.tg_campaign_wa_template();

-- campaigns already running get one too
insert into public.wa_campaign_templates(campaign_id, template_name, body)
select c.id, public.wa_template_name_for(c.name, c.id), public.wa_template_body_for(c.name, c.brand)
  from public.campaigns c where coalesce(c.status,'') not in ('Completed')
on conflict (campaign_id) do nothing;

-- worker API (service role)
create or replace function api.wa_templates_claim(p_limit int default 20)
returns setof public.wa_campaign_templates language sql security definer set search_path = '' as $$
  update public.wa_campaign_templates t set attempts = attempts + 1, updated_at = now()
   where t.campaign_id in (select campaign_id from public.wa_campaign_templates
                            where status in ('queued','submitted') or (status = 'failed' and attempts < 5)
                            order by updated_at limit greatest(p_limit,1) for update skip locked)
  returning t.* $$;
create or replace function api.wa_templates_set(p_campaign uuid, p_status text, p_provider text default null, p_ref text default null, p_error text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_old text;
begin
  select status into v_old from public.wa_campaign_templates where campaign_id = p_campaign;
  update public.wa_campaign_templates set status = p_status, provider = coalesce(p_provider, provider),
         provider_ref = coalesce(p_ref, provider_ref), error = p_error, updated_at = now()
   where campaign_id = p_campaign;
  if p_status = 'approved' and v_old is distinct from 'approved' then perform api.ops_outbox_requeue_waiting(); end if;
end $$;
revoke all on function api.wa_templates_claim(int) from public, anon, authenticated;
revoke all on function api.wa_templates_set(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function api.wa_templates_claim(int), api.wa_templates_set(uuid, text, text, text, text) to service_role;

-- which approved template (if any) the dispatcher uses for an outbox row
create or replace function api.ops_wa_template_for(p_campaign uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select (select jsonb_build_object('name', t.template_name, 'lang', t.language)
            from intel.ci_campaign c join public.wa_campaign_templates t on t.campaign_id = c.legacy_campaign_id
           where c.campaign_id = p_campaign and t.status = 'approved') $$;
revoke all on function api.ops_wa_template_for(uuid) from public, anon, authenticated;
grant execute on function api.ops_wa_template_for(uuid) to service_role;

-- held messages (template pending OR 24h window closed) go again once something can carry them
create or replace function api.ops_outbox_requeue_waiting()
returns int language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  update intel.ci_outbox set status = 'queued', attempts = 0
   where status = 'skipped' and channel = 'whatsapp'
     and (last_error like 'Waiting for WhatsApp template approval%' or last_error like 'WhatsApp 24h window closed%')
     and updated_at < now() - interval '10 minutes' and created_at > now() - interval '3 days';
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function api.ops_outbox_requeue_waiting() from public, anon, authenticated;
grant execute on function api.ops_outbox_requeue_waiting() to service_role;

-- Super Admin: see every campaign template and mark one approved by hand (e.g. created in the snapto dashboard)
create or replace function public.admin_wa_templates()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then raise exception 'not a platform admin' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('campaign_id', t.campaign_id, 'campaign', c.name, 'brand', c.brand,
           'template_name', t.template_name, 'body', t.body, 'footer', t.footer, 'status', t.status, 'provider', t.provider,
           'error', t.error, 'updated_at', t.updated_at) order by t.created_at desc)
    from public.wa_campaign_templates t join public.campaigns c on c.id = t.campaign_id), '[]'::jsonb);
end $$;
create or replace function public.admin_wa_template_set(p_campaign uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then raise exception 'not a platform admin' using errcode = '42501'; end if;
  if p_status not in ('queued','approved','manual') then raise exception 'invalid status' using errcode = '22023'; end if;
  perform api.wa_templates_set(p_campaign, p_status, case when p_status = 'approved' then 'manual' end, null, null);
  if p_status = 'queued' then
    update public.wa_campaign_templates set attempts = 0 where campaign_id = p_campaign;
    perform private.ci_kick_worker('wa-template-sync');
  end if;
end $$;
revoke all on function public.admin_wa_templates() from public, anon;
revoke all on function public.admin_wa_template_set(uuid, text) from public, anon;
grant execute on function public.admin_wa_templates(), public.admin_wa_template_set(uuid, text) to authenticated;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('ci-wa-templates', '*/5 * * * *', $c$select private.ci_kick_worker('wa-template-sync')$c$);
  end if;
exception when others then raise notice 'cron schedule skipped: %', sqlerrm;
end $$;
