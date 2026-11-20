-- Fix: silent bulk upload failed ("record new has no field kind") because the ci_outbox row was checked for snapto's "kind".
create or replace function private.tg_silent_guard()
 returns trigger language plpgsql set search_path to '' as $function$
begin
  -- "Upload anyway — no message": rows added inside api.bulk_import_creators_silent get no WhatsApp / email
  if coalesce(current_setting('geek.silent', true), '') = 'on' then
    if tg_table_name = 'snapto_drip_queue' then
      if (to_jsonb(NEW)->>'kind') = 'done' then return NEW; end if;
    end if;
    return null;
  end if;
  return NEW;
end $function$;
