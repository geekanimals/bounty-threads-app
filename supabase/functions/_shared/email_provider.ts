// Provider-agnostic transactional-email adapter. Default backend = Resend (EMAIL_PROVIDER=resend).
// Mirrors wa_provider.ts: the dispatcher calls getEmailProvider().send() and never a provider directly, so
// the channel works the moment RESEND_API_KEY + EMAIL_FROM are set in Supabase secrets, and swapping to
// another provider later is a one-env change. No key in the browser; sends only happen from the edge.

export type EmailOut = { to: string; subject: string; html?: string; text?: string; headers?: Record<string, string> };
export type EmailResult = { id: string | null; raw: unknown };

export interface EmailProvider { send(msg: EmailOut): Promise<EmailResult>; }

// Professional transactional email: logo, greeting + paragraphs (same words as the WhatsApp template),
// one clear button, "Thank you! — Team Geek Animals", and the STOP / unsubscribe line. Table layout + inline
// styles so it renders the same in Gmail, Outlook and Apple Mail.
export function renderEmailHtml(title: string, body: string, actionUrl?: string, actionLabel?: string, unsubscribeUrl?: string, logoUrl?: string): string {
  const esc = (s: string) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
  const inline = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\n/g, "<br>");
  const paras = String(body || "").trim().split(/\n{2,}/).filter(Boolean)
    .map((p) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#2d3142">${inline(p)}</p>`).join("");
  const signedOff = /thank you!?\s*$/i.test(String(body || "").trim());
  const cta = actionUrl
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px"><tr><td style="border-radius:10px;background:#00b2e1">
         <a href="${esc(actionUrl)}" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px">${esc(actionLabel || "Open the app")}</a></td></tr></table>
       <p style="margin:0 0 20px;font-size:12.5px;line-height:1.5;color:#8b90a8">Or open this link: <a href="${esc(actionUrl)}" style="color:#0094c6;word-break:break-all">${esc(actionUrl)}</a></p>`
    : "";
  const logo = logoUrl
    ? `<img src="${esc(logoUrl)}" width="44" height="44" alt="Geek" style="display:block;border:0;border-radius:10px">`
    : `<div style="font-size:22px;font-weight:800;color:#00b2e1;letter-spacing:.5px">geek</div>`;
  const unsub = unsubscribeUrl
    ? ` · <a href="${esc(unsubscribeUrl)}" style="color:#8b90a8">Unsubscribe from these emails</a>`
    : "";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#f4f6fb">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:28px 12px"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
      <tr><td style="padding:22px 28px;border-bottom:1px solid #eef0f6"><table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td style="padding-right:12px">${logo}</td>
        <td style="font-size:15px;font-weight:700;color:#0f1222">Geek Creative Agency<div style="font-size:12px;font-weight:500;color:#8b90a8">Bounty &amp; Threads</div></td></tr></table></td></tr>
      <tr><td style="padding:26px 28px 6px">
        ${title ? `<h1 style="margin:0 0 18px;font-size:19px;line-height:1.35;color:#0f1222">${esc(title)}</h1>` : ""}
        ${paras}${cta}
        ${signedOff ? "" : `<p style="margin:0 0 4px;font-size:15px;line-height:1.6;color:#2d3142">Thank you!</p>`}
        <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#2d3142"><b>Team Geek Animals</b><br><span style="color:#8b90a8;font-size:13px">Geek Creative Agency</span></p>
      </td></tr>
      <tr><td style="padding:16px 28px;background:#fafbfe;border-top:1px solid #eef0f6;font-size:12px;line-height:1.6;color:#8b90a8">
        You're receiving this because you're part of a campaign on Geek OS. Reply STOP on WhatsApp to stop WhatsApp updates${unsub}. Login and account-recovery codes still come.
      </td></tr>
    </table></td></tr></table></body></html>`;
}

class ResendProvider implements EmailProvider {
  constructor(private apiKey: string, private from: string) {}
  async send(msg: EmailOut): Promise<EmailResult> {
    if (!this.apiKey) throw new Error("email not configured (RESEND_API_KEY).");
    if (!this.from) throw new Error("email not configured (EMAIL_FROM).");
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: this.from, to: msg.to, subject: msg.subject, html: msg.html, text: msg.text,
                             ...(msg.headers ? { headers: msg.headers } : {}) }),
    });
    const raw = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((raw as any)?.message || (raw as any)?.error?.message || "Resend send failed");
    return { id: (raw as any)?.id ?? null, raw };
  }
}

// SMTP (the same SMTP_* secrets the email-OTP function uses; implicit TLS on 465 — Edge blocks 25/587)
class SmtpProvider implements EmailProvider {
  async send(msg: EmailOut): Promise<EmailResult> {
    const host = Deno.env.get("SMTP_HOST") || "", user = Deno.env.get("SMTP_USER") || "", pass = Deno.env.get("SMTP_PASS") || "";
    const port = Number(Deno.env.get("SMTP_PORT") || 465);
    const from = Deno.env.get("EMAIL_FROM") || Deno.env.get("SMTP_FROM") || user;
    if (!host || !user || !pass) throw new Error("email not configured (SMTP_HOST / SMTP_USER / SMTP_PASS).");
    const nodemailer = (await import("npm:nodemailer@6.9.16")).default;
    const t = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
    const info = await t.sendMail({ from, to: msg.to, subject: msg.subject, html: msg.html, text: msg.text, headers: msg.headers });
    return { id: info?.messageId ?? null, raw: { accepted: info?.accepted ?? [] } };
  }
}

export function getEmailProvider(): EmailProvider {
  const which = (Deno.env.get("EMAIL_PROVIDER") || "").toLowerCase();
  const from = Deno.env.get("EMAIL_FROM") || "";
  if (which === "smtp" || (!Deno.env.get("RESEND_API_KEY") && Deno.env.get("SMTP_HOST"))) return new SmtpProvider();
  if (which === "resend" || !which) return new ResendProvider(Deno.env.get("RESEND_API_KEY") || "", from);
  return new ResendProvider(Deno.env.get("RESEND_API_KEY") || "", from);
}
