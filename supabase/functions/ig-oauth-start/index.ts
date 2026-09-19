// Edge Function: ig-oauth-start (verify_jwt = true) — DARK, not deployed in Phase 2C.
// Thin shell: authenticates the caller, calls the server-side api.ig_connect_start RPC (which
// creates the one-time state and builds the Meta authorize URL), and returns ONLY the authorize URL
// for the browser to redirect to. No secret is generated or stored here.
//
// The security core (state lifecycle, scope verification, token→Vault, identity anchoring) lives in
// the database (api.ig_connect_start / intel.ci_ig_complete_connection). Because api/intel are NOT
// exposed to the Data API, production wires this to the DB over a server-side Postgres connection.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { redactForLog } from "../_shared/meta_oauth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    // Must be an authenticated creator.
    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "unauthenticated" }, 401);

    // api.ig_connect_start runs as the caller (SECURITY DEFINER derives auth.uid()); it is fail-closed
    // on the `creator_ig_connect` flag. Wired over a server-side connection in production (dark here).
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data, error } = await admin.rpc("ig_connect_start", { p_provider: "instagram", p_app_environment: "prod" });
    if (error) { console.error("ig-oauth-start", redactForLog({ msg: error.message })); return json({ error: "start_failed" }, 400); }

    // Return ONLY the browser-safe authorize URL (the state is its one-time CSRF token, in the URL).
    return json({ authorize_url: (data as Record<string, unknown>)?.authorize_url });
  } catch (e) {
    console.error("ig-oauth-start", redactForLog({ msg: (e as Error).message }));
    return json({ error: "start_error" }, 500);
  }
});
