/* Creator Intelligence — DARK, flag-gated serving + explainable matching UI (Phase 1D).
 * Renders ONLY when api.creator_profile_api_enabled() is true (same flag; the api schema is
 * unexposed in production, so this stays hidden and the legacy app is unchanged). Everything shown
 * comes from the secure api-schema RPCs — never intel/private tables. Hard rules enforced here:
 *   • NO opaque universal score. No "Top/Best/Winner Creator". Matching shows a Match Explanation
 *     (✓ strong signals, − missing signals), and is always brief-specific.
 *   • Missing data is a status ("Insufficient data") with a reason — NEVER 0 and never blank fabrication.
 *   • Never renders PII, private contact, unauthorised rates, or raw comments/messages.
 * Every section shows Source · Updated · Confidence, and each metric can be traced to its evidence. */
(function () {
  "use strict";
  var enabled = false;
  window.__ciIntelEnabled = false;

  function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function api(fn, args){ return window.sb.schema("api").rpc(fn, args || {}); }
  function fmtDT(d){ if(!d) return "—"; try{ return new Date(d).toLocaleString("en-IN",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}); }catch(e){ return String(d); } }
  function num(v){ return (v==null) ? "—" : v; }

  // status → label + css class. Missing is ALWAYS an explicit status, never 0.
  var STATUS = {
    available:["Available","ok"], insufficient_data:["Insufficient data","na"],
    unavailable:["Unavailable","na"], stale:["Stale","warn"],
    permission_disabled:["Sharing off","warn"], missing_permission:["Permission needed","warn"], failed:["Unavailable","na"]
  };
  function pill(status){ var s = STATUS[status] || [status||"Unknown","na"]; return '<span class="ci-pill ci-'+s[1]+'">'+esc(s[0])+'</span>'; }
  function confBand(c){ if(c && c.confidence_band) return c.confidence_band; if(c && c.status==="available" && c.value!=null){ var v=Number(c.value); return v>=0.66?"High":v>=0.33?"Medium":"Low"; } return "—"; }
  function metaLine(source, updated, confidence){
    return '<div class="ci-meta"><span>Source: <b>'+esc(source||"—")+'</b></span>'
      + '<span>Updated: <b>'+esc(updated||"—")+'</b></span>'
      + '<span>Confidence: <b>'+esc(confidence||"—")+'</b></span></div>';
  }

  /* ---------- flag boot (mirrors profile.js) ---------- */
  var _bootP = null;
  function boot(){ if(!_bootP) _bootP = bootOnce(); return _bootP; }
  async function bootOnce(){
    try{
      if(!window.sb || !window.sb.schema){ enabled=false; }
      else { var r = await api("creator_profile_api_enabled"); enabled = !!(r && !r.error && r.data === true); }
    }catch(e){ enabled=false; }
    window.__ciIntelEnabled = enabled;
    if(enabled && window.__osBooted && typeof renderNav === "function") renderNav();
  }

  /* =====================================================================
   * CREATOR — "My Intelligence Profile"
   * ===================================================================== */
  window.renderIntelligence = function(){
    if(!enabled) return '<div class="card"><h3>My Intelligence</h3><div class="muted">This feature isn\'t enabled for your account yet.</div></div>';
    return '<div id="ciSelf" class="ci">'
      + '<div class="card ci-intro"><h3>My Intelligence Profile</h3>'
      + '<div class="muted">A transparent, evidence-backed view of what brands can learn about you. Every measure shows its status, source and freshness. Nothing here is an opaque “score”, and unknowns are shown as “Insufficient data” — never as zero.</div></div>'
      + '<div id="ciSelfBody"><div class="card"><div class="muted">Loading your intelligence…</div></div></div>'
      + '<div id="ciSelfErr" class="ci-err" style="display:none"></div></div>';
  };

  async function loadSelf(){
    var root = document.getElementById("ciSelf"); if(!root) return;
    try{
      var rr = await Promise.all([ api("get_my_creator_intelligence"), api("get_my_commercial_readiness") ]);
      if(rr[0].error) throw rr[0].error;
      renderSelf(rr[0].data || {}, (rr[1]&&!rr[1].error?rr[1].data:null));
    }catch(e){
      var err = document.getElementById("ciSelfErr");
      if(err){ err.style.display="block"; err.textContent = "Couldn't load your intelligence. "+(e.message||e); }
    }
  }
  // creator-facing view of the same decision fields brands will see (category/formats/brand history/barter/rate)
  function selfCommercialSection(cm){
    if(!cm) return '';
    function r(title, html, note){ return '<div class="ci-cardrow"><div class="ci-mh"><b>'+esc(title)+'</b></div><div>'+html+'</div>'+(note?'<div class="ci-hint">'+esc(note)+'</div>':'')+'</div>'; }
    return '<div class="card ci-measure"><div class="ci-mh"><h4>Category, brand history, barter &amp; rates</h4></div>'
      + '<div class="ci-exp">What a brand can see about your commercial fit. Rates and brand history appear to brands only when you switch them on in your profile visibility.</div>'
      + r("Category signals", fCategory(cm))
      + r("Content formats", fFormats(cm))
      + r("Brand history", fBrandHist(cm), "Shown to brands only if you enable 'brand experience' visibility.")
      + r("Barter readiness", fBarter(cm))
      + r("Rate indication", fRate(cm), "Shown to brands only if your rate card is not private.")
      + '</div>';
  }
  function creatorFeedbackForm(){
    return '<div class="card ci-feedback" id="ciCreatorFb"><h4>Pilot feedback</h4>'
      + '<div class="ci-note">Two minutes helps shape the product. Stored separately for the pilot review.</div>'
      + '<label class="ci-f"><span>Was your profile easy to complete?</span><select id="cfbEasy"><option value="">—</option><option>Yes</option><option>Somewhat</option><option>No</option></select></label>'
      + '<label class="ci-f"><span>What data here is incorrect?</span><textarea id="cfbWrong" rows="2"></textarea></label>'
      + '<label class="ci-f"><span>What data would increase your trust?</span><textarea id="cfbTrust" rows="2"></textarea></label>'
      + '<button class="btn sm" id="cfbSend">Submit feedback</button><span id="cfbMsg" class="ci-hint"></span></div>';
  }
  function wireCreatorFeedback(){
    var b=document.getElementById("cfbSend"); if(!b) return;
    b.onclick=function(){ submitFeedback('creator', { profile_easy: valOf("cfbEasy"), incorrect: valOf("cfbWrong"), trust: valOf("cfbTrust") }, "cfbMsg"); };
  }

  function measureCard(title, status, explanation, meta, extra){
    return '<div class="card ci-measure"><div class="ci-mh"><h4>'+esc(title)+'</h4>'+pill(status)+'</div>'
      + (explanation?'<div class="ci-exp">'+esc(explanation)+'</div>':'')
      + (extra||'')
      + meta + '</div>';
  }

  function renderSelf(d, cm){
    var gen = fmtDT(d.generated_at);
    if(d.status === "insufficient_data" && !d.performance){
      document.getElementById("ciSelfBody").innerHTML =
        '<div class="card ci-measure"><div class="ci-mh"><h4>Intelligence not computed yet</h4>'+pill("insufficient_data")+'</div>'
        + '<div class="ci-exp">We haven\'t computed your intelligence yet. Connect your account and keep your profile updated — measures appear as evidence accumulates. Nothing is estimated as zero in the meantime.</div></div>'
        + selfCommercialSection(cm) + creatorFeedbackForm();
      wireCreatorFeedback();
      return;
    }
    var perf = d.performance||{}, aud = d.audience||{}, rel = d.reliability||{}, bs = d.brand_safety||{}, fr = d.fraud_probability||{}, conf = d.confidence||{}, cov = d.coverage||{};
    var body = "";

    // Performance (self sees per-metric detail, each traceable to evidence)
    var metrics = perf.metrics || [];
    var mrows = metrics.length ? '<div class="ci-metrics">'+metrics.map(function(m){
        return '<div class="ci-metric"><div class="ci-metric-h"><b>'+esc(prettyFeature(m.feature))+'</b> '
          + (m.format?'<span class="ci-tag">'+esc(m.format)+'</span>':'') + (m.window?'<span class="ci-tag">'+esc(m.window)+'</span>':'')
          + pill(m.status)+'</div>'
          + '<div class="ci-metric-v">'+(m.status==="available"?(esc(num(m.value))+(m.unit?' '+esc(m.unit):'')):'<span class="muted">Insufficient data</span>')+'</div>'
          + (m.explanation?'<div class="ci-hint">'+esc(m.explanation)+'</div>':'')
          + '<div class="ci-evrow"><span class="muted ci-ev-badge">'+esc(m.evidence_type||"")+'</span>'
          + (m.feature_value_id?'<button class="btn sm ghost" data-ev="'+esc(m.feature_value_id)+'">View evidence</button>':'')+'</div>'
          + '<div class="ci-ev" data-evfor="'+esc(m.feature_value_id||"")+'" style="display:none"></div></div>';
      }).join("")+'</div>' : '<div class="muted">No per-format performance yet — shown as Insufficient data, never zero.</div>';
    body += measureCard("Performance", perf.status||"insufficient_data",
      "How your published content performs, by format and window ("+esc(perf.window||"recent")+"). This is not a single grade.",
      metaLine("Feature store (observed/derived)", gen, "Band: "+confBand({confidence_band:perf.confidence_band})),
      '<div class="ci-sub">Reels analysed: <b>'+esc(num(perf.reels_analysed))+'</b></div>'+mrows);

    // Audience (marginal geography only; never a joint intersection; no PII)
    var geo = "";
    function distList(obj){ if(!obj) return '<span class="muted">Insufficient data</span>'; var ks=Object.keys(obj); if(!ks.length) return '<span class="muted">Insufficient data</span>';
      return ks.map(function(k){ return '<span class="ci-chip">'+esc(k)+': <b>'+esc(obj[k])+'</b></span>'; }).join(""); }
    geo += '<div class="ci-sub">Top countries</div><div class="ci-chips">'+distList(aud.country)+'</div>';
    geo += '<div class="ci-sub">Top cities</div><div class="ci-chips">'+distList(aud.city)+'</div>';
    body += measureCard("Audience geography", aud.country?"available":"insufficient_data",
      "Where your followers are, shown as separate country and city distributions (marginal only — never combined into a false “X in city Y” intersection).",
      metaLine("Audience observations", gen, aud.freshness||"—"), geo);

    // Reliability
    body += measureCard("Reliability", rel.status||"insufficient_data",
      rel.explanation || "Delivery track record from verified campaigns.",
      metaLine("Campaign evidence", gen, "—"),
      rel.status!=="available" ? '<div class="ci-hint">Reason: '+esc(rel.reason||"not enough verified history")+'</div>' : '');

    // Brand safety
    body += measureCard("Brand safety", bs.status||"insufficient_data",
      "Reviewed brand-safety signals. Absent review is shown as Insufficient data, not a pass/fail.",
      metaLine("Reviewed evidence", gen, "—"),
      bs.status!=="available" ? '<div class="ci-hint">Reason: '+esc(bs.reason||"no reviewed evidence")+'</div>' : '');

    // Fraud probability — ALWAYS an estimate; missing is Insufficient data, never 0%.
    body += measureCard("Fraud probability", fr.status||"insufficient_data",
      fr.explanation || "Likelihood of inauthentic activity. This is always an estimate and is shown as Insufficient data when signals are too sparse — never 0%.",
      metaLine("Model estimate", gen, "Estimate"),
      '<div class="ci-hint">'+(fr.status==="available"?'Estimated — always treat as directional.':'No fabricated value. Shown as Insufficient data.')+'</div>');

    // Confidence + Coverage (these move with data sharing; they never lower Performance or raise Fraud)
    body += '<div class="ci-two">'
      + measureCard("Intelligence confidence", conf.status||"insufficient_data",
          "How much to trust the picture above, given the evidence available.",
          metaLine("Derived", gen, conf.value!=null?String(conf.value):"—"), "")
      + measureCard("Verified data coverage", cov.status||"insufficient_data",
          "Share of expected inputs actually observed. Turning data sharing off lowers only this — it never lowers Performance, raises Fraud, or labels you unreliable.",
          metaLine("Derived", gen, cov.value!=null?(cov.value+"%"):"—"), "")
      + '</div>';

    body += selfCommercialSection(cm) + creatorFeedbackForm();
    document.getElementById("ciSelfBody").innerHTML = body;
    wireEvidence(document.getElementById("ciSelfBody"));
    wireCreatorFeedback();
  }

  function prettyFeature(k){ if(!k) return ""; return String(k).replace(/^content\./,"").replace(/^audience\./,"").replace(/^account\./,"").replace(/_/g," ").replace(/\b\w/g,function(c){return c.toUpperCase();}); }

  /* ---------- evidence drill-down (shared by self + brand card) ---------- */
  function wireEvidence(scope){
    (scope||document).querySelectorAll("[data-ev]").forEach(function(b){
      b.onclick = async function(){
        var id = b.getAttribute("data-ev");
        var box = (scope||document).querySelector('[data-evfor="'+id+'"]');
        if(!box) return;
        if(box.style.display==="block"){ box.style.display="none"; return; }
        box.style.display="block"; box.innerHTML='<span class="muted">Loading evidence…</span>';
        try{
          var r = await api("get_feature_evidence", { p_feature_value_id: id });
          if(r.error) throw r.error;
          var e = r.data||{};
          var src = (e.source||[]);
          box.innerHTML = '<div class="ci-evbox">'
            + '<div><b>Feature:</b> '+esc(e.feature||"—")+' <span class="ci-tag">'+esc(e.evidence_type||"")+'</span></div>'
            + '<div><b>Value:</b> '+(e.status==="available"?esc(num(e.value))+(e.unit?' '+esc(e.unit):''):'<span class="muted">Insufficient data</span>')+'</div>'
            + '<div><b>Sources:</b> '+(src.length?src.map(esc).join(", "):'<span class="muted">—</span>')+'</div>'
            + '<div><b>Calculation:</b> '+esc(e.calculation||"—")+'</div>'
            + '<div><b>Sample size:</b> '+esc(num(e.sample_size))+' · <b>Window:</b> '+esc(e.window||"—")+'</div>'
            + '<div><b>Calculated:</b> '+esc(fmtDT(e.calculated_at))+' · <b>Model:</b> '+esc(e.model_version||"—")+'</div>'
            + '</div>';
        }catch(err){ box.innerHTML='<span class="ci-err-inline">Couldn\'t load evidence: '+esc(err.message||err)+'</span>'; }
      };
    });
  }

  /* =====================================================================
   * BRAND / AGENCY — Creator Intelligence Card + Explainable Matching
   * ===================================================================== */
  window.renderBrandIntel = function(){
    if(!enabled) return '<div class="card"><h3>Creator Intelligence</h3><div class="muted">This feature isn\'t enabled for your account yet.</div></div>';
    return '<div id="ciBrand" class="ci">'
      + '<div class="card ci-intro"><h3>🎯 Match creators to a brief</h3>'
      + '<div class="muted">Fill the brief — every creator you work with is checked against it and each match is explained by the signals it did and didn\'t meet. No global ranking, no opaque score. Every creator in Creator search also has a 🧠 Intelligence card under <b>👤 Details</b>.</div></div>'
      + matchForm()
      + '<div id="ciMatchOut"></div>'
      + '<div id="ciCompareOut"></div>'
      + '<div id="ciCardOut"></div>'
      + '<div id="ciBrandErr" class="ci-err" style="display:none"></div></div>';
  };

  function matchForm(){
    return '<div class="card ci-brief"><div class="ci-mh"><h4>Campaign brief</h4><button class="btn sm ghost" id="ciPrefill">Prefill example</button></div>'
      + '<div class="ci-grid">'
      + '<label class="ci-f"><span>Campaign name</span><input id="ciReqName" placeholder="e.g. Snuggles launch"></label>'
      + '<label class="ci-f"><span>Categories / need (comma separated)</span><input id="ciReqCat" placeholder="e.g. pets, lifestyle"></label>'
      + '<label class="ci-f"><span>Locations (comma separated)</span><input id="ciReqLoc" placeholder="e.g. Bangalore, IN"></label>'
      + '<label class="ci-f"><span>Content formats (comma separated)</span><input id="ciReqFmt" placeholder="e.g. reels"></label>'
      + '<label class="ci-f"><span>Budget (₹)</span><input id="ciReqBudget" type="number" placeholder="e.g. 1500000"></label>'
      + '<label class="ci-f"><span>Compensation preference</span><select id="ciReqComp"><option value="">Any</option><option value="barter">Barter</option><option value="paid">Paid</option><option value="hybrid">Barter + paid hybrid</option></select></label>'
      + '<label class="ci-f"><span>Platform</span><select id="ciReqPlat"><option value="instagram">Instagram</option></select></label>'
      + '</div>'
      + '<button class="btn" id="ciMatchBtn">Find matches for this brief</button>'
      + '<div class="ci-note">Matching runs only over creators your organisation manages, for this brief. It ranks nothing globally and invents no facts.</div></div>';
  }
  function prefillSnuggles(){
    var set=function(id,v){ var e=document.getElementById(id); if(e) e.value=v; };
    set("ciReqName","Snuggles launch"); set("ciReqCat","pets"); set("ciReqLoc","Bangalore");
    set("ciReqFmt","reels"); set("ciReqBudget","1500000");
    var c=document.getElementById("ciReqComp"); if(c) c.value="hybrid";
  }

  async function loadBrand(){
    var root = document.getElementById("ciBrand"); if(!root) return;
    var mb = document.getElementById("ciMatchBtn"); if(mb) mb.onclick = runMatch;
    var pf = document.getElementById("ciPrefill"); if(pf) pf.onclick = prefillSnuggles;
    var lb = document.getElementById("ciLookupBtn"); if(lb) lb.onclick = function(){ var id=(document.getElementById("ciLookupId").value||"").trim(); if(id) openCard(id); };
  }

  function csv(id){ var v=(document.getElementById(id).value||"").trim(); return v?v.split(",").map(function(s){return s.trim();}).filter(Boolean):[]; }
  function valOf(id){ var e=document.getElementById(id); return e?(e.value||"").trim():""; }

  var _lastReq = null;
  async function runMatch(){
    var out = document.getElementById("ciMatchOut");
    var req = { campaign: valOf("ciReqName"), category: csv("ciReqCat"), location: csv("ciReqLoc"),
                content_formats: csv("ciReqFmt"), platform: document.getElementById("ciReqPlat").value,
                budget: valOf("ciReqBudget")? Number(valOf("ciReqBudget")):null, compensation: valOf("ciReqComp")||null };
    _lastReq = req;
    out.innerHTML = '<div class="card"><div class="muted">Matching against your managed creators…</div></div>';
    document.getElementById("ciCompareOut").innerHTML="";
    try{
      var r = await api("match_creators", { p_requirements: req });
      if(r.error) throw r.error;
      renderMatches(r.data||{});
    }catch(e){ out.innerHTML = '<div class="card ci-err-inline">Couldn\'t run matching: '+esc(e.message||e)+'</div>'; }
  }

  var STRENGTH = { strong:["Strong","ok"], moderate:["Moderate","warn"], weak:["Weak","na"] };
  var MSTATUS  = { match:["Match","ok"], partial:["Partial match","warn"], no_match:["Not a fit for this brief","na"], insufficient_data:["Insufficient data","na"] };
  function tagOf(map,k){ var s=map[k]||[k||"—","na"]; return '<span class="ci-pill ci-'+s[1]+'">'+esc(s[0])+'</span>'; }
  // commercial/decision-field status → label (Observed/Derived/Not shared/Insufficient data)
  var CSTAT = { observed:["Observed","ok"], derived:["Derived","ok"], not_shared:["Not shared","na"], insufficient_data:["Insufficient data","na"], unavailable:["Unavailable","na"] };
  function cpill(s){ var x=CSTAT[s]||[s||"—","na"]; return '<span class="ci-pill ci-'+x[1]+'">'+esc(x[0])+'</span>'; }
  function briefNeed(){ return ((_lastReq&&_lastReq.category)||[]).map(function(n){return String(n).toLowerCase();}); }
  // decision-field renderers shared by the card and the comparison (respect the served status; never invent)
  function fCategory(cm){ var cs=(cm||{}).category_signals||{}; if(cs.status!=='observed') return cpill(cs.status||'insufficient_data');
    var cats=cs.categories||[], need=briefNeed(); var fit=cats.some(function(x){return need.indexOf(String(x).toLowerCase())>=0;});
    return esc(cats.join(", "))+(need.length?(' '+(fit?'<span class="ci-pill ci-ok">fits brief</span>':'<span class="ci-pill ci-na">no overlap</span>')):''); }
  function fFormats(cm){ var f=(cm||{}).content_formats||{}; return f.status==='observed'? esc((f.formats||[]).join(", ")) : cpill(f.status); }
  function fBrandHist(cm){ var b=(cm||{}).brand_history||{}; return b.status==='observed'? (esc(b.confirmed_count)+' confirmed') : cpill(b.status); }
  function fBarter(cm){ var b=(cm||{}).barter_readiness||{}; return b.status==='observed'? ((b.accepts_barter?'Yes':'No')+(b.preference?(' · '+esc(b.preference)):'')+(b.min_product_value!=null?(' · min ₹'+esc(b.min_product_value)):'')) : cpill(b.status); }
  function fRate(cm){ var r=(cm||{}).rate_indication||{}; return r.status==='derived'? ('₹'+esc(r.indicative_min)+'–₹'+esc(r.indicative_max)+(r.negotiable?' <span class="muted">(negotiable)</span>':'')) : cpill(r.status); }

  // shortlist state: id -> the match result row (kept so the comparison shows the brief's reasons alongside evidence)
  var _shortlist = {};
  function shortlistCount(){ return Object.keys(_shortlist).length; }

  function renderMatches(d){
    var out = document.getElementById("ciMatchOut");
    _shortlist = {};                        // a new brief resets the shortlist
    var results = d.results||[];
    if(!results.length){ out.innerHTML='<div class="card"><div class="muted">No creators in your managed set match this brief. (This is scoped to your organisation — there is no global creator pool here.)</div></div>'; document.getElementById("ciCompareOut").innerHTML=""; return; }
    var head = '<div class="card ci-intro"><div class="ci-mh"><h4>Match explanation — for this brief only</h4>'
      + '<button class="btn sm" id="ciCompareBtn" disabled>Compare shortlist (0)</button></div>'
      + '<div class="muted">'+esc(results.length)+' creator(s) evaluated · '+fmtDT(d.generated_at)+'. Each is explained by the signals it met (✓) and didn\'t (−). Tick creators to shortlist, then compare them side by side. No creator is called “best” or given a score.</div></div>';
    var cards = results.map(function(e){
      var matched = (e.matched_signals||[]), missing = (e.missing_signals||[]);
      return '<div class="card ci-match">'
        + '<div class="ci-mh"><label class="ci-pick"><input type="checkbox" data-pick="'+esc(e.creator_identity_id)+'"> Shortlist</label>'
        + '<h4 data-ciname="'+esc(e.creator_identity_id)+'">Creator <span class="ci-id">'+esc(shortId(e.creator_identity_id))+'</span></h4>'
        + tagOf(MSTATUS, e.match_status)+(e.match_strength?tagOf(STRENGTH, e.match_strength):'')+'</div>'
        + '<div class="ci-signals">'
        +   '<div class="ci-sig ok"><div class="ci-sig-h">✓ Strong signals</div>'+(matched.length?('<ul>'+matched.map(function(s){return '<li>'+esc(s)+'</li>';}).join("")+'</ul>'):'<div class="muted">None evidenced for this brief</div>')+'</div>'
        +   '<div class="ci-sig na"><div class="ci-sig-h">− Missing / unknown</div>'+(missing.length?('<ul>'+missing.map(function(s){return '<li>'+esc(s)+'</li>';}).join("")+'</ul>'):'<div class="muted">—</div>')+'</div>'
        + '</div>'
        + '<button class="btn sm ghost" data-card="'+esc(e.creator_identity_id)+'">🧠 Open intelligence card</button></div>';
    }).join("");
    out.innerHTML = head + cards;
    fillNames(out, results.map(function(e){ return e.creator_identity_id; }));
    out.querySelectorAll("[data-card]").forEach(function(b){ b.onclick=function(){ openCard(b.getAttribute("data-card")); }; });
    var byId = {}; results.forEach(function(e){ byId[e.creator_identity_id]=e; });
    out.querySelectorAll("[data-pick]").forEach(function(cb){ cb.onchange=function(){
      var id=cb.getAttribute("data-pick");
      if(cb.checked) _shortlist[id]=byId[id]; else delete _shortlist[id];
      var btn=document.getElementById("ciCompareBtn");
      btn.textContent="Compare shortlist ("+shortlistCount()+")"; btn.disabled = shortlistCount()<2;
    };});
    document.getElementById("ciCompareBtn").onclick = compareShortlist;
  }
  // show who each creator is (name · @handle · followers) instead of an ID
  async function fillNames(scope, ids){
    try{
      var r = await api("creator_names", { p_ids: ids }); if(r.error || !r.data) return;
      scope.querySelectorAll("[data-ciname]").forEach(function(h){
        var n = r.data[h.getAttribute("data-ciname")]; if(!n) return;
        h.innerHTML = (n.pic?'<img class="ci-av" src="'+esc(n.pic)+'" alt="" referrerpolicy="no-referrer" onerror="this.remove()">':'')
          + esc(n.name||("@"+(n.handle||"creator"))) + (n.handle?' <a class="ci-handle" href="https://instagram.com/'+encodeURIComponent(n.handle)+'" target="_blank" rel="noopener">@'+esc(n.handle)+'</a>':'')
          + (n.followers!=null?' <span class="muted" style="font-weight:400;font-size:12px">· '+Number(n.followers).toLocaleString("en-IN")+' followers</span>':'');
      });
    }catch(e){}
  }
  function shortId(id){ return id?String(id).slice(0,8)+"…":"—"; }

  // Side-by-side comparison of shortlisted creators — composes the SAME authorised brand payloads.
  // No new data source, no ranking, no score; just the evidence laid out for a human decision.
  async function compareShortlist(){
    var out = document.getElementById("ciCompareOut");
    var ids = Object.keys(_shortlist);
    if(ids.length<2){ return; }
    out.innerHTML = '<div class="card"><div class="muted">Loading '+ids.length+' cards for comparison…</div></div>';
    try{
      var cards = await Promise.all(ids.map(function(id){
        return Promise.all([ api("get_creator_intelligence",{p_identity_id:id}), api("get_creator_commercial_readiness",{p_identity_id:id}) ])
          .then(function(rr){ var r=rr[0], rc=rr[1]; return r.error?{__err:r.error,id:id}:{id:id,d:r.data,cm:(rc&&!rc.error?rc.data:null),m:_shortlist[id]}; });
      }));
      renderComparison(cards);
    }catch(e){ out.innerHTML='<div class="card ci-err-inline">Couldn\'t build the comparison: '+esc(e.message||e)+'</div>'; }
  }

  function firstKey(obj){ if(!obj) return "—"; var ks=Object.keys(obj); return ks.length?(ks[0]+": "+obj[ks[0]]):"—"; }
  function renderComparison(cards){
    var out = document.getElementById("ciCompareOut");
    // rows are evidence dimensions; each dimension shows its own status/insufficiency per creator (never zeroed)
    var rows = [
      ["Match (this brief)", function(c){ return c.m? (MSTATUS[c.m.match_status]?MSTATUS[c.m.match_status][0]:c.m.match_status)+(c.m.match_strength?" · "+c.m.match_strength:"") : "—"; }],
      ["Category fit",       function(c){ return fCategory(c.cm); }],
      ["Content formats",    function(c){ return fFormats(c.cm); }],
      ["Strong signals",     function(c){ return c.m&&(c.m.matched_signals||[]).length? '<ul class="ci-cmpul">'+c.m.matched_signals.map(function(s){return '<li>'+esc(s)+'</li>';}).join("")+'</ul>' : '<span class="muted">none</span>'; }],
      ["Missing / unknown",  function(c){ return c.m&&(c.m.missing_signals||[]).length? '<ul class="ci-cmpul">'+c.m.missing_signals.map(function(s){return '<li>'+esc(s)+'</li>';}).join("")+'</ul>' : '—'; }],
      ["Top country",        function(c){ return esc(firstKey(((c.d||{}).audience||{}).country)); }],
      ["Top city",           function(c){ return esc(firstKey(((c.d||{}).audience||{}).city)); }],
      ["Audience freshness", function(c){ return esc(((c.d||{}).audience||{}).freshness||"—"); }],
      ["Performance",        function(c){ var p=(c.d||{}).performance||{}; return pill(p.status||"insufficient_data")+' <span class="muted">'+esc(p.reels_analysed!=null?("· "+p.reels_analysed+" reels"):"")+'</span>'; }],
      ["Confidence band",    function(c){ var p=(c.d||{}).performance||{}; return esc(p.confidence_band||"—"); }],
      ["Brand history",      function(c){ return fBrandHist(c.cm); }],
      ["Barter readiness",   function(c){ return fBarter(c.cm); }],
      ["Rate indication",    function(c){ return fRate(c.cm); }],
      ["Reliability",        function(c){ return pill(((c.d||{}).reliability||{}).status||"insufficient_data"); }],
      ["Fraud (estimate)",   function(c){ return pill(((c.d||{}).fraud_probability||{}).status||"insufficient_data"); }],
      ["Verified coverage",  function(c){ var v=((c.d||{}).coverage||{}); return v.value!=null?esc(v.value)+"%":pill(v.status||"insufficient_data"); }],
      ["Confidence",         function(c){ var v=((c.d||{}).confidence||{}); return v.value!=null?esc(v.value):pill(v.status||"insufficient_data"); }]
    ];
    var heads = cards.map(function(c){ return '<th'+(c.__err?'':' data-ciname="'+esc(c.id)+'"')+'>'+(c.__err?'<span class="ci-err-inline">no access</span>':('Creator <span class="ci-id">'+esc(shortId(c.id))+'</span>'))+'</th>'; }).join("");
    var body = rows.map(function(r){
      return '<tr><th class="ci-cmp-dim">'+esc(r[0])+'</th>'+cards.map(function(c){ return '<td>'+(c.__err?'—':r[1](c))+'</td>'; }).join("")+'</tr>';
    }).join("");
    out.innerHTML = '<div class="card ci-compare"><div class="ci-mh"><h4>Side-by-side comparison</h4></div>'
      + '<div class="ci-note">Authorised evidence only — no private contact, rates, or messages. Blanks are shown as their real status (e.g. “Insufficient data”), never as zero, and nothing here is an overall score.</div>'
      + '<div class="ci-cmp-scroll"><table class="ci-cmp"><thead><tr><th></th>'+heads+'</tr></thead><tbody>'+body+'</tbody></table></div></div>'
      + brandFeedbackForm();
    fillNames(out, cards.map(function(c){ return c.id; }));
    wireBrandFeedback();
    out.scrollIntoView({behavior:"smooth", block:"start"});
  }

  async function openCard(identityId, outId){
    var out = document.getElementById(outId||"ciCardOut"); if(!out) return;
    out.innerHTML = '<div class="card"><div class="muted">Loading creator card…</div></div>';
    try{
      var rr = await Promise.all([ api("get_creator_intelligence", { p_identity_id: identityId }), api("get_creator_commercial_readiness", { p_identity_id: identityId }) ]);
      if(rr[0].error) throw rr[0].error;
      renderCard(rr[0].data||{}, (rr[1]&&!rr[1].error?rr[1].data:null), outId);
      if(!outId) out.scrollIntoView({behavior:"smooth", block:"start"});
    }catch(e){
      var msg = (e && (e.message||e.hint||e.details)) || e;
      // authorisation errors surface as a clear, non-leaky message
      out.innerHTML = '<div class="card ci-err-inline">'+ (String(msg).match(/not authoris/i) ? 'You don\'t have access to this creator. Cards are limited to creators your organisation manages.' : ('Couldn\'t load the card: '+esc(String(msg)))) +'</div>';
    }
  }

  function commercialRows(cm){
    if(!cm) return '';
    function r(title, html){ return '<div class="ci-cardrow"><div class="ci-mh"><b>'+esc(title)+'</b></div><div>'+html+'</div></div>'; }
    return '<div class="ci-sub" style="margin-top:6px">Campaign decision fields</div>'
      + r("Category fit", fCategory(cm))
      + r("Content formats", fFormats(cm))
      + r("Historical brand experience", fBrandHist(cm))
      + r("Barter readiness", fBarter(cm))
      + r("Rate indication", fRate(cm));
  }
  function renderCard(d, cm, outId){
    var out = document.getElementById(outId||"ciCardOut"); if(!out) return;
    var gen = fmtDT(d.generated_at);
    var perf = d.performance||{}, aud = d.audience||{}, rel = d.reliability||{}, bs = d.brand_safety||{}, fr = d.fraud_probability||{}, conf = d.confidence||{}, cov = d.coverage||{};
    function row(title,status,explanation,meta,extra){
      return '<div class="ci-cardrow"><div class="ci-mh"><b>'+esc(title)+'</b>'+pill(status)+'</div>'
        + (explanation?'<div class="ci-exp">'+esc(explanation)+'</div>':'')+(extra||'')+meta+'</div>';
    }
    out.innerHTML = '<div class="card ci-card"><div class="ci-mh"><h3>Creator Intelligence Card</h3><span class="ci-id">'+esc(shortId((d.creator_identity||{}).identity_id))+'</span></div>'
      + '<div class="ci-note">Restricted view. Evidence summaries only — no private personal data, no private contact, no unauthorised rates, no raw messages.</div>'
      + commercialRows(cm)
      + row("Performance", perf.status||"insufficient_data", "Content performance summary ("+esc(perf.window||"recent")+").",
            metaLine("Feature store", gen, "Band: "+confBand({confidence_band:perf.confidence_band})),
            '<div class="ci-sub">Reels analysed: <b>'+esc(num(perf.reels_analysed))+'</b></div>')
      + row("Audience geography", aud.country?"available":"insufficient_data", "Marginal country/city distributions (not a joint intersection).",
            metaLine("Audience observations", gen, aud.freshness||"—"),
            '<div class="ci-chips">'+geoChips(aud)+'</div>')
      + row("Reliability", rel.status||"insufficient_data", rel.explanation||"Verified delivery history.", metaLine("Campaign evidence", gen, "—"),
            rel.status!=="available"?'<div class="ci-hint">Reason: '+esc(rel.reason||"insufficient history")+'</div>':'')
      + row("Brand safety", bs.status||"insufficient_data", "Reviewed brand-safety signals.", metaLine("Reviewed evidence", gen, "—"),
            bs.status!=="available"?'<div class="ci-hint">Reason: '+esc(bs.reason||"no reviewed evidence")+'</div>':'')
      + row("Fraud probability", fr.status||"insufficient_data", fr.explanation||"Always an estimate; shown as Insufficient data when signals are sparse — never 0%.",
            metaLine("Model estimate", gen, "Estimate"),
            '<div class="ci-hint">'+(fr.status==="available"?'Directional estimate only.':'No fabricated value.')+'</div>')
      + '<div class="ci-two">'
      +   row("Intelligence confidence", conf.status||"insufficient_data","How much to trust this card.", metaLine("Derived", gen, conf.value!=null?String(conf.value):"—"),"")
      +   row("Verified data coverage", cov.status||"insufficient_data","Share of expected inputs observed (never affects Performance/Fraud).", metaLine("Derived", gen, cov.value!=null?(cov.value+"%"):"—"),"")
      + '</div></div>';
  }
  function geoChips(aud){
    function d(obj){ if(!obj) return ""; return Object.keys(obj).map(function(k){return '<span class="ci-chip">'+esc(k)+': <b>'+esc(obj[k])+'</b></span>';}).join(""); }
    var c=d(aud.country), ci=d(aud.city);
    if(!c && !ci) return '<span class="muted">Insufficient data</span>';
    return c+ci;
  }

  // ---------- pilot feedback (stored separately via api.submit_pilot_feedback) ----------
  function brandFeedbackForm(){
    return '<div class="card ci-feedback" id="ciBrandFb"><h4>Pilot feedback</h4>'
      + '<div class="ci-note">Help us validate this replaces spreadsheets. Stored separately for the pilot review.</div>'
      + '<label class="ci-f"><span>Would you shortlist from this comparison?</span><select id="fbShortlist"><option value="">—</option><option>Yes</option><option>No</option><option>Maybe</option></select></label>'
      + '<label class="ci-f"><span>What information is missing to decide?</span><textarea id="fbMissing" rows="2"></textarea></label>'
      + '<label class="ci-f"><span>Would you pay for this intelligence?</span><select id="fbPay"><option value="">—</option><option>Yes</option><option>No</option><option>Maybe</option></select></label>'
      + '<button class="btn sm" id="fbBrandSend">Submit feedback</button><span id="fbBrandMsg" class="ci-hint"></span></div>';
  }
  function wireBrandFeedback(){
    var b=document.getElementById("fbBrandSend"); if(!b) return;
    b.onclick=function(){ submitFeedback('brand', {
      would_shortlist: valOf("fbShortlist"), missing: valOf("fbMissing"), would_pay: valOf("fbPay"),
      campaign: (_lastReq&&_lastReq.campaign)||null }, "fbBrandMsg"); };
  }
  async function submitFeedback(role, answers, msgId){
    var m=document.getElementById(msgId); if(m) m.textContent="Sending…";
    try{ var r=await api("submit_pilot_feedback",{p_role:role, p_answers:answers}); if(r.error) throw r.error;
      if(m) m.textContent="Thanks — feedback recorded ✓"; }
    catch(e){ if(m) m.textContent="Couldn't submit: "+(e.message||e); }
  }

  window.ciIntel = { boot: boot, loadSelf: loadSelf, loadBrand: loadBrand, openCard: openCard };

  // self-boot once app + a signed-in user are ready (kept fully passive otherwise)
  var tries=0, t=setInterval(function(){
    tries++;
    if(window.sb && window.Auth && Auth.profile){ clearInterval(t); boot(); }
    else if(tries>40) clearInterval(t);
  }, 800);
})();
