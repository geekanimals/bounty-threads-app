-- 1) duplicate cron: ci-notify-dispatch and ops-notify-dispatch both called the same edge function every minute — keep one
select cron.alter_job(jobid, active := false) from cron.job where jobname = 'ci-notify-dispatch' and active;

-- 2) every detail we know about each creator of a campaign (sheet upload, contact, profile, address, Instagram)
create or replace function api.campaign_creator_extras(p_campaign uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_c uuid := intel.ci_resolve_campaign(p_campaign);
begin
  if v_c is null or not intel.ci_can_manage_campaign(v_c) then raise exception 'not your campaign' using errcode = '42501'; end if;
  return coalesce((select jsonb_object_agg(p.participation_id::text, jsonb_strip_nulls(jsonb_build_object(
      'email', coalesce(nullif(cc.email,''), nullif(inv.email,''), nullif(u.email,'')),
      'phone', coalesce(nullif(cc.whatsapp_e164,''), nullif(inv.phone_e164,'')),
      'name', coalesce(nullif(inv.full_name,'')),
      'city', coalesce(nullif(ad.city,''), nullif(pp.city_coarse,''), nullif(inv.city,'')),
      'state', coalesce(nullif(ad.state,''), nullif(pp.state_coarse,'')),
      'followers', coalesce(sa.followers_count, inv.followers),
      'followers_from', case when sa.followers_count is not null then 'instagram' when inv.followers is not null then 'sheet' end,
      'handle', coalesce(sa.username, nullif(inv.handle,'')),
      'from_sheet', inv.invite_id is not null)))
    from intel.ci_campaign_participation p
    left join lateral (select a.member_id from intel.ci_identity_actor_access a where a.identity_id = p.identity_id and a.access_role = 'self' and a.revoked_at is null order by a.granted_at limit 1) a on true
    left join lateral (select i.* from intel.ci_campaign_invite i where i.campaign_id = v_c and (i.claimed_by = a.member_id) order by i.created_at desc limit 1) inv0 on true
    left join lateral (select coalesce(inv0.invite_id, (select i.invite_id from intel.ci_campaign_invite i where i.claimed_by = a.member_id order by i.created_at desc limit 1), (select i.invite_id from intel.ci_campaign_invite i join public.members m on m.whatsapp_e164 = i.phone_e164 where m.id = a.member_id order by (i.campaign_id = v_c) desc, i.created_at desc limit 1)) iid) pick on true
    left join intel.ci_campaign_invite inv on inv.invite_id = pick.iid
    left join private.creator_contact cc on cc.identity_id = p.identity_id
    left join intel.ci_creator_professional_profile pp on pp.identity_id = p.identity_id
    left join lateral (select x.city, x.state from private.creator_address x where x.identity_id = p.identity_id and x.deleted_at is null order by x.is_default desc, x.created_at limit 1) ad on true
    left join lateral (select s.username, s.followers_count from public.social_accounts s where s.member_id = a.member_id and s.platform = 'instagram' order by s.followers_count desc nulls last limit 1) sa on true
    left join auth.users u on u.id = a.member_id
   where p.campaign_id = v_c), '{}'::jsonb);
end $$;
revoke all on function api.campaign_creator_extras(uuid) from public, anon;
grant execute on function api.campaign_creator_extras(uuid) to authenticated;

-- 3) sheet details → creator profile, automatically: when they sign up / log in with that number (claim), and when the sheet
--    row belongs to someone already on Geek OS (same WhatsApp). Only empty profile fields are filled — never overwritten.
create or replace function intel.tg_invite_claim_fill_profile() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_mem uuid; v_id uuid;
begin
  v_mem := NEW.claimed_by;
  if v_mem is null and coalesce(NEW.phone_e164,'') <> '' then
    select m.id into v_mem from public.members m where m.whatsapp_e164 = NEW.phone_e164 limit 1;
  end if;
  if v_mem is null then return null; end if;
  v_id := intel.ci_member_identity(v_mem);
  if v_id is null then return null; end if;
  insert into intel.ci_creator_professional_profile(identity_id, display_name, city_coarse, ig_handle_self, followers_self)
  values (v_id, nullif(btrim(coalesce(NEW.full_name,'')),''), nullif(btrim(coalesce(NEW.city,'')),''), nullif(btrim(coalesce(NEW.handle,'')),''), NEW.followers)
  on conflict (identity_id) do update set
    display_name = coalesce(nullif(intel.ci_creator_professional_profile.display_name,''), excluded.display_name),
    city_coarse = coalesce(nullif(intel.ci_creator_professional_profile.city_coarse,''), excluded.city_coarse),
    ig_handle_self = coalesce(nullif(intel.ci_creator_professional_profile.ig_handle_self,''), excluded.ig_handle_self),
    followers_self = coalesce(intel.ci_creator_professional_profile.followers_self, excluded.followers_self);
  return null;
exception when others then
  raise warning 'invite profile fill skipped: %', sqlerrm; return null;
end $$;
drop trigger if exists ci_invite_claim_fill_profile on intel.ci_campaign_invite;
create trigger ci_invite_claim_fill_profile after insert or update of claimed_by, phone_e164, full_name, city, handle, followers on intel.ci_campaign_invite
  for each row execute function intel.tg_invite_claim_fill_profile();
-- backfill: everyone who already signed up from a sheet, or is already on Geek OS with the same WhatsApp
update intel.ci_campaign_invite set claimed_by = claimed_by where claimed_by is not null;
update intel.ci_campaign_invite set phone_e164 = phone_e164 where claimed_by is null and phone_e164 is not null and exists (select 1 from public.members m where m.whatsapp_e164 = phone_e164);
