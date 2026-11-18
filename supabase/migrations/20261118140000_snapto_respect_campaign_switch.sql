-- Snapto drips must respect the campaign's WhatsApp switch (Campaign → Overview → WhatsApp ON/OFF)
-- and the global one (Settings → messaging_switches.wa_on).
-- Before this, a campaign set to OFF (e.g. a Completed campaign) still sent "start" drips
-- (14 Campaign completed etc.) because the drip triggers never looked at the switch.
-- Only "start" (a message to the creator) is blocked. "done" still goes — it only stops a drip.

create or replace function private.snapto_campaign_on(p_campaign uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select m.wa_on from intel.ci_campaign_messaging m where m.campaign_id = p_campaign), true)
     and coalesce((select s.wa_on from public.messaging_switches s limit 1), true)
$$;

create or replace function private.snapto_enqueue_c(p_campaign uuid, p_kind text, p_drip text, p_member uuid, p_attrs jsonb, p_dedupe text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_kind = 'start' and p_campaign is not null and not private.snapto_campaign_on(p_campaign) then return; end if;
  perform private.snapto_enqueue(p_kind, p_drip, p_member, p_attrs, p_dedupe);
end $$;

create or replace function private.snapto_enqueue_phone_c(p_campaign uuid, p_kind text, p_drip text, p_phone text, p_attrs jsonb, p_dedupe text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_kind = 'start' and p_campaign is not null and not private.snapto_campaign_on(p_campaign) then return; end if;
  perform private.snapto_enqueue_phone(p_kind, p_drip, p_phone, p_attrs, p_dedupe);
end $$;

revoke all on function private.snapto_campaign_on(uuid) from public, anon, authenticated;
revoke all on function private.snapto_enqueue_c(uuid, text, text, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function private.snapto_enqueue_phone_c(uuid, text, text, text, jsonb, text) from public, anon, authenticated;

-- point the 3 campaign drip senders at the switch-aware helpers
do $do$
declare v_def text;
begin
  -- campaign steps (07 shipped · 08 delivered · 09 video due · 10 contract · 12 address · 13 post · 14 completed)
  select pg_get_functiondef('private.tg_snapto_campaign_step()'::regprocedure) into v_def;
  if position('snapto_enqueue_c(' in v_def) = 0 then
    v_def := replace(v_def, 'private.snapto_enqueue(', 'private.snapto_enqueue_c(NEW.campaign_id, ');
    execute v_def;
  end if;
  -- 01 bulk invite (trigger on ci_campaign_invite)
  select pg_get_functiondef('private.tg_snapto_invite()'::regprocedure) into v_def;
  if position('snapto_enqueue_phone_c(' in v_def) = 0 then
    v_def := replace(v_def, 'private.snapto_enqueue_phone(', 'private.snapto_enqueue_phone_c(NEW.campaign_id, ');
    execute v_def;
  end if;
  -- "WhatsApp all / Resend" from the campaign (manual)
  select pg_get_functiondef('api.snapto_send_current_step(uuid, uuid[], uuid[])'::regprocedure) into v_def;
  if position('snapto_enqueue_c(' in v_def) = 0 and position('snapto_enqueue_phone_c(' in v_def) = 0 then
    v_def := replace(v_def, 'private.snapto_enqueue_phone(', 'private.snapto_enqueue_phone_c(v_camp, ');
    v_def := replace(v_def, 'private.snapto_enqueue(', 'private.snapto_enqueue_c(v_camp, ');
    execute v_def;
  end if;
end $do$;
