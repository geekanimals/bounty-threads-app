// Phase 1B-fix — code-backed Meta (Instagram) capability registry, Graph API v26.0. DARK.
// Pins ONE version; every request is generated from this matrix with an explicit version segment
// (never unversioned / "latest" / v21). Support is represented SEPARATELY by metric × version ×
// timeframe × breakdown × account-type, with documentation- and runtime-verification labels kept
// distinct. Because live Meta tests were NOT RUN, runtime is `runtime_not_verified` everywhere.
//
// Verification (2026-09-21, developers.facebook.com Instagram Platform docs):
//  - Account insights + follower_demographics / engaged_audience_demographics params.
//  - Media insights media-type matrix (FEED/REELS/STORY), FB-login-only + FB-sharing metrics,
//    media-level impressions rule (deprecated for media created after 2024-07-02; older media only),
//    story insights 24h-only.
//  - reached_audience_demographics is NOT a metric. impressions is deprecated at the account level.

export const META_API_VERSION = "v26.0";           // pinned; provider config migrates to v26.0
export const META_API_UNAVAILABLE_AFTER = { "v21.0": "2027-01-21" };
export const CAP_REGISTRY_VERIFIED_AT = "2026-09-21";

export type DocVerify = "documented_supported" | "documented_deprecated" | "documented_unsupported";
export type RuntimeVerify = "runtime_not_verified" | "runtime_verified";
export type MediaType = "FEED" | "REELS" | "STORY" | "CAROUSEL_ALBUM";

export const FIVE_SCOPES = [
  "instagram_business_basic", "instagram_business_manage_insights", "instagram_business_manage_comments",
  "instagram_business_manage_messages", "instagram_business_content_publish",
] as const;

export const SCOPE_CAPABILITY: Record<string, string | null> = {
  instagram_business_basic: null,
  instagram_business_manage_insights: "performance_insights",
  instagram_business_manage_comments: "comment_intelligence",
  instagram_business_manage_messages: "campaign_messaging_intelligence",
  instagram_business_content_publish: "publishing_scheduling",
};

export const ACCOUNT_FIELDS = "user_id,username,account_type,name,biography,profile_picture_url,website,followers_count,follows_count,media_count";
export const MEDIA_FIELDS = "id,media_type,media_product_type,caption,permalink,timestamp,thumbnail_url,username,owner,children";

// ---------- AUDIENCE DEMOGRAPHICS: per-metric, per-version timeframe support ----------
export interface DemographicSpec {
  metric: string; scope: string; period: "lifetime"; metric_type: "total_value";
  breakdowns: readonly ("age" | "gender" | "city" | "country")[];
  timeframesByVersion: Record<string, readonly string[]>;   // exact supported timeframes per version
  threshold: string; doc: DocVerify; runtime: RuntimeVerify;
}
export const DEMOGRAPHICS: DemographicSpec[] = [
  {
    metric: "follower_demographics", scope: "instagram_business_manage_insights",
    period: "lifetime", metric_type: "total_value", breakdowns: ["age", "city", "country", "gender"],
    timeframesByVersion: { "v26.0": ["last_14_days", "last_30_days", "last_90_days", "prev_month", "this_month", "this_week"] },
    threshold: ">=100 followers", doc: "documented_supported", runtime: "runtime_not_verified",
  },
  {
    metric: "engaged_audience_demographics", scope: "instagram_business_manage_insights",
    period: "lifetime", metric_type: "total_value", breakdowns: ["age", "city", "country", "gender"],
    // last_14/30/90_days and prev_month are UNSUPPORTED from v20.0 → v26 uses this_month/this_week only.
    timeframesByVersion: { "v26.0": ["this_month", "this_week"] },
    threshold: ">=100 engagements/timeframe", doc: "documented_supported", runtime: "runtime_not_verified",
  },
];
export const UNSUPPORTED_AUDIENCE = ["reached_audience_demographics"];   // never request

export function demographicTimeframes(metric: string, version = META_API_VERSION): string[] {
  const d = DEMOGRAPHICS.find((x) => x.metric === metric);
  return d ? [...(d.timeframesByVersion[version] ?? [])] : [];
}

// ---------- ACCOUNT INSIGHTS ----------
export const ACCOUNT_INSIGHTS: Array<{ metric: string; scope: string; metric_type: string; breakdowns?: string[]; doc: DocVerify; runtime: RuntimeVerify }> = [
  { metric: "reach", scope: "instagram_business_manage_insights", metric_type: "total_value", breakdowns: ["media_product_type", "follow_type"], doc: "documented_supported", runtime: "runtime_not_verified" },
  { metric: "accounts_engaged", scope: "instagram_business_manage_insights", metric_type: "total_value", doc: "documented_supported", runtime: "runtime_not_verified" },
  { metric: "total_interactions", scope: "instagram_business_manage_insights", metric_type: "total_value", breakdowns: ["media_product_type"], doc: "documented_supported", runtime: "runtime_not_verified" },
  { metric: "likes", scope: "instagram_business_manage_insights", metric_type: "total_value", breakdowns: ["media_product_type"], doc: "documented_supported", runtime: "runtime_not_verified" },
  { metric: "comments", scope: "instagram_business_manage_insights", metric_type: "total_value", breakdowns: ["media_product_type"], doc: "documented_supported", runtime: "runtime_not_verified" },
  { metric: "saves", scope: "instagram_business_manage_insights", metric_type: "total_value", breakdowns: ["media_product_type"], doc: "documented_supported", runtime: "runtime_not_verified" },
  { metric: "shares", scope: "instagram_business_manage_insights", metric_type: "total_value", breakdowns: ["media_product_type"], doc: "documented_supported", runtime: "runtime_not_verified" },
  { metric: "replies", scope: "instagram_business_manage_insights", metric_type: "total_value", doc: "documented_supported", runtime: "runtime_not_verified" },
  { metric: "views", scope: "instagram_business_manage_insights", metric_type: "total_value", breakdowns: ["follower_type", "media_product_type"], doc: "documented_supported", runtime: "runtime_not_verified" },
  { metric: "profile_links_taps", scope: "instagram_business_manage_insights", metric_type: "total_value", breakdowns: ["contact_button_type"], doc: "documented_supported", runtime: "runtime_not_verified" },
  { metric: "impressions", scope: "instagram_business_manage_insights", metric_type: "total_value", doc: "documented_deprecated", runtime: "runtime_not_verified" }, // account-level: deprecated 2025-04-21
];

// ---------- MEDIA INSIGHTS: metric × media-type matrix (doc-backed 2026-09-21) ----------
export interface MediaMetricSpec {
  metric: string; media: MediaType[]; scope: string;
  breakdown?: string; requiresFacebookSharing?: boolean; facebookLoginOnly?: boolean;
  storyOnly?: boolean; note?: string; doc: DocVerify; runtime: RuntimeVerify;
}
const S = "instagram_business_manage_insights";
export const MEDIA_INSIGHTS: MediaMetricSpec[] = [
  { metric: "comments", media: ["FEED", "REELS"], scope: S, doc: "documented_supported", runtime: "runtime_not_verified" },
  { metric: "likes", media: ["FEED", "REELS"], scope: S, doc: "documented_supported", runtime: "runtime_not_verified" },
  { metric: "reach", media: ["FEED", "REELS", "STORY"], scope: S, doc: "documented_supported", runtime: "runtime_not_verified", note: "estimated" },
  { metric: "shares", media: ["FEED", "REELS", "STORY"], scope: S, doc: "documented_supported", runtime: "runtime_not_verified" },
  { metric: "saved", media: ["FEED", "REELS"], scope: S, doc: "documented_supported", runtime: "runtime_not_verified" },
  { metric: "views", media: ["FEED", "REELS", "STORY"], scope: S, doc: "documented_supported", runtime: "runtime_not_verified", note: "in development" },
  { metric: "total_interactions", media: ["FEED", "REELS", "STORY"], scope: S, doc: "documented_supported", runtime: "runtime_not_verified" },
  { metric: "profile_activity", media: ["FEED", "STORY"], scope: S, breakdown: "action_type", doc: "documented_supported", runtime: "runtime_not_verified" },
  { metric: "navigation", media: ["STORY"], scope: S, breakdown: "story_navigation_action_type", storyOnly: true, doc: "documented_supported", runtime: "runtime_not_verified" },
  { metric: "replies", media: ["STORY"], scope: S, storyOnly: true, note: "returns 0 for EU/Japan users (privacy)", doc: "documented_supported", runtime: "runtime_not_verified" },
  { metric: "ig_reels_avg_watch_time", media: ["REELS"], scope: S, doc: "documented_supported", runtime: "runtime_not_verified" },
  { metric: "ig_reels_video_view_total_time", media: ["REELS"], scope: S, note: "in development", doc: "documented_supported", runtime: "runtime_not_verified" },
  { metric: "reels_skip_rate", media: ["REELS"], scope: S, note: "estimated, in development", doc: "documented_supported", runtime: "runtime_not_verified" },
  { metric: "crossposted_views", media: ["REELS"], scope: S, requiresFacebookSharing: true, doc: "documented_supported", runtime: "runtime_not_verified" },
  { metric: "facebook_views", media: ["FEED", "REELS", "STORY"], scope: S, requiresFacebookSharing: true, doc: "documented_supported", runtime: "runtime_not_verified" },
  { metric: "profile_visits", media: ["FEED", "STORY"], scope: S, doc: "documented_supported", runtime: "runtime_not_verified" },
  { metric: "follows", media: ["FEED", "STORY"], scope: S, doc: "documented_supported", runtime: "runtime_not_verified" },
  { metric: "reposts", media: ["FEED", "REELS", "STORY"], scope: S, doc: "documented_supported", runtime: "runtime_not_verified" },
  { metric: "link_clicks", media: ["STORY"], scope: S, storyOnly: true, doc: "documented_supported", runtime: "runtime_not_verified" },
  // Facebook-Login-ONLY aggregated totals — must NEVER be requested via Instagram Login:
  { metric: "total_comments", media: ["FEED", "REELS", "STORY"], scope: S, facebookLoginOnly: true, doc: "documented_unsupported", runtime: "runtime_not_verified" },
  { metric: "total_likes", media: ["FEED", "REELS", "STORY"], scope: S, facebookLoginOnly: true, doc: "documented_unsupported", runtime: "runtime_not_verified" },
  { metric: "total_views", media: ["FEED", "REELS", "STORY"], scope: S, facebookLoginOnly: true, doc: "documented_unsupported", runtime: "runtime_not_verified" },
  // media-level impressions: available ONLY for media created on/before 2024-07-02 (rule differs from account level)
  { metric: "impressions", media: ["FEED", "REELS"], scope: S, doc: "documented_supported", runtime: "runtime_not_verified", note: "media created on/before 2024-07-02 only; deprecated for newer media" },
];
export const IMPRESSIONS_MEDIA_CUTOFF = "2024-07-02"; // media created after this cannot return media-level impressions
export const STORY_INSIGHTS_TTL_HOURS = 24;

// Select media-insight metrics for a given media type via IG Login (excludes FB-login-only + FB-sharing
// by default; impressions only for older media). Never groups unsupported metric/media combos together.
export function mediaMetricsFor(mediaType: MediaType, opts?: { mediaCreatedAt?: string; facebookShared?: boolean }): string[] {
  const created = opts?.mediaCreatedAt ? new Date(opts.mediaCreatedAt) : null;
  return MEDIA_INSIGHTS.filter((m) => {
    if (m.facebookLoginOnly) return false;                 // never via Instagram Login
    if (m.requiresFacebookSharing && !opts?.facebookShared) return false;
    if (!m.media.includes(mediaType)) return false;
    if (m.metric === "impressions") return !!(created && created <= new Date(IMPRESSIONS_MEDIA_CUTOFF));
    return m.doc === "documented_supported";
  }).map((m) => m.metric);
}

// ---------- ONE versioned request builder (guards against unversioned/latest/v21) ----------
export function assertVersion(v: string): void {
  if (!v || v === "latest" || !/^v\d+\.\d+$/.test(v)) throw new Error("meta_version_invalid: " + v);
  if (v === "v21.0") throw new Error("meta_version_retired_use_v26: v21.0");
}
export interface InsightsRequest {
  version: string; node: string; metric: string; params: Record<string, string>;
  // NOTE: demographics currently accept the `breakdown` param (singular). The docs also show
  // `breakdowns` examples; this builder emits `breakdown` and marks it for the live capability probe.
  breakdownParamName: "breakdown";
}
export function buildInsightsRequest(graphBase: string, version: string, node: string, metric: string,
  opts: { metric_type?: string; period?: string; timeframe?: string; breakdown?: string } = {}): { url: string; req: InsightsRequest } {
  assertVersion(version);
  const p: Record<string, string> = { metric };
  if (opts.metric_type) p.metric_type = opts.metric_type;
  if (opts.period) p.period = opts.period;
  if (opts.timeframe) p.timeframe = opts.timeframe;
  if (opts.breakdown) p.breakdown = opts.breakdown;         // singular param name (probe-flagged)
  const qs = new URLSearchParams(p).toString();
  const url = `${graphBase.replace(/\/+$/, "")}/${version}/${node}/insights?${qs}`;
  return { url, req: { version, node, metric, params: p, breakdownParamName: "breakdown" } };
}

export function grantedScopes(requested: readonly string[], returned: readonly string[]): string[] {
  const set = new Set(returned);
  return requested.filter((s) => set.has(s));
}
