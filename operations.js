/* Creator Intelligence — Campaign Operations UI (Phase 1E, DARK, flag-gated).
 * Renders ONLY when api.ops_vocab() succeeds (operational_pilot flag ON + caller in pilot cohort). In
 * production the api schema is unexposed, so this stays hidden and the legacy app is unchanged. All reads/
 * writes go through the EXISTING api RPCs — never intel tables. No scoring/ranking; missing data renders as
 * "unavailable"/"—", never fabricated; metrics are evidence-only. Private creator data is never shown here. */
(function () {
  "use strict";
  var enabled = false, isOperator = false, VOCAB = null;
  window.__ciOpsEnabled = false; window.__ciOpsOperator = false;

  function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function api(fn,args){ return window.sb.schema("api").rpc(fn, args||{}); }
  function fmtDate(d){ if(!d) return "—"; try{ return new Date(d).toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"}); }catch(e){ return String(d); } }
  function fmtDT(d){ if(!d) return "—"; try{ return new Date(d).toLocaleString("en-IN",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}); }catch(e){ return String(d); } }
  function shortId(id){ return id?String(id).slice(0,8)+"…":"—"; }
  function vlabel(kind,key){ try{ var a=VOCAB[kind]||[]; for(var i=0;i<a.length;i++) if(a[i].key===key) return a[i].label; }catch(e){} return key||"—"; }

  var STAGE = { shortlisted:["Shortlisted","na"], invited:["Invited","warn"], accepted:["Confirmed","ok"],
    rejected:["Rejected","na"], product_sent:["Product sent","warn"], content_created:["Creating","warn"],
    content_submitted:["Submitted","warn"], content_approved:["Approved","ok"], changes_requested:["Changes requested","warn"],
    published:["Live","ok"], completed:["Completed","ok"], dropped:["Dropped","na"],
    // application-first barter funnel
    applied:["Applied","warn"], eligible:["Eligible","ok"], ineligible:["Not eligible","na"],
    sent_to_brand:["With brand","warn"], brand_confirmed:["Brand confirmed","ok"], brand_declined:["Brand declined","na"],
    contract_sent:["Sign contract","warn"], contract_signed:["Contract signed","ok"], address_confirmed:["Address confirmed","ok"] };
  var LIFE = { draft:"Draft", creator_discovery:"Creator discovery", in_execution:"In execution", reporting:"Reporting", completed:"Completed", cancelled:"Cancelled" };
  function spill(st){ var x=STAGE[st]||[st||"—","na"]; return '<span class="ci-pill ci-'+x[1]+'">'+esc(x[0])+'</span>'; }

  async function boot(){
    try{
      if(!window.sb||!window.sb.schema){ enabled=false; }
      else { var r=await api("ops_vocab"); enabled=!!(r && !r.error && r.data); if(enabled) VOCAB=r.data; }
    }catch(e){ enabled=false; }
    if(enabled){ try{ var p=await api("get_campaign_pipeline",{p_filters:{}}); isOperator=!!(p && !p.error); }catch(e){ isOperator=false; } }
    window.__ciOpsEnabled=enabled; window.__ciOpsOperator=isOperator;
    if(enabled && typeof renderNav==="function") renderNav();
    if(enabled) updateAlertsBadge();
  }

  /* ============================ 0. NOTIFICATION INBOX (app + WhatsApp + email spine) ============================ */
  // Lightweight modal used by the funnel actions + inbox.
  function opsModal(inner){
    var ov=document.createElement("div"); ov.className="cp-ob-overlay"; ov.id="opsModal";
    ov.innerHTML='<div class="cp-ob-modal" role="dialog" aria-modal="true">'+inner+'</div>';
    document.body.appendChild(ov);
    ov.addEventListener("click",function(e){ if(e.target===ov) ov.remove(); });
    return ov;
  }
  function closeModal(){ var m=document.getElementById("opsModal"); if(m) m.remove(); }

  // route a notification's CTA to the right page (and open the campaign when relevant)
  function routeNotification(n){
    var route=n.action_route; if(!route) return;
    if(typeof currentPage!=="undefined"){ currentPage=route; }
    if(typeof renderShell==="function") renderShell();
    if(route==="campaignops" && n.campaign_id){ setTimeout(function(){ openCampaignDetail(n.campaign_id); },60); }
  }

  async function updateAlertsBadge(){
    try{
      var r=await api("get_my_notifications",{p_only_unread:true});
      var n=(r && !r.error && Array.isArray(r.data))?r.data.length:0;
      var a=document.querySelector('#nav a[data-page="alerts"]'); if(!a) return;
      var b=a.querySelector(".ops-badge"); if(!b){ b=document.createElement("span"); b.className="ops-badge"; a.appendChild(b); }
      if(n>0){ b.textContent=n>9?"9+":String(n); b.style.display=""; } else { b.style.display="none"; }
    }catch(e){}
  }

  window.renderAlerts=function(){
    if(!enabled) return '<div class="card"><h3>Alerts</h3><div class="muted">This feature isn\'t enabled for your account yet.</div></div>';
    return '<div id="opsAlerts" class="ci"><div class="card ci-intro"><h3>Alerts</h3><div class="muted">Everything that needs you — the same updates we send on WhatsApp and email, with a link straight to the action.</div></div>'
      + '<div id="opsAlertsBody"><div class="card"><div class="muted">Loading…</div></div></div></div>';
  };
  async function loadAlerts(){
    var body=document.getElementById("opsAlertsBody"); if(!body) return;
    try{ var r=await api("get_my_notifications",{p_only_unread:false}); if(r.error) throw r.error; renderAlertsList(r.data||[]); }
    catch(e){ body.innerHTML='<div class="card ci-err-inline">Couldn\'t load alerts: '+esc(e.message||e)+'</div>'; }
  }
  function renderAlertsList(list){
    var body=document.getElementById("opsAlertsBody");
    if(!list.length){ body.innerHTML='<div class="card"><div class="muted">No alerts yet. When something needs you, it\'ll show here.</div></div>'; return; }
    body.innerHTML='<div class="card"><div class="ops-alist">'+list.map(function(n){
      var cls="ops-alert"+(n.read?"":" unread")+(n.kind==="action_required"?" act":"");
      return '<div class="'+cls+'" data-nid="'+esc(n.notification_id)+'">'
        + '<div class="ops-alert-h"><b>'+esc(n.title)+'</b><span class="ci-hint">'+fmtDT(n.created_at)+'</span></div>'
        + '<div class="ci-hint">'+esc(n.body)+'</div>'
        + (n.action_route?'<div class="ci-evrow"><button class="btn sm" data-act="'+esc(n.notification_id)+'">'+esc(n.action_label||"Open")+'</button></div>':'')
        + '</div>';
    }).join("")+'</div></div>';
    // open CTA → mark acted + route
    body.querySelectorAll("[data-act]").forEach(function(btn){ btn.onclick=function(e){ e.stopPropagation();
      var n=findNotif(list, btn.getAttribute("data-act")); if(!n) return;
      api("mark_notification_acted",{p_id:n.notification_id}).then(function(){ updateAlertsBadge(); routeNotification(n); });
    }; });
    // row click → mark read
    body.querySelectorAll(".ops-alert").forEach(function(row){ row.onclick=function(){
      var id=row.getAttribute("data-nid"); if(row.classList.contains("unread")){ api("mark_notification_read",{p_id:id}).then(function(){ row.classList.remove("unread"); updateAlertsBadge(); }); }
    }; });
  }
  function findNotif(list,id){ for(var i=0;i<list.length;i++) if(list[i].notification_id===id) return list[i]; return null; }

  /* ============================ 1. AGENCY OPERATIONS ============================ */
  var COLS = [["draft","Draft"],["creator_discovery","Creator discovery"],["invited","Creators invited"],
    ["accepted","Creators confirmed"],["product_sent","Product dispatched"],["content_created","Content pending"],
    ["content_submitted","Content submitted"],["content_approved","Brand approval"],["published","Live"],["completed","Completed"]];
  var PART_ORDER = ["invited","accepted","product_sent","content_created","content_submitted","content_approved","published","completed"];

  window.renderAgencyOps = function(){
    if(!enabled) return '<div class="card"><h3>Campaign Operations</h3><div class="muted">This feature isn\'t enabled for your account yet.</div></div>';
    if(!isOperator){
      // brand / owning-org view: no pipeline board, but open individual campaigns from an Alert link
      return '<div id="opsAgency" class="ci"><div class="card ci-intro"><h3>Campaigns</h3>'
        + '<div class="muted">Open a campaign from your <b>Alerts</b> to review and confirm the creators we\'ve shortlisted for you.</div></div>'
        + '<div id="opsDetail"></div></div>';
    }
    return '<div id="opsAgency" class="ci">'
      + '<div class="card ci-intro"><div class="ci-mh"><h3>Campaign Operations</h3><button class="btn sm" id="opsNewCamp">Create campaign</button></div>'
      + '<div class="muted">Run barter campaigns end to end. Every stage change is recorded with owner, time and reason. No scores, no ranking.</div></div>'
      + '<div id="opsNewCampForm"></div>'
      + '<div id="opsBoard"><div class="card"><div class="muted">Loading pipeline…</div></div></div>'
      + '<div id="opsDetail"></div></div>';
  };
  async function loadAgencyOps(){
    if(!isOperator) return;   // brand view loads a specific campaign via openCampaignDetail (from Alerts)
    var nb=document.getElementById("opsNewCamp"); if(nb) nb.onclick=toggleNewCampaign;
    try{ var r=await api("get_campaign_pipeline",{p_filters:{}}); if(r.error) throw r.error; renderBoard(r.data||{}); }
    catch(e){ document.getElementById("opsBoard").innerHTML='<div class="card ci-err-inline">Couldn\'t load pipeline: '+esc(e.message||e)+'</div>'; }
  }
  function campaignColumn(c){
    if(c.lifecycle_status==='draft') return 'draft';
    if(c.lifecycle_status==='completed') return 'completed';
    var st=c.stages||{}, col='creator_discovery';
    for(var i=0;i<PART_ORDER.length;i++){ if(st[PART_ORDER[i]]) col=PART_ORDER[i]; }
    if(c.lifecycle_status==='creator_discovery' && col==='creator_discovery') return 'creator_discovery';
    return col;
  }
  function renderBoard(d){
    var camps=d.campaigns||[], totals=d.totals||{};
    var byCol={}; COLS.forEach(function(c){ byCol[c[0]]=[]; });
    camps.forEach(function(c){ var col=campaignColumn(c); (byCol[col]||byCol.creator_discovery).push(c); });
    var totalsRow='<div class="card ops-totals">'+[["campaigns_running","Running"],["contacted","Contacted"],["confirmed","Confirmed"],["shipped","Shipped"],["content_pending","Content pending"],["approvals_pending","Approvals pending"],["completed","Completed"]]
      .map(function(t){ return '<div class="ops-tot"><b>'+esc(totals[t[0]]!=null?totals[t[0]]:"—")+'</b><span>'+t[1]+'</span></div>'; }).join("")+'</div>';
    var board='<div class="ops-board">'+COLS.map(function(c){
      var list=byCol[c[0]]||[];
      return '<div class="ops-col"><div class="ops-col-h">'+esc(c[1])+' <span class="ci-tag">'+list.length+'</span></div>'
        + list.map(function(k){
            var count=Object.keys(k.stages||{}).reduce(function(a,s){return a+(k.stages[s]||0);},0);
            var pend=(k.stages&&k.stages.content_submitted)||0;
            return '<div class="ops-card" data-camp="'+esc(k.campaign_id)+'"><b>'+esc(k.brand||"—")+'</b>'
              + '<div class="ops-card-name">'+esc(k.name)+'</div>'
              + '<div class="ci-hint">'+esc(vlabel("objectives",k.objective))+(k.comp_type?' · '+esc(k.comp_type):'')+'</div>'
              + '<div class="ops-card-meta"><span>'+count+' creators</span>'+(pend?'<span class="ci-pill ci-warn">'+pend+' to approve</span>':'')+'</div></div>';
          }).join("") + (list.length?'':'<div class="muted ops-empty">—</div>')
        + '</div>';
    }).join("")+'</div>';
    document.getElementById("opsBoard").innerHTML=totalsRow+'<div class="ci-note">Tick a card to open the campaign.</div>'+board;
    document.querySelectorAll("#opsBoard [data-camp]").forEach(function(el){ el.onclick=function(){ openCampaignDetail(el.getAttribute("data-camp")); }; });
  }

  function toggleNewCampaign(){
    var box=document.getElementById("opsNewCampForm");
    if(box.innerHTML){ box.innerHTML=""; return; }
    box.innerHTML=campaignForm("opsCreateBtn");
    document.getElementById("opsCreateBtn").onclick=function(){ submitCampaign(function(){ toggleNewCampaign(); loadAgencyOps(); }); };
  }
  function campaignForm(btnId){
    var objs=(VOCAB&&VOCAB.objectives)||[];
    return '<div class="card ci-brief"><h4>New campaign</h4><div class="ci-grid">'
      + f("Brand name","cfBrand","e.g. Snuggles")
      + f("Campaign name","cfName","e.g. Snuggles launch")
      + '<label class="ci-f"><span>Objective</span><select id="cfObj"><option value="">—</option>'+objs.map(function(o){return '<option value="'+esc(o.key)+'">'+esc(o.label)+'</option>';}).join("")+'</select></label>'
      + f("Product","cfProduct","e.g. Snuggles pet bed")
      + f("Category","cfCategory","e.g. pets")
      + f("Cities (comma separated)","cfCities","e.g. Bangalore")
      + f("Languages (comma separated)","cfLangs","e.g. English, Hindi")
      + '<label class="ci-f"><span>Compensation</span><select id="cfComp"><option value="">—</option><option value="barter">Barter</option><option value="cash">Paid</option><option value="hybrid">Hybrid</option></select></label>'
      + f("Budget (₹)","cfBudget","e.g. 1500000","number")
      + f("Starts on","cfStart","","date") + f("Ends on","cfEnd","","date")
      + '</div><button class="btn" id="'+btnId+'">Create campaign</button>'
      + '<div class="ci-note">Company website/contact are stored with the brief. Creators are added from matching after discovery.</div></div>';
  }
  function f(label,id,ph,type){ return '<label class="ci-f"><span>'+esc(label)+'</span><input id="'+id+'" type="'+(type||"text")+'" placeholder="'+esc(ph||"")+'"></label>'; }
  function val(id){ var e=document.getElementById(id); return e?(e.value||"").trim():""; }
  function csv(id){ var v=val(id); return v?v.split(",").map(function(s){return s.trim();}).filter(Boolean):[]; }
  async function submitCampaign(done){
    var p={ name:val("cfName"), submitted_brand_name:val("cfBrand")||null, objective:val("cfObj")||null,
      product:val("cfProduct")||null, category:val("cfCategory")||null, cities:csv("cfCities"), languages:csv("cfLangs"),
      comp_type:val("cfComp")||null, budget:val("cfBudget")||null, starts_on:val("cfStart")||null, ends_on:val("cfEnd")||null,
      requirements:{ category: val("cfCategory")?[val("cfCategory")]:[], location: csv("cfCities") } };
    if(!p.name){ alert("Campaign name is required"); return; }
    try{ var r=await api("create_campaign",{p:p}); if(r.error) throw r.error; if(done) done(); }
    catch(e){ alert("Couldn't create campaign: "+(e.message||e)); }
  }

  async function openCampaignDetail(id){
    var out=document.getElementById("opsDetail");
    out.innerHTML='<div class="card"><div class="muted">Loading campaign…</div></div>';
    try{ var r=await api("get_campaign_detail",{p_campaign:id}); if(r.error) throw r.error; renderCampaignDetail(r.data||{}); out.scrollIntoView({behavior:"smooth",block:"start"}); }
    catch(e){ out.innerHTML='<div class="card ci-err-inline">Couldn\'t load campaign: '+esc(e.message||e)+'</div>'; }
  }
  function renderCampaignDetail(d){
    var out=document.getElementById("opsDetail"); var c=d.campaign||{}, parts=d.participations||[], events=d.events||[];
    var eligN=parts.filter(function(p){ return p.stage==='eligible'; }).length;
    // overview + campaign stage actions
    var nextCampaign={draft:"creator_discovery",creator_discovery:"in_execution",in_execution:"reporting",reporting:"completed"}[c.lifecycle_status];
    var overview='<div class="card"><div class="ci-mh"><h3>'+esc(c.name||"Campaign")+'</h3><span class="ci-pill ci-na">'+esc(LIFE[c.lifecycle_status]||c.lifecycle_status)+'</span></div>'
      + '<div class="ci-meta"><span>Brand: <b>'+esc(c.brand||"—")+'</b></span><span>Objective: <b>'+esc(vlabel("objectives",c.objective))+'</b></span>'
      + '<span>Comp: <b>'+esc(c.comp_type||"—")+'</b></span><span>Timeline: <b>'+fmtDate(c.starts_on)+' – '+fmtDate(c.ends_on)+'</b></span>'
      + '<span>Product: <b>'+esc(c.product||"—")+'</b></span></div>'
      + (nextCampaign?'<button class="btn sm ghost" id="opsAdvCamp" data-to="'+nextCampaign+'" data-camp="'+esc(c.campaign_id)+'">Move campaign → '+esc(LIFE[nextCampaign])+'</button>':'')
      + '<div class="ci-addrow" style="margin-top:8px"><input id="opsInviteId" placeholder="Creator identity ID (from matching)"><select id="opsInviteRole"><option value="creator">Creator</option><option value="ugc_creator">UGC</option><option value="ambassador">Ambassador</option></select><button class="btn sm" id="opsAddPart" data-camp="'+esc(c.campaign_id)+'">Add creator</button></div>'
      + (eligN>0?'<button class="btn sm" id="opsSendBrand" data-camp="'+esc(c.campaign_id)+'" style="margin-top:8px">Send shortlist to brand ('+eligN+' eligible)</button>':'')
      + '</div>';
    // creators + execution + per-participation actions
    var creators='<div class="card"><h4>Creators &amp; execution</h4>'+(parts.length?parts.map(function(p){
      var dl=(p.deliverables||[]);
      var sub=null; dl.forEach(function(x){ if(x.latest_submission) sub=x.latest_submission; });
      var acts='';
      if(p.stage==='shortlisted') acts='<button class="btn sm ghost" data-adv="'+p.participation_id+'" data-to="invited">Invite</button>';
      else if(p.stage==='applied') acts='<button class="btn sm" data-screen-ok="'+p.participation_id+'">Mark eligible</button>'
        + '<button class="btn sm ghost" data-screen-no="'+p.participation_id+'">Not eligible</button>';
      else if(p.stage==='sent_to_brand') acts='<button class="btn sm" data-brand-ok="'+p.participation_id+'">Brand: confirm</button>'
        + '<button class="btn sm ghost" data-brand-no="'+p.participation_id+'">Brand: decline</button>';
      else if(p.stage==='brand_confirmed') acts='<button class="btn sm" data-issue="'+p.participation_id+'">Issue contract</button>';
      else if(p.stage==='content_submitted') acts='<button class="btn sm" data-approve="'+(sub?sub.submission_id:'')+'" data-dec="approved">Approve</button>'
        + '<button class="btn sm ghost" data-approve="'+(sub?sub.submission_id:'')+'" data-dec="changes_requested">Request changes</button>';
      else if(p.stage==='content_approved') acts='<button class="btn sm ghost" data-adv="'+p.participation_id+'" data-to="published">Mark live</button>';
      else if(p.stage==='published') acts='<button class="btn sm ghost" data-adv="'+p.participation_id+'" data-to="completed">Complete</button>';
      var canShip=(p.stage==='accepted'||p.stage==='address_confirmed');
      return '<div class="ci-cardrow"><div class="ci-mh"><b>Creator '+esc(shortId(p.creator_identity_id))+'</b>'+spill(p.stage)+'</div>'
        + '<div class="ci-hint">Role: '+esc(p.role||"creator")+(p.shipment?(' · Shipment: '+esc(p.shipment.status)+(p.shipment.tracking?(' ('+esc(p.shipment.tracking)+')'):'')):'')+(p.reason?(' · Reason: '+esc(p.reason)):'')+'</div>'
        + '<div class="ci-hint">Deliverables: '+(dl.length?dl.map(function(x){return esc(vlabel("content_formats",x.format))+' ×'+esc(x.quantity||1)+' ['+esc(x.status)+']';}).join(", "):'—')+'</div>'
        + (sub?'<div class="ci-hint">Submission: <a href="'+esc(sub.content_url||"#")+'" target="_blank" rel="noopener">'+esc(sub.content_url||"link")+'</a></div>':'')
        + (acts||canShip?'<div class="ci-evrow">'+acts+(canShip?'<button class="btn sm ghost" data-ship="'+p.participation_id+'">Record shipment</button>':'')+'</div>':'')
        + '</div>';
    }).join(""):'<div class="muted">No creators yet. Add creators from matching above.</div>')+'</div>';
    // activity ledger
    var activity='<div class="card"><h4>Activity</h4><div class="ops-timeline">'+(events.length?events.map(function(e){
      return '<div class="ops-ev"><span class="ci-tag">'+esc(e.entity)+'</span> '+esc(e.from||"—")+' → <b>'+esc(e.to)+'</b>'+(e.reason?' <span class="muted">· '+esc(e.reason)+'</span>':'')+'<div class="ci-hint">'+fmtDT(e.at)+'</div></div>';
    }).join(""):'<div class="muted">No activity yet.</div>')+'</div></div>';
    out.innerHTML=overview+creators+activity;
    wireDetail(c.campaign_id);
  }
  function wireDetail(campId){
    var a=document.getElementById("opsAdvCamp"); if(a) a.onclick=function(){ api("set_campaign_status",{p_campaign:a.getAttribute("data-camp"),p_to:a.getAttribute("data-to"),p_reason:null}).then(function(r){ if(r.error){alert(r.error.message||r.error);} else openCampaignDetail(campId).then?openCampaignDetail(campId):openCampaignDetail(campId); }); };
    var add=document.getElementById("opsAddPart"); if(add) add.onclick=function(){ var id=val("opsInviteId"); if(!id){alert("Enter a creator identity ID");return;} api("add_campaign_participant",{p_campaign:add.getAttribute("data-camp"),p_identity:id,p_role:val("opsInviteRole")||null,p_match_result:null}).then(function(r){ if(r.error){alert(r.error.message||r.error);} else openCampaignDetail(campId); }); };
    document.querySelectorAll("#opsDetail [data-adv]").forEach(function(b){ b.onclick=function(){ var reason=null; api("advance_participation",{p_participation:b.getAttribute("data-adv"),p_to:b.getAttribute("data-to"),p_reason:reason}).then(function(r){ if(r.error){alert(r.error.message||r.error);} else openCampaignDetail(campId); }); }; });
    document.querySelectorAll("#opsDetail [data-approve]").forEach(function(b){ b.onclick=function(){ var dec=b.getAttribute("data-dec"); var reason=(dec!=='approved')?(prompt("Reason:")||""):null; if(dec!=='approved'&&!reason) return; api("approve_content",{p_submission:b.getAttribute("data-approve"),p_decision:dec,p_reason:reason}).then(function(r){ if(r.error){alert(r.error.message||r.error);} else openCampaignDetail(campId); }); }; });
    document.querySelectorAll("#opsDetail [data-ship]").forEach(function(b){ b.onclick=function(){ var prod=prompt("Product shipped:")||""; var courier=prompt("Courier (e.g. DTDC / Amazon):")||""; var trk=prompt("Tracking ref (optional):")||""; api("record_shipment",{p_participation:b.getAttribute("data-ship"),p_product:prod,p_courier:courier||null,p_tracking:trk||null}).then(function(r){ if(r.error){alert(r.error.message||r.error);} else openCampaignDetail(campId); }); }; });
    // funnel: eligibility screening
    document.querySelectorAll("#opsDetail [data-screen-ok]").forEach(function(b){ b.onclick=function(){ api("screen_participation",{p_participation:b.getAttribute("data-screen-ok"),p_eligible:true,p_reason:null}).then(function(r){ if(r.error){alert(r.error.message||r.error);} else openCampaignDetail(campId); }); }; });
    document.querySelectorAll("#opsDetail [data-screen-no]").forEach(function(b){ b.onclick=function(){ var reason=prompt("Why is this creator not eligible?")||""; if(!reason) return; api("screen_participation",{p_participation:b.getAttribute("data-screen-no"),p_eligible:false,p_reason:reason}).then(function(r){ if(r.error){alert(r.error.message||r.error);} else openCampaignDetail(campId); }); }; });
    // funnel: send shortlist to brand (bulk)
    var sb2=document.getElementById("opsSendBrand"); if(sb2) sb2.onclick=function(){ api("send_shortlist_to_brand",{p_campaign:sb2.getAttribute("data-camp")}).then(function(r){ if(r.error){alert(r.error.message||r.error);} else openCampaignDetail(campId); }); };
    // funnel: brand confirm/decline
    document.querySelectorAll("#opsDetail [data-brand-ok]").forEach(function(b){ b.onclick=function(){ api("brand_decide_participation",{p_participation:b.getAttribute("data-brand-ok"),p_confirm:true,p_reason:null}).then(function(r){ if(r.error){alert(r.error.message||r.error);} else openCampaignDetail(campId); }); }; });
    document.querySelectorAll("#opsDetail [data-brand-no]").forEach(function(b){ b.onclick=function(){ var reason=prompt("Reason for declining this creator:")||""; if(!reason) return; api("brand_decide_participation",{p_participation:b.getAttribute("data-brand-no"),p_confirm:false,p_reason:reason}).then(function(r){ if(r.error){alert(r.error.message||r.error);} else openCampaignDetail(campId); }); }; });
    // funnel: issue contract
    document.querySelectorAll("#opsDetail [data-issue]").forEach(function(b){ b.onclick=function(){ openIssueContractModal(b.getAttribute("data-issue"), campId); }; });
  }

  // ---- operator: issue a contract to a brand-confirmed creator ----
  function openIssueContractModal(part, campId){
    var fmts=(VOCAB&&VOCAB.content_formats)||[{key:"reel",label:"Reel"}];
    opsModal('<div class="ci-mh"><h3>Issue contract</h3><button class="wa-x" id="opsMx">×</button></div>'
      + '<label class="wa-f"><span>Deliverable</span><select id="opsIcFmt">'+fmts.map(function(f){return '<option value="'+esc(f.key)+'">'+esc(f.label)+'</option>';}).join("")+'</select></label>'
      + '<label class="wa-f"><span>Quantity</span><input id="opsIcQty" type="number" min="1" value="1"></label>'
      + '<label class="wa-f"><span>Product</span><input id="opsIcProduct" placeholder="e.g. pet bed"></label>'
      + '<label class="wa-f"><span>Ad rights (months)</span><input id="opsIcMonths" type="number" min="0" value="1"></label>'
      + '<label class="cp-check"><input type="checkbox" id="opsIcCollab"> Include collaboration/whitelisting rights</label>'
      + '<div class="cp-ob-actions"><button class="btn sm ghost" id="opsIcCancel">Cancel</button><button class="btn sm" id="opsIcSend">Issue contract</button></div>'
      + '<div class="ci-hint cp-err-inline" id="opsIcErr"></div>');
    document.getElementById("opsMx").onclick=closeModal; document.getElementById("opsIcCancel").onclick=closeModal;
    document.getElementById("opsIcSend").onclick=function(){
      var err=document.getElementById("opsIcErr"); err.textContent="";
      var qty=parseInt(document.getElementById("opsIcQty").value,10)||1;
      var payload={ deliverables:[{format:document.getElementById("opsIcFmt").value, quantity:qty}],
        product:(document.getElementById("opsIcProduct").value||"").trim()||null,
        ad_rights_months:parseInt(document.getElementById("opsIcMonths").value,10),
        collab_rights:document.getElementById("opsIcCollab").checked };
      var btn=this; btn.disabled=true; btn.textContent="Issuing…";
      api("send_contract",{p_participation:part,p_payload:payload}).then(function(r){
        if(r.error){ err.textContent=r.error.message||r.error; btn.disabled=false; btn.textContent="Issue contract"; return; }
        closeModal(); openCampaignDetail(campId);
      });
    };
  }

  /* ============================ 2. CREATOR "MY CAMPAIGNS" ============================ */
  window.renderMyCampaigns=function(){
    if(!enabled) return '<div class="card"><h3>My Campaigns</h3><div class="muted">This feature isn\'t enabled for your account yet.</div></div>';
    return '<div id="opsMine" class="ci"><div class="card ci-intro"><h3>My Campaigns</h3><div class="muted">Campaigns you\'ve been invited to. Accept, upload your content and track status here — no WhatsApp needed.</div></div>'
      + '<div id="opsMineBody"><div class="card"><div class="muted">Loading…</div></div></div></div>';
  };
  async function loadMyCampaigns(){
    try{ var r=await api("get_my_campaigns"); if(r.error) throw r.error; renderMine(r.data||[]); }
    catch(e){ document.getElementById("opsMineBody").innerHTML='<div class="card ci-err-inline">Couldn\'t load: '+esc(e.message||e)+'</div>'; }
  }
  function mineGroup(stage){
    if(['shortlisted','invited','applied','eligible','sent_to_brand'].indexOf(stage)>=0) return 'Upcoming';
    if(['completed','rejected','dropped','ineligible','brand_declined'].indexOf(stage)>=0) return 'Completed';
    return 'Active';
  }
  function renderMine(list){
    if(!list.length){ document.getElementById("opsMineBody").innerHTML='<div class="card"><div class="muted">No campaigns yet. When the Geek team invites you, they\'ll appear here.</div></div>'; return; }
    var groups={Upcoming:[],Active:[],Completed:[]}; list.forEach(function(c){ groups[mineGroup(c.stage)].push(c); });
    var html=Object.keys(groups).map(function(g){ if(!groups[g].length) return ''; return '<div class="ci-sub">'+g+'</div>'+groups[g].map(cardMine).join(""); }).join("");
    document.getElementById("opsMineBody").innerHTML=html;
    wireMine();
  }
  function cardMine(c){
    var dl=(c.deliverables||[]);
    var acts='';
    if(c.stage==='invited') acts='<button class="btn sm" data-accept="'+c.participation_id+'">Accept</button><button class="btn sm ghost" data-reject="'+c.participation_id+'">Reject</button>';
    else if(c.stage==='contract_sent') acts='<button class="btn sm" data-contract="'+c.participation_id+'">Review &amp; sign contract</button>';
    else if(c.stage==='contract_signed') acts='<button class="btn sm" data-address="'+c.participation_id+'">Confirm delivery address</button>';
    else if(c.stage==='content_approved') acts='<button class="btn sm" data-post="'+c.participation_id+'">Post from the app</button>';
    else if(['product_sent','content_created','changes_requested'].indexOf(c.stage)>=0 && dl.length) acts='<button class="btn sm" data-upload="'+(dl[0].deliverable_id)+'">Upload content link</button>';
    return '<div class="card ci-match"><div class="ci-mh"><h4>'+esc(c.campaign||"Campaign")+' <span class="ci-id">'+esc(c.brand||"")+'</span></h4>'+spill(c.stage)+'</div>'
      + '<div class="ci-meta"><span>Product: <b>'+esc(c.product||"—")+'</b></span><span>Comp: <b>'+esc(c.comp_type||"—")+'</b></span><span>Deadline: <b>'+fmtDate(c.deadline)+'</b></span></div>'
      + '<div class="ci-hint">Deliverables: '+(dl.length?dl.map(function(x){return esc(vlabel("content_formats",x.format))+' ×'+esc(x.quantity||1)+' ['+esc(x.status)+']';}).join(", "):'—')+'</div>'
      + (c.reason?'<div class="ci-hint">Note: '+esc(c.reason)+'</div>':'')
      + (acts?'<div class="ci-evrow">'+acts+'</div>':'')
      + (c.stage==='completed'? creatorCampaignFeedback(c.campaign_id):'')
      + '</div>';
  }
  function wireMine(){
    document.querySelectorAll("#opsMine [data-accept]").forEach(function(b){ b.onclick=function(){ api("respond_to_campaign",{p_participation:b.getAttribute("data-accept"),p_accept:true,p_reason:null}).then(function(r){ if(r.error) alert(r.error.message||r.error); loadMyCampaigns(); }); }; });
    document.querySelectorAll("#opsMine [data-reject]").forEach(function(b){ b.onclick=function(){ var reason=prompt("Reason for declining:")||""; if(!reason) return; api("respond_to_campaign",{p_participation:b.getAttribute("data-reject"),p_accept:false,p_reason:reason}).then(function(r){ if(r.error) alert(r.error.message||r.error); loadMyCampaigns(); }); }; });
    document.querySelectorAll("#opsMine [data-upload]").forEach(function(b){ b.onclick=function(){ var url=prompt("Paste your content link (e.g. Instagram post URL):")||""; if(!url) return; var note=prompt("Note / question for the Geek team (optional):")||""; api("submit_content",{p_deliverable:b.getAttribute("data-upload"),p_content_url:url,p_note:note}).then(function(r){ if(r.error) alert(r.error.message||r.error); loadMyCampaigns(); }); }; });
    document.querySelectorAll("#opsMine [data-contract]").forEach(function(b){ b.onclick=function(){ openContractModal(b.getAttribute("data-contract")); }; });
    document.querySelectorAll("#opsMine [data-address]").forEach(function(b){ b.onclick=function(){ openAddressModal(b.getAttribute("data-address")); }; });
    document.querySelectorAll("#opsMine [data-post]").forEach(function(b){ b.onclick=function(){ if(typeof currentPage!=="undefined"){ currentPage="mediakit"; } if(typeof renderShell==="function") renderShell(); }; });
  }

  // ---- creator: review + sign contract ----
  async function openContractModal(part){
    var ov=opsModal('<div class="ci-mh"><h3>Your contract</h3><button class="wa-x" id="opsMx">×</button></div><div id="opsCtBody"><div class="muted">Loading…</div></div>');
    document.getElementById("opsMx").onclick=closeModal;
    try{
      var r=await api("get_my_contract",{p_participation:part}); if(r.error) throw r.error; var k=r.data;
      if(!k){ document.getElementById("opsCtBody").innerHTML='<div class="ci-err-inline">No contract has been issued yet.</div>'; return; }
      var dl=(k.deliverables||[]);
      document.getElementById("opsCtBody").innerHTML=''
        + '<div class="ci-meta"><span>Product: <b>'+esc(k.product||"—")+'</b></span><span>Ad rights: <b>'+esc(k.ad_rights_months||1)+' month(s)</b></span>'
        + '<span>Until: <b>'+fmtDate(k.ad_rights_until)+'</b></span><span>Collab rights: <b>'+(k.collab_rights?"Yes":"No")+'</b></span></div>'
        + '<div class="ci-hint" style="margin-top:8px">Deliverables: '+(dl.length?dl.map(function(x){return esc((x.format||x.content_format||"content"))+' ×'+esc(x.quantity||1);}).join(", "):'—')+'</div>'
        + '<label class="cp-check" style="margin-top:12px"><input type="checkbox" id="opsAsci"> I have read and will follow the <b>ASCI</b> influencer-advertising guidelines, and I agree to the ad rights ('+esc(k.ad_rights_months||1)+' month) and deliverables above.</label>'
        + '<label class="wa-f"><span>Type your full name to sign</span><input id="opsSig" placeholder="e.g. Asha Kumar"></label>'
        + '<div class="cp-ob-actions"><button class="btn sm ghost" id="opsCtCancel">Cancel</button><button class="btn sm" id="opsCtSign">Sign contract</button></div>'
        + '<div class="ci-hint cp-err-inline" id="opsCtErr"></div>';
      document.getElementById("opsCtCancel").onclick=closeModal;
      document.getElementById("opsCtSign").onclick=function(){
        var err=document.getElementById("opsCtErr"); err.textContent="";
        var asci=document.getElementById("opsAsci").checked; var sig=(document.getElementById("opsSig").value||"").trim();
        if(!asci){ err.textContent="Please acknowledge the ASCI guidelines to sign."; return; }
        if(!sig){ err.textContent="Please type your name to sign."; return; }
        var btn=this; btn.disabled=true; btn.textContent="Signing…";
        api("sign_contract",{p_participation:part,p_signature_name:sig,p_asci_ack:true}).then(function(r2){
          if(r2.error){ err.textContent=r2.error.message||r2.error; btn.disabled=false; btn.textContent="Sign contract"; return; }
          closeModal(); loadMyCampaigns(); updateAlertsBadge();
        });
      };
    }catch(e){ var bd=document.getElementById("opsCtBody"); if(bd) bd.innerHTML='<div class="ci-err-inline">Couldn\'t load the contract: '+esc(e.message||e)+'</div>'; }
  }

  // ---- creator: confirm delivery address (choose from saved addresses) ----
  async function openAddressModal(part){
    var ov=opsModal('<div class="ci-mh"><h3>Confirm delivery address</h3><button class="wa-x" id="opsMx">×</button></div><div id="opsAdBody"><div class="muted">Loading your addresses…</div></div>');
    document.getElementById("opsMx").onclick=closeModal;
    try{
      var r=await api("get_my_profile"); var prof=(r && !r.error)?r.data:null; var addrs=(prof&&prof.addresses)||[];
      var body=document.getElementById("opsAdBody");
      if(!addrs.length){ body.innerHTML='<div class="ci-hint">You have no saved addresses yet. Add one in your profile, then come back.</div>'
        + '<div class="cp-ob-actions"><button class="btn sm ghost" id="opsAdCancel">Close</button><button class="btn sm" id="opsAdProfile">Go to profile</button></div>';
        document.getElementById("opsAdCancel").onclick=closeModal;
        document.getElementById("opsAdProfile").onclick=function(){ closeModal(); if(typeof currentPage!=="undefined"){ currentPage="profile"; } if(typeof renderShell==="function") renderShell(); };
        return;
      }
      body.innerHTML='<div class="wa-f"><span>Ship my product to</span><select id="opsAddrSel">'+addrs.map(function(a){
          var label=[a.line1,a.city,a.postal_code].filter(Boolean).join(", ")||"Address";
          return '<option value="'+esc(a.address_id)+'">'+esc(label)+'</option>';
        }).join("")+'</select></div>'
        + '<div class="cp-ob-actions"><button class="btn sm ghost" id="opsAdCancel">Cancel</button><button class="btn sm" id="opsAdSave">Confirm address</button></div>'
        + '<div class="ci-hint cp-err-inline" id="opsAdErr"></div>';
      document.getElementById("opsAdCancel").onclick=closeModal;
      document.getElementById("opsAdSave").onclick=function(){
        var err=document.getElementById("opsAdErr"); err.textContent=""; var aid=document.getElementById("opsAddrSel").value;
        var btn=this; btn.disabled=true; btn.textContent="Confirming…";
        api("confirm_campaign_address",{p_participation:part,p_address_id:aid}).then(function(r2){
          if(r2.error){ err.textContent=r2.error.message||r2.error; btn.disabled=false; btn.textContent="Confirm address"; return; }
          closeModal(); loadMyCampaigns(); updateAlertsBadge();
        });
      };
    }catch(e){ var bd=document.getElementById("opsAdBody"); if(bd) bd.innerHTML='<div class="ci-err-inline">Couldn\'t load addresses: '+esc(e.message||e)+'</div>'; }
    document.querySelectorAll("#opsMine [data-fb]").forEach(function(b){ b.onclick=function(){ submitCampFeedback('creator', b.getAttribute("data-fb"), {
      brief_clear: fv(b,"fbClear"), execution_smooth: fv(b,"fbSmooth"), participate_again: fv(b,"fbAgain") }, b); }; });
  }
  function creatorCampaignFeedback(campId){
    return '<div class="ops-fb"><div class="ci-sub">Quick feedback</div>'
      + fbSel("Was the brief clear?","fbClear") + fbSel("Was execution smooth?","fbSmooth") + fbSel("Would you participate again?","fbAgain")
      + '<button class="btn sm" data-fb="'+esc(campId)+'">Submit feedback</button><span class="ci-hint fb-msg"></span></div>';
  }

  /* ============================ 3. CREATOR ONBOARDING FUNNEL ============================ */
  window.renderOnboarding=function(){
    if(!enabled) return '<div class="card"><h3>Get campaign-ready</h3><div class="muted">This feature isn\'t enabled for your account yet.</div></div>';
    return '<div id="opsOnb" class="ci"><div class="card ci-intro"><h3>Get campaign-ready</h3><div class="muted">Complete these to be eligible for barter campaigns. Nothing here is a score — it just tracks what\'s done.</div></div>'
      + '<div id="opsOnbBody"><div class="card"><div class="muted">Loading…</div></div></div></div>';
  };
  async function loadOnboarding(){
    try{
      var rr=await Promise.all([ api("get_my_onboarding_status"), api("get_my_profile").catch(function(){return{data:null};}) ]);
      renderOnb(rr[0].data||{}, (rr[1]&&!rr[1].error?rr[1].data:null));
    }catch(e){ document.getElementById("opsOnbBody").innerHTML='<div class="card ci-err-inline">Couldn\'t load: '+esc(e.message||e)+'</div>'; }
  }
  function renderOnb(s, prof){
    var pro=(prof&&prof.professional)||{}, brands=((prof&&prof.brand_experience)||[]).filter(function(b){return !b.creator_rejected_at;});
    var checks=[
      ["Instagram connected", !!s.instagram_connected],
      ["Profile complete", !!s.basic_complete],
      ["Categories added", (pro.categories||[]).length>0],
      ["Languages added", (pro.languages||[]).length>0],
      ["Location added", !!(pro.city_coarse||pro.state_coarse)],
      ["Brands added", brands.length>0],
      ["Barter preference", !!s.barter_declared],
      ["Rate card", !!s.rate_card_present]
    ];
    var FUNNEL=[["STARTED",true],["PROFILE COMPLETE",!!s.basic_complete],["CAMPAIGN READY",s.status==='campaign_ready']];
    var funnel='<div class="ops-funnel">'+FUNNEL.map(function(f){ return '<div class="ops-fstep '+(f[1]?"on":"")+'">'+(f[1]?"✓":"○")+' '+esc(f[0])+'</div>'; }).join('<span class="ops-farrow">→</span>')+'</div>';
    var pct=(s.profile_pct!=null?s.profile_pct:0);
    var body='<div class="card"><div class="ci-mh"><h4>Status: '+esc((s.status||"started").replace(/_/g," "))+'</h4><span class="ci-pill '+(s.status==='campaign_ready'?'ci-ok':'ci-warn')+'">'+(pct)+'% profile</span></div>'
      + funnel
      + '<div class="ops-checks">'+checks.map(function(c){ return '<div class="ops-check '+(c[1]?"on":"")+'">'+(c[1]?"✓":"○")+' '+esc(c[0])+'</div>'; }).join("")+'</div>'
      + '<div class="ci-note">'+(s.status==='campaign_ready'?'You\'re campaign-ready. Invitations will appear under “My Campaigns”.':'Finish the unchecked items in your Creator Profile to become campaign-ready.')+'</div></div>';
    document.getElementById("opsOnbBody").innerHTML=body;
  }

  /* ============================ 4. BRAND SETUP (create campaign brief) ============================ */
  window.renderBrandSetup=function(){
    if(!enabled) return '<div class="card"><h3>Brand Setup</h3><div class="muted">This feature isn\'t enabled for your account yet.</div></div>';
    if(!isOperator) return '<div class="card"><h3>Brand Setup</h3><div class="muted">Campaign setup is an internal agency function for the pilot.</div></div>';
    return '<div id="opsBrand" class="ci"><div class="card ci-intro"><h3>Brand Setup &amp; campaign brief</h3><div class="muted">Create a brand\'s campaign brief internally. It becomes a campaign in the operations pipeline.</div></div>'
      + '<div id="opsBrandForm"></div><div id="opsBrandMsg" class="ci-hint"></div></div>';
  };
  function loadBrandSetup(){
    var box=document.getElementById("opsBrandForm"); if(!box) return;
    box.innerHTML='<div class="card"><h4>Company &amp; contact</h4><div class="ci-grid">'
      + f("Company","cfBrand","e.g. PetCo India") + f("Category","cfCategory","e.g. pets")
      + f("Website","cfSite","https://…") + f("Contact person","cfContact","name / email")
      + '</div></div>' + campaignForm("opsBrandCreate");
    document.getElementById("opsBrandCreate").onclick=function(){
      // fold company/site/contact into the brief requirements (persisted; no separate RPC invented)
      var extra={ company:val("cfBrand"), website:val("cfSite"), contact:val("cfContact") };
      submitCampaignWith(extra, function(){ document.getElementById("opsBrandMsg").textContent="Campaign brief created ✓ — open Campaign Operations to run it."; document.getElementById("opsBrandForm").innerHTML=""; });
    };
  }
  async function submitCampaignWith(extra, done){
    var p={ name:val("cfName"), submitted_brand_name:val("cfBrand")||null, objective:val("cfObj")||null,
      product:val("cfProduct")||null, category:val("cfCategory")||null, cities:csv("cfCities"), languages:csv("cfLangs"),
      comp_type:val("cfComp")||null, budget:val("cfBudget")||null, starts_on:val("cfStart")||null, ends_on:val("cfEnd")||null,
      requirements:{ category: val("cfCategory")?[val("cfCategory")]:[], location: csv("cfCities"), company: extra } };
    if(!p.name){ alert("Campaign name is required"); return; }
    try{ var r=await api("create_campaign",{p:p}); if(r.error) throw r.error; if(done) done(); }
    catch(e){ alert("Couldn't create: "+(e.message||e)); }
  }

  /* ---------- shared feedback (reuses submit_pilot_feedback with campaign_id via answers) ---------- */
  function fbSel(label,id){ return '<label class="ci-f"><span>'+esc(label)+'</span><select data-fbfield="'+id+'"><option value="">—</option><option>Yes</option><option>Somewhat</option><option>No</option></select></label>'; }
  function fv(scope,id){ var e=scope.parentNode.querySelector('[data-fbfield="'+id+'"]'); return e?e.value:""; }
  async function submitCampFeedback(role, campId, answers, btn){
    answers.campaign_id=campId;
    var msg=btn.parentNode.querySelector(".fb-msg"); if(msg) msg.textContent="Sending…";
    try{ var r=await api("submit_pilot_feedback",{p_role:role,p_answers:answers}); if(r.error) throw r.error; if(msg) msg.textContent="Thanks ✓"; }
    catch(e){ if(msg) msg.textContent="Couldn't submit: "+(e.message||e); }
  }

  window.ciOps={ boot:boot, loadAgencyOps:loadAgencyOps, loadMyCampaigns:loadMyCampaigns, loadOnboarding:loadOnboarding, loadBrandSetup:loadBrandSetup,
    loadAlerts:loadAlerts, updateAlertsBadge:updateAlertsBadge, openCampaignDetail:openCampaignDetail };

  var tries=0, t=setInterval(function(){ tries++;
    if(window.sb && window.Auth && Auth.profile){ clearInterval(t); boot(); }
    else if(tries>40) clearInterval(t);
  }, 800);
})();
