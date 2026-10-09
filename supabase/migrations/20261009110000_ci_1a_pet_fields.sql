-- Phase 1A extension: pet fields on the creator personal profile. ADDITIVE + DARK.
-- Reached ONLY through api.save_profile_section('personal', …), which is gated by
-- creator_profile_api (unexposed in production → unreachable). PII stays in `private`.
-- "Pet yes/no, pet name, pet type" from the creator onboarding/profile-completion flow.

-- ---------- columns ----------
alter table private.creator_personal_profile
  add column if not exists has_pet  boolean,
  add column if not exists pet_name text,
  add column if not exists pet_type text;

-- pet_type comes from a small controlled vocabulary (nullable = not provided)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'personal_pet_type_ck') then
    alter table private.creator_personal_profile
      add constraint personal_pet_type_ck
      check (pet_type is null or pet_type in
        ('dog','cat','bird','fish','rabbit','hamster','reptile','horse','small_mammal','other'));
  end if;
  -- name/type may exist ONLY when the creator says they have a pet (mirrors the anniversary rule)
  if not exists (select 1 from pg_constraint where conname = 'personal_pet_requires_haspet_ck') then
    alter table private.creator_personal_profile
      add constraint personal_pet_requires_haspet_ck
      check (coalesce(has_pet, false) or (pet_name is null and pet_type is null));
  end if;
end $$;

comment on column private.creator_personal_profile.has_pet  is 'Creator-entered: does the creator have a pet (optional, private).';
comment on column private.creator_personal_profile.pet_name is 'Creator-entered pet name (optional, private; only when has_pet).';
comment on column private.creator_personal_profile.pet_type is 'Creator-entered pet type from a controlled vocabulary (optional, private; only when has_pet).';

-- ---------- extend save_profile_section (personal branch only; rest unchanged) ----------
-- Re-created from 20260920210029_ci_profile_1a_api.sql with has_pet/pet_name/pet_type added
-- to the personal allow-list and update. get_my_profile already returns to_jsonb(personal),
-- so the new columns surface automatically with no change there.
create or replace function api.save_profile_section(p_section text, p_patch jsonb, p_correlation text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_identity uuid; v_created boolean := false; k text; v_op text;
begin
  perform intel.ci_assert_api_enabled('creator_profile_api');
  v_identity := intel.ci_caller_identity();

  if p_section = 'personal' then
    perform intel.ci_reject_unknown_keys(p_patch, array['first_name','last_name','first_name_confirmed_at','last_name_confirmed_at',
      'gender','date_of_birth','age_band','marital_status','marriage_anniversary','has_pet','pet_name','pet_type']);
    insert into private.creator_personal_profile(identity_id) values (v_identity) on conflict (identity_id) do nothing; v_created := found;
    update private.creator_personal_profile set
      first_name = case when p_patch ? 'first_name' then p_patch->>'first_name' else first_name end,
      last_name  = case when p_patch ? 'last_name'  then p_patch->>'last_name'  else last_name end,
      first_name_confirmed_at = case when p_patch ? 'first_name_confirmed_at' then (p_patch->>'first_name_confirmed_at')::timestamptz else first_name_confirmed_at end,
      last_name_confirmed_at  = case when p_patch ? 'last_name_confirmed_at'  then (p_patch->>'last_name_confirmed_at')::timestamptz else last_name_confirmed_at end,
      gender     = case when p_patch ? 'gender' then p_patch->>'gender' else gender end,
      date_of_birth = case when p_patch ? 'date_of_birth' then (p_patch->>'date_of_birth')::date else date_of_birth end,
      age_band   = case when p_patch ? 'age_band' then p_patch->>'age_band' else age_band end,
      marital_status = case when p_patch ? 'marital_status' then p_patch->>'marital_status' else marital_status end,
      marriage_anniversary = case when p_patch ? 'marriage_anniversary' then (p_patch->>'marriage_anniversary')::date else marriage_anniversary end,
      has_pet  = case when p_patch ? 'has_pet'  then (p_patch->>'has_pet')::boolean else has_pet end,
      pet_name = case when p_patch ? 'pet_name' then p_patch->>'pet_name' else pet_name end,
      pet_type = case when p_patch ? 'pet_type' then p_patch->>'pet_type' else pet_type end,
      updated_at = now()
    where identity_id = v_identity;

  elsif p_section = 'contact' then
    perform intel.ci_reject_unknown_keys(p_patch, array['whatsapp_e164','email','preferred_contact_method','whatsapp_optin','email_optin',
      'comm_consent_version','comm_consent_purpose']);
    insert into private.creator_contact(identity_id) values (v_identity) on conflict (identity_id) do nothing; v_created := found;
    update private.creator_contact set
      whatsapp_e164 = case when p_patch ? 'whatsapp_e164' then p_patch->>'whatsapp_e164' else whatsapp_e164 end,
      email = case when p_patch ? 'email' then p_patch->>'email' else email end,
      preferred_contact_method = case when p_patch ? 'preferred_contact_method' then p_patch->>'preferred_contact_method' else preferred_contact_method end,
      whatsapp_optin = case when p_patch ? 'whatsapp_optin' then (p_patch->>'whatsapp_optin')::boolean else whatsapp_optin end,
      email_optin    = case when p_patch ? 'email_optin' then (p_patch->>'email_optin')::boolean else email_optin end,
      comm_consent_version = case when p_patch ? 'comm_consent_version' then p_patch->>'comm_consent_version' else comm_consent_version end,
      comm_consent_purpose = case when p_patch ? 'comm_consent_purpose' then p_patch->>'comm_consent_purpose' else comm_consent_purpose end,
      updated_at = now()
    where identity_id = v_identity;

  elsif p_section = 'professional' then
    perform intel.ci_reject_unknown_keys(p_patch, array['display_name','city_coarse','state_coarse','categories','languages','bio',
      'visibility_default','content_formats','travel_willingness','availability_status','management_status']);
    insert into intel.ci_creator_professional_profile(identity_id) values (v_identity) on conflict (identity_id) do nothing; v_created := found;
    update intel.ci_creator_professional_profile set
      display_name = case when p_patch ? 'display_name' then p_patch->>'display_name' else display_name end,
      city_coarse  = case when p_patch ? 'city_coarse' then p_patch->>'city_coarse' else city_coarse end,
      state_coarse = case when p_patch ? 'state_coarse' then p_patch->>'state_coarse' else state_coarse end,
      categories   = case when p_patch ? 'categories' then (select array_agg(x) from jsonb_array_elements_text(p_patch->'categories') x) else categories end,
      languages    = case when p_patch ? 'languages' then (select array_agg(x) from jsonb_array_elements_text(p_patch->'languages') x) else languages end,
      bio          = case when p_patch ? 'bio' then p_patch->>'bio' else bio end,
      visibility_default = case when p_patch ? 'visibility_default' then p_patch->>'visibility_default' else visibility_default end,
      content_formats = case when p_patch ? 'content_formats' then (select array_agg(x) from jsonb_array_elements_text(p_patch->'content_formats') x) else content_formats end,
      travel_willingness = case when p_patch ? 'travel_willingness' then p_patch->>'travel_willingness' else travel_willingness end,
      availability_status = case when p_patch ? 'availability_status' then p_patch->>'availability_status' else availability_status end,
      management_status = case when p_patch ? 'management_status' then p_patch->>'management_status' else management_status end,
      updated_at = now()
    where identity_id = v_identity;

  elsif p_section = 'commercial_preference' then
    perform intel.ci_reject_unknown_keys(p_patch, array['accepts_barter','open_to_top_brands','barter_preference','preferred_categories',
      'excluded_categories','min_product_value','product_only','product_plus_travel','product_plus_production_reimbursement',
      'city_only','travel_ready','notes']);
    insert into intel.ci_creator_commercial_preference(identity_id) values (v_identity) on conflict (identity_id) do nothing; v_created := found;
    update intel.ci_creator_commercial_preference set
      accepts_barter = case when p_patch ? 'accepts_barter' then (p_patch->>'accepts_barter')::boolean else accepts_barter end,
      open_to_top_brands = case when p_patch ? 'open_to_top_brands' then (p_patch->>'open_to_top_brands')::boolean else open_to_top_brands end,
      barter_preference = case when p_patch ? 'barter_preference' then p_patch->>'barter_preference' else barter_preference end,
      preferred_categories = case when p_patch ? 'preferred_categories' then (select array_agg(x) from jsonb_array_elements_text(p_patch->'preferred_categories') x) else preferred_categories end,
      excluded_categories = case when p_patch ? 'excluded_categories' then (select array_agg(x) from jsonb_array_elements_text(p_patch->'excluded_categories') x) else excluded_categories end,
      min_product_value = case when p_patch ? 'min_product_value' then (p_patch->>'min_product_value')::numeric else min_product_value end,
      product_only = case when p_patch ? 'product_only' then (p_patch->>'product_only')::boolean else product_only end,
      product_plus_travel = case when p_patch ? 'product_plus_travel' then (p_patch->>'product_plus_travel')::boolean else product_plus_travel end,
      product_plus_production_reimbursement = case when p_patch ? 'product_plus_production_reimbursement' then (p_patch->>'product_plus_production_reimbursement')::boolean else product_plus_production_reimbursement end,
      city_only = case when p_patch ? 'city_only' then (p_patch->>'city_only')::boolean else city_only end,
      travel_ready = case when p_patch ? 'travel_ready' then (p_patch->>'travel_ready')::boolean else travel_ready end,
      notes = case when p_patch ? 'notes' then p_patch->>'notes' else notes end,
      last_confirmed_at = now(), updated_at = now()
    where identity_id = v_identity;
  else
    raise exception 'unknown profile section: %', p_section using errcode = '22023';
  end if;

  if v_created then perform intel.ci_write_audit(v_identity, p_section, null, p_section, 'created', p_correlation); end if;
  for k in select jsonb_object_keys(p_patch) loop
    v_op := case when (p_patch->>k) is null then 'cleared' else 'changed' end;
    perform intel.ci_write_audit(v_identity, p_section, null, k, v_op, p_correlation);
  end loop;
end;
$$;
