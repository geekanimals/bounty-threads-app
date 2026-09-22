// Phase 1B-fix2 — testable ingestion-worker request handler. The authorization gate runs FIRST; on
// failure it returns 401 and NEVER calls `deps.makeAdmin` (so a rejected request performs zero stage
// claims, zero Vault reads, zero Meta requests). Secrets never appear in responses/logs.
import { isAuthorizedWorker } from "./worker_auth.ts";
import { redact } from "./webhook.ts";

export interface WorkerDeps {
  workerSecret: string | undefined | null;
  workerId: string;
  // Only called AFTER authorization passes. Returns the service-role client that grants privileged access.
  makeAdmin: () => { rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data?: unknown; error?: unknown }> };
  log?: (msg: unknown) => void;
}

export async function handleWorkerRequest(req: Request, deps: WorkerDeps): Promise<Response> {
  const log = deps.log ?? ((m) => console.error("ig-ingest-worker", redact(m)));
  // ---- AUTHORIZATION GATE (before any privileged initialization) ----
  if (!isAuthorizedWorker(req, deps.workerSecret)) {
    return json({ error: "unauthorized" }, 401); // generic; no secret material in the response
  }
  // ---- authorized: only now may we create the service-role client / touch Vault / claim / call Meta ----
  const admin = deps.makeAdmin();
  try {
    await admin.rpc("ci_recover_abandoned_leases");
    const { data: stages } = await admin.rpc("ci_claim_stages", { p_worker: deps.workerId, p_limit: 5, p_lease_seconds: 120 });
    let processed = 0;
    for (const stage of (stages ?? []) as Array<Record<string, unknown>>) {
      try {
        // DARK: no live Meta credentials → mark insufficient_data (never fabricate). Token resolution +
        // versioned Meta client wire here in production, server-side only.
        await admin.rpc("ci_release_stage", { p_stage: stage.stage_id, p_worker: deps.workerId,
          p_status: "insufficient_data", p_reason: "dark_no_live_credentials" });
        processed++;
      } catch (e) {
        await admin.rpc("ci_release_stage", { p_stage: stage.stage_id, p_worker: deps.workerId,
          p_status: "failed_retryable", p_error_class: "worker_error" });
        log({ stage: stage.stage, msg: (e as Error).message });
      }
    }
    return json({ worker: deps.workerId, processed }, 200);
  } catch (e) {
    log({ msg: (e as Error).message });
    return json({ error: "worker_error" }, 500);
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
