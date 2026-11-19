-- Brand → creator page: how this creator matches the campaign brief (followers, gender, age, city, Instagram …).
-- Only the brief criteria with ✓/✗ and the creator's value — no phone, email, address or payment details.
create or replace function api.brand_creator_eligibility(p_participation uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare v_c uuid; v_i uuid; v_m uuid; v_e jsonb;
begin
  select campaign_id, identity_id into v_c, v_i from intel.ci_campaign_participation where participation_id = p_participation;
  if v_c is null or not intel.ci_can_manage_participation(p_participation) then
    raise exception 'not your campaign' using errcode = '42501';
  end if;
  v_m := intel.ci_member_of_identity(v_i);
  if v_m is null then return jsonb_build_object('eligible', null, 'criteria', '[]'::jsonb); end if;
  v_e := intel.ci_eligibility(v_c, v_m);
  return jsonb_build_object(
    'eligible', v_e->'eligible',
    'criteria', coalesce((
      select jsonb_agg(jsonb_build_object(
        'need', c->>'need',
        'ok', c->'ok',
        'have', regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(coalesce(c->>'have', ''),
                  '^You have ', 'Has '), '^Your city: ', 'City: '), '^You are ', 'Age '), '^Your profile: ', ''),
                  'not in your profile( yet)?', 'not in their profile yet'), '^Not yet — add it in .*$', 'Not connected yet')))
        from jsonb_array_elements(coalesce(v_e->'criteria', '[]'::jsonb)) c), '[]'::jsonb));
end $fn$;
revoke all on function api.brand_creator_eligibility(uuid) from public, anon;
grant execute on function api.brand_creator_eligibility(uuid) to authenticated;
