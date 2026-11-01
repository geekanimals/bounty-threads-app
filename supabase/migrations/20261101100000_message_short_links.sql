-- 🔗 Short links + click tracking for every WhatsApp / email message link (Super Admin → Settings).
-- Every link a message carries goes out as  <app>/s/<slug>  → go.html logs the click (device, when, who it was sent to,
-- link-preview bots filtered out) and forwards to the real page. On our own pages (app / explore) the time the person
-- stays — and how long they were active (mouse / touch / scroll / keys) — is recorded too.
alter table public.messaging_switches add column if not exists short_links_on boolean not null default true;

create table if not exists intel.msg_link (
  slug text primary key,
  url text not null,
  channel text,                 -- whatsapp | email
  outbox_id uuid,               -- automatic message (null = sent by hand from the panel / chat)
  campaign_id uuid,
  recipient text,               -- phone / email it was sent to
  member_id uuid,
  template_key text,            -- step / message kind, or the WhatsApp template for a hand-sent one
  sent_by uuid,                 -- team member who sent it by hand
  created_at timestamptz not null default now(),
  clicks int not null default 0,          -- people (bots not counted)
  first_click_at timestamptz,
  last_click_at timestamptz
);
create index if not exists msg_link_created_idx on intel.msg_link (created_at desc);
create index if not exists msg_link_outbox_idx on intel.msg_link (outbox_id) where outbox_id is not null;

create table if not exists intel.msg_link_event (
  id bigserial primary key,
  slug text not null references intel.msg_link(slug) on delete cascade,
  at timestamptz not null default now(),
  kind text not null,           -- click | bot | time
  visitor text,                 -- random id kept in the browser (unique people)
  device text,                  -- mobile | desktop
  os text,
  browser text,
  ref text,
  seconds int,                  -- time on the page (visible)
  active_seconds int            -- of which active: mouse / touch / scroll / keys in the last 30 s
);
create index if not exists msg_link_event_slug_idx on intel.msg_link_event (slug, at desc);
create index if not exists msg_link_event_at_idx on intel.msg_link_event (at desc);
alter table intel.msg_link enable row level security;
alter table intel.msg_link_event enable row level security;
revoke all on intel.msg_link, intel.msg_link_event from public, anon, authenticated;

-- make (or reuse) the short link for one message. Returns the URL to put in the message.
create or replace function api.ops_short_link(p_url text, p_channel text default null, p_outbox uuid default null,
  p_campaign uuid default null, p_recipient text default null, p_member uuid default null, p_template text default null,
  p_sent_by uuid default null)
returns text language plpgsql security definer set search_path = '' as $$
declare v_base text; v_slug text; v_try int := 0;
begin
  if p_url is null or p_url !~* '^https?://' then return p_url; end if;
  if not coalesce((select s.short_links_on from public.messaging_switches s), true) then return p_url; end if;
  if p_url ~* '/unsubscribe\.html|/s/[a-z0-9]{6,12}$' then return p_url; end if;     -- unsubscribe stays a plain link
  begin select rtrim((api.ops_wa_settings())->>'app_url', '/') into v_base; exception when others then v_base := null; end;
  if coalesce(v_base, '') = '' then return p_url; end if;
  if p_outbox is not null then
    select l.slug into v_slug from intel.msg_link l where l.outbox_id = p_outbox and l.url = p_url limit 1;
    if v_slug is not null then return v_base || '/s/' || v_slug; end if;
  end if;
  -- the app's campaign id or the campaign the creators sit on → always the latter (the report shows its name)
  if p_campaign is not null then begin p_campaign := coalesce(intel.ci_resolve_campaign(p_campaign), p_campaign); exception when others then null; end; end if;
  loop
    v_slug := lower(substr(md5(random()::text || clock_timestamp()::text), 1, 7));
    begin
      insert into intel.msg_link(slug, url, channel, outbox_id, campaign_id, recipient, member_id, template_key, sent_by)
      values (v_slug, p_url, p_channel, p_outbox, p_campaign, p_recipient, p_member, p_template, p_sent_by);
      exit;
    exception when unique_violation then v_try := v_try + 1; if v_try > 5 then return p_url; end if;
    end;
  end loop;
  return v_base || '/s/' || v_slug;
end $$;
revoke all on function api.ops_short_link(text,text,uuid,uuid,text,uuid,text,uuid) from public, anon, authenticated;
grant execute on function api.ops_short_link(text,text,uuid,uuid,text,uuid,text,uuid) to service_role;

-- the short link page (anyone, no sign-in): log the click, say where to go
create or replace function public.msg_link_open(p_slug text, p_visitor text default null, p_device text default null,
  p_ua text default null, p_ref text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l intel.msg_link%rowtype; v_bot boolean; v_os text; v_br text; v_dest text; v_base text; v_ua text := left(coalesce(p_ua, ''), 400);
begin
  select * into l from intel.msg_link where slug = lower(left(coalesce(p_slug, ''), 16));
  if l.slug is null then return jsonb_build_object('ok', false); end if;
  v_bot := v_ua ~* 'bot|crawl|spider|preview|facebookexternalhit|WhatsApp/|TelegramBot|Slack|Discord|Twitterbot|LinkedInBot|Googlebot|bingbot|curl|wget|python|HeadlessChrome|Lighthouse';
  v_os := case when v_ua ~* 'Android' then 'Android' when v_ua ~* 'iPhone|iPad|iOS' then 'iOS' when v_ua ~* 'Windows' then 'Windows'
               when v_ua ~* 'Mac OS' then 'Mac' when v_ua ~* 'Linux' then 'Linux' else 'Other' end;
  v_br := case when v_ua ~* 'Instagram' then 'Instagram' when v_ua ~* 'FBAN|FBAV' then 'Facebook' when v_ua ~* 'Edg/' then 'Edge'
               when v_ua ~* 'Chrome/' then 'Chrome' when v_ua ~* 'Safari/' then 'Safari' when v_ua ~* 'Firefox/' then 'Firefox' else 'Other' end;
  insert into intel.msg_link_event(slug, kind, visitor, device, os, browser, ref)
  values (l.slug, case when v_bot then 'bot' else 'click' end, left(p_visitor, 64), left(p_device, 16), v_os, v_br, left(p_ref, 120));
  if not v_bot then
    update intel.msg_link set clicks = clicks + 1, first_click_at = coalesce(first_click_at, now()), last_click_at = now() where slug = l.slug;
  end if;
  v_dest := l.url;
  -- our own pages: carry the slug so the page can report how long they stayed
  begin select rtrim((api.ops_wa_settings())->>'app_url', '/') into v_base; exception when others then v_base := null; end;
  if coalesce(v_base, '') <> '' and left(v_dest, length(v_base) + 1) = v_base || '/' then
    v_dest := v_dest || case when position('?' in v_dest) > 0 then '&' else '?' end || 'gl=' || l.slug;
  end if;
  return jsonb_build_object('ok', true, 'dest', v_dest);
end $$;
revoke all on function public.msg_link_open(text,text,text,text,text) from public;
grant execute on function public.msg_link_open(text,text,text,text,text) to anon, authenticated;

-- the page they landed on reports how long they stayed (called every 15 s while visible + when they leave)
create or replace function public.msg_link_time(p_slug text, p_visitor text, p_seconds int, p_active int)
returns void language plpgsql security definer set search_path = '' as $$
declare v_id bigint;
begin
  if not exists (select 1 from intel.msg_link where slug = lower(left(coalesce(p_slug, ''), 16))) then return; end if;
  select e.id into v_id from intel.msg_link_event e
   where e.slug = lower(p_slug) and e.kind = 'time' and e.visitor is not distinct from left(p_visitor, 64) and e.at > now() - interval '6 hours'
   order by e.at desc limit 1;
  if v_id is null then
    insert into intel.msg_link_event(slug, kind, visitor, seconds, active_seconds)
    values (lower(p_slug), 'time', left(p_visitor, 64), least(greatest(coalesce(p_seconds, 0), 0), 7200), least(greatest(coalesce(p_active, 0), 0), 7200));
  else
    update intel.msg_link_event set seconds = greatest(seconds, least(greatest(coalesce(p_seconds, 0), 0), 7200)),
           active_seconds = greatest(active_seconds, least(greatest(coalesce(p_active, 0), 0), 7200)) where id = v_id;
  end if;
end $$;
revoke all on function public.msg_link_time(text,text,int,int) from public;
grant execute on function public.msg_link_time(text,text,int,int) to anon, authenticated;

-- Super Admin: switch + report
create or replace function api.admin_set_short_links(p_on boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.platform_admins a where a.user_id = auth.uid()) then raise exception 'Super Admin only' using errcode = '42501'; end if;
  update public.messaging_switches set short_links_on = p_on;
  return jsonb_build_object('short_links_on', p_on);
end $$;
revoke all on function api.admin_set_short_links(boolean) from public, anon;
grant execute on function api.admin_set_short_links(boolean) to authenticated;

create or replace function api.admin_short_links_report(p_days int default 7)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_from timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 7), 365)));
begin
  if not exists (select 1 from public.platform_admins a where a.user_id = auth.uid()) then raise exception 'Super Admin only' using errcode = '42501'; end if;
  return jsonb_build_object(
    'on', coalesce((select s.short_links_on from public.messaging_switches s), true),
    'days', p_days,
    'totals', (select jsonb_build_object(
        'links', count(*),
        'clicked', count(*) filter (where l.clicks > 0),
        'clicks', coalesce(sum(l.clicks), 0),
        'people', (select count(distinct e.visitor) from intel.msg_link_event e join intel.msg_link l2 on l2.slug = e.slug where e.kind = 'click' and l2.created_at >= v_from),
        'bots', (select count(*) from intel.msg_link_event e join intel.msg_link l2 on l2.slug = e.slug where e.kind = 'bot' and l2.created_at >= v_from),
        'avg_seconds', (select round(avg(e.seconds)) from intel.msg_link_event e join intel.msg_link l2 on l2.slug = e.slug where e.kind = 'time' and l2.created_at >= v_from),
        'avg_active', (select round(avg(e.active_seconds)) from intel.msg_link_event e join intel.msg_link l2 on l2.slug = e.slug where e.kind = 'time' and l2.created_at >= v_from),
        'median_minutes_to_click', (select round((percentile_cont(0.5) within group (order by extract(epoch from l3.first_click_at - l3.created_at)) / 60)::numeric, 1)
                                      from intel.msg_link l3 where l3.created_at >= v_from and l3.first_click_at is not null))
      from intel.msg_link l where l.created_at >= v_from),
    'by_message', coalesce((select jsonb_agg(x order by x.sent desc) from (
        select y.kind, y.channel, count(*) sent, count(*) filter (where y.clicks > 0) clicked,
               round(100.0 * count(*) filter (where y.clicks > 0) / greatest(count(*), 1)) ctr, round(avg(y.sec)) avg_seconds
          from (select coalesce(l.template_key, 'other') kind, l.channel, l.clicks,
                       (select max(e.seconds) from intel.msg_link_event e where e.slug = l.slug and e.kind = 'time') sec
                  from intel.msg_link l where l.created_at >= v_from) y
         group by 1, 2) x), '[]'::jsonb),
    'by_device', coalesce((select jsonb_object_agg(k, n) from (select coalesce(e.os, 'Other') k, count(*) n from intel.msg_link_event e
        join intel.msg_link l on l.slug = e.slug where e.kind = 'click' and l.created_at >= v_from group by 1) d), '{}'::jsonb),
    'recent', coalesce((select jsonb_agg(r order by r.at desc) from (
        select e.at, l.slug, l.channel, l.template_key kind, l.recipient,
               coalesce(m.name, '@' || ci.handle, l.recipient) who, c.name campaign, e.device, e.os, e.browser,
               (select max(t.seconds) from intel.msg_link_event t where t.slug = l.slug and t.kind = 'time' and t.visitor is not distinct from e.visitor) seconds,
               (select max(t.active_seconds) from intel.msg_link_event t where t.slug = l.slug and t.kind = 'time' and t.visitor is not distinct from e.visitor) active_seconds,
               round(extract(epoch from e.at - l.created_at) / 60) minutes_after_send
          from intel.msg_link_event e join intel.msg_link l on l.slug = e.slug
          left join public.members m on m.id = l.member_id
          left join lateral (select i.handle from intel.ci_campaign_invite i where i.phone_e164 = l.recipient or i.email = l.recipient limit 1) ci on true
          left join intel.ci_campaign c on c.campaign_id = l.campaign_id
         where e.kind = 'click' and e.at >= v_from order by e.at desc limit 60) r), '[]'::jsonb));
end $$;
revoke all on function api.admin_short_links_report(int) from public, anon;
grant execute on function api.admin_short_links_report(int) to authenticated;
