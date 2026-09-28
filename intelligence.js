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
  async function boot(){
    try{
      if(!window.sb || !window.sb.schema){ enabled=false; }
      else { var r = await api("creator_profile_api_enabled"); enabled = !!(r && !r.error && r.data === true); }
    }catch(e){ enabled=false; }
    window.__ciIntelEnabled = enabled;
    if(enabled && typeof renderNav === "function") renderNav();
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
      var r = await api("get_my_creator_intelligence");
      if(r.error) throw r.error;
      renderSelf(r.data || {});
    }catch(e){
      var err = document.getElementById("ciSelfErr");
      if(err){ err.style.display="block"; err.textContent = "Couldn't load your intelligence. "+(e.message||e); }
    }
  }

  function measureCard(title, status, explanation, meta, extra){
    return '<div class="card ci-measure"><div class="ci-mh"><h4>'+esc(title)+'</h4>'+pill(status)+'</div>'
      + (explanation?'<div class="ci-exp">'+esc(explanation)+'</div>':'')
      + (extra||'')
      + meta + '</div>';
  }

  function renderSelf(d){
    var gen = fmtDT(d.generated_at);
    if(d.status === "insufficient_data" && !d.performance){
      document.getElementById("ciSelfBody").innerHTML =
        '<div class="card ci-measure"><div class="ci-mh"><h4>Intelligence not computed yet</h4>'+pill("insufficient_data")+'</div>'
        + '<div class="ci-exp">We haven\'t computed your intelligence yet. Connect your account and keep your profile updated — measures appear as evidence accumulates. Nothing is estimated as zero in the meantime.</div></div>';
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

    document.getElementById("ciSelfBody").innerHTML = body;
    wireEvidence(document.getElementById("ciSelfBody"));
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
      + '<div class="card ci-intro"><h3>Creator Intelligence</h3>'
      + '<div class="muted">Match creators to a specific brief and read an evidence-backed card for creators you have a relationship with. There is no global ranking and no opaque score — every match is explained by the signals it did and didn\'t meet, for this brief only.</div></div>'
      + matchForm()
      + '<div id="ciMatchOut"></div>'
      + '<div id="ciCompareOut"></div>'
      + '<div class="card ci-lookup"><h4>Look up a creator card</h4>'
      + '<div class="ci-addrow"><input id="ciLookupId" placeholder="Creator identity ID (creators you manage)"><button class="btn sm" id="ciLookupBtn">Open card</button></div>'
      + '<div class="ci-note">Access is limited to creators your organisation has a relationship with. Cards never expose private contact details, unauthorised rates, or raw messages.</div></div>'
      + '<div id="ciCardOut"></div>'
      + '<div id="ciBrandErr" class="ci-err" style="display:none"></div></div>';
  };

  function matchForm(){
    return '<div class="card ci-brief"><h4>Campaign brief</h4>'
      + '<div class="ci-grid">'
      + '<label class="ci-f"><span>Categories (comma separated)</span><input id="ciReqCat" placeholder="e.g. fitness, wellness"></label>'
      + '<label class="ci-f"><span>Locations (comma separated)</span><input id="ciReqLoc" placeholder="e.g. IN, Bengaluru"></label>'
      + '<label class="ci-f"><span>Content formats (comma separated)</span><input id="ciReqFmt" placeholder="e.g. reels"></label>'
      + '<label class="ci-f"><span>Platform</span><select id="ciReqPlat"><option value="instagram">Instagram</option></select></label>'
      + '</div>'
      + '<button class="btn" id="ciMatchBtn">Find matches for this brief</button>'
      + '<div class="ci-note">Matching runs only over creators your organisation manages, for this brief. It ranks nothing globally and invents no facts.</div></div>';
  }

  async function loadBrand(){
    var root = document.getElementById("ciBrand"); if(!root) return;
    var mb = document.getElementById("ciMatchBtn"); if(mb) mb.onclick = runMatch;
    var lb = document.getElementById("ciLookupBtn"); if(lb) lb.onclick = function(){ var id=(document.getElementById("ciLookupId").value||"").trim(); if(id) openCard(id); };
  }

  function csv(id){ var v=(document.getElementById(id).value||"").trim(); return v?v.split(",").map(function(s){return s.trim();}).filter(Boolean):[]; }

  async function runMatch(){
    var out = document.getElementById("ciMatchOut");
    var req = { category: csv("ciReqCat"), location: csv("ciReqLoc"), content_formats: csv("ciReqFmt"), platform: document.getElementById("ciReqPlat").value };
    out.innerHTML = '<div class="card"><div class="muted">Matching against your managed creators…</div></div>';
    try{
      var r = await api("match_creators", { p_requirements: req });
      if(r.error) throw r.error;
      renderMatches(r.data||{});
    }catch(e){ out.innerHTML = '<div class="card ci-err-inline">Couldn\'t run matching: '+esc(e.message||e)+'</div>'; }
  }

  var STRENGTH = { strong:["Strong","ok"], moderate:["Moderate","warn"], weak:["Weak","na"] };
  var MSTATUS  = { match:["Match","ok"], partial:["Partial match","warn"], no_match:["Not a fit for this brief","na"], insufficient_data:["Insufficient data","na"] };
  function tagOf(map,k){ var s=map[k]||[k||"—","na"]; return '<span class="ci-pill ci-'+s[1]+'">'+esc(s[0])+'</span>'; }

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
        + '<h4>Creator <span class="ci-id">'+esc(shortId(e.creator_identity_id))+'</span></h4>'
        + tagOf(MSTATUS, e.match_status)+(e.match_strength?tagOf(STRENGTH, e.match_strength):'')+'</div>'
        + '<div class="ci-signals">'
        +   '<div class="ci-sig ok"><div class="ci-sig-h">✓ Strong signals</div>'+(matched.length?('<ul>'+matched.map(function(s){return '<li>'+esc(s)+'</li>';}).join("")+'</ul>'):'<div class="muted">None evidenced for this brief</div>')+'</div>'
        +   '<div class="ci-sig na"><div class="ci-sig-h">− Missing / unknown</div>'+(missing.length?('<ul>'+missing.map(function(s){return '<li>'+esc(s)+'</li>';}).join("")+'</ul>'):'<div class="muted">—</div>')+'</div>'
        + '</div>'
        + '<button class="btn sm ghost" data-card="'+esc(e.creator_identity_id)+'">Open intelligence card</button></div>';
    }).join("");
    out.innerHTML = head + cards;
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
  function shortId(id){ return id?String(id).slice(0,8)+"…":"—"; }

  // Side-by-side comparison of shortlisted creators — composes the SAME authorised brand payloads.
  // No new data source, no ranking, no score; just the evidence laid out for a human decision.
  async function compareShortlist(){
    var out = document.getElementById("ciCompareOut");
    var ids = Object.keys(_shortlist);
    if(ids.length<2){ return; }
    out.innerHTML = '<div class="card"><div class="muted">Loading '+ids.length+' cards for comparison…</div></div>';
    try{
      var cards = await Promise.all(ids.map(function(id){ return api("get_creator_intelligence",{p_identity_id:id}).then(function(r){ return r.error?{__err:r.error,id:id}:{id:id,d:r.data,m:_shortlist[id]}; }); }));
      renderComparison(cards);
    }catch(e){ out.innerHTML='<div class="card ci-err-inline">Couldn\'t build the comparison: '+esc(e.message||e)+'</div>'; }
  }

  function firstKey(obj){ if(!obj) return "—"; var ks=Object.keys(obj); return ks.length?(ks[0]+": "+obj[ks[0]]):"—"; }
  function renderComparison(cards){
    var out = document.getElementById("ciCompareOut");
    // rows are evidence dimensions; each dimension shows its own status/insufficiency per creator (never zeroed)
    var rows = [
      ["Match (this brief)", function(c){ return c.m? (MSTATUS[c.m.match_status]?MSTATUS[c.m.match_status][0]:c.m.match_status)+(c.m.match_strength?" · "+c.m.match_strength:"") : "—"; }],
      ["Strong signals",     function(c){ return c.m&&(c.m.matched_signals||[]).length? '<ul class="ci-cmpul">'+c.m.matched_signals.map(function(s){return '<li>'+esc(s)+'</li>';}).join("")+'</ul>' : '<span class="muted">none</span>'; }],
      ["Missing / unknown",  function(c){ return c.m&&(c.m.missing_signals||[]).length? '<ul class="ci-cmpul">'+c.m.missing_signals.map(function(s){return '<li>'+esc(s)+'</li>';}).join("")+'</ul>' : '—'; }],
      ["Performance",        function(c){ var p=(c.d||{}).performance||{}; return pill(p.status||"insufficient_data")+' <span class="muted">'+esc(p.reels_analysed!=null?("· "+p.reels_analysed+" reels"):"")+'</span>'; }],
      ["Confidence band",    function(c){ var p=(c.d||{}).performance||{}; return esc(p.confidence_band||"—"); }],
      ["Top country",        function(c){ return esc(firstKey(((c.d||{}).audience||{}).country)); }],
      ["Top city",           function(c){ return esc(firstKey(((c.d||{}).audience||{}).city)); }],
      ["Audience freshness", function(c){ return esc(((c.d||{}).audience||{}).freshness||"—"); }],
      ["Reliability",        function(c){ return pill(((c.d||{}).reliability||{}).status||"insufficient_data"); }],
      ["Fraud (estimate)",   function(c){ return pill(((c.d||{}).fraud_probability||{}).status||"insufficient_data"); }],
      ["Verified coverage",  function(c){ var v=((c.d||{}).coverage||{}); return v.value!=null?esc(v.value)+"%":pill(v.status||"insufficient_data"); }],
      ["Confidence",         function(c){ var v=((c.d||{}).confidence||{}); return v.value!=null?esc(v.value):pill(v.status||"insufficient_data"); }]
    ];
    var heads = cards.map(function(c){ return '<th>'+(c.__err?'<span class="ci-err-inline">no access</span>':('Creator <span class="ci-id">'+esc(shortId(c.id))+'</span>'))+'</th>'; }).join("");
    var body = rows.map(function(r){
      return '<tr><th class="ci-cmp-dim">'+esc(r[0])+'</th>'+cards.map(function(c){ return '<td>'+(c.__err?'—':r[1](c))+'</td>'; }).join("")+'</tr>';
    }).join("");
    out.innerHTML = '<div class="card ci-compare"><div class="ci-mh"><h4>Side-by-side comparison</h4></div>'
      + '<div class="ci-note">Authorised evidence only — no private contact, rates, or messages. Blanks are shown as their real status (e.g. “Insufficient data”), never as zero, and nothing here is an overall score.</div>'
      + '<div class="ci-cmp-scroll"><table class="ci-cmp"><thead><tr><th></th>'+heads+'</tr></thead><tbody>'+body+'</tbody></table></div></div>';
    out.scrollIntoView({behavior:"smooth", block:"start"});
  }

  async function openCard(identityId){
    var out = document.getElementById("ciCardOut");
    out.innerHTML = '<div class="card"><div class="muted">Loading creator card…</div></div>';
    try{
      var r = await api("get_creator_intelligence", { p_identity_id: identityId });
      if(r.error) throw r.error;
      renderCard(r.data||{});
    }catch(e){
      var msg = (e && (e.message||e.hint||e.details)) || e;
      // authorisation errors surface as a clear, non-leaky message
      out.innerHTML = '<div class="card ci-err-inline">'+ (String(msg).match(/not authoris/i) ? 'You don\'t have access to this creator. Cards are limited to creators your organisation manages.' : ('Couldn\'t load the card: '+esc(String(msg)))) +'</div>';
    }
  }

  function renderCard(d){
    var out = document.getElementById("ciCardOut");
    var gen = fmtDT(d.generated_at);
    var perf = d.performance||{}, aud = d.audience||{}, rel = d.reliability||{}, bs = d.brand_safety||{}, fr = d.fraud_probability||{}, conf = d.confidence||{}, cov = d.coverage||{};
    function row(title,status,explanation,meta,extra){
      return '<div class="ci-cardrow"><div class="ci-mh"><b>'+esc(title)+'</b>'+pill(status)+'</div>'
        + (explanation?'<div class="ci-exp">'+esc(explanation)+'</div>':'')+(extra||'')+meta+'</div>';
    }
    out.innerHTML = '<div class="card ci-card"><div class="ci-mh"><h3>Creator Intelligence Card</h3><span class="ci-id">'+esc(shortId((d.creator_identity||{}).identity_id))+'</span></div>'
      + '<div class="ci-note">Restricted view. Evidence summaries only — no private personal data, no private contact, no unauthorised rates, no raw messages.</div>'
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

  window.ciIntel = { boot: boot, loadSelf: loadSelf, loadBrand: loadBrand };

  // self-boot once app + a signed-in user are ready (kept fully passive otherwise)
  var tries=0, t=setInterval(function(){
    tries++;
    if(window.sb && window.Auth && Auth.profile){ clearInterval(t); boot(); }
    else if(tries>40) clearInterval(t);
  }, 800);
})();
