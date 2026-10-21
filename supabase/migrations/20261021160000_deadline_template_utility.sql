-- Deadline reminder: Meta put geek_step_deadline in MARKETING (urgency wording "end date is close").
-- Switch the deadline reminder to a new plain step-update template geek_step_pending, written the same
-- way as the approved UTILITY step templates. geek_step_deadline is no longer used.

insert into intel.ci_step_wa(template_key, wa_template, body, update_text) values
('deadline_reminder', 'geek_step_pending', 'Hi *{{1}}*,

Thank you for being part of the campaign *{{2}}* with *{{3}}*. This is a reminder that one of your campaign steps is still pending.

Next, please complete the pending step on the app. Once that is done, we will update your campaign status.

Complete your step here: {{4}}

Thank you!
Team Geek Animals', null)
on conflict (template_key) do update set wa_template = excluded.wa_template, body = excluded.body, update_text = excluded.update_text;

insert into private.ci_step_wa_status(wa_template, status) values ('geek_step_pending', 'queued')
on conflict (wa_template) do nothing;

-- the old one is not used by any step any more: drop it from the Super Admin list
delete from private.ci_step_wa_status s
 where s.wa_template = 'geek_step_deadline'
   and not exists (select 1 from intel.ci_step_wa w where w.wa_template = s.wa_template);
