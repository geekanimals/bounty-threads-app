-- Eligibility: "Any" means anyone. ADDITIVE.
-- * Location / Category / Pet type written as "Any" (or "anyone", "all", "everyone") = no rule for that field.
-- * Location "Any" also stops the campaign's own cities from being used as a location rule.
-- * Min followers 0 = no follower rule.
create or replace function intel.ci_campaign_ideal(p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb; v_any text[] := array['any','anyone','all','everyone','-','no limit'];
begin
  select coalesce((select br.requirements->'ideal_profile' from intel.ci_campaign_brief br
                    where br.campaign_id = p_campaign order by br.created_at desc limit 1), '{}'::jsonb) into v;
  if jsonb_typeof(v) <> 'object' then return '{}'::jsonb; end if;
  if jsonb_typeof(v->'locations') = 'array' then
    if exists (select 1 from jsonb_array_elements_text(v->'locations') x where lower(btrim(x)) = any(v_any)) then
      v := (v - 'locations') || '{"locations_any": true}'::jsonb;
    end if;
  end if;
  if jsonb_typeof(v->'categories') = 'array'
     and exists (select 1 from jsonb_array_elements_text(v->'categories') x where lower(btrim(x)) = any(v_any)) then
    v := v - 'categories';
  end if;
  if lower(btrim(coalesce(v->>'pet_type', ''))) = any(v_any) then v := v - 'pet_type'; end if;
  if lower(btrim(coalesce(v->>'gender', ''))) = any(v_any) then v := v - 'gender'; end if;
  if lower(btrim(coalesce(v->>'marital', ''))) = any(v_any) then v := v - 'marital'; end if;
  if coalesce(nullif(v->>'min_followers', ''), '1')::numeric <= 0 then v := v - 'min_followers'; end if;
  return v;
exception when others then
  return coalesce(v, '{}'::jsonb);
end $$;

-- the creator check: no city fallback when Location says Any
do $do$ declare src text; begin
  select pg_get_functiondef('intel.ci_eligibility(uuid,uuid)'::regprocedure) into src;
  if position('locations_any' in src) = 0 then
    src := replace(src, $x$  if v_locs is null then
    select array_agg(btrim(x)) into v_locs$x$, $x$  if v_locs is null and not coalesce((v_ideal->>'locations_any')::boolean, false) then
    select array_agg(btrim(x)) into v_locs$x$);
    execute src;
  end if;
end $do$;

-- "Matching creators" for the team: same rule
do $do$ declare src text; begin
  select pg_get_functiondef('api.campaign_matches(uuid,integer)'::regprocedure) into src;
  if position('locations_any' in src) = 0 then
    src := replace(src, $x$v_locs := coalesce(v_locs, v_cities);$x$,
                        $x$v_locs := case when coalesce((v_ideal->>'locations_any')::boolean, false) then v_locs else coalesce(v_locs, v_cities) end;$x$);
    execute src;
  end if;
end $do$;
