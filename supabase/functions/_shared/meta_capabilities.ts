// Phase 1B — Code-backed Meta (Instagram) capability registry. DARK.
// Pins ONE Graph API version; never calls an unversioned/"latest" endpoint. Each entry records the
// controlling scope, endpoint family, exact metric/field identifiers, params, account-type/threshold
// eligibility, availability states, and a documentation-verification marker. Metrics are probed
// INDEPENDENTLY at runtime: one unsupported/failed metric must never fail the whole ingestion run.
//
// Verification (2026-09-21):
//  - VERIFIED_FROM_DOCS: account-insight metric names + follower_demographics /
//    engaged_audience_demographics (period=lifetime, timeframe, breakdown=age|city|country|gender,
//    metric_type=total_value; >=100 follower/engagement threshold), and impressions DEPRECATED
//    (2025-04-21) — fetched from developers.facebook.com/docs/instagram-platform account insights.
//  - NOTE: `reached_audience_demographics` is NOT a current standalone metric. Only
//    follower_demographics and engaged_audience_demographics exist; `reach` is an interaction metric
//    with media_product_type/follow_type breakdowns (NOT a demographic breakdown).
//  - DOCUMENTED_NOT_VERIFIED: media-object fields and per-media insight names (the media-insights
//    reference page 404'd on fetch) — carried as configurable + runtime-probed, never assumed true.

export const META_API_VERSION = "v21.0"; // pinned; mirrors intel.ci_provider_config.api_version
export const CAP_REGISTRY_VERIFIED_AT = "2026-09-21";

export type Verify = "verified_from_docs" | "documented_not_verified" | "deprecated";
export type Availability =
  | "available" | "insufficient_audience" | "threshold_not_met" | "permission_missing"
  | "unsupported_account" | "unsupported_metric" | "suppressed" | "provider_error" | "unknown";

export interface MetricSpec {
  metric: string;                 // exact Graph API identifier
  scope: string;                  // controlling permission
  endpoint: string;               // endpoint family
  metric_type?: string;
  period?: string;
  timeframes?: string[];
  breakdowns?: string[];
  account_types?: string[];       // required professional account type(s)
  threshold?: string | null;      // documented eligibility threshold
  verify: Verify;
}

export const FIVE_SCOPES = [
  "instagram_business_basic",
  "instagram_business_manage_insights",
  "instagram_business_manage_comments",
  "instagram_business_manage_messages",
  "instagram_business_content_publish",
] as const;

// scope -> internal capability (must mirror intel.ci_scope_capability_map). basic maps to no toggle.
export const SCOPE_CAPABILITY: Record<string, string | null> = {
  instagram_business_basic: null,
  instagram_business_manage_insights: "performance_insights",
  instagram_business_manage_comments: "comment_intelligence",
  instagram_business_manage_messages: "campaign_messaging_intelligence",
  instagram_business_content_publish: "publishing_scheduling",
};

// Account/profile fields (basic).
export const ACCOUNT_FIELDS: MetricSpec = {
  metric: "user_id,username,account_type,name,biography,profile_picture_url,website,followers_count,follows_count,media_count",
  scope: "instagram_business_basic", endpoint: "/{ig-user-id}", verify: "verified_from_docs",
  account_types: ["BUSINESS", "MEDIA_CREATOR"], threshold: null,
};

// Media object fields (documented-not-verified: media-insights page 404'd on fetch → runtime-probe).
export const MEDIA_FIELDS: MetricSpec = {
  metric: "id,media_type,media_product_type,caption,permalink,timestamp,thumbnail_url,username,owner",
  scope: "instagram_business_basic", endpoint: "/{ig-user-id}/media", verify: "documented_not_verified",
  account_types: ["BUSINESS", "MEDIA_CREATOR"], threshold: null,
};

// Account-level insight metrics (VERIFIED_FROM_DOCS 2026-09-21).
export const ACCOUNT_INSIGHTS: MetricSpec[] = [
  { metric: "reach", scope: "instagram_business_manage_insights", endpoint: "/{ig-user-id}/insights", metric_type: "total_value", breakdowns: ["media_product_type", "follow_type"], verify: "verified_from_docs" },
  { metric: "accounts_engaged", scope: "instagram_business_manage_insights", endpoint: "/{ig-user-id}/insights", metric_type: "total_value", verify: "verified_from_docs" },
  { metric: "total_interactions", scope: "instagram_business_manage_insights", endpoint: "/{ig-user-id}/insights", metric_type: "total_value", breakdowns: ["media_product_type"], verify: "verified_from_docs" },
  { metric: "likes", scope: "instagram_business_manage_insights", endpoint: "/{ig-user-id}/insights", metric_type: "total_value", breakdowns: ["media_product_type"], verify: "verified_from_docs" },
  { metric: "comments", scope: "instagram_business_manage_insights", endpoint: "/{ig-user-id}/insights", metric_type: "total_value", breakdowns: ["media_product_type"], verify: "verified_from_docs" },
  { metric: "saves", scope: "instagram_business_manage_insights", endpoint: "/{ig-user-id}/insights", metric_type: "total_value", breakdowns: ["media_product_type"], verify: "verified_from_docs" },
  { metric: "shares", scope: "instagram_business_manage_insights", endpoint: "/{ig-user-id}/insights", metric_type: "total_value", breakdowns: ["media_product_type"], verify: "verified_from_docs" },
  { metric: "replies", scope: "instagram_business_manage_insights", endpoint: "/{ig-user-id}/insights", metric_type: "total_value", verify: "verified_from_docs" },
  { metric: "views", scope: "instagram_business_manage_insights", endpoint: "/{ig-user-id}/insights", metric_type: "total_value", breakdowns: ["follower_type", "media_product_type"], verify: "verified_from_docs" },
  { metric: "profile_links_taps", scope: "instagram_business_manage_insights", endpoint: "/{ig-user-id}/insights", metric_type: "total_value", breakdowns: ["contact_button_type"], verify: "verified_from_docs" },
  // DEPRECATED — never request:
  { metric: "impressions", scope: "instagram_business_manage_insights", endpoint: "/{ig-user-id}/insights", verify: "deprecated" },
];

// Audience demographics (VERIFIED_FROM_DOCS 2026-09-21). ONLY these two exist.
export const AUDIENCE_METRICS: MetricSpec[] = [
  { metric: "follower_demographics", scope: "instagram_business_manage_insights", endpoint: "/{ig-user-id}/insights",
    metric_type: "total_value", period: "lifetime", timeframes: ["this_month", "this_week", "prev_month"],
    breakdowns: ["age", "city", "country", "gender"], threshold: ">=100 followers", verify: "verified_from_docs" },
  { metric: "engaged_audience_demographics", scope: "instagram_business_manage_insights", endpoint: "/{ig-user-id}/insights",
    metric_type: "total_value", period: "lifetime", timeframes: ["this_month", "this_week", "prev_month"],
    breakdowns: ["age", "city", "country", "gender"], threshold: ">=100 engagements/timeframe", verify: "verified_from_docs" },
];
// Explicitly-unsupported candidate (must NOT be requested):
export const UNSUPPORTED_AUDIENCE = ["reached_audience_demographics"];

// Per-media insight metrics (documented-not-verified → runtime-probe, classify unsupported truthfully).
export const MEDIA_INSIGHTS: MetricSpec[] = [
  { metric: "reach", scope: "instagram_business_manage_insights", endpoint: "/{ig-media-id}/insights", verify: "documented_not_verified" },
  { metric: "likes", scope: "instagram_business_manage_insights", endpoint: "/{ig-media-id}/insights", verify: "documented_not_verified" },
  { metric: "comments", scope: "instagram_business_manage_insights", endpoint: "/{ig-media-id}/insights", verify: "documented_not_verified" },
  { metric: "saved", scope: "instagram_business_manage_insights", endpoint: "/{ig-media-id}/insights", verify: "documented_not_verified" },
  { metric: "shares", scope: "instagram_business_manage_insights", endpoint: "/{ig-media-id}/insights", verify: "documented_not_verified" },
  { metric: "views", scope: "instagram_business_manage_insights", endpoint: "/{ig-media-id}/insights", verify: "documented_not_verified" },
  { metric: "total_interactions", scope: "instagram_business_manage_insights", endpoint: "/{ig-media-id}/insights", verify: "documented_not_verified" },
  { metric: "replies", scope: "instagram_business_manage_insights", endpoint: "/{ig-media-id}/insights", verify: "documented_not_verified" }, // stories
];

export const COMMENTS_MENTIONS: MetricSpec[] = [
  { metric: "comments", scope: "instagram_business_manage_comments", endpoint: "/{ig-media-id}/comments", verify: "documented_not_verified" },
  { metric: "mentions", scope: "instagram_business_manage_comments", endpoint: "/{ig-user-id}/mentions", verify: "documented_not_verified" },
];

export const MESSAGING: MetricSpec[] = [
  { metric: "conversations", scope: "instagram_business_manage_messages", endpoint: "/{ig-user-id}/conversations", verify: "documented_not_verified" },
];

// Publishing is operational only — verify capability, never call, never affect scoring.
export const PUBLISHING: MetricSpec = {
  metric: "media_publish", scope: "instagram_business_content_publish", endpoint: "/{ig-user-id}/media_publish",
  verify: "documented_not_verified", threshold: "operational-only; no scoring effect",
};

// Only scopes actually returned by Meta are granted (never the requested list).
export function grantedScopes(requested: readonly string[], returned: readonly string[]): string[] {
  const set = new Set(returned);
  return requested.filter((s) => set.has(s));
}

// Is a metric requestable given the granted scopes? (basic eligibility, pre-runtime.)
export function metricAllowed(m: MetricSpec, granted: readonly string[]): boolean {
  if (m.verify === "deprecated") return false;
  if (UNSUPPORTED_AUDIENCE.includes(m.metric)) return false;
  return granted.includes(m.scope);
}
