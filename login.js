// Geek Influencer OS — login gate.
// Four doors: Creator (WhatsApp OTP only) · Agency Owner · Brand · Super Admin.
// Agency Owner / Brand sign-ups are created as `pending` by the server (handle_new_user) and go to the
// Super Admin approval queue; they can't enter the OS until approved. Super Admin is verified server-side
// (is_platform_admin) — the tab is only a door, never the authority.

// The Super Admin door is NOT on the normal login screen — it opens only at <site>/superadmin
// (/superadmin/index.html sends you to app.html?door=superadmin — works on any host, no server config). Everyone else sees Creator · Agency Owner · Brand.
// Each kind of account has its own door (its own link):
//   <site>/            → Creator login (the only one on the normal screen)
//   <site>/agency      → Agency login        (/agency/index.html → app.html?door=agency)
//   <site>/brand       → Brand login         (/brand/index.html  → app.html?door=brand)
//   <site>/superadmin  → Super Admin login
const LOGIN_DOOR = (function(){
  const q = (new URLSearchParams(location.search).get("door") || "").toLowerCase(), p = location.pathname.toLowerCase();
  if(q === "superadmin" || /^\/superadmin\/?$/.test(p)) return "admin";
  if(q === "agency" || /^\/agency\/?$/.test(p)) return "owner";
  if(q === "brand" || /^\/brand\/?$/.test(p)) return "brand";
  return "creator";
})();
const ADMIN_DOOR = LOGIN_DOOR === "admin";
try{ localStorage.setItem("geek_door", LOGIN_DOOR); }catch(e){}
const LOGIN_ROLES = [[LOGIN_DOOR, {creator:"Creator", owner:"Agency", brand:"Brand", admin:"Super Admin"}[LOGIN_DOOR], {creator:"📸", owner:"🏢", brand:"🛍️", admin:"🛡️"}[LOGIN_DOOR]]];
// what each door's right-hand panel says
const DOOR_SIDE = {
  creator: { h:"Your Creator Journey.<br>One Platform.", items:["✨ Get Discovered by Brands","🤝 Find Paid & Barter Collabs","📸 Build Your Creator Portfolio","✅ Get Verified. Build Trust.","📋 Manage All Your Campaigns","💰 Track Your Payments","🏆 Earn Rewards. Unlock Opportunities."], foot:"Create. Collaborate. Grow." },
  owner:   { h:"Run Your Agency.<br>One Platform.", items:["🔎 Discover & Vet Creators Fast","📦 Run Mass Barter & Paid Campaigns","📥 Bulk Upload Creators in Minutes","📜 Auto Contracts, Briefs & Reminders","🚚 Track Every Shipment & Post","📊 Live Reports, EMV & ROI","🤝 Manage Brands & Your Team"], foot:"Plan. Execute. Report." },
  brand:   { h:"Your Brand. Real Creators.<br>One Platform.", items:["🎯 Find Creators That Fit Your Brand","✅ Approve Creators & Content","📦 Barter & Paid Campaigns, End to End","📈 Live Results From Every Post","🧾 Contracts & Usage Rights Built In","💬 Updates on WhatsApp & Email"], foot:"Discover. Approve. Grow." },
  admin:   { h:"Geek Command Centre.", items:["🛡️ Every Workspace, One View","✅ Approve Accounts & Campaigns","📨 WhatsApp & Email Delivery","📈 Live Activity & Audit Log","🩺 System Health Checks"], foot:"Secure. Controlled. Live." }
};

// If the user arrived via a team-invite link, capture the token — signup passes it so the
// server-side trigger lets them join the inviting org (email match alone is not enough).
const INVITE_TOKEN = new URLSearchParams(location.search).get("invite");
// A campaign invite link (bulk upload → WhatsApp / email): ?cinv=<token>. Kept until the creator is signed in,
// then the app claims it — the campaign opens for them as soon as their profile is ready.
const CAMPAIGN_INVITE = (function(){
  const t = new URLSearchParams(location.search).get("cinv");
  if(t && /^[0-9a-f-]{36}$/i.test(t)){ try{ localStorage.setItem("geek_cinv", t); }catch(e){} return t; }
  try{ return localStorage.getItem("geek_cinv"); }catch(e){ return null; }
})();
// Tapped "Apply" on the public /explore.html page: ?apply=<campaign id>. Kept until the creator is signed in
// (WhatsApp → Instagram connect), then Open Campaigns opens that campaign for them.
const EXPLORE_APPLY = (function(){
  const t = new URLSearchParams(location.search).get("apply");
  if(t && /^[0-9a-f-]{36}$/i.test(t)){ try{ localStorage.setItem("geek_apply", t); }catch(e){} return t; }
  return null;
})();
async function paintCampaignInvite(){
  const box = document.getElementById("cinvBanner");
  if(box && !CAMPAIGN_INVITE && EXPLORE_APPLY && window.sb){
    let nm = "";
    try{ const { data } = await sb.rpc("explore_campaigns"); const c = (data||[]).find(x=> String(x.campaign_id)===EXPLORE_APPLY); if(c) nm = c.name; }catch(e){}
    const e = s => String(s==null?"":s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
    if(box.isConnected) box.innerHTML = `<div class="auth-note" style="border:1px solid rgba(108,92,231,.35);background:rgba(108,92,231,.08);margin:4px 0 10px">
      🎯 To apply${nm?` to <b>${e(nm)}</b>`:""}, sign in with your WhatsApp number, then connect Instagram. The campaign opens for you right after.</div>`;
    return;
  }
  if(!box || !CAMPAIGN_INVITE || !window.sb) return;
  try{
    const { data } = await sb.rpc("invite_preview", { p_token: CAMPAIGN_INVITE });
    if(!data || !box.isConnected) return;
    const e = s => String(s==null?"":s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
    box.innerHTML = `<div class="auth-note" style="border:1px solid rgba(108,92,231,.35);background:rgba(108,92,231,.08);margin:4px 0 10px">
      🎯 ${data.first_name?`Hi <b>${e(data.first_name)}</b> — `:""}<b>${e(data.brand||"A brand")}</b> invited you to <b>${e(data.campaign||"a campaign")}</b>${data.product?` (you get: ${e(data.product)})`:""}${data.approved?` · <b>you're already approved ✓</b>`:""}.
      <br>Continue with WhatsApp${data.phone_hint?` using your number ending <b>${e(data.phone_hint.replace(/•/g,""))}</b>`:""} — the campaign opens for you right after sign-up.</div>`;
  }catch(e){}
}

// WhatsApp number → code → signed in, all on this page (no popup)
function otpFormHtml(isUp, role){
  return `<form id="waDoorForm" class="auth-form">
      ${isUp ? `<label>Your full name<input name="name" placeholder="Priya Agarwal" required></label>
      <label>${role==="brand"?"Brand / company name":"Agency name"}<input name="org" placeholder="${role==="brand"?"Vaaree":"Geek Media"}" required></label>` : ``}
      <label>WhatsApp number<input name="phone" id="waPhoneIn" placeholder="+91 98123 45678" required inputmode="tel" autocomplete="tel"></label>
      <div id="waCodeRow" style="display:none"><label>6-digit code from WhatsApp<input name="code" id="waCodeIn" inputmode="numeric" maxlength="6" placeholder="••••••" autocomplete="one-time-code"></label>
        <div class="auth-mini"><span id="waSentTo"></span> · <a href="#" id="waChange">Change number</a> · <a href="#" id="waResend">Resend code</a></div></div>
      <div class="auth-err" id="authErr"></div>
      <button class="btn auth-submit" id="waGo" type="submit">💬 Send OTP on WhatsApp →</button>
    </form>`;
}
function loginView(role, mode){
  role = role || "creator";
  const isUp = mode === "signup";
  const tabs = LOGIN_ROLES.map(([k,label,ic])=>`<button type="button" class="${k===role?'act':''}" data-role="${k}">${ic} ${label}</button>`).join("");

  let body;
  if(INVITE_TOKEN && mode === "signup"){
    // team-invite links join the inviting org by matching the invited email, so they keep the email sign-up
    body = `<div class="auth-note">🎟️ You've been invited to a team — sign up with the invited email to join it.</div>
      <form id="authForm" class="auth-form">
        <label>Full name<input name="name" placeholder="Priya Agarwal" required></label>
        <label>Invited email<input name="email" type="email" required autocomplete="email"></label>
        <label>Password<input name="password" type="password" minlength="8" required autocomplete="new-password"></label>
        <div class="auth-err" id="authErr"></div>
        <button class="btn auth-submit" type="submit">Join team →</button>
      </form>
      <div class="muted" style="text-align:center;font-size:12px;margin-top:10px"><a href="#" id="backToWa">Already have an account? Sign in</a></div>`;
  } else if(role === "creator"){
    body = `<div id="cinvBanner"></div>
      <p class="auth-lead">Sign in with your <b>WhatsApp</b> number — no password. Next you connect Instagram and we build your media kit automatically.</p>
      ${otpFormHtml(false)}`;
  } else if(role === "admin" || mode === "password"){
    body = `
      ${role==="admin" ? `<div class="auth-note">Super Admin sign-in. Only accounts approved as platform admins can enter.</div>`
                       : `<div class="auth-note">Older ${(LOGIN_ROLES.find(r=>r[0]===role)||[])[1]} accounts: sign in with email &amp; password. <a href="#" id="backToWa">Use WhatsApp instead</a></div>`}
      <form id="authForm" class="auth-form">
        <label>Email<input name="email" type="email" placeholder="you@company.com" required autocomplete="email"></label>
        <label>Password<input name="password" type="password" placeholder="••••••••" minlength="6" required autocomplete="current-password"></label>
        <div class="auth-err" id="authErr"></div>
        <button class="btn auth-submit" type="submit">Sign in →</button>
      </form>`;
  } else {
    const roleName = (LOGIN_ROLES.find(r=>r[0]===role)||[])[1];
    body = `
      <div class="auth-tabs">
        <button type="button" class="${!isUp?'act':''}" data-mode="login">Sign in</button>
        <button type="button" class="${isUp?'act':''}" data-mode="signup">Request access</button>
      </div>
      ${isUp ? `<div class="auth-note">Step 1: verify your WhatsApp · Step 2: verify your official email · then the Geek Super Admin approves your ${roleName} account.</div>`
             : `<div class="auth-note">${roleName} sign-in with your WhatsApp number — we send a one-time code.</div>`}
      ${otpFormHtml(isUp, role)}
      ${!isUp ? `<div class="muted" style="text-align:center;font-size:12px;margin-top:10px"><a href="#" id="usePassword">Older account? Sign in with email &amp; password</a></div>` : ``}`;
  }

  return `
  <div class="auth-wrap">
    <div class="auth-card">
      <div class="auth-brand">
        <div class="brand-mark">G</div>
        <div><div class="brand-name">Geek Influencer OS</div>
        <div class="muted">Creators, agencies & brands — one platform</div></div>
      </div>
      <h3 class="auth-door">${(LOGIN_ROLES[0]||[])[2]||""} ${{creator:"Creator login", owner:"Agency login", brand:"Brand login", admin:"Super Admin"}[LOGIN_DOOR]}</h3>
      ${body}
    </div>
    <div class="auth-side">
      <div class="auth-quote">
        <h2>${DOOR_SIDE[LOGIN_DOOR].h}</h2>
        <ul>${DOOR_SIDE[LOGIN_DOOR].items.map(x=>`<li>${x}</li>`).join("")}</ul>
        <div class="auth-foot">${DOOR_SIDE[LOGIN_DOOR].foot}</div>
      </div>
    </div>
  </div>`;
}

let _loginRole = LOGIN_DOOR;

function mountLogin(mode="login", role){
  if(role) _loginRole = role;
  _loginRole = LOGIN_DOOR;                 // one door per link — the page never switches to another account type
  const root = document.getElementById("authRoot");
  if(window.hideBootSplash) hideBootSplash();
  root.innerHTML = loginView(_loginRole, mode);
  root.classList.add("open");

  root.querySelectorAll("[data-role]").forEach(b=>{ b.onclick = ()=> mountLogin("login", b.dataset.role); });
  root.querySelectorAll("[data-mode]").forEach(b=>{ b.onclick = ()=> mountLogin(b.dataset.mode); });

  paintCampaignInvite();

  const up = document.getElementById("usePassword"); if(up) up.onclick = e=>{ e.preventDefault(); mountLogin("password"); };
  const bw = document.getElementById("backToWa"); if(bw) bw.onclick = e=>{ e.preventDefault(); mountLogin("login"); };
  const waDoor = document.getElementById("waDoorForm");
  if(waDoor){
    let sentTo = "";
    const err = document.getElementById("authErr"), go = document.getElementById("waGo"), codeRow = document.getElementById("waCodeRow");
    const phoneIn = document.getElementById("waPhoneIn"), codeIn = document.getElementById("waCodeIn");
    const fnMsg = async r => r.error ? (typeof fnError==="function" ? await fnError(r.error) : (r.error.message||String(r.error))) : ((r.data||{}).error||"");
    const send = async ()=>{
      const phone = String(phoneIn.value||"").trim();
      if(!/^\+?[0-9 \-]{8,}$/.test(phone)){ err.textContent = "Enter your WhatsApp number, e.g. +91 98123 45678"; return; }
      err.textContent = ""; go.disabled = true; go.textContent = "Sending OTP…";
      try{
        const r = await sb.functions.invoke("wa-otp-start", { body:{ phone } }); const m = await fnMsg(r); if(m) throw new Error(m);
        sentTo = phone; phoneIn.readOnly = true; codeRow.style.display = "";
        document.getElementById("waSentTo").textContent = "Code sent to " + phone + " on WhatsApp";
        go.textContent = "Verify & sign in →"; setTimeout(()=> codeIn.focus(), 50);
      }catch(ex){ err.textContent = "Couldn't send the code: " + (ex.message||ex); go.textContent = "💬 Send OTP on WhatsApp →"; }
      go.disabled = false;
    };
    const verify = async ()=>{
      const code = String(codeIn.value||"").trim(), f = new FormData(waDoor);
      if(!/^\d{6}$/.test(code)){ err.textContent = "Enter the 6-digit code from WhatsApp."; return; }
      err.textContent = ""; go.disabled = true; go.textContent = "Signing in…";
      try{
        const r = await sb.functions.invoke("wa-otp-verify", { body:{ phone:sentTo, code, link:false, door:_loginRole, name:f.get("name")||"", org:f.get("org")||"" } });
        const m = await fnMsg(r); if(m) throw new Error(m);
        const v = await sb.auth.verifyOtp({ token_hash:(r.data||{}).token_hash, type:"magiclink" }); if(v.error) throw v.error;
        if(window.Tracker) Tracker.security("login", { method:"whatsapp_otp", door:_loginRole });
        if(window.Auth) await Auth.currentSession();
        root.classList.remove("open"); root.innerHTML = "";
        if(window.paintEarlyShell) paintEarlyShell();
        if(typeof bootOS==="function") bootOS(); else location.reload();
      }catch(ex){ err.textContent = "Couldn't verify: " + (ex.message||ex); go.disabled = false; go.textContent = "Verify & sign in →"; }
    };
    waDoor.onsubmit = e=>{ e.preventDefault(); if(!sentTo) send(); else verify(); };
    codeIn.oninput = ()=>{ if(/^\d{6}$/.test(codeIn.value.trim())) verify(); };
    document.getElementById("waChange").onclick = e=>{ e.preventDefault(); sentTo = ""; phoneIn.readOnly = false; codeRow.style.display = "none"; codeIn.value = ""; go.textContent = "💬 Send OTP on WhatsApp →"; phoneIn.focus(); };
    document.getElementById("waResend").onclick = e=>{ e.preventDefault(); sentTo = ""; send(); };
  }

  const form = document.getElementById("authForm");
  if(!form) return;
  form.onsubmit = async e=>{
    e.preventDefault();
    const f = new FormData(form);
    const btn = form.querySelector(".auth-submit");
    const err = document.getElementById("authErr");
    err.textContent = "";
    btn.disabled = true; btn.textContent = "…";
    try{
      if(INVITE_TOKEN && mode === "signup"){
        await Auth.signUp({ name:f.get("name"), email:f.get("email"), password:f.get("password"), org:"", role:"creator", inviteToken: INVITE_TOKEN });
      } else {
        await Auth.signIn({ email:f.get("email"), password:f.get("password") });
        if(_loginRole === "admin"){
          const { data:isAdmin } = await sb.rpc("is_platform_admin");
          if(isAdmin !== true){ await sb.auth.signOut(); throw new Error("This account is not a Super Admin."); }
        }
      }
      if(window.Tracker) Tracker.security("login", { method: "password", door: _loginRole });
      root.classList.remove("open");
      root.innerHTML = "";
      bootOS();
    }catch(ex){
      err.textContent = ex.message || "Something went wrong. Try again.";
      btn.disabled = false;
      btn.textContent = "Sign in →";
    }
  };
}

// Gate: show OS only if session exists, else login.
async function startApp(){
  if(window.__igLoggingIn){ return; } // Instagram callback is finishing — don't flash login
  const session = await Auth.currentSession();
  if(session){ bootOS(); }
  else { mountLogin(INVITE_TOKEN && !ADMIN_DOOR ? "signup" : "login"); }
}
