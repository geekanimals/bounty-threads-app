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
    search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    moon:'<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
    target:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>'
  };
  const svg = (k, sw) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw||1.8}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[k]}</svg>`;
  const TARGET = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#D3A94E"/><circle cx="12" cy="12" r="8" fill="#C2362F"/><circle cx="12" cy="12" r="5" fill="#F4E8CE"/><circle cx="12" cy="12" r="2.4" fill="#C2362F"/></svg>';
  const LOGO = `<span class="bx-logo" aria-label="Bounty">B${TARGET}UNTY</span>`;

  // creator nav: Figma names + icons + groups (keys come from the app, so gating/filters are unchanged)
  const LABEL = { dashboard:"Home", opencampaigns:"Discover", marketplace:"Discover", mycampaigns:"My campaigns",
    mediakit:"Media kit", reports:"Analytics", instagram:"Instagram", messages:"Messages", profile:"Profile", intelligence:"Insights" };
  const ICON = { dashboard:"home", opencampaigns:"compass", marketplace:"compass", mycampaigns:"clip", mediakit:"layers",
    reports:"chart", instagram:"insta", messages:"chat", profile:"user", intelligence:"chart" };
  const GROUPS = [["Today",["dashboard"]],["Campaigns",["opencampaigns","marketplace","mycampaigns"]],
    ["Create & grow",["mediakit","reports","instagram","intelligence"]],["My account",["profile","messages"]]];
  // page titles that follow the new names (only when the title is still the old one)
  const TITLE = { "Dashboard":"Your next move.", "Campaigns":"Discover campaigns", "Open Campaigns":"Discover campaigns",
    "Reports":"Analytics", "Media Kit":"My Media Kit", "Creator Profile":"My profile", "My Campaigns":"My campaigns" };

  function profileKey(keys){ return keys.includes("profile") ? "profile" : "mediakit"; }
  function bottomItems(){
    const keys = creatorNavKeys();
    return [["dashboard","Home","home"],["mycampaigns","Campaigns","megaphone"],["__sprout","Sprout",""],
      ["reports","Analytics","chart"],[profileKey(keys),"Profile","user"]].filter(b=> b[0]==="__sprout" || keys.includes(b[0]));
  }
  const locked = k => window.__profileGate && typeof GATE_OPEN_PAGES!=="undefined" && !GATE_OPEN_PAGES.includes(k);
  function go(k){
    if(locked(k)){ if(window.gateToast) gateToast(joinNeedsText()); return; }
    currentPage = k; renderShell(); window.scrollTo(0,0);
  }

  /* ---------- body flags ---------- */
  function flags(){
    const on = isCreator();
    document.body.classList.toggle("bx", on);
    if(on){ document.body.dataset.pg = currentPage; document.body.dataset.bg = FOREST.has(currentPage) ? "forest" : "parch"; }
    else { delete document.body.dataset.pg; delete document.body.dataset.bg; }
  }

  /* ---------- static chrome (once) ---------- */
  function chromeOnce(){
    if(document.getElementById("bxBottom")) return;
    const brand = document.querySelector(".sidebar .brand");
    if(brand && !brand.querySelector(".bx-logo")) brand.insertAdjacentHTML("beforeend", LOGO);
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
      t.innerHTML = `<button type="button" data-t="search">${svg("search")}<span>Search</span></button><button type="button" data-t="theme">${svg("moon")}<span>Theme</span></button>`;
      nav.parentNode.insertBefore(t, nav);
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
      if(ic && ICON[k]) ic.innerHTML = ic.textContent === "🔒" ? svg(ICON[k]) : svg(ICON[k]);
      if(a.style.opacity && !a.querySelector(".bx-lk")) a.insertAdjacentHTML("beforeend", `<i class="bx-lk">${svg("lock")}</i>`);
      if(dup.has(k)) a.classList.add("bx-dup");
      // Instagram not connected yet: Discover still opens — the public campaign list, Apply asks for Instagram
      if((k==="opencampaigns" || k==="marketplace") && window.__profileGate && window.bxMemberExplore){
        a.style.opacity = ""; a.title = "Browse live campaigns";
        if(ic) ic.innerHTML = svg(ICON[k]);
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
    else if(window.__alertsUnread > 0){ t = "Your next move"; s = window.__alertsUnread + " action" + (window.__alertsUnread>1?"s":"") + " due"; k = "dashboard"; }
    b.innerHTML = `<span class="tg">${TARGET}</span><span><b>${t}</b><i>${s}</i></span>`;
    b.onclick = ()=> go(k);
  }
  function paintSprout(){
    const l = document.getElementById("aiLaunch");
    if(l && !l.dataset.bx){ l.dataset.bx = 1; l.dataset.old = l.innerHTML; }
    if(l) l.innerHTML = isCreator() ? `<img src="${A}sprout_wave.png" alt=""><span><b>Ask Sprout</b><i>Help with anything</i></span>` : (l.dataset.old || l.innerHTML);
  }
  function paintBottom(){
    const bar = document.getElementById("bxBottom"); if(!bar) return;
    if(!isCreator()){ bar.innerHTML = ""; return; }
    bar.innerHTML = bottomItems().map(([k,l,ic])=> k==="__sprout"
      ? `<button type="button" class="sp" data-k="__sprout" aria-label="Ask Sprout"><span class="orb"><img src="${A}sprout_wave.png" alt=""></span>${l}</button>`
      : `<button type="button" data-k="${k}" class="${k===currentPage?"on":""} ${locked(k)?"locked":""}">${svg(ic)}${l}</button>`).join("");
    bar.querySelectorAll("button").forEach(b=> b.onclick = ()=>{ const k = b.dataset.k; if(k==="__sprout") return openAi(); go(k); });
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
    if(currentPage === "dashboard"){
      const head = c.querySelector(".page-head");
      if(head && !head.querySelector(".bx-eyebrow")){
        const hr = new Date().getHours(), part = hr < 12 ? "morning" : hr < 17 ? "afternoon" : "evening";
        head.firstElementChild.insertAdjacentHTML("afterbegin", `<div class="bx-eyebrow">✦ Good ${part}, creator</div>`);
        const p = head.querySelector("p"); if(p) p.textContent = "Get discovered by brands you love. Build the creator career you want.";
      }
      const body = document.getElementById("cdBody");
      if(body && body.querySelector(".ws-stats")){
        const hero = body.querySelector(".cd-gate, .cd-prof") || [...body.children].find(x=> x.classList.contains("card") && /ready for campaigns/i.test(x.textContent));
        if(hero) hero.classList.add("bx-hero");
        const subs = body.querySelectorAll(":scope > .ci-sub");
        if(subs[0] && !body.querySelector(".bx-divider")) subs[0].insertAdjacentHTML("beforebegin", `<div class="bx-divider">✦ Made for your world ✦</div>`);
        if(!body.querySelector(".bx-trust")) body.insertAdjacentHTML("beforeend", TRUST);
      }
    }
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
  window.renderShell = function(){
    document.body.classList.remove("bx-pre");
    if(window.bxMemberExploreOff) bxMemberExploreOff();
    chromeOnce(); flags();
    const r = _renderShell.apply(this, arguments);
    flags(); paintNext(); paintSprout(); paintBottom(); watch(); touchPage(); tidyNames();
    return r;
  };
  // Sprout = the creator's AI assistant (same chat, same backend — new face)
  const _openAi = window.openAi;
  if(typeof _openAi === "function") window.openAi = function(){
    const r = _openAi.apply(this, arguments);
    if(isCreator()){ const t = document.getElementById("aiTitle"), s = document.getElementById("aiSub");
      if(t) t.textContent = "Sprout"; if(s) s.textContent = "Your sidekick · ask me anything";
      try{
        const old = ROLES.creator.ai.title;
        if(AI_HISTORY[0] && AI_HISTORY[0].role==="assistant" && old && AI_HISTORY[0].content.includes(old)){
          AI_HISTORY[0].content = AI_HISTORY[0].content.replace("Hi Creator — I'm your " + old, "Hi, I'm Sprout — your sidekick").replace(old, "Sprout");
          renderAiChat();
        }
        const inp = document.querySelector("#aiBody input, #aiBody textarea"); if(inp) inp.placeholder = "Ask Sprout…";
      }catch(e){}
    }
    return r;
  };
  // badge/next-move refresh when the dashboard loader learns the real counts
  setInterval(()=>{ if(isCreator()) paintNext(); }, 15000);
  // if the shell already painted before this file loaded
  if(document.getElementById("content") && document.getElementById("content").children.length){ chromeOnce(); flags(); paintNext(); paintSprout(); paintBottom(); watch(); touchPage(); if(isCreator()) renderNav(); }
})();
