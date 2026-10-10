-- Phase 1 (barter pipeline) — notification spine. ADDITIVE + DARK.
-- On every participation/shipment transition the app auto-pushes a 1:1 message to the right person across
-- three channels — in-app inbox + WhatsApp + email — each carrying a deep link to the pending action, and
-- schedules SLA reminders (e.g. submit video within 3 days) that auto-cancel when the awaited event arrives.
-- The channel send-out is done by the ops-notify-dispatch / ops-reminder-worker edge functions (service role).
-- Fully dark: the trigger no-ops unless operational_pilot is enabled, and in production ci_campaign_event only
-- gets rows from the already-gated ops RPCs. Nothing here touches the intelligence models.

-- ================= tables =================

-- editable copy per transition (kept out of code so ops can tune wording without a migration)
create table if not exists intel.ci_notification_template (
  template_key     text primary key,
  kind             text not null default 'info' check (kind in ('info','action_required')),
  title            text not null,
  body_md          text not null,
  action_route     text,                -- app nav key / deep link the CTA opens (e.g. 'mycampaigns')
  action_label     text default 'Open',
  wa_template_name text,                -- approved WhatsApp template for out-of-24h-window sends (nullable)
  active           boolean not null default true,
  updated_at       timestamptz not null default now()
);
alter table intel.ci_notification_template enable row level security;
revoke all on table intel.ci_notification_template from anon, authenticated;
grant select, insert, update on table intel.ci_notification_template to service_role;

-- per-recipient in-app inbox (the in-app channel). One row = one 1:1 message with a pending action.
create table if not exists intel.ci_notification (
  notification_id   uuid primary key default gen_random_uuid(),
  recipient_member_id uuid not null references auth.users(id) on delete cascade,
  campaign_id       uuid references intel.ci_campaign(campaign_id) on delete cascade,
  participation_id  uuid references intel.ci_campaign_participation(participation_id) on delete cascade,
  kind              text not null default 'info' check (kind in ('info','action_required')),
  title             text not null,
  body              text not null,
  action_route      text,
  action_label      text,
  dedupe_key        text,
  read_at           timestamptz,
  acted_at          timestamptz,
  created_at        timestamptz not null default now()
);
create index if not exists ci_notification_recipient_idx on intel.ci_notification(recipient_member_id, created_at desc);
create index if not exists ci_notification_unread_idx on intel.ci_notification(recipient_member_id) where read_at is null;
alter table intel.ci_notification enable row level security;
revoke all on table intel.ci_notification from anon, authenticated;
grant select on table intel.ci_notification to authenticated;             -- own rows only (policy below); writes via RPC
grant select, insert, update on table intel.ci_notification to service_role;
drop policy if exists ci_notification_own_read on intel.ci_notification;
create policy ci_notification_own_read on intel.ci_notification for select to authenticated
  using (recipient_member_id = auth.uid());

-- outbound dispatch queue for the external channels (WhatsApp, email). Service-role only.
create table if not exists intel.ci_outbox (
  outbox_id        uuid primary key default gen_random_uuid(),
  channel          text not null check (channel in ('whatsapp','email')),
  recipient_member_id uuid references auth.users(id) on delete set null,
  to_address       text not null,       -- E.164 phone or email
  campaign_id      uuid references intel.ci_campaign(campaign_id) on delete cascade,
  participation_id uuid references intel.ci_campaign_participation(participation_id) on delete cascade,
  notification_id  uuid references intel.ci_notification(notification_id) on delete set null,
  template_key     text,
  payload          jsonb not null default '{}'::jsonb,
  status           text not null default 'queued' check (status in ('queued','sending','sent','failed','skipped')),
  attempts         int not null default 0,
  last_error       text,
  provider_ref     text,
  dedupe_key       text,
  created_at       timestamptz not null default now(),
  sent_at          timestamptz,
  updated_at       timestamptz not null default now()
);
create index if not exists ci_outbox_pending_idx on intel.ci_outbox(status, created_at) where status='queued';
create unique index if not exists ci_outbox_dedupe_uq on intel.ci_outbox(channel, dedupe_key) where dedupe_key is not null;
alter table intel.ci_outbox enable row level security;   -- no client policy → service-role only
revoke all on table intel.ci_outbox from anon, authenticated;
grant select, insert, update on table intel.ci_outbox to service_role;
drop trigger if exists ci_outbox_updated_at on intel.ci_outbox;
create trigger ci_outbox_updated_at before update on intel.ci_outbox
  for each row execute function intel.tg_set_updated_at();

-- SLA reminders (e.g. submit video within 3 days). Auto-cancel when the participation reaches cancel_on_stage.
create table if not exists intel.ci_reminder (
  reminder_id      uuid primary key default gen_random_uuid(),
  participation_id uuid not null references intel.ci_campaign_participation(participation_id) on delete cascade,
  campaign_id      uuid references intel.ci_campaign(campaign_id) on delete cascade,
  kind             text not null,          -- e.g. 'video_due'
  template_key     text not null,
  due_at           timestamptz not null,
  cancel_on_stage  text,                   -- when the participation reaches this stage the reminder is void
  fired_at         timestamptz,
  cancelled_at     timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists ci_reminder_due_idx on intel.ci_reminder(due_at) where fired_at is null and cancelled_at is null;
alter table intel.ci_reminder enable row level security;   -- service-role only
revoke all on table intel.ci_reminder from anon, authenticated;
grant select, insert, update on table intel.ci_reminder to service_role;

-- ================= helpers =================

-- the app member who owns a creator identity (self actor-access)
create or replace function intel.ci_member_of_identity(p_identity uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select member_id from intel.ci_identity_actor_access
   where identity_id = p_identity and access_role = 'self' limit 1 $$;
revoke all on function intel.ci_member_of_identity(uuid) from public, anon, authenticated;
grant execute on function intel.ci_member_of_identity(uuid) to service_role;

-- {{token}} substitution from a flat jsonb of text values
create or replace function intel.ci_render(p_tmpl text, p_vars jsonb)
returns text language plpgsql immutable set search_path = '' as $$
declare k text; v text; out text := coalesce(p_tmpl,'');
begin
  if p_vars is null then return out; end if;
  for k, v in select key, value from jsonb_each_text(p_vars) loop
    out := replace(out, '{{'||k||'}}', coalesce(v,''));
  end loop;
  return out;
end $$;

-- enqueue a 1:1 notification: writes the in-app row and queues WhatsApp + email where the recipient is reachable
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

  select email into v_email from auth.users where id=p_recipient;
  if v_email is not null and v_email <> '' then
    insert into intel.ci_outbox(channel, recipient_member_id, to_address, campaign_id, participation_id, notification_id, template_key, payload, dedupe_key)
      values ('email', p_recipient, v_email, p_campaign, p_participation, v_nid, p_key,
        jsonb_build_object('subject',v_title,'html',v_body,'action_url',v_route,'action_label',v_label), v_dedupe)
      on conflict (channel, dedupe_key) where dedupe_key is not null do nothing;
  end if;

  select phone_e164 into v_wa from public.wa_contacts where user_id=p_recipient and verified_at is not null and opt_out_at is null;
  if v_wa is not null then
    insert into intel.ci_outbox(channel, recipient_member_id, to_address, campaign_id, participation_id, notification_id, template_key, payload, dedupe_key)
      values ('whatsapp', p_recipient, v_wa, p_campaign, p_participation, v_nid, p_key,
        jsonb_build_object('text', v_title||' — '||v_body, 'wa_template', t.wa_template_name, 'wa_vars', jsonb_build_array(coalesce(p_vars->>'campaign',''))), v_dedupe)
      on conflict (channel, dedupe_key) where dedupe_key is not null do nothing;
  end if;
  return v_nid;
end $$;
revoke all on function intel.ci_notify(uuid,uuid,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function intel.ci_notify(uuid,uuid,uuid,text,jsonb) to service_role;

-- fire all due, un-cancelled reminders: resolve the influencer, enqueue the reminder push, stamp fired_at.
-- Called by the ops-reminder-worker edge function on a schedule. Returns how many fired.
create or replace function intel.ci_run_due_reminders(p_limit int default 200)
returns int language plpgsql security definer set search_path = '' as $$
declare r record; v_identity uuid; v_infl uuid; v_name text; v_n int := 0;
begin
  if not intel.ci_feature_enabled('operational_pilot') then return 0; end if;
  for r in select * from intel.ci_reminder
            where due_at <= now() and fired_at is null and cancelled_at is null
            order by due_at limit greatest(p_limit,1) loop
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

-- ================= the auto-notify trigger (every transition → the right 1:1 push) =================
create or replace function intel.tg_ops_notify()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_infl uuid; v_oper uuid; v_identity uuid; v_name text; v_vars jsonb;
begin
  if not intel.ci_feature_enabled('operational_pilot') then return null; end if;

  select c.name, c.created_by into v_name, v_oper from intel.ci_campaign c where c.campaign_id = NEW.campaign_id;
  if NEW.participation_id is not null then
    select identity_id into v_identity from intel.ci_campaign_participation where participation_id = NEW.participation_id;
    v_infl := intel.ci_member_of_identity(v_identity);
  end if;
  v_vars := jsonb_build_object('campaign', coalesce(v_name,'your campaign'), 'participation_id', coalesce(NEW.participation_id::text,''));

  if NEW.entity = 'participation' then
    -- reminders auto-cancel when the awaited stage is reached
    update intel.ci_reminder set cancelled_at = now()
      where participation_id = NEW.participation_id and cancel_on_stage = NEW.to_status and fired_at is null and cancelled_at is null;

    case NEW.to_status
      when 'invited'          then perform intel.ci_notify(v_infl, NEW.campaign_id, NEW.participation_id, 'invited', v_vars);
      when 'applied'          then perform intel.ci_notify(v_oper, NEW.campaign_id, NEW.participation_id, 'applied_received', v_vars);
      when 'eligible'         then perform intel.ci_notify(v_oper, NEW.campaign_id, NEW.participation_id, 'eligible_ready', v_vars);
      when 'sent_to_brand'    then perform intel.ci_notify(v_oper, NEW.campaign_id, NEW.participation_id, 'sent_to_brand', v_vars);
      when 'brand_confirmed'  then perform intel.ci_notify(v_infl, NEW.campaign_id, NEW.participation_id, 'brand_confirmed', v_vars);
      when 'brand_declined'   then perform intel.ci_notify(v_oper, NEW.campaign_id, NEW.participation_id, 'brand_declined', v_vars);
      when 'contract_sent'    then perform intel.ci_notify(v_infl, NEW.campaign_id, NEW.participation_id, 'contract_sent', v_vars);
      when 'contract_signed'  then perform intel.ci_notify(v_infl, NEW.campaign_id, NEW.participation_id, 'confirm_address', v_vars);
      when 'address_confirmed'then perform intel.ci_notify(v_oper, NEW.campaign_id, NEW.participation_id, 'address_confirmed', v_vars);
      when 'product_sent'     then
        perform intel.ci_notify(v_infl, NEW.campaign_id, NEW.participation_id, 'product_shipped', v_vars);
        insert into intel.ci_reminder(participation_id, campaign_id, kind, template_key, due_at, cancel_on_stage)
          values (NEW.participation_id, NEW.campaign_id, 'video_due', 'video_due', now() + interval '3 days', 'content_submitted');
      when 'content_submitted' then perform intel.ci_notify(v_oper, NEW.campaign_id, NEW.participation_id, 'content_for_review', v_vars);
      when 'changes_requested' then perform intel.ci_notify(v_infl, NEW.campaign_id, NEW.participation_id, 'changes_requested', v_vars);
      when 'content_approved'  then perform intel.ci_notify(v_infl, NEW.campaign_id, NEW.participation_id, 'content_approved', v_vars);
      when 'published'        then perform intel.ci_notify(v_oper, NEW.campaign_id, NEW.participation_id, 'published', v_vars);
      when 'completed'        then perform intel.ci_notify(v_infl, NEW.campaign_id, NEW.participation_id, 'completed', v_vars);
      else null;
    end case;

  elsif NEW.entity = 'shipment' and NEW.to_status = 'delivered' then
    perform intel.ci_notify(v_infl, NEW.campaign_id, NEW.participation_id, 'parcel_received', v_vars);
    -- (re)start the 3-day video SLA from delivery
    if NEW.participation_id is not null then
      insert into intel.ci_reminder(participation_id, campaign_id, kind, template_key, due_at, cancel_on_stage)
        values (NEW.participation_id, NEW.campaign_id, 'video_due', 'video_due', now() + interval '3 days', 'content_submitted');
    end if;
  end if;
  return null;
end $$;
revoke all on function intel.tg_ops_notify() from public, anon, authenticated;
drop trigger if exists ci_event_notify on intel.ci_campaign_event;
create trigger ci_event_notify after insert on intel.ci_campaign_event
  for each row execute function intel.tg_ops_notify();

-- ================= inbox api (creator / operator facing) =================
create or replace function api.get_my_notifications(p_only_unread boolean default false)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  v_uid := auth.uid(); if v_uid is null then raise exception 'unauthenticated' using errcode='28000'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'notification_id', n.notification_id, 'campaign_id', n.campaign_id, 'participation_id', n.participation_id,
      'kind', n.kind, 'title', n.title, 'body', n.body, 'action_route', n.action_route, 'action_label', n.action_label,
      'read', n.read_at is not null, 'acted', n.acted_at is not null, 'created_at', n.created_at)
      order by n.created_at desc)
    from intel.ci_notification n
    where n.recipient_member_id = v_uid and (not p_only_unread or n.read_at is null)), '[]'::jsonb);
end $$;

create or replace function api.mark_notification_read(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  v_uid := auth.uid();
  update intel.ci_notification set read_at = coalesce(read_at, now())
    where notification_id = p_id and recipient_member_id = v_uid;
  if not found then raise exception 'notification not found' using errcode='42501'; end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function api.mark_notification_acted(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  v_uid := auth.uid();
  update intel.ci_notification set acted_at = coalesce(acted_at, now()), read_at = coalesce(read_at, now())
    where notification_id = p_id and recipient_member_id = v_uid;
  if not found then raise exception 'notification not found' using errcode='42501'; end if;
  return jsonb_build_object('ok', true);
end $$;

do $$ declare fn text; begin
  foreach fn in array array[
    'api.get_my_notifications(boolean)','api.mark_notification_read(uuid)','api.mark_notification_acted(uuid)'] loop
    execute 'revoke all on function '||fn||' from public, anon';
    execute 'grant execute on function '||fn||' to authenticated, service_role';
  end loop; end $$;

-- ================= seed the templates =================
insert into intel.ci_notification_template(template_key, kind, title, body_md, action_route, action_label) values
  ('invited','action_required','You''re invited to {{campaign}}','You have a new campaign invitation. Open the app to accept or decline.','mycampaigns','View invite'),
  ('applied_received','info','New application for {{campaign}}','A creator applied. Review their eligibility in the pipeline.','campaignops','Review'),
  ('eligible_ready','info','A creator is eligible for {{campaign}}','Ready to add to the brand shortlist.','campaignops','Open pipeline'),
  ('sent_to_brand','action_required','Shortlist ready for {{campaign}}','Creators are awaiting brand confirmation.','campaignops','Review shortlist'),
  ('brand_confirmed','action_required','You''re confirmed for {{campaign}} 🎉','The brand confirmed you. Review and sign your contract in the app.','mycampaigns','Review contract'),
  ('brand_declined','info','Update on {{campaign}}','The brand did not confirm this creator. See the reason in the pipeline.','campaignops','Open pipeline'),
  ('contract_sent','action_required','Sign your contract for {{campaign}}','Your contract is ready. Please review the ASCI terms and sign in the app.','mycampaigns','Sign contract'),
  ('confirm_address','action_required','Confirm your delivery address','Your contract is signed. Confirm the address we should ship the product to.','mycampaigns','Confirm address'),
  ('address_confirmed','info','Address confirmed for {{campaign}}','The creator confirmed their delivery address. Ready to ship.','campaignops','Open pipeline'),
  ('product_shipped','action_required','Your product is on the way for {{campaign}}','Once it arrives, submit your video within 3 days. Check the brief in the app.','mycampaigns','View brief'),
  ('parcel_received','action_required','Parcel delivered for {{campaign}}','Please create and submit your video within 3 days.','mycampaigns','Submit video'),
  ('content_for_review','action_required','A video is ready for review — {{campaign}}','A creator submitted their video. Review it against the brief.','campaignops','Review video'),
  ('changes_requested','action_required','Changes requested on your {{campaign}} video','Please review the feedback and resubmit your video in the app.','mycampaigns','View feedback'),
  ('content_approved','action_required','Your {{campaign}} video is approved','You can now post your reel and story from the app.','mycampaigns','Post now'),
  ('published','info','{{campaign}} content is live','A creator published their content. Tracking has started.','campaignops','Open pipeline'),
  ('completed','info','{{campaign}} complete — thank you!','Your participation is complete. Thank you for collaborating.','mycampaigns','View'),
  ('video_due','action_required','Reminder: submit your {{campaign}} video','Your video is due. Please submit it in the app to stay on the campaign.','mycampaigns','Submit video')
on conflict (template_key) do nothing;
