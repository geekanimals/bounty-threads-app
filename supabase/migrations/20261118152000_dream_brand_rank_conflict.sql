-- Creators were failing to save dream brands (onboarding "brands" step):
--   duplicate key value violates unique constraint "aspiration_active_rank_uq" (identity_id, priority_rank)
-- The app sends rank = position in the new list while older brands keep their old ranks, so a new brand can
-- ask for a rank another active brand already holds. If the asked rank is taken, give the next free rank.
do $do$
declare v_def text; v_fix text := $fix$
  if p_payload ? 'priority_rank' and nullif(p_payload->>'priority_rank','') is not null
     and exists (select 1 from intel.ci_creator_brand_aspiration a
                  where a.identity_id = v_identity and a.active and a.priority_rank = (p_payload->>'priority_rank')::int
                    and (not (p_payload ? 'aspiration_id') or a.aspiration_id <> (p_payload->>'aspiration_id')::uuid)) then
    p_payload := jsonb_set(p_payload, '{priority_rank}', to_jsonb(coalesce((select max(a.priority_rank) from intel.ci_creator_brand_aspiration a
                                                                           where a.identity_id = v_identity and a.active), 0) + 1));
  end if;
$fix$;
begin
  v_def := pg_get_functiondef('api.upsert_dream_brand(jsonb, text)'::regprocedure);
  if position('next free rank' in v_def) = 0 and position($m$'notes','active']);$m$ in v_def) > 0 then
    v_def := replace(v_def, $m$'notes','active']);$m$, $m$'notes','active']);$m$ || E'\n  -- next free rank' || v_fix);
    execute v_def;
  end if;
end $do$;
