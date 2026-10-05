// Geek Influencer OS — shell (Sprint 1 UI + Sprint 2 auth)
let currentRole = "owner";
let currentPage = "dashboard";

const $ = s => document.querySelector(s);
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
function renderNav(){
  const nav = $("#nav"); nav.innerHTML="";
  const keys = ROLES[currentRole].nav.slice();
  // Creator Profile nav is DARK: shown only when the api.creator_profile_api feature is enabled
  // (in production the api schema is unexposed, so this stays hidden and legacy nav is unchanged).
  if(currentRole==="creator" && window.__ciProfileEnabled && !keys.includes("profile")) keys.splice(1,0,"profile");
  if(window.__isAdmin) keys.push("admin");
  keys.forEach(key=>{
    const m = NAV_META[key] || {ic:"🛡", label:key};
    const a = el("a","", `<span class="ic">${m.ic}</span><span>${m.label}</span>`);
    if(key===currentPage) a.classList.add("active");
    a.onclick = ()=>{ currentPage=key; renderShell(); if(window.innerWidth<=760) $("#sidebar").classList.remove("open"); };
    nav.appendChild(a);
  });
}

function renderMe(){
  const r = ROLES[currentRole];
  let initials = r.initials, title = r.name;
  if(window.Auth && Auth.profile){
    title = Auth.profile.name;
    initials = Auth.profile.name.split(" ").map(x=>x[0]).join("").slice(0,2).toUpperCase();
  }
  $("#me").textContent = initials;
  $("#me").title = title;
  // Badge = count of real pending tasks (set by the dashboard loader); 0 until known.
  $("#notifCount").textContent = window.__geekTasks != null ? window.__geekTasks : 0;
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
    const activeSet=['Live','In Production','Sourcing','Approval'];
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

function renderDashboard(){
  const role = currentRole;
  const first = ((window.Auth && Auth.profile && Auth.profile.name) || ROLES[role].name).split(" ")[0];
  let html = pageHead("Dashboard", `Welcome back, ${esc(first)} — here's your live cockpit.`);
  html += `<div id="onboardCard"></div>`;
  html += kpiRow(role);
  if(role!=="creator") html += `<div id="inboundAppsCard"></div>`;
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
  }
  renderTasks(campaigns, barter);
  renderActivity(buildActivityItems(creators, campaigns, barter));
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
  html += `<div class="card" style="margin-top:16px"><h3>Pipeline</h3>
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
  if(org_id) q = q.eq("org_id", org_id);
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
  html += `<div class="grid three" id="campaignGrid"><div class="card"><div class="muted">Loading campaigns…</div></div></div>`;
  return html;
}

function campaignCardsHtml(list){
  if(!list.length) return `<div class="card"><div class="ai-suggest"><span class="spark">📣</span><div class="s-body"><b>No campaigns yet</b><p>Click "+ New Campaign" to launch your first one 👆</p></div></div></div>`;
  return list.map(c=>{
    const st = {Live:"good","In Production":"brand",Sourcing:"warn",Approval:"warn",Draft:"warn",Completed:"good"}[c.status]||"brand";
    const prog = Math.max(0, Math.min(100, parseInt(c.progress)||0));
    const creators = parseInt(c.creators)||0;
    return `<div class="card"><h3>${esc(c.name)}<span class="tag ${st}">${esc(c.status)||"Draft"}</span></h3>
      <div class="muted">${esc(c.brand)||"—"} · ${esc(c.type)||"—"}${c.objective?` · ${esc(c.objective)}`:""}</div>
      ${c.deliverables?`<div class="muted" style="margin-top:6px;font-size:13px">📦 ${esc(c.deliverables)}</div>`:""}
      ${c.budget?`<div class="muted" style="font-size:13px">💰 ₹${fmtNum(c.budget)}</div>`:""}
      ${(c.start_date||c.end_date)?`<div class="muted" style="font-size:13px">🗓 ${esc(c.start_date)||"—"} → ${esc(c.end_date)||"—"}</div>`:""}
      <div class="bar" style="margin-top:8px"><span style="width:${prog}%"></span></div>
      <div class="camp-foot"><span class="muted">${prog}% · ${creators} creators</span>
      <span style="display:flex;gap:6px"><button class="mini-btn" data-opencamp="${esc(c.id)}">Open</button><button class="mini-btn ghost" data-editcamp="${esc(c.id)}">Edit</button></span></div></div>`;
  }).join("");
}

async function loadCampaigns(){
  const grid = document.getElementById("campaignGrid");
  if(!grid) return;
  if(!window.sb){ grid.innerHTML = campaignCardsHtml(CAMPAIGNS); return; }
  const org_id = (window.Auth && Auth.profile && Auth.profile.org_id) || null;
  let cq = window.sb.from("campaigns").select("*").order("created_at",{ascending:false});
  if(org_id) cq = cq.eq("org_id", org_id);
  const { data, error } = await cq;
  if(error){ grid.innerHTML = `<div class="card"><div class="muted">Couldn't load campaigns: ${esc(error.message)}</div></div>`; return; }
  grid.innerHTML = campaignCardsHtml(data||[]);
  grid.querySelectorAll("[data-editcamp]").forEach(b=>b.onclick=()=>{ const c=(data||[]).find(x=>x.id===b.dataset.editcamp); if(c) openCampaignModal(c); });
  grid.querySelectorAll("[data-opencamp]").forEach(b=>b.onclick=()=>{ const c=(data||[]).find(x=>x.id===b.dataset.opencamp); if(c) openCampaignWorkspace(c.id); });
}

/* ================= CAMPAIGN WORKSPACE (one campaign, everything connected) ================= */
let _wsCampaign = null;

async function openCampaignWorkspace(id){
  const content = document.querySelector("#content, .content");
  if(!content || !window.sb) return;
  content.innerHTML = `<div class="muted" style="padding:24px">Loading campaign…</div>`;
  // Campaign (org-scoped), applications to it, and barter items linked by campaign name.
  const [cRes, aRes] = await Promise.all([
    sb.from("campaigns").select("*").eq("id", id).maybeSingle(),
    sb.rpc("campaign_applications")
  ]);
  const c = cRes.data;
  if(!c){ content.innerHTML = `<div class="card"><div class="muted">Couldn't open this campaign.</div></div>`; return; }
  _wsCampaign = c;
  const apps = ((aRes && aRes.data) || []).filter(a=>a.campaign_id===id);
  const { data: bdata } = await sb.from("barter_items").select("*").eq("campaign", c.name||"__none__").order("created_at",{ascending:false});
  const barter = bdata||[];
  renderCampaignWorkspace(c, apps, barter);
}

function renderCampaignWorkspace(c, apps, barter){
  const content = document.querySelector("#content, .content");
  const st = {Live:"good","In Production":"brand",Sourcing:"warn",Approval:"warn",Draft:"warn",Completed:"good"}[c.status]||"brand";
  const applied = apps.filter(a=>a.status==="Applied"), approved = apps.filter(a=>a.status==="Approved");
  const info = (l,v)=> v ? `<div class="cd-row"><span class="cd-l">${l}</span><span class="cd-v">${esc(v)}</span></div>` : "";
  // Deliverables checklist from the free-text field.
  const items = (c.deliverables||"").split(/\r?\n|;|,(?![^(]*\))/).map(s=>s.trim()).filter(Boolean);
  const done = Array.isArray(c.deliverables_done) ? c.deliverables_done : [];
  const checklist = items.length ? items.map((it,i)=>`<label class="ws-check"><input type="checkbox" data-deliv="${i}" ${done.includes(it)?"checked":""}> <span${done.includes(it)?' style="text-decoration:line-through;opacity:.6"':''}>${esc(it)}</span></label>`).join("")
    : `<div class="muted" style="padding:6px">No deliverables set — add them via Edit.</div>`;
  const appRow = a=>`<div class="row"><span class="avatar">${esc((a.creator_name||"?").slice(0,2).toUpperCase())}</span>
    <div class="r-main"><div class="r-title">${esc(a.creator_name)||"Creator"}</div><div class="r-sub">${esc(a.creator_org)||""} · ${esc(a.status)}</div></div>
    ${a.status==="Applied"?`<span><button class="mini-btn" data-wsapprove="${esc(a.id)}">Approve</button> <button class="mini-btn ghost" data-wsdecline="${esc(a.id)}">Decline</button></span>`:`<span class="tag ${a.status==="Approved"?"good":""}">${esc(a.status)}</span>`}</div>`;
  const barterRow = b=>`<div class="row"><div class="r-main"><div class="r-title">${esc(b.product||"Item")} ${b.creator?`· ${esc(b.creator)}`:""}</div>
    <div class="r-sub">${esc(b.stage||"Requested")}${b.tracking_number?` · 🚚 ${esc(b.tracking_number)}`:""}${b.deadline?` · ⏰ ${esc(b.deadline)}`:""}</div></div>
    <span class="tag brand">${esc(b.stage||"Requested")}</span></div>`;

  content.innerHTML = `
    <div style="margin-bottom:14px"><button class="btn ghost" id="wsBack">← Campaigns</button></div>
    <div class="page-head"><div><h1>${esc(c.name)} <span class="tag ${st}">${esc(c.status)||"Draft"}</span></h1>
      <p>${[c.brand,c.type,c.objective].filter(Boolean).map(esc).join(" · ")||"Campaign workspace"}</p></div>
      <button class="btn" id="wsEdit">Edit campaign</button></div>

    <div class="ws-stats">
      <div class="ws-stat"><b>${applied.length}</b><span>New applicants</span></div>
      <div class="ws-stat"><b>${approved.length}</b><span>Approved creators</span></div>
      <div class="ws-stat"><b>${barter.length}</b><span>Barter shipments</span></div>
      <div class="ws-stat"><b>${c.budget?fmtMoney(c.budget):"—"}</b><span>Budget</span></div>
    </div>

    <div class="grid two">
      <div class="grid" style="gap:16px">
        <div class="card"><h3>Applicants ${applied.length?`<span class="tag warn">${applied.length} new</span>`:""}</h3>
          <div class="list" id="wsApps">${apps.length?apps.map(appRow).join(""):`<div class="muted" style="padding:8px">No applications yet. Creators apply from the Marketplace.</div>`}</div></div>
        <div class="card"><h3>Barter shipments</h3>
          <div class="list" id="wsBarter">${barter.length?barter.map(barterRow).join(""):`<div class="muted" style="padding:8px">No barter items linked. Create one in Mass Barter with campaign “${esc(c.name)}”.</div>`}</div></div>
      </div>
      <div class="grid" style="gap:16px">
        <div class="card"><h3>Deliverables</h3><div id="wsChecklist">${checklist}</div></div>
        <div class="card"><h3>Details</h3>
          ${info("Platforms", c.platforms)}${info("Hashtags", c.hashtags)}
          ${info("Timeline", (c.start_date||c.end_date)?`${c.start_date||"—"} → ${c.end_date||"—"}`:"")}
          ${c.brief?`<div class="cd-block"><div class="cd-l">Brief</div><div class="cd-body">${esc(c.brief)}</div></div>`:""}</div>
      </div>
    </div>`;

  document.getElementById("wsBack").onclick = ()=>{ currentPage="campaigns"; renderShell(); };
  document.getElementById("wsEdit").onclick = ()=> openCampaignModal(c);
  const reload = ()=> openCampaignWorkspace(c.id);
  content.querySelectorAll("[data-wsapprove]").forEach(b=>b.onclick=()=>updateStatus("applications", b.dataset.wsapprove, {status:"Approved"}, reload));
  content.querySelectorAll("[data-wsdecline]").forEach(b=>b.onclick=()=>updateStatus("applications", b.dataset.wsdecline, {status:"Declined"}, reload));
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

function openCampaignModal(existing){
  const ed = existing || {};
  const opt = (arr,val)=>arr.map(o=>`<option${o===val?' selected':''}>${o}</option>`).join("");
  let m = document.getElementById("campaignModal"); if(m) m.remove();
  m = el("div","modal-overlay"); m.id="campaignModal";
  m.innerHTML = `<div class="modal modal-lg">
    <div class="modal-head"><strong>${existing?'Edit Campaign':'New Campaign'}</strong><button class="icon-btn" id="cmClose">✕</button></div>
    <form id="campaignForm" class="modal-form">
      <div class="mf-row"><label>Campaign name<input name="name" required value="${esc(ed.name||'')}" placeholder="Summer Glow Launch"></label>
      <label>Brand<input name="brand" value="${esc(ed.brand||'')}" placeholder="Lume Cosmetics"></label></div>
      <div class="mf-row"><label>Type<select name="type">${opt(["Paid Campaign","Mass Barter","Turnkey Barter","Celebrity Story","UGC","Product Seeding","Hybrid"], ed.type)}</select></label>
      <label>Objective<select name="objective">${opt(["Awareness","Engagement","Sales / Conversions","UGC content","Product launch","App installs","Store visits"], ed.objective)}</select></label></div>
      <div class="mf-row"><label>Status<select name="status">${opt(["Draft","Sourcing","Approval","In Production","Live","Completed"], ed.status)}</select></label>
      <label>Budget (₹)<input name="budget" type="number" min="0" value="${ed.budget!=null?esc(ed.budget):''}" placeholder="100000"></label></div>
      <div class="mf-row"><label>Platforms<input name="platforms" value="${esc(ed.platforms||'')}" placeholder="Instagram, YouTube"></label>
      <label>Hashtags<input name="hashtags" value="${esc(ed.hashtags||'')}" placeholder="#summerglow #ad"></label></div>
      <label>Deliverables<textarea name="deliverables" rows="2" placeholder="e.g. 2 Reels + 3 Stories + 1 Static post">${esc(ed.deliverables||'')}</textarea></label>
      <label>Brief / notes<textarea name="brief" rows="3" placeholder="Goals, key messaging, dos & don'ts, references…">${esc(ed.brief||'')}</textarea></label>
      <div class="mf-row"><label>Start date<input name="start_date" type="date" value="${esc(ed.start_date||'')}"></label>
      <label>End date<input name="end_date" type="date" value="${esc(ed.end_date||'')}"></label></div>
      <div class="mf-row"><label>Progress %<input name="progress" type="number" min="0" max="100" value="${ed.progress!=null?esc(ed.progress):''}" placeholder="0"></label>
      <label>Creators<input name="creators" type="number" min="0" value="${ed.creators!=null?esc(ed.creators):''}" placeholder="0"></label></div>
      <div class="auth-err" id="cmErr"></div>
      <button class="btn" type="submit">${existing?'Save changes':'Launch Campaign'}</button>
    </form></div>`;
  document.body.appendChild(m); m.classList.add("open");
  m.onclick = e=>{ if(e.target.id==="campaignModal") m.classList.remove("open"); };
  document.getElementById("cmClose").onclick = ()=> m.classList.remove("open");
  document.getElementById("campaignForm").onsubmit = async e=>{
    e.preventDefault();
    const f = new FormData(e.target), err = document.getElementById("cmErr");
    const btn = e.target.querySelector("button[type=submit]");
    err.textContent=""; btn.disabled=true; btn.textContent="Saving…";
    const row = { name:f.get("name"), brand:f.get("brand"), type:f.get("type"), objective:f.get("objective"),
      status:f.get("status"), budget:parseFloat(f.get("budget"))||null, platforms:f.get("platforms"),
      hashtags:f.get("hashtags"), deliverables:f.get("deliverables"), brief:f.get("brief"),
      start_date:f.get("start_date")||null, end_date:f.get("end_date")||null,
      progress:parseInt(f.get("progress"))||0, creators:parseInt(f.get("creators"))||0 };
    try{
      if(!window.sb) throw new Error("Database not connected.");
      let error;
      if(existing){ ({ error } = await sb.from("campaigns").update(row).eq("id", existing.id)); }
      else { if(window.Auth&&Auth.profile){ row.org_name=Auth.profile.org; row.org_id=Auth.profile.org_id; } ({ error } = await sb.from("campaigns").insert(row)); }
      if(error) throw error;
      m.classList.remove("open"); await loadCampaigns();
    }catch(ex){ err.textContent = ex.message||"Couldn't save."; btn.disabled=false; btn.textContent=existing?'Save changes':'Launch Campaign'; }
  };
}

function renderReports(){
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
  html += `<div class="card" style="margin-top:16px"><h3>Deal Pipeline</h3>
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
function renderApprovals(){
  let html = pageHead("Approvals","Campaigns & creator applications awaiting sign-off.");
  html += `<div class="grid two">
    <div class="card"><h3>Campaigns awaiting approval</h3><div class="list" id="campApprovals"><div class="muted" style="padding:8px">Loading…</div></div></div>
    <div class="card"><h3>Creator applications</h3><div class="list" id="appApprovals"><div class="muted" style="padding:8px">Loading…</div></div></div>
  </div>`;
  return html;
}
async function loadApprovals(){
  if(!window.sb) return;
  const camps=document.getElementById("campApprovals"), apps=document.getElementById("appApprovals");
  const [c,a] = await Promise.all([
    sb.from("campaigns").select("*").eq("status","Approval").order("created_at",{ascending:false}),
    sb.from("applications").select("*").eq("status","Applied").order("created_at",{ascending:false})
  ]);
  const cl=c.data||[], al=a.data||[];
  if(camps){ camps.innerHTML = cl.length ? cl.map(x=>`<div class="row"><div class="r-main"><div class="r-title">${esc(x.name)}</div><div class="r-sub">${esc(x.brand)||"—"} · ${esc(x.type)||""}</div></div>
    <span><button class="mini-btn" data-capprove="${esc(x.id)}">Approve</button> <button class="mini-btn ghost" data-creject="${esc(x.id)}">Reject</button></span></div>`).join("") : `<div class="muted" style="padding:8px">Nothing awaiting approval 🎉</div>`; }
  if(apps){ apps.innerHTML = al.length ? al.map(x=>`<div class="row"><div class="r-main"><div class="r-title">${esc(x.creator_name)||"Creator"}</div><div class="r-sub">${esc(x.campaign_name)||""}</div></div>
    <span><button class="mini-btn" data-aapprove="${esc(x.id)}">Approve</button> <button class="mini-btn ghost" data-adecline="${esc(x.id)}">Decline</button></span></div>`).join("") : `<div class="muted" style="padding:8px">No pending applications.</div>`; }
  document.querySelectorAll("[data-capprove]").forEach(b=>b.onclick=()=>updateStatus("campaigns", b.dataset.capprove, {status:"Sourcing"}, loadApprovals));
  document.querySelectorAll("[data-creject]").forEach(b=>b.onclick=()=>updateStatus("campaigns", b.dataset.creject, {status:"Draft"}, loadApprovals));
  document.querySelectorAll("[data-aapprove]").forEach(b=>b.onclick=()=>updateStatus("applications", b.dataset.aapprove, {status:"Approved"}, loadApprovals));
  document.querySelectorAll("[data-adecline]").forEach(b=>b.onclick=()=>updateStatus("applications", b.dataset.adecline, {status:"Declined"}, loadApprovals));
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
  const map={}; const active=["Live","In Production","Sourcing","Approval"];
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
  html += `<div class="card"><h3>Shipments</h3><div class="list" id="logRows"><div class="muted" style="padding:8px">Loading…</div></div></div>`;
  return html;
}
async function loadLogistics(){
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
  let html = pageHead("Media Kit","Your Instagram, auto-built into a professional, shareable kit.");
  html += `<div id="mkBody"><div class="card"><div class="muted">Loading…</div></div></div>`;
  return html;
}

function mkNotConnected(){
  return `<div class="card mk-connect">
    <div class="mk-connect-ic">📸</div>
    <h2 style="margin:6px 0">Build your media kit in seconds</h2>
    <p class="muted" style="max-width:440px;margin:0 auto 16px">Connect your Instagram Business or Creator account and we'll auto-generate a professional media kit — followers, engagement, top posts — and let you publish right from here.</p>
    <button class="btn big" id="mkConnect">Connect Instagram</button>
    <div class="muted" style="font-size:12px;margin-top:12px">We never see your password. Disconnect anytime.</div>
  </div>`;
}

function mkEdits(a){ return (a && a.edits && typeof a.edits==="object" && !Array.isArray(a.edits)) ? a.edits : {}; }

function mkHead(a){
  const E = mkEdits(a);
  const media = Array.isArray(a.recent_media) ? a.recent_media : [];
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
  const sorted = [...media].sort((x,y)=>eng(y)-eng(x));
  const postCard = (m,meta)=>{
    const img = m.media_type==="VIDEO" ? (m.thumbnail_url||m.media_url) : m.media_url;
    const badge = m.media_type==="VIDEO" ? "▶" : (m.media_type==="CAROUSEL_ALBUM" ? "❏" : "");
    return `<a href="${esc(safeUrl(m.permalink))}" target="_blank" rel="noopener" class="mk-post">
      <img src="${esc(safeUrl(img))}" alt="" loading="lazy">${badge?`<span class="mk-type">${badge}</span>`:""}
      <span class="mk-meta">${meta||`❤ ${fmtNum(m.like_count)} · 💬 ${fmtNum(m.comments_count)}`}</span></a>`;
  };
  const posts = media.slice(0,9).map(m=>postCard(m)).join("");
  const tops = sorted.slice(0,3).map(m=>postCard(m)).join("");

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
  const mentionCards = mentions.slice(0,6).map(m=>postCard(m, "@"+(esc(m.username)||"tagged"))).join("");

  // Work portfolio (editable)
  const portfolio = Array.isArray(E.portfolio)?E.portfolio:[];
  const portfolioHtml = portfolio.length
    ? `<div class="mk-portfolio">${portfolio.map(p=>`<div class="mk-brand"><div class="mk-brand-ic">${esc((p.brand||'?').slice(0,2).toUpperCase())}</div><div class="mk-brand-b"><div class="mk-brand-n">${esc(p.brand)}</div>${p.note?`<div class="muted" style="font-size:12px">${esc(p.note)}</div>`:''}</div>${p.url?`<a href="${esc(safeUrl(p.url))}" target="_blank" rel="noopener" class="mk-brand-link">↗</a>`:''}</div>`).join("")}</div>`
    : `<div class="muted" style="padding:8px">No collaborations yet — click <b>Edit</b> to showcase brands you've worked with.</div>`;

  // Rate card (editable)
  const rates = Array.isArray(E.rate_card)?E.rate_card:[];
  const rateHtml = rates.length
    ? `<table class="mk-rates"><tbody>${rates.map(r=>`<tr><td>${esc(r.item)}</td><td class="mk-rate-p">${esc(r.price)}</td></tr>`).join("")}</tbody></table>`
    : `<div class="muted" style="padding:8px">No rate card yet — click <b>Edit</b> to add your rates.</div>`;

  return `<div class="mk-kit">
    <div class="mk-cover">
      <div class="mk-cover-grad"></div>
      <div class="mk-hero">
        ${a.profile_picture_url?`<img class="mk-avatar" src="${esc(safeUrl(a.profile_picture_url))}" alt="">`:`<div class="mk-avatar mk-ph">${initials}</div>`}
        <div class="mk-hero-id">
          <div class="mk-name">${esc(a.name)||esc(a.username)} ${a.account_type?`<span class="mk-badge">${esc(a.account_type)}</span>`:""}</div>
          <div class="mk-handle">@${esc(a.username)}</div>
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

    <div class="mk-cols">
      <div class="card mk-section"><div class="mk-sec-head"><h3>Audience</h3></div>
        ${hasAudience ? `
          ${audGA.length?`<div class="mk-sub">Age &amp; gender</div>${audGA.map(x=>barRow(x.k,x.pct)).join("")}`:''}
          ${audCountries.length?`<div class="mk-sub" style="margin-top:12px">Top countries</div>${audCountries.map(x=>barRow(x.k,x.pct)).join("")}`:''}
          ${audCities.length?`<div class="mk-sub" style="margin-top:12px">Top cities</div>${audCities.map(x=>barRow(x.k,x.pct)).join("")}`:''}
        ` : `<div class="muted" style="padding:8px">Audience demographics appear automatically once your Instagram Insights sync (needs 100+ followers and approved insights access).</div>`}
      </div>
      <div class="card mk-section"><div class="mk-sec-head"><h3>Rate card</h3>${editBtn("ratecard")}</div>${rateHtml}</div>
    </div>

    ${tops?`<div class="card mk-section"><h3>Top performing posts</h3><div class="mk-grid">${tops}</div></div>`:""}

    <div class="card mk-section"><div class="mk-sec-head"><h3>Work portfolio</h3>${editBtn("portfolio")}</div>${portfolioHtml}</div>

    <div class="card mk-section"><h3>Mentions</h3>
      ${mentionCards ? `<div class="mk-grid">${mentionCards}</div>` : `<div class="muted" style="padding:8px">Posts where brands &amp; others tag you will appear here once they're available from Instagram.</div>`}</div>

    <div class="card mk-section"><h3>Content showcase</h3>
      ${posts?`<div class="mk-grid">${posts}</div>`:`<div class="muted" style="padding:8px">No posts yet.</div>`}</div>

    <div class="card mk-section mk-collab">
      <div><h3 style="margin:0 0 2px">Work with ${firstName}</h3>
        <div class="muted">Barters, paid campaigns &amp; brand collaborations — managed end-to-end in Geek Influencer OS.</div></div>
      <button class="btn" id="mkComposeCta">Create a post →</button>
    </div>`;
}

function openMkEdit(section, acct){
  const E = mkEdits(acct);
  let title="Edit", fields="";
  if(section==="profile"){
    title="Edit profile";
    fields = `<label>Headline / tagline<input name="headline" value="${esc(E.headline||'')}" placeholder="Tech &amp; lifestyle creator · Mumbai"></label>
      <label>Bio<textarea name="bio" rows="3" placeholder="Short bio…">${esc(E.bio||acct.biography||'')}</textarea></label>`;
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
    if(section==="profile"){ newEdits.headline=(f.get("headline")||"").trim(); newEdits.bio=(f.get("bio")||"").trim(); }
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
  return `<div class="card" style="margin-top:16px"><h3>Create a post</h3>
    <p class="muted" style="margin-bottom:10px">Upload an image and caption — it publishes straight to your Instagram.</p>
    <form id="mkComposer" class="modal-form">
      <label>Image<input type="file" name="image" accept="image/*" required></label>
      <label>Caption<textarea name="caption" rows="3" placeholder="Write a caption… #barter"></textarea></label>
      <div class="auth-err" id="mkErr"></div>
      <div class="lead-msg" id="mkMsg"></div>
      <button class="btn" type="submit">Publish to Instagram →</button>
    </form></div>`;
}

async function loadMediaKit(){
  const wrap = document.getElementById("mkBody");
  if(!wrap) return;
  const showConnect = ()=>{ wrap.innerHTML = mkNotConnected(); const b=document.getElementById("mkConnect"); if(b) b.onclick=connectInstagram; };
  if(!window.sb){ showConnect(); return; }
  const memberId = (window.Auth && Auth.profile && Auth.profile.id) || null;
  if(!memberId){ showConnect(); return; }
  const { data, error } = await sb.from("social_accounts").select("*").eq("platform","instagram").eq("member_id", memberId)
    .order("updated_at",{ascending:false}).limit(1);
  const acct = (data && data[0]) || null;
  if(error || !acct){ showConnect(); return; }
  wrap.innerHTML = mkHead(acct) + mkComposer();
  wireMkComposer();
  const share = document.getElementById("mkShare");
  if(share) share.onclick = async ()=>{
    const url = location.origin + location.pathname.replace(/[^/]*$/,"") + "p.html?u=" + encodeURIComponent(acct.username||"");
    try{ await navigator.clipboard.writeText(url); share.textContent="Copied!"; setTimeout(()=>share.textContent="Share kit",1500); }
    catch(e){ prompt("Your public media kit link:", url); }
  };
  const cta = document.getElementById("mkComposeCta");
  if(cta) cta.onclick = ()=>{ const c=document.getElementById("mkComposer"); if(c) c.scrollIntoView({behavior:"smooth"}); };
  wrap.querySelectorAll("[data-mkedit]").forEach(b=> b.onclick = ()=> openMkEdit(b.dataset.mkedit, acct));
  // Lazily refresh the Instagram token + re-sync stats if this kit is stale (>7 days).
  if(acct.updated_at && (Date.now() - new Date(acct.updated_at).getTime()) > 7*86400*1000){
    sb.functions.invoke("instagram-refresh").catch(()=>{});
  }
}

function wireMkComposer(){
  const form = document.getElementById("mkComposer");
  if(!form) return;
  form.onsubmit = async e=>{
    e.preventDefault();
    const f = new FormData(form), err=document.getElementById("mkErr"), msg=document.getElementById("mkMsg");
    const btn = form.querySelector("button[type=submit]");
    err.textContent=""; msg.textContent=""; msg.className="lead-msg";
    const file = f.get("image");
    if(!file || !file.size){ err.textContent="Pick an image first."; return; }
    btn.disabled=true; btn.textContent="Uploading…";
    try{
      if(!window.sb) throw new Error("Not connected.");
      const uid = window.Auth && Auth.profile && Auth.profile.id;
      if(!uid) throw new Error("You're signed out. Sign in again to publish.");
      const safe = (file.name||"post.jpg").replace(/[^a-zA-Z0-9._-]/g,"");
      const path = `${uid}/${Date.now()}-${safe}`;
      const up = await sb.storage.from("ig-media").upload(path, file, { upsert:false, contentType:file.type||"image/jpeg" });
      if(up.error) throw up.error;
      const { data:pub } = sb.storage.from("ig-media").getPublicUrl(path);
      btn.textContent="Publishing…";
      const { data, error } = await sb.functions.invoke("instagram-publish", { body:{ image_url: pub.publicUrl, caption: f.get("caption")||"" } });
      if(error) throw new Error(await fnError(error));
      if(data && data.error) throw new Error(data.error);
      msg.textContent="Posted to Instagram ✅"; msg.className="lead-msg ok"; form.reset();
    }catch(ex){
      err.textContent = (ex.message||ex);
    }finally{
      btn.disabled=false; btn.textContent="Publish to Instagram →";
    }
  };
}

/* ================= ADMIN (platform team — approve agency signups) ================= */
/* ================= SUPER ADMIN CONSOLE ================= */
const ADMIN_TABS = [["overview","Overview"],["orgs","Workspaces"],["data","Data browser"],["audit","Audit log"],["check","System check"],["approvals","Approvals"],["admins","Super admins"]];
const ADMIN_TABLES = [
  ["members","Members"],["creators","Creators"],["campaigns","Campaigns"],["barter_items","Barter items"],
  ["applications","Applications"],["invites","Invites"],["irm_contacts","IRM contacts"],
  ["story_deals","Celebrity deals"],["dream_plans","Dream plans"],["org_profiles","Org profiles"]
];
const ADMIN_EDITABLE = new Set(["members","creators","campaigns","barter_items","applications","invites","irm_contacts","story_deals","dream_plans"]);
const ADMIN_READONLY_FIELDS = new Set(["id","org_id","created_at","updated_at"]);
let _adminTab = "overview";
let _adminDataTable = "creators";

function renderAdmin(){
  let html = pageHead("Super Admin","Full cross-workspace control — every record, every change, with timestamps.");
  html += `<div class="admin-tabs">${ADMIN_TABS.map(t=>`<button class="${_adminTab===t[0]?'act':''}" data-atab="${t[0]}">${esc(t[1])}</button>`).join("")}</div>`;
  html += `<div id="adminBody"><div class="muted" style="padding:16px">Loading…</div></div>`;
  return html;
}

function loadAdmin(){
  document.querySelectorAll("[data-atab]").forEach(b=> b.onclick = ()=>{ _adminTab = b.dataset.atab; currentPage="admin"; renderShell(); });
  const body = document.getElementById("adminBody");
  if(!body || !window.sb) return;
  ({ overview:adminOverview, orgs:adminOrgs, data:adminData, audit:adminAudit, check:adminSystemCheck, approvals:adminApprovals, admins:adminAdmins }[_adminTab] || adminOverview)(body);
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

async function adminOverview(body){
  body.innerHTML = `<div class="muted" style="padding:16px">Loading…</div>`;
  const { data, error } = await sb.rpc("admin_overview");
  if(error){ body.innerHTML = adminErr(error); return; }
  const o = data||{};
  const card = (v,l)=>`<div class="ws-stat"><b>${fmtNum(v)}</b><span>${l}</span></div>`;
  body.innerHTML = `<div class="ws-stats" style="grid-template-columns:repeat(4,1fr)">
      ${card(o.orgs,"Workspaces")}${card(o.members,"Members")}${card(o.creators,"Creators")}${card(o.campaigns,"Campaigns")}
      ${card(o.barter,"Barter items")}${card(o.applications,"Applications")}${card(o.pending,"Pending approvals")}${card(o.changes_24h,"Changes (24h)")}</div>
    <div class="ai-suggest"><span class="spark">🛡</span><div class="s-body"><b>${fmtNum(o.admins)} super admin${o.admins==1?"":"s"}</b>
      <p>Super admins can read, edit and delete any record across every workspace. Every change is written to the audit log with a timestamp and the actor. Use the tabs above to browse data, review the audit trail, approve signups, or manage admins.</p></div></div>`;
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
  body.innerHTML = `<div class="card"><h3>Awaiting approval</h3><div class="list" id="adminRows"><div class="muted" style="padding:8px">Loading…</div></div></div>`;
  const wrap=document.getElementById("adminRows");
  const { data, error } = await sb.rpc("pending_members");
  if(error){ wrap.innerHTML=adminErr(error); return; }
  const list=data||[];
  if(!list.length){ wrap.innerHTML=`<div class="muted" style="padding:8px">No pending signups 🎉</div>`; return; }
  wrap.innerHTML = list.map(x=>`<div class="row"><div class="r-main"><div class="r-title">${esc(x.name)||esc(x.email)}</div>
    <div class="r-sub">${esc(x.email)} · ${esc(x.role)}${x.org_name?" · "+esc(x.org_name):""}</div></div>
    <span><button class="mini-btn" data-approve="${esc(x.id)}">Approve</button> <button class="mini-btn ghost" data-decline="${esc(x.id)}">Decline</button></span></div>`).join("");
  wrap.querySelectorAll("[data-approve]").forEach(b=>b.onclick=async()=>{ await sb.rpc("set_member_status",{p_id:b.dataset.approve,p_status:"active"}); adminApprovals(body); });
  wrap.querySelectorAll("[data-decline]").forEach(b=>b.onclick=async()=>{ await sb.rpc("set_member_status",{p_id:b.dataset.decline,p_status:"declined"}); adminApprovals(body); });
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
  dashboard:renderDashboard, barter:renderBarter, creators:renderCreators, roster:renderRoster, mediakit:renderMediaKit, admin:renderAdmin,
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
const IG_SCOPES = "instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights,instagram_business_manage_comments";
// Must EXACTLY match the redirect registered in Meta → Instagram login settings.
const IG_REDIRECT = location.origin + location.pathname.replace(/[^/]*$/,"") + "app.html";

function connectInstagram(){
  const state = "instagram:" + Math.random().toString(36).slice(2);
  localStorage.setItem("geekos_oauth_state", state);
  const p = new URLSearchParams({
    client_id: INSTAGRAM_APP_ID,
    redirect_uri: IG_REDIRECT,
    response_type: "code",
    scope: IG_SCOPES,
    state
  });
  location.href = "https://www.instagram.com/oauth/authorize?" + p.toString();
}

// Called after Instagram redirects back with ?code — hands it to the Edge Function.
async function finishInstagram(code){
  try{
    if(!(window.sb && window.sb.functions)) throw new Error("Edge Functions not available.");
    const { data:{ session } } = await sb.auth.getSession();

    if(session){
      // Signed in already → CONNECT this Instagram to the current account.
      const { data, error } = await sb.functions.invoke("instagram-auth", { body:{ code, redirect_uri: IG_REDIRECT } });
      if(error) throw new Error(await fnError(error));
      if(data && data.error) throw new Error(data.error);
      localStorage.setItem("geekos_conn_instagram","1");
      alert("Instagram connected ✅ — your media kit is ready.");
      if(window.Auth) await Auth.currentSession(); // startApp skipped it while __igLoggingIn was set
      currentPage = "mediakit"; if(typeof renderShell==="function") renderShell();
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
    // Remember this device so returning creators get a one-tap "welcome back" (no re-typing).
    try{ localStorage.setItem("geekos_last_name", (Auth.profile && Auth.profile.name) || ""); }catch(e){}
    currentPage = "mediakit";
    if(typeof bootOS==="function") bootOS();
  }catch(ex){
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
  if(state !== expected){ console.warn("OAuth state mismatch — ignoring."); return; }
  localStorage.removeItem("geekos_oauth_state");

  // Instagram Login uses its own Edge Function flow.
  if(platform === "instagram"){ window.__igLoggingIn = true; await finishInstagram(code); return; }

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
    loadCreators();
    const add = document.getElementById("addCreatorBtn");
    if(add) add.onclick = openCreatorModal;
    const imp = document.getElementById("importCreatorBtn");
    const inp = document.getElementById("creatorCsvInput");
    if(imp && inp){ imp.onclick = ()=> inp.click(); inp.onchange = ()=>{ if(inp.files[0]) importCreatorsCsv(inp.files[0]); inp.value=""; }; }
    const smp = document.getElementById("csvSample");
    if(smp) smp.onclick = e=>{ e.preventDefault(); csvSampleDownload(); };
  }
  if(currentPage==="celebrity"){
    loadStories();
    const add = document.getElementById("addStoryBtn");
    if(add) add.onclick = openStoryModal;
  }
  if(currentPage==="irm"){
    loadIRM();
    const add = document.getElementById("addIrmBtn");
    if(add) add.onclick = openIrmModal;
  }
  if(currentPage==="listening") loadListening();
  if(currentPage==="approvals") loadApprovals();
  if(currentPage==="marketplace") loadMarketplace();
  if(currentPage==="brands" || currentPage==="portfolio") loadBrands();
  if(currentPage==="finance") loadFinance();
  if(currentPage==="logistics") loadLogistics();
  if(currentPage==="mediakit") loadMediaKit();
  if(currentPage==="profile" && window.ciProfile) window.ciProfile.load();
  if(currentPage==="growth") loadGrowth();
  if(currentPage==="admin") loadAdmin();
  if(currentPage==="campaigns"){
    loadCampaigns();
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
    loadReportRows();
  }
  if(currentPage==="dashboard"){
    loadDashboard();
  }
  if(currentPage==="barter"){
    loadBarter();
    const add = document.getElementById("addBarterBtn");
    if(add) add.onclick = ()=> openBarterModal();
  }
  // Fill any KPI cards on the page with live values from the database.
  loadKPIs();
}

function renderShell(){
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
async function sendAiMessage(text){
  AI_HISTORY.push({role:"user", content:text});
  AI_HISTORY.push({role:"assistant", content:"…", _pending:true});
  renderAiChat();
  try{
    if(!(window.sb && window.sb.functions)) throw new Error("Not connected.");
    const ctx={ role:currentRole, roleLabel:ROLES[currentRole].name, page:(NAV_META[currentPage]&&NAV_META[currentPage].label)||currentPage,
      name:(window.Auth&&Auth.profile&&Auth.profile.name)||"", org:(window.Auth&&Auth.profile&&Auth.profile.org)||"" };
    const msgs=AI_HISTORY.filter(m=>!m._pending).map(m=>({role:m.role, content:m.content}));
    const { data, error } = await sb.functions.invoke("ai-chat", { body:{ messages:msgs, context:ctx } });
    if(error) throw new Error(await fnError(error));
    if(data && data.error) throw new Error(data.error);
    AI_HISTORY=AI_HISTORY.filter(m=>!m._pending);
    AI_HISTORY.push({role:"assistant", content:(data&&data.reply)||"(no response)"});
  }catch(ex){
    AI_HISTORY=AI_HISTORY.filter(m=>!m._pending);
    AI_HISTORY.push({role:"assistant", content:"Sorry — I couldn't reach the AI. "+(ex.message||ex)+"\n\n(Deploy the ai-chat function and set OPENAI_API_KEY.)"});
  }
  renderAiChat();
}
function closeAi(){ $("#aiOverlay").classList.remove("open"); }

/* ---------- Notifications (real recent activity) ---------- */
async function openNotif(){
  $("#notifOverlay").classList.add("open");
  const body = $("#notifBody");
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
  document.documentElement.setAttribute("data-theme",d?"":"dark");
  $("#themeBtn").textContent=d?"🌙":"☀️";
}

/* ---------- Boot (called after auth) ---------- */
function showPending(){
  const root = document.getElementById("authRoot");
  if(!root) return;
  root.classList.add("open");
  root.innerHTML = `<div class="auth-wrap"><div class="auth-card" style="max-width:420px;text-align:center;margin:auto">
    <div class="brand-mark" style="margin:0 auto 14px">G</div>
    <h2 style="margin-bottom:8px">Your account is under review</h2>
    <p class="muted" style="margin-bottom:18px">Thanks for signing up! Agency, brand & manager accounts are approved by our team before full access — we'll email you as soon as you're in (usually within a day).</p>
    <button class="btn ghost" id="pendingSignout">Sign out</button>
  </div></div>`;
  const b = document.getElementById("pendingSignout"); if(b) b.onclick = ()=> window.Auth && Auth.signOut();
}

function bootOS(){
  // Gate: agency-side accounts awaiting platform approval don't enter the OS.
  if(window.Auth && Auth.profile && Auth.profile.status === "pending"){ showPending(); return; }
  // Seed the signed-in user's role into the shell.
  if(window.Auth && Auth.profile && ROLES[Auth.profile.role]){
    currentRole = Auth.profile.role;
  }
  init();
  // Platform admins get an Admin queue in the nav.
  if(window.sb){ sb.rpc("is_platform_admin").then(({data})=>{ if(data===true){ window.__isAdmin=true; renderNav(); } }).catch(()=>{}); }
}

/* ---------- Wire up ---------- */
function init(){
  initRoles(); renderShell();
  wireSignOut();
  $("#searchTrigger").onclick=openPalette;
  $("#paletteOverlay").onclick=e=>{if(e.target.id==="paletteOverlay")closePalette();};
  $("#paletteInput").oninput=e=>fillPalette(e.target.value);
  $("#paletteInput").onkeydown=e=>{ if(e.key==="Enter"){const sel=$("#paletteResults li[data-key]");if(sel)runPalette(sel.dataset.key);} if(e.key==="Escape")closePalette(); };
  $("#aiLaunch").onclick=openAi; $("#aiClose").onclick=closeAi;
  $("#aiOverlay").onclick=e=>{if(e.target.id==="aiOverlay")closeAi();};
  $("#bellBtn").onclick=openNotif; $("#notifClose").onclick=closeNotif;
  $("#notifOverlay").onclick=e=>{if(e.target.id==="notifOverlay")closeNotif();};
  $("#themeBtn").onclick=toggleTheme;
  $("#menuBtn").onclick=()=>$("#sidebar").classList.toggle("open");
  document.addEventListener("keydown",e=>{ if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==="k"){e.preventDefault();openPalette();} });
}

function wireSignOut(){
  const btn = $("#signOutBtn");
  if(btn) btn.onclick = ()=> window.Auth && Auth.signOut();
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
