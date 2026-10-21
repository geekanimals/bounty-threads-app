-- Alerts page ("View all alerts" in the 🔔 drawer): every alert of the signed-in person, filterable campaign-wise.
--   p_campaign  : one campaign (null = all; the all-zeros uuid = alerts not tied to a campaign)
--   p_status    : 'all' | 'unread' | 'action' (needs action and not done yet)
--   p_search    : words in the title / text / campaign
--   p_before    : load older (created_at of the last row shown)
-- Returns the page of alerts (with campaign name + brand), the campaign list with counts, and totals.

create or replace function api.get_my_alerts_page(p_campaign uuid default null, p_status text default 'all', p_search text default null,
                                                  p_limit int default 100, p_before timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_lim int := greatest(10, least(coalesce(p_limit, 100), 300));
        v_q text := nullif(btrim(coalesce(p_search, '')), ''); v_none uuid := '00000000-0000-0000-0000-000000000000';
begin
  if v_uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  return (with base as (
      select n.notification_id, n.kind, n.title, n.body, n.action_route, n.action_label, n.created_at, n.participation_id,
             n.read_at is not null as is_read, n.acted_at is not null as is_acted,
             coalesce(n.campaign_id, p.campaign_id) as cid
        from intel.ci_notification n
        left join intel.ci_campaign_participation p on p.participation_id = n.participation_id
       where n.recipient_member_id = v_uid),
    named as (
      select b.*, c.name as campaign, coalesce(c.submitted_brand_name, br.name) as brand
        from base b left join intel.ci_campaign c on c.campaign_id = b.cid left join intel.ci_brand br on br.brand_id = c.brand_id),
    filtered as (
      select * from named x
       where (p_campaign is null or (p_campaign = v_none and x.cid is null) or x.cid = p_campaign)
         and (coalesce(p_status, 'all') = 'all'
              or (p_status = 'unread' and not x.is_read)
              or (p_status = 'action' and x.kind = 'action_required' and not x.is_acted))
         and (v_q is null or x.title ilike '%' || v_q || '%' or x.body ilike '%' || v_q || '%' or coalesce(x.campaign, '') ilike '%' || v_q || '%')),
    page as (select * from filtered where p_before is null or created_at < p_before order by created_at desc limit v_lim)
    select jsonb_build_object(
      'items', coalesce((select jsonb_agg(jsonb_build_object(
          'notification_id', notification_id, 'campaign_id', cid, 'campaign', campaign, 'brand', brand,
          'participation_id', participation_id, 'kind', kind, 'title', title, 'body', body,
          'action_route', action_route, 'action_label', action_label, 'read', is_read, 'acted', is_acted, 'created_at', created_at)
          order by created_at desc) from page), '[]'::jsonb),
      'total', (select count(*) from filtered),
      'unread', (select count(*) from filtered where not is_read),
      'more', (select count(*) from filtered where p_before is null or created_at < p_before) > v_lim,
      'campaigns', coalesce((select jsonb_agg(jsonb_build_object('campaign_id', coalesce(cid, v_none), 'campaign', coalesce(campaign, 'Not tied to a campaign'),
                       'brand', brand, 'count', cnt, 'unread', unr, 'last_at', last_at) order by (cid is null), last_at desc)
                    from (select cid, max(campaign) as campaign, max(brand) as brand, count(*) as cnt, count(*) filter (where not is_read) as unr, max(created_at) as last_at
                            from named group by cid) g), '[]'::jsonb)));
end $$;
revoke all on function api.get_my_alerts_page(uuid, text, text, int, timestamptz) from public, anon;
grant execute on function api.get_my_alerts_page(uuid, text, text, int, timestamptz) to authenticated;

-- mark everything in the current filter as read
create or replace function api.mark_alerts_read(p_campaign uuid default null)
returns int language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_n int; v_none uuid := '00000000-0000-0000-0000-000000000000';
begin
  if v_uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  update intel.ci_notification n set read_at = now()
   where n.recipient_member_id = v_uid and n.read_at is null
     and (p_campaign is null
          or (p_campaign = v_none and n.campaign_id is null and not exists (select 1 from intel.ci_campaign_participation p where p.participation_id = n.participation_id))
          or coalesce(n.campaign_id, (select p.campaign_id from intel.ci_campaign_participation p where p.participation_id = n.participation_id)) = p_campaign);
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function api.mark_alerts_read(uuid) from public, anon;
grant execute on function api.mark_alerts_read(uuid) to authenticated;
