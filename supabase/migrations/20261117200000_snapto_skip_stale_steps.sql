-- One message per step: when a creator jumps ahead (bulk upload at a later status, team fast-forward),
-- several step events land within the same minute. At send time only the drip for the creator's CURRENT
-- step may start; drips for steps already passed are marked skipped and never reach Snapto.
--   01 invite        → invite still not claimed
--   10 contract      → stage contract_sent
--   12 address       → stage contract_signed (and the campaign ships a product)
--   07 shipped       → stage product_sent, parcel not delivered yet
--   08 delivered     → stage product_sent / content_created / changes_requested
--   09 video due     → same as 08 (no video submitted yet)
--   13 post          → stage content_approved / published
--   14 completed     → stage completed
-- Blocked creators get no step drip. "done" rows and account drips (02, 04, 05, 06) are never skipped.

create or replace function private.snapto_start_valid(p_drip text, p_dedupe text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_ref text := split_part(coalesce(p_dedupe, ''), ':', 3); v_id uuid; v_stage text; v_blocked timestamptz; v_ship text;
begin
  if p_drip not in ('01', '07', '08', '09', '10', '12', '13', '14') then return true; end if;
  if split_part(coalesce(p_dedupe, ''), ':', 1) <> 'start' then return true; end if;   -- test / manual rows
  begin v_id := v_ref::uuid; exception when others then return true; end;

  if p_drip = '01' then
    return exists (select 1 from intel.ci_campaign_invite i where i.invite_id = v_id and i.claimed_at is null);
  end if;

  select p.stage, p.blocked_at into v_stage, v_blocked from intel.ci_campaign_participation p where p.participation_id = v_id;
  if v_stage is null then return false; end if;
  if v_blocked is not null and p_drip <> '09' then return false; end if;

  if p_drip = '10' then return v_stage = 'contract_sent';
  elsif p_drip = '12' then return v_stage = 'contract_signed';
  elsif p_drip = '07' then
    select s.status into v_ship from intel.ci_campaign_shipment s where s.participation_id = v_id order by s.created_at desc limit 1;
    return v_stage = 'product_sent' and coalesce(v_ship, '') <> 'delivered';
  elsif p_drip in ('08', '09') then return v_stage in ('product_sent', 'content_created', 'changes_requested');
  elsif p_drip = '13' then return v_stage in ('content_approved', 'published');
  elsif p_drip = '14' then return v_stage = 'completed';
  end if;
  return true;
exception when others then
  return true;
end $$;
revoke all on function private.snapto_start_valid(text, text) from public, anon, authenticated;

create or replace function api.ops_snapto_claim(p_limit int default 30)
returns setof private.snapto_drip_queue language plpgsql security definer set search_path = '' as $$
begin
  -- steps the creator has already moved past: skip, never send
  update private.snapto_drip_queue q
     set tries = 99, error = 'skipped: creator already moved past this step'
   where q.sent_at is null and q.tries < 5 and q.kind = 'start'
     and not private.snapto_start_valid(q.drip, q.dedupe);

  return query
  update private.snapto_drip_queue q set claimed_at = now(), tries = q.tries + 1
   where q.id in (select id from private.snapto_drip_queue
                   where sent_at is null and tries < 5 and (claimed_at is null or claimed_at < now() - interval '5 minutes')
                   order by created_at limit p_limit for update skip locked)
  returning q.*;
end $$;
revoke all on function api.ops_snapto_claim(int) from public, anon, authenticated;
grant execute on function api.ops_snapto_claim(int) to service_role;
