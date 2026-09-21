// Deno tests for the ingestion-worker authorization gate — deterministic, no network.
// Proves that only the configured CI_WORKER_SECRET may proceed, and that a rejected request performs
// ZERO privileged operations (makeAdmin never invoked => no claim, no Vault read, no Meta request).
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleWorkerRequest } from "./ingest_worker.ts";
import { isAuthorizedWorker, constantTimeEqual } from "./worker_auth.ts";

const SECRET = "CI_WORKER_SECRET_" + "x".repeat(24); // >=16 chars, high-entropy stand-in

function spyDeps() {
  let adminCreated = 0;
  const rpcCalls: string[] = [];
  const deps = {
    workerSecret: SECRET, workerId: "w1", log: (_: unknown) => {},
    makeAdmin: () => { adminCreated++; return { rpc: (fn: string) => { rpcCalls.push(fn); return Promise.resolve({ data: [] }); } }; },
  };
  return { deps, get adminCreated() { return adminCreated; }, rpcCalls };
}

function reqWith(headers: Record<string, string>): Request {
  return new Request("https://x/ig-ingest-worker", { method: "POST", headers });
}

Deno.test("no credentials => 401 and ZERO privileged init", async () => {
  const s = spyDeps();
  const res = await handleWorkerRequest(reqWith({}), s.deps);
  assertEquals(res.status, 401);
  assertEquals(s.adminCreated, 0);          // no service-role client
  assertEquals(s.rpcCalls.length, 0);       // no claim, no Vault, no Meta
  assert(!(await res.text()).includes(SECRET));
});

Deno.test("anon-key-like bearer / ordinary user JWT => 401, zero privileged init", async () => {
  for (const token of ["anon.eyJhbGciOiJIUzI1NiJ9.fake", "creator.jwt.value", "brand.jwt.value", "admin.jwt.value"]) {
    const s = spyDeps();
    const res = await handleWorkerRequest(reqWith({ authorization: "Bearer " + token }), s.deps);
    assertEquals(res.status, 401);
    assertEquals(s.adminCreated, 0);
    assertEquals(s.rpcCalls.length, 0);
  }
});

Deno.test("malformed / wrong worker secret => 401, zero privileged init", async () => {
  for (const h of [{ "x-ci-worker-secret": "" }, { "x-ci-worker-secret": "wrong" }, { authorization: "Basic xyz" }]) {
    const s = spyDeps();
    const res = await handleWorkerRequest(reqWith(h), s.deps);
    assertEquals(res.status, 401);
    assertEquals(s.adminCreated, 0);
    assertEquals(s.rpcCalls.length, 0);
  }
});

Deno.test("empty/weak configured secret denies everyone (fail-closed)", () => {
  const req = reqWith({ "x-ci-worker-secret": "anything" });
  assertEquals(isAuthorizedWorker(req, undefined), false);
  assertEquals(isAuthorizedWorker(req, ""), false);
  assertEquals(isAuthorizedWorker(req, "short"), false); // < 16 chars
});

Deno.test("correct internal credential => authorized, claim runs", async () => {
  const s = spyDeps();
  const res = await handleWorkerRequest(reqWith({ "x-ci-worker-secret": SECRET }), s.deps);
  assertEquals(res.status, 200);
  assertEquals(s.adminCreated, 1);
  assert(s.rpcCalls.includes("ci_claim_stages"));
  assert(s.rpcCalls.includes("ci_recover_abandoned_leases"));
});

Deno.test("correct credential also accepted via Authorization: Bearer", async () => {
  const s = spyDeps();
  const res = await handleWorkerRequest(reqWith({ authorization: "Bearer " + SECRET }), s.deps);
  assertEquals(res.status, 200);
  assertEquals(s.adminCreated, 1);
});

Deno.test("response never contains the secret", async () => {
  const s = spyDeps();
  const res = await handleWorkerRequest(reqWith({ "x-ci-worker-secret": SECRET }), s.deps);
  assert(!(await res.text()).includes(SECRET));
});

Deno.test("constant-time compare is correct for equal/unequal", () => {
  assert(constantTimeEqual("abc123", "abc123"));
  assert(!constantTimeEqual("abc123", "abc124"));
  assert(!constantTimeEqual("abc", "abcd"));
});
