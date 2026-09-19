-- Coexistence integration tests: legacy Geek schema + the six Creator Intelligence migrations.
-- Run by the CI 'legacy-coexistence' job AFTER applying the legacy fixture then the CI migrations.
-- Proves the additive foundation neither removes nor alters existing public objects, and that the
-- new schemas stay isolated from anon/authenticated.

begin;
select * from no_plan();

-- ---------- legacy public tables still exist (nothing removed) ----------
select has_table('public','members',         'legacy public.members exists');
select has_table('public','campaigns',       'legacy public.campaigns exists');
select has_table('public','social_accounts', 'legacy public.social_accounts exists');
select has_table('public','social_tokens',   'legacy public.social_tokens exists');
select has_table('public','applications',    'legacy public.applications exists');
select has_table('public','barter_items',    'legacy public.barter_items exists');
select has_table('public','creators',        'legacy public.creators exists');
select has_table('public','invites',         'legacy public.invites exists');
select has_table('public','org_profiles',    'legacy public.org_profiles exists');
select has_table('public','platform_admins', 'legacy public.platform_admins exists');
select has_table('public','audit_log',       'legacy public.audit_log exists');

-- ---------- existing public functions still compile & exist ----------
select has_function('public','my_org',               'my_org() exists');
select has_function('public','my_role',              'my_role() exists');
select has_function('public','handle_new_user',      'handle_new_user() exists');
select has_function('public','apply_to_campaign',    'apply_to_campaign() exists');
select has_function('public','open_campaigns',       'open_campaigns() exists');
select has_function('public','my_applications',      'my_applications() exists');
select has_function('public','campaign_applications','campaign_applications() exists');
select has_function('public','is_platform_admin',    'is_platform_admin() exists');
select has_function('public','public_profile',       'public_profile() exists');
select has_function('public','public_org',           'public_org() exists');
select has_function('public','audit_trigger',        'audit_trigger() exists');

-- ---------- existing public RLS remains enabled ----------
select ok((select relrowsecurity from pg_class where oid='public.members'::regclass),         'RLS on public.members');
select ok((select relrowsecurity from pg_class where oid='public.campaigns'::regclass),       'RLS on public.campaigns');
select ok((select relrowsecurity from pg_class where oid='public.social_accounts'::regclass), 'RLS on public.social_accounts');
select ok((select relrowsecurity from pg_class where oid='public.applications'::regclass),    'RLS on public.applications');
select ok((select count(*) > 0 from pg_policies where schemaname='public' and tablename='members'),   'public.members policies present');
select ok((select count(*) > 0 from pg_policies where schemaname='public' and tablename='campaigns'), 'public.campaigns policies present');

-- ---------- Instagram tables/columns structurally unchanged ----------
select has_column('public','social_accounts','ig_user_id', 'social_accounts.ig_user_id present');
select has_column('public','social_accounts','member_id',  'social_accounts.member_id present');
select col_type_is('public','social_accounts','ig_user_id','text', 'ig_user_id is text');
select col_type_is('public','social_accounts','member_id','uuid',  'member_id is uuid');
select has_column('public','social_tokens','access_token', 'social_tokens.access_token present');

-- ---------- new foundation coexists ----------
select has_schema('intel',   'intel schema present alongside legacy');
select has_schema('private', 'private schema present alongside legacy');
select has_schema('api',     'api schema present alongside legacy');
select has_table('intel','ci_creator_identity', 'intel.ci_creator_identity present');
select has_table('private','creator_contact',   'private.creator_contact present');

-- ---------- no table-name collisions between public and intel/private ----------
select is(
  (select count(*)::int from (
     select tablename from pg_tables where schemaname = 'public'
     intersect
     select tablename from pg_tables where schemaname in ('intel','private')
   ) x), 0, 'no table-name collisions public vs intel/private');

-- ---------- new schemas isolated: anon/authenticated gain nothing ----------
select ok(not has_schema_privilege('anon',          'intel',   'USAGE'), 'anon lacks USAGE on intel');
select ok(not has_schema_privilege('authenticated', 'intel',   'USAGE'), 'authenticated lacks USAGE on intel');
select ok(not has_schema_privilege('anon',          'private', 'USAGE'), 'anon lacks USAGE on private');
select ok(not has_schema_privilege('authenticated', 'private', 'USAGE'), 'authenticated lacks USAGE on private');
select ok(not has_table_privilege('anon',          'intel.ci_creator_identity','SELECT'), 'anon cannot select intel');
select ok(not has_table_privilege('authenticated', 'private.creator_contact','SELECT'),   'authenticated cannot select private');
-- service_role remains the only reachable role for the internal schemas
select ok(has_schema_privilege('service_role','intel','USAGE'),   'service_role retains USAGE on intel');
select ok(has_schema_privilege('service_role','private','USAGE'), 'service_role retains USAGE on private');

-- ---------- existing public access for app roles is retained (grants untouched) ----------
-- The CI migrations contain no statements referencing public objects, so public grants are
-- unchanged by construction. Spot-check a known legacy grant survives:
select ok(has_table_privilege('authenticated','public.members','SELECT'),
  'authenticated retains SELECT on public.members (RLS still scopes rows)');

select * from finish();
rollback;
