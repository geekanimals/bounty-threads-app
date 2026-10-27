-- 📨 Creator upload invites stay on Utility WhatsApp templates. ADDITIVE.
-- Meta approved geek_explore_invite / geek_explore_invite_ns only as MARKETING (and rejected a Utility
-- "profile setup" version), so they are not used. Instead:
--   * plain invite                 → geek_join_invite (Utility, approved): "your details have been added … complete your
--                                    registration here: <link>" — the link opens the live campaigns page
--   * "not selected for <campaign>" → geek_application_not_selected (Utility, submitted in snapto 27 Oct 2026); until
--                                    Meta approves it, the plain invite goes
-- The email keeps the full text (explore live campaigns, not selected for …). The upload page shows the exact words.
create or replace function intel.ci_explore_invite_text(p_first text, p_from text, p_campaign text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_ns_live boolean; v_tpl text; v_vars jsonb; v_wa text; v_mail text; v_subj text; v_want text;
begin
  v_ns_live := coalesce((select s.status from private.ci_step_wa_status s where s.wa_template = 'geek_application_not_selected'), 'draft') = 'approved';
  if p_campaign is not null and v_ns_live then
    v_tpl := 'geek_application_not_selected'; v_vars := jsonb_build_array(p_first, p_campaign, 'LINK');
    v_wa := 'Hi *' || p_first || '*,' || E'\n\n' || 'This is an update on your application for the campaign *' || p_campaign || '*: you were not selected for this campaign.' || E'\n\n'
         || 'Your Geek OS creator account stays active. You can sign in with this WhatsApp number to see the status of all your applications.' || E'\n\n'
         || 'View your applications: {{link}}' || E'\n\n' || 'Team Geek Animals';
  else
    v_tpl := 'geek_join_invite'; v_vars := jsonb_build_array(p_first, p_from, 'LINK');
    v_wa := 'Hi *' || p_first || '*,' || E'\n\n' || 'Thank you for your interest in working with *' || p_from || '*. This is an update on your creator registration: your details have been added to our creator list.' || E'\n\n'
         || 'Next, please complete your registration on the app with this WhatsApp number and connect your Instagram. Once that is done, we will update your account status.' || E'\n\n'
         || 'Complete your registration here: {{link}}' || E'\n\n' || 'Thank you!' || E'\n' || 'Team Geek Animals';
  end if;
  v_want := case when p_campaign is not null then 'geek_application_not_selected' else 'geek_join_invite' end;
  if p_campaign is not null then
    v_subj := 'Update on ' || p_campaign || ' — explore more campaigns on Geek OS';
    v_mail := 'Hi ' || p_first || ',' || E'\n\n' || 'Thank you for your interest in the campaign ' || p_campaign || '. This is an update on your application: you were not selected for this campaign.' || E'\n\n'
           || 'You are invited to join Geek OS, where you can explore other live campaigns and apply to the ones that match your profile. You can sign in with this WhatsApp number when you apply.' || E'\n\n'
           || 'Click the button below to see the live campaigns.';
  else
    v_subj := 'You are invited to Geek OS — explore live campaigns';
    v_mail := 'Hi ' || p_first || ',' || E'\n\n' || 'Thank you for your interest in working with ' || p_from || '. You are invited to join Geek OS, our creator platform for brand campaigns.' || E'\n\n'
           || 'Next, please explore the live campaigns and apply to the ones that match your profile. You can sign in with this WhatsApp number when you apply.' || E'\n\n'
           || 'Click the button below to see the live campaigns.';
  end if;
  return jsonb_build_object('template', v_want, 'template_live', v_tpl = v_want, 'wa_template', v_tpl, 'wa_vars', v_vars,
    'whatsapp_text', v_wa, 'subject', v_subj, 'email_text', v_mail);
end $$;

insert into private.ci_step_wa_status(wa_template, status, error) values
  ('geek_application_not_selected', 'submitted', 'created in snapto (Utility) on 27 Oct 2026 — waiting for Meta review')
on conflict (wa_template) do nothing;
-- the Marketing versions are not used
update private.ci_step_wa_status set status = 'manual', error = 'Meta approved this only as MARKETING — not used; invites go on Utility templates'
 where wa_template in ('geek_explore_invite', 'geek_explore_invite_ns');
