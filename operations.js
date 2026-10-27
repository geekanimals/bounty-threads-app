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
  function safeLink(u){ u=String(u||""); return /^https?:\/\//i.test(u)?u:"#"; }
  function campTypeLabel(t,st){ var T={barter:"Barter",paid:"Paid",barter_paid:"Barter + Paid"}, S={celebrity_story:"Story",normal_barter:"Normal barter",pr_package:"PR package"}; return (T[t]||t||"")+(st&&S[st]?" · "+S[st]:""); }
  // A creator who signed in with WhatsApp/email has no creator identity until the first profile action.
  // Create it once, on demand, then retry the call — instead of surfacing a 403 to the creator.
  var _idBoot=null;
  function isNoIdentity(err){ return !!err && /no creator identity|not a creator/i.test(err.message||String(err)); }
  function ensureIdentity(){
    if(!_idBoot) _idBoot=Promise.resolve(api("bootstrap_my_profile",{p_correlation:"ui-ops"})).then(function(r){ if(r.error){ _idBoot=null; throw r.error; } return true; });
    return _idBoot;
  }
  async function apiCreator(fn,args){
    var r=await api(fn,args);
    if(r && isNoIdentity(r.error)){ await ensureIdentity(); r=await api(fn,args); }
    return r;
  }
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

  var _bootP=null;
  function boot(){ if(!_bootP) _bootP=bootOnce(); return _bootP; }
  async function bootOnce(){
    try{
      if(!window.sb||!window.sb.schema){ enabled=false; }
      else { var r=await api("ops_vocab"); enabled=!!(r && !r.error && r.data); if(enabled) VOCAB=r.data; }
    }catch(e){ enabled=false; }
    if(enabled){ try{ var p=await api("get_campaign_pipeline",{p_filters:{}}); isOperator=!!(p && !p.error); }catch(e){ isOperator=false; } }
    window.__ciOpsEnabled=enabled; window.__ciOpsOperator=isOperator;
    if(enabled && window.__osBooted && typeof renderNav==="function") renderNav();
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
    if(route==="admin:approvals") route="approvals";   // signups live on the Approvals page
    if(route.indexOf("admin:")===0){ if(typeof _adminTab!=="undefined") _adminTab=route.slice(6); route="admin"; }
    if(typeof currentRole!=="undefined" && currentRole==="creator") route = ({onboarding:"profile", alerts:"dashboard", growth:"mycampaigns", barter:"opencampaigns", marketplace:"opencampaigns", campaignops:"mycampaigns", approvals:"mycampaigns"})[route] || route;
    else route = ({alerts:"dashboard", mycampaigns:"campaigns", opencampaigns:"campaigns"})[route] || route;
    var dr=document.getElementById("notifOverlay"); if(dr) dr.classList.remove("open");
    if(typeof currentPage!=="undefined"){ currentPage=route; }
    if(typeof renderShell==="function") renderShell();
    if(route==="campaignops" && n.campaign_id){ setTimeout(function(){ openCampaignDetail(n.campaign_id); },60); }
  }

  // the team (Super Admin / agency / brand) sees only what they must do; creators see their alerts
  function isTeam(){ return !!window.__isAdmin || (typeof currentRole!=="undefined" && currentRole!=="creator"); }
  var _todoTimer=null;
  async function updateAlertsBadge(){
    try{
      var n=0;
      if(isTeam()){
        var t=await api("admin_todo",{p_campaign:null});
        if(t && !t.error){ n=Number((t.data||{}).total)||0; window.__todo=t.data; }
        else { var r0=await api("get_my_notifications",{p_only_unread:true}); n=(r0 && !r0.error && Array.isArray(r0.data))?r0.data.length:0; }
        if(!_todoTimer) _todoTimer=setInterval(function(){ if(document.visibilityState==="visible") updateAlertsBadge(); }, 60000);
      } else {
        var r=await api("get_my_notifications",{p_only_unread:true});
        n=(r && !r.error && Array.isArray(r.data))?r.data.length:0;
      }
      window.__alertsUnread=n;
      var bell=document.getElementById("notifCount"); if(bell){ bell.textContent=n>9?"9+":String(n); bell.style.display=n>0?"":"none"; }
      var a=document.querySelector('#nav a[data-page="alerts"]'); if(!a) return;
      var b=a.querySelector(".ops-badge"); if(!b){ b=document.createElement("span"); b.className="ops-badge"; a.appendChild(b); }
      if(n>0){ b.textContent=n>9?"9+":String(n); b.style.display=""; } else { b.style.display="none"; }
    }catch(e){}
  }

  window.renderAlerts=function(){
    if(!enabled) return '<div class="card"><h3>Alerts</h3><div class="muted">This feature isn\'t enabled for your account yet.</div></div>';
    return '<div id="opsAlerts" class="ci"><div class="card ci-intro"><h3>🔔 All alerts</h3><div class="muted">Everything that needs you — the same updates we send on WhatsApp and email. Pick a campaign to see only its alerts.</div></div>'
      + '<div class="card al-filters">'
      +   '<label class="al-f"><span>Campaign</span><select id="alCamp"><option value="">All campaigns</option></select></label>'
      +   '<label class="al-f"><span>Show</span><select id="alStatus"><option value="all">All alerts</option><option value="unread">Unread</option><option value="action">Needs action</option></select></label>'
      +   '<label class="al-f al-grow"><span>Search</span><input id="alSearch" placeholder="Creator, step, campaign…"></label>'
      + '</div>'
      + '<div id="alCampChips" class="al-chips"></div>'
      + '<div id="alTodo"></div>'
      + '<div id="opsAlertsBody">'+(window.skel?skel("list",4):'<div class="card"><div class="muted">Loading…</div></div>')+'</div></div>';
  };
  var _al = { camp:"", status:"all", q:"", items:[], timer:null };
  async function loadAlerts(target){
    // the 🔔 drawer: latest alerts + a button to the full page
    if(target){
      var done=false;
      if(isTeam()){
        var hd=document.querySelector("#notifDrawer .drawer-head strong"); if(hd) hd.textContent="To do";
        var hm=document.querySelector("#notifDrawer .drawer-head .muted"); if(hm) hm.textContent="Only what needs you — do it right here";
        try{ var t=await api("admin_todo",{p_campaign:null}); if(t.error) throw t.error; renderTodo(t.data||{}, target, true); done=true; }catch(e0){ done=false; }
      }
      if(!done){
        try{ var r=await api("get_my_notifications",{p_only_unread:false}); if(r.error) throw r.error; renderAlertsList(r.data||[], target); }
        catch(e){ target.innerHTML='<div class="card ci-err-inline">Couldn\'t load alerts: '+esc(e.message||e)+'</div>'; }
      }
      var head=document.querySelector("#notifDrawer .drawer-head > div");
      if(head && !document.getElementById("notifAll")){
        var b=document.createElement("button"); b.id="notifAll"; b.className="mini-btn"; b.style.marginTop="6px"; b.textContent="View all alerts →";
        b.onclick=function(){ var ov=document.getElementById("notifOverlay"); if(ov) ov.classList.remove("open"); currentPage="alerts"; if(typeof renderShell==="function") renderShell(); window.scrollTo(0,0); };
        head.appendChild(b);
      }
      return;
    }
    return loadAlertsPage(false);
  }
  async function loadAlertsPage(more){
    var body=document.getElementById("opsAlertsBody"); if(!body) return;
    var cs=document.getElementById("alCamp"), ss=document.getElementById("alStatus"), qs=document.getElementById("alSearch");
    if(cs && !cs.__w){ cs.__w=1; cs.value=_al.camp; cs.onchange=function(){ _al.camp=cs.value; loadAlertsPage(false); }; }
    if(ss && !ss.__w){ ss.__w=1; ss.value=_al.status; ss.onchange=function(){ _al.status=ss.value; loadAlertsPage(false); }; }
    if(qs && !qs.__w){ qs.__w=1; qs.value=_al.q; qs.oninput=function(){ clearTimeout(_al.timer); _al.timer=setTimeout(function(){ _al.q=qs.value.trim(); loadAlertsPage(false); }, 350); }; }
    var last = more && _al.items.length ? _al.items[_al.items.length-1].created_at : null;
    var td=document.getElementById("alTodo");
    if(td && isTeam() && !more){
      api("admin_todo",{p_campaign:_al.camp||null}).then(function(t){ if(!t || t.error){ td.innerHTML=""; return; }
        var x=t.data||{}; td.innerHTML='<div class="card al-todo"><div class="al-todo-h"><h3>⚡ To do'+(Number(x.total)?' <span class="al-n">'+esc(x.total)+'</span>':'')+'</h3><span class="muted">Only what needs you — tap to do it</span></div><div id="alTodoList"></div></div>'
          + '<h3 class="al-hist">History</h3>';
        renderTodo(x, document.getElementById("alTodoList"), false); });
    }
    try{
      var r=await api("get_my_alerts_page",{ p_campaign:_al.camp||null, p_status:_al.status, p_search:_al.q||null, p_limit:100, p_before:last });
      if(r.error) throw r.error;
      var d=r.data||{};
      _al.items = more ? _al.items.concat(d.items||[]) : (d.items||[]);
      paintAlertCampaigns(d.campaigns||[]);
      paintAlertsPage(body, d);
    }catch(e){
      // older database (before the alerts page) → the simple list
      try{ var r2=await api("get_my_notifications",{p_only_unread:false}); if(r2.error) throw r2.error; renderAlertsList(r2.data||[], body); }
      catch(e2){ body.innerHTML='<div class="card ci-err-inline">Couldn\'t load alerts: '+esc(e.message||e)+'</div>'; }
    }
  }
  function paintAlertCampaigns(list){
    var cs=document.getElementById("alCamp"), chips=document.getElementById("alCampChips"); if(!cs) return;
    cs.innerHTML='<option value="">All campaigns ('+list.reduce(function(a,c){return a+Number(c.count||0);},0)+')</option>'
      + list.map(function(c){ return '<option value="'+esc(c.campaign_id)+'">'+esc(c.campaign)+(c.brand?' · '+esc(c.brand):'')+' ('+esc(c.count)+(Number(c.unread)?', '+esc(c.unread)+' new':'')+')</option>'; }).join("");
    cs.value=_al.camp;
    if(chips) chips.innerHTML=list.slice(0,12).map(function(c){
      return '<button class="al-chip'+(_al.camp===c.campaign_id?' on':'')+'" data-alc="'+esc(c.campaign_id)+'">'+esc(c.campaign)+(Number(c.unread)?' <b>'+esc(c.unread)+'</b>':'')+'</button>'; }).join("")
      + (_al.camp?'<button class="al-chip ghost" data-alc="">✕ All campaigns</button>':'');
    if(chips) chips.querySelectorAll("[data-alc]").forEach(function(b){ b.onclick=function(){ _al.camp = _al.camp===b.getAttribute("data-alc") ? "" : b.getAttribute("data-alc"); loadAlertsPage(false); }; });
  }
  function paintAlertsPage(body, d){
    var list=_al.items;
    if(!list.length){ body.innerHTML='<div class="card"><div class="muted">'+(_al.camp||_al.status!=="all"||_al.q?'No alerts match this filter.':'No alerts yet. When something needs you, it\'ll show here.')+'</div></div>'; return; }
    var day=function(t){ try{ return new Date(t).toLocaleDateString("en-IN",{weekday:"short",day:"numeric",month:"short",year:"numeric"}); }catch(e){ return ""; } };
    var html='', cur='';
    list.forEach(function(n){
      var dd=day(n.created_at); if(dd!==cur){ if(cur) html+='</div>'; cur=dd; html+='<div class="al-day">'+esc(dd)+'</div><div class="ops-alist">'; }
      var cls="ops-alert"+(n.read?"":" unread")+(n.kind==="action_required"&&!n.acted?" act":"");
      html+='<div class="'+cls+'" data-nid="'+esc(n.notification_id)+'">'
        + '<div class="ops-alert-h"><b>'+esc(n.title)+'</b><span class="ci-hint">'+fmtDT(n.created_at)+'</span></div>'
        + (n.campaign?'<div><span class="al-camp" data-alc="'+esc(n.campaign_id)+'">📣 '+esc(n.campaign)+(n.brand?' · '+esc(n.brand):'')+'</span>'+(n.kind==="action_required"?(n.acted?' <span class="ci-pill">done</span>':' <span class="ci-pill ci-warn">needs action</span>'):'')+'</div>':'')
        + '<div class="ci-hint">'+(typeof escMd==="function"?escMd(n.body):esc(n.body))+'</div>'
        + (n.action_route?'<div class="ci-evrow"><button class="btn sm" data-act="'+esc(n.notification_id)+'">'+esc(n.action_label||"Open")+'</button></div>':'')
        + '</div>';
    });
    if(cur) html+='</div>';
    body.innerHTML='<div style="display:flex;justify-content:space-between;align-items:center;margin:0 0 8px;gap:8px;flex-wrap:wrap"><span class="muted">'+esc(d.total||list.length)+' alert'+(Number(d.total)===1?'':'s')+(Number(d.unread)?' · '+esc(d.unread)+' unread':'')+'</span>'
      + (Number(d.unread)?'<button class="mini-btn ghost" id="alMarkAll">Mark '+(_al.camp?'this campaign':'all')+' read</button>':'')+'</div>'
      + '<div class="card">'+html+'</div>'
      + (d.more?'<div style="text-align:center;margin-top:10px"><button class="btn ghost sm" id="alMore">Load older alerts</button></div>':'');
    var ma=body.querySelector("#alMarkAll"); if(ma) ma.onclick=function(){ api("mark_alerts_read",{p_campaign:_al.camp||null}).then(function(){ updateAlertsBadge(); loadAlertsPage(false); }); };
    var mo=body.querySelector("#alMore"); if(mo) mo.onclick=function(){ mo.disabled=true; mo.textContent="Loading…"; loadAlertsPage(true); };
    body.querySelectorAll(".al-camp[data-alc]").forEach(function(c){ c.onclick=function(e){ e.stopPropagation(); _al.camp=c.getAttribute("data-alc"); loadAlertsPage(false); window.scrollTo(0,0); }; });
    body.querySelectorAll("[data-act]").forEach(function(btn){ btn.onclick=function(e){ e.stopPropagation();
      var n=findNotif(list, btn.getAttribute("data-act")); if(!n) return;
      api("mark_notification_acted",{p_id:n.notification_id}).then(function(){ updateAlertsBadge(); routeNotification(n); });
    }; });
    body.querySelectorAll(".ops-alert").forEach(function(row){ row.onclick=function(){
      var id=row.getAttribute("data-nid"); if(row.classList.contains("unread")){ api("mark_notification_read",{p_id:id}).then(function(){ row.classList.remove("unread"); updateAlertsBadge(); }); }
    }; });
  }
  function renderAlertsList(list, target){
    var body=target||document.getElementById("opsAlertsBody");
    if(!list.length){ body.innerHTML='<div class="card"><div class="muted">No alerts yet. When something needs you, it\'ll show here.</div></div>'; return; }
    var unread=list.filter(function(n){ return !n.read; }).length;
    body.innerHTML=(unread?'<div style="display:flex;justify-content:space-between;align-items:center;margin:0 0 8px"><span class="muted">'+unread+' unread</span><button class="mini-btn ghost" id="opsMarkAll">Mark all read</button></div>':'')
      + '<div class="card"><div class="ops-alist">'+list.map(function(n){
      var cls="ops-alert"+(n.read?"":" unread")+(n.kind==="action_required"?" act":"");
      return '<div class="'+cls+'" data-nid="'+esc(n.notification_id)+'">'
        + '<div class="ops-alert-h"><b>'+esc(n.title)+'</b><span class="ci-hint">'+fmtDT(n.created_at)+'</span></div>'
        + '<div class="ci-hint">'+(typeof escMd==="function"?escMd(n.body):esc(n.body))+'</div>'
        + (n.action_route?'<div class="ci-evrow"><button class="btn sm" data-act="'+esc(n.notification_id)+'">'+esc(n.action_label||"Open")+'</button></div>':'')
        + '</div>';
    }).join("")+'</div></div>';
    var ma=body.querySelector("#opsMarkAll"); if(ma) ma.onclick=function(){ api("mark_all_notifications_read").then(function(){ updateAlertsBadge(); loadAlerts(body); }); };
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
  // ---- the team's to-do list: each item has its action right on it, or opens that creator on that step ----
  var TODO_IC={ screen:"🔎", add_list:"📋", brand:"🏢", contract:"📜", unsigned:"✍️", ship:"🚚", deliver:"📦", review:"🎬", overdue:"⏰", blocked:"⛔",
                whatsapp:"💬", signup:"🏢", campaign_approval:"📣", delete_request:"🗑" };
  function todoActs(it){
    var P=esc(it.participation_id||""), b=function(k,l,primary){ return '<button class="btn sm'+(primary?'':' ghost')+'" data-td="'+k+'" data-tdk="'+esc(it.key)+'">'+l+'</button>'; };
    var open=it.participation_id ? b("open","Open creator →") : "";
    switch(it.kind){
      case "screen": return b("screen","✓ Meets the brief",1)+b("go:bpreject","Not a fit")+open;
      case "add_list": return b("add_list","📋 Add to the brand's list",1)+open;
      case "brand": return b("brand","✅ Brand confirmed",1)+b("go:bpbrandno","Brand passed")+open;
      case "contract": return b("contract","📜 Send contract now",1)+open;
      case "unsigned": return b("go:bpchat","💬 Remind on WhatsApp",1)+b("contract","🔁 Resend contract")+open;
      case "ship": return b("go:bpship","🚚 Add courier & tracking",1)+open;
      case "deliver": return b("deliver","📦 Mark delivered",1)+open;
      case "review": return (it.video_url?'<a class="btn sm ghost" href="'+esc(it.video_url)+'" target="_blank" rel="noopener">▶ Watch</a>':'')+b("approve","✅ Approve video",1)+b("go:bpchanges","✏️ Ask for changes")+open;
      case "overdue": return b("go:bpchat","💬 Message them",1)+(it.phone?'<a class="btn sm ghost" href="tel:'+esc(it.phone)+'">📞 Call</a>':'')+open;
      case "blocked": return (it.phone?'<a class="btn sm" href="tel:'+esc(it.phone)+'">📞 Call '+esc(it.phone)+'</a>':'')+b("go:bpunblock","✅ Called — unblock")+open;
      case "whatsapp": return b("wa","💬 Reply on WhatsApp",1);
      case "signup": return b("route","Review the account",1);
      case "campaign_approval": return b("camp","Open the campaign",1);
      case "delete_request": return b("route","Open delete requests",1);
    }
    return open;
  }
  function ago(t){ try{ var m=Math.round((Date.now()-new Date(t).getTime())/60000); if(m<60) return m+" min ago"; var h=Math.round(m/60); if(h<48) return h+" h ago"; return Math.round(h/24)+" days ago"; }catch(e){ return ""; } }
  function renderTodo(d, target, compact){
    if(!target) return;
    var L=(d.items||[]);
    if(!L.length){ target.innerHTML='<div class="'+(compact?'card':'')+' al-empty"><b>🎉 Nothing needs you right now.</b><div class="muted">New applications, videos to review, parcels to ship and WhatsApp chats waiting for a person show up here.</div></div>'
      + (compact?'<button class="mini-btn ghost" id="tdHist" style="margin-top:8px">See all alerts →</button>':''); }
    else target.innerHTML=(compact?'<div class="muted" style="margin:0 0 8px">'+L.length+' thing'+(L.length>1?'s':'')+' to do</div>':'')
      + '<div class="td-list">'+L.slice(0, compact?40:300).map(function(it){
        return '<div class="td-it td-'+esc(it.kind)+'" data-tdrow="'+esc(it.key)+'">'
          + (it.pic?'<img class="td-pic" src="'+esc(it.pic)+'" alt="" referrerpolicy="no-referrer" onerror="this.style.visibility=\'hidden\'">':'<span class="td-ic">'+(TODO_IC[it.kind]||"•")+'</span>')
          + '<div class="td-main"><div class="td-t"><b>'+esc(it.title)+'</b><span class="ci-hint">'+esc(ago(it.since))+'</span></div>'
          + (it.campaign?'<div class="td-c">📣 '+esc(it.campaign)+(it.brand?' · '+esc(it.brand):'')+'</div>':'')
          + (it.body?'<div class="ci-hint">'+esc(it.body)+'</div>':'')
          + '<div class="ci-evrow td-acts">'+todoActs(it)+'</div></div></div>'; }).join("")+'</div>';
    var h=target.querySelector("#tdHist"); if(h) h.onclick=function(){ var ov=document.getElementById("notifOverlay"); if(ov) ov.classList.remove("open"); currentPage="alerts"; if(typeof renderShell==="function") renderShell(); };
    var find=function(k){ for(var i=0;i<L.length;i++) if(L[i].key===k) return L[i]; return null; };
    var after=function(row, msg){ if(window.gateToast) gateToast(msg); if(row){ row.classList.add("td-done"); setTimeout(function(){ row.remove(); }, 600); } updateAlertsBadge();
      if(typeof loadBarterProcess==="function" && document.getElementById("bpBody")) loadBarterProcess(true); };
    target.querySelectorAll("[data-td]").forEach(function(btn){ btn.onclick=async function(e){ e.stopPropagation();
      var it=find(btn.getAttribute("data-tdk")); if(!it) return; var a=btn.getAttribute("data-td"), row=btn.closest(".td-it");
      var rpc=function(fn,args,msg){ btn.disabled=true; var t0=btn.textContent; btn.textContent="…";
        return api(fn,args).then(function(r){ if(r.error){ btn.disabled=false; btn.textContent=t0; if(window.gateToast) gateToast(r.error.message||String(r.error)); return; } after(row, msg); }); };
      if(a==="screen") return rpc("screen_participation",{p_participation:it.participation_id,p_eligible:true,p_reason:null},"Screened ✓ — next: add them to the brand's list");
      if(a==="add_list") return rpc("advance_participation",{p_participation:it.participation_id,p_to:"sent_to_brand",p_reason:"added to the brand's list"},"Added to the brand's list ✓");
      if(a==="brand") return rpc("brand_decide_participation",{p_participation:it.participation_id,p_confirm:true,p_reason:null},"Brand confirmed ✓ — the contract goes out");
      if(a==="contract") return rpc("bp_send_contract",{p_participation:it.participation_id},"Contract sent ✓");
      if(a==="deliver") return rpc("bp_mark_delivered",{p_participation:it.participation_id},"Marked delivered ✓ — video brief sent");
      if(a==="approve") return rpc("bp_review_video",{p_participation:it.participation_id,p_approve:true,p_reason:null},"Video approved ✓");
      if(a==="open") return window.goToCreatorAction && goToCreatorAction(it.open_id, it.participation_id, null);
      if(a.indexOf("go:")===0) return window.goToCreatorAction && goToCreatorAction(it.open_id, it.participation_id, a.slice(3));
      if(a==="wa"){ var ov=document.getElementById("notifOverlay"); if(ov) ov.classList.remove("open"); window.__waOpenPhone=it.phone; currentPage="messages"; if(typeof renderShell==="function") renderShell(); return; }
      if(a==="camp") return window.goToCreatorAction && goToCreatorAction(it.open_id, null, null);
      if(a==="route"){ routeNotification({ action_route: it.route||"admin:approvals" }); return; }
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
    // one campaign form everywhere (deliverables, hashtags, mentions, contract, brief, ideal profile)
    if(typeof window.openCampaignModal==="function"){ window.openCampaignModal(null); return; }
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
      else if(p.stage==='product_sent') acts='<button class="btn sm" data-deliver="'+p.participation_id+'">Mark delivered</button>'
        + '<button class="btn sm ghost" data-shipfail="'+p.participation_id+'">Mark failed</button>';
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
    var reportCard='<div class="card"><div class="ci-mh"><h4>Live brand report</h4><button class="btn sm ghost" id="opsReportBtn" data-camp="'+esc(c.campaign_id)+'">Refresh report</button></div><div id="opsReport"><div class="muted">Open to see the funnel, posts and 15-day performance.</div></div></div>';
    out.innerHTML=overview+creators+reportCard+activity;
    wireDetail(c.campaign_id);
  }

  // ---- live brand-campaign report (funnel + posts + 15-day metrics + checks) ----
  async function openReport(campId){
    var box=document.getElementById("opsReport"); if(!box) return;
    box.innerHTML='<div class="muted">Loading report…</div>';
    try{ var r=await api("get_campaign_report",{p_campaign:campId}); if(r.error) throw r.error; renderReport(r.data||{}); }
    catch(e){ box.innerHTML='<div class="ci-err-inline">Couldn\'t load report: '+esc(e.message||e)+'</div>'; }
  }
  function renderReport(d){
    var box=document.getElementById("opsReport"); var fn=d.funnel||{}, cr=d.creators||[];
    var funnelHtml='<div class="ops-funnel">'+["applied","eligible","sent_to_brand","brand_confirmed","contract_signed","address_confirmed","product_sent","content_submitted","published","completed"].map(function(s){
      var n=fn[s]||0; return '<span class="ops-fstep'+(n>0?" on":"")+'">'+esc((STAGE[s]?STAGE[s][0]:s))+': '+n+'</span>';
    }).join('<span class="ops-farrow">›</span>')+'</div>';
    var rows=cr.map(function(c){
      var posts=(c.posts||[]); var chk=(c.checks||[]);
      var pstr=posts.length?posts.map(function(p){
        var m=p.latest; var mstr=m?('reach '+(m.reach==null?"—":m.reach)+' · likes '+(m.likes==null?"—":m.likes)+' · views '+(m.views==null?"—":m.views)):'no metrics yet';
        return '<div class="ci-hint">'+esc(p.media_type)+(p.permalink?' · <a href="'+esc(p.permalink)+'" target="_blank" rel="noopener">link</a>':'')+' · '+esc(mstr)+'</div>';
      }).join(''):'<div class="ci-hint">No posts yet.</div>';
      var cstr=chk.length?chk.map(function(k){ return '<span class="ci-pill ci-'+(k.verdict==='pass'?'ok':k.verdict==='issues'?'warn':'na')+'">'+esc(k.kind)+': '+esc(k.verdict)+'</span>'; }).join(' '):'';
      return '<div class="ci-cardrow"><div class="ci-mh"><b>Creator '+esc(shortId(c.participation_id))+'</b>'+spill(c.stage)+'</div>'+pstr+(cstr?'<div class="ci-evrow">'+cstr+'</div>':'')+'</div>';
    }).join('');
    box.innerHTML=funnelHtml+(rows||'<div class="muted">No creators yet.</div>');
  }
  function wireDetail(campId){
    var a=document.getElementById("opsAdvCamp"); if(a) a.onclick=function(){ api("set_campaign_status",{p_campaign:a.getAttribute("data-camp"),p_to:a.getAttribute("data-to"),p_reason:null}).then(function(r){ if(r.error){alert(r.error.message||r.error);} else openCampaignDetail(campId).then?openCampaignDetail(campId):openCampaignDetail(campId); }); };
    var add=document.getElementById("opsAddPart"); if(add) add.onclick=function(){ var id=val("opsInviteId"); if(!id){alert("Enter a creator identity ID");return;} api("add_campaign_participant",{p_campaign:add.getAttribute("data-camp"),p_identity:id,p_role:val("opsInviteRole")||null,p_match_result:null}).then(function(r){ if(r.error){alert(r.error.message||r.error);} else openCampaignDetail(campId); }); };
    document.querySelectorAll("#opsDetail [data-adv]").forEach(function(b){ b.onclick=function(){ var reason=null; api("advance_participation",{p_participation:b.getAttribute("data-adv"),p_to:b.getAttribute("data-to"),p_reason:reason}).then(function(r){ if(r.error){alert(r.error.message||r.error);} else openCampaignDetail(campId); }); }; });
    document.querySelectorAll("#opsDetail [data-approve]").forEach(function(b){ b.onclick=function(){ var dec=b.getAttribute("data-dec"); var reason=(dec!=='approved')?(prompt("Reason:")||""):null; if(dec!=='approved'&&!reason) return; api("approve_content",{p_submission:b.getAttribute("data-approve"),p_decision:dec,p_reason:reason}).then(function(r){ if(r.error){alert(r.error.message||r.error);} else openCampaignDetail(campId); }); }; });
    document.querySelectorAll("#opsDetail [data-ship]").forEach(function(b){ b.onclick=function(){ var prod=prompt("Product shipped:")||""; var courier=prompt("Courier (e.g. DTDC / Amazon):")||""; var trk=prompt("Tracking ref (optional):")||""; api("record_shipment",{p_participation:b.getAttribute("data-ship"),p_product:prod,p_courier:courier||null,p_tracking:trk||null}).then(function(r){ if(r.error){alert(r.error.message||r.error);} else openCampaignDetail(campId); }); }; });
    // funnel: eligibility screening
    document.querySelectorAll("#opsDetail [data-screen-ok]").forEach(function(b){ b.onclick=function(){ api("screen_participation",{p_participation:b.getAttribute("data-screen-ok"),p_eligible:true,p_reason:null}).then(function(r){ if(r.error){alert(r.error.message||r.error);} else openCampaignDetail(campId); }); }; });
    document.querySelectorAll("#opsDetail [data-screen-no]").forEach(function(b){ b.onclick=async function(){
      var pick = window.openReasonModal ? await window.openReasonModal("Why is this creator not eligible?") : null; if(!pick) return;
      api("screen_participation_v2",{p_participation:b.getAttribute("data-screen-no"),p_eligible:false,p_reason_code:pick.code,p_note:pick.note||null}).then(function(r){ if(r.error){alert(r.error.message||r.error);} else openCampaignDetail(campId); }); }; });
    // funnel: send shortlist to brand (bulk)
    var sb2=document.getElementById("opsSendBrand"); if(sb2) sb2.onclick=function(){ api("send_shortlist_to_brand",{p_campaign:sb2.getAttribute("data-camp")}).then(function(r){ if(r.error){alert(r.error.message||r.error);} else openCampaignDetail(campId); }); };
    // funnel: brand confirm/decline
    document.querySelectorAll("#opsDetail [data-brand-ok]").forEach(function(b){ b.onclick=function(){ api("brand_decide_participation",{p_participation:b.getAttribute("data-brand-ok"),p_confirm:true,p_reason:null}).then(function(r){ if(r.error){alert(r.error.message||r.error);} else openCampaignDetail(campId); }); }; });
    document.querySelectorAll("#opsDetail [data-brand-no]").forEach(function(b){ b.onclick=async function(){ var pk = window.openReasonModal ? await window.openReasonModal("The brand passed — tell the creator why") : null; var reason = pk ? pk.message : (prompt("Reason for declining this creator (sent to them):")||""); if(!reason) return; api("brand_decide_participation",{p_participation:b.getAttribute("data-brand-no"),p_confirm:false,p_reason:reason}).then(function(r){ if(r.error){alert(r.error.message||r.error);} else openCampaignDetail(campId); }); }; });
    // funnel: issue contract
    document.querySelectorAll("#opsDetail [data-issue]").forEach(function(b){ b.onclick=function(){ openIssueContractModal(b.getAttribute("data-issue"), campId); }; });
    // phase 4: manual delivery status
    document.querySelectorAll("#opsDetail [data-deliver]").forEach(function(b){ b.onclick=function(){ api("mark_shipment_status_by_participation",{p_participation:b.getAttribute("data-deliver"),p_status:"delivered"}).then(function(r){ if(r.error){alert(r.error.message||r.error);} else openCampaignDetail(campId); }); }; });
    document.querySelectorAll("#opsDetail [data-shipfail]").forEach(function(b){ b.onclick=function(){ if(!confirm("Mark this shipment as failed/returned?")) return; api("mark_shipment_status_by_participation",{p_participation:b.getAttribute("data-shipfail"),p_status:"failed"}).then(function(r){ if(r.error){alert(r.error.message||r.error);} else openCampaignDetail(campId); }); }; });
    // phase 6: live report
    var rb=document.getElementById("opsReportBtn"); if(rb) rb.onclick=function(){ openReport(rb.getAttribute("data-camp")); };
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
  // Paid / Barter split: "Campaigns" page has All · Paid · Barter filters; the creator "Barter" page is the same
  // view locked to barter (Barter + Paid shows under both). Apply works the same everywhere.
  var CAMP_FILTER="all", CAMP_PAGE=1, PAGE_SIZE=9, _openCache=[], _mineCache=[];
  var PENDING_ST=["applied","eligible","sent_to_brand","shortlisted","invited"], DECL_ST=["ineligible","brand_declined","dropped","rejected"];
  function kindOf(c){ return c.campaign_type || ({cash:"paid",hybrid:"barter_paid",barter:"barter"})[c.comp_type] || ""; }
  function isCeleb(c){ return c.barter_subtype==="celebrity_story"; }
  function matchFilter(c){ var t=kindOf(c);
    if(CAMP_FILTER==="paid") return t==="paid"||t==="barter_paid";
    if(CAMP_FILTER==="barter") return (t==="barter"||t==="barter_paid") && !isCeleb(c);
    if(CAMP_FILTER==="celebrity") return isCeleb(c);
    if(CAMP_FILTER==="applied") return !!c.my_stage && PENDING_ST.indexOf(c.my_stage)>=0;
    if(CAMP_FILTER==="approved") return !!c.my_stage && PENDING_ST.indexOf(c.my_stage)<0 && DECL_ST.indexOf(c.my_stage)<0;
    return true; }
  function typeBadge(c){ var t=kindOf(c), L={paid:"💰 Paid",barter:"🎁 Barter",barter_paid:"🎁 Barter + 💰 Paid"};
    return (isCeleb(c)?'<span class="ci-type ci-type-barter_paid">⭐ Story</span> ':'')+(t?'<span class="ci-type ci-type-'+t+'">'+L[t]+'</span>':'<span class="ci-type">—</span>'); }
  var CHIPS=[["all","All"],["paid","💰 Paid"],["barter","🎁 Barter"],["celebrity","⭐ Story"],["applied","⏳ Applied"],["approved","✅ Approved"]];
  function chipsHtml(){
    var n=function(f){ var keep=CAMP_FILTER; CAMP_FILTER=f; var k=_openCache.filter(matchFilter).length; CAMP_FILTER=keep; return k; };
    return CHIPS.map(function(x){ return '<button class="ci-chip'+(CAMP_FILTER===x[0]?' on':'')+'" data-campf="'+x[0]+'">'+x[1]+(_openCache.length?' <span>'+n(x[0])+'</span>':'')+'</button>'; }).join("");
  }
  function paintChips(){ var el=document.getElementById("campChips"); if(!el) return; el.innerHTML=chipsHtml();
    el.querySelectorAll("[data-campf]").forEach(function(b){ b.onclick=function(){ CAMP_FILTER=b.getAttribute("data-campf"); CAMP_PAGE=1; paintChips(); renderOpen(_openCache); }; }); }
  (function(){ if(document.getElementById("ciTypeCss")) return; var st=document.createElement("style"); st.id="ciTypeCss";
    st.textContent='.ci-chips{display:flex;gap:8px;flex-wrap:wrap;margin:4px 0 14px}.ci-chip{border:1px solid var(--line,#ddd);background:var(--panel,#fff);border-radius:999px;padding:7px 14px;font-weight:600;cursor:pointer;color:inherit}'
      +'.ci-chip.on{background:var(--brand,#6c5ce7);color:#fff;border-color:transparent}.ci-chip span{opacity:.7;font-weight:500;margin-left:4px}'
      +'.ci-type{font-size:12px;font-weight:700;padding:2px 9px;border-radius:999px;background:rgba(0,0,0,.06)}.ci-type-paid{background:rgba(16,185,129,.14);color:#047857}'
      +'.ci-type-barter{background:rgba(245,158,11,.16);color:#b45309}.ci-type-barter_paid{background:rgba(108,92,231,.14);color:#5b4bd6}'
      +'.ci-pager{display:flex;gap:6px;align-items:center;justify-content:center;margin:14px 0}.ci-pager button{min-width:36px}';
    document.head.appendChild(st); })();
  // Campaigns (browse): every open campaign — filter by Paid / Barter / Celebrity story / Applied / Approved, 9 per page
  window.renderOpenCampaigns=function(preset){
    if(preset) { CAMP_FILTER=preset; CAMP_PAGE=1; }
    if(!enabled) return '<div class="card"><h3>Campaigns</h3><div class="muted">This feature isn\'t enabled for your account yet.</div></div>';
    return '<div id="opsMine" class="ci"><div class="card ci-intro"><h3>Campaigns</h3><div class="muted">Paid, barter and celebrity-story campaigns open for you. Apply in one tap — track everything in My Campaigns.</div></div>'
      + '<div class="ci-chips" id="campChips">'+chipsHtml()+'</div>'
      + '<div id="opsOpenBody">'+(window.skel?skel("cards",6):'<div class="card"><div class="muted">Loading…</div></div>')+'</div><div id="opsOpenPager" class="ci-pager"></div></div>';
  };
  // My Campaigns: running, applied and history — with every next step (contract, address, content, posting) — then growth
  window.renderMyCampaigns=function(){
    if(!enabled) return '<div class="card"><h3>My Campaigns</h3><div class="muted">This feature isn\'t enabled for your account yet.</div></div>';
    return '<div id="opsMine" class="ci"><div class="card ci-intro"><h3>My Campaigns</h3><div class="muted">Everything you applied to — what\'s running now, what\'s waiting, and your full campaign history.</div></div>'
      + '<div id="opsMineStats">'+(window.skel?skel("stats",4):'<div class="card"><div class="muted">Loading…</div></div>')+'</div><div id="opsMineBody">'+(window.skel?skel("list",3):'<div class="card"><div class="muted">Loading…</div></div>')+'</div>'
      + '<div class="ci-sub" style="margin-top:18px">🚀 Your growth</div><div id="growthBody">'+(window.skel?skel("list",2):'<div class="card"><div class="muted">Loading…</div></div>')+'</div></div>';
  };
  var _mineSig="", _mineTimer=null;
  async function loadMyCampaigns(silent){
    if(!silent){
      loadOpenCampaigns();
      if(document.getElementById("growthBody") && typeof loadGrowth==="function") loadGrowth();
      _mineSig="";
      // live: re-read every 30 s, redraw only when something changed (cards keep their place)
      clearInterval(_mineTimer);
      _mineTimer=setInterval(function(){
        if(!document.getElementById("opsMineBody")){ clearInterval(_mineTimer); return; }
        if(document.visibilityState!=="visible" || document.getElementById("opsModal")) return;
        var a=document.activeElement; if(a && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) return;
        loadMyCampaigns(true);
      }, 20000);
    }
    try{ var r=await apiCreator("get_my_campaigns"); if(r.error) throw r.error;
      // the campaign type rules (no product on a paid campaign) + MY payment on paid campaigns
      var fl=await apiCreator("my_campaign_flows").then(function(x){ return x; }, function(){ return { data:null }; });
      var flows=(fl && !fl.error && fl.data) || {};
      (r.data||[]).forEach(function(c){ c._flow=flows[c.participation_id]||null; });
      var sig=JSON.stringify(r.data||[]); if(silent && sig===_mineSig) return; _mineSig=sig;
      await igMediaMap(); renderMine(r.data||[]); }
    catch(e){ if(silent) return; var el=document.getElementById("opsMineBody"); if(el) el.innerHTML='<div class="card ci-err-inline">Couldn\'t load: '+esc((e&&e.message)||e)+'</div>'; }
  }

  /* ---- creator: browse open campaigns + apply (application-first funnel entry) ---- */
  async function loadOpenCampaigns(){
    var el=document.getElementById("opsOpenBody"); if(!el) return;
    try{ var r=await api("list_open_campaigns"); if(r.error) throw r.error; renderOpen(r.data||[]); }
    catch(e){ el.innerHTML='<div class="card ci-err-inline">Couldn\'t load open campaigns: '+esc((e&&e.message)||e)+'</div>'; }
  }
  function renderOpen(all){
    var el=document.getElementById("opsOpenBody"); if(!el) return;
    _openCache=all||[]; paintChips(); setTimeout(applyHandoff, 60);
    var full=_openCache.filter(matchFilter), pages=Math.max(1,Math.ceil(full.length/PAGE_SIZE));
    if(CAMP_PAGE>pages) CAMP_PAGE=pages;
    var list=full.slice((CAMP_PAGE-1)*PAGE_SIZE, CAMP_PAGE*PAGE_SIZE);
    var pg=document.getElementById("opsOpenPager");
    if(pg){ pg.innerHTML = pages>1 ? '<button class="btn sm ghost" data-pg="prev"'+(CAMP_PAGE<=1?' disabled':'')+'>‹ Prev</button><span class="muted">Page '+CAMP_PAGE+' of '+pages+' · '+full.length+' campaigns</span><button class="btn sm ghost" data-pg="next"'+(CAMP_PAGE>=pages?' disabled':'')+'>Next ›</button>' : '';
      pg.querySelectorAll("[data-pg]").forEach(function(b){ b.onclick=function(){ CAMP_PAGE+= b.getAttribute("data-pg")==="next"?1:-1; renderOpen(_openCache); var t=document.getElementById("opsMine"); if(t) t.scrollIntoView({behavior:"smooth"}); }; }); }
    if(!list.length){ el.innerHTML='<div class="card"><div class="muted">'+(_openCache.length?'Nothing here right now — try another filter.':'No campaigns are open right now. New ones will show up here.')+'</div></div>'; return; }
    // compact cards — tap a card for every detail in a pop-up (Apply works from both)
    el.innerHTML='<div class="ci-cgrid">'+list.map(function(c){
      var act=c.my_stage ? spill(c.my_stage)
        : (c.eligibility&&c.eligibility.eligible===false
            ? '<button class="btn sm ghost" data-apply="'+esc(c.campaign_id)+'" data-name="'+esc(c.name||"")+'" title="See which criteria don\'t match">Not eligible</button>'
            : '<button class="btn sm" data-apply="'+esc(c.campaign_id)+'" data-name="'+esc(c.name||"")+'">Apply</button>');
      var meta=[];
      if(c.product_value) meta.push('🎁 Worth <b>₹'+esc(Number(c.product_value).toLocaleString("en-IN"))+'</b>');
      if(c.ends_on) meta.push('🗓 Till <b>'+fmtDate(c.ends_on)+'</b>');
      if((c.cities||[]).length) meta.push('📍 '+esc((c.cities||[]).slice(0,2).join(", ")));
      if(c.platforms) meta.push('📱 '+esc(String(c.platforms).split(",")[0]));
      return '<div class="ci-ccard" tabindex="0" role="button" data-cdetail="'+esc(c.campaign_id)+'">'
        + '<div class="ci-ccard-top"><div style="min-width:0"><h4>'+esc(c.name||"Campaign")+'</h4><div class="ci-brand">'+esc(c.brand||"")+'</div></div></div>'
        + '<div>'+typeBadge(c)+'</div>'
        + (meta.length?'<div class="ci-ccard-meta">'+meta.map(function(m){ return '<span>'+m+'</span>'; }).join("")+'</div>':'')
        + '<div class="ci-ccard-foot"><span class="ci-more">View details →</span>'+act+'</div></div>';
    }).join("")+'</div>';
    el.querySelectorAll("[data-apply]").forEach(function(b){ b.onclick=function(e){ e.stopPropagation(); applyToCampaign(b); }; });
    el.querySelectorAll("[data-cdetail]").forEach(function(card){
      var open=function(){ var c=_openCache.filter(function(x){ return String(x.campaign_id)===card.getAttribute("data-cdetail"); })[0]; if(c) openCampaignPopup(c); };
      card.onclick=open; card.onkeydown=function(e){ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); open(); } };
    });
  }
  // came from the public /explore.html page (tapped Apply before signing in) → open that campaign once
  function applyHandoff(){
    var id=null; try{ id=localStorage.getItem("geek_apply"); }catch(e){}
    if(!id || !document.getElementById("opsOpenBody")) return;
    try{ localStorage.removeItem("geek_apply"); }catch(e){}
    var c=_openCache.filter(function(x){ return String(x.campaign_id)===String(id); })[0];
    if(c) openCampaignPopup(c);
    else if(window.gateToast) window.gateToast("That campaign isn't taking applications any more — here are the ones that are open.");
  }
  // ---- who can apply: the campaign's criteria checked against MY profile ----
  function eligListHtml(e){
    var cr=(e&&e.criteria)||[]; if(!cr.length) return '<div class="muted">Open to every creator — no extra criteria.</div>';
    return '<div class="ci-elig">'+cr.map(function(x){ return '<div class="ci-elig-row '+(x.ok?'ok':'no')+'"><span class="ci-elig-ic">'+(x.ok?'✓':'✗')+'</span><span><b>'+esc(x.need)+'</b><span class="muted"> · '+esc(x.have)+'</span></span></div>'; }).join("")+'</div>';
  }
  function eligPopup(name, e){
    var old=document.getElementById("ciElig"); if(old) old.remove();
    var no=((e&&e.criteria)||[]).filter(function(x){ return !x.ok; });
    var fixable=no.some(function(x){ return /not in your profile|not set in your profile|no city|no categories|not connected/i.test(x.have||""); });
    var ov=document.createElement("div"); ov.className="ci-pop"; ov.id="ciElig";
    ov.innerHTML='<div class="ci-pop-box" role="alertdialog" aria-modal="true" aria-label="Not eligible">'
      +'<div class="ci-pop-head"><div style="min-width:0"><h3>You are not eligible for this campaign</h3><div class="muted">'+esc(name||"")+'</div></div><button class="ci-pop-x" data-x aria-label="Close">✕</button></div>'
      +'<div class="ci-pop-body"><p style="margin:0 0 10px">The brand requires the criteria below. Your profile doesn\'t match '+(no.length===1?'this one':'these')+':</p>'
      +'<div class="ci-elig">'+no.map(function(x){ return '<div class="ci-elig-row no"><span class="ci-elig-ic">✗</span><span><b>'+esc(x.need)+'</b><br><span class="muted">'+esc(x.have)+'</span></span></div>'; }).join("")+'</div>'
      +(fixable?'<div class="ci-hint" style="margin-top:10px">Some details are just missing from your profile — add them in <b>Creator Profile</b> and check again.</div>':'')
      +'<div class="muted" style="font-size:12.5px;margin-top:10px">Other campaigns may suit you — new ones open every week.</div></div>'
      +'<div class="ci-pop-foot"><button class="btn ghost" data-x>Close</button>'+(fixable?'<button class="btn" data-prof>Update my profile</button>':'')+'</div></div>';
    document.body.appendChild(ov);
    var close=function(){ ov.remove(); };
    ov.addEventListener("click",function(ev){ if(ev.target===ov) close(); });
    ov.querySelectorAll("[data-x]").forEach(function(b){ b.onclick=close; });
    var pb=ov.querySelector("[data-prof]"); if(pb) pb.onclick=function(){ close(); var cp=document.getElementById("ciPop"); if(cp) cp.remove(); document.body.style.overflow="";
      if(typeof currentPage!=="undefined" && typeof renderShell==="function"){ currentPage="profile"; renderShell(); } };
  }
  // the whole brief the team entered (video brief, caption, tags, references, posting note) + terms
  function fullBriefHtml(c){
    var b=c.video_brief||{}, t=c.terms||{}, out='';
    var line=function(k,v){ return v?'<div class="ci-pop-sec">'+k+'</div><div style="white-space:pre-wrap;line-height:1.55">'+esc(v)+'</div>':''; };
    var vb=line('What to shoot', b.what_to_shoot) + line('Key messages', b.key_messages) + line("Do's", b.dos) + line("Don'ts", b.donts)
      + line('Caption to use', b.caption)
      + (b.reference_links?'<div class="ci-pop-sec">References</div><div>'+String(b.reference_links).split(/[\s,]+/).filter(Boolean).map(function(u){ return /^https?:\/\//i.test(u)?'<a href="'+esc(u)+'" target="_blank" rel="noopener">'+esc(u)+'</a>':esc(u); }).join('<br>')+'</div>':'')
      + line('Posting note', b.posting_note);
    if(vb) out+='<div class="ci-pop-sec" style="font-size:13px">🎬 Video brief</div>'+vb;
    var k=kindOf(c), noProd=k==='paid', terms=[];
    if(t.content_days) terms.push('Post within <b>'+esc(t.content_days)+' days</b> of '+(noProd?'getting the video brief':'receiving the product'));
    terms.push('Submit your video in the app first — post <b>only after the brand approves it</b>');
    if(t.ad_rights_months) terms.push('Ad rights: the brand may use your content for <b>'+esc(t.ad_rights_months)+' month'+(t.ad_rights_months>1?'s':'')+'</b>; keep the posts live for that time');
    if(t.collab_rights) terms.push('Add the brand as an Instagram <b>collaborator</b> on the post');
    if(k!=='barter') terms.push('<b>Paid:</b> your fee is agreed with you one to one and written into your own contract');
    if(t.blacklist_clause) terms.push('Not delivering after you '+(noProd?'sign':'receive the product')+' blocks your account'+(t.reship_clause&&!noProd?' and you must re-ship the product':''));
    terms.push('Disclose the collaboration (Paid partnership / #ad) as per ASCI');
    out+='<div class="ci-pop-sec">📜 Terms</div><ul class="ci-terms">'+terms.map(function(x){ return '<li>'+x+'</li>'; }).join("")+'</ul>';
    return out;
  }
  function openCampaignPopup(c){
    var old=document.getElementById("ciPop"); if(old) old.remove();
    var tags=[].concat(c.hashtags||[],(c.mentions||[]).map(function(m){ return String(m).charAt(0)==='@'?m:'@'+m; }));
    var row=function(k,v){ return v?'<div class="ci-pop-row"><span>'+k+'</span><span>'+v+'</span></div>':''; };
    var html='<div class="ci-pop-box" role="dialog" aria-modal="true" aria-label="'+esc(c.name||"Campaign")+'">'
      + '<div class="ci-pop-head"><div style="min-width:0"><h3>'+esc(c.name||"Campaign")+'</h3><div class="muted">'+esc(c.brand||"")+'</div><div style="margin-top:8px">'+typeBadge(c)+'</div></div>'
      + '<button class="ci-pop-x" id="ciPopX" aria-label="Close">✕</button></div>'
      + '<div class="ci-pop-body">'
      + '<div class="ci-pop-sec">Overview</div>'
      + row("Type", c.campaign_type?esc(campTypeLabel(c.campaign_type,c.barter_subtype)):'')
      + row("Product", c.product?esc(c.product):'')
      + row("Product value", c.product_value?'₹'+esc(Number(c.product_value).toLocaleString("en-IN")):'')
      + row("Product link", c.product_link?'<a href="'+esc(safeLink(c.product_link))+'" target="_blank" rel="noopener">View product ↗</a>':'')
      + row("Category", c.category?esc(c.category):'')
      + row("Dates", (c.starts_on||c.ends_on)?fmtDate(c.starts_on)+' – '+fmtDate(c.ends_on):'')
      + row("Cities", (c.cities||[]).length?esc((c.cities||[]).join(", ")):'')
      + row("Languages", (c.languages||[]).length?esc((c.languages||[]).join(", ")):'')
      + row("Platforms", c.platforms?esc(c.platforms):'')
      + (c.deliverables_text?'<div class="ci-pop-sec">Deliverables</div><div style="white-space:pre-wrap">'+esc(c.deliverables_text)+'</div>':'')
      + (c.brief?'<div class="ci-pop-sec">Brief</div><div style="white-space:pre-wrap;line-height:1.55">'+esc(c.brief)+'</div>':'')
      + (tags.length?'<div class="ci-pop-sec">Must include in caption</div><div>'+esc(tags.join(" "))+'</div>':'')
      + ((c.attachments||[]).length?'<div class="ci-pop-sec">Files</div><div>'+(c.attachments||[]).map(function(a){ return '<a href="'+esc(safeLink(a.url))+'" target="_blank" rel="noopener">📎 '+esc(a.name||"file")+'</a>'; }).join("<br>")+'</div>':'')
      + fullBriefHtml(c)
      + '<div class="ci-pop-sec">✅ Who can apply</div>' + eligListHtml(c.eligibility)
      + '</div>'
      + '<div class="ci-pop-foot"><button class="btn ghost" id="ciPopClose">Close</button>'
      + (c.my_stage?spill(c.my_stage):(c.eligibility&&c.eligibility.eligible===false
          ? '<button class="btn ghost" data-apply="'+esc(c.campaign_id)+'" data-name="'+esc(c.name||"")+'">Not eligible — see why</button>'
          : '<button class="btn" data-apply="'+esc(c.campaign_id)+'" data-name="'+esc(c.name||"")+'">Apply now</button>'))+'</div></div>';
    var ov=document.createElement("div"); ov.className="ci-pop"; ov.id="ciPop"; ov.innerHTML=html;
    document.body.appendChild(ov); document.body.style.overflow="hidden";
    var close=function(){ ov.remove(); document.body.style.overflow=""; document.removeEventListener("keydown",esck); };
    var esck=function(e){ if(e.key==="Escape") close(); };
    document.addEventListener("keydown",esck);
    ov.addEventListener("click",function(e){ if(e.target===ov) close(); });
    document.getElementById("ciPopX").onclick=close; document.getElementById("ciPopClose").onclick=close;
    var ap=ov.querySelector("[data-apply]"); if(ap) ap.onclick=function(){ close(); applyToCampaign(ap); };
    document.getElementById("ciPopX").focus();
  }
  // which profiles the creator can apply with: the connected Instagram + pages / profiles they manage
  async function myApplyProfiles(){
    var out=[];
    try{
      var me=(window.Auth&&Auth.profile&&Auth.profile.id)||null;
      if(me){ var sa=await window.sb.from("social_accounts").select("username,followers_count").eq("platform","instagram").eq("member_id",me).limit(1);
        var row=sa&&sa.data&&sa.data[0]; if(row&&row.username) out.push({handle:String(row.username).toLowerCase(),followers:row.followers_count,label:"Connected Instagram"}); }
    }catch(e){}
    try{ var ig=window.igAccountsLoad ? await window.igAccountsLoad(true) : []; (ig||[]).forEach(function(a){ if(a.username && !out.some(function(o){return o.handle===a.username;})) out.push({handle:a.username,followers:a.followers_count,label:a.active?"Instagram · active":"Instagram"}); }); }catch(e){}
    try{ var m=await apiCreator("get_my_managed_profiles"); ((m&&m.data)||[]).forEach(function(x){ if(!out.some(function(o){return o.handle===x.handle;})) out.push({handle:x.handle,followers:x.followers,label:x.category||"Managed profile"}); }); }catch(e){}
    return out;
  }
  function pickApplyProfile(name){
    return new Promise(async function(resolve){
      var profs=await myApplyProfiles();
      var ov=document.createElement("div"); ov.className="ci-pop"; ov.id="ciApplyPick";
      ov.innerHTML='<div class="ci-pop-box ci-ppick" role="dialog" aria-modal="true" aria-label="Apply with">'
        +'<div class="ci-pop-head"><div style="min-width:0"><h3>Apply to '+esc(name)+'</h3><div class="muted">Pick the profile you want to apply with — the brand reviews this one.</div></div><button class="ci-pop-x" data-x aria-label="Close">✕</button></div>'
        +'<div class="ci-pop-body">'+(profs.length?profs.map(function(p,i){
            return '<label class="ci-ppick-row"><input type="radio" name="ciPickP" value="'+esc(p.handle)+'"'+(i===0?' checked':'')+'><span><b>@'+esc(p.handle)+'</b><span class="muted">'+esc(p.label)+(p.followers!=null?' · '+Number(p.followers).toLocaleString("en-IN")+' followers':'')+'</span></span></label>'; }).join("")
          :'<div class="muted">Your connected Instagram will be used.</div>')
        +'<div class="cp-hint" style="margin-top:4px">Connect more Instagram accounts in <b>Creator Profile → Your Instagram accounts</b>. The brand sees and works with the one you pick — all through the campaign.</div></div>'
        +'<div class="ci-pop-foot"><button class="btn ghost" data-x>Cancel</button><button class="btn" data-go>Apply</button></div></div>';
      document.body.appendChild(ov);
      var done=function(v){ ov.remove(); document.removeEventListener("keydown",k); resolve(v); };
      var k=function(e){ if(e.key==="Escape") done(undefined); };
      document.addEventListener("keydown",k);
      ov.addEventListener("click",function(e){ if(e.target===ov) done(undefined); });
      ov.querySelectorAll("[data-x]").forEach(function(b){ b.onclick=function(){ done(undefined); }; });
      ov.querySelector("[data-go]").onclick=function(){ var r=ov.querySelector('input[name="ciPickP"]:checked'); done(r?r.value:null); };
      ov.querySelectorAll(".ci-ppick-row").forEach(function(el){ el.onclick=function(){ var i=el.querySelector("input"); if(i){ i.checked=true; } }; });
    });
  }
  async function applyToCampaign(btn){
    var id=btn.getAttribute("data-apply"), name=btn.getAttribute("data-name")||"this campaign";
    // every criterion the brand set must match before applying
    var el=null; try{ var er=await apiCreator("my_campaign_eligibility",{p_campaign:id}); if(er && !er.error) el=er.data; }catch(_e){}
    if(!el){ var cc=(_openCache||[]).filter(function(x){ return String(x.campaign_id)===String(id); })[0]; el=cc&&cc.eligibility; }
    if(el && el.eligible===false){ eligPopup(name, el); return; }
    var prof=await pickApplyProfile(name); if(prof===undefined) return;
    btn.disabled=true; btn.textContent="Applying…";
    try{
      var r=await apiCreator("apply_to_campaign_v2",{p_campaign:id,p_profile:prof});
      if(r.error && /apply_to_campaign_v2|could not find the function/i.test(r.error.message||"")) r=await apiCreator("apply_to_campaign",{p_campaign:id});
      if(r.error) throw r.error;
      if(window.Tracker) Tracker.security("campaign_apply", { campaign_id: id, campaign: name, profile: prof });
      btn.textContent="Applied"+(prof?" as @"+prof:"");
      loadMyCampaigns(); if(typeof updateAlertsBadge==="function") updateAlertsBadge();
    }catch(e){
      var msg=(e&&e.message)||String(e);
      if(/not eligible/i.test(msg)){ var e2=null; try{ var r2=await apiCreator("my_campaign_eligibility",{p_campaign:id}); e2=r2&&r2.data; }catch(_x){}
        if(e2 && e2.eligible===false) eligPopup(name, e2); else alert(msg); }
      else alert(msg);
      btn.disabled=false; btn.textContent="Apply";
    }
  }
  // live Instagram numbers for the creator's own posts (freshest source: the synced media list)
  var _igMedia = null;
  async function igMediaMap(){
    if(_igMedia) return _igMedia;
    _igMedia = {};
    try{
      var me = window.Auth && Auth.profile && Auth.profile.id;
      if(me && window.sb.from){
        var r = await window.sb.from("social_accounts").select("recent_media").eq("platform","instagram").eq("member_id", me).limit(1);
        ((r.data && r.data[0] && r.data[0].recent_media) || []).forEach(function(m){
          var k = String(m.permalink||"").replace(/\/+$/,""); if(k) _igMedia[k] = m;
        });
      }
    }catch(e){}
    return _igMedia;
  }
  function liveMetrics(d){
    var m = d.metrics || {}, ig = _igMedia && _igMedia[String(d.permalink||"").replace(/\/+$/,"")];
    var out = { views: m.views != null ? m.views : (m.plays != null ? m.plays : m.impressions),
                likes: m.likes, comments: m.comments, reach: m.reach, saves: m.saved != null ? m.saved : m.saves, shares: m.shares };
    if(ig){                                    // Instagram sync wins — it refreshes every minute
      if(ig.like_count != null) out.likes = ig.like_count;
      if(ig.comments_count != null) out.comments = ig.comments_count;
      if(ig.view_count != null) out.views = ig.view_count;
    }
    return out;
  }
  function metricChips(d){
    var v = liveMetrics(d), rows = [["👁","Views",v.views],["❤️","Likes",v.likes],["💬","Comments",v.comments],["📈","Reach",v.reach],["🔖","Saves",v.saves],["↗️","Shares",v.shares]]
      .filter(function(x){ return x[2] != null; });
    if(!rows.length) return '';
    return '<div class="mc-metrics">'+rows.map(function(x){ return '<div><b>'+kfmt(x[2])+'</b><span>'+x[0]+' '+x[1]+'</span></div>'; }).join("")+'</div>';
  }
  function kfmt(n){ n = Number(n)||0; return n>=1e6 ? (n/1e6).toFixed(1).replace(/\.0$/,"")+"M" : n>=1e3 ? (n/1e3).toFixed(1).replace(/\.0$/,"")+"K" : String(n); }
  var DSTAT = { expected:["Not submitted yet","warn"], submitted:["In review","warn"], approved:["Approved ✓","ok"], published:["Published 🎉","ok"], missed:["Missed","no"] };

  function mineGroup(stage){
    if(['shortlisted','invited','applied','eligible','sent_to_brand'].indexOf(stage)>=0) return 'Upcoming';
    if(['completed','rejected','dropped','ineligible','brand_declined'].indexOf(stage)>=0) return 'Completed';
    return 'Active';
  }
  // My Campaigns: tabs (from the stat tiles) + 5 per page; long text stays folded until the creator opens it
  var MINE_TAB=null, MINE_PAGE=1, MINE_SIZE=3, MINE_OPEN={};
  var MINE_TABS=[["Active","🟢 Running now"],["Upcoming","⏳ Applied / waiting"],["Done","🏁 Completed"],["Declined","Not selected"],["All","All time"]];
  function mineTabOf(c){ var g=mineGroup(c.stage); if(g==='Completed') return c.stage==='completed'?'Done':'Declined'; return g; }
  function renderMine(all){
    var box=document.getElementById("opsMineBody"); if(!box) return;
    _mineCache=all||[]; var list=_mineCache;
    var count={Active:0,Upcoming:0,Done:0,Declined:0,All:list.length}; list.forEach(function(c){ count[mineTabOf(c)]++; });
    if(!MINE_TAB || (MINE_TAB!=="All" && !count[MINE_TAB])) MINE_TAB = count.Active?"Active":count.Upcoming?"Upcoming":"All";
    var invites=list.filter(function(c){ return c.stage==='invited'; }).length;
    var st=document.getElementById("opsMineStats");
    if(st) st.innerHTML='<div class="mc-tabs">'+MINE_TABS.map(function(t){
        return '<button class="mc-tab'+(MINE_TAB===t[0]?' act':'')+'" data-minetab="'+t[0]+'"><b>'+count[t[0]]+'</b><span>'+t[1]+(t[0]==='Upcoming'&&invites?' · 🎯 '+invites+' invite'+(invites>1?'s':''):'')+'</span></button>'; }).join("")+'</div>';
    if(!list.length){ box.innerHTML='<div class="card"><div class="muted">No campaigns yet. Open <b>Campaigns</b>, apply to one — it shows up here with every next step.</div></div>'; wireMineTabs(); return; }
    var rows=list.filter(function(c){ return MINE_TAB==="All" || mineTabOf(c)===MINE_TAB; });
    // fixed order: newest application first — a card never jumps when its status changes
    rows.sort(function(a,b){ return String(b.applied_at||"").localeCompare(String(a.applied_at||"")) || String(a.participation_id).localeCompare(String(b.participation_id)); });
    var pages=Math.max(1, Math.ceil(rows.length/MINE_SIZE)); if(MINE_PAGE>pages) MINE_PAGE=pages;
    var slice=rows.slice((MINE_PAGE-1)*MINE_SIZE, MINE_PAGE*MINE_SIZE);
    var pager = rows.length ? '<div class="ci-pager mc-pager"><button class="btn sm ghost" data-mpg="prev"'+(MINE_PAGE<=1?' disabled':'')+'>‹ Prev</button>'
        + Array.from({length:pages},function(_,i){ return '<button class="btn sm '+(i+1===MINE_PAGE?'':'ghost')+'" data-mpgn="'+(i+1)+'">'+(i+1)+'</button>'; }).join("")
        + '<button class="btn sm ghost" data-mpg="next"'+(MINE_PAGE>=pages?' disabled':'')+'>Next ›</button>'
        + '<span class="muted">'+((MINE_PAGE-1)*MINE_SIZE+1)+'–'+Math.min(MINE_PAGE*MINE_SIZE,rows.length)+' of '+rows.length+'</span></div>' : '';
    // keep the screen where it is when the list refreshes on its own
    var y=window.scrollY, h=box.offsetHeight; if(h) box.style.minHeight=h+'px';
    box.innerHTML=(slice.length?slice.map(cardMine).join(""):'<div class="card"><div class="muted">Nothing here right now.</div></div>') + pager;
    box.style.minHeight=''; if(Math.abs(window.scrollY-y)>2) window.scrollTo(0,y);
    wireMineTabs(); wireMine();
  }
  function wireMineTabs(){
    document.querySelectorAll("#opsMine [data-minetab]").forEach(function(b){ b.onclick=function(){ MINE_TAB=b.getAttribute("data-minetab"); MINE_PAGE=1; renderMine(_mineCache); }; });
    document.querySelectorAll("#opsMine [data-mpgn]").forEach(function(b){ b.onclick=function(){ MINE_PAGE=+b.getAttribute("data-mpgn"); renderMine(_mineCache);
      var t=document.getElementById("opsMineStats"); if(t) t.scrollIntoView({behavior:"smooth",block:"start"}); }; });
    document.querySelectorAll("#opsMine [data-mpg]").forEach(function(b){ b.onclick=function(){ MINE_PAGE+= b.getAttribute("data-mpg")==="next"?1:-1; renderMine(_mineCache);
      var t=document.getElementById("opsMineStats"); if(t) t.scrollIntoView({behavior:"smooth",block:"start"}); }; });
    // remember which folded sections the creator opened, so a live refresh doesn't close them
    document.querySelectorAll("#opsMine details[data-fold]").forEach(function(d){ d.addEventListener("toggle", function(){ MINE_OPEN[d.getAttribute("data-fold")]=d.open; }); });
  }
  function fold(id, title, hint, inner, openByDefault){
    var open = MINE_OPEN[id]!=null ? MINE_OPEN[id] : !!openByDefault;
    return '<details class="mc-fold" data-fold="'+esc(id)+'"'+(open?' open':'')+'><summary><span class="mc-fold-t">'+title+'</span>'
      +(hint?'<span class="mc-fold-h">'+hint+'</span>':'')+'<span class="mc-fold-c"></span></summary><div class="mc-fold-b">'+inner+'</div></details>';
  }
  /* ---- creator: where am I, and what do I do now (one card per campaign) ---- */
  var JOURNEY = [
    ["applied","Applied"],["brand_confirmed","Selected"],["contract_sent","Contract"],["contract_signed","Signed"],
    ["address_confirmed","Address"],["product_sent","Shipped"],["product_delivered","Delivered"],["content_created","Brief"],
    ["content_submitted","Video sent"],["content_approved","Approved"],["published","Posted"],["completed","Done"]];
  var J_ALIAS = { invited:"applied", shortlisted:"applied", eligible:"applied", sent_to_brand:"applied", accepted:"brand_confirmed", changes_requested:"content_created" };
  var SHIP_STEPS=["address_confirmed","product_sent","product_delivered"];
  function noShip(c){ return !!(c && c._flow && c._flow.needs_product===false); }
  function jSteps(c){ return noShip(c) ? JOURNEY.filter(function(s){ return SHIP_STEPS.indexOf(s[0])<0; }) : JOURNEY; }
  function jIndex(c){
    var J=jSteps(c);
    if(!noShip(c) && c.stage==='product_sent' && c.shipment && c.shipment.status==='delivered') return 6;
    var s=J_ALIAS[c.stage]||c.stage; for(var i=0;i<J.length;i++) if(J[i][0]===s) return i; return 0;
  }
  function journeyHtml(c){
    var idx=jIndex(c), st=c.steps||{}, sh=c.shipment||{};
    var when=function(k){ return st[k] || (k==='product_delivered'?sh.delivered_at:null) || (k==='product_sent'?sh.shipped_at:null) || (k==='applied'?c.applied_at:null) || (k==='brand_confirmed'?st.accepted:null); };
    return '<div class="jr"><div class="jr-track">'+jSteps(c).map(function(s,i){
        var cls=i<idx||c.stage==='completed'?'done':i===idx?'now':'';
        var at=when(s[0]);
        return '<div class="jr-step '+cls+'" title="'+esc(s[1])+(at?' · '+fmtDT(at):'')+'"><i>'+(cls==='done'?'✓':(i+1))+'</i><span>'+esc(s[1])+'</span></div>';
      }).join("")+'</div></div>';
  }
  // the one thing the creator should do (or wait for) right now
  function nextStepHtml(c){
    var P=esc(c.participation_id), sh=c.shipment||{}, k=c.contract||{}, rv=c.review, sb2=c.submission, due=c.deadline;
    var box=function(icon,title,text,btns,tone){ return '<div class="jr-now '+(tone||'')+'"><div class="jr-now-h">'+icon+' <b>'+title+'</b></div>'+(text?'<div class="jr-now-t">'+text+'</div>':'')+(btns?'<div class="ci-evrow">'+btns+'</div>':'')+'</div>'; };
    var readBrief='<button class="btn sm ghost" data-readbrief="'+P+'">📖 Read brief</button>';
    if(c.blocked_at) return box('⛔','Your account is blocked',
        'You received the product but no video came in within 7 days, so campaigns are paused for you. Our team will call you — or submit your video now and reply on WhatsApp.',
        '<button class="btn sm" data-video="'+P+'">🎬 Submit my video</button>'+readBrief,'bad');
    switch(c.stage){
      case 'invited':
        if(c.needs_approval) return box('🎯',esc(c.brand||'A brand')+' wants you on this campaign','Read the campaign details below and tap <b>Apply</b> — the brand confirms and your contract follows automatically.','<button class="btn sm" data-accept="'+P+'">✅ Apply</button><button class="btn sm ghost" data-reject="'+P+'">Not for me</button>','act');
        return box('🎯','You\'re invited','Read the campaign details below, then accept or pass.','<button class="btn sm" data-accept="'+P+'">✅ Accept invite</button><button class="btn sm ghost" data-reject="'+P+'">Pass</button>');
      case 'applied': case 'eligible': case 'shortlisted': return box('⏳','Application received','Geek is checking your profile against the brand\'s brief. You\'ll get a WhatsApp the moment there\'s news.');
      case 'sent_to_brand': return box('📋','With the brand','You\'re on the final list the brand is reviewing.');
      case 'brand_confirmed': case 'accepted': return box('🎉','You\'re selected!','Your contract is being prepared — it will appear here in a moment.');
      case 'contract_sent': return box('📜','Sign your contract',(c._flow&&c._flow.paid?'Your fee and payment terms, deliverables, ASCI, ad rights, posting only after approval, and the non-delivery terms.':'Product, deliverables, ASCI, ad rights, posting only after approval, and the non-delivery terms.')+' Read it to the end and sign.','<button class="btn sm" data-contract="'+P+'">Read &amp; sign contract</button>','act');
      case 'contract_signed':
        if(noShip(c)) return box('🎬','Your video brief is on its way','Contract signed ✓ — there is nothing to ship on this campaign, so your video brief opens here in a moment.');
        return box('📍','Confirm your delivery address','Pick a saved address, edit it, add a new one or use your current location.','<button class="btn sm" data-address="'+P+'">Confirm delivery address</button>','act');
      case 'address_confirmed': return box('📦','Your product is being packed','The courier and tracking number show here the moment it ships. Your <b>video brief</b> is ready — read it now and start planning / practising your video; the deadline starts once the parcel reaches you.', c.video_brief?readBrief:'');
      case 'product_sent':
        if(sh.status==='delivered') return box('✅','Delivered','Your video brief is on its way to you.', c.video_brief?readBrief:'');
        return box('🚚','Your product is on the way',
          '<div class="trk">'+(sh.courier?'<span>Courier <b>'+esc(sh.courier)+'</b></span>':'')
          +(sh.tracking_ref?'<span>Tracking no. <b class="trk-no">'+esc(sh.tracking_ref)+'</b> <button class="btn sm ghost" data-copy="'+esc(sh.tracking_ref)+'">Copy</button></span>':'')
          +(sh.shipped_at?'<span>Sent '+fmtDate(sh.shipped_at)+'</span>':'')+'</div>'
          +'<div class="muted" style="font-size:12px;margin-top:6px">Tap <b>Track</b> — paste the tracking number on the courier page if it asks. Got the parcel? Tap <b>Received</b> and your video brief opens.</div>',
          (sh.tracking_url?'<a class="btn sm ghost" href="'+esc(safeLink(sh.tracking_url))+'" target="_blank" rel="noopener" data-trk="'+esc(sh.tracking_ref||"")+'">🔎 Track parcel ↗</a>'
                          :(sh.tracking_ref?'<a class="btn sm ghost" href="https://www.google.com/search?q='+encodeURIComponent((sh.courier||"courier")+" tracking "+sh.tracking_ref)+'" target="_blank" rel="noopener" data-trk="'+esc(sh.tracking_ref)+'">🔎 Track parcel ↗</a>':''))
          +'<button class="btn sm" data-received="'+P+'">📦 Received</button>','act');
      case 'content_created': return box('🎬','Shoot your video',
          'Read the brief, shoot your video'+(due?' and submit by <b>'+fmtDate(due)+'</b>':'')+'. <b>Don\'t post it on Instagram yet</b> — the brand approves it first.',
          '<button class="btn sm" data-video="'+P+'">🎬 Submit my video</button>'+readBrief,'act');
      case 'changes_requested': return box('✏️', /^New video link needed/.test((rv&&rv.reason)||'') ? 'We need a new video link' : 'The brand asked for changes',
          (rv&&rv.reason?'<div class="mc-note" style="border-color:rgba(247,144,9,.6)">“'+esc(rv.reason)+'”</div>':'')+(due?'<div style="margin-top:4px">Due <b>'+fmtDate(due)+'</b></div>':''),
          '<button class="btn sm" data-video="'+P+'">🎬 Submit again</button>'+readBrief,'act');
      case 'content_submitted': return box('👀','Your video is with the brand',(sb2?'<a href="'+esc(safeLink(sb2.url))+'" target="_blank" rel="noopener">Your link ↗</a> · sent '+fmtDT(sb2.submitted_at)+'. ':'')+'We\'ll tell you the moment it\'s approved. Don\'t post yet.');
      case 'content_approved': return box('✅','Approved — let\'s post!','Tap <b>Let\'s post</b> — your post opens right here in the app with the format, caption, @mentions, #hashtags and collaborator filled in from the campaign. Pick your approved video and publish.'
            + postProgressHtml(c),
          '<button class="btn sm" data-letspost="'+P+'">🚀 Let\'s post</button><button class="btn sm ghost" data-post="'+P+'">🔗 Posted already? Add the link</button>','act');
      case 'published':
        var left=pendingFormats(c);
        if(left.length) return box('📲','Next: post your '+esc(left.join(' + ')),'Your first post is live ✓. The campaign completes when <b>every</b> post is up — post the rest from the app, or posted it already? Add its link.'
            + postProgressHtml(c),
          '<button class="btn sm" data-letspost="'+P+'">🚀 Post my '+esc(left[0])+'</button><button class="btn sm ghost" data-post="'+P+'" data-postkind="'+esc(left[0].toLowerCase()==="post"?"post":left[0].toLowerCase())+'">🔗 Add a post link</button>','act');
        return box('📈','You\'re live!','Your post is recorded on the campaign. The brand wraps up once the numbers are in.');
      case 'completed':
        var left2=pendingFormats(c);
        return box('🏁','Campaign complete 🎉','Thank you! Your post is live and your numbers are below.'
            + (left2.length?'<div style="margin-top:6px">Still to post: <b>'+esc(left2.join(' + '))+'</b></div>':'')
            + (!c.feedback_at?'<div class="mc-sec" style="margin-top:10px">⭐ Quick feedback <span class="muted" style="font-weight:400">(optional)</span></div>'+feedbackForm(c):'<div class="muted" style="font-size:12px;margin-top:6px">⭐ Thanks for your feedback!</div>'),
          left2.length?'<button class="btn sm" data-letspost="'+P+'">🚀 Post my '+esc(left2[0])+'</button>':'', !c.feedback_at?'act':'');
    }
    return '';
  }
  function feedbackForm(c){
    var P=esc(c.participation_id), yn=function(id,q){ return '<label class="fbq"><span>'+q+'</span><select id="'+id+P+'"><option value="">—</option><option value="yes">Yes</option><option value="no">No</option></select></label>'; };
    return '<div class="fb-box"><div class="fb-stars" data-fbstars="'+P+'">'+[1,2,3,4,5].map(function(n){ return '<button type="button" data-star="'+n+'">★</button>'; }).join("")+'</div>'
      + yn('fbClear','Was the brief clear?') + yn('fbSmooth','Was everything smooth?') + yn('fbAgain','Work with this brand again?')
      + '<textarea id="fbText'+P+'" rows="2" placeholder="Anything to tell the brand or the Geek team? (optional)"></textarea>'
      + '<button class="btn sm" data-fbsend="'+P+'">Submit feedback</button><span class="ci-hint" id="fbMsg'+P+'"></span></div>';
  }
  function briefHtml(c){
    var b=c.video_brief; if(!b) return '';
    var line=function(k,v){ return v?'<div class="mc-sec">'+k+'</div><div class="mc-text">'+esc(v)+'</div>':''; };
    var tags=[b.hashtags,b.mentions].filter(Boolean).join(' ');
    return '<div class="jr-brief"><div class="jr-now-h">🎬 <b>Your video brief</b>'+(c.deadline?' <span class="ci-pill ci-warn">Due '+fmtDate(c.deadline)+'</span>':'')+'</div>'
      + line('What to shoot', b.what_to_shoot) + line('Key messages', b.key_messages) + line("Do's", b.dos) + line("Don'ts", b.donts)
      + line('Make', b.deliverables_text) + line('Caption', b.caption)
      + (tags?'<div class="mc-sec">Hashtags &amp; tags</div><div class="mc-tags">'+tags.split(/\s+/).filter(Boolean).map(function(t){ return '<span>'+esc(t)+'</span>'; }).join("")+'</div>':'')
      + (b.reference_links?'<div class="mc-sec">References</div><div class="mc-text">'+String(b.reference_links).split(/[\s,]+/).filter(Boolean).map(function(u){ return /^https?:\/\//i.test(u)?'<a href="'+esc(u)+'" target="_blank" rel="noopener">'+esc(u)+'</a>':esc(u); }).join('<br>')+'</div>':'')
      + line('Posting note', b.posting_note)
      + '<div class="muted" style="font-size:12px;margin-top:6px">Always disclose the collaboration (Paid partnership label / #ad) as per ASCI.</div></div>';
  }
  function postsHtml(c){
    var ps=c.posts||[]; if(!ps.length) return '';
    return '<div class="mc-dl">'+ps.map(function(p){
      var s=p.stats||{}, rows=[["👁","Views",s.views],["📈","Reach",s.reach],["❤️","Likes",s.likes],["💬","Comments",s.comments],["↗️","Shares",s.shares],["🔖","Saves",s.saves]].filter(function(x){ return x[2]!=null; });
      return '<div class="mc-dlrow"><div class="mc-dlh"><b>'+esc(p.media_type)+'</b><span class="muted" style="font-size:12px">posted '+fmtDate(p.posted_at)
        +(p.permalink?' · <a href="'+esc(safeLink(p.permalink))+'" target="_blank" rel="noopener">Open ↗</a>':'')+'</span></div>'
        +(rows.length?'<div class="mc-metrics">'+rows.map(function(x){ return '<div><b>'+kfmt(x[2])+'</b><span>'+x[0]+' '+x[1]+'</span></div>'; }).join("")+'</div>':'<div class="muted" style="font-size:12px">Numbers appear within a few hours.</div>')+'</div>';
    }).join("")+'</div>';
  }
  var APPROVED_STAGES = ['brand_confirmed','accepted','contract_sent','contract_signed','address_confirmed','product_sent','product_delivered','content_created','content_submitted','changes_requested','content_approved','published','completed'];
  function cardMine(c){
    var P=c.participation_id, dl=(c.deliverables||[]), approved=APPROVED_STAGES.indexOf(c.stage)>=0,
        declined=['ineligible','brand_declined','rejected','dropped'].indexOf(c.stage)>=0;
    var row=function(k,v){ return v?'<div class="mc-row"><span>'+k+'</span><span>'+v+'</span></div>':''; };
    var tags=[].concat(c.hashtags||[],(c.mentions||[]).map(function(m){ return String(m).charAt(0)==='@'?m:'@'+m; }));
    var sh=c.shipment, shTxt = sh && !(c.stage==='product_sent' && sh.status==='shipped') && sh.status!=='pending' ? ({shipped:'🚚 On the way',delivered:'✅ Product delivered',failed:'⚠️ Delivery failed'}[sh.status]||sh.status)
      + (sh.courier?' · '+esc(sh.courier):'') + (sh.tracking_ref?' · <b>'+esc(sh.tracking_ref)+'</b>':'')
      + (sh.delivered_at?' · '+fmtDate(sh.delivered_at):sh.shipped_at?' · sent '+fmtDate(sh.shipped_at):'') : '';
    var preview=function(t){ t=String(t||"").replace(/\s+/g," ").trim(); return t.length>90?esc(t.slice(0,90))+'…':esc(t); };
    var details = '<div class="mc-grid">'
      + row('Brand', esc(c.brand||'—') + (c.org_name?' <span class="muted">· '+esc(c.org_name)+'</span>':''))
      + row('Type', typeBadge(c))
      + row('Product', c.product?esc(c.product):'')
      + row('Product value', c.product_value?'₹'+esc(Number(c.product_value).toLocaleString("en-IN")):'')
      + row('Campaign dates', (c.starts_on||c.ends_on)?fmtDate(c.starts_on)+' – '+fmtDate(c.ends_on):'')
      + row('Applied with', c.applied_profile?'<b>@'+esc(c.applied_profile)+'</b>':'')
      + row('Applied on', c.applied_at?fmtDate(c.applied_at):'')
      + row('Cities', (c.cities||[]).length?esc((c.cities||[]).join(", ")):'')
      + row('Platforms', c.platforms?esc(c.platforms):'')
      + row('Product link', c.product_link?'<a href="'+esc(safeLink(c.product_link))+'" target="_blank" rel="noopener">View product ↗</a>':'')
      + '</div>'
      + (c.brief?'<div class="mc-sec">Brief</div><div class="mc-text">'+esc(c.brief)+'</div>':'')
      + (c.deliverables_text?'<div class="mc-sec">What to make</div><div class="mc-text">'+esc(c.deliverables_text)+'</div>':'')
      + (tags.length?'<div class="mc-sec">Must include in your caption</div><div class="mc-tags">'+tags.map(function(t){ return '<span>'+esc(t)+'</span>'; }).join("")+'</div>':'')
      + ((c.attachments||[]).length?'<div class="mc-sec">Files from the brand</div><div>'+(c.attachments||[]).map(function(a){ return '<a href="'+esc(safeLink(a.url))+'" target="_blank" rel="noopener">📎 '+esc(a.name||"file")+'</a>'; }).join("<br>")+'</div>':'')
      + '<div class="mc-full">'+fullBriefHtml({ video_brief:null, terms:c.terms, campaign_type:c.campaign_type, _flow:c._flow, comp_type:c.comp_type })+'</div>';
    var delivHtml = dl.length && !(c.posts||[]).length ? '<div class="mc-dchips">'+dl.map(function(d){
          var s=DSTAT[d.status]||[d.status||'—','na'];
          return '<span class="mc-dchip"><b>'+esc(vlabel("content_formats",d.format))+(d.quantity>1?' ×'+d.quantity:'')+'</b><i class="ci-'+s[1]+'">'+esc(s[0])+'</i></span>'; }).join("")+'</div>' : '';
    var meta = [c.campaign_type||c.comp_type?typeBadge(c):'', c.product?'🎁 <b>'+esc(c.product)+'</b>':'',
      c.deadline&&!declined?'⏳ Due <b>'+fmtDate(c.deadline)+'</b>':'', c.applied_profile?'as <b>@'+esc(c.applied_profile)+'</b>':'',
      (c.starts_on||c.ends_on)?'🗓 '+fmtDate(c.starts_on)+' – '+fmtDate(c.ends_on):''].filter(Boolean);
    var vb=c.video_brief, vbHint=vb?preview(vb.what_to_shoot||vb.key_messages||''):'';
    return '<div class="card mc-card'+(declined?' mc-off':'')+'">'
      + '<div class="mc-top"><div class="mc-title"><h4>'+esc(c.campaign||"Campaign")+'</h4><span class="muted">'+esc(c.brand||"")+(c.org_name?' · '+esc(c.org_name):'')+'</span></div>'
      +   '<div class="mc-top-r">'+spill(c.stage)+(!declined?'<button class="mc-ask" data-askai="'+P+'" title="Contract, brief, video, courier, posting — ask anything">💬 Questions? Ask us</button>':'')+'</div></div>'
      + (meta.length?'<div class="mc-meta">'+meta.map(function(m){ return '<span>'+m+'</span>'; }).join("")+'</div>':'')
      + (declined?'<div class="mc-banner no"><b>Not selected this time.</b>'+(c.reason_label?' Reason: <b>'+esc(c.reason_label)+'</b>.':'')
          +(c.reason&&c.reason!==c.reason_label?'<div class="mc-note">“'+esc(String(c.reason).replace(/^.*?—\s*/,""))+'”</div>':'')+'</div>'
        : journeyHtml(c) + nextStepHtml(c) + (approved ? payBoxMine(c) : ''))
      + (shTxt?'<div class="mc-ship">'+shTxt+'</div>':'')
      + ((c.posts||[]).length?postsHtml(c):delivHtml)
      + (vb?fold('vb-'+P,'🎬 Video brief'+(c.deadline&&['content_created','changes_requested'].indexOf(c.stage)>=0?' <span class="ci-pill ci-warn" style="margin-left:6px">Due '+fmtDate(c.deadline)+'</span>':''), vbHint, briefHtml(c), false):'')
      + fold('cd-'+P,'📄 Campaign details &amp; brief', c.brief?preview(c.brief):'', details, c.stage==='invited')
      + (!approved&&!declined&&c.reason?'<div class="ci-hint">Note: '+esc(c.reason)+'</div>':'')
      + '</div>';
  }
  // 💰 my payment on a paid campaign — only MY fee, my details and their status
  var INR=function(n){ return '₹'+Math.round(+n||0).toLocaleString('en-IN'); };
  function payBoxMine(c){
    var f=c._flow||{}, p=f.payment; if(!f.paid || !p) return '';
    var P=esc(c.participation_id), days=p.due_days||f.due_days||7;
    var st={pending:['Add your bank / UPI details','warn'],submitted:['Received — being checked','na'],verifying:['Checking with your bank…','na'],
            verified:['Verified ✓','ok'],failed:['Couldn\'t verify — please update','warn'],needs_update:['Please update your details','warn']}[p.details_status]||[p.details_status,'na'];
    var det=p.method==='upi' ? 'UPI <b>'+esc(p.upi_id||'')+'</b>'
          : p.method==='bank' ? 'Bank account ••••<b>'+esc(p.account_last4||'')+'</b> · '+esc(p.ifsc||'')+(p.bank_name?' · '+esc(p.bank_name):'')
          : 'not added yet';
    var fee=p.amount!=null ? '<b>'+INR(p.amount)+'</b> — '+(p.advance_pct>=100 ? 'paid in advance once you sign'
          : p.advance_pct>0 ? INR(Math.round(p.amount*p.advance_pct/100))+' advance once you sign, the rest '+days+' days after every post is live'
          : 'paid '+days+' days after every post is live') : 'being finalised by the Geek team — you\'ll see it in your contract';
    var PART={advance:'Advance',balance:'Balance',full:'Fee'};
    var pos=(p.payouts||[]).map(function(o){
      var s={waiting:'Not due yet',due:'Due'+(o.due_at?' by '+fmtDate(o.due_at):''),queued:'Being sent',processing:'Sent — reaching your bank',
             paid:'Paid ✓'+(o.paid_at?' '+fmtDate(o.paid_at):'')+(o.utr?' · UTR '+esc(o.utr):''),failed:'Delayed — our team is on it',cancelled:'Cancelled'}[o.status]||o.status;
      return '<div class="mc-row"><span>'+(o.note==='part payment'?'Part payment':(PART[o.part]||o.part))+' · '+INR(o.amount)+'</span><span>'+s
        +(o.proof_path?' <button class="btn sm ghost" data-payproof="'+esc(o.proof_path)+'">📎 Screenshot</button>':'')+'</span></div>'; }).join('');
    var needs=['pending','failed','needs_update'].indexOf(p.details_status)>=0;
    var busy=(p.payouts||[]).some(function(o){ return o.status==='queued'||o.status==='processing'; });
    var allPaid=(p.payouts||[]).length && (p.payouts||[]).every(function(o){ return o.status==='paid'; });
    return '<div class="jr-now mc-pay'+(needs?' act':'')+'"><div class="jr-now-h">💰 <b>Your payment</b> <span class="ci-pill ci-'+st[1]+'">'+esc(st[0])+'</span></div>'
      + '<div class="jr-now-t">Fee: '+fee+(p.amount!=null&&(+p.paid_total||0)>0?'<br>Paid so far: <b>'+INR(p.paid_total)+'</b> · left <b>'+INR(p.left)+'</b>':'')+'<br>Paid to: '+det
      + (p.details_status==='needs_update'&&p.request_reason?'<div class="mc-note">“'+esc(p.request_reason)+'”</div>':'')
      + (p.details_status==='failed'&&p.verify_message?'<div class="mc-note">'+esc(p.verify_message)+'</div>':'')+'</div>'
      + (pos?'<div class="mc-grid">'+pos+'</div>':'')
      + (!busy&&!allPaid?'<div class="ci-evrow"><button class="btn sm'+(needs?'':' ghost')+'" data-paydetails="'+P+'">'+(p.method?'✏️ Update payment details':'🏦 Add payment details')+'</button></div>':'')
      + '<div class="muted" style="font-size:11.5px;margin-top:4px">Must be in your own name. Your fee is private — only you and the Geek team see it.</div></div>';
  }
  function openPayDetailsModal(part){
    var c=(_mineCache||[]).filter(function(x){ return x.participation_id===part; })[0]||{}, p=((c._flow||{}).payment)||{};
    var bank=p.method!=='upi';
    var ov=opsModal('<div class="ci-mh"><h3>Where should we pay you?</h3><button class="wa-x" id="opsMx">×</button></div>'
      + '<div class="ci-hint">Use a bank account or UPI ID in <b>your own name</b>. We verify it with the bank before any payment.</div>'
      + '<div class="cm-seg" id="pdM"><label class="'+(bank?'act':'')+'"><input type="radio" name="pdm" value="bank"'+(bank?' checked':'')+'> 🏦 Bank account</label>'
      +   '<label class="'+(!bank?'act':'')+'"><input type="radio" name="pdm" value="upi"'+(!bank?' checked':'')+'> 📱 UPI ID</label></div>'
      + '<label class="wa-f"><span>Account holder name (exactly as in the bank)</span><input id="pdName" maxlength="80" autocomplete="name" value="'+esc(p.account_name||'')+'"></label>'
      + '<div id="pdBank"'+(bank?'':' hidden')+'><label class="wa-f"><span>Account number</span><input id="pdNo" inputmode="numeric" autocomplete="off" maxlength="22" placeholder="'+(p.account_last4?'•••• '+esc(p.account_last4)+' — type the full number to change it':'e.g. 50100123456789')+'"></label>'
      +   '<label class="wa-f"><span>Type the account number again</span><input id="pdNo2" inputmode="numeric" autocomplete="off" maxlength="22"></label>'
      +   '<label class="wa-f"><span>IFSC code</span><input id="pdIfsc" maxlength="11" autocomplete="off" style="text-transform:uppercase" value="'+esc(p.ifsc||'')+'" placeholder="HDFC0001234"></label></div>'
      + '<div id="pdUpi"'+(bank?' hidden':'')+'><label class="wa-f"><span>UPI ID</span><input id="pdUpiId" maxlength="100" autocomplete="off" value="'+esc(p.upi_id||'')+'" placeholder="yourname@okhdfcbank"></label></div>'
      + '<div class="auth-err" id="pdErr"></div><div class="cp-ob-actions"><button class="btn sm ghost" id="pdCancel">Cancel</button><button class="btn sm" id="pdSave">Save &amp; verify</button></div>');
    var close=function(){ ov.remove(); };
    document.getElementById("opsMx").onclick=close; document.getElementById("pdCancel").onclick=close;
    ov.querySelectorAll('input[name=pdm]').forEach(function(r){ r.onchange=function(){ var b=ov.querySelector('input[name=pdm]:checked').value==='bank';
      document.getElementById("pdBank").hidden=!b; document.getElementById("pdUpi").hidden=b;
      ov.querySelectorAll('#pdM label').forEach(function(l){ l.classList.toggle('act', l.querySelector('input').checked); }); }; });
    document.getElementById("pdSave").onclick=function(){
      var btn=this, err=document.getElementById("pdErr"), m=ov.querySelector('input[name=pdm]:checked').value;
      var name=(document.getElementById("pdName").value||"").trim(), no=(document.getElementById("pdNo").value||"").replace(/[\s-]/g,""), no2=(document.getElementById("pdNo2").value||"").replace(/[\s-]/g,"");
      var ifsc=(document.getElementById("pdIfsc").value||"").trim().toUpperCase(), upi=(document.getElementById("pdUpiId").value||"").trim().toLowerCase();
      err.textContent="";
      if(name.length<3){ err.textContent="Type the account holder's full name."; return; }
      if(m==='bank'){
        if(!/^\d{9,18}$/.test(no)){ err.textContent="The account number should be 9 to 18 digits."; return; }
        if(no!==no2){ err.textContent="The two account numbers don't match."; return; }
        if(!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)){ err.textContent="The IFSC code is 11 characters, like HDFC0001234."; return; }
      } else if(!/^[a-z0-9._-]{2,255}@[a-z][a-z0-9.-]{1,63}$/.test(upi)){ err.textContent="The UPI ID looks wrong — it is like name@okhdfcbank."; return; }
      btn.disabled=true; btn.textContent="Saving…";
      api("save_payment_details",{ p_participation:part, p_method:m, p_account_name:name, p_account_no:m==='bank'?no:null, p_ifsc:m==='bank'?ifsc:null, p_upi:m==='upi'?upi:null })
        .then(function(r){ if(r.error){ err.textContent=r.error.message||r.error; btn.disabled=false; btn.textContent="Save & verify"; return; }
          close(); loadMyCampaigns(); }, function(e){ err.textContent=(e&&e.message)||String(e); btn.disabled=false; btn.textContent="Save & verify"; });
    };
  }
  // a payment screenshot: shown right here in the app (no pop-up to block), with Open + Download
  window.ciShowProof=function(path, btn){
    if(btn) btn.disabled=true;
    Promise.all([window.sb.storage.from("payment-proofs").createSignedUrl(path, 600),
                 window.sb.storage.from("payment-proofs").createSignedUrl(path, 600, { download:true })]).then(function(rr){
      if(btn) btn.disabled=false;
      var v=rr[0], d=rr[1];
      if(v.error||!v.data){ alert("Couldn't open the screenshot: "+((v.error&&v.error.message)||"try again")); return; }
      var url=v.data.signedUrl, dl=(d&&d.data&&d.data.signedUrl)||url, isPdf=/\.pdf$/i.test(path);
      var ov=document.createElement("div"); ov.className="ci-proof-ov";
      ov.style.cssText="position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:16px";
      ov.innerHTML='<div style="background:var(--panel,#fff);color:inherit;border-radius:14px;max-width:min(720px,100%);max-height:100%;overflow:auto;padding:14px 16px">'
        +'<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px"><b style="flex:1">📎 Payment screenshot</b><button type="button" class="btn sm ghost" data-x>✕</button></div>'
        +(isPdf?'<div class="muted" style="margin:8px 0 12px">PDF receipt — open or download it below.</div>':'<img src="'+esc(url)+'" alt="Payment screenshot" style="max-width:100%;border-radius:8px;display:block;margin:0 auto 12px">')
        +'<div style="display:flex;gap:8px;flex-wrap:wrap"><a class="btn sm" href="'+esc(dl)+'" download>⬇ Download</a><a class="btn sm ghost" href="'+esc(url)+'" target="_blank" rel="noopener">Open ↗</a></div></div>';
      ov.onclick=function(e){ if(e.target===ov || (e.target.closest && e.target.closest("[data-x]"))) ov.remove(); };
      document.body.appendChild(ov);
    }, function(){ if(btn) btn.disabled=false; });
  };
  function wireMine(){
    document.querySelectorAll("#opsMine [data-paydetails]").forEach(function(b){ b.onclick=function(){ openPayDetailsModal(b.getAttribute("data-paydetails")); }; });
    // the payment screenshot the Geek team uploaded — open / download it
    document.querySelectorAll("#opsMine [data-payproof]").forEach(function(b){ b.onclick=function(){ window.ciShowProof(b.getAttribute("data-payproof"), b); }; });
    document.querySelectorAll("#opsMine [data-accept]").forEach(function(b){ b.onclick=function(){ api("respond_to_campaign",{p_participation:b.getAttribute("data-accept"),p_accept:true,p_reason:null}).then(function(r){ if(r.error) alert(r.error.message||r.error); loadMyCampaigns(); }); }; });
    document.querySelectorAll("#opsMine [data-reject]").forEach(function(b){ b.onclick=function(){ var reason=prompt("No problem — tell the brand why you're passing (they see this):")||""; if(!reason) return; api("respond_to_campaign",{p_participation:b.getAttribute("data-reject"),p_accept:false,p_reason:reason}).then(function(r){ if(r.error) alert(r.error.message||r.error); loadMyCampaigns(); }); }; });
    document.querySelectorAll("#opsMine [data-upload]").forEach(function(b){ b.onclick=function(){ var url=prompt("Paste your content link (e.g. Instagram post URL):")||""; if(!url) return; var note=prompt("Note / question for the Geek team (optional):")||""; api("submit_content",{p_deliverable:b.getAttribute("data-upload"),p_content_url:url,p_note:note}).then(function(r){ if(r.error) alert(r.error.message||r.error); loadMyCampaigns(); }); }; });
    document.querySelectorAll("#opsMine [data-contract]").forEach(function(b){ b.onclick=function(){ openContractModal(b.getAttribute("data-contract")); }; });
    document.querySelectorAll("#opsMine [data-askai]").forEach(function(b){ b.onclick=function(){ openCampaignChat(b.getAttribute("data-askai")); }; });
    document.querySelectorAll("#opsMine .jr").forEach(function(j){ var n=j.querySelector(".jr-step.now"); if(n) j.scrollLeft=Math.max(0,n.offsetLeft-j.clientWidth/2+n.offsetWidth/2); });
    document.querySelectorAll("#opsMine [data-video]").forEach(function(b){ b.onclick=function(){ openVideoModal(b.getAttribute("data-video")); }; });
    document.querySelectorAll("#opsMine [data-readbrief]").forEach(function(b){ b.onclick=function(){
      var d=document.querySelector('#opsMine details[data-fold="vb-'+b.getAttribute("data-readbrief")+'"]');
      if(d){ d.open=true; MINE_OPEN['vb-'+b.getAttribute("data-readbrief")]=true; d.scrollIntoView({behavior:"smooth",block:"start"}); } }; });
    document.querySelectorAll("#opsMine [data-copy]").forEach(function(b){ b.onclick=async function(){ try{ await navigator.clipboard.writeText(b.getAttribute("data-copy")); b.textContent="Copied ✓"; setTimeout(function(){ b.textContent="Copy"; },1500); }catch(e){ prompt("Copy:", b.getAttribute("data-copy")); } }; });
    document.querySelectorAll("#opsMine [data-trk]").forEach(function(a){ a.addEventListener("click", function(){ var t=a.getAttribute("data-trk"); if(t){ try{ navigator.clipboard.writeText(t); }catch(e){} } }); });
    document.querySelectorAll("#opsMine [data-letspost]").forEach(function(b){ b.onclick=function(){ openLetsPost(b.getAttribute("data-letspost")); }; });
    document.querySelectorAll("#opsMine [data-fbstars]").forEach(function(box){
      box.querySelectorAll("[data-star]").forEach(function(st){ st.onclick=function(){ var n=+st.getAttribute("data-star"); box.setAttribute("data-val", n);
        box.querySelectorAll("[data-star]").forEach(function(x){ x.classList.toggle("on", +x.getAttribute("data-star")<=n); }); }; }); });
    document.querySelectorAll("#opsMine [data-fbsend]").forEach(function(b){ b.onclick=function(){
      var P=b.getAttribute("data-fbsend"), msg=document.getElementById("fbMsg"+P), stars=document.querySelector('#opsMine [data-fbstars="'+P+'"]');
      var val=function(id){ var e=document.getElementById(id+P); return e&&e.value ? e.value==="yes" : null; };
      var rating=+(stars&&stars.getAttribute("data-val")||0);
      if(!rating){ msg.textContent="Tap the stars to rate the campaign."; return; }
      b.disabled=true; b.textContent="Sending…";
      api("submit_campaign_feedback",{ p_participation:P, p_payload:{ rating:rating, brief_clear:val("fbClear"), smooth:val("fbSmooth"), again:val("fbAgain"),
        comment:(document.getElementById("fbText"+P).value||"").trim() } }).then(function(r){
        if(r.error){ msg.textContent=r.error.message||r.error; b.disabled=false; b.textContent="Submit feedback"; return; }
        loadMyCampaigns(); updateAlertsBadge(); }); }; });
    document.querySelectorAll("#opsMine [data-received]").forEach(function(b){ b.onclick=function(){
      if(!confirm("Confirm you've received the product? Your video brief unlocks now and your deadline starts.")) return;
      b.disabled=true; b.textContent="…";
      api("creator_mark_received",{p_participation:b.getAttribute("data-received")}).then(function(r){ if(r.error){ alert(r.error.message||r.error); b.disabled=false; b.textContent="📦 I received it"; return; } loadMyCampaigns(); updateAlertsBadge(); }); }; });
    document.querySelectorAll("#opsMine [data-address]").forEach(function(b){ b.onclick=function(){ openAddressModal(b.getAttribute("data-address")); }; });
    document.querySelectorAll("#opsMine [data-post]").forEach(function(b){ b.onclick=function(){ openPostModal(b.getAttribute("data-post"), b.getAttribute("data-postkind")); }; });
  }

  // ---- creator: approved → Let's post = straight to the in-app composer (Instagram → Post) with the campaign picked
  //      and format, caption, @mentions, #hashtags, collaborator and #ad filled in from the campaign ----
  function openLetsPost(part){
    window.__mkPreset={ participation_id: part };
    try{ if(typeof _igTab!=="undefined") _igTab="post"; }catch(e){}
    if(typeof currentPage!=="undefined") currentPage="instagram";
    if(typeof renderShell==="function") renderShell();
    window.scrollTo(0,0);
  }
  // "Reel 1/1 ✓ · Story 0/2" — what the campaign needs vs what is up
  function postProgressHtml(c){
    var kindOf=function(f){ f=String(f||"").toLowerCase(); return f==="reel"?"reel":f==="story"?"story":(f==="static_post"||f==="carousel"||f==="post")?"feed":null; };
    var need={}, done={}, label={reel:"Reel",story:"Story",feed:"Post"};
    (c.deliverables||[]).forEach(function(d){ var k=kindOf(d.format); if(k) need[k]=(need[k]||0)+Math.max(1,d.quantity||1); });
    (c.posts||[]).forEach(function(p){ var k=kindOf(p.media_type); if(k) done[k]=(done[k]||0)+1; });
    var ks=Object.keys(need); if(!ks.length) return '';
    return '<div class="mc-pp">'+ks.map(function(k){ var d=Math.min(done[k]||0,need[k]), ok=d>=need[k];
      return '<span class="mc-ppc'+(ok?' ok':'')+'">'+(ok?'✓ ':'')+label[k]+' <b>'+d+'/'+need[k]+'</b></span>'; }).join('')+'</div>';
  }
  // formats still to post (from the deliverables vs what's already up)
  function pendingFormats(c){
    var kindOf=function(f){ f=String(f||"").toLowerCase(); return f==="reel"?"reel":f==="story"?"story":(f==="static_post"||f==="carousel"||f==="post")?"feed":null; };
    var need={}, done={}, label={reel:"Reel",story:"Story",feed:"Post"};
    (c.deliverables||[]).forEach(function(d){ var k=kindOf(d.format); if(k) need[k]=(need[k]||0)+Math.max(1,d.quantity||1); });
    (c.posts||[]).forEach(function(p){ var k=kindOf(p.media_type); if(k) done[k]=(done[k]||0)+1; });
    return Object.keys(need).filter(function(k){ return (done[k]||0)<need[k]; }).map(function(k){ return label[k]; });
  }

  // ---- creator: record the reel/story posted (runs the caption/tag check + marks published) ----
  function openPostModal(part, kind){
    opsModal('<div class="ci-mh"><h3>Post your content</h3><button class="wa-x" id="opsMx">×</button></div>'
      + '<div class="ci-hint">Publish from your Media Kit, then record it here so we can check your caption against the brief and start tracking its performance.</div>'
      + '<label class="wa-f"><span>What did you post?</span><select id="opsPoMt"><option value="reel"'+(kind==="reel"?' selected':'')+'>Reel</option><option value="story"'+(kind==="story"?' selected':'')+'>Story</option><option value="post"'+(kind==="post"?' selected':'')+'>Feed post</option></select></label>'
      + '<label class="wa-f"><span>Link to the post (permalink)</span><input id="opsPoLink" placeholder="https://instagram.com/p/…"></label>'
      + '<label class="wa-f"><span>Caption you used</span><textarea id="opsPoCap" rows="3" placeholder="Paste your caption incl. #hashtags and @mentions"></textarea></label>'
      + '<div class="cp-ob-actions"><button class="btn sm ghost" id="opsPoMk">Open Media Kit</button><button class="btn sm" id="opsPoSave">Record post</button></div>'
      + '<div class="ci-hint cp-err-inline" id="opsPoErr"></div>');
    document.getElementById("opsMx").onclick=closeModal;
    document.getElementById("opsPoMk").onclick=function(){ closeModal(); if(typeof currentPage!=="undefined"){ currentPage="mediakit"; } if(typeof renderShell==="function") renderShell(); };
    document.getElementById("opsPoSave").onclick=function(){
      var err=document.getElementById("opsPoErr"); err.textContent="";
      var payload={ media_type:document.getElementById("opsPoMt").value, permalink:(document.getElementById("opsPoLink").value||"").trim(), caption:(document.getElementById("opsPoCap").value||"").trim() };
      if(!/^https?:\/\/(www\.|m\.)?instagram\.com\/(reel|reels|p|tv|stories)\//i.test(payload.permalink)){ err.textContent="Paste the Instagram link of the post (instagram.com/reel/… , /p/… or /stories/…)."; return; }
      var btn=this; btn.disabled=true; btn.textContent="Recording…";
      api("record_campaign_post",{p_participation:part,p_payload:payload}).then(function(r){
        if(r.error){ err.textContent=r.error.message||r.error; btn.disabled=false; btn.textContent="Record post"; return; }
        closeModal();
        if(r.data && r.data.caption_check==='issues'){ alert("Recorded — but your caption looks like it's missing a required hashtag or mention from the brief. Check your Alerts and update it."); }
        loadMyCampaigns(); updateAlertsBadge();
      });
    };
  }

  // ---- creator: AI helper for one campaign — answers from that campaign's own data (read on the server) ----
  var AI_CHATS = {};
  var GEEK_WA = "916398566704";
  function aiFmt(t){ return esc(t).replace(/\*\*(.+?)\*\*/g,"<b>$1</b>").replace(/(^|\n)[-•]\s+/g,"$1• ").replace(/\n/g,"<br>"); }
  function openCampaignChat(part){
    var c=(_mineCache||[]).filter(function(x){ return x.participation_id===part; })[0]||{};
    var hist = AI_CHATS[part] = AI_CHATS[part] || [{ role:"assistant", content:"Hi! 👋 Ask me anything about **"+(c.campaign||"this campaign")+"** — your next step, the contract, the brief, what to show in the video, the deadline or your courier. I answer from this campaign's own details." }];
    var SUG = ["What do I do next?","Explain my contract","What should my video show?","When does my product arrive?","When is the deadline?","How do I post?","Will I get paid?"];
    opsModal('<div class="ci-mh"><h3>💬 Questions? Ask us</h3><button class="wa-x" id="opsMx">×</button></div>'
      + '<div class="ci-hint" style="margin-top:-4px">'+esc(c.campaign||"")+(c.brand?' · '+esc(c.brand):'')+'</div>'
      + '<div class="cc-thread" id="ccThread"></div>'
      + '<div class="cc-sug" id="ccSug">'+SUG.map(function(q){ return '<button type="button" class="cs-chip" data-ccq="'+esc(q)+'">'+esc(q)+'</button>'; }).join("")+'</div>'
      + '<form class="cc-form" id="ccForm"><input id="ccIn" placeholder="Type your question…" autocomplete="off" maxlength="800"><button class="btn sm" id="ccSend">Send</button></form>'
      + '<div class="ci-hint" style="font-size:11.5px">Answers come from this campaign\'s details. Need something else? <a href="https://wa.me/'+GEEK_WA+'?text='+encodeURIComponent("Hi Geek team, I have a question about "+(c.campaign||"my campaign")+": ")+'" target="_blank" rel="noopener">talk to the Geek team on WhatsApp ↗</a></div>');
    document.getElementById("opsMx").onclick=closeModal;
    var paint=function(){ var th=document.getElementById("ccThread"); if(!th) return;
      th.innerHTML=hist.map(function(m){ return '<div class="cc-msg '+(m.role==="user"?"me":"bot")+(m._p?" pend":"")+'">'+aiFmt(m.content)+'</div>'; }).join("");
      th.scrollTop=th.scrollHeight; };
    var busy=false;
    var ask=async function(q){
      q=String(q||"").trim(); if(!q||busy) return; busy=true;
      hist.push({role:"user",content:q}); hist.push({role:"assistant",content:"…",_p:true}); paint();
      var inp=document.getElementById("ccIn"); if(inp) inp.value="";
      try{
        // built-in helper: reads THIS campaign's own data fresh from the backend and answers from it (no outside AI)
        var r={ data:null, error:null }, msg=null;
        var cr=await api("get_my_campaigns");
        var camp=((cr&&cr.data)||_mineCache||[]).filter(function(x){ return x.participation_id===part; })[0];
        if(cr && cr.data) _mineCache=cr.data;
        if(!camp) msg="This campaign isn't on your account any more.";
        else if(!window.CampaignHelper) msg="The helper is still loading — try again in a moment.";
        else {
          var kr=await api("get_my_contract",{p_participation:part}).then(function(x){ return x; }, function(){ return {data:null}; });
          r.data=window.CampaignHelper.answer(q, camp, (kr&&kr.data)||null);
        }
        hist=AI_CHATS[part]=hist.filter(function(m){ return !m._p; });
        hist.push({role:"assistant",content: msg ? "Sorry — "+msg : ((r.data&&r.data.reply)||"(no answer)")});
        if(!msg && r.data && Array.isArray(r.data.suggestions)){ var sg=document.getElementById("ccSug"); if(sg){ sg.innerHTML=r.data.suggestions.filter(function(x){ return x!==q; }).slice(0,6).map(function(x){ return '<button type="button" class="cs-chip" data-ccq="'+esc(x)+'">'+esc(x)+'</button>'; }).join(""); sg.querySelectorAll("[data-ccq]").forEach(function(b){ b.onclick=function(){ ask(b.getAttribute("data-ccq")); }; }); } }
      }catch(e){ hist=AI_CHATS[part]=hist.filter(function(m){ return !m._p; }); hist.push({role:"assistant",content:"Sorry — "+(e.message||e)}); }
      busy=false; paint(); var i2=document.getElementById("ccIn"); if(i2) i2.focus();
    };
    document.getElementById("ccForm").onsubmit=function(e){ e.preventDefault(); ask(document.getElementById("ccIn").value); };
    document.querySelectorAll("#ccSug [data-ccq]").forEach(function(b){ b.onclick=function(){ ask(b.getAttribute("data-ccq")); }; });
    paint(); setTimeout(function(){ var i=document.getElementById("ccIn"); if(i) i.focus(); }, 50);
  }

  // ---- creator: read the whole contract, accept ASCI + the non-delivery terms, sign ----
  async function openContractModal(part){
    var ctOv = opsModal('<div class="ci-mh"><h3>Your contract</h3><button class="wa-x" id="opsMx">×</button></div><div id="opsCtBody"><div class="muted">Loading…</div></div>');
    var ctBox = ctOv.querySelector(".cp-ob-modal"); if(ctBox) ctBox.classList.add("ct-modal");
    document.getElementById("opsMx").onclick=closeModal;
    try{
      var r=await api("get_my_contract",{p_participation:part}); if(r.error) throw r.error; var k=r.data;
      if(!k){ document.getElementById("opsCtBody").innerHTML='<div class="ci-err-inline">Your contract is being prepared — check back in a minute.</div>'; return; }
      var dl=(k.deliverables||[]), cl=(k.clauses||[]);
      var risky=cl.some(function(c){ return c.key==='non_delivery'||c.key==='reship'; });
      var noProd=!k.product && !k.product_value && !cl.some(function(c){ return c.key==='reship'; });   // a Paid campaign: nothing is shipped
      document.getElementById("opsCtBody").innerHTML=''
        + '<div class="ci-meta"><span>'+esc(k.brand||'')+' × <b>'+esc(k.campaign||'')+'</b></span><span>'+(noProd?'💰 Paid campaign — nothing is shipped':'Product: <b>'+esc(k.product||"—")+'</b>'+(k.product_value?' (₹'+esc(Number(k.product_value).toLocaleString("en-IN"))+')':''))+'</span>'
        + '<span>Make: <b>'+(dl.length?dl.map(function(x){ return esc(x.quantity||1)+'× '+esc(x.format||x.content_format||"content"); }).join(" + "):'—')+'</b></span>'
        + '<span>Post within <b>'+esc(k.content_days||7)+' days</b> of '+(noProd?'the video brief':'delivery')+'</span></div>'
        + (cl.length?'<div class="ct-clauses" id="opsCtScroll">'+cl.map(function(c,i){ return '<div class="ct-clause'+(c.key==='non_delivery'||c.key==='reship'||c.key==='approval'?' warn':'')+'"><b>'+(i+1)+'. '+esc(c.title)+'</b><div>'+esc(c.text)+'</div></div>'; }).join("")
                +'<div class="ct-end">— End of contract —</div></div>'
              :'<div class="ci-hint" style="margin-top:8px">Ad rights: '+esc(k.ad_rights_months||1)+' month(s) · Collab rights: '+(k.collab_rights?"Yes":"No")+'</div>')
        + '<div class="ct-gate" id="opsCtGate">↓ Read the whole contract — scroll to the end to accept and sign</div>'
        + '<div id="opsCtAccept" style="display:none">'
        +   '<label class="cp-check" style="margin-top:12px"><input type="checkbox" id="opsAsci"> <span>I have read the whole contract, I will follow the <b>ASCI</b> guidelines, and I will <b>post only after the brand approves my video</b> in the app.</span></label>'
        +   (risky?'<label class="cp-check"><input type="checkbox" id="opsTerms"> <span>'+(noProd?'I understand that if I don\'t submit my video within '+esc(k.content_days||7)+' days of the video brief, <b>my account is blocked</b> and <b>no fee is paid</b> for this campaign.':'I understand that if I receive the product and don\'t submit my video within '+esc(k.content_days||7)+' days, <b>my account is blocked</b> and I <b>must send the product to another creator at my own cost</b>.')+'</span></label>':'')
        +   (k.sign_as
              ? '<label class="wa-f"><span>Type your name exactly as on your profile: <b>'+esc(k.sign_as)+'</b></span><input id="opsSig" autocomplete="off" placeholder="'+esc(k.sign_as)+'"></label>'
                + '<div class="ci-hint" id="opsSigHint">Only the name on your Geek OS profile can sign this contract.</div>'
              : '<div class="ci-err-inline" style="margin-top:10px">Add your <b>first and last name</b> in Creator Profile first — the contract is signed with that name.</div>'
                + '<div class="cp-ob-actions" style="justify-content:flex-start"><button class="btn sm ghost" id="opsGoProfile">Open Creator Profile</button></div>')
        +   '<div class="ci-hint cp-err-inline" id="opsCtErr"></div>'
        +   '<div class="ct-signbar"><button class="btn" id="opsCtSign"'+(k.sign_as?'':' disabled')+'>✍️ Sign contract</button></div>'
        + '</div>';
      (function(){ var sc=document.getElementById("opsCtScroll"), gate=document.getElementById("opsCtGate"), acc=document.getElementById("opsCtAccept");
        var open=function(){ if(acc.style.display!=="none") return; gate.style.display="none"; acc.style.display="";
          // bring the ticks + Sign button into view
          setTimeout(function(){ try{ acc.scrollIntoView({behavior:"smooth", block:"end"}); }catch(e){} }, 60); };
        if(!sc || sc.scrollHeight <= sc.clientHeight + 4){ open(); return; }
        sc.addEventListener("scroll", function(){ if(sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 8) open(); });
        gate.onclick=function(){ if(sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 8){ open(); return; } sc.scrollBy({top:sc.clientHeight*0.8, behavior:"smooth"}); }; })();
      // the signature must match the profile name (checked again on the server)
      var normName=function(x){ return String(x||"").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu," ").replace(/\s+/g," ").trim(); };
      var sigIn=document.getElementById("opsSig"), sigHint=document.getElementById("opsSigHint");
      if(sigIn && k.sign_as) sigIn.oninput=function(){
        var ok=normName(sigIn.value)===normName(k.sign_as);
        sigHint.innerHTML = !sigIn.value.trim() ? "Only the name on your Geek OS profile can sign this contract."
          : ok ? '<span style="color:#12b76a;font-weight:600">✓ Matches your profile</span>' : 'Doesn\'t match — type <b>'+esc(k.sign_as)+'</b>';
      };
      var gp=document.getElementById("opsGoProfile"); if(gp) gp.onclick=function(){ closeModal(); if(typeof currentPage!=="undefined") currentPage="profile"; if(typeof renderShell==="function") renderShell(); };
      if(k.signed_at){ var sbn=document.getElementById("opsCtSign"); sbn.disabled=true; sbn.textContent="Signed "+fmtDate(k.signed_at); }
      document.getElementById("opsCtSign").onclick=function(){
        var err=document.getElementById("opsCtErr"); err.textContent="";
        var asci=document.getElementById("opsAsci").checked; var terms=risky?document.getElementById("opsTerms").checked:true;
        var sig=(document.getElementById("opsSig").value||"").trim();
        if(!asci){ err.textContent="Please accept the ASCI guidelines to sign."; return; }
        if(!terms){ err.textContent="Please accept the non-delivery terms to sign."; return; }
        if(!sig){ err.textContent="Please type your name to sign."; return; }
        if(k.sign_as && normName(sig)!==normName(k.sign_as)){ err.innerHTML="Type your name exactly as on your profile: <b>"+esc(k.sign_as)+"</b>"; return; }
        var btn=this; btn.disabled=true; btn.textContent="Signing…";
        if(window.Tracker) Tracker.security("contract_sign", { participation_id: part });
        api("sign_contract_v2",{p_participation:part,p_signature_name:sig,p_asci_ack:true,p_terms_ack:terms}).then(function(r2){
          if(r2.error){ err.textContent=r2.error.message||r2.error; btn.disabled=false; btn.textContent="✍️ Sign contract"; return; }
          closeModal(); loadMyCampaigns(); updateAlertsBadge();
        });
      };
    }catch(e){ var bd=document.getElementById("opsCtBody"); if(bd) bd.innerHTML='<div class="ci-err-inline">Couldn\'t load the contract: '+esc(e.message||e)+'</div>'; }
  }

  // ---- creator: submit the video (a link to the file) for the brand to review ----
  function openVideoModal(part){
    var c=(_mineCache||[]).filter(function(x){ return x.participation_id===part; })[0]||{};
    opsModal('<div class="ci-mh"><h3>Submit your video</h3><button class="wa-x" id="opsMx">×</button></div>'
      + (c.review&&c.review.decision==='changes_requested'&&c.review.reason?'<div class="mc-note" style="border-color:rgba(247,144,9,.6);margin-bottom:8px">Brand asked: “'+esc(c.review.reason)+'”</div>':'')
      + '<div class="vid-note"><b>⚠️ The link must open for everyone.</b> Upload your video to Google Drive and set <b>Share → General access → “Anyone with the link” → Viewer</b>. Open the link in a private / incognito window to check before you submit — if we can\'t open it, we\'ll ask you for a new link.</div>'
      + '<div class="ci-hint">Don\'t post it on Instagram yet — the brand approves it first.</div>'
      + '<label class="wa-f"><span>Link to your video</span><input id="opsVidUrl" placeholder="https://drive.google.com/…"></label>'
      + '<label class="wa-f"><span>Note for the brand (optional)</span><textarea id="opsVidNote" rows="2" placeholder="Two versions — v2 has the voice-over"></textarea></label>'
      + '<div class="cp-ob-actions"><button class="btn sm ghost" id="opsVidCancel">Cancel</button><button class="btn sm" id="opsVidSave">Submit for review</button></div>'
      + '<div class="ci-hint cp-err-inline" id="opsVidErr"></div>');
    document.getElementById("opsMx").onclick=closeModal; document.getElementById("opsVidCancel").onclick=closeModal;
    document.getElementById("opsVidSave").onclick=function(){
      var err=document.getElementById("opsVidErr"); err.textContent="";
      var url=(document.getElementById("opsVidUrl").value||"").trim(), note=(document.getElementById("opsVidNote").value||"").trim();
      if(!/^https?:\/\//i.test(url)){ err.textContent="Paste a link that starts with https://"; return; }
      var btn=this; btn.disabled=true; btn.textContent="Submitting…";
      api("submit_campaign_video",{p_participation:part,p_url:url,p_note:note||null}).then(function(r){
        if(r.error){ err.textContent=r.error.message||r.error; btn.disabled=false; btn.textContent="Submit for review"; return; }
        closeModal(); loadMyCampaigns(); updateAlertsBadge();
      });
    };
  }

  // ---- creator: confirm delivery address — pick a saved one, edit it, add a new one, or use current location ----
  async function openAddressModal(part){
    opsModal('<div class="ci-mh"><h3>Where should we ship your product?</h3><button class="wa-x" id="opsMx">×</button></div><div id="opsAdBody"><div class="muted">Loading your addresses…</div></div>');
    document.getElementById("opsMx").onclick=closeModal;
    var addrs=[], editing=null;
    var line=function(a){ return [a.line1,a.line2,a.landmark,a.city,a.state,a.postal_code].filter(Boolean).join(", "); };
    var who={ name:"", phone:"" }, ctl=null;
    // an address the courier can use: everything filled (older addresses may miss the name / mobile / area / landmark)
    var complete=function(x){ return !!(x && x.recipient_name && x.recipient_phone && x.line1 && x.line2 && x.landmark && x.city && x.state && /^[1-9]\d{5}$/.test(x.postal_code||"")); };
    var paint=function(showForm){
      var body=document.getElementById("opsAdBody"); if(!body) return;
      var a=editing||{};
      if(showForm){
        // adding / editing: only the form — no saved list, no extra buttons
        body.innerHTML='<div class="ad-form solo" id="opsAdForm">'
          + '<div class="ad-form-h"><b>'+(editing&&editing.address_id?'Edit address':'Add a new address')+'</b>'+(addrs.length?'<button type="button" class="ad-back" id="opsAdBack">← Saved addresses</button>':'')+'</div>'
          + '<div id="opsAdFields"></div>'
          + '<div class="cp-ob-actions"><button class="btn" id="opsAdNew">Save &amp; ship here</button></div></div>'
          + '<div class="ci-hint cp-err-inline" id="opsAdErr"></div>';
        if(window.GeekAddress) ctl=window.GeekAddress.mount(document.getElementById("opsAdFields"), a, who);
        var bk=document.getElementById("opsAdBack"); if(bk) bk.onclick=function(){ editing=null; paint(false); };
      } else {
      var form='';
      body.innerHTML=(addrs.length
          ? '<div class="ad-list">'+addrs.map(function(x,i){ var ok=complete(x); return '<label class="ad-opt'+(ok?'':' ad-incomplete')+'"><input type="radio" name="opsAddr" value="'+esc(x.address_id)+'"'+((x.is_default||i===0)?' checked':'')+'>'
              + '<span><b>'+esc(x.label||"Address")+'</b>'+(x.is_default?' <em>Default</em>':'')+(ok?'':' <em class="ad-warn">Needs a few details</em>')
              + '<br>'+(x.recipient_name?esc(x.recipient_name)+' · '+esc(x.recipient_phone||"")+'<br>':'')+esc(line(x))+'</span>'
              + '<button type="button" class="btn sm ghost" data-adedit="'+esc(x.address_id)+'">Edit</button></label>'; }).join("")+'</div>'
            + '<div class="cp-ob-actions ad-acts"><button class="btn sm ghost" id="opsAdAdd">+ Add a new address</button><button class="btn sm" id="opsAdSave">Ship to this address</button></div>'
          : '')
        + form + '<div class="ci-hint cp-err-inline" id="opsAdErr"></div>';
      }
      var add=document.getElementById("opsAdAdd"); if(add) add.onclick=function(){ editing=null; paint(true); };
      document.querySelectorAll("#opsAdBody [data-adedit]").forEach(function(b){ b.onclick=function(e){ e.preventDefault(); editing=addrs.filter(function(x){ return x.address_id===b.getAttribute("data-adedit"); })[0]; paint(true); }; });
      var save=document.getElementById("opsAdSave");
      if(save) save.onclick=function(){
        var err=document.getElementById("opsAdErr"); err.textContent=""; var sel=document.querySelector('#opsAdBody input[name=opsAddr]:checked');
        if(!sel){ err.textContent="Pick an address."; return; }
        var picked=addrs.filter(function(x){ return x.address_id===sel.value; })[0];
        if(!complete(picked)){ editing=picked; paint(true); var e2=document.getElementById("opsAdErr"); if(e2) e2.textContent="This address needs a few more details for the courier — fill them in and save."; return; }
        var btn=this; btn.disabled=true; btn.textContent="Confirming…";
        api("confirm_campaign_address",{p_participation:part,p_address_id:sel.value}).then(function(r2){
          if(r2.error){ err.textContent=r2.error.message||r2.error; btn.disabled=false; btn.textContent="Ship to this address"; return; }
          closeModal(); loadMyCampaigns(); updateAlertsBadge();
        });
      };
      var nb=document.getElementById("opsAdNew");
      if(nb) nb.onclick=async function(){
        var err=document.getElementById("opsAdErr"); err.textContent="";
        var btn=this;
        try{
          if(!ctl) throw new Error("The address form didn't load — refresh the page.");
          var payload=await ctl.collect({ label:(editing&&editing.label)||"Home", is_default: (editing&&editing.address_id) ? !!editing.is_default : true });
          if(editing && editing.address_id) payload.address_id=editing.address_id;
          btn.disabled=true; btn.textContent="Saving…";
          var r1=await api("upsert_address",{p_payload:payload,p_correlation:"ui-campaign"}); if(r1.error) throw r1.error;
          var aid=(r1.data&&r1.data.address_id)||r1.data||(editing&&editing.address_id);
          var r2=await api("confirm_campaign_address",{p_participation:part,p_address_id:aid}); if(r2.error) throw r2.error;
          closeModal(); loadMyCampaigns(); updateAlertsBadge();
        }catch(e){ err.textContent=(e&&e.message)||String(e); btn.disabled=false; btn.textContent="Save & ship here"; }
      };
    };
    try{
      var r=await api("get_my_profile"); var prof=(r && !r.error)?r.data:null; addrs=(prof&&prof.addresses)||[];
      var pe=(prof&&prof.personal)||{}; who.name=[pe.first_name,pe.last_name].filter(Boolean).join(" ");
      who.phone=((prof&&prof.contact)||{}).whatsapp_e164||((prof&&prof.contact)||{}).phone_e164||"";
      paint(!addrs.length);
    }catch(e){ var bd=document.getElementById("opsAdBody"); if(bd) bd.innerHTML='<div class="ci-err-inline">Couldn\'t load addresses: '+esc(e.message||e)+'</div>'; }
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
      + '<div id="opsOnbBody">'+(window.skel?skel("list",2):'<div class="card"><div class="muted">Loading…</div></div>')+'</div></div>';
  };
  async function loadOnboarding(){
    try{
      var st=await apiCreator("get_my_onboarding_status"); if(st.error) throw st.error;
      var pr=await api("get_my_profile");   // optional enrichment; resolves with {error} rather than throwing
      renderOnb(st.data||{}, (pr&&!pr.error?pr.data:null));
    }catch(e){ document.getElementById("opsOnbBody").innerHTML='<div class="card ci-err-inline">Couldn\'t load: '+esc(e.message||e)+'</div>'; }
  }
  function renderOnb(s, prof){
    var pro=(prof&&prof.professional)||{}, brands=((prof&&prof.brand_experience)||[]).filter(function(b){return !b.creator_rejected_at;});
    var req=window.__profileReq||null, ig=!!(s.instagram_connected||window.__hasIg), done=!!((req&&req.complete)||s.basic_complete);
    var needs=window.__joinNeeds||[], wa=!needs.some(function(x){ return /whatsapp/i.test(x); });
    if(needs.some(function(x){ return /instagram/i.test(x); })) ig=false;
    var checks=[
      ["Instagram connected (media kit)", ig],
      ["WhatsApp connected", wa],
      ["Profile complete (optional)", done]
    ];
    var ready=ig&&wa;
    s.status = ready ? 'campaign_ready' : (s.status==='campaign_ready' ? 'profile_complete' : s.status);
    if(req && req.total) s.profile_pct = Math.round(100*req.done/req.total);
    var FUNNEL=[["STARTED",true],["CONNECTED",ig&&wa],["CAMPAIGN READY",ready]];
    var funnel='<div class="ops-funnel">'+FUNNEL.map(function(f){ return '<div class="ops-fstep '+(f[1]?"on":"")+'">'+(f[1]?"✓":"○")+' '+esc(f[0])+'</div>'; }).join('<span class="ops-farrow">→</span>')+'</div>';
    var pct=(s.profile_pct!=null?s.profile_pct:0);
    var body='<div class="ops-onb"><div class="ci-mh"><h4>'+(ready?'✅ You\'re campaign-ready':'Status: '+esc((s.status||"started").replace(/_/g," ")))+'</h4><span class="ci-pill '+(s.status==='campaign_ready'?'ci-ok':'ci-warn')+'">'+(pct)+'% profile</span></div>'
      + funnel
      + '<div class="ops-checks">'+checks.map(function(c){ return '<div class="ops-check '+(c[1]?"on":"")+'">'+(c[1]?"✓":"○")+' '+esc(c[0])+'</div>'; }).join("")+'</div>'
      + '<div class="ci-note">'+(ready?'You\'re connected — invitations appear under “My Campaigns”.'+(done?'':' Completing your profile is optional but helps brands pick you.'):'Connect Instagram (media kit) and WhatsApp to open campaigns. The profile is optional.')+'</div></div>';
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
    if(typeof window.openCampaignModal==="function"){
      box.innerHTML='<div class="card"><h4>New campaign brief</h4><div class="muted" style="margin-bottom:10px">The same campaign form as everywhere else — deliverables, hashtags, mentions, contract and video brief.</div><button class="btn" id="opsBrandOpen">＋ New campaign</button></div>';
      document.getElementById("opsBrandOpen").onclick=function(){ window.openCampaignModal(null); };
      return;
    }
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

  window.ciOps={ boot:boot, loadAgencyOps:loadAgencyOps, loadMyCampaigns:loadMyCampaigns, loadOpenCampaigns:loadOpenCampaigns, loadOnboarding:loadOnboarding, loadBrandSetup:loadBrandSetup,
    loadAlerts:loadAlerts, updateAlertsBadge:updateAlertsBadge, openCampaignDetail:openCampaignDetail, openContractModal:openContractModal };

  var tries=0, t=setInterval(function(){ tries++;
    if(window.sb && window.Auth && Auth.profile){ clearInterval(t); boot(); }
    else if(tries>40) clearInterval(t);
  }, 800);
})();
