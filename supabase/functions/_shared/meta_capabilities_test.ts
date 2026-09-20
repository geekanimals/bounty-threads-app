// Deno tests for the Meta capability registry — deterministic, no network.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  FIVE_SCOPES, META_API_VERSION, AUDIENCE_METRICS, ACCOUNT_INSIGHTS, UNSUPPORTED_AUDIENCE,
  grantedScopes, metricAllowed, SCOPE_CAPABILITY,
} from "./meta_capabilities.ts";

Deno.test("pins a concrete Graph API version (never 'latest')", () => {
  assert(/^v\d+\.\d+$/.test(META_API_VERSION));
});

Deno.test("exactly the five approved scopes, requested together", () => {
  assertEquals([...FIVE_SCOPES], [
    "instagram_business_basic", "instagram_business_manage_insights", "instagram_business_manage_comments",
    "instagram_business_manage_messages", "instagram_business_content_publish",
  ]);
});

Deno.test("audience metrics are exactly follower_ + engaged_ (reached_ is NOT supported)", () => {
  const names = AUDIENCE_METRICS.map((m) => m.metric).sort();
  assertEquals(names, ["engaged_audience_demographics", "follower_demographics"]);
  assert(UNSUPPORTED_AUDIENCE.includes("reached_audience_demographics"));
});

Deno.test("impressions is marked deprecated and never requestable", () => {
  const imp = ACCOUNT_INSIGHTS.find((m) => m.metric === "impressions");
  assertEquals(imp?.verify, "deprecated");
  assertEquals(metricAllowed(imp!, [...FIVE_SCOPES]), false);
});

Deno.test("grant truth: only returned scopes are granted", () => {
  assertEquals(grantedScopes(FIVE_SCOPES, ["instagram_business_basic", "instagram_business_manage_insights"]),
    ["instagram_business_basic", "instagram_business_manage_insights"]);
  assertEquals(grantedScopes(FIVE_SCOPES, []), []);
});

Deno.test("basic scope maps to no toggleable capability; others map correctly", () => {
  assertEquals(SCOPE_CAPABILITY["instagram_business_basic"], null);
  assertEquals(SCOPE_CAPABILITY["instagram_business_manage_insights"], "performance_insights");
  assertEquals(SCOPE_CAPABILITY["instagram_business_content_publish"], "publishing_scheduling");
});

Deno.test("metricAllowed requires the controlling scope be granted", () => {
  const follower = AUDIENCE_METRICS.find((m) => m.metric === "follower_demographics")!;
  assertEquals(metricAllowed(follower, ["instagram_business_basic"]), false);
  assertEquals(metricAllowed(follower, ["instagram_business_manage_insights"]), true);
});
