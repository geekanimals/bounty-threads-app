-- One creator, several Instagram accounts — every campaign shows the account the creator is on it WITH
-- (the one they applied with / the bulk sheet's handle), end to end: applicants, approvals, barter process, brand
-- shortlist, shipments, analytics, bulk upload. Not the account their Media Kit happens to have open.
-- ADDITIVE.

-- is this handle one of the member's connected Instagram accounts (active or kept in the vault)?
create or replace function intel.ci_member_has_handle(p_member uuid, p_handle text)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_member is not null and coalesce(p_handle,'') <> '' and (
    exists (select 1 from public.social_accounts s where s.member_id = p_member and s.platform = 'instagram' and lower(s.username) = lower(ltrim(p_handle,'@')))
    or exists (select 1 from private.ig_linked_accounts l where l.member_id = p_member and lower(coalesce(l.username, l.account->>'username')) = lower(ltrim(p_handle,'@')))) $$;
revoke all on function intel.ci_member_has_handle(uuid, text) from public, anon, authenticated;

-- the creator card for ONE of their accounts (falls back to the active account when the handle isn't theirs)
create or replace function intel.ci_public_creator_card(p_identity uuid, p_handle text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_base jsonb := intel.ci_public_creator_card(p_identity); v_h text := lower(ltrim(coalesce(p_handle,''),'@')); v_mid uuid; a jsonb;
begin
  if v_h = '' or lower(coalesce(v_base->>'username','')) = v_h then return v_base; end if;
  select x.member_id into v_mid from intel.ci_identity_actor_access x where x.identity_id = p_identity and x.access_role = 'self' and x.revoked_at is null limit 1;
  if v_mid is null then return v_base; end if;
  select l.account into a from private.ig_linked_accounts l
   where l.member_id = v_mid and lower(coalesce(l.username, l.account->>'username')) = v_h limit 1;
  if a is null then return v_base; end if;
  return v_base || jsonb_build_object('username', coalesce(a->>'username', v_h), 'name', coalesce(a->>'name', v_base->>'name'),
    'profile_picture_url', a->>'profile_picture_url', 'followers', nullif(a->>'followers_count','')::bigint,
    'avg_reach', nullif(a->>'avg_reach','')::numeric,
    'engagement', case when coalesce(nullif(a->>'followers_count','')::numeric,0) > 0 and jsonb_typeof(a->'recent_media') = 'array'
                            and jsonb_array_length(a->'recent_media') > 0 then
        round(100.0 * (select avg(coalesce((m2->>'like_count')::numeric,0) + coalesce((m2->>'comments_count')::numeric,0))
                         from jsonb_array_elements(a->'recent_media') m2) / (a->>'followers_count')::numeric, 2) end,
    'account', 'other');
end $$;
revoke all on function intel.ci_public_creator_card(uuid, text) from public, anon, authenticated;
grant execute on function intel.ci_public_creator_card(uuid, text) to service_role;

create or replace function intel.ci_find_creator(p_phone text, p_email text, p_handle text)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v uuid; v_digits text := ltrim(coalesce(p_phone,''), '+');
begin
  if p_handle is not null then
    select sa.member_id into v from public.social_accounts sa join public.members m on m.id = sa.member_id
     where sa.platform = 'instagram' and lower(sa.username) = p_handle and coalesce(m.role,'creator') = 'creator' limit 1;
    if v is not null then return v; end if;
    -- any other Instagram account the creator connected (kept in the vault)
    select l.member_id into v from private.ig_linked_accounts l join public.members m on m.id = l.member_id
     where lower(coalesce(l.username, l.account->>'username')) = p_handle and coalesce(m.role,'creator') = 'creator' limit 1;
    if v is not null then return v; end if;
  end if;
  if p_phone is not null then
    select w.user_id into v from public.wa_contacts w join public.members m on m.id = w.user_id
     where w.phone_e164 = p_phone and coalesce(m.role,'creator') = 'creator' limit 1;
    if v is not null then return v; end if;
    select m.id into v from public.members m where m.whatsapp_e164 = p_phone and coalesce(m.role,'creator') = 'creator' limit 1;
    if v is not null then return v; end if;
    select u.id into v from auth.users u join public.members m on m.id = u.id
     where u.phone = v_digits and coalesce(m.role,'creator') = 'creator' limit 1;
    if v is not null then return v; end if;
  end if;
  if p_email is not null then
    select u.id into v from auth.users u join public.members m on m.id = u.id
     where lower(u.email) = p_email and coalesce(m.role,'creator') = 'creator' limit 1;
    if v is not null then return v; end if;
    select a.member_id into v from private.creator_contact c
      join intel.ci_identity_actor_access a on a.identity_id = c.identity_id and a.access_role = 'self' and a.revoked_at is null
     where lower(c.email) = p_email limit 1;
    if v is not null then return v; end if;
  end if;
  if p_phone is not null then
    select a.member_id into v from private.creator_contact c
      join intel.ci_identity_actor_access a on a.identity_id = c.identity_id and a.access_role = 'self' and a.revoked_at is null
     where c.whatsapp_e164 = p_phone limit 1;
  end if;
  return v;
end $$;

-- from 20261013120000_creator_profile_v2.sql
create or replace function api.org_applicants(p_campaign uuid default null, p_stage text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_all boolean;
begin
  if v_uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  v_all := intel.ci_is_agency_operator();
  if p_campaign is not null and not intel.ci_can_manage_campaign(p_campaign) then
    raise exception 'not authorised for this campaign' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(rr order by (rr->>'applied_at') desc) from (
    select jsonb_build_object('participation_id', p.participation_id, 'campaign_id', c.campaign_id,
             'legacy_campaign_id', c.legacy_campaign_id, 'campaign_name', c.name,
             'brand', c.submitted_brand_name, 'comp_type', c.comp_type,
             'campaign_type', coalesce(br.requirements->>'campaign_type',
                                       case c.comp_type when 'cash' then 'paid' when 'hybrid' then 'barter_paid' when 'barter' then 'barter' end),
             'org_name', (select m.org_name from public.members m where m.org_id = c.org_id and m.org_name is not null limit 1),
             'stage', p.stage, 'reason', p.reason, 'reason_code', p.reason_code, 'applied_profile', p.applied_profile,
             'applied_at', p.created_at, 'updated_at', p.updated_at, 'creator', intel.ci_public_creator_card(p.identity_id, p.applied_profile)) rr
      from intel.ci_campaign_participation p join intel.ci_campaign c on c.campaign_id = p.campaign_id
      left join lateral (select requirements from intel.ci_campaign_brief b where b.campaign_id = c.campaign_id order by b.created_at desc limit 1) br on true
     where (p_campaign is null or c.campaign_id = p_campaign)
       and (p_stage is null or p.stage = p_stage)
       and (v_all or intel.ci_can_manage_campaign(c.campaign_id))
     order by p.created_at desc limit 1000) s), '[]'::jsonb);
end $$;

-- from 20261013240000_live_everywhere.sql
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
                 'creator', intel.ci_public_creator_card(p.identity_id, p.applied_profile)) rr
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

-- from 20261014190000_barter_flow_v3.sql
create or replace function api.barter_tracker(p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid := intel.ci_resolve_campaign(p_campaign);
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  if v_id is null or not intel.ci_can_manage_campaign(v_id) then raise exception 'not your campaign' using errcode = '42501'; end if;

  return jsonb_build_object(
    'campaign', (select jsonb_build_object('campaign_id', c.campaign_id, 'name', c.name, 'brand', c.submitted_brand_name,
                   'product', c.product, 'starts_on', c.starts_on, 'ends_on', c.ends_on, 'status', c.lifecycle_status)
                   from intel.ci_campaign c where c.campaign_id = v_id),
    'outreach_at', (select updated_at from intel.ci_campaign_outreach o where o.campaign_id = v_id),
    'playbook', intel.ci_playbook(v_id),
    'creators', coalesce((select jsonb_agg(row order by (row->>'applied_at')) from (
      select jsonb_build_object(
        'participation_id', p.participation_id, 'stage', p.stage, 'reason', p.reason,
        'applied_profile', p.applied_profile, 'applied_at', p.created_at, 'updated_at', p.updated_at,
        'creator', intel.ci_public_creator_card(p.identity_id, p.applied_profile),
        'member_id', intel.ci_member_of_identity(p.identity_id),
        'blacklisted', exists (select 1 from intel.ci_creator_blacklist b where b.identity_id = p.identity_id and b.lifted_at is null),
        'blocked_at', p.blocked_at, 'block_reason', p.block_reason, 'call_note', p.call_note, 'call_at', p.call_at,
        'feedback_requested_at', p.feedback_requested_at, 'feedback_at', p.feedback_at, 'feedback', p.feedback,
        'phone', case when p.blocked_at is not null or p.stage in ('address_confirmed','product_sent','content_created','changes_requested')
                      then (select w.phone_e164 from public.wa_contacts w where w.user_id = intel.ci_member_of_identity(p.identity_id) and w.verified_at is not null limit 1) end,
        'reminders_sent', (select count(*) from intel.ci_reminder r where r.participation_id = p.participation_id and r.fired_at is not null and r.kind like 'video%'),
        'next_reminder', (select min(r.due_at) from intel.ci_reminder r where r.participation_id = p.participation_id and r.fired_at is null and r.cancelled_at is null),
        'has_address', p.shipping_address_id is not null,
        'ship_to', (select jsonb_build_object('name', coalesce(nullif(btrim(m.name),''), sa.name), 'line1', a.line1, 'line2', a.line2,
                       'landmark', a.landmark, 'city', a.city, 'state', a.state, 'postal_code', a.postal_code,
                       'phone', (select w.phone_e164 from public.wa_contacts w where w.user_id = a2.member_id and w.verified_at is not null limit 1))
                      from private.creator_address a
                      join intel.ci_identity_actor_access a2 on a2.identity_id = a.identity_id and a2.access_role = 'self' and a2.revoked_at is null
                      left join public.members m on m.id = a2.member_id
                      left join public.social_accounts sa on sa.member_id = a2.member_id and sa.platform = 'instagram'
                     where a.address_id = p.shipping_address_id and p.stage in ('address_confirmed','product_sent','content_created')
                     limit 1),
        'contract', (select jsonb_build_object('issued_at', k.issued_at, 'signed_at', k.signed_at, 'asci_ack', k.asci_ack, 'terms_ack', k.terms_ack,
                       'ad_rights_months', k.ad_rights_months, 'collab_rights', k.collab_rights, 'product', k.product,
                       'deliverables', k.deliverables, 'content_days', k.content_days, 'clauses', k.clauses, 'signature_name', k.signature_name)
                       from intel.ci_campaign_contract k where k.participation_id = p.participation_id),
        'shipment', (select jsonb_build_object('status', s.status, 'courier', s.courier, 'tracking_ref', s.tracking_ref, 'tracking_url', s.tracking_url,
                       'product', s.product, 'shipped_at', s.shipped_at, 'delivered_at', s.delivered_at)
                       from intel.ci_campaign_shipment s where s.participation_id = p.participation_id order by s.created_at desc limit 1),
        'due_on', (select min(d.expected_by) from intel.ci_campaign_deliverable d where d.participation_id = p.participation_id),
        'submission', (select jsonb_build_object('url', s.content_url, 'note', s.note, 'submitted_at', s.submitted_at,
                         'rounds', (select count(*) from intel.ci_campaign_submission s2 join intel.ci_campaign_deliverable d2 on d2.deliverable_id = s2.deliverable_id
                                     where d2.participation_id = p.participation_id))
                         from intel.ci_campaign_submission s join intel.ci_campaign_deliverable d on d.deliverable_id = s.deliverable_id
                        where d.participation_id = p.participation_id order by s.submitted_at desc limit 1),
        'review', (select jsonb_build_object('decision', ap.decision, 'reason', ap.reason, 'at', ap.decided_at)
                     from intel.ci_campaign_approval ap join intel.ci_campaign_submission s on s.submission_id = ap.submission_id
                     join intel.ci_campaign_deliverable d on d.deliverable_id = s.deliverable_id
                    where d.participation_id = p.participation_id order by ap.decided_at desc limit 1),
        'posts', intel.ci_participation_posts(p.participation_id),
        'deliverables', coalesce((select jsonb_agg(jsonb_build_object('deliverable_id', d.deliverable_id, 'format', d.content_format,
                           'quantity', d.quantity, 'expected_by', d.expected_by, 'status', d.status) order by d.created_at)
                         from intel.ci_campaign_deliverable d where d.participation_id = p.participation_id), '[]'::jsonb),
        'steps', (select coalesce(jsonb_object_agg(e.to_status, e.at), '{}'::jsonb) from (
                    select distinct on (ev.to_status) ev.to_status, ev.at from intel.ci_campaign_event ev
                     where ev.participation_id = p.participation_id and ev.entity = 'participation'
                     order by ev.to_status, ev.at) e)) row
        from intel.ci_campaign_participation p
       where p.campaign_id = v_id) s), '[]'::jsonb));
end $$;

-- from 20261013260000_barter_process.sql
create or replace function api.brand_shortlist(p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid := intel.ci_resolve_campaign(p_campaign);
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  if v_id is null or not intel.ci_can_manage_campaign(v_id) then raise exception 'not your campaign' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'participation_id', p.participation_id, 'stage', p.stage, 'applied_profile', p.applied_profile,
      'creator', intel.ci_public_creator_card(p.identity_id, p.applied_profile),
      'city', (select a.city from private.creator_address a where a.identity_id = p.identity_id and a.deleted_at is null
                order by a.is_default desc, a.created_at limit 1),
      'categories', (select to_jsonb(pr.categories) from intel.ci_creator_professional_profile pr where pr.identity_id = p.identity_id),
      'reel_rate', (select min(i.amount) from intel.ci_creator_rate_card rc join intel.ci_creator_rate_card_item i on i.rate_card_id = rc.rate_card_id
                     where rc.identity_id = p.identity_id and rc.status = 'active' and i.deliverable_type ilike '%reel%' and i.amount > 0),
      'applied_at', p.created_at) order by p.created_at)
    from intel.ci_campaign_participation p
   where p.campaign_id = v_id and p.stage in ('eligible','sent_to_brand','brand_confirmed')), '[]'::jsonb);
end $$;

-- from 20261014090000_barter_autoflow.sql
create or replace function api.shipments_board()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_admin boolean; v_org uuid;
begin
  if v_uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  v_admin := public.is_platform_admin() or intel.ci_is_agency_operator();
  select org_id into v_org from public.members where id = v_uid;

  return coalesce((select jsonb_agg(r order by (r->>'sort') desc) from (
    select jsonb_build_object(
      'shipment_id', s.shipment_id, 'participation_id', p.participation_id,
      'campaign_id', c.campaign_id, 'campaign', c.name,
      'brand', coalesce(b.name, c.submitted_brand_name),
      'org_name', (select m.org_name from public.members m where m.org_id = c.org_id and m.org_name is not null limit 1),
      'creator', intel.ci_public_creator_card(p.identity_id, p.applied_profile),
      'product', coalesce(s.product, c.product), 'courier', s.courier, 'tracking_ref', s.tracking_ref, 'tracking_url', s.tracking_url,
      'status', s.status, 'shipped_at', s.shipped_at, 'delivered_at', s.delivered_at,
      'stage', p.stage,
      'has_address', p.shipping_address_id is not null
                     or exists (select 1 from private.creator_address a where a.identity_id = p.identity_id and a.deleted_at is null),
      'sort', coalesce(s.delivered_at, s.shipped_at, s.created_at)) r
      from intel.ci_campaign_shipment s
      join intel.ci_campaign_participation p on p.participation_id = s.participation_id
      join intel.ci_campaign c on c.campaign_id = p.campaign_id
      left join intel.ci_brand b on b.brand_id = c.brand_id
     where v_admin or (c.org_id is not null and c.org_id = v_org)
     order by coalesce(s.delivered_at, s.shipped_at, s.created_at) desc
     limit 300) x), '[]'::jsonb);
end $$;

-- from 20261014090000_barter_autoflow.sql
create or replace function api.campaign_analytics(p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid := intel.ci_resolve_campaign(p_campaign); v_rows jsonb; v_tot jsonb;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  if v_id is null or not intel.ci_can_manage_campaign(v_id) then raise exception 'not your campaign' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(r order by (r->'totals'->>'views')::bigint desc nulls last, (r->'totals'->>'likes')::bigint desc nulls last), '[]'::jsonb) into v_rows from (
    select jsonb_build_object('participation_id', p.participation_id, 'stage', p.stage,
             'creator', intel.ci_public_creator_card(p.identity_id, p.applied_profile), 'posts', x.posts,
             'totals', (select jsonb_build_object(
                  'reach', sum((e->'stats'->>'reach')::bigint), 'views', sum((e->'stats'->>'views')::bigint),
                  'likes', sum((e->'stats'->>'likes')::bigint), 'comments', sum((e->'stats'->>'comments')::bigint),
                  'shares', sum((e->'stats'->>'shares')::bigint), 'saves', sum((e->'stats'->>'saves')::bigint))
                from jsonb_array_elements(x.posts) e)) r
      from intel.ci_campaign_participation p
      cross join lateral (select intel.ci_participation_posts(p.participation_id) posts) x
     where p.campaign_id = v_id and p.stage in ('content_approved','published','completed')) s;
  select jsonb_build_object(
      'creators_live', (select count(*) from jsonb_array_elements(v_rows) e where jsonb_array_length(e->'posts') > 0),
      'posts', (select coalesce(sum(jsonb_array_length(e->'posts')),0) from jsonb_array_elements(v_rows) e),
      'followers', (select coalesce(sum((e->'creator'->>'followers')::bigint),0) from jsonb_array_elements(v_rows) e where jsonb_array_length(e->'posts') > 0),
      'reach', (select sum((e->'totals'->>'reach')::bigint) from jsonb_array_elements(v_rows) e),
      'views', (select sum((e->'totals'->>'views')::bigint) from jsonb_array_elements(v_rows) e),
      'likes', (select sum((e->'totals'->>'likes')::bigint) from jsonb_array_elements(v_rows) e),
      'comments', (select sum((e->'totals'->>'comments')::bigint) from jsonb_array_elements(v_rows) e),
      'shares', (select sum((e->'totals'->>'shares')::bigint) from jsonb_array_elements(v_rows) e),
      'saves', (select sum((e->'totals'->>'saves')::bigint) from jsonb_array_elements(v_rows) e)) into v_tot;
  return jsonb_build_object(
    'campaign', (select jsonb_build_object('name', c.name, 'brand', c.submitted_brand_name, 'starts_on', c.starts_on, 'ends_on', c.ends_on)
                   from intel.ci_campaign c where c.campaign_id = v_id),
    'funnel', coalesce((select jsonb_object_agg(stage, n) from (select stage, count(*) n from intel.ci_campaign_participation
                          where campaign_id = v_id group by stage) f), '{}'::jsonb),
    'totals', v_tot, 'creators', v_rows);
end $$;

-- from 20261014190000_barter_flow_v3.sql
create or replace function api.process_inbox()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_admin boolean;
begin
  if v_uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  v_admin := public.is_platform_admin() or intel.ci_is_agency_operator();
  return coalesce((select jsonb_agg(r order by (r->>'rank')::int, (r->>'since')) from (
    select jsonb_build_object(
      'participation_id', p.participation_id, 'campaign_id', c.campaign_id, 'legacy_campaign_id', c.legacy_campaign_id,
      'campaign_name', c.name, 'brand', c.submitted_brand_name,
      'org_name', (select m.org_name from public.members m where m.org_id = c.org_id and m.org_name is not null limit 1),
      'creator', intel.ci_public_creator_card(p.identity_id, p.applied_profile), 'stage', p.stage, 'since', p.updated_at,
      'kind', k.kind, 'rank', k.rank,
      'phone', case when k.kind in ('blocked','overdue') then (select w.phone_e164 from public.wa_contacts w
                     where w.user_id = intel.ci_member_of_identity(p.identity_id) and w.verified_at is not null limit 1) end,
      'call_note', p.call_note,
      'due_on', (select min(d.expected_by) from intel.ci_campaign_deliverable d where d.participation_id = p.participation_id),
      'video_url', (select s.content_url from intel.ci_campaign_submission s join intel.ci_campaign_deliverable d on d.deliverable_id = s.deliverable_id
                     where d.participation_id = p.participation_id order by s.submitted_at desc limit 1)) r
      from intel.ci_campaign_participation p
      join intel.ci_campaign c on c.campaign_id = p.campaign_id
      left join lateral (select s.status from intel.ci_campaign_shipment s where s.participation_id = p.participation_id
                          order by s.created_at desc limit 1) sh on true
      cross join lateral (select case
          when p.blocked_at is not null then 'blocked'
          when p.stage = 'content_submitted' then 'review'
          when p.stage = 'address_confirmed' then 'ship'
          when p.stage = 'product_sent' and sh.status = 'shipped' then 'deliver'
          when p.stage in ('content_created','changes_requested')
               and exists (select 1 from intel.ci_campaign_deliverable d where d.participation_id = p.participation_id
                            and d.expected_by < current_date) then 'overdue'
          when p.stage in ('brand_confirmed','accepted') and p.updated_at < now() - interval '10 minutes' then 'contract'
          when p.stage = 'contract_sent' and p.updated_at < now() - interval '3 days' then 'unsigned'
        end as kind,
        case when p.blocked_at is not null then 0 when p.stage = 'content_submitted' then 1 when p.stage = 'address_confirmed' then 2 when p.stage = 'product_sent' then 3 else 4 end as rank) k
     where k.kind is not null
       and c.lifecycle_status not in ('cancelled')
       and (v_admin or intel.ci_can_manage_campaign(c.campaign_id))
     limit 300) x), '[]'::jsonb);
end $$;

create or replace function api.bulk_invites(p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  p_campaign := intel.ci_resolve_campaign(p_campaign);
  if p_campaign is null then return '[]'::jsonb; end if;
  if not intel.ci_can_manage_campaign(p_campaign) then raise exception 'not your campaign' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(row order by (row->>'created_at') desc) from (
    select jsonb_build_object(
      'invite_id', i.invite_id, 'name', i.full_name, 'handle', i.handle, 'phone', i.phone_e164, 'email', i.email, 'city', i.city,
      'followers', coalesce(i.followers, x.followers), 'approved', i.approved, 'created_at', i.created_at, 'invites_sent', i.invites_sent,
      'last_invited_at', i.last_invited_at, 'claimed_at', i.claimed_at,
      'sheet_status', coalesce(i.status, case when i.approved then 'approved' else 'registered' end), 'status_messaged', i.status_messaged,
      'address', i.ship_address, 'courier', i.courier, 'tracking', coalesce(i.tracking_ref, i.tracking_url),
      'ig', case when x.handle is not null then jsonb_strip_nulls(jsonb_build_object('name', x.display_name, 'followers', x.followers,
                 'pic', x.profile_picture_url, 'fetched', x.enriched_at is not null, 'error', x.enrich_error)) end,
      'member_id', mem.mid,
      'status', case when p.participation_id is not null then 'joined' when mem.mid is not null then 'registered' else 'invited' end,
      'stage', p.stage, 'participation_id', p.participation_id,
      -- the account this creator is on the campaign with (the sheet's handle), not whichever one their media kit has open
      'instagram', coalesce('@'||nullif(p.applied_profile,''),
                     case when mem.mid is not null and i.handle is not null and intel.ci_member_has_handle(mem.mid, lower(i.handle)) then '@'||lower(i.handle) end,
                     (select '@'||sa.username from public.social_accounts sa where sa.member_id = mem.mid and sa.platform='instagram' limit 1)),
      'missing', case when mem.mid is null then null else
                   case when not exists (select 1 from public.social_accounts sa where sa.member_id = mem.mid and sa.platform = 'instagram')
                        then jsonb_build_array('Connect Instagram (media kit)') else '[]'::jsonb end
                   || case when intel.ci_member_identity(mem.mid) is null then jsonb_build_array('Creator profile not started')
                           else coalesce(intel.ci_profile_requirements(intel.ci_member_identity(mem.mid))->'missing', '[]'::jsonb) end end,
      'wa', (select jsonb_build_object('status', o.status, 'error', o.last_error, 'at', coalesce(o.sent_at, o.created_at)) from intel.ci_outbox o
              where o.dedupe_key like 'binv:' || i.invite_id || ':wa:%' order by o.created_at desc limit 1),
      'mail', (select jsonb_build_object('status', o.status, 'error', o.last_error, 'at', coalesce(o.sent_at, o.created_at)) from intel.ci_outbox o
              where o.dedupe_key like 'binv:' || i.invite_id || ':em:%' order by o.created_at desc limit 1)) as row
      from intel.ci_campaign_invite i
      left join lateral (select coalesce(i.claimed_by, i.reserved_by, intel.ci_find_creator(i.phone_e164, lower(i.email), lower(i.handle))) as mid) mem on true
      left join intel.ci_campaign_participation p on p.participation_id = i.participation_id
      left join intel.ci_external_creator x on x.platform = 'instagram' and x.handle = lower(i.handle)
     where i.campaign_id = p_campaign and i.source = 'bulk') s), '[]'::jsonb);
end $$;

create or replace function api.bulk_preview(p_campaign uuid, p_rows jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare x jsonb; n int := 0; out jsonb := '[]'::jsonb; v_ph text; v_em text; v_h text; v_m uuid; v_stage text; v_who text;
        v_st text; v_ig jsonb;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  p_campaign := intel.ci_resolve_campaign(p_campaign);
  if p_campaign is null then raise exception 'campaign not found — save it first' using errcode = '22023'; end if;
  if not intel.ci_can_manage_campaign(p_campaign) then raise exception 'not your campaign' using errcode = '42501'; end if;
  for x in select * from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) loop
    v_ph := intel.ci_norm_phone(x->>'phone');
    v_em := nullif(lower(btrim(coalesce(x->>'email',''))), ''); if v_em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then v_em := null; end if;
    v_h := intel.ci_norm_handle(x->>'handle');
    v_st := coalesce(intel.ci_bulk_status(x->>'status'), case when lower(coalesce(x->>'approved','')) in ('true','yes','1') then 'approved' end);
    v_m := intel.ci_find_creator(v_ph, v_em, v_h); v_stage := null; v_who := null; v_ig := null;
    if v_m is not null then
      select coalesce(case when v_h is not null and intel.ci_member_has_handle(v_m, v_h) then '@'||v_h end,
                      (select '@'||sa.username from public.social_accounts sa where sa.member_id = v_m and sa.platform='instagram' limit 1), m.name)
        into v_who from public.members m where m.id = v_m;
      select p.stage into v_stage from intel.ci_campaign_participation p
       where p.campaign_id = p_campaign and p.identity_id = intel.ci_member_identity(v_m);
    end if;
    if v_h is not null then
      select jsonb_strip_nulls(jsonb_build_object('name', e.display_name, 'followers', e.followers, 'pic', e.profile_picture_url))
        into v_ig from intel.ci_external_creator e where e.platform = 'instagram' and e.handle = v_h;
    end if;
    out := out || jsonb_build_array(jsonb_build_object('i', n, 'phone', v_ph, 'email', v_em, 'handle', v_h,
      'phone_bad', coalesce(x->>'phone','') <> '' and v_ph is null,
      'email_bad', coalesce(x->>'email','') <> '' and v_em is null,
      'no_contact', v_ph is null and v_em is null and v_h is null,
      'status', coalesce(v_st, 'registered'), 'status_bad', coalesce(btrim(x->>'status'),'') <> '' and v_st is null,
      'message', intel.ci_bulk_status_key(coalesce(v_st, 'registered')),
      'needs_address', intel.ci_bulk_rank(v_st) between 7 and 9 and coalesce(btrim(x->>'address'),'') = '',
      'on_platform', v_m is not null, 'who', v_who, 'stage', v_stage, 'ig', v_ig));
    n := n + 1;
  end loop;
  return out;
end $$;
