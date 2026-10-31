-- Invite with the how-to-register video: new UTILITY template geek_invite_register_guide (same 4 variables as
-- geek_campaign_access: name · campaign · brand · link). Every invite (bulk upload, resend, reminders, one-by-one)
-- goes on it once Meta approves it; until then on geek_campaign_access as before. ADDITIVE.
-- + Meta approved geek_step_brief_code (31 Oct 2026).

insert into intel.ci_step_wa(template_key, wa_template, body, update_text) values
('invited_guide', 'geek_invite_register_guide', 'Hi *{{1}}*,

Thank you for applying for the campaign *{{2}}* with *{{3}}*. This is an update on your application: your profile has been approved.

Next, please register on the app and continue the whole process there. Once that is done, we will update your campaign status.

Register here: {{4}}

New to the app? Watch this short guide on how to register: https://www.youtube.com/watch?v=PYpBru7LUvc

Thank you!
Team Geek Animals', null)
on conflict (template_key) do update set wa_template = excluded.wa_template, body = excluded.body;
insert into private.ci_step_wa_status(wa_template, status, error)
values ('geek_invite_register_guide', 'submitted', 'created in snapto (Utility) on 31 Oct 2026 — waiting for Meta review')
on conflict (wa_template) do nothing;
update private.ci_step_wa_status set status = 'approved', error = null, updated_at = now() where wa_template = 'geek_step_brief_code';

-- the invite template to use now
create or replace function intel.ci_invite_template()
returns text language sql stable security definer set search_path = '' as $$
  select case when exists (select 1 from private.ci_step_wa_status s where s.wa_template = 'geek_invite_register_guide' and s.status = 'approved')
              then 'geek_invite_register_guide' else 'geek_campaign_access' end $$;
revoke all on function intel.ci_invite_template() from public, anon, authenticated;

do $$ declare f text; d text; n text; begin
  foreach f in array array['intel.ci_send_bulk_invite(uuid)', 'intel.ci_notify(uuid,uuid,uuid,text,jsonb)'] loop
    d := pg_get_functiondef(f::regprocedure);
    if position('ci_invite_template()' in d) > 0 then raise notice '% already uses ci_invite_template', f; continue; end if;
    n := replace(d, $a$'wa_template', 'geek_campaign_access'$a$, $a$'wa_template', intel.ci_invite_template()$a$);
    if n = d then raise exception '% has no geek_campaign_access to switch', f; end if;
    execute n;
  end loop;
end $$;
