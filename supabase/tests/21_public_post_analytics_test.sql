-- Public analytics for post links (creators not on Geek OS too). Rolls back.
begin;
select * from no_plan();
select ok( not has_function_privilege('authenticated','api.ops_public_post_save(text,jsonb,text[],jsonb,text)','EXECUTE'), 'only the server saves public numbers');
select is( api.ops_public_post_save('sheet.star', '{"name":"Sheet Star","followers_count":20000,"media_count":120,"avg_likes":800,"avg_comments":40,"engagement":4.2,"bio":"Pune foodie"}'::jsonb,
  array['ABC123'], '[{"permalink":"https://www.instagram.com/reel/ABC123/","like_count":950,"comments_count":61,"view_count":24000,"media_product_type":"REELS","timestamp":"2026-10-20T10:00:00Z"},{"permalink":"https://www.instagram.com/p/ZZZ/","like_count":5}]'::jsonb, null), 1,
  'the campaign post found among their latest posts is saved');
insert into auth.users(instance_id,id,aud,role,email,created_at,updated_at) values ('00000000-0000-0000-0000-000000000000','5a000000-0000-0000-0000-0000000000a5','authenticated','authenticated','sa@t.local',now(),now());
insert into public.members(id,role,name) values ('5a000000-0000-0000-0000-0000000000a5','owner','Super') on conflict (id) do nothing;
insert into public.platform_admins(user_id) values ('5a000000-0000-0000-0000-0000000000a5');
set local request.jwt.claims = '{"sub":"5a000000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select is( (api.creator_public_stats('@Sheet.Star')->'profile'->>'engagement')::numeric, 4.2, 'profile engagement kept');
select is( (api.creator_public_stats('sheet.star')->'profile'->>'avg_likes')::numeric, 800::numeric, 'avg likes kept');
select is( (api.creator_public_stats('sheet.star')->'posts'->0->>'views')::bigint, 24000::bigint, 'the post''s views');
select is( (api.public_stats_status()->>'facebook')::boolean, false, 'no Facebook connection yet');
select * from finish();
rollback;
