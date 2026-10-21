-- Command center: to-do list, remove from campaign, invite messages, story screenshots + typed numbers. Rolls back.
begin;
select * from no_plan();

-- ===== privileges =====
select ok( not has_function_privilege('anon','api.admin_todo(uuid)','EXECUTE'), 'anon cannot read the to-do list');
select ok( not has_function_privilege('anon','api.admin_remove_from_campaign(uuid,uuid)','EXECUTE'), 'anon cannot delete');
select ok( not has_table_privilege('authenticated','intel.ci_invite_post','SELECT'), 'invite posts are not readable directly');

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
set local request.jwt.claims = '{"sub":"c1000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select api.bootstrap_my_profile();
set local request.jwt.claims = '';
insert into _v values('id1',(select a.identity_id::text from intel.ci_identity_actor_access a where a.member_id='c1000000-0000-0000-0000-0000000000c1' and a.access_role='self' limit 1));
insert into intel.ci_brand(brand_id,name) values ('bbbb0000-0000-0000-0000-00000000bbbb','Snuggles') on conflict do nothing;
set local request.jwt.claims = '{"sub":"0d000000-0000-0000-0000-00000000000d","role":"authenticated"}';
insert into _v values('camp',(api.create_campaign('{"brand_id":"bbbb0000-0000-0000-0000-00000000bbbb","name":"Snuggles launch","product":"pet bed","comp_type":"barter"}'::jsonb)->>'campaign_id'));
set local request.jwt.claims = '';
insert into intel.ci_campaign_participation(campaign_id, identity_id, stage, applied_profile)
values ((select v::uuid from _v where k='camp'), (select v::uuid from _v where k='id1'), 'applied', 'c1handle');
insert into _v values('part',(select participation_id::text from intel.ci_campaign_participation where campaign_id=(select v::uuid from _v where k='camp')));
insert into intel.ci_campaign_event(campaign_id, participation_id, entity, from_status, to_status, reason)
values ((select v::uuid from _v where k='camp'), (select v::uuid from _v where k='part'), 'participation', null, 'applied', 'test');

-- ===== to do =====
set local request.jwt.claims = '{"sub":"0d000000-0000-0000-0000-00000000000d","role":"authenticated"}';
select is( (select it->>'kind' from jsonb_array_elements(api.admin_todo()->'items') it where it->>'participation_id' = (select v from _v where k='part')), 'screen',
  'a creator who applied is on the to-do list: screen them');
select is( (api.admin_todo((select v::uuid from _v where k='camp'))->>'total')::int >= 1, true, 'filtered to the campaign');
select is( jsonb_array_length(api.admin_todo('11111111-1111-1111-1111-111111111111')->'items'), 0, 'another campaign: nothing');
set local request.jwt.claims = '';
update intel.ci_campaign_participation set stage = 'content_submitted' where participation_id = (select v::uuid from _v where k='part');
set local request.jwt.claims = '{"sub":"0d000000-0000-0000-0000-00000000000d","role":"authenticated"}';
select is( (select it->>'kind' from jsonb_array_elements(api.admin_todo()->'items') it where it->>'participation_id' = (select v from _v where k='part')), 'review',
  'a submitted video: review it');
set local request.jwt.claims = '{"sub":"e5000000-0000-0000-0000-0000000000e5","role":"authenticated"}';
select is( (select count(*)::int from jsonb_array_elements(api.admin_todo()->'items') it where it->>'participation_id' = (select v from _v where k='part')), 0,
  'someone from another brand never sees it');

-- ===== story screenshot + typed numbers =====
set local request.jwt.claims = '';
update intel.ci_campaign_participation set stage = 'content_approved' where participation_id = (select v::uuid from _v where k='part');
set local request.jwt.claims = '{"sub":"0d000000-0000-0000-0000-00000000000d","role":"authenticated"}';
select throws_ok( format($$ select api.bp_add_post_link(%L::uuid, '{"media_type":"reel"}'::jsonb) $$, (select v from _v where k='part')), '22023', null, 'a reel needs its link');
select is( (api.bp_add_post_link((select v::uuid from _v where k='part'),
             '{"media_type":"story","screenshot_url":"https://x.supabase.co/storage/v1/object/public/campaign-files/o/s.png","metrics":{"views":"1520","reach":"1300","replies":"4","junk":"x","likes":"-3"}}'::jsonb)->>'numbers'), 'true',
  'a story goes in with only its screenshot + the numbers read from it');
select is( (select (s->>'views')::int from intel.ci_campaign_post po, intel.ci_post_stats(po.post_id) s where po.participation_id = (select v::uuid from _v where k='part')), 1520, 'views saved');
select is( (select s->>'source' from intel.ci_campaign_post po, intel.ci_post_stats(po.post_id) s where po.participation_id = (select v::uuid from _v where k='part')), 'screenshot', 'marked as from a screenshot');
select is( (select s->>'likes' from intel.ci_campaign_post po, intel.ci_post_stats(po.post_id) s where po.participation_id = (select v::uuid from _v where k='part')), null, 'bad numbers are dropped');
select is( (select stage from intel.ci_campaign_participation where participation_id = (select v::uuid from _v where k='part')), 'published', 'creator moves to Posted');
select is( (api.bp_add_post_link((select v::uuid from _v where k='part'), '{"permalink":"https://www.instagram.com/c1handle/reel/ABC123/","metrics":{"likes":"90"}}'::jsonb)->>'numbers'), 'true',
  'a reel link with the handle in it is accepted, with typed numbers');
select throws_ok( format($$ select api.bp_record_metrics(%L::uuid, '{"junk":1}'::jsonb) $$, (select v from _v where k='part')), '22023', null, 'numbers form needs a number');

-- ===== invited creator: messages, screenshot numbers, report, move on join =====
set local request.jwt.claims = '';
insert into intel.ci_campaign_invite(campaign_id, source, handle, full_name, phone_e164, email)
values ((select v::uuid from _v where k='camp'), 'bulk', 'bulkstar', 'Bulk Star', '+919812300000', 'b@t.local');
insert into _v values('inv',(select invite_id::text from intel.ci_campaign_invite where handle='bulkstar'));
insert into intel.ci_outbox(channel, to_address, campaign_id, template_key, payload, dedupe_key)
values ('whatsapp', '+919812300000', (select v::uuid from _v where k='camp'), 'bulk_invite', '{"text":"Hi Bulk, join Snuggles"}', 't:1'),
       ('email', 'b@t.local', (select v::uuid from _v where k='camp'), 'bulk_invite', '{"subject":"Join Snuggles"}', 't:2'),
       ('whatsapp', '+919800000999', (select v::uuid from _v where k='camp'), 'bulk_invite', '{"text":"someone else"}', 't:3');
set local request.jwt.claims = '{"sub":"0d000000-0000-0000-0000-00000000000d","role":"authenticated"}';
select is( jsonb_array_length(api.invite_messages((select v::uuid from _v where k='inv'))->'messages'), 2, 'the invite shows the WhatsApp + email sent to them (not others)');
set local request.jwt.claims = '{"sub":"e5000000-0000-0000-0000-0000000000e5","role":"authenticated"}';
select throws_ok( format($$ select api.invite_messages(%L::uuid) $$, (select v from _v where k='inv')), '42501', null, 'outsiders cannot read them');
set local request.jwt.claims = '{"sub":"0d000000-0000-0000-0000-00000000000d","role":"authenticated"}';
select ok( (api.invite_add_post((select v::uuid from _v where k='inv'), '{"media_type":"story","screenshot_url":"https://x.co/a.png","metrics":{"views":"800"}}'::jsonb)->>'id') is not null, 'story screenshot on an invited creator');
select is( (select (e->'totals'->>'views')::int from jsonb_array_elements(api.campaign_analytics((select v::uuid from _v where k='camp'))->'creators') e where e->>'invite_id' = (select v from _v where k='inv')), 800,
  'the report shows the invited creator''s screenshot numbers');

-- ===== full creator card =====
set local request.jwt.claims = '';
insert into private.creator_address(identity_id,line1,line2,landmark,city,state,postal_code,country,label,is_default)
values ((select v::uuid from _v where k='id1'),'B-2','MG Road','Near the mall','Siliguri','West Bengal','734001','India','Home',true);
set local request.jwt.claims = '{"sub":"0d000000-0000-0000-0000-00000000000d","role":"authenticated"}';
select is( api.admin_creator_full((select v::uuid from _v where k='part'))->'addresses'->0->>'city', 'Siliguri', 'the team sees the creator''s delivery addresses');
select is( jsonb_array_length(api.admin_creator_full((select v::uuid from _v where k='part'))->'campaigns'), 1, 'and their campaigns');
set local request.jwt.claims = '{"sub":"e5000000-0000-0000-0000-0000000000e5","role":"authenticated"}';
select throws_ok( format($$ select api.admin_creator_full(%L::uuid) $$, (select v from _v where k='part')), '42501', null, 'another brand cannot read their details');
set local request.jwt.claims = '{"sub":"0d000000-0000-0000-0000-00000000000d","role":"authenticated"}';

-- ===== delete =====
select throws_ok( format($$ select api.admin_remove_from_campaign(%L::uuid, null) $$, (select v from _v where k='part')), '42501', null, 'only the Super Admin can delete');
set local request.jwt.claims = '{"sub":"5a000000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select is( (api.admin_remove_from_campaign((select v::uuid from _v where k='part'), null)->>'removed')::int, 1, 'Super Admin deletes the creator from the campaign (history and all)');
select is( (select count(*)::int from intel.ci_campaign_participation where participation_id = (select v::uuid from _v where k='part')), 0, 'gone');
select is( (select count(*)::int from intel.ci_campaign_event where participation_id = (select v::uuid from _v where k='part')), 0, 'its history went with it');
select is( (api.admin_remove_from_campaign(null, (select v::uuid from _v where k='inv'))->>'invites_removed')::int, 1, 'and deletes an invited / uploaded creator');

select * from finish();
rollback;
