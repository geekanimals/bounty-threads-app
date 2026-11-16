-- Only the new Snapto drip templates go to creators on WhatsApp. Every old step WhatsApp (geek_* templates) is
-- stopped while the Snapto drips switch is ON. Email + in-app still go. Not affected: login / OTP codes and
-- messages to the team. Turn the drips switch OFF (Settings → Auto messages) to bring the old WhatsApp step messages back.
create or replace function private.tg_snapto_skip_old_wa() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if NEW.channel = 'whatsapp' and coalesce(NEW.status, 'queued') = 'queued' and private.snapto_on()
     and coalesce(NEW.template_key, '') !~* 'otp|login|recovery|password|^test$'
     and not private.ci_is_team(NEW.recipient_member_id) then
    NEW.status := 'skipped';
    NEW.last_error := 'old WhatsApp template off — only the new Snapto drip messages go (Settings → Snapto drips)';
  end if;
  return NEW;
end $$;
drop trigger if exists snapto_skip_old_wa on intel.ci_outbox;
create trigger snapto_skip_old_wa before insert on intel.ci_outbox
  for each row execute function private.tg_snapto_skip_old_wa();
