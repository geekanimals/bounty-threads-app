-- Brand logins may only use the brand's own functions (api.brand_*, campaign_analytics, org_decide_applicant ...).
-- The Geek-team campaign functions (creators list with phone / email / address, bulk upload, messaging, stage changes)
-- used intel.ci_can_manage_campaign, which also lets a brand's own login in. They now use
-- intel.ci_can_operate_campaign: Geek admins and agency operators only. (19 Nov 2026)

create or replace function intel.ci_can_operate_campaign(p_campaign uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and intel.ci_is_agency_operator();
$$;
revoke all on function intel.ci_can_operate_campaign(uuid) from public, anon;
grant execute on function intel.ci_can_operate_campaign(uuid) to authenticated, service_role;

do $x$
declare
  keep text[] := array['campaign_analytics', 'org_decide_applicant', 'brand_decide_participation', 'brand_shortlist',
                       'approve_content', 'org_applicants', 'org_reports', 'campaign_share_info'];
  r record; d text; n int := 0;
begin
  for r in
    select coalesce(lv.oid, p.oid) target
      from pg_proc p join pg_namespace s on s.oid = p.pronamespace
      left join pg_proc lv on lv.proname = p.proname || '_live' and lv.pronamespace = 'private'::regnamespace
     where s.nspname = 'api' and has_function_privilege('authenticated', p.oid, 'execute')
       and coalesce(lv.prosrc, p.prosrc) ~ 'ci_can_manage_campaign'
       and not (p.proname = any (keep))
  loop
    d := pg_get_functiondef(r.target);
    d := replace(d, 'intel.ci_can_manage_campaign(', 'intel.ci_can_operate_campaign(');
    execute d;
    n := n + 1;
  end loop;
  raise notice 'locked % functions', n;
end $x$;

-- the shared cache serves non-admins only after the same check
do $x$ declare d text := pg_get_functiondef('private.cache_campaign_rpc(text,uuid)'::regprocedure); begin
  execute replace(d, 'intel.ci_can_manage_campaign(', 'intel.ci_can_operate_campaign(');
end $x$;
