/* Bounty sidekick — "Make your sidekick yours" (ChatGPT thread / Figma Sprout settings).
   Choose a sidekick (Sprout · Flick · Nimbus · Dot), name it, vibe (Calm · Playful · Focused),
   Sprout's language, light / dark, scene (Auto · Forest · Parchment), text size, reduce motion,
   and "use as my profile picture". Saved on the creator's own login (auth user metadata) + this device. */
(function(){
  const A = "/assets/bounty/";
  const KIDS = { sprout:{ n:"Sprout", img:A+"sprout_wave.png" }, flick:{ n:"Flick", img:A+"kid_flick.png" }, nimbus:{ n:"Nimbus", img:A+"kid_nimbus.png" }, dot:{ n:"Dot", img:A+"kid_dot.png" } };
  const DEF = { kid:"sprout", name:"", vibe:"playful", lang:"auto", scene:"auto", size:"m", motion:true, avatar:false };
  const mid = () => (window.Auth && Auth.profile && Auth.profile.id) || "anon";
  const key = () => "bx_prefs_" + mid();
  let P = Object.assign({}, DEF);
  function load(){ try{ const j = JSON.parse(localStorage.getItem(key()) || "null"); if(j) P = Object.assign({}, DEF, j); }catch(e){} return P; }
  async function loadRemote(){
    try{ const { data } = await sb.auth.getUser(); const m = data && data.user && data.user.user_metadata && data.user.user_metadata.bx_prefs;
      if(m && typeof m === "object"){ P = Object.assign({}, DEF, m); try{ localStorage.setItem(key(), JSON.stringify(P)); }catch(e){} apply(); } }catch(e){}
  }
  async function save(next){
    P = Object.assign({}, P, next || {});
    try{ localStorage.setItem(key(), JSON.stringify(P)); }catch(e){}
    apply();
    try{ await sb.auth.updateUser({ data:{ bx_prefs:P } }); }catch(e){}
  }
  const kid = () => KIDS[P.kid] || KIDS.sprout;
  const name = () => (P.name || kid().n).replace(/[<>&"]/g, "").slice(0, 20);
  const img = pose => P.kid === "sprout" ? A + "sprout_" + (pose || "wave") + ".png" : kid().img;

  /* ---- apply everywhere ---- */
  function swapImgs(root){
    if(P.kid === "sprout") return;
    (root || document).querySelectorAll('img[src*="/assets/bounty/sprout_"]').forEach(i=>{ if(!i.dataset.bxKid){ i.dataset.bxKid = 1; i.src = kid().img; } });
  }
  function swapNames(root){
    const nm = name(); if(nm === "Sprout") return;
    const w = document.createTreeWalker(root || document.body, NodeFilter.SHOW_TEXT, { acceptNode: n => /\bSprout\b/.test(n.nodeValue) && !n.parentElement.closest("script,style,textarea,input,.bx-kid-sheet,.bxk-grid") ? 1 : 3 });
    const list = []; while(w.nextNode()) list.push(w.currentNode);
    list.forEach(t=> t.nodeValue = t.nodeValue.replace(/\bSprout\b/g, nm));
    (root || document).querySelectorAll('input[placeholder*="Sprout"],[title*="Sprout"],[aria-label*="Sprout"]').forEach(e=>{
      ["placeholder","title","aria-label"].forEach(a=>{ const v = e.getAttribute(a); if(v && /\bSprout\b/.test(v)) e.setAttribute(a, v.replace(/\bSprout\b/g, nm)); }); });
  }
  function avatar(){
    const me = document.getElementById("me"); if(!me) return;
    const useKid = P.avatar && document.body.classList.contains("bx");
    if(useKid){ me.dataset.bxKid = 1; me.textContent = ""; me.style.backgroundImage = `url("${kid().img}")`; me.style.backgroundSize = "contain"; me.style.backgroundRepeat = "no-repeat"; me.style.backgroundPosition = "center"; me.style.backgroundColor = "#103B2A"; }
    else if(me.dataset.bxKid){ delete me.dataset.bxKid; me.style.backgroundImage = ""; me.style.backgroundColor = ""; if(typeof applyIgAvatar === "function") applyIgAvatar(true); if(typeof renderMe === "function") try{ renderMe(); }catch(e){} }
  }
  function apply(){
    const h = document.documentElement;
    h.dataset.bxVibe = P.vibe; h.dataset.bxSize = P.size; h.classList.toggle("bx-still", !P.motion || P.vibe === "calm");
    h.style.setProperty("--bx-kid", `url("${img("wave")}")`); h.style.setProperty("--bx-kid-point", `url("${img("point")}")`); h.style.setProperty("--bx-kid-clip", `url("${img("clipboard")}")`);
    if(document.body){ document.body.dataset.bxScene = P.scene; if(document.body.classList.contains("bx") && P.scene !== "auto") document.body.dataset.bg = P.scene === "forest" ? "forest" : "parch"; }
    swapImgs(); if(document.body) swapNames(); avatar();
  }
  // keep new screens in line (debounced)
  let q = false;
  new MutationObserver(muts=>{ if(q) return; q = true; requestAnimationFrame(()=>{ q = false;
    if(P.kid !== "sprout") swapImgs(); if(name() !== "Sprout") swapNames();
    if(P.scene !== "auto" && document.body.classList.contains("bx")){ const want = P.scene === "forest" ? "forest" : "parch"; if(document.body.dataset.bg !== want) document.body.dataset.bg = want; }
    if(P.avatar){ const me = document.getElementById("me"); if(me && !me.dataset.bxKid) avatar(); }
    const mc = document.getElementById("meCard"), out = document.getElementById("meOut");
    if(mc && out && !mc.querySelector(".bx-me-set") && document.body.classList.contains("bx")){
      out.insertAdjacentHTML("beforebegin", `<button type="button" class="bx-me-set"><img src="${kid().img}" alt=""><span><b>Settings & sidekick</b><i>Name, look, scene, text size</i></span></button>`);
      mc.querySelector(".bx-me-set").onclick = ()=>{ const x = document.getElementById("meX"); if(x) x.click(); sheet(); };
    } }); })
    .observe(document.documentElement, { childList:true, subtree:true, attributes:true, attributeFilter:["data-bg"] });

  // Sprout's language: Hindi / Hinglish answers even when the question is typed in English
  const hook = ()=>{ if(window.CampaignHelper && !CampaignHelper.__bx){ const o = CampaignHelper.isHinglish; CampaignHelper.isHinglish = q => (P.lang === "hinglish" || P.lang === "hindi") ? true : P.lang === "english" ? false : o(q); CampaignHelper.__bx = 1; } };
  hook(); setTimeout(hook, 2000);

  /* ---- "Make your sidekick yours." sheet ---- */
  function sheet(){
    load();
    const E = s => String(s==null?"":s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
    let s = document.getElementById("bxKidSheet"); if(s) s.remove();
    s = document.createElement("div"); s.id = "bxKidSheet"; s.className = "bx-kid-wrap";
    const theme = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    const seg = (k, opts, cur) => `<div class="bxk-seg" data-k="${k}">${opts.map(([v,l])=>`<button type="button" data-v="${v}" class="${cur===v?"on":""}">${l}</button>`).join("")}</div>`;
    s.innerHTML = `<div class="bx-kid-sheet" role="dialog" aria-label="Make your sidekick yours">
      <div class="bxks-head"><img src="${kid().img}" alt="" id="bxksImg"><b>Make your sidekick yours.</b><button type="button" class="bxks-x" aria-label="Close">✕</button></div>
      <div class="bxks-body">
        <label class="bxks-name">Name<input id="bxksName" maxlength="20" value="${E(name())}"></label>
        <div class="bxks-l">Choose a sidekick</div>
        <div class="bxks-kids">${Object.entries(KIDS).map(([k,v])=>`<button type="button" data-kid="${k}" class="${P.kid===k?"on":""}"><img src="${v.img}" alt=""><span>${v.n}</span></button>`).join("")}</div>
        <label class="bxks-tog"><input type="checkbox" id="bxksAvatar"${P.avatar?" checked":""}><span>Use as my profile picture</span></label>
        <div class="bxks-l">Your vibe</div>${seg("vibe",[["calm","Calm"],["playful","Playful"],["focused","Focused"]],P.vibe)}
        <div class="bxks-hint" id="bxksVibeHint"></div>
        <div class="bxks-l">${E(name())}'s language</div>${seg("lang",[["auto","Match me"],["english","English"],["hinglish","Hinglish"],["hindi","Hindi"]],P.lang)}
        <div class="bxks-l">Appearance</div>${seg("theme",[["light","Light"],["dark","Dark"]],theme)}
        <div class="bxks-l">Scene</div>${seg("scene",[["auto","Auto"],["forest","Forest"],["parchment","Parchment"]],P.scene)}
        <div class="bxks-l">Accessibility</div>
        <div class="bxks-row"><span>Text size</span>${seg("size",[["s","A−"],["m","A"],["l","A+"]],P.size)}</div>
        <label class="bxks-tog"><input type="checkbox" id="bxksStill"${!P.motion?" checked":""}><span>Reduce motion</span></label>
      </div>
      <div class="bxks-foot"><button type="button" class="btn gold" id="bxksSave">Save my vibe</button></div></div>`;
    document.body.appendChild(s);
    s.querySelectorAll("img").forEach(i=> i.dataset.bxKid = 1);
    const st = Object.assign({}, P, { theme });
    const hint = ()=>{ document.getElementById("bxksVibeHint").textContent = ({ calm:"Calm: no bouncing, gentle screens.", playful:"Playful: animations and tips on.", focused:"Focused: tips hidden, just the work." })[st.vibe]; };
    hint();
    s.querySelectorAll(".bxk-seg").forEach(g=> g.addEventListener("click", e=>{ const b = e.target.closest("button"); if(!b) return; g.querySelectorAll("button").forEach(x=> x.classList.toggle("on", x===b)); st[g.dataset.k] = b.dataset.v; if(g.dataset.k==="vibe") hint(); }));
    s.querySelectorAll("[data-kid]").forEach(b=> b.onclick = ()=>{ s.querySelectorAll("[data-kid]").forEach(x=> x.classList.toggle("on", x===b)); st.kid = b.dataset.kid; document.getElementById("bxksImg").src = KIDS[st.kid].img;
      const nm = document.getElementById("bxksName"); if(!nm.value.trim() || Object.values(KIDS).some(v=> v.n === nm.value.trim())) nm.value = KIDS[st.kid].n; });
    const close = ()=> s.remove();
    s.querySelector(".bxks-x").onclick = close; s.onclick = e=>{ if(e.target === s) close(); };
    document.getElementById("bxksSave").onclick = async ()=>{
      const nm = document.getElementById("bxksName").value.trim();
      const next = { kid:st.kid, name: nm && nm !== KIDS[st.kid].n ? nm : "", vibe:st.vibe, lang:st.lang, scene:st.scene, size:st.size,
        motion: !document.getElementById("bxksStill").checked, avatar: document.getElementById("bxksAvatar").checked };
      if(typeof applyTheme === "function"){ applyTheme(st.theme); try{ localStorage.setItem("geekos_theme", st.theme); }catch(e){} }
      const nameChanged = name() !== (next.name || KIDS[next.kid].n);
      await save(next); close();
      if(typeof gateToast === "function") gateToast(`✓ Saved — ${name()} is all yours.`);
      try{ if(typeof renderShell === "function" && window.__osBooted) renderShell(); }catch(e){}
    };
  }

  window.bxKid = { load, save, apply, sheet, img, name, kids:KIDS, prefs:()=>P, loadRemote };
  load(); apply();
  // signed-in: pull the saved choice from the creator's login once the app knows who they are
  let pulled = false;
  const tryPull = ()=>{ if(pulled || !(window.Auth && Auth.profile && Auth.profile.id && window.sb)) return; pulled = true; load(); apply(); loadRemote(); };
  setInterval(tryPull, 1500);
})();
