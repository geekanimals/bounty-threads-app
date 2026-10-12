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
    choice: function(){ return get(KEY); },
    reopen: function(){ try{ localStorage.removeItem(KEY); }catch(e){} show(); },
    // restore a choice already recorded on the server (another device) without logging it again
    set: function(choice){ if(choice==="all"||choice==="essential"){ set(KEY, choice); window.Consent.setRememberDevice(choice==="all"); } },
    // after sign-in: a blocking choice; resolves with "all" | "essential"
    require: function(){ return new Promise(function(resolve){ if(get(KEY)) return resolve(get(KEY)); show(resolve); }); },
    rememberDevice: function(){ return get(DEVICE) === "1"; },
    setRememberDevice: function(v){ set(DEVICE, v ? "1" : "0"); }
  };

  function dismiss(banner){ if(banner && banner.parentNode) banner.parentNode.removeChild(banner); }

  function show(done){
    if(get(KEY)) return; // already chosen
    if(document.getElementById("consentModal")) return;
    var bar = document.createElement("div");
    bar.className = "consent-bar consent-modal"; bar.id = "consentModal";
    bar.innerHTML =
      '<div class="consent-inner">' +
        '<div class="consent-txt"><b>Cookies &amp; activity on Geek Influencer OS</b>' +
        '<span><b>Essential</b> (always on): keeps you signed in, and a security log of sign-ins and key actions ' +
        '(IP address, approximate city, device) to protect your account. ' +
        '<b>Analytics</b> (your choice): which pages you use and time spent, so our team can improve the app and support you. ' +
        'We never sell your data. See our <a href="privacy.html">Privacy Policy</a>.</span></div>' +
        '<div class="consent-btns">' +
          '<button type="button" class="consent-btn ghost" id="consentEssential">Essential only</button>' +
          '<button type="button" class="consent-btn" id="consentAll">Accept all</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(bar);
    var all = document.getElementById("consentAll");
    var ess = document.getElementById("consentEssential");
    var back = document.createElement("div"); back.className = "consent-backdrop";
    back.style.cssText = "position:fixed;inset:0;background:rgba(10,10,20,.55);z-index:9998";
    bar.style.zIndex = "9999";
    document.body.appendChild(back);
    var pick = function(c){ set(KEY,c); window.Consent.setRememberDevice(c==="all"); dismiss(bar); dismiss(back); if(window.Tracker) Tracker.consentChanged(c); if(done) done(c); };
    if(all) all.onclick = function(){ pick("all"); };
    if(ess) ess.onclick = function(){ pick("essential"); };
  }
  // Shown after sign-in (bootOS → Consent.require), not on the public login page.
})();
