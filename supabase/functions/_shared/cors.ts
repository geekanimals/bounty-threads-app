// Shared CORS headers for the Instagram Edge Functions.

// CORS_ORIGIN (optional secret): the app's public origin, e.g. https://app.yourdomain.com — then only the app
// can call these functions from a browser. Unset = any origin (calls still need a valid sign-in token).
const CORS_ORIGIN = (Deno.env.get("CORS_ORIGIN") || "").trim().replace(/\/+$/, "") || "*";

export const corsHeaders = {
  "Access-Control-Allow-Origin": CORS_ORIGIN,
  "Vary": "Origin",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":
    "POST, OPTIONS",
};

export function json(
  body: unknown,
  status = 200
) {
  return new Response(
    JSON.stringify(body),
    {
      status,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    }
  );
}