-- Creator campaign list: carry the Physical-visit settings (venues + map, what's covered, slots, payment mode).
do $mig$
declare d text; o text := $o$'terms', (intel.ci_playbook(c.campaign_id)->'contract') - 'product' - 'extra_terms',$o$;
begin
  d := pg_get_functiondef('api.list_open_campaigns()'::regprocedure);
  if position(o in d) = 0 then raise exception 'list_open_campaigns: patch marker not found'; end if;
  d := replace(d, o, o || $n$
      'visit', (select pc.contract_terms->'visit' from public.campaigns pc where pc.id = c.legacy_campaign_id and pc.campaign_type = 'visit'),$n$);
  execute d;
end $mig$;
