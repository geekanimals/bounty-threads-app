// Edge Function: instagram-publish
// Publishes an image post to the signed-in creator's Instagram account.
// Flow: create a media container, then publish it. Uses the creator's stored
// long-lived token (read server-side from social_tokens; never sent to the browser).
//
// Request body: { image_url: string, caption?: string }
//   image_url must be a PUBLIC https URL (Instagram fetches it) — e.g. a file
//   uploaded to the public "ig-media" Supabase Storage bucket.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const GRAPH = "https://graph.instagram.com/v21.0";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    // --- Identify caller ---
    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: uErr } = await userClient.auth.getUser();
    if (uErr || !user) return json({ error: "Not authenticated" }, 401);

    const { image_url, caption } = await req.json();
    if (!image_url) return json({ error: "Missing image_url" }, 400);

    // --- Look up the creator's token (service role; never exposed to client) ---
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: tok } = await admin
      .from("social_tokens")
      .select("access_token, ig_user_id, expires_at")
      .eq("member_id", user.id).eq("platform", "instagram").maybeSingle();
    if (!tok?.access_token || !tok?.ig_user_id) {
      return json({ error: "Instagram not connected" }, 400);
    }
    if (tok.expires_at && new Date(tok.expires_at) < new Date()) {
      return json({ error: "Instagram token expired — please reconnect." }, 400);
    }

    // --- 1) create media container ---
    const cParams = new URLSearchParams({
      image_url,
      caption: caption || "",
      access_token: tok.access_token,
    });
    const cRes = await fetch(`${GRAPH}/${tok.ig_user_id}/media`, { method: "POST", body: cParams });
    const container = await cRes.json();
    if (!cRes.ok || !container.id) {
      return json({ error: "Could not create post", detail: container }, 400);
    }

    // --- 2) publish the container ---
    const pParams = new URLSearchParams({
      creation_id: container.id,
      access_token: tok.access_token,
    });
    const pRes = await fetch(`${GRAPH}/${tok.ig_user_id}/media_publish`, { method: "POST", body: pParams });
    const published = await pRes.json();
    if (!pRes.ok || !published.id) {
      return json({ error: "Could not publish post", detail: published }, 400);
    }

    return json({ ok: true, media_id: published.id });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
