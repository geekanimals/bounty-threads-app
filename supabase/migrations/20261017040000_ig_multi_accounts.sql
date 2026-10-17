-- More than one Instagram account per creator, all connected the real way (Instagram login, like the first one).
--   • public.social_accounts keeps exactly ONE row per creator = the ACTIVE account (everything that reads it —
--     media kit, posting, campaigns, auto-detect, insights — keeps working unchanged).
--   • every connected account (profile snapshot + its sealed token, never decrypted here) is kept in
--     private.ig_linked_accounts. Connecting another account makes it active and keeps the previous one.
--   • "Switch" swaps the active account (profile + token); "Remove" drops a non-active one.
-- ADDITIVE.

create table if not exists private.ig_linked_accounts (
  member_id  uuid not null references auth.users(id) on delete cascade,
  ig_user_id text not null,
  username   text,
  account    jsonb not null,          -- the social_accounts row (without id / member_id / platform)
  token      jsonb,                   -- the social_tokens row (access_token stays sealed)
  linked_at  timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (member_id, ig_user_id)
);
alter table private.ig_linked_accounts enable row level security;
revoke all on private.ig_linked_accounts from public, anon, authenticated;

-- keep a copy of a member's ACTIVE account (+ its token) in the vault
create or replace function private.ig_stash(p_member uuid, p_account public.social_accounts)
returns void language plpgsql security definer set search_path = '' as $$
declare v_tok jsonb;
begin
  if p_account.ig_user_id is null or p_account.platform <> 'instagram' then return; end if;
  select to_jsonb(t) - 'member_id' - 'platform' into v_tok from public.social_tokens t
   where t.member_id = p_member and t.platform = 'instagram' and t.ig_user_id is not distinct from p_account.ig_user_id;
  insert into private.ig_linked_accounts(member_id, ig_user_id, username, account, token)
  values (p_member, p_account.ig_user_id, p_account.username, to_jsonb(p_account) - 'id' - 'member_id' - 'platform', v_tok)
  on conflict (member_id, ig_user_id) do update set username = excluded.username, account = excluded.account,
    token = coalesce(excluded.token, private.ig_linked_accounts.token), updated_at = now();
end $$;

-- a different Instagram account takes the active slot (connect another / switch) → the old one is kept
create or replace function public.tg_ig_keep_previous()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.platform = 'instagram' and old.ig_user_id is not null and new.ig_user_id is distinct from old.ig_user_id then
    perform private.ig_stash(old.member_id, old);
  end if;
  return new;
exception when others then return new;     -- never block a connect
end $$;
drop trigger if exists ig_keep_previous on public.social_accounts;
create trigger ig_keep_previous before update on public.social_accounts
  for each row execute function public.tg_ig_keep_previous();

-- every Instagram account this creator has connected
create or replace function public.my_ig_accounts()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); a public.social_accounts%rowtype;
begin
  if v_uid is null then return '[]'::jsonb; end if;
  select * into a from public.social_accounts where member_id = v_uid and platform = 'instagram';
  return coalesce((
    select jsonb_agg(x order by (x->>'active')::boolean desc, x->>'username') from (
      select jsonb_build_object('ig_user_id', a.ig_user_id, 'username', a.username, 'name', a.name,
               'profile_picture_url', a.profile_picture_url, 'followers_count', a.followers_count, 'active', true) as x
       where a.ig_user_id is not null
      union all
      select jsonb_build_object('ig_user_id', l.ig_user_id, 'username', coalesce(l.username, l.account->>'username'),
               'name', l.account->>'name', 'profile_picture_url', l.account->>'profile_picture_url',
               'followers_count', (l.account->>'followers_count')::int, 'active', false,
               'token_expired', coalesce((l.token->>'expires_at')::timestamptz < now(), false))
        from private.ig_linked_accounts l
       where l.member_id = v_uid and l.ig_user_id is distinct from a.ig_user_id) s), '[]'::jsonb);
end $$;

-- make another connected account the active one (media kit, posting, campaigns all follow it)
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
      recent_stories, last_media_sync_at, connected_at, updated_at)
  values (coalesce(a.org_id, r.org_id), v_uid, 'instagram', r.ig_user_id, r.username, r.name, r.account_type, r.followers_count,
      r.follows_count, r.media_count, r.profile_picture_url, r.biography, r.website, coalesce(r.recent_media,'[]'::jsonb), r.avg_reach,
      r.audience, r.mentions, r.recent_stories, null, coalesce(r.connected_at, now()), coalesce(r.updated_at, now()))
  on conflict (member_id, platform) do update set ig_user_id = excluded.ig_user_id, username = excluded.username, name = excluded.name,
      account_type = excluded.account_type, followers_count = excluded.followers_count, follows_count = excluded.follows_count,
      media_count = excluded.media_count, profile_picture_url = excluded.profile_picture_url, biography = excluded.biography,
      website = excluded.website, recent_media = excluded.recent_media, avg_reach = excluded.avg_reach, audience = excluded.audience,
      mentions = excluded.mentions, recent_stories = excluded.recent_stories, last_media_sync_at = null, updated_at = excluded.updated_at;

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

-- drop a connected account that is not the active one
create or replace function public.ig_remove_account(p_ig_user_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Please sign in again.' using errcode = '28000'; end if;
  if exists (select 1 from public.social_accounts where member_id = v_uid and platform = 'instagram' and ig_user_id = p_ig_user_id) then
    raise exception 'This is your active account — switch to another one first.' using errcode = '22023'; end if;
  delete from private.ig_linked_accounts where member_id = v_uid and ig_user_id = p_ig_user_id;
  return jsonb_build_object('ok', found);
end $$;

-- the account that is active today is in the vault too
insert into private.ig_linked_accounts(member_id, ig_user_id, username, account, token)
select sa.member_id, sa.ig_user_id, sa.username, to_jsonb(sa) - 'id' - 'member_id' - 'platform',
       (select to_jsonb(t) - 'member_id' - 'platform' from public.social_tokens t where t.member_id = sa.member_id and t.platform = 'instagram')
  from public.social_accounts sa where sa.platform = 'instagram' and sa.ig_user_id is not null and sa.member_id is not null
on conflict do nothing;

revoke all on function private.ig_stash(uuid, public.social_accounts), public.tg_ig_keep_previous() from public, anon, authenticated;
revoke all on function public.my_ig_accounts(), public.ig_switch_account(text), public.ig_remove_account(text) from public, anon;
grant execute on function public.my_ig_accounts(), public.ig_switch_account(text), public.ig_remove_account(text) to authenticated;
