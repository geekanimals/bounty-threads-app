/* Bounty creator — the remaining Figma screens, on the app's real data:
   M11 campaign brief as a page · M21 Payments & payouts · M26 profile hub · M27 ☰ header ·
   M30 alerts tabs · M31 avatar menu links. Creator side only (body.bx). */
(function(){
  if(typeof window.renderShell !== "function") return;
  const A = "/assets/bounty/";
  const isCreator = () => typeof currentRole !== "undefined" && currentRole === "creator";
  const H = s => String(s==null?"":s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const INR = n => "₹" + Math.round(+n||0).toLocaleString("en-IN");
  const go = k => { currentPage = k; renderShell(); window.scrollTo(0,0); };
  const api = (fn, a) => sb.schema("api").rpc(fn, a || {}).then(r=> r, e=> ({ error:e }));

  /* ---------- M21 Payments & payouts (new page, creator only) ---------- */
  try{
    if(typeof NAV_META !== "undefined" && !NAV_META.bxpayments) NAV_META.bxpayments = { ic:"💰", label:"Payments" };
    if(typeof ROLES !== "undefined" && ROLES.creator && !ROLES.creator.nav.includes("bxpayments")){
      const i = ROLES.creator.nav.indexOf("mycampaigns"); ROLES.creator.nav.splice(i >= 0 ? i+1 : ROLES.creator.nav.length, 0, "bxpayments");
    }
    if(typeof PAGES !== "undefined" && !PAGES.bxpayments){
      PAGES.bxpayments = () => `<div class="page-head"><div><div class="bx-eyebrow">Your earnings</div><h1>Payments &amp; payouts</h1><p>Know what you've earned, what's pending, and what's paid.</p></div></div><div id="bxPayBody"><div class="muted">Loading your payments…</div></div>`;
    }
  }catch(e){}
  async function loadPayments(){
    const box = document.getElementById("bxPayBody"); if(!box) return;
    const [mine, fl] = await Promise.all([ api("get_my_campaigns"), api("my_campaign_flows") ]);
    if(!box.isConnected) return;
    const list = (mine && !mine.error && Array.isArray(mine.data)) ? mine.data : [], flows = (fl && !fl.error && fl.data) || {};
    const paid = [], rows = [];
    let earned = 0, pending = 0, done = 0, needs = 0;
    list.forEach(c=>{
      const f = flows[c.participation_id] || {}, p = f.payment; if(!f.paid || !p) return;
      const pos = p.payouts || [], sumPaid = pos.filter(o=> o.status === "paid").reduce((s,o)=> s + (+o.amount||0), 0);
      const amt = p.amount != null ? +p.amount : null;
      if(amt != null){ earned += amt; done += sumPaid; pending += Math.max(0, amt - sumPaid); }
      const need = !p.method || ["pending","failed","needs_update"].includes(p.details_status); if(need) needs++;
      const st = sumPaid && amt != null && sumPaid >= amt ? ["Paid","ok"] : pos.some(o=> ["queued","processing"].includes(o.status)) ? ["Payment processing","wait"]
        : need ? ["Add payout details","act"] : ["Awaiting processing","wait"];
      rows.push({ c, amt, sumPaid, st, pos });
    });
    if(!rows.length){
      box.innerHTML = `<div class="card bxg-lock"><img src="${A}sprout_think.png" alt=""><h2>No payments yet</h2><p class="muted">Paid and hybrid campaigns show your fee, payout status and receipts here once you're selected.</p>
        <button type="button" class="btn gold" data-go="opencampaigns">Find paid campaigns ›</button></div>`;
      box.querySelector("[data-go]").onclick = ()=> go("opencampaigns"); return;
    }
    box.innerHTML = `<div class="bx-pay-tiles"><div class="card"><b>${INR(earned)}</b><span>Total earned</span></div><div class="card"><b>${INR(pending)}</b><span>Pending</span></div><div class="card"><b>${INR(done)}</b><span>Paid</span></div></div>
      ${needs ? `<div class="card bx-pay-need"><div><span class="bxg-pill">Action required</span><b>Add payout details to receive approved payments.</b></div><button type="button" class="btn gold" data-go="mycampaigns">Set up ›</button></div>` : ""}
      <div class="bxg-chips bx-pay-f">${[["all","All"],["pending","Pending"],["paid","Paid"]].map(([k,l],i)=>`<button type="button" data-f="${k}" class="${i?"":"on"}">${l}</button>`).join("")}</div>
      <div class="card"><h3>Campaign payments</h3><div id="bxPayRows">${rows.map(r=>`<div class="bx-pay-row" data-s="${r.st[0]==="Paid"?"paid":"pending"}">
        <span class="bxg-ini sm">${H(String(r.c.brand||r.c.campaign||"C").charAt(0).toUpperCase())}</span>
        <div><b>${H(r.c.brand||"")}${r.c.brand?" · ":""}${H(r.c.campaign||"Campaign")}</b><div class="muted">${r.pos.map(o=>`${o.part==="advance"?"Advance":o.part==="balance"?"Balance":"Fee"} ${INR(o.amount)} · ${H(o.status)}`).join(" · ") || "Payout not scheduled yet"}</div></div>
        <div class="bx-pay-amt"><b>${r.amt!=null?INR(r.amt):"—"}</b><span class="bx-st ${r.st[1]}">${r.st[0]}</span></div></div>`).join("")}</div>
        <button type="button" class="btn sm ghost" data-go="mycampaigns" style="margin-top:10px">Open my campaigns for details &amp; receipts ›</button></div>
      <div class="card bx-pay-how"><h3>How payouts work</h3><div class="bx-pay-steps"><span>Verified deliverable</span>›<span>Payment processing</span>›<span>Paid</span></div>
        <div class="muted">Amounts reflect campaign records. Product value is excluded from cash earnings.</div></div>
      <div class="bxg-tip"><img src="${A}sprout_point.png" alt=""><div>I'll help you track every rupee!</div></div>`;
    box.querySelectorAll("[data-go]").forEach(b=> b.onclick = ()=> go(b.dataset.go));
    box.querySelectorAll(".bx-pay-f [data-f]").forEach(b=> b.onclick = ()=>{ box.querySelectorAll(".bx-pay-f button").forEach(x=> x.classList.toggle("on", x===b));
      box.querySelectorAll(".bx-pay-row").forEach(r=> r.style.display = b.dataset.f==="all" || r.dataset.s===b.dataset.f ? "" : "none"); });
  }

  /* ---------- M26 profile hub (top of Creator Profile) ---------- */
  function scrollToSection(rx){
    const h = [...document.querySelectorAll("#content h3, #content .cp-sec-h, #content summary")].find(x=> rx.test(x.textContent));
    if(h){ (h.closest(".card,section,details") || h).scrollIntoView({ behavior:"smooth", block:"start" }); if(h.tagName === "SUMMARY" && h.parentElement && !h.parentElement.open) h.click(); }
  }
  async function touchProfile(){
    const c = document.getElementById("content"); if(!c || c.querySelector("#bxHub")) return;
    const first = c.firstElementChild; if(!first) return;
    const P = (window.Auth && Auth.profile) || {}, req = window.__profileReq;
    let ig = null; try{ const r = await sb.from("social_accounts").select("username,profile_picture_url").eq("platform","instagram").eq("member_id", P.id).limit(3); ig = (r && r.data) || []; }catch(e){ ig = []; }
    if(c.querySelector("#bxHub") || !first.isConnected) return;
    const nm = /^wa_\d+@/.test(P.name||"") ? (ig[0] ? ig[0].username : "Creator") : (P.name || "Creator");
    const L = [["mediakit","My media kit","Portfolio, analytics & sharing"],["#ig","Connected accounts", ig.length ? `Instagram @${ig[0].username}${ig.length>1?" + "+(ig.length-1):""}` : "Connect Instagram"],
      ["#collab","Collaboration preferences","Paid, barter, rates & rights"],["#dream","Dream Brand Board","Brands you'd love to work with"],
      ["bxpayments","Payments & payouts","Earnings, payout details & history"],["messages","Notifications & inbox","Messages and alerts"],
      ["#settings","Settings & privacy","Sidekick, language, theme, text size"],["#help","Help & support","Contact the team or ask Sprout"]];
    first.insertAdjacentHTML("beforebegin", `<div class="card bx-hub" id="bxHub"><div class="bx-hub-id">${ig[0]&&ig[0].profile_picture_url?`<img src="${H(ig[0].profile_picture_url)}" alt="">`:`<span class="bxg-ini">${H(nm.charAt(0).toUpperCase())}</span>`}
        <div><div class="bx-eyebrow">Your space</div><b>${H(nm)}</b>${ig[0]?`<div class="muted">@${H(ig[0].username)}</div>`:""}<div class="bx-hub-tags">${ig.length?`<span class="bxg-match ok">✓ Media kit ready</span>`:""}${req?`<span class="bxg-match">Profile ${Math.round(100*req.done/Math.max(req.total,1))}% complete</span>`:""}</div></div></div>
      <div class="bx-hub-grid">${L.map(([k,t,s])=>`<button type="button" data-hub="${k}"><b>${t}</b><span>${H(s)}</span></button>`).join("")}</div></div>`);
    c.querySelectorAll("[data-hub]").forEach(b=> b.onclick = ()=>{
      const k = b.dataset.hub;
      if(k === "#ig") return scrollToSection(/Instagram accounts/i);
      if(k === "#collab") return scrollToSection(/Barter|Rate|Commercial/i);
      if(k === "#dream") return scrollToSection(/Favourite brands|Dream/i);
      if(k === "#settings") return go("bxsettings");
      if(k === "#help") return window.open("/contact.html", "_blank", "noopener");
      go(k);
    });
  }

  /* ---------- M11 campaign brief: the app's brief opens as a page, not a pop-up ---------- */
  function touchBrief(pop){
    if(!document.body.classList.contains("bx") || pop.dataset.bx) return; pop.dataset.bx = 1;
    pop.classList.add("bx-brief"); document.body.style.overflow = "";
    const box = pop.querySelector(".ci-pop-box"), head = pop.querySelector(".ci-pop-head"); if(!box || !head) return;
    const title = (head.querySelector("h3")||{}).textContent || "", brand = (head.querySelector(".muted")||{}).textContent || "";
    head.insertAdjacentHTML("beforebegin", `<button type="button" class="bxg-back bx-brief-back">‹ Back to campaigns</button><div class="bxg-cover bx-brief-cover"><span class="bxg-ini">${H((brand||title||"B").trim().charAt(0).toUpperCase())}</span></div>`);
    const foot = pop.querySelector(".ci-pop-foot");
    if(foot){
      foot.insertAdjacentHTML("beforebegin", `<div class="bx-journey"><div class="bx-eyebrow">Campaign journey</div><div class="bx-j-steps">${["Apply","Brand review","Accept terms","Create & submit","Get paid"].map((s,i)=>`<span><b>${i+1}</b>${s}</span>`).join("")}</div></div>
        <div class="bx-brief-note">Applying expresses interest only. You are not accepting the campaign or its terms. No commitment until you review and accept an agreement.</div>`);
      const cl = pop.querySelector("#ciPopClose"); if(cl) cl.textContent = "‹ Back";
    }
    pop.querySelector(".bx-brief-back").onclick = ()=> { const x = document.getElementById("ciPopX"); if(x) x.click(); };
    pop.scrollTop = 0;
  }

  /* ---------- M30 alerts: All · Action needed · Updates ---------- */
  function touchAlerts(){ tabsFor(document.getElementById("notifBody")); }
  function tabsFor(body){
    if(!body || body.querySelector(".bx-al-tabs")) return;
    const rows = [...body.querySelectorAll(".ops-alert")]; if(!rows.length) return;
    const act = rows.filter(r=> r.classList.contains("act") || r.querySelector("[data-act]"));
    body.insertAdjacentHTML("afterbegin", `<div class="bxg-chips bx-al-tabs"><button type="button" data-t="all" class="on">All</button><button type="button" data-t="act">Action needed ${act.length}</button><button type="button" data-t="upd">Updates</button></div>`);
    body.querySelectorAll(".bx-al-tabs button").forEach(b=> b.onclick = ()=>{ body.querySelectorAll(".bx-al-tabs button").forEach(x=> x.classList.toggle("on", x===b));
      rows.forEach(r=>{ const a = act.includes(r); r.style.display = b.dataset.t==="all" || (b.dataset.t==="act" && a) || (b.dataset.t==="upd" && !a) ? "" : "none"; }); });
    if(!body.querySelector(".bx-al-foot")) body.insertAdjacentHTML("beforeend", `<div class="bx-al-foot muted">Campaign alerts are separate from optional tips. Change them in Settings.</div>`);
  }

  /* ---------- M31 avatar menu: media kit + help (Settings & sidekick comes from bounty-kid.js) ---------- */
  function touchMe(){
    const mc = document.getElementById("meCard"), out = document.getElementById("meOut");
    if(!mc || !out || mc.querySelector(".bx-me-more") || !document.body.classList.contains("bx")) return;
    out.insertAdjacentHTML("beforebegin", `<div class="bx-me-more"><button type="button" data-m="mediakit">View my media kit</button><button type="button" data-m="bxpayments">Payments</button><button type="button" data-m="help">Help &amp; support</button></div>`);
    mc.querySelectorAll(".bx-me-more [data-m]").forEach(b=> b.onclick = ()=>{ const x = document.getElementById("meX"); if(x) x.click();
      if(b.dataset.m === "help") return window.open("/contact.html", "_blank", "noopener"); go(b.dataset.m); });
  }

  /* ---------- M27 ☰ drawer header (phone): who's signed in ---------- */
  async function touchDrawer(){
    const sb_ = document.getElementById("sidebar"); if(!sb_ || sb_.querySelector(".bx-dr-me") || !isCreator()) return;
    const brand = sb_.querySelector(".brand"); if(!brand) return;
    const P = (window.Auth && Auth.profile) || {};
    let ig = null; try{ const r = await sb.from("social_accounts").select("username,profile_picture_url").eq("platform","instagram").eq("member_id", P.id).limit(1); ig = r && r.data && r.data[0]; }catch(e){}
    if(sb_.querySelector(".bx-dr-me")) return;
    const nm = /^wa_\d+@/.test(P.name||"") ? (ig ? ig.username : "Creator") : (P.name || "Creator");
    brand.insertAdjacentHTML("afterend", `<div class="bx-dr-me">${ig&&ig.profile_picture_url?`<img src="${H(ig.profile_picture_url)}" alt="">`:`<span class="bxg-ini sm">${H(nm.charAt(0).toUpperCase())}</span>`}<div><b>${H(nm)}</b>${ig?`<span>@${H(ig.username)}</span>`:""}</div></div>`);
  }

  /* ---------- M25 Analytics · creator pulse: trend chart + top content you can pin to your media kit ---------- */
  async function touchAnalytics(){
    const box = document.getElementById("crBody"); if(!box || box.querySelector("#bxPulse") || !box.querySelector(".rp-kpis")) return;
    const a = (typeof mkFetchAcct === "function") ? await mkFetchAcct() : null; if(!a || box.querySelector("#bxPulse")) return;
    const media = (typeof mkAllMedia === "function" ? mkAllMedia(a) : (a.recent_media||[])).filter(m=> m.timestamp);
    const E = (typeof mkEdits === "function") ? mkEdits(a) : (a.edits || {});
    let pins = Array.isArray(E.pinned) ? E.pinned.map(String) : [];
    const pts = media.slice(0, 12).reverse();
    const L = pts.map(m=> +m.like_count||0), C = pts.map(m=> +m.comments_count||0), max = Math.max(1, ...L, ...C);
    const W = 640, Hh = 180, P = 24, x = i => P + (pts.length < 2 ? 0 : i * (W - 2*P) / (pts.length - 1)), y = v => Hh - P - v * (Hh - 2*P) / max;
    const line = arr => arr.map((v,i)=> `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    const aud = a.audience || {}, top = o => { const e = Object.entries(o||{}).sort((p,q)=> q[1]-p[1])[0]; return e ? e[0] : null; };
    const topCity = top(aud.city), topGA = top(aud.gender_age);
    const eng = m => (+m.like_count||0) + (+m.comments_count||0);
    const best = media.slice().sort((p,q)=> eng(q) - eng(p)).slice(0, 6);
    const img = m => m.media_type === "VIDEO" ? (m.thumbnail_url||m.media_url) : m.media_url;
    box.insertAdjacentHTML("afterbegin", `<div id="bxPulse">
      <div class="card"><h3>Performance over time <span class="muted">· your last ${pts.length} posts</span></h3>
        ${pts.length > 1 ? `<svg viewBox="0 0 ${W} ${Hh}" class="bx-chart" role="img" aria-label="Likes and comments per post">
          <polyline points="${line(L)}" fill="none" stroke="#174A34" stroke-width="3" stroke-linejoin="round"/>
          <polyline points="${line(C)}" fill="none" stroke="#D3A94E" stroke-width="3" stroke-linejoin="round"/>
          ${pts.map((m,i)=>`<circle cx="${x(i)}" cy="${y(L[i])}" r="3.5" fill="#174A34"><title>${new Date(m.timestamp).toLocaleDateString("en-IN",{day:"numeric",month:"short"})}: ${L[i]} likes, ${C[i]} comments</title></circle>`).join("")}
        </svg><div class="bx-legend"><span class="l1">Likes</span><span class="l2">Comments</span></div>` : `<div class="muted">The chart appears after a couple of posts sync from Instagram.</div>`}</div>
      ${(topCity||topGA) ? `<div class="card bx-ins"><h3>Account insights <span class="muted">· from Instagram</span></h3><div class="bx-ins-g">${topGA?`<div><span>Top audience</span><b>${H(topGA.replace(/^F\./,"Women ").replace(/^M\./,"Men "))}</b></div>`:""}${topCity?`<div><span>Top city</span><b>${H(String(topCity).split(",")[0])}</b></div>`:""}</div></div>` : ""}
      ${best.length ? `<div class="card"><h3>Your top content <span class="muted">· pin up to 6 to your media kit</span></h3><div class="bx-top">${best.map(m=>`<div class="bx-top-i"><a href="${H(m.permalink||"#")}" target="_blank" rel="noopener"><img src="${H(img(m))}" alt="" loading="lazy"></a>
          <div class="muted">❤ ${eng(m)}</div><button type="button" class="btn sm ${pins.includes(String(m.id))?"":"ghost"}" data-pin="${H(m.id)}">${pins.includes(String(m.id))?"📌 Pinned":"Pin to media kit"}</button></div>`).join("")}</div></div>` : ""}
      <div class="bxg-tip"><img src="${A}sprout_point.png" alt=""><div>Tip: pin the posts that did best — brands see them first in your media kit.</div></div></div>`);
    box.querySelectorAll("[data-pin]").forEach(b=> b.onclick = async ()=>{
      const id = b.dataset.pin, on = pins.includes(id);
      if(!on && pins.length >= 6){ if(typeof gateToast==="function") gateToast("You can pin up to 6 — unpin one in Media kit → Edit."); return; }
      const next = on ? pins.filter(p=> p !== id) : pins.concat(id);
      b.disabled = true;
      const { error } = await sb.from("social_accounts").update({ edits: Object.assign({}, a.edits || {}, { pinned: next }), updated_at: new Date().toISOString() }).eq("id", a.id);
      b.disabled = false;
      if(error){ if(typeof gateToast==="function") gateToast("Couldn't pin: " + error.message); return; }
      pins = next; a.edits = Object.assign({}, a.edits || {}, { pinned: next });
      b.textContent = on ? "Pin to media kit" : "📌 Pinned"; b.classList.toggle("ghost", on);
    });
  }

  /* ---------- M22 Inbox: campaign updates at the top of Messages (same alerts, actions and "Mark all read") ---------- */
  function touchInbox(){
    const c = document.getElementById("content"); if(!c || c.querySelector("#bxInbox") || !(window.ciOps && ciOps.loadAlerts)) return;
    const first = c.firstElementChild; if(!first) return;
    first.insertAdjacentHTML("beforebegin", `<div class="card bx-inbox" id="bxInbox"><div class="bx-eyebrow">Your creator command centre</div><h3>Inbox</h3><div id="bxInboxBody"><div class="muted">Loading…</div></div></div>`);
    ciOps.loadAlerts(document.getElementById("bxInboxBody")).then(()=> tabsFor(document.getElementById("bxInboxBody")));
  }

  /* ---------- M32 Settings & privacy (new page) ---------- */
  try{
    if(typeof NAV_META !== "undefined" && !NAV_META.bxsettings) NAV_META.bxsettings = { ic:"⚙", label:"Settings" };
    if(typeof ROLES !== "undefined" && ROLES.creator && !ROLES.creator.nav.includes("bxsettings")) ROLES.creator.nav.push("bxsettings");
    if(typeof PAGES !== "undefined" && !PAGES.bxsettings) PAGES.bxsettings = () => `<div class="page-head"><div><div class="bx-eyebrow">Make Bounty yours</div><h1>Settings &amp; privacy</h1><p>Your space. Your choices.</p></div></div><div id="bxSetBody"><div class="muted">Loading…</div></div>`;
    if(typeof GATE_OPEN_PAGES !== "undefined" && !GATE_OPEN_PAGES.includes("bxsettings")) GATE_OPEN_PAGES.push("bxsettings");
  }catch(e){}
  async function loadSettings(){
    const box = document.getElementById("bxSetBody"); if(!box) return;
    const P = (window.Auth && Auth.profile) || {};
    const [pr, ig] = await Promise.all([ sb.rpc("my_notify_prefs").then(r=> r, e=> ({ error:e })), sb.from("social_accounts").select("id,username").eq("platform","instagram").eq("member_id", P.id).then(r=> r, e=> ({ error:e })) ]);
    if(!box.isConnected) return;
    const n = (pr && !pr.error && pr.data) || {}, accts = (ig && !ig.error && ig.data) || [];
    const k = window.bxKid ? bxKid.prefs() : {}, kid = window.bxKid ? bxKid.kids[k.kid] || bxKid.kids.sprout : { n:"Sprout", img:A+"sprout_wave.png" };
    box.innerHTML = `<div class="bx-set-grid">
      <div class="card"><h3>Your sidekick</h3><div class="bx-set-kid"><img src="${kid.img}" alt=""><div><b>${H(window.bxKid ? bxKid.name() : "Sprout")}</b><div class="muted">Vibe: ${H(k.vibe||"playful")} · Scene: ${H(k.scene||"auto")} · Text size: ${H(({s:"small",m:"default",l:"large"})[k.size]||"default")}</div></div></div>
        <button type="button" class="btn" data-s="kid">Change sidekick, language, scene, text size ›</button></div>
      <div class="card"><h3>Notifications</h3><div class="muted" style="margin-bottom:8px">Campaign alerts (deadlines, selections, payments). Login and recovery codes always arrive.</div>
        <label class="bx-sw"><span><b>WhatsApp campaign alerts</b><em>${n.whatsapp_linked ? (n.whatsapp_off ? "Off — only login codes" : "On") : "Link WhatsApp to get updates"}</em></span><input type="checkbox" id="bxSetWa"${n.whatsapp_linked && !n.whatsapp_off ? " checked" : ""}${n.whatsapp_linked ? "" : " disabled"}></label>
        <label class="bx-sw"><span><b>Email campaign alerts</b><em>${n.email_off ? "Off — only recovery codes" : "On"}</em></span><input type="checkbox" id="bxSetEm"${!n.email_off ? " checked" : ""}></label>
        <label class="bx-sw"><span><b>Optional tips from ${H(window.bxKid ? bxKid.name() : "Sprout")}</b><em>${k.vibe==="focused" ? "Off (Focused vibe)" : "On"}</em></span><input type="checkbox" id="bxSetTips"${k.vibe==="focused" ? "" : " checked"}></label></div>
      <div class="card"><h3>Privacy &amp; connected accounts</h3>
        ${accts.length ? accts.map(x=>`<div class="bx-set-acct"><span>@${H(x.username)} · <b class="ok">Connected</b></span><button type="button" class="btn sm ghost" data-s="manage">Manage</button></div>`).join("") : `<div class="muted">No Instagram connected.</div><button type="button" class="btn sm" data-s="connect">Connect Instagram</button>`}
        <div class="muted" style="margin-top:8px">Disconnecting Instagram may limit available insights — you can do it from Profile → Your Instagram accounts.</div></div>
      <div class="card"><h3>Your data</h3>
        <button type="button" class="btn ghost" data-s="download">⬇ Download my data</button>
        <div class="muted" style="margin:8px 0 14px">A JSON file with your profile, Instagram accounts and campaigns.</div>
        <button type="button" class="btn bx-danger" data-s="delete">Delete my account</button>
        <div class="muted" style="margin-top:8px">Deleting your account always asks for a final confirmation.</div>
        <div id="bxDel"></div></div></div>`;
    box.querySelector('[data-s="kid"]').onclick = ()=> window.bxKid && bxKid.sheet();
    const m = box.querySelector('[data-s="manage"]'); if(m) box.querySelectorAll('[data-s="manage"]').forEach(b=> b.onclick = ()=> go("profile"));
    const cn = box.querySelector('[data-s="connect"]'); if(cn) cn.onclick = ()=> typeof connectInstagram === "function" && connectInstagram();
    const wa = document.getElementById("bxSetWa"), em = document.getElementById("bxSetEm"), tp = document.getElementById("bxSetTips");
    if(wa) wa.onchange = async ()=>{ wa.disabled = true; const { error } = await sb.rpc("wa_set_opt_out", { p_opt_out: !wa.checked }); if(error && typeof gateToast==="function") gateToast(error.message); loadSettings(); };
    if(em) em.onchange = async ()=>{ em.disabled = true; const { error } = await sb.rpc("set_email_updates", { p_on: em.checked }); if(error && typeof gateToast==="function") gateToast(error.message); loadSettings(); };
    if(tp) tp.onchange = async ()=>{ if(window.bxKid){ await bxKid.save({ vibe: tp.checked ? "playful" : "focused" }); loadSettings(); } };
    box.querySelector('[data-s="download"]').onclick = async e=>{
      const b = e.currentTarget; b.disabled = true; b.textContent = "Preparing…";
      const [pf, sa, mc] = await Promise.all([ api("get_my_profile"), sb.from("social_accounts").select("username,name,followers_count,media_count,biography,website,updated_at,edits").eq("member_id", P.id).then(r=> r, e=> ({ error:e })), api("get_my_campaigns") ]);
      const out = { exported_at: new Date().toISOString(), account: { name: P.name, role: P.role }, profile: pf && pf.data || null, instagram: sa && sa.data || [], campaigns: mc && mc.data || [], sidekick: window.bxKid ? bxKid.prefs() : null };
      const l = document.createElement("a"); l.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type:"application/json" })); l.download = "my-bounty-data.json"; l.click();
      b.disabled = false; b.textContent = "⬇ Download my data";
    };
    box.querySelector('[data-s="delete"]').onclick = ()=>{
      const d = document.getElementById("bxDel");
      d.innerHTML = `<div class="bx-del"><b>This permanently deletes your login, profile, Instagram connection, campaign history and messages.</b> It can't be undone.
        <label>Type <b>DELETE</b> to confirm<input id="bxDelIn" autocomplete="off"></label><div class="bxg-btns"><button type="button" class="btn bx-danger" id="bxDelGo" disabled>Delete my account forever</button><button type="button" class="btn ghost" id="bxDelNo">Keep my account</button></div><div class="auth-err" id="bxDelErr"></div></div>`;
      const i = document.getElementById("bxDelIn"), g = document.getElementById("bxDelGo");
      i.oninput = ()=> g.disabled = i.value.trim() !== "DELETE";
      document.getElementById("bxDelNo").onclick = ()=> d.innerHTML = "";
      g.onclick = async ()=>{ g.disabled = true; g.textContent = "Deleting…";
        const { error } = await sb.rpc("creator_delete_me", { p_confirm: i.value.trim() });
        if(error){ document.getElementById("bxDelErr").textContent = "Couldn't delete: " + error.message; g.disabled = false; g.textContent = "Delete my account forever"; return; }
        try{ Object.keys(localStorage).filter(x=> /^bx_|geek_apply|ci_ob_/.test(x)).forEach(x=> localStorage.removeItem(x)); }catch(e){}
        try{ await sb.auth.signOut({ scope:"local" }); }catch(e){}
        location.href = "/app.html";
      };
    };
  }

  /* ---------- wire ---------- */
  const _rs = window.renderShell;
  window.renderShell = function(){
    const r = _rs.apply(this, arguments);
    if(isCreator()){
      if(currentPage === "bxpayments") loadPayments();
      if(currentPage === "bxsettings") loadSettings();
      if(currentPage === "profile") setTimeout(touchProfile, 400);
      touchDrawer();
    }
    return r;
  };

  /* ---- M12–M20 campaign steps: each "what now" card becomes a Bounty step screen
     (sidekick pose, step x of n, celebration on approve / done). Same buttons, same actions. ---- */
  const STEP_ART = { "Applied":["think","Application sent"], "Selected":["celebrate","You're in!"], "Contract":["clipboard","Agreement"],
    "Signed":["point","Delivery address"], "Address":["envelope","Package on its way"], "Shipped":["envelope","Package on its way"],
    "Delivered":["point","Time to create"], "Brief":["point","Create your draft"], "Video sent":["think","Brand is reviewing"],
    "Approved":["celebrate","Approved — go live"], "Posted":["wave","You're live"], "Done":["celebrate","Campaign complete"] };
  const hx = t => String(t||"").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  function touchSteps(){
    document.querySelectorAll(".mc-card").forEach(card => {
      const now = card.querySelector(".jr-now"); if(!now || now.dataset.bx) return;
      const steps = [...card.querySelectorAll(".jr-step")]; if(!steps.length) return;
      let i = steps.findIndex(x => x.classList.contains("now")); const allDone = i < 0;
      if(allDone) i = steps.length - 1;
      const label = (steps[i].querySelector("span")||{}).textContent || "";
      const art = STEP_ART[allDone ? "Done" : label] || ["point", label];
      now.dataset.bx = "1"; now.classList.add("bx-step");
      const top = document.createElement("div"); top.className = "bx-step-top";
      top.innerHTML = `<img src="${A}sprout_${art[0]}.png" alt=""><div class="bx-step-m"><span class="bx-step-n">Step ${i+1} of ${steps.length} · ${hx(art[1])}</span>
        <div class="bx-step-bar"><i style="width:${Math.round((allDone?steps.length:i+1)/steps.length*100)}%"></i></div></div>`;
      now.insertBefore(top, now.firstChild);
      // 🎉 one-time celebration when the brand selects / approves / the campaign completes (inline, no pop-up)
      if(art[0] === "celebrate"){
        const ask = card.querySelector("[data-askai]"); const pid = ask ? ask.getAttribute("data-askai") : (card.querySelector("h4")||{}).textContent;
        const key = "bx_cele_" + pid + "_" + (allDone ? "done" : label);
        let seen = false; try{ seen = !!localStorage.getItem(key); localStorage.setItem(key, "1"); }catch(e){}
        if(!seen){ const c = document.createElement("div"); c.className = "bx-confetti";
          c.innerHTML = Array.from({length:18}, (_, k) => `<i style="left:${4+k*5.3}%;animation-delay:${(k%6)*0.12}s;background:${["#F5B83D","#103B2A","#E8664A","#7BC47F"][k%4]}"></i>`).join("");
          now.appendChild(c); setTimeout(() => c.remove(), 2600); }
      }
    });
  }
  let q = false;
  new MutationObserver(()=>{ if(q) return; q = true; requestAnimationFrame(()=>{ q = false;
    const pop = document.getElementById("ciPop"); if(pop && !pop.dataset.bx) touchBrief(pop);
    touchAlerts(); touchMe();
    if(isCreator() && currentPage === "profile" && !document.getElementById("bxHub")) touchProfile();
    if(isCreator() && currentPage === "reports") touchAnalytics();
    if(isCreator() && currentPage === "messages") touchInbox();
    if(isCreator()) touchSteps();
  }); }).observe(document.body, { childList:true, subtree:true });
  // nav label + icon for the new page (bounty-creator.js names the rest)
  window.__bxExtraNav = { bxpayments:["Payments","coins"], bxsettings:["Settings","gear"] };
})();
