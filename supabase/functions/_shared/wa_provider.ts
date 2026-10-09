// Provider-agnostic WhatsApp send adapter. Backend = Meta WhatsApp Cloud API (default).
// A snapto adapter is stubbed for later; the Edge Functions call sendWhatsApp() and never a provider directly.

export type WaText = { to: string; text: string };
// template carries a simple ordered variable list (snapto's templateVariables); `components` is the
// Meta-native shape used only by the Meta provider.
export type WaTemplate = { to: string; template: string; lang?: string; variables?: string[]; components?: unknown[] };
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
      const comps = msg.components ?? (msg.variables && msg.variables.length
        ? [{ type: "body", parameters: msg.variables.map((v) => ({ type: "text", text: v })) }]
        : undefined);
      payload.template = { name: msg.template, language: { code: msg.lang || "en_US" }, ...(comps ? { components: comps } : {}) };
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

// snapto.ai WhatsApp Business API. Send: POST /api/v1/whatsapp/sendMessage with header x-api-key
// (+ x-phone-id when multiple numbers). Response: { id, waMessageId }. Inbound/status arrive via a
// snapto Webhook of type "Meta Webhooks" (native Meta payload) — see wa-webhook.
class SnaptoProvider implements Provider {
  constructor(private apiKey: string, private phoneId: string, private base = "https://app.snapto.ai") {}
  async send(msg: WaOutbound): Promise<WaResult> {
    if (!this.apiKey) throw new Error("snapto not configured (SNAPTO_API_KEY).");
    const to = normalizeMsisdn(msg.to);
    if (!to) throw new Error("destination number required");
    const body: Record<string, unknown> = "template" in msg
      ? { templateName: msg.template, language: msg.lang || "en", to, templateVariables: msg.variables || [] }
      : { to, text: String((msg as WaText).text || "") };
    const headers: Record<string, string> = { "x-api-key": this.apiKey, "Content-Type": "application/json" };
    if (this.phoneId) headers["x-phone-id"] = this.phoneId;
    const r = await fetch(`${this.base}/api/v1/whatsapp/sendMessage`, { method: "POST", headers, body: JSON.stringify(body) });
    const raw = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((raw as any)?.error?.message || (raw as any)?.detail || "snapto send failed");
    return { wamid: (raw as any)?.waMessageId ?? (raw as any)?.id ?? null, raw };
  }
}

export function getProvider(): Provider {
  const which = (Deno.env.get("WA_PROVIDER") || "snapto").toLowerCase();  // lead with snapto
  if (which === "meta") return new MetaProvider(Deno.env.get("WHATSAPP_TOKEN") || "", Deno.env.get("WHATSAPP_PHONE_ID") || "", Deno.env.get("WHATSAPP_API_VER") || "v21.0");
  return new SnaptoProvider(Deno.env.get("SNAPTO_API_KEY") || "", Deno.env.get("SNAPTO_PHONE_ID") || "");
}

// sha256(code + pepper) as lowercase hex — OTP codes are never stored in the clear.
export async function hashCode(code: string, pepper: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code + "|" + pepper));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
