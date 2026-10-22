-- Discovery: profile filters, identity_id on rows, filter options, creator activity (Super Admin only). Rolls back.
begin;
select * from no_plan();

select ok( not has_function_privilege('anon','api.creator_activity(uuid,int)','EXECUTE'), 'anon cannot read activity');
select ok( not has_function_privilege('anon','api.creator_search_options()','EXECUTE'), 'anon cannot read filter options');

insert into auth.users(instance_id,id,aud,role,email,created_at,updated_at) values
  ('00000000-0000-0000-0000-000000000000','5a000000-0000-0000-0000-0000000000a5','authenticated','authenticated','sa@t.local',now(),now()),
  ('00000000-0000-0000-0000-000000000000','b0000000-0000-0000-0000-0000000000b0','authenticated','authenticated','br@t.local',now(),now()),
  ('00000000-0000-0000-0000-000000000000','c1000000-0000-0000-0000-0000000000c1','authenticated','authenticated','c1@t.local',now(),now()),
  ('00000000-0000-0000-0000-000000000000','c2000000-0000-0000-0000-0000000000c2','authenticated','authenticated','c2@t.local',now(),now());
insert into public.members(id,role,name) values ('5a000000-0000-0000-0000-0000000000a5','owner','Super'),('b0000000-0000-0000-0000-0000000000b0','brand','Brand'),
  ('c1000000-0000-0000-0000-0000000000c1','creator','Pet Parent'),('c2000000-0000-0000-0000-0000000000c2','creator','No Pet') on conflict (id) do nothing;
set local session_replication_role = replica;
update public.members set role = 'creator' where id in ('c1000000-0000-0000-0000-0000000000c1','c2000000-0000-0000-0000-0000000000c2');
set local session_replication_role = origin;
insert into public.platform_admins(user_id) values ('5a000000-0000-0000-0000-0000000000a5');
update intel.ci_feature_flag set enabled=true where flag in ('creator_ig_connect','creator_profile_api','operational_pilot');
create temp table _v(k text primary key, v text);
set local request.jwt.claims = '{"sub":"c1000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select api.bootstrap_my_profile();
set local request.jwt.claims = '{"sub":"c2000000-0000-0000-0000-0000000000c2","role":"authenticated"}';
select api.bootstrap_my_profile();
set local request.jwt.claims = '';
insert into _v select 'id1', a.identity_id::text from intel.ci_identity_actor_access a where a.member_id='c1000000-0000-0000-0000-0000000000c1' and a.access_role='self' limit 1;
insert into _v select 'id2', a.identity_id::text from intel.ci_identity_actor_access a where a.member_id='c2000000-0000-0000-0000-0000000000c2' and a.access_role='self' limit 1;
insert into public.social_accounts(org_id, member_id, platform, username, followers_count, ig_user_id)
values (gen_random_uuid(),'c1000000-0000-0000-0000-0000000000c1','instagram','petparent.blr',12000,'9001'),(gen_random_uuid(),'c2000000-0000-0000-0000-0000000000c2','instagram','nopet.del',30000,'9002');
insert into private.creator_personal_profile(identity_id, first_name, has_pet, date_of_birth)
values ((select v::uuid from _v where k='id1'),'Pet',true, current_date - interval '25 years'),((select v::uuid from _v where k='id2'),'No',false, current_date - interval '40 years')
on conflict (identity_id) do update set has_pet = excluded.has_pet, date_of_birth = excluded.date_of_birth;
insert into intel.ci_creator_commercial_preference(identity_id, accepts_barter) values ((select v::uuid from _v where k='id1'), true)
on conflict (identity_id) do update set accepts_barter = true;
insert into intel.ci_creator_professional_profile(identity_id, languages, content_formats, state_coarse) values ((select v::uuid from _v where k='id1'), '{Kannada,English}', '{reels}', 'Karnataka')
on conflict (identity_id) do update set languages = excluded.languages, content_formats = excluded.content_formats, state_coarse = excluded.state_coarse;
insert into public.activity_log(member_id, kind, event, page, session_id, city, country, duration_ms)
values ('c1000000-0000-0000-0000-0000000000c1','security','session_start',null,'s1','Bengaluru','IN',0),
       ('c1000000-0000-0000-0000-0000000000c1','analytics','page_view','mycampaigns','s1','Bengaluru','IN',0),
       ('c1000000-0000-0000-0000-0000000000c1','analytics','time','mycampaigns','s1','Bengaluru','IN',120000);

set local request.jwt.claims = '{"sub":"5a000000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select is( (select count(*)::int from jsonb_array_elements(api.creator_search('{"source":"platform","pet":"yes"}'::jsonb)->'rows') r where r->>'handle' like '%.blr' or r->>'handle' like '%.del'), 1, 'pet filter: only the pet parent');
select is( (select r->>'handle' from jsonb_array_elements(api.creator_search('{"source":"platform","barter":"yes","language":"kannada"}'::jsonb)->'rows') r where r->>'handle' like '%.blr'), 'petparent.blr', 'barter + language');
select is( (select count(*)::int from jsonb_array_elements(api.creator_search('{"source":"platform","min_age":35}'::jsonb)->'rows') r where r->>'handle' = 'petparent.blr'), 0, 'age range');
select is( (select count(*)::int from jsonb_array_elements(api.creator_search('{"source":"platform","active_days":7}'::jsonb)->'rows') r where r->>'handle' in ('petparent.blr','nopet.del')), 1, 'active in the last 7 days');
select is( (select count(*)::int from jsonb_array_elements(api.creator_search('{"source":"platform","state":"karnataka","content_format":"reel"}'::jsonb)->'rows') r where r->>'handle' = 'petparent.blr'), 1, 'state + content format');
select is( (select r->>'identity_id' from jsonb_array_elements(api.creator_search('{"source":"platform","q":"petparent"}'::jsonb)->'rows') r limit 1), (select v from _v where k='id1'), 'row carries identity_id for the intelligence card');
select ok( (select r->>'last_seen' from jsonb_array_elements(api.creator_search('{"source":"platform","q":"petparent"}'::jsonb)->'rows') r limit 1) is not null, 'and last seen');
select ok( api.creator_search_options()->'languages' ? 'Kannada', 'language options come from real profiles');
select is( (api.creator_activity('c1000000-0000-0000-0000-0000000000c1')->>'minutes')::numeric, 2.0, 'activity: time spent');
select is( (api.creator_activity('c1000000-0000-0000-0000-0000000000c1')->'pages'->0->>'page'), 'mycampaigns', 'activity: pages visited');
select is( jsonb_array_length(api.creator_activity('c1000000-0000-0000-0000-0000000000c1')->'events'), 3, 'activity: timeline');

set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-0000000000b0","role":"authenticated"}';
select throws_ok( $$ select api.creator_activity('c1000000-0000-0000-0000-0000000000c1') $$, '42501', null, 'a brand cannot read creator activity');

select * from finish();
rollback;
