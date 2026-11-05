-- Bulk upload: when the sheet differs from Geek OS and the admin chose "Use the sheet", put the sheet's value in
-- place — the campaign invite, the creator's saved (default) address, the latest shipment, the video link.
-- "Keep Geek OS" needs nothing (the app simply doesn't send that detail). Audited in activity_log. ADDITIVE.
create or replace function api.bulk_apply_choice(p_campaign uuid, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare x jsonb; v_ph text; v_em text; v_h text; v_m uuid; v_idn uuid; v_inv uuid; v_part uuid; v_pin text; v_n int := 0;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  p_campaign := intel.ci_resolve_campaign(p_campaign);
  if p_campaign is null then raise exception 'campaign not found' using errcode = '22023'; end if;
  if not intel.ci_can_manage_campaign(p_campaign) then raise exception 'not your campaign' using errcode = '42501'; end if;
  for x in select * from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) loop
    v_ph := intel.ci_norm_phone(x->>'phone');
    v_em := nullif(lower(btrim(coalesce(x->>'email',''))), ''); if v_em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then v_em := null; end if;
    v_h := intel.ci_norm_handle(x->>'handle');
    continue when v_ph is null and v_em is null and v_h is null;
    select invite_id, participation_id into v_inv, v_part from intel.ci_campaign_invite where campaign_id = p_campaign
       and ((v_ph is not null and phone_e164 = v_ph) or (v_em is not null and lower(email) = v_em) or (v_h is not null and lower(handle) = v_h)) limit 1;
    v_m := intel.ci_find_creator(v_ph, v_em, v_h); v_idn := case when v_m is not null then intel.ci_member_identity(v_m) end;
    if v_part is null and v_idn is not null then
      select participation_id into v_part from intel.ci_campaign_participation where campaign_id = p_campaign and identity_id = v_idn limit 1;
    end if;
    if x->>'group' = 'addr' and nullif(btrim(coalesce(x->>'address','')),'') is not null then
      v_pin := nullif(regexp_replace(coalesce(x->>'pincode',''), '\D', '', 'g'), '');
      if v_pin is null then v_pin := substring(x->>'address' from '(?:^|\D)(\d{6})(?:\D|$)'); end if;
      update intel.ci_campaign_invite set ship_address = jsonb_strip_nulls(jsonb_build_object('line1', left(btrim(x->>'address'), 300),
               'city', nullif(btrim(coalesce(x->>'city','')),''), 'state', nullif(btrim(coalesce(x->>'state','')),''), 'postal_code', v_pin))
       where invite_id = v_inv;
      if v_idn is not null then
        update private.creator_address a set line1 = left(btrim(x->>'address'), 300),
               city = coalesce(nullif(btrim(coalesce(x->>'city','')),''), a.city), state = coalesce(nullif(btrim(coalesce(x->>'state','')),''), a.state),
               postal_code = coalesce(v_pin, a.postal_code), updated_at = now()
         where a.address_id = (select address_id from private.creator_address where identity_id = v_idn and deleted_at is null order by is_default desc, confirmed_at desc nulls last limit 1);
      end if;
      v_n := v_n + 1;
    elsif x->>'group' = 'ship' then
      update intel.ci_campaign_invite set courier = coalesce(nullif(btrim(coalesce(x->>'courier','')),''), courier),
             tracking_ref = case when coalesce(x->>'tracking','') ~* '^https?://' then tracking_ref else coalesce(nullif(btrim(coalesce(x->>'tracking','')),''), tracking_ref) end,
             tracking_url = case when coalesce(x->>'tracking','') ~* '^https?://' then btrim(x->>'tracking') else tracking_url end
       where invite_id = v_inv;
      if v_part is not null then
        update intel.ci_campaign_shipment s set courier = coalesce(nullif(btrim(coalesce(x->>'courier','')),''), s.courier),
               tracking_ref = coalesce(nullif(btrim(coalesce(x->>'tracking','')),''), s.tracking_ref)
         where s.shipment_id = (select shipment_id from intel.ci_campaign_shipment where participation_id = v_part order by created_at desc limit 1);
      end if;
      v_n := v_n + 1;
    elsif x->>'group' = 'video' and coalesce(x->>'video_link','') ~* '^https?://' then
      update intel.ci_campaign_invite set video_url = btrim(x->>'video_link') where invite_id = v_inv;
      v_n := v_n + 1;
    end if;
  end loop;
  if v_n > 0 then insert into public.activity_log(member_id, kind, event, detail)
  values (auth.uid(), 'analytics', 'bulk_sheet_values_used', jsonb_build_object('campaign_id', p_campaign, 'changes', v_n)); end if;
  return jsonb_build_object('applied', v_n);
end $$;
revoke all on function api.bulk_apply_choice(uuid, jsonb) from public, anon;
grant execute on function api.bulk_apply_choice(uuid, jsonb) to authenticated;
