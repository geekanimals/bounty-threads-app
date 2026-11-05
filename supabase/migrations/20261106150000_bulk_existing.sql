-- Bulk upload: what the site ALREADY has for each sheet row (this campaign's invite / participation, the creator's
-- saved address, the shipment). A blank cell is fine when the site already has it; a later step still needs every
-- earlier step's details — from the sheet or from here. Same matching as bulk_preview. Read-only. ADDITIVE.
create or replace function api.bulk_existing(p_campaign uuid, p_rows jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare x jsonb; out jsonb := '[]'::jsonb; v_ph text; v_em text; v_h text; v_m uuid; v_idn uuid;
        v_inv intel.ci_campaign_invite%rowtype; v_part uuid; v_stage text; v_addr jsonb; v_sc text; v_str text;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  p_campaign := intel.ci_resolve_campaign(p_campaign);
  if p_campaign is null then raise exception 'campaign not found — save it first' using errcode = '22023'; end if;
  if not intel.ci_can_manage_campaign(p_campaign) then raise exception 'not your campaign' using errcode = '42501'; end if;
  for x in select * from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) loop
    v_ph := intel.ci_norm_phone(x->>'phone');
    v_em := nullif(lower(btrim(coalesce(x->>'email',''))), ''); if v_em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then v_em := null; end if;
    v_h := intel.ci_norm_handle(x->>'handle');
    v_inv := null; v_part := null; v_stage := null; v_addr := null; v_idn := null; v_m := null;
    if v_ph is not null or v_em is not null or v_h is not null then
      select * into v_inv from intel.ci_campaign_invite where campaign_id = p_campaign
         and ((v_ph is not null and phone_e164 = v_ph) or (v_em is not null and lower(email) = v_em) or (v_h is not null and lower(handle) = v_h)) limit 1;
      v_m := intel.ci_find_creator(v_ph, v_em, v_h);
      if v_m is not null then v_idn := intel.ci_member_identity(v_m); end if;
      select p.participation_id, p.stage into v_part, v_stage from intel.ci_campaign_participation p
       where p.campaign_id = p_campaign and (p.participation_id = v_inv.participation_id or (v_idn is not null and p.identity_id = v_idn)) limit 1;
      if v_idn is not null then
        select jsonb_build_object('line1', a.line1, 'city', a.city, 'state', a.state, 'pin', a.postal_code) into v_addr
          from private.creator_address a where a.identity_id = v_idn and a.deleted_at is null order by a.is_default desc, a.confirmed_at desc nulls last limit 1;
      end if;
    end if;
    v_sc := null; v_str := null;
    if v_part is not null then
      select s.courier, s.tracking_ref into v_sc, v_str from intel.ci_campaign_shipment s where s.participation_id = v_part order by s.created_at desc limit 1;
    end if;
    out := out || jsonb_build_array(jsonb_build_object(
      'stage', v_stage, 'invite_status', v_inv.status,
      'address', coalesce(nullif(btrim(v_inv.ship_address->>'line1'),''), nullif(btrim(v_addr->>'line1'),'')) is not null,
      'city',    coalesce(nullif(btrim(v_inv.ship_address->>'city'),''), nullif(btrim(v_addr->>'city'),'')) is not null,
      'state',   coalesce(nullif(btrim(v_inv.ship_address->>'state'),''), nullif(btrim(v_addr->>'state'),'')) is not null,
      'pincode', coalesce(nullif(btrim(v_inv.ship_address->>'postal_code'),''), nullif(btrim(v_addr->>'pin'),'')) is not null,
      'courier', coalesce(nullif(btrim(v_inv.courier),''), nullif(btrim(v_sc),'')) is not null,
      'tracking', coalesce(nullif(btrim(v_inv.tracking_ref),''), nullif(btrim(v_inv.tracking_url),''), nullif(btrim(v_str),'')) is not null,
      'video', v_inv.video_url is not null,
      'posts', cardinality(coalesce(v_inv.post_links, '{}')) > 0,
      -- the values themselves, so the app can ask "keep Geek OS or use the sheet?" when they differ
      'vals', jsonb_strip_nulls(jsonb_build_object(
        'address', coalesce(nullif(btrim(v_addr->>'line1'),''), nullif(btrim(v_inv.ship_address->>'line1'),'')),
        'city',    coalesce(nullif(btrim(v_addr->>'city'),''), nullif(btrim(v_inv.ship_address->>'city'),'')),
        'state',   coalesce(nullif(btrim(v_addr->>'state'),''), nullif(btrim(v_inv.ship_address->>'state'),'')),
        'pincode', coalesce(nullif(btrim(v_addr->>'pin'),''), nullif(btrim(v_inv.ship_address->>'postal_code'),'')),
        'addr_by', case when nullif(btrim(v_addr->>'line1'),'') is not null then 'creator' when nullif(btrim(v_inv.ship_address->>'line1'),'') is not null then 'sheet' end,
        'courier', coalesce(nullif(btrim(v_sc),''), nullif(btrim(v_inv.courier),'')),
        'tracking', coalesce(nullif(btrim(v_str),''), nullif(btrim(v_inv.tracking_ref),''), nullif(btrim(v_inv.tracking_url),'')),
        'video', v_inv.video_url))));
  end loop;
  return out;
end $$;
revoke all on function api.bulk_existing(uuid, jsonb) from public, anon;
grant execute on function api.bulk_existing(uuid, jsonb) to authenticated;
