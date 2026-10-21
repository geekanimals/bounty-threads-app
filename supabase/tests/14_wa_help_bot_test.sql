-- WhatsApp help bot — queue, team-reply quiet rule, privileges. Rolls back.
begin;
select * from no_plan();

-- ===== privileges: everything is service-role / super admin only =====
select ok( not has_table_privilege('authenticated','private.wa_bot_job','SELECT'), 'authenticated cannot read the bot log');
select ok( not has_function_privilege('authenticated','api.ops_bot_claim(integer)','EXECUTE'), 'authenticated cannot claim bot jobs');
select ok( not has_function_privilege('anon','api.ops_bot_inbound(text,text,text,text)','EXECUTE'), 'anon cannot queue bot jobs');
select ok( not has_function_privilege('authenticated','intel.ci_bot_context(text)','EXECUTE'), 'authenticated cannot read another number''s context');
select ok( has_function_privilege('service_role','api.ops_bot_done(uuid,text,text,text[],text,boolean,text,uuid,integer)','EXECUTE'), 'worker may report replies');

-- ===== phone numbers =====
select is( intel.ci_e164('98123 45678'), '+919812345678', '10 digits → +91');
select is( intel.ci_e164('09812345678'), '+919812345678', 'leading 0 → +91');
select is( intel.ci_e164('919812345678'), '+919812345678', 'country code without +');

-- ===== off by default =====
select is( api.ops_bot_inbound('9812345678', 'w.1', 'hi', 'text')->>'why', 'bot off', 'bot is off until a Super Admin turns it on');
update private.wa_bot_settings set enabled = true, reply_delay_min = 2;
update private.wa_bot_settings set mode = 'snapto';
select is( api.ops_bot_inbound('9812345678', 'w.0', 'hi', 'text')->>'why', 'snapto chatbot replies', 'snapto mode: the backend queue stays quiet');
update private.wa_bot_settings set mode = 'direct';
select is( api.ops_bot_inbound('9812345678', 'w.1', 'hi', 'text')->>'queued', 'true', 'queued once on');
select is( api.ops_bot_inbound('9812345678', 'w.1', 'hi', 'text')->>'why', 'duplicate', 'same WhatsApp message is not queued twice');
select is( api.ops_bot_inbound('9812345678', 'w.2', 'parcel?', 'text')->>'queued', 'true', 'second message merges');
select is( (select count(*)::int from private.wa_bot_job), 1, 'one reply for messages in a row');
select is( api.ops_bot_inbound('9812345678', 'w.3', 'STOP', 'text')->>'why', 'keyword', 'STOP is left to the opt-out handler');
select is( jsonb_array_length(api.ops_bot_claim(10)), 0, 'nothing is due before the wait');

-- ===== a person from the team replied → bot stays quiet =====
select api.ops_bot_outbound('wamid.person', '919812345678', 'service');
update private.wa_bot_job set due_at = now() - interval '1 second';
select is( jsonb_array_length(api.ops_bot_claim(10)), 0, 'no reply when the team already replied');
select is( (select reason from private.wa_bot_job limit 1), 'the team is replying to this number', 'reason recorded');
select ok( exists(select 1 from private.wa_bot_pause where phone_e164 = '+919812345678' and reason = 'team_reply'), 'number goes quiet');

-- ===== template / OTP statuses are not a team reply =====
select api.ops_bot_outbound('wamid.tpl', '919800000000', 'utility');
select api.ops_bot_outbound('wamid.otp', '919800000000', 'authentication');
select is( intel.ci_bot_team_replied_at('+919800000000', now() - interval '1 hour'), null, 'templates and OTPs do not silence the bot');

-- ===== unknown number gets a context with no campaigns =====
select is( intel.ci_bot_context('9800000000')->>'registered', 'false', 'unknown number is not registered');
select is( jsonb_array_length(intel.ci_bot_context('9800000000')->'invites'), 0, 'and has no invites');

-- ===== snapto chatbot path =====
update private.wa_bot_settings set mode = 'snapto';
delete from private.wa_bot_pause;
select ok( not has_function_privilege('anon','api.ops_bot_answer(text,text)','EXECUTE'), 'anon cannot ask for answers');
select is( api.ops_bot_answer('9811111111', null)->>'why', 'no new message', 'nothing to answer yet');
select is( api.ops_bot_answer('9811111111', 'hello')->>'ack', 'number not in the app — the team handles it', 'unknown number saying hello: a short "team will reply" auto-reply');
select api.ops_bot_done((select job_id from private.wa_bot_job where phone_e164 = '+919811111111' and status = 'working' order by created_at desc limit 1), 'sent', 'thanks', '{}', null, false, 'ack', null, 0);
select is( api.ops_bot_answer('9811111111', 'koi hai?')->>'go', 'false', 'that short reply goes once per 12 hours');
select is( api.ops_bot_answer('9811111111', 'register kaise kare')->>'go', 'true', 'unknown number asking how to register: the bot helps');
select is( api.ops_bot_answer('9811111111', 'STOP')->>'why', 'keyword', 'STOP is never answered');
update private.wa_bot_settings set mode = 'direct';
select is( api.ops_bot_answer('9811111111', 'hello')->>'go', 'false', 'direct mode: the chatbot gets nothing to send');

-- ===== stays out of snapto broadcasts =====
update private.wa_bot_settings set mode = 'direct';
select api.ops_bot_outbound('wamid.beardo', '919822222222', 'marketing');
select is( intel.ci_bot_skip_reason('+919822222222', '{}', 'register kaise kare'), 'answer to a snapto broadcast — the team handles it', 'right after a snapto broadcast the bot stays quiet');
select is( intel.ci_bot_skip_reason('+919833333333', array['wamid.someone-else'], 'register kaise kare'), 'reply to a snapto broadcast — the team handles it', 'a reply to a message we did not send is left to the team');
select is( intel.ci_bot_skip_reason('+919833333333', '{}', 'app pe login kaise kare'), null, 'a plain register / login question is answered');

select * from finish();
rollback;
