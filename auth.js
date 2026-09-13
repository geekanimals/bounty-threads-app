// Geek Influencer OS — Auth (REAL Supabase Auth) + client
// Login/signup go through Supabase Auth (bcrypt + signed JWT sessions).
// The signed-in user's org_id/role live in the `members` table and are
// enforced by Row Level Security in the database — never trusted from the browser.

const SUPABASE_URL = "https://edibibytqfrrxfztukpm.supabase.co";
const SUPABASE_KEY = "sb_publishable_3tB8b43BqyJSO6_5HIVbTw_d5QOZqDf"; // publishable/anon key — safe in the browser

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true }
});

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
      .select('org_id, org_name, name, role, email, status')
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
      status: data.status || 'active'
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
    location.href = 'index.html';
  },

  isDemo() { return false; }
};

window.Auth = Auth;
window.sb = sb;
