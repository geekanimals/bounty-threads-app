-- Eligibility location = exactly what the campaign's "Location(s)" field says. ADDITIVE.
-- Before: clearing Location(s) on a campaign kept the OLD city on the campaign (and so the old city stayed a rule),
-- and a campaign city was used as a location rule even when the field was empty. Now:
-- * Location(s) empty or "Any" → no location rule, and the campaign shows no city.
-- * The campaign's cities always follow the field (cleared when it is cleared).
do $do$ declare src text; v text; begin
  select pg_get_functiondef('intel.ci_sync_legacy_campaign(uuid,boolean)'::regprocedure) into src;
  v := replace(src,
    $x$cities = coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(c.ideal_profile->'locations','[]'::jsonb)) x), cities),$x$,
    $x$cities = (select array_agg(btrim(x)) from jsonb_array_elements_text(case when jsonb_typeof(c.ideal_profile->'locations') = 'array' then c.ideal_profile->'locations' else '[]'::jsonb end) x
                 where btrim(x) <> '' and lower(btrim(x)) not in ('any','anyone','all','everyone','-','no limit')),$x$);
  v := replace(v,
    $x$(select array_agg(x) from jsonb_array_elements_text(coalesce(c.ideal_profile->'locations','[]'::jsonb)) x))$x$,
    $x$(select array_agg(btrim(x)) from jsonb_array_elements_text(case when jsonb_typeof(c.ideal_profile->'locations') = 'array' then c.ideal_profile->'locations' else '[]'::jsonb end) x
      where btrim(x) <> '' and lower(btrim(x)) not in ('any','anyone','all','everyone','-','no limit')))$x$);
  if v <> src then execute v; else raise notice 'ci_sync_legacy_campaign: pattern not found'; end if;
end $do$;

-- the creator check: only the Location(s) field (no fallback to campaign cities)
do $do$ declare src text; begin
  select pg_get_functiondef('intel.ci_eligibility(uuid,uuid)'::regprocedure) into src;
  src := replace(src, $x$if v_locs is null and not coalesce((v_ideal->>'locations_any')::boolean, false) then$x$, $x$if false then$x$);
  execute src;
end $do$;

-- "Matching creators": same
do $do$ declare src text; begin
  select pg_get_functiondef('api.campaign_matches(uuid,integer)'::regprocedure) into src;
  src := replace(src, $x$v_locs := case when coalesce((v_ideal->>'locations_any')::boolean, false) then v_locs else coalesce(v_locs, v_cities) end;$x$, $x$v_locs := v_locs;$x$);
  execute src;
end $do$;

-- campaigns whose Location(s) is empty / Any today: drop the left-over city
update intel.ci_campaign c set cities = null
 where c.cities is not null and c.legacy_campaign_id is not null
   and not exists (select 1 from public.campaigns pc, jsonb_array_elements_text(case when jsonb_typeof(pc.ideal_profile->'locations') = 'array' then pc.ideal_profile->'locations' else '[]'::jsonb end) x
                    where pc.id = c.legacy_campaign_id and btrim(x) <> '' and lower(btrim(x)) not in ('any','anyone','all','everyone','-','no limit'));
