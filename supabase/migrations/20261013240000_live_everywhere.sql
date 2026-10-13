-- Everything the sidebar shows is live and correctly scoped, for every role:
--   · Super Admin reads every workspace (the last tables that were still org-only open up to platform admins)
--   · one Approvals inbox — signups, campaigns and creator applications in one place, each role seeing its own
--   · one live workspace summary so Dashboard, Brand CRM, Logistics, Finance and Reports read from real rows

-- ===================================================================================================
-- 1) Super Admin can read (and fix) the last org-scoped tables
-- ===================================================================================================
do $$ declare t text; begin
  foreach t in array array['members','invites','org_profiles','social_accounts','wa_conversations','wa_messages','activity_log'] loop
    if to_regclass('public.'||t) is not null then
      execute format('drop policy if exists "platform admin all %s" on public.%I', t, t);
      execute format('create policy "platform admin all %s" on public.%I for all to authenticated
                        using (public.is_platform_admin()) with check (public.is_platform_admin())', t, t);
    end if;
  end loop;
end $$;

-- ===================================================================================================
-- 2) One Approvals inbox for Super Admin, agency owners and brands
--    Agencies and brands see only their own workspace; Super Admin sees everything.
-- ===================================================================================================
create or replace function api.approvals_inbox()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_admin boolean; v_org uuid; v_role text;
begin
  if v_uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  v_admin := public.is_platform_admin();
  select org_id, role into v_org, v_role from public.members where id = v_uid;
  if not v_admin and coalesce(v_role,'') not in ('owner','brand','manager','corporate') then
    raise exception 'approvals are for agencies, brands and the Super Admin' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'is_admin', v_admin,
    -- agency / brand signups waiting for the Super Admin
    'signups', case when v_admin then coalesce((select jsonb_agg(jsonb_build_object(
          'id', m.id, 'name', coalesce(nullif(m.name,''), m.org_name), 'role', m.role, 'org_name', m.org_name,
          'email', coalesce(nullif(m.official_email,''), m.email, u.email::text),
          'email_verified', m.email_verified_at is not null,
          'whatsapp', coalesce(m.whatsapp_e164, case when coalesce(u.phone,'') <> '' then '+' || u.phone end),
          'created_at', coalesce(m.created_at, u.created_at)) order by coalesce(m.created_at, u.created_at))
        from public.members m join auth.users u on u.id = m.id
       where m.status = 'pending' and m.role <> 'creator'), '[]'::jsonb) else '[]'::jsonb end,
    -- campaigns waiting to go live
    'campaigns', coalesce((select jsonb_agg(jsonb_build_object(
          'id', c.id, 'name', c.name, 'brand', c.brand, 'org_name', c.org_name, 'campaign_type', c.campaign_type,
          'barter_subtype', c.barter_subtype, 'budget', c.budget, 'start_date', c.start_date, 'end_date', c.end_date,
          'created_at', c.created_at) order by c.created_at desc)
        from public.campaigns c
       where c.status = 'Approval' and (v_admin or (c.org_id is not null and c.org_id = v_org))), '[]'::jsonb),
    -- creators waiting on a decision (the real pipeline)
    'applicants', coalesce((select jsonb_agg(rr order by (rr->>'applied_at')) from (
        select jsonb_build_object('participation_id', p.participation_id, 'campaign_id', c.campaign_id,
                 'legacy_campaign_id', c.legacy_campaign_id, 'campaign_name', c.name, 'brand', c.submitted_brand_name,
                 'org_name', (select m2.org_name from public.members m2 where m2.org_id = c.org_id and m2.org_name is not null limit 1),
                 'campaign_type', coalesce(br.requirements->>'campaign_type',
                    case c.comp_type when 'cash' then 'paid' when 'hybrid' then 'barter_paid' when 'barter' then 'barter' end),
                 'stage', p.stage, 'applied_profile', p.applied_profile, 'applied_at', p.created_at,
                 'creator', intel.ci_public_creator_card(p.identity_id)) rr
          from intel.ci_campaign_participation p
          join intel.ci_campaign c on c.campaign_id = p.campaign_id
          left join lateral (select requirements from intel.ci_campaign_brief b where b.campaign_id = c.campaign_id order by b.created_at desc limit 1) br on true
         where p.stage in ('applied','eligible','sent_to_brand')
           and (v_admin or intel.ci_can_manage_campaign(c.campaign_id))
         order by p.created_at limit 200) s), '[]'::jsonb),
    -- older marketplace applications
    'marketplace', coalesce((select jsonb_agg(jsonb_build_object(
          'id', a.id, 'creator_name', a.creator_name, 'campaign_name', a.campaign_name,
          'org_name', a.org_name, 'created_at', a.created_at) order by a.created_at)
        from public.applications a
       where a.status = 'Applied' and (v_admin or a.org_id = v_org or a.agency_org_id = v_org)), '[]'::jsonb));
end $$;
revoke all on function api.approvals_inbox() from public, anon;
grant execute on function api.approvals_inbox() to authenticated;

-- agencies and brands approve their own campaigns; the Super Admin approves any
create or replace function api.decide_campaign(p_campaign uuid, p_approve boolean, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_admin boolean := public.is_platform_admin(); v_name text; v_owner uuid; v_status text;
begin
  select org_id, name into v_org, v_name from public.campaigns where id = p_campaign;
  if v_name is null then raise exception 'campaign not found' using errcode = '22023'; end if;
  if not v_admin and not exists (select 1 from public.members m where m.id = auth.uid() and m.org_id = v_org
                                   and m.role in ('owner','brand','manager') and coalesce(m.status,'active') = 'active') then
    raise exception 'not your campaign' using errcode = '42501';
  end if;
  v_status := case when p_approve then 'Sourcing' else 'Draft' end;
  update public.campaigns set status = v_status where id = p_campaign;
  insert into public.activity_log(member_id, kind, event, detail)
  values (auth.uid(), 'security', case when p_approve then 'campaign_approved' else 'campaign_rejected' end,
          jsonb_build_object('campaign_id', p_campaign, 'campaign', v_name, 'reason', nullif(btrim(coalesce(p_reason,'')),'')));
  return jsonb_build_object('status', v_status);
end $$;
revoke all on function api.decide_campaign(uuid, boolean, text) from public, anon;
grant execute on function api.decide_campaign(uuid, boolean, text) to authenticated;

-- ===================================================================================================
-- 3) One live summary behind Dashboard / Brand CRM / Logistics / Finance / Reports
--    Same shape for everyone; the rows are the caller's workspace, or all of them for the Super Admin.
-- ===================================================================================================
create or replace function api.workspace_live()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_admin boolean; v_org uuid; v_today timestamptz := date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
begin
  if v_uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  v_admin := public.is_platform_admin();
  select org_id into v_org from public.members where id = v_uid;

  return jsonb_build_object(
    'scope', case when v_admin then 'platform' else 'workspace' end,
    'updated_at', now(),
    'campaigns', (select jsonb_build_object(
        'total', count(*), 'live', count(*) filter (where status in ('Sourcing','Live','In Production')),
        'awaiting', count(*) filter (where status = 'Approval'), 'completed', count(*) filter (where status = 'Completed'),
        'paid', count(*) filter (where campaign_type = 'paid'), 'barter', count(*) filter (where campaign_type = 'barter'),
        'barter_paid', count(*) filter (where campaign_type = 'barter_paid'),
        'budget', coalesce(sum(budget), 0), 'starting_soon', count(*) filter (where start_date between current_date and current_date + 7))
      from public.campaigns c where v_admin or c.org_id = v_org),
    'creators', (select jsonb_build_object('roster', count(*),
        'added_today', count(*) filter (where created_at >= v_today))
      from public.creators c where v_admin or c.org_id = v_org),
    'applications', (select jsonb_build_object(
        'pending', count(*) filter (where p.stage in ('applied','eligible','sent_to_brand')),
        'invited', count(*) filter (where p.stage = 'invited'),
        'approved', count(*) filter (where p.stage not in ('applied','eligible','sent_to_brand','invited','shortlisted','ineligible','brand_declined','dropped','rejected')),
        'declined', count(*) filter (where p.stage in ('ineligible','brand_declined','dropped','rejected')),
        'completed', count(*) filter (where p.stage = 'completed'))
      from intel.ci_campaign_participation p join intel.ci_campaign c on c.campaign_id = p.campaign_id
      where v_admin or (c.org_id is not null and c.org_id = v_org)),
    'barter', (select jsonb_build_object('total', count(*),
        'shipped', count(*) filter (where lower(coalesce(stage,'')) in ('shipped','in transit','dispatched')),
        'delivered', count(*) filter (where lower(coalesce(stage,'')) = 'delivered'),
        'value', coalesce(sum(value), 0))
      from public.barter_items b where v_admin or b.org_id = v_org),
    'celebrity', (select jsonb_build_object('deals', count(*), 'value', coalesce(sum(value), 0), 'fees', coalesce(sum(fee), 0))
      from public.story_deals s where v_admin or s.org_id = v_org),
    'content', (select jsonb_build_object(
        'published', count(*) filter (where d.status = 'published'),
        'in_review', count(*) filter (where d.status = 'submitted'),
        'due_7d', count(*) filter (where d.status = 'expected' and d.expected_by between current_date and current_date + 7))
      from intel.ci_campaign_deliverable d join intel.ci_campaign_participation p on p.participation_id = d.participation_id
      join intel.ci_campaign c on c.campaign_id = p.campaign_id
      where v_admin or (c.org_id is not null and c.org_id = v_org)),
    'instagram', (select jsonb_build_object('connected', count(*), 'followers', coalesce(sum(followers_count), 0),
        'last_sync', max(updated_at))
      from public.social_accounts sa where sa.platform = 'instagram' and (v_admin or sa.org_id = v_org)),
    'messages', (select jsonb_build_object('threads', count(distinct c.id),
        'unread_24h', count(*) filter (where m.direction = 'inbound' and m.created_at > now() - interval '24 hours'))
      from public.wa_conversations c left join public.wa_messages m on m.conversation_id = c.id
      where v_admin or c.org_id = v_org),
    'discovery', (select jsonb_build_object('pool', count(*), 'tagged_you', count(*) filter (where sources @> array['tagged_brand']))
      from intel.ci_external_creator));
end $$;
revoke all on function api.workspace_live() from public, anon;
grant execute on function api.workspace_live() to authenticated;
