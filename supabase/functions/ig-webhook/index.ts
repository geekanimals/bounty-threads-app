// Edge Function: ig-webhook (verify_jwt = false) — DARK. NOT deployed, NOT registered in Meta.
// Handles the GET verification handshake and validates POST signatures; on a valid event it would
// enqueue a dark ingestion job over a server-side connection (idempotent, deduped). No token or raw
// body is ever logged or persisted to the intelligence store. Registration/deploy is a later phase.
import { verifyChallenge, validateSignature, eventIdempotencyKey, redact } from "../_shared/webhook.ts";

const VERIFY_TOKEN = Deno.env.get("IG_WEBHOOK_VERIFY_TOKEN") || "";
const APP_SECRET = Deno.env.get("INSTAGRAM_APP_SECRET") || "";

Deno.serve(async (req) => {
  const url = new URL(req.url);
  // GET: subscription verification handshake
  if (req.method === "GET") {
    const challenge = verifyChallenge(
      url.searchParams.get("hub.mode"), url.searchParams.get("hub.verify_token"),
      url.searchParams.get("hub.challenge"), VERIFY_TOKEN);
    if (challenge !== null) return new Response(challenge, { status: 200 });
    return new Response("forbidden", { status: 403 });
  }
  if (req.method !== "POST") return new Response("method_not_allowed", { status: 405 });

  // POST: validate the HMAC signature over the RAW body before parsing anything
  const raw = await req.text();
  const ok = await validateSignature(raw, req.headers.get("x-hub-signature-256"), APP_SECRET);
  if (!ok) return new Response("bad_signature", { status: 401 });

  try {
    const body = JSON.parse(raw) as { object?: string; entry?: Array<Record<string, unknown>> };
    for (const entry of body.entry ?? []) {
      const key = eventIdempotencyKey({ object: body.object, id: String(entry.id ?? ""), time: Number(entry.time ?? 0) });
      // Production (dark): dedupe on `key`, then enqueue a bounded, retryable ingestion job over a
      // server-side connection. Nothing is done here in the dark shell.
      void key;
    }
    return new Response("ok", { status: 200 }); // accept fast; process out-of-band
  } catch (e) {
    console.error("ig-webhook", redact({ msg: (e as Error).message }));
    return new Response("ok", { status: 200 }); // never leak; avoid Meta ret[ry storms on parse issues
  }
});
