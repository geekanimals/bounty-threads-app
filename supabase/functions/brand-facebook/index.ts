// Edge Function: brand-facebook  (verify_jwt = true — a signed-in brand login with its Facebook business linked)
// Manage the brand's own Facebook Pages and ad accounts from Geek OS, with the Facebook token stored (sealed) when the
// brand linked Facebook (brand-fb-login). Every Page action uses that Page's own token, so Facebook itself makes sure
// it only touches the brand's own Pages.
//   pages                                   → the Pages this login manages (+ linked Instagram, followers, picture)
//   posts        { page_id, after? }         → published posts with reactions / comments / shares (+ reach where offered)
//   scheduled    { page_id }                 → scheduled posts
//   publish      { page_id, message, link?, image_url?, schedule_at? (unix) }  → new post / photo / scheduled post
//   delete_post  { page_id, post_id }
//   comments     { page_id, post_id }        → comments + replies
//   reply        { page_id, comment_id, message }   · hide { page_id, comment_id, hide } · delete_comment { page_id, comment_id }
//   insights     { page_id, days? }          → Page reach, impressions, engagements, views, new follows (daily + totals)
//   ad_accounts                             → ad accounts (status, currency, amount spent)
//   ad_campaigns { account_id, days? }       → campaigns with spend, impressions, reach, clicks, CTR, CPC, results
//   ad_status    { campaign_id, status: "ACTIVE" | "PAUSED" }  → pause / resume a campaign
// View-only brand logins can read everything but can't post, reply, hide, delete or change ads.
// Permissions used: pages_show_list, pages_read_engagement, pages_read_user_content, pages_manage_posts,
// pages_manage_engagement, read_insights, business_management, ads_read, ads_management.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { openToken } from "../_shared/token_crypto.ts";
import { corsHeaders, json } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VER = Deno.env.get("FB_GRAPH_VER") || "v23.0";
const G = `https://graph.facebook.com/${VER}`;
const ID = /^[0-9_]{5,60}$/;
const ACT = /^act_[0-9]{5,30}$/;
const WRITE = new Set(["publish", "delete_post", "reply", "hide", "delete_comment", "ad_status"]);

const gErr = (j: any) => j?.error?.error_user_msg || j?.error?.message || null;
const needsReconnect = (j: any) => [10, 200, 190].includes(Number(j?.error?.code)) || /permission|access token/i.test(String(j?.error?.message || ""));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const uc = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } });
    const { data: { user } } = await uc.auth.getUser();
    if (!user) return json({ error: "Please sign in." }, 401);
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
    const { data: role } = await admin.schema("api").rpc("ops_brand_member_role", { p_member: user.id });
    if (!role || role === "removed") return json({ error: "This page is for brand logins." }, 403);
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "");
    if (WRITE.has(action) && role === "viewer") return json({ error: "This login can only view — ask your team's admin or an approver." }, 403);

    const { data: row } = await admin.from("social_tokens").select("access_token").eq("member_id", user.id).eq("platform", "facebook_brand").maybeSingle();
    const T = await openToken(row?.access_token);
    if (!T) return json({ error: "Link your Facebook business first (Settings → Link Facebook business).", not_linked: true });

    const call = async (method: string, path: string, params: Record<string, string | undefined> = {}, token = T) => {
      const p: Record<string, string> = { access_token: token };
      for (const [k, v] of Object.entries(params)) if (v != null && v !== "") p[k] = String(v);
      const qs = new URLSearchParams(p);
      const r = method === "GET" || method === "DELETE" ? await fetch(`${G}/${path}?${qs}`, { method }) : await fetch(`${G}/${path}`, { method, body: qs });
      return { ok: r.ok, j: (await r.json().catch(() => ({}))) as any };
    };
    const fail = (j: any, what: string) => json(needsReconnect(j)
      ? { error: `Facebook didn't allow this (${gErr(j) || "missing permission"}). Reconnect Facebook in Settings and allow every permission it asks for.`, reconnect: true }
      : { error: `Couldn't ${what}: ${gErr(j) || "Facebook error"}` });

    // the Pages this login manages, each with its own Page token
    const pagesRaw = async () => {
      const r = await call("GET", "me/accounts", { fields: "id,name,category,picture{url},fan_count,followers_count,link,tasks,access_token,instagram_business_account{id,username,followers_count,profile_picture_url}", limit: "50" });
      return r.ok ? (r.j?.data || []) as any[] : null;
    };
    const pageToken = async (pageId: string) => {
      if (!ID.test(pageId)) return null;
      const L = await pagesRaw();
      return (L || []).find((p) => p.id === pageId)?.access_token || null;
    };

    if (action === "pages") {
      const L = await pagesRaw();
      if (!L) { const r = await call("GET", "me/accounts", { limit: "1" }); return fail(r.j, "load your Pages"); }
      return json({ ok: true, pages: L.map((p) => ({ id: p.id, name: p.name, category: p.category, picture: p.picture?.data?.url || null, fans: p.fan_count ?? null,
        followers: p.followers_count ?? null, link: p.link || null, can_post: (p.tasks || []).some((t: string) => ["CREATE_CONTENT", "MANAGE"].includes(t)),
        instagram: p.instagram_business_account ? { id: p.instagram_business_account.id, username: p.instagram_business_account.username,
          followers: p.instagram_business_account.followers_count ?? null, picture: p.instagram_business_account.profile_picture_url ?? null } : null })) });
    }

    // ---- ads (user token)
    if (action === "ad_accounts") {
      const r = await call("GET", "me/adaccounts", { fields: "id,name,account_status,currency,amount_spent,balance,business{name}", limit: "50" });
      if (!r.ok) return fail(r.j, "load your ad accounts");
      return json({ ok: true, accounts: (r.j?.data || []).map((a: any) => ({ id: a.id, name: a.name, status: a.account_status, currency: a.currency,
        spent: a.amount_spent != null ? Number(a.amount_spent) / 100 : null, business: a.business?.name || null })) });
    }
    if (action === "ad_campaigns") {
      const acc = String(body.account_id || "");
      if (!ACT.test(acc)) return json({ error: "Pick an ad account." }, 400);
      const preset = ({ 7: "last_7d", 14: "last_14d", 30: "last_30d", 90: "last_90d" } as any)[Number(body.days) || 30] || "last_30d";
      const r = await call("GET", `${acc}/campaigns`, { fields: `id,name,status,effective_status,objective,daily_budget,lifetime_budget,start_time,stop_time,insights.date_preset(${preset}){spend,impressions,reach,clicks,ctr,cpc,cpm,actions}`, limit: "50" });
      if (!r.ok) return fail(r.j, "load the campaigns");
      const tot = await call("GET", `${acc}/insights`, { fields: "spend,impressions,reach,clicks,ctr,cpc,cpm", date_preset: preset });
      return json({ ok: true, totals: tot.ok ? (tot.j?.data || [])[0] || {} : {}, campaigns: (r.j?.data || []).map((c: any) => {
        const i = c.insights?.data?.[0] || {};
        const results = (i.actions || []).filter((a: any) => /purchase|lead|link_click|landing_page_view|omni_purchase/.test(a.action_type))
          .map((a: any) => ({ type: a.action_type, value: Number(a.value) || 0 }));
        return { id: c.id, name: c.name, status: c.status, effective_status: c.effective_status, objective: c.objective,
          daily_budget: c.daily_budget ? Number(c.daily_budget) / 100 : null, lifetime_budget: c.lifetime_budget ? Number(c.lifetime_budget) / 100 : null,
          start: c.start_time || null, stop: c.stop_time || null, spend: i.spend != null ? Number(i.spend) : null, impressions: i.impressions != null ? Number(i.impressions) : null,
          reach: i.reach != null ? Number(i.reach) : null, clicks: i.clicks != null ? Number(i.clicks) : null, ctr: i.ctr != null ? Number(i.ctr) : null,
          cpc: i.cpc != null ? Number(i.cpc) : null, cpm: i.cpm != null ? Number(i.cpm) : null, results };
      }) });
    }
    if (action === "ad_status") {
      const cid = String(body.campaign_id || ""), st = String(body.status || "");
      if (!/^[0-9]{5,30}$/.test(cid) || !["ACTIVE", "PAUSED"].includes(st)) return json({ error: "bad request" }, 400);
      const r = await call("POST", cid, { status: st });
      if (!r.ok) return fail(r.j, st === "PAUSED" ? "pause the campaign" : "resume the campaign");
      return json({ ok: true, status: st });
    }

    // ---- everything below works on one Page, with that Page's own token
    const pageId = String(body.page_id || "");
    const PT = await pageToken(pageId);
    if (!PT) return json({ error: "Pick one of your Pages (reconnect Facebook if it isn't listed)." }, 400);
    const pc = (m: string, p: string, params: Record<string, string | undefined> = {}) => call(m, p, params, PT);
    const ownPost = (id: string) => ID.test(id) && id.startsWith(pageId + "_");

    if (action === "posts" || action === "scheduled") {
      const r = await pc("GET", `${pageId}/${action === "scheduled" ? "scheduled_posts" : "published_posts"}`, {
        fields: "id,message,created_time,scheduled_publish_time,full_picture,permalink_url,status_type,shares,reactions.summary(true).limit(0),comments.summary(true).limit(0)",
        limit: "15", after: body.after || undefined });
      if (!r.ok) return fail(r.j, "load the posts");
      const posts = [];
      for (const p of (r.j?.data || [])) {
        let reach: number | null = null, clicks: number | null = null;
        if (action === "posts") {
          const i = await pc("GET", `${p.id}/insights`, { metric: "post_impressions_unique,post_clicks" });
          if (i.ok) for (const x of (i.j?.data || [])) { const v = x.values?.[0]?.value; if (x.name === "post_impressions_unique") reach = v ?? null; if (x.name === "post_clicks") clicks = v ?? null; }
        }
        posts.push({ id: p.id, message: p.message || "", at: p.created_time || null, scheduled_at: p.scheduled_publish_time || null, image: p.full_picture || null,
          link: p.permalink_url || null, type: p.status_type || null, shares: p.shares?.count ?? 0, reactions: p.reactions?.summary?.total_count ?? 0,
          comments: p.comments?.summary?.total_count ?? 0, reach, clicks });
      }
      return json({ ok: true, posts, next: r.j?.paging?.cursors?.after && r.j?.paging?.next ? r.j.paging.cursors.after : null });
    }
    if (action === "publish") {
      const message = String(body.message || "").slice(0, 5000), link = String(body.link || ""), img = String(body.image_url || "");
      if (!message && !img && !link) return json({ error: "Write something, or add a link or a photo." }, 400);
      if (link && !/^https?:\/\//i.test(link)) return json({ error: "The link must start with https://" }, 400);
      if (img && !/^https:\/\//i.test(img)) return json({ error: "The photo must be an https:// image link." }, 400);
      const at = Number(body.schedule_at) || 0;
      if (at && (at < Date.now() / 1000 + 10 * 60 || at > Date.now() / 1000 + 75 * 86400)) return json({ error: "Schedule between 10 minutes and 75 days from now." }, 400);
      const sched = at ? { published: "false", scheduled_publish_time: String(Math.floor(at)) } : {};
      const r = img ? await pc("POST", `${pageId}/photos`, { url: img, caption: message || undefined, ...sched })
                    : await pc("POST", `${pageId}/feed`, { message: message || undefined, link: link || undefined, ...sched });
      if (!r.ok) return fail(r.j, "publish");
      return json({ ok: true, id: r.j?.post_id || r.j?.id, scheduled: !!at });
    }
    if (action === "delete_post") {
      const id = String(body.post_id || ""); if (!ownPost(id)) return json({ error: "That post isn't on this Page." }, 400);
      const r = await pc("DELETE", id); if (!r.ok) return fail(r.j, "delete the post");
      return json({ ok: true });
    }
    if (action === "comments") {
      const id = String(body.post_id || ""); if (!ownPost(id)) return json({ error: "That post isn't on this Page." }, 400);
      const r = await pc("GET", `${id}/comments`, { fields: "id,from{name,id},message,created_time,like_count,is_hidden,can_hide,comment_count,attachment{url,media},comments.limit(20){id,from{name,id},message,created_time,is_hidden,like_count}", limit: "50", filter: "toplevel", order: "reverse_chronological" });
      if (!r.ok) return fail(r.j, "load the comments");
      const map = (c: any) => ({ id: c.id, from: c.from?.name || "Facebook user", from_page: c.from?.id === pageId, message: c.message || "", at: c.created_time, likes: c.like_count ?? 0, hidden: !!c.is_hidden });
      return json({ ok: true, comments: (r.j?.data || []).map((c: any) => ({ ...map(c), replies: (c.comments?.data || []).map(map) })) });
    }
    // the comment must sit on one of this Page's posts
    const commentOk = async (cid: string) => {
      if (!ID.test(cid)) return false;
      const r = await pc("GET", cid, { fields: "id,object{id},parent{id}" });
      if (!r.ok) return false;
      const obj = String(r.j?.object?.id || "");
      return obj ? obj.startsWith(pageId + "_") || obj === pageId : cid.startsWith(pageId + "_");
    };
    if (action === "reply") {
      const cid = String(body.comment_id || ""), msg = String(body.message || "").trim().slice(0, 2000);
      if (!msg) return json({ error: "Write a reply." }, 400);
      if (!(await commentOk(cid))) return json({ error: "That comment isn't on your Page." }, 403);
      const r = await pc("POST", `${cid}/comments`, { message: msg }); if (!r.ok) return fail(r.j, "reply");
      return json({ ok: true, id: r.j?.id });
    }
    if (action === "hide") {
      const cid = String(body.comment_id || ""); if (!(await commentOk(cid))) return json({ error: "That comment isn't on your Page." }, 403);
      const r = await pc("POST", cid, { is_hidden: body.hide ? "true" : "false" }); if (!r.ok) return fail(r.j, body.hide ? "hide the comment" : "show the comment");
      return json({ ok: true, hidden: !!body.hide });
    }
    if (action === "delete_comment") {
      const cid = String(body.comment_id || ""); if (!(await commentOk(cid))) return json({ error: "That comment isn't on your Page." }, 403);
      const r = await pc("DELETE", cid); if (!r.ok) return fail(r.j, "delete the comment");
      return json({ ok: true });
    }
    if (action === "insights") {
      const days = [7, 14, 28].includes(Number(body.days)) ? Number(body.days) : 28;
      const until = Math.floor(Date.now() / 1000), since = until - days * 86400;
      const out: Record<string, { total: number; series: { d: string; v: number }[] }> = {};
      // asked one by one: Facebook retires Page metrics from time to time, and a retired one must not blank the others
      for (const m of ["page_impressions_unique", "page_impressions", "page_post_engagements", "page_views_total", "page_daily_follows_unique", "page_follows", "page_fan_adds_unique", "page_video_views"]) {
        const r = await pc("GET", `${pageId}/insights`, { metric: m, period: "day", since: String(since), until: String(until) });
        if (!r.ok) continue;
        const vals = ((r.j?.data || [])[0]?.values || []).map((v: any) => ({ d: String(v.end_time || "").slice(0, 10), v: typeof v.value === "number" ? v.value : 0 }));
        if (vals.length) out[m] = { total: m === "page_follows" ? (vals[vals.length - 1]?.v || 0) : vals.reduce((a: number, x: any) => a + x.v, 0), series: vals };
      }
      return json({ ok: true, days, metrics: out });
    }
    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error("brand-facebook", (e as Error).message);
    return json({ error: "Something went wrong — please try again." }, 500);
  }
});
