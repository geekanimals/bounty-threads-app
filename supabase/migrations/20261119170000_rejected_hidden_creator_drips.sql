-- Rejected creators (ineligible / brand_declined / dropped / rejected) stay only in the campaign's "Rejected"
-- box. Nothing is deleted — their account stays in the site's creator list.

-- 1) Delivery log: leave out messages of creators who are rejected in this campaign.
do $mig$
declare d text := pg_get_functiondef('api.campaign_delivery_log(uuid,integer)'::regprocedure);
begin
  if position('px.stage in' in d) = 0 then
    d := regexp_replace(d, '\(\(i\.campaign_id\s*=\s*v_c\)\s*or\s*\(p\.campaign_id\s*=\s*v_c\)',
      '(p.participation_id is null or p.stage not in (''ineligible'',''brand_declined'',''dropped'',''rejected'')) and ((i.campaign_id = v_c) or (p.campaign_id = v_c)');
    d := regexp_replace(d, 'where\s+o\.campaign_id\s*=\s*v_c',
      'where o.campaign_id = v_c and not exists (select 1 from intel.ci_campaign_participation px where px.participation_id = o.participation_id and px.stage in (''ineligible'',''brand_declined'',''dropped'',''rejected''))');
    if position('px.stage in' in d) = 0 or position('p.participation_id is null or p.stage not in' in d) = 0 then
      raise exception 'campaign_delivery_log: patch point not found';
    end if;
    execute d;
  end if;
end $mig$;

-- 2) Rejected (by Geek or by the brand) → every Snapto drip this creator had running for the campaign stops.
create or replace function intel.tg_reject_stop_drips() returns trigger
language plpgsql security definer set search_path = '' as $fn$
declare v_mem uuid; r record;
begin
  if new.stage in ('ineligible','brand_declined','dropped','rejected')
     and old.stage is distinct from new.stage
     and old.stage not in ('ineligible','brand_declined','dropped','rejected') then
    v_mem := intel.ci_member_of_identity(new.identity_id);
    for r in
      select distinct case when q.drip = '10' then 'contract' when q.drip = '12' then 'address'
                           when q.drip in ('07','08','09') then 'video' when q.drip in ('13','14') then 'post' end dn
        from private.snapto_drip_queue q
       where q.kind = 'start' and q.drip in ('07','08','09','10','12','13','14')
         and split_part(q.dedupe, ':', 3) = new.participation_id::text
    loop
      continue when r.dn is null or v_mem is null;
      perform private.snapto_enqueue_c(new.campaign_id, 'done', r.dn, v_mem, '{}'::jsonb,
        'done:' || r.dn || ':' || new.participation_id || ':rejected');
    end loop;
  end if;
  return null;
end $fn$;
drop trigger if exists zz_reject_stop_drips on intel.ci_campaign_participation;
create trigger zz_reject_stop_drips after update of stage on intel.ci_campaign_participation
  for each row execute function intel.tg_reject_stop_drips();

-- 3) Creator messages page: the Snapto WhatsApp drips of one creator (campaign steps, join link, profile).
create or replace function api.creator_drip_log(p_participation uuid default null, p_invite uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare v_camp uuid; v_ids text[] := '{}'; v_mem uuid; v_inv uuid; v_part uuid;
begin
  if p_participation is not null then
    select campaign_id, participation_id, intel.ci_member_of_identity(identity_id) into v_camp, v_part, v_mem
      from intel.ci_campaign_participation where participation_id = p_participation;
    select invite_id into v_inv from intel.ci_campaign_invite where participation_id = p_participation limit 1;
  elsif p_invite is not null then
    select campaign_id, invite_id, participation_id, claimed_by into v_camp, v_inv, v_part, v_mem
      from intel.ci_campaign_invite where invite_id = p_invite;
    if v_part is not null and v_mem is null then
      select intel.ci_member_of_identity(identity_id) into v_mem from intel.ci_campaign_participation where participation_id = v_part;
    end if;
  end if;
  if v_camp is null then return '[]'::jsonb; end if;
  if not intel.ci_can_operate_campaign(v_camp) then raise exception 'not your campaign' using errcode = '42501'; end if;
  v_ids := array_remove(array[v_part::text, v_inv::text], null);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', 'd' || q.id, 'at', q.created_at, 'sent_at', q.sent_at, 'kind', q.kind, 'drip', q.drip,
      'status', case when q.kind = 'done' then (case when q.sent_at is not null then 'stopped' else 'queued' end)
                     when q.error is not null then (case when q.error ilike 'skipped%' then 'skipped' else 'failed' end)
                     when q.sent_at is not null then 'sent' else 'queued' end,
      'error', q.error, 'attrs', q.attrs) order by q.created_at)
      from private.snapto_drip_queue q
     where split_part(q.dedupe, ':', 3) = any (v_ids)
        or (v_mem is not null and q.member_id = v_mem and q.drip in ('02','04','05','06','profile','instagram'))), '[]'::jsonb);
end $fn$;
revoke all on function api.creator_drip_log(uuid, uuid) from public, anon;
grant execute on function api.creator_drip_log(uuid, uuid) to authenticated;
