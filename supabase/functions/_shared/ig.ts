// Shared Instagram Graph fetch helper — profile, media, avg reach, audience, mentions.
// Insights/tags calls are best-effort: they need `instagram_business_manage_insights` and
// (for demographics) >=100 followers + App Review, so each is wrapped in try/catch and the
// media kit simply hides segments that have no data.

const GRAPH = "https://graph.instagram.com";

// One-line structured error log. Never includes the access token.
function logIgError(tag: string, ctx: Record<string, string>, r: any) {
  const e = r?.error;
  console.error(`${tag} ${JSON.stringify({ ...ctx, code: e?.code ?? null, message: e?.message ?? String(r) })}`);
}

export async function fetchProfileBundle(accessToken: string, igUserId: string) {
  const fields =
    "user_id,username,name,account_type,followers_count,follows_count,media_count,profile_picture_url,biography,website";
  const profile = await (await fetch(`${GRAPH}/me?fields=${fields}&access_token=${accessToken}`)).json();

  const mediaFields =
    "id,caption,media_type,media_url,permalink,thumbnail_url,timestamp,like_count,comments_count";
  const mediaRes = await (await fetch(`${GRAPH}/me/media?fields=${mediaFields}&limit=12&access_token=${accessToken}`)).json();
  const media = mediaRes.data || [];

  // --- avg reach per post (best-effort; sample recent media) ---
  let avgReach: number | null = null;
  try {
    const reaches: number[] = [];
    for (const m of media.slice(0, 8)) {
      try {
        const r = await (await fetch(`${GRAPH}/${m.id}/insights?metric=reach&access_token=${accessToken}`)).json();
        if (r?.error) logIgError("IG_REACH_ERROR", { media: String(m.id) }, r);
        const v = r?.data?.[0]?.values?.[0]?.value;
        if (typeof v === "number") reaches.push(v);
      } catch (e) { logIgError("IG_REACH_ERROR", { media: String(m.id) }, e instanceof Error ? { error: { message: e.message } } : e); }
    }
    if (reaches.length) avgReach = Math.round(reaches.reduce((a, b) => a + b, 0) / reaches.length);
  } catch (_e) { /* insights not available */ }

  // --- audience demographics (best-effort) ---
  let audience: Record<string, unknown> = {};
  try {
    const brk = async (breakdown: string) => {
      const r = await (await fetch(
        `${GRAPH}/${igUserId}/insights?metric=follower_demographics&period=lifetime&metric_type=total_value&timeframe=this_month&breakdown=${breakdown}&access_token=${accessToken}`,
      )).json();
      if (r?.error) { logIgError("IG_AUDIENCE_ERROR", { breakdown }, r); return {}; }
      const results = r?.data?.[0]?.total_value?.breakdowns?.[0]?.results || [];
      const out: Record<string, number> = {};
      for (const it of results) out[(it.dimension_values || []).join(" · ")] = it.value;
      return out;
    };
    const [country, city, gender_age] = await Promise.all([brk("country"), brk("city"), brk("gender,age")]);
    if (Object.keys(country).length || Object.keys(city).length || Object.keys(gender_age).length) {
      audience = { country, city, gender_age };
    }
  } catch (e) { logIgError("IG_AUDIENCE_ERROR", { breakdown: "all" }, { error: { message: String(e) } }); }

  // --- mentions / tagged media (best-effort) ---
  let mentions: unknown[] = [];
  try {
    const tagFields = "id,caption,media_type,media_url,permalink,thumbnail_url,username,timestamp";
    const t = await (await fetch(`${GRAPH}/${igUserId}/tags?fields=${tagFields}&limit=12&access_token=${accessToken}`)).json();
    if (t?.error) logIgError("IG_TAGS_ERROR", {}, t);
    mentions = t.data || [];
  } catch (e) { logIgError("IG_TAGS_ERROR", {}, { error: { message: String(e) } }); }

  return { profile, media, avgReach, audience, mentions };
}
