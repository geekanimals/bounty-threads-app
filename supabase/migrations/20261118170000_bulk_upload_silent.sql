-- Bulk upload: "Upload anyway — no message". Rows sent through api.bulk_import_creators_silent are added
-- to the campaign, but no WhatsApp (Snapto drip start) or email (ci_outbox) is queued for them.

create or replace function private.tg_silent_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('geek.silent', true), '') = 'on' then
    if tg_table_name = 'snapto_drip_queue' and NEW.kind = 'done' then return NEW; end if;
    return null;
  end if;
  return NEW;
end $$;
drop trigger if exists aa_silent_guard on private.snapto_drip_queue;
create trigger aa_silent_guard before insert on private.snapto_drip_queue for each row execute function private.tg_silent_guard();
drop trigger if exists aa_silent_guard on intel.ci_outbox;
create trigger aa_silent_guard before insert on intel.ci_outbox for each row execute function private.tg_silent_guard();

create or replace function api.bulk_import_creators_silent(p_campaign uuid, p_rows jsonb, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r jsonb;
begin
  perform set_config('geek.silent', 'on', true);
  r := api.bulk_import_creators(p_campaign,
         (select coalesce(jsonb_agg(x || jsonb_build_object('extra', coalesce(x->'extra', '{}'::jsonb) || '{"silent":true}'::jsonb)), '[]'::jsonb) from jsonb_array_elements(p_rows) x),
         p_note);
  perform set_config('geek.silent', '', true);
  return r || '{"silent":true}'::jsonb;
end $$;
revoke all on function api.bulk_import_creators_silent(uuid, jsonb, text) from public, anon;
grant execute on function api.bulk_import_creators_silent(uuid, jsonb, text) to authenticated;
