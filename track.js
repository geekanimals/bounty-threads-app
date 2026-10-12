/* Geek Influencer OS — activity tracker for the Super Admin.
 *  security  → always (sign-in/out, Instagram connect, publish, apply, contract…) — disclosed in the banner/policy
 *  analytics → page views + time spent, ONLY when the cookie choice is "all" (the database enforces it too)
 * Batches events and writes them through public.log_activity; IP/user-agent are captured server-side,
 * approximate city/region/country come from /api/geo (Vercel edge). Never blocks the UI. */
(function(){
  "use strict";
  var q = [], geo = null, geoTried = false, started = false, page = null, lastBeat = Date.now(), timer = null;
  var SID = (function(){ try{ var s = sessionStorage.getItem("geekos_sid"); if(!s){ s = Math.random().toString(36).slice(2) + Date.now().toString(36); sessionStorage.setItem("geekos_sid", s); } return s; }catch(e){ return "nosession"; } })();

  function consent(){ try{ return localStorage.getItem("geekos_consent"); }catch(e){ return null; } }
  function signedIn(){ return !!(window.Auth && Auth.profile && window.sb); }

  function loadGeo(){
    if(geoTried) return; geoTried = true;
    fetch("/api/geo", { cache: "no-store" }).then(function(r){ return r.ok ? r.json() : null; })
      .then(function(g){ geo = g || {}; }).catch(function(){ geo = {}; });
  }
  function push(kind, event, extra){
    var e = { kind: kind, event: event, session_id: SID, page: page };
    if(extra){ for(var k in extra) e[k] = extra[k]; }
    if(geo){ e.city = geo.city; e.region = geo.region; e.country = geo.country; }
    q.push(e);
    if(kind !== "analytics") flush();          // security/consent events go out right away
  }
  function flush(useKeepalive){
    if(!signedIn() || !q.length) return;
    var batch = q.splice(0, 50);
    if(geo) batch.forEach(function(e){ if(!e.city && !e.country){ e.city = geo.city; e.region = geo.region; e.country = geo.country; } });
    if(useKeepalive && typeof SUPABASE_URL !== "undefined"){
      // page is closing: fire-and-forget with keepalive (sb.rpc may be cut off)
      sb.auth.getSession().then(function(r){
        var tok = r && r.data && r.data.session && r.data.session.access_token; if(!tok) return;
        fetch(SUPABASE_URL + "/rest/v1/rpc/log_activity", { method: "POST", keepalive: true,
          headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY, Authorization: "Bearer " + tok },
          body: JSON.stringify({ p_events: batch }) }).catch(function(){});
      });
      return;
    }
    sb.rpc("log_activity", { p_events: batch }).then(function(r){ if(r && r.error) { /* drop silently */ } }, function(){});
  }
  function beat(){
    var now = Date.now(), ms = Math.min(now - lastBeat, 300000); lastBeat = now;
    if(consent() === "all" && document.visibilityState === "visible" && ms > 1000) push("analytics", "time", { duration_ms: ms });
  }

  window.Tracker = {
    // called from bootOS once the user is signed in
    start: function(){
      if(started) return; started = true; loadGeo(); lastBeat = Date.now();
      var c = consent(); var logged = null;
      try{ logged = localStorage.getItem("geekos_consent_logged_" + Auth.profile.id); }catch(e){}
      if(c && logged !== c){ push("consent", "consent", { detail: { choice: c } }); try{ localStorage.setItem("geekos_consent_logged_" + Auth.profile.id, c); }catch(e){} }
      push("security", "session_start", { detail: { ua_lang: navigator.language || null, screen: screen.width + "x" + screen.height } });
      timer = setInterval(function(){ beat(); flush(); }, 30000);
      document.addEventListener("visibilitychange", function(){
        if(document.visibilityState === "hidden"){ beat(); flush(true); } else { lastBeat = Date.now(); }
      });
      window.addEventListener("pagehide", function(){ beat(); flush(true); });
    },
    page: function(p){
      if(p === page) return;
      if(started) beat();
      page = p;
      if(consent() === "all") push("analytics", "page_view");
    },
    security: function(event, detail){ push("security", event, detail ? { detail: detail } : null); },
    consentChanged: function(choice){
      if(!signedIn()) return;    // logged on next start()
      push("consent", "consent", { detail: { choice: choice } });
      try{ localStorage.setItem("geekos_consent_logged_" + Auth.profile.id, choice); }catch(e){}
    }
  };
})();
