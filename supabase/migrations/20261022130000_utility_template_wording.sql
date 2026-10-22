-- Two new WhatsApp templates rewritten in the same shape as the step templates Meta already approved as UTILITY
-- (plain status update + next step + link, no urgency or promotional wording):
--   geek_step_video_final : campaign ended, product received, no video yet → blocklist warning
--   geek_join_invite      : creator uploaded by the team → finish registration
-- Also: after the campaign ends the blocklist warning goes at most 3 times (once each morning), not twice a day.

insert into intel.ci_step_wa(template_key, wa_template, body, update_text) values
('video_blacklist_warning', 'geek_step_video_final', 'Hi *{{1}}*,

Thank you for being part of the campaign *{{2}}* with *{{3}}*. This is an update on your campaign status: the campaign has ended and your video has not been received yet.

As per the contract you signed, if the video is not submitted, your account will be added to the blocklist.

Next, please submit your video on the app. Once that is done, we will update your campaign status.

Submit your video here: {{4}}

Thank you!
Team Geek Animals', null),
('join_invite', 'geek_join_invite', 'Hi *{{1}}*,

Thank you for your interest in working with *{{2}}*. This is an update on your creator registration: your details have been added to our creator list.

Next, please complete your registration on the app with this WhatsApp number and connect your Instagram. Once that is done, we will update your account status.

Complete your registration here: {{3}}

Thank you!
Team Geek Animals', null)
on conflict (template_key) do update set wa_template = excluded.wa_template, body = excluded.body;

update intel.ci_notification_template
   set title = '{{campaign}} has ended — your video is pending',
       body_md = 'The campaign **{{campaign}}** has ended and your video has not been received yet. As per the contract you signed, if the video is not submitted, your account will be added to the blocklist. Please submit your video on the app.'
 where template_key = 'video_blacklist_warning';

create or replace function intel.ci_run_video_reminders()
returns int language plpgsql security definer set search_path = '' as $$
declare r record; v_slot timestamptz; v_today date := (now() at time zone 'Asia/Kolkata')::date; v_key text; v_n int := 0;
        v_final_ok boolean; v_morning boolean;
begin
  if not intel.ci_feature_enabled('operational_pilot') then return 0; end if;
  v_slot := date_trunc('hour', now()) + case when extract(minute from now()) >= 30 then interval '30 minutes' else interval '0' end;
  v_morning := coalesce(nullif(current_setting('ci.morning_slot', true), '')::boolean,
                       extract(hour from (now() at time zone 'Asia/Kolkata')) < 12);
  v_final_ok := exists (select 1 from private.ci_step_wa_status s where s.wa_template = 'geek_step_video_final' and s.status = 'approved');
  for r in
    select p.participation_id, p.campaign_id, p.stage, intel.ci_member_of_identity(p.identity_id) as member, c.name, c.ends_on,
           coalesce((select min(d.expected_by) from intel.ci_campaign_deliverable d where d.participation_id = p.participation_id),
                    ((coalesce(sh.delivered_at, sh.shipped_at + interval '3 days') at time zone 'Asia/Kolkata')::date
                      + coalesce((select k.content_days from intel.ci_campaign_contract k where k.participation_id = p.participation_id), 7))) as due_on
      from intel.ci_campaign_participation p
      join intel.ci_campaign c on c.campaign_id = p.campaign_id
      left join lateral (select s.status, s.shipped_at, s.delivered_at from intel.ci_campaign_shipment s
                          where s.participation_id = p.participation_id order by s.created_at desc limit 1) sh on true
     where p.blocked_at is null
       and c.lifecycle_status <> 'cancelled'
       and (c.ends_on is null or c.ends_on >= v_today - 30)
       and (p.stage in ('content_created','changes_requested')
            or (p.stage = 'product_sent' and (sh.status = 'delivered' or sh.shipped_at < now() - interval '3 days')))
       and not exists (select 1 from intel.ci_creator_blacklist b where b.identity_id = p.identity_id and b.lifted_at is null)
  loop
    continue when r.member is null;
    if r.ends_on is not null and r.ends_on < v_today then
      -- campaign over: blocklist warning, once each morning, 3 times at most
      continue when not v_morning;
      continue when (select count(*) from private.ci_video_nudge n where n.participation_id = r.participation_id
                      and n.template_key in ('video_blacklist_warning') ) >= 3;
      v_key := case when v_final_ok then 'video_blacklist_warning' else 'video_warning' end;
    else
      v_key := case
        when r.due_on is not null and r.due_on < v_today then 'video_warning'
        when r.due_on is not null and r.due_on <= v_today + 1 then 'video_final_warning'
        when r.due_on is not null and r.due_on <= v_today + 2 then 'video_due'
        else 'video_nudge' end;
    end if;
    begin
      insert into private.ci_video_nudge(participation_id, slot_at, template_key) values (r.participation_id, v_slot, v_key);
    exception when unique_violation then continue; end;
    begin
      perform intel.ci_notify(r.member, r.campaign_id, r.participation_id, v_key,
        jsonb_build_object('campaign', coalesce(r.name, 'your campaign'), 'participation_id', r.participation_id::text,
                           'due', coalesce(to_char(r.due_on, 'DD Mon'), '')));
      insert into intel.ci_reminder(participation_id, campaign_id, kind, template_key, due_at, fired_at)
      values (r.participation_id, r.campaign_id, 'video_slot', v_key, now(), now());
      v_n := v_n + 1;
    exception when others then raise warning 'video reminder skipped: %', sqlerrm; end;
  end loop;
  return v_n;
end $$;
revoke all on function intel.ci_run_video_reminders() from public, anon, authenticated;
