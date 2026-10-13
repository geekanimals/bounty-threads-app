-- Campaign → creators, both ways: the moment a campaign is saved, the people who match its ideal profile are
-- listed with one-tap Invite (in-app + WhatsApp + email), and creators who aren't on the platform yet can be
-- invited by Instagram handle — their invite waits for them and opens the campaign the moment they sign up.
-- Plus: agency / brand signups are approved OR declined with a reason, and the applicant is told either way.
-- Who can do what is unchanged: an agency or brand only ever touches its own campaigns; Super Admin, all.

-- ===================================================================================================
-- 1) Agency / brand signup: approve or decline with a reason, and tell them
-- ===================================================================================================
alter table public.members add column if not exists decline_reason text;
alter table public.members add column if not exists decided_at timestamptz;
alter table public.members add column if not exists decided_by uuid;

insert into intel.ci_notification_template(template_key, kind, title, body_md, action_route, action_label) values
  ('account_approved','info','Your Geek OS account is approved 🎉',
   'Welcome aboard{{who}}! Your account is active — sign in with your official email and password to create campaigns and invite creators.',
   'dashboard','Open Geek OS'),
  ('account_declined','info','About your Geek OS application',
   'Thanks for applying to Geek OS. We can''t approve this account right now.{{reason_line}} Reply to this message if you''d like us to take another look.',
   'dashboard','Contact us')
on conflict (template_key) do update set title = excluded.title, body_md = excluded.body_md;

create or replace function public.set_member_status_v2(p_id uuid, p_status text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_old text; v_name text; v_reason text;
begin
  if not public.is_platform_admin() then raise exception 'not a platform admin' using errcode = '42501'; end if;
  if p_status not in ('active','declined','pending','suspended') then raise exception 'bad status %', p_status using errcode = '22023'; end if;
  select status, coalesce(nullif(btrim(name),''), org_name) into v_old, v_name from public.members where id = p_id;
  if v_old is null then raise exception 'account not found' using errcode = '22023'; end if;
  v_reason := nullif(btrim(coalesce(p_reason,'')), '');
  if p_status = 'declined' and v_reason is null then raise exception 'add a reason so they know why' using errcode = '22023'; end if;

  update public.members set status = p_status, decline_reason = case when p_status = 'declined' then v_reason else null end,
         decided_at = now(), decided_by = auth.uid()
   where id = p_id;

  if p_status = 'active' and v_old is distinct from 'active' then
    perform intel.ci_notify(p_id, null, null, 'account_approved',
      jsonb_build_object('who', case when v_name is null then '' else ', ' || v_name end));
  elsif p_status = 'declined' and v_old is distinct from 'declined' then
    perform intel.ci_notify(p_id, null, null, 'account_declined',
      jsonb_build_object('reason_line', ' Reason: ' || v_reason || '.'));
  end if;

  insert into public.activity_log(member_id, kind, event, detail)
  values (auth.uid(), 'security', 'member_' || p_status, jsonb_build_object('member_id', p_id, 'reason', v_reason));
  return jsonb_build_object('status', p_status);
exception when insufficient_privilege or invalid_parameter_value then raise;
end $$;
revoke all on function public.set_member_status_v2(uuid, text, text) from public, anon;
grant execute on function public.set_member_status_v2(uuid, text, text) to authenticated;

-- ===================================================================================================
-- 2) Who matches this campaign? (creators already on the platform, scored against the ideal profile)
-- ===================================================================================================
-- the app knows a campaign by its admin-panel id; every invite API accepts either id
create or replace function intel.ci_resolve_campaign(p_id uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select coalesce((select campaign_id from intel.ci_campaign where campaign_id = p_id),
                  (select campaign_id from intel.ci_campaign where legacy_campaign_id = p_id order by created_at desc limit 1)) $$;
revoke all on function intel.ci_resolve_campaign(uuid) from public, anon, authenticated;

create or replace function intel.ci_campaign_ideal(p_campaign uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce((select br.requirements->'ideal_profile' from intel.ci_campaign_brief br
                    where br.campaign_id = p_campaign order by br.created_at desc limit 1), '{}'::jsonb) $$;
revoke all on function intel.ci_campaign_ideal(uuid) from public, anon, authenticated;

create or replace function api.campaign_matches(p_campaign uuid, p_limit int default 60)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_ideal jsonb; v_min int; v_max int; v_eng numeric; v_gender text; v_locs text[]; v_cats text[]; v_cities text[];
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  p_campaign := intel.ci_resolve_campaign(p_campaign);
  if p_campaign is null then return '[]'::jsonb; end if;
  if not intel.ci_can_manage_campaign(p_campaign) then raise exception 'not your campaign' using errcode = '42501'; end if;
  v_ideal := intel.ci_campaign_ideal(p_campaign);
  v_min := nullif(v_ideal->>'min_followers','')::int; v_max := nullif(v_ideal->>'max_followers','')::int;
  v_eng := nullif(v_ideal->>'min_engagement','')::numeric; v_gender := nullif(lower(v_ideal->>'gender'),'');
  select array_agg(lower(x)) into v_locs from jsonb_array_elements_text(coalesce(v_ideal->'locations','[]'::jsonb)) x;
  select array_agg(lower(x)) into v_cats from jsonb_array_elements_text(coalesce(v_ideal->'categories','[]'::jsonb)) x;
  select array_agg(lower(x)) into v_cities from (select unnest(c.cities) x from intel.ci_campaign c where c.campaign_id = p_campaign) s;
  v_locs := coalesce(v_locs, v_cities);

  return coalesce((select jsonb_agg(r order by (r->>'score')::int desc, (r->>'followers')::bigint desc nulls last) from (
    select jsonb_build_object(
      'member_id', sa.member_id, 'username', sa.username, 'name', coalesce(nullif(btrim(m.name),''), sa.name),
      'profile_picture_url', sa.profile_picture_url, 'followers', sa.followers_count, 'posts', sa.media_count,
      'engagement', e.eng, 'city', coalesce(ad.city, pp.city_coarse), 'region', coalesce(ad.state, pp.state_coarse),
      'categories', coalesce(to_jsonb(pp.categories), '[]'::jsonb), 'gender', per.gender,
      'reel_rate', (select min(i.amount) from intel.ci_creator_rate_card rc join intel.ci_creator_rate_card_item i on i.rate_card_id = rc.rate_card_id
                     where rc.identity_id = acc.identity_id and rc.status = 'active' and i.deliverable_type ilike '%reel%' and i.amount > 0),
      'accepts_barter', cp.accepts_barter,
      'state', case when p.stage is null then 'none'
                    when p.stage = 'invited' then 'invited'
                    when p.stage in ('applied','eligible','sent_to_brand','shortlisted') then 'applied'
                    when p.stage in ('ineligible','brand_declined','dropped','rejected') then 'declined'
                    else 'approved' end,
      'score', sc.score, 'why', sc.why) r
    from public.social_accounts sa
    join public.members m on m.id = sa.member_id and m.role = 'creator'
    left join lateral (select a.identity_id from intel.ci_identity_actor_access a
                        where a.member_id = sa.member_id and a.access_role = 'self' and a.revoked_at is null order by a.granted_at limit 1) acc on true
    left join intel.ci_creator_professional_profile pp on pp.identity_id = acc.identity_id
    left join private.creator_personal_profile per on per.identity_id = acc.identity_id
    left join intel.ci_creator_commercial_preference cp on cp.identity_id = acc.identity_id
    left join lateral (select a.city, a.state from private.creator_address a
                        where a.identity_id = acc.identity_id and a.deleted_at is null order by a.is_default desc, a.created_at limit 1) ad on true
    left join intel.ci_campaign_participation p on p.campaign_id = p_campaign and p.identity_id = acc.identity_id
    cross join lateral (select case when coalesce(sa.followers_count,0) > 0 and jsonb_array_length(coalesce(sa.recent_media,'[]'::jsonb)) > 0 then
             round(100.0 * (select avg(coalesce((m2->>'like_count')::numeric,0) + coalesce((m2->>'comments_count')::numeric,0))
                              from jsonb_array_elements(sa.recent_media) m2) / sa.followers_count, 2) end as eng) e
    cross join lateral (
      select (case when v_min is null or coalesce(sa.followers_count,0) >= v_min then 1 else 0 end
            + case when v_max is null or coalesce(sa.followers_count,0) <= v_max then 1 else 0 end
            + case when v_eng is null or coalesce(e.eng,0) >= v_eng then 1 else 0 end
            + case when v_gender is null or lower(coalesce(per.gender,'')) = v_gender then 1 else 0 end
            + case when v_locs is null or exists (select 1 from unnest(v_locs) l
                        where lower(coalesce(ad.city, pp.city_coarse, '')) like '%'||l||'%'
                           or lower(coalesce(ad.state, pp.state_coarse, '')) like '%'||l||'%') then 1 else 0 end
            + case when v_cats is null or exists (select 1 from unnest(v_cats) ct
                        where exists (select 1 from unnest(coalesce(pp.categories, array[]::text[])) pc where lower(pc) like '%'||ct||'%')
                           or lower(coalesce(sa.biography,'')) like '%'||ct||'%') then 1 else 0 end) * 100 / 6 as score,
             (select coalesce(jsonb_agg(w), '[]'::jsonb) from (
                select 'Followers ' || to_char(sa.followers_count, 'FM999,999,999') w where v_min is not null and coalesce(sa.followers_count,0) >= v_min
                union all select 'Engagement ' || e.eng || '%' where v_eng is not null and coalesce(e.eng,0) >= v_eng
                union all select 'In ' || coalesce(ad.city, pp.city_coarse) where v_locs is not null and exists (select 1 from unnest(v_locs) l
                        where lower(coalesce(ad.city, pp.city_coarse, '')) like '%'||l||'%' or lower(coalesce(ad.state, pp.state_coarse, '')) like '%'||l||'%')
                union all select 'Category match' where v_cats is not null and exists (select 1 from unnest(v_cats) ct
                        where exists (select 1 from unnest(coalesce(pp.categories, array[]::text[])) pc where lower(pc) like '%'||ct||'%'))
                union all select 'Open to barter' where cp.accepts_barter) q(w)) as why) sc
   where coalesce(m.status,'active') = 'active'
     and (v_min is null or coalesce(sa.followers_count,0) >= v_min)
     and (v_max is null or coalesce(sa.followers_count,0) <= v_max)
   order by sc.score desc, sa.followers_count desc nulls last
   limit greatest(coalesce(p_limit,60), 1)) s), '[]'::jsonb);
end $$;
revoke all on function api.campaign_matches(uuid, int) from public, anon;
grant execute on function api.campaign_matches(uuid, int) to authenticated;

-- ===================================================================================================
-- 3) Invite a creator who is already on the platform (in-app + WhatsApp + email, with accept / decline)
-- ===================================================================================================
update intel.ci_notification_template set
  title = 'You''re invited: {{campaign}} 🎯',
  body_md = '{{brand}} would like you on **{{campaign}}**.{{note_line}} Starts {{starts_on}}. Open My Campaigns to accept or pass — no obligation.',
  action_route = 'mycampaigns', action_label = 'Accept or pass'
 where template_key = 'invited';
insert into intel.ci_notification_template(template_key, kind, title, body_md, action_route, action_label) values
  ('invited','action_required','You''re invited: {{campaign}} 🎯',
   '{{brand}} would like you on **{{campaign}}**.{{note_line}} Starts {{starts_on}}. Open My Campaigns to accept or pass — no obligation.',
   'mycampaigns','Accept or pass')
on conflict (template_key) do nothing;

create or replace function api.invite_creator(p_campaign uuid, p_member uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_identity uuid; v_part uuid; v_stage text; v_name text; v_note text;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  p_campaign := intel.ci_resolve_campaign(p_campaign);
  if p_campaign is null then raise exception 'campaign not found — save it first' using errcode = '22023'; end if;
  if not intel.ci_can_manage_campaign(p_campaign) then raise exception 'not your campaign' using errcode = '42501'; end if;
  select a.identity_id into v_identity from intel.ci_identity_actor_access a
   where a.member_id = p_member and a.access_role = 'self' and a.revoked_at is null order by a.granted_at limit 1;
  if v_identity is null then raise exception 'this creator has not finished signing up yet' using errcode = '22023'; end if;
  v_note := nullif(btrim(coalesce(p_note,'')), '');

  select participation_id, stage into v_part, v_stage from intel.ci_campaign_participation
   where campaign_id = p_campaign and identity_id = v_identity;
  if v_part is not null then
    if v_stage <> 'invited' then return jsonb_build_object('already', v_stage, 'participation_id', v_part); end if;
  else
    insert into intel.ci_campaign_participation(campaign_id, identity_id, stage)
    values (p_campaign, v_identity, 'invited') returning participation_id into v_part;
  end if;

  select name into v_name from intel.ci_campaign where campaign_id = p_campaign;
  perform intel.ci_notify(p_member, p_campaign, v_part, 'invited',
    jsonb_build_object('campaign', coalesce(v_name, 'a campaign'),
                       'note_line', case when v_note is null then '' else ' “' || v_note || '”' end));
  return jsonb_build_object('participation_id', v_part, 'stage', 'invited');
end $$;
revoke all on function api.invite_creator(uuid, uuid, text) from public, anon;
grant execute on function api.invite_creator(uuid, uuid, text) to authenticated;

-- ===================================================================================================
-- 4) Invite someone who is NOT on the platform yet, by Instagram handle
--    The invite waits; when that handle signs up and connects Instagram it becomes a real invite.
-- ===================================================================================================
create table if not exists intel.ci_campaign_invite (
  invite_id    uuid primary key default gen_random_uuid(),
  campaign_id  uuid not null references intel.ci_campaign(campaign_id) on delete cascade,
  platform     text not null default 'instagram',
  handle       text not null check (handle ~ '^[A-Za-z0-9._]{1,60}$'),
  note         text,
  invited_by   uuid references auth.users(id) on delete set null,
  org_id       uuid,
  dm_status    text not null default 'pending' check (dm_status in ('pending','sent','needs_permission','failed','manual')),
  dm_error     text,
  dm_sent_at   timestamptz,
  claimed_by   uuid references auth.users(id) on delete set null,
  claimed_at   timestamptz,
  created_at   timestamptz not null default now(),
  constraint ci_campaign_invite_uq unique (campaign_id, platform, handle)
);
create index if not exists ci_campaign_invite_handle_idx on intel.ci_campaign_invite(lower(handle)) where claimed_at is null;
alter table intel.ci_campaign_invite enable row level security;
revoke all on intel.ci_campaign_invite from anon, authenticated;
grant select, insert, update, delete on intel.ci_campaign_invite to service_role;

create or replace function api.invite_external(p_campaign uuid, p_handle text, p_note text default null, p_platform text default 'instagram')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_handle text; v_id uuid; v_member uuid; v_org uuid;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  p_campaign := intel.ci_resolve_campaign(p_campaign);
  if p_campaign is null then raise exception 'campaign not found — save it first' using errcode = '22023'; end if;
  if not intel.ci_can_manage_campaign(p_campaign) then raise exception 'not your campaign' using errcode = '42501'; end if;
  v_handle := lower(regexp_replace(btrim(coalesce(p_handle,'')), '^@', ''));
  if v_handle !~ '^[a-z0-9._]{1,60}$' then raise exception 'enter a valid Instagram username' using errcode = '22023'; end if;

  -- already on the platform? invite them properly instead
  select sa.member_id into v_member from public.social_accounts sa
   where sa.platform = 'instagram' and lower(sa.username) = v_handle limit 1;
  if v_member is not null then return api.invite_creator(p_campaign, v_member, p_note) || jsonb_build_object('on_platform', true); end if;

  select org_id into v_org from public.members where id = auth.uid();
  insert into intel.ci_campaign_invite(campaign_id, platform, handle, note, invited_by, org_id)
  values (p_campaign, coalesce(nullif(p_platform,''),'instagram'), v_handle, nullif(btrim(coalesce(p_note,'')),''), auth.uid(), v_org)
  on conflict (campaign_id, platform, handle) do update set note = coalesce(excluded.note, intel.ci_campaign_invite.note)
  returning invite_id into v_id;
  return jsonb_build_object('invite_id', v_id, 'handle', v_handle, 'on_platform', false);
end $$;

create or replace function api.list_external_invites(p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  p_campaign := intel.ci_resolve_campaign(p_campaign);
  if p_campaign is null then return '[]'::jsonb; end if;
  if not intel.ci_can_manage_campaign(p_campaign) then raise exception 'not your campaign' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('invite_id', i.invite_id, 'handle', i.handle, 'platform', i.platform,
            'note', i.note, 'dm_status', i.dm_status, 'dm_error', i.dm_error, 'dm_sent_at', i.dm_sent_at,
            'claimed_at', i.claimed_at, 'created_at', i.created_at) order by i.created_at desc)
     from intel.ci_campaign_invite i where i.campaign_id = p_campaign), '[]'::jsonb);
end $$;

create or replace function api.delete_external_invite(p_invite uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_camp uuid;
begin
  select campaign_id into v_camp from intel.ci_campaign_invite where invite_id = p_invite;
  if v_camp is null or not intel.ci_can_manage_campaign(v_camp) then raise exception 'not your invite' using errcode = '42501'; end if;
  delete from intel.ci_campaign_invite where invite_id = p_invite and claimed_at is null;
end $$;

-- the Instagram DM worker claims pending invites and records what happened
create or replace function api.ops_invite_claim(p_limit int default 20)
returns setof jsonb language plpgsql security definer set search_path = '' as $$
begin
  return query
  with c as (select invite_id from intel.ci_campaign_invite
              where dm_status = 'pending' and claimed_at is null
              order by created_at limit greatest(p_limit,1) for update skip locked)
  update intel.ci_campaign_invite i set dm_status = 'manual'   -- claimed; the worker sets the final status
    from c where i.invite_id = c.invite_id
  returning to_jsonb(i.*) || jsonb_build_object(
    'campaign_name', (select name from intel.ci_campaign x where x.campaign_id = i.campaign_id),
    'brand', (select coalesce(submitted_brand_name, name) from intel.ci_campaign x where x.campaign_id = i.campaign_id),
    'inviter_member_id', i.invited_by);
end $$;
create or replace function api.ops_invite_complete(p_invite uuid, p_status text, p_error text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('sent','needs_permission','failed','manual') then raise exception 'bad status' using errcode = '22023'; end if;
  update intel.ci_campaign_invite set dm_status = p_status, dm_error = left(p_error, 300),
         dm_sent_at = case when p_status = 'sent' then now() else dm_sent_at end
   where invite_id = p_invite;
end $$;
revoke all on function api.invite_external(uuid, text, text, text) from public, anon;
revoke all on function api.list_external_invites(uuid) from public, anon;
revoke all on function api.delete_external_invite(uuid) from public, anon;
revoke all on function api.ops_invite_claim(int) from public, anon, authenticated;
revoke all on function api.ops_invite_complete(uuid, text, text) from public, anon, authenticated;
grant execute on function api.invite_external(uuid, text, text, text), api.list_external_invites(uuid), api.delete_external_invite(uuid) to authenticated;
grant execute on function api.ops_invite_claim(int), api.ops_invite_complete(uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------------------------------
-- When an invited handle signs up and connects Instagram, every invite waiting for them turns into a
-- real campaign invite and they are notified — so the first thing they see is the campaign they were asked for.
-- ---------------------------------------------------------------------------------------------------
create or replace function intel.ci_claim_invites(p_member uuid, p_username text)
returns int language plpgsql security definer set search_path = '' as $$
declare r record; v_identity uuid; v_part uuid; v_n int := 0; v_name text;
begin
  if p_member is null or coalesce(btrim(p_username),'') = '' then return 0; end if;
  select a.identity_id into v_identity from intel.ci_identity_actor_access a
   where a.member_id = p_member and a.access_role = 'self' and a.revoked_at is null order by a.granted_at limit 1;
  if v_identity is null then return 0; end if;
  for r in select * from intel.ci_campaign_invite
            where claimed_at is null and platform = 'instagram' and lower(handle) = lower(btrim(p_username)) loop
    begin
      select participation_id into v_part from intel.ci_campaign_participation
       where campaign_id = r.campaign_id and identity_id = v_identity;
      if v_part is null then
        insert into intel.ci_campaign_participation(campaign_id, identity_id, stage)
        values (r.campaign_id, v_identity, 'invited') returning participation_id into v_part;
      end if;
      update intel.ci_campaign_invite set claimed_by = p_member, claimed_at = now() where invite_id = r.invite_id;
      select name into v_name from intel.ci_campaign where campaign_id = r.campaign_id;
      perform intel.ci_notify(p_member, r.campaign_id, v_part, 'invited',
        jsonb_build_object('campaign', coalesce(v_name,'a campaign'),
                           'note_line', case when r.note is null then '' else ' “' || r.note || '”' end));
      v_n := v_n + 1;
    exception when others then raise warning 'invite claim skipped: %', sqlerrm;
    end;
  end loop;
  return v_n;
end $$;
revoke all on function intel.ci_claim_invites(uuid, text) from public, anon, authenticated;

create or replace function intel.tg_claim_invites_on_ig()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if NEW.platform = 'instagram' and NEW.member_id is not null and coalesce(NEW.username,'') <> ''
     and (TG_OP = 'INSERT' or NEW.username is distinct from OLD.username) then
    perform intel.ci_claim_invites(NEW.member_id, NEW.username);
  end if;
  return NEW;
exception when others then return NEW;          -- never block an Instagram connect
end $$;
revoke all on function intel.tg_claim_invites_on_ig() from public, anon, authenticated;
drop trigger if exists ci_claim_invites_on_ig on public.social_accounts;
create trigger ci_claim_invites_on_ig after insert or update of username on public.social_accounts
  for each row execute function intel.tg_claim_invites_on_ig();

-- a creator can see (and the app can show) how many invites are waiting
create or replace function api.my_invite_count()
returns int language sql stable security definer set search_path = '' as $$
  select count(*)::int from intel.ci_campaign_participation p
   where p.identity_id = intel.ci_caller_identity() and p.stage = 'invited' $$;
revoke all on function api.my_invite_count() from public, anon;
grant execute on function api.my_invite_count() to authenticated;
