-- Snapto drips have their OWN on/off button (Settings → Auto messages → "Snapto drips"), separate from the
-- site's WhatsApp / Email / Automatic-messages switches.
--   Drips OFF → no NEW drip starts. "done" signals always go (they only stop drips that are already running).
create or replace function private.snapto_enqueue(p_kind text, p_drip text, p_member uuid, p_attrs jsonb, p_dedupe text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_phone text;
begin
  if p_member is null then return; end if;
  if p_kind = 'start' and not private.snapto_on() then return; end if;
  select w.phone_e164 into v_phone from public.wa_contacts w
   where w.user_id = p_member and w.verified_at is not null and w.opt_out_at is null limit 1;
  if v_phone is null then return; end if;
  insert into private.snapto_drip_queue(kind, drip, member_id, phone, attrs, dedupe)
  values (p_kind, p_drip, p_member, v_phone, coalesce(p_attrs, '{}'), p_dedupe)
  on conflict (dedupe) do nothing;
exception when others then
  raise warning 'snapto enqueue skipped: %', sqlerrm;
end $$;
revoke all on function private.snapto_enqueue(text, text, uuid, jsonb, text) from public, anon, authenticated;

create or replace function private.tg_snapto_campaign_step() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_key text := split_part(coalesce(NEW.dedupe_key, ''), ':', 1); v_member uuid; v_identity uuid; v_cname text; v_addr text;
begin
  if NEW.participation_id is null or v_key not in ('contract_sent', 'confirm_address', 'contract_signed_ops', 'address_confirmed') then return null; end if;
  select identity_id into v_identity from intel.ci_campaign_participation where participation_id = NEW.participation_id;
  v_member := intel.ci_member_of_identity(v_identity);
  select c.name into v_cname from intel.ci_campaign c where c.campaign_id = NEW.campaign_id;
  if v_key = 'contract_sent' then
    perform private.snapto_enqueue('start', '10', v_member,
      jsonb_build_object('campaign_name', coalesce(v_cname, 'your campaign'), 'agreement_path', NEW.participation_id || '/agreement'),
      'start:10:' || NEW.participation_id);
  elsif v_key = 'confirm_address' then
    perform private.snapto_enqueue('done', 'contract', v_member, '{}', 'done:contract:' || NEW.participation_id);
    select concat_ws(', ', nullif(a.line1, ''), nullif(a.line2, ''), nullif(a.landmark, ''), nullif(a.city, ''), nullif(a.state, ''), nullif(a.postal_code, ''))
      into v_addr from private.creator_address a
     where a.identity_id = v_identity and a.deleted_at is null order by a.is_default desc, a.updated_at desc limit 1;
    perform private.snapto_enqueue('start', '12', v_member,
      jsonb_build_object('campaign_name', coalesce(v_cname, 'your campaign'), 'delivery_address', coalesce(nullif(v_addr, ''), 'not added yet'),
                         'address_path', NEW.participation_id || '/address'),
      'start:12:' || NEW.participation_id);
  elsif v_key = 'contract_signed_ops' then
    perform private.snapto_enqueue('done', 'contract', v_member, '{}', 'done:contract:' || NEW.participation_id);
  elsif v_key = 'address_confirmed' then
    perform private.snapto_enqueue('done', 'address', v_member, '{}', 'done:address:' || NEW.participation_id);
  end if;
  return null;
exception when others then
  raise warning 'snapto campaign step skipped: %', sqlerrm;
  return null;
end $$;

-- the button (Super Admin only)
create or replace function api.ops_snapto_drips()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('on', private.snapto_on(),
    'queued', (select count(*) from private.snapto_drip_queue where sent_at is null and tries < 5),
    'sent_today', (select count(*) from private.snapto_drip_queue where kind = 'start' and sent_at > now() - interval '1 day')) $$;
revoke all on function api.ops_snapto_drips() from public, anon;
grant execute on function api.ops_snapto_drips() to authenticated;

create or replace function api.ops_set_snapto_drips(p_on boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.platform_admins a where a.user_id = auth.uid()) then
    raise exception 'Super Admin only' using errcode = '42501';
  end if;
  if p_on then
    insert into private.snapto_drip_switch(on_) values (true) on conflict (on_) do nothing;
  else
    delete from private.snapto_drip_switch where on_;
  end if;
  begin
    insert into public.activity_log(member_id, kind, event, detail)
    values (auth.uid(), 'security', 'snapto_drips_switch', jsonb_build_object('on', p_on));
  exception when others then null;
  end;
  return api.ops_snapto_drips();
end $$;
revoke all on function api.ops_set_snapto_drips(boolean) from public, anon;
grant execute on function api.ops_set_snapto_drips(boolean) to authenticated;
