// Geek Influencer OS — login gate.
// Four doors: Creator (WhatsApp OTP only) · Agency Owner · Brand · Super Admin.
// Agency Owner / Brand sign-ups are created as `pending` by the server (handle_new_user) and go to the
// Super Admin approval queue; they can't enter the OS until approved. Super Admin is verified server-side
// (is_platform_admin) — the tab is only a door, never the authority.

const LOGIN_ROLES = [
  ["creator","Creator","📸"],
  ["owner","Agency Owner","🏢"],
  ["brand","Brand","🛍️"],
  ["admin","Super Admin","🛡️"]
];

// If the user arrived via a team-invite link, capture the token — signup passes it so the
// server-side trigger lets them join the inviting org (email match alone is not enough).
const INVITE_TOKEN = new URLSearchParams(location.search).get("invite");

function loginView(role, mode){
  role = role || "creator";
  const isUp = mode === "signup";
  const tabs = LOGIN_ROLES.map(([k,label,ic])=>`<button type="button" class="${k===role?'act':''}" data-role="${k}">${ic} ${label}</button>`).join("");

  let body;
  if(role === "creator"){
    body = `
      <div class="auth-note" style="margin-top:4px">Creators sign in with <b>WhatsApp</b> — no password. Next you'll connect Instagram and we build your media kit automatically.</div>
      <button type="button" class="ig-btn wa-btn" id="waLoginBtn" style="margin-top:12px"><span class="ig-ic">💬</span> Continue with WhatsApp</button>
      <div class="muted" style="text-align:center;font-size:12px;margin-top:10px">Signed in with Instagram before? Use WhatsApp — when you connect the same Instagram, your old account is moved over automatically.</div>`;
  } else {
    const roleName = (LOGIN_ROLES.find(r=>r[0]===role)||[])[1];
    const canSignup = role === "owner" || role === "brand";
    body = `
      ${canSignup ? `<div class="auth-tabs">
        <button type="button" class="${!isUp?'act':''}" data-mode="login">Sign in</button>
        <button type="button" class="${isUp?'act':''}" data-mode="signup">Request access</button>
      </div>` : `<div class="auth-note">Super Admin sign-in. Only accounts approved as platform admins can enter.</div>`}
      ${isUp && INVITE_TOKEN ? `<div class="auth-note">🎟️ You've been invited to a team — sign up with the invited email to join it.</div>` : ``}
      ${isUp ? `<div class="auth-note">New ${roleName} accounts are reviewed by the Geek Super Admin. You can sign in as soon as you're approved.</div>` : ``}
      <form id="authForm" class="auth-form">
        ${isUp?`
        <label>Full name<input name="name" placeholder="Priya Agarwal" required></label>
        <label>${role==="brand"?"Brand / Company name":"Agency name"}<input name="org" placeholder="${role==="brand"?"Vaaree":"Geek Media"}" required></label>`:""}
        <label>Email<input name="email" type="email" placeholder="you@company.com" required autocomplete="email"></label>
        <label>Password<input name="password" type="password" placeholder="••••••••" minlength="8" required autocomplete="${isUp?"new-password":"current-password"}"></label>
        <div class="auth-err" id="authErr"></div>
        <button class="btn auth-submit" type="submit">${isUp?"Send request →":"Sign in →"}</button>
      </form>`;
  }

  return `
  <div class="auth-wrap">
    <div class="auth-card">
      <div class="auth-brand">
        <div class="brand-mark">G</div>
        <div><div class="brand-name">Geek Influencer OS</div>
        <div class="muted">Creators, agencies & brands — one platform</div></div>
      </div>
      <div class="auth-tabs auth-roles" style="flex-wrap:wrap">${tabs}</div>
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

let _loginRole = INVITE_TOKEN ? "owner" : "creator";

function mountLogin(mode="login", role){
  if(role) _loginRole = role;
  const root = document.getElementById("authRoot");
  root.innerHTML = loginView(_loginRole, mode);
  root.classList.add("open");

  root.querySelectorAll("[data-role]").forEach(b=>{ b.onclick = ()=> mountLogin("login", b.dataset.role); });
  root.querySelectorAll("[data-mode]").forEach(b=>{ b.onclick = ()=> mountLogin(b.dataset.mode); });

  const wa = document.getElementById("waLoginBtn");
  if(wa) wa.onclick = ()=>{ if(window.waLogin) window.waLogin.open(); else alert("WhatsApp login is loading — try again in a moment."); };

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
      if(mode==="signup"){
        await Auth.signUp({
          name:f.get("name"), email:f.get("email"), password:f.get("password"),
          org:f.get("org"), role:_loginRole, inviteToken: INVITE_TOKEN || undefined
        });
      }else{
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
      btn.textContent = mode==="signup"?"Send request →":"Sign in →";
    }
  };
}

// Gate: show OS only if session exists, else login.
async function startApp(){
  if(window.__igLoggingIn){ return; } // Instagram callback is finishing — don't flash login
  const session = await Auth.currentSession();
  if(session){ bootOS(); }
  else { mountLogin(INVITE_TOKEN ? "signup" : "login"); }
}
