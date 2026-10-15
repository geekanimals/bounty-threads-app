// Edge Function: ig-discover-worker  (verify_jwt = false — CI_WORKER_SECRET, pg_cron hourly)
// Grows the creator-search database on its own:
//   1) takes up to 40 pool handles that have no numbers yet (or are 14+ days stale)
//   2) reads each one's public profile through Instagram business discovery (followers, posts, bio, last 12 posts
//      → average likes / comments / engagement, city + category guessed from bio and captions)
//   3) every @handle found in those captions joins the pool too ("snowball"), so the database keeps widening.
// Uses a connected Instagram token (the Super Admin's first). Business discovery needs Meta's approval for this
// app and only works for public Business/Creator accounts — when Meta refuses, the run stops and the app says so.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { openRow, openToken, sealToken, tokenEncryptionOn } from "../_shared/token_crypto.ts";
import { workerGuard } from "../_shared/worker_auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FB_GRAPH = "https://graph.facebook.com/v23.0";

const needsPermission = (j: any) =>
  [10, 100, 110, 190, 200, 230, 3].includes(Number(j?.error?.code)) && !/does not exist|cannot be found/i.test(String(j?.error?.message || ""))
  || /permission|not authorized|capability|business_discovery/i.test(String(j?.error?.message || ""));

export function profileFrom(bd: any, handle: string) {
  const media: any[] = bd?.media?.data ?? [];
  const avg = (k: string) => media.length ? media.reduce((s, m) => s + (Number(m?.[k]) || 0), 0) / media.length : null;
  const captions = media.map((m) => String(m?.caption || "")).join(" ");
  const mine = String(bd?.username || handle).toLowerCase();
  const mentions = [...new Set((captions.match(/@([A-Za-z0-9._]{2,30})/g) || []).map((x) => x.slice(1).toLowerCase().replace(/\.$/, "")))]
    .filter((h) => h !== mine).slice(0, 30);
  return {
    handle: mine, name: bd?.name ?? null, bio: String(bd?.biography ?? "").slice(0, 300),
    followers: bd?.followers_count ?? null, media_count: bd?.media_count ?? null, profile_picture_url: bd?.profile_picture_url ?? null,
    permalink: media[0]?.permalink ?? null, caption: captions.slice(0, 1500),
    avg_likes: avg("like_count"), avg_comments: avg("comments_count"), mentions,
  };
}

Deno.serve(async (req) => {
  const deny = workerGuard(req); if (deny) return deny;
  const api = createClient(SUPABASE_URL, SERVICE_ROLE).schema("api");
  const { data: tokRaw } = await api.rpc("ops_discovery_token");
  const tok = await openRow(tokRaw);
  if (!tok?.access_token || !tok?.ig_user_id) {
    await api.rpc("ops_discovery_save", { p_items: [], p_failed: [], p_needs_permission: false, p_error: "No connected Instagram to read with — connect Instagram as the Super Admin." });
    return new Response(JSON.stringify({ ok: false, reason: "no token" }), { headers: { "Content-Type": "application/json" } });
  }
  const { data: handles } = await api.rpc("ops_discovery_claim", { p_limit: 40 });
  const list: string[] = (handles ?? []) as string[];
  const items: any[] = [], failed: string[] = [];
  let blocked = false, lastErr: string | null = null;
  for (const h of list) {
    if (blocked) { failed.push(h); continue; }
    const fields = `business_discovery.username(${encodeURIComponent(h)}){username,name,biography,followers_count,media_count,profile_picture_url,media.limit(12){caption,permalink,like_count,comments_count}}`;
    try {
      const r = await fetch(`${FB_GRAPH}/${encodeURIComponent(String(tok.ig_user_id))}?fields=${fields}&access_token=${encodeURIComponent(String(tok.access_token))}`);
      const j = await r.json().catch(() => ({}));
      if (r.ok && j?.business_discovery) { items.push(profileFrom(j.business_discovery, h)); continue; }
      lastErr = String(j?.error?.message || `HTTP ${r.status}`).slice(0, 200);
      failed.push(h);
      if (needsPermission(j) || Number(j?.error?.code) === 4 || Number(j?.error?.code) === 17) blocked = true;   // permission or rate limit → stop this run
    } catch (e) { failed.push(h); lastErr = (e as Error).message; }
  }
  const { data: saved } = await api.rpc("ops_discovery_save", {
    p_items: items, p_failed: failed, p_needs_permission: blocked && items.length === 0,
    p_error: blocked && items.length === 0 ? `Instagram refused business discovery: ${lastErr}` : (items.length ? null : lastErr) });
  return new Response(JSON.stringify({ ok: true, tried: list.length, enriched: saved ?? items.length, failed: failed.length }), { headers: { "Content-Type": "application/json" } });
});
