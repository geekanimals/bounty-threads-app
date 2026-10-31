-- ⏸ Automatic messages OFF (Super Admin): every automatic WhatsApp + email to creators stops — step updates, invites,
-- reminders, nudges — while the setup stays exactly as it is. Still goes:
--   * login / OTP / recovery codes
--   * messages to the team (alerts, payment due …)
--   * what the team sends by hand: the WhatsApp panel / 💬 chat (wa-send) and "↻ Resend invite" pressed by a team member
-- A step changed by the team does NOT send its message while this is OFF (that is automatic). Turn it back ON to resume;
-- what was stopped meanwhile is not sent later (send it by hand from the panel).
alter table public.messaging_switches add column if not exists auto_on boolean not null default true;

create or replace function private.outbox_auto_pause() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'queued' and new.channel in ('whatsapp', 'email')
     and not coalesce((select s.auto_on from public.messaging_switches s), true)
     and coalesce(new.template_key, '') !~* 'otp|login|recovery|password'
     and not private.ci_is_team(new.recipient_member_id)
     and not (private.ci_is_team(auth.uid()) and coalesce(current_setting('geek.invite_resend', true), '') = 'on') then
    new.status := 'skipped';
    new.last_error := 'paused: automatic messages are off (send it by hand from the panel)';
  end if;
  return new;
end $$;
revoke all on function private.outbox_auto_pause() from public, anon, authenticated;
drop trigger if exists outbox_auto_pause on intel.ci_outbox;
create trigger outbox_auto_pause before insert or update of status on intel.ci_outbox
  for each row execute function private.outbox_auto_pause();

-- Super Admin switch (+ stops whatever is already waiting in the queue)
create or replace function api.ops_set_auto_messages(p_on boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_n int := 0;
begin
  if not exists (select 1 from public.platform_admins a where a.user_id = auth.uid()) then
    raise exception 'Super Admin only' using errcode = '42501';
  end if;
  update public.messaging_switches set auto_on = p_on;
  if not p_on then
    update intel.ci_outbox o set status = 'skipped', last_error = 'paused: automatic messages are off (send it by hand from the panel)'
     where o.status = 'queued' and o.channel in ('whatsapp','email')
       and coalesce(o.template_key, '') !~* 'otp|login|recovery|password'
       and not private.ci_is_team(o.recipient_member_id);
    get diagnostics v_n = row_count;
  end if;
  return jsonb_build_object('auto_on', p_on, 'stopped_now', v_n);
end $$;
revoke all on function api.ops_set_auto_messages(boolean) from public, anon;
grant execute on function api.ops_set_auto_messages(boolean) to authenticated;

create or replace function api.ops_auto_messages()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('auto_on', coalesce((select s.auto_on from public.messaging_switches s), true)) $$;
revoke all on function api.ops_auto_messages() from public, anon;
grant execute on function api.ops_auto_messages() to authenticated;

-- ⏸ turn it OFF now (31 Oct 2026, 17:30 IST — asked by the Super Admin)
update public.messaging_switches set auto_on = false;
update intel.ci_outbox o set status = 'skipped', last_error = 'paused: automatic messages are off (send it by hand from the panel)'
 where o.status = 'queued' and o.channel in ('whatsapp','email')
   and coalesce(o.template_key, '') !~* 'otp|login|recovery|password'
   and not private.ci_is_team(o.recipient_member_id);
select (select auto_on from public.messaging_switches) auto_on,
       (select count(*) from intel.ci_outbox where status='skipped' and last_error like 'paused: automatic%') stopped,
       (select count(*) from intel.ci_outbox where status in ('queued','sending')) still_queued;
