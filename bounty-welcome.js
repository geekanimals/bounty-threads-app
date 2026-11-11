/* Bounty v2 — creator welcome, WhatsApp sign-in, guest explore and profile setup (Figma "Bounty v2": V2-01…09, G1–G4, N06–N10 · W01–W48).
   Only for the creator door. The WhatsApp OTP logic is the app's own (login.js mountLogin): this file only gives it the
   Bounty screen, using the same element ids, so sign-in works exactly as before.
   Access rules: a guest (no WhatsApp) can see everything and verifies WhatsApp only to apply; once WhatsApp is verified the
   creator can do everything without Instagram — Instagram is asked only when they apply ("Not now" keeps them exploring). */
(function(){
  if(typeof window.mountLogin !== "function" || typeof window.loginView !== "function") return;
  const A = "/assets/bounty/", R = A + "rd/";
  const VIDEO = "PYpBru7LUvc";                                         // "See how it works" (YouTube)
  if(((typeof LOGIN_DOOR !== "undefined" ? LOGIN_DOOR : (window.GEEK_DOOR || "creator"))) === "creator") document.documentElement.classList.add("bx-door");
  const door = () => (typeof LOGIN_DOOR !== "undefined" ? LOGIN_DOOR : (window.GEEK_DOOR || "creator"));
  const creatorDoor = () => door() === "creator";
  const inviteSignup = (mode) => typeof INVITE_TOKEN !== "undefined" && INVITE_TOKEN && mode === "signup";
  const E = s => String(s==null?"":s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const mob = () => window.matchMedia("(max-width:900px)").matches;

  /* ---------- shared bits ---------- */
  const IC = {
    lock:'<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>', back:'<path d="m15 18-6-6 6-6"/>',
    home:'<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>', meg:'<path d="M3 11v3a1 1 0 0 0 1 1h3l6 4V6L7 10H4a1 1 0 0 0-1 1zM17 9a4 4 0 0 1 0 6"/>',
    bars:'<path d="M6 20v-6M12 20V8M18 20v-9"/>', user:'<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    play:'<path d="M8 5v14l11-7z" fill="currentColor" stroke="none"/>', x:'<path d="M6 6l12 12M18 6 6 18"/>', check:'<path d="m5 12 4 4 10-10"/>',
    gift:'<rect x="3" y="8" width="18" height="13" rx="2"/><path d="M12 8v13M3 12h18M12 8S10 3 7.5 4.5 9 8 12 8zm0 0s2-5 4.5-3.5S15 8 12 8z"/>',
    reel:'<rect x="4" y="4" width="16" height="16" rx="2"/><path d="m10 9 5 3-5 3z"/>', tag:'<path d="M20 12 12 20l-8-8V4h8z"/><circle cx="8.5" cy="8.5" r="1.4"/>'
  };
  const svg = (k, cls) => `<svg ${cls?`class="${cls}"`:""} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[k]}</svg>`;
  const TG = '<svg class="b2-tg" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="53.5" r="46.5" fill="#7d1510"/><circle cx="50" cy="50" r="46.5" fill="#e0392f"/><path d="M12.5 36 A40 40 0 0 1 58 10.8" stroke="#fff" stroke-linecap="round" fill="none" stroke-opacity=".45" stroke-width="4"/><circle cx="50" cy="50" r="34" style="fill:var(--tg-gap)"/><circle cx="50" cy="50" r="34" fill="#000" fill-opacity=".32"/><circle cx="50" cy="53" r="31" style="fill:var(--tg-gap)"/><circle cx="50" cy="52.5" r="23" fill="#7d1510"/><circle cx="50" cy="50" r="23" fill="#e0392f"/><path d="M32.4 42.9 A19 19 0 0 1 54.9 31.7" stroke="#fff" stroke-linecap="round" fill="none" stroke-opacity=".4" stroke-width="3"/><circle cx="50" cy="50" r="12" style="fill:var(--tg-gap)"/><circle cx="50" cy="50" r="12" fill="#000" fill-opacity=".32"/><circle cx="50" cy="51.6" r="10.4" style="fill:var(--tg-gap)"/><circle cx="50" cy="51.8" r="6.2" fill="#7d1510"/><circle cx="50" cy="50" r="6.2" fill="#ef4a3c"/><circle cx="47.8" cy="47.8" r="1.8" fill="#fff" fill-opacity=".7"/></svg>';
  const LOGO = `<span class="b2-logo" aria-label="Bounty">B${TG}UNTY</span>`;
  window.B2 = window.B2 || {}; B2.LOGO = LOGO; B2.TG = TG;
  const K = () => (window.bxKid ? bxKid.name() : "Pip");
  const KI = () => (window.bxKid ? bxKid.img() : R + "kid_pip.png");
  const kidImg = cls => `<img class="${cls||"b2-kid"}" src="${KI()}" data-kid-me alt="">`;
  const KIDS6 = ["pip","rumi","mochi","sprout","dot","pebble"];
  const kidsRow = cls => `<div class="${cls||"b2-kids"}" data-kid>${KIDS6.map(k=>`<img src="${R}kid_${k}.png" alt="" class="k-${k}">`).join("")}</div>`;
  const tip = (t, who) => `<div class="b2-tip">${kidImg()}<p><b>${who || K()}:</b> <i>${t}</i></p></div>`;
  const FOOT = `<footer class="b2-foot"><a class="b2-geek" href="https://geekcreativeagency.com/" target="_blank" rel="noopener">by Geek Creative Agency</a></footer>`;
  const prog = (n, label) => `<div class="b2-prog"><span class="b2-bars">${[1,2,3,4,5,6].map(i=>`<i class="${i<=n?"on":""}"></i>`).join("")}</span><span class="b2-pn">${label || ("0"+n+" / 06")}</span></div>`;
  B2.tip = tip; B2.kidImg = kidImg; B2.svg = svg; B2.E = E; B2.FOOT = FOOT; B2.prog = prog;

  // campaign photos: the brand's own when it has one, else a photo for its category
  const PH = [[/beauty|make ?up|skin|cosmetic/i,"ph_beauty"],[/fashion|apparel|cloth|wear|style/i,"ph_fashion"],[/food|cook|restaurant|snack|drink|bever|chai|tea|coffee/i,"ph_food"],
    [/fit|gym|sport|health|yoga/i,"ph_fitness"],[/pet|dog|cat/i,"ph_pets"],[/travel|trip|hotel|stay/i,"ph_travel"],[/tech|gadget|audio|phone|electr|camera/i,"ph_circle"],
    [/home|decor|interior|lifestyle|living/i,"ph_vaaree"],[/groom|\bmen\b|fragrance|perfume|beard|shav/i,"ph_beardo"]];
  const BR = { beardo:"ph_beardo", vaaree:"ph_vaaree", snuggles:"ph_pets", circle:"ph_circle", nykaa:"ph_beauty", typsy:"ph_food", zomato:"ph_food", myntra:"ph_fashion", boat:"ph_circle", mcaffeine:"ph_beauty" };
  // the campaign photo uploaded by the Super Admin (public.campaign_covers) comes first
  let COVERS = {}, _cov = null;
  const loadCovers = () => _cov || (_cov = (window.sb ? sb.rpc("campaign_covers").then(r=>{ if(r && !r.error && r.data && typeof r.data === "object") COVERS = r.data; return COVERS; }, ()=> COVERS) : Promise.resolve(COVERS)));
  B2.loadCovers = loadCovers; B2.covers = () => COVERS;
  setTimeout(loadCovers, 300);
  const camPhoto = c => { const id = c && (c.campaign_id || c.id); if(id && COVERS[id]) return COVERS[id]; if(c && c.cover_url) return c.cover_url;
    const b = String(c.brand||"").toLowerCase().replace(/[^a-z]/g,""); if(BR[b]) return R + BR[b] + ".jpg";
    const s = [c.category, c.product, c.name, c.brand].join(" "); const m = PH.find(([rx])=> rx.test(s)); return R + (m ? m[1] : "ph_vaaree") + ".jpg"; };
  const kind = c => c.campaign_type || ({cash:"paid",hybrid:"barter_paid",barter:"barter"})[c.comp_type] || "";
  const KL = { paid:"Paid", barter:"Barter", barter_paid:"Hybrid" };
  const money = v => "₹" + Number(v).toLocaleString("en-IN");
  const fdate = d => { try{ return new Date(d+"T00:00:00").toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"}); }catch(e){ return d; } };
  const compLine = c => { const k = kind(c); if(k === "paid") return c.product_value ? money(c.product_value) : "Paid"; if(k === "barter_paid") return (c.product_value ? money(c.product_value) + " + " : "") + (c.product ? E(c.product) : "product"); return c.product_value ? "Products worth " + money(c.product_value) : (c.product ? E(c.product) : "Product"); };
  const delivLine = c => c.deliverables_text ? String(c.deliverables_text).split(/\n|;/)[0].slice(0,40) : (c.platforms ? String(c.platforms).split(",")[0] : "1 Reel");
  const whoLine = c => { const w = (c.who_can_apply||[]).filter(Boolean); const city = (c.cities||[]).slice(0,1).join(""); return [w[0] || city || "", c.category || ""].filter(Boolean).join(" • "); };
  Object.assign(B2, { camPhoto, kind, KL, money, compLine, delivLine, whoLine, fdate });

  /* =================== See how it works (V2-01B / W01B) =================== */
  function video(onGo){
    let o = document.getElementById("b2Vid"); if(o) o.remove();
    o = document.createElement("div"); o.id = "b2Vid"; o.className = "b2-dim b2-vid";
    o.innerHTML = `<div class="b2-vbox" role="dialog" aria-label="How Bounty works">
        <button type="button" class="b2-vx" aria-label="Close">${svg("x")}</button>
        <h3>How Bounty works</h3>
        <div class="b2-player" id="b2Player"><div class="b2-poster">${kidsRow("b2-vkids")}<button type="button" class="b2-play" aria-label="Play video">${svg("play")}</button>
          <div class="b2-vbar"><span>0:00 / 3:44</span><i><b></b></i></div></div></div>
        <ol class="b2-how"><li><b>1</b><div><h4>Discover campaigns</h4><p>Real brands, clear briefs — made for your world.</p></div></li>
          <li><b>2</b><div><h4>Apply &amp; create</h4><p>Get selected, receive the kit, shoot your Reel.</p></div></li>
          <li><b>3</b><div><h4>Get paid &amp; grow</h4><p>Post, get verified, payment lands. Your media kit grows.</p></div></li></ol>
        <button type="button" class="b2-btn cream full" data-v="go">Find my collaborations&nbsp; →</button></div>
      <div class="b2-tip dark b2-vtip">${kidImg()}<p><b>${K()}:</b> <i>A few minutes — then you'll know everything!</i></p></div>`;
    document.body.appendChild(o);
    const close = ()=> o.remove();
    o.querySelector(".b2-vx").onclick = close;
    o.onclick = e=>{ if(e.target === o) close(); };
    o.querySelector(".b2-play").onclick = ()=>{
      o.classList.add("playing");
      const pl = document.getElementById("b2Player");
      pl.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${VIDEO}?autoplay=1&rel=0&modestbranding=1&playsinline=1&iv_load_policy=3&fs=1&color=white" title="How Bounty works" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`;
      pl.insertAdjacentHTML("afterend", `<div class="b2-vrow"><button type="button" class="b2-vfs" data-v="fs">⛶&nbsp; Full screen</button><button type="button" class="b2-vfs" data-v="steps">How it works ›</button></div>`);
      o.querySelector('[data-v="fs"]').onclick = ()=>{
        const f = pl.querySelector("iframe"), req = f && (f.requestFullscreen || f.webkitRequestFullscreen);
        if(req) req.call(f).catch(()=> window.open("https://youtu.be/" + VIDEO, "_blank", "noopener"));
        else window.open("https://youtu.be/" + VIDEO, "_blank", "noopener");
      };
      o.querySelector('[data-v="steps"]').onclick = e=>{ o.classList.toggle("steps"); e.currentTarget.textContent = o.classList.contains("steps") ? "Hide steps ‹" : "How it works ›"; };
    };
    o.querySelector('[data-v="go"]').onclick = ()=>{ close(); if(onGo) onGo(); };
    document.addEventListener("keydown", function esc(e){ if(e.key === "Escape"){ close(); document.removeEventListener("keydown", esc); } });
  }
  B2.video = video;

  /* =================== Welcome + WhatsApp sign-in (V2-01 · 02 · 03 / W01 · W12) — same ids as login.js =================== */
  function hero(){
    return `<section class="b2-hero">
        <div class="b2-hero-top">${LOGO}<div class="b2-uni"><i></i><span>Creator universe</span><i></i></div></div>
        <h1 class="b2-hero-h">Your next dream brand starts <u>here.</u></h1>
        <p class="b2-hero-p">Discover collaborations. Create your story. <br class="m">Grow on your terms.</p>
        <button type="button" class="b2-pill d-only" data-bx="video">${svg("play")}See how it works</button>
        ${kidsRow()}
        <div class="b2-hero-cta m-only"><button type="button" class="b2-btn cream" data-bx="signin">Find my collaborations&nbsp; →</button>
          <button type="button" class="b2-link light" data-bx="video">See how it works</button></div>
        <div class="b2-hero-foot"><div class="b2-orn m-only"><i></i><b></b><i></i></div>Real brands &nbsp;•&nbsp; Clear briefs &nbsp;•&nbsp; Your choice</div>
        <footer class="b2-foot m-only"><a class="b2-geek" href="https://geekcreativeagency.com/" target="_blank" rel="noopener">by Geek Creative Agency</a></footer>
      </section>`;
  }
  function welcomeHtml(){
    return `<div class="b2 b2-pre" id="bxw" data-st="welcome" data-scene="jungle">
      ${hero()}
      <section class="b2-panel" id="bxCard">
        <div class="b2-ptop"><div class="b2-plogo m-only">${LOGO}</div><div class="b2-progrow"><span id="bxProg">${prog(1)}</span></div></div>
        <button type="button" class="b2-back ink otp-only" data-bx="back">← Back</button>
        <h2 class="b2-h" id="bxCardH">Hey, creator. 👋<br>Let's get you in.</h2>
        <p class="b2-p" id="bxCardP">Enter your WhatsApp number to discover collaborations made for you.</p>
        <div id="cinvBanner"></div>
        <form id="waDoorForm" class="auth-form b2-form">
          <div class="form-only"><label class="b2-lab c" for="waPhoneIn">WhatsApp number</label>
            <div class="b2-phone"><span class="b2-flag">🇮🇳</span><b>+91</b><i></i><input name="phone" id="waPhoneIn" placeholder="Your 10-digit number" required inputmode="tel" autocomplete="tel"></div>
            <div class="b2-note">🔒<span>Only for sign-in and important campaign updates. No spam.</span></div></div>
          <div class="b2-sent otp-only"><span id="bxMasked"></span><a href="#" id="bxChange">Change number</a></div>
          <div id="waCodeRow" style="display:none">
            <div class="b2-code"><input name="code" id="waCodeIn" inputmode="numeric" maxlength="6" autocomplete="one-time-code" aria-label="6-digit code">
              <div class="b2-boxes" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div></div>
            <div class="b2-exp" id="bxExp">Code expires in 10:00</div>
            <div class="auth-mini" style="display:none"><span id="waSentTo"></span><a href="#" id="waChange">Change number</a></div>
          </div>
          <div class="auth-err" id="authErr"></div>
          <button class="b2-btn cyan full auth-submit" id="waGo" type="submit">Send verification code&nbsp; →</button>
          <div class="b2-resend otp-only">Didn't receive a code? <span id="bxResendT">Resend in 30s</span><a href="#" id="waResend" style="display:none">Resend code</a></div>
        </form>
        <button type="button" class="b2-link ink form-only" data-bx="explore">I'll explore first</button>
        <label class="b2-check form-only"><input type="checkbox" id="bxWaAlerts"><i></i><span>Send me matching campaign alerts on WhatsApp (optional).</span></label>
        <div class="b2-note line otp-only">🔒<span>We'll only use WhatsApp for secure sign-in and important campaign updates.</span></div>
        ${FOOT}
      </section>
    </div>`;
  }

  const _loginView = window.loginView;
  window.loginView = function(role, mode){
    if(!creatorDoor() || inviteSignup(mode)) return _loginView.apply(this, arguments);
    return welcomeHtml();
  };
  const _mountLogin = window.mountLogin;
  window.mountLogin = function(mode, role){
    const r = _mountLogin.apply(this, arguments);
    const root = document.getElementById("authRoot");
    const w = root && root.querySelector("#bxw");
    document.body.classList.toggle("bx-pre", !!w);
    if(!w) return r;
    leaveGuest(true);
    const setSt = s => { w.dataset.st = s; root.scrollTop = 0; window.scrollTo(0,0); if(window.BxHist) BxHist.mark("w", s); };
    // straight to the form when the creator came to apply / from an invite / asked to sign in
    const q = new URLSearchParams(location.search);
    if(q.get("apply") || q.get("cinv") || q.get("from") || window.__bxWantForm){ setSt("form"); window.__bxWantForm = false; }
    w.querySelectorAll("[data-bx]").forEach(b=> b.addEventListener("click", ()=>{
      const k = b.dataset.bx;
      if(k === "signin"){ setSt("form"); if(!mob()) setTimeout(()=>{ const p = document.getElementById("waPhoneIn"); if(p) p.focus(); }, 60); }
      if(k === "back"){ document.getElementById("waChange").click(); }
      if(k === "explore") startGuest();
      if(k === "video") video(()=>{ setSt("form"); });
    }));
    const hs = history.state;
    if(hs && hs.bxh && hs.k === "g" && !window.__bxWantForm && !q.get("apply") && !q.get("cinv")){ setTimeout(()=>{ if(!G.on && document.querySelector("#authRoot #bxw")){ startGuest(); if(hs.v !== "home") go(hs.v); } }, 0); }
    else {
      if(hs && hs.bxh && hs.k === "w" && w.dataset.st === "welcome" && hs.v !== "welcome") w.dataset.st = "form";
      if(window.BxHist) BxHist.mark("w", w.dataset.st);
    }
    try{ const al = document.getElementById("bxWaAlerts"); al.checked = localStorage.getItem("bx_wa_alerts") === "1"; al.onchange = ()=>{ try{ localStorage.setItem("bx_wa_alerts", al.checked ? "1" : "0"); }catch(e){} }; }catch(e){}
    // V2-03 / W12: once the code is sent → "One last step.", masked number, 6 boxes, expiry + resend timers
    const row = document.getElementById("waCodeRow"), h = document.getElementById("bxCardH"), p = document.getElementById("bxCardP");
    const masked = document.getElementById("bxMasked"), codeIn = document.getElementById("waCodeIn"), boxes = w.querySelectorAll(".b2-boxes i");
    const rsT = document.getElementById("bxResendT"), rsA = document.getElementById("waResend"), exp = document.getElementById("bxExp");
    const H0 = h.innerHTML, P0 = p.innerHTML; let timer = null, etimer = null;
    const startTimer = ()=>{ clearInterval(timer); let s = 30; rsA.style.display = "none"; rsT.style.display = "";
      const tick = ()=>{ rsT.textContent = "Resend in " + s + "s"; if(s-- <= 0){ clearInterval(timer); rsT.style.display = "none"; rsA.style.display = ""; } }; tick(); timer = setInterval(tick, 1000);
      clearInterval(etimer); let e = 600; const et = ()=>{ exp.textContent = e > 0 ? "Code expires in " + String(Math.floor(e/60)).padStart(2,"0") + ":" + String(e%60).padStart(2,"0") : "Code expired — tap Resend"; if(e-- <= 0) clearInterval(etimer); }; et(); etimer = setInterval(et, 1000); };
    const paintBoxes = ()=>{ const v = codeIn.value.replace(/\D/g,"").slice(0,6); if(v !== codeIn.value) codeIn.value = v; boxes.forEach((b,i)=>{ b.textContent = v[i] || ""; b.classList.toggle("on", i === Math.min(v.length,5) && document.activeElement === codeIn); }); };
    if(row) new MutationObserver(()=>{
      const on = row.style.display !== "none";
      setSt(on ? "otp" : (w.dataset.st === "otp" ? "form" : w.dataset.st));
      document.getElementById("bxProg").innerHTML = prog(on ? 2 : 1);
      h.innerHTML = on ? "One last step." : H0;
      p.innerHTML = on ? "Enter the 6-digit code sent to your WhatsApp number." : P0;
      if(on){ const d = String(document.getElementById("waPhoneIn").value||"").replace(/\D/g,"").slice(-10); masked.textContent = "+91 " + d.slice(0,2) + "••• ••" + d.slice(-3); startTimer(); setTimeout(()=>{ codeIn.focus(); paintBoxes(); }, 80); }
      else { clearInterval(timer); clearInterval(etimer); codeIn.value = ""; paintBoxes(); }
    }).observe(row, { attributes:true, attributeFilter:["style"] });
    document.getElementById("bxChange").onclick = e=>{ e.preventDefault(); document.getElementById("waChange").click(); };
    rsA.addEventListener("click", ()=> setTimeout(startTimer, 50));
    codeIn.addEventListener("input", paintBoxes); codeIn.addEventListener("focus", paintBoxes); codeIn.addEventListener("blur", paintBoxes);
    w.querySelector(".b2-boxes").onclick = ()=> codeIn.focus();
    // keep the Bounty button wording when login.js resets it
    const go = document.getElementById("waGo");
    if(go) new MutationObserver(()=>{ const t = go.textContent;
      if(/Send OTP on WhatsApp/.test(t)) go.innerHTML = "Send verification code&nbsp; →";
      else if(/^Verify & sign in/.test(t)) go.innerHTML = "Verify &amp; continue&nbsp; →";
      else if(/^Sending OTP/.test(t)) go.textContent = "Sending code…";
      else if(/^Signing in/.test(t)) go.textContent = "Verifying…"; })
      .observe(go, { childList:true, characterData:true, subtree:true });
    return r;
  };

  /* =================== Guest explore (V2-G1 · G1b · G4 / W35 · W36 · W38) =================== */
  let G = { on:false, page:"home", list:null, f:"foryou", brief:null, member:false };
  async function loadList(){
    if(G.list) return G.list;
    try{ const [r] = await Promise.all([ sb.rpc("explore_campaigns"), loadCovers() ]); G.list = (r && !r.error && r.data) || []; G.err = r && r.error ? 1 : 0; }
    catch(e){ G.list = []; G.err = 1; }
    return G.list;
  }
  function toSignIn(applyId){
    if(G.member){ return igApplySheet(applyId); }
    if(applyId){ try{ localStorage.setItem("geek_apply", applyId); }catch(e){} location.href = "/app.html?apply=" + encodeURIComponent(applyId); return; }
    window.__bxWantForm = true; mountLogin("login");
  }
  function gRoot(){
    let g = document.getElementById("b2g");
    if(!g){ g = document.createElement("div"); g.id = "b2g"; g.className = "b2 b2g"; document.body.appendChild(g); }
    return g;
  }
  function startGuest(){
    const root = document.getElementById("authRoot");
    if(root){ root.classList.remove("open"); root.innerHTML = ""; }
    document.body.classList.remove("bx-pre");
    if(window.hideBootSplash) hideBootSplash();
    G.on = true; window.__bxGuest = true;
    document.body.classList.add("bx","bx-guest");
    const g = gRoot();
    g.innerHTML = `<header class="b2g-top">
        <div class="b2g-brand">${LOGO}</div>
        <nav class="b2g-links d-only"><a data-g="home" class="on">Discover</a><a data-g="how">How it works</a><a href="/brands" target="_blank" rel="noopener">For brands</a></nav>
        <button type="button" class="b2g-in" data-g="signin"><span class="m-only">Sign in</span><span class="d-only">Sign in with WhatsApp</span></button></header>
      <main class="b2g-main" id="b2gMain"></main>
      <nav class="b2-nav b2g-nav m-only" id="b2gNav"></nav>`;
    g.querySelectorAll("[data-g]").forEach(a=> a.onclick = ()=>{ const k = a.dataset.g; if(k === "signin") return toSignIn(); if(k === "how") return video(()=> toSignIn()); go(k); });
    go("home");
  }
  function leaveGuest(quiet){
    if(!G.on) return; G.on = false; window.__bxGuest = false;
    document.body.classList.remove("bx-guest");
    const g = document.getElementById("b2g"); if(g) g.remove();
    if(!quiet) document.body.classList.remove("bx");
  }
  // the app boots for real after sign-in — drop guest mode first
  if(typeof window.bootOS === "function"){
    const _boot = window.bootOS;
    window.bootOS = function(){ leaveGuest(true); return _boot.apply(this, arguments); };
  }
  function navHtml(cur, member){
    const it = [["home","Home","home"],["lock:mycampaigns","Campaigns","meg"],["__kid",K(),""],["lock:reports","Analytics","bars"],["lock:profile","Profile","user"]];
    return it.map(([k,l,ic])=> k === "__kid"
      ? `<button type="button" class="b2-nav-kid" data-g="kid" aria-label="Ask ${E(l)}"><span class="ring">${kidImg()}</span><span>${E(l)}</span></button>`
      : `<button type="button" data-g="${k}" class="${(cur===k || (k==="home" && /^(home|brief:)/.test(cur)))?"on":""}"><span class="ic">${svg(ic)}</span><span>${l}</span></button>`).join("");
  }
  async function go(page){
    if(!G.on && !G.member) return;
    G.page = page;
    const main = G.on ? document.getElementById("b2gMain") : document.getElementById("content"); if(!main) return;
    if(G.on){
      const nav = document.getElementById("b2gNav");
      if(nav){ nav.innerHTML = navHtml(page); nav.querySelectorAll("[data-g]").forEach(b=> b.onclick = ()=> b.dataset.g === "kid" ? guestKid() : go(b.dataset.g)); }
      const g = document.getElementById("b2g"); g.dataset.pg = page.split(":")[0];
      g.querySelectorAll(".b2g-links [data-g]").forEach(a=> a.classList.toggle("on", a.dataset.g === "home" && !page.startsWith("lock:")));
    }
    window.scrollTo(0,0);
    if(window.BxHist && !(G.member && (page === "home" || page === "discover"))) BxHist.mark("g", page);
    const old = document.getElementById("b2NavSay"); if(old) old.remove();
    let p = null;
    if(page === "home" || page === "discover") p = pageDiscover(main);
    else if(page.startsWith("brief:")) p = pageBrief(main, page.slice(6));
    else if(page.startsWith("lock:")) p = pageLock(main, page.slice(5));
    if(G.on){ liftTip(main); Promise.resolve(p).then(()=>{ if(G.on && G.page === page) liftTip(main); }); }
    return p;
  }
  // guest on a phone: Pip's line comes out of Pip in the middle of the bottom bar (a speech bubble), not at the foot of the page
  function liftTip(main){
    if(!window.matchMedia("(max-width:900px)").matches) return;
    const t = main.querySelector(".b2-tip"); if(!t) return;
    const p = t.querySelector("p"); const msg = p ? p.innerHTML : ""; t.remove();
    if(msg) navSay(msg);
  }
  function navSay(html){
    const g = document.getElementById("b2g"); if(!g) return;
    let s = document.getElementById("b2NavSay"); if(s) s.remove();
    s = document.createElement("div"); s.id = "b2NavSay"; s.className = "b2-navsay"; s.setAttribute("role","status");
    s.innerHTML = `<p>${html}</p><button type="button" aria-label="Close">×</button>`;
    g.appendChild(s);
    const bye = ()=>{ if(!s.isConnected) return; s.classList.add("out"); setTimeout(()=> s.remove(), 240); };
    s.querySelector("p").onclick = ()=>{ s.remove(); guestKid(); };
    s.querySelector("button").onclick = e=>{ e.stopPropagation(); bye(); };
    clearTimeout(navSay._t); navSay._t = setTimeout(bye, 8000);
  }

  // V2-09 card (dark glass on mobile, cream card on desktop)
  function card(c, opts){
    const k = kind(c), btn = opts && opts.btn;
    return `<article class="b2-camp" data-id="${E(c.campaign_id)}">
      <div class="b2-camp-ph"><img src="${camPhoto(c)}" alt="" loading="lazy"><span class="b2-type t-${E(k||"x")}">${E(KL[k]||"Campaign")}</span></div>
      <div class="b2-camp-b"><div class="b2-camp-brand">${E(c.brand||"Brand")}<span class="b2-type t-${E(k||"x")}">${E(KL[k]||"Campaign")}</span></div>
        <h4>${E(c.name||"Campaign")}</h4>
        <div class="b2-camp-comp">${svg("gift")}${compLine(c)}</div>
        <div class="b2-camp-l">${svg("reel")}${E(delivLine(c))}</div>
        ${whoLine(c)?`<div class="b2-camp-l">${svg("tag")}${E(whoLine(c))}</div>`:""}
        <div class="b2-camp-foot">${btn || `<span class="b2-match chk">⇄ Check fit</span><button type="button" class="b2-vb" data-brief="${E(c.campaign_id)}">View brief →</button>`}</div></div></article>`;
  }
  B2.card = card;
  function wireCards(root){
    root.querySelectorAll("[data-apply]").forEach(b=> b.onclick = e=>{ e.stopPropagation(); verifySheet(b.dataset.apply); });
    root.querySelectorAll("[data-brief]").forEach(b=> b.onclick = e=>{ e.stopPropagation(); go("brief:" + b.dataset.brief); });
    root.querySelectorAll(".b2-camp").forEach(a=> a.onclick = ()=> go("brief:" + a.dataset.id));
  }
  const FILTERS = [["foryou","For you"],["paid","Paid"],["barter","Barter"],["barter_paid","Paid + Barter"]];
  async function pageDiscover(c){
    const member = G.member;
    c.innerHTML = `<div class="b2-page b2-disc ${member?"b2-member":""}">
      ${member ? "" : `<div class="b2-guestban">You're exploring as a guest — apply with WhatsApp in 30 sec.<span class="d-only"> No Instagram needed to look around.</span></div>`}
      <h1 class="b2-h1 light">Made for your world.</h1><p class="b2-sub light">Campaigns that match your style</p>
      <div class="b2-chips dark" id="b2Chips">${FILTERS.map(([k,l])=>`<button type="button" data-f="${k}" class="${G.f===k?"on":""}">${l}</button>`).join("")}</div>
      ${member ? `<div class="b2-igban"><span>📸</span><p>Instagram not connected — explore everything. We'll ask only when you apply.</p><button type="button" data-x="ig">Connect</button></div>` : ""}
      <div class="b2-cgrid" id="b2List"><div class="b2-empty">Loading campaigns…</div></div>
      ${tip(member ? "Explore freely — I'll ask for Instagram only when you apply." : "Look around freely — sign in only when you want to apply.")}</div>`;
    const ig = c.querySelector('[data-x="ig"]'); if(ig) ig.onclick = ()=>{ if(window.Tracker) Tracker.security("instagram_connect_start"); connectInstagram(); };
    const paint = ()=>{
      const box = document.getElementById("b2List"); if(!box) return;
      const rows = (G.list||[]).filter(x=> G.f === "foryou" || kind(x) === G.f);
      box.innerHTML = rows.length ? rows.map(x=> card(x, member ? null : { btn:`<button type="button" class="b2-vb lock" data-apply="${E(x.campaign_id)}">${svg("lock")}Verify WhatsApp to apply</button>` })).join("")
        : `<div class="b2-empty">${(G.list||[]).length ? "Nothing here right now — try another filter." : (G.err ? "Couldn't load campaigns right now — please refresh in a moment." : "No campaigns are open right now. New ones are added often — check back soon.")}</div>`;
      wireCards(box);
    };
    c.querySelectorAll("[data-f]").forEach(b=> b.onclick = ()=>{ G.f = b.dataset.f; c.querySelectorAll("[data-f]").forEach(x=> x.classList.toggle("on", x===b)); paint(); });
    await loadList(); if(G.page === "home" || G.page === "discover") paint();
  }

  // V2-10 / N10 / W47: the brief as a page — Apply asks for WhatsApp (guest) or Instagram (member), never earlier
  async function pageBrief(c, id){
    c.innerHTML = `<div class="b2-page"><div class="b2-empty">Loading brief…</div></div>`;
    const list = await loadList(); if(G.page !== "brief:" + id) return;
    const x = list.find(r=> String(r.campaign_id) === id);
    if(!x){ c.innerHTML = `<div class="b2-page"><button type="button" class="b2-back" data-go>← Back to campaigns</button><div class="b2-card">This campaign isn't open any more.</div></div>`; c.querySelector("[data-go]").onclick = ()=> go("home"); return; }
    c.innerHTML = briefHtml(x, { applyLabel: G.member ? "Apply to campaign →" : "Verify WhatsApp to apply →", sub: G.member ? "We'll ask for Instagram only when you apply." : "You review and accept terms if selected." });
    c.querySelector("[data-go]").onclick = ()=> go("home");
    c.querySelectorAll("[data-apply]").forEach(b=> b.onclick = ()=> G.member ? igApplySheet(x.campaign_id) : verifySheet(x.campaign_id));
    wireBrief(c);
  }
  function briefHtml(x, o){
    const k = kind(x), b = x.video_brief || {}, t = x.terms || {}, noProd = k === "paid";
    const who = (x.who_can_apply||[]).filter(Boolean);
    const txt = (l,v)=> v ? `<div class="b2-bsec"><h5>${l}</h5><div class="b2-ptext">${E(v)}</div></div>` : "";
    const tags = [].concat(x.hashtags||[], (x.mentions||[]).map(m=> String(m).charAt(0)==="@" ? m : "@"+m));
    const comp = k === "paid" ? (x.product_value ? money(x.product_value) : "Paid") : k === "barter_paid" ? `${x.product_value?money(x.product_value)+" + ":""}${E(x.product||"product kit")}` : (x.product_value ? "Products worth " + money(x.product_value) : E(x.product||"Product"));
    const compSub = k === "paid" ? "Payment" : k === "barter_paid" ? "Payment + product" : "Product";
    return `<div class="b2-page b2-brief">
      <button type="button" class="b2-back" data-go>← Back to campaigns</button>
      <div class="b2-brief-grid"><div class="b2-brief-l">
        <div class="b2-bhero"><img src="${camPhoto(x)}" alt=""><span class="b2-type t-${E(k||"x")}">${E(KL[k]||"Campaign")}</span></div>
        <h1 class="b2-btitle">${E(x.name||"Campaign")}</h1><div class="b2-bbrand">${E(x.brand||"")}</div>
        <div class="b2-bgrid">
          <div class="b2-bt">${svg("gift")}<div><b>${comp}</b><span>${compSub}</span></div></div>
          <div class="b2-bt">${svg("reel")}<div><b>${E(delivLine(x))}</b><span>Submit draft for approval</span></div></div>
          <div class="b2-bt wide">👥<div><b>Who can apply:</b> <span class="in">${who.length?E(who.join(" • ")):"Open to every creator"}</span></div></div>
          <div class="b2-bt">📅<div><b>Deadline:</b><span>${t.content_days?E(t.content_days)+" days after "+(noProd?"the brief":"delivery"):(x.ends_on?"Till "+E(fdate(x.ends_on)):"Shown in your agreement")}</span></div></div>
          <div class="b2-bt">🛡<div><b>Usage rights:</b><span>${t.ad_rights_months?E(t.ad_rights_months)+" month"+(t.ad_rights_months>1?"s":""):"None"}</span></div></div>
          <div class="b2-bt">🤝<div><b>Collab post:</b><span>${t.collab_rights?"Required":"Not required"}</span></div></div>
          <div class="b2-bt">🏷<div><b>Exclusivity:</b><span>${t.exclusivity?E(t.exclusivity):"None"}</span></div></div>
        </div>
        <div class="b2-steps5"><div><i>✎</i><span>Apply</span></div><div><i>✓</i><span>Get selected</span></div><div><i>📦</i><span>Receive kit</span></div><div><i>🎬</i><span>Create</span></div><div><i>📊</i><span>Your analytics</span></div></div>
      </div><div class="b2-brief-r">
        <div class="b2-applybox"><button type="button" class="b2-btn cyan full" data-apply="${E(x.campaign_id)}">${o.applyLabel}</button><p>${o.sub}</p></div>
        <details class="b2-fold"><summary>📄 Read full creative brief</summary><div class="b2-fold-b">
          ${txt("Brief", x.brief)}${txt("What to shoot", b.what_to_shoot)}${txt("Key messages", b.key_messages)}${txt("Do's", b.dos)}${txt("Don'ts", b.donts)}${txt("Caption to use", b.caption)}
          ${tags.length?`<div class="b2-bsec"><h5>Hashtags &amp; mentions</h5><div class="b2-tags">${tags.map(s=>`<span>${E(s)}</span>`).join("")}</div></div>`:""}
          ${txt("Deliverables", x.deliverables_text)}${(x.cities||[]).length?txt("Cities", x.cities.join(", ")):""}${(x.languages||[]).length?txt("Languages", x.languages.join(", ")):""}
          ${txt("Posting note", b.posting_note)}</div></details>
        <details class="b2-fold sm"><summary>ⓘ Terms &amp; disclosure</summary><div class="b2-fold-b"><ul class="b2-ul">
          ${t.content_days?`<li>Post within <b>${E(t.content_days)} days</b> of ${noProd?"getting the video brief":"receiving the product"}</li>`:""}
          <li>Submit your video in the app first — post <b>only after the brand approves it</b></li>
          ${t.ad_rights_months?`<li>Ad rights: the brand may use your content for <b>${E(t.ad_rights_months)} month${t.ad_rights_months>1?"s":""}</b></li>`:""}
          ${t.collab_rights?"<li>Add the brand as an Instagram <b>collaborator</b> on the post</li>":""}
          ${k && k!=="barter"?"<li><b>Paid:</b> your fee is written into your own agreement</li>":""}
          <li>Disclose the collaboration (Paid partnership / #ad) as per ASCI</li></ul></div></details>
        ${tip("The deadline starts after delivery — read the brief first.")}
      </div></div></div>`;
  }
  function wireBrief(c){ /* <details> folds work on their own */ }
  B2.briefHtml = briefHtml;

  // V2-G1b (sheet) / W36 (modal): verify WhatsApp to apply — the application is saved and resumes after sign-in
  function verifySheet(id){
    const x = (G.list||[]).find(r=> String(r.campaign_id) === String(id)) || {};
    let o = document.getElementById("b2Sheet"); if(o) o.remove();
    o = document.createElement("div"); o.id = "b2Sheet"; o.className = "b2-dim b2-sheetwrap";
    o.innerHTML = `<div class="b2-sheet light b2-vsheet" role="dialog" aria-label="Verify to apply"><i class="b2-grab"></i>
      ${kidImg("b2-sheet-kid")}<h3>Verify to apply</h3><div class="b2-sheet-sub">${E([x.name, x.brand].filter(Boolean).join(" · "))}</div>
      <form class="b2-vform"><div class="b2-phone"><span class="b2-flag">🇮🇳</span><b>+91</b><i></i><input id="b2vPhone" placeholder="Your 10-digit number" inputmode="tel" autocomplete="tel"></div>
        <button type="submit" class="b2-btn cyan full">Send verification code&nbsp; →</button></form>
      <p class="b2-sheet-note">Your application is saved — you'll come right back here.</p>
      <button type="button" class="b2-link ink" data-x="no">Not now</button>
      ${tip("One code on WhatsApp and you're in. No spam.")}</div>`;
    document.body.appendChild(o);
    const close = ()=> o.remove();
    o.onclick = e=>{ if(e.target === o) close(); };
    o.querySelector('[data-x="no"]').onclick = close;
    o.querySelector("form").onsubmit = e=>{ e.preventDefault();
      const ph = o.querySelector("#b2vPhone").value.trim();
      try{ localStorage.setItem("geek_apply", id); if(ph) sessionStorage.setItem("bx_prefill_phone", ph); }catch(x){}
      location.href = "/app.html?apply=" + encodeURIComponent(id) + (ph ? "&from=apply" : "");
    };
    setTimeout(()=>{ const i = o.querySelector("#b2vPhone"); if(i && !mob()) i.focus(); }, 60);
  }
  // the phone typed in the sheet carries over to the sign-in form, and the code is sent at once
  setTimeout(function prefill(){
    let ph = null; try{ ph = sessionStorage.getItem("bx_prefill_phone"); }catch(e){}
    if(!ph) return;
    const i = document.getElementById("waPhoneIn"), f = document.getElementById("waDoorForm");
    if(!i || !f){ if((prefill.n = (prefill.n||0) + 1) < 40) setTimeout(prefill, 250); return; }
    try{ sessionStorage.removeItem("bx_prefill_phone"); }catch(e){}
    i.value = ph; const w = document.getElementById("bxw"); if(w) w.dataset.st = "form";
    if(typeof f.requestSubmit === "function") f.requestSubmit(); else document.getElementById("waGo").click();
  }, 300);

  // V2-G4 / W38 — the app's own pages need an account
  const LOCK = {
    mycampaigns:["Your campaigns live here","Sign in with WhatsApp to apply, track every step and get paid."],
    reports:["Your creator pulse lives here","Sign in with WhatsApp — followers, reach and campaign results show up here."],
    profile:["Your profile lives here","Sign in with WhatsApp to set up what you create, your dream brands and your terms."],
    mediakit:["Your media kit lives here","Sign in with WhatsApp, then connect Instagram — or build it by hand."],
    alerts:["Your updates live here","Campaign updates show up here once you're signed in."]
  };
  function pageLock(c, key){
    const [h,p] = LOCK[key] || LOCK.profile;
    c.innerHTML = `<div class="b2-page b2-lock"><div class="b2-orb">${kidImg()}</div><h1 class="b2-h1 light">${h}</h1><p class="b2-sub light">${p}</p>
      <button type="button" class="b2-btn cream" data-x="in">Sign in with WhatsApp&nbsp; →</button><button type="button" class="b2-link light" data-x="ex">Keep exploring</button>
      ${tip("I'll keep the campaigns you liked ready for you.")}</div>`;
    c.querySelector('[data-x="in"]').onclick = ()=> toSignIn();
    c.querySelector('[data-x="ex"]').onclick = ()=> go("home");
  }
  function guestKid(){
    let o = document.getElementById("b2Sheet"); if(o) o.remove();
    o = document.createElement("div"); o.id = "b2Sheet"; o.className = "b2-dim b2-sheetwrap";
    o.innerHTML = `<div class="b2-sheet b2-vsheet dark" role="dialog"><i class="b2-grab"></i>${kidImg("b2-sheet-kid")}<h3>Hi, I'm ${E(K())}.</h3>
      <div class="b2-sheet-sub">Your sidekick for briefs, deadlines and your next move.</div>
      <div class="b2-asks2"><button type="button" data-x="d">Show me live campaigns ›</button><button type="button" data-x="i">How do I apply? ›</button><button type="button" data-x="v">See how it works ›</button></div>
      <div class="b2-say-ans" id="b2Say" hidden>Open any campaign and read the full brief. When one fits, tap <b>Apply</b> — I'll ask for your WhatsApp number (one-time code, no password). Instagram is asked only when you apply.</div>
      <button type="button" class="b2-btn cream full" data-x="in">Sign in to chat with ${E(K())}&nbsp; →</button></div>`;
    document.body.appendChild(o);
    const close = ()=> o.remove(); o.onclick = e=>{ if(e.target === o) close(); };
    o.querySelector('[data-x="d"]').onclick = ()=>{ close(); go("home"); };
    o.querySelector('[data-x="i"]').onclick = ()=>{ o.querySelector("#b2Say").hidden = false; };
    o.querySelector('[data-x="v"]').onclick = ()=>{ close(); video(()=> toSignIn()); };
    o.querySelector('[data-x="in"]').onclick = ()=>{ close(); toSignIn(); };
  }

  /* =================== WhatsApp verified, no Instagram (V2-N09 · N10 · G3 · N05B / W45 · W47 · W46 · W48) =================== */
  const igLaterKey = () => "bx_ig_later_" + ((window.Auth && Auth.profile && Auth.profile.id) || "");
  const igLater = () => { try{ return localStorage.getItem(igLaterKey()) === "1"; }catch(e){ return false; } };
  function igApplySheet(applyId){
    if(applyId){ try{ localStorage.setItem("geek_apply", applyId); }catch(e){} }
    let o = document.getElementById("b2Sheet"); if(o) o.remove();
    o = document.createElement("div"); o.id = "b2Sheet"; o.className = "b2-dim b2-sheetwrap";
    o.innerHTML = `<div class="b2-sheet light b2-vsheet" role="dialog" aria-label="Connect Instagram to apply"><i class="b2-grab"></i>
      ${kidImg("b2-sheet-kid")}<h3 class="serif">Connect Instagram to apply</h3>
      <p class="b2-sheet-p">The brand checks real reach before selecting. Connect once — 30 seconds — and your application goes in. Your saved profile stays as it is.</p>
      <button type="button" class="b2-btn forest full" data-x="ig">Connect with Instagram&nbsp; →</button>
      <button type="button" class="b2-link ink" data-x="no">Not now — keep exploring</button>
      ${tip("Official Meta login — I never see your password.")}</div>`;
    document.body.appendChild(o);
    const close = ()=> o.remove(); o.onclick = e=>{ if(e.target === o) close(); };
    o.querySelector('[data-x="no"]').onclick = close;
    o.querySelector('[data-x="ig"]').onclick = ()=>{ if(window.Tracker) Tracker.security("instagram_connect_start"); try{ sessionStorage.setItem("bx_ig_from_apply","1"); }catch(e){} connectInstagram(); };
  }
  window.bxIgApply = igApplySheet;
  // Discover for a signed-in creator who hasn't connected Instagram yet (the app's own Campaigns page is locked until then)
  window.bxMemberExplore = function(page){ G.member = true; G.list = null; go(page === "discover" ? "home" : (page || "home")); };
  window.bxMemberExploreOff = function(){ G.member = false; };
  /* ← Back: sign-in steps and guest / explore pages */
  const signedIn = ()=> !!(window.__osBooted && window.Auth && Auth.user);
  if(window.BxHist){
    BxHist.on("w", st=>{
      if(signedIn()) return false;
      let w = document.querySelector("#authRoot #bxw");
      if(!w){ if(st !== "welcome") window.__bxWantForm = true; mountLogin("login"); w = document.querySelector("#authRoot #bxw"); }
      if(!w) return false;
      const row = document.getElementById("waCodeRow");
      if(st !== "otp" && row && row.style.display !== "none"){ const c = document.getElementById("waChange"); if(c) c.click(); }
      if(st === "otp" && !(row && row.style.display !== "none")) st = "form";
      w.dataset.st = st; window.scrollTo(0,0);
      return true;
    });
    BxHist.on("g", page=>{
      if(G.on || G.member){ go(page); return true; }
      if(signedIn()){
        if(typeof currentPage === "undefined" || !window.__profileGate) return false;
        currentPage = "opencampaigns"; renderShell(); setTimeout(()=> window.bxMemberExplore && bxMemberExplore(page), 60); return true;
      }
      startGuest(); if(page !== "home") go(page); return true;
    });
  }

  /* =================== Pick your sidekick (V2-04 / W13) =================== */
  const kidKey = () => "bx_sidekick_" + ((window.Auth && Auth.profile && Auth.profile.id) || "");
  function preShell(st, scene, panel){
    const root = document.getElementById("authRoot"); if(!root) return null;
    if(window.hideBootSplash) try{ hideBootSplash(); }catch(e){}
    document.body.classList.add("bx-pre"); root.classList.add("open");
    root.innerHTML = `<div class="b2 b2-pre" id="bxw" data-st="${st}" data-scene="${scene||"parch"}">${hero()}<section class="b2-panel" id="bxCard">${panel}${FOOT}</section></div>`;
    root.scrollTop = 0; window.scrollTo(0,0);
    root.querySelectorAll('[data-bx="video"]').forEach(b=> b.onclick = ()=> video());
    return root;
  }
  B2.preShell = preShell;
  function sidekickScreen(next){
    const KS = (window.bxKid && bxKid.kids) || {};
    let pick = (window.bxKid && bxKid.kid()) || "pip";
    const root = preShell("kid", "parch", `
      <div class="b2-ptop"><div class="b2-plogo m-only">${LOGO}</div><div class="b2-progrow">${prog(3, "03/06")}</div></div>
      <h2 class="b2-h b2-swoosh">Pick your sidekick.</h2>
      <p class="b2-p">A little personality for your creator journey. You can switch anytime.</p>
      <div class="b2-note sm">✨ <span>Your avatar is just for fun — brands still see your real creator profile.</span></div>
      <div class="b2-kidgrid" data-kid>${Object.entries(KS).map(([k,v])=>`<button type="button" class="b2-kt k-${k}${k===pick?" on":""}" data-k="${k}"><img src="${v.img}" alt=""><b>${E(v.n).toUpperCase()}</b><span>${E(v.t)}</span><i class="b2-chk"></i></button>`).join("")}</div>
      <button type="button" class="b2-btn forest full big" id="bxKidGo">Continue with <span id="bxKidGoName">${E((KS[pick]||{}).n||"Pip")}</span>&nbsp; →</button>
      <button type="button" class="b2-link ink u" id="bxKidLater">I'll choose later</button>`);
    if(!root) return next();
    root.querySelectorAll(".b2-kt").forEach(b=> b.onclick = ()=>{ root.querySelectorAll(".b2-kt").forEach(x=> x.classList.toggle("on", x===b)); pick = b.dataset.k; document.getElementById("bxKidGoName").textContent = KS[pick].n; });
    const done = v => { try{ localStorage.setItem(kidKey(), v); }catch(e){} next(); };
    document.getElementById("bxKidGo").onclick = async ()=>{ if(window.bxKid) await bxKid.save({ kid:pick }); done(pick); };
    document.getElementById("bxKidLater").onclick = ()=> done("later");
  }

  /* =================== Connect Instagram (V2-05 / W21) · manual profile (V2-G2 / W28) =================== */
  const papi = (fn, a) => sb.schema("api").rpc(fn, a || {}).then(r=> r, e=> ({ error:e }));
  function igGate(){
    const root = preShell("ig", "parch", `
      <div class="b2-ptop"><div class="b2-plogo m-only">${LOGO}</div><div class="b2-progrow">${prog(4, "04/06")}</div></div>
      <h2 class="b2-h">Let your work <u class="cy">speak.</u></h2>
      <p class="b2-p">Connect Instagram to build your media kit in seconds.</p>
      <div class="b2-igart">${kidImg("b2-igkid")}<div class="b2-mkprev"><div class="mk-h"><img src="${R}ph_portrait.jpg" alt=""><b>Your Media Kit</b></div><i></i><i class="s"></i>
        <div class="mk-r"><span>👥&nbsp; Audience</span><em class="bars"><b></b><b></b><b></b><b></b><b></b></em></div><div class="mk-r"><span>▶&nbsp; Top content</span><em class="sq"><b></b><b></b><b></b></em></div></div></div>
      <div class="b2-benefits"><div><span>🗂</span>Auto-build your media kit</div><div><span>🎯</span>Get better-fit campaign matches</div><div><span>🛡</span>Share verified insights with brands</div></div>
      <button type="button" class="b2-btn forest full ig" id="gateIg"><span class="b2-iglogo"></span>Connect with Instagram&nbsp; →</button>
      <button type="button" class="b2-link ink" id="bxIgLater">I'll do this later</button>
      <div class="b2-note sm">🛡 <span>Official Meta connection. No password shared. Disconnect anytime.</span></div>
      ${tip("Connect once — I'll build your media kit while you wait.")}
      <button type="button" class="b2-link mute" id="gateSignout">Sign out</button>`);
    if(!root) return;
    document.getElementById("gateIg").onclick = ()=>{ if(window.Tracker) Tracker.security("instagram_connect_start"); connectInstagram(); };
    document.getElementById("gateSignout").onclick = ()=> window.Auth && Auth.signOut();
    document.getElementById("bxIgLater").onclick = ()=>{
      try{ localStorage.setItem(igLaterKey(), "1"); }catch(e){}
      const r2 = document.getElementById("authRoot"); if(r2){ r2.classList.remove("open"); r2.innerHTML = ""; } document.body.classList.remove("bx-pre");
      window.__bxNoIg = true; window.__bxManualLast = true; bootOS();
    };
  }
  function manualProfile(){
    const md = (window.__bxMeta && __bxMeta.bx_manual) || {};
    const P = (window.Auth && Auth.profile) || {};
    const nm = /^wa_\d+@/.test(P.name||"") ? "" : (P.name || "");
    const root = preShell("manual", "parch", `
      <div class="b2-ptop"><div class="b2-plogo m-only">${LOGO}</div><div class="b2-progrow">${prog(4, "04/06")}</div></div>
      <h2 class="b2-h">Tell us about you.</h2>
      <p class="b2-p">No Instagram connected? No problem — enter your details manually.</p>
      <label class="b2-lab">Instagram handle<input class="b2-in" id="bxmHandle" placeholder="@yourhandle" value="${E(md.ig_handle||"")}" autocomplete="off"></label>
      <label class="b2-lab">Full name<input class="b2-in" id="bxmName" placeholder="Your name" value="${E(nm)}" autocomplete="name"></label>
      <label class="b2-lab">City<input class="b2-in" id="bxmCity" placeholder="e.g. Bengaluru" value="${E(md.city||"")}" autocomplete="address-level2"></label>
      <label class="b2-lab">Followers (approx.)<input class="b2-in" id="bxmFol" placeholder="e.g. 12,000" inputmode="numeric" value="${E(md.followers||"")}"></label>
      <div class="b2-note">Shown to brands as “self-reported” until you connect Instagram. Some campaigns need a verified account.</div>
      <div class="auth-err" id="bxmErr"></div>
      <button type="button" class="b2-btn forest full big" id="bxmGo">Continue&nbsp; →</button>
      <button type="button" class="b2-link cy u" id="bxmIg">Connect Instagram instead</button>
      ${tip("You can connect Instagram later from Profile.")}`);
    if(!root) return;
    document.getElementById("bxmIg").onclick = ()=>{ if(window.Tracker) Tracker.security("instagram_connect_start"); connectInstagram(); };
    document.getElementById("bxmGo").onclick = async ()=>{
      const btn = document.getElementById("bxmGo"), err = document.getElementById("bxmErr"); err.textContent = "";
      const v = id => document.getElementById(id).value.trim();
      const handle = v("bxmHandle").replace(/^@+/,""), name = v("bxmName"), city = v("bxmCity"), fol = v("bxmFol").replace(/[^\d]/g,"");
      if(handle && !/^[A-Za-z0-9._]{1,30}$/.test(handle)){ err.textContent = "That Instagram handle doesn't look right — letters, numbers, dots and underscores only."; return; }
      btn.disabled = true; btn.textContent = "Saving…";
      try{
        const manual = { ig_handle: handle ? "@" + handle : "", followers: fol ? Number(fol) : null, city, self_reported:true, at: new Date().toISOString() };
        try{ await sb.auth.updateUser({ data:{ bx_manual: manual } }); window.__bxMeta = Object.assign({}, window.__bxMeta||{}, { bx_manual: manual }); }catch(e){}
        if(window.__ciProfileEnabled){
          const parts = name.split(/\s+/).filter(Boolean);
          if(parts.length) await papi("save_profile_section", { p_section:"personal", p_patch:{ first_name:parts[0], last_name:parts.slice(1).join(" ") || null }, p_correlation:"ui-manual" });
          const pp = {}; if(name) pp.display_name = name; if(city) pp.city_coarse = city;
          if(Object.keys(pp).length) await papi("save_profile_section", { p_section:"professional", p_patch:pp, p_correlation:"ui-manual" });
        }
      }catch(e){}
      try{ localStorage.setItem(igLaterKey(), "1"); }catch(e){}
      const root2 = document.getElementById("authRoot"); root2.classList.remove("open"); root2.innerHTML = ""; document.body.classList.remove("bx-pre");
      window.__bxNoIg = true; bootOS();
    };
  }
  if(typeof window.showInstagramGate === "function"){
    window.showInstagramGate = function(){
      let seen = null; try{ seen = localStorage.getItem(kidKey()); }catch(e){}
      if(!seen) return sidekickScreen(igGate);
      return igGate();
    };
  }
  // "Not now" was chosen on this device: open the app; Instagram is asked only when they apply
  if(typeof window.creatorHasInstagram === "function"){
    const _has = window.creatorHasInstagram;
    window.creatorHasInstagram = async function(){ const r = await _has.apply(this, arguments); return r || igLater(); };
  }
  // keep the creator's own metadata (manual profile) at hand
  setTimeout(async function meta(){ try{ if(!window.sb) return; const { data } = await sb.auth.getUser(); window.__bxMeta = (data && data.user && data.user.user_metadata) || {}; }catch(e){} }, 1200);

  // login.js may have painted its own screen before this file loaded — repaint it as the Bounty welcome
  const root = document.getElementById("authRoot");
  const inv = typeof INVITE_TOKEN !== "undefined" && INVITE_TOKEN;
  if(root && root.classList.contains("open") && root.querySelector(".auth-wrap") && creatorDoor() && !inv){
    try{ mountLogin("login"); }catch(e){}
  }
  // the app may have shown its own Instagram step before this file loaded — repaint it as the Bounty one
  if(root && root.classList.contains("open") && document.getElementById("gateIg") && !root.querySelector("#bxw") && typeof window.showInstagramGate === "function"){
    try{ window.showInstagramGate(); }catch(e){}
  }

  /* =================== Instagram connected: loader (V2-05B / W22) driven by the real steps → identity (V2-05A / W23) → media kit (V2-05C / W24) ===================
     1 Connecting   = Instagram handed the code back
     2 Gathering    = the server is reading the account
     3 Building     = the account is saved and the app is drawing the media kit
     4 Ready        = the media kit is on screen */
  const STEPS = ["Connecting your Instagram…","Gathering your creator details…","Building your media kit…","Your media kit is ready!"];
  function igPaint(n){
    const st = window.__bxIg; if(!st) return; if(n < st.stage) return; st.stage = n;
    const o = document.getElementById("igProg"); if(!o) return;
    o.querySelectorAll(".b2-ls li").forEach((x,i)=>{ x.classList.toggle("done", i < n); x.classList.toggle("on", i === n); });
    const bar = o.querySelector(".b2-lbar i"); if(bar) bar.style.width = Math.min(100, 25 * (n+1)) + "%";
  }
  function igLoader(){
    if(window.hideBootSplash) try{ hideBootSplash(); }catch(e){}
    let o = document.getElementById("igProg");
    if(!o){ o = document.createElement("div"); o.id = "igProg"; document.body.appendChild(o); }
    o.className = "ig-prog b2 b2-pre b2-load";
    o.innerHTML = `<div id="bxw" data-st="load" data-scene="jungle">${hero()}<section class="b2-panel">
      <div class="b2-ptop"><div class="b2-plogo m-only">${LOGO}</div></div>
      <div class="b2-lchip">Instagram connected ✓</div>
      <div class="b2-lorb">${kidImg()}</div>
      <h2 class="b2-h serif light">Building your media kit…</h2>
      <ul class="b2-ls">${STEPS.map(s=>`<li><i></i>${s}</li>`).join("")}</ul>
      <div class="b2-lbar"><i></i></div>
      <button type="button" class="b2-btn ghost-light" id="bxLoadGo">Continue while we finish</button>
      ${tip("Hang tight — I'm planting your media kit. 🌱")}${FOOT}</section></div>`;
    o.querySelectorAll('[data-bx="video"]').forEach(b=> b.onclick = ()=> video());
    window.__bxIg = { stage:0 }; igPaint(1);
    document.getElementById("bxLoadGo").onclick = ()=>{ igClose(); };
  }
  async function igRows(){
    try{ const r = await sb.from("social_accounts").select("username,name,followers_count,media_count,recent_media,profile_picture_url,account_type,updated_at").eq("platform","instagram").eq("member_id", Auth.profile.id).order("updated_at",{ascending:false}); return (r && r.data) || []; }catch(e){ return []; }
  }
  const nfmt = v => typeof fmtNum === "function" ? fmtNum(v||0) : (v>=1e6 ? (v/1e6).toFixed(1)+"M" : v>=1e3 ? (v/1e3).toFixed(1).replace(/\.0$/,"")+"K" : String(v||0));
  const engOf = a => { const media = Array.isArray(a.recent_media) ? a.recent_media : []; return (a.followers_count && media.length) ? (100 * media.reduce((s,m)=> s + (Number(m.like_count)||0) + (Number(m.comments_count)||0), 0) / media.length / a.followers_count).toFixed(1) + "%" : "—"; };
  async function igIdentity(){
    const o = document.getElementById("igProg"); if(!o) return;
    const rows = await igRows(), a = rows[0];
    if(!a){ igClose(); return; }
    let prof = null; if(window.__ciProfileEnabled){ const r = await papi("get_my_profile"); if(!r.error) prof = r.data; }
    const pro = (prof && prof.professional) || {};
    const cats = (pro.categories||[]).slice(0,2).join("  ·  "), city = pro.city_coarse || "";
    o.querySelector(".b2-panel").innerHTML = `
      <div class="b2-ptop"><div class="b2-plogo m-only">${LOGO}</div></div>
      <div class="b2-eyebrow light">Profile 2/4</div><div class="b2-bars2"><i class="on"></i><i class="on"></i><i></i><i></i></div>
      <h2 class="b2-h serif gold">Your creator identity.</h2>
      <p class="b2-p light">Instagram connected. Let's make this yours.</p>
      <div class="b2-okpill">📷 &nbsp;|&nbsp; Connected successfully</div>
      <div class="b2-idcard">${a.profile_picture_url?`<img src="${E(a.profile_picture_url)}" alt="">`:`<span class="b2-ini">${E(String(a.username||"C").charAt(0).toUpperCase())}</span>`}
        <div><b>@${E(a.username)}</b><span>${E(a.name||"")}</span><em>${E([cats, city].filter(Boolean).join("  ·  "))}</em></div>
        <div class="b2-nums"><div><b>${nfmt(a.followers_count)}</b><span>Followers</span></div><div><b>${engOf(a)}</b><span>Engagement*</span></div><div><b>${nfmt(a.media_count)}</b><span>Posts*</span></div></div>
        <p class="b2-fine">*Shown only when available from connected permissions</p></div>
      <div class="b2-check4"><h5>Your profile</h5>
        <div class="ok">Instagram handle <i>— imported</i></div><div class="ok">Profile photo &amp; bio <i>— imported</i></div>
        <div class="${city?"ok":""}">City <i>— ${city?"saved":"confirm"}</i></div><div class="${cats?"ok":""}">Creator categories <i>— ${cats?"saved":"choose next"}</i></div>
        <p>You can review or edit these details anytime.</p></div>
      ${tip("Add your city to discover nearby campaigns!", "Tip")}
      <div class="b2-access">🔒 &nbsp;|&nbsp; You control Instagram access <a href="#" id="bxPerm">View permissions</a></div>
      <button type="button" class="b2-btn cream full" id="bxIdGo">Continue with my profile&nbsp; →</button>
      <button type="button" class="b2-btn ghost-light full" id="bxIdRev">Review details</button>${FOOT}`;
    document.getElementById("bxPerm").onclick = e=>{ e.preventDefault(); igClose(); go2("bxsettings"); };
    document.getElementById("bxIdRev").onclick = ()=>{ igClose(); go2("profile"); };
    document.getElementById("bxIdGo").onclick = ()=> igKit(rows);
    o.querySelector("#bxw").dataset.st = "id";
  }
  function igKit(rows){
    const o = document.getElementById("igProg"); if(!o) return; const a = rows[0];
    const w = o.querySelector("#bxw"); w.dataset.st = "kit"; w.dataset.scene = "parch";
    o.querySelector(".b2-panel").innerHTML = `
      <div class="b2-ptop"><div class="b2-plogo m-only">${LOGO}</div></div>
      <h2 class="b2-h serif">Your world, <u class="rd">in one kit.</u></h2>
      <p class="b2-p it">Your Instagram is connected. Meet your media kit.</p>
      <div class="b2-okpill light">✓ &nbsp;Instagram connected</div>
      <div class="b2-orn-t">— Your media kit — ready to preview —</div>
      <div class="b2-kitcard">${a.profile_picture_url?`<img src="${E(a.profile_picture_url)}" alt="">`:`<span class="b2-ini">${E(String(a.username||"C").charAt(0).toUpperCase())}</span>`}
        <div><b>${E(a.name||a.username)}</b><span>@${E(a.username)}</span></div>
        <div class="b2-nums ink"><div><b>${nfmt(a.followers_count)}</b><span>Followers</span></div><div><b>${engOf(a)}</b><span>Engagement</span></div><div><b>${nfmt(a.media_count)}</b><span>Posts</span></div></div>
        <p class="b2-fine">From Instagram · just now</p>
        <div class="b2-kitbtns"><button type="button" class="b2-btn red" id="bxKitPrev">✦ Preview media kit ↗ ✦</button></div></div>
      <div class="b2-orn-t sm">✦ Your Instagram accounts ✦</div>
      <div class="b2-accts">${rows.map(x=>`<div><span>📸</span><b>@${E(x.username)}</b><em>✓ Connected</em></div>`).join("")}
        <a href="#" id="bxKitMore"><span>⊕</span>Connect another Instagram account<i>›</i></a></div>
      <p class="b2-p it sm">Add more accounts to build one complete creator portfolio.</p>
      ${tip("Add all your accounts for a stronger media kit.", "Tip")}
      <p class="b2-p it">Next: Confirm your profile details</p>
      <button type="button" class="b2-btn forest full big" id="bxKitGo">✦&nbsp; Continue&nbsp; →&nbsp; ✦</button>${FOOT}`;
    document.getElementById("bxKitPrev").onclick = ()=>{ igClose(); go2("mediakit"); };
    document.getElementById("bxKitMore").onclick = e=>{ e.preventDefault(); igClose(); if(typeof igAddAnother==="function") igAddAnother("mediakit"); };
    document.getElementById("bxKitGo").onclick = ()=>{ igClose(); go2("dashboard"); setTimeout(()=> window.bxMaybeOnboard && bxMaybeOnboard(), 300); };
  }
  function go2(k){ if(typeof currentPage === "undefined") return; currentPage = k; if(typeof renderShell === "function") renderShell(); }
  function igClose(){ const o = document.getElementById("igProg"); window.__bxIg = null; if(o){ o.classList.add("out"); setTimeout(()=> o.remove(), 300); } }
  window.__bxIgStage = n => igPaint(n === 2 ? 2 : n);
  if(creatorDoor()){
    window.igProgStart = igLoader;
    window.igProgFinish = async function(fast){
      const st = window.__bxIg;
      if(fast){ if(st && st.stage >= 4) return; igClose(); return; }   // errors close it; the ready card stays until the creator taps
      if(!st || st.finishing) return;
      st.finishing = true; igPaint(2);
      const t0 = Date.now();
      while(Date.now()-t0 < 20000 && !(document.getElementById("mkHeadWrap") || document.getElementById("igBody") || document.getElementById("content"))) await new Promise(r=> setTimeout(r, 250));
      igPaint(3); await new Promise(r=> setTimeout(r, 600)); igPaint(4);
      await new Promise(r=> setTimeout(r, 500));
      if(window.Auth && Auth.profile && Auth.profile.role === "creator"){
        let fromApply = null; try{ fromApply = sessionStorage.getItem("bx_ig_from_apply"); sessionStorage.removeItem("bx_ig_from_apply"); }catch(e){}
        if(fromApply){ igSent(); return; }
        igIdentity();
      } else igClose();
    };
    // the app started its own loader before this file loaded (Instagram sent us back) — take it over
    if(document.getElementById("igProg") && !window.__bxIg) igLoader();
  }
  // V2-N05B / W48: connected from Apply → the application goes in
  function igSent(){
    const o = document.getElementById("igProg"); if(!o) return;
    o.querySelector(".b2-panel").innerHTML = `<div class="b2-ptop"><div class="b2-plogo m-only">${LOGO}</div></div>
      <div class="b2-lchip">Instagram connected ✓</div><div class="b2-lorb">${kidImg()}</div>
      <h2 class="b2-h serif light">Application sent!</h2><p class="b2-p light">Your Instagram is connected and your application is on its way to the brand. Track it in My campaigns.</p>
      <button type="button" class="b2-btn cream full" id="bxSentGo">See my applications&nbsp; →</button>
      <button type="button" class="b2-btn ghost-light full" id="bxSentMore">Keep exploring</button>${tip("I'll tell you the moment the brand replies.")}${FOOT}`;
    document.getElementById("bxSentGo").onclick = ()=>{ igClose(); go2("mycampaigns"); };
    document.getElementById("bxSentMore").onclick = ()=>{ igClose(); go2("opencampaigns"); };
  }
  // the app opening its shell after Instagram answered = step 2
  if(typeof window.bootOS === "function"){
    const _b2 = window.bootOS;
    window.bootOS = function(){ if(window.__bxIg) igPaint(2); return _b2.apply(this, arguments); };
  }

  /* =================== New creator profile setup (V2-06 · 07 · 08 / N06–N08 · W25–W27) — saves to the real profile =================== */
  const onbKey = () => "bx_onb_done_" + ((window.Auth && Auth.profile && Auth.profile.id) || "");
  let _onbChecked = false;
  window.bxMaybeOnboard = async function(force){
    waOptin();
    if(!force && _onbChecked) return; _onbChecked = true;
    if(!(window.Auth && Auth.profile && Auth.profile.role === "creator") || !window.__ciProfileEnabled) return;
    const ar = document.getElementById("authRoot"); if(ar && ar.classList.contains("open")){ _onbChecked = false; return; }   // sign-in / Instagram step still on screen
    if(document.getElementById("igProg")){ _onbChecked = false; return; }
    try{ if(!force && localStorage.getItem(onbKey())) return; }catch(e){}
    const r = await papi("get_my_profile"); if(r.error || !r.data) return;
    const d = r.data, pro = d.professional || {};
    if(!force && ((pro.categories||[]).length || (pro.content_formats||[]).length)) { try{ localStorage.setItem(onbKey(), "1"); }catch(e){} return; }
    onbStep(1, d);
  };
  // "Send me matching campaign alerts on WhatsApp (optional)" from the sign-in screen → the creator's contact opt-in
  let _wa = false;
  function waOptin(){
    if(_wa || !(window.Auth && Auth.profile && Auth.profile.id) || !window.__ciProfileEnabled) return; _wa = true;
    let v = null; try{ v = localStorage.getItem("bx_wa_alerts"); }catch(e){}
    if(v === "1"){ papi("save_profile_section", { p_section:"contact", p_patch:{ whatsapp_optin:true }, p_correlation:"ui-signin" }).then(()=>{ try{ localStorage.setItem("bx_wa_alerts", "done"); }catch(e){} }); }
  }
  function onbShell(st, scene, inner){
    let o = document.getElementById("bxOnb");
    if(!o){ o = document.createElement("div"); o.id = "bxOnb"; o.className = "bx-onb b2 b2-pre"; document.body.appendChild(o); }
    o.innerHTML = `<div id="bxw" data-st="${st}" data-scene="${scene}">${hero()}<section class="b2-panel">${inner}${FOOT}</section></div>`;
    o.querySelectorAll('[data-bx="video"]').forEach(b=> b.onclick = ()=> video());
    o.scrollTop = 0;
    return o;
  }
  const noIg = () => !!(window.__profileGate || window.__bxNoIg);
  const top = (n, label) => `<div class="b2-ptop"><div class="b2-plogo m-only">${LOGO}</div><div class="b2-progrow">${prog(n, label)}</div></div>`;
  const manualDone = ()=>{ const m = (window.__bxMeta && __bxMeta.bx_manual) || {}; return !!(m.ig_handle || m.at); };
  function onbFinish(goExplore){
    window.__bxOnbOnly = false;
    if(noIg() && !manualDone() && !window.__bxManualShown){ window.__bxManualShown = true; return onbManual(goExplore); }
    try{ localStorage.setItem(onbKey(), "1"); localStorage.setItem("ci_ob_commercial_" + ((Auth.profile && (Auth.profile.id||Auth.profile.user_id)) || "me"), "1"); }catch(e){}
    const o = document.getElementById("bxOnb"); if(o) o.remove();
    if(window.__profileReq && typeof creatorProfileGate === "function"){ creatorProfileGate().then(()=>{}).catch(()=>{}); }
    const ret = window.__bxOnbReturn; window.__bxOnbReturn = null;
    if(ret){ currentPage = ret; renderShell(); window.scrollTo(0,0); return; }
    if(goExplore){ if(window.__profileGate && window.bxMemberExplore){ currentPage = "opencampaigns"; renderShell(); setTimeout(()=> bxMemberExplore("discover"), 50); } else { currentPage = "opencampaigns"; renderShell(); } }
    else { currentPage = "dashboard"; renderShell(); }
  }
  const err = msg => { const e = document.getElementById("bxoErr"); if(e) e.textContent = msg; };
  // last step for a creator without Instagram connected: their handle, name, city and followers (self-reported)
  function onbManual(goExplore){
    const md = (window.__bxMeta && __bxMeta.bx_manual) || {};
    const P = (window.Auth && Auth.profile) || {};
    const nm = /^wa_\d+@/.test(P.name||"") ? "" : (P.name || "");
    onbShell("manual", "parch", `<div class="b2-ptop"><div class="b2-plogo m-only">${LOGO}</div><div class="b2-progrow"><span class="b2-pn wide">Last step</span></div></div>
      <h2 class="b2-h">Tell us about you.</h2>
      <p class="b2-p">No Instagram connected? No problem — enter your details manually.</p>
      <label class="b2-lab">Instagram handle<input class="b2-in" id="bxmHandle" placeholder="@yourhandle" value="${E(md.ig_handle||"")}" autocomplete="off"></label>
      <label class="b2-lab">Full name<input class="b2-in" id="bxmName" placeholder="Your name" value="${E(nm)}" autocomplete="name"></label>
      <label class="b2-lab">City<input class="b2-in" id="bxmCity" placeholder="e.g. Bengaluru" value="${E(md.city||"")}" autocomplete="address-level2"></label>
      <label class="b2-lab">Followers (approx.)<input class="b2-in" id="bxmFol" placeholder="e.g. 12,000" inputmode="numeric" value="${E(md.followers||"")}"></label>
      <div class="b2-note">Shown to brands as “self-reported” until you connect Instagram. Some campaigns need a verified account.</div>
      <div class="auth-err" id="bxoErr"></div>
      <button type="button" class="b2-btn forest full big" id="bxmGo">Finish&nbsp; →</button>
      <button type="button" class="b2-link cy u" id="bxmIg">Connect Instagram instead</button>
      <button type="button" class="b2-link mute" id="bxmSkip">Skip for now</button>`);
    document.getElementById("bxmIg").onclick = ()=>{ if(window.Tracker) Tracker.security("instagram_connect_start"); connectInstagram(); };
    document.getElementById("bxmSkip").onclick = ()=> onbFinish(goExplore);
    document.getElementById("bxmGo").onclick = async ()=>{
      const btn = document.getElementById("bxmGo"); err("");
      const v = id => document.getElementById(id).value.trim();
      const handle = v("bxmHandle").replace(/^@+/,""), name = v("bxmName"), city = v("bxmCity"), fol = v("bxmFol").replace(/[^\d]/g,"");
      if(handle && !/^[A-Za-z0-9._]{1,30}$/.test(handle)){ err("That Instagram handle doesn't look right — letters, numbers, dots and underscores only."); return; }
      btn.disabled = true; btn.textContent = "Saving…";
      try{
        const manual = { ig_handle: handle ? "@" + handle : "", followers: fol ? Number(fol) : null, city, self_reported:true, at: new Date().toISOString() };
        const u = await sb.auth.updateUser({ data:{ bx_manual: manual } }); if(u && u.error) throw u.error;
        window.__bxMeta = Object.assign({}, window.__bxMeta||{}, { bx_manual: manual });
        const parts = name.split(/\s+/).filter(Boolean);
        if(parts.length){ const r = await papi("save_profile_section", { p_section:"personal", p_patch:{ first_name:parts[0], last_name:parts.slice(1).join(" ") || null }, p_correlation:"ui-manual" }); if(r.error) throw r.error; }
        const pp = {}; if(name) pp.display_name = name; if(city) pp.city_coarse = city;
        if(handle) pp.ig_handle_self = handle; if(fol) pp.followers_self = fol;   // self-reported — shown on the creator's page for the Super Admin
        if(Object.keys(pp).length){ const r = await papi("save_profile_section", { p_section:"professional", p_patch:pp, p_correlation:"ui-manual" }); if(r.error) throw r.error; }
      }catch(e){ err("Couldn't save: " + (e.message || e)); btn.disabled = false; btn.innerHTML = "Finish&nbsp; →"; return; }
      onbFinish(goExplore);
    };
  }
  function onbStep(n, d){
    const pro = d.professional || {}, cp = d.commercial_preference || {};
    if(n === 1){
      const US = id => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=480&h=340&q=70`;
      const CATS = [["Food",R+"ph_food.jpg"],["Beauty",R+"ph_beauty.jpg"],["Fashion",R+"ph_fashion.jpg"],["Fitness",R+"ph_fitness.jpg"],["Pets",R+"ph_pets.jpg"],["Travel",R+"ph_travel.jpg"],
        ["Lifestyle",US("photo-1622049605334-72e1e4432346")],["Tech",US("photo-1614624532983-4ce03382d63d")],["Gaming",US("photo-1636487658616-14850c8f496c")],
        ["Parenting",US("photo-1589169011402-8b2cbd1ee593")],["Home & Decor",US("photo-1745429523617-0d837856ca35")],["Education",US("photo-1617009762269-c062aaf6b3a0")]];
      const FMT = [["reel","Reels"],["story","Stories"],["carousel","Carousels"],["ugc","UGC videos"]];
      const LANG = ["Hindi","Hinglish","English","Bengali","Tamil","Telugu","Marathi","Gujarati","Kannada","Malayalam","Punjabi","Odia","Assamese","Urdu"];
      const cats = pro.categories || [], fmts = pro.content_formats || [], langs = pro.languages || [];
      const extraC = cats.filter(c=> !CATS.some(x=> x[0].toLowerCase()===String(c).toLowerCase())), extraL = langs.filter(l=> !LANG.some(x=> x.toLowerCase()===String(l).toLowerCase()));
      const catTile = (c, img, on) => img ? `<button type="button" class="b2-cat${on?" on":""}" data-v="${E(c)}"><img src="${img}" alt="" loading="lazy"><b>${E(c.toUpperCase())}</b><i class="b2-chk"></i></button>`
        : `<button type="button" class="b2-cat own${on?" on":""}" data-v="${E(c)}"><b>${E(c.toUpperCase())}</b><i class="b2-chk"></i></button>`;
      const o = onbShell("onb1", "parch", `${top(5)}
        <h2 class="b2-h">What's your kind<br>of <span class="b2-hl">content?</span></h2>
        <p class="b2-p">Pick up to 3 categories. We'll find briefs that fit your world.</p>
        <div class="b2-catgrid" id="bxoCats">${CATS.map(([c,img])=> catTile(c, img, cats.some(x=> String(x).toLowerCase()===c.toLowerCase()))).join("")}${extraC.map(c=> catTile(c, null, true)).join("")}</div>
        <div class="b2-addown" id="bxoCatAddW"><button type="button" class="b2-btn outline" id="bxoCatAdd">+&nbsp; Add your own category</button></div>
        <div class="b2-lab c"${window.__bxOnbOnly?' style="display:none"':''}>How do you create?</div>
        <div class="b2-chips" id="bxoFmt"${window.__bxOnbOnly?' style="display:none"':''}>${FMT.map(([k,l])=>`<button type="button" class="b2-chip${fmts.includes(k)?" on":""}" data-v="${k}">${l}</button>`).join("")}</div>
        <div class="b2-lab c">Your content language</div>
        <div class="b2-chips" id="bxoLang">${LANG.concat(extraL).map(l=>`<button type="button" class="b2-chip${langs.some(x=> String(x).toLowerCase()===l.toLowerCase())?" on":""}" data-v="${E(l)}">${E(l)}</button>`).join("")}</div>
        <div class="b2-addown" id="bxoLangAddW"><button type="button" class="b2-more" id="bxoLangAdd">+ Add another language</button></div>
        ${tip("Pick what you post most — I'll match briefs to it.")}
        <div class="auth-err" id="bxoErr"></div>
        <button type="button" class="b2-btn forest full big" id="bxoSave">${window.__bxOnbOnly ? "Save&nbsp; →" : "Build my creator profile&nbsp; →"}</button>
        <button type="button" class="b2-link mute" id="bxoSkip">You can change these anytime · Skip</button>`);
      const catsOn = ()=> o.querySelectorAll("#bxoCats .b2-cat.on").length;
      const wireCats = ()=> o.querySelectorAll("#bxoCats .b2-cat").forEach(b=> b.onclick = ()=>{ if(!b.classList.contains("on") && catsOn() >= 3){ err("Pick up to 3 — tap one to swap it."); return; } err(""); b.classList.toggle("on"); });
      const wireChips = ()=> o.querySelectorAll("#bxoFmt .b2-chip, #bxoLang .b2-chip").forEach(b=> b.onclick = ()=> b.classList.toggle("on"));
      wireCats(); wireChips();
      // "+ Add your own …": a small box; what they type is added (selected) and saved with the rest
      const addOwn = (wrapId, ph, onAdd) => { const wrap = document.getElementById(wrapId); if(wrap.querySelector("input")) return;
        wrap.innerHTML = `<div class="b2-addin"><input class="b2-in" placeholder="${ph}" maxlength="30"><button type="button" class="b2-btn forest">Add</button></div>`;
        const i = wrap.querySelector("input"); i.focus();
        const go = ()=>{ const v = i.value.trim().replace(/\s+/g," "); if(!v) return; onAdd(v.charAt(0).toUpperCase() + v.slice(1)); i.value = ""; i.focus(); };
        wrap.querySelector("button").onclick = go; i.onkeydown = e=>{ if(e.key === "Enter"){ e.preventDefault(); go(); } }; };
      document.getElementById("bxoCatAdd").onclick = ()=> addOwn("bxoCatAddW", "Type a category, e.g. Cars", v=>{
        const box = document.getElementById("bxoCats"), have = [...box.querySelectorAll(".b2-cat")].find(b=> b.dataset.v.toLowerCase() === v.toLowerCase());
        if(have){ if(!have.classList.contains("on")){ if(catsOn() >= 3){ err("Pick up to 3 — tap one to swap it."); return; } have.classList.add("on"); } return; }
        if(catsOn() >= 3){ err("Pick up to 3 — tap one to swap it, then add yours."); return; }
        err(""); box.insertAdjacentHTML("beforeend", catTile(v, null, true)); wireCats(); });
      document.getElementById("bxoLangAdd").onclick = ()=> addOwn("bxoLangAddW", "Type a language, e.g. Bhojpuri", v=>{
        const box = document.getElementById("bxoLang"), have = [...box.querySelectorAll(".b2-chip")].find(b=> b.dataset.v.toLowerCase() === v.toLowerCase());
        if(have){ have.classList.add("on"); return; }
        box.insertAdjacentHTML("beforeend", `<button type="button" class="b2-chip on" data-v="${E(v)}">${E(v)}</button>`); wireChips(); });
      document.getElementById("bxoSkip").onclick = ()=>{ if(window.__bxOnbOnly){ window.__bxOnbOnly = false; window.__bxManualShown = true; return onbFinish(false); } onbStep(2, d); };
      document.getElementById("bxoSave").onclick = async ()=>{
        const btn = document.getElementById("bxoSave"); err(""); btn.disabled = true; btn.textContent = "Saving…";
        const pick = sel => [...o.querySelectorAll(sel)].map(b=> b.dataset.v);
        const patch = { categories: pick("#bxoCats .b2-cat.on"), languages: pick("#bxoLang .b2-chip.on") };
        if(!window.__bxOnbOnly) patch.content_formats = pick("#bxoFmt .b2-chip.on");
        const r = await papi("save_profile_section", { p_section:"professional", p_patch:patch, p_correlation:"ui-onboard" });
        if(r.error){ err("Couldn't save: " + (r.error.message || r.error)); btn.disabled = false; btn.innerHTML = "Build my creator profile&nbsp; →"; return; }
        d.professional = Object.assign({}, pro, patch);
        if(window.__bxOnbOnly){ window.__bxOnbOnly = false; window.__bxManualShown = true; return onbFinish(false); }
        onbStep(2, d);
      };
    }
    if(n === 2){
      const TILES = [["Nike","ph_b_nike"],["Nykaa","ph_b_nykaa"],["boAt","ph_b_boat"],["Beardo","ph_b_beardo"],["Snuggles","ph_b_snuggles"],["Circle","ph_b_circle"]];
      const have = (d.dream_brands || []).map(x=> x.submitted_brand_name).filter(Boolean);
      const extra = have.filter(h=> !TILES.some(t=> t[0].toLowerCase() === h.toLowerCase()));
      const o = onbShell("onb2", "parch", `<div class="b2-ptop"><div class="b2-plogo m-only">${LOGO}</div><div class="b2-progrow"><span class="b2-pn wide">Your dreams &nbsp;•&nbsp; 05/06</span></div></div>
        <h2 class="b2-h serif b2-swoosh">Who's on your <u>dream list?</u></h2>
        <p class="b2-p">Save up to 5 brands you'd love to work with.</p>
        <div class="b2-dreamtop"><div class="b2-tape">Dream big. We'll help you spot the right opportunities.</div><div class="b2-nice"><span>Nice picks!</span>${kidImg()}</div></div>
        <div class="b2-brandgrid" id="bxoBrands">${TILES.map(([b,ph])=>`<button type="button" class="b2-brand${have.some(h=>h.toLowerCase()===b.toLowerCase())?" on":""}" data-v="${b}"><img src="${R}${ph}.jpg" alt="${b}"><i class="b2-heart"></i></button>`).join("")}
          ${extra.map(b=>`<button type="button" class="b2-brand txt on" data-v="${E(b)}"><b>${E(b)}</b><i class="b2-heart"></i></button>`).join("")}</div>
        <div class="b2-count" id="bxoCount"></div><div class="b2-dots" id="bxoDots"></div>
        <div class="b2-addbrand" id="bxoAddWrap"><button type="button" class="b2-btn outline" id="bxoAdd">+&nbsp; Add another brand</button></div>
        <p class="b2-p it sm">Your list is private. It's a wishlist, not a promise of selection.</p>
        ${tip("I'll ping you when a dream brand opens a campaign.")}
        <div class="auth-err" id="bxoErr"></div>
        <button type="button" class="b2-btn forest full" id="bxoSave">Save my dream board&nbsp; →</button>
        <button type="button" class="b2-link mute" id="bxoSkip">Skip for now</button>`);
      const box = document.getElementById("bxoBrands");
      const count = ()=>{ const k = box.querySelectorAll(".b2-brand.on").length; document.getElementById("bxoCount").textContent = `${k} of 5 dream brands saved`; document.getElementById("bxoDots").innerHTML = [1,2,3,4,5].map(i=>`<i class="${i<=k?"on":""}"></i>`).join(""); };
      const wire = ()=> box.querySelectorAll(".b2-brand").forEach(b=> b.onclick = ()=>{ if(!b.classList.contains("on") && box.querySelectorAll(".b2-brand.on").length >= 5){ err("Up to 5 — tap one to swap it."); return; } err(""); b.classList.toggle("on"); count(); });
      wire(); count();
      document.getElementById("bxoAdd").onclick = ()=>{
        const wrap = document.getElementById("bxoAddWrap"); if(wrap.querySelector("input")) return;
        wrap.innerHTML = `<div class="b2-addin"><input class="b2-in" id="bxoBrandIn" placeholder="Type a brand, e.g. Mamaearth" maxlength="40"><button type="button" class="b2-btn forest" id="bxoBrandOk">Add</button></div>`;
        const i = document.getElementById("bxoBrandIn"); i.focus();
        const add = ()=>{ const v = i.value.trim(); if(!v) return; if([...box.querySelectorAll(".b2-brand")].some(b=> b.dataset.v.toLowerCase() === v.toLowerCase())){ i.value = ""; return; }
          if(box.querySelectorAll(".b2-brand.on").length >= 5){ err("Up to 5 — tap one to swap it."); return; }
          box.insertAdjacentHTML("beforeend", `<button type="button" class="b2-brand txt on" data-v="${E(v)}"><b>${E(v)}</b><i class="b2-heart"></i></button>`); i.value = ""; wire(); count(); };
        document.getElementById("bxoBrandOk").onclick = add; i.onkeydown = e=>{ if(e.key === "Enter"){ e.preventDefault(); add(); } };
      };
      document.getElementById("bxoSkip").onclick = ()=> onbStep(3, d);
      document.getElementById("bxoSave").onclick = async ()=>{
        const btn = document.getElementById("bxoSave"); err(""); btn.disabled = true; btn.textContent = "Saving…";
        const want = [...box.querySelectorAll(".b2-brand.on")].map(b=> b.dataset.v);
        try{
          for(const x of (d.dream_brands||[])){ if(x.submitted_brand_name && !want.some(w=> w.toLowerCase() === x.submitted_brand_name.toLowerCase())){ const r = await papi("delete_dream_brand", { p_aspiration_id:x.aspiration_id, p_correlation:"ui-onboard" }); if(r.error) throw r.error; } }
          let rank = 1;
          for(const b of want){ if(!have.some(h=> h.toLowerCase() === b.toLowerCase())){ const r = await papi("upsert_dream_brand", { p_payload:{ submitted_brand_name:b, priority_rank:rank }, p_correlation:"ui-onboard" }); if(r.error) throw r.error; } rank++; }
          onbStep(3, d);
        }catch(e){ err("Couldn't save: " + (e.message || e)); btn.disabled = false; btn.innerHTML = "Save my dream board&nbsp; →"; }
      };
    }
    if(n === 3){
      const RATES = [["IG Reel","Reel rate"],["IG Story","Story rate"],["IG Static Post","Post rate"]];
      const rItems = ((d.rate_cards && d.rate_cards[0] && d.rate_cards[0].items) || []);
      const rateOf = t => { const x = rItems.find(i=> i.deliverable_type === t); return x ? Math.round(Number(x.amount)) : null; };
      const o = onbShell("onb3", "jungle", `${top(6, "06/06")}
        <h2 class="b2-h light fit">Your work. Your <u class="or">terms.</u></h2>
        <p class="b2-p light">What kind of collaborations are you open to?</p>
        <div class="b2-terms" id="bxoTerms">
          <button type="button" class="b2-term${cp.accepts_barter?" on":""}" data-v="barter"><span class="ic">🎁</span><div><b>Barter</b><em>Products or experiences in return for content</em></div><i class="b2-tick"></i></button>
          <button type="button" class="b2-term" data-v="paid"><span class="ic">₹</span><div><b>Paid</b><em>A cash fee for your creative work</em></div><i class="b2-tick"></i></button>
          <button type="button" class="b2-term" data-v="hybrid"><span class="ic sm">🎁+₹</span><div><b>Hybrid</b><em>A mix of product and payment</em></div><i class="b2-tick"></i></button>
          <button type="button" class="b2-term" data-v="discuss"><span class="ic">💬</span><div><b>Open to discuss</b></div><i class="b2-tick"></i></button></div>
        <div class="b2-exph"><i></i>Your expectations</div>
        <div id="bxoRateL">${RATES.map(([t,l],i)=>`<label class="b2-exprow"><span>${l} (optional)</span><b>₹ <input id="bxoRate${i}" data-t="${t}" inputmode="numeric" placeholder="—" value="${rateOf(t)!=null?E(rateOf(t)):""}"> →</b></label>`).join("")}</div>
        <label class="b2-exprow" id="bxoMinL"><span>Product value you prefer (optional)</span><b><input id="bxoMin" inputmode="numeric" placeholder="Any" value="${cp.min_product_value!=null?E(cp.min_product_value):""}"> →</b></label>
        <div class="b2-note dark">📄<span>You decide on each offer. Ad rights, exclusivity and deadlines are always shown before you accept.</span></div>
        ${tip("Pick all that fit — you can still say no to any offer.")}
        <div class="auth-err" id="bxoErr"></div>
        <button type="button" class="b2-btn cream full" id="bxoSave">${window.__bxOnbOnly ? "Save&nbsp; →" : "Find collaborations for me&nbsp; →"}</button>
        <button type="button" class="b2-link light" id="bxoSkip">Skip for now</button>`);
      const terms = document.getElementById("bxoTerms");
      const sync = ()=>{ const on = [...terms.querySelectorAll(".b2-term.on")].map(b=> b.dataset.v);
        document.getElementById("bxoRateL").style.display = on.includes("barter") && !on.includes("paid") && !on.includes("hybrid") ? "none" : "";
        document.getElementById("bxoMinL").style.display = on.includes("paid") && !on.includes("barter") && !on.includes("hybrid") ? "none" : ""; };
      terms.querySelectorAll(".b2-term").forEach(b=> b.onclick = ()=>{ b.classList.toggle("on"); sync(); }); sync();
      document.getElementById("bxoSkip").onclick = ()=> onbFinish(false);
      document.getElementById("bxoSave").onclick = async ()=>{
        const btn = document.getElementById("bxoSave"); err("");
        const on = [...terms.querySelectorAll(".b2-term.on")].map(b=> b.dataset.v);
        const num = id => { const v = String(document.getElementById(id).value||"").replace(/[^\d.]/g,""); return v === "" ? null : Number(v); };
        const min = num("bxoMin");
        const rates = RATES.map(([t],i)=> [t, num("bxoRate" + i)]).filter(([t,v])=> v != null && v > 0 && v !== rateOf(t));
        btn.disabled = true; btn.textContent = "Saving…";
        const patch = {};
        if(on.length) patch.accepts_barter = on.includes("barter") || on.includes("hybrid");
        if(on.includes("barter") && !on.includes("paid") && !on.includes("hybrid")) patch.product_only = true;
        if(min != null) patch.min_product_value = min;
        if(on.includes("discuss")) patch.notes = "Open to discuss";
        let r = Object.keys(patch).length ? await papi("save_profile_section", { p_section:"commercial_preference", p_patch:patch, p_correlation:"ui-onboard" }) : {};
        for(const [t,v] of rates){ if(r.error) break; r = await papi("save_rate_card_item", { p_payload:{ deliverable_type:t, amount:v }, p_correlation:"ui-onboard" }); }
        if(r.error){ err("Couldn't save: " + (r.error.message || r.error)); btn.disabled = false; btn.innerHTML = "Find collaborations for me&nbsp; →"; return; }
        onbFinish(true);
      };
    }
  }

  window.bxGuest = { start:startGuest, go, video };
  B2.screens = { onbStep, onbManual, manualProfile, igGate, sidekickScreen, igLoader, igKit, igSent };
})();
