import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fetchProfileBundle } from "./ig.ts";

const bucket = (dims: string[], value: number) => ({ dimension_values: dims, value });
const demo = (keys: string[], results: unknown[]) => ({
  data: [{ name: "follower_demographics", period: "lifetime", total_value: { breakdowns: [{ dimension_keys: keys, results }] } }],
});

Deno.test("fetchProfileBundle builds audience shape with valid params and logs errors", async () => {
  const urls: string[] = [];
  const logs: string[] = [];
  const origFetch = globalThis.fetch, origErr = console.error;
  console.error = (...a: unknown[]) => logs.push(a.join(" "));
  globalThis.fetch = ((input: string | URL | Request) => {
    const u = String(input); urls.push(u);
    const j = (b: unknown) => Promise.resolve(new Response(JSON.stringify(b)));
    if (u.includes("/me?")) return j({ username: "x" });
    if (u.includes("/me/media")) return j({ data: [{ id: "m1" }] });
    if (u.includes("/m1/insights")) return j({ error: { code: 10, message: "no permission", access_token: "SECRET" } });
    if (u.includes("/tags")) return j({ error: { code: 190, message: "bad token" } });
    if (u.includes("breakdown=country")) return j(demo(["country"], [bucket(["IN"], 80), bucket(["US"], 20)]));
    if (u.includes("breakdown=city")) return j(demo(["city"], [bucket(["Kochi, Kerala"], 10)]));
    if (u.includes("breakdown=gender,age")) return j(demo(["gender", "age"], [bucket(["F", "25-34"], 60), bucket(["M", "18-24"], 40)]));
    return j({});
  }) as typeof fetch;
  try {
    const r = await fetchProfileBundle("TOKEN", "123");
    assertEquals(r.audience, {
      country: { IN: 80, US: 20 },
      city: { "Kochi, Kerala": 10 },
      gender_age: { "F · 25-34": 60, "M · 18-24": 40 },
    });
    const aud = urls.filter((u) => u.includes("follower_demographics"));
    assertEquals(aud.length, 3);
    for (const u of aud) assert(u.includes("metric_type=total_value") && u.includes("period=lifetime") && u.includes("timeframe=this_month"));
    assert(logs.some((l) => l.startsWith("IG_REACH_ERROR")));
    assert(logs.some((l) => l.startsWith("IG_TAGS_ERROR")));
    assert(!logs.join("\n").includes("TOKEN") && !logs.join("\n").includes("SECRET"));
  } finally { globalThis.fetch = origFetch; console.error = origErr; }
});
