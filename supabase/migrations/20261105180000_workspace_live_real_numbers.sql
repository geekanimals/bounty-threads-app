-- 🏠 Dashboard numbers from the real campaign data (they were read from the old demo tables, so the Super Admin saw
-- "1 creator", "1 live barter", "0 invites out", "0 products delivered"):
--   creators       → Geek OS creators (Super Admin) / creators on the workspace's campaigns (a workspace)
--   invites out    → uploaded / invited creators who haven't joined yet + participations still on "invited"
--   barter         → the campaigns' own shipments (shipped / delivered), plus anything still in the old table
--   campaigns      → + barter_live (barter and barter + paid campaigns that are live)
do $p$
declare d text; n text;
begin
  d := pg_get_functiondef('api.workspace_live()'::regprocedure);
  if position('ci_campaign_shipment' in d) > 0 then return; end if;
  n := replace(d, $a$    'creators', (select jsonb_build_object('roster', count(*),
        'added_today', count(*) filter (where created_at >= v_today))
      from public.creators c where v_admin or c.org_id = v_org),$a$,
  $a$    'creators', case when v_admin then
        (select jsonb_build_object('roster', count(*), 'added_today', count(*) filter (where m.created_at >= v_today))
           from public.members m where m.role = 'creator')
      else (select jsonb_build_object('roster', count(distinct p.identity_id), 'added_today', count(distinct p.identity_id) filter (where p.created_at >= v_today))
           from intel.ci_campaign_participation p join intel.ci_campaign c on c.campaign_id = p.campaign_id
          where c.org_id is not null and c.org_id = v_org) end,$a$);
  n := replace(n, $a$        'invited', count(*) filter (where p.stage = 'invited'),$a$,
  $a$        'invited', count(*) filter (where p.stage = 'invited')
                   + (select count(*) from intel.ci_campaign_invite i join intel.ci_campaign c2 on c2.campaign_id = i.campaign_id
                       where i.participation_id is null and i.claimed_at is null and (v_admin or (c2.org_id is not null and c2.org_id = v_org))),$a$);
  n := replace(n, $a$    'barter', (select jsonb_build_object('total', count(*),
        'shipped', count(*) filter (where lower(coalesce(stage,'')) in ('shipped','in transit','dispatched')),
        'delivered', count(*) filter (where lower(coalesce(stage,'')) = 'delivered'),
        'value', coalesce(sum(value), 0))
      from public.barter_items b where v_admin or b.org_id = v_org),$a$,
  $a$    'barter', (select jsonb_build_object('total', s.total + b.total, 'shipped', s.shipped + b.shipped, 'delivered', s.delivered + b.delivered, 'value', b.value)
      from (select count(*) total, count(*) filter (where sh.status = 'shipped') shipped, count(*) filter (where sh.status = 'delivered') delivered
              from intel.ci_campaign_shipment sh join intel.ci_campaign_participation p on p.participation_id = sh.participation_id
              join intel.ci_campaign c on c.campaign_id = p.campaign_id
             where v_admin or (c.org_id is not null and c.org_id = v_org)) s,
           (select count(*) total, count(*) filter (where lower(coalesce(stage,'')) in ('shipped','in transit','dispatched')) shipped,
                   count(*) filter (where lower(coalesce(stage,'')) = 'delivered') delivered, coalesce(sum(value), 0) value
              from public.barter_items bi where v_admin or bi.org_id = v_org) b),$a$);
  n := replace(n, $a$        'barter_paid', count(*) filter (where campaign_type = 'barter_paid'),$a$,
  $a$        'barter_paid', count(*) filter (where campaign_type = 'barter_paid'),
        'barter_live', count(*) filter (where campaign_type in ('barter','barter_paid') and status in ('Sourcing','Live','In Production')),$a$);
  if position('ci_campaign_shipment' in n) = 0 or position('barter_live' in n) = 0 or position('m.role = ''creator''' in n) = 0 or position('ci_campaign_invite i join' in n) = 0 then
    raise exception 'workspace_live not patched'; end if;
  execute n;
end $p$;
