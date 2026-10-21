// Edge Function: geo-lookup  (verify_jwt = true — signed-in users only)
// Address helper for the delivery-address form (works like Amazon's):
//   { action: "pincode", pin }                      → city / district / state + the localities of that PIN (India Post),
//                                                     with the PIN's position on the map
//   { action: "suggest", q, pin?, city?, state? }   → landmark / area suggestions near that PIN (OpenStreetMap)
//   { action: "verify", line1, line2, landmark, city, state, pin } → finds the address on the map and says whether it
//                                                     matches the PIN + state (and how precisely: street / area / PIN)
//   { action: "reverse", lat, lon }                 → address of the current location
// Called from the server so the lookups don't depend on the browser (CORS, OpenStreetMap's User-Agent rule).
import { corsHeaders, json } from "../_shared/cors.ts";

const UA = "GeekOS/1.0 (Geek Influencer OS delivery address form)";
const cache = new Map<string, { at: number; v: unknown }>();
const TTL = 6 * 3600_000;
async function getJson(url: string, timeoutMs = 7000): Promise<any> {
  const hit = cache.get(url); if (hit && Date.now() - hit.at < TTL) return hit.v;
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "en", Accept: "application/json" }, signal: ctl.signal });
    if (!r.ok) return null;
    const v = await r.json().catch(() => null);
    if (v != null) { cache.set(url, { at: Date.now(), v }); if (cache.size > 500) cache.delete(cache.keys().next().value!); }
    return v;
  } catch (_e) { return null; } finally { clearTimeout(t); }
}
const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
// "Orissa" = "Odisha", "Pondicherry" = "Puducherry", etc.
const STATE_ALIAS: Record<string, string> = { orissa: "odisha", pondicherry: "puducherry", uttaranchal: "uttarakhand",
  "national capital territory of delhi": "delhi", "nct of delhi": "delhi", "jammu kashmir": "jammu and kashmir",
  "dadra and nagar haveli": "dadra and nagar haveli and daman and diu", "daman and diu": "dadra and nagar haveli and daman and diu" };
const stateKey = (s: unknown) => { const k = norm(s).replace(/\band\b/g, "and"); return STATE_ALIAS[k] || k; };

async function pincode(pin: string) {
  if (!/^[1-9][0-9]{5}$/.test(pin)) return { ok: false, error: "PIN code must be 6 digits" };
  const j = await getJson(`https://api.postalpincode.in/pincode/${pin}`);
  const offices: any[] = Array.isArray(j) && j[0]?.Status === "Success" ? (j[0].PostOffice || []) : [];
  let state = "", district = "", city = "", localities: string[] = [];
  if (offices.length) {
    state = offices[0].State || ""; district = offices[0].District || "";
    const counts = new Map<string, number>();
    for (const o of offices) { const b = o.Block && o.Block !== "NA" ? o.Block : o.District; counts.set(b, (counts.get(b) || 0) + 1); }
    city = district || [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
    localities = [...new Set(offices.map((o) => String(o.Name || "").trim()).filter(Boolean))].slice(0, 40);
  } else {
    const z = await getJson(`https://api.zippopotam.us/in/${pin}`);
    const places: any[] = z?.places || [];
    if (places.length) { state = places[0].state || ""; city = places[0]["place name"] || ""; localities = places.map((p) => p["place name"]).filter(Boolean); }
  }
  if (!state) return { ok: false, error: "We couldn't find this PIN code — please check it" };
  // where the PIN is on the map (for the map preview and for nearby suggestions)
  const g = await getJson(`https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=in&postalcode=${pin}&limit=1`);
  const at = Array.isArray(g) && g[0] ? { lat: Number(g[0].lat), lon: Number(g[0].lon) } : null;
  return { ok: true, pin, state, district, city, localities, at };
}

async function suggest(q: string, pin: string, city: string, state: string) {
  q = q.trim(); if (q.length < 2) return { ok: true, items: [] };
  const p = pin && /^[1-9][0-9]{5}$/.test(pin) ? await pincode(pin) : null;
  const at = (p as any)?.at as { lat: number; lon: number } | null;
  const bias = at ? `&lat=${at.lat}&lon=${at.lon}&location_bias_scale=0.6&zoom=12` : "";
  const j = await getJson(`https://photon.komoot.io/api/?q=${encodeURIComponent(q + (city ? " " + city : ""))}&limit=12&lang=en${bias}`);
  const wantState = stateKey(state || (p as any)?.state || "");
  const seen = new Set<string>();
  const items = ((j?.features ?? []) as any[]).map((f) => {
    const pr = f.properties || {}, c = f.geometry?.coordinates || [];
    return { name: pr.name || "", street: pr.street || "", locality: pr.district || pr.locality || pr.suburb || "",
      city: pr.city || pr.county || "", state: pr.state || "", postcode: pr.postcode || "", country: pr.countrycode || "",
      kind: pr.osm_value || pr.type || "", lat: c[1], lon: c[0] };
  }).filter((x) => x.name && String(x.country).toUpperCase() === "IN" && (!wantState || stateKey(x.state) === wantState))
    .filter((x) => { const k = norm(x.name + " " + x.locality); if (seen.has(k)) return false; seen.add(k); return true; })
    // the same PIN first, then nearest
    .sort((a, b) => (Number(b.postcode === pin) - Number(a.postcode === pin)) ||
      (at ? (Math.hypot(a.lat - at.lat, a.lon - at.lon) - Math.hypot(b.lat - at.lat, b.lon - at.lon)) : 0))
    .slice(0, 8);
  return { ok: true, items };
}

async function verify(b: Record<string, string>) {
  const pin = String(b.pin || "").trim(), p = await pincode(pin);
  if (!(p as any).ok) return { ok: true, found: false, pin_ok: false, reason: (p as any).error };
  const P = p as any;
  const state_ok = !b.state || stateKey(b.state) === stateKey(P.state);
  const parts = (xs: (string | undefined)[]) => xs.map((x) => String(x || "").trim()).filter(Boolean).join(", ");
  const tries: [string, string][] = [
    ["street", parts([b.line2, b.landmark, b.city, P.state, pin, "India"])],
    ["street", parts([b.line2, b.city, P.state, "India"])],
    ["area", parts([b.landmark, b.city, P.state, "India"])],
  ];
  let best: any = null, level = "";
  for (const [lv, q] of tries) {
    const j = await getJson(`https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&countrycodes=in&limit=3&q=${encodeURIComponent(q)}`);
    const hit = (Array.isArray(j) ? j : []).find((r: any) => stateKey(r.address?.state) === stateKey(P.state));
    if (hit) { best = hit; level = lv; break; }
  }
  if (!best && P.at) { best = { lat: P.at.lat, lon: P.at.lon, display_name: `${P.city || P.district}, ${P.state} ${pin}`, address: { postcode: pin, state: P.state } }; level = "pin"; }
  if (!best) return { ok: true, found: false, pin_ok: true, state_ok, state: P.state, city: P.city, reason: "Couldn't place this address on the map" };
  const lat = Number(best.lat), lon = Number(best.lon);
  // far from the PIN's own area (> 35 km) = the street/landmark probably belongs somewhere else
  const km = P.at ? Math.hypot((lat - P.at.lat) * 111, (lon - P.at.lon) * 111 * Math.cos(lat * Math.PI / 180)) : 0;
  const near_pin = !P.at || km <= 35;
  return { ok: true, found: true, pin_ok: true, state_ok, near_pin, km: Math.round(km), level, lat, lon,
    display: best.display_name, state: P.state, city: P.city, postcode: best.address?.postcode || null };
}

async function reverse(lat: number, lon: number) {
  if (!isFinite(lat) || !isFinite(lon)) return { ok: false, error: "no location" };
  const j = await getJson(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=18&lat=${lat}&lon=${lon}`);
  const a = j?.address || {};
  return { ok: !!j, house: [a.house_number, a.building || a.amenity].filter(Boolean).join(", "), street: [a.road, a.neighbourhood || a.suburb].filter(Boolean).join(", "),
    landmark: a.amenity || a.shop || a.suburb || a.quarter || "", city: a.city || a.town || a.village || a.county || a.state_district || "",
    state: a.state || "", pin: a.postcode || "", lat, lon, display: j?.display_name || "" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const b = await req.json().catch(() => ({})) as Record<string, any>;
  try {
    switch (b.action) {
      case "pincode": return json(await pincode(String(b.pin || "").trim()));
      case "suggest": return json(await suggest(String(b.q || ""), String(b.pin || ""), String(b.city || ""), String(b.state || "")));
      case "verify": return json(await verify(b));
      case "reverse": return json(await reverse(Number(b.lat), Number(b.lon)));
      default: return json({ error: "unknown action" }, 400);
    }
  } catch (e) {
    console.error("geo-lookup:", (e as Error).message);
    return json({ ok: false, error: "lookup failed — please type the address" }, 200);
  }
});
