-- Bulk-upload creators who have not logged in with their own WhatsApp yet still get the drips (contract ready,
-- address confirm …) on the WhatsApp number from the sheet (members.whatsapp_e164). Opted-out numbers never get one.
create or replace function private.snapto_enqueue(p_kind text, p_drip text, p_member uuid, p_attrs jsonb, p_dedupe text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_phone text;
begin
  if p_member is null then return; end if;
  if p_kind = 'start' and not private.snapto_on() then return; end if;
  if exists (select 1 from public.wa_contacts w where w.user_id = p_member and w.opt_out_at is not null) then return; end if;
  select w.phone_e164 into v_phone from public.wa_contacts w
   where w.user_id = p_member and w.verified_at is not null limit 1;
  if v_phone is null then
    select nullif(m.whatsapp_e164, '') into v_phone from public.members m where m.id = p_member;
    if v_phone is not null and exists (select 1 from public.wa_contacts w where w.phone_e164 = v_phone and w.opt_out_at is not null) then
      return;
    end if;
  end if;
  if v_phone is null then return; end if;
  insert into private.snapto_drip_queue(kind, drip, member_id, phone, attrs, dedupe)
  values (p_kind, p_drip, p_member, v_phone, coalesce(p_attrs, '{}'), p_dedupe)
  on conflict (dedupe) do nothing;
exception when others then
  raise warning 'snapto enqueue skipped: %', sqlerrm;
end $$;
revoke all on function private.snapto_enqueue(text, text, uuid, jsonb, text) from public, anon, authenticated;
