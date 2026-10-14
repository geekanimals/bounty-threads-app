-- Creator search through Facebook Login: a workspace's Page token (with its linked Instagram professional
-- account) powers business discovery — look up any public Business/Creator profile. ADDITIVE.
alter table public.social_tokens add column if not exists meta jsonb;

-- the hourly enrichment + any workspace without its own connection use the best token: Facebook first
create or replace function api.ops_discovery_token()
returns jsonb language sql stable security definer set search_path = '' as $$
  select (select jsonb_build_object('access_token', t.access_token, 'ig_user_id', t.ig_user_id, 'platform', t.platform)
            from public.social_tokens t
           where t.platform in ('facebook','instagram') and t.ig_user_id is not null and (t.expires_at is null or t.expires_at > now())
           order by (t.platform = 'facebook') desc,
                    coalesce((t.meta->>'discovery_ok')::boolean, false) desc,
                    exists (select 1 from public.platform_admins pa where pa.user_id = t.member_id) desc,
                    t.updated_at desc nulls last
           limit 1) $$;
revoke all on function api.ops_discovery_token() from public, anon, authenticated;
grant execute on function api.ops_discovery_token() to service_role;

-- the app: which Instagram this account searches with (no tokens ever leave the server)
create or replace function public.my_discovery_connection()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'facebook', (select t.meta - 'pages' || jsonb_build_object('pages', t.meta->'pages', 'at', t.updated_at)
                   from public.social_tokens t where t.member_id = auth.uid() and t.platform = 'facebook'),
    'shared', exists (select 1 from public.social_tokens t where t.platform = 'facebook' and t.member_id <> auth.uid()
                        and coalesce((t.meta->>'discovery_ok')::boolean, false))) $$;
revoke all on function public.my_discovery_connection() from public, anon;
grant execute on function public.my_discovery_connection() to authenticated;
