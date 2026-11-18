// Edge Function: media-upload  (verify_jwt = true)
// Every upload in the app goes here → Cloudflare R2. The app compresses images first (lib/media.jsx).
//   POST ?area=<area>&name=<file name>[&scope=<campaign id>]   body = the file (raw bytes), content-type = its type
//     → { ok, key, url }            url = public address (null for private areas)
//   POST { action: "sign", key }  → { url }  10-minute link to a private file (payment proofs — Super Admin only)
//   GET  ?status=1                → { ready } (is R2 set up — the app falls back to Supabase storage when not)
// Areas and who may upload:
//   campaign-files  — the team (Super Admin, agencies, brands)          public
//   review-proofs   — Super Admin (any) · creator (own folder)          public
//   post-media      — the team (brand Facebook posts)                  public
//   payment-proofs  — Super Admin only                                  PRIVATE (signed links only)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { r2Put, r2Ready, r2SignedGet, R2_PRIVATE_BUCKET } from "../_shared/r2.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MAX = 20 * 1024 * 1024;
const TYPES = /^(image\/(jpeg|png|webp|gif|heic|heif|avif)|video\/(mp4|quicktime)|application\/pdf|text\/(csv|plain)|application\/(zip|msword|vnd\.openxmlformats-officedocument\.[a-z.]+|vnd\.ms-(excel|powerpoint)))$/i;
const AREAS: Record<string, { who: "team" | "admin" | "review"; priv?: boolean }> = {
  "campaign-files": { who: "team" },
  "post-media": { who: "team" },
  "review-proofs": { who: "review" },
  "payment-proofs": { who: "admin", priv: true },
};
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/heic": "heic", "image/avif": "avif", "application/pdf": "pdf", "video/mp4": "mp4", "video/quicktime": "mov" };
const safe = (s: string) => String(s || "").normalize("NFKD").replace(/[^\w.-]+/g, "-").replace(/-+/g, "-").slice(0, 60) || "file";
const cors = { ...corsHeaders, "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": corsHeaders["Access-Control-Allow-Headers"] + ", x-upsert" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const u = new URL(req.url);
  if (req.method === "GET" && u.searchParams.get("status")) return json({ ready: r2Ready() });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Please sign in again" }, 401);
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
    const [{ data: pa }, { data: member }] = await Promise.all([
      admin.from("platform_admins").select("user_id").eq("user_id", user.id).maybeSingle(),
      admin.from("members").select("role, status, org_id").eq("id", user.id).maybeSingle()]);
    const isAdmin = !!pa;
    const isTeam = isAdmin || (member && ["owner", "brand", "manager", "corporate", "agency"].includes(member.role) && (member.status ?? "active") === "active");

    // private file link
    if ((req.headers.get("content-type") || "").includes("application/json")) {
      const b = await req.json().catch(() => ({}));
      if (b?.action === "status") return json({ ready: r2Ready() });
      if (b?.action !== "sign") return json({ error: "Unknown action" }, 400);
      const key = String(b.key || "");
      if (!key.startsWith("private/")) return json({ error: "Not a private file" }, 400);
      // Super Admin, or the creator whose payout this proof belongs to (same rule as the old storage policy)
      if (!isAdmin) {
        const { data: can } = await userClient.rpc("ci_can_read_payment_proof", { p_name: key });
        if (!can) return json({ error: "You can't open this file" }, 403);
      }
      return json({ url: await r2SignedGet(key, 600, !!b.download) });
    }

    if (!r2Ready()) return json({ error: "R2 is not set up yet", fallback: true }, 503);
    const area = String(u.searchParams.get("area") || "");
    const rule = AREAS[area];
    if (!rule) return json({ error: "Unknown upload area" }, 400);
    if (rule.who === "admin" && !isAdmin) return json({ error: "Only the Super Admin can upload this" }, 403);
    // the public bucket is readable by anyone with the link — private files go to R2 only when a private bucket is set
    if (rule.priv && !R2_PRIVATE_BUCKET) return json({ error: "Private files stay in private storage", fallback: true }, 503);
    if (rule.who === "team" && !isTeam) return json({ error: "Uploads here are for the team" }, 403);
    const type = (req.headers.get("content-type") || "application/octet-stream").split(";")[0].trim().toLowerCase();
    if (!TYPES.test(type)) return json({ error: `This file type (${type}) can't be uploaded` }, 415);
    const len = Number(req.headers.get("content-length") || 0);
    if (len > MAX) return json({ error: "File is bigger than 20 MB" }, 413);
    const body = new Uint8Array(await req.arrayBuffer());
    if (!body.length) return json({ error: "Empty file" }, 400);
    if (body.length > MAX) return json({ error: "File is bigger than 20 MB" }, 413);

    const scope = safe(u.searchParams.get("scope") || "");
    const name = safe(u.searchParams.get("name") || "file").replace(/\.[^.]+$/, "");
    const ext = EXT[type] || (String(u.searchParams.get("name") || "").match(/\.([a-z0-9]{2,5})$/i)?.[1] || "bin").toLowerCase();
    const who = rule.who === "review" && !isAdmin ? `c/${user.id}` : isAdmin ? "a" : `u/${member?.org_id || user.id}`;
    const ym = new Date().toISOString().slice(0, 7);
    const key = `${rule.priv ? "private/" : ""}${area}/${who}${scope ? "/" + scope : ""}/${ym}/${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}-${name}.${ext}`;
    const out = await r2Put(key, body, type, rule.priv ? "private, no-store" : undefined);
    return json({ ok: true, key: out.key, url: out.url, size: body.length, type });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
