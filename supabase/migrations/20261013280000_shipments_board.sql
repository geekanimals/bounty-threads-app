-- Logistics reads the real barter-process shipments, not just the legacy barter_items list.
-- One row per creator shipment, across every campaign the caller can see (all of them for the Super Admin),
-- with the courier, the tracking reference, when it left and when the creator received it. ADDITIVE.

create or replace function api.shipments_board()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_admin boolean; v_org uuid;
begin
  if v_uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  v_admin := public.is_platform_admin();
  select org_id into v_org from public.members where id = v_uid;

  return coalesce((select jsonb_agg(r order by (r->>'sort') desc) from (
    select jsonb_build_object(
      'shipment_id', s.shipment_id, 'participation_id', p.participation_id,
      'campaign_id', c.campaign_id, 'campaign', c.name,
      'brand', coalesce(b.name, c.submitted_brand_name),
      'org_name', (select m.org_name from public.members m where m.org_id = c.org_id and m.org_name is not null limit 1),
      'creator', intel.ci_public_creator_card(p.identity_id),
      'product', coalesce(s.product, c.product), 'courier', s.courier, 'tracking_ref', s.tracking_ref,
      'status', s.status, 'shipped_at', s.shipped_at, 'delivered_at', s.delivered_at,
      'stage', p.stage,
      -- a shipment with no address on file is the one that stalls, so it is flagged here
      'has_address', exists (select 1 from private.creator_address a where a.identity_id = p.identity_id and a.deleted_at is null),
      'sort', coalesce(s.delivered_at, s.shipped_at, s.created_at)) r
      from intel.ci_campaign_shipment s
      join intel.ci_campaign_participation p on p.participation_id = s.participation_id
      join intel.ci_campaign c on c.campaign_id = p.campaign_id
      left join intel.ci_brand b on b.brand_id = c.brand_id
     where v_admin or (c.org_id is not null and c.org_id = v_org)
     order by coalesce(s.delivered_at, s.shipped_at, s.created_at) desc
     limit 300) x), '[]'::jsonb);
end $$;
revoke all on function api.shipments_board() from public, anon;
grant execute on function api.shipments_board() to authenticated;
