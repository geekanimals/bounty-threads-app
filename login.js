// Geek Influencer OS — login gate.
// Four doors: Creator (WhatsApp OTP only) · Agency Owner · Brand · Super Admin.
// Agency Owner / Brand sign-ups are created as `pending` by the server (handle_new_user) and go to the
// Super Admin approval queue; they can't enter the OS until approved. Super Admin is verified server-side
// (is_platform_admin) — the tab is only a door, never the authority.

// The Super Admin door is NOT on the normal login screen — it opens only at <site>/superadmin
// (Vercel rewrites /superadmin → app.html). Everyone else sees Creator · Agency Owner · Brand.
const ADMIN_DOOR = /^\/superadmin\/?$/i.test(location.pathname);
const LOGIN_ROLES = ADMIN_DOOR
  ? [["admin","Super Admin","🛡️"]]
  : [["creator","Creator","📸"], ["owner","Agency Owner","🏢"], ["brand","Brand","🛍️"]];

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
async function paintCampaignInvite(){
  const box = document.getElementById("cinvBanner"); if(!box || !CAMPAIGN_INVITE || !window.sb) return;
  try{
    const { data } = await sb.rpc("invite_preview", { p_token: CAMPAIGN_INVITE });
    if(!data || !box.isConnected) return;
    const e = s => String(s==null?"":s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
    box.innerHTML = `<div class="auth-note" style="border:1px solid rgba(108,92,231,.35);background:rgba(108,92,231,.08);margin:4px 0 10px">
      🎯 ${data.first_name?`Hi <b>${e(data.first_name)}</b> — `:""}<b>${e(data.brand||"A brand")}</b> invited you to <b>${e(data.campaign||"a campaign")}</b>${data.product?` (you get: ${e(data.product)})`:""}${data.approved?` · <b>you're already approved ✓</b>`:""}.
      <br>Continue with WhatsApp${data.phone_hint?` using your number ending <b>${e(data.phone_hint.replace(/•/g,""))}</b>`:""} — the campaign opens for you right after sign-up.</div>`;
  }catch(e){}
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
      <div class="auth-note" style="margin-top:4px">Creators sign in with <b>WhatsApp</b> — no password. Next you'll connect Instagram and we build your media kit automatically.</div>
      <button type="button" class="ig-btn wa-btn" id="waLoginBtn" style="margin-top:12px"><span class="ig-ic">💬</span> Continue with WhatsApp</button>
      <div class="muted" style="text-align:center;font-size:12px;margin-top:10px">Signed in with Instagram before? Use WhatsApp — when you connect the same Instagram, your old account is moved over automatically.</div>`;
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
      <form id="waDoorForm" class="auth-form">
        ${isUp ? `<label>Your full name<input name="name" placeholder="Priya Agarwal" required></label>
        <label>${role==="brand"?"Brand / company name":"Agency name"}<input name="org" placeholder="${role==="brand"?"Vaaree":"Geek Media"}" required></label>` : ``}
        <label>WhatsApp number<input name="phone" placeholder="+91 98123 45678" required inputmode="tel" autocomplete="tel"></label>
        <div class="auth-err" id="authErr"></div>
        <button class="btn auth-submit" type="submit">Send WhatsApp code →</button>
      </form>
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
      ${ADMIN_DOOR ? `<h3 style="margin:6px 0 2px">🛡️ Super Admin</h3>` : `<div class="auth-tabs auth-roles" style="flex-wrap:wrap">${tabs}</div>`}
      ${body}
    </div>
    <div class="auth-side">
      <div class="auth-quote">
        <h2>Run every campaign,<br>creator & barter from one OS.</h2>
        <ul>
          <li>💬 Creators: WhatsApp login, Instagram media kit, live campaigns</li>
          <li>📦 Mass Barter Engine — product to ROI, live</li>
          <li>🤝 Brand & creator portals built in</li>
          <li>📊 Auto EMV, ROI & savings reports</li>
        </ul>
      </div>
    </div>
  </div>`;
}

let _loginRole = ADMIN_DOOR ? "admin" : (INVITE_TOKEN ? "owner" : "creator");

function mountLogin(mode="login", role){
  if(role) _loginRole = role;
  if(ADMIN_DOOR) _loginRole = "admin";
  else if(_loginRole === "admin") _loginRole = "creator";   // the admin form never shows on the public login
  const root = document.getElementById("authRoot");
  root.innerHTML = loginView(_loginRole, mode);
  root.classList.add("open");

  root.querySelectorAll("[data-role]").forEach(b=>{ b.onclick = ()=> mountLogin("login", b.dataset.role); });
  root.querySelectorAll("[data-mode]").forEach(b=>{ b.onclick = ()=> mountLogin(b.dataset.mode); });

  paintCampaignInvite();
  const wa = document.getElementById("waLoginBtn");
  if(wa) wa.onclick = ()=>{ if(window.waLogin) window.waLogin.open(); else alert("WhatsApp login is loading — try again in a moment."); };

  const up = document.getElementById("usePassword"); if(up) up.onclick = e=>{ e.preventDefault(); mountLogin("password"); };
  const bw = document.getElementById("backToWa"); if(bw) bw.onclick = e=>{ e.preventDefault(); mountLogin("login"); };
  const waDoor = document.getElementById("waDoorForm");
  if(waDoor) waDoor.onsubmit = e=>{
    e.preventDefault();
    const f = new FormData(waDoor), err = document.getElementById("authErr");
    const phone = String(f.get("phone")||"").trim();
    if(!/^\+?[0-9 \-]{8,}$/.test(phone)){ err.textContent = "Enter your WhatsApp number in international format, e.g. +91 98123 45678"; return; }
    if(!window.waLogin){ err.textContent = "WhatsApp login is loading — try again in a moment."; return; }
    window.waLogin.open({ door:_loginRole, phone, name: f.get("name")||"", org: f.get("org")||"" });
  };

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
