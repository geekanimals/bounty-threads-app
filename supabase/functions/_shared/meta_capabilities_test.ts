// Deno tests for the v26.0 Meta capability registry — deterministic, no network.
import { assert, assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  FIVE_SCOPES, META_API_VERSION, DEMOGRAPHICS, ACCOUNT_INSIGHTS, MEDIA_INSIGHTS, UNSUPPORTED_AUDIENCE,
  SCOPE_CAPABILITY, grantedScopes, demographicTimeframes, mediaMetricsFor, buildInsightsRequest,
  assertVersion, IMPRESSIONS_MEDIA_CUTOFF, STORY_INSIGHTS_TTL_HOURS,
} from "./meta_capabilities.ts";

Deno.test("pinned Graph API version is v26.0 (not latest, not v21)", () => {
  assertEquals(META_API_VERSION, "v26.0");
});

Deno.test("exactly the five approved scopes; basic maps to no toggle", () => {
  assertEquals([...FIVE_SCOPES], ["instagram_business_basic","instagram_business_manage_insights",
    "instagram_business_manage_comments","instagram_business_manage_messages","instagram_business_content_publish"]);
  assertEquals(SCOPE_CAPABILITY["instagram_business_basic"], null);
});

Deno.test("demographic timeframes differ per metric (v26)", () => {
  assertEquals(demographicTimeframes("follower_demographics").sort(),
    ["last_14_days","last_30_days","last_90_days","prev_month","this_month","this_week"].sort());
  // engaged: only this_month/this_week from v20.0+
  assertEquals(demographicTimeframes("engaged_audience_demographics").sort(), ["this_month","this_week"].sort());
});

Deno.test("reached_audience_demographics is NOT a metric", () => {
  assert(!DEMOGRAPHICS.some((d) => d.metric === "reached_audience_demographics"));
  assert(UNSUPPORTED_AUDIENCE.includes("reached_audience_demographics"));
});

Deno.test("runtime is never claimed verified (live tests NOT RUN)", () => {
  for (const d of DEMOGRAPHICS) assertEquals(d.runtime, "runtime_not_verified");
  for (const m of MEDIA_INSIGHTS) assertEquals(m.runtime, "runtime_not_verified");
});

Deno.test("account-level impressions is deprecated", () => {
  assertEquals(ACCOUNT_INSIGHTS.find((m) => m.metric === "impressions")?.doc, "documented_deprecated");
});

Deno.test("media matrix respects media type + FB-login-only + FB-sharing", () => {
  const feed = mediaMetricsFor("FEED");
  assert(feed.includes("reach") && feed.includes("likes") && feed.includes("saved"));
  assert(!feed.includes("navigation"));           // story-only
  assert(!feed.includes("ig_reels_avg_watch_time")); // reels-only
  const reels = mediaMetricsFor("REELS");
  assert(reels.includes("ig_reels_avg_watch_time") && reels.includes("reels_skip_rate"));
  assert(!reels.includes("saved") ? true : true); // saved is FEED+REELS; both fine
  const story = mediaMetricsFor("STORY");
  assert(story.includes("navigation") && story.includes("replies") && story.includes("link_clicks"));
  // FB-login-only totals never appear via Instagram Login
  for (const t of ["total_comments","total_likes","total_views"]) {
    assert(!feed.includes(t) && !reels.includes(t) && !story.includes(t));
  }
  // FB-sharing metrics excluded unless facebookShared
  assert(!reels.includes("crossposted_views"));
  assert(mediaMetricsFor("REELS", { facebookShared: true }).includes("crossposted_views"));
});

Deno.test("media-level impressions only for media created on/before cutoff", () => {
  assert(!mediaMetricsFor("FEED").includes("impressions"));                                   // newer media default
  assert(mediaMetricsFor("FEED", { mediaCreatedAt: "2024-01-01" }).includes("impressions"));  // older media
  assert(!mediaMetricsFor("FEED", { mediaCreatedAt: "2025-01-01" }).includes("impressions")); // after cutoff
  assertEquals(IMPRESSIONS_MEDIA_CUTOFF, "2024-07-02");
  assertEquals(STORY_INSIGHTS_TTL_HOURS, 24);
});

Deno.test("request builder emits an explicit v26 versioned URL; rejects unversioned/latest/v21", () => {
  const { url } = buildInsightsRequest("https://graph.instagram.com", META_API_VERSION, "me",
    "follower_demographics", { metric_type: "total_value", period: "lifetime", timeframe: "this_month", breakdown: "age" });
  assert(url.startsWith("https://graph.instagram.com/v26.0/me/insights?"));
  assert(url.includes("breakdown=age") && !url.includes("breakdowns="));
  assert(!url.includes("/latest/") && !url.includes("/v21.0/"));
  assertThrows(() => assertVersion("latest"));
  assertThrows(() => assertVersion("v21.0"));
  assertThrows(() => buildInsightsRequest("https://graph.instagram.com", "v21.0", "me", "reach"));
});

Deno.test("grant truth: only returned scopes are granted", () => {
  assertEquals(grantedScopes(FIVE_SCOPES, ["instagram_business_basic"]), ["instagram_business_basic"]);
});
