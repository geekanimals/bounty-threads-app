// Geek Influencer OS — Auth (REAL Supabase Auth) + client
// Login/signup go through Supabase Auth (bcrypt + signed JWT sessions).
// The signed-in user's org_id/role live in the `members` table and are
// enforced by Row Level Security in the database — never trusted from the browser.

// project + public key come from the deployment's env (/api/config → window.GEEK_CONFIG); built-in values are the fallback
const SUPABASE_URL = (window.GEEK_CONFIG && GEEK_CONFIG.supabaseUrl) || "https://edibibytqfrrxfztukpm.supabase.co";
const SUPABASE_KEY = (window.GEEK_CONFIG && GEEK_CONFIG.supabaseKey) || "sb_publishable_3tB8b43BqyJSO6_5HIVbTw_d5QOZqDf"; // publishable/anon key — safe in the browser
// the live public domain (APP_URL on Vercel), else wherever the app is open
window.appOrigin = function(){ return (window.GEEK_CONFIG && GEEK_CONFIG.appUrl) || location.origin; };

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true }
});

// If a tab's login quietly lapsed (laptop slept, token couldn't refresh), the next call goes out WITHOUT a login
// and the database answers "permission denied for schema api" / "JWT expired". Refresh the session once and retry;
// if there's no session any more, say so plainly and offer "Sign in again" instead of a confusing error.
(function guardSession(){
  const lapsed = e => !!e && (/permission denied for schema api|jwt expired|invalid jwt|not authenticated/i.test(String(e.message||"")) || ["PGRST301","PGRST303"].includes(e.code));
  let banner = false;
  const signInAgain = ()=>{
    if(banner || !document.body) return; banner = true;
    const b = document.createElement("div");
    b.style.cssText = "position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:100000;background:#0f1222;color:#fff;padding:10px 14px;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.25);font:600 14px/1.4 Inter,system-ui,sans-serif;display:flex;gap:12px;align-items:center";
    b.innerHTML = 'Your login expired. <button style="background:#6c5ce7;color:#fff;border:0;border-radius:8px;padding:6px 12px;font-weight:700;cursor:pointer">Sign in again</button>';
    b.querySelector("button").onclick = ()=> location.reload();
    document.body.appendChild(b);
  };
  const retrying = call => async function(){
    const args = arguments;
    let r = await call.apply(null, args);
    if(r && lapsed(r.error)){
      const { data } = await sb.auth.refreshSession().catch(()=>({ data:{} }));
      if(data && data.session){ r = await call.apply(null, args); }
      else { signInAgain(); r = { data:null, error:{ message:"Your login expired — please sign in again.", code:"SESSION_EXPIRED" } }; }
    }
    return r;
  };
  const rawRpc = sb.rpc.bind(sb);
  sb.rpc = retrying((fn, a, o)=> rawRpc(fn, a, o));
  const rawSchema = sb.schema.bind(sb);
  sb.schema = function(name){
    const c = rawSchema(name);
    const rawSchemaRpc = c.rpc.bind(c);
    c.rpc = retrying((fn, a, o)=> rawSchemaRpc(fn, a, o));
    return c;
  };
})();

// supabase-js puts the Edge Function's HTTP response in error.context; return its `error` text.
async function fnError(error){
  try{
    const b = await error.context.json(); const m = b && (b.error || b.message);
    // include the provider's own reason (e.g. Instagram's error text) when the function sends one
    const d = b && b.detail; const dm = typeof d === "string" ? d : (d && (d.error_user_msg || d.message || (d.error && d.error.message)));
    if(typeof m === "string") return dm && typeof dm === "string" && dm !== m ? `${m} — ${dm}` : m;
  }catch(e){}
  return (error && error.message) || String(error);
}

const Auth = {
  profile: null,
  user: null,

  // Load the current Supabase session (if any) and the member profile behind it.
  async currentSession() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { this.user = null; this.profile = null; return null; }
    this.user = session.user;
    await this.loadProfile();
    return this.profile;
  },

  // Pull org_id / role / name from the members table for the signed-in user.
  async loadProfile() {
    if (!this.user) return null;
    const { data, error } = await sb.from('members')
      .select('*')
      .eq('id', this.user.id)
      .maybeSingle();
    const md = this.user.user_metadata || {};
    if (error || !data) {
      // members row not created yet (e.g. SQL/trigger not run) — fall back to auth metadata.
      this.profile = {
        id: this.user.id, email: this.user.email,
        name: md.full_name || this.user.email,
        role: md.role || 'owner',
        org: md.org_name || 'My Org',
        org_id: null
      };
      return this.profile;
    }
    this.profile = {
      id: this.user.id,
      email: data.email || this.user.email,
      name: data.name || md.full_name || this.user.email,
      role: data.role || 'owner',
      org: data.org_name || md.org_name || 'My Org',
      org_id: data.org_id,
      status: data.status || 'active',
      official_email: data.official_email || null,
      email_verified_at: data.email_verified_at || null,
      created_via: (this.user.app_metadata && this.user.app_metadata.created_via) || null
    };
    return this.profile;
  },

  async signUp({ name, email, password, org, role, inviteToken }) {
    const meta = { full_name: name, org_name: org, role: role || 'owner' };
    if (inviteToken) meta.invite_token = inviteToken; // joins the inviting org only if the token matches
    const { data, error } = await sb.auth.signUp({
      email: email.toLowerCase(),
      password,
      options: { data: meta }
    });
    if (error) throw new Error(error.message);
    if (!data.session) {
      // Email confirmation is ON in Supabase — the user must confirm before a session exists.
      throw new Error("Account created — check your email to confirm, then sign in. (Or turn off email confirmation in Supabase → Authentication → Providers → Email.)");
    }
    this.user = data.user;
    await this.loadProfile();
    return this.profile;
  },

  async signIn({ email, password }) {
    const { data, error } = await sb.auth.signInWithPassword({
      email: email.toLowerCase(),
      password
    });
    if (error) {
      throw new Error(error.message === 'Invalid login credentials'
        ? 'Wrong email or password.'
        : error.message);
    }
    this.user = data.user;
    await this.loadProfile();
    return this.profile;
  },

  async signOut() {
    await sb.auth.signOut();
    this.profile = null;
    this.user = null;
    // a Super Admin goes back to their own door, everyone else to the home page
    { const dm = (location.search.match(/door=(superadmin|agency|brand)/)||[])[1] || (/^\/(superadmin|agency|brand)\/?$/i.exec(location.pathname)||[])[1];
      location.href = window.__isAdmin ? '/app.html?door=superadmin' : (dm ? '/app.html?door=' + dm.toLowerCase() : 'index.html'); }
  },

  isDemo() { return false; }
};

window.Auth = Auth;
window.sb = sb;
