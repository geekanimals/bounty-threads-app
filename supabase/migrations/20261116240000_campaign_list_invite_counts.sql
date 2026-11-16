-- Campaign list: bulk-upload invites that have not joined yet, per campaign and sheet status, so the list counts the
-- same creators as the campaign workspace (Total / Approved / Done).
create or replace function api.admin_campaign_invite_counts()
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when not public.is_platform_admin() then '{}'::jsonb else coalesce((
    select jsonb_object_agg(k, v) from (
      select coalesce(c.legacy_campaign_id, c.campaign_id)::text k, jsonb_object_agg(s.st, s.n) v
        from (select i.campaign_id, coalesce(nullif(i.status, ''), case when i.approved then 'approved' else 'registered' end) st, count(*) n
                from intel.ci_campaign_invite i where i.participation_id is null group by 1, 2) s
        join intel.ci_campaign c on c.campaign_id = s.campaign_id
       group by 1) x), '{}'::jsonb) end $$;
revoke all on function api.admin_campaign_invite_counts() from public, anon;
grant execute on function api.admin_campaign_invite_counts() to authenticated;
