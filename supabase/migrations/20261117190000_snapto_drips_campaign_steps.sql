-- Snapto WhatsApp drips for the remaining campaign steps (all Utility templates, sent only through drips).
--   01 bulk invite (new creator, not registered yet)  → stops on done_join   (invite claimed)
--   07 product shipped (1 message)
--   08 product delivered + video brief                 → stops on done_video  (video submitted)
--   09 video due / overdue (3 days after delivery)     → stops on done_video
--   13 video approved, please post                     → stops on done_post   (post published / completed)
--   14 campaign completed (1 message)
-- Webhook ids live in the SNAPTO_DRIP_CONFIG secret (keys 01, 07, 08, 09, 13, 14, done_join, done_video, done_post).
-- Button links: https://bounty.geekcreativeagency.com/creator/my-campaigns/{campaign_path}  (01: /creator/{invite_path})

-- ---------- enqueue by phone (invite: no member yet) ----------
create or replace function private.snapto_enqueue_phone(p_kind text, p_drip text, p_phone text, p_attrs jsonb, p_dedupe text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
begin
  if v_phone is null then return; end if;
  if left(v_phone, 1) <> '+' then
    v_phone := regexp_replace(v_phone, '\D', '', 'g');
    if length(v_phone) = 10 then v_phone := '+91' || v_phone; else v_phone := '+' || v_phone; end if;
  end if;
  if p_kind = 'start' and not private.snapto_on() then return; end if;
  if exists (select 1 from public.wa_contacts w where w.phone_e164 = v_phone and w.opt_out_at is not null) then return; end if;
  insert into private.snapto_drip_queue(kind, drip, member_id, phone, attrs, dedupe)
  values (p_kind, p_drip, null, v_phone, coalesce(p_attrs, '{}'), p_dedupe)
  on conflict (dedupe) do nothing;
exception when others then
  raise warning 'snapto enqueue (phone) skipped: %', sqlerrm;
end $$;
revoke all on function private.snapto_enqueue_phone(text, text, text, jsonb, text) from public, anon, authenticated;

-- ---------- "30 Nov 2026" ----------
create or replace function private.snapto_day(p_at timestamptz) returns text language sql immutable set search_path = '' as $$
  select to_char(p_at at time zone 'Asia/Kolkata', 'FMDD Mon YYYY')
$$;

-- ---------- campaign steps (intel.ci_notification) ----------
create or replace function private.tg_snapto_campaign_step() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_key text := split_part(coalesce(NEW.dedupe_key, ''), ':', 1); v_member uuid; v_identity uuid; v_cname text; v_addr text;
        v_stage text; v_first text; v_pid text; v_courier text; v_track text; v_due timestamptz; v_days int;
begin
  if NEW.participation_id is null or v_key not in ('contract_sent', 'confirm_address', 'contract_signed_ops', 'address_confirmed',
      'product_shipped', 'parcel_received', 'video_due', 'content_for_review', 'content_approved', 'published', 'completed') then
    return null;
  end if;
  select identity_id, stage into v_identity, v_stage from intel.ci_campaign_participation where participation_id = NEW.participation_id;
  v_member := intel.ci_member_of_identity(v_identity);
  select c.name into v_cname from intel.ci_campaign c where c.campaign_id = NEW.campaign_id;
  v_cname := coalesce(v_cname, 'your campaign');
  v_pid := NEW.participation_id::text;
  v_first := coalesce(nullif(private.snapto_first_name(v_member), ''), 'there');

  if v_key = 'contract_sent' then
    perform private.snapto_enqueue('start', '10', v_member,
      jsonb_build_object('campaign_name', v_cname, 'agreement_path', v_pid || '/agreement'), 'start:10:' || v_pid);
  elsif v_key = 'confirm_address' then
    perform private.snapto_enqueue('done', 'contract', v_member, '{}', 'done:contract:' || v_pid);
    select concat_ws(', ', nullif(a.line1, ''), nullif(a.line2, ''), nullif(a.landmark, ''), nullif(a.city, ''), nullif(a.state, ''), nullif(a.postal_code, ''))
      into v_addr from private.creator_address a
     where a.identity_id = v_identity and a.deleted_at is null order by a.is_default desc, a.updated_at desc limit 1;
    perform private.snapto_enqueue('start', '12', v_member,
      jsonb_build_object('campaign_name', v_cname, 'delivery_address', coalesce(nullif(v_addr, ''), 'not added yet'),
                         'address_path', v_pid || '/address'), 'start:12:' || v_pid);
  elsif v_key = 'contract_signed_ops' then
    perform private.snapto_enqueue('done', 'contract', v_member, '{}', 'done:contract:' || v_pid);
  elsif v_key = 'address_confirmed' then
    perform private.snapto_enqueue('done', 'address', v_member, '{}', 'done:address:' || v_pid);

  elsif v_key = 'product_shipped' then
    select s.courier, s.tracking_ref into v_courier, v_track from intel.ci_campaign_shipment s
     where s.participation_id = NEW.participation_id order by s.created_at desc limit 1;
    perform private.snapto_enqueue('start', '07', v_member,
      jsonb_build_object('creator_name', v_first, 'campaign_name', v_cname,
                         'courier', coalesce(nullif(btrim(v_courier), ''), 'our courier partner'),
                         'tracking_id', coalesce(nullif(btrim(v_track), ''), 'on your campaign page'),
                         'campaign_path', v_pid || '/package'), 'start:07:' || v_pid);

  elsif v_key = 'parcel_received' then
    select min(d.expected_by) into v_due from intel.ci_campaign_deliverable d where d.participation_id = NEW.participation_id;
    if v_due is null then
      select k.content_days into v_days from intel.ci_campaign_contract k where k.participation_id = NEW.participation_id order by k.issued_at desc nulls last limit 1;
      v_due := now() + make_interval(days => coalesce(v_days, 3));
    end if;
    perform private.snapto_enqueue('start', '08', v_member,
      jsonb_build_object('creator_name', v_first, 'campaign_name', v_cname, 'due_date', private.snapto_day(v_due),
                         'campaign_path', v_pid || case when v_stage in ('content_created', 'changes_requested') then '/draft' else '/package' end),
      'start:08:' || v_pid);

  elsif v_key = 'video_due' then
    if v_stage not in ('content_submitted', 'content_approved', 'published', 'completed') then
      perform private.snapto_enqueue('start', '09', v_member,
        jsonb_build_object('creator_name', v_first, 'campaign_name', v_cname, 'campaign_path', v_pid || '/draft'), 'start:09:' || v_pid);
    end if;

  elsif v_key = 'content_for_review' then
    perform private.snapto_enqueue('done', 'video', v_member, '{}', 'done:video:' || v_pid || ':' || NEW.notification_id);

  elsif v_key = 'content_approved' then
    perform private.snapto_enqueue('done', 'video', v_member, '{}', 'done:video:' || v_pid || ':approved');
    perform private.snapto_enqueue('start', '13', v_member,
      jsonb_build_object('creator_name', v_first, 'campaign_name', v_cname, 'campaign_path', v_pid || '/post'), 'start:13:' || v_pid);

  elsif v_key = 'published' then
    perform private.snapto_enqueue('done', 'post', v_member, '{}', 'done:post:' || v_pid);

  elsif v_key = 'completed' then
    perform private.snapto_enqueue('done', 'post', v_member, '{}', 'done:post:' || v_pid);
    perform private.snapto_enqueue('start', '14', v_member,
      jsonb_build_object('creator_name', v_first, 'campaign_name', v_cname, 'campaign_path', v_pid), 'start:14:' || v_pid);
  end if;
  return null;
exception when others then
  raise warning 'snapto campaign step skipped: %', sqlerrm;
  return null;
end $$;

-- ---------- 01: bulk invite for a creator who has no account yet ----------
create or replace function private.tg_snapto_invite() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_cname text; v_phone text := nullif(btrim(coalesce(NEW.phone_e164, '')), ''); v_first text;
begin
  if v_phone is null then return null; end if;
  if TG_OP = 'INSERT' then
    if NEW.claimed_at is not null then return null; end if;
    -- already has an account with this number → they get the step drips instead
    if exists (select 1 from public.members m where m.whatsapp_e164 = v_phone)
       or exists (select 1 from public.wa_contacts w where w.phone_e164 = v_phone and w.user_id is not null) then
      return null;
    end if;
    select c.name into v_cname from intel.ci_campaign c where c.campaign_id = NEW.campaign_id;
    v_first := coalesce(nullif(split_part(btrim(coalesce(NEW.full_name, '')), ' ', 1), ''), 'there');
    perform private.snapto_enqueue_phone('start', '01', v_phone,
      jsonb_build_object('creator_name', left(v_first, 40), 'campaign_name', coalesce(v_cname, 'your campaign'),
                         'invite_path', case when NEW.token is not null then 'login?cinv=' || NEW.token::text else 'login' end),
      'start:01:' || NEW.invite_id);
  elsif NEW.claimed_at is not null and OLD.claimed_at is null then
    perform private.snapto_enqueue_phone('done', 'join', v_phone, '{}', 'done:join:' || NEW.invite_id);
  end if;
  return null;
exception when others then
  raise warning 'snapto invite skipped: %', sqlerrm;
  return null;
end $$;
drop trigger if exists snapto_invite on intel.ci_campaign_invite;
create trigger snapto_invite after insert or update of claimed_at on intel.ci_campaign_invite
  for each row execute function private.tg_snapto_invite();
