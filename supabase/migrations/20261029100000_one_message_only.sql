-- 📵 One message, once. Every creator gets each message ONE time — the invite once, each step's update once.
--   * no automatic repeats: invite reminders, "join the campaign" reminders, video-deadline reminders, "campaign
--     ends soon" and the SLA reminder runners are all switched off;
--   * the one reminder that stays: "please restore your post" (a creator deleted a post that must stay up) — it keeps
--     going at 9:00 and 18:30 until the post is back;
--   * a message that already went to a creator for this campaign is not sent again by the system (it is kept in the
--     log as "skipped — already sent once");
--   * to send it again, someone on the team presses Resend in the panel (Super Admin / agency / brand) — a person on
--     the team doing it by hand is always allowed.
--   Messages to the team (alerts, payment due) and login / OTP codes are not touched.
-- ADDITIVE: one trigger + cron jobs removed. Turning a reminder back on later = schedule its job again.

-- 1) no automatic repeats
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job
     where jobname in ('ci-invite-reminders','ci-invite-reminders-pm','ci-join-reminders',
                       'ci-deadline-am','ci-deadline-pm','ci-video-am','ci-video-pm',
                       'ci-reminders','ci-reminders-sql');
  end if;
exception when others then raise warning 'reminder crons not removed: %', sqlerrm; end $$;

-- reminders already waiting are cancelled (nothing fires them any more)
update intel.ci_reminder set cancelled_at = now() where fired_at is null and cancelled_at is null;

-- 2) the same message never goes to the same creator twice (unless the team re-sends it by hand)
create or replace function private.ci_msg_group(p_key text)
returns text language sql immutable set search_path = '' as $$
  -- every kind of campaign invite is one message
  select case when p_key in ('bulk_invite','invited','bulk_invited') then 'invite' else p_key end $$;

create or replace function private.ci_is_team(p_uid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_uid is not null and (
    exists (select 1 from public.platform_admins a where a.user_id = p_uid)
    or exists (select 1 from public.members m where m.id = p_uid and m.role in ('owner','brand','manager','corporate','agency'))) $$;
revoke all on function private.ci_is_team(uuid) from public, anon, authenticated;

create or replace function private.tg_outbox_once()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.campaign_id is null or new.template_key is null or new.status <> 'queued' then return new; end if;
  -- "please restore your post" keeps going until the post is back
  if new.template_key like 'post_restore%' then return new; end if;
  -- messages to the team are not limited
  if private.ci_is_team(new.recipient_member_id) then return new; end if;
  -- someone on the team pressing Resend / changing a step by hand may send it again
  if private.ci_is_team(auth.uid()) then return new; end if;
  if exists (select 1 from intel.ci_outbox o
              where o.channel = new.channel and o.campaign_id = new.campaign_id
                and private.ci_msg_group(o.template_key) = private.ci_msg_group(new.template_key)
                and o.status in ('queued','sending','sent')
                and (o.to_address = new.to_address
                     or (new.recipient_member_id is not null and o.recipient_member_id = new.recipient_member_id))) then
    new.status := 'skipped';
    new.last_error := 'already sent once — press Resend in the panel to send it again';
  end if;
  return new;
end $$;
revoke all on function private.tg_outbox_once() from public, anon, authenticated;

drop trigger if exists ci_outbox_once on intel.ci_outbox;
create trigger ci_outbox_once before insert on intel.ci_outbox
  for each row execute function private.tg_outbox_once();
