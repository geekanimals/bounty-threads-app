// Geek Influencer OS — Sprint 2 login/signup gate
// Renders over #app until a session exists. On success, boots the OS shell.

const ROLE_OPTIONS = [
  ["owner","Agency Owner"],
  ["corporate","Corporate (Multi-Brand)"],
  ["manager","Influencer / Celebrity Manager"],
  ["brand","Brand"],
  ["creator","Creator"]
];

// If the user arrived via a team-invite link, capture the token — signup passes it so the
// server-side trigger lets them join the inviting org (email match alone is not enough).
const INVITE_TOKEN = new URLSearchParams(location.search).get("invite");

// If this device previously signed in with Instagram, greet the returning creator so they
// can continue in one tap (Instagram remembers the authorization — usually no re-consent).
function returningCreator(){
  try{
    if(localStorage.getItem("geekos_conn_instagram") !== "1") return null;
    return { name: localStorage.getItem("geekos_last_name") || "" };
  }catch(e){ return null; }
}

function loginView(mode){
  const isUp = mode === "signup";
  const back = returningCreator();
  const welcomeBack = (!isUp && back) ? `
    <div class="welcome-back">
      <div class="wb-txt">👋 Welcome back${back.name?`, <b>${back.name.replace(/[<>&]/g,"")}</b>`:""}</div>
      <button type="button" class="ig-btn wb-btn" id="igWelcome"><span class="ig-ic">📸</span> Continue with Instagram</button>
      <button type="button" class="wb-not" id="wbNot">Not you? Sign in another way</button>
    </div>` : "";
  return `
  <div class="auth-wrap">
    <div class="auth-card">
      <div class="auth-brand">
        <div class="brand-mark">G</div>
        <div><div class="brand-name">Geek Influencer OS</div>
        <div class="muted">The operating system for influencer agencies</div></div>
      </div>

      ${welcomeBack}

      <div class="auth-tabs">
        <button class="${!isUp?'act':''}" data-mode="login">Sign in</button>
        <button class="${isUp?'act':''}" data-mode="signup">Create account</button>
      </div>

      ${isUp && INVITE_TOKEN ? `<div class="auth-note">🎟️ You've been invited to a team — sign up with the invited email to join it.</div>` : ``}

      <form id="authForm" class="auth-form">
        ${isUp?`
        <label>Full name<input name="name" placeholder="Priya Agarwal" required></label>
        <label>Agency / Org name<input name="org" placeholder="Geek Media" required></label>
        <label>I am a…<select name="role">${ROLE_OPTIONS.map(r=>`<option value="${r[0]}">${r[1]}</option>`).join("")}</select></label>
        `:""}
        <label>Email<input name="email" type="email" placeholder="you@agency.com" required></label>
        <label>Password<input name="password" type="password" placeholder="••••••••" minlength="6" required></label>
        <div class="auth-err" id="authErr"></div>
        <button class="btn auth-submit" type="submit">${isUp?"Create account →":"Enter the OS →"}</button>
      </form>

      <div class="auth-or"><span>${isUp?"or, if you're a Creator":"or"}</span></div>
      <button type="button" class="ig-btn" id="igSignIn"><span class="ig-ic">📸</span> Continue with Instagram — as a Creator</button>
      <div class="muted" style="text-align:center;font-size:12px;margin-top:8px">Creators sign in with Instagram (we auto-build your media kit). Agencies, brands & managers use <b>${isUp?"the form above":"Create account"}</b> to pick your role.</div>

      ${Auth.isDemo()?`<div class="auth-note">⚡ Demo mode — accounts & per-org security turn on the moment Supabase is connected.</div>`:``}
    </div>
    <div class="auth-side">
      <div class="auth-quote">
        <h2>Run every campaign,<br>creator & barter from one OS.</h2>
        <ul>
          <li>✨ Role-aware dashboards for every team</li>
          <li>📦 Mass Barter Engine — product to ROI, live</li>
          <li>🤝 Brand & creator portals built in</li>
          <li>📊 Auto EMV, ROI & savings reports</li>
        </ul>
      </div>
    </div>
  </div>`;
}

function mountLogin(mode="login"){
  const root = document.getElementById("authRoot");
  root.innerHTML = loginView(mode);
  root.classList.add("open");

  root.querySelectorAll(".auth-tabs button").forEach(b=>{
    b.onclick = ()=> mountLogin(b.dataset.mode);
  });

  const ig = document.getElementById("igSignIn");
  if(ig) ig.onclick = ()=>{ if(typeof connectInstagram==="function") connectInstagram(); };

  // Returning-creator fast path.
  const igw = document.getElementById("igWelcome");
  if(igw) igw.onclick = ()=>{ if(typeof connectInstagram==="function") connectInstagram(); };
  const wbNot = document.getElementById("wbNot");
  if(wbNot) wbNot.onclick = ()=>{
    try{ localStorage.removeItem("geekos_conn_instagram"); localStorage.removeItem("geekos_last_name"); }catch(e){}
    mountLogin("login");
  };

  const form = document.getElementById("authForm");
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
          org:f.get("org"), role:f.get("role"), inviteToken: INVITE_TOKEN || undefined
        });
      }else{
        await Auth.signIn({ email:f.get("email"), password:f.get("password") });
      }
      root.classList.remove("open");
      root.innerHTML = "";
      bootOS();
    }catch(ex){
      err.textContent = ex.message || "Something went wrong. Try again.";
      btn.disabled = false;
      btn.textContent = mode==="signup"?"Create account →":"Enter the OS →";
    }
  };
}

// Gate: show OS only if session exists, else login.
async function startApp(){
  if(window.__igLoggingIn){ return; } // Instagram sign-in callback is finishing — don't flash login
  const session = await Auth.currentSession();
  if(session){ bootOS(); }
  else { mountLogin(INVITE_TOKEN ? "signup" : "login"); }
}
