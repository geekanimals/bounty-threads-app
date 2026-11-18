-- Share: the campaign id the public brief page (/creator/explore/<id>) uses + whether guests can see it now
create or replace function api.campaign_share_info(p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v uuid; c intel.ci_campaign%rowtype;
begin
  v := intel.ci_resolve_campaign(p_campaign);
  if v is null or not intel.ci_can_manage_campaign(v) then raise exception 'not your campaign' using errcode = '42501'; end if;
  select * into c from intel.ci_campaign where campaign_id = v;
  return jsonb_build_object('campaign_id', v, 'name', c.name, 'status', c.lifecycle_status,
    'public', exists (select 1 from jsonb_array_elements(public.explore_campaigns()) x where x->>'campaign_id' = v::text),
    'why_hidden', case when c.lifecycle_status not in ('creator_discovery','in_execution') then 'The campaign is not live (' || replace(coalesce(c.lifecycle_status,'draft'),'_',' ') || ')'
                       when c.ends_on < current_date then 'The campaign end date has passed'
                       when coalesce(c.applications_closed,false) then 'Applications are closed' end);
end $$;
revoke all on function api.campaign_share_info(uuid) from public, anon;
grant execute on function api.campaign_share_info(uuid) to authenticated;
