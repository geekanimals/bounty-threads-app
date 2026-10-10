-- Phase 1 (barter pipeline) — application-first funnel stages + contract entity. ADDITIVE + DARK.
-- Extends the existing ci_campaign_participation state machine with the brand-in-the-loop funnel the
-- barter process needs, and adds a signed-contract record. Gated by operational_pilot like the rest of
-- the ops layer; legal transitions are enforced by intel.ci_participation_advance (re-created here).
-- Nothing is activated. See docs/BARTER_PIPELINE_PLAN.md.

-- ---------- 1. extend the participation stage vocabulary ----------
-- Drop the old inline CHECK (auto-named) and add a named one covering the funnel stages.
do $$
declare c text;
begin
  select conname into c from pg_constraint
    where conrelid='intel.ci_campaign_participation'::regclass and contype='c'
      and pg_get_constraintdef(oid) like '%shortlisted%';
  if c is not null then execute format('alter table intel.ci_campaign_participation drop constraint %I', c); end if;
  if not exists (select 1 from pg_constraint where conname='ci_participation_stage_ck') then
    alter table intel.ci_campaign_participation
      add constraint ci_participation_stage_ck check (stage in (
        -- application-first funnel (new)
        'applied','eligible','ineligible','sent_to_brand','brand_confirmed','brand_declined',
        'contract_sent','contract_signed','address_confirmed',
        -- existing agency-push + execution stages
        'shortlisted','invited','accepted','rejected','product_sent','content_created',
        'content_submitted','content_approved','changes_requested','published','completed','dropped'));
  end if;
end $$;

-- new per-participation columns: address-confirm gate + opaque shipping address reference (no PII in intel)
alter table intel.ci_campaign_participation
  add column if not exists address_confirmed_at timestamptz,
  add column if not exists shipping_address_id   uuid;   -- opaque id into private.creator_address; resolved by a secure read

-- allow the new entities in the append-only event ledger
do $$
declare c text;
begin
  select conname into c from pg_constraint
    where conrelid='intel.ci_campaign_event'::regclass and contype='c'
      and pg_get_constraintdef(oid) like '%participation%' and pg_get_constraintdef(oid) like '%entity%';
  if c is not null then execute format('alter table intel.ci_campaign_event drop constraint %I', c); end if;
  alter table intel.ci_campaign_event
    add constraint ci_campaign_event_entity_ck check (entity in
      ('campaign','participation','deliverable','shipment','submission','approval','contract','address'));
end $$;

-- ---------- 2. contract record ----------
create table if not exists intel.ci_campaign_contract (
  contract_id       uuid primary key default gen_random_uuid(),
  participation_id  uuid not null unique references intel.ci_campaign_participation(participation_id) on delete cascade,
  campaign_id       uuid not null references intel.ci_campaign(campaign_id) on delete cascade,
  terms_version     text not null default 'asci-v1',
  asci_ack          boolean not null default false,        -- ASCI influencer-advertising guidelines acknowledged
  ad_rights_months  int not null default 1 check (ad_rights_months >= 0),
  ad_rights_until   date,
  collab_rights     boolean not null default false,
  product           text,
  deliverables      jsonb not null default '[]'::jsonb,     -- [{format, quantity}]; empty is not signable (blacklist rule)
  issued_by         uuid references auth.users(id) on delete set null,
  issued_at         timestamptz not null default now(),
  signed_at         timestamptz,
  signature_name    text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists ci_contract_campaign_idx on intel.ci_campaign_contract(campaign_id);
drop trigger if exists ci_contract_updated_at on intel.ci_campaign_contract;
create trigger ci_contract_updated_at before update on intel.ci_campaign_contract
  for each row execute function intel.tg_set_updated_at();
alter table intel.ci_campaign_contract enable row level security;  -- no client policy → service-role / definer only
revoke all on table intel.ci_campaign_contract from anon, authenticated;
grant select, insert, update on table intel.ci_campaign_contract to service_role;

-- ---------- 3. extend the legal transition map ----------
create or replace function intel.ci_participation_advance(p_participation uuid, p_to text, p_actor uuid, p_reason text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare v_from text; v_camp uuid; v_ok boolean; v_needs_reason boolean;
        v_legal jsonb := jsonb_build_object(
          -- application-first funnel
          'applied',        jsonb_build_array('eligible','ineligible','dropped'),
          'eligible',       jsonb_build_array('sent_to_brand','dropped'),
          'sent_to_brand',  jsonb_build_array('brand_confirmed','brand_declined','dropped'),
          'brand_confirmed',jsonb_build_array('contract_sent','dropped'),
          'contract_sent',  jsonb_build_array('contract_signed','dropped'),
          'contract_signed',jsonb_build_array('address_confirmed','dropped'),
          'address_confirmed', jsonb_build_array('product_sent','dropped'),
          -- existing agency-push entry
          'shortlisted', jsonb_build_array('invited','dropped'),
          'invited',     jsonb_build_array('accepted','rejected','dropped'),
          'accepted',    jsonb_build_array('product_sent','dropped'),
          -- shared execution tail
          'product_sent',jsonb_build_array('content_created','dropped'),
          'content_created', jsonb_build_array('content_submitted','dropped'),
          'content_submitted', jsonb_build_array('content_approved','changes_requested','rejected'),
          'changes_requested', jsonb_build_array('content_submitted','dropped'),
          'content_approved', jsonb_build_array('published'),
          'published',   jsonb_build_array('completed'));
begin
  select stage, campaign_id into v_from, v_camp from intel.ci_campaign_participation where participation_id=p_participation;
  if v_from is null then raise exception 'participation not found' using errcode='42501'; end if;
  v_ok := (v_legal ? v_from) and (v_legal->v_from) ? p_to;
  if not v_ok then raise exception 'illegal transition % -> %', v_from, p_to using errcode='22023'; end if;
  v_needs_reason := p_to in ('rejected','dropped','changes_requested','ineligible','brand_declined');
  if v_needs_reason and coalesce(btrim(p_reason),'')='' then
    raise exception 'a reason is required to % a participation', p_to using errcode='22023'; end if;

  update intel.ci_campaign_participation
    set stage=p_to, reason=case when v_needs_reason then p_reason else reason end,
        invited_at  = case when p_to='invited'  then now() else invited_at  end,
        accepted_at = case when p_to='accepted' then now() else accepted_at end,
        rejected_at = case when p_to in ('rejected','ineligible','brand_declined','dropped') then now() else rejected_at end,
        address_confirmed_at = case when p_to='address_confirmed' then now() else address_confirmed_at end
    where participation_id=p_participation;

  insert into intel.ci_campaign_event(campaign_id, participation_id, entity, from_status, to_status, actor_member_id, reason)
    values (v_camp, p_participation, 'participation', v_from, p_to, p_actor, p_reason);
  return p_to;
end $$;
revoke all on function intel.ci_participation_advance(uuid,text,uuid,text) from public, anon, authenticated;
grant execute on function intel.ci_participation_advance(uuid,text,uuid,text) to service_role;

-- ---------- 4. funnel api RPCs ----------
-- 4a. creator applies to a campaign (application-first entry → stage 'applied')
create or replace function api.apply_to_campaign(p_campaign uuid, p_role text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_id uuid; v_pid uuid; v_life text;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  v_uid := auth.uid(); v_id := intel.ci_caller_identity();
  if v_id is null then raise exception 'not a creator' using errcode='42501'; end if;
  select lifecycle_status into v_life from intel.ci_campaign where campaign_id=p_campaign;
  if v_life is null then raise exception 'campaign not found' using errcode='42501'; end if;
  if v_life not in ('creator_discovery','in_execution') then raise exception 'campaign is not open for applications' using errcode='22023'; end if;
  insert into intel.ci_campaign_participation(campaign_id, identity_id, role, stage)
    values (p_campaign, v_id, nullif(p_role,''), 'applied')
    on conflict (campaign_id, identity_id) do nothing returning participation_id into v_pid;
  if v_pid is null then raise exception 'you have already applied to or are on this campaign' using errcode='23505'; end if;
  insert into intel.ci_campaign_event(campaign_id, participation_id, entity, from_status, to_status, actor_member_id, reason)
    values (p_campaign, v_pid, 'participation', null, 'applied', v_uid, 'creator applied');
  return jsonb_build_object('participation_id', v_pid, 'stage', 'applied');
end $$;

-- 4b. operator screens an application against the brand eligibility criteria (applied → eligible | ineligible)
create or replace function api.screen_participation(p_participation uuid, p_eligible boolean, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  v_uid := auth.uid();
  if not intel.ci_is_agency_operator() then raise exception 'not an agency operator' using errcode='42501'; end if;
  return jsonb_build_object('stage', intel.ci_participation_advance(p_participation,
    case when p_eligible then 'eligible' else 'ineligible' end, v_uid, p_reason));
end $$;

-- 4c. operator sends the collated eligible list to the brand (bulk eligible → sent_to_brand)
create or replace function api.send_shortlist_to_brand(p_campaign uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; r record; v_n int := 0;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  v_uid := auth.uid();
  if not intel.ci_is_agency_operator() then raise exception 'not an agency operator' using errcode='42501'; end if;
  for r in select participation_id from intel.ci_campaign_participation where campaign_id=p_campaign and stage='eligible' loop
    perform intel.ci_participation_advance(r.participation_id, 'sent_to_brand', v_uid, 'sent to brand for confirmation');
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('sent', v_n);
end $$;

-- 4d. brand (or operator) confirms/declines a shortlisted creator (sent_to_brand → brand_confirmed | brand_declined)
create or replace function api.brand_decide_participation(p_participation uuid, p_confirm boolean, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_org uuid; v_camp uuid; v_camp_org uuid;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  v_uid := auth.uid(); if v_uid is null then raise exception 'unauthenticated' using errcode='28000'; end if;
  v_camp := intel.ci_campaign_of_participation(p_participation);
  if v_camp is null then raise exception 'participation not found' using errcode='42501'; end if;
  select org_id into v_camp_org from intel.ci_campaign where campaign_id=v_camp;
  v_org := intel.ci_caller_org();
  if not (intel.ci_is_agency_operator() or (v_org is not null and v_org = v_camp_org)) then
    raise exception 'not authorised to decide on this campaign' using errcode='42501'; end if;
  return jsonb_build_object('stage', intel.ci_participation_advance(p_participation,
    case when p_confirm then 'brand_confirmed' else 'brand_declined' end, v_uid, p_reason));
end $$;

-- 4e. operator issues the contract to a confirmed creator (brand_confirmed → contract_sent)
create or replace function api.send_contract(p_participation uuid, p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_camp uuid; v_cid uuid; v_months int; v_deliv jsonb;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  v_uid := auth.uid();
  if not intel.ci_is_agency_operator() then raise exception 'not an agency operator' using errcode='42501'; end if;
  v_camp := intel.ci_campaign_of_participation(p_participation);
  if v_camp is null then raise exception 'participation not found' using errcode='42501'; end if;
  v_months := coalesce(nullif(p_payload->>'ad_rights_months','')::int, 1);
  v_deliv  := coalesce(p_payload->'deliverables', '[]'::jsonb);
  insert into intel.ci_campaign_contract(participation_id, campaign_id, terms_version, ad_rights_months,
      ad_rights_until, collab_rights, product, deliverables, issued_by)
    values (p_participation, v_camp, coalesce(nullif(p_payload->>'terms_version',''),'asci-v1'), v_months,
      (current_date + (v_months || ' months')::interval)::date,
      coalesce((p_payload->>'collab_rights')::boolean,false), nullif(p_payload->>'product',''), v_deliv, v_uid)
    on conflict (participation_id) do update
      set ad_rights_months=excluded.ad_rights_months, ad_rights_until=excluded.ad_rights_until,
          collab_rights=excluded.collab_rights, product=excluded.product, deliverables=excluded.deliverables,
          issued_by=excluded.issued_by, issued_at=now(), updated_at=now()
    returning contract_id into v_cid;
  insert into intel.ci_campaign_event(campaign_id, participation_id, entity, from_status, to_status, actor_member_id, reason)
    values (v_camp, p_participation, 'contract', null, 'issued', v_uid, null);
  perform intel.ci_participation_advance(p_participation, 'contract_sent', v_uid, 'contract issued');
  return jsonb_build_object('contract_id', v_cid, 'stage', 'contract_sent');
end $$;

-- 4f. creator signs the contract (contract_sent → contract_signed). ASCI ack + at least one deliverable required.
create or replace function api.sign_contract(p_participation uuid, p_signature_name text, p_asci_ack boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_id uuid; v_owner uuid; v_deliv jsonb;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  v_uid := auth.uid(); v_id := intel.ci_caller_identity();
  select identity_id into v_owner from intel.ci_campaign_participation where participation_id=p_participation;
  if v_owner is null or v_owner <> v_id then raise exception 'not your contract' using errcode='42501'; end if;
  if not coalesce(p_asci_ack,false) then raise exception 'ASCI guidelines must be acknowledged to sign' using errcode='22023'; end if;
  if coalesce(btrim(p_signature_name),'')='' then raise exception 'a signature name is required' using errcode='22023'; end if;
  select deliverables into v_deliv from intel.ci_campaign_contract where participation_id=p_participation;
  if v_deliv is null then raise exception 'no contract has been issued' using errcode='42501'; end if;
  if jsonb_array_length(v_deliv) = 0 then raise exception 'contract has no deliverables and cannot be signed' using errcode='22023'; end if;
  update intel.ci_campaign_contract set asci_ack=true, signed_at=now(), signature_name=p_signature_name, updated_at=now()
    where participation_id=p_participation;
  insert into intel.ci_campaign_event(campaign_id, participation_id, entity, from_status, to_status, actor_member_id, reason)
    values (intel.ci_campaign_of_participation(p_participation), p_participation, 'contract', 'issued', 'signed', v_uid, null);
  perform intel.ci_participation_advance(p_participation, 'contract_signed', v_uid, 'contract signed');
  return jsonb_build_object('stage', 'contract_signed');
end $$;

-- 4g. creator confirms a delivery address for this campaign (contract_signed → address_confirmed)
create or replace function api.confirm_campaign_address(p_participation uuid, p_address_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_id uuid; v_owner uuid;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  v_uid := auth.uid(); v_id := intel.ci_caller_identity();
  select identity_id into v_owner from intel.ci_campaign_participation where participation_id=p_participation;
  if v_owner is null or v_owner <> v_id then raise exception 'not your participation' using errcode='42501'; end if;
  if not exists (select 1 from private.creator_address where address_id=p_address_id and identity_id=v_id and deleted_at is null) then
    raise exception 'address not found or not yours' using errcode='42501'; end if;
  update intel.ci_campaign_participation set shipping_address_id=p_address_id where participation_id=p_participation;
  insert into intel.ci_campaign_event(campaign_id, participation_id, entity, from_status, to_status, actor_member_id, reason)
    values (intel.ci_campaign_of_participation(p_participation), p_participation, 'address', null, 'confirmed', v_uid, null);
  perform intel.ci_participation_advance(p_participation, 'address_confirmed', v_uid, 'address confirmed');
  return jsonb_build_object('stage', 'address_confirmed');
end $$;

-- 4h. re-create record_shipment so it also advances the application-first path (address_confirmed → product_sent).
-- Byte-identical to 20260929150000 except the auto-advance now fires from 'accepted' OR 'address_confirmed'.
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
  if v_stage in ('accepted','address_confirmed') then perform intel.ci_participation_advance(p_participation, 'product_sent', v_uid, 'product shipped'); end if;
  insert into intel.ci_campaign_event(campaign_id, participation_id, entity, from_status, to_status, actor_member_id, reason)
    values (intel.ci_campaign_of_participation(p_participation), p_participation, 'shipment', null, 'shipped', v_uid, p_tracking);
  return jsonb_build_object('shipment_id', v_sid);
end $$;

-- ---------- grants ----------
do $$ declare fn text; begin
  foreach fn in array array[
    'api.apply_to_campaign(uuid,text)','api.screen_participation(uuid,boolean,text)',
    'api.send_shortlist_to_brand(uuid)','api.brand_decide_participation(uuid,boolean,text)',
    'api.send_contract(uuid,jsonb)','api.sign_contract(uuid,text,boolean)',
    'api.confirm_campaign_address(uuid,uuid)'] loop
    execute 'revoke all on function '||fn||' from public, anon';
    execute 'grant execute on function '||fn||' to authenticated, service_role';
  end loop; end $$;
