-- Brand portal: same step names as admin + creator (13 steps). Keys/steps unchanged → brand filters & tabs keep working.
-- Also fixes product_delivered, which fell through to "Not selected".
create or replace function intel.ci_brand_stage(p_stage text)
returns jsonb language sql immutable set search_path = '' as $function$
  select case p_stage
    when 'applied'           then '{"key":"screening","label":"Applied","step":0}'
    when 'eligible'          then '{"key":"screening","label":"Screened","step":0}'
    when 'sent_to_brand'     then '{"key":"to_approve","label":"Sent to brand · needs your approval","step":1}'
    when 'brand_confirmed'   then '{"key":"approved","label":"Approved","step":2}'
    when 'accepted'          then '{"key":"approved","label":"Approved","step":2}'
    when 'invited'           then '{"key":"approved","label":"Approved","step":2}'
    when 'shortlisted'       then '{"key":"approved","label":"Approved","step":2}'
    when 'contract_sent'     then '{"key":"approved","label":"Contract sent","step":2}'
    when 'contract_signed'   then '{"key":"approved","label":"Contract signed","step":2}'
    when 'address_confirmed' then '{"key":"approved","label":"Address confirmed","step":2}'
    when 'product_sent'      then '{"key":"shipped","label":"Courier sent","step":3}'
    when 'product_delivered' then '{"key":"shipped","label":"Courier delivered","step":3}'
    when 'content_created'   then '{"key":"making","label":"Video brief sent","step":3}'
    when 'changes_requested' then '{"key":"making","label":"Video submitted · changes asked","step":3}'
    when 'content_submitted' then '{"key":"video_review","label":"Video submitted · review it","step":4}'
    when 'content_approved'  then '{"key":"posting","label":"Client approved","step":5}'
    when 'published'         then '{"key":"posted","label":"Posted","step":6}'
    when 'completed'         then '{"key":"posted","label":"Posted","step":6}'
    else '{"key":"not_selected","label":"Not selected","step":0}' end::jsonb
$function$;
