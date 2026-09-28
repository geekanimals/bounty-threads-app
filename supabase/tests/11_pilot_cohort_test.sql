-- Phase 1D pilot — SERVER-ENFORCED cohort authorization tests. Proves the restricted pilot is gated at the
-- database (function) layer, not by client nav: with enforcement on, a non-allowlisted creator/brand is denied
-- at the api regardless of the client. Default (enforcement off) behaviour is unchanged. Rolls back.
begin;
select * from no_plan();

-- ---- the allowlist is service-role only (never client-readable) ----
select ok( not has_table_privilege('anon','intel.ci_pilot_cohort','SELECT'), 'anon cannot read the pilot cohort');
select ok( not has_table_privilege('authenticated','intel.ci_pilot_cohort','SELECT'), 'authenticated cannot read the pilot cohort');
select ok( not has_table_privilege('authenticated','intel.ci_pilot_cohort','INSERT'), 'authenticated cannot modify the pilot cohort');
select ok( has_function_privilege('service_role','intel.ci_in_pilot_cohort()','EXECUTE'), 'service_role may evaluate cohort membership');

-- ---- fixtures: a bootstrapped creator (self) + a brand user with an org ----
insert into auth.users(instance_id,id,aud,role,email,created_at,updated_at) values
  ('00000000-0000-0000-0000-000000000000','c1000000-0000-0000-0000-0000000000c1','authenticated','authenticated','pc@t.local',now(),now()),
  ('00000000-0000-0000-0000-000000000000','b3000000-0000-0000-0000-0000000000b3','authenticated','authenticated','pb@t.local',now(),now());
create table if not exists public.members(id uuid primary key, org_id uuid not null default gen_random_uuid(), role text, name text);
insert into public.members(id,role,name) values ('b3000000-0000-0000-0000-0000000000b3','brand','Pilot Brand') on conflict (id) do nothing;
create temp table _v(k text primary key, v text);
insert into _v values('ob',(select org_id::text from public.members where id='b3000000-0000-0000-0000-0000000000b3'));
update intel.ci_feature_flag set enabled=true where flag in ('creator_ig_connect','creator_profile_api');

set local request.jwt.claims = '{"sub":"c1000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select api.bootstrap_my_profile();
set local request.jwt.claims = '';

-- ================= DEFAULT: enforcement OFF => unrestricted (behaviour unchanged) =================
select is( (select enabled from intel.ci_feature_flag where flag='pilot_cohort_enforced'), false, 'cohort enforcement ships OFF by default');
set local request.jwt.claims = '{"sub":"c1000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select lives_ok( $$ select api.get_my_creator_intelligence() $$, 'enforcement off: allowlist is not applied (creator served as before)');

-- ================= ENFORCED + empty cohort => CLOSED for everyone (server-side) =================
update intel.ci_feature_flag set enabled=true where flag='pilot_cohort_enforced';
set local request.jwt.claims = '{"sub":"c1000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select throws_ok( $$ select api.get_my_creator_intelligence() $$, '42501', 'not in pilot cohort',
                  'enforced + not listed: creator intelligence is denied at the API');
select throws_ok( $$ select api.ig_connect_start() $$, '42501', 'not in pilot cohort',
                  'enforced + not listed: even Instagram connect is denied at the API (server-enforced entry)');

-- ================= add the named creator => allowed again =================
set local request.jwt.claims = '';
insert into intel.ci_pilot_cohort(subject_kind, member_id, label) values ('creator','c1000000-0000-0000-0000-0000000000c1','internal pilot creator');
set local request.jwt.claims = '{"sub":"c1000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select lives_ok( $$ select api.get_my_creator_intelligence() $$, 'allowlisted creator is served again');

-- ================= brand: denied until its org is allowlisted =================
set local request.jwt.claims = '{"sub":"b3000000-0000-0000-0000-0000000000b3","role":"authenticated"}';
select throws_ok( $$ select api.match_creators('{"category":["fitness"]}'::jsonb) $$, '42501', 'not in pilot cohort',
                  'enforced + brand not listed: brand matching is denied at the API');
set local request.jwt.claims = '';
insert into intel.ci_pilot_cohort(subject_kind, org_id, label)
  select 'brand', (select v::uuid from _v where k='ob'), 'internal pilot brand';
set local request.jwt.claims = '{"sub":"b3000000-0000-0000-0000-0000000000b3","role":"authenticated"}';
select lives_ok( $$ select api.match_creators('{"category":["fitness"]}'::jsonb) $$, 'allowlisted brand may run matching');

-- ================= an inactive cohort row does not grant access =================
set local request.jwt.claims = '';
update intel.ci_pilot_cohort set active=false where subject_kind='creator' and member_id='c1000000-0000-0000-0000-0000000000c1';
set local request.jwt.claims = '{"sub":"c1000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select throws_ok( $$ select api.get_my_creator_intelligence() $$, '42501', 'not in pilot cohort',
                  'deactivating a cohort row immediately revokes access');

-- ================= MASTER SHUTOFF still wins over cohort membership =================
set local request.jwt.claims = '';
update intel.ci_pilot_cohort set active=true where subject_kind='creator' and member_id='c1000000-0000-0000-0000-0000000000c1';
update intel.ci_feature_flag set enabled=false where flag='creator_profile_api';   -- master switch off
set local request.jwt.claims = '{"sub":"c1000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select throws_ok( $$ select api.get_my_creator_intelligence() $$, '0A000', null,
                  'master api flag off disables the surface even for an allowlisted creator (immediate shutoff)');

select * from finish();
rollback;
