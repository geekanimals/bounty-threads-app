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
  const KN = () => (window.bxKid ? bxKid.name() : "Pip");
  const KI = () => (window.bxKid ? bxKid.img() : A + "rd/kid_pip.png");
  const TIP = t => window.B2 ? B2.tip(t) : "";
  const HEAD = (eb, h, p) => `<div class="b2-ph"><div class="b2-eyebrow">${eb}</div><h1 class="b2-h1">${h}</h1><p class="b2-sub">${p}</p></div>`;

  /* ---------- M21 Payments & payouts (new page, creator only) ---------- */
  try{
    if(typeof NAV_META !== "undefined" && !NAV_META.bxpayments) NAV_META.bxpayments = { ic:"💰", label:"Payments" };
    if(typeof ROLES !== "undefined" && ROLES.creator && !ROLES.creator.nav.includes("bxpayments")){
      const i = ROLES.creator.nav.indexOf("mycampaigns"); ROLES.creator.nav.splice(i >= 0 ? i+1 : ROLES.creator.nav.length, 0, "bxpayments");
    }
    if(typeof PAGES !== "undefined" && !PAGES.bxpayments){
      PAGES.bxpayments = () => `<div class="b2 b2-page b2-pay">${HEAD("Your earnings","Payments &amp; rewards","Every rupee and every product, in one place.")}<div id="bxPayBody"><div class="b2-skel">Loading your payments…</div></div></div>`;
    }
  }catch(e){}
  async function loadPayments(){
    const box = document.getElementById("bxPayBody"); if(!box) return;
    const [mine, fl] = await Promise.all([ api("get_my_campaigns"), api("my_campaign_flows") ]);
    if(!box.isConnected) return;
    const list = (mine && !mine.error && Array.isArray(mine.data)) ? mine.data : [], flows = (fl && !fl.error && fl.data) || {};
    const rows = []; let earned = 0, pending = 0, done = 0, needs = 0;
    const GOT = ["product_sent","content_created","changes_requested","content_submitted","content_approved","published","completed","brand_confirmed"];
    const prods = list.filter(c=> c.product_value && GOT.includes(c.stage) && (c.campaign_type||"") !== "paid");
    const prodVal = prods.reduce((s,c)=> s + (+c.product_value||0), 0);
    list.forEach(c=>{
      const f = flows[c.participation_id] || {}, p = f.payment;
      if(f.paid && p){
        const pos = p.payouts || [], sumPaid = pos.filter(o=> o.status === "paid").reduce((s,o)=> s + (+o.amount||0), 0);
        const amt = p.amount != null ? +p.amount : null;
        if(amt != null){ earned += sumPaid; done += sumPaid; pending += Math.max(0, amt - sumPaid); }
        const need = !p.method || ["pending","failed","needs_update"].includes(p.details_status); if(need) needs++;
        pos.forEach(o=> rows.push({ c, amt:+o.amount||0, sub: (o.part==="advance"?"advance":o.part==="balance"?"after post":"fee"), st: o.status==="paid" ? ["Paid","teal"] : ["queued","processing"].includes(o.status) ? ["Pending","orange"] : ["Waiting for post","ink"] }));
        if(!pos.length) rows.push({ c, amt:amt||0, sub: need ? "add payout details" : "after post", st: need ? ["Action needed","red"] : ["Waiting for post","ink"] });
      }
    });
    prods.forEach(c=> rows.push({ c, prod:true, amt:+c.product_value||0, sub:"Product", st:["Delivered","teal"] }));
    box.innerHTML = `<div class="b2-earn"><div class="b2-ek">Earned so far</div><b>${INR(earned)}</b><span>${prods.length ? `+ ${prods.length} product${prods.length>1?"s":""} worth ${INR(prodVal)}` : "Paid and hybrid campaigns add up here"}</span></div>
      <div class="b2-3t"><div><b>${INR(done)}</b><span class="t">Paid</span></div><div><b>${INR(pending)}</b><span class="o">Pending</span></div><div><b>${prods.length}</b><span>Products</span></div></div>
      <div class="b2-sec ink">— Payouts —</div>
      <div class="b2-list">${rows.length ? rows.map(r=>`<div class="b2-lrow"><div><b>${H(r.c.campaign||"Campaign")}${r.c.brand?" · "+H(r.c.brand):""}</b><span>${r.prod?"Product ":""}${INR(r.amt)} · ${H(r.sub)}</span></div><em class="b2-chip2 ${r.st[1]}">${r.st[0]}</em></div>`).join("")
        : `<div class="b2-lrow empty">No payouts yet — paid and barter campaigns show up here once you're selected.</div>`}</div>
      <div class="b2-bank"><span>🏦</span><div><b>Add your bank / UPI details</b><p>Must be in your own name. Only you and the Geek team see it.</p></div><button type="button" class="b2-mini forest" data-go="mycampaigns">${needs?"Add":"Manage"}</button></div>
      ${TIP("I'll help you track every rupee!")}`;
    box.querySelectorAll("[data-go]").forEach(b=> b.onclick = ()=> go(b.dataset.go));
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
    let pf = null; if(window.__ciProfileEnabled){ const r = await api("get_my_profile"); if(!r.error) pf = r.data; }
    if(c.querySelector("#bxHub") || !first.isConnected) return;
    const md = (window.__bxMeta && __bxMeta.bx_manual) || {};
    const nm = /^wa_\d+@/.test(P.name||"") ? (ig[0] ? ig[0].username : "Creator") : (P.name || "Creator");
    const pro = (pf && pf.professional) || {}, per = (pf && pf.personal) || {}, cp = (pf && pf.commercial_preference) || {};
    const handle = ig[0] ? "@" + ig[0].username : (md.ig_handle || "");
    const pct = req ? Math.round(100*req.done/Math.max(req.total,1)) : null;
    const dreams = ((pf && pf.dream_brands) || []).map(x=> x.submitted_brand_name).filter(Boolean);
    const terms = (pf && pf.commercial_preference && Object.keys(cp).length) ? [cp.accepts_barter?"Barter":"", cp.product_only?"":"Paid"].filter(Boolean).join(", ") : "";
    const L = [["👤","About you","Name, birthday, gender, city","#about"],["🎬","What you create",[(pro.categories||[]).slice(0,2).join(", "),(pro.content_formats||[]).slice(0,2).join(", "),(pro.languages||[]).slice(0,2).join(", ")].filter(Boolean).join(" · ") || "Categories, formats, languages","#create"],
      ["💙","Dream brands", dreams.slice(0,3).join(", ") || "Brands you'd love to work with","#dream"],["🤝","Your terms", terms || "Barter, paid, rates","#collab"],
      ["📍","Addresses", ((pf && pf.addresses)||[]).map(a=> a.label).filter(Boolean).join(" · ") || "Where brands send your kit","#addr"],
      ["📸","Instagram accounts", ig.length ? ig.map(x=>"@"+x.username).join(", ") : "Connect Instagram","#ig"],["🗂","My media kit","Portfolio, analytics & sharing","mediakit"],
      ["🪙","Payments & rewards","Earnings and payout details","bxpayments"],["⚙︎","Settings & privacy","Notifications, data, sidekick","bxsettings"]];
    const useKid = window.bxKid && bxKid.prefs().avatar;
    first.insertAdjacentHTML("beforebegin", `<div class="b2 b2-hub" id="bxHub">
      <div class="b2-bigav">${useKid?`<img src="${KI()}" data-kid-me alt="">`:H(nm.charAt(0).toUpperCase())}</div>
      <h1 class="b2-hubn">${H(nm)}</h1><div class="b2-hubh">${H([handle, pro.city_coarse || md.city].filter(Boolean).join(" · "))}${md.ig_handle && !ig.length ? ` <em class="b2-sr">self-reported</em>` : ""}</div>
      <label class="b2-card b2-tog wide"><span>Use ${H(KN())} as my profile picture</span><input type="checkbox" id="bxHubKid"${useKid?" checked":""}><i></i></label>
      ${pct!=null?`<div class="b2-card b2-pct"><b>Profile ${pct}% complete</b><div class="b2-bar2"><i style="width:${pct}%"></i></div></div>`:""}
      <div class="b2-rows">${L.map(([ic,t,sub,k])=>`<button type="button" class="b2-card b2-row" data-hub="${k}"><span class="ic">${ic}</span><span class="tx"><b>${t}</b><em>${H(sub)}</em></span><i>›</i></button>`).join("")}</div>
      ${TIP("Fill what helps brands match you — private fields stay private.")}</div>`);
    const kidT = document.getElementById("bxHubKid"); if(kidT) kidT.onchange = async ()=>{ if(window.bxKid){ await bxKid.save({ avatar: kidT.checked }); const h = document.getElementById("bxHub"); if(h) h.remove(); touchProfile(); } };
    c.querySelectorAll("[data-hub]").forEach(b=> b.onclick = ()=>{
      const k = b.dataset.hub;
      if(k === "#ig") return scrollToSection(/Instagram accounts/i);
      if(k === "#collab") return scrollToSection(/Barter|Rate|Commercial|terms/i);
      if(k === "#dream") return scrollToSection(/Favourite brands|Dream/i);
      if(k === "#about") return scrollToSection(/About you|Personal|Basic/i);
      if(k === "#create") return scrollToSection(/What you create|Categor|Professional|content/i);
      if(k === "#addr") return scrollToSection(/Address/i);
      go(k);
    });
  }

  /* ---------- M11 campaign brief: the app's brief opens as a page, not a pop-up ---------- */
  function touchBrief(pop){
    if(!document.body.classList.contains("bx") || pop.dataset.bx) return; pop.dataset.bx = 1;
    pop.classList.add("bx-brief"); document.body.style.overflow = "";
    const box = pop.querySelector(".ci-pop-box"), head = pop.querySelector(".ci-pop-head"); if(!box || !head) return;
    const title = (head.querySelector("h3")||{}).textContent || "", brand = (head.querySelector(".muted")||{}).textContent || "";
    const hit = window.B2 && (B2.openList||[]).find(x=> String(x.name||"").trim() === String(title).trim());
    const ph = window.B2 ? B2.camPhoto(hit || { name:title, brand }) : "";
    head.insertAdjacentHTML("beforebegin", `<button type="button" class="b2-back bx-brief-back">← Back to campaigns</button><div class="b2-bhero bx-brief-cover">${ph?`<img src="${ph}" alt="">`:""}</div>`);
    const foot = pop.querySelector(".ci-pop-foot");
    if(foot){
      foot.insertAdjacentHTML("beforebegin", `<div class="b2-steps5"><div><i>✎</i><span>Apply</span></div><div><i>✓</i><span>Get selected</span></div><div><i>📦</i><span>Receive kit</span></div><div><i>🎬</i><span>Create</span></div><div><i>💰</i><span>Get paid</span></div></div>
        <div class="bx-brief-note">You review and accept terms if selected. Applying is not a commitment.</div>`);
      foot.insertAdjacentHTML("afterend", TIP("The deadline starts after delivery — read the brief first."));
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
    body.insertAdjacentHTML("afterbegin", `<div class="bxg-chips bx-al-tabs b2-tabs"><button type="button" data-t="all" class="on">All</button><button type="button" data-t="act">Action needed</button><button type="button" data-t="upd">Updates</button></div>`);
    body.querySelectorAll(".bx-al-tabs button").forEach(b=> b.onclick = ()=>{ body.querySelectorAll(".bx-al-tabs button").forEach(x=> x.classList.toggle("on", x===b));
      rows.forEach(r=>{ const a = act.includes(r); r.style.display = b.dataset.t==="all" || (b.dataset.t==="act" && a) || (b.dataset.t==="upd" && !a) ? "" : "none"; }); });
    if(!body.querySelector(".bx-al-foot")) body.insertAdjacentHTML("beforeend", `<div class="bx-al-foot muted">Campaign alerts are separate from optional tips. Change them in Settings.</div>`);
  }

  /* ---------- M31 avatar menu: media kit + help (Settings & sidekick comes from bounty-kid.js) ---------- */
  function touchMe(){
    const mc = document.getElementById("meCard"), out = document.getElementById("meOut");
    if(!mc || !out || mc.querySelector(".bx-me-more") || !document.body.classList.contains("bx")) return;
    out.insertAdjacentHTML("beforebegin", `<div class="bx-me-more b2-memenu"><button type="button" data-m="profile">👤 My profile</button><button type="button" data-m="mediakit">🗂 My media kit</button><button type="button" data-m="ig">📸 Instagram accounts</button><button type="button" data-m="kid">🐾 Customise ${H(KN())}</button><button type="button" data-m="bxsettings">⚙︎ Settings &amp; privacy</button></div>`);
    mc.querySelectorAll(".bx-me-more [data-m]").forEach(b=> b.onclick = ()=>{ const x = document.getElementById("meX"); if(x) x.click();
      if(b.dataset.m === "help") return window.open("/contact.html", "_blank", "noopener");
      if(b.dataset.m === "kid") return window.bxKid && bxKid.sheet();
      if(b.dataset.m === "ig"){ go("profile"); setTimeout(()=> scrollToSection(/Instagram accounts/i), 700); return; }
      go(b.dataset.m); });
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
      <div class="b2-sec ink">— Performance over time —</div>
      <div class="card b2-perf">${pts.length > 1 ? `<div class="b2-bars3">${pts.map((m,i)=>{ const v = L[i] + C[i], mx = Math.max(1, ...pts.map((q,j)=> L[j]+C[j])); return `<i class="${i===pts.length-1?"last":""}" style="height:${Math.max(6, Math.round(100*v/mx))}%" title="${new Date(m.timestamp).toLocaleDateString("en-IN",{day:"numeric",month:"short"})}: ${L[i]} likes, ${C[i]} comments"></i>`; }).join("")}</div>
        <div class="b2-perf-l">Likes + comments · last ${pts.length} posts</div>` : `<div class="muted">The chart appears after a couple of posts sync from Instagram.</div>`}</div>
      <div class="b2-sec ink">— Insights —</div>
      <div class="card b2-ins"><ul>${best[0]?`<li>Your best post got ${eng(best[0])} likes + comments — lead with posts like it</li>`:""}${topGA?`<li>Top audience: ${H(topGA.replace(/^F\./,"Women ").replace(/^M\./,"Men "))}${topCity?" · "+H(String(topCity).split(",")[0]):""}</li>`:""}${media.length?`<li>${media.length} posts synced from Instagram</li>`:""}<li>Pin your best work below — brands see it first</li></ul></div>
      ${best.length ? `<div class="card"><h3>Your top content <span class="muted">· pin up to 6 to your media kit</span></h3><div class="bx-top">${best.map(m=>`<div class="bx-top-i"><a href="${H(m.permalink||"#")}" target="_blank" rel="noopener"><img src="${H(img(m))}" alt="" loading="lazy"></a>
          <div class="muted">❤ ${eng(m)}</div><button type="button" class="btn sm ${pins.includes(String(m.id))?"":"ghost"}" data-pin="${H(m.id)}">${pins.includes(String(m.id))?"📌 Pinned":"Pin to media kit"}</button></div>`).join("")}</div></div>` : ""}
      ${TIP("Pin the posts that did best — brands see them first in your media kit.")}</div>`);
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
    first.insertAdjacentHTML("beforebegin", `<div class="b2 b2-inbox" id="bxInbox"><h1 class="b2-h1">Inbox</h1><p class="b2-sub">Campaign updates and messages from Geek.</p><div id="bxInboxBody" class="b2-inboxb"><div class="b2-skel">Loading…</div></div></div>`);
    ciOps.loadAlerts(document.getElementById("bxInboxBody")).then(()=> tabsFor(document.getElementById("bxInboxBody")));
  }

  /* ---------- M32 Settings & privacy (new page) ---------- */
  try{
    if(typeof NAV_META !== "undefined" && !NAV_META.bxsettings) NAV_META.bxsettings = { ic:"⚙", label:"Settings" };
    if(typeof ROLES !== "undefined" && ROLES.creator && !ROLES.creator.nav.includes("bxsettings")) ROLES.creator.nav.push("bxsettings");
    if(typeof PAGES !== "undefined" && !PAGES.bxsettings) PAGES.bxsettings = () => `<div class="b2 b2-page b2-set">${HEAD("My account","Settings &amp; privacy","You stay in control of your data.")}<div id="bxSetBody"><div class="b2-skel">Loading…</div></div></div>`;
    if(typeof GATE_OPEN_PAGES !== "undefined" && !GATE_OPEN_PAGES.includes("bxsettings")) GATE_OPEN_PAGES.push("bxsettings");
  }catch(e){}
  async function loadSettings(){
    const box = document.getElementById("bxSetBody"); if(!box) return;
    const P = (window.Auth && Auth.profile) || {};
    const [pr, ig] = await Promise.all([ sb.rpc("my_notify_prefs").then(r=> r, e=> ({ error:e })), sb.from("social_accounts").select("id,username").eq("platform","instagram").eq("member_id", P.id).then(r=> r, e=> ({ error:e })) ]);
    if(!box.isConnected) return;
    const n = (pr && !pr.error && pr.data) || {}, accts = (ig && !ig.error && ig.data) || [];
    const k = window.bxKid ? bxKid.prefs() : {}, kid = window.bxKid ? (bxKid.kids[k.kid] || bxKid.kids.pip) : { n:"Pip", img:A+"rd/kid_pip.png" };
    const LANG = { auto:"Match me", english:"English", hindi:"Hindi", hinglish:"Hinglish" };
    let waNum = ""; try{ const r = await api("get_my_profile"); const e = r && r.data && r.data.contact && r.data.contact.whatsapp_e164; if(e){ const d = String(e).replace(/\D/g,"").slice(-10); waNum = "+91 " + d.slice(0,2) + "••• ••" + d.slice(-3); } }catch(e){}
    box.innerHTML = `
      <div class="b2-card b2-skid"><img src="${KI()}" data-kid-me alt=""><div><b>Sidekick: ${H(KN())}</b><span>${H((k.vibe||"playful").replace(/^./,x=>x.toUpperCase()))} · ${H(LANG[k.lang]||"Match me")} · ${H(k.scene==="forest"?"Forest":k.scene==="parchment"?"Parchment":"Auto scene")}</span></div><button type="button" class="b2-mini light" data-s="kid">Change</button></div>
      <div class="b2-sec ink">— Notifications —</div>
      <div class="b2-card b2-tlist">
        <label class="b2-tog"><span>WhatsApp campaign alerts${n.whatsapp_linked?"":" <em>(link WhatsApp first)</em>"}</span><input type="checkbox" id="bxSetWa"${n.whatsapp_linked && !n.whatsapp_off ? " checked" : ""}${n.whatsapp_linked ? "" : " disabled"}><i></i></label>
        <label class="b2-tog"><span>Email updates</span><input type="checkbox" id="bxSetEm"${!n.email_off ? " checked" : ""}><i></i></label>
        <label class="b2-tog"><span>Growth tips from ${H(KN())}</span><input type="checkbox" id="bxSetTips"${k.vibe==="focused" || k.tips==="asked" ? "" : " checked"}><i></i></label></div>
      <div class="b2-sec ink">— Connected accounts —</div>
      <div class="b2-card b2-accl">${accts.length ? accts.map(x=>`<div><span>📸</span><b>@${H(x.username)}</b><em class="b2-chip2 ok">✓ Connected</em><button type="button" class="b2-link sm" data-s="manage">Manage</button></div>`).join("") : `<div><span>📸</span><b>No Instagram connected</b><button type="button" class="b2-mini forest" data-s="connect">Connect</button></div>`}
        ${waNum?`<div><span>💬</span><b>WhatsApp ${H(waNum)}</b></div>`:""}</div>
      <div class="b2-sec ink">— Your data —</div>
      <button type="button" class="b2-card b2-dl" data-s="download"><b>⤓ Download my data</b><span>Profile, Instagram and campaigns as a file</span></button>
      <div class="b2-del"><b>Delete my account</b><p>Removes your profile and campaign history. Type DELETE to confirm.</p><button type="button" class="b2-mini red" data-s="delete">Delete my account</button><div id="bxDel"></div></div>
      ${TIP("You're in control — nothing is shared without your OK.")}`;
    box.querySelector('[data-s="kid"]').onclick = ()=> window.bxKid && bxKid.sheet();
    const m = box.querySelector('[data-s="manage"]'); if(m) box.querySelectorAll('[data-s="manage"]').forEach(b=> b.onclick = ()=> go("profile"));
    const cn = box.querySelector('[data-s="connect"]'); if(cn) cn.onclick = ()=> typeof connectInstagram === "function" && connectInstagram();
    const wa = document.getElementById("bxSetWa"), em = document.getElementById("bxSetEm"), tp = document.getElementById("bxSetTips");
    if(wa) wa.onchange = async ()=>{ wa.disabled = true; const { error } = await sb.rpc("wa_set_opt_out", { p_opt_out: !wa.checked }); if(error && typeof gateToast==="function") gateToast(error.message); loadSettings(); };
    if(em) em.onchange = async ()=>{ em.disabled = true; const { error } = await sb.rpc("set_email_updates", { p_on: em.checked }); if(error && typeof gateToast==="function") gateToast(error.message); loadSettings(); };
    if(tp) tp.onchange = async ()=>{ if(window.bxKid){ await bxKid.save({ tips: tp.checked ? "occasional" : "asked" }); loadSettings(); } };
    box.querySelector('[data-s="download"]').onclick = async e=>{
      const b = e.currentTarget; b.disabled = true; b.innerHTML = "<b>Preparing…</b>";
      const [pf, sa, mc] = await Promise.all([ api("get_my_profile"), sb.from("social_accounts").select("username,name,followers_count,media_count,biography,website,updated_at,edits").eq("member_id", P.id).then(r=> r, e=> ({ error:e })), api("get_my_campaigns") ]);
      const out = { exported_at: new Date().toISOString(), account: { name: P.name, role: P.role }, profile: pf && pf.data || null, instagram: sa && sa.data || [], campaigns: mc && mc.data || [], sidekick: window.bxKid ? bxKid.prefs() : null };
      const l = document.createElement("a"); l.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type:"application/json" })); l.download = "my-bounty-data.json"; l.click();
      b.disabled = false; b.innerHTML = "<b>⤓ Download my data</b><span>Profile, Instagram and campaigns as a file</span>";
    };
    box.querySelector('[data-s="delete"]').onclick = ()=>{
      const d = document.getElementById("bxDel");
      d.innerHTML = `<div class="bx-del"><b>This permanently deletes your login, profile, Instagram connection, campaign history and messages.</b> It can't be undone.
        <label class="b2-lab">Type <b>DELETE</b> to confirm<input class="b2-in" id="bxDelIn" autocomplete="off"></label><div class="b2-delb"><button type="button" class="b2-mini red" id="bxDelGo" disabled>Delete my account forever</button><button type="button" class="b2-mini light" id="bxDelNo">Keep my account</button></div><div class="auth-err" id="bxDelErr"></div></div>`;
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
  function touchMine(){
    const c = document.getElementById("content"); if(!c || currentPage !== "mycampaigns") return;
    const intro = c.querySelector(".ci-intro"); if(!intro || intro.dataset.b2) return; intro.dataset.b2 = 1;
    intro.classList.add("b2-intro"); intro.innerHTML = `<div class="b2-eyebrow">Your creator journey</div><h1 class="b2-h1">My campaigns</h1><p class="b2-sub">Every collaboration, all in one place.</p>`;
  }
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
    if(isCreator()){ touchSteps(); touchMine(); }
  }); }).observe(document.body, { childList:true, subtree:true });
  // nav label + icon for the new page (bounty-creator.js names the rest)
  window.__bxExtraNav = { bxpayments:["Payments","coins"], bxsettings:["Settings","gear"] };
})();
