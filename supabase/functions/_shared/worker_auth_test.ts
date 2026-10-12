function assertEquals(a: unknown, b: unknown) { if (a !== b) throw new Error(`expected ${String(b)}, got ${String(a)}`); }
import { constantTimeEqual, isAuthorizedWorker, workerGuard } from "./worker_auth.ts";

const S = "a".repeat(64);
const req = (h: Record<string, string>, method = "POST") => new Request("https://x/fn", { method, headers: h });

Deno.test("constantTimeEqual", () => {
  assertEquals(constantTimeEqual("abc", "abc"), true);
  assertEquals(constantTimeEqual("abc", "abd"), false);
  assertEquals(constantTimeEqual("abc", "abcd"), false);
  assertEquals(constantTimeEqual("", ""), true);
});

Deno.test("isAuthorizedWorker header forms", () => {
  assertEquals(isAuthorizedWorker(req({ "x-worker-secret": S }), S), true);
  assertEquals(isAuthorizedWorker(req({ "x-ci-worker-secret": S }), S), true);
  assertEquals(isAuthorizedWorker(req({ authorization: "Bearer " + S }), S), true);
  assertEquals(isAuthorizedWorker(req({ "x-worker-secret": "wrong" }), S), false);
  assertEquals(isAuthorizedWorker(req({}), S), false);
  assertEquals(isAuthorizedWorker(req({ "x-worker-secret": "" }), ""), false);
});

Deno.test("workerGuard fails CLOSED when secret unset or weak", () => {
  Deno.env.delete("CI_WORKER_SECRET");
  assertEquals(workerGuard(req({ "x-worker-secret": "anything" }))?.status, 503);
  Deno.env.set("CI_WORKER_SECRET", "short-secret-16ch");
  assertEquals(workerGuard(req({ "x-worker-secret": "short-secret-16ch" }))?.status, 503);
  Deno.env.set("CI_WORKER_SECRET", S);
  assertEquals(workerGuard(req({ "x-worker-secret": S })), null);
  assertEquals(workerGuard(req({ "x-worker-secret": "nope" }))?.status, 401);
  assertEquals(workerGuard(req({}))?.status, 401);
  assertEquals(workerGuard(req({ "x-worker-secret": S }, "GET"))?.status, 405);
});
