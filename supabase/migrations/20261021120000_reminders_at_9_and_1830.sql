-- Every reminder to a creator goes at 9:00 or 18:30 (India time) — never at random hours.
--   • video reminders, "complete your steps" (campaign end date), invite reminders, "restore your post" (ad rights):
--     all sent in the 9:00 and 18:30 runs;
--   • any reminder scheduled anywhere for another time is moved to the next 9:00 / 18:30 on its own.
-- Step updates (contract sent, product shipped, video approved …) still go the moment they happen — they are not reminders.
-- ADDITIVE: one trigger, one function, cron times changed.

-- the next 9:00 or 18:30 IST at or after a moment
create or replace function intel.ci_next_slot(p_at timestamptz)
returns timestamptz language sql immutable set search_path = '' as $$
  with d as (select (p_at at time zone 'Asia/Kolkata')::date as day)
  select min(t) from d, lateral (values ((d.day + time '09:00') at time zone 'Asia/Kolkata'), ((d.day + time '18:30') at time zone 'Asia/Kolkata'),
                                        ((d.day + 1 + time '09:00') at time zone 'Asia/Kolkata')) v(t)
   where t >= p_at - interval '1 minute' $$;

create or replace function intel.tg_reminder_slot()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.due_at is not null then new.due_at := intel.ci_next_slot(new.due_at); end if;
  return new;
end $$;
drop trigger if exists ci_reminder_slot on intel.ci_reminder;
create trigger ci_reminder_slot before insert or update of due_at on intel.ci_reminder
  for each row execute function intel.tg_reminder_slot();
-- reminders already waiting: onto the slots too
update intel.ci_reminder set due_at = due_at where fired_at is null and cancelled_at is null;

-- "please restore your post / reel" — at 9:00 and 18:30 while it is missing (and the ad-rights months are running)
create or replace function intel.ci_run_restore_reminders()
returns int language plpgsql security definer set search_path = '' as $$
declare r record; v_n int := 0; v_until timestamptz;
begin
  if not intel.ci_feature_enabled('operational_pilot') then return 0; end if;
  for r in select po.post_id, po.participation_id, po.campaign_id, po.media_type, po.permalink, p.identity_id, c.name
             from intel.ci_campaign_post po
             join intel.ci_campaign_participation p on p.participation_id = po.participation_id
             join intel.ci_campaign c on c.campaign_id = po.campaign_id
            where po.missing_since is not null and po.media_type <> 'story'
              and (po.restore_reminded_at is null or po.restore_reminded_at < now() - interval '6 hours') loop
    v_until := intel.ci_post_live_until(r.post_id);
    continue when now() >= v_until;
    begin
      perform intel.ci_notify(intel.ci_member_of_identity(r.identity_id), r.campaign_id, r.participation_id, 'post_restore',
        jsonb_build_object('campaign', coalesce(r.name, 'your campaign'), 'kind', r.media_type, 'link', coalesce(r.permalink, ''),
                           'until', to_char(v_until at time zone 'Asia/Kolkata', 'DD Mon YYYY')));
      update intel.ci_campaign_post set restore_reminded_at = now(), restore_reminders = restore_reminders + 1 where post_id = r.post_id;
      v_n := v_n + 1;
    exception when others then raise warning 'restore reminder skipped: %', sqlerrm;
    end;
  end loop;
  return v_n;
end $$;
revoke all on function intel.ci_run_restore_reminders() from public, anon, authenticated;

-- the 9:00 + 18:30 runs (UTC 03:30 + 13:00): deadline, invites, restore — and the video reminders the 10-minute runner sends
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('ci-invite-reminders',    '30 3 * * *', $c$select intel.ci_run_invite_reminders()$c$);
    perform cron.schedule('ci-invite-reminders-pm', '0 13 * * *', $c$select intel.ci_run_invite_reminders()$c$);
    perform cron.schedule('ci-restore-am', '31 3 * * *', $c$select intel.ci_run_restore_reminders()$c$);
    perform cron.schedule('ci-restore-pm', '1 13 * * *', $c$select intel.ci_run_restore_reminders()$c$);
  end if;
exception when others then raise notice 'cron schedule skipped: %', sqlerrm;
end $$;
