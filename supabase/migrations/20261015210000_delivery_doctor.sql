-- WhatsApp + email to creators, made dependable:
--  * held WhatsApp messages are retried for 7 days (was 3) — they go out on their own once the template is approved
--  * Super Admin → WhatsApp & email gets a "delivery doctor": for every creator who had an update in the last
--    7 days, whether WhatsApp / email went out and, if not, exactly why (no number, no email, template waiting,
--    provider error). ADDITIVE.

create or replace function api.ops_outbox_requeue_waiting()
returns int language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  update intel.ci_outbox set status = 'queued', attempts = 0
   where status = 'skipped' and channel = 'whatsapp'
     and (last_error like 'Waiting for WhatsApp template approval%' or last_error like 'WhatsApp 24h window closed%')
     and updated_at < now() - interval '10 minutes' and created_at > now() - interval '7 days';
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function api.ops_outbox_requeue_waiting() from public, anon, authenticated;
grant execute on function api.ops_outbox_requeue_waiting() to service_role;

create or replace function public.admin_delivery_doctor()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then raise exception 'not a platform admin' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(x order by x->>'last_at' desc) from (
    select jsonb_build_object(
      'member_id', n.recipient_member_id,
      'who', coalesce((select '@'||sa.username from public.social_accounts sa where sa.member_id = n.recipient_member_id and sa.platform = 'instagram' limit 1),
                      nullif(m.name,''), m.org_name),
      'role', m.role,
      'alerts', count(*),
      'last_at', max(n.created_at),
      'wa_number', intel.ci_wa_lookup(n.recipient_member_id),
      'wa_off', exists (select 1 from public.wa_contacts w where w.user_id = n.recipient_member_id and w.opt_out_at is not null),
      'email_off', m.email_opt_out_at is not null,
      'wa', (select jsonb_build_object('sent', count(*) filter (where o.status = 'sent'), 'held', count(*) filter (where o.status = 'skipped'),
                     'failed', count(*) filter (where o.status = 'failed'), 'queued', count(*) filter (where o.status in ('queued','sending')),
                     'error', (array_agg(o.last_error order by o.updated_at desc) filter (where o.status in ('failed','skipped')))[1])
               from intel.ci_outbox o where o.recipient_member_id = n.recipient_member_id and o.channel = 'whatsapp' and o.created_at > now() - interval '7 days'),
      'email', (select jsonb_build_object('sent', count(*) filter (where o.status = 'sent'), 'held', count(*) filter (where o.status = 'skipped'),
                     'failed', count(*) filter (where o.status = 'failed'), 'queued', count(*) filter (where o.status in ('queued','sending')),
                     'to', max(o.to_address),
                     'error', (array_agg(o.last_error order by o.updated_at desc) filter (where o.status in ('failed','skipped')))[1])
               from intel.ci_outbox o where o.recipient_member_id = n.recipient_member_id and o.channel = 'email' and o.created_at > now() - interval '7 days')
    ) x
    from intel.ci_notification n join public.members m on m.id = n.recipient_member_id
   where n.created_at > now() - interval '7 days'
   group by n.recipient_member_id, m.name, m.org_name, m.role, m.email_opt_out_at
   limit 200) s), '[]'::jsonb);
end $$;
revoke all on function public.admin_delivery_doctor() from public, anon;
grant execute on function public.admin_delivery_doctor() to authenticated;

-- the bulk-upload banner: the default template counts as "set" (it goes out the moment Meta approves it)
create or replace function api.wa_invite_ready()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'whatsapp', true,
    'template', coalesce((select nullif(btrim(update_template),'') from public.wa_settings), 'geek_campaign_update'),
    'is_admin', public.is_platform_admin()) $$;
