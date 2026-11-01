-- 🔗 Super Admin → Settings → Link shortener: paste ANY link → a short <app>/s/<slug> link (custom ending optional),
-- with full analytics per link: clicks, people, per day, city / country, device / OS / browser, where they came from,
-- time on page + active time (our own pages). Campaign creator links (/go/…) are separate and unchanged.
alter table intel.msg_link add column if not exists title text;
alter table intel.msg_link add column if not exists active boolean not null default true;
alter table intel.msg_link_event add column if not exists city text;
alter table intel.msg_link_event add column if not exists region text;
alter table intel.msg_link_event add column if not exists country text;

-- open: + location (from the hosting edge, no third party) + switched-off links
drop function if exists public.msg_link_open(text,text,text,text,text);
create or replace function public.msg_link_open(p_slug text, p_visitor text default null, p_device text default null,
  p_ua text default null, p_ref text default null, p_city text default null, p_region text default null, p_country text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l intel.msg_link%rowtype; v_bot boolean; v_os text; v_br text; v_dest text; v_base text; v_ua text := left(coalesce(p_ua, ''), 400);
begin
  select * into l from intel.msg_link where slug = lower(left(coalesce(p_slug, ''), 40));
  if l.slug is null or not l.active then return jsonb_build_object('ok', false); end if;
  v_bot := v_ua ~* 'bot|crawl|spider|preview|facebookexternalhit|WhatsApp/|TelegramBot|Slack|Discord|Twitterbot|LinkedInBot|Googlebot|bingbot|curl|wget|python|HeadlessChrome|Lighthouse';
  v_os := case when v_ua ~* 'Android' then 'Android' when v_ua ~* 'iPhone|iPad|iOS' then 'iOS' when v_ua ~* 'Windows' then 'Windows'
               when v_ua ~* 'Mac OS' then 'Mac' when v_ua ~* 'Linux' then 'Linux' else 'Other' end;
  v_br := case when v_ua ~* 'Instagram' then 'Instagram' when v_ua ~* 'FBAN|FBAV' then 'Facebook' when v_ua ~* 'Edg/' then 'Edge'
               when v_ua ~* 'Chrome/' then 'Chrome' when v_ua ~* 'Safari/' then 'Safari' when v_ua ~* 'Firefox/' then 'Firefox' else 'Other' end;
  insert into intel.msg_link_event(slug, kind, visitor, device, os, browser, ref, city, region, country)
  values (l.slug, case when v_bot then 'bot' else 'click' end, left(p_visitor, 64), left(p_device, 16), v_os, v_br, left(p_ref, 120),
          left(nullif(p_city, ''), 80), left(nullif(p_region, ''), 40), left(nullif(p_country, ''), 8));
  if not v_bot then
    update intel.msg_link set clicks = clicks + 1, first_click_at = coalesce(first_click_at, now()), last_click_at = now() where slug = l.slug;
  end if;
  v_dest := l.url;
  begin select rtrim((api.ops_wa_settings())->>'app_url', '/') into v_base; exception when others then v_base := null; end;
  if coalesce(v_base, '') <> '' and left(v_dest, length(v_base) + 1) = v_base || '/' then
    v_dest := v_dest || case when position('?' in v_dest) > 0 then '&' else '?' end || 'gl=' || l.slug;
  end if;
  return jsonb_build_object('ok', true, 'dest', v_dest);
end $$;
revoke all on function public.msg_link_open(text,text,text,text,text,text,text,text) from public;
grant execute on function public.msg_link_open(text,text,text,text,text,text,text,text) to anon, authenticated;

create or replace function public.msg_link_time(p_slug text, p_visitor text, p_seconds int, p_active int)
returns void language plpgsql security definer set search_path = '' as $$
declare v_id bigint; v_slug text := lower(left(coalesce(p_slug, ''), 40));
begin
  if not exists (select 1 from intel.msg_link where slug = v_slug) then return; end if;
  select e.id into v_id from intel.msg_link_event e
   where e.slug = v_slug and e.kind = 'time' and e.visitor is not distinct from left(p_visitor, 64) and e.at > now() - interval '6 hours'
   order by e.at desc limit 1;
  if v_id is null then
    insert into intel.msg_link_event(slug, kind, visitor, seconds, active_seconds)
    values (v_slug, 'time', left(p_visitor, 64), least(greatest(coalesce(p_seconds, 0), 0), 7200), least(greatest(coalesce(p_active, 0), 0), 7200));
  else
    update intel.msg_link_event set seconds = greatest(seconds, least(greatest(coalesce(p_seconds, 0), 0), 7200)),
           active_seconds = greatest(active_seconds, least(greatest(coalesce(p_active, 0), 0), 7200)) where id = v_id;
  end if;
end $$;

-- ---- Super Admin: make / list / switch off / analytics
create or replace function private.sl_is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_admins a where a.user_id = auth.uid()) $$;
revoke all on function private.sl_is_admin() from public, anon, authenticated;

create or replace function api.admin_link_create(p_url text, p_title text default null, p_slug text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_base text; v_slug text := lower(btrim(coalesce(p_slug, ''))); v_try int := 0; v_url text := btrim(coalesce(p_url, ''));
begin
  if not private.sl_is_admin() then raise exception 'Super Admin only' using errcode = '42501'; end if;
  if v_url !~* '^https?://[^\s/$.?#].[^\s]*$' then raise exception 'Paste a full link that starts with https://' using errcode = '22023'; end if;
  begin select rtrim((api.ops_wa_settings())->>'app_url', '/') into v_base; exception when others then v_base := null; end;
  if coalesce(v_base, '') = '' then raise exception 'Set the app address first (Super Admin → WhatsApp & email)' using errcode = '22023'; end if;
  if v_slug <> '' then
    if v_slug !~ '^[a-z0-9][a-z0-9-]{2,38}[a-z0-9]$' then raise exception 'Custom ending: 4–40 letters, numbers or - (e.g. diwali-offer)' using errcode = '22023'; end if;
    if exists (select 1 from intel.msg_link where slug = v_slug) then raise exception 'That ending is taken — try another' using errcode = '23505'; end if;
    insert into intel.msg_link(slug, url, channel, title, sent_by) values (v_slug, v_url, 'manual', nullif(btrim(coalesce(p_title, '')), ''), auth.uid());
  else
    loop
      v_slug := lower(substr(md5(random()::text || clock_timestamp()::text), 1, 7));
      begin
        insert into intel.msg_link(slug, url, channel, title, sent_by) values (v_slug, v_url, 'manual', nullif(btrim(coalesce(p_title, '')), ''), auth.uid());
        exit;
      exception when unique_violation then v_try := v_try + 1; if v_try > 5 then raise; end if;
      end;
    end loop;
  end if;
  return jsonb_build_object('slug', v_slug, 'short', v_base || '/s/' || v_slug);
end $$;
revoke all on function api.admin_link_create(text,text,text) from public, anon;
grant execute on function api.admin_link_create(text,text,text) to authenticated;

create or replace function api.admin_link_toggle(p_slug text, p_active boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.sl_is_admin() then raise exception 'Super Admin only' using errcode = '42501'; end if;
  update intel.msg_link set active = p_active where slug = lower(p_slug) and channel = 'manual';
end $$;
revoke all on function api.admin_link_toggle(text,boolean) from public, anon;
grant execute on function api.admin_link_toggle(text,boolean) to authenticated;

create or replace function api.admin_links_list()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_base text;
begin
  if not private.sl_is_admin() then raise exception 'Super Admin only' using errcode = '42501'; end if;
  begin select rtrim((api.ops_wa_settings())->>'app_url', '/') into v_base; exception when others then v_base := null; end;
  return jsonb_build_object('base', v_base, 'links', coalesce((select jsonb_agg(x order by x.created_at desc) from (
    select l.slug, l.url, l.title, l.active, l.created_at, l.clicks, l.last_click_at, coalesce(m.name, '') created_by,
           (select count(distinct e.visitor) from intel.msg_link_event e where e.slug = l.slug and e.kind = 'click') people,
           (select count(*) from intel.msg_link_event e where e.slug = l.slug and e.kind = 'click' and e.at > now() - interval '24 hours') clicks_24h,
           (select round(avg(e.seconds)) from intel.msg_link_event e where e.slug = l.slug and e.kind = 'time') avg_seconds
      from intel.msg_link l left join public.members m on m.id = l.sent_by
     where l.channel = 'manual') x), '[]'::jsonb));
end $$;
revoke all on function api.admin_links_list() from public, anon;
grant execute on function api.admin_links_list() to authenticated;

create or replace function api.admin_link_stats(p_slug text, p_days int default 30)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare l intel.msg_link%rowtype; v_from timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)));
begin
  if not private.sl_is_admin() then raise exception 'Super Admin only' using errcode = '42501'; end if;
  select * into l from intel.msg_link where slug = lower(p_slug);
  if l.slug is null then raise exception 'Link not found'; end if;
  return jsonb_build_object(
    'slug', l.slug, 'url', l.url, 'title', l.title, 'active', l.active, 'created_at', l.created_at, 'days', p_days,
    'totals', (select jsonb_build_object(
        'clicks', count(*) filter (where e.kind = 'click'),
        'people', count(distinct e.visitor) filter (where e.kind = 'click'),
        'bots', count(*) filter (where e.kind = 'bot'),
        'avg_seconds', round(avg(e.seconds) filter (where e.kind = 'time')),
        'avg_active', round(avg(e.active_seconds) filter (where e.kind = 'time')),
        'max_seconds', max(e.seconds) filter (where e.kind = 'time'),
        'first', min(e.at) filter (where e.kind = 'click'), 'last', max(e.at) filter (where e.kind = 'click'))
      from intel.msg_link_event e where e.slug = l.slug and e.at >= v_from),
    'per_day', coalesce((select jsonb_agg(jsonb_build_object('day', d.day, 'clicks', d.n) order by d.day) from (
        select (e.at at time zone 'Asia/Kolkata')::date as day, count(*) as n from intel.msg_link_event e
         where e.slug = l.slug and e.kind = 'click' and e.at >= v_from group by 1) d), '[]'::jsonb),
    'by_hour', coalesce((select jsonb_object_agg(h, n) from (select extract(hour from e.at at time zone 'Asia/Kolkata')::int h, count(*) n
        from intel.msg_link_event e where e.slug = l.slug and e.kind = 'click' and e.at >= v_from group by 1) x), '{}'::jsonb),
    'by_city', coalesce((select jsonb_agg(jsonb_build_object('k', k, 'n', n) order by n desc) from (select coalesce(nullif(concat_ws(', ', e.city, e.country), ''), 'Unknown') k, count(*) n
        from intel.msg_link_event e where e.slug = l.slug and e.kind = 'click' and e.at >= v_from group by 1 order by 2 desc limit 15) x), '[]'::jsonb),
    'by_os', coalesce((select jsonb_agg(jsonb_build_object('k', k, 'n', n) order by n desc) from (select coalesce(e.os, 'Other') k, count(*) n
        from intel.msg_link_event e where e.slug = l.slug and e.kind = 'click' and e.at >= v_from group by 1) x), '[]'::jsonb),
    'by_browser', coalesce((select jsonb_agg(jsonb_build_object('k', k, 'n', n) order by n desc) from (select coalesce(e.browser, 'Other') k, count(*) n
        from intel.msg_link_event e where e.slug = l.slug and e.kind = 'click' and e.at >= v_from group by 1) x), '[]'::jsonb),
    'by_device', coalesce((select jsonb_agg(jsonb_build_object('k', k, 'n', n) order by n desc) from (select coalesce(e.device, 'Other') k, count(*) n
        from intel.msg_link_event e where e.slug = l.slug and e.kind = 'click' and e.at >= v_from group by 1) x), '[]'::jsonb),
    'by_ref', coalesce((select jsonb_agg(jsonb_build_object('k', k, 'n', n) order by n desc) from (select coalesce(nullif(e.ref, ''), 'Direct / app (WhatsApp, Instagram…)') k, count(*) n
        from intel.msg_link_event e where e.slug = l.slug and e.kind = 'click' and e.at >= v_from group by 1 order by 2 desc limit 10) x), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(r order by r.at desc) from (
        select e.at, e.device, e.os, e.browser, e.ref, concat_ws(', ', e.city, e.region, e.country) place,
               (select max(t.seconds) from intel.msg_link_event t where t.slug = l.slug and t.kind = 'time' and t.visitor is not distinct from e.visitor) seconds,
               (select max(t.active_seconds) from intel.msg_link_event t where t.slug = l.slug and t.kind = 'time' and t.visitor is not distinct from e.visitor) active_seconds,
               (select count(*) from intel.msg_link_event p where p.slug = l.slug and p.kind = 'click' and p.visitor is not distinct from e.visitor and p.at <= e.at) visit_no
          from intel.msg_link_event e where e.slug = l.slug and e.kind = 'click' and e.at >= v_from order by e.at desc limit 100) r), '[]'::jsonb));
end $$;
revoke all on function api.admin_link_stats(text,int) from public, anon;
grant execute on function api.admin_link_stats(text,int) to authenticated;

-- the message-links report counts message links only (links made by hand have their own list)
do $p$
declare d text; n text;
begin
  d := pg_get_functiondef('api.admin_short_links_report(int)'::regprocedure);
  if position('is distinct from ''manual''' in d) > 0 then return; end if;
  n := replace(d, 'l.created_at >= v_from', 'l.created_at >= v_from and l.channel is distinct from ''manual''');
  n := replace(n, 'l2.created_at >= v_from', 'l2.created_at >= v_from and l2.channel is distinct from ''manual''');
  n := replace(n, 'l3.created_at >= v_from', 'l3.created_at >= v_from and l3.channel is distinct from ''manual''');
  n := replace(n, 'where e.kind = ''click'' and e.at >= v_from order by e.at desc limit 60', 'where e.kind = ''click'' and e.at >= v_from and l.channel is distinct from ''manual'' order by e.at desc limit 60');
  if n = d then raise exception 'report not patched'; end if;
  execute n;
end $p$;
