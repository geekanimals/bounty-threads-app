-- WhatsApp delivery fixes (end-to-end audit). ADDITIVE.
--  1) private.ci_kick_worker only allowed the dispatcher + reminder worker, so every kick of 'wa-template-sync'
--     (new campaign + 5-minute cron) and 'ig-discover-worker' silently did nothing → per-campaign templates were
--     never submitted. Both are now allowed.
--  2) Only numbers verified through WhatsApp OTP (public.wa_contacts) received updates. A member whose number is
--     on the account (members.whatsapp_e164 / auth phone) now gets them too; the number is recorded as a
--     (not-OTP-verified) wa_contacts row so STOP / the unsubscribe link work for it as well.
--  3) Meta reports many failures AFTER accepting a message (24h window, template problems, number not on
--     WhatsApp). Those came back only to wa_messages, so the outbox said "sent". The webhook now writes them
--     back to the outbox: window/template problems are held and re-sent on the template; the rest show the
--     real reason under Super Admin → Delivery.

-- 1) ---------------------------------------------------------------------------------------------------
create or replace function private.ci_kick_worker(p_fn text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_secret text; v_url text;
begin
  if p_fn not in ('ops-notify-dispatch','ops-reminder-worker','wa-template-sync','ig-discover-worker') then return null; end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'ci_worker_secret' limit 1;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'ci_project_url' limit 1;
  if v_secret is null or v_url is null then return null; end if;
  return net.http_post(url := v_url || '/functions/v1/' || p_fn, body := '{}'::jsonb,
                       headers := jsonb_build_object('Content-Type','application/json','x-worker-secret', v_secret),
                       timeout_milliseconds := 25000);
exception when others then
  raise warning 'ci_kick_worker(%) skipped: %', p_fn, sqlerrm; return null;
end $$;
revoke all on function private.ci_kick_worker(text) from public, anon, authenticated;

-- 2) ---------------------------------------------------------------------------------------------------
-- best WhatsApp number for a member (null = none / opted out). Pure lookup.
create or replace function intel.ci_wa_lookup(p_member uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare r public.wa_contacts%rowtype; v text;
begin
  if p_member is null then return null; end if;
  select * into r from public.wa_contacts where user_id = p_member;
  if found then
    if r.opt_out_at is not null then return null; end if;
    return r.phone_e164;
  end if;
  select nullif(btrim(m.whatsapp_e164), '') into v from public.members m where m.id = p_member;
  if v is null then
    select case when coalesce(u.phone, '') <> '' then '+' || regexp_replace(u.phone, '\D', '', 'g') end into v
      from auth.users u where u.id = p_member;
  end if;
  if v is not null and v !~ '^\+' then v := '+' || regexp_replace(v, '\D', '', 'g'); end if;
  if v is null or v !~ '^\+[1-9][0-9]{7,15}$' then return null; end if;
  return v;
end $$;
revoke all on function intel.ci_wa_lookup(uuid) from public, anon, authenticated;

-- same, and remembers a fallback number in wa_contacts (so STOP / unsubscribe can switch it off)
create or replace function intel.ci_wa_number(p_member uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v text := intel.ci_wa_lookup(p_member);
begin
  if v is not null and not exists (select 1 from public.wa_contacts where user_id = p_member) then
    begin
      insert into public.wa_contacts(user_id, phone_e164, opt_in_at) values (p_member, v, now())
      on conflict do nothing;
    exception when others then null; end;
    -- the same number already belongs to another account → don't message it on this one's behalf
    if not exists (select 1 from public.wa_contacts where user_id = p_member) then return null; end if;
  end if;
  return v;
end $$;
revoke all on function intel.ci_wa_number(uuid) from public, anon, authenticated;

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

  v_wa := intel.ci_wa_number(p_recipient);
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

-- Super Admin card: "no number" now means no number anywhere on the account
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
    'failed', (select count(*) from intel.ci_outbox where channel = 'whatsapp' and status = 'failed' and created_at > now() - interval '3 days'),
    'sent', (select count(*) from intel.ci_outbox where channel = 'whatsapp' and status = 'sent' and created_at > now() - interval '3 days'),
    'last_error', (select last_error from intel.ci_outbox where channel = 'whatsapp' and status in ('failed','skipped')
                    and coalesce(last_error,'') !~* 'opted out|unsubscribed' order by updated_at desc limit 1),
    'no_number', (select count(distinct n.recipient_member_id) from intel.ci_notification n where n.created_at > now() - interval '3 days'
                   and intel.ci_wa_lookup(n.recipient_member_id) is null),
    'opted_out', (select count(*) from public.wa_contacts where opt_out_at is not null));
end $$;

-- 3) ---------------------------------------------------------------------------------------------------
-- webhook → outbox: Meta's late verdict on a message we already handed over
create or replace function api.ops_outbox_wa_status(p_ref text, p_status text, p_code int default null, p_error text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_msg text := left(coalesce(nullif(p_error,''), 'failed') || coalesce(' (#' || p_code || ')', ''), 280);
begin
  if p_ref is null or p_status is distinct from 'failed' then return; end if;
  if p_code = 131047 or v_msg ~* 're-?engagement|24 ?hour|customer service window' then
    -- free text landed outside the 24h window: send it again, this time on the approved template
    update intel.ci_outbox set status = 'queued', attempts = 0, payload = payload || '{"force_template":true}'::jsonb,
           last_error = 'Re-sending on the approved template · ' || v_msg
     where provider_ref = p_ref and channel = 'whatsapp' and not coalesce((payload->>'force_template')::boolean, false);
    update intel.ci_outbox set status = 'failed', attempts = 3, last_error = 'WhatsApp: ' || v_msg
     where provider_ref = p_ref and channel = 'whatsapp' and coalesce((payload->>'force_template')::boolean, false) and status = 'sent';
    perform private.ci_kick_worker('ops-notify-dispatch');
  elsif p_code between 132000 and 132999 or v_msg ~* 'template' then
    update intel.ci_outbox set status = 'skipped', attempts = 0,
           last_error = 'Waiting for WhatsApp template approval — ' || v_msg
     where provider_ref = p_ref and channel = 'whatsapp';
  else
    update intel.ci_outbox set status = 'failed', attempts = 3, last_error = 'WhatsApp: ' || v_msg
     where provider_ref = p_ref and channel = 'whatsapp';
  end if;
end $$;
revoke all on function api.ops_outbox_wa_status(text, text, int, text) from public, anon, authenticated;
grant execute on function api.ops_outbox_wa_status(text, text, int, text) to service_role;

-- catch-up: campaign templates that never got submitted, and recent WhatsApp updates that never went out
update public.wa_campaign_templates set attempts = 0, updated_at = now() where status in ('queued','failed');
update intel.ci_outbox set status = 'queued', attempts = 0
 where channel = 'whatsapp' and status in ('failed','skipped') and created_at > now() - interval '3 days'
   and coalesce(last_error,'') !~* 'opted out|unsubscribed';
select private.ci_kick_worker('wa-template-sync');
