-- Campaign form, every field doing something:
--   • Status: Draft = hidden from creators · Live = creators can apply · Shortlist completed = running, no new applications ·
--     Completed = after the end date, on its own. Fix: a "Shortlist completed" campaign now also turns Completed on its own
--     after its end date (or when every creator is done) — before it stayed open for ever.
--   • Progress % is no longer typed by hand: it is worked out from where every creator is (contract → courier → video →
--     every post up) and shown on the campaign cards and the dashboard.
-- ADDITIVE: auto_complete_campaigns redefined (same signature), one new read function.

create or replace function public.auto_complete_campaigns()
returns int language plpgsql security definer set search_path = '' as $$
declare v_n int := 0; v_m int := 0; v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  update public.campaigns set status = 'Completed'
   where status in ('Live','Sourcing','In Production','Shortlist completed') and end_date is not null and end_date < v_today;
  get diagnostics v_n = row_count;
  -- every creator finished (and at least one posted) → the campaign is done
  update public.campaigns pc set status = 'Completed'
   where pc.status in ('Live','Sourcing','In Production','Shortlist completed')
     and exists (select 1 from intel.ci_campaign c join intel.ci_campaign_participation p on p.campaign_id = c.campaign_id
                  where c.legacy_campaign_id = pc.id and p.stage = 'completed')
     and not exists (select 1 from intel.ci_campaign c join intel.ci_campaign_participation p on p.campaign_id = c.campaign_id
                      where c.legacy_campaign_id = pc.id
                        and p.stage not in ('completed','dropped','rejected','ineligible','brand_declined'));
  get diagnostics v_m = row_count;
  return v_n + v_m;
end $$;
revoke all on function public.auto_complete_campaigns() from public, anon, authenticated;

-- progress of every campaign the caller can run: { "<campaigns.id>": {pct, done, active, posted} }
--   pct = how far the approved creators are, on the 14-step scale (approved … contract … courier … video … every post up)
create or replace function api.campaigns_progress()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  return coalesce((
    select jsonb_object_agg(c.legacy_campaign_id::text, jsonb_build_object(
             'pct', case when s.active = 0 then 0 else round(100.0 * s.score / (s.active * 10)) end,
             'done', s.done, 'active', s.active, 'applied', s.applied))
      from intel.ci_campaign c
      cross join lateral (
        select count(*) filter (where p.stage not in ('applied','eligible','sent_to_brand','invited','shortlisted','dropped','rejected','ineligible','brand_declined')) as active,
               count(*) filter (where p.stage = 'completed') as done,
               count(*) filter (where p.stage in ('applied','eligible','sent_to_brand','invited','shortlisted')) as applied,
               coalesce(sum(case p.stage when 'brand_confirmed' then 0 when 'accepted' then 0 when 'contract_sent' then 1 when 'contract_signed' then 2
                    when 'address_confirmed' then 3 when 'product_sent' then 4 when 'content_created' then 5 when 'changes_requested' then 5
                    when 'content_submitted' then 6 when 'content_approved' then 7
                    when 'published' then 7 + least(2, floor(2.0 * coalesce((intel.ci_deliverables_progress(p.participation_id)->>'done')::numeric, 0)
                                                     / greatest(coalesce((intel.ci_deliverables_progress(p.participation_id)->>'need')::numeric, 1), 1)))
                    when 'completed' then 10 else 0 end), 0) as score
          from intel.ci_campaign_participation p where p.campaign_id = c.campaign_id) s
     where c.legacy_campaign_id is not null and intel.ci_can_manage_campaign(c.campaign_id)), '{}'::jsonb);
end $$;
revoke all on function api.campaigns_progress() from public, anon;
grant execute on function api.campaigns_progress() to authenticated;
