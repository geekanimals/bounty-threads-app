// Google Analytics 4 (G-Z5QVGWQ0XJ) — live site only (bountythreads.geekcreativeagency.com).
// Follows our cookie choice (Consent Mode): no analytics cookies until the person picks "Accept all";
// before that Google only gets cookieless, anonymous pings. Ads storage/personalisation always off.
// The app is one page (app.html), so every screen change is sent as its own page view: /app/<role>/<page>.
(function(){
  var ID = "G-Z5QVGWQ0XJ";
  if(!/(^|\.)geekcreativeagency\.com$/i.test(location.hostname)) return;
  window.dataLayer = window.dataLayer || [];
  function gtag(){ window.dataLayer.push(arguments); }
  window.gtag = gtag;
  function choice(){ try{ return localStorage.getItem("geekos_consent"); }catch(e){ return null; } }
  function state(c){ return c === "all" ? "granted" : "denied"; }
  gtag("consent", "default", { analytics_storage: state(choice()), ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" });
  gtag("js", new Date());
  gtag("config", ID, { send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false });
  var s = document.createElement("script"); s.async = true; s.src = "https://www.googletagmanager.com/gtag/js?id=" + ID;
  (document.head || document.documentElement).appendChild(s);

  // the cookie banner (consent.js) tells us when the choice changes
  window.addEventListener("geek:consent", function(e){ gtag("consent", "update", { analytics_storage: state(e.detail) }); });

  function view(path, title){
    gtag("event", "page_view", { page_location: location.origin + path, page_path: path, page_title: title || document.title });
  }
  var isApp = /\/app(\.html)?$/i.test(location.pathname);
  if(!isApp){ view(location.pathname + location.search, document.title); return; }

  // app.html: watch the screen the person is on (top-level app.js variables) and send a view when it changes
  var last = "", uid = "";
  function read(name){ try{ return (0, eval)("typeof " + name + " !== 'undefined' ? " + name + " : undefined"); }catch(e){ return undefined; } }
  function tick(){
    var booted = !!window.__osBooted, role = booted ? (read("currentRole") || "") : "", page = booted ? (read("currentPage") || "") : "login";
    if(booted && read("_wsMode")){ var t = read("_bpTab"); page = "campaign" + (t && t !== "tracker" ? "/" + t : ""); }
    var path = "/app/" + (role ? role + "/" : "") + page;
    var id = booted && window.Auth && Auth.user && Auth.user.id ? String(Auth.user.id) : "";
    if(id && id !== uid){ uid = id; gtag("config", ID, { send_page_view: false, user_id: id }); gtag("set", "user_properties", { user_role: role || "" }); }
    if(path !== last){ last = path; view(path, "Geek OS · " + page.replace(/[-_/]/g, " ")); }
  }
  setInterval(tick, 1000);
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", tick); else tick();
})();
