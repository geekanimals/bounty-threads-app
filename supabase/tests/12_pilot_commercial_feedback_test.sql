-- Phase 1D pilot — brand decision fields + feedback capture. Verifies the brand sees category/formats/
-- barter/brand-history/rate ONLY per the creator's visibility (approved workflow), never private contact,
-- and that pilot feedback is stored separately and is service-role only. Rolls back.
begin;
select * from no_plan();

-- feedback store is service-role only
select ok( not has_table_privilege('anon','intel.ci_pilot_feedback','SELECT'), 'anon cannot read pilot feedback');
select ok( not has_table_privilege('authenticated','intel.ci_pilot_feedback','SELECT'), 'authenticated cannot read pilot feedback');
select ok( has_function_privilege('authenticated','api.get_creator_commercial_readiness(uuid)','EXECUTE'), 'authenticated may call brand commercial readiness');
select ok( has_function_privilege('authenticated','api.submit_pilot_feedback(text,jsonb)','EXECUTE'), 'authenticated may submit feedback');

-- fixtures
insert into auth.users(instance_id,id,aud,role,email,created_at,updated_at) values
  ('00000000-0000-0000-0000-000000000000','c1000000-0000-0000-0000-0000000000c1','authenticated','authenticated','cc@t.local',now(),now()),
  ('00000000-0000-0000-0000-000000000000','b3000000-0000-0000-0000-0000000000b3','authenticated','authenticated','bb@t.local',now(),now()),
  ('00000000-0000-0000-0000-000000000000','d4000000-0000-0000-0000-0000000000d4','authenticated','authenticated','xx@t.local',now(),now());
create table if not exists public.members(id uuid primary key, org_id uuid not null default gen_random_uuid(), role text, name text);
insert into public.members(id,role,name) values ('b3000000-0000-0000-0000-0000000000b3','brand','B'),('d4000000-0000-0000-0000-0000000000d4','brand','X') on conflict (id) do nothing;
update intel.ci_feature_flag set enabled=true where flag in ('creator_ig_connect','creator_profile_api');
create temp table _v(k text primary key, v text);
insert into _v values('ob',(select org_id::text from public.members where id='b3000000-0000-0000-0000-0000000000b3'));

set local request.jwt.claims = '{"sub":"c1000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select api.bootstrap_my_profile();
set local request.jwt.claims = '';
insert into _v values('idR',(select a.identity_id::text from intel.ci_identity_actor_access a where a.member_id='c1000000-0000-0000-0000-0000000000c1' and a.access_role='self' limit 1));

-- creator commercial/professional facts
update intel.ci_creator_professional_profile set categories=array['pets','lifestyle'], content_formats=array['reels','stories'] where identity_id=(select v::uuid from _v where k='idR');
insert into intel.ci_creator_commercial_preference(identity_id, accepts_barter, barter_preference, min_product_value, open_to_top_brands, travel_ready)
  values ((select v::uuid from _v where k='idR'), true, 'any_relevant', 2000, true, true)
  on conflict (identity_id) do update set accepts_barter=excluded.accepts_barter, barter_preference=excluded.barter_preference,
    min_product_value=excluded.min_product_value, open_to_top_brands=excluded.open_to_top_brands, travel_ready=excluded.travel_ready;
insert into intel.ci_creator_brand_experience(identity_id, submitted_brand_name, source_type, verification_status, creator_confirmed_at)
  values ((select v::uuid from _v where k='idR'),'Pedigree','creator_declared','creator_confirmed', now());
insert into intel.ci_creator_rate_card(rate_card_id, identity_id, status, currency, negotiable, visibility)
  values ('11111111-1111-1111-1111-1111111111a1',(select v::uuid from _v where k='idR'),'active','INR',true,'private');
insert into intel.ci_creator_rate_card_item(rate_card_id, deliverable_type, amount) values
  ('11111111-1111-1111-1111-1111111111a1','IG Reel',40000),('11111111-1111-1111-1111-1111111111a1','IG Story',12000);

-- brand B relationship
insert into intel.ci_org_creator_relationship(org_id,identity_id,relationship_type,status)
  select org_id,(select v::uuid from _v where k='idR'),'managed','active' from public.members where id='b3000000-0000-0000-0000-0000000000b3';

-- ===== brand view BEFORE opt-in: category/formats/barter observed; brand-history + rate NOT shared =====
set local request.jwt.claims = '{"sub":"b3000000-0000-0000-0000-0000000000b3","role":"authenticated"}';
select is( (api.get_creator_commercial_readiness((select v::uuid from _v where k='idR'))->'category_signals'->>'status'), 'observed', 'brand sees category signals (observed)');
select is( (api.get_creator_commercial_readiness((select v::uuid from _v where k='idR'))->'content_formats'->>'status'), 'observed', 'brand sees content formats (observed)');
select is( (api.get_creator_commercial_readiness((select v::uuid from _v where k='idR'))->'barter_readiness'->>'status'), 'observed', 'brand sees barter readiness (observed)');
select is( (api.get_creator_commercial_readiness((select v::uuid from _v where k='idR'))->'brand_history'->>'status'), 'not_shared', 'brand history hidden until creator opts in');
select is( (api.get_creator_commercial_readiness((select v::uuid from _v where k='idR'))->'rate_indication'->>'status'), 'not_shared', 'private rate card is NOT shown to brand');

-- ===== creator opts in: brand_experience visible + rate card non-private =====
set local request.jwt.claims = '';
insert into intel.ci_profile_visibility(identity_id, field_or_group, tier, allowed)
  values ((select v::uuid from _v where k='idR'),'brand_experience','marketplace_summary', true);
update intel.ci_creator_rate_card set visibility='marketplace_summary' where rate_card_id='11111111-1111-1111-1111-1111111111a1';
set local request.jwt.claims = '{"sub":"b3000000-0000-0000-0000-0000000000b3","role":"authenticated"}';
select is( (api.get_creator_commercial_readiness((select v::uuid from _v where k='idR'))->'brand_history'->>'status'), 'observed', 'opted-in brand history becomes visible (observed)');
select is( (api.get_creator_commercial_readiness((select v::uuid from _v where k='idR'))->'brand_history'->>'confirmed_count'), '1', 'brand history shows the confirmed count');
select is( (api.get_creator_commercial_readiness((select v::uuid from _v where k='idR'))->'rate_indication'->>'status'), 'derived', 'opted-in rate card yields a derived indication');
select is( (api.get_creator_commercial_readiness((select v::uuid from _v where k='idR'))->'rate_indication'->>'indicative_min'), '12000', 'rate indication min across items');
select is( (api.get_creator_commercial_readiness((select v::uuid from _v where k='idR'))->'rate_indication'->>'indicative_max'), '40000', 'rate indication max across items');
select ok( api.get_creator_commercial_readiness((select v::uuid from _v where k='idR'))::text !~* '(whatsapp|"phone"|"email"|date_of_birth|address|access_token)', 'commercial payload leaks no private contact/PII');

-- ===== unrelated brand denied =====
select set_config('request.jwt.claims','{"sub":"d4000000-0000-0000-0000-0000000000d4","role":"authenticated"}',true);
select throws_ok( format($$ select api.get_creator_commercial_readiness(%L::uuid) $$,(select v from _v where k='idR')), '42501', 'not authorised to view this creator', 'unrelated brand denied commercial readiness');

-- ===== self sees own rate even though card was private-tier to others =====
select set_config('request.jwt.claims','{"sub":"c1000000-0000-0000-0000-0000000000c1","role":"authenticated"}',true);
select is( (api.get_my_commercial_readiness()->'category_signals'->>'status'), 'observed', 'creator sees own category signals');

-- ===== feedback stored separately per role =====
set local request.jwt.claims = '{"sub":"c1000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select ok( (api.submit_pilot_feedback('creator', '{"profile_easy":true,"incorrect":"none","trust":"more audience detail"}'::jsonb)->>'ok')='true', 'creator feedback submitted');
set local request.jwt.claims = '{"sub":"b3000000-0000-0000-0000-0000000000b3","role":"authenticated"}';
select ok( (api.submit_pilot_feedback('brand', '{"would_shortlist":true,"missing":"conversion","would_pay":"maybe"}'::jsonb)->>'ok')='true', 'brand feedback submitted');
select is( (select count(distinct subject_kind)::int from intel.ci_pilot_feedback), 2, 'feedback stored separately for creator and brand');
select is( (select subject_kind from intel.ci_pilot_feedback where member_id='b3000000-0000-0000-0000-0000000000b3'), 'brand', 'brand feedback tagged brand');

select * from finish();
rollback;
