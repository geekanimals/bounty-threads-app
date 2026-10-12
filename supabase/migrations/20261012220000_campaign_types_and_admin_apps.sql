-- Paid / Barter split end to end + organised Super Admin applications + creator gets a decline update. ADDITIVE.

-- 1) applicants carry the campaign type (paid / barter / barter + paid) and the owning workspace
create or replace function api.org_applicants(p_campaign uuid default null, p_stage text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_all boolean;
begin
  if v_uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  v_all := intel.ci_is_agency_operator();
  if p_campaign is not null and not intel.ci_can_manage_campaign(p_campaign) then
    raise exception 'not authorised for this campaign' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(rr order by (rr->>'applied_at') desc) from (
    select jsonb_build_object('participation_id', p.participation_id, 'campaign_id', c.campaign_id,
             'legacy_campaign_id', c.legacy_campaign_id, 'campaign_name', c.name,
             'brand', c.submitted_brand_name, 'comp_type', c.comp_type,
             'campaign_type', coalesce(br.requirements->>'campaign_type',
                                       case c.comp_type when 'cash' then 'paid' when 'hybrid' then 'barter_paid' when 'barter' then 'barter' end),
             'org_name', (select m.org_name from public.members m where m.org_id = c.org_id and m.org_name is not null limit 1),
             'stage', p.stage, 'reason', p.reason, 'reason_code', p.reason_code,
             'applied_at', p.created_at, 'updated_at', p.updated_at, 'creator', intel.ci_public_creator_card(p.identity_id)) rr
      from intel.ci_campaign_participation p join intel.ci_campaign c on c.campaign_id = p.campaign_id
      left join lateral (select requirements from intel.ci_campaign_brief b where b.campaign_id = c.campaign_id order by b.created_at desc limit 1) br on true
     where (p_campaign is null or c.campaign_id = p_campaign)
       and (p_stage is null or p.stage = p_stage)
       and (v_all or intel.ci_can_manage_campaign(c.campaign_id))
     order by p.created_at desc limit 1000) s), '[]'::jsonb);
end $$;
revoke all on function api.org_applicants(uuid, text) from public, anon;
grant execute on function api.org_applicants(uuid, text) to authenticated;

-- 2) creator is told (Alerts + WhatsApp/email outbox) when an application is not selected
insert into intel.ci_notification_template(template_key, kind, title, body_md, action_route, action_label) values
  ('not_selected','info','Update on {{campaign}}',
   'Thanks for applying to {{campaign}}. The brand has gone with other creators this time — keep your profile updated, new campaigns open every week.',
   'mycampaigns','See open campaigns')
on conflict (template_key) do nothing;
-- agencies & brands review applications in Approvals (operators still have the pipeline board)
update intel.ci_notification_template
   set action_route = 'approvals', body_md = 'A creator applied. Approve or decline them in Approvals.'
 where template_key = 'applied_received';

create or replace function intel.tg_notify_creator_not_selected()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_identity uuid; v_infl uuid; v_name text;
begin
  if NEW.entity <> 'participation' or NEW.to_status not in ('ineligible','brand_declined') then return null; end if;
  if not intel.ci_feature_enabled('operational_pilot') then return null; end if;
  select identity_id into v_identity from intel.ci_campaign_participation where participation_id = NEW.participation_id;
  v_infl := intel.ci_member_of_identity(v_identity);
  select name into v_name from intel.ci_campaign where campaign_id = NEW.campaign_id;
  perform intel.ci_notify(v_infl, NEW.campaign_id, NEW.participation_id, 'not_selected',
                          jsonb_build_object('campaign', coalesce(v_name,'the campaign')));
  return null;
exception when others then
  raise warning 'not_selected notify skipped: %', sqlerrm;   -- never block a decision on a notification
  return null;
end $$;
revoke all on function intel.tg_notify_creator_not_selected() from public, anon, authenticated;
drop trigger if exists ci_event_notify_not_selected on intel.ci_campaign_event;
create trigger ci_event_notify_not_selected after insert on intel.ci_campaign_event
  for each row execute function intel.tg_notify_creator_not_selected();
