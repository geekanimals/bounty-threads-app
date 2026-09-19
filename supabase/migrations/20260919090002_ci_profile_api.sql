-- Phase 2B (2/3): the api-schema Creator Profile RPCs. ADDITIVE + DARK + FAIL-CLOSED.
-- Every function: SECURITY DEFINER, fixed empty search_path, schema-qualified; asserts the
-- feature flag; derives ownership from auth.uid() via intel.ci_caller_identity() (never trusts
-- client-supplied identity); rejects unsupported/protected fields; writes metadata-only audit.
-- Professional reads NEVER serialize private (personal/contact/address) data.

-- ============================ INTROSPECTION ============================
create or replace function api.creator_profile_api_enabled()
returns boolean language sql stable security definer set search_path = '' as $$
  select intel.ci_feature_enabled('creator_profile_api');
$$;

-- ============================ READS ============================

-- The caller's OWN full draft (all sections — it is their own data). No tokens/auth internals.
create or replace function api.get_my_profile_draft()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_identity uuid;
begin
  perform intel.ci_assert_api_enabled('creator_profile_api');
  v_identity := intel.ci_caller_identity();
  return jsonb_build_object(
    'identity_id', v_identity,
    'personal', (select to_jsonb(p) - 'identity_id' from private.creator_personal_profile p where p.identity_id = v_identity),
    'contact',  (select to_jsonb(c) - 'identity_id' from private.creator_contact c where c.identity_id = v_identity),
    'addresses', coalesce((select jsonb_agg(to_jsonb(a) - 'identity_id' order by a.created_at)
                           from private.creator_address a where a.identity_id = v_identity and a.deleted_at is null), '[]'::jsonb),
    'professional', (select to_jsonb(pr) - 'identity_id' from intel.ci_creator_professional_profile pr where pr.identity_id = v_identity),
    'skills', coalesce((select jsonb_agg(jsonb_build_object('skill_key',s.skill_key,'skill_level',s.skill_level,
                          'years_experience',s.years_experience,'portfolio_link',s.portfolio_link) order by s.skill_key)
                        from intel.ci_creator_skill s where s.identity_id = v_identity), '[]'::jsonb),
    'brand_experience', coalesce((select jsonb_agg(jsonb_build_object('experience_id',b.experience_id,'brand_id',b.brand_id,
                          'submitted_brand_name',b.submitted_brand_name,'relationship_type',b.relationship_type,
                          'compensation_type',b.compensation_type,'source_type',b.source_type,
                          'verification_status',b.verification_status) order by b.created_at)
                        from intel.ci_creator_brand_experience b where b.identity_id = v_identity), '[]'::jsonb),
    'commercial_preference', (select to_jsonb(cp) - 'identity_id' from intel.ci_creator_commercial_preference cp where cp.identity_id = v_identity),
    'rate_cards', coalesce((select jsonb_agg(jsonb_build_object('rate_card_id',rc.rate_card_id,'status',rc.status,
                          'currency',rc.currency,'negotiable',rc.negotiable,'visibility',rc.visibility,
                          'items', coalesce((select jsonb_agg(to_jsonb(ri) - 'rate_card_id' order by ri.deliverable_type)
                                             from intel.ci_creator_rate_card_item ri where ri.rate_card_id = rc.rate_card_id),'[]'::jsonb))
                          order by rc.created_at)
                        from intel.ci_creator_rate_card rc where rc.identity_id = v_identity), '[]'::jsonb),
    'dream_brands', coalesce((select jsonb_agg(jsonb_build_object('aspiration_id',d.aspiration_id,'brand_id',d.brand_id,
                          'submitted_brand_name',d.submitted_brand_name,'priority_rank',d.priority_rank) order by d.priority_rank nulls last)
                        from intel.ci_creator_brand_aspiration d where d.identity_id = v_identity and d.active), '[]'::jsonb),
    'completion', (select to_jsonb(pc) - 'identity_id' from intel.ci_profile_completion pc where pc.identity_id = v_identity)
  );
end;
$$;

-- Professional / marketplace projection for an identity the caller is authorised to see.
-- Returns ONLY professional data — never personal/contact/address PII.
create or replace function api.get_professional_profile(p_identity_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform intel.ci_assert_api_enabled('creator_profile_api');
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  if not intel.ci_caller_can_access(p_identity_id) then
    raise exception 'not authorised for this identity' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'identity_id', p_identity_id,
    'professional', (select to_jsonb(pr) - 'identity_id' from intel.ci_creator_professional_profile pr where pr.identity_id = p_identity_id),
    'skills', coalesce((select jsonb_agg(jsonb_build_object('skill_key',s.skill_key,'skill_level',s.skill_level) order by s.skill_key)
                        from intel.ci_creator_skill s where s.identity_id = p_identity_id),'[]'::jsonb),
    'resources', coalesce((select jsonb_agg(jsonb_build_object('resource_key',r.resource_key) order by r.resource_key)
                        from intel.ci_creator_resource r where r.identity_id = p_identity_id),'[]'::jsonb),
    'brand_experience_verified', coalesce((select jsonb_agg(jsonb_build_object('brand_id',b.brand_id,
                          'submitted_brand_name',b.submitted_brand_name,'relationship_type',b.relationship_type,
                          'verification_status',b.verification_status) order by b.created_at)
                        from intel.ci_creator_brand_experience b
                        where b.identity_id = p_identity_id and b.verification_status in ('campaign_verified','agency_verified')),'[]'::jsonb),
    'collaboration', (select jsonb_build_object('accepts_barter',cp.accepts_barter,'open_to_top_brands',cp.open_to_top_brands,
                          'barter_preference',cp.barter_preference)
                        from intel.ci_creator_commercial_preference cp where cp.identity_id = p_identity_id),
    'verified_data_coverage_pct', (select pc.verified_data_coverage_pct from intel.ci_profile_completion pc where pc.identity_id = p_identity_id)
  );
end;
$$;

-- ============================ WRITES (single-row sections) ============================
-- Partial-update: a key ABSENT is untouched; a key present with JSON null is CLEARED.
create or replace function api.save_profile_section(p_section text, p_patch jsonb, p_correlation text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_identity uuid; v_created boolean := false; k text; v_op text;
begin
  perform intel.ci_assert_api_enabled('creator_profile_api');
  v_identity := intel.ci_caller_identity();

  if p_section = 'personal' then
    perform intel.ci_reject_unknown_keys(p_patch, array[
      'first_name','last_name','first_name_confirmed_at','last_name_confirmed_at',
      'gender','date_of_birth','age_band','marital_status','marriage_anniversary']);
    insert into private.creator_personal_profile(identity_id) values (v_identity) on conflict (identity_id) do nothing;
    v_created := found;
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
      updated_at = now()
    where identity_id = v_identity;

  elsif p_section = 'contact' then
    perform intel.ci_reject_unknown_keys(p_patch, array[
      'whatsapp_e164','email','preferred_contact_method','whatsapp_optin','email_optin',
      'comm_consent_version','comm_consent_purpose']);
    insert into private.creator_contact(identity_id) values (v_identity) on conflict (identity_id) do nothing;
    v_created := found;
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
    perform intel.ci_reject_unknown_keys(p_patch, array[
      'display_name','city_coarse','state_coarse','categories','languages','bio','visibility_default']);
    insert into intel.ci_creator_professional_profile(identity_id) values (v_identity) on conflict (identity_id) do nothing;
    v_created := found;
    update intel.ci_creator_professional_profile set
      display_name = case when p_patch ? 'display_name' then p_patch->>'display_name' else display_name end,
      city_coarse  = case when p_patch ? 'city_coarse' then p_patch->>'city_coarse' else city_coarse end,
      state_coarse = case when p_patch ? 'state_coarse' then p_patch->>'state_coarse' else state_coarse end,
      categories   = case when p_patch ? 'categories' then (select array_agg(x) from jsonb_array_elements_text(p_patch->'categories') x) else categories end,
      languages    = case when p_patch ? 'languages' then (select array_agg(x) from jsonb_array_elements_text(p_patch->'languages') x) else languages end,
      bio          = case when p_patch ? 'bio' then p_patch->>'bio' else bio end,
      visibility_default = case when p_patch ? 'visibility_default' then p_patch->>'visibility_default' else visibility_default end,
      updated_at = now()
    where identity_id = v_identity;

  elsif p_section = 'commercial_preference' then
    perform intel.ci_reject_unknown_keys(p_patch, array[
      'accepts_barter','open_to_top_brands','barter_preference','preferred_categories','excluded_categories',
      'min_product_value','product_only','product_plus_travel','product_plus_production_reimbursement',
      'city_only','travel_ready','notes']);
    insert into intel.ci_creator_commercial_preference(identity_id) values (v_identity) on conflict (identity_id) do nothing;
    v_created := found;
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

  -- metadata-only audit: one row per touched field (+ a 'created' row if the record was new)
  if v_created then
    perform intel.ci_write_audit(v_identity, p_section, null, p_section, 'created', p_correlation);
  end if;
  for k in select jsonb_object_keys(p_patch) loop
    v_op := case when (p_patch->>k) is null then 'cleared' else 'changed' end;
    perform intel.ci_write_audit(v_identity, p_section, null, k, v_op, p_correlation);
  end loop;
end;
$$;

-- ============================ WRITES (child collections) ============================

create or replace function api.upsert_address(p_payload jsonb, p_correlation text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_identity uuid; v_id uuid; v_default boolean;
begin
  perform intel.ci_assert_api_enabled('creator_profile_api');
  v_identity := intel.ci_caller_identity();
  perform intel.ci_reject_unknown_keys(p_payload, array[
    'address_id','line1','line2','landmark','city','state','postal_code','country',
    'delivery_instructions','label','is_default']);
  v_default := coalesce((p_payload->>'is_default')::boolean, false);
  if v_default then
    update private.creator_address set is_default = false
      where identity_id = v_identity and is_default = true and deleted_at is null;
  end if;
  if p_payload ? 'address_id' then
    v_id := (p_payload->>'address_id')::uuid;
    update private.creator_address set
      line1 = case when p_payload ? 'line1' then p_payload->>'line1' else line1 end,
      line2 = case when p_payload ? 'line2' then p_payload->>'line2' else line2 end,
      landmark = case when p_payload ? 'landmark' then p_payload->>'landmark' else landmark end,
      city = case when p_payload ? 'city' then p_payload->>'city' else city end,
      state = case when p_payload ? 'state' then p_payload->>'state' else state end,
      postal_code = case when p_payload ? 'postal_code' then p_payload->>'postal_code' else postal_code end,
      country = case when p_payload ? 'country' then p_payload->>'country' else country end,
      delivery_instructions = case when p_payload ? 'delivery_instructions' then p_payload->>'delivery_instructions' else delivery_instructions end,
      label = case when p_payload ? 'label' then p_payload->>'label' else label end,
      is_default = case when p_payload ? 'is_default' then v_default else is_default end,
      updated_at = now()
    where address_id = v_id and identity_id = v_identity and deleted_at is null;
    if not found then raise exception 'address not found or not owned' using errcode = '42501'; end if;
    perform intel.ci_write_audit(v_identity, 'creator_address', v_id, 'address', 'changed', p_correlation);
  else
    insert into private.creator_address(identity_id, line1, line2, landmark, city, state, postal_code, country,
      delivery_instructions, label, is_default)
    values (v_identity, p_payload->>'line1', p_payload->>'line2', p_payload->>'landmark', p_payload->>'city',
      p_payload->>'state', p_payload->>'postal_code', p_payload->>'country', p_payload->>'delivery_instructions',
      p_payload->>'label', v_default)
    returning address_id into v_id;
    perform intel.ci_write_audit(v_identity, 'creator_address', v_id, 'address', 'created', p_correlation);
  end if;
  return v_id;
end;
$$;

create or replace function api.delete_address(p_address_id uuid, p_correlation text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_identity uuid;
begin
  perform intel.ci_assert_api_enabled('creator_profile_api');
  v_identity := intel.ci_caller_identity();
  update private.creator_address set deleted_at = now(), is_default = false, updated_at = now()
    where address_id = p_address_id and identity_id = v_identity and deleted_at is null;
  if not found then raise exception 'address not found or not owned' using errcode = '42501'; end if;
  perform intel.ci_write_audit(v_identity, 'creator_address', p_address_id, 'address', 'cleared', p_correlation);
end;
$$;

-- Idempotent skill upsert (unique (identity_id, skill_key) prevents duplicate child rows).
create or replace function api.upsert_skill(p_payload jsonb, p_correlation text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_identity uuid;
begin
  perform intel.ci_assert_api_enabled('creator_profile_api');
  v_identity := intel.ci_caller_identity();
  perform intel.ci_reject_unknown_keys(p_payload, array['skill_key','is_custom','skill_level','years_experience','portfolio_link']);
  if not (p_payload ? 'skill_key') or (p_payload->>'skill_key') is null then
    raise exception 'skill_key is required' using errcode = '22023';
  end if;
  insert into intel.ci_creator_skill(identity_id, skill_key, is_custom, skill_level, years_experience, portfolio_link, creator_confirmed_at)
  values (v_identity, p_payload->>'skill_key', coalesce((p_payload->>'is_custom')::boolean, false),
          p_payload->>'skill_level', (p_payload->>'years_experience')::int, p_payload->>'portfolio_link', now())
  on conflict (identity_id, skill_key) do update set
    skill_level = excluded.skill_level, years_experience = excluded.years_experience,
    portfolio_link = excluded.portfolio_link, creator_confirmed_at = now(), updated_at = now();
  perform intel.ci_write_audit(v_identity, 'ci_creator_skill', null, p_payload->>'skill_key', 'changed', p_correlation);
end;
$$;

-- Brand experience: creator-declared only. source_type/verification_status are SERVER-controlled
-- (a creator cannot self-mark 'campaign_verified'); they are rejected if present in the payload.
create or replace function api.upsert_brand_experience(p_payload jsonb, p_correlation text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_identity uuid; v_id uuid;
begin
  perform intel.ci_assert_api_enabled('creator_profile_api');
  v_identity := intel.ci_caller_identity();
  perform intel.ci_reject_unknown_keys(p_payload, array[
    'experience_id','brand_id','submitted_brand_name','relationship_type','compensation_type',
    'campaign_id','start_date','end_date','deliverables']);
  if p_payload ? 'experience_id' then
    v_id := (p_payload->>'experience_id')::uuid;
    update intel.ci_creator_brand_experience set
      brand_id = case when p_payload ? 'brand_id' then (p_payload->>'brand_id')::uuid else brand_id end,
      submitted_brand_name = case when p_payload ? 'submitted_brand_name' then p_payload->>'submitted_brand_name' else submitted_brand_name end,
      relationship_type = case when p_payload ? 'relationship_type' then p_payload->>'relationship_type' else relationship_type end,
      compensation_type = case when p_payload ? 'compensation_type' then p_payload->>'compensation_type' else compensation_type end,
      campaign_id = case when p_payload ? 'campaign_id' then (p_payload->>'campaign_id')::uuid else campaign_id end,
      start_date = case when p_payload ? 'start_date' then (p_payload->>'start_date')::date else start_date end,
      end_date = case when p_payload ? 'end_date' then (p_payload->>'end_date')::date else end_date end,
      deliverables = case when p_payload ? 'deliverables' then p_payload->>'deliverables' else deliverables end,
      creator_confirmed_at = now(), updated_at = now()
    where experience_id = v_id and identity_id = v_identity;
    if not found then raise exception 'brand experience not found or not owned' using errcode = '42501'; end if;
    perform intel.ci_write_audit(v_identity, 'ci_creator_brand_experience', v_id, 'brand_experience', 'changed', p_correlation);
  else
    insert into intel.ci_creator_brand_experience(identity_id, brand_id, submitted_brand_name, relationship_type,
      compensation_type, campaign_id, start_date, end_date, deliverables,
      source_type, verification_status, creator_confirmed_at)
    values (v_identity, (p_payload->>'brand_id')::uuid, p_payload->>'submitted_brand_name', p_payload->>'relationship_type',
      p_payload->>'compensation_type', (p_payload->>'campaign_id')::uuid, (p_payload->>'start_date')::date,
      (p_payload->>'end_date')::date, p_payload->>'deliverables',
      'creator_declared', 'creator_confirmed', now())
    returning experience_id into v_id;
    perform intel.ci_write_audit(v_identity, 'ci_creator_brand_experience', v_id, 'brand_experience', 'created', p_correlation);
  end if;
  return v_id;
end;
$$;

create or replace function api.upsert_dream_brand(p_payload jsonb, p_correlation text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_identity uuid; v_id uuid;
begin
  perform intel.ci_assert_api_enabled('creator_profile_api');
  v_identity := intel.ci_caller_identity();
  perform intel.ci_reject_unknown_keys(p_payload, array[
    'aspiration_id','brand_id','submitted_brand_name','priority_rank','preferred_collaboration_type','notes','active']);
  if p_payload ? 'aspiration_id' then
    v_id := (p_payload->>'aspiration_id')::uuid;
    update intel.ci_creator_brand_aspiration set
      brand_id = case when p_payload ? 'brand_id' then (p_payload->>'brand_id')::uuid else brand_id end,
      submitted_brand_name = case when p_payload ? 'submitted_brand_name' then p_payload->>'submitted_brand_name' else submitted_brand_name end,
      priority_rank = case when p_payload ? 'priority_rank' then (p_payload->>'priority_rank')::int else priority_rank end,
      preferred_collaboration_type = case when p_payload ? 'preferred_collaboration_type' then p_payload->>'preferred_collaboration_type' else preferred_collaboration_type end,
      notes = case when p_payload ? 'notes' then p_payload->>'notes' else notes end,
      active = case when p_payload ? 'active' then (p_payload->>'active')::boolean else active end,
      updated_at = now()
    where aspiration_id = v_id and identity_id = v_identity;
    if not found then raise exception 'dream brand not found or not owned' using errcode = '42501'; end if;
    perform intel.ci_write_audit(v_identity, 'ci_creator_brand_aspiration', v_id, 'dream_brand', 'changed', p_correlation);
  else
    insert into intel.ci_creator_brand_aspiration(identity_id, brand_id, submitted_brand_name, priority_rank,
      preferred_collaboration_type, notes, active)
    values (v_identity, (p_payload->>'brand_id')::uuid, p_payload->>'submitted_brand_name', (p_payload->>'priority_rank')::int,
      p_payload->>'preferred_collaboration_type', p_payload->>'notes', coalesce((p_payload->>'active')::boolean, true))
    returning aspiration_id into v_id;
    perform intel.ci_write_audit(v_identity, 'ci_creator_brand_aspiration', v_id, 'dream_brand', 'created', p_correlation);
  end if;
  return v_id;
end;
$$;

-- Rate card item: atomically ensures the caller has an active rate card, then upserts the item
-- (unique (rate_card_id, deliverable_type) → idempotent, no duplicate child rows).
create or replace function api.save_rate_card_item(p_payload jsonb, p_correlation text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_identity uuid; v_card uuid; v_item uuid;
begin
  perform intel.ci_assert_api_enabled('creator_profile_api');
  v_identity := intel.ci_caller_identity();
  perform intel.ci_reject_unknown_keys(p_payload, array[
    'deliverable_type','amount','unit_quantity','duration_minutes','includes_production','includes_editing',
    'usage_rights_included','usage_rights_days','exclusivity_included','travel_included','taxes_extra','notes']);
  if not (p_payload ? 'deliverable_type') or not (p_payload ? 'amount') then
    raise exception 'deliverable_type and amount are required' using errcode = '22023';
  end if;
  select rate_card_id into v_card from intel.ci_creator_rate_card
    where identity_id = v_identity and status = 'active' order by created_at limit 1;
  if v_card is null then
    insert into intel.ci_creator_rate_card(identity_id) values (v_identity) returning rate_card_id into v_card;
  end if;
  insert into intel.ci_creator_rate_card_item(rate_card_id, deliverable_type, amount, unit_quantity, duration_minutes,
    includes_production, includes_editing, usage_rights_included, usage_rights_days, exclusivity_included,
    travel_included, taxes_extra, notes)
  values (v_card, p_payload->>'deliverable_type', (p_payload->>'amount')::numeric,
    coalesce((p_payload->>'unit_quantity')::int, 1), (p_payload->>'duration_minutes')::int,
    coalesce((p_payload->>'includes_production')::boolean, false), coalesce((p_payload->>'includes_editing')::boolean, false),
    coalesce((p_payload->>'usage_rights_included')::boolean, false), (p_payload->>'usage_rights_days')::int,
    coalesce((p_payload->>'exclusivity_included')::boolean, false), coalesce((p_payload->>'travel_included')::boolean, false),
    coalesce((p_payload->>'taxes_extra')::boolean, false), p_payload->>'notes')
  on conflict (rate_card_id, deliverable_type) do update set
    amount = excluded.amount, unit_quantity = excluded.unit_quantity, duration_minutes = excluded.duration_minutes,
    includes_production = excluded.includes_production, includes_editing = excluded.includes_editing,
    usage_rights_included = excluded.usage_rights_included, usage_rights_days = excluded.usage_rights_days,
    exclusivity_included = excluded.exclusivity_included, travel_included = excluded.travel_included,
    taxes_extra = excluded.taxes_extra, notes = excluded.notes, updated_at = now()
  returning rate_card_item_id into v_item;
  perform intel.ci_write_audit(v_identity, 'ci_creator_rate_card_item', v_item, p_payload->>'deliverable_type', 'changed', p_correlation);
  return v_item;
end;
$$;
