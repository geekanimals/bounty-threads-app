-- 💬 Creator cards: how many messages went to each creator on this campaign — WhatsApp (automatic + sent by hand),
-- the last one and whether it was delivered / read, emails, reminders — plus email / city for the card.
create or replace function api.campaign_msg_stats(p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_c uuid;
begin
  v_c := intel.ci_resolve_campaign(p_campaign);
  if v_c is null or not intel.ci_can_manage_campaign(v_c) then raise exception 'not your campaign' using errcode = '42501'; end if;
  return coalesce((select jsonb_object_agg(t.key, jsonb_build_object(
      'email', t.email, 'city', t.city, 'phone', t.phone, 'pct', case when t.mid is not null then intel.ci_profile_pct(t.mid) end,
      'wa', (select count(*) from intel.ci_outbox o where o.campaign_id = v_c and o.channel = 'whatsapp' and o.status = 'sent'
               and (o.to_address = t.phone or (t.mid is not null and o.recipient_member_id = t.mid)))
            + (select count(*) from public.wa_messages m join public.wa_conversations c on c.id = m.conversation_id
                where c.contact_phone_e164 = t.phone and m.direction = 'outbound' and m.sender_user_id is not null and m.created_at >= t.since),
      'em', (select count(*) from intel.ci_outbox o where o.campaign_id = v_c and o.channel = 'email' and o.status = 'sent'
               and (o.to_address = t.email or (t.mid is not null and o.recipient_member_id = t.mid))),
      -- reminders: step reminders that went (video due / overdue / restore…), the campaign's own reminder timers that fired,
      -- and for someone not registered yet every time the invite was sent again
      'rem', greatest((select count(*) from intel.ci_outbox o where o.campaign_id = v_c and o.status in ('sent','delivered','read')
                and o.template_key ~* 'remind|due|overdue|nudge|restore|warning'
                and (o.to_address in (t.phone, t.email) or (t.mid is not null and o.recipient_member_id = t.mid))),
              case when t.key like 'p:%' then (select count(*) from intel.ci_reminder r where r.participation_id = substr(t.key, 3)::uuid and r.fired_at is not null) else 0 end)
             + case when t.key like 'i:%' then greatest(coalesce((select i3.invites_sent from intel.ci_campaign_invite i3 where i3.invite_id = substr(t.key, 3)::uuid), 0) - 1, 0) else 0 end,
      'last', (select jsonb_build_object('at', z.ts, 'status', z.status, 'channel', z.channel, 'by', z.src) from (
                 select coalesce(o.sent_at, o.created_at) as ts, o.status::text as status, o.channel::text as channel, 'auto'::text as src from intel.ci_outbox o
                  where o.campaign_id = v_c and o.channel in ('whatsapp','email') and o.status in ('sent','delivered','read','failed')
                    and (o.to_address in (t.phone, t.email) or (t.mid is not null and o.recipient_member_id = t.mid))
                 union all
                 select m.created_at, m.status::text, 'whatsapp'::text, case when m.sender_user_id is not null then 'team' else 'auto' end as src
                   from public.wa_messages m join public.wa_conversations c on c.id = m.conversation_id
                  where c.contact_phone_e164 = t.phone and m.direction = 'outbound' and m.created_at >= t.since
                 order by 1 desc limit 1) z)))
    from (
      select 'i:' || i.invite_id key, i.phone_e164 phone, i.email, i.city, coalesce(i.claimed_by, i.reserved_by) mid, i.created_at since
        from intel.ci_campaign_invite i where i.campaign_id = v_c and i.participation_id is null
      union all
      select 'p:' || p.participation_id, coalesce(intel.ci_member_phone(mm.mid), inv.phone_e164), coalesce(case when m.email !~* '@creators\.bountythreads\.app$' then nullif(m.email, '') end, (select nullif(btrim(cc.email), '') from private.creator_contact cc where cc.identity_id = p.identity_id and cc.email !~* '@creators\.bountythreads\.app$' limit 1), inv.email, nullif(m.email, '')), inv.city, mm.mid,
             coalesce(inv.created_at, p.created_at)
        from intel.ci_campaign_participation p
        left join lateral (select intel.ci_member_of_identity(p.identity_id) as mid) mm on true
        left join public.members m on m.id = mm.mid
        left join lateral (select i2.phone_e164, i2.email, i2.city, i2.created_at from intel.ci_campaign_invite i2
                            where i2.participation_id = p.participation_id order by i2.created_at limit 1) inv on true
       where p.campaign_id = v_c) t), '{}'::jsonb);
end $$;
revoke all on function api.campaign_msg_stats(uuid) from public, anon;
grant execute on function api.campaign_msg_stats(uuid) to authenticated;
