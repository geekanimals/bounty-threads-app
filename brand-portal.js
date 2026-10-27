/* 🏢 Brand portal — what a brand login sees (and the Super Admin's "View as brand" preview).
   Only the brand's own campaigns: progress, creators (public profile only), videos to approve, creators to approve,
   posts, analytics and downloadable reports. Data: api.brand_portal / api.brand_campaign / api.campaign_analytics;
   actions: api.org_decide_applicant (creator), api.bp_review_video (video). Facebook Login for Business: brand-fb-login. */
(function(){
  var BP = { data:null, err:null, open:null, tab:"creators", camp:{}, an:{}, preview:null, host:null, page:"dashboard", busy:false };
  var api = function(fn, args){ return sb.schema("api").rpc(fn, args||{}).then(function(r){ return r; }, function(e){ return { error:e }; }); };
  var n = function(v){ return v==null||v===""||isNaN(Number(v)) ? "—" : Number(v).toLocaleString("en-IN"); };
  var short = function(v){ v = Number(v)||0; return v>=1e7 ? (v/1e7).toFixed(1).replace(/\.0$/,"")+" Cr" : v>=1e5 ? (v/1e5).toFixed(1).replace(/\.0$/,"")+" L" : v>=1e3 ? (v/1e3).toFixed(1).replace(/\.0$/,"")+"K" : String(v); };
  var date = function(d){ return d ? fmtDate(d) : "—"; };
  var TYPE = { paid:"💰 Paid", barter:"🎁 Barter", barter_paid:"🎁 Barter + 💰 Paid" };
  var STATUS = { creator_discovery:"Live · taking creators", in_execution:"Live · in progress", completed:"Completed", draft:"Draft", paused:"Paused", closed:"Closed" };
  var STEPS = [["to_approve","To approve"],["approved","Approved"],["shipped","Shipped / making"],["video_review","Video review"],["posting","Posting"],["posted","Posted"]];
  var count = function(c, k){ var x = (c.counts||{}); return k==="shipped" ? (x.shipped||0)+(x.making||0) : (x[k]||0); };
  var total = function(c){ var x = c.counts||{}, t = 0; Object.keys(x).forEach(function(k){ if(k!=="not_selected") t += x[k]; }); return t; };
  var avatar = function(cr){ cr = cr||{}; var ini = String(cr.name || cr.username || "?").replace(/[^\p{L}\p{N}]/gu,"").slice(0,1).toUpperCase() || "?";
    return '<span class="bpx-avw"><span class="bpx-av bpx-av-t">'+esc(ini)+'</span>'+(cr.profile_picture_url?'<img class="bpx-av" src="'+esc(cr.profile_picture_url)+'" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">':'')+'</span>'; };
  var can = function(){ return !BP.data || BP.data.role !== "viewer"; };          // a view-only login sees no approve buttons
  var who = function(cr, pid, inv){ cr = cr||{}; var open = (pid||inv) ? ' data-bpxcard="'+esc(pid||"")+'" data-bpxinv="'+esc(inv||"")+'" role="button" tabindex="0" title="Open profile"' : '';
    return '<div class="bpx-who'+(open?' bpx-who-link':'')+'"'+open+'>'+avatar(cr)+'<div style="min-width:0"><b>'+esc(cr.name||cr.username||"Creator")+'</b><div class="muted">'
      +(cr.username?'<a href="https://instagram.com/'+esc(cr.username)+'" target="_blank" rel="noopener">@'+esc(cr.username)+'</a>':'')
      +(cr.followers?' · '+short(cr.followers)+' followers':'')+(cr.city?' · '+esc(cr.city):'')+'</div></div></div>'; };
  var root = function(){ return BP.host ? BP.host : document.getElementById("content"); };
  var brandName = function(){ var b = (BP.data&&BP.data.brands)||[]; return b.length ? b.map(function(x){ return x.name; }).join(", ") : "your brand"; };

  async function load(force){
    if(BP.data && !force) return BP.data;
    var r = await api("brand_portal", { p_brand: BP.preview || null });
    BP.err = r.error ? (r.error.message||String(r.error)) : null; BP.data = r.error ? null : r.data;
    return BP.data;
  }
  async function loadCamp(id, force){
    if(BP.camp[id] && !force) return BP.camp[id];
    var r = await api("brand_campaign", { p_campaign:id }); if(r.error) throw r.error; BP.camp[id] = r.data; return r.data;
  }
  async function loadAn(id, force){
    if(BP.an[id] && !force) return BP.an[id];
    var r = await api("campaign_analytics", { p_campaign:id }); BP.an[id] = r.error ? { error:r.error.message } : r.data; return BP.an[id];
  }

  // ------------------------------------------------------------------ pages
  function shell(inner){ return BP.preview ? previewTabs()+inner : inner; }
  function previewTabs(){
    return '<div class="bpx-ptabs">'+[["dashboard","🏠 Dashboard"],["approvals","✅ Approvals"],["campaigns","📣 Campaigns"],["creators","⭐ Saved creators"],["reports","📊 Reports"],["settings","⚙️ Settings"]].map(function(t){
      return '<button class="bpx-chip'+(BP.page===t[0]?' on':'')+'" data-bpxgo="'+t[0]+'">'+t[1]+'</button>'; }).join("")+'</div>';
  }
  function render(page){
    BP.page = page;
    var head = {dashboard:["Dashboard","Your campaigns with Geek — live progress, creators and results."],
      approvals:["Approvals","Creators who want to join your campaigns, and videos waiting for your OK."],
      campaigns:["Campaigns","Every campaign we run for you — open one to see each creator and where they are."],
      reports:["Reports","Campaign results — download them as Excel (CSV) or PDF."],
      creators:["Saved creators","Creators you ⭐ saved — to use again in your next campaign."],
      settings:["Settings","Your login and your Facebook business."]}[page] || ["Dashboard",""];
    return shell((BP.preview?'':pageHead(head[0], head[1]))+'<div id="bpxBody">'+skel(page==="campaigns"&&BP.open?"list":"dash", 4)+'</div>');
  }
  async function mount(page){
    BP.page = page;
    var box = root(); if(!box) return;
    box.querySelectorAll("[data-bpxgo]").forEach(function(b){ b.onclick = function(){ BP.open = null; go(b.dataset.bpxgo); }; });
    await load();
    var body = box.querySelector("#bpxBody"); if(!body) return;
    if(BP.err){ body.innerHTML = '<div class="card"><div class="ci-err-inline">'+esc(BP.err)+'</div>'+(/brand_portal/.test(BP.err)?'<div class="muted" style="margin-top:6px">Run <code>supabase db push</code>.</div>':'')+'</div>'; return; }
    if(page==="approvals") return paintApprovals(body);
    if(page==="campaigns") return BP.open ? paintCampaign(body, BP.open) : paintCampaignList(body);
    if(page==="reports") return paintReports(body);
    if(page==="settings") return paintSettings(body);
    if(page==="creators") return paintSaved(body);
    return paintDash(body);
  }
  function go(page, campaign){
    if(campaign!==undefined) BP.open = campaign;
    if(BP.preview){ var h = BP.host; h.innerHTML = render(page); mount(page); h.scrollTop = 0; return; }
    currentPage = page; renderShell(); window.scrollTo(0,0);
  }
  async function refresh(){ BP.camp = {}; BP.an = {}; BP.top = {}; await load(true); go(BP.page); }

  // ---------- dashboard
  function paintDash(body){
    var d = BP.data, C = d.campaigns||[], live = C.filter(function(c){ return /discovery|execution/.test(c.status||""); });
    var sum = function(k){ return C.reduce(function(a,c){ return a+count(c,k); },0); };
    var fb = d.facebook;
    body.innerHTML =
      '<div class="bpx-hello"><div><div class="muted" style="font-size:13px">'+(BP.preview?'Brand dashboard':'Welcome'+(d.me&&d.me.name?', '+esc(d.me.name):''))+'</div><h2>'+esc(brandName())+'</h2></div>'
      +'<div style="display:flex;gap:8px;flex-wrap:wrap">'+(can()?'<button class="btn sm" data-bpxreq>➕ Request a new campaign</button>':'')
      +(fb?'<span class="tag good" style="align-self:center">✓ Facebook business linked</span>':'<button class="btn sm ghost" data-bpxfb>🔗 Link Facebook business</button>')+'</div></div>'
      +(can()?'':'<div class="card bpx-note">👁 You have a <b>view-only</b> login — you can see everything; approvals are done by your team\'s approvers.</div>')
      +'<div class="bpx-kpis">'
      + kpi("📣", live.length, "Live campaigns", C.length+" in total")
      + kpi("🧑‍🎤", sum("approved")+sum("shipped")+sum("video_review")+sum("posting")+sum("posted"), "Creators on board", sum("to_approve")+" waiting for you")
      + kpi("🎬", (d.videos||[]).length, "Videos to review", (d.videos||[]).length?"Tap Approvals":"All caught up")
      + kpi("📸", C.reduce(function(a,c){ return a+(Number(c.posts)||0); },0), "Posts live", sum("posted")+" creators posted")
      + '<div class="bpx-kpi" id="bpxViews"><div class="bpx-kpi-ic">👀</div><b>…</b><span>Views</span><small class="muted">across all campaigns</small></div>'
      + '<div class="bpx-kpi" id="bpxEng"><div class="bpx-kpi-ic">❤️</div><b>…</b><span>Likes + comments</span><small class="muted">across all campaigns</small></div>'
      +'</div>'
      +((d.to_approve||[]).length||(d.videos||[]).length ? '<div class="card bpx-todo"><div class="bpx-h"><h3>⏳ Waiting for you</h3><button class="btn sm" data-bpxgo2="approvals">Open approvals →</button></div>'
         +'<div class="bpx-todo-g">'
         +((d.to_approve||[]).length?'<div class="bpx-todo-i"><b>'+d.to_approve.length+'</b> creator'+(d.to_approve.length===1?'':'s')+' to approve<div class="muted">'+esc(uniq(d.to_approve.map(function(x){ return x.campaign; })).join(", "))+'</div></div>':'')
         +((d.videos||[]).length?'<div class="bpx-todo-i"><b>'+d.videos.length+'</b> video'+(d.videos.length===1?'':'s')+' to review<div class="muted">'+esc(uniq(d.videos.map(function(x){ return x.campaign; })).join(", "))+'</div></div>':'')
         +'</div></div>' : '')
      +'<div class="bpx-h" style="margin-top:18px"><h3>Your campaigns</h3></div>'
      +(C.length ? '<div class="bpx-cgrid">'+C.map(campCard).join("")+'</div>' : '<div class="card muted">No campaigns yet — your campaigns show up here as soon as the Geek team sets them up.'+(can()?' <a href="#" data-bpxreq>Request one →</a>':'')+'</div>')
      +'<div id="bpxDashTop"></div>'
      +(fb ? fbCard(fb) : '');
    wireCommon(body);
    // views / likes across campaigns (analytics per campaign)
    Promise.all(C.map(function(c){ return loadAn(c.campaign_id); })).then(function(all){
      var v = 0, e = 0; all.forEach(function(a){ var t = (a&&a.totals)||{}; v += Number(t.views)||0; e += (Number(t.likes)||0)+(Number(t.comments)||0); });
      var a1 = body.querySelector("#bpxViews b"), a2 = body.querySelector("#bpxEng b"); if(a1) a1.textContent = short(v); if(a2) a2.textContent = short(e);
    });
    // 🏆 best posts across every campaign
    var withPosts = C.filter(function(c){ return Number(c.posts)>0; });
    if(withPosts.length) Promise.all(withPosts.map(function(c){ return loadTop(c.campaign_id).then(function(L){ return L.map(function(x){ x.campaign = c.name; return x; }); }); })).then(function(all){
      var L = [].concat.apply([], all).sort(function(a,b){ return (Number(b.views)||0)-(Number(a.views)||0); }).slice(0,5);
      var box = body.querySelector("#bpxDashTop"); if(box && L.length) box.innerHTML = '<div class="card" style="margin-top:18px"><div class="bpx-h"><h3>🏆 Top posts</h3><span class="muted" style="font-size:12.5px">by views, across your campaigns</span></div>'+topGrid(L, true)+'</div>';
    });
  }
  function uniq(a){ return a.filter(function(x,i){ return x && a.indexOf(x)===i; }); }
  function kpi(ic, v, l, s){ return '<div class="bpx-kpi"><div class="bpx-kpi-ic">'+ic+'</div><b>'+esc(typeof v==="string"&&isNaN(Number(v))?v:n(v))+'</b><span>'+esc(l)+'</span><small class="muted">'+esc(s||"")+'</small></div>'; }
  function campCard(c){
    var t = total(c), done = count(c,"posted"), pct = t ? Math.round(100*done/t) : 0;
    return '<div class="card bpx-camp" tabindex="0" role="button" data-bpxopen="'+esc(c.campaign_id)+'">'
      +'<div class="bpx-camp-h"><div style="min-width:0"><h4>'+esc(c.name)+'</h4><div class="muted">'+esc(TYPE[c.campaign_type]||"")+(c.product?' · '+esc(c.product):'')+'</div></div>'
      +'<span class="tag'+(/discovery|execution/.test(c.status||"")?' good':'')+'">'+esc(STATUS[c.status]||c.status||"")+'</span></div>'
      +'<div class="bpx-steps">'+STEPS.map(function(s){ var k = count(c,s[0]); return '<div class="'+(k?'on':'')+'"><b>'+k+'</b><span>'+s[1]+'</span></div>'; }).join("")+'</div>'
      +'<div class="bpx-bar"><i style="width:'+pct+'%"></i></div>'
      +'<div class="bpx-camp-f muted"><span>'+done+' of '+t+' creators posted'+(c.creators_needed?' · '+esc(c.creators_needed)+' needed':'')+'</span><span>'+(c.ends_on?'Till '+date(c.ends_on):'')+'</span></div></div>';
  }
  function fbCard(fb){
    var P = fb.pages||[], A = fb.ad_accounts||[], B = fb.businesses||[];
    return '<div class="card" style="margin-top:18px"><div class="bpx-h"><h3>📘 Your Facebook business</h3><button class="btn sm ghost" data-bpxfbrefresh>↻ Refresh</button></div>'
      +(B.length?'<div class="muted" style="margin-bottom:8px">Business Manager: <b>'+esc(B.map(function(b){ return b.name; }).join(", "))+'</b></div>':'')
      +(P.length?'<div class="bpx-fbg">'+P.map(function(p){ var ig = p.instagram;
          return '<div class="bpx-fbp"><b>'+esc(p.name)+'</b><div class="muted">'+(p.followers!=null?short(p.followers)+' Page followers':'')+(p.reach_28d!=null?' · '+short(p.reach_28d)+' reach (28 days)':'')+'</div>'
            +(ig?'<div style="margin-top:4px">📷 @'+esc(ig.username)+(ig.followers!=null?' · '+short(ig.followers)+' followers':'')+(ig.posts!=null?' · '+n(ig.posts)+' posts':'')+'</div>':'')+'</div>'; }).join("")+'</div>':'<div class="muted">No Pages shared with Geek OS.</div>')
      +(A.length?'<div class="muted" style="margin-top:10px">Ad accounts: '+A.map(function(a){ return '<b>'+esc(a.name||a.id)+'</b>'+(a.spent!=null?' ('+esc(a.currency||"")+' '+n(a.spent)+' spent)':''); }).join(" · ")+'</div>':'')
      +'<div class="muted" style="font-size:12px;margin-top:8px">Updated '+fmtDateTime(fb.refreshed_at)+'</div></div>';
  }

  // ---------- approvals
  function paintApprovals(body){
    var d = BP.data, A = d.to_approve||[], V = d.videos||[];
    body.innerHTML =
      (can()?'':'<div class="card bpx-note">👁 View-only login — approvals are done by your team\'s approvers.</div>')
      +'<div class="card"><div class="bpx-h"><h3>🧑‍🎤 Creators to approve <span class="muted" style="font-weight:500">('+A.length+')</span></h3>'+(A.length&&can()?bulkBar("c"):'')+'</div>'
      +(A.length ? '<div class="bpx-list">'+A.map(function(x){ return '<div class="bpx-row">'+'<div class="bpx-wsel">'+selBox("c", x.participation_id)+who(x.creator, x.participation_id)+'</div>'
          +'<div class="bpx-row-m muted">'+esc(x.campaign)+'<br>Applied '+date(x.applied_at)+'</div>'
          +'<div class="bpx-acts">'+(can()?'<button class="btn sm" data-bpxok="'+esc(x.participation_id)+'">Approve</button><button class="btn sm ghost" data-bpxno="'+esc(x.participation_id)+'">Decline</button>':'<span class="tag">Waiting</span>')+'</div></div>'; }).join("")+'</div>'
        : '<div class="muted">Nobody waiting — you\'re all caught up.</div>')+'</div>'
      +'<div class="card" style="margin-top:16px"><div class="bpx-h"><h3>🎬 Videos to review <span class="muted" style="font-weight:500">('+V.length+')</span></h3>'+(V.length&&can()?bulkBar("v"):'')+'</div>'
      +(V.length ? '<div class="bpx-list">'+V.map(function(x){ return '<div class="bpx-row">'+'<div class="bpx-wsel">'+selBox("v", x.participation_id)+who(x.creator, x.participation_id)+'</div>'
          +'<div class="bpx-row-m muted">'+esc(x.campaign)+'<br>Sent '+fmtDateTime(x.submitted_at)+(x.note?'<br>“'+esc(x.note)+'”':'')+'</div>'
          +'<div class="bpx-acts">'+(x.video_url?watchBtn(x.video_url, x.participation_id, x.creator, x.campaign, true):'')
          +(can()?'<button class="btn sm" data-bpxvok="'+esc(x.participation_id)+'">Approve</button><button class="btn sm ghost" data-bpxvno="'+esc(x.participation_id)+'">Ask for changes</button>':'')+'</div></div>'; }).join("")+'</div>'
        : '<div class="muted">No videos waiting for review.</div>')+'</div>';
    wireCommon(body); wireBulk(body);
  }

  // ---------- campaigns
  function paintCampaignList(body){
    var C = BP.data.campaigns||[], Q = BP.data.requests||[];
    var RS = { new:["Sent","warn"], in_review:["Geek team is working on it","warn"], converted:["Set up ✓","good"], declined:["Not taken up",""] };
    body.innerHTML = (can()?'<div style="margin-bottom:14px"><button class="btn sm" data-bpxreq>➕ Request a new campaign</button></div>':'')
      +(Q.length?'<div class="card" style="margin-bottom:16px"><h3 style="margin-top:0">📝 Your campaign requests</h3>'+Q.map(function(q){ var r = RS[q.status]||[q.status,""];
          return '<div class="bpx-kv"><span>'+date(q.created_at)+'</span><div><b>'+esc(q.name)+'</b> <span class="tag '+r[1]+'">'+esc(r[0])+'</span>'+(q.admin_note?'<div class="muted" style="font-size:12.5px">'+esc(q.admin_note)+'</div>':'')+'</div></div>'; }).join("")+'</div>':'')
      +(C.length ? '<div class="bpx-cgrid">'+C.map(campCard).join("")+'</div>' : '<div class="card muted">No campaigns yet.</div>');
    wireCommon(body);
  }
  async function paintCampaign(body, id){
    var d;
    try{ d = await loadCamp(id); }catch(e){ body.innerHTML = '<div class="card"><div class="ci-err-inline">'+esc(e.message||String(e))+'</div></div>'; return; }
    var c = d.campaign, R = d.creators||[], k = {}; R.forEach(function(x){ var s = (x.status||{}).key; k[s] = (k[s]||0)+1; });
    var cc = { counts:k }, tabs = [["creators","🧑‍🎤 Creators ("+R.filter(function(x){ return (x.status||{}).key!=="not_selected"; }).length+")"],["analytics","📊 Analytics"],["brief","📝 Brief"],["activity","🕒 Activity"]];
    body.innerHTML = '<button class="btn sm ghost" data-bpxback>← All campaigns</button>'
      +'<div class="card" style="margin-top:12px"><div class="bpx-camp-h"><div style="min-width:0"><h2 style="margin:0">'+esc(c.name)+'</h2>'
      +'<div class="muted">'+esc(TYPE[c.campaign_type]||"")+(c.product?' · '+esc(c.product):'')+(c.starts_on||c.ends_on?' · '+date(c.starts_on)+' – '+date(c.ends_on):'')+'</div></div>'
      +'<span class="tag'+(/discovery|execution/.test(c.status||"")?' good':'')+'">'+esc(STATUS[c.status]||c.status||"")+'</span></div>'
      +'<div class="bpx-steps bpx-steps-lg">'+STEPS.map(function(s){ var v = count(cc,s[0]); return '<div class="'+(v?'on':'')+'"><b>'+v+'</b><span>'+s[1]+'</span></div>'; }).join("")+'</div>'
      +'<div class="bpx-dl"><button class="btn sm ghost" data-bpxcsv="'+esc(id)+'">⬇ Download Excel (CSV)</button><button class="btn sm ghost" data-bpxpdf="'+esc(id)+'">⬇ Download PDF report</button></div></div>'
      +'<div class="bpx-tabs">'+tabs.map(function(t){ return '<button class="bpx-chip'+(BP.tab===t[0]?' on':'')+'" data-bpxtab="'+t[0]+'">'+t[1]+'</button>'; }).join("")+'</div>'
      +'<div id="bpxTab"></div>';
    wireCommon(body);
    body.querySelectorAll("[data-bpxtab]").forEach(function(b){ b.onclick = function(){ BP.tab = b.dataset.bpxtab; body.querySelectorAll("[data-bpxtab]").forEach(function(x){ x.classList.toggle("on", x===b); }); paintTab(body, id); }; });
    paintTab(body, id);
  }
  function paintTab(body, id){
    var box = body.querySelector("#bpxTab"), d = BP.camp[id]; if(!box || !d) return;
    if(BP.tab==="brief") return paintBrief(box, d.campaign);
    if(BP.tab==="activity"){
      var T = d.timeline||[];
      box.innerHTML = '<div class="card">'+(T.length?'<div class="bpx-tl">'+T.map(function(e){ return '<div><span class="muted">'+fmtDateTime(e.at)+'</span><span><b>'+esc(e.creator||"A creator")+'</b> — '+esc(e.status||"")+'</span></div>'; }).join("")+'</div>':'<div class="muted">Nothing yet.</div>')+'</div>';
      return;
    }
    if(BP.tab==="analytics") return paintAnalytics(box, id);
    var R = d.creators||[], F = BP.cf || "all";
    var keys = [["all","All"],["to_approve","To approve"],["approved","Approved"],["shipped","In progress"],["video_review","Video review"],["posted","Posted"],["invited","Invited (sheet)"],["not_selected","Not selected"]];
    var match = function(x){ var s = (x.status||{}).key; return F==="all" ? s!=="not_selected" : F==="shipped" ? (s==="shipped"||s==="making"||s==="posting") : s===F; };
    var L = R.filter(match);
    var hasC = L.some(function(x){ return (x.status||{}).key==="to_approve"; }), hasV = L.some(function(x){ return (x.status||{}).key==="video_review"; });
    box.innerHTML = '<div class="bpx-tabs" style="margin-top:0">'+keys.map(function(k2){ return '<button class="bpx-chip'+(F===k2[0]?' on':'')+'" data-bpxcf="'+k2[0]+'">'+k2[1]+'</button>'; }).join("")+'</div>'
      +(can()&&(hasC||hasV)?'<div class="bpx-bulkrow">'+(hasC?bulkBar("c"):'')+(hasV?bulkBar("v"):'')+'</div>':'')
      +'<div class="card">'+(L.length?'<div class="bpx-list">'+L.map(function(x){ var s = x.status||{}, v = x.video, P = x.posts||[];
        var act = s.key==="to_approve" ? (can()?'<button class="btn sm" data-bpxok="'+esc(x.participation_id)+'">Approve</button><button class="btn sm ghost" data-bpxno="'+esc(x.participation_id)+'">Decline</button>':'')
          : s.key==="video_review" ? (v&&v.url?watchBtn(v.url, x.participation_id, x.creator, d.campaign.name, true):'')+(can()?'<button class="btn sm" data-bpxvok="'+esc(x.participation_id)+'">Approve</button><button class="btn sm ghost" data-bpxvno="'+esc(x.participation_id)+'">Ask for changes</button>':'')
          : (v&&v.url?watchBtn(v.url, null, x.creator, d.campaign.name, false):'')+P.filter(function(p){ return p.permalink; }).slice(0,3).map(function(p,i){ return '<a class="btn sm ghost" href="'+esc(p.permalink)+'" target="_blank" rel="noopener">📸 Post'+(P.length>1?' '+(i+1):'')+'</a>'; }).join("");
        var st = P.reduce(function(a,p){ var q = p.stats||{}; a.v += Number(q.views)||0; a.l += Number(q.likes)||0; a.c += Number(q.comments)||0; return a; }, {v:0,l:0,c:0});
        var sk = s.key==="to_approve" ? "c" : s.key==="video_review" ? "v" : "";
        return '<div class="bpx-row">'+'<div class="bpx-wsel">'+(sk&&can()?selBox(sk, x.participation_id):'')+who(x.creator, x.participation_id, x.invite_id)+'</div>'+'<div class="bpx-row-m"><span class="bpx-st bpx-st-'+esc(s.key||"")+'">'+esc(s.label||x.stage)+'</span>'
          +(P.length?'<div class="muted" style="margin-top:4px">👀 '+short(st.v)+' · ❤️ '+short(st.l)+' · 💬 '+short(st.c)+'</div>':'<div class="muted" style="margin-top:4px">Updated '+date(x.updated_at)+'</div>')+'</div>'
          +'<div class="bpx-acts">'+act+'</div></div>'; }).join("")+'</div>':'<div class="muted">Nobody here.</div>')+'</div>';
    box.querySelectorAll("[data-bpxcf]").forEach(function(b){ b.onclick = function(){ BP.cf = b.dataset.bpxcf; paintTab(body, id); }; });
    wireActions(box); wireBulk(box);
  }
  function paintBrief(box, c){
    var b = c.video_brief || {}, row = function(k,v){ return v ? '<div class="bpx-kv"><span>'+k+'</span><div style="white-space:pre-wrap">'+esc(v)+'</div></div>' : ""; };
    var tags = [].concat(c.hashtags||[], (c.mentions||[]).map(function(m){ return String(m).charAt(0)==="@"?m:"@"+m; }));
    box.innerHTML = '<div class="card">'+row("Product", c.product)+row("Deliverables", c.deliverables_text)+row("Platforms", c.platforms)
      +row("Cities", (c.cities||[]).join(", "))+row("Creators needed", c.creators_needed)+row("Hashtags & mentions", tags.join(" "))
      +row("Brief", c.brief)+row("What to shoot", b.what_to_shoot)+row("Key messages", b.key_messages)+row("Do's", b.dos)+row("Don'ts", b.donts)+row("Caption", b.caption)
      +'<div class="muted" style="font-size:12px;margin-top:10px">Want to change the brief? Message the Geek team.</div></div>';
  }
  async function paintAnalytics(box, id){
    box.innerHTML = '<div class="card">'+skel("list",3)+'</div>';
    var a = await loadAn(id); if(!box.isConnected) return;
    if(a.error){ box.innerHTML = '<div class="card"><div class="ci-err-inline">'+esc(a.error)+'</div></div>'; return; }
    var t = a.totals||{}, R = (a.creators||[]).filter(function(r){ return (r.posts||[]).length; });
    var er = (Number(t.views)||0) ? (((Number(t.likes)||0)+(Number(t.comments)||0)+(Number(t.shares)||0)+(Number(t.saves)||0))*100/Number(t.views)).toFixed(2)+"%" : "—";
    box.innerHTML = '<div class="bpx-kpis">'+kpi("🧑‍🎤", t.creators_live, "Creators posted", short(t.followers)+" followers reached")+kpi("📸", t.posts, "Posts", "")
      +kpi("👀", t.views, "Views", "")+kpi("📡", t.reach, "Reach", "")+kpi("❤️", t.likes, "Likes", "")+kpi("💬", t.comments, "Comments", "")
      +kpi("🔁", t.shares, "Shares", "")+kpi("🔖", t.saves, "Saves", "")+kpi("⚡", er, "Engagement on views", "")+'</div>'
      +'<div class="card" style="margin-top:14px" id="bpxTop"><h3 style="margin-top:0">🏆 Top 5 posts</h3>'+skel("list",2)+'</div>'
      +'<div class="card" style="margin-top:14px"><h3 style="margin-top:0">Per creator</h3>'+(R.length?'<div style="overflow-x:auto"><table class="tbl bpx-tbl"><thead><tr><th>Creator</th><th>Followers</th><th>Posts</th><th>Views</th><th>Reach</th><th>Likes</th><th>Comments</th><th>Shares</th><th>Saves</th></tr></thead><tbody>'
        +R.map(function(r){ var c = r.creator||{}, q = r.totals||{}; return '<tr><td>'+(c.username?'<a href="https://instagram.com/'+esc(c.username)+'" target="_blank" rel="noopener">@'+esc(c.username)+'</a>':esc(c.name||""))+'</td><td>'+n(c.followers)+'</td><td>'+(r.posts||[]).length+'</td><td>'+n(q.views)+'</td><td>'+n(q.reach)+'</td><td>'+n(q.likes)+'</td><td>'+n(q.comments)+'</td><td>'+n(q.shares)+'</td><td>'+n(q.saves)+'</td></tr>'; }).join("")
        +'</tbody></table></div>':'<div class="muted">No posts yet — numbers show up as soon as creators post.</div>')+'</div>';
    loadTop(id).then(function(L){ var b = box.querySelector("#bpxTop"); if(!b) return;
      b.innerHTML = '<h3 style="margin-top:0">🏆 Top 5 posts</h3>'+(L.length?topGrid(L,false):'<div class="muted">No posts yet.</div>'); });
  }

  // ---------- reports
  function paintReports(body){
    var C = BP.data.campaigns||[];
    body.innerHTML = '<div class="card"><div class="bpx-h"><h3>Campaign reports</h3><button class="btn sm ghost" data-bpxcsvall>⬇ All campaigns (CSV)</button></div>'
      +(C.length?'<div style="overflow-x:auto"><table class="tbl bpx-tbl"><thead><tr><th>Campaign</th><th>Status</th><th>Creators posted</th><th>Posts</th><th>Views</th><th>Likes</th><th>Comments</th><th>Download</th></tr></thead><tbody>'
        +C.map(function(c){ return '<tr data-bpxrep="'+esc(c.campaign_id)+'"><td><a href="#" data-bpxopen="'+esc(c.campaign_id)+'">'+esc(c.name)+'</a></td><td>'+esc(STATUS[c.status]||c.status||"")+'</td><td class="r-cr">…</td><td class="r-p">…</td><td class="r-v">…</td><td class="r-l">…</td><td class="r-c">…</td>'
          +'<td style="white-space:nowrap"><button class="mini-btn ghost" data-bpxcsv="'+esc(c.campaign_id)+'">CSV</button> <button class="mini-btn ghost" data-bpxpdf="'+esc(c.campaign_id)+'">PDF</button></td></tr>'; }).join("")
        +'</tbody></table></div>':'<div class="muted">No campaigns yet.</div>')+'</div>';
    wireCommon(body);
    C.forEach(function(c){ loadAn(c.campaign_id).then(function(a){ var tr = body.querySelector('[data-bpxrep="'+c.campaign_id+'"]'); if(!tr) return; var t = (a&&a.totals)||{};
      tr.querySelector(".r-cr").textContent = n(t.creators_live); tr.querySelector(".r-p").textContent = n(t.posts); tr.querySelector(".r-v").textContent = n(t.views);
      tr.querySelector(".r-l").textContent = n(t.likes); tr.querySelector(".r-c").textContent = n(t.comments); }); });
    var all = body.querySelector("[data-bpxcsvall]"); if(all) all.onclick = async function(){ all.disabled = true;
      var rows = [["Campaign","Status","Creators posted","Posts","Followers reached","Views","Reach","Likes","Comments","Shares","Saves"]];
      for(var i=0;i<C.length;i++){ var a = await loadAn(C[i].campaign_id), t = (a&&a.totals)||{};
        rows.push([C[i].name, STATUS[C[i].status]||C[i].status||"", t.creators_live, t.posts, t.followers, t.views, t.reach, t.likes, t.comments, t.shares, t.saves]); }
      csvDownload("Geek campaigns - "+brandName(), rows); all.disabled = false; };
  }

  // ---------- downloads
  function csvDownload(name, rows){
    var s = rows.map(function(r){ return r.map(function(v){ v = v==null ? "" : String(v); return /[",\n]/.test(v) ? '"'+v.replace(/"/g,'""')+'"' : v; }).join(","); }).join("\r\n");
    var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿"+s], { type:"text/csv;charset=utf-8" }));
    a.download = name.replace(/[^\w\- ]+/g,"").trim()+".csv"; document.body.appendChild(a); a.click(); setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  async function campCsv(id){
    var d = await loadCamp(id), a = await loadAn(id), byU = {};
    ((a&&a.creators)||[]).forEach(function(r){ var u = ((r.creator||{}).username||"").toLowerCase(); if(u) byU[u] = r; });
    var rows = [["Creator","Instagram","Followers","City","Status","Video","Post links","Views","Reach","Likes","Comments","Shares","Saves"]];
    (d.creators||[]).forEach(function(x){ var c = x.creator||{}, r = byU[(c.username||"").toLowerCase()]||{}, q = r.totals||{};
      rows.push([c.name||"", c.username?"@"+c.username:"", c.followers, c.city, (x.status||{}).label, (x.video||{}).url||"", (x.posts||[]).map(function(p){ return p.permalink; }).filter(Boolean).join(" "),
        q.views, q.reach, q.likes, q.comments, q.shares, q.saves]); });
    csvDownload(d.campaign.name+" - report", rows);
  }
  async function campPdf(id){
    var w = window.open("", "_blank"); if(!w){ gateToast("Allow pop-ups to download the PDF."); return; }
    w.document.write("<p style='font:14px sans-serif;padding:20px'>Preparing the report…</p>");
    var d = await loadCamp(id), a = await loadAn(id), c = d.campaign, t = (a&&a.totals)||{}, R = ((a&&a.creators)||[]).filter(function(r){ return (r.posts||[]).length; });
    var k = {}; (d.creators||[]).forEach(function(x){ var s = (x.status||{}).key; k[s] = (k[s]||0)+1; });
    var box = function(v,l){ return '<div class="k"><b>'+esc(n(v))+'</b><span>'+esc(l)+'</span></div>'; };
    var html = '<!doctype html><html><head><meta charset="utf-8"><title>'+esc(c.name)+' — campaign report</title><style>'
      +'body{font:13px/1.45 Inter,Arial,sans-serif;color:#111;margin:28px}h1{font-size:22px;margin:0}h2{font-size:15px;margin:22px 0 8px}.m{color:#666}'
      +'.ks{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:12px}.k{border:1px solid #ddd;border-radius:8px;padding:10px}.k b{display:block;font-size:18px}.k span{color:#666;font-size:12px}'
      +'table{width:100%;border-collapse:collapse;margin-top:6px}th,td{border-bottom:1px solid #e5e5e5;padding:6px 4px;text-align:left;font-size:12px}th{background:#f6f6f8}'
      +'.foot{margin-top:24px;color:#888;font-size:11px}@media print{.np{display:none}}</style></head><body>'
      +'<div class="np" style="margin-bottom:14px"><button onclick="print()" style="padding:8px 14px;font-weight:700">Save as PDF / Print</button></div>'
      +'<h1>'+esc(c.name)+'</h1><div class="m">'+esc(c.brand||"")+' · '+esc(TYPE[c.campaign_type]||"")+(c.product?' · '+esc(c.product):'')+' · '+date(c.starts_on)+' – '+date(c.ends_on)+'</div>'
      +'<h2>Results</h2><div class="ks">'+box(t.creators_live,"Creators posted")+box(t.posts,"Posts")+box(t.followers,"Followers reached")+box(t.views,"Views")
      +box(t.reach,"Reach")+box(t.likes,"Likes")+box(t.comments,"Comments")+box((Number(t.shares)||0)+(Number(t.saves)||0),"Shares + saves")+'</div>'
      +'<h2>Progress</h2><div class="ks">'+STEPS.map(function(s){ return box(s[0]==="shipped"?(k.shipped||0)+(k.making||0):(k[s[0]]||0), s[1]); }).join("")+'</div>'
      +'<h2>Creators who posted</h2>'+(R.length?'<table><thead><tr><th>Creator</th><th>Followers</th><th>Posts</th><th>Views</th><th>Reach</th><th>Likes</th><th>Comments</th><th>Links</th></tr></thead><tbody>'
        +R.map(function(r){ var cr = r.creator||{}, q = r.totals||{}; return '<tr><td>'+esc(cr.username?"@"+cr.username:(cr.name||""))+'</td><td>'+n(cr.followers)+'</td><td>'+(r.posts||[]).length+'</td><td>'+n(q.views)+'</td><td>'+n(q.reach)+'</td><td>'+n(q.likes)+'</td><td>'+n(q.comments)+'</td><td>'
          +(r.posts||[]).filter(function(p){ return p.permalink; }).map(function(p){ return '<a href="'+esc(p.permalink)+'">'+esc(p.media_type||"post")+'</a>'; }).join(" ")+'</td></tr>'; }).join("")+'</tbody></table>':'<div class="m">No posts yet.</div>')
      +'<div class="foot">Geek OS · report made '+new Date().toLocaleString("en-IN")+'</div></body></html>';
    w.document.open(); w.document.write(html); w.document.close(); setTimeout(function(){ try{ w.focus(); w.print(); }catch(e){} }, 600);
  }

  // ---------- settings
  function paintSettings(body){
    var d = BP.data, fb = d.facebook;
    body.innerHTML = '<div class="card"><h3 style="margin-top:0">👤 Your login</h3><div class="bpx-kv"><span>Name</span><div>'+esc((d.me||{}).name||"—")+'</div></div>'
      +'<div class="bpx-kv"><span>Email</span><div>'+esc((d.me||{}).email||"—")+'</div></div><div class="bpx-kv"><span>Brand</span><div>'+esc(brandName())+'</div></div>'
      +'<form id="bpxPw" class="modal-form" style="padding:0;margin-top:12px;max-width:420px"><label>New password<input name="pw" type="password" minlength="8" required autocomplete="new-password"></label>'
      +'<label>Type it again<input name="pw2" type="password" minlength="8" required autocomplete="new-password"></label><div class="auth-err" id="bpxPwErr"></div><button class="btn sm" type="submit">Change password</button></form></div>'
      +'<div class="card" style="margin-top:16px"><h3 style="margin-top:0">📘 Facebook business</h3>'
      +(fb ? '<div>✓ Linked to <b>'+esc(fb.fb_name||"your Facebook account")+'</b> — you can sign in with <b>Continue with Facebook</b>.</div>'
             +'<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><button class="btn sm ghost" data-bpxfbrefresh>↻ Refresh data</button><button class="btn sm ghost" data-bpxfbunlink>Unlink</button></div>'
           : '<p class="muted" style="margin:0 0 10px">Link your Facebook (Business Manager) once — then sign in with one tap, and see your Pages, Instagram and ad accounts here. We only read; nothing is posted.</p><button class="btn sm" data-bpxfb>🔗 Link Facebook business</button>')
      +'</div>'+(fb?fbCard(fb):'')
      +'<div class="card" style="margin-top:16px" id="bpxTeam"><h3 style="margin-top:0">👥 Your team</h3>'+skel("list",2)+'</div>';
    wireCommon(body); paintTeam(body.querySelector("#bpxTeam"));
    var f = body.querySelector("#bpxPw"); if(f) f.onsubmit = async function(e){ e.preventDefault(); var x = new FormData(f), err = body.querySelector("#bpxPwErr");
      if(x.get("pw")!==x.get("pw2")){ err.textContent = "The two passwords don't match."; return; }
      var b = f.querySelector("button"); b.disabled = true; var r = await sb.auth.updateUser({ password:String(x.get("pw")) }); b.disabled = false;
      if(r.error){ err.textContent = r.error.message; return; } f.reset(); err.textContent = ""; gateToast("Password changed ✓"); };
    var u = body.querySelector("[data-bpxfbunlink]"); if(u) u.onclick = async function(){ if(!confirm("Unlink Facebook? You can still sign in with email & password.")) return;
      var r = await sb.functions.invoke("brand-fb-login", { body:{ action:"unlink" } }); if(r.error){ gateToast(r.error.message); return; } refresh(); };
  }

  // ---------- wiring
  function wireCommon(body){
    body.querySelectorAll("[data-bpxopen]").forEach(function(c){ var o = function(e){ if(e) e.preventDefault(); BP.tab = "creators"; BP.cf = "all"; go("campaigns", c.dataset.bpxopen); };
      c.onclick = o; c.onkeydown = function(e){ if(e.key==="Enter"||e.key===" ") o(e); }; });
    body.querySelectorAll("[data-bpxgo2]").forEach(function(b){ b.onclick = function(){ go(b.dataset.bpxgo2, null); }; });
    body.querySelectorAll("[data-bpxback]").forEach(function(b){ b.onclick = function(){ go("campaigns", null); }; });
    body.querySelectorAll("[data-bpxcsv]").forEach(function(b){ b.onclick = function(e){ e.stopPropagation(); campCsv(b.dataset.bpxcsv).catch(function(er){ gateToast(er.message||String(er)); }); }; });
    body.querySelectorAll("[data-bpxpdf]").forEach(function(b){ b.onclick = function(e){ e.stopPropagation(); campPdf(b.dataset.bpxpdf).catch(function(er){ gateToast(er.message||String(er)); }); }; });
    body.querySelectorAll("[data-bpxfb]").forEach(function(b){ b.onclick = function(){ if(BP.preview){ gateToast("The brand links Facebook from their own login."); return; } fbStart("link"); }; });
    body.querySelectorAll("[data-bpxfbrefresh]").forEach(function(b){ b.onclick = async function(){ if(BP.preview) return; b.disabled = true; b.textContent = "Refreshing…";
      var r = await sb.functions.invoke("brand-fb-login", { body:{ action:"refresh" } }); var m = (r.data&&r.data.error) || (r.error && (typeof fnError==="function" ? await fnError(r.error) : r.error.message));
      if(m) gateToast(m); refresh(); }; });
    body.querySelectorAll("[data-bpxreq]").forEach(function(b){ b.onclick = function(e){ e.preventDefault(); openRequest(); }; });
    wireActions(body);
  }
  function wireActions(body){
    body.querySelectorAll("[data-bpxcard]").forEach(function(w){ var o = function(e){ if(e.target.closest("a")) return; e.stopPropagation(); openCard(w.dataset.bpxcard||null, w.dataset.bpxinv||null); };
      w.onclick = o; w.onkeydown = function(e){ if(e.key==="Enter") o(e); }; });
    body.querySelectorAll("[data-bpxwatch]").forEach(function(b){ b.onclick = function(e){ e.stopPropagation();
      openVideo(b.dataset.bpxwatch, b.dataset.pid||null, b.dataset.who||"", b.dataset.camp||""); }; });
    var done = async function(msg){ gateToast(msg); await refresh(); };
    body.querySelectorAll("[data-bpxok]").forEach(function(b){ b.onclick = async function(e){ e.stopPropagation(); b.disabled = true; b.textContent = "…";
      var r = await api("org_decide_applicant", { p_participation:b.dataset.bpxok, p_approve:true, p_reason_code:null, p_note:null });
      if(r.error){ gateToast(r.error.message); b.disabled = false; b.textContent = "Approve"; return; } done("✓ Creator approved — the Geek team takes it from here"); }; });
    body.querySelectorAll("[data-bpxno]").forEach(function(b){ b.onclick = async function(e){ e.stopPropagation();
      var pick = await openReasonModal("Why isn't this creator right for the campaign?"); if(!pick) return;
      var r = await api("org_decide_applicant", { p_participation:b.dataset.bpxno, p_approve:false, p_reason_code:pick.code, p_note:pick.note||null });
      if(r.error){ gateToast(r.error.message); return; } done("Creator declined — they get your message"); }; });
    body.querySelectorAll("[data-bpxvok]").forEach(function(b){ b.onclick = async function(e){ e.stopPropagation(); if(!confirm("Approve this video? The creator is told to post it.")) return; b.disabled = true; b.textContent = "…";
      var r = await api("bp_review_video", { p_participation:b.dataset.bpxvok, p_approve:true, p_reason:null });
      if(r.error){ gateToast(r.error.message); b.disabled = false; b.textContent = "Approve"; return; } done("✓ Video approved — the creator can post it now"); }; });
    body.querySelectorAll("[data-bpxvno]").forEach(function(b){ b.onclick = function(e){ e.stopPropagation();
      var m = bpModal("Ask for changes", '<form class="modal-form" id="bpxCh"><label>What should the creator change?<textarea name="r" rows="4" maxlength="800" required placeholder="e.g. Show the product in the first 3 seconds and say the brand name clearly."></textarea></label><div class="auth-err" id="bpxChErr"></div><button class="btn" type="submit">Send to the creator</button></form>');
      m.querySelector("#bpxCh").onsubmit = async function(ev){ ev.preventDefault(); var t = String(new FormData(ev.target).get("r")||"").trim(); if(t.length<5) return;
        var r = await api("bp_review_video", { p_participation:b.dataset.bpxvno, p_approve:false, p_reason:t });
        if(r.error){ m.querySelector("#bpxChErr").textContent = r.error.message; return; } m.remove(); done("Sent — the creator will fix the video"); }; }; });
  }

  // ---------- 🏆 top posts
  async function loadTop(id){
    if(BP.top && BP.top[id]) return BP.top[id];
    var r = await api("brand_top_posts", { p_campaign:id, p_limit:5 }); BP.top = BP.top || {}; BP.top[id] = r.error ? [] : (r.data||[]); return BP.top[id];
  }
  function topGrid(L, showCamp){
    return '<div class="bpx-top">'+L.map(function(p, i){ var c = p.creator||{}, img = p.thumb || c.profile_picture_url;
      return '<a class="bpx-topc" href="'+esc(p.permalink)+'" target="_blank" rel="noopener"><div class="bpx-topi">'+(img?'<img src="'+esc(img)+'" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">':'')
        +'<span class="bpx-rank">#'+(i+1)+'</span><span class="bpx-type">'+esc(p.type||"post")+'</span></div>'
        +'<div class="bpx-topb"><b>@'+esc(c.username||c.name||"creator")+'</b>'+(showCamp&&p.campaign?'<div class="muted" style="font-size:11.5px">'+esc(p.campaign)+'</div>':'')
        +'<div class="bpx-topm"><span>👀 '+short(p.views)+'</span>'+(p.likes!=null?'<span>❤️ '+short(p.likes)+'</span>':'')+(p.comments!=null?'<span>💬 '+short(p.comments)+'</span>':'')+(p.er!=null?'<span>⚡ '+esc(p.er)+'%</span>':'')+'</div></div></a>'; }).join("")+'</div>';
  }

  // ---------- ☑ select several → approve together
  function selBox(kind, pid){ return pid ? '<label class="bpx-sel" title="Select"><input type="checkbox" data-bpxsel="'+kind+'" value="'+esc(pid)+'"></label>' : ''; }
  function bulkBar(kind){ return '<div class="bpx-bulk" data-bpxbulk="'+kind+'"><label class="bpx-selall"><input type="checkbox" data-bpxall="'+kind+'"> Select all</label>'
      +'<button class="btn sm" data-bpxbulkgo="'+kind+'" disabled>'+(kind==="c"?"Approve selected":"Approve selected videos")+' (0)</button></div>'; }
  function wireBulk(box){
    var upd = function(kind){ var n2 = box.querySelectorAll('[data-bpxsel="'+kind+'"]:checked').length;
      box.querySelectorAll('[data-bpxbulkgo="'+kind+'"]').forEach(function(b){ b.disabled = !n2; b.textContent = (kind==="c"?"Approve selected":"Approve selected videos")+" ("+n2+")"; }); };
    box.querySelectorAll("[data-bpxsel]").forEach(function(c){ c.onclick = function(e){ e.stopPropagation(); }; c.onchange = function(){ upd(c.dataset.bpxsel); }; });
    box.querySelectorAll("[data-bpxall]").forEach(function(a){ a.onchange = function(){ box.querySelectorAll('[data-bpxsel="'+a.dataset.bpxall+'"]').forEach(function(c){ c.checked = a.checked; }); upd(a.dataset.bpxall); }; });
    box.querySelectorAll("[data-bpxbulkgo]").forEach(function(b){ b.onclick = async function(){ var kind = b.dataset.bpxbulkgo;
      var ids = Array.from(box.querySelectorAll('[data-bpxsel="'+kind+'"]:checked')).map(function(c){ return c.value; }); if(!ids.length) return;
      if(!confirm(kind==="c" ? "Approve "+ids.length+" creator"+(ids.length===1?"":"s")+"? They move on to the next step." : "Approve "+ids.length+" video"+(ids.length===1?"":"s")+"? The creators are told to post them.")) return;
      b.disabled = true; var ok = 0, bad = [];
      for(var i=0;i<ids.length;i++){ b.textContent = "Approving "+(i+1)+" of "+ids.length+"…";
        var r = kind==="c" ? await api("org_decide_applicant", { p_participation:ids[i], p_approve:true, p_reason_code:null, p_note:null })
                           : await api("bp_review_video", { p_participation:ids[i], p_approve:true, p_reason:null });
        if(r.error) bad.push(r.error.message); else ok++; }
      gateToast("✓ "+ok+" approved"+(bad.length?" · "+bad.length+" couldn't be: "+bad[0]:"")); refresh(); }; });
  }

  // ---------- ▶ video player in a pop-up (Google Drive, Instagram, YouTube, direct video files)
  function embedUrl(u){
    u = String(u||""); var m;
    if((m = u.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=)([\w-]{10,})/))) return { kind:"frame", src:"https://drive.google.com/file/d/"+m[1]+"/preview" };
    if((m = u.match(/instagram\.com\/(?:[\w.]+\/)?(reel|reels|p|tv)\/([\w-]+)/))) return { kind:"frame", src:"https://www.instagram.com/"+(m[1]==="reels"?"reel":m[1])+"/"+m[2]+"/embed", tall:true };
    if((m = u.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([\w-]{6,})/))) return { kind:"frame", src:"https://www.youtube.com/embed/"+m[1] };
    if(/\.(mp4|mov|webm|m4v)(\?|$)/i.test(u) || /\/storage\/v1\/object\//.test(u)) return { kind:"video", src:u };
    return null;
  }
  function watchBtn(url, pid, cr, camp, review){ return '<button class="btn sm ghost" data-bpxwatch="'+esc(url)+'" data-pid="'+esc(review&&pid?pid:"")+'" data-who="'+esc((cr||{}).name||(cr||{}).username||"")+'" data-camp="'+esc(camp||"")+'">▶ Watch</button>'; }
  function openVideo(url, pid, name, camp){
    var e = embedUrl(url);
    var player = !e ? '<div class="muted" style="padding:30px;text-align:center">This link can\'t be played here.</div>'
      : e.kind==="video" ? '<video src="'+esc(e.src)+'" controls playsinline preload="metadata"></video>'
      : '<iframe src="'+esc(e.src)+'" allow="autoplay; encrypted-media; fullscreen" allowfullscreen loading="lazy" referrerpolicy="no-referrer"></iframe>';
    var m = bpModal("▶ "+esc(name||"Video")+(camp?' · <span class="muted" style="font-weight:500">'+esc(camp)+'</span>':''),
      '<div class="modal-form"><div class="bpx-player'+(e&&e.tall?' tall':'')+'">'+player+'</div>'
      +'<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:space-between;align-items:center"><a href="'+esc(url)+'" target="_blank" rel="noopener" class="muted" style="font-size:12.5px">Open in a new tab ↗</a>'
      +(pid&&can()?'<span style="display:flex;gap:8px"><button class="btn sm ghost" id="bpxPvNo">Ask for changes</button><button class="btn sm" id="bpxPvOk">✓ Approve video</button></span>':'')+'</div></div>');
    m.querySelector(".modal").classList.add("bpx-pv");
    var ok = m.querySelector("#bpxPvOk"), no = m.querySelector("#bpxPvNo");
    if(ok) ok.onclick = async function(){ ok.disabled = true; ok.textContent = "…"; var r = await api("bp_review_video", { p_participation:pid, p_approve:true, p_reason:null });
      if(r.error){ gateToast(r.error.message); ok.disabled = false; ok.textContent = "✓ Approve video"; return; } m.remove(); gateToast("✓ Video approved — the creator can post it now"); refresh(); };
    if(no) no.onclick = function(){ m.remove(); var b = document.createElement("button"); b.dataset.bpxvno = pid; var tmp = document.createElement("div"); tmp.appendChild(b); wireActions(tmp); b.click(); };
  }

  // ---------- 👤 creator profile card
  async function openCard(pid, inv){
    var m = bpModal("Creator profile", '<div class="modal-form" id="bpxCardB">'+skel("list",3)+'</div>'); m.querySelector(".modal").classList.add("bpx-cardm");
    var r = await api("brand_creator_card", { p_participation:pid||null, p_invite:inv||null }), box = m.querySelector("#bpxCardB"); if(!box) return;
    if(r.error){ box.innerHTML = '<div class="ci-err-inline">'+esc(r.error.message)+'</div>'; return; }
    var d = r.data, c = d.creator||{}, au = d.audience||{}, R = d.recent||[], FB = d.for_brand||[];
    var er = c.engagement!=null ? c.engagement+"%" : (c.followers && d.avg_likes!=null ? (((Number(d.avg_likes)||0)+(Number(d.avg_comments)||0))*100/Number(c.followers)).toFixed(2)+"%" : "—");
    var bars = function(t, L, map){ return (L&&L.length) ? '<div class="bpx-aud"><b>'+t+'</b>'+L.map(function(x){ return '<div class="bpx-audr"><span>'+esc(map?map(x.key):x.key)+'</span><i><em style="width:'+Math.min(100, Number(x.pct)||0)+'%"></em></i><span>'+esc(x.pct)+'%</span></div>'; }).join("")+'</div>' : ''; };
    var G = { F:"Women", M:"Men", U:"Other" };
    box.innerHTML = '<div class="bpx-ch">'+avatar(c)+'<div style="min-width:0;flex:1"><h3 style="margin:0">'+esc(c.name||c.username||"Creator")+'</h3>'
        +'<div class="muted">'+(c.username?'<a href="https://instagram.com/'+esc(c.username)+'" target="_blank" rel="noopener">@'+esc(c.username)+' ↗</a>':'')+(c.city?' · '+esc(c.city):'')+((c.categories||[]).length?' · '+esc(c.categories.slice(0,3).join(", ")):'')+'</div></div>'
        +'<button class="btn sm '+(d.saved?'':'ghost')+'" id="bpxStar">'+(d.saved?'⭐ Saved':'☆ Save creator')+'</button></div>'
      +(c.bio?'<div class="muted" style="white-space:pre-wrap;font-size:13px">'+esc(c.bio)+'</div>':'')
      +'<div class="bpx-kpis bpx-kpis-sm">'+kpi("👥", c.followers, "Followers", "")+kpi("⚡", er, "Engagement", "")+kpi("📡", c.avg_reach, "Avg reach", "")
        +kpi("👀", d.avg_views, "Avg views", "")+kpi("❤️", d.avg_likes, "Avg likes", "")+kpi("✅", d.campaigns_done, "Campaigns done on Geek", "")+'</div>'
      +((au.city||au.age||au.gender||au.country)?'<div class="bpx-audg">'+bars("📍 Top cities", au.city)+bars("🎂 Age", au.age)+bars("⚧ Gender", au.gender, function(k){ return G[k]||k; })+(au.city?'':bars("🌍 Countries", au.country))+'</div>'
        : '<div class="muted" style="font-size:12.5px">Audience (city / age / gender) shows once the creator\'s Instagram insights are shared.</div>')
      +(R.length?'<div><b>Recent posts</b><div class="bpx-recent">'+R.map(function(x){ return '<a href="'+esc(x.permalink||"#")+'" target="_blank" rel="noopener">'+(x.img?'<img src="'+esc(x.img)+'" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">':'')
          +'<span>❤️ '+short(x.likes)+' · 💬 '+short(x.comments)+'</span></a>'; }).join("")+'</div></div>':'')
      +(FB.length?'<div><b>With your brand</b>'+FB.map(function(f){ return '<div class="bpx-kv"><span>'+esc(f.campaign)+'</span><div>'+esc(f.status||"")+((f.posts||[]).length?' · '+(f.posts||[]).filter(function(p){ return p.permalink; }).map(function(p){ return '<a href="'+esc(p.permalink)+'" target="_blank" rel="noopener">'+esc(p.media_type||"post")+'</a>'; }).join(" "):'')+'</div></div>'; }).join("")+'</div>':'');
    var st = box.querySelector("#bpxStar"); st.onclick = async function(){ st.disabled = true;
      var q = await api("brand_favorite_set", { p_participation:pid||null, p_invite:inv||null, p_on:!d.saved }); st.disabled = false;
      if(q.error){ gateToast(q.error.message); return; } d.saved = !d.saved; st.className = "btn sm "+(d.saved?"":"ghost"); st.textContent = d.saved?"⭐ Saved":"☆ Save creator";
      gateToast(d.saved?"⭐ Saved — find them under Saved creators":"Removed from Saved creators"); if(BP.data) BP.data.saved = (Number(BP.data.saved)||0)+(d.saved?1:-1);
      if(BP.page==="creators") go("creators"); };
  }

  // ---------- ⭐ saved creators
  async function paintSaved(body){
    var r = await api("brand_favorites", { p_brand: BP.preview || null });
    if(r.error){ body.innerHTML = '<div class="card"><div class="ci-err-inline">'+esc(r.error.message)+'</div></div>'; return; }
    var L = r.data||[];
    body.innerHTML = L.length ? '<div class="card"><div class="bpx-list">'+L.map(function(f){ return '<div class="bpx-row">'+who(f.creator, f.participation_id, f.invite_id)
        +'<div class="bpx-row-m muted">'+esc(f.campaigns||"")+'<br>Saved '+date(f.added_at)+'</div><div class="bpx-acts"><button class="btn sm ghost" data-bpxunstar="'+esc(f.participation_id||"")+'" data-inv="'+esc(f.invite_id||"")+'">Remove ⭐</button></div></div>'; }).join("")+'</div></div>'
      : '<div class="card muted">No saved creators yet. Open any creator in a campaign and tap <b>☆ Save creator</b> — they show up here so you can ask for them again.</div>';
    wireActions(body);
    body.querySelectorAll("[data-bpxunstar]").forEach(function(b){ b.onclick = async function(){ b.disabled = true;
      var q = await api("brand_favorite_set", { p_participation:b.dataset.bpxunstar||null, p_invite:b.dataset.inv||null, p_on:false });
      if(q.error){ gateToast(q.error.message); b.disabled = false; return; } go("creators"); }; });
  }

  // ---------- 📝 request a new campaign
  function openRequest(){
    if(BP.preview){ gateToast("The brand sends requests from their own login."); return; }
    var m = bpModal("➕ Request a new campaign", '<form class="modal-form" id="bpxRq">'
      +'<p class="muted" style="margin:0;font-size:13px">Tell us what you need — the Geek team gets it right away and sets the campaign up with you.</p>'
      +'<label>Campaign name<input name="name" required maxlength="160" placeholder="e.g. Winter Detan Push"></label>'
      +'<div class="mf-row"><label>Product<input name="product" maxlength="200" placeholder="What creators get / promote"></label>'
      +'<label>Type<select name="campaign_type"><option value="barter">🎁 Barter (product)</option><option value="paid">💰 Paid</option><option value="barter_paid">🎁 + 💰 Barter + Paid</option></select></label></div>'
      +'<div class="mf-row"><label>Creators needed<input name="creators_needed" inputmode="numeric" maxlength="6" placeholder="e.g. 50"></label><label>Budget (optional)<input name="budget" maxlength="120" placeholder="e.g. ₹2 L, or product only"></label></div>'
      +'<div class="mf-row"><label>Start<input name="starts_on" type="date"></label><label>End<input name="ends_on" type="date"></label></div>'
      +'<label>Cities / audience (optional)<input name="cities" maxlength="300" placeholder="e.g. Delhi, Mumbai · women 18–30"></label>'
      +'<label>Deliverables (optional)<input name="deliverables" maxlength="400" placeholder="e.g. 1 Reel + 2 Stories"></label>'
      +'<label>Brief<textarea name="brief" rows="5" maxlength="6000" placeholder="What should the creators show and say? Any do\'s and don\'ts, links, references…"></textarea></label>'
      +'<div class="auth-err" id="bpxRqErr"></div><button class="btn" type="submit">Send to the Geek team</button></form>');
    m.querySelector("#bpxRq").onsubmit = async function(e){ e.preventDefault(); var f = new FormData(e.target), p = {}; f.forEach(function(v,k){ p[k] = String(v); });
      var b = e.target.querySelector("button[type=submit]"); b.disabled = true; b.textContent = "Sending…";
      var r = await api("brand_campaign_request", { p:p }); if(r.error){ m.querySelector("#bpxRqErr").textContent = r.error.message; b.disabled = false; b.textContent = "Send to the Geek team"; return; }
      m.remove(); gateToast("✓ Sent — the Geek team will get back to you"); refresh(); };
  }

  // ---------- 👥 team logins
  async function paintTeam(box){
    if(!box) return;
    if(BP.preview){ box.innerHTML = '<h3 style="margin-top:0">👥 Your team</h3><div class="muted">The brand manages its team from its own login. You can see and change logins in Brand CRM → Brand portal.</div>'; return; }
    var r = await api("brand_team"); if(!box.isConnected) return;
    if(r.error){ box.innerHTML = '<h3 style="margin-top:0">👥 Your team</h3><div class="ci-err-inline">'+esc(r.error.message)+'</div>'; return; }
    var t = r.data, M = t.members||[], owner = t.my_role==="owner", RL = { owner:"Admin (owner)", approver:"Approver", viewer:"View only" };
    box.innerHTML = '<h3 style="margin-top:0">👥 Your team <span class="muted" style="font-weight:500">('+M.length+' of '+t.max+' logins)</span></h3>'
      +'<p class="muted" style="font-size:12.5px;margin:0 0 8px"><b>Approver</b> can approve creators and videos · <b>View only</b> sees everything, approves nothing · <b>Admin</b> also manages the team.</p>'
      +M.map(function(x){ var me = x.member_id===t.me;
        return '<div class="bpx-kv"><span>'+esc(x.name||x.email)+(me?' (you)':'')+'</span><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="muted">'+esc(x.email||"")+'</span>'
          +(owner&&!me?'<select data-bpxrole="'+esc(x.member_id)+'">'+["owner","approver","viewer"].map(function(k){ return '<option value="'+k+'"'+(x.role===k?' selected':'')+'>'+RL[k]+'</option>'; }).join("")+'</select><button class="mini-btn ghost" data-bpxrm="'+esc(x.member_id)+'">Remove</button>'
            :'<span class="tag">'+esc(RL[x.role]||x.role)+'</span>')
          +'<span class="muted" style="font-size:12px">'+(x.last_sign_in?'last sign-in '+fmtDateTime(x.last_sign_in):'never signed in')+'</span></div></div>'; }).join("")
      +(owner && M.length < t.max ? '<form id="bpxTeamF" class="bpx-teamf"><input name="name" maxlength="80" placeholder="Name"><input name="email" type="email" required maxlength="120" placeholder="their@brand.com">'
          +'<select name="role"><option value="approver">Approver</option><option value="viewer">View only</option><option value="owner">Admin (owner)</option></select><button class="btn sm" type="submit">➕ Add teammate</button></form><div class="auth-err" id="bpxTeamErr"></div><div id="bpxTeamOut"></div>'
        : owner ? '<div class="muted" style="margin-top:8px;font-size:12.5px">Your team has '+t.max+' logins — remove one to add someone new.</div>' : '<div class="muted" style="margin-top:8px;font-size:12.5px">Only your team\'s admin can add or remove logins.</div>');
    var call = async function(body){ var x = await sb.functions.invoke("brand-login", { body:body }); return (x.data&&x.data.error) || (x.error && (typeof fnError==="function" ? await fnError(x.error) : x.error.message)) ? { err:(x.data&&x.data.error) || (typeof fnError==="function" ? await fnError(x.error) : x.error.message) } : { data:x.data }; };
    box.querySelectorAll("[data-bpxrole]").forEach(function(s2){ s2.onchange = async function(){ var q = await call({ action:"team_role", member_id:s2.dataset.bpxrole, role:s2.value }); gateToast(q.err||"Access changed ✓"); paintTeam(box); }; });
    box.querySelectorAll("[data-bpxrm]").forEach(function(b){ b.onclick = async function(){ if(!confirm("Remove this login? They can't sign in any more.")) return; var q = await call({ action:"team_remove", member_id:b.dataset.bpxrm }); gateToast(q.err||"Removed ✓"); paintTeam(box); }; });
    var f = box.querySelector("#bpxTeamF"); if(f) f.onsubmit = async function(e){ e.preventDefault(); var x = new FormData(f), b = f.querySelector("button"); b.disabled = true; b.textContent = "Adding…";
      var q = await call({ action:"team_add", email:String(x.get("email")||"").trim(), name:String(x.get("name")||"").trim(), role:String(x.get("role")) });
      b.disabled = false; b.textContent = "➕ Add teammate";
      if(q.err){ box.querySelector("#bpxTeamErr").textContent = q.err; return; }
      var d = q.data, url = d.login_url || (location.origin+"/brand/"), text = "Your Geek OS login for "+brandName()+"\nLink: "+url+"\nEmail: "+d.email+"\nPassword: "+d.password+"\n(Change the password in Settings after signing in.)";
      paintTeam(box).then(function(){ var o = box.querySelector("#bpxTeamOut"); if(!o) return;
        o.innerHTML = '<div class="bl-creds" style="margin-top:10px"><div class="bl-ok">✓ Login ready — share it with your teammate. The password is shown only now.</div><div class="bpx-kv"><span>Email</span><div><b>'+esc(d.email)+'</b></div></div><div class="bpx-kv"><span>Password</span><div><code>'+esc(d.password)+'</code></div></div><button class="btn sm" type="button" id="bpxTeamCopy">📋 Copy login</button></div>';
        o.querySelector("#bpxTeamCopy").onclick = function(){ try{ navigator.clipboard.writeText(text); gateToast("Copied ✓"); }catch(er){} }; }); };
  }

  // ---------- Facebook Login for Business (link from Settings; sign-in is on the brand login page — login.js)
  async function fbStart(mode){
    var nonce = Array.from(crypto.getRandomValues(new Uint8Array(12))).map(function(x){ return x.toString(16).padStart(2,"0"); }).join("");
    try{ sessionStorage.setItem("geek_fb_brand", nonce+":"+mode); }catch(e){}
    var r = await sb.functions.invoke("brand-fb-login", { body:{ action:"url", redirect_uri: location.origin + "/app.html", state: "fbbrand:"+mode+":"+nonce } });
    var m = (r.data&&r.data.error) || (r.error && (typeof fnError==="function" ? await fnError(r.error) : r.error.message));
    if(m){ gateToast(m); return; } location.href = r.data.url;
  }
  // back from Facebook while signed in (link)
  async function fbReturn(){
    var q = new URLSearchParams(location.search), st = q.get("state")||"", code = q.get("code");
    if(!/^fbbrand:link:/.test(st)) return false;
    history.replaceState({}, "", location.pathname);
    var saved = ""; try{ saved = sessionStorage.getItem("geek_fb_brand")||""; sessionStorage.removeItem("geek_fb_brand"); }catch(e){}
    if(saved !== st.split(":")[2]+":link"){ gateToast("Facebook link expired — try again."); return true; }
    if(!code){ gateToast("Facebook link was cancelled."); return true; }
    var r = await sb.functions.invoke("brand-fb-login", { body:{ action:"link", code:code, redirect_uri: location.origin + "/app.html" } });
    var m = (r.data&&r.data.error) || (r.error && (typeof fnError==="function" ? await fnError(r.error) : r.error.message));
    gateToast(m ? m : "✓ Facebook business linked — next time just tap Continue with Facebook");
    BP.data = null; if(currentRole==="brand"){ currentPage = "settings"; renderShell(); }
    return true;
  }

  // ---------- Super Admin: preview a brand's portal from Brand CRM
  function preview(brandId, name){
    var old = document.getElementById("bpxPrev"); if(old) old.remove();
    var m = el("div","modal-overlay open"); m.id = "bpxPrev";
    m.innerHTML = '<div class="modal modal-lg bpx-prev"><div class="modal-head"><strong>👁 '+esc(name||"Brand")+' — what the brand login sees</strong><button class="icon-btn" id="bpxPrevX" aria-label="Close">✕</button></div><div class="modal-form" id="bpxPrevB"></div></div>';
    document.body.appendChild(m);
    var close = function(){ m.remove(); BP.preview = null; BP.host = null; BP.data = null; BP.camp = {}; BP.an = {}; BP.top = {}; BP.open = null; };
    document.getElementById("bpxPrevX").onclick = close; m.onclick = function(e){ if(e.target.id==="bpxPrev") close(); };
    BP.preview = brandId; BP.host = document.getElementById("bpxPrevB"); BP.data = null; BP.camp = {}; BP.an = {}; BP.top = {}; BP.open = null;
    go("dashboard");
  }

  window.BrandPortal = {
    pages:["dashboard","approvals","campaigns","creators","reports","settings"],
    handles: function(page){ return currentRole==="brand" && !window.__isAdmin && this.pages.indexOf(page)>=0; },
    render: function(page){ BP.host = null; BP.preview = null; return render(page); },
    mount: function(page){ return mount(page); },
    fbReturn: fbReturn, fbStart: fbStart, preview: preview,
    reset: function(){ BP.data = null; BP.camp = {}; BP.an = {}; }
  };
})();
