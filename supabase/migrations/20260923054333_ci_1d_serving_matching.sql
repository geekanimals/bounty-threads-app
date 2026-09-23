-- Phase 1D — Intelligence Serving & Explainable Matching. ADDITIVE + DARK. api reads the unexposed
-- intel feature store via SECURITY DEFINER; browsers never touch intel/private directly. Every served
-- value carries status/evidence/confidence/freshness/missing; NO opaque score, NO PII/commercial/raw/
-- token leakage; unavailable => status+reason (never 0). Matching is BRIEF-SPECIFIC and deterministic
-- (no global ranking, no AI). All api functions are flag-gated (creator_profile_api) + authorized.

-- ---------- caller org (from legacy members; guarded) ----------
create or replace function intel.ci_caller_org()
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid; v_uid uuid;
begin
  v_uid := auth.uid(); if v_uid is null then return null; end if;
  if to_regclass('public.members') is null then return null; end if;
  execute 'select org_id from public.members where id = $1' into v_org using v_uid;
  return v_org;
end $$;
revoke all on function intel.ci_caller_org() from public, anon, authenticated;

-- ---------- brand/agency authorization: relationship-scoped (or self, or platform admin) ----------
create or replace function intel.ci_brand_can_view(p_identity uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid; v_org uuid; v_admin boolean := false;
begin
  v_uid := auth.uid(); if v_uid is null then return false; end if;
  -- self (the creator viewing their own) is authorized
  if exists (select 1 from intel.ci_identity_actor_access a where a.identity_id=p_identity and a.member_id=v_uid and a.revoked_at is null) then
    return true;
  end if;
  -- platform admin (guarded legacy table)
  if to_regclass('public.platform_admins') is not null then
    execute 'select exists(select 1 from public.platform_admins where user_id=$1)' into v_admin using v_uid;
    if v_admin then return true; end if;
  end if;
  -- relationship-scoped org access
  v_org := intel.ci_caller_org();
  if v_org is null then return false; end if;
  return exists (select 1 from intel.ci_org_creator_relationship r
                 where r.identity_id=p_identity and r.org_id=v_org and r.status='active'
                   and r.relationship_type in ('roster','represented','managed','campaign_only','discovered'));
end $$;
revoke all on function intel.ci_brand_can_view(uuid) from public, anon, authenticated;

-- ---------- serve the explainable intelligence payload for an identity (tier: self | brand) ----------
create or replace function intel.ci_serve_intelligence(p_identity uuid, p_tier text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_run uuid; v_as_of timestamptz; v_conf numeric; v_cov numeric;
        v_perf_status text; v_rel record; v_fraud record; v_perf_sample int; v_geo jsonb;
begin
  select feature_run_id, as_of into v_run, v_as_of from intel.ci_feature_run
    where identity_id=p_identity and status='complete' order by as_of desc limit 1;
  if v_run is null then
    return jsonb_build_object('status','insufficient_data','reason','no_intelligence_computed_yet','generated_at',null);
  end if;
  select value_num into v_conf from intel.ci_measure_snapshot where feature_run_id=v_run and measure='intelligence_confidence';
  select value_num into v_cov  from intel.ci_measure_snapshot where feature_run_id=v_run and measure='verified_data_coverage';
  select value_status into v_perf_status from intel.ci_measure_snapshot where feature_run_id=v_run and measure='creator_performance';
  select value_status, explanation, unavailable_reason into v_rel from intel.ci_measure_snapshot where feature_run_id=v_run and measure='reliability';
  select value_status, is_estimate, explanation into v_fraud from intel.ci_measure_snapshot where feature_run_id=v_run and measure='fraud_probability';
  select sum(sample_size) into v_perf_sample from intel.ci_feature_value where feature_run_id=v_run and feature_key='content.sample_size' and value_status='available';
  -- audience geography (marginal, top buckets only — never a joint)
  select jsonb_build_object(
     'country', (select value_json - '_note' from intel.ci_feature_value where feature_run_id=v_run and feature_key='audience.country_distribution' and value_status='available'),
     'city',    (select value_json - '_note' from intel.ci_feature_value where feature_run_id=v_run and feature_key='audience.city_distribution' and value_status='available'),
     'top_country_share', (select value_num from intel.ci_feature_value where feature_run_id=v_run and feature_key='audience.geographic_strength' and value_status='available'),
     'freshness', (select freshness_status from intel.ci_feature_value where feature_run_id=v_run and feature_key='audience.country_distribution' limit 1),
     'note','marginal only; not a joint intersection') into v_geo;

  return jsonb_build_object(
    'tier', p_tier,
    'performance', jsonb_build_object(
      'status', v_perf_status,
      'reels_analysed', coalesce(v_perf_sample,0),
      'window','last 90 days',
      'confidence_band', case when v_conf is null then 'unknown' when v_conf>=0.66 then 'High' when v_conf>=0.33 then 'Medium' else 'Low' end,
      'metrics', case when p_tier='self' then coalesce((
          select jsonb_agg(jsonb_build_object('feature',fv.feature_key,'format',fv.value_json->>'format','window',fv.window_kind,
                    'value',fv.value_num,'unit',fv.unit,'status',fv.value_status,'evidence_type',fv.evidence_type,
                    'explanation',fv.explanation,'feature_value_id',fv.feature_value_id) order by fv.feature_key)
          from intel.ci_feature_value fv where fv.feature_run_id=v_run and fv.feature_key like 'content.%'), '[]'::jsonb)
        else '[]'::jsonb end),   -- brand tier: summary only, no raw per-metric dump
    'audience', v_geo,
    'reliability', jsonb_build_object('status', v_rel.value_status, 'reason', coalesce(v_rel.unavailable_reason,'—'), 'explanation', v_rel.explanation),
    'brand_safety', (select jsonb_build_object('status',value_status,'reason',coalesce(unavailable_reason,'—')) from intel.ci_measure_snapshot where feature_run_id=v_run and measure='brand_safety'),
    'fraud_probability', jsonb_build_object('status', v_fraud.value_status, 'is_estimate', true, 'explanation', v_fraud.explanation),
    'confidence', jsonb_build_object('status', case when v_conf is null then 'insufficient_data' else 'available' end, 'value', v_conf),
    'coverage', jsonb_build_object('status', case when v_cov is null then 'insufficient_data' else 'available' end, 'value', v_cov),
    'generated_at', v_as_of
    -- NOTE: no contact/address/DOB/WhatsApp/email, no rate cards/commercials, no raw comments/messages, no tokens.
  );
end $$;
revoke all on function intel.ci_serve_intelligence(uuid,text) from public, anon, authenticated;

-- ============================ api: CREATOR SELF-VIEW ============================
create or replace function api.get_my_creator_intelligence()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform intel.ci_assert_api_enabled('creator_profile_api');
  v_id := intel.ci_caller_identity();   -- ownership enforced (self actor-access)
  return jsonb_build_object('creator_identity', jsonb_build_object('identity_id', v_id))
      || intel.ci_serve_intelligence(v_id, 'self');
end $$;

-- ============================ api: BRAND / AGENCY VIEW (relationship-scoped) ============================
create or replace function api.get_creator_intelligence(p_identity_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform intel.ci_assert_api_enabled('creator_profile_api');
  if auth.uid() is null then raise exception 'unauthenticated' using errcode='28000'; end if;
  if not intel.ci_brand_can_view(p_identity_id) then
    raise exception 'not authorised to view this creator' using errcode='42501';   -- unrelated org => denied
  end if;
  return jsonb_build_object('creator_identity', jsonb_build_object('identity_id', p_identity_id))
      || intel.ci_serve_intelligence(p_identity_id, 'brand');
end $$;

-- ============================ api: EVIDENCE RESOLVER ============================
create or replace function api.get_feature_evidence(p_feature_value_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_fv record; v_run record;
begin
  perform intel.ci_assert_api_enabled('creator_profile_api');
  select * into v_fv from intel.ci_feature_value where feature_value_id=p_feature_value_id;
  if v_fv.feature_value_id is null then raise exception 'feature value not found' using errcode='42501'; end if;
  if not intel.ci_brand_can_view(v_fv.identity_id) then raise exception 'not authorised' using errcode='42501'; end if;
  select model_version into v_run from intel.ci_feature_run where feature_run_id=v_fv.feature_run_id;
  return jsonb_build_object(
    'feature', v_fv.feature_key, 'evidence_type', v_fv.evidence_type,
    'value', v_fv.value_num, 'value_json', v_fv.value_json, 'unit', v_fv.unit, 'status', v_fv.value_status,
    'source', coalesce((select jsonb_agg(distinct source_kind) from intel.ci_feature_evidence where feature_value_id=p_feature_value_id), '[]'::jsonb),
    'source_rows', coalesce((select jsonb_agg(jsonb_build_object('table',source_table,'row_id',source_row_id,'ingest_run_id',ingest_run_id)) from intel.ci_feature_evidence where feature_value_id=p_feature_value_id), '[]'::jsonb),
    'calculation', v_fv.explanation, 'sample_size', v_fv.sample_size,
    'window', v_fv.window_kind, 'as_of', v_fv.as_of, 'calculated_at', v_fv.computed_at, 'model_version', v_run.model_version);
end $$;

-- ============================ MATCHING: request + result tables ============================
create table intel.ci_matching_request (
  matching_request_id uuid primary key default gen_random_uuid(),
  created_by       uuid not null references auth.users(id) on delete cascade,
  org_id           uuid,                         -- resolved requester org (relationship scope)
  campaign_id      uuid,                          -- soft ref to public.campaigns(id)
  requirements     jsonb not null,                -- {category[],location[],platform,content_formats[],audience_gender,audience_age,budget_range,deliverables[]}
  created_at       timestamptz not null default now()
);
create index ci_matching_request_creator_idx on intel.ci_matching_request(created_by, created_at desc);

create table intel.ci_match_result (
  match_result_id  uuid primary key default gen_random_uuid(),
  matching_request_id uuid not null references intel.ci_matching_request(matching_request_id) on delete cascade,
  creator_identity_id uuid not null references intel.ci_creator_identity(identity_id) on delete cascade,
  match_status     text not null check (match_status in ('match','partial','no_match','insufficient_data')),
  match_strength   text check (match_strength is null or match_strength in ('strong','moderate','weak')),
  matched_signals  jsonb not null default '[]',   -- explainable positive signals (evidence-backed)
  missing_signals  jsonb not null default '[]',   -- what is NOT known / limitations
  feature_snapshot_id uuid,                        -- the ci_feature_run used
  generated_at     timestamptz not null default now(),
  constraint ci_match_result_uq unique (matching_request_id, creator_identity_id)
);
create index ci_match_result_req_idx on intel.ci_match_result(matching_request_id);

do $$ declare t text; begin
  foreach t in array array['ci_matching_request','ci_match_result'] loop
    execute format('alter table intel.%I enable row level security', t);
    execute format('revoke all on table intel.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on table intel.%I to service_role', t);
  end loop;
  -- match_result is append-only history
  drop trigger if exists ci_match_result_append_only on intel.ci_match_result;
  create trigger ci_match_result_append_only before update or delete on intel.ci_match_result for each row execute function intel.tg_block_mutation();
end $$;

-- ============================ DETERMINISTIC MATCHER (brief-specific; no global ranking, no AI) ============================
create or replace function intel.ci_match_creators(p_request uuid)
returns setof intel.ci_match_result language plpgsql security definer set search_path = '' as $$
declare v_req record; cand record; v_run uuid; v_hard boolean; v_matched jsonb; v_missing jsonb;
        v_cats text[]; v_locs text[]; v_fmt text; v_strength text; v_status text; v_nsig int;
        v_has_cat boolean; v_has_geo boolean; v_has_perf boolean; v_geo_share numeric;
begin
  select * into v_req from intel.ci_matching_request where matching_request_id=p_request;
  if v_req.matching_request_id is null then raise exception 'request not found' using errcode='42501'; end if;
  v_cats := (select array_agg(x) from jsonb_array_elements_text(coalesce(v_req.requirements->'category','[]')) x);
  v_locs := (select array_agg(lower(x)) from jsonb_array_elements_text(coalesce(v_req.requirements->'location','[]')) x);
  v_fmt  := upper(coalesce((v_req.requirements->'content_formats'->>0), 'REELS'));

  -- CANDIDATES = creators the requester's org has a relationship with (never a global pool)
  for cand in
    select distinct r.identity_id from intel.ci_org_creator_relationship r
    where r.org_id = v_req.org_id and r.status='active'
  loop
    select feature_run_id into v_run from intel.ci_feature_run where identity_id=cand.identity_id and status='complete' order by as_of desc limit 1;
    v_matched := '[]'::jsonb; v_missing := '[]'::jsonb; v_nsig := 0;

    -- HARD FILTER: platform account connected + active
    v_hard := exists (select 1 from intel.ci_identity_platform_account ipa join intel.ci_platform_connection c on c.platform_account_id=ipa.platform_account_id
                      where ipa.identity_id=cand.identity_id and ipa.valid_to is null and c.status='active');
    -- HARD FILTER: category overlap (professional categories)
    v_has_cat := exists (select 1 from intel.ci_creator_professional_profile p
                         where p.identity_id=cand.identity_id and (v_cats is null or p.categories && v_cats));
    if v_cats is not null and v_has_cat then v_matched := v_matched || to_jsonb((v_cats)[1]||' category match'); v_nsig:=v_nsig+1;
    elsif v_cats is not null then v_missing := v_missing || to_jsonb('category not evidenced'::text); end if;

    if v_run is null then
      insert into intel.ci_match_result(matching_request_id,creator_identity_id,match_status,match_strength,matched_signals,missing_signals,feature_snapshot_id)
        values (p_request,cand.identity_id, case when v_hard then 'insufficient_data' else 'no_match' end, null, v_matched,
                v_missing || to_jsonb('no computed intelligence yet'::text), null)
        on conflict (matching_request_id,creator_identity_id) do nothing;
      continue;
    end if;

    -- SOFT: audience geography (marginal top-country/city share for a requested location)
    v_has_geo := false; v_geo_share := null;
    if v_locs is not null then
      -- share of a requested-location bucket within its OWN marginal distribution (no joint, no window-in-aggregate)
      select max(share) into v_geo_share from (
        select (kv.value::numeric / nullif(tot.t,0))*100 as share
        from intel.ci_feature_value fv
        cross join lateral (select sum(x2.value::numeric) t from jsonb_each_text(coalesce(fv.value_json - '_note','{}'::jsonb)) as x2(k2,value)) tot
        cross join lateral jsonb_each_text(coalesce(fv.value_json - '_note','{}'::jsonb)) as kv(k,value)
        where fv.feature_run_id=v_run and fv.feature_key in ('audience.city_distribution','audience.country_distribution')
          and fv.value_status='available' and lower(kv.k) = any(v_locs)) q;
      if v_geo_share is not null then v_has_geo := true; v_matched := v_matched || to_jsonb('strong '||(v_locs)[1]||' audience presence'); v_nsig:=v_nsig+1;
      else v_missing := v_missing || to_jsonb('requested-location audience not evidenced'::text); end if;
    end if;

    -- SOFT: recent performance for the requested format
    v_has_perf := exists (select 1 from intel.ci_feature_value fv where fv.feature_run_id=v_run
                    and fv.feature_key='content.engagement_per_follower' and fv.window_kind='30d'
                    and fv.value_json->>'format'=v_fmt and fv.value_status='available');
    if v_has_perf then v_matched := v_matched || to_jsonb('strong '||v_fmt||' performance'); v_nsig:=v_nsig+1;
    else v_missing := v_missing || to_jsonb(v_fmt||' performance insufficient'); end if;

    -- SOFT: confirmed brand/category experience
    if exists (select 1 from intel.ci_creator_brand_experience b where b.identity_id=cand.identity_id and b.creator_confirmed_at is not null and b.creator_rejected_at is null) then
      v_matched := v_matched || to_jsonb('prior brand campaign experience'::text); v_nsig:=v_nsig+1;
    end if;

    -- always-honest limitations (never fabricated)
    if exists (select 1 from intel.ci_measure_snapshot where feature_run_id=v_run and measure='reliability' and value_status<>'available') then
      v_missing := v_missing || to_jsonb('reliability data insufficient'::text); end if;
    v_missing := v_missing || to_jsonb('conversion data unavailable'::text);

    v_strength := case when v_nsig>=3 then 'strong' when v_nsig=2 then 'moderate' else 'weak' end;
    v_status   := case when not v_hard then 'no_match' when v_nsig>=2 then 'match' else 'partial' end;
    insert into intel.ci_match_result(matching_request_id,creator_identity_id,match_status,match_strength,matched_signals,missing_signals,feature_snapshot_id)
      values (p_request,cand.identity_id,v_status,v_strength,v_matched,v_missing,v_run)
      on conflict (matching_request_id,creator_identity_id) do nothing;
  end loop;
  return query select * from intel.ci_match_result where matching_request_id=p_request;
end $$;
revoke all on function intel.ci_match_creators(uuid) from public, anon, authenticated;

-- ============================ api: create + run matching (brief-specific) ============================
create or replace function api.match_creators(p_requirements jsonb, p_campaign_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_org uuid; v_req uuid;
begin
  perform intel.ci_assert_api_enabled('creator_profile_api');
  v_uid := auth.uid(); if v_uid is null then raise exception 'unauthenticated' using errcode='28000'; end if;
  v_org := intel.ci_caller_org();
  if v_org is null then raise exception 'no organisation for caller' using errcode='42501'; end if;
  insert into intel.ci_matching_request(created_by, org_id, campaign_id, requirements)
    values (v_uid, v_org, p_campaign_id, p_requirements) returning matching_request_id into v_req;
  perform intel.ci_match_creators(v_req);
  return jsonb_build_object(
    'matching_request_id', v_req, 'requirements', p_requirements,
    'results', coalesce((select jsonb_agg(jsonb_build_object('creator_identity_id',creator_identity_id,'match_status',match_status,
        'match_strength',match_strength,'matched_signals',matched_signals,'missing_signals',missing_signals,
        'feature_snapshot_id',feature_snapshot_id) order by match_strength nulls last, creator_identity_id)
      from intel.ci_match_result where matching_request_id=v_req), '[]'::jsonb),
    'generated_at', now());
end $$;

-- ============================ GRANTS (browser-facing = authenticated + service_role) ============================
do $$ declare fn text; begin
  foreach fn in array array['api.get_my_creator_intelligence()','api.get_creator_intelligence(uuid)',
    'api.get_feature_evidence(uuid)','api.match_creators(jsonb,uuid)'] loop
    execute 'revoke all on function '||fn||' from public, anon';
    execute 'grant execute on function '||fn||' to authenticated, service_role';
  end loop; end $$;
grant execute on function intel.ci_match_creators(uuid) to service_role;
grant execute on function intel.ci_serve_intelligence(uuid,text) to service_role;
grant execute on function intel.ci_brand_can_view(uuid) to service_role;
grant execute on function intel.ci_caller_org() to service_role;
