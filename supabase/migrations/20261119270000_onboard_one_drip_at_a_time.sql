-- New creator onboarding: one WhatsApp drip at a time.
--  1. Creator verifies their WhatsApp number (signs up)  -> nothing is sent; a check is planned for 1 hour later.
--  2. After 1 hour: Instagram not connected -> start drip 04 (Instagram connect) only.
--                   Instagram connected but profile not 100% -> start drip 02 (Profile complete).
--                   Both done -> nothing.
--  3. Drip 04 running: once Instagram is connected, or the drip has finished (96 h), and the profile is still
--     not 100% -> start drip 02. Drips 02 and 04 never start together.
create table if not exists private.creator_onboard_check (
  member_id  uuid primary key,
  stage      text not null default 'first',      -- first | ig | done
  due_at     timestamptz not null,
  created_at timestamptz not null default now(),
  done_at    timestamptz,
  note       text
);
create index if not exists creator_onboard_check_due_idx on private.creator_onboard_check (due_at) where done_at is null;

create or replace function private.tg_snapto_new_creator()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare v_role text;
begin
  if NEW.verified_at is null then return null; end if;
  if TG_OP = 'UPDATE' and OLD.verified_at is not null then return null; end if;
  select role into v_role from public.members where id = NEW.user_id;
  if coalesce(v_role, 'creator') <> 'creator' then return null; end if;
  -- no drip now: check again in 1 hour (private.ci_onboard_sweep)
  insert into private.creator_onboard_check (member_id, stage, due_at)
  values (NEW.user_id, 'first', now() + interval '1 hour')
  on conflict (member_id) do nothing;
  return null;
end $function$;

create or replace function private.ci_onboard_sweep()
returns int language plpgsql security definer set search_path = '' as $function$
declare r record; v_ig boolean; v_prof boolean; v_name text; v_n int := 0;
begin
  -- Instagram connected while drip 04 runs -> handle now
  update private.creator_onboard_check c set due_at = now()
   where c.done_at is null and c.stage = 'ig' and c.due_at > now()
     and exists (select 1 from public.social_accounts s where s.member_id = c.member_id and s.platform = 'instagram' and s.ig_user_id is not null);

  for r in select * from private.creator_onboard_check where done_at is null and due_at <= now() order by due_at limit 200 for update skip locked loop
    v_ig := exists (select 1 from public.social_accounts s where s.member_id = r.member_id and s.platform = 'instagram' and s.ig_user_id is not null);
    v_prof := coalesce((select pc.completion_pct from intel.ci_profile_completion pc where pc.identity_id = intel.ci_member_identity(r.member_id)), 0) >= 100;
    v_name := private.snapto_first_name(r.member_id);
    if r.stage = 'first' and not v_ig then
      perform private.snapto_enqueue('start', '04', r.member_id, jsonb_build_object('creator_name', v_name), 'start:04:' || r.member_id);
      update private.creator_onboard_check set stage = 'ig', due_at = now() + interval '96 hours', note = 'instagram drip started' where member_id = r.member_id;
    elsif not v_prof then
      perform private.snapto_enqueue('start', '02', r.member_id, jsonb_build_object('creator_name', v_name), 'start:02:' || r.member_id);
      update private.creator_onboard_check set stage = 'done', done_at = now(), note = 'profile drip started' where member_id = r.member_id;
    else
      update private.creator_onboard_check set stage = 'done', done_at = now(), note = 'nothing needed' where member_id = r.member_id;
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $function$;

select cron.schedule('ci-onboard-sweep', '*/10 * * * *', $$select private.ci_onboard_sweep()$$);
