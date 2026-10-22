-- Super Admin: creator facts for filters + delete a user completely (and sign up again). Rolls back.
begin;
select * from no_plan();
select ok( not has_function_privilege('anon','public.admin_delete_user(uuid,text)','EXECUTE'), 'anon cannot delete users');

insert into auth.users(instance_id,id,aud,role,email,created_at,updated_at) values
  ('00000000-0000-0000-0000-000000000000','5a000000-0000-0000-0000-0000000000a5','authenticated','authenticated','sa@t.local',now(),now()),
  ('00000000-0000-0000-0000-000000000000','5b000000-0000-0000-0000-0000000000b5','authenticated','authenticated','sa2@t.local',now(),now()),
  ('00000000-0000-0000-0000-000000000000','c1000000-0000-0000-0000-0000000000c1','authenticated','authenticated','mom@t.local',now(),now());
insert into public.members(id,role,name) values ('5a000000-0000-0000-0000-0000000000a5','owner','Super'),('5b000000-0000-0000-0000-0000000000b5','owner','Super 2'),
  ('c1000000-0000-0000-0000-0000000000c1','creator','Mom Creator') on conflict (id) do nothing;
set local session_replication_role = replica;
update public.members set role = 'creator' where id = 'c1000000-0000-0000-0000-0000000000c1';
set local session_replication_role = origin;
insert into public.platform_admins(user_id) values ('5a000000-0000-0000-0000-0000000000a5'),('5b000000-0000-0000-0000-0000000000b5');
update intel.ci_feature_flag set enabled=true where flag in ('creator_ig_connect','creator_profile_api','operational_pilot');
create temp table _v(k text primary key, v text);
set local request.jwt.claims = '{"sub":"c1000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select api.bootstrap_my_profile();
set local request.jwt.claims = '';
insert into _v select 'id1', a.identity_id::text from intel.ci_identity_actor_access a where a.member_id='c1000000-0000-0000-0000-0000000000c1' and a.access_role='self' limit 1;
insert into public.social_accounts(org_id, member_id, platform, username, followers_count, ig_user_id, biography)
values (gen_random_uuid(),'c1000000-0000-0000-0000-0000000000c1','instagram','mom.of.two',15000,'9100','Mom of two 👶 | Pune');
insert into private.creator_personal_profile(identity_id, first_name, gender, has_pet, pet_type) values ((select v::uuid from _v where k='id1'),'Mom','female',true,'dog')
on conflict (identity_id) do update set has_pet = true, pet_type = 'dog', gender = 'female';
insert into private.creator_address(identity_id,line1,city,state,postal_code,country,label,is_default) values ((select v::uuid from _v where k='id1'),'A-1','Pune','Maharashtra','411001','India','Home',true);
insert into intel.ci_brand(brand_id,name) values ('bbbb0000-0000-0000-0000-00000000bbbb','Snuggles') on conflict do nothing;
set local request.jwt.claims = '{"sub":"5a000000-0000-0000-0000-0000000000a5","role":"authenticated"}';
insert into _v values('camp',(api.create_campaign('{"brand_id":"bbbb0000-0000-0000-0000-00000000bbbb","name":"Snuggles launch","product":"pet bed","comp_type":"barter"}'::jsonb)->>'campaign_id'));
set local request.jwt.claims = '';
insert into intel.ci_campaign_participation(campaign_id, identity_id, stage) values ((select v::uuid from _v where k='camp'), (select v::uuid from _v where k='id1'), 'applied');
insert into intel.ci_campaign_invite(campaign_id, source, handle, phone_e164, claimed_by, claimed_at) values ((select v::uuid from _v where k='camp'),'bulk','mom.of.two','+919800000777','c1000000-0000-0000-0000-0000000000c1', now());

insert into intel.ci_campaign_event(campaign_id, entity, from_status, to_status, reason, actor_member_id)
values ((select v::uuid from _v where k='camp'), 'campaign', null, 'draft', 'test', 'c1000000-0000-0000-0000-0000000000c1');
-- facts
set local request.jwt.claims = '{"sub":"5a000000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select is( (public.admin_creator_facts()->'c1000000-0000-0000-0000-0000000000c1'->>'parent')::boolean, true, 'a mom in her bio is found as a parent');
select is( (public.admin_creator_facts()->'c1000000-0000-0000-0000-0000000000c1'->>'has_pet')::boolean, true, 'pet parent');
select ok( public.admin_creator_facts()->'c1000000-0000-0000-0000-0000000000c1'->'pet_types' ? 'dog', 'pet type');

-- delete guards
select throws_ok( $$ select public.admin_delete_user('c1000000-0000-0000-0000-0000000000c1', 'yes') $$, '22023', null, 'needs DELETE typed');
select throws_ok( $$ select public.admin_delete_user('5a000000-0000-0000-0000-0000000000a5', 'DELETE') $$, '42501', null, 'cannot delete yourself');
select throws_ok( $$ select public.admin_delete_user('5b000000-0000-0000-0000-0000000000b5', 'DELETE') $$, '42501', null, 'cannot delete another Super Admin');
set local request.jwt.claims = '{"sub":"c1000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select throws_ok( $$ select public.admin_delete_user('5b000000-0000-0000-0000-0000000000b5', 'DELETE') $$, '42501', null, 'a creator cannot delete anyone');

-- delete
set local request.jwt.claims = '{"sub":"5a000000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select is( (public.admin_delete_user('c1000000-0000-0000-0000-0000000000c1', 'DELETE')->>'campaigns_removed_from')::int, 1, 'deleted, with their campaign');
set local request.jwt.claims = '';
select is( (select count(*)::int from auth.users where id = 'c1000000-0000-0000-0000-0000000000c1'), 0, 'login gone');
select is( (select count(*)::int from public.members where id = 'c1000000-0000-0000-0000-0000000000c1'), 0, 'member gone');
select is( (select count(*)::int from intel.ci_creator_identity where identity_id = (select v::uuid from _v where k='id1')), 0, 'creator profile gone');
select is( (select count(*)::int from private.creator_address where identity_id = (select v::uuid from _v where k='id1')), 0, 'addresses gone');
select is( (select count(*)::int from intel.ci_campaign_participation where identity_id = (select v::uuid from _v where k='id1')), 0, 'campaign history gone');
select is( (select count(*)::int from public.social_accounts where username = 'mom.of.two'), 0, 'Instagram link gone');
select is( (select claimed_by from intel.ci_campaign_invite where handle = 'mom.of.two'), null, 'invite released');
select is( (select count(*)::int from intel.ci_campaign where campaign_id = (select v::uuid from _v where k='camp')), 1, 'the campaign stays');
select is( (select count(*)::int from public.audit_log where action = 'DELETE_USER' and row_id = 'c1000000-0000-0000-0000-0000000000c1'), 1, 'recorded in the audit log');

-- signs up again with the same email + Instagram
insert into auth.users(instance_id,id,aud,role,email,created_at,updated_at) values
  ('00000000-0000-0000-0000-000000000000','c3000000-0000-0000-0000-0000000000c3','authenticated','authenticated','mom@t.local',now(),now());
insert into public.members(id,role,name) values ('c3000000-0000-0000-0000-0000000000c3','creator','Mom again') on conflict (id) do nothing;
set local request.jwt.claims = '{"sub":"c3000000-0000-0000-0000-0000000000c3","role":"authenticated"}';
select is( (api.bootstrap_my_profile()->>'created')::boolean, true, 'same person signs up again fresh');
set local request.jwt.claims = '';
insert into public.social_accounts(org_id, member_id, platform, username, followers_count, ig_user_id)
values (gen_random_uuid(),'c3000000-0000-0000-0000-0000000000c3','instagram','mom.of.two',15000,'9100');
select is( (select count(*)::int from public.social_accounts where username = 'mom.of.two'), 1, 'and connects the same Instagram');

select * from finish();
rollback;
