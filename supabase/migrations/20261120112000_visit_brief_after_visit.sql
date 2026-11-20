-- Physical visit: after signing, the video brief does NOT go out at once (that is the Paid rule).
-- It goes out when the team marks the creator "Visited" (api.visit_set) — the video deadline starts that day.
do $mig$
declare d text; o text := $o$if not coalesce((v_flow->>'needs_product')::boolean, true) and v_stage = 'contract_signed' then$o$;
begin
  d := pg_get_functiondef('intel.tg_paid_autoflow()'::regprocedure);
  if position('kind'' <> ''visit' in d) > 0 then return; end if;
  if position(o in d) = 0 then raise exception 'tg_paid_autoflow: marker not found'; end if;
  d := replace(d, o, $n$if not coalesce((v_flow->>'needs_product')::boolean, true) and coalesce(v_flow->>'kind', '') <> 'visit' and v_stage = 'contract_signed' then$n$);
  execute d;
end $mig$;

do $mig$
declare d text; o text := $o$  return jsonb_build_object('ok', true, 'state', p_state, 'visit_on', v.visit_on, 'slot', v.slot, 'visited_at', v.visited_at);$o$;
begin
  d := pg_get_functiondef('api.visit_set(uuid,uuid,uuid,text,date,text,text)'::regprocedure);
  if position('ci_participation_advance' in d) > 0 then return; end if;
  if position(o in d) = 0 then raise exception 'visit_set: marker not found'; end if;
  d := replace(d, o, $n$  -- Visited → the video brief goes out and the video deadline starts today
  if p_state = 'visited' and v.participation_id is not null
     and exists (select 1 from intel.ci_campaign_participation where participation_id = v.participation_id and stage = 'contract_signed') then
    perform intel.ci_participation_advance(v.participation_id, 'content_created', auth.uid(), 'visited the place — video brief sent');
  end if;
$n$ || o);
  execute d;
end $mig$;
