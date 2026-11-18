-- Campaign form "Instagram account requirement" → ideal_profile.instagram
--   verified = creator must have Instagram connected on Geek OS
--   handle   = any Instagram handle on their profile is enough
--   (empty / none = no Instagram rule here)
-- Checked when a creator applies (intel.ci_eligibility), like every other eligibility rule.
do $do$
declare d text; blk text;
begin
  d := pg_get_functiondef('intel.ci_eligibility(uuid,uuid)'::regprocedure);
  if position('''key'',''instagram''' in d) > 0 then return; end if;
  blk := $b$
  -- Instagram account requirement (campaign form): verified = connected on Geek OS · handle = any Instagram handle on the profile
  if lower(coalesce(v_ideal->>'instagram','')) in ('verified','handle') then
    ok := exists (select 1 from public.social_accounts sa where sa.member_id = p_member and sa.platform = 'instagram' and coalesce(sa.username,'') <> '')
          or exists (select 1 from private.ig_linked_accounts l where l.member_id = p_member);
    if lower(v_ideal->>'instagram') = 'handle' and not ok then
      ok := v_id is not null and exists (select 1 from intel.ci_creator_professional_profile pp where pp.identity_id = v_id and coalesce(btrim(pp.ig_handle_self),'') <> '');
    end if;
    c := c || jsonb_build_object('key','instagram','ok',coalesce(ok,false),
      'need', case when lower(v_ideal->>'instagram') = 'verified' then 'Instagram connected on Geek OS' else 'An Instagram handle on your profile' end,
      'have', case when ok then 'Yes' else 'Not yet — add it in your profile' end);
  end if;

  return jsonb_build_object('eligible',$b$;
  d := replace(d, E'\n  return jsonb_build_object(''eligible'',', blk);
  if position('''key'',''instagram''' in d) = 0 then raise exception 'anchor not found'; end if;
  execute d;
end $do$;
