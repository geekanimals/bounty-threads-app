// Edge Function: ig-ingest-worker (verify_jwt = true) — DARK. NOT deployed, NOT scheduled.
// Executes queued ingestion stages: atomically CLAIM (ci_claim_stages, FOR UPDATE SKIP LOCKED + lease),
// resolve the token via its Vault reference SERVER-SIDE, run the versioned provider client for the
// stage, persist APPEND-ONLY observations, then RELEASE with an accurate outcome (ci_release_stage —
// complete/partial/retryable/terminal, backoff/jitter, dead-letter on exhaustion). Recovers abandoned
// leases first. Never runs publishing. Never retains raw DM bodies. Redacts tokens/secrets from logs.
// Ready for a future cron/queue trigger; permits an authorized local/test invocation (?once=1).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { redact } from "../_shared/webhook.ts";
import { META_API_VERSION, mediaMetricsFor, demographicTimeframes } from "../_shared/meta_capabilities.ts";
import { runAudienceStage, type IngestClient } from "../_shared/meta_ingest.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WORKER_ID = (Deno.env.get("WORKER_ID") || "ig-ingest-worker") + ":" + crypto.randomUUID().slice(0, 8);

Deno.serve(async (req) => {
  // Authorized invocation only (JWT-verified caller or the service role via a future scheduler).
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  try {
    // 0) recover any abandoned leases (crashed worker) before claiming
    await admin.rpc("ci_recover_abandoned_leases"); // schema('intel') in production wiring
    // 1) atomically claim up to N eligible stages (per-account concurrency enforced in SQL)
    const { data: stages } = await admin.rpc("ci_claim_stages", { p_worker: WORKER_ID, p_limit: 5, p_lease_seconds: 120 });
    let processed = 0;
    for (const stage of (stages ?? []) as Array<Record<string, unknown>>) {
      try {
        // 2) resolve token via Vault reference SERVER-SIDE (never returned to any browser/log).
        //    (Production: read vault secret by ci_platform_connection.token_reference over the server
        //     connection, build the RealMeta client pinned to META_API_VERSION, run the stage below.)
        const client: IngestClient = {
          fetchAudience: () => Promise.reject(new Error("no_live_credentials_dark")), // dark: no network
        };
        void META_API_VERSION; void mediaMetricsFor; void demographicTimeframes; void runAudienceStage; void client;
        // 3) DARK: with no live credentials we mark the stage insufficient_data (never fabricate).
        await admin.rpc("ci_release_stage", { p_stage: stage.stage_id, p_worker: WORKER_ID,
          p_status: "insufficient_data", p_reason: "dark_no_live_credentials" });
        processed++;
      } catch (e) {
        // classify + reschedule with backoff (SQL computes next_attempt_at / dead-letters on exhaustion)
        await admin.rpc("ci_release_stage", { p_stage: (stage as { stage_id: string }).stage_id, p_worker: WORKER_ID,
          p_status: "failed_retryable", p_error_class: "worker_error" });
        console.error("ig-ingest-worker", redact({ stage: (stage as { stage: string }).stage, msg: (e as Error).message }));
      }
    }
    return new Response(JSON.stringify({ worker: WORKER_ID, processed }), { status: 200, headers: { "content-type": "application/json" } });
  } catch (e) {
    console.error("ig-ingest-worker", redact({ msg: (e as Error).message }));
    return new Response(JSON.stringify({ error: "worker_error" }), { status: 500 });
  }
});
