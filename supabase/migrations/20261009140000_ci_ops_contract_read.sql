-- Phase 2 (barter pipeline) — contract read for the signing UI. ADDITIVE + DARK.
-- The creator needs to see the contract terms before signing. Owner-only, gated by operational_pilot,
-- no PII. Reuses the existing authorization pattern (caller identity must own the participation).

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
      'ad_rights_until', k.ad_rights_until, 'collab_rights', k.collab_rights, 'product', k.product,
      'deliverables', k.deliverables, 'asci_ack', k.asci_ack, 'signed_at', k.signed_at, 'signature_name', k.signature_name)
    from intel.ci_campaign_contract k where k.participation_id=p_participation);
end $$;
revoke all on function api.get_my_contract(uuid) from public, anon;
grant execute on function api.get_my_contract(uuid) to authenticated, service_role;
