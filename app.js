// Geek Influencer OS — shell (Sprint 1 UI + Sprint 2 auth)
let currentRole = "owner";
let currentPage = "dashboard";

const $ = s => document.querySelector(s);
// Skeleton placeholders shown while live data loads (shimmer, theme-aware; see styles.css .sk*)
function skel(kind, n){
  const L = w=>`<div class="sk sk-line ${w||""}"></div>`, T = `<div class="sk sk-title"></div>`;
  const tiles = k=>`<div class="sk-tiles">${Array.from({length:k}).map(()=>`<div class="sk sk-tile"></div>`).join("")}</div>`;
  const card = ()=>`<div class="sk-card">${T}${L("w80")}${L("w60")}${L("w40")}<div class="sk" style="height:34px;width:120px;margin-top:12px;border-radius:10px"></div></div>`;
  const rows = k=>`<div class="card">${T}${Array.from({length:k}).map(()=>`<div class="sk-row"><div class="sk sk-dot"></div><div style="flex:1">${L("w60")}${L("w40")}</div></div>`).join("")}</div>`;
  if(kind==="kit") return `<div class="card" style="padding:0;overflow:hidden"><div class="sk sk-cover"></div><div class="sk sk-avatar"></div><div style="padding:12px 24px 22px">${T}${L("w40")}${L("w80")}</div></div>${tiles(5)}<div class="card">${T}<div class="sk-grid">${Array.from({length:n||6}).map(()=>`<div class="sk sk-sq"></div>`).join("")}</div></div>`;
  if(kind==="dash") return `<div class="sk" style="height:64px;border-radius:16px;margin-bottom:14px"></div>${tiles(5)}${tiles(6)}<div class="grid two">${rows(3)}${rows(3)}</div>`;
  if(kind==="cards") return `<div class="sk-cards">${Array.from({length:n||6}).map(card).join("")}</div>`;
  if(kind==="list") return rows(n||4);
  if(kind==="stats") return tiles(n||4);
  if(kind==="table") return `${tiles(4)}<div class="card">${T}${Array.from({length:n||6}).map(()=>`<div class="sk" style="height:16px;margin:12px 0"></div>`).join("")}</div>`;
  if(kind==="profile") return `<div class="card">${T}${L("w80")}<div class="sk" style="height:8px;margin-top:12px"></div></div><div class="card" style="margin-top:14px">${T}<div class="cp-grid">${Array.from({length:6}).map(()=>`<div><div class="sk sk-line w40"></div><div class="sk sk-field"></div></div>`).join("")}</div></div>`;
  return `<div class="card">${T}${L("w80")}${L("w60")}</div>`;
}
window.skel = skel;
// mobile: tap outside the open sidebar closes it
document.addEventListener("click", e=>{
  const sb = document.getElementById("sidebar");
  if(!sb || !sb.classList.contains("open") || window.innerWidth > 760) return;
  if(sb.contains(e.target) || (e.target.closest && e.target.closest("#menuBtn"))) return;
  sb.classList.remove("open");
});
const el = (tag, cls, html) => { const e=document.createElement(tag); if(cls)e.className=cls; if(html!=null)e.innerHTML=html; return e; };

// Escape any value that comes from the database or a user before it goes into innerHTML.
// Prevents stored XSS (e.g. a creator/campaign name containing markup).
function esc(v){
  if(v==null) return "";
  return String(v)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}

// Only allow http(s)/relative/anchor URLs into href/src — blocks javascript:, data:, etc.
function safeUrl(u){
  if(u==null) return "#";
  const s = String(u).trim();
  if(/^https?:\/\//i.test(s) || s.startsWith("/") || s.startsWith("#")) return s;
  if(/^[a-z0-9.-]+\.[a-z]{2,}([\/?#]|$)/i.test(s)) return "https://"+s; // bare domain
  return "#";
}

/* ---------- Role (locked to the signed-in user's real role) ---------- */
function initRoles(){
  const sel = $("#roleSelect");
  if(!sel) return;
  const wrap = sel.closest(".role-switch");
  // A signed-in user is locked to their DB role — no free switching between agency/creator/etc.
  if(window.Auth && Auth.profile){
    if(ROLES[Auth.profile.role]) currentRole = Auth.profile.role;
    const label = (ROLES[currentRole] && ROLES[currentRole].label) || currentRole;
    if(wrap) wrap.innerHTML = `<label>Signed in as</label><div class="role-static">${esc(label)}</div>`;
    return;
  }
  // No auth (shouldn't happen in production) — allow the demo switcher.
  sel.innerHTML = Object.entries(ROLES).map(([k,r])=>`<option value="${k}">${r.label}</option>`).join("");
  sel.value = currentRole;
  sel.onchange = e => { currentRole = e.target.value; currentPage = "dashboard"; renderShell(); };
}

/* ---------- Sidebar ---------- */
const GATE_OPEN_PAGES = ["mediakit","profile","messages"];   // pages a creator can use before Instagram + WhatsApp are connected
function creatorNavKeys(){
  let keys = ROLES.creator.nav.slice();
  if(!window.__ciProfileEnabled) keys = keys.filter(k=>k!=="profile");
  if(!window.__ciOpsEnabled) keys = keys.map(k=> k==="opencampaigns" ? "marketplace" : k).filter(k=>k!=="mycampaigns");
  // Creator Intelligence is hidden from the creator sidebar for now (bring back: uncomment)
  // if(window.__ciIntelEnabled) keys.push("intelligence");
  return keys;
}
function navKeyAllowed(k){
  if((k==="campaignops"||k==="brandsetup") && !window.__ciOpsEnabled) return false;
  if(k==="campaignops" && !window.__ciOpsOperator) return false;   // the pipeline board is the Geek operators' tool
  if(k==="cintel" && !window.__ciIntelEnabled) return false;
  return true;
}
function renderNav(){
  const nav = $("#nav"); nav.innerHTML="";
  if(currentRole==="creator") return renderNavKeys(nav, creatorNavKeys());
  const sections = (typeof NAV_SECTIONS!=="undefined" && NAV_SECTIONS[currentRole]) || [["", ROLES[currentRole].nav]];
  if(window.__isAdmin){
    navHeading(nav, "Super Admin");
    ADMIN_NAV.forEach(([key, ic, label])=>{
      const tab = key.split(":")[1];
      const a = el("a","", `<span class="ic">${ic}</span><span>${esc(label)}</span><b class="nav-badge" data-navcount="${key}"></b>`);
      a.setAttribute("data-page", key);
      if(currentPage==="admin" && _adminTab===tab) a.classList.add("active");
      a.onclick = ()=>{ _adminTab = tab; currentPage = "admin"; renderShell(); if(window.innerWidth<=760) $("#sidebar").classList.remove("open"); };
      nav.appendChild(a);
    });
  }
  sections.forEach(([title, keys])=>{
    keys = keys.filter(navKeyAllowed);
    if(!keys.length) return;
    if(title) navHeading(nav, window.__isAdmin && title==="Today" ? "My workspace" : title);
    renderNavKeys(nav, keys);
  });
  paintNavCounts();
}
function navHeading(nav, title){ const h = el("div","nav-sec"); h.textContent = title; nav.appendChild(h); }
// live numbers beside the sidebar items (what's waiting on you), refreshed every 30 s
let _navCounts = null, _navCountTimer = null;
const NAV_COUNT_KEYS = { approvals:"approvals", campaigns:"process", logistics:"logistics",
  "admin:approvals":"signups", "admin:overview":"approvals", "admin:applications":"applicants", "admin:campaigns":"campaigns_waiting" };
function paintNavCounts(){
  const c = _navCounts || {};
  const dn = document.getElementById("dashNeeds");
  if(dn){ const n = Number(c.approvals)||0, parts = [];
    if(c.signups) parts.push(`${c.signups} signup${c.signups>1?"s":""}`);
    if(c.campaigns_waiting) parts.push(`${c.campaigns_waiting} campaign${c.campaigns_waiting>1?"s":""} to approve`);
    if(c.applicants) parts.push(`${c.applicants} creator${c.applicants>1?"s":""} to decide`);
    if(c.reviews) parts.push(`${c.reviews} video${c.reviews>1?"s":""} to review`);
    if((c.process||0)-(c.reviews||0)>0) parts.push(`${c.process-c.reviews} barter step${c.process-c.reviews>1?"s":""} (ship / deliver / chase)`);
    dn.innerHTML = n ? `<button class="dash-needs" id="dashNeedsGo">⚡ <b>${n} thing${n>1?"s":""} waiting on you</b><span>${esc(parts.join(" · "))}</span><em>Open Approvals →</em></button>` : "";
    const g = document.getElementById("dashNeedsGo"); if(g) g.onclick = ()=>{ currentPage = "approvals"; renderShell(); };
  }
  document.querySelectorAll("#nav a[data-page]").forEach(a=>{
    const key = a.getAttribute("data-page"), field = NAV_COUNT_KEYS[key];
    let b = a.querySelector(".nav-badge");
    if(!field){ if(b) b.remove(); return; }
    if(!b){ b = el("b","nav-badge"); a.appendChild(b); }
    const n = Number(c[field])||0;
    b.textContent = n>99 ? "99+" : n; b.style.display = n ? "" : "none";
    b.title = key==="campaigns" ? "Creators in the barter process waiting on you" : key==="logistics" ? "Products to send / in transit" : "Waiting on your decision";
  });
}
async function pollNavCounts(){
  if(!window.sb || !window.__osBooted || currentRole==="creator" || document.visibilityState!=="visible") return;
  const { data, error } = await sb.schema("api").rpc("nav_counts").then(r=>r, e=>({error:e}));
  if(error || !data) return;
  _navCounts = data; paintNavCounts();
}
function startNavCounts(){
  if(_navCountTimer) return;
  _navCountTimer = setInterval(pollNavCounts, 30000); setTimeout(pollNavCounts, 1200);
  document.addEventListener("visibilitychange", ()=>{ if(document.visibilityState==="visible") pollNavCounts(); });
}
function renderNavKeys(nav, keys){
  keys.forEach(key=>{
    let m = NAV_META[key] || {ic:"🛡", label:key};
    if(currentRole==="creator" && key==="profile" && window.__profileReq && window.__profileReq.complete) m = {ic:"✅", label:"Creator Profile"};
    const a = el("a","", `<span class="ic">${m.ic}</span><span>${m.label}</span>`);
    a.setAttribute("data-page", key);
    if(key===currentPage) a.classList.add("active");
    const locked = window.__profileGate && !GATE_OPEN_PAGES.includes(key);
    if(locked){ a.style.opacity = ".45"; a.title = "Connect Instagram (media kit) and WhatsApp to unlock"; a.querySelector(".ic").textContent = "🔒"; }
    a.onclick = ()=>{
      if(locked){ gateToast(joinNeedsText()); return; }
      currentPage=key; renderShell(); if(window.innerWidth<=760) $("#sidebar").classList.remove("open"); };
    nav.appendChild(a);
  });
}

function renderMe(){
  const r = ROLES[currentRole];
  let initials = r.initials, title = r.name;
  if(window.Auth && Auth.profile){
    title = Auth.profile.name || Auth.profile.org || "Me";
    initials = String(title).split(" ").filter(Boolean).map(x=>x[0]).join("").slice(0,2).toUpperCase() || "ME";
  }
  $("#me").textContent = initials;
  $("#me").title = title + " — view profile";
  applyIgAvatar();
  // Badge = count of real pending tasks (set by the dashboard loader); 0 until known.
  const unread = window.__alertsUnread != null ? window.__alertsUnread : (window.__geekTasks != null ? window.__geekTasks : 0);
  $("#notifCount").textContent = unread > 9 ? "9+" : unread; $("#notifCount").style.display = unread > 0 ? "" : "none";
}

// Creator's live Instagram profile picture in the top-right avatar and the sidebar corner.
// Kept fresh by instagram-media-sync (profile_picture_url is refreshed on every sync).
let _igAvatarUrl = null, _igAvatarAt = 0;
async function applyIgAvatar(force){
  if(!(window.Auth && Auth.profile && window.sb)) return;
  if(!force && _igAvatarUrl && Date.now()-_igAvatarAt < 60000){ paintIgAvatar(); return; }
  try{
    const { data } = await sb.from("social_accounts").select("profile_picture_url,username").eq("platform","instagram")
      .eq("member_id", Auth.profile.id).limit(1);
    const row = data && data[0];
    _igAvatarUrl = row && row.profile_picture_url || null; _igAvatarAt = Date.now();
    window.__igUsername = row && row.username || null;
  }catch(e){}
  paintIgAvatar();
}
function paintIgAvatar(){
  const me = document.getElementById("me");
  if(me && _igAvatarUrl){
    me.textContent = ""; me.style.backgroundImage = `url("${_igAvatarUrl.replace(/"/g,"%22")}")`;
    me.style.backgroundSize = "cover"; me.style.backgroundPosition = "center";
  }
  const box = document.querySelector(".org-box");
  if(box){
    let img = document.getElementById("sideAvatar");
    if(_igAvatarUrl){
      if(!img){ img = document.createElement("img"); img.id = "sideAvatar"; img.alt = "";
        img.style.cssText = "width:34px;height:34px;border-radius:50%;object-fit:cover;flex:0 0 auto;margin-right:8px";
        box.insertBefore(img, box.firstChild); }
      if(img.getAttribute("src") !== _igAvatarUrl) img.src = _igAvatarUrl;
      img.onerror = ()=>{ img.remove(); };
    }
  }
  const who = document.getElementById("whoLabel");
  if(who && window.__igUsername) who.textContent = "@" + window.__igUsername;
}


/* ---------- Profile card (top-right avatar) — creator sees their live Instagram at a glance ---------- */
function closeMeCard(){ const c = document.getElementById("meCard"); if(c) c.remove(); document.removeEventListener("keydown", meCardKey); document.removeEventListener("click", meCardOutside, true); $("#me")?.setAttribute("aria-expanded","false"); }
function meCardKey(e){ if(e.key==="Escape") closeMeCard(); }
function meCardOutside(e){ const c = document.getElementById("meCard"); if(c && !c.contains(e.target) && !e.target.closest("#me")) closeMeCard(); }
function anchorMeCard(){
  const m = document.getElementById("me"), c = document.getElementById("meCard"); if(!m || !c) return;
  const r = m.getBoundingClientRect();
  c.style.top = Math.round(r.bottom + 10) + "px";
  c.style.right = window.innerWidth > 560 ? Math.max(12, Math.round(window.innerWidth - r.right)) + "px" : "";
}
window.addEventListener("resize", anchorMeCard);
async function toggleMeCard(){
  if(document.getElementById("meCard")){ closeMeCard(); return; }
  closeNotif && document.getElementById("notifOverlay")?.classList.contains("open") && closeNotif();
  const c = document.createElement("div"); c.id = "meCard"; c.className = "me-card"; c.setAttribute("role","dialog"); c.setAttribute("aria-label","Your profile");
  c.innerHTML = `<div class="me-card-in">${skel("list",2)}</div>`;
  document.body.appendChild(c); anchorMeCard(); $("#me").setAttribute("aria-expanded","true");
  document.addEventListener("keydown", meCardKey); setTimeout(()=> document.addEventListener("click", meCardOutside, true), 0);
  await paintMeCard();
}
async function paintMeCard(){
  const c = document.getElementById("meCard"); if(!c) return;
  const P = (window.Auth && Auth.profile) || {}, isCreator = currentRole === "creator";
  const acct = isCreator ? await mkFetchAcct().catch(()=>null) : null;
  if(!document.getElementById("meCard")) return;
  const a = acct || {}, media = (Array.isArray(a.recent_media) ? a.recent_media : []);
  const name = a.name || P.name || P.org || "Me", handle = a.username || window.__igUsername || "";
  const posts = media.filter(m=>m && (m.like_count!=null || m.comments_count!=null));
  const eng = a.followers_count && posts.length ? (posts.reduce((s,m)=>s+(m.like_count||0)+(m.comments_count||0),0)/posts.length/a.followers_count*100) : null;
  const k = n=> n==null ? "—" : n>=1e6 ? (n/1e6).toFixed(1).replace(/\.0$/,"")+"M" : n>=1e4 ? Math.round(n/1e3)+"K" : n>=1e3 ? (n/1e3).toFixed(1).replace(/\.0$/,"")+"K" : String(n);
  const initials = String(name).split(" ").filter(Boolean).map(x=>x[0]).join("").slice(0,2).toUpperCase() || "ME";
  const pic = a.profile_picture_url || _igAvatarUrl;
  const req = window.__profileReq, pct = req && req.total ? Math.round(100*req.done/req.total) : null;
  const synced = a.last_media_sync_at || a.updated_at;
  const ago = t=>{ if(!t) return ""; const m=Math.round((Date.now()-new Date(t).getTime())/60000); return m<1?"just now":m<60?m+" min ago":m<1440?Math.round(m/60)+" h ago":Math.round(m/1440)+" d ago"; };
  const type = a.account_type ? String(a.account_type).replace(/_/g," ").toLowerCase() : "";
  const go = (pg,label,ic)=>`<button class="me-link" data-mego="${pg}"><span>${ic}</span>${label}</button>`;
  const roleLabel = window.__isAdmin ? "Super Admin" : ((ROLES[currentRole] && (ROLES[currentRole].label || ROLES[currentRole].name)) || currentRole);
  c.innerHTML = `<div class="me-card-in">
    <div class="me-head">
      <div class="me-ring${handle?"":" off"}">${pic?`<img src="${esc(safeUrl(pic))}" alt="" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'me-ini',textContent:'${esc(initials)}'}))">`:`<span class="me-ini">${esc(initials)}</span>`}</div>
      <div class="me-id"><div class="me-name">${esc(name)}</div>
        ${handle?`<a class="me-handle" href="https://instagram.com/${encodeURIComponent(handle)}" target="_blank" rel="noopener">@${esc(handle)} ↗</a>`:`<div class="muted" style="font-size:12.5px">${esc(roleLabel)}${P.org&&!isCreator?" · "+esc(P.org):""}</div>`}
        ${type?`<span class="me-type">${esc(type)}</span>`:""}</div>
      <button class="me-x" id="meX" aria-label="Close">✕</button></div>
    ${isCreator && handle ? `<div class="me-accts" id="meAccts"></div>`:""}
    ${isCreator && handle ? `
      <div class="me-stats">
        <div><b>${k(a.media_count)}</b><span>Posts</span></div><div><b>${k(a.followers_count)}</b><span>Followers</span></div>
        <div><b>${k(a.follows_count)}</b><span>Following</span></div><div><b>${eng!=null?eng.toFixed(1)+"%":"—"}</b><span>Engagement</span></div></div>
      ${a.biography?`<div class="me-bio">${esc(a.biography)}</div>`:""}
      ${a.website?`<a class="me-web" href="${esc(safeUrl(a.website))}" target="_blank" rel="noopener">🔗 ${esc(String(a.website).replace(/^https?:\/\//,"").replace(/\/$/,""))}</a>`:""}
      ${media.length?`<div class="me-grid">${media.slice(0,6).map(m=>{ const src = m.thumbnail_url || m.media_url;
          return `<a href="${esc(safeUrl(m.permalink||"#"))}" target="_blank" rel="noopener" class="me-post">${src?`<img src="${esc(safeUrl(src))}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">`:""}${m.media_type==="VIDEO"?'<i>▶</i>':m.media_type==="CAROUSEL_ALBUM"?'<i>❐</i>':""}<span>❤ ${k(m.like_count||0)}</span></a>`; }).join("")}</div>`:""}
      <div class="me-sync"><span>${a.avg_reach!=null?`📈 Avg reach <b>${k(Math.round(a.avg_reach))}</b> · `:""}Synced ${ago(synced)||"—"}</span><button class="me-mini" id="meSync">↻ Refresh</button></div>`
    : isCreator ? `<div class="me-empty">📸 Connect Instagram to show your posts, followers and engagement here.<button class="btn sm" data-mego="mediakit" style="margin-top:10px">Connect Instagram</button></div>` : ""}
    ${isCreator && pct!=null ? `<button class="me-prof" data-mego="profile"><div><b>${req.complete?"✅ Profile complete":"Profile "+pct+"% complete"}</b><span>${req.complete?"You're ready for campaigns":(req.total-req.done)+" item"+(req.total-req.done===1?"":"s")+" left to unlock campaigns"}</span></div><div class="me-bar"><span style="width:${pct}%"></span></div></button>`:""}
    <div class="me-links">${isCreator
      ? go("mediakit","Media Kit","🪪")+go("profile","Creator Profile","👤")+go("instagram","Instagram","📸")+go("mycampaigns","My Campaigns","🎯")
      : go("dashboard","Dashboard","🏠")+(window.__isAdmin?go("admin","Super Admin","🛡"):"")}</div>
    <div class="me-prefs" id="mePrefs"></div>
    <button class="me-out" id="meOut">↪ Sign out</button></div>`;
  c.querySelector("#meX").onclick = closeMeCard;
  paintMePrefs(); if(isCreator && handle) paintMeAccounts();
  c.querySelectorAll("[data-mego]").forEach(b=> b.onclick = ()=>{ const pg = b.dataset.mego; closeMeCard();
    if(window.__profileGate && typeof GATE_OPEN_PAGES!=="undefined" && !GATE_OPEN_PAGES.includes(pg)){ gateToast(joinNeedsText()); currentPage = "mediakit"; } else currentPage = pg; renderShell(); });
  c.querySelector("#meOut").onclick = ()=>{ if(window.Tracker) Tracker.security("sign_out"); setTimeout(()=> window.Auth && Auth.signOut(), 150); };
  const sy = c.querySelector("#meSync");
  if(sy) sy.onclick = async ()=>{ sy.disabled = true; sy.textContent = "Syncing…";
    try{ await sb.functions.invoke("instagram-media-sync", { body:{ force:true } }); }catch(e){}
    applyIgAvatar(true); paintMeCard(); };
  anchorMeCard();
}


// Profile card → switch between connected Instagram accounts (like Instagram's own account switcher)
async function paintMeAccounts(){
  const box = document.getElementById("meAccts"); if(!box) return;
  const L = await igAccountsLoad(true); if(!box.isConnected) return;
  const others = L.filter(a=>!a.active);
  box.innerHTML = `<div class="me-accts-h"><span>Your accounts${L.length>1?` · ${L.length}`:""}</span><span style="display:flex;gap:6px"><button class="me-mini" id="meMgAcct" title="Switch or disconnect accounts">Manage</button><button class="me-mini" id="meAddAcct">+ Add account</button></span></div>`
    + (others.length ? others.map(a=>`<button class="me-acct" data-meacct="${esc(a.ig_user_id)}"${a.token_expired?' data-expired="1"':""}>
        ${a.profile_picture_url?`<img src="${esc(safeUrl(a.profile_picture_url))}" alt="" referrerpolicy="no-referrer">`:`<span class="me-acct-ph">📸</span>`}
        <span class="me-acct-n"><b>@${esc(a.username||"account")}</b><em>${a.token_expired?"Login expired — reconnect":(a.followers_count!=null?Number(a.followers_count).toLocaleString("en-IN")+" followers":"")}</em></span>
        <span class="me-acct-go">${a.token_expired?"Reconnect":"Switch"}</span></button>`).join("")
      : `<div class="me-accts-none">Run another page? Add it and switch between accounts here.</div>`);
  box.querySelector("#meAddAcct").onclick = ()=>{ closeMeCard(); igAddAnother(currentPage); };
  box.querySelector("#meMgAcct").onclick = ()=>{ closeMeCard(); currentPage = "profile"; renderShell();
    setTimeout(()=>{ const s = document.querySelector('[data-sec="pages"]'); if(s) s.scrollIntoView({ behavior:"smooth", block:"start" }); }, 900); };
  box.querySelectorAll("[data-meacct]").forEach(b=> b.onclick = async ()=>{
    if(b.dataset.expired){ closeMeCard(); igAddAnother(currentPage); return; }
    const to = L.find(x=>x.ig_user_id===b.dataset.meacct)||{};
    closeMeCard(); showBusy(`Switching to @${to.username||"account"}…`);
    try{ await igSwitchTo(b.dataset.meacct); applyIgAvatar(true); gateToast(`Switched to @${to.username||"account"} ✓`); renderShell(); }
    catch(e){ gateToast(e.message); }
    finally{ setTimeout(hideBusy, 300); }
  });
}

// Profile card → which channels send me updates. Turning one off never stops login / recovery codes.
async function paintMePrefs(){
  const box = document.getElementById("mePrefs"); if(!box || !window.sb) return;
  const { data, error } = await sb.rpc("my_notify_prefs").then(r=>r, e=>({error:e}));
  if(error || !data){ box.innerHTML = ""; return; }
  const sw = (id, on, label, sub, disabled)=>`<label class="me-pref${disabled?" off":""}"><span><b>${label}</b><em>${sub}</em></span>
      <input type="checkbox" id="${id}"${on?" checked":""}${disabled?" disabled":""}><i></i></label>`;
  box.innerHTML = `<div class="me-pref-h">🔔 Campaign updates</div>`
    + sw("mePrefWa", data.whatsapp_linked && !data.whatsapp_off, "WhatsApp", data.whatsapp_linked ? (data.whatsapp_off ? "Off — only login codes" : "On") : "Link WhatsApp to get updates", !data.whatsapp_linked)
    + sw("mePrefEm", !data.email_off, "Email", data.email_off ? "Off — only recovery codes" : "On", false);
  const wa = document.getElementById("mePrefWa"), em = document.getElementById("mePrefEm");
  if(wa) wa.onchange = async ()=>{ wa.disabled = true; const { error:e } = await sb.rpc("wa_set_opt_out", { p_opt_out: !wa.checked }); if(e) alert(e.message); paintMePrefs(); };
  if(em) em.onchange = async ()=>{ em.disabled = true; const { error:e } = await sb.rpc("set_email_updates", { p_on: em.checked }); if(e) alert(e.message); paintMePrefs(); };
}
/* ---------- Live pages: every workspace page re-reads the database on its own ----------
 * One timer at a time, paused when the tab is hidden, a modal is open or the operator is typing. */
let _liveTimer = null, _livePage = null;
function livePage(page, fn, ms){
  clearInterval(_liveTimer); _livePage = page;
  _liveTimer = setInterval(()=>{
    if(currentPage !== page){ clearInterval(_liveTimer); _liveTimer = null; return; }
    if(document.visibilityState !== "visible") return;
    if(document.querySelector(".modal-overlay.open") || document.getElementById("invPanel") || document.getElementById("ac360")) return;
    const a = document.activeElement;
    if(a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT")) return;
    try{ fn(); }catch(e){}
  }, ms || 30000);
}
/* ---------- Pages ---------- */
function pageHead(title, sub, action){
  return `<div class="page-head"><div><h1>${title}</h1><p>${sub}</p></div>${action?`<button class="btn">${action}</button>`:""}</div>`;
}

// KPI cards render with a "…" placeholder, then loadKPIs() fills real values from the DB.
function kpiRow(role){
  const keys = KPI_KEYS[role] || KPI_KEYS.owner;
  return `<div class="kpi-row">${keys.map(k=>`
    <div class="kpi"><div class="k-label">${esc((KPI_META[k]&&KPI_META[k].label)||k)}</div>
    <div class="k-val" id="kpi-${k}">…</div>
    <div class="k-trend muted" id="kpitrend-${k}"></div></div>`).join("")}</div>`;
}

function fmtNum(n){ return (Number(n)||0).toLocaleString('en-IN'); }
function fmtMoney(n){
  n = Number(n)||0;
  if(n>=1e7) return '₹'+(n/1e7).toFixed(1).replace(/\.0$/,'')+'Cr';
  if(n>=1e5) return '₹'+(n/1e5).toFixed(1).replace(/\.0$/,'')+'L';
  if(n>=1e3) return '₹'+(n/1e3).toFixed(1).replace(/\.0$/,'')+'K';
  return '₹'+n;
}

/* ---------- Communication channels (WhatsApp preferred, email fallback) ---------- */
// Normalize a phone/WhatsApp number to digits, defaulting to India (+91) when no country code.
function normalizePhone(raw){
  if(!raw) return "";
  let d = String(raw).replace(/[^\d+]/g,"");
  if(d.startsWith("+")) return d.slice(1);
  d = d.replace(/\D/g,"");
  if(d.length === 10) return "91" + d;      // bare Indian mobile
  if(d.length === 11 && d.startsWith("0")) return "91" + d.slice(1);
  return d;
}
// Click-to-chat link — opens WhatsApp (app or web) with a prefilled message. Works with zero setup.
function waLink(phone, text){
  const p = normalizePhone(phone);
  return "https://wa.me/" + p + (text ? "?text=" + encodeURIComponent(text) : "");
}
function mailtoLink(email, subject, body){
  return "mailto:" + encodeURIComponent(email||"") +
    "?subject=" + encodeURIComponent(subject||"") + "&body=" + encodeURIComponent(body||"");
}
// Reach a contact on their preferred channel; opens WhatsApp or the mail client in a new tab.
function reachOut({ whatsapp, phone, email, preferred_channel }, message, subject){
  const wa = whatsapp || phone;
  const useWa = (preferred_channel !== "email") && wa;
  if(useWa){ window.open(waLink(wa, message), "_blank", "noopener"); return "whatsapp"; }
  if(email){ window.open(mailtoLink(email, subject || "Hello from Geek Influencer OS", message), "_blank", "noopener"); return "email"; }
  return null;
}

/* ---------- Location (auto-picker + reverse geocode, best-effort) ---------- */
// Uses the browser Geolocation API (asks the user's permission), then reverse-geocodes
// via OpenStreetMap Nominatim (free, no key). Returns {lat,lng,city,address}.
function pickLocation(){
  return new Promise((resolve, reject)=>{
    if(!navigator.geolocation){ reject(new Error("Location isn't supported on this device.")); return; }
    navigator.geolocation.getCurrentPosition(async pos=>{
      const lat = +pos.coords.latitude.toFixed(6), lng = +pos.coords.longitude.toFixed(6);
      let city = "", address = "";
      try{
        const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`,
          { headers:{ "Accept":"application/json" } });
        if(r.ok){
          const j = await r.json();
          const a = j.address || {};
          city = a.city || a.town || a.village || a.suburb || a.state_district || a.state || "";
          address = j.display_name || "";
        }
      }catch(e){ /* reverse geocode is best-effort; coordinates still returned */ }
      resolve({ lat, lng, city, address });
    }, err=>{
      reject(new Error(err.code === 1 ? "Location permission denied." : "Couldn't get your location."));
    }, { enableHighAccuracy:true, timeout:10000, maximumAge:60000 });
  });
}

// Compute every KPI the current page shows, live from the org's real rows (RLS-scoped).
async function loadKPIs(){
  const cells = Array.from(document.querySelectorAll('[id^="kpi-"]'));
  if(!cells.length || !window.sb) return;
  const set = (k,v)=>{ const e=document.getElementById('kpi-'+k); if(e) e.textContent=v; };
  try{
    const [creators, campaigns, barter, apps, stories, plans] = await Promise.all([
      sb.from('creators').select('rating'),
      sb.from('campaigns').select('status,brand'),
      sb.from('barter_items').select('stage,value,reach'),
      sb.from('applications').select('status'),
      sb.from('story_deals').select('stage,value'),
      sb.from('dream_plans').select('score')
    ]);
    const C=creators.data||[], CA=campaigns.data||[], B=barter.data||[], AP=apps.data||[], ST=stories.data||[], PL=plans.data||[];
    const activeSet=['Live','Shortlist completed','In Production','Sourcing','Approval'];
    const ratings=C.map(x=>Number(x.rating)).filter(x=>!isNaN(x));
    const vals={
      creators: fmtNum(C.length),
      brands: fmtNum(new Set(CA.map(c=>(c.brand||'').trim()).filter(Boolean)).size),
      activeCampaigns: fmtNum(CA.filter(c=>activeSet.includes(c.status)).length),
      liveBarters: fmtNum(B.filter(b=>b.stage!=='Completed').length),
      completed: fmtNum(B.filter(b=>b.stage==='Completed').length),
      emv: fmtMoney(B.reduce((s,b)=>s+(Number(b.value)||0),0)+ST.reduce((s,d)=>s+(Number(d.value)||0),0)),
      reach: fmtNum(B.reduce((s,b)=>s+(Number(b.reach)||0),0)),
      approvals: fmtNum(AP.filter(a=>a.status==='Applied').length+CA.filter(c=>c.status==='Approval').length),
      activeDeals: fmtNum(ST.filter(d=>d.stage!=='Completed'&&d.stage!=='Delivered').length),
      avgRating: ratings.length?(ratings.reduce((a,b)=>a+b,0)/ratings.length).toFixed(1):'—',
      myBarters: fmtNum(B.length),
      growthScore: fmtNum(PL.length?Math.max.apply(null,PL.map(p=>Number(p.score)||0)):0),
      deadlines: fmtNum(0)
    };
    cells.forEach(e=>{ const k=e.id.slice(4); e.textContent = vals[k]!=null?vals[k]:'0'; });
  }catch(ex){
    cells.forEach(e=>{ e.textContent='—'; });
  }
}

function aiSuggestCard(role){
  return `<div class="card ai-card"><h3>✨ AI Suggestions <span class="link" id="openAiFromCard">Open agent</span></h3>
    ${AI_SUGGEST[role].map(s=>`<div class="ai-suggest"><span class="spark">✨</span>
      <div class="s-body"><b>${s.t}</b><p>${s.p}</p></div><button class="mini-btn">Do it</button></div>`).join("")}</div>`;
}

function tasksCard(role){
  const TASKS = {
    owner:[["brand","Review Q3 agency targets","Due today"],["warn","Sign Nova Audio SOW","Tomorrow"],["good","Approve payout batch","This week"]],
    corporate:[["brand","Review portfolio health","Due today"],["warn","Budget alert: Plum at 85%","Today"],["good","Consolidate brand reports","This week"]],
    manager:[["brand","Match talent to open briefs","Today"],["warn","Rohit's reel due in 2 days","Soon"],["good","Book Sanya × Sugar deal","This week"]],
    barter:[["bad","Ship 12 products","Overdue"],["warn","Chase 6 late creators","Today"],["brand","Approve 9 deliverables","Today"]],
    brand:[["brand","Approve 4 creators","Now"],["warn","Review flagged posts","Today"],["good","Sign off report","This week"]],
    creator:[["warn","Post Nova reel","6h left"],["brand","Confirm shipping address","Today"],["good","Complete daily growth task","Today"]]
  };
  const tasks = TASKS[role] || TASKS.owner;
  return `<div class="card"><h3>Today's Tasks <span class="link">View all</span></h3><div class="list">
    ${tasks.map(t=>`<div class="row"><span class="dot ${t[0]}"></span><div class="r-main"><div class="r-title">${t[1]}</div></div><span class="tag ${t[0]}">${t[2]}</span></div>`).join("")}
  </div></div>`;
}

function quickActions(role){
  const QA = {
    owner:[["📣","New Campaign"],["🏢","Add Brand"],["📊","View Reports"],["💰","Open Finance"]],
    corporate:[["🗂","View Portfolio"],["📣","New Campaign"],["👥","Pool Creators"],["📊","Portfolio Report"]],
    manager:[["🎬","Add Talent"],["📣","Match to Briefs"],["📦","New Barter Batch"],["📊","Deal Report"]],
    barter:[["📦","New Barter Batch"],["👥","Invite Creators"],["🚚","Print Labels"],["✅","Bulk Approve"]],
    brand:[["✅","Approve Creators"],["📊","Download Report"],["📣","Request Campaign"],["👥","Browse Creators"]],
    creator:[["🛒","Browse Marketplace"],["📦","My Barters"],["🚀","Growth Plan"],["📊","My Stats"]]
  };
  const qa = QA[role] || QA.owner;
  return `<div class="card"><h3>Quick Actions</h3><div class="qa">
    ${qa.map(q=>`<button><span class="qa-ic">${q[0]}</span>${q[1]}</button>`).join("")}
  </div></div>`;
}

function activityCard(role){
  const a = NOTIFS[role];
  return `<div class="card"><h3>Recent Activity</h3><div class="list">
    ${a.map(n=>`<div class="row"><span class="dot ${n.d}"></span><div class="r-main"><div class="r-title">${n.t}</div><div class="r-sub">${n.s}</div></div></div>`).join("")}
  </div></div>`;
}

function creatorGrowthCard(){
  // Filled live by renderDreamSummary() from the dashboard loader.
  return `<div class="card"><h3>Your Dream Plan 🚀</h3><div id="dreamSummary" class="muted">Loading…</div></div>`;
}

function dreamScore(tasks){ const t=Array.isArray(tasks)?tasks:[]; return t.length? Math.round(t.filter(x=>x.done).length/t.length*100) : 0; }

function renderDreamSummary(plan){
  const el = document.getElementById("dreamSummary");
  if(!el) return;
  if(!plan){
    el.innerHTML = `<p style="margin:0 0 10px">Choose a goal and we'll build your personalized roadmap.</p>
      <button class="btn" id="setDream">Pick your dream →</button>`;
    const b=document.getElementById("setDream"); if(b) b.onclick=()=>{ currentPage="growth"; renderShell(); };
    return;
  }
  const tasks = Array.isArray(plan.tasks)?plan.tasks:[];
  const score = dreamScore(tasks);
  el.innerHTML = `<div class="r-title" style="margin-bottom:4px;color:var(--ink,#1a1c2e)">${esc(plan.goal)}</div>
    <div class="muted">${score}% there — ${tasks.filter(x=>x.done).length}/${tasks.length} milestones done.</div>
    <div class="bar" style="margin-top:8px"><span style="width:${score}%"></span></div>
    <button class="btn" style="margin-top:12px" id="openDream">Open roadmap →</button>`;
  const b=document.getElementById("openDream"); if(b) b.onclick=()=>{ currentPage="growth"; renderShell(); };
}

/* ---------- Creator dashboard: one live cockpit (Instagram + profile + campaigns + alerts), refreshes every 60s ---------- */
let _cdTimer = null, _cdSig = "";
function renderCreatorDashboard(){
  const first = String((window.Auth && Auth.profile && Auth.profile.name) || window.__igUsername || "creator").split(" ")[0];
  return pageHead("Dashboard", `Hi ${esc(first)} 👋 — your live creator cockpit.`) + `<div id="cdBody">${skel("dash")}</div>`;
}
async function loadCreatorDashboard(silent){
  const box = document.getElementById("cdBody"); if(!box || !window.sb) return;
  const api = (fn,a)=> sb.schema("api").rpc(fn, a||{}).then(r=>r, ()=>({data:null}));
  const [acct, open, mine, notes] = await Promise.all([
    mkFetchAcct(),
    window.__ciOpsEnabled ? api("list_open_campaigns") : Promise.resolve({data:[]}),
    window.__ciOpsEnabled ? api("get_my_campaigns") : Promise.resolve({data:[]}),
    window.__ciOpsEnabled ? api("get_my_notifications", { p_only_unread:false }) : Promise.resolve({data:[]}),
    window.ciAvailability ? window.ciAvailability.load() : null
  ]);
  if(!box.isConnected) return;
  const a = acct || {}, media = Array.isArray(a.recent_media) ? a.recent_media : [];
  // campaigns follow the account that's open: the ones applied with it (older ones without an account count everywhere)
  const mine_h = String(a.username||"").toLowerCase();
  mine.data = (mine.data||[]).filter(c=> !c.applied_profile || !mine_h || String(c.applied_profile).toLowerCase().replace(/^@/,"") === mine_h);
  const eng = a.followers_count && media.length ? (100 * media.reduce((x,m)=> x + (Number(m.like_count)||0) + (Number(m.comments_count)||0), 0) / media.length / a.followers_count) : null;
  const O = open.data||[], M = mine.data||[], N = (notes.data||[]).slice(0,6), req = window.__profileReq;
  const PEND = ["applied","eligible","sent_to_brand","shortlisted","invited"], DONE = ["completed"], DECL = ["ineligible","brand_declined","dropped","rejected"];
  const running = M.filter(c=>!PEND.includes(c.stage) && !DONE.includes(c.stage) && !DECL.includes(c.stage));
  const kind = c => c.campaign_type || ({cash:"paid",hybrid:"barter_paid",barter:"barter"})[c.comp_type] || "";
  const sig = JSON.stringify([a.username, a.followers_count, a.media_count, a.avg_reach, media.length, O.length, M.map(c=>c.stage), N.map(n=>n.notification_id+n.read), req&&req.done, window.__availability]);
  if(silent && sig === _cdSig) return; _cdSig = sig;
  const stat = (v,l,go)=>`<div class="ws-stat"${go?` data-cdgo="${go}" style="cursor:pointer"`:""}><b>${v}</b><span>${l}</span></div>`;
  const top = media.slice().sort((x,y)=>((y.like_count||0)+(y.comments_count||0))-((x.like_count||0)+(x.comments_count||0))).slice(0,4);
  box.innerHTML = `
    <div class="cd-top">
      <div class="card cd-acct"><div id="cdAcctSwitch"></div></div>
      ${window.ciAvailability ? `<div class="card cd-avail"><div class="cd-avail-l"><b>Your availability</b><span class="muted">Brands see this before inviting you</span></div>${window.ciAvailability.picker("dash")}</div>` : ""}
    </div>
    ${joinGateCard()}
    ${!window.__profileGate && req && !req.complete ? `<div class="card cd-prof" data-cdgo="profile"><div><b>📝 Your profile is ${Math.round(100*req.done/Math.max(req.total,1))}% complete</b><div class="muted" style="font-size:13px">Optional — complete profiles get picked by brands first · next: ${esc((req.missing||[])[0]||"")}</div>
        <div class="cp-bar" style="margin-top:8px"><span style="width:${Math.round(100*req.done/Math.max(req.total,1))}%"></span></div></div><button class="btn sm">Complete profile →</button></div>`
      : !window.__profileGate ? `<div class="card" style="margin-bottom:14px;border:1px solid rgba(16,185,129,.4);background:rgba(16,185,129,.07);display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center">
        <div><b>✅ You're ready for campaigns</b><div class="muted" style="font-size:13px">${O.filter(c=>!c.my_stage).length} campaigns open for you right now</div></div><button class="btn" data-cdgo="mycampaigns">My campaigns →</button></div>` : ""}
    <div class="ci-sub">📸 Instagram ${a.username?`<span class="muted" style="font-weight:400">@${esc(a.username)} · synced ${a.updated_at?esc(fmtDateTime(a.updated_at)):"—"}</span>`:""}</div>
    <div class="ws-stats" style="grid-template-columns:repeat(auto-fill,minmax(140px,1fr))">
      ${stat(fmtNum(a.followers_count||0),"Followers","mediakit")}${stat(fmtNum(a.media_count||0),"Posts","mediakit")}
      ${stat(a.avg_reach?fmtNum(Math.round(a.avg_reach)):"—","Avg reach / post","mediakit")}${stat(eng!=null?eng.toFixed(2)+"%":"—","Engagement","mediakit")}
      ${stat((a.recent_stories||[]).length||0,"Live stories","instagram")}</div>
    <div class="ci-sub" style="margin-top:14px">📣 Campaigns</div>
    <div class="ws-stats" style="grid-template-columns:repeat(auto-fill,minmax(140px,1fr))">
      ${stat(O.length,"Open for you","opencampaigns")}${stat(O.filter(c=>["paid","barter_paid"].includes(kind(c))).length,"💰 Paid","opencampaigns")}
      ${stat(O.filter(c=>["barter","barter_paid"].includes(kind(c))).length,"🎁 Barter","opencampaigns")}
      ${stat(M.filter(c=>PEND.includes(c.stage)).length,"Applied / waiting","mycampaigns")}${stat(running.length,"Running now","mycampaigns")}
      ${stat(M.filter(c=>DONE.includes(c.stage)).length,"Completed","mycampaigns")}</div>
    <div class="grid two" style="margin-top:14px">
      <div class="card"><h3 style="margin-top:0">🔔 Latest alerts <span class="muted" style="font-size:12px;font-weight:400">· also on WhatsApp & email</span></h3>
        ${N.length ? `<div class="list">${N.map(n=>`<div class="row"><span class="dot ${n.read?"":"warn"}"></span><div class="r-main"><div class="r-title">${esc(n.title)}</div><div class="r-sub">${esc(n.body)}</div></div>${n.action_route?`<button class="mini-btn" data-cdgo="${esc(n.action_route)}">${esc(n.action_label||"Open")}</button>`:""}</div>`).join("")}</div>`
          : `<div class="muted" style="padding:6px">No alerts yet.</div>`}</div>
      <div class="card"><h3 style="margin-top:0">🟢 Running campaigns</h3>
        ${running.length ? `<div class="list">${running.slice(0,6).map(c=>`<div class="row" data-cdgo="mycampaigns" style="cursor:pointer"><div class="r-main"><div class="r-title">${esc(c.campaign||"Campaign")}</div><div class="r-sub">${esc(c.brand||"")} · ${esc(String(c.stage||"").replace(/_/g," "))}${c.deadline?` · due ${esc(fmtDate(c.deadline))}`:""}</div></div></div>`).join("")}</div>`
          : `<div class="muted" style="padding:6px">Nothing running yet — apply from Campaigns.</div>`}</div></div>
    `;   // (top posts live in the Media Kit only — it always shows the account that is open there)
  paintIgSwitcher("cdAcctSwitch", "Dashboard of");
  if(!silent) profilePopupOnce();
  box.querySelectorAll("[data-cdgo]").forEach(el=> el.onclick = ()=>{
    let go = el.dataset.cdgo; go = ({onboarding:"profile", alerts:"dashboard", growth:"mycampaigns", marketplace:"opencampaigns", barter:"opencampaigns"})[go] || go;
    if(window.__profileGate && !GATE_OPEN_PAGES.includes(go)){ gateToast(joinNeedsText()); currentPage="mediakit"; renderShell(); return; }
    currentPage = go; renderShell(); });
  if(_cdTimer) clearInterval(_cdTimer);
  _cdTimer = setInterval(()=>{
    if(currentPage!=="dashboard" || currentRole!=="creator" || !document.getElementById("cdBody")){ clearInterval(_cdTimer); _cdTimer=null; return; }
    if(document.visibilityState==="visible") loadCreatorDashboard(true);
  }, 60000);
}

function renderDashboard(){
  if(currentRole==="creator") return renderCreatorDashboard();
  const role = currentRole;
  const first = ((window.Auth && Auth.profile && Auth.profile.name) || ROLES[role].name).split(" ")[0];
  let html = pageHead("Dashboard", `Welcome back, ${esc(first)} — here's your live cockpit.`);
  if(role!=="creator") html += `<div id="dashNeeds"></div>`;
  html += `<div id="onboardCard"></div>`;
  html += kpiRow(role);
  if(role!=="creator") html += `<div id="wsLive"></div><div id="inboundAppsCard"></div>`;
  html += `<div class="grid two"><div class="grid" style="gap:16px">
      <div class="card"><h3>Today's Tasks</h3><div class="list" id="tasksList"><div class="muted" style="padding:8px">Loading…</div></div></div>
      <div class="card"><h3>Recent Activity</h3><div class="list" id="activityList"><div class="muted" style="padding:8px">Loading…</div></div></div>
    </div>
    <div class="grid" style="gap:16px">${aiSuggestCard(role)}${role==="creator"?creatorGrowthCard():quickActions(role)}</div></div>`;
  return html;
}

// ---- Dashboard: onboarding + real tasks + real activity (all from the DB) ----
function buildActivityItems(creators, campaigns, barter){
  const items = [];
  creators.forEach(c=>items.push({t:c.created_at, ic:"good", title:`New creator: ${c.name||"—"}`, sub:"Added to roster"}));
  campaigns.forEach(c=>items.push({t:c.created_at, ic:"brand", title:`Campaign: ${c.name||"—"}`, sub:[c.brand,c.status].filter(Boolean).join(" · ")}));
  barter.forEach(b=>items.push({t:b.created_at, ic:"warn", title:`Barter: ${b.product||b.creator||"batch"}`, sub:b.stage||""}));
  items.sort((a,b)=> new Date(b.t||0) - new Date(a.t||0));
  return items;
}

async function loadDashboard(){
  if(!window.sb) return;
  if(currentRole==="creator"){ loadCreatorDashboard(); try{ window.sb.functions.invoke("instagram-media-sync", { body:{ force:false } }).then(()=> loadCreatorDashboard(true)).catch(()=>{}); }catch(e){} return; }
  const role = currentRole;
  const [cr, ca, ba] = await Promise.all([
    sb.from("creators").select("name,created_at").order("created_at",{ascending:false}),
    sb.from("campaigns").select("name,brand,status,created_at").order("created_at",{ascending:false}),
    sb.from("barter_items").select("product,creator,stage,created_at").order("created_at",{ascending:false})
  ]);
  const creators=cr.data||[], campaigns=ca.data||[], barter=ba.data||[];

  if(role === "creator"){
    // Creators get a creator-shaped setup checklist (not agency actions).
    const [ig, plans, apps] = await Promise.all([
      sb.from("social_accounts").select("id").eq("platform","instagram").limit(1),
      sb.from("dream_plans").select("*").eq("creator_email",(window.Auth&&Auth.profile&&Auth.profile.email)||"").order("created_at",{ascending:false}).limit(1),
      sb.from("applications").select("id").limit(1)
    ]);
    const plan = (plans.data||[])[0] || null;
    renderOnboard(
      "🚀 Set up your creator profile",
      "Connect your Instagram and pick a goal — your OS comes alive.",
      [
        {label:"Connect your Instagram", done:(ig.data||[]).length>0, page:"mediakit"},
        {label:"Pick your Dream Plan",   done:!!plan,                 page:"growth"},
        {label:"Apply to a campaign",    done:(apps.data||[]).length>0, page:"marketplace"}
      ]
    );
    renderDreamSummary(plan);
  } else {
    renderOnboard(
      "🚀 Get your workspace set up",
      "A few quick steps and your OS goes live with your own data.",
      [
        {label:"Add your first creator",     done:creators.length>0, page:"creators"},
        {label:"Launch your first campaign", done:campaigns.length>0, page:"campaigns"},
        {label:"Start a barter batch",       done:barter.length>0,    page:"barter"}
      ]
    );
    loadInboundApplications();
    loadWorkspaceLive();
  }
  renderTasks(campaigns, barter);
  renderActivity(buildActivityItems(creators, campaigns, barter));
}


// One live strip across the top of the workspace dashboard — the same numbers the sidebar pages show.
async function loadWorkspaceLive(){
  const box = document.getElementById("wsLive"); if(!box || !window.sb) return;
  const { data, error } = await sb.schema("api").rpc("workspace_live").then(r=>r, e=>({error:e}));
  if(error || !data){ box.innerHTML = ""; return; }
  const d = data, c = d.campaigns||{}, ap = d.applications||{}, ba = d.barter||{}, co = d.content||{}, ig = d.instagram||{}, dx = d.discovery||{};
  const tile = (v,l,page)=>`<div class="ws-stat"${page?` data-wsgo="${page}" style="cursor:pointer"`:""}><b>${fmtNum(v||0)}</b><span>${l}</span></div>`;
  box.innerHTML = `<div class="ci-sub">${d.scope==="platform"?"Across every workspace":"Your workspace"} <span class="muted" style="font-weight:400;font-size:12px">· live</span></div>
    <div class="ws-stats" style="grid-template-columns:repeat(auto-fill,minmax(130px,1fr));margin-bottom:16px">
      ${tile(c.live,"Campaigns live","campaigns")}${c.awaiting?tile(c.awaiting,"Awaiting approval","approvals"):""}
      ${tile(ap.pending,"Creators to decide","approvals")}${tile(ap.invited,"Invites out","campaigns")}
      ${tile(ap.approved,"Creators on board","campaigns")}${tile(co.published,"Posts published","reports")}
      ${co.due_7d?tile(co.due_7d,"Due in 7 days","campaignops"):""}${tile(ba.delivered,"Products delivered","logistics")}
      ${tile(ig.connected,"Instagram connected","creators")}${tile(dx.pool,"New on Instagram","discover")}</div>`;
  box.querySelectorAll("[data-wsgo]").forEach(el2=> el2.onclick = ()=>{ currentPage = el2.dataset.wsgo; renderShell(); });
}
// Agency-side: show creator applications to THIS org's campaigns, right on the dashboard,
// so they're noticed without digging into Approvals. Approve/decline inline.
async function loadInboundApplications(){
  const wrap = document.getElementById("inboundAppsCard");
  if(!wrap || !window.sb) return;
  const { data, error } = await sb.rpc("campaign_applications");
  if(error){ wrap.innerHTML = ""; return; } // RPC not deployed yet — stay quiet
  const apps = (data||[]).filter(a=>a.status==="Applied");
  if(!apps.length){ wrap.innerHTML = ""; return; }
  wrap.innerHTML = `<div class="card" style="margin-bottom:16px"><h3>Creator applications <span class="tag warn">${apps.length} new</span></h3>
    <p class="muted" style="margin-bottom:10px">Creators who applied to your campaigns. Approve to bring them in, or manage all in Approvals.</p>
    <div class="list" id="inboundAppsList">${apps.slice(0,6).map(a=>`<div class="row">
      <span class="avatar">${esc((a.creator_name||"?").slice(0,2).toUpperCase())}</span>
      <div class="r-main"><div class="r-title">${esc(a.creator_name)||"Creator"}</div><div class="r-sub">→ ${esc(a.campaign_name)||"campaign"}${a.creator_org?` · ${esc(a.creator_org)}`:""}</div></div>
      <span><button class="mini-btn" data-appapprove="${esc(a.id)}">Approve</button> <button class="mini-btn ghost" data-appdecline="${esc(a.id)}">Decline</button></span></div>`).join("")}</div></div>`;
  const act = (id, status)=> updateStatus("applications", id, {status}, loadInboundApplications);
  wrap.querySelectorAll("[data-appapprove]").forEach(b=>b.onclick=()=>act(b.dataset.appapprove,"Approved"));
  wrap.querySelectorAll("[data-appdecline]").forEach(b=>b.onclick=()=>act(b.dataset.appdecline,"Declined"));
}

function renderOnboard(title, sub, steps){
  const wrap = document.getElementById("onboardCard");
  if(!wrap) return;
  const doneCount = steps.filter(s=>s.done).length;
  if(doneCount === steps.length){ wrap.innerHTML = ""; return; } // fully set up — hide
  const pct = Math.round(doneCount/steps.length*100);
  wrap.innerHTML = `<div class="card" style="margin-bottom:16px">
    <h3>${esc(title)} <span class="muted" style="font-weight:400">${doneCount}/${steps.length} done</span></h3>
    <div class="muted" style="margin:2px 0 10px">${esc(sub)}</div>
    <div class="bar"><span style="width:${pct}%"></span></div>
    <div class="list" style="margin-top:14px">
    ${steps.map(s=>`<div class="row onboard-step" data-page="${esc(s.page)}" style="cursor:${s.done?"default":"pointer"}">
      <span class="dot ${s.done?"good":"warn"}"></span>
      <div class="r-main"><div class="r-title" style="${s.done?"text-decoration:line-through;opacity:.55":""}">${esc(s.label)}</div></div>
      ${s.done?'<span class="tag good">✓ Done</span>':'<span class="tag brand">Start →</span>'}</div>`).join("")}
    </div></div>`;
  wrap.querySelectorAll(".onboard-step").forEach(row=>{
    if(row.querySelector(".tag.good")) return; // already done
    row.onclick = ()=>{
      const p = row.dataset.page;
      currentPage = p; renderShell();
      setTimeout(()=>{
        const id = p==="creators"?"addCreatorBtn":p==="campaigns"?"addCampaignBtn":p==="barter"?"addBarterBtn":null;
        const b = id && document.getElementById(id);
        if(b) b.click();
      }, 120);
    };
  });
}

function renderTasks(campaigns, barter){
  const wrap = document.getElementById("tasksList");
  if(!wrap) return;
  const tasks = [];
  campaigns.forEach(c=>{
    if(c.status==="Approval") tasks.push(["warn",`Approve campaign: ${c.name}`,"Now"]);
    else if(c.status==="Sourcing") tasks.push(["brand",`Source creators: ${c.name}`,"Today"]);
  });
  barter.forEach(b=>{
    if(b.stage==="Requested") tasks.push(["warn",`Ship product: ${b.product||b.creator||"batch"}`,"Today"]);
    else if(b.stage==="Shipped") tasks.push(["brand",`Awaiting content: ${b.product||"batch"}`,"Soon"]);
  });
  window.__geekTasks = tasks.length;
  const badge = document.getElementById("notifCount");
  if(badge) badge.textContent = tasks.length;
  if(!tasks.length){ wrap.innerHTML = `<div class="muted" style="padding:8px">You're all caught up 🎉</div>`; return; }
  wrap.innerHTML = tasks.slice(0,6).map(t=>`<div class="row"><span class="dot ${t[0]}"></span><div class="r-main"><div class="r-title">${esc(t[1])}</div></div><span class="tag ${t[0]}">${t[2]}</span></div>`).join("");
}

function renderActivity(items){
  const wrap = document.getElementById("activityList");
  if(!wrap) return;
  if(!items.length){ wrap.innerHTML = `<div class="muted" style="padding:8px">No activity yet — add your first creator to get going.</div>`; return; }
  wrap.innerHTML = items.slice(0,6).map(x=>`<div class="row"><span class="dot ${x.ic}"></span><div class="r-main"><div class="r-title">${esc(x.title)}</div><div class="r-sub">${esc(x.sub)}</div></div></div>`).join("");
}

const BARTER_STAGES = ["Requested","Shipped","Content Live","Completed"];

function renderBarter(){
  let html = pageHead("Mass Barter Engine","Live pipeline — product to content to ROI.",`<span id="addBarterBtn">+ New Barter Batch</span>`);
  html += kpiRow(currentRole);
  html += aiSuggestCard(currentRole in AI_SUGGEST ? currentRole : "owner");
  html += campaignSectionHtml("barter");
  html += `<div class="card" style="margin-top:16px"><h3>Barter shipments pipeline</h3>
    <div class="kanban" id="barterKanban"><div class="muted" style="padding:12px">Loading pipeline…</div></div></div>`;
  return html;
}

function barterCardHtml(c){
  const stage = BARTER_STAGES.includes(c.stage) ? c.stage : "Requested";
  const idx = BARTER_STAGES.indexOf(stage);
  const next = idx < BARTER_STAGES.length-1 ? BARTER_STAGES[idx+1] : null;
  const sub = [c.creator, c.quantity?("×"+c.quantity):null, c.value?("₹"+fmtNum(c.value)):null].filter(Boolean).join(" · ");
  const overdue = c.deadline && (c.stage!=="Content Live" && c.stage!=="Completed") && new Date(c.deadline) < new Date();
  return `<div class="kan-card"><div class="kc-name">${esc(c.product||c.creator||"Barter item")}</div>
    <div class="kc-sub">${esc(sub)||"—"}</div>
    ${c.deliverables?`<div class="kc-sub">📦 ${esc(c.deliverables)}</div>`:""}
    ${c.deadline?`<div class="kc-sub"${overdue?' style="color:var(--bad,#c0392b);font-weight:700"':''}>⏰ ${esc(c.deadline)}${overdue?" · overdue":""}</div>`:""}
    ${c.tracking_number?`<div class="kc-sub">🚚 ${esc(c.carrier||"Shipment")}: ${esc(c.tracking_number)}</div>`:""}
    ${c.product_link?`<a class="kc-sub" href="${esc(safeUrl(c.product_link))}" target="_blank" rel="noopener">Product ↗</a>`:""}
    <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
      ${next?`<button class="mini-btn" data-advance="${esc(c.id)}" data-next="${esc(next)}">→ ${esc(next)}</button>`:""}
      ${c.creator?`<button class="mini-btn ghost" data-remind="${esc(c.id)}">💬 Remind</button>`:""}
      <button class="mini-btn ghost" data-editbarter="${esc(c.id)}">Edit</button></div></div>`;
}

async function loadBarter(){
  const wrap = document.getElementById("barterKanban");
  if(!wrap) return;
  if(!window.sb){ wrap.innerHTML = `<div class="muted" style="padding:12px">Connect the database to see your pipeline.</div>`; return; }
  const { data, error } = await sb.from("barter_items").select("*").order("created_at",{ascending:false});
  if(error){ wrap.innerHTML = `<div class="muted" style="padding:12px">Couldn't load: ${esc(error.message)}</div>`; return; }
  const items = data||[];
  const byStage = {}; BARTER_STAGES.forEach(s=>byStage[s]=[]);
  items.forEach(it=>{ const s = BARTER_STAGES.includes(it.stage)?it.stage:"Requested"; byStage[s].push(it); });
  wrap.innerHTML = BARTER_STAGES.map(s=>`<div class="kan-col"><h4>${s}<span>${byStage[s].length}</span></h4>
    ${byStage[s].map(barterCardHtml).join("") || `<div class="muted" style="font-size:12px;padding:6px 2px">—</div>`}</div>`).join("");
  wrap.querySelectorAll("button[data-advance]").forEach(b=> b.onclick = ()=> advanceBarter(b.dataset.advance, b.dataset.next));
  wrap.querySelectorAll("[data-editbarter]").forEach(b=> b.onclick = ()=>{ const it=items.find(x=>x.id===b.dataset.editbarter); if(it) openBarterModal(it); });
  wrap.querySelectorAll("[data-remind]").forEach(b=> b.onclick = ()=>{ const it=items.find(x=>x.id===b.dataset.remind); if(it) remindBarter(it); });
}

// Send a content reminder to the barter creator over WhatsApp (looks up their contact by name).
async function remindBarter(item){
  if(!window.sb) return;
  let contact = null;
  const { data } = await sb.from("creators").select("name,whatsapp,phone,email,preferred_channel").ilike("name", (item.creator||"").trim()).limit(1);
  contact = (data||[])[0] || null;
  if(!contact || !(contact.whatsapp || contact.phone || contact.email)){
    alert(`No contact on file for “${item.creator||"this creator"}”. Add them (with WhatsApp/email) in Creators, then try again.`);
    return;
  }
  const parts = [`Hi ${item.creator||"there"}! Quick reminder about your barter: ${item.product||"the product"}.`];
  if(item.deliverables) parts.push(`Deliverables: ${item.deliverables}.`);
  if(item.deadline) parts.push(`Please post by ${item.deadline}.`);
  parts.push("Thanks! 🙌");
  const via = reachOut(contact, parts.join(" "), "Content reminder");
  if(via){ await checkedWrite(sb.from("barter_items").update({ reminded_at:new Date().toISOString() }).eq("id", item.id), "save the reminder"); }
}

async function advanceBarter(id, nextStage){
  if(!window.sb) return;
  if(await checkedWrite(sb.from("barter_items").update({stage:nextStage}).eq("id", id), "move this barter")) loadBarter();
}

function openBarterModal(existing){
  const ed = existing || {};
  const opt = (arr,val)=>arr.map(o=>`<option${o===val?' selected':''}>${o}</option>`).join("");
  let m = document.getElementById("barterModal"); if(m) m.remove();
  m = el("div","modal-overlay"); m.id="barterModal";
  m.innerHTML = `<div class="modal modal-lg"><div class="modal-head"><strong>${existing?'Edit Barter Item':'New Barter Item'}</strong><button class="icon-btn" id="bmClose">✕</button></div>
    <form id="barterForm" class="modal-form">
      <div class="mf-row"><label>Product<input name="product" required value="${esc(ed.product||'')}" placeholder="Nykaa Lip Kit"></label>
      <label>Product link<input name="product_link" value="${esc(ed.product_link||'')}" placeholder="https://nykaa.com/…"></label></div>
      <div class="mf-row"><label>Creator<input name="creator" value="${esc(ed.creator||'')}" placeholder="Aarav Mehta"></label>
      <label>Campaign<input name="campaign" value="${esc(ed.campaign||'')}" placeholder="Summer Glow"></label></div>
      <div class="mf-row"><label>Product value (₹)<input name="value" type="number" min="0" value="${ed.value!=null?esc(ed.value):''}" placeholder="5000"></label>
      <label>Quantity<input name="quantity" type="number" min="1" value="${ed.quantity!=null?esc(ed.quantity):''}" placeholder="1"></label></div>
      <label>Deliverables<textarea name="deliverables" rows="2" placeholder="e.g. 1 Reel + 2 Stories tagging @brand, post within 7 days">${esc(ed.deliverables||'')}</textarea></label>
      <div class="mf-row"><label>Stage<select name="stage">${opt(BARTER_STAGES, ed.stage)}</select></label>
      <label>Content deadline<input name="deadline" type="date" value="${esc(ed.deadline||'')}"></label></div>
      <div class="mf-row"><label>Est. reach<input name="reach" type="number" min="0" value="${ed.reach!=null?esc(ed.reach):''}" placeholder="120000"></label>
      <label>Shipping address<input name="address" value="${esc(ed.address||'')}" placeholder="Creator's address"></label></div>
      <div class="mf-sec">Shipping / tracking</div>
      <div class="mf-row"><label>Carrier<input name="carrier" value="${esc(ed.carrier||'')}" placeholder="Delhivery / BlueDart"></label>
      <label>Tracking number<input name="tracking_number" value="${esc(ed.tracking_number||'')}" placeholder="AWB123456"></label></div>
      <label style="max-width:50%">Shipped on<input name="shipped_at" type="date" value="${esc(ed.shipped_at||'')}"></label>
      <div class="auth-err" id="bmErr"></div>
      <button class="btn" type="submit">${existing?'Save changes':'Add to Pipeline'}</button></form></div>`;
  document.body.appendChild(m); m.classList.add("open");
  m.onclick = e=>{ if(e.target.id==="barterModal") m.classList.remove("open"); };
  document.getElementById("bmClose").onclick = ()=> m.classList.remove("open");
  document.getElementById("barterForm").onsubmit = async e=>{
    e.preventDefault();
    const f = new FormData(e.target), err = document.getElementById("bmErr");
    const btn = e.target.querySelector("button[type=submit]"); err.textContent=""; btn.disabled=true; btn.textContent="Saving…";
    const row = { product:f.get("product"), product_link:f.get("product_link"), creator:f.get("creator"), campaign:f.get("campaign"),
      value:parseFloat(f.get("value"))||null, quantity:parseInt(f.get("quantity"))||null, deliverables:f.get("deliverables"),
      stage:f.get("stage")||"Requested", deadline:f.get("deadline")||null, reach:parseFloat(f.get("reach"))||null, address:f.get("address"),
      carrier:f.get("carrier"), tracking_number:f.get("tracking_number"), shipped_at:f.get("shipped_at")||null };
    try{
      if(!window.sb) throw new Error("Database not connected.");
      let error;
      if(existing){ ({error}=await sb.from("barter_items").update(row).eq("id", existing.id)); }
      else { if(window.Auth&&Auth.profile){ row.org_name=Auth.profile.org; row.org_id=Auth.profile.org_id; } ({error}=await sb.from("barter_items").insert(row)); }
      if(error) throw error;
      m.classList.remove("open"); await loadBarter();
    }catch(ex){ err.textContent=ex.message||"Couldn't save."; btn.disabled=false; btn.textContent=existing?'Save changes':'Add to Pipeline'; }
  };
}

function renderCreators(){
  let html = `<div class="page-head"><div><h1>Creators</h1><p>Discovery & roster — AI-matched to your campaigns.</p></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn ghost" id="importCreatorBtn">⬆ Import CSV</button>
      <button class="btn ghost" id="bulkInviteBtn" disabled>✉ Invite all</button>
      <button class="btn" id="addCreatorBtn">+ Add Creator</button></div></div>`;
  html += `<input type="file" id="creatorCsvInput" accept=".csv,text/csv" hidden>`;
  html += `<div id="csvImportNote" class="muted" style="margin:0 0 10px;font-size:12px">
    CSV columns: <code>name, handle, whatsapp, email, city, address, tier, followers, engagement, category, rating</code> — only <b>name</b> is required.
    Add <b>whatsapp</b> (or email) so you can send app sign-in invites. <a href="#" id="csvSample">Download sample</a></div>`;
  // Discovery filter/search/match bar.
  html += `<div class="card filter-bar" style="margin-bottom:14px">
    <input id="crSearch" class="fb-input" placeholder="🔍 Search name, handle, city, category…">
    <select id="crTier" class="fb-input"><option value="">All tiers</option><option>Nano</option><option>Micro</option><option>Mid</option><option>Macro</option><option>Celebrity</option></select>
    <select id="crCat" class="fb-input"><option value="">All categories</option></select>
    <select id="crMinF" class="fb-input"><option value="0">Any followers</option><option value="10000">10K+</option><option value="50000">50K+</option><option value="100000">100K+</option><option value="500000">500K+</option><option value="1000000">1M+</option></select>
    <select id="crMatch" class="fb-input"><option value="">🎯 Match to campaign…</option></select>
    <select id="crSort" class="fb-input"><option value="recent">Newest</option><option value="followers">Most followers</option><option value="rating">Top rated</option><option value="match">Best match</option></select>
    <span id="crCount" class="muted" style="align-self:center;font-size:12px"></span>
  </div>`;
  html += `<div class="card"><table><thead><tr><th>Creator</th><th>City</th><th>Tier</th><th>Followers</th><th id="crMatchCol" style="display:none">Match</th><th>Contact</th><th>App</th><th>Actions</th></tr></thead>
    <tbody id="creatorRows"><tr><td colspan="8" class="muted" style="padding:24px">Loading creators…</td></tr></tbody></table></div>`;
  return html;
}

// Parse a follower string like "128K", "1.2M", "84,000" to a number for filtering/sorting/matching.
function parseFollowers(v){
  if(v==null) return 0;
  if(typeof v === "number") return v;
  let s = String(v).trim().toLowerCase().replace(/,/g,"");
  const mult = s.endsWith("m") ? 1e6 : s.endsWith("k") ? 1e3 : 1;
  const n = parseFloat(s.replace(/[km]$/,"")) || 0;
  return Math.round(n * mult);
}
function parseEng(v){ return parseFloat(String(v||"").replace(/[^\d.]/g,"")) || 0; }

const INVITE_BADGE = { none:"", invited:`<span class="tag warn">Invited</span>`, joined:`<span class="tag good">Joined</span>` };

// Minimal RFC-4180-ish CSV parser (handles quoted fields, embedded commas & newlines).
function parseCsv(text){
  const rows = []; let row = [], field = "", i = 0, inQ = false;
  text = text.replace(/^﻿/, ""); // strip BOM
  while(i < text.length){
    const c = text[i];
    if(inQ){
      if(c === '"'){ if(text[i+1] === '"'){ field += '"'; i += 2; continue; } inQ = false; i++; continue; }
      field += c; i++; continue;
    }
    if(c === '"'){ inQ = true; i++; continue; }
    if(c === ','){ row.push(field); field = ""; i++; continue; }
    if(c === '\r'){ i++; continue; }
    if(c === '\n'){ row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    field += c; i++;
  }
  if(field.length || row.length){ row.push(field); rows.push(row); }
  return rows.filter(r => r.some(x => (x||"").trim() !== ""));
}

// Map flexible CSV header names to our creator columns.
const CSV_ALIASES = {
  name:["name","full name","creator","creator name"], handle:["handle","username","instagram","ig","insta"],
  email:["email","e-mail","mail"], whatsapp:["whatsapp","wa","whatsapp number","mobile","phone","contact","number"],
  city:["city","location"], address:["address","shipping address","full address"], tier:["tier"],
  followers:["followers","follower count","reach"], eng:["engagement","eng","engagement rate","er"],
  cat:["category","cat","niche","vertical"], rating:["rating","stars","score"]
};
function csvHeaderMap(headers){
  const norm = headers.map(h => (h||"").trim().toLowerCase());
  const map = {};
  for(const [key, aliases] of Object.entries(CSV_ALIASES)){
    const idx = norm.findIndex(h => aliases.includes(h));
    if(idx !== -1) map[key] = idx;
  }
  return map;
}

async function importCreatorsCsv(file){
  const note = document.getElementById("csvImportNote");
  const say = (msg, err)=>{ if(note){ note.innerHTML = `<span style="color:${err?'var(--danger,#c0392b)':'var(--accent,#2d7)'}">${esc(msg)}</span>`; } };
  try{
    if(!window.sb) throw new Error("Database not connected.");
    const org_id = (window.Auth && Auth.profile && Auth.profile.org_id) || null;
    const org_name = (window.Auth && Auth.profile && Auth.profile.org) || null;
    const text = await file.text();
    const rows = parseCsv(text);
    if(rows.length < 2) throw new Error("CSV looks empty — need a header row plus at least one creator.");
    const map = csvHeaderMap(rows[0]);
    if(map.name === undefined) throw new Error("Couldn't find a 'name' column in the CSV header.");
    const get = (r, k)=> map[k] !== undefined ? (r[map[k]]||"").trim() : "";
    const records = [];
    for(let r = 1; r < rows.length; r++){
      const name = get(rows[r], "name");
      if(!name) continue;
      const rec = { name, handle:get(rows[r],"handle"), email:(get(rows[r],"email")||"").toLowerCase(),
        whatsapp:get(rows[r],"whatsapp"), address:get(rows[r],"address"),
        city:get(rows[r],"city"), tier:get(rows[r],"tier")||"Micro", followers:get(rows[r],"followers"),
        eng:get(rows[r],"eng"), cat:get(rows[r],"cat"), rating:parseFloat(get(rows[r],"rating"))||null };
      if(org_id){ rec.org_id = org_id; rec.org_name = org_name; }
      records.push(rec);
    }
    if(!records.length) throw new Error("No rows with a name found.");
    say(`Importing ${records.length} creator${records.length>1?'s':''}…`);
    // Insert in chunks so a big roster doesn't hit payload limits.
    let inserted = 0;
    for(let i = 0; i < records.length; i += 200){
      const chunk = records.slice(i, i+200);
      const { error } = await window.sb.from("creators").insert(chunk);
      if(error) throw error;
      inserted += chunk.length;
    }
    const reachable = records.filter(r => r.whatsapp || r.email).length;
    say(`✓ Imported ${inserted} creators${reachable?` — ${reachable} reachable. Use “Invite all” to send sign-in requests over WhatsApp/email.`:""}.`);
    await loadCreators();
  }catch(ex){
    say(ex.message || "Import failed.", true);
  }
}

function csvSampleDownload(){
  const sample = "name,handle,whatsapp,email,city,address,tier,followers,engagement,category,rating\n" +
    "Aarav Mehta,@aaravmehta,+919812345678,aarav@example.com,Mumbai,,Macro,842K,4.2%,Fashion,4.8\n" +
    "Ishita Rao,@ishitarao,+919876543210,ishita@example.com,Bengaluru,,Micro,128K,6.1%,Beauty,4.9\n";
  const blob = new Blob([sample], {type:"text/csv"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = "creators-sample.csv";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 1000);
}

function creatorRowsHtml(list, showMatch){
  if(!list.length) return `<tr><td colspan="8" class="muted" style="padding:24px">No creators match — adjust your filters, or add creators 👆</td></tr>`;
  return list.map(c=>{
    const chan = c.whatsapp ? `<span title="WhatsApp">🟢 ${esc(c.whatsapp)}</span>` : (c.email ? `<span title="Email">✉ ${esc(c.email)}</span>` : `<span class="muted">—</span>`);
    const canInvite = !!(c.id && (c.whatsapp || c.email) && (c.invite_status||"none")!=="joined");
    const matchCell = showMatch ? `<td>${matchBadge(c._match)}</td>` : "";
    return `<tr><td><span class="avatar">${esc((c.name||"?").split(" ").map(x=>x[0]).join("").slice(0,2))}</span>${esc(c.name)}${c.handle?`<div class="r-sub" style="margin-left:34px">${esc(c.handle)}</div>`:""}</td>
      <td>${esc(c.city)||"—"}</td><td><span class="tag brand">${esc(c.tier)||"—"}</span></td><td>${esc(c.followers)||"—"}</td>
      ${matchCell}
      <td>${chan}</td>
      <td>${INVITE_BADGE[c.invite_status||"none"]||""}</td>
      <td><div style="display:flex;gap:6px;flex-wrap:wrap">
        ${canInvite?`<button class="mini-btn" data-invitecreator="${esc(c.id)}">${(c.invite_status==="invited")?"Re-invite":"Invite to app"}</button>`:""}
        <button class="mini-btn ghost" data-editcreator="${esc(c.id)}">Edit</button></div></td></tr>`;
  }).join("");
}
function matchBadge(score){
  if(score==null) return "—";
  const cls = score>=70 ? "good" : score>=40 ? "warn" : "";
  return `<span class="tag ${cls}">${score}%</span>`;
}

// Heuristic "AI match": score a creator (0–100) against a campaign by category/niche overlap,
// tier fit, engagement and reach. Deterministic + instant (no API round-trip).
function matchScore(creator, camp){
  if(!camp) return null;
  const hay = [camp.name, camp.brand, camp.objective, camp.platforms, camp.hashtags, camp.brief, camp.deliverables, camp.type]
    .filter(Boolean).join(" ").toLowerCase();
  let score = 0;
  const cat = (creator.cat||"").toLowerCase().trim();
  if(cat && hay.includes(cat)) score += 45;                 // niche match — biggest signal
  else if(cat){ // partial word overlap
    const words = cat.split(/[\s/&,]+/).filter(w=>w.length>2);
    if(words.some(w=>hay.includes(w))) score += 22;
  }
  const eng = parseEng(creator.eng); if(eng>=6) score += 20; else if(eng>=3) score += 12; else if(eng>0) score += 5;
  const f = parseFollowers(creator.followers);
  const budget = Number(camp.budget)||0;
  // Bigger budgets favour bigger creators; small/barter favour micro (better ROI).
  if(budget>=100000){ if(f>=100000) score += 18; else if(f>=25000) score += 8; }
  else { if(f>=10000 && f<200000) score += 18; else if(f>0) score += 8; }
  const rating = Number(creator.rating)||0; if(rating>=4.5) score += 12; else if(rating>=4) score += 7;
  const city = (creator.city||"").toLowerCase(); if(city && hay.includes(city)) score += 5;
  return Math.max(0, Math.min(100, Math.round(score)));
}

let _creatorList = [];       // full roster for the current page
let _matchCampaigns = [];    // this org's campaigns, for the match dropdown

async function loadCreators(){
  const tbody = document.getElementById("creatorRows");
  if(!tbody) return;
  if(!window.sb){ _creatorList = CREATORS.slice(); applyCreatorFilters(); return; }
  const org_id = (window.Auth && Auth.profile && Auth.profile.org_id) || null;
  let q = window.sb.from("creators").select("*").order("created_at",{ascending:false});
  if(org_id && !window.__isAdmin) q = q.eq("org_id", org_id);
  const [{ data, error }, camps] = await Promise.all([
    q,
    window.sb.from("campaigns").select("id,name,brand,type,objective,platforms,hashtags,brief,deliverables,budget").order("created_at",{ascending:false})
  ]);
  if(error){ tbody.innerHTML = `<tr><td colspan="8" class="muted" style="padding:24px">Couldn't load creators: ${esc(error.message)}</td></tr>`; return; }
  _creatorList = data||[];
  _matchCampaigns = (camps && camps.data) || [];
  // Populate the category + match-campaign dropdowns from real data.
  const catSel = document.getElementById("crCat");
  if(catSel){
    const cats = [...new Set(_creatorList.map(c=>(c.cat||"").trim()).filter(Boolean))].sort();
    catSel.innerHTML = `<option value="">All categories</option>` + cats.map(c=>`<option>${esc(c)}</option>`).join("");
  }
  const matchSel = document.getElementById("crMatch");
  if(matchSel){
    matchSel.innerHTML = `<option value="">🎯 Match to campaign…</option>` + _matchCampaigns.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("");
  }
  // Wire filter controls once.
  ["crSearch","crTier","crCat","crMinF","crMatch","crSort"].forEach(id=>{
    const el = document.getElementById(id);
    if(el && !el._wired){ el._wired = true; el.addEventListener("input", applyCreatorFilters); }
  });
  applyCreatorFilters();
}

function applyCreatorFilters(){
  const tbody = document.getElementById("creatorRows");
  if(!tbody) return;
  const val = id => (document.getElementById(id)||{}).value || "";
  const term = val("crSearch").toLowerCase().trim();
  const tier = val("crTier"), cat = val("crCat"), minF = parseInt(val("crMinF"))||0;
  const matchId = val("crMatch"); let sort = val("crSort");
  const camp = matchId ? _matchCampaigns.find(c=>c.id===matchId) : null;
  if(camp && sort==="recent") sort = "match"; // auto-switch to match ranking when a campaign is picked

  let list = _creatorList.map(c=> camp ? Object.assign({}, c, {_match: matchScore(c, camp)}) : c);
  list = list.filter(c=>{
    if(tier && (c.tier||"")!==tier) return false;
    if(cat && (c.cat||"")!==cat) return false;
    if(minF && parseFollowers(c.followers) < minF) return false;
    if(term){
      const hay = [c.name,c.handle,c.city,c.cat,c.tier].filter(Boolean).join(" ").toLowerCase();
      if(!hay.includes(term)) return false;
    }
    return true;
  });
  if(sort==="followers") list.sort((a,b)=>parseFollowers(b.followers)-parseFollowers(a.followers));
  else if(sort==="rating") list.sort((a,b)=>(Number(b.rating)||0)-(Number(a.rating)||0));
  else if(sort==="match") list.sort((a,b)=>(b._match||0)-(a._match||0));

  const showMatch = !!camp;
  const col = document.getElementById("crMatchCol"); if(col) col.style.display = showMatch ? "" : "none";
  tbody.innerHTML = creatorRowsHtml(list, showMatch);
  const byId = id => _creatorList.find(x=>x.id===id);
  tbody.querySelectorAll("[data-editcreator]").forEach(b=> b.onclick = ()=>{ const c=byId(b.dataset.editcreator); if(c) openCreatorModal(c); });
  tbody.querySelectorAll("[data-invitecreator]").forEach(b=> b.onclick = ()=>{ const c=byId(b.dataset.invitecreator); if(c) inviteCreator(c, b); });
  const count = document.getElementById("crCount");
  if(count) count.textContent = `${list.length} of ${_creatorList.length}${camp?` · matched to “${camp.name}”`:""}`;
  const bulk = document.getElementById("bulkInviteBtn");
  if(bulk){
    const pending = _creatorList.filter(c => (c.whatsapp||c.email) && (c.invite_status||"none")!=="joined");
    bulk.textContent = `✉ Invite all (${pending.length})`;
    bulk.disabled = !pending.length;
    bulk.onclick = ()=> bulkInviteCreators(pending);
  }
}

// Compose the invite: create an invites row (role=creator) tied to this org, then open the
// creator's preferred channel (WhatsApp/email) with a prefilled sign-in message + link.
async function inviteCreator(c, btn){
  const note = document.getElementById("csvImportNote");
  const say = (msg, err)=>{ if(note){ note.innerHTML = `<span style="color:${err?'var(--danger,#c0392b)':'var(--accent,#2d7)'}">${esc(msg)}</span>`; } };
  try{
    if(!window.sb) throw new Error("Database not connected.");
    if(btn){ btn.disabled = true; btn.textContent = "…"; }
    const org_id = (window.Auth && Auth.profile && Auth.profile.org_id) || null;
    const org_name = (window.Auth && Auth.profile && Auth.profile.org) || "our roster";
    // Reuse an existing pending invite for this email if present, else create one (gets a token).
    let token, email = (c.email||"").toLowerCase();
    if(email){
      const { data: existing } = await sb.from("invites").select("token").eq("email", email).eq("status","pending").limit(1);
      token = existing && existing[0] && existing[0].token;
    }
    if(!token){
      const row = { email: email || null, name: c.name, whatsapp: c.whatsapp||null, role:"creator", status:"pending",
        channel: (c.preferred_channel!=="email" && (c.whatsapp)) ? "whatsapp" : "email", creator_id: c.id };
      if(org_id){ row.org_id = org_id; row.org_name = org_name; }
      const { data, error } = await sb.from("invites").insert(row).select("token").single();
      if(error) throw error;
      token = data.token;
    }
    const base = location.origin + location.pathname.replace(/[^/]*$/,"") + "app.html";
    const link = base + "?invite=" + token;
    const msg = `Hi ${c.name||"there"}! ${org_name} is inviting you to join us on Geek Influencer OS — you'll get your own auto-built media kit and barter/campaign invites. Sign in here: ${link}`;
    const via = reachOut(c, msg, `You're invited to join ${org_name}`);
    // Track that we invited them.
    await sb.from("creators").update({ invite_status:"invited", invited_at:new Date().toISOString() }).eq("id", c.id);
    if(!via){
      // No channel opened — hand over a copyable link.
      try{ await navigator.clipboard.writeText(link); say("No WhatsApp/email on file — invite link copied to clipboard."); }
      catch(e){ prompt("Share this invite link:", link); }
    }else{
      say(`✓ Invite opened in ${via==="whatsapp"?"WhatsApp":"your email"} for ${c.name}.`);
    }
    await loadCreators();
  }catch(ex){
    say(ex.message || "Couldn't create invite.", true);
    if(btn){ btn.disabled = false; btn.textContent = "Invite to app"; }
  }
}

// Bulk: create invites for everyone reachable, then hand over WhatsApp/mail links to send.
async function bulkInviteCreators(list){
  const note = document.getElementById("csvImportNote");
  const say = (msg, err)=>{ if(note){ note.innerHTML = `<span style="color:${err?'var(--danger,#c0392b)':'var(--accent,#2d7)'}">${esc(msg)}</span>`; } };
  if(!list.length){ say("Everyone reachable has already been invited."); return; }
  if(!confirm(`Create sign-in invites for ${list.length} creator${list.length>1?'s':''}? You'll get a list of WhatsApp/email links to send.`)) return;
  try{
    if(!window.sb) throw new Error("Database not connected.");
    const org_id = (window.Auth && Auth.profile && Auth.profile.org_id) || null;
    const org_name = (window.Auth && Auth.profile && Auth.profile.org) || "our roster";
    const base = location.origin + location.pathname.replace(/[^/]*$/,"") + "app.html";
    const links = [];
    for(const c of list){
      let token, email = (c.email||"").toLowerCase();
      if(email){
        const { data: ex } = await sb.from("invites").select("token").eq("email", email).eq("status","pending").limit(1);
        token = ex && ex[0] && ex[0].token;
      }
      if(!token){
        const row = { email: email||null, name:c.name, whatsapp:c.whatsapp||null, role:"creator", status:"pending",
          channel:(c.preferred_channel!=="email" && c.whatsapp)?"whatsapp":"email", creator_id:c.id };
        if(org_id){ row.org_id = org_id; row.org_name = org_name; }
        const { data, error } = await sb.from("invites").insert(row).select("token").single();
        if(error) continue;
        token = data.token;
      }
      const link = base + "?invite=" + token;
      const msg = `Hi ${c.name||"there"}! ${org_name} is inviting you to Geek Influencer OS. Sign in: ${link}`;
      const wa = c.whatsapp || c.phone;
      links.push({ name:c.name, href: (c.preferred_channel!=="email" && wa) ? waLink(wa, msg) : mailtoLink(email, `Join ${org_name}`, msg), chan: (c.preferred_channel!=="email" && wa)?"WhatsApp":"Email" });
      await sb.from("creators").update({ invite_status:"invited", invited_at:new Date().toISOString() }).eq("id", c.id);
    }
    showBulkInviteLinks(links);
    await loadCreators();
  }catch(ex){ say(ex.message||"Bulk invite failed.", true); }
}

// Present the generated invite links so the agency can fire them off one tap each.
function showBulkInviteLinks(links){
  let m = document.getElementById("bulkInvModal"); if(m) m.remove();
  m = el("div","modal-overlay"); m.id="bulkInvModal";
  const rows = links.map(l=>`<div class="row"><div class="r-main"><div class="r-title">${esc(l.name||"Creator")}</div><div class="r-sub">${esc(l.chan)}</div></div>
    <a class="mini-btn" href="${esc(l.href)}" target="_blank" rel="noopener">Send ↗</a></div>`).join("");
  m.innerHTML = `<div class="modal modal-lg"><div class="modal-head"><strong>${links.length} invite${links.length>1?'s':''} ready</strong><button class="icon-btn" id="biClose">✕</button></div>
    <div class="modal-form"><p class="muted">Tap “Send” on each to open a prefilled WhatsApp / email with their personal sign-in link. (Automatic bulk sending activates once the WhatsApp Business API is connected.)</p>
    <div class="list" style="max-height:52vh;overflow:auto">${rows||'<div class="muted" style="padding:8px">Nothing to send.</div>'}</div></div></div>`;
  document.body.appendChild(m); m.classList.add("open");
  m.onclick = e=>{ if(e.target.id==="bulkInvModal") m.classList.remove("open"); };
  document.getElementById("biClose").onclick = ()=> m.classList.remove("open");
}

function openCreatorModal(existing){
  const ed = existing || {};
  const opt = (arr,val)=>arr.map(o=>`<option${o===val?' selected':''}>${o}</option>`).join("");
  let m = document.getElementById("creatorModal"); if(m) m.remove();
  m = el("div","modal-overlay"); m.id="creatorModal";
  m.innerHTML = `<div class="modal modal-lg">
    <div class="modal-head"><strong>${existing?'Edit Creator':'Add Creator'}</strong><button class="icon-btn" id="ccClose">✕</button></div>
    <form id="creatorForm" class="modal-form">
      <div class="mf-row"><label>Name<input name="name" required value="${esc(ed.name||'')}" placeholder="Ananya Sharma"></label>
      <label>Handle<input name="handle" value="${esc(ed.handle||'')}" placeholder="@ananya"></label></div>
      <div class="mf-row"><label>Tier<select name="tier">${opt(["Micro","Mid","Macro","Celebrity"], ed.tier)}</select></label>
      <label>Category<input name="cat" value="${esc(ed.cat||'')}" placeholder="Fashion"></label></div>
      <div class="mf-row"><label>Followers<input name="followers" value="${esc(ed.followers||'')}" placeholder="128K"></label>
      <label>Engagement<input name="eng" value="${esc(ed.eng||'')}" placeholder="4.2%"></label></div>
      <div class="mf-row"><label>Rating<input name="rating" value="${ed.rating!=null?esc(ed.rating):''}" placeholder="4.8"></label>
      <label>Preferred channel<select name="preferred_channel">${opt(["whatsapp","email"], ed.preferred_channel||"whatsapp")}</select></label></div>
      <div class="mf-sec">Contact</div>
      <div class="mf-row"><label>WhatsApp<input name="whatsapp" value="${esc(ed.whatsapp||'')}" placeholder="+91 98xxxxxxxx"></label>
      <label>Email<input name="email" type="email" value="${esc(ed.email||'')}" placeholder="ananya@email.com"></label></div>
      <div class="mf-sec">Location</div>
      <div class="mf-row"><label>City<input name="city" value="${esc(ed.city||'')}" placeholder="Delhi"></label>
      <label>Saved address (shipping)<input name="address" value="${esc(ed.address||'')}" placeholder="Flat, street, area, PIN"></label></div>
      <button type="button" class="btn ghost" id="ccGeo" style="align-self:flex-start">📍 Use current location</button>
      <input type="hidden" name="lat" value="${ed.lat!=null?esc(ed.lat):''}"><input type="hidden" name="lng" value="${ed.lng!=null?esc(ed.lng):''}">
      <div class="lead-msg" id="ccGeoMsg"></div>
      <div class="auth-err" id="ccErr"></div>
      <button class="btn" type="submit">${existing?'Save changes':'Save Creator'}</button>
    </form></div>`;
  document.body.appendChild(m); m.classList.add("open");
  m.onclick = e=>{ if(e.target.id==="creatorModal") m.classList.remove("open"); };
  document.getElementById("ccClose").onclick = ()=> m.classList.remove("open");
  const form = document.getElementById("creatorForm");
  const geoBtn = document.getElementById("ccGeo"), geoMsg = document.getElementById("ccGeoMsg");
  geoBtn.onclick = async ()=>{
    geoBtn.disabled = true; geoMsg.className = "lead-msg"; geoMsg.textContent = "Locating…";
    try{
      const loc = await pickLocation();
      form.lat.value = loc.lat; form.lng.value = loc.lng;
      if(loc.city && !form.city.value) form.city.value = loc.city;
      if(loc.address && !form.address.value) form.address.value = loc.address;
      geoMsg.className = "lead-msg ok"; geoMsg.textContent = `📍 ${loc.city || (loc.lat+", "+loc.lng)}`;
    }catch(ex){ geoMsg.className = "lead-msg"; geoMsg.textContent = ex.message; }
    finally{ geoBtn.disabled = false; }
  };
  form.onsubmit = async e=>{
    e.preventDefault();
    const f = new FormData(form), err = document.getElementById("ccErr");
    const btn = form.querySelector("button[type=submit]");
    err.textContent=""; btn.disabled=true; btn.textContent="Saving…";
    const row = { name:f.get("name"), city:f.get("city"), tier:f.get("tier"), cat:f.get("cat"),
      followers:f.get("followers"), eng:f.get("eng"), rating:parseFloat(f.get("rating"))||null, handle:f.get("handle"),
      whatsapp:f.get("whatsapp"), email:(f.get("email")||"").toLowerCase(), preferred_channel:f.get("preferred_channel"),
      address:f.get("address"), lat:parseFloat(f.get("lat"))||null, lng:parseFloat(f.get("lng"))||null };
    try{
      if(!window.sb) throw new Error("Database not connected yet.");
      let error;
      if(existing){ ({error}=await window.sb.from("creators").update(row).eq("id", existing.id)); }
      else { if(window.Auth && Auth.profile){ row.org_name = Auth.profile.org; row.org_id = Auth.profile.org_id; } ({error}=await window.sb.from("creators").insert(row)); }
      if(error) throw error;
      m.classList.remove("open");
      await loadCreators();
    }catch(ex){
      err.textContent = ex.message || "Couldn't save.";
      btn.disabled=false; btn.textContent=existing?'Save changes':'Save Creator';
    }
  };
}

function renderCampaigns(){
  let html = pageHead("Campaigns","Every campaign type, one connected pipeline.",`<span id="addCampaignBtn">+ New Campaign</span>`);
  html += `<div class="ci-chips" id="campTypeChips"></div><div class="grid three" id="campaignGrid">${skel("cards",3)}</div>`;
  return html;
}

function campaignCardsHtml(list){
  if(!list.length) return `<div class="card"><div class="ai-suggest"><span class="spark">📣</span><div class="s-body"><b>No campaigns yet</b><p>Click "+ New Campaign" to launch your first one 👆</p></div></div></div>`;
  return list.map(c=>{
    const st = {Live:"good","In Production":"brand",Sourcing:"warn",Approval:"warn",Draft:"warn",Completed:"good"}[c.status]||"brand";
    const prog = Math.max(0, Math.min(100, parseInt(c.progress)||0));
    const creators = parseInt(c.creators)||0;
    return `<div class="card"><h3>${esc(c.name)}<span class="tag ${st}">${esc(c.status)||"Draft"}</span></h3>${window.__isAdmin && c.org_name ? `<div class="muted" style="font-size:12px">🏢 ${esc(c.org_name)}</div>` : ""}
      <div class="muted">${esc(c.brand)||"—"} · ${esc(c.campaign_type?campTypeLabel(c.campaign_type,c.barter_subtype):c.type)||"—"}${c.objective?` · ${esc(c.objective)}`:""}</div>
      ${c.deliverables?`<div class="muted" style="margin-top:6px;font-size:13px">📦 ${esc(c.deliverables)}</div>`:""}
      ${c.budget?`<div class="muted" style="font-size:13px">💰 ₹${fmtNum(c.budget)}</div>`:""}
      ${(c.start_date||c.end_date)?`<div class="muted" style="font-size:13px">🗓 ${esc(c.start_date)||"—"} → ${esc(c.end_date)||"—"}</div>`:""}
      <div class="bar" style="margin-top:8px"><span style="width:${prog}%"></span></div>
      <div class="camp-foot"><span class="muted">${prog}% · ${creators} creators</span>
      <span style="display:flex;gap:6px;flex-wrap:wrap"><button class="mini-btn" data-opencamp="${esc(c.id)}">Open</button><button class="mini-btn" data-bpcamp="${esc(c.id)}">🔁 Process</button><button class="mini-btn" data-bkcamp="${esc(c.id)}">📥 Bulk upload</button><button class="mini-btn" data-invcamp="${esc(c.id)}">🎯 Invite</button><button class="mini-btn ghost" data-editcamp="${esc(c.id)}">Edit</button></span></div></div>`;
  }).join("");
}

// Which section a campaign belongs to: Paid → Campaigns, Barter → Mass Barter, Celebrity story → Celebrity Stories.
// Barter + Paid shows under both Paid and Barter.
function campKind(c){ return c.campaign_type || (/hybrid/i.test(c.type||"")?"barter_paid":/paid|ugc/i.test(c.type||"")?"paid":"barter"); }
function isCelebrityCamp(c){ return c.barter_subtype==="celebrity_story" || (!c.barter_subtype && /celebrity/i.test(c.type||"")); }
function campInBucket(c, b){
  if(b==="all") return true;
  if(b==="approval") return c.status==="Approval";
  if(b==="celebrity") return isCelebrityCamp(c);
  if(b==="paid") return ["paid","barter_paid"].includes(campKind(c)) && !(isCelebrityCamp(c) && campKind(c)!=="barter_paid");
  if(b==="barter") return ["barter","barter_paid"].includes(campKind(c)) && !isCelebrityCamp(c);
  return true;
}
async function fetchOrgCampaigns(){
  const org_id = (window.Auth && Auth.profile && Auth.profile.org_id) || null;
  let cq = window.sb.from("campaigns").select("*").order("created_at",{ascending:false});
  if(org_id && !window.__isAdmin) cq = cq.eq("org_id", org_id);      // Super Admin sees every workspace
  return await cq;
}
function wireCampaignGrid(grid, all){
  grid.querySelectorAll("[data-editcamp]").forEach(b=>b.onclick=()=>{ const c=all.find(x=>x.id===b.dataset.editcamp); if(c) openCampaignModal(c); });
  grid.querySelectorAll("[data-opencamp]").forEach(b=>b.onclick=()=>{ const c=all.find(x=>x.id===b.dataset.opencamp); if(c) openCampaignWorkspace(c.id); });
  grid.querySelectorAll("[data-invcamp]").forEach(b=>b.onclick=()=>{ const c=all.find(x=>x.id===b.dataset.invcamp); if(c) openInvitePanel(c.id, c.name); });
  grid.querySelectorAll("[data-bpcamp]").forEach(b=>b.onclick=()=>{ const c=all.find(x=>x.id===b.dataset.bpcamp); if(c) openBarterProcess(c.id, c.name); });
  grid.querySelectorAll("[data-bkcamp]").forEach(b=>b.onclick=()=>{ const c=all.find(x=>x.id===b.dataset.bkcamp); if(c) openBarterProcess(c.id, c.name, null, "bulk"); });
}
// Mass Barter / Celebrity Stories pages: their campaigns on top, with a pre-set "New campaign" button
function campaignSectionHtml(bucket){
  const T = { barter:["🎁 Barter campaigns","+ New barter campaign","Creators get your product in exchange for content."],
              celebrity:["👑 Celebrity story campaigns","+ New celebrity story campaign","Celebrity / top-creator stories for your brand."] }[bucket];
  return `<div class="card" style="margin-top:16px"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
      <div><h3 style="margin:0">${T[0]}</h3><div class="muted" style="font-size:13px">${T[2]}</div></div>
      <button class="btn" data-newcamp="${bucket}">${T[1]}</button></div>
    <div class="grid three" id="campSection_${bucket}" style="margin-top:12px">${skel("cards",3)}</div></div>`;
}
async function loadCampaignSection(bucket){
  const grid = document.getElementById("campSection_"+bucket); if(!grid || !window.sb) return;
  const btn = document.querySelector(`[data-newcamp="${bucket}"]`);
  if(btn) btn.onclick = ()=> openCampaignModal(null, bucket==="celebrity" ? { campaign_type:"barter", barter_subtype:"celebrity_story" } : { campaign_type:"barter", barter_subtype:"normal_barter" });
  const { data, error } = await fetchOrgCampaigns();
  if(error){ grid.innerHTML = `<div class="muted">Couldn't load campaigns: ${esc(error.message)}</div>`; return; }
  const all = data||[], list = all.filter(c=>campInBucket(c, bucket));
  grid.innerHTML = list.length ? campaignCardsHtml(list) : `<div class="muted">No ${bucket==="celebrity"?"celebrity story":"barter"} campaigns yet — create one with the button above.</div>`;
  wireCampaignGrid(grid, all);
}

// Live: campaign pages re-check every 30s and repaint only when something actually changed
let _campLiveSig = "";
setInterval(async ()=>{
  try{
    if(!window.sb || !window.__osBooted || currentRole==="creator") return;
    if(!["campaigns","barter","celebrity"].includes(currentPage)) { _campLiveSig = ""; return; }
    if(document.visibilityState!=="visible" || document.querySelector(".modal-overlay.open") || document.getElementById("wsBack")) return;
    const { data } = await fetchOrgCampaigns(); const sig = JSON.stringify(data||[]);
    if(_campLiveSig && sig !== _campLiveSig){
      if(currentPage==="campaigns") loadCampaigns();
      if(currentPage==="barter"){ loadCampaignSection("barter"); loadBarter(); }
      if(currentPage==="celebrity"){ loadCampaignSection("celebrity"); loadStories(); }
    }
    _campLiveSig = sig;
  }catch(e){}
}, 30000);

let _campFilter = "all";
async function loadCampaigns(){
  const grid = document.getElementById("campaignGrid");
  if(!grid) return;
  if(!window.sb){ grid.innerHTML = campaignCardsHtml(CAMPAIGNS); return; }
  const { data, error } = await fetchOrgCampaigns();
  if(error){ grid.innerHTML = `<div class="card"><div class="muted">Couldn't load campaigns: ${esc(error.message)}</div></div>`; return; }
  const all = data||[];
  const pass = c => campInBucket(c, _campFilter);
  const chips = document.getElementById("campTypeChips");
  if(chips){
    chips.innerHTML = [["all","All"],["paid","💰 Paid"],["barter","🎁 Barter"],["celebrity","👑 Celebrity stories"],["approval","⏳ Awaiting approval"]].map(([k,l])=>{ const keep=_campFilter; _campFilter=k; const n=all.filter(pass).length; _campFilter=keep;
      return `<button class="ci-chip${_campFilter===k?" on":""}" data-cfilter="${k}">${l} <span>${n}</span></button>`; }).join("");
    chips.querySelectorAll("[data-cfilter]").forEach(b=> b.onclick = ()=>{ _campFilter = b.dataset.cfilter; loadCampaigns(); });
  }
  const data2 = all.filter(pass);
  grid.innerHTML = campaignCardsHtml(data2);
  wireCampaignGrid(grid, all);
}

/* ================= CAMPAIGN WORKSPACE (one campaign, everything connected) ================= */
let _wsCampaign = null;

async function openCampaignWorkspace(id){
  const content = document.querySelector("#content, .content");
  if(!content || !window.sb) return;
  content.innerHTML = `<div class="muted" style="padding:24px">Loading campaign…</div>`;
  // Campaign (org-scoped), applications to it, and barter items linked by campaign name.
  const [cRes, aRes, pRes] = await Promise.all([
    sb.from("campaigns").select("*").eq("id", id).maybeSingle(),
    sb.rpc("campaign_applications"),
    sb.schema("api").rpc("org_applicants", { p_campaign: null, p_stage: null }).then(r=>r, ()=>({data:[]}))
  ]);
  const c = cRes.data;
  if(!c){ content.innerHTML = `<div class="card"><div class="muted">Couldn't open this campaign.</div></div>`; return; }
  _wsCampaign = c;
  const apps = ((aRes && aRes.data) || []).filter(a=>a.campaign_id===id);
  const { data: bdata } = await sb.from("barter_items").select("*").eq("campaign", c.name||"__none__").order("created_at",{ascending:false});
  const barter = bdata||[];
  const pipe = ((pRes && pRes.data) || []).filter(p=>p.legacy_campaign_id===id);
  renderCampaignWorkspace(c, apps, barter, pipe);
}

function renderCampaignWorkspace(c, apps, barter, pipe){
  pipe = pipe || [];
  const content = document.querySelector("#content, .content");
  const st = {Live:"good","In Production":"brand",Sourcing:"warn",Approval:"warn",Draft:"warn",Completed:"good"}[c.status]||"brand";
  const PENDING = ["applied","eligible","sent_to_brand"], DECLINED = ["ineligible","brand_declined","dropped","rejected"];
  const applied = apps.filter(a=>a.status==="Applied").concat(pipe.filter(p=>PENDING.includes(p.stage)));
  const approved = apps.filter(a=>a.status==="Approved").concat(pipe.filter(p=>!PENDING.includes(p.stage) && !DECLINED.includes(p.stage)));
  const info = (l,v)=> v ? `<div class="cd-row"><span class="cd-l">${l}</span><span class="cd-v">${esc(v)}</span></div>` : "";
  // Deliverables checklist from the free-text field.
  const items = (c.deliverables||"").split(/\r?\n|;|,(?![^(]*\))/).map(s=>s.trim()).filter(Boolean);
  const done = Array.isArray(c.deliverables_done) ? c.deliverables_done : [];
  const checklist = items.length ? items.map((it,i)=>`<label class="ws-check"><input type="checkbox" data-deliv="${i}" ${done.includes(it)?"checked":""}> <span${done.includes(it)?' style="text-decoration:line-through;opacity:.6"':''}>${esc(it)}</span></label>`).join("")
    : `<div class="muted" style="padding:6px">No deliverables set — add them via Edit.</div>`;
  const appRow = a=>`<div class="row"><span class="avatar">${esc((a.creator_name||"?").slice(0,2).toUpperCase())}</span>
    <div class="r-main"><div class="r-title">${esc(a.creator_name)||"Creator"}</div><div class="r-sub">${esc(a.creator_org)||""} · ${esc(a.status)}</div></div>
    ${a.status==="Applied"?`<span><button class="mini-btn" data-wsapprove="${esc(a.id)}">Approve</button> <button class="mini-btn ghost" data-wsdecline="${esc(a.id)}">Decline</button></span>`:`<span class="tag ${a.status==="Approved"?"good":""}" title="${esc(a.decline_note||"")}">${esc(a.status)}</span>`}</div>`;
  const barterRow = b=>`<div class="row"><div class="r-main"><div class="r-title">${esc(b.product||"Item")} ${b.creator?`· ${esc(b.creator)}`:""}</div>
    <div class="r-sub">${esc(b.stage||"Requested")}${b.tracking_number?` · 🚚 ${esc(b.tracking_number)}`:""}${b.deadline?` · ⏰ ${esc(b.deadline)}`:""}</div></div>
    <span class="tag brand">${esc(b.stage||"Requested")}</span></div>`;

  content.innerHTML = `
    <div style="margin-bottom:14px"><button class="btn ghost" id="wsBack">← Campaigns</button></div>
    <div class="page-head"><div><h1>${esc(c.name)} <span class="tag ${st}">${esc(c.status)||"Draft"}</span></h1>
      <p>${[c.brand,c.type,c.objective].filter(Boolean).map(esc).join(" · ")||"Campaign workspace"}</p></div>
      <button class="btn" id="wsProcess">🔁 Barter process</button>
      <button class="btn ghost" id="wsBulk">📥 Bulk upload creators</button>
      <button class="btn ghost" id="wsInvite">🎯 Invite creators</button>
      <button class="btn ghost" id="wsEdit">Edit campaign</button>
      <button class="btn ghost cdel-btn" id="wsDel">${window.__isAdmin?"🗑 Delete campaign":"🗑 Request delete"}</button></div>
    <div id="wsDelNote"></div>

    <div class="ws-stats">
      <div class="ws-stat"><b>${applied.length}</b><span>New applicants</span></div>
      <div class="ws-stat"><b>${approved.length}</b><span>Approved creators</span></div>
      <div class="ws-stat"><b>${barter.length}</b><span>Barter shipments</span></div>
      <div class="ws-stat"><b>${c.budget?fmtMoney(c.budget):"—"}</b><span>Budget</span></div>
    </div>

    <div class="card hub-card"><div class="hub-card-h"><h3 style="margin:0">👥 Everyone on this campaign</h3><span class="muted">Tap a creator — profile, every step, WhatsApp history and the next message, all here</span></div>
      <div id="wsPeople">${skel("list",3)}</div></div>
    <div class="grid two">
      <div class="grid" style="gap:16px">
        <div class="card"><h3>Applicants ${applied.length?`<span class="tag warn">${applied.length} new</span>`:""}</h3>
          <div class="list" id="wsApps">${(pipe.length||apps.length)?pipe.map(p=>applicantRowHtml(p)).join("")+apps.map(appRow).join(""):`<div class="muted" style="padding:8px">No applications yet. Creators apply from their Media Kit → Open campaigns.</div>`}</div></div>
        <div class="card"><h3>Barter shipments</h3>
          <div class="list" id="wsBarter">${barter.length?barter.map(barterRow).join(""):`<div class="muted" style="padding:8px">No barter items linked. Create one in Mass Barter with campaign “${esc(c.name)}”.</div>`}</div></div>
      </div>
      <div class="grid" style="gap:16px">
        <div class="card"><h3>Deliverables</h3><div id="wsChecklist">${checklist}</div></div>
        <div class="card"><h3>Details</h3>
          ${info("Type", c.campaign_type?campTypeLabel(c.campaign_type,c.barter_subtype):c.type)}${info("Creators needed", c.creators?String(c.creators):"")}
          ${c.product_link||c.product_value?`<div class="cd-row"><span class="cd-l">Barter product</span><span class="cd-v">${c.product_link?`<a href="${esc(safeUrl(c.product_link))}" target="_blank" rel="noopener">Open ↗</a>`:""}${c.product_value?` · ${fmtMoney(c.product_value)}`:""}</span></div>`:""}
          ${info("Platforms", c.platforms)}${info("Hashtags", c.hashtags)}
          ${info("Timeline", (c.start_date||c.end_date)?`${c.start_date||"—"} → ${c.end_date||"—"}`:"")}
          ${c.brief?`<div class="cd-block"><div class="cd-l">Brief</div><div class="cd-body">${esc(c.brief)}</div></div>`:""}
          ${(c.attachments||[]).length?`<div class="cd-block"><div class="cd-l">Files</div><div class="cd-body">${c.attachments.map(a=>`<a href="${esc(safeUrl(a.url))}" target="_blank" rel="noopener">📎 ${esc(a.name)}</a>`).join("<br>")}</div></div>`:""}
          ${idealProfileHtml(c.ideal_profile)}</div>
      </div>
    </div>`;

  document.getElementById("wsBack").onclick = ()=>{ currentPage="campaigns"; renderShell(); };
  document.getElementById("wsEdit").onclick = ()=> openCampaignModal(c);
  wireCampaignDelete(c);
  document.getElementById("wsInvite").onclick = ()=> openInvitePanel(c.id, c.name);
  document.getElementById("wsProcess").onclick = ()=> openBarterProcess(c.id, c.name);
  document.getElementById("wsBulk").onclick = ()=> openBarterProcess(c.id, c.name, null, "bulk");
  const reload = ()=> openCampaignWorkspace(c.id);
  content.querySelectorAll("[data-wsapprove]").forEach(b=>b.onclick=()=>updateStatus("applications", b.dataset.wsapprove, {status:"Approved"}, reload));
  content.querySelectorAll("[data-wsdecline]").forEach(b=>b.onclick=()=>declineLegacyApplication(b.dataset.wsdecline, reload));
  wireApplicantButtons(content, reload);
  loadCampaignPeople(c);
  // an applicant row opens that creator's full story
  content.querySelectorAll("#wsApps .row").forEach(r=>{ const b = r.querySelector("[data-papprove],[data-pdecline]"); const pid = r.dataset.pid; if(pid && !b){ r.style.cursor = "pointer"; r.onclick = e=>{ if(e.target.closest("a,button")) return; openCreatorHub(pid); }; } });
  content.querySelectorAll("[data-deliv]").forEach(cb=> cb.onchange = ()=>{
    const span = cb.parentNode.querySelector("span");
    if(span){ span.style.textDecoration = cb.checked ? "line-through" : ""; span.style.opacity = cb.checked ? ".6" : ""; }
    toggleDeliverable(c, items[+cb.dataset.deliv], cb.checked).then(ok=>{
      if(ok) return;
      cb.checked = !cb.checked;
      if(span){ span.style.textDecoration = cb.checked ? "line-through" : ""; span.style.opacity = cb.checked ? ".6" : ""; }
    });
  });
}

async function toggleDeliverable(c, item, checked){
  if(!window.sb || !item) return false;
  const prev = Array.isArray(c.deliverables_done) ? c.deliverables_done.slice() : [];
  let done = prev.slice();
  if(checked){ if(!done.includes(item)) done.push(item); } else { done = done.filter(x=>x!==item); }
  c.deliverables_done = done;
  const ok = await checkedWrite(sb.from("campaigns").update({ deliverables_done: done }).eq("id", c.id), "save this deliverable");
  if(!ok) c.deliverables_done = prev;
  return ok;
}

const CAMP_TYPES = [["barter","Barter"],["paid","Paid"],["barter_paid","Barter + Paid"]];
const BARTER_SUBTYPES = [["celebrity_story","Celebrity story"],["normal_barter","Normal barter"],["pr_package","PR package"]];
const CAMP_PLATFORMS = ["Instagram","YouTube","Facebook","LinkedIn","X / Twitter","Snapchat","Moj / Josh"];
function campTypeLabel(t, st){
  const T = Object.fromEntries(CAMP_TYPES), S = Object.fromEntries(BARTER_SUBTYPES);
  return (T[t]||"") + (st && S[st] && t!=="paid" ? " · "+S[st] : "");
}
// legacy `type` text kept in sync so older screens & reports keep working
function legacyTypeFor(t, st){
  if(t==="paid") return "Paid Campaign";
  if(t==="barter_paid") return "Hybrid";
  return { celebrity_story:"Celebrity Story", pr_package:"Product Seeding", normal_barter:"Mass Barter" }[st] || "Mass Barter";
}
const MAX_CAMP_FILE = 10*1024*1024;

// Campaign status is just Draft → Live → Completed. "Completed" is offered only for a campaign whose end date has
// passed (to add an old campaign); live ones complete themselves after the end date. Older words map onto these.
function campStatusPick(st){ return ({Sourcing:"Live","In Production":"Live",Approval:"Approval"})[st] || st || "Live"; }
function campStatusOptions(cur, endDate){
  const today = new Date().toISOString().slice(0,10), ended = !!endDate && endDate < today;
  const pick = (!cur && ended) ? "Completed" : campStatusPick(cur);
  const list = [["Draft","Draft — not visible to creators"],["Live","Live — creators can apply"],["Shortlist completed","Shortlist completed — running, no new applications"]];
  if(pick==="Approval") list.splice(1,0,["Approval","Waiting for approval"]);
  if(ended || pick==="Completed") list.push(["Completed","Completed"+(ended?" — already ended":"")]);
  const sel = list.some(x=>x[0]===pick) ? pick : (ended ? "Completed" : "Live");
  return list.map(([v,l])=>`<option value="${v}"${v===sel?" selected":""}>${esc(l)}</option>`).join("");
}
function openCampaignModal(existing, preset){
  preset = preset || {};
  const ed = existing || {};
  const ip = (ed.ideal_profile && typeof ed.ideal_profile==="object") ? ed.ideal_profile : {};
  const ct = (ed.contract_terms && typeof ed.contract_terms==="object") ? ed.contract_terms : {};
  const vb = (ed.video_brief && typeof ed.video_brief==="object") ? ed.video_brief : {};
  let files = Array.isArray(ed.attachments) ? ed.attachments.slice() : [];
  const ctype = ed.campaign_type || preset.campaign_type || (/paid/i.test(ed.type||"") && !/hybrid/i.test(ed.type||"") ? "paid" : /hybrid/i.test(ed.type||"") ? "barter_paid" : "barter");
  const opt = (arr,val)=>arr.map(o=>`<option${o===val?' selected':''}>${o}</option>`).join("");
  const kv = (arr,val)=>arr.map(([k,l])=>`<option value="${k}"${k===val?' selected':''}>${l}</option>`).join("");
  const plats = String(ed.platforms||"Instagram").split(/\s*,\s*/).filter(Boolean);
  const list = v => Array.isArray(v) ? v.join(", ") : (v||"");
  let m = document.getElementById("campaignModal"); if(m) m.remove();
  m = el("div","modal-overlay"); m.id="campaignModal";
  m.innerHTML = `<div class="modal modal-lg">
    <div class="modal-head"><strong>${existing?'Edit Campaign':'New Campaign'}</strong><button class="icon-btn" id="cmClose">✕</button></div>
    <form id="campaignForm" class="modal-form">
      <div class="cm-sec">Campaign type</div>
      <div class="cm-seg" id="cmType">${CAMP_TYPES.map(([k,l])=>`<label class="${k===ctype?'act':''}"><input type="radio" name="campaign_type" value="${k}"${k===ctype?' checked':''}> ${l}</label>`).join("")}</div>
      <div class="mf-row cm-barter"><label>Barter type<select name="barter_subtype">${kv(BARTER_SUBTYPES, ed.barter_subtype||preset.barter_subtype||"normal_barter")}</select></label>
        <label>Number of creators<input name="creators" type="number" min="0" value="${ed.creators!=null?esc(ed.creators):''}" placeholder="20"></label></div>
      <div class="mf-row"><label>Campaign name<input name="name" required maxlength="120" value="${esc(ed.name||'')}" placeholder="Summer Glow Launch"></label>
      <label>Brand name<input name="brand" required maxlength="120" value="${esc(ed.brand||'')}" placeholder="Lume Cosmetics"></label></div>
      <div class="mf-row cm-barter"><label>Barter product link<input name="product_link" type="url" value="${esc(ed.product_link||'')}" placeholder="https://brand.com/product"></label>
      <label>Barter product value (₹)<input name="product_value" type="number" min="0" value="${ed.product_value!=null?esc(ed.product_value):''}" placeholder="1499"></label></div>
      <div class="mf-row"><label class="cm-paid">Budget (₹)<input name="budget" type="number" min="0" value="${ed.budget!=null?esc(ed.budget):''}" placeholder="100000"></label>
      <label class="cm-nobarter-creators">Number of creators<input name="creators_paid" type="number" min="0" value="${ed.creators!=null?esc(ed.creators):''}" placeholder="10"></label>
      <label>Objective<select name="objective">${opt(["Awareness","Engagement","Sales / Conversions","UGC content","Product launch","App installs","Store visits"], ed.objective)}</select></label></div>
      <label>Platforms</label>
      <div class="cm-chips">${CAMP_PLATFORMS.map(p=>`<label><input type="checkbox" name="platforms" value="${esc(p)}"${plats.includes(p)?' checked':''}> ${esc(p)}</label>`).join("")}</div>
      <label>Hashtags &amp; mentions<input name="hashtags" value="${esc(ed.hashtags||'')}" placeholder="#summerglow #ad @lumecosmetics"></label>
      <label>Deliverables<textarea name="deliverables" rows="2" placeholder="e.g. 1 Reel + 2 Stories + 1 Static post">${esc(ed.deliverables||'')}</textarea></label>
      <label>Brief / notes<textarea name="brief" rows="3" placeholder="Goals, key messaging, dos & don'ts, references…">${esc(ed.brief||'')}</textarea></label>
      <label>Attach anything <span class="muted" style="font-weight:400">(brief PDF, mood board, product images — max 10 MB each)</span><input type="file" id="cmFiles" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.gif,.heic,.mp4,.mov,.csv,.txt,.zip,.doc,.docx,.ppt,.pptx,.xls,.xlsx"></label>
      <div id="cmFileList" class="cm-files"></div>
      <div class="mf-row"><label>Start date<input name="start_date" type="date" value="${esc(ed.start_date||'')}"></label>
      <label>End date<input name="end_date" type="date" value="${esc(ed.end_date||'')}"></label></div>
      <div class="mf-row"><label>Status<select name="status" id="cmStatus">${campStatusOptions(ed.status, ed.end_date)}</select>
        <span class="muted" style="font-weight:400;font-size:12px;text-transform:none;letter-spacing:0">Live = open for creators. It turns <b>Completed</b> on its own after the end date.</span></label>
      ${existing?`<label>Progress %<input name="progress" type="number" min="0" max="100" value="${ed.progress!=null?esc(ed.progress):''}" placeholder="0"></label>`:'<span></span>'}</div>
      <div class="cm-sec">📜 Contract terms <span class="muted" style="font-weight:400;font-size:12px">— sent to each creator automatically the moment you approve them</span></div>
      <div class="mf-row"><label>Product the creator gets<input name="ct_product" maxlength="140" value="${esc(ct.product||'')}" placeholder="Momo box (12 pcs)"></label>
      <label>Deliverables in the contract<input name="ct_deliv" maxlength="200" value="${esc(ct.deliverables||'')}" placeholder="1 Reel + 2 Stories"></label></div>
      <div class="mf-row"><label>Ad rights (months)<input name="ct_months" type="number" min="0" max="24" value="${esc(ct.ad_rights_months??1)}"></label>
      <label>Content due (days after delivery)<input name="ct_days" type="number" min="1" max="60" value="${esc(ct.content_days??7)}"></label></div>
      <label class="cp-check"><input type="checkbox" name="ct_collab"${ct.collab_rights===false?'':' checked'}> Collab rights — the creator adds the brand as an Instagram collaborator</label>
      <label class="cp-check"><input type="checkbox" name="ct_black"${ct.blacklist_clause===false?'':' checked'}> <span><b>Non-delivery = blacklist</b> — if they take the product and don't post on time, they're blacklisted from the platform</span></label>
      <label class="cp-check"><input type="checkbox" name="ct_reship"${ct.reship_clause===false?'':' checked'}> <span><b>Re-ship at their own cost</b> — they must send the product to another creator we name</span></label>
      <label>Other terms <span class="muted" style="font-weight:400">(optional)</span><textarea name="ct_extra" rows="2" maxlength="1500" placeholder="e.g. No competitor brands for 30 days after posting">${esc(ct.extra_terms||'')}</textarea></label>
      <div class="cm-sec">🎬 Video brief <span class="muted" style="font-weight:400;font-size:12px">— sent to the creator automatically when the product is delivered</span></div>
      <label>What to shoot<textarea name="vb_shoot" rows="2" maxlength="2000" placeholder="Unboxing + first bite, 20–30 sec, vertical 9:16">${esc(vb.what_to_shoot||'')}</textarea></label>
      <label>Key messages<textarea name="vb_msg" rows="2" maxlength="1500" placeholder="Steamed fresh in 10 minutes, 400+ outlets">${esc(vb.key_messages||'')}</textarea></label>
      <div class="mf-row"><label>Do's<textarea name="vb_dos" rows="2" maxlength="1000" placeholder="Natural light, show the box">${esc(vb.dos||'')}</textarea></label>
      <label>Don'ts<textarea name="vb_donts" rows="2" maxlength="1000" placeholder="No other brands in frame">${esc(vb.donts||'')}</textarea></label></div>
      <div class="mf-row"><label>Caption to use<input name="vb_caption" maxlength="600" value="${esc(vb.caption||'')}" placeholder="Best momos in town 🥟"></label>
      <label>Reference links<input name="vb_refs" maxlength="600" value="${esc(vb.reference_links||'')}" placeholder="https://instagram.com/reel/…"></label></div>
      <label>Posting note <span class="muted" style="font-weight:400">(optional)</span><input name="vb_note" maxlength="400" value="${esc(vb.posting_note||'')}" placeholder="Post between 6–9 pm, tag the brand in the story"></label>
      <div class="cm-sec">Ideal influencer profile <span class="muted" style="font-weight:400;font-size:12px">— used to screen & discover creators; never shown to creators</span></div>
      <div class="mf-row"><label>Min followers<input name="ip_min" type="number" min="0" value="${esc(ip.min_followers??'')}" placeholder="10000"></label>
      <label>Max followers<input name="ip_max" type="number" min="0" value="${esc(ip.max_followers??'')}" placeholder="500000"></label></div>
      <div class="mf-row"><label>Location(s)<input name="ip_loc" value="${esc(list(ip.locations))}" placeholder="Delhi NCR, Mumbai"></label>
      <label>Gender<select name="ip_gender">${kv([["","Any"],["female","Female"],["male","Male"],["other","Other"]], ip.gender||"")}</select></label></div>
      <div class="mf-row"><label>Category<input name="ip_cat" value="${esc(list(ip.categories))}" placeholder="Beauty, Lifestyle"></label>
      <label>Avg engagement (min %)<input name="ip_eng" type="number" min="0" max="100" step="0.1" value="${esc(ip.min_engagement??'')}" placeholder="2.5"></label></div>
      <label>Audience data<input name="ip_aud" value="${esc(ip.audience_notes||'')}" placeholder="e.g. 18–34, 60% female, metro India"></label>
      <div class="auth-err" id="cmErr"></div>
      <button class="btn" type="submit">${existing?'Save changes':'Launch Campaign'}</button>
    </form></div>`;
  document.body.appendChild(m); m.classList.add("open");
  const form = document.getElementById("campaignForm");
  const syncType = ()=>{
    const t = form.querySelector("input[name=campaign_type]:checked").value;
    form.querySelectorAll(".cm-barter").forEach(x=> x.style.display = t==="paid" ? "none" : "");
    form.querySelectorAll(".cm-paid").forEach(x=> x.style.display = t==="barter" ? "none" : "");
    form.querySelectorAll(".cm-nobarter-creators").forEach(x=> x.style.display = t==="paid" ? "" : "none");
    form.querySelectorAll("#cmType label").forEach(l=> l.classList.toggle("act", l.querySelector("input").checked));
  };
  form.querySelectorAll("input[name=campaign_type]").forEach(r=> r.onchange = syncType); syncType();
  const endIn = form.querySelector("input[name=end_date]"), stSel = document.getElementById("cmStatus");
  if(endIn && stSel) endIn.addEventListener("change", ()=>{ const cur = stSel.value, ended = endIn.value && endIn.value < new Date().toISOString().slice(0,10);
    stSel.innerHTML = campStatusOptions(ended && cur==="Live" ? "Completed" : (!ended && cur==="Completed" ? "Live" : cur), endIn.value); });
  const pending = [];
  const paintFiles = ()=>{
    const box = document.getElementById("cmFileList");
    box.innerHTML = files.map((f,i)=>`<span class="cm-file">📎 <a href="${esc(safeUrl(f.url))}" target="_blank" rel="noopener">${esc(f.name)}</a> <button type="button" data-rmf="${i}">✕</button></span>`).join("")
      + pending.map((f,i)=>`<span class="cm-file pend">⏳ ${esc(f.name)} <button type="button" data-rmp="${i}">✕</button></span>`).join("");
    box.querySelectorAll("[data-rmf]").forEach(b=> b.onclick = ()=>{ files.splice(+b.dataset.rmf,1); paintFiles(); });
    box.querySelectorAll("[data-rmp]").forEach(b=> b.onclick = ()=>{ pending.splice(+b.dataset.rmp,1); paintFiles(); });
  };
  paintFiles();
  document.getElementById("cmFiles").onchange = e=>{
    const err = document.getElementById("cmErr"); err.textContent = "";
    for(const f of e.target.files){
      if(f.size > MAX_CAMP_FILE){ err.textContent = `${f.name} is over 10 MB.`; continue; }
      if(files.length + pending.length >= 10){ err.textContent = "Up to 10 files per campaign."; break; }
      pending.push(f);
    }
    e.target.value = ""; paintFiles();
  };
  m.onclick = e=>{ if(e.target.id==="campaignModal") m.classList.remove("open"); };
  document.getElementById("cmClose").onclick = ()=> m.classList.remove("open");
  form.onsubmit = async e=>{
    e.preventDefault();
    const f = new FormData(form), err = document.getElementById("cmErr");
    const btn = form.querySelector("button[type=submit]");
    const t = f.get("campaign_type"), st = t==="paid" ? null : f.get("barter_subtype");
    const num = v => { const n = parseFloat(v); return isFinite(n) && n>=0 ? n : null; };
    const csv = v => String(v||"").split(",").map(x=>x.trim()).filter(Boolean).slice(0,20);
    err.textContent="";
    if(f.get("start_date") && f.get("end_date") && f.get("end_date") < f.get("start_date")){ err.textContent = "End date must be after the start date."; return; }
    const pl = f.get("product_link");
    if(pl && !/^https?:\/\//i.test(pl)){ err.textContent = "Product link must start with https://"; return; }
    const ideal = {};
    if(num(f.get("ip_min"))!=null) ideal.min_followers = num(f.get("ip_min"));
    if(num(f.get("ip_max"))!=null) ideal.max_followers = num(f.get("ip_max"));
    if(ideal.min_followers!=null && ideal.max_followers!=null && ideal.max_followers < ideal.min_followers){ err.textContent = "Max followers must be more than min followers."; return; }
    if(csv(f.get("ip_loc")).length) ideal.locations = csv(f.get("ip_loc"));
    if(f.get("ip_gender")) ideal.gender = f.get("ip_gender");
    if(csv(f.get("ip_cat")).length) ideal.categories = csv(f.get("ip_cat"));
    if(num(f.get("ip_eng"))!=null) ideal.min_engagement = num(f.get("ip_eng"));
    if(String(f.get("ip_aud")||"").trim()) ideal.audience_notes = String(f.get("ip_aud")).trim().slice(0,500);
    btn.disabled=true; btn.textContent="Saving…";
    try{
      if(!window.sb) throw new Error("Database not connected.");
      const org = window.Auth && Auth.profile && Auth.profile.org_id;
      if(pending.length){
        if(!org) throw new Error("Your workspace isn't set up yet — can't upload files.");
        for(const file of pending.slice()){
          btn.textContent = `Uploading ${file.name}…`;
          const safe = file.name.replace(/[^\w.\-]+/g,"_").slice(-80);
          const path = `${org}/${Date.now()}-${Math.random().toString(36).slice(2,8)}-${safe}`;
          const up = await sb.storage.from("campaign-files").upload(path, file, { contentType: file.type || "application/octet-stream", upsert:false });
          if(up.error) throw new Error(`Couldn't upload ${file.name}: ${up.error.message}`);
          const { data:pub } = sb.storage.from("campaign-files").getPublicUrl(path);
          files.push({ name:file.name, url:pub.publicUrl, type:file.type||"", size:file.size, path });
          pending.splice(pending.indexOf(file),1);
        }
      }
      const creators = t==="paid" ? parseInt(f.get("creators_paid")) : parseInt(f.get("creators"));
      const row = { name:f.get("name"), brand:f.get("brand"), campaign_type:t, barter_subtype:st, type:legacyTypeFor(t, st),
        objective:f.get("objective"), status:f.get("status"),
        budget: t==="barter" ? null : num(f.get("budget")),
        product_link: t==="paid" ? null : (pl||null), product_value: t==="paid" ? null : num(f.get("product_value")),
        platforms:f.getAll("platforms").join(", "), hashtags:f.get("hashtags"), deliverables:f.get("deliverables"), brief:f.get("brief"),
        start_date:f.get("start_date")||null, end_date:f.get("end_date")||null,
        creators: isFinite(creators) && creators>=0 ? creators : 0, attachments: files, ideal_profile: ideal };
      const txt = k => String(f.get(k)||"").trim();
      row.contract_terms = { product: txt("ct_product") || null, product_value: t==="paid" ? null : num(f.get("product_value")),
        deliverables: txt("ct_deliv") || String(f.get("deliverables")||"").trim() || null,
        ad_rights_months: Math.min(24, Math.max(0, parseInt(f.get("ct_months"))||0)), content_days: Math.min(60, Math.max(1, parseInt(f.get("ct_days"))||7)),
        collab_rights: !!f.get("ct_collab"), blacklist_clause: !!f.get("ct_black"), reship_clause: !!f.get("ct_reship"), extra_terms: txt("ct_extra") || null };
      row.video_brief = { what_to_shoot: txt("vb_shoot") || null, key_messages: txt("vb_msg") || null, dos: txt("vb_dos") || null, donts: txt("vb_donts") || null,
        caption: txt("vb_caption") || null, reference_links: txt("vb_refs") || null, posting_note: txt("vb_note") || null };
      if(existing) row.progress = parseInt(f.get("progress"))||0;
      let error;
      const save = r => existing ? sb.from("campaigns").update(r).eq("id", existing.id) : sb.from("campaigns").insert(r);
      if(!existing && window.Auth&&Auth.profile){ row.org_name=Auth.profile.org; row.org_id=Auth.profile.org_id; }
      ({ error } = await save(row));
      if(error && /contract_terms|video_brief/i.test(error.message||"")){   // database not upgraded yet — save the rest
        delete row.contract_terms; delete row.video_brief; ({ error } = await save(row));
      }
      if(error) throw error;
      if(window.Tracker) Tracker.security(existing?"campaign_edit":"campaign_create", { campaign: row.name, type: t });
      m.classList.remove("open");
      if(existing && document.getElementById("wsBack") && _wsCampaign && _wsCampaign.id===existing.id) openCampaignWorkspace(existing.id); else { await loadCampaigns(); loadCampaignSection("barter"); loadCampaignSection("celebrity"); }
      if(!existing){                      // brand new campaign → show who matches it, ready to invite
        const { data:fresh } = await sb.from("campaigns").select("id,name").eq("name", row.name).order("created_at",{ascending:false}).limit(1);
        const made = fresh && fresh[0];
        // brand new campaign → straight to adding creators: bulk upload (sheet / Word), or pick from Geek OS
        if(made) setTimeout(()=> openBarterProcess(made.id, made.name, null, "bulk"), 350);
      }
    }catch(ex){ paintFiles(); err.textContent = ex.message||"Couldn't save."; btn.disabled=false; btn.textContent=existing?'Save changes':'Launch Campaign'; }
  };
}

/* ---------- Creator reports: campaign history + Instagram performance, all live, downloadable ---------- */
function renderCreatorReports(){
  return pageHead("Reports","Your campaigns and Instagram performance — live, downloadable.") + `<div id="crBody">${skel("table")}</div>`;
}
async function loadCreatorReports(){
  const box = document.getElementById("crBody"); if(!box || !window.sb) return;
  const [acct, mine] = await Promise.all([ mkFetchAcct(),
    window.__ciOpsEnabled ? sb.schema("api").rpc("get_my_campaigns").then(r=>r, ()=>({data:[]})) : Promise.resolve({data:[]}) ]);
  const a = acct||{}, media = Array.isArray(a.recent_media) ? a.recent_media : [], M = mine.data||[];
  const PEND = ["applied","eligible","sent_to_brand","shortlisted","invited"], DECL = ["ineligible","brand_declined","dropped","rejected"];
  const approved = M.filter(c=>!PEND.includes(c.stage) && !DECL.includes(c.stage));
  const since = Date.now() - 30*86400000, last30 = media.filter(m=> m.timestamp && new Date(m.timestamp).getTime() >= since);
  const eng = a.followers_count && media.length ? (100 * media.reduce((x,m)=> x + (Number(m.like_count)||0) + (Number(m.comments_count)||0), 0) / media.length / a.followers_count) : null;
  const kind = c => ({cash:"Paid",hybrid:"Barter + Paid",barter:"Barter"})[c.comp_type] || "—";
  const posts = media.slice().sort((x,y)=> new Date(y.timestamp||0) - new Date(x.timestamp||0));
  box.innerHTML = `<div class="rp-kpis">
      <div><b>${M.length}</b>Applications</div><div><b>${approved.length}</b>Approved</div><div><b>${M.filter(c=>c.stage==="completed").length}</b>Completed</div>
      <div><b>${fmtNum(a.followers_count||0)}</b>Followers</div><div><b>${a.avg_reach?fmtNum(Math.round(a.avg_reach)):"—"}</b>Avg reach</div>
      <div><b>${eng!=null?eng.toFixed(2)+"%":"—"}</b>Engagement</div><div><b>${last30.length}</b>Posts (30 days)</div></div>
    <div class="card"><h3 style="margin-top:0">Campaign history</h3>
      ${M.length ? `<div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Campaign</th><th>Brand</th><th>Type</th><th>Status</th><th>Deadline</th></tr></thead><tbody>
        ${M.map(c=>`<tr><td><b>${esc(c.campaign||"—")}</b></td><td>${esc(c.brand||"—")}</td><td>${kind(c)}</td><td>${esc(String(c.stage||"").replace(/_/g," "))}</td><td>${esc(fmtDate(c.deadline))}</td></tr>`).join("")}</tbody></table></div>`
        : `<div class="muted" style="padding:6px">No campaigns yet.</div>`}</div>
    <div class="card" style="margin-top:14px"><h3 style="margin-top:0">Instagram posts</h3>
      ${posts.length ? `<div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Date</th><th>Type</th><th>Caption</th><th>Likes</th><th>Comments</th><th></th></tr></thead><tbody>
        ${posts.map(m=>`<tr><td>${esc(fmtDate(m.timestamp))}</td><td>${esc(({VIDEO:"Reel / video",CAROUSEL_ALBUM:"Carousel",IMAGE:"Photo"})[m.media_type]||m.media_type||"")}</td>
          <td style="max-width:320px;font-size:12px">${esc((m.caption||"").slice(0,90))}</td><td>${fmtNum(m.like_count||0)}</td><td>${fmtNum(m.comments_count||0)}</td>
          <td>${m.permalink?`<a href="${esc(safeUrl(m.permalink))}" target="_blank" rel="noopener">Open ↗</a>`:""}</td></tr>`).join("")}</tbody></table></div>`
        : `<div class="muted" style="padding:6px">No posts synced yet.</div>`}</div>
    <div style="margin-top:14px"><button class="mini-btn" id="crCsv">⬇ Download CSV</button></div>`;
  document.getElementById("crCsv").onclick = ()=>{
    const rows = [["Section","Name / date","Brand / type","Status / likes","Deadline / comments"]]
      .concat(M.map(c=>["Campaign", c.campaign, c.brand, c.stage, c.deadline||""]))
      .concat(posts.map(m=>["Post", m.timestamp||"", m.media_type||"", m.like_count||0, m.comments_count||0]));
    const csv = rows.map(r=>r.map(v=>`"${String(v??"").replace(/"/g,'""')}"`).join(",")).join("\n");
    const l = document.createElement("a"); l.href = URL.createObjectURL(new Blob([csv],{type:"text/csv"})); l.download = "my-creator-report.csv"; l.click();
  };
}

function renderReports(){
  if(currentRole==="creator") return renderCreatorReports();
  let html = pageHead("Reports","Live campaign performance for your org.");
  html += kpiRow(currentRole);
  html += `<div class="card"><h3>Campaign Performance</h3>
    <div class="list" id="reportRows"><div class="muted" style="padding:12px">Loading…</div></div></div>`;
  return html;
}

async function loadReportRows(){
  const wrap = document.getElementById("reportRows");
  if(!wrap) return;
  if(!window.sb){ wrap.innerHTML = `<div class="muted" style="padding:12px">Connect the database to see performance.</div>`; return; }
  const { data, error } = await sb.from("campaigns").select("*").order("created_at",{ascending:false});
  if(error){ wrap.innerHTML = `<div class="muted" style="padding:12px">Couldn't load: ${esc(error.message)}</div>`; return; }
  const list = data||[];
  if(!list.length){ wrap.innerHTML = `<div class="muted" style="padding:12px">No campaigns yet — launch one to see performance here.</div>`; return; }
  wrap.innerHTML = list.map(c=>{
    const prog = Math.max(0,Math.min(100,parseInt(c.progress)||0));
    const creators = parseInt(c.creators)||0;
    return `<div class="row"><span class="dot brand"></span><div class="r-main"><div class="r-title">${esc(c.name)}</div>
      <div class="r-sub">${esc(c.brand)||"—"} · ${esc(c.type)||"—"} · ${creators} creators</div></div>
      <span class="tag good">${prog}%</span></div>`;
  }).join("");
}

/* ================= DREAM PLAN (Growth) ================= */
const DREAM_TASKS = [
  "Connect your Instagram & complete your media kit",
  "Post 3 reels this week",
  "Reply to 20 comments to lift engagement",
  "Apply to 2 open campaigns",
  "Reach out to 5 brands for collaborations",
  "Hit a 3%+ engagement rate",
  "Land your first barter or paid deal"
];

function renderGrowth(){
  let html = pageHead("Creator Growth","Pick your dream — then follow the roadmap to get there.");
  html += `<div id="growthBody"><div class="card"><div class="muted">Loading…</div></div></div>`;
  return html;
}

async function loadGrowth(){
  const wrap = document.getElementById("growthBody");
  if(!wrap) return;
  if(!window.sb){ wrap.innerHTML = `<div class="card"><div class="muted">Connect the database.</div></div>`; return; }
  const { data } = await sb.from("dream_plans").select("*").eq("creator_email",(window.Auth&&Auth.profile&&Auth.profile.email)||"").order("created_at",{ascending:false}).limit(1);
  const plan = (data && data[0]) || null;
  if(!plan){
    wrap.innerHTML = `<div class="card"><h3>Choose your dream 🎯</h3>
      <p class="muted" style="margin-bottom:14px">What do you want to achieve as a creator? Pick one and we'll build your personalized roadmap.</p>
      <div class="dream-grid">${DREAM_GOALS.map(g=>`<button class="dream-opt" data-goal="${esc(g)}">${esc(g)}</button>`).join("")}</div></div>`;
    wrap.querySelectorAll(".dream-opt").forEach(b=>b.onclick=()=>createDream(b.dataset.goal));
    return;
  }
  const tasks = Array.isArray(plan.tasks)?plan.tasks:[];
  const score = dreamScore(tasks);
  const nextTask = tasks.find(x=>!x.done);
  wrap.innerHTML = `<div class="card dream-hero">
      <div class="dream-eyebrow">Your dream</div>
      <h2 style="margin:2px 0 12px">${esc(plan.goal)}</h2>
      <div class="bar"><span style="width:${score}%"></span></div>
      <div class="dream-meta"><span><b>${score}%</b> there</span><span>${tasks.filter(x=>x.done).length}/${tasks.length} milestones</span>${nextTask?`<span>Next: ${esc(nextTask.t)}</span>`:`<span>🎉 Dream complete!</span>`}</div>
    </div>
    <div class="card" style="margin-top:16px"><h3>Your roadmap</h3>
      <div class="list">${tasks.map((x,i)=>`<div class="row dream-task" data-i="${i}" style="cursor:pointer">
        <span class="dot ${x.done?'good':'warn'}"></span>
        <div class="r-main"><div class="r-title" style="${x.done?'text-decoration:line-through;opacity:.6':''}">${esc(x.t)}</div></div>
        <span class="tag ${x.done?'good':'brand'}">${x.done?'✓ Done':'Mark done'}</span></div>`).join("")}</div>
      <div style="margin-top:14px"><button class="mini-btn ghost" id="changeDream">Change dream</button></div>
    </div>`;
  const local = tasks.map(x=>({...x}));
  wrap.querySelectorAll(".dream-task").forEach(row=>{
    row.onclick = async ()=>{
      const i = parseInt(row.dataset.i);
      local[i].done = !local[i].done;
      await sb.from("dream_plans").update({ tasks: local, score: dreamScore(local) }).eq("id", plan.id);
      loadGrowth();
    };
  });
  const cd = document.getElementById("changeDream");
  if(cd) cd.onclick = async ()=>{ if(confirm("Pick a different dream? This resets your roadmap.")){ await sb.from("dream_plans").delete().eq("id", plan.id); loadGrowth(); } };
}

async function createDream(goal){
  if(!window.sb) return;
  const row = { goal, score:0, tasks: DREAM_TASKS.map(t=>({t, done:false})) };
  if(window.Auth && Auth.profile){ row.org_id = Auth.profile.org_id; row.creator_email = Auth.profile.email; }
  const { error } = await sb.from("dream_plans").insert(row);
  if(!error) loadGrowth();
}

function renderPlaceholder(title,sub){
  return pageHead(title,sub)+`<div class="card"><div class="ai-suggest"><span class="spark">🔒</span>
    <div class="s-body"><b>${title} turns on with your database</b><p>The full ${title} module (real data, saving, permissions) activates the moment Supabase is connected. The interface is ready.</p></div></div></div>`;
}

// Generic: update a row's status/stage then re-run a loader.
async function updateStatus(table, id, patch, cb){
  if(!window.sb) return;
  if(await checkedWrite(sb.from(table).update(patch).eq("id", id), "update this item") && cb) cb();
}

// Run an update query and alert on failure. An RLS-blocked UPDATE returns no error but zero rows, so .select() and check the rows.
async function checkedWrite(query, what){
  const { data, error } = await query.select();
  if(error){ alert("Couldn't "+what+": "+error.message); return false; }
  if(!data || !data.length){ alert("Couldn't "+what+": you don't have permission to change this."); return false; }
  return true;
}

/* ================= CELEBRITY STORY ENGINE (story_deals) ================= */
const STORY_STAGES = ["Requested","Negotiating","Live","Delivered"];

function renderCelebrity(){
  let html = pageHead("Celebrity Stories","Celebrity barter & paid deals — request to proof.",`<span id="addStoryBtn">+ New Story Deal</span>`);
  html += campaignSectionHtml("celebrity");
  html += `<div class="card" style="margin-top:16px"><h3>Story deal pipeline</h3>
    <div class="kanban" id="storyKanban"><div class="muted" style="padding:12px">Loading…</div></div></div>`;
  return html;
}
function storyCardHtml(d){
  const stage = STORY_STAGES.includes(d.stage) ? d.stage : "Requested";
  const idx = STORY_STAGES.indexOf(stage);
  const next = idx < STORY_STAGES.length-1 ? STORY_STAGES[idx+1] : null;
  const sub = [d.brand, d.fee?("fee ₹"+fmtNum(d.fee)):null].filter(Boolean).join(" · ");
  return `<div class="kan-card"><div class="kc-name">${esc(d.celebrity||"Celebrity")}</div>
    <div class="kc-sub">${esc(sub)||"—"}</div>
    ${d.proof_url?`<a class="kc-sub" href="${esc(safeUrl(d.proof_url))}" target="_blank" rel="noopener">View proof ↗</a>`:""}
    ${next?`<button class="mini-btn" data-adv="${esc(d.id)}" data-next="${esc(next)}" style="margin-top:8px">Move to ${esc(next)} →</button>`:""}</div>`;
}
async function loadStories(){
  const wrap = document.getElementById("storyKanban");
  if(!wrap) return;
  if(!window.sb){ wrap.innerHTML = `<div class="muted" style="padding:12px">Connect the database.</div>`; return; }
  const { data, error } = await sb.from("story_deals").select("*").order("created_at",{ascending:false});
  if(error){ wrap.innerHTML = `<div class="muted" style="padding:12px">Couldn't load: ${esc(error.message)}</div>`; return; }
  const items = data||[]; const by={}; STORY_STAGES.forEach(s=>by[s]=[]);
  items.forEach(it=>{ const s = STORY_STAGES.includes(it.stage)?it.stage:"Requested"; by[s].push(it); });
  wrap.innerHTML = STORY_STAGES.map(s=>`<div class="kan-col"><h4>${s}<span>${by[s].length}</span></h4>
    ${by[s].map(storyCardHtml).join("") || `<div class="muted" style="font-size:12px;padding:6px 2px">—</div>`}</div>`).join("");
  wrap.querySelectorAll("button[data-adv]").forEach(b=>b.onclick=()=>updateStatus("story_deals", b.dataset.adv, {stage:b.dataset.next}, loadStories));
}
function openStoryModal(){
  let m = document.getElementById("storyModal");
  if(!m){
    m = el("div","modal-overlay"); m.id="storyModal";
    m.innerHTML = `<div class="modal"><div class="modal-head"><strong>New Story Deal</strong><button class="icon-btn" id="smClose">✕</button></div>
      <form id="storyForm" class="modal-form">
        <div class="mf-row"><label>Celebrity<input name="celebrity" required placeholder="Ranveer Singh"></label>
        <label>Brand<input name="brand" placeholder="boAt"></label></div>
        <div class="mf-row"><label>Manager<input name="manager" placeholder="Talent agency"></label>
        <label>Stage<select name="stage">${STORY_STAGES.map(s=>`<option>${s}</option>`).join("")}</select></label></div>
        <div class="mf-row"><label>Deal Value (₹)<input name="value" type="number" min="0" placeholder="500000"></label>
        <label>Our Fee (₹)<input name="fee" type="number" min="0" placeholder="75000"></label></div>
        <label>Proof URL<input name="proof_url" placeholder="https://instagram.com/p/…"></label>
        <div class="auth-err" id="smErr"></div>
        <button class="btn" type="submit">Add Deal</button></form></div>`;
    document.body.appendChild(m);
  }
  m.classList.add("open");
  m.onclick = e=>{ if(e.target.id==="storyModal") m.classList.remove("open"); };
  document.getElementById("smClose").onclick = ()=> m.classList.remove("open");
  document.getElementById("storyForm").onsubmit = async e=>{
    e.preventDefault();
    const f=new FormData(e.target), err=document.getElementById("smErr"), btn=e.target.querySelector("button[type=submit]");
    err.textContent=""; btn.disabled=true; btn.textContent="Saving…";
    const row={ celebrity:f.get("celebrity"), brand:f.get("brand"), manager:f.get("manager"),
      stage:f.get("stage")||"Requested", value:parseFloat(f.get("value"))||null, fee:parseFloat(f.get("fee"))||null, proof_url:f.get("proof_url")||null };
    if(window.Auth&&Auth.profile){ row.org_name=Auth.profile.org; row.org_id=Auth.profile.org_id; }
    try{ if(!window.sb) throw new Error("Database not connected."); const { error }=await sb.from("story_deals").insert(row); if(error) throw error;
      m.classList.remove("open"); await loadStories();
    }catch(ex){ err.textContent=ex.message||"Couldn't save."; btn.disabled=false; btn.textContent="Add Deal"; }
  };
}

/* ================= APPROVALS (campaigns + applications) ================= */
/* ---------- Approvals: every decision waiting on you, in one live place ----------
 * Super Admin: agency / brand signups + every workspace's campaigns and creator applications.
 * Agency & brand: their own campaigns and the creators who applied to them. */
let _apvTimer = null, _apvSig = "";
function renderApprovals(){
  return pageHead("Approvals","Everything waiting on your decision — signups, campaigns and creators, live.")
    + `<div id="apvBody">${skel("list",4)}</div>`;
}
function apvProcessHtml(list){
  const K = { blocked:["⛔","Blocked — call the creator"], review:["🎬","Video to review"], ship:["🚚","Ship the product — add courier"], deliver:["📦","In transit — mark delivered"],
              overdue:["⏰","Video overdue"], contract:["📜","Contract didn't go out"], unsigned:["✍️","Contract unsigned 3+ days"] };
  return `<div class="card"><h3 style="margin-top:0">🔁 Barter process — waiting on you</h3><div class="list">${list.map(x=>{
    const c = x.creator||{}, k = K[x.kind]||["•",x.kind], camp = x.legacy_campaign_id||x.campaign_id;
    return `<div class="row">${c.profile_picture_url?`<img class="ap-pic" src="${esc(safeUrl(c.profile_picture_url))}" alt="" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">`:`<span class="avatar">${esc((c.username||"?").slice(0,2).toUpperCase())}</span>`}
      <div class="r-main"><div class="r-title">${k[0]} ${esc(k[1])} · ${c.username?"@"+esc(c.username):esc(c.name||"Creator")}</div>
        <div class="r-sub">${esc(x.campaign_name||"")}${x.brand?` · ${esc(x.brand)}`:""}${x.org_name&&window.__isAdmin?` · ${esc(x.org_name)}`:""}${x.due_on?` · due ${esc(fmtDate(x.due_on))}`:""}</div></div>
      <span style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
        ${x.kind==="review"&&x.video_url?`<a class="mini-btn ghost" href="${esc(safeUrl(x.video_url))}" target="_blank" rel="noopener">▶ Watch</a><button class="mini-btn" data-apvok="${esc(x.participation_id)}">✅ Approve video</button>`:""}
        ${x.kind==="deliver"?`<button class="mini-btn" data-apvdel="${esc(x.participation_id)}">📦 Mark delivered</button>`:""}
        ${x.phone?`<a class="mini-btn ghost" href="tel:${esc(x.phone)}">📞 ${esc(x.phone)}</a>`:""}
        <button class="mini-btn ghost" data-apvopen="${esc(camp)}" data-apvname="${esc(x.campaign_name||"")}" data-apvpart="${esc(x.participation_id)}">Open</button></span></div>`; }).join("")}</div></div>`;
}
let _apvCamp = "";
async function loadApprovals(silent){
  const body = document.getElementById("apvBody"); if(!body || !window.sb) return;
  const [ar, pr] = await Promise.all([
    sb.schema("api").rpc("approvals_inbox").then(r=>r, e=>({error:e})),
    sb.schema("api").rpc("process_inbox").then(r=>r, ()=>({data:[]}))]);
  const { data, error } = ar;
  if(error){ if(!silent) body.innerHTML = `<div class="card"><div class="muted">${esc(error.message||error)}</div></div>`; return; }
  const d = data||{}, proc = pr.data||[], sig = JSON.stringify([d, proc]); if(silent && sig===_apvSig) return; _apvSig = sig;
  const signups = d.signups||[], camps = d.campaigns||[];
  // filter creators + barter steps by campaign
  const cname = x => String(x.campaign_name||x.campaign||"").trim();
  const allC = [...new Set([...(d.applicants||[]), ...(d.marketplace||[]), ...(pr.data||[])].map(cname).filter(Boolean))].sort((a,b)=> a.localeCompare(b));
  if(_apvCamp && !allC.includes(_apvCamp)) _apvCamp = "";
  const inC = x => !_apvCamp || cname(x) === _apvCamp;
  const apps = (d.applicants||[]).filter(inC), mk = (d.marketplace||[]).filter(inC), procF = proc.filter(inC);
  const cnt = n => [...(d.applicants||[]), ...(d.marketplace||[]), ...proc].filter(x=> cname(x)===n).length;
  const total = signups.length + camps.length + apps.length + mk.length + procF.length;
  pollNavCounts();
  const ago = t=>{ if(!t) return ""; const m=Math.round((Date.now()-new Date(t).getTime())/60000); return m<1?"just now":m<60?m+"m ago":m<1440?Math.round(m/60)+"h ago":Math.round(m/1440)+"d ago"; };
  const roleName = r=>({owner:"Agency Owner",brand:"Brand",manager:"Manager",corporate:"Corporate"}[r]||r);
  body.innerHTML = `<div class="rp-kpis">
      ${d.is_admin?`<div><b>${signups.length}</b>Account signups</div>`:""}
      <div><b>${camps.length}</b>Campaigns to approve</div>
      <div><b>${apps.length+mk.length}</b>Creators to decide</div>
      <div><b>${procF.length}</b>Barter steps on you</div>
      <div><b>${total}</b>Total waiting</div></div>
    ${allC.length ? `<div class="apv-filter"><label>Campaign <select id="apvCamp"><option value="">All campaigns (${(d.applicants||[]).length+(d.marketplace||[]).length+proc.length})</option>${allC.map(n=>`<option value="${esc(n)}"${_apvCamp===n?" selected":""}>${esc(n)} (${cnt(n)})</option>`).join("")}</select></label>
      ${_apvCamp?`<button class="mini-btn ghost" id="apvCampX">✕ Clear</button>`:""}</div>` : ""}
    ${total? "" : `<div class="card"><div class="muted" style="padding:8px">${_apvCamp ? "Nothing waiting on this campaign ✅" : "All clear — nothing waiting on you right now ✅"}</div></div>`}
    ${procF.length ? apvProcessHtml(procF) : ""}
    ${d.is_admin && signups.length ? `<div class="card"><h3 style="margin-top:0">🏢 Agency & brand signups</h3><div class="list">
      ${signups.map(x=>`<div class="row"><div class="r-main">
        <div class="r-title">${esc(x.name||x.email||"—")} <span class="tag">${esc(roleName(x.role))}</span>${x.org_name?` · ${esc(x.org_name)}`:""}</div>
        <div class="r-sub">${x.email?`📧 ${esc(x.email)} ${x.email_verified?'<span class="tag good">verified</span>':'<span class="tag warn">not verified</span>'}`:""}${x.whatsapp?` · 💬 ${esc(x.whatsapp)}`:""} · ${ago(x.created_at)}</div></div>
        <span style="display:flex;gap:6px"><button class="mini-btn" data-apvsign="${esc(x.id)}">Approve</button><button class="mini-btn ghost" data-apvsignno="${esc(x.id)}">Decline</button></span></div>`).join("")}
      </div></div>` : ""}
    ${camps.length ? `<div class="card" style="margin-top:14px"><h3 style="margin-top:0">📣 Campaigns awaiting approval</h3><div class="list">
      ${camps.map(c=>`<div class="row"><div class="r-main">
        <div class="r-title">${esc(c.name)} ${typeTag(c.campaign_type)}</div>
        <div class="r-sub">${esc([c.brand,c.org_name].filter(Boolean).join(" · "))}${c.budget?` · ₹${fmtNum(c.budget)}`:""}${c.start_date?` · starts ${esc(fmtDate(c.start_date))}`:""} · ${ago(c.created_at)}</div></div>
        <span style="display:flex;gap:6px"><button class="mini-btn" data-apvcamp="${esc(c.id)}">Approve</button><button class="mini-btn ghost" data-apvcampno="${esc(c.id)}">Send back</button>
        <button class="mini-btn ghost" data-apvinv="${esc(c.id)}" data-apvname="${esc(c.name)}">🎯 Invite</button></span></div>`).join("")}
      </div></div>` : ""}
    ${apps.length || mk.length ? `<div class="card" style="margin-top:14px"><h3 style="margin-top:0">🙋 Creators waiting on a decision</h3><div class="list" id="apvApplicants">
      ${apps.map(p=>applicantRowHtml(p, true)).join("")}
      ${mk.map(a=>`<div class="row"><span class="avatar">${esc((a.creator_name||"?").slice(0,2).toUpperCase())}</span>
        <div class="r-main"><div class="r-title">${esc(a.creator_name||"Creator")} <span class="muted" style="font-weight:400">→ ${esc(a.campaign_name||"")}${a.org_name?` · ${esc(a.org_name)}`:""}</span></div>
        <div class="r-sub">Marketplace application · ${ago(a.created_at)}</div></div>
        <span style="display:flex;gap:6px"><button class="mini-btn" data-apvmk="${esc(a.id)}">Approve</button><button class="mini-btn ghost" data-apvmkno="${esc(a.id)}">Decline</button></span></div>`).join("")}
      </div></div>` : ""}
    <div class="muted" style="font-size:12px;margin-top:12px">Live — refreshes every 20s. Everyone you approve or decline is told in the app, on WhatsApp and by email.</div>`;
  const again = ()=>{ _apvSig = ""; loadApprovals(true); };
  const cs = body.querySelector("#apvCamp"); if(cs) cs.onchange = ()=>{ _apvCamp = cs.value; again(); };
  const cx = body.querySelector("#apvCampX"); if(cx) cx.onclick = ()=>{ _apvCamp = ""; again(); };
  // signups (Super Admin)
  body.querySelectorAll("[data-apvsign]").forEach(b=> b.onclick = async ()=>{
    b.disabled = true; b.textContent = "…";
    const { error } = await sb.rpc("set_member_status_v2", { p_id:b.dataset.apvsign, p_status:"active", p_reason:null });
    if(error){ alert(error.message); b.disabled=false; b.textContent="Approve"; return; } again();
  });
  body.querySelectorAll("[data-apvsignno]").forEach(b=> b.onclick = async ()=>{
    const reason = (prompt("Why are you declining this signup?\nThey are told this reason in the app, on WhatsApp and by email.")||"").trim();
    if(!reason) return;
    const { error } = await sb.rpc("set_member_status_v2", { p_id:b.dataset.apvsignno, p_status:"declined", p_reason:reason });
    if(error){ alert(error.message); return; } again();
  });
  // campaigns
  body.querySelectorAll("[data-apvcamp]").forEach(b=> b.onclick = async ()=>{
    b.disabled = true; b.textContent = "…";
    const { error } = await sb.schema("api").rpc("decide_campaign", { p_campaign:b.dataset.apvcamp, p_approve:true, p_reason:null });
    if(error){ alert(error.message); b.disabled=false; b.textContent="Approve"; return; }
    if(window.Tracker) Tracker.security("campaign_approved", { campaign_id:b.dataset.apvcamp });
    again();
  });
  body.querySelectorAll("[data-apvcampno]").forEach(b=> b.onclick = async ()=>{
    const reason = (prompt("Send this campaign back as a draft — what needs changing?")||"").trim();
    const { error } = await sb.schema("api").rpc("decide_campaign", { p_campaign:b.dataset.apvcampno, p_approve:false, p_reason:reason||null });
    if(error){ alert(error.message); return; } again();
  });
  body.querySelectorAll("[data-apvinv]").forEach(b=> b.onclick = ()=> openInvitePanel(b.dataset.apvinv, b.dataset.apvname));
  // barter process steps waiting on the team
  body.querySelectorAll("[data-apvopen]").forEach(b=> b.onclick = ()=> openBarterProcess(b.dataset.apvopen, b.dataset.apvname, b.dataset.apvpart));
  body.querySelectorAll("[data-apvok]").forEach(b=> b.onclick = async ()=>{
    b.disabled = true; b.textContent = "…";
    const { error } = await sb.schema("api").rpc("bp_review_video", { p_participation:b.dataset.apvok, p_approve:true, p_reason:null });
    if(error){ alert(error.message); b.disabled=false; b.textContent="✅ Approve video"; return; } again(); });
  body.querySelectorAll("[data-apvdel]").forEach(b=> b.onclick = async ()=>{
    if(!confirm("Mark the parcel as delivered? The video brief goes to the creator right away.")) return;
    b.disabled = true; b.textContent = "…";
    const { error } = await sb.schema("api").rpc("bp_mark_delivered", { p_participation:b.dataset.apvdel });
    if(error){ alert(error.message); b.disabled=false; b.textContent="📦 Mark delivered"; return; } again(); });
  // creators
  wireApplicantButtons(body, again);
  body.querySelectorAll("[data-apvmk]").forEach(b=> b.onclick = async ()=>{
    const { error } = await sb.rpc("decide_application", { p_id:b.dataset.apvmk, p_approve:true, p_reason_code:null, p_note:null });
    if(error) alert(error.message); again();
  });
  body.querySelectorAll("[data-apvmkno]").forEach(b=> b.onclick = ()=> declineLegacyApplication(b.dataset.apvmkno, again));
  clearInterval(_apvTimer);
  _apvTimer = setInterval(()=>{
    if(currentPage!=="approvals" || !document.getElementById("apvBody")){ clearInterval(_apvTimer); return; }
    if(document.visibilityState!=="visible" || document.querySelector(".modal-overlay.open") || document.getElementById("invPanel")) return;
    loadApprovals(true);
  }, 20000);
}

/* ================= AGENCY / BRAND: applicants, reasons, discovery, reports, super-admin campaigns ================= */
(function injectAgencyCss(){
  if(document.getElementById("agencyCss")) return;
  const st = document.createElement("style"); st.id = "agencyCss";
  st.textContent = `
  .cm-sec{font-weight:700;margin:14px 0 6px;font-size:13px;text-transform:uppercase;letter-spacing:.04em;opacity:.8}
  .cm-seg{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px}
  .cm-seg label{display:flex;align-items:center;gap:6px;padding:8px 14px;border:1px solid var(--line,#ddd);border-radius:999px;cursor:pointer;font-weight:600}
  .cm-seg label.act{background:var(--brand,#6c5ce7);color:#fff;border-color:transparent}
  .cm-seg input{display:none}
  .cm-chips{display:flex;flex-wrap:wrap;gap:6px 14px;margin:2px 0 10px}
  .cm-chips label{display:flex;align-items:center;gap:6px;font-weight:500}
  .cm-files{display:flex;flex-wrap:wrap;gap:6px;margin:-4px 0 8px}
  .cm-file{font-size:12px;padding:4px 8px;border:1px solid var(--line,#ddd);border-radius:8px;display:inline-flex;gap:6px;align-items:center}
  .cm-file.pend{opacity:.7}.cm-file button{border:0;background:none;cursor:pointer}
  .ap-pic{width:36px;height:36px;border-radius:50%;object-fit:cover;flex:none}
  .dc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px}
  .dc-card .dc-top{display:flex;gap:10px;align-items:center;margin-bottom:8px}
  .dc-card .dc-top img{width:52px;height:52px;border-radius:50%;object-fit:cover}
  .dc-stats{display:flex;gap:12px;font-size:12px;margin:6px 0}.dc-stats b{display:block;font-size:15px}
  .dc-tags{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}.dc-tags span{font-size:11px;padding:2px 7px;border-radius:999px;background:rgba(108,92,231,.1)}
  .dc-filters{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin-top:10px}
  .dc-filters label{font-size:12px;display:flex;flex-direction:column;gap:3px}
  .rp-kpis{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px;margin-bottom:14px}
  .rp-kpis div{padding:12px;border:1px solid var(--line,#eee);border-radius:12px}.rp-kpis b{display:block;font-size:20px}
  @media (max-width:640px){ .dc-grid{grid-template-columns:1fr} }`;
  document.head.appendChild(st);
})();

const APPLICANT_STAGE = { applied:["Applied","warn"], eligible:["Screened ✓","brand"], sent_to_brand:["Awaiting brand","warn"],
  brand_confirmed:["Approved","good"], ineligible:["Declined",""], brand_declined:["Declined",""], dropped:["Dropped",""], rejected:["Rejected",""] };
const APPLICANT_PENDING = ["applied","eligible","sent_to_brand"];

function typeTag(t){ const L={paid:"💰 Paid",barter:"🎁 Barter",barter_paid:"🎁 Barter + 💰 Paid"}; return t&&L[t]?`<span class="ci-type ci-type-${t}">${L[t]}</span>`:""; }
function applicantRowHtml(p, showCampaign){
  const cr = p.creator || {}, [lbl, cls] = APPLICANT_STAGE[p.stage] || [String(p.stage||"").replace(/_/g," "), "good"];
  const pic = cr.profile_picture_url ? `<img class="ap-pic" src="${esc(safeUrl(cr.profile_picture_url))}" alt="" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">`
                                     : `<span class="avatar">${esc((cr.username||"?").slice(0,2).toUpperCase())}</span>`;
  const bits = [cr.followers!=null?fmtNum(cr.followers)+" followers":"", cr.engagement!=null?cr.engagement+"% eng.":"", cr.city||"", (cr.categories||[]).slice(0,2).join(", "), cr.profile_pct!=null?"📝 profile "+cr.profile_pct+"%":""].filter(Boolean).join(" · ");
  return `<div class="row" data-pid="${esc(p.participation_id||"")}">${pic}
    <div class="r-main"><div class="r-title">${cr.username?`<a href="https://instagram.com/${encodeURIComponent(cr.username)}" target="_blank" rel="noopener">@${esc(cr.username)}</a>`:esc(cr.name||"Creator")}
      ${p.applied_profile && String(p.applied_profile).toLowerCase()!==String(cr.username||"").toLowerCase()?` <span class="tag" title="Applied with this profile">via <a href="https://instagram.com/${encodeURIComponent(p.applied_profile)}" target="_blank" rel="noopener">@${esc(p.applied_profile)}</a></span>`:""}
      ${showCampaign?`<span class="muted" style="font-weight:400"> → ${esc(p.campaign_name||"")}${p.org_name?` · ${esc(p.org_name)}`:""}</span>`:""} ${typeTag(p.campaign_type)}</div>
      <div class="r-sub">${esc(bits)||"Instagram not connected"}${p.reason && !APPLICANT_PENDING.includes(p.stage)?` · <i>${esc(p.reason)}</i>`:""}</div></div>
    ${APPLICANT_PENDING.includes(p.stage)
      ? `<span style="display:flex;gap:6px"><button class="mini-btn" data-papprove="${esc(p.participation_id)}">Approve</button><button class="mini-btn ghost" data-pdecline="${esc(p.participation_id)}">Decline</button></span>`
      : `<span class="tag ${cls}">${esc(lbl)}</span>`}</div>`;
}

function wireApplicantButtons(root, reload){
  root.querySelectorAll("[data-papprove]").forEach(b=> b.onclick = async ()=>{
    b.disabled = true; b.textContent = "…";
    const { error } = await sb.schema("api").rpc("org_decide_applicant", { p_participation:b.dataset.papprove, p_approve:true, p_reason_code:null, p_note:null });
    if(error){ alert(error.message); b.disabled=false; b.textContent="Approve"; return; }
    if(window.Tracker) Tracker.security("application_approve", { participation_id: b.dataset.papprove });
    reload && reload();
  });
  root.querySelectorAll("[data-pdecline]").forEach(b=> b.onclick = async ()=>{
    const pick = await openReasonModal("Why are you declining this creator?"); if(!pick) return;
    const { error } = await sb.schema("api").rpc("org_decide_applicant", { p_participation:b.dataset.pdecline, p_approve:false, p_reason_code:pick.code, p_note:pick.note||null });
    if(error){ alert(error.message); return; }
    if(window.Tracker) Tracker.security("application_decline", { participation_id: b.dataset.pdecline, reason: pick.code });
    reload && reload();
  });
}

/* ---------- Campaign delete: agency / brand request it, only the Super Admin deletes ---------- */
async function wireCampaignDelete(c){
  const btn = document.getElementById("wsDel"), note = document.getElementById("wsDelNote");
  if(!btn) return;
  const back = ()=>{ currentPage = window.__isAdmin ? "admin" : "campaigns"; if(window.__isAdmin) _adminTab = "campaigns"; renderShell(); };
  if(window.__isAdmin){ btn.onclick = ()=> openCampaignDeleteModal({ mode:"admin", campaign:c, done:back }); return; }
  const { data:r } = await sb.rpc("campaign_delete_status", { p_campaign:c.id }).then(x=>x, ()=>({data:null}));
  if(!document.body.contains(btn)) return;
  if(r && r.status==="pending"){
    btn.textContent = "⏳ Delete requested"; btn.title = "Waiting for the Super Admin";
    if(note) note.innerHTML = `<div class="cdel-note">🗑 You asked to delete this campaign on ${esc(new Date(r.created_at).toLocaleDateString("en-IN",{day:"numeric",month:"short"}))} — <i>${esc(r.reason||"")}</i>. It stays live until the Super Admin approves. <a href="#" id="wsDelCancel">Cancel request</a></div>`;
    const cx = document.getElementById("wsDelCancel");
    if(cx) cx.onclick = async e=>{ e.preventDefault(); await sb.rpc("cancel_campaign_delete_request", { p_campaign:c.id }); openCampaignWorkspace(c.id); };
    btn.onclick = ()=> alert("Your delete request is waiting for the Super Admin.");
    return;
  }
  if(r && r.status==="rejected" && note) note.innerHTML = `<div class="cdel-note warn">The Super Admin didn't approve deleting this campaign${r.decision_note?`: <i>${esc(r.decision_note)}</i>`:"."}</div>`;
  btn.onclick = ()=> openCampaignDeleteModal({ mode:"request", campaign:c, done:()=> openCampaignWorkspace(c.id) });
}

// mode: "request" (agency/brand → reason) · "admin" (Super Admin deletes now) · "decide" (Super Admin approves / rejects a request)
function openCampaignDeleteModal(o){
  const c = o.campaign || {}, req = o.request || null, name = c.name || (req && req.campaign_name) || "this campaign";
  let m = document.getElementById("cdelModal"); if(m) m.remove();
  m = el("div","modal-overlay open"); m.id = "cdelModal";
  const what = `<div class="cdel-what">This permanently removes <b>${esc(name)}</b> and everything in it — creators in the campaign, contracts, addresses, shipments, videos, posts, invites and unsent WhatsApp / email messages. Creator, brand and agency accounts are not touched. <b>It can't be undone.</b></div>`;
  let bodyHtml;
  if(o.mode==="request"){
    bodyHtml = `<p class="muted" style="margin:0 0 10px">Only the Geek Super Admin can delete a campaign. Tell them why — they'll approve or reply.</p>
      <label>Why should it be deleted?<textarea name="reason" rows="3" maxlength="500" required placeholder="e.g. Brand cancelled the campaign / created by mistake / duplicate"></textarea></label>
      <div class="auth-err" id="cdErr"></div><button class="btn" type="submit">Send delete request</button>`;
  } else if(o.mode==="admin"){
    bodyHtml = `${what}<label>Type the campaign name to confirm<input name="confirm" autocomplete="off" placeholder="${esc(name)}"></label>
      <label>Note <span class="muted" style="font-weight:400">(optional)</span><input name="note" maxlength="300"></label>
      <div class="auth-err" id="cdErr"></div><button class="btn cdel-danger" type="submit">🗑 Delete campaign permanently</button>`;
  } else {
    bodyHtml = `<div class="cdel-req"><b>${esc(req.requester||"Someone")}</b>${req.org_name?` · ${esc(req.org_name)}`:""} asked to delete <b>${esc(name)}</b>${req.brand?` (${esc(req.brand)})`:""}:<div class="cdel-reason">“${esc(req.reason||"")}”</div><span class="muted">${Number(req.creators||0)} creator${Number(req.creators)===1?"":"s"} in this campaign</span></div>
      ${what}<label>Note to them <span class="muted" style="font-weight:400">(optional — shown if you reject)</span><input name="note" maxlength="300"></label>
      <label>To approve, type the campaign name<input name="confirm" autocomplete="off" placeholder="${esc(name)}"></label>
      <div class="auth-err" id="cdErr"></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn cdel-danger" type="submit">✓ Approve & delete</button><button class="btn ghost" type="button" id="cdReject">✕ Reject request</button></div>`;
  }
  m.innerHTML = `<div class="modal"><div class="modal-head"><strong>${o.mode==="request"?"Request campaign delete":"Delete campaign"}</strong><button class="icon-btn" id="cdClose">✕</button></div>
    <form id="cdForm" class="modal-form">${bodyHtml}</form></div>`;
  document.body.appendChild(m);
  const close = ()=> m.remove();
  m.querySelector("#cdClose").onclick = close;
  m.onclick = e=>{ if(e.target===m) close(); };
  const f = m.querySelector("#cdForm"), err = m.querySelector("#cdErr");
  const same = v => String(v||"").trim().toLowerCase() === String(name).trim().toLowerCase();
  const run = async (fn, args, okMsg)=>{
    const b = f.querySelector("button[type=submit]"); b.disabled = true; err.textContent = "";
    const { error } = await sb.rpc(fn, args);
    if(error){ err.textContent = error.message; b.disabled = false; return; }
    close(); if(okMsg) alert(okMsg); o.done && o.done();
  };
  const rj = m.querySelector("#cdReject");
  if(rj) rj.onclick = async ()=>{ rj.disabled = true;
    const { error } = await sb.rpc("admin_decide_campaign_delete", { p_request:req.id, p_approve:false, p_note:(f.note.value||"").trim()||null });
    if(error){ err.textContent = error.message; rj.disabled = false; return; } close(); o.done && o.done(); };
  f.onsubmit = e=>{ e.preventDefault();
    if(o.mode==="request") return run("request_campaign_delete", { p_campaign:c.id, p_reason:(f.reason.value||"").trim() }, "Request sent — the Super Admin will review it.");
    if(!same(f.confirm.value)){ err.textContent = `Type “${name}” exactly to confirm.`; return; }
    if(o.mode==="admin") return run("admin_delete_campaign", { p_campaign:c.id, p_note:(f.note.value||"").trim()||null }, "Campaign deleted.");
    return run("admin_decide_campaign_delete", { p_request:req.id, p_approve:true, p_note:(f.note.value||"").trim()||null }, "Approved — campaign deleted.");
  };
  setTimeout(()=>{ const i = f.querySelector("textarea,input"); if(i) i.focus(); }, 30);
}

// Super Admin: pending delete requests (shown on top of All campaigns)
async function adminDeleteRequestsHtml(){
  const { data, error } = await sb.rpc("admin_campaign_delete_requests", { p_status:"pending" }).then(r=>r, e=>({error:e}));
  if(error || !Array.isArray(data) || !data.length) return { html:"", list:[] };
  return { list:data, html:`<div class="card cdel-card"><h3 style="margin:0 0 8px">🗑 Delete requests <span class="tag warn">${data.length}</span></h3>
    <div class="list">${data.map((r,i)=>`<div class="row"><div class="r-main"><div class="r-title">${esc(r.campaign_name||"Campaign")}${r.brand?` · ${esc(r.brand)}`:""}${r.still_exists?"":` <span class="tag">already gone</span>`}</div>
      <div class="r-sub">${esc(r.requester||"")}${r.org_name?` · ${esc(r.org_name)}`:""} · ${esc(new Date(r.created_at).toLocaleString("en-IN",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}))} · ${Number(r.creators||0)} creators — “${esc(r.reason||"")}”</div></div>
      <button class="mini-btn" data-cdreview="${i}">Review</button></div>`).join("")}</div></div>` };
}

async function declineLegacyApplication(id, reload){
  const pick = await openReasonModal("Why are you declining this application?"); if(!pick) return;
  const { error } = await sb.rpc("decide_application", { p_id:id, p_approve:false, p_reason_code:pick.code, p_note:pick.note||null });
  if(error){ alert("Couldn't decline: "+error.message); return; }
  reload && reload();
}

let _rejectReasons = null;
async function rejectionReasons(){
  if(_rejectReasons) return _rejectReasons;
  const { data } = await sb.schema("api").rpc("rejection_reasons").then(r=>r, ()=>({data:null}));
  _rejectReasons = (Array.isArray(data) && data.length) ? data : [{code:"other",label:"Other"}];
  return _rejectReasons;
}
// Structured reason (feeds matching / ML) + optional note. Resolves {code, note} or null if cancelled.
function openReasonModal(title){
  return new Promise(async resolve=>{
    const reasons = await rejectionReasons();
    let m = document.getElementById("reasonModal"); if(m) m.remove();
    m = el("div","modal-overlay"); m.id = "reasonModal";
    m.innerHTML = `<div class="modal"><div class="modal-head"><strong>${esc(title||"Reason")}</strong><button class="icon-btn" id="rmClose">✕</button></div>
      <form id="reasonForm" class="modal-form">
        <label>Reason<select name="code" required><option value="">Pick a reason…</option>${reasons.map(r=>`<option value="${esc(r.code)}">${esc(r.label)}</option>`).join("")}</select></label>
        <label>Note <span class="muted" style="font-weight:400">(optional — helps us match better next time)</span><textarea name="note" rows="2" maxlength="500"></textarea></label>
        <div class="auth-err" id="rmErr"></div>
        <button class="btn" type="submit">Decline</button></form></div>`;
    document.body.appendChild(m); m.classList.add("open");
    const done = v=>{ m.remove(); resolve(v); };
    document.getElementById("rmClose").onclick = ()=> done(null);
    m.onclick = e=>{ if(e.target.id==="reasonModal") done(null); };
    document.getElementById("reasonForm").onsubmit = e=>{
      e.preventDefault(); const f = new FormData(e.target);
      if(!f.get("code")){ document.getElementById("rmErr").textContent = "Pick a reason."; return; }
      done({ code:f.get("code"), note:String(f.get("note")||"").trim() });
    };
  });
}
window.openReasonModal = openReasonModal;

function idealProfileHtml(ip){
  if(!ip || typeof ip!=="object" || !Object.keys(ip).length) return "";
  const rows = [
    ["Followers", (ip.min_followers!=null||ip.max_followers!=null) ? `${ip.min_followers!=null?fmtNum(ip.min_followers):"any"} – ${ip.max_followers!=null?fmtNum(ip.max_followers):"any"}` : ""],
    ["Location", (ip.locations||[]).join(", ")], ["Gender", ip.gender||""], ["Category", (ip.categories||[]).join(", ")],
    ["Min engagement", ip.min_engagement!=null?ip.min_engagement+"%":""], ["Audience", ip.audience_notes||""]].filter(r=>r[1]);
  return `<div class="cd-block"><div class="cd-l">Ideal influencer</div><div class="cd-body">${rows.map(r=>`<div><b>${esc(r[0])}:</b> ${esc(r[1])}</div>`).join("")}
    ${ip.min_followers!=null||(ip.locations||[]).length||(ip.categories||[]).length?`<button class="mini-btn" style="margin-top:8px" id="wsFindCreators">🔎 Find matching creators</button>`:""}</div></div>`;
}
document.addEventListener("click", e=>{
  if(e.target && e.target.id==="wsFindCreators" && _wsCampaign){
    const ip = _wsCampaign.ideal_profile || {};
    _discoverPreset = { min_followers: ip.min_followers ?? "", max_followers: ip.max_followers ?? "", location: (ip.locations||[])[0]||"",
      gender: ip.gender||"", category: (ip.categories||[])[0]||"", min_engagement: ip.min_engagement ?? "" };
    currentPage = "discover"; renderShell();
  }
});

/* ---------- Discovery: search creators by #hashtag, keyword and filters ---------- */
let _discoverPreset = null;
/* ---------- Discovery: creators already on Geek OS, and creators found on Instagram ---------- */
let _dcTab = "platform";
function renderDiscover(){
  return pageHead("Creator search","Every creator we know — on Geek OS and on Instagram. Filter by category, location, size and engagement, then invite.")
    + `<div class="dx-tools" id="dxTools"></div><div id="dxIg" style="margin-bottom:12px"></div><div id="csRoot"></div><div id="dxToolBody" style="display:none"></div>`;
}
/* ================= Discovery → Instagram tools (official Meta APIs, through the Facebook-connected Instagram) =================
 *   #️⃣ Hashtag search   — top + recent public posts for any hashtag / keyword: image or video, caption, likes, comments, link
 *   🔎 Business discovery — any public Business / Creator account by username: photo, bio, followers, following, posts, and
 *                           their latest posts with likes, comments, captions, video and link                                   */
let _dxTool = "search", _dxHash = { q:"", data:null, busy:false }, _dxBiz = { q:"", data:null, busy:false }, _dxConn = null;
async function dxConnLine(){
  if(_dxConn === null){
    const { data } = await sb.rpc("my_discovery_connection").then(r=>r, ()=>({ data:null }));
    _dxConn = data || {};
  }
  const fb = _dxConn.facebook;
  return fb && fb.ig_username ? `<span class="igt-acct">📸 Searching with <b>@${esc(fb.ig_username)}</b>${fb.page_name?` · Page: ${esc(fb.page_name)}`:""}${fb.discovery_ok?' <span class="tag good">on</span>':' <span class="tag warn">not working yet</span>'}</span>`
    : _dxConn.shared ? `<span class="igt-acct">📸 Searching with the Geek team's Instagram</span>` : `<span class="igt-acct off">📸 Instagram search isn't switched on yet</span>`;
}
function igtMediaCard(m){
  const vid = m.media_type==="VIDEO" || m.kid_type==="VIDEO";
  const src = m.media_url ? safeUrl(m.media_url) : "", thumb = m.thumbnail_url ? safeUrl(m.thumbnail_url) : "";
  const when = m.timestamp ? (()=>{ const d = Math.round((Date.now()-new Date(m.timestamp).getTime())/86400000); return d<1?"today":d<7?d+"d ago":d<60?Math.round(d/7)+"w ago":Math.round(d/30)+"mo ago"; })() : "";
  const media = !src && !thumb ? `<div class="igt-noimg">${vid?"▶ Reel":"📷 Post"}<span>preview not shared by Instagram</span></div>`
    : vid ? `<video src="${esc(src)}"${thumb?` poster="${esc(thumb)}"`:""} controls preload="metadata" playsinline muted></video>`
          : `<img src="${esc(src||thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'igt-noimg',textContent:'📷 Post'}))">`;
  return `<div class="igt-card"><div class="igt-media">${media}
      ${m.caption?`<div class="igt-cap">${esc(String(m.caption).slice(0,140))}</div>`:""}${vid?`<span class="igt-kind">▶ Reel</span>`:m.media_type==="CAROUSEL_ALBUM"?`<span class="igt-kind">▦ Album</span>`:""}</div>
    <div class="igt-stats"><span title="Likes">❤ ${m.like_count!=null?fmtNum(m.like_count):"—"}</span><span title="Comments">💬 ${m.comments_count!=null?fmtNum(m.comments_count):"—"}</span>
      ${m.permalink?`<a href="${esc(safeUrl(m.permalink))}" target="_blank" rel="noopener" title="Open on Instagram">${esc(when)||"Open"} ↗</a>`:""}</div></div>`;
}
function igtNeedsFb(msg){
  const fb = /Facebook|switches on|Super Admin/i.test(msg||"");
  return `<div class="igt-msg">${esc(msg||"Couldn't reach Instagram.")}${fb && window.__isAdmin ? `<div style="margin-top:8px"><button class="btn sm" data-fbsearch2>🔎 Connect Facebook now</button></div>` : ""}</div>`;
}
async function renderDxTools(){
  const bar = document.getElementById("dxTools"); if(!bar) return;
  bar.innerHTML = [["search","🔎 Creator search"],["hashtag","#️⃣ Hashtag search"],["business","📇 Business discovery"]]
    .map(([k,l])=>`<button class="${_dxTool===k?"act":""}" data-dxtool="${k}">${l}</button>`).join("");
  bar.querySelectorAll("[data-dxtool]").forEach(b=> b.onclick = ()=>{ _dxTool = b.dataset.dxtool; renderDxTools(); });
  const cs = document.getElementById("csRoot"), ig = document.getElementById("dxIg"), tb = document.getElementById("dxToolBody");
  if(cs) cs.style.display = _dxTool==="search" ? "" : "none";
  if(ig) ig.style.display = _dxTool==="search" ? "" : "none";
  if(!tb) return;
  tb.style.display = _dxTool==="search" ? "none" : "";
  if(_dxTool==="search") return;
  const conn = await dxConnLine();
  if(_dxTool==="hashtag"){
    const d = _dxHash.data;
    tb.innerHTML = `<div class="card igt-head"><div class="igt-title"><h3>#️⃣ Hashtag search</h3>${conn}</div>
        <p class="muted">Type a hashtag or keyword — see the <b>top</b> and <b>most recent</b> public posts using it on Instagram, with likes, comments and the post itself.</p>
        <form class="igt-form" id="igtHashForm"><span class="igt-pre">#</span><input id="igtHashQ" placeholder="e.g. ipl, delhifoodblogger, skincare" value="${esc(_dxHash.q)}" autocomplete="off"><button class="btn" type="submit"${_dxHash.busy?" disabled":""}>${_dxHash.busy?"Searching…":"🔎 Search"}</button></form>
        <div class="igt-note muted">Meta allows 30 different hashtags per 7 days for one Instagram account — searching the same hashtag again is free.</div></div>
      <div id="igtHashOut">${_dxHash.busy ? skel("cards",4) : !d ? "" : d.error ? igtNeedsFb(d.error) : `
        <div class="igt-band">#${esc(d.tag)}</div>
        ${(d.handles||[]).length?`<div class="card igt-handles"><b>Accounts tagged in these posts</b><div>${d.handles.slice(0,30).map(h=>`<button class="cs-chip" data-igtbiz="${esc(h)}">@${esc(h)}</button>`).join("")}</div></div>`:""}
        <div class="igt-sec"><span class="igt-bar"></span>Top media <span class="muted">${(d.posts||[]).length}</span></div>
        <div class="igt-grid">${(d.posts||[]).map(igtMediaCard).join("") || `<div class="muted">No top posts.</div>`}</div>
        ${d.recent ? `<div class="igt-sec"><span class="igt-bar"></span>Recent media <span class="muted">${d.recent.length}</span></div>
        <div class="igt-grid">${d.recent.map(igtMediaCard).join("") || `<div class="muted">No recent posts.</div>`}</div>` : ""}
        <div class="muted igt-foot">Instagram doesn't say who posted a hashtag post — open a post to see the creator, or tap an @account above to see their full profile.</div>`}</div>`;
    const f = document.getElementById("igtHashForm");
    f.onsubmit = async e=>{ e.preventDefault(); const q = document.getElementById("igtHashQ").value.trim().replace(/^#/,"").replace(/\s+/g,"").toLowerCase();
      if(!/^[\p{L}\p{N}_]{2,60}$/u.test(q)){ gateToast("Type a hashtag — letters, numbers or _ only."); return; }
      _dxHash = { q, data:null, busy:true }; renderDxTools();
      const { data, error } = await sb.functions.invoke("ig-discover", { body:{ action:"hashtag", tag:q, edge:"both" } }).then(r=>r, e=>({error:e}));
      _dxHash.busy = false;
      _dxHash.data = (data && !data.error) ? data : { error: (data && data.error) || (error && (typeof fnError==="function" ? await fnError(error) : error.message)) || "Couldn't reach Instagram." };
      if(_dxTool==="hashtag") renderDxTools(); };
    tb.querySelectorAll("[data-igtbiz]").forEach(b=> b.onclick = ()=>{ _dxTool = "business"; _dxBiz.q = b.dataset.igtbiz; renderDxTools().then(()=>{ const ff = document.getElementById("igtBizForm"); if(ff) ff.requestSubmit(); }); });
  } else {
    const d = _dxBiz.data, P = d && d.profile, posts = (d && d.posts) || [];
    const eng = P && P.followers ? Math.round(1000*((Number(P.avg_likes)||0)+(Number(P.avg_comments)||0))/P.followers)/10 : null;
    tb.innerHTML = `<div class="card igt-head"><div class="igt-title"><h3>📇 Instagram Business Discovery</h3>${conn}</div>
        <p class="muted">Type any public <b>Business or Creator</b> account's username — see their photo, bio, followers, following, posts and their latest posts.</p>
        <form class="igt-form" id="igtBizForm"><span class="igt-pre">@</span><input id="igtBizQ" placeholder="e.g. virat.kohli" value="${esc(_dxBiz.q)}" autocomplete="off"><button class="btn" type="submit"${_dxBiz.busy?" disabled":""}>${_dxBiz.busy?"Looking up…":"🔎 Search"}</button></form></div>
      <div id="igtBizOut">${_dxBiz.busy ? skel("cards",4) : !d ? "" : d.error ? igtNeedsFb(d.error) : `
        <div class="card igt-prof"><div class="igt-prof-band"></div>
          <div class="igt-prof-top"><span class="cs-ring igt-prof-pic">${P.profile_picture_url?`<img src="${esc(safeUrl(P.profile_picture_url))}" alt="" referrerpolicy="no-referrer">`:`<span class="avatar">${esc(String(P.username||P.handle||"?").slice(0,2).toUpperCase())}</span>`}</span>
            <div class="igt-prof-id"><h3>${esc(P.name||P.username||P.handle)}</h3><a href="https://instagram.com/${encodeURIComponent(P.username||P.handle)}" target="_blank" rel="noopener">@${esc(P.username||P.handle)} ↗</a>
              ${P.bio?`<div class="igt-bio">${esc(P.bio).replace(/\n/g,"<br>")}</div>`:""}${P.website?`<a class="igt-web" href="${esc(safeUrl(P.website))}" target="_blank" rel="noopener">🔗 ${esc(String(P.website).replace(/^https?:\/\//,""))}</a>`:""}</div>
            <div class="igt-prof-acts"><button class="btn sm" data-igtinv="${esc(P.username||P.handle)}">🎯 Invite to a campaign</button><a class="btn sm ghost" href="https://ig.me/m/${encodeURIComponent(P.username||P.handle)}" target="_blank" rel="noopener">💬 DM</a></div></div>
          <div class="igt-prof-stats"><div><b>${P.followers!=null?fmtNum(P.followers):"—"}</b><span>Followers</span></div><div><b>${P.follows!=null?fmtNum(P.follows):"—"}</b><span>Following</span></div>
            <div><b>${P.media_count!=null?fmtNum(P.media_count):"—"}</b><span>Posts</span></div><div><b>${P.avg_likes!=null?fmtNum(Math.round(P.avg_likes)):"—"}</b><span>Avg likes</span></div>
            <div><b>${P.avg_comments!=null?fmtNum(Math.round(P.avg_comments)):"—"}</b><span>Avg comments</span></div><div><b>${eng!=null?eng+"%":"—"}</b><span>Engagement</span></div></div>
          <div class="muted igt-saved">✓ Saved to your creator search with these numbers.</div></div>
        <div class="igt-sec"><span class="igt-bar"></span>Media <span class="muted">latest ${posts.length}</span></div>
        <div class="igt-grid">${posts.map(igtMediaCard).join("") || `<div class="muted">No posts shared.</div>`}</div>`}</div>`;
    const f = document.getElementById("igtBizForm");
    f.onsubmit = async e=>{ e.preventDefault(); const q = document.getElementById("igtBizQ").value.trim().replace(/^https?:\/\/(www\.)?instagram\.com\//i,"").replace(/^@/,"").replace(/[/?].*$/,"").toLowerCase();
      if(!/^[a-z0-9._]{2,30}$/.test(q)){ gateToast("Type an Instagram username, e.g. virat.kohli"); return; }
      _dxBiz = { q, data:null, busy:true }; renderDxTools();
      const { data, error } = await sb.functions.invoke("ig-discover", { body:{ action:"lookup", username:q, media_limit:24 } }).then(r=>r, e=>({error:e}));
      _dxBiz.busy = false;
      _dxBiz.data = (data && data.profile) ? data : { error: (data && data.error) || (error && (typeof fnError==="function" ? await fnError(error) : error.message)) || "Couldn't reach Instagram." };
      if(_dxTool==="business") renderDxTools(); };
    tb.querySelectorAll("[data-igtinv]").forEach(b=> b.onclick = ()=> inviteFromDiscovery(b.dataset.igtinv));
  }
  tb.querySelectorAll("[data-fbsearch2]").forEach(b=> b.onclick = ()=>{ try{ localStorage.setItem("geekos_after_ig","discover"); }catch(e){} connectFacebookSearch(); });
}

// which Instagram this workspace discovers and DMs from
async function igConnectStrip(){
  const box = document.getElementById("dxIg"); if(!box) return;
  let row = null;
  try{
    const me = window.Auth && Auth.profile && Auth.profile.id;
    if(me){ const r = await sb.from("social_accounts").select("username,profile_picture_url").eq("platform","instagram").eq("member_id", me).limit(1); row = r.data && r.data[0]; }
  }catch(e){}
  box.innerHTML = row && row.username
    ? `<div class="dx-ig ok">📸 Discovering and messaging from <b>@${esc(row.username)}</b> <span class="muted">— creators who tag this account show up here first.</span></div>`
    : `<div class="dx-ig"><div>📸 <b>Connect your Instagram</b> <span class="muted">— then creators who tag you appear here automatically, and invites go out from your own handle.</span></div>
       <button class="btn sm" id="dxConnect">Connect Instagram</button></div>`;
  const c = document.getElementById("dxConnect");
  if(c) c.onclick = ()=>{ try{ localStorage.setItem("geekos_after_ig","discover"); }catch(e){} connectInstagram(); };
  // live Instagram numbers for any creator: one Facebook connection by the Super Admin powers it for everyone
  const { data:dc } = await sb.rpc("my_discovery_connection").then(r=>r, ()=>({data:null}));
  if(!box.isConnected || !dc) return;
  const fb = dc.facebook, live = (fb && fb.discovery_ok) || dc.shared;
  const isAdm = window.__isAdmin || await sb.rpc("is_platform_admin").then(r=> r.data===true, ()=>false);
  if(!box.isConnected) return;
  if(isAdm){
    box.insertAdjacentHTML("beforeend", fb
      ? `<div class="dx-ig ${fb.discovery_ok?"ok":""}" style="margin-top:8px">🔎 <b>Instagram search ${fb.discovery_ok?"is on":"isn't working yet"}</b> <span class="muted">— via @${esc(fb.ig_username||"")} (Page: ${esc(fb.page_name||"")})${fb.discovery_ok?" · every brand & agency can look up any public creator":` · ${esc(fb.discovery_error||"")}`}</span>
         <button class="btn sm ghost" id="dxFb">Reconnect</button></div>`
      : `<div class="dx-ig" style="margin-top:8px"><div>🔎 <b>Turn on Instagram search for everyone</b> <span class="muted">— Meta gives other creators' followers, posts &amp; engagement only through Facebook Login. Connect the Facebook Page linked to Geek's Instagram <b>once</b>; brands &amp; agencies keep connecting only Instagram.</span></div>
         <button class="btn sm" id="dxFb">Connect Facebook (one time)</button></div>`);
    const f = document.getElementById("dxFb"); if(f) f.onclick = connectFacebookSearch;
  } else if(!live){
    box.insertAdjacentHTML("beforeend", `<div class="muted" style="font-size:12.5px;margin-top:6px">Live Instagram numbers for creators who aren't on Geek OS switch on once the Geek team turns on Instagram search.</div>`);
  }
}
// Super Admin: Facebook Login → the Page + Instagram account used for business discovery (token stays on the server)
async function connectFacebookSearch(){
  const state = "facebook:" + Math.random().toString(36).slice(2);
  try{ localStorage.setItem("geekos_oauth_state", state); }catch(e){}
  const { data, error } = await sb.functions.invoke("fb-connect", { body:{ action:"url", redirect_uri: IG_REDIRECT, state } });
  if(error || !data || !data.url){ alert((data && data.error) || (error && await fnError(error)) || "Couldn't start Facebook connect."); return; }
  location.href = data.url;
}
async function finishFacebookSearch(code){
  const { data, error } = await sb.functions.invoke("fb-connect", { body:{ action:"exchange", code, redirect_uri: IG_REDIRECT } });
  const d = data || {};
  const msg = error ? await fnError(error) : d.error;
  currentPage = "discover";
  if(window.__osBooted && typeof renderShell==="function") renderShell();
  setTimeout(()=>{
    if(msg) alert("Instagram search: " + msg);
    else gateToast(d.discovery_ok ? `✅ Instagram search is on — via @${d.ig_username}. Any public creator can be looked up now.` : `Connected @${d.ig_username}, but Meta refused the lookup: ${d.discovery_error||""}`);
  }, 600);
}

async function loadDiscover(){
  const root = document.getElementById("csRoot"); if(!root) return;
  igConnectStrip();
  let state = _csMain || csNew();
  if(_discoverPreset){                   // "Find matching creators" from a campaign → its ideal profile as filters
    const p = _discoverPreset; _discoverPreset = null; state = csNew();
    const cats = [].concat(p.categories||[], p.category?[p.category]:[]).map(c=>String(c).toLowerCase());
    state.categories = CS_CATS.filter(c=> cats.some(x=> c.toLowerCase()===x || x.includes(c.toLowerCase())));
    state.location = p.location||""; state.gender = p.gender||"";
    if(p.min_followers!=="" && p.min_followers!=null || p.max_followers!=="" && p.max_followers!=null){ state.tier = "custom"; state.min = p.min_followers??""; state.max = p.max_followers??""; }
    const e = Number(p.min_engagement); if(e>0) state.min_engagement = String([1,2,3,5,8].filter(x=>x<=e).pop()||1);
  }
  _csMain = mountCreatorSearch(root, { state });
  renderDxTools();
}

/* ================= CREATOR SEARCH (Qoruz-style) — every creator we know, one search =================
 * On Geek OS + the discovery pool of Instagram creators who aren't on Geek OS yet. Category chips, location, follower
 * tier, engagement, gender, source, sort and real pagination. Used on the Discovery page and inside a campaign's
 * Invite panel (there, Invite goes straight to that campaign). */
const CS_CATS = ["Lifestyle","Fashion","Beauty","Food","Travel","Fitness","Health","Tech","Comedy","Entertainment","Parenting","Gaming","Finance","Business","Education","Music","Dance","Art","Photography","Sports","Pets","Home decor","Auto","Spirituality"];
const CS_TIERS = [["","Any size"],["nano","Nano · 1K–10K",1000,10000],["micro","Micro · 10K–50K",10000,50000],["mid","Mid · 50K–200K",50000,200000],
  ["macro","Macro · 200K–1M",200000,1000000],["mega","Mega · 1M+",1000000,null],["custom","Custom range…"]];
const CS_CITIES = ["Delhi NCR","Mumbai","Bengaluru","Hyderabad","Chennai","Kolkata","Pune","Ahmedabad","Jaipur","Lucknow","Chandigarh","Indore","Surat","Kochi","Goa","Bhopal","Nagpur","Patna","Dehradun","Guwahati"];
function csNew(){ return { q:"", categories:[], location:"", tier:"", min:"", max:"", min_engagement:"", gender:"", source:"all", sort:"followers_desc", page:1 }; }
let _csMain = null;
function mountCreatorSearch(root, opts){
  opts = opts || {};
  const S = opts.state || csNew();
  const key = opts.campaign ? "inv" : "dc";
  const id = s => key + s;
  root.innerHTML = `<div class="card cs-panel">
      <div class="cs-searchrow"><input id="${id("Q")}" type="search" placeholder="🔎 Search @username, name, a word from their posts, or #hashtag" value="${esc(S.q)}">
        <button class="btn" id="${id("Go")}">Search</button></div>
      <div class="cs-cats" id="${id("Cats")}">${CS_CATS.map(c=>`<button type="button" class="cs-chip${S.categories.includes(c)?" on":""}" data-cscat="${esc(c)}">${esc(c)}</button>`).join("")}</div>
      <div class="cs-filters">
        <label>Location<input id="${id("Loc")}" list="${id("CityList")}" placeholder="Any city" value="${esc(S.location)}"><datalist id="${id("CityList")}">${CS_CITIES.map(c=>`<option value="${esc(c)}">`).join("")}</datalist></label>
        <label>Followers<select id="${id("Tier")}">${CS_TIERS.map(t=>`<option value="${t[0]}"${S.tier===t[0]?" selected":""}>${esc(t[1])}</option>`).join("")}</select></label>
        <label class="cs-custom" style="${S.tier==="custom"?"":"display:none"}">Min<input id="${id("Min")}" type="number" min="0" value="${esc(S.min)}" placeholder="5000"></label>
        <label class="cs-custom" style="${S.tier==="custom"?"":"display:none"}">Max<input id="${id("Max")}" type="number" min="0" value="${esc(S.max)}" placeholder="200000"></label>
        <label>Engagement<select id="${id("Eng")}">${[["","Any"],["1","1%+"],["2","2%+"],["3","3%+"],["5","5%+"],["8","8%+"]].map(([v,l])=>`<option value="${v}"${S.min_engagement===v?" selected":""}>${l}</option>`).join("")}</select></label>
        <label>Gender<select id="${id("Gen")}">${[["","Any"],["female","Female"],["male","Male"],["other","Other"]].map(([v,l])=>`<option value="${v}"${S.gender===v?" selected":""}>${l}</option>`).join("")}</select></label>
        <label>Creators<select id="${id("Src")}">${[["all","Everyone"],["platform","On Geek OS"],["external","Not on Geek OS yet"]].map(([v,l])=>`<option value="${v}"${S.source===v?" selected":""}>${l}</option>`).join("")}</select></label>
        <label>Sort<select id="${id("Sort")}">${[["followers_desc","Followers: high → low"],["followers_asc","Followers: low → high"],["engagement_desc","Engagement: high → low"],["recent","Recently found"]].map(([v,l])=>`<option value="${v}"${S.sort===v?" selected":""}>${l}</option>`).join("")}</select></label>
        <button class="btn sm ghost cs-clear" id="${id("Clear")}" type="button">Clear</button>
      </div></div>
    <div class="cs-bar"><div id="${id("Count")}" class="cs-count"></div>
      <div class="cs-pool" id="${id("Pool")}"></div>
      ${opts.campaign?"":`<span class="cs-acts"><button class="btn sm ghost" id="${id("Fetch")}">↻ Fetch from Instagram</button><button class="btn sm" id="${id("Add")}">+ Add creators</button></span>`}</div>
    <div id="${id("Res")}"></div><div id="${id("Pager")}"></div>`;
  const $i = s => document.getElementById(id(s));
  const read = ()=>{ S.q = $i("Q").value.trim(); S.location = $i("Loc").value.trim(); S.tier = $i("Tier").value;
    S.min = $i("Min").value; S.max = $i("Max").value; S.min_engagement = $i("Eng").value; S.gender = $i("Gen").value; S.source = $i("Src").value; S.sort = $i("Sort").value; };
  const run = async (keepPage)=>{
    read(); if(!keepPage){ S.page = 1; S.pageP = 1; S.pageE = 1; }
    const t = CS_TIERS.find(x=>x[0]===S.tier), filters = { q:S.q, categories:S.categories, location:S.location, source:S.source, sort:S.sort, gender:S.gender, min_engagement:S.min_engagement };
    if(S.tier==="custom"){ filters.min_followers = S.min; filters.max_followers = S.max; } else if(t && t[2]!=null){ filters.min_followers = t[2]; if(t[3]!=null) filters.max_followers = t[3]; }
    Object.keys(filters).forEach(k=>{ if(filters[k]==="" || filters[k]==null) delete filters[k]; });
    $i("Res").innerHTML = skel("cards", 6); $i("Pager").innerHTML = "";
    const ask = (src, page, size)=> sb.schema("api").rpc("creator_search", { p_filters:Object.assign({}, filters, { source:src }), p_page:page, p_size:size, p_campaign: opts.campaign ? opts.campaign.id : null }).then(r=>r, e=>({error:e}));
    const both = S.source==="all";
    const [pr, er] = await Promise.all([
      S.source!=="external" ? ask("platform", both ? (S.pageP||1) : S.page, both ? 12 : 24) : Promise.resolve({ data:null }),
      S.source!=="platform" ? ask("external", both ? (S.pageE||1) : S.page, 24) : Promise.resolve({ data:null })]);
    const error = pr.error || er.error;
    if(error){ $i("Res").innerHTML = `<div class="card"><div class="muted">${esc(error.message||error)}${/creator_search/.test(error.message||"")?" — run <code>supabase db push</code> first.":""}</div></div>`; return; }
    const P = pr.data, E = er.data, rows = [...((P&&P.rows)||[]), ...((E&&E.rows)||[])];
    const total = ((P&&P.total)||0) + ((E&&E.total)||0);
    $i("Count").innerHTML = `<b>${fmtNum(total)}</b> creator${total===1?"":"s"}${S.categories.length?` · ${esc(S.categories.join(", "))}`:""}${S.location?` · ${esc(S.location)}`:""}`;
    const sec = (d, kind)=>{
      if(!d) return "";
      const R = d.rows||[], ig = kind==="external", pk = both ? (ig?"E":"P") : "";
      const head = ig ? `<div class="cs-sec-h"><span class="cs-sec-t">📸 From Instagram <b>${fmtNum(d.total||0)}</b></span><span class="muted">Not on Geek OS yet — followers & engagement fetched live from Instagram</span></div>`
                      : `<div class="cs-sec-h"><span class="cs-sec-t">👥 On Geek OS <b>${fmtNum(d.total||0)}</b></span><span class="muted">Signed-up creators with connected Instagram — invite in-app</span></div>`;
      const empty = ig ? `No Instagram creators match yet${opts.campaign?"":" — pick a city or category and tap <b>📡 Find on Instagram</b>, or <b>+ Add creators</b>"}.` : "No Geek OS creator matches these filters.";
      return `<div class="cs-sec ${ig?"cs-sec-ig":""}">${head}<div class="cs-igwarn" hidden></div>
        ${R.length ? `<div class="cs-grid">${R.map(c=> ig ? csIgCard(csIgSeed(c), opts) : csCard(c, opts)).join("")}</div>` : `<div class="card"><div class="muted">${empty}</div></div>`}
        ${csPagerHtml(d, pk, both ? (ig?24:12) : 24)}</div>`;
    };
    $i("Res").innerHTML = sec(P, "platform") + sec(E, "external");
    // a handle typed in the search box → look it up live on Instagram (and add it to the pool)
    const h = (S.q||"").replace(/^https?:\/\/(www\.)?instagram\.com\//i,"").replace(/^@/,"").replace(/[/?].*$/,"").toLowerCase();
    if(/^[a-z0-9._]{2,30}$/.test(h) && !rows.some(r=> String(r.handle).toLowerCase()===h)){
      $i("Res").insertAdjacentHTML("afterbegin", `<div class="card cs-lookup"><span>Not in the list yet — <b>@${esc(h)}</b></span><button class="btn sm" id="${id("Look")}">🔎 Look up @${esc(h)} on Instagram</button><span class="muted" id="${id("LookMsg")}"></span></div>`);
      $i("Look").onclick = async ()=>{ const b = $i("Look"); b.disabled = true; b.textContent = "Looking up…";
        const { data:lk, error:le } = await sb.functions.invoke("ig-discover", { body:{ action:"lookup", username:h } });
        const lm = $i("LookMsg");
        if(le || !lk || lk.error){ if(lm) lm.textContent = (lk && lk.error) || (le && await fnError(le)) || "Couldn't look it up."; b.disabled = false; b.textContent = `🔎 Look up @${h} on Instagram`;
          if(lk && (lk.added || lk.needs_facebook)) setTimeout(()=> run(true), 1500); return; }
        gateToast(`@${h} — ${kfmtN((lk.profile||{}).followers||0)} followers · added to search`); run(true); pool(); };
      // typed as @handle or an instagram.com link → look it up straight away (plain words wait for the button)
      // @handle, an instagram.com link, or a username-looking word (has . _ or a digit) → look it up straight away
      if((/^@|instagram\.com\//i.test(S.q||"") || /[._0-9]/.test(h)) && S._looked !== h){ S._looked = h; $i("Look").click(); }
    }
    // a #hashtag → live public posts from Instagram (Instagram Public Content Access) + the accounts they mention
    const tag = /^#/.test(S.q||"") ? String(S.q).replace(/^#/,"").trim().toLowerCase() : "";
    if(tag && /^[\p{L}\p{N}_]{2,60}$/u.test(tag)) csHashtagPanel($i("Res"), tag, S, ()=>{ run(true); pool(); });
    // a city and/or a category picked → find more of them live on Instagram (full public profiles)
    const kw = csKeyword(S.q);
    if((kw || S.location || S.categories.length) && S.source!=="platform" && (S.pageE||1)===1 && S.page===1) csScoutPanel($i("Res"), S, ()=>{ run(true); pool(); });
    root.querySelectorAll("[data-cspg]").forEach(b=> b.onclick = ()=>{ const k = b.dataset.cspk, n = +b.dataset.cspg;
      if(k==="P") S.pageP = n; else if(k==="E") S.pageE = n; else S.page = n;
      run(true); (k==="E" ? root.querySelector(".cs-sec-ig") || root : root).scrollIntoView({behavior:"smooth", block:"start"}); });
    csWireCards(root, opts);
    // Instagram cards: first everything we already hold (post they were seen in, who mentioned them, hashtags…),
    // then live numbers for the ones without — a few at a time, each card updated in place
    const igH = ((E&&E.rows)||[]).map(c=> c.handle);
    if(igH.length){
      const myRun = S._runId = (S._runId||0) + 1;
      await csIgLoadKnown(igH);
      if(S._runId !== myRun) return;
      igH.forEach(h=> csIgUpdate(root, h, null, null, opts, true));
      const missing = igH.filter(h=>{ const x = _csIgRows[h]||{}; return !x._done && (x.followers==null || x.engagement==null); });
      if(missing.length) igAutoFill(missing, (h, prof, err)=> csIgUpdate(root, h, prof, err, opts), root.querySelector(".cs-sec-ig .cs-igwarn"));
    }
  };
  const pool = async ()=>{
    const { data:p } = await sb.schema("api").rpc("discovery_pool_status").then(r=>r, ()=>({data:null}));
    const box = $i("Pool"); if(!box || !p) return;
    box.innerHTML = `<span title="Creators on Geek OS">👥 ${fmtNum(p.on_platform||0)} on Geek OS</span><span title="Instagram creators in your discovery pool">📸 ${fmtNum(p.pool||0)} found on Instagram (${fmtNum(p.with_stats||0)} with numbers)</span>`
      + (p.needs_permission ? `<span class="cs-warn" title="${esc(p.last_error||"")}">⚠️ Instagram stats lookup needs Meta approval (business discovery)</span>`
        : p.last_run_at ? `<span title="Fills follower counts and finds new handles every hour">🔄 Auto-filling numbers · last run ${esc(fmtDateTime(p.last_run_at))}</span>` : "");
  };
  root.querySelectorAll("[data-cscat]").forEach(b=> b.onclick = ()=>{ const c = b.dataset.cscat, i = S.categories.indexOf(c);
    if(i>=0) S.categories.splice(i,1); else S.categories.push(c); b.classList.toggle("on", i<0); run(); });
  $i("Go").onclick = ()=> run();
  $i("Q").onkeydown = e=>{ if(e.key==="Enter") run(); };
  $i("Loc").onchange = ()=> run();
  $i("Tier").onchange = ()=>{ root.querySelectorAll(".cs-custom").forEach(x=> x.style.display = $i("Tier").value==="custom" ? "" : "none"); if($i("Tier").value!=="custom") run(); };
  [$i("Min"),$i("Max")].forEach(x=> x.onchange = ()=> run());
  ["Eng","Gen","Src","Sort"].forEach(s=> $i(s).onchange = ()=> run());
  $i("Clear").onclick = ()=>{ Object.assign(S, csNew()); mountCreatorSearch(root, Object.assign({}, opts, { state:S })); };
  const add = $i("Add"); if(add) add.onclick = ()=> openCreatorImport(()=>{ run(); pool(); });
  const fetchBtn = $i("Fetch");
  if(fetchBtn) fetchBtn.onclick = async ()=>{
    fetchBtn.disabled = true; fetchBtn.textContent = "Fetching…";
    let tagged = 0;
    try{ const { data } = await sb.functions.invoke("ig-discover", { body:{ action:"tagged" } }); tagged = (data && data.saved) || 0; }catch(e){}
    const { data } = await sb.schema("api").rpc("refresh_external_pool").then(r=>r, ()=>({data:0}));
    fetchBtn.disabled = false; fetchBtn.textContent = "↻ Fetch from Instagram";
    gateToast(`Found ${(data||0)+tagged} creator(s) from tags and mentions on Instagram.`); run(); pool();
  };
  run(); pool();
  return S;
}
function csPagerHtml(d, pk, size){
  const pages = d.pages||1, page = d.page||1; if(pages<=1) return "";
  const nums = []; for(let p=Math.max(1,page-2); p<=Math.min(pages,page+2); p++) nums.push(p);
  const b = (p, label, cls, dis)=> `<button class="btn sm ${cls||"ghost"}" data-cspg="${p}" data-cspk="${pk}"${dis?" disabled":""}>${label}</button>`;
  return `<div class="ci-pager mc-pager">${b(page-1,"‹ Prev","ghost",page<=1)}
    ${nums[0]>1?`${b(1,1)}${nums[0]>2?'<span class="muted">…</span>':""}`:""}
    ${nums.map(p=> b(p, p, p===page?" ":"ghost")).join("")}
    ${nums[nums.length-1]<pages?`${nums[nums.length-1]<pages-1?'<span class="muted">…</span>':""}${b(pages,pages)}`:""}
    ${b(page+1,"Next ›","ghost",page>=pages)}
    <span class="muted">${(page-1)*size+1}–${Math.min(page*size,d.total)} of ${fmtNum(d.total)}</span></div>`;
}
function csWireCards(scope, opts){
  scope.querySelectorAll("[data-csinv]").forEach(b=> b.onclick = ()=> csInvite(b, opts));
  scope.querySelectorAll("[data-cslive]").forEach(b=> b.onclick = async ()=>{ const h = b.dataset.cslive; b.disabled = true; b.textContent = "Fetching…";
    const { data:lk, error:le } = await sb.functions.invoke("ig-discover", { body:{ action:"lookup", username:h } }).then(r=>r, e=>({error:e}));
    if(le || !lk || lk.error || !lk.profile){ gateToast((lk && lk.error) || (le && await fnError(le)) || "Couldn't reach Instagram."); b.disabled = false; b.textContent = "🔄 Refresh"; return; }
    const root = b.closest(".cs-grid") || document; csIgUpdate(root, h, lk.profile, null, opts);
    gateToast(`@${h} — ${kfmtN(lk.profile.followers||0)} followers · updated from Instagram`); });
}
// Instagram creator (not on Geek OS) — its own card: picture, followers, engagement, avg likes, posts, bio
// everything we hold about an Instagram creator who isn't on Geek OS: numbers, bio, the post they were seen in,
// where we found them and who mentioned / tagged them, hashtags, categories
function csIgBody(c){
  const loading = c.followers==null && !c._err && !c._done;
  const v = (x, f)=> x!=null ? f(x) : (loading ? `<i class="cs-shim"></i>` : "—");
  const via = [];
  (c.mentioned_by||[]).slice(0,3).forEach(u=> via.push(`mentioned by <a href="https://instagram.com/${encodeURIComponent(u)}" target="_blank" rel="noopener">@${esc(u)}</a>`));
  (c.tagged||[]).slice(0,2).forEach(u=> via.push(`tagged <a href="https://instagram.com/${encodeURIComponent(u)}" target="_blank" rel="noopener">@${esc(u)}</a>`));
  const SRC = { hashtag:"a #hashtag search", manual:"your team", tagged_brand:"tagged one of our accounts", creator_caption:"a creator's post", snowball:"another creator's posts", enriched:"" };
  if(!via.length) (c.sources||[]).forEach(x=>{ if(SRC[x]) via.push(SRC[x]); });
  const bio = c.bio && c.bio !== c.seen_in_post ? c.bio : "";
  const seen = c.seen_in_post || "";
  const tags = (c.hashtags||[]).slice(0,6);
  return `<div class="cs-stats cs-stats4"><div><b>${v(c.followers, kfmtN)}</b><span>Followers</span></div>
      <div><b>${v(c.engagement, x=> (Math.round(x*10)/10)+"%")}</b><span>Engagement</span></div>
      <div><b>${v(c.avg_likes, kfmtN)}</b><span>Avg likes</span></div>
      <div><b>${v(c.posts, kfmtN)}</b><span>Posts</span></div></div>
    ${loading?`<div class="cs-fetching"><span class="mk-spin sm"></span> Fetching from Instagram…</div>`:""}
    ${c._err && !c._errShown && c._err !== _igBlocked?`<div class="cs-nostat">${esc(c._err)}</div>`:""}
    ${bio?`<div class="cs-bio">${esc(bio)}</div>`:""}
    ${c.matched_post?`<div class="cs-match">📝 In their post: “${esc(c.matched_post)}…”</div>`:""}
    ${seen?`<div class="cs-seen"><span>📝 Seen in a post</span>“${esc(seen)}”${c.post_link?` <a href="${esc(safeUrl(c.post_link))}" target="_blank" rel="noopener">Open post ↗</a>`:""}</div>`:""}
    ${via.length||c.mention_count>1?`<div class="cs-via">🔗 Found via ${via.join(" · ")}${c.mention_count>1?` <span class="muted">· mentioned ${fmtNum(c.mention_count)}×</span>`:""}</div>`:""}
    <div class="cs-tags">${(c.categories||[]).slice(0,4).map(x=>`<span>${esc(String(x).replace(/\b\w/g,m=>m.toUpperCase()))}</span>`).join("")}${tags.map(t=>`<span class="cs-ht">#${esc(t)}</span>`).join("")}</div>
    ${c.first_seen_at?`<div class="cs-seenat muted">First found ${esc(fmtDate(c.first_seen_at))}</div>`:""}`;
}
function csIgHead(c, badge){
  const h = String(c.handle||""), ini = esc((h||"?").slice(0,2).toUpperCase());
  return `<div class="cs-top"><span class="cs-ring">${c.profile_picture_url?`<img src="${esc(safeUrl(c.profile_picture_url))}" alt="" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'avatar',textContent:'${ini}'}))">`:`<span class="avatar">${ini}</span>`}</span>
      <div class="cs-id"><a href="https://instagram.com/${encodeURIComponent(h)}" target="_blank" rel="noopener"><b>@${esc(h)}</b></a>
        ${c.name?`<div class="cs-nm">${esc(c.name)}</div>`:""}
        <div class="muted">${badge}${c.city?` 📍 ${esc(c.city)}`:""}</div></div></div>`;
}
function csIgCard(c, opts){
  const st = c.state_in_campaign, h = String(c.handle||"");
  const inv = opts && opts.campaign && st==="invited" ? `<span class="tag warn">Invited</span>` : `<button class="btn sm" data-csinv="${esc(h)}" data-csmid="">🎯 Invite</button>`;
  const loading = c.followers==null && !c._err && !c._done;
  return `<div class="card cs-card cs-igc${loading?" is-loading":""}" data-igcard="${esc(h)}">
    ${csIgHead(c, `<span class="cs-src ig">📸 Instagram</span>`)}
    ${csIgBody(c)}
    <div class="cs-act">${inv}<a class="btn sm ghost" href="https://ig.me/m/${encodeURIComponent(h)}" target="_blank" rel="noopener">💬 DM</a>
      <button class="btn sm ghost" data-cslive="${esc(h)}" title="Fetch the latest followers, posts and bio from Instagram">🔄</button></div></div>`;
}
// what we hold in the database for these handles → merged into the cards (then live numbers on top)
async function csIgLoadKnown(handles){
  const need = handles.filter(h=> !(_csIgRows[h]||{})._known);
  if(!need.length) return;
  const { data } = await sb.schema("api").rpc("external_profiles", { p_handles: need }).then(r=>r, ()=>({ data:null }));
  (data||[]).forEach(p=>{
    const prev = _csIgRows[p.handle] || {};
    const out = Object.assign({}, prev);
    Object.keys(p).forEach(k=>{ if(p[k]!=null && !(Array.isArray(p[k]) && !p[k].length)) out[k] = p[k]; });
    if(!p.bio && p.seen_in_post && out.bio === p.seen_in_post) out.bio = null;
    if(!p.fetched && p.error && !out._err) out._err = csIgWhy(p.error);
    out._known = true; _csIgRows[p.handle] = out;
  });
  need.forEach(h=>{ if(_csIgRows[h]) _csIgRows[h]._known = true; });
}
const _csIgRows = {};   // last data per Instagram handle, so a card can be redrawn when its numbers arrive
function csIgSeed(c){
  const prev = _csIgRows[c.handle] || {}, out = Object.assign({}, prev);
  Object.keys(c).forEach(k=>{ if(c[k]!=null && !(Array.isArray(c[k]) && !c[k].length && prev[k])) out[k] = c[k]; });
  if(out.followers!=null) out._err = null;
  return (_csIgRows[c.handle] = out);
}
function csIgMerge(c, prof, err){
  const base = Object.assign({}, _csIgRows[c.handle] || {}, c);
  if(prof){
    const f = Number(prof.followers)||0, likes = prof.avg_likes!=null ? Number(prof.avg_likes) : null;
    Object.assign(base, { followers: prof.followers ?? base.followers, posts: prof.media_count ?? base.posts, name: prof.name || base.name,
      bio: prof.bio || base.bio, profile_picture_url: prof.profile_picture_url || base.profile_picture_url,
      avg_likes: likes!=null ? Math.round(likes) : base.avg_likes,
      engagement: f>0 && likes!=null ? Math.round(1000*(likes + (Number(prof.avg_comments)||0))/f)/10 : base.engagement, _err:null, _done:true });
  } else { base._done = true; if(err) base._err = err; }
  _csIgRows[c.handle] = base; return base;
}
function csIgUpdate(root, h, prof, err, opts, redrawOnly){
  const el = root.querySelector(`[data-igcard="${CSS.escape(h)}"]`); if(!el) return;
  const c = redrawOnly ? Object.assign({ handle:h }, _csIgRows[h]||{}) : csIgMerge(Object.assign({}, _csIgRows[h]||{}, { handle:h }), prof, err && !prof ? csIgWhy(err) : null);
  if(c._err && _igBlocked && c._err === _igBlocked) c._errShown = true;   // the banner already says it once
  const tmp = document.createElement("div"); tmp.innerHTML = csIgCard(c, opts); const nu = tmp.firstElementChild;
  el.replaceWith(nu); csWireCards(nu, opts);
}
function csIgWhy(err){
  return /isn't a public Business|doesn't exist|not a public/i.test(err||"") ? "Personal or private account — Instagram shares numbers only for Business / Creator accounts."
    : /Super Admin|Connect with Facebook|needs_facebook/i.test(err||"") ? "Live numbers switch on once the Super Admin connects Facebook for Instagram search."
    : String(err||"").slice(0,140);
}
// fetch live numbers for many handles: 3 at a time, max 12 per screen, each handle once per visit; stops when Meta says no
const _igTried = new Set(); let _igBlocked = null;
async function igAutoFill(handles, onOne, warnEl, max){
  const showBlock = async ()=>{
    if(!warnEl || !_igBlocked) return;
    warnEl.hidden = false;
    const fb = /Facebook/i.test(_igBlocked);
    warnEl.innerHTML = `<span>⚠️ ${fb ? "Followers, photo and engagement for these creators come from Instagram once <b>Instagram search</b> is switched on (Facebook Login, one time). Everything we already know is shown below." : esc(_igBlocked)}</span>`;
    if(fb){
      const adm = window.__isAdmin || await sb.rpc("is_platform_admin").then(r=> r.data===true, ()=>false);
      if(adm && warnEl.isConnected){ warnEl.insertAdjacentHTML("beforeend", `<button class="btn sm" data-fbsearch>🔎 Connect Facebook now</button>`);
        warnEl.querySelector("[data-fbsearch]").onclick = ()=>{ try{ localStorage.setItem("geekos_after_ig","discover"); }catch(e){} connectFacebookSearch(); }; }
      else if(warnEl.isConnected) warnEl.insertAdjacentHTML("beforeend", `<span class="muted"> The Geek team switches this on.</span>`);
    }
  };
  if(_igBlocked){ showBlock(); handles.forEach(h=> onOne(h, null, _igBlocked)); return; }
  const q = handles.filter(h=> !_igTried.has(h)).slice(0, max || 12); q.forEach(h=> _igTried.add(h));
  handles.filter(h=> !q.includes(h)).forEach(h=> { const c = _csIgRows[h]; if(!c || c.followers==null) onOne(h, null, c && c._err || "No live numbers yet — tap 🔄 Refresh."); });
  const work = async ()=>{
    while(q.length){
      const h = q.shift();
      if(_igBlocked){ onOne(h, null, _igBlocked); continue; }
      const { data } = await sb.functions.invoke("ig-discover", { body:{ action:"lookup", username:h } }).then(r=>r, ()=>({ data:null }));
      if(data && data.profile){ onOne(h, data.profile); continue; }
      const e = (data && data.error) || "Couldn't reach Instagram.";
      if(data && (data.needs_facebook || data.needs_permission)){ _igBlocked = csIgWhy(e) === e ? e : csIgWhy(e); showBlock(); }
      onOne(h, null, e);
    }
  };
  await Promise.all([work(), work(), work()]);
}
function csCard(c, opts){
  const st = c.state_in_campaign, onCamp = st && !["invited","dropped","rejected","ineligible","brand_declined"].includes(st);
  const btn = opts.campaign
    ? (st==="invited" ? `<span class="tag warn">Invited</span>` : onCamp ? `<span class="tag good">On the campaign</span>`
       : `<button class="btn sm" data-csinv="${esc(c.handle)}" data-csmid="${esc(c.member_id||"")}">🎯 Invite</button>`)
    : `<button class="btn sm" data-csinv="${esc(c.handle)}" data-csmid="${esc(c.member_id||"")}">🎯 Invite</button>`;
  return `<div class="card cs-card">
    <div class="cs-top">${c.profile_picture_url?`<img src="${esc(safeUrl(c.profile_picture_url))}" alt="" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'avatar',textContent:'${esc((c.handle||"?").slice(0,2).toUpperCase())}'}))">`:`<span class="avatar">${esc((c.handle||"?").slice(0,2).toUpperCase())}</span>`}
      <div class="cs-id"><a href="https://instagram.com/${encodeURIComponent(c.handle)}" target="_blank" rel="noopener"><b>@${esc(c.handle)}</b></a>
        <div class="muted"><span class="cs-src ${c.kind==="platform"?"on":""}">${c.kind==="platform"?"On Geek OS":"Not on Geek OS"}</span>${c.city?` 📍 ${esc(c.city)}`:""}</div>
        ${c.name?`<div class="muted">${esc(c.name)}</div>`:""}</div></div>
    ${c.kind==="platform" && c.profile_pct!=null ? `<div class="cs-ppct" title="Creator profile complete"><span style="width:${c.profile_pct}%"></span><b>📝 Profile ${c.profile_pct}%</b></div>` : ""}
    ${c.kind==="platform" && c.member_id && Number(c.accounts)>1 ? `<button type="button" class="cs-accts" data-igaccts="${esc(c.member_id)}" data-igname="${esc(c.name||c.handle)}">📸 ${Number(c.accounts)} accounts · same creator →</button>` : ""}
    <div class="cs-stats"><div><b>${c.followers!=null?kfmtN(c.followers):"—"}</b><span>Followers</span></div>
      <div><b>${c.engagement!=null?(Math.round(c.engagement*10)/10)+"%":"—"}</b><span>Engagement</span></div>
      <div><b>${c.avg_likes!=null?kfmtN(c.avg_likes):"—"}</b><span>Avg likes</span></div></div>
    ${c.bio?`<div class="cs-bio">${esc(c.bio)}</div>`:""}
    ${c.matched_post?`<div class="cs-match">📝 In their post: “${esc(c.matched_post)}…”</div>`:""}
    <div class="cs-tags">${(c.categories||[]).slice(0,4).map(x=>`<span>${esc(x.replace(/\b\w/g,m=>m.toUpperCase()))}</span>`).join("")}</div>
    <div class="cs-act">${btn}${c.kind!=="platform"?`<button class="btn sm ghost" data-cslive="${esc(c.handle)}" title="Fetch this account's live followers, posts and bio from Instagram">🔄 Live stats</button><a class="btn sm ghost" href="https://ig.me/m/${encodeURIComponent(c.handle)}" target="_blank" rel="noopener">💬 DM</a>`:""}</div></div>`;
}
// every Instagram account one Geek OS creator has connected (Discovery, campaign invite, Super Admin)
async function openIgAccountsModal(memberId, name){
  let m = document.getElementById("igAcctsModal"); if(m) m.remove();
  m = el("div","modal-overlay"); m.id = "igAcctsModal";
  m.innerHTML = `<div class="modal"><div class="modal-head"><strong>📸 ${esc(name||"Creator")} — Instagram accounts</strong><button class="icon-btn" id="igAcctsX">✕</button></div>
    <div class="modal-form" id="igAcctsBody">${skel("list",3)}</div></div>`;
  document.body.appendChild(m); m.classList.add("open");
  const close = ()=> m.remove();
  document.getElementById("igAcctsX").onclick = close; m.onclick = e=>{ if(e.target.id==="igAcctsModal") close(); };
  const { data, error } = await sb.schema("api").rpc("creator_ig_accounts", { p_member: memberId });
  const body = document.getElementById("igAcctsBody"); if(!body) return;
  if(error){ body.innerHTML = `<div class="ci-err-inline">${esc(error.message)}</div>`; return; }
  const L = data || [];
  body.innerHTML = !L.length ? `<div class="muted">No Instagram connected yet.</div>`
    : `<div class="muted" style="font-size:13px;margin-bottom:6px">${L.length} account${L.length>1?"s":""} connected with Instagram login. The <b>active</b> one is used for their Media Kit right now; they can apply to campaigns with any of them.</div>
       <div class="ig-acct-list">${L.map(a=>`<div class="ig-acct-row">
         ${a.profile_picture_url?`<img src="${esc(safeUrl(a.profile_picture_url))}" alt="" referrerpolicy="no-referrer">`:`<span class="avatar">📸</span>`}
         <div style="min-width:0;flex:1"><a href="https://instagram.com/${encodeURIComponent(a.username||"")}" target="_blank" rel="noopener"><b>@${esc(a.username||"")}</b></a>${a.active?' <span class="tag good">Active</span>':""}
           <div class="muted" style="font-size:12.5px">${esc([a.name||"", a.followers!=null?kfmtN(a.followers)+" followers":"", a.posts!=null?a.posts+" posts":""].filter(Boolean).join(" · "))}</div></div>
         <div class="muted" style="font-size:12px;white-space:nowrap">added ${esc(fmtDate(a.connected_at))}</div></div>`).join("")}</div>`;
}
window.openIgAccountsModal = openIgAccountsModal;
document.addEventListener("click", e=>{
  const b = e.target && e.target.closest && e.target.closest("[data-igaccts]"); if(!b) return;
  e.preventDefault(); e.stopPropagation(); openIgAccountsModal(b.dataset.igaccts, b.dataset.igname);
}, true);
// #hashtag in Discovery: top / recent public posts straight from Instagram, and the accounts their captions mention
async function csHashtagPanel(res, tag, S, refresh){
  const edge = S._tagEdge || "top";
  res.insertAdjacentHTML("afterbegin", `<div class="card cs-tag" id="csTagBox"><div class="cs-tag-h"><b>📸 #${esc(tag)} on Instagram</b>
      <span class="cs-tag-sw"><button class="btn sm ${edge==="top"?"":"ghost"}" data-tagedge="top">Top posts</button><button class="btn sm ${edge==="recent"?"":"ghost"}" data-tagedge="recent">Recent</button></span></div>
    <div id="csTagBody">${skel("list",1)}</div></div>`);
  const box = document.getElementById("csTagBox");
  box.querySelectorAll("[data-tagedge]").forEach(b=> b.onclick = ()=>{ S._tagEdge = b.dataset.tagedge; box.remove(); csHashtagPanel(res, tag, S, refresh); });
  const { data, error } = await sb.functions.invoke("ig-discover", { body:{ action:"hashtag", tag, edge: edge==="recent" ? "recent" : "top" } }).then(r=>r, e=>({error:e}));
  const body = document.getElementById("csTagBody"); if(!body) return;
  if(error || !data || data.error){ body.innerHTML = `<div class="muted">${esc((data && data.error) || (error && error.message) || "Couldn't reach Instagram.")}</div>`; return; }
  const P = data.posts||[], H = data.handles||[];
  body.innerHTML = (H.length ? `<div class="cs-tag-sub">Accounts mentioned in these posts — added to your search:</div><div class="cs-tag-handles">${H.map(h=>`<button class="cs-chip" data-taglook="${esc(h)}">@${esc(h)}</button>`).join("")}</div>` : "")
    + (P.length ? `<div class="mk-grid cs-tag-grid">${P.slice(0,18).map(m=>`<a class="mk-post" href="${esc(safeUrl(m.permalink||"#"))}" target="_blank" rel="noopener">
          ${m.media_url && m.media_type!=="VIDEO" ? `<img src="${esc(safeUrl(m.media_url))}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : `<div class="mk-post-noimg">${m.media_type==="VIDEO"?"▶ Reel":"Post"}</div>`}
          <span class="mk-meta">❤ ${fmtNum(m.like_count||0)} · 💬 ${fmtNum(m.comments_count||0)}</span></a>`).join("")}</div>
        <div class="muted" style="font-size:12px;margin-top:6px">Instagram shows hashtag posts without the poster's name — open a post to see who made it, then look them up above.</div>`
      : `<div class="muted">No public posts for #${esc(tag)} right now.</div>`);
  body.querySelectorAll("[data-taglook]").forEach(b=> b.onclick = async ()=>{ const h = b.dataset.taglook; b.disabled = true; b.textContent = "@"+h+" …";
    const { data:lk } = await sb.functions.invoke("ig-discover", { body:{ action:"lookup", username:h } }).then(r=>r, ()=>({data:null}));
    b.textContent = lk && lk.profile ? `@${h} · ${kfmtN(lk.profile.followers||0)}` : "@"+h; gateToast(lk && lk.profile ? `@${h} added with live numbers` : ((lk && lk.error) || `@${h} added`)); });
  if(H.length && refresh) setTimeout(refresh, 400);
}
// City / category → live Instagram: hashtags of that city + category, the creators those posts name, each with full profile
// a plain search word (not @handle, #hashtag, a link or a username) = what creators post about
function csKeyword(q){
  q = String(q||"").trim();
  if(!q || /^[@#]|instagram\.com|https?:/i.test(q) || q.length > 40) return "";
  if(!/\s/.test(q) && /[._0-9]/.test(q)) return "";   // looks like a username → looked up directly instead
  return /^[\p{L}\p{N} &'-]{2,40}$/u.test(q) ? q : "";
}
function csScoutPanel(res, S, refresh){
  const city = S.location || "", cat = S.categories[0] || "", keyword = csKeyword(S.q);
  const key = (keyword+"|"+city+"|"+cat).toLowerCase(), done = (S._scout||{})[key];
  const what = `${cat?`<b>${esc(cat)}</b> creators`:"creators"}${keyword?` posting about <b>“${esc(keyword)}”</b>`:""}${city?` in <b>${esc(city)}</b>`:""}`;
  res.insertAdjacentHTML("afterbegin", `<div class="card cs-scout" id="csScoutBox"><div class="cs-scout-h"><div><b>📡 Find more ${what} live on Instagram</b>
      <div class="muted">We read the hashtags they post with, find the creators, and bring in each one's full profile — followers, bio, posts, engagement.</div></div>
      <button class="btn sm" id="csScoutGo">${done?"🔄 Search again":"📡 Find on Instagram"}</button></div><div id="csScoutMsg">${done?csScoutSummary(done):""}</div></div>`);
  const go = document.getElementById("csScoutGo");
  go.onclick = async ()=>{
    go.disabled = true; go.textContent = "Searching Instagram…";
    const msg = document.getElementById("csScoutMsg");
    msg.innerHTML = `<div class="cs-scout-run"><span class="mk-spin sm"></span> Reading Instagram posts and pulling profiles — about 20–40 seconds…</div>`;
    const { data, error } = await sb.functions.invoke("ig-discover", { body:{ action:"scout", city, category:cat, keyword } }).then(r=>r, e=>({error:e}));
    go.disabled = false; go.textContent = "🔄 Search again";
    if(error || !data || data.error){ msg.innerHTML = `<div class="muted">${esc((data && data.error) || (error && error.message) || "Couldn't reach Instagram.")}</div>`; return; }
    S._scout = Object.assign({}, S._scout, { [key]: data });
    gateToast(`${data.with_stats||0} creator(s) with full profile${(data.no_stats||[]).length?` + ${(data.no_stats||[]).length} more handle(s)`:""} added`);
    if(refresh) refresh();
  };
}
function csScoutSummary(d){
  const P = d.profiles||[];
  return `<div class="cs-scout-sum">✅ Found <b>${fmtNum(d.found||0)}</b> account(s) on ${(d.tags||[]).map(t=>"#"+esc(t)).join(", ")} — <b>${fmtNum(d.with_stats||0)}</b> with full profile, added to the list below.
      ${(d.no_stats||[]).length?`<span class="muted">${(d.no_stats||[]).length} are personal / private accounts (Instagram shares no numbers for those) — added as handles.</span>`:""}</div>`
    + (P.length ? `<div class="cs-tag-handles">${P.slice(0,24).map(p=>`<span class="cs-chip on" title="${esc(p.bio||"")}">@${esc(p.handle)} · ${kfmtN(p.followers||0)}</span>`).join("")}</div>` : "");
}
function kfmtN(n){ n = Number(n)||0; return n>=1e7 ? (n/1e6).toFixed(0)+"M" : n>=1e6 ? (n/1e6).toFixed(1).replace(/\.0$/,"")+"M" : n>=1e4 ? Math.round(n/1e3)+"K" : n>=1e3 ? (n/1e3).toFixed(1).replace(/\.0$/,"")+"K" : String(Math.round(n)); }
async function csInvite(b, opts){
  const handle = b.dataset.csinv, mid = b.dataset.csmid || null;
  if(!opts.campaign) return inviteFromDiscovery(handle, mid);
  b.disabled = true; b.textContent = "Inviting…";
  const args = { p_campaign: opts.campaign.id, p_note: null };
  const { error } = mid ? await sb.schema("api").rpc("invite_creator", { ...args, p_member: mid })
                        : await sb.schema("api").rpc("invite_external", { ...args, p_handle: handle });
  if(error){ alert(error.message); b.disabled = false; b.textContent = "🎯 Invite"; return; }
  b.outerHTML = `<span class="tag warn">Invited ✓</span>`;
  if(window.Tracker) Tracker.security("creator_invited", { campaign: opts.campaign.name, from: "search" });
}
// + Add creators: paste handles / a list, or upload a CSV (handle, name, followers, engagement, category, city, bio)
function openCreatorImport(done){
  let m = document.getElementById("csImp"); if(m) m.remove();
  m = el("div","modal-overlay"); m.id = "csImp";
  m.innerHTML = `<div class="modal"><div class="modal-head"><strong>Add creators to your search</strong><button class="icon-btn" id="csImpX">✕</button></div>
    <div class="modal-form">
      <p class="muted" style="font-size:13px;margin:0">Paste Instagram handles or profile links — one per line — or upload a CSV/Excel-saved-as-CSV with a <b>handle</b> column (optional: name, followers, engagement, category, city, bio). Numbers you add show straight away; the rest fill in automatically when Instagram allows.</p>
      <label>Handles or rows<textarea id="csImpTxt" rows="8" placeholder="@delhi.foodie&#10;https://instagram.com/mumbai_style_diaries&#10;travel.with.ria, 45000, Travel, Bengaluru"></textarea></label>
      <label>…or a CSV file<input type="file" id="csImpFile" accept=".csv,text/csv"></label>
      <div class="auth-err" id="csImpErr"></div><button class="btn" id="csImpGo">Add to search</button></div></div>`;
  document.body.appendChild(m); m.classList.add("open");
  const close = ()=> m.remove();
  document.getElementById("csImpX").onclick = close; m.onclick = e=>{ if(e.target.id==="csImp") close(); };
  document.getElementById("csImpFile").onchange = e=>{ const f = e.target.files[0]; if(!f) return;
    const r = new FileReader(); r.onload = ()=>{ document.getElementById("csImpTxt").value = String(r.result||""); }; r.readAsText(f); };
  document.getElementById("csImpGo").onclick = async ()=>{
    const err = document.getElementById("csImpErr"), btn = document.getElementById("csImpGo"); err.textContent = "";
    const rows = csParseImport(document.getElementById("csImpTxt").value);
    if(!rows.length){ err.textContent = "Nothing to add — paste at least one handle."; return; }
    btn.disabled = true; let added = 0, skipped = 0;
    for(let i=0; i<rows.length; i+=500){
      btn.textContent = `Adding ${Math.min(i+500, rows.length)} / ${rows.length}…`;
      const { data, error } = await sb.schema("api").rpc("import_creators", { p_rows: rows.slice(i, i+500) });
      if(error){ err.textContent = error.message; btn.disabled = false; btn.textContent = "Add to search"; return; }
      added += (data&&data.added)||0; skipped += (data&&data.skipped)||0;
    }
    close(); gateToast(`Added ${added} creator${added===1?"":"s"}${skipped?` · ${skipped} skipped (already on Geek OS or not a valid handle)`:""}.`); done && done();
  };
}
function csParseImport(text){
  const lines = String(text||"").split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  if(!lines.length) return [];
  const split = l => { const out=[]; let cur="", q=false; for(const ch of l){ if(ch==='"'){ q=!q; continue; } if((ch===","||ch==="\t"||ch===";") && !q){ out.push(cur.trim()); cur=""; } else cur+=ch; } out.push(cur.trim()); return out; };
  const head = split(lines[0]).map(h=>h.toLowerCase());
  const has = head.some(h=>/^(handle|username|instagram|ig|profile|account)/.test(h));
  if(has){
    const col = re => head.findIndex(h=>re.test(h));
    const c = { handle:col(/^(handle|username|instagram|ig|profile|account)/), name:col(/^(name|full ?name)/), followers:col(/follower/),
      engagement:col(/(engagement|^er\b|er ?%)/), category:col(/(categor|niche|genre)/), city:col(/(city|location)/), bio:col(/^(bio|about)/), avg_likes:col(/avg.*like|likes/) };
    return lines.slice(1).map(l=>{ const v = split(l), o = {}; Object.entries(c).forEach(([k,i])=>{ if(i>=0 && v[i]) o[k] = v[i]; }); return o; }).filter(o=>o.handle);
  }
  // plain list: handle[, followers[, category[, city]]]
  return lines.map(l=>{ const v = split(l); const o = { handle: v[0] };
    if(v[1] && /[\d]/.test(v[1])) o.followers = v[1]; if(v[2]) o.category = v[2]; if(v[3]) o.city = v[3]; return o; });
}

/* ---------- Reports (agency / brand: own campaigns; Super Admin: all) ---------- */
const REPORT_APPROVED = s => !APPLICANT_PENDING.includes(s) && !["ineligible","brand_declined","dropped","rejected"].includes(s);
async function loadOrgReports(){
  const wrap = document.getElementById("reportRows"); if(!wrap) return false;
  const { data, error } = await sb.schema("api").rpc("org_reports").then(r=>r, e=>({error:e}));
  if(error || !Array.isArray(data) || !data.length) return false;
  const reasons = Object.fromEntries((await rejectionReasons()).map(r=>[r.code, r.label]));
  const sum = (o, pred)=> Object.entries(o||{}).reduce((a,[k,v])=> a + (pred(k)?Number(v)||0:0), 0);
  const rows = data.map(c=>{
    const f = c.funnel||{}, m = c.metrics||{};
    return { c, applied: sum(f,()=>true), approved: sum(f,REPORT_APPROVED), declined: sum(f,k=>["ineligible","brand_declined","dropped","rejected"].includes(k)),
             pending: sum(f,k=>APPLICANT_PENDING.includes(k)), posts: Number(c.posts)||0, reach:Number(m.reach)||0, views:Number(m.views)||0,
             likes:Number(m.likes)||0, comments:Number(m.comments)||0, saves:Number(m.saves)||0 };
  });
  const T = k => rows.reduce((a,r)=>a+r[k],0);
  const eng = T("reach") ? ((T("likes")+T("comments")+T("saves"))/T("reach")*100).toFixed(1)+"%" : "—";
  const topDecl = {}; data.forEach(c=> Object.entries(c.declines||{}).forEach(([k,v])=> topDecl[k]=(topDecl[k]||0)+Number(v)));
  const csvRows = [["Campaign","Brand","Status","Type","Applied","Pending","Approved","Declined","Posts","Reach","Views","Likes","Comments","Saves"]]
    .concat(rows.map(r=>[r.c.name, r.c.brand, r.c.lifecycle_status, r.c.comp_type, r.applied, r.pending, r.approved, r.declined, r.posts, r.reach, r.views, r.likes, r.comments, r.saves]));
  wrap.innerHTML = `<div class="rp-kpis">
      <div><b>${rows.length}</b>Campaigns</div><div><b>${fmtNum(T("applied"))}</b>Applications</div><div><b>${fmtNum(T("approved"))}</b>Approved creators</div>
      <div><b>${fmtNum(T("posts"))}</b>Posts live</div><div><b>${fmtNum(T("reach"))}</b>Reach</div><div><b>${fmtNum(T("views"))}</b>Views</div><div><b>${eng}</b>Engagement / reach</div></div>
    <div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Campaign</th><th>Status</th><th>Applied</th><th>Pending</th><th>Approved</th><th>Declined</th><th>Posts</th><th>Reach</th><th>Views</th><th>Likes</th><th>Comments</th></tr></thead><tbody>
    ${rows.map(r=>`<tr><td><b>${esc(r.c.name)}</b><div class="muted" style="font-size:12px">${esc(r.c.brand||"")}${r.c.creators_needed?` · need ${esc(r.c.creators_needed)}`:""}</div></td>
      <td>${esc(String(r.c.lifecycle_status||"").replace(/_/g," "))}</td><td>${r.applied}</td><td>${r.pending}</td><td>${r.approved}</td><td>${r.declined}</td>
      <td>${r.posts}</td><td>${fmtNum(r.reach)}</td><td>${fmtNum(r.views)}</td><td>${fmtNum(r.likes)}</td><td>${fmtNum(r.comments)}</td></tr>`).join("")}</tbody></table></div>
    ${Object.keys(topDecl).length?`<div style="margin-top:14px"><b>Why creators were declined</b><div class="dc-tags" style="margin-top:6px">${Object.entries(topDecl).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<span>${esc(reasons[k]||k)} · ${v}</span>`).join("")}</div></div>`:""}
    <div style="margin-top:14px"><button class="mini-btn" id="rpCsv">⬇ Download CSV</button></div>`;
  document.getElementById("rpCsv").onclick = ()=>{
    const csv = csvRows.map(r=>r.map(v=>`"${String(v??"").replace(/"/g,'""')}"`).join(",")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv],{type:"text/csv"})); a.download = "campaign-report.csv"; a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href), 2000);
  };
  return true;
}

/* ---------- Super Admin → Applications: every creator application across every workspace ---------- */
let _apCampaign = "", _apQ = "", _apStatus = "pending", _apType = "", _apTimer = null, _apSig = "";
async function adminApplications(body, silent){
  if(!silent) body.innerHTML = skel("list",5);
  const [pr, ar] = await Promise.all([
    sb.schema("api").rpc("org_applicants", { p_campaign:null, p_stage:null }).then(r=>r, e=>({error:e})),
    sb.rpc("admin_applications", { p_campaign:null, p_status:null }).then(r=>r, ()=>({data:[]}))
  ]);
  if(pr.error){ if(!silent) body.innerHTML = adminErr(pr.error); return; }
  const sig = JSON.stringify([pr.data, ar.data]); if(silent && sig===_apSig) return; _apSig = sig;
  const DECL = ["ineligible","brand_declined","dropped","rejected"];
  const grp = st => APPLICANT_PENDING.includes(st) ? "pending" : DECL.includes(st) ? "declined" : "approved";
  const lgrp = st => st==="Applied" ? "pending" : st==="Declined" ? "declined" : "approved";
  const tpass = t => !_apType || (_apType==="paid" ? ["paid","barter_paid"].includes(t) : ["barter","barter_paid"].includes(t));
  const pipe = (pr.data||[]), legacy = (ar.data||[]);
  const cnt = g => pipe.filter(p=>grp(p.stage)===g && tpass(p.campaign_type)).length + legacy.filter(a=>lgrp(a.status)===g && !_apType).length;
  // one dropdown of every campaign that has applications (pipeline + marketplace), with counts
  const campCount = {};
  pipe.forEach(p=>{ const n=p.campaign_name||"—"; campCount[n]=(campCount[n]||0)+1; });
  legacy.forEach(a=>{ const n=a.campaign_name||"—"; campCount[n]=(campCount[n]||0)+1; });
  const campNames = Object.keys(campCount).sort((a,b)=>a.localeCompare(b));
  if(_apCampaign && !campCount[_apCampaign]) _apCampaign = "";
  const cpass = n => !_apCampaign || (n||"—")===_apCampaign;
  const qpass = o => !_apQ || [o.campaign_name,o.brand,o.org_name,o.agency_org,o.creator_name,(o.creator&&o.creator.username),(o.creator&&o.creator.name)]
      .filter(Boolean).join(" ").toLowerCase().includes(_apQ.toLowerCase());
  const P = pipe.filter(p=> (_apStatus==="all" || grp(p.stage)===_apStatus) && tpass(p.campaign_type) && cpass(p.campaign_name) && qpass(p));
  const Lg = _apType ? [] : legacy.filter(a=> (_apStatus==="all" || lgrp(a.status)===_apStatus) && cpass(a.campaign_name) && qpass(a));
  body.innerHTML = `<div class="rp-kpis"><div><b>${cnt("pending")}</b>Pending</div><div><b>${cnt("approved")}</b>Approved</div><div><b>${cnt("declined")}</b>Declined</div><div><b>${pipe.length+legacy.length}</b>Total</div></div>
    <div class="card"><div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:space-between;align-items:center">
      <h3 style="margin:0">Applications <span class="muted" style="font-size:12px;font-weight:400">· every workspace, live</span></h3>
      <span style="display:flex;gap:6px;flex-wrap:wrap"><input id="apQ" placeholder="🔍 Creator, brand, campaign…" value="${esc(_apQ)}" style="padding:7px 10px;border-radius:9px;border:1px solid var(--line);background:var(--panel);color:inherit;font-size:13px;min-width:190px">
      <select id="apCampaign"><option value="">📣 All campaigns (${campNames.length})</option>${campNames.map(n=>`<option value="${esc(n)}"${n===_apCampaign?" selected":""}>${esc(n)} (${campCount[n]})</option>`).join("")}</select>
      <select id="apType"><option value="">Paid + Barter</option><option value="paid"${_apType==="paid"?" selected":""}>💰 Paid</option><option value="barter"${_apType==="barter"?" selected":""}>🎁 Barter</option></select>
      <select id="apStatus">${[["pending","⏳ Pending"],["approved","✅ Approved"],["declined","✖ Declined"],["all","All"]].map(([k,l])=>`<option value="${k}"${k===_apStatus?" selected":""}>${l}</option>`).join("")}</select></span></div>
    <div class="list" style="margin-top:10px">${P.map(p=>applicantRowHtml(p, true)).join("")}
      ${Lg.map(a=>`<div class="row"><span class="avatar">${esc((a.creator_name||"?").slice(0,2).toUpperCase())}</span><div class="r-main"><div class="r-title">${esc(a.creator_name||"Creator")} <span class="muted" style="font-weight:400">→ ${esc(a.campaign_name||"")}${a.agency_org?` · ${esc(a.agency_org)}`:""}</span></div>
        <div class="r-sub">Marketplace application${a.decline_reason_code?` · ${esc(a.decline_reason_code)}`:""}${a.decline_note?` — ${esc(a.decline_note)}`:""}</div></div>
        ${a.status==="Applied"?`<span style="display:flex;gap:6px"><button class="mini-btn" data-apappr="${esc(a.id)}">Approve</button><button class="mini-btn ghost" data-apdecl="${esc(a.id)}">Decline</button></span>`:`<span class="tag ${a.status==="Approved"?"good":""}">${esc(a.status)}</span>`}</div>`).join("")}
      ${(!P.length && !Lg.length)?`<div class="muted" style="padding:8px">Nothing here.</div>`:""}</div></div>`;
  const again = ()=>{ _apSig=""; adminApplications(body, true); };
  document.getElementById("apStatus").onchange = e=>{ _apStatus = e.target.value; again(); };
  document.getElementById("apType").onchange = e=>{ _apType = e.target.value; again(); };
  document.getElementById("apCampaign").onchange = e=>{ _apCampaign = e.target.value; again(); };
  const apq = document.getElementById("apQ"); let apqT;
  apq.oninput = ()=>{ clearTimeout(apqT); apqT = setTimeout(()=>{ _apQ = apq.value; again(); }, 250); };
  wireApplicantButtons(body, again);
  body.querySelectorAll("[data-apappr]").forEach(b=> b.onclick = async ()=>{ const { error } = await sb.rpc("decide_application", { p_id:b.dataset.apappr, p_approve:true, p_reason_code:null, p_note:null }); if(error) alert(error.message); again(); });
  body.querySelectorAll("[data-apdecl]").forEach(b=> b.onclick = ()=> declineLegacyApplication(b.dataset.apdecl, again));
  clearInterval(_apTimer);
  _apTimer = setInterval(()=>{
    const b = document.getElementById("adminBody");
    if(currentPage!=="admin" || _adminTab!=="applications" || !b){ clearInterval(_apTimer); return; }
    if(document.visibilityState!=="visible" || document.querySelector(".modal-overlay.open") || document.activeElement?.tagName==="SELECT" || document.activeElement?.id==="apQ") return;
    adminApplications(b, true);
  }, 30000);
}

/* ---------- Super Admin → All campaigns (live): status override + decide applications for anyone ---------- */
let _acTimer = null, _acOpen = null, _acSig = "";
const CAMP_STATUSES = ["Draft","Approval","Live","Shortlist completed","Completed"];
let _acPick = "", _acQ = "", _acPickOpened = false;
// one campaign picked in Super Admin → where every creator is, at a glance
function acPickSummary(c, pc){
  const B = [["Applied",["applied","eligible","sent_to_brand","invited","shortlisted"]],["Selected",["brand_confirmed","accepted"]],
    ["Contract",["contract_sent","contract_signed"]],["Shipping",["address_confirmed","product_sent"]],["Video",["content_created","changes_requested","content_submitted"]],
    ["Approved",["content_approved"]],["Posted",["published"]],["Done",["completed"]],["Dropped",["ineligible","brand_declined","dropped","rejected"]]];
  return `<div class="ac-pick"><div class="ac-pick-h"><div><b>${esc(c.name)}</b> <span class="muted">${esc(c.brand||"")}${c.org_name?" · "+esc(c.org_name):""}${c.start_date||c.end_date?" · "+esc(c.start_date||"—")+" → "+esc(c.end_date||"—"):""}</span></div>
      <span style="display:flex;gap:6px;flex-wrap:wrap"><button class="mini-btn" data-acbp="${esc(c.id)}" data-acbpname="${esc(c.name)}">🔁 Open process</button>
      <button class="mini-btn ghost" data-acan="${esc(c.id)}" data-acanname="${esc(c.name)}">📈 Analytics</button><button class="mini-btn ghost" id="acPickClear">✕ Show all</button></span></div>
    <div class="ac-pick-f">${B.map(([l,st])=>{ const n = pc.filter(p=>st.includes(p.stage)).length; return `<div class="${n?"":"z"}"><b>${n}</b><span>${l}</span></div>`; }).join("")}</div></div>`;
}
async function adminCampaigns(body, silent){
  if(!silent) body.innerHTML = skel("table",6);
  const filter = (document.getElementById("acFilter")||{}).value || "";
  const tfilter = (document.getElementById("acType")||{}).value || "";
  const [cr, pr, ar] = await Promise.all([
    sb.rpc("admin_campaigns", { p_status: (filter && filter!=="Live") ? filter : null }).then(r=>{
      if(!r.error && filter==="Live") r.data = (r.data||[]).filter(c=> campStatusPick(c.status)==="Live"); return r; }),
    sb.schema("api").rpc("org_applicants", { p_campaign:null, p_stage:null }).then(r=>r, ()=>({data:[]})),
    sb.rpc("admin_applications", { p_campaign:null, p_status:null }).then(r=>r, ()=>({data:[]}))
  ]);
  if(cr.error){ if(!silent) body.innerHTML = adminErr(cr.error); return; }
  const dr = await sb.rpc("admin_campaign_delete_requests", { p_status:"pending" }).then(r=>r, ()=>({data:null}));
  const sig = JSON.stringify([cr.data, pr.data, ar.data, dr.data]);
  if(silent && sig === _acSig) return;           // nothing changed → don't touch the DOM
  _acSig = sig;
  const kindL = c => c.campaign_type || "barter";
  const allCamps = (cr.data||[]).filter(c=> !tfilter || campInBucket(c, tfilter)), pipe = pr.data||[], legacy = ar.data||[];
  if(_acPick && !(cr.data||[]).some(c=>c.id===_acPick)) _acPick = "";
  const camps = _acPick ? allCamps.filter(c=>c.id===_acPick) : allCamps;
  if(_acPick && _acOpen!==_acPick && !_acPickOpened){ _acOpen = _acPick; _acPickOpened = true; }
  const pendFor = id => pipe.filter(p=>p.legacy_campaign_id===id && APPLICANT_PENDING.includes(p.stage)).length + legacy.filter(a=>a.campaign_id===id && a.status==="Applied").length;
  const delReq = await adminDeleteRequestsHtml();
  body.innerHTML = delReq.html + `<div class="card"><div class="ci-mh" style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
      <h3 style="margin:0">All campaigns <span class="muted" style="font-size:12px;font-weight:400">· live, refreshes every 30s</span></h3>
      <span style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
        <input id="acQ" type="search" placeholder="🔎 Search campaign, brand, workspace" value="${esc(_acQ)}" style="padding:7px 10px;border-radius:9px;border:1px solid var(--line);background:var(--panel);color:inherit;min-width:220px">
        <select id="acPick"><option value="">All campaigns (${allCamps.length})</option>${(cr.data||[]).slice().sort((a,b)=>String(a.name).localeCompare(String(b.name))).map(c=>`<option value="${esc(c.id)}"${c.id===_acPick?" selected":""}>${esc(c.name)}${c.brand?" — "+esc(c.brand):""}</option>`).join("")}</select>
        <select id="acType"><option value="">Paid + Barter</option><option value="paid"${tfilter==="paid"?" selected":""}>💰 Paid</option><option value="barter"${tfilter==="barter"?" selected":""}>🎁 Barter</option><option value="celebrity"${tfilter==="celebrity"?" selected":""}>👑 Celebrity stories</option></select>
      <select id="acFilter"><option value="">All statuses</option>${CAMP_STATUSES.map(s=>`<option${s===filter?" selected":""}>${s}</option>`).join("")}</select></span></div>
    ${_acPick && camps[0] ? acPickSummary(camps[0], pipe.filter(p=>p.legacy_campaign_id===_acPick)) : ""}
    ${camps.length?`<div style="overflow-x:auto;margin-top:10px"><table class="tbl"><thead><tr><th>Campaign</th><th>Workspace</th><th>Type</th><th>Status</th><th>Applied</th><th>Pending</th><th>Approved</th><th>Declined</th><th></th></tr></thead><tbody>
      ${camps.map(c=>{ const pc = pipe.filter(p=>p.legacy_campaign_id===c.id);
        const appr = Number(c.approved)+pc.filter(p=>REPORT_APPROVED(p.stage)).length, decl = Number(c.declined)+pc.filter(p=>["ineligible","brand_declined","dropped","rejected"].includes(p.stage)).length;
        return `<tr data-acrow="${esc([c.name,c.brand,c.org_name].filter(Boolean).join(" ").toLowerCase())}"><td><b>${esc(c.name)}</b><div class="muted" style="font-size:12px">${esc(c.brand||"")}</div></td><td>${esc(c.org_name||"—")}</td>
        <td>${esc(campTypeLabel(c.campaign_type,c.barter_subtype)||"—")}</td>
        <td><select data-acstatus="${esc(c.id)}">${CAMP_STATUSES.map(s=>`<option${s===campStatusPick(c.status)?" selected":""}>${s}</option>`).join("")}</select></td>
        <td>${Number(c.applied)+pc.length}</td><td>${pendFor(c.id)?`<span class="tag warn">${pendFor(c.id)}</span>`:"0"}</td><td>${appr}</td><td>${decl}</td>
        <td style="white-space:nowrap">${c.status==="Approval"?`<button class="mini-btn" data-acgo="${esc(c.id)}">Approve campaign</button> `:""}<button class="mini-btn" data-acbp="${esc(c.id)}" data-acbpname="${esc(c.name)}">🔁 Process</button> <button class="mini-btn" data-acinv="${esc(c.id)}" data-acname="${esc(c.name)}">🎯 Invite</button> <button class="mini-btn ghost" data-acopen="${esc(c.id)}">${_acOpen===c.id?"Hide":"Applications"}</button> <button class="mini-btn ghost cdel-mini" title="Delete campaign" data-acdel="${esc(c.id)}">🗑</button></td></tr>
        ${_acOpen===c.id?`<tr data-acdetail="1"><td colspan="9"><div class="list">${pc.map(p=>applicantRowHtml(p)).join("")}
          ${legacy.filter(a=>a.campaign_id===c.id).map(a=>`<div class="row"><span class="avatar">${esc((a.creator_name||"?").slice(0,2).toUpperCase())}</span><div class="r-main"><div class="r-title">${esc(a.creator_name||"Creator")}</div><div class="r-sub">${esc(a.creator_org||"")}${a.decline_reason_code?` · ${esc(a.decline_reason_code)}`:""}${a.decline_note?` — ${esc(a.decline_note)}`:""}</div></div>
            ${a.status==="Applied"?`<span style="display:flex;gap:6px"><button class="mini-btn" data-acappr="${esc(a.id)}">Approve</button><button class="mini-btn ghost" data-acdecl="${esc(a.id)}">Decline</button></span>`:`<span class="tag ${a.status==="Approved"?"good":""}">${esc(a.status)}</span>`}</div>`).join("")}
          ${(!pc.length && !legacy.some(a=>a.campaign_id===c.id))?`<div class="muted" style="padding:8px">No applications yet.</div>`:""}</div></td></tr>`:""}`; }).join("")}
    </tbody></table></div>`:`<div class="muted" style="padding:8px">No campaigns${filter?" with this status":""}.</div>`}</div>`;
  const reload = ()=> adminCampaigns(body, true);
  body.querySelectorAll("[data-cdreview]").forEach(b2=> b2.onclick = ()=> openCampaignDeleteModal({ mode:"decide", request:delReq.list[+b2.dataset.cdreview], done:()=>{ _acSig=""; adminCampaigns(body); } }));
  body.querySelectorAll("[data-acdel]").forEach(b2=> b2.onclick = ()=>{ const cc = (cr.data||[]).find(x=>x.id===b2.dataset.acdel); if(cc) openCampaignDeleteModal({ mode:"admin", campaign:cc, done:()=>{ _acSig=""; adminCampaigns(body); } }); });
  body.querySelectorAll("[data-acinv]").forEach(b2=> b2.onclick = ()=> openInvitePanel(b2.dataset.acinv, b2.dataset.acname));
  body.querySelectorAll("[data-acbp]").forEach(b2=> b2.onclick = ()=> openBarterProcess(b2.dataset.acbp, b2.dataset.acbpname));
  document.getElementById("acFilter").onchange = ()=> adminCampaigns(body);
  document.getElementById("acPick").onchange = e=>{ _acPick = e.target.value; _acPickOpened = false; if(!_acPick) _acOpen = null; _acSig=""; adminCampaigns(body); };
  const q = document.getElementById("acQ");
  const applyQ = ()=>{ const t = (_acQ||"").trim().toLowerCase();
    body.querySelectorAll("tr[data-acrow]").forEach(tr=>{ const hit = !t || tr.dataset.acrow.includes(t); tr.style.display = hit ? "" : "none";
      const nx = tr.nextElementSibling; if(nx && nx.dataset.acdetail) nx.style.display = hit ? "" : "none"; }); };
  q.oninput = ()=>{ _acQ = q.value; applyQ(); };
  applyQ();
  body.querySelectorAll("[data-acan]").forEach(b2=> b2.onclick = ()=>{ openBarterProcess(b2.dataset.acan, b2.dataset.acanname); _bpTab = "analytics"; loadBpAnalytics(); });
  const clr = body.querySelector("#acPickClear"); if(clr) clr.onclick = ()=>{ _acPick = ""; _acOpen = null; _acSig=""; adminCampaigns(body); };
  document.getElementById("acType").onchange = ()=> adminCampaigns(body);
  body.querySelectorAll("[data-acgo]").forEach(b=> b.onclick = async ()=>{
    const { error } = await sb.rpc("admin_set_campaign_status", { p_id:b.dataset.acgo, p_status:"Live" });
    if(error) alert(error.message); _acSig=""; reload(); });
  body.querySelectorAll("[data-acopen]").forEach(b=> b.onclick = ()=>{ _acOpen = _acOpen===b.dataset.acopen ? null : b.dataset.acopen; _acSig=""; reload(); });
  body.querySelectorAll("[data-acstatus]").forEach(s=> s.onchange = async ()=>{
    const { error } = await sb.rpc("admin_set_campaign_status", { p_id:s.dataset.acstatus, p_status:s.value });
    if(error) alert(error.message); _acSig=""; reload();
  });
  body.querySelectorAll("[data-acappr]").forEach(b=> b.onclick = async ()=>{
    const { error } = await sb.rpc("decide_application", { p_id:b.dataset.acappr, p_approve:true, p_reason_code:null, p_note:null });
    if(error) alert(error.message); _acSig=""; reload();
  });
  body.querySelectorAll("[data-acdecl]").forEach(b=> b.onclick = ()=> declineLegacyApplication(b.dataset.acdecl, ()=>{ _acSig=""; reload(); }));
  wireApplicantButtons(body, ()=>{ _acSig=""; reload(); });
  clearInterval(_acTimer);
  _acTimer = setInterval(()=>{
    const b = document.getElementById("adminBody");
    if(currentPage!=="admin" || _adminTab!=="campaigns" || !b){ clearInterval(_acTimer); return; }
    if(document.visibilityState!=="visible" || document.querySelector(".modal-overlay.open") || (document.activeElement && ["SELECT","INPUT"].includes(document.activeElement.tagName))) return;
    adminCampaigns(b, true);
  }, 30000);
}

/* ================= MARKETPLACE (creator: browse + apply) ================= */
function renderMarketplace(){
  let html = pageHead("Campaign Marketplace","Browse open campaigns and apply.");
  html += `<div class="card" id="myAppsCard" style="margin-bottom:16px"><h3>My applications</h3>
    <div id="myAppsList"><div class="muted" style="padding:8px">Loading…</div></div></div>`;
  html += `<h3 style="margin:6px 0 12px">Open campaigns</h3>`;
  html += `<div class="grid three" id="marketGrid"><div class="card"><div class="muted">Loading…</div></div></div>`;
  return html;
}

// Keep the last-loaded open campaigns + the creator's applications so the detail modal & state
// can be rendered without refetching.
let _openCampaigns = [], _myApps = [];

async function loadMarketplace(){
  const grid=document.getElementById("marketGrid");
  if(!grid) return;
  if(!window.sb){ grid.innerHTML=`<div class="card"><div class="muted">Connect the database.</div></div>`; return; }
  const [oc, ma] = await Promise.all([ sb.rpc("open_campaigns"), sb.rpc("my_applications") ]);
  if(oc.error){ grid.innerHTML=`<div class="card"><div class="muted">Couldn't load: ${esc(oc.error.message)}</div></div>`; return; }
  _openCampaigns = oc.data||[];
  _myApps = (ma && ma.data) || [];
  renderMyApps();
  const appliedIds = new Set(_myApps.map(a=>a.campaign_id));
  const mine = (window.Auth && Auth.profile && Auth.profile.org_id) || null;
  if(!_openCampaigns.length){ grid.innerHTML=`<div class="card"><div class="ai-suggest"><span class="spark">🛒</span><div class="s-body"><b>No open campaigns yet</b><p>Campaigns in Sourcing or Live status show here to apply to.</p></div></div></div>`; return; }
  grid.innerHTML = _openCampaigns.map(c=>{
    const own = mine && c.org_id === mine; // don't let a creator "apply" to their own org's campaign
    const applied = appliedIds.has(c.id);
    const meta = [c.brand, c.type, c.budget?fmtMoney(c.budget):null, c.platforms].filter(Boolean).map(esc).join(" · ");
    const deliv = c.deliverables ? `<div class="mk-sub" style="margin-top:8px">📦 ${esc(c.deliverables.slice(0,90))}${c.deliverables.length>90?"…":""}</div>` : "";
    return `<div class="card"><h3>${esc(c.name)}<span class="tag good">${esc(c.status)}</span></h3>
    <div class="muted">${meta||"—"}${c.org_name?` · ${esc(c.org_name)}`:""}</div>
    ${deliv}
    <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
      <button class="btn ghost" data-viewcamp="${esc(c.id)}">View details</button>
      ${own?`<span class="muted" style="align-self:center;font-size:12px">Your campaign</span>`
        :applied?`<button class="btn ghost" disabled>✓ Applied</button>`
        :`<button class="btn" data-apply="${esc(c.id)}">Apply →</button>`}</div></div>`;
  }).join("");
  grid.querySelectorAll("button[data-apply]").forEach(b=>b.onclick=()=>applyToCampaign(b.dataset.apply, b));
  grid.querySelectorAll("[data-viewcamp]").forEach(b=>b.onclick=()=>{ const c=_openCampaigns.find(x=>x.id===b.dataset.viewcamp); if(c) openCampaignDetail(c); });
}

function renderMyApps(){
  const wrap = document.getElementById("myAppsList");
  const card = document.getElementById("myAppsCard");
  if(!wrap) return;
  if(!_myApps.length){ if(card) card.style.display="none"; return; }
  if(card) card.style.display="";
  const badge = s => `<span class="tag ${s==="Approved"?"good":s==="Declined"?"":"warn"}">${esc(s||"Applied")}</span>`;
  wrap.innerHTML = _myApps.map(a=>`<div class="row">
    <div class="r-main"><div class="r-title">${esc(a.campaign_name)||"Campaign"}</div>
    <div class="r-sub">${[a.agency_name,a.brand,a.type].filter(Boolean).map(esc).join(" · ")||"—"}</div></div>
    ${badge(a.status)}
    <button class="mini-btn ghost" data-viewapp="${esc(a.id)}">Details</button></div>`).join("");
  wrap.querySelectorAll("[data-viewapp]").forEach(b=>b.onclick=()=>{ const a=_myApps.find(x=>x.id===b.dataset.viewapp); if(a) openCampaignDetail(a, true); });
}

// Rich read-only campaign detail — used from both an open-campaign card and a My-Applications row.
function openCampaignDetail(c, isApp){
  let m = document.getElementById("campDetailModal"); if(m) m.remove();
  const row = (label,val)=> val ? `<div class="cd-row"><span class="cd-l">${label}</span><span class="cd-v">${esc(val)}</span></div>` : "";
  const dates = (c.start_date||c.end_date) ? `${c.start_date||"—"} → ${c.end_date||"—"}` : "";
  m = el("div","modal-overlay"); m.id="campDetailModal";
  m.innerHTML = `<div class="modal modal-lg"><div class="modal-head"><strong>${esc(c.campaign_name||c.name)||"Campaign"}</strong><button class="icon-btn" id="cdClose">✕</button></div>
    <div class="modal-form">
      ${isApp?`<div style="margin-bottom:4px"><span class="tag ${c.status==="Approved"?"good":c.status==="Declined"?"":"warn"}">${esc(c.status||"Applied")}</span></div>`:""}
      ${row("Agency", c.agency_name||c.org_name)}
      ${row("Brand", c.brand)}
      ${row("Type", c.type)}
      ${row("Objective", c.objective)}
      ${row("Budget", c.budget?fmtMoney(c.budget):"")}
      ${row("Platforms", c.platforms)}
      ${row("Hashtags", c.hashtags)}
      ${row("Timeline", dates)}
      ${c.deliverables?`<div class="cd-block"><div class="cd-l">Deliverables</div><div class="cd-body">${esc(c.deliverables)}</div></div>`:""}
      ${c.brief?`<div class="cd-block"><div class="cd-l">Brief</div><div class="cd-body">${esc(c.brief)}</div></div>`:""}
      ${(!isApp && !(Auth.profile&&Auth.profile.org_id===c.org_id))?`<button class="btn" id="cdApply" data-apply="${esc(c.id)}" style="margin-top:6px">Apply →</button>`:""}
    </div></div>`;
  document.body.appendChild(m); m.classList.add("open");
  m.onclick = e=>{ if(e.target.id==="campDetailModal") m.classList.remove("open"); };
  document.getElementById("cdClose").onclick = ()=> m.classList.remove("open");
  const ap = document.getElementById("cdApply");
  if(ap) ap.onclick = ()=> applyToCampaign(ap.dataset.apply, ap);
}

async function applyToCampaign(id, btn){
  if(!window.sb) return;
  btn.disabled=true; btn.textContent="Applying…";
  // Server-side RPC validates the campaign and sets the agency routing (can't be forged).
  const { error } = await sb.rpc("apply_to_campaign", { p_campaign_id: id });
  if(error){ btn.disabled=false; btn.textContent="Try again"; alert("Couldn't apply: "+error.message); return; }
  btn.textContent = "✓ Applied"; btn.classList.add("ghost");
  const dm = document.getElementById("campDetailModal"); if(dm) dm.classList.remove("open");
  await loadMarketplace(); // refresh My applications + card states
}

/* ================= BRAND CRM / PORTFOLIO (derived from campaigns) ================= */
function brandTableHtml(title, sub){
  return pageHead(title, sub) + `<div class="card"><table><thead><tr><th>Brand</th><th>Campaigns</th><th>Active</th><th>Creators</th></tr></thead>
    <tbody id="brandRows"><tr><td colspan="4" class="muted" style="padding:24px">Loading…</td></tr></tbody></table></div>`;
}
function renderBrands(){ return brandTableHtml("Brand CRM","Every brand you work with, from your campaigns."); }
function renderPortfolio(){ return brandTableHtml("Portfolio","All brands & campaigns across your group."); }
async function loadBrands(){
  const body=document.getElementById("brandRows");
  if(!body||!window.sb) return;
  const { data, error } = await sb.from("campaigns").select("brand,status,creators");
  if(error){ body.innerHTML=`<tr><td colspan="4" class="muted" style="padding:24px">Couldn't load: ${esc(error.message)}</td></tr>`; return; }
  const map={}; const active=["Live","Shortlist completed","In Production","Sourcing","Approval"];
  (data||[]).forEach(c=>{ const b=((c.brand||"").trim())||"—"; map[b]=map[b]||{n:0,active:0,creators:0};
    map[b].n++; if(active.includes(c.status)) map[b].active++; map[b].creators+=parseInt(c.creators)||0; });
  const rows=Object.entries(map);
  body.innerHTML = rows.length ? rows.map(([b,v])=>`<tr><td><span class="avatar">${esc(b.slice(0,2).toUpperCase())}</span>${esc(b)}</td><td>${v.n}</td><td>${v.active}</td><td>${v.creators}</td></tr>`).join("") : `<tr><td colspan="4" class="muted" style="padding:24px">No brands yet — add a campaign with a brand.</td></tr>`;
}

/* ================= FINANCE (derived economics) ================= */
function renderFinance(){
  let html = pageHead("Finance","Barter value, EMV & celebrity deal economics.");
  html += `<div class="kpi-row">
    <div class="kpi"><div class="k-label">Barter Value</div><div class="k-val" id="fin-barter">…</div></div>
    <div class="kpi"><div class="k-label">Est. EMV</div><div class="k-val" id="fin-emv">…</div></div>
    <div class="kpi"><div class="k-label">Celebrity Fees</div><div class="k-val" id="fin-fees">…</div></div>
    <div class="kpi"><div class="k-label">Deal Value</div><div class="k-val" id="fin-deals">…</div></div></div>`;
  html += `<div class="card"><h3>Campaign Economics</h3><div class="list" id="finRows"><div class="muted" style="padding:8px">Loading…</div></div></div>`;
  return html;
}
async function loadFinance(){
  if(!window.sb) return;
  const [ba,st,ca] = await Promise.all([
    sb.from("barter_items").select("value"),
    sb.from("story_deals").select("value,fee"),
    sb.from("campaigns").select("name,brand,creators,status").order("created_at",{ascending:false})
  ]);
  const B=ba.data||[], S=st.data||[], C=ca.data||[];
  const barterVal=B.reduce((s,x)=>s+(Number(x.value)||0),0);
  const emv=barterVal + S.reduce((s,x)=>s+(Number(x.value)||0),0);
  const fees=S.reduce((s,x)=>s+(Number(x.fee)||0),0);
  const dealVal=S.reduce((s,x)=>s+(Number(x.value)||0),0);
  const set=(id,v)=>{ const e=document.getElementById(id); if(e) e.textContent=v; };
  set("fin-barter",fmtMoney(barterVal)); set("fin-emv",fmtMoney(emv)); set("fin-fees",fmtMoney(fees)); set("fin-deals",fmtMoney(dealVal));
  const rows=document.getElementById("finRows");
  if(rows){ rows.innerHTML = C.length ? C.map(c=>`<div class="row"><div class="r-main"><div class="r-title">${esc(c.name)}</div><div class="r-sub">${esc(c.brand)||"—"} · ${parseInt(c.creators)||0} creators · ${esc(c.status)||""}</div></div></div>`).join("") : `<div class="muted" style="padding:8px">No campaigns yet.</div>`; }
}

/* ================= LOGISTICS (barter shipping) ================= */
function renderLogistics(){
  let html = pageHead("Logistics","Barter shipping — from request to delivery.");
  html += `<div class="ws-stats" id="logStats" style="grid-template-columns:repeat(auto-fill,minmax(130px,1fr))"></div>`;
  html += `<div class="card"><h3>Courier tracking</h3>
      <p class="muted" style="font-size:13px;margin:0 0 10px">Every product going out on a barter campaign — courier, tracking number, sent and received.</p>
      <div id="logShip">${skel("table")}</div></div>`;
  html += `<div class="card"><h3>Barter batches</h3><div class="list" id="logRows"><div class="muted" style="padding:8px">Loading…</div></div></div>`;
  return html;
}
async function loadShipments(){
  const box = document.getElementById("logShip"), stats = document.getElementById("logStats");
  if(!box || !window.sb) return;
  const { data, error } = await sb.schema("api").rpc("shipments_board").then(r=>r, e=>({error:e}));
  if(error){ box.innerHTML = `<div class="muted">${esc(error.message||error)}</div>`; return; }
  const L = data||[];
  const n = s => L.filter(x=>x.status===s).length;
  if(stats) stats.innerHTML = `<div class="ws-stat"><b>${L.length}</b><span>Shipments</span></div>
      <div class="ws-stat"><b>${n("pending")}</b><span>To send</span></div>
      <div class="ws-stat"><b>${n("shipped")}</b><span>In transit</span></div>
      <div class="ws-stat"><b>${n("delivered")}</b><span>Received</span></div>
      <div class="ws-stat"><b>${L.filter(x=>!x.has_address).length}</b><span>No address yet</span></div>`;
  const tag = { pending:['⏳ To send','warn'], shipped:['🚚 In transit','brand'], delivered:['✅ Received','good'], failed:['⚠️ Failed','warn'] };
  box.innerHTML = L.length ? `<table class="tbl"><thead><tr><th>Creator</th><th>Campaign</th><th>Product</th><th>Courier / tracking</th><th>Sent</th><th>Received</th><th>Status</th></tr></thead><tbody>${
    L.map(s=>{ const c = s.creator||{}, t = tag[s.status]||[s.status,'warn'];
      return `<tr><td><b>${esc(c.name||c.username||"Creator")}</b>${c.username?`<div class="muted" style="font-size:12px">@${esc(c.username)}</div>`:""}${s.has_address?"":'<div class="muted" style="font-size:11.5px">⚠️ no address on file</div>'}</td>
        <td>${esc(s.campaign||"—")}<div class="muted" style="font-size:12px">${esc(s.brand||s.org_name||"")}</div></td>
        <td>${esc(s.product||"—")}</td>
        <td>${esc(s.courier||"—")}${s.tracking_ref?`<div class="muted" style="font-size:12px">${esc(s.tracking_ref)}</div>`:""}</td>
        <td>${s.shipped_at?esc(fmtDate(s.shipped_at)):"—"}</td>
        <td>${s.delivered_at?esc(fmtDate(s.delivered_at)):"—"}</td>
        <td><span class="tag ${t[1]}">${t[0]}</span></td></tr>`; }).join("")}</tbody></table>`
    : `<div class="muted">No products shipped yet. Open a barter campaign → <b>Barter process</b> to send the first one — courier and tracking land here.</div>`;
}
async function loadLogistics(){
  loadShipments();
  const wrap=document.getElementById("logRows");
  if(!wrap||!window.sb) return;
  const { data, error } = await sb.from("barter_items").select("*").order("created_at",{ascending:false});
  if(error){ wrap.innerHTML=`<div class="muted" style="padding:8px">Couldn't load: ${esc(error.message)}</div>`; return; }
  const list=data||[];
  const dot={Requested:"warn",Matched:"warn",Shipped:"brand","Content Live":"good",Completed:"good"};
  const label={Requested:"To ship",Matched:"To ship",Shipped:"In transit","Content Live":"Delivered",Completed:"Delivered"};
  wrap.innerHTML = list.length ? list.map(b=>`<div class="row"><span class="dot ${dot[b.stage]||"warn"}"></span><div class="r-main"><div class="r-title">${esc(b.product||b.creator||"Barter item")}</div><div class="r-sub">${esc(b.creator)||"—"}</div></div><span class="tag ${dot[b.stage]||"warn"}">${esc(label[b.stage]||b.stage||"To ship")}</span></div>`).join("") : `<div class="muted" style="padding:8px">No shipments yet — start a barter batch.</div>`;
}

/* ================= IRM (irm_contacts) ================= */
const IRM_STATUSES = ["New","Active","Warm","At Risk","Dormant"];
function renderIRM(){
  let html = pageHead("IRM — Influencer Relationships","Every creator & celebrity relationship, kept warm.",`<span id="addIrmBtn">+ Add Contact</span>`);
  html += `<div class="card"><table><thead><tr><th>Contact</th><th>Type</th><th>Status</th><th>Health</th><th>Last touch</th><th>Reach out</th></tr></thead>
    <tbody id="irmRows"><tr><td colspan="6" class="muted" style="padding:24px">Loading…</td></tr></tbody></table></div>`;
  return html;
}
function irmHealthBar(h){ h=Math.max(0,Math.min(100,parseInt(h)||0)); return `<div class="bar" style="width:90px;display:inline-block;vertical-align:middle"><span style="width:${h}%"></span></div> <span class="muted">${h}</span>`; }
async function loadIRM(){
  const body=document.getElementById("irmRows");
  if(!body||!window.sb) return;
  const { data, error } = await sb.from("irm_contacts").select("*").order("created_at",{ascending:false});
  if(error){ body.innerHTML=`<tr><td colspan="6" class="muted" style="padding:24px">IRM isn't set up yet (run the latest DATABASE_SETUP.sql). ${esc(error.message)}</td></tr>`; return; }
  const list=data||[];
  const reach = x=>{
    const wa = x.whatsapp || x.phone;
    if(x.preferred_channel!=="email" && wa) return `<a class="mini-btn" href="${esc(waLink(wa, "Hi "+(x.name||"")+"!"))}" target="_blank" rel="noopener">💬 WhatsApp</a>`;
    if(x.email) return `<a class="mini-btn ghost" href="${esc(mailtoLink(x.email,"Hello from "+((Auth.profile&&Auth.profile.org)||"us"),"Hi "+(x.name||"")+"!"))}">✉ Email</a>`;
    return `<span class="muted">—</span>`;
  };
  body.innerHTML = list.length ? list.map(x=>`<tr><td><span class="avatar">${esc((x.name||"?").slice(0,2).toUpperCase())}</span>${esc(x.name)}</td>
    <td><span class="tag brand">${esc(x.kind||"Creator")}</span></td>
    <td>${esc(x.status||"New")}</td>
    <td>${irmHealthBar(x.health)}</td>
    <td>${esc(x.last_touch)||"—"}</td>
    <td>${reach(x)}</td></tr>`).join("") : `<tr><td colspan="6" class="muted" style="padding:24px">No contacts yet — add your first relationship 👆</td></tr>`;
}
function openIrmModal(){
  let m = document.getElementById("irmModal");
  if(!m){
    m = el("div","modal-overlay"); m.id="irmModal";
    m.innerHTML = `<div class="modal"><div class="modal-head"><strong>Add Contact</strong><button class="icon-btn" id="imClose">✕</button></div>
      <form id="irmForm" class="modal-form">
        <div class="mf-row"><label>Name<input name="name" required placeholder="Aarav Mehta"></label>
        <label>Type<select name="kind"><option>Creator</option><option>Celebrity</option><option>Brand</option><option>Manager</option></select></label></div>
        <div class="mf-row"><label>Status<select name="status">${IRM_STATUSES.map(s=>`<option>${s}</option>`).join("")}</select></label>
        <label>Health (0–100)<input name="health" type="number" min="0" max="100" placeholder="60"></label></div>
        <div class="mf-row"><label>Last touch<input name="last_touch" type="date"></label>
        <label>Handle<input name="handle" placeholder="@aarav"></label></div>
        <div class="mf-sec">Contact (WhatsApp preferred)</div>
        <div class="mf-row"><label>WhatsApp<input name="whatsapp" placeholder="+91 98xxxxxxxx"></label>
        <label>Email<input name="email" type="email" placeholder="aarav@email.com"></label></div>
        <div class="mf-row"><label>Preferred channel<select name="preferred_channel"><option value="whatsapp">WhatsApp</option><option value="email">Email</option></select></label>
        <label>Notes<input name="notes" placeholder="Likes tech barters"></label></div>
        <div class="auth-err" id="imErr"></div>
        <button class="btn" type="submit">Add Contact</button></form></div>`;
    document.body.appendChild(m);
  }
  m.classList.add("open");
  m.onclick = e=>{ if(e.target.id==="irmModal") m.classList.remove("open"); };
  document.getElementById("imClose").onclick = ()=> m.classList.remove("open");
  document.getElementById("irmForm").onsubmit = async e=>{
    e.preventDefault();
    const f=new FormData(e.target), err=document.getElementById("imErr"), btn=e.target.querySelector("button[type=submit]");
    err.textContent=""; btn.disabled=true; btn.textContent="Saving…";
    const row={ name:f.get("name"), kind:f.get("kind"), status:f.get("status"), health:parseInt(f.get("health"))||null,
      last_touch:f.get("last_touch")||null, handle:f.get("handle"), notes:f.get("notes"),
      whatsapp:f.get("whatsapp"), email:(f.get("email")||"").toLowerCase(), preferred_channel:f.get("preferred_channel") };
    if(window.Auth&&Auth.profile){ row.org_id=Auth.profile.org_id; }
    try{ if(!window.sb) throw new Error("Database not connected."); const { error }=await sb.from("irm_contacts").insert(row); if(error) throw error;
      m.classList.remove("open"); await loadIRM();
    }catch(ex){ err.textContent=ex.message||"Couldn't save."; btn.disabled=false; btn.textContent="Add Contact"; }
  };
}

/* ================= LISTENING (mentions from connected IG accounts) ================= */
function renderListening(){
  let html = pageHead("Listening","Mentions & tags across your connected accounts — real data from Instagram.");
  html += `<div class="card"><h3>Recent mentions</h3>
    <p class="muted" style="margin-bottom:12px">Every post that tagged or mentioned a connected creator. Connect Instagram (Media Kit → Connect) to populate this.</p>
    <div id="listenGrid" class="mk-grid"><div class="muted" style="padding:8px">Loading…</div></div></div>`;
  html += `<div class="ai-suggest" style="margin-top:12px"><span class="spark">📡</span><div class="s-body"><b>More listening is coming</b>
    <p>Keyword & hashtag tracking and brand-mention alerts activate as more platform integrations (Meta pages, YouTube, LinkedIn) come online in Settings → Integrations.</p></div></div>`;
  return html;
}
async function loadListening(){
  const grid = document.getElementById("listenGrid");
  if(!grid || !window.sb) return;
  // social_accounts is org-readable; pull mentions from every connected account in the org.
  const { data, error } = await sb.from("social_accounts").select("username, mentions");
  if(error){ grid.innerHTML = `<div class="muted" style="padding:8px">Couldn't load mentions: ${esc(error.message)}</div>`; return; }
  const all = [];
  (data||[]).forEach(acc=>{
    (Array.isArray(acc.mentions)?acc.mentions:[]).forEach(m=> all.push(Object.assign({ _on:acc.username }, m)));
  });
  if(!all.length){ grid.innerHTML = `<div class="muted" style="padding:8px">No mentions yet. Once a connected creator is tagged on Instagram, those posts show up here.</div>`; return; }
  grid.innerHTML = all.slice(0,24).map(m=>{
    const img = m.media_type==="VIDEO" ? (m.thumbnail_url||m.media_url) : m.media_url;
    return `<a href="${esc(safeUrl(m.permalink))}" target="_blank" rel="noopener" class="mk-post">
      ${img?`<img src="${esc(safeUrl(img))}" alt="" loading="lazy">`:`<div class="mk-post-noimg">@${esc(m.username||"tagged")}</div>`}
      <span class="mk-meta">@${esc(m.username)||"tagged"} → @${esc(m._on)}</span></a>`;
  }).join("");
}

/* ================= ROSTER (talent manager — reuse creators) ================= */
function renderRoster(){
  // Reuses the creators loader (loadCreators → applyCreatorFilters), so the header row must
  // match the discovery-era columns that creatorRowsHtml renders.
  return pageHead("My Roster","Your talent — manage & match to briefs.",`<span id="addCreatorBtn">+ Add Creator</span>`) +
    `<div class="card"><table><thead><tr><th>Creator</th><th>City</th><th>Tier</th><th>Followers</th><th>Contact</th><th>App</th><th>Actions</th></tr></thead>
    <tbody id="creatorRows"><tr><td colspan="8" class="muted" style="padding:24px">Loading…</td></tr></tbody></table></div>`;
}

/* ================= MEDIA KIT (Instagram) ================= */
function renderMediaKit(){
  let html = pageHead("Media Kit","Your reach, audience and best work — auto-built from Instagram and shareable with brands.");
  html += mkGateBanner();
  html += `<div id="mkBody">${mkLoadingHtml()}${skel("kit")}</div>`;
  return html;
}
// Until Instagram + WhatsApp are connected, the Media Kit shows what's left on top
function mkGateBanner(){
  if(currentRole!=="creator" || !window.__profileGate) return `<div id="mkGateBanner"></div>`;
  return joinGateCard("mkGateBanner");
}
document.addEventListener("click", e=>{ if(e.target && e.target.id==="mkGoProfile"){ currentPage="profile"; renderShell(); } });

function mkNotConnected(){
  return `<div class="card mk-connect">
    <div class="mk-connect-ic">📸</div>
    <h2 style="margin:6px 0">Build your media kit in seconds</h2>
    <p class="muted" style="max-width:440px;margin:0 auto 16px">Connect your Instagram Business or Creator account and we'll auto-generate a professional media kit — followers, engagement, top posts — and let you publish right from here.</p>
    <button class="btn big" id="mkConnect">Connect Instagram</button>
    <div class="muted" style="font-size:12px;margin-top:12px">We never see your password. Disconnect anytime.</div>
  </div>`;
}

function mkEdits(a){
  const E = (a && a.edits && typeof a.edits==="object" && !Array.isArray(a.edits)) ? { ...a.edits } : {};
  // a hand-written bio belongs to the account it was written for; otherwise the account's own Instagram bio shows
  const me = String((a && (a.ig_user_id || a.username)) || "");
  if(E.bio && (!E.for || String(E.for) !== me)) delete E.bio;
  return E;
}

// how many items each Media Kit section shows (grows with "Load more"; kept across the 60 s refresh)
let _mkShown = { top:6, show:9, ment:6, port:6, collab:6 };
const MK_STEP = { top:6, show:9, ment:6, port:6, collab:6 };
// every post we know: the latest (refreshed every minute) + the whole-account scan, newest first, no duplicates
function mkAllMedia(a){
  const seen = new Set(), out = [];
  [].concat(Array.isArray(a.recent_media)?a.recent_media:[], Array.isArray(a.archive_media)?a.archive_media:[]).forEach(m=>{
    const k = m && (m.id || m.permalink); if(!k || seen.has(k)) return; seen.add(k); out.push(m); });
  return out.sort((x,y)=> String(y.timestamp||"").localeCompare(String(x.timestamp||"")));
}
function mkMoreBtn(key, total){
  const shown = _mkShown[key]||0;
  return total > shown ? `<div class="mk-more"><button class="btn sm ghost" data-mkmore="${key}">Load more <span class="muted">(${total - shown} more)</span></button></div>` : "";
}
// What this Instagram account is about — read from ITS OWN bio + captions (each account gets its own),
// and its type in plain words (Instagram's API doesn't hand out the category label shown in the app)
const IG_CAT_WORDS = {
  "Food":["food","foodie","recipe","recipes","chef","cook","cooking","baking","restaurant","cafe","eats","dessert","biryani","momos","streetfood","foodblogger","homecook"],
  "Travel":["travel","traveller","traveler","wanderlust","trip","explore","backpack","mountains","beach","roadtrip","travelblogger","trek","hiking"],
  "Fashion":["fashion","style","outfit","ootd","streetwear","stylist","wardrobe","designer","lookbook"],
  "Beauty":["beauty","makeup","skincare","mua","cosmetic","hair","nails","glow","skin"],
  "Fitness":["fitness","gym","workout","yoga","athlete","bodybuilding","trainer","running","fit","calisthenics"],
  "Health":["health","wellness","nutrition","diet","doctor","mentalhealth","ayurveda"],
  "Tech":["tech","gadget","gadgets","smartphone","coding","developer","unboxing","review","ai","laptop"],
  "Comedy":["comedy","comedian","funny","memes","meme","standup","skits","humour","humor"],
  "Entertainment":["actor","actress","entertainment","film","movies","bollywood","reels","creator","influencer"],
  "Parenting":["mom","mommy","mother","dad","parenting","baby","kids","momblogger","parent"],
  "Gaming":["gaming","gamer","esports","bgmi","pubg","valorant","stream","twitch","playstation"],
  "Finance":["finance","investing","stocks","money","trading","crypto","personalfinance","ca"],
  "Business":["business","entrepreneur","startup","founder","marketing","brand","ceo"],
  "Education":["education","teacher","learn","study","tutor","exam","upsc","career"],
  "Music":["music","singer","musician","rapper","guitar","producer","dj","song"],
  "Dance":["dance","dancer","choreographer","kathak","bharatanatyam","hiphop"],
  "Art":["art","artist","illustrator","painting","sketch","drawing","digitalart","craft","diy"],
  "Photography":["photography","photographer","photo","camera","shotby","portrait","canon","nikon"],
  "Sports":["sports","cricket","football","athlete","badminton","tennis","cyclist","marathon"],
  "Pets":["pet","pets","dog","dogs","cat","cats","puppy","petlover","doglover"],
  "Home decor":["decor","homedecor","interior","interiors","home","plants","furniture"],
  "Auto":["car","cars","bike","bikes","auto","automobile","rider","motorcycle","supercar"],
  "Lifestyle":["lifestyle","life","vlog","vlogger","daily","blogger","everyday"]
};
function igCategories(a){
  const text = (String(a && a.biography || "") + " " + (Array.isArray(a && a.recent_media) ? a.recent_media.slice(0,12).map(m=>m && m.caption || "").join(" ") : "")).toLowerCase();
  const words = new Set(text.replace(/[#@]/g," ").split(/[^a-z0-9]+/).filter(Boolean));
  const score = Object.entries(IG_CAT_WORDS).map(([cat, ws])=>[cat, ws.reduce((n,w)=> n + (words.has(w)?1:0), 0)]).filter(x=>x[1]>0)
    .sort((x,y)=>y[1]-x[1]);
  const out = score.filter(x=>x[0]!=="Lifestyle" && x[0]!=="Entertainment").slice(0,3).map(x=>x[0]);
  if(!out.length && score.length) out.push(score[0][0]);
  return out;
}
function igTypeLabel(t){ t = String(t||"").toUpperCase(); return t==="MEDIA_CREATOR"||t==="CREATOR" ? "Creator account" : t==="BUSINESS" ? "Business account" : t ? t.replace(/_/g," ").toLowerCase() : ""; }
window.igCategories = igCategories; window.igTypeLabel = igTypeLabel;
function mkHead(a){
  const E = mkEdits(a);
  const media = Array.isArray(a.recent_media) ? a.recent_media : [];
  const all = mkAllMedia(a);
  const n = media.length || 0;
  const sum = (k)=> media.reduce((s,m)=>s+(Number(m[k])||0),0);
  const avgLikes = n ? Math.round(sum("like_count")/n) : 0;
  const avgComments = n ? Math.round(sum("comments_count")/n) : 0;
  const engStr = (a.followers_count && n) ? (((avgLikes+avgComments)/a.followers_count)*100).toFixed(2)+"%" : "—";
  const reachStr = a.avg_reach ? fmtNum(a.avg_reach) : "—";
  const initials = esc((a.name||a.username||"?").slice(0,2).toUpperCase());
  const firstName = esc((a.name||a.username||"me").split(" ")[0]);
  const bio = E.bio || a.biography || "";
  const headline = E.headline || "";

  const eng = m=>(Number(m.like_count)||0)+(Number(m.comments_count)||0);
  // top performing across the WHOLE account (likes + comments), not just the latest posts
  const sorted = all.filter(m=> eng(m) > 0).sort((x,y)=>eng(y)-eng(x));
  const postCard = (m,meta)=>{
    const img = m.media_type==="VIDEO" ? (m.thumbnail_url||m.media_url) : m.media_url;
    const badge = m.media_type==="VIDEO" ? "▶" : (m.media_type==="CAROUSEL_ALBUM" ? "❏" : "");
    return `<a href="${esc(safeUrl(m.permalink))}" target="_blank" rel="noopener" class="mk-post">
      <img src="${esc(safeUrl(img))}" alt="" loading="lazy">${badge?`<span class="mk-type">${badge}</span>`:""}
      <span class="mk-meta">${meta||`❤ ${fmtNum(m.like_count)} · 💬 ${fmtNum(m.comments_count)}`}</span></a>`;
  };
  const posts = all.slice(0,_mkShown.show).map(m=>postCard(m)).join("");
  const tops = sorted.slice(0,_mkShown.top).map((m,i)=>postCard(m, `${i<3?["🥇","🥈","🥉"][i]+" ":""}❤ ${fmtNum(m.like_count)} · 💬 ${fmtNum(m.comments_count)}`)).join("");

  const tile = (val,label,accent)=>`<div class="mk-tile ${accent||''}"><div class="mk-tile-v">${val}</div><div class="mk-tile-l">${label}</div></div>`;
  const editBtn = (s)=>`<button class="mk-edit" data-mkedit="${s}">✎ Edit</button>`;

  // Audience demographics
  const aud = (a.audience && typeof a.audience==="object") ? a.audience : {};
  const topOf = (obj,k)=>{ const en=Object.entries(obj||{}).sort((x,y)=>y[1]-x[1]).slice(0,k); const total=Object.values(obj||{}).reduce((s,v)=>s+Number(v||0),0)||1; return en.map(([kk,v])=>({k:kk,pct:Math.round(Number(v)/total*100)})); };
  const audGA=topOf(aud.gender_age,6), audCountries=topOf(aud.country,5), audCities=topOf(aud.city,5);
  const hasAudience = audGA.length||audCountries.length||audCities.length;
  const barRow=(label,pct)=>`<div class="mk-bar-row"><span class="mk-bar-l">${esc(label)}</span><span class="mk-bar-track"><span style="width:${pct}%"></span></span><span class="mk-bar-v">${pct}%</span></div>`;

  // Mentions
  const mentions = Array.isArray(a.mentions)?a.mentions:[];
  const mentionCards = mentions.slice(0,_mkShown.ment).map(m=>postCard(m, "@"+(esc(m.username)||"tagged"))).join("");

  // Work portfolio = campaigns done on Geek OS (filled in by mkCampaignWork) + this account's past brand collaborations /
  // paid partnerships found in its own posts + anything the creator added by hand
  const COLLAB_RX = /#(ad|ads|sponsored|collab|collaboration|paidpartnership|partnership|gifted|brandpartner|ambassador|promo)\b|paid partnership|in collaboration with|sponsored by|in association with/i;
  const collabs = all.filter(m=> COLLAB_RX.test(String(m.caption||""))).map(m=>{
    const tag = (String(m.caption||"").match(/@([a-z0-9._]{2,30})/i)||[])[1] || "";
    return { m, brand: tag ? "@"+tag : "Brand collaboration" }; });
  const collabCards = collabs.slice(0, _mkShown.collab || 6).map(x=> postCard(x.m, esc(x.brand))).join("");
  const portfolio = Array.isArray(E.portfolio)?E.portfolio:[];
  const portfolioHtml = portfolio.length
    ? `<div class="mk-portfolio">${portfolio.slice(0,_mkShown.port).map(p=>`<div class="mk-brand"><div class="mk-brand-ic">${esc((p.brand||'?').slice(0,2).toUpperCase())}</div><div class="mk-brand-b"><div class="mk-brand-n">${esc(p.brand)}</div>${p.note?`<div class="muted" style="font-size:12px">${esc(p.note)}</div>`:''}</div>${p.url?`<a href="${esc(safeUrl(p.url))}" target="_blank" rel="noopener" class="mk-brand-link">↗</a>`:''}</div>`).join("")}</div>`
    : `<div class="muted" style="padding:8px">No collaborations yet — click <b>Edit</b> to showcase brands you've worked with.</div>`;
  const scanning = !a.archive_synced_at;

  return `<div class="mk-kit">
    <div class="mk-cover">
      <div class="mk-cover-grad"></div>
      <div class="mk-hero">
        ${a.profile_picture_url?`<img class="mk-avatar" src="${esc(safeUrl(a.profile_picture_url))}" alt="">`:`<div class="mk-avatar mk-ph">${initials}</div>`}
        <div class="mk-hero-id">
          <div class="mk-name">${esc(a.name)||esc(a.username)} ${a.account_type?`<span class="mk-badge">${esc(igTypeLabel(a.account_type))}</span>`:""}</div>
          <div class="mk-handle">@${esc(a.username)}</div>
          ${igCategories(a).length?`<div class="mk-cats">${igCategories(a).map(c=>`<span>${esc(c)}</span>`).join("")}</div>`:""}
          ${headline?`<div class="mk-headline">${esc(headline)}</div>`:''}
          ${bio?`<div class="mk-bio">${esc(bio)}</div>`:""}
          ${a.website?`<a class="mk-web" href="${esc(safeUrl(a.website))}" target="_blank" rel="noopener">🔗 ${esc(a.website)}</a>`:""}
        </div>
        <div class="mk-hero-actions"><button class="mk-share" id="mkShare">Share kit</button>${editBtn("profile")}</div>
      </div>
    </div>

    <div class="mk-tiles">
      ${tile(fmtNum(a.followers_count),"Followers","hero")}
      ${tile(engStr,"Avg. engagement")}
      ${tile(reachStr,"Avg. reach / post")}
      ${tile(fmtNum(avgLikes),"Avg. likes")}
      ${tile(fmtNum(a.media_count),"Total posts")}
    </div>

    <div class="card mk-section mk-aud-card"><div class="mk-sec-head"><h3>Audience</h3></div>
      ${(window.mkAudienceHtml && window.mkAudienceHtml(a.audience)) || `<div class="muted" style="padding:8px">Audience demographics appear automatically once your Instagram Insights sync (needs 100+ followers and approved insights access).</div>`}
    </div>

    <div class="card mk-section"><div class="mk-sec-head"><h3>Top performing posts</h3><span class="muted mk-sec-sub">${scanning?"⏳ checking your whole account…":`best of ${fmtNum(all.length)} posts · likes + comments`}</span></div>
      ${tops?`<div class="mk-grid">${tops}</div>${mkMoreBtn("top", sorted.length)}`:`<div class="muted" style="padding:8px">${scanning?"Finding your best posts…":"No posts yet."}</div>`}</div>

    <div class="card mk-section"><div class="mk-sec-head"><h3>Work portfolio</h3>${editBtn("portfolio")}</div><div id="mkCampWork"></div>
      ${collabs.length?`<div class="mk-cw-h">🤝 Past collaborations &amp; paid partnerships</div><div class="mk-grid">${collabCards}</div>${mkMoreBtn("collab", collabs.length)}`:""}
      ${portfolio.length?`<div class="mk-cw-h">✍️ Brands you added</div>`:""}${portfolio.length||!collabs.length?portfolioHtml:""}${mkMoreBtn("port", portfolio.length)}</div>

    <div class="card mk-section"><div class="mk-sec-head"><h3>Mentions</h3>${mentions.length?`<span class="muted mk-sec-sub">${fmtNum(mentions.length)} tagged posts</span>`:""}</div>
      ${mentionCards ? `<div class="mk-grid">${mentionCards}</div>${mkMoreBtn("ment", mentions.length)}` : `<div class="muted" style="padding:8px">Posts where brands &amp; others tag you will appear here once they're available from Instagram.</div>`}</div>

    <div class="card mk-section"><div class="mk-sec-head"><h3>Content showcase</h3>${all.length?`<span class="muted mk-sec-sub">${fmtNum(all.length)} posts</span>`:""}</div>
      ${posts?`<div class="mk-grid">${posts}</div>${mkMoreBtn("show", all.length)}`:`<div class="muted" style="padding:8px">No posts yet.</div>`}</div>

    <div class="card mk-section mk-collab">
      <div><h3 style="margin:0 0 2px">Work with ${firstName}</h3>
        <div class="muted">Barters, paid campaigns &amp; brand collaborations — managed end-to-end in Geek Influencer OS.</div></div>
      <button class="btn" id="mkComposeCta">Publish to Instagram →</button>
    </div>
  </div>`;
}

function openMkEdit(section, acct){
  const E = mkEdits(acct);
  let title="Edit", fields="";
  if(section==="profile"){
    title="Edit profile";
    fields = `<label>Headline / tagline<input name="headline" value="${esc(E.headline||'')}" placeholder="Tech &amp; lifestyle creator · Mumbai"></label>
      <label>Bio <span class="muted" style="font-weight:400">(leave as is to keep your Instagram bio — it updates on its own)</span><textarea name="bio" rows="3" placeholder="Short bio…">${esc(E.bio||acct.biography||'')}</textarea></label>`;
  } else if(section==="ratecard"){
    title="Edit rate card";
    const lines=(Array.isArray(E.rate_card)?E.rate_card:[]).map(r=>`${r.item} | ${r.price}`).join("\n");
    fields = `<div class="muted" style="margin-bottom:8px">One per line: <b>Service | Price</b></div>
      <label>Rates<textarea name="lines" rows="6" placeholder="Instagram Reel | ₹15,000&#10;Story (3 frames) | ₹5,000&#10;Static post | ₹10,000">${esc(lines)}</textarea></label>`;
  } else if(section==="portfolio"){
    title="Edit work portfolio";
    const lines=(Array.isArray(E.portfolio)?E.portfolio:[]).map(p=>[p.brand,p.note,p.url].filter(Boolean).join(" | ")).join("\n");
    fields = `<div class="muted" style="margin-bottom:8px">One per line: <b>Brand | Note (optional) | Link (optional)</b></div>
      <label>Collaborations<textarea name="lines" rows="6" placeholder="Nykaa | Summer barter campaign | https://instagram.com/p/…&#10;boAt | Paid reel">${esc(lines)}</textarea></label>`;
  }
  let m=document.getElementById("mkEditModal"); if(m) m.remove();
  m=el("div","modal-overlay"); m.id="mkEditModal";
  m.innerHTML=`<div class="modal"><div class="modal-head"><strong>${title}</strong><button class="icon-btn" id="mkeClose">✕</button></div>
    <form id="mkEditForm" class="modal-form">${fields}<div class="auth-err" id="mkeErr"></div><button class="btn" type="submit">Save</button></form></div>`;
  document.body.appendChild(m); m.classList.add("open");
  m.onclick=e=>{ if(e.target.id==="mkEditModal") m.classList.remove("open"); };
  document.getElementById("mkeClose").onclick=()=>m.classList.remove("open");
  document.getElementById("mkEditForm").onsubmit=async e=>{
    e.preventDefault();
    const f=new FormData(e.target), err=document.getElementById("mkeErr");
    const btn=e.target.querySelector("button[type=submit]"); btn.disabled=true; btn.textContent="Saving…";
    const newEdits = { ...E };
    if(section==="profile"){ newEdits.headline=(f.get("headline")||"").trim();
      const b=(f.get("bio")||"").trim();
      // only keep a bio that's different from Instagram's; tag it with this account so it never shows on another
      if(b && b !== String(acct.biography||"").trim()){ newEdits.bio=b; newEdits.for=String(acct.ig_user_id||acct.username||""); newEdits.for_user=String(acct.username||"").toLowerCase(); } else { delete newEdits.bio; delete newEdits.for; delete newEdits.for_user; } }
    else if(section==="ratecard"){ newEdits.rate_card=(f.get("lines")||"").split("\n").map(l=>l.trim()).filter(Boolean).map(l=>{ const p=l.split("|").map(s=>s.trim()); return {item:p[0]||l, price:p[1]||""}; }); }
    else if(section==="portfolio"){ newEdits.portfolio=(f.get("lines")||"").split("\n").map(l=>l.trim()).filter(Boolean).map(l=>{ const p=l.split("|").map(s=>s.trim()); return {brand:p[0]||l, note:p[1]||"", url:p[2]||""}; }); }
    try{
      const { error } = await sb.from("social_accounts").update({ edits:newEdits, updated_at:new Date().toISOString() }).eq("id", acct.id);
      if(error) throw error;
      m.classList.remove("open"); loadMediaKit();
    }catch(ex){ err.textContent=ex.message||"Couldn't save."; btn.disabled=false; btn.textContent="Save"; }
  };
}

function mkComposer(){
  const who = _mkLastAcct && _mkLastAcct.username ? ` as <b>@${esc(_mkLastAcct.username)}</b>` : "";
  return `<div class="card" style="margin-top:16px"><h3>Publish to Instagram</h3>
    <p class="muted" style="margin-bottom:10px">Post, carousel, Reel or Story — straight to your Instagram${who}. Switch the account at the top.</p>
    <form id="mkComposer" class="modal-form">
      <label>What are you publishing?<select name="kind" id="mkKind">
        <option value="feed">Post (1 photo) or Carousel (up to 10 photos/videos)</option>
        <option value="reel">Reel (video)</option>
        <option value="story">Story (photo or video)</option>
      </select></label>
      <div id="mkCampWrap" style="display:none">
        <label>Is this for a campaign?<select id="mkCamp"><option value="">No — personal post</option></select></label>
        <div id="mkCampCard"></div>
        <label style="display:flex;gap:8px;align-items:center;font-weight:400"><input type="checkbox" id="mkAd" checked style="width:auto"> Add #ad disclosure (required by ASCI for brand posts)</label>
      </div>
      <label><span id="mkFileLbl">Photos</span><input type="file" id="mkFile"></label>
      <div id="mkPreview" style="display:flex;gap:6px;flex-wrap:wrap"></div>
      <div class="muted" id="mkHint" style="font-size:12px"></div>
      <div id="mkCapWrap">
        <label>Caption<textarea id="mkCap" rows="4" placeholder="Write a caption… use #hashtags and @mentions"></textarea></label>
        <div class="muted" id="mkCount" style="font-size:12px"></div>
      </div>
      <div id="mkPeopleWrap">
        <label><span id="mkTagsLbl">Tag people</span><input id="mkTags" placeholder="@friend, @photographer"></label>
        <div id="mkCollabWrap">
          <label>Collaborators (max 3)<input id="mkCollab" placeholder="@brand"></label>
          <div class="muted" style="font-size:12px">Collaborators get an invite in Instagram — once they accept, the post shows on both profiles.</div>
        </div>
      </div>
      <div id="mkStoryWrap">
        <label>Text on your story (optional)<textarea id="mkStoryText" rows="2" maxlength="220" placeholder="e.g. Loving my new Diwali lamp ✨"></textarea></label>
        <label style="display:flex;gap:8px;align-items:center;font-weight:400"><input type="checkbox" id="mkStoryShowMentions" checked style="width:auto"> Also show the @mentions on the story</label>
        <div class="muted" style="font-size:12px" id="mkStoryNote">Stories don't have captions on Instagram — your text is printed on the photo. Mentioned accounts get notified.</div>
      </div>
      <div id="mkReelWrap">
        <label>Cover image (optional)<input type="file" id="mkCover" accept="image/*"></label>
        <label>Or use the frame at (seconds)<input type="number" id="mkThumb" min="0" step="0.5" placeholder="e.g. 2.5"></label>
        <label>Name your original audio (optional)<input id="mkAudio" maxlength="50" placeholder="e.g. Diwali vibes"></label>
        <label style="display:flex;gap:8px;align-items:center;font-weight:400"><input type="checkbox" id="mkShareFeed" checked style="width:auto"> Also show on my profile grid</label>
      </div>
      <div class="muted" style="font-size:12px">🎵 Add your music, text and effects while editing the video — it's posted exactly as you upload it.</div>
      <div class="auth-err" id="mkErr"></div>
      <div class="lead-msg" id="mkMsg"></div>
      <button class="btn" type="submit">Publish →</button>
    </form></div>`;
}

// Live stories strip (Instagram only returns stories that are live right now — the last 24 h).
function mkStories(a){
  const st = Array.isArray(a.recent_stories) ? a.recent_stories : [];
  if(!st.length) return "";
  const ago = t=>{ const m=Math.max(1,Math.round((Date.now()-new Date(t).getTime())/60000)); return m<60?`${m}m`:`${Math.round(m/60)}h`; };
  return `<div class="card" style="margin-top:16px"><h3>Live stories <span class="muted" style="font-weight:400;font-size:13px">· ${st.length} · disappear 24h after posting</span></h3>
    <div style="display:flex;gap:10px;overflow-x:auto;padding-bottom:4px">${st.map(s=>{
      const img = s.media_type==="VIDEO" ? (s.thumbnail_url||s.media_url) : s.media_url;
      return `<a href="${esc(safeUrl(s.permalink))}" target="_blank" rel="noopener" class="mk-story" style="position:relative;flex:0 0 auto;width:96px;height:170px;border-radius:12px;overflow:hidden;display:block">
        ${img?`<img src="${esc(safeUrl(img))}" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover">`:""}
        ${s.media_type==="VIDEO"?`<span class="mk-type">▶</span>`:""}
        <span style="position:absolute;left:6px;bottom:6px;font-size:11px;color:#fff;text-shadow:0 1px 2px #000">${ago(s.timestamp)} ago</span></a>`;
    }).join("")}</div></div>`;
}

/* ---------- Media Kit: comment management (reply / hide / delete on the creator's own posts) ---------- */
function mkCommentsHtml(a){
  const media = (Array.isArray(a.recent_media) ? a.recent_media : []).slice(0, 12);
  if(!media.length) return "";
  return `<div class="card" style="margin-top:16px"><h3>Comments</h3>
    <p class="muted" style="margin-bottom:10px">Pick a post to read and manage its comments — reply, hide or delete, without opening Instagram.</p>
    <div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:6px">${media.map(m=>{
      const img = m.media_type==="VIDEO" ? (m.thumbnail_url||m.media_url) : m.media_url;
      return `<button type="button" data-mkcm="${esc(m.id)}" title="${esc((m.caption||"").slice(0,80))}" style="flex:0 0 auto;width:84px;border:2px solid transparent;border-radius:10px;padding:0;background:var(--mk-soft,#eee);cursor:pointer;position:relative;overflow:hidden">
        ${img?`<img src="${esc(safeUrl(img))}" alt="" loading="lazy" style="width:84px;height:84px;object-fit:cover;display:block">`:`<div style="width:84px;height:84px"></div>`}
        <span style="position:absolute;left:4px;bottom:4px;font-size:11px;color:#fff;text-shadow:0 1px 2px #000">💬 ${fmtNum(m.comments_count||0)}</span></button>`;
    }).join("")}</div>
    <div id="mkCmBody" class="muted" style="padding:6px 2px">Select a post above.</div></div>`;
}
function wireMkComments(){
  document.querySelectorAll("[data-mkcm]").forEach(b=> b.onclick = ()=>{
    document.querySelectorAll("[data-mkcm]").forEach(x=> x.style.borderColor = "transparent");
    b.style.borderColor = "var(--brand)"; loadMkComments(b.dataset.mkcm);
  });
}
async function mkCommentsCall(body){
  const { data, error } = await sb.functions.invoke("instagram-comments", { body });
  if(error){ let msg = await fnError(error), perm = false; try{ const j = await error.context.json(); perm = !!j.needs_permission; }catch(e){} return { error: msg, needs_permission: perm }; }
  return data || {};
}
async function loadMkComments(mediaId){
  const box = document.getElementById("mkCmBody"); if(!box) return;
  box.innerHTML = "Loading comments…";
  const r = await mkCommentsCall({ action:"list", media_id: mediaId });
  if(r.error){ box.innerHTML = `<div class="${r.needs_permission?'ai-suggest':''}" style="padding:8px">${esc(r.error)}</div>`; return; }
  const fmt = t=> t ? new Date(t).toLocaleString("en-IN",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}) : "";
  const one = (c, isReply)=> `<div class="cp-item" style="${isReply?'margin-left:28px;':''}${c.hidden?'opacity:.55;':''}align-items:flex-start">
      <div style="min-width:0"><b>@${esc(c.username||"user")}</b> <span class="muted" style="font-size:12px">${fmt(c.timestamp)}${c.like_count?` · ❤ ${c.like_count}`:""}${c.hidden?" · hidden":""}</span>
      <div style="white-space:pre-wrap;word-break:break-word">${esc(c.text||"")}</div>
      ${isReply?"":`<div class="cp-addrow" style="margin-top:6px"><input data-cmreplytxt="${esc(c.id)}" placeholder="Reply…" style="flex:1"><button class="btn sm ghost" data-cmreply="${esc(c.id)}">Reply</button></div>`}</div>
      <div style="display:flex;gap:6px;flex:0 0 auto"><button class="btn sm ghost" data-cmhide="${esc(c.id)}" data-hidden="${c.hidden?1:0}">${c.hidden?"Unhide":"Hide"}</button>
      <button class="btn sm ghost" data-cmdel="${esc(c.id)}">Delete</button></div></div>`;
  const list = r.comments || [];
  box.innerHTML = list.length ? `<div class="cp-list">${list.map(c=> one(c,false) + ((c.replies&&c.replies.data)||[]).map(x=>one(x,true)).join("")).join("")}</div>`
                              : `<div style="padding:8px">No comments on this post yet.</div>`;
  const act = async (body, btn)=>{ btn.disabled = true; const x = await mkCommentsCall(body); if(x.error){ alert(x.error); btn.disabled = false; return; } loadMkComments(mediaId); };
  box.querySelectorAll("[data-cmreply]").forEach(b=> b.onclick = ()=>{ const t = box.querySelector(`[data-cmreplytxt="${b.dataset.cmreply}"]`); const msg = (t&&t.value||"").trim(); if(!msg) return; act({ action:"reply", comment_id:b.dataset.cmreply, message:msg }, b); });
  box.querySelectorAll("[data-cmhide]").forEach(b=> b.onclick = ()=> act({ action:"hide", comment_id:b.dataset.cmhide, hide: b.dataset.hidden!=="1" }, b));
  box.querySelectorAll("[data-cmdel]").forEach(b=> b.onclick = ()=>{ if(confirm("Delete this comment from Instagram? This can't be undone.")) act({ action:"delete", comment_id:b.dataset.cmdel }, b); });
}

/* ---------- Media Kit: Instagram DM inbox (needs Meta approval of instagram_business_manage_messages) ---------- */
function mkInboxHtml(){
  return `<div class="card" style="margin-top:16px"><h3>Instagram inbox</h3><div id="mkInbox" class="muted">Loading…</div></div>`;
}
async function mkDmCall(body){
  const { data, error } = await sb.functions.invoke("instagram-dm", { body });
  if(error) return { error: await fnError(error) };
  return data || {};
}
// why Instagram refused, and the one thing that fixes it
function mkDmProblem(r){
  const meta = r.meta && (r.meta.code || r.meta.message) ? `<div class="muted" style="font-size:12px;margin-top:6px">Instagram said: ${r.meta.code?`(#${esc(r.meta.code)}${r.meta.subcode?"/"+esc(r.meta.subcode):""}) `:""}${esc(r.meta.message||"")}</div>` : "";
  const btns = (re)=> `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">${re?`<button class="btn sm" id="mkDmReconnect">Reconnect Instagram</button>`:""}<button class="btn sm ${re?"ghost":""}" id="mkDmRetry">Try again</button></div>`;
  const R = {
    reconnect: [`🔁 Reconnect Instagram once to allow messages`,
      `This Instagram connection was made before messages were allowed${r.scopes?` (it has: ${esc(r.scopes.map(x=>x.replace("instagram_business_","")).join(", "))})`:""}. Tap <b>Reconnect Instagram</b> and on Instagram's screen keep <b>every</b> permission switched on, including <b>Manage messages</b>.`, true],
    token_expired: [`🔁 Your Instagram connection expired`, `Reconnect Instagram — takes 10 seconds.`, true],
    messages_access_off: [`📱 Turn on “Allow access to messages” in Instagram`,
      `On your phone open <b>Instagram → Settings → Messages and story replies → Message controls → Connected tools</b> and switch on <b>Allow access to messages</b>. Then tap <b>Try again</b>.`, false],
    app_access: [`🛠 Meta hasn't opened messages for this app yet`,
      `Your connection has the messages permission, but Meta still refuses. In <b>developers.facebook.com → your app → App Review → Permissions and features</b>, <b>instagram_business_manage_messages</b> must show <b>Advanced access</b>, and the app must be <b>Live</b> (not Development). If you just got approval, switch it to Advanced access, then reconnect Instagram here.`, true]
  }[r.reason];
  if(!R) return `<div style="padding:6px">${esc(r.error||"Couldn't load your inbox.")}</div>${meta}${btns(false)}`;
  return `<div class="ai-suggest"><span class="spark">💬</span><div class="s-body"><b>${R[0]}</b><p>${R[1]}</p>${meta}${btns(R[2])}</div></div>`;
}
function wireMkDmProblem(){
  const rc = document.getElementById("mkDmReconnect");
  if(rc) rc.onclick = ()=>{ try{ localStorage.setItem("geekos_after_ig", currentPage||"messages"); if(currentPage==="messages") localStorage.setItem("geekos_msgtab","ig"); }catch(e){} connectInstagram(true); };
  const rt = document.getElementById("mkDmRetry"); if(rt) rt.onclick = ()=>{ const b = document.getElementById("mkInbox"); if(b) b.innerHTML = "Loading…"; loadMkInbox(); };
}
async function loadMkInbox(){
  const box = document.getElementById("mkInbox"); if(!box) return;
  const r = await mkDmCall({ action:"conversations" });
  if(r.error){ box.innerHTML = mkDmProblem(r); wireMkDmProblem(); return; }
  const t = r.threads || [];
  const ago = x=>{ if(!x) return ""; const m=Math.round((Date.now()-new Date(x).getTime())/60000); return m<60?m+"m":m<1440?Math.round(m/60)+"h":Math.round(m/1440)+"d"; };
  box.innerHTML = t.length ? `<div style="display:grid;grid-template-columns:minmax(180px,1fr) 2fr;gap:12px" class="mk-inbox">
      <div class="cp-list">${t.map(c=>`<button type="button" class="cp-item" data-dmc="${esc(c.id)}" data-dmto="${esc(c.with_id||"")}" data-dmname="${esc(c.with_username||"")}" style="text-align:left;cursor:pointer;width:100%">
        <div style="min-width:0"><b>@${esc(c.with_username||"user")}</b> <span class="muted" style="font-size:12px">${ago(c.last_at||c.updated_time)}</span>
        <div class="muted" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${c.last_from_me?"You: ":""}${esc(c.last_text||"")}</div></div></button>`).join("")}</div>
      <div id="mkDmThread" class="muted" style="padding:6px">Select a conversation.</div></div>` : `<div style="padding:6px">No conversations yet.</div>`;
  box.querySelectorAll("[data-dmc]").forEach(b=> b.onclick = ()=> openMkThread(b.dataset.dmc, b.dataset.dmto, b.dataset.dmname, r.me||{}));
}
async function openMkThread(id, toId, name, me){
  const box = document.getElementById("mkDmThread"); if(!box) return;
  box.innerHTML = "Loading…";
  const r = await mkDmCall({ action:"thread", conversation_id:id });
  if(r.error){ box.innerHTML = mkDmProblem(r); wireMkDmProblem(); return; }
  const msgs = (r.messages||[]).slice().reverse();
  box.innerHTML = `<div style="display:flex;flex-direction:column;gap:6px;max-height:360px;overflow-y:auto" id="mkDmMsgs">${msgs.map(m=>{
      const mine = m.from && (String(m.from.id)===String(me.id) || m.from.username===me.username);
      return `<div style="align-self:${mine?"flex-end":"flex-start"};max-width:80%;background:${mine?"var(--brand)":"var(--line, #eee)"};color:${mine?"#fff":"inherit"};padding:7px 11px;border-radius:14px;white-space:pre-wrap;word-break:break-word">${esc(m.message||(m.attachments?"[attachment]":""))}</div>`;
    }).join("")}</div>
    <div class="cp-addrow" style="margin-top:8px"><input id="mkDmText" placeholder="Reply to @${esc(name||"")}…" style="flex:1"><button class="btn sm" id="mkDmSend">Send</button></div>
    <div class="muted" style="font-size:12px">Instagram allows replies within 24 hours of their last message.</div>`;
  const list = document.getElementById("mkDmMsgs"); if(list) list.scrollTop = list.scrollHeight;
  document.getElementById("mkDmSend").onclick = async ()=>{
    const txt = (document.getElementById("mkDmText").value||"").trim(); if(!txt || !toId) return;
    const s = await mkDmCall({ action:"send", recipient_id:toId, text:txt });
    if(s.error){ alert(s.error); return; }
    if(window.Tracker) Tracker.security("instagram_dm_send", { to: name||null });
    openMkThread(id, toId, name, me);
  };
}

let _mkTimer = null, _mkSyncedAt = 0, _mkLastAcct = null, _mkHeadHtml = "", _mkStoriesHtml = "";
// Work portfolio → campaign posts made on Geek OS, picked up automatically (thumbnail, brand, link)
let _mkCampWork = null, _mkCampWorkAt = 0;
async function mkCampaignWork(acct){
  const box = document.getElementById("mkCampWork"); if(!box || !window.__ciOpsEnabled) return;
  if(!_mkCampWork || Date.now() - _mkCampWorkAt > 60000){
    const { data } = await sb.schema("api").rpc("get_my_campaigns").then(r=>r, ()=>({data:[]}));
    _mkCampWork = []; _mkCampWorkAt = Date.now();
    (data||[]).forEach(c=> (c.posts||[]).forEach(p=> _mkCampWork.push(Object.assign({ campaign:c.campaign, brand:c.brand, applied_profile:c.applied_profile }, p))));
  }
  // only the campaigns done with the account that's open (older ones without an account show everywhere)
  const me_h = String(acct && acct.username || "").toLowerCase();
  const camp = (_mkCampWork||[]).filter(p=> !p.applied_profile || !me_h || String(p.applied_profile).toLowerCase().replace(/^@/,"") === me_h);
  const media = [].concat(acct && acct.recent_media || [], acct && acct.recent_stories || []);
  const norm = u => String(u||"").toLowerCase().replace(/[?#].*$/,"").replace(/^(https?:\/\/)?(www\.)?/,"").replace(/\/$/,"");
  const thumb = p => { const m = media.find(x=> norm(x.permalink) && norm(x.permalink)===norm(p.permalink)); return m ? (m.thumbnail_url || m.media_url) : null; };
  const L = camp.slice().sort((a,b)=> String(b.posted_at).localeCompare(String(a.posted_at)));
  const el2 = document.getElementById("mkCampWork"); if(!el2) return;
  const LL = L.slice(0, _mkShown.cw || 6);
  el2.innerHTML = L.length ? `<div class="mk-cw-h">🎬 Campaigns on Geek OS</div><div class="mk-cw">${LL.map(p=>{ const t = thumb(p);
      return `<a class="mk-cw-item" href="${esc(safeUrl(p.permalink||"#"))}" target="_blank" rel="noopener">
        <div class="mk-cw-img">${t?`<img src="${esc(safeUrl(t))}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`:""}<i>${p.media_type==="story"?"Story":"▶ Reel"}</i></div>
        <div class="mk-cw-b"><b>${esc(p.brand||"Brand")}</b><span>${esc(p.campaign||"")}</span><em>${esc(fmtDate(p.posted_at))} ↗</em></div></a>`; }).join("")}</div>`
    + (L.length > LL.length ? `<div class="mk-more"><button class="btn sm ghost" id="mkCwMore">Load more <span class="muted">(${L.length-LL.length} more)</span></button></div>` : "") : "";
  const cm = document.getElementById("mkCwMore"); if(cm) cm.onclick = ()=>{ _mkShown.cw = (_mkShown.cw||6) + 6; mkCampaignWork(acct); };
}
function wireMkHead(acct){
  mkCampaignWork(acct);
  const share = document.getElementById("mkShare");
  if(share) share.onclick = ()=> openKitShare(acct);
  const cta = document.getElementById("mkComposeCta");
  if(cta) cta.onclick = ()=>{
    if(window.__profileGate){ gateToast(joinNeedsText()); return; }
    const c=document.getElementById("mkComposer"); if(c){ c.scrollIntoView({behavior:"smooth"}); return; }
    currentPage = "instagram"; renderShell(); };
  document.querySelectorAll("#mkHeadWrap [data-mkedit]").forEach(b=> b.onclick = ()=> openMkEdit(b.dataset.mkedit, acct));
  document.querySelectorAll("#mkHeadWrap [data-mkmore]").forEach(b=> b.onclick = ()=>{
    const k = b.dataset.mkmore; _mkShown[k] = (_mkShown[k]||0) + (MK_STEP[k]||6);
    const hw = document.getElementById("mkHeadWrap"), a2 = _mkLastAcct || acct; if(!hw) return;
    _mkHeadHtml = mkHead(a2); hw.innerHTML = _mkHeadHtml; wireMkHead(a2); });
}
// Share the public media kit: anyone with the link sees only the kit (no login).
function kitPublicUrl(acct){ return (window.appOrigin ? window.appOrigin() : location.origin) + "/p.html?u=" + encodeURIComponent(String(acct.username||"").replace(/^@/,"")); }
function openKitShare(acct){
  if(!acct || !acct.username){ alert("Connect Instagram first — your kit link uses your Instagram username."); return; }
  const url = kitPublicUrl(acct);
  let m = document.getElementById("kitShareModal"); if(m) m.remove();
  m = el("div","modal-overlay open"); m.id = "kitShareModal";
  m.innerHTML = `<div class="modal"><div class="modal-head"><strong>Share your media kit</strong><button class="icon-btn" id="ksClose">✕</button></div>
    <div class="modal-form"><p class="muted" style="margin:0 0 10px">Anyone with this link can see your media kit — no login needed. They see only the kit.</p>
      <div style="display:flex;gap:8px"><input id="ksUrl" readonly value="${esc(url)}" style="flex:1"><button class="btn" id="ksCopy">Copy</button></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
        <a class="btn ghost" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent("My media kit: "+url)}">💬 Share on WhatsApp</a>
        <a class="btn ghost" target="_blank" rel="noopener" href="${esc(url)}">👀 Open as a brand sees it</a></div></div></div>`;
  document.body.appendChild(m);
  const close = ()=> m.remove();
  m.querySelector("#ksClose").onclick = close; m.onclick = e=>{ if(e.target===m) close(); };
  m.querySelector("#ksCopy").onclick = async e=>{
    const b = e.currentTarget, i = m.querySelector("#ksUrl");
    try{ await navigator.clipboard.writeText(url); }catch(_e){ i.select(); document.execCommand && document.execCommand("copy"); }
    b.textContent = "Copied ✓"; setTimeout(()=> b.textContent = "Copy", 1500);
  };
}
async function mkFetchAcct(){
  const memberId = (window.Auth && Auth.profile && Auth.profile.id) || null;
  if(!memberId || !window.sb) return null;
  const { data, error } = await sb.from("social_accounts").select("*").eq("platform","instagram").eq("member_id", memberId)
    .order("updated_at",{ascending:false}).limit(1);
  return error ? null : ((data && data[0]) || null);
}
function mkLoadingHtml(){
  return `<div class="mk-loadbar"><div class="mk-spin sm"></div><span>Loading your media kit…</span></div>`;
}
function mkBuildingHtml(){
  return `<div class="card mk-building"><div class="mk-spin"></div><h3 style="margin:10px 0 4px">Building your media kit…</h3>
    <div class="muted">Reading your profile, posts, top performers and audience from Instagram. This takes a few seconds.</div></div>`;
}
// full-screen loader — used while Instagram connects / an account is switched, so the screen never goes blank
function showBusy(msg){
  let o = document.getElementById("geekBusy");
  if(!o){ o = document.createElement("div"); o.id = "geekBusy"; o.className = "geek-busy"; document.body.appendChild(o); }
  o.innerHTML = `<div class="geek-busy-box"><div class="mk-spin"></div><div class="geek-busy-t">${esc(msg||"Loading…")}</div></div>`;
  o.style.display = "flex";
}
function hideBusy(){ const o = document.getElementById("geekBusy"); if(o) o.remove(); }
window.showBusy = showBusy; window.hideBusy = hideBusy;
function mkStamp(){
  const el = document.getElementById("mkSyncStamp"); if(!el) return;
  el.textContent = _mkSyncedAt ? `Synced with Instagram ${Math.max(0,Math.round((Date.now()-_mkSyncedAt)/1000))}s ago · auto-refreshes every 60s` : "Syncing with Instagram…";
}
// Pull fresh posts + live stories from Instagram (server-throttled), then re-render only the head — the composer
// (and anything the creator is typing) is left untouched.
async function refreshMediaKit(force){
  if(!document.getElementById("mkHeadWrap")){ if(document.getElementById("igBody")) return refreshInstagram(force); return; }
  try{
    const { data, error } = await sb.functions.invoke("instagram-media-sync", { body:{ force: !!force } });
    if(!error && data && data.ok && !data.cached) _mkSyncedAt = Date.now();
    else if(!error && data && data.cached && !_mkSyncedAt) _mkSyncedAt = Date.now() - (60000 - (data.next_in_ms||0));
  }catch(e){ /* keep showing the last data */ }
  const acct = await mkFetchAcct(); const hw = document.getElementById("mkHeadWrap");
  if(acct && hw){
    // never blank the grid: if this read has no posts but the last good one did, keep showing those
    if(!(Array.isArray(acct.recent_media) && acct.recent_media.length) && _mkLastAcct && (_mkLastAcct.recent_media||[]).length) acct.recent_media = _mkLastAcct.recent_media;
    // silent refresh: only touch the DOM when something visible actually changed (no flicker, no image reloads,
    // scroll position kept); the composer is never touched
    const headHtml = mkHead(acct), storiesHtml = mkStories(acct), sw = document.getElementById("mkStoriesWrap");
    _mkLastAcct = acct;
    if(headHtml !== _mkHeadHtml){
      const y = window.scrollY; hw.innerHTML = headHtml; _mkHeadHtml = headHtml; wireMkHead(acct); window.scrollTo(0, y);
    }
    if(sw && storiesHtml !== _mkStoriesHtml){ sw.innerHTML = storiesHtml; _mkStoriesHtml = storiesHtml; }
    if(acct.profile_picture_url && acct.profile_picture_url !== _igAvatarUrl){ _igAvatarUrl = acct.profile_picture_url; _igAvatarAt = Date.now(); window.__igUsername = acct.username || window.__igUsername; paintIgAvatar(); }
  }
  mkStamp();
}

/* ---------- Messages: WhatsApp and the Instagram inbox side by side (every role) ---------- */
let _msgTab = (()=>{ try{ const t = localStorage.getItem("geekos_msgtab"); localStorage.removeItem("geekos_msgtab"); return t==="ig" ? "ig" : "wa"; }catch(e){ return "wa"; } })();
async function mountMessagesTabs(){
  const host = document.getElementById("content"); if(!host || document.getElementById("msgTabs")) return;
  const wa = document.getElementById("waChat"); if(!wa) return;
  const bar = el("div","ci-chips"); bar.id = "msgTabs"; bar.style.margin = "0 0 12px";
  bar.innerHTML = `<button class="ci-chip on" data-msgtab="wa">💬 WhatsApp</button><button class="ci-chip" data-msgtab="ig">📸 Instagram DMs</button>`;
  const igPane = el("div",""); igPane.id = "msgIg"; igPane.style.display = "none";
  igPane.innerHTML = `<div class="card"><div class="muted">Loading your Instagram inbox…</div></div>`;
  wa.parentNode.insertBefore(bar, wa);
  wa.parentNode.insertBefore(igPane, wa.nextSibling);
  const paint = ()=>{
    bar.querySelectorAll("[data-msgtab]").forEach(b=> b.classList.toggle("on", b.dataset.msgtab===_msgTab));
    wa.style.display = _msgTab==="wa" ? "" : "none";
    const st = document.getElementById("waStatus"); if(st) st.style.display = _msgTab==="wa" ? "" : "none";
    igPane.style.display = _msgTab==="ig" ? "" : "none";
    if(_msgTab==="ig" && !igPane.dataset.loaded){ igPane.dataset.loaded = "1"; loadMessagesInstagram(); }
  };
  bar.querySelectorAll("[data-msgtab]").forEach(b=> b.onclick = ()=>{ _msgTab = b.dataset.msgtab; paint(); });
  paint();
}
async function loadMessagesInstagram(){
  const pane = document.getElementById("msgIg"); if(!pane) return;
  const acct = await mkFetchAcct();
  if(!pane.isConnected) return;
  if(!acct){
    pane.innerHTML = `<div class="card"><h3 style="margin-top:0">📸 Instagram DMs</h3>
      <p class="muted" style="font-size:13.5px">Connect your Instagram and your DMs open right here — reply to creators without leaving Geek OS. Invites you send also go out from this handle.</p>
      <button class="btn" id="msgIgConnect">Connect Instagram</button></div>`;
    const b = document.getElementById("msgIgConnect");
    if(b) b.onclick = ()=>{ try{ localStorage.setItem("geekos_after_ig","messages"); }catch(e){} connectInstagram(); };
    return;
  }
  pane.innerHTML = `<div class="muted" style="font-size:12.5px;margin-bottom:10px">Instagram inbox of <b>@${esc(acct.username||"")}</b> — replies send from this account.</div>${mkInboxHtml()}`;
  loadMkInbox();
}
/* ---------- Instagram: post (feed / carousel / reel / story), live stories, comments and DMs ---------- */
let _igTimer = null, _igSyncedAt = 0, _igMediaSig = "", _igTab = "post";
function renderInstagram(){
  return pageHead("Instagram","Post, reply to comments and answer DMs — without leaving Geek OS.")
    + `<div id="igBody">${skel("cards",3)}</div>`;
}
const IG_TABS = [["post","📤 Post"],["stories","🟣 Stories"],["comments","💬 Comments"],["inbox","✉️ Messages"]];
function paintIgTabs(){
  document.querySelectorAll("[data-igtab]").forEach(b=> b.classList.toggle("on", b.dataset.igtab===_igTab));
  IG_TABS.forEach(([k])=>{ const p=document.getElementById("igPane_"+k); if(p) p.style.display = k===_igTab ? "" : "none"; });
}
async function loadInstagram(){
  const wrap = document.getElementById("igBody"); if(!wrap) return;
  const acct = await mkFetchAcct();
  if(!wrap.isConnected) return;
  if(!acct){ wrap.innerHTML = mkNotConnected(); const b=document.getElementById("mkConnect"); if(b) b.onclick=connectInstagram; return; }
  _mkLastAcct = acct;
  wrap.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px">
      <div class="ci-chips" style="margin:0">${IG_TABS.map(([k,l])=>`<button class="ci-chip" data-igtab="${k}">${l}</button>`).join("")}</div>
      <div class="muted" id="mkSyncStamp" style="font-size:12px"></div></div>
    <div id="igAcctSwitch" style="margin-bottom:10px"></div>
    <div id="igPane_post"><div class="mk-kit" id="mkComposerWrap"></div></div>
    <div id="igPane_stories"><div class="mk-kit" id="mkStoriesWrap"></div></div>
    <div id="igPane_comments"><div class="mk-kit" id="mkCommentsWrap"></div></div>
    <div id="igPane_inbox"><div class="mk-kit" id="mkInboxWrap"></div></div>`;
  document.getElementById("mkComposerWrap").innerHTML = mkComposer();
  document.getElementById("mkStoriesWrap").innerHTML = mkStories(acct) || `<div class="card"><div class="muted">No live stories right now. Post one from the 📤 Post tab — it shows here for 24 hours.</div></div>`;
  document.getElementById("mkCommentsWrap").innerHTML = mkCommentsHtml(acct) || `<div class="card"><div class="muted">No posts yet — comments on your posts will show here.</div></div>`;
  document.getElementById("mkInboxWrap").innerHTML = mkInboxHtml();
  _igMediaSig = JSON.stringify((acct.recent_media||[]).map(m=>[m.id,m.comments_count]));
  wireMkComposer(); wireMkComments(acct); loadMkInbox();
  paintIgSwitcher("igAcctSwitch", "Posting as");
  document.querySelectorAll("[data-igtab]").forEach(b=> b.onclick = ()=>{ _igTab = b.dataset.igtab; paintIgTabs(); });
  paintIgTabs();
  _mkSyncedAt = 0; mkStamp(); refreshInstagram(false);
  if(_igTimer) clearInterval(_igTimer);
  _igTimer = setInterval(()=>{
    if(currentPage!=="instagram" || !document.getElementById("igBody")){ clearInterval(_igTimer); _igTimer=null; return; }
    mkStamp();
    if(document.visibilityState==="visible" && Date.now()-(_mkSyncedAt||0) >= 60000) refreshInstagram(false);
  }, 5000);
}
// silent sync: stories + the comments post-picker repaint only when Instagram data changed; the composer and an
// open comment thread / DM conversation are never touched
async function refreshInstagram(force){
  try{
    const { data, error } = await sb.functions.invoke("instagram-media-sync", { body:{ force: !!force } });
    if(!error && data && data.ok && !data.cached) _mkSyncedAt = Date.now();
    else if(!error && data && data.cached && !_mkSyncedAt) _mkSyncedAt = Date.now() - (60000 - (data.next_in_ms||0));
  }catch(e){}
  const acct = await mkFetchAcct(); if(!acct || !document.getElementById("igBody")) return;
  _mkLastAcct = acct;
  const sw = document.getElementById("mkStoriesWrap"), st = mkStories(acct);
  if(sw && st && st !== _mkStoriesHtml){ sw.innerHTML = st; _mkStoriesHtml = st; }
  const sig = JSON.stringify((acct.recent_media||[]).map(m=>[m.id,m.comments_count]));
  const cw = document.getElementById("mkCommentsWrap");
  if(cw && sig !== _igMediaSig && !document.querySelector("[data-mkcm][style*='var(--brand)']")){ cw.innerHTML = mkCommentsHtml(acct); wireMkComments(acct); }
  _igMediaSig = sig; mkStamp();
}

function startMkAutoRefresh(){
  if(_mkTimer) clearInterval(_mkTimer);
  _mkTimer = setInterval(()=>{
    if(typeof currentPage!=="undefined" && currentPage!=="mediakit" || !document.getElementById("mkHeadWrap")){ clearInterval(_mkTimer); _mkTimer=null; return; }
    mkStamp();
    if(document.visibilityState==="visible" && Date.now()-(_mkSyncedAt||0) >= 60000) refreshMediaKit(false);
  }, 5000);
}

async function loadMediaKit(){
  const wrap = document.getElementById("mkBody");
  if(!wrap) return;
  const showConnect = ()=>{ wrap.innerHTML = mkNotConnected(); const b=document.getElementById("mkConnect"); if(b) b.onclick=connectInstagram; };
  if(!window.sb){ showConnect(); return; }
  let acct = await mkFetchAcct();
  if(!wrap.isConnected) return;               // page changed while loading — a newer render takes over
  if(!acct){ showConnect(); return; }
  _mkLastAcct = acct;
  // Media Kit = view only (reach, audience, stats, best work). Posting, comments and DMs live on the Instagram page.
  // live stories live on the Instagram page (🟣 Stories), not in the kit
  wrap.innerHTML = `<div class="ig-sw-row mk-topbar"><div id="mkAcctSwitch"></div><div class="muted" id="mkSyncStamp" style="font-size:12px"></div></div>`
    + `<div id="mkHeadWrap"></div>`;
  paintIgSwitcher("mkAcctSwitch", "Media kit of");
  _mkShown = { top:6, show:9, ment:6, port:6, collab:6 };
  const fresh = !(acct.recent_media||[]).length && !acct.archive_synced_at;
  if(fresh){
    // a brand-new kit: show a proper loader (never a blank screen) while the first Instagram sync runs
    document.getElementById("mkHeadWrap").innerHTML = mkBuildingHtml();
    await refreshMediaKit(true);
    const a2 = await mkFetchAcct(); if(!document.getElementById("mkHeadWrap")) return;
    if(a2){ acct = a2; _mkLastAcct = a2; }
  }
  _mkHeadHtml = mkHead(acct);
  document.getElementById("mkHeadWrap").innerHTML = _mkHeadHtml;
  wireMkHead(acct);
  _mkSyncedAt = 0; mkStamp();
  refreshMediaKit(false);          // fresh posts + live stories on open
  startMkAutoRefresh();            // then every 60 s while the page is open and visible
  // Lazily refresh the Instagram token + re-sync stats if this kit is stale (>7 days).
  if(acct.updated_at && (Date.now() - new Date(acct.updated_at).getTime()) > 7*86400*1000){
    sb.functions.invoke("instagram-refresh").catch(()=>{});
  }
}

// Instagram's publishing API accepts JPEG images only (max 8 MB); feed posts must be between 4:5 and 1.91:1.
// Convert any picked image (PNG, WebP…) to JPEG in the browser, downscale large ones, and for feed posts pad
// (never crop) out-of-range shapes with white so the creator's photo is kept whole.
async function toInstagramJpeg(file, kind, overlay){
  const bmp = await createImageBitmap(file);
  const maxEdge = kind === "story" ? 1920 : 1440;
  let w = bmp.width, h = bmp.height;
  const scale = Math.min(1, maxEdge / Math.max(w, h)); w = Math.round(w*scale); h = Math.round(h*scale);
  let cw = w, ch = h;
  if(kind === "feed"){ const r = w/h; if(r < 0.8) cw = Math.ceil(h*0.8); else if(r > 1.91) ch = Math.ceil(w/1.91); }
  const c = document.createElement("canvas"); c.width = cw; c.height = ch;
  const g = c.getContext("2d"); g.fillStyle = "#ffffff"; g.fillRect(0,0,cw,ch);
  g.drawImage(bmp, Math.round((cw-w)/2), Math.round((ch-h)/2), w, h);
  if(bmp.close) bmp.close();
  // story text: printed on a soft band near the bottom (Instagram stories have no caption field)
  const lines0 = overlay ? [overlay.text, overlay.mentions].map(x=>String(x||"").trim()).filter(Boolean) : [];
  if(lines0.length){
    const fs = Math.max(24, Math.round(cw * 0.045)), pad = Math.round(fs*0.6), maxW = cw - pad*4;
    g.font = `600 ${fs}px -apple-system, "Segoe UI", Roboto, sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
    const lines = [];
    for(const para of lines0){ let cur=""; for(const word of para.split(/\s+/)){ const t = cur ? cur+" "+word : word; if(g.measureText(t).width > maxW && cur){ lines.push(cur); cur = word; } else cur = t; } if(cur) lines.push(cur); }
    const lh = Math.round(fs*1.3), boxH = lines.length*lh + pad*2, y0 = Math.round(ch*0.78 - boxH/2);
    g.fillStyle = "rgba(0,0,0,0.45)"; g.fillRect(pad, y0, cw - pad*2, boxH);
    g.fillStyle = "#ffffff"; lines.forEach((ln,i)=> g.fillText(ln, cw/2, y0 + pad + lh*i + lh/2));
  }
  let q = 0.9, blob;
  do { blob = await new Promise(res=>c.toBlob(res, "image/jpeg", q)); q -= 0.1; } while(blob && blob.size > 8*1024*1024 && q > 0.4);
  if(!blob) throw new Error("Couldn't prepare this image — try a JPG.");
  return new File([blob], (file.name||"photo").replace(/\.[^.]+$/,"") + ".jpg", { type:"image/jpeg" });
}
const MK_KIND = {
  feed:  { lbl:"Photos (pick up to 10 for a carousel)", accept:"image/*,video/mp4,video/quicktime", multiple:true, max:10,
           hint:"1 photo = post · 2–10 photos/videos = carousel. Any photo format — we convert it to JPEG for Instagram.", btn:"Publish post →", ok:"Posted to Instagram ✅" },
  reel:  { lbl:"Video", accept:"video/mp4,video/quicktime", multiple:false, max:1,
           hint:"MP4/MOV, vertical 9:16, 3–90 seconds.", btn:"Publish reel →", ok:"Reel posted to Instagram ✅" },
  story: { lbl:"Photo or video", accept:"image/*,video/mp4,video/quicktime", multiple:false, max:1,
           hint:"Vertical 9:16 works best. Videos up to 60 seconds. Any text you type below is printed on a photo story; add music and effects while editing.", btn:"Publish story →", ok:"Story is live on Instagram ✅" }
};
const mkUsers = s => String(s||"").split(/[\s,]+/).map(x=>x.replace(/^@/,"").trim()).filter(x=>/^[A-Za-z0-9._]{1,30}$/.test(x)).filter((x,i,a)=>a.indexOf(x)===i);
let _mkRules = [];

function wireMkComposer(){
  const form = document.getElementById("mkComposer");
  if(!form) return;
  const $id = id => document.getElementById(id);
  const kindSel=$id("mkKind"), fileIn=$id("mkFile"), cap=$id("mkCap"), btn=form.querySelector("button[type=submit]");
  let files = [];

  const counter = ()=>{
    const t=cap.value||"", tags=(t.match(/#[\p{L}\p{N}_]+/gu)||[]).length, ments=(t.match(/@[A-Za-z0-9._]+/g)||[]).length;
    const bad = t.length>2200 || tags>30 || ments>20;
    $id("mkCount").innerHTML = `${t.length}/2200 characters · ${tags}/30 hashtags · ${ments}/20 mentions`;
    $id("mkCount").style.color = bad ? "#c0392b" : "";
    return !bad;
  };
  const renderPreview = ()=>{
    $id("mkPreview").innerHTML = files.map(f=>{
      const u=URL.createObjectURL(f);
      return /^video\//.test(f.type) ? `<video src="${u}" muted style="width:72px;height:72px;object-fit:cover;border-radius:8px"></video>`
                                     : `<img src="${u}" alt="" style="width:72px;height:72px;object-fit:cover;border-radius:8px">`;
    }).join("");
  };
  const applyKind = ()=>{
    const k = MK_KIND[kindSel.value]||MK_KIND.feed;
    $id("mkFileLbl").textContent=k.lbl; fileIn.accept=k.accept; fileIn.multiple=k.multiple; fileIn.value=""; files=[]; renderPreview();
    $id("mkHint").textContent=k.hint;
    const story = kindSel.value==="story";
    $id("mkCapWrap").style.display = story ? "none" : "";
    $id("mkCollabWrap").style.display = story ? "none" : "";
    $id("mkStoryWrap").style.display = story ? "" : "none";
    $id("mkTagsLbl").textContent = story ? "Mention people (they get notified)" : "Tag people";
    $id("mkTags").placeholder = story ? "@brand, @friend" : "@friend, @photographer";
    $id("mkReelWrap").style.display = kindSel.value==="reel" ? "" : "none";
    btn.textContent=k.btn; $id("mkErr").textContent="";
  };
  fileIn.onchange = ()=>{
    const k = MK_KIND[kindSel.value]||MK_KIND.feed, err=$id("mkErr"); err.textContent="";
    files = Array.from(fileIn.files||[]);
    if(files.length > k.max){ err.textContent=`Pick at most ${k.max} file${k.max>1?"s":""}.`; files=files.slice(0,k.max); }
    renderPreview();
    const vidStory = kindSel.value==="story" && files.some(f=>/^video\//.test(f.type||""));
    $id("mkStoryText").disabled = vidStory; $id("mkStoryShowMentions").disabled = vidStory;
    $id("mkStoryNote").textContent = vidStory
      ? "Text can't be printed on a video story here — mentions still work and notify. Put text on the video while editing it."
      : "Stories don't have captions on Instagram — your text is printed on the photo. Mentioned accounts get notified.";
  };
  cap.oninput = counter;

  // campaign posting rules (pilot creators only): pre-fill required #hashtags / @mentions + #ad
  const syncAd = ()=>{
    const want = $id("mkAd").checked && !!$id("mkCamp").value, has = /(^|\s)#ad\b/i.test(cap.value);
    if(want && !has) cap.value = (cap.value.trim()+" #ad").trim();
    if(!want && has) cap.value = cap.value.replace(/(^|\s)#ad\b/ig,"").trim();
    counter();
  };
  $id("mkAd").onchange = syncAd;
  // ---- campaign post: everything comes from the campaign (format, caption, @mentions, #hashtags, collaborator, #ad) ----
  const campRule = ()=> _mkRules.find(x=>x.participation_id===$id("mkCamp").value) || null;
  const nextFormat = r => { const f=(r.formats||[]); return f.find(x=>x.done<x.need) || f[0] || { kind:"reel", label:"Reel", need:1, done:0 }; };
  const campPieces = r => {
    const tags=[], ments=[];
    const addT = t=>{ t=String(t||"").trim(); if(!t) return; if(t[0]==="@"){ addM(t); return; } if(t[0]!=="#") t="#"+t;
                      if(/^#[\p{L}\p{N}_]+$/u.test(t) && t.toLowerCase()!=="#ad" && !tags.some(x=>x.toLowerCase()===t.toLowerCase())) tags.push(t); };
    const addM = m=>{ m=String(m||"").replace(/^@/,"").trim(); if(/^[A-Za-z0-9._]{1,30}$/.test(m) && !ments.some(x=>x.toLowerCase()===m.toLowerCase())) ments.push(m); };
    String(r.brief_mentions||"").split(/[\s,]+/).forEach(addM); (r.mentions||[]).forEach(addM);
    String(r.brief_hashtags||"").split(/[\s,]+/).forEach(addT); (r.hashtags||[]).forEach(addT);
    const brandAt = ments[0] ? "@"+ments[0] : (r.brand||"the brand");
    const line = String(r.caption||"").trim() || (r.product ? `Loving my ${r.product} from ${brandAt} ✨` : `Something new from ${brandAt} ✨`);
    return { tags, ments, line };
  };
  const fillCampaign = (r, keepKind)=>{
    if(!r){ $id("mkCampCard").innerHTML=""; return; }
    if(!keepKind){ kindSel.value = nextFormat(r).kind; }
    applyKind();
    const { tags, ments, line } = campPieces(r);
    const inLine = t => new RegExp("(^|\\s)"+t.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+"(?![\\w.])","i").test(line);
    const extraM = ments.map(m=>"@"+m).filter(m=>!inLine(m)), extraT = tags.filter(t=>!inLine(t));
    $id("mkAd").checked = true;
    if(kindSel.value==="story"){
      $id("mkTags").value = ments.map(m=>"@"+m).join(", ");
      $id("mkStoryText").value = [line, extraT.join(" "), "#ad"].filter(Boolean).join(" ").slice(0,220);
      cap.value = "";
    } else {
      cap.value = ["#ad " + line, [extraM.join(" "), extraT.join(" ")].filter(Boolean).join("\n")].filter(Boolean).join("\n\n");
      $id("mkCollab").value = r.collab_rights!==false && ments[0] ? "@"+ments[0] : "";
      $id("mkTags").value = ments.slice(1).map(m=>"@"+m).join(", ");
    }
    counter();
    const now = kindSel.value;
    $id("mkCampCard").innerHTML = `<div style="border:1px solid var(--line);border-radius:12px;padding:10px 12px;margin:2px 0 6px;font-size:13px;line-height:1.55">
      <div><b>📣 ${esc(r.campaign||"Campaign")}</b>${r.brand?` · ${esc(r.brand)}`:""}${r.product?` · 🎁 ${esc(r.product)}`:""}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin:6px 0">${(r.formats||[]).map(f=>{
        const done=f.done>=f.need, cur=f.kind===now;
        return `<button type="button" data-mkfmt="${esc(f.kind)}" style="font:inherit;font-size:12px;border-radius:999px;padding:3px 10px;cursor:pointer;border:1px solid ${cur?"var(--brand,#6c5ce7)":"var(--line)"};background:${cur?"var(--brand,#6c5ce7)":"transparent"};color:${cur?"#fff":"inherit"}">${done?"✓ ":""}${esc(f.label)}${f.need>1?` ${Math.min(f.done,f.need)}/${f.need}`:""}${cur&&!done?" · now":""}</button>`; }).join("")}</div>
      ${r.approved_video?`<div>🎬 Post your <b>approved</b> video: <a href="${esc(/^https?:\/\//i.test(r.approved_video)?r.approved_video:"#")}" target="_blank" rel="noopener">download it ↗</a>, then pick it below.</div>`:""}
      ${r.posting_note?`<div class="muted">📝 ${esc(r.posting_note)}</div>`:""}
      ${!r.can_record_post?`<div style="color:#b45309">⏳ The brand hasn't approved your video yet — post only after approval.</div>`:""}
      <div class="muted" style="font-size:12px">Caption, @mentions, #hashtags, collaborator and #ad are filled in from the campaign — you can edit them.</div></div>`;
    $id("mkCampCard").querySelectorAll("[data-mkfmt]").forEach(b=> b.onclick = ()=>{ kindSel.value = b.dataset.mkfmt; fillCampaign(r, true); });
  };
  kindSel.onchange = ()=>{ const r = campRule(); if(r) fillCampaign(r, true); else applyKind(); };
  $id("mkCamp").onchange = ()=>{
    const r = campRule();
    if(r) fillCampaign(r, false);
    else { $id("mkCampCard").innerHTML=""; cap.value=""; $id("mkTags").value=""; $id("mkCollab").value=""; $id("mkStoryText").value=""; counter(); }
    syncAd();
  };
  const loadRules = async (pick, note)=>{
    if(!(window.__ciOpsEnabled && window.sb && sb.schema)) return;
    const { data, error } = await sb.schema("api").rpc("get_my_posting_rules");
    if(error || !Array.isArray(data) || !data.length || !$id("mkCamp")) return;
    _mkRules = data;
    $id("mkCamp").innerHTML = `<option value="">No — personal post</option>` + data.map(r=>`<option value="${esc(r.participation_id)}">${esc(r.campaign||"Campaign")} · ${esc(r.brand||"")}</option>`).join("");
    $id("mkCampWrap").style.display = "";
    if(pick && data.some(r=>r.participation_id===pick)){
      $id("mkCamp").value = pick; $id("mkCamp").onchange();
      form.scrollIntoView({ behavior:"smooth", block:"start" });
      const m = $id("mkMsg"); if(m && note){ m.innerHTML = note; m.className = "lead-msg ok"; }
    }
  };
  // "Let's post" from My Campaigns → straight here with the campaign picked and everything filled in
  { const P = window.__mkPreset; window.__mkPreset = null;
    loadRules(P && P.participation_id, "Everything is filled in from the campaign — pick your approved video and tap <b>Publish</b>."); }
  form._mkNext = loadRules;

  applyKind(); counter();

  form.onsubmit = async e=>{
    e.preventDefault();
    const err=$id("mkErr"), msg=$id("mkMsg"), kind=kindSel.value||"feed", K=MK_KIND[kind]||MK_KIND.feed;
    err.textContent=""; msg.textContent=""; msg.className="lead-msg";
    if(!files.length){ err.textContent="Pick a file first."; return; }
    if(!counter()){ err.textContent="Caption is over Instagram's limits (see the counter)."; return; }
    const vids = files.filter(f=>/^video\//.test(f.type||""));
    if(kind==="reel" && !vids.length){ err.textContent="Reels need a video file."; return; }
    if(kind==="feed" && files.length===1 && vids.length){ err.textContent="A single video is a Reel — choose Reel."; return; }
    if(files.some(f=>f.size > 50*1024*1024)){ err.textContent="Each file must be under 50 MB."; return; }
    const collabs = mkUsers($id("mkCollab").value);
    if(collabs.length>3){ err.textContent="Instagram allows at most 3 collaborators."; return; }

    btn.disabled=true;
    try{
      if(!window.sb) throw new Error("Not connected.");
      const uid = window.Auth && Auth.profile && Auth.profile.id;
      if(!uid) throw new Error("You're signed out. Sign in again to publish.");
      const upload = async (file, convertKind)=>{
        const isVid = /^video\//.test(file.type||"");
        const m = isVid ? file : await toInstagramJpeg(file, convertKind, convertKind==="story" ? storyOverlay() : null);
        const path = `${uid}/${Date.now()}-${Math.random().toString(36).slice(2,8)}-${(m.name||(isVid?"clip.mp4":"photo.jpg")).replace(/[^a-zA-Z0-9._-]/g,"")}`;
        const up = await sb.storage.from("ig-media").upload(path, m, { upsert:false, contentType:m.type||(isVid?"video/mp4":"image/jpeg") });
        if(up.error) throw up.error;
        return { type: isVid?"video":"image", url: sb.storage.from("ig-media").getPublicUrl(path).data.publicUrl };
      };
      const tagsList = mkUsers($id("mkTags").value);
      const storyOverlay = ()=>({ text: $id("mkStoryText").value, mentions: $id("mkStoryShowMentions").checked ? tagsList.map(u=>"@"+u).join(" ") : "" });
      const media=[];
      for(let i=0;i<files.length;i++){ btn.textContent=`Uploading ${i+1}/${files.length}…`; media.push(await upload(files[i], kind)); }
      const body = { kind, media, caption: kind==="story" ? "" : cap.value, user_tags: tagsList, collaborators: kind==="story" ? [] : collabs };
      if(kind==="reel"){
        const cov = ($id("mkCover").files||[])[0];
        body.reel = { share_to_feed: $id("mkShareFeed").checked, audio_name: $id("mkAudio").value.trim() };
        if(cov){ btn.textContent="Uploading cover…"; body.reel.cover_url = (await upload(cov, "reel")).url; }
        else if($id("mkThumb").value) body.reel.thumb_offset_ms = Math.round(parseFloat($id("mkThumb").value)*1000);
      }
      btn.textContent = vids.length ? "Publishing… (videos take up to a minute)" : "Publishing…";
      const { data, error } = await sb.functions.invoke("instagram-publish", { body });
      if(error) throw new Error(await fnError(error));
      if(data && data.error) throw new Error(data.error);
      if(window.Tracker) Tracker.security("instagram_publish", { kind, items: media.length, permalink: (data && data.permalink) || null });
      let note = K.ok + (data && data.carousel ? " (carousel)" : "");
      if(collabs.length && kind!=="story") note += " · collaborator invite sent";
      const skipped = (data && data.skipped_tags) || [], done = tagsList.filter(u=>!skipped.includes(u));
      if(done.length) note += kind==="story" ? ` · mentioned ${done.map(u=>"@"+u).join(", ")} (they'll be notified)` : ` · tagged ${done.map(u=>"@"+u).join(", ")}`;
      if(skipped.length) note += ` · ⚠️ couldn't ${kind==="story"?"mention":"tag"} ${skipped.map(u=>"@"+u).join(", ")} — check the spelling; private accounts or people who turned off mentions can't be tagged`;
      // campaign post → record it so the brief check runs and the brand report tracks it
      const rule = _mkRules.find(x=>x.participation_id===$id("mkCamp").value);
      if(rule){
        if(rule.can_record_post && data && data.permalink){
          const rr = await sb.schema("api").rpc("record_campaign_post", { p_participation: rule.participation_id,
            p_payload: { media_type: kind==="feed" ? "post" : kind, permalink: data.permalink, caption: body.caption } });
          note += rr.error ? " · couldn't record it on the campaign: "+(rr.error.message||rr.error)
                : (rr.data && rr.data.caption_check==="issues" ? " · ⚠️ caption is missing something from the brief — check Alerts" : " · recorded on the campaign ✓");
        } else if(!rule.can_record_post){
          note += " · this campaign isn't at the posting step yet, so it wasn't recorded there";
        }
      }
      msg.innerHTML = esc(note) + (data && data.permalink ? ` · <a href="${esc(data.permalink)}" target="_blank" rel="noopener">View on Instagram ↗</a>` : "");
      msg.className="lead-msg ok";
      if(typeof refreshMediaKit==="function"){ setTimeout(()=>refreshMediaKit(true), 3000); setTimeout(()=>refreshMediaKit(true), 15000); }
      const postedFor = rule && rule.can_record_post ? rule.participation_id : null;
      cap.value=""; $id("mkTags").value=""; $id("mkStoryText").value=""; $id("mkCollab").value=""; $id("mkAudio").value=""; $id("mkThumb").value=""; $id("mkCover").value=""; $id("mkCamp").value=""; $id("mkCampCard").innerHTML="";
      applyKind(); counter();
      if(postedFor && form._mkNext){
        const { data:fresh } = await sb.schema("api").rpc("get_my_posting_rules");
        const r2 = (fresh||[]).find(x=>x.participation_id===postedFor), nx = r2 && (r2.formats||[]).find(f=>f.done<f.need);
        if(nx) await form._mkNext(postedFor, esc(note) + ` · <b>Next for this campaign: ${esc(nx.label)}</b> — it's filled in, pick your file.`);
      }
    }catch(ex){
      err.textContent = (ex.message||ex);
    }finally{
      btn.disabled=false; btn.textContent=(MK_KIND[kindSel.value]||MK_KIND.feed).btn;
    }
  };
}

/* ================= BULK CREATOR UPLOAD (inside a campaign's Barter process → 📥 Bulk upload) =================
 * Google Sheet link / Excel / CSV / Word (table or list) / paste → columns matched automatically → preview with a
 * STATUS for every creator (each one can already be on a different step: Invited · Approved · Contract signed ·
 * Address confirmed · Courier sent · Courier received) → Upload & invite. On Geek OS already → put on that step
 * now. Not on Geek OS → WhatsApp + email invite; when they register their profile is made from the sheet and they
 * land on that step. Instagram handles are auto-fetched (followers, name, photo). The list follows every row live. */
let _bk = { rows:null, head:null, map:null, preview:null, list:null, src:"", busy:false, note:"" };
const BK_FIELDS = [
  ["name","Name", /^(full ?name|name|creator( name)?|influencer( name)?)$/i],
  ["handle","Instagram", /^(?!.*(track|awb|courier)).*(insta|^ig\b|handle|username|profile|account|link|url)/i],
  ["phone","WhatsApp", /^(?!.*(track|awb|courier|pin|zip|postal|follower)).*(whats ?app|phone|mobile|contact( no| number)?|number|cell|wa\b)/i],
  ["email","Email", /(e-?mail|mail id)/i],
  ["city","City", /(city|location|place|town)/i],
  ["followers","Followers", /(follower|followers|reach|fans)/i],
  ["status","Status", /^(?!.*(mail|address|track)).*(status|stage|phase|step|approv|selected|confirm|final|shortlist|tick|✓)/i],
  ["address","Address", /^(?!.*(e-?mail|mail id)).*(address|addr\b)/i],
  ["state","State", /^(state|province)\b/i],
  ["pincode","PIN code", /(pin ?code|^pin\b|zip|postal|post ?code)/i],
  ["courier","Courier", /(courier|carrier|delivery partner|shipping partner)/i],
  ["tracking","Tracking", /(track|awb|consignment|docket|waybill)/i]
];
// each creator can already be on any step — the sheet's Status column uses these exact words (= the Barter process steps)
// [key, write this in the sheet, what happens, message the creator gets]
const BK_STATUSES = [
  ["registered","Registered","added to the campaign, waiting for screening","no message"],
  ["screened","Screened","checked against the brand's criteria","no message"],
  ["sent_to_brand","Sent to brand","on the brand's final list","no message"],
  ["approved","Approved","brand said yes → contract goes out","Invite (geek_campaign_access)"],
  ["contract_sent","Contract sent","creator signs it in the app","Sign your contract"],
  ["contract_signed","Contract signed","next: creator confirms the address","Confirm your address"],
  ["address_confirmed","Address confirmed","next: you add the courier","no message"],
  ["courier_sent","Courier sent","next: creator taps Received","Product shipped"],
  ["courier_delivered","Courier delivered","video brief goes out · video deadline starts today","Video brief"],
  ["video_brief_sent","Video brief sent","video deadline starts today (campaign's days) + reminders","Video brief"],
  ["video_submitted","Video submitted","waiting for the brand's review","no message"],
  ["client_approved","Client approved","next: creator posts it","Video approved — post it"],
  ["posted","Posted","campaign complete · numbers show everywhere · feedback optional","Campaign complete"]];
const bkStLabel = k => (BK_STATUSES.find(x=>x[0]===k)||BK_STATUSES[0])[1];
const bkStMsg = k => (BK_STATUSES.find(x=>x[0]===k)||BK_STATUSES[0])[3];
const bkStRank = k => Math.max(0, BK_STATUSES.findIndex(x=>x[0]===k)) + 1;
// same reading as the database (intel.ci_bulk_status): null = not understood
function bkStatus(v){
  const t = String(v==null?"":v).trim().toLowerCase().replace(/^\d+\s*[.)-]?\s*/,"").replace(/\s+/g," ");
  const M = { registered:["","registered","register","applied","invited","invite","new","pending","-","—"], screened:["screened","eligible","shortlisted"],
    sent_to_brand:["sent to brand","sent to the brand","with brand"], approved:["approved","brand confirmed","brand approved","selected","confirmed","yes","y","ok","final","✓","✔"],
    contract_sent:["contract sent","contract"], contract_signed:["contract signed","signed"], address_confirmed:["address confirmed","address","address done"],
    courier_sent:["courier sent","shipped","dispatched","in transit","product sent"],
    courier_delivered:["courier delivered","courier received","delivered","received","product received","product delivered"],
    video_brief_sent:["video brief sent","brief sent","video brief"], video_submitted:["video submitted","submitted","video sent"],
    client_approved:["client approved","video approved","content approved"], posted:["posted","live","published","reel posted","done","completed","complete"] };
  for(const k in M) if(M[k].includes(t)) return k;
  return null;
}
const bkNeedsAddr = k => { const r = bkStRank(k); return r>=7 && r<=9; };
const BK_SAMPLE = [
  ["Name","Instagram","WhatsApp","Email","City","Status","Address","State","PIN code","Courier","Tracking"],
  ["Asha Rao","@asha.creates","9876543210","asha@example.com","Mumbai","Approved","","","","",""],
  ["Rohan Mehta","https://instagram.com/rohan.eats","+91 98111 22233","rohan@example.com","Delhi","",""," ","","",""],
  ["Meera Shah","meera.styles","9000011111","","Pune","Address confirmed","Flat 4B, Lake View, Koregaon Park","Maharashtra","411001","",""],
  ["Kabir Sen","@kabir.cooks","9830012345","kabir@example.com","Kolkata","Courier sent","12 Park St","West Bengal","700016","DTDC","D12345678"],
  ["Nisha Jain","nisha.home","9123456780","","Jaipur","Video brief sent","22 C-Scheme","Rajasthan","302001","Delhivery","https://www.delhivery.com/track/package/1234"]].map(r=>r.map(c=>c.trim()));
const BK_GUIDE = [
  ["Name","Creator's name — their profile is made with it","Asha Rao","optional"],
  ["Instagram","@handle, handle or profile link — followers, name & photo are fetched automatically","@asha.creates","one of these 3"],
  ["WhatsApp","10-digit number (India) or +country code — the invite + all updates go here","9876543210","one of these 3"],
  ["Email","Their email — the invite goes here too","asha@example.com","one of these 3"],
  ["City","City","Mumbai","optional"],
  ["Status","The exact step name (see Statuses above). Blank = Registered","Video brief sent","optional"],
  ["Address","Delivery address — for Address confirmed / Courier sent / Courier delivered","12 Park St","for those 3"],
  ["State","State of the address","West Bengal","optional"],
  ["PIN code","6-digit PIN (we also find it inside the address)","700016","optional"],
  ["Courier","Courier company — for Courier sent / Courier delivered","DTDC","optional"],
  ["Tracking","Tracking ID or tracking link","D12345678","optional"]];
async function bkDownloadXlsx(){
  await bkLoadScript("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js");
  const ws = XLSX.utils.aoa_to_sheet(BK_SAMPLE);
  ws["!cols"] = [{wch:16},{wch:30},{wch:16},{wch:22},{wch:11},{wch:18},{wch:34},{wch:14},{wch:9},{wch:11},{wch:30}];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Creators");
  XLSX.writeFile(wb, "geek-creators-template.xlsx");
}
const bkEsc = s => esc(s==null ? "" : String(s));

function bkSplitCsv(text){
  const rows = []; let row = [], cur = "", q = false;
  const t = String(text||"").replace(/\r\n?/g, "\n");
  const sep = (t.split("\n")[0].match(/\t/g)||[]).length > (t.split("\n")[0].match(/,/g)||[]).length ? "\t" : ",";
  for(let i=0;i<t.length;i++){
    const ch = t[i];
    if(q){ if(ch==='"'){ if(t[i+1]==='"'){ cur+='"'; i++; } else q=false; } else cur+=ch; continue; }
    if(ch==='"'){ q=true; continue; }
    if(ch===sep){ row.push(cur.trim()); cur=""; continue; }
    if(ch==="\n"){ row.push(cur.trim()); rows.push(row); row=[]; cur=""; continue; }
    cur+=ch;
  }
  if(cur!=="" || row.length){ row.push(cur.trim()); rows.push(row); }
  return rows.filter(r=> r.some(c=>c!==""));
}
// a list without columns (Word / pasted notes): pull phone, email, Instagram and name out of each line
function bkFromLines(lines){
  const out = [["Name","Instagram","WhatsApp","Email"]];
  lines.forEach(l=>{
    l = String(l||"").trim(); if(!l) return;
    const email = (l.match(/[^\s@,;]+@[^\s@,;]+\.[a-z]{2,}/i)||[""])[0];
    const ig = (l.match(/instagram\.com\/([A-Za-z0-9._]+)/i)||[])[1] || (l.replace(email,"").match(/(^|\s)@([A-Za-z0-9._]{2,30})/)||[])[2] || "";
    const phone = (l.replace(email,"").match(/(\+?\d[\d\s-]{8,}\d)/)||[""])[0];
    if(!email && !ig && !phone) return;
    const name = l.replace(email,"").replace(/(https?:\/\/)?\S*instagram\.com\/\S*/gi,"").replace(/https?:\/\/\S+/g,"").replace(/@[A-Za-z0-9._]+/g,"").replace(phone,"")
      .replace(/^\s*(\d+[.)]|[-*•▪●])\s*/,"").replace(/[|,;:–—-]+/g," ").replace(/\s+/g," ").trim();
    out.push([name, ig, phone, email]);
  });
  return out;
}
function bkLoadScript(src){
  return new Promise((ok, bad)=>{ if(document.querySelector(`script[src="${src}"]`)) return ok();
    const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = ()=> bad(new Error("Couldn't load the file reader — check your connection.")); document.head.appendChild(s); });
}
async function bkReadFile(file){
  const name = (file.name||"").toLowerCase();
  if(/\.(xlsx|xls|xlsm|ods)$/.test(name)){
    await bkLoadScript("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js");
    const wb = XLSX.read(await file.arrayBuffer(), { type:"array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws, { header:1, raw:false, defval:"" }).map(r=> r.map(c=> String(c==null?"":c).trim())).filter(r=> r.some(Boolean));
  }
  if(/\.docx$/.test(name)){
    await bkLoadScript("https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js");
    const res = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
    const doc = new DOMParser().parseFromString(res.value, "text/html");
    const table = [...doc.querySelectorAll("table")].sort((a,b)=> b.rows.length - a.rows.length)[0];
    if(table && table.rows.length > 1) return [...table.rows].map(tr=> [...tr.cells].map(td=> td.textContent.trim())).filter(r=> r.some(Boolean));
    return bkFromLines([...doc.querySelectorAll("p,li")].map(p=> p.textContent));
  }
  if(/\.doc$/.test(name)) throw new Error("Old .doc files can't be read — in Word choose File → Save As → .docx (or copy the table and paste it below).");
  const text = await file.text();
  const rows = bkSplitCsv(text);
  return rows.length && rows[0].length > 1 ? rows : bkFromLines(text.split("\n"));
}
async function bkReadSheetLink(url){
  const id = (url.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/)||[])[1];
  if(!id){
    if(/docs\.google\.com\/document/.test(url)) throw new Error("That's a Google Doc — open it, choose File → Download → Microsoft Word (.docx) and upload the file here.");
    throw new Error("Paste the link of a Google Sheet (docs.google.com/spreadsheets/…).");
  }
  const gid = (url.match(/[#&?]gid=(\d+)/)||[])[1] || "0";
  const r = await fetch(`https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&gid=${gid}`).catch(()=>null);
  const text = r && r.ok ? await r.text() : "";
  if(!text || /^\s*</.test(text)) throw new Error("Couldn't open the sheet. In Google Sheets tap Share → General access → “Anyone with the link” (Viewer), then try again — or download it as .xlsx / .csv and upload.");
  return bkSplitCsv(text);
}
function bkAutoMap(head){
  const map = {}; const used = new Set();
  BK_FIELDS.forEach(([k,,re])=>{ const i = head.findIndex((h,ix)=> !used.has(ix) && re.test(String(h||""))); if(i>=0){ map[k]=i; used.add(i); } });
  return map;
}
function bkLooksLikeHeader(row){ return row.some(c=> BK_FIELDS.some(([,,re])=> re.test(String(c||"")))) && !row.some(c=> /@.+\./.test(c) || /\d{8,}/.test(String(c).replace(/\D/g,""))); }
function bkSetRows(rows, src){
  if(!rows || !rows.length) throw new Error("No rows found in that file.");
  let head = rows[0], body = rows.slice(1);
  if(!bkLooksLikeHeader(head)){ head = head.map((_,i)=>`Column ${i+1}`); body = rows; }
  const width = Math.max(...rows.map(r=>r.length));
  head = Array.from({length:width}, (_,i)=> head[i] || `Column ${i+1}`);
  _bk.head = head; _bk.map = bkAutoMap(head);
  // no named columns → guess from the values
  if(_bk.map.phone==null || _bk.map.email==null || _bk.map.handle==null){
    for(let i=0;i<width;i++){
      if(Object.values(_bk.map).includes(i)) continue;
      const vals = body.slice(0,20).map(r=>String(r[i]||""));
      if(_bk.map.email==null && vals.filter(v=>/@.+\./.test(v)).length >= Math.max(1, vals.length/3)) _bk.map.email = i;
      else if(_bk.map.phone==null && vals.filter(v=>v.replace(/\D/g,"").length>=10 && !/[a-z]/i.test(v)).length >= Math.max(1, vals.length/3)) _bk.map.phone = i;
      else if(_bk.map.handle==null && vals.filter(v=>/instagram\.com|^@/.test(v)).length >= Math.max(1, vals.length/3)) _bk.map.handle = i;
    }
  }
  _bk.rows = body.map(r=> ({ cells: r, status: _bk.map.status!=null ? (bkStatus(r[_bk.map.status])||"registered") : "registered" }));
  _bk.src = src; _bk.preview = null;
}
function bkRowData(r){
  const g = k => _bk.map[k]!=null ? String(r.cells[_bk.map[k]]||"").trim() : "";
  return { name:g("name"), handle:g("handle"), phone:g("phone"), email:g("email"), city:g("city"), followers:g("followers"),
           status: r.status||"registered", approved: bkStRank(r.status||"registered")>=4,
           address:g("address"), state:g("state"), pincode:g("pincode"), courier:g("courier"), tracking:g("tracking") };
}
async function bkCheck(){
  if(!_bk.rows) return;
  const { data, error } = await sb.schema("api").rpc("bulk_preview", { p_campaign:_bpCamp.id, p_rows: _bk.rows.map(bkRowData) }).then(r=>r, e=>({error:e}));
  _bk.preview = error ? { error: error.message||String(error) } : (data||[]);
  paintBulk();
}
async function loadBulkList(){
  const { data, error } = await sb.schema("api").rpc("bulk_invites", { p_campaign:_bpCamp.id }).then(r=>r, e=>({error:e}));
  _bk.list = error ? { error: error.message||String(error) } : (data||[]);
  const box = document.getElementById("bkList"); if(box) box.innerHTML = bkListHtml(); wireBulkList();
}
function bkStatusChip(p, r){
  if(!p) return '<span class="muted">…</span>';
  if(p.no_contact) return '<span class="tag warn">⚠ no WhatsApp / email / Instagram</span>';
  const st = (r && r.status) || "registered";
  const bad = (p.phone_bad?" · number looks wrong":"") + (p.email_bad?" · email looks wrong":"");
  const warn = [bad.slice(3), r && r._addrMissing ? "add the address" : ""].filter(Boolean).join(" · ");
  const ig = p.ig && (p.ig.followers || p.ig.name) ? `<div class="muted bk-ig">📸 ${p.ig.name?bkEsc(p.ig.name)+" · ":""}${p.ig.followers?Number(p.ig.followers).toLocaleString("en-IN")+" followers":""}</div>` : "";
  const land = ` → <b>${bkEsc(bkStLabel(st))}</b>`;
  const main = p.on_platform
    ? (p.stage ? `<span class="tag">already in · ${bkEsc(String(p.stage).replace(/_/g," "))}${land}</span>`
               : `<span class="tag good">On Geek OS${p.who?` · ${bkEsc(p.who)}`:""} — added now${land}</span>`)
    : `<span class="tag">New — joins on ${bkEsc(bkStLabel(st))} after sign-up</span>`;
  // a new person on an approved-or-later step with no message of its own still gets the register invite
  const msg = (bkStMsg(st)==="no message" && !p.on_platform && bkStRank(st) >= 4) ? "Invite (geek_campaign_access)" : bkStMsg(st), via = [p.phone?"WhatsApp":null, p.email?"email":null].filter(Boolean).join(" + ");
  const msgTag = msg==="no message" ? `<div class="muted bk-ig">✉️ no message for this step</div>` : `<div class="muted bk-ig">✉️ sends: <b>${bkEsc(msg)}</b>${via?` on ${via}`:""}</div>`;
  return main + (warn?`<span class="tag warn">${bkEsc(warn)}</span>`:"") + msgTag + ig;
}
function bkStatusSelect(attr, val, extra){
  const r = bkStRank(val), cls = !val ? "" : r<=3 ? "st-pre" : r<=6 ? "st-contract" : r<=9 ? "st-ship" : r<=12 ? "st-video" : "st-done";
  return `<select class="bk-stsel ${cls}" ${attr}${extra||""}>${BK_STATUSES.map(([k,l],n)=>`<option value="${k}"${k===val?" selected":""}>${n+1}. ${l}</option>`).join("")}</select>`;
}
function bulkHtml(){
  const rows = _bk.rows||[], pv = Array.isArray(_bk.preview) ? _bk.preview : null;
  const valid = pv ? pv.filter(p=>!p.no_contact).length : rows.length;
  rows.forEach(r=>{ const d = bkRowData(r); r._addrMissing = bkNeedsAddr(r.status) && !d.address; });
  const live = rows.filter((r,i)=> !(pv && pv[i] && pv[i].no_contact));
  const byStatus = BK_STATUSES.map(([k,l])=>[l, live.filter(r=>(r.status||"registered")===k).length]).filter(x=>x[1]);
  const noAddr = live.filter(r=>r._addrMissing).length;
  return `<div class="card bk-card">
      <h3 style="margin:0 0 4px">📥 Upload creators in bulk</h3>
      <div class="muted" style="font-size:13px;margin-bottom:10px">Google Sheet link, Excel / CSV, or a Word file (table or a simple list). Give every creator a <b>Status</b> — the exact step they are on (see the guide). They get <b>one message for that step</b>: <b>Approved</b> → the invite; a later step → only that step's message. Creators on Geek OS with a complete profile go on that step now; new ones register, connect Instagram and complete their profile (pre-filled from your sheet) and then land on their step. From there the normal flow and reminders carry on.</div>
      ${bkWaLine()}
      ${bkGuideHtml(!rows.length)}
      <div class="bk-src">
        <label class="btn sm ghost bk-file">📄 Choose file<input type="file" id="bkFile" accept=".csv,.tsv,.txt,.xlsx,.xls,.xlsm,.ods,.docx,.doc" hidden></label>
        <input id="bkLink" placeholder="or paste a Google Sheet link" value="">
        <button class="btn sm ghost" id="bkLinkGo">Load sheet</button>
        <button class="btn sm ghost" id="bkPick">🎯 Pick from Geek OS instead</button>
      </div>
      <details class="bk-paste"><summary>…or paste rows (copy cells from Sheets / Excel / Word)</summary>
        <textarea id="bkPaste" rows="4" placeholder="Name, Instagram, WhatsApp, Email, City, Status, Address, State, PIN code, Courier, Tracking"></textarea>
        <button class="btn sm ghost" id="bkPasteGo">Use pasted rows</button></details>
      <div class="auth-err" id="bkErr"></div>
      ${rows.length ? `
      <div class="bk-meta"><b>${rows.length}</b> row${rows.length>1?"s":""} from ${bkEsc(_bk.src)} · match the columns:</div>
      <div class="bk-map">${BK_FIELDS.map(([k,l])=>`<label><span>${l}</span><select data-bkmap="${k}"><option value="">—</option>${_bk.head.map((h,i)=>`<option value="${i}"${_bk.map[k]===i?" selected":""}>${bkEsc(h)}</option>`).join("")}</select></label>`).join("")}</div>
      <div class="bk-setall"><span>Set everyone to</span>${bkStatusSelect('id="bkAllSt"', "", "")}<span class="muted">— or change each row below</span></div>
      <div class="bk-tablewrap"><table class="bk-table"><thead><tr>
        <th>Status</th><th>Name</th><th>Instagram</th><th>WhatsApp</th><th>Email</th><th>City</th><th>Address · courier</th><th>What happens</th></tr></thead><tbody>
        ${rows.map((r,i)=>{ const d = bkRowData(r), p = pv && pv[i];
          const raw = _bk.map.status!=null ? String(r.cells[_bk.map.status]||"").trim() : "";
          const unread = raw && !bkStatus(raw);
          const ship = [d.address, [d.state, d.pincode].filter(Boolean).join(" "), [d.courier, d.tracking].filter(Boolean).join(" · ")].filter(Boolean).join(" · ");
          return `<tr class="${p&&p.no_contact?"bk-bad":""}"><td>${bkStatusSelect(`data-bkst="${i}"`, r.status||"registered", p&&p.no_contact?" disabled":"")}${unread?`<div class="muted bk-raw" title="Couldn't read this status — pick it">“${bkEsc(raw.slice(0,24))}”?</div>`:""}</td>
            <td>${bkEsc(d.name)||'<span class="muted">—</span>'}</td><td>${p&&p.handle?"@"+bkEsc(p.handle):bkEsc(d.handle)}</td>
            <td>${p&&p.phone?bkEsc(p.phone):bkEsc(d.phone)}</td><td>${bkEsc(p&&p.email||d.email)}</td><td>${bkEsc(d.city)}</td>
            <td class="bk-ship">${ship?bkEsc(ship):'<span class="muted">—</span>'}</td>
            <td>${pv?bkStatusChip(p, r):'<span class="muted">checking…</span>'}</td></tr>`; }).join("")}
      </tbody></table></div>
      ${_bk.preview && _bk.preview.error ? `<div class="auth-err">${bkEsc(_bk.preview.error)}</div>` : ""}
      <label class="bk-note"><span>Message to the creators (optional — goes with the invite)</span><input id="bkNote" maxlength="200" value="${bkEsc(_bk.note)}" placeholder="e.g. Diwali drop — we loved your recent reels!"></label>
      <div class="bk-go"><button class="btn" id="bkUpload"${_bk.busy||!valid?" disabled":""}>${_bk.busy?"Uploading…":`Upload &amp; invite ${valid} creator${valid===1?"":"s"}`}</button>
        <span class="muted">${byStatus.map(([l,n])=>`${n} ${bkEsc(l.toLowerCase())}`).join(" · ")}${noAddr?` · <b style="color:#b45309">${noAddr} without an address</b> (they add it in their profile)`:""}</span>
        <button class="btn sm ghost" id="bkClear">Clear</button></div>
      <div id="bkResult"></div>` : ""}
    </div>
    <div class="card" style="margin-top:12px"><h3 style="margin:0 0 8px">Uploaded creators <span class="muted" style="font-size:12px;font-weight:400">— live</span></h3><div id="bkList">${bkListHtml()}</div></div>`;
}
function bkWaLine(){
  const w = _bk.wa; if(!w || w==="loading") return "";
  if(w.whatsapp) return `<div class="bk-wa ok">✅ WhatsApp + email invites are on <span class="muted">(invite template <code>${bkEsc(w.invite_template||"geek_campaign_access")}</code> · every step update on its own <code>geek_step_*</code> template)</span></div>`;
  return `<div class="bk-wa warn">⚠️ <b>WhatsApp invites are waiting</b> — the WhatsApp template isn't set yet, so invites go by <b>email</b> now and on WhatsApp automatically the moment it's set.
    ${w.is_admin ? `<a href="#" id="bkSetWa">Set the template now →</a>` : `Ask the Geek Super Admin to set it (Super Admin → WhatsApp &amp; email).`}</div>`;
}
function bkGuideHtml(open){
  const tsv = BK_SAMPLE.map(r=>r.join("\t")).join("\n");
  return `<details class="bk-guide"${open?" open":""}><summary>📘 How to set up your sheet — with a ready template</summary>
    <ol class="bk-steps">
      <li><b>Download a template</b> below (Excel or CSV) — or copy it straight into a new Google Sheet.</li>
      <li><b>One creator per row.</b> Keep the first row as the column names.</li>
      <li>Every row needs <b>at least one of WhatsApp, Email or Instagram</b> — best is WhatsApp + email: the invite goes to both and all later updates go there.</li>
      <li><b>Status</b> column: write <b>exactly</b> one of the 13 step names below — where that creator is right now (every row can be different; blank = <b>Registered</b>). You can also change it here before and after the upload.</li>
      <li><b>Messages:</b> each creator gets <b>one</b> message for their step — <b>Approved</b> → the invite; Contract sent / Contract signed / Courier sent / Courier delivered / Video brief sent / Client approved / Posted → that step's message. <b>Posted</b> is the last step — the campaign is complete. Registered, Screened, Sent to brand, Address confirmed and Video submitted send no message.</li>
      <li><b>After that the normal flow runs:</b> next steps, follow-ups and reminders. From <b>Courier delivered / Video brief sent</b> the video deadline is the campaign's own number of days <b>from today</b>, with the usual reminders.</li>
      <li>For <b>Address confirmed</b>, <b>Courier sent</b> and <b>Courier delivered</b> add the <b>Address</b> (+ State, PIN code); for <b>Courier sent / delivered</b> also the <b>Courier</b> and <b>Tracking</b> ID or link.</li>
      <li><b>New creators</b> (not on Geek OS yet): the step's message carries the app link → they register → <b>connect Instagram</b> (media kit) → <b>complete the profile</b> (name, city, email, WhatsApp, address are <b>pre-filled from your sheet</b>; Instagram followers, name and photo are <b>fetched automatically</b>) → they join the campaign <b>right on their step</b> (earlier steps marked “confirmed offline”). No second message.</li>
      <li>Upload the file — or paste a Google Sheet link (Share → <b>Anyone with the link</b> → Viewer). Column names don't have to match exactly; we match them and you can fix them in the dropdowns.</li>
    </ol>
    <div class="bk-mini"><b>Statuses — write exactly this in the sheet:</b></div>
    <div class="bk-tablewrap" style="max-height:none"><table class="bk-table bk-gtable bk-sttable"><thead><tr><th>#</th><th>Write in Status</th><th>What happens</th><th>Message to the creator</th></tr></thead><tbody>
      ${BK_STATUSES.map(([k,l,h,m],n)=>`<tr><td><span class="bk-stn">${n+1}</span></td><td><code>${bkEsc(l)}</code></td><td>${bkEsc(h)}</td><td>${m==="no message"?'<span class="muted">— no message</span>':`✉️ ${bkEsc(m)}`}</td></tr>`).join("")}
    </tbody></table></div>
    <div class="bk-mini">Columns:</div>
    <div class="bk-tablewrap" style="max-height:none"><table class="bk-table bk-gtable"><thead><tr><th>Column</th><th>What to put</th><th>Example</th><th>Needed?</th></tr></thead><tbody>
      ${BK_GUIDE.map(g=>`<tr><td><b>${bkEsc(g[0])}</b></td><td>${bkEsc(g[1])}</td><td><code>${bkEsc(g[2])}</code></td><td>${g[3]==="optional"?'<span class="muted">optional</span>':`<span class="tag">${bkEsc(g[3])}</span>`}</td></tr>`).join("")}
    </tbody></table></div>
    <div class="bk-mini">Your sheet should look like this:</div>
    <div class="bk-tablewrap" style="max-height:none"><table class="bk-table bk-sample"><thead><tr>${BK_SAMPLE[0].map(h=>`<th>${bkEsc(h)}</th>`).join("")}</tr></thead>
      <tbody>${BK_SAMPLE.slice(1).map(r=>`<tr>${r.map(c=>`<td>${bkEsc(c)||'<span class="muted">—</span>'}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
    <div class="bk-dl">
      <button class="btn sm" id="bkXlsx">⬇ Excel template (.xlsx)</button>
      <a class="btn sm ghost" href="data:text/csv;charset=utf-8,${encodeURIComponent(BK_SAMPLE.map(r=>r.map(c=>/[",]/.test(c)?`"${c.replace(/"/g,'""')}"`:c).join(",")).join("\n"))}" download="geek-creators-template.csv">⬇ CSV template</a>
      <button class="btn sm ghost" id="bkCopyTpl" data-tsv="${bkEsc(tsv)}">📋 Copy for Google Sheets</button>
    </div>
    <div class="muted bk-mini">Google Sheets: copy → open a new sheet → click cell A1 → paste. · Word: make a table with the same columns, or write one creator per line like <code>Asha Rao – @asha.creates – 9876543210 – asha@example.com</code>.</div>
  </details>`;
}
// the creator's real step in the campaign, as a bulk Status (the sheet's value until they join)
const BK_FROM_STAGE = { applied:"registered", eligible:"screened", shortlisted:"screened", sent_to_brand:"sent_to_brand", invited:"approved", accepted:"approved",
  brand_confirmed:"approved", contract_sent:"contract_sent", contract_signed:"contract_signed", address_confirmed:"address_confirmed",
  product_sent:"courier_sent", content_created:"video_brief_sent", content_submitted:"video_submitted", changes_requested:"video_brief_sent",
  content_approved:"client_approved", published:"posted", completed:"posted" };
function bkLiveStatus(x){
  const sheet = x.sheet_status==="invited" ? "registered" : x.sheet_status==="courier_received" ? "courier_delivered" : (x.sheet_status || (x.approved ? "approved" : "registered"));
  const live = x.stage && BK_FROM_STAGE[x.stage];
  return live && bkStRank(live) >= bkStRank(sheet) ? live : sheet;
}
function bkListHtml(){
  const L = _bk.list;
  if(!L) return skel("list",3);
  if(L.error) return `<div class="muted">${bkEsc(L.error)} — run <code>supabase db push</code> first.</div>`;
  if(!L.length) return `<div class="muted">Nobody uploaded yet.</div>`;
  const n = s => L.filter(x=>x.status===s).length;
  const ch = o => !o ? "" : o.status==="sent" ? "✓" : o.status==="failed" ? "✗" : o.status==="skipped" ? "⏸" : "…";
  return `<div class="bk-sum"><span><b>${n("joined")}</b> in the campaign</span><span><b>${n("registered")}</b> registered · still to connect</span><span><b>${n("invited")}</b> invited · not registered yet</span></div>
    ${L.map(x=>{
      const who = x.instagram || (x.handle?"@"+x.handle:"") || x.name || x.phone || x.email;
      const miss = Array.isArray(x.missing) ? x.missing : [];
      const st = x.status==="joined" ? `<span class="tag good">✓ ${bkEsc(String(x.stage||"").replace(/_/g," "))}</span>`
               : x.status==="registered" ? `<span class="tag warn">Registered · ${miss.length?"connecting":"joining"}</span>`
               : `<span class="tag">Invited · not registered</span>`;
      const ig = x.ig ? (x.ig.followers || x.ig.name ? `<span class="muted bk-ch">📸 ${x.ig.name?bkEsc(x.ig.name)+" · ":""}${x.ig.followers?Number(x.ig.followers).toLocaleString("en-IN")+" followers":""}</span>`
                                                     : `<span class="muted bk-ch">📸 ${x.ig.error?"Instagram: "+bkEsc(String(x.ig.error).slice(0,60)):"fetching Instagram…"}</span>`) : "";
      const msgs = x.status==="invited" ? `<span class="muted bk-ch">${x.phone?`WhatsApp ${ch(x.wa)}`:""}${x.phone&&x.email?" · ":""}${x.email?`Email ${ch(x.mail)}`:""}${x.invites_sent>1?` · sent ${x.invites_sent}×`:""}</span>` : "";
      const err = [x.wa&&x.wa.status!=="sent"&&x.wa.error, x.mail&&x.mail.status!=="sent"&&x.mail.error].filter(Boolean)[0];
      return `<div class="bk-row">
        <div class="bk-who"><b>${bkEsc(who)}</b>${x.name&&who!==x.name?` <span class="muted">${bkEsc(x.name)}</span>`:""}
          <div class="muted" style="font-size:12px">${[x.phone,x.email,x.city].filter(Boolean).map(bkEsc).join(" · ")}</div></div>
        <div class="bk-st">${st} ${msgs} ${ig}
          ${miss.length && x.status!=="invited" ? `<div class="muted" style="font-size:12px">Still to connect: ${miss.map(bkEsc).join(" + ")} · or pick a status to move them in now</div>`:""}
          ${x.profile_pct!=null && x.status!=="invited" ? `<span class="bk-pct" title="Creator profile (optional)">📝 Profile ${x.profile_pct}%</span>`:""}
          ${err?`<div class="muted" style="font-size:12px;color:#b45309">${bkEsc(String(err).slice(0,140))}</div>`:""}</div>
        <div class="bk-act">
          ${x.participation_id?`<button class="mini-btn" data-bkopen="${bkEsc(x.participation_id)}">Open</button>`:""}
          <label class="bk-chg" title="Where this creator is right now — updates on its own as they move; pick a later step to move them forward (never back)">${bkStatusSelect(`data-bkset="${bkEsc(x.invite_id)}"`, bkLiveStatus(x), "")}</label>
          ${x.status!=="joined"?`<button class="mini-btn ghost" data-bkre="${bkEsc(x.invite_id)}">Resend</button><button class="mini-btn ghost" data-bkdel="${bkEsc(x.invite_id)}">Remove</button>`:""}
        </div></div>`; }).join("")}`;
}
function paintBulk(){
  const sec = document.querySelector("#bpBody .ac360-sec"); if(!sec || _bpTab!=="bulk") return;
  const y = sec.closest(".ac360-body") ? sec.closest(".ac360-body").scrollTop : 0;
  sec.innerHTML = bulkHtml(); wireBulk();
  const b = sec.closest(".ac360-body"); if(b) b.scrollTop = y;
}
function wireBulkList(){
  const box = document.getElementById("bkList"); if(!box) return;
  const act = (sel, fn)=> box.querySelectorAll(sel).forEach(b=> b.onclick = async ()=>{ b.disabled = true; try{ await fn(b); }catch(e){ gateToast(e.message||String(e)); } b.disabled = false; loadBulkList(); });
  act("[data-bkre]", async b=>{ const { data, error } = await sb.schema("api").rpc("bulk_resend_invite", { p_invite:b.dataset.bkre }); if(error) throw error;
    gateToast(data && data.status==="joined" ? "They're on Geek OS — added to the campaign ✓" : "Invite sent again ✓"); });
  box.querySelectorAll("[data-bkset]").forEach(sel=> sel.onchange = async ()=>{ sel.disabled = true;
    try{ const { data, error } = await sb.schema("api").rpc("bulk_set_status", { p_invite:sel.dataset.bkset, p_status:sel.value }); if(error) throw error;
      gateToast(`Status → ${bkStLabel(sel.value)} ✓${data && data.stage ? " · on the campaign now: "+String(data.stage).replace(/_/g," ") : " · their step's message is sent; it applies when they register"}`); }
    catch(e){ gateToast(e.message||String(e)); }
    sel.disabled = false; loadBulkList(); });
  act("[data-bkdel]", async b=>{ if(!confirm("Remove this creator from the upload? (No message is sent.)")) return; const { error } = await sb.schema("api").rpc("bulk_delete_invite", { p_invite:b.dataset.bkdel }); if(error) throw error; });
  box.querySelectorAll("[data-bkopen]").forEach(b=> b.onclick = ()=>{ _bpOpen = b.dataset.bkopen; _bpTab = "tracker"; paintBarterProcess(); });
}
function wireBulk(){
  const $b = id => document.getElementById(id), err = $b("bkErr");
  const take = async (fn, src)=>{ err.textContent = ""; try{ bkSetRows(await fn(), src); paintBulk(); bkCheck(); }catch(e){ err.textContent = e.message||String(e); } };
  const f = $b("bkFile"); if(f) f.onchange = ()=>{ const file = f.files && f.files[0]; if(file) take(()=>bkReadFile(file), file.name); };
  const lg = $b("bkLinkGo"); if(lg) lg.onclick = ()=>{ const u = $b("bkLink").value.trim(); if(u){ lg.textContent = "Loading…"; take(()=>bkReadSheetLink(u), "Google Sheet").finally(()=>{ if(lg.isConnected) lg.textContent = "Load sheet"; }); } };
  const pg = $b("bkPasteGo"); if(pg) pg.onclick = ()=>{ const t = $b("bkPaste").value; take(async()=>{ const r = bkSplitCsv(t); return r.length && r[0].length>1 ? r : bkFromLines(t.split("\n")); }, "pasted rows"); };
  document.querySelectorAll("[data-bkmap]").forEach(s=> s.onchange = ()=>{ const k = s.dataset.bkmap; if(s.value==="") delete _bk.map[k]; else _bk.map[k] = +s.value;
    if(k==="status") _bk.rows.forEach(r=> r.status = _bk.map.status!=null ? (bkStatus(r.cells[_bk.map.status])||"registered") : "registered");
    _bk.preview = null; paintBulk(); bkCheck(); });
  document.querySelectorAll("[data-bkst]").forEach(c=> c.onchange = ()=>{ _bk.rows[+c.dataset.bkst].status = c.value; paintBulk(); });
  const all = $b("bkAllSt"); if(all){ all.insertAdjacentHTML("afterbegin", '<option value="" selected>— choose —</option>'); all.value = "";
    all.onchange = ()=>{ if(!all.value) return; _bk.rows.forEach(r=> r.status = all.value); paintBulk(); }; }
  const note = $b("bkNote"); if(note) note.oninput = ()=>{ _bk.note = note.value; };
  if(_bk.wa===undefined){ _bk.wa = "loading";
    sb.schema("api").rpc("wa_invite_ready").then(r=>{ _bk.wa = r && !r.error ? (r.data||{}) : null; paintBulk(); }, ()=>{ _bk.wa = null; }); }
  const sw = $b("bkSetWa"); if(sw) sw.onclick = e=>{ e.preventDefault(); if(window.__bpClose) window.__bpClose(); _adminTab = "delivery"; currentPage = "admin"; renderShell(); };
  const xl = $b("bkXlsx"); if(xl) xl.onclick = async ()=>{ xl.disabled = true; try{ await bkDownloadXlsx(); }catch(e){ err.textContent = e.message||String(e); } xl.disabled = false; };
  const ct = $b("bkCopyTpl"); if(ct) ct.onclick = async ()=>{ try{ await navigator.clipboard.writeText(ct.dataset.tsv); ct.textContent = "✓ Copied — paste in cell A1"; }catch(e){ err.textContent = "Couldn't copy — use the Excel or CSV template instead."; } };
  const pk = $b("bkPick"); if(pk) pk.onclick = ()=>{ const c = _bpCamp; if(window.__bpClose) window.__bpClose(); openInvitePanel(c.id, c.name); };
  const cl = $b("bkClear"); if(cl) cl.onclick = ()=>{ _bk.rows = null; _bk.preview = null; paintBulk(); };
  const up = $b("bkUpload"); if(up) up.onclick = async ()=>{
    const pv = Array.isArray(_bk.preview) ? _bk.preview : [];
    const rows = _bk.rows.map(bkRowData).filter((d,i)=> !(pv[i] && pv[i].no_contact));
    if(!rows.length) return;
    _bk.busy = true; paintBulk();
    const { data, error } = await sb.schema("api").rpc("bulk_import_creators", { p_campaign:_bpCamp.id, p_rows: rows, p_note: _bk.note||null }).then(r=>r, e=>({error:e}));
    _bk.busy = false;
    if(error){ paintBulk(); const e2 = document.getElementById("bkErr"); if(e2) e2.textContent = error.message||String(error); return; }
    const d = data||{};
    _bk.rows = null; _bk.preview = null; paintBulk();
    gateToast(`✓ ${d.added||0} put on their step now · ${d.invited||0} invited on WhatsApp/email (each got their step's message; they join on their step once profile + Instagram are done)${d.waiting_profile?` · ${d.waiting_profile} on Geek OS, finishing their profile`:""}${d.skipped?` · ${d.skipped} skipped (no contact)`:""}`);
    loadBulkList(); loadBarterProcess(true);
  };
  wireBulkList();
}

/* ================= BARTER PROCESS — one creator at a time, start to finish =================
 * Outreach message → creator registers → screened against the brand's criteria → final list to the brand →
 * brand confirms → contract (ASCI, ad rights, collab rights, product, deliverables) → address → courier sent →
 * courier delivered → video brief → video submitted → changes → client approves → caption + tags → reel → story
 * → analytics. Every step carries its own timestamp. Your workspace sees only its own campaigns.    */
const BARTER_STEPS = [
  ["applied","1. Registered","The creator filled the form / applied"],
  ["eligible","2. Screened","Geek checked them against the brand's criteria"],
  ["sent_to_brand","3. Sent to brand","On the final list the brand signs off"],
  ["brand_confirmed","4. Brand confirmed","The brand picked them"],
  ["contract_sent","5. Contract sent","Goes out automatically on approval — ASCI, ad rights, collab rights, product, deliverables, non-delivery terms"],
  ["contract_signed","6. Contract signed","Signed by the creator in the app"],
  ["address_confirmed","7. Address confirmed","Where the product ships"],
  ["product_sent","8. Courier sent","Courier + tracking added — the creator can track it"],
  ["product_delivered","9. Courier delivered","Product in their hands"],
  ["content_created","10. Video brief sent","Sent automatically on delivery — what to shoot, by when"],
  ["content_submitted","11. Video submitted","Creator sent the cut for review"],
  ["changes_requested","12. Changes asked","Only if something needed fixing"],
  ["content_approved","13. Client approved","Brand signed off on the video"],
  ["published","14. Posted","Reel + story live with caption & tags"],
  ["completed","15. Done","Creator's feedback in · analytics collected"]
];
// stages from the invite path map onto the same board
const BP_ALIAS = { invited:"applied", shortlisted:"applied", accepted:"brand_confirmed" };
// what happens next, in plain words, for whoever is looking at the board
const BP_NEXT = {
  applied:"Screen this creator against the brief.",
  eligible:"Add them to the brand's list.",
  sent_to_brand:"Waiting for the brand to confirm.",
  brand_confirmed:"Contract is being sent automatically…",
  accepted:"Contract is being sent automatically…",
  contract_sent:"Waiting for the creator to sign the contract.",
  contract_signed:"Waiting for the creator to confirm their delivery address.",
  address_confirmed:"Ship the product and add the courier + tracking.",
  product_sent:"In transit — mark delivered when it arrives (the creator can also confirm).",
  content_created:"Video brief sent — waiting for the video (reminders go out daily, twice a day from day 4, block on day 8).",
  content_submitted:"Video is in — approve it or ask for changes.",
  changes_requested:"Waiting for the creator to resubmit.",
  content_approved:"Approved — waiting for the creator to post and add the link.",
  published:"Live — numbers are collected automatically; mark done to ask the creator for feedback.",
  completed:"Done ✓"
};
let _bpCamp = null, _bpData = null, _bpTimer = null, _bpTab = "tracker", _bpOpen = null, _bpAnalytics = null;
function openBarterProcess(campaignId, campaignName, focusParticipation, tab){
  _bpCamp = { id: campaignId, name: campaignName || "this campaign" }; _bpTab = tab || "tracker"; _bpOpen = focusParticipation || null; _bpAnalytics = null;
  _bk = { rows:null, head:null, map:null, preview:null, list:null, src:"", busy:false, note:"" };
  document.getElementById("bpPanel")?.remove();
  const ov = el("div","ac360"); ov.id = "bpPanel";
  ov.innerHTML = `<div class="ac360-box"><div class="ac360-body" id="bpBody">${skel("list",5)}</div></div>`;
  document.body.appendChild(ov); document.body.style.overflow = "hidden";
  const close = ()=>{ clearInterval(_bpTimer); ov.remove(); document.body.style.overflow=""; document.removeEventListener("keydown", k); };
  const k = e=>{ if(e.key==="Escape" && !document.querySelector(".modal-overlay.open")) close(); };
  document.addEventListener("keydown", k); ov.onclick = e=>{ if(e.target===ov) close(); };
  window.__bpClose = close;
  loadBarterProcess();
  clearInterval(_bpTimer);
  _bpTimer = setInterval(()=>{
    if(!document.getElementById("bpPanel")){ clearInterval(_bpTimer); return; }
    if(document.visibilityState!=="visible" || document.querySelector(".modal-overlay.open")) return;
    const a = document.activeElement; if(a && (a.tagName==="INPUT"||a.tagName==="TEXTAREA"||a.tagName==="SELECT")) return;
    if(_bpTab==="terms") return;      // never repaint a form someone is editing
    if(_bpTab==="bulk"){ loadBulkList(); loadBarterProcess(true); return; }   // keep a half-checked upload intact
    loadBarterProcess(true);
  }, 20000);
}
async function loadBarterProcess(silent){
  const body = document.getElementById("bpBody"); if(!body || !_bpCamp) return;
  const [t, o] = await Promise.all([
    sb.schema("api").rpc("barter_tracker", { p_campaign:_bpCamp.id }).then(r=>r, e=>({error:e})),
    sb.schema("api").rpc("get_outreach", { p_campaign:_bpCamp.id }).then(r=>r, ()=>({data:{}}))
  ]);
  if(t.error){ if(!silent) body.innerHTML = `<div class="card"><div class="muted">${esc(t.error.message||t.error)}</div></div>`; return; }
  _bpData = t.data||{}; _bpData.outreach = o.data||{}; pollNavCounts();
  if(_bpTab==="analytics") await loadBpAnalytics(true);
  if(silent && _bpTab==="bulk") return;
  paintBarterProcess();
}
async function loadBpAnalytics(quiet){
  const { data, error } = await sb.schema("api").rpc("campaign_analytics", { p_campaign:_bpCamp.id }).then(r=>r, e=>({error:e}));
  _bpAnalytics = error ? { error: error.message||String(error) } : (data||{});
  if(!quiet) paintBarterProcess();
}
function bpStageIndex(stage){ stage = BP_ALIAS[stage] || stage; const i = BARTER_STEPS.findIndex(s=>s[0]===stage); return i<0 ? 0 : i; }
// a creator whose parcel is delivered sits between "courier sent" and "video brief sent"
function bpEffectiveIndex(x){ const i = bpStageIndex(x.stage); return (x.stage==="product_sent" && x.shipment && x.shipment.status==="delivered") ? bpStageIndex("product_delivered") : i; }
function paintBarterProcess(){
  const body = document.getElementById("bpBody"); if(!body) return;
  const d = _bpData||{}, c = d.campaign||{}, list = d.creators||[];
  const failed = s => ["dropped","rejected","ineligible","brand_declined"].includes(s);
  const done = s => list.filter(x=> !failed(x.stage) && bpEffectiveIndex(x) >= bpStageIndex(s)).length;
  const needsYou = list.filter(x=> ["applied","eligible","sent_to_brand","address_confirmed","product_sent","content_submitted","published"].includes(x.stage)).length;
  const tabs = [["tracker",`👥 Creators (${list.length})`],["bulk","📥 Bulk upload"],["terms","📜 Contract & video brief"],["analytics","📈 Analytics"],["outreach","✉️ Outreach message"],["shortlist","📋 List for the brand"]];
  const pb = d.playbook||{};
  body.innerHTML = `<div class="ac360-head"><div style="flex:1;min-width:0"><h3>Barter process</h3>
      <div class="muted">${esc(c.name||_bpCamp.name)}${c.brand?` · ${esc(c.brand)}`:""}${c.product?` · ${esc(c.product)}`:""} — every creator, every step, live. Contract and video brief go out on their own.</div></div>
      <button class="ci-pop-x" id="bpX" aria-label="Close">✕</button></div>
    ${pb.saved===false?`<div class="ac360-miss">📜 This campaign has no contract terms or video brief saved yet — creators get the defaults (1 month ad rights, collab, 7 days to post, blacklist + re-ship clauses). <a href="#" id="bpGoTerms">Set them now →</a></div>`:""}
    ${needsYou?`<div class="bp-needs">⚡ <b>${needsYou}</b> creator${needsYou>1?"s need":" needs"} something from you — open them below.</div>`:""}
    <div class="bp-flow">${BARTER_STEPS.filter(s=>s[0]!=="changes_requested").map(s=>`<button type="button" class="bp-fstep${_bpStage===s[0]?" on":""}" data-bpstage="${s[0]}" title="Show who reached this step"><b>${done(s[0])}</b><span>${esc(s[1].replace(/^\d+\.\s*/,""))}</span></button>`).join("")}</div>
    <div class="admin-tabs ac360-tabs">${tabs.map(t=>`<button class="${_bpTab===t[0]?"act":""}" data-bptab="${t[0]}">${t[1]}</button>`).join("")}</div>
    <div class="ac360-sec">${_bpTab==="tracker"?bpStageBanner(list)+bpTrackerHtml(bpStageList(list)):_bpTab==="bulk"?bulkHtml():_bpTab==="terms"?bpTermsHtml():_bpTab==="analytics"?bpAnalyticsHtml():_bpTab==="outreach"?bpOutreachHtml():bpShortlistHtml(list)}</div>`;
  body.querySelector("#bpX").onclick = ()=> window.__bpClose && window.__bpClose();
  body.querySelectorAll("[data-bpstage]").forEach(b=> b.onclick = ()=>{ _bpStage = _bpStage===b.dataset.bpstage ? null : b.dataset.bpstage; _bpTab = "tracker"; paintBarterProcess();
    const sec = body.querySelector(".ac360-sec"); if(sec) sec.scrollIntoView({ behavior:"smooth", block:"start" }); });
  const clr = body.querySelector("#bpStageClear"); if(clr) clr.onclick = ()=>{ _bpStage = null; paintBarterProcess(); };
  const goT = body.querySelector("#bpGoTerms"); if(goT) goT.onclick = e=>{ e.preventDefault(); _bpTab="terms"; paintBarterProcess(); };
  body.querySelectorAll("[data-bptab]").forEach(b=> b.onclick = async ()=>{
    _bpTab = b.dataset.bptab;
    if(_bpTab==="analytics"){ _bpAnalytics = null; paintBarterProcess(); await loadBpAnalytics(); return; }
    paintBarterProcess(); });
  wireBarterProcess();
  if(_bpTab==="bulk"){ wireBulk(); if(!_bk.list) loadBulkList(); }
}
// step filter: everyone who reached the clicked step (the ones sitting on it right now first)
let _bpStage = null;
function bpStageList(list){
  if(!_bpStage) return list;
  const fail = s => ["dropped","rejected","ineligible","brand_declined"].includes(s), at = bpStageIndex(_bpStage);
  return list.filter(x=> !fail(x.stage) && bpEffectiveIndex(x) >= at).sort((a,b)=> (bpEffectiveIndex(a)===at?0:1) - (bpEffectiveIndex(b)===at?0:1));
}
// full creator card from the barter process: who they are, every Instagram account, contact, address, this campaign
async function bpCreatorProfile(pid){
  const x = ((_bpData||{}).creators||[]).find(c=> c.participation_id===pid); if(!x) return;
  const cr = x.creator||{}, to = x.ship_to||{}, con = x.contract||{}, ship = x.shipment||{}, idx = bpEffectiveIndex(x);
  let m = document.getElementById("bpProf"); if(m) m.remove();
  m = el("div","modal-overlay"); m.id = "bpProf";
  const row = (k,v)=> v ? `<div class="bpp-row"><span>${esc(k)}</span><div>${v}</div></div>` : "";
  const handle = cr.username || x.applied_profile || "";
  m.innerHTML = `<div class="modal modal-lg"><div class="modal-head"><strong>Creator profile</strong><button class="icon-btn" id="bpProfX">✕</button></div>
    <div class="modal-form bpp">
      <div class="bpp-top">${cr.profile_picture_url?`<img src="${esc(safeUrl(cr.profile_picture_url))}" alt="" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">`:`<span class="avatar">${esc((handle||"?").slice(0,2).toUpperCase())}</span>`}
        <div style="min-width:0;flex:1"><div class="bpp-name">${esc(cr.name||to.name||handle)}</div>
          ${handle?`<a href="https://instagram.com/${encodeURIComponent(handle)}" target="_blank" rel="noopener">@${esc(handle)} ↗</a>`:""}
          <div class="bpp-cats">${(cr.categories||[]).slice(0,4).map(c=>`<span>${esc(c)}</span>`).join("")}${cr.city?`<span>📍 ${esc(cr.city)}</span>`:""}</div></div>
        ${handle?`<a class="btn sm" href="/p.html?u=${encodeURIComponent(handle)}" target="_blank" rel="noopener">Media Kit ↗</a>`:""}</div>
      <div class="bpp-stats"><div><b>${cr.followers!=null?fmtNum(cr.followers):"—"}</b><span>Followers</span></div><div><b>${cr.engagement!=null?cr.engagement+"%":"—"}</b><span>Engagement</span></div>
        <div><b>${cr.avg_reach?fmtNum(Math.round(cr.avg_reach)):"—"}</b><span>Avg reach</span></div><div><b>${esc(((BARTER_STEPS[idx]||[])[1]||"—").replace(/^\d+\.\s*/,""))}</b><span>Step now</span></div>
        ${cr.profile_pct!=null?`<div><b>${cr.profile_pct}%</b><span>Profile</span></div>`:""}</div>
      <div id="bppPro"></div>
      <div class="bpp-sec">Contact</div>
      ${row("WhatsApp", x.phone||to.phone ? esc(x.phone||to.phone) : "")}
      ${row("Applied with", x.applied_profile ? "@"+esc(x.applied_profile) : "")}
      ${row("Applied on", x.applied_at ? esc(fmtDate(x.applied_at)) : "")}
      ${x.has_address||to.city ? `<div class="bpp-sec">Delivery address</div>${row("Address", esc([to.name, to.line1, to.line2, to.landmark, to.city, to.state, to.postal_code].filter(Boolean).join(", ")))}` : ""}
      <div class="bpp-sec">This campaign</div>
      ${row("Contract", con.signed_at ? "✓ signed "+esc(fmtDate(con.signed_at))+(con.signature_name?" by "+esc(con.signature_name):"") : con.issued_at ? "sent "+esc(fmtDate(con.issued_at))+" · not signed yet" : "")}
      ${row("Courier", ship.courier ? esc(ship.courier)+(ship.tracking_ref?" · "+esc(ship.tracking_ref):"")+(ship.delivered_at?" · delivered "+esc(fmtDate(ship.delivered_at)):ship.shipped_at?" · sent "+esc(fmtDate(ship.shipped_at)):"") : "")}
      ${row("Video due", x.due_on ? esc(fmtDate(x.due_on)) : "")}
      ${row("Video", x.submission && x.submission.url ? `<a href="${esc(safeUrl(x.submission.url))}" target="_blank" rel="noopener">open ↗</a>` : "")}
      ${row("Posts", (x.posts||[]).length ? (x.posts||[]).map(p=>`<a href="${esc(safeUrl(p.permalink||p.url||"#"))}" target="_blank" rel="noopener">${esc(p.media_type||"post")} ↗</a>`).join(" · ") : "")}
      ${x.blacklisted?row("Note","⛔ Blacklisted"):""}
      <div class="bpp-sec">All Instagram accounts</div><div id="bppAccts">${skel("list",1)}</div>
      <div class="hub-foot"><button class="btn sm" data-bpphub="${esc(pid)}">💬 Messages & full history</button></div>
    </div></div>`;
  document.body.appendChild(m); m.classList.add("open");
  document.getElementById("bpProfX").onclick = ()=> m.remove(); m.onclick = e=>{ if(e.target.id==="bpProf") m.remove(); };
  const hb = m.querySelector("[data-bpphub]"); if(hb) hb.onclick = ()=>{ m.remove(); openCreatorHub(pid, "whatsapp"); };
  const box = document.getElementById("bppAccts");
  if(!cr.member_id){ box.innerHTML = `<div class="muted">Not on Geek OS yet.</div>`; return; }
  sb.schema("api").rpc("creator_profile_card", { p_member: cr.member_id }).then(({ data:P })=>{
    const pb = document.getElementById("bppPro"); if(!pb || !P) return;
    const AV = { available:"🟢 Available", limited:"🟡 Limited", unavailable:"🔴 Unavailable" };
    const nice = v => String(v||"").replace(/_/g," ").replace(/\b\w/g, c=>c.toUpperCase());
    const list = a => (a||[]).map(nice).join(", ");
    pb.innerHTML = `<div class="bpp-sec">Profile</div>`
      + row("Display name", P.display_name ? esc(P.display_name) : "")
      + row("Availability", P.availability ? esc((AV[P.availability]||P.availability) + (P.availability_limit ? " — "+P.availability_limit : "")) : "")
      + row("Content types", (P.content_formats||[]).length ? esc(list(P.content_formats)) : "")
      + row("Categories", (P.categories||[]).length ? esc(list(P.categories)) : "")
      + row("Location", P.city||P.state ? esc([P.city,P.state].filter(Boolean).join(", ")) : "")
      + row("Travel", P.travel_willingness ? esc(nice(P.travel_willingness)) : "")
      + row("Travelling now", P.travelling ? esc([P.travelling.city,P.travelling.state,P.travelling.country].filter(Boolean).join(", ") + (P.travelling.until ? " · till "+fmtDate(P.travelling.until) : "")) : "")
      + row("Management", P.management ? esc(nice(P.management)) : "")
      + row("Skills", (P.skills||[]).length ? esc(list(P.skills)) : "")
      + row("Equipment", (P.resources||[]).length ? esc(list(P.resources)) : "")
      + row("Campaigns done", P.campaigns_done ? esc(String(P.campaigns_done)) : "")
      + row("On Geek OS since", P.joined_at ? esc(fmtDate(P.joined_at)) : "");
  }, ()=>{});
  const { data, error } = await sb.schema("api").rpc("creator_ig_accounts", { p_member: cr.member_id }).then(r=>r, e=>({error:e}));
  if(!box.isConnected) return;
  const L = (!error && data) || [];
  box.innerHTML = L.length ? `<div class="ig-acct-list">${L.map(a=>`<div class="ig-acct-row">${a.profile_picture_url?`<img src="${esc(safeUrl(a.profile_picture_url))}" alt="" referrerpolicy="no-referrer">`:`<span class="avatar">📸</span>`}
      <div style="min-width:0;flex:1"><a href="https://instagram.com/${encodeURIComponent(a.username||"")}" target="_blank" rel="noopener"><b>@${esc(a.username||"")}</b></a>${a.active?' <span class="tag good">Active</span>':""}${String(a.username||"").toLowerCase()===String(x.applied_profile||"").toLowerCase()?' <span class="tag">On this campaign</span>':""}
        <div class="muted" style="font-size:12.5px">${esc([a.followers!=null?kfmtN(a.followers)+" followers":"", a.posts!=null?a.posts+" posts":""].filter(Boolean).join(" · "))}</div></div></div>`).join("")}</div>`
    : `<div class="muted">${error ? esc(error.message||String(error)) : "No Instagram connected."}</div>`;
}
/* ================= CAMPAIGN A → Z: everyone on one campaign, and each creator's full story ================= */
// step label for any stage (the 15 Barter steps, plus the invite / decline words)
function hubStepLabel(stage){
  const s = BP_ALIAS[stage] || stage;
  const b = BARTER_STEPS.find(x=> x[0]===s);
  if(b) return b[1];
  return ({ ineligible:"Declined", brand_declined:"Declined by brand", dropped:"Dropped", rejected:"Rejected" })[stage] || String(stage||"").replace(/_/g," ");
}
function hubStepIdx(stage){ const s = BP_ALIAS[stage] || stage; const i = BARTER_STEPS.findIndex(x=> x[0]===s); return i < 0 ? 99 : i; }
const HUB_DECL = ["ineligible","brand_declined","dropped","rejected"];
let _hub = { camp:null, data:null, tab:"in", q:"", step:"" };
async function loadCampaignPeople(c){
  const box = document.getElementById("wsPeople"); if(!box) return;
  _hub.camp = c;
  const { data, error } = await sb.schema("api").rpc("campaign_people", { p_campaign: c.id }).then(r=>r, e=>({error:e}));
  if(!box.isConnected) return;
  if(error){ box.innerHTML = `<div class="muted">${esc(error.message||String(error))}${/campaign_people/.test(error.message||"")?" — run <code>supabase db push</code> first.":""}</div>`; return; }
  _hub.data = data || { participants:[], invites:[] };
  paintCampaignPeople();
}
function paintCampaignPeople(){
  const box = document.getElementById("wsPeople"); if(!box || !_hub.data) return;
  const P = _hub.data.participants||[], I = _hub.data.invites||[];
  const q = _hub.q.toLowerCase();
  const match = (...v)=> !q || v.some(x=> String(x||"").toLowerCase().includes(q));
  const steps = [...new Set(P.map(p=> p.stage))].sort((a,b)=> hubStepIdx(a)-hubStepIdx(b));
  let rows = "";
  if(_hub.tab==="in"){
    const L = P.filter(p=> (!_hub.step || p.stage===_hub.step) && match(p.creator&&p.creator.username, p.creator&&p.creator.name, p.applied_profile, p.phone, p.creator&&p.creator.city))
               .sort((a,b)=> hubStepIdx(a.stage)-hubStepIdx(b.stage));
    rows = L.length ? L.map(p=>{ const cr = p.creator||{}, h = p.applied_profile || cr.username || "";
        const wa = p.last_wa ? `<span class="hub-wa ${p.last_wa.status==="sent"?"ok":p.last_wa.status==="failed"?"bad":""}" title="${esc(p.last_wa.error||"")}">💬 ${esc(String(p.last_wa.key||"message").replace(/_/g," "))} · ${p.last_wa.status==="sent"?"sent":p.last_wa.status==="failed"?"failed":"queued"} ${esc(fmtDate(p.last_wa.at))}</span>` : "";
        return `<button class="hub-row" data-hubp="${esc(p.participation_id)}">
          ${cr.profile_picture_url?`<img src="${esc(safeUrl(cr.profile_picture_url))}" alt="" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">`:`<span class="avatar">${esc((h||"?").slice(0,2).toUpperCase())}</span>`}
          <span class="hub-who"><b>${h?"@"+esc(h):esc(cr.name||"Creator")}</b><span class="muted">${esc([cr.followers!=null?fmtNum(cr.followers)+" followers":"", cr.city, p.phone].filter(Boolean).join(" · "))}</span>${wa}</span>
          <span class="hub-meta"><span class="tag ${HUB_DECL.includes(p.stage)?"":"good"}">${esc(hubStepLabel(p.stage))}</span>
            ${p.profile_pct!=null?`<span class="hub-pct" title="Creator profile (optional)">📝 ${p.profile_pct}%</span>`:""}
            ${(p.needs||[]).length?`<span class="hub-need" title="${esc(p.needs.join(", "))}">⚠️ ${esc(p.needs.map(x=>/whatsapp/i.test(x)?"no WhatsApp":"no Instagram").join(" · "))}</span>`:""}</span>
          <span class="hub-go">›</span></button>`; }).join("")
      : `<div class="muted" style="padding:10px">${P.length ? "Nobody matches." : "No creators on this campaign yet — invite or bulk upload them."}</div>`;
  } else {
    const L = I.filter(i=> match(i.name, i.handle, i.phone, i.email, i.city));
    rows = L.length ? L.map(i=> `<div class="hub-row is-inv">
          <span class="avatar">${esc(((i.handle||i.name||"?")).slice(0,2).toUpperCase())}</span>
          <span class="hub-who"><b>${i.handle?"@"+esc(i.handle):esc(i.name||i.phone||i.email||"Invite")}</b><span class="muted">${esc([i.name&&i.handle?i.name:"", i.phone, i.email, i.city].filter(Boolean).join(" · "))}</span>
            ${i.last_wa?`<span class="hub-wa ${i.last_wa.status==="sent"?"ok":i.last_wa.status==="failed"?"bad":""}" title="${esc(i.last_wa.error||"")}">💬 invite ${i.last_wa.status==="sent"?"sent":i.last_wa.status==="failed"?"failed":"queued"} ${esc(fmtDate(i.last_wa.at))}${i.invites_sent>1?` · ${i.invites_sent}×`:""}</span>`:""}</span>
          <span class="hub-meta"><span class="tag warn">${esc(bkStLabel ? bkStLabel(i.status) : i.status)}</span>
            <span class="tag">${i.registered ? ((i.needs||[]).length ? "Registered · "+esc(i.needs.map(x=>/whatsapp/i.test(x)?"connect WhatsApp":"connect Instagram").join(" + ")) : "Registered · joining") : "Not registered yet"}</span>
            ${i.profile_pct!=null?`<span class="hub-pct">📝 ${i.profile_pct}%</span>`:""}</span>
          <span class="hub-acts"><label class="bk-chg" title="Put them on this step now">${bkStatusSelect(`data-hubset="${esc(i.invite_id)}"`, i.status==="invited"?"registered":i.status, "")}</label>
            <button class="mini-btn ghost" data-hubre="${esc(i.invite_id)}">Resend</button></span></div>`).join("")
      : `<div class="muted" style="padding:10px">${I.length ? "Nobody matches." : "Everyone invited has joined."}</div>`;
  }
  box.innerHTML = `<div class="hub-bar">
      <div class="hub-tabs"><button class="${_hub.tab==="in"?"act":""}" data-hubtab="in">In the campaign <b>${P.length}</b></button><button class="${_hub.tab==="inv"?"act":""}" data-hubtab="inv">Invited · not joined <b>${I.length}</b></button></div>
      <input id="hubQ" type="search" placeholder="🔎 Name, @handle, phone, city…" value="${esc(_hub.q)}">
      ${_hub.tab==="in"?`<select id="hubStep"><option value="">Every step</option>${steps.map(s=>`<option value="${esc(s)}"${_hub.step===s?" selected":""}>${esc(hubStepLabel(s))} (${P.filter(p=>p.stage===s).length})</option>`).join("")}</select>`:""}
    </div><div class="hub-list">${rows}</div>`;
  box.querySelectorAll("[data-hubtab]").forEach(b=> b.onclick = ()=>{ _hub.tab = b.dataset.hubtab; paintCampaignPeople(); });
  const qi = box.querySelector("#hubQ"); if(qi) qi.oninput = ()=>{ _hub.q = qi.value; const pos = qi.selectionStart; paintCampaignPeople(); const n = document.getElementById("hubQ"); if(n){ n.focus(); try{ n.setSelectionRange(pos,pos); }catch(e){} } };
  const st = box.querySelector("#hubStep"); if(st) st.onchange = ()=>{ _hub.step = st.value; paintCampaignPeople(); };
  box.querySelectorAll("[data-hubp]").forEach(b=> b.onclick = ()=> openCreatorHub(b.dataset.hubp));
  box.querySelectorAll("[data-hubset]").forEach(sel=> sel.onchange = async ()=>{ sel.disabled = true;
    const { data, error } = await sb.schema("api").rpc("bulk_set_status", { p_invite: sel.dataset.hubset, p_status: sel.value }).then(r=>r, e=>({error:e}));
    if(error) gateToast(error.message||String(error));
    else gateToast(`Status → ${bkStLabel(sel.value)} ✓${data && data.stage ? " · on the campaign now: "+hubStepLabel(data.stage) : " · their step's message is sent"}`);
    loadCampaignPeople(_hub.camp); });
  box.querySelectorAll("[data-hubre]").forEach(b=> b.onclick = async ()=>{ b.disabled = true;
    const { data, error } = await sb.schema("api").rpc("bulk_resend_invite", { p_invite: b.dataset.hubre }).then(r=>r, e=>({error:e}));
    gateToast(error ? (error.message||String(error)) : data && data.status==="joined" ? "They're on Geek OS — added to the campaign ✓" : "Invite sent again ✓");
    loadCampaignPeople(_hub.camp); });
}

// one creator on one campaign: profile %, contact, every step, every message (and send the next one)
let _hubC = { pid:null, data:null, tab:"overview" };
async function openCreatorHub(pid, tab){
  _hubC = { pid, data:null, tab: tab || "overview" };
  let m = document.getElementById("hubModal"); if(m) m.remove();
  m = el("div","modal-overlay open"); m.id = "hubModal";
  m.innerHTML = `<div class="modal modal-lg hub-modal"><div class="modal-head"><strong>Creator on this campaign</strong><button class="icon-btn" id="hubX" aria-label="Close">✕</button></div>
    <div class="modal-form" id="hubBody">${skel("list",4)}</div></div>`;
  document.body.appendChild(m);
  const close = ()=> m.remove();
  document.getElementById("hubX").onclick = close; m.onclick = e=>{ if(e.target.id==="hubModal") close(); };
  await hubReload();
}
async function hubReload(){
  const { data, error } = await sb.schema("api").rpc("campaign_creator_hub", { p_participation: _hubC.pid }).then(r=>r, e=>({error:e}));
  const body = document.getElementById("hubBody"); if(!body) return;
  if(error){ body.innerHTML = `<div class="ci-err-inline">${esc(error.message||String(error))}</div>`; return; }
  _hubC.data = data; paintCreatorHub();
}
function paintCreatorHub(){
  const body = document.getElementById("hubBody"); const d = _hubC.data; if(!body || !d) return;
  const cr = d.creator||{}, h = d.applied_profile || cr.username || "", pr = d.profile, pct = pr && pr.pct!=null ? pr.pct : null;
  const WA = (d.messages||[]).filter(x=> x.channel==="whatsapp"), OTH = (d.messages||[]).filter(x=> x.channel!=="whatsapp");
  if(_hubC.tab==="messages") _hubC.tab = "whatsapp";
  const tabs = [["overview","Overview"],["timeline",`What they did (${(d.timeline||[]).length})`],["whatsapp",`💬 WhatsApp (${WA.length})`],["other",`✉️ Email & app (${OTH.length + (d.alerts||[]).length})`]];
  let sec = "";
  if(_hubC.tab==="overview"){
    const row = (k,v)=> v ? `<div class="bpp-row"><span>${esc(k)}</span><div>${v}</div></div>` : "";
    sec = `<div class="hub-steps">${BARTER_STEPS.filter(s=> s[0]!=="changes_requested").map((s,i)=>{ const cur = hubStepIdx(d.stage), me = hubStepIdx(s[0]);
          return `<span class="${me<cur?"done":me===cur?"now":""}" title="${esc(s[2])}">${me<cur?"✓":me===cur?"●":"○"} ${esc(s[1].replace(/^\d+\.\s*/,""))}</span>`; }).join("")}</div>
      ${(d.needs||[]).length?`<div class="hub-warn">⚠️ Still to connect: ${esc(d.needs.join(" + "))}</div>`:""}
      <div class="bpp-sec">Contact</div>
      ${row("WhatsApp", d.phone ? esc(d.phone) + (d.wa_linked ? ' <span class="tag good">linked</span>' : ' <span class="tag warn">not linked</span>') + (d.wa_opted_out ? ' <span class="tag">updates paused</span>' : "") : "—")}
      ${row("Applied with", h ? `<a href="https://instagram.com/${encodeURIComponent(h)}" target="_blank" rel="noopener">@${esc(h)} ↗</a>` : "")}
      ${row("On the campaign since", d.applied_at ? esc(fmtDate(d.applied_at)) : "")}
      ${d.reason ? row("Note", esc(d.reason)) : ""}
      <div class="bpp-sec">Profile ${pct!=null?`· ${pct}% complete`:""} <span class="muted" style="font-weight:400">(optional for the creator)</span></div>
      ${pr ? `<div class="cp-bar" style="margin:4px 0 8px"><span style="width:${pct||0}%"></span></div>${(pr.missing||[]).length?`<div class="muted" style="font-size:12.5px">Not filled yet: ${esc(pr.missing.join(", "))}</div>`:`<div class="muted" style="font-size:12.5px">Everything filled in ✓</div>`}` : `<div class="muted">No profile yet.</div>`}
      <div id="hubPro"></div>
      <div class="hub-foot"><button class="btn ghost sm" data-hubbp>🔁 Open in Barter process</button>${h?`<a class="btn ghost sm" href="/p.html?u=${encodeURIComponent(h)}" target="_blank" rel="noopener">Media Kit ↗</a>`:""}<button class="btn sm" data-hubtab2="whatsapp">💬 WhatsApp chat</button></div>`;
  } else if(_hubC.tab==="timeline"){
    const T = d.timeline||[], A = d.alerts||[];
    const nice = x=> String(x||"").replace(/_/g," ");
    sec = T.length ? `<div class="hub-tl">${T.map(e=>`<div class="hub-tl-it"><span class="hub-tl-dot ${e.by_creator?"me":""}"></span><div>
          <b>${esc(e.entity==="participation" ? hubStepLabel(e.to) : nice(e.entity)+" · "+nice(e.to))}</b>
          <div class="muted">${esc(fmtDateTime(e.at))}${e.by?` · by ${esc(e.by)}${e.by_creator?" (creator)":""}`:" · automatic"}${e.reason?` · ${esc(e.reason)}`:""}</div></div></div>`).join("")}</div>`
      : `<div class="muted">Nothing recorded yet.</div>`;
    if(A.length) sec += `<div class="bpp-sec">Alerts the creator got in the app</div><div class="hub-tl">${A.slice(0,30).map(n=>`<div class="hub-tl-it"><span class="hub-tl-dot ${n.read?"me":""}"></span><div><b>${esc(n.title)}</b><div class="muted">${esc(fmtDateTime(n.at))} · ${n.read?"read":"not read yet"}</div></div></div>`).join("")}</div>`;
  } else if(_hubC.tab==="whatsapp"){
    const M = WA.slice().reverse(), tick = x=> x.status==="failed" ? `<span class="wa-fail" title="${esc(x.error||"")}">❗ not delivered</span>` : x.status==="queued" ? "🕓" : x.status==="skipped" ? "⏸" : x.status==="read" ? `<span class="wa-read">✓✓</span>` : x.status==="delivered" ? "✓✓" : "✓";
    let day = "";
    const bubbles = M.map(x=>{
      const dd = new Date(x.at).toDateString(), sep = dd!==day ? `<div class="wa-day"><span>${esc(fmtDate(x.at))}</span></div>` : ""; day = dd;
      const long = String(x.text||"").length > 260 || (String(x.text||"").match(/\n/g)||[]).length > 5;
      return sep + `<div class="wa-msg ${x.dir==="in"?"in":"out"}${x.auto?" tpl":""}"><div class="wa-bub">
          ${x.auto?`<span class="wa-tag">🤖 ${esc(String(x.key||"update").replace(/_/g," "))}</span>`:x.dir==="out"&&x.by?`<span class="wa-tag">${esc(x.by)}</span>`:""}
          <div class="wa-txt${long?" clamp":""}">${esc(x.text||"").replace(/\n/g,"<br>")}</div>${long?`<button class="wa-more" type="button">Read more</button>`:""}
          <span class="wa-time">${esc(new Date(x.at).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"}))} ${x.dir==="out"?tick(x):""}</span></div></div>`; }).join("");
    const digits = String(d.phone||"").replace(/\D/g,"");
    sec = `<div class="wa-box">
        <div class="wa-head">${cr.profile_picture_url?`<img src="${esc(safeUrl(cr.profile_picture_url))}" alt="" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">`:`<span class="avatar">${esc((h||"?").slice(0,2).toUpperCase())}</span>`}
          <div class="wa-head-id"><b>${esc(d.name||cr.name||h||"Creator")}</b><span>${d.phone?esc(d.phone):"no WhatsApp number"}${d.session_open?" · chat open":""}</span></div>
          ${digits?`<a class="wa-open" href="https://wa.me/${digits}" target="_blank" rel="noopener" title="Open this chat in WhatsApp">Open in WhatsApp ↗</a>`:""}</div>
        <div class="wa-chat" id="hubChat">${bubbles || `<div class="wa-empty">No WhatsApp messages with this creator yet.</div>`}</div>
        <div class="wa-tplrow"><select id="hubStepKey"><option value="">📨 Send a step template…</option>${(d.step_messages||[]).map(s2=>`<option value="${esc(s2.key)}">${esc(s2.title||s2.key)}</option>`).join("")}</select><button class="wa-tplgo" id="hubStepGo" type="button">Send</button></div>
        <div class="wa-compose"><textarea id="hubText" rows="1" placeholder="${d.phone?(d.session_open?"Type a message":"Type a message (works within 24 h of their last reply)"):"No WhatsApp number for this creator"}"${d.phone?"":" disabled"}></textarea>
          <button class="wa-send" id="hubTextGo" type="button" aria-label="Send"${d.phone?"":" disabled"}>➤</button></div>
        <div class="wa-note">${d.session_open ? "✅ They replied in the last 24 h — your message goes straight to their WhatsApp." : "WhatsApp lets you type freely only within 24 h of the creator's last message. Otherwise send a step template, or tap “Open in WhatsApp”."}</div>
      </div>`;
  } else {
    const M = OTH, A = d.alerts||[];
    sec = (M.length ? `<div class="bpp-sec">Emails & automatic messages</div><div class="hub-tl">${M.map(x=>`<div class="hub-tl-it"><span class="hub-tl-dot"></span><div>
          <b>${x.channel==="email"?"✉️ Email":"📨 "+esc(x.channel)} · ${esc(String(x.key||"").replace(/_/g," "))}</b>
          <div class="muted">${esc(fmtDateTime(x.at))} · ${x.status==="failed"?"❌ failed":x.status==="queued"?"⏳ queued":"✓ "+esc(x.status||"sent")}${x.error?` · ${esc(String(x.error).slice(0,90))}`:""}</div>
          ${x.text?`<div class="hub-otxt">${esc(String(x.text).slice(0,300))}</div>`:""}</div></div>`).join("")}</div>` : "")
      + (A.length ? `<div class="bpp-sec">Alerts in the app</div><div class="hub-tl">${A.slice(0,40).map(n=>`<div class="hub-tl-it"><span class="hub-tl-dot ${n.read?"me":""}"></span><div><b>${esc(n.title)}</b><div class="muted">${esc(fmtDateTime(n.at))} · ${n.read?"read":"not read yet"}</div></div></div>`).join("")}</div>` : "")
      || `<div class="muted">No emails or app alerts yet.</div>`;
  }
  body.innerHTML = `<div class="bpp-top">${cr.profile_picture_url?`<img src="${esc(safeUrl(cr.profile_picture_url))}" alt="" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">`:`<span class="avatar">${esc((h||"?").slice(0,2).toUpperCase())}</span>`}
      <div style="min-width:0;flex:1"><div class="bpp-name">${esc(d.name||cr.name||h||"Creator")}</div>
        ${h?`<a href="https://instagram.com/${encodeURIComponent(h)}" target="_blank" rel="noopener">@${esc(h)} ↗</a>`:""}
        <div class="bpp-cats"><span class="hub-now">${esc(hubStepLabel(d.stage))}</span>${(cr.categories||[]).slice(0,3).map(c=>`<span>${esc(c)}</span>`).join("")}${cr.city?`<span>📍 ${esc(cr.city)}</span>`:""}</div></div>
      ${pct!=null?`<div class="prof-pop-ring hub-ring" style="--p:${pct}" title="Profile complete"><span>${pct}%</span></div>`:""}</div>
    <div class="bpp-stats"><div><b>${cr.followers!=null?fmtNum(cr.followers):"—"}</b><span>Followers</span></div><div><b>${cr.engagement!=null?cr.engagement+"%":"—"}</b><span>Engagement</span></div>
      <div><b>${cr.avg_reach?fmtNum(Math.round(cr.avg_reach)):"—"}</b><span>Avg reach</span></div><div><b>${(d.messages||[]).length}</b><span>Messages</span></div></div>
    <div class="admin-tabs hub-ctabs">${tabs.map(t=>`<button class="${_hubC.tab===t[0]?"act":""}" data-hubtab2="${t[0]}">${esc(t[1])}</button>`).join("")}</div>
    <div class="hub-sec">${sec}</div>`;
  body.querySelectorAll("[data-hubtab2]").forEach(b=> b.onclick = ()=>{ _hubC.tab = b.dataset.hubtab2; paintCreatorHub(); });
  const bp = body.querySelector("[data-hubbp]"); if(bp) bp.onclick = ()=>{ document.getElementById("hubModal")?.remove(); const c = _hub.camp || {}; openBarterProcess(c.id || d.campaign_id, c.name || d.campaign, d.participation_id); };
  if(_hubC.tab==="overview" && d.member_id){
    sb.schema("api").rpc("creator_profile_card", { p_member: d.member_id }).then(({ data:P })=>{
      const pb = document.getElementById("hubPro"); if(!pb || !P) return;
      const nice = v => String(v||"").replace(/_/g," ").replace(/\b\w/g, c=>c.toUpperCase());
      const list = a => (a||[]).map(nice).join(", ");
      const row = (k,v)=> v ? `<div class="bpp-row"><span>${esc(k)}</span><div>${esc(v)}</div></div>` : "";
      const AV = { available:"🟢 Available", limited:"🟡 Limited", unavailable:"🔴 Unavailable" };
      pb.innerHTML = row("Display name", P.display_name) + row("Availability", P.availability ? (AV[P.availability]||P.availability) + (P.availability_limit?" — "+P.availability_limit:"") : "")
        + row("Content types", list(P.content_formats)) + row("Categories", list(P.categories)) + row("Location", [P.city,P.state].filter(Boolean).join(", "))
        + row("Travel", P.travel_willingness ? nice(P.travel_willingness) : "") + row("Management", P.management ? nice(P.management) : "")
        + row("Skills", list(P.skills)) + row("Equipment", list(P.resources)) + row("Campaigns done", P.campaigns_done ? String(P.campaigns_done) : "")
        + row("On Geek OS since", P.joined_at ? fmtDate(P.joined_at) : "");
    }, ()=>{});
  }
  if(_hubC.tab==="whatsapp"){
    const ch = document.getElementById("hubChat"); if(ch) ch.scrollTop = ch.scrollHeight;
    body.querySelectorAll(".wa-more").forEach(b=> b.onclick = ()=>{ const t = b.previousElementSibling; t.classList.toggle("clamp"); b.textContent = t.classList.contains("clamp") ? "Read more" : "Show less"; });
    const ta = document.getElementById("hubText");
    if(ta){ ta.oninput = ()=>{ ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 120) + "px"; };
      ta.onkeydown = e=>{ if(e.key==="Enter" && !e.shiftKey){ e.preventDefault(); document.getElementById("hubTextGo").click(); } }; }
    // new replies show up on their own while the chat is open
    clearInterval(_hubC.timer);
    _hubC.timer = setInterval(async ()=>{
      if(!document.getElementById("hubChat") || _hubC.tab!=="whatsapp"){ clearInterval(_hubC.timer); return; }
      if(document.activeElement && document.activeElement.id==="hubText" && document.activeElement.value) return;
      const { data:nd } = await sb.schema("api").rpc("campaign_creator_hub", { p_participation: _hubC.pid }).then(r=>r, ()=>({data:null}));
      if(nd && JSON.stringify(nd.messages) !== JSON.stringify(_hubC.data.messages)){ _hubC.data = nd; paintCreatorHub(); }
    }, 12000);
    const go = document.getElementById("hubStepGo");
    if(go) go.onclick = async ()=>{ const k = document.getElementById("hubStepKey").value; if(!k){ gateToast("Pick a step message first."); return; }
      go.disabled = true; go.textContent = "Sending…";
      const { error } = await sb.schema("api").rpc("team_send_step", { p_participation: d.participation_id, p_key: k }).then(r=>r, e=>({error:e}));
      go.disabled = false; go.textContent = "Send";
      if(error){ gateToast(error.message||String(error)); return; }
      gateToast("Step message sent ✓ — WhatsApp, app and email"); setTimeout(hubReload, 1200); };
    const tg = document.getElementById("hubTextGo");
    if(tg) tg.onclick = async ()=>{ const t = document.getElementById("hubText").value.trim(); if(!t){ gateToast("Type a message first."); return; }
      tg.disabled = true; tg.textContent = "Sending…";
      const { data:r, error } = await sb.functions.invoke("wa-send", { body:{ to_phone: d.phone, text: t, subject: d.campaign || null } }).then(x=>x, e=>({error:e}));
      tg.disabled = false; tg.textContent = "Send";
      const msg = (r && r.error) || (error && (typeof fnError==="function" ? await fnError(error) : error.message));
      if(msg){ gateToast(/24-hour|template/i.test(msg) ? "Outside WhatsApp's 24-hour window — send a step message instead (pre-approved template)." : msg); return; }
      document.getElementById("hubText").value = ""; gateToast("WhatsApp message sent ✓"); hubReload(); };
  }
}

function bpStageBanner(list){
  if(!_bpStage) return "";
  const at = bpStageIndex(_bpStage), L = bpStageList(list), here = L.filter(x=> bpEffectiveIndex(x)===at).length;
  const lbl = ((BARTER_STEPS.find(s=>s[0]===_bpStage)||[])[1]||"").replace(/^\d+\.\s*/,"");
  return `<div class="bp-stage-ban"><span>Showing <b>${L.length}</b> who reached <b>${esc(lbl)}</b> · <b>${here}</b> on this step right now</span><button class="mini-btn ghost" id="bpStageClear">Show everyone ✕</button></div>`;
}
function bpMetricLine(st){
  st = st||{}; const K = [["views","views"],["reach","reach"],["likes","likes"],["comments","comments"],["shares","shares"],["saves","saves"]];
  const parts = K.filter(k=> st[k[0]]!=null).map(k=>`${esc(k[1])} <b>${fmtNum(st[k[0]])}</b>`);
  return parts.length ? parts.join(" · ") + (st.source==="public" ? ' <span class="muted">(public counts — full insights load once Instagram shares them)</span>' : "") : '<span class="muted">numbers load within a few hours of posting</span>';
}
function bpTrackerHtml(list){
  if(!list.length) return `<div class="card"><div class="muted">Nobody in this campaign yet. Send the outreach message, or invite creators from the campaign's 🎯 Invite panel.</div></div>`;
  const fail = s => ["dropped","rejected","ineligible","brand_declined"].includes(s);
  const today = new Date().toISOString().slice(0,10);
  return list.map(x=>{
    const cr = x.creator||{}, idx = bpEffectiveIndex(x), st = x.steps||{}, ship = x.shipment||{}, con = x.contract||{};
    const sub = x.submission, rev = x.review, posts = x.posts||[], to = x.ship_to;
    const open = _bpOpen === x.participation_id;
    const pct = fail(x.stage) ? 0 : Math.round(100*(idx+1)/BARTER_STEPS.length);
    const overdue = x.due_on && x.due_on < today && ["content_created","changes_requested"].includes(x.stage);
    const label = fail(x.stage) ? `<b>${esc(String(x.stage).replace(/_/g," "))}</b>${x.reason?` — ${esc(x.reason)}`:""}`
                : esc((BARTER_STEPS[idx]||["","—"])[1]) + (BP_NEXT[x.stage] ? ` · <span class="bp-next">${esc(BP_NEXT[x.stage])}</span>` : "");
    const P = x.participation_id;
    return `<div class="card bp-card${open?" open":""}">
      <div class="bp-head" data-bpopen="${esc(P)}">
        <span class="bp-who" data-bpprof="${esc(P)}" title="Open the creator's full profile">${cr.profile_picture_url?`<img class="ap-pic" src="${esc(safeUrl(cr.profile_picture_url))}" alt="" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">`:`<span class="avatar">${esc((cr.username||"?").slice(0,2).toUpperCase())}</span>`}</span>
        <div style="flex:1;min-width:0">
          <div class="r-title"><span class="bp-who-n" data-bpprof="${esc(P)}" title="Open the creator's full profile">${cr.username?`@${esc(cr.username)}`:esc(cr.name||"Creator")}</span> <button type="button" class="bp-prof-btn" data-bpprof="${esc(P)}">👤 Profile</button>
            ${x.applied_profile && x.applied_profile!==cr.username?`<span class="tag">via @${esc(x.applied_profile)}</span>`:""}
            ${x.blacklisted?'<span class="tag" style="background:rgba(239,68,68,.12);color:#dc2626">⛔ Blacklisted</span>':""}
            ${overdue?'<span class="tag" style="background:rgba(239,68,68,.12);color:#dc2626">⏰ Video overdue</span>':""}
            ${x.blocked_at?`<span class="tag" style="background:rgba(239,68,68,.15);color:#dc2626">⛔ Blocked — call ${esc(x.phone||"them")}</span>`:""}
            ${x.stage==="published"&&x.feedback_requested_at?'<span class="tag warn">Waiting for creator feedback</span>':""}</div>
          <div class="r-sub">${cr.followers!=null?fmtNum(cr.followers)+" followers · ":""}${label}</div>
          <div class="bp-bar"><span style="width:${pct}%${fail(x.stage)?";background:#dc2626":""}"></span></div></div>
        <span class="bp-caret">${open?"▲":"▼"}</span></div>
      ${open?`<div class="bp-detail">
        <ol class="bp-steps">${BARTER_STEPS.map((s,i)=>{
          const at = st[s[0]] || (s[0]==="applied" ? x.applied_at : null)
                  || (s[0]==="product_sent" ? ship.shipped_at : null) || (s[0]==="product_delivered" ? ship.delivered_at : null)
                  || (s[0]==="contract_sent" ? con.issued_at : null) || (s[0]==="contract_signed" ? con.signed_at : null)
                  || (s[0]==="brand_confirmed" ? st.accepted : null);
          const reached = !!at || (!fail(x.stage) && i <= idx);
          const here = !fail(x.stage) && i === idx && x.stage!=="completed";
          if(s[0]==="changes_requested" && !at) return "";
          return `<li class="${reached?"on":""}${here?" here":""}"><div><b>${esc(s[1])}${here?' <em class="bp-here">← now</em>':""}</b><span>${esc(s[2])}</span></div>
            <span class="bp-at">${at?esc(fmtDateTime(at)):reached?"✓":"—"}</span></li>`; }).join("")}</ol>
        <div class="bp-facts">
          ${con.issued_at?`<div>📜 Contract ${con.signed_at?`<b>signed</b> by ${esc(con.signature_name||"the creator")} on ${esc(fmtDate(con.signed_at))}`:`sent ${esc(fmtDate(con.issued_at))} — <b>not signed yet</b>`}
             · ${esc(con.product||"product")} · ${(con.deliverables||[]).map(d=>`${esc(d.quantity||1)}× ${esc(d.format||"content")}`).join(" + ")||"—"}
             · ${esc(con.content_days||7)} days to post · ad rights ${esc(con.ad_rights_months??1)} mo · collab ${con.collab_rights?"✓":"✕"}
             ${(con.clauses||[]).some(c=>c.key==="non_delivery")?" · ⛔ blacklist clause":""}${(con.clauses||[]).some(c=>c.key==="reship")?" · ↪ re-ship clause":""}
             <a href="#" data-bpclauses="${esc(P)}">read the contract</a></div>`:""}
          ${to?`<div>📍 Ship to: <b>${esc(to.name||"")}</b>, ${[to.line1,to.line2,to.landmark,to.city,to.state,to.postal_code].filter(Boolean).map(esc).join(", ")}${to.phone?` · 📞 ${esc(to.phone)}`:""}</div>`:""}
          ${ship.status?`<div>🚚 ${esc({pending:"Waiting for courier",shipped:"In transit",delivered:"Delivered",failed:"Delivery failed"}[ship.status]||ship.status)}${ship.courier?` · ${esc(ship.courier)}`:""}${ship.tracking_ref?` · <b>${esc(ship.tracking_ref)}</b>`:""}${ship.tracking_url?` · <a href="${esc(safeUrl(ship.tracking_url))}" target="_blank" rel="noopener">track ↗</a>`:""}${ship.delivered_at?` · delivered ${esc(fmtDate(ship.delivered_at))}`:ship.shipped_at?` · sent ${esc(fmtDate(ship.shipped_at))}`:""}</div>`:""}
          ${x.blocked_at?`<div class="bp-block">⛔ <b>Blocked ${esc(fmtDateTime(x.blocked_at))}</b> — ${esc(x.block_reason||"no video 7 days after delivery")}.
              Call <a href="tel:${esc(x.phone||"")}"><b>${esc(x.phone||"— no number")}</b></a>, ask why, note it and unblock with a new due date.</div>`:""}
          ${x.call_note?`<div>📞 Last call ${esc(fmtDateTime(x.call_at))}: “${esc(x.call_note)}”</div>`:""}
          ${["content_created","changes_requested"].includes(x.stage)&&!x.blocked_at?`<div>🔔 Reminders sent: <b>${esc(x.reminders_sent||0)}</b>${x.next_reminder?` · next ${esc(fmtDateTime(x.next_reminder))}`:""}${x.phone?` · 📞 <a href="tel:${esc(x.phone)}">${esc(x.phone)}</a>`:""}</div>`:""}
          ${x.feedback?`<div>⭐ Creator feedback: <b>${"★".repeat(+x.feedback.rating||0)}</b>${x.feedback.comment?` — “${esc(x.feedback.comment)}”`:""}</div>`:""}
          ${x.due_on && !["published","completed"].includes(x.stage)?`<div>⏳ Video due <b>${esc(fmtDate(x.due_on))}</b>${overdue?' — <b style="color:#dc2626">overdue</b> (contract: blacklist + re-ship at their cost)':""}</div>`:""}
          ${sub?`<div>🎬 Video${sub.rounds>1?` (round ${esc(sub.rounds)})`:""}: <a href="${esc(safeUrl(sub.url))}" target="_blank" rel="noopener">open the cut ↗</a> · ${esc(fmtDateTime(sub.submitted_at))}${sub.note?` · “${esc(sub.note)}”`:""}</div>`:""}
          ${rev?`<div>${rev.decision==="approved"?"✅ Approved":"✏️ Changes asked"} ${esc(fmtDateTime(rev.at))}${rev.reason?` — “${esc(rev.reason)}”`:""}</div>`:""}
          ${posts.map(p=>`<div>📲 ${esc(p.media_type)} posted ${esc(fmtDate(p.posted_at))}${p.permalink?` · <a href="${esc(safeUrl(p.permalink))}" target="_blank" rel="noopener">open ↗</a>`:""}<div class="bp-metrics">${bpMetricLine(p.stats)}</div></div>`).join("")}
        </div>
        <div class="bp-acts">
          ${x.stage==="applied"?`<button class="btn sm" data-bpscreen="${esc(P)}">✓ Meets the brief</button><button class="btn sm ghost" data-bpreject="${esc(P)}">Not a fit</button>`:""}
          ${x.stage==="eligible"?`<button class="btn sm" data-bpsend="${esc(P)}">📋 Add to the brand's list</button>`:""}
          ${x.stage==="sent_to_brand"?`<button class="btn sm" data-bpbrand="${esc(P)}">✅ Brand confirmed</button><button class="btn sm ghost" data-bpbrandno="${esc(P)}">Brand passed</button>`:""}
          ${["brand_confirmed","accepted"].includes(x.stage)?`<button class="btn sm" data-bpcontract="${esc(P)}">📜 Send contract now</button>`:""}
          ${x.stage==="contract_sent"?`<button class="btn sm ghost" data-bpcontract="${esc(P)}">🔁 Resend contract (latest terms)</button>`:""}
          ${["address_confirmed","accepted"].includes(x.stage)?`<button class="btn sm" data-bpship="${esc(P)}">🚚 Add courier &amp; tracking</button>`:""}
          ${["product_sent","content_created"].includes(x.stage)&&ship.status!=="delivered"?`<button class="btn sm ghost" data-bpship="${esc(P)}">✎ Edit courier</button>`:""}
          ${x.stage==="product_sent"&&ship.status==="shipped"?`<button class="btn sm" data-bpdeliv="${esc(P)}">📦 Mark delivered → send video brief</button>`:""}
          ${x.blocked_at?`${x.phone?`<a class="btn sm ghost" href="tel:${esc(x.phone)}">📞 Call</a>`:""}<button class="btn sm" data-bpunblock="${esc(P)}">✅ Called — unblock</button><button class="btn sm ghost" data-bpcall="${esc(P)}">📝 Note a call</button>`:""}
          ${x.stage==="content_submitted"?`<button class="btn sm" data-bpapprove="${esc(P)}">✅ Approve video</button><button class="btn sm ghost" data-bpchanges="${esc(P)}">✏️ Ask for changes</button><button class="btn sm ghost" data-bprelink="${esc(P)}">🔗 Request a new link</button>`:""}
          ${["content_created","content_submitted","changes_requested","content_approved","published","completed"].includes(x.stage)?`<button class="btn sm${x.stage==="content_approved"?"":" ghost"}" data-bppost="${esc(P)}" title="The creator couldn't post from the app? Paste the link they sent you">🔗 Add post link</button>`:""}
          ${["published","completed"].includes(x.stage)&&posts.length?`<button class="btn sm ghost" data-bpmetrics="${esc(P)}">📈 Add numbers</button>`:""}
          ${x.stage==="published"?`<button class="btn sm" data-bpdone="${esc(P)}">🏁 Mark complete</button>`:""}
          ${!["dropped","rejected","completed","published","ineligible","brand_declined"].includes(x.stage)?`<button class="btn sm ghost" data-bpreassign="${esc(P)}">↪ Send product to someone else</button>`:""}
          ${!x.blacklisted&&!["completed"].includes(x.stage)?`<button class="btn sm ghost" data-bpblack="${esc(P)}">⛔ Blacklist</button>`:""}
        </div></div>`:""}</div>`; }).join("");
}
// the contract terms + video brief this campaign sends out (editable here too)
// Every text field is a notepad-style box that grows as you type (one point / link per line).
function bpTermsHtml(){
  const pb = (_bpData&&_bpData.playbook)||{}, k = pb.contract||{}, b = pb.brief||{};
  const ta = (id,label,val,ph,hint,rows)=>`<label class="bt-f"><span class="bt-l">${label}</span>
      <textarea id="${id}" class="bt-grow" rows="${rows||3}" placeholder="${esc(ph||"")}">${esc(val||"")}</textarea>${hint?`<span class="bt-h">${hint}</span>`:""}</label>`;
  const num = (id,label,val,ph)=>`<label class="bt-f"><span class="bt-l">${label}</span><input id="${id}" type="number" min="0" placeholder="${esc(ph||"")}" value="${esc(val??"")}"></label>`;
  const chk = (id,on,html)=>`<label class="bt-check"><input type="checkbox" id="${id}"${on?" checked":""}><span>${html}</span></label>`;
  return `<div class="bt">
  <div class="card bt-card"><div class="bt-head"><h4>📜 Contract</h4><span class="bt-sub">Goes out automatically when a creator is approved. Changes apply to contracts sent from now on — use “Resend contract” for someone who hasn't signed yet.</span></div>
    <div class="bt-sec">What the creator gets &amp; makes</div>
    ${ta("bpkProd","Product the creator gets",k.product,"Momo box (12 pcs)","",2)}
    <div class="bt-row3">
      ${num("bpkVal","Product value (₹)",k.product_value,"1500")}
      ${num("bpkDays","Content due (days after delivery)",k.content_days??7,"7")}
      ${num("bpkMonths","Ad rights (months)",k.ad_rights_months??1,"1")}
    </div>
    ${ta("bpkDel","Deliverables",k.deliverables,"1 Reel\n1 Story","One per line",2)}
    <div class="bt-sec">Rules</div>
    <div class="bt-checks">
      ${chk("bpkCollab",k.collab_rights!==false,"<b>Collab rights</b> — the creator adds the brand as an Instagram collaborator")}
      ${chk("bpkBlack",k.blacklist_clause!==false,"<b>Non-delivery = blacklist</b> from the platform")}
      ${chk("bpkReship",k.reship_clause!==false,"<b>Re-ship the product at their own cost</b> to another creator we name")}
    </div>
    ${ta("bpkExtra","Other terms (optional)",k.extra_terms,"No competitor brands for 30 days after posting","One term per line",3)}
  </div>
  <div class="card bt-card"><div class="bt-head"><h4>🎬 Video brief</h4><span class="bt-sub">Goes out automatically when the product is delivered.</span></div>
    <div class="bt-sec">The video</div>
    ${ta("bpbShoot","What to shoot",b.what_to_shoot,"Unboxing + first bite\n20–30 sec, vertical 9:16","",5)}
    ${ta("bpbMsg","Key messages",b.key_messages,"Steamed fresh in 10 minutes\n400+ outlets","One message per line",3)}
    <div class="bt-row2">${ta("bpbDos","Do's",b.dos,"Natural light\nShow the box","One per line",4)}${ta("bpbDonts","Don'ts",b.donts,"No other brands in frame","One per line",4)}</div>
    <div class="bt-sec">Posting</div>
    ${ta("bpbCap","Caption to use",b.caption,"Best momos in town 🥟","",3)}
    <div class="bt-row2">${ta("bpbTags","Hashtags",b.hashtags,"#momofest\n#ad","Space or new line between hashtags",2)}${ta("bpbMent","Tag / mention",b.mentions,"@momoco","Space or new line between handles",2)}</div>
    ${ta("bpbRefs","Reference links",b.reference_links,"https://instagram.com/reel/…\nhttps://instagram.com/reel/…","Paste one Instagram / video link per line — the creator gets each as a clickable link",3)}
    ${ta("bpbNote","Posting note (optional)",b.posting_note,"Post between 6–9 pm\nTag the brand in the story","",3)}
    <div class="bt-save"><button class="btn" id="bpSaveTerms">Save contract &amp; brief</button><span class="cp-hint" id="bpTermsOut"></span></div>
  </div></div>`;
}
// notepad boxes grow with their text (any .bt-grow on the page)
function btAutoGrow(root){
  (root||document).querySelectorAll("textarea.bt-grow").forEach(t=>{
    const fit = ()=>{ t.style.height = "auto"; t.style.height = Math.max(t.scrollHeight + 2, 44) + "px"; };
    if(!t.__grow){ t.__grow = true; t.addEventListener("input", fit); }
    requestAnimationFrame(fit);
  });
}
function bpAnalyticsHtml(){
  const a = _bpAnalytics;
  if(!a) return skel("list",3);
  if(a.error) return `<div class="card"><div class="muted">${esc(a.error)}</div></div>`;
  const t = a.totals||{}, rows = a.creators||[];
  const er = (t.followers && (t.likes!=null||t.comments!=null)) ? (100*((t.likes||0)+(t.comments||0)+(t.shares||0)+(t.saves||0))/t.followers).toFixed(2)+"%" : "—";
  const tile = (v,l)=>`<div class="ws-stat"><b>${v==null?"—":fmtNum(v)}</b><span>${l}</span></div>`;
  return `<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
      <div><h4 style="margin:0">Campaign report</h4><div class="muted" style="font-size:13px">Every creator who posted, with their numbers. Updates on its own as Instagram shares insights.</div></div>
      <button class="btn sm" id="bpRepCsv" ${rows.length?"":"disabled"}>⬇ Download report</button></div>
    <div class="ws-stats" style="grid-template-columns:repeat(auto-fill,minmax(120px,1fr));margin-top:12px">
      ${tile(t.creators_live,"Creators live")}${tile(t.posts,"Posts")}${tile(t.views,"Views")}${tile(t.reach,"Reach")}
      ${tile(t.likes,"Likes")}${tile(t.comments,"Comments")}${tile(t.shares,"Shares")}${tile(t.saves,"Saves")}
      <div class="ws-stat"><b>${er}</b><span>Engagement on followers</span></div>${tile(t.followers,"Combined followers")}</div></div>
    ${rows.length?`<div class="card"><h4 style="margin-top:0">Per creator</h4><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Creator</th><th>Followers</th><th>Posts</th><th>Views</th><th>Reach</th><th>Likes</th><th>Comments</th><th>Shares</th><th>Saves</th><th>Status</th></tr></thead><tbody>
      ${rows.map(r=>{ const c=r.creator||{}, s=r.totals||{}, n=v=>v==null?"—":fmtNum(v);
        return `<tr><td><b>@${esc(c.username||"")}</b>${(r.posts||[]).map(p=>p.permalink?` <a href="${esc(safeUrl(p.permalink))}" target="_blank" rel="noopener" title="${esc(p.media_type)}">↗</a>`:"").join("")}</td>
          <td>${n(c.followers)}</td><td>${(r.posts||[]).length}</td><td>${n(s.views)}</td><td>${n(s.reach)}</td><td>${n(s.likes)}</td><td>${n(s.comments)}</td><td>${n(s.shares)}</td><td>${n(s.saves)}</td>
          <td>${r.stage==="completed"?'<span class="tag good">Done</span>':r.stage==="published"?'<span class="tag warn">Live</span>':'<span class="tag">Approved — not posted</span>'}</td></tr>`; }).join("")}
    </tbody></table></div></div>`:`<div class="card"><div class="muted">No posts yet — creators show up here as soon as their reel goes live.</div></div>`}`;
}
function bpDownloadReport(){
  const a = _bpAnalytics||{}, rows = a.creators||[], c = a.campaign||{};
  const cell = v=>{ v = v==null?"":String(v); return /[",\n]/.test(v) ? `"${v.replace(/"/g,'""')}"` : v; };
  const head = ["Creator","Followers","Post type","Post link","Posted on","Views","Reach","Likes","Comments","Shares","Saves","Status"];
  const lines = [];
  rows.forEach(r=>{ const cr=r.creator||{}; (r.posts||[]).forEach(p=>{ const s=p.stats||{};
    lines.push(["@"+(cr.username||""), cr.followers??"", p.media_type, p.permalink||"", p.posted_at?new Date(p.posted_at).toLocaleDateString("en-IN"):"",
      s.views??"", s.reach??"", s.likes??"", s.comments??"", s.shares??"", s.saves??"", r.stage].map(cell).join(",")); }); });
  const t = a.totals||{};
  const csv = [`${c.name||"Campaign"} — report`, `${c.brand||""}`, "",
    `Creators live,${t.creators_live??""}`, `Posts,${t.posts??""}`, `Views,${t.views??""}`, `Reach,${t.reach??""}`, `Likes,${t.likes??""}`,
    `Comments,${t.comments??""}`, `Shares,${t.shares??""}`, `Saves,${t.saves??""}`, "", head.join(","), ...lines].join("\n");
  const el2 = document.createElement("a");
  el2.href = URL.createObjectURL(new Blob(["﻿"+csv], { type:"text/csv;charset=utf-8" }));
  el2.download = `${(c.name||"campaign").replace(/[^\w\-]+/g,"_")}_report.csv`; el2.click();
}
function bpOutreachHtml(){
  const o = _bpData.outreach||{};
  return `<div class="card"><h4 style="margin-top:0">The message you send out</h4>
    <p class="muted" style="font-size:13px;margin:0 0 12px">This is what goes to your creator database, your story and your WhatsApp groups. Everything below is filled into one ready message.</p>
    <div class="cp-grid">
      <label class="cp-f"><span>About the brand (USP)</span><textarea id="bpUsp" rows="2" placeholder="India's favourite momos, 400+ outlets">${esc(o.brand_usp||"")}</textarea></label>
      <label class="cp-f"><span>Who's eligible</span><textarea id="bpElig" rows="2" placeholder="Food creators in Delhi NCR, 10k+ followers">${esc(o.eligibility||"")}</textarea></label>
      <label class="cp-f"><span>What you get</span><textarea id="bpGet" rows="2" placeholder="Momo box worth ₹1,500 + a feature on our page">${esc(o.what_you_get||"")}</textarea></label>
      <label class="cp-f"><span>Deliverables</span><textarea id="bpDel" rows="2" placeholder="1 Reel + 2 Stories within 7 days of delivery">${esc(o.deliverables||"")}</textarea></label>
      <label class="cp-f"><span>Sample video link</span><input id="bpSample" placeholder="https://instagram.com/reel/…" value="${esc(o.sample_link||"")}"></label>
      <label class="cp-f"><span>Form link</span><input id="bpForm" placeholder="https://… (or leave blank to use the app)" value="${esc(o.form_link||"")}"></label>
    </div>
    <label class="cp-f" style="margin-top:12px"><span>Anything else</span><textarea id="bpExtra" rows="2" placeholder="Shoot window, city, do's and don'ts">${esc(o.extra_note||"")}</textarea></label>
    <div class="cp-addrow"><button class="btn sm" id="bpSaveMsg">Save message</button>
      <button class="btn sm ghost" id="bpCopyMsg">📋 Copy for story / groups</button>
      <button class="btn sm ghost" id="bpSendMsg">📣 Send to matching creators</button></div>
    <div class="cp-hint" id="bpMsgOut"></div>
    <div class="bp-preview" id="bpPreview">${esc(bpMessageText())}</div></div>`;
}
function bpMessageText(){
  const o = _bpData.outreach||{}, c = _bpData.campaign||{};
  const link = o.form_link || (window.appOrigin() + "/app.html");
  return [
    `🎁 ${c.brand||"Brand"} × ${c.name||"Barter campaign"}`,
    o.brand_usp ? `\nAbout: ${o.brand_usp}` : "",
    o.eligibility ? `\nWho we're looking for: ${o.eligibility}` : "",
    o.what_you_get ? `\nWhat you get: ${o.what_you_get}` : "",
    o.deliverables ? `\nWhat you make: ${o.deliverables}` : "",
    o.sample_link ? `\nSample video: ${o.sample_link}` : "",
    o.extra_note ? `\n${o.extra_note}` : "",
    `\nApply here: ${link}`
  ].filter(Boolean).join("\n");
}
function bpShortlistHtml(list){
  const ok = list.filter(x=> x.stage==="eligible" || x.stage==="sent_to_brand" || bpStageIndex(x.stage) >= bpStageIndex("brand_confirmed") && !["dropped","rejected","ineligible","brand_declined"].includes(x.stage));
  return `<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
      <div><h4 style="margin:0">Final list for the brand</h4><div class="muted" style="font-size:13px">Everyone who cleared screening. Download it and send it to the brand to sign off.</div></div>
      <button class="btn sm" id="bpXls" ${ok.length?"":"disabled"}>⬇ Download Excel</button></div>
    ${ok.length?`<div style="overflow-x:auto;margin-top:12px"><table class="tbl"><thead><tr><th>#</th><th>Creator</th><th>Followers</th><th>Engagement</th><th>City</th><th>Categories</th><th>Applied with</th><th>Status</th></tr></thead><tbody>
      ${ok.map((x,i)=>{ const cr=x.creator||{};
        return `<tr><td>${i+1}</td><td><b>@${esc(cr.username||"")}</b><div class="muted" style="font-size:12px">${esc(cr.name||"")}</div></td>
          <td>${cr.followers!=null?fmtNum(cr.followers):"—"}</td><td>${cr.engagement!=null?cr.engagement+"%":"—"}</td>
          <td>${esc(cr.city||"—")}</td><td>${esc((cr.categories||[]).join(", ")||"—")}</td>
          <td>${x.applied_profile?"@"+esc(x.applied_profile):"—"}</td>
          <td>${bpStageIndex(x.stage)>=bpStageIndex("brand_confirmed")?'<span class="tag good">Brand confirmed</span>':x.stage==="sent_to_brand"?'<span class="tag warn">With the brand</span>':'<span class="tag">Screened</span>'}</td></tr>`; }).join("")}
    </tbody></table></div>`:`<div class="muted" style="padding:10px">Nobody has cleared screening yet — screen the creators in the Creators tab first.</div>`}</div>`;
}
function wireBarterProcess(){
  const body = document.getElementById("bpBody"); if(!body) return;
  const again = ()=> loadBarterProcess(true);
  const call = async (fn, args, btn, label)=>{
    if(btn){ btn.disabled = true; btn.textContent = "…"; }
    const { error } = await sb.schema("api").rpc(fn, args);
    if(error){ alert(error.message); if(btn){ btn.disabled=false; btn.innerHTML=label; } return false; }
    again(); return true;
  };
  body.querySelectorAll("[data-bpprof]").forEach(b=> b.onclick = e=>{ e.stopPropagation(); bpCreatorProfile(b.dataset.bpprof); });
  body.querySelectorAll("[data-bpopen]").forEach(h=> h.onclick = ()=>{ _bpOpen = _bpOpen===h.dataset.bpopen ? null : h.dataset.bpopen; paintBarterProcess(); });
  body.querySelectorAll("[data-bpscreen]").forEach(b=> b.onclick = ()=> call("screen_participation", { p_participation:b.dataset.bpscreen, p_eligible:true, p_reason:null }, b, "✓ Meets the brief"));
  body.querySelectorAll("[data-bpreject]").forEach(b=> b.onclick = async ()=>{
    const pick = await openReasonModal("Why doesn't this creator fit the brief?"); if(!pick) return;
    call("screen_participation", { p_participation:b.dataset.bpreject, p_eligible:false, p_reason:(pick.note||pick.code) }, b, "Not a fit"); });
  body.querySelectorAll("[data-bpsend]").forEach(b=> b.onclick = ()=> call("advance_participation", { p_participation:b.dataset.bpsend, p_to:"sent_to_brand", p_reason:"added to the brand's list" }, b, "📋 Add to the brand's list"));
  body.querySelectorAll("[data-bpbrand]").forEach(b=> b.onclick = ()=> call("brand_decide_participation", { p_participation:b.dataset.bpbrand, p_confirm:true, p_reason:null }, b, "✅ Brand confirmed"));
  body.querySelectorAll("[data-bpbrandno]").forEach(b=> b.onclick = async ()=>{
    const r = (prompt("What did the brand say?")||"").trim(); if(!r) return;
    call("brand_decide_participation", { p_participation:b.dataset.bpbrandno, p_confirm:false, p_reason:r }, b, "Brand passed"); });
  body.querySelectorAll("[data-bpcontract]").forEach(b=> b.onclick = ()=> call("bp_send_contract", { p_participation:b.dataset.bpcontract }, b, b.innerHTML));
  body.querySelectorAll("[data-bpclauses]").forEach(a=> a.onclick = e=>{ e.preventDefault(); openBpClauses(a.dataset.bpclauses); });
  body.querySelectorAll("[data-bpship]").forEach(b=> b.onclick = ()=> openBpShipment(b.dataset.bpship));
  body.querySelectorAll("[data-bpdeliv]").forEach(b=> b.onclick = ()=>{
    if(!confirm("Mark the parcel as delivered? The video brief goes to the creator right away.")) return;
    call("bp_mark_delivered", { p_participation:b.dataset.bpdeliv }, b, b.innerHTML); });
  body.querySelectorAll("[data-bpapprove]").forEach(b=> b.onclick = ()=> call("bp_review_video", { p_participation:b.dataset.bpapprove, p_approve:true, p_reason:null }, b, b.innerHTML));
  body.querySelectorAll("[data-bpchanges]").forEach(b=> b.onclick = ()=> openBpChanges(b.dataset.bpchanges));
  body.querySelectorAll("[data-bprelink]").forEach(b=> b.onclick = ()=> openBpRelink(b.dataset.bprelink));
  body.querySelectorAll("[data-bpunblock]").forEach(b=> b.onclick = ()=> openBpUnblock(b.dataset.bpunblock));
  body.querySelectorAll("[data-bpcall]").forEach(b=> b.onclick = async ()=>{
    const n = (prompt("What happened on the call? (e.g. no answer, will call back)")||"").trim(); if(!n) return;
    call("bp_log_call", { p_participation:b.dataset.bpcall, p_note:n }, b, b.innerHTML); });
  body.querySelectorAll("[data-bpmetrics]").forEach(b=> b.onclick = ()=> openBpMetrics(b.dataset.bpmetrics));
  body.querySelectorAll("[data-bppost]").forEach(b=> b.onclick = ()=> openBpPostLink(b.dataset.bppost));
  body.querySelectorAll("[data-bpdone]").forEach(b=> b.onclick = ()=> call("bp_mark_done", { p_participation:b.dataset.bpdone }, b, b.innerHTML));
  body.querySelectorAll("[data-bpblack]").forEach(b=> b.onclick = async ()=>{
    const r = (prompt("Blacklist this creator — why?\nThey stay on the list until you lift it. Per the contract they must re-ship the product at their own cost — use “Send product to someone else” to pick who.")||"").trim(); if(!r) return;
    call("blacklist_creator", { p_participation:b.dataset.bpblack, p_reason:r }, b, "⛔ Blacklist"); });
  body.querySelectorAll("[data-bpreassign]").forEach(b=> b.onclick = ()=> openBpReassign(b.dataset.bpreassign));
  const rep = body.querySelector("#bpRepCsv"); if(rep) rep.onclick = ()=> bpDownloadReport();
  btAutoGrow(body);
  const terms = body.querySelector("#bpSaveTerms");
  if(terms) terms.onclick = async ()=>{
    const v = id => ((document.getElementById(id)||{}).value || "").trim(), ck = id => !!(document.getElementById(id)||{}).checked;
    const out = document.getElementById("bpTermsOut");
    if(!v("bpkDel")){ out.textContent = "Add the deliverables (e.g. 1 Reel + 2 Stories) — a contract without them can't be signed."; return; }
    const contract = { product: v("bpkProd")||null, product_value: v("bpkVal")?Number(v("bpkVal")):null, deliverables: v("bpkDel"),
      content_days: Math.min(60, Math.max(1, parseInt(v("bpkDays"))||7)), ad_rights_months: Math.min(24, Math.max(0, parseInt(v("bpkMonths"))||0)),
      collab_rights: ck("bpkCollab"), blacklist_clause: ck("bpkBlack"), reship_clause: ck("bpkReship"), extra_terms: v("bpkExtra")||null };
    const brief = { what_to_shoot: v("bpbShoot")||null, key_messages: v("bpbMsg")||null, dos: v("bpbDos")||null, donts: v("bpbDonts")||null,
      caption: v("bpbCap")||null, reference_links: v("bpbRefs")||null, hashtags: v("bpbTags")||null, mentions: v("bpbMent")||null, posting_note: v("bpbNote")||null };
    terms.disabled = true; terms.textContent = "Saving…";
    const { data, error } = await sb.schema("api").rpc("save_playbook", { p_campaign:_bpCamp.id, p_contract:contract, p_brief:brief });
    terms.disabled = false; terms.innerHTML = "Save contract &amp; brief";
    if(error){ out.textContent = error.message; return; }
    _bpData.playbook = data; out.textContent = "Saved ✓ — every new contract and brief uses this.";
  };
  const save = body.querySelector("#bpSaveMsg");
  if(save) save.onclick = async ()=>{
    const v = id => (document.getElementById(id)||{}).value || "";
    const payload = { brand_usp:v("bpUsp"), eligibility:v("bpElig"), what_you_get:v("bpGet"), deliverables:v("bpDel"),
                      sample_link:v("bpSample"), form_link:v("bpForm"), extra_note:v("bpExtra") };
    save.disabled = true; save.textContent = "Saving…";
    const { error } = await sb.schema("api").rpc("save_outreach", { p_campaign:_bpCamp.id, p_payload:payload });
    save.disabled = false; save.textContent = "Save message";
    const out = document.getElementById("bpMsgOut");
    if(error){ out.textContent = error.message; return; }
    _bpData.outreach = Object.assign({}, _bpData.outreach, payload);
    document.getElementById("bpPreview").textContent = bpMessageText();
    out.textContent = "Saved ✓";
  };
  const copy = body.querySelector("#bpCopyMsg");
  if(copy) copy.onclick = async ()=>{ try{ await navigator.clipboard.writeText(bpMessageText()); copy.textContent = "Copied ✓"; setTimeout(()=>copy.textContent="📋 Copy for story / groups", 1600); }
    catch(e){ prompt("Copy this message:", bpMessageText()); } };
  const send = body.querySelector("#bpSendMsg");
  if(send) send.onclick = ()=>{ window.__bpClose && window.__bpClose(); openInvitePanel(_bpCamp.id, _bpCamp.name); };
  const xls = body.querySelector("#bpXls");
  if(xls) xls.onclick = ()=> bpDownloadShortlist();
}
function bpDownloadShortlist(){
  const list = (_bpData.creators||[]).filter(x=> x.stage==="eligible" || x.stage==="sent_to_brand" || bpStageIndex(x.stage) >= bpStageIndex("brand_confirmed") && !["dropped","rejected","ineligible","brand_declined"].includes(x.stage));
  const c = _bpData.campaign||{};
  const cols = ["#","Creator","Instagram","Followers","Engagement %","City","Categories","Applied with","Status","Applied on"];
  const cell = v=>{ v = Array.isArray(v) ? v.join("; ") : (v==null?"":String(v)); return /[",\n]/.test(v) ? `"${v.replace(/"/g,'""')}"` : v; };
  const rows = list.map((x,i)=>{ const cr=x.creator||{};
    return [i+1, cr.name||"", cr.username?"@"+cr.username:"", cr.followers??"", cr.engagement??"", cr.city||"",
            (cr.categories||[]).join("; "), x.applied_profile?"@"+x.applied_profile:"",
            bpStageIndex(x.stage)>=bpStageIndex("brand_confirmed")?"Brand confirmed":x.stage==="sent_to_brand"?"With the brand":"Screened",
            x.applied_at?new Date(x.applied_at).toLocaleDateString("en-IN"):""].map(cell).join(","); });
  const csv = [`${c.name||"Campaign"} — final creator list`, `${c.brand||""}`, "", cols.join(","), ...rows].join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿"+csv], { type:"text/csv;charset=utf-8" }));
  a.download = `${(c.name||"campaign").replace(/[^\w\-]+/g,"_")}_final_list.csv`; a.click();
}
function bpModal(title, inner){
  let m = document.getElementById("bpModal"); if(m) m.remove();
  m = el("div","modal-overlay"); m.id = "bpModal";
  m.innerHTML = `<div class="modal"><div class="modal-head"><strong>${title}</strong><button class="icon-btn" id="bpMx">✕</button></div>${inner}</div>`;
  document.body.appendChild(m); m.classList.add("open");
  document.getElementById("bpMx").onclick = ()=> m.remove();
  m.onclick = e=>{ if(e.target.id==="bpModal") m.remove(); };
  return m;
}
function openBpClauses(part){
  const x = ((_bpData&&_bpData.creators)||[]).find(c=>c.participation_id===part)||{}, k = x.contract||{};
  bpModal("The contract", `<div class="modal-form">
    ${(k.clauses||[]).length?(k.clauses||[]).map((c,i)=>`<div class="bp-clause"><b>${i+1}. ${esc(c.title)}</b><div>${esc(c.text)}</div></div>`).join("")
      :`<div class="muted">This contract was sent before written clauses existed — product ${esc(k.product||"—")}, ad rights ${esc(k.ad_rights_months??1)} month(s). Use “Resend contract” to send the full version.</div>`}
    <div class="muted" style="font-size:12.5px">${k.signed_at?`Signed by <b>${esc(k.signature_name||"")}</b> on ${esc(fmtDateTime(k.signed_at))} · ASCI ${k.asci_ack?"✓":"✕"} · non-delivery terms ${k.terms_ack?"✓":"—"}`:`Sent ${esc(fmtDateTime(k.issued_at))} — not signed yet`}</div></div>`);
}
function openBpShipment(part){
  const x = ((_bpData&&_bpData.creators)||[]).find(c=>c.participation_id===part)||{}, s = x.shipment||{}, k = x.contract||{};
  const m = bpModal("Courier &amp; tracking", `<form class="modal-form" id="bpSForm">
      <p class="muted" style="font-size:13px;margin:0">The creator sees this straight away and can track the parcel from the app. Until a courier is connected, mark it delivered when it arrives — or the creator taps “I received it”.</p>
      <label>Product<input name="product" value="${esc(s.product||k.product||"")}" placeholder="Momo box"></label>
      <div class="mf-row"><label>Courier<input name="courier" value="${esc(s.courier||"")}" placeholder="DTDC / Delhivery / Blue Dart" required></label>
      <label>Tracking number<input name="tracking" value="${esc(s.tracking_ref||"")}" placeholder="DT123456789"></label></div>
      <label>Tracking link <span class="muted" style="font-weight:400">(optional)</span><input name="url" type="url" value="${esc(s.tracking_url||"")}" placeholder="https://www.dtdc.in/tracking…"></label>
      <div class="auth-err" id="bpSErr"></div><button class="btn" type="submit">Save — creator gets the tracking</button></form>`);
  document.getElementById("bpSForm").onsubmit = async e=>{
    e.preventDefault();
    const f = new FormData(e.target), err = document.getElementById("bpSErr"), btn = e.target.querySelector("button");
    btn.disabled = true; btn.textContent = "Saving…";
    const { error } = await sb.schema("api").rpc("bp_record_courier", { p_participation:part, p_payload:{
      product:String(f.get("product")||"").trim()||null, courier:String(f.get("courier")||"").trim(),
      tracking_ref:String(f.get("tracking")||"").trim()||null, tracking_url:String(f.get("url")||"").trim()||null } });
    if(error){ err.textContent = error.message; btn.disabled=false; btn.textContent="Save — creator gets the tracking"; return; }
    m.remove(); loadBarterProcess(true);
  };
}
function openBpChanges(part){
  const m = bpModal("Ask for changes", `<form class="modal-form" id="bpVForm">
      <p class="muted" style="font-size:13px;margin:0">The creator gets this on the app, WhatsApp and email, and resubmits.</p>
      <label>What should they change?<textarea name="reason" rows="4" required placeholder="Show the box logo in the first 3 seconds; add #ad at the start of the caption"></textarea></label>
      <div class="auth-err" id="bpVErr"></div><button class="btn" type="submit">Send to the creator</button></form>`);
  document.getElementById("bpVForm").onsubmit = async e=>{
    e.preventDefault();
    const reason = String(new FormData(e.target).get("reason")||"").trim(), err = document.getElementById("bpVErr"), btn = e.target.querySelector("button");
    if(!reason){ err.textContent = "Tell the creator what to change."; return; }
    btn.disabled = true; btn.textContent = "Sending…";
    const { error } = await sb.schema("api").rpc("bp_review_video", { p_participation:part, p_approve:false, p_reason:reason });
    if(error){ err.textContent = error.message; btn.disabled=false; btn.textContent="Send to the creator"; return; }
    m.remove(); loadBarterProcess(true);
  };
}
function openBpRelink(part){
  const m = bpModal("Request a new video link", `<form class="modal-form" id="bpLForm">
      <p class="muted" style="font-size:13px;margin:0">The creator is asked for a fresh link on the app, WhatsApp and email. You can do this as many times as you need.</p>
      <label>What's wrong with the link?<select name="why">
        <option>The link doesn't open — it's private. Set Google Drive sharing to “Anyone with the link → Viewer”.</option>
        <option>The link opens a different / wrong file.</option>
        <option>The video won't play or is cut off — please re-upload.</option>
        <option value="other">Something else…</option></select></label>
      <label>Note (optional)<input name="note" placeholder="Add details for the creator"></label>
      <div class="auth-err" id="bpLErr"></div><button class="btn" type="submit">Send request</button></form>`);
  document.getElementById("bpLForm").onsubmit = async e=>{
    e.preventDefault();
    const f = new FormData(e.target), why = f.get("why"), note = String(f.get("note")||"").trim(), err = document.getElementById("bpLErr"), btn = e.target.querySelector("button");
    const reason = [why==="other" ? "" : why, note].filter(Boolean).join(" ");
    if(!reason){ err.textContent = "Tell the creator what's wrong."; return; }
    btn.disabled = true; btn.textContent = "Sending…";
    const { error } = await sb.schema("api").rpc("bp_request_relink", { p_participation:part, p_reason:reason });
    if(error){ err.textContent = error.message; btn.disabled=false; btn.textContent="Send request"; return; }
    m.remove(); loadBarterProcess(true);
  };
}
function openBpUnblock(part){
  const x = ((_bpData&&_bpData.creators)||[]).find(c=>c.participation_id===part)||{};
  const m = bpModal("Called the creator — unblock", `<form class="modal-form" id="bpUForm">
      <p class="muted" style="font-size:13px;margin:0">${x.phone?`📞 <a href="tel:${esc(x.phone)}"><b>${esc(x.phone)}</b></a> · `:""}Write why they didn't submit. They're unblocked, get a new due date, and reminders start again (blocked again after 7 days if nothing comes).</p>
      <label>What did they say?<textarea name="reason" rows="3" required placeholder="Was travelling, shooting this weekend"></textarea></label>
      <label>New due date<select name="days">${[2,3,5,7].map(d=>`<option value="${d}"${d===3?" selected":""}>In ${d} days</option>`).join("")}</select></label>
      <div class="auth-err" id="bpUErr"></div><button class="btn" type="submit">Unblock</button></form>`);
  document.getElementById("bpUForm").onsubmit = async e=>{
    e.preventDefault();
    const f = new FormData(e.target), reason = String(f.get("reason")||"").trim(), err = document.getElementById("bpUErr"), btn = e.target.querySelector("button");
    if(!reason){ err.textContent = "Write what they said."; return; }
    btn.disabled = true; btn.textContent = "Unblocking…";
    const { error } = await sb.schema("api").rpc("bp_unblock_after_call", { p_participation:part, p_reason:reason, p_days:+f.get("days") });
    if(error){ err.textContent = error.message; btn.disabled=false; btn.textContent="Unblock"; return; }
    m.remove(); loadBarterProcess(true);
  };
}
// the creator couldn't post from the app → they send the link (WhatsApp / anything) → paste it here
function openBpPostLink(part){
  const x = ((_bpData&&_bpData.creators)||[]).find(c=>c.participation_id===part)||{};
  const m = bpModal("Add the post link", `<form class="modal-form" id="bpPForm">
      <p class="muted" style="font-size:13px;margin:0">${x.username?`@${esc(x.username)} `:"The creator "}couldn't post from the app? Paste the Instagram link they sent you. The post is added to the campaign, its numbers are fetched, and the campaign is marked complete.</p>
      <label>Instagram link<input name="link" required placeholder="https://www.instagram.com/reel/…"></label>
      <label>Type<select name="type"><option value="reel">Reel</option><option value="post">Post</option><option value="story">Story</option></select></label>
      <div class="auth-err" id="bpPErr"></div><button class="btn" type="submit">Add post</button></form>`);
  document.getElementById("bpPForm").onsubmit = async e=>{
    e.preventDefault();
    const f = new FormData(e.target), err = document.getElementById("bpPErr"), btn = e.target.querySelector("button");
    btn.disabled = true; btn.textContent = "Adding…";
    const { data, error } = await sb.schema("api").rpc("bp_add_post_link", { p_participation:part, p_payload:{ permalink:String(f.get("link")||"").trim(), media_type:f.get("type") } });
    if(error){ err.textContent = error.message; btn.disabled=false; btn.textContent="Add post"; return; }
    m.remove(); gateToast(data && data.matched ? "Post added ✓ — numbers loading · campaign complete" : "Post added ✓ — campaign complete. Numbers load once their Instagram syncs (or add them with 📈 Add numbers).");
    loadBarterProcess(true);
  };
}
function openBpMetrics(part){
  const x = ((_bpData&&_bpData.creators)||[]).find(c=>c.participation_id===part)||{}, posts = x.posts||[];
  const last = (posts[posts.length-1]||{}).stats||{};
  const n = (k,l)=>`<label>${l}<input name="${k}" type="number" min="0" value="${last[k]!=null&&last.source!=="public"?esc(last[k]):""}"></label>`;
  const m = bpModal("Add the numbers", `<form class="modal-form" id="bpMForm">
      <p class="muted" style="font-size:13px;margin:0">Instagram insights load on their own when the creator's account allows it. If not, type them in from the creator's insights screenshot.</p>
      ${posts.length>1?`<label>Post<select name="post">${posts.map(p=>`<option value="${esc(p.post_id)}">${esc(p.media_type)} · ${esc(fmtDate(p.posted_at))}</option>`).join("")}</select></label>`:""}
      <div class="mf-row">${n("views","Views / plays")}${n("reach","Reach")}</div>
      <div class="mf-row">${n("likes","Likes")}${n("comments","Comments")}</div>
      <div class="mf-row">${n("shares","Shares")}${n("saves","Saves")}</div>
      <div class="auth-err" id="bpMErr"></div><button class="btn" type="submit">Save numbers</button></form>`);
  document.getElementById("bpMForm").onsubmit = async e=>{
    e.preventDefault();
    const f = new FormData(e.target), err = document.getElementById("bpMErr"), btn = e.target.querySelector("button"), p = {};
    ["views","reach","likes","comments","shares","saves"].forEach(k=>{ const v = String(f.get(k)||"").trim(); if(v!=="") p[k] = Math.max(0, Math.round(Number(v))||0); });
    if(!Object.keys(p).length){ err.textContent = "Add at least one number."; return; }
    if(f.get("post")) p.post_id = f.get("post");
    btn.disabled = true; btn.textContent = "Saving…";
    const { error } = await sb.schema("api").rpc("bp_record_metrics", { p_participation:part, p_payload:p });
    if(error){ err.textContent = error.message; btn.disabled=false; btn.textContent="Save numbers"; return; }
    m.remove(); loadBarterProcess(true);
  };
}
async function openBpReassign(part){
  const { data } = await sb.schema("api").rpc("campaign_matches", { p_campaign:_bpCamp.id, p_limit:40 }).then(r=>r, ()=>({data:[]}));
  const options = (data||[]).filter(c=>c.state==="none" || c.state==="invited");
  let m = document.getElementById("bpModal"); if(m) m.remove();
  m = el("div","modal-overlay"); m.id = "bpModal";
  m.innerHTML = `<div class="modal"><div class="modal-head"><strong>Send this product to someone else</strong><button class="icon-btn" id="bpMx">✕</button></div>
    <form class="modal-form" id="bpRForm">
      <p class="muted" style="font-size:13px;margin:0">The current creator is dropped from this campaign and the product, contract terms and deliverables move to whoever you pick.</p>
      <label>Next creator<select name="member" required>${options.length?options.map(c=>`<option value="${esc(c.member_id)}">@${esc(c.username)} · ${fmtNum(c.followers||0)} followers</option>`).join(""):`<option value="">No one else matches this brief yet</option>`}</select></label>
      <label>Why<input name="reason" placeholder="Creator went silent / product returned" required></label>
      <div class="auth-err" id="bpRErr"></div><button class="btn" type="submit" ${options.length?"":"disabled"}>Move the product</button></form></div>`;
  document.body.appendChild(m); m.classList.add("open");
  document.getElementById("bpMx").onclick = ()=> m.remove();
  m.onclick = e=>{ if(e.target.id==="bpModal") m.remove(); };
  document.getElementById("bpRForm").onsubmit = async e=>{
    e.preventDefault();
    const f = new FormData(e.target), err = document.getElementById("bpRErr"), btn = e.target.querySelector("button");
    btn.disabled = true; btn.textContent = "Moving…";
    const { error } = await sb.schema("api").rpc("reassign_product", { p_participation:part, p_to_member:f.get("member"), p_reason:String(f.get("reason")||"").trim() });
    if(error){ err.textContent = error.message; btn.disabled=false; btn.textContent="Move the product"; return; }
    m.remove(); loadBarterProcess(true);
  };
}

/* ================= INVITE CREATORS (agency · brand · super admin) =================
 * Saved a campaign → everyone who matches its ideal profile is listed here with one-tap Invite.
 * Platform creators get the invite in-app + on WhatsApp + by email, and accept or pass in My Campaigns.
 * Anyone not on the platform yet is invited by Instagram handle — the invite waits for them and opens
 * the campaign the moment they sign up and connect Instagram. */
let _invCamp = null, _invTab = "matches", _invMatches = [], _invExternal = [], _invDiscovered = [], _invBusy = false;
function openInvitePanel(campaignId, campaignName){
  _invCamp = { id: campaignId, name: campaignName || "this campaign" }; _invTab = "matches";
  document.getElementById("invPanel")?.remove();
  const ov = el("div","ac360"); ov.id = "invPanel";
  ov.innerHTML = `<div class="ac360-box"><div class="ac360-body" id="invBody">${skel("cards",6)}</div></div>`;
  document.body.appendChild(ov); document.body.style.overflow = "hidden";
  const close = ()=>{ ov.remove(); document.body.style.overflow=""; document.removeEventListener("keydown", k); };
  const k = e=>{ if(e.key==="Escape" && !document.querySelector(".modal-overlay.open")) close(); };
  document.addEventListener("keydown", k); ov.onclick = e=>{ if(e.target===ov) close(); };
  window.__invClose = close;
  loadInvitePanel();
}
async function loadInvitePanel(){
  const body = document.getElementById("invBody"); if(!body || !_invCamp) return;
  const [m, x, d] = await Promise.all([
    sb.schema("api").rpc("campaign_matches", { p_campaign:_invCamp.id, p_limit:60 }).then(r=>r, e=>({error:e})),
    sb.schema("api").rpc("list_external_invites", { p_campaign:_invCamp.id }).then(r=>r, ()=>({data:[]})),
    // people who are NOT on Geek OS yet but match this brief, discovered from Instagram
    sb.schema("api").rpc("discover_external", { p_filters:{}, p_campaign:_invCamp.id, p_limit:24 }).then(r=>r, ()=>({data:[]}))
  ]);
  if(m.error){ body.innerHTML = `<div class="card"><div class="muted">${esc(m.error.message||m.error)}</div><button class="mini-btn ghost" onclick="window.__invClose&&window.__invClose()">Close</button></div>`; return; }
  _invMatches = m.data||[]; _invExternal = x.data||[]; _invDiscovered = (d.data||[]).filter(c=>!c.invited);
  // the numbers we already have for the off-platform invites (picture, followers, engagement, bio)
  if(_invExternal.length) await csIgLoadKnown(_invExternal.map(i=> String(i.handle||"").toLowerCase()));
  paintInvitePanel();
}
function paintInvitePanel(){
  const body = document.getElementById("invBody"); if(!body) return;
  const L = _invMatches, invited = L.filter(c=>c.state==="invited").length, applied = L.filter(c=>["applied","approved"].includes(c.state)).length;
  const tabs = [["matches",`✨ Matching creators (${L.length})`],["external",`🔎 Search all creators`]];
  body.innerHTML = `<div class="ac360-head"><div style="flex:1;min-width:0"><h3>Invite creators</h3>
      <div class="muted">${esc(_invCamp.name)} — matched on your ideal influencer profile. Invites go in-app, on WhatsApp and by email.</div></div>
      <button class="ci-pop-x" id="invX" aria-label="Close">✕</button></div>
    <div class="ws-stats" style="grid-template-columns:repeat(auto-fill,minmax(130px,1fr))">
      <div class="ws-stat"><b>${L.length}</b><span>Match your brief</span></div>
      <div class="ws-stat"><b>${invited}</b><span>Invited</span></div>
      <div class="ws-stat"><b>${applied}</b><span>Applied / approved</span></div>
      <div class="ws-stat"><b>${_invDiscovered.length}</b><span>New on Instagram</span></div>
      <div class="ws-stat"><b>${_invExternal.length}</b><span>Off-platform invites</span></div></div>
    <div class="admin-tabs ac360-tabs" style="margin-top:12px">${tabs.map(t=>`<button class="${_invTab===t[0]?"act":""}" data-invtab="${t[0]}">${t[1]}</button>`).join("")}</div>
    <div class="ac360-sec">${_invTab==="matches"?matchesHtml(L):externalHtml()}</div>`;
  body.querySelector("#invX").onclick = ()=> window.__invClose && window.__invClose();
  body.querySelectorAll("[data-invtab]").forEach(b=> b.onclick = ()=>{ _invTab = b.dataset.invtab; paintInvitePanel(); });
  wireInvitePanel(); invExFill();
  const sr = document.getElementById("invSearch");
  if(sr) _invSearchState = mountCreatorSearch(sr, { campaign:_invCamp, state:_invSearchState && _invSearchState.__camp===_invCamp.id ? _invSearchState : Object.assign(csNew(), { __camp:_invCamp.id }) });
}
function matchesHtml(L){
  if(!L.length) return `<div class="card"><div class="muted">No creator on the platform matches this brief yet. Widen the follower range or the ideal profile on the campaign, or invite people by their Instagram handle in the next tab.</div></div>`;
  const badge = s => ({ invited:'<span class="tag warn">Invited</span>', applied:'<span class="tag warn">Applied</span>',
    approved:'<span class="tag good">On the campaign</span>', declined:'<span class="tag">Declined</span>' })[s] || "";
  return `<div class="inv-bar"><input id="invQ" placeholder="🔍 Filter by name, handle, city, category…"><label class="inv-only"><input type="checkbox" id="invOnlyNew" ${_invOnlyNew?"checked":""}> Not invited yet</label>
      <button class="btn sm" id="invAll">Invite all shown</button></div>
    <div class="acr-grid">${L.map(c=>`<div class="acr-card inv-card">
      <div class="acr-top">${c.profile_picture_url?`<img src="${esc(safeUrl(c.profile_picture_url))}" alt="" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">`:`<span class="avatar">${esc((c.name||c.username||"?").slice(0,2).toUpperCase())}</span>`}
        <div style="min-width:0"><div class="acr-name">${esc(c.name||c.username||"Creator")}</div>
          <div class="muted acr-handle">${c.username?`<a href="https://instagram.com/${encodeURIComponent(c.username)}" target="_blank" rel="noopener">@${esc(c.username)}</a>`:""}</div></div>
        <span class="inv-score" title="How well they match your brief">${c.score}%</span></div>
      <div class="acr-stats"><div><b>${fmtNum(c.followers||0)}</b><span>Followers</span></div><div><b>${c.engagement!=null?(Math.round(c.engagement*10)/10)+"%":"—"}</b><span>Engagement</span></div>
        <div><b>${c.reel_rate?"₹"+fmtNum(c.reel_rate):"—"}</b><span>Per Reel</span></div></div>
      <div class="acr-meta">${c.city?`📍 ${esc([...new Set([c.city,c.region].filter(Boolean))].join(", "))}`:'<span class="muted">📍 No city yet</span>'}</div>
      <div class="acr-chips">${(c.why||[]).map(w=>`<span class="cp-tag">✓ ${esc(w)}</span>`).join("")}</div>
      <div class="inv-act">${c.state==="none"
        ? `<button class="btn sm" data-inv="${esc(c.member_id)}">🎯 Invite</button>`
        : badge(c.state)}</div></div>`).join("")}</div>`;
}
let _invOnlyNew = false, _invSearchState = null;
function externalHtml(){
  const st = { pending:['⏳ Not sent yet','warn'], manual:['✉️ Send the DM yourself','warn'], sent:['✅ DM sent','good'],
               needs_permission:['Instagram DM needs Meta approval — send it yourself','warn'], failed:['⚠️ Couldn\'t send','warn'] };
  return `<div id="invSearch"></div>` + `<div class="card"><h4 style="margin-top:0">Invite someone who isn't on Geek OS yet</h4>
      <p class="muted" style="font-size:13px;margin:0 0 10px">Add their Instagram username. We keep the invite ready — when they sign up and connect Instagram, this campaign opens for them automatically and they get the invite in the app, on WhatsApp and by email.</p>
      <div class="cp-addrow"><input id="invHandle" placeholder="@username" maxlength="60"><input id="invNote" placeholder="Short note (optional)" maxlength="140"><button class="btn sm" id="invAddEx">+ Add invite</button></div>
      <div class="cp-hint" id="invExMsg"></div></div>
    ${_invExternal.length?`<div class="cs-sec cs-sec-ig inv-exsec"><div class="cs-sec-h"><span class="cs-sec-t">📸 Off-platform invites <b>${_invExternal.length}</b></span><span class="muted">Not on Geek OS yet — followers & engagement fetched live from Instagram</span></div>
      <div class="cs-igwarn" id="invExWarn" hidden></div>
      <div class="cs-grid" id="invExGrid">${_invExternal.map(i=> invExCard(i)).join("")}</div></div>`:""}`;
}
const INV_EX_ST = { pending:['⏳ Not sent yet','warn'], manual:['✉️ Send the DM yourself','warn'], sent:['✅ DM sent','good'],
                    needs_permission:['✉️ Send the DM yourself','warn'], failed:['⚠️ Couldn\'t send','warn'] };
function invExCard(i){
  const h = String(i.handle||"").toLowerCase(), c = Object.assign({ handle:h }, _csIgRows[h]||{});
  const s = INV_EX_ST[i.dm_status] || [i.dm_status||"Invited", 'warn'];
  const loading = c.followers==null && !c._err && !c._done;
  return `<div class="card cs-card cs-igc${loading?" is-loading":""}" data-igcard="${esc(h)}" data-invexh="${esc(h)}">
    ${csIgHead(c, i.claimed_at?'<span class="tag good">Joined — invite sent ✓</span>':`<span class="tag ${s[1]}">${esc(s[0])}</span>`)}
    ${csIgBody(c)}
    ${i.note?`<div class="muted" style="font-size:12px">“${esc(i.note)}”</div>`:""}
    <div class="cs-act">${i.claimed_at?"":`<a class="btn sm" href="https://ig.me/m/${encodeURIComponent(h)}" target="_blank" rel="noopener">Open DM</a>
      <button class="btn sm ghost" data-invcopy="${esc(h)}">Copy message</button>
      <button class="btn sm ghost" data-invdel="${esc(i.invite_id)}">Remove</button>`}</div></div>`;
}
function invExFill(){
  const grid = document.getElementById("invExGrid"); if(!grid) return;
  const missing = _invExternal.map(i=> String(i.handle||"").toLowerCase()).filter(h=> !(_csIgRows[h]||{}).followers && !(_csIgRows[h]||{})._done);
  if(!missing.length) return;
  igAutoFill(missing, (h, prof, err)=>{
    csIgMerge(Object.assign({}, _csIgRows[h]||{}, { handle:h }), prof, err && !prof ? csIgWhy(err) : null);
    const el = grid.querySelector(`[data-invexh="${CSS.escape(h)}"]`), i = _invExternal.find(x=> String(x.handle||"").toLowerCase()===h);
    if(!el || !i) return; const tmp = document.createElement("div"); tmp.innerHTML = invExCard(i); el.replaceWith(tmp.firstElementChild); wireInvitePanel();
  }, document.getElementById("invExWarn"), 60);
}
/* Auto-discovered from Instagram, scored against THIS campaign's ideal profile — one tap to invite by DM */
function discoveredHtml(){
  const L = _invDiscovered;
  if(!L.length) return `<div class="card"><h4 style="margin-top:0">📸 New on Instagram</h4>
    <p class="muted" style="font-size:13px;margin:0">Nobody new matches this brief yet. Open <b>Discovery → 📸 New on Instagram</b> and tap
    <b>↻ Fetch latest from Instagram</b> — we read the accounts that tagged your Instagram and the @handles inside your creators' posts, then match them to this campaign.</p></div>`;
  return `<div class="card"><h4 style="margin-top:0">📸 Matching creators who aren't on Geek OS yet</h4>
      <p class="muted" style="font-size:13px;margin:0 0 10px">Found on Instagram and matched to this brief — their posts, category, location and follower size. Invite and they get an Instagram DM; when they sign up, this campaign is waiting for them.</p>
      <div class="dc-grid">${L.map(c=>`<div class="card dc-card dx-card">
        <div class="dc-top">${c.profile_picture_url?`<img src="${esc(safeUrl(c.profile_picture_url))}" alt="" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">`:`<span class="avatar">${esc((c.handle||"?").slice(0,2).toUpperCase())}</span>`}
          <div style="min-width:0"><b><a href="https://instagram.com/${encodeURIComponent(c.handle)}" target="_blank" rel="noopener">@${esc(c.handle)}</a></b>
            <div class="muted" style="font-size:12px">${esc(c.name||"")}${c.city?` · ${esc(c.city)}`:""}</div></div>
          <span class="inv-score" title="How well they match this brief">${c.score}</span></div>
        <div class="dc-stats"><span><b>${c.followers!=null?fmtNum(c.followers):"—"}</b>followers</span><span><b>${c.media_count!=null?fmtNum(c.media_count):"—"}</b>posts</span><span><b>${c.mention_count}</b>mentions</span></div>
        ${c.bio?`<div class="muted" style="font-size:12px">${esc(c.bio)}</div>`:""}
        <div class="dc-tags">${(c.why||[]).map(w=>`<span>✓ ${esc(w)}</span>`).join("")}${(c.categories||[]).slice(0,4).map(x=>`<span>${esc(x)}</span>`).join("")}</div>
        <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn sm" data-invdx="${esc(c.handle)}">🎯 Invite to ${esc(_invCamp.name).slice(0,22)}</button>
          <a class="btn sm ghost" href="https://ig.me/m/${encodeURIComponent(c.handle)}" target="_blank" rel="noopener">💬 DM</a>
          ${c.permalink?`<a class="btn sm ghost" href="${esc(safeUrl(c.permalink))}" target="_blank" rel="noopener">Post</a>`:""}</div></div>`).join("")}</div></div>`;
}
function inviteMessageFor(handle){
  const u = window.appOrigin() + "/app.html";
  return `Hi @${handle} 👋 We'd love to have you on "${_invCamp.name}" with us on Geek OS (Bounty & Threads).\n\n`
    + `Sign up free here and the campaign will be waiting in your account: ${u}\n\n`
    + `You'll see the full brief, what you get, and you can accept or pass — no obligation.`;
}
function wireInvitePanel(){
  const body = document.getElementById("invBody"); if(!body) return;
  body.querySelectorAll("[data-inv]").forEach(b=> b.onclick = async ()=>{
    if(_invBusy) return; _invBusy = true; b.disabled = true; b.textContent = "Inviting…";
    const { error } = await sb.schema("api").rpc("invite_creator", { p_campaign:_invCamp.id, p_member:b.dataset.inv, p_note:null });
    _invBusy = false;
    if(error){ alert(error.message); b.disabled=false; b.textContent="🎯 Invite"; return; }
    if(window.Tracker) Tracker.security("creator_invited", { campaign:_invCamp.name });
    const row = _invMatches.find(x=>x.member_id===b.dataset.inv); if(row) row.state = "invited";
    paintInvitePanel();
  });
  const q = body.querySelector("#invQ");
  if(q){ let t; q.oninput = ()=>{ clearTimeout(t); t = setTimeout(()=>{
      const v = q.value.trim().toLowerCase();
      body.querySelectorAll(".inv-card").forEach(card=>{
        const hay = card.textContent.toLowerCase(), isNew = !!card.querySelector("[data-inv]");
        card.style.display = (!v || hay.includes(v)) && (!_invOnlyNew || isNew) ? "" : "none"; });
    }, 200); }; }
  const only = body.querySelector("#invOnlyNew");
  if(only) only.onchange = ()=>{ _invOnlyNew = only.checked; body.querySelectorAll(".inv-card").forEach(card=>{
      card.style.display = (!_invOnlyNew || card.querySelector("[data-inv]")) ? "" : "none"; }); };
  const all = body.querySelector("#invAll");
  if(all) all.onclick = async ()=>{
    const btns = [...body.querySelectorAll(".inv-card")].filter(c=>c.style.display!=="none").map(c=>c.querySelector("[data-inv]")).filter(Boolean);
    if(!btns.length){ alert("Everyone shown has already been invited."); return; }
    if(!confirm(`Invite ${btns.length} creator${btns.length>1?"s":""} to ${_invCamp.name}? They each get it in the app, on WhatsApp and by email.`)) return;
    all.disabled = true;
    for(let i=0;i<btns.length;i++){ all.textContent = `Inviting ${i+1}/${btns.length}…`;
      const { error } = await sb.schema("api").rpc("invite_creator", { p_campaign:_invCamp.id, p_member:btns[i].dataset.inv, p_note:null });
      if(error){ alert(error.message); break; } }
    loadInvitePanel();
  };
  const addEx = body.querySelector("#invAddEx");
  if(addEx) addEx.onclick = async ()=>{
    const h = body.querySelector("#invHandle"), note = body.querySelector("#invNote"), msg = body.querySelector("#invExMsg");
    const handle = String(h.value||"").trim().replace(/^@/,"");
    if(!/^[A-Za-z0-9._]{1,60}$/.test(handle)){ msg.textContent = "Enter a valid Instagram username."; return; }
    addEx.disabled = true;
    const { data, error } = await sb.schema("api").rpc("invite_external", { p_campaign:_invCamp.id, p_handle:handle, p_note:(note.value||"").trim()||null });
    addEx.disabled = false;
    if(error){ msg.textContent = error.message; return; }
    h.value = ""; note.value = "";
    msg.textContent = data && data.on_platform ? "They're already on Geek OS — invite sent in the app, on WhatsApp and by email ✓"
                                               : "Invite saved. Send them the DM below — it opens the campaign for them the moment they sign up.";
    loadInvitePanel();
  };
  // one tap from a discovered Instagram creator straight into this campaign
  body.querySelectorAll("[data-invdx]").forEach(b=> b.onclick = async ()=>{
    if(_invBusy) return; _invBusy = true; b.disabled = true; b.textContent = "Inviting…";
    const { error } = await sb.schema("api").rpc("invite_external", { p_campaign:_invCamp.id, p_handle:b.dataset.invdx, p_note:null });
    _invBusy = false;
    if(error){ alert(error.message); b.disabled = false; b.textContent = "🎯 Invite"; return; }
    if(window.Tracker) Tracker.security("creator_invited_external", { campaign:_invCamp.name });
    loadInvitePanel();
  });
  body.querySelectorAll("[data-invcopy]").forEach(b=> b.onclick = async ()=>{
    const text = inviteMessageFor(b.dataset.invcopy);
    try{ await navigator.clipboard.writeText(text); b.textContent = "Copied ✓"; setTimeout(()=>b.textContent="Copy message", 1600); }
    catch(e){ prompt("Copy this message:", text); } });
  body.querySelectorAll("[data-invdel]").forEach(b=> b.onclick = async ()=>{
    const { error } = await sb.schema("api").rpc("delete_external_invite", { p_invite:b.dataset.invdel });
    if(error) alert(error.message); loadInvitePanel(); });
}
// pick a campaign, then invite (used from Discovery)
async function inviteFromDiscovery(username, memberId){
  const { data, error } = await sb.from("campaigns").select("id,name,status").order("created_at",{ascending:false}).limit(50);
  if(error){ alert(error.message); return; }
  const live = (data||[]).filter(c=>["Sourcing","Live","In Production","Approval"].includes(c.status));
  if(!live.length){ alert("Create a campaign first — then you can invite creators to it."); return; }
  let m = document.getElementById("invPick"); if(m) m.remove();
  m = el("div","modal-overlay"); m.id="invPick";
  m.innerHTML = `<div class="modal"><div class="modal-head"><strong>Invite @${esc(username)}</strong><button class="icon-btn" id="ipX">✕</button></div>
    <form class="modal-form" id="ipForm"><label>Campaign<select name="cid">${live.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("")}</select></label>
    <label>Note (optional)<input name="note" maxlength="140" placeholder="Why you'd love them on this"></label>
    <div class="auth-err" id="ipErr"></div><button class="btn" type="submit">Send invite</button></form></div>`;
  document.body.appendChild(m); m.classList.add("open");
  document.getElementById("ipX").onclick = ()=> m.remove();
  m.onclick = e=>{ if(e.target.id==="invPick") m.remove(); };
  document.getElementById("ipForm").onsubmit = async e=>{
    e.preventDefault();
    const f = new FormData(e.target), err = document.getElementById("ipErr"), btn = e.target.querySelector("button");
    btn.disabled = true; btn.textContent = "Sending…"; err.textContent = "";
    const args = { p_campaign:f.get("cid"), p_note:(f.get("note")||"").trim()||null };
    const { data, error } = memberId
      ? await sb.schema("api").rpc("invite_creator", { ...args, p_member:memberId })
      : await sb.schema("api").rpc("invite_external", { ...args, p_handle:username });
    if(error){ err.textContent = error.message; btn.disabled=false; btn.textContent="Send invite"; return; }
    m.remove();
    alert(memberId || (data && data.on_platform) ? "Invite sent — they'll see it in the app, on WhatsApp and by email."
      : "Invite saved. Open the campaign's Invite panel to send them the Instagram DM.");
  };
}

/* ================= ADMIN (platform team — approve agency signups) ================= */
/* ================= SUPER ADMIN CONSOLE ================= */
const ADMIN_TABS = [["overview","🏠 Overview"],["creators","🎨 Creators"],["users","👥 All users"],["approvals","✅ Account approvals"],["campaigns","📣 All campaigns"],["applications","📝 Applications"],["delivery","📨 WhatsApp & email"],["activity","📈 Activity"],["orgs","Workspaces"],["data","Data browser"],["audit","Audit log"],["check","System check"],["admins","Super admins"]];
const ADMIN_TABLES = [
  ["members","Members (all accounts)"],["creators","Agency creator rosters"],["campaigns","Campaigns"],["barter_items","Barter items"],
  ["applications","Applications"],["invites","Invites"],["irm_contacts","IRM contacts"],
  ["story_deals","Celebrity deals"],["dream_plans","Dream plans"],["org_profiles","Org profiles"]
];
const ADMIN_EDITABLE = new Set(["members","creators","campaigns","barter_items","applications","invites","irm_contacts","story_deals","dream_plans"]);
const ADMIN_READONLY_FIELDS = new Set(["id","org_id","created_at","updated_at"]);
let _adminTab = "overview";
let _adminDataTable = "creators";

// Super Admin → All users: who joined, when they signed in, consent, live profile status + full creator profile
let _auFilter = "all", _auTimer = null, _auSig = "";
async function adminUsers(body, silent){
  if(!silent) body.innerHTML = skel("table",8);
  const { data, error } = await sb.rpc("admin_users");
  if(error){ if(!silent) body.innerHTML = adminErr(error); return; }
  const sig = JSON.stringify(data); if(silent && sig===_auSig) return; _auSig = sig;
  const all = data||[];
  const ago = t=>{ if(!t) return "—"; const m=Math.round((Date.now()-new Date(t).getTime())/60000); return m<1?"just now":m<60?m+"m ago":m<1440?Math.round(m/60)+"h ago":Math.round(m/1440)+"d ago"; };
  const roles = ["all","creator","owner","brand","manager","corporate"];
  const rows = all.filter(u=> _auFilter==="all" || u.role===_auFilter || (_auFilter==="incomplete" && u.role==="creator" && u.profile_complete===false) || (_auFilter==="pending" && u.status==="pending"));
  const today = new Date(); today.setHours(0,0,0,0);
  const n = f => all.filter(f).length;
  body.innerHTML = `<div class="rp-kpis">
      <div><b>${all.length}</b>Total users</div><div><b>${n(u=>u.role==="creator")}</b>Creators</div>
      <div><b>${n(u=>u.role==="owner"||u.role==="brand")}</b>Agencies & brands</div>
      <div><b>${n(u=>u.joined_at && new Date(u.joined_at)>=today)}</b>Joined today</div>
      <div><b>${n(u=>u.last_sign_in_at && new Date(u.last_sign_in_at)>=today)}</b>Signed in today</div>
      <div><b>${n(u=>u.role==="creator" && u.profile_complete)}</b>Profiles complete</div>
      <div><b>${n(u=>u.consent)}</b>Cookie consent given</div></div>
    <div class="card"><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;justify-content:space-between">
      <h3 style="margin:0">All users <span class="muted" style="font-size:12px;font-weight:400">· live, refreshes every 30s</span></h3>
      <select id="auFilter">${roles.concat(["incomplete","pending"]).map(r=>`<option value="${r}"${r===_auFilter?" selected":""}>${{all:"Everyone",creator:"Creators",owner:"Agency owners",brand:"Brands",manager:"Managers",corporate:"Corporate",incomplete:"Creators — profile incomplete",pending:"Pending approval"}[r]}</option>`).join("")}</select></div>
    <div style="overflow-x:auto;margin-top:10px"><table class="tbl"><thead><tr><th>Person</th><th>Role</th><th>WhatsApp / email</th><th>Joined</th><th>Last sign-in</th><th>Logins</th><th>Last seen</th><th>Location / IP</th><th>Cookies</th><th>Profile</th><th></th></tr></thead><tbody>
    ${rows.map(u=>`<tr><td><b>${esc(u.name||"—")}</b>${u.ig_username?`<div class="muted" style="font-size:12px">@${esc(u.ig_username)}${u.followers!=null?` · ${fmtNum(u.followers)}`:""}</div>`:""}${u.org_name&&u.role!=="creator"?`<div class="muted" style="font-size:12px">${esc(u.org_name)}</div>`:""}</td>
      <td>${esc(u.role||"—")}${u.status==="pending"?' <span class="tag warn">pending</span>':""}</td>
      <td style="font-size:12px">${esc(u.whatsapp||"")}${u.email?`<div>${esc(u.email)}</div>`:""}</td>
      <td style="font-size:12px">${esc(fmtDateTime(u.joined_at))}</td><td style="font-size:12px">${esc(fmtDateTime(u.last_sign_in_at))}</td>
      <td>${u.logins||0}</td><td>${ago(u.last_seen)}</td>
      <td style="font-size:12px">${esc([u.last_city,u.last_region].filter(Boolean).join(", ")||"—")}${u.last_ip?`<div class="muted"><code>${esc(u.last_ip)}</code></div>`:""}</td>
      <td>${u.consent==="all"?'<span class="tag good">all</span>':u.consent==="essential"?'<span class="tag warn">essential</span>':'<span class="muted">—</span>'}${u.consent_at?`<div class="muted" style="font-size:11px">${esc(fmtDateTime(u.consent_at))}</div>`:""}</td>
      <td>${u.role!=="creator"?"—":u.profile_complete?'<span class="tag good">complete</span>':`<span class="tag warn">${u.profile_done??0}/${u.profile_total??"?"}</span>`}</td>
      <td style="white-space:nowrap">${u.role==="creator"?`<button class="mini-btn" data-auprof="${esc(u.member_id)}">Profile</button> `:""}<button class="mini-btn ghost" data-autl="${esc(u.member_id)}">Activity</button></td></tr>`).join("")}
    </tbody></table></div>${rows.length?"":`<div class="muted" style="padding:8px">No users in this view.</div>`}</div>
    <div id="auDetail"></div><div id="actTimeline"></div>`;
  document.getElementById("auFilter").onchange = e=>{ _auFilter = e.target.value; _auSig=""; adminUsers(body); };
  body.querySelectorAll("[data-auprof]").forEach(b=> b.onclick = ()=> adminCreatorProfile(b.dataset.auprof, all.find(u=>u.member_id===b.dataset.auprof)));
  body.querySelectorAll("[data-autl]").forEach(b=> b.onclick = ()=> adminActivityTimeline(b.dataset.autl, all.find(u=>u.member_id===b.dataset.autl)));
  clearInterval(_auTimer);
  _auTimer = setInterval(()=>{
    const b = document.getElementById("adminBody");
    if(currentPage!=="admin" || _adminTab!=="users" || !b){ clearInterval(_auTimer); return; }
    if(document.visibilityState!=="visible" || document.getElementById("ac360") || document.getElementById("auDetail")?.innerHTML || document.getElementById("actTimeline")?.innerHTML || document.activeElement?.tagName==="SELECT") return;
    adminUsers(b, true);
  }, 30000);
}
// Super Admin → Creators: live directory of every creator + Creator 360 (profile, Instagram, campaigns, activity)
let _acrQ = "", _acrF = "all", _acrSort = "new", _acrTimer = null, _acrSig = "", _acrData = [], _acrPage = 0;
// card view (default) or list view — remembered on this device
let _acrView = (()=>{ try{ return localStorage.getItem("geek_acr_view") === "list" ? "list" : "card"; }catch(e){ return "card"; } })();
const ACR_PAGE = 24;
const agoTxt = t=>{ if(!t) return "—"; const m=Math.round((Date.now()-new Date(t).getTime())/60000); return m<1?"just now":m<60?m+"m ago":m<1440?Math.round(m/60)+"h ago":Math.round(m/1440)+"d ago"; };
const kNum = n=> n==null ? "—" : n>=1e6 ? (n/1e6).toFixed(1).replace(/\.0$/,"")+"M" : n>=1e3 ? (n/1e3).toFixed(1).replace(/\.0$/,"")+"K" : String(n);
async function adminCreators(body, silent){
  if(!silent) body.innerHTML = skel("cards",8);
  const [{ data, error }, ig] = await Promise.all([ sb.rpc("admin_creators"), sb.rpc("admin_ig_accounts").then(r=>r, ()=>({data:null})) ]);
  if(error){ if(!silent) body.innerHTML = adminErr(error); return; }
  const sig = JSON.stringify([data, ig && ig.data]); if(silent && sig===_acrSig) return; _acrSig = sig;
  const IGM = (ig && ig.data) || {};
  _acrData = (data||[]).map(c=> Object.assign({}, c, { ig_accounts: IGM[c.member_id] || [] }));
  const all = _acrData, n = f=>all.filter(f).length;
  body.innerHTML = `<div class="rp-kpis acr-kpis">
      ${[["all","Creators",all.length],["ig","Instagram connected",n(c=>c.ig_username)],["complete","Profile complete",n(c=>c.complete)],["incomplete","Profile incomplete",n(c=>!c.complete)],
         ["barter","Open to barter",n(c=>c.accepts_barter)],["rate","Reel rate added",n(c=>c.reel_rate)],["applied","Applied to campaigns",n(c=>c.applied>0)],["multi","2+ Instagram accounts",n(c=>(c.ig_accounts||[]).length>1)],["approved","Approved in campaigns",n(c=>c.approved>0)]]
        .map(([k,l,v])=>`<div data-acrf="${k}" class="${_acrF===k?"act":""}" style="cursor:pointer"><b>${fmtNum(v)}</b>${l}</div>`).join("")}</div>
    <div class="card"><div class="acr-bar">
      <h3 style="margin:0">Creators <span class="muted" style="font-size:12px;font-weight:400">· live, refreshes every 30s</span></h3>
      <div class="acr-tools"><input id="acrQ" placeholder="🔍 Name, @handle, city, niche, phone…" value="${esc(_acrQ)}">
        <select id="acrF">${[["all","All creators"],["ig","Instagram connected"],["noig","Instagram not connected"],["complete","Profile complete"],["incomplete","Profile incomplete"],["barter","Open to barter"],["rate","Reel rate added"],["applied","Applied to campaigns"],["pending","Waiting for approval"],["approved","Approved in campaigns"],["travel","Travelling now"],["multi","2+ Instagram accounts"],["pages","Manages other pages"]]
          .map(([k,l])=>`<option value="${k}"${_acrF===k?" selected":""}>${l}</option>`).join("")}</select>
        <select id="acrSort">${[["new","Newest first"],["followers","Most followers"],["eng","Best engagement"],["seen","Recently active"],["applied","Most applications"]].map(([k,l])=>`<option value="${k}"${_acrSort===k?" selected":""}>${l}</option>`).join("")}</select>
        <span class="acr-view" role="group" aria-label="View"><button type="button" data-acrview="card" class="${_acrView==="card"?"act":""}" title="Card view">▦ Cards</button><button type="button" data-acrview="list" class="${_acrView==="list"?"act":""}" title="List view">☰ List</button></span>
        <button class="mini-btn ghost" id="acrCsv">⬇ CSV</button></div></div>
      <div id="acrGrid"></div></div>`;
  paintCreators();
  const qi = document.getElementById("acrQ"); let tq;
  qi.oninput = ()=>{ clearTimeout(tq); tq = setTimeout(()=>{ _acrQ = qi.value; _acrPage = 0; paintCreators(); }, 200); };
  document.getElementById("acrF").onchange = e=>{ _acrF = e.target.value; _acrPage = 0; adminCreators(body); };
  document.getElementById("acrSort").onchange = e=>{ _acrSort = e.target.value; paintCreators(); };
  body.querySelectorAll("[data-acrview]").forEach(b=> b.onclick = ()=>{ _acrView = b.dataset.acrview; try{ localStorage.setItem("geek_acr_view", _acrView); }catch(e){}
    body.querySelectorAll("[data-acrview]").forEach(x=> x.classList.toggle("act", x.dataset.acrview===_acrView)); paintCreators(); });
  body.querySelectorAll("[data-acrf]").forEach(d=> d.onclick = ()=>{ _acrF = d.dataset.acrf; _acrPage = 0; _acrSig=""; adminCreators(body); });
  document.getElementById("acrCsv").onclick = ()=>{
    const cols = ["name","ig_username","followers","engagement","whatsapp","email","city","state","categories","gender","accepts_barter","reel_rate","done","total","applied","approved","completed","joined_at","last_seen"];
    const cell = v=>{ v = Array.isArray(v) ? v.join("; ") : (v==null?"":String(v)); return /[",\n]/.test(v) ? `"${v.replace(/"/g,'""')}"` : v; };
    const csv = [cols.join(",")].concat(filteredCreators().map(c=>cols.map(k=>cell(c[k])).join(","))).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv],{type:"text/csv"})); a.download = "creators.csv"; a.click(); };
  clearInterval(_acrTimer);
  _acrTimer = setInterval(()=>{
    const b = document.getElementById("adminBody");
    if(currentPage!=="admin" || _adminTab!=="creators" || !b){ clearInterval(_acrTimer); return; }
    if(document.visibilityState!=="visible" || document.getElementById("ac360") || document.activeElement?.id==="acrQ" || document.activeElement?.tagName==="SELECT") return;
    adminCreators(b, true);
  }, 30000);
}
function filteredCreators(){
  const q = _acrQ.trim().toLowerCase();
  const F = { all:()=>true, ig:c=>c.ig_username, noig:c=>!c.ig_username, complete:c=>c.complete, incomplete:c=>!c.complete, barter:c=>c.accepts_barter,
              rate:c=>c.reel_rate, applied:c=>c.applied>0, pending:c=>c.pending>0, approved:c=>c.approved>0, travel:c=>c.travel_city, pages:c=>c.pages>0, multi:c=>(c.ig_accounts||[]).length>1 }[_acrF] || (()=>true);
  const S = { new:(a,b)=>new Date(b.joined_at||0)-new Date(a.joined_at||0), followers:(a,b)=>(b.followers||0)-(a.followers||0), eng:(a,b)=>(b.engagement||0)-(a.engagement||0),
              seen:(a,b)=>new Date(b.last_seen||0)-new Date(a.last_seen||0), applied:(a,b)=>(b.applied||0)-(a.applied||0) }[_acrSort];
  return _acrData.filter(F).filter(c=> !q || [c.name,c.ig_username,(c.ig_accounts||[]).map(a=>a.username).join(" "),c.city,c.state,c.whatsapp,c.email,(c.categories||[]).join(" "),(c.skills||[]).join(" ")].join(" ").toLowerCase().includes(q)).sort(S);
}
function paintCreators(){
  const g = document.getElementById("acrGrid"); if(!g) return;
  const list = filteredCreators(), pages = Math.max(1, Math.ceil(list.length/ACR_PAGE)); _acrPage = Math.min(_acrPage, pages-1);
  const shown = list.slice(_acrPage*ACR_PAGE, (_acrPage+1)*ACR_PAGE);
  const pager = pages>1 ? `<div class="acr-pager"><button class="mini-btn ghost" data-acrp="-1"${_acrPage?"":" disabled"}>← Prev</button><span class="muted">Page ${_acrPage+1} of ${pages} · ${list.length} creators</span><button class="mini-btn ghost" data-acrp="1"${_acrPage<pages-1?"":" disabled"}>Next →</button></div>` : `<div class="acr-pager"><span class="muted">${list.length} creator${list.length===1?"":"s"}</span></div>`;
  if(_acrView==="list"){
    g.innerHTML = list.length ? `<div class="acr-list"><div class="acr-lh"><span>Creator</span><span>Followers</span><span>Engagement</span><span>Per Reel</span><span>Applied / ✓</span><span>Location</span><span>Profile</span><span>Active</span></div>
      ${shown.map(c=>{ const pct = c.total ? Math.round(100*(c.done||0)/c.total) : 0;
        const pic = c.pic ? `<img src="${esc(safeUrl(c.pic))}" alt="" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'avatar',textContent:'${esc(String(c.name||"?").slice(0,2).toUpperCase())}'}))">`
                          : `<span class="avatar">${esc(String(c.name||"?").slice(0,2).toUpperCase())}</span>`;
        return `<div class="acr-lr" data-acr="${esc(c.member_id)}" tabindex="0">
          <span class="acr-lc-who">${pic}<span><b>${esc(c.name)}</b><span class="muted">${c.ig_username?"@"+esc(c.ig_username):"Instagram not connected"}${(c.ig_accounts||[]).length>1?` · ${(c.ig_accounts||[]).length} accounts`:""}</span></span></span>
          <span data-l="Followers"><b>${kNum(c.followers)}</b></span>
          <span data-l="Engagement">${c.engagement!=null?c.engagement+"%":"—"}</span>
          <span data-l="Per Reel">${c.reel_rate?"₹"+kNum(Number(c.reel_rate)):"—"}</span>
          <span data-l="Applied / ✓">${c.applied||0} / ${c.approved||0}</span>
          <span data-l="Location" class="acr-lc-loc">${c.city?esc([c.city,c.state].filter(Boolean).join(", ")):'<span class="muted">—</span>'}</span>
          <span data-l="Profile" class="acr-lc-pct"><span class="acr-bar2"><span style="width:${pct}%"></span></span><small>${c.complete?"Ready":pct+"%"}</small></span>
          <span data-l="Active" class="muted">${agoTxt(c.last_seen)}</span></div>`; }).join("")}</div>${pager}`
      : `<div class="muted" style="padding:14px">No creators in this view.</div>`;
    g.querySelectorAll("[data-acr]").forEach(el=>{ const open = ()=> adminCreatorProfile(el.dataset.acr, _acrData.find(c=>c.member_id===el.dataset.acr)); el.onclick = open; el.onkeydown = e=>{ if(e.key==="Enter") open(); }; });
    g.querySelectorAll("[data-acrp]").forEach(b=> b.onclick = ()=>{ _acrPage += Number(b.dataset.acrp); paintCreators(); document.getElementById("acrGrid").scrollIntoView({behavior:"smooth",block:"start"}); });
    return;
  }
  g.innerHTML = list.length ? `<div class="acr-grid">${shown.map(c=>{
      const pct = c.total ? Math.round(100*(c.done||0)/c.total) : 0;
      const pic = c.pic ? `<img src="${esc(safeUrl(c.pic))}" alt="" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'avatar',textContent:'${esc(String(c.name||"?").slice(0,2).toUpperCase())}'}))">`
                        : `<span class="avatar">${esc(String(c.name||"?").slice(0,2).toUpperCase())}</span>`;
      return `<div class="acr-card" data-acr="${esc(c.member_id)}" tabindex="0">
        <div class="acr-top">${pic}<div style="min-width:0"><div class="acr-name">${esc(c.name)}</div>
          <div class="muted acr-handle">${c.ig_username?"@"+esc(c.ig_username):'<span class="tag warn">Instagram not connected</span>'}</div>
          ${(c.ig_accounts||[]).length ? `<button type="button" class="acr-igs" data-igaccts="${esc(c.member_id)}" data-igname="${esc(c.name||"")}">📸 ${(c.ig_accounts||[]).length} Instagram ${(c.ig_accounts||[]).length>1?"accounts":"account"} →</button>` : ""}</div>
          ${c.complete?'<span class="tag good">Ready</span>':`<span class="tag warn">${c.done??0}/${c.total??"?"}</span>`}</div>
        <div class="acr-stats"><div><b>${kNum(c.followers)}</b><span>Followers</span></div><div><b>${c.engagement!=null?c.engagement+"%":"—"}</b><span>Engagement</span></div>
          <div><b>${c.reel_rate?"₹"+kNum(Number(c.reel_rate)):"—"}</b><span>Per Reel</span></div><div><b>${c.applied||0}<small>/${c.approved||0}</small></b><span>Applied / ✓</span></div></div>
        <div class="acr-meta">${c.city?`📍 ${esc([c.city,c.state].filter(Boolean).join(", "))}`:'<span class="muted">📍 No address yet</span>'}${c.travel_city?` · ✈️ ${esc(c.travel_city)}`:""}</div>
        <div class="acr-chips">${(c.categories||[]).slice(0,3).map(x=>`<span class="cp-tag">${esc(x)}</span>`).join("")}${c.accepts_barter?'<span class="cp-tag">🎁 Barter</span>':""}${c.pets?`<span class="cp-tag">🐾 ${c.pets}</span>`:""}${c.pages?`<span class="cp-tag">+${c.pages} page${c.pages>1?"s":""}</span>`:""}</div>
        <div class="acr-bar2"><span style="width:${pct}%"></span></div>
        <div class="acr-foot muted">Joined ${esc(fmtDate(c.joined_at))} · active ${agoTxt(c.last_seen)}</div></div>`; }).join("")}</div>
      ${pages>1?`<div class="acr-pager"><button class="mini-btn ghost" data-acrp="-1"${_acrPage?"":" disabled"}>← Prev</button><span class="muted">Page ${_acrPage+1} of ${pages} · ${list.length} creators</span><button class="mini-btn ghost" data-acrp="1"${_acrPage<pages-1?"":" disabled"}>Next →</button></div>`:`<div class="muted" style="font-size:12px;margin-top:10px">${list.length} creator${list.length===1?"":"s"}</div>`}`
    : `<div class="muted" style="padding:14px">No creators in this view.</div>`;
  g.querySelectorAll("[data-acr]").forEach(el=>{ const open = ()=> adminCreatorProfile(el.dataset.acr, _acrData.find(c=>c.member_id===el.dataset.acr)); el.onclick = open; el.onkeydown = e=>{ if(e.key==="Enter") open(); }; });
  g.querySelectorAll("[data-acrp]").forEach(b=> b.onclick = ()=>{ _acrPage += Number(b.dataset.acrp); paintCreators(); document.getElementById("acrGrid").scrollIntoView({behavior:"smooth",block:"start"}); });
}

// Creator 360 — full-screen panel, opened from Creators, All users, Applications
let _ac360Tab = "profile";
async function adminCreatorProfile(member, row){
  document.getElementById("ac360")?.remove();
  const ov = document.createElement("div"); ov.id = "ac360"; ov.className = "ac360";
  ov.innerHTML = `<div class="ac360-box" role="dialog" aria-modal="true"><div class="ac360-body">${skel("profile")}</div></div>`;
  document.body.appendChild(ov); document.body.style.overflow = "hidden";
  const close = ()=>{ ov.remove(); document.body.style.overflow = ""; document.removeEventListener("keydown", k); };
  const k = e=>{ if(e.key==="Escape") close(); };
  document.addEventListener("keydown", k); ov.addEventListener("click", e=>{ if(e.target===ov) close(); });
  const { data:d, error } = await sb.rpc("admin_creator_profile", { p_member: member });
  const bodyEl = ov.querySelector(".ac360-body");
  if(error){ bodyEl.innerHTML = `<div class="card"><div class="muted">${esc(error.message)}</div><button class="mini-btn ghost" id="acX">Close</button></div>`; ov.querySelector("#acX").onclick = close; return; }
  const D = d||{}, mem = D.member||{}, ig = D.instagram||{}, per = D.personal||{}, con = D.contact||{}, cp = D.commercial_preference||{}, pro = D.professional||{}, req = D.requirements||{};
  const name = (row&&row.name) || mem.name || [per.first_name,per.last_name].filter(Boolean).join(" ") || ig.username || "Creator";
  const L = { prefer_not_to_say:"Prefer not to say", single:"Unmarried", married:"Married", divorced:"Divorced", widowed:"Widowed", non_binary:"Non-binary", female:"Female", male:"Male", other:"Other" };
  const yn = v => v===true?"Yes":v===false?"No":"—";
  const r = (kk,v)=>`<div class="cd-row"><span class="cd-l">${esc(kk)}</span><span class="cd-v">${v==null||v===""?"—":v}</span></div>`;
  const synthetic = /@creators\.bountythreads\.app$/i.test(con.email||"");
  const age = per.date_of_birth ? Math.floor((Date.now()-new Date(per.date_of_birth).getTime())/31557600000) : null;
  const wa = con.whatsapp_e164 || mem.whatsapp || "";
  const media = ig.media||[], eng = ig.followers && media.length ? (media.reduce((s,m)=>s+(m.likes||0)+(m.comments||0),0)/media.length/ig.followers*100).toFixed(2) : null;
  const camps = D.campaigns||[], mk = D.marketplace||[];
  const stageTag = s=>{ const [l,c] = APPLICANT_STAGE[s] || [String(s||"").replace(/_/g," "), "brand"]; return `<span class="tag ${c}">${esc(l)}</span>`; };
  const tabs = [["profile","👤 Profile"],["instagram","📸 Instagram"],["campaigns",`📣 Campaigns (${camps.length+mk.length})`],["activity","📈 Activity"]];
  const pic = ig.pic ? `<img class="ac360-pic" src="${esc(safeUrl(ig.pic))}" alt="" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">` : `<span class="avatar ac360-pic">${esc(String(name).slice(0,2).toUpperCase())}</span>`;
  const sections = {
    profile: !D.identity_id ? `<div class="card"><div class="muted">This creator hasn't started their profile yet (signed in, profile not created).</div></div>` : `
      ${!req.complete&&(req.missing||[]).length?`<div class="ac360-miss"><b>Still missing:</b> ${req.missing.map(esc).join(" · ")}</div>`:""}
      <div class="ac360-cols">
        <div class="card"><h4>Personal</h4>
          ${r("Name", esc([per.first_name,per.last_name].filter(Boolean).join(" ")))}
          ${r("Gender", esc(L[per.gender]||per.gender||""))}
          ${r("Birthday", per.date_of_birth?`${esc(fmtDate(per.date_of_birth))}${age!=null?` · ${age} yrs`:""}`:"")}
          ${r("Marital status", esc(L[per.marital_status]||per.marital_status||""))}
          ${per.marital_status==="married"?r("Anniversary", esc(fmtDate(per.marriage_anniversary))):""}
          ${r("Pets", per.has_pet===false?"No":(D.pets||[]).length?(D.pets||[]).map(x=>{
              const mo = x.birth_date ? Math.max(0, Math.round((Date.now()-new Date(x.birth_date).getTime())/2629800000)) : null;
              const age = mo==null ? "" : mo<12 ? ` · ${mo} mo` : ` · ${Math.floor(mo/12)} yr${mo%12?" "+(mo%12)+" mo":""}`;
              return `🐾 ${esc(x.name)} (${esc(x.pet_type)})${age}${x.birth_date?` <span class="muted">· b. ${esc(fmtDate(x.birth_date))}</span>`:""}`;
            }).join("<br>"):per.has_pet?`${esc(per.pet_name||"")} (${esc(per.pet_type||"")})`:"")}</div>
        <div class="card"><h4>Contact</h4>
          ${r("WhatsApp", wa?`<a href="https://wa.me/${esc(wa.replace(/\D/g,""))}" target="_blank" rel="noopener">${esc(wa)}</a>${con.whatsapp_verified_at||mem.whatsapp?' <span class="tag good">verified</span>':""}`:"")}
          ${r("Backup email", !synthetic&&con.email?`<a href="mailto:${esc(con.email)}">${esc(con.email)}</a>${con.email_verified_at?' <span class="tag good">verified</span>':' <span class="tag warn">not verified</span>'}`:"")}
          ${r("Addresses", (D.addresses||[]).map(a=>`${a.is_default?"⭐ ":""}<b>${esc(a.label||"")}</b> ${esc([a.line1,a.line2,a.landmark,a.city,a.state,a.postal_code,a.country].filter(Boolean).join(", "))}`).join("<br>"))}
          ${r("Travelling to", D.travel&&D.travel.city?esc([D.travel.city,D.travel.state,D.travel.country].filter(Boolean).join(", "))+(D.travel.until_date?` · till ${esc(fmtDate(D.travel.until_date))}`:""):"")}</div>
        <div class="card"><h4>Professional</h4>
          ${r("Display name", esc(pro.display_name||""))}
          ${r("Primary city", esc([pro.city_coarse,pro.state_coarse].filter(Boolean).join(", ")))}
          ${r("Niche", (pro.categories||[]).map(esc).join(", "))}
          ${r("Languages", (pro.languages||[]).map(esc).join(", "))}
          ${r("Travel willingness", esc(String(pro.travel_willingness||"").replace(/_/g," ")))}
          ${r("Availability", esc(pro.availability_status||""))}
          ${r("Management", esc(String(pro.management_status||"").replace(/_/g," ")))}
          ${r("Other profiles", (D.managed_profiles||[]).map(m=>`<a href="https://instagram.com/${encodeURIComponent(m.handle)}" target="_blank" rel="noopener">@${esc(m.handle)}</a>${m.followers!=null?` · ${kNum(m.followers)}`:""}${m.category?` · ${esc(m.category)}`:""}`).join("<br>"))}</div>
        <div class="card"><h4>Commercials</h4>
          ${r("Rate card", (D.rate_items||[]).map(i=>`${esc(i.deliverable_type)} — <b>${fmtMoney(i.amount)}</b>`).join("<br>"))}
          ${r("Open to barter", yn(cp.accepts_barter))}
          ${cp.accepts_barter?r("Barter scope", esc(String(cp.barter_preference||"any relevant brand").replace(/_/g," "))):""}
          ${cp.accepts_barter?r("Min product value", cp.min_product_value!=null?fmtMoney(cp.min_product_value):""):""}
          ${r("Favourite brands", (D.fav_brands||[]).map(esc).join(", "))}
          ${r("Brands worked with", (D.brands_worked||[]).map(b=>`${esc(b.brand)}${b.type?` <span class="muted">(${esc(String(b.type).replace(/_/g," "))})</span>`:""}${b.detected?' <span class="cp-badge cp-ig">IG</span>':""}`).join("<br>"))}</div>
        <div class="card"><h4>Skills & resources</h4>
          <div class="acr-chips">${(D.skills||[]).map(x=>`<span class="cp-tag">${esc(x)}</span>`).join("")||'<span class="muted">No skills</span>'}</div>
          <div class="acr-chips" style="margin-top:10px">${(D.resources||[]).map(x=>`<span class="cp-tag">🎒 ${esc(x)}</span>`).join("")||'<span class="muted">No resources</span>'}</div></div>
      </div>`,
    instagram: !ig.username ? `<div class="card"><div class="muted">Instagram not connected yet.</div></div>` : `
      <div class="ws-stats" style="grid-template-columns:repeat(auto-fill,minmax(120px,1fr))">
        <div class="ws-stat"><b>${kNum(ig.followers)}</b><span>Followers</span></div><div class="ws-stat"><b>${kNum(ig.follows)}</b><span>Following</span></div>
        <div class="ws-stat"><b>${kNum(ig.media_count)}</b><span>Posts</span></div><div class="ws-stat"><b>${eng!=null?eng+"%":"—"}</b><span>Engagement</span></div>
        <div class="ws-stat"><b>${ig.avg_reach!=null?kNum(Math.round(ig.avg_reach)):"—"}</b><span>Avg reach</span></div></div>
      <div class="card" style="margin-top:12px">${r("Account", `<a href="https://instagram.com/${encodeURIComponent(ig.username)}" target="_blank" rel="noopener">@${esc(ig.username)}</a> ${ig.account_type?`<span class="tag">${esc(String(ig.account_type).replace(/_/g," ").toLowerCase())}</span>`:""}`)}
        ${r("Bio", esc(ig.biography||""))}${ig.website?r("Website", `<a href="${esc(safeUrl(ig.website))}" target="_blank" rel="noopener">${esc(ig.website)}</a>`):""}
        ${r("Connected", esc(fmtDateTime(ig.connected_at)))}${r("Last synced", agoTxt(ig.synced_at))}</div>
      <div class="ac360-media">${media.map(m=>`<a href="${esc(safeUrl(m.permalink||"#"))}" target="_blank" rel="noopener" class="ac360-post">${m.img?`<img src="${esc(safeUrl(m.img))}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">`:""}
          <span>❤ ${kNum(m.likes||0)} · 💬 ${kNum(m.comments||0)}</span></a>`).join("")||'<div class="muted">No recent posts synced.</div>'}</div>`,
    campaigns: `<div class="card">${camps.length||mk.length ? `<div class="list">${camps.map(c=>`<div class="row"><div class="r-main">
          <div class="r-title">${esc(c.campaign||"Campaign")} ${typeTag(c.campaign_type)}</div>
          <div class="r-sub">${esc([c.brand,c.org_name].filter(Boolean).join(" · "))}${c.applied_profile?` · as <b>@${esc(c.applied_profile)}</b>`:""} · applied ${esc(fmtDate(c.applied_at))}${c.starts_on?` · runs ${esc(fmtDate(c.starts_on))} – ${esc(fmtDate(c.ends_on))}`:""}${c.reason?` · <i>${esc(c.reason)}</i>`:""}</div></div>
          ${stageTag(c.stage)}</div>`).join("")}
        ${mk.map(a=>`<div class="row"><div class="r-main"><div class="r-title">${esc(a.campaign_name||a.campaign||"Marketplace campaign")}</div><div class="r-sub">Marketplace · applied ${esc(fmtDate(a.applied_at))}</div></div><span class="tag ${a.status==="Approved"?"good":a.status==="Rejected"?"":"warn"}">${esc(a.status||"Applied")}</span></div>`).join("")}</div>
        <div style="margin-top:10px"><button class="mini-btn ghost" id="acGoApps">Open Applications tab →</button></div>`
        : `<div class="muted">No campaign applications yet.</div>`}</div>`,
    activity: `<div class="ws-stats" style="grid-template-columns:repeat(auto-fill,minmax(140px,1fr))">
        <div class="ws-stat"><b>${esc(fmtDate(mem.joined_at))}</b><span>Joined</span></div><div class="ws-stat"><b>${agoTxt(mem.last_sign_in_at)}</b><span>Last sign-in</span></div>
        <div class="ws-stat"><b>${fmtNum(mem.logins||0)}</b><span>Logins</span></div><div class="ws-stat"><b>${agoTxt(mem.last_seen)}</b><span>Last seen</span></div>
        <div class="ws-stat"><b>${esc(mem.consent||"—")}</b><span>Cookies</span></div><div class="ws-stat"><b>${esc(mem.last_city||"—")}</b><span>Last location</span></div></div>
      <div id="ac360Tl" style="margin-top:12px">${skel("list",3)}</div>` };
  const paint = ()=>{
    bodyEl.innerHTML = `<div class="ac360-head">${pic}<div style="min-width:0;flex:1"><h3>${esc(name)}</h3>
        <div class="muted">${ig.username?`<a href="https://instagram.com/${encodeURIComponent(ig.username)}" target="_blank" rel="noopener">@${esc(ig.username)}</a> · ${kNum(ig.followers)} followers · `:""}${esc(mem.status||"")} · joined ${esc(fmtDate(mem.joined_at))}</div>
        <div class="ac360-prog">${D.identity_id?(req.complete?'<span class="tag good">✅ Profile complete — campaign ready</span>':`<span class="tag warn">Profile ${req.done??0}/${req.total??"?"}</span>`):'<span class="tag warn">No profile yet</span>'}
          ${wa?`<a class="mini-btn ghost" href="https://wa.me/${esc(wa.replace(/\D/g,""))}" target="_blank" rel="noopener">💬 WhatsApp</a>`:""}${!synthetic&&con.email?`<a class="mini-btn ghost" href="mailto:${esc(con.email)}">✉️ Email</a>`:""}</div></div>
        <button class="ci-pop-x" id="acX" aria-label="Close">✕</button></div>
      <div class="admin-tabs ac360-tabs">${tabs.map(t=>`<button class="${_ac360Tab===t[0]?"act":""}" data-ac360="${t[0]}">${t[1]}</button>`).join("")}</div>
      <div class="ac360-sec">${sections[_ac360Tab]}</div>
      <div class="muted" style="font-size:11px;margin-top:12px">Private data — this view is recorded in the audit log.</div>`;
    bodyEl.querySelector("#acX").onclick = close;
    bodyEl.querySelectorAll("[data-ac360]").forEach(b=> b.onclick = ()=>{ _ac360Tab = b.dataset.ac360; paint(); });
    const ga = bodyEl.querySelector("#acGoApps"); if(ga) ga.onclick = ()=>{ close(); _adminTab = "applications"; currentPage = "admin"; renderShell(); };
    if(_ac360Tab==="activity") adminActivityTimeline(member, { name }, bodyEl.querySelector("#ac360Tl"));
  };
  paint();
}

// Super Admin → WhatsApp & email: is every alert actually reaching people? (outbox health, reasons, retry, test)
let _dlvTimer = null;
// The one WhatsApp template that carries every campaign update (any campaign, any step). Meta allows free text
// only within 24 h of the creator's last message, so without an approved template WhatsApp updates are held.
const WA_UPD_NAME = "geek_campaign_update";
const WA_UPD_BODY = "Hello {{1}},\n\nThere is a new update on your campaign with Geek:\n{{2}}\n\nPlease view the details and your next step here: {{3}}\n\nRegards,\nTeam Geek";
const WA_UPD_FOOT = "Reply STOP to stop WhatsApp updates";
async function adminWaSettingsCard(){
  const box = document.getElementById("dlvWaSet"); if(!box) return;
  const { data, error } = await sb.rpc("admin_wa_settings").then(r=>r, e=>({error:e}));
  if(error){ box.innerHTML = `<h3 style="margin-top:0">WhatsApp updates</h3><div class="muted">${esc(error.message||error)} — run <code>supabase db push</code> first.</div>`; return; }
  const d = data||{}, on = true;
  if(!d.template){ d.template = WA_UPD_NAME; d.__default = true; }
  box.innerHTML = `<h3 style="margin-top:0">${on?"✅":"⚠️"} WhatsApp campaign updates ${on?`<span class="tag good">on · ${esc(d.template)}</span>`:`<span class="tag warn">not set — WhatsApp updates are held</span>`}</h3>
    <p class="muted" style="font-size:13px;margin:0 0 10px">WhatsApp only allows free text within 24 hours of the creator's last message. Every other update needs <b>one approved Utility template</b> — the same one carries every campaign and every step (contract, courier, brief, video, approval…).
      ${d.held?` <b style="color:#b45309">${esc(d.held)} update(s) are waiting</b> and go out the moment you save an approved template.`:""}</p>
    <div class="wa-health" style="font-size:13px;margin:0 0 10px;padding:8px 10px;border:1px solid var(--line);border-radius:10px"><span>Last 3 days on WhatsApp:</span> <b style="color:#12b76a">${esc(d.sent||0)} sent</b> · <b${d.failed?' style="color:#dc2626"':''}>${esc(d.failed||0)} failed</b> · <b>${esc(d.held||0)} waiting</b>
      ${d.last_error?`<div style="margin-top:6px;color:#b45309;word-break:break-word"><b>Latest problem:</b> ${esc(d.last_error)}</div>`:""}</div>
    <div class="wa-steps">
      <div><b>1.</b> In <b>snapto</b> → Templates → New: category <b>Utility</b>, language <b>English</b>, name <code>${WA_UPD_NAME}</code> <button class="mini-btn ghost" data-wacopy="${WA_UPD_NAME}">⧉</button></div>
      <div><b>2.</b> Body <button class="mini-btn ghost" data-wacopy="${esc(WA_UPD_BODY)}">Copy body</button> · Footer <button class="mini-btn ghost" data-wacopy="${esc(WA_UPD_FOOT)}">Copy footer</button>
        <pre class="wa-pre">${esc(WA_UPD_BODY)}\n— ${esc(WA_UPD_FOOT)}</pre>
        <span class="muted" style="font-size:12px">Sample values for Meta: {{1}} Asha · {{2}} Your contract is ready — please sign it in the app · {{3}} ${esc(window.appOrigin())}/app.html</span></div>
      <div><b>3.</b> Once snapto shows it <b>Approved</b>, put the name here and save:</div></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px">
      <input id="waTplName" value="${esc(d.template||"")}" placeholder="${WA_UPD_NAME}" style="padding:8px 10px;border-radius:9px;border:1px solid var(--line);background:var(--panel);color:inherit;min-width:240px">
      <select id="waTplLang" style="padding:8px 10px;border-radius:9px;border:1px solid var(--line);background:var(--panel);color:inherit">
        ${[["en","English (en)"],["en_US","English US (en_US)"],["en_GB","English UK (en_GB)"],["hi","Hindi (hi)"]].map(([v,l])=>`<option value="${v}"${(d.lang||"en")===v?" selected":""}>${l}</option>`).join("")}</select>
      <button class="mini-btn" id="waTplSave">Save &amp; send held updates</button>
      ${on?`<button class="mini-btn ghost" id="waTplOff">Turn off</button>`:""}
      <span class="muted" id="waTplMsg" style="font-size:12px"></span></div>
    <div class="muted" style="font-size:12px;margin-top:10px">Then use <b>Send test</b> below with your own WhatsApp number to check it arrives.
      ${d.no_number?` · ${esc(d.no_number)} recent people have no WhatsApp number on their account (they get app + email only).`:""}
      ${d.opted_out?` · ${esc(d.opted_out)} people replied STOP.`:""}</div>`;
  // which domain the links in WhatsApp / email open (APP_URL — never hard-coded)
  sb.rpc("admin_links_status").then(({data:ls})=>{
    if(!box.isConnected || !ls) return;
    const dom = ls.links_domain || ls.app_url, src = ls.links_source==="secret" ? "APP_URL secret on Supabase" : ls.links_source==="vercel" ? "APP_URL on Vercel" : "";
    box.insertAdjacentHTML("afterbegin", dom
      ? `<div class="muted" style="font-size:12.5px;margin-bottom:8px">🔗 Links in WhatsApp &amp; email open <b>${esc(dom)}</b>${src?` <span>(from ${esc(src)})</span>`:""}</div>`
      : `<div style="font-size:12.5px;margin-bottom:8px;color:#b45309">⚠️ Links in WhatsApp &amp; email have no domain yet — set <b>APP_URL</b> in Vercel → Settings → Environment Variables (e.g. https://app.yourdomain.com), redeploy, and open this page once.</div>`);
  }, ()=>{});
  box.querySelectorAll("[data-wacopy]").forEach(b=> b.onclick = async ()=>{ try{ await navigator.clipboard.writeText(b.dataset.wacopy); const t=b.textContent; b.textContent="✓ copied"; setTimeout(()=>b.textContent=t,1200); }catch(e){ prompt("Copy:", b.dataset.wacopy); } });
  const save = async (name)=>{ const msg = document.getElementById("waTplMsg");
    const { data:r, error:e } = await sb.rpc("admin_set_wa_settings", { p_template: name, p_lang: document.getElementById("waTplLang").value });
    if(e){ msg.textContent = e.message; return; }
    msg.textContent = name ? `Saved ✓ — ${r&&r.requeued||0} held update(s) sending now` : "Turned off";
    setTimeout(()=>{ adminWaSettingsCard(); const b=document.getElementById("adminBody"); if(b) adminDelivery(b,true); }, 2500); };
  document.getElementById("waTplSave").onclick = ()=>{ const v = document.getElementById("waTplName").value.trim();
    if(!v){ document.getElementById("waTplMsg").textContent = "Type the approved template name first."; return; } save(v); };
  const off = document.getElementById("waTplOff"); if(off) off.onclick = ()=>{ if(confirm("Stop sending WhatsApp updates outside the 24-hour window?")) save(null); };
}
// One WhatsApp UTILITY template per campaign (created by wa-template-sync). Updates for a campaign go out on
// its template once approved; held messages are re-sent automatically then.
// who got what in the last 7 days, and exactly why not
async function adminDeliveryDoctor(){
  const box = document.getElementById("dlvDoctor"); if(!box) return;
  const { data, error } = await sb.rpc("admin_delivery_doctor").then(r=>r, e=>({error:e}));
  if(error){ box.innerHTML = `<h3 style="margin-top:0">Delivery doctor</h3><div class="muted">${esc(error.message||error)} — run <code>supabase db push</code> first.</div>`; return; }
  const L = data||[];
  const why = (c, x, kind)=>{
    const o = x||{}, any = (o.sent||0)+(o.held||0)+(o.failed||0)+(o.queued||0);
    if(kind==="wa"){
      if(c.wa_off) return `<span class="tag warn">replied STOP</span>`;
      if(!c.wa_number) return `<span class="tag warn">no WhatsApp number</span><div class="muted dd-why">Signed up without WhatsApp — ask them to link WhatsApp (Messages → Link WhatsApp)</div>`;
    } else {
      if(c.email_off) return `<span class="tag warn">unsubscribed</span>`;
      if(!any) return `<span class="tag warn">no email</span><div class="muted dd-why">No real email on the account — the backup email in their profile fixes it</div>`;
    }
    const parts = [];
    if(o.sent) parts.push(`<span class="tag good">✓ ${o.sent} sent</span>`);
    if(o.queued) parts.push(`<span class="tag">… ${o.queued} sending</span>`);
    if(o.held) parts.push(`<span class="tag warn">⏸ ${o.held} waiting</span>`);
    if(o.failed) parts.push(`<span class="tag" style="background:rgba(239,68,68,.12);color:#dc2626">✗ ${o.failed} failed</span>`);
    return (parts.join(" ")||'<span class="muted">—</span>') + (o.error && !o.sent ? `<div class="muted dd-why">${esc(String(o.error).slice(0,160))}</div>` : "");
  };
  box.innerHTML = `<h3 style="margin-top:0">🩺 Delivery doctor <span class="muted" style="font-size:12px;font-weight:400">— last 7 days, everyone who had an update</span></h3>
    ${L.length ? `<div style="overflow-x:auto"><table class="tbl dd-tbl"><thead><tr><th>Who</th><th>Updates</th><th>WhatsApp</th><th>Email</th></tr></thead><tbody>
      ${L.map(c=>`<tr><td><b>${esc(c.who||"—")}</b><div class="muted" style="font-size:12px">${esc(c.role||"")}${c.wa_number?` · ${esc(c.wa_number)}`:""}</div></td>
        <td>${esc(c.alerts)}</td><td>${why(c, c.wa, "wa")}</td><td>${why(c, c.email, "email")}${c.email&&c.email.to?`<div class="muted" style="font-size:11.5px">${esc(c.email.to)}</div>`:""}</td></tr>`).join("")}
    </tbody></table></div>` : `<div class="muted">No updates in the last 7 days.</div>`}`;
}
async function adminWaTemplates(){
  const box = document.getElementById("dlvTpl"); if(!box) return;
  const { data, error } = await sb.rpc("admin_wa_templates").then(r=>r, e=>({error:e}));
  if(error){ box.innerHTML = `<h3 style="margin-top:0">WhatsApp templates</h3><div class="muted">${esc(error.message||error)}</div>`; return; }
  const L = data||[];
  const ms = await sb.rpc("admin_wa_template_status").then(r=>r.data||{}, ()=>({}));
  const auto = ms.mode==="meta";
  const modeBox = `<div class="wa-auto ${auto?"ok":"warn"}">
    ${auto ? `<b>✅ Automatic</b> — every new campaign gets its own WhatsApp template, sent to Meta for approval on its own. Messages for a campaign go on that campaign's template once approved (until then on <code>${WA_UPD_NAME}</code>).`
      : ms.mode==="meta_error" ? `<b>⚠️ Meta connection not working:</b> ${esc(ms.error||"")}`
      : `<b>⚙️ Templates are not being created automatically yet.</b> snapto has no API for creating templates, so we create them straight in your Meta WhatsApp account (the same one snapto uses). Connect it once:`}
    ${auto ? "" : `<ol class="wa-auto-steps">
      <li><b>WhatsApp Business Account ID</b>: business.facebook.com → <b>WhatsApp Manager</b> → account overview → copy the <i>WhatsApp Business Account ID</i>.</li>
      <li><b>Permanent token</b>: Business Settings → Users → <b>System users</b> → Add (Admin) → <b>Assign assets</b> → your WhatsApp account (full control) → <b>Generate token</b> → never expires → tick <code>whatsapp_business_management</code> + <code>whatsapp_business_messaging</code> → copy.</li>
      <li>Run in Terminal (put your two values in):<pre class="wa-pre" id="waAutoCmd">cd "/Users/bhargavsinha/Documents/new site/app" && supabase secrets set WHATSAPP_WABA_ID=PASTE_ACCOUNT_ID WHATSAPP_TEMPLATE_TOKEN=PASTE_TOKEN && supabase functions deploy wa-template-sync</pre>
        <button class="mini-btn ghost" id="waAutoCopy">Copy command</button></li>
      <li>Press <b>Check now</b> — the status turns ✅ and every campaign's template is sent to Meta.</li></ol>`}
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px"><button class="mini-btn" id="waAutoCheck">Check now</button>
      <span class="muted" style="font-size:12px">${ms.at?`Last checked ${esc(new Date(ms.at).toLocaleString())}`:"Not checked yet"} · ${Object.entries(ms.counts||{}).map(([k,v])=>`${esc(v)} ${esc(k)}`).join(" · ")||"no templates yet"}</span></div></div>`;
  const tag = st=> ({approved:'<span class="tag good">approved</span>', submitted:'<span class="tag warn">with Meta</span>', queued:'<span class="tag warn">queued</span>',
    manual:'<span class="tag warn">create in snapto</span>', failed:'<span class="tag" style="background:rgba(239,68,68,.12);color:#dc2626">failed</span>',
    rejected:'<span class="tag" style="background:rgba(239,68,68,.12);color:#dc2626">rejected</span>'})[st]||esc(st);
  box.innerHTML = `<h3 style="margin-top:0">WhatsApp templates · one per campaign <span class="muted" style="font-size:12px;font-weight:400">· category Utility · footer “Reply STOP…”</span></h3>
    <p class="muted" style="font-size:12.5px;margin:0 0 10px">One per campaign, written from the campaign's name and brand, made the moment a campaign is created. Each creator gets their campaign's updates on that campaign's template once approved — held messages then go out on their own.</p>
    <div class="wa-auto ok" style="margin-bottom:10px">💌 <b>Every campaign invite</b> (Invite creators, bulk upload, Instagram-handle invites — by Super Admin, agency or brand) goes on <code>geek_campaign_access</code>: name · campaign · brand · app link. <b>Every step update</b> has its own UTILITY template — <code>geek_step_contract</code>, <code>geek_step_address</code>, <code>geek_step_shipped</code>, <code>geek_step_brief</code>, <code>geek_step_video_due</code>, <code>geek_step_video_overdue</code>, <code>geek_step_on_hold</code>, <code>geek_step_changes</code>, <code>geek_step_approved</code>, <code>geek_step_caption</code>, <code>geek_step_feedback</code>, <code>geek_step_completed</code> and <code>geek_team_update</code> for the team (“Hi … Thank you for … Next, please … Once that is done, we will …”) — the same words go by email. While a template waits for Meta, <code>${WA_UPD_NAME}</code> is the automatic backup.</div>
    ${modeBox}
    ${L.length?`<div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Campaign</th><th>Template name</th><th>Text</th><th>Status</th><th></th></tr></thead><tbody>
    ${L.map(t=>`<tr><td><b>${esc(t.campaign||"")}</b><div class="muted" style="font-size:12px">${esc(t.brand||"")}</div></td>
      <td style="font-size:12px"><code>${esc(t.template_name)}</code> <button class="mini-btn ghost" data-tplcopy="${esc(t.template_name)}" title="Copy name">⧉</button></td>
      <td style="font-size:12px;max-width:340px;white-space:pre-wrap">${esc(t.body)}<div class="muted">Footer: ${esc(t.footer)}</div>
        <button class="mini-btn ghost" data-tplcopy="${esc(t.body)}" style="margin-top:4px">Copy text</button></td>
      <td>${tag(t.status)}${t.error?`<div class="muted" style="font-size:11.5px;max-width:220px">${esc(t.error)}</div>`:""}</td>
      <td style="white-space:nowrap">${t.status!=="approved"?`<button class="mini-btn" data-tplok="${esc(t.campaign_id)}">Mark approved</button> `:""}<button class="mini-btn ghost" data-tplretry="${esc(t.campaign_id)}">Resubmit</button></td></tr>`).join("")}
    </tbody></table></div>`:`<div class="muted">No campaign templates yet — one is made with every new campaign.</div>`}`;
  const ac = document.getElementById("waAutoCheck"); if(ac) ac.onclick = async ()=>{ ac.disabled = true; ac.textContent = "Checking…";
    const { error:e } = await sb.rpc("admin_wa_templates_check"); if(e){ alert(e.message); ac.disabled=false; ac.textContent="Check now"; return; }
    setTimeout(adminWaTemplates, 6000); };
  const acp = document.getElementById("waAutoCopy"); if(acp) acp.onclick = async ()=>{ try{ await navigator.clipboard.writeText(document.getElementById("waAutoCmd").textContent); acp.textContent="✓ copied"; }catch(e){} };
  box.querySelectorAll("[data-tplcopy]").forEach(b=> b.onclick = async ()=>{ try{ await navigator.clipboard.writeText(b.dataset.tplcopy); b.textContent="✓"; }catch(e){ prompt("Copy:", b.dataset.tplcopy); } });
  const set = async (id, st)=>{ const { error:e } = await sb.rpc("admin_wa_template_set", { p_campaign:id, p_status:st }); if(e) alert(e.message); adminWaTemplates(); };
  box.querySelectorAll("[data-tplok]").forEach(b=> b.onclick = ()=>{ if(confirm("Only mark it approved once snapto / Meta shows this exact template as Approved. Held WhatsApp updates will go out on it.")) set(b.dataset.tplok, "approved"); });
  box.querySelectorAll("[data-tplretry]").forEach(b=> b.onclick = ()=> set(b.dataset.tplretry, "queued"));
}
async function adminDelivery(body, silent){
  if(!silent) body.innerHTML = skel("table",6);
  const { data, error } = await sb.rpc("admin_delivery");
  if(error){ if(!silent) body.innerHTML = adminErr(error); return; }
  const d = data||{}, st = d.stats||{}, n = k=> Number(st[k]||0);
  const ago = t=>{ if(!t) return "never"; const m=Math.round((Date.now()-new Date(t).getTime())/60000); return m<1?"just now":m<60?m+"m ago":m<1440?Math.round(m/60)+"h ago":Math.round(m/1440)+"d ago"; };
  const jobs = d.jobs||[], runs = d.runs||[], recent = d.recent||[];
  const waWaiting = recent.filter(r=>r.channel==="whatsapp" && r.status==="skipped" && /^(Waiting for WhatsApp template approval|WhatsApp 24h window closed)/i.test(r.error||"")).length;
  const waSkippedNoTpl = recent.filter(r=>r.channel==="whatsapp" && r.status==="skipped" && /WA_UPDATE_TEMPLATE/i.test(r.error||"")).length;
  const stuck = d.oldest_queued && (Date.now()-new Date(d.oldest_queued).getTime()) > 5*60000;
  const checks = [
    [d.worker_configured, "Dispatcher connected", d.worker_configured ? "Database can trigger sends instantly" : "Run the one-time connect command (see below) after deploying ops-notify-dispatch"],
    [jobs.some(j=>j.name==="ci-notify-dispatch" && j.active), "Every-minute safety run", jobs.length ? jobs.map(j=>`${j.name} (${j.schedule})`).join(", ") : "pg_cron schedule not found"],
    [!stuck, "Queue moving", stuck ? `Oldest queued message waiting since ${ago(d.oldest_queued)}` : "No messages stuck in the queue"],
    [n("whatsapp:sent")>0 && !waSkippedNoTpl && !waWaiting, waWaiting ? "⏳ WhatsApp waiting for template approval" : "WhatsApp delivering",
      waWaiting ? `${waWaiting} WhatsApp alert(s) are parked until Meta approves the template — they will send automatically (checked every 10 min)`
      : waSkippedNoTpl ? `${waSkippedNoTpl} recent WhatsApp alert(s) skipped — WhatsApp template not set (WA_UPDATE_TEMPLATE)`
      : n("whatsapp:sent") ? `Last sent ${ago(d.last_sent&&d.last_sent.whatsapp)}` : "Nothing sent on WhatsApp yet"],
    [n("email:sent")>0 && !n("email:failed"), "Email delivering", n("email:failed") ? `${n("email:failed")} failed in 7 days — check SMTP secrets` : n("email:sent") ? `Last sent ${ago(d.last_sent&&d.last_sent.email)}` : "Nothing sent by email yet"]];
  const tag = s=> ({sent:'<span class="tag good">sent</span>', queued:'<span class="tag warn">queued</span>', sending:'<span class="tag warn">sending</span>', failed:'<span class="tag bad" style="background:rgba(239,68,68,.12);color:#dc2626">failed</span>', skipped:'<span class="tag">skipped</span>', waiting:'<span class="tag warn">⏳ waiting</span>'})[s] || esc(s);
  body.innerHTML = `
    <div class="rp-kpis">
      <div><b>${n("whatsapp:sent")}</b>WhatsApp sent · 7d</div><div><b>${n("whatsapp:skipped")+n("whatsapp:failed")}</b>WhatsApp not sent</div>
      <div><b>${n("email:sent")}</b>Emails sent · 7d</div><div><b>${n("email:failed")+n("email:skipped")}</b>Emails not sent</div>
      <div><b>${n("whatsapp:queued")+n("email:queued")+n("whatsapp:sending")+n("email:sending")}</b>In queue</div></div>
    <div class="card wa-set" id="dlvWaSet"></div>
    <div class="card" id="dlvDoctor" style="margin-top:12px"></div>
    <div class="card"><h3 style="margin-top:0">Health</h3><div class="list">${checks.map(([ok,t,s])=>`<div class="row"><span class="dot ${ok?"good":"warn"}"></span>
        <div class="r-main"><div class="r-title">${ok?"✅":"⚠️"} ${esc(t)}</div><div class="r-sub">${esc(s)}</div></div></div>`).join("")}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
        <button class="mini-btn" id="dlvRetry">↻ Retry skipped / failed (3 days)</button>
        <input id="dlvPhone" placeholder="+91… WhatsApp" style="padding:7px 10px;border-radius:9px;border:1px solid var(--line);background:var(--panel);color:inherit;min-width:150px">
        <input id="dlvEmail" placeholder="email" style="padding:7px 10px;border-radius:9px;border:1px solid var(--line);background:var(--panel);color:inherit;min-width:170px">
        <button class="mini-btn ghost" id="dlvTest">Send test</button><span class="muted" id="dlvMsg" style="font-size:12px;align-self:center"></span></div>
      ${runs.length?`<div class="muted" style="font-size:12px;margin-top:10px">Last runs: ${runs.slice(0,3).map(r=>`${esc(r.job)} ${esc(r.status)} ${ago(r.at)}`).join(" · ")}</div>`:""}</div>
    <div class="card" style="margin-top:14px"><h3 style="margin-top:0">Latest messages <span class="muted" style="font-size:12px;font-weight:400">· every alert goes in-app + WhatsApp + email</span></h3>
      <div style="overflow-x:auto"><table class="tbl"><thead><tr><th>When</th><th>Channel</th><th>To</th><th>Alert</th><th>Status</th><th>Why / note</th></tr></thead><tbody>
      ${recent.map(r=>`<tr><td style="white-space:nowrap;font-size:12px">${esc(fmtDateTime(r.created_at))}</td><td>${r.channel==="whatsapp"?"💬 WhatsApp":"✉️ Email"}</td>
        <td style="font-size:12px"><b>${esc(r.who||"—")}</b>${r.role?` <span class="muted">${esc(r.role)}</span>`:""}<div class="muted">${esc(r.to)}</div></td>
        <td style="font-size:12px;max-width:280px">${esc(r.title||r.template||"")}</td><td>${tag(r.status==="skipped" && /^(Waiting for WhatsApp template approval|WhatsApp 24h window closed)/i.test(r.error||"") ? "waiting" : r.status)}${r.attempts>1?` <span class="muted" style="font-size:11px">×${r.attempts}</span>`:""}</td>
        <td style="font-size:12px;max-width:260px" class="muted">${esc(r.error||(r.sent_at?"Sent "+ago(r.sent_at):""))}</td></tr>`).join("")||`<tr><td colspan="6" class="muted">No messages yet.</td></tr>`}
      </tbody></table></div></div>
    <div class="card" style="margin-top:14px" id="dlvTpl"></div>`;
  adminWaTemplates(); adminWaSettingsCard(); adminDeliveryDoctor();
  document.getElementById("dlvRetry").onclick = async ()=>{ const { data:k, error:e } = await sb.rpc("admin_delivery_retry", { p_channel: null });
    document.getElementById("dlvMsg").textContent = e ? e.message : `${k||0} message(s) re-queued`; setTimeout(()=>adminDelivery(body,true), 3000); };
  document.getElementById("dlvTest").onclick = async ()=>{ const { data:k, error:e } = await sb.rpc("admin_delivery_test", { p_phone: document.getElementById("dlvPhone").value.trim()||null, p_email: document.getElementById("dlvEmail").value.trim()||null });
    document.getElementById("dlvMsg").textContent = e ? e.message : `${k} test message(s) queued — status updates below`; setTimeout(()=>adminDelivery(body,true), 4000); };
  clearInterval(_dlvTimer);
  _dlvTimer = setInterval(()=>{ const b = document.getElementById("adminBody");
    if(currentPage!=="admin" || _adminTab!=="delivery" || !b){ clearInterval(_dlvTimer); return; }
    if(document.visibilityState!=="visible" || ["dlvPhone","dlvEmail"].includes(document.activeElement?.id)) return;
    adminDelivery(b, true); }, 20000);
}

// Super Admin → Creator activity: who is on the platform, from where, for how long, doing what.
async function adminActivity(body){
  body.innerHTML = `<div class="card"><div class="muted">Loading activity…</div></div>`;
  const { data, error } = await sb.rpc("admin_activity_summary", { p_days: 30 });
  if(error){ body.innerHTML = `<div class="card"><div class="muted">Couldn't load: ${esc(error.message)}</div></div>`; return; }
  const rows = data || [];
  const ago = t=>{ if(!t) return "—"; const m=Math.round((Date.now()-new Date(t).getTime())/60000); return m<1?"just now":m<60?m+"m ago":m<1440?Math.round(m/60)+"h ago":Math.round(m/1440)+"d ago"; };
  body.innerHTML = `<div class="card"><h3>Creator activity · last 30 days</h3>
    <p class="muted" style="font-size:12px;margin-bottom:10px">Security events (sign-ins, Instagram connect, publish, apply) are always logged. Pages &amp; time spent appear only for people who accepted analytics cookies. Locations are approximate (from IP).</p>
    ${rows.length ? `<div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Person</th><th>Role</th><th>Last seen</th><th>Sessions</th><th>Time</th><th>Page views</th><th>Last IP</th><th>Location</th><th>Consent</th><th>Last action</th><th></th></tr></thead><tbody>
      ${rows.map(r=>`<tr><td><b>${esc(r.name||r.email||"—")}</b>${r.ig_username?`<div class="muted" style="font-size:12px">@${esc(r.ig_username)}</div>`:""}</td>
        <td>${esc(r.role||"—")}</td><td>${ago(r.last_seen)}</td><td>${r.sessions||0}</td><td>${r.minutes||0} min</td><td>${r.page_views||0}</td>
        <td><code>${esc(r.last_ip||"—")}</code></td><td>${esc([r.last_city,r.last_region,r.last_country].filter(Boolean).join(", ")||"—")}</td>
        <td>${r.consent==="all"?'<span class="tag good">all</span>':r.consent==="essential"?'<span class="tag warn">essential</span>':'—'}</td>
        <td>${esc(r.last_event||"—")}</td><td><button class="mini-btn" data-acttl="${esc(r.member_id)}">Timeline</button></td></tr>`).join("")}
    </tbody></table></div>` : `<div class="muted" style="padding:8px">No activity yet.</div>`}</div><div id="actTimeline"></div>`;
  body.querySelectorAll("[data-acttl]").forEach(b=> b.onclick = ()=> adminActivityTimeline(b.dataset.acttl, rows.find(r=>r.member_id===b.dataset.acttl)));
}
async function adminActivityTimeline(member, row, target){
  const box = target || document.getElementById("actTimeline"); if(!box) return;
  box.innerHTML = `<div class="card"><div class="muted">Loading timeline…</div></div>`;
  const { data, error } = await sb.rpc("admin_activity_timeline", { p_member: member, p_limit: 300 });
  if(error){ box.innerHTML = `<div class="card"><div class="muted">${esc(error.message)}</div></div>`; return; }
  const fmt = t=> new Date(t).toLocaleString("en-IN",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit",second:"2-digit"});
  box.innerHTML = `<div class="card"><h3>Timeline — ${esc((row&&(row.name||row.email))||"")}</h3><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>When</th><th>Type</th><th>Event</th><th>Page</th><th>Details</th><th>IP</th><th>Location</th><th>Device</th></tr></thead><tbody>
    ${(data||[]).map(e=>`<tr><td>${fmt(e.created_at)}</td><td>${esc(e.kind)}</td><td><b>${esc(e.event)}</b>${e.duration_ms?` <span class="muted">${Math.round(e.duration_ms/1000)}s</span>`:""}</td><td>${esc(e.page||"")}</td>
      <td style="max-width:260px;font-size:12px">${esc(JSON.stringify(e.detail||{})==="{}"?"":JSON.stringify(e.detail))}</td><td><code>${esc(e.ip||"")}</code></td>
      <td>${esc([e.city,e.region,e.country].filter(Boolean).join(", "))}</td><td style="max-width:200px;font-size:11px" class="muted">${esc((e.user_agent||"").slice(0,90))}</td></tr>`).join("")}
  </tbody></table></div></div>`;
  if(!target) box.scrollIntoView({behavior:"smooth"});
}

function renderAdmin(){
  let html = pageHead("Super Admin","Full cross-workspace control — every record, every change, with timestamps.");
  html += `<div class="admin-tabs">${ADMIN_TABS.map(t=>`<button class="${_adminTab===t[0]?'act':''}" data-atab="${t[0]}">${esc(t[1])}</button>`).join("")}</div>`;
  html += `<div id="adminBody">${skel("table")}</div>`;
  return html;
}

function loadAdmin(){
  document.querySelectorAll("[data-atab]").forEach(b=> b.onclick = ()=>{ _adminTab = b.dataset.atab; currentPage="admin"; renderShell(); });
  const body = document.getElementById("adminBody");
  if(!body || !window.sb) return;
  ({ overview:adminOverview, creators:adminCreators, users:adminUsers, campaigns:adminCampaigns, applications:adminApplications, delivery:adminDelivery, activity:adminActivity, orgs:adminOrgs, data:adminData, audit:adminAudit, check:adminSystemCheck, approvals:adminApprovals, admins:adminAdmins }[_adminTab] || adminOverview)(body);
}

/* System check — live-verifies the deployed database matches the code (tables, columns, RPCs).
   Turns "random breaks" into an exact list of what's missing / what SQL to re-run. */
const SYS_TABLES = ["members","creators","campaigns","barter_items","applications","invites","irm_contacts",
  "story_deals","dream_plans","org_profiles","social_accounts","audit_log","platform_admins","leads"];
const SYS_COLUMNS = [ // feature-critical columns added in later passes
  ["creators","whatsapp"],["creators","invite_status"],["creators","lat"],
  ["campaigns","deliverables"],["campaigns","deliverables_done"],["campaigns","budget"],
  ["barter_items","tracking_number"],["barter_items","deadline"],
  ["invites","token"],["members","status"],["irm_contacts","whatsapp"],["org_profiles","slug"]
];
const SYS_RPCS = [
  ["is_platform_admin",{}],["open_campaigns",{}],["my_applications",{}],["campaign_applications",{}],
  ["public_profile",{p_username:"__healthcheck__"}],["public_org",{p_slug:"__healthcheck__"}],
  ["pending_members",{}],["admin_overview",{}],["admin_list_orgs",{}],
  ["admin_list_table",{p_table:"creators",p_limit:1,p_offset:0}],["admin_audit",{p_limit:1,p_offset:0}],
  ["admin_list_platform_admins",{}]
];
const MISSING_RE = /does not exist|schema cache|could not find|not find the function|relation .* does not/i;

async function adminSystemCheck(body){
  body.innerHTML = `<div class="card"><h3>System check</h3>
    <p class="muted" style="margin-bottom:12px">Live-verifies that your deployed Supabase matches the app — every table, key column and function. Run this after each DATABASE_SETUP.sql update; anything red means re-run the SQL.</p>
    <button class="btn" id="sysRun">Run checks</button>
    <div id="sysResult" style="margin-top:14px"></div></div>`;
  document.getElementById("sysRun").onclick = runSystemCheck;
  runSystemCheck();
}

async function runSystemCheck(){
  const out = document.getElementById("sysResult");
  if(!out) return;
  out.innerHTML = `<div class="muted" style="padding:8px">Running…</div>`;
  const checks = [];
  SYS_TABLES.forEach(t=> checks.push({ group:"Table", name:t, run: async()=>{
    const { error } = await sb.from(t).select("*", { count:"exact", head:true });
    return { ok: !(error && MISSING_RE.test(error.message)), detail: error? error.message : "" };
  }}));
  SYS_COLUMNS.forEach(([t,c])=> checks.push({ group:"Column", name:`${t}.${c}`, run: async()=>{
    const { error } = await sb.from(t).select(c).limit(1);
    return { ok: !(error && /column|does not exist/i.test(error.message)), detail: error? error.message : "" };
  }}));
  SYS_RPCS.forEach(([n,args])=> checks.push({ group:"Function", name:n+"()", run: async()=>{
    const { error } = await sb.rpc(n, args);
    return { ok: !(error && MISSING_RE.test(error.message)), detail: error? error.message : "" };
  }}));

  const results = [];
  for(const c of checks){
    try{ const r = await c.run(); results.push(Object.assign({}, c, r)); }
    catch(ex){ results.push(Object.assign({}, c, { ok:false, detail:String(ex.message||ex) })); }
  }
  const pass = results.filter(r=>r.ok).length, fail = results.length - pass;
  const badge = ok => ok ? `<span class="tag good">PASS</span>` : `<span class="tag" style="background:rgba(192,57,43,.14);color:var(--bad,#c0392b)">FAIL</span>`;
  out.innerHTML = `<div class="ws-stats" style="grid-template-columns:repeat(3,1fr);margin-bottom:14px">
      <div class="ws-stat"><b>${results.length}</b><span>Checks</span></div>
      <div class="ws-stat"><b style="color:var(--good)">${pass}</b><span>Passing</span></div>
      <div class="ws-stat"><b style="color:${fail?'var(--bad,#c0392b)':'var(--good)'}">${fail}</b><span>Failing</span></div></div>
    ${fail? `<div class="ai-suggest" style="margin-bottom:12px"><span class="spark">⚠️</span><div class="s-body"><b>${fail} item(s) not deployed</b><p>Re-run the latest <code>DATABASE_SETUP.sql</code> in Supabase → SQL Editor. Then run this check again — all rows should turn green.</p></div></div>` : `<div class="ai-suggest" style="margin-bottom:12px"><span class="spark">✅</span><div class="s-body"><b>All systems go</b><p>Your database is fully in sync with the app.</p></div></div>`}
    <div class="card" style="overflow-x:auto"><table><thead><tr><th>Type</th><th>Item</th><th>Status</th><th>Detail</th></tr></thead>
      <tbody>${results.map(r=>`<tr><td>${esc(r.group)}</td><td><code>${esc(r.name)}</code></td><td>${badge(r.ok)}</td>
        <td class="muted" style="font-size:12px">${esc((r.detail||"").slice(0,80))}</td></tr>`).join("")}</tbody></table></div>`;
}

let _ovTimer = null, _ovSig = "";
async function adminOverview(body, silent){
  if(!silent) body.innerHTML = skel("dash");
  const { data, error } = await sb.rpc("admin_dashboard");
  if(error){                                    // older database: fall back to the basic counters
    const o = (await sb.rpc("admin_overview")).data || {};
    const card = (v,l)=>`<div class="ws-stat"><b>${fmtNum(v)}</b><span>${l}</span></div>`;
    body.innerHTML = `<div class="ws-stats" style="grid-template-columns:repeat(4,1fr)">${card(o.orgs,"Workspaces")}${card(o.members,"Members")}${card(o.campaigns,"Campaigns")}${card(o.applications,"Applications")}</div>`;
    return;
  }
  const sig = JSON.stringify(data); if(silent && sig===_ovSig) return; _ovSig = sig;
  const d = data||{}, t = d.todo||{}, pe = d.people||{}, c = d.campaigns||{};
  const todo = [
    ["accounts_pending","🏢","Agency / brand accounts waiting for approval","approvals"],
    ["applications_pending","📝","Creator applications to approve or decline","applications"],
    ["campaigns_awaiting","📣","Campaigns waiting for approval","campaigns"],
    ["contracts_to_send","✍️","Approved creators — send contract","@campaignops"],
    ["content_to_review","🎬","Content submitted — review","@campaignops"],
    ["creators_incomplete","👤","Creators who haven't finished their profile","creators:incomplete"]];
  const open = todo.filter(x=>Number(t[x[0]])>0);
  const ago = s=>{ const m=Math.round((Date.now()-new Date(s).getTime())/60000); return m<1?"just now":m<60?m+"m ago":m<1440?Math.round(m/60)+"h ago":Math.round(m/1440)+"d ago"; };
  const EV = { login:"signed in", sign_out:"signed out", consent:"chose cookies", campaign_apply:"applied to a campaign", instagram_connect:"connected Instagram",
               profile_completed:"completed their profile", official_email_verified:"verified official email", campaign_create:"created a campaign",
               campaign_edit:"edited a campaign", application_approve:"approved an application", application_decline:"declined an application",
               publish:"published on Instagram", contract_sign:"signed a contract" };
  const stat = (v,l,tab)=>`<div class="ws-stat"${tab?` data-ovgo="${tab}" style="cursor:pointer"`:""}><b>${fmtNum(v)}</b><span>${l}</span></div>`;
  body.innerHTML = `
    <div class="card" style="margin-bottom:14px"><h3 style="margin-top:0">⚡ Needs your attention</h3>
      ${open.length ? `<div class="list">${open.map(([k,ic,l,tab])=>`<div class="row" data-ovgo="${tab}" style="cursor:pointer"><span class="dot warn"></span>
          <div class="r-main"><div class="r-title">${ic} ${esc(l)}</div></div><span class="tag warn">${fmtNum(t[k])}</span><button class="mini-btn">Open →</button></div>`).join("")}</div>`
        : `<div class="muted" style="padding:6px">All clear — nothing waiting on you right now ✅</div>`}</div>
    <div class="ci-sub">People</div>
    <div class="ws-stats" style="grid-template-columns:repeat(auto-fill,minmax(140px,1fr))">
      ${stat(pe.total,"Total users","users")}${stat(pe.creators,"Creators","creators")}${stat(pe.agencies,"Agencies","users")}${stat(pe.brands,"Brands","users")}
      ${stat(pe.instagram_connected,"Instagram connected","creators:ig")}${stat(pe.joined_today,"Joined today","users")}${stat(pe.signed_in_today,"Signed in today","activity")}</div>
    <div class="ci-sub" style="margin-top:14px">Campaigns</div>
    <div class="ws-stats" style="grid-template-columns:repeat(auto-fill,minmax(140px,1fr))">
      ${stat(c.total,"Campaigns","campaigns")}${stat(c.live,"Open now","campaigns")}${stat(c.paid,"💰 Paid","campaigns")}${stat(c.barter,"🎁 Barter","campaigns")}
      ${stat(c.barter_paid,"Barter + Paid","campaigns")}${stat(c.applications,"Applications","applications")}${stat(c.approved,"Creators approved","applications")}</div>
    <div class="card" style="margin-top:14px"><h3 style="margin-top:0">🕒 Live activity <span class="muted" style="font-size:12px;font-weight:400">· refreshes every 30s</span></h3>
      <div class="list">${(d.recent||[]).map(r=>`<div class="row"><span class="avatar">${esc(String(r.who||"?").replace(/^\+/,"").slice(0,2).toUpperCase())}</span>
        <div class="r-main"><div class="r-title">${esc(r.who)} <span class="muted" style="font-weight:400">${esc(EV[r.event]||String(r.event).replace(/_/g," "))}${r.event==="consent"&&r.detail&&r.detail.choice?` (${esc(r.detail.choice)})`:""}${r.detail&&r.detail.campaign?` · ${esc(r.detail.campaign)}`:""}</span></div>
        <div class="r-sub">${esc(r.role||"")}${r.city?` · ${esc(r.city)}`:""}</div></div><span class="muted" style="font-size:12px">${ago(r.at)}</span></div>`).join("") || `<div class="muted" style="padding:6px">No activity yet.</div>`}</div></div>`;
  body.querySelectorAll("[data-ovgo]").forEach(el=> el.onclick = ()=>{
    const go = el.dataset.ovgo;
    if(go.startsWith("@")){ currentPage = go.slice(1); renderShell(); return; }
    const [tab, f] = go.split(":"); if(tab==="creators"){ _acrF = f || "all"; _acrPage = 0; }
    _adminTab = tab; currentPage = "admin"; renderShell(); });
  clearInterval(_ovTimer);
  _ovTimer = setInterval(()=>{
    const b = document.getElementById("adminBody");
    if(currentPage!=="admin" || _adminTab!=="overview" || !b){ clearInterval(_ovTimer); return; }
    if(document.visibilityState==="visible") adminOverview(b, true);
  }, 30000);
}

async function adminOrgs(body){
  body.innerHTML = `<div class="muted" style="padding:16px">Loading…</div>`;
  const { data, error } = await sb.rpc("admin_list_orgs");
  if(error){ body.innerHTML = adminErr(error); return; }
  const list = data||[];
  body.innerHTML = `<div class="card"><table><thead><tr><th>Workspace</th><th>Members</th><th>Creators</th><th>Campaigns</th><th>Pending</th><th>Created</th></tr></thead>
    <tbody>${list.length?list.map(o=>`<tr><td><b>${esc(o.org_name)||"—"}</b><div class="r-sub">${esc(o.org_id)}</div></td>
      <td>${o.members}</td><td>${o.creators}</td><td>${o.campaigns}</td><td>${o.pending?`<span class="tag warn">${o.pending}</span>`:"0"}</td>
      <td>${esc(fmtDate(o.created_at))}</td></tr>`).join(""):`<tr><td colspan="6" class="muted" style="padding:24px">No workspaces yet.</td></tr>`}</tbody></table></div>`;
}

function adminData(body){
  body.innerHTML = `<div class="card filter-bar" style="margin-bottom:14px">
      <select id="adTable" class="fb-input">${ADMIN_TABLES.map(t=>`<option value="${t[0]}"${_adminDataTable===t[0]?' selected':''}>${esc(t[1])}</option>`).join("")}</select>
      <input id="adSearch" class="fb-input" placeholder="🔍 Search this table…" style="flex:1;min-width:180px">
      <button class="btn ghost" id="adExportCsv">⬇ CSV</button>
      <button class="btn ghost" id="adExportJson">⬇ JSON</button>
      <span id="adCount" class="muted" style="align-self:center;font-size:12px"></span>
    </div><div id="adRows"><div class="muted" style="padding:16px">Loading…</div></div>`;
  const tSel = document.getElementById("adTable"), search = document.getElementById("adSearch");
  tSel.onchange = ()=>{ _adminDataTable = tSel.value; adminLoadRows(); };
  let deb; search.oninput = ()=>{ clearTimeout(deb); deb = setTimeout(adminLoadRows, 300); };
  document.getElementById("adExportCsv").onclick = ()=> exportAdminTable("csv");
  document.getElementById("adExportJson").onclick = ()=> exportAdminTable("json");
  adminLoadRows();
}

// Export the current table (honouring the search box) — pages through the RPC to get ALL rows.
async function exportAdminTable(fmt){
  const table = _adminDataTable;
  const search = (document.getElementById("adSearch")||{}).value || "";
  const btn = document.getElementById(fmt==="csv"?"adExportCsv":"adExportJson");
  const orig = btn ? btn.textContent : ""; if(btn){ btn.disabled=true; btn.textContent="Exporting…"; }
  try{
    let all = [], offset = 0; const PAGE = 500;
    for(;;){
      const { data, error } = await sb.rpc("admin_list_table", { p_table:table, p_search:search, p_limit:PAGE, p_offset:offset });
      if(error) throw error;
      const chunk = data||[]; all = all.concat(chunk);
      if(chunk.length < PAGE || all.length >= 20000) break; // safety cap
      offset += PAGE;
    }
    if(!all.length){ alert("No rows to export."); return; }
    const stamp = new Date().toISOString().slice(0,10);
    if(fmt==="json"){
      downloadBlob(JSON.stringify(all, null, 2), `${table}-${stamp}.json`, "application/json");
    }else{
      downloadBlob(toCsv(all), `${table}-${stamp}.csv`, "text/csv");
    }
  }catch(ex){ alert("Export failed: "+(ex.message||ex)); }
  finally{ if(btn){ btn.disabled=false; btn.textContent=orig; } }
}

// Flatten an array of row objects into CSV (union of all keys; nested values JSON-stringified).
function toCsv(rows){
  const keys = [];
  rows.forEach(r=> Object.keys(r).forEach(k=>{ if(!keys.includes(k)) keys.push(k); }));
  const cell = v => {
    if(v==null) return "";
    const s = typeof v==="object" ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s;
  };
  return [keys.join(",")].concat(rows.map(r=>keys.map(k=>cell(r[k])).join(","))).join("\n");
}
function downloadBlob(text, filename, type){
  const blob = new Blob([text], {type}); const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 1000);
}

async function adminLoadRows(){
  const rows = document.getElementById("adRows"); if(!rows) return;
  const table = _adminDataTable;
  const search = (document.getElementById("adSearch")||{}).value || "";
  rows.innerHTML = `<div class="muted" style="padding:16px">Loading…</div>`;
  const { data, error } = await sb.rpc("admin_list_table", { p_table:table, p_search:search, p_limit:200, p_offset:0 });
  if(error){ rows.innerHTML = adminErr(error); return; }
  const list = data||[];
  const count = document.getElementById("adCount"); if(count) count.textContent = `${list.length} row${list.length===1?"":"s"}${list.length>=200?"+ (showing first 200)":""}`;
  if(!list.length){ rows.innerHTML = `<div class="card"><div class="muted" style="padding:16px">No rows.</div></div>`; return; }
  // Columns: a compact, meaningful subset (id + first few informative fields).
  const keys = Object.keys(list[0]);
  const shown = ["name","email","product","celebrity","campaign_name","creator_name","goal","status","role","stage","org_name"].filter(k=>keys.includes(k)).slice(0,3);
  if(!shown.length) shown.push(keys.find(k=>k!=="id"&&k!=="org_id")||"id");
  const editable = ADMIN_EDITABLE.has(table);
  rows.innerHTML = `<div class="card" style="overflow-x:auto"><table><thead><tr>${shown.map(k=>`<th>${esc(k)}</th>`).join("")}<th>Created</th><th>Actions</th></tr></thead>
    <tbody>${list.map((r,i)=>`<tr>${shown.map(k=>`<td>${esc(String(r[k]==null?"—":typeof r[k]==="object"?JSON.stringify(r[k]):r[k])).slice(0,60)}</td>`).join("")}
      <td>${esc(fmtDate(r.created_at))}</td>
      <td><div style="display:flex;gap:6px"><button class="mini-btn ghost" data-adview="${i}">View</button>
      ${editable?`<button class="mini-btn ghost" data-adedit="${i}">Edit</button><button class="mini-btn" style="background:var(--bad,#c0392b)" data-addel="${i}">Delete</button>`:""}</div></td></tr>`).join("")}</tbody></table></div>`;
  rows.querySelectorAll("[data-adview]").forEach(b=>b.onclick=()=>openAdminEdit(table, list[+b.dataset.adview], true));
  rows.querySelectorAll("[data-adedit]").forEach(b=>b.onclick=()=>openAdminEdit(table, list[+b.dataset.adedit], false));
  rows.querySelectorAll("[data-addel]").forEach(b=>b.onclick=()=>adminDeleteRow(table, list[+b.dataset.addel]));
}

function openAdminEdit(table, row, readOnly){
  let m = document.getElementById("adminEditModal"); if(m) m.remove();
  m = el("div","modal-overlay"); m.id="adminEditModal";
  const fields = Object.keys(row).map(k=>{
    const ro = readOnly || ADMIN_READONLY_FIELDS.has(k);
    const v = row[k]==null ? "" : (typeof row[k]==="object" ? JSON.stringify(row[k]) : String(row[k]));
    const multi = v.length > 60 || k==="brief"||k==="notes"||k==="deliverables";
    const input = multi
      ? `<textarea name="${esc(k)}" rows="2" ${ro?"readonly":""}>${esc(v)}</textarea>`
      : `<input name="${esc(k)}" value="${esc(v)}" ${ro?"readonly":""}>`;
    return `<label>${esc(k)}${ADMIN_READONLY_FIELDS.has(k)?' <span class="muted" style="text-transform:none;font-weight:400">(locked)</span>':""}${input}</label>`;
  }).join("");
  m.innerHTML = `<div class="modal modal-lg"><div class="modal-head"><strong>${readOnly?"View":"Edit"} ${esc(table)} record</strong><button class="icon-btn" id="aeClose">✕</button></div>
    <form id="adminEditForm" class="modal-form">${fields}
      <div class="auth-err" id="aeErr"></div>
      ${readOnly?"":`<button class="btn" type="submit">Save changes</button>`}</form></div>`;
  document.body.appendChild(m); m.classList.add("open");
  m.onclick = e=>{ if(e.target.id==="adminEditModal") m.classList.remove("open"); };
  document.getElementById("aeClose").onclick = ()=> m.classList.remove("open");
  const form = document.getElementById("adminEditForm");
  if(form) form.onsubmit = async e=>{
    e.preventDefault();
    const err = document.getElementById("aeErr"), btn = form.querySelector("button[type=submit]");
    err.textContent=""; btn.disabled=true; btn.textContent="Saving…";
    // Only send changed, non-locked fields.
    const patch = {};
    new FormData(form).forEach((val,k)=>{
      if(ADMIN_READONLY_FIELDS.has(k)) return;
      const orig = row[k]==null ? "" : (typeof row[k]==="object" ? JSON.stringify(row[k]) : String(row[k]));
      if(String(val) !== orig) patch[k] = val === "" ? null : val;
    });
    if(!Object.keys(patch).length){ m.classList.remove("open"); return; }
    const { error } = await sb.rpc("admin_update_row", { p_table:table, p_id:row.id, p_patch:patch });
    if(error){ err.textContent = error.message; btn.disabled=false; btn.textContent="Save changes"; return; }
    m.classList.remove("open"); adminLoadRows();
  };
}

async function adminDeleteRow(table, row){
  const label = row.name || row.email || row.product || row.campaign_name || row.id;
  if(!confirm(`Delete this ${table} record?\n\n${label}\n\nThis is permanent (logged to the audit trail).`)) return;
  const { error } = await sb.rpc("admin_delete_row", { p_table:table, p_id:row.id });
  if(error){ alert("Couldn't delete: "+error.message); return; }
  adminLoadRows();
}

async function adminAudit(body){
  body.innerHTML = `<div class="card filter-bar" style="margin-bottom:14px">
      <select id="auTable" class="fb-input"><option value="">All tables</option>${ADMIN_TABLES.filter(t=>t[0]!=="org_profiles").map(t=>`<option value="${t[0]}">${esc(t[1])}</option>`).join("")}</select>
      <select id="auAction" class="fb-input"><option value="">All actions</option><option>INSERT</option><option>UPDATE</option><option>DELETE</option></select>
    </div><div id="auRows"><div class="muted" style="padding:16px">Loading…</div></div>`;
  document.getElementById("auTable").onchange = adminLoadAudit;
  document.getElementById("auAction").onchange = adminLoadAudit;
  adminLoadAudit();
}
async function adminLoadAudit(){
  const rows = document.getElementById("auRows"); if(!rows) return;
  const table = (document.getElementById("auTable")||{}).value || null;
  const action = (document.getElementById("auAction")||{}).value || null;
  rows.innerHTML = `<div class="muted" style="padding:16px">Loading…</div>`;
  const { data, error } = await sb.rpc("admin_audit", { p_limit:150, p_offset:0, p_table:table, p_action:action });
  if(error){ rows.innerHTML = adminErr(error); return; }
  const list = data||[];
  if(!list.length){ rows.innerHTML = `<div class="card"><div class="muted" style="padding:16px">No matching activity.</div></div>`; return; }
  const badge = a => `<span class="tag ${a==="INSERT"?"good":a==="DELETE"?"":"warn"}">${esc(a)}</span>`;
  const restoreLabel = { DELETE:"Restore", UPDATE:"Revert", INSERT:"Undo" };
  const editable = new Set(["members","creators","campaigns","barter_items","applications","invites","irm_contacts","story_deals","dream_plans"]);
  rows.innerHTML = `<div class="card" style="overflow-x:auto"><table><thead><tr><th>When</th><th>Action</th><th>Table</th><th>Actor</th><th>Record</th><th>Undo</th></tr></thead>
    <tbody>${list.map((r,i)=>`<tr><td>${esc(fmtDateTime(r.at))}</td><td>${badge(r.action)}</td><td>${esc(r.table_name)}</td>
      <td>${esc(r.actor_email)||`<span class="muted">system</span>`}</td>
      <td><button class="mini-btn ghost" data-audit="${i}">Diff</button></td>
      <td>${editable.has(r.table_name)&&restoreLabel[r.action]?`<button class="mini-btn" data-restore="${esc(r.id)}" data-rlabel="${esc(restoreLabel[r.action])}">${restoreLabel[r.action]}</button>`:`<span class="muted">—</span>`}</td></tr>`).join("")}</tbody></table></div>`;
  rows.querySelectorAll("[data-audit]").forEach(b=>b.onclick=()=>openAuditDiff({o:list[+b.dataset.audit].old_data,n:list[+b.dataset.audit].new_data}));
  rows.querySelectorAll("[data-restore]").forEach(b=>b.onclick=()=>adminRestore(b.dataset.restore, b.dataset.rlabel));
}

async function adminRestore(auditId, label){
  if(!confirm(`${label} this change? The row will be brought back / reverted to its earlier state. (This action is itself logged.)`)) return;
  const { data, error } = await sb.rpc("admin_restore", { p_audit_id: Number(auditId) });
  if(error){ alert("Couldn't "+label.toLowerCase()+": "+error.message); return; }
  adminLoadAudit();
}
function openAuditDiff(d){
  let m = document.getElementById("auditDiffModal"); if(m) m.remove();
  m = el("div","modal-overlay"); m.id="auditDiffModal";
  const fmt = o => o ? `<pre class="audit-pre">${esc(JSON.stringify(o,null,2))}</pre>` : `<div class="muted">—</div>`;
  m.innerHTML = `<div class="modal modal-lg"><div class="modal-head"><strong>Change detail</strong><button class="icon-btn" id="adfClose">✕</button></div>
    <div class="modal-form"><div class="cd-l">Before</div>${fmt(d.o)}<div class="cd-l" style="margin-top:10px">After</div>${fmt(d.n)}</div></div>`;
  document.body.appendChild(m); m.classList.add("open");
  m.onclick = e=>{ if(e.target.id==="auditDiffModal") m.classList.remove("open"); };
  document.getElementById("adfClose").onclick = ()=> m.classList.remove("open");
}

async function adminApprovals(body){
  body.innerHTML = `<div id="apvBody">${skel("list",4)}</div>`;
  loadApprovals();
}
async function adminAdmins(body){
  body.innerHTML = `<div class="card"><h3>Add a super admin</h3>
      <form id="addAdminForm" class="modal-form" style="padding:0">
        <div class="mf-row"><label>User email<input name="email" type="email" required placeholder="teammate@geek.com"></label>
        <label style="justify-content:flex-end"><span style="visibility:hidden">.</span><button class="btn" type="submit">Grant super admin</button></label></div>
        <div class="auth-err" id="aaErr"></div><div class="lead-msg" id="aaMsg"></div>
      </form></div>
    <div class="card"><h3>Current super admins</h3><div class="list" id="adminList"><div class="muted" style="padding:8px">Loading…</div></div></div>`;
  const form = document.getElementById("addAdminForm");
  form.onsubmit = async e=>{
    e.preventDefault();
    const f = new FormData(form), err=document.getElementById("aaErr"), msg=document.getElementById("aaMsg");
    err.textContent=""; msg.textContent="";
    const { error } = await sb.rpc("admin_add_platform_admin", { p_email:(f.get("email")||"").trim() });
    if(error){ err.textContent = error.message; return; }
    msg.className="lead-msg ok"; msg.textContent="Added. They now have full super-admin access."; form.reset();
    adminAdmins(body);
  };
  const listWrap = document.getElementById("adminList");
  const { data, error } = await sb.rpc("admin_list_platform_admins");
  if(error){ listWrap.innerHTML = adminErr(error); return; }
  const me = (window.Auth && Auth.profile && Auth.profile.id) || null;
  listWrap.innerHTML = (data||[]).map(a=>`<div class="row"><span class="avatar">${esc((a.name||a.email||"?").slice(0,2).toUpperCase())}</span>
    <div class="r-main"><div class="r-title">${esc(a.name)||esc(a.email)||esc(a.user_id)}</div><div class="r-sub">${esc(a.email)||""} · since ${esc(fmtDate(a.created_at))}</div></div>
    ${a.user_id===me?`<span class="tag brand">You</span>`:`<button class="mini-btn ghost" data-rmadmin="${esc(a.user_id)}">Remove</button>`}</div>`).join("");
  listWrap.querySelectorAll("[data-rmadmin]").forEach(b=>b.onclick=async()=>{
    if(!confirm("Remove super-admin access for this user?")) return;
    const { error } = await sb.rpc("admin_remove_platform_admin", { p_user_id:b.dataset.rmadmin });
    if(error){ alert(error.message); return; }
    adminAdmins(body);
  });
}

function adminErr(error){
  const m = (error&&error.message)||"Something went wrong.";
  const hint = /function|does not exist|schema cache/i.test(m) ? " — re-run the latest DATABASE_SETUP.sql in Supabase to install the Super Admin functions." : "";
  return `<div class="card"><div class="muted" style="padding:16px">${esc(m)}${hint}</div></div>`;
}
function fmtDate(d){ if(!d) return "—"; try{ return new Date(d).toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"}); }catch(e){ return String(d); } }
function fmtDateTime(d){ if(!d) return "—"; try{ return new Date(d).toLocaleString("en-IN",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}); }catch(e){ return String(d); } }

const PAGES = {
  profile: (typeof renderProfile==="function"?renderProfile:()=>""),
  intelligence: (typeof renderIntelligence==="function"?renderIntelligence:()=>""),
  cintel: (typeof renderBrandIntel==="function"?renderBrandIntel:()=>""),
  campaignops: (typeof renderAgencyOps==="function"?renderAgencyOps:()=>""),
  brandsetup: (typeof renderBrandSetup==="function"?renderBrandSetup:()=>""),
  mycampaigns: (typeof renderMyCampaigns==="function"?renderMyCampaigns:()=>""),
  onboarding: (typeof renderOnboarding==="function"?renderOnboarding:()=>""),
  messages: (typeof renderWhatsApp==="function"?renderWhatsApp:()=>""),
  alerts: (typeof renderAlerts==="function"?renderAlerts:()=>""),
  discover:renderDiscover,
  instagram:renderInstagram,
  opencampaigns:()=> window.renderOpenCampaigns ? window.renderOpenCampaigns() : "",
  dashboard:renderDashboard, barter:()=> (currentRole==="creator" && window.__ciOpsEnabled && window.renderOpenCampaigns) ? window.renderOpenCampaigns("barter") : renderBarter(), creators:renderCreators, roster:renderRoster, mediakit:renderMediaKit, admin:renderAdmin,
  campaigns:renderCampaigns, reports:renderReports, growth:renderGrowth, settings:renderSettings,
  celebrity:renderCelebrity, approvals:renderApprovals, marketplace:renderMarketplace,
  brands:renderBrands, portfolio:renderPortfolio, finance:renderFinance, logistics:renderLogistics,
  irm:renderIRM,
  listening:renderListening
};

/* ---------- Social integrations (Settings) — real OAuth launch flow ---------- */
// The redirect URI must be registered on each platform's developer app.
const OAUTH_REDIRECT = location.origin + location.pathname.replace(/[^/]*$/,"") + "index.html";

// Client IDs are PUBLIC and safe in the browser. Paste yours here once each
// developer app is registered. The Client SECRET must NEVER live here — it stays
// in a Supabase Edge Function that exchanges the code for a token server-side.
const OAUTH = {
  meta: {
    clientId: "",                 // ← Meta App ID (developers.facebook.com)
    authUrl: "https://www.facebook.com/v19.0/dialog/oauth",
    scope: "instagram_basic,pages_read_engagement,business_management,pages_show_list",
    params: {}
  },
  google: {
    clientId: "",                 // ← Google OAuth Client ID (console.cloud.google.com)
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    scope: "https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly",
    params: { access_type:"offline", prompt:"consent", response_type:"code" }
  },
  linkedin: {
    clientId: "",                 // ← LinkedIn Client ID (linkedin.com/developers)
    authUrl: "https://www.linkedin.com/oauth/v2/authorization",
    scope: "r_organization_social r_member_social",
    params: { response_type:"code" }
  }
};

/* ---------- Instagram (Instagram Login) — real integration ---------- */
const INSTAGRAM_APP_ID = "944216414793314"; // Instagram app ID (public)
const IG_SCOPES = "instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights,instagram_business_manage_comments,instagram_business_manage_messages";
// Must EXACTLY match the redirect registered in Meta → Instagram login settings.
// always the site root /app.html (the address registered in Meta), whatever page the creator clicked from (/agency, /brand, /superadmin/, …)
const IG_REDIRECT = location.origin + "/app.html";

async function connectInstagram(fresh){
  // A signed-in member takes a one-time ticket along (inside "state"): on phones the Instagram app can hand the
  // login back to a DIFFERENT browser where nobody is signed in — the ticket still connects it to this account.
  let ticket = "";
  try{ const { data:{ session } } = await sb.auth.getSession();
       if(session){ const r = await sb.rpc("ig_connect_begin"); if(!r.error && r.data) ticket = String(r.data); } }catch(e){}
  const state = "instagram:" + Math.random().toString(36).slice(2) + (ticket ? ":" + ticket : "");
  try{ localStorage.setItem("geekos_oauth_state", state); }catch(e){}
  const p = new URLSearchParams({
    client_id: INSTAGRAM_APP_ID,
    redirect_uri: IG_REDIRECT,
    response_type: "code",
    scope: IG_SCOPES,
    state
  });
  if(fresh === true) p.set("force_reauth", "true");   // show the permission screen again (to allow messages)
  // Keep the login in the BROWSER on phones (never jump to the Instagram app, which just opens its feed):
  // Instagram's app-link rules (instagram.com/.well-known/apple-app-site-association) exclude "/oauth/authorize/*"
  // (note the trailing slash) and any address ending in "#weblink" — so this opens the web login + Allow screen,
  // then comes straight back here and the Media Kit loads.
  location.href = "https://www.instagram.com/oauth/authorize/?" + p.toString() + "#weblink";
}

/* ---------- Several Instagram accounts — every one connected through Instagram login; one is ACTIVE at a time
   (Media Kit, posting and campaigns use the active one). Switch from the Media Kit, the Instagram page or the
   Creator Profile. Connecting another account makes it active and keeps the others. ---------- */
let _igAccts = null;
async function igAccountsLoad(force){
  if(_igAccts && !force) return _igAccts;
  try{ const { data, error } = await sb.rpc("my_ig_accounts"); _igAccts = error ? [] : (data||[]); }catch(e){ _igAccts = []; }
  return _igAccts;
}
window.igAccountsLoad = igAccountsLoad;
function igAddAnother(back){
  try{ localStorage.setItem("geekos_after_ig", back || currentPage || "mediakit"); }catch(e){}
  gateToast("Log in to the other Instagram account on the next screen (tap “Not you?” if it shows your current one).");
  setTimeout(()=> connectInstagram(true), 900);
}
window.igAddAnother = igAddAnother;
async function igSwitchTo(igId){
  const { data, error } = await sb.rpc("ig_switch_account", { p_ig_user_id: igId });
  if(error) throw new Error(error.message||String(error));
  _igAccts = null; _mkLastAcct = null; _igAvatarUrl = null;
  try{ await sb.functions.invoke("instagram-media-sync", { body:{ force:true } }); }catch(e){}
  return data || {};
}
window.igSwitchTo = igSwitchTo;
// disconnect ANY connected account (the open one too: we move to the next account first; the last one removes Instagram)
async function igDisconnect(igId, username, isActive, total){
  const h = "@"+(username||"this account");
  const msg = total <= 1
    ? `Disconnect ${h}?\n\nIt's your only Instagram on Geek OS — your Media Kit, posting and campaign tools need an Instagram, so you'll be asked to connect one again.`
    : isActive ? `Disconnect ${h}?\n\nIt's the account open right now — Geek OS switches to your next account first. You can connect ${h} again any time.`
               : `Disconnect ${h} from Geek OS?\n\nYou can connect it again any time.`;
  if(!confirm(msg)) return null;
  showBusy(`Disconnecting ${h}…`);
  try{
    const { data, error } = await sb.rpc("ig_disconnect_account", { p_ig_user_id: igId });
    if(error) throw new Error(error.message||String(error));
    _igAccts = null; _mkLastAcct = null; _igAvatarUrl = null;
    if(data && data.none_left){ gateToast(`${h} disconnected`); setTimeout(()=> location.reload(), 600); return data; }
    if(data && data.switched){ try{ await sb.functions.invoke("instagram-media-sync", { body:{ force:true } }); }catch(e){} }
    gateToast(`${h} disconnected${data && data.switched && data.active ? ` · now using @${data.active}` : ""} ✓`);
    if(typeof applyIgAvatar==="function") applyIgAvatar(true);
    renderShell();
    return data;
  }catch(e){ gateToast(e.message||String(e)); return null; }
  finally{ setTimeout(hideBusy, 300); }
}
window.igDisconnect = igDisconnect;
// a small "Viewing / Posting as @x ▾ · + Add another" bar
async function paintIgSwitcher(boxId, label){
  const box = document.getElementById(boxId); if(!box || !window.sb) return;
  const L = await igAccountsLoad(true);
  if(!box.isConnected) return;
  const fmt = n => n==null ? "" : ` · ${Number(n).toLocaleString("en-IN")}`;
  const act = L.find(a=>a.active) || L[0] || {};
  box.innerHTML = `<div class="ig-sw">
      ${act.profile_picture_url?`<img class="ig-sw-av" src="${esc(safeUrl(act.profile_picture_url))}" alt="">`:`<span class="ig-sw-av ig-sw-ph">📸</span>`}
      <div class="ig-sw-mid"><span class="ig-sw-l">${esc(label)}</span>
      ${L.length>1 ? `<select class="ig-sw-sel" aria-label="Switch Instagram account">${L.map(a=>`<option value="${esc(a.ig_user_id)}"${a.active?" selected":""}>@${esc(a.username||"account")}${fmt(a.followers_count)}${a.token_expired?" · login expired":""}</option>`).join("")}</select>`
                   : `<b class="ig-sw-one">@${esc(act.username||"")}</b>`}</div>
      ${L.length>1?`<span class="ig-sw-n">${L.length} accounts</span>`:""}
      <button class="btn sm ghost ig-sw-add" type="button">+ Add account</button></div>`;
  const sel = box.querySelector(".ig-sw-sel");
  if(sel) sel.onchange = async ()=>{
    const to = L.find(a=>a.ig_user_id===sel.value)||{};
    sel.disabled = true; showBusy(`Switching to @${to.username||"account"}…`);
    try{ await igSwitchTo(sel.value); gateToast(`Switched to @${to.username||"account"} ✓`); renderShell(); }
    catch(e){ gateToast(e.message); sel.disabled = false; paintIgSwitcher(boxId, label); }
    finally{ setTimeout(hideBusy, 300); }
  };
  box.querySelector(".ig-sw-add").onclick = ()=> igAddAnother(currentPage);
}

// Called after Instagram redirects back with ?code — hands it to the Edge Function.
async function finishInstagram(code, ticket){
  const signedInCreator = !!(window.Auth && Auth.profile && Auth.profile.role === "creator");
  if(signedInCreator){
    paintEarlyShell(pageHead("Media Kit","Your reach, audience and best work — auto-built from Instagram and shareable with brands.")
      + `<div class="card mk-building"><div class="mk-spin"></div><h3 style="margin:10px 0 4px">Connecting your Instagram…</h3><div class="muted">Building your media kit from your profile, posts and audience. This takes a few seconds.</div></div>`);
  } else showBusy("Connecting your Instagram and building your media kit…");
  setTimeout(hideBusy, 45000);          // never stuck
  try{
    if(!(window.sb && window.sb.functions)) throw new Error("Edge Functions not available.");
    const { data:{ session } } = await sb.auth.getSession();

    if(session){
      // Signed in already → CONNECT this Instagram to the current account.
      const { data, error } = await sb.functions.invoke("instagram-auth", { body:{ code, redirect_uri: IG_REDIRECT } });
      if(error) throw new Error(await fnError(error));
      if(data && data.error) throw new Error(data.error);
      localStorage.setItem("geekos_conn_instagram","1");
      if(window.Tracker) Tracker.security("instagram_connected", { merged: !!(data && data.merged) });
      if(window.Auth) await Auth.currentSession(); // startApp skipped it while __igLoggingIn was set
      let back = null; try{ back = localStorage.getItem("geekos_after_ig"); localStorage.removeItem("geekos_after_ig"); }catch(e){}
      const role = (window.Auth && Auth.profile && Auth.profile.role) || "";
      // creators land on their Media Kit (built from the account they just connected)
      currentPage = role === "creator" ? "mediakit" : (back || "discover");
      if(currentPage === "discover") _dcTab = "external";
      if(window.__osBooted){ if(typeof renderShell==="function") renderShell(); }
      else if(typeof bootOS==="function") await bootOS();
      setTimeout(hideBusy, 400);           // the Media Kit shows its own loader from here
      return;
    }

    // Not signed in on THIS browser, but the connect was started by a signed-in member (phone: Instagram app →
    // another browser) → connect it to that member and sign them in here, then open the Media Kit.
    if(ticket){
      const { data, error } = await sb.functions.invoke("instagram-login", { body:{ code, redirect_uri: IG_REDIRECT, ticket } });
      if(error) throw new Error(await fnError(error));
      if(data && data.error) throw new Error(data.error);
      try{ localStorage.setItem("geekos_conn_instagram","1"); localStorage.removeItem("geekos_after_ig"); }catch(e){}
      if(data && data.token_hash){
        const { error: vErr } = await sb.auth.verifyOtp({ token_hash: data.token_hash, type: "magiclink" });
        if(vErr) throw vErr;
        const authRoot = document.getElementById("authRoot");
        if(authRoot){ authRoot.classList.remove("open"); authRoot.innerHTML = ""; }
        if(window.Auth) await Auth.currentSession();
        hideBusy(); paintEarlyShell();
        currentPage = "mediakit";
        if(typeof bootOS==="function") await bootOS();
        setTimeout(hideBusy, 400);
        return;
      }
      hideBusy(); window.__igLoggingIn = false;
      alert("Instagram connected ✓ — sign in to continue.");
      if(window.startApp) mountLogin("login");
      return;
    }

    // Not signed in → SIGN IN with Instagram (server creates/loads the user + a session token).
    const { data, error } = await sb.functions.invoke("instagram-login", { body:{ code, redirect_uri: IG_REDIRECT } });
    if(error) throw new Error(await fnError(error));
    if(data && data.error) throw new Error(data.error);
    const { error: vErr } = await sb.auth.verifyOtp({ token_hash: data.token_hash, type: "magiclink" });
    if(vErr) throw vErr;
    localStorage.setItem("geekos_conn_instagram","1");
    // Boot the OS straight onto the media kit.
    const authRoot = document.getElementById("authRoot");
    if(authRoot){ authRoot.classList.remove("open"); authRoot.innerHTML = ""; }
    if(window.Auth) await Auth.currentSession();
    hideBusy(); paintEarlyShell();
    // Remember this device so returning creators get a one-tap "welcome back" (no re-typing).
    try{ localStorage.setItem("geekos_last_name", (Auth.profile && Auth.profile.name) || ""); }catch(e){}
    currentPage = "mediakit";
    if(typeof bootOS==="function") await bootOS();
    setTimeout(hideBusy, 400);
  }catch(ex){
    hideBusy();
    window.__igLoggingIn = false;
    alert("Instagram sign-in failed: " + (ex.message||ex) + "\n\nMake sure the instagram-login & instagram-auth Edge Functions are deployed and this redirect URL is registered in Meta:\n" + IG_REDIRECT);
    const { data:{ session:s2 } } = await sb.auth.getSession();
    if(!s2){ if(window.startApp) mountLogin("login"); }
    else if(window.Auth && !Auth.profile){ await Auth.currentSession(); if(typeof bootOS==="function") bootOS(); }
  }
}

const INTEGRATIONS = [
  { key:"instagram", ic:"📸", name:"Instagram (Business / Creator)", desc:"Log in with Instagram to auto-build your media kit and publish posts from the app.", scopes:"instagram_business_basic · content_publish · manage_insights", portal:"developers.facebook.com" },
  { key:"google", ic:"▶️", name:"Google (YouTube)", desc:"Import channel stats, video performance & audience demographics.", scopes:"youtube.readonly · yt-analytics.readonly", portal:"console.cloud.google.com", soon:true },
  { key:"linkedin", ic:"💼", name:"LinkedIn", desc:"Fetch creator & company-page follower growth and post reach.", scopes:"r_organization_social · r_member_social", portal:"linkedin.com/developers", soon:true }
];

function integrationState(key){
  return localStorage.getItem("geekos_conn_"+key) === "1";
}

// Build the platform consent URL and send the user there.
function startOAuth(key){
  const cfg = OAUTH[key];
  if(!cfg || !cfg.clientId){
    alert(`${key} isn't set up yet.\n\nAdd your ${key} Client ID in app.js (OAUTH.${key}.clientId), register this redirect URL on the platform's developer app:\n\n${OAUTH_REDIRECT}\n\nThen this button will launch the real consent screen.`);
    return;
  }
  const state = key + ":" + Math.random().toString(36).slice(2);
  localStorage.setItem("geekos_oauth_state", state);
  const p = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: OAUTH_REDIRECT,
    scope: cfg.scope,
    state,
    response_type: "code",
    ...cfg.params
  });
  location.href = cfg.authUrl + "?" + p.toString();
}

// When the platform redirects back with ?code=..., hand it to the Edge Function
// (server-side) which swaps it for an access token and stores it against the org.
async function handleOAuthCallback(){
  const q = new URLSearchParams(location.search);
  const code = q.get("code"), state = q.get("state");
  if(!code || !state) return;
  const expected = localStorage.getItem("geekos_oauth_state");
  const platform = (state.split(":")[0]) || "";
  // Clean the URL immediately so the code isn't left in the address bar.
  history.replaceState({}, "", location.pathname);
  // Instagram: the one-time ticket inside state proves who started it, even when we came back in another browser
  const igTicket = platform === "instagram" ? (state.split(":")[2] || "") : "";
  if(state !== expected && !(platform === "instagram" && /^[0-9a-f]{48}$/.test(igTicket))){ console.warn("OAuth state mismatch — ignoring."); return; }
  try{ localStorage.removeItem("geekos_oauth_state"); }catch(e){}

  // Instagram Login uses its own Edge Function flow.
  if(platform === "instagram"){ window.__igLoggingIn = true; await finishInstagram(code, igTicket); return; }
  if(platform === "facebook"){ await finishFacebookSearch(code); return; }

  try{
    if(!(window.sb && window.sb.functions)){
      throw new Error("Database/Edge Functions not connected.");
    }
    // Edge Function does the secret token exchange & stores the token row.
    const { error } = await window.sb.functions.invoke("oauth-exchange", {
      body: { platform, code, redirect_uri: OAUTH_REDIRECT }
    });
    if(error) throw new Error(await fnError(error));
    // Only mark connected once the server actually stored a token.
    localStorage.setItem("geekos_conn_"+platform, "1");
    renderIntegrations();
    alert(`${platform} connected ✅ — real data sync is now active.`);
  }catch(ex){
    // Consent may have been granted, but without a stored token we are NOT connected.
    localStorage.removeItem("geekos_conn_"+platform);
    renderIntegrations();
    alert(`${platform}: consent received, but the token could not be stored yet.\n\nDeploy the "oauth-exchange" Supabase Edge Function to finish the connection. (${ex.message||ex})`);
  }
}

function renderIntegrations(){
  const wrap = document.getElementById("integrationList");
  if(!wrap) return;
  wrap.innerHTML = INTEGRATIONS.map(i=>{
    const on = integrationState(i.key);
    return `<div class="integration">
      <div class="int-ic">${i.ic}</div>
      <div class="int-body">
        <div class="int-title">${esc(i.name)}
          ${i.soon?`<span class="conn-chip">Coming soon</span>`:`<span class="conn-chip ${on?'on':''}">${on?'● Connected':'○ Not connected'}</span>`}</div>
        <div class="int-desc">${esc(i.desc)}</div>
        <div class="int-scopes">Scopes: ${esc(i.scopes)}</div>
      </div>
      ${i.soon?`<button class="btn ghost" disabled style="opacity:.5;cursor:default">Soon</button>`:`<button class="btn ${on?'ghost':''}" data-conn="${esc(i.key)}">${on?'Disconnect':'Connect'}</button>`}
    </div>`;
  }).join("");
  wrap.querySelectorAll("button[data-conn]").forEach(b=>{
    b.onclick = ()=>{
      const k = b.dataset.conn;
      if(integrationState(k)){
        localStorage.removeItem("geekos_conn_"+k);
        renderIntegrations();
      } else if(k==="instagram"){
        connectInstagram(); // Instagram Login flow
      } else {
        startOAuth(k); // (reserved for future providers)
      }
    };
  });
}

function renderSettings(){
  const org = (window.Auth && Auth.profile && Auth.profile.org) || "your org";
  const roleOpts = (typeof ROLE_OPTIONS!=="undefined"?ROLE_OPTIONS:[["creator","Creator"]]).map(r=>`<option value="${r[0]}">${esc(r[1])}</option>`).join("");
  let html = pageHead("Settings","Team, roles & social integrations.");
  html += `<div class="card"><h3>Team</h3>
    <p class="muted" style="margin-bottom:12px">Invite teammates to <b>${esc(org)}</b>. When they sign up with the invited email, they join this org automatically — no new workspace.</p>
    <form id="inviteForm" class="modal-form">
      <div class="mf-row"><label>Email<input name="email" type="email" required placeholder="teammate@agency.com"></label>
      <label>Role<select name="role">${roleOpts}</select></label></div>
      <div class="auth-err" id="inviteErr"></div>
      <div class="lead-msg" id="inviteMsg"></div>
      <button class="btn" type="submit">Send invite</button>
    </form>
    <h4 style="margin-top:18px">Members</h4>
    <div class="list" id="teamMembers"><div class="muted" style="padding:8px">Loading…</div></div>
    <h4 style="margin-top:18px">Pending invites</h4>
    <div class="list" id="pendingInvites"><div class="muted" style="padding:8px">Loading…</div></div>
  </div>`;
  html += `<div class="card"><h3>Public workspace page</h3>
    <p class="muted" style="margin-bottom:12px">A public link to <b>${esc(org)}</b> you can share with brands & creators — shows your roster and campaign activity, no login needed.</p>
    <form id="orgProfileForm" class="modal-form">
      <div class="mf-row"><label>Public link (slug)<input name="slug" placeholder="geek-media" pattern="[a-z0-9-]+" title="lowercase letters, numbers and dashes"></label>
      <label>Display name<input name="display_name" placeholder="${esc(org)}"></label></div>
      <label>Tagline<input name="tagline" placeholder="India's barter-first creator agency"></label>
      <label>Bio<textarea name="bio" rows="3" placeholder="What your agency does, who you work with…"></textarea></label>
      <div class="mf-row"><label>Contact WhatsApp<input name="whatsapp" placeholder="+91 98xxxxxxxx"></label>
      <label>Contact email<input name="email" type="email" placeholder="hello@agency.com"></label></div>
      <div class="mf-row"><label>Website<input name="website" placeholder="agency.com"></label>
      <label>City<input name="city" placeholder="Gurugram"></label></div>
      <label style="flex-direction:row;align-items:center;gap:8px;text-transform:none;font-size:13px"><input type="checkbox" name="is_public" style="width:auto" checked> Page is public</label>
      <div class="auth-err" id="orgProfErr"></div>
      <div class="lead-msg" id="orgProfMsg"></div>
      <div id="orgProfLink" style="display:none;margin-top:2px"></div>
      <button class="btn" type="submit">Save & get link</button>
    </form></div>`;
  html += `<div class="card"><h3>Social Platform Integrations</h3>
    <p class="muted" style="margin-bottom:16px">Connect official platform APIs (no scraping) to pull real analytics from creator accounts and brand pages. Each needs a registered developer app — status shown live below.</p>
    <div id="integrationList"></div>
    <div class="ai-suggest" style="margin-top:8px"><span class="spark">🔑</span><div class="s-body"><b>3 steps to go live per platform</b><p>1) Register a developer app (Meta / Google / LinkedIn). 2) Add your <b>Client ID</b> in app.js and register this redirect URL on the app: <code>${OAUTH_REDIRECT}</code>. 3) Deploy the <code>oauth-exchange</code> Edge Function (holds the secret & stores tokens). "Connect" then launches the real consent screen. Meta & LinkedIn require app review before real data is granted.</p></div></div>
  </div>`;
  return html;
}

/* ---------- Org public profile (shareable workspace page) ---------- */
function orgPublicUrl(slug){
  return location.origin + location.pathname.replace(/[^/]*$/,"") + "o.html?o=" + encodeURIComponent(slug);
}
async function loadOrgProfile(){
  const form = document.getElementById("orgProfileForm");
  if(!form || !window.sb) return;
  const { data } = await sb.from("org_profiles").select("*").maybeSingle();
  if(data){
    ["slug","display_name","tagline","bio","whatsapp","email","website","city"].forEach(k=>{ if(form[k]) form[k].value = data[k]||""; });
    if(form.is_public) form.is_public.checked = data.is_public !== false;
    if(data.slug) showOrgLink(data.slug);
  }
}
function showOrgLink(slug){
  const box = document.getElementById("orgProfLink");
  if(!box) return;
  const url = orgPublicUrl(slug);
  box.style.display = "block";
  box.innerHTML = `<div class="row"><div class="r-main"><div class="r-title">Your public link</div>
    <div class="r-sub"><a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a></div></div>
    <button type="button" class="mini-btn" id="orgCopyLink">Copy</button></div>`;
  const cp = document.getElementById("orgCopyLink");
  if(cp) cp.onclick = async ()=>{ try{ await navigator.clipboard.writeText(url); cp.textContent="Copied!"; setTimeout(()=>cp.textContent="Copy",1500); }catch(e){ prompt("Copy your link:", url); } };
}
function wireOrgProfileForm(){
  const form = document.getElementById("orgProfileForm");
  if(!form) return;
  form.onsubmit = async e=>{
    e.preventDefault();
    const f = new FormData(form), err = document.getElementById("orgProfErr"), msg = document.getElementById("orgProfMsg");
    const btn = form.querySelector("button[type=submit]");
    err.textContent=""; msg.textContent=""; msg.className="lead-msg"; btn.disabled=true; btn.textContent="Saving…";
    const slug = (f.get("slug")||"").trim().toLowerCase().replace(/[^a-z0-9-]/g,"-").replace(/-+/g,"-").replace(/^-|-$/g,"");
    if(!slug){ err.textContent="Pick a public link (slug) — e.g. your agency name."; btn.disabled=false; btn.textContent="Save & get link"; return; }
    const row = { slug, display_name:f.get("display_name")||null, tagline:f.get("tagline")||null, bio:f.get("bio")||null,
      whatsapp:f.get("whatsapp")||null, email:(f.get("email")||"").toLowerCase()||null, website:f.get("website")||null,
      city:f.get("city")||null, is_public:!!f.get("is_public"), updated_at:new Date().toISOString() };
    if(window.Auth && Auth.profile && Auth.profile.org_id) row.org_id = Auth.profile.org_id;
    try{
      if(!window.sb) throw new Error("Database not connected.");
      // org_id is the PK; upsert so save works whether or not a page exists yet.
      const { error } = await sb.from("org_profiles").upsert(row, { onConflict:"org_id" });
      if(error){
        if((error.code==="23505") || /duplicate|unique/i.test(error.message)) throw new Error("That link is taken — try another slug.");
        throw error;
      }
      msg.className="lead-msg ok"; msg.textContent="Saved. Share your public link below.";
      showOrgLink(slug);
    }catch(ex){ err.textContent = ex.message || "Couldn't save."; }
    finally{ btn.disabled=false; btn.textContent="Save & get link"; }
  };
}

/* ---------- Team (invites + members) ---------- */
async function loadTeam(){
  if(!window.sb) return;
  const mWrap = document.getElementById("teamMembers");
  const iWrap = document.getElementById("pendingInvites");
  const [m, i] = await Promise.all([
    sb.from("members").select("name,email,role,created_at").order("created_at",{ascending:true}),
    sb.from("invites").select("*").eq("status","pending").order("created_at",{ascending:false})
  ]);
  const members = m.data||[], invites = i.data||[];
  if(mWrap){
    mWrap.innerHTML = members.length ? members.map(x=>`<div class="row">
      <span class="avatar">${esc((x.name||x.email||"?").slice(0,2).toUpperCase())}</span>
      <div class="r-main"><div class="r-title">${esc(x.name)||esc(x.email)}</div><div class="r-sub">${esc(x.email)||""}</div></div>
      <span class="tag brand">${esc(x.role||"member")}</span></div>`).join("") : `<div class="muted" style="padding:8px">Just you so far.</div>`;
  }
  if(iWrap){
    const base = location.origin + location.pathname.replace(/[^/]*$/,"") + "app.html";
    iWrap.innerHTML = invites.length ? invites.map(x=>`<div class="row">
      <span class="dot warn"></span>
      <div class="r-main"><div class="r-title">${esc(x.email)}</div><div class="r-sub">Invited as ${esc(x.role||"creator")}</div></div>
      <span><button class="mini-btn" data-invlink="${esc(x.token||'')}">Copy link</button>
      <button class="mini-btn ghost" data-cancelinv="${esc(x.id)}">Cancel</button></span></div>`).join("") : `<div class="muted" style="padding:8px">No pending invites.</div>`;
    iWrap.querySelectorAll("[data-invlink]").forEach(b=>b.onclick=async()=>{
      const link = base + "?invite=" + b.dataset.invlink;
      try{ await navigator.clipboard.writeText(link); b.textContent="Copied!"; setTimeout(()=>b.textContent="Copy link",1500); }catch(e){ prompt("Share this invite link:", link); }
    });
    iWrap.querySelectorAll("[data-cancelinv]").forEach(b=>b.onclick=async()=>{
      await sb.from("invites").delete().eq("id", b.dataset.cancelinv); loadTeam();
    });
  }
}

function wireInviteForm(){
  const form = document.getElementById("inviteForm");
  if(!form) return;
  form.onsubmit = async e=>{
    e.preventDefault();
    const f = new FormData(form), msg = document.getElementById("inviteMsg"), err = document.getElementById("inviteErr");
    const btn = form.querySelector("button[type=submit]");
    err.textContent=""; msg.textContent=""; msg.className="lead-msg"; btn.disabled=true; btn.textContent="Sending…";
    const row = { email:(f.get("email")||"").toLowerCase(), role:f.get("role")||"creator", status:"pending" };
    if(window.Auth && Auth.profile){ row.org_id = Auth.profile.org_id; row.org_name = Auth.profile.org; }
    try{
      if(!window.sb) throw new Error("Database not connected.");
      const { error } = await sb.from("invites").insert(row);
      if(error) throw error;
      form.reset();
      msg.textContent = `Invite created for ${row.email}. Use “Copy link” below and send it to them — signing up via that link joins them to your org.`;
      msg.className = "lead-msg ok";
      loadTeam();
    }catch(ex){
      err.textContent = ex.message || "Couldn't create invite.";
    }finally{
      btn.disabled=false; btn.textContent="Send invite";
    }
  };
}

function renderContent(){
  const fn = PAGES[currentPage] || (()=>renderPlaceholder(NAV_META[currentPage]?.label||"Module",""));
  $("#content").innerHTML = fn();
  const card = document.getElementById("openAiFromCard");
  if(card) card.onclick = openAi;
  if(currentPage==="creators" || currentPage==="roster"){
    loadCreators(); livePage(currentPage, loadCreators, 45000);
    const add = document.getElementById("addCreatorBtn");
    if(add) add.onclick = openCreatorModal;
    const imp = document.getElementById("importCreatorBtn");
    const inp = document.getElementById("creatorCsvInput");
    if(imp && inp){ imp.onclick = ()=> inp.click(); inp.onchange = ()=>{ if(inp.files[0]) importCreatorsCsv(inp.files[0]); inp.value=""; }; }
    const smp = document.getElementById("csvSample");
    if(smp) smp.onclick = e=>{ e.preventDefault(); csvSampleDownload(); };
  }
  if(currentPage==="celebrity"){
    loadCampaignSection("celebrity");
    loadStories(); livePage("celebrity", ()=>{ loadCampaignSection("celebrity"); loadStories(); }, 45000);
    const add = document.getElementById("addStoryBtn");
    if(add) add.onclick = openStoryModal;
  }
  if(currentPage==="irm"){
    loadIRM(); livePage("irm", loadIRM, 45000);
    const add = document.getElementById("addIrmBtn");
    if(add) add.onclick = openIrmModal;
  }
  if(currentPage==="listening"){ loadListening(); livePage("listening", loadListening, 60000); }
  if(currentPage==="messages"){ if(window.waChat) window.waChat.load(); mountMessagesTabs(); }
  if(currentPage==="approvals") loadApprovals();          // keeps its own 20s timer
  if(currentPage==="marketplace") loadMarketplace();
  if(currentPage==="brands" || currentPage==="portfolio"){ loadBrands(); livePage(currentPage, loadBrands, 30000); }
  if(currentPage==="finance"){ loadFinance(); livePage("finance", loadFinance, 30000); }
  if(currentPage==="logistics"){ loadLogistics(); livePage("logistics", loadLogistics, 30000); }
  if(currentPage==="mediakit") loadMediaKit();
  if(currentPage==="profile" && window.ciProfile) window.ciProfile.load();
  if(currentPage==="intelligence" && window.ciIntel) window.ciIntel.loadSelf();
  if(currentPage==="cintel" && window.ciIntel) window.ciIntel.loadBrand();
  if(currentPage==="alerts" && window.ciOps) window.ciOps.loadAlerts();
  if(currentPage==="campaignops" && window.ciOps) window.ciOps.loadAgencyOps();
  if(currentPage==="brandsetup" && window.ciOps) window.ciOps.loadBrandSetup();
  if(currentPage==="mycampaigns" && window.ciOps) window.ciOps.loadMyCampaigns();
  if(currentPage==="onboarding" && window.ciOps) window.ciOps.loadOnboarding();
  if(currentPage==="growth") loadGrowth();
  if(currentPage==="admin") loadAdmin();
  if(currentPage==="instagram") loadInstagram();
  if(currentPage==="opencampaigns" && window.ciOps) window.ciOps.loadOpenCampaigns();
  if(currentPage==="discover") loadDiscover();
  if(currentPage==="campaigns"){
    loadCampaigns(); livePage("campaigns", loadCampaigns, 30000);
    const add = document.getElementById("addCampaignBtn");
    if(add) add.onclick = ()=> openCampaignModal();
  }
  if(currentPage==="settings"){
    renderIntegrations();
    wireInviteForm();
    loadTeam();
    wireOrgProfileForm();
    loadOrgProfile();
  }
  if(currentPage==="reports"){
    const rep = ()=>{ if(currentRole==="creator") loadCreatorReports();
      else (window.sb ? loadOrgReports() : Promise.resolve(false)).then(ok=>{ if(!ok) loadReportRows(); }); };
    rep(); livePage("reports", rep, 60000);
  }
  if(currentPage==="dashboard"){
    loadDashboard(); pollNavCounts(); livePage("dashboard", ()=>{ loadDashboard(); loadKPIs(); }, 30000);
  }
  if(currentPage==="barter" && currentRole==="creator" && window.__ciOpsEnabled && window.ciOps){ window.ciOps.loadOpenCampaigns(); }
  else if(currentPage==="barter"){
    loadCampaignSection("barter");
    loadBarter(); livePage("barter", ()=>{ loadCampaignSection("barter"); loadBarter(); }, 45000);
    const add = document.getElementById("addBarterBtn");
    if(add) add.onclick = ()=> openBarterModal();
  }
  // Fill any KPI cards on the page with live values from the database.
  loadKPIs();
}

function renderShell(){
  if(currentRole==="creator"){
    const MOVED = { alerts:"dashboard", onboarding:"profile", growth:"mycampaigns", marketplace: window.__ciOpsEnabled ? "opencampaigns" : "marketplace" };
    if(MOVED[currentPage]) currentPage = MOVED[currentPage];
  }
  // the old Alerts page is now the bell dropdown, for every role
  if(currentPage==="alerts"){ currentPage = window.__isAdmin ? "admin" : "dashboard"; setTimeout(()=>{ try{ openNotif(); }catch(e){} }, 300); }
  if(window.__profileGate && !GATE_OPEN_PAGES.includes(currentPage)) currentPage = "mediakit";
  if(window.Tracker) Tracker.page(currentPage);
  if(window.hideBootSplash) hideBootSplash();
  renderNav(); renderMe(); renderContent();
}

/* ---------- Command palette ---------- */
const PALETTE_ITEMS = () => ROLES[currentRole].nav.map(k=>({key:k,ic:NAV_META[k].ic,label:NAV_META[k].label}))
  .concat([{key:"__ai",ic:"✨",label:"Open AI Assistant"},{key:"__theme",ic:"🌗",label:"Toggle dark mode"}]);

function openPalette(){ $("#paletteOverlay").classList.add("open"); $("#paletteInput").value=""; $("#paletteInput").focus(); fillPalette(""); }
function closePalette(){ $("#paletteOverlay").classList.remove("open"); }
function fillPalette(q){
  const ul=$("#paletteResults"); q=q.toLowerCase();
  const items=PALETTE_ITEMS().filter(i=>i.label.toLowerCase().includes(q));
  ul.innerHTML=items.map((i,idx)=>`<li data-key="${i.key}" class="${idx===0?'sel':''}"><span class="p-ic">${i.ic}</span>${i.label}<span class="p-hint">↵</span></li>`).join("")||`<li class="muted">No matches</li>`;
  ul.querySelectorAll("li[data-key]").forEach(li=>li.onclick=()=>runPalette(li.dataset.key));
}
function runPalette(key){
  closePalette();
  if(key==="__ai") return openAi();
  if(key==="__theme") return toggleTheme();
  currentPage=key; renderShell();
}

/* ---------- AI drawer ---------- */
let AI_HISTORY = [];
function openAi(){
  const r=ROLES[currentRole];
  $("#aiTitle").textContent=r.ai.title; $("#aiSub").textContent=r.ai.sub;
  if(!AI_HISTORY.length){
    const sug=(AI_SUGGEST[currentRole]||[]).map(s=>`• ${s.t}`).join("\n");
    AI_HISTORY=[{role:"assistant", content:`Hi ${r.name.split(" ")[0]} — I'm your ${r.ai.title}. Ask me anything about growing on the platform, or what to do next.${sug?`\n\nA couple of ideas:\n${sug}`:""}`}];
  }
  renderAiChat();
  $("#aiOverlay").classList.add("open");
}
function aiFormat(t){ return esc(t).replace(/\n/g,"<br>"); }
function renderAiChat(){
  const body=$("#aiBody");
  body.innerHTML=`<div class="ai-thread" id="aiThread">${AI_HISTORY.map(m=>`<div class="ai-msg ${m.role==='user'?'user':'bot'}${m._pending?' pending':''}">${aiFormat(m.content)}</div>`).join("")}</div>
    <form id="aiForm" class="ai-input"><input id="aiInput" placeholder="Ask your ${esc(ROLES[currentRole].ai.title)}…" autocomplete="off"><button class="btn" type="submit" id="aiSend">Send</button></form>`;
  const thread=$("#aiThread"); if(thread) thread.scrollTop=thread.scrollHeight;
  const form=$("#aiForm");
  if(form) form.onsubmit=e=>{ e.preventDefault(); const v=$("#aiInput").value.trim(); if(v) sendAiMessage(v); };
  const inp=$("#aiInput"); if(inp) inp.focus();
}
// Built-in assistant (no outside AI, no API key). Creators get answers from their own campaigns' data
// (brief, contract, step, deadline, courier); brands / agencies get a short how-to.
const AI_ACTION_ORDER = ["changes_requested","content_created","contract_sent","contract_signed","content_approved","product_sent","invited",
  "content_submitted","address_confirmed","published","brand_confirmed","accepted","sent_to_brand","shortlisted","eligible","applied","completed"];
async function builtInAnswer(text){
  const hi = window.CampaignHelper ? CampaignHelper.isHinglish(text) : false;
  const T = (h,e)=> hi ? h : e;
  if(currentRole !== "creator"){
    const q = text.toLowerCase();
    if(/delete|hata|remove/.test(q)) return T("Campaign kholo → **🗑 Request delete** dabao aur wajah likho. Super Admin approve karega tab campaign delete hoga.",
                                              "Open the campaign → tap **🗑 Request delete** and add a reason. It's deleted once the Super Admin approves.");
    if(/bulk|sheet|upload|excel|csv/.test(q)) return T("Campaign kholo → **📥 Bulk upload creators**. Wahan sheet ka template aur guide hai — naam, WhatsApp, email, Instagram aur har creator ka **Status** (Invited · Approved · Contract signed · Address confirmed · Courier sent · Courier received), address aur courier bharo.",
                                              "Open the campaign → **📥 Bulk upload creators**. The sheet template and guide are there — name, WhatsApp, email, Instagram and each creator's **Status** (Invited · Approved · Contract signed · Address confirmed · Courier sent · Courier received), plus address and courier.");
    if(/invite|creator dh|find|discover|search/.test(q)) return T("**Discover** mein category / followers se creators dhoondo, ya campaign mein **🎯 Invite creators** dabao.",
                                              "Use **Discover** to find creators by category / followers, or tap **🎯 Invite creators** in a campaign.");
    if(/new campaign|campaign bana|create campaign|naya campaign/.test(q)) return T("**Campaigns → New campaign** — brand, product, deliverables, brief aur contract terms bharo. Phir creators jodo.",
                                              "**Campaigns → New campaign** — fill brand, product, deliverables, brief and contract terms, then add creators.");
    if(/whatsapp|message|template|notification/.test(q)) return T("Har step ka update creators ko WhatsApp + email + app pe apne aap jaata hai. Delivery status Super Admin → **WhatsApp & email** mein dikhta hai.",
                                              "Every step's update reaches creators on WhatsApp + email + the app automatically. Delivery status is in Super Admin → **WhatsApp & email**.");
    return T("Main campaigns mein madad karta hoon: naya campaign, creators jodna (bulk upload / invite), process aur delete request. Kya karna hai, likho.",
             "I help with campaigns: creating one, adding creators (bulk upload / invite), the process and delete requests. Tell me what you need.");
  }
  if(!window.CampaignHelper) return T("Helper load ho raha hai — ek pal mein dobara poochho.","The helper is still loading — ask again in a moment.");
  const { data } = await sb.schema("api").rpc("get_my_campaigns");
  const mine = Array.isArray(data) ? data : [];
  if(!mine.length) return T("Abhi aapke account pe koi campaign nahi hai. **Campaigns** mein jaake apply karo — select hote hi har update WhatsApp pe aayega.",
                            "You don't have a campaign yet. Go to **Campaigns** and apply — once selected, every update comes on WhatsApp.");
  const ql = text.toLowerCase();
  const c = mine.find(x=>[x.campaign,x.brand,x.product].some(n=> n && String(n).length>2 && ql.includes(String(n).toLowerCase())))
    || mine.slice().sort((a,b)=>((AI_ACTION_ORDER.indexOf(a.stage)+1)||99)-((AI_ACTION_ORDER.indexOf(b.stage)+1)||99))[0];
  const { data:k } = await sb.schema("api").rpc("get_my_contract", { p_participation:c.participation_id }).then(r=>r, ()=>({data:null}));
  const a = CampaignHelper.answer(text, c, k||null);
  return (mine.length>1 ? `📌 **${c.campaign}${c.brand?" · "+c.brand:""}**\n\n` : "") + a.reply;
}
async function sendAiMessage(text){
  AI_HISTORY.push({role:"user", content:text});
  AI_HISTORY.push({role:"assistant", content:"…", _pending:true});
  renderAiChat();
  try{
    if(!window.sb) throw new Error("Not connected.");
    const reply = await builtInAnswer(text);
    AI_HISTORY=AI_HISTORY.filter(m=>!m._pending);
    AI_HISTORY.push({role:"assistant", content: reply || "(no answer)"});
  }catch(ex){
    AI_HISTORY=AI_HISTORY.filter(m=>!m._pending);
    AI_HISTORY.push({role:"assistant", content:"Sorry — the helper couldn't answer right now. "+(ex.message||ex)});
  }
  renderAiChat();
}
function closeAi(){ $("#aiOverlay").classList.remove("open"); }

/* ---------- Notifications (real recent activity) ---------- */
// pin the alerts dropdown + new-alert pop-ups right under the 🔔
function anchorToBell(){
  const b = document.getElementById("bellBtn"); if(!b) return;
  const r = b.getBoundingClientRect(), root = document.documentElement.style;
  root.setProperty("--bell-top", Math.round(r.bottom + 10) + "px");
  root.setProperty("--bell-right", Math.max(12, Math.round(window.innerWidth - r.right - 8)) + "px");
  root.setProperty("--bell-arrow", Math.round(r.width/2 + 2) + "px");
}
window.addEventListener("resize", anchorToBell);
async function openNotif(){
  anchorToBell();
  $("#notifOverlay").classList.add("open");
  const body = $("#notifBody");
  if(window.__ciOpsEnabled && window.ciOps && window.ciOps.loadAlerts){
    const head = document.querySelector("#notifDrawer .drawer-head .muted"); if(head) head.textContent = currentRole==="creator" ? "Live · also sent to your WhatsApp & email" : "Live · updates every few seconds";
    const t0 = document.querySelector("#notifDrawer .drawer-head strong"); if(t0) t0.textContent = "Alerts";
    body.innerHTML = `<div class="muted" style="padding:12px">Loading…</div>`;
    await window.ciOps.loadAlerts(body);
    return;
  }
  body.innerHTML = `<div class="muted" style="padding:12px">Loading…</div>`;
  if(!window.sb){ body.innerHTML = `<div class="muted" style="padding:12px">No activity yet.</div>`; return; }
  const [cr, ca, ba] = await Promise.all([
    sb.from("creators").select("name,created_at").order("created_at",{ascending:false}),
    sb.from("campaigns").select("name,brand,status,created_at").order("created_at",{ascending:false}),
    sb.from("barter_items").select("product,creator,stage,created_at").order("created_at",{ascending:false})
  ]);
  const items = buildActivityItems(cr.data||[], ca.data||[], ba.data||[]);
  body.innerHTML = items.length
    ? `<div class="list">${items.slice(0,15).map(x=>`<div class="row"><span class="dot ${x.ic}"></span><div class="r-main"><div class="r-title">${esc(x.title)}</div><div class="r-sub">${esc(x.sub)}</div></div></div>`).join("")}</div>`
    : `<div class="muted" style="padding:12px">No activity yet — add your first creator, campaign or barter.</div>`;
}
function closeNotif(){ $("#notifOverlay").classList.remove("open"); }

/* ---------- Theme ---------- */
function toggleTheme(){
  const d=document.documentElement.getAttribute("data-theme")==="dark";
  applyTheme(d ? "light" : "dark");
  try{ localStorage.setItem("geekos_theme", d ? "light" : "dark"); }catch(e){}
}
// light / dark: remembered per device; first visit follows the phone / laptop setting
function applyTheme(t){
  document.documentElement.setAttribute("data-theme", t==="dark" ? "dark" : "");
  const b = document.getElementById("themeBtn"); if(b) b.textContent = t==="dark" ? "☀️" : "🌙";
}
(function(){ let t=null; try{ t=localStorage.getItem("geekos_theme"); }catch(e){}
  if(!t && window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches) t="dark";
  applyTheme(t||"light"); })();

/* ---------- Boot (called after auth) ---------- */
function showPending(){
  if(window.hideBootSplash) hideBootSplash();
  const root = document.getElementById("authRoot");
  if(!root) return;
  root.classList.add("open");
  root.innerHTML = `<div class="auth-wrap"><div class="auth-card" style="max-width:420px;text-align:center;margin:auto">
    <div class="brand-mark" style="margin:0 auto 14px">G</div>
    <h2 style="margin-bottom:8px">Your account is under review</h2>
    <p class="muted" style="margin-bottom:18px">Thanks for signing up! Your request is with the Geek Super Admin. Agency &amp; brand accounts are approved before full access — we'll message you on WhatsApp/email as soon as you're in (usually within a day).</p>
    <button class="btn ghost" id="pendingSignout">Sign out</button>
  </div></div>`;
  const b = document.getElementById("pendingSignout"); if(b) b.onclick = ()=> window.Auth && Auth.signOut();
}

// Creator onboarding, step 2 of 2: an Instagram professional account is required before the OS opens
// (step 1 is the WhatsApp OTP). Their media kit is built from it and campaigns are matched on it.
async function creatorHasInstagram(){
  try{
    const { data, error } = await sb.from("social_accounts").select("member_id").eq("platform","instagram")
      .eq("member_id", Auth.profile.id).limit(1);
    if(error) return true;          // never lock a creator out on a read hiccup
    return !!(data && data.length);
  }catch(e){ return true; }
}
function showInstagramGate(){
  if(window.hideBootSplash) hideBootSplash();
  const root = document.getElementById("authRoot"); if(!root) return;
  root.classList.add("open");
  root.innerHTML = `<div class="auth-wrap"><div class="auth-card" style="max-width:460px;margin:auto">
    <div class="auth-brand"><div class="brand-mark">G</div><div><div class="brand-name">Almost there</div><div class="muted">Step 2 of 2 — connect Instagram</div></div></div>
    <p style="margin:6px 0 12px">Connect your Instagram <b>Business or Creator</b> account. We build your media kit from it, show brands your real stats and let you publish posts, reels &amp; stories from here.</p>
    <ul class="muted" style="font-size:13px;margin:0 0 14px 18px;line-height:1.6">
      <li>Profile, followers, posts &amp; insights (read-only)</li>
      <li>Publish only when <b>you</b> press Publish</li>
      <li>We never see your Instagram password</li>
    </ul>
    <button class="ig-btn" id="gateIg"><span class="ig-ic">📸</span> Connect Instagram</button>
    <div class="muted" style="font-size:12px;margin-top:10px">Personal account? In Instagram: Settings → Account type and tools → Switch to professional account (free, 1 minute).</div>
    <button class="btn ghost" id="gateSignout" style="margin-top:14px;width:100%">Sign out</button>
  </div></div>`;
  document.getElementById("gateIg").onclick = ()=>{ if(window.Tracker) Tracker.security("instagram_connect_start"); connectInstagram(); };
  document.getElementById("gateSignout").onclick = ()=> window.Auth && Auth.signOut();
}

// Agency / Brand onboarding, step 2 of 2 (first time only): verify the official email over SMTP OTP.
function showEmailGate(){
  if(window.hideBootSplash) hideBootSplash();
  const root = document.getElementById("authRoot"); if(!root) return;
  root.classList.add("open");
  const P = Auth.profile || {};
  root.innerHTML = `<div class="auth-wrap"><div class="auth-card" style="max-width:460px;margin:auto">
    <div class="auth-brand"><div class="brand-mark">G</div><div><div class="brand-name">Verify your official email</div><div class="muted">Step 2 of 2 · ${esc(P.org||"")}</div></div></div>
    <p class="muted" style="margin:4px 0 12px">WhatsApp verified ✓ Now verify your work email — the Geek Super Admin reviews your account with it.</p>
    <form id="emForm" class="auth-form">
      <label>Official email<input name="email" type="email" required placeholder="you@yourcompany.com" autocomplete="email" value="${esc(P.official_email||"")}"></label>
      <button class="btn auth-submit" type="submit">Send code →</button>
    </form>
    <form id="emCodeForm" class="auth-form" style="display:none">
      <label>6-digit code from your email<input name="code" inputmode="numeric" maxlength="6" placeholder="••••••" required></label>
      <button class="btn auth-submit" type="submit">Verify →</button>
      <button class="btn ghost sm" type="button" id="emResend">Use a different email / resend</button>
    </form>
    <div class="auth-err" id="emErr"></div><div class="lead-msg" id="emMsg"></div>
    <button class="btn ghost" id="emSignout" style="margin-top:14px;width:100%">Sign out</button>
  </div></div>`;
  const err = document.getElementById("emErr"), msg = document.getElementById("emMsg");
  const call = async body=>{ const { data, error } = await sb.functions.invoke("email-otp", { body }); if(error) throw new Error(await fnError(error)); if(data && data.error) throw new Error(data.error); return data||{}; };
  document.getElementById("emForm").onsubmit = async e=>{
    e.preventDefault(); err.textContent=""; msg.textContent="";
    const email = String(new FormData(e.target).get("email")||"").trim(); const b = e.target.querySelector("button"); b.disabled=true;
    try{ const r = await call({ action:"start", email });
      msg.textContent = `Code sent to ${email}.` + (r.free_mail ? " (Tip: an official company email gets approved faster.)" : ""); msg.className="lead-msg ok";
      e.target.style.display="none"; document.getElementById("emCodeForm").style.display=""; }
    catch(ex){ err.textContent = ex.message||ex; } finally{ b.disabled=false; }
  };
  document.getElementById("emCodeForm").onsubmit = async e=>{
    e.preventDefault(); err.textContent="";
    const code = String(new FormData(e.target).get("code")||"").trim(); const b = e.target.querySelector("button[type=submit]"); b.disabled=true;
    try{ await call({ action:"verify", code }); if(window.Tracker) Tracker.security("official_email_verified");
      await Auth.currentSession(); bootOS(); }
    catch(ex){ err.textContent = ex.message||ex; b.disabled=false; }
  };
  document.getElementById("emResend").onclick = ()=>{ document.getElementById("emCodeForm").style.display="none"; document.getElementById("emForm").style.display=""; msg.textContent=""; };
  document.getElementById("emSignout").onclick = ()=> window.Auth && Auth.signOut();
}

// Super Admin: label, Admin panel first in the nav, and land on the command centre after sign-in
function markSuperAdmin(){
  window.__isAdmin = true;
  // links in WhatsApp / email use the live domain set as APP_URL on Vercel (unless the APP_URL secret overrides it)
  try{ const gc = window.GEEK_CONFIG; if(gc && gc.appUrlFromEnv && gc.appUrl) sb.rpc("admin_sync_app_url", { p_url: gc.appUrl }).then(()=>{}, ()=>{}); }catch(e){}
  const wrap = document.querySelector(".role-switch");
  if(wrap) wrap.innerHTML = `<label>Signed in as</label><div class="role-static">🛡 Super Admin</div>`;
  if(window.__pendingAdminTab){ _adminTab = window.__pendingAdminTab; delete window.__pendingAdminTab; window.__adminLanded = true; currentPage = "admin"; renderShell(); return; }
  const deep = new URLSearchParams(location.search).get("go");
  if(!window.__adminLanded && !deep && (currentPage==="dashboard" || !currentPage)){ window.__adminLanded = true; _adminTab = "overview"; currentPage = "admin"; renderShell(); }
  else renderNav();
}
// every message the app shows (saved, errors, live alerts, reminders) is one toast stack, top-right
// (the browser's blocking alert() boxes become toasts too — confirm / prompt stay as they are)
try{ window.alert = msg => gateToast(String(msg==null ? "" : msg)); }catch(e){}
function toastStack(){
  let wrap = document.getElementById("alertToasts");
  if(!wrap){ wrap = el("div",""); wrap.id = "alertToasts"; wrap.setAttribute("aria-live","polite"); document.body.appendChild(wrap); }
  return wrap;
}
function gateToast(msg){
  const wrap = toastStack();
  const same = [...wrap.querySelectorAll(".alert-toast.at-msg")].find(x=> x.dataset.msg === String(msg));
  if(same) same.remove();
  while(wrap.children.length >= 4) wrap.firstElementChild.remove();
  const ok = /✓|✅|🎉/.test(msg), bad = /couldn|failed|error|not allowed|refused|⚠️/i.test(msg);
  const t = el("div",`alert-toast at-msg ${ok?"at-ok":bad?"at-bad":""}`, `<div class="at-ic">${ok?"✅":bad?"⚠️":"💬"}</div><div class="at-b"><span class="at-t">${esc(msg)}</span></div><button class="at-x" aria-label="Dismiss">✕</button>`);
  t.dataset.msg = String(msg);
  wrap.appendChild(t);
  const kill = ()=>{ t.classList.add("out"); setTimeout(()=>t.remove(), 250); };
  t.onclick = kill;
  setTimeout(kill, bad ? 6000 : 3600);
}
// called by profile.js every time the mandatory checklist is re-computed
window.onProfileRequirements = function(req){
  if(!window.Auth || !Auth.profile || Auth.profile.role!=="creator" || !req) return;
  const wasDone = !!(window.__profileReqPrev && window.__profileReqPrev.complete);
  window.__profileReqPrev = req; window.__profileReq = req;
  if(!wasDone && req.complete && window.__profileReqSeen){
    if(window.Tracker) Tracker.security("profile_completed");
    gateToast("🎉 Profile complete — brands will see your full profile.");
    renderNav();
  }
  window.__profileReqSeen = true;
  if(currentPage==="mediakit"){ const gb=document.getElementById("mkGateBanner"); if(gb) gb.outerHTML = mkGateBanner(); }
};
// Cookie choice is required once per account (server-recorded so the Super Admin sees it on every device)
async function ensureConsent(){
  if(!window.Consent) return;
  let local = Consent.choice();
  if(!local && window.sb){
    try{ const { data } = await sb.rpc("my_consent"); if(data==="all"||data==="essential"){ Consent.set(data, true); local = data; } }catch(e){}
  }
  if(!local) await Consent.require();
}
// campaign invites (bulk upload): claim the one from the link + any sent to this number / email / Instagram
async function claimCreatorInvites(){
  if(!window.sb || !sb.schema) return;
  let tok = null; try{ tok = localStorage.getItem("geek_cinv"); }catch(e){}
  try{
    const { data, error } = await sb.schema("api").rpc("claim_my_invites", { p_token: tok || null });
    if(error) return;
    if(tok){ try{ localStorage.removeItem("geek_cinv"); }catch(e){} }
    if(tok || (data && (data.joined || data.waiting))) window.__inviteGo = data || {};
  }catch(e){}
}
// The creator's only hard gate: Instagram (media kit) + WhatsApp connected. The profile is optional (popup + %).
async function creatorProfileGate(){
  try{
    const [rq, js] = await Promise.all([
      sb.schema("api").rpc("get_profile_requirements").then(r=>r, e=>({error:e})),
      sb.schema("api").rpc("my_join_status").then(r=>r, e=>({error:e}))]);
    if(!rq.error && rq.data){
      const d = rq.data, its = (d.items||[]).filter(it=> !["reel_rate","barter"].includes(it.key) && !["rate","barter"].includes(it.section));
      const dn = its.filter(it=> it.done).length;
      window.__profileReq = Object.assign({}, d, { items:its, total:its.length, done:dn, complete: dn===its.length,
        missing: its.filter(it=> !it.done).map(it=> it.label) });
    }
    if(!js.error && js.data){ window.__joinNeeds = js.data.needs || []; window.__profileGate = window.__joinNeeds.length > 0; }
    else { window.__joinNeeds = []; window.__profileGate = false; }     // fail open: never lock someone out on a network error
  }catch(e){ window.__profileGate = false; }
}
function joinNeedsText(){
  const n = window.__joinNeeds || [];
  return n.length ? `First: ${n.join(" + ")} — then every campaign opens for you.` : "Connect Instagram (media kit) and WhatsApp first.";
}
// the setup card: what is still to connect (Instagram media kit / WhatsApp), each one button
function joinGateCard(id){
  if(currentRole!=="creator" || !window.__profileGate) return id ? `<div id="${id}"></div>` : "";
  const n = window.__joinNeeds || [], ig = n.some(x=>/instagram/i.test(x)), wa = n.some(x=>/whatsapp/i.test(x));
  return `<div ${id?`id="${id}" `:""}class="card cd-gate"><div><b>🔒 Two quick connections and you're in</b>
      <div class="muted" style="font-size:13px">Campaigns open as soon as both are connected. Your creator profile is optional.</div>
      <div class="cd-gate-steps"><span class="${ig?"":"done"}">${ig?"○":"✓"} Instagram (media kit)</span><span class="${wa?"":"done"}">${wa?"○":"✓"} WhatsApp</span></div></div>
    <div class="cd-gate-acts">${ig?`<button class="btn" data-gateig>📸 Connect Instagram</button>`:""}${wa?`<button class="btn ${ig?"ghost":""}" data-gatewa>💬 Connect WhatsApp</button>`:""}</div></div>`;
}
document.addEventListener("click", e=>{
  const t = e.target && e.target.closest ? e.target : null; if(!t) return;
  if(t.closest("[data-gateig]")){ e.preventDefault(); try{ localStorage.setItem("geekos_after_ig","mediakit"); }catch(x){} connectInstagram(); }
  else if(t.closest("[data-gatewa]")){ e.preventDefault(); if(window.waLogin && waLogin.link) waLogin.link(); }
});
// WhatsApp just linked → the gate re-checks and the app opens up (campaigns waiting for them join on the server)
window.addEventListener("geek:wa-linked", async ()=>{
  const was = !!window.__profileGate;
  await creatorProfileGate();
  if(was && !window.__profileGate){
    gateToast("🎉 All connected — campaigns are open for you!");
    claimCreatorInvites().then(()=>{ if(window.__inviteGo){ currentPage = "mycampaigns"; } renderShell(); });
  } else renderShell();
});
// "Please complete your profile" — once per visit (closing it keeps it closed until the next reload)
function profilePopupOnce(){
  const r = window.__profileReq;
  if(currentRole!=="creator" || window.__profilePopShown || !r || r.complete || window.__profileGate) return;
  window.__profilePopShown = true;
  const pct = Math.round(100*r.done/Math.max(r.total,1));
  const m = el("div","modal-overlay open"); m.id = "profPop";
  m.innerHTML = `<div class="modal prof-pop" role="dialog" aria-label="Complete your profile">
      <button class="icon-btn prof-pop-x" aria-label="Close">✕</button>
      <button class="prof-pop-body" type="button">
        <div class="prof-pop-ring" style="--p:${pct}"><span>${pct}%</span></div>
        <h3>Please complete your profile</h3>
        <p class="muted">${r.done} of ${r.total} done. Brands pick complete profiles first — it takes a couple of minutes.</p>
        <span class="btn">Complete my profile →</span></button></div>`;
  document.body.appendChild(m);
  const close = ()=> m.remove();
  m.querySelector(".prof-pop-x").onclick = close;
  m.onclick = e=>{ if(e.target === m) close(); };
  m.querySelector(".prof-pop-body").onclick = ()=>{ close(); currentPage = "profile"; renderShell(); };
}

// Paint the app frame (sidebar, top bar) straight away while the rest loads in the background, so a new login
// or a fresh Instagram connect never shows a blank screen — only the page area shows its own loader.
function paintEarlyShell(html){
  try{
    if(window.Auth && Auth.profile && ROLES[Auth.profile.role]) currentRole = Auth.profile.role;
    if(currentRole==="creator" && !new URLSearchParams(location.search).get("go")) currentPage = "mediakit";
    initRoles(); renderNav(); renderMe(); wireSignOut();
    const c = document.getElementById("content");
    if(c) c.innerHTML = html || (currentRole==="creator"
      ? pageHead("Media Kit","Your reach, audience and best work — auto-built from Instagram and shareable with brands.") + mkLoadingHtml() + skel("kit")
      : skel("dash"));
    const mb = document.getElementById("menuBtn"); if(mb && !mb.onclick) mb.onclick = ()=> document.getElementById("sidebar").classList.toggle("open");
    window.__earlyShell = true;
    if(window.hideBootSplash) hideBootSplash();
  }catch(e){}
}
window.paintEarlyShell = paintEarlyShell;

async function bootOS(){
  // Agency/brand accounts created through WhatsApp verify their official email first (one time)
  if(window.Auth && Auth.profile && ["owner","brand"].includes(Auth.profile.role) && Auth.profile.created_via === "whatsapp-login" && !Auth.profile.email_verified_at){
    showEmailGate(); return;
  }
  // Gate: agency-side accounts awaiting platform approval don't enter the OS.
  if(window.Auth && Auth.profile && Auth.profile.status === "pending"){ showPending(); return; }
  if(!window.__osBooted) paintEarlyShell();
  if(window.Auth && Auth.profile && Auth.profile.role === "creator"){
    await claimCreatorInvites();
    if(!(await creatorHasInstagram())){ showInstagramGate(); return; }
    const root = document.getElementById("authRoot"); if(root){ root.classList.remove("open"); root.innerHTML = ""; }
    if(!window.__osBooted && !new URLSearchParams(location.search).get("go")) currentPage = "mediakit";
  }
  if(window.Tracker) Tracker.start();
  await ensureConsent();
  // Seed the signed-in user's role into the shell.
  if(window.Auth && Auth.profile && ROLES[Auth.profile.role]){
    currentRole = Auth.profile.role;
  }
  // Load the feature flags + profile checklist first, so the sidebar is complete on the very first paint
  // (no half sidebar that only fixes itself after a refresh).
  const content = document.getElementById("content");
  if(content && !window.__osBooted && !window.__earlyShell) content.innerHTML = skel(currentRole==="creator" ? "kit" : "dash");
  const within = (p, ms)=> Promise.race([Promise.resolve(p).catch(()=>{}), new Promise(r=>setTimeout(r, ms))]);
  await Promise.all([
    window.ciProfile && within(window.ciProfile.boot(), 5000),
    window.ciOps && within(window.ciOps.boot(), 5000),
    window.ciIntel && within(window.ciIntel.boot(), 5000),
    (window.Auth && Auth.profile && Auth.profile.role === "creator") ? within(creatorProfileGate(), 5000) : null
  ]);
  if(window.__profileGate && !GATE_OPEN_PAGES.includes(currentPage)) currentPage = "mediakit";
  // came from a campaign invite → whatever is still pending first (profile), then the campaign itself
  if(window.__inviteGo && !window.__osBooted && !new URLSearchParams(location.search).get("go")){
    currentPage = window.__profileGate ? "profile" : "mycampaigns";
    const nm = window.__inviteGo.campaign ? `“${window.__inviteGo.campaign}”` : "Your campaign";
    setTimeout(()=> gateToast(window.__profileGate ? `🎯 ${nm} is waiting — finish your profile and it opens right away.` : `🎯 ${nm} is open in My Campaigns.`), 900);
  }
  init();
  // Platform admins get an Admin queue in the nav.
  if(window.sb){ sb.rpc("is_platform_admin").then(({data})=>{ if(data===true){ markSuperAdmin(); } }).catch(()=>{}); }
}

/* ---------- Wire up ---------- */
/* ---------- Live alerts: every role polls its bell every 20s; new ones pop as a toast (tap → open) ---------- */
let _alertSeen = null, _alertTimer = null;
async function pollAlerts(){
  if(!window.__ciOpsEnabled || !window.sb || document.visibilityState === "hidden") return;
  try{
    const { data, error } = await sb.schema("api").rpc("get_my_notifications", { p_only_unread: true });
    if(error) return;
    const list = data || [];
    const grew = list.length > (window.__alertsUnread || 0);
    window.__alertsUnread = list.length;
    const bell = document.getElementById("notifCount");
    if(bell){ bell.textContent = list.length > 9 ? "9+" : list.length; bell.style.display = list.length ? "" : "none";
      if(grew && _alertSeen){ bell.classList.remove("pulse"); void bell.offsetWidth; bell.classList.add("pulse");
        const bb = document.getElementById("bellBtn"); if(bb){ bb.classList.remove("ring"); void bb.offsetWidth; bb.classList.add("ring"); } } }
    // first look after opening the app: the latest unread alerts / reminders of the last 2 days, once per visit
    const shown = window.__alertsToasted || (window.__alertsToasted = new Set());
    const recent = n => !n.created_at || (Date.now() - new Date(n.created_at).getTime()) < 2*86400000;
    const fresh = (_alertSeen ? list.filter(n => !_alertSeen.has(n.notification_id)) : list.filter(recent))
                    .filter(n => !shown.has(n.notification_id)).slice(0, 3);
    fresh.forEach(n=> shown.add(n.notification_id));
    fresh.slice().reverse().forEach((n, i)=> setTimeout(()=> showAlertToast(n), i*350));
    if(_alertSeen){
      const drawerOpen = document.getElementById("notifOverlay") && document.getElementById("notifOverlay").classList.contains("open");
      if(fresh.length && drawerOpen && window.ciOps) window.ciOps.loadAlerts(document.getElementById("notifBody"));
    }
    _alertSeen = new Set(list.map(n => n.notification_id));
  }catch(e){}
}
function showAlertToast(n){
  const wrap = toastStack();
  while(wrap.children.length >= 4) wrap.firstElementChild.remove();
  const rem = /remind/i.test(String(n.kind||"") + " " + String(n.template_key||"") + " " + String(n.title||""));
  const act = n.kind==="action_required";
  const t = el("div",`alert-toast ${act?"at-act":rem?"at-rem":""}`, `<div class="at-ic">${act?"⚡":rem?"⏰":"🔔"}</div><div class="at-b"><b>${esc(n.title)}</b><span>${esc(n.body||"")}</span>${n.action_label?`<em>${esc(n.action_label)} →</em>`:""}</div><button class="at-x" aria-label="Dismiss">✕</button>`);
  wrap.appendChild(t);
  const kill = ()=>{ t.classList.add("out"); setTimeout(()=>t.remove(), 250); };
  t.onclick = e=>{ if(e.target.closest(".at-x")){ kill(); return; } kill();
    const r = n.action_route && String(n.action_route).replace(/^\/?app\.html\?go=/,"").replace(/^#/,"");
    if(r && PAGES[r] && !(window.__profileGate && !GATE_OPEN_PAGES.includes(r))){ currentPage = r; renderShell(); } else openNotif(); };
  setTimeout(kill, 9000);
}

function init(){
  window.__osBooted = true;
  if(currentRole!=="creator") startNavCounts();
  if(!_alertTimer){ _alertTimer = setInterval(pollAlerts, 20000); setTimeout(pollAlerts, 1500); document.addEventListener("visibilitychange", ()=>{ if(document.visibilityState==="visible") pollAlerts(); }); }
  initRoles();
  // deep link from a WhatsApp / email push: app.html?go=<page> opens that page (then the param is dropped)
  // deep links from WhatsApp / email alerts: app.html?go=<route>  (role-aware; "admin:<tab>" opens a Super Admin tab)
  let go = new URLSearchParams(location.search).get("go");
  if(go){
    history.replaceState({}, "", location.pathname);
    if(/^admin:/.test(go)){ const tab = go.split(":")[1] || "overview"; if(window.__isAdmin){ _adminTab = tab; go = "admin"; } else { window.__pendingAdminTab = tab; go = "dashboard"; } }
    if(currentRole==="creator") go = ({ onboarding:"profile", alerts:"dashboard", campaigns:"mycampaigns", approvals:"mycampaigns", campaignops:"mycampaigns", marketplace:"opencampaigns" })[go] || go;
    else go = ({ mycampaigns:"campaigns", opencampaigns:"campaigns", onboarding:"dashboard", profile:"dashboard", mediakit:"dashboard" })[go] || go;
    if(PAGES[go]) currentPage = go;
  }
  renderShell();
  wireSignOut();
  $("#searchTrigger").onclick=openPalette;
  $("#paletteOverlay").onclick=e=>{if(e.target.id==="paletteOverlay")closePalette();};
  $("#paletteInput").oninput=e=>fillPalette(e.target.value);
  $("#paletteInput").onkeydown=e=>{ if(e.key==="Enter"){const sel=$("#paletteResults li[data-key]");if(sel)runPalette(sel.dataset.key);} if(e.key==="Escape")closePalette(); };
  $("#aiLaunch").onclick=openAi; $("#aiClose").onclick=closeAi;
  $("#aiOverlay").onclick=e=>{if(e.target.id==="aiOverlay")closeAi();};
  $("#bellBtn").onclick=openNotif; $("#notifClose").onclick=closeNotif;
  const meEl = $("#me"); if(meEl){ meEl.setAttribute("role","button"); meEl.setAttribute("tabindex","0"); meEl.setAttribute("aria-haspopup","dialog"); meEl.title = "Your profile";
    meEl.onclick = toggleMeCard; meEl.onkeydown = e=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); toggleMeCard(); } }; }
  $("#notifOverlay").onclick=e=>{if(e.target.id==="notifOverlay")closeNotif();};
  $("#themeBtn").onclick=toggleTheme;
  $("#menuBtn").onclick=()=>$("#sidebar").classList.toggle("open");
  document.addEventListener("keydown",e=>{ if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==="k"){e.preventDefault();openPalette();} });
}

function wireSignOut(){
  const btn = $("#signOutBtn");
  if(btn) btn.onclick = ()=>{ if(window.Tracker) Tracker.security("sign_out"); setTimeout(()=> window.Auth && Auth.signOut(), 150); };
  // Show the signed-in org/name in the sidebar footer if present.
  const label = $("#orgLabel");
  if(label && window.Auth && Auth.profile){
    label.textContent = Auth.profile.org;
    const who = $("#whoLabel");
    if(who) who.textContent = Auth.profile.name;
  }
}

// Handle any OAuth redirect coming back from Meta/Google/LinkedIn first.
if(typeof handleOAuthCallback==="function") handleOAuthCallback();

// Auth gate boots the OS; startApp lives in login.js
if(window.startApp) startApp();
else init();