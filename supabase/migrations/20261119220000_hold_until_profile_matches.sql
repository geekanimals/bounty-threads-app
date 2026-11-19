-- Creators who joined from a bulk invite skipped the apply check. They stay in the campaign, but can't be
-- sent to the brand until their profile matches the brief (gender, birthday, Instagram, city …). Their
-- campaign page shows "Add your gender / birthday …" buttons. Bulk sheet syncs that confirm offline work
-- ("confirmed offline — bulk upload") are not blocked.
do $mig$
declare d text := pg_get_functiondef('intel.ci_participation_advance(uuid,text,uuid,text)'::regprocedure);
begin
  if position('profile doesn''''t match the brief yet' in d) = 0 then
    d := regexp_replace(d,
      '(if not v_ok then raise exception ''illegal transition % -> %'', v_from, p_to using errcode\s*=\s*''22023''; end if;)',
      E'\\1\n  -- hold: not to the brand until the profile matches the brief\n  if p_to = ''sent_to_brand'' and coalesce(p_reason, '''') !~* ''^confirmed offline'' then\n    declare v_m uuid := intel.ci_member_of_identity((select identity_id from intel.ci_campaign_participation where participation_id = p_participation)); v_e jsonb; v_miss text;\n    begin\n      if v_m is not null then\n        v_e := intel.ci_eligibility(v_camp, v_m);\n        if (v_e->>''eligible'')::boolean is false then\n          select string_agg(c->>''need'', '', '') into v_miss from jsonb_array_elements(coalesce(v_e->''criteria'', ''[]''::jsonb)) c where (c->>''ok'')::boolean is not true;\n          raise exception ''Their profile doesn''''t match the brief yet: %. They see "Add your …" buttons on the campaign — send them once it''''s filled.'', coalesce(v_miss, ''missing details'') using errcode = ''22023'';\n        end if;\n      end if;\n    end;\n  end if;');
    if position('profile doesn''''t match the brief yet' in d) = 0 then raise exception 'ci_participation_advance: patch point not found'; end if;
    execute d;
  end if;
end $mig$;
