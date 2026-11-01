// Is a video link something the brand can open? Only Google Drive / Docs links are checked (they are private by
// default); every other link passes. Opened the way a logged-out person opens it — no Google account, no API key.
export type LinkCheck = { ok: boolean; checked: boolean; reason?: "private" | "not_found" | "not_a_file" | "bad_link"; message?: string };

const GOOGLE = /^(drive|docs)\.google\.com$/i;

export function driveId(raw: string): { id: string; folder: boolean; host: string; path: string } | null {
  let u: URL;
  try { u = new URL(String(raw || "").trim()); } catch { return null; }
  if (!GOOGLE.test(u.hostname)) return null;
  const p = u.pathname;
  const folder = /\/folders\//.test(p);
  const m = p.match(/\/(?:d|folders)\/([A-Za-z0-9_-]{10,})/) || (u.searchParams.get("id") || "").match(/^([A-Za-z0-9_-]{10,})$/);
  return m ? { id: m[1], folder, host: u.hostname.toLowerCase(), path: p } : { id: "", folder, host: u.hostname.toLowerCase(), path: p };
}

const MSG = {
  private: "This Drive link is private — the brand can't open it. In Google Drive tap Share → General access → “Anyone with the link” → Viewer, then submit again.",
  not_found: "This Drive link doesn't open — the file was deleted or the link is incomplete. Copy the link again from Google Drive (Share → Copy link).",
  bad_link: "This isn't a link to one file. In Google Drive open your video, tap Share → Copy link, and paste that link.",
};

// fetchFn is injected so the logic can be tested without the network
export async function checkVideoLink(raw: string, fetchFn: typeof fetch = fetch): Promise<LinkCheck> {
  const d = driveId(raw);
  if (!d) return { ok: true, checked: false };                       // not Google Drive / Docs → not checked
  if (!d.id) return { ok: false, checked: true, reason: "bad_link", message: MSG.bad_link };
  const url = d.host === "docs.google.com" ? `https://docs.google.com${d.path}`
    : d.folder ? `https://drive.google.com/drive/folders/${d.id}` : `https://drive.google.com/file/d/${d.id}/view`;
  let res: Response;
  try {
    res = await fetchFn(url, { redirect: "manual", headers: { "User-Agent": "Mozilla/5.0 (compatible; GeekLinkCheck/1.0)", "Accept-Language": "en" } });
  } catch (_e) { return { ok: true, checked: false }; }            // Google unreachable → don't block the creator
  const loc = res.headers.get("location") || "";
  if (res.status >= 300 && res.status < 400) {
    if (/accounts\.google\.com|ServiceLogin|signin/i.test(loc)) return { ok: false, checked: true, reason: "private", message: MSG.private };
    return { ok: true, checked: false };
  }
  if (res.status === 404 || res.status === 410) return { ok: false, checked: true, reason: "not_found", message: MSG.not_found };
  if (res.status === 401 || res.status === 403) return { ok: false, checked: true, reason: "private", message: MSG.private };
  if (res.status !== 200) return { ok: true, checked: false };        // 429 / 5xx → can't tell, let it through
  const html = (await res.text()).slice(0, 400000);
  if (/accounts\.google\.com\/(ServiceLogin|v3\/signin)|You need access|Request access|Need permission/i.test(html)
      && !/<meta property="og:title"/i.test(html)) {
    return { ok: false, checked: true, reason: "private", message: MSG.private };
  }
  return { ok: true, checked: true };
}
