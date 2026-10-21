-- Creator profile card (team view): every detail of the creator in one call — name, gender, birthday, contact,
-- every delivery address (the one used for this campaign marked), professional profile, skills, equipment,
-- barter preferences, rates, brands worked with, dream brands, and all their campaigns.
-- Allowed for the Super Admin, agency operators, and the team of a campaign this creator is on.
create or replace function api.admin_creator_full(p_participation uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare p intel.ci_campaign_participation%rowtype; v_id uuid; v_mid uuid;
begin
  select * into p from intel.ci_campaign_participation where participation_id = p_participation;
  if p.participation_id is null then raise exception 'not found' using errcode = 'P0002'; end if;
  if not (public.is_platform_admin() or intel.ci_is_agency_operator() or intel.ci_can_manage_participation(p_participation)) then
    raise exception 'not your campaign' using errcode = '42501'; end if;
  v_id := p.identity_id; v_mid := intel.ci_member_of_identity(v_id);
  return jsonb_build_object(
    'member_id', v_mid,
    'name', (select m.name from public.members m where m.id = v_mid),
    'login_email', (select nullif(u.email::text,'') from auth.users u where u.id = v_mid and u.email !~* '@creators\.bountythreads\.app$'),
    'whatsapp', (select jsonb_build_object('phone', w.phone_e164, 'verified', w.verified_at is not null, 'opted_out', w.opt_out_at is not null)
                   from public.wa_contacts w where w.user_id = v_mid order by w.verified_at desc nulls last limit 1),
    'personal', (select to_jsonb(x) - 'identity_id' - 'first_name_confirmed_at' - 'last_name_confirmed_at' - 'created_at' - 'updated_at'
                   from private.creator_personal_profile x where x.identity_id = v_id),
    'contact', (select to_jsonb(x) - 'identity_id' - 'comm_consent_version' - 'comm_consent_purpose' - 'created_at' - 'updated_at'
                  from private.creator_contact x where x.identity_id = v_id),
    'campaign_address_id', p.shipping_address_id,
    'addresses', coalesce((select jsonb_agg(to_jsonb(a) - 'identity_id' - 'deleted_at' - 'updated_at' order by (a.address_id = p.shipping_address_id) desc, a.is_default desc, a.created_at)
                             from private.creator_address a where a.identity_id = v_id and a.deleted_at is null), '[]'::jsonb),
    'professional', (select to_jsonb(x) - 'identity_id' - 'created_at' - 'updated_at' from intel.ci_creator_professional_profile x where x.identity_id = v_id),
    'skills', coalesce((select jsonb_agg(jsonb_build_object('key', s.skill_key, 'level', s.skill_level, 'years', s.years_experience, 'link', s.portfolio_link) order by s.skill_key)
                          from intel.ci_creator_skill s where s.identity_id = v_id), '[]'::jsonb),
    'resources', coalesce((select jsonb_agg(r.resource_key order by r.resource_key) from intel.ci_creator_resource r where r.identity_id = v_id), '[]'::jsonb),
    'commercial', (select to_jsonb(x) - 'identity_id' - 'created_at' - 'updated_at' - 'last_confirmed_at' from intel.ci_creator_commercial_preference x where x.identity_id = v_id),
    'rates', coalesce((select jsonb_agg(jsonb_build_object('type', ri.deliverable_type, 'amount', ri.amount, 'currency', rc.currency, 'negotiable', rc.negotiable,
                          'notes', ri.notes) order by ri.amount)
                         from intel.ci_creator_rate_card rc join intel.ci_creator_rate_card_item ri on ri.rate_card_id = rc.rate_card_id
                        where rc.identity_id = v_id), '[]'::jsonb),
    'brands_worked', coalesce((select jsonb_agg(jsonb_build_object('brand', coalesce(b.submitted_brand_name, (select br.name from intel.ci_brand br where br.brand_id = b.brand_id)),
                          'type', b.relationship_type, 'pay', b.compensation_type, 'from', b.start_date, 'to', b.end_date) order by b.start_date desc nulls last)
                         from intel.ci_creator_brand_experience b where b.identity_id = v_id and b.creator_rejected_at is null), '[]'::jsonb),
    'dream_brands', coalesce((select jsonb_agg(coalesce(d.submitted_brand_name, (select br.name from intel.ci_brand br where br.brand_id = d.brand_id)) order by d.priority_rank nulls last)
                         from intel.ci_creator_brand_aspiration d where d.identity_id = v_id and d.active), '[]'::jsonb),
    'travelling', (select jsonb_build_object('city', t.city, 'state', t.state, 'country', t.country, 'until', t.until_date)
                     from intel.ci_creator_travel t where t.identity_id = v_id and (t.until_date is null or t.until_date >= current_date) limit 1),
    'campaigns', coalesce((select jsonb_agg(jsonb_build_object('campaign', c.name, 'brand', c.submitted_brand_name, 'stage', x.stage, 'at', x.created_at,
                          'this', x.participation_id = p_participation) order by x.created_at desc)
                         from intel.ci_campaign_participation x join intel.ci_campaign c on c.campaign_id = x.campaign_id where x.identity_id = v_id), '[]'::jsonb),
    'blacklisted', exists (select 1 from intel.ci_creator_blacklist b where b.identity_id = v_id and b.lifted_at is null));
end $$;
revoke all on function api.admin_creator_full(uuid) from public, anon;
grant execute on function api.admin_creator_full(uuid) to authenticated;
