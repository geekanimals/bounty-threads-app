-- Screening stays with the Geek team. The brand sees only the creators the team sends (stage sent_to_brand),
-- plus how many applied in total; the brand can approve only those.

do $do$ declare src text; begin
  -- brand portal: "to approve" = only sent_to_brand · new applied_counts { campaign_id: { applied, shared } }
  select pg_get_functiondef('api.brand_portal(uuid)'::regprocedure) into src;
  if position('applied_counts' in src) = 0 then
    src := replace(src, $x$p.stage in ('applied','eligible','sent_to_brand')), '[]'::jsonb),$x$, $x$p.stage = 'sent_to_brand'), '[]'::jsonb),$x$);
    src := replace(src, $x$'to_approve', coalesce($x$, $x$'applied_counts', coalesce((select jsonb_object_agg(x.campaign_id, jsonb_build_object('applied', x.applied, 'shared', x.shared))
        from (select c.campaign_id, count(*) filter (where p.stage not in ('invited','shortlisted')) applied, count(*) filter (where p.stage = 'sent_to_brand') shared
                from intel.ci_campaign_participation p join intel.ci_campaign c on c.campaign_id = p.campaign_id
               where c.brand_id = any(v_ids) group by c.campaign_id) x), '{}'::jsonb),
    'to_approve', coalesce($x$);
    execute src;
  end if;

  -- brand alert "N waiting for your approval": only when the team sends creators
  select pg_get_functiondef('intel.ci_brand_alert(uuid,text,uuid)'::regprocedure) into src;
  src := replace(src, $x$where campaign_id = p_campaign and stage in ('applied','eligible','sent_to_brand');$x$, $x$where campaign_id = p_campaign and stage = 'sent_to_brand';$x$);
  execute src;
  select pg_get_functiondef('intel.tg_brand_alert_participation()'::regprocedure) into src;
  src := replace(src, $x$if new.stage in ('applied','sent_to_brand') then$x$, $x$if new.stage = 'sent_to_brand' then$x$);
  execute src;

  -- brand approve / decline: only creators the team has sent
  select pg_get_functiondef('api.org_decide_applicant(uuid,boolean,text,text)'::regprocedure) into src;
  if position('not shared this creator' in src) = 0 then
    src := replace(src, $x$raise exception 'not authorised for this application' using errcode = '42501'; end if;$x$,
      $x$raise exception 'not authorised for this application' using errcode = '42501'; end if;
  if v_stage is distinct from 'sent_to_brand' and not public.is_platform_admin() then
    raise exception 'The Geek team has not shared this creator with you yet' using errcode = '42501';
  end if;$x$);
    execute src;
  end if;

  -- brand stage: applied / eligible = "screening" (not "waiting for your approval")
  select pg_get_functiondef('intel.ci_brand_stage(text)'::regprocedure) into src;
  if position('"screening"' in src) = 0 then
    src := replace(src, $x$when p_stage in ('applied','eligible','sent_to_brand') then '{"key":"to_approve","label":"Waiting for your approval","step":1}'$x$,
      $x$when p_stage in ('applied','eligible') then '{"key":"screening","label":"Applied — the Geek team is screening","step":0}' when p_stage = 'sent_to_brand' then '{"key":"to_approve","label":"Waiting for your approval","step":1}'$x$);
    execute src;
  end if;

  -- brand campaign page: applicants hidden (only their number); timeline without them
  select pg_get_functiondef('api.brand_campaign(uuid)'::regprocedure) into src;
  if position('screening_count' in src) = 0 then
    src := regexp_replace(src, $x$from intel\.ci_campaign_participation p\s+where p\.campaign_id = v_id\), '\[\]'::jsonb\) \|\| intel\.ci_brand_sheet_rows\(v_id\),$x$,
      $x$from intel.ci_campaign_participation p where p.campaign_id = v_id and p.stage not in ('applied','eligible')), '[]'::jsonb) || intel.ci_brand_sheet_rows(v_id),
    'screening_count', (select count(*) from intel.ci_campaign_participation p where p.campaign_id = v_id and p.stage in ('applied','eligible')),
    'applied_count', (select count(*) from intel.ci_campaign_participation p where p.campaign_id = v_id and p.stage not in ('invited','shortlisted')),$x$);
    src := regexp_replace(src, $x$left join intel\.ci_campaign_participation p on p\.participation_id = e\.participation_id\), '\[\]'::jsonb\)\);$x$,
      $x$left join intel.ci_campaign_participation p on p.participation_id = e.participation_id where p.stage is null or p.stage not in ('applied','eligible')), '[]'::jsonb));$x$);
    execute src;
  end if;
end $do$;
