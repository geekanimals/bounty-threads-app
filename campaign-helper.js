// Campaign helper — built into the app (no outside AI, no API key). Answers a creator's question from that
// campaign's own data: brief, video brief, contract, current step, deadline, courier.
// GENERATED from supabase/functions/_shared/campaign_helper_core.ts — edit that file, then rebuild.
(function(){
// Campaign helper — rule-based, no outside AI. Reads one campaign's own data (brief, video brief, contract,
// deadline, courier, stage) and answers the creator's question from it, in Hinglish or English.
// Pure function: (question, campaign row from api.get_my_campaigns, contract from api.get_my_contract) → reply.
const norm = (s) => " " + String(s || "").toLowerCase().replace(/[^\p{L}\p{N}@#\s]/gu, " ").replace(/\s+/g, " ").trim() + " ";
const has = (q, words) => words.some((w) => q.includes(w.startsWith(" ") || w.endsWith(" ") ? w : ` ${w}`) || q.includes(w));
const INTENTS = [
    ["payment", ["payment", "paisa", "paise", "money", "fee", "fees", "pay ", "paid", "amount", "rupee", "₹", "cash", "kitna milega", "kitne milenge", "charges"]],
    ["blocked", ["block", "blacklist", "penalty", "late ho", "miss ", "chhut", "nahi bana", "not able", "can't make", "cannot make", "delay"]],
    ["contract", ["contract", "agreement", "terms", "shart", "condition", "sign"]],
    ["address", ["address", "pata ", "location", "pin code", "pincode"]],
    ["product", ["product", "parcel", "courier", "delivery", "deliver", "track", "tracking", "kab aayega", "kab ayega", "kab milega", "shipping", "dispatch", "ship", "gift", "received", "mila nahi", "nahi mila"]],
    ["deadline", ["deadline", "kab tak", "last date", "due", "kitne din", "how many days", "time limit", "date "]],
    ["about", ["description", "details", "detail", "about the campaign", "about this campaign", "campaign kya hai", "campaign ke bare", "campaign ke baare", "bare mein", "baare mein", "kya hai ye", "what is this campaign", "tell me about", "brief", "requirement", "requirements", "eligibility"]],
    ["video", ["video", "shoot", "kya dikhana", "kya bolna", "content", "script", "reel bana", "idea", "do's", "dos", "dont", "don'ts", "kya karna hai video"]],
    ["submit", ["submit", "drive", "upload", "link bhej", "send video", "bhejna", "kaise bheju", "kaise bhejna"]],
    ["changes", ["changes", "change ", "reject", "approve", "approval", "approved", "review", "naya link", "new link", "redo"]],
    ["post", ["post", "caption", "hashtag", "tag", "mention", "collab", "collaborator", "upload on insta", "instagram pe", "story", "publish"]],
    ["adrights", ["ad rights", "usage", "whitelist", "ads ", "advert", "rights"]],
    ["feedback", ["feedback", "complete", "rating", "khatam", "finish"]],
    ["brand", ["brand kaun", "kaun sa brand", "konsa brand", "which brand", "brand name", "brand ka naam", "company kaun", "which company"]],
    ["human", ["call", "team", "human", "support", "baat kar", "contact", "number", "whatsapp", "help me"]],
    ["next", ["kya karna", "next", "ab kya", "what do i do", "what should i do", "aage", "step", "status", "kaha tak", "kahan tak", "update", "kya hua", "progress"]],
];
const STEP = {
    invited: ["Aapko invite mila hai — campaign padh ke card pe **Accept / Apply** dabao (ya Pass).", "You're invited — read the campaign and tap **Accept / Apply** on the card (or Pass)."],
    applied: ["Aapki application check ho rahi hai — abhi kuch nahi karna, khabar WhatsApp pe aayegi.", "Your application is being checked — nothing to do now; you'll get a WhatsApp when there's news."],
    eligible: ["Aap screening pass kar chuke ho — brand ki list mein ho, abhi kuch nahi karna.", "You passed screening and are on the brand's list — nothing to do yet."],
    shortlisted: ["Aap shortlist ho — brand ke jawab ka intezaar hai.", "You're shortlisted — waiting for the brand."],
    sent_to_brand: ["Aapka profile brand ke paas hai — brand choose kar raha hai.", "Your profile is with the brand — they're choosing."],
    brand_confirmed: ["Aap select ho gaye! 🎉 Contract thodi der mein card pe aa jayega.", "You're selected! 🎉 Your contract appears on the card in a moment."],
    accepted: ["Aapne accept kiya — contract thodi der mein card pe aa jayega.", "You accepted — your contract appears on the card in a moment."],
    contract_sent: ["Contract ready hai — card pe **Read & sign contract** dabao, end tak scroll karo, dono tick lagao aur profile wala naam likho.", "Your contract is ready — tap **Read & sign contract**, scroll to the end, tick both boxes and type your name as on your profile."],
    contract_signed: ["Contract sign ho gaya ✓ — ab card pe **Confirm delivery address** dabao.", "Contract signed ✓ — now tap **Confirm delivery address** on the card."],
    address_confirmed: ["Address confirm ✓ — product pack ho raha hai. Courier aur tracking number card pe aa jayega.", "Address confirmed ✓ — your product is being packed; courier + tracking will show on the card."],
    product_sent: ["Product raste mein hai 🚚 — card pe **Track parcel** se dekho. Milte hi **Received** dabao, tab video brief khulega.", "Your product is on the way 🚚 — use **Track parcel** on the card. When it arrives tap **Received** to open the video brief."],
    content_created: ["Ab video banana hai 🎬 — video brief padho, shoot karo aur **Submit my video** se Google Drive link bhejo. **Abhi Instagram pe post mat karna.**", "Time to make your video 🎬 — read the video brief, shoot, then tap **Submit my video** with a Google Drive link. **Don't post on Instagram yet.**"],
    content_submitted: ["Aapka video brand ke paas review mein hai 👀 — approve hone tak post mat karna.", "Your video is with the brand for review 👀 — don't post until it's approved."],
    changes_requested: ["Brand ne kuch changes maange hain ✏️ — card pe note padho, video theek karke **Submit again** dabao.", "The brand asked for changes ✏️ — read the note on the card, fix the video and tap **Submit again**."],
    content_approved: ["Video approve ho gaya ✅ — card pe **Let's post** dabao. Caption, hashtags, tags aur collaborator pehle se bhare honge — bas approved video chuno aur publish karo.", "Your video is approved ✅ — tap **Let's post**. Caption, hashtags, tags and collaborator are filled in — pick the approved video and publish."],
    published: ["Aapka post live hai 📈 — feedback form aaye toh bhar do, campaign complete ho jayega.", "Your post is live 📈 — if a feedback form shows, fill it to complete the campaign."],
    completed: ["Campaign complete ho gaya 🏁 — thank you! Numbers card pe dikh rahe hain.", "Campaign complete 🏁 — thank you! Your numbers are on the card."],
    rejected: ["Is campaign mein aap aage nahi badhe.", "You didn't continue in this campaign."],
    ineligible: ["Is baar select nahi hue — agle campaign ke liye apply karte raho.", "Not selected this time — keep applying to the next ones."],
    brand_declined: ["Brand ne is baar select nahi kiya.", "The brand didn't select you this time."],
    dropped: ["Aap is campaign se hata diye gaye ho — Geek team se baat karo.", "You were removed from this campaign — please talk to the Geek team."],
};
const fmtDate = (d) => {
    if (!d)
        return null;
    const x = new Date(d);
    return isNaN(+x) ? String(d) : x.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
};
const daysLeft = (d) => {
    if (!d)
        return null;
    const ms = new Date(String(d).slice(0, 10) + "T23:59:59+05:30").getTime() - Date.now();
    return Math.ceil(ms / 86400000);
};
function isHinglish(q) {
    if (/[ऀ-ॿ]/.test(q))
        return true;
    return / (kya|kab|kaise|kaisa|kitna|kitne|hai|hain|mera|mere|mujhe|muje|karna|karu|karun|bhai|nahi|kaha|kahan|aayega|ayega|milega|milenge|milta|paise|paisa|chahiye|bata|batao|samjhao|abhi|kyu|kyun|hoga|hogi|kar|karo|bhejna|bheju|dikhana|bolna|kaun|kitni) /.test(norm(q));
}
function detectIntents(question) {
    const q = norm(question);
    const out = [];
    for (const [k, words] of INTENTS)
        if (has(q, words))
            out.push(k);
    return out;
}
function campaignHelperAnswer(question, c, k) {
    var _a;
    const hi = false;            // answers are always in English (questions can still be typed in Hindi / Hinglish)
    const T = (h, e) => (hi ? h : e);
    let intents = detectIntents(question);
    if (!intents.length) {
        // nothing matched a topic → look for the answer inside this campaign's own brief / video brief / contract
        const hit = briefSearch(question, c, k);
        if (hit.length) {
            const stage0 = String(c.stage || "");
            const nxt = STEP[stage0] ? T(STEP[stage0][0], STEP[stage0][1]) : "";
            return { reply: `**${T("Campaign brief mein likha hai", "From this campaign's brief")}:**\n${hit.map((x) => "• " + x).join("\n")}` + (nxt ? `\n\n**${T("Abhi aapka step", "Your step now")}:** ${nxt}` : ""),
                intents: ["brief_search"], suggestions: suggestionsFor(hi) };
        }
        intents = ["next"];
    }
    // keep the answer short: at most the two most specific topics
    if (intents.includes("about") && intents.includes("video") && c.video_brief)
        intents = intents.filter((x) => x !== "about");
    // "video" is a generic word — when the question is really about submitting, the deadline or posting, answer that
    if (intents.length > 1 && intents.some((x) => ["submit", "deadline", "changes", "blocked", "post"].includes(x)))
        intents = intents.filter((x) => x !== "video");
    intents = intents.filter((x) => !(x === "next" && intents.length > 1)).slice(0, 2);
    const vb = c.video_brief || null;
    const sh = c.shipment || null;
    const stage = String(c.stage || "");
    const step = STEP[stage] ? T(STEP[stage][0], STEP[stage][1]) : T("Abhi ka step card pe dikh raha hai.", "Your current step is shown on the card.");
    const clauses = (k && Array.isArray(k.clauses)) ? k.clauses : [];
    const clause = (key) => clauses.find((x) => x.key === key);
    const tags = [...(c.hashtags || []).map((h) => (String(h).startsWith("#") ? h : "#" + h)),
        ...(c.mentions || []).map((m) => "@" + String(m).replace(/^@/, ""))];
    const deliver = c.deliverables_text || (c.deliverables || []).map((d) => `${d.quantity || 1}× ${d.format}`).join(" + ") || ((k === null || k === void 0 ? void 0 : k.deliverables) || []).map((d) => `${d.quantity || 1}× ${d.format || d.content_format}`).join(" + ");
    const days = (_a = k === null || k === void 0 ? void 0 : k.content_days) !== null && _a !== void 0 ? _a : 7;
    const parts = [];
    for (const it of intents) {
        switch (it) {
            case "next":
                parts.push(`**${T("Ab aapko yeh karna hai", "What to do now")}:** ${step}`);
                if (c.deadline && ["content_created", "changes_requested"].includes(stage)) {
                    const d = daysLeft(c.deadline);
                    parts.push(T(`⏳ Video ki deadline: **${fmtDate(c.deadline)}**${d != null ? ` (${d >= 0 ? d + " din baaki" : "deadline nikal gayi"})` : ""}.`, `⏳ Video due: **${fmtDate(c.deadline)}**${d != null ? ` (${d >= 0 ? d + " days left" : "overdue"})` : ""}.`));
                }
                break;
            case "about": {
                const dates = [c.starts_on, c.ends_on].filter(Boolean).map(fmtDate).join(" → ");
                const l = [
                    `**${c.campaign || T("Campaign", "Campaign")}**${c.brand ? ` · ${c.brand}` : ""}${c.org_name ? ` (${c.org_name})` : ""}`,
                    c.brief ? String(c.brief).slice(0, 900) : "",
                    c.product ? T(`🎁 Product: **${c.product}**${c.product_value ? ` (₹${c.product_value})` : ""}`, `🎁 Product: **${c.product}**${c.product_value ? ` (₹${c.product_value})` : ""}`) : "",
                    deliver ? T(`📦 Banana hai: **${deliver}**`, `📦 Deliverables: **${deliver}**`) : "",
                    tags.length ? T(`#️⃣ Caption mein: ${tags.join(" ")}`, `#️⃣ In your caption: ${tags.join(" ")}`) : "",
                    dates ? T(`📅 Campaign: ${dates}`, `📅 Runs: ${dates}`) : "",
                    c.product_link ? `🔗 ${c.product_link}` : "",
                ].filter(Boolean);
                parts.push(l.join("\n"));
                break;
            }
            case "contract": {
                if (!k) {
                    parts.push(T("Contract abhi bana nahi hai — select hone ke baad card pe aa jayega.", "Your contract isn't issued yet — it appears on the card once you're selected."));
                    break;
                }
                const lines = [
                    deliver ? T(`• Banana hai: **${deliver}**`, `• You make: **${deliver}**`) : "",
                    k.product ? T(`• Badle mein milega: **${k.product}**${k.product_value ? ` (₹${k.product_value})` : ""}`, `• You receive: **${k.product}**${k.product_value ? ` (₹${k.product_value})` : ""}`) : "",
                    T(`• Product milne ke **${days} din** ke andar video bhejna hai`, `• Send your video within **${days} days** of receiving the product`),
                    T("• Brand ke approve karne ke baad hi post karna hai, #ad / Paid partnership ke saath", "• Post only after the brand approves, with #ad / Paid partnership"),
                    k.ad_rights_months ? T(`• Brand aapka content **${k.ad_rights_months} mahine** ads mein use kar sakta hai`, `• The brand may use your content in ads for **${k.ad_rights_months} month(s)**`) : "",
                    clause("non_delivery") ? T("• Product lekar video nahi bheja toh account **block** ho jayega", "• If you take the product and don't send the video, your account is **blocked**") : "",
                    clause("reship") ? T("• Aur product apne kharche pe dusre creator ko bhejna padega", "• And you must send the product on to another creator at your own cost") : "",
                ].filter(Boolean);
                parts.push(`**${T("Contract simple mein", "Your contract, simply")}:**\n${lines.join("\n")}`);
                parts.push(k.signed_at ? T(`✓ Aapne sign kar diya hai (${fmtDate(k.signed_at)}).`, `✓ You signed it on ${fmtDate(k.signed_at)}.`)
                    : T("Sign karne ke liye card pe **Read & sign contract** dabao.", "To sign, tap **Read & sign contract** on the card."));
                break;
            }
            case "video":
                if (!vb) {
                    parts.push(T("Video brief product milne ke baad khulega — product aate hi card pe **Received** dabao.", "The video brief opens after your product arrives — tap **Received** on the card when it does."));
                    if (c.brief)
                        parts.push(`**${T("Campaign brief", "Campaign brief")}:** ${String(c.brief).slice(0, 400)}`);
                }
                else {
                    const l = [
                        vb.what_to_shoot ? `🎬 **${T("Kya shoot karna hai", "What to shoot")}:** ${String(vb.what_to_shoot).slice(0, 500)}` : "",
                        vb.key_messages ? `💬 **${T("Kya bolna/dikhana hai", "Key messages")}:** ${String(vb.key_messages).slice(0, 300)}` : "",
                        vb.dos ? `✅ **Do's:** ${String(vb.dos).slice(0, 250)}` : "",
                        vb.donts ? `🚫 **Don'ts:** ${String(vb.donts).slice(0, 250)}` : "",
                        deliver ? `📦 **${T("Banana hai", "Make")}:** ${deliver}` : "",
                        vb.reference_links ? `🔗 **${T("Reference", "References")}:** ${String(vb.reference_links).slice(0, 200)}` : "",
                    ].filter(Boolean);
                    parts.push(l.length ? l.join("\n") : T("Card pe **Read brief** dabao — poora brief wahan hai.", "Tap **Read brief** on the card — the full brief is there."));
                }
                break;
            case "deadline":
                if (c.deadline) {
                    const d = daysLeft(c.deadline);
                    parts.push(T(`⏳ Video ki deadline **${fmtDate(c.deadline)}** hai${d != null ? ` — ${d >= 0 ? d + " din baaki" : "deadline nikal chuki hai, jaldi bhejo"}` : ""}.`, `⏳ Your video is due **${fmtDate(c.deadline)}**${d != null ? ` — ${d >= 0 ? d + " days left" : "it's overdue, send it soon"}` : ""}.`));
                }
                else if (["invited", "applied", "eligible", "sent_to_brand", "brand_confirmed", "accepted", "contract_sent", "contract_signed", "address_confirmed", "product_sent"].includes(stage)) {
                    parts.push(T(`Deadline product milne ke baad shuru hoti hai — **${days} din** milte hain video bhejne ke liye.`, `The clock starts when your product arrives — you get **${days} days** to send your video.`));
                }
                else
                    parts.push(T("Is step pe koi deadline baaki nahi hai.", "There's no deadline pending at this step."));
                if (c.ends_on)
                    parts.push(T(`Campaign ${fmtDate(c.ends_on)} tak chalega.`, `The campaign runs till ${fmtDate(c.ends_on)}.`));
                break;
            case "product":
                if (!sh) {
                    parts.push(["contract_sent", "contract_signed"].includes(stage)
                        ? T("Product tab bheja jayega jab contract sign aur address confirm ho jaye.", "Your product ships once the contract is signed and your address is confirmed.")
                        : stage === "address_confirmed" ? T("Product pack ho raha hai — courier hote hi tracking number card pe aa jayega.", "Your product is being packed — the tracking number shows on the card once it ships.")
                            : T("Product abhi nahi bheja gaya — select hone ke baad bheja jayega.", "Your product hasn't shipped yet — it ships after selection."));
                }
                else if (sh.status === "delivered" || sh.delivered_at) {
                    parts.push(T(`✅ Product deliver ho chuka hai${sh.delivered_at ? ` (${fmtDate(sh.delivered_at)})` : ""}.`, `✅ Your product was delivered${sh.delivered_at ? ` (${fmtDate(sh.delivered_at)})` : ""}.`));
                    if (stage === "product_sent")
                        parts.push(T("Card pe **Received** dabao — video brief khul jayega.", "Tap **Received** on the card — your video brief opens."));
                }
                else {
                    parts.push(T(`🚚 Product bhej diya gaya hai${sh.shipped_at ? ` (${fmtDate(sh.shipped_at)})` : ""}${sh.courier ? ` — ${sh.courier}` : ""}${sh.tracking_ref ? `, tracking no. **${sh.tracking_ref}**` : ""}. Card pe **Track parcel** dabao. Milte hi **Received** dabana.`, `🚚 Your product has shipped${sh.shipped_at ? ` (${fmtDate(sh.shipped_at)})` : ""}${sh.courier ? ` — ${sh.courier}` : ""}${sh.tracking_ref ? `, tracking no. **${sh.tracking_ref}**` : ""}. Tap **Track parcel** on the card, and **Received** when it arrives.`));
                }
                if (c.product)
                    parts.push(T(`Product: **${c.product}**`, `Product: **${c.product}**`));
                break;
            case "address":
                parts.push(stage === "contract_signed"
                    ? T("Card pe **Confirm delivery address** dabao — saved address chuno, edit karo, naya daalo ya current location use karo.", "Tap **Confirm delivery address** — pick a saved one, edit it, add a new one or use your current location.")
                    : ["address_confirmed", "product_sent"].includes(stage) ? T("Aapka address confirm ho chuka hai. Badalna ho toh jaldi Geek team ko WhatsApp karo — product shayad nikal chuka ho.", "Your address is already confirmed. To change it, message the Geek team quickly — the product may have shipped.")
                        : T("Address contract sign karne ke baad maanga jayega.", "Your address is asked for after you sign the contract."));
                break;
            case "submit":
                parts.push(T("Video ko **Google Drive** pe upload karo → Share → **Anyone with the link → Viewer** → link copy karo → card pe **Submit my video** mein paste karo. Incognito mein khol ke check kar lo ki link khulta hai.", "Upload your video to **Google Drive** → Share → **Anyone with the link → Viewer** → copy the link → paste it in **Submit my video** on the card. Check it opens in an incognito window."));
                if (!["content_created", "changes_requested", "product_sent"].includes(stage))
                    parts.push(T(`(Abhi aapka step: ${step})`, `(Your current step: ${step})`));
                break;
            case "changes": {
                const rv = c.review || null;
                if (stage === "changes_requested" && (rv === null || rv === void 0 ? void 0 : rv.reason))
                    parts.push(T(`Brand ka note: “${String(rv.reason).slice(0, 300)}”. Isse theek karke **Submit again** dabao.`, `The brand's note: “${String(rv.reason).slice(0, 300)}”. Fix it and tap **Submit again**.`));
                else if (stage === "content_submitted")
                    parts.push(T("Video review mein hai — brand approve karega ya changes batayega, aapko WhatsApp pe khabar aayegi.", "Your video is in review — the brand will approve it or ask for changes; you'll get a WhatsApp."));
                else if (stage === "content_approved")
                    parts.push(T("✅ Aapka video approve ho chuka hai — ab **Let's post** dabao.", "✅ Your video is approved — tap **Let's post**."));
                else
                    parts.push(step);
                break;
            }
            case "post":
                if (["content_approved", "published"].includes(stage))
                    parts.push(T("Card pe **Let's post** dabao — caption, hashtags, mentions aur collaborator apne aap bhar jaate hain. Approved video chuno aur publish karo.", "Tap **Let's post** — caption, hashtags, mentions and collaborator fill in on their own. Pick the approved video and publish."));
                else
                    parts.push(T("**Abhi post mat karna** — pehle video submit karo aur brand ka approval aane do.", "**Don't post yet** — submit your video and wait for the brand's approval first."));
                if (tags.length)
                    parts.push(T(`Caption mein zaroor: ${tags.join(" ")} + #ad`, `Must be in your caption: ${tags.join(" ")} + #ad`));
                if (vb === null || vb === void 0 ? void 0 : vb.caption)
                    parts.push(T(`Suggested caption: “${String(vb.caption).slice(0, 200)}”`, `Suggested caption: “${String(vb.caption).slice(0, 200)}”`));
                break;
            case "payment":
                parts.push(String(c.comp_type || "barter") === "barter" || String(c.campaign_type || "").includes("barter")
                    ? T(`Yeh **barter** campaign hai — paise nahi milte; badle mein aapko **${c.product || (k === null || k === void 0 ? void 0 : k.product) || "product"}** milta hai jo post ke baad aapka hai.`, `This is a **barter** campaign — no cash; you get **${c.product || (k === null || k === void 0 ? void 0 : k.product) || "the product"}**, which is yours to keep after posting.`)
                    : T("Payment ki details Geek team aapko alag se batayegi — WhatsApp pe poochh lo.", "The Geek team will share payment details separately — ask them on WhatsApp."));
                break;
            case "blocked":
                if (c.blocked_at)
                    parts.push(T(`⛔ Aapka account block hai (${c.block_reason || "video time pe nahi aaya"}). Abhi **Submit my video** se video bhejo aur Geek team ko WhatsApp karo — call ke baad unblock ho jayega.`, `⛔ Your account is blocked (${c.block_reason || "video not received in time"}). Send your video now with **Submit my video** and message the Geek team — you're unblocked after their call.`));
                else
                    parts.push(T(`Product milne ke **${days} din** ke andar video nahi aaya toh account block ho jata hai aur product apne kharche pe aage bhejna padta hai. Din 2 se reminders aate hain. Late ho raha ho toh pehle hi Geek team ko bata do.`, `If your video doesn't come within **${days} days** of receiving the product, the account is blocked and you must send the product on at your cost. Reminders start on day 2. If you'll be late, tell the Geek team early.`));
                break;
            case "adrights":
                parts.push((k === null || k === void 0 ? void 0 : k.ad_rights_months)
                    ? T(`Brand aapka content **${k.ad_rights_months} mahine** tak ads (whitelisting samet) mein use kar sakta hai${k.collab_rights ? ", aur collab post bhi hoga" : ""}.`, `The brand may use your content in ads (incl. whitelisting) for **${k.ad_rights_months} month(s)**${k.collab_rights ? ", and the post is a collab" : ""}.`)
                    : T("Ad rights contract mein likhe honge — contract khol ke dekho.", "Ad rights are in your contract — open it to check."));
                break;
            case "feedback":
                parts.push(c.feedback_requested_at && !c.feedback_at
                    ? T("Card pe feedback form bharo (stars + 3 sawaal) — submit karte hi campaign complete ho jayega.", "Fill the feedback form on the card (stars + 3 questions) — the campaign completes when you submit.")
                    : c.feedback_at ? T("✓ Aapka feedback mil gaya — thank you!", "✓ We have your feedback — thank you!")
                        : T("Feedback post ke baad maanga jayega.", "Feedback is asked for after you post."));
                break;
            case "brand":
                parts.push(`**${c.brand || "Brand"}**${c.org_name ? T(` (agency: ${c.org_name})`, ` (agency: ${c.org_name})`) : ""} — ${c.campaign || ""}${c.product ? T(`, product: ${c.product}`, `, product: ${c.product}`) : ""}.`);
                if (c.brief)
                    parts.push(String(c.brief).slice(0, 400));
                break;
            case "human":
                parts.push(T("Geek team se baat karne ke liye neeche **talk to the Geek team on WhatsApp** dabao — campaign ka naam apne aap jud jayega.", "To talk to the Geek team, tap **talk to the Geek team on WhatsApp** below — the campaign name is added for you."));
                break;
        }
    }
    if (!parts.length)
        parts.push(`**${T("Ab aapko yeh karna hai", "What to do now")}:** ${step}`);
    return { reply: parts.join("\n\n"), intents, suggestions: suggestionsFor(hi) };
}
function suggestionsFor(hi) {
    return hi
        ? ["Ab mujhe kya karna hai?", "Campaign ki details batao", "Contract simple mein samjhao", "Video mein kya dikhana hai?", "Product kab aayega?", "Deadline kab hai?", "Kaise post karun?"]
        : ["What do I do next?", "Tell me about this campaign", "Explain my contract", "What should my video show?", "When does my product arrive?", "When is the deadline?", "How do I post?"];
}
const STOP = new Set(["the", "and", "for", "with", "this", "that", "what", "when", "where", "which", "have", "will", "from", "your", "about", "there", "their", "then", "than", "into", "kya", "hai", "hain", "mera", "mere", "mujhe", "karna", "kaise", "kab", "kitna", "bhai", "please", "batao", "bata", "campaign", "video", "koi", "kuch", "aur", "yeh", "woh", "nahi", "does", "should", "would", "could", "can", "are", "you", "how", "why", "who"]);
const words = (t) => norm(t).trim().split(" ").filter((w) => w.length > 2 && !STOP.has(w));
// the 1–2 lines of this campaign's own text that best match the question
function briefSearch(question, c, k) {
    const q = new Set(words(question));
    if (!q.size)
        return [];
    const vb = c.video_brief || {};
    const src = [c.brief, vb.what_to_shoot, vb.key_messages, vb.dos && "Do's: " + vb.dos, vb.donts && "Don'ts: " + vb.donts,
        vb.posting_note, vb.caption && "Caption: " + vb.caption, c.deliverables_text,
        ...((k && Array.isArray(k.clauses)) ? k.clauses.map((x) => `${x.title}: ${x.text}`) : [])].filter(Boolean).map(String);
    const lines = src.flatMap((t) => t.replace(/([.!?])\s+/g, "$1\n").split(/\n+/)).map((x) => x.trim()).filter((x) => x.length > 8);
    const scored = lines.map((l) => ({ l, n: words(l).filter((w) => q.has(w) || [...q].some((qw) => qw.length > 4 && (w.startsWith(qw) || qw.startsWith(w)))).length }))
        .filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
    return scored.slice(0, 2).map((x) => x.l.slice(0, 300));
}
window.CampaignHelper = { answer: campaignHelperAnswer, isHinglish: isHinglish, detectIntents: detectIntents };
})();
