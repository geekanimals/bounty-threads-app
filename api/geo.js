// Vercel serverless function: approximate visitor location from Vercel's edge geo headers.
// No third-party lookup, nothing stored here — the app attaches it to the activity log.
module.exports = (req, res) => {
  const h = (k) => { try { return decodeURIComponent(req.headers[k] || ""); } catch (_e) { return ""; } };
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    city: h("x-vercel-ip-city") || null,
    region: h("x-vercel-ip-country-region") || null,
    country: h("x-vercel-ip-country") || null,
  });
};
