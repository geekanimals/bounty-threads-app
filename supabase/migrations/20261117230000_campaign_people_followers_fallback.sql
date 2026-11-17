-- Campaign creators list: bulk invite rows showed "— followers".
-- Like the old app, fall back to the creator's Instagram account, then to
-- discovery data (ci_external_creator) by handle, when the sheet had no followers.
do $$
declare d text;
begin
  d := pg_get_functiondef('api.campaign_people'::regproc);
  if position('''followers'', i.followers,' in d) > 0 then
    d := replace(d, '''followers'', i.followers,',
      '''followers'', coalesce(i.followers, (select max(sa.followers_count) from public.social_accounts sa where sa.member_id = mem.mid and sa.platform = ''instagram''), (select e.followers from intel.ci_external_creator e where i.handle is not null and lower(e.handle) = lower(ltrim(i.handle,''@'')) order by e.last_seen_at desc nulls last limit 1)),');
    execute d;
  end if;
end $$;
