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
          <h3 id="bxCardH">Log in or sign up</h3>
          <p class="bxw-sub" id="bxCardP">We'll send a one-time code on WhatsApp.</p>
          <div id="cinvBanner"></div>
          <form id="waDoorForm" class="auth-form bxw-form">
            <label>WhatsApp number<input name="phone" id="waPhoneIn" placeholder="+91 98123 45678" required inputmode="tel" autocomplete="tel"></label>
            <div class="bxw-hint" id="bxPhoneHint">We'll send a one-time code to verify your number.</div>
            <div id="waCodeRow" style="display:none"><label>Verification code<input name="code" id="waCodeIn" class="bxw-code" inputmode="numeric" maxlength="6" placeholder="••••••" autocomplete="one-time-code"></label>
              <div class="auth-mini"><span id="waSentTo"></span> · <a href="#" id="waChange">Change number</a> · <a href="#" id="waResend">Resend code</a></div></div>
            <div class="auth-err" id="authErr"></div>
            <button class="bxb gold auth-submit" id="waGo" type="submit">Send code on WhatsApp ›</button>
          </form>
          <div class="bxw-or"><span>or</span></div>
          <button type="button" class="bxb outline-ink" data-bx="explore">Explore campaigns first ›</button>
          <div class="bxw-note">${svg("shield")}<span>Browsing needs no sign-in. WhatsApp is only needed when you apply.</span></div>
          <div class="bxw-foot">${svg("lock")}We never ask for your WhatsApp password. Bounty will never ask for your code.</div>
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
    // M03: once the code is sent the card becomes "One little code, then you're in."
    const row = document.getElementById("waCodeRow"), h = document.getElementById("bxCardH"), p = document.getElementById("bxCardP"), hint = document.getElementById("bxPhoneHint");
    if(row) new MutationObserver(()=>{
      const on = row.style.display !== "none";
      h.textContent = on ? "One little code, then you're in." : "Log in or sign up";
      p.textContent = on ? "Enter the 6-digit code sent to your WhatsApp number." : "We'll send a one-time code on WhatsApp.";
      if(hint) hint.style.display = on ? "none" : "";
    }).observe(row, { attributes:true, attributeFilter:["style"] });
    // keep the Bounty button wording when login.js resets it
    const go = document.getElementById("waGo");
    if(go) new MutationObserver(()=>{ const t = go.textContent; if(/Send OTP on WhatsApp/.test(t)) go.textContent = "Send code on WhatsApp ›"; else if(/^Verify & sign in/.test(t)) go.textContent = "Verify & continue ›"; })
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

  if(typeof window.showInstagramGate === "function"){
    window.showInstagramGate = function(){
      if(window.hideBootSplash) hideBootSplash();
      const root = document.getElementById("authRoot"); if(!root) return;
      document.body.classList.add("bx-pre");
      root.classList.add("open");
      root.innerHTML = `<div class="bxw form ig" id="bxw">
        <header class="bxw-top">${LOGO}</header>
        <div class="bxw-body">
          <section class="bxw-hero">
            <div class="bx-eyebrow">✦ Step 2 · optional ✦</div>
            <h1>Make your work shine.</h1>
            <p class="bxw-lead">Connect Instagram to build your creator media kit automatically.</p>
            <img class="bxw-sprout" src="${A}sprout_point.png" alt="">
          </section>
          <section class="bxw-card">
            <h3>Connect Instagram</h3>
            <p class="bxw-sub">Your media kit builds itself from your Business or Creator account.</p>
            <div class="bxw-two">
              <div><b>What Bounty can see</b><ul><li>${svg("check")}Your profile and public content</li><li>${svg("check")}Available insights you authorise</li><li>${svg("check")}Connected account details</li></ul></div>
              <div><b>What Bounty never does</b><ul><li>${svg("lock")}Never asks for your Instagram password</li><li>${svg("lock")}Never posts or messages on your behalf</li><li>${svg("lock")}Never accesses private DMs</li></ul></div>
            </div>
            <button type="button" class="bxb gold" id="gateIg">Continue with Instagram ›</button>
            <div class="bxw-hint" style="text-align:center">Secure sign-in through Meta's official authorisation flow.</div>
            <button type="button" class="bxb outline-ink" id="bxIgLater" style="margin-top:12px">Not now — explore campaigns first ›</button>
            <div class="bxw-note">${svg("shield")}<span>Instagram is optional to look around. You can browse campaigns and fill your profile by hand; applying needs Instagram.</span></div>
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
  window.bxGuest = { start:startGuest, go };
})();
