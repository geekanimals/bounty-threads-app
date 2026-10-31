-- 🛑 The WhatsApp panel's "said STOP" check only looked at wa_contacts (members). A STOP from a creator who is not on the
-- app yet is kept in wa_phone_optout — count that too, so the panel leaves them out (wa-send also refuses them now).
do $mig$
declare v_def text;
begin
  select pg_get_functiondef('api.campaign_wa_targets(uuid,uuid[],uuid[])'::regprocedure) into v_def;
  v_def := replace(v_def,
    'exists (select 1 from public.wa_contacts w where w.phone_e164 = i.phone_e164 and w.opt_out_at is not null)',
    '(exists (select 1 from public.wa_contacts w where w.phone_e164 = i.phone_e164 and w.opt_out_at is not null) or exists (select 1 from public.wa_phone_optout po where po.phone_e164 = i.phone_e164 and po.opt_out_at is not null))');
  v_def := replace(v_def,
    'exists (select 1 from public.wa_contacts w where w.phone_e164 = ph.phone and w.opt_out_at is not null)',
    '(exists (select 1 from public.wa_contacts w where w.phone_e164 = ph.phone and w.opt_out_at is not null) or exists (select 1 from public.wa_phone_optout po where po.phone_e164 = ph.phone and po.opt_out_at is not null))');
  if v_def not like '%wa_phone_optout po where po.phone_e164 = i.phone_e164%' or v_def not like '%wa_phone_optout po where po.phone_e164 = ph.phone%' then
    raise exception 'campaign_wa_targets: opt-out text not found — not patched';
  end if;
  execute v_def;
end $mig$;
