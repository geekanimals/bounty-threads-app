// Phase 1B — pure Meta webhook helpers (DARK; the ig-webhook Edge shell is not deployed/registered).
// Challenge verification, HMAC-SHA256 signature validation, idempotency/dedupe keys, safe redaction.
// No token/body is ever logged; raw bodies are not persisted to the intelligence store.

// GET verification handshake: return the challenge only when mode+token match.
export function verifyChallenge(mode: string | null, token: string | null, challenge: string | null, expectedToken: string): string | null {
  if (mode === "subscribe" && token && expectedToken && token === expectedToken) return challenge ?? null;
  return null;
}

// Validate 'x-hub-signature-256: sha256=<hex>' against HMAC-SHA256(appSecret, rawBody). Constant-time-ish.
export async function validateSignature(rawBody: string, header: string | null, appSecret: string): Promise<boolean> {
  if (!header || !header.startsWith("sha256=") || !appSecret) return false;
  const provided = header.slice("sha256=".length).trim().toLowerCase();
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

// Deterministic idempotency key for an event (object+id+time+field) → dedupe replays.
export function eventIdempotencyKey(evt: { object?: string; id?: string; time?: number; field?: string }): string {
  return [evt.object ?? "", evt.id ?? "", evt.time ?? "", evt.field ?? ""].join(":");
}

// Retry classification for a downstream processing error.
export type RetryClass = "retryable" | "rate_limited" | "token_expired" | "dead_letter";
export function classifyRetry(err: unknown, attempt: number, maxAttempts = 6): RetryClass {
  const m = String((err as Error)?.message ?? err ?? "").toLowerCase();
  if (m.includes("rate") || m.includes("429")) return "rate_limited";
  if (m.includes("token") || m.includes("oauth") || m.includes("expired")) return "token_expired";
  if (attempt >= maxAttempts) return "dead_letter";
  return "retryable";
}

// Bounded exponential backoff with jitter (ms).
export function backoffMs(attempt: number, baseMs = 500, capMs = 60000): number {
  const exp = Math.min(capMs, baseMs * 2 ** attempt);
  return Math.floor(exp / 2 + Math.random() * (exp / 2));
}

// Redact secrets before any logging.
const SECRET = /(access_token|refresh_token|token|code|state|client_secret|app_secret|signature|secret)/i;
export function redact(obj: unknown): unknown {
  if (typeof obj === "string") return obj.replace(/([?&](?:state|code|access_token)=)[^&\s]+/gi, "$1REDACTED");
  if (obj && typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) out[k] = SECRET.test(k) ? "REDACTED" : redact(v);
    return out;
  }
  return obj;
}
