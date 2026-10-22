-- Brand CRM: brand records from the campaign form, CRM api, brand login access. Rolls back.
begin;
select * from no_plan();
select ok( not has_table_privilege('authenticated','intel.ci_brand_note','SELECT'), 'brand notes are not readable directly');
select ok( not has_function_privilege('authenticated','api.ops_brand_login_prepare(uuid,text,text,uuid)','EXECUTE'), 'only the brand-login function prepares logins');

-- ===== fixtures: Super Admin (sa), operator (op), creator (c1), an outsider (x) =====
insert into auth.users(instance_id,id,aud,role,email,created_at,updated_at) values
  ('00000000-0000-0000-0000-000000000000','5a000000-0000-0000-0000-0000000000a5','authenticated','authenticated','sa@t.local',now(),now()),
  ('00000000-0000-0000-0000-000000000000','0d000000-0000-0000-0000-00000000000d','authenticated','authenticated','op@t.local',now(),now()),
  ('00000000-0000-0000-0000-000000000000','c1000000-0000-0000-0000-0000000000c1','authenticated','authenticated','c1@t.local',now(),now()),
  ('00000000-0000-0000-0000-000000000000','e5000000-0000-0000-0000-0000000000e5','authenticated','authenticated','x@t.local',now(),now());
insert into public.members(id,role,name) values ('5a000000-0000-0000-0000-0000000000a5','agency','Super'),('0d000000-0000-0000-0000-00000000000d','agency','Op'),
  ('e5000000-0000-0000-0000-0000000000e5','brand','Other') on conflict (id) do nothing;
insert into public.platform_admins(user_id) values ('5a000000-0000-0000-0000-0000000000a5');
insert into intel.ci_agency_operator(member_id,label) values ('0d000000-0000-0000-0000-00000000000d','op');
update intel.ci_feature_flag set enabled=true where flag in ('creator_ig_connect','creator_profile_api','operational_pilot');
create temp table _v(k text primary key, v text);

-- ===== the campaign form: a typed brand becomes a brand record; the same name links to it =====
insert into public.campaigns(id, org_id, name, brand, status) values
  ('aaaa0000-0000-0000-0000-00000000000a', (select org_id from public.members where id='0d000000-0000-0000-0000-00000000000d'), 'Diwali', 'Beardo', 'Live'),
  ('aaaa0000-0000-0000-0000-00000000000b', (select org_id from public.members where id='0d000000-0000-0000-0000-00000000000d'), 'Holi', ' beardo ', 'Draft');
select is( (select count(distinct brand_id)::int from public.campaigns where id::text like 'aaaa%'), 1, 'one brand record for both campaigns');
select is( (select count(*)::int from intel.ci_brand where lower(name) = 'beardo'), 1, 'created once');
insert into _v values('br', (select brand_id::text from public.campaigns where id='aaaa0000-0000-0000-0000-00000000000a'));
select is( (select brand from public.campaigns where id='aaaa0000-0000-0000-0000-00000000000b'), 'Beardo', 'picking the brand by id keeps its name');

-- ===== CRM =====
set local request.jwt.claims = '{"sub":"5a000000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select ok( (select count(*) from jsonb_array_elements(api.brand_list()) e where e->>'name' = 'Beardo') = 1, 'the Super Admin sees the brand');
select is( (select (e->>'campaigns')::int from jsonb_array_elements(api.brand_list()) e where e->>'name' = 'Beardo'), 2, 'with its campaigns');
select throws_ok( $$ select api.brand_save('{"name":"beardo"}'::jsonb) $$, '23505', null, 'no duplicate brand');
select ok( (api.brand_save('{"name":"Vaaree","category":"Home","instagram":"https://www.instagram.com/vaaree/","contact_name":"Neha","contact_email":"neha@vaaree.com"}'::jsonb)->>'created')::boolean, 'add a brand with a contact');
select is( (select instagram from intel.ci_brand where name = 'Vaaree'), 'vaaree', 'instagram stored as a handle');
select ok( api.brand_note_add((select v::uuid from _v where k='br'), 'call', 'Spoke to marketing — 2 more campaigns in Nov') is not null, 'log a call');
select is( jsonb_array_length(api.brand_detail((select v::uuid from _v where k='br'))->'campaigns'), 2, 'brand page lists its campaigns');
select is( jsonb_array_length(api.brand_detail((select v::uuid from _v where k='br'))->'notes'), 1, 'and its notes');
set local request.jwt.claims = '{"sub":"e5000000-0000-0000-0000-0000000000e5","role":"authenticated"}';
select throws_ok( format($$ select api.brand_detail(%L::uuid) $$, (select v from _v where k='br')), '42501', null, 'another workspace cannot open it');
select is( (select count(*)::int from jsonb_array_elements(api.brand_list()) e where e->>'name' = 'Beardo'), 0, 'or list it');

-- ===== brand login: the brand's own team runs its campaigns =====
set local request.jwt.claims = '';
select ok( (api.ops_brand_login_prepare((select v::uuid from _v where k='br'), 'team@beardo.in', 'Beardo Team', '5a000000-0000-0000-0000-0000000000a5')->>'token') is not null, 'login prepared');
insert into auth.users(instance_id,id,aud,role,email,raw_user_meta_data,created_at,updated_at) values
  ('00000000-0000-0000-0000-000000000000','b7000000-0000-0000-0000-0000000000b7','authenticated','authenticated','team@beardo.in',
   jsonb_build_object('invite_token', (select token::text from public.invites where email='team@beardo.in'), 'full_name','Beardo Team'), now(), now());
select is( (select role||'/'||status from public.members where id='b7000000-0000-0000-0000-0000000000b7'), 'brand/active', 'the account lands as an active brand login');
select is( (select org_id from public.members where id='b7000000-0000-0000-0000-0000000000b7'), (select org_id from intel.ci_brand where brand_id=(select v::uuid from _v where k='br')), 'in the brand''s own workspace');
select ok( api.ops_brand_login_member((select v::uuid from _v where k='br'), 'b7000000-0000-0000-0000-0000000000b7'), 'recognised as that brand''s login');
set local request.jwt.claims = '{"sub":"b7000000-0000-0000-0000-0000000000b7","role":"authenticated"}';
select ok( intel.ci_can_manage_campaign((select campaign_id from intel.ci_campaign where legacy_campaign_id='aaaa0000-0000-0000-0000-00000000000a')) is not false, 'the brand login can run its campaign (when it is in the pipeline)');
select is( (select count(*)::int from jsonb_array_elements(api.brand_list()) e where e->>'name' = 'Beardo'), 1, 'and sees its own brand');
select is( (select count(*)::int from jsonb_array_elements(api.brand_list()) e where e->>'name' = 'Vaaree'), 0, 'but not other brands');

select * from finish();
rollback;
