// Internal service-to-service authorization for the CI_WORKER_SECRET-gated Edge Functions
// (ig-ingest-worker + every ops-* worker). verify_jwt is FALSE for these; a valid Supabase JWT is NOT
// sufficient. Only a caller presenting the dedicated high-entropy CI_WORKER_SECRET (Edge secret; pg_cron
// reads it from Vault) may proceed — verified in constant time BEFORE any service-role client, Vault
// lookup, DB claim, or provider request is created. FAIL-CLOSED: no/weak configured secret => deny all.

// Constant-time string comparison (no early return on length or content).
export function constantTimeEqual(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  const len = Math.max(ab.length, bb.length, 1);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < len; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

// Extract the presented worker secret. Accepted forms (first match wins):
//   x-worker-secret: <secret>        (runbook / pg_cron)
//   x-ci-worker-secret: <secret>     (ig-ingest-worker legacy)
//   Authorization: Bearer <secret>
export function presentedSecret(req: Request): string | null {
  const h = req.headers.get("x-worker-secret") || req.headers.get("x-ci-worker-secret");
  if (h) return h.trim();
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") || "");
  return m ? m[1].trim() : null;
}

export const MIN_WORKER_SECRET_LEN = 32; // ops-* guard; `openssl rand -hex 32` => 64 chars

// Low-level check (kept at the original 16-char floor for ig-ingest-worker compatibility).
export function isAuthorizedWorker(req: Request, configuredSecret: string | undefined | null): boolean {
  if (!configuredSecret || configuredSecret.length < 16) return false;
  const presented = presentedSecret(req);
  if (!presented) return false;
  return constantTimeEqual(presented, configuredSecret);
}

// Guard for worker handlers: returns a Response to send back (405/401/503), or null when authorized.
// Usage:  const deny = workerGuard(req); if (deny) return deny;
export function workerGuard(req: Request): Response | null {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const secret = Deno.env.get("CI_WORKER_SECRET") || "";
  if (!secret || secret.length < MIN_WORKER_SECRET_LEN) {
    console.error("CI_WORKER_SECRET missing/too short — worker refusing all calls");
    return new Response("worker not configured", { status: 503 });
  }
  if (!isAuthorizedWorker(req, secret)) return new Response("unauthorized", { status: 401 });
  return null;
}
