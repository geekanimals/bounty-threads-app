-- Old WhatsApp (ci_outbox) is skipped ONLY for steps that a Snapto drip already covers.
-- Steps with no drip (approved / invited, not selected, restore post, posts pending, caption fix,
-- changes requested, paid contract) go again with their approved Utility templates (geek_*).
create or replace function private.tg_snapto_skip_old_wa()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  if NEW.channel = 'whatsapp' and coalesce(NEW.status, 'queued') = 'queued' and private.snapto_on()
     and coalesce(NEW.template_key, '') in ('bulk_invite', 'completed', 'deadline_reminder', 'video_final_warning', 'video_warning',
       'video_due', 'video_nudge', 'product_shipped', 'confirm_address', 'parcel_received', 'content_approved', 'contract_sent',
       'contract_signed_ops', 'address_confirmed', 'published')
     and not private.ci_is_team(NEW.recipient_member_id) then
    NEW.status := 'skipped';
    NEW.last_error := 'covered by the Snapto drip for this step (no duplicate WhatsApp)';
  end if;
  return NEW;
end $function$;
