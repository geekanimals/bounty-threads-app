-- Creator onboarding gate + Super Admin user directory. ADDITIVE.
-- After WhatsApp login → Instagram connect → cookie consent, a creator must complete the mandatory profile
-- before any other tab unlocks. The checklist is computed HERE (single source of truth for the app gate and
-- the Super Admin view). Sensitive fields accept an explicit "prefer not to say" answer.

-- ---------------------------------------------------------------------------------------------------
-- 1) Mandatory-profile checklist for one creator identity
-- ---------------------------------------------------------------------------------------------------
create or replace function intel.ci_profile_requirements(p_identity uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  per record; con record; cp record; r jsonb := '[]'::jsonb; v_done int := 0; v_total int := 0;
  ok boolean;
begin
  select * into per from private.creator_personal_profile where identity_id = p_identity;
  select * into con from private.creator_contact where identity_id = p_identity;
  select * into cp  from intel.ci_creator_commercial_preference where identity_id = p_identity;

  -- helper pattern: append {key,label,section,done}
  ok := exists (select 1 from intel.ci_creator_rate_card rc join intel.ci_creator_rate_card_item i on i.rate_card_id = rc.rate_card_id
                 where rc.identity_id = p_identity and rc.status = 'active' and i.deliverable_type ilike '%reel%' and i.amount > 0);
  r := r || jsonb_build_object('key','reel_rate','label','Rate card — cost per Reel','section','rate','done',ok);
  ok := cp.accepts_barter is not null;
  r := r || jsonb_build_object('key','barter','label','Open to barter? (Yes / No)','section','barter','done',ok);
  ok := exists (select 1 from intel.ci_creator_brand_aspiration a where a.identity_id = p_identity and a.active
                  and coalesce(btrim(a.submitted_brand_name),'') <> '');
  r := r || jsonb_build_object('key','fav_brands','label','Favourite brands (at least 1)','section','dreams','done',ok);
  ok := exists (select 1 from private.creator_address a where a.identity_id = p_identity and a.deleted_at is null
                  and coalesce(btrim(a.city),'') <> '' and coalesce(btrim(a.state),'') <> '' and coalesce(btrim(a.postal_code),'') <> '');
  r := r || jsonb_build_object('key','address','label','Delivery address with city, state & PIN','section','address','done',ok);
  ok := per.date_of_birth is not null;
  r := r || jsonb_build_object('key','dob','label','Birthday','section','personal','done',ok);
  ok := coalesce(btrim(per.gender),'') <> '';
  r := r || jsonb_build_object('key','gender','label','Gender','section','personal','done',ok);
  ok := per.marital_status is not null;
  r := r || jsonb_build_object('key','marital','label','Married / unmarried','section','personal','done',ok);
  if per.marital_status = 'married' then
    ok := per.marriage_anniversary is not null;
    r := r || jsonb_build_object('key','anniversary','label','Marriage anniversary','section','personal','done',ok);
  end if;
  ok := per.has_pet is not null;
  r := r || jsonb_build_object('key','pet','label','Pet? (Yes / No)','section','personal','done',ok);
  if per.has_pet then
    ok := coalesce(btrim(per.pet_name),'') <> '' and coalesce(btrim(per.pet_type),'') <> '';
    r := r || jsonb_build_object('key','pet_details','label','Pet name & type','section','personal','done',ok);
  end if;
  ok := exists (select 1 from intel.ci_creator_skill s where s.identity_id = p_identity);
  r := r || jsonb_build_object('key','skills','label','Skills (at least 1)','section','skills','done',ok);
  ok := exists (select 1 from intel.ci_creator_resource s where s.identity_id = p_identity);
  r := r || jsonb_build_object('key','resources','label','Resources / equipment (at least 1)','section','skills','done',ok);
  ok := coalesce(btrim(con.email),'') <> '' and con.email !~* '@creators\.bountythreads\.app$';
  r := r || jsonb_build_object('key','backup_email','label','Backup email (account recovery)','section','contact','done',ok);

  select count(*) filter (where (x->>'done')::boolean), count(*) into v_done, v_total from jsonb_array_elements(r) x;
  return jsonb_build_object('complete', v_done = v_total, 'done', v_done, 'total', v_total, 'items', r,
    'missing', (select coalesce(jsonb_agg(x->>'label'), '[]'::jsonb) from jsonb_array_elements(r) x where not (x->>'done')::boolean));
end $$;
revoke all on function intel.ci_profile_requirements(uuid) from public, anon, authenticated;
grant execute on function intel.ci_profile_requirements(uuid) to service_role;

-- caller's own checklist (creator app gate)
create or replace function api.get_profile_requirements()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform intel.ci_assert_api_enabled('creator_profile_api');
  return intel.ci_profile_requirements(intel.ci_caller_identity());
end $$;
revoke all on function api.get_profile_requirements() from public, anon;
grant execute on function api.get_profile_requirements() to authenticated;

-- the signed-in user's latest cookie choice recorded on the server ('all' | 'essential' | null)
create or replace function public.my_consent()
returns text language sql stable security definer set search_path = '' as $$
  select public.activity_consent_of(auth.uid()) $$;
revoke all on function public.my_consent() from public, anon;
grant execute on function public.my_consent() to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 2) Super Admin: every user on the platform — joined when, logins, last seen, consent, profile status
-- ---------------------------------------------------------------------------------------------------
create or replace function public.admin_users()
returns table(member_id uuid, name text, role text, status text, org_name text, whatsapp text, email text,
              ig_username text, followers int, joined_at timestamptz, last_sign_in_at timestamptz, logins bigint,
              last_seen timestamptz, last_ip text, last_city text, last_region text, consent text, consent_at timestamptz,
              profile_complete boolean, profile_done int, profile_total int)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then raise exception 'not a platform admin' using errcode = '42501'; end if;
  return query
  select m.id, m.name, m.role, m.status, m.org_name,
         coalesce(m.whatsapp_e164, case when u.phone is not null and u.phone <> '' then '+' || u.phone end),
         case when coalesce(m.official_email, m.email, u.email::text) ~* '@creators\.bountythreads\.app$' then null
              else coalesce(m.official_email, m.email, u.email::text) end,
         sa.username, sa.followers_count, coalesce(m.created_at, u.created_at), u.last_sign_in_at,
         (select count(*) from public.activity_log l where l.member_id = m.id and l.kind = 'security' and l.event in ('login','session_start')),
         (select max(l.created_at) from public.activity_log l where l.member_id = m.id),
         (select l.ip from public.activity_log l where l.member_id = m.id and l.ip is not null order by l.created_at desc limit 1),
         (select l.city from public.activity_log l where l.member_id = m.id and l.city is not null order by l.created_at desc limit 1),
         (select l.region from public.activity_log l where l.member_id = m.id and l.region is not null order by l.created_at desc limit 1),
         public.activity_consent_of(m.id),
         (select max(l.created_at) from public.activity_log l where l.member_id = m.id and l.kind = 'consent'),
         (req->>'complete')::boolean, (req->>'done')::int, (req->>'total')::int
    from public.members m
    join auth.users u on u.id = m.id
    left join public.social_accounts sa on sa.member_id = m.id and sa.platform = 'instagram'
    left join lateral (select a.identity_id from intel.ci_identity_actor_access a
                        where a.member_id = m.id and a.access_role = 'self' and a.revoked_at is null order by a.granted_at limit 1) idn on true
    left join lateral (select case when m.role = 'creator' and idn.identity_id is not null
                                   then intel.ci_profile_requirements(idn.identity_id) end as req) rq on true
   order by coalesce(u.last_sign_in_at, m.created_at) desc nulls last;
end $$;
revoke all on function public.admin_users() from public, anon;
grant execute on function public.admin_users() to authenticated;

-- one creator's complete profile (private fields included) — Super Admin only; every view is audit-logged
create or replace function public.admin_creator_profile(p_member uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_identity uuid;
begin
  if not public.is_platform_admin() then raise exception 'not a platform admin' using errcode = '42501'; end if;
  select a.identity_id into v_identity from intel.ci_identity_actor_access a
   where a.member_id = p_member and a.access_role = 'self' and a.revoked_at is null order by a.granted_at limit 1;
  insert into public.activity_log(member_id, kind, event, detail)
  values (auth.uid(), 'security', 'admin_view_profile', jsonb_build_object('member_id', p_member));
  if v_identity is null then return jsonb_build_object('identity_id', null); end if;
  return jsonb_build_object(
    'identity_id', v_identity,
    'requirements', intel.ci_profile_requirements(v_identity),
    'personal', (select to_jsonb(p) - 'identity_id' from private.creator_personal_profile p where p.identity_id = v_identity),
    'contact',  (select to_jsonb(c) - 'identity_id' from private.creator_contact c where c.identity_id = v_identity),
    'addresses', coalesce((select jsonb_agg(to_jsonb(a) - 'identity_id' order by a.is_default desc, a.created_at)
                           from private.creator_address a where a.identity_id = v_identity and a.deleted_at is null), '[]'::jsonb),
    'professional', (select to_jsonb(pr) - 'identity_id' from intel.ci_creator_professional_profile pr where pr.identity_id = v_identity),
    'skills', coalesce((select jsonb_agg(s.skill_key order by s.skill_key) from intel.ci_creator_skill s where s.identity_id = v_identity), '[]'::jsonb),
    'resources', coalesce((select jsonb_agg(s.resource_key order by s.resource_key) from intel.ci_creator_resource s where s.identity_id = v_identity), '[]'::jsonb),
    'commercial_preference', (select to_jsonb(cp) - 'identity_id' from intel.ci_creator_commercial_preference cp where cp.identity_id = v_identity),
    'rate_items', coalesce((select jsonb_agg(jsonb_build_object('deliverable_type', i.deliverable_type, 'amount', i.amount, 'unit_quantity', i.unit_quantity) order by i.deliverable_type)
                            from intel.ci_creator_rate_card rc join intel.ci_creator_rate_card_item i on i.rate_card_id = rc.rate_card_id
                           where rc.identity_id = v_identity and rc.status = 'active'), '[]'::jsonb),
    'fav_brands', coalesce((select jsonb_agg(a.submitted_brand_name order by a.priority_rank nulls last) from intel.ci_creator_brand_aspiration a
                            where a.identity_id = v_identity and a.active), '[]'::jsonb),
    'brands_worked', coalesce((select jsonb_agg(jsonb_build_object('brand', b.submitted_brand_name, 'type', b.relationship_type))
                               from intel.ci_creator_brand_experience b where b.identity_id = v_identity and b.creator_rejected_at is null), '[]'::jsonb));
end $$;
revoke all on function public.admin_creator_profile(uuid) from public, anon;
grant execute on function public.admin_creator_profile(uuid) to authenticated;
