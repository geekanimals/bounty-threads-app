/* Bounty creator shell — the Figma "Bounty Creator App" look for the creator side only.
   Wraps the existing shell (renderShell / renderNav / openAi); every existing page,
   loader and action still runs exactly as before.  Rule: each thing lives in ONE place
   per screen size (phone: bottom bar; desktop: sidebar).  Other roles are untouched. */
(function(){
  if(typeof window.renderShell !== "function") return;
  const isCreator = () => typeof currentRole !== "undefined" && currentRole === "creator";
  const FOREST = new Set(["dashboard","opencampaigns","marketplace"]);
  const A = "/assets/bounty/";

  // line icons (lucide-style, 24 grid)
  const P = {
    home:'<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    compass:'<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
    clip:'<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4h6v3H9zM9 11h6M9 15h4"/>',
    layers:'<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
    chart:'<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    insta:'<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".8"/>',
    chat:'<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
    user:'<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    megaphone:'<path d="M3 11v3a1 1 0 0 0 1 1h3l6 4V6L7 10H4a1 1 0 0 0-1 1zM17 9a4 4 0 0 1 0 6"/>',
    shield:'<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
    lock:'<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    back:'<path d="m15 18-6-6 6-6"/>',
    coins:'<circle cx="9" cy="9" r="6"/><path d="M15.5 9.5A6 6 0 1 1 9.5 15.5"/>',
    gear:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    moon:'<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
    target:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>'
  };
  const svg = (k, sw) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw||1.8}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[k]}</svg>`;
  const TARGET = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#D3A94E"/><circle cx="12" cy="12" r="8" fill="#C2362F"/><circle cx="12" cy="12" r="5" fill="#F4E8CE"/><circle cx="12" cy="12" r="2.4" fill="#C2362F"/></svg>';
  const TG2 = '<svg class="b2-tg" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#d9332b"/><circle cx="12" cy="12" r="8" style="fill:var(--tg-gap)"/><circle cx="12" cy="12" r="5.5" fill="#d9332b"/><circle cx="12" cy="12" r="2.6" style="fill:var(--tg-gap)"/><circle cx="12" cy="12" r="1.3" fill="#d9332b"/></svg>';
  const LOGO = `<span class="bx-logo b2-logo" aria-label="Bounty">B${TG2}UNTY</span>`;
  const KN = () => (window.bxKid ? bxKid.name() : "Pip");
  const KI = () => (window.bxKid ? bxKid.img() : A + "rd/kid_pip.png");
  // v2 sidebar icons (Figma W02)
  const EMO = { dashboard:"🏠", opencampaigns:"🧭", marketplace:"🧭", mycampaigns:"◈", bxpayments:"🪙", mediakit:"🗂", reports:"📊", instagram:"📸",
    intelligence:"📊", profile:"👤", messages:"✉️", bxsettings:"⚙︎", dream:"💙" };

  // creator nav: Figma names + icons + groups (keys come from the app, so gating/filters are unchanged)
  const LABEL = { dashboard:"Home", opencampaigns:"Discover", marketplace:"Discover", mycampaigns:"My campaigns",
    mediakit:"Media kit", reports:"Analytics", bxpayments:"Payments", bxsettings:"Settings", instagram:"Instagram", messages:"Inbox", profile:"Profile", intelligence:"Insights" };
  const ICON = { dashboard:"home", opencampaigns:"compass", marketplace:"compass", mycampaigns:"clip", mediakit:"layers", bxpayments:"coins", bxsettings:"gear",
    reports:"chart", instagram:"insta", messages:"chat", profile:"user", intelligence:"chart" };
  const GROUPS = [["Today",["dashboard","messages"]],["Campaigns",["opencampaigns","marketplace","mycampaigns","bxpayments"]],
    ["Create & grow",["mediakit","reports","instagram","intelligence"]],["My account",["profile","bxsettings"]]];
  // page titles that follow the new names (only when the title is still the old one)
  const TITLE = { "Dashboard":"Your next move.", "Campaigns":"Discover campaigns", "Open Campaigns":"Discover campaigns",
    "Reports":"Analytics", "Media Kit":"My Media Kit", "Creator Profile":"My profile", "My Campaigns":"My campaigns" };

  function profileKey(keys){ return keys.includes("profile") ? "profile" : "mediakit"; }
  function bottomItems(){
    const keys = creatorNavKeys();
    const camp = keys.includes("mycampaigns") ? "mycampaigns" : keys.includes("opencampaigns") ? "opencampaigns" : "marketplace";
    return [["dashboard","Home","home"],[camp,"Campaigns","megaphone"],["__sprout","Sprout",""],
      [keys.includes("reports") ? "reports" : "mediakit","Analytics","chart"],[profileKey(keys),"Profile","user"]];
  }
  const locked = k => false;   // no page is locked for a signed-in creator (Instagram is asked only at apply)
  function go(k){
    if(locked(k)){ if(window.gateToast) gateToast(joinNeedsText()); return; }
    currentPage = k; renderShell(); window.scrollTo(0,0);
  }
  // moving to another page (bottom bar or ☰ menu) closes the "Make your sidekick yours" sheet
  document.addEventListener("click", e=>{ if(e.target.closest && e.target.closest("#nav a, #bxBottom button")){ const ks = document.getElementById("bxKidSheet"); if(ks) ks.remove(); } }, true);

  /* ---------- body flags ---------- */
  function flags(){
    const on = isCreator();
    document.body.classList.toggle("bx", on);
    document.body.classList.toggle("b2app", on);
    if(on){ document.body.dataset.pg = currentPage; document.body.dataset.bg = FOREST.has(currentPage) ? "forest" : "parch"; }
    else { delete document.body.dataset.pg; delete document.body.dataset.bg; }
  }

  /* ---------- static chrome (once) ---------- */
  function chromeOnce(){
    if(document.getElementById("bxBottom")) return;
    const brand = document.querySelector(".sidebar .brand");
    if(brand && !brand.querySelector(".bx-logo")) brand.insertAdjacentHTML("beforeend", LOGO);
    if(brand && !brand.querySelector(".b2-drx")){ brand.insertAdjacentHTML("afterbegin", `<button type="button" class="b2-drx" aria-label="Close menu">✕</button>`); brand.querySelector(".b2-drx").onclick = ()=> document.getElementById("sidebar").classList.remove("open"); }
    const menu = document.getElementById("menuBtn");
    if(menu && !document.querySelector(".topbar .bx-logo")) menu.insertAdjacentHTML("afterend", LOGO);
    const nav = document.getElementById("nav");
    if(nav && !document.getElementById("bxNext")){
      const b = document.createElement("button"); b.id = "bxNext"; b.className = "bx-next"; b.type = "button";
      nav.parentNode.insertBefore(b, nav);
    }
    const foot = document.querySelector(".sidebar-foot");
    if(foot && !foot.querySelector(".bx-trust-links")){
      foot.insertAdjacentHTML("beforeend", `<div class="bx-trust-links"><a href="/privacy.html" target="_blank" rel="noopener">Privacy</a><a href="/terms.html" target="_blank" rel="noopener">Terms</a><a href="/contact.html" target="_blank" rel="noopener">Help</a><span>© Bounty · by Geek Creative Agency</span></div>`);
    }
    // phone: search + theme move from the top bar into the ☰ drawer (the Figma header is ☰ · logo · bell · avatar)
    if(nav && !document.getElementById("bxTools")){
      const t = document.createElement("div"); t.id = "bxTools"; t.className = "bx-tools";
      t.innerHTML = `<button type="button" data-t="search">${svg("search")}<span>Search or run a command…</span><kbd>⌘K</kbd></button><button type="button" data-t="theme">${svg("moon")}<span>Theme</span></button>`;
      const nx = document.getElementById("bxNext"); nav.parentNode.insertBefore(t, nx || nav);
      t.querySelector('[data-t="search"]').onclick = ()=>{ document.getElementById("sidebar").classList.remove("open"); const st = document.getElementById("searchTrigger"); if(st) st.click(); };
      t.querySelector('[data-t="theme"]').onclick = ()=>{ if(typeof toggleTheme==="function") toggleTheme(); };
    }
    const bar = document.createElement("nav"); bar.id = "bxBottom"; bar.className = "bx-bottom"; bar.setAttribute("aria-label","Main");
    document.body.appendChild(bar);
  }

  window.__bxChrome = chromeOnce;

  /* ---------- sidebar ---------- */
  const _renderNav = window.renderNav;
  window.renderNav = function(){
    if(!isCreator()) return _renderNav.apply(this, arguments);
    const nav = document.getElementById("nav"); nav.innerHTML = "";
    const keys = creatorNavKeys(), used = new Set();
    GROUPS.forEach(([title, gk])=>{
      const ks = gk.filter(k=> keys.includes(k) && !used.has(k));
      if(!ks.length) return;
      navHeading(nav, title); ks.forEach(k=> used.add(k)); renderNavKeys(nav, ks);
    });
    const rest = keys.filter(k=> !used.has(k));             // anything new the app adds still shows
    if(rest.length){ navHeading(nav, "More"); renderNavKeys(nav, rest); }
    const dup = new Set(bottomItems().map(b=> b[0]));
    nav.querySelectorAll("a[data-page]").forEach(a=>{
      const k = a.dataset.page, ic = a.querySelector(".ic"), lb = a.querySelector("span:last-child");
      if(lb && LABEL[k]) lb.textContent = (k==="profile" && window.__profileReq && window.__profileReq.complete) ? "Profile ✓" : LABEL[k];
      if(ic) ic.innerHTML = `<span class="b2-emo">${EMO[k] || "•"}</span>`;
      if(a.style.opacity && !a.querySelector(".bx-lk")) a.insertAdjacentHTML("beforeend", `<i class="bx-lk">${svg("lock")}</i>`);
      if(dup.has(k)) a.classList.add("bx-dup");
      // Instagram not connected yet: Discover still opens — the public campaign list, Apply asks for Instagram
      if((k==="opencampaigns" || k==="marketplace") && window.__profileGate && window.bxMemberExplore){
        a.style.opacity = ""; a.title = "Browse live campaigns";
        if(ic) ic.innerHTML = `<span class="b2-emo">${EMO[k] || "•"}</span>`;
        a.onclick = ()=>{
          nav.querySelectorAll("a.active").forEach(x=> x.classList.remove("active")); a.classList.add("active");
          document.body.dataset.pg = "opencampaigns"; document.body.dataset.bg = "forest";
          if(window.innerWidth<=760) document.getElementById("sidebar").classList.remove("open");
          bxMemberExplore("discover");
        };
      }
    });
    // a heading whose items all live in the phone's bottom bar hides with them
    nav.querySelectorAll(".nav-sec").forEach(h=>{
      let n = h.nextElementSibling, any = false, all = true;
      while(n && !n.classList.contains("nav-sec")){ any = true; if(!n.classList.contains("bx-dup")) all = false; n = n.nextElementSibling; }
      h.classList.toggle("bx-dup", any && all);
    });
  };

  function paintNext(){
    const b = document.getElementById("bxNext"); if(!b) return;
    const req = window.__profileReq;
    let t = "Find your next campaign", s = "Discover what fits you", k = creatorNavKeys().includes("opencampaigns") ? "opencampaigns" : "dashboard";
    if(window.__profileGate){
      const n = (window.__joinNeeds||[]).join(" ").toLowerCase();
      t = "Unlock campaigns"; s = /instagram/.test(n) && /whatsapp/.test(n) ? "Connect Instagram & WhatsApp" : /whatsapp/.test(n) ? "Verify WhatsApp" : "Connect Instagram"; k = "mediakit"; }
    else if(req && !req.complete && creatorNavKeys().includes("profile")){ t = "Finish your profile"; s = Math.round(100*req.done/Math.max(req.total,1)) + "% complete"; k = "profile"; }
    else if(window.__alertsUnread > 0){ t = "Check your inbox"; s = "new updates"; k = "messages"; }
    const due = window.__alertsUnread > 0 ? `<em>${window.__alertsUnread} action${window.__alertsUnread>1?"s":""} due</em>` : "";
    b.innerHTML = `<span class="b2-nx-h"><span class="tg b2-emo">🎯</span><b>Your next move</b>${due}</span><span class="b2-nx-r"><i class="dot"></i><b>${t}</b><span>· ${s}</span></span>`;
    b.onclick = ()=> go(k);
  }
  function paintSprout(){
    const l = document.getElementById("aiLaunch");
    if(l && !l.dataset.bx){ l.dataset.bx = 1; l.dataset.old = l.innerHTML; }
    if(l) l.innerHTML = isCreator() ? `<img src="${KI()}" data-kid-me alt=""><span><b>Ask ${H(KN())}</b><i>Help with anything</i></span>` : (l.dataset.old || l.innerHTML);
    if(l && isCreator()) l.onclick = ()=> openKid();
    paintMeChip();
  }
  function paintBottom(){
    const bar = document.getElementById("bxBottom"); if(!bar) return;
    if(!isCreator()){ bar.innerHTML = ""; return; }
    bar.classList.add("b2-nav");
    const NIC = { home:B2I.home, megaphone:B2I.meg, chart:B2I.bars, user:B2I.user };
    const camp = ["mycampaigns","opencampaigns","marketplace","bxpayments"], prof = ["profile","mediakit","bxsettings","instagram"];
    const kidOpen = !!document.getElementById("b2KidSheet");
    const isOn = k => !kidOpen && (k === currentPage || (k === "dashboard" && currentPage === "messages") || (k === "mycampaigns" && camp.includes(currentPage)) || (k === "profile" && prof.includes(currentPage) && currentPage !== "mediakit") || (k === "reports" && currentPage === "mediakit"));
    bar.innerHTML = bottomItems().map(([k,l,ic])=> k==="__sprout"
      ? `<button type="button" class="b2-nav-kid${document.getElementById("b2KidSheet")?" on":""}" data-k="__sprout" aria-label="Ask ${H(KN())}"><span class="ring"><img src="${KI()}" data-kid-me alt=""></span><span>${H(KN())}</span></button>`
      : `<button type="button" data-k="${k}" class="${isOn(k)?"on":""} ${locked(k)?"locked":""}"><span class="ic">${NIC[ic]||svg(ic)}</span><span>${l}</span></button>`).join("");
    bar.querySelectorAll("button").forEach(b=> b.onclick = ()=>{ const k = b.dataset.k; if(k==="__sprout") return openKid(); closeKid(); go(k); });
  }

  /* ---------- small fixes on top of the shell ---------- */
  const placeholder = n => /^wa_\d+@/.test(String(n||""));
  function tidyNames(){
    const P = window.Auth && Auth.profile; if(!P || !placeholder(P.name)) return;
    const me = document.getElementById("me");
    if(me && !me.querySelector("img") && /^[A-Z]{1,2}$/.test(me.textContent.trim())) me.textContent = "C";
    const who = document.getElementById("whoLabel"); if(who && placeholder(who.textContent.trim())) who.textContent = "Add your name in Profile";
    document.querySelectorAll(".me-name").forEach(x=>{ if(placeholder(x.textContent.trim())) x.textContent = "Creator"; });
    document.querySelectorAll(".me-ini").forEach(x=>{ if(/^W$/.test(x.textContent.trim())) x.textContent = "C"; });
  }
  // ⌘K palette: the same names as the sidebar
  if(typeof window.fillPalette === "function"){
    const _fill = window.fillPalette;
    window.fillPalette = function(q){
      const r = _fill.apply(this, arguments);
      if(isCreator()) document.querySelectorAll("#paletteResults li[data-key]").forEach(li=>{
        const k = li.dataset.key, ic = li.querySelector(".p-ic"), hint = li.querySelector(".p-hint");
        const label = k==="__ai" ? "Ask Sprout" : k==="__theme" ? "Light / dark" : LABEL[k];
        if(label){ li.textContent = ""; if(ic) li.appendChild(ic); li.appendChild(document.createTextNode(label)); if(hint) li.appendChild(hint); }
        if(ic && ICON[k]){ ic.innerHTML = svg(ICON[k]); }
      });
      return r;
    };
  }
  // no pop-up "complete your profile" card: the Home hero and the sidebar's next-move card already say it (once, no popup)
  if(typeof window.profilePopupOnce === "function"){
    const _pp = window.profilePopupOnce;
    window.profilePopupOnce = function(){ if(isCreator()) return; return _pp.apply(this, arguments); };
  }
  // the app's few browser pop-up alerts show as an in-app message on the creator side
  const _alert = window.alert.bind(window);
  window.alert = function(msg){
    if(document.body.classList.contains("bx") || document.documentElement.classList.contains("bx-door")){
      if(typeof gateToast === "function"){ try{ gateToast(String(msg).split("\n\nMake sure")[0]); return; }catch(e){} }
    }
    return _alert(msg);
  };

  /* ---------- page touches (idempotent; re-run whenever the page re-renders) ---------- */
  const TRUST = `<div class="bx-trust">${svg("shield")}Bounty is free for creators · brands are verified by Geek · payment status on every campaign.</div>`;
  function touchPage(){
    if(!isCreator()) return;
    tidyNames();
    const c = document.getElementById("content"); if(!c) return;
    const h1 = c.querySelector(".page-head h1");
    if(h1 && TITLE[h1.textContent.trim()]) h1.textContent = TITLE[h1.textContent.trim()];
    const hp = c.querySelector(".page-head p"); if(hp && /Geek OS/.test(hp.textContent)) hp.textContent = hp.textContent.replace(/Geek OS/g, "Bounty");
    // campaign pages open with a header card instead of a page head — give it the new name too
    const h3 = !h1 && c.querySelector(":scope > div > .card:first-child > h3, :scope > .card:first-child > h3");
    if(h3 && h3.childNodes.length === 1 && TITLE[h3.textContent.trim()]) h3.textContent = TITLE[h3.textContent.trim()];
    if(currentPage === "opencampaigns") touchDiscover();
    if(currentPage === "dashboard"){
      const head = c.querySelector(".page-head");
      if(head) head.classList.add("b2-hide");
      if(false && head && !head.querySelector(".bx-eyebrow")){
        const hr = new Date().getHours(), part = hr < 12 ? "morning" : hr < 17 ? "afternoon" : "evening";
        head.firstElementChild.insertAdjacentHTML("afterbegin", `<div class="bx-eyebrow">✦ Good ${part}, creator</div>`);
        const p = head.querySelector("p"); if(p) p.textContent = "Get discovered by brands you love. Build the creator career you want.";
      }
      const body = document.getElementById("cdBody");
      if(body && body.querySelector(".ws-stats")){
        const hero = body.querySelector(".cd-gate, .cd-prof") || [...body.children].find(x=> x.classList.contains("card") && /ready for campaigns/i.test(x.textContent));
        if(hero) hero.classList.add("bx-hero");
        const subs = body.querySelectorAll(":scope > .ci-sub");
        if(!body.querySelector(".bx-trust")) body.insertAdjacentHTML("beforeend", TRUST);
        if(!body.querySelector("#bxHome")) buildHome(body);
      }
    }
  }

  /* ---------- Discover (signed in) like the Figma (M10 / W03): title, cover band, why you do / don't qualify ---------- */
  async function touchDiscover(){
    const c = document.getElementById("content"); if(!c || !window.B2) return;
    const intro = c.querySelector(".ci-intro");
    if(intro && !intro.dataset.b2){ intro.dataset.b2 = 1; intro.innerHTML = `<h1 class="b2-h1">Made for your world.</h1><p class="b2-sub plain">Campaigns that match your style</p>`; intro.classList.add("b2-intro"); }
    const chips = c.querySelector("#campChips"); if(chips){ chips.classList.add("b2-campchips");
      const CL = { all:"For you", paid:"Paid", barter:"Barter", celebrity:"Story" };
      chips.querySelectorAll("[data-campf]").forEach(b=>{ const l = CL[b.dataset.campf]; if(l && b.firstChild && b.firstChild.nodeType === 3 && b.firstChild.nodeValue.trim() !== l) b.firstChild.nodeValue = l + " "; if(!l) b.classList.add("b2-hide"); }); }
    const cards = [...c.querySelectorAll(".ci-ccard[data-cdetail]")].filter(x=> !x.dataset.b2);
    if(!cards.length) return;
    let d; try{ d = await homeData(); }catch(e){ return; }
    cards.forEach(card=>{
      if(card.dataset.b2) return; card.dataset.b2 = 1;
      const x = (d.open||[]).find(o=> String(o.campaign_id) === card.dataset.cdetail); if(!x) return;
      const el = x.eligibility || {};
      const act = card.querySelector("[data-apply]");
      const tag = x.my_stage ? `<span class="b2-match ok">✓ ${H(String(x.my_stage).replace(/_/g," "))}</span>` : x.applications_closed ? `<span class="b2-match no">Applications closed</span>`
        : el.eligible === true ? `<span class="b2-match ok">✓ Eligible</span>` : el.eligible === false ? `<span class="b2-match no">✗ Not eligible</span>` : `<span class="b2-match chk">⇄ Check fit</span>`;
      const tmp = document.createElement("div"); tmp.innerHTML = B2.card(x, { btn: tag + `<button type="button" class="b2-vb" data-b2open>View brief →</button>` });
      const art = tmp.firstElementChild;
      card.className = "ci-ccard b2-camp"; card.innerHTML = art.innerHTML;
      if(act){ act.classList.add("b2-hide"); card.appendChild(act); }
    });
    const grid = c.querySelector(".ci-cgrid"); if(grid) grid.classList.add("b2-cgrid");
    if(!c.querySelector(".b2-disc-tip") && grid) grid.insertAdjacentHTML("afterend", `<div class="b2-disc-tip">${B2.tip("A high match isn't always eligible — check the reasons in each brief.")}</div>`);
  }

  /* ---------- Home like the Figma (M09 / W02): your next move, active campaigns, made for your world,
     dream brand board, media kit progress — from the creator's real data; the existing cockpit stays below ---------- */
  let _home = null, _homeAt = 0;
  async function homeData(){
    if(_home && Date.now()-_homeAt < 45000) return _home;
    const api = (fn,a)=> sb.schema("api").rpc(fn, a||{}).then(r=> r && !r.error ? r.data : null, ()=> null);
    const [mine, open, prof] = await Promise.all([ api("get_my_campaigns"), window.__ciOpsEnabled ? api("list_open_campaigns") : null, window.__ciProfileEnabled ? api("get_my_profile") : null, window.B2 && B2.loadCovers ? B2.loadCovers() : null ]);
    _home = { mine: Array.isArray(mine)?mine:[], open: Array.isArray(open)?open:[], dreams: (prof && Array.isArray(prof.dream_brands)) ? prof.dream_brands : [] };
    _homeAt = Date.now(); if(window.B2) B2.openList = _home.open; return _home;
  }
  const DONE_ST = ["completed"], OUT_ST = ["ineligible","brand_declined","dropped","rejected"], WAIT_ST = ["applied","eligible","sent_to_brand","shortlisted","content_submitted","published","address_confirmed","accepted","brand_confirmed"];
  const H = s => String(s==null?"":s).replace(/[&<>"']/g, ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  const BRAND_PH = { nike:"ph_b_nike", nykaa:"ph_b_nykaa", boat:"ph_b_boat", beardo:"ph_b_beardo", snuggles:"ph_b_snuggles", circle:"ph_b_circle" };
  async function buildHome(body){
    const box = document.createElement("div"); box.id = "bxHome"; box.className = "b2 b2-home";
    const hr = new Date().getHours(), part = hr < 12 ? "morning" : hr < 17 ? "afternoon" : "evening";
    box.innerHTML = `<div class="b2-hello">Good ${part}, creator.</div><h1 class="b2-h1 b2-hh">Your next move.</h1>
      <div class="b2-hrow"><div class="b2-gc b2-next">${window.B2SK ? B2SK.homeNext() : `<div class="b2-skel">Finding your next move…</div>`}</div><div class="b2-hact" id="b2HAct">${window.B2SK ? B2SK.homeAct() : ""}</div></div>${window.B2SK ? B2SK.homeRec() : ""}`;
    body.insertBefore(box, body.firstChild);
    document.body.classList.add("b2-home-on");
    let d; try{ d = await homeData(); }catch(e){ d = { mine:[], open:[], dreams:[] }; }
    if(!box.isConnected) return;
    const order = (typeof AI_ACTION_ORDER!=="undefined") ? AI_ACTION_ORDER : [];
    const live = d.mine.filter(x=> !DONE_ST.includes(x.stage) && !OUT_ST.includes(x.stage));
    const yours = live.filter(x=> !WAIT_ST.includes(x.stage)).sort((a,b)=>((order.indexOf(a.stage)+1)||99)-((order.indexOf(b.stage)+1)||99));
    const req = window.__profileReq, pct = req ? Math.round(100*req.done/Math.max(req.total,1)) : null;
    // 1) the one action that matters now
    let act;
    if(window.__profileGate) act = { tag:"Action needed", t:"Connect Instagram to apply", s:"Explore freely — brands check real reach when you apply.", b:"Connect Instagram", go:"mediakit" };
    else if(yours[0]) act = { tag:"Action needed", t:`${yours[0].brand?yours[0].brand+" · ":""}${STAGE_SHORT[yours[0].stage] || (yours[0].campaign||"Campaign")}`, s: STAGE_TXT[yours[0].stage] || String(yours[0].stage||"").replace(/_/g," "), b:"Open brief", go:"mycampaigns" };
    else if(req && !req.complete) act = { tag:"Next step", t:`Your profile is ${pct}% complete`, s:"Brands pick complete profiles first", b:"Finish profile", go:"profile" };
    else act = { tag:"Next step", t:"Find your next campaign", s:`${d.open.filter(x=>!x.my_stage && !x.applications_closed).length} campaigns open for you`, b:"Explore campaigns", go:"opencampaigns" };
    box.querySelector(".b2-next").innerHTML = `<span class="b2-tagred${act.tag==="Next step"?" soft":""}">${act.tag}</span><h3>${H(act.t)}</h3><div class="b2-due">⏳ ${H(act.s)}</div>
      <button type="button" class="b2-mini cream" data-hgo="${act.go}">${act.b} →</button>`;
    // 2) active campaigns
    const ah = box.querySelector("#b2HAct"); if(!ah) return;
    ah.innerHTML = `<div class="b2-sec">— Active campaigns —</div><div class="b2-sec2">${live.length} in progress</div>
      <div class="b2-gc b2-active"><div class="b2-gc-h d-only">Active campaigns · ${live.length} in progress</div>${live.length ? live.slice(0,4).map(x=>`<div class="b2-arow" data-hgo="mycampaigns"><span class="b2-ini2">${H(String(x.brand||x.campaign||"C").charAt(0).toUpperCase())}</span><span class="b2-an"><b>${H(x.brand||x.campaign||"")}</b> · ${H(STAGE_SHORT[x.stage]||String(x.stage||"").replace(/_/g," "))}</span><span class="b2-st ${WAIT_ST.includes(x.stage)?"teal":"red"}">${WAIT_ST.includes(x.stage)?"In progress":"Action needed"}</span></div>`).join("") : `<div class="b2-arow empty">No active campaigns yet — apply to one below.</div>`}</div>`;
    // 3) made for your world
    { const skr = box.querySelector("#b2HSkRec"); if(skr) skr.remove(); }
    const elr = x => x.eligibility && x.eligibility.eligible === true ? 0 : x.eligibility && x.eligibility.eligible === false ? 2 : 1;
    const fresh = d.open.filter(x=> !x.my_stage && !x.applications_closed).sort((a,b)=> elr(a) - elr(b)).slice(0,3);
    if(fresh.length && window.B2){
      const first = fresh[0], k = B2.kind(first);
      box.insertAdjacentHTML("beforeend", `<div class="b2-sec">— Made for your world —</div>
        <div class="b2-gc b2-rec m-only" data-hbrief="${H(first.campaign_id)}"><img src="${B2.camPhoto(first)}" alt=""><div><div class="b2-rk">Campaign</div><h4>${H(first.name||"Campaign")}</h4>
          <div class="b2-rl">🎁 ${H(B2.KL[k]||"Campaign")} · ${k==="paid"?"Payment":"Product"}</div><span class="b2-pm${elr(first)===2?" no":""}">${["✓ Eligible","Potential match","✗ Not eligible yet"][elr(first)]}</span>
          <div class="b2-rf"><i>${["You can apply now","Not guaranteed eligible","Finish your profile to qualify"][elr(first)]}</i><button type="button" class="b2-vb" data-hbrief="${H(first.campaign_id)}">Explore</button></div></div></div>
        <div class="b2-cgrid d-only b2-home-camps">${fresh.map(x=> B2.card(x, { btn:`${elr(x)===0?`<span class="b2-match ok">✓ Eligible</span>`:elr(x)===2?`<span class="b2-match no">✗ Not eligible</span>`:`<span class="b2-match chk">⇄ Check fit</span>`}<button type="button" class="b2-vb" data-hbrief="${H(x.campaign_id)}">View brief →</button>` }).replace('class="b2-camp"', `class="b2-camp" data-hbrief="${H(x.campaign_id)}"`)).join("")}</div>`);
    }
    // 4) dream brand board + media kit progress
    const dreams = d.dreams.slice(0,5);
    box.insertAdjacentHTML("beforeend", `<div class="b2-sec m-only">— Your dream brand board —</div>
      <div class="b2-gc b2-dream m-only">${dreams.length ? `<div class="b2-dthumbs">${dreams.slice(0,3).map(x=>{ const n = String(x.submitted_brand_name||"Brand"), ph = BRAND_PH[n.toLowerCase().replace(/[^a-z]/g,"")];
          return ph ? `<img src="${A}rd/${ph}.jpg" alt="${H(n)}">` : `<span>${H(n)}</span>`; }).join("")}</div>
          <div class="b2-df"><span>${H(dreams.map(x=>x.submitted_brand_name).filter(Boolean).slice(0,3).join(" · "))}</span><a href="#" data-hgo="opencampaigns">See opportunities →</a></div>`
        : `<div class="b2-df"><span>Pick up to 5 brands you'd love to work with — private to you.</span><a href="#" data-hgo="profile">Add dream brands →</a></div>`}</div>
      <div class="b2-hrow2"><div class="b2-gc b2-kitp"><h4>${pct!=null?`Your media kit · ${pct}% complete`:"Your media kit"}</h4>${pct!=null?`<div class="b2-bar"><i style="width:${pct}%"></i></div>`:""}
        <button type="button" class="b2-mini cream" data-hgo="${pct!=null&&pct<100?"profile":"mediakit"}">${pct!=null&&pct<100?"Finish profile":"View media kit"}</button></div>
        <p class="b2-quote">Get discovered by brands you love.<br class="m-only"> Build the creator career you want.</p>
        ${window.B2 ? B2.tip("Keep your media kit updated for better brand matches!") : ""}</div>`);
    box.querySelectorAll("[data-hgo]").forEach(b=> b.onclick = e=>{ e.preventDefault(); const k = b.dataset.hgo; if(k==="__sprout") return openKid(); go(k); });
    box.querySelectorAll("[data-hbrief]").forEach(b=> b.onclick = e=>{ e.stopPropagation(); try{ localStorage.setItem("geek_apply", b.dataset.hbrief); }catch(x){} go("opencampaigns"); });
  }
  let _mo = null;
  function watch(){
    if(_mo) return;
    const c = document.getElementById("content"); if(!c) return;
    let q = false;
    _mo = new MutationObserver(()=>{ if(q) return; q = true; requestAnimationFrame(()=>{ q = false; touchPage(); }); });
    _mo.observe(c, { childList:true, subtree:true });
  }

  /* ---------- wrap the shell ---------- */
  const _renderShell = window.renderShell;
  /* ---------- the v2 loader between sign-in and the first screen (instead of the old Geek OS "Media Kit" early shell) ---------- */
  function bootLoader(){
    if(!document.documentElement.classList.contains("bx-door") || document.getElementById("bootSplash")) return;
    const b = document.createElement("div"); b.id = "bootSplash"; b.className = "boot-splash b2-boot";
    b.innerHTML = `<div class="b2-boot-in">${LOGO.replace('bx-logo b2-logo','b2-logo')}<div class="b2-boot-by">by geek</div><div class="b2-boot-orb"><img src="${KI()}" alt=""></div><div class="b2-boot-t">Getting your world ready…</div><div class="b2-boot-bar"><i></i></div></div>`;
    document.body.appendChild(b);
    clearTimeout(window.__b2BootT); window.__b2BootT = setTimeout(()=>{ const x = document.getElementById("bootSplash"); if(x) x.remove(); }, 15000);
  }
  window.bxBootLoader = bootLoader;
  if(typeof window.paintEarlyShell === "function"){
    const _pes = window.paintEarlyShell;
    window.paintEarlyShell = function(){
      if(document.documentElement.classList.contains("bx-door") && !(window.Auth && Auth.profile && Auth.profile.role && Auth.profile.role !== "creator")){ bootLoader(); window.__earlyShell = false; return; }
      return _pes.apply(this, arguments);
    };
  }
  // WhatsApp verified, no Instagram: every page opens — Instagram is asked only when they apply (Discover runs as "member explore")
  let _landed = false;
  const openGate = ()=>{ try{ if(typeof GATE_OPEN_PAGES !== "undefined") ["dashboard","opencampaigns","marketplace","mycampaigns","reports","bxpayments","bxsettings","instagram","mediakit","profile","messages"].forEach(k=>{ if(!GATE_OPEN_PAGES.includes(k)) GATE_OPEN_PAGES.push(k); }); }catch(e){} };
  openGate();
  window.renderShell = function(){
    document.body.classList.remove("bx-pre");
    if(isCreator() && !_landed && currentPage === "mediakit" && !window.__bxWantKit && !new URLSearchParams(location.search).get("go")){ currentPage = "dashboard"; }
    if(isCreator()) _landed = true;
    if(window.bxMemberExploreOff) bxMemberExploreOff();
    if(window.__bxIg && window.__bxIgStage) __bxIgStage(2);
    chromeOnce(); flags();
    const r = _renderShell.apply(this, arguments);
    flags(); paintNext(); paintSprout(); paintBottom(); watch(); touchPage(); tidyNames(); paintMe();
    const st = document.querySelector("#searchTrigger span"); if(st && isCreator()) st.textContent = "🔍 Search or run a command…";
    if(isCreator() && window.bxMaybeOnboard) setTimeout(()=> bxMaybeOnboard(), 600);   // new creator: profile setup step 1–3, once
    if(isCreator() && window.__profileGate && (currentPage === "opencampaigns" || currentPage === "marketplace") && window.bxMemberExplore) setTimeout(()=> bxMemberExplore("discover"), 30);
    return r;
  };
  /* ---------- Ask Sprout sheet (Figma M28): greeting, quick asks, your next task, then the same chat ---------- */
  const STAGE_TXT = { changes_requested:"Changes requested — upload a revised draft", content_created:"Shoot & submit your draft", contract_sent:"Review & sign your agreement",
    contract_signed:"Confirm your delivery address", content_approved:"Draft approved — post it & share the link", product_sent:"Package on the way — confirm when it arrives",
    invited:"You're invited — accept or decline", content_submitted:"Draft sent — waiting for review", address_confirmed:"Address confirmed — product ships soon",
    published:"Post live — waiting for verification", brand_confirmed:"Brand confirmed you", accepted:"Confirmed — next step coming", sent_to_brand:"With the brand for review",
    shortlisted:"Shortlisted", eligible:"Eligible — waiting for the brand", applied:"Applied — waiting for the brand", completed:"Completed" };
  const STAGE_SHORT = { changes_requested:"Changes requested", content_created:"Draft due", contract_sent:"Sign agreement", contract_signed:"Confirm address",
    content_approved:"Approved — post it", product_sent:"Kit on the way", invited:"Invited", content_submitted:"Draft in review", address_confirmed:"Awaiting product",
    published:"Post live", brand_confirmed:"Confirmed", accepted:"Confirmed", sent_to_brand:"With the brand", shortlisted:"Shortlisted", eligible:"In review", applied:"Applied", completed:"Completed" };
  let _sproutNext = null, _sproutNextAt = 0;
  async function sproutNext(){
    if(_sproutNext && Date.now()-_sproutNextAt < 60000) return _sproutNext;
    try{
      const { data } = await sb.schema("api").rpc("get_my_campaigns");
      const order = (typeof AI_ACTION_ORDER!=="undefined") ? AI_ACTION_ORDER : [];
      const live = (Array.isArray(data)?data:[]).filter(x=> !["completed","rejected","dropped","ineligible","brand_declined"].includes(x.stage));
      live.sort((a,b)=>((order.indexOf(a.stage)+1)||99)-((order.indexOf(b.stage)+1)||99));
      _sproutNext = live[0] || false; _sproutNextAt = Date.now();
    }catch(e){ _sproutNext = false; }
    return _sproutNext;
  }
  const ASKS = [["What needs my attention?","chat"],["Help with my brief","chat"],["Find campaigns for me","go:opencampaigns"],["Improve my media kit","go:mediakit"]];
  if(typeof window.renderAiChat === "function"){
    const _rac = window.renderAiChat;
    window.renderAiChat = function(){
      const r = _rac.apply(this, arguments);
      if(!isCreator()) return r;
      const body = document.getElementById("aiBody"), thread = document.getElementById("aiThread"); if(!body || !thread) return r;
      const inp = document.getElementById("aiInput"); if(inp) inp.placeholder = "Ask Sprout anything…";
      const fresh = AI_HISTORY.length <= 1;
      const first = String((window.Auth && Auth.profile && !/^wa_\d+@/.test(Auth.profile.name||"") && Auth.profile.name) || "there").split(" ")[0];
      const chips = `<div class="bx-asks">${ASKS.map(([t,k])=>`<button type="button" data-ask="${k}">${t}</button>`).join("")}</div>`;
      if(fresh){
        thread.innerHTML = `<div class="bx-sprout-hi"><img src="${A}sprout_wave.png" alt=""><div><div class="bx-eyebrow">Here to help</div><h3>Hey ${first.replace(/[<>&"]/g,"")}! What can we tackle today?</h3></div></div>
          ${chips}<div class="bx-next-task" id="bxNextTask"><div class="bx-eyebrow">Next up</div><div class="muted">Checking your campaigns…</div></div>`;
        sproutNext().then(x=>{
          const box = document.getElementById("bxNextTask"); if(!box) return;
          if(!x){ box.innerHTML = `<div class="bx-eyebrow">Next up</div><b>Nothing due right now</b><div class="muted">Find a campaign that fits you.</div><div class="bx-nt-btns"><button type="button" class="btn sm" data-ask="go:opencampaigns">Find campaigns</button></div>`; }
          else { box.innerHTML = `<div class="bx-eyebrow">Next up</div><b>${String((x.brand?x.brand+" · ":"")+(x.campaign||"Campaign")).replace(/[<>&"]/g,"")}</b><div class="muted">${STAGE_TXT[x.stage]||String(x.stage||"").replace(/_/g," ")}</div>
            <div class="bx-nt-btns"><button type="button" class="btn sm" data-ask="go:mycampaigns">Open task</button><button type="button" class="btn sm ghost" data-ask="chat:What should I do next for ${String(x.campaign||"my campaign").replace(/"/g,"")}?">Ask Sprout</button></div>`; }
          wireAsks(box);
        });
      } else {
        thread.insertAdjacentHTML("afterbegin", `<div class="bx-asks small">${ASKS.map(([t,k])=>`<button type="button" data-ask="${k}">${t}</button>`).join("")}</div>`);
      }
      wireAsks(thread);
      return r;
    };
  }
  function wireAsks(root){
    root.querySelectorAll("[data-ask]").forEach(b=> b.onclick = ()=>{
      const k = b.dataset.ask;
      if(k.startsWith("go:")){ if(typeof closeAi==="function") closeAi(); go(k.slice(3)); return; }
      const text = k.startsWith("chat:") ? k.slice(5) : b.textContent.trim();
      if(typeof sendAiMessage === "function") sendAiMessage(text);
    });
  }

  /* ---------- Media kit edit = one "Make it yours." page (Figma M24), not pop-ups ---------- */
  if(typeof window.openMkEdit === "function"){
    const _ome = window.openMkEdit;
    window.openMkEdit = function(section, acct){
      if(!isCreator() || !acct || typeof mkEdits !== "function") return _ome.apply(this, arguments);
      return mkMakeItYours(section, acct);
    };
  }
  function mkMakeItYours(section, acct){
    const c = document.getElementById("content"); if(!c) return;
    const X = s => String(s==null?"":s).replace(/[&<>"']/g, ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
    const E = mkEdits(acct);
    const all = typeof mkAllMedia === "function" ? mkAllMedia(acct) : (acct.recent_media||[]);
    let pins = (Array.isArray(E.pinned) ? E.pinned.map(String) : []).filter(id=> all.some(m=> String(m.id)===id));
    const port = Array.isArray(E.portfolio) ? E.portfolio.slice() : [];
    const rates = Array.isArray(E.rate_card) ? E.rate_card.slice() : [];
    const req = window.__profileReq, pct = req ? Math.round(100*req.done/Math.max(req.total,1)) : null;
    const img = m => m.media_type==="VIDEO" ? (m.thumbnail_url||m.media_url) : m.media_url;
    const rowP = (p={}) => `<div class="bx-row3"><input data-k="brand" placeholder="Brand" value="${X(p.brand)}"><input data-k="note" placeholder="What you made (optional)" value="${X(p.note)}"><input data-k="url" placeholder="Link (optional)" value="${X(p.url)}"><button type="button" class="bx-x" title="Remove">✕</button></div>`;
    const rowR = (r={}) => `<div class="bx-row2"><input data-k="item" placeholder="Service, e.g. Instagram Reel" value="${X(r.item)}"><input data-k="price" placeholder="Price, e.g. ₹5,000" value="${X(r.price)}"><button type="button" class="bx-x" title="Remove">✕</button></div>`;
    c.innerHTML = `<button type="button" class="bxg-back" id="mkyBack">${svg("back")}Back to media kit</button>
      <div class="page-head"><div><div class="bx-eyebrow">Media kit</div><h1>Make it yours.</h1><p>Choose what brands see in your media kit.</p></div>
        <div class="mky-top">${pct!=null?`<span class="mky-pct">Profile ${pct}% complete</span>`:""}<button type="button" class="btn gold" data-mky="save">Save &amp; preview</button></div></div>
      <div class="mky-grid">
        <section class="card" id="mky-profile"><h3>Personal intro</h3>
          <div class="mky-id">${acct.profile_picture_url?`<img src="${X(acct.profile_picture_url)}" alt="">`:""}<div><b>${X(acct.name||acct.username)}</b><div class="muted">@${X(acct.username)}</div></div></div>
          <label>Headline / tagline<input id="mkyHead" maxlength="90" placeholder="Beauty, lifestyle & honest stories" value="${X(E.headline)}"></label>
          <label>Bio <span class="muted">(leave as is to keep your Instagram bio — it updates on its own)</span><textarea id="mkyBio" rows="3">${X(E.bio||acct.biography||"")}</textarea></label>
        </section>
        <section class="card" id="mky-pins"><h3>Pin your best work <span class="muted">· up to 6, shown first</span></h3>
          ${all.length ? `<div class="mky-posts" id="mkyPosts">${all.slice(0,30).map(m=>`<button type="button" class="mky-post${pins.includes(String(m.id))?" on":""}" data-id="${X(m.id)}"><img src="${X(img(m))}" alt="" loading="lazy"><span class="mky-n"></span></button>`).join("")}</div>
            <div class="muted" id="mkyPinNote"></div>` : `<div class="muted">Your posts show up here once Instagram has synced.</div>`}
        </section>
        <section class="card" id="mky-portfolio"><h3>Brand history <span class="bxg-match">Creator-provided</span></h3>
          <div id="mkyPort">${(port.length?port:[{}]).map(rowP).join("")}</div><button type="button" class="btn sm ghost" id="mkyAddP">+ Add a brand</button>
        </section>
        <section class="card" id="mky-ratecard"><h3>Rate card <span class="bxg-match">Creator-provided</span></h3>
          <div id="mkyRate">${(rates.length?rates:[{}]).map(rowR).join("")}</div><button type="button" class="btn sm ghost" id="mkyAddR">+ Add a rate</button>
          <div class="muted" style="margin-top:8px">These are your starting prices, not fixed quotes.</div>
        </section>
      </div>
      <div class="bxg-tip"><img src="${A}sprout_point.png" alt=""><div>Tip: Lead with your strongest Reel!</div></div>
      <div class="mky-foot"><div class="auth-err" id="mkyErr"></div><button type="button" class="btn ghost" id="mkyCancel">Cancel</button><button type="button" class="btn gold" data-mky="save">Save &amp; preview</button></div>`;
    const back = ()=>{ currentPage = "mediakit"; renderShell(); };
    document.getElementById("mkyBack").onclick = back; document.getElementById("mkyCancel").onclick = back;
    const paintPins = ()=>{ c.querySelectorAll(".mky-post").forEach(b=>{ const i = pins.indexOf(b.dataset.id); b.classList.toggle("on", i>=0); b.querySelector(".mky-n").textContent = i>=0 ? i+1 : ""; });
      const n = document.getElementById("mkyPinNote"); if(n) n.textContent = pins.length ? `${pins.length} of 6 pinned — tap again to unpin. The order you tap is the order brands see.` : "Tap posts to pin them."; };
    c.querySelectorAll(".mky-post").forEach(b=> b.onclick = ()=>{ const id = b.dataset.id, i = pins.indexOf(id);
      if(i>=0) pins.splice(i,1); else if(pins.length < 6) pins.push(id); else { if(typeof gateToast==="function") gateToast("You can pin up to 6 — unpin one first."); return; } paintPins(); });
    paintPins();
    const wireX = root => root.querySelectorAll(".bx-x").forEach(x=> x.onclick = ()=> x.parentElement.remove());
    wireX(c);
    document.getElementById("mkyAddP").onclick = ()=>{ document.getElementById("mkyPort").insertAdjacentHTML("beforeend", rowP()); wireX(document.getElementById("mkyPort")); };
    document.getElementById("mkyAddR").onclick = ()=>{ document.getElementById("mkyRate").insertAdjacentHTML("beforeend", rowR()); wireX(document.getElementById("mkyRate")); };
    const target = document.getElementById("mky-" + (section==="pins"?"pins":section)); if(target) setTimeout(()=> target.scrollIntoView({ behavior:"smooth", block:"start" }), 60); else window.scrollTo(0,0);
    c.querySelectorAll('[data-mky="save"]').forEach(btn=> btn.onclick = async ()=>{
      const err = document.getElementById("mkyErr"); err.textContent = "";
      const ne = { ...E };
      ne.headline = document.getElementById("mkyHead").value.trim();
      const b = document.getElementById("mkyBio").value.trim();
      if(b && b !== String(acct.biography||"").trim()){ ne.bio = b; ne.for = String(acct.ig_user_id||acct.username||""); ne.for_user = String(acct.username||"").toLowerCase(); }
      else { delete ne.bio; delete ne.for; delete ne.for_user; }
      ne.pinned = pins.slice(0,6);
      ne.portfolio = [...document.querySelectorAll("#mkyPort .bx-row3")].map(r=>({ brand:r.querySelector('[data-k="brand"]').value.trim(), note:r.querySelector('[data-k="note"]').value.trim(), url:r.querySelector('[data-k="url"]').value.trim() })).filter(p=> p.brand);
      ne.rate_card = [...document.querySelectorAll("#mkyRate .bx-row2")].map(r=>({ item:r.querySelector('[data-k="item"]').value.trim(), price:r.querySelector('[data-k="price"]').value.trim() })).filter(r=> r.item);
      c.querySelectorAll('[data-mky="save"]').forEach(x=>{ x.disabled = true; x.textContent = "Saving…"; });
      try{
        const { error } = await sb.from("social_accounts").update({ edits:ne, updated_at:new Date().toISOString() }).eq("id", acct.id);
        if(error) throw error;
        if(typeof gateToast==="function") gateToast("✓ Saved — this is what brands see now.");
        back();
      }catch(ex){ err.textContent = ex.message || "Couldn't save."; c.querySelectorAll('[data-mky="save"]').forEach(x=>{ x.disabled = false; x.textContent = "Save & preview"; }); }
    });
  }

  /* ---------- the sidekick sheet (Figma V2-27 · 27A Ask · 27B Prepare · 27C Confirm / W40–W43) ----------
     Tap the sidekick in the footer (or "Ask Pip" in the sidebar). Answers come from the app's own helper
     (builtInAnswer — the creator's real campaigns, brief and contract). Nothing is sent without the creator's OK:
     "Confirm" opens the real step to finish it. */
  const _openAi = window.openAi;
  if(typeof _openAi === "function") window.openAi = function(){ if(isCreator()) return openKid(); return _openAi.apply(this, arguments); };
  const B2I = {
    home:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/></svg>',
    meg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10v4h3l6 4V6L7 10z"/><path d="M17 9.5a3.5 3.5 0 0 1 0 5"/></svg>',
    bars:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 20v-6M12 20V8M18 20v-9"/></svg>',
    user:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
    bell:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 21h4"/></svg>',
    doc:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/></svg>',
    layers:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/></svg>',
    gear:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M4.2 6.2l2.1 2.1M17.7 15.7l2.1 2.1M2.5 12h3M18.5 12h3M4.2 17.8l2.1-2.1M17.7 8.3l2.1-2.1"/></svg>',
    x:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    mic:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
    send:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M21 3 3 10.5l7 2.5 2.5 7z"/><path d="m10 13 4-4"/></svg>',
    chev:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="m9 6 6 6-6 6"/></svg>',
    clip:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4h6v3H9zM9.5 13l2 2 3.5-4"/></svg>'
  };
  const md = t => H(t).replace(/\*\*(.+?)\*\*/g,"<b>$1</b>").replace(/\n/g,"<br>");
  const firstName = () => { let f = String((window.Auth && Auth.profile && !/^wa_\d+@/.test(Auth.profile.name||"") && Auth.profile.name) || "there").trim().split(" ")[0];
    if(/[._\d]/.test(f)){ f = f.split(/[._]/)[0].replace(/\d+/g,""); f = f ? f[0].toUpperCase() + f.slice(1) : "there"; } return f; };
  let K = { view:"home", thread:[], task:null };
  function closeKid(){ const o = document.getElementById("b2KidSheet"); if(o){ o.remove(); paintBottom(); } }
  window.bxCloseKid = closeKid;
  async function openKid(view){
    let o = document.getElementById("b2KidSheet");
    if(!o){ o = document.createElement("div"); o.id = "b2KidSheet"; o.className = "b2 b2-kdim"; document.body.appendChild(o);
      o.onclick = e=>{ if(e.target === o) closeKid(); }; }
    K.view = view || "home";
    if(K.task == null) K.loading = true;
    paintKid(); paintBottom();
    try{ K.task = await sproutNext(); }finally{ K.loading = false; } if(document.getElementById("b2KidSheet")) paintKid();
  }
  window.bxOpenKid = openKid;
  function taskTitle(x){ if(!x) return ""; let c = String(x.campaign||"Campaign"); const b = String(x.brand||"");
    if(b && c.toLowerCase().indexOf(b.toLowerCase()) === 0 && c.length > b.length) c = c.slice(b.length).trim(); return `${b?b+" · ":""}${c}`; }
  function kidHead(){ return `<i class="b2-grab"></i><div class="b2k-h"><img src="${KI()}" data-kid-me alt=""><span class="b2k-div"></span><div><b>${H(KN())} · Your sidekick</b><span><i></i>Here to help</span></div>
      <button type="button" class="b2k-ic" data-k="gear" aria-label="Make your sidekick yours" title="Make your sidekick yours">${B2I.gear}</button><button type="button" class="b2k-ic" data-k="x" aria-label="Close">${B2I.x}</button></div>`; }
  const inputBar = () => `<form class="b2k-in" id="b2kForm"><input id="b2kQ" placeholder="Ask ${H(KN())} anything…" autocomplete="off"><button type="button" class="b2k-mic" data-k="mic" aria-label="Speak">${B2I.mic}</button><button type="submit" class="b2k-send" aria-label="Send">${B2I.send}</button></form>`;
  function taskCard(x){
    if(!x) return "";
    const ph = window.B2 ? B2.camPhoto({ campaign_id:x.campaign_id, brand:x.brand, name:x.campaign, product:x.product, category:x.category }) : "";
    return `<div class="b2k-task">${ph?`<img src="${ph}" alt="">`:""}<div><b>${H(taskTitle(x))}</b><span>📅 ${H(STAGE_SHORT[x.stage]||String(x.stage||"").replace(/_/g," "))}</span>
      <button type="button" class="b2-mini forest" data-k="go:mycampaigns">Open brief ›</button></div><i class="b2k-chev">${B2I.chev}</i></div>`;
  }
  function paintKid(){
    const o = document.getElementById("b2KidSheet"); if(!o) return;
    const x = K.task;
    let body = "";
    if(K.view === "home"){
      const brand = x && x.brand ? x.brand : "";
      body = `<div class="b2k-hi">Hey ${H(firstName())}! What can we tackle today?</div>
        <div class="b2k-quick">
          <button type="button" data-k="ask:What needs my attention?"><i>${B2I.bell}</i><span>What needs my attention?</span><em>${B2I.chev}</em></button>
          <button type="button" data-k="ask:${brand?`What do I need to do for ${H(brand)}?`:"Help with my brief"}"><i>${B2I.doc}</i><span>${brand?`Help with my ${H(brand)} brief`:"Help with my brief"}</span><em>${B2I.chev}</em></button>
          <button type="button" data-k="go:opencampaigns"><i>${B2I.meg}</i><span>Find campaigns for me</span><em>${B2I.chev}</em></button>
          <button type="button" data-k="go:mediakit"><i>${B2I.layers}</i><span>Improve my media kit</span><em>${B2I.chev}</em></button></div>
        <div class="b2k-next"><div class="b2k-nk">✦ Next up</div>${K.loading && !x ? `<i class="b2sk" style="width:78%;height:18px;margin-top:6px"></i><i class="b2sk" style="width:52%;height:12px;margin-top:8px"></i><div class="b2k-nb"><i class="b2sk" style="width:104px;height:32px;border-radius:16px"></i><i class="b2sk" style="width:112px;height:32px;border-radius:16px"></i></div>` : x ? `<b>${H(taskTitle(x))}</b><div class="b2k-ns">${H(STAGE_TXT[x.stage]||"")}</div>
            <div class="b2k-nb"><button type="button" class="b2-mini forest" data-k="prep">Open task ›</button><button type="button" class="b2-mini light" data-k="remind">${B2I.bell}Remind me</button></div>`
          : `<b>Nothing due right now</b><div class="b2k-ns">Find a campaign that fits you.</div><div class="b2k-nb"><button type="button" class="b2-mini forest" data-k="go:opencampaigns">Find campaigns ›</button></div>`}</div>`;
    }
    if(K.view === "ask"){
      body = `<div class="b2k-thread" id="b2kThread">${K.thread.map(m=> m.role === "user"
          ? `<div class="b2k-u"><span class="b2k-ua">${B2I.user}</span><p>${H(m.text)}<i>${m.at||""} ✓✓</i></p></div>`
          : `<div class="b2k-b"><img src="${KI()}" data-kid-me alt=""><p class="${m.pending?"pending":""}">${m.pending?"<span class='b2k-dots'><i></i><i></i><i></i></span>":md(m.text)}</p></div>`).join("")}</div>
        ${x ? taskCard(x) : ""}
        <div class="b2k-chips"><button type="button" data-k="ask:What are the key requirements?">${B2I.doc}See key requirements</button><button type="button" data-k="ask:When is my deadline?">📅 View deadline</button><button type="button" data-k="ask:Suggest a content idea for this campaign">💡 Suggest content idea</button>${x?`<button type="button" data-k="prep">✓ Help me with this step</button>`:""}</div>`;
    }
    if(K.view === "prep" && x){
      body = `<div class="b2k-u"><span class="b2k-ua">${B2I.user}</span><p>Help me with it.<i>${now()} ✓✓</i></p></div>
        <div class="b2k-b"><img src="${KI()}" data-kid-me alt=""><p>Of course! I checked your brief. Here's your next step for <b>${H(x.brand||x.campaign||"this campaign")}</b> — have it ready before you continue.</p></div>
        <div class="b2k-prep"><div class="b2k-ph">${B2I.clip}<div><b>${H(STAGE_SHORT[x.stage]||"Your next step")}</b><span>${H(STAGE_TXT[x.stage]||"")}</span></div></div>
          <ul>${(PREP[x.stage]||PREP._).map(t=>`<li>${H(t)}</li>`).join("")}</ul>
          <div class="b2k-ns2">ⓘ <i>Nothing is sent yet.</i></div></div>
        <button type="button" class="b2-btn ghost-gold full" data-k="confirm">Review ${H((STAGE_SHORT[x.stage]||"step").toLowerCase())} ›</button>`;
    }
    if(K.view === "confirm" && x){
      body = `<div class="b2k-b"><img src="${KI()}" data-kid-me alt=""><p>You're in control. I'll open it only when you confirm.</p></div>
        <div class="b2k-conf"><i class="b2k-ci">${B2I.clip}</i><h4>${H(CONF[x.stage]||"Continue this step")} — ${H(x.brand||"")}?</h4>
          <div class="b2k-cr">🏛 <b>Campaign:</b> ${H(taskTitle(x))}</div><div class="b2k-cr">📄 <b>Action:</b> ${H(STAGE_TXT[x.stage]||"")}</div>
          <button type="button" class="b2-btn forest full" data-k="go:mycampaigns">↥ ${H(CONF[x.stage]||"Continue")}</button>
          <button type="button" class="b2-btn light full" data-k="prep">✎ Back to edit</button></div>
        <div class="b2k-await">ⓘ <i>Awaiting your confirmation.</i></div>`;
    }
    o.innerHTML = `<div class="b2k-sheet" role="dialog" aria-label="${H(KN())} — your sidekick">${kidHead()}<div class="b2k-body">${body}</div>${inputBar()}</div>`;
    const th = document.getElementById("b2kThread"); if(th) th.scrollTop = th.scrollHeight;
    o.querySelectorAll("[data-k]").forEach(b=> b.onclick = e=>{ e.preventDefault(); kidAct(b.dataset.k); });
    document.getElementById("b2kForm").onsubmit = e=>{ e.preventDefault(); const v = document.getElementById("b2kQ").value.trim(); if(v) ask(v); };
    const mic = o.querySelector('[data-k="mic"]'); if(mic && !(window.SpeechRecognition || window.webkitSpeechRecognition)) mic.style.display = "none";
  }
  const PREP = { content_created:["Shoot as per the brief — check the do's and don'ts","Upload the draft video for review","Don't post on Instagram yet"],
    changes_requested:["Read the brand's notes","Fix only what they asked","Upload the revised draft"], contract_sent:["Read the deliverables, fee and dates","Check ad rights and disclosure","Sign when everything looks right"],
    contract_signed:["Pick the address for the kit","Double-check the pincode"], product_sent:["Track the parcel","Tap Received when it arrives — the brief timer starts"],
    content_approved:["Post exactly the approved video","Use the caption, tags and Paid partnership label","Paste the post link"], invited:["Read the brief","Accept or decline the invite"],
    _:["Open the step in My campaigns","Follow the brief","Confirm when you're done"] };
  const CONF = { content_created:"Submit draft", changes_requested:"Submit revised draft", contract_sent:"Review & sign agreement", contract_signed:"Confirm address",
    product_sent:"Confirm the kit arrived", content_approved:"Add your post link", invited:"Answer the invite" };
  const now = () => new Date().toLocaleTimeString("en-IN",{ hour:"numeric", minute:"2-digit" }).toUpperCase();
  async function ask(text){
    K.view = "ask"; K.thread.push({ role:"user", text, at:now() }); K.thread.push({ role:"bot", pending:true }); paintKid();
    let reply = "";
    try{ reply = typeof builtInAnswer === "function" ? await builtInAnswer(text) : ""; }catch(e){ reply = "Sorry — I couldn't answer right now. " + (e.message||""); }
    K.thread = K.thread.filter(m=> !m.pending); K.thread.push({ role:"bot", text: reply || "I'm not sure yet — open My campaigns and I'll guide you step by step." });
    if(document.getElementById("b2KidSheet")) paintKid();
  }
  function kidAct(k){
    if(k === "x") return closeKid();
    if(k === "gear"){ if(window.bxKid) bxKid.sheet(); return; }
    if(k.startsWith("go:")){ closeKid(); go(k.slice(3)); return; }
    if(k.startsWith("ask:")) return ask(k.slice(4));
    if(k === "prep"){ K.view = K.task ? "prep" : "home"; return paintKid(); }
    if(k === "confirm"){ K.view = "confirm"; return paintKid(); }
    if(k === "remind"){ try{ localStorage.setItem("bx_remind", JSON.stringify({ t:taskTitle(K.task), at: Date.now() + 864e5 })); }catch(e){}
      if(typeof gateToast === "function") gateToast(`🔔 I'll remind you tomorrow — ${taskTitle(K.task)}`); return; }
    if(k === "mic"){ const SR = window.SpeechRecognition || window.webkitSpeechRecognition; if(!SR) return; const r = new SR(); r.lang = "en-IN"; r.onresult = e=>{ const v = e.results[0][0].transcript; const i = document.getElementById("b2kQ"); if(i){ i.value = v; } }; r.start(); return; }
  }
  // a reminder that came due
  setTimeout(()=>{ try{ const r = JSON.parse(localStorage.getItem("bx_remind")||"null"); if(r && r.at < Date.now() && isCreator()){ localStorage.removeItem("bx_remind"); if(typeof gateToast==="function") gateToast(`🔔 Reminder from ${KN()}: ${r.t}`); } }catch(e){} }, 6000);

  /* ---------- header avatar: the gold initial (V2 header) + sidebar "me" chip ---------- */
  // the creator's Instagram profile picture (cached), used wherever the gold initial used to show
  let _igPic = null, _igPicP = null;
  window.bxIgPic = function(){
    if(_igPic) return Promise.resolve(_igPic);
    if(!_igPicP) _igPicP = (async()=>{ try{ const r = await sb.from("social_accounts").select("username,profile_picture_url").eq("platform","instagram").eq("member_id", Auth.profile.id).order("updated_at",{ascending:false}).limit(1); const row = r && r.data && r.data[0]; _igPic = { url: (row && row.profile_picture_url) || "", username: (row && row.username) || "" }; }catch(e){ _igPic = { url:"", username:"" }; } return _igPic; })();
    return _igPicP;
  };
  window.bxAvatarHtml = function(ini){   // Pip (if chosen as profile picture) → Instagram photo → initial
    const useKid = window.bxKid && bxKid.prefs().avatar;
    if(useKid) return `<img src="${KI()}" data-kid-me alt="">`;
    if(_igPic && _igPic.url) return `<img src="${H(_igPic.url)}" alt="" referrerpolicy="no-referrer" onerror="this.replaceWith(document.createTextNode('${H(ini)}'))">`;
    return H(ini);
  };
  function paintMe(){
    const me = document.getElementById("me"); if(!me || !isCreator() || me.dataset.bxKid) return;
    const P = (window.Auth && Auth.profile) || {}, nm = /^wa_\d+@/.test(P.name||"") ? "Creator" : (P.name || "Creator");
    const ini = nm.trim().charAt(0).toUpperCase() || "C";
    if(!_igPic && window.sb && P.id) window.bxIgPic().then(()=>{ const m = document.getElementById("me"); if(m) m.dataset.av = ""; paintMe(); paintMeChip(); });
    const want = (window.bxKid && bxKid.prefs().avatar ? "kid" : (_igPic && _igPic.url) || "") + "|" + ini;
    if(me.querySelector(".b2-av") && me.dataset.av === want) return;
    me.dataset.av = want; me.classList.add("b2-me"); me.innerHTML = `<span class="b2-av${want.startsWith("|")?"":" pic"}">${window.bxAvatarHtml(ini)}</span>`;
  }
  let _handle = null;
  window.bxPaintMeChip = () => paintMeChip();
  async function paintMeChip(){
    const foot = document.querySelector(".sidebar-foot"); if(!foot || !isCreator()) return;
    let chip = document.getElementById("b2MeChip");
    if(!chip){ chip = document.createElement("button"); chip.type = "button"; chip.id = "b2MeChip"; chip.className = "b2-mechip"; foot.appendChild(chip); chip.onclick = ()=> go(creatorNavKeys().includes("profile") ? "profile" : "mediakit"); }
    if(_handle === null){ _handle = ""; try{ const r = await sb.from("social_accounts").select("username").eq("platform","instagram").eq("member_id", Auth.profile.id).order("updated_at",{ascending:false}).limit(1); _handle = (r && r.data && r.data[0] && r.data[0].username) || ""; }catch(e){} }
    const md2 = (window.__bxMeta && __bxMeta.bx_manual) || {};
    const useKid = window.bxKid && bxKid.prefs().avatar;
    const av = !useKid && _igPic && _igPic.url ? `<img src="${H(_igPic.url)}" alt="" referrerpolicy="no-referrer" onerror="this.src='${KI()}'">` : `<img src="${KI()}" data-kid-me alt="">`;
    chip.innerHTML = `<span class="b2-mav">${av}</span><b>${H(_handle ? "@"+_handle : (md2.ig_handle || "My profile"))}</b>`;
  }
  new MutationObserver(()=>{ if(isCreator()) paintMe(); }).observe(document.documentElement, { childList:true, subtree:true });

  // badge/next-move refresh when the dashboard loader learns the real counts
  setInterval(()=>{ if(isCreator()) paintNext(); }, 15000);
  // if the shell already painted before this file loaded
  if(document.getElementById("content") && document.getElementById("content").children.length){ chromeOnce(); flags(); paintNext(); paintSprout(); paintBottom(); watch(); touchPage(); if(isCreator()) renderNav(); }
})();
