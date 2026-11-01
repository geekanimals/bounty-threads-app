// Edge Function: video-link-check (verify_jwt = true) — before a video link is submitted, check that the brand can open it.
// POST { url } → { ok, checked, reason?, message? }. Only Google Drive / Docs links are checked; anything else passes.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { checkVideoLink } from "../_shared/drive_check.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Not authenticated" }, 401);
    const { url } = await req.json();
    if (!/^https?:\/\//i.test(String(url || ""))) return json({ ok: false, checked: true, reason: "bad_link", message: "Paste a link that starts with https://" });
    return json(await checkVideoLink(String(url)));
  } catch (e) {
    console.error("video-link-check:", (e as Error).message);
    return json({ ok: true, checked: false });   // never block a submission because the checker broke
  }
});
