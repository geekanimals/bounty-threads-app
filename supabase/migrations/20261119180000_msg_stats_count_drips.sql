-- Creators list "Messages" column: count the Snapto WhatsApp drips (what actually goes out now) and use them
-- for "last message". Before, only the old WhatsApp log was counted, so most creators showed 0 WhatsApp.
do $mig$
declare d text := pg_get_functiondef('private.campaign_msg_stats_live(uuid)'::regprocedure);
        ids text := $ids$split_part(q.dedupe, ':', 3) in (split_part(t.key, ':', 2), coalesce((select ii.invite_id::text from intel.ci_campaign_invite ii where t.key like 'p:%' and ii.participation_id::text = split_part(t.key, ':', 2) limit 1), '-'))$ids$;
begin
  if position('snapto_drip_queue' in d) = 0 then
    d := regexp_replace(d, '''wa'',\s*\(select count\(\*\) from intel\.ci_outbox o',
      '''wa'', (select count(*) from private.snapto_drip_queue q where q.kind = ''start'' and q.sent_at is not null and ' || ids || ') + (select count(*) from intel.ci_outbox o');
    d := regexp_replace(d, 'from \(\s*select coalesce\(o\.sent_at, o\.created_at\) as ts',
      'from ( select q.sent_at as ts, ''sent''::text as status, ''whatsapp''::text as channel, ''auto''::text as src from private.snapto_drip_queue q where q.kind = ''start'' and q.sent_at is not null and ' || ids || ' union all select coalesce(o.sent_at, o.created_at) as ts');
    if (length(d) - length(replace(d, 'snapto_drip_queue', ''))) / length('snapto_drip_queue') <> 2 then
      raise exception 'campaign_msg_stats_live: patch points not found';
    end if;
    execute d;
  end if;
end $mig$;

-- the drip lookups above (and api.creator_drip_log) match on the id inside the dedupe key
create index if not exists snapto_drip_queue_ref_idx on private.snapto_drip_queue ((split_part(dedupe, ':', 3))) where kind = 'start';
