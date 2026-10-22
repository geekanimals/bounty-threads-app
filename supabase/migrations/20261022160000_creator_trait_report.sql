-- Custom creator report: one row per creator with every trait (category, skills, content types, languages, city,
-- state, gender, age, profile completion %, followers, engagement, barter, pet, parent, joined via…) plus how they
-- did in the chosen campaigns (stage, posted, completed, views / reach / likes). The page groups the rows by any
-- trait (and splits by a second one), so after a campaign is done the team can see what the creators had in common.
-- Scope:
--   p_campaign → creators of that campaign (Geek OS creators + invited / bulk-uploaded ones with what we know)
--   p_brand    → creators across that brand's campaigns
--   neither    → Super Admin: every creator · others: creators on any campaign they run
--   p_only     → 'completed' (posted or completed only) · 'approved' (brand said yes) · null (everyone)
create or replace function api.creator_trait_rows(p_campaign uuid default null, p_brand uuid default null, p_only text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_camp uuid := intel.ci_resolve_campaign(p_campaign); v_admin boolean := public.is_platform_admin() or intel.ci_is_agency_operator();
        v_rows jsonb; v_inv jsonb;
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  if p_campaign is not null and (v_camp is null or not intel.ci_can_manage_campaign(v_camp)) then raise exception 'not your campaign' using errcode = '42501'; end if;
  if p_brand is not null and not intel.ci_can_see_brand(p_brand) then raise exception 'not your brand' using errcode = '42501'; end if;

  with camps as (   -- the campaigns in scope
    select c.campaign_id from intel.ci_campaign c
     where (v_camp is null or c.campaign_id = v_camp)
       and (p_brand is null or c.brand_id = p_brand
            or exists (select 1 from public.campaigns pc where pc.id = c.legacy_campaign_id and pc.brand_id = p_brand))
       and (v_admin or intel.ci_can_manage_campaign(c.campaign_id))),
  parts as (
    select p.identity_id, p.participation_id, p.stage, p.campaign_id from intel.ci_campaign_participation p
     where p.campaign_id in (select campaign_id from camps)
       and (p_only is null
            or (p_only = 'completed' and p.stage in ('published','completed'))
            or (p_only = 'approved' and p.stage not in ('applied','eligible','sent_to_brand','shortlisted','invited','ineligible','brand_declined','rejected','dropped')))),
  ids as (   -- campaign scope → its creators; no scope → Super Admin sees every creator, others their campaigns' creators
    select distinct identity_id from parts
    union
    select a.identity_id from intel.ci_identity_actor_access a join public.members m on m.id = a.member_id and m.role = 'creator'
     where v_camp is null and p_brand is null and p_only is null and public.is_platform_admin()
       and a.access_role = 'self' and a.revoked_at is null),
  stats as (
    select pa.identity_id, count(distinct pa.campaign_id) campaigns,
           count(*) filter (where pa.stage in ('published','completed')) posted,
           count(*) filter (where pa.stage = 'completed') completed,
           count(*) filter (where pa.stage not in ('applied','eligible','sent_to_brand','shortlisted','invited','ineligible','brand_declined','rejected','dropped')) approved,
           (array_agg(pa.stage order by array_position(array['completed','published','content_approved','content_submitted','changes_requested','content_created',
              'product_sent','address_confirmed','contract_signed','contract_sent','brand_confirmed','shortlisted','sent_to_brand','eligible','applied','invited',
              'dropped','rejected','brand_declined','ineligible']::text[], pa.stage) nulls last))[1] best_stage
      from parts pa group by pa.identity_id),
  posts as (
    select pa.identity_id, count(po.post_id) posts,
           sum(nullif(s->>'views','')::numeric) views, sum(nullif(s->>'reach','')::numeric) reach,
           sum(nullif(s->>'likes','')::numeric) likes, sum(nullif(s->>'comments','')::numeric) comments
      from parts pa join intel.ci_campaign_post po on po.participation_id = pa.participation_id
      cross join lateral intel.ci_post_stats(po.post_id) s
     group by pa.identity_id)
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'kind', 'creator', 'identity_id', i.identity_id, 'member_id', mem.id,
      'name', coalesce(nullif(btrim(mem.name),''), nullif(btrim(concat_ws(' ', per.first_name, per.last_name)),''), sa.name, sa.username, 'Creator'),
      'handle', sa.username, 'pic', sa.profile_picture_url,
      'followers', sa.followers_count,
      'engagement', (select round(avg(coalesce((e->>'like_count')::numeric,0) + coalesce((e->>'comments_count')::numeric,0)) / nullif(sa.followers_count,0) * 100, 2)
                       from jsonb_array_elements(case when jsonb_typeof(sa.recent_media) = 'array' then sa.recent_media else '[]'::jsonb end) e),
      'categories', (select jsonb_agg(distinct lower(btrim(c))) from unnest(coalesce(pr.categories,'{}')) c where btrim(c) <> ''),
      'skills', (select jsonb_agg(distinct lower(s.skill_key)) from intel.ci_creator_skill s where s.identity_id = i.identity_id),
      'formats', (select jsonb_agg(distinct lower(btrim(c))) from unnest(coalesce(pr.content_formats,'{}')) c where btrim(c) <> ''),
      'languages', (select jsonb_agg(distinct initcap(btrim(c))) from unnest(coalesce(pr.languages,'{}')) c where btrim(c) <> ''),
      'city', coalesce(ad.city, pr.city_coarse), 'state', coalesce(ad.state, pr.state_coarse),
      'gender', lower(per.gender), 'marital', per.marital_status,
      'age', case when per.date_of_birth is not null then extract(year from age(per.date_of_birth))::int end,
      'profile_pct', case when mem.id is not null then intel.ci_profile_pct(mem.id) end,
      'barter', cp.accepts_barter, 'travel', cp.travel_ready,
      'pet', coalesce(per.has_pet, false) or exists (select 1 from private.creator_pet p where p.identity_id = i.identity_id),
      'parent', (exists (select 1 from unnest(coalesce(pr.categories, '{}')) c where c ~* 'parent|mom|kid|baby')
                 or lower(coalesce(sa.biography,'') || ' ' || coalesce(pr.bio,''))
                    ~ '(\m(mom|moms|mommy|mumma|mama|momlife|mother|mum|dad|daddy|father|parent|parenting|toddler|newborn|baby|kids|motherhood)\M)'),
      'joined_via', (intel.ci_joined_via(i.identity_id))->>'how',
      'campaigns', st.campaigns, 'stage', st.best_stage, 'approved', st.approved, 'posted', st.posted, 'completed', st.completed,
      'posts', ps.posts, 'views', ps.views, 'reach', ps.reach, 'likes', ps.likes, 'comments', ps.comments))), '[]'::jsonb)
    into v_rows
    from ids i
    left join lateral (select a.member_id from intel.ci_identity_actor_access a where a.identity_id = i.identity_id and a.access_role = 'self'
                        and a.revoked_at is null order by a.granted_at limit 1) acc on true
    left join public.members mem on mem.id = acc.member_id
    left join public.social_accounts sa on sa.member_id = mem.id and sa.platform = 'instagram'
    left join private.creator_personal_profile per on per.identity_id = i.identity_id
    left join intel.ci_creator_professional_profile pr on pr.identity_id = i.identity_id
    left join intel.ci_creator_commercial_preference cp on cp.identity_id = i.identity_id
    left join lateral (select a.city, a.state from private.creator_address a where a.identity_id = i.identity_id and a.deleted_at is null
                        order by a.is_default desc, a.created_at limit 1) ad on true
    left join stats st on st.identity_id = i.identity_id
    left join posts ps on ps.identity_id = i.identity_id;

  -- a campaign's invited / bulk-uploaded creators who aren't on Geek OS yet: what the sheet told us
  if v_camp is not null and p_only is null then
    select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'kind', 'invite', 'invite_id', iv.invite_id, 'name', coalesce(nullif(btrim(iv.full_name),''), '@' || iv.handle), 'handle', iv.handle,
        'followers', iv.followers, 'city', iv.city, 'stage', coalesce(nullif(iv.status,''), 'invited'),
        'joined_via', case when iv.source in ('bulk','sheet','upload') then 'bulk upload' else 'invite' end,
        'posted', case when coalesce(cardinality(iv.post_links), 0) > 0 then 1 else 0 end))), '[]'::jsonb)
      into v_inv
      from intel.ci_campaign_invite iv
     where iv.campaign_id = v_camp and iv.claimed_by is null and iv.participation_id is null;
  end if;

  return jsonb_build_object('rows', v_rows || coalesce(v_inv, '[]'::jsonb),
    'campaign', (select jsonb_build_object('id', c.campaign_id, 'name', c.name, 'status', c.lifecycle_status) from intel.ci_campaign c where c.campaign_id = v_camp),
    'brand', (select jsonb_build_object('id', b.brand_id, 'name', b.name) from intel.ci_brand b where b.brand_id = p_brand),
    'generated_at', now());
end $$;
revoke all on function api.creator_trait_rows(uuid, uuid, text) from public, anon;
grant execute on function api.creator_trait_rows(uuid, uuid, text) to authenticated;
