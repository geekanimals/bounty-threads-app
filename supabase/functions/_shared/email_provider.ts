// Provider-agnostic transactional-email adapter. Default backend = Resend (EMAIL_PROVIDER=resend).
// Mirrors wa_provider.ts: the dispatcher calls getEmailProvider().send() and never a provider directly, so
// the channel works the moment RESEND_API_KEY + EMAIL_FROM are set in Supabase secrets, and swapping to
// another provider later is a one-env change. No key in the browser; sends only happen from the edge.

export type EmailOut = { to: string; subject: string; html?: string; text?: string };
export type EmailResult = { id: string | null; raw: unknown };

export interface EmailProvider { send(msg: EmailOut): Promise<EmailResult>; }

// Minimal, safe HTML for a transactional message with a single CTA button.
export function renderEmailHtml(title: string, body: string, actionUrl?: string, actionLabel?: string): string {
  const esc = (s: string) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
  const cta = actionUrl
    ? `<p style="margin:24px 0"><a href="${esc(actionUrl)}" style="background:#6c5ce7;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;display:inline-block;font-weight:600">${esc(actionLabel || "Open the app")}</a></p>`
    : "";
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a1a2e">
    <h2 style="margin:0 0 12px">${esc(title)}</h2>
    <p style="font-size:15px;line-height:1.6;color:#333">${esc(body)}</p>${cta}
    <p style="font-size:12px;color:#8b90b8;margin-top:28px">Bounty &amp; Threads · you're receiving this about a campaign you're part of.</p>
  </div>`;
}

class ResendProvider implements EmailProvider {
  constructor(private apiKey: string, private from: string) {}
  async send(msg: EmailOut): Promise<EmailResult> {
    if (!this.apiKey) throw new Error("email not configured (RESEND_API_KEY).");
    if (!this.from) throw new Error("email not configured (EMAIL_FROM).");
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: this.from, to: msg.to, subject: msg.subject, html: msg.html, text: msg.text }),
    });
    const raw = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((raw as any)?.message || (raw as any)?.error?.message || "Resend send failed");
    return { id: (raw as any)?.id ?? null, raw };
  }
}

export function getEmailProvider(): EmailProvider {
  const which = (Deno.env.get("EMAIL_PROVIDER") || "resend").toLowerCase();
  const from = Deno.env.get("EMAIL_FROM") || "";
  if (which === "resend") return new ResendProvider(Deno.env.get("RESEND_API_KEY") || "", from);
  // room for ses / sendgrid adapters later — same interface
  return new ResendProvider(Deno.env.get("RESEND_API_KEY") || "", from);
}
