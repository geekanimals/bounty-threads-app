/* Bounty sidekick (Figma v2 — V2-04 · V2-27D · V2-30).
   Six pixel sidekicks — Pip · Mochi · Sprout · Pebble · Rumi · Dot — chosen once, renamed anytime.
   Vibe (Calm · Playful · Focused), language, light / dark, scene (Forest · Parchment), text size, reduce motion,
   tips and "use as my profile picture". Saved on the creator's own login (auth user metadata) + this device.
   Every screen writes "Sprout" / sprout_*.png as the placeholder; this file swaps in the chosen sidekick. */
(function(){
  const A = "/assets/bounty/", R = A + "rd/";
  const KIDS = {
    pip:{ n:"Pip", t:"Dreamer" }, mochi:{ n:"Mochi", t:"Spark" }, sprout:{ n:"Sprout", t:"Grower" },
    pebble:{ n:"Pebble", t:"Calm" }, rumi:{ n:"Rumi", t:"Explorer" }, dot:{ n:"Dot", t:"Helper" }
  };
  Object.keys(KIDS).forEach(k=> KIDS[k].img = R + "kid_" + k + ".png");
  const OLD = { flick:"mochi", nimbus:"pip" };                  // v1 sidekicks → their closest v2 friend
  const DEF = { kid:"pip", name:"", vibe:"playful", lang:"auto", scene:"auto", size:"m", motion:true, avatar:false, tips:"occasional" };
  const mid = () => (window.Auth && Auth.profile && Auth.profile.id) || "anon";
  const key = () => "bx_prefs_" + mid();
  let P = Object.assign({}, DEF);
  const fix = p => { if(OLD[p.kid]) p.kid = OLD[p.kid]; if(!KIDS[p.kid]) p.kid = "pip"; return p; };
  function load(){ try{ const j = JSON.parse(localStorage.getItem(mid() === "anon" ? "bx_prefs_last" : key()) || localStorage.getItem("bx_prefs_last") || "null"); if(j) P = fix(Object.assign({}, DEF, j)); }catch(e){} return P; }
  async function loadRemote(){
    try{ const { data } = await sb.auth.getUser(); const m = data && data.user && data.user.user_metadata && data.user.user_metadata.bx_prefs;
      if(m && typeof m === "object"){ P = fix(Object.assign({}, DEF, m)); try{ localStorage.setItem(key(), JSON.stringify(P)); localStorage.setItem("bx_prefs_last", JSON.stringify(P)); }catch(e){} apply(); } }catch(e){}
  }
  async function save(next){
    P = fix(Object.assign({}, P, next || {}));
    try{ localStorage.setItem(key(), JSON.stringify(P)); localStorage.setItem("bx_prefs_last", JSON.stringify(P)); }catch(e){}
    apply();
    try{ if(window.sb && mid() !== "anon") await sb.auth.updateUser({ data:{ bx_prefs:P } }); }catch(e){}
  }
  const kid = () => KIDS[P.kid] || KIDS.pip;
  const name = () => (P.name || kid().n).replace(/[<>&"]/g, "").slice(0, 20);
  const img = () => kid().img;

  /* ---- apply everywhere ---- */
  function swapImgs(root){
    (root || document).querySelectorAll('img[src*="/assets/bounty/sprout_"],img[src*="/assets/bounty/kid_"],img[data-kid-me]').forEach(i=>{
      if(i.closest(".b2k-pick,[data-kid],#bxKidSheet,.b2k-me") || i.id === "b2kImg") return;   // the picker shows the sidekick being chosen, not the saved one
      if(i.getAttribute("src") !== img()) i.setAttribute("src", img());
    });
  }
  function swapNames(root){
    const nm = name(); if(nm === "Sprout") return;
    const w = document.createTreeWalker(root || document.body, NodeFilter.SHOW_TEXT, { acceptNode: n => /\bSprout\b/.test(n.nodeValue) && !n.parentElement.closest("script,style,textarea,input,[data-kid],.b2k-pick,.bxk-grid") ? 1 : 3 });
    const list = []; while(w.nextNode()) list.push(w.currentNode);
    list.forEach(t=> t.nodeValue = t.nodeValue.replace(/\bSprout\b/g, nm));
    (root || document).querySelectorAll('input[placeholder*="Sprout"],[title*="Sprout"],[aria-label*="Sprout"]').forEach(e=>{
      ["placeholder","title","aria-label"].forEach(a=>{ const v = e.getAttribute(a); if(v && /\bSprout\b/.test(v)) e.setAttribute(a, v.replace(/\bSprout\b/g, nm)); }); });
  }
  function avatar(){
    const me = document.getElementById("me"); if(!me) return;
    const useKid = P.avatar && document.body.classList.contains("bx");
    if(useKid){ me.dataset.bxKid = 1; me.textContent = ""; me.style.backgroundImage = `url("${img()}")`; me.style.backgroundSize = "78%"; me.style.backgroundRepeat = "no-repeat"; me.style.backgroundPosition = "center"; me.style.backgroundColor = "#1d4a34"; }
    else if(me.dataset.bxKid){ delete me.dataset.bxKid; me.style.backgroundImage = ""; me.style.backgroundColor = ""; if(typeof applyIgAvatar === "function") applyIgAvatar(true); if(typeof renderMe === "function") try{ renderMe(); }catch(e){} }
  }
  function apply(){
    const h = document.documentElement;
    h.dataset.bxVibe = P.vibe; h.dataset.bxSize = P.size; h.dataset.bxTips = P.tips || "occasional";
    h.classList.toggle("bx-still", !P.motion || P.vibe === "calm");
    h.style.setProperty("--bx-kid", `url("${img()}")`); h.style.setProperty("--bx-kid-point", `url("${img()}")`); h.style.setProperty("--bx-kid-clip", `url("${img()}")`);
    if(document.body){ document.body.dataset.bxScene = P.scene; if(document.body.classList.contains("bx") && P.scene !== "auto") document.body.dataset.bg = P.scene === "forest" ? "forest" : "parch"; }
    swapImgs(); if(document.body) swapNames(); avatar();
  }
  // keep new screens in line (debounced)
  let q = false;
  new MutationObserver(()=>{ if(q) return; q = true; requestAnimationFrame(()=>{ q = false;
    swapImgs(); if(name() !== "Sprout") swapNames();
    if(P.scene !== "auto" && document.body.classList.contains("bx") && !document.body.classList.contains("bx-pre")){ const want = P.scene === "forest" ? "forest" : "parch"; if(document.body.dataset.bg !== want) document.body.dataset.bg = want; }
    if(P.avatar){ const me = document.getElementById("me"); if(me && (!me.dataset.bxKid || !String(me.style.backgroundImage).includes(img()))) avatar(); }
  }); }).observe(document.documentElement, { childList:true, subtree:true });

  // the sidekick's language: Hindi / Hinglish answers even when the question is typed in English
  const hook = ()=>{ if(window.CampaignHelper && !CampaignHelper.__bx){ const o = CampaignHelper.isHinglish; CampaignHelper.isHinglish = q => (P.lang === "hinglish" || P.lang === "hindi") ? true : P.lang === "english" ? false : o(q); CampaignHelper.__bx = 1; } };
  hook(); setTimeout(hook, 2000);

  /* ---- "Make your sidekick yours." (V2-27D sheet; V2-30 / W10B as a page) ---- */
  const E = s => String(s==null?"":s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const PEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg>';
  const X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';
  function formHtml(st, mode){
    const seg = (k, opts) => `<div class="b2k-seg" data-k="${k}">${opts.map(([v,l])=>`<button type="button" data-v="${v}" class="${st[k]===v?"on":""}">${l}${mode==="sheet"&&st[k]===v?" ✓":""}</button>`).join("")}</div>`;
    const kids = Object.entries(KIDS).map(([k,v])=>`<button type="button" class="b2k-pick${st.kid===k?" on":""}" data-pick="${k}"><img src="${v.img}" alt=""><span>${v.n}</span><i class="b2-chk"></i></button>`).join("");
    return `
      <div class="b2k-me"><img src="${img()}" alt="" class="b2k-big" data-kid-me id="b2kImg">
        <label class="b2k-name"><input id="b2kName" maxlength="20" value="${E(name())}" aria-label="Sidekick name">${PEN}</label></div>
      <div class="b2k-l">✦ Choose a sidekick</div>
      <div class="b2k-kids${mode==="sheet"?" few":""}" id="b2kKids">${kids}</div>
      ${mode==="sheet"?`<button type="button" class="b2k-all" id="b2kAll">See all ›</button>`:""}
      <div class="b2k-l">✦ Your vibe</div>${seg("vibe",[["calm","Calm"],["playful","Playful"],["focused","Focused"]])}
      <div class="b2k-hint" id="b2kHint"></div>
      <div class="b2k-row"><span>Language</span>${seg("lang",[["english","English"],["hindi","Hindi"],["hinglish","Hinglish"],["auto","Match me"]])}</div>
      <div class="b2k-row"><span>Appearance</span>${seg("theme",[["light","Light"],["dark","☾ Dark"]])}</div>
      <div class="b2k-row"><span>Scene</span><div class="b2k-scenes" data-k="scene">
        <button type="button" data-v="forest" class="${st.scene==="forest"?"on":""}"><i class="sc-f"></i>Forest${st.scene==="forest"?" ✓":""}</button>
        <button type="button" data-v="parchment" class="${st.scene==="parchment"?"on":""}"><i class="sc-p"></i>Parchment${st.scene==="parchment"?" ✓":""}</button></div></div>
      <div class="b2k-l">Accessibility</div>
      <div class="b2k-acc"><span>Text size</span>${seg("size",[["s","A−"],["m","A"],["l","A+"]])}
        <label class="b2-tog"><span>Reduce motion</span><input type="checkbox" id="b2kStill"${!st.motion?" checked":""}><i></i></label></div>
      <div class="b2k-row"><span>Tips</span>${seg("tips",[["frequent","Frequent"],["occasional","Occasional"],["asked","When asked"]])}</div>
      <label class="b2-tog wide"><span>Use <b class="b2k-nm">${E(name())}</b> as my profile picture</span><input type="checkbox" id="b2kAvatar"${st.avatar?" checked":""}><i></i></label>`;
  }
  function wireForm(root, st, onPick){
    const hint = ()=>{ const h = root.querySelector("#b2kHint"); if(h) h.textContent = ({ calm:"Calm: no bouncing, gentle screens.", playful:"Playful: animations and tips on.", focused:"Focused: tips hidden, just the work." })[st.vibe] || ""; };
    hint();
    root.querySelectorAll(".b2k-seg,.b2k-scenes").forEach(g=> g.addEventListener("click", e=>{ const b = e.target.closest("button"); if(!b) return;
      g.querySelectorAll("button").forEach(x=>{ x.classList.toggle("on", x===b); x.textContent = x.textContent.replace(/\s✓$/,""); });
      if(root.classList.contains("b2c-sheet") || g.classList.contains("b2k-scenes")) b.textContent = b.textContent + " ✓";
      st[g.dataset.k] = b.dataset.v; if(g.dataset.k === "vibe") hint(); }));
    root.querySelectorAll("[data-pick]").forEach(b=> b.onclick = ()=>{
      root.querySelectorAll("[data-pick]").forEach(x=> x.classList.toggle("on", x===b)); st.kid = b.dataset.pick;
      const im = root.querySelector("#b2kImg"); if(im) im.src = KIDS[st.kid].img;
      root.querySelectorAll(".b2s-head > img").forEach(x=> x.src = KIDS[st.kid].img);
      const nm = root.querySelector("#b2kName"); if(!nm.value.trim() || Object.values(KIDS).some(v=> v.n === nm.value.trim())) nm.value = KIDS[st.kid].n;
      root.querySelectorAll(".b2k-nm").forEach(x=> x.textContent = nm.value.trim() || KIDS[st.kid].n);
      if(onPick) onPick(st.kid);
    });
    const all = root.querySelector("#b2kAll"); if(all) all.onclick = ()=>{ root.querySelector("#b2kKids").classList.remove("few"); all.remove(); };
    const nm = root.querySelector("#b2kName"); if(nm) nm.oninput = ()=> root.querySelectorAll(".b2k-nm").forEach(x=> x.textContent = nm.value.trim() || KIDS[st.kid].n);
  }
  async function commit(root, st){
    const nm = root.querySelector("#b2kName").value.trim();
    const next = { kid:st.kid, name: nm && nm !== KIDS[st.kid].n ? nm : "", vibe:st.vibe, lang:st.lang, scene:st.scene, size:st.size, tips:st.tips,
      motion: !root.querySelector("#b2kStill").checked, avatar: root.querySelector("#b2kAvatar").checked };
    if(typeof applyTheme === "function"){ applyTheme(st.theme); try{ localStorage.setItem("geekos_theme", st.theme); }catch(e){} }
    const swapped = P.kid !== next.kid || name() !== (next.name || KIDS[next.kid].n);
    await save(next);
    if(swapped){ location.reload(); return true; }        // a new sidekick / name: redraw every screen with it
    if(typeof gateToast === "function") gateToast(`✓ Saved — ${name()} is all yours.`);
    try{ if(typeof renderShell === "function" && window.__osBooted) renderShell(); }catch(e){}
    return false;
  }
  const stateNow = () => Object.assign({}, load(), { theme: document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light" });
  function sheet(){
    const st = stateNow();
    let s = document.getElementById("bxKidSheet"); if(s) s.remove();
    s = document.createElement("div"); s.id = "bxKidSheet"; s.className = "b2-dim b2k-wrap";
    s.innerHTML = `<div class="b2-sheet b2c-sheet" role="dialog" aria-label="Make your sidekick yours">
      <div class="b2s-head"><img src="${img()}" alt="" data-kid-me><b>Make your sidekick yours.</b><button type="button" class="b2s-x" aria-label="Close">${X}</button></div>
      <div class="b2s-body b2c-body">${formHtml(st, "sheet")}
        <button type="button" class="b2-btn forest full" id="b2kSave">Save my vibe</button></div></div>`;
    document.body.appendChild(s);
    const root = s.querySelector(".b2c-sheet");
    wireForm(root, st);
    const close = ()=> s.remove();
    s.querySelector(".b2s-x").onclick = close; s.onclick = e=>{ if(e.target === s) close(); };
    document.getElementById("b2kSave").onclick = async ()=>{ const r = await commit(root, st); if(!r) close(); };
  }
  // V2-30 / W10B: the same controls as a full page (opened from Settings · Profile · avatar menu)
  function page(c, back){
    const st = stateNow();
    c.innerHTML = `<div class="b2-page b2k-page">
      <button type="button" class="b2-back" data-k="back">← ${E(back && back.label || "Settings")}</button>
      <div class="b2-eyebrow">Your companion</div><h1 class="b2-h1">Make your sidekick yours</h1>
      <p class="b2-sub">Change anytime — your real profile never changes.</p>
      <div class="b2-card b2c-body">${formHtml(st, "page")}</div>
      <button type="button" class="b2-btn forest full" id="b2kSave">Save my sidekick</button>
      <div class="b2-tip"><img src="${img()}" alt="" data-kid-me><p><b>${E(name())}:</b> <i>Rename me if you like — I'll answer to anything!</i></p></div></div>`;
    const root = c.querySelector(".b2k-page");
    wireForm(root, st);
    c.querySelector('[data-k="back"]').onclick = ()=>{ if(back && back.go) back.go(); };
    document.getElementById("b2kSave").onclick = ()=> commit(root, st);
  }

  window.bxKid = { load, save, apply, sheet, page, img, name, kid:()=>P.kid, kids:KIDS, prefs:()=>P, loadRemote };
  load(); apply();
  // signed-in: pull the saved choice from the creator's login once the app knows who they are
  let pulled = false;
  const tryPull = ()=>{ if(pulled || !(window.Auth && Auth.profile && Auth.profile.id && window.sb)) return; pulled = true; load(); apply(); loadRemote(); };
  setInterval(tryPull, 1500);
})();
