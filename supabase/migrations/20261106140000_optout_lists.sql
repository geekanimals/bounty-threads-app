-- Team side: which WhatsApp numbers / emails have stopped updates, so every creator card can show
-- "WhatsApp ON / OFF" and "Email ON / OFF" next to the number and the address. Staff only (no creators). ADDITIVE.
create or replace function api.optout_lists()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.is_platform_admin() or exists (select 1 from public.members m where m.id = auth.uid() and m.role in ('owner','manager','corporate','brand'))) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object(
    'wa', coalesce((select jsonb_agg(distinct right(d, 10)) from (
              select regexp_replace(o.phone_e164, '\D', '', 'g') d from public.wa_phone_optout o
              union select regexp_replace(c.phone_e164, '\D', '', 'g') from public.wa_contacts c where c.opt_out_at is not null) x
            where length(d) >= 10), '[]'::jsonb),
    'em', coalesce((select jsonb_agg(distinct e) from (
              select o.email e from public.email_optout o
              union select private.email_key(m.email) from public.members m where m.email_opt_out_at is not null
              union select private.email_key(u.email::text) from public.members m join auth.users u on u.id = m.id where m.email_opt_out_at is not null) y
            where e is not null), '[]'::jsonb));
end $$;
revoke all on function api.optout_lists() from public, anon;
grant execute on function api.optout_lists() to authenticated;
