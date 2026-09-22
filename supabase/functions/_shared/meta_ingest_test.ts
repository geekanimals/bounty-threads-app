// Deno tests for the pure ingestion logic — deterministic, no network.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  parseAudienceBuckets, runAudienceStage, classifyMetric, enabledCapabilities,
  requestableAudienceMetrics, type IngestClient,
} from "./meta_ingest.ts";

Deno.test("parseAudienceBuckets preserves Meta's exact buckets", () => {
  const rows = parseAudienceBuckets("follower_demographics", "follower", "age", { value: { "25-34": 42000, "35-44": 12000 } });
  assertEquals(rows.length, 2);
  assertEquals(rows[0].dimension_key, "25-34");
  assertEquals(rows[0].value_count, 42000);
  assertEquals(rows[0].status, "available");
});

Deno.test("empty demographic response => reasoned unavailable, value NULL (never 0)", () => {
  const rows = parseAudienceBuckets("follower_demographics", "follower", "gender", { value: {} });
  assertEquals(rows.length, 1);
  assertEquals(rows[0].value_count, null);
  assertEquals(rows[0].status, "insufficient_audience");
  assert(rows[0].value_count !== 0);
});

Deno.test("classifyMetric maps errors to truthful availability (never provider-success)", () => {
  assertEquals(classifyMetric(new Error("(#10) requires instagram_business_manage_insights permission")), "permission_missing");
  assertEquals(classifyMetric(new Error("does not support the metric")), "unsupported_metric");
  assertEquals(classifyMetric(new Error("needs at least 100 followers")), "threshold_not_met");
  assertEquals(classifyMetric(new Error("boom")), "provider_error");
});

Deno.test("enabledCapabilities from granted scopes (grant truth)", () => {
  assertEquals(enabledCapabilities(["instagram_business_basic", "instagram_business_manage_comments"]).sort(),
    ["comment_intelligence"]);
});

Deno.test("runAudienceStage: one failing metric never destroys the others", async () => {
  const client: IngestClient = {
    fetchAudience(metric, breakdown) {
      if (breakdown === "gender") return Promise.reject(new Error("does not support the metric"));
      if (breakdown === "country") return Promise.resolve({ value: {} }); // below threshold
      return Promise.resolve({ value: { "25-34": 100 } });
    },
  };
  const { rows, requested, received } = await runAudienceStage(client, [{ metric: "follower_demographics", audience_type: "follower" }]);
  assertEquals(requested, 4); // age, gender, city, country
  // age + city succeeded; gender failed (unsupported_metric); country insufficient
  assertEquals(received, 2);
  const gender = rows.find((r) => r.breakdown_type === "gender")!;
  assertEquals(gender.status, "unsupported_metric");
  assertEquals(gender.value_count, null);
  const country = rows.find((r) => r.breakdown_type === "country")!;
  assertEquals(country.status, "insufficient_audience");
  assertEquals(country.value_count, null);
  const age = rows.find((r) => r.breakdown_type === "age")!;
  assertEquals(age.status, "available");
  assertEquals(age.value_count, 100);
});

Deno.test("reached_audience_demographics is never requested", () => {
  assert(!requestableAudienceMetrics().includes("reached_audience_demographics"));
});
