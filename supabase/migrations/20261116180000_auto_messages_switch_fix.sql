-- Settings → Auto messages → "Automatic messages (every step)" Turn on/off failed with
-- "UPDATE requires a WHERE clause" (safe-update guard on API calls). Same function, with the WHERE.
-- Also schedules the daily Instagram token refresh (cron mode needs the CRON_SECRET function secret,
-- stored in Vault as ig_cron_secret — set by hand, not in this repo).
create or replace function api.ops_set_auto_messages(p_on boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_n int := 0;
begin
  if not exists (select 1 from public.platform_admins a where a.user_id = auth.uid()) then
    raise exception 'Super Admin only' using errcode = '42501';
  end if;
  update public.messaging_switches set auto_on = p_on where id;
  if not p_on then
    update intel.ci_outbox o set status = 'skipped', last_error = 'paused: automatic messages are off (send it by hand from the panel)'
     where o.status = 'queued' and o.channel in ('whatsapp','email')
       and coalesce(o.template_key, '') !~* 'otp|login|recovery|password'
       and not private.ci_is_team(o.recipient_member_id);
    get diagnostics v_n = row_count;
  end if;
  return jsonb_build_object('auto_on', p_on, 'stopped_now', v_n);
end $$;
revoke all on function api.ops_set_auto_messages(boolean) from public, anon;
grant execute on function api.ops_set_auto_messages(boolean) to authenticated;

select cron.schedule('ig-token-refresh', '23 22 * * *', $c$select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name = 'ci_project_url' limit 1) || '/functions/v1/instagram-refresh',
  body := '{}'::jsonb,
  headers := jsonb_build_object('Content-Type', 'application/json',
    'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'ig_cron_secret' limit 1)),
  timeout_milliseconds := 120000)$c$);
