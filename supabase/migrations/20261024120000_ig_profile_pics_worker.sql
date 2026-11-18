-- Keep creators' Instagram profile pictures fresh (signed CDN links expire after a few days).
-- 1) allow pg_cron to kick the new ig-profile-pics-worker Edge Function
create or replace function private.ci_kick_worker(p_fn text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_secret text; v_url text;
begin
  if p_fn not in ('ops-notify-dispatch','ops-reminder-worker','wa-template-sync','ig-discover-worker','ci-post-insights-worker','wa-bot-worker','ig-profile-pics-worker') then return null; end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'ci_worker_secret' limit 1;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'ci_project_url' limit 1;
  if v_secret is null or v_url is null then return null; end if;
  return net.http_post(url := v_url || '/functions/v1/' || p_fn, body := '{}'::jsonb,
                       headers := jsonb_build_object('Content-Type','application/json','x-worker-secret', v_secret),
                       timeout_milliseconds := 25000);
exception when others then
  raise warning 'ci_kick_worker(%) skipped: %', p_fn, sqlerrm; return null;
end $$;
revoke all on function private.ci_kick_worker(text) from public, anon, authenticated;

-- 2) every 6 hours (and pictures expiring within 24h are always refreshed in time)
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('ig-profile-pics', '17 */6 * * *', $c$select private.ci_kick_worker('ig-profile-pics-worker')$c$);
  end if;
exception when others then raise warning 'ig-profile-pics cron not scheduled: %', sqlerrm; end $$;

-- 3) public, read-only list for the agency website's homepage mosaic (handle + picture + followers only;
--    creators only; never blocklisted creators)
create or replace function public.website_instagram_creators(p_limit int default 48)
returns table (username text, profile_picture_url text, followers_count int)
language sql stable security definer set search_path = '' as $$
  select s.username, s.profile_picture_url, s.followers_count
    from public.social_accounts s
   where s.platform = 'instagram'
     and coalesce(s.username, '') <> ''
     and coalesce(s.profile_picture_url, '') <> ''
     and exists (select 1 from intel.ci_identity_actor_access a
                  where a.member_id = s.member_id and a.access_role = 'self' and a.revoked_at is null)
     and not exists (select 1 from intel.ci_identity_actor_access a
                       join intel.ci_creator_blacklist b on b.identity_id = a.identity_id and b.lifted_at is null
                      where a.member_id = s.member_id and a.access_role = 'self' and a.revoked_at is null)
     and not exists (select 1 from intel.ci_creator_blacklist b
                      where lower(b.handle) = lower(s.username) and b.lifted_at is null)
   order by s.connected_at desc nulls last, s.updated_at desc nulls last   -- latest creators first
   limit least(greatest(coalesce(p_limit, 48), 1), 100)
$$;
revoke all on function public.website_instagram_creators(int) from public;
grant execute on function public.website_instagram_creators(int) to anon, authenticated;
