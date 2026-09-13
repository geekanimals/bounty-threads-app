// Geek Influencer OS — cookie/consent banner + "remember this device".
// Self-injects a small banner the first time. Consent is stored locally so we can keep
// the signed-in session on this device (so creators don't have to log in again and again).
(function(){
  var KEY = "geekos_consent";      // "all" | "essential"
  var DEVICE = "geekos_device_ok"; // set once the user accepts remembering this device

  function get(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
  function set(k,v){ try{ localStorage.setItem(k,v); }catch(e){} }

  // Public helper other scripts can read.
  window.Consent = {
    given: function(){ return !!get(KEY); },
    rememberDevice: function(){ return get(DEVICE) === "1"; },
    setRememberDevice: function(v){ set(DEVICE, v ? "1" : "0"); }
  };

  function dismiss(banner){ if(banner && banner.parentNode) banner.parentNode.removeChild(banner); }

  function show(){
    if(get(KEY)) return; // already chosen
    var bar = document.createElement("div");
    bar.className = "consent-bar";
    bar.innerHTML =
      '<div class="consent-inner">' +
        '<div class="consent-txt"><b>We use cookies to keep you signed in on this device</b>' +
        '<span>Essential cookies keep your session so you don\'t have to sign in every time. ' +
        'We never sell your data. See our <a href="privacy.html">Privacy Policy</a>.</span></div>' +
        '<div class="consent-btns">' +
          '<button type="button" class="consent-btn ghost" id="consentEssential">Essential only</button>' +
          '<button type="button" class="consent-btn" id="consentAll">Accept &amp; remember me</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(bar);
    var all = document.getElementById("consentAll");
    var ess = document.getElementById("consentEssential");
    if(all) all.onclick = function(){ set(KEY,"all"); window.Consent.setRememberDevice(true); dismiss(bar); };
    if(ess) ess.onclick = function(){ set(KEY,"essential"); window.Consent.setRememberDevice(false); dismiss(bar); };
  }

  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", show);
  else show();
})();
