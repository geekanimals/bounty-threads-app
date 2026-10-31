-- ✍️ "My own message" goes as plain typed WhatsApp — only possible while the creator's 24-hour window is open
-- (they wrote to us in the last 24 hours). The panel ticks exactly those creators: this returns them.
create or replace function api.campaign_wa_open_windows(p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_c uuid; v_t jsonb;
begin
  v_c := intel.ci_resolve_campaign(p_campaign);
  if v_c is null or not intel.ci_can_manage_campaign(v_c) then raise exception 'not your campaign' using errcode = '42501'; end if;
  v_t := api.campaign_wa_targets(p_campaign,
           (select array_agg(i.invite_id) from intel.ci_campaign_invite i where i.campaign_id = v_c),
           (select array_agg(p.participation_id) from intel.ci_campaign_participation p where p.campaign_id = v_c));
  return coalesce((select jsonb_agg(jsonb_build_object('key', t->>'key', 'until', w.until))
    from jsonb_array_elements(coalesce(v_t->'targets', '[]'::jsonb)) t
    join lateral (select max(c.session_expires_at) until from public.wa_conversations c
                   where c.contact_phone_e164 = t->>'phone') w on w.until > now()
   where t->>'phone' is not null), '[]'::jsonb);
end $$;
revoke all on function api.campaign_wa_open_windows(uuid) from public, anon;
grant execute on function api.campaign_wa_open_windows(uuid) to authenticated;
