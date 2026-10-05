import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GRAPH = "https://graph.instagram.com/v21.0";
async function readJson(res: Response) { const text = await res.text(); try { return JSON.parse(text); } catch { return { raw: text }; } }
function metaError(body: any) { return body?.error?.message || body?.error?.error_user_msg || body?.message || null; }
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: uErr } = await userClient.auth.getUser();
    if (uErr || !user) return json({ error: "Not authenticated" }, 401);
    const { image_url, caption } = await req.json();
    if (!image_url) return json({ error: "Missing image_url" }, 400);
    if (!/^https:\/\//i.test(image_url)) return json({ error: "Instagram requires a public HTTPS image URL." }, 400);
    if (typeof caption === "string" && caption.length > 2200) return json({ error: "Caption is too long. Instagram captions can be up to 2,200 characters." }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: tok, error: tokErr } = await admin.from("social_tokens")
      .select("access_token, ig_user_id, expires_at").eq("member_id", user.id).eq("platform", "instagram").maybeSingle();
    if (tokErr) return json({ error: "Could not read Instagram connection.", detail: tokErr.message }, 500);
    if (!tok?.access_token) return json({ error: "Instagram not connected" }, 400);
    if (tok.expires_at && new Date(tok.expires_at) < new Date()) return json({ error: "Instagram token expired — please reconnect." }, 400);

    // Always resolve the canonical Instagram ID from the actual token.
    const meRes = await fetch(GRAPH + "/me?fields=user_id,username,account_type&access_token=" + encodeURIComponent(tok.access_token));
    const me = await readJson(meRes);
    console.log("[IG] Token /me response", { status: meRes.status, ok: meRes.ok, user_id: me?.user_id ?? null, username: me?.username ?? null, account_type: me?.account_type ?? null, stored_ig_user_id: tok.ig_user_id ?? null });
    if (!meRes.ok || !me?.user_id) return json({ error: "Instagram token verification failed. Please reconnect Instagram.", detail: metaError(me) || me }, 400);

    const canonicalIgUserId = String(me.user_id);
    if (String(tok.ig_user_id || "") !== canonicalIgUserId) {
      await admin.from("social_tokens").update({ ig_user_id: canonicalIgUserId, updated_at: new Date().toISOString() }).eq("member_id", user.id).eq("platform", "instagram");
      await admin.from("social_accounts").update({ ig_user_id: canonicalIgUserId, username: me.username ?? null, account_type: me.account_type ?? null, updated_at: new Date().toISOString() }).eq("member_id", user.id).eq("platform", "instagram");
      console.log("[IG] Repaired stored Instagram ID", { old_id: tok.ig_user_id ?? null, new_id: canonicalIgUserId, username: me.username ?? null });
    }

    console.log("[IG] Starting publish", { user_id: user.id, ig_user_id: canonicalIgUserId, image_url_host: (() => { try { return new URL(image_url).host; } catch { return "invalid-url"; } })(), image_url_path: (() => { try { return new URL(image_url).pathname; } catch { return ""; } })(), caption_length: typeof caption === "string" ? caption.length : 0 });

    const cParams = new URLSearchParams({ image_url, caption: caption || "", access_token: tok.access_token });
    const cRes = await fetch(GRAPH + "/" + canonicalIgUserId + "/media", { method: "POST", body: cParams });
    const container = await readJson(cRes);
    console.log("[IG] Container response", { status: cRes.status, ok: cRes.ok, response: container });
    if (!cRes.ok || !container.id) return json({ error: "Instagram rejected the media container.", detail: metaError(container) || container }, 400);

    let statusCode = "IN_PROGRESS"; let lastStatus: any = null;
    for (let i = 0; i < 12; i++) {
      await new Promise(r => setTimeout(r, 1500));
      const sRes = await fetch(GRAPH + "/" + container.id + "?fields=status_code,status&access_token=" + encodeURIComponent(tok.access_token));
      lastStatus = await readJson(sRes); statusCode = lastStatus?.status_code || lastStatus?.status || statusCode;
      console.log("[IG] Container status", { attempt: i + 1, status: sRes.status, ok: sRes.ok, status_code: lastStatus?.status_code, status_text: lastStatus?.status, response: lastStatus });
      if (statusCode === "FINISHED") break;
      if (statusCode === "ERROR" || statusCode === "EXPIRED") return json({ error: "Instagram could not process the image.", detail: lastStatus }, 400);
    }
    if (statusCode !== "FINISHED") return json({ error: "Instagram is still processing the image. Please try again in a few seconds.", detail: lastStatus }, 400);

    const pParams = new URLSearchParams({ creation_id: container.id, access_token: tok.access_token });
    const pRes = await fetch(GRAPH + "/" + canonicalIgUserId + "/media_publish", { method: "POST", body: pParams });
    const published = await readJson(pRes);
    console.log("[IG] Publish response", { status: pRes.status, ok: pRes.ok, response: published });
    if (!pRes.ok || !published.id) return json({ error: "Instagram could not publish the post.", detail: metaError(published) || published }, 400);
    return json({ ok: true, media_id: published.id, container_id: container.id, message: "Instagram post published successfully." }, 200);
  } catch (e) { console.error("[IG] Unexpected error", e); return json({ error: String(e) }, 500); }
});