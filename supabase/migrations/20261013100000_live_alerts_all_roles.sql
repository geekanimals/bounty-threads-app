-- Live alerts for EVERY role (Super Admin, agency owner, brand, creator) in the top-right bell. ADDITIVE.
-- In-app alerts only for platform/admin events (no WhatsApp/email spam); creator campaign steps keep using
-- intel.ci_notify (in-app + WhatsApp + email). Every trigger is fail-safe: an alert can never block a write.

create or replace function intel.ci_alert(p_recipient uuid, p_title text, p_body text, p_route text,
                                          p_label text default 'Open', p_kind text default 'info')
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_recipient is null then return; end if;
  insert into intel.ci_notification(recipient_member_id, kind, title, body, action_route, action_label, dedupe_key)
  values (p_recipient, case when p_kind = 'action_required' then 'action_required' else 'info' end,
          left(p_title, 200), left(coalesce(p_body, ''), 500), p_route, p_label, 'alert:' || gen_random_uuid()::text);
end $$;
revoke all on function intel.ci_alert(uuid, text, text, text, text, text) from public, anon, authenticated;

create or replace function intel.ci_alert_admins(p_title text, p_body text, p_route text, p_label text default 'Open', p_kind text default 'info', p_except uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in select user_id from public.platform_admins where p_except is null or user_id <> p_except loop
    perform intel.ci_alert(r.user_id, p_title, p_body, p_route, p_label, p_kind);
  end loop;
end $$;
revoke all on function intel.ci_alert_admins(text, text, text, text, text, uuid) from public, anon, authenticated;

create or replace function intel.ci_alert_org(p_org uuid, p_title text, p_body text, p_route text, p_label text default 'Open', p_kind text default 'info', p_except uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if p_org is null then return; end if;
  for r in select id from public.members
            where org_id = p_org and role in ('owner','brand','manager','corporate') and coalesce(status,'active') = 'active'
              and (p_except is null or id <> p_except) loop
    perform intel.ci_alert(r.id, p_title, p_body, p_route, p_label, p_kind);
  end loop;
end $$;
revoke all on function intel.ci_alert_org(uuid, text, text, text, text, text, uuid) from public, anon, authenticated;

-- ---- accounts: signups → Super Admin; approval → the agency / brand ----
create or replace function public.tg_alert_members()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  begin
    if TG_OP = 'INSERT' then
      if NEW.role in ('owner','brand','manager','corporate') and NEW.status = 'pending' then
        perform intel.ci_alert_admins('New ' || case NEW.role when 'brand' then 'brand' else 'agency' end || ' signup: ' || coalesce(nullif(NEW.org_name,''), NEW.name, 'new account'),
          'Waiting for your approval.', 'admin:approvals', 'Review', 'action_required');
      elsif NEW.role = 'creator' then
        perform intel.ci_alert_admins('New creator joined', coalesce(nullif(NEW.name,''), 'A creator') || ' signed up.', 'admin:users', 'View');
      end if;
    elsif TG_OP = 'UPDATE' and OLD.status = 'pending' and NEW.status = 'active' then
      perform intel.ci_alert(NEW.id, 'Your account is approved 🎉', 'Welcome to Geek Influencer OS — you can now create campaigns.', 'dashboard', 'Open dashboard', 'action_required');
    end if;
  exception when others then raise warning 'member alert skipped: %', sqlerrm; end;
  return NEW;
end $$;
revoke all on function public.tg_alert_members() from public, anon, authenticated;
drop trigger if exists alert_members on public.members;
create trigger alert_members after insert or update of status on public.members
  for each row execute function public.tg_alert_members();

-- ---- campaigns: new / awaiting approval → Super Admin; approved → the owning agency / brand ----
create or replace function public.tg_alert_campaigns()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_who text;
begin
  begin
    v_who := coalesce(nullif(NEW.org_name,''), 'a workspace');
    if NEW.status = 'Approval' and (TG_OP = 'INSERT' or OLD.status is distinct from NEW.status) then
      perform intel.ci_alert_admins('Campaign awaiting approval: ' || coalesce(NEW.name,'Campaign'), 'From ' || v_who || '.', 'admin:campaigns', 'Review', 'action_required', auth.uid());
    elsif TG_OP = 'INSERT' then
      perform intel.ci_alert_admins('New campaign: ' || coalesce(NEW.name,'Campaign'), 'Created by ' || v_who || ' · ' || coalesce(NEW.status,'Draft') || '.', 'admin:campaigns', 'View', 'info', auth.uid());
    elsif OLD.status = 'Approval' and NEW.status in ('Sourcing','Live','In Production') then
      perform intel.ci_alert_org(NEW.org_id, 'Campaign approved: ' || coalesce(NEW.name,'Campaign'), 'It is now open — creators can apply.', 'campaigns', 'Open', 'info', auth.uid());
    elsif OLD.status is distinct from NEW.status then
      perform intel.ci_alert_org(NEW.org_id, 'Campaign status: ' || coalesce(NEW.name,'Campaign') || ' → ' || coalesce(NEW.status,''), 'Updated just now.', 'campaigns', 'Open', 'info', auth.uid());
    end if;
  exception when others then raise warning 'campaign alert skipped: %', sqlerrm; end;
  return NEW;
end $$;
revoke all on function public.tg_alert_campaigns() from public, anon, authenticated;
drop trigger if exists alert_campaigns on public.campaigns;
create trigger alert_campaigns after insert or update of status on public.campaigns
  for each row execute function public.tg_alert_campaigns();

-- ---- creator applications (pipeline): the whole owning team + Super Admin; decisions → Super Admin feed ----
create or replace function intel.tg_alert_participation()
returns trigger language plpgsql security definer set search_path = '' as $$
declare c record; v_identity uuid; v_who text;
begin
  if NEW.entity <> 'participation' then return null; end if;
  begin
    select campaign_id, name, org_id, created_by into c from intel.ci_campaign where campaign_id = NEW.campaign_id;
    select identity_id into v_identity from intel.ci_campaign_participation where participation_id = NEW.participation_id;
    v_who := coalesce('@' || nullif(intel.ci_public_creator_card(v_identity)->>'username',''), 'A creator');
    if NEW.to_status = 'applied' then
      -- campaign creator already gets 'applied_received' from the spine; the rest of the team + admins get it here
      perform intel.ci_alert_org(c.org_id, 'New application: ' || coalesce(c.name,'campaign'), v_who || ' applied. Approve or decline in Approvals.', 'approvals', 'Review', 'action_required', c.created_by);
      perform intel.ci_alert_admins('New application: ' || coalesce(c.name,'campaign'), v_who || ' applied.', 'admin:applications', 'View', 'info', c.created_by);
    elsif NEW.to_status in ('brand_confirmed','ineligible','brand_declined') then
      perform intel.ci_alert_admins(case when NEW.to_status = 'brand_confirmed' then 'Creator approved: ' else 'Creator declined: ' end || coalesce(c.name,'campaign'),
        v_who || case when NEW.to_status = 'brand_confirmed' then ' was approved.' else ' was declined.' end, 'admin:applications', 'View', 'info', NEW.actor_member_id);
    elsif NEW.to_status = 'content_submitted' then
      perform intel.ci_alert_org(c.org_id, 'Content submitted: ' || coalesce(c.name,'campaign'), v_who || ' submitted content for review.', 'campaigns', 'Open', 'action_required', c.created_by);
    elsif NEW.to_status = 'published' then
      perform intel.ci_alert_org(c.org_id, 'Content is live: ' || coalesce(c.name,'campaign'), v_who || ' published the post.', 'reports', 'See report', 'info', c.created_by);
    end if;
  exception when others then raise warning 'participation alert skipped: %', sqlerrm; end;
  return null;
end $$;
revoke all on function intel.tg_alert_participation() from public, anon, authenticated;
drop trigger if exists ci_event_alert_all on intel.ci_campaign_event;
create trigger ci_event_alert_all after insert on intel.ci_campaign_event
  for each row execute function intel.tg_alert_participation();

-- ---- legacy marketplace applications ----
create or replace function public.tg_alert_applications()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  begin
    if TG_OP = 'INSERT' then
      perform intel.ci_alert_org(NEW.agency_org_id, 'New application: ' || coalesce(NEW.campaign_name,'campaign'), coalesce(NEW.creator_name,'A creator') || ' applied.', 'approvals', 'Review', 'action_required');
      perform intel.ci_alert_admins('New application: ' || coalesce(NEW.campaign_name,'campaign'), coalesce(NEW.creator_name,'A creator') || ' applied (marketplace).', 'admin:applications', 'View');
    end if;
  exception when others then raise warning 'application alert skipped: %', sqlerrm; end;
  return NEW;
end $$;
revoke all on function public.tg_alert_applications() from public, anon, authenticated;
drop trigger if exists alert_applications on public.applications;
create trigger alert_applications after insert on public.applications
  for each row execute function public.tg_alert_applications();

-- ---- bell: mark everything read in one tap ----
create or replace function api.mark_all_notifications_read()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  update intel.ci_notification set read_at = now() where recipient_member_id = auth.uid() and read_at is null;
  get diagnostics v_n = row_count;
  return jsonb_build_object('marked', v_n);
end $$;
revoke all on function api.mark_all_notifications_read() from public, anon;
grant execute on function api.mark_all_notifications_read() to authenticated;

-- bell list: newest 60 (unread first-class via the badge), cheap enough to poll
create or replace function api.get_my_notifications(p_only_unread boolean default false)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  v_uid := auth.uid(); if v_uid is null then raise exception 'unauthenticated' using errcode='28000'; end if;
  return coalesce((select jsonb_agg(x order by (x->>'created_at') desc) from (
    select jsonb_build_object(
      'notification_id', n.notification_id, 'campaign_id', n.campaign_id, 'participation_id', n.participation_id,
      'kind', n.kind, 'title', n.title, 'body', n.body, 'action_route', n.action_route, 'action_label', n.action_label,
      'read', n.read_at is not null, 'acted', n.acted_at is not null, 'created_at', n.created_at) x
    from intel.ci_notification n
    where n.recipient_member_id = v_uid and (not p_only_unread or n.read_at is null)
    order by n.created_at desc limit 60) s), '[]'::jsonb);
end $$;
