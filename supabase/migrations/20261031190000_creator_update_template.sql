-- ✍️ Typed WhatsApp messages (panel "My own message" + 💬 chat) outside the 24-hour window now go inside the creator
-- Utility template "geek_creator_update" (snapto, 31 Oct 2026):
--   Hi *{{1}}*, This is an update on your application for the campaign *{{2}}*: {{3}}  … Open the app here: {{4}}
-- Until Meta approves it, wa-send keeps using geek_team_update. Flip the status below to 'approved' once it is.
-- Also: the invite with the how-to-register video (geek_invite_register_guide) is APPROVED in snapto → invites use it now.
insert into private.ci_step_wa_status(wa_template, status, error) values
  ('geek_creator_update', 'submitted', 'created in snapto (Utility) on 31 Oct 2026 — waiting for Meta review')
on conflict (wa_template) do update set status = excluded.status, error = excluded.error, updated_at = now();

update private.ci_step_wa_status set status = 'approved', error = null, updated_at = now()
 where wa_template = 'geek_invite_register_guide';

-- wa-send (service role) reads a template's status without exposing the private table
create or replace function api.wa_template_status(p_name text)
returns text language sql stable security definer set search_path = '' as $$
  select s.status from private.ci_step_wa_status s where s.wa_template = p_name
$$;
revoke all on function api.wa_template_status(text) from public, anon, authenticated;
grant execute on function api.wa_template_status(text) to service_role;
