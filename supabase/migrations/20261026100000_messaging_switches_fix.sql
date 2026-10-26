-- Fix: the Super Admin WhatsApp / email switch failed with "UPDATE requires a WHERE clause"
-- (this database blocks UPDATE without WHERE). Same function, with WHERE id.
create or replace function public.admin_set_messaging_switch(p_channel text, p_on boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_n int := 0;
begin
  if not public.is_platform_admin() then raise exception 'not a platform admin' using errcode = '42501'; end if;
  insert into public.messaging_switches(id) values (true) on conflict (id) do nothing;
  if p_channel = 'whatsapp' then update public.messaging_switches set wa_on = p_on, updated_by = auth.uid(), updated_at = now() where id;
  elsif p_channel = 'email' then update public.messaging_switches set email_on = p_on, updated_by = auth.uid(), updated_at = now() where id;
  else raise exception 'channel must be whatsapp or email' using errcode = '22023'; end if;
  if not p_on then v_n := private.msg_hold_queued(p_channel, null); end if;
  begin
    insert into public.activity_log(member_id, kind, event, detail)
    values (auth.uid(), 'security', 'messaging_switch', jsonb_build_object('channel', p_channel, 'on', p_on, 'held', v_n));
  exception when others then null; end;
  return jsonb_build_object('channel', p_channel, 'on', p_on, 'held_now', v_n);
end $$;
revoke all on function public.admin_set_messaging_switch(text, boolean) from public, anon;
grant execute on function public.admin_set_messaging_switch(text, boolean) to authenticated;
