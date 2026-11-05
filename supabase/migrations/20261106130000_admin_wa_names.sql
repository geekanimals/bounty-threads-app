-- Messages inbox (Super Admin): a name / @handle for every WhatsApp chat number — linked members first, then the
-- campaign invite / bulk upload row for creators who haven't joined yet (the app also uses admin_users). ADDITIVE.
create or replace function api.admin_wa_names()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then raise exception 'not a platform admin' using errcode = '42501'; end if;
  return coalesce((
    with conv as (select distinct regexp_replace(c.contact_phone_e164, '\D', '', 'g') k, private.wa_phone_key(c.contact_phone_e164) pk
                    from public.wa_conversations c where c.contact_phone_e164 is not null),
         mem as (select distinct on (pk) private.wa_phone_key(wc.phone_e164) pk, nullif(nullif(m.name, ''), 'Creator') n
                   from public.wa_contacts wc join public.members m on m.id = wc.user_id order by pk),
         inv as (select distinct on (pk) private.wa_phone_key(x.phone_e164) pk, nullif(x.full_name, '') n, nullif(x.handle, '') h
                   from intel.ci_campaign_invite x where x.phone_e164 is not null order by pk, x.created_at desc)
    select jsonb_object_agg(conv.k, jsonb_build_object('n', coalesce(mem.n, inv.n), 'h', inv.h))
      from conv left join mem on mem.pk = conv.pk left join inv on inv.pk = conv.pk
     where coalesce(mem.n, inv.n, inv.h) is not null), '{}'::jsonb);
end $$;
revoke all on function api.admin_wa_names() from public, anon;
grant execute on function api.admin_wa_names() to authenticated;
