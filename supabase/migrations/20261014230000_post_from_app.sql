-- "Let's post" goes straight to the in-app composer with everything filled in from the campaign:
-- what to post (Reel / Story / Post — from the contract deliverables, next one still to go first), the caption
-- from the brief, the brand's @mentions + #hashtags, collaborator, #ad, and the approved video to download.
-- Every format in the deliverables can be posted and recorded (not just the first one). ADDITIVE.

create or replace function api.get_my_posting_rules()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid; v_identity uuid;
begin
  perform intel.ci_assert_api_enabled('operational_pilot');
  v_uid := auth.uid();
  if v_uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  select a.identity_id into v_identity from intel.ci_identity_actor_access a
   where a.member_id = v_uid and a.access_role = 'self' and a.revoked_at is null
   order by a.granted_at limit 1;
  if v_identity is null then return '[]'::jsonb; end if;

  return coalesce((select jsonb_agg(jsonb_build_object(
      'participation_id', p.participation_id,
      'campaign_id', c.campaign_id,
      'campaign', c.name,
      'brand', coalesce(b.name, c.submitted_brand_name),
      'stage', p.stage,
      'can_record_post', p.stage in ('content_approved', 'published'),
      'hashtags', coalesce(br.requirements->'hashtags', '[]'::jsonb),
      'mentions', coalesce(br.requirements->'mentions', '[]'::jsonb),
      'product', pb->'contract'->>'product',
      'collab_rights', coalesce((pb->'contract'->>'collab_rights')::boolean, true),
      'caption', pb->'brief'->>'caption',
      'brief_hashtags', pb->'brief'->>'hashtags',
      'brief_mentions', pb->'brief'->>'mentions',
      'posting_note', pb->'brief'->>'posting_note',
      'deliverables_text', pb->'brief'->>'deliverables_text',
      'approved_video', (select s.content_url from intel.ci_campaign_submission s
                           join intel.ci_campaign_deliverable d on d.deliverable_id = s.deliverable_id
                          where d.participation_id = p.participation_id order by s.submitted_at desc limit 1),
      -- what still has to go up: [{kind: reel|story|feed, label, need, done}]
      'formats', (
        with req as (
          select case f.k when 'reel' then 'reel' when 'story' then 'story' else 'feed' end as kind, sum(f.q)::int as need
            from (select d.content_format as k, greatest(coalesce(d.quantity,1),1) as q
                    from intel.ci_campaign_deliverable d where d.participation_id = p.participation_id
                  union all
                  select x->>'format_key', greatest(coalesce(nullif(x->>'quantity','')::int,1),1)
                    from jsonb_array_elements(coalesce(intel.ci_parse_deliverables(pb->'contract'->>'deliverables'), '[]'::jsonb)) x
                   where not exists (select 1 from intel.ci_campaign_deliverable d where d.participation_id = p.participation_id)) f
           where f.k in ('reel','story','static_post','carousel')
           group by 1),
        req2 as (select * from req union all select 'reel', 1 where not exists (select 1 from req)),
        done as (
          select case po.media_type when 'reel' then 'reel' when 'story' then 'story' else 'feed' end as kind, count(*)::int as n
            from intel.ci_campaign_post po where po.participation_id = p.participation_id group by 1)
        select coalesce(jsonb_agg(jsonb_build_object('kind', r.kind,
                 'label', case r.kind when 'reel' then 'Reel' when 'story' then 'Story' else 'Post' end,
                 'need', r.need, 'done', coalesce(dn.n, 0))
               order by case r.kind when 'reel' then 1 when 'feed' then 2 else 3 end), '[]'::jsonb)
          from req2 r left join done dn on dn.kind = r.kind))
      order by p.updated_at desc)
    from intel.ci_campaign_participation p
    join intel.ci_campaign c on c.campaign_id = p.campaign_id
    left join intel.ci_brand b on b.brand_id = c.brand_id
    left join lateral (select requirements from intel.ci_campaign_brief x
                        where x.campaign_id = c.campaign_id order by x.created_at desc limit 1) br on true
    cross join lateral (select intel.ci_playbook(c.campaign_id) as pb) pl
    where p.identity_id = v_identity
      and p.stage not in ('rejected', 'dropped', 'ineligible', 'brand_declined', 'completed')), '[]'::jsonb);
end $$;
revoke all on function api.get_my_posting_rules() from public, anon;
grant execute on function api.get_my_posting_rules() to authenticated, service_role;
