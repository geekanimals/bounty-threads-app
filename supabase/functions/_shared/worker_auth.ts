// Phase 1B-fix2 — internal service-to-service authorization for the dark ingestion worker.
// verify_jwt is FALSE for ig-ingest-worker; a valid Supabase JWT is NOT sufficient. Only a caller
// presenting the dedicated high-entropy CI_WORKER_SECRET (Edge secret, injected by the scheduler)
// may proceed — verified with a constant-time comparison BEFORE any service-role client, Vault
// lookup, DB claim, or Meta request is created. All other callers (no creds, anon key, malformed,
// expired/creator/brand/agency/admin JWT) fail here.

// Constant-time string comparison (no early return on length or content).
export function constantTimeEqual(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  // compare against a fixed length to avoid leaking which side is longer
  const len = Math.max(ab.length, bb.length, 1);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < len; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

// Extract the presented worker secret from either header form.
export function presentedSecret(req: Request): string | null {
  const h = req.headers.get("x-ci-worker-secret");
  if (h) return h;
  const auth = req.headers.get("authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  return m ? m[1] : null;
}

// Fail-closed: authorized only when a non-empty configured secret exactly matches the presented one.
export function isAuthorizedWorker(req: Request, configuredSecret: string | undefined | null): boolean {
  if (!configuredSecret || configuredSecret.length < 16) return false; // no/weak secret configured => deny all
  const presented = presentedSecret(req);
  if (!presented) return false;
  return constantTimeEqual(presented, configuredSecret);
}
