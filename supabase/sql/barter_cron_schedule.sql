-- Step 8b — schedule the barter workers. Idempotent (safe to re-run). Contains NO secrets:
-- URL + CI_WORKER_SECRET are read from Vault at run time (load them with scripts/golive/02-vault-to-clipboard.sh).
create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault;

-- guard: refuse to schedule until Vault is populated
do $$ begin
  if (select count(*) from vault.decrypted_secrets where name in ('ops_functions_url','ci_worker_secret')
        and coalesce(decrypted_secret,'') <> '') < 2 then
    raise exception 'Vault secrets ops_functions_url / ci_worker_secret missing — run 02-vault-to-clipboard.sh first';
  end if;
end $$;

-- one helper so the cron bodies stay one line and never embed the secret
create or replace function public.ops_invoke_worker(p_fn text)
returns bigint language sql security definer set search_path = '' as $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'ops_functions_url') || '/' || p_fn,
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-worker-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'ci_worker_secret')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 55000);
$$;
revoke all on function public.ops_invoke_worker(text) from public, anon, authenticated;
grant execute on function public.ops_invoke_worker(text) to postgres, service_role;

-- (re)schedule — cron.schedule with an existing name updates it in place
select cron.schedule('ops-notify-dispatch',     '* * * * *',    $$select public.ops_invoke_worker('ops-notify-dispatch')$$);
select cron.schedule('ops-reminder-worker',     '*/5 * * * *',  $$select public.ops_invoke_worker('ops-reminder-worker')$$);
select cron.schedule('ops-tracking-worker',     '*/30 * * * *', $$select public.ops_invoke_worker('ops-tracking-worker')$$);
select cron.schedule('ops-post-metrics-worker', '0 */3 * * *',  $$select public.ops_invoke_worker('ops-post-metrics-worker')$$);
-- housekeeping: purge OTP rows older than a day; trim pg_net response log
select cron.schedule('wa-otp-purge',            '17 3 * * *',   $$select public.wa_otp_purge()$$);
select cron.schedule('net-response-trim',       '23 3 * * *',   $$delete from net._http_response where created < now() - interval '2 days'$$);

select jobid, jobname, schedule, active from cron.job order by jobname;

-- worker responses (last 20) — check status_code = 200, never 401/503:
-- select id, status_code, left(content::text, 120) from net._http_response order by id desc limit 20;
