-- Media Kit live refresh: keep the creator's live Instagram stories next to recent_media, and remember when
-- the last light sync ran (instagram-media-sync throttles Instagram calls on it). ADDITIVE.
alter table public.social_accounts add column if not exists recent_stories jsonb not null default '[]'::jsonb;
alter table public.social_accounts add column if not exists last_media_sync_at timestamptz;
