-- Brand view: a creator the Geek team only INVITED (not applied, not approved) was shown as "Approved". Show "Invited" instead.
do $mig$
declare d text; o text := $o$when 'invited'           then '{"key":"approved","label":"Approved","step":2}'$o$;
begin
  d := pg_get_functiondef('intel.ci_brand_stage(text)'::regprocedure);
  if position(o in d) = 0 then return; end if;
  d := replace(d, o, $n$when 'invited'           then '{"key":"invited","label":"Invited · waiting for the creator","step":0}'$n$);
  execute d;
end $mig$;
