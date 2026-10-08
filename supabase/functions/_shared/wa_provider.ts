// Provider-agnostic WhatsApp send adapter. Backend = Meta WhatsApp Cloud API (default).
// A snapto adapter is stubbed for later; the Edge Functions call sendWhatsApp() and never a provider directly.

export type WaText = { to: string; text: string };
export type WaTemplate = { to: string; template: string; lang?: string; components?: unknown[] };
export type WaOutbound = WaText | WaTemplate;
export type WaResult = { wamid: string | null; raw: unknown };

// digits-only E.164 (no '+'); bare 10-digit numbers default to India (+91).
export function normalizeMsisdn(raw: string): string {
  let d = (raw || "").replace(/[^\d+]/g, "");
  if (d.startsWith("+")) return d.slice(1);
  d = d.replace(/\D/g, "");
  if (d.length === 10) return "91" + d;
  return d;
}
// canonical +E.164 for storage/matching
export function toE164(raw: string): string { const d = normalizeMsisdn(raw); return d ? "+" + d : ""; }

export interface Provider { send(msg: WaOutbound): Promise<WaResult>; }

class MetaProvider implements Provider {
  constructor(private token: string, private phoneId: string, private apiVer: string) {}
  async send(msg: WaOutbound): Promise<WaResult> {
    if (!this.token || !this.phoneId) throw new Error("WhatsApp Cloud API not configured (WHATSAPP_TOKEN / WHATSAPP_PHONE_ID).");
    const to = normalizeMsisdn(msg.to);
    if (!to) throw new Error("destination number required");
    const payload: Record<string, unknown> = { messaging_product: "whatsapp", to };
    if ("template" in msg) {
      payload.type = "template";
      payload.template = { name: msg.template, language: { code: msg.lang || "en_US" }, ...(msg.components ? { components: msg.components } : {}) };
    } else {
      payload.type = "text";
      payload.text = { body: String(msg.text || "") };
    }
    const r = await fetch(`https://graph.facebook.com/${this.apiVer}/${this.phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const raw = await r.json();
    if (!r.ok) throw new Error(raw?.error?.message || "WhatsApp send failed");
    const wamid = raw?.messages?.[0]?.id ?? null;
    return { wamid, raw };
  }
}

// Stub — snapto is send-only (x-api-key / x-phone-id). Wire if/when a REST send endpoint is confirmed.
class SnaptoProvider implements Provider {
  constructor(private apiKey: string, private phoneId: string) {}
  async send(_msg: WaOutbound): Promise<WaResult> {
    throw new Error("snapto provider not wired: confirm its REST send endpoint, then implement here.");
  }
}

export function getProvider(): Provider {
  const which = (Deno.env.get("WA_PROVIDER") || "meta").toLowerCase();
  if (which === "snapto") return new SnaptoProvider(Deno.env.get("SNAPTO_API_KEY") || "", Deno.env.get("SNAPTO_PHONE_ID") || "");
  return new MetaProvider(Deno.env.get("WHATSAPP_TOKEN") || "", Deno.env.get("WHATSAPP_PHONE_ID") || "", Deno.env.get("WHATSAPP_API_VER") || "v21.0");
}

// sha256(code + pepper) as lowercase hex — OTP codes are never stored in the clear.
export async function hashCode(code: string, pepper: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code + "|" + pepper));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
