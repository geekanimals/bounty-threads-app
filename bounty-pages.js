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

  /* ---------- Skeletons: each page's loading state has the same shape as the content that replaces it ---------- */
  const SKB = (w, h, x) => `<i class="b2sk" style="width:${w};height:${h}px;${x||""}"></i>`;
  const SKP = (w, h) => SKB(w + "px", h, `border-radius:${h/2}px`);
  const SKC = d => SKB(d + "px", d, "border-radius:50%;flex:0 0 " + d + "px");
  const SK = {
    camp: () => `<article class="b2-camp ci-ccard b2sk-card"><div class="b2-camp-ph">${SKB("100%", 0, "position:absolute;inset:0;height:auto;border-radius:0")}</div><div class="b2-camp-b">${SKB("38%",11)}${SKB("88%",17,"margin-top:8px")}${SKB("64%",17,"margin-top:6px")}${SKB("70%",12,"margin-top:9px")}${SKB("52%",11,"margin-top:7px")}<div class="b2-camp-foot">${SKB("72px",13)}${SKP(98,30)}</div></div></article>`,
    discover: n => `<div class="ci-cgrid b2-cgrid">${Array.from({length:n||3}, SK.camp).join("")}</div>`,
    tabs: k => `<div class="b2sk-pills">${Array.from({length:k}, (_, i)=> SKP(i ? 96 : 54, 32)).join("")}</div>`,
    mcCard: () => `<div class="b2-card b2sk-mc">${SKB("72%",19)}${SKB("40%",11,"margin-top:8px")}<div class="b2sk-track">${Array.from({length:5}, ()=> `<span>${SKC(18)}${SKB("44px",9,"margin-top:6px")}</span>`).join("")}</div>${SKB("58%",12,"margin-top:12px")}${SKB("66%",12,"margin-top:8px")}<div class="b2sk-row" style="justify-content:space-between;margin-top:12px">${SKB("64px",12)}${SKP(118,32)}</div></div>`,
    mine: () => SK.mcCard() + SK.mcCard(),
    alert: () => `<div class="b2-card b2sk-alert"><div class="b2sk-row">${SKC(8)}${SKB("52%",14)}${SKB("40px",10,"margin-left:auto")}</div>${SKB("70%",11,"margin:8px 0 0 18px")}${SKP(96,30).replace('style="','style="margin:12px 0 0 18px;')}</div>`,
    alerts: n => Array.from({length:n||3}, SK.alert).join(""),
    inbox: () => `<div class="b2sk-pills c">${SKP(54,32)}${SKP(118,32)}${SKP(84,32)}</div><div class="b2sk-row" style="justify-content:flex-end;margin:6px 0 8px">${SKB("86px",12)}</div>` + SK.alerts(3),
    ana: () => `<div class="b2-angrid b2sk-angrid"><div class="b2-anl"><div class="b2sk-ana"><div class="b2sk-pills c">${SKP(150,32)}${SKP(100,32)}</div><div class="b2-k4">${Array.from({length:4}, ()=> `<div>${SKB("46%",22)}${SKB("62%",11,"margin-top:8px")}</div>`).join("")}</div></div>
      <div class="b2-sec ink">— Performance over time —</div><div class="card b2-perf"><div class="b2sk-bars">${[30,44,38,56,50,66,60,78,70,88,82,96].map(h=> SKB("100%", 0, `height:${h}%;border-radius:4px 4px 0 0`)).join("")}</div>${SKB("44%",11,"margin:10px auto 0")}</div>
      <div class="b2-sec ink">— Insights —</div><div class="card b2-ins">${SKB("84%",12)}${SKB("62%",12,"margin-top:10px")}${SKB("72%",12,"margin-top:10px")}</div></div>
      <div class="b2-anr"><div class="b2-sec ink">— Your top content —</div><div class="card b2-ins">${Array.from({length:3}, ()=> `<div class="b2sk-row" style="padding:8px 0">${SKB("48px",48,"border-radius:10px")}<span style="flex:1">${SKB("60%",13)}${SKB("40%",11,"margin-top:7px")}</span>${SKP(58,26)}</div>`).join("")}</div></div></div>`,
    kit: () => `<div class="b2 b2-mk b2sk-mk"><div class="b2-mkcol"><div class="b2-mkid b2sk-dk">${SKC(84)}<div class="b2-mkn">${SKB("78%",19)}${SKB("60%",12,"margin-top:8px")}${SKB("70%",11,"margin-top:8px")}</div><div class="b2-nums">${Array.from({length:3}, ()=> `<div>${SKB("44px",20,"margin:0 auto")}${SKB("56px",10,"margin:6px auto 0")}</div>`).join("")}</div></div>
      <div class="b2-mkacct">${SKB("46%",14)}${SKP(92,22)}</div><div class="b2-sec ink">— Who follows my story —</div><div class="b2-card b2-aud">${[86,58,34].map(w=> `<div class="b2sk-row" style="margin:6px 0">${SKB("84px",12)}${SKB(w+"%",8,"flex:1;max-width:"+w+"%")}${SKB("28px",12)}</div>`).join("")}</div></div>
      <div class="b2-mkcol"><div class="b2-sec ink">— The work I'm proud of —</div><div class="b2-mkgrid">${Array.from({length:9}, ()=> `<a>${SKB("100%",0,"height:100%;border-radius:0")}</a>`).join("")}</div>
      <div class="b2-sec ink">— Let's create together —</div><div class="b2-card b2-together">${SKB("70%",14)}${SKB("50%",11,"margin-top:8px")}</div><div class="b2-mkbtns2">${SKP(0,44).replace("width:0px","width:100%")}${SKP(0,44).replace("width:0px","width:100%")}</div></div></div>`,
    pay: () => `<div class="b2-paygrid"><div class="b2-payl"><div class="b2-earn b2sk-dk">${SKB("34%",11)}${SKB("46%",34,"margin-top:10px")}${SKB("62%",12,"margin-top:10px")}</div><div class="b2-3t">${Array.from({length:3}, ()=> `<div>${SKB("54%",20,"margin:0 auto")}${SKB("44%",11,"margin:8px auto 0")}</div>`).join("")}</div></div>
      <div class="b2-payr"><div class="b2-sec ink">— Payouts —</div><div class="b2-list">${Array.from({length:3}, ()=> `<div class="b2-lrow"><div>${SKB("62%",13)}${SKB("40%",11,"margin-top:6px")}</div>${SKP(70,22)}</div>`).join("")}</div>
      <div class="b2-bank"><div style="flex:1">${SKB("78%",15)}${SKB("88%",11,"margin-top:8px")}</div>${SKP(64,34)}</div></div></div>`,
    set: () => `<div class="b2-setgrid"><div><div class="b2-card b2-skid">${SKC(48)}<div>${SKB("54%",15)}${SKB("74%",11,"margin-top:7px")}</div>${SKP(84,30)}</div>
      <div class="b2-sec ink">— Notifications —</div><div class="b2-card b2-tlist">${Array.from({length:3}, ()=> `<div class="b2sk-row b2sk-tog">${SKB("58%",13)}${SKP(46,26)}</div>`).join("")}</div>
      <div class="b2-sec ink">— Connected accounts —</div><div class="b2-card b2-accl">${Array.from({length:2}, ()=> `<div class="b2sk-row" style="padding:9px 0">${SKC(16)}${SKB("52%",13)}${SKP(90,22).replace('style="','style="margin-left:auto;')}</div>`).join("")}</div></div>
      <div><div class="b2-sec ink">— Your data —</div><div class="b2-card b2-dl">${SKB("46%",14)}${SKB("70%",11,"margin-top:8px")}</div><div class="b2-del">${SKB("42%",15)}${SKB("86%",11,"margin-top:8px")}${SKP(160,34).replace('style="','style="margin-top:12px;')}</div></div></div>`,
    homeNext: () => `${SKP(76,22)}${SKB("82%",21,"margin-top:12px")}${SKB("58%",13,"margin-top:10px")}${SKP(132,34).replace('style="','style="margin-top:14px;')}`,
    homeAct: () => `<div class="b2-sec">— Active campaigns —</div><div class="b2-sec2">${SKB("70px",11,"margin:0 auto")}</div><div class="b2-gc b2-active"><div class="b2-gc-h d-only">${SKB("62%",17)}</div>${Array.from({length:2}, ()=> `<div class="b2-arow">${SKC(32)}${SKB("46%",14)}${SKP(76,20).replace('style="','style="margin-left:auto;')}</div>`).join("")}</div>`,
    homeRec: () => `<div id="b2HSkRec"><div class="b2-sec">— Made for your world —</div><div class="b2-gc b2-rec m-only">${SKB("100%",0,"height:100%;border-radius:0")}<div>${SKB("40%",10)}${SKB("80%",17,"margin-top:8px")}${SKB("60%",12,"margin-top:8px")}${SKP(104,22).replace('style="','style="margin-top:10px;')}<div class="b2sk-row" style="justify-content:space-between;margin-top:12px">${SKB("40%",11)}${SKP(78,30)}</div></div></div><div class="b2-cgrid d-only b2-home-camps">${SK.camp()+SK.camp()+SK.camp()}</div></div>`,
    hub: () => `<div class="b2 b2-hub b2sk-hub" id="bxHubSk"><div class="b2-hubl"><div class="b2-bigav">${SKC(100)}</div>${SKB("60%",26,"margin:0 auto")}${SKB("44%",12,"margin:10px auto 14px")}<div class="b2-card b2sk-row" style="padding:13px 16px;min-height:52px;margin-top:0">${SKB("62%",13)}${SKP(46,26).replace('style="','style="margin-left:auto;')}</div><div class="b2-card b2-pct">${SKB("54%",17)}${SKB("100%",8,"margin-top:12px")}</div>
      ${Array.from({length:2}, ()=> `<div class="b2-card b2-row b2sk-row">${SKC(24)}<span style="flex:1">${SKB("46%",15)}${SKB("70%",11,"margin-top:7px")}</span></div>`).join("")}</div><div class="b2-hubr">${Array.from({length:4}, ()=> `<div class="b2-card b2-row b2sk-row">${SKC(24)}<span style="flex:1">${SKB("46%",15)}${SKB("70%",11,"margin-top:7px")}</span></div>`).join("")}</div></div>`
  };
  window.B2SK = SK;
  // the app's own loading placeholders (skel) → the v2 shapes, per page, for creators only
  const _skel = window.skel;
  if(typeof _skel === "function"){
    const v2skel = function(kind, n){
      if(!isCreator() || !document.body.classList.contains("b2app")) return _skel(kind, n);
      const pg = typeof currentPage !== "undefined" ? currentPage : "";
      if(pg === "opencampaigns" || pg === "marketplace") return kind === "cards" ? SK.discover(4) : "";
      if(pg === "mycampaigns") return kind === "stats" ? SK.tabs(4) : kind === "list" && n === 3 ? SK.mine() : "";
      if(pg === "reports") return SK.ana();
      if(pg === "mediakit") return SK.kit();
      if(pg === "messages" || kind === "list" && n === 4) return SK.alerts(3);
      if(kind === "kit" || kind === "dash") return "";   // boot / Home: Home paints its own skeleton
      return _skel(kind, n);
    };
    window.skel = v2skel; try{ skel = v2skel; }catch(e){}
  }
  // the media kit's "Loading your media kit…" bar: the skeleton already says it
  if(typeof window.mkLoadingHtml === "function"){ const _mkl = window.mkLoadingHtml; const v2mkl = function(){ return isCreator() && document.body.classList.contains("b2app") ? "" : _mkl(); }; window.mkLoadingHtml = v2mkl; try{ mkLoadingHtml = v2mkl; }catch(e){} }

  /* ---------- M21 Payments & payouts (new page, creator only) ---------- */
  try{
    if(typeof NAV_META !== "undefined" && !NAV_META.bxpayments) NAV_META.bxpayments = { ic:"💰", label:"Payments" };
    if(typeof ROLES !== "undefined" && ROLES.creator && !ROLES.creator.nav.includes("bxpayments")){
      const i = ROLES.creator.nav.indexOf("mycampaigns"); ROLES.creator.nav.splice(i >= 0 ? i+1 : ROLES.creator.nav.length, 0, "bxpayments");
    }
    if(typeof PAGES !== "undefined" && !PAGES.bxpayments){
      PAGES.bxpayments = () => `<div class="b2 b2-page b2-pay">${HEAD("Your earnings","Payments &amp; rewards","Every rupee and every product, in one place.")}<div id="bxPayBody">${SK.pay()}</div></div>`;
    }
  }catch(e){}
  async function loadPayments(){
    const box = document.getElementById("bxPayBody"); if(!box) return;
    const [mine, fl] = await Promise.all([ api("get_my_campaigns"), api("my_campaign_flows") ]);
    if(!box.isConnected) return;
    const list = (mine && !mine.error && Array.isArray(mine.data)) ? mine.data : [], flows = (fl && !fl.error && fl.data) || {};
    const rows = []; let earned = 0, pending = 0, done = 0, needs = 0, needPart = null, haveBank = null;
    const GOT = ["product_sent","content_created","changes_requested","content_submitted","content_approved","published","completed","brand_confirmed"];
    const prods = list.filter(c=> c.product_value && GOT.includes(c.stage) && (c.campaign_type||"") !== "paid");
    const prodVal = prods.reduce((s,c)=> s + (+c.product_value||0), 0);
    list.forEach(c=>{
      const f = flows[c.participation_id] || {}, p = f.payment;
      if(f.paid && p){
        const pos = p.payouts || [], sumPaid = pos.filter(o=> o.status === "paid").reduce((s,o)=> s + (+o.amount||0), 0);
        const amt = p.amount != null ? +p.amount : null;
        if(amt != null){ earned += sumPaid; done += sumPaid; pending += Math.max(0, amt - sumPaid); }
        const need = !p.method || ["pending","failed","needs_update"].includes(p.details_status); if(need){ needs++; if(!needPart) needPart = c.participation_id; }
        if(p.method && !haveBank) haveBank = { part:c.participation_id, txt: p.method === "upi" ? "UPI " + (p.upi_id||"") : "Bank ••••" + (p.account_last4||""), st: p.details_status };
        pos.forEach(o=> rows.push({ c, amt:+o.amount||0, sub: (o.part==="advance"?"advance":o.part==="balance"?"after post":"fee"), st: o.status==="paid" ? ["Paid","teal"] : ["queued","processing"].includes(o.status) ? ["Pending","orange"] : ["Waiting for post","ink"] }));
        if(!pos.length) rows.push({ c, amt:amt||0, sub: need ? "add payout details" : "after post", st: need ? ["Action needed","red"] : ["Waiting for post","ink"] });
      }
    });
    prods.forEach(c=> rows.push({ c, prod:true, amt:+c.product_value||0, sub:"Product", st:["Delivered","teal"] }));
    box.innerHTML = `<div class="b2-paygrid"><div class="b2-payl"><div class="b2-earn"><div class="b2-ek">Earned so far</div><b>${INR(earned)}</b><span>${prods.length ? `+ ${prods.length} product${prods.length>1?"s":""} worth ${INR(prodVal)}` : "Paid and hybrid campaigns add up here"}</span></div>
      <div class="b2-3t"><div><b>${INR(done)}</b><span class="t">Paid</span></div><div><b>${INR(pending)}</b><span class="o">Pending</span></div><div><b>${prods.length}</b><span>Products</span></div></div></div><div class="b2-payr">
      <div class="b2-sec ink">— Payouts —</div>
      <div class="b2-list">${rows.length ? rows.map(r=>`<div class="b2-lrow"><div><b>${H(r.c.campaign||"Campaign")}${r.c.brand?" · "+H(r.c.brand):""}</b><span>${r.prod?"Product ":""}${INR(r.amt)} · ${H(r.sub)}</span></div><em class="b2-chip2 ${r.st[1]}">${r.st[0]}</em></div>`).join("")
        : `<div class="b2-lrow empty">No payouts yet — paid and barter campaigns show up here once you're selected.</div>`}</div>
      ${haveBank && !needPart ? `<div class="b2-bank"><div><b>🏦 ${H(haveBank.txt)}</b><p>${haveBank.st === "verified" ? "Verified ✓ — every payout goes here." : "Received — the Geek team is checking it."}</p></div><button type="button" class="b2-mini light" data-pay="${H(haveBank.part)}">Update</button></div>`
        : `<div class="b2-bank need"><div><b>🏦 Add your bank / UPI details</b><p>Must be in your own name. Only you and the Geek team see it.</p></div><button type="button" class="b2-mini forest" data-pay="${H(needPart||"")}">Add</button></div>`}
      ${TIP("Add your UPI once — every payout goes there automatically.")}</div></div>`;
    box.querySelectorAll("[data-go]").forEach(b=> b.onclick = ()=> go(b.dataset.go));
    box.querySelectorAll("[data-pay]").forEach(b=> b.onclick = ()=> openPayDetails(b.dataset.pay));
  }
  // bank / UPI lives on each paid campaign (asked after you sign): open that campaign's payment form
  function openPayDetails(part){
    if(!part){ const t = "You'll add bank / UPI details when a paid campaign needs them — right after you sign its agreement.";
      if(typeof gateToast === "function") gateToast(t); return; }
    go("mycampaigns"); let n = 0;
    const tick = setInterval(()=>{ n++; const b = document.querySelector(`[data-paydetails="${CSS.escape(part)}"]`);
      if(b){ clearInterval(tick); const card = b.closest(".mc-card"); if(card && !card.classList.contains("b2-open")){ const g = card.querySelector(".b2-mcgo"); if(g) g.click(); } b.scrollIntoView({ block:"center" }); b.click(); }
      else if(n > 40) clearInterval(tick); }, 150);
  }

  /* ---------- M26 profile hub (top of Creator Profile) ---------- */
  function scrollToSection(rx){
    const h = [...document.querySelectorAll("#content h3, #content .cp-sec-h, #content summary")].find(x=> rx.test(x.textContent));
    if(h){ (h.closest(".card,section,details") || h).scrollIntoView({ behavior:"smooth", block:"start" }); if(h.tagName === "SUMMARY" && h.parentElement && !h.parentElement.open) h.click(); }
  }
  async function touchProfile(){
    if(touchProfile.busy) return; touchProfile.busy = true;
    try{ await touchProfile2(); } finally { touchProfile.busy = false; }
  }
  async function touchProfile2(){
    const c = document.getElementById("content"); if(!c || c.querySelector("#bxHub")) return;
    const first = [...c.children].find(x=> x.id !== "bxHubSk"); if(!first) return;
    const P = (window.Auth && Auth.profile) || {}, req = window.__profileReq;
    let ig = null; try{ const r = await sb.from("social_accounts").select("username,profile_picture_url").eq("platform","instagram").eq("member_id", P.id).limit(3); ig = (r && r.data) || []; }catch(e){ ig = []; }
    let pf = null; if(window.__ciProfileEnabled){ const r = await api("get_my_profile"); if(!r.error) pf = r.data; }
    if(c.querySelector("#bxHub") || !first.isConnected) return;
    const md = (window.__bxMeta && __bxMeta.bx_manual) || {};
    const nm = /^wa_\d+@/.test(P.name||"") ? (ig[0] ? ig[0].username : "Creator") : (P.name || "Creator");
    const pro = (pf && pf.professional) || {}, per = (pf && pf.personal) || {}, cp = (pf && pf.commercial_preference) || {};
    let acct = null; try{ acct = window._mkLastAcct || (typeof mkFetchAcct === "function" ? await mkFetchAcct() : null); }catch(e){}
    const rc = acct ? (((typeof mkEdits === "function" ? mkEdits(acct) : acct.edits) || {}).rate_card || []).filter(r=> r && r.item) : [];
    const rateSub = rc.slice(0,2).map(r=> `${String(r.item).replace(/^Instagram\s+/i,"")} ${r.price||""}`.trim()).join(" · ");
    const handle = ig[0] ? "@" + ig[0].username : (md.ig_handle || (pro.ig_handle_self ? "@" + pro.ig_handle_self : ""));
    // profile % = the server checklist (address, birthday, gender, pets, skills, backup email, favourite brands …, fresh each time)
    //           + what the setup asks (name, city, categories, languages, formats, Instagram, terms)
    let rq = req; try{ if(typeof creatorProfileGate === "function"){ await creatorProfileGate(); rq = window.__profileReq || req; } }catch(e){}
    if(c.querySelector("#bxHub") || !first.isConnected) return;
    const tot = rq ? rq.total : 0, dn = rq ? rq.done : 0;   // creatorProfileGate already counts the setup items too
    const pct = Math.round(100 * dn / Math.max(tot, 1));
    const dreams = ((pf && pf.dream_brands) || []).map(x=> x.submitted_brand_name).filter(Boolean);
    const terms = (window.B2 && B2.onbKit && B2.onbKit.termsLabel) ? B2.onbKit.termsLabel(cp) : "";
    // every part of the old Creator Profile, one row each — a row opens just that section ("#key" = profile.js data-sec)
    const ciRates = ((pf && pf.rate_cards && pf.rate_cards[0] && pf.rate_cards[0].items) || []).slice(0,2).map(i=> `${String(i.deliverable_type).replace(/^IG\s+/,"").replace("Static ","")} ₹${Number(i.amount).toLocaleString("en-IN")}`).join(" · ");
    const L = [["👤","About you", [per.first_name, per.gender ? String(per.gender).replace(/_/g," ") : ""].filter(Boolean).join(" · ") || "Name, gender, birthday, married, pets","#personal"],
      ["📞","Contact", "WhatsApp, backup email","#contact"],
      ["📍","Delivery address", ((pf && pf.addresses)||[]).map(a=> a.label || a.city).filter(Boolean).join(" · ") || "Where brands send your kit","#address"],
      ["🎬","What you create", [].concat((pro.categories||[]).slice(0,3), (pro.languages||[]).slice(0,2)).join(", ") || "Categories, languages, city, content types","#professional"],
      ["🛠️","Skills & resources", "What you're good at and the gear you have","#skills"],
      ["💙","Dream brands", dreams.slice(0,3).join(", ") || "Brands you'd love to work with","#dreams"],
      ["🤝","Your terms & rate card", [terms, ciRates].filter(Boolean).join(" · ") || "Barter, paid, hybrid · Reel, Story, Post rates","#terms"],
      ["📸","Instagram & privacy", (ig.length ? ig.map(x=>"@"+x.username).join(", ") : (handle ? handle + " (self-reported) · connect" : "Connect Instagram")) + " · what brands see","#pages"]];
    const useKid = window.bxKid && bxKid.prefs().avatar;
    const onb = n => { if(!(window.B2 && B2.screens && B2.screens.onbStep)) return; window.__bxOnbReturn = "profile"; window.__bxOnbOnly = true; window.__bxManualShown = true; B2.screens.onbStep(n, pf || {}); };
    c.classList.add("b2-hubpage"); { const sk = document.getElementById("bxHubSk"); if(sk) sk.remove(); }
    const row = ([ic,t,sub,k])=>`<button type="button" class="b2-card b2-row" data-hub="${k}"><span class="ic">${ic}</span><span class="tx"><b>${t}</b><em>${H(sub)}</em></span><i>›</i></button>`;
    first.insertAdjacentHTML("beforebegin", `<button type="button" class="b2-back b2-hubback" id="bxHubBack">← My profile</button><div class="b2 b2-hub" id="bxHub"><div class="b2-hubl">
      <div class="b2-bigav${useKid || (ig[0] && ig[0].profile_picture_url) ? " pic" : ""}">${useKid?`<img src="${KI()}" data-kid-me alt="">`:(ig[0] && ig[0].profile_picture_url ? `<img src="${H(ig[0].profile_picture_url)}" alt="" referrerpolicy="no-referrer" onerror="this.replaceWith(document.createTextNode('${H(nm.charAt(0).toUpperCase())}'))">` : H(nm.charAt(0).toUpperCase()))}</div>
      <h1 class="b2-hubn">${H(nm)}</h1><div class="b2-hubh">${H([handle, pro.city_coarse || md.city].filter(Boolean).join(" · "))}${md.ig_handle && !ig.length ? ` <em class="b2-sr">self-reported</em>` : ""}</div>
      <label class="b2-card b2-tog wide"><span>Use ${H(KN())} as my profile picture</span><input type="checkbox" id="bxHubKid"${useKid?" checked":""}><i></i></label>
      <button type="button" class="b2-card b2-pct" data-hub="#campready"><b>Profile ${pct}% complete</b><div class="b2-bar2"><i style="width:${pct}%"></i></div>${pct < 100 ? `<em class="b2-pct-sub">${tot - dn} thing${tot - dn === 1 ? "" : "s"} left — tap to finish</em>` : ""}</button>
      ${L.slice(0,4).map(row).join("")}</div><div class="b2-hubr">${L.slice(4).map(row).join("")}
      ${TIP("Add your city — nearby campaigns show up first.")}</div></div>
      <div class="b2-oneextra card" id="bxCreateX"></div><div class="b2-oneextra card" id="bxTermsX"></div>`);
    // ---- the same picks as the setup screens, edited right here (no jumping back to the setup) ----
    const K = (window.B2 && B2.onbKit) || { CATS:[], LANG:[] };
    const low = v => String(v||"").toLowerCase();
    const rebuild = key => { ["bxHub","bxCreateX","bxTermsX","bxHubBack"].forEach(id=>{ const x = document.getElementById(id); if(x) x.remove(); }); window.__bxHubOpen = key; touchProfile(); };
    const addOwn = (wrap, ph, onAdd) => { if(wrap.querySelector("input")) return;
      wrap.innerHTML = `<div class="b2-addin"><input class="b2-in" placeholder="${ph}" maxlength="30"><button type="button" class="b2-btn forest">Add</button></div>`;
      const i = wrap.querySelector("input"); i.focus();
      const go2 = ()=>{ const v = i.value.trim().replace(/\s+/g," "); if(!v) return; onAdd(v.charAt(0).toUpperCase() + v.slice(1)); i.value = ""; i.focus(); };
      wrap.querySelector("button").onclick = go2; i.onkeydown = e=>{ if(e.key === "Enter"){ e.preventDefault(); go2(); } }; };
    { // What you create: categories (photo tiles, up to 3) + languages + city — one Save
      const box = document.getElementById("bxCreateX"), cats = pro.categories || [], langs = pro.languages || [];
      const tileH = (cn, img, on)=> img ? `<button type="button" class="b2-cat${on?" on":""}" data-v="${H(cn)}"><img src="${img}" alt="" loading="lazy"><b>${H(cn.toUpperCase())}</b><i class="b2-chk"></i></button>`
        : `<button type="button" class="b2-cat own${on?" on":""}" data-v="${H(cn)}"><b>${H(cn.toUpperCase())}</b><i class="b2-chk"></i></button>`;
      const exC = cats.filter(x=> !K.CATS.some(k=> low(k[0]) === low(x))), exL = langs.filter(x=> !K.LANG.some(k=> low(k) === low(x)));
      box.innerHTML = `<h4>Your content</h4>
        <div class="b2-cx-lab">Categories <em>pick up to 3</em></div>
        <div class="b2-catgrid" id="bxCxCats">${K.CATS.map(([cn,img])=> tileH(cn, img, cats.some(x=> low(x) === low(cn)))).join("")}${exC.map(x=> tileH(x, null, true)).join("")}</div>
        <div class="b2-addown" id="bxCxCatAdd"><button type="button" class="b2-more">+ Add your own category</button></div>
        <div class="b2-cx-lab">Content languages</div>
        <div class="b2-chips" id="bxCxLang">${K.LANG.concat(exL).map(l=> `<button type="button" class="b2-chip${langs.some(x=> low(x) === low(l))?" on":""}" data-v="${H(l)}">${H(l)}</button>`).join("")}</div>
        <div class="b2-addown" id="bxCxLangAdd"><button type="button" class="b2-more">+ Add another language</button></div>
        <label class="b2-cx-city"><span>City</span><input id="bxCxCity" placeholder="e.g. Jaipur" value="${H(pro.city_coarse || md.city || "")}" maxlength="60"></label>
        <div class="auth-err" id="bxCxMsg"></div>
        <button type="button" class="b2-btn forest full" id="bxCxSave">Save</button>`;
      const on = ()=> box.querySelectorAll("#bxCxCats .b2-cat.on").length, msg = t=> document.getElementById("bxCxMsg").textContent = t;
      const wireC = ()=> box.querySelectorAll("#bxCxCats .b2-cat").forEach(b=> b.onclick = ()=>{ if(!b.classList.contains("on") && on() >= 3) return msg("Pick up to 3 — tap one to swap it."); msg(""); b.classList.toggle("on"); });
      const wireL = ()=> box.querySelectorAll("#bxCxLang .b2-chip").forEach(b=> b.onclick = ()=> b.classList.toggle("on"));
      wireC(); wireL();
      box.querySelector("#bxCxCatAdd button").onclick = ()=> addOwn(document.getElementById("bxCxCatAdd"), "Type a category, e.g. Cars", v=>{
        const g = document.getElementById("bxCxCats"), have = [...g.querySelectorAll(".b2-cat")].find(b=> low(b.dataset.v) === low(v));
        if(have){ if(!have.classList.contains("on") && on() < 3) have.classList.add("on"); return; }
        if(on() >= 3) return msg("Pick up to 3 — tap one to swap it, then add yours.");
        g.insertAdjacentHTML("beforeend", tileH(v, null, true)); wireC(); });
      box.querySelector("#bxCxLangAdd button").onclick = ()=> addOwn(document.getElementById("bxCxLangAdd"), "Type a language, e.g. Bhojpuri", v=>{
        const g = document.getElementById("bxCxLang"), have = [...g.querySelectorAll(".b2-chip")].find(b=> low(b.dataset.v) === low(v));
        if(have){ have.classList.add("on"); return; }
        g.insertAdjacentHTML("beforeend", `<button type="button" class="b2-chip on" data-v="${H(v)}">${H(v)}</button>`); wireL(); });
      document.getElementById("bxCxSave").onclick = async ()=>{
        const b = document.getElementById("bxCxSave"), pick = sel=> [...box.querySelectorAll(sel)].map(x=> x.dataset.v);
        const city = document.getElementById("bxCxCity").value.trim();
        b.disabled = true; b.textContent = "Saving…"; msg("");
        const r = await api("save_profile_section", { p_section:"professional", p_patch:{ categories: pick("#bxCxCats .b2-cat.on"), languages: pick("#bxCxLang .b2-chip.on"), city_coarse: city || null }, p_correlation:"ui-hub" });
        if(r.error){ b.disabled = false; b.textContent = "Save"; return msg("Couldn't save: " + (r.error.message || r.error)); }
        b.textContent = "✓ Saved"; setTimeout(()=> rebuild("professional"), 700);
      };
    }
    { // Your terms & rate card — same choices as the setup's last screen, saved to the same place
      const box = document.getElementById("bxTermsX");
      const RATES = [["IG Reel","Reel"],["IG Story","Story"],["IG Static Post","Post"]];
      const rItems = ((pf && pf.rate_cards && pf.rate_cards[0] && pf.rate_cards[0].items) || []);
      const rateOf = t=> { const x = rItems.find(i=> i.deliverable_type === t); return x ? Math.round(Number(x.amount)) : null; };
      const was = K.termsOf ? K.termsOf(cp) : new Set();
      const T = [["barter","🎁","Barter","Products or experiences for content"],["paid","₹","Paid","A cash fee for your work"],["hybrid","🎁+₹","Hybrid","Product + payment"],["discuss","💬","Open to discuss",""]];
      box.innerHTML = `<h4>Your terms &amp; rate card</h4>
        <div class="b2-cx-lab">What are you open to? <em>pick all that fit</em></div>
        <div class="b2-terms lite" id="bxTxTerms">${T.map(([k,ic,t,sub])=> `<button type="button" class="b2-term${was.has(k)?" on":""}" data-v="${k}"><span class="ic${ic.length>2?" sm":""}">${ic}</span><div><b>${t}</b>${sub?`<em>${sub}</em>`:""}</div><i class="b2-tick"></i></button>`).join("")}</div>
        <div class="b2-cx-lab" id="bxTxRateH">Your rates <em>optional · shown only to brands you apply to</em></div>
        <div class="b2-rates" id="bxTxRates">${RATES.map(([t,l],i)=> `<label><span>${l}</span><b>₹<input id="bxTxR${i}" data-t="${t}" inputmode="numeric" placeholder="—" value="${rateOf(t)!=null?rateOf(t):""}"></b></label>`).join("")}</div>
        <label class="b2-cx-city" id="bxTxMinL"><span>Product value you prefer (optional)</span><input id="bxTxMin" inputmode="numeric" placeholder="Any" value="${cp.min_product_value!=null?H(cp.min_product_value):""}"></label>
        <label class="b2-agree"><input type="checkbox" id="bxTxAgree"${(window.__bxMeta && __bxMeta.bx_terms_ack) ? " checked" : ""}><i></i><span>You decide on each offer. Ad rights, exclusivity and deadlines are always shown before you accept.</span></label>
        <div class="auth-err" id="bxTxMsg"></div>
        <button type="button" class="b2-btn forest full" id="bxTxSave">Save</button>`;
      const terms = document.getElementById("bxTxTerms"), msg = t=> document.getElementById("bxTxMsg").textContent = t;
      const sync = ()=>{ const o = [...terms.querySelectorAll(".b2-term.on")].map(b=> b.dataset.v), barterOnly = o.includes("barter") && !o.includes("paid") && !o.includes("hybrid");
        document.getElementById("bxTxRates").style.display = document.getElementById("bxTxRateH").style.display = barterOnly ? "none" : "";
        document.getElementById("bxTxMinL").style.display = o.includes("paid") && !o.includes("barter") && !o.includes("hybrid") ? "none" : ""; };
      terms.querySelectorAll(".b2-term").forEach(b=> b.onclick = ()=>{ b.classList.toggle("on"); sync(); }); sync();
      document.getElementById("bxTxSave").onclick = async ()=>{
        const b = document.getElementById("bxTxSave"), o = [...terms.querySelectorAll(".b2-term.on")].map(x=> x.dataset.v);
        if(!document.getElementById("bxTxAgree").checked) return msg("Tick the box to confirm you've read this.");
        if(window.B2 && B2.ackTerms) B2.ackTerms();
        const num = id=> { const v = String(document.getElementById(id).value||"").replace(/[^\d.]/g,""); return v === "" ? null : Number(v); };
        const patch = {}, min = num("bxTxMin");
        if(o.length && K.termsPatch) Object.assign(patch, K.termsPatch(o));
        patch.min_product_value = min;
        const rates = RATES.map(([t],i)=> [t, num("bxTxR" + i)]).filter(([t,v])=> v != null && v > 0 && v !== rateOf(t));
        b.disabled = true; b.textContent = "Saving…"; msg("");
        let r = await api("save_profile_section", { p_section:"commercial_preference", p_patch:patch, p_correlation:"ui-hub" });
        for(const [t,v] of rates){ if(r.error) break; r = await api("save_rate_card_item", { p_payload:{ deliverable_type:t, amount:v }, p_correlation:"ui-hub" }); }
        if(r.error){ b.disabled = false; b.textContent = "Save"; return msg("Couldn't save: " + (r.error.message || r.error)); }
        b.textContent = "✓ Saved"; setTimeout(()=> rebuild("terms"), 700);
      };
    }
    const closeOne = ()=>{ c.classList.remove("b2-hub-open"); delete c.dataset.one; window.scrollTo(0,0); };
    document.getElementById("bxHubBack").onclick = ()=>{ const s = history.state; if(s && s.bxh && s.k === "s" && String(s.v).indexOf("hub:") === 0){ history.back(); return; } closeOne(); };
    const kidT = document.getElementById("bxHubKid"); if(kidT) kidT.onchange = async ()=>{ if(window.bxKid){ await bxKid.save({ avatar: kidT.checked }); if(window.bxPaintMeChip) bxPaintMeChip(); const h = document.getElementById("bxHub"); if(h) h.remove(); touchProfile(); } };
    c.querySelectorAll("[data-hub]").forEach(b=> b.onclick = ()=>{
      const k = b.dataset.hub;
      if(k.startsWith("#")){   // one section of the profile, nothing else
        c.dataset.one = k.slice(1); c.classList.add("b2-hub-open"); window.scrollTo(0,0);
        if(window.BxHist) BxHist.mark("s", "hub:" + k, { role: currentRole, page: "profile" });
        return;
      }
      if(k === "*cats") return onb(1);
      if(k === "@rates"){ if(typeof openMkEdit === "function" && acct) return openMkEdit("ratecard", acct); return go("mediakit"); }
      go(k);
    });
    if(window.__bxHubOpen){ const k1 = window.__bxHubOpen; window.__bxHubOpen = null; const r1 = c.querySelector(`[data-hub="#${k1}"]`); if(r1) r1.click(); }
  }

  /* ---------- M11 campaign brief: the app's brief opens as a page, not a pop-up ---------- */
  function touchBrief(pop){
    if(!document.body.classList.contains("bx") || pop.dataset.bx) return; pop.dataset.bx = 1;
    pop.classList.add("bx-brief"); document.body.style.overflow = "";
    const box = pop.querySelector(".ci-pop-box"), head = pop.querySelector(".ci-pop-head"); if(!box || !head) return;
    const title = (head.querySelector("h3")||{}).textContent || "", brand = (head.querySelector(".muted")||{}).textContent || "";
    const hit = window.B2 && (B2.openList||[]).find(x=> String(x.name||"").trim() === String(title).trim());
    if(hit && window.B2 && B2.briefHtml){
      const x = Object.assign({}, hit);
      if(!x.who_can_apply && x.eligibility && Array.isArray(x.eligibility.criteria)) x.who_can_apply = x.eligibility.criteria.map(c=> c.need).filter(Boolean);
      const act = pop.querySelector(".ci-pop-foot [data-apply]") || [...pop.querySelectorAll(".ci-pop-foot button, .ci-pop-foot .btn")].find(b=> b.id !== "ciPopClose" && !/back/i.test(b.textContent));
      const closer = document.getElementById("ciPopX") || document.getElementById("ciPopClose");
      const stage = x.my_stage ? String(x.my_stage).replace(/_/g," ") : "";
      const wrap = document.createElement("div"); wrap.className = "b2 b2-briefwrap";
      wrap.innerHTML = B2.briefHtml(x, { applyLabel:"Apply to campaign →", sub: stage ? "You've already applied — track it in My campaigns." : "You review and accept terms if selected." });
      box.innerHTML = ""; box.appendChild(wrap);
      const slot = wrap.querySelector(".b2-applybox [data-apply]");
      if(stage){ slot.outerHTML = `<div class="b2-applied">✓ ${H(stage.replace(/^./,c=>c.toUpperCase()))}</div>`; }
      else if(act){ act.className = "b2-btn cyan full" + (/not eligible/i.test(act.textContent) ? " ne" : ""); if(!/not eligible/i.test(act.textContent)) act.innerHTML = "Apply to campaign&nbsp; →"; slot.replaceWith(act); }
      else if(x.applications_closed){ slot.outerHTML = `<div class="b2-applied">Applications closed</div>`; }
      wrap.querySelector("[data-go]").onclick = ()=>{ if(closer) closer.click(); else { pop.remove(); document.body.style.overflow = ""; } };
      pop.scrollTop = 0; window.scrollTo(0,0);
      return;
    }
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
  /* V2-29 bell popover: "Notifications" + "Mark all read" header, alert list, "View all alerts" at the foot (no tabs here) */
  function touchAlerts(){
    const dr = document.getElementById("notifDrawer"), body = document.getElementById("notifBody"); if(!dr || !body || !document.body.classList.contains("b2app")) return;
    dr.classList.add("b2-notif");
    const head = dr.querySelector(".drawer-head"); if(!head) return;
    const st = head.querySelector("strong"); if(st && st.textContent !== "Notifications") st.textContent = "Notifications";
    const all = head.querySelector("#notifAll"); if(all){ const old = dr.querySelector(":scope > .b2-notif-all"); if(old && old !== all) old.remove(); all.textContent = "View all alerts →"; all.classList.add("b2-notif-all"); dr.appendChild(all);
      if(!all.dataset.b2){ all.dataset.b2 = 1; all.onclick = null; all.addEventListener("click", e=>{ e.preventDefault(); e.stopImmediatePropagation(); const cl = document.getElementById("notifClose"); if(cl) cl.click(); const ov = document.getElementById("notifOverlay"); if(ov) ov.classList.remove("open"); go("messages"); }, true); } }
    if(st && !head.querySelector(".b2-notif-mark")){ const mk = document.createElement("button"); mk.type = "button"; mk.className = "b2-notif-mark"; mk.textContent = "Mark all read";
      mk.onclick = ()=>{ const b = body.querySelector("#opsMarkAll"); if(b) b.click(); else body.querySelectorAll(".ops-alert").forEach(r=> r.classList.add("read")); };
      st.after(mk); }
    const top = body.querySelector("#opsMarkAll"); if(top && top.parentElement && !top.parentElement.classList.contains("b2-hide")) top.parentElement.classList.add("b2-hide");
  }

  function tabsFor(body){
    if(!body || body.querySelector(".bx-al-tabs")) return;
    const rows = [...body.querySelectorAll(".ops-alert")];
    const act = rows.filter(r=> r.classList.contains("act") || r.querySelector("[data-act]"));
    const hasMark = [...body.querySelectorAll("button,a")].some(b=> /mark all read/i.test(b.textContent));
    body.insertAdjacentHTML("afterbegin", `<div class="bxg-chips bx-al-tabs b2-tabs"><button type="button" data-t="all" class="on">All</button><button type="button" data-t="act">Action needed</button><button type="button" data-t="upd">Updates</button></div>${hasMark?"":`<div class="b2-markall"><button type="button" class="b2-link sm" id="b2MarkAll">Mark all read</button></div>`}`);
    const ma = body.querySelector("#b2MarkAll"); if(ma) ma.onclick = ()=>{ rows.forEach(r=> r.classList.add("read")); ma.disabled = true; };
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
    const a = (typeof mkFetchAcct === "function") ? await mkFetchAcct() : null; if(box.querySelector("#bxPulse")) return;
    if(!a){ // no Instagram yet: say what this page will show and how to unlock it (instead of a blank page)
      box.insertAdjacentHTML("afterbegin", `<div id="bxPulse" class="b2-anempty"><div class="card b2-perf b2-ana-empty">
        <div class="b2-ana-empty-ic" aria-hidden="true">📊</div>
        <h3 class="serif">Connect Instagram to see your analytics</h3>
        <p>Followers, reach, engagement and your best posts appear here once your Instagram is connected. Your campaign history shows here too.</p>
        <ul><li>📈 Performance over time</li><li>💡 Insights on what works for you</li><li>📌 Pin your top posts to your media kit</li></ul>
        <button type="button" class="b2-btn forest" id="bxAnaConnect">Connect Instagram →</button>
        <div class="b2-ana-empty-note">🛡 Official Meta connection. No password shared. Disconnect anytime.</div></div></div>`);
      const cb = document.getElementById("bxAnaConnect");
      if(cb) cb.onclick = ()=>{ if(typeof connectInstagram === "function") connectInstagram(); else go("mediakit"); };
      return;
    }
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
    box.insertAdjacentHTML("afterbegin", `<div id="bxPulse" class="b2-angrid"><div class="b2-anl" id="b2AnL">
      <div class="b2-sec ink">— Performance over time —</div>
      <div class="card b2-perf">${pts.length > 1 ? `<div class="b2-bars3">${pts.map((m,i)=>{ const v = L[i] + C[i], mx = Math.max(1, ...pts.map((q,j)=> L[j]+C[j])); return `<i class="${i===pts.length-1?"last":""}" style="height:${Math.max(6, Math.round(100*v/mx))}%" title="${new Date(m.timestamp).toLocaleDateString("en-IN",{day:"numeric",month:"short"})}: ${L[i]} likes, ${C[i]} comments"></i>`; }).join("")}</div>
        <div class="b2-perf-l">Likes + comments · last ${pts.length} posts</div>` : `<div class="muted">The chart appears after a couple of posts sync from Instagram.</div>`}</div>
      </div><div class="b2-anr">
      <div class="b2-sec ink">— Insights —</div>
      <div class="card b2-ins"><ul>${best[0]?`<li>Your best post got ${eng(best[0])} likes + comments — lead with posts like it</li>`:""}${topGA?`<li>Top audience: ${H(topGA.replace(/^F\./,"Women ").replace(/^M\./,"Men "))}${topCity?" · "+H(String(topCity).split(",")[0]):""}</li>`:""}${media.length?`<li>${media.length} posts synced from Instagram</li>`:""}<li>Pin your best work below — brands see it first</li></ul></div>
      ${best.length ? `<div class="b2-sec ink">— Your top content —</div><div class="b2-toplist">${best.map(m=>`<div class="b2-toprow"><a href="${H(m.permalink||"#")}" target="_blank" rel="noopener"><img src="${H(img(m))}" alt="" referrerpolicy="no-referrer"></a>
          <div class="tx"><b>${H(String(m.caption||"").split("\n")[0].slice(0,40) || (m.media_type==="VIDEO"?"Reel":"Post") + " · " + new Date(m.timestamp).toLocaleDateString("en-IN",{day:"numeric",month:"short"}))}</b><span>❤ ${eng(m)} likes + comments</span></div>
          <button type="button" class="b2-pin${pins.includes(String(m.id))?" on":""}" data-pin="${H(m.id)}">${pins.includes(String(m.id))?"📌 Pinned":"📌 Pin to media kit"}</button></div>`).join("")}</div>` : ""}
      ${TIP("Pin the posts that did best — brands see them first in your media kit.")}</div></div>`);
    const anaTop = document.querySelector(".b2-ana"), anL = document.getElementById("b2AnL"); if(anaTop && anL) anL.insertBefore(anaTop, anL.firstChild);
    box.querySelectorAll("[data-pin]").forEach(b=> b.onclick = async ()=>{
      const id = b.dataset.pin, on = pins.includes(id);
      if(!on && pins.length >= 6){ if(typeof gateToast==="function") gateToast("You can pin up to 6 — unpin one in Media kit → Edit."); return; }
      const next = on ? pins.filter(p=> p !== id) : pins.concat(id);
      b.disabled = true;
      const { error } = await sb.from("social_accounts").update({ edits: Object.assign({}, a.edits || {}, { pinned: next }), updated_at: new Date().toISOString() }).eq("id", a.id);
      b.disabled = false;
      if(error){ if(typeof gateToast==="function") gateToast("Couldn't pin: " + error.message); return; }
      pins = next; a.edits = Object.assign({}, a.edits || {}, { pinned: next });
      b.textContent = on ? "📌 Pin to media kit" : "📌 Pinned"; b.classList.toggle("on", !on);
    });
  }

  /* ---------- V2-22 / W06 My media kit — the Figma layout on the creator's real data.
     The app's own kit (#mkHeadWrap, refreshed every 60 s) keeps running underneath for its share / edit / sync logic. ---------- */
  let _mkProf = null, _mkProfLast = null, _mkSig = "", _mkWorkN = 9;
  async function touchMediaKit(){
    const c = document.getElementById("content"); if(!c || currentPage !== "mediakit") return;
    const head = c.querySelector(":scope > .page-head");
    if(head && !head.dataset.b2){ head.dataset.b2 = 1; head.innerHTML = `<div><div class="b2-eyebrow">Your creator portfolio</div><h1>My media kit</h1><p>Your story, your work, your impact.</p></div>`; }
    const body = document.getElementById("mkBody"), hw = document.getElementById("mkHeadWrap"); if(!body || !hw) return;
    // the old kit never flashes while the new one loads: it stays hidden (b2-mkready not set yet) behind the v2 skeleton
    body.classList.add("b2-mkhost");
    if(!body.classList.contains("b2-mkready") && !document.getElementById("b2MkSk")) hw.insertAdjacentHTML("beforebegin", `<div id="b2MkSk">${SK.kit()}</div>`);
    if(!hw.querySelector(".mk-kit")) return;
    const a = (window._mkLastAcct) || ((typeof mkFetchAcct === "function") ? await mkFetchAcct().catch(()=> null) : null); if(!a || !body.isConnected) return;
    if(!_mkProf && window.__ciProfileEnabled){ const r = await api("get_my_profile"); if(!r.error) _mkProf = r.data || {}; }
    _mkProfLast = _mkProf || _mkProfLast;
    const sig = [a.id, a.updated_at, a.followers_count, JSON.stringify(a.edits||{}).length, !!_mkProf].join("|");
    if(document.getElementById("b2Mk") && sig === _mkSig) return; _mkSig = sig;
    const pro = (_mkProf && _mkProf.professional) || {}, cp = (_mkProf && _mkProf.commercial_preference) || {};
    const E = (typeof mkEdits === "function") ? mkEdits(a) : (a.edits || {});
    const all = (typeof mkAllMedia === "function" ? mkAllMedia(a) : (a.recent_media||[]));
    const eng = (a.followers_count && all.length) ? (100 * all.slice(0,12).reduce((t,m)=> t + (+m.like_count||0) + (+m.comments_count||0), 0) / Math.min(all.length,12) / a.followers_count).toFixed(1) + "%" : "—";
    const reels = all.filter(m=> m.media_type === "VIDEO" && m.video_views);
    const n = v => typeof fmtNum === "function" ? fmtNum(v||0) : String(v||0);
    const third = reels.length ? [n(Math.round(reels.reduce((t,m)=> t + (+m.video_views||0), 0)/reels.length)), "Avg Reel views"] : a.avg_reach ? [n(a.avg_reach), "Avg reach"] : [n(Math.round(all.reduce((t,m)=> t + (+m.like_count||0), 0)/Math.max(all.length,1))), "Avg likes"];
    // audience bars (top 3 gender·age groups) + top cities
    const aud = a.audience || {}, ga = aud.gender_age || {}, tot = Object.values(ga).reduce((t,v)=> t + (+v||0), 0);
    const GL = { F:"Women", M:"Men", U:"Others" };
    const bars = tot ? Object.entries(ga).sort((x,y)=> y[1]-x[1]).slice(0,3).map(([k,v])=>{ const m = String(k).match(/^([FMU])\W+(.+)$/); const lbl = m ? `${GL[m[1]]} ${m[2].replace("-","–")}` : k; const p = Math.round(100*v/tot); return `<div class="b2-ab"><span>${H(lbl)}</span><i><b style="width:${p}%"></b></i><em>${p}%</em></div>`; }).join("") : "";
    const cities = Object.entries(aud.city || {}).sort((x,y)=> y[1]-x[1]).slice(0,3).map(([k])=> String(k).split(",")[0]);
    // the work I'm proud of: pinned first, then best posts
    const pinIds = Array.isArray(E.pinned) ? E.pinned.map(String) : [];
    const engOf = m => (+m.like_count||0) + (+m.comments_count||0);
    // one place for every post: pinned first, then best ones, then the rest — 9 at a time with Load more (no second "showcase" / "top posts")
    const work = pinIds.map(id=> all.find(m=> String(m.id) === id)).filter(Boolean).concat(all.slice().sort((x,y)=> engOf(y)-engOf(x))).filter((m,i,arr)=> arr.indexOf(m) === i);
    const img = m => m.media_type === "VIDEO" ? (m.thumbnail_url || m.media_url) : m.media_url;
    // let's create together
    // open to = what they picked in Your terms (nothing picked → nothing claimed)
    const open = (window.B2 && B2.onbKit && B2.onbKit.termsLabel) ? B2.onbKit.termsLabel(cp).split(", ").filter(Boolean) : [];
    // rates = the one rate card from Your terms (Reel / Story / Post); the old media-kit list only if that is empty
    const tRates = ((_mkProf && _mkProf.rate_cards && _mkProf.rate_cards[0] && _mkProf.rate_cards[0].items) || []).filter(i=> i && Number(i.amount) > 0)
      .slice(0,3).map(i=> `${H(String(i.deliverable_type).replace(/^IG\s+/,"").replace("Static ",""))} ₹${Number(i.amount).toLocaleString("en-IN")}`);
    const rates = tRates.length ? tRates : (Array.isArray(E.rate_card) ? E.rate_card : []).filter(r=> r && r.item).slice(0,3).map(r=> `${H(r.item)} from ${H(r.price||"—")}`);
    const box = document.getElementById("b2Mk") || document.createElement("div");
    box.id = "b2Mk"; box.className = "b2 b2-mk";
    const tile = m => `<a href="${H(m.permalink||"#")}" target="_blank" rel="noopener"><img src="${H(img(m))}" alt="" referrerpolicy="no-referrer"></a>`;
    const workHtml = ()=> `${work.slice(0, _mkWorkN).map(tile).join("")}`;
    const moreHtml = ()=> work.length > _mkWorkN ? `<button type="button" class="b2-btn light b2-mkmore" data-mk="more">Load more <span>(${work.length - _mkWorkN} more)</span></button>` : "";
    box.innerHTML = `
        <div class="b2-mkid"><button type="button" class="b2-mkpen" data-mk="edit" aria-label="Edit media kit">✎ Edit</button>${a.profile_picture_url?`<img src="${H(a.profile_picture_url)}" alt="">`:`<span class="b2-ini">${H(String(a.username||"C").charAt(0).toUpperCase())}</span>`}
          <div class="b2-mkn"><b>${H(a.name || a.username)}</b><span>@${H(a.username)}${pro.city_coarse?" · "+H(pro.city_coarse):""}</span>${(pro.categories||[]).length||(pro.languages||[]).length?`<em>${H([].concat((pro.categories||[]).slice(0,3),(pro.languages||[]).slice(0,2)).join(" · "))}</em>`:""}</div>
          <div class="b2-nums"><div><b>${n(a.followers_count)}</b><span>Followers</span></div><div><b>${eng}</b><span>Engagement</span></div><div><b>${third[0]}</b><span>${third[1]}</span></div></div>
          ${(()=>{ const bio = E.bio || a.biography || "", avgL = all.length ? Math.round(all.reduce((t,m)=> t + (+m.like_count||0), 0) / all.length) : 0;
            return `${bio ? `<p class="b2-mkbio">${H(bio)}</p>` : ""}${a.website ? `<a class="b2-mkweb" href="${H(a.website)}" target="_blank" rel="noopener">🔗 ${H(String(a.website).replace(/^https?:\/\//,""))}</a>` : ""}<div class="b2-mkmini">${n(a.media_count || all.length)} total posts · ${n(avgL)} avg likes</div>`; })()}</div>
        <div class="b2-mkbtns2"><button type="button" class="b2-btn forest" data-mk="share">🔗 Share link</button><button type="button" class="b2-btn light" data-mk="pdf">⤓ Download PDF</button></div>
        <div class="b2-mkacct"><span>📸</span><b>@${H(a.username)}</b><em class="b2-chip2 ok">✓ Connected</em><a href="#" data-mk="add">+ Add account</a></div>
        <div class="b2-sec ink">— Who follows my story —</div>
        <div class="b2-card b2-aud">${bars || `<p class="b2-p it sm">Audience shows once Instagram shares it (needs 100+ followers and insights access).</p>`}${cities.length?`<p class="b2-cities">Top cities: ${H(cities.join(" · "))}</p>`:""}</div>
        <div class="b2-sec ink">— The work I'm proud of —</div>
        ${work.length ? `<div class="b2-mkgrid" id="b2MkWork">${workHtml()}</div><div class="b2-mkmorew">${moreHtml()}</div>` : `<div class="b2-card"><p class="b2-p it sm">Your posts show up here once Instagram has synced.</p></div>`}`;
    // after the old kit's Work portfolio + Mentions: terms, publish, a closing line
    let tail = document.getElementById("b2MkTail"); if(!tail){ tail = document.createElement("div"); tail.id = "b2MkTail"; tail.className = "b2 b2-mk b2-mktail"; }
    tail.innerHTML = `<div class="b2-sec ink">— Let's create together —</div>
        <div class="b2-card b2-together"><b>${open.length ? "Open to: " + H(open.join(" · ")) : "Set what you're open to"}</b>${rates.length?`<span>${rates.join(" · ")}</span>`:``}${!open.length || !rates.length ? `<a href="#" data-mkterms>${open.length ? "Add your rates" : "Set your terms & rates"} →</a>` : `<a href="#" data-mkterms>Change terms & rates →</a>`}<i>Rates shown only to brands you apply to</i></div>
        <button type="button" class="b2-btn forest full b2-mkpub" data-mk="publish">📸 Publish to Instagram →</button>
        <p class="b2-quote ink">Get discovered by brands you love.<br>Build the creator career you want.</p>
        ${TIP("Tap ✎ Edit on your card to pin your 6 best posts — brands look there first.")}`;
    if(!box.isConnected) body.insertBefore(box, hw);
    { const sk = document.getElementById("b2MkSk"); if(sk) sk.remove(); } body.classList.add("b2-mkready");
    if(tail.previousElementSibling !== hw) hw.after(tail);
    [box, tail].forEach(root=> root.querySelectorAll("[data-mkterms]").forEach(b=> b.onclick = e=>{ e.preventDefault(); _mkProf = null; window.__bxHubOpen = "terms"; go("profile"); }));
    const wire = root=> root.querySelectorAll("[data-mk]").forEach(b=> b.onclick = e=>{ e.preventDefault(); const k = b.dataset.mk;
      if(k === "more"){ _mkWorkN += 9; const g = document.getElementById("b2MkWork"); if(g) g.innerHTML = workHtml(); const mw = box.querySelector(".b2-mkmorew"); if(mw){ mw.innerHTML = moreHtml(); wire(mw); } return; }
      if(k === "publish"){ const pc = document.getElementById("mkComposeCta"); if(pc) return pc.click(); currentPage = "instagram"; return renderShell(); }
      if(k === "share"){ const s2 = document.getElementById("mkShare"); if(s2) return s2.click(); if(typeof openKitShare === "function") return openKitShare(a); }
      if(k === "edit"){ if(typeof openMkEdit === "function") return openMkEdit("profile", a); }
      if(k === "add"){ if(typeof igAddAnother === "function") return igAddAnother("mediakit"); const t = document.querySelector(".mk-topbar button"); if(t) t.click(); }
      if(k === "pdf"){ const u = (typeof kitPublicUrl === "function") ? kitPublicUrl(a) : "/p.html?u=" + encodeURIComponent(a.username); const w = window.open(u + (u.includes("?")?"&":"?") + "print=1", "_blank", "noopener"); if(!w && typeof gateToast === "function") gateToast("Allow pop-ups to download your media kit PDF."); }
    });
    wire(box); wire(tail);
  }

  /* ---------- V2-24 Analytics header: creator pulse + 4 numbers ---------- */
  async function touchAnaHead(){
    const c = document.getElementById("content"); if(!c || currentPage !== "reports") return;
    const head = c.querySelector(":scope > .page-head"); if(!head) return;
    if(!head.dataset.b2){ head.dataset.b2 = 1; head.innerHTML = `<div><div class="b2-eyebrow">Creator pulse</div><h1>Analytics</h1><p>How your content is doing — from Instagram.</p></div>`; }
    if(c.querySelector(".b2-ana") || touchAnaHead.busy) return; touchAnaHead.busy = true;
    let a = null; try{ a = (typeof mkFetchAcct === "function") ? await mkFetchAcct().catch(()=> null) : null; } finally { touchAnaHead.busy = false; }
    if(!a || !head.isConnected || c.querySelector(".b2-ana")) return;
    const media = (typeof mkAllMedia === "function" ? mkAllMedia(a) : (a.recent_media||[]));
    const eng = (a.followers_count && media.length) ? (100 * media.reduce((t,m)=> t + (+m.like_count||0) + (+m.comments_count||0), 0) / media.length / a.followers_count).toFixed(1) + "%" : "—";
    const avgL = media.length ? Math.round(media.reduce((t,m)=> t + (+m.like_count||0), 0) / media.length) : 0;
    const n = v => typeof fmtNum === "function" ? fmtNum(v||0) : String(v||0);
    const anL0 = document.getElementById("b2AnL");
    (anL0 ? anL0 : head).insertAdjacentHTML(anL0 ? "afterbegin" : "afterend", `<div class="b2 b2-ana"><div class="b2-pills"><span class="on">@${H(a.username)}</span><span>Last ${Math.min(media.length,12)||0} posts</span></div>
      <div class="b2-k4"><div><b>${n(a.followers_count)}</b><span>Followers</span></div><div><b>${a.avg_reach?n(a.avg_reach):"—"}</b><span>Avg reach</span></div>
        <div><b>${n(avgL)}</b><span>Avg likes</span></div><div><b>${eng}</b><span>Engagement</span></div></div></div>`);
  }

  /* ---------- M22 Inbox: campaign updates at the top of Messages (same alerts, actions and "Mark all read") ---------- */
  function touchInbox(){
    const c = document.getElementById("content"); if(!c || c.querySelector("#bxInbox")) return;
    c.insertAdjacentHTML("afterbegin", `<div class="b2 b2-inbox" id="bxInbox"><h1 class="b2-h1">Inbox</h1><p class="b2-sub">Campaign alerts, Instagram DMs and WhatsApp — all in one place.</p>
      <div class="b2-ibpanes" role="tablist"><button type="button" class="on" data-ibp="up">🔔 Alerts</button><button type="button" data-ibp="ig">📸 Instagram DMs</button><button type="button" data-ibp="wa">💬 WhatsApp</button></div>
      <div class="b2-ibcols" id="bxIbUp"><div class="b2-ibtabs" role="tablist"><button type="button" class="on" data-ib="all">All</button><button type="button" data-ib="act">Action needed</button><button type="button" data-ib="upd">Updates</button></div>
      <div class="b2-ibmark"><button type="button" id="bxIbMark">Mark all read</button></div>
      <div id="bxIbList">${SK.alerts(3)}</div><div class="b2-ibtip">${TIP("Red dot = something only you can do.")}</div></div></div>`);
    const box = document.getElementById("bxInbox");
    // the old Messages page's Instagram DMs + WhatsApp chats, as tabs of the Inbox (same panes, same loading)
    document.body.dataset.ibp = "up";
    const pane = k=>{ document.body.dataset.ibp = k; box.querySelectorAll("[data-ibp]").forEach(x=> x.classList.toggle("on", x.dataset.ibp === k));
      if(k === "up") return;
      let n = 0; const t = setInterval(()=>{ n++; const b = document.querySelector(`#msgTabs [data-msgtab="${k}"]`); if(b){ clearInterval(t); b.click(); }
        else if(n > 40){ clearInterval(t); if(typeof mountMessagesTabs === "function") mountMessagesTabs(); } }, 150); };
    box.querySelectorAll("[data-ibp]").forEach(b=> b.onclick = ()=> pane(b.dataset.ibp));
    if(window.__ibOpen){ const k0 = window.__ibOpen; window.__ibOpen = null; pane(k0); }
    box.querySelectorAll("[data-ib]").forEach(b=> b.onclick = ()=>{ IB.tab = b.dataset.ib; box.querySelectorAll("[data-ib]").forEach(x=> x.classList.toggle("on", x === b)); paintInbox(); });
    document.getElementById("bxIbMark").onclick = async ()=>{
      const unread = IB.items.filter(n=> !n.read); if(!unread.length) return;
      IB.items.forEach(n=> n.read = true); paintInbox();
      await api("mark_all_notifications_read"); if(window.ciOps && ciOps.updateAlertsBadge) ciOps.updateAlertsBadge();
    };
    IB.tab = "all"; loadInbox();
  }
  /* ---------- V2-21 Inbox: the Figma list on the creator's real notifications ---------- */
  const IB = { items:[], tab:"all", loaded:false };
  const GEEK_WA = "916398566704";
  const ibAct = n => n.kind === "action_required" && !n.acted;
  const ibMsg = n => n.kind === "message" || /^geek( team)?\b/i.test(n.title || "");
  function ibWhen(d){
    const t = new Date(d); if(isNaN(t)) return "";
    const now = new Date(), day = 864e5, start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if(t.getTime() >= start) return t.toLocaleTimeString("en-IN", { hour:"2-digit", minute:"2-digit", hour12:false });
    if(t.getTime() >= start - day) return "Yesterday";
    if(t.getTime() >= start - 6*day) return t.toLocaleDateString("en-IN", { weekday:"short" });
    return t.toLocaleDateString("en-IN", { day:"numeric", month:"short" });
  }
  async function loadInbox(){
    const r = await api("get_my_notifications", { p_only_unread:false });
    IB.items = (r && !r.error && Array.isArray(r.data)) ? r.data : []; IB.loaded = true; IB.err = r && r.error ? (r.error.message || "error") : "";
    paintInbox();
  }
  function ibOpen(n){
    let route = n.action_route; if(!route) return;
    route = ({ onboarding:"profile", alerts:"messages", growth:"mycampaigns", barter:"opencampaigns", marketplace:"opencampaigns", campaignops:"mycampaigns", approvals:"mycampaigns" })[route] || route;
    if(String(route).indexOf("admin:") === 0) route = "mycampaigns";
    go(route);
  }
  window.bxInbox = { state: IB, paint: ()=> paintInbox(), reload: ()=> loadInbox() };
  function paintInbox(){
    const list = document.getElementById("bxIbList"); if(!list) return;
    const mk = document.getElementById("bxIbMark"); if(mk) mk.disabled = !IB.items.some(n=> !n.read);
    if(IB.err){ list.innerHTML = `<div class="b2-ib empty">Couldn't load your inbox. <button type="button" class="b2-ib-btn" id="bxIbRetry">Try again</button></div>`; document.getElementById("bxIbRetry").onclick = ()=>{ list.innerHTML = SK.alerts(3); loadInbox(); }; return; }
    const rows = IB.items.filter(n=> IB.tab === "all" || (IB.tab === "act" ? ibAct(n) : !ibAct(n)));
    if(!rows.length){ list.innerHTML = `<div class="b2-ib empty">${IB.tab === "act" ? "Nothing needs you right now. We'll tell you the moment something does." : IB.tab === "upd" ? "No updates yet." : "No alerts yet. When something needs you, it'll show here."}</div>`; return; }
    list.innerHTML = rows.map(n=>{
      const act = ibAct(n), msg = ibMsg(n);
      const btn = msg ? `<button type="button" class="b2-ib-btn" data-ibr="${H(n.notification_id)}">Reply</button>`
        : n.action_route ? `<button type="button" class="b2-ib-btn${act ? " pri" : ""}" data-ibg="${H(n.notification_id)}">${H(n.action_label || "Open")}</button>` : "";
      return `<div class="b2-ib${act ? " act" : ""}${n.read ? "" : " unread"}" data-nid="${H(n.notification_id)}"><i class="b2-ib-dot ${msg ? "msg" : act || !n.read ? "red" : ""}"></i>
        <div class="b2-ib-h"><b>${H(n.title || "Update")}</b><time>${H(ibWhen(n.created_at))}</time></div>
        ${n.body ? `<p>${H(String(n.body).replace(/[*_`]/g,""))}</p>` : ""}${btn}</div>`;
    }).join("");
    const find = id => IB.items.find(n=> String(n.notification_id) === String(id));
    list.querySelectorAll(".b2-ib[data-nid]").forEach(row=> row.onclick = ()=>{
      const n = find(row.dataset.nid); if(!n || n.read) return; n.read = true; row.classList.remove("unread");
      const dot = row.querySelector(".b2-ib-dot"); if(dot && !ibAct(n) && !ibMsg(n)) dot.classList.remove("red");
      api("mark_notification_read", { p_id:n.notification_id }).then(()=> window.ciOps && ciOps.updateAlertsBadge && ciOps.updateAlertsBadge());
      const m2 = document.getElementById("bxIbMark"); if(m2) m2.disabled = !IB.items.some(x=> !x.read);
    });
    list.querySelectorAll("[data-ibg]").forEach(b=> b.onclick = e=>{ e.stopPropagation(); const n = find(b.dataset.ibg); if(!n) return;
      n.read = true; if(n.kind === "action_required") n.acted = true;
      api("mark_notification_acted", { p_id:n.notification_id }).then(()=> window.ciOps && ciOps.updateAlertsBadge && ciOps.updateAlertsBadge()); ibOpen(n); });
    list.querySelectorAll("[data-ibr]").forEach(b=> b.onclick = e=>{ e.stopPropagation(); const n = find(b.dataset.ibr); if(n && !n.read){ n.read = true; api("mark_notification_read", { p_id:n.notification_id }); }
      window.open(`https://wa.me/${GEEK_WA}?text=${encodeURIComponent("Hi Geek team, about: " + ((n && n.title) || "my campaign") + " — ")}`, "_blank", "noopener"); });
  }

  /* ---------- M32 Settings & privacy (new page) ---------- */
  try{
    if(typeof NAV_META !== "undefined" && !NAV_META.bxsettings) NAV_META.bxsettings = { ic:"⚙", label:"Settings" };
    if(typeof ROLES !== "undefined" && ROLES.creator && !ROLES.creator.nav.includes("bxsettings")) ROLES.creator.nav.push("bxsettings");
    if(typeof PAGES !== "undefined" && !PAGES.bxsettings) PAGES.bxsettings = () => `<div class="b2 b2-page b2-set">${HEAD("My account","Settings &amp; privacy","You stay in control of your data.")}<div id="bxSetBody">${SK.set()}</div></div>`;
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
    box.innerHTML = `<div class="b2-setgrid"><div>
      <div class="b2-card b2-skid"><img src="${KI()}" data-kid-me alt=""><div><b>Sidekick: ${H(KN())}</b><span>${H((k.vibe||"playful").replace(/^./,x=>x.toUpperCase()))} · ${H(LANG[k.lang]||"Match me")} · ${H(k.scene==="forest"?"Forest":k.scene==="parchment"?"Parchment":"Auto scene")}</span></div><button type="button" class="b2-mini light" data-s="kid">Change</button></div>
      <div class="b2-sec ink">— Notifications —</div>
      <div class="b2-card b2-tlist">
        <label class="b2-tog"><span>WhatsApp campaign alerts${n.whatsapp_linked?"":" <em>(link WhatsApp first)</em>"}</span><input type="checkbox" id="bxSetWa"${n.whatsapp_linked && !n.whatsapp_off ? " checked" : ""}${n.whatsapp_linked ? "" : " disabled"}><i></i></label>
        <label class="b2-tog"><span>Email updates</span><input type="checkbox" id="bxSetEm"${!n.email_off ? " checked" : ""}><i></i></label>
        <label class="b2-tog"><span>Growth tips from ${H(KN())}</span><input type="checkbox" id="bxSetTips"${k.vibe==="focused" || k.tips==="asked" ? "" : " checked"}><i></i></label></div>
      <div class="b2-sec ink">— Connected accounts —</div>
      <div class="b2-card b2-accl">${accts.length ? accts.map(x=>`<div><span>📸</span><b>@${H(x.username)}</b><em class="b2-chip2 ok">✓ Connected</em><button type="button" class="b2-link sm" data-s="manage">Manage</button></div>`).join("") : `<div><span>📸</span><b>No Instagram connected</b><button type="button" class="b2-mini forest" data-s="connect">Connect</button></div>`}
        ${waNum?`<div><span>💬</span><b>WhatsApp ${H(waNum)}</b></div>`:""}</div>
      </div><div>
      <div class="b2-sec ink">— Your data —</div>
      <button type="button" class="b2-card b2-dl" data-s="download"><b>⤓ Download my data</b><span>Profile, Instagram and campaigns as a file</span></button>
      <button type="button" class="b2-card b2-dl" data-s="cookies"><b>🍪 Cookie settings</b><span>Essential only or allow analytics — change any time</span></button>
      <div class="b2-del"><b>Delete my account</b><p>Removes your profile and campaign history. Type DELETE to confirm.</p><button type="button" class="b2-mini red" data-s="delete">Delete account</button><div id="bxDel"></div></div>
      ${TIP("Alerts off? You'll still see every update in Inbox.")}</div></div>`;
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
    box.querySelector('[data-s="cookies"]').onclick = ()=>{ if(window.Consent && Consent.reopen) Consent.reopen(); };
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
    const c0 = document.getElementById("content"); if(c0) c0.classList.remove("b2-hubpage","b2-hub-open");
    const r = _rs.apply(this, arguments);
    if(currentPage !== "dashboard") document.body.classList.remove("b2-home-on");
    if(currentPage !== "mycampaigns"){ MC.init = false; MC.act = false; }
    if(isCreator()){
      if(currentPage === "bxpayments") loadPayments();
      if(currentPage === "bxsettings") loadSettings();
      if(currentPage === "profile"){
        const c1 = document.getElementById("content");
        if(c1 && !c1.querySelector("#bxHub") && !c1.querySelector("#bxHubSk")){ c1.classList.add("b2-hubpage"); c1.insertAdjacentHTML("afterbegin", SK.hub());
          setTimeout(()=>{ const sk = document.getElementById("bxHubSk"); if(sk && !document.getElementById("bxHub")){ sk.remove(); c1.classList.remove("b2-hubpage"); } }, 9000); }
        setTimeout(touchProfile, 400);
      }
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
  // V2-12: each campaign card shows the 5-step track (Applied · Selected · Agreement · Create · Publish) + the attention banner
  const KEY5 = { "Applied":"Applied", "Selected":"Selected", "Contract":"Agreement", "Brief":"Create", "Posted":"Publish" };
  function track5(card){
    const tr = card.querySelector(".jr-track"); if(!tr || tr.dataset.b2) return; tr.dataset.b2 = 1;
    const steps = [...tr.querySelectorAll(".jr-step")]; let nowIdx = steps.findIndex(x=> x.classList.contains("now")); if(nowIdx < 0) nowIdx = steps.length;
    const keep = steps.map((x,i)=>({ x, i, k: KEY5[(x.querySelector("span")||{}).textContent] })).filter(o=> o.k);
    let nowSet = false;
    keep.forEach((o,j)=>{ o.x.classList.add("k5"); o.x.querySelector("span").textContent = o.k;
      const nextI = keep[j+1] ? keep[j+1].i : steps.length;
      o.x.classList.remove("done","now");
      if(nextI <= nowIdx) o.x.classList.add("done");
      else if(!nowSet && o.i <= nowIdx){ o.x.classList.add("now"); nowSet = true; }
      const ic = o.x.querySelector("i"); if(ic) ic.textContent = ""; });
    steps.forEach(x=>{ if(!x.classList.contains("k5")) x.classList.add("k5h"); });
  }
  /* V2-12 card: "Brand · Campaign", status line, 5-step track, 📅/🎁 lines, one action button; full details on tap */
  function slimCard(card){
    if(card.dataset.b2s) return; const top = card.querySelector(".mc-top"); if(!top) return; card.dataset.b2s = 1; card.classList.add("b2-mc");
    const h4 = top.querySelector("h4"), sub = top.querySelector(".mc-title .muted"), pill = top.querySelector(".ci-pill");
    const brand = sub ? sub.textContent.split("·")[0].trim() : "";
    if(h4 && brand && !h4.textContent.includes("·")){ const t = h4.textContent.trim(); const rest = t.toLowerCase().indexOf(brand.toLowerCase()) === 0 ? t.slice(brand.length).trim() : t; if(rest) h4.textContent = brand + " · " + rest; }
    const nowH = (card.querySelector(".jr-now-h b")||{}).textContent || "";
    const st = card.querySelector(".jr-step.k5.now span"); const step = st ? st.textContent : (pill ? pill.textContent : "");
    const ptxt = pill ? pill.textContent.trim() : "";
    const act = /sign|confirm|upload|submit|post it|add your|accept|review|share/i.test(nowH);
    const done = /complete|done|paid/i.test(ptxt) && !act, lost = /not selected|rejected|declined/i.test(ptxt);
    const line = document.createElement("div"); line.className = "b2-mcst " + (act ? "act" : done ? "ok" : lost ? "off" : "prog");
    line.textContent = act ? "Action needed · " + step : done ? "Completed" : lost ? "Not selected" : (/applied/i.test(ptxt) ? "In review · Applied" : "In progress · " + step);
    top.querySelector(".mc-title").appendChild(line);
    const meta = card.querySelector(".mc-meta");
    if(meta){ const sp = [...meta.children]; const type = (meta.querySelector(".ci-type")||{}).textContent || ""; const who = (meta.querySelector("b")||{}).textContent || ""; const date = sp.length ? sp[sp.length-1].textContent.replace(/^[^0-9A-Za-z]+/,"") : "";
      const info = document.createElement("div"); info.className = "b2-mcinfo";
      info.innerHTML = `${date?`<div>📅 ${H(date)}</div>`:""}<div>🎁 ${H(type.replace(/^[^A-Za-z]+/,"").trim() || "Campaign")}${who?` · @${H(who.replace(/^@/,""))}`:""}</div>`;
      const jr0 = card.querySelector(".jr"); (jr0 || meta).after(info); }
    const jr = card.querySelector(".b2-mcinfo") || card.querySelector(".jr");
    const row = document.createElement("div"); row.className = "b2-mcact";
    const ask = top.querySelector(".mc-ask"); if(ask){ ask.textContent = "💬 Ask us"; row.appendChild(ask); }
    const b = document.createElement("button"); b.type = "button"; b.className = "b2-mcgo" + (act ? "" : " light");
    const lbl = () => card.classList.contains("b2-open") ? "Hide details ▴" : (act ? (nowH.replace(/[.!]$/,"") || "Open") + " →" : "View details ▾");
    b.textContent = lbl(); b.onclick = ()=>{ card.classList.toggle("b2-open"); b.textContent = lbl(); };
    row.appendChild(b); (jr || card.lastElementChild).after(row);
  }
  const MC = { act:false, n:0 };
  function mcApplyAct(){
    const c = document.getElementById("content"), tabs = c && c.querySelector(".mc-tabs"); if(!tabs) return;
    const at = tabs.querySelector(".b2-acttab"); if(!at) return;
    if(MC.act){ tabs.querySelectorAll(".mc-tab").forEach(t=> t.classList.toggle("act", t === at)); }
    else at.classList.remove("act");
    let shown = 0;
    c.querySelectorAll(".mc-card").forEach(card=>{ const keep = !MC.act || !!card.querySelector(".b2-mcst.act"); card.classList.toggle("b2-hide", !keep); if(keep) shown++; });
    let em = document.getElementById("b2McEmpty");
    if(MC.act && !shown){ if(!em){ const body = document.getElementById("opsMineBody"); if(body){ body.insertAdjacentHTML("afterbegin", `<div class="b2-card b2-mcempty" id="b2McEmpty">Nothing needs you right now — we'll tell you the moment something does.</div>`); } } }
    else if(em) em.remove();
  }
  function touchMine(){
    const c = document.getElementById("content"); if(!c || currentPage !== "mycampaigns") return;
    c.querySelectorAll(".mc-card").forEach(track5);
    c.querySelectorAll(".mc-card").forEach(slimCard);
    const tabs = c.querySelector(".mc-tabs");
    if(tabs && !tabs.dataset.b2){ tabs.dataset.b2 = 1; const L = { "All time":"All", "Running now":"In progress", "Applied / waiting":"Applied", "Completed":"Completed", "Not selected":"Not selected" };
      tabs.querySelectorAll(".mc-tab").forEach(t=>{ const sp = t.querySelector("span"), bb = t.querySelector("b"); if(sp){ const k = sp.textContent.replace(/^[^A-Za-z]+/,"").trim(); if(L[k]) sp.textContent = L[k]; if(k==="All time") t.classList.add("b2-first"); }
        if(bb && /^\d$/.test(bb.textContent.trim())) bb.textContent = "0" + bb.textContent.trim(); }); }
    // Figma tabs: All · Action needed · In progress · Completed (Applied / Not selected kept after them)
    if(tabs && !tabs.querySelector(".b2-acttab")){
      const ord = { All:1, Active:3, Done:4, Upcoming:5, Declined:6 };
      tabs.querySelectorAll(".mc-tab").forEach(t=>{ t.style.order = ord[t.dataset.minetab] || 7; t.addEventListener("click", ()=>{ MC.act = false; }, true); });
      tabs.insertAdjacentHTML("beforeend", `<button type="button" class="mc-tab b2-acttab" style="order:2"><b>00</b><span>Action needed</span></button>`);
      tabs.querySelector(".b2-acttab").onclick = ()=>{ const all = tabs.querySelector('[data-minetab="All"]'); if(all && !all.classList.contains("act")) all.click(); MC.act = true; mcApplyAct(); };
    }
    if(tabs){ const allOn = tabs.querySelector('[data-minetab="All"].act'); const nAct = c.querySelectorAll(".b2-mc .b2-mcst.act").length; if(allOn || nAct > MC.n) MC.n = allOn ? nAct : Math.max(MC.n, nAct);
      const b = tabs.querySelector(".b2-acttab b"); if(b){ const t = String(MC.n).padStart(2, "0"); if(b.textContent !== t) b.textContent = t; } }
    if(tabs && !MC.init){ MC.init = true; const all = tabs.querySelector('[data-minetab="All"]'); if(all && !all.classList.contains("act")) setTimeout(()=> all.click(), 0); }
    c.querySelectorAll(".mc-pager").forEach(pg=>{ const bs = [...pg.querySelectorAll("button")]; const one = bs.length && bs.filter(b=> /Prev|Next/.test(b.textContent)).every(b=> b.disabled); pg.classList.toggle("b2-hide", one); });
    mcApplyAct();
    const body = document.getElementById("opsMineBody");
    if(body && body.querySelector(".mc-card")){ const words = ["No","One","Two","Three","Four","Five"], na = MC.n;
      const tt = na ? `${words[na] || na} little step${na>1?"s":""}, then you're rolling!` : "Brands reply on WhatsApp — we'll ping you the moment there's news.";
      let tp = document.getElementById("b2McTip"); if(!tp){ body.insertAdjacentHTML("afterend", `<div id="b2McTip" class="b2-mctip">${TIP(tt)}</div>`); }
      else if(!tp.textContent.includes(tt)) tp.innerHTML = TIP(tt); }
    if(body){ const act = [...c.querySelectorAll(".mc-card .jr-now.act, .mc-card .jr-now")].filter(x=> /sign|confirm|upload|submit|post|add|accept|review/i.test(x.textContent)).length;
      let ban = document.getElementById("b2Attn");
      if(act){ if(!ban){ ban = document.createElement("div"); ban.id = "b2Attn"; ban.className = "b2 b2-attn"; body.parentNode.insertBefore(ban, body); } ban.textContent = `⚠ ${act} thing${act>1?"s":""} need${act>1?"":"s"} your attention`; }
      else if(ban) ban.remove(); }
    const intro = c.querySelector(".ci-intro"); if(!intro || intro.dataset.b2) return; intro.dataset.b2 = 1;
    intro.classList.add("b2-intro","b2-intro-mc"); intro.innerHTML = `<div class="b2-eyebrow">Your creator journey</div><h1 class="b2-h1">My campaigns</h1><p class="b2-sub">Every collaboration, all in one place.</p>`;
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
  /* ---------- V2-11B / W33 "not eligible" as the v2 sheet ---------- */
  function touchElig(el){
    if(!document.body.classList.contains("b2app") || el.dataset.b2) return; el.dataset.b2 = 1;
    el.classList.add("b2-elig");
    const box = el.querySelector(".ci-pop-box"); if(!box) return;
    box.insertAdjacentHTML("afterbegin", `<i class="b2-grab"></i><img class="b2-elig-kid" src="${KI()}" data-kid-me alt="">`);
    const h = box.querySelector(".ci-pop-head h3"); if(h && /not eligible/i.test(h.textContent)) h.textContent = "You're not eligible for this one";
    const foot = box.querySelector(".ci-pop-foot"); if(foot) foot.insertAdjacentHTML("afterend", TIP("Missing info? Add it in Profile and check again."));
  }
  let q = false;
  new MutationObserver(()=>{ if(q) return; q = true; requestAnimationFrame(()=>{ q = false;
    const pop = document.getElementById("ciPop"); if(pop && !pop.dataset.bx) touchBrief(pop);
    const el = document.getElementById("ciElig"); if(el && !el.dataset.b2) touchElig(el);
    touchAlerts(); touchMe();
    if(isCreator() && currentPage === "profile" && !document.getElementById("bxHub")) touchProfile();
    if(isCreator() && currentPage === "reports"){ touchAnalytics(); touchAnaHead(); }
    if(isCreator() && currentPage === "mediakit") touchMediaKit();
    if(isCreator() && currentPage === "messages") touchInbox();
    if(isCreator()){ touchSteps(); touchMine(); }
  }); }).observe(document.body, { childList:true, subtree:true });
  // nav label + icon for the new page (bounty-creator.js names the rest)
  window.__bxExtraNav = { bxpayments:["Payments","coins"], bxsettings:["Settings","gear"] };
})();
