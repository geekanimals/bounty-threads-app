-- Media Kit composer: the creator's own active campaigns + the posting rules from each brief (required
-- #hashtags / @mentions), so the composer can pre-fill the caption and add the ASCI disclosure. ADDITIVE.
-- Returns only the caller's own participations; never budget, contacts or other creators.
create or replace function api.get_my_posting_rules()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid; v_identity uuid;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  v_uid := auth.uid();
  if v_uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  select a.identity_id into v_identity from intel.ci_identity_actor_access a
   where a.member_id = v_uid and a.access_role = 'self' and a.revoked_at is null
   order by a.granted_at limit 1;
  if v_identity is null then return '[]'::jsonb; end if;

  return coalesce((select jsonb_agg(jsonb_build_object(
      'participation_id', p.participation_id,
      'campaign_id', c.campaign_id,
      'campaign', c.name,
      'brand', coalesce(b.name, c.submitted_brand_name),
      'stage', p.stage,
      'can_record_post', p.stage = 'content_approved',
      'hashtags', coalesce(br.requirements->'hashtags', '[]'::jsonb),
      'mentions', coalesce(br.requirements->'mentions', '[]'::jsonb))
      order by p.updated_at desc)
    from intel.ci_campaign_participation p
    join intel.ci_campaign c on c.campaign_id = p.campaign_id
    left join intel.ci_brand b on b.brand_id = c.brand_id
    left join lateral (select requirements from intel.ci_campaign_brief x
                        where x.campaign_id = c.campaign_id order by x.created_at desc limit 1) br on true
    where p.identity_id = v_identity
      and p.stage not in ('rejected', 'dropped', 'ineligible', 'brand_declined', 'completed')), '[]'::jsonb);
end $$;
revoke all on function api.get_my_posting_rules() from public, anon;
grant execute on function api.get_my_posting_rules() to authenticated, service_role;
