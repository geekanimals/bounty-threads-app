-- Super Admin panel cleanup: one live "command centre" summary, clean names, typed legacy campaigns,
-- and no ghost applications from deleted creators. ADDITIVE (plus a one-time orphan cleanup).

-- 1) older campaigns get a campaign type from their legacy type text (the bridge trigger re-syncs the pipeline)
update public.campaigns set
  campaign_type = case when type ilike '%hybrid%' then 'barter_paid'
                       when type ilike '%paid%' or type ilike '%ugc%' then 'paid'
                       else 'barter' end,
  barter_subtype = case when type ilike '%hybrid%' or type ilike '%paid%' or type ilike '%ugc%' then barter_subtype
                        when type ilike '%celebrity%' then 'celebrity_story'
                        when type ilike '%seeding%' or type ilike '%turnkey%' then 'pr_package'
                        else 'normal_barter' end
 where campaign_type is null;

-- 2) WhatsApp creators have no name until Instagram connects → use the Instagram name / @username
create or replace function public.tg_member_name_from_instagram()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if NEW.member_id is not null and NEW.platform = 'instagram' then
    update public.members set name = coalesce(nullif(btrim(NEW.name), ''), NEW.username)
     where id = NEW.member_id and coalesce(btrim(name), '') = '' and coalesce(NEW.name, NEW.username) is not null;
  end if;
  return NEW;
exception when others then return NEW;      -- never block an Instagram sync over a display name
end $$;
revoke all on function public.tg_member_name_from_instagram() from public, anon, authenticated;
drop trigger if exists member_name_from_instagram on public.social_accounts;
create trigger member_name_from_instagram after insert or update of name, username on public.social_accounts
  for each row execute function public.tg_member_name_from_instagram();

update public.members m set name = coalesce(nullif(btrim(sa.name), ''), sa.username)
  from public.social_accounts sa
 where sa.member_id = m.id and sa.platform = 'instagram' and coalesce(btrim(m.name), '') = ''
   and coalesce(sa.name, sa.username) is not null;

-- 3) marketplace applications whose creator account no longer exists (deleted test creators)
delete from public.applications a
 where a.org_id is not null and not exists (select 1 from public.members m where m.org_id = a.org_id);

-- 4) activity list: real name / Instagram handle, never the internal WhatsApp login address
create or replace function public.admin_activity_summary(p_days int default 30)
returns table(member_id uuid, name text, email text, role text, ig_username text, last_seen timestamptz,
              sessions bigint, minutes numeric, page_views bigint, last_ip text, last_city text, last_region text,
              last_country text, consent text, last_event text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then raise exception 'not a platform admin' using errcode = '42501'; end if;
  return query
  with a as (select * from public.activity_log where created_at > now() - make_interval(days => greatest(p_days,1)))
  select a.member_id, coalesce(nullif(m.name,''), sa.username, nullif('+' || u.phone, '+')),
         case when coalesce(m.email, u.email::text) ~* '@creators\.bountythreads\.app$' then null else coalesce(m.email, u.email)::text end,
         m.role, sa.username,
         max(a.created_at), count(distinct a.session_id),
         round(coalesce(sum(a.duration_ms) filter (where a.event = 'time'), 0) / 60000.0, 1),
         count(*) filter (where a.event = 'page_view'),
         (array_agg(a.ip order by a.created_at desc))[1],
         (array_agg(a.city order by a.created_at desc) filter (where a.city is not null))[1],
         (array_agg(a.region order by a.created_at desc) filter (where a.region is not null))[1],
         (array_agg(a.country order by a.created_at desc) filter (where a.country is not null))[1],
         public.activity_consent_of(a.member_id),
         (array_agg(a.event order by a.created_at desc))[1]
    from a
    join auth.users u on u.id = a.member_id
    left join public.members m on m.id = a.member_id
    left join public.social_accounts sa on sa.member_id = a.member_id and sa.platform = 'instagram'
   group by a.member_id, m.name, m.email, u.email, u.phone, m.role, sa.username
   order by max(a.created_at) desc;
end $$;
revoke all on function public.admin_activity_summary(int) from public, anon;
grant execute on function public.admin_activity_summary(int) to authenticated;

-- 5) the Super Admin command centre: what needs attention now + live platform numbers + latest events
create or replace function public.admin_dashboard()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_today timestamptz := date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
begin
  if not public.is_platform_admin() then raise exception 'not a platform admin' using errcode = '42501'; end if;
  return jsonb_build_object(
    'todo', jsonb_build_object(
      'accounts_pending', (select count(*) from public.members where status = 'pending'),
      'applications_pending', (select count(*) from intel.ci_campaign_participation where stage in ('applied','eligible','sent_to_brand'))
                            + (select count(*) from public.applications where status = 'Applied'),
      'campaigns_awaiting', (select count(*) from public.campaigns where status = 'Approval'),
      'creators_incomplete', (select count(*) from public.members m
                                join intel.ci_identity_actor_access a on a.member_id = m.id and a.access_role = 'self' and a.revoked_at is null
                               where m.role = 'creator' and not coalesce((intel.ci_profile_requirements(a.identity_id)->>'complete')::boolean, false)),
      'contracts_to_send', (select count(*) from intel.ci_campaign_participation where stage = 'brand_confirmed'),
      'content_to_review', (select count(*) from intel.ci_campaign_participation where stage = 'content_submitted')),
    'people', jsonb_build_object(
      'total', (select count(*) from public.members),
      'creators', (select count(*) from public.members where role = 'creator'),
      'agencies', (select count(*) from public.members where role = 'owner'),
      'brands', (select count(*) from public.members where role = 'brand'),
      'joined_today', (select count(*) from public.members where created_at >= v_today),
      'signed_in_today', (select count(*) from auth.users u join public.members m on m.id = u.id where u.last_sign_in_at >= v_today),
      'instagram_connected', (select count(distinct member_id) from public.social_accounts where platform = 'instagram')),
    'campaigns', jsonb_build_object(
      'total', (select count(*) from public.campaigns),
      'live', (select count(*) from public.campaigns where status in ('Sourcing','Live','In Production')),
      'paid', (select count(*) from public.campaigns where campaign_type = 'paid'),
      'barter', (select count(*) from public.campaigns where campaign_type = 'barter'),
      'barter_paid', (select count(*) from public.campaigns where campaign_type = 'barter_paid'),
      'applications', (select count(*) from intel.ci_campaign_participation) + (select count(*) from public.applications),
      'approved', (select count(*) from intel.ci_campaign_participation
                    where stage not in ('applied','eligible','sent_to_brand','ineligible','brand_declined','dropped','rejected','shortlisted','invited'))
                + (select count(*) from public.applications where status = 'Approved')),
    'recent', coalesce((select jsonb_agg(x order by (x->>'at') desc) from (
        select jsonb_build_object('at', l.created_at, 'event', l.event, 'kind', l.kind, 'city', l.city,
                 'who', coalesce(nullif(m.name,''), sa.username, nullif('+' || u.phone, '+'), 'Someone'), 'role', m.role, 'detail', l.detail) x
          from public.activity_log l
          join auth.users u on u.id = l.member_id
          left join public.members m on m.id = l.member_id
          left join public.social_accounts sa on sa.member_id = l.member_id and sa.platform = 'instagram'
         where l.kind in ('security','consent') and l.event not in ('session_start','admin_view_profile')
         order by l.created_at desc limit 20) r), '[]'::jsonb));
end $$;
revoke all on function public.admin_dashboard() from public, anon;
grant execute on function public.admin_dashboard() to authenticated;
