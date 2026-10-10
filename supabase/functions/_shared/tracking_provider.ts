// Provider-agnostic courier tracking adapter (DTDC / Amazon). Mirrors wa_provider / email_provider.
// The ops-tracking-worker calls getTrackingProvider(carrier).track(ref) and never a carrier directly, so a
// carrier works the moment its endpoint + key are set in Supabase secrets, and adding a carrier is one class.
// Exact carrier payloads differ per account/contract, so each adapter calls a configurable endpoint and
// normalises the free-text status into our vocabulary. Dark until configured.

export type TrackResult = { status: "shipped" | "delivered" | "failed"; label: string; raw: unknown };

// map a free-text carrier status into our shipment vocabulary
export function normalizeStatus(s: string): "shipped" | "delivered" | "failed" {
  const t = (s || "").toLowerCase();
  if (/deliver/.test(t)) return "delivered";
  if (/(rto|return|undeliver|failed|cancel|lost|damage)/.test(t)) return "failed";
  return "shipped"; // in transit / out for delivery / booked
}

export interface TrackingProvider { track(ref: string): Promise<TrackResult>; }

// Generic HTTP adapter: GET <url> with {ref} substituted into the URL/header, read JSON, pull the status
// from a configurable JSON path (dot-notation), normalise it. Works for most REST tracking APIs.
class HttpTrackingProvider implements TrackingProvider {
  constructor(private url: string, private key: string, private keyHeader: string, private statusPath: string) {}
  async track(ref: string): Promise<TrackResult> {
    if (!this.url) throw new Error("carrier not configured (tracking URL).");
    const url = this.url.replace("{ref}", encodeURIComponent(ref));
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.key) headers[this.keyHeader] = this.key;
    const r = await fetch(url, { headers });
    const raw = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((raw as any)?.message || (raw as any)?.error || "tracking request failed");
    let node: any = raw;
    for (const seg of (this.statusPath || "status").split(".")) node = node == null ? null : node[seg];
    const label = String(node ?? "");
    return { status: normalizeStatus(label), label, raw };
  }
}

export function getTrackingProvider(carrier: string): TrackingProvider {
  const c = (carrier || "").toLowerCase();
  if (c === "dtdc") return new HttpTrackingProvider(
    Deno.env.get("DTDC_TRACK_URL") || "", Deno.env.get("DTDC_API_KEY") || "",
    Deno.env.get("DTDC_KEY_HEADER") || "X-Access-Token", Deno.env.get("DTDC_STATUS_PATH") || "status");
  if (c === "amazon") return new HttpTrackingProvider(
    Deno.env.get("AMAZON_TRACK_URL") || "", Deno.env.get("AMAZON_API_KEY") || "",
    Deno.env.get("AMAZON_KEY_HEADER") || "x-api-key", Deno.env.get("AMAZON_STATUS_PATH") || "status");
  // unknown carrier → a generically configured endpoint, or unconfigured (throws on use)
  return new HttpTrackingProvider(
    Deno.env.get("CARRIER_TRACK_URL") || "", Deno.env.get("CARRIER_API_KEY") || "",
    Deno.env.get("CARRIER_KEY_HEADER") || "x-api-key", Deno.env.get("CARRIER_STATUS_PATH") || "status");
}
