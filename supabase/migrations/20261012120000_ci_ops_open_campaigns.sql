-- Creator self-serve discovery: list campaigns open for applications. ADDITIVE + DARK.
-- Gap closed: api.apply_to_campaign existed but a creator had no way to SEE open campaigns, so the
-- application-first funnel could only be entered by an operator adding the creator manually.
-- Safe projection only: never budget, org/company contact details, matching data or other applicants.
-- Gated by operational_pilot + pilot cohort (ci_assert_api_enabled), authenticated callers only.

create or replace function api.list_open_campaigns()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid; v_identity uuid;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  v_uid := auth.uid();
  if v_uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  -- caller's own creator identity, if any (no exception: a brand-new WhatsApp creator may not have one yet)
  select a.identity_id into v_identity from intel.ci_identity_actor_access a
   where a.member_id = v_uid and a.access_role = 'self' and a.revoked_at is null
   order by a.granted_at limit 1;

  return coalesce((select jsonb_agg(jsonb_build_object(
      'campaign_id', c.campaign_id,
      'name',        c.name,
      'brand',       coalesce(b.name, c.submitted_brand_name),
      'product',     c.product,
      'category',    c.category,
      'comp_type',   c.comp_type,
      'cities',      coalesce(to_jsonb(c.cities), '[]'::jsonb),
      'languages',   coalesce(to_jsonb(c.languages), '[]'::jsonb),
      'starts_on',   c.starts_on,
      'ends_on',     c.ends_on,
      -- only the creator-facing posting rules from the brief (needed to post correctly)
      'hashtags',    coalesce(br.requirements->'hashtags', '[]'::jsonb),
      'mentions',    coalesce(br.requirements->'mentions', '[]'::jsonb),
      'my_stage',    p.stage,
      'my_participation_id', p.participation_id)
      order by c.created_at desc)
    from intel.ci_campaign c
    left join intel.ci_brand b on b.brand_id = c.brand_id
    left join lateral (select requirements from intel.ci_campaign_brief x
                        where x.campaign_id = c.campaign_id order by x.created_at desc limit 1) br on true
    left join intel.ci_campaign_participation p
           on p.campaign_id = c.campaign_id and v_identity is not null and p.identity_id = v_identity
    where c.lifecycle_status in ('creator_discovery', 'in_execution')
      and (c.ends_on is null or c.ends_on >= current_date)), '[]'::jsonb);
end $$;
revoke all on function api.list_open_campaigns() from public, anon;
grant execute on function api.list_open_campaigns() to authenticated, service_role;
