/* 🔗 Time on page for message links: a page opened from a short link (…?gl=<slug>) reports how long the person stayed
 * (visible) and how long they were active — mouse / touch / scroll / keys within the last 30 s. Every 15 s + on leave. */
(function(){
  "use strict";
  var q; try{ q = new URLSearchParams(location.search); }catch(e){ return; }
  var slug = (q.get("gl") || "").toLowerCase(); try{ if(slug) sessionStorage.setItem("gk_gl", slug); else slug = sessionStorage.getItem("gk_gl") || ""; }catch(e){}
  if(!/^[a-z0-9-]{3,40}$/.test(slug)) return;
  var C = window.GEEK_CONFIG || {}; if(!C.supabaseUrl || !C.supabaseKey) return;
  var vid = ""; try{ vid = localStorage.getItem("gk_v") || ""; }catch(e){}
  var seen = 0, active = 0, lastAct = Date.now(), lastTick = Date.now(), sent = -1;
  var poke = function(){ lastAct = Date.now(); };
  ["mousemove","mousedown","keydown","scroll","touchstart","touchmove","wheel"].forEach(function(ev){ addEventListener(ev, poke, { passive:true, capture:true }); });
  var tick = function(){ var now = Date.now(), dt = Math.min(now - lastTick, 5000); lastTick = now;
    if(document.visibilityState === "visible"){ seen += dt; if(now - lastAct < 30000) active += dt; } };
  var send = function(){ tick(); var s = Math.round(seen/1000); if(s === sent || s < 1) return; sent = s;
    try{ fetch(C.supabaseUrl + "/rest/v1/rpc/msg_link_time", { method:"POST", keepalive:true,
      headers:{ "apikey":C.supabaseKey, "Authorization":"Bearer " + C.supabaseKey, "Content-Type":"application/json" },
      body: JSON.stringify({ p_slug: slug, p_visitor: vid, p_seconds: s, p_active: Math.round(active/1000) }) }).catch(function(){}); }catch(e){} };
  setInterval(tick, 1000); setInterval(send, 15000);
  document.addEventListener("visibilitychange", function(){ if(document.visibilityState === "hidden") send(); else lastTick = Date.now(); });
  addEventListener("pagehide", send);
})();
