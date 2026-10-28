// Edge Function: post-thumb  (verify_jwt = true — the team: Super Admin, agencies, brands)
// The picture of a campaign post, fetched LIVE from Instagram and saved as our own copy so it never breaks.
//   POST { permalinks: ["https://www.instagram.com/reel/ABC/", …] }  (max 30)
//   → { ok, thumbs: { "<permalink>": "<public url of our copy>" | null } }
// For each post (only real campaign posts / bulk-sheet post links — never arbitrary URLs):
//   1) already saved → our copy
//   2) the creator's own Instagram is connected and we know the media id → graph.instagram.com/{media}?fields=thumbnail_url,media_url
//   3) else business discovery of the creator's public profile (the Super Admin's Facebook-linked Instagram) → find it by its code
//   then download the picture, upload it to storage (post-thumbs/<code>.jpg) and remember it.
// A post that can't be read is tried again after 6 hours at most 5 times.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { openRow } from "../_shared/token_crypto.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const IG = "https://graph.instagram.com/v23.0";
const FB = "https://graph.facebook.com/v23.0";

type Job = { code: string; permalink: string; cached: string | null; tries: number; last_try: string | null;
  media_id: string | null; member_id: string | null; handle: string | null };

const codeOf = (u: string | null | undefined) => (/instagram\.com\/(?:[^/]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i.exec(String(u || "")) || [])[1] || null;
const pic = (m: any) => (m?.media_type === "VIDEO" ? (m?.thumbnail_url || m?.media_url) : (m?.media_url || m?.thumbnail_url)) || null;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Not authenticated" }, 401);
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
    const [{ data: isAdmin }, { data: member }] = await Promise.all([
      admin.from("platform_admins").select("user_id").eq("user_id", user.id).maybeSingle(),
      admin.from("members").select("role, status").eq("id", user.id).maybeSingle()]);
    const team = !!isAdmin || (member && ["owner", "brand", "manager", "corporate", "agency"].includes(member.role) && (member.status ?? "active") === "active");
    if (!team) return json({ error: "Post pictures are for the team." }, 403);

    const body = await req.json().catch(() => ({}));
    const links: string[] = (Array.isArray(body?.permalinks) ? body.permalinks : []).map((x: unknown) => String(x || "").trim()).filter(Boolean).slice(0, 30);
    if (!links.length) return json({ ok: true, thumbs: {} });
    const api = admin.schema("api");
    const { data: jobsRaw, error: jErr } = await api.rpc("ops_post_thumb_jobs", { p_permalinks: links });
    if (jErr) return json({ error: jErr.message }, 500);
    const jobs = (jobsRaw ?? []) as Job[];
    const byCode = new Map<string, string | null>();

    // tokens, read once
    const own = new Map<string, string | null>();
    const ownToken = async (mid: string) => {
      if (own.has(mid)) return own.get(mid)!;
      const { data } = await admin.from("social_tokens").select("access_token, expires_at").eq("member_id", mid).eq("platform", "instagram").maybeSingle();
      const t = await openRow(data);
      const ok = t?.access_token && !(t.expires_at && new Date(t.expires_at) < new Date()) ? String(t.access_token) : null;
      own.set(mid, ok); return ok;
    };
    let disc: { access_token?: string; ig_user_id?: string; platform?: string } | null | undefined;
    const discToken = async () => { if (disc === undefined) { const { data } = await api.rpc("ops_discovery_token"); disc = await openRow(data as any); } return disc; };
    const profiles = new Map<string, any[]>();
    const profileMedia = async (handle: string) => {
      if (profiles.has(handle)) return profiles.get(handle)!;
      const d = await discToken(); let items: any[] = [];
      if (d?.access_token && d?.ig_user_id && d?.platform === "facebook") {
        const f = `business_discovery.username(${encodeURIComponent(handle)}){media.limit(50){permalink,media_type,media_url,thumbnail_url}}`;
        const r = await fetch(`${FB}/${encodeURIComponent(String(d.ig_user_id))}?fields=${f}&access_token=${encodeURIComponent(String(d.access_token))}`);
        const j: any = await r.json().catch(() => ({}));
        items = j?.business_discovery?.media?.data ?? [];
      }
      profiles.set(handle, items); return items;
    };

    for (const job of jobs) {
      if (job.cached) { byCode.set(job.code, job.cached); continue; }
      // don't hammer posts we already failed on: wait 6 h between tries, stop after 5
      if (job.tries >= 5 || (job.tries > 0 && job.last_try && Date.now() - new Date(job.last_try).getTime() < 6 * 3600e3)) { byCode.set(job.code, null); continue; }
      let src: string | null = null, how = "", why = "";
      try {
        if (job.media_id && job.member_id) {
          const tok = await ownToken(job.member_id);
          if (tok) {
            const r = await fetch(`${IG}/${encodeURIComponent(job.media_id)}?fields=media_type,media_url,thumbnail_url&access_token=${encodeURIComponent(tok)}`);
            const j: any = await r.json().catch(() => ({}));
            if (r.ok && !j?.error) { src = pic(j); how = "own_token"; } else why = String(j?.error?.message || "own token read failed");
          }
        }
        if (!src && job.handle) {
          const m = (await profileMedia(job.handle)).find((x) => codeOf(x?.permalink) === job.code);
          if (m) { src = pic(m); how = "business_discovery"; } else why = why || "not among the profile's latest 50 posts (or the profile isn't public)";
        }
        if (!src) { await api.rpc("ops_post_thumb_save", { p_code: job.code, p_permalink: job.permalink, p_url: null, p_source: null, p_error: why || "no picture found" }); byCode.set(job.code, null); continue; }
        // our own copy — Instagram's picture links expire
        const img = await fetch(src);
        if (!img.ok) throw new Error("download " + img.status);
        const type = (img.headers.get("content-type") || "image/jpeg").split(";")[0];
        const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg";
        const bytes = new Uint8Array(await img.arrayBuffer());
        const path = `${job.code}.${ext}`;
        const up = await admin.storage.from("post-thumbs").upload(path, bytes, { contentType: type, upsert: true, cacheControl: "31536000" });
        if (up.error) throw new Error(up.error.message);
        const url = admin.storage.from("post-thumbs").getPublicUrl(path).data.publicUrl;
        await api.rpc("ops_post_thumb_save", { p_code: job.code, p_permalink: job.permalink, p_url: url, p_source: how, p_error: null });
        byCode.set(job.code, url);
      } catch (e) {
        await api.rpc("ops_post_thumb_save", { p_code: job.code, p_permalink: job.permalink, p_url: null, p_source: null, p_error: (e as Error).message });
        byCode.set(job.code, null);
      }
    }
    const thumbs: Record<string, string | null> = {};
    for (const l of links) { const c = codeOf(l); thumbs[l] = c ? (byCode.get(c) ?? null) : null; }
    return json({ ok: true, thumbs });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
