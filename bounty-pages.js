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
      if(k === "#settings") return window.bxKid ? bxKid.sheet() : null;
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
  function touchAlerts(){
    const body = document.getElementById("notifBody"); if(!body || body.querySelector(".bx-al-tabs")) return;
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

  /* ---------- wire ---------- */
  const _rs = window.renderShell;
  window.renderShell = function(){
    const r = _rs.apply(this, arguments);
    if(isCreator()){
      if(currentPage === "bxpayments") loadPayments();
      if(currentPage === "profile") setTimeout(touchProfile, 400);
      touchDrawer();
    }
    return r;
  };
  let q = false;
  new MutationObserver(()=>{ if(q) return; q = true; requestAnimationFrame(()=>{ q = false;
    const pop = document.getElementById("ciPop"); if(pop && !pop.dataset.bx) touchBrief(pop);
    touchAlerts(); touchMe();
    if(isCreator() && currentPage === "profile" && !document.getElementById("bxHub")) touchProfile();
  }); }).observe(document.body, { childList:true, subtree:true });
  // nav label + icon for the new page (bounty-creator.js names the rest)
  window.__bxExtraNav = { bxpayments:["Payments","coins"] };
})();
