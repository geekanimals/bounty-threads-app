-- Phase 1E Operations — ONE additive, DARK, READ-ONLY operator/owning-brand detail read. ADDITIVE.
-- Rationale: the agency detail page and its invite/approve actions need per-campaign data (participations +
-- their deliverables/latest submission + shipment + the event-ledger timeline) that the aggregate
-- get_campaign_pipeline does not expose. This adds no table, no scoring/ranking, changes no existing contract,
-- and is gated identically (operational_pilot + cohort). It exposes only operational fields — no creator PII,
-- no private contact, no raw messages/DMs, no tokens.
create or replace function api.get_campaign_detail(p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid; v_camp_org uuid;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  if not exists (select 1 from intel.ci_campaign where campaign_id=p_campaign) then
    raise exception 'campaign not found' using errcode='42501'; end if;
  select org_id into v_camp_org from intel.ci_campaign where campaign_id=p_campaign;
  v_org := intel.ci_caller_org();
  if not (intel.ci_is_agency_operator() or (v_org is not null and v_org=v_camp_org)) then
    raise exception 'not authorised for this campaign' using errcode='42501'; end if;

  return jsonb_build_object(
    'campaign', (select jsonb_build_object('campaign_id',c.campaign_id,'name',c.name,'objective',c.objective,
        'brand', coalesce(b.name,c.submitted_brand_name),'product',c.product,'category',c.category,
        'cities',to_jsonb(c.cities),'languages',to_jsonb(c.languages),'comp_type',c.comp_type,'budget',c.budget,
        'currency',c.currency,'starts_on',c.starts_on,'ends_on',c.ends_on,'lifecycle_status',c.lifecycle_status)
      from intel.ci_campaign c left join intel.ci_brand b on b.brand_id=c.brand_id where c.campaign_id=p_campaign),
    'participations', coalesce((select jsonb_agg(jsonb_build_object(
        'participation_id',p.participation_id,'creator_identity_id',p.identity_id,'role',p.role,'stage',p.stage,'reason',p.reason,
        'shipment',(select jsonb_build_object('status',s.status,'tracking',s.tracking_ref,'shipped_at',s.shipped_at)
                    from intel.ci_campaign_shipment s where s.participation_id=p.participation_id order by s.created_at desc limit 1),
        'deliverables',coalesce((select jsonb_agg(jsonb_build_object('deliverable_id',d.deliverable_id,'format',d.content_format,
            'quantity',d.quantity,'expected_by',d.expected_by,'status',d.status,
            'latest_submission',(select jsonb_build_object('submission_id',su.submission_id,'content_url',su.content_url,'status',su.status,'submitted_at',su.submitted_at)
                                 from intel.ci_campaign_submission su where su.deliverable_id=d.deliverable_id order by su.created_at desc limit 1))
            order by d.created_at) from intel.ci_campaign_deliverable d where d.participation_id=p.participation_id),'[]'::jsonb))
        order by p.created_at)
      from intel.ci_campaign_participation p where p.campaign_id=p_campaign),'[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('entity',e.entity,'from',e.from_status,'to',e.to_status,
        'actor',e.actor_member_id,'reason',e.reason,'at',e.at) order by e.at)
      from intel.ci_campaign_event e where e.campaign_id=p_campaign),'[]'::jsonb));
end $$;
revoke all on function api.get_campaign_detail(uuid) from public, anon;
grant execute on function api.get_campaign_detail(uuid) to authenticated, service_role;
