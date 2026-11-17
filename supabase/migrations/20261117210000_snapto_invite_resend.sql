-- "↻ Resend invite" (api.bulk_resend_invite → last_invited_at) now restarts the new Utility invite drip (01)
-- on WhatsApp. The old geek_join_invite WhatsApp is blocked while drips are on; the email still goes as before.
-- Guard: no second 01 within 2 hours for the same invite (the first send right after upload is enough).

create or replace function private.tg_snapto_invite() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_cname text; v_phone text := nullif(btrim(coalesce(NEW.phone_e164, '')), ''); v_first text; v_attrs jsonb;
begin
  if v_phone is null then return null; end if;

  if TG_OP = 'UPDATE' and NEW.claimed_at is not null and OLD.claimed_at is null then
    perform private.snapto_enqueue_phone('done', 'join', v_phone, '{}', 'done:join:' || NEW.invite_id);
    return null;
  end if;
  if NEW.claimed_at is not null then return null; end if;
  if TG_OP = 'UPDATE' and NEW.last_invited_at is not distinct from OLD.last_invited_at then return null; end if;

  -- already has an account with this number → they get the step drips instead
  if exists (select 1 from public.members m where m.whatsapp_e164 = v_phone)
     or exists (select 1 from public.wa_contacts w where w.phone_e164 = v_phone and w.user_id is not null) then
    return null;
  end if;
  -- resend: not again within 2 hours of the last invite drip for this invite
  if TG_OP = 'UPDATE' and exists (select 1 from private.snapto_drip_queue q
       where q.dedupe like 'start:01:' || NEW.invite_id || '%' and q.created_at > now() - interval '2 hours') then
    return null;
  end if;

  select c.name into v_cname from intel.ci_campaign c where c.campaign_id = NEW.campaign_id;
  v_first := coalesce(nullif(split_part(btrim(coalesce(NEW.full_name, '')), ' ', 1), ''), 'there');
  v_attrs := jsonb_build_object('creator_name', left(v_first, 40), 'campaign_name', coalesce(v_cname, 'your campaign'),
                                'invite_path', case when NEW.token is not null then 'login?cinv=' || NEW.token::text else 'login' end);
  perform private.snapto_enqueue_phone('start', '01', v_phone, v_attrs,
    'start:01:' || NEW.invite_id || case when TG_OP = 'UPDATE' then ':r' || extract(epoch from now())::bigint else '' end);
  return null;
exception when others then
  raise warning 'snapto invite skipped: %', sqlerrm;
  return null;
end $$;
drop trigger if exists snapto_invite on intel.ci_campaign_invite;
create trigger snapto_invite after insert or update of claimed_at, last_invited_at on intel.ci_campaign_invite
  for each row execute function private.tg_snapto_invite();
