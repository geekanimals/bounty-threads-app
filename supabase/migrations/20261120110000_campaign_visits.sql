-- Physical visit: each creator's booking (date + slot) and whether they visited.
-- Kept beside the stage (no new stage values): Contract signed → Visit booked → Visited → video.
create table if not exists intel.ci_visit (
  visit_id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references intel.ci_campaign(campaign_id) on delete cascade,
  invite_id uuid unique,
  participation_id uuid unique,
  visit_on date,
  slot text,
  note text,
  booked_at timestamptz not null default now(),
  visited_at timestamptz,
  missed_at timestamptz,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  constraint ci_visit_who_ck check (invite_id is not null or participation_id is not null)
);
alter table intel.ci_visit enable row level security;
revoke all on intel.ci_visit from anon, authenticated;

-- When an invited creator joins, carry their booking over to the participation
create or replace function private.ci_visit_link(p_campaign uuid)
returns void language sql security definer set search_path to '' as $f$
  update intel.ci_visit v set participation_id = i.participation_id, updated_at = now()
    from intel.ci_campaign_invite i
   where v.campaign_id = p_campaign and v.invite_id = i.invite_id
     and v.participation_id is null and i.participation_id is not null
     and not exists (select 1 from intel.ci_visit z where z.participation_id = i.participation_id);
$f$;

create or replace function api.visit_list(p_campaign uuid)
returns jsonb language plpgsql security definer set search_path to '' as $f$
declare c uuid := intel.ci_resolve_campaign(p_campaign);
begin
  if c is null or not intel.ci_can_operate_campaign(c) then raise exception 'not your campaign' using errcode = '42501'; end if;
  perform private.ci_visit_link(c);
  return coalesce((select jsonb_agg(jsonb_build_object(
      'invite_id', v.invite_id, 'participation_id', v.participation_id, 'visit_on', v.visit_on, 'slot', v.slot,
      'note', v.note, 'visited_at', v.visited_at, 'missed_at', v.missed_at))
    from intel.ci_visit v where v.campaign_id = c), '[]'::jsonb);
end $f$;

-- p_state: 'booked' (set / change date + slot), 'visited', 'missed' (needs a new date), 'clear'
create or replace function api.visit_set(p_campaign uuid, p_invite uuid default null, p_participation uuid default null,
  p_state text default 'booked', p_on date default null, p_slot text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path to '' as $f$
declare c uuid := intel.ci_resolve_campaign(p_campaign); v intel.ci_visit;
begin
  if c is null or not intel.ci_can_operate_campaign(c) then raise exception 'not your campaign' using errcode = '42501'; end if;
  if p_invite is null and p_participation is null then raise exception 'pick a creator' using errcode = '22023'; end if;
  if p_participation is not null and not exists (select 1 from intel.ci_campaign_participation where participation_id = p_participation and campaign_id = c)
     then raise exception 'creator not in this campaign' using errcode = '22023'; end if;
  if p_invite is not null and not exists (select 1 from intel.ci_campaign_invite where invite_id = p_invite and campaign_id = c)
     then raise exception 'invite not in this campaign' using errcode = '22023'; end if;
  perform private.ci_visit_link(c);
  select * into v from intel.ci_visit where (p_participation is not null and participation_id = p_participation) or (p_invite is not null and invite_id = p_invite) limit 1;
  if p_state = 'clear' then
    delete from intel.ci_visit where visit_id = v.visit_id; return jsonb_build_object('ok', true, 'state', 'clear');
  end if;
  if v.visit_id is null then
    insert into intel.ci_visit(campaign_id, invite_id, participation_id) values (c, p_invite, p_participation) returning * into v;
  end if;
  update intel.ci_visit set
    visit_on   = case when p_state = 'booked' then coalesce(p_on, visit_on) else visit_on end,
    slot       = case when p_state = 'booked' then coalesce(nullif(btrim(p_slot), ''), slot) else slot end,
    note       = coalesce(nullif(btrim(p_note), ''), note),
    visited_at = case when p_state = 'visited' then now() when p_state in ('booked', 'missed') then null else visited_at end,
    missed_at  = case when p_state = 'missed' then now() when p_state in ('booked', 'visited') then null else missed_at end,
    participation_id = coalesce(participation_id, p_participation),
    updated_by = auth.uid(), updated_at = now()
  where visit_id = v.visit_id returning * into v;
  return jsonb_build_object('ok', true, 'state', p_state, 'visit_on', v.visit_on, 'slot', v.slot, 'visited_at', v.visited_at);
end $f$;

-- Creator: their own bookings (for the tracker)
create or replace function api.my_visits()
returns jsonb language sql stable security definer set search_path to '' as $f$
  select coalesce(jsonb_object_agg(v.participation_id, jsonb_build_object('visit_on', v.visit_on, 'slot', v.slot, 'visited_at', v.visited_at, 'missed_at', v.missed_at)), '{}'::jsonb)
    from intel.ci_visit v join intel.ci_campaign_participation p on p.participation_id = v.participation_id
   where p.identity_id = intel.ci_caller_identity();
$f$;

grant execute on function api.visit_list(uuid), api.visit_set(uuid, uuid, uuid, text, date, text, text), api.my_visits() to authenticated;
