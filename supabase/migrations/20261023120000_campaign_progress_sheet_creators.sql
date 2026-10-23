-- Campaign cards: progress now counts the creators who are only on the bulk sheet too (not registered on Geek OS),
-- read from their sheet status — so "Pujo with Olio" shows 61/63 done, not 39/40.
create or replace function api.campaigns_progress()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  return coalesce((
    select jsonb_object_agg(c.legacy_campaign_id::text, jsonb_build_object(
             'pct', case when s.active + v.active = 0 then 0 else round(100.0 * (s.score + v.score) / ((s.active + v.active) * 10)) end,
             'done', s.done + v.done, 'active', s.active + v.active, 'applied', s.applied + v.applied,
             'on_sheet', v.active))
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
      cross join lateral (   -- sheet / invited creators not on the campaign as a participation yet
        select count(*) filter (where coalesce(i.status,'registered') not in ('registered','invited','screened','sent_to_brand')) as active,
               count(*) filter (where i.status = 'posted') as done,
               count(*) filter (where coalesce(i.status,'registered') in ('screened','sent_to_brand')) as applied,
               coalesce(sum(case i.status when 'approved' then 0 when 'contract_sent' then 1 when 'contract_signed' then 2 when 'address_confirmed' then 3
                    when 'courier_sent' then 4 when 'courier_delivered' then 5 when 'video_brief_sent' then 5 when 'video_submitted' then 6
                    when 'client_approved' then 7 when 'posted' then 10 else 0 end), 0) as score
          from intel.ci_campaign_invite i where i.campaign_id = c.campaign_id and i.participation_id is null) v
     where c.legacy_campaign_id is not null and intel.ci_can_manage_campaign(c.campaign_id)), '{}'::jsonb);
end $$;
revoke all on function api.campaigns_progress() from public, anon;
grant execute on function api.campaigns_progress() to authenticated;
