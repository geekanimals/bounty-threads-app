// Edge Function: ops-tracking-worker  (verify_jwt = false — service-role, invoked by a schedule/cron)
// Polls the courier for each in-transit shipment and writes the normalised status via
// intel.ci_shipment_set_status. A 'delivered' status becomes a shipment event, which the Phase 1 notify
// trigger turns into the parcel-received push + a fresh 3-day video SLA. Dark: no-ops until carriers are
// configured and shipments exist. CI_WORKER_SECRET gates manual calls.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { workerGuard } from "../_shared/worker_auth.ts";
import { getTrackingProvider } from "../_shared/tracking_provider.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  const deny = workerGuard(req); if (deny) return deny;   // fail-closed, constant-time CI_WORKER_SECRET check

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { db: { schema: "intel" } });
  const { data: rows, error } = await admin.rpc("ci_shipments_to_track", { p_limit: 200 });
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  let checked = 0, updated = 0, failed = 0;
  for (const s of rows ?? []) {
    checked++;
    try {
      const carrier = (s.carrier_code || s.courier || "").toString();
      const res = await getTrackingProvider(carrier).track(s.tracking_ref);
      const { error: e2 } = await admin.rpc("ci_shipment_set_status", {
        p_shipment: s.shipment_id, p_status: res.status, p_actor: null,
        p_raw: { tracking_status: res.label, payload: res.raw as unknown },
      });
      if (e2) throw new Error(e2.message);
      updated++;
    } catch (_e) { failed++; /* leave it queued for the next run */ }
  }
  return new Response(JSON.stringify({ ok: true, checked, updated, failed }), { headers: { "Content-Type": "application/json" } });
});
