-- "Messages off" for a creator (private.creator_msg_pause) now also stops Snapto drips,
-- not only the old WhatsApp / email outbox. OTP / login drips are never blocked.
create or replace function private.tg_snapto_pause_guard()
returns trigger language plpgsql security definer set search_path to '' as $f$
begin
  if NEW.kind = 'done' then return NEW; end if;
  if coalesce(NEW.drip, '') ~* 'otp|login' then return NEW; end if;
  if private.creator_paused(NEW.member_id, NEW.phone) then return null; end if;
  return NEW;
end $f$;
drop trigger if exists aa_pause_guard on private.snapto_drip_queue;
create trigger aa_pause_guard before insert on private.snapto_drip_queue
  for each row execute function private.tg_snapto_pause_guard();
