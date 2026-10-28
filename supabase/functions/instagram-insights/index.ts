// Edge Function: instagram-insights  (verify_jwt = true — the signed-in member's OWN connected Instagram account)
// Instagram API with Instagram Login · permission instagram_business_manage_insights.
//   { action: "account", days?: 7 | 14 | 30 }  → account totals for the period (reach, views, profile views, accounts
//        engaged, interactions, likes, comments, shares, saves, follows / unfollows), a daily reach + follower series,
//        and follower demographics (top cities, countries, age groups, gender)
//   { action: "media", limit?: number }        → the latest posts / reels with their own insights
// Each metric group is asked for separately, so one metric Instagram doesn't offer for an account never blanks the rest.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { openRow } from "../_shared/token_crypto.ts";
import { corsHeaders, json } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GRAPH = "https://graph.instagram.com/v23.0";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const uc = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } });
    const { data: { user } } = await uc.auth.getUser();
    if (!user) return json({ error: "Not authenticated" }, 401);
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
    const { data: tokRaw } = await admin.from("social_tokens").select("access_token, expires_at").eq("member_id", user.id).eq("platform", "instagram").maybeSingle();
    const tok = await openRow(tokRaw);
    if (!tok?.access_token) return json({ error: "Instagram isn't connected yet.", not_connected: true });
    if (tok.expires_at && new Date(tok.expires_at) < new Date()) return json({ error: "Your Instagram connection expired — reconnect Instagram.", expired: true });
    const T = tok.access_token as string;
    const get = async (path: string, params: Record<string, string>) => {
      const qs = new URLSearchParams({ ...params, access_token: T });
      const r = await fetch(`${GRAPH}/${path}?${qs}`);
      return { ok: r.ok, j: (await r.json().catch(() => ({}))) as any };
    };

    const body = await req.json().catch(() => ({}));
    const me = await get("me", { fields: "user_id,username,followers_count,follows_count,media_count,profile_picture_url" });
    if (!me.ok) return json({ error: me.j?.error?.message || "Instagram didn't answer — reconnect Instagram." });
    const id = String(me.j.user_id || me.j.id);
    const profile = { username: me.j.username, followers: me.j.followers_count ?? null, following: me.j.follows_count ?? null, posts: me.j.media_count ?? null, picture: me.j.profile_picture_url ?? null };

    if (body.action === "media") {
      const limit = Math.min(Math.max(Number(body.limit) || 12, 1), 25);
      const m = await get(`${id}/media`, { fields: "id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp,like_count,comments_count", limit: String(limit) });
      const items = Array.isArray(m.j?.data) ? m.j.data : [];
      const out = [];
      for (const it of items) {
        const reel = it.media_product_type === "REELS";
        const metrics = reel ? "reach,views,likes,comments,shares,saved,total_interactions" : "reach,views,likes,comments,shares,saved,total_interactions";
        let ins: Record<string, number> = {};
        const r = await get(`${it.id}/insights`, { metric: metrics });
        if (r.ok) for (const x of (r.j?.data || [])) ins[x.name] = x.values?.[0]?.value ?? x.total_value?.value ?? null;
        else {
          for (const one of ["reach", "views", "saved", "shares"]) {            // fall back metric by metric
            const s = await get(`${it.id}/insights`, { metric: one });
            if (s.ok) for (const x of (s.j?.data || [])) ins[x.name] = x.values?.[0]?.value ?? x.total_value?.value ?? null;
          }
        }
        const inter = (it.like_count || 0) + (it.comments_count || 0) + (ins.shares || 0) + (ins.saved || 0);
        out.push({ id: it.id, type: reel ? "reel" : String(it.media_type || "").toLowerCase(), caption: String(it.caption || "").slice(0, 160), permalink: it.permalink,
                   img: it.thumbnail_url || it.media_url || null, at: it.timestamp, likes: it.like_count ?? null, comments: it.comments_count ?? null,
                   reach: ins.reach ?? null, views: ins.views ?? null, shares: ins.shares ?? null, saves: ins.saved ?? null,
                   er_reach: ins.reach ? Math.round(inter * 10000 / ins.reach) / 100 : null });
      }
      return json({ ok: true, profile, media: out });
    }

    // account insights
    const days = [7, 14, 30].includes(Number(body.days)) ? Number(body.days) : 30;
    const until = Math.floor(Date.now() / 1000), since = until - days * 86400;
    const totals: Record<string, number | null> = {};
    for (const group of ["reach,views,accounts_engaged,total_interactions", "likes,comments,shares,saves", "profile_views", "follows_and_unfollows", "website_clicks,profile_links_taps"]) {
      const r = await get(`${id}/insights`, { metric: group, period: "day", metric_type: "total_value", since: String(since), until: String(until) });
      if (!r.ok) continue;
      for (const x of (r.j?.data || [])) {
        if (x.name === "follows_and_unfollows") {
          for (const b of (x.total_value?.breakdowns?.[0]?.results || [])) totals[String(b.dimension_values?.[0] || "").toLowerCase() === "follower" ? "follows" : "unfollows"] = b.value;
        } else totals[x.name] = x.total_value?.value ?? null;
      }
    }
    // daily series (reach; follower count is only kept by Instagram for the last 30 days)
    const series: Record<string, { d: string; v: number }[]> = {};
    for (const metric of ["reach", "follower_count"]) {
      const r = await get(`${id}/insights`, { metric, period: "day", since: String(Math.max(since, until - 29 * 86400)), until: String(until) });
      if (r.ok) series[metric] = ((r.j?.data || [])[0]?.values || []).map((v: any) => ({ d: String(v.end_time || "").slice(0, 10), v: Number(v.value) || 0 }));
    }
    // who follows (needs 100+ followers)
    const audience: Record<string, { key: string; value: number }[]> = {};
    for (const bd of ["city", "country", "age", "gender"]) {
      const r = await get(`${id}/insights`, { metric: "follower_demographics", period: "lifetime", timeframe: "this_month", metric_type: "total_value", breakdown: bd });
      if (!r.ok) continue;
      const res = (r.j?.data || [])[0]?.total_value?.breakdowns?.[0]?.results || [];
      audience[bd] = res.map((x: any) => ({ key: String(x.dimension_values?.[0] ?? ""), value: Number(x.value) || 0 }))
        .sort((a: any, b: any) => b.value - a.value).slice(0, bd === "age" ? 7 : 8);
    }
    return json({ ok: true, profile, days, totals, series, audience });
  } catch (e) {
    console.error("instagram-insights", (e as Error).message);
    return json({ error: "Couldn't load Instagram insights — please try again." }, 500);
  }
});
