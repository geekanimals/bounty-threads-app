-- Phase 1E Operations — barter execution OS tests. Verifies the append-only state machine (owner/timestamp/
-- history/reason), server-enforced authorization (operator / creator / owning-brand), reuse of existing
-- identity+brand, privacy, and evidence-only metrics. No scoring/ranking. Rolls back.
begin;
select * from no_plan();

-- ===== static: operational tables are service-role only; api is authorised; ledger append-only =====
select ok( not has_table_privilege('authenticated','intel.ci_campaign','SELECT'), 'authenticated cannot read campaigns directly');
select ok( not has_table_privilege('authenticated','intel.ci_campaign_participation','SELECT'), 'authenticated cannot read participation directly');
select ok( not has_table_privilege('authenticated','intel.ci_campaign_event','SELECT'), 'authenticated cannot read the event ledger directly');
select ok( not has_table_privilege('authenticated','intel.ci_agency_operator','SELECT'), 'authenticated cannot read the operator allowlist');
select ok( has_function_privilege('authenticated','api.create_campaign(jsonb)','EXECUTE'), 'authenticated may call create_campaign (auth checked inside)');
select ok( has_function_privilege('authenticated','api.get_my_campaigns()','EXECUTE'), 'authenticated may call get_my_campaigns');
-- no intelligence model touched: no *_score column anywhere in the new tables
select is( (select count(*)::int from information_schema.columns where table_schema='intel'
            and table_name like 'ci_campaign%' and column_name ~* 'score'), 0, 'no score column on any operational table');

-- ===== fixtures: operator, creator, brand =====
insert into auth.users(instance_id,id,aud,role,email,created_at,updated_at) values
  ('00000000-0000-0000-0000-000000000000','0d000000-0000-0000-0000-00000000000d','authenticated','authenticated','op@t.local',now(),now()),
  ('00000000-0000-0000-0000-000000000000','c1000000-0000-0000-0000-0000000000c1','authenticated','authenticated','c1@t.local',now(),now()),
  ('00000000-0000-0000-0000-000000000000','c2000000-0000-0000-0000-0000000000c2','authenticated','authenticated','c2@t.local',now(),now()),
  ('00000000-0000-0000-0000-000000000000','b3000000-0000-0000-0000-0000000000b3','authenticated','authenticated','b3@t.local',now(),now()),
  ('00000000-0000-0000-0000-000000000000','e5000000-0000-0000-0000-0000000000e5','authenticated','authenticated','e5@t.local',now(),now());
create table if not exists public.members(id uuid primary key, org_id uuid not null default gen_random_uuid(), role text, name text);
-- op + owning brand (b3) + an UNRELATED brand (e5) in its own org
insert into public.members(id,role,name) values ('0d000000-0000-0000-0000-00000000000d','agency','Op'),('b3000000-0000-0000-0000-0000000000b3','brand','Br'),('e5000000-0000-0000-0000-0000000000e5','brand','OtherBrand') on conflict (id) do nothing;
update intel.ci_feature_flag set enabled=true where flag in ('creator_ig_connect','creator_profile_api');
create temp table _v(k text primary key, v text);
insert into intel.ci_agency_operator(member_id,label) values ('0d000000-0000-0000-0000-00000000000d','geek op');
insert into intel.ci_brand(brand_id,name) values ('bbbb0000-0000-0000-0000-00000000bbbb','Snuggles') on conflict do nothing;
insert into _v values('brand_org',(select org_id::text from public.members where id='b3000000-0000-0000-0000-0000000000b3'));

set local request.jwt.claims = '{"sub":"c1000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select api.bootstrap_my_profile();
set local request.jwt.claims = '{"sub":"c2000000-0000-0000-0000-0000000000c2","role":"authenticated"}';
select api.bootstrap_my_profile();
set local request.jwt.claims = '';
insert into _v values('id1',(select a.identity_id::text from intel.ci_identity_actor_access a where a.member_id='c1000000-0000-0000-0000-0000000000c1' and a.access_role='self' limit 1));

-- ===== KILL SWITCH: with operational_pilot OFF, the surface is disabled (it is ON in production) =====
update intel.ci_feature_flag set enabled=false where flag='operational_pilot';
set local request.jwt.claims = '{"sub":"0d000000-0000-0000-0000-00000000000d","role":"authenticated"}';
select throws_ok( $$ select api.create_campaign('{"name":"x","submitted_brand_name":"y"}'::jsonb) $$, '0A000', null, 'operational_pilot OFF disables the whole surface');
set local request.jwt.claims = '';
update intel.ci_feature_flag set enabled=true where flag='operational_pilot';

-- ===== operator gate =====
set local request.jwt.claims = '{"sub":"c1000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select throws_ok( $$ select api.create_campaign('{"name":"x","submitted_brand_name":"y"}'::jsonb) $$, '42501', 'not an agency operator', 'non-operator cannot create a campaign');

set local request.jwt.claims = '{"sub":"0d000000-0000-0000-0000-00000000000d","role":"authenticated"}';
insert into _v values('camp',(api.create_campaign('{"brand_id":"bbbb0000-0000-0000-0000-00000000bbbb","name":"Snuggles launch","objective":"product_launch","product":"pet bed","category":"pets","cities":["Bangalore"],"comp_type":"hybrid","budget":1500000}'::jsonb)->>'campaign_id'));
select ok( (select v from _v where k='camp') is not null, 'operator creates a campaign');
select is( (select lifecycle_status from intel.ci_campaign where campaign_id=(select v::uuid from _v where k='camp')), 'draft', 'campaign starts in draft');
insert into _v values('part',(api.add_campaign_participant((select v::uuid from _v where k='camp'),(select v::uuid from _v where k='id1'),'creator')->>'participation_id'));
insert into _v values('dlv',(api.add_deliverable((select v::uuid from _v where k='part'),'reel',1,'2026-10-15')->>'deliverable_id'));
-- move campaign into execution and invite
select api.set_campaign_status((select v::uuid from _v where k='camp'),'creator_discovery',null);
select api.set_campaign_status((select v::uuid from _v where k='camp'),'in_execution',null);
select api.advance_participation((select v::uuid from _v where k='part'),'invited',null);
select is( (select stage from intel.ci_campaign_participation where participation_id=(select v::uuid from _v where k='part')), 'invited', 'operator invites the creator');

-- ===== illegal transition + reason enforcement =====
select throws_ok( format($$ select api.advance_participation(%L::uuid,'published',null) $$,(select v from _v where k='part')), '22023', null, 'illegal transition is rejected');
select throws_ok( format($$ select api.advance_participation(%L::uuid,'dropped',null) $$,(select v from _v where k='part')), '22023', null, 'dropping without a reason is rejected');

-- ===== creator ownership: c2 cannot act on c1's participation =====
set local request.jwt.claims = '{"sub":"c2000000-0000-0000-0000-0000000000c2","role":"authenticated"}';
select throws_ok( format($$ select api.respond_to_campaign(%L::uuid, true, null) $$,(select v from _v where k='part')), '42501', 'not your campaign participation', 'a creator cannot respond to someone else''s participation');

-- ===== creator accepts, submits =====
set local request.jwt.claims = '{"sub":"c1000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select is( (api.respond_to_campaign((select v::uuid from _v where k='part'), true, null)->>'stage'), 'accepted', 'creator accepts');
select ok( jsonb_array_length(api.get_my_campaigns()) = 1, 'creator sees the campaign in My Campaigns');
select ok( api.get_my_campaigns()::text !~* '(whatsapp|"phone"|date_of_birth|address|access_token|refresh_token)', 'My Campaigns payload leaks no PII/tokens');

-- barter flow since 20261014: accepted → contract_sent → (creator signs) → contract_signed → (address) → address_confirmed.
-- Contract signing + address have their own tests; here the participation is moved past them directly.
set local request.jwt.claims = '';
update intel.ci_campaign_participation set stage='address_confirmed' where participation_id=(select v::uuid from _v where k='part');
set local request.jwt.claims = '{"sub":"0d000000-0000-0000-0000-00000000000d","role":"authenticated"}';
select api.record_shipment((select v::uuid from _v where k='part'),'pet bed','BlueDart','BD1');
select is( (select stage from intel.ci_campaign_participation where participation_id=(select v::uuid from _v where k='part')), 'product_sent', 'shipment advances to product_sent');

set local request.jwt.claims = '{"sub":"c1000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
insert into _v values('sub',(api.submit_content((select v::uuid from _v where k='dlv'),'https://ig/p/x','done')->>'submission_id'));
select is( (select stage from intel.ci_campaign_participation where participation_id=(select v::uuid from _v where k='part')), 'content_submitted', 'submit advances to content_submitted');

-- ===== approval authorization: unrelated org denied; owning brand allowed =====
set local request.jwt.claims = '{"sub":"c2000000-0000-0000-0000-0000000000c2","role":"authenticated"}';
select throws_ok( format($$ select api.approve_content(%L::uuid,'approved',null) $$,(select v from _v where k='sub')), '42501', 'not authorised to review this campaign', 'a random user cannot approve content');
-- make the brand org the campaign owner, then the brand approves
set local request.jwt.claims = '';
update intel.ci_campaign set org_id=(select v::uuid from _v where k='brand_org') where campaign_id=(select v::uuid from _v where k='camp');
set local request.jwt.claims = '{"sub":"b3000000-0000-0000-0000-0000000000b3","role":"authenticated"}';
select is( (api.approve_content((select v::uuid from _v where k='sub'),'approved',null)->>'decision'), 'approved', 'owning brand org approves content');
select is( (select stage from intel.ci_campaign_participation where participation_id=(select v::uuid from _v where k='part')), 'content_approved', 'approval advances to content_approved');

-- ===== operator publishes + completes; full history present =====
set local request.jwt.claims = '{"sub":"0d000000-0000-0000-0000-00000000000d","role":"authenticated"}';
select api.advance_participation((select v::uuid from _v where k='part'),'published',null);
select is( (api.advance_participation((select v::uuid from _v where k='part'),'completed',null)->>'stage'), 'completed', 'participation reaches completed');
select ok( (select count(*) from intel.ci_campaign_event where participation_id=(select v::uuid from _v where k='part')) >= 8, 'the event ledger recorded every participation transition (owner+reason+timestamp)');
select ok( (select bool_and(actor_member_id is not null and at is not null) from intel.ci_campaign_event where participation_id=(select v::uuid from _v where k='part')), 'every event has an actor and a timestamp');

-- ===== append-only ledger =====
select throws_ok( $$ update intel.ci_campaign_event set reason='x' $$, null, null, 'event ledger is append-only (no UPDATE)');
select throws_ok( $$ delete from intel.ci_campaign_event $$, null, null, 'event ledger is append-only (no DELETE)');

-- ===== pipeline + metrics (operator; evidence-only, no fake zero) =====
select is( (api.get_campaign_pipeline('{}'::jsonb)->'totals'->>'completed'), '1', 'pipeline totals count the completed participation');
select is( (api.get_pilot_metrics()->>'completion_rate'), '1.000', 'completion rate is computed from evidence');

-- reuse: no new identity/brand created by the ops flow (participation FK'd to the existing identity)
select is( (select identity_id::text from intel.ci_campaign_participation where participation_id=(select v::uuid from _v where k='part')), (select v from _v where k='id1'), 'participation reuses the existing creator identity (no duplicate)');

-- vocab getter
select ok( jsonb_array_length(api.ops_vocab()->'content_formats') > 0, 'ops_vocab returns content formats');

-- ===== get_campaign_detail security contract (read-only): operator + owning-brand allowed; others denied; no PII =====
-- (the campaign's org_id was set to the owning brand's org above, so b3 is the owning brand.)
-- operator ALLOWED — exposes participations + the event-ledger timeline
set local request.jwt.claims = '{"sub":"0d000000-0000-0000-0000-00000000000d","role":"authenticated"}';
select is( (api.get_campaign_detail((select v::uuid from _v where k='camp'))->'campaign'->>'name'), 'Snuggles launch', 'operator is allowed to read campaign detail');
select ok( jsonb_array_length(api.get_campaign_detail((select v::uuid from _v where k='camp'))->'participations') = 1, 'campaign detail lists participation status');
select ok( jsonb_array_length(api.get_campaign_detail((select v::uuid from _v where k='camp'))->'events') >= 8, 'campaign detail returns the event-ledger timeline');
-- PII ABSENT from the payload (no email/whatsapp/address/private profile/rate/contact/token)
select ok( api.get_campaign_detail((select v::uuid from _v where k='camp'))::text !~* '(whatsapp|"phone"|"email"|date_of_birth|"address"|address_line|"pincode"|postal|rate_card|"contact"|access_token|refresh_token)', 'campaign detail payload contains no PII / private contact / commercials / tokens');
-- owning brand ALLOWED
set local request.jwt.claims = '{"sub":"b3000000-0000-0000-0000-0000000000b3","role":"authenticated"}';
select is( (api.get_campaign_detail((select v::uuid from _v where k='camp'))->'campaign'->>'name'), 'Snuggles launch', 'owning brand org is allowed to read its campaign detail');
-- unrelated BRAND (different org) DENIED
set local request.jwt.claims = '{"sub":"e5000000-0000-0000-0000-0000000000e5","role":"authenticated"}';
select throws_ok( format($$ select api.get_campaign_detail(%L::uuid) $$,(select v from _v where k='camp')), '42501', 'not authorised for this campaign', 'an unrelated brand (different org) is denied campaign detail');
-- unrelated CREATOR DENIED
set local request.jwt.claims = '{"sub":"c2000000-0000-0000-0000-0000000000c2","role":"authenticated"}';
select throws_ok( format($$ select api.get_campaign_detail(%L::uuid) $$,(select v from _v where k='camp')), '42501', 'not authorised for this campaign', 'an unrelated creator is denied campaign detail');
-- read contract only: no mutating counterpart exists on this RPC (it is STABLE / SELECT-only)
select is( (select provolatile from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='api' and p.proname='get_campaign_detail'), 's', 'get_campaign_detail is STABLE (a read contract, cannot mutate)');

select * from finish();
rollback;
