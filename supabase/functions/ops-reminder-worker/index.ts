// Edge Function: ops-reminder-worker  (verify_jwt = false — service-role, invoked by a schedule/cron)
// Fires due SLA reminders (e.g. "submit your video within 3 days") by calling intel.ci_run_due_reminders,
// which resolves the influencer, enqueues the reminder push into ci_outbox, and stamps fired_at. The actual
// WhatsApp/email send is then done by ops-notify-dispatch. Dark: ci_run_due_reminders no-ops unless the ops
// layer is active. Reminders whose awaited stage already arrived were cancelled by the event trigger.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WORKER_SECRET = Deno.env.get("CI_WORKER_SECRET") || "";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  if (WORKER_SECRET && req.headers.get("x-worker-secret") !== WORKER_SECRET) return new Response("unauthorized", { status: 401 });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { db: { schema: "intel" } });
  const { data, error } = await admin.rpc("ci_run_due_reminders", { p_limit: 200 });
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  return new Response(JSON.stringify({ ok: true, fired: data ?? 0 }), { headers: { "Content-Type": "application/json" } });
});
