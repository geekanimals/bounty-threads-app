// Edge Function: ig-discover  (verify_jwt = true — an approved agency, brand or Super Admin only)
// Pulls public Instagram data for creators who are NOT on Geek OS yet, using the caller's own connected
// Instagram account, and files them in the discovery pool.
//
//   { action: "lookup",  username }   → one public profile (followers, posts, bio, recent posts)
//   { action: "tagged" }              → the accounts that tagged / mentioned this Instagram, filed as candidates
//   { action: "hashtag", tag, edge }  → top (or recent) public posts for a #hashtag (Instagram Public Content Access);
//                                        the @accounts mentioned in those captions are filed as candidates
//   { action: "public_stats", handle, links } → public profile analytics + numbers of those post links (saved)
//   { action: "scout", city, category }  → finds creators of a city and/or category live: builds the matching
//                                        hashtags (#delhifoodblogger…), reads their top + recent posts, collects the
//                                        @accounts those posts name, then pulls each one's full public profile
//                                        (followers, bio, posts, engagement) and files them under that city/category
//
// Honest about Meta's limits: public lookup of an arbitrary handle is the Facebook Graph "business discovery"
// edge, which needs a Facebook Page linked to the Instagram account plus App Review. When that isn't granted
// the call answers { error, needs_permission: true } and the app still adds the handle (without the numbers),
// so discovery and invites keep working. Hashtag → username is not offered by Meta at all, so we never pretend
// to: hashtags are matched from the captions the handle was actually found in.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { openRow, openToken, sealToken, tokenEncryptionOn } from "../_shared/token_crypto.ts";
import { corsHeaders, json } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const IG_GRAPH = "https://graph.instagram.com/v23.0";
const FB_GRAPH = "https://graph.facebook.com/v23.0";

const needsPermission = (j: any) =>
  [10, 100, 110, 200, 230, 3].includes(Number(j?.error?.code)) ||
  /permission|not authorized|capability|business_discovery|does not exist/i.test(String(j?.error?.message || ""));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Not authenticated" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
    const { data: member } = await admin.from("members").select("role, status, org_id").eq("id", user.id).maybeSingle();
    const { data: isAdmin } = await admin.from("platform_admins").select("user_id").eq("user_id", user.id).maybeSingle();
    const allowed = !!isAdmin || (member && ["owner", "brand", "manager", "corporate"].includes(member.role) && (member.status ?? "active") === "active");
    if (!allowed) return json({ error: "Discovery is for approved agencies, brands and the Super Admin." }, 403);

    const { data: tokRaw } = await admin.from("social_tokens").select("access_token, ig_user_id, expires_at")
      .eq("member_id", user.id).eq("platform", "instagram").maybeSingle();
    const tok = await openRow(tokRaw);
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "");
    if (action === "tagged") {
      if (!tok?.access_token) return json({ error: "Connect your Instagram first — then we can read it for you.", needs_connect: true }, 400);
      if (tok.expires_at && new Date(tok.expires_at) < new Date()) return json({ error: "Instagram token expired — reconnect Instagram." }, 400);
    }
    const T = encodeURIComponent(String(tok?.access_token || ""));

    if (action === "lookup") {
      const username = String(body?.username || "").trim().replace(/^@/, "").toLowerCase();
      if (!/^[a-z0-9._]{2,30}$/.test(username)) return json({ error: "Enter a valid Instagram username." }, 400);
      // business discovery needs a Facebook-Login Page token: this account's own ("Connect with Facebook"),
      // else the platform's shared one (Super Admin / any connected workspace)
      const { data: fbtRaw } = await admin.from("social_tokens").select("access_token, ig_user_id")
        .eq("member_id", user.id).eq("platform", "facebook").maybeSingle();
      const fbt = await openRow(fbtRaw);
      let src = fbt?.access_token ? fbt : null;
      if (!src) { const { data: shared } = await admin.schema("api").rpc("ops_discovery_token"); if (shared?.platform === "facebook") src = await openRow(shared); }
      if (!src?.access_token || !src?.ig_user_id) {
        await userClient.schema("api").rpc("save_external_candidates", { p_items: [{ handle: username, source: "manual" }] }).then(() => {}, () => {});
        return json({ error: `@${username} is added. Live Instagram numbers switch on once the Geek Super Admin turns on Instagram search (one-time).`, needs_facebook: true, added: true }, 200);
      }
      const igId = String(src.ig_user_id);
      const FT = encodeURIComponent(String(src.access_token));

      const want = Math.min(Math.max(Number(body?.media_limit) || 12, 6), 30);
      const fields = `business_discovery.username(${encodeURIComponent(username)}){username,name,biography,website,followers_count,follows_count,media_count,profile_picture_url,media.limit(${want}){id,caption,permalink,like_count,comments_count,media_type,media_url,thumbnail_url,timestamp}}`;
      let r = await fetch(`${FB_GRAPH}/${encodeURIComponent(igId)}?fields=${fields}&access_token=${FT}`);
      if (!r.ok) {   // some accounts refuse a field (thumbnail_url / website) — ask again with the basic set
        const basic = `business_discovery.username(${encodeURIComponent(username)}){username,name,biography,followers_count,follows_count,media_count,profile_picture_url,media.limit(${want}){id,caption,permalink,like_count,comments_count,media_type,media_url,timestamp}}`;
        const r2 = await fetch(`${FB_GRAPH}/${encodeURIComponent(igId)}?fields=${basic}&access_token=${FT}`);
        if (r2.ok) r = r2;
      }
      const j = await r.json().catch(() => ({}));
      const bd = j?.business_discovery;
      if (!r.ok || !bd) {
        const m = String(j?.error?.message || "");
        const msg = /does not exist|cannot be found|invalid user|username/i.test(m) || Number(j?.error?.code) === 110
          ? `@${username} isn't a public Business or Creator account (or doesn't exist) — Instagram only shares numbers for those. It's still added; invite them anyway.`
          : needsPermission(j) ? `Instagram refused the lookup: ${m || "permission"} — reconnect with Facebook and select the Page + Instagram account.`
          : (m || "Instagram couldn't return that profile.");
        await userClient.schema("api").rpc("save_external_candidates", { p_items: [{ handle: username, source: "manual" }] }).then(() => {}, () => {});
        return json({ error: msg, needs_permission: needsPermission(j) }, 200);
      }
      const media: any[] = bd?.media?.data ?? [];
      const caption = media.map((m: any) => m?.caption || "").join(" ").slice(0, 1500);
      const avg = (k: string) => media.length ? media.reduce((s2: number, m: any) => s2 + (Number(m?.[k]) || 0), 0) / media.length : null;
      const me = String(bd.username || username).toLowerCase();
      const mentions = [...new Set((caption.match(/@([A-Za-z0-9._]{2,30})/g) || []).map((x: string) => x.slice(1).toLowerCase().replace(/\.$/, "")))].filter((h) => h !== me).slice(0, 30);
      const profile = {
        handle: me, name: bd.name ?? null, bio: (bd.biography ?? "").slice(0, 300),
        followers: bd.followers_count ?? null, media_count: bd.media_count ?? null,
        profile_picture_url: bd.profile_picture_url ?? null,
        permalink: media[0]?.permalink ?? null, caption, source: "manual",
        avg_likes: avg("like_count"), avg_comments: avg("comments_count"), mentions,
      };
      await userClient.schema("api").rpc("save_external_candidates", { p_items: [profile] }).then(() => {}, () => {});
      // what the app shows (not saved): the full public profile + their latest posts
      const posts = media.map((m: any) => ({ id: m.id ?? null, caption: String(m.caption || "").slice(0, 600), permalink: m.permalink ?? null,
        like_count: m.like_count ?? null, comments_count: m.comments_count ?? null, media_type: m.media_type ?? null,
        media_url: m.media_url ?? null, thumbnail_url: m.thumbnail_url ?? null, timestamp: m.timestamp ?? null }));
      return json({ ok: true, profile: { ...profile, bio: String(bd.biography ?? ""), website: bd.website ?? null, follows: bd.follows_count ?? null,
        username: bd.username ?? me }, posts });
    }

    // public analytics of any public Business / Creator account + the numbers of the given post links — what
    // engagement-rate tools show (followers, engagement rate, avg likes / comments, latest posts). Read with the
    // platform's Facebook (Page) connection; saved so the campaign report, the creator row and the cards show it.
    //   { action: "public_stats", handle, links: [instagram post urls] }
    if (action === "public_stats") {
      const handle = String(body?.handle || "").trim().replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/^@/, "").replace(/[/?].*$/, "").toLowerCase();
      if (!/^[a-z0-9._]{2,30}$/.test(handle)) return json({ error: "No Instagram username for this creator." }, 400);
      const links: string[] = (Array.isArray(body?.links) ? body.links : []).map((x: unknown) => String(x || "").trim()).filter(Boolean).slice(0, 20);
      const codeOf = (u: string) => { const m = /instagram\.com\/(?:[^/]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i.exec(u); return m ? m[1] : null; };
      const codes = [...new Set(links.map(codeOf).filter(Boolean) as string[])];
      const { data: shared } = await admin.schema("api").rpc("ops_discovery_token");
      const src = shared?.platform === "facebook" ? await openRow(shared) : null;
      if (!src?.access_token || !src?.ig_user_id) {
        return json({ needs_facebook: true, error: "Public Instagram numbers need the one-time “Connect Facebook” by the Super Admin (Discovery → Connect Facebook). Until then add the insights screenshot or type the numbers." }, 200);
      }
      const read = async (withViews: boolean) => {
        const mf = withViews ? "id,permalink,caption,like_count,comments_count,media_type,media_product_type,media_url,thumbnail_url,timestamp,view_count"
                             : "id,permalink,caption,like_count,comments_count,media_type,media_product_type,media_url,thumbnail_url,timestamp";
        const fields = `business_discovery.username(${encodeURIComponent(handle)}){username,name,biography,website,followers_count,follows_count,media_count,profile_picture_url,media.limit(50){${mf}}}`;
        const r = await fetch(`${FB_GRAPH}/${encodeURIComponent(String(src.ig_user_id))}?fields=${fields}&access_token=${encodeURIComponent(String(src.access_token))}`);
        return { ok: r.ok, j: await r.json().catch(() => ({})) as any };
      };
      let r = await read(true);
      if (!r.ok && /view_count|nonexisting field|Tried accessing/i.test(String(r.j?.error?.message || ""))) r = await read(false);
      const bd = r.j?.business_discovery;
      if (!r.ok || !bd) {
        const m = String(r.j?.error?.message || "");
        const msg = /does not exist|cannot be found|invalid user/i.test(m) || Number(r.j?.error?.code) === 110
          ? `@${handle} is a private or personal account — Instagram shares numbers only for public Business / Creator accounts. Add the insights screenshot instead.`
          : needsPermission(r.j) ? `Instagram refused the lookup (${m || "permission"}) — the Super Admin reconnects Facebook in Discovery.` : (m || "Instagram couldn't return that profile.");
        if (codes.length) await admin.schema("api").rpc("ops_public_post_save", { p_handle: handle, p_profile: null, p_codes: codes, p_items: [], p_error: msg.slice(0, 200) }).then(() => {}, () => {});
        return json({ error: msg, private: /private or personal/.test(msg) }, 200);
      }
      const media: any[] = bd.media?.data ?? [];
      const n = (v: unknown) => (typeof v === "number" ? v : null);
      const avg = (k: string, list = media) => { const x = list.map((m) => n(m?.[k])).filter((v) => v != null) as number[]; return x.length ? x.reduce((a, b) => a + b, 0) / x.length : null; };
      const reels = media.filter((m) => m?.media_product_type === "REELS" || m?.media_type === "VIDEO");
      const fol = n(bd.followers_count);
      const al = avg("like_count"), ac = avg("comments_count");
      const profile = { handle: String(bd.username || handle).toLowerCase(), name: bd.name ?? null, bio: String(bd.biography ?? ""), website: bd.website ?? null,
        followers: fol, follows: n(bd.follows_count), media_count: n(bd.media_count), profile_picture_url: bd.profile_picture_url ?? null,
        avg_likes: al, avg_comments: ac, avg_views: avg("view_count", reels), posts_read: media.length,
        engagement: fol && al != null ? Math.round(10000 * ((al || 0) + (ac || 0)) / fol) / 100 : null,
        last_post_at: media[0]?.timestamp ?? null };
      const { data: saved } = await admin.schema("api").rpc("ops_public_post_save", { p_handle: handle,
        p_profile: { name: bd.name ?? null, followers_count: fol, media_count: n(bd.media_count), profile_picture_url: bd.profile_picture_url ?? null,
                     avg_likes: al, avg_comments: ac, engagement: profile.engagement, bio: profile.bio },
        p_codes: codes, p_items: media, p_error: null });
      const byCode = new Map(media.map((m) => [codeOf(String(m?.permalink || "")), m]));
      const posts = codes.map((c) => { const m = byCode.get(c);
        return m ? { code: c, permalink: m.permalink, media_type: m.media_product_type || m.media_type, likes: n(m.like_count), comments: n(m.comments_count),
                     views: n(m.view_count), timestamp: m.timestamp ?? null, found: true }
                 : { code: c, permalink: links.find((l) => codeOf(l) === c) ?? null, found: false, note: "Not among their latest 50 posts (or it's a story) — add the insights screenshot." }; });
      const recent = media.slice(0, 12).map((m) => ({ permalink: m.permalink, media_type: m.media_product_type || m.media_type, likes: n(m.like_count),
        comments: n(m.comments_count), views: n(m.view_count), timestamp: m.timestamp ?? null,
        img: (m.media_type === "VIDEO" ? m.thumbnail_url : (m.media_url || m.thumbnail_url)) ?? null, caption: String(m.caption || "").slice(0, 140) }));
      return json({ ok: true, profile, posts, recent, saved: Number(saved || 0) });
    }

    if (action === "tagged") {
      const igId = String(tok?.ig_user_id || "me");
      const r = await fetch(`${IG_GRAPH}/${encodeURIComponent(igId)}/tags?fields=id,username,caption,permalink,media_type,timestamp&limit=50&access_token=${T}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return json({ error: j?.error?.message || "Instagram couldn't return the accounts that tagged you.", needs_permission: needsPermission(j) }, 200);
      const items = (j?.data ?? [])
        .filter((m: any) => m?.username)
        .map((m: any) => ({ handle: String(m.username).toLowerCase(), caption: String(m.caption || "").slice(0, 500), permalink: m.permalink ?? null, source: "tagged_brand" }));
      let saved = 0;
      if (items.length) {
        const { data } = await userClient.schema("api").rpc("save_external_candidates", { p_items: items });
        saved = Number(data) || 0;
      }
      return json({ ok: true, found: items.length, saved });
    }

    if (action === "hashtag") {
      const tag = String(body?.tag || "").trim().replace(/^#/, "").toLowerCase();
      const edge = body?.edge === "recent" ? "recent_media" : "top_media";
      if (!/^[\p{L}\p{N}_]{2,60}$/u.test(tag)) return json({ error: "Enter a hashtag, e.g. #foodblogger" }, 400);
      const { data: fbtRaw } = await admin.from("social_tokens").select("access_token, ig_user_id")
        .eq("member_id", user.id).eq("platform", "facebook").maybeSingle();
      let src = await openRow(fbtRaw);
      if (!src?.access_token) { const { data: shared } = await admin.schema("api").rpc("ops_discovery_token"); if (shared?.platform === "facebook") src = await openRow(shared); }
      if (!src?.access_token || !src?.ig_user_id) {
        return json({ error: "Hashtag search switches on once the Geek Super Admin turns on Instagram search (Connect with Facebook, one time).", needs_facebook: true }, 200);
      }
      const igId = encodeURIComponent(String(src.ig_user_id)), FT = encodeURIComponent(String(src.access_token));
      const hs = await (await fetch(`${FB_GRAPH}/ig_hashtag_search?user_id=${igId}&q=${encodeURIComponent(tag)}&access_token=${FT}`)).json().catch(() => ({}));
      const hid = hs?.data?.[0]?.id;
      if (!hid) {
        const m = String(hs?.error?.message || "");
        return json({ error: m ? `Instagram refused the hashtag search: ${m}` : `No public posts found for #${tag}.`, needs_permission: needsPermission(hs) }, 200);
      }
      const fields = "id,caption,media_type,media_url,permalink,like_count,comments_count,timestamp,children{media_url,media_type}";
      const pull = async (e: string) => {
        // Instagram sometimes answers "reduce the amount of data" → ask again with fewer posts / lighter fields
        const lite = fields.replace(",children{media_url,media_type}", "");
        let mr: any = {};
        for (const [f, n] of [[lite, 25], [lite, 12], [fields, 8]] as [string, number][]) {
          mr = await (await fetch(`${FB_GRAPH}/${hid}/${e}?user_id=${igId}&fields=${f}&limit=${n}&access_token=${FT}`)).json().catch(() => ({}));
          if (Array.isArray(mr?.data)) break;
        }
        return mr;
      };
      const shape = (m: any) => {
        const kid = (m?.children?.data ?? []).find((c: any) => c?.media_url);
        return { id: m.id, caption: String(m.caption || "").slice(0, 400), media_type: m.media_type,
          media_url: m.media_url ?? kid?.media_url ?? null, kid_type: kid?.media_type ?? null,
          permalink: m.permalink ?? null, like_count: m.like_count ?? null, comments_count: m.comments_count ?? null, timestamp: m.timestamp ?? null };
      };
      const both = body?.edge === "both";
      const [mr, mr2] = await Promise.all([pull(both ? "top_media" : edge), both ? pull("recent_media") : Promise.resolve(null)]);
      if (!Array.isArray(mr?.data)) return json({ error: mr?.error?.message || "Instagram couldn't return posts for that hashtag.", needs_permission: needsPermission(mr) }, 200);
      const posts = mr.data.map(shape);
      const recent = Array.isArray(mr2?.data) ? mr2.data.map(shape) : null;
      // Instagram doesn't say who posted a hashtag post — but captions name accounts (@handle): those become candidates
      const handles = [...new Set([...posts, ...(recent || [])].flatMap((p: any) => (p.caption.match(/@([A-Za-z0-9._]{2,30})/g) || []).map((x: string) => x.slice(1).toLowerCase().replace(/\.$/, ""))))].slice(0, 40);
      if (handles.length) {
        await userClient.schema("api").rpc("save_external_candidates", { p_items: handles.map((h) => ({ handle: h, source: "hashtag", caption: `#${tag}` })) }).then(() => {}, () => {});
      }
      return json({ ok: true, tag, edge: both ? "both" : edge, posts, recent, handles });
    }


    if (action === "scout") {
      const city = String(body?.city || "").trim().slice(0, 40);
      const category = String(body?.category || "").trim().slice(0, 40);
      const keyword = String(body?.keyword || "").trim().replace(/^#/, "").slice(0, 40);
      if (!city && !category && !keyword) return json({ error: "Type a keyword, or pick a city or a category first." }, 400);
      const { data: fbtRaw } = await admin.from("social_tokens").select("access_token, ig_user_id")
        .eq("member_id", user.id).eq("platform", "facebook").maybeSingle();
      let src = await openRow(fbtRaw);
      if (!src?.access_token) { const { data: shared } = await admin.schema("api").rpc("ops_discovery_token"); if (shared?.platform === "facebook") src = await openRow(shared); }
      if (!src?.access_token || !src?.ig_user_id) {
        return json({ error: "Live city / category search switches on once the Geek Super Admin turns on Instagram search (Connect with Facebook, one time).", needs_facebook: true }, 200);
      }
      const igId = encodeURIComponent(String(src.ig_user_id)), FT = encodeURIComponent(String(src.access_token));
      const tags = scoutTags(city, category, keyword);
      const count = new Map<string, number>(), seenIn = new Map<string, string>();
      const used: string[] = []; let lastErr = "", permErr = false;
      const caps = await Promise.all(tags.map(async (tag) => {
        const hs = await fj(`${FB_GRAPH}/ig_hashtag_search?user_id=${igId}&q=${encodeURIComponent(tag)}&access_token=${FT}`);
        const hid = hs?.data?.[0]?.id;
        if (!hid) { if (hs?.error) { lastErr = String(hs.error.message || ""); permErr = permErr || needsPermission(hs); } return null; }
        const pages = await Promise.all(["top_media", "recent_media"].map(async (edge) => {
          // a few pages of captions (Instagram caps each page; "reduce the data" → smaller pages)
          const out: any[] = [];
          for (const n of [25, 12]) {
            let url = `${FB_GRAPH}/${hid}/${edge}?user_id=${igId}&fields=caption&limit=${n}&access_token=${FT}`;
            for (let pg = 0; pg < 3 && url; pg++) {
              const mr = await fj(url);
              if (!Array.isArray(mr?.data)) { if (mr?.error) lastErr = String(mr.error.message || lastErr); break; }
              out.push(...mr.data); url = mr?.paging?.next || "";
            }
            if (out.length) break;
          }
          return out;
        }));
        return { tag, media: pages.flat() };
      }));
      for (const c of caps) {
        if (!c) continue;
        used.push(c.tag);
        for (const m of c.media) {
          for (const x of (String(m?.caption || "").match(/@([A-Za-z0-9._]{2,30})/g) || [])) {
            const h = x.slice(1).toLowerCase().replace(/\.+$/, "");
            if (h.length < 2) continue;
            count.set(h, (count.get(h) || 0) + 1);
            if (!seenIn.has(h)) seenIn.set(h, c.tag);
          }
        }
      }
      if (!used.length) {
        return json({ error: lastErr ? `Instagram refused the search: ${lastErr}` : "Instagram has no public posts for these hashtags right now.", needs_permission: permErr, tags }, 200);
      }
      // most-mentioned first; pull the full public profile of each (Business / Creator accounts only — Meta's rule)
      const ranked = [...count.entries()].sort((a, b) => b[1] - a[1]).map(([h]) => h).slice(0, 30);
      const want = (category ? [category] : []);
      const profiles: any[] = [], noStats: string[] = [];
      let bdPerm = false;
      for (let i = 0; i < ranked.length; i += 10) {
        const batch = ranked.slice(i, i + 10);
        if (bdPerm) { noStats.push(...batch); continue; }
        const got = await Promise.all(batch.map((h) => bdProfile(igId, FT, h)));
        got.forEach((p, k) => {
          const h = batch[k];
          if (p && (p as any).perm) { bdPerm = true; noStats.push(h); return; }
          if (!p) { noStats.push(h); return; }
          profiles.push({ ...p, source: "hashtag", city: cityFor(p.bio, city), category: want.join(","), caption: `${p.caption} #${seenIn.get(h)}`.slice(0, 1500) });
        });
      }
      const items = [...profiles, ...noStats.map((h) => ({ handle: h, source: "hashtag", city: city || null, category: want.join(","), caption: `#${seenIn.get(h)}` }))];
      if (items.length) {
        const { error: se } = await userClient.schema("api").rpc("save_external_candidates", { p_items: items });
        if (se) console.error("scout save:", se.message);
      }
      profiles.sort((a, b) => (b.followers || 0) - (a.followers || 0));
      return json({ ok: true, tags: used, found: ranked.length, with_stats: profiles.length,
        posts_read: caps.reduce((n, c) => n + (c?.media?.length || 0), 0),
        note: bdPerm ? "Handles added. Followers / engagement need Meta's instagram_manage_insights permission — once it's on, reconnect Facebook and search again." : undefined,
        profiles: profiles.map(({ caption: _c, mentions: _m, ...r }) => r), no_stats: noStats });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error("ig-discover error:", (e as Error).message);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});

// fetch JSON with a time limit so one slow Instagram call can't hang the whole search
async function fj(url: string, ms = 12000): Promise<any> {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(ms) }); return await r.json().catch(() => ({})); }
  catch { return { error: { message: "Instagram took too long to answer" } }; }
}

// one public profile through business discovery (null = personal / private / missing account)
async function bdProfile(igId: string, FT: string, username: string) {
  const fields = `business_discovery.username(${encodeURIComponent(username)}){username,name,biography,followers_count,media_count,profile_picture_url,media.limit(12){caption,permalink,like_count,comments_count}}`;
  const j = await fj(`${FB_GRAPH}/${igId}?fields=${fields}&access_token=${FT}`);
  const bd = j?.business_discovery;
  if (!bd) return needsPermission(j) ? ({ perm: true } as any) : null;
  const media: any[] = bd?.media?.data ?? [];
  const avg = (k: string) => media.length ? media.reduce((s2: number, m: any) => s2 + (Number(m?.[k]) || 0), 0) / media.length : null;
  const caption = media.map((m: any) => m?.caption || "").join(" ").slice(0, 1200);
  const me = String(bd.username || username).toLowerCase();
  return { handle: me, name: bd.name ?? null, bio: String(bd.biography ?? "").slice(0, 300), followers: bd.followers_count ?? null,
    media_count: bd.media_count ?? null, profile_picture_url: bd.profile_picture_url ?? null, permalink: media[0]?.permalink ?? null,
    avg_likes: avg("like_count"), avg_comments: avg("comments_count"), caption };
}

// city / category → the hashtags creators there actually use. Kept to 4 per search: Meta allows 30 different
// hashtags per 7 days for one Instagram account, and searching the same hashtag again doesn't use up more.
const CITY_TAG: Record<string, string> = { "delhi ncr": "delhi", "new delhi": "delhi", "gurugram": "gurgaon", "bengaluru": "bangalore", "bombay": "mumbai", "calcutta": "kolkata" };
const CAT_TAGS: Record<string, string[]> = {
  food: ["foodblogger", "food", "foodie"], fashion: ["fashionblogger", "fashion", "fashioninfluencer"],
  beauty: ["beautyblogger", "makeup", "beautyinfluencer"], fitness: ["fitness", "fitnessinfluencer", "gym"],
  travel: ["travelblogger", "travel", "traveldiaries"], tech: ["tech", "techreview", "techinfluencer"],
  comedy: ["comedy", "comedian", "memes"], lifestyle: ["lifestyleblogger", "blogger", "influencer"],
  parenting: ["momblogger", "mommyblogger", "parenting"], gaming: ["gaming", "gamer", "streamer"],
  finance: ["finance", "stockmarket", "personalfinance"], music: ["singer", "music", "musician"],
  dance: ["dancer", "dance", "choreography"], art: ["artist", "art", "artistsoninstagram"],
  photography: ["photographer", "photography", "photographers"], pets: ["dogsofinstagram", "petlover", "petsofinstagram"],
  "home decor": ["homedecor", "interiordesign", "homedecorideas"], auto: ["carsofinstagram", "motovlogger", "automobile"],
  health: ["healthylifestyle", "nutritionist", "wellness"], education: ["education", "studygram", "learning"],
  sports: ["sports", "cricket", "athlete"], business: ["entrepreneur", "business", "startup"],
  entertainment: ["actor", "entertainment", "reels"], spirituality: ["spirituality", "spiritual", "meditation"],
};
// file the searched city unless the bio clearly says another one (a Mumbai creator tagged in a #delhifood post stays Mumbai)
const CITY_WORDS = ["delhi", "mumbai", "bangalore", "bengaluru", "hyderabad", "chennai", "kolkata", "pune", "ahmedabad", "jaipur", "lucknow",
  "chandigarh", "indore", "surat", "kochi", "goa", "bhopal", "nagpur", "patna", "dehradun", "guwahati", "gurgaon", "gurugram", "noida"];
function cityFor(bio: string, city: string): string | null {
  if (!city) return null;
  const b = String(bio || "").toLowerCase(), c = city.toLowerCase();
  const mine = (w: string) => c.includes(w) || (CITY_TAG[c] || "").includes(w) || (c.includes("delhi") && ["gurgaon", "gurugram", "noida"].includes(w)) || (c === "bengaluru" && w === "bangalore");
  const other = CITY_WORDS.some((w) => b.includes(w) && !mine(w));
  const same = CITY_WORDS.some((w) => b.includes(w) && mine(w));
  return other && !same ? null : city;
}
function scoutTags(city: string, category: string, keyword = ""): string[] {
  const slug = (x: string) => x.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");
  const c0 = city.toLowerCase().trim(); const c = slug(CITY_TAG[c0] || c0.split(/[\s,]+/)[0] || "");
  const k = category ? (CAT_TAGS[category.toLowerCase().trim()] || [slug(category) + "blogger", slug(category)]) : [];
  const w = slug(keyword);
  let t: string[];
  // a keyword (what they post about) leads; city / category narrow it
  if (w) t = [w, c ? c + w : w + "india", c ? w + c : (k[0] ? w + k[0] : w + "review"), k[0] ? (c ? c + k[0] : k[0]) : (c ? c + "blogger" : w + "s")];
  else if (c && k.length) t = [c + k[0], c + k[1], k[0] + c, c + (k[2] || "blogger")];
  else if (c) t = [c + "blogger", c + "influencer", c + "creator", c + "diaries"];
  else t = [k[0] + "india", "indian" + k[0], k[0], (k[1] || k[0]) + "india"];   // India-first: plain tags are mostly foreign posts
  return [...new Set(t.filter((x) => x && /^[a-z0-9_]{2,60}$/.test(x)))].slice(0, 4);
}
