-- Delivery log: each WhatsApp drip row also carries the number we would use today (corrected sheet number or the
-- creator's verified WhatsApp), so old rows that went to a wrong (Timestamp) number show as "fixed since". (19 Nov 2026)
do $x$ declare d text := pg_get_functiondef('api.campaign_delivery_log(uuid,integer)'::regprocedure); o text; begin
  if position('''now_to''' in d) > 0 then return; end if;
  o := $o$'phone_ok', private.phone_looks_real(q.phone),$o$;
  if position(o in d) = 0 then raise exception 'anchor not found'; end if;
  d := replace(d, o, o || $n$
        'now_to', coalesce(case when private.phone_looks_real(i.phone_e164) then i.phone_e164 end,
                           (select w.phone_e164 from public.wa_contacts w where w.user_id = coalesce(q.member_id, i.claimed_by) and private.phone_looks_real(w.phone_e164) limit 1)),$n$);
  execute d;
end $x$;
-- (data fix done once on 19 Nov: 13 Wedding invites with a Timestamp-as-phone got the creator's own verified WhatsApp)
