-- Media Kit: the whole account, not just the latest 12 posts.
--   archive_media     = every post (newest first, up to 150) with likes + comments → "Top performing" across the
--                       whole account and "Load more" in Top performing / Content showcase
--   archive_synced_at = when it was last scanned (instagram-media-sync re-scans at most every 6 h)
-- ADDITIVE.
alter table public.social_accounts add column if not exists archive_media jsonb;
alter table public.social_accounts add column if not exists archive_synced_at timestamptz;

create or replace function public.ig_switch_account(p_ig_user_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); a public.social_accounts%rowtype; l private.ig_linked_accounts%rowtype; r public.social_accounts;
begin
  if v_uid is null then raise exception 'Please sign in again.' using errcode = '28000'; end if;
  select * into a from public.social_accounts where member_id = v_uid and platform = 'instagram';
  if a.ig_user_id = p_ig_user_id then return jsonb_build_object('ok', true, 'username', a.username, 'already', true); end if;
  select * into l from private.ig_linked_accounts where member_id = v_uid and ig_user_id = p_ig_user_id;
  if l.member_id is null then raise exception 'That Instagram account is not connected to your login.' using errcode = '22023'; end if;
  if (l.token->>'expires_at')::timestamptz < now() then
    raise exception 'The login for @% has expired — connect it again (Add another Instagram) to switch to it.', coalesce(l.username,'that account') using errcode = '22023';
  end if;
  if a.member_id is not null then perform private.ig_stash(v_uid, a); end if;   -- keep the current one fresh

  r := jsonb_populate_record(null::public.social_accounts, l.account || jsonb_build_object('member_id', v_uid, 'platform', 'instagram'));
  insert into public.social_accounts(org_id, member_id, platform, ig_user_id, username, name, account_type, followers_count,
      follows_count, media_count, profile_picture_url, biography, website, recent_media, avg_reach, audience, mentions,
      recent_stories, last_media_sync_at, connected_at, updated_at, archive_media, archive_synced_at)
  values (coalesce(a.org_id, r.org_id), v_uid, 'instagram', r.ig_user_id, r.username, r.name, r.account_type, r.followers_count,
      r.follows_count, r.media_count, r.profile_picture_url, r.biography, r.website, coalesce(r.recent_media,'[]'::jsonb), r.avg_reach,
      r.audience, r.mentions, r.recent_stories, null, coalesce(r.connected_at, now()), coalesce(r.updated_at, now()), r.archive_media, r.archive_synced_at)
  on conflict (member_id, platform) do update set ig_user_id = excluded.ig_user_id, username = excluded.username, name = excluded.name,
      account_type = excluded.account_type, followers_count = excluded.followers_count, follows_count = excluded.follows_count,
      media_count = excluded.media_count, profile_picture_url = excluded.profile_picture_url, biography = excluded.biography,
      website = excluded.website, recent_media = excluded.recent_media, avg_reach = excluded.avg_reach, audience = excluded.audience,
      mentions = excluded.mentions, recent_stories = excluded.recent_stories, last_media_sync_at = null, updated_at = excluded.updated_at,
      archive_media = excluded.archive_media, archive_synced_at = excluded.archive_synced_at;

  if l.token is not null then
    insert into public.social_tokens(member_id, platform, ig_user_id, access_token, expires_at, updated_at, scopes, connected_at, meta)
    values (v_uid, 'instagram', l.ig_user_id, l.token->>'access_token', (l.token->>'expires_at')::timestamptz, now(),
            case when jsonb_typeof(l.token->'scopes') = 'array' then array(select jsonb_array_elements_text(l.token->'scopes')) end,
            (l.token->>'connected_at')::timestamptz, l.token->'meta')
    on conflict (member_id, platform) do update set ig_user_id = excluded.ig_user_id, access_token = excluded.access_token,
      expires_at = excluded.expires_at, updated_at = now(), scopes = excluded.scopes, connected_at = excluded.connected_at, meta = excluded.meta;
  end if;
  return jsonb_build_object('ok', true, 'username', r.username);
end $$;
