-- Discovery worker was stuck: every pool handle without numbers had used its 3 tries back when Meta refused
-- business discovery (no Facebook token / no instagram_manage_insights), so each hourly run "tried 0".
--  • one-time: give those handles their tries back
--  • a try only counts when Instagram really answered for that handle — handles skipped after a rate limit or a
--    permission error are handed back (api.ops_discovery_release)
--  • runs every 30 minutes (40 handles each) instead of hourly
update intel.ci_external_creator set enrich_attempts = 0, enrich_error = null
 where followers is null and enrich_attempts >= 3;

create or replace function api.ops_discovery_release(p_handles jsonb)
returns int language sql security definer set search_path = '' as $$
  with u as (update intel.ci_external_creator set enrich_attempts = greatest(enrich_attempts - 1, 0)
              where handle in (select jsonb_array_elements_text(coalesce(p_handles,'[]'::jsonb))) returning 1)
  select count(*)::int from u $$;
revoke all on function api.ops_discovery_release(jsonb) from public, anon, authenticated;
grant execute on function api.ops_discovery_release(jsonb) to service_role;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('ci-discovery-enrich');
    perform cron.schedule('ci-discovery-enrich', '11,41 * * * *', $c$select private.ci_kick_worker('ig-discover-worker')$c$);
  end if;
exception when others then raise notice 'cron reschedule skipped: %', sqlerrm;
end $$;
