// Edge Function: instagram-media-sync  (verify_jwt = true — the signed-in creator's own account only)
// Light, rate-limit-friendly refresh for the Media Kit: profile counters + latest 12 posts + live stories
// (3 Instagram calls). Throttled per creator on social_accounts.last_media_sync_at so the Media Kit can poll
// every 60 s (and right after publishing) without burning the Instagram API quota. The heavy sync (reach
// insights, audience, mentions) stays in instagram-refresh.
//
// Body: { force?: boolean }  — force shortens the throttle to 10 s (used right after a publish).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { openRow, openToken, sealToken, tokenEncryptionOn } from "../_shared/token_crypto.ts";
import { corsHeaders, json } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GRAPH = "https://graph.instagram.com/v23.0";
const MIN_GAP_MS = 50_000, FORCE_GAP_MS = 10_000;

async function igGet(path: string, token: string) {
  const r = await fetch(`${GRAPH}/${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`);
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok && !j?.error, j };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Not authenticated" }, 401);
    const force = !!(await req.json().catch(() => ({})))?.force;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
    const { data: acct } = await admin.from("social_accounts").select("last_media_sync_at, recent_media")
      .eq("member_id", user.id).eq("platform", "instagram").maybeSingle();
    if (!acct) return json({ error: "Instagram not connected" }, 400);

    const last = acct.last_media_sync_at ? new Date(acct.last_media_sync_at).getTime() : 0;
    const gap = Date.now() - last;
    if (gap < (force ? FORCE_GAP_MS : MIN_GAP_MS)) {
      return json({ ok: true, cached: true, next_in_ms: (force ? FORCE_GAP_MS : MIN_GAP_MS) - gap });
    }
    // claim the slot first so concurrent tabs don't all call Instagram
    await admin.from("social_accounts").update({ last_media_sync_at: new Date().toISOString() })
      .eq("member_id", user.id).eq("platform", "instagram");

    const { data: tokRaw } = await admin.from("social_tokens").select("access_token, expires_at")
      .eq("member_id", user.id).eq("platform", "instagram").maybeSingle();
    const tok = await openRow(tokRaw);
    if (!tok?.access_token) return json({ error: "Instagram not connected" }, 400);
    if (tok.expires_at && new Date(tok.expires_at) < new Date()) {
      return json({ error: "Instagram token expired — please reconnect your Instagram account." }, 400);
    }

    const [prof, media, stories] = await Promise.all([
      igGet("me?fields=followers_count,follows_count,media_count,username,profile_picture_url", tok.access_token),
      igGet("me/media?fields=id,caption,media_type,media_url,permalink,thumbnail_url,timestamp,like_count,comments_count&limit=12", tok.access_token),
      igGet("me/stories?fields=id,media_type,media_url,permalink,thumbnail_url,timestamp", tok.access_token),
    ]);

    // NOTE: never bump updated_at here — the Media Kit uses it to decide when the heavy instagram-refresh
    // (which also renews the 60-day token) must run; bumping it every minute would let tokens expire.
    const patch: Record<string, unknown> = {};
    if (prof.ok) {
      for (const k of ["followers_count", "follows_count", "media_count"]) {
        if (typeof prof.j?.[k] === "number") patch[k] = prof.j[k];
      }
      if (prof.j?.username) patch.username = prof.j.username;
      if (prof.j?.profile_picture_url) patch.profile_picture_url = prof.j.profile_picture_url;
    }
    // Merge, never wipe: an empty/failed media read must not erase the kit's posts. Fresh items win, but fields
    // the heavy sync added earlier (e.g. per-post reach) are kept for posts that are still in the list.
    const prev: any[] = Array.isArray(acct.recent_media) ? acct.recent_media : [];
    const fresh: any[] = media.ok && Array.isArray(media.j?.data) ? media.j.data : [];
    if (fresh.length) {
      const byId = new Map(prev.map((m) => [String(m?.id), m]));
      patch.recent_media = fresh.map((m) => ({ ...(byId.get(String(m.id)) || {}), ...m }));
    } else {
      console.warn("instagram-media-sync: Instagram returned no posts", JSON.stringify({ ok: media.ok, prev: prev.length, error: media.j?.error?.message ?? null }));
    }
    // /me/stories only returns stories that are live right now (last 24 h)
    if (stories.ok) patch.recent_stories = Array.isArray(stories.j?.data) ? stories.j.data : [];

    const { error } = await admin.from("social_accounts").update(patch)
      .eq("member_id", user.id).eq("platform", "instagram");
    if (error) throw error;

    const failed = [!prof.ok && "profile", !media.ok && "posts", !stories.ok && "stories"].filter(Boolean);
    if (failed.length) console.warn("instagram-media-sync partial:", failed.join(","), JSON.stringify(media.ok ? stories.j?.error ?? prof.j?.error : media.j?.error).slice(0, 300));
    return json({
      ok: true, cached: false,
      posts: Array.isArray(patch.recent_media) ? (patch.recent_media as unknown[]).length : prev.length,
      posts_from_instagram: fresh.length,
      stories: Array.isArray(patch.recent_stories) ? (patch.recent_stories as unknown[]).length : null,
      partial: failed,
    });
  } catch (e) {
    console.error("instagram-media-sync error:", (e as Error).message);
    return json({ error: "Couldn't refresh from Instagram right now." }, 500);
  }
});
