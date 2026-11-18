-- sheet → creator, matched by WhatsApp (or the invite they signed up with): name, city, state, Instagram, followers into the
-- profile, email into their contact — only where empty. What the creator fills in later always wins (never overwritten).
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
  insert into intel.ci_creator_professional_profile(identity_id, display_name, city_coarse, state_coarse, ig_handle_self, followers_self)
  values (v_id, nullif(btrim(coalesce(NEW.full_name,'')),''), nullif(btrim(coalesce(NEW.city, NEW.ship_address->>'city','')),''),
          nullif(btrim(coalesce(NEW.ship_address->>'state','')),''), nullif(btrim(coalesce(NEW.handle,'')),''), NEW.followers)
  on conflict (identity_id) do update set
    display_name = coalesce(nullif(intel.ci_creator_professional_profile.display_name,''), excluded.display_name),
    city_coarse = coalesce(nullif(intel.ci_creator_professional_profile.city_coarse,''), excluded.city_coarse),
    state_coarse = coalesce(nullif(intel.ci_creator_professional_profile.state_coarse,''), excluded.state_coarse),
    ig_handle_self = coalesce(nullif(intel.ci_creator_professional_profile.ig_handle_self,''), excluded.ig_handle_self),
    followers_self = coalesce(intel.ci_creator_professional_profile.followers_self, excluded.followers_self);
  if nullif(btrim(coalesce(NEW.email,'')),'') is not null then
    update private.creator_contact set email = lower(btrim(NEW.email)), updated_at = now() where identity_id = v_id and nullif(email,'') is null;
  end if;
  return null;
exception when others then
  raise warning 'invite profile fill skipped: %', sqlerrm; return null;
end $$;
drop trigger if exists ci_invite_claim_fill_profile on intel.ci_campaign_invite;
create trigger ci_invite_claim_fill_profile after insert or update of claimed_by, phone_e164, full_name, city, handle, followers, email, ship_address on intel.ci_campaign_invite
  for each row execute function intel.tg_invite_claim_fill_profile();
update intel.ci_campaign_invite set claimed_by = claimed_by where claimed_by is not null;
update intel.ci_campaign_invite set phone_e164 = phone_e164 where claimed_by is null and phone_e164 is not null and exists (select 1 from public.members m where m.whatsapp_e164 = phone_e164);
