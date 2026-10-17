-- Every connected Instagram account works on its own: apply to a campaign with any of them, and each one's public
-- Media Kit link (/kit/<handle>) opens. ADDITIVE.

-- apply with ANY of the creator's connected Instagram accounts (not only the one open in the Media Kit)
create or replace function api.apply_to_campaign_v2(p_campaign uuid, p_profile text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_identity uuid := intel.ci_caller_identity(); v_res jsonb; v_handle text; v_own text;
begin
  v_handle := nullif(lower(regexp_replace(coalesce(p_profile,''), '^@', '')), '');
  select lower(sa.username) into v_own from public.social_accounts sa where sa.member_id = auth.uid() and sa.platform = 'instagram' limit 1;
  if v_handle is not null and v_handle is distinct from v_own
     and not intel.ci_member_has_handle(auth.uid(), v_handle)
     and not exists (select 1 from intel.ci_creator_managed_profile m where m.identity_id = v_identity and lower(m.handle) = v_handle) then
    raise exception 'pick one of your own profiles' using errcode = '42501';
  end if;
  v_res := api.apply_to_campaign(p_campaign, null);
  update intel.ci_campaign_participation set applied_profile = coalesce(v_handle, v_own)
   where participation_id = (v_res->>'participation_id')::uuid;
  return v_res || jsonb_build_object('applied_profile', coalesce(v_handle, v_own));
end $$;
revoke all on function api.apply_to_campaign_v2(uuid, text) from public, anon;
grant execute on function api.apply_to_campaign_v2(uuid, text) to authenticated;

-- Public Media Kit link (/kit/<handle>) works for EVERY connected account, not only the one that's open right now
create or replace function public.public_profile(p_username text)
returns table(username text, name text, account_type text, followers_count int, follows_count int,
              media_count int, avg_reach numeric, profile_picture_url text, biography text, website text,
              recent_media jsonb, audience jsonb, mentions jsonb, edits jsonb)
language sql stable security definer set search_path = '' as $$
  select * from (
    select s.username, s.name, s.account_type, s.followers_count, s.follows_count, s.media_count, s.avg_reach,
           s.profile_picture_url, s.biography, s.website, s.recent_media, s.audience, s.mentions, s.edits
      from public.social_accounts s
     where lower(s.username) = lower(p_username) and s.platform = 'instagram'
     limit 1) a
  union all
  select * from (
    select coalesce(l.username, l.account->>'username'), l.account->>'name', l.account->>'account_type',
           nullif(l.account->>'followers_count','')::int, nullif(l.account->>'follows_count','')::int,
           nullif(l.account->>'media_count','')::int, nullif(l.account->>'avg_reach','')::numeric,
           l.account->>'profile_picture_url', l.account->>'biography', l.account->>'website',
           coalesce(l.account->'recent_media','[]'::jsonb), coalesce(l.account->'audience','{}'::jsonb),
           coalesce(l.account->'mentions','[]'::jsonb), coalesce(l.account->'edits','{}'::jsonb)
      from private.ig_linked_accounts l
     where lower(coalesce(l.username, l.account->>'username')) = lower(p_username)
       and not exists (select 1 from public.social_accounts s where lower(s.username) = lower(p_username) and s.platform = 'instagram')
     limit 1) b
$$;
grant execute on function public.public_profile(text) to anon, authenticated;
