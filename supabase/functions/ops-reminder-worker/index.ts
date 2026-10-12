// Edge Function: ops-reminder-worker  (verify_jwt = false — service-role, invoked by a schedule/cron)
// Fires due SLA reminders (e.g. "submit your video within 3 days") by calling intel.ci_run_due_reminders,
// which resolves the influencer, enqueues the reminder push into ci_outbox, and stamps fired_at. The actual
// WhatsApp/email send is then done by ops-notify-dispatch. Dark: ci_run_due_reminders no-ops unless the ops
// layer is active. Reminders whose awaited stage already arrived were cancelled by the event trigger.
// intel is not exposed to PostgREST, so this goes through the service-role-only api.ops_run_due_reminders.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { workerGuard } from "../_shared/worker_auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  const deny = workerGuard(req); if (deny) return deny;   // fail-closed, constant-time CI_WORKER_SECRET check

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data, error } = await admin.schema("api").rpc("ops_run_due_reminders", { p_limit: 200 });
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  return new Response(JSON.stringify({ ok: true, fired: data ?? 0 }), { headers: { "Content-Type": "application/json" } });
});
