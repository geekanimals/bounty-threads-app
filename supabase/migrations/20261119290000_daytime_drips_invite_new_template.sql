-- 1) No WhatsApp at night. A drip start is held until 9 AM IST when it would land too late:
--    multi-message drips start only 09:00–17:00 IST (their follow-ups at +3 h / next day then stay between 8 AM and 9 PM);
--    single-message drips (07, 14, 01ix, 01i*) start 09:00–21:00 IST. The queue worker already waits for not_before.
create or replace function private.tg_snapto_daytime()
returns trigger language plpgsql set search_path = '' as $function$
declare v_at timestamptz := greatest(coalesce(NEW.not_before, now()), now());
        v_local timestamp; v_end int;
begin
  if NEW.kind <> 'start' then return NEW; end if;
  v_end := case when NEW.drip in ('07', '14', '01ix', '01i2', '01i3') then 21 else 17 end;
  v_local := v_at at time zone 'Asia/Kolkata';
  if extract(hour from v_local) < 9 then
    NEW.not_before := (date_trunc('day', v_local) + interval '9 hours') at time zone 'Asia/Kolkata';
  elsif extract(hour from v_local) >= v_end then
    NEW.not_before := (date_trunc('day', v_local) + interval '1 day 9 hours') at time zone 'Asia/Kolkata';
  end if;
  return NEW;
end $function$;
drop trigger if exists ab_daytime on private.snapto_drip_queue;
create trigger ab_daytime before insert on private.snapto_drip_queue for each row execute function private.tg_snapto_daytime();

-- 2) "Invite" from Find matching creators: WhatsApp goes with the NEW Snapto invite (drip 01, campaign_invite_1_v2),
--    not the old geek_* template. Email / in-app stay as they are.
create or replace function private.tg_snapto_skip_old_wa()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare v_cname text; v_pub text;
begin
  if NEW.channel <> 'whatsapp' or coalesce(NEW.status, 'queued') <> 'queued' or not private.snapto_on()
     or private.ci_is_team(NEW.recipient_member_id) then
    return NEW;
  end if;
  if NEW.template_key = 'invited' and NEW.recipient_member_id is not null and NEW.campaign_id is not null then
    select c.name, coalesce(c.legacy_campaign_id::text, c.campaign_id::text) into v_cname, v_pub
      from intel.ci_campaign c where c.campaign_id = NEW.campaign_id;
    perform private.snapto_enqueue('start', '01', NEW.recipient_member_id,
      jsonb_build_object('creator_name', private.snapto_first_name(NEW.recipient_member_id),
                         'campaign_name', coalesce(v_cname, 'a campaign'),
                         'invite_path', 'creator/discover/' || v_pub),
      'start:01:inv:' || NEW.campaign_id || ':' || NEW.recipient_member_id);
    NEW.status := 'skipped';
    NEW.last_error := 'sent with the new Snapto invite (drip 01)';
    return NEW;
  end if;
  if coalesce(NEW.template_key, '') in ('bulk_invite', 'completed', 'deadline_reminder', 'video_final_warning', 'video_warning',
       'video_due', 'video_nudge', 'product_shipped', 'confirm_address', 'parcel_received', 'content_approved', 'contract_sent',
       'contract_signed_ops', 'address_confirmed', 'published') then
    NEW.status := 'skipped';
    NEW.last_error := 'covered by the Snapto drip for this step (no duplicate WhatsApp)';
  end if;
  return NEW;
end $function$;
