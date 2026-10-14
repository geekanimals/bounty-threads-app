-- WhatsApp: remember which template carried each message; if Meta later refuses that template (e.g. still in
-- review), the message is re-sent at once on the next approved one instead of waiting. ADDITIVE.
drop function if exists api.ops_outbox_complete(uuid, text, text, text);
create or replace function api.ops_outbox_complete(p_outbox_id uuid, p_status text, p_provider_ref text default null,
                                                   p_error text default null, p_meta jsonb default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('sent','failed','skipped') then raise exception 'bad status %', p_status using errcode='22023'; end if;
  update intel.ci_outbox
     set status = p_status, provider_ref = coalesce(p_provider_ref, provider_ref), last_error = p_error,
         sent_at = case when p_status = 'sent' then now() else sent_at end,
         payload = case when p_meta is null then payload else payload || p_meta end
   where outbox_id = p_outbox_id;
end $$;
revoke all on function api.ops_outbox_complete(uuid,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function api.ops_outbox_complete(uuid,text,text,text,jsonb) to service_role;

create or replace function api.ops_outbox_wa_status(p_ref text, p_status text, p_code int default null, p_error text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_msg text := left(coalesce(nullif(p_error,''), 'failed') || coalesce(' (#' || p_code || ')', ''), 280);
begin
  if p_ref is null or p_status is distinct from 'failed' then return; end if;
  if p_code = 131047 or v_msg ~* 're-?engagement|24 ?hour|customer service window' then
    update intel.ci_outbox set status = 'queued', attempts = 0, payload = payload || '{"force_template":true}'::jsonb,
           last_error = 'Re-sending on the approved template · ' || v_msg
     where provider_ref = p_ref and channel = 'whatsapp' and not coalesce((payload->>'force_template')::boolean, false);
    update intel.ci_outbox set status = 'failed', attempts = 3, last_error = 'WhatsApp: ' || v_msg
     where provider_ref = p_ref and channel = 'whatsapp' and coalesce((payload->>'force_template')::boolean, false) and status = 'sent';
    perform private.ci_kick_worker('ops-notify-dispatch');
  elsif p_code between 132000 and 132999 or v_msg ~* 'template' then
    -- that template was refused: try the next one straight away (it is skipped from now on for this message)
    update intel.ci_outbox
       set status = 'queued', attempts = 0, last_error = 'Template ' || coalesce(payload->>'sent_template','?') || ' refused — trying the next one · ' || v_msg,
           payload = payload || jsonb_build_object('avoid_templates',
                       coalesce(payload->'avoid_templates','[]'::jsonb) || to_jsonb(coalesce(payload->>'sent_template','?')))
     where provider_ref = p_ref and channel = 'whatsapp';
    perform private.ci_kick_worker('ops-notify-dispatch');
  else
    update intel.ci_outbox set status = 'failed', attempts = 3, last_error = 'WhatsApp: ' || v_msg
     where provider_ref = p_ref and channel = 'whatsapp';
  end if;
end $$;
revoke all on function api.ops_outbox_wa_status(text, text, int, text) from public, anon, authenticated;
grant execute on function api.ops_outbox_wa_status(text, text, int, text) to service_role;
