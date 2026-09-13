// Geek Influencer OS — Sprint 2 login/signup gate
// Renders over #app until a session exists. On success, boots the OS shell.

const ROLE_OPTIONS = [
  ["owner","Agency Owner"],
  ["corporate","Corporate (Multi-Brand)"],
  ["manager","Influencer / Celebrity Manager"],
  ["brand","Brand"],
  ["creator","Creator"]
];

function loginView(mode){
  const isUp = mode === "signup";
  return `
  <div class="auth-wrap">
    <div class="auth-card">
      <div class="auth-brand">
        <div class="brand-mark">G</div>
        <div><div class="brand-name">Geek Influencer OS</div>
        <div class="muted">The operating system for influencer agencies</div></div>
      </div>

      <div class="auth-tabs">
        <button class="${!isUp?'act':''}" data-mode="login">Sign in</button>
        <button class="${isUp?'act':''}" data-mode="signup">Create account</button>
      </div>

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
          org:f.get("org"), role:f.get("role")
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
  const session = await Auth.currentSession();
  if(session){ bootOS(); }
  else { mountLogin("login"); }
}
