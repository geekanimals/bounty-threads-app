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
        if(!body.querySelector(".bx-trust")) body.insertAdjacentHTML("beforeend", TRUST);
        if(!body.querySelector("#bxHome")) buildHome(body);
      }
    }
  }

  /* ---------- Home like the Figma (M09 / W02): your next move, active campaigns, made for your world,
     dream brand board, media kit progress — from the creator's real data; the existing cockpit stays below ---------- */
  let _home = null, _homeAt = 0;
  async function homeData(){
    if(_home && Date.now()-_homeAt < 45000) return _home;
    const api = (fn,a)=> sb.schema("api").rpc(fn, a||{}).then(r=> r && !r.error ? r.data : null, ()=> null);
    const [mine, open, prof] = await Promise.all([ api("get_my_campaigns"), window.__ciOpsEnabled ? api("list_open_campaigns") : null, window.__ciProfileEnabled ? api("get_my_profile") : null ]);
    _home = { mine: Array.isArray(mine)?mine:[], open: Array.isArray(open)?open:[], dreams: (prof && Array.isArray(prof.dream_brands)) ? prof.dream_brands : [] };
    _homeAt = Date.now(); return _home;
  }
  const DONE_ST = ["completed"], OUT_ST = ["ineligible","brand_declined","dropped","rejected"], WAIT_ST = ["applied","eligible","sent_to_brand","shortlisted","content_submitted","published","address_confirmed","accepted","brand_confirmed"];
  const H = s => String(s==null?"":s).replace(/[&<>"']/g, ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  async function buildHome(body){
    const box = document.createElement("div"); box.id = "bxHome"; box.className = "bx-home";
    box.innerHTML = `<div class="bx-home-row"><div class="card bx-home-act"><div class="muted">Finding your next move…</div></div>
      <div class="card bx-home-sprout"><img src="${A}sprout_celebrate.png" onerror="this.src='${A}sprout_wave.png'" alt=""><i id="bxHomeQuote">“I'm on it — checking your campaigns.”</i></div></div>`;
    body.insertBefore(box, body.firstChild);
    // the old "ready / profile %" banner and "Running campaigns" card say the same thing as these — once only
    body.querySelectorAll(".bx-hero").forEach(x=> x.classList.add("bx-dupe"));
    let d; try{ d = await homeData(); }catch(e){ d = { mine:[], open:[], dreams:[] }; }
    if(!box.isConnected) return;
    const order = (typeof AI_ACTION_ORDER!=="undefined") ? AI_ACTION_ORDER : [];
    const live = d.mine.filter(x=> !DONE_ST.includes(x.stage) && !OUT_ST.includes(x.stage));
    const yours = live.filter(x=> !WAIT_ST.includes(x.stage)).sort((a,b)=>((order.indexOf(a.stage)+1)||99)-((order.indexOf(b.stage)+1)||99));
    const req = window.__profileReq, pct = req ? Math.round(100*req.done/Math.max(req.total,1)) : null;
    // 1) the one action that matters now
    let act;
    if(window.__profileGate) act = { pill:"Action needed", t:"Connect Instagram to unlock campaigns", s:"Your media kit builds itself — then every campaign opens for you.", b:"Connect Instagram", go:"mediakit" };
    else if(yours[0]) act = { pill:"Action needed", t:`${yours[0].brand?yours[0].brand+" · ":""}${yours[0].campaign||"Campaign"}`, s: STAGE_TXT[yours[0].stage] || String(yours[0].stage||"").replace(/_/g," "), b:"Open task", go:"mycampaigns" };
    else if(req && !req.complete) act = { pill:"Next step", t:`Your profile is ${pct}% complete`, s:"Brands pick complete profiles first — it takes a couple of minutes.", b:"Finish profile", go:"profile" };
    else act = { pill:"Next step", t:"Find your next campaign", s:`${d.open.filter(x=>!x.my_stage && !x.applications_closed).length} campaigns open for you right now.`, b:"Explore campaigns", go:"opencampaigns" };
    box.querySelector(".bx-home-act").innerHTML = `<span class="bxg-pill">${act.pill}</span><div class="bx-ha-row"><span class="bx-ha-ic">${svg("clip")}</span><b>${H(act.t)}</b></div><div class="muted">${H(act.s)}</div>
      <div class="bxg-btns"><button type="button" class="btn" data-hgo="${act.go}">${act.b} ›</button><button type="button" class="btn ghost" data-hgo="__sprout">Ask Sprout ›</button></div>`;
    const steps = (window.__profileGate?1:0) + yours.length + (req && !req.complete ? 1 : 0);
    document.getElementById("bxHomeQuote").textContent = steps ? `“You're ${steps} step${steps>1?"s":""} away from your next win!”` : "“All caught up — let's find your next collab!”";
    // 2) active campaigns
    if(live.length){
      box.insertAdjacentHTML("beforeend", `<div class="card bx-home-active"><h3>Active campaigns <span class="muted">· ${live.length} in progress</span></h3>
        ${live.slice(0,5).map(x=>`<div class="bx-ha-item" data-hgo="mycampaigns"><span class="bxg-ini sm">${H(String(x.brand||x.campaign||"C").charAt(0).toUpperCase())}</span><div><b>${H(x.brand||"")}</b> <span class="muted">· ${H(x.campaign||"")}</span><div class="muted">${H(STAGE_TXT[x.stage]||String(x.stage||"").replace(/_/g," "))}</div></div><span class="bx-st ${WAIT_ST.includes(x.stage)?"wait":"act"}">${WAIT_ST.includes(x.stage)?"In progress":"Action needed"}</span></div>`).join("")}</div>`);
      body.querySelectorAll(".card").forEach(cd=>{ const h = cd.querySelector("h3"); if(h && /Running campaigns/.test(h.textContent)) cd.classList.add("bx-dupe"); });
    }
    // 3) made for your world: open campaigns you haven't applied to
    const fresh = d.open.filter(x=> !x.my_stage && !x.applications_closed).slice(0,3);
    if(fresh.length){
      box.insertAdjacentHTML("beforeend", `<div class="bx-divider">✦ Made for your world ✦</div><div class="bxg-grid bx-home-camps">${fresh.map(x=>{
        const k = x.campaign_type || ({cash:"paid",hybrid:"barter_paid",barter:"barter"})[x.comp_type] || "", KL = {paid:"Paid",barter:"Barter",barter_paid:"Hybrid"};
        const ok = x.eligibility && x.eligibility.eligible === true, no = x.eligibility && x.eligibility.eligible === false;
        return `<article class="bxg-camp" data-hbrief="${H(x.campaign_id)}"><div class="bxg-cover"><span class="bxg-ini">${H(String(x.brand||x.name||"B").charAt(0).toUpperCase())}</span><span class="bxg-type t-${H(k||"x")}">${KL[k]||"Campaign"}</span></div>
          <div class="bxg-body"><h4>${H(x.brand||"")} · ${H(x.name||"Campaign")}</h4><div class="bxg-comp">${KL[k]||"Campaign"}${x.product_value?" · ₹"+Number(x.product_value).toLocaleString("en-IN"):""}${x.ends_on?" · till "+H(x.ends_on):""}</div>
          <span class="bxg-match ${ok?"ok":""}">${ok?"✓ You qualify":no?"Check eligibility":"Potential match"}</span><button type="button" class="btn" data-hbrief="${H(x.campaign_id)}">View brief ›</button></div></article>`; }).join("")}</div>`);
      [...body.children].filter(x=> x.classList.contains("bx-divider")).forEach(x=> x.remove());
    }
    // 4) dream brand board + media kit progress
    const dreams = d.dreams.slice(0,5);
    box.insertAdjacentHTML("beforeend", `<div class="bx-home-row two">
      <div class="card bx-home-dream"><h3>Your Dream Brand Board</h3>${dreams.length?`<div class="bx-dream-chips">${dreams.map(x=>`<span>${H(x.submitted_brand_name||"Brand")} ✓</span>`).join("")}</div><button type="button" class="btn sm" data-hgo="opencampaigns">See opportunities ›</button>`:`<div class="muted">Pick up to 5 brands you'd love to work with — private to you.</div><button type="button" class="btn sm" data-hgo="profile">Add dream brands ›</button>`}</div>
      <div class="card bx-home-kit"><h3>${pct!=null?`Media kit · ${pct}% complete`:"Your media kit"}</h3>${pct!=null?`<div class="bx-bar"><i style="width:${pct}%"></i></div>`:""}<button type="button" class="btn sm ${pct!=null&&pct<100?"":"ghost"}" data-hgo="${pct!=null&&pct<100?"profile":"mediakit"}">${pct!=null&&pct<100?"Finish profile ›":"View media kit ›"}</button></div></div>`);
    box.querySelectorAll("[data-hgo]").forEach(b=> b.onclick = ()=>{ const k = b.dataset.hgo; if(k==="__sprout") return openAi(); go(k); });
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
  window.renderShell = function(){
    document.body.classList.remove("bx-pre");
    if(window.bxMemberExploreOff) bxMemberExploreOff();
    if(window.__bxIg && window.__bxIgStage) __bxIgStage(2);
    chromeOnce(); flags();
    const r = _renderShell.apply(this, arguments);
    flags(); paintNext(); paintSprout(); paintBottom(); watch(); touchPage(); tidyNames();
    if(isCreator() && window.bxMaybeOnboard) setTimeout(()=> bxMaybeOnboard(), 600);   // new creator: profile setup step 1–3, once
    return r;
  };
  /* ---------- Ask Sprout sheet (Figma M28): greeting, quick asks, your next task, then the same chat ---------- */
  const STAGE_TXT = { changes_requested:"Changes requested — upload a revised draft", content_created:"Shoot & submit your draft", contract_sent:"Review & sign your agreement",
    contract_signed:"Confirm your delivery address", content_approved:"Draft approved — post it & share the link", product_sent:"Package on the way — confirm when it arrives",
    invited:"You're invited — accept or decline", content_submitted:"Draft sent — waiting for review", address_confirmed:"Address confirmed — product ships soon",
    published:"Post live — waiting for verification", brand_confirmed:"Brand confirmed you", accepted:"Confirmed — next step coming", sent_to_brand:"With the brand for review",
    shortlisted:"Shortlisted", eligible:"Eligible — waiting for the brand", applied:"Applied — waiting for the brand", completed:"Completed" };
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
