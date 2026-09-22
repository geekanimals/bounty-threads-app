// Deno tests for the pure webhook helpers — deterministic, no network.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { verifyChallenge, validateSignature, eventIdempotencyKey, classifyRetry, backoffMs, redact } from "./webhook.ts";

Deno.test("verifyChallenge returns challenge only on correct mode+token", () => {
  assertEquals(verifyChallenge("subscribe", "VTOK", "12345", "VTOK"), "12345");
  assertEquals(verifyChallenge("subscribe", "WRONG", "12345", "VTOK"), null);
  assertEquals(verifyChallenge("unsubscribe", "VTOK", "12345", "VTOK"), null);
});

Deno.test("validateSignature accepts a correct HMAC-SHA256 and rejects tampering", async () => {
  const secret = "app_secret_SYNTH";
  const body = JSON.stringify({ object: "instagram", entry: [{ id: "1", time: 2 }] });
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  assertEquals(await validateSignature(body, "sha256=" + hex, secret), true);
  assertEquals(await validateSignature(body + "x", "sha256=" + hex, secret), false); // tampered body
  assertEquals(await validateSignature(body, "sha256=deadbeef", secret), false);
  assertEquals(await validateSignature(body, null, secret), false);
});

Deno.test("idempotency key is deterministic for replay dedupe", () => {
  const e = { object: "instagram", id: "17900", time: 1710000000, field: "comments" };
  assertEquals(eventIdempotencyKey(e), eventIdempotencyKey({ ...e }));
  assert(eventIdempotencyKey(e) !== eventIdempotencyKey({ ...e, id: "17901" }));
});

Deno.test("retry classification + bounded backoff", () => {
  assertEquals(classifyRetry(new Error("429 rate limit"), 1), "rate_limited");
  assertEquals(classifyRetry(new Error("token expired"), 1), "token_expired");
  assertEquals(classifyRetry(new Error("blip"), 1), "retryable");
  assertEquals(classifyRetry(new Error("blip"), 6), "dead_letter");
  const b = backoffMs(3, 500, 60000);
  assert(b > 0 && b <= 60000);
});

Deno.test("redact removes secrets from objects and urls", () => {
  const r = redact({ access_token: "AT", signature: "S", ok: "1" }) as Record<string, string>;
  assertEquals(r.access_token, "REDACTED");
  assertEquals(r.signature, "REDACTED");
  assertEquals(r.ok, "1");
  const u = redact("https://x/cb?code=SECRET&ok=1") as string;
  assert(!u.includes("SECRET"));
});
