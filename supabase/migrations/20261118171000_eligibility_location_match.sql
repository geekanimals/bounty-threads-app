-- Eligibility: location matched from profile / default address city + state (aliases, NCR, Pan India)
-- and a live "does this applicant match the brief" check for the team.

-- city / state names written many ways → one spelling
create or replace function private.loc_canon(p text) returns text language sql immutable set search_path = '' as $f$
  select case x
    when 'bengaluru' then 'bangalore' when 'bengalore' then 'bangalore' when 'banglore' then 'bangalore'
    when 'gurugram' then 'gurgaon' when 'bombay' then 'mumbai' when 'newmumbai' then 'navimumbai'
    when 'ahemdabad' then 'ahmedabad' when 'ahmadabad' then 'ahmedabad' when 'amdavad' then 'ahmedabad'
    when 'calcutta' then 'kolkata' when 'madras' then 'chennai' when 'poona' then 'pune' when 'newdelhi' then 'delhi'
    when 'mysuru' then 'mysore' when 'cochin' then 'kochi' when 'trivandrum' then 'thiruvananthapuram'
    when 'vizag' then 'visakhapatnam' when 'baroda' then 'vadodara' when 'pondicherry' then 'puducherry'
    when 'nctofdelhi' then 'delhi' when 'delhinct' then 'delhi' when 'orissa' then 'odisha' when 'banaras' then 'varanasi'
    else x end
  from (select regexp_replace(lower(coalesce(p,'')), '[^a-z]', '', 'g') x) s $f$;

-- does one campaign location (city, state, "Delhi NCR", "Pan India") cover this creator's city / state?
-- city and state can hold several parts ("Bihar, Gurugram") or be typed the other way round — every part is checked
create or replace function private.loc_match(p_loc text, p_city text, p_state text) returns boolean language sql immutable set search_path = '' as $f$
  with v as (select private.loc_canon(p_loc) l),
       parts as (select private.loc_canon(x) c from regexp_split_to_table(coalesce(p_city,'') || ',' || coalesce(p_state,''), '[,/|;]') x),
       pp as (select c from parts where c <> '')
  select case
    when l = '' then false
    when l in ('india','allindia','panindia','anywhere','all','allcities','anycity','pan') then true
    when not exists (select 1 from pp) then false
    when l ~ 'ncr' then exists (select 1 from pp where c ~ 'noida|delhi|gurgaon|ghaziabad|faridabad|sonipat|manesar|bahadurgarh')
    else exists (select 1 from pp where c = l or c like '%' || l || '%' or (length(c) >= 4 and l like '%' || c || '%')) end
  from v $f$;

-- ci_eligibility: location uses private.loc_match (aliases, "Delhi NCR", "Pan India", swapped city/state);
-- when the profile and address have no city, the city from the creator's invite (sheet) is used
do $do$ declare src text; begin
  select pg_get_functiondef('intel.ci_eligibility(uuid,uuid)'::regprocedure) into src;
  if position('loc_match' in src) = 0 then
    src := replace(src, $x$ok := exists (select 1 from unnest(v_locs) l where lower(coalesce(v_city,'')) like '%' || lower(l) || '%' or lower(coalesce(v_region,'')) like '%' || lower(l) || '%');$x$,
                        $x$ok := exists (select 1 from unnest(v_locs) l where private.loc_match(l, v_city, v_region));$x$);
    src := replace(src, $x$v_age := case when v_dob$x$, $x$if v_city is null and v_region is null then
    select nullif(btrim(i.city),'') into v_city from intel.ci_campaign_invite i where (i.claimed_by = p_member) and nullif(btrim(i.city),'') is not null order by i.created_at desc limit 1;
  end if;
  v_age := case when v_dob$x$);
    execute src;
  end if;
end $do$;

-- live "does this applicant still match the brief?" — checked against the CURRENT eligibility, so editing the brief re-checks everyone
create or replace function api.campaign_brief_match(p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  p_campaign := intel.ci_resolve_campaign(p_campaign);
  if p_campaign is null or not intel.ci_can_manage_campaign(p_campaign) then raise exception 'not your campaign' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_object_agg(p.participation_id::text, e)
      from intel.ci_campaign_participation p
      cross join lateral (select a.member_id from intel.ci_identity_actor_access a
                           where a.identity_id = p.identity_id and a.access_role = 'self' and a.revoked_at is null order by a.granted_at limit 1) a
      cross join lateral (select intel.ci_eligibility(p_campaign, a.member_id) e) x
     where p.campaign_id = p_campaign and p.stage in ('applied','eligible','sent_to_brand','shortlisted','invited')), '{}'::jsonb);
end $$;
revoke all on function api.campaign_brief_match(uuid) from public, anon;
grant execute on function api.campaign_brief_match(uuid) to authenticated;
