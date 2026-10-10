-- Phase 4 (barter pipeline) — courier tracking (DTDC / Amazon). ADDITIVE + DARK.
-- Adds carrier metadata to shipments and a single status-setter that writes the shipment event; the
-- existing notify trigger turns a 'delivered' event into the parcel-received push + re-arms the 3-day video
-- SLA. The ops-tracking-worker edge function polls the carrier and calls these; operators can also set
-- status manually. Gated by operational_pilot. No PII; nothing activated.

alter table intel.ci_campaign_shipment
  add column if not exists carrier_code    text,     -- 'dtdc' | 'amazon' | … (adapter key)
  add column if not exists last_tracked_at timestamptz,
  add column if not exists tracking_status text,     -- raw carrier status label (free text)
  add column if not exists tracking_payload jsonb;

-- single legal way to change a shipment's status: updates the row and appends the shipment event.
-- entity='shipment', to_status='delivered' is what the Phase 1 notify trigger turns into parcel_received.
create or replace function intel.ci_shipment_set_status(p_shipment uuid, p_status text, p_actor uuid, p_raw jsonb default '{}'::jsonb)
returns text language plpgsql security definer set search_path = '' as $$
declare v_old text; v_part uuid; v_camp uuid;
begin
  if p_status not in ('pending','shipped','delivered','failed') then raise exception 'invalid shipment status %', p_status using errcode='22023'; end if;
  select status, participation_id into v_old, v_part from intel.ci_campaign_shipment where shipment_id=p_shipment;
  if v_part is null then raise exception 'shipment not found' using errcode='42501'; end if;
  v_camp := intel.ci_campaign_of_participation(v_part);
  update intel.ci_campaign_shipment set
    status = p_status,
    delivered_at = case when p_status='delivered' then coalesce(delivered_at, now()) else delivered_at end,
    tracking_status = coalesce(nullif(p_raw->>'tracking_status',''), tracking_status),
    tracking_payload = case when p_raw ? 'payload' then p_raw->'payload' else tracking_payload end,
    last_tracked_at = now()
  where shipment_id=p_shipment;
  if v_old is distinct from p_status then
    insert into intel.ci_campaign_event(campaign_id, participation_id, entity, from_status, to_status, actor_member_id, reason)
      values (v_camp, v_part, 'shipment', v_old, p_status, p_actor, nullif(p_raw->>'note',''));
  end if;
  return p_status;
end $$;
revoke all on function intel.ci_shipment_set_status(uuid,text,uuid,jsonb) from public, anon, authenticated;
grant execute on function intel.ci_shipment_set_status(uuid,text,uuid,jsonb) to service_role;

-- operator manual status update (fallback when a carrier isn't integrated)
create or replace function api.update_shipment_status(p_shipment uuid, p_status text, p_tracking text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  v_uid := auth.uid();
  if not intel.ci_is_agency_operator() then raise exception 'not an agency operator' using errcode='42501'; end if;
  if p_tracking is not null then update intel.ci_campaign_shipment set tracking_ref=nullif(p_tracking,'') where shipment_id=p_shipment; end if;
  return jsonb_build_object('status', intel.ci_shipment_set_status(p_shipment, p_status, v_uid, '{}'::jsonb));
end $$;
revoke all on function api.update_shipment_status(uuid,text,text) from public, anon;
grant execute on function api.update_shipment_status(uuid,text,text) to authenticated, service_role;

-- operator convenience for the UI: set the latest shipment's status for a participation (manual delivered/failed)
create or replace function api.mark_shipment_status_by_participation(p_participation uuid, p_status text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_ship uuid;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  v_uid := auth.uid();
  if not intel.ci_is_agency_operator() then raise exception 'not an agency operator' using errcode='42501'; end if;
  select shipment_id into v_ship from intel.ci_campaign_shipment where participation_id=p_participation order by created_at desc limit 1;
  if v_ship is null then raise exception 'no shipment for this participation' using errcode='42501'; end if;
  return jsonb_build_object('status', intel.ci_shipment_set_status(v_ship, p_status, v_uid, '{}'::jsonb));
end $$;
revoke all on function api.mark_shipment_status_by_participation(uuid,text) from public, anon;
grant execute on function api.mark_shipment_status_by_participation(uuid,text) to authenticated, service_role;

-- worker input: shipments that are in transit and have something to poll
create or replace function intel.ci_shipments_to_track(p_limit int default 200)
returns table(shipment_id uuid, courier text, carrier_code text, tracking_ref text)
language sql stable security definer set search_path = '' as $$
  select shipment_id, courier, carrier_code, tracking_ref
  from intel.ci_campaign_shipment
  where status in ('shipped') and coalesce(tracking_ref,'') <> ''
  order by coalesce(last_tracked_at, to_timestamp(0)) asc
  limit greatest(p_limit,1)
$$;
revoke all on function intel.ci_shipments_to_track(int) from public, anon, authenticated;
grant execute on function intel.ci_shipments_to_track(int) to service_role;
