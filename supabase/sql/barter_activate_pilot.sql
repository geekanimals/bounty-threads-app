-- Step 10a + 10b — gated activation. Edit ONLY the two values in `params`, then Run.
-- Effect: cohort enforcement ON first (so nobody outside the allowlist gets in), then the feature flags ON.
-- Rollback: see bottom.
do $$
declare
  v_operator_email text := 'OPERATOR_EMAIL_HERE';     -- the account you run the agency/ops console with
  v_creator_phone  text := '+91XXXXXXXXXX';           -- the test creator's WhatsApp number (already logged in once)
  v_op uuid; v_cr uuid; v_op_org uuid;
begin
  select id into v_op from auth.users where lower(email) = lower(v_operator_email);
  if v_op is null then raise exception 'operator email not found in auth.users: %', v_operator_email; end if;
  select user_id into v_cr from public.wa_contacts where phone_e164 = v_creator_phone and verified_at is not null;
  if v_cr is null then raise exception 'no verified WhatsApp creator for % — log in with WhatsApp once first', v_creator_phone; end if;
  if v_op = v_cr then raise exception 'operator and creator must be different accounts'; end if;
  begin execute 'select org_id from public.members where id = $1' into v_op_org using v_op; exception when others then v_op_org := null; end;

  -- 1) operator role (idempotent)
  if not exists (select 1 from intel.ci_agency_operator where member_id = v_op and active) then
    insert into intel.ci_agency_operator(member_id, org_id, label, added_by) values (v_op, v_op_org, 'pilot operator', v_op);
  end if;

  -- 2) allowlist: exactly these two people (idempotent)
  if not exists (select 1 from intel.ci_pilot_cohort where member_id = v_op and active) then
    insert into intel.ci_pilot_cohort(subject_kind, member_id, label, added_by) values ('creator', v_op, 'pilot operator', v_op);
  end if;
  if not exists (select 1 from intel.ci_pilot_cohort where member_id = v_cr and active) then
    insert into intel.ci_pilot_cohort(subject_kind, member_id, label, added_by) values ('creator', v_cr, 'internal test creator', v_op);
  end if;

  -- 3) gate FIRST, then open the surfaces
  update intel.ci_feature_flag set enabled = true where flag = 'pilot_cohort_enforced';
  update intel.ci_feature_flag set enabled = true where flag in ('creator_profile_api', 'operational_pilot');  -- creator_ig_connect stays OFF until ig-oauth-* are deployed
end $$;

select flag, enabled from intel.ci_feature_flag order by flag;
select c.label, u.email, c.active from intel.ci_pilot_cohort c join auth.users u on u.id = c.member_id where c.active;

-- ROLLBACK (instant, keeps data):
-- update intel.ci_feature_flag set enabled = false where flag = 'operational_pilot';
