-- Guest campaign list (explore): carry the Physical-visit settings too (places + map, covered, dates, payment mode).
do $mig$
declare d text; o text := $o$'campaign_type', br.requirements->>'campaign_type',$o$;
begin
  d := pg_get_functiondef('public.explore_campaigns()'::regprocedure);
  if position(o in d) = 0 then raise exception 'explore_campaigns: marker not found'; end if;
  d := replace(d, o, o || $n$ 'visit', (select pc.contract_terms->'visit' from public.campaigns pc where pc.id = c.legacy_campaign_id and pc.campaign_type = 'visit'),$n$);
  execute d;
end $mig$;
