-- Campaign cover photo: the picture creators see on every campaign card and brief (Bounty v2).
-- * public.campaigns.cover_url   — set by the Super Admin campaign form (upload into campaign-files or paste a link)
-- * intel.ci_campaign.cover_url  — for campaigns that live only on the ops side (and the current live ones below)
-- * public.campaign_covers()     — { "<ci campaign_id>": "<url>" } for the creator app (anon + signed-in); only public image links
alter table public.campaigns add column if not exists cover_url text;
alter table intel.ci_campaign add column if not exists cover_url text;

alter table public.campaigns drop constraint if exists campaigns_cover_url_chk;
alter table public.campaigns add constraint campaigns_cover_url_chk
  check (cover_url is null or (length(cover_url) <= 1000 and (cover_url ~* '^https://' or cover_url ~ '^/assets/')));
alter table intel.ci_campaign drop constraint if exists ci_campaign_cover_url_chk;
alter table intel.ci_campaign add constraint ci_campaign_cover_url_chk
  check (cover_url is null or (length(cover_url) <= 1000 and (cover_url ~* '^https://' or cover_url ~ '^/assets/')));

create or replace function public.campaign_covers()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(c.campaign_id::text, coalesce(p.cover_url, c.cover_url)), '{}'::jsonb)
    from intel.ci_campaign c
    left join public.campaigns p on p.id = c.legacy_campaign_id
   where coalesce(p.cover_url, c.cover_url) is not null $$;
revoke all on function public.campaign_covers() from public;
grant execute on function public.campaign_covers() to anon, authenticated;

-- the campaigns live today: the brand's own product photo where there is one, else a matching photo from the app
update intel.ci_campaign set cover_url = 'https://beardo.in/cdn/shop/files/1_3b623d46-585b-431d-a7dc-bdf92314d374.jpg?width=1200'
 where campaign_id = '097ec4fa-577b-4c66-ab99-041d8c963b31' and cover_url is null;   -- Beardo · Face De-Tan Express Kit (beardo.in product photo)
update intel.ci_campaign set cover_url = '/assets/bounty/rd/ph_pets.jpg'
 where campaign_id = 'eae56c91-c7fe-49a5-aa4e-1b2d8617e71e' and cover_url is null;   -- Snuggles · dog food
update intel.ci_campaign set cover_url = '/assets/bounty/rd/ph_vaaree.jpg'
 where campaign_id = '0434c203-27f8-4a71-a44c-e6a59bba6f34' and cover_url is null;   -- Vaaree · Diwali home decor
