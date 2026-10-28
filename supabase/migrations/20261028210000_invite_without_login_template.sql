-- 📨 Creator upload invites → the short Utility template "invite_creator_without_login" (snapto, 28 Oct 2026):
--    "Hi, Thank you for your interest in working with Geek Creative Agency. You are invited to join Geek OS … Please click
--     the button below to explore the live campaigns …" + footer "Team @GeekAnimals" + a URL button "View live campaigns"
--    → https://www.bountythreads.geekcreativeagency.com/explore.html (every live campaign, no login needed).
-- No variables (the link is the button). Every creator uploaded in bulk gets this one once Meta approves it; until then the
-- earlier Utility templates keep going. Emails stay as they are.
insert into private.ci_step_wa_status(wa_template, status, error) values
  ('invite_creator_without_login', 'submitted', 'created in snapto (Utility) on 28 Oct 2026 — waiting for Meta review')
on conflict (wa_template) do nothing;

create or replace function intel.ci_explore_invite_text(p_first text, p_from text, p_campaign text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_new_live boolean; v_ns_live boolean; v_tpl text; v_vars jsonb; v_wa text; v_mail text; v_subj text; v_want text;
begin
  v_new_live := coalesce((select s.status from private.ci_step_wa_status s where s.wa_template = 'invite_creator_without_login'), 'draft') = 'approved';
  v_ns_live := coalesce((select s.status from private.ci_step_wa_status s where s.wa_template = 'geek_application_not_selected'), 'draft') = 'approved';
  if v_new_live then
    v_tpl := 'invite_creator_without_login'; v_vars := '[]'::jsonb;
    v_wa := 'Hi,' || E'\n\n' || 'Thank you for your interest in working with Geek Creative Agency. You are invited to join Geek OS, our creator platform for brand campaigns.' || E'\n\n'
         || 'Please click the button below to explore the live campaigns and apply to the ones that match your profile.' || E'\n\n'
         || 'Team @GeekAnimals' || E'\n' || '[ View live campaigns ]';
  elsif p_campaign is not null and v_ns_live then
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
  v_want := 'invite_creator_without_login';
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
