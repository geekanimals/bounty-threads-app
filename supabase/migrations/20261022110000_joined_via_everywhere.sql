-- "Joined via" everywhere a creator shows up: the campaign (or creator upload) that brought them onto Geek OS.
-- Added to the shared creator card (campaign rows, approvals, to-do, reports) and the Super Admin creators list.
create or replace function intel.ci_public_creator_card(p_identity uuid, p_handle text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb := intel.ci_public_creator_card_v1(p_identity, p_handle); v_pct int; v_jv jsonb;
begin
  if v is null then return v; end if;
  v_pct := intel.ci_profile_pct(nullif(v->>'member_id','')::uuid);
  if v_pct is not null then v := v || jsonb_build_object('profile_pct', v_pct); end if;
  if p_identity is not null then
    v_jv := intel.ci_joined_via(p_identity);
    if v_jv is not null and v_jv <> '{}'::jsonb then v := v || jsonb_build_object('joined_via', v_jv); end if;
  end if;
  return v;
end $$;

CREATE OR REPLACE FUNCTION public.admin_creators()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.is_platform_admin() then raise exception 'not a platform admin' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(x order by (x->>'joined_at') desc nulls last) from (
    select jsonb_build_object(
      'member_id', m.id,
      'name', coalesce(nullif(btrim(m.name),''), nullif(btrim(concat_ws(' ', per.first_name, per.last_name)),''), sa.name, sa.username, 'Creator'),
      'status', m.status,
      'joined_at', coalesce(m.created_at, u.created_at),
      'last_sign_in_at', u.last_sign_in_at,
      'last_seen', (select max(l.created_at) from public.activity_log l where l.member_id = m.id),
      'whatsapp', coalesce(m.whatsapp_e164, case when coalesce(u.phone,'') <> '' then '+' || u.phone end),
      'email', case when coalesce(con.email,'') ~* '@creators\.bountythreads\.app$' then null else nullif(con.email,'') end,
      'email_verified', con.email_verified_at is not null,
      'ig_username', sa.username, 'followers', sa.followers_count, 'media_count', sa.media_count,
      'pic', sa.profile_picture_url, 'ig_synced_at', sa.updated_at,
      'engagement', (select round(avg(coalesce((e->>'like_count')::numeric,0) + coalesce((e->>'comments_count')::numeric,0))
                                  / nullif(sa.followers_count,0) * 100, 2)
                       from jsonb_array_elements(case when jsonb_typeof(sa.recent_media) = 'array' then sa.recent_media else '[]'::jsonb end) e),
      'identity_id', idn.identity_id,
      'joined_via', case when idn.identity_id is not null then intel.ci_joined_via(idn.identity_id) end,
      'city', coalesce(ad.city, pr.city_coarse), 'state', coalesce(ad.state, pr.state_coarse),
      'categories', coalesce(to_jsonb(pr.categories), '[]'::jsonb),
      'gender', per.gender,
      'accepts_barter', cp.accepts_barter,
      'reel_rate', (select min(i.amount) from intel.ci_creator_rate_card rc join intel.ci_creator_rate_card_item i on i.rate_card_id = rc.rate_card_id
                     where rc.identity_id = idn.identity_id and rc.status = 'active' and i.deliverable_type ilike '%reel%' and i.amount > 0),
      'skills', coalesce((select jsonb_agg(s.skill_key order by s.skill_key) from intel.ci_creator_skill s where s.identity_id = idn.identity_id), '[]'::jsonb),
      'pets', (select count(*) from private.creator_pet p where p.identity_id = idn.identity_id),
      'pages', (select count(*) from intel.ci_creator_managed_profile g where g.identity_id = idn.identity_id),
      'travel_city', (select t.city from intel.ci_creator_travel t where t.identity_id = idn.identity_id),
      'complete', (rq.req->>'complete')::boolean, 'done', (rq.req->>'done')::int, 'total', (rq.req->>'total')::int,
      'applied', (select count(*) from intel.ci_campaign_participation p where p.identity_id = idn.identity_id)
               + (select count(*) from public.applications a where m.org_id is not null and a.org_id = m.org_id),
      'pending', (select count(*) from intel.ci_campaign_participation p where p.identity_id = idn.identity_id
                    and p.stage in ('applied','eligible','sent_to_brand','shortlisted','invited')),
      'approved', (select count(*) from intel.ci_campaign_participation p where p.identity_id = idn.identity_id
                    and p.stage not in ('applied','eligible','sent_to_brand','shortlisted','invited','ineligible','brand_declined','rejected','dropped'))
                + (select count(*) from public.applications a where m.org_id is not null and a.org_id = m.org_id and a.status = 'Approved'),
      'completed', (select count(*) from intel.ci_campaign_participation p where p.identity_id = idn.identity_id and p.stage = 'completed')) x
    from public.members m
    join auth.users u on u.id = m.id
    left join public.social_accounts sa on sa.member_id = m.id and sa.platform = 'instagram'
    left join lateral (select a.identity_id from intel.ci_identity_actor_access a
                        where a.member_id = m.id and a.access_role = 'self' and a.revoked_at is null order by a.granted_at limit 1) idn on true
    left join private.creator_personal_profile per on per.identity_id = idn.identity_id
    left join private.creator_contact con on con.identity_id = idn.identity_id
    left join intel.ci_creator_professional_profile pr on pr.identity_id = idn.identity_id
    left join intel.ci_creator_commercial_preference cp on cp.identity_id = idn.identity_id
    left join lateral (select a.city, a.state from private.creator_address a where a.identity_id = idn.identity_id and a.deleted_at is null
                        order by a.is_default desc, a.created_at limit 1) ad on true
    left join lateral (select case when idn.identity_id is not null then intel.ci_profile_requirements(idn.identity_id) end as req) rq on true
   where m.role = 'creator') s), '[]'::jsonb);
end $function$;
