// Vercel serverless function: runtime configuration for the browser, read from the deployment's environment
// variables (so the live domain is never hard-coded in the app).
//   APP_URL                    public origin of the app, e.g. https://app.yourdomain.com  (else: this request's host)
//   SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY   optional — the app falls back to the built-in project if unset
// Only public values are exposed here (the publishable key is meant for browsers).
module.exports = (req, res) => {
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  const fromEnv = !!(process.env.APP_URL && /^https:\/\//.test(process.env.APP_URL));
  const appUrl = (fromEnv ? process.env.APP_URL : (host ? `https://${host}` : "")).replace(/\/+$/, "");
  const cfg = {
    appUrl,
    appUrlFromEnv: fromEnv,
    supabaseUrl: process.env.SUPABASE_URL || null,
    supabaseKey: process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || null,
  };
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.status(200).send(`window.GEEK_CONFIG=${JSON.stringify(cfg).replace(/</g, "\\u003c")};`);
};
