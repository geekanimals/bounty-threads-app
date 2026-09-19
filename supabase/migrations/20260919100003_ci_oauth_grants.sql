-- Phase 2C (3/3): grants. The browser-facing start/list are authenticated; the callback
-- completion is service_role ONLY (the Edge Function calls it over a server-side connection).
-- api usage was already granted to authenticated/service_role in Phase 2B.

revoke execute on function api.ig_connect_start(text, text, text) from public;
revoke execute on function api.get_my_connections()               from public;

grant execute on function api.ig_connect_start(text, text, text)  to authenticated, service_role;
grant execute on function api.get_my_connections()                to authenticated, service_role;

-- Callback completion: service_role only (never authenticated/anon). Edge calls it server-side.
grant execute on function intel.ci_ig_complete_connection(text, text, text, text, text, text, text[], text, timestamptz, text, text)
  to service_role;
