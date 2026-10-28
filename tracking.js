/* 🔗 Link & coupon tracking — every creator's own link + code, clicks, code copies, orders and sales.
 * Used on: the campaign page (Super Admin / agency: 🔗 Links & codes), the brand's campaign page (read + add sales),
 * and the creator's own campaign card (their link + code inside the post instructions).
 * Data: api.track_report / track_link_set / track_codes_bulk / track_sales_add / track_sale_delete / my_track_links. */
(function(){
  "use strict";
  var e = function(v){ return String(v==null?"":v).replace(/[&<>"']/g,function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); };
  var api = function(fn, args){ return sb.schema("api").rpc(fn, args||{}).then(function(r){ return r; }, function(x){ return { error:x }; }); };
  var num = function(v){ return v==null||v==="" ? "—" : Number(v).toLocaleString("en-IN"); };
  var inr = function(v){ return v==null||v==="" ? "—" : "₹" + Math.round(Number(v)||0).toLocaleString("en-IN"); };
  var toast = function(m){ if(typeof gateToast==="function") gateToast(m); };
  var base = function(){ var g = window.GEEK_CONFIG; return ((g && g.appUrl) || location.origin).replace(/\/+$/,""); };
  var linkOf = function(slug){ return base() + "/go/" + slug; };
  var shortLink = function(slug){ return linkOf(slug).replace(/^https?:\/\//,""); };
  var ago = function(t){ if(!t) return "—"; var m = Math.round((Date.now()-new Date(t).getTime())/60000); return m<1?"just now":m<60?m+"m ago":m<1440?Math.round(m/60)+"h ago":Math.round(m/1440)+"d ago"; };
  var copyText = function(t, btn){
    var done = function(){ if(btn){ var o = btn.innerHTML; btn.innerHTML = "✓ Copied"; setTimeout(function(){ btn.innerHTML = o; }, 1400); } else toast("Copied ✓"); };
    try{ if(navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, done);
         else { var x = document.createElement("textarea"); x.value = t; document.body.appendChild(x); x.select(); document.execCommand("copy"); x.remove(); done(); } }catch(err){ done(); }
  };
  // any [data-trkcopy] anywhere copies its value
  document.addEventListener("click", function(ev){ var b = ev.target.closest && ev.target.closest("[data-trkcopy]"); if(!b) return;
    ev.preventDefault(); ev.stopPropagation(); copyText(b.getAttribute("data-trkcopy"), b); });
  var STAGE = function(s){ return String(s||"").replace(/_/g," "); };
  var MODE = { none:"Link only — no code", common:"One code for every creator", per_creator:"A different code per creator" };

  var S = {};   // per mounted box: { campaign, data, q, sort }
  function modal(title, inner){
    if(typeof bpModal==="function") return bpModal(title, inner);
    var m = document.createElement("div"); m.className = "modal-overlay open"; m.id = "bpModal";
    m.innerHTML = '<div class="modal"><div class="modal-head"><strong>'+title+'</strong><button class="icon-btn" data-x>✕</button></div>'+inner+'</div>';
    document.body.appendChild(m); m.querySelector("[data-x]").onclick = function(){ m.remove(); }; return m;
  }

  // ------------------------------------------------------------------ the report (campaign page / brand portal)
  async function mount(box, campaign, opts){
    if(!box) return; opts = opts || {};
    var st = S[box.id] && S[box.id].campaign===campaign ? S[box.id] : (S[box.id] = { q:"", sort:"clicks" });
    st.campaign = campaign; st.opts = opts;
    if(!st.data) box.innerHTML = typeof skel==="function" ? skel("list",4) : "Loading…";
    var r = await api("track_report", { p_campaign: campaign });
    if(!box.isConnected) return;
    if(r.error){ box.innerHTML = '<div class="ci-err-inline">'+e(r.error.message||r.error)+(/track_report/.test(r.error.message||"")?' — run <code>supabase db push</code>.':'')+'</div>'; return; }
    st.data = r.data || {}; paint(box);
  }
  function paint(box){
    var st = S[box.id], d = st.data, cfg = d.config || {}, L = (d.links||[]).slice(), admin = !!d.can_edit, opts = st.opts || {};
    var on = cfg.enabled === true || cfg.enabled === "true", mode = cfg.mode || "none";
    var dest = cfg.dest_url || cfg.product_link || "";
    var T = L.reduce(function(a,x){ a.clicks += +x.clicks||0; a.unique += +x.unique||0; a.copies += +x.copies||0; a.shop += +x.shop||0; a.orders += +x.orders||0; a.sales += +x.sales||0; if(+x.clicks>0) a.active++; return a; },
      { clicks:0, unique:0, copies:0, shop:0, orders:0, sales:0, active:0 });
    var SL = d.sales || [], notSplit = SL.filter(function(s){ return !s.handle; }), nsOrders = notSplit.reduce(function(a,s){ return a+(+s.orders||0); },0),
        nsSales = notSplit.reduce(function(a,s){ return a+(+s.amount||0); },0);
    var allOrders = T.orders + nsOrders, allSales = T.sales + nsSales;
    var q = st.q.toLowerCase();
    var shown = L.filter(function(x){ return !q || [x.handle, x.name, x.code, x.slug, x.stage].join(" ").toLowerCase().indexOf(q)>=0; });
    var key = st.sort;
    shown.sort(function(a,b){ return key==="name" ? String(a.handle||"").localeCompare(String(b.handle||"")) : key==="orders" ? (+b.orders||0)-(+a.orders||0) || (+b.sales||0)-(+a.sales||0)
      : key==="copies" ? (+b.copies||0)-(+a.copies||0) : key==="recent" ? new Date(b.last_click||0)-new Date(a.last_click||0) : (+b.clicks||0)-(+a.clicks||0); });
    var kpi = function(v,l,s){ return '<div class="trk-kpi"><b>'+v+'</b><span>'+l+'</span>'+(s?'<small>'+s+'</small>':'')+'</div>'; };
    var days = (d.daily||[]).slice(-30), mx = Math.max.apply(null, days.map(function(x){ return +x.clicks||0; }).concat([1]));
    var codeCell = function(x){
      if(mode==="none" && !x.own_code) return '<span class="muted">—</span>';
      if(!admin || opts.readOnly) return x.code ? '<code class="trk-code">'+e(x.code)+'</code>'+(x.own_code||mode!=="common"?'':' <span class="muted" style="font-size:11px">common</span>') : '<span class="muted">no code yet</span>';
      return '<input class="trk-codein" data-trkcode="'+e(x.link_id)+'" value="'+e(x.own_code||"")+'" placeholder="'+e(mode==="common"?(cfg.common_code||"common code"):"add code")+'" maxlength="30" spellcheck="false">';
    };
    box.innerHTML =
      (!on ? '<div class="trk-off">🔗 Tracking is <b>off</b> for this campaign. '+(admin&&!opts.readOnly?'Turn it on in <b>✏️ Edit campaign → 🔗 Link &amp; coupon tracking</b> — links below are ready either way.':'The Geek team can switch it on.')+'</div>' : '')
      + '<div class="trk-setup"><div><span class="muted">Opens</span> '+(dest?'<a href="'+e(dest)+'" target="_blank" rel="noopener">'+e(String(dest).replace(/^https?:\/\//,"").slice(0,60))+' ↗</a>':'<b class="trk-warn">no shop link yet</b>')+'</div>'
      +   '<div><span class="muted">Code</span> <b>'+e(MODE[mode]||mode)+'</b>'+(mode==="common"&&cfg.common_code?' · <code class="trk-code">'+e(cfg.common_code)+'</code>':'')+(cfg.prefix?' · auto: '+e(cfg.prefix)+'+handle':'')+'</div>'
      +   (cfg.discount?'<div><span class="muted">Offer</span> '+e(cfg.discount)+'</div>':'')
      +   '<div><span class="muted">Tags</span> '+(cfg.utm===false?'off':'UTM on (utm_source=geek)')+(cfg.shopify_code?' · Shopify code auto-applied':'')+'</div>'
      +   (L.some(function(x){ return x.dest_url; })?'<div><span class="muted">Own brand links</span> <b>'+L.filter(function(x){ return x.dest_url; }).length+'</b> creators</div>':'')
      +   (admin&&!opts.readOnly&&typeof opts.onEdit==="function"?'<button class="mini-btn ghost" data-trkedit>✏️ Change</button>':'')+'</div>'
      + '<div class="trk-kpis">'+kpi(num(L.length),"Creators with a link", T.active+" got clicks")+kpi(num(T.clicks),"Link clicks", num(T.unique)+" unique people")
      +   kpi(num(T.copies),"Code copies", T.unique?Math.round(100*T.copies/T.unique)+"% of visitors":"")+kpi(num(T.shop),"Went to the shop","")
      +   kpi(num(allOrders),"Orders", nsOrders?num(nsOrders)+" not split by creator":"")+kpi(inr(allSales),"Sales", allOrders&&T.unique?"conversion "+(Math.round(1000*allOrders/T.unique)/10)+"%":"")+'</div>'
      + (days.length>1?'<div class="trk-days" title="Clicks per day">'+days.map(function(x){ return '<i style="height:'+Math.max(3, Math.round(56*(+x.clicks||0)/mx))+'px" title="'+e(x.d)+': '+num(x.clicks)+' clicks, '+num(x.copies)+' copies"></i>'; }).join("")+'</div><div class="muted trk-dayl">Clicks per day — last '+days.length+' days</div>':'')
      + '<div class="trk-bar"><input type="search" id="'+box.id+'Q" placeholder="🔎 Creator, code…" value="'+e(st.q)+'">'
      +   '<select id="'+box.id+'Sort">'+[["clicks","Most clicks"],["orders","Most orders"],["copies","Most code copies"],["recent","Last clicked"],["name","Name A → Z"]].map(function(o){ return '<option value="'+o[0]+'"'+(st.sort===o[0]?' selected':'')+'>'+o[1]+'</option>'; }).join("")+'</select>'
      +   '<span class="trk-acts">'+(admin&&!opts.readOnly?'<button class="btn sm ghost" data-trkpaste>📋 Paste codes / links</button>':'')
      +   (d.can_add_sales?'<button class="btn sm ghost" data-trksale>➕ Add sales</button><button class="btn sm ghost" data-trkcsv>📤 Upload order report</button>':'')
      +   '<button class="btn sm ghost" data-trkdl>⬇️ Download</button></span></div>'
      + (shown.length?'<div class="trk-tablew"><table class="tbl trk-tbl"><thead><tr><th>Creator</th><th>Geek link</th><th>Opens (brand link)</th><th>Code</th><th>Clicks</th><th>Unique</th><th>Copies</th><th>To shop</th><th>Orders</th><th>Sales</th><th>Last click</th></tr></thead><tbody>'
        + shown.map(function(x){ return '<tr><td><div class="trk-who">'+(x.picture?'<img src="'+e(x.picture)+'" alt="" referrerpolicy="no-referrer" onerror="this.remove()">':'<span class="avatar">'+e(String(x.handle||"?").slice(0,2).toUpperCase())+'</span>')
            + '<div><b>'+(x.handle?'@'+e(x.handle):e(x.name||"Creator"))+'</b><div class="muted">'+e([x.kind==="geek"?"On Geek OS":"Sheet", STAGE(x.stage)].join(" · "))+'</div></div></div></td>'
            + '<td><div class="trk-link"><a href="'+e(linkOf(x.slug))+'" target="_blank" rel="noopener" title="'+e(linkOf(x.slug))+'">/go/'+e(x.slug)+'</a><button class="mini-btn ghost" data-trkcopy="'+e(linkOf(x.slug))+'">Copy</button>'
            +   (admin&&!opts.readOnly?'<button class="mini-btn ghost" data-trkregen="'+e(x.link_id)+'" title="Make a new link — the old one stops working">🔄</button>':'')+'</div></td>'
            + '<td>'+(admin&&!opts.readOnly?'<input class="trk-urlin" data-trkurl="'+e(x.link_id)+'" value="'+e(x.dest_url||"")+'" placeholder="'+e(dest?"Campaign link (default)":"https://brand.com/…")+'" spellcheck="false">'
            :   (x.dest_url?'<a href="'+e(x.dest_url)+'" target="_blank" rel="noopener" class="trk-dest">'+e(String(x.dest_url).replace(/^https?:\/\//,"").slice(0,40))+'</a>':'<span class="muted">campaign link</span>'))+'</td>'
            + '<td>'+codeCell(x)+'</td><td><b>'+num(x.clicks)+'</b></td><td>'+num(x.unique)+'</td><td>'+num(x.copies)+'</td><td>'+num(x.shop)+'</td>'
            + '<td>'+(+x.orders?'<b>'+num(x.orders)+'</b>':'0')+'</td><td>'+(+x.sales?inr(x.sales):'—')+'</td><td class="muted">'+e(ago(x.last_click))+'</td></tr>'; }).join("")
        + '</tbody></table></div>' : '<div class="muted" style="padding:12px">'+(L.length?'No creator matches.':'No creators on this campaign yet — every creator added gets a link automatically.')+'</div>')
      + (SL.length?'<details class="trk-sales"'+(opts.openSales?' open':'')+'><summary>🧾 Orders &amp; sales entered ('+SL.length+')'+(nsOrders?' · '+num(nsOrders)+' orders on a shared code (not split by creator)':'')+'</summary><div class="trk-tablew"><table class="tbl"><thead><tr><th>Date</th><th>Creator</th><th>Code</th><th>Order</th><th>Orders</th><th>Amount</th><th>From</th><th></th></tr></thead><tbody>'
        + SL.map(function(s){ return '<tr><td>'+e(s.ordered_on||String(s.created_at||"").slice(0,10))+'</td><td>'+(s.handle?'@'+e(s.handle):'<span class="muted">not split</span>')+'</td><td>'+(s.code?'<code class="trk-code">'+e(s.code)+'</code>':'—')+'</td>'
            + '<td>'+e(s.order_ref||"—")+'</td><td>'+num(s.orders)+'</td><td>'+inr(s.amount)+'</td><td class="muted">'+e((s.source==="csv"?"Report":"Typed")+(s.by?" · "+s.by:""))+'</td>'
            + '<td><button class="mini-btn ghost" data-trkdel="'+e(s.sale_id)+'" title="Remove">✕</button></td></tr>'; }).join("")+'</tbody></table></div></details>':'')
      + '<div class="muted trk-foot">Clicks, unique people, code copies and "went to the shop" are counted live from each creator\'s link. Orders &amp; sales come from the brand\'s own order report (📤 Upload) or are typed in (➕ Add sales) — matched to the creator by their code or @handle; an order number is never counted twice.</div>';
    wire(box);
  }
  function wire(box){
    var st = S[box.id], d = st.data, opts = st.opts || {};
    var qi = box.querySelector("#"+box.id+"Q"); if(qi) qi.oninput = function(){ st.q = qi.value; var p = qi.selectionStart; paint(box); var n = box.querySelector("#"+box.id+"Q"); if(n){ n.focus(); try{ n.setSelectionRange(p,p); }catch(err){} } };
    var so = box.querySelector("#"+box.id+"Sort"); if(so) so.onchange = function(){ st.sort = so.value; paint(box); };
    var ed = box.querySelector("[data-trkedit]"); if(ed) ed.onclick = function(){ opts.onEdit(); };
    box.querySelectorAll("[data-trkcode]").forEach(function(inp){
      var save = async function(){ var v = inp.value.trim().toUpperCase().replace(/\s+/g,""); inp.value = v;
        var x = (d.links||[]).find(function(l){ return l.link_id===inp.dataset.trkcode; }) || {}; if((x.own_code||"")===v) return;
        if(v && !/^[A-Z0-9_-]{2,30}$/.test(v)){ toast("A code is 2–30 letters / numbers, no spaces"); inp.value = x.own_code||""; return; }
        if(v && (d.links||[]).some(function(l){ return l.link_id!==x.link_id && l.own_code===v; }) && !confirm(v+" is already another creator's code. Use it for both? (orders on it then can't be split by creator)")){ inp.value = x.own_code||""; return; }
        inp.disabled = true; var r = await api("track_link_set", { p_link: inp.dataset.trkcode, p_code: v||null }); inp.disabled = false;
        if(r.error){ toast(r.error.message); inp.value = x.own_code||""; return; }
        x.own_code = v||null; x.code = v || ((d.config||{}).mode==="common" ? (d.config||{}).common_code : null); toast(v ? "Code saved ✓ "+v : "Code removed"); };
      inp.onchange = save; inp.onkeydown = function(ev){ if(ev.key==="Enter"){ ev.preventDefault(); inp.blur(); } };
    });
    box.querySelectorAll("[data-trkurl]").forEach(function(inp){
      inp.onchange = async function(){ var v = inp.value.trim(), x = (d.links||[]).find(function(l){ return l.link_id===inp.dataset.trkurl; }) || {};
        if((x.dest_url||"")===v) return;
        if(v && !/^https?:\/\/\S+$/i.test(v)){ toast("The link must start with https://"); inp.value = x.dest_url||""; return; }
        inp.disabled = true; var r = await api("track_link_set_dest", { p_link: inp.dataset.trkurl, p_url: v||null }); inp.disabled = false;
        if(r.error){ toast(r.error.message); inp.value = x.dest_url||""; return; }
        x.dest_url = v||null; toast(v ? "✓ @"+(x.handle||"")+"'s link opens this now" : "Uses the campaign link again"); };
      inp.onkeydown = function(ev){ if(ev.key==="Enter"){ ev.preventDefault(); inp.blur(); } };
    });
    box.querySelectorAll("[data-trkregen]").forEach(function(b){ b.onclick = async function(){
      if(!confirm("Make a new link for this creator? The old link stops working — send them the new one.")) return; b.disabled = true;
      var r = await api("track_link_regen", { p_link: b.dataset.trkregen }); if(r.error){ toast(r.error.message); b.disabled = false; return; }
      toast("🔄 New link: "+linkOf(r.data.slug)); mount(box, st.campaign, st.opts); }; });
    var pb = box.querySelector("[data-trkpaste]"); if(pb) pb.onclick = function(){ pasteCodes(box); };
    var sb2 = box.querySelector("[data-trksale]"); if(sb2) sb2.onclick = function(){ addSales(box); };
    var cb = box.querySelector("[data-trkcsv]"); if(cb) cb.onclick = function(){ uploadReport(box); };
    var db = box.querySelector("[data-trkdl]"); if(db) db.onclick = function(){ download(box); };
    box.querySelectorAll("[data-trkdel]").forEach(function(b){ b.onclick = async function(){ if(!confirm("Remove this entry?")) return; b.disabled = true;
      var r = await api("track_sale_delete", { p_sale: b.dataset.trkdel }); toast(r.error ? r.error.message : "Removed"); mount(box, st.campaign, st.opts); }; });
  }
  function pasteCodes(box){
    var st = S[box.id];
    var m = modal("📋 Paste codes &amp; brand links", '<form class="modal-form" id="trkPF"><p class="muted" style="margin:0;font-size:13px">One per line, in any of these shapes — straight from the brand\'s sheet:<br><b>@handle, CODE</b> · <b>@handle, https://brand-link</b> · <b>@handle, CODE, https://brand-link</b><br>A line with <b>only a code</b> goes to the next creator who has none — paste the brand\'s list of codes as it is.</p>'
      + '<textarea name="t" rows="10" placeholder="@riya.sharma, OLIORIYA15, https://brand.com/p/serum?ref=riya\n@foodie.aman, https://brand.com/p/combo\n@style.neha, OLIONEHA15\nOLIO15A"></textarea>'
      + '<label class="cp-check"><input type="checkbox" name="ow"> Replace codes / links creators already have</label><div class="auth-err" id="trkPE"></div><button class="btn" type="submit">Save</button></form>');
    var f = m.querySelector("#trkPF");
    f.onsubmit = async function(ev){ ev.preventDefault();
      var withH = [], pool = [];
      f.t.value.split(/\r?\n/).map(function(l){ return l.trim(); }).filter(Boolean).forEach(function(l){
        var url = (l.match(/https?:\/\/\S+/i)||[""])[0]; var rest = l.replace(url, " ");
        var p = rest.split(/[,\t;]+|\s+/).map(function(x){ return x.trim(); }).filter(Boolean);
        var h = p.length && (/^@/.test(p[0]) || p.length>1 || url) ? p[0].replace(/^@/,"") : "", code = p.length>1 ? p[p.length-1] : (!h && p[0]) || "";
        if(h && p.length===1) code = "";
        if(h) withH.push({ handle:h, code:code, url:url }); else if(code) pool.push({ code:code }); });
      if(!withH.length && !pool.length){ m.querySelector("#trkPE").textContent = "Paste at least one line."; return; }
      var b = f.querySelector("button[type=submit]"); b.disabled = true; b.textContent = "Saving…"; var msg = [];
      if(withH.length){ var r = await api("track_links_bulk", { p_campaign: st.campaign, p_rows: withH, p_overwrite: !!f.ow.checked });
        if(r.error){ m.querySelector("#trkPE").textContent = r.error.message; b.disabled = false; b.textContent = "Save"; return; }
        if(r.data.codes) msg.push(r.data.codes+" code"+(r.data.codes===1?"":"s")); if(r.data.links) msg.push(r.data.links+" brand link"+(r.data.links===1?"":"s")); if(r.data.skipped) msg.push(r.data.skipped+" @handle not on this campaign"); }
      if(pool.length){ var r2 = await api("track_codes_bulk", { p_campaign: st.campaign, p_rows: pool, p_overwrite: false });
        if(r2.error){ m.querySelector("#trkPE").textContent = r2.error.message; b.disabled = false; b.textContent = "Save"; return; }
        msg.push(r2.data.set+" code"+(r2.data.set===1?"":"s")+" from the list"); }
      m.remove(); toast("✓ Saved: "+(msg.join(" · ")||"nothing new")); mount(box, st.campaign, st.opts); };
  }
  function addSales(box){
    var st = S[box.id], L = (st.data.links||[]);
    var opts = '<option value="">Pick the creator…</option>' + L.map(function(x){ return '<option value="h:'+e(x.handle||"")+'">@'+e(x.handle||x.slug)+(x.code?' · '+e(x.code):'')+'</option>'; }).join("")
      + ((st.data.config||{}).mode==="common"?'<option value="c:'+e((st.data.config||{}).common_code||"")+'">Shared code '+e((st.data.config||{}).common_code||"")+' (not split by creator)</option>':'');
    var line = function(){ return '<div class="trk-sline"><select data-w>'+opts+'</select><input data-o placeholder="Order no. (optional)"><input data-n type="number" min="1" value="1" title="Orders"><input data-a inputmode="decimal" placeholder="Amount ₹"><input data-d type="date"></div>'; };
    var m = modal("➕ Add orders / sales", '<form class="modal-form" id="trkSF"><p class="muted" style="margin:0;font-size:13px">From the brand\'s store or seller panel. One line per order — or one line per creator with the total number of orders and amount. With an order number, the same order is never counted twice.</p>'
      + '<div class="trk-shead"><span>Creator / code</span><span>Order no.</span><span>Orders</span><span>Amount</span><span>Date</span></div><div id="trkSL">'+line()+line()+line()+'</div>'
      + '<button type="button" class="mini-btn ghost" id="trkSMore">+ Another line</button><div class="auth-err" id="trkSE"></div><button class="btn" type="submit">Save</button></form>');
    m.querySelector(".modal").classList.add("modal-lg");
    m.querySelector("#trkSMore").onclick = function(){ m.querySelector("#trkSL").insertAdjacentHTML("beforeend", line()); };
    var f = m.querySelector("#trkSF");
    f.onsubmit = async function(ev){ ev.preventDefault();
      var rows = [].slice.call(m.querySelectorAll(".trk-sline")).map(function(r){ var w = r.querySelector("[data-w]").value;
        return { handle: /^h:/.test(w) ? w.slice(2) : "", code: /^c:/.test(w) ? w.slice(2) : "", order_ref: r.querySelector("[data-o]").value.trim(), orders: r.querySelector("[data-n]").value,
                 amount: r.querySelector("[data-a]").value, date: r.querySelector("[data-d]").value }; }).filter(function(x){ return x.handle || x.code; });
      if(!rows.length){ m.querySelector("#trkSE").textContent = "Pick a creator on at least one line."; return; }
      var b = f.querySelector("button[type=submit]"); b.disabled = true; b.textContent = "Saving…";
      var r = await api("track_sales_add", { p_campaign: st.campaign, p_rows: rows, p_source: "manual" });
      if(r.error){ m.querySelector("#trkSE").textContent = r.error.message; b.disabled = false; b.textContent = "Save"; return; }
      m.remove(); toast("✓ "+r.data.added+" saved"+(r.data.duplicates?" · "+r.data.duplicates+" already there":"")); st.opts.openSales = true; mount(box, st.campaign, st.opts); };
  }
  // the brand's order report (Shopify / WooCommerce / Amazon / any CSV): pick the columns once, we match each order to its creator
  function parseCsv(text){
    var rows = [], row = [], cur = "", q = false;
    for(var i=0;i<text.length;i++){ var ch = text[i];
      if(q){ if(ch==='"'){ if(text[i+1]==='"'){ cur+='"'; i++; } else q = false; } else cur += ch; continue; }
      if(ch==='"') q = true; else if(ch===','||ch===';'||ch==='\t'){ row.push(cur); cur=""; } else if(ch==='\n'){ row.push(cur); rows.push(row); row=[]; cur=""; } else if(ch!=='\r') cur += ch; }
    if(cur || row.length){ row.push(cur); rows.push(row); }
    return rows.filter(function(r){ return r.some(function(c){ return String(c).trim(); }); });
  }
  function uploadReport(box){
    var st = S[box.id];
    var m = modal("📤 Upload the brand's order report", '<div class="modal-form" id="trkUB"><p class="muted" style="margin:0;font-size:13px">Download the orders / discount-code report from the brand\'s store or seller panel as <b>CSV</b> (Shopify → Orders → Export, WooCommerce → Orders export, Amazon / Flipkart / Nykaa seller reports…) and upload it here. Only orders that used one of this campaign\'s codes are kept.</p>'
      + '<input type="file" accept=".csv,text/csv,.txt" id="trkUF"><div id="trkUM"></div></div>');
    m.querySelector(".modal").classList.add("modal-lg");
    m.querySelector("#trkUF").onchange = function(ev){ var file = ev.target.files[0]; if(!file) return; var rd = new FileReader();
      rd.onload = function(){ var R = parseCsv(String(rd.result||"")); if(R.length<2){ m.querySelector("#trkUM").innerHTML = '<div class="auth-err">That file has no rows.</div>'; return; } mapCols(m, box, R); };
      rd.readAsText(file); };
  }
  function mapCols(m, box, R){
    var st = S[box.id], head = R[0].map(function(h){ return String(h).trim(); }), body = R.slice(1);
    var guess = function(re){ var i = head.findIndex(function(h){ return re.test(h); }); return i; };
    var g = { code: guess(/discount ?code|coupon|promo|voucher|code/i), order: guess(/^name$|order ?(id|no|number|#)|^order$|^id$/i),
              amount: guess(/^total$|order ?total|grand ?total|amount|subtotal|net sales|revenue/i), date: guess(/created ?at|order ?date|^date$|paid ?at|purchase ?date/i), handle: guess(/creator|influencer|handle|instagram/i) };
    var sel = function(k, label, need){ return '<label>'+label+'<select data-col="'+k+'"><option value="-1">'+(need?'— pick —':'Not in this file')+'</option>'+head.map(function(h,i){ return '<option value="'+i+'"'+(g[k]===i?' selected':'')+'>'+e(h||("Column "+(i+1)))+'</option>'; }).join("")+'</select></label>'; };
    var codes = {}; (st.data.links||[]).forEach(function(l){ if(l.code) codes[String(l.code).toUpperCase()] = l.handle; });
    var cm = (st.data.config||{}).common_code; if(cm) codes[String(cm).toUpperCase()] = null;
    var out = m.querySelector("#trkUM");
    out.innerHTML = '<div class="mf-row">'+sel("code","Coupon / discount code column",true)+sel("order","Order number column")+'</div><div class="mf-row">'+sel("amount","Amount column")+sel("date","Date column")+'</div>'
      + '<div id="trkUP" class="muted" style="font-size:13px"></div><div class="auth-err" id="trkUE"></div><button class="btn" id="trkUGo" type="button">Add these orders</button>';
    var col = function(k){ var s = out.querySelector('[data-col="'+k+'"]'); return s ? +s.value : -1; };
    var build = function(){
      var ci = col("code"), oi = col("order"), ai = col("amount"), di = col("date"), seen = {}, rows = [], other = 0;
      body.forEach(function(r){
        var raw = ci>=0 ? String(r[ci]||"") : ""; if(!raw.trim()) return;
        var hit = raw.toUpperCase().split(/[\s,;|+]+/).map(function(x){ return x.trim(); }).find(function(x){ return x && Object.prototype.hasOwnProperty.call(codes, x); });
        if(!hit){ other++; return; }
        var ord = oi>=0 ? String(r[oi]||"").trim() : "";
        if(ord && seen[ord]) return; if(ord) seen[ord] = 1;               // a store export repeats an order on every product line
        var dt = di>=0 ? String(r[di]||"").trim() : "", dd = dt ? new Date(dt.replace(/ [+-]\d{4}$/,"")) : null;
        rows.push({ code: hit, order_ref: ord, amount: ai>=0 ? String(r[ai]||"").replace(/[^0-9.]/g,"") : "", orders: 1, date: dd && !isNaN(dd) ? dd.toISOString().slice(0,10) : "" });
      });
      var per = {}; rows.forEach(function(x){ per[x.code] = (per[x.code]||0)+1; });
      out.querySelector("#trkUP").innerHTML = ci<0 ? "Pick the column that has the coupon code." : '<b>'+rows.length+'</b> order'+(rows.length===1?"":"s")+' used this campaign\'s codes'
        + (rows.length?': '+Object.keys(per).slice(0,12).map(function(k){ return e(k)+' × '+per[k]; }).join(", "):'')+(other?' · '+other+' other order'+(other===1?"":"s")+' skipped (other codes)':'')
        + (oi<0?'<br>⚠️ No order number column — uploading the same file twice will count orders twice.':'');
      return rows;
    };
    out.querySelectorAll("[data-col]").forEach(function(s){ s.onchange = build; }); build();
    out.querySelector("#trkUGo").onclick = async function(){ var rows = build(), b = this; if(!rows.length){ out.querySelector("#trkUE").textContent = "No order in this file used this campaign's codes."; return; }
      b.disabled = true; b.textContent = "Adding…"; var added = 0, dup = 0;
      for(var i=0;i<rows.length;i+=500){ var r = await api("track_sales_add", { p_campaign: st.campaign, p_rows: rows.slice(i,i+500), p_source:"csv" });
        if(r.error){ out.querySelector("#trkUE").textContent = r.error.message; b.disabled = false; b.textContent = "Add these orders"; return; } added += r.data.added; dup += r.data.duplicates; }
      m.remove(); toast("✓ "+added+" order"+(added===1?"":"s")+" added"+(dup?" · "+dup+" were already there":"")); st.opts.openSales = true; mount(box, st.campaign, st.opts); };
  }
  function download(box){
    var st = S[box.id], d = st.data, L = d.links||[];
    var csv = [["Creator","Name","On Geek OS","Stage","Geek link","Opens (brand link)","Code","Clicks","Unique people","Code copies","Went to shop","Orders","Sales (INR)","Last click"]]
      .concat(L.map(function(x){ return ["@"+(x.handle||""), x.name||"", x.kind==="geek"?"Yes":"No", STAGE(x.stage), linkOf(x.slug), x.dest_url || (d.config||{}).dest_url || (d.config||{}).product_link || "", x.code||"", x.clicks, x.unique, x.copies, x.shop, x.orders, x.sales, x.last_click||""]; }));
    var text = csv.map(function(r){ return r.map(function(c){ c = String(c==null?"":c); return /[",\n]/.test(c) ? '"'+c.replace(/"/g,'""')+'"' : c; }).join(","); }).join("\n");
    var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["\ufeff"+text], { type:"text/csv" }));
    a.download = "links-and-codes-" + String((d.config||{}).campaign||"campaign").replace(/[^\w]+/g,"-").toLowerCase() + ".csv"; a.click();
  }

  // ------------------------------------------------------------------ the creator's own box (post instructions)
  function creatorHtml(t){
    if(!t || !t.slug) return "";
    var url = linkOf(t.slug);
    return '<div class="trk-mine"><div class="trk-mine-h">🔗 <b>Your link'+(t.code?' &amp; code':'')+' for this campaign</b></div>'
      + '<div class="trk-mine-row"><span>Link</span><a href="'+e(url)+'" target="_blank" rel="noopener">'+e(shortLink(t.slug))+'</a><button class="mini-btn" data-trkcopy="'+e(url)+'">Copy link</button></div>'
      + (t.code?'<div class="trk-mine-row"><span>Code</span><code class="trk-code">'+e(t.code)+'</code><button class="mini-btn" data-trkcopy="'+e(t.code)+'">Copy code</button>'+(t.discount?'<span class="muted">'+e(t.discount)+'</span>':'')+'</div>':'')
      + '<ul class="trk-how"><li>Put the link in your <b>story link sticker</b> and your <b>bio</b> while the campaign runs.</li>'
      + (t.code?'<li>Say the code <b>'+e(t.code)+'</b> in your video and write it in your caption.</li>':'')
      + '<li>Use only <b>your</b> link'+(t.code?' and code':'')+' — that\'s how your results are counted.</li></ul>'
      + '<div class="trk-mine-stats"><span><b>'+num(t.clicks)+'</b> clicks</span>'+(t.code?'<span><b>'+num(t.copies)+'</b> code copies</span>':'')+'<span><b>'+num(t.orders)+'</b> orders</span></div></div>';
  }

  window.Tracking = { mount: mount, creatorHtml: creatorHtml, linkOf: linkOf };
})();
