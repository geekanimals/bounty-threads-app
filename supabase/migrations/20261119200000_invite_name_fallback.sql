-- Join-link WhatsApp: when the invite has no name, greet with the Instagram handle instead of "Hi there".
do $mig$
declare d text := pg_get_functiondef('private.tg_snapto_invite()'::regprocedure);
begin
  if position('NEW.handle' in d) = 0 then
    d := regexp_replace(d, '(v_first\s*:=\s*coalesce\(nullif\(split_part\(btrim\(coalesce\(NEW\.full_name, ''''\)\), '' '', 1\), ''''\)),\s*''there''\)',
                        '\1, nullif(btrim(replace(coalesce(NEW.handle, ''''), ''@'', '''')), ''''), ''there'')');
    if position('NEW.handle' in d) = 0 then raise exception 'tg_snapto_invite: patch point not found'; end if;
    execute d;
  end if;
end $mig$;
