// WhatsApp help bot — the reply, built only from that phone number's LIVE data (intel.ci_bot_context).
// Pure: (question, context, history) → { reply, steps, handoff, intent, campaign_id }. The worker may let an AI
// model rewrite the reply in the creator's own words, but the facts always come from here.

import { campaignHelperAnswer, detectIntents, isHinglish } from "./campaign_helper_core.ts";

type Any = Record<string, any>;
export type BotCtx = {
  phone: string | null; registered: boolean; user_id?: string | null; name?: string | null; role?: string | null;
  account_status?: string | null; needs?: string[]; campaigns?: Any[]; extra?: Record<string, Any>; invites?: Any[]; app_url?: string | null;
};
export type StepsKind = "register" | "instagram" | null;
export type BotDraft = { reply: string; steps: StepsKind; handoff: boolean; intent: string; campaign_id: string | null; facts: string };

const ACTION_ORDER = ["changes_requested", "content_created", "contract_sent", "contract_signed", "content_approved", "product_sent", "invited",
  "content_submitted", "address_confirmed", "published", "brand_confirmed", "accepted", "sent_to_brand", "shortlisted", "eligible", "applied", "completed"];
const DONE = ["completed", "rejected", "ineligible", "brand_declined", "dropped"];

// the bulk-sheet stage of a creator who has not registered yet
const INVITE_STAGE: Record<string, [string, string]> = {
  registered: ["campaign mein add ho — screening chal rahi hai", "added to the campaign — screening is on"],
  screened: ["screening ho gayi — brand ki list ban rahi hai", "screened — the brand's list is being made"],
  sent_to_brand: ["aapka profile brand ke paas hai", "your profile is with the brand"],
  approved: ["brand ne aapko approve kar diya hai 🎉", "the brand approved you 🎉"],
  contract_sent: ["contract ready hai — app mein sign karna hai", "your contract is ready to sign in the app"],
  contract_signed: ["contract sign ho gaya — ab address confirm karna hai", "contract signed — now confirm your address"],
  address_confirmed: ["address confirm hai — product pack ho raha hai", "address confirmed — your product is being packed"],
  courier_sent: ["product courier ho gaya hai 🚚", "your product has shipped 🚚"],
  courier_delivered: ["product deliver ho gaya — ab video banana hai", "product delivered — now make your video"],
  video_brief_sent: ["video brief aa gaya — ab video banana hai", "your video brief is out — make your video"],
  video_submitted: ["video brand ke review mein hai", "your video is with the brand for review"],
  client_approved: ["video approve ho gaya ✅ — ab post karna hai", "your video is approved ✅ — now post it"],
  posted: ["post ho gaya — campaign complete 🏁", "posted — campaign complete 🏁"],
};

const norm = (s: string) => " " + String(s || "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim() + " ";
const any = (q: string, words: string[]) => words.some((w) => q.includes(" " + w + " ") || (w.includes(" ") && q.includes(w)));

const REGISTER_WORDS = ["register", "registration", "signup", "sign up", "login", "log in", "otp", "code nahi", "code nhi", "code not", "account kaise",
  "join kaise", "kaise join", "kaise judu", "kaise jude", "join karna", "join karu", "app kaise", "app kaha", "app kahan", "link kaha", "link kahan",
  "link nahi", "link nhi", "website", "sign in", "signin", "verify", "verification", "panjikaran", "रजिस्टर", "लॉगिन"];
const INSTA_WORDS = ["instagram connect", "insta connect", "connect instagram", "connect insta", "media kit", "mediakit", "professional account",
  "business account", "creator account", "insta link", "instagram link", "insta nahi", "instagram nahi", "facebook page", "connect nahi", "connect nhi"];
const HUMAN_WORDS = ["team", "human", "person", "agent", "manager", "call me", "call karo", "call kar", "phone karo", "baat karni", "baat karna", "baat kara",
  "complaint", "complain", "fraud", "scam", "refund", "legal", "police", "insaan", "real person", "koi hai", "reply karo", "reply nahi", "reply nhi"];
const GREET_WORDS = ["hi", "hii", "hiii", "hello", "helo", "hey", "namaste", "namaskar", "hlo", "good morning", "good evening", "gm", "ok", "okay", "thanks", "thank you", "thanku", "ty"];

export function detectBotIntent(question: string): "human" | "register" | "instagram" | "greet" | "thanks" | "campaign" {
  const q = norm(question);
  if (/^\s*team\s*$/i.test(question.trim()) || any(q, HUMAN_WORDS)) return "human";
  if (any(q, INSTA_WORDS)) return "instagram";
  if (any(q, REGISTER_WORDS)) return "register";
  const words = q.trim().split(" ").filter(Boolean);
  if (words.length <= 4 && words.some((w) => /^(thanks|thank|thanku|thankyou|ty|ok|okay|okk|done|theek|thik|accha|acha|achha|shukriya|dhanyavad)$/.test(w))
      && words.every((w) => /^(thanks|thank|you|thanku|thankyou|ty|ok|okay|okk|done|theek|thik|hai|accha|acha|achha|shukriya|dhanyavad|bhai|sir|ji|mam|so|much)$/.test(w))) return "thanks";
  if (words.length <= 2 && words.some((w) => /^(status|update|updates)$/.test(w))) return "greet";
  if (words.length <= 3 && words.every((w) => GREET_WORDS.includes(w) || /^(bhai|sir|mam|ma'am|ji|please|pls)$/.test(w))) return "greet";
  return "campaign";
}

export function waFormat(s: string): string {
  return String(s || "").replace(/\*\*(.+?)\*\*/g, "*$1*").replace(/^#+\s*/gm, "").replace(/\n{3,}/g, "\n\n").trim();
}

export function appLink(ctx: BotCtx, path = "/app.html"): string {
  const base = String(ctx.app_url || "").replace(/\/+$/, "");
  return base ? base + path : "";
}

export function registerSteps(hi: boolean, link: string): string {
  return hi
    ? [`*Register kaise kare (2 minute):*`,
       `1️⃣ Ye link kholo: ${link || "Bounty Threads app"}`,
       `2️⃣ *WhatsApp number* daalo (jis number se ye message kar rahe ho) → *Send OTP on WhatsApp* dabao`,
       `3️⃣ WhatsApp pe aaya *6 digit code* daalo → aap sign in ho jaoge`,
       `4️⃣ *Connect Instagram* dabao → apne Instagram (Business/Creator account) se login karke *Allow* karo`,
       `5️⃣ Bas! Aapka campaign card khul jayega — wahan har step ka button hai`].join("\n")
    : [`*How to register (2 minutes):*`,
       `1️⃣ Open this link: ${link || "the Bounty Threads app"}`,
       `2️⃣ Enter your *WhatsApp number* (the one you're messaging from) → tap *Send OTP on WhatsApp*`,
       `3️⃣ Type the *6-digit code* you get on WhatsApp → you're signed in`,
       `4️⃣ Tap *Connect Instagram* → log in with your Instagram (Business/Creator account) and tap *Allow*`,
       `5️⃣ Done! Your campaign card opens — every step has its own button there`].join("\n");
}

export function instagramSteps(hi: boolean, link: string): string {
  return hi
    ? [`*Instagram connect kaise kare:*`,
       `1️⃣ App kholo${link ? `: ${link}` : ""} → *Connect Instagram* dabao`,
       `2️⃣ Instagram se login karo aur *Allow* dabao (password hum kabhi nahi dekhte)`,
       `3️⃣ "Personal account" bole to: Instagram → Settings → *Account type and tools* → *Switch to professional account* → Creator (free, 1 minute) — phir dobara Connect dabao`,
       `4️⃣ Connect hote hi media kit ban jata hai aur campaigns khul jaate hain`].join("\n")
    : [`*How to connect Instagram:*`,
       `1️⃣ Open the app${link ? `: ${link}` : ""} → tap *Connect Instagram*`,
       `2️⃣ Log in to Instagram and tap *Allow* (we never see your password)`,
       `3️⃣ If it says "personal account": Instagram → Settings → *Account type and tools* → *Switch to professional account* → Creator (free, 1 minute) — then tap Connect again`,
       `4️⃣ Once connected your media kit is built and campaigns open up`].join("\n");
}

const fmtDate = (d?: string | null) => {
  if (!d) return "";
  const x = new Date(d);
  return isNaN(+x) ? String(d) : x.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
};

export function pickCampaign(question: string, camps: Any[]): Any | null {
  if (!camps.length) return null;
  const ql = question.toLowerCase();
  const named = camps.find((x) => [x.campaign, x.brand, x.product].some((n) => n && String(n).length > 2 && ql.includes(String(n).toLowerCase())));
  if (named) return named;
  const live = camps.filter((x) => !DONE.includes(String(x.stage)));
  const pool = live.length ? live : camps;
  return [...pool].sort((a, b) => (ACTION_ORDER.indexOf(a.stage) + 1 || 99) - (ACTION_ORDER.indexOf(b.stage) + 1 || 99))[0];
}

// one line per campaign — what the bot knows (also handed to the AI as facts)
export function campaignFacts(c: Any, ex: Any | undefined): string {
  const sh = c.shipment || null;
  const parts = [
    `campaign "${c.campaign}"${c.brand ? ` by ${c.brand}` : ""}`,
    `stage: ${c.stage}`,
    ex?.pending ? `still to do: ${ex.pending}` : "",
    c.deadline ? `video due: ${fmtDate(c.deadline)}` : "",
    c.ends_on ? `campaign ends: ${fmtDate(c.ends_on)}` : "",
    c.product ? `product: ${c.product}` : "",
    c.deliverables_text ? `deliverables: ${c.deliverables_text}` : "",
    ex?.progress?.left ? `posts left: ${ex.progress.left}` : "",
    sh ? `courier: ${[sh.status, sh.courier, sh.tracking_ref && "tracking " + sh.tracking_ref, sh.tracking_url, sh.delivered_at && "delivered " + fmtDate(sh.delivered_at)].filter(Boolean).join(", ")}` : "",
    c.review?.decision ? `last review: ${c.review.decision}${c.review.reason ? ` — "${String(c.review.reason).slice(0, 160)}"` : ""}` : "",
    c.blocked_at ? `BLOCKED: ${c.block_reason || "video not received in time"}` : "",
    ex?.contract?.content_days ? `video within ${ex.contract.content_days} days of receiving the product` : "",
    ex?.contract?.ad_rights_months ? `ad rights ${ex.contract.ad_rights_months} month(s) — keep the post live` : "",
    (c.hashtags || []).length || (c.mentions || []).length ? `caption must have: ${[...(c.hashtags || []).map((h: string) => (String(h).startsWith("#") ? h : "#" + h)), ...(c.mentions || []).map((m: string) => "@" + String(m).replace(/^@/, ""))].join(" ")}` : "",
    c.comp_type ? `type: ${c.comp_type}` : "",
  ].filter(Boolean);
  return "- " + parts.join(" · ");
}

export function inviteFacts(i: Any, hi: boolean): string {
  const st = INVITE_STAGE[String(i.status)] || INVITE_STAGE.registered;
  return `- campaign "${i.campaign}"${i.brand ? ` by ${i.brand}` : ""} · not registered yet · sheet status: ${i.status} (${hi ? st[0] : st[1]})`
    + (i.product ? ` · product: ${i.product}` : "") + (i.tracking_ref || i.tracking_url ? ` · courier: ${[i.courier, i.tracking_ref, i.tracking_url].filter(Boolean).join(", ")}` : "")
    + (i.ends_on ? ` · ends ${fmtDate(i.ends_on)}` : "");
}

export function buildFacts(ctx: BotCtx, hi: boolean): string {
  const camps = ctx.campaigns || [], inv = ctx.invites || [];
  const lines = [
    `phone: ${ctx.phone}`,
    `registered on the app: ${ctx.registered ? "yes" : "no"}${ctx.name ? ` · name: ${ctx.name}` : ""}${ctx.role && ctx.role !== "creator" ? ` · account type: ${ctx.role}` : ""}`,
    ctx.registered && (ctx.needs || []).length ? `still to connect before campaigns open: ${(ctx.needs || []).join(", ")}` : "",
    camps.length ? `campaigns on their account:\n${camps.slice(0, 6).map((c) => campaignFacts(c, ctx.extra?.[c.participation_id])).join("\n")}` : (ctx.registered ? "campaigns on their account: none" : ""),
    inv.length ? `campaigns this number was added to (needs to register to continue):\n${inv.slice(0, 4).map((i) => inviteFacts(i, hi) + (appLink(ctx, i.join_path) ? ` · join link: ${appLink(ctx, i.join_path)}` : "")).join("\n")}` : "",
    appLink(ctx) ? `app link: ${appLink(ctx)}` : "",
  ].filter(Boolean);
  return lines.join("\n");
}

const FOOT = (hi: boolean) => hi ? "\n\n_🤖 Geek auto-reply · insaan se baat karni ho to *TEAM* likho_" : "\n\n_🤖 Geek auto-reply · type *TEAM* to talk to a person_";

// Hinglish / Hindi? (the helper's check + common chat spellings)
export function isHi(q: string): boolean {
  return isHinglish(q) || /[ऀ-ॿ]/.test(q)
    || /(^|[^a-z])(bhejo|bhej|apni|apna|aap|aapka|aapki|mujhe|muje|mera|meri|kab|kya|ky|kaise|kese|kaisa|krna|karna|karo|kro|nhi|nahi|hai|hain|h|bta|btao|batao|bataye|kitna|kaha|kahan|abhi|haan|ha|ji|bhai|yaar|yar)([^a-z]|$)/i.test(q);
}
// what is pending (ci_pending_action, English) → Hinglish
const PENDING_HI: [RegExp, string][] = [
  [/^sign your contract in the app$/i, "app mein apna contract sign karo"],
  [/^confirm your delivery address$/i, "apna delivery address confirm karo"],
  [/^tap Received once your parcel arrives$/i, "parcel milte hi app mein Received dabao"],
  [/^submit your video with the changes the brand asked for$/i, "brand ke bataye changes karke video dobara submit karo"],
  [/^submit your video$/i, "apna video submit karo"],
  [/^post your approved content \((.+)\) and add the links$/i, "approved content post karo ($1) aur links app mein daalo"],
  [/^post the rest — (.+) — and add the links$/i, "baaki post karo — $1 — aur links app mein daalo"],
];
export const pendingText = (p: string, hi: boolean) => {
  if (!hi) return p;
  for (const [re, to] of PENDING_HI) if (re.test(p)) return p.replace(re, to);
  return p;
};

export function buildDraft(question: string, ctx: BotCtx): BotDraft {
  const hi = isHi(question);
  const T = (h: string, e: string) => (hi ? h : e);
  const intent = detectBotIntent(question);
  const camps = ctx.campaigns || [], inv = ctx.invites || [];
  const first = String(ctx.name || "").trim().split(/\s+/)[0] || "";
  const hey = first ? T(`Hi *${first}* 👋`, `Hi *${first}* 👋`) : T("Hi 👋", "Hi 👋");
  const link = appLink(ctx);
  const facts = buildFacts(ctx, hi);
  const out = (reply: string, steps: StepsKind, handoff: boolean, it: string, cid: string | null = null): BotDraft =>
    ({ reply: waFormat(reply) + FOOT(hi), steps, handoff, intent: it, campaign_id: cid, facts });

  if (intent === "thanks") return out(T("🙏 Koi aur sawaal ho toh yahin poochh lo.", "🙏 Anything else, just ask here."), null, false, "thanks");
  if (intent === "human") {
    return out(`${hey}\n${T("Theek hai — maine Geek team ko bata diya hai, woh jaldi isi chat pe aapko reply karenge. 🙏", "Sure — I've told the Geek team, they'll reply to you right here soon. 🙏")}`,
      null, true, "human", pickCampaign(question, camps)?.campaign_id ?? inv[0]?.campaign_id ?? null);
  }

  // not registered with this number
  if (!ctx.registered) {
    if (inv.length) {
      const i = inv[0];
      const st = INVITE_STAGE[String(i.status)] || INVITE_STAGE.registered;
      const jl = appLink(ctx, i.join_path) || link;
      const list = inv.length > 1 ? "\n" + inv.slice(1, 4).map((x) => `• *${x.campaign}*${x.brand ? ` (${x.brand})` : ""}`).join("\n") : "";
      return out(`${hey}\n${T(`Aap *${i.campaign}*${i.brand ? ` (${i.brand})` : ""} campaign mein ho — abhi: *${st[0]}*.`, `You're in the *${i.campaign}*${i.brand ? ` (${i.brand})` : ""} campaign — right now: *${st[1]}*.`)}${list ? T("\nAur bhi campaigns:", "\nAlso:") + list : ""}\n\n`
        + T("Aage badhne ke liye pehle app pe register karna hai (contract, address, video sab wahin hota hai).", "To move ahead please register on the app first (contract, address and video are all done there).")
        + "\n\n" + registerSteps(hi, jl), "register", false, "register", i.campaign_id);
    }
    if (intent === "register" || intent === "instagram" || intent === "greet") {
      return out(`${hey}\n${T("Ye *Geek Animals · Bounty Threads* ka number hai.", "This is the *Geek Animals · Bounty Threads* number.")} ${T("Is number se abhi koi account nahi bana hai.", "There's no account on this number yet.")}\n\n${registerSteps(hi, link)}\n\n`
        + T("Agar aapne kisi aur number se register kiya hai, toh usi number se message karo — main aapka campaign status bata dunga.", "If you registered with a different number, message from that number and I'll tell you your campaign status."),
        "register", false, "register");
    }
    return out(`${hey}\n${T("Is number pe mujhe koi account ya campaign nahi mila.", "I couldn't find an account or campaign on this number.")}\n`
      + T("• Creator ho? Register karo: ", "• Are you a creator? Register here: ") + (link || "Bounty Threads app") + "\n"
      + T("• Kisi aur number se registered ho? Usi number se message karo.", "• Registered with another number? Message from that one.") + "\n"
      + T("• Brand / agency ya kuch aur? Maine Geek team ko bata diya hai — woh yahin reply karenge.", "• A brand / agency or something else? I've told the Geek team — they'll reply here."),
      null, true, "unknown");
  }

  // registered — anything still to connect?
  const needs = ctx.needs || [];
  const needIg = needs.some((n) => /instagram/i.test(n)), needWa = needs.some((n) => /whatsapp/i.test(n));
  if (intent === "instagram" || (needIg && (intent === "register" || intent === "greet" || !camps.length))) {
    return out(`${hey}\n${needIg ? T("Aapka account ban gaya hai ✓ — bas *Instagram connect* karna baaki hai, uske baad campaigns khulenge.", "Your account is ready ✓ — just *connect Instagram* and campaigns open up.") : T("Aapka Instagram already connected hai ✓", "Your Instagram is already connected ✓")}\n\n${instagramSteps(hi, link)}`,
      needIg ? "instagram" : null, false, "instagram");
  }
  if (intent === "register") {
    return out(`${hey}\n${T("Aap already registered ho ✓ (isi number se).", "You're already registered ✓ (with this number).")}${needWa ? T(" Bas app mein *Connect WhatsApp* kar do.", " Just tap *Connect WhatsApp* in the app.") : ""}\n`
      + T(`Login: ${link || "app"} kholo → yahi WhatsApp number → OTP → andar.`, `To log in: open ${link || "the app"} → this WhatsApp number → OTP → you're in.`),
      null, false, "register");
  }

  if (!camps.length) {
    if (inv.length) {
      const i = inv[0];
      return out(`${hey}\n${T(`Aap *${i.campaign}* mein add ho — app mein ye link kholo, campaign aapke account pe aa jayega:`, `You were added to *${i.campaign}* — open this link and the campaign joins your account:`)} ${appLink(ctx, i.join_path) || link}`,
        null, false, "invite", i.campaign_id);
    }
    return out(`${hey}\n${T("Abhi aapke account pe koi campaign nahi hai. App mein *Campaigns* kholo aur apply karo — select hote hi har update WhatsApp pe aayega.", "You don't have a campaign yet. Open *Campaigns* in the app and apply — once you're selected every update comes here on WhatsApp.")}${link ? `\n${link}` : ""}`,
      null, false, "no_campaign");
  }

  const c = pickCampaign(question, camps)!;
  const ex = ctx.extra?.[c.participation_id];
  if (intent === "greet") {
    const live = camps.filter((x) => !DONE.includes(String(x.stage))).slice(0, 4);
    const rows = (live.length ? live : camps.slice(0, 2)).map((x) => {
      const e2 = ctx.extra?.[x.participation_id];
      return `• *${x.campaign}*${x.brand ? ` (${x.brand})` : ""} — ${e2?.pending ? T("abhi karna hai: ", "to do: ") + pendingText(e2.pending, hi) : stageWord(String(x.stage), hi)}`;
    });
    return out(`${hey}\n${T("Aapke campaigns ka abhi ka status:", "Here's where your campaigns are:")}\n${rows.join("\n")}\n\n${T("Kuch bhi poochho — parcel, deadline, video, post, contract…", "Ask me anything — parcel, deadline, video, posting, contract…")}`,
      null, false, "greet", c.campaign_id);
  }
  const ans = campaignHelperAnswer(question, c, ex?.contract ?? null);
  const head = camps.length > 1 ? `📌 *${c.campaign}${c.brand ? " · " + c.brand : ""}*\n` : "";
  // the helper talks about buttons "on the card" — point to the app
  const tail = /card|dabao|tap /i.test(ans.reply) && link ? T(`\n\n👉 App: ${link}`, `\n\n👉 App: ${link}`) : "";
  const talksStep = (ans.intents || []).some((x) => ["next", "product", "submit", "changes", "post", "video"].includes(x));
  const stuck = ex?.pending && !talksStep
    ? T(`\n\n⚠️ Abhi aapka atka hua step: *${pendingText(ex.pending, true)}*`, `\n\n⚠️ Your pending step: *${ex.pending}*`) : "";
  return out(`${hey}\n${head}${ans.reply}${stuck}${tail}`, null, false, (ans.intents || detectIntents(question))[0] || "next", c.campaign_id);
}

function stageWord(stage: string, hi: boolean): string {
  const m: Record<string, [string, string]> = {
    applied: ["application check ho rahi hai", "application being checked"], eligible: ["screening pass", "passed screening"],
    shortlisted: ["shortlisted", "shortlisted"], sent_to_brand: ["brand dekh raha hai", "with the brand"],
    brand_confirmed: ["select ho gaye 🎉", "selected 🎉"], accepted: ["accepted", "accepted"], invited: ["invite mila hai", "invited"],
    contract_sent: ["contract sign karna hai", "sign your contract"], contract_signed: ["address confirm karna hai", "confirm your address"],
    address_confirmed: ["product pack ho raha hai", "product being packed"], product_sent: ["product raste mein 🚚", "product on the way 🚚"],
    content_created: ["video banana hai 🎬", "make your video 🎬"], content_submitted: ["video review mein", "video in review"],
    changes_requested: ["video mein changes karne hain", "video changes needed"], content_approved: ["post karna hai ✅", "time to post ✅"],
    published: ["post live hai 📈", "post is live 📈"], completed: ["complete 🏁", "complete 🏁"],
  };
  const x = m[stage]; return x ? (hi ? x[0] : x[1]) : stage;
}

// broadcast replies / numbers not in the app: a short "got it — the team will reply here" (+ how to join the app)
export function buildAck(question: string, ctx: BotCtx, reason: string): BotDraft {
  const hi = isHi(question);
  const T = (h: string, e: string) => (hi ? h : e);
  const first = String(ctx.name || "").trim().split(/\s+/)[0] || "";
  const hey = first ? `Hi *${first}* 👋` : "Hi 👋";
  const link = appLink(ctx);
  const camps = (ctx.campaigns || []).filter((c) => !["completed", "rejected", "ineligible", "brand_declined", "dropped"].includes(String(c.stage)));
  const lines = [
    hey,
    T("Thank you for your message! 🙏 Geek team ko aapka message mil gaya hai — woh jaldi isi chat pe reply karenge.",
      "Thank you for your message! 🙏 The Geek team has it and will reply right here soon."),
  ];
  if (camps.length) {
    lines.push(T(`Bounty Threads app pe aapke ${camps.length} campaign chal rahe hain — unka status jaanna ho to *status* likho.`,
                 `You have ${camps.length} campaign(s) running on the Bounty Threads app — type *status* to see where each one is.`));
  } else if (!ctx.registered && !(ctx.invites || []).length) {
    lines.push(T(`Creator ho? Bounty Threads app pe register karke barter & paid campaigns paao${link ? `: ${link}` : ""} (steps chahiye to *register* likho).`,
                 `Are you a creator? Register on the Bounty Threads app for barter & paid campaigns${link ? `: ${link}` : ""} (type *register* for the steps).`));
  }
  const reply = waFormat(lines.join("\n\n")) + (hi ? "\n\n_🤖 Geek auto-reply_" : "\n\n_🤖 Geek auto-reply_");
  return { reply, steps: null, handoff: false, intent: "ack", campaign_id: null, facts: reason };
}

// ---- AI rewrite (optional) ------------------------------------------------------------------------
export function aiPrompt(question: string, draft: BotDraft, history: Any[]): { system: string; user: string } {
  const system = [
    "You are the WhatsApp auto-reply helper of Geek Animals (Bounty Threads app), an influencer-marketing agency in India.",
    "You reply to CREATORS about THEIR OWN campaigns. Use ONLY the FACTS below — never invent dates, tracking numbers, payments, links or promises.",
    "If the facts don't answer the question, or the creator is upset, wants a person, talks about money disputes, legal issues or anything outside their campaign: set handoff=true and say the Geek team will reply here soon.",
    "Write like a helpful person on WhatsApp: short (max ~8 lines), warm, clear next step. Match the creator's language: Hinglish in roman script if they write Hinglish, Hindi script if they write Hindi, else simple English.",
    "WhatsApp formatting only: *bold*, _italic_, emojis sparingly, numbered steps 1️⃣ 2️⃣. No markdown headers, no tables. Only use links that appear in the FACTS or DRAFT.",
    "If they ask how to register / log in / join, set steps=\"register\" (screenshots are attached for you). If they ask how to connect Instagram / media kit, set steps=\"instagram\".",
    "Answer about the campaign they name; if they don't name one, the DRAFT already picked the right one.",
    "Always end with this exact line on its own: " + JSON.stringify(draft.reply.split("\n").pop() || ""),
    'Reply with JSON only: {"reply": string, "steps": "register"|"instagram"|null, "handoff": boolean}',
  ].join("\n");
  const hist = history.slice(-8).map((h) => `${h.dir === "inbound" ? "Creator" : "Geek"}: ${String(h.text || "").slice(0, 300)}`).join("\n");
  const user = `FACTS (live from the app):\n${draft.facts}\n\nRECENT CHAT:\n${hist || "(none)"}\n\nCREATOR'S NEW MESSAGE:\n${question}\n\nDRAFT REPLY (correct facts, rewrite it to answer exactly what they asked):\n${draft.reply}`;
  return { system, user };
}

export function parseAi(text: string, draft: BotDraft): BotDraft | null {
  const m = /\{[\s\S]*\}/.exec(String(text || ""));
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    const reply = waFormat(String(j.reply || ""));
    if (reply.length < 5 || reply.length > 2500) return null;
    const steps: StepsKind = j.steps === "register" || j.steps === "instagram" ? j.steps : null;
    return { ...draft, reply, steps: steps ?? draft.steps, handoff: !!j.handoff || draft.handoff };
  } catch (_e) { return null; }
}

// screenshots for each walkthrough (uploaded with the site under /assets/help/)
export const STEP_IMAGES: Record<"register" | "instagram", { file: string; hi: string; en: string }[]> = {
  register: [
    { file: "reg-1-number.jpg", hi: "1️⃣ WhatsApp number daalo → Send OTP on WhatsApp", en: "1️⃣ Enter your WhatsApp number → Send OTP on WhatsApp" },
    { file: "reg-2-otp.jpg", hi: "2️⃣ WhatsApp pe aaya 6 digit code daalo", en: "2️⃣ Type the 6-digit code from WhatsApp" },
    { file: "reg-3-instagram.jpg", hi: "3️⃣ Connect Instagram dabao", en: "3️⃣ Tap Connect Instagram" },
    { file: "reg-4-campaign.jpg", hi: "4️⃣ Campaign card — yahan har step ka button hai", en: "4️⃣ Your campaign card — every step has a button here" },
  ],
  instagram: [
    { file: "reg-3-instagram.jpg", hi: "Connect Instagram dabao → Instagram se login → Allow", en: "Tap Connect Instagram → log in to Instagram → Allow" },
  ],
};
