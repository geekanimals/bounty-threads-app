-- WhatsApp template values can't hold line breaks. An address saved with line breaks (or the sheet's "&#10;")
-- went to Snapto as "&amp;#10;" inside the message. Every value now gets cleaned once, where all drips are
-- queued, so every template is safe.
create or replace function private.snapto_clean_text(p text) returns text
language sql immutable set search_path = '' as $fn$
  select left(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
           replace(replace(replace(coalesce(p, ''), '&amp;', '&'), '&nbsp;', ' '), '&quot;', '"'),
           '&#(10|13|9);', ', ', 'g'),          -- encoded line breaks / tabs
           '&#[0-9]+;', ' ', 'g'),             -- any other encoded character
           '[\r\n\t]+', ', ', 'g'),            -- real line breaks / tabs
           '\s*,(\s*,)+', ',', 'g'),           -- ", , ," → ","
           ' {2,}', ' ', 'g'),
           '\s+,', ',', 'g'),                 -- "Assam , City" → "Assam, City"
           '^[\s,]+|[\s,]+$', '', 'g'), 900)
$fn$;

create or replace function private.tg_snapto_clean_attrs() returns trigger
language plpgsql set search_path = '' as $fn$
begin
  if new.attrs is not null and jsonb_typeof(new.attrs) = 'object' then
    new.attrs := coalesce((select jsonb_object_agg(e.k, case when jsonb_typeof(e.v) = 'string'
                                                            then to_jsonb(private.snapto_clean_text(e.v #>> '{}')) else e.v end)
                             from jsonb_each(new.attrs) e(k, v)), '{}'::jsonb);
  end if;
  return new;
end $fn$;
drop trigger if exists aa_clean_attrs on private.snapto_drip_queue;
create trigger aa_clean_attrs before insert on private.snapto_drip_queue
  for each row execute function private.tg_snapto_clean_attrs();

-- the saved addresses that still hold the sheet's "&#10;" text: turn it into a real line break
update private.creator_address set
  line1 = regexp_replace(replace(line1, '&amp;', '&'), '&#(10|13);', E'\n', 'g'),
  line2 = regexp_replace(replace(line2, '&amp;', '&'), '&#(10|13);', E'\n', 'g'),
  landmark = regexp_replace(replace(landmark, '&amp;', '&'), '&#(10|13);', E'\n', 'g')
where concat_ws(' ', line1, line2, landmark) ~ '&(amp;)?#(10|13);';
