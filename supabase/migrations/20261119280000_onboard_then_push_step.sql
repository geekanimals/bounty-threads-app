-- Onboarding, then push the campaign step: Instagram drip -> Profile drip -> the creator's current campaign step drip.
-- Never two at once. Step drips go only 9 AM – 9 PM IST and only once (same dedupe as before, so no repeats).
create or replace function private.ci_push_member_step(p_member uuid)
returns int language plpgsql security definer set search_path = '' as $function$
declare r record; v_n int := 0;
begin
  for r in
    with m(stage, key, drips) as (values
      ('contract_sent',    'contract_sent',    array['10']),
      ('contract_signed',  'confirm_address',  array['12']),
      ('product_sent',     'product_shipped',  array['07']),
      ('content_created',  'video_due',        array['08','09']),
      ('content_approved', 'content_approved', array['13']))
    select p.participation_id, p.campaign_id, c.name cname, m.key
      from intel.ci_campaign_participation p
      join intel.ci_campaign c on c.campaign_id = p.campaign_id
      join m on m.stage = p.stage
     where intel.ci_member_of_identity(p.identity_id) = p_member
       and c.lifecycle_status = 'in_execution' and private.snapto_campaign_on(p.campaign_id)
       and not exists (select 1 from private.snapto_drip_queue q
                        where q.kind = 'start' and q.drip = any (m.drips)
                          and q.dedupe like 'start:' || q.drip || ':' || p.participation_id || '%')
     order by p.updated_at
     limit 1                                   -- one step at a time
  loop
    perform intel.ci_notify(p_member, r.campaign_id, r.participation_id, r.key,
      jsonb_build_object('campaign', coalesce(r.cname, 'your campaign'), 'participation_id', r.participation_id::text));
    v_n := v_n + 1;
  end loop;
  return v_n;
end $function$;

create or replace function private.ci_onboard_sweep()
returns int language plpgsql security definer set search_path = '' as $function$
declare r record; v_ig boolean; v_prof boolean; v_name text; v_n int := 0;
        v_day boolean := extract(hour from now() at time zone 'Asia/Kolkata') between 9 and 20;
begin
  -- did the task early -> handle now
  update private.creator_onboard_check c set due_at = now()
   where c.done_at is null and c.due_at > now() and (
     (c.stage = 'ig' and exists (select 1 from public.social_accounts s where s.member_id = c.member_id and s.platform = 'instagram' and s.ig_user_id is not null))
     or (c.stage = 'profile' and coalesce((select pc.completion_pct from intel.ci_profile_completion pc where pc.identity_id = intel.ci_member_identity(c.member_id)), 0) >= 100));

  for r in select * from private.creator_onboard_check where done_at is null and due_at <= now() order by due_at limit 200 for update skip locked loop
    v_ig := exists (select 1 from public.social_accounts s where s.member_id = r.member_id and s.platform = 'instagram' and s.ig_user_id is not null);
    v_prof := coalesce((select pc.completion_pct from intel.ci_profile_completion pc where pc.identity_id = intel.ci_member_identity(r.member_id)), 0) >= 100;
    v_name := private.snapto_first_name(r.member_id);
    if r.stage = 'first' and not v_ig then
      perform private.snapto_enqueue('start', '04', r.member_id, jsonb_build_object('creator_name', v_name), 'start:04:' || r.member_id);
      update private.creator_onboard_check set stage = 'ig', due_at = now() + interval '96 hours', note = 'instagram drip started' where member_id = r.member_id;
    elsif r.stage in ('first', 'ig') and not v_prof then
      perform private.snapto_enqueue('start', '02', r.member_id, jsonb_build_object('creator_name', v_name), 'start:02:' || r.member_id);
      update private.creator_onboard_check set stage = 'profile', due_at = now() + interval '48 hours', note = 'profile drip started' where member_id = r.member_id;
    elsif v_day then
      -- Instagram + profile handled -> the campaign step they are on (contract, address, video, post …)
      update private.creator_onboard_check
         set stage = 'done', done_at = now(),
             note = case when private.ci_push_member_step(r.member_id) > 0 then 'campaign step drip started' else 'no campaign step waiting on the creator' end
       where member_id = r.member_id;
    else
      update private.creator_onboard_check set stage = 'push', due_at = now() + interval '1 hour', note = 'waiting for day time to push the step' where member_id = r.member_id;
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $function$;
