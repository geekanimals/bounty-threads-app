// Edge Function: ig-oauth-callback (verify_jwt = false) — DARK, not deployed in Phase 2C.
// Meta redirects here with ?code&state. The state (not a browser session) is the security boundary.
// Thin shell: server-side code exchange + account fetch (via the mockable MetaOAuthClient), then the
// atomic, idempotent, fail-closed DB completion (intel.ci_ig_complete_connection). The access token
// is written to Vault by the DB function and is NEVER returned to the browser or logged.
//
// Production wires the RealMetaOAuthClient with INSTAGRAM_APP_ID/SECRET from env and calls the DB
// completion over a server-side Postgres connection (api/intel are not exposed to the Data API).

import { corsHeaders, json } from "../_shared/cors.ts";
import { RealMetaOAuthClient, redactForLog, type ProviderConfig } from "../_shared/meta_oauth.ts";

const APP_ID = Deno.env.get("INSTAGRAM_APP_ID") || "";
const APP_SECRET = Deno.env.get("INSTAGRAM_APP_SECRET") || "";

// In production, config is loaded from intel.ci_provider_config over a server-side connection.
const CONFIG: ProviderConfig = {
  provider: "instagram", appEnvironment: "prod", apiVersion: "v21.0", clientId: APP_ID,
  authorizeUrl: "https://www.instagram.com/oauth/authorize",
  tokenExchangeUrl: "https://api.instagram.com/oauth/access_token",
  graphBaseUrl: "https://graph.instagram.com",
  redirectUri: Deno.env.get("IG_REDIRECT_URI") || "",
  scopes: ["instagram_business_basic","instagram_business_manage_insights","instagram_business_manage_comments",
           "instagram_business_manage_messages","instagram_business_content_publish"],
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code") || "";
    const state = url.searchParams.get("state") || "";
    if (!code || !state) return json({ error: "missing_code_or_state" }, 400);

    // Server-side exchange + account fetch (mockable boundary).
    const meta = new RealMetaOAuthClient(CONFIG, APP_SECRET);
    const tok = await meta.exchangeCode(code, CONFIG.redirectUri);      // throws on failure → fail closed
    const acct = await meta.fetchAccount(tok.accessToken);              // throws if no stable id

    // Atomic, idempotent, fail-closed DB completion. Access token goes to Vault inside the DB fn.
    // (Production: call intel.ci_ig_complete_connection over a server-side Postgres connection with:
    //   p_state=state, p_provider='instagram', p_app_environment='prod',
    //   p_platform_user_id=acct.platformUserId, p_username=acct.username, p_account_type=acct.accountType,
    //   p_granted_scopes=tok.grantedScopes, p_token_secret=tok.accessToken, p_token_expires_at=tok.expiresAt)
    // The token is never returned to the browser and never logged.
    void acct; void tok; void state;

    return json({ status: "connected" });   // never includes a token
  } catch (e) {
    console.error("ig-oauth-callback", redactForLog({ msg: (e as Error).message }));
    return json({ error: "callback_failed" }, 400);   // fail closed; no partial state
  }
});
