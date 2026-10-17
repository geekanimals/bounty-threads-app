-- Creator availability, one tap: Available / Limited (+ how much) / Unavailable — set from the Creator Profile
-- header, the Professional section or the Dashboard. ADDITIVE.
alter table intel.ci_creator_professional_profile add column if not exists availability_limit text;

create or replace function api.set_my_availability(p_status text, p_limit text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_identity uuid := intel.ci_caller_identity(); v_st text := lower(btrim(coalesce(p_status,'')));
begin
  perform intel.ci_assert_api_enabled('creator_profile_api');
  if v_identity is null then raise exception 'Please sign in again.' using errcode = '28000'; end if;
  if v_st not in ('available','limited','unavailable') then raise exception 'Pick Available, Limited or Unavailable.' using errcode = '22023'; end if;
  insert into intel.ci_creator_professional_profile(identity_id) values (v_identity) on conflict (identity_id) do nothing;
  update intel.ci_creator_professional_profile
     set availability_status = v_st,
         availability_limit = case when v_st = 'limited' then nullif(left(btrim(coalesce(p_limit,'')), 60), '') end,
         updated_at = now()
   where identity_id = v_identity;
  return jsonb_build_object('status', v_st, 'limit', case when v_st = 'limited' then nullif(left(btrim(coalesce(p_limit,'')), 60), '') end);
end $$;

create or replace function api.get_my_availability()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_identity uuid := intel.ci_caller_identity();
begin
  if v_identity is null then return null; end if;
  return (select jsonb_build_object('status', p.availability_status, 'limit', p.availability_limit)
            from intel.ci_creator_professional_profile p where p.identity_id = v_identity);
end $$;

revoke all on function api.set_my_availability(text, text), api.get_my_availability() from public, anon;
grant execute on function api.set_my_availability(text, text), api.get_my_availability() to authenticated;

-- Media Kit edits (bio / headline / work portfolio) belong to ONE Instagram account: switching / connecting another
-- account brings back that account's own edits (or starts clean) instead of carrying the previous account's over.
create or replace function public.tg_ig_keep_previous()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.platform = 'instagram' and old.ig_user_id is not null and new.ig_user_id is distinct from old.ig_user_id then
    begin perform private.ig_stash(old.member_id, old); exception when others then null; end;
    -- whatever the writer did not set for the NEW account still belongs to the old one → clear it
    if new.archive_media is not distinct from old.archive_media then new.archive_media := null; new.archive_synced_at := null; end if;
    if new.recent_stories is not distinct from old.recent_stories then new.recent_stories := '[]'::jsonb; end if;
    if new.mentions is not distinct from old.mentions then new.mentions := '[]'::jsonb; end if;
    if new.audience is not distinct from old.audience then new.audience := '{}'::jsonb; end if;
    if new.avg_reach is not distinct from old.avg_reach then new.avg_reach := null; end if;
    if new.recent_media is not distinct from old.recent_media then new.recent_media := '[]'::jsonb; end if;
    -- Media Kit edits (bio / headline / portfolio) belong to one account: bring back the new account's own, else start clean
    if new.edits is not distinct from old.edits then
      new.edits := coalesce((select l.account->'edits' from private.ig_linked_accounts l
                              where l.member_id = new.member_id and l.ig_user_id = new.ig_user_id and jsonb_typeof(l.account->'edits') = 'object'), '{}'::jsonb);
    end if;
    new.last_media_sync_at := null;          -- the next open re-syncs the new account
  end if;
  return new;
exception when others then return new;     -- never block a connect
end $$;
