-- Phase 1A (2/2): Creator Profile API — bootstrap, prefill+provenance, completion, resources,
-- removes, visibility, and an extended save_profile_section. ADDITIVE + DARK + FAIL-CLOSED.
-- Every api function: SECURITY DEFINER, fixed empty search_path, schema-qualified, asserts the
-- creator_profile_api flag, derives ownership from auth.uid() (never client identity), rejects
-- unknown/protected keys, writes metadata-only audit, and never returns private PII in pro/public
-- payloads. Legacy public objects are only READ (guarded), never written.

-- ============================ IDENTITY BOOTSTRAP (internal) ============================
-- Create-or-get the caller's 'self' identity + actor-access + shell profile rows. Idempotent.
-- Unexposed: callable only by the api.bootstrap_my_profile wrapper (definer chain) / service_role.
create or replace function intel.ci_bootstrap_identity()
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_identity uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;

  -- reuse an existing 'self' identity if present (never match on handle/name/email)
  select a.identity_id into v_identity from intel.ci_identity_actor_access a
   where a.member_id = v_uid and a.access_role = 'self' and a.revoked_at is null
   order by a.granted_at limit 1;

  if v_identity is null then
    insert into intel.ci_creator_identity(display_name, kind, is_claimed)
      values (null, 'creator', true) returning identity_id into v_identity;
    insert into intel.ci_identity_actor_access(identity_id, member_id, access_role, granted_by)
      values (v_identity, v_uid, 'self', v_uid)
      on conflict (identity_id, member_id, access_role) do nothing;
  end if;

  -- shell rows so every section loads (idempotent)
  insert into intel.ci_creator_professional_profile(identity_id) values (v_identity) on conflict (identity_id) do nothing;
  insert into intel.ci_creator_commercial_preference(identity_id) values (v_identity) on conflict (identity_id) do nothing;
  insert into intel.ci_profile_completion(identity_id) values (v_identity) on conflict (identity_id) do nothing;
  insert into private.creator_personal_profile(identity_id) values (v_identity) on conflict (identity_id) do nothing;
  insert into private.creator_contact(identity_id) values (v_identity) on conflict (identity_id) do nothing;
  return v_identity;
end;
$$;
revoke all on function intel.ci_bootstrap_identity() from public, anon, authenticated;

-- Provenance writer (professional/intel side). Metadata only; never stores the value.
create or replace function intel.ci_set_provenance(
  p_identity uuid, p_field text, p_source text, p_ref text, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from intel.ci_profile_field_provenance where identity_id=p_identity and field_key=p_field) then
    update intel.ci_profile_field_provenance
       set source_type=p_source, source_reference=p_ref, last_updated_at=now(), verification_status=p_status
     where identity_id=p_identity and field_key=p_field;
  else
    insert into intel.ci_profile_field_provenance(identity_id, field_key, source_type, source_reference,
             first_observed_at, last_updated_at, verification_status)
      values (p_identity, p_field, p_source, p_ref, now(), now(), p_status);
  end if;
end;
$$;
revoke all on function intel.ci_set_provenance(uuid,text,text,text,text) from public, anon, authenticated;

-- ============================ BOOTSTRAP (authenticated) ============================
-- Creates the profile draft and prefills ONLY from truthfully available legacy sources
-- (auth.users, public.members, public.social_accounts) — no Meta API call. A later sync must
-- never overwrite a creator-confirmed value (we prefill only when the target is still null).
create or replace function api.bootstrap_my_profile(p_correlation text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_identity uuid; v_created boolean := false;
        v_ig record; v_email text; v_member_name text;
begin
  perform intel.ci_assert_api_enabled('creator_profile_api');
  v_uid := auth.uid();
  if v_uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;

  v_created := not exists (select 1 from intel.ci_identity_actor_access
                            where member_id=v_uid and access_role='self' and revoked_at is null);
  v_identity := intel.ci_bootstrap_identity();

  -- prefill display_name / email from Geek account (labelled 'from_geek_account'); only if empty
  select email into v_email from auth.users where id = v_uid;
  if to_regclass('public.members') is not null then
    execute 'select name from public.members where id = $1' into v_member_name using v_uid;
  end if;
  if v_email is not null then
    update private.creator_contact set email = v_email, updated_at = now()
      where identity_id = v_identity and email is null;
    if found then perform intel.ci_set_provenance(v_identity,'contact.email','from_geek_account','auth.users','unavailable'); end if;
  end if;
  if v_member_name is not null then
    update intel.ci_creator_professional_profile set display_name = v_member_name, updated_at = now()
      where identity_id = v_identity and display_name is null;
    if found then perform intel.ci_set_provenance(v_identity,'professional.display_name','from_geek_account','public.members','unavailable'); end if;
  end if;

  -- prefill professional fields from a connected Instagram account (labelled 'from_instagram');
  -- read-only from legacy social_accounts, guarded so it degrades when the table is absent.
  if to_regclass('public.social_accounts') is not null then
    execute 'select username, name, account_type, biography, profile_picture_url
               from public.social_accounts where member_id=$1 and platform=''instagram'' order by connected_at desc limit 1'
      into v_ig using v_uid;
    if v_ig.username is not null then
      update intel.ci_creator_professional_profile set
        display_name = coalesce(display_name, v_ig.name, v_ig.username),
        bio = coalesce(bio, v_ig.biography),
        profile_image_url = coalesce(profile_image_url, v_ig.profile_picture_url),
        profile_image_source_platform = coalesce(profile_image_source_platform, case when v_ig.profile_picture_url is not null then 'instagram' end),
        profile_image_status = case when v_ig.profile_picture_url is not null then 'fresh' else profile_image_status end,
        profile_image_observed_at = case when v_ig.profile_picture_url is not null then now() else profile_image_observed_at end,
        updated_at = now()
      where identity_id = v_identity;
      perform intel.ci_set_provenance(v_identity,'professional.instagram_username','from_instagram','social_accounts.username','api_observed');
      if v_ig.biography is not null then perform intel.ci_set_provenance(v_identity,'professional.bio','from_instagram','social_accounts.biography','api_observed'); end if;
      if v_ig.profile_picture_url is not null then perform intel.ci_set_provenance(v_identity,'professional.profile_image','from_instagram','social_accounts.profile_picture_url','api_observed'); end if;
    end if;
  end if;

  perform intel.ci_write_audit(v_identity, 'profile', null, 'bootstrap', case when v_created then 'created' else 'changed' end, p_correlation);
  return jsonb_build_object('identity_id', v_identity, 'created', v_created);
end;
$$;

-- ============================ COMPREHENSIVE READ (authenticated, own) ============================
-- Full own draft + resources + field provenance + a live (read-only) Instagram connection block
-- (never copied into intel, so re-sync cannot clobber creator edits). Unavailable → null, never 0.
create or replace function api.get_my_profile()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_identity uuid; v_uid uuid; v_conn jsonb := null;
begin
  perform intel.ci_assert_api_enabled('creator_profile_api');
  v_uid := auth.uid();
  v_identity := intel.ci_caller_identity();
  if to_regclass('public.social_accounts') is not null then
    execute 'select jsonb_build_object(
               ''connected'', true, ''source'', ''from_instagram'',
               ''username'', username, ''account_type'', account_type,
               ''profile_link'', case when username is not null then ''https://instagram.com/''||username end,
               ''followers_count'', followers_count, ''follows_count'', follows_count, ''media_count'', media_count)
             from public.social_accounts where member_id=$1 and platform=''instagram'' order by connected_at desc limit 1'
      into v_conn using v_uid;
  end if;
  return jsonb_build_object(
    'identity_id', v_identity,
    'personal', (select to_jsonb(p) - 'identity_id' from private.creator_personal_profile p where p.identity_id=v_identity),
    'contact',  (select to_jsonb(c) - 'identity_id' from private.creator_contact c where c.identity_id=v_identity),
    'addresses', coalesce((select jsonb_agg(to_jsonb(a) - 'identity_id' order by a.created_at)
                           from private.creator_address a where a.identity_id=v_identity and a.deleted_at is null),'[]'::jsonb),
    'professional', (select to_jsonb(pr) - 'identity_id' from intel.ci_creator_professional_profile pr where pr.identity_id=v_identity),
    'skills', coalesce((select jsonb_agg(jsonb_build_object('skill_key',s.skill_key,'skill_level',s.skill_level,
                          'years_experience',s.years_experience,'portfolio_link',s.portfolio_link) order by s.skill_key)
                        from intel.ci_creator_skill s where s.identity_id=v_identity),'[]'::jsonb),
    'resources', coalesce((select jsonb_agg(jsonb_build_object('resource_key',r.resource_key,'is_custom',r.is_custom) order by r.resource_key)
                        from intel.ci_creator_resource r where r.identity_id=v_identity),'[]'::jsonb),
    'brand_experience', coalesce((select jsonb_agg(jsonb_build_object('experience_id',b.experience_id,'brand_id',b.brand_id,
                          'submitted_brand_name',b.submitted_brand_name,'relationship_type',b.relationship_type,
                          'compensation_type',b.compensation_type,'deliverables',b.deliverables,'start_date',b.start_date,
                          'end_date',b.end_date,'source_type',b.source_type,'verification_status',b.verification_status,
                          'creator_rejected_at',b.creator_rejected_at) order by b.created_at)
                        from intel.ci_creator_brand_experience b where b.identity_id=v_identity),'[]'::jsonb),
    'commercial_preference', (select to_jsonb(cp) - 'identity_id' from intel.ci_creator_commercial_preference cp where cp.identity_id=v_identity),
    'rate_cards', coalesce((select jsonb_agg(jsonb_build_object('rate_card_id',rc.rate_card_id,'status',rc.status,
                          'currency',rc.currency,'negotiable',rc.negotiable,'visibility',rc.visibility,
                          'items', coalesce((select jsonb_agg(to_jsonb(ri) - 'rate_card_id' order by ri.deliverable_type)
                                             from intel.ci_creator_rate_card_item ri where ri.rate_card_id=rc.rate_card_id),'[]'::jsonb))
                          order by rc.created_at)
                        from intel.ci_creator_rate_card rc where rc.identity_id=v_identity),'[]'::jsonb),
    'dream_brands', coalesce((select jsonb_agg(jsonb_build_object('aspiration_id',d.aspiration_id,'brand_id',d.brand_id,
                          'submitted_brand_name',d.submitted_brand_name,'priority_rank',d.priority_rank,
                          'preferred_collaboration_type',d.preferred_collaboration_type,'notes',d.notes) order by d.priority_rank nulls last)
                        from intel.ci_creator_brand_aspiration d where d.identity_id=v_identity and d.active),'[]'::jsonb),
    'provenance', coalesce((select jsonb_object_agg(field_key, jsonb_build_object('source',source_type,'status',verification_status))
                        from intel.ci_profile_field_provenance where identity_id=v_identity),'{}'::jsonb),
    'connection', v_conn,
    'completion', (select to_jsonb(pc) - 'identity_id' from intel.ci_profile_completion pc where pc.identity_id=v_identity)
  );
end;
$$;

-- ============================ EXTENDED save_profile_section ============================
-- Replaces the Phase 2B function (same signature) to add the new professional fields to the
-- professional allowlist. All other sections unchanged. Partial-update semantics preserved.
create or replace function api.save_profile_section(p_section text, p_patch jsonb, p_correlation text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_identity uuid; v_created boolean := false; k text; v_op text;
begin
  perform intel.ci_assert_api_enabled('creator_profile_api');
  v_identity := intel.ci_caller_identity();

  if p_section = 'personal' then
    perform intel.ci_reject_unknown_keys(p_patch, array['first_name','last_name','first_name_confirmed_at','last_name_confirmed_at',
      'gender','date_of_birth','age_band','marital_status','marriage_anniversary']);
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

-- ============================ RESOURCES ============================
create or replace function api.upsert_resource(p_payload jsonb, p_correlation text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_identity uuid; v_key text;
begin
  perform intel.ci_assert_api_enabled('creator_profile_api');
  v_identity := intel.ci_caller_identity();
  perform intel.ci_reject_unknown_keys(p_payload, array['resource_key','is_custom','evidence']);
  v_key := p_payload->>'resource_key';
  if v_key is null then raise exception 'resource_key is required' using errcode = '22023'; end if;
  if exists (select 1 from intel.ci_creator_resource where identity_id=v_identity and resource_key=v_key) then
    update intel.ci_creator_resource set is_custom = coalesce((p_payload->>'is_custom')::boolean, is_custom),
      creator_confirmed_at = now(), updated_at = now() where identity_id=v_identity and resource_key=v_key;
  else
    insert into intel.ci_creator_resource(identity_id, resource_key, is_custom, creator_confirmed_at)
      values (v_identity, v_key, coalesce((p_payload->>'is_custom')::boolean, false), now());
  end if;
  perform intel.ci_write_audit(v_identity, 'ci_creator_resource', null, v_key, 'changed', p_correlation);
end;
$$;

create or replace function api.remove_resource(p_resource_key text, p_correlation text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_identity uuid;
begin
  perform intel.ci_assert_api_enabled('creator_profile_api');
  v_identity := intel.ci_caller_identity();
  delete from intel.ci_creator_resource where identity_id=v_identity and resource_key=p_resource_key;
  perform intel.ci_write_audit(v_identity, 'ci_creator_resource', null, p_resource_key, 'cleared', p_correlation);
end;
$$;

create or replace function api.remove_skill(p_skill_key text, p_correlation text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_identity uuid;
begin
  perform intel.ci_assert_api_enabled('creator_profile_api');
  v_identity := intel.ci_caller_identity();
  delete from intel.ci_creator_skill where identity_id=v_identity and skill_key=p_skill_key;
  perform intel.ci_write_audit(v_identity, 'ci_creator_skill', null, p_skill_key, 'cleared', p_correlation);
end;
$$;

-- ============================ BRAND EXPERIENCE remove / reject ============================
create or replace function api.delete_brand_experience(p_experience_id uuid, p_correlation text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_identity uuid;
begin
  perform intel.ci_assert_api_enabled('creator_profile_api');
  v_identity := intel.ci_caller_identity();
  delete from intel.ci_creator_brand_experience where experience_id=p_experience_id and identity_id=v_identity;
  if not found then raise exception 'brand experience not found or not owned' using errcode = '42501'; end if;
  perform intel.ci_write_audit(v_identity, 'ci_creator_brand_experience', p_experience_id, 'brand_experience', 'cleared', p_correlation);
end;
$$;

create or replace function api.reject_brand_experience(p_experience_id uuid, p_correlation text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_identity uuid;
begin
  perform intel.ci_assert_api_enabled('creator_profile_api');
  v_identity := intel.ci_caller_identity();
  update intel.ci_creator_brand_experience set creator_rejected_at = now(), updated_at = now()
    where experience_id=p_experience_id and identity_id=v_identity;
  if not found then raise exception 'brand experience not found or not owned' using errcode = '42501'; end if;
  perform intel.ci_write_audit(v_identity, 'ci_creator_brand_experience', p_experience_id, 'brand_experience', 'changed', p_correlation);
end;
$$;

create or replace function api.delete_dream_brand(p_aspiration_id uuid, p_correlation text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_identity uuid;
begin
  perform intel.ci_assert_api_enabled('creator_profile_api');
  v_identity := intel.ci_caller_identity();
  update intel.ci_creator_brand_aspiration set active = false, updated_at = now()
    where aspiration_id=p_aspiration_id and identity_id=v_identity;
  if not found then raise exception 'dream brand not found or not owned' using errcode = '42501'; end if;
  perform intel.ci_write_audit(v_identity, 'ci_creator_brand_aspiration', p_aspiration_id, 'dream_brand', 'cleared', p_correlation);
end;
$$;

create or replace function api.delete_rate_card_item(p_rate_card_item_id uuid, p_correlation text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_identity uuid; v_ok boolean;
begin
  perform intel.ci_assert_api_enabled('creator_profile_api');
  v_identity := intel.ci_caller_identity();
  -- ownership via the parent rate card
  select exists (select 1 from intel.ci_creator_rate_card_item ri
                 join intel.ci_creator_rate_card rc on rc.rate_card_id = ri.rate_card_id
                 where ri.rate_card_item_id = p_rate_card_item_id and rc.identity_id = v_identity) into v_ok;
  if not v_ok then raise exception 'rate card item not found or not owned' using errcode = '42501'; end if;
  delete from intel.ci_creator_rate_card_item where rate_card_item_id = p_rate_card_item_id;
  perform intel.ci_write_audit(v_identity, 'ci_creator_rate_card_item', p_rate_card_item_id, 'rate_card_item', 'cleared', p_correlation);
end;
$$;

-- ============================ VISIBILITY ============================
create or replace function api.set_profile_visibility(p_field_or_group text, p_tier text, p_allowed boolean, p_correlation text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_identity uuid; v_prev boolean;
begin
  perform intel.ci_assert_api_enabled('creator_profile_api');
  v_identity := intel.ci_caller_identity();
  select allowed into v_prev from intel.ci_profile_visibility
    where identity_id=v_identity and field_or_group=p_field_or_group and tier=p_tier;
  insert into intel.ci_profile_visibility(identity_id, field_or_group, tier, allowed)
    values (v_identity, p_field_or_group, p_tier, p_allowed)
  on conflict (identity_id, field_or_group, tier) do update set allowed=excluded.allowed, updated_at=now();
  insert into intel.ci_profile_visibility_event(identity_id, field_or_group, tier, previous_allowed, new_allowed, acting_member_id, reason_source)
    values (v_identity, p_field_or_group, p_tier, v_prev, p_allowed, auth.uid(), 'self');
  perform intel.ci_write_audit(v_identity, 'ci_profile_visibility', null, p_field_or_group||':'||p_tier, 'changed', p_correlation);
end;
$$;

-- ============================ COMPLETION (explainable; no PII) ============================
-- Computes per-group booleans (presence only — never values), an aggregate over CORE groups
-- (optional/sensitive fields never lower completion), persists flags/counts, and returns detail.
create or replace function api.get_profile_completion()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_identity uuid;
  g_personal boolean; g_contact boolean; g_professional boolean; g_skills boolean;
  g_barter boolean; g_rate boolean; g_brands boolean; g_dreams boolean; g_address boolean;
  v_done int; v_total int := 6; v_pct numeric; v_flags jsonb; v_missing text[] := array[]::text[];
begin
  perform intel.ci_assert_api_enabled('creator_profile_api');
  v_identity := intel.ci_caller_identity();

  select (first_name is not null and last_name is not null) into g_personal
    from private.creator_personal_profile where identity_id=v_identity;
  select (whatsapp_e164 is not null or email is not null) into g_contact
    from private.creator_contact where identity_id=v_identity;
  select (display_name is not null and coalesce(array_length(categories,1),0) > 0) into g_professional
    from intel.ci_creator_professional_profile where identity_id=v_identity;
  g_skills := exists (select 1 from intel.ci_creator_skill where identity_id=v_identity);
  select (accepts_barter is not null) into g_barter
    from intel.ci_creator_commercial_preference where identity_id=v_identity;
  g_rate := exists (select 1 from intel.ci_creator_rate_card rc join intel.ci_creator_rate_card_item ri on ri.rate_card_id=rc.rate_card_id where rc.identity_id=v_identity);
  g_brands := exists (select 1 from intel.ci_creator_brand_experience where identity_id=v_identity and coalesce(creator_rejected_at, 'infinity'::timestamptz) = 'infinity'::timestamptz);
  g_dreams := exists (select 1 from intel.ci_creator_brand_aspiration where identity_id=v_identity and active);
  g_address := exists (select 1 from private.creator_address where identity_id=v_identity and deleted_at is null);

  g_personal := coalesce(g_personal,false); g_contact := coalesce(g_contact,false);
  g_professional := coalesce(g_professional,false); g_barter := coalesce(g_barter,false);

  v_done := (g_personal::int + g_contact::int + g_professional::int + g_skills::int + g_barter::int + g_rate::int);
  v_pct := round((v_done::numeric / v_total) * 100);
  if not g_personal then v_missing := v_missing || 'personal'; end if;
  if not g_contact then v_missing := v_missing || 'contact'; end if;
  if not g_professional then v_missing := v_missing || 'professional'; end if;
  if not g_skills then v_missing := v_missing || 'skills'; end if;
  if not g_barter then v_missing := v_missing || 'barter'; end if;
  if not g_rate then v_missing := v_missing || 'rate_card'; end if;

  v_flags := jsonb_build_object('personal',g_personal,'contact',g_contact,'professional',g_professional,
    'skills',g_skills,'barter',g_barter,'rate_card',g_rate,
    'brand_experience',g_brands,'dream_brands',g_dreams,'address',g_address);

  update intel.ci_profile_completion set completion_pct=v_pct, basic_complete=(g_personal and g_contact and g_professional),
    required_fields_total=v_total, required_fields_done=v_done, section_flags=v_flags, last_calculated_at=now(), updated_at=now()
    where identity_id=v_identity;

  return jsonb_build_object('completion_pct', v_pct, 'core_done', v_done, 'core_total', v_total,
    'groups', v_flags, 'optional_groups', array['brand_experience','dream_brands','address'],
    'missing_core', to_jsonb(v_missing));
end;
$$;

-- ============================ GRANTS (browser-facing = authenticated + service_role only) ============================
do $$ declare fn text; begin
  foreach fn in array array[
    'api.bootstrap_my_profile(text)','api.get_my_profile()','api.upsert_resource(jsonb,text)',
    'api.remove_resource(text,text)','api.remove_skill(text,text)','api.delete_brand_experience(uuid,text)',
    'api.reject_brand_experience(uuid,text)','api.delete_dream_brand(uuid,text)','api.delete_rate_card_item(uuid,text)',
    'api.set_profile_visibility(text,text,boolean,text)','api.get_profile_completion()'] loop
    execute 'revoke all on function '||fn||' from public, anon';
    execute 'grant execute on function '||fn||' to authenticated, service_role';
  end loop; end $$;
-- save_profile_section was re-created above; re-assert its grants (unchanged intent).
revoke all on function api.save_profile_section(text, jsonb, text) from public, anon;
grant execute on function api.save_profile_section(text, jsonb, text) to authenticated, service_role;
