// Deno unit tests for the Meta OAuth boundary — deterministic, no network, no credentials.
// Run: deno test supabase/functions/_shared/meta_oauth_test.ts
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildAuthorizeUrl, selectGrantedScopes, redactForLog,
  type MetaOAuthClient, type ProviderConfig, type TokenExchangeResult, type AccountIdentity,
} from "./meta_oauth.ts";

const cfg: ProviderConfig = {
  provider: "instagram", appEnvironment: "prod", apiVersion: "v21.0", clientId: "PUBLIC_CLIENT_ID",
  authorizeUrl: "https://www.instagram.com/oauth/authorize",
  tokenExchangeUrl: "https://api.instagram.com/oauth/access_token",
  graphBaseUrl: "https://graph.instagram.com",
  redirectUri: "https://example.invalid/ig/callback",
  scopes: ["instagram_business_basic","instagram_business_manage_insights","instagram_business_manage_comments",
           "instagram_business_manage_messages","instagram_business_content_publish"],
};

Deno.test("authorize url requests all canonical scopes together with state", () => {
  const url = buildAuthorizeUrl(cfg, "STATE123");
  assert(url.includes("client_id=PUBLIC_CLIENT_ID"));
  assert(url.includes("response_type=code"));
  assert(url.includes("state=STATE123"));
  for (const s of cfg.scopes) assert(url.includes(s), `missing ${s}`);
});

Deno.test("granted scopes are the intersection of requested and returned (not requested)", () => {
  assertEquals(
    selectGrantedScopes(cfg.scopes, ["instagram_business_basic","instagram_business_manage_insights","unrelated_scope"]),
    ["instagram_business_basic","instagram_business_manage_insights"],
  );
  assertEquals(selectGrantedScopes(cfg.scopes, []), []); // all declined
});

Deno.test("redaction hides tokens/codes/state in objects and urls", () => {
  const red = redactForLog({ access_token: "AT", code: "C", state: "S", username: "ok" }) as Record<string, string>;
  assertEquals(red.access_token, "REDACTED");
  assertEquals(red.code, "REDACTED");
  assertEquals(red.state, "REDACTED");
  assertEquals(red.username, "ok");
  const u = redactForLog("https://x/callback?code=SECRET&state=SECRET2&ok=1") as string;
  assert(!u.includes("SECRET"), u);
  assert(u.includes("ok=1"));
});

// ---- mockable Meta boundary: emulate success / subset / malformed / stable-id-unchanged ----
class MockMeta implements MetaOAuthClient {
  constructor(private mode: string) {}
  exchangeCode(_code: string, _redirectUri: string): Promise<TokenExchangeResult> {
    if (this.mode === "exchange_fail") return Promise.reject(new Error("meta_code_exchange_failed"));
    if (this.mode === "subset") return Promise.resolve({ accessToken: "SYNTH", grantedScopes: ["instagram_business_basic"] });
    return Promise.resolve({ accessToken: "SYNTH", grantedScopes: cfg.scopes });
  }
  fetchAccount(_accessToken: string): Promise<AccountIdentity> {
    if (this.mode === "malformed") return Promise.reject(new Error("meta_missing_stable_user_id"));
    if (this.mode === "renamed") return Promise.resolve({ platformUserId: "STABLE_1", username: "new_handle", accountType: "BUSINESS" });
    return Promise.resolve({ platformUserId: "STABLE_1", username: "old_handle", accountType: "BUSINESS" });
  }
}

Deno.test("mock client: success returns synthetic token + full scopes", async () => {
  const r = await new MockMeta("ok").exchangeCode("code", cfg.redirectUri);
  assertEquals(r.grantedScopes, cfg.scopes);
  assertEquals((await new MockMeta("ok").fetchAccount("SYNTH")).platformUserId, "STABLE_1");
});

Deno.test("mock client: subset grant + failures are surfaced, stable id unchanged on rename", async () => {
  assertEquals((await new MockMeta("subset").exchangeCode("c", cfg.redirectUri)).grantedScopes, ["instagram_business_basic"]);
  let threw = false;
  try { await new MockMeta("exchange_fail").exchangeCode("c", cfg.redirectUri); } catch { threw = true; }
  assert(threw, "exchange failure should throw");
  const renamed = await new MockMeta("renamed").fetchAccount("SYNTH");
  assertEquals(renamed.platformUserId, "STABLE_1"); // stable id anchors identity, handle may change
  assertEquals(renamed.username, "new_handle");
});
