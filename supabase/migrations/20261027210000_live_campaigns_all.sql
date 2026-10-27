-- 📣 Creators see EVERY live campaign. ADDITIVE.
-- Live campaigns whose applications are closed (the brand has picked its creators) were hidden from creators who
-- hadn't applied. They now show too — marked "Applications closed", with no Apply button (apply_to_campaign
-- still refuses them). Same on the public /explore.html page.
do $$
declare d text;
begin
  d := pg_get_functiondef('api.list_open_campaigns()'::regprocedure);
  if position('and (not coalesce(c.applications_closed, false) or p.participation_id is not null)' in d) > 0 then
    d := replace(d, 'and (not coalesce(c.applications_closed, false) or p.participation_id is not null)', '');
    execute d;
  end if;
  d := pg_get_functiondef('public.explore_campaigns()'::regprocedure);
  if position('and not coalesce(c.applications_closed, false)' in d) > 0 then
    d := replace(d, 'and not coalesce(c.applications_closed, false)', '');
    d := replace(d, '''creators_needed'', br.requirements->''creators_needed'',', '''creators_needed'', br.requirements->''creators_needed'', ''applications_closed'', coalesce(c.applications_closed, false),');
    execute d;
  end if;
end $$;
