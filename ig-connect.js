/* Phase 1B — Instagram connect disclosure/CTA + first-run ingestion progress. DARK.
 * Rendered inside the (already flag-gated) Creator Profile. The CTA calls the server-side OAuth
 * start (ig-oauth-start Edge fn / api.ig_connect_start), which is itself gated by creator_ig_connect;
 * with the flag off the button fails closed. No app secret or token ever touches the browser. The
 * legacy media-kit Instagram integration is untouched. There is NO Geek permission-selection page
 * before Meta — the CTA goes straight to Meta authorization requesting all five scopes together. */
(function () {
  "use strict";
  function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }

  // Disclosure + primary CTA shown when the creator has no active connection.
  function connectPanel(){
    return ''
      + '<div class="card cp-connect">'
      + '  <h4>Connect Instagram &amp; Build My Profile</h4>'
      + '  <p class="cp-disclosure">Geek uses your Instagram Business/Creator connection to build a verified '
      + '  Creator Intelligence profile — content performance, audience &amp; geographic strength, engagement '
      + '  quality, category affinity, organic brand mentions, campaign responsiveness, reliability signals, '
      + '  fraud/anomaly indicators and platform performance. Raw data, messages and tokens are never shown '
      + '  to brands or stored in your browser.</p>'
      + '  <div class="cp-links"><a href="#" data-ig="analyses">What Geek analyses</a>'
      + '    <a href="privacy.html" target="_blank" rel="noopener">Privacy Policy</a>'
      + '    <a href="terms.html" target="_blank" rel="noopener">Data Use Policy</a>'
      + '    <a href="data-deletion.html" target="_blank" rel="noopener">Disconnect Instagram</a></div>'
      + '  <button class="btn cp-ig-cta" id="cpIgConnect">Connect Instagram &amp; Build My Profile</button>'
      + '  <div class="cp-hint" id="cpIgErr"></div>'
      + '</div>';
  }

  var STAGE_LABELS = {
    scope_verify:"Verifying permissions", account:"Importing profile", media:"Importing content",
    account_insights:"Importing performance", media_insights:"Importing performance",
    audience:"Importing audience", mentions:"Importing mentions", comments:"Importing comments",
    messaging:"Campaign responsiveness", completion:"Building Creator Intelligence profile"
  };

  // First-run progress (after a successful connect), driven by api.get_my_ingestion_status.
  function progressPanel(status){
    var run = status && status.run, stages = (status && status.stages) || [];
    var head = "Building your verified Creator Intelligence profile";
    if(run){ if(run.status==="complete") head="Ready"; else if(run.status==="partial") head="Partially ready — some data is still limited"; else if(run.status==="cancelled") head="Needs reconnect"; }
    var rows = stages.map(function(s){
      var st = s.status, cls = (st==="complete")?"done":(st==="running"||st==="queued")?"wait":(st==="capability_disabled"||st==="permission_missing"||st==="threshold_not_met"||st==="insufficient_data"||st==="unsupported")?"skip":"err";
      var note = (st==="complete")?"":(st==="queued")?"Waiting":(st==="running")?"…":(s.availability_reason||st);
      return '<div class="cp-prow"><span class="cp-pdot '+cls+'"></span><span>'+esc(STAGE_LABELS[s.stage]||s.stage)+'</span><span class="muted">'+esc(note)+'</span></div>';
    }).join("");
    return '<div class="card cp-progress-card"><div class="cp-connect-h">📸 Instagram connected</div>'
      + '<h4>'+esc(head)+'</h4>'
      + '<div class="cp-plist">'+(rows||'<div class="muted">Starting…</div>')+'</div>'
      + (run&&run.freshness_at?'<div class="cp-hint">As of '+esc(new Date(run.freshness_at).toLocaleString())+'</div>':'')
      + '<div class="cp-note">You can complete your profile while import continues. We never show fabricated audience, ranking or fraud numbers.</div></div>';
  }

  async function startConnect(){
    var err=document.getElementById("cpIgErr");
    try{
      if(!(window.sb&&window.sb.functions)) throw new Error("Not available.");
      // server-side OAuth start (returns only the Meta authorize URL; state is one-time & server-held)
      var r = await window.sb.functions.invoke("ig-oauth-start", { body:{} });
      if(r.error) throw r.error;
      var authorize = r.data && r.data.authorize_url;
      if(!authorize) throw new Error("Connect isn't enabled yet.");
      location.href = authorize;   // straight to Meta — all five scopes, no Geek selection page
    }catch(e){ if(err) err.textContent = "Couldn't start Instagram connect: "+(e.message||e); }
  }

  // Public: returns the connect-or-progress HTML for the profile connection area, and wires the CTA.
  window.ciConnect = {
    panelHtml: function(connected, status){ return connected ? progressPanel(status) : connectPanel(); },
    wire: function(){
      var b=document.getElementById("cpIgConnect"); if(b) b.onclick=startConnect;
      document.querySelectorAll('[data-ig="analyses"]').forEach(function(a){ a.onclick=function(e){ e.preventDefault();
        alert("Geek analyses (from your consented Instagram Business data):\n• Content performance (reach, engagement, views)\n• Audience & geographic strength (aggregated demographics)\n• Engagement quality\n• Category affinity\n• Organic brand mentions\n• Campaign responsiveness\n• Reliability signals\n• Fraud/anomaly indicators\n\nAggregated only — never individual followers, never raw DMs."); }; });
    }
  };
})();
