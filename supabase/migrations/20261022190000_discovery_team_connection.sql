-- Discovery: one Facebook connection (by any Super Admin / team member) powers Instagram search for everyone.
-- The app now also gets that shared connection ("team"), so other logins see "Searching with @geekanimals"
-- instead of being asked to connect Facebook again. Tokens never leave the server.
create or replace function public.my_discovery_connection()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'facebook', (select t.meta - 'pages' || jsonb_build_object('pages', t.meta->'pages', 'at', t.updated_at)
                   from public.social_tokens t where t.member_id = auth.uid() and t.platform = 'facebook'),
    'team', (select jsonb_build_object('ig_username', t.meta->>'ig_username', 'page_name', t.meta->>'page_name',
                      'discovery_ok', coalesce((t.meta->>'discovery_ok')::boolean, false), 'discovery_error', t.meta->>'discovery_error',
                      'by', m.name, 'at', t.updated_at)
               from public.social_tokens t left join public.members m on m.id = t.member_id
              where t.platform = 'facebook' and t.ig_user_id is not null and (t.expires_at is null or t.expires_at > now())
              order by coalesce((t.meta->>'discovery_ok')::boolean, false) desc, t.updated_at desc nulls last limit 1),
    'shared', exists (select 1 from public.social_tokens t where t.platform = 'facebook' and t.ig_user_id is not null
                        and (t.expires_at is null or t.expires_at > now()))) $$;
revoke all on function public.my_discovery_connection() from public, anon;
grant execute on function public.my_discovery_connection() to authenticated;
