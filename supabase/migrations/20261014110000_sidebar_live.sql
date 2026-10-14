-- Sidebar, live: what needs the team right now — for agencies, brands and the Super Admin.
--   api.process_inbox() → every creator in the barter process waiting on the team (ship, mark delivered,
--                         review the video, chase an overdue video, contract stuck), across the caller's campaigns
--   api.nav_counts()    → the small live numbers next to Approvals / Campaigns / Logistics / Super Admin
-- Read-only. Scope = the caller's own workspace; the Super Admin sees every workspace. ADDITIVE.

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
      'creator', intel.ci_public_creator_card(p.identity_id), 'stage', p.stage, 'since', p.updated_at,
      'kind', k.kind, 'rank', k.rank,
      'due_on', (select min(d.expected_by) from intel.ci_campaign_deliverable d where d.participation_id = p.participation_id),
      'video_url', (select s.content_url from intel.ci_campaign_submission s join intel.ci_campaign_deliverable d on d.deliverable_id = s.deliverable_id
                     where d.participation_id = p.participation_id order by s.submitted_at desc limit 1)) r
      from intel.ci_campaign_participation p
      join intel.ci_campaign c on c.campaign_id = p.campaign_id
      left join lateral (select s.status from intel.ci_campaign_shipment s where s.participation_id = p.participation_id
                          order by s.created_at desc limit 1) sh on true
      cross join lateral (select case
          when p.stage = 'content_submitted' then 'review'
          when p.stage = 'address_confirmed' then 'ship'
          when p.stage = 'product_sent' and sh.status = 'shipped' then 'deliver'
          when p.stage in ('content_created','changes_requested')
               and exists (select 1 from intel.ci_campaign_deliverable d where d.participation_id = p.participation_id
                            and d.expected_by < current_date) then 'overdue'
          when p.stage in ('brand_confirmed','accepted') and p.updated_at < now() - interval '10 minutes' then 'contract'
          when p.stage = 'contract_sent' and p.updated_at < now() - interval '3 days' then 'unsigned'
        end as kind,
        case p.stage when 'content_submitted' then 1 when 'address_confirmed' then 2 when 'product_sent' then 3 else 4 end as rank) k
     where k.kind is not null
       and c.lifecycle_status not in ('cancelled')
       and (v_admin or intel.ci_can_manage_campaign(c.campaign_id))
     limit 300) x), '[]'::jsonb);
end $$;

create or replace function api.nav_counts()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_admin boolean; v_org uuid; v_role text; v_apv jsonb; v_proc jsonb; v_ship int;
begin
  if v_uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  v_admin := public.is_platform_admin();
  select org_id, role into v_org, v_role from public.members where id = v_uid;
  if not v_admin and coalesce(v_role,'') not in ('owner','brand','manager','corporate') then return '{}'::jsonb; end if;

  begin v_apv := api.approvals_inbox(); exception when others then v_apv := '{}'::jsonb; end;
  begin v_proc := api.process_inbox(); exception when others then v_proc := '[]'::jsonb; end;

  select count(*) into v_ship
    from intel.ci_campaign_shipment s
    join intel.ci_campaign_participation p on p.participation_id = s.participation_id
    join intel.ci_campaign c on c.campaign_id = p.campaign_id
   where s.status in ('pending','shipped') and p.stage not in ('dropped','rejected','completed')
     and (v_admin or (c.org_id is not null and c.org_id = v_org));

  return jsonb_build_object(
    'approvals', coalesce(jsonb_array_length(v_apv->'signups'),0) + coalesce(jsonb_array_length(v_apv->'campaigns'),0)
                 + coalesce(jsonb_array_length(v_apv->'applicants'),0) + coalesce(jsonb_array_length(v_apv->'marketplace'),0)
                 + coalesce(jsonb_array_length(v_proc),0),
    'process', coalesce(jsonb_array_length(v_proc),0),
    'reviews', (select count(*) from jsonb_array_elements(coalesce(v_proc,'[]'::jsonb)) e where e->>'kind' = 'review'),
    'logistics', v_ship,
    'signups', coalesce(jsonb_array_length(v_apv->'signups'),0),
    'campaigns_waiting', coalesce(jsonb_array_length(v_apv->'campaigns'),0),
    'applicants', coalesce(jsonb_array_length(v_apv->'applicants'),0) + coalesce(jsonb_array_length(v_apv->'marketplace'),0),
    'at', now());
end $$;

revoke all on function api.process_inbox() from public, anon;
revoke all on function api.nav_counts() from public, anon;
grant execute on function api.process_inbox(), api.nav_counts() to authenticated, service_role;
