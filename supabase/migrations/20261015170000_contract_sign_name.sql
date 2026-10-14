-- Contract signature must be the creator's own name, exactly as on their Geek OS profile
-- (first + last name from the profile, or the profile display name). Checked on the server. ADDITIVE.

create or replace function intel.ci_norm_name(p text)
returns text language sql immutable set search_path = '' as $$
  select nullif(btrim(regexp_replace(regexp_replace(lower(coalesce(p,'')), '[^[:alnum:][:space:]]', ' ', 'g'), '\s+', ' ', 'g')), '') $$;

-- {expected: "Shivam Rathore", accepted: [normalised names that count as a valid signature]}
-- an Instagram-style handle ("shivam.rathore8907") is never accepted as a signature name
create or replace function intel.ci_is_person_name(p text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(btrim(p),'') ~ '[[:alpha:]]' and btrim(p) !~ '^@' and not (btrim(p) !~ '\s' and btrim(p) ~ '[._0-9]') $$;

create or replace function intel.ci_signer_names(p_identity uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_full text; v_disp text; v_member text; v_list text[] := '{}'; v_exp text;
begin
  select nullif(btrim(concat_ws(' ', nullif(btrim(first_name),''), nullif(btrim(last_name),''))), '') into v_full
    from private.creator_personal_profile where identity_id = p_identity;
  select nullif(btrim(display_name),'') into v_disp from intel.ci_creator_professional_profile where identity_id = p_identity;
  select nullif(btrim(m.name),'') into v_member from public.members m
    join intel.ci_identity_actor_access a on a.member_id = m.id and a.identity_id = p_identity and a.access_role = 'self' and a.revoked_at is null
   limit 1;
  if not intel.ci_is_person_name(v_full) then v_full := null; end if;
  if not intel.ci_is_person_name(v_disp) then v_disp := null; end if;
  if not intel.ci_is_person_name(v_member) then v_member := null; end if;
  v_exp := coalesce(v_full, v_disp, v_member);
  if v_full is not null then v_list := v_list || intel.ci_norm_name(v_full); end if;
  if v_disp is not null then v_list := v_list || intel.ci_norm_name(v_disp); end if;
  if v_full is null and v_disp is null and v_member is not null then v_list := v_list || intel.ci_norm_name(v_member); end if;
  return jsonb_build_object('expected', v_exp, 'accepted', to_jsonb(array_remove(v_list, null)));
end $$;
revoke all on function intel.ci_norm_name(text), intel.ci_is_person_name(text), intel.ci_signer_names(uuid) from public, anon, authenticated;

create or replace function api.get_my_contract(p_participation uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid; v_owner uuid;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  v_id := intel.ci_caller_identity();
  select identity_id into v_owner from intel.ci_campaign_participation where participation_id=p_participation;
  if v_owner is null or v_owner <> v_id then raise exception 'not your participation' using errcode='42501'; end if;
  return (select jsonb_build_object(
      'contract_id', k.contract_id, 'terms_version', k.terms_version, 'ad_rights_months', k.ad_rights_months,
      'ad_rights_until', k.ad_rights_until, 'collab_rights', k.collab_rights, 'product', k.product, 'product_value', k.product_value,
      'deliverables', k.deliverables, 'content_days', k.content_days, 'clauses', k.clauses,
      'asci_ack', k.asci_ack, 'terms_ack', k.terms_ack, 'issued_at', k.issued_at, 'signed_at', k.signed_at, 'signature_name', k.signature_name,
      'campaign', c.name, 'brand', coalesce(b.name, c.submitted_brand_name),
      'sign_as', intel.ci_signer_names(v_id)->>'expected')
    from intel.ci_campaign_contract k
    join intel.ci_campaign c on c.campaign_id = k.campaign_id
    left join intel.ci_brand b on b.brand_id = c.brand_id
   where k.participation_id=p_participation);
end $$;

create or replace function api.sign_contract_v2(p_participation uuid, p_signature_name text, p_asci_ack boolean, p_terms_ack boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_owner uuid; v_clauses jsonb; v_names jsonb;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  v_id := intel.ci_caller_identity();
  select identity_id into v_owner from intel.ci_campaign_participation where participation_id=p_participation;
  if v_owner is null or v_owner <> v_id then raise exception 'not your contract' using errcode='42501'; end if;
  -- the signature has to be the creator's own name, exactly as on their profile
  v_names := intel.ci_signer_names(v_id);
  if v_names->>'expected' is null then
    raise exception 'add your full name in Creator Profile first — the contract is signed with that name' using errcode='22023'; end if;
  if not (v_names->'accepted') ? coalesce(intel.ci_norm_name(p_signature_name), '') then
    raise exception 'type your name exactly as on your profile: %', v_names->>'expected' using errcode='22023'; end if;
  select clauses into v_clauses from intel.ci_campaign_contract where participation_id = p_participation;
  if exists (select 1 from jsonb_array_elements(coalesce(v_clauses,'[]'::jsonb)) x where x->>'key' in ('non_delivery','reship'))
     and not coalesce(p_terms_ack,false) then
    raise exception 'please accept the non-delivery terms (blacklist + re-ship at your cost) to sign' using errcode='22023'; end if;
  update intel.ci_campaign_contract set terms_ack = coalesce(p_terms_ack,false) where participation_id = p_participation;
  return api.sign_contract(p_participation,
    case when intel.ci_norm_name(p_signature_name) = intel.ci_norm_name(v_names->>'expected') then v_names->>'expected'
         else btrim(regexp_replace(p_signature_name, '\s+', ' ', 'g')) end, p_asci_ack);
end $$;

-- the old signing call skipped these checks — signing now only goes through sign_contract_v2
revoke execute on function api.sign_contract(uuid, text, boolean) from public, anon, authenticated;
grant execute on function api.sign_contract(uuid, text, boolean) to service_role;
