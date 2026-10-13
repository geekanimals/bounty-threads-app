-- Delivery engine: WhatsApp + email copies of every alert actually go out.
-- Until now ci_outbox rows were queued but nothing drained them (the dispatcher was never scheduled).
--  * the dispatcher registers its own secret + project URL in Vault on its first authorised run
--  * a new outbox row kicks the dispatcher immediately (pg_net, after commit) + a 1-minute pg_cron safety net
--  * SLA reminders run every 15 minutes
--  * Super Admin → Delivery: what was sent / skipped / failed and why, retry, and a test send. ADDITIVE.

do $$ begin create extension if not exists pg_net with schema extensions;
exception when others then raise notice 'pg_net not available: %', sqlerrm; end $$;
do $$ begin create extension if not exists pg_cron with schema pg_catalog;
exception when others then raise notice 'pg_cron not available: %', sqlerrm; end $$;

-- 1) dispatcher → Vault (service role only; the secret never appears in SQL, git or the app)
create or replace function api.ops_register_worker(p_secret text, p_url text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_cur text; k text; v text;
begin
  if coalesce(length(p_secret),0) < 32 or coalesce(p_url,'') !~ '^https://' then raise exception 'bad worker config' using errcode = '22023'; end if;
  foreach k in array array['ci_worker_secret','ci_project_url'] loop
    v := case k when 'ci_worker_secret' then p_secret else rtrim(p_url,'/') end;
    select s.id, s.decrypted_secret into v_id, v_cur from vault.decrypted_secrets s where s.name = k limit 1;
    if v_id is null then perform vault.create_secret(v, k, 'Geek OS notification worker');
    elsif v_cur is distinct from v then perform vault.update_secret(v_id, v, k, 'Geek OS notification worker'); end if;
    v_id := null; v_cur := null;
  end loop;
end $$;
revoke all on function api.ops_register_worker(text, text) from public, anon, authenticated;
grant execute on function api.ops_register_worker(text, text) to service_role;

-- 2) fire a worker Edge Function (async, after commit). Never raises: delivery must not block the app.
create or replace function private.ci_kick_worker(p_fn text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_secret text; v_url text;
begin
  if p_fn not in ('ops-notify-dispatch','ops-reminder-worker') then return null; end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'ci_worker_secret' limit 1;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'ci_project_url' limit 1;
  if v_secret is null or v_url is null then return null; end if;
  return net.http_post(url := v_url || '/functions/v1/' || p_fn, body := '{}'::jsonb,
                       headers := jsonb_build_object('Content-Type','application/json','x-worker-secret', v_secret),
                       timeout_milliseconds := 25000);
exception when others then
  raise warning 'ci_kick_worker(%) skipped: %', p_fn, sqlerrm; return null;
end $$;
revoke all on function private.ci_kick_worker(text) from public, anon, authenticated;

create or replace function intel.tg_outbox_kick()
returns trigger language plpgsql security definer set search_path = '' as $$
begin perform private.ci_kick_worker('ops-notify-dispatch'); return null; end $$;
revoke all on function intel.tg_outbox_kick() from public, anon, authenticated;
drop trigger if exists ci_outbox_kick on intel.ci_outbox;
create trigger ci_outbox_kick after insert on intel.ci_outbox for each statement execute function intel.tg_outbox_kick();

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('ci-notify-dispatch', '* * * * *', $c$select private.ci_kick_worker('ops-notify-dispatch')$c$);
    perform cron.schedule('ci-reminders', '*/15 * * * *', $c$select private.ci_kick_worker('ops-reminder-worker')$c$);
  end if;
exception when others then raise notice 'cron schedule skipped: %', sqlerrm;
end $$;

-- 3) Super Admin → Delivery
create or replace function public.admin_delivery()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_cfg boolean := false; v_jobs jsonb := '[]'::jsonb; v_runs jsonb := '[]'::jsonb;
begin
  if not public.is_platform_admin() then raise exception 'not a platform admin' using errcode = '42501'; end if;
  begin select exists (select 1 from vault.decrypted_secrets where name = 'ci_worker_secret') into v_cfg; exception when others then v_cfg := false; end;
  begin
    select coalesce(jsonb_agg(jsonb_build_object('name', j.jobname, 'schedule', j.schedule, 'active', j.active)), '[]'::jsonb) into v_jobs
      from cron.job j where j.jobname like 'ci-%';
    select coalesce(jsonb_agg(x order by x->>'at' desc), '[]'::jsonb) into v_runs from (
      select jsonb_build_object('job', j.jobname, 'status', d.status, 'message', left(d.return_message, 200), 'at', d.start_time) x
        from cron.job_run_details d join cron.job j on j.jobid = d.jobid
       where j.jobname like 'ci-%' order by d.start_time desc limit 6) r;
  exception when others then null; end;
  return jsonb_build_object(
    'worker_configured', v_cfg, 'jobs', v_jobs, 'runs', v_runs,
    'stats', coalesce((select jsonb_object_agg(k, n) from (
        select o.channel || ':' || o.status k, count(*) n from intel.ci_outbox o
         where o.created_at > now() - interval '7 days' group by 1) s), '{}'::jsonb),
    'last_sent', jsonb_build_object(
        'whatsapp', (select max(sent_at) from intel.ci_outbox where channel = 'whatsapp' and status = 'sent'),
        'email', (select max(sent_at) from intel.ci_outbox where channel = 'email' and status = 'sent')),
    'oldest_queued', (select min(created_at) from intel.ci_outbox where status = 'queued'),
    'recent', coalesce((select jsonb_agg(x order by x->>'created_at' desc) from (
        select jsonb_build_object('outbox_id', o.outbox_id, 'channel', o.channel,
                 'to', case when o.channel = 'whatsapp' then '••••' || right(o.to_address, 4)
                            else regexp_replace(o.to_address, '^(.).*(@.*)$', '\1•••\2') end,
                 'who', coalesce(nullif(m.name,''), m.org_name), 'role', m.role,
                 'template', o.template_key, 'title', coalesce(o.payload->>'title', o.payload->>'subject'),
                 'status', o.status, 'error', o.last_error, 'attempts', o.attempts,
                 'created_at', o.created_at, 'sent_at', o.sent_at) x
          from intel.ci_outbox o left join public.members m on m.id = o.recipient_member_id
         order by o.created_at desc limit 80) r), '[]'::jsonb));
end $$;
revoke all on function public.admin_delivery() from public, anon;
grant execute on function public.admin_delivery() to authenticated;

-- retry: requeue failed / skipped messages from the last 3 days (e.g. after the WhatsApp template is approved)
create or replace function public.admin_delivery_retry(p_channel text default null)
returns int language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  if not public.is_platform_admin() then raise exception 'not a platform admin' using errcode = '42501'; end if;
  update intel.ci_outbox set status = 'queued', attempts = 0, last_error = null
   where status in ('failed','skipped') and created_at > now() - interval '3 days'
     and (p_channel is null or channel = p_channel) and coalesce(last_error,'') !~* 'opted out';
  get diagnostics v_n = row_count;
  perform private.ci_kick_worker('ops-notify-dispatch');
  insert into public.activity_log(member_id, kind, event, detail)
  values (auth.uid(), 'security', 'admin_delivery_retry', jsonb_build_object('channel', p_channel, 'requeued', v_n));
  return v_n;
end $$;
revoke all on function public.admin_delivery_retry(text) from public, anon;
grant execute on function public.admin_delivery_retry(text) to authenticated;

-- test send: one WhatsApp and/or one email to the admin's own number / address
create or replace function public.admin_delivery_test(p_phone text default null, p_email text default null)
returns int language plpgsql security definer set search_path = '' as $$
declare v_n int := 0; v_key text := 'test:' || gen_random_uuid()::text;
        v_title text := 'Test from Geek OS ✅'; v_body text := 'If you can read this, campaign alerts reach you here.';
begin
  if not public.is_platform_admin() then raise exception 'not a platform admin' using errcode = '42501'; end if;
  if coalesce(p_phone,'') ~ '^\+[1-9][0-9]{7,15}$' then
    insert into intel.ci_outbox(channel, recipient_member_id, to_address, template_key, payload, dedupe_key)
    values ('whatsapp', auth.uid(), p_phone, 'test', jsonb_build_object('title', v_title, 'text', v_body, 'action_route', 'admin', 'action_label', 'Open'), v_key);
    v_n := v_n + 1;
  end if;
  if coalesce(p_email,'') ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    insert into intel.ci_outbox(channel, recipient_member_id, to_address, template_key, payload, dedupe_key)
    values ('email', auth.uid(), lower(p_email), 'test', jsonb_build_object('subject', v_title, 'html', v_body, 'action_route', 'admin', 'action_label', 'Open'), v_key);
    v_n := v_n + 1;
  end if;
  if v_n = 0 then raise exception 'enter a WhatsApp number (+91…) or an email' using errcode = '22023'; end if;
  return v_n;
end $$;
revoke all on function public.admin_delivery_test(text, text) from public, anon;
grant execute on function public.admin_delivery_test(text, text) to authenticated;

-- 4) campaign status → lifecycle: "Live" means the campaign is running (was mapped back to discovery, which
--    could re-open and later re-fire the "campaign started" alert). Live and In Production = in execution.
create or replace function intel.ci_legacy_lifecycle(p_status text)
returns text language sql immutable set search_path = '' as $$
  select case lower(coalesce(p_status, ''))
    when 'sourcing' then 'creator_discovery'
    when 'live' then 'in_execution'
    when 'in production' then 'in_execution'
    when 'completed' then 'completed'
    else 'draft' end $$;
