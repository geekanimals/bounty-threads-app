-- Phase 1D pilot — brand DECISION fields (category/formats/brand-history/barter/rate) + pilot feedback.
-- ADDITIVE + DARK. Adds a SEPARATE authorised RPC for the campaign-decision block (the proven
-- ci_serve_intelligence is left untouched), and a feedback store. Everything is flag- + cohort-gated via
-- ci_assert_api_enabled. Rates and brand-history are shown to brands ONLY when the creator has opted in
-- through the existing visibility controls (the "approved workflow"); private contact is never exposed.
-- Each field carries a status: observed | derived | unavailable | insufficient_data | not_shared.

-- ============================ commercial / campaign-fit readiness ============================
create or replace function intel.ci_serve_commercial(p_identity uuid, p_tier text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_cats text[]; v_formats text[]; v_cp record; v_rc record;
        v_min numeric; v_max numeric; v_be_visible boolean; v_be_count int; v_rate_opt_in boolean;
begin
  select categories, content_formats into v_cats, v_formats
    from intel.ci_creator_professional_profile where identity_id=p_identity;
  select accepts_barter, barter_preference, min_product_value, open_to_top_brands, travel_ready
    into v_cp from intel.ci_creator_commercial_preference where identity_id=p_identity;

  -- brand experience: confirmed, non-rejected count; brand tier sees it only if the creator opted in
  select count(*) into v_be_count from intel.ci_creator_brand_experience
    where identity_id=p_identity and creator_confirmed_at is not null and creator_rejected_at is null;
  v_be_visible := (p_tier='self') or exists (
    select 1 from intel.ci_profile_visibility
    where identity_id=p_identity and field_or_group='brand_experience' and allowed
      and tier in ('marketplace_summary','organisation_roster','campaign_specific'));

  -- rate indication: only from an active rate card the creator made non-private (approved workflow)
  select rc.rate_card_id, rc.currency, rc.negotiable, rc.visibility into v_rc
    from intel.ci_creator_rate_card rc where rc.identity_id=p_identity and rc.status='active'
    order by rc.updated_at desc limit 1;
  v_rate_opt_in := (v_rc.rate_card_id is not null) and ( p_tier='self' or v_rc.visibility is distinct from 'private' );
  if v_rate_opt_in then
    select min(amount), max(amount) into v_min, v_max
      from intel.ci_creator_rate_card_item where rate_card_id=v_rc.rate_card_id;
  end if;

  return jsonb_build_object(
    'category_signals', jsonb_build_object(
       'status', case when v_cats is not null and array_length(v_cats,1)>0 then 'observed' else 'insufficient_data' end,
       'categories', coalesce(to_jsonb(v_cats), '[]'::jsonb)),
    'content_formats', jsonb_build_object(
       'status', case when v_formats is not null and array_length(v_formats,1)>0 then 'observed' else 'insufficient_data' end,
       'formats', coalesce(to_jsonb(v_formats), '[]'::jsonb)),
    'brand_history', case when not v_be_visible then jsonb_build_object('status','not_shared','reason','creator_has_not_shared_brand_history')
       when v_be_count>0 then jsonb_build_object('status','observed','confirmed_count', v_be_count)
       else jsonb_build_object('status','insufficient_data','confirmed_count',0) end,
    'barter_readiness', case when v_cp.accepts_barter is null then jsonb_build_object('status','insufficient_data')
       else jsonb_build_object('status','observed','accepts_barter', v_cp.accepts_barter,
            'preference', v_cp.barter_preference, 'min_product_value', v_cp.min_product_value,
            'open_to_top_brands', v_cp.open_to_top_brands, 'travel_ready', v_cp.travel_ready) end,
    'rate_indication', case when not v_rate_opt_in then jsonb_build_object('status','not_shared','reason','rate_card_private_or_absent')
       when v_min is null then jsonb_build_object('status','insufficient_data')
       else jsonb_build_object('status','derived','currency', v_rc.currency, 'negotiable', v_rc.negotiable,
            'indicative_min', v_min, 'indicative_max', v_max, 'note','indicative range only; negotiated commercials are never shown') end
    -- NOTE: no contact, no exact private line-items beyond a range, no raw messages, no tokens.
  );
end $$;
revoke all on function intel.ci_serve_commercial(uuid,text) from public, anon, authenticated;
grant execute on function intel.ci_serve_commercial(uuid,text) to service_role;

create or replace function api.get_creator_commercial_readiness(p_identity_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform intel.ci_assert_api_enabled('creator_profile_api');
  if auth.uid() is null then raise exception 'unauthenticated' using errcode='28000'; end if;
  if not intel.ci_brand_can_view(p_identity_id) then
    raise exception 'not authorised to view this creator' using errcode='42501';
  end if;
  return jsonb_build_object('creator_identity', jsonb_build_object('identity_id', p_identity_id))
      || intel.ci_serve_commercial(p_identity_id, 'brand');
end $$;

create or replace function api.get_my_commercial_readiness()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform intel.ci_assert_api_enabled('creator_profile_api');
  v_id := intel.ci_caller_identity();
  return jsonb_build_object('creator_identity', jsonb_build_object('identity_id', v_id))
      || intel.ci_serve_commercial(v_id, 'self');
end $$;

-- ============================ pilot feedback (stored separately) ============================
create table if not exists intel.ci_pilot_feedback (
  feedback_id  uuid primary key default gen_random_uuid(),
  subject_kind text not null check (subject_kind in ('creator','brand')),
  member_id    uuid not null references auth.users(id) on delete cascade,
  identity_id  uuid references intel.ci_creator_identity(identity_id) on delete set null,
  org_id       uuid,
  answers      jsonb not null,                 -- free-form structured answers; no PII required
  submitted_at timestamptz not null default now()
);
create index if not exists ci_pilot_feedback_kind_idx on intel.ci_pilot_feedback(subject_kind, submitted_at desc);
alter table intel.ci_pilot_feedback enable row level security;
revoke all on table intel.ci_pilot_feedback from anon, authenticated;
grant select, insert, update, delete on table intel.ci_pilot_feedback to service_role;

create or replace function api.submit_pilot_feedback(p_role text, p_answers jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_id uuid; v_org uuid; v_fid uuid;
begin
  perform intel.ci_assert_api_enabled('creator_profile_api');
  v_uid := auth.uid(); if v_uid is null then raise exception 'unauthenticated' using errcode='28000'; end if;
  if p_role not in ('creator','brand') then raise exception 'invalid feedback role' using errcode='22023'; end if;
  begin v_id := intel.ci_caller_identity(); exception when others then v_id := null; end;
  v_org := intel.ci_caller_org();
  insert into intel.ci_pilot_feedback(subject_kind, member_id, identity_id, org_id, answers)
    values (p_role, v_uid, v_id, v_org, coalesce(p_answers,'{}'::jsonb)) returning feedback_id into v_fid;
  return jsonb_build_object('ok', true, 'feedback_id', v_fid);
end $$;

-- ============================ grants ============================
do $$ declare fn text; begin
  foreach fn in array array['api.get_creator_commercial_readiness(uuid)','api.get_my_commercial_readiness()','api.submit_pilot_feedback(text,jsonb)'] loop
    execute 'revoke all on function '||fn||' from public, anon';
    execute 'grant execute on function '||fn||' to authenticated, service_role';
  end loop; end $$;
