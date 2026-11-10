-- Campaign report: public numbers for creators not connected on Geek OS (bulk-sheet rows etc.).
-- Instagram allows only so many profile reads an hour, and the worker stops at the limit. Before, it always
-- started from the same handles (A→Z), so after a big upload the creators late in the alphabet waited for hours.
-- Now handles never read come first, then the ones read longest ago — every run moves the queue forward.
create or replace function api.ops_public_post_targets(p_limit int default 40)
returns jsonb language sql stable security definer set search_path = '' as $$
  with posts as (
    -- campaign posts without insights (creator's Instagram not connected / not resolved)
    select intel.ci_participation_handle(po.participation_id) as handle, intel.ci_ig_code(po.permalink) as code, po.permalink, po.posted_at
      from intel.ci_campaign_post po
     where po.posted_at > now() - interval '60 days' and po.permalink is not null
       and not exists (select 1 from intel.ci_campaign_post_metric x where x.post_id = po.post_id)
    union all
    -- bulk-sheet rows (not registered) that are posted
    select i.handle, intel.ci_ig_code(l), l, coalesce(i.last_invited_at, i.created_at)
      from intel.ci_campaign_invite i cross join lateral unnest(i.post_links) l
     where i.participation_id is null and i.handle is not null and i.created_at > now() - interval '60 days'),
  due as (
    select p.handle, p.code, p.permalink, s.fetched_at, s.likes is null and s.comments is null and s.views is null as empty
      from posts p
      left join intel.ci_public_post_stats s on s.code = p.code
     where p.handle is not null and p.code is not null and p.code !~ '^story:'
       and (s.code is null or s.fetched_at is null or s.fetched_at < now() - case when p.posted_at > now() - interval '3 days' then interval '3 hours' else interval '12 hours' end)
       and coalesce(s.tries, 0) < 20)
  select coalesce(jsonb_agg(jsonb_build_object('handle', handle, 'codes', codes, 'links', links)), '[]'::jsonb)
    from (select handle, array_agg(distinct code) codes, array_agg(distinct permalink) links from due group by handle
           order by bool_or(fetched_at is null) desc, bool_or(coalesce(empty, true)) desc, min(fetched_at) nulls first, handle
           limit greatest(1, least(coalesce(p_limit, 40), 100))) g $$;
revoke all on function api.ops_public_post_targets(int) from public, anon, authenticated;
grant execute on function api.ops_public_post_targets(int) to service_role;
