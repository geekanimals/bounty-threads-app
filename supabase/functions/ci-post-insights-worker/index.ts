// Edge Function: ci-post-insights-worker  (verify_jwt = false — service role, CI_WORKER_SECRET; kicked by the database
// every hour and the moment a campaign post link is added)
//
// For every campaign post (a reel / story / feed post a creator posted for a campaign):
//   0) finds NEW campaign posts on its own: for creators whose video is approved, every post after the approval that
//      carries the campaign's #hashtag / @mention (stories + campaigns without tags: the kinds still needed, e.g.
//      2 Reels + 1 Post) is saved as their campaign post — no link needed from anyone;
//   1) finds it on the creator's OWN connected Instagram (the Media Kit token) by its link and remembers its media id;
//   2) fetches its numbers (views, reach, likes, comments, shares, saves) — right away, then every 2 h for 3 days,
//      then every 12 h for 30 days (stories only while they are live, 24 h);
//   3) during the contract's ad-rights months checks twice a day that reels / posts are still live. Gone (deleted or
//      archived) → the database reminds the creator to restore it and tells the team; back → tells the team.
// Creators without a working Instagram connection are skipped (nothing is guessed).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { workerGuard } from "../_shared/worker_auth.ts";
import { openRow } from "../_shared/token_crypto.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GRAPH = "https://graph.instagram.com/v23.0";

type Target = { post_id: string; participation_id: string; member_id: string; media_type: string; permalink: string | null;
  external_media_id: string | null; posted_at: string; insights: boolean; live_check: boolean };

// the post's code in its link: instagram.com/reel/ABC/ = instagram.com/p/ABC/ → "abc"; stories → their id
export function linkKey(u: string | null | undefined): string | null {
  const s = String(u || "").trim();
  if (!s) return null;
  const m = /instagram\.com\/(?:[^/]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i.exec(s);
  if (m) return m[1];
  const st = /instagram\.com\/stories\/[^/]+\/(\d+)/i.exec(s);
  if (st) return "story:" + st[1];
  return s.toLowerCase().replace(/[?#].*$/, "").replace(/^(https?:\/\/)?(www\.|m\.)?/, "").replace(/\/+$/, "");
}

async function ig(path: string, token: string) {
  const r = await fetch(`${GRAPH}/${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`);
  const j: any = await r.json().catch(() => ({}));
  return { ok: r.ok && !j?.error, j, err: j?.error as { code?: number; error_subcode?: number; message?: string } | undefined };
}
// Instagram says the media is gone (deleted / archived / not on this account any more)
const isGone = (e?: { code?: number; error_subcode?: number; message?: string }) =>
  !!e && (e.code === 100 && (e.error_subcode === 33 || /does not exist|cannot be loaded|unsupported get request/i.test(e.message || "")));
const isAuth = (e?: { code?: number; message?: string }) => !!e && (e.code === 190 || /access token|session has expired|OAuth/i.test(e.message || ""));

Deno.serve(async (req) => {
  const deny = workerGuard(req); if (deny) return deny;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const api = admin.schema("api");
  const tokens = new Map<string, string | null>();
  const media = new Map<string, { items: any[]; complete: boolean }>();
  const tokenOf = async (member: string) => {
    if (tokens.has(member)) return tokens.get(member)!;
    const { data } = await admin.from("social_tokens").select("access_token, expires_at").eq("member_id", member).eq("platform", "instagram").maybeSingle();
    const t = await openRow(data);
    const ok = t?.access_token && !(t.expires_at && new Date(t.expires_at) < new Date()) ? String(t.access_token) : null;
    tokens.set(member, ok); return ok;
  };
  // the creator's posts (up to 150, newest first) + live stories, read once per run
  const mediaOf = async (member: string, token: string) => {
    if (media.has(member)) return media.get(member)!;
    const items: any[] = []; let complete = false;
    let path: string | null = "me/media?fields=id,permalink,media_type,media_product_type,timestamp&limit=50";
    while (path && items.length < 150) {
      const r = await ig(path, token);
      if (!r.ok) break;
      items.push(...(r.j?.data ?? []));
      const next: string | undefined = r.j?.paging?.next;
      if (!next) { complete = true; break; }
      path = next.replace(/^https:\/\/graph\.instagram\.com\/v[\d.]+\//, "").replace(/([?&])access_token=[^&]*&?/, "$1");
    }
    const st = await ig("me/stories?fields=id,permalink,media_type,timestamp", token);
    if (st.ok) for (const s of (st.j?.data ?? [])) items.push({ ...s, media_product_type: "STORY" });
    const out = { items, complete }; media.set(member, out); return out;
  };

  // 0) find new campaign posts on each creator's Instagram (creators whose video is approved and still have posts to go up)
  let detected = 0;
  const { data: who } = await api.rpc("ops_detect_members", { p_limit: 200 });
  for (const member of ((who ?? []) as string[])) {
    try {
      const token = await tokenOf(member); if (!token) continue;
      const [feed, st] = await Promise.all([
        ig("me/media?fields=id,caption,permalink,media_type,media_product_type,timestamp&limit=50", token),
        ig("me/stories?fields=id,permalink,media_type,timestamp", token)]);
      if (!feed.ok && !st.ok) { if (isAuth(feed.err)) tokens.set(member, null); continue; }
      const items = [...(feed.ok ? feed.j?.data ?? [] : []), ...(st.ok ? (st.j?.data ?? []).map((x: any) => ({ ...x, media_product_type: "STORY" })) : [])];
      const { data: n } = await api.rpc("ops_detect_posts", { p_member: member, p_media: items });
      detected += Number(n || 0);
    } catch (e) { console.error("ci-post-insights-worker detect:", member, (e as Error).message); }
  }

  // 1) numbers + "still live?" for every campaign post (incl. the ones just found)
  const { data: list, error } = await api.rpc("ops_post_targets", { p_limit: 150 });
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  const targets = (list ?? []) as Target[];

  let resolved = 0, numbers = 0, live = 0, gone = 0, skipped = 0, failed = 0;
  for (const t of targets) {
    try {
      const token = await tokenOf(t.member_id);
      if (!token) { skipped++; await api.rpc("ops_post_insights", { p_post: t.post_id, p_metrics: null, p_error: "creator's Instagram is not connected" }); continue; }
      let mid = t.external_media_id;
      let foundInList = false;
      if (!mid && t.permalink) {
        const key = linkKey(t.permalink); const m = await mediaOf(t.member_id, token);
        const hit = m.items.find((x) => linkKey(x.permalink) === key || (key?.startsWith("story:") && "story:" + x.id === key));
        if (hit) {
          mid = String(hit.id); foundInList = true; resolved++;
          const kind = hit.media_product_type === "STORY" ? "story" : hit.media_product_type === "REELS" || hit.media_type === "VIDEO" ? "reel" : "post";
          await api.rpc("ops_post_resolved", { p_post: t.post_id, p_media_id: mid, p_media_type: kind });
        } else if (t.live_check && m.complete && t.media_type !== "story") {
          // the whole account was read and the link isn't there → it's not on their profile
          await api.rpc("ops_post_live", { p_post: t.post_id, p_live: false, p_note: "not among the creator's posts" }); gone++; continue;
        }
      }
      if (!mid) { skipped++; if (t.insights) await api.rpc("ops_post_insights", { p_post: t.post_id, p_metrics: null, p_error: "post not found on the creator's Instagram yet" }); continue; }

      // still there?
      const base = await ig(`${mid}?fields=id,like_count,comments_count,media_product_type,media_type`, token);
      if (!base.ok) {
        if (isGone(base.err) && t.media_type !== "story") { await api.rpc("ops_post_live", { p_post: t.post_id, p_live: false, p_note: base.err?.message ?? null }); gone++; continue; }
        if (isAuth(base.err)) { tokens.set(t.member_id, null); }
        failed++; await api.rpc("ops_post_insights", { p_post: t.post_id, p_metrics: null, p_error: (base.err?.message || "Instagram read failed").slice(0, 300) }); continue;
      }
      if (t.live_check || foundInList) { await api.rpc("ops_post_live", { p_post: t.post_id, p_live: true }); live++; }

      if (t.insights) {
        const story = t.media_type === "story" || base.j?.media_product_type === "STORY";
        const sets = story ? ["views,reach,replies,shares,total_interactions", "reach,replies"]
                           : ["views,reach,likes,comments,shares,saved,total_interactions", "reach,likes,comments,shares,saved", "reach"];
        const vals: Record<string, number> = {};
        for (const s of sets) {
          const r = await ig(`${mid}/insights?metric=${s}`, token);
          if (r.ok) { for (const m of (r.j?.data ?? [])) vals[m.name] = Number(m?.values?.[0]?.value ?? m?.total_value?.value ?? 0); break; }
        }
        if (typeof base.j?.like_count === "number" && vals.likes == null) vals.likes = base.j.like_count;
        if (typeof base.j?.comments_count === "number" && vals.comments == null) vals.comments = base.j.comments_count;
        const metrics: Record<string, unknown> = { reach: vals.reach, views: vals.views, likes: vals.likes, comments: vals.comments,
          shares: vals.shares, saves: vals.saved, impressions: vals.impressions, raw: vals };
        await api.rpc("ops_post_insights", { p_post: t.post_id, p_metrics: Object.keys(vals).length ? metrics : null,
          p_error: Object.keys(vals).length ? null : "Instagram returned no numbers for this post yet" });
        if (Object.keys(vals).length) numbers++;
      }
    } catch (e) {
      failed++; console.error("ci-post-insights-worker:", t.post_id, (e as Error).message);
    }
  }
  return new Response(JSON.stringify({ ok: true, detected, posts: targets.length, resolved, numbers, live, gone, skipped, failed }),
    { headers: { "Content-Type": "application/json" } });
});
