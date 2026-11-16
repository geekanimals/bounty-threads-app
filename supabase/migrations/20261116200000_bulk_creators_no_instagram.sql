-- Creators added by a bulk upload (the team already picked them) do NOT need Instagram connected:
-- they can join, see their campaign and do every step (contract, address, video, post) with WhatsApp only.
-- Everyone else still connects Instagram (media kit) before applying.
create or replace function intel.ci_is_bulk_creator(p_member uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_member is not null and exists (
    select 1 from intel.ci_campaign_invite i
     where i.claimed_by = p_member or i.reserved_by = p_member
        or (i.phone_e164 is not null and i.phone_e164 in (
              select w.phone_e164 from public.wa_contacts w where w.user_id = p_member and w.verified_at is not null))) $$;
revoke all on function intel.ci_is_bulk_creator(uuid) from public, anon, authenticated;

create or replace function intel.ci_join_needs(p_member uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when p_member is null then '[]'::jsonb else
    case when exists (select 1 from public.social_accounts sa where sa.member_id = p_member and sa.platform = 'instagram' and coalesce(sa.username,'') <> '')
              or exists (select 1 from private.ig_linked_accounts l where l.member_id = p_member)
              or intel.ci_is_bulk_creator(p_member)
         then '[]'::jsonb else '["Connect Instagram (media kit)"]'::jsonb end
    || case when exists (select 1 from public.wa_contacts w where w.user_id = p_member and w.verified_at is not null)
         then '[]'::jsonb else '["Connect WhatsApp"]'::jsonb end end $$;
