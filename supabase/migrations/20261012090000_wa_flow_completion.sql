-- WhatsApp flow completion. ADDITIVE + DARK (every send path is still gated by operational_pilot / secrets).
-- Closes the gaps that kept the WhatsApp loop from working end-to-end:
--   1. Workers could not reach intel.* — the runbook (correctly) never exposes intel to PostgREST, so the
--      dispatcher / reminder worker now go through service-role-only RPCs in the exposed `api` schema.
--   2. The outbox is claimed atomically (FOR UPDATE SKIP LOCKED) so overlapping cron runs never double-send,
--      and failed sends retry with backoff (3 attempts) instead of being dropped.
--   3. Repeat transitions (e.g. a second "changes requested") were silently de-duplicated away on WhatsApp +
--      email; the outbox now dedupes per notification row, which is the real idempotency unit.
--   4. System pushes are mirrored into a per-creator WhatsApp thread, so the creator's replies land in a
--      conversation that the creator and the agency operators can actually see (was: an orphan row nobody
--      could read under RLS).
--   5. wa_contacts could be written directly by clients (incl. verified_at) — a user could "verify" any number
--      and make the platform message it. Writes now go only through the OTP functions / an opt-out RPC.

-- ================= operators can see the WhatsApp inbox =================
create or replace function public.wa_is_operator()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(intel.ci_is_agency_operator(), false) $$;
revoke all on function public.wa_is_operator() from public, anon;
grant execute on function public.wa_is_operator() to authenticated, service_role;

drop policy if exists wa_conv_read on public.wa_conversations;
create policy wa_conv_read on public.wa_conversations for select to authenticated
  using (org_id = public.my_org() or created_by = auth.uid() or contact_user_id = auth.uid() or public.wa_is_operator());

drop policy if exists wa_msg_read on public.wa_messages;
create policy wa_msg_read on public.wa_messages for select to authenticated
  using (exists (select 1 from public.wa_conversations c where c.id = conversation_id
                 and (c.org_id = public.my_org() or c.created_by = auth.uid() or c.contact_user_id = auth.uid()
                      or public.wa_is_operator())));

-- ================= wa_contacts: read-only to clients; opt-out via RPC =================
drop policy if exists wa_contacts_own on public.wa_contacts;
create policy wa_contacts_own_read on public.wa_contacts for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete on public.wa_contacts from authenticated;

create or replace function public.wa_set_opt_out(p_opt_out boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); r public.wa_contacts%rowtype;
begin
  if v_uid is null then raise exception 'unauthenticated' using errcode='28000'; end if;
  update public.wa_contacts
     set opt_out_at = case when p_opt_out then now() else null end,
         opt_in_at  = case when p_opt_out then opt_in_at else now() end
   where user_id = v_uid returning * into r;
  if not found then raise exception 'no verified WhatsApp number on this account' using errcode='P0002'; end if;
  return jsonb_build_object('phone_e164', r.phone_e164, 'opted_out', r.opt_out_at is not null);
end $$;
revoke all on function public.wa_set_opt_out(boolean) from public, anon;
grant execute on function public.wa_set_opt_out(boolean) to authenticated;

-- the per-creator system thread that campaign pushes are mirrored into (org-less; visible to the creator via
-- contact_user_id and to operators via wa_is_operator). Inbound replies match it by phone.
create or replace function public.wa_system_conversation(p_user uuid, p_phone text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  select id into v_id from public.wa_conversations
   where contact_phone_e164 = p_phone and org_id is null and campaign_id is null
   order by last_message_at desc nulls last limit 1;
  if v_id is null then
    insert into public.wa_conversations(org_id, subject, contact_phone_e164, contact_user_id)
      values (null, 'Campaign updates', p_phone, p_user) returning id into v_id;
  elsif p_user is not null then
    update public.wa_conversations set contact_user_id = p_user where id = v_id and contact_user_id is null;
  end if;
  return v_id;
end $$;
revoke all on function public.wa_system_conversation(uuid,text) from public, anon, authenticated;
grant execute on function public.wa_system_conversation(uuid,text) to service_role;

-- ================= ci_notify: dedupe per notification + carry the deep-link route =================
create or replace function intel.ci_notify(p_recipient uuid, p_campaign uuid, p_participation uuid, p_key text, p_vars jsonb default '{}')
returns uuid language plpgsql security definer set search_path = '' as $$
declare t intel.ci_notification_template%rowtype; v_title text; v_body text; v_route text; v_label text;
        v_kind text; v_nid uuid; v_email text; v_wa text; v_dedupe text;
begin
  if p_recipient is null then return null; end if;
  if not intel.ci_feature_enabled('operational_pilot') then return null; end if;   -- dark gate
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

  -- one external send per notification row: repeat transitions (changes_requested twice) each go out
  select email into v_email from auth.users where id=p_recipient;
  if v_email is not null and v_email <> '' and v_email not like '%@creators.bountythreads.app' then
    insert into intel.ci_outbox(channel, recipient_member_id, to_address, campaign_id, participation_id, notification_id, template_key, payload, dedupe_key)
      values ('email', p_recipient, v_email, p_campaign, p_participation, v_nid, p_key,
        jsonb_build_object('subject',v_title,'html',v_body,'action_route',v_route,'action_label',v_label), v_nid::text)
      on conflict (channel, dedupe_key) where dedupe_key is not null do nothing;
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

-- reminders: lock the due rows so two overlapping worker runs never fire the same reminder twice
create or replace function intel.ci_run_due_reminders(p_limit int default 200)
returns int language plpgsql security definer set search_path = '' as $$
declare r record; v_identity uuid; v_infl uuid; v_name text; v_n int := 0;
begin
  if not intel.ci_feature_enabled('operational_pilot') then return 0; end if;
  for r in select * from intel.ci_reminder
            where due_at <= now() and fired_at is null and cancelled_at is null
            order by due_at limit greatest(p_limit,1)
            for update skip locked loop
    select p.identity_id, c.name into v_identity, v_name
      from intel.ci_campaign_participation p join intel.ci_campaign c on c.campaign_id=p.campaign_id
      where p.participation_id = r.participation_id;
    v_infl := intel.ci_member_of_identity(v_identity);
    perform intel.ci_notify(v_infl, r.campaign_id, r.participation_id, r.template_key,
      jsonb_build_object('campaign', coalesce(v_name,'your campaign'), 'participation_id', coalesce(r.participation_id::text,'')));
    update intel.ci_reminder set fired_at = now() where reminder_id = r.reminder_id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function intel.ci_run_due_reminders(int) from public, anon, authenticated;
grant execute on function intel.ci_run_due_reminders(int) to service_role;

-- ================= worker RPCs (api schema, service_role only) =================

-- claim up to p_limit sendable outbox rows: fresh 'queued', 'failed' under 3 attempts after a backoff of
-- 5 min × attempts, and 'sending' rows stuck > 10 min (a crashed run). Claimed rows flip to 'sending'.
create or replace function api.ops_outbox_claim(p_limit int default 50)
returns setof jsonb language plpgsql security definer set search_path = '' as $$
begin
  return query
  with c as (
    select o.outbox_id from intel.ci_outbox o
     where o.status = 'queued'
        or (o.status = 'failed'  and o.attempts < 3 and o.updated_at < now() - make_interval(mins => 5 * o.attempts))
        or (o.status = 'sending' and o.updated_at < now() - interval '10 minutes')
     order by o.created_at
     limit greatest(p_limit, 1)
     for update skip locked
  )
  update intel.ci_outbox o set status = 'sending', attempts = o.attempts + 1
    from c where o.outbox_id = c.outbox_id
  returning to_jsonb(o.*);
end $$;
revoke all on function api.ops_outbox_claim(int) from public, anon, authenticated;
grant execute on function api.ops_outbox_claim(int) to service_role;

create or replace function api.ops_outbox_complete(p_outbox_id uuid, p_status text, p_provider_ref text default null, p_error text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('sent','failed','skipped') then raise exception 'bad status %', p_status using errcode='22023'; end if;
  update intel.ci_outbox
     set status = p_status, provider_ref = coalesce(p_provider_ref, provider_ref), last_error = p_error,
         sent_at = case when p_status = 'sent' then now() else sent_at end
   where outbox_id = p_outbox_id;
end $$;
revoke all on function api.ops_outbox_complete(uuid,text,text,text) from public, anon, authenticated;
grant execute on function api.ops_outbox_complete(uuid,text,text,text) to service_role;

create or replace function api.ops_run_due_reminders(p_limit int default 200)
returns int language sql security definer set search_path = '' as $$ select intel.ci_run_due_reminders(p_limit) $$;
revoke all on function api.ops_run_due_reminders(int) from public, anon, authenticated;
grant execute on function api.ops_run_due_reminders(int) to service_role;
