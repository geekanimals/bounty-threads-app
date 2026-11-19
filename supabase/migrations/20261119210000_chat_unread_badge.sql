-- Unread creator replies: a badge on the 💬 Chat button. Creator replies already arrive in public.wa_messages
-- (Snapto webhook). When anyone on the team opens that creator's chat, it is marked read for the whole team.
create table if not exists private.wa_chat_seen (
  phone_e164 text primary key,
  seen_at    timestamptz not null default now(),
  seen_by    uuid
);
alter table private.wa_chat_seen enable row level security;

-- opening a creator's chat page → read for everyone
create or replace function api.mark_chat_seen(p_campaign uuid, p_phone text)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare v_c uuid := intel.ci_resolve_campaign(p_campaign); v_ph text := nullif(btrim(coalesce(p_phone, '')), '');
begin
  if v_c is null or not intel.ci_can_operate_campaign(v_c) then raise exception 'not your campaign' using errcode = '42501'; end if;
  if v_ph is null then return jsonb_build_object('ok', false); end if;
  if v_ph !~ '^\+' then v_ph := '+' || regexp_replace(v_ph, '\D', '', 'g'); end if;
  insert into private.wa_chat_seen(phone_e164, seen_at, seen_by) values (v_ph, now(), auth.uid())
  on conflict (phone_e164) do update set seen_at = now(), seen_by = excluded.seen_by;
  return jsonb_build_object('ok', true);
end $fn$;
revoke all on function api.mark_chat_seen(uuid, text) from public, anon;
grant execute on function api.mark_chat_seen(uuid, text) to authenticated;

-- creator key (same keys as api.campaign_msg_stats: 'p:<participation>' / 'i:<invite>') → unread replies.
-- Only replies from the last 7 days count; reactions / edits / deleted messages don't.
create or replace function api.campaign_unread(p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare v_c uuid := intel.ci_resolve_campaign(p_campaign);
begin
  if v_c is null or not intel.ci_can_operate_campaign(v_c) then raise exception 'not your campaign' using errcode = '42501'; end if;
  return coalesce((
    with t as (
      select 'i:' || i.invite_id as key, i.phone_e164 as phone
        from intel.ci_campaign_invite i
       where i.campaign_id = v_c and i.participation_id is null and i.phone_e164 is not null
      union all
      select 'p:' || p.participation_id,
             coalesce(intel.ci_member_phone(intel.ci_member_of_identity(p.identity_id)),
                      (select i2.phone_e164 from intel.ci_campaign_invite i2 where i2.participation_id = p.participation_id order by i2.created_at limit 1))
        from intel.ci_campaign_participation p
       where p.campaign_id = v_c and p.stage not in ('ineligible','brand_declined','dropped','rejected')
    ), u as (
      select t.key, count(*) as n, max(m.created_at) as last
        from t
        join public.wa_conversations c on c.contact_phone_e164 = t.phone
        join public.wa_messages m on m.conversation_id = c.id
        left join private.wa_chat_seen s on s.phone_e164 = t.phone
       where m.direction = 'inbound'
         and coalesce(m.body, '') !~ '^\[(reaction|edit|revoke)\]$'
         and m.created_at > greatest(now() - interval '7 days', coalesce(s.seen_at, '-infinity'::timestamptz))
       group by t.key)
    select jsonb_object_agg(key, jsonb_build_object('n', n, 'last', last)) from u), '{}'::jsonb);
end $fn$;
revoke all on function api.campaign_unread(uuid) from public, anon;
grant execute on function api.campaign_unread(uuid) to authenticated;

create index if not exists wa_msg_conv_in_idx on public.wa_messages (conversation_id, created_at desc) where direction = 'inbound';
