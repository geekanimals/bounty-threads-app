// Phase 1B — pure, testable ingestion logic (no network, no DB). The Edge worker wires a real Meta
// client + the service-role RPCs to these functions; tests drive them with fixtures. Core guarantees:
// per-metric INDEPENDENCE (one bad metric never fails others), unavailable => reasoned status + NULL
// (never 0), and audience follower/engaged kept distinct with Meta's exact buckets preserved.
import { DEMOGRAPHICS, ACCOUNT_INSIGHTS, SCOPE_CAPABILITY, UNSUPPORTED_AUDIENCE } from "./meta_capabilities.ts";

export type Avail =
  | "available" | "insufficient_audience" | "threshold_not_met" | "suppressed"
  | "permission_missing" | "unsupported_account" | "unsupported_metric" | "provider_error";

export interface AudienceRow {
  metric_name: string; audience_type: "follower" | "engaged"; breakdown_type: string;
  dimension_key: string | null; value_count: number | null; status: Avail; suppression_reason?: string | null;
  period?: string; timeframe?: string;
}

// Map a thrown/HTTP error to a truthful availability status (never invent zero).
export function classifyMetric(err: unknown): Avail {
  const m = String((err as Error)?.message ?? err ?? "").toLowerCase();
  if (m.includes("permission") || m.includes("oauth")) return "permission_missing";
  if (m.includes("100") || m.includes("threshold") || m.includes("not enough")) return "threshold_not_met";
  if (m.includes("does not support") || m.includes("unsupported") || m.includes("invalid metric")) return "unsupported_metric";
  if (m.includes("suppress")) return "suppressed";
  return "provider_error";
}

// Which capabilities are usable given the actually-granted scopes (grant truth, not requested list).
export function enabledCapabilities(grantedScopes: readonly string[]): string[] {
  const caps: string[] = [];
  for (const s of grantedScopes) { const c = SCOPE_CAPABILITY[s]; if (c) caps.push(c); }
  return caps;
}

// Never request a deprecated/unsupported metric.
export function requestableAudienceMetrics(): string[] {
  return DEMOGRAPHICS.filter((m) => m.doc === "documented_supported" && !UNSUPPORTED_AUDIENCE.includes(m.metric)).map((m) => m.metric);
}
export function requestableAccountMetrics(): string[] {
  return ACCOUNT_INSIGHTS.filter((m) => m.doc !== "documented_deprecated").map((m) => m.metric);
}

// Parse Meta's demographic response for ONE metric+breakdown into append-ready rows. Preserves Meta's
// exact buckets. If Meta returns nothing / below threshold, emits a single reasoned unavailable row.
export function parseAudienceBuckets(
  metric: string, audienceType: "follower" | "engaged", breakdown: string,
  metaTotalValue: { value?: Record<string, number> } | null,
  period = "lifetime", timeframe = "this_month",
): AudienceRow[] {
  const values = metaTotalValue?.value;
  if (!values || Object.keys(values).length === 0) {
    return [{ metric_name: metric, audience_type: audienceType, breakdown_type: breakdown, dimension_key: null,
      value_count: null, status: "insufficient_audience", suppression_reason: "no_buckets_returned", period, timeframe }];
  }
  return Object.entries(values).map(([key, count]) => ({
    metric_name: metric, audience_type: audienceType, breakdown_type: breakdown,
    dimension_key: key, value_count: (typeof count === "number" ? count : null),
    status: "available", period, timeframe,
  }));
}

// Client boundary the Edge worker implements with a real (versioned) Meta client; tests mock it.
export interface IngestClient {
  fetchAudience(metric: string, breakdown: string): Promise<{ value?: Record<string, number> }>;
}

// Run the audience stage: each metric+breakdown is attempted INDEPENDENTLY; a failure of one produces
// a reasoned unavailable row for that metric only and never aborts the others.
export async function runAudienceStage(
  client: IngestClient, audienceTypes: Array<{ metric: string; audience_type: "follower" | "engaged" }>,
  breakdowns = ["age", "gender", "city", "country"],
): Promise<{ rows: AudienceRow[]; requested: number; received: number }> {
  const rows: AudienceRow[] = [];
  let requested = 0, received = 0;
  for (const { metric, audience_type } of audienceTypes) {
    if (UNSUPPORTED_AUDIENCE.includes(metric)) continue; // never request unsupported
    for (const breakdown of breakdowns) {
      requested++;
      try {
        const resp = await client.fetchAudience(metric, breakdown);
        const parsed = parseAudienceBuckets(metric, audience_type, breakdown, resp);
        if (parsed.some((r) => r.status === "available")) received++;
        rows.push(...parsed);
      } catch (e) {
        rows.push({ metric_name: metric, audience_type, breakdown_type: breakdown, dimension_key: null,
          value_count: null, status: classifyMetric(e), suppression_reason: "metric_error" });
      }
    }
  }
  return { rows, requested, received };
}
