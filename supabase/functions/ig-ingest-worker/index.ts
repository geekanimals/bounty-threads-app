// Edge Function: ig-ingest-worker (verify_jwt = FALSE) — DARK. NOT deployed, NOT scheduled.
// A valid Supabase JWT is NOT sufficient: this is an internal service endpoint. The handler
// independently verifies the dedicated CI_WORKER_SECRET (constant-time) BEFORE creating any
// service-role client, reading Vault, claiming a stage, or calling Meta (see _shared/ingest_worker.ts
// + _shared/worker_auth.ts). Ordinary authenticated creator/brand/agency/admin callers fail closed.
// The service-role client is created ONLY after that check passes. Ready for a future scheduler/cron
// that injects the secret; nothing is deployed here.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleWorkerRequest } from "../_shared/ingest_worker.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WORKER_SECRET = Deno.env.get("CI_WORKER_SECRET");            // dedicated internal secret (Edge secret)
const WORKER_ID = (Deno.env.get("WORKER_ID") || "ig-ingest-worker") + ":" + crypto.randomUUID().slice(0, 8);

Deno.serve((req) => handleWorkerRequest(req, {
  workerSecret: WORKER_SECRET,
  workerId: WORKER_ID,
  // makeAdmin is invoked ONLY after authorization succeeds (never for a rejected caller).
  makeAdmin: () => createClient(SUPABASE_URL, SERVICE_ROLE),
}));
