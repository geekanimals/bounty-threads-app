-- Creator traits report: campaign scope, completed-only, invited creators, access. Rolls back.
begin;
select * from no_plan();
select ok( not has_function_privilege('anon','api.creator_trait_rows(uuid,uuid,text)','EXECUTE'), 'anon cannot run the report');
insert into auth.users(instance_id,id,aud,role,email,created_at,updated_at) values
  ('00000000-0000-0000-0000-000000000000','0d000000-0000-0000-0000-00000000000d','authenticated','authenticated','op@t.local',now(),now()),
  ('00000000-0000-0000-0000-000000000000','e5000000-0000-0000-0000-0000000000e5','authenticated','authenticated','x@t.local',now(),now()),
  ('00000000-0000-0000-0000-000000000000','c1000000-0000-0000-0000-0000000000c1','authenticated','authenticated','c1@t.local',now(),now()),
  ('00000000-0000-0000-0000-000000000000','c2000000-0000-0000-0000-0000000000c2','authenticated','authenticated','c2@t.local',now(),now());
insert into public.members(id,role,name) values ('0d000000-0000-0000-0000-00000000000d','agency','Op'),('e5000000-0000-0000-0000-0000000000e5','brand','Other'),
  ('c1000000-0000-0000-0000-0000000000c1','creator','Food Mom'),('c2000000-0000-0000-0000-0000000000c2','creator','Tech Guy') on conflict (id) do nothing;
set local session_replication_role = replica;
update public.members set role = 'creator' where id in ('c1000000-0000-0000-0000-0000000000c1','c2000000-0000-0000-0000-0000000000c2');
set local session_replication_role = origin;
insert into intel.ci_agency_operator(member_id,label) values ('0d000000-0000-0000-0000-00000000000d','op');
update intel.ci_feature_flag set enabled=true where flag in ('creator_ig_connect','creator_profile_api','operational_pilot');
create temp table _v(k text primary key, v text);
set local request.jwt.claims = '{"sub":"c1000000-0000-0000-0000-0000000000c1","role":"authenticated"}'; select api.bootstrap_my_profile();
set local request.jwt.claims = '{"sub":"c2000000-0000-0000-0000-0000000000c2","role":"authenticated"}'; select api.bootstrap_my_profile();
set local request.jwt.claims = '';
insert into _v select 'id1', identity_id::text from intel.ci_identity_actor_access where member_id='c1000000-0000-0000-0000-0000000000c1' and access_role='self' limit 1;
insert into _v select 'id2', identity_id::text from intel.ci_identity_actor_access where member_id='c2000000-0000-0000-0000-0000000000c2' and access_role='self' limit 1;
insert into intel.ci_creator_professional_profile(identity_id, categories) values ((select v::uuid from _v where k='id1'), '{Food,Parenting}'),((select v::uuid from _v where k='id2'), '{Tech}')
on conflict (identity_id) do update set categories = excluded.categories;
insert into intel.ci_brand(brand_id,name) values ('bbbb0000-0000-0000-0000-00000000bbbb','Snuggles') on conflict do nothing;
set local request.jwt.claims = '{"sub":"0d000000-0000-0000-0000-00000000000d","role":"authenticated"}';
insert into _v values('camp',(api.create_campaign('{"brand_id":"bbbb0000-0000-0000-0000-00000000bbbb","name":"Snuggles launch","product":"pet bed","comp_type":"barter"}'::jsonb)->>'campaign_id'));
set local request.jwt.claims = '';
insert into intel.ci_campaign_participation(campaign_id, identity_id, stage) values
  ((select v::uuid from _v where k='camp'), (select v::uuid from _v where k='id1'), 'completed'),
  ((select v::uuid from _v where k='camp'), (select v::uuid from _v where k='id2'), 'product_sent');
insert into intel.ci_campaign_invite(campaign_id, source, handle, full_name, followers, city) values ((select v::uuid from _v where k='camp'),'bulk','sheet.star','Sheet Star',22000,'Pune');

set local request.jwt.claims = '{"sub":"0d000000-0000-0000-0000-00000000000d","role":"authenticated"}';
select is( jsonb_array_length(api.creator_trait_rows((select v::uuid from _v where k='camp'))->'rows'), 3, 'campaign: 2 Geek OS creators + 1 uploaded');
select is( (select r->>'stage' from jsonb_array_elements(api.creator_trait_rows((select v::uuid from _v where k='camp'))->'rows') r where r->>'member_id' = 'c1000000-0000-0000-0000-0000000000c1'), 'completed', 'their stage');
select ok( (select r->'categories' ? 'parenting' from jsonb_array_elements(api.creator_trait_rows((select v::uuid from _v where k='camp'))->'rows') r where r->>'member_id' = 'c1000000-0000-0000-0000-0000000000c1'), 'their categories');
select is( (select (r->>'parent')::boolean from jsonb_array_elements(api.creator_trait_rows((select v::uuid from _v where k='camp'))->'rows') r where r->>'member_id' = 'c1000000-0000-0000-0000-0000000000c1'), true, 'parent from category');
select is( jsonb_array_length(api.creator_trait_rows((select v::uuid from _v where k='camp'), null, 'completed')->'rows'), 1, 'completed only');
select is( jsonb_array_length(api.creator_trait_rows(null, 'bbbb0000-0000-0000-0000-00000000bbbb')->'rows'), 2, 'brand scope');
select is( (select r->>'kind' from jsonb_array_elements(api.creator_trait_rows((select v::uuid from _v where k='camp'))->'rows') r where r->>'handle' = 'sheet.star'), 'invite', 'uploaded creator from the sheet');
set local request.jwt.claims = '{"sub":"e5000000-0000-0000-0000-0000000000e5","role":"authenticated"}';
select throws_ok( format($$ select api.creator_trait_rows(%L::uuid) $$, (select v from _v where k='camp')), '42501', null, 'another brand cannot read it');
select is( jsonb_array_length(api.creator_trait_rows()->'rows'), 0, 'no scope: only creators of campaigns you run');
select * from finish();
rollback;
