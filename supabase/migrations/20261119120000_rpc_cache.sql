-- Shared cache for the heavy campaign workspace data (19 Nov 2026)
-- Every campaign has a version number. Any write that changes what the workspace shows bumps it (triggers below).
-- api.<fn>(campaign) returns the stored copy while the version is unchanged (max 10 min old), else rebuilds once.
-- Platform admins share one copy; any other user (brand) gets their own copy. The old functions are untouched
-- and live on as private.<fn>_live.

create table if not exists private.cache_ver (scope text primary key, v bigint not null default 1, at timestamptz not null default now());
create table if not exists private.rpc_cache (k text primary key, ver text not null, data jsonb not null, at timestamptz not null default now());
alter table private.cache_ver enable row level security;
alter table private.rpc_cache enable row level security;
revoke all on private.cache_ver, private.rpc_cache from anon, authenticated;

create or replace function private.cache_touch(p_scope text) returns void
language sql security definer set search_path = '' as $$
  insert into private.cache_ver as c (scope, v, at) values (p_scope, 1, now())
  on conflict (scope) do update set v = c.v + 1, at = now();
$$;

-- a creator changed (profile / contact / Instagram / address): every campaign they are in or invited to
create or replace function private.cache_touch_member(p_member uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c uuid;
begin
  if p_member is null then return; end if;
  for c in
    select p.campaign_id from intel.ci_identity_actor_access a join intel.ci_campaign_participation p on p.identity_id = a.identity_id where a.member_id = p_member
    union select i.campaign_id from intel.ci_campaign_invite i where i.claimed_by = p_member or i.reserved_by = p_member
  loop perform private.cache_touch('c:' || c); end loop;
end $$;

create or replace function private.cache_touch_identity(p_identity uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c uuid; m uuid;
begin
  if p_identity is null then return; end if;
  for c in select distinct p.campaign_id from intel.ci_campaign_participation p where p.identity_id = p_identity loop
    perform private.cache_touch('c:' || c);
  end loop;
  for m in select a.member_id from intel.ci_identity_actor_access a where a.identity_id = p_identity loop
    perform private.cache_touch_member(m);
  end loop;
end $$;

-- one trigger function for all watched tables; TG_ARGV[0] says how to find the campaign
create or replace function private.cache_bump_tg() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  m text := TG_ARGV[0];
  r jsonb := to_jsonb(coalesce(NEW, OLD));
  o jsonb := case when TG_OP = 'UPDATE' then to_jsonb(OLD) end;
  c uuid;
begin
  begin
    if m like 'mem:%' then
      perform private.cache_touch_member((r->>substr(m, 5))::uuid);
      if TG_OP = 'INSERT' then perform private.cache_touch('people'); end if;  -- a new sign-up can match a pending invite
      return null;
    elsif m = 'ident' then
      perform private.cache_touch_identity((r->>'identity_id')::uuid);
      return null;
    elsif m = 'wamsg' then
      -- message counts include messages typed by an admin (outbound with a sender)
      if r->>'direction' = 'outbound' and r->>'sender_user_id' is not null then perform private.cache_touch('people'); end if;
      return null;
    end if;
    c := case m
      when 'c' then (r->>'campaign_id')::uuid
      when 'p' then (select p.campaign_id from intel.ci_campaign_participation p where p.participation_id = (r->>'participation_id')::uuid)
      when 'legacy' then private.campaign_intel_id((r->>'id')::uuid)
      when 'sub' then (select p.campaign_id from intel.ci_campaign_deliverable d join intel.ci_campaign_participation p on p.participation_id = d.participation_id
                        where d.deliverable_id = (r->>'deliverable_id')::uuid)
      when 'appr' then (select p.campaign_id from intel.ci_campaign_submission s join intel.ci_campaign_deliverable d on d.deliverable_id = s.deliverable_id
                         join intel.ci_campaign_participation p on p.participation_id = d.participation_id where s.submission_id = (r->>'submission_id')::uuid)
      when 'metric' then (select cp.campaign_id from intel.ci_campaign_post cp where cp.post_id = (r->>'post_id')::uuid)
      when 'bl' then (r->>'campaign_id')::uuid
    end;
    if c is not null then perform private.cache_touch('c:' || c);
    elsif m = 'bl' then perform private.cache_touch_identity((r->>'identity_id')::uuid);
    end if;
    if m = 'c' and o is not null and (o->>'campaign_id') is distinct from (r->>'campaign_id') and o->>'campaign_id' is not null then
      perform private.cache_touch('c:' || (o->>'campaign_id'));
    end if;
  exception when others then
    -- never block the real write; worst case the copy refreshes on its 10-minute limit
    raise warning 'cache_bump_tg %: %', TG_TABLE_NAME, sqlerrm;
  end;
  return null;
end $$;

do $x$
declare t record;
begin
  for t in select * from (values
    ('intel.ci_campaign', 'c'), ('intel.ci_campaign_participation', 'c'), ('intel.ci_campaign_invite', 'c'),
    ('intel.ci_campaign_event', 'c'), ('intel.ci_campaign_contract', 'c'), ('intel.ci_campaign_outreach', 'c'),
    ('intel.ci_campaign_post', 'c'), ('intel.ci_outbox', 'c'), ('intel.ci_reminder', 'c'), ('public.wa_conversations', 'c'),
    ('intel.ci_campaign_deliverable', 'p'), ('intel.ci_campaign_shipment', 'p'),
    ('intel.ci_campaign_submission', 'sub'), ('intel.ci_campaign_approval', 'appr'), ('intel.ci_campaign_post_metric', 'metric'),
    ('intel.ci_creator_blacklist', 'bl'), ('public.campaigns', 'legacy'), ('public.wa_messages', 'wamsg'),
    ('public.members', 'mem:id'), ('public.social_accounts', 'mem:member_id'), ('public.wa_contacts', 'mem:user_id'),
    ('private.ig_linked_accounts', 'mem:member_id'), ('intel.ci_identity_actor_access', 'mem:member_id'),
    ('private.creator_address', 'ident'), ('private.creator_contact', 'ident'), ('intel.ci_creator_professional_profile', 'ident')
  ) v(tbl, mode) loop
    execute format('drop trigger if exists zz_cache_bump on %s', t.tbl);
    execute format('create trigger zz_cache_bump after insert or update or delete on %s for each row execute function private.cache_bump_tg(%L)', t.tbl, t.mode);
  end loop;
end $x$;

-- the cache itself
create or replace function private.cache_campaign_rpc(p_fn text, p_campaign uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_c uuid; v_who text; v_ver text; v_k text; d jsonb;
begin
  v_c := intel.ci_resolve_campaign(p_campaign);
  -- no login (service jobs) or unknown campaign: straight through, as before
  if v_c is null or auth.uid() is null then
    execute format('select private.%I($1)', p_fn || '_live') into d using p_campaign;
    return d;
  end if;
  if public.is_platform_admin() then v_who := 'adm';
  else
    if not intel.ci_can_manage_campaign(v_c) then raise exception 'not your campaign' using errcode = '42501'; end if;
    v_who := auth.uid()::text;
  end if;
  select coalesce((select v from private.cache_ver where scope = 'c:' || v_c), 0) || '.' ||
         coalesce((select v from private.cache_ver where scope = 'people'), 0) into v_ver;
  v_k := p_fn || ':' || v_c || ':' || v_who;
  select c.data into d from private.rpc_cache c where c.k = v_k and c.ver = v_ver and c.at > now() - interval '10 minutes';
  if found then return d; end if;
  execute format('select private.%I($1)', p_fn || '_live') into d using p_campaign;
  begin
    insert into private.rpc_cache (k, ver, data, at) values (v_k, v_ver, coalesce(d, 'null'::jsonb), now())
    on conflict (k) do update set ver = excluded.ver, data = excluded.data, at = excluded.at;
  exception when others then null;  -- read-only call: just answer without storing
  end;
  return d;
end $$;
revoke all on function private.cache_campaign_rpc(text, uuid) from public, anon, authenticated;

-- move the real functions aside and put the cached ones in their place (same name, same arguments, same answer)
do $x$
declare f text; g text;
begin
  foreach f in array array['campaign_people', 'campaign_msg_stats', 'barter_tracker', 'campaign_brief_match', 'campaign_creator_extras', 'campaign_deliverable_progress'] loop
    if to_regprocedure('private.' || f || '_live(uuid)') is null then
      select string_agg(r.rolname, ',') into g from pg_roles r
       where r.rolname in ('authenticated', 'service_role') and has_function_privilege(r.oid, ('api.' || f || '(uuid)')::regprocedure, 'execute');
      execute format('alter function api.%I(uuid) set schema private', f);
      execute format('alter function private.%I(uuid) rename to %I', f, f || '_live');
      execute format($f$create function api.%I(p_campaign uuid) returns jsonb language sql volatile security definer set search_path = ''
                      as $b$ select private.cache_campaign_rpc(%L, p_campaign) $b$$f$, f, f);
      execute format('revoke all on function api.%I(uuid) from public, anon', f);
      execute format('grant execute on function api.%I(uuid) to %s', f, coalesce(g, 'authenticated'));
    end if;
  end loop;
end $x$;

-- keep the cache small: drop copies older than a day with the nightly cron-history clean-up
do $x$ begin
  if exists (select 1 from cron.job where jobid = 40) then
    perform cron.alter_job(40, command := $c$delete from cron.job_run_details where end_time < now() - interval '2 days'; delete from private.rpc_cache where at < now() - interval '1 day'$c$);
  end if;
end $x$;
