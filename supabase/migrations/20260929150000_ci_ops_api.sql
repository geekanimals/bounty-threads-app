-- Phase 1E Operations — api surface. ADDITIVE + DARK. Every function is gated by
-- ci_assert_api_enabled('operational_pilot') (flag + pilot cohort) and then server-enforced authorization:
-- agency operators for campaign writes, the owning creator for their participation actions, and the operator
-- or owning brand org for approvals. Browsers never touch intel directly. No scoring/ranking; reporting is
-- evidence-only (counts/timestamps), never fabricated.

-- ---------- reference vocabularies for the UI ----------
create or replace function api.ops_vocab()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  return jsonb_build_object(
    'content_formats', coalesce((select jsonb_agg(jsonb_build_object('key',format_key,'label',label) order by label) from intel.ci_content_format_vocab where is_active),'[]'::jsonb),
    'objectives',      coalesce((select jsonb_agg(jsonb_build_object('key',objective_key,'label',label) order by label) from intel.ci_campaign_objective_vocab where is_active),'[]'::jsonb),
    'roles',           coalesce((select jsonb_agg(jsonb_build_object('key',role_key,'label',label) order by label) from intel.ci_participation_role_vocab where is_active),'[]'::jsonb));
end $$;

-- ---------- helpers ----------
create or replace function intel.ci_campaign_of_participation(p_participation uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select campaign_id from intel.ci_campaign_participation where participation_id=p_participation $$;
revoke all on function intel.ci_campaign_of_participation(uuid) from public, anon, authenticated;
grant execute on function intel.ci_campaign_of_participation(uuid) to service_role;

-- ============================ AGENCY (operator-gated) ============================
create or replace function api.create_campaign(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_org uuid; v_id uuid;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  v_uid := auth.uid(); if v_uid is null then raise exception 'unauthenticated' using errcode='28000'; end if;
  if not intel.ci_is_agency_operator() then raise exception 'not an agency operator' using errcode='42501'; end if;
  v_org := intel.ci_caller_org();
  insert into intel.ci_campaign(brand_id, submitted_brand_name, org_id, created_by, name, objective, product,
      category, cities, languages, comp_type, budget, starts_on, ends_on)
    values ( nullif(p->>'brand_id','')::uuid, nullif(p->>'submitted_brand_name',''), v_org, v_uid,
      p->>'name', nullif(p->>'objective',''), nullif(p->>'product',''), nullif(p->>'category',''),
      case when p ? 'cities' then (select array_agg(x) from jsonb_array_elements_text(p->'cities') x) end,
      case when p ? 'languages' then (select array_agg(x) from jsonb_array_elements_text(p->'languages') x) end,
      nullif(p->>'comp_type',''), nullif(p->>'budget','')::numeric,
      nullif(p->>'starts_on','')::date, nullif(p->>'ends_on','')::date)
    returning campaign_id into v_id;
  insert into intel.ci_campaign_event(campaign_id, entity, from_status, to_status, actor_member_id, reason)
    values (v_id, 'campaign', null, 'draft', v_uid, 'created');
  if p ? 'requirements' then
    insert into intel.ci_campaign_brief(campaign_id, requirements) values (v_id, p->'requirements');
  end if;
  return jsonb_build_object('campaign_id', v_id);
end $$;

create or replace function api.add_campaign_participant(p_campaign uuid, p_identity uuid, p_role text default null, p_match_result uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_pid uuid;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  v_uid := auth.uid();
  if not intel.ci_is_agency_operator() then raise exception 'not an agency operator' using errcode='42501'; end if;
  if not exists(select 1 from intel.ci_campaign where campaign_id=p_campaign) then raise exception 'campaign not found' using errcode='42501'; end if;
  if not exists(select 1 from intel.ci_creator_identity where identity_id=p_identity) then raise exception 'creator identity not found' using errcode='42501'; end if;
  insert into intel.ci_campaign_participation(campaign_id, identity_id, role, match_result_id, owner_member_id, stage)
    values (p_campaign, p_identity, nullif(p_role,''), p_match_result, v_uid, 'shortlisted')
    on conflict (campaign_id, identity_id) do nothing
    returning participation_id into v_pid;
  if v_pid is null then raise exception 'creator already on this campaign' using errcode='23505'; end if;
  insert into intel.ci_campaign_event(campaign_id, participation_id, entity, from_status, to_status, actor_member_id, reason)
    values (p_campaign, v_pid, 'participation', null, 'shortlisted', v_uid, 'shortlisted from matching');
  return jsonb_build_object('participation_id', v_pid);
end $$;

create or replace function api.add_deliverable(p_participation uuid, p_format text, p_quantity int default 1, p_expected_by date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_did uuid;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  if not intel.ci_is_agency_operator() then raise exception 'not an agency operator' using errcode='42501'; end if;
  insert into intel.ci_campaign_deliverable(participation_id, content_format, quantity, expected_by)
    values (p_participation, nullif(p_format,''), p_quantity, p_expected_by) returning deliverable_id into v_did;
  return jsonb_build_object('deliverable_id', v_did);
end $$;

create or replace function api.advance_participation(p_participation uuid, p_to text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  v_uid := auth.uid();
  if not intel.ci_is_agency_operator() then raise exception 'not an agency operator' using errcode='42501'; end if;
  return jsonb_build_object('stage', intel.ci_participation_advance(p_participation, p_to, v_uid, p_reason));
end $$;

create or replace function api.record_shipment(p_participation uuid, p_product text, p_courier text default null, p_tracking text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_sid uuid; v_stage text;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  v_uid := auth.uid();
  if not intel.ci_is_agency_operator() then raise exception 'not an agency operator' using errcode='42501'; end if;
  insert into intel.ci_campaign_shipment(participation_id, product, courier, tracking_ref, shipped_at, status)
    values (p_participation, nullif(p_product,''), nullif(p_courier,''), nullif(p_tracking,''), now(), 'shipped') returning shipment_id into v_sid;
  select stage into v_stage from intel.ci_campaign_participation where participation_id=p_participation;
  if v_stage='accepted' then perform intel.ci_participation_advance(p_participation, 'product_sent', v_uid, 'product shipped'); end if;
  insert into intel.ci_campaign_event(campaign_id, participation_id, entity, from_status, to_status, actor_member_id, reason)
    values (intel.ci_campaign_of_participation(p_participation), p_participation, 'shipment', null, 'shipped', v_uid, p_tracking);
  return jsonb_build_object('shipment_id', v_sid);
end $$;

create or replace function api.set_campaign_status(p_campaign uuid, p_to text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  v_uid := auth.uid();
  if not intel.ci_is_agency_operator() then raise exception 'not an agency operator' using errcode='42501'; end if;
  return jsonb_build_object('lifecycle_status', intel.ci_campaign_set_status(p_campaign, p_to, v_uid, p_reason));
end $$;

-- ============================ CREATOR (self-gated) ============================
create or replace function api.respond_to_campaign(p_participation uuid, p_accept boolean, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_owner uuid; v_uid uuid;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  v_uid := auth.uid(); v_id := intel.ci_caller_identity();
  select identity_id into v_owner from intel.ci_campaign_participation where participation_id=p_participation;
  if v_owner is null or v_owner <> v_id then raise exception 'not your campaign participation' using errcode='42501'; end if;
  return jsonb_build_object('stage', intel.ci_participation_advance(p_participation, case when p_accept then 'accepted' else 'rejected' end, v_uid, p_reason));
end $$;

create or replace function api.submit_content(p_deliverable uuid, p_content_url text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_uid uuid; v_part uuid; v_owner uuid; v_stage text; v_sub uuid;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  v_uid := auth.uid(); v_id := intel.ci_caller_identity();
  select d.participation_id, p.identity_id, p.stage into v_part, v_owner, v_stage
    from intel.ci_campaign_deliverable d join intel.ci_campaign_participation p on p.participation_id=d.participation_id
    where d.deliverable_id=p_deliverable;
  if v_owner is null or v_owner <> v_id then raise exception 'not your deliverable' using errcode='42501'; end if;
  insert into intel.ci_campaign_submission(deliverable_id, content_url, note) values (p_deliverable, nullif(p_content_url,''), nullif(p_note,'')) returning submission_id into v_sub;
  update intel.ci_campaign_deliverable set status='submitted' where deliverable_id=p_deliverable;
  -- advance the participation toward content_submitted through the legal single steps
  if v_stage='product_sent' then perform intel.ci_participation_advance(v_part,'content_created',v_uid,'content created'); v_stage:='content_created'; end if;
  if v_stage in ('content_created','changes_requested') then perform intel.ci_participation_advance(v_part,'content_submitted',v_uid,'content submitted'); end if;
  insert into intel.ci_campaign_event(campaign_id, participation_id, entity, from_status, to_status, actor_member_id, reason)
    values (intel.ci_campaign_of_participation(v_part), v_part, 'submission', null, 'submitted', v_uid, null);
  return jsonb_build_object('submission_id', v_sub);
end $$;

-- ============================ REVIEW (operator OR owning brand org) ============================
create or replace function api.approve_content(p_submission uuid, p_decision text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_org uuid; v_camp uuid; v_camp_org uuid; v_part uuid; v_aid uuid;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  v_uid := auth.uid(); if v_uid is null then raise exception 'unauthenticated' using errcode='28000'; end if;
  if p_decision not in ('approved','changes_requested','rejected') then raise exception 'invalid decision' using errcode='22023'; end if;
  select d.participation_id, p.campaign_id into v_part, v_camp
    from intel.ci_campaign_submission s join intel.ci_campaign_deliverable d on d.deliverable_id=s.deliverable_id
    join intel.ci_campaign_participation p on p.participation_id=d.participation_id
    where s.submission_id=p_submission;
  if v_part is null then raise exception 'submission not found' using errcode='42501'; end if;
  select org_id into v_camp_org from intel.ci_campaign where campaign_id=v_camp;
  v_org := intel.ci_caller_org();
  if not (intel.ci_is_agency_operator() or (v_org is not null and v_org = v_camp_org)) then
    raise exception 'not authorised to review this campaign' using errcode='42501'; end if;
  insert into intel.ci_campaign_approval(submission_id, reviewer_member_id, decision, reason)
    values (p_submission, v_uid, p_decision, p_reason) returning approval_id into v_aid;
  if p_decision='approved' then
    update intel.ci_campaign_deliverable set status='approved' where deliverable_id=(select deliverable_id from intel.ci_campaign_submission where submission_id=p_submission);
    perform intel.ci_participation_advance(v_part, 'content_approved', v_uid, 'content approved');
  else
    perform intel.ci_participation_advance(v_part, case when p_decision='rejected' then 'rejected' else 'changes_requested' end, v_uid, p_reason);
  end if;
  insert into intel.ci_campaign_event(campaign_id, participation_id, entity, from_status, to_status, actor_member_id, reason)
    values (v_camp, v_part, 'approval', null, p_decision, v_uid, p_reason);
  return jsonb_build_object('approval_id', v_aid, 'decision', p_decision);
end $$;

-- ============================ READ: creator "My Campaigns" ============================
create or replace function api.get_my_campaigns()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  v_id := intel.ci_caller_identity();
  return coalesce((select jsonb_agg(jsonb_build_object(
      'participation_id', p.participation_id, 'campaign_id', c.campaign_id, 'campaign', c.name,
      'brand', coalesce(b.name, c.submitted_brand_name), 'product', c.product, 'comp_type', c.comp_type,
      'stage', p.stage, 'reason', p.reason,
      'deadline', (select min(expected_by) from intel.ci_campaign_deliverable d where d.participation_id=p.participation_id),
      'deliverables', coalesce((select jsonb_agg(jsonb_build_object('deliverable_id',d.deliverable_id,'format',d.content_format,'quantity',d.quantity,'expected_by',d.expected_by,'status',d.status) order by d.created_at)
                                from intel.ci_campaign_deliverable d where d.participation_id=p.participation_id),'[]'::jsonb))
      order by p.updated_at desc)
    from intel.ci_campaign_participation p
    join intel.ci_campaign c on c.campaign_id=p.campaign_id
    left join intel.ci_brand b on b.brand_id=c.brand_id
    where p.identity_id=v_id), '[]'::jsonb);
end $$;

-- ============================ READ: agency pipeline (operator) ============================
create or replace function api.get_campaign_pipeline(p_filters jsonb default '{}')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_brand uuid; v_status text; v_category text;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  if not intel.ci_is_agency_operator() then raise exception 'not an agency operator' using errcode='42501'; end if;
  v_brand := nullif(p_filters->>'brand_id','')::uuid; v_status := nullif(p_filters->>'status',''); v_category := nullif(p_filters->>'category','');
  return jsonb_build_object(
    'campaigns', coalesce((select jsonb_agg(jsonb_build_object(
        'campaign_id', c.campaign_id, 'name', c.name, 'brand', coalesce(b.name,c.submitted_brand_name),
        'category', c.category, 'comp_type', c.comp_type, 'lifecycle_status', c.lifecycle_status,
        'stages', coalesce((select jsonb_object_agg(stage, n) from (select stage, count(*) n from intel.ci_campaign_participation pp where pp.campaign_id=c.campaign_id group by stage) s),'{}'::jsonb))
        order by c.created_at desc)
      from intel.ci_campaign c left join intel.ci_brand b on b.brand_id=c.brand_id
      where (v_brand is null or c.brand_id=v_brand) and (v_status is null or c.lifecycle_status=v_status) and (v_category is null or c.category=v_category)),'[]'::jsonb),
    'totals', (select jsonb_build_object(
        'campaigns_running', count(*) filter (where c.lifecycle_status in ('creator_discovery','in_execution','reporting')),
        'contacted', (select count(*) from intel.ci_campaign_participation where stage in ('invited','accepted','product_sent','content_created','content_submitted','content_approved','published','completed')),
        'confirmed', (select count(*) from intel.ci_campaign_participation where stage in ('accepted','product_sent','content_created','content_submitted','content_approved','published','completed')),
        'shipped', (select count(*) from intel.ci_campaign_shipment where status in ('shipped','delivered')),
        'content_pending', (select count(*) from intel.ci_campaign_participation where stage in ('accepted','product_sent','content_created')),
        'approvals_pending', (select count(*) from intel.ci_campaign_participation where stage='content_submitted'),
        'completed', (select count(*) from intel.ci_campaign_participation where stage='completed'))
      from intel.ci_campaign c));
end $$;

-- ============================ READ: creator onboarding status (DERIVED; no duplicate fields) ============================
create or replace function api.get_my_onboarding_status()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid; v_conn boolean; v_pct numeric; v_basic boolean; v_barter boolean; v_rate boolean; v_status text;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  v_id := intel.ci_caller_identity();
  v_conn := exists (select 1 from intel.ci_identity_platform_account ipa join intel.ci_platform_connection c on c.platform_account_id=ipa.platform_account_id
                    where ipa.identity_id=v_id and ipa.valid_to is null and c.status='active');
  select coalesce(completion_pct,0), coalesce(basic_complete,false) into v_pct, v_basic from intel.ci_profile_completion where identity_id=v_id;
  v_pct := coalesce(v_pct,0); v_basic := coalesce(v_basic,false);
  v_barter := exists (select 1 from intel.ci_creator_commercial_preference where identity_id=v_id and accepts_barter is not null);
  v_rate   := exists (select 1 from intel.ci_creator_rate_card where identity_id=v_id and status='active');
  v_status := case
    when not v_conn then 'started'
    when v_conn and v_pct=0 then 'instagram_connected'
    when v_conn and not v_basic then 'profile_incomplete'
    when v_conn and v_basic and v_barter then 'campaign_ready'
    else 'profile_complete' end;
  return jsonb_build_object('status', v_status, 'instagram_connected', v_conn, 'profile_pct', v_pct,
    'basic_complete', v_basic, 'barter_declared', v_barter, 'rate_card_present', v_rate);
end $$;

-- ============================ READ: pilot metrics (operator; evidence-only) ============================
create or replace function api.get_pilot_metrics()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_inv int; v_acc int; v_ship int; v_appr int; v_comp int; v_part int;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  if not intel.ci_is_agency_operator() then raise exception 'not an agency operator' using errcode='42501'; end if;
  select count(*) into v_part from intel.ci_campaign_participation;
  select count(*) into v_inv  from intel.ci_campaign_participation where stage <> 'shortlisted';
  select count(*) into v_acc  from intel.ci_campaign_participation where accepted_at is not null;
  select count(*) into v_ship from intel.ci_campaign_shipment where status in ('shipped','delivered');
  select count(*) into v_appr from intel.ci_campaign_approval where decision='approved';
  select count(*) into v_comp from intel.ci_campaign_participation where stage='completed';
  return jsonb_build_object(
    'participants_total', v_part,
    'acceptance_rate', case when v_inv>0 then round(v_acc::numeric/v_inv,3) else null end,       -- null, never a fake 0
    'delivery_rate',   case when v_acc>0 then round(v_ship::numeric/v_acc,3) else null end,
    'approval_count',  v_appr,
    'completion_rate', case when v_inv>0 then round(v_comp::numeric/v_inv,3) else null end,
    'note','rates are null (not zero) until there is denominator evidence; no fabricated metrics');
end $$;

-- ============================ grants (browser-facing = authenticated + service_role) ============================
do $$ declare fn text; begin
  foreach fn in array array[
    'api.ops_vocab()','api.create_campaign(jsonb)','api.add_campaign_participant(uuid,uuid,text,uuid)',
    'api.add_deliverable(uuid,text,int,date)','api.advance_participation(uuid,text,text)',
    'api.record_shipment(uuid,text,text,text)','api.set_campaign_status(uuid,text,text)',
    'api.respond_to_campaign(uuid,boolean,text)','api.submit_content(uuid,text,text)',
    'api.approve_content(uuid,text,text)','api.get_my_campaigns()','api.get_campaign_pipeline(jsonb)',
    'api.get_my_onboarding_status()','api.get_pilot_metrics()'] loop
    execute 'revoke all on function '||fn||' from public, anon';
    execute 'grant execute on function '||fn||' to authenticated, service_role';
  end loop; end $$;
