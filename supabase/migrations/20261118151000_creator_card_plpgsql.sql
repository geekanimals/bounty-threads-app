-- intel.ci_public_creator_card is called once per row in api.campaign_people / approvals_inbox (200+ rows).
-- As LANGUAGE sql + SECURITY DEFINER + SET search_path it can't be inlined, so Postgres re-plans it on every call
-- (planning alone was ~0.4 s per call under load). Same body, as plpgsql → plan cached per session.
do $do$
declare r record; v_def text; v_body text; v_new text;
begin
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'intel' and p.proname = 'ci_public_creator_card' and p.prolang = (select oid from pg_language where lanname = 'sql') loop
    v_def := pg_get_functiondef(r.oid);
    v_body := substring(v_def from '\$function\$(.*)\$function\$');
    v_body := regexp_replace(btrim(v_body, E' \n\t'), ';\s*$', '');
    if position(';' in v_body) > 0 then raise notice 'skip % (multi-statement)', r.oid::regprocedure; continue; end if;
    v_new := replace(left(v_def, position('AS $function$' in v_def) - 1), 'LANGUAGE sql', 'LANGUAGE plpgsql')
             || 'AS $function$ begin return (' || v_body || '); end $function$';
    execute v_new;
  end loop;
end $do$;

-- same for the small per-row helpers used by api.campaign_people (checked: identical output on all participations)
do $do$ declare r record; v_def text; v_body text; v_new text;
begin
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_language l on l.oid = p.prolang
            where n.nspname = 'intel' and l.lanname = 'sql' and p.proname in ('ci_member_phone','ci_profile_pct','ci_join_needs','ci_joined_via','ci_member_of_identity') loop
    v_def := pg_get_functiondef(r.oid);
    v_body := substring(v_def from '\$function\$(.*)\$function\$');
    v_body := regexp_replace(btrim(v_body, E' \n\t'), ';\s*$', '');
    if v_body is null or position(';' in v_body) > 0 or v_body !~* '^\s*(select|with)\M' then continue; end if;
    v_new := replace(left(v_def, position('AS $function$' in v_def) - 1), 'LANGUAGE sql', 'LANGUAGE plpgsql')
             || 'AS $function$ begin return (' || v_body || '); end $function$';
    execute v_new;
  end loop;
end $do$;
