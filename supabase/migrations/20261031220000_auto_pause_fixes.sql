-- 🔧 Review fixes for the ⏸ automatic-messages switch + the WhatsApp panel (31 Oct 2026)
-- 1) Invites: "Invite sent N×" / last_invited_at / status_messaged move ONLY when a message really went to the queue.
--    A reminder run while automatic messages are OFF (or an already-sent one) no longer counts as a send.
--    Each attempt gets its own dedupe key (txid) so a skipped attempt never blocks the next one (unique channel+dedupe_key).
-- 2) Buttons the team presses by hand go even while automatic messages are OFF: Resend invite, creator-upload Resend,
--    Send step message, Send email, Send contract (they set geek.manual_send).
-- 3) Panel "My own message": who replied in the last 24 h leaves out STOP — unless they wrote again after the STOP.
-- 4) The WhatsApp bot (auto replies) follows the switch too: api.ops_messaging_switches now returns auto_on.
do $mig$
declare d text; n text; f text;
begin
  -- 1a) campaign invites
  d := pg_get_functiondef('intel.ci_send_bulk_invite(uuid)'::regprocedure);
  n := replace(d, $a$'binv:' || i.invite_id || ':wa:' || (i.invites_sent + 1))$a$, $a$'binv:' || i.invite_id || ':wa:' || (i.invites_sent + 1) || ':' || txid_current())$a$);
  n := replace(n, $a$'binv:' || i.invite_id || ':em:' || (i.invites_sent + 1))$a$, $a$'binv:' || i.invite_id || ':em:' || (i.invites_sent + 1) || ':' || txid_current())$a$);
  n := replace(n, $a$  update intel.ci_campaign_invite set invites_sent = invites_sent + 1, last_invited_at = now(), status_messaged = v_st where invite_id = p_invite;$a$,
$a$  -- only what really went to the queue counts (paused / already-sent rows are skipped by the outbox triggers)
  v_n := (select count(*)::int from intel.ci_outbox o where o.status = 'queued'
           and o.dedupe_key in ('binv:' || i.invite_id || ':wa:' || (i.invites_sent + 1) || ':' || txid_current(),
                                'binv:' || i.invite_id || ':em:' || (i.invites_sent + 1) || ':' || txid_current()));
  if v_n > 0 then
    update intel.ci_campaign_invite set invites_sent = invites_sent + 1, last_invited_at = now(), status_messaged = v_st where invite_id = p_invite;
  end if;$a$);
  if n = d or position('txid_current()));' in n) = 0 or (length(n) - length(replace(n, ':' || chr(39) || ' || txid_current()', ''))) = 0 then
    raise exception 'ci_send_bulk_invite: text not found — not patched';
  end if;
  execute n;

  -- 1b) creator-upload (explore) invites
  d := pg_get_functiondef('intel.ci_send_join_invite(uuid)'::regprocedure);
  n := replace(d, $a$'join:' || u.id || ':wa:' || (u.invites_sent + 1))$a$, $a$'join:' || u.id || ':wa:' || (u.invites_sent + 1) || ':' || txid_current())$a$);
  n := replace(n, $a$'join:' || u.id || ':em:' || (u.invites_sent + 1))$a$, $a$'join:' || u.id || ':em:' || (u.invites_sent + 1) || ':' || txid_current())$a$);
  n := replace(n, $a$  if v_n > 0 then update intel.ci_creator_upload set invites_sent = invites_sent + 1, last_invited_at = now() where id = p_id; end if;$a$,
$a$  v_n := (select count(*)::int from intel.ci_outbox o where o.status = 'queued'
           and o.dedupe_key in ('join:' || u.id || ':wa:' || (u.invites_sent + 1) || ':' || txid_current(),
                                'join:' || u.id || ':em:' || (u.invites_sent + 1) || ':' || txid_current()));
  if v_n > 0 then update intel.ci_creator_upload set invites_sent = invites_sent + 1, last_invited_at = now() where id = p_id; end if;$a$);
  if n = d or position('v_n := (select count(*)::int from intel.ci_outbox' in n) = 0 then
    raise exception 'ci_send_join_invite: text not found — not patched';
  end if;
  execute n;

  -- 2) team buttons = by hand
  foreach f in array array['api.team_send_step(uuid,text)', 'api.team_send_email(uuid,text,text)',
                           'api.bp_send_contract(uuid)', 'api.creator_upload_resend(uuid)', 'api.bulk_resend_invite(uuid)'] loop
    d := pg_get_functiondef(f::regprocedure);
    if position('geek.manual_send' in d) > 0 then continue; end if;
    n := regexp_replace(d, '\mbegin\M', $a$begin
  perform set_config('geek.manual_send', 'on', true);   -- pressed by a person on the team → goes even while automatic messages are OFF$a$, 'i');
    if n = d then raise exception '% — no begin found', f; end if;
    execute n;
  end loop;
end $mig$;

create or replace function private.outbox_auto_pause() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'queued' and new.channel in ('whatsapp', 'email')
     and not coalesce((select s.auto_on from public.messaging_switches s), true)
     and coalesce(new.template_key, '') !~* 'otp|login|recovery|password'
     and not private.ci_is_team(new.recipient_member_id)
     and not (private.ci_is_team(auth.uid())
              and (coalesce(current_setting('geek.invite_resend', true), '') = 'on'
                   or coalesce(current_setting('geek.manual_send', true), '') = 'on')) then
    new.status := 'skipped';
    new.last_error := 'paused: automatic messages are off (send it by hand from the panel)';
  end if;
  return new;
end $$;
revoke all on function private.outbox_auto_pause() from public, anon, authenticated;

-- 3) STOP left out of the 24-hour list (unless they wrote again after the STOP)
create or replace function api.campaign_wa_open_windows(p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_c uuid; v_t jsonb;
begin
  v_c := intel.ci_resolve_campaign(p_campaign);
  if v_c is null or not intel.ci_can_manage_campaign(v_c) then raise exception 'not your campaign' using errcode = '42501'; end if;
  v_t := api.campaign_wa_targets(p_campaign,
           (select array_agg(i.invite_id) from intel.ci_campaign_invite i where i.campaign_id = v_c),
           (select array_agg(p.participation_id) from intel.ci_campaign_participation p where p.campaign_id = v_c));
  return coalesce((select jsonb_agg(jsonb_build_object('key', t->>'key', 'until', w.until, 'stop_then_wrote', coalesce((t->>'opted_out')::boolean, false)))
    from jsonb_array_elements(coalesce(v_t->'targets', '[]'::jsonb)) t
    join lateral (select max(c.session_expires_at) until from public.wa_conversations c
                   where c.contact_phone_e164 = t->>'phone') w on w.until > now()
   where t->>'phone' is not null
     and (not coalesce((t->>'opted_out')::boolean, false)
          or exists (select 1 from public.wa_messages m join public.wa_conversations c on c.id = m.conversation_id
                      where c.contact_phone_e164 = t->>'phone' and m.direction = 'inbound'
                        and m.created_at > greatest(coalesce((select w2.opt_out_at from public.wa_contacts w2 where w2.phone_e164 = t->>'phone'), '-infinity'),
                                                    coalesce((select po.opt_out_at from public.wa_phone_optout po where po.phone_e164 = t->>'phone'), '-infinity'))))),
    '[]'::jsonb);
end $$;
revoke all on function api.campaign_wa_open_windows(uuid) from public, anon;
grant execute on function api.campaign_wa_open_windows(uuid) to authenticated;

-- 4) the bot worker reads auto_on
create or replace function api.ops_messaging_switches()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce((select jsonb_build_object('wa_on', wa_on, 'email_on', email_on, 'auto_on', auto_on) from public.messaging_switches),
                  '{"wa_on":true,"email_on":true,"auto_on":true}'::jsonb) $$;

-- 1c) the same invite twice in one transaction (bulk upload attach + fast-forward) must not collide on the dedupe key
do $mig2$
declare d text; n text; f text;
begin
  foreach f in array array['intel.ci_send_bulk_invite(uuid)', 'intel.ci_send_join_invite(uuid)'] loop
    d := pg_get_functiondef(f::regprocedure);
    if position('clock_timestamp()' in d) > 0 then continue; end if;
    n := regexp_replace(d, $r$o\.dedupe_key in \('(binv|join):' \|\| (i\.invite_id|u\.id) \|\| ':wa:' \|\| \((i|u)\.invites_sent \+ 1\) \|\| ':' \|\| txid_current\(\),\s*'(binv|join):' \|\| (i\.invite_id|u\.id) \|\| ':em:' \|\| \((i|u)\.invites_sent \+ 1\) \|\| ':' \|\| txid_current\(\)\)$r$,
                    $a$o.created_at = now() and o.dedupe_key like '\1:' || \2 || ':%:' || (\3.invites_sent + 1) || ':' || txid_current() || ':%'$a$);
    n := replace(n, $a$ || ':' || txid_current())$a$, $a$ || ':' || txid_current() || ':' || floor(extract(epoch from clock_timestamp()) * 1000000)::bigint)$a$);
    if position('clock_timestamp()' in n) = 0 or position($a$o.created_at = now() and o.dedupe_key like$a$ in n) = 0 then
      raise exception '% — not patched', f;
    end if;
    execute n;
  end loop;
end $mig2$;
