// Google Analytics 4 (G-Z5QVGWQ0XJ) + Microsoft Clarity (zc1mp7ioqh) — live site only (bountythreads.geekcreativeagency.com).
// Follows our cookie choice (Consent Mode): no analytics cookies until the person picks "Accept all";
// before that Google only gets cookieless, anonymous pings. Ads storage/personalisation always off.
// The app is one page (app.html), so every later screen change is sent as its own page view: /app/<role>/<page>.
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

  // ---- Microsoft Clarity (project zc1mp7ioqh): heatmaps + session recordings, ONLY after "Accept all" ----
  // Nothing loads for "Essential only". Chats, messages, payments and addresses are masked in recordings
  // (on top of Clarity's own masking of every typed field).
  var CL = "zc1mp7ioqh", clOn = false;
  var MASK = "#hubChat,.wa-chat,.wa-msg,.wa-bub,.wa-thread,.wa-compose,.wa-box,#payBox,.pay-mini,.b2-ib,.ga-f,.ga-menu,#bxDel,[data-private]";
  function maskAll(){ try{ document.querySelectorAll(MASK).forEach(function(el){ if(!el.hasAttribute("data-clarity-mask")) el.setAttribute("data-clarity-mask", "true"); }); }catch(e){} }
  function clarityLoad(){
    if(clOn) return; clOn = true;
    (function(c,l,a,r,i,t,y){ c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
      t=l.createElement(r); t.async=1; t.src="https://www.clarity.ms/tag/"+i;
      y=l.getElementsByTagName(r)[0]; y.parentNode.insertBefore(t,y); })(window, document, "clarity", "script", CL);
    window.clarity("consentv2", { ad_Storage: "denied", analytics_Storage: "granted" });
    maskAll();
    try{ new MutationObserver(function(){ clearTimeout(maskAll._t); maskAll._t = setTimeout(maskAll, 120); }).observe(document.documentElement, { childList:true, subtree:true }); }catch(e){}
  }
  if(choice() === "all") clarityLoad();

  // the cookie banner (consent.js) tells us when the choice changes
  window.addEventListener("geek:consent", function(e){
    gtag("consent", "update", { analytics_storage: state(e.detail) });
    if(e.detail === "all") clarityLoad();
    else if(window.clarity){ try{ window.clarity("consentv2", { ad_Storage: "denied", analytics_Storage: "denied" }); }catch(x){} }
  });

  function view(path, title){
    gtag("event", "page_view", { page_location: location.origin + path, page_path: path, page_title: title || document.title });
  }
  // Google's tag already sends one page view on every page load (it can't be switched off in GA),
  // so plain pages need nothing more, and the app only adds a view when the screen changes after that.
  var isApp = /\/app(\.html)?$/i.test(location.pathname);
  if(!isApp) return;

  // app.html: watch the screen the person is on (top-level app.js variables) and send a view when it changes
  var last = "", uid = "";
  function read(name){ try{ return (0, eval)("typeof " + name + " !== 'undefined' ? " + name + " : undefined"); }catch(e){ return undefined; } }
  function tick(){
    var booted = !!window.__osBooted, role = booted ? (read("currentRole") || "") : "", page = booted ? (read("currentPage") || "") : "login";
    if(booted && read("_wsMode")){ var t = read("_bpTab"); page = "campaign" + (t && t !== "tracker" ? "/" + t : ""); }
    var path = "/app/" + (role ? role + "/" : "") + page;
    var id = booted && window.Auth && Auth.user && Auth.user.id ? String(Auth.user.id) : "";
    if(id && id !== uid){ uid = id; gtag("config", ID, { send_page_view: false, user_id: id }); gtag("set", "user_properties", { user_role: role || "" });
      if(clOn && window.clarity){ try{ window.clarity("identify", id); window.clarity("set", "role", role || "unknown"); }catch(e){} } }
    if(path !== last && clOn && window.clarity){ try{ window.clarity("set", "screen", path); }catch(e){} }
    // Clarity builds heatmaps per URL and the app never changes its URL, so (after sign-in, only when Clarity runs)
    // the screen goes into the hash: app.html#/creator/mediakit → one heatmap per screen. Never touches a login
    // callback hash (#access_token…) — only an empty hash or one we wrote ourselves (#/…).
    if(clOn && booted){ try{ var h = location.hash || ""; if(!h || h.indexOf("#/") === 0){ var want = "#" + path.replace(/^\/app/, ""); if(h !== want) history.replaceState(history.state, "", location.pathname + location.search + want); } }catch(e){} }
    if(path !== last){ var first = !last; last = path; if(!first) view(path, "Geek OS · " + page.replace(/[-_/]/g, " ")); }
  }
  setInterval(tick, 1000);
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", tick); else tick();
})();
