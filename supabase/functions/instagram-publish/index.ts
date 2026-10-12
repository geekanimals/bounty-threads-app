// Edge Function: instagram-publish  (verify_jwt = true — signed-in creators only)
// Publishes to the signed-in creator's own Instagram professional account via the Instagram API with
// Instagram Login. Everything Instagram's publishing API supports:
//   feed  — single image, or a carousel of 2–10 images/videos
//   reel  — video, with cover image / cover frame, share-to-feed, original-audio name
//   story — single image or video + @mentions (user_tags: the mentioned accounts are notified).
//           Stickers (link, poll, location), captions and music are not available through the API.
//   feed/reel — caption (#hashtags, @mentions), people tags, up to 3 collaborators
// Instagram's licensed music library is NOT available through any API; the app offers "open in Instagram"
// on the device instead.
//
// Request body:
// {
//   kind?: "feed" | "reel" | "story",                  // default "feed"
//   media?: [{ type: "image" | "video", url }],        // feed: 1–10 (2+ ⇒ carousel); reel/story: exactly 1
//   image_url?, video_url?,                             // legacy single-media form (still accepted)
//   caption?: string,                                   // ignored for stories
//   user_tags?: string[],                               // usernames to tag / mention (stories: notified mentions)
//   collaborators?: string[],                           // ≤ 3 usernames (feed / reel / carousel)
//   reel?: { cover_url?, thumb_offset_ms?, share_to_feed?, audio_name? }
// }
// Every media URL must be inside the caller's own folder of the public ig-media bucket.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json as jsonRaw } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GRAPH = "https://graph.instagram.com/v23.0";   // story user_tags (mentions) need a 2025+ API version

// every non-2xx reply is logged (reason only — never tokens) so failures are visible in the function logs
function json(body: unknown, status = 200) {
  if (status >= 400) console.warn(`instagram-publish ${status}:`, JSON.stringify(body).slice(0, 800));
  return jsonRaw(body, status);
}

async function readJson(res: Response): Promise<any> {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
}
function metaError(body: any): string | null {
  return body?.error?.error_user_msg || body?.error?.message || body?.message || null;
}

const USERNAME = /^[A-Za-z0-9._]{1,30}$/;
const cleanUsers = (v: unknown, max: number): string[] =>
  (Array.isArray(v) ? v : [])
    .map((u) => String(u || "").trim().replace(/^@/, ""))
    .filter((u, i, a) => USERNAME.test(u) && a.indexOf(u) === i)
    .slice(0, max);

type Media = { type: "image" | "video"; url: string };
class Reject extends Error { constructor(public body: unknown, public status = 400) { super("reject"); } }

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const started = Date.now();
  const budgetLeft = () => 140_000 - (Date.now() - started);   // stay under the Edge wall-clock limit

  try {
    // ---------- 1. caller ----------
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return json({ error: "Not authenticated" }, 401);

    // ---------- 2. input ----------
    const body = await req.json().catch(() => ({}));
    const kind = String(body?.kind || "feed").toLowerCase();
    if (!["feed", "story", "reel"].includes(kind)) return json({ error: "kind must be feed, reel or story" }, 400);

    let media: Media[] = Array.isArray(body?.media)
      ? body.media.map((m: any) => ({ type: m?.type === "video" ? "video" : "image", url: String(m?.url || "") }))
      : [];
    if (!media.length && body?.image_url) media = [{ type: "image", url: String(body.image_url) }];
    if (!media.length && body?.video_url) media = [{ type: "video", url: String(body.video_url) }];

    if (!media.length) return json({ error: "Add a photo or video first." }, 400);
    if (kind === "feed" && media.length > 10) return json({ error: "A carousel can have at most 10 items." }, 400);
    if (kind !== "feed" && media.length !== 1) return json({ error: `A ${kind} takes exactly one file.` }, 400);
    if (kind === "reel" && media[0].type !== "video") return json({ error: "A reel needs a video." }, 400);
    if (kind === "feed" && media.length === 1 && media[0].type === "video") {
      return json({ error: "Single videos are published as Reels — choose Reel." }, 400);
    }

    const caption = kind === "story" ? "" : String(body?.caption || "");
    if (caption.length > 2200) return json({ error: "Caption is too long (max 2,200 characters)." }, 400);
    if ((caption.match(/#[\p{L}\p{N}_]+/gu) || []).length > 30) return json({ error: "Instagram allows at most 30 hashtags." }, 400);
    if ((caption.match(/@[A-Za-z0-9._]+/g) || []).length > 20) return json({ error: "Instagram allows at most 20 @mentions." }, 400);

    const userTags = cleanUsers(body?.user_tags, 20);
    const collaborators = kind === "story" ? [] : cleanUsers(body?.collaborators, 3);
    const reelOpt = body?.reel || {};

    // all media (and an optional reel cover) must be the caller's own uploads
    const ownPrefix = `${SUPABASE_URL.replace(/\/+$/, "")}/storage/v1/object/public/ig-media/${user.id}/`;
    const coverUrl = kind === "reel" && reelOpt?.cover_url ? String(reelOpt.cover_url) : "";
    for (const u of [...media.map((m) => m.url), ...(coverUrl ? [coverUrl] : [])]) {
      if (!u.startsWith(ownPrefix)) {
        return json({ error: "Upload the file through the Media Kit first — only your own uploaded media can be published." }, 400);
      }
    }

    // ---------- 3. token ----------
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
    const { data: tok, error: tokErr } = await admin.from("social_tokens")
      .select("access_token, ig_user_id, expires_at").eq("member_id", user.id).eq("platform", "instagram").maybeSingle();
    if (tokErr) return json({ error: "Could not read Instagram connection." }, 500);
    if (!tok?.access_token) return json({ error: "Instagram not connected" }, 400);
    if (tok.expires_at && new Date(tok.expires_at) < new Date()) {
      return json({ error: "Instagram token expired — please reconnect your Instagram account." }, 400);
    }
    const accessToken = tok.access_token as string;

    // ---------- 4. resolve the account to publish to ----------
    // `me` (the token's own account) works for every creator regardless of which id was stored; if Instagram
    // refuses it, fall back to the token's app-scoped id, its professional id, then the stored id.
    // The stored id is never rewritten here (login / refresh / webhooks key accounts on it).
    const post = async (path: string, params: Record<string, string>) => {
      const p = new URLSearchParams({ ...params, access_token: accessToken });
      const r = await fetch(`${GRAPH}/${path}`, { method: "POST", body: p });
      return { ok: r.ok, j: await readJson(r) };
    };
    const get = async (path: string, fields: string) => {
      const r = await fetch(`${GRAPH}/${path}?fields=${fields}&access_token=${encodeURIComponent(accessToken)}`);
      return { ok: r.ok, j: await readJson(r) };
    };

    let acct = "me";
    const createOn = async (params: Record<string, string>) => {
      const first = await post(`${acct}/media`, params);
      if (first.ok && first.j?.id || acct !== "me") return first;
      const me = await get("me", "id,user_id");
      for (const id of [me.j?.id, me.j?.user_id, tok.ig_user_id].map((x) => String(x || "")).filter((x, i, a) => x && a.indexOf(x) === i)) {
        const t = await post(`${id}/media`, params);
        if (t.ok && t.j?.id) { acct = id; return t; }
      }
      return first;
    };
    // Instagram rejects the WHOLE item if any tagged/mentioned account can't be tagged (doesn't exist, private,
    // blocked, or has mentions turned off). Retry without the offending usernames (named in Instagram's — possibly
    // localized — message), or without tags if none can be identified, and report who was skipped.
    const skippedTags = new Set<string>();
    const mustCreate = async (params: Record<string, string>, what: string) => {
      let r = await createOn(params);
      if ((!r.ok || !r.j?.id) && params.user_tags) {
        const msg = String(metaError(r.j) || "");
        let tags: any[] = []; try { tags = JSON.parse(params.user_tags); } catch { /* ignore */ }
        const named = tags.filter((t) => t?.username && msg.includes(String(t.username)));
        const drop = named.length ? named : tags;
        drop.forEach((t) => t?.username && skippedTags.add(String(t.username)));
        const keep = tags.filter((t) => !drop.includes(t));
        const retry = { ...params };
        if (keep.length) retry.user_tags = JSON.stringify(keep); else delete retry.user_tags;
        r = await createOn(retry);
        if ((!r.ok || !r.j?.id) && retry.user_tags) {          // still failing → last try with no tags at all
          keep.forEach((t) => t?.username && skippedTags.add(String(t.username)));
          delete retry.user_tags;
          r = await createOn(retry);
        }
      }
      if (!r.ok || !r.j?.id) throw new Reject({ error: `Instagram rejected the ${what}.`, detail: metaError(r.j) || r.j });
      return String(r.j.id);
    };

    // wait until a container is FINISHED (videos take much longer than images)
    const waitReady = async (id: string, isVideo: boolean) => {
      const wait = isVideo ? 3000 : 1500;
      while (budgetLeft() > wait + 5000) {
        await new Promise((r) => setTimeout(r, wait));
        const s = await get(id, "status_code,status");
        const code = s.j?.status_code || s.j?.status;
        if (code === "FINISHED") return;
        if (code === "ERROR" || code === "EXPIRED") {
          throw new Reject({ error: "Instagram could not process your media.", detail: s.j?.status || metaError(s.j) || s.j });
        }
      }
      throw new Reject({ error: "Instagram is still processing your media. Check your Instagram in a minute — if it isn't there, try again.", container_id: id });
    };

    // people tags on a photo: spread evenly across the middle band so tags don't stack
    const imageTags = () => JSON.stringify(userTags.map((username, i) => ({
      username, x: Number(((i + 1) / (userTags.length + 1)).toFixed(3)), y: 0.5,
    })));

    // ---------- 5. build containers ----------
    let containerId: string;
    let containerIsVideo = false;

    if (kind === "story") {
      const m = media[0];
      containerIsVideo = m.type === "video";
      const p: Record<string, string> = { media_type: "STORIES", ...(containerIsVideo ? { video_url: m.url } : { image_url: m.url }) };
      // mentions without a sticker (x/y optional for stories) — Instagram notifies each mentioned account
      if (userTags.length) p.user_tags = JSON.stringify(userTags.map((username) => ({ username })));
      containerId = await mustCreate(p, "story");
    } else if (kind === "reel") {
      const p: Record<string, string> = { media_type: "REELS", video_url: media[0].url };
      if (caption) p.caption = caption;
      if (coverUrl) p.cover_url = coverUrl;
      const off = Number(reelOpt?.thumb_offset_ms);
      if (!coverUrl && Number.isFinite(off) && off > 0) p.thumb_offset = String(Math.round(off));
      p.share_to_feed = reelOpt?.share_to_feed === false ? "false" : "true";
      const audio = String(reelOpt?.audio_name || "").trim().slice(0, 50);
      if (audio) p.audio_name = audio;
      if (userTags.length) p.user_tags = JSON.stringify(userTags.map((username) => ({ username })));
      if (collaborators.length) p.collaborators = JSON.stringify(collaborators);
      containerIsVideo = true;
      containerId = await mustCreate(p, "reel");
    } else if (media.length === 1) {
      const p: Record<string, string> = { image_url: media[0].url };
      if (caption) p.caption = caption;
      if (userTags.length) p.user_tags = imageTags();
      if (collaborators.length) p.collaborators = JSON.stringify(collaborators);
      containerId = await mustCreate(p, "post");
    } else {
      // carousel: children first (tags go on image children), then the parent
      const children: string[] = [];
      for (let i = 0; i < media.length; i++) {
        const m = media[i];
        const p: Record<string, string> = { is_carousel_item: "true" };
        if (m.type === "video") { p.media_type = "VIDEO"; p.video_url = m.url; } else { p.image_url = m.url; }
        if (m.type === "image" && i === 0 && userTags.length) p.user_tags = imageTags();
        const id = await mustCreate(p, `carousel item ${i + 1}`);
        await waitReady(id, m.type === "video");
        children.push(id);
      }
      const p: Record<string, string> = { media_type: "CAROUSEL", children: children.join(",") };
      if (caption) p.caption = caption;
      if (collaborators.length) p.collaborators = JSON.stringify(collaborators);
      containerId = await mustCreate(p, "carousel");
    }

    await waitReady(containerId, containerIsVideo);

    // ---------- 6. publish ----------
    const pub = await post(`${acct}/media_publish`, { creation_id: containerId });
    if (!pub.ok || !pub.j?.id) {
      return json({ error: "Instagram could not publish.", detail: metaError(pub.j) || pub.j, container_id: containerId }, 400);
    }
    const mediaId = String(pub.j.id);
    const link = await get(mediaId, "permalink").catch(() => ({ ok: false, j: {} as any }));

    return json({
      ok: true, kind, media_id: mediaId, container_id: containerId,
      permalink: link.ok ? link.j?.permalink ?? null : null,
      carousel: kind === "feed" && media.length > 1,
      skipped_tags: [...skippedTags],
      message: kind === "story" ? "Story is live on Instagram." : kind === "reel" ? "Reel published." : "Post published.",
    });
  } catch (e) {
    if (e instanceof Reject) return json(e.body, e.status);
    console.error("instagram-publish error:", e);
    return json({ error: "Publishing failed. Please try again." }, 500);
  }
});
