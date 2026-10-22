-- Video reminders (9:00 + 18:30, no auto block), Super Admin–only blocklist, creator upload, joined-via. Rolls back.
begin;
select * from no_plan();

select ok( not has_function_privilege('authenticated','intel.ci_run_video_reminders()','EXECUTE'), 'only the database runs video reminders');
select ok( not has_table_privilege('authenticated','intel.ci_creator_upload','SELECT'), 'creator uploads are not readable directly');

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
insert into public.wa_contacts(user_id, phone_e164, verified_at, opt_in_at) values ('c1000000-0000-0000-0000-0000000000c1', '+919812399999', now(), now());
set local session_replication_role = replica;
update public.members set name = 'Riya Sharma', role = 'creator', status = 'active' where id = 'c1000000-0000-0000-0000-0000000000c1';
set local session_replication_role = origin;
insert into public.members(id,role,name) values ('c1000000-0000-0000-0000-0000000000c1','creator','Riya Sharma') on conflict (id) do nothing;

-- ===== product shipped 5 days ago, no video → a reminder each slot, never twice in one slot =====
update intel.ci_campaign_participation set stage = 'product_sent' where participation_id = (select v::uuid from _v where k='part');
insert into intel.ci_campaign_shipment(participation_id, courier, tracking_ref, shipped_at, status)
values ((select v::uuid from _v where k='part'), 'Blue Dart', '77250399586', now() - interval '5 days', 'shipped');
select is( intel.ci_schedule_video_reminders((select v::uuid from _v where k='part')), 0, 'nothing is pre-scheduled any more');
select is( intel.ci_run_video_reminders(), 1, 'shipped 5 days ago and no video: reminder sent');
select is( intel.ci_run_video_reminders(), 0, 'not twice in the same slot');
select ok( exists (select 1 from intel.ci_outbox where participation_id = (select v::uuid from _v where k='part') and channel = 'whatsapp' and template_key like 'video%'), 'it goes on WhatsApp');
select is( (select template_key from private.ci_video_nudge limit 1), 'video_nudge', 'due date still days away: a friendly nudge');
delete from private.ci_video_nudge;
update intel.ci_campaign set ends_on = current_date - 1 where campaign_id = (select v::uuid from _v where k='camp');
update private.ci_step_wa_status set status = 'approved' where wa_template = 'geek_step_video_final';
select is( intel.ci_run_video_reminders(), 1, 'campaign over: still reminded');
select is( (select template_key from private.ci_video_nudge limit 1), 'video_blacklist_warning', 'with the blocklist warning');
delete from private.ci_video_nudge;
update intel.ci_campaign_participation set stage = 'content_submitted' where participation_id = (select v::uuid from _v where k='part');
select is( intel.ci_run_video_reminders(), 0, 'video in: no more reminders');
select is( (select count(*)::int from intel.ci_campaign_participation where blocked_at is not null), 0, 'nobody is blocked automatically');

-- ===== blocklist: Super Admin only =====
set local request.jwt.claims = '{"sub":"0d000000-0000-0000-0000-00000000000d","role":"authenticated"}';
select throws_ok( format($$ select api.blacklist_creator(%L::uuid, 'no video') $$, (select v from _v where k='part')), '42501', null, 'an agency operator cannot blocklist');
set local request.jwt.claims = '{"sub":"5a000000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select ok( (api.blacklist_creator((select v::uuid from _v where k='part'), 'no video')->>'blacklist_id') is not null, 'the Super Admin can');

-- ===== creator upload =====
set local request.jwt.claims = '{"sub":"0d000000-0000-0000-0000-00000000000d","role":"authenticated"}';
select throws_ok( $$ select api.creator_upload('[]'::jsonb) $$, '42501', null, 'creator upload is Super Admin only');
set local request.jwt.claims = '{"sub":"5a000000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select is( (api.creator_upload('[{"name":"Aman Fit","handle":"https://www.instagram.com/aman.fit/","phone":"98100 11111","email":"aman@x.in","city":"Delhi","followers":"12,000"},
                                {"name":"No Contact"},
                                {"name":"Riya","phone":"9812399999"}]'::jsonb)->>'added')::int, 2, 'two new creators saved, the one with no contact skipped');
select is( (select count(*)::int from intel.ci_outbox where template_key = 'join_invite'), 2, 'the new one gets WhatsApp + email to register');
select is( (select handle from intel.ci_creator_upload where phone_e164 = '+919810011111'), 'aman.fit', 'handle read from the Instagram link');
select is( (api.creator_upload('[{"handle":"aman.fit","city":"Noida"}]'::jsonb)->>'updated')::int, 1, 'same creator again: updated, not duplicated');
select is( (select count(*)::int from intel.ci_outbox where template_key = 'join_invite'), 2, 'and not messaged again');
select is( (api.creator_upload_list()->>'joined')::int, 1, 'someone already on Geek OS shows as joined');
select ok( exists (select 1 from intel.ci_external_creator where handle = 'aman.fit'), 'uploaded creators are in discovery too');
select is( intel.ci_joined_via((select v::uuid from _v where k='id1'))->>'campaign', 'Snuggles launch', 'joined-via: the first campaign that brought them in');

select * from finish();
rollback;
