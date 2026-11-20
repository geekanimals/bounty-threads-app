-- ci_campaign_flow: keep 'visit' as its own kind (it was being folded into 'barter').
do $mig$
declare d text; o text := $o$if v_kind not in ('barter', 'paid', 'barter_paid') then$o$;
begin
  d := pg_get_functiondef('intel.ci_campaign_flow(uuid)'::regprocedure);
  if position(o in d) = 0 then raise exception 'ci_campaign_flow: marker not found'; end if;
  d := replace(d, o, $n$if v_kind not in ('barter', 'paid', 'barter_paid', 'visit') then$n$);
  execute d;
end $mig$;
