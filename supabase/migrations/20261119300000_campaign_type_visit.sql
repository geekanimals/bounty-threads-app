-- New campaign type: Physical visit ('visit'). The creator goes to a place (restaurant, hotel, club, store, event);
-- no product is shipped. Settings live in public.campaigns.contract_terms->'visit':
--   mode: 'paid' (visit + payment) | 'experience' (free stay / food / entry, no payment)
--   reach: 'local' (only creators near the venue) | 'travel_covered' (anyone; travel + stay paid — e.g. bigger creators) | 'travel_own'
--   venues: [{name, address, map_url, city}], covers: [food, stay, entry, travel], plus_one, window_start/end, slots,
--   pay_mode: 'advance' (part before, rest after) | 'full_after', advance_pct
alter table public.campaigns drop constraint if exists campaigns_campaign_type_check;
alter table public.campaigns add constraint campaigns_campaign_type_check
  check (campaign_type is null or campaign_type = any (array['barter', 'paid', 'barter_paid', 'visit']));
alter table intel.ci_brand_campaign_request drop constraint if exists ci_brand_campaign_request_campaign_type_check;
alter table intel.ci_brand_campaign_request add constraint ci_brand_campaign_request_campaign_type_check
  check (campaign_type = any (array['barter', 'paid', 'barter_paid', 'visit']));

-- flow: a visit never needs a product; it is "paid" only in visit-with-payment mode; the visit settings ride along
do $mig$
declare d text; o text := $o$'needs_product', v_kind <> 'paid', 'paid', v_kind in ('paid', 'barter_paid'), 'due_days', v_due)$o$;
begin
  d := pg_get_functiondef('intel.ci_campaign_flow(uuid)'::regprocedure);
  if position(o in d) = 0 then raise exception 'ci_campaign_flow: patch marker not found'; end if;
  d := replace(d, o, $n$'needs_product', v_kind not in ('paid', 'visit'),
    'paid', v_kind in ('paid', 'barter_paid') or (v_kind = 'visit' and coalesce((select pc2.contract_terms->'visit'->>'mode' from public.campaigns pc2 where pc2.id = v_legacy), 'paid') = 'paid'),
    'visit', case when v_kind = 'visit' then (select pc2.contract_terms->'visit' from public.campaigns pc2 where pc2.id = v_legacy) end,
    'due_days', v_due)$n$);
  execute d;
end $mig$;
