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
  ROLES[currentRole].nav.forEach(key=>{
    const m = NAV_META[key];
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
      sb.from("dream_plans").select("*").order("created_at",{ascending:false}).limit(1),
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
  }
  renderTasks(campaigns, barter);
  renderActivity(buildActivityItems(creators, campaigns, barter));
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
  const sub = [c.creator, c.value?("₹"+fmtNum(c.value)):null].filter(Boolean).join(" · ");
  return `<div class="kan-card"><div class="kc-name">${esc(c.product||c.creator||"Barter item")}</div>
    <div class="kc-sub">${esc(sub)||"—"}</div>
    ${next?`<button class="mini-btn" data-advance="${esc(c.id)}" data-next="${esc(next)}" style="margin-top:8px">Move to ${esc(next)} →</button>`:""}</div>`;
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
  wrap.querySelectorAll("button[data-advance]").forEach(b=>{
    b.onclick = ()=> advanceBarter(b.dataset.advance, b.dataset.next);
  });
}

async function advanceBarter(id, nextStage){
  if(!window.sb) return;
  const { error } = await sb.from("barter_items").update({stage:nextStage}).eq("id", id);
  if(!error) loadBarter();
}

function openBarterModal(){
  let m = document.getElementById("barterModal");
  if(!m){
    m = el("div","modal-overlay"); m.id="barterModal";
    m.innerHTML = `<div class="modal">
      <div class="modal-head"><strong>New Barter Item</strong><button class="icon-btn" id="bmClose">✕</button></div>
      <form id="barterForm" class="modal-form">
        <div class="mf-row"><label>Product<input name="product" required placeholder="Nykaa Lip Kit"></label>
        <label>Creator<input name="creator" placeholder="Aarav Mehta"></label></div>
        <div class="mf-row"><label>Campaign<input name="campaign" placeholder="Summer Glow"></label>
        <label>Stage<select name="stage">${BARTER_STAGES.map(s=>`<option>${s}</option>`).join("")}</select></label></div>
        <div class="mf-row"><label>Value (₹)<input name="value" type="number" min="0" placeholder="5000"></label>
        <label>Est. Reach<input name="reach" type="number" min="0" placeholder="120000"></label></div>
        <div class="auth-err" id="bmErr"></div>
        <button class="btn" type="submit">Add to Pipeline</button>
      </form></div>`;
    document.body.appendChild(m);
  }
  m.classList.add("open");
  m.onclick = e=>{ if(e.target.id==="barterModal") m.classList.remove("open"); };
  document.getElementById("bmClose").onclick = ()=> m.classList.remove("open");
  const form = document.getElementById("barterForm");
  form.onsubmit = async e=>{
    e.preventDefault();
    const f = new FormData(form), err = document.getElementById("bmErr");
    const btn = form.querySelector("button[type=submit]");
    err.textContent=""; btn.disabled=true; btn.textContent="Saving…";
    const row = { product:f.get("product"), creator:f.get("creator"), campaign:f.get("campaign"),
      stage:f.get("stage")||"Requested", value:parseFloat(f.get("value"))||null, reach:parseFloat(f.get("reach"))||null };
    if(window.Auth && Auth.profile){ row.org_name = Auth.profile.org; row.org_id = Auth.profile.org_id; }
    try{
      if(!window.sb) throw new Error("Database not connected yet.");
      const { error } = await sb.from("barter_items").insert(row);
      if(error) throw error;
      m.classList.remove("open");
      await loadBarter();
    }catch(ex){
      err.textContent = ex.message || "Couldn't save.";
      btn.disabled=false; btn.textContent="Add to Pipeline";
    }
  };
}

function renderCreators(){
  let html = pageHead("Creators","Discovery & roster — AI-matched to your campaigns.",`<span id="addCreatorBtn">+ Add Creator</span>`);
  html += `<div class="card"><table><thead><tr><th>Creator</th><th>City</th><th>Tier</th><th>Followers</th><th>Engagement</th><th>Category</th><th>Rating</th></tr></thead>
    <tbody id="creatorRows"><tr><td colspan="7" class="muted" style="padding:24px">Loading creators…</td></tr></tbody></table></div>`;
  return html;
}

function creatorRowsHtml(list){
  if(!list.length) return `<tr><td colspan="7" class="muted" style="padding:24px">No creators yet — add your first one 👆</td></tr>`;
  return list.map(c=>`<tr><td><span class="avatar">${esc((c.name||"?").split(" ").map(x=>x[0]).join("").slice(0,2))}</span>${esc(c.name)}</td>
    <td>${esc(c.city)||"—"}</td><td><span class="tag brand">${esc(c.tier)||"—"}</span></td><td>${esc(c.followers)||"—"}</td><td>${esc(c.eng)||"—"}</td><td>${esc(c.cat)||"—"}</td><td>⭐ ${esc(c.rating)||"—"}</td></tr>`).join("");
}

async function loadCreators(){
  const tbody = document.getElementById("creatorRows");
  if(!tbody) return;
  if(!window.sb){
    // No DB connected — show mock roster.
    tbody.innerHTML = creatorRowsHtml(CREATORS);
    return;
  }
  const org_id = (window.Auth && Auth.profile && Auth.profile.org_id) || null;
  let q = window.sb.from("creators").select("*").order("created_at",{ascending:false});
  if(org_id) q = q.eq("org_id", org_id);
  const { data, error } = await q;
  if(error){ tbody.innerHTML = `<tr><td colspan="7" class="muted" style="padding:24px">Couldn't load creators: ${esc(error.message)}</td></tr>`; return; }
  tbody.innerHTML = creatorRowsHtml(data||[]);
}

function openCreatorModal(){
  let m = document.getElementById("creatorModal");
  if(!m){
    m = el("div","modal-overlay"); m.id="creatorModal";
    m.innerHTML = `<div class="modal">
      <div class="modal-head"><strong>Add Creator</strong><button class="icon-btn" id="ccClose">✕</button></div>
      <form id="creatorForm" class="modal-form">
        <div class="mf-row"><label>Name<input name="name" required placeholder="Ananya Sharma"></label>
        <label>City<input name="city" placeholder="Delhi"></label></div>
        <div class="mf-row"><label>Tier<select name="tier"><option>Micro</option><option>Mid</option><option>Macro</option><option>Celebrity</option></select></label>
        <label>Category<input name="cat" placeholder="Fashion"></label></div>
        <div class="mf-row"><label>Followers<input name="followers" placeholder="128K"></label>
        <label>Engagement<input name="eng" placeholder="4.2%"></label></div>
        <div class="mf-row"><label>Rating<input name="rating" placeholder="4.8"></label>
        <label>Handle<input name="handle" placeholder="@ananya"></label></div>
        <div class="auth-err" id="ccErr"></div>
        <button class="btn" type="submit">Save Creator</button>
      </form></div>`;
    document.body.appendChild(m);
  }
  m.classList.add("open");
  m.onclick = e=>{ if(e.target.id==="creatorModal") m.classList.remove("open"); };
  document.getElementById("ccClose").onclick = ()=> m.classList.remove("open");
  const form = document.getElementById("creatorForm");
  form.onsubmit = async e=>{
    e.preventDefault();
    const f = new FormData(form), err = document.getElementById("ccErr");
    const btn = form.querySelector("button[type=submit]");
    err.textContent=""; btn.disabled=true; btn.textContent="Saving…";
    const row = { name:f.get("name"), city:f.get("city"), tier:f.get("tier"), cat:f.get("cat"),
      followers:f.get("followers"), eng:f.get("eng"), rating:f.get("rating")||null, handle:f.get("handle") };
    if(window.Auth && Auth.profile){ row.org_name = Auth.profile.org; row.org_id = Auth.profile.org_id; }
    try{
      if(!window.sb) throw new Error("Database not connected yet.");
      const { error } = await window.sb.from("creators").insert(row);
      if(error) throw error;
      m.classList.remove("open");
      await loadCreators();
    }catch(ex){
      err.textContent = ex.message || "Couldn't save.";
      btn.disabled=false; btn.textContent="Save Creator";
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
    const st = {Live:"good","In Production":"brand",Sourcing:"warn",Approval:"warn",Draft:"warn"}[c.status]||"brand";
    const prog = Math.max(0, Math.min(100, parseInt(c.progress)||0));
    const creators = parseInt(c.creators)||0;
    return `<div class="card"><h3>${esc(c.name)}<span class="tag ${st}">${esc(c.status)||"Draft"}</span></h3>
      <div class="muted">${esc(c.brand)||"—"} · ${esc(c.type)||"—"}</div>
      <div class="bar"><span style="width:${prog}%"></span></div>
      <div class="muted" style="margin-top:8px">${prog}% complete · ${creators} creators</div></div>`;
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
}

function openCampaignModal(){
  let m = document.getElementById("campaignModal");
  if(!m){
    m = el("div","modal-overlay"); m.id="campaignModal";
    m.innerHTML = `<div class="modal">
      <div class="modal-head"><strong>New Campaign</strong><button class="icon-btn" id="cmClose">✕</button></div>
      <form id="campaignForm" class="modal-form">
        <div class="mf-row"><label>Campaign name<input name="name" required placeholder="Summer Glow Launch"></label>
        <label>Brand<input name="brand" placeholder="Lume Cosmetics"></label></div>
        <div class="mf-row"><label>Type<select name="type">
          <option>Paid Campaign</option><option>Mass Barter</option><option>Turnkey Barter</option>
          <option>Celebrity Story</option><option>UGC</option><option>Product Seeding</option><option>Hybrid</option>
        </select></label>
        <label>Status<select name="status"><option>Draft</option><option>Sourcing</option><option>Approval</option><option>In Production</option><option>Live</option></select></label></div>
        <div class="mf-row"><label>Progress %<input name="progress" type="number" min="0" max="100" placeholder="0"></label>
        <label>Creators<input name="creators" type="number" min="0" placeholder="0"></label></div>
        <div class="auth-err" id="cmErr"></div>
        <button class="btn" type="submit">Launch Campaign</button>
      </form></div>`;
    document.body.appendChild(m);
  }
  m.classList.add("open");
  m.onclick = e=>{ if(e.target.id==="campaignModal") m.classList.remove("open"); };
  document.getElementById("cmClose").onclick = ()=> m.classList.remove("open");
  const form = document.getElementById("campaignForm");
  form.onsubmit = async e=>{
    e.preventDefault();
    const f = new FormData(form), err = document.getElementById("cmErr");
    const btn = form.querySelector("button[type=submit]");
    err.textContent=""; btn.disabled=true; btn.textContent="Launching…";
    const row = { name:f.get("name"), brand:f.get("brand"), type:f.get("type"), status:f.get("status"),
      progress:parseInt(f.get("progress"))||0, creators:parseInt(f.get("creators"))||0 };
    if(window.Auth && Auth.profile){ row.org_name = Auth.profile.org; row.org_id = Auth.profile.org_id; }
    try{
      if(!window.sb) throw new Error("Database not connected yet.");
      const { error } = await window.sb.from("campaigns").insert(row);
      if(error) throw error;
      m.classList.remove("open");
      await loadCampaigns();
    }catch(ex){
      err.textContent = ex.message || "Couldn't save.";
      btn.disabled=false; btn.textContent="Launch Campaign";
    }
  };
}

function renderReports(){
  let html = pageHead("Reports","Live campaign performance for your org.","Export");
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
  const { data } = await sb.from("dream_plans").select("*").order("created_at",{ascending:false}).limit(1);
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
  const { error } = await sb.from(table).update(patch).eq("id", id);
  if(!error && cb) cb();
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
  html += `<div class="grid three" id="marketGrid"><div class="card"><div class="muted">Loading…</div></div></div>`;
  return html;
}
async function loadMarketplace(){
  const grid=document.getElementById("marketGrid");
  if(!grid) return;
  if(!window.sb){ grid.innerHTML=`<div class="card"><div class="muted">Connect the database.</div></div>`; return; }
  // Open campaigns across all orgs come from a dedicated read-only function (keeps campaigns RLS org-scoped).
  const { data, error } = await sb.rpc("open_campaigns");
  if(error){ grid.innerHTML=`<div class="card"><div class="muted">Couldn't load: ${esc(error.message)}</div></div>`; return; }
  const list=data||[];
  if(!list.length){ grid.innerHTML=`<div class="card"><div class="ai-suggest"><span class="spark">🛒</span><div class="s-body"><b>No open campaigns yet</b><p>Campaigns in Sourcing or Live status show here to apply to.</p></div></div></div>`; return; }
  const mine = (window.Auth && Auth.profile && Auth.profile.org_id) || null;
  grid.innerHTML = list.map(c=>{
    const own = mine && c.org_id === mine; // don't let a creator "apply" to their own org's campaign
    return `<div class="card"><h3>${esc(c.name)}<span class="tag good">${esc(c.status)}</span></h3>
    <div class="muted">${esc(c.brand)||"—"} · ${esc(c.type)||"—"}${c.org_name?` · ${esc(c.org_name)}`:""}</div>
    ${own?`<div class="muted" style="margin-top:10px;font-size:12px">Your campaign</div>`:`<button class="btn" data-apply="${esc(c.id)}" data-name="${esc(c.name)}" data-agency="${esc(c.org_id)}" style="margin-top:10px">Apply →</button>`}</div>`;
  }).join("");
  grid.querySelectorAll("button[data-apply]").forEach(b=>b.onclick=()=>applyToCampaign(b.dataset.apply, b.dataset.name, b.dataset.agency, b));
}
async function applyToCampaign(id, name, agencyOrgId, btn){
  if(!window.sb) return;
  btn.disabled=true; btn.textContent="Applying…";
  const row={ campaign_id:id, campaign_name:name, agency_org_id:agencyOrgId||null,
    creator_name:(window.Auth&&Auth.profile&&Auth.profile.name)||"Creator", status:"Applied" };
  if(window.Auth&&Auth.profile){ row.org_name=Auth.profile.org; row.org_id=Auth.profile.org_id; }
  const { error } = await sb.from("applications").insert(row);
  btn.textContent = error ? "Try again" : "✓ Applied"; if(!error) btn.classList.add("ghost");
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
  let html = pageHead("Finance","Barter value, EMV & celebrity deal economics.","Export");
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
  html += `<div class="card"><table><thead><tr><th>Contact</th><th>Type</th><th>Status</th><th>Health</th><th>Last touch</th></tr></thead>
    <tbody id="irmRows"><tr><td colspan="5" class="muted" style="padding:24px">Loading…</td></tr></tbody></table></div>`;
  return html;
}
function irmHealthBar(h){ h=Math.max(0,Math.min(100,parseInt(h)||0)); return `<div class="bar" style="width:90px;display:inline-block;vertical-align:middle"><span style="width:${h}%"></span></div> <span class="muted">${h}</span>`; }
async function loadIRM(){
  const body=document.getElementById("irmRows");
  if(!body||!window.sb) return;
  const { data, error } = await sb.from("irm_contacts").select("*").order("created_at",{ascending:false});
  if(error){ body.innerHTML=`<tr><td colspan="5" class="muted" style="padding:24px">IRM isn't set up yet (run the latest DATABASE_SETUP.sql). ${esc(error.message)}</td></tr>`; return; }
  const list=data||[];
  body.innerHTML = list.length ? list.map(x=>`<tr><td><span class="avatar">${esc((x.name||"?").slice(0,2).toUpperCase())}</span>${esc(x.name)}</td>
    <td><span class="tag brand">${esc(x.kind||"Creator")}</span></td>
    <td>${esc(x.status||"New")}</td>
    <td>${irmHealthBar(x.health)}</td>
    <td>${esc(x.last_touch)||"—"}</td></tr>`).join("") : `<tr><td colspan="5" class="muted" style="padding:24px">No contacts yet — add your first relationship 👆</td></tr>`;
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
        <label>Notes<input name="notes" placeholder="Prefers WhatsApp; likes tech barters"></label>
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
      last_touch:f.get("last_touch")||null, handle:f.get("handle"), notes:f.get("notes") };
    if(window.Auth&&Auth.profile){ row.org_id=Auth.profile.org_id; }
    try{ if(!window.sb) throw new Error("Database not connected."); const { error }=await sb.from("irm_contacts").insert(row); if(error) throw error;
      m.classList.remove("open"); await loadIRM();
    }catch(ex){ err.textContent=ex.message||"Couldn't save."; btn.disabled=false; btn.textContent="Add Contact"; }
  };
}

/* ================= ROSTER (talent manager — reuse creators) ================= */
function renderRoster(){
  return pageHead("My Roster","Your talent — manage & match to briefs.",`<span id="addCreatorBtn">+ Add Creator</span>`) +
    `<div class="card"><table><thead><tr><th>Creator</th><th>City</th><th>Tier</th><th>Followers</th><th>Engagement</th><th>Category</th><th>Rating</th></tr></thead>
    <tbody id="creatorRows"><tr><td colspan="7" class="muted" style="padding:24px">Loading…</td></tr></tbody></table></div>`;
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
      <img src="${esc(img)}" alt="" loading="lazy">${badge?`<span class="mk-type">${badge}</span>`:""}
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
        ${a.profile_picture_url?`<img class="mk-avatar" src="${esc(a.profile_picture_url)}" alt="">`:`<div class="mk-avatar mk-ph">${initials}</div>`}
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
  let query = sb.from("social_accounts").select("*").eq("platform","instagram");
  if(memberId) query = query.eq("member_id", memberId);
  const { data, error } = await query.order("updated_at",{ascending:false}).limit(1);
  const acct = (data && data[0]) || null;
  if(error || !acct){ showConnect(); return; }
  wrap.innerHTML = mkHead(acct) + mkComposer();
  wireMkComposer();
  const share = document.getElementById("mkShare");
  if(share) share.onclick = async ()=>{
    try{ await navigator.clipboard.writeText("https://instagram.com/"+(acct.username||"")); share.textContent="Copied!"; setTimeout(()=>share.textContent="Share kit",1500); }catch(e){}
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
      const uid = (window.Auth && Auth.profile && Auth.profile.id) || "anon";
      const safe = (file.name||"post.jpg").replace(/[^a-zA-Z0-9._-]/g,"");
      const path = `${uid}/${Date.now()}-${safe}`;
      const up = await sb.storage.from("ig-media").upload(path, file, { upsert:false, contentType:file.type||"image/jpeg" });
      if(up.error) throw up.error;
      const { data:pub } = sb.storage.from("ig-media").getPublicUrl(path);
      btn.textContent="Publishing…";
      const { data, error } = await sb.functions.invoke("instagram-publish", { body:{ image_url: pub.publicUrl, caption: f.get("caption")||"" } });
      if(error) throw error;
      if(data && data.error) throw new Error(data.error);
      msg.textContent="Posted to Instagram ✅"; msg.className="lead-msg ok"; form.reset();
    }catch(ex){
      err.textContent = (ex.message||ex);
    }finally{
      btn.disabled=false; btn.textContent="Publish to Instagram →";
    }
  };
}

const PAGES = {
  dashboard:renderDashboard, barter:renderBarter, creators:renderCreators, roster:renderRoster, mediakit:renderMediaKit,
  campaigns:renderCampaigns, reports:renderReports, growth:renderGrowth, settings:renderSettings,
  celebrity:renderCelebrity, approvals:renderApprovals, marketplace:renderMarketplace,
  brands:renderBrands, portfolio:renderPortfolio, finance:renderFinance, logistics:renderLogistics,
  irm:renderIRM,
  listening:()=>renderPlaceholder("Listening","Social listening & mentions — activates once your Meta / Google / LinkedIn integrations are connected.")
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
      if(error) throw error;
      if(data && data.error) throw new Error(data.error);
      localStorage.setItem("geekos_conn_instagram","1");
      alert("Instagram connected ✅ — your media kit is ready.");
      currentPage = "mediakit"; if(typeof renderShell==="function") renderShell();
      return;
    }

    // Not signed in → SIGN IN with Instagram (server creates/loads the user + a session token).
    const { data, error } = await sb.functions.invoke("instagram-login", { body:{ code, redirect_uri: IG_REDIRECT } });
    if(error) throw error;
    if(data && data.error) throw new Error(data.error);
    const { error: vErr } = await sb.auth.verifyOtp({ token_hash: data.token_hash, type: "magiclink" });
    if(vErr) throw vErr;
    localStorage.setItem("geekos_conn_instagram","1");
    // Boot the OS straight onto the media kit.
    const authRoot = document.getElementById("authRoot");
    if(authRoot){ authRoot.classList.remove("open"); authRoot.innerHTML = ""; }
    if(window.Auth) await Auth.currentSession();
    currentPage = "mediakit";
    if(typeof bootOS==="function") bootOS();
  }catch(ex){
    window.__igLoggingIn = false;
    alert("Instagram sign-in failed: " + (ex.message||ex) + "\n\nMake sure the instagram-login & instagram-auth Edge Functions are deployed and this redirect URL is registered in Meta:\n" + IG_REDIRECT);
    if(window.startApp && !((await sb.auth.getSession()).data.session)) mountLogin("login");
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
    if(error) throw error;
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
  html += `<div class="card"><h3>Social Platform Integrations</h3>
    <p class="muted" style="margin-bottom:16px">Connect official platform APIs (no scraping) to pull real analytics from creator accounts and brand pages. Each needs a registered developer app — status shown live below.</p>
    <div id="integrationList"></div>
    <div class="ai-suggest" style="margin-top:8px"><span class="spark">🔑</span><div class="s-body"><b>3 steps to go live per platform</b><p>1) Register a developer app (Meta / Google / LinkedIn). 2) Add your <b>Client ID</b> in app.js and register this redirect URL on the app: <code>${OAUTH_REDIRECT}</code>. 3) Deploy the <code>oauth-exchange</code> Edge Function (holds the secret & stores tokens). "Connect" then launches the real consent screen. Meta & LinkedIn require app review before real data is granted.</p></div></div>
  </div>`;
  return html;
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
  if(currentPage==="approvals") loadApprovals();
  if(currentPage==="marketplace") loadMarketplace();
  if(currentPage==="brands" || currentPage==="portfolio") loadBrands();
  if(currentPage==="finance") loadFinance();
  if(currentPage==="logistics") loadLogistics();
  if(currentPage==="mediakit") loadMediaKit();
  if(currentPage==="growth") loadGrowth();
  if(currentPage==="campaigns"){
    loadCampaigns();
    const add = document.getElementById("addCampaignBtn");
    if(add) add.onclick = openCampaignModal;
  }
  if(currentPage==="settings"){
    renderIntegrations();
    wireInviteForm();
    loadTeam();
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
    if(add) add.onclick = openBarterModal;
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
function openAi(){
  const r=ROLES[currentRole];
  $("#aiTitle").textContent=r.ai.title; $("#aiSub").textContent=r.ai.sub;
  const sug=AI_SUGGEST[currentRole]||[];
  $("#aiBody").innerHTML=`<div class="ai-msg bot">Hi ${r.name.split(" ")[0]} — I'm your ${r.ai.title}. Here's what I'd do next on <b>${NAV_META[currentPage].label}</b>:</div>
    ${sug.map(s=>`<div class="ai-msg"><b>${s.t}</b><br><span class="muted">${s.p}</span></div>`).join("")}
    <div class="ai-msg muted">Full conversational AI activates when the OpenAI connector is added.</div>`;
  $("#aiOverlay").classList.add("open");
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
function bootOS(){
  // Seed the signed-in user's role into the shell.
  if(window.Auth && Auth.profile && ROLES[Auth.profile.role]){
    currentRole = Auth.profile.role;
  }
  init();
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
