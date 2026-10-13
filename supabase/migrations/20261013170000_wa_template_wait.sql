-- WhatsApp alerts sent while the template is still waiting for Meta approval are parked (not failed) and
-- re-tried automatically every 10 minutes for 3 days, so they go out on their own once the template is approved.
create or replace function api.ops_outbox_requeue_waiting()
returns int language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  update intel.ci_outbox set status = 'queued', attempts = 0
   where status = 'skipped' and last_error like 'Waiting for WhatsApp template approval%'
     and updated_at < now() - interval '10 minutes' and created_at > now() - interval '3 days';
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function api.ops_outbox_requeue_waiting() from public, anon, authenticated;
grant execute on function api.ops_outbox_requeue_waiting() to service_role;

-- messages that already failed because the template is not active yet → park them so they auto-retry
update intel.ci_outbox
   set status = 'skipped', attempts = 0, last_error = 'Waiting for WhatsApp template approval — ' || left(coalesce(last_error,''), 200)
 where status = 'failed' and channel = 'whatsapp' and last_error ~* 'template (not active|.*pending|.*not approved)';
