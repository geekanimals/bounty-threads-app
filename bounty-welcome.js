/* Bounty — creator welcome, WhatsApp sign-in and guest explore (Figma M01–M03 / W01, G1–G4 / W33–W37).
   Only for the creator door. The WhatsApp OTP logic is the app's own (login.js mountLogin): this file only
   gives it the Bounty screen, using the same element ids, so sign-in works exactly as before.
   Guests can look around (Home, Discover, every brief) with no WhatsApp and no Instagram; anything that
   needs an account (apply, track, media kit…) asks for WhatsApp first, and Apply carries the campaign through
   sign-in (the app's existing ?apply= flow opens it right after). */
(function(){
  if(typeof window.mountLogin !== "function" || typeof window.loginView !== "function") return;
  const A = "/assets/bounty/";
  if(((typeof LOGIN_DOOR !== "undefined" ? LOGIN_DOOR : (window.GEEK_DOOR || "creator"))) === "creator") document.documentElement.classList.add("bx-door");
  const door = () => (typeof LOGIN_DOOR !== "undefined" ? LOGIN_DOOR : (window.GEEK_DOOR || "creator"));
  const creatorDoor = () => door() === "creator";
  const inviteSignup = (mode) => typeof INVITE_TOKEN !== "undefined" && INVITE_TOKEN && mode === "signup";
  const E = s => String(s==null?"":s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const IC = {
    check:'<path d="m5 12 4 4 10-10"/>', lock:'<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    coins:'<circle cx="9" cy="9" r="6"/><path d="M15.5 9.5A6 6 0 1 1 9.5 15.5"/>', shield:'<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
    back:'<path d="m15 18-6-6 6-6"/>', home:'<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    compass:'<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>', clip:'<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4h6v3H9zM9 11h6M9 15h4"/>',
    layers:'<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>', chart:'<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>', user:'<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    megaphone:'<path d="M3 11v3a1 1 0 0 0 1 1h3l6 4V6L7 10H4a1 1 0 0 0-1 1zM17 9a4 4 0 0 1 0 6"/>', img:'<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 17-5-5-9 8"/>',
    search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', login:'<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/>'
  };
  const svg = k => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[k]}</svg>`;
  const TARGET = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#D3A94E"/><circle cx="12" cy="12" r="8" fill="#C2362F"/><circle cx="12" cy="12" r="5" fill="#F4E8CE"/><circle cx="12" cy="12" r="2.4" fill="#C2362F"/></svg>';
  const LOGO = `<span class="bx-logo" aria-label="Bounty">B${TARGET}UNTY</span>`;

  /* =================== Welcome + WhatsApp sign-in (same ids as login.js) =================== */
  function welcomeHtml(){
    return `<div class="bxw" id="bxw">
      <header class="bxw-top">${LOGO}</header>
      <div class="bxw-body">
        <section class="bxw-hero">
          <div class="bx-eyebrow">✦ For Instagram creators ✦</div>
          <h1>Get discovered by brands you love.</h1>
          <h2>Build the creator career you want.</h2>
          <div class="bxw-orn" aria-hidden="true">— ✦ —</div>
          <p class="bxw-lead">Paid, barter and hybrid campaigns from real brands — clear briefs, tracked steps and on-time payments.</p>
          <p class="bxw-adv">Your next adventure starts here.</p>
          <ul class="bxw-points">
            <li>${svg("check")}Free for creators — brands pay, never you</li>
            <li>${svg("lock")}We never post for you or see your password</li>
            <li>${svg("coins")}Every payment tracked with receipts</li>
          </ul>
          <img class="bxw-sprout" src="${A}sprout_wave.png" alt="Sprout, your sidekick">
          <div class="bxw-cta">
            <button type="button" class="bxb gold" data-bx="signin">Begin my journey ›</button>
            <button type="button" class="bxb outline" data-bx="signin">Sign in ›</button>
            <button type="button" class="bxb link" data-bx="explore">Explore first</button>
            <small>Explore campaigns without signing in. Verify WhatsApp only when you apply.</small>
          </div>
        </section>
        <section class="bxw-card" id="bxCard">
          <button type="button" class="bxw-back" data-bx="back">${svg("back")}Back</button>
          <h3 id="bxCardH"><span class="d-only">Log in or sign up</span><span class="m-only">WhatsApp number</span></h3>
          <p class="bxw-sub" id="bxCardP"><span class="d-only">We'll send a one-time code on WhatsApp.</span><span class="m-only">Sign in with WhatsApp to apply for campaigns and track your collaborations.</span></p>
          <div id="cinvBanner"></div>
          <form id="waDoorForm" class="auth-form bxw-form">
            <div class="bxw-phone" id="bxPhoneBox"><label for="waPhoneIn">WhatsApp number</label><div class="bxw-pre"><span>+91</span><input name="phone" id="waPhoneIn" placeholder="Enter your 10-digit number" required inputmode="tel" autocomplete="tel"></div></div>
            <div class="bxw-hint" id="bxPhoneHint">We'll send a one-time code to verify your number.</div>
            <div class="bxw-sentto" id="bxSentTo" style="display:none"><span id="bxMasked"></span> | <a href="#" id="bxChange">Change number</a></div>
            <div id="waCodeRow" style="display:none"><label class="bxw-code-l">✦ Verification code ✦<input name="code" id="waCodeIn" class="bxw-code" inputmode="numeric" maxlength="6" placeholder="" autocomplete="one-time-code"></label>
              <div class="bxw-boxes" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>
              <div class="auth-mini"><span id="waSentTo" style="display:none"></span><a href="#" id="waChange" style="display:none">Change number</a><span id="bxResendT">Resend code in 00:30</span><a href="#" id="waResend" style="display:none">Resend code</a></div></div>
            <div class="auth-err" id="authErr"></div>
            <button class="bxb gold auth-submit" id="waGo" type="submit"><span class="d-only">Send code on WhatsApp ›</span><span class="m-only">Send code ›</span></button>
          </form>
          <div class="bxw-or d-only"><span>or</span></div>
          <button type="button" class="bxb outline-ink d-only" data-bx="explore">Explore campaigns first ›</button>
          <div class="bxw-note d-only" id="bxNoteD">${svg("shield")}<span>Browsing needs no sign-in. WhatsApp is only needed when you apply.</span></div>
          <div class="bxw-mexplore m-only"><img src="${A}sprout_point.png" alt=""><button type="button" class="bxb link-ink" data-bx="explore">I'll explore first</button>
            <small id="bxExploreSmall">Browse campaigns without signing in. WhatsApp verification is only required when you apply.</small></div>
          <div class="bxw-note" id="bxSafe">${svg("shield")}<span>We never ask for your WhatsApp password.</span></div>
        </section>
      </div>
    </div>`;
  }

  const _loginView = window.loginView;
  window.loginView = function(role, mode){
    if(!creatorDoor() || inviteSignup(mode)) return _loginView.apply(this, arguments);
    return welcomeHtml();
  };
  const _mountLogin = window.mountLogin;
  window.mountLogin = function(mode, role){
    const r = _mountLogin.apply(this, arguments);
    const root = document.getElementById("authRoot");
    const mine = root && root.querySelector("#bxw");
    document.body.classList.toggle("bx-pre", !!mine);
    if(!mine) return r;
    leaveGuest(true);
    const w = root.querySelector("#bxw");
    // straight to the form when the creator came to apply / from an invite / asked to sign in
    const q = new URLSearchParams(location.search);
    if(q.get("apply") || q.get("cinv") || q.get("from") || window.__bxWantForm){ w.classList.add("form"); window.__bxWantForm = false; }
    w.querySelectorAll("[data-bx]").forEach(b=> b.addEventListener("click", ()=>{
      const k = b.dataset.bx;
      if(k === "signin"){ w.classList.add("form"); setTimeout(()=>{ const p = document.getElementById("waPhoneIn"); if(p) p.focus(); }, 60); }
      if(k === "back") w.classList.remove("form");
      if(k === "explore") startGuest();
    }));
    // M03 / W12: once the code is sent → "One little code, then you're in.", masked number, 6 boxes, resend timer
    const row = document.getElementById("waCodeRow"), h = document.getElementById("bxCardH"), p = document.getElementById("bxCardP"), hint = document.getElementById("bxPhoneHint");
    const phoneBox = document.getElementById("bxPhoneBox"), sent = document.getElementById("bxSentTo"), masked = document.getElementById("bxMasked");
    const codeIn = document.getElementById("waCodeIn"), boxes = w.querySelectorAll(".bxw-boxes i");
    const rsT = document.getElementById("bxResendT"), rsA = document.getElementById("waResend");
    const H0 = h.innerHTML, P0 = p.innerHTML; let timer = null;
    const startTimer = ()=>{ clearInterval(timer); let s = 30; rsA.style.display = "none"; rsT.style.display = "";
      const tick = ()=>{ rsT.textContent = "Resend code in 00:" + String(s).padStart(2,"0"); if(s-- <= 0){ clearInterval(timer); rsT.style.display = "none"; rsA.style.display = ""; } }; tick(); timer = setInterval(tick, 1000); };
    if(row) new MutationObserver(()=>{
      const on = row.style.display !== "none";
      w.classList.toggle("otp", on);
      h.innerHTML = on ? "One little code, then you're in." : H0;
      p.innerHTML = on ? "Enter the 6-digit code sent to your WhatsApp number." : P0;
      if(hint) hint.style.display = on ? "none" : "";
      if(phoneBox) phoneBox.style.display = on ? "none" : "";
      sent.style.display = on ? "" : "none";
      if(on){ const d = String(document.getElementById("waPhoneIn").value||"").replace(/\D/g,"").slice(-10); masked.textContent = "+91 ••••• ••" + d.slice(-3); startTimer();
        document.getElementById("bxSafe").innerHTML = `${svg("shield")}<span><b>Bounty will never ask for this code.</b><br>Never share your verification code with anyone.</span>`;
        const sm = document.getElementById("bxExploreSmall"); if(sm) sm.textContent = "Browse freely. WhatsApp verification is only needed when you apply."; }
      else { clearInterval(timer); document.getElementById("bxSafe").innerHTML = `${svg("shield")}<span>We never ask for your WhatsApp password.</span>`; }
    }).observe(row, { attributes:true, attributeFilter:["style"] });
    document.getElementById("bxChange").onclick = e=>{ e.preventDefault(); document.getElementById("waChange").click(); };
    rsA.addEventListener("click", ()=> setTimeout(startTimer, 50));
    if(codeIn) codeIn.addEventListener("input", ()=>{ const v = codeIn.value.replace(/\D/g,"").slice(0,6); if(v !== codeIn.value) codeIn.value = v; boxes.forEach((b,i)=>{ b.textContent = v[i] || ""; b.classList.toggle("on", i === v.length); }); });
    // keep the Bounty button wording when login.js resets it
    const go = document.getElementById("waGo");
    const mob = () => window.matchMedia("(max-width:860px)").matches;
    if(go) new MutationObserver(()=>{ const t = go.textContent;
      if(/Send OTP on WhatsApp/.test(t)) go.innerHTML = '<span class="d-only">Send code on WhatsApp ›</span><span class="m-only">Send code ›</span>';
      else if(/^Verify & sign in/.test(t)) go.textContent = "Verify & continue ›";
      else if(/^Sending OTP/.test(t)) go.textContent = "Sending code…"; })
      .observe(go, { childList:true, characterData:true, subtree:true });
    return r;
  };

  /* =================== Guest explore =================== */
  let G = { on:false, page:"home", list:null, f:"all", q:"", brief:null };
  const kind = c => c.campaign_type || ({cash:"paid",hybrid:"barter_paid",barter:"barter"})[c.comp_type] || "";
  const KL = { paid:"Paid", barter:"Barter", barter_paid:"Hybrid" };
  const money = v => "₹" + Number(v).toLocaleString("en-IN");
  const fdate = d => { try{ return new Date(d+"T00:00:00").toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"}); }catch(e){ return d; } };
  const compLine = c => { const k = kind(c), parts = [KL[k] || "Campaign"]; if(c.product_value) parts.push((k==="paid"?"":"Product ") + money(c.product_value)); return parts.join(" · "); };

  async function loadList(){
    if(G.list) return G.list;
    try{ const r = await sb.rpc("explore_campaigns"); G.list = (r && !r.error && r.data) || []; G.err = r && r.error ? 1 : 0; }
    catch(e){ G.list = []; G.err = 1; }
    return G.list;
  }
  function toSignIn(applyId){
    if(G.member){ return pageNeedsIg(document.getElementById("content"), applyId); }
    if(applyId){ try{ localStorage.setItem("geek_apply", applyId); }catch(e){} location.href = "/app.html?apply=" + encodeURIComponent(applyId); return; }
    window.__bxWantForm = true; mountLogin("login");
  }
  function startGuest(){
    const root = document.getElementById("authRoot");
    if(root){ root.classList.remove("open"); root.innerHTML = ""; }
    document.body.classList.remove("bx-pre");
    if(window.hideBootSplash) hideBootSplash();
    G.on = true; window.__bxGuest = true;
    document.body.classList.add("bx","bx-guest");
    guestChrome(); go("home");
  }
  function leaveGuest(quiet){
    if(!G.on) return; G.on = false; window.__bxGuest = false;
    document.body.classList.remove("bx-guest");
    if(!quiet) document.body.classList.remove("bx");
  }
  // the app boots for real after sign-in — drop guest mode first
  if(typeof window.bootOS === "function"){
    const _boot = window.bootOS;
    window.bootOS = function(){ leaveGuest(true); return _boot.apply(this, arguments); };
  }

  const NAV = [["Today",[["home","Home","home"]]],["Campaigns",[["discover","Discover","compass"],["lock:mycampaigns","My campaigns","clip"]]],
    ["Create & grow",[["lock:mediakit","Media kit","layers"],["lock:reports","Analytics","chart"]]],["My account",[["lock:profile","Profile","user"]]]];
  const BOTTOM = [["home","Home","home"],["lock:mycampaigns","Campaigns","megaphone"],["__sprout","Sprout",""],["lock:reports","Analytics","chart"],["lock:profile","Profile","user"]];
  const DUP = new Set(BOTTOM.map(b=> b[0]));

  function guestChrome(){
    if(window.__bxChrome) window.__bxChrome();     // logo, next-move slot, trust links, bottom bar (bounty-creator.js)
    const nav = document.getElementById("nav");
    if(nav){
      nav.innerHTML = NAV.map(([t, items])=>{
        const all = items.every(i=> DUP.has(i[0]));
        return `<div class="nav-sec${all?" bx-dup":""}">${t}</div>` + items.map(([k,l,ic])=>`<a data-g="${k}" class="${DUP.has(k)?"bx-dup":""}"><span class="ic">${svg(ic)}</span><span>${l}</span>${k.startsWith("lock:")?'<i class="bx-lk">'+svg("lock")+'</i>':""}</a>`).join("");
      }).join("");
      nav.querySelectorAll("[data-g]").forEach(a=> a.onclick = ()=>{ go(a.dataset.g); document.getElementById("sidebar").classList.remove("open"); });
    }
    const next = document.getElementById("bxNext");
    if(next){ next.innerHTML = `<span class="tg">${TARGET}</span><span><b>Browsing as guest</b><i>Sign in when you're ready</i></span>`; next.onclick = ()=> toSignIn(); }
    const l = document.getElementById("aiLaunch");
    if(l){ l.innerHTML = `<img src="${A}sprout_wave.png" alt=""><span><b>Ask Sprout</b><i>Help with anything</i></span>`; l.onclick = ()=> go("sprout"); }
    const menu = document.getElementById("menuBtn"); if(menu && !menu.onclick) menu.onclick = ()=> document.getElementById("sidebar").classList.toggle("open");
    const th = document.getElementById("themeBtn"); if(th && !th.onclick && typeof toggleTheme==="function") th.onclick = toggleTheme;
    const st = document.getElementById("searchTrigger"); if(st) st.onclick = e=>{ if(!G.on) return; e.stopImmediatePropagation(); go("discover"); setTimeout(()=>{ const i = document.getElementById("bxgQ"); if(i) i.focus(); }, 50); };
    const bell = document.getElementById("bellBtn"); if(bell) bell.onclick = e=>{ if(!G.on) return; go("lock:alerts"); };
    const me = document.getElementById("me"); if(me){ me.innerHTML = svg("login"); me.title = "Sign in"; me.onclick = ()=>{ if(G.on) toSignIn(); }; }
    const nc = document.getElementById("notifCount"); if(nc) nc.style.display = "none";
  }
  function paintBottom(){
    const bar = document.getElementById("bxBottom"); if(!bar) return;
    bar.innerHTML = BOTTOM.map(([k,l,ic])=> k==="__sprout"
      ? `<button type="button" class="sp" data-g="sprout" aria-label="Ask Sprout"><span class="orb"><img src="${A}sprout_wave.png" alt=""></span>${l}</button>`
      : `<button type="button" data-g="${k}" class="${k===G.page||(k==="home"&&G.page==="home")?"on":""}">${svg(ic)}${l}</button>`).join("");
    bar.querySelectorAll("button").forEach(b=> b.onclick = ()=> go(b.dataset.g));
  }
  function paintNavActive(){
    document.querySelectorAll("#nav [data-g]").forEach(a=> a.classList.toggle("active", a.dataset.g === G.page || (G.page.startsWith("brief:") && a.dataset.g==="discover")));
  }

  async function go(page){
    if(!G.on && !G.member) return;
    G.page = page;
    document.body.dataset.pg = page.split(":")[0];
    document.body.dataset.bg = (page==="home" || page==="discover") ? "forest" : "parch";
    if(G.on){ paintNavActive(); paintBottom(); }
    const c = document.getElementById("content"); if(!c) return;
    window.scrollTo(0,0);
    if(page === "home") return pageHome(c);
    if(page === "discover") return pageDiscover(c);
    if(page.startsWith("brief:")) return pageBrief(c, page.slice(6));
    if(page === "sprout") return pageSprout(c);
    if(page.startsWith("lock:")) return pageLock(c, page.slice(5));
  }

  const TRUST = `<div class="bx-trust">${svg("shield")}Bounty is free for creators · brands are verified by Geek · payment status on every campaign.</div>`;
  const tip = (t, pose) => `<div class="bxg-tip"><img src="${A}sprout_${pose||"point"}.png" alt=""><div>${t}</div></div>`;
  function card(c){
    const k = kind(c);
    return `<article class="bxg-camp" data-id="${E(c.campaign_id)}">
      <div class="bxg-cover"><span class="bxg-ini">${E(String(c.brand||c.name||"B").trim().charAt(0).toUpperCase())}</span><span class="bxg-type t-${E(k||"x")}">${E(KL[k]||"Campaign")}</span></div>
      <div class="bxg-body"><h4>${E(c.brand||"Brand")} · ${E(c.name||"Campaign")}</h4>
        <div class="bxg-comp">${E(compLine(c))}${c.ends_on?` · till ${E(fdate(c.ends_on))}`:""}</div>
        <span class="bxg-match">${svg("lock")}${G.member ? "Connect Instagram to see your match" : "Sign in to see your match"}</span>
        <button type="button" class="btn" data-brief="${E(c.campaign_id)}">View brief ›</button></div></article>`;
  }
  function wireCards(root){
    root.querySelectorAll("[data-brief]").forEach(b=> b.onclick = e=>{ e.stopPropagation(); go("brief:" + b.dataset.brief); });
    root.querySelectorAll(".bxg-camp").forEach(a=> a.onclick = ()=> go("brief:" + a.dataset.id));
  }

  async function pageHome(c){
    c.innerHTML = `<div class="page-head"><div><div class="bx-eyebrow">✦ Browsing as guest</div><h1>Your next move.</h1><p>Get discovered by brands you love. Build the creator career you want.</p></div></div>
      <div class="grid bxg-hero-row">
        <div class="card bx-hero bxg-next"><div><span class="bxg-pill">Start here</span><b>Explore live campaigns</b><div class="muted">Read every brief first. Verify WhatsApp only when you apply.</div>
          <div class="bxg-btns"><button type="button" class="btn" data-go="discover">Explore campaigns ›</button><button type="button" class="btn ghost" data-go="signin">Sign in</button></div></div></div>
      </div>
      <div class="bx-divider">✦ Made for your world ✦</div>
      <div class="bxg-grid" id="bxgFeat"><div class="muted">Loading campaigns…</div></div>
      ${tip("You can look around freely — I'll ask for WhatsApp only when you apply.","wave")}
      ${TRUST}`;
    c.querySelectorAll("[data-go]").forEach(b=> b.onclick = ()=> b.dataset.go==="signin" ? toSignIn() : go(b.dataset.go));
    const list = await loadList(); if(G.page !== "home") return;
    const box = document.getElementById("bxgFeat");
    box.innerHTML = list.length ? list.slice(0,3).map(card).join("") : `<div class="card muted">${G.err?"Couldn't load campaigns right now — please refresh in a moment.":"No campaigns are open right now. New ones are added often — check back soon."}</div>`;
    wireCards(box);
  }

  async function pageDiscover(c){
    c.innerHTML = `<div class="page-head"><div><div class="bx-eyebrow">✦ Discover</div><h1>Explore campaigns</h1><p>${G.member ? "Read every brief. Connect Instagram when you're ready to apply." : "No sign-in needed to browse. Verify WhatsApp only when you apply."}</p></div></div>
      <div class="bxg-bar"><label class="bxg-search">${svg("search")}<input id="bxgQ" placeholder="Search campaigns, brands or city" value="${E(G.q)}"></label>
        <div class="bxg-chips">${[["all","All"],["paid","Paid"],["barter","Barter"],["barter_paid","Hybrid"]].map(([k,l])=>`<button type="button" data-f="${k}" class="${G.f===k?"on":""}">${l}</button>`).join("")}</div></div>
      <div class="bxg-grid" id="bxgList"><div class="muted">Loading campaigns…</div></div>
      ${tip("You can look around freely — I'll ask for WhatsApp only when you apply.","wave")}`;
    const paint = ()=>{
      const box = document.getElementById("bxgList"); if(!box) return;
      const q = G.q.toLowerCase();
      const rows = (G.list||[]).filter(x=>{
        const k = kind(x);
        if(G.f!=="all" && k!==G.f) return false;
        return !q || [x.name,x.brand,x.product,x.category,(x.cities||[]).join(" "),x.brief].join(" ").toLowerCase().includes(q);
      });
      box.innerHTML = rows.length ? rows.map(card).join("") : `<div class="card muted">${(G.list||[]).length ? "Nothing matches — try another filter." : (G.err ? "Couldn't load campaigns right now — please refresh in a moment." : "No campaigns are open right now. New ones are added often — check back soon.")}</div>`;
      wireCards(box);
    };
    c.querySelectorAll("[data-f]").forEach(b=> b.onclick = ()=>{ G.f = b.dataset.f; c.querySelectorAll("[data-f]").forEach(x=> x.classList.toggle("on", x===b)); paint(); });
    let t; document.getElementById("bxgQ").oninput = e=>{ clearTimeout(t); t = setTimeout(()=>{ G.q = e.target.value.trim(); paint(); }, 180); };
    await loadList(); if(G.page === "discover") paint();
  }

  async function pageBrief(c, id){
    c.innerHTML = `<div class="muted">Loading brief…</div>`;
    const list = await loadList(); if(G.page !== "brief:" + id) return;
    const x = list.find(r=> String(r.campaign_id) === id);
    if(!x){ c.innerHTML = `<button type="button" class="bxg-back" data-go="discover">${svg("back")}Back to campaigns</button><div class="card muted">This campaign isn't open any more. <a href="#" data-go="discover">See the live ones</a>.</div>`; c.querySelectorAll("[data-go]").forEach(b=> b.onclick = e=>{ e.preventDefault(); go("discover"); }); return; }
    const k = kind(x), b = x.video_brief || {}, t = x.terms || {}, noProd = k === "paid";
    const row = (l,v)=> v ? `<div class="bxg-kv"><span>${l}</span><b>${v}</b></div>` : "";
    const txt = (l,v)=> v ? `<div class="bxg-sec">${l}</div><div class="bxg-pre">${E(v)}</div>` : "";
    const tags = [].concat(x.hashtags||[], (x.mentions||[]).map(m=> String(m).charAt(0)==="@" ? m : "@"+m));
    const terms = [];
    if(t.content_days) terms.push(`Post within <b>${E(t.content_days)} days</b> of ${noProd?"getting the video brief":"receiving the product"}`);
    terms.push("Submit your video in the app first — post <b>only after the brand approves it</b>");
    if(t.ad_rights_months) terms.push(`Ad rights: the brand may use your content for <b>${E(t.ad_rights_months)} month${t.ad_rights_months>1?"s":""}</b>`);
    if(t.collab_rights) terms.push("Add the brand as an Instagram <b>collaborator</b> on the post");
    if(k && k!=="barter") terms.push("<b>Paid:</b> your fee is agreed with you one to one and written into your own contract");
    terms.push("Disclose the collaboration (Paid partnership / #ad) as per ASCI");
    const who = (x.who_can_apply||[]).filter(Boolean);
    const refs = b.reference_links ? String(b.reference_links).split(/[\s,]+/).filter(Boolean).map(u=> /^https?:\/\//i.test(u) ? `<a href="${E(u)}" target="_blank" rel="noopener">${E(u)}</a>` : E(u)).join("<br>") : "";
    c.innerHTML = `<button type="button" class="bxg-back" data-go="discover">${svg("back")}Back to campaigns</button>
      <div class="card bxg-brief-head"><div class="bxg-cover big"><span class="bxg-ini">${E(String(x.brand||x.name||"B").trim().charAt(0).toUpperCase())}</span></div>
        <div class="bxg-bh"><div class="bx-eyebrow">${E(x.brand||"Brand")}</div><h1>${E(x.name||"Campaign")}</h1>
          <div class="bxg-comp">${E(compLine(x))}</div><span class="bxg-match">${svg("lock")}${G.member ? "Connect Instagram to see your match" : "Sign in to see your match"}</span></div></div>
      <div class="bxg-cols">
        <div class="card"><h3>Overview</h3>
          ${row("Product", x.product?E(x.product):"")}${row("Product value", x.product_value?E(money(x.product_value)):"")}
          ${row("Product link", x.product_link?`<a href="${E(x.product_link)}" target="_blank" rel="noopener">Open</a>`:"")}
          ${row("Category", x.category?E(x.category):"")}${row("Platforms", x.platforms?E(x.platforms):"")}
          ${row("Deliverables", x.deliverables_text?E(x.deliverables_text):"")}
          ${row("Cities", (x.cities||[]).length?E(x.cities.join(", ")):"")}${row("Languages", (x.languages||[]).length?E(x.languages.join(", ")):"")}
          ${row("Dates", (x.starts_on||x.ends_on)?E((x.starts_on?fdate(x.starts_on):"Now")+" – "+(x.ends_on?fdate(x.ends_on):"open")):"")}
          ${row("Creators needed", x.creators_needed?E(x.creators_needed):"")}
          <div class="bxg-sec">Who can apply</div>${who.length?`<ul class="bxg-ul">${who.map(w=>`<li>${E(w)}</li>`).join("")}</ul>`:`<div class="bxg-pre">Open to every creator — no extra criteria.</div>`}
          ${txt("Brief", x.brief)}
          ${tags.length?`<div class="bxg-sec">Hashtags &amp; mentions</div><div class="bxg-tags">${tags.map(s=>`<span>${E(s)}</span>`).join("")}</div>`:""}
          ${txt("What to shoot", b.what_to_shoot)}${txt("Key messages", b.key_messages)}${txt("Do's", b.dos)}${txt("Don'ts", b.donts)}${txt("Caption to use", b.caption)}
          ${refs?`<div class="bxg-sec">References</div><div class="bxg-pre">${refs}</div>`:""}${txt("Posting note", b.posting_note)}
          <div class="bxg-sec">Terms</div><ul class="bxg-ul">${terms.map(s=>`<li>${s}</li>`).join("")}</ul>
        </div>
        <div class="card bxg-apply"><h3>${G.member ? "Connect Instagram to apply" : "Verify WhatsApp to apply"}</h3>
          <p class="muted">${G.member ? "Brands pick creators from their real stats. Applying shares only your media kit — your phone number and address stay private." : "So the brand can reach you about this campaign. Applying shares only your media kit — your phone number and address stay private."}</p>
          <button type="button" class="btn gold" data-apply="${E(x.campaign_id)}">${G.member ? "Apply — connect Instagram ›" : "Apply — verify WhatsApp ›"}</button>
          <div class="bxg-steps">${G.member ? `<div><b>✓</b>WhatsApp verified</div>` : `<div><b>1</b>Verify WhatsApp</div>`}<div><b>${G.member?1:2}</b>Connect Instagram</div><div><b>${G.member?2:3}</b>This campaign opens for you</div></div>
          <div class="bxw-note">${svg("shield")}<span>We never ask for your WhatsApp or Instagram password.</span></div>
        </div>
      </div>`;
    c.querySelectorAll("[data-go]").forEach(bt=> bt.onclick = ()=> go("discover"));
    c.querySelector("[data-apply]").onclick = ()=> toSignIn(x.campaign_id);
  }

  const LOCK = {
    mycampaigns:["Nothing to track yet","Verify WhatsApp to start tracking applications, agreements, shipping and payments in one place.","Verify WhatsApp to start tracking","sleep"],
    mediakit:["Your media kit lives here","Sign in with WhatsApp, then connect Instagram and Bounty builds your media kit automatically. No Instagram? You can build your profile by hand.","Verify WhatsApp to start","clipboard"],
    reports:["Your creator pulse","Followers, reach and campaign results show up here once you're signed in and Instagram is connected.","Verify WhatsApp to start","think"],
    profile:["Your profile","Sign in with WhatsApp to set up your creator profile — what you create, your dream brands and the collabs you're open to.","Verify WhatsApp to start","wave"],
    alerts:["No alerts yet","Campaign updates show up here once you're signed in.","Verify WhatsApp to start","envelope"]
  };
  function pageLock(c, key){
    const [h,p,b,pose] = LOCK[key] || LOCK.profile;
    c.innerHTML = `<div class="card bxg-lock"><img src="${A}sprout_${pose}.png" alt="" onerror="this.src='${A}sprout_wave.png'"><h2>${h}</h2><p class="muted">${p}</p>
      <button type="button" class="btn gold" data-x="in">${b} ›</button><button type="button" class="btn ghost" data-x="ex">Keep exploring campaigns</button>
      <div class="bxw-note">${svg("shield")}<span>Browsing stays open to everyone. Verification is only needed to apply.</span></div></div>`;
    c.querySelector('[data-x="in"]').onclick = ()=> toSignIn();
    c.querySelector('[data-x="ex"]').onclick = ()=> go("discover");
  }
  function pageSprout(c){
    c.innerHTML = `<div class="card bxg-lock"><img src="${A}sprout_wave.png" alt=""><h2>Hi, I'm Sprout.</h2><p class="muted">Your sidekick for briefs, deadlines and your next move. While you're a guest I can point you around:</p>
      <div class="bxg-btns col"><button type="button" class="btn" data-x="d">Show me live campaigns</button><button type="button" class="btn ghost" data-x="i">How do I apply?</button></div>
      <div class="bxg-pre" id="bxgSay" style="display:none">Open any campaign and read the full brief. When one fits, tap <b>Apply</b> — I'll ask for your WhatsApp number (one-time code, no password), then you connect Instagram and the campaign opens for you.</div>
      <button type="button" class="btn gold" data-x="in">Sign in to chat with Sprout ›</button></div>`;
    c.querySelector('[data-x="d"]').onclick = ()=> go("discover");
    c.querySelector('[data-x="i"]').onclick = ()=>{ document.getElementById("bxgSay").style.display = ""; };
    c.querySelector('[data-x="in"]').onclick = ()=> toSignIn();
  }

  /* ---------- signed in, Instagram not connected yet (Figma M05 / W14, G3) ---------- */
  const igLaterKey = () => "bx_ig_later_" + ((window.Auth && Auth.profile && Auth.profile.id) || "");
  const igLater = () => { try{ return localStorage.getItem(igLaterKey()) === "1"; }catch(e){ return false; } };
  function pageNeedsIg(c, applyId){
    if(!c) return;
    if(applyId){ try{ localStorage.setItem("geek_apply", applyId); }catch(e){} }
    const x = (G.list||[]).find(r=> String(r.campaign_id) === String(applyId));
    c.innerHTML = `<button type="button" class="bxg-back" data-x="back">${svg("back")}Back to campaigns</button>
      <div class="card bxg-lock"><img src="${A}sprout_point.png" alt=""><div class="bx-eyebrow">${x?E((x.brand||"")+" · "+(x.name||"")):"Apply"}</div>
      <h2>Connect Instagram to apply</h2>
      <p class="muted">Brands choose creators from their real follower range and engagement, so applying needs your Instagram connected. It takes under a minute — then this campaign opens for you.</p>
      <button type="button" class="btn gold" data-x="ig">Connect Instagram ›</button>
      <div class="bxw-note">${svg("shield")}<span>Official Meta login · we never see your password and never post for you.</span></div>
      <button type="button" class="btn ghost" data-x="back">Keep exploring campaigns</button></div>`;
    c.querySelectorAll('[data-x="back"]').forEach(b=> b.onclick = ()=> go("discover"));
    c.querySelector('[data-x="ig"]').onclick = ()=>{ if(window.Tracker) Tracker.security("instagram_connect_start"); connectInstagram(); };
    window.scrollTo(0,0);
  }
  // Discover for a signed-in creator who hasn't connected Instagram yet (the app's own Campaigns page is locked until then)
  window.bxMemberExplore = function(page){ G.member = true; go(page || "discover"); };
  window.bxMemberExploreOff = function(){ G.member = false; };

  const kidKey = () => "bx_sidekick_" + ((window.Auth && Auth.profile && Auth.profile.id) || "");
  function sidekickScreen(next){
    const root = document.getElementById("authRoot"); if(!root) return next();
    document.body.classList.add("bx-pre"); root.classList.add("open");
    const KIDS = [["Sprout","wave",true],["Flick","think",false],["Nimbus","sleep",false],["Dot","point",false]];
    root.innerHTML = `<div class="bxw form ig" id="bxw"><header class="bxw-top">${LOGO}</header><div class="bxw-body">
      <section class="bxw-hero"><h1>Meet your sidekick.</h1><p class="bxw-lead">A little friend for the big things you'll create. Pick one now, or choose later. You can switch anytime.</p></section>
      <section class="bxw-card"><div class="bxk-grid">${KIDS.map(([n,p,on],i)=>`<button type="button" class="bxk${i===0?" on":""}" data-kid="${n}"${on?"":" disabled"}><img src="${A}sprout_${p}.png" alt=""><b>${n}</b>${on?"":"<i>Coming soon</i>"}</button>`).join("")}</div>
        <div class="bxw-hint" style="text-align:center">Other characters are placeholders — final art for Flick, Nimbus and Dot comes from the character library.</div>
        <div class="bxg-tip"><img src="${A}sprout_point.png" alt=""><div>Sprout can help with briefs, deadlines and your next move.</div></div>
        <button type="button" class="bxb gold" id="bxKidGo" style="margin-top:14px">Continue with Sprout ›</button>
        <button type="button" class="bxb link-ink" id="bxKidLater" style="width:100%;margin-top:6px">I'll choose later</button>
        <div class="bxw-note">${svg("shield")}<span>Your sidekick is optional. Rename or change it anytime in Settings.</span></div></section></div></div>`;
    const done = v => { try{ localStorage.setItem(kidKey(), v); }catch(e){} next(); };
    document.getElementById("bxKidGo").onclick = ()=> done("Sprout");
    document.getElementById("bxKidLater").onclick = ()=> done("later");
  }
  if(typeof window.showInstagramGate === "function"){
    const _igGateBounty = function(){
      if(window.hideBootSplash) hideBootSplash();
      const root = document.getElementById("authRoot"); if(!root) return;
      document.body.classList.add("bx-pre");
      root.classList.add("open");
      root.innerHTML = `<div class="bxw form ig" id="bxw">
        <header class="bxw-top">${LOGO}</header>
        <div class="bxw-body">
          <section class="bxw-hero">
            <h1>Make your work shine.</h1>
            <p class="bxw-lead">Connect Instagram to build your creator media kit automatically.</p>
            <img class="bxw-sprout" src="${A}sprout_point.png" alt="">
          </section>
          <section class="bxw-card">
            <h3>Preview</h3>
            <p class="bxw-sub">Available data depends on your account type and Meta permissions.</p>
            <div class="bxw-two">
              <div><b>What Bounty can see</b><ul><li>${svg("check")}Your profile and public content</li><li>${svg("check")}Available insights you authorise</li><li>${svg("check")}Connected account details</li></ul></div>
              <div><b>What Bounty never does</b><ul><li>${svg("lock")}Never asks for your Instagram password</li><li>${svg("lock")}Never posts or messages on your behalf</li><li>${svg("lock")}Never accesses private DMs</li></ul></div>
            </div>
            <button type="button" class="bxb gold" id="gateIg">Continue with Instagram ›</button>
            <div class="bxw-hint" style="text-align:center">Secure sign-in through Meta's official authorisation flow.</div>
            <button type="button" class="bxb outline-ink" id="bxIgLater" style="margin-top:12px">Not now — enter details manually ›</button>
            <div class="bxw-note">${svg("shield")}<span>Instagram is optional. You can browse campaigns and build a manual profile without connecting.</span></div>
            <div class="bxw-hint" style="margin-top:12px">Personal account? In Instagram: Settings → Account type and tools → Switch to professional account (free, 1 minute).</div>
            <button type="button" class="bxb link" id="gateSignout" style="color:#857052;margin-top:4px">Sign out</button>
          </section>
        </div></div>`;
      document.getElementById("gateIg").onclick = ()=>{ if(window.Tracker) Tracker.security("instagram_connect_start"); connectInstagram(); };
      document.getElementById("gateSignout").onclick = ()=> window.Auth && Auth.signOut();
      document.getElementById("bxIgLater").onclick = ()=>{
        try{ localStorage.setItem(igLaterKey(), "1"); }catch(e){}
        root.classList.remove("open"); root.innerHTML = ""; document.body.classList.remove("bx-pre");
        bootOS();
      };
    };
    window.showInstagramGate = function(){
      let seen = null; try{ seen = localStorage.getItem(kidKey()); }catch(e){}
      if(!seen) return sidekickScreen(_igGateBounty);
      return _igGateBounty();
    };
  }
  // "Not now" was chosen on this device: open the app; the app's own profile gate keeps campaigns locked until Instagram is in
  if(typeof window.creatorHasInstagram === "function"){
    const _has = window.creatorHasInstagram;
    window.creatorHasInstagram = async function(){ const r = await _has.apply(this, arguments); return r || igLater(); };
  }

  // login.js may have painted its own screen before this file loaded — repaint it as the Bounty welcome
  const root = document.getElementById("authRoot");
  const inv = typeof INVITE_TOKEN !== "undefined" && INVITE_TOKEN;
  if(root && root.classList.contains("open") && root.querySelector(".auth-wrap") && creatorDoor() && !inv){
    try{ mountLogin("login"); }catch(e){}
  }
  // the app may have shown its own Instagram step before this file loaded — repaint it as the Bounty one
  if(root && root.classList.contains("open") && document.getElementById("gateIg") && !root.querySelector("#bxw") && typeof window.showInstagramGate === "function"){
    try{ window.showInstagramGate(); }catch(e){}
  }
  /* ---------- Instagram connect: Sprout media-kit loader (Figma M05B) driven by the real steps, then "media kit ready" (M05A) ----------
     01 Gathering  = Instagram handed the code back and the server is reading the account
     02 Growing    = the account is saved and the app is drawing the media kit
     03 Ready      = the media kit is on screen  → the ready card with the real numbers */
  const STEPS = [["01","Gathering","Sprout is gathering your creator story…"],["02","Growing","Building your media kit…"],["03","Ready","Your media kit is ready"]];
  function igPaint(n){
    const st = window.__bxIg; if(!st) return; if(n < st.stage) return; st.stage = n;
    const o = document.getElementById("igProg"); if(!o) return;
    o.querySelectorAll(".bxl-step").forEach((x,i)=>{ x.classList.toggle("done", i < n-1); x.classList.toggle("on", i === n-1); });
    const bar = o.querySelector(".bxl-bar i"); if(bar) bar.style.width = ({1:"33%",2:"66%",3:"100%"})[n];
    const t = o.querySelector(".bxl-t"); if(t) t.textContent = STEPS[n-1][2];
  }
  function igLoader(){
    if(window.hideBootSplash) try{ hideBootSplash(); }catch(e){}
    let o = document.getElementById("igProg");
    if(!o){ o = document.createElement("div"); o.id = "igProg"; document.body.appendChild(o); }
    o.className = "ig-prog bxl";
    o.innerHTML = `<div class="bxl-box"><div class="bxl-chip">${svg("check")}Instagram connected</div>
      <h2>Let's build your media kit</h2><img class="bxl-sprout" src="${A}sprout_clipboard.png" alt="">
      <div class="bxl-steps">${STEPS.map(s=>`<div class="bxl-step"><b>${s[0]}</b><span>${s[1]}</span></div>`).join("")}</div>
      <div class="bxl-bar"><i></i></div><div class="bxl-t"></div>
      <div class="bxl-sub">This may take a moment. You can leave this screen safely. Progress follows real import steps, not a timer.</div>
      <div class="bxw-note">${svg("shield")}<span>We only use the Instagram data you approved. Your account stays yours.</span></div></div>`;
    window.__bxIg = { stage:0 }; igPaint(1);
  }
  async function igReady(){
    const o = document.getElementById("igProg"); if(!o) return;
    let rows = [];
    try{ const r = await sb.from("social_accounts").select("username,name,followers_count,media_count,recent_media,profile_picture_url,account_type,updated_at").eq("platform","instagram").eq("member_id", Auth.profile.id).order("updated_at",{ascending:false}); rows = (r && r.data) || []; }catch(e){}
    const a = rows[0];
    if(!a){ igClose(); return; }
    const media = Array.isArray(a.recent_media) ? a.recent_media : [];
    const eng = (a.followers_count && media.length) ? (100 * media.reduce((s,m)=> s + (Number(m.like_count)||0) + (Number(m.comments_count)||0), 0) / media.length / a.followers_count).toFixed(1) + "%" : "—";
    const n = v => typeof fmtNum === "function" ? fmtNum(v||0) : String(v||0);
    o.innerHTML = `<div class="bxl-box ready"><div class="bxl-chip">${svg("check")}Instagram connected</div>
      <h2>Your world, in one kit.</h2><p class="bxl-sub" style="margin-top:0">Instagram connected. Your media kit is ready.</p>
      <div class="bxl-kit"><div class="bx-eyebrow">Your media kit — ready to preview</div>
        <div class="bxl-id">${a.profile_picture_url?`<img src="${E(a.profile_picture_url)}" alt="">`:""}<div><b>${E(a.name||a.username)}</b><div>@${E(a.username)}</div></div></div>
        <div class="bxl-nums"><div><b>${n(a.followers_count)}</b><span>Followers</span></div><div><b>${eng}</b><span>Engagement</span></div><div><b>${n(a.media_count)}</b><span>Posts</span></div></div>
        <div class="bxl-src">From Instagram · just now</div>
        <button type="button" class="bxb gold" data-r="preview">Preview media kit ›</button></div>
      <div class="bxl-accts"><div class="bx-eyebrow">Your Instagram accounts</div>${rows.map(x=>`<div class="bxl-acct"><span>@${E(x.username)}</span><i>Connected</i></div>`).join("")}
        <button type="button" class="bxb outline-ink" data-r="another">+ Connect another account</button>
        <div class="bxl-tip">Tip: Connect every account for a richer kit.</div></div>
      <button type="button" class="bxb link" data-r="continue">Continue ›</button></div>`;
    o.querySelector('[data-r="preview"]').onclick = ()=>{ igClose(); if(typeof currentPage!=="undefined" && currentPage!=="mediakit"){ currentPage = "mediakit"; renderShell(); } };
    o.querySelector('[data-r="another"]').onclick = ()=>{ igClose(); if(typeof igAddAnother==="function") igAddAnother("mediakit"); };
    o.querySelector('[data-r="continue"]').onclick = ()=>{ igClose(); currentPage = "dashboard"; renderShell(); };
  }
  function igClose(){ const o = document.getElementById("igProg"); window.__bxIg = null; if(o){ o.classList.add("out"); setTimeout(()=> o.remove(), 300); } }
  window.__bxIgStage = igPaint;
  if(creatorDoor()){
    window.igProgStart = igLoader;
    window.igProgFinish = async function(fast){
      const st = window.__bxIg;
      if(fast){ if(st && st.stage === 3) return; igClose(); return; }   // errors close it; the ready card stays until the creator taps
      if(!st || st.finishing) return;
      st.finishing = true; igPaint(2);
      const t0 = Date.now();
      while(Date.now()-t0 < 20000 && !(document.getElementById("mkHeadWrap") || document.getElementById("igBody"))) await new Promise(r=> setTimeout(r, 250));
      igPaint(3);
      await new Promise(r=> setTimeout(r, 500));
      if(window.Auth && Auth.profile && Auth.profile.role === "creator") igReady(); else igClose();
    };
    // the app started its own loader before this file loaded (Instagram sent us back) — take it over
    if(document.getElementById("igProg") && !window.__bxIg) igLoader();
  }
  // the app opening its shell after Instagram answered = step 2
  if(typeof window.bootOS === "function"){
    const _b2 = window.bootOS;
    window.bootOS = function(){ if(window.__bxIg) igPaint(2); return _b2.apply(this, arguments); };
  }

  /* ---------- New creator profile setup, step 1–3 (Figma M06 · M07 · M08 / W17–W19) — saves to the real profile ---------- */
  const onbKey = () => "bx_onb_done_" + ((window.Auth && Auth.profile && Auth.profile.id) || "");
  const papi = (fn, a) => sb.schema("api").rpc(fn, a || {}).then(r=> r, e=> ({ error:e }));
  let _onbChecked = false;
  window.bxMaybeOnboard = async function(force){
    if(!force && _onbChecked) return; _onbChecked = true;
    if(!(window.Auth && Auth.profile && Auth.profile.role === "creator") || !window.__ciProfileEnabled) return;
    const ar = document.getElementById("authRoot"); if(ar && ar.classList.contains("open")){ _onbChecked = false; return; }   // sign-in / Instagram step still on screen
    try{ if(!force && localStorage.getItem(onbKey())) return; }catch(e){}
    const r = await papi("get_my_profile"); if(r.error || !r.data) return;
    const d = r.data, pro = d.professional || {};
    if(!force && ((pro.categories||[]).length || (pro.content_formats||[]).length || (pro.languages||[]).length)) { try{ localStorage.setItem(onbKey(), "1"); }catch(e){} return; }
    onbStep(1, d);
  };
  function onbShell(step, title, sub, body, tip, foot){
    let o = document.getElementById("bxOnb");
    if(!o){ o = document.createElement("div"); o.id = "bxOnb"; o.className = "bx-onb"; document.body.appendChild(o); }
    o.innerHTML = `<div class="bxw form ig"><header class="bxw-top">${LOGO}</header><div class="bxw-body">
      <section class="bxw-hero"><div class="bx-eyebrow">Your creator profile · Step ${step} of 3</div><h1>${title}</h1><p class="bxw-lead">${sub}</p>
        <div class="bxo-dots">${[1,2,3].map(i=>`<i class="${i<=step?"on":""}"></i>`).join("")}</div></section>
      <section class="bxw-card">${body}<div class="bxg-tip"><img src="${A}sprout_point.png" alt=""><div>${tip}</div></div>
        <div class="auth-err" id="bxoErr"></div>
        <button type="button" class="bxb gold" id="bxoSave">${step===1?"Save & continue ›":step===2?"Save my dream brands ›":"Save & explore campaigns ›"}</button>
        <button type="button" class="bxb link-ink" id="bxoSkip" style="width:100%;margin-top:6px">Skip for now</button>
        <div class="bxw-note">${svg("shield")}<span>${foot}</span></div></section></div></div>`;
    o.scrollTop = 0;
    return o;
  }
  const chip = (v, on) => `<button type="button" class="bxo-chip${on?" on":""}" data-v="${E(v)}">${E(v)}</button>`;
  const picked = (o, sel) => [...o.querySelectorAll(sel + " .bxo-chip.on")].map(b=> b.dataset.v);
  function wireChips(o, max){ o.querySelectorAll(".bxo-chips").forEach(box=> box.addEventListener("click", e=>{ const b = e.target.closest(".bxo-chip"); if(!b) return;
    if(!b.classList.contains("on") && max && box.dataset.max && box.querySelectorAll(".bxo-chip.on").length >= Number(box.dataset.max)) return; b.classList.toggle("on"); box.dispatchEvent(new Event("chips")); })); }
  function onbFinish(goExplore){
    try{ localStorage.setItem(onbKey(), "1"); localStorage.setItem("ci_ob_commercial_" + ((Auth.profile && (Auth.profile.id||Auth.profile.user_id)) || "me"), "1"); }catch(e){}
    const o = document.getElementById("bxOnb"); if(o) o.remove();
    if(window.__profileReq && typeof creatorProfileGate === "function"){ creatorProfileGate().then(()=>{}).catch(()=>{}); }
    if(goExplore){ if(window.__profileGate && window.bxMemberExplore){ bxMemberExplore("discover"); } else { currentPage = "opencampaigns"; renderShell(); } }
    else { currentPage = "dashboard"; renderShell(); }
  }
  function onbStep(n, d){
    const pro = d.professional || {}, cp = d.commercial_preference || {};
    if(n === 1){
      const CATS = ["Beauty","Fashion","Lifestyle","Food","Travel","Fitness","Tech","Gaming","Parenting","Home & Decor","Education","Other"];
      const FMT = [["reel","Reels"],["story","Stories"],["carousel","Carousels"],["ugc","UGC videos"],["live","Live"],["post","Photos"]];
      const LANG = ["Hindi","Hinglish","English","Bengali","Tamil","Telugu"];
      const cats = pro.categories || [], fmts = pro.content_formats || [], langs = pro.languages || [];
      const extraL = langs.filter(l=> !LANG.includes(l));
      const o = onbShell(1, "What do you create?", "Tell us about your world. You can update this anytime.",
        `<div class="bxo-sec"><b>Your categories</b> <span class="muted">Choose all that fit</span><div class="bxo-chips" id="bxoCats">${CATS.map(x=> chip(x, cats.includes(x))).join("")}</div></div>
         <div class="bxo-sec"><b>What you make</b> <span class="muted">Select your formats</span><div class="bxo-chips" id="bxoFmt">${FMT.map(([k,l])=> `<button type="button" class="bxo-chip${fmts.includes(k)?" on":""}" data-v="${k}">${l}</button>`).join("")}</div></div>
         <div class="bxo-sec"><b>Your languages</b><div class="bxo-chips" id="bxoLang">${LANG.concat(extraL).map(x=> chip(x, langs.includes(x))).join("")}<button type="button" class="bxo-add" id="bxoAddLang">+ Add language</button></div></div>
         <div class="bxo-sec"><b>Your city</b> <span class="muted">Helps us find opportunities near you.</span><input id="bxoCity" placeholder="Search city or town" value="${E(pro.city_coarse||"")}"></div>`,
        "Pick what feels like you — there's no perfect profile.", "Your choices help recommendations. They do not guarantee eligibility.");
      wireChips(o);
      document.getElementById("bxoAddLang").onclick = ()=>{
        const btn = document.getElementById("bxoAddLang"); if(document.getElementById("bxoLangIn")) return;
        btn.insertAdjacentHTML("beforebegin", `<input id="bxoLangIn" class="bxo-langin" placeholder="Type a language, press Enter">`);
        const i = document.getElementById("bxoLangIn"); i.focus();
        const add = ()=>{ const v = i.value.trim(); i.remove(); if(v) btn.insertAdjacentHTML("beforebegin", chip(v, true)); };
        i.onkeydown = e=>{ if(e.key === "Enter"){ e.preventDefault(); add(); } if(e.key === "Escape") i.remove(); };
        i.onblur = add;
      };
      document.getElementById("bxoSkip").onclick = ()=> onbStep(2, d);
      document.getElementById("bxoSave").onclick = async ()=>{
        const btn = document.getElementById("bxoSave"), err = document.getElementById("bxoErr"); err.textContent = ""; btn.disabled = true; btn.textContent = "Saving…";
        const patch = { categories: picked(o,"#bxoCats"), content_formats: picked(o,"#bxoFmt"), languages: picked(o,"#bxoLang") };
        const city = document.getElementById("bxoCity").value.trim(); if(city) patch.city_coarse = city;
        const r = await papi("save_profile_section", { p_section:"professional", p_patch:patch, p_correlation:"ui-onboard" });
        if(r.error){ err.textContent = "Couldn't save: " + (r.error.message || r.error); btn.disabled = false; btn.textContent = "Save & continue ›"; return; }
        d.professional = Object.assign({}, pro, patch); onbStep(2, d);
      };
    }
    if(n === 2){
      const SUG = ["Nike","Sephora","boAt","Nykaa","Adidas","Samsung","Mamaearth","Starbucks"];
      const have = (d.dream_brands || []).map(x=> x.submitted_brand_name).filter(Boolean);
      const all = have.concat(SUG.filter(s=> !have.some(h=> h.toLowerCase() === s.toLowerCase())));
      const o = onbShell(2, "Your dream brand board.", "Who would you love to create with? Pick up to 5. This wishlist is private to you.",
        `<div class="bxo-sec"><div class="bxo-search"><input id="bxoBrandQ" placeholder="Search brands you love"><button type="button" class="bxo-add" id="bxoSuggest">+ Suggest a brand</button></div>
           <div class="bxo-count" id="bxoCount"></div><div class="bxo-chips big" id="bxoBrands" data-max="5">${all.map(x=> chip(x, have.includes(x))).join("")}</div></div>
         <div class="bxw-hint">Only you can see your Dream Brand Board.</div>`,
        "I'll help you spot opportunities from your favourites!", "Choosing a brand does not guarantee a collaboration. Edit anytime.");
      wireChips(o, 5);
      const box = document.getElementById("bxoBrands"), cnt = document.getElementById("bxoCount");
      const count = ()=>{ cnt.textContent = `${box.querySelectorAll(".bxo-chip.on").length} of 5 selected`; };
      box.addEventListener("chips", count); count();
      const q = document.getElementById("bxoBrandQ");
      q.oninput = ()=>{ const v = q.value.trim().toLowerCase(); box.querySelectorAll(".bxo-chip").forEach(b=> b.style.display = !v || b.dataset.v.toLowerCase().includes(v) || b.classList.contains("on") ? "" : "none"); };
      document.getElementById("bxoSuggest").onclick = ()=>{ const v = q.value.trim(); if(!v) { q.focus(); return; }
        if([...box.querySelectorAll(".bxo-chip")].some(b=> b.dataset.v.toLowerCase() === v.toLowerCase())) return;
        if(box.querySelectorAll(".bxo-chip.on").length >= 5) return; box.insertAdjacentHTML("afterbegin", chip(v, true)); q.value = ""; q.oninput(); count(); };
      document.getElementById("bxoSkip").onclick = ()=> onbStep(3, d);
      document.getElementById("bxoSave").onclick = async ()=>{
        const btn = document.getElementById("bxoSave"), err = document.getElementById("bxoErr"); err.textContent = ""; btn.disabled = true; btn.textContent = "Saving…";
        const want = picked(o, "#bxoBrands");
        try{
          for(const x of (d.dream_brands||[])){ if(x.submitted_brand_name && !want.includes(x.submitted_brand_name)){ const r = await papi("delete_dream_brand", { p_aspiration_id:x.aspiration_id, p_correlation:"ui-onboard" }); if(r.error) throw r.error; } }
          let rank = 1;
          for(const b of want){ if(!have.includes(b)){ const r = await papi("upsert_dream_brand", { p_payload:{ submitted_brand_name:b, priority_rank:rank }, p_correlation:"ui-onboard" }); if(r.error) throw r.error; } rank++; }
          onbStep(3, d);
        }catch(e){ err.textContent = "Couldn't save: " + (e.message || e); btn.disabled = false; btn.textContent = "Save my dream brands ›"; }
      };
    }
    if(n === 3){
      const o = onbShell(3, "Your work, your terms.", "Choose the collaborations that feel right for you.",
        `<div class="bxo-sec"><b>Select all you're open to</b><div class="bxo-terms" id="bxoTerms">
           <button type="button" class="bxo-term" data-v="paid"><b>Paid</b><span>Receive a creator fee for your work</span></button>
           <button type="button" class="bxo-term${cp.accepts_barter?" on":""}" data-v="barter"><b>Barter</b><span>Create in exchange for products or experiences</span></button>
           <button type="button" class="bxo-term" data-v="hybrid"><b>Hybrid</b><span>Combine a fee with products or experiences</span></button></div></div>
         <div class="bxo-sec"><b>Your expectations</b> <span class="muted">· optional</span>
           <label class="bxo-f" id="bxoRateL">Typical Reel rate (₹)<input id="bxoRate" inputmode="numeric" placeholder="e.g. 5,000"></label>
           <label class="bxo-f" id="bxoMinL">Min. barter value (₹)<input id="bxoMin" inputmode="numeric" placeholder="e.g. 1,500" value="${cp.min_product_value!=null?E(cp.min_product_value):""}"></label>
           <div class="bxw-hint">Rate fields appear only for Paid / Hybrid. These are preferences, not fixed quotes.</div></div>
         <label class="bxo-toggle"><input type="checkbox" id="bxoTravel"${cp.travel_ready?" checked":""}><span>Open to travel / store visits · optional</span></label>`,
        "You decide what works for you!", "Campaign fees, product value, deliverables, usage rights, exclusivity and deadlines are shown before you accept.");
      const terms = document.getElementById("bxoTerms");
      const sync = ()=>{ const on = [...terms.querySelectorAll(".bxo-term.on")].map(b=> b.dataset.v);
        document.getElementById("bxoRateL").style.display = on.includes("paid") || on.includes("hybrid") ? "" : "none";
        document.getElementById("bxoMinL").style.display = on.includes("barter") || on.includes("hybrid") ? "" : "none"; };
      terms.querySelectorAll(".bxo-term").forEach(b=> b.onclick = ()=>{ b.classList.toggle("on"); sync(); }); sync();
      document.getElementById("bxoSkip").onclick = ()=> onbFinish(false);
      document.getElementById("bxoSave").onclick = async ()=>{
        const btn = document.getElementById("bxoSave"), err = document.getElementById("bxoErr"); err.textContent = "";
        const on = [...terms.querySelectorAll(".bxo-term.on")].map(b=> b.dataset.v);
        const num = id => { const v = String(document.getElementById(id).value||"").replace(/[^\d.]/g,""); return v === "" ? null : Number(v); };
        const rate = (on.includes("paid") || on.includes("hybrid")) ? num("bxoRate") : null, min = (on.includes("barter") || on.includes("hybrid")) ? num("bxoMin") : null;
        btn.disabled = true; btn.textContent = "Saving…";
        const patch = { travel_ready: document.getElementById("bxoTravel").checked };
        if(on.length) patch.accepts_barter = on.includes("barter") || on.includes("hybrid");
        if(min != null) patch.min_product_value = min;
        let r = await papi("save_profile_section", { p_section:"commercial_preference", p_patch:patch, p_correlation:"ui-onboard" });
        if(!r.error && rate && rate > 0) r = await papi("save_rate_card_item", { p_payload:{ deliverable_type:"IG Reel", amount:rate }, p_correlation:"ui-onboard" });
        if(r.error){ err.textContent = "Couldn't save: " + (r.error.message || r.error); btn.disabled = false; btn.textContent = "Save & explore campaigns ›"; return; }
        onbFinish(true);
      };
    }
  }

  window.bxGuest = { start:startGuest, go };
})();
