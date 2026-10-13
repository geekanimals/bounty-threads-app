/* Creator Profile — DARK, flag-gated UI (Phase 1A).
 * Renders ONLY when api.creator_profile_api_enabled() returns true. In production the `api`
 * schema is not exposed to the Data API, so the RPC is unreachable, `enabled` stays false, the
 * nav entry stays hidden, and the legacy app is completely unchanged. All reads/writes go through
 * the secure api-schema RPCs — never directly to intel/private tables. No fabricated data: missing
 * values render as "—"/empty, never 0; no fake audience insights, brand detections or scores. */
(function () {
  "use strict";
  var enabled = false, DATA = null, COMP = null, saveTimers = {}, dirty = {};
  window.__ciProfileEnabled = false;

  function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function api(fn, args){ return window.sb.schema("api").rpc(fn, args || {}); }
  function badge(kind){
    var m = { from_instagram:["Verified Instagram","ig"], from_geek_account:["Account data","acct"],
              creator_entered:["Self-reported","self"], detected_from_content:["System detected","det"] };
    var b = m[kind] || ["Self-reported","self"];
    return '<span class="cp-badge cp-'+b[1]+'">'+esc(b[0])+'</span>';
  }
  function srcOf(field){ try{ return (DATA.provenance && DATA.provenance[field] && DATA.provenance[field].source) || null; }catch(e){ return null; } }
  function val(v){ return (v==null || v==="") ? "" : v; }
  function deriveAge(dob){ if(!dob) return null; var d=new Date(dob); if(isNaN(d)) return null; var t=new Date(), a=t.getFullYear()-d.getFullYear(); var m=t.getMonth()-d.getMonth(); if(m<0||(m===0&&t.getDate()<d.getDate()))a--; return a>=0&&a<130?a:null; }

  /* ---------- flag boot ---------- */
  var _bootP = null;
  function boot(){ if(!_bootP) _bootP = bootOnce(); return _bootP; }
  async function bootOnce(){
    try{
      if(!window.sb || !window.sb.schema) { enabled=false; }
      else { var r = await api("creator_profile_api_enabled"); enabled = !!(r && !r.error && r.data === true); }
    }catch(e){ enabled=false; }
    window.__ciProfileEnabled = enabled;
    if(enabled && window.__osBooted && typeof renderShell === "function") renderShell();
  }

  /* ---------- page skeleton ---------- */
  window.renderProfile = function(){
    if(!enabled){
      return '<div class="card"><h3>Creator Profile</h3><div class="muted">This feature isn\'t enabled for your account yet.</div></div>';
    }
    return ''
      + '<div id="cpRoot" class="cp">'
      + '  <div id="cpHead" class="cp-head">'+(window.skel?skel("profile"):'<div class="card"><div class="muted">Loading your profile…</div></div>')+'</div>'
      + '  <div id="cpBody"></div>'
      + '  <div id="cpErr" class="cp-err" style="display:none"></div>'
      + '</div>';
  };

  /* ---------- data load ---------- */
  async function load(){
    var root = document.getElementById("cpRoot"); if(!root) return;
    try{
      var p = await api("get_my_profile");
      if(p.error){ throw p.error; }
      if(!p.data){ // no profile yet → bootstrap
        var b = await api("bootstrap_my_profile", { p_correlation: "ui-bootstrap" });
        if(b.error) throw b.error;
        p = await api("get_my_profile");
      }
      DATA = p.data || {};
      var extra = await Promise.all([ api("get_profile_completion"), safe("get_my_pets"), safe("get_my_managed_profiles"), safe("get_my_travel"),
                                      safe("sync_my_whatsapp"), igAccount() ]);
      var c = extra[0]; COMP = (c && !c.error) ? c.data : null;
      PETS = extra[1] || []; PAGES = extra[2] || []; TRAVEL = extra[3] || null; IG = extra[5] || null;
      if(extra[4] && extra[4].whatsapp_e164){ DATA.contact = DATA.contact || {}; DATA.contact.whatsapp_e164 = extra[4].whatsapp_e164;
        DATA.contact.whatsapp_verified_at = DATA.contact.whatsapp_verified_at || extra[4].verified_at; }
      await loadReq();
      try { var ing = await api("get_my_ingestion_status"); window.__ciIngest = (ing && !ing.error) ? ing.data : null; } catch(e){ window.__ciIngest = null; }
      renderAll();
    }catch(e){
      var err = document.getElementById("cpErr");
      if(err){ err.style.display="block"; err.textContent = "Couldn't load your profile. "+(e.message||e); }
    }
  }

  var PETS = [], PAGES = [], TRAVEL = null, IG = null, _brandSynced = false;
  async function safe(fn, args){ try{ var r = await api(fn, args); return (r && !r.error) ? r.data : null; }catch(e){ return null; } }
  async function igAccount(){
    try{ var me = window.Auth && Auth.profile && Auth.profile.id; if(!me || !window.sb.from) return null;
      var r = await window.sb.from("social_accounts").select("username,name,biography,account_type,followers_count,recent_media,mentions")
        .eq("platform","instagram").eq("member_id", me).limit(1);
      return (r && r.data && r.data[0]) || null; }catch(e){ return null; }
  }
  var SKILLS = ["Modelling","Live / Video Creator","Video Editor","Photographer","Draw / Paint / Doodle","Performance Arts","Content Writer","Singer",
    "Dancer","Comedy / Acting","Illustrator","MC / Host","Research","DJ / Music","Graphic Designer / UI UX","Sustainability","Performing Artist",
    "Hacker","Coder / Developer","Caregiver","Digital Marketing","Storytelling","Meme"];
  var RESOURCES = ["Studio","Camera","Car","Bike","Meeting or Shooting Space","Tripod","Speaker","Mike","Lights"];
  var PET_TYPES = [["dog","Dog"],["cat","Cat"],["bird","Bird"],["fish","Fish"],["rabbit","Rabbit"],["hamster","Hamster"],["small_mammal","Small mammal"],["reptile","Reptile"],["horse","Horse"],["other","Other"]];
  // niche keywords → category, used only to pre-fill an empty category list (the creator can edit it)
  var NICHES = { "Food":/\b(food|foodie|recipe|cafe|restaurant|eats|cook|chef|bak(e|ing)|momo|biryani|street ?food)/i,
    "Fashion":/\b(fashion|outfit|ootd|style|wear|saree|ethnic|streetwear)/i, "Beauty":/\b(makeup|skincare|beauty|grwm|hair ?care|lipstick)/i,
    "Fitness":/\b(fitness|gym|workout|yoga|fit|health)/i, "Travel":/\b(travel|trip|wanderlust|explore|vacation|backpack)/i,
    "Tech":/\b(tech|gadget|unboxing|smartphone|laptop|coding|ai)\b/i, "Comedy":/\b(comedy|funny|meme|skit|lol)/i,
    "Lifestyle":/\b(lifestyle|vlog|daily|routine|life)/i, "Parenting":/\b(mom|mother|dad|parent|baby|kids)/i,
    "Gaming":/\b(gaming|gamer|bgmi|valorant|esports)/i, "Finance":/\b(finance|stock|invest|money|crypto)/i,
    "Music":/\b(music|singer|song|cover|dj)/i, "Dance":/\b(dance|choreo)/i, "Art":/\b(art|artist|paint|sketch|doodle)/i,
    "Pets":/\b(dog|cat|pet|puppy)/i, "Home decor":/\b(decor|interior|home ?tour)/i, "Auto":/\b(car|bike|auto|motor)/i };
  function inferCategories(){
    if(!IG) return [];
    var text = [IG.biography||"", IG.name||""].concat((IG.recent_media||[]).map(function(m){ return m.caption||""; })).join(" \n ");
    var score = Object.keys(NICHES).map(function(k){ var m = text.match(new RegExp(NICHES[k].source, "gi")); return [k, m?m.length:0]; })
      .filter(function(x){ return x[1] > 0; }).sort(function(a,b){ return b[1]-a[1]; });
    return score.slice(0,3).map(function(x){ return x[0]; });
  }
  // brands detected from the creator's own posts (@mentions, #ad/#collab = paid) and from posts brands tagged them in
  function detectBrands(){
    if(!IG) return [];
    var own = String(IG.username||"").toLowerCase(), mine = {}; (PAGES||[]).forEach(function(p){ mine[String(p.handle).toLowerCase()] = 1; }); mine[own] = 1;
    var out = {}, add = function(h, paid, link){ h = String(h||"").toLowerCase().replace(/^@/,"").replace(/\.+$/,""); if(!/^[a-z0-9._]{2,30}$/.test(h) || mine[h]) return;
      if(!out[h]) out[h] = { handle:h, paid:false, permalink:link||null }; if(paid) out[h].paid = true; };
    (IG.recent_media||[]).forEach(function(m){ var cap = String(m.caption||""), paid = /#(ad|ads|collab|sponsored|partner|paidpartnership)\b|paid partnership/i.test(cap);
      (cap.match(/@[A-Za-z0-9._]{2,30}/g)||[]).forEach(function(h){ add(h, paid, m.permalink); }); });
    (IG.mentions||[]).forEach(function(m){ if(m && m.username) add(m.username, false, m.permalink); });
    return Object.keys(out).slice(0,40).map(function(k){ return out[k]; });
  }
  function defaultAddr(){ var a = (DATA && DATA.addresses) || []; return a.filter(function(x){ return x.is_default; })[0] || a[0] || null; }
  function fullName(){ var p = (DATA && DATA.personal) || {}; return [p.first_name, p.last_name].filter(Boolean).join(" ").trim() || (IG && IG.name) || ""; }

  var REQ = null;
  async function loadReq(){
    try{ var r = await api("get_profile_requirements"); if(r && !r.error && r.data){ REQ = r.data; window.__profileReq = REQ; } }catch(e){}
    if(REQ && window.onProfileRequirements) window.onProfileRequirements(REQ);
    return REQ;
  }
  function reqBanner(){
    if(!REQ) return "";
    if(REQ.complete) return '<div class="cp-req cp-ready"><div><b>✅ You\'re ready for campaigns</b> <span class="muted">— all '+REQ.total+' required details added. Keep them up to date.</span></div>'
      + '<button class="btn sm" id="cpGoCampaigns">Browse campaigns →</button></div>';
    return '<div class="cp-req"><div class="cp-req-h"><b>🔒 Complete your profile to unlock Geek OS</b><span>'+REQ.done+' / '+REQ.total+' done</span></div>'
      + '<div class="cp-bar"><span style="width:'+Math.round(100*REQ.done/Math.max(REQ.total,1))+'%"></span></div>'
      + '<div class="cp-req-list">'+(REQ.items||[]).map(function(it){
          return '<a href="#" class="cp-req-it '+(it.done?"done":"")+'" data-goto="'+esc(it.section)+'">'+(it.done?"✓":"○")+' '+esc(it.label)+'</a>'; }).join("")+'</div></div>';
  }
  function header(){
    var pct = COMP ? COMP.completion_pct : 0;
    var missing = (COMP && COMP.missing_core) ? COMP.missing_core : [];
    var groups = COMP ? COMP.groups : {};
    var chip = function(k,label){ var on = groups && groups[k]; return '<span class="cp-chip '+(on?"on":"")+'">'+(on?"✓":"○")+" "+esc(label)+'</span>'; };
    return ''
      + '<div id="cpHead" class="card cp-head">' + reqBanner()
      + '  <div class="cp-head-top"><h3>Your Creator Profile</h3><span id="cpSave" class="cp-savestate"></span></div>'
      + (REQ ? '' : (''
      + '  <div class="cp-progress"><div class="cp-bar"><span style="width:'+pct+'%"></span></div><b>'+pct+'% complete</b></div>'
      + '  <div class="cp-chips">'+chip("personal","Personal")+chip("contact","Contact")+chip("professional","Professional")
      +      chip("skills","Skills")+chip("barter","Barter")+chip("rate_card","Rate card")
      +      '<span class="cp-chip opt">'+(groups&&groups.brand_experience?"✓":"○")+' Brands (optional)</span>'
      +      '<span class="cp-chip opt">'+(groups&&groups.dream_brands?"✓":"○")+' Dream brands (optional)</span></div>'
      + (missing.length ? '<div class="muted cp-todo">Still to complete: '+missing.map(esc).join(", ")+'</div>' : '<div class="muted cp-todo">Core profile complete. Optional sections don\'t affect completion.</div>')
      ))
      + '</div>';
  }

  function field(label, id, value, opts){
    opts = opts || {};
    var src = opts.source ? " "+badge(opts.source) : "";
    var ro = opts.readonly ? " readonly" : "";
    var type = opts.type || "text";
    var hint = opts.hint ? '<div class="cp-hint">'+esc(opts.hint)+'</div>' : "";
    var priv = opts.privacy ? '<span class="cp-priv">'+esc(opts.privacy)+'</span>' : "";
    if(opts.select){
      var options = opts.select.map(function(o){ return '<option value="'+esc(o[0])+'"'+(String(value)===String(o[0])?" selected":"")+'>'+esc(o[1])+'</option>'; }).join("");
      return '<label class="cp-f"><span>'+esc(label)+src+priv+'</span><select id="'+id+'"'+ro+'>'+options+'</select>'+hint+'</label>';
    }
    if(opts.textarea){
      return '<label class="cp-f"><span>'+esc(label)+src+priv+'</span><textarea id="'+id+'" rows="3"'+ro+'>'+esc(val(value))+'</textarea>'+hint+'</label>';
    }
    return '<label class="cp-f"><span>'+esc(label)+src+priv+'</span><input id="'+id+'" type="'+type+'" value="'+esc(val(value))+'"'+ro+'>'+hint+'</label>';
  }

  function section(key, title, inner, opts){
    opts = opts || {};
    return '<div class="card cp-sec" data-sec="'+key+'"><div class="cp-sec-h"><h4>'+esc(title)+'</h4>'
      + (opts.sub ? '<span class="cp-sub">'+opts.sub+'</span>' : '<span class="cp-sec-status" data-status="'+key+'"></span>')+'</div>'
      + '<div class="cp-sec-b">'+inner+'</div></div>';
  }
  function multiSelect(id, options, selected, placeholder){
    var sel = {}; selected.forEach(function(x){ sel[String(x).toLowerCase()] = x; });
    var custom = selected.filter(function(x){ return !options.some(function(o){ return o.toLowerCase() === String(x).toLowerCase(); }); });
    var all = options.concat(custom);
    return '<details class="cp-ms" id="'+id+'"><summary><span class="cp-ms-val">'+(selected.length
        ? selected.map(function(x){ return '<span class="cp-tag">'+esc(x)+'</span>'; }).join("")
        : '<span class="muted">'+esc(placeholder)+'</span>')+'</span><span class="cp-ms-caret">▾</span></summary>'
      + '<div class="cp-ms-panel">'+all.map(function(o){ var on = !!sel[o.toLowerCase()];
          return '<label class="cp-ms-opt'+(on?" on":"")+'"><input type="checkbox" data-ms="'+id+'" value="'+esc(o)+'"'+(on?" checked":"")+'> '+esc(o)+'</label>'; }).join("")
      + '<div class="cp-ms-other"><input data-ms-other="'+id+'" placeholder="Other — type and press Add" maxlength="40"><button class="btn sm ghost" type="button" data-ms-add="'+id+'">Add</button></div>'
      + '</div></details>';
  }

  function renderAll(){
    var head = document.getElementById("cpHead"), bodyEl = document.getElementById("cpBody");
    if(!head || !bodyEl) return;          // page changed / re-rendered while loading — a newer load() will paint
    head.outerHTML = header();
    var d = DATA, personal = d.personal||{}, contact = d.contact||{}, pro = d.professional||{}, conn = d.connection;
    var body = "";

    // Phase 1B connect disclosure/CTA (not connected) or first-run ingestion progress (connected).
    if(window.ciConnect){ body += window.ciConnect.panelHtml(!!(conn && conn.connected), window.__ciIngest); }

    // connection (verified IG) — read-only, live
    if(conn && conn.connected){
      body += '<div class="card cp-conn"><div class="cp-conn-row">'+badge("from_instagram")
        + '<b>@'+esc(conn.username||"")+'</b>'
        + (conn.profile_link?' · <a href="'+esc(conn.profile_link)+'" target="_blank" rel="noopener">Open</a>':"")
        + '</div><div class="cp-conn-stats">'
        + '<span>Followers: <b>'+(conn.followers_count==null?"—":esc(conn.followers_count))+'</b></span>'
        + '<span>Following: <b>'+(conn.follows_count==null?"—":esc(conn.follows_count))+'</b></span>'
        + '<span>Posts: <b>'+(conn.media_count==null?"—":esc(conn.media_count))+'</b></span></div>'
        + '<div class="cp-hint">Instagram identity is verified and read-only. Need a change? '
        + '<a href="#" id="cpReconnect">Request correction / reconnect</a>.</div></div>';
    }

    // Other pages / profiles the creator manages — picked at apply time
    body += section("pages","Other pages & profiles you manage",
        '<div class="cp-list">'+(PAGES.length?PAGES.map(function(p){
            return '<div class="cp-item"><div><b>@'+esc(p.handle)+'</b> <span class="cp-badge cp-self">'+esc(p.platform)+'</span>'
              + '<div class="muted">'+esc([p.followers!=null?Number(p.followers).toLocaleString("en-IN")+" followers":"", p.category||"", (p.relation||"").replace(/_/g," ")].filter(Boolean).join(" · "))+'</div></div>'
              + '<button class="btn sm ghost" data-delpage="'+esc(p.managed_id)+'">Remove</button></div>'; }).join("")
          : '<div class="muted">Run a food page, a brand page or a second account? Add it here — when you apply to a campaign you choose which profile to apply with.</div>')+'</div>'
      + '<div class="cp-grid cp-grid-4" style="margin-top:12px">'
      + field("Username","cp_pg_handle","",{hint:"e.g. @mumbaieats"})
      + field("Platform","cp_pg_platform","instagram",{select:[["instagram","Instagram"],["youtube","YouTube"],["facebook","Facebook"],["x","X"],["linkedin","LinkedIn"],["other","Other"]]})
      + field("Followers","cp_pg_followers","",{type:"number"})
      + field("Page type","cp_pg_rel","own",{select:[["own","My own page"],["fan_page","Fan / meme page"],["brand_page","Brand page I run"],["client","Client page I manage"],["other","Other"]]})
      + field("Category","cp_pg_cat","",{hint:"e.g. Food, Travel"})
      + '</div><div class="cp-addrow"><button class="btn sm" id="cp_pg_add">+ Add profile</button></div>',
      {sub:"Optional"});

    // A Personal
    var mar = personal.marital_status || "";
    var age = deriveAge(personal.date_of_birth);
    var hasPet = personal.has_pet==null ? (PETS.length?"yes":"") : (personal.has_pet?"yes":"no");
    body += section("personal","Personal details",
        '<div class="cp-grid">'
      + field("First name","cp_first",personal.first_name)
      + field("Last name","cp_last",personal.last_name)
      + field("Gender *","cp_gender",personal.gender,{select:[["","Select…"],["female","Female"],["male","Male"],["non_binary","Non-binary"],["other","Other"],["prefer_not_to_say","Prefer not to say"]],privacy:"Private"})
      + field("Birthday *","cp_dob",personal.date_of_birth,{type:"date",privacy:"Private",hint: age!=null? "Age "+age+" (calculated, never stored)":"Age is calculated from DOB, never stored"})
      + field("Married / unmarried *","cp_marital",mar,{select:[["","Select…"],["single","Unmarried"],["married","Married"],["divorced","Divorced"],["widowed","Widowed"],["prefer_not_to_say","Prefer not to say"]],privacy:"Private"})
      + '<div id="cp_anniv_wrap" style="'+(mar==="married"?"":"display:none")+'">'+field("Marriage anniversary *","cp_anniv",personal.marriage_anniversary,{type:"date",privacy:"Private"})+'</div>'
      + field("Do you have pets? *","cp_pet_on",hasPet,{select:[["","Select…"],["yes","Yes"],["no","No"]],privacy:"Private"})
      + '</div>'
      + '<div id="cp_pet_more" class="cp-sub-block" style="'+(hasPet==="yes"?"":"display:none")+'"><div class="cp-hint"><b>Your pets</b> — add every one</div>'
      +   '<div class="cp-list">'+(PETS.length?PETS.map(function(x){
              var t = (PET_TYPES.filter(function(p){ return p[0]===x.pet_type; })[0]||[0,x.pet_type])[1];
              return '<div class="cp-item"><div>🐾 <b>'+esc(x.name)+'</b> <span class="muted">· '+esc(t)+'</span></div><button class="btn sm ghost" data-delpet="'+esc(x.pet_id)+'">Remove</button></div>'; }).join("")
            : '<div class="muted">No pets added yet.</div>')+'</div>'
      +   '<div class="cp-addrow"><input id="cp_pet_name" placeholder="Pet name" maxlength="60"><select id="cp_pet_type"><option value="">Type…</option>'
      +   PET_TYPES.map(function(p){ return '<option value="'+p[0]+'">'+p[1]+'</option>'; }).join("")+'</select><button class="btn sm" id="cp_pet_add">+ Add pet</button></div></div>'
      + '<div class="cp-note">* Required. “Prefer not to say” is a valid answer. Private — used only to personalise campaigns (birthday / anniversary gifting, pet brands), never shown to brands.</div>');

    // B Contact — WhatsApp from the verified login; backup email verified by OTP
    var emailOk = contact.email && !/@creators\.bountythreads\.app$/i.test(contact.email);
    body += section("contact","Contact",
        '<div class="cp-grid">'
      + '<label class="cp-f"><span>WhatsApp number <span class="cp-priv">Private</span></span><div class="cp-verified-in"><input id="cp_wa" value="'+esc(contact.whatsapp_e164||"")+'" readonly>'
      +   (contact.whatsapp_e164?'<span class="cp-ok">✓ Verified</span>':'')+'</div>'
      +   '<div class="cp-hint">'+(contact.whatsapp_e164?"Verified with your WhatsApp login OTP.":"Sign in with WhatsApp to add your number.")+'</div></label>'
      + '<label class="cp-f"><span>Backup email (account recovery) * <span class="cp-priv">Private</span></span><div class="cp-verified-in">'
      +   '<input id="cp_email" type="email" value="'+esc(emailOk?contact.email:"")+'" placeholder="you@gmail.com" autocomplete="email">'
      +   (emailOk && contact.email_verified_at ? '<span class="cp-ok" id="cp_email_ok">✓ Verified</span>' : '<button class="btn sm" type="button" id="cp_email_send">Verify</button>')+'</div>'
      +   '<div id="cp_email_otp" class="cp-otp" style="display:none"><input id="cp_email_code" inputmode="numeric" maxlength="6" placeholder="6-digit code"><button class="btn sm" type="button" id="cp_email_check">Confirm</button><button class="btn sm ghost" type="button" id="cp_email_resend">Resend</button></div>'
      +   '<div class="cp-hint" id="cp_email_msg">'+(emailOk && contact.email_verified_at ? "Verified — change it anytime, we'll ask for a new code." : "We'll email you a 6-digit code to confirm.")+'</div></label>'
      + '</div><div class="cp-note">Campaign updates reach you on both WhatsApp and email, and in your dashboard alerts. Never shown to brands.</div>');

    // C Delivery addresses (one or many; one is the default for shipments)
    var addrs = (d.addresses || []);
    body += section("address","Delivery addresses *",
        '<div class="cp-list" id="cp_addr_list">'+(addrs.length?addrs.map(function(a){
            return '<div class="cp-item"><div><b>'+esc(a.label||"Address")+'</b>'+(a.is_default?' <span class="cp-badge">Default</span>':'')
              + '<div class="muted">'+esc([a.line1,a.line2,a.landmark,a.city,a.state,a.postal_code].filter(Boolean).join(", "))+'</div></div>'
              + '<div class="cp-item-acts">'
              + '<button class="btn sm ghost" data-editaddr="'+esc(a.address_id)+'">Edit</button>'
              + (a.is_default?'':'<button class="btn sm ghost" data-defaddr="'+esc(a.address_id)+'">Make default</button>')
              + '<button class="btn sm ghost" data-deladdr="'+esc(a.address_id)+'">Remove</button></div></div>';
          }).join(""):'<div class="muted">No address yet — add where brands should ship your products.</div>')+'</div>'
      + '<div class="cp-addr-tools"><span class="cp-hint" id="cp_addr_mode">Add a new address</span>'
      + '<button class="btn sm" type="button" id="cp_geo">📍 Use my current location</button></div>'
      + '<div class="cp-hint" id="cp_geo_msg"></div>'
      + '<div class="cp-grid">'
      + '<input type="hidden" id="cp_addr_id" value="">'
      + field("Label","cp_addr_label","Home",{select:[["Home","Home"],["Office","Office"],["Manager","Manager / agent"],["Other","Other (studio, PG, family…)"]]})
      + field("House / flat, building","cp_l1","",{privacy:"Campaign-only"})
      + field("Street / area","cp_l2","")
      + field("Locality / landmark","cp_landmark","")
      + field("City","cp_city","")
      + field("State","cp_state","")
      + field("PIN / postal code","cp_pin","")
      + field("Country","cp_country","India")
      + '</div><label class="cp-check"><input type="checkbox" id="cp_addr_default"'+(addrs.length?'':' checked')+'> Use as my default shipping address</label>'
      + '<div class="cp-addrow"><button class="btn sm" id="cp_addr_save">Save address</button><button class="btn sm ghost" id="cp_addr_new">Clear / new</button></div>'
      + '<div class="cp-note">Your full address is private, used only for campaign logistics you approve — never shown in search or to brands.</div>',
      {sub:"City, state & PIN required"});

    // D Professional — name / city come from above, categories from Instagram
    var da = defaultAddr(), cats = (pro.categories||[]).length ? pro.categories : inferCategories();
    var catsAuto = !(pro.categories||[]).length && cats.length;
    body += section("professional","Professional",
        '<div class="cp-grid">'
      + field("Creator / display name","cp_dname",fullName()||pro.display_name,{readonly:true,hint:"From your first & last name above"})
      + field("Instagram username","cp_iguser",conn?("@"+(conn.username||"")):(pro.instagram_username||""),{readonly:true,source:conn?"from_instagram":null})
      + field("Primary city","cp_city2",(da&&da.city)||pro.city_coarse,{readonly:true,hint:da?"From your default address":"Add an address above"})
      + field("State","cp_state2",(da&&da.state)||pro.state_coarse,{readonly:true})
      + field("Profile category / niche","cp_cats",cats.join(", "),{hint:catsAuto?"Detected from your Instagram — edit if needed (comma separated)":"Comma separated, e.g. Food, Travel",source:catsAuto?"detected_from_content":null})
      + field("Instagram account type","cp_igtype",IG&&IG.account_type?String(IG.account_type).replace(/_/g," ").toLowerCase():"—",{readonly:true,source:IG&&IG.account_type?"from_instagram":null})
      + field("Content languages (comma separated)","cp_langs",(pro.languages||[]).join(", "),{hint:"e.g. Hindi, English"})
      + field("Travel willingness","cp_travel",pro.travel_willingness,{select:[["","—"],["city_only","City only"],["domestic","Domestic"],["international","International"],["not_available","Not available"]]})
      + field("Availability","cp_avail",pro.availability_status,{select:[["","—"],["available","Available"],["limited","Limited"],["unavailable","Unavailable"]]})
      + field("Management","cp_mgmt",pro.management_status,{select:[["","—"],["self_managed","Self-managed"],["agency_managed","Agency-managed"],["celebrity_agent_managed","Celebrity / agent-managed"]]})
      + '</div>'
      + '<div class="cp-sub-block"><div class="cp-hint"><b>✈️ Travelling right now?</b> (optional) — brands planning a campaign there can find you</div>'
      + '<div class="cp-grid cp-grid-4">'
      + field("City","cp_tr_city",TRAVEL&&TRAVEL.city) + field("State","cp_tr_state",TRAVEL&&TRAVEL.state)
      + field("Country","cp_tr_country",(TRAVEL&&TRAVEL.country)||"") + field("Till","cp_tr_until",TRAVEL&&TRAVEL.until_date,{type:"date"})
      + '</div></div>');

    // E Skills & Resources — multi-select dropdowns (+ Other)
    var mySkills = (d.skills||[]).map(function(s){return s.skill_key;}), myRes = (d.resources||[]).map(function(r){return r.resource_key;});
    body += section("skills","Skills & resources",
        '<div class="cp-f"><span>Skills * <span class="muted">select all that apply</span></span>'+multiSelect("ms_skill", SKILLS, mySkills, "Select your skills")+'</div>'
      + '<div class="cp-f" style="margin-top:14px"><span>Resources / equipment * <span class="muted">what you can use for shoots</span></span>'+multiSelect("ms_res", RESOURCES, myRes, "Select your resources")+'</div>',
      {sub:"At least 1 of each"});

    // F Brands worked with — auto-detected from Instagram + manual
    var brands = (d.brand_experience||[]).filter(function(b){return !b.creator_rejected_at;});
    body += section("brands","Brands worked with",
        (brands.length ? '<div class="cp-list">'+brands.map(function(b){
            var det = b.source_type==="content_detected_suggestion";
            return '<div class="cp-item"><div><b>'+esc(b.submitted_brand_name||"(brand)")+'</b> '+(det?'<span class="cp-badge cp-ig">From Instagram</span>':'<span class="cp-badge cp-self">Added by you</span>')
              + '<div class="muted">'+esc((b.compensation_type||b.relationship_type||"").replace(/_/g," "))+(b.deliverables?" · "+esc(b.deliverables):"")+'</div></div>'
              + '<button class="btn sm ghost" '+(det?'data-rejbrand':'data-delbrand')+'="'+esc(b.experience_id)+'">Remove</button></div>';
          }).join("")+'</div>'
         : '<div class="muted">'+(IG?"No brand tags found in your recent posts yet.":"Connect Instagram to auto-detect brands you've tagged.")+' Add brands you\'ve worked with below.</div>')
      + '<div class="cp-addrow"><input id="cp_brand_name" placeholder="Brand name or @handle"><select id="cp_brand_rel"><option value="paid">Paid</option><option value="barter">Barter</option><option value="hybrid">Hybrid</option><option value="gifting">Gifting</option><option value="organic">Organic mention</option></select><button class="btn sm" data-add="brand">+ Add</button></div>'
      + '<div class="cp-note">Brands you tag in posts (and brands that tag you) are picked up from Instagram automatically — remove any that aren\'t a real collaboration.</div>',
      {sub:"Auto + manual"});

    // G Barter preferences
    var cp = d.commercial_preference||{};
    body += section("barter","Barter preferences",
        '<div class="cp-grid">'+field("Open to barter collaborations? *","cp_barter_on",cp.accepts_barter==null?"":(cp.accepts_barter?"yes":"no"),{select:[["","Select…"],["yes","Yes"],["no","No"]]})+'</div>'
      + '<div id="cp_barter_more" style="'+(cp.accepts_barter?"":"display:none")+'">'
      + '<div class="cp-grid" style="margin-top:12px">'
      + field("Scope","cp_barter_pref",cp.barter_preference,{select:[["","Any relevant brand"],["top_established_only","Top / established brands only"],["selected_brands_only","Selected brands only"]]})
      + field("Minimum product value (₹)","cp_barter_min",cp.min_product_value,{type:"number"})
      + field("Preferred categories (comma separated)","cp_barter_cats",(cp.preferred_categories||[]).join(", "))
      + field("Categories not accepted (comma separated)","cp_barter_excl",(cp.excluded_categories||[]).join(", "))
      + '</div><label class="cp-check"><input type="checkbox" id="cp_barter_travel"'+(cp.travel_ready?" checked":"")+'> Accept travel / visit barters</label>'
      + field("Notes / conditions","cp_barter_notes",cp.notes,{textarea:true})
      + '</div>');

    // H Paid rate card
    var items = ((d.rate_cards&&d.rate_cards[0]&&d.rate_cards[0].items)||[]);
    var DELIV = ["IG Reel","IG Story","IG Static Post","IG Carousel","IG Collab Reel","IG Live","Store/Restaurant Visit","UGC Video (no posting)","Usage Rights","Paid Amplification/Whitelisting","Exclusivity Add-on"];
    body += section("rate","Rate card",
        '<div class="cp-list" id="cp_rate_list">'+(items.length?items.map(function(it){
            return '<div class="cp-item"><div><b>'+esc(it.deliverable_type)+'</b> — ₹'+esc(Number(it.amount).toLocaleString("en-IN"))+' <span class="muted">× '+esc(it.unit_quantity||1)+'</span></div>'
              +'<button class="btn sm ghost" data-delitem="'+esc(it.rate_card_item_id)+'">Remove</button></div>';
          }).join(""):'<div class="muted">No rates added yet.</div>')+'</div>'
      + '<div class="cp-addrow"><select id="cp_rate_deliv">'+DELIV.map(function(x){return '<option>'+esc(x)+'</option>';}).join("")+'</select>'
      + '<input id="cp_rate_amt" type="number" min="0" placeholder="Amount ₹"><button class="btn sm" data-add="rate">+ Add</button></div>'
      + '<div class="cp-note">Rates are your declared expectations (INR). Negotiated campaign commercials are stored separately and never shown here.</div>',
      {sub:"Cost per Reel required"});

    // I Dream brands
    var dreams = (d.dream_brands||[]);
    body += section("dreams","Favourite brands",
        '<div class="cp-list" id="cp_dream_list">'+(dreams.length?dreams.map(function(x,i){
            return '<div class="cp-item"><div><b>#'+(x.priority_rank||i+1)+'</b> '+esc(x.submitted_brand_name||"(brand)")+'</div>'
              +'<button class="btn sm ghost" data-deldream="'+esc(x.aspiration_id)+'">Remove</button></div>';
          }).join(""):'<div class="muted">No favourite brands yet (add up to 10).</div>')+'</div>'
      + (dreams.length<10 ? '<div class="cp-addrow"><input id="cp_dream_name" placeholder="Brand name"><button class="btn sm" data-add="dream">+ Add</button></div>' : '<div class="muted">Maximum 10 reached.</div>')
      + '<div class="cp-note">Favourite brands are preferences — not campaign history or brand affinity.</div>',
      {sub:"At least 1"});

    // J Visibility
    body += section("visibility","Visibility & privacy",
        '<div class="cp-note" style="margin-top:0">Private always: WhatsApp, email, full DOB, marital status, anniversary, full address.</div>'
      + '<label class="cp-check"><input type="checkbox" id="cp_vis_rate" '+(visOn("rate_card")?"checked":"")+'> Show my rate range in the marketplace summary</label>'
      + '<label class="cp-check"><input type="checkbox" id="cp_vis_brands" '+(visOn("brand_experience")?"checked":"")+'> Show my verified brand experience to brands</label>'
      + '<div class="cp-note">Disabling data sharing may reduce Verified Data Coverage — it never lowers Performance, raises Fraud risk, or labels you unreliable.</div>',
      {sub:""});

    // "Get campaign-ready" lives inside the profile (was its own tab)
    if(window.__ciOpsEnabled) body += section("campready","Get campaign-ready",'<div id="opsOnbBody">'+(window.skel?skel("list",2):'')+'</div>',{sub:""});
    bodyEl.innerHTML = body;
    if(window.__ciOpsEnabled && window.ciOps && window.ciOps.loadOnboarding) window.ciOps.loadOnboarding();
    wire(); wireReq();
    autoFill();
    maybeOnboard();
  }

  /* keep derived fields in sync without a button: display name, primary city/state, detected categories & brands */
  var _autoBusy = false;
  async function autoFill(){
    if(_autoBusy) return; _autoBusy = true;
    try{
      var pro = (DATA && DATA.professional) || {}, da = defaultAddr(), patch = {}, name = fullName();
      if(name && name !== pro.display_name) patch.display_name = name;
      if(da && da.city && da.city !== pro.city_coarse) patch.city_coarse = da.city;
      if(da && da.state && da.state !== pro.state_coarse) patch.state_coarse = da.state;
      if(!(pro.categories||[]).length){ var ic = inferCategories(); if(ic.length) patch.categories = ic; }
      if(Object.keys(patch).length){
        var r = await api("save_profile_section", { p_section:"professional", p_patch:patch, p_correlation:"ui-auto" });
        if(!r.error){ DATA.professional = Object.assign({}, pro, patch); }
      }
      if(!_brandSynced && IG){
        _brandSynced = true;
        var items = detectBrands();
        if(items.length){ var b = await api("sync_detected_brands", { p_items: items }); if(b && !b.error && b.data > 0){ _autoBusy = false; return load(); } }
      }
    }catch(e){}
    _autoBusy = false;
  }

  /* ---------- post-connect onboarding popup: reel rate + barter opt-in ----------
   * Appears once, right after Instagram is connected, before the creator has set a Reel rate.
   * Saves through the same api RPCs the manual sections use; "Skip" is remembered per creator. */
  function onbKey(){ var id="me"; try{ id=(window.Auth&&Auth.profile&&(Auth.profile.id||Auth.profile.user_id))||(window.Auth&&Auth.user&&Auth.user.id)||"me"; }catch(e){} return "ci_ob_commercial_"+id; }
  function onbDismissed(){ try{ return localStorage.getItem(onbKey())==="1"; }catch(e){ return false; } }
  function setOnbDismissed(){ try{ localStorage.setItem(onbKey(),"1"); }catch(e){} }
  function maybeOnboard(){
    try{
      var d=DATA||{}, conn=d.connection;
      if(!(conn && conn.connected)) return;                 // only after Instagram is connected
      var items=((d.rate_cards&&d.rate_cards[0]&&d.rate_cards[0].items)||[]);
      if(items.some(function(it){ return /reel/i.test(it.deliverable_type||""); })) return; // already onboarded
      if(onbDismissed()) return;                            // creator chose "skip" earlier
      showOnboard();
    }catch(e){}
  }
  function showOnboard(){
    if(document.getElementById("cpObOverlay")) return;
    var cp=(DATA&&DATA.commercial_preference)||{};
    var ov=document.createElement("div");
    ov.id="cpObOverlay"; ov.className="cp-ob-overlay";
    ov.innerHTML = ''
      + '<div class="cp-ob-modal" role="dialog" aria-modal="true" aria-label="Set your rates and barter preference">'
      + '  <div class="cp-ob-h"><h3>You’re connected 🎉</h3><button class="wa-x" id="cpObClose" aria-label="Close">×</button></div>'
      + '  <p class="muted">Two quick questions so brands can start matching you. You can change these anytime in your profile.</p>'
      + '  <label class="cp-f"><span>Your rate for one Instagram Reel (₹) <span class="cp-priv">You control visibility</span></span><input id="cpObRate" type="number" min="0" inputmode="numeric" placeholder="e.g. 15000"></label>'
      + '  <label class="cp-switch" style="margin:10px 0"><input type="checkbox" id="cpObBarter"'+(cp.accepts_barter?" checked":"")+'> <span>I’m open to barter campaigns (product in exchange for content)</span></label>'
      + '  <div class="cp-ob-actions"><button class="btn sm ghost" id="cpObSkip">Skip for now</button><button class="btn sm" id="cpObSave">Save &amp; continue</button></div>'
      + '  <div class="cp-hint cp-err-inline" id="cpObErr"></div>'
      + '</div>';
    document.body.appendChild(ov);
    function close(){ setOnbDismissed(); ov.remove(); }
    document.getElementById("cpObClose").onclick=close;
    document.getElementById("cpObSkip").onclick=close;
    document.getElementById("cpObSave").onclick=async function(){
      var err=document.getElementById("cpObErr"); err.textContent="";
      var amt=document.getElementById("cpObRate").value;
      var barter=document.getElementById("cpObBarter").checked;
      if(amt!=="" && (isNaN(Number(amt)) || Number(amt)<0)){ err.textContent="Enter a valid amount (≥ 0), or leave it blank."; return; }
      var btn=this; btn.disabled=true; btn.textContent="Saving…";
      try{
        var b=await api("save_profile_section",{p_section:"commercial_preference",p_patch:{accepts_barter:barter},p_correlation:"ui-onboard"});
        if(b.error) throw b.error;
        if(amt!=="" && Number(amt)>0){
          var r=await api("save_rate_card_item",{p_payload:{deliverable_type:"IG Reel",amount:Number(amt)},p_correlation:"ui-onboard"});
          if(r.error) throw r.error;
        }
        setOnbDismissed(); ov.remove(); load();
      }catch(e){ err.textContent="Couldn’t save: "+(e.message||e); btn.disabled=false; btn.textContent="Save & continue"; }
    };
  }

  function visOn(){ return false; } // default off; server is source of truth (no fabricated state)
  function renderTags(arr, kind){
    if(!arr || !arr.length) return '<span class="muted">None yet</span>';
    return arr.map(function(x){ return '<span class="cp-tag">'+esc(x)+'<button data-del'+kind+'="'+esc(x)+'">×</button></span>'; }).join("");
  }

  /* ---------- wiring ---------- */
  function setStatus(key, state, msg){
    var el = document.querySelector('[data-status="'+key+'"]'); if(!el) return;
    el.className = "cp-sec-status "+state;
    el.textContent = state==="saving"?"Saving…":state==="saved"?"✓ Auto-saved":state==="error"?("⚠ "+(msg||"Couldn't save")):(msg||"");
  }
  function topSave(state){ var s=document.getElementById("cpSave"); if(s){ s.className="cp-savestate "+state; s.textContent = state==="saving"?"Saving…":state==="saved"?"✓ All changes auto-saved":state==="error"?"Save failed":""; } }

  async function saveSection(key){
    var patch = collect(key); if(patch===null) return;
    setStatus(key,"saving"); topSave("saving");
    try{
      if(key==="professional"){ await saveTravel(); }
      if(Object.keys(patch).length){ var r = await api("save_profile_section", { p_section: sectionApi(key), p_patch: patch, p_correlation:"ui" }); if(r.error) throw r.error; }
      if(key==="personal"){ DATA.personal = Object.assign({}, DATA.personal||{}, patch); var dn=document.getElementById("cp_dname"); if(dn) dn.value = fullName(); autoFill(); }
      setStatus(key,"saved"); topSave("saved"); dirty[key]=false; window.__cpDirty = Object.keys(dirty).some(function(k){ return dirty[k]; });
      await refreshCompletion();
    }catch(e){ setStatus(key,"error", e.message||e); topSave("error"); }
  }
  function sectionApi(key){ return key==="barter"?"commercial_preference":key; }
  async function saveTravel(){
    function v(id){ var e=document.getElementById(id); return e?e.value.trim():""; }
    var city=v("cp_tr_city"), t={ p_city:city, p_state:v("cp_tr_state")||null, p_country:v("cp_tr_country")||null, p_until:v("cp_tr_until")||null };
    var cur=TRAVEL||{};
    if((cur.city||"")===city && (cur.state||null)===t.p_state && (cur.country||null)===t.p_country && (cur.until_date||null)===t.p_until) return;
    var r=await api("set_my_travel", t); if(r.error) throw r.error;
    TRAVEL = city ? { city:city, state:t.p_state, country:t.p_country, until_date:t.p_until } : null;
  }

  function collect(key){
    function v(id){ var e=document.getElementById(id); return e?e.value:undefined; }
    function num(id){ var x=v(id); return x===""||x==null?null:Number(x); }
    function arr(id){ var x=v(id); return x==null?undefined:x.split(",").map(function(s){return s.trim();}).filter(Boolean); }
    if(key==="personal"){
      var dob=v("cp_dob"); if(dob){ var d=new Date(dob); if(d>new Date()){ setStatus(key,"error","Date of birth can't be in the future"); return null; } }
      var mar=v("cp_marital");
      var petV=v("cp_pet_on"), hasPet=petV==="yes"?true:petV==="no"?false:null;
      var p={ first_name:v("cp_first")||null, last_name:v("cp_last")||null, gender:v("cp_gender")||null,
              date_of_birth:v("cp_dob")||null, marital_status:mar||null,
              marriage_anniversary:(mar==="married"?(v("cp_anniv")||null):null), has_pet:hasPet };
      if(hasPet===false){ p.pet_name=null; p.pet_type=null; }
      return p;
    }
    if(key==="professional"){
      return { categories:arr("cp_cats"), languages:arr("cp_langs"),
               travel_willingness:v("cp_travel")||null, availability_status:v("cp_avail")||null, management_status:v("cp_mgmt")||null };
    }
    if(key==="barter"){
      var bv=v("cp_barter_on"), on=bv==="yes"?true:bv==="no"?false:null;
      return { accepts_barter:on, barter_preference:v("cp_barter_pref")||null,
               preferred_categories:arr("cp_barter_cats"), excluded_categories:arr("cp_barter_excl"),
               min_product_value:num("cp_barter_min"), travel_ready:document.getElementById("cp_barter_travel").checked,
               notes:v("cp_barter_notes")||null };
    }
    return {};
  }

  async function saveAddress(){
    function v(id){ var e=document.getElementById(id); return e?e.value.trim():null; }
    var pin=v("cp_pin");
    if(pin && !/^[A-Za-z0-9 \-]{3,12}$/.test(pin)) throw new Error("Enter a valid postal/PIN code");
    var payload={ line1:v("cp_l1")||null, line2:v("cp_l2")||null, landmark:v("cp_landmark")||null,
      city:v("cp_city")||null, state:v("cp_state")||null, postal_code:pin||null, country:v("cp_country")||"India",
      label:(function(x){ x=String(x||"").trim().toLowerCase(); return x==="home"?"Home":x==="office"?"Office":x==="manager"?"Manager":x?"Other":"Home"; })(v("cp_addr_label")), is_default: !!(document.getElementById("cp_addr_default")||{}).checked };
    if(!payload.line1 || !payload.city || !payload.state || !payload.postal_code) throw new Error("House / flat, city, state and PIN are required");
    var id=v("cp_addr_id"); if(id) payload.address_id=id;
    var r=await api("upsert_address",{ p_payload:payload, p_correlation:"ui" }); if(r.error) throw r.error;
  }

  // 📍 current location → reverse geocode (OpenStreetMap Nominatim) → fill the address form; everything stays editable
  function useMyLocation(){
    var msg=document.getElementById("cp_geo_msg"), btn=document.getElementById("cp_geo");
    var say=function(t){ if(msg) msg.innerHTML=t; };
    if(!navigator.geolocation){ say("Location isn't available in this browser — type your address below."); return; }
    btn.disabled=true; btn.textContent="📍 Locating…"; say("");
    navigator.geolocation.getCurrentPosition(async function(pos){
      var lat=pos.coords.latitude, lon=pos.coords.longitude;
      try{
        var res=await fetch("https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=18&lat="+lat+"&lon="+lon, { headers:{ "Accept-Language":"en" } });
        var j=await res.json(), a=(j&&j.address)||{};
        var set=function(id,val){ var e=document.getElementById(id); if(e && val) e.value=val; };
        set("cp_l1",[a.house_number,a.building||a.amenity].filter(Boolean).join(", "));
        set("cp_l2",[a.road,a.neighbourhood||a.suburb].filter(Boolean).join(", "));
        set("cp_landmark",a.suburb||a.quarter||a.city_district||"");
        set("cp_city",a.city||a.town||a.village||a.county||a.state_district);
        set("cp_state",a.state); set("cp_pin",a.postcode); set("cp_country",a.country);
        say('✓ Filled from your location — check the house / flat number, then <b>Save address</b>. <a href="https://www.google.com/maps?q='+lat+','+lon+'" target="_blank" rel="noopener">View on Google Maps ↗</a>');
        var l1=document.getElementById("cp_l1"); if(l1 && !l1.value) l1.focus();
      }catch(e){ say("Couldn't look up your address — please type it below."); }
      btn.disabled=false; btn.textContent="📍 Use my current location";
    }, function(err){
      say(err && err.code===1 ? "Location permission was blocked — allow it in your browser, or type your address below." : "Couldn't get your location — type your address below.");
      btn.disabled=false; btn.textContent="📍 Use my current location";
    }, { enableHighAccuracy:true, timeout:15000, maximumAge:60000 });
  }

  // backup email: send OTP → enter code → ✓ verified (server writes it only after the code matches)
  function wireEmail(){
    var inp=document.getElementById("cp_email"), send=document.getElementById("cp_email_send"), box=document.getElementById("cp_email_otp"),
        msg=document.getElementById("cp_email_msg"), saved=((DATA.contact||{}).email||"").toLowerCase(), verified=!!(DATA.contact||{}).email_verified_at;
    if(!inp) return;
    var call=async function(body){ var r=await window.sb.functions.invoke("email-otp",{ body:body }); var d=r.data||{};
      if(r.error){ var m=r.error.message; try{ var c=r.error.context; if(c&&c.json){ var j=await c.json(); m=j.error||m; } }catch(e){} throw new Error(m||"Request failed"); }
      if(d.error) throw new Error(d.error); return d; };
    var showVerify=function(){ var ok=document.getElementById("cp_email_ok");
      if(ok && inp.value.trim().toLowerCase()!==saved){ ok.outerHTML='<button class="btn sm" type="button" id="cp_email_send">Verify</button>'; wireEmail(); } };
    inp.addEventListener("input", showVerify);
    var start=async function(){
      var em=inp.value.trim().toLowerCase();
      if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)){ msg.textContent="Enter a valid email address."; return; }
      if(em===saved && verified){ msg.textContent="This email is already verified."; return; }
      var b=document.getElementById("cp_email_send"); if(b){ b.disabled=true; b.textContent="Sending…"; }
      try{ await call({ action:"start", email:em }); box.style.display="flex"; msg.textContent="Code sent to "+em+" — check inbox / spam."; document.getElementById("cp_email_code").focus(); }
      catch(e){ msg.textContent="⚠ "+(e.message||e); }
      if(b){ b.disabled=false; b.textContent="Verify"; }
    };
    if(send) send.onclick=start;
    var rs=document.getElementById("cp_email_resend"); if(rs) rs.onclick=start;
    var ck=document.getElementById("cp_email_check");
    if(ck) ck.onclick=async function(){
      var code=(document.getElementById("cp_email_code").value||"").trim();
      if(!/^\d{6}$/.test(code)){ msg.textContent="Enter the 6-digit code."; return; }
      ck.disabled=true; ck.textContent="Checking…";
      try{ var d=await call({ action:"verify", code:code }); msg.textContent="✓ Verified — "+(d.email||"")+" is your backup email."; box.style.display="none"; await load(); }
      catch(e){ msg.textContent="⚠ "+(e.message||e); ck.disabled=false; ck.textContent="Confirm"; }
    };
  }

  async function refreshCompletion(){ try{ var c=await api("get_profile_completion"); if(c&&!c.error){ COMP=c.data; } await loadReq(); var h=document.getElementById("cpHead"); if(h){ h.outerHTML=header(); wireReq(); } }catch(e){} }
  function wireReq(){
    var gc=document.getElementById("cpGoCampaigns"); if(gc) gc.onclick=function(){ currentPage = window.__ciOpsEnabled ? "opencampaigns" : "marketplace"; renderShell(); };
    document.querySelectorAll("[data-goto]").forEach(function(a){ a.onclick=function(e){ e.preventDefault();
      var sec=document.querySelector('.cp-sec[data-sec="'+a.getAttribute("data-goto")+'"]'); if(sec){ sec.scrollIntoView({behavior:"smooth",block:"start"}); sec.classList.add("cp-flash"); setTimeout(function(){ sec.classList.remove("cp-flash"); },1600); } }; });
  }

  function wire(){
    // conditional anniversary + barter + pets reveal
    var mar=document.getElementById("cp_marital");
    if(mar) mar.onchange=function(){ document.getElementById("cp_anniv_wrap").style.display = (mar.value==="married")?"":"none"; };
    var bon=document.getElementById("cp_barter_on");
    if(bon) bon.onchange=function(){ document.getElementById("cp_barter_more").style.display = bon.value==="yes"?"":"none"; };
    var dob=document.getElementById("cp_dob");
    if(dob) dob.onchange=function(){ var a=deriveAge(dob.value); var h=dob.parentNode.querySelector(".cp-hint"); if(h) h.textContent = a!=null?("Age "+a+" (calculated, never stored)"):"Age is calculated from DOB, never stored"; };
    var pet=document.getElementById("cp_pet_on");
    if(pet) pet.onchange=function(){ var m=document.getElementById("cp_pet_more"); if(m) m.style.display = pet.value==="yes"?"":"none"; };
    // auto-save (debounced) on any change within a savable section
    document.querySelectorAll('.cp-sec[data-sec]').forEach(function(sec){
      var key=sec.getAttribute("data-sec");
      if(["personal","professional","barter"].indexOf(key)<0) return;
      var h=function(e){ if(e.target && /^cp_pet_(name|type)$/.test(e.target.id)) return; markDirty(key); scheduleSave(key, e.type==="change"?300:1000); };
      sec.addEventListener("input", h); sec.addEventListener("change", h);
    });
    wireEmail();
    var geo=document.getElementById("cp_geo"); if(geo) geo.onclick=useMyLocation;
    // pets
    var pa=document.getElementById("cp_pet_add");
    if(pa) pa.onclick=async function(){ var n=document.getElementById("cp_pet_name").value.trim(), t=document.getElementById("cp_pet_type").value;
      if(!n || !t){ alert("Add the pet's name and type."); return; } pa.disabled=true;
      var r=await api("add_pet",{ p_name:n, p_type:t }); if(r.error){ alert(r.error.message||r.error); pa.disabled=false; return; } load(); };
    // managed pages
    var pg=document.getElementById("cp_pg_add");
    if(pg) pg.onclick=async function(){
      var h=document.getElementById("cp_pg_handle").value.trim().replace(/^@/,"");
      if(!/^[A-Za-z0-9._-]{1,60}$/.test(h)){ alert("Enter the profile's username, e.g. @mumbaieats"); return; }
      pg.disabled=true;
      var r=await api("upsert_managed_profile",{ p_payload:{ handle:h, platform:document.getElementById("cp_pg_platform").value,
        followers:document.getElementById("cp_pg_followers").value, category:document.getElementById("cp_pg_cat").value.trim(), relation:document.getElementById("cp_pg_rel").value } });
      if(r.error){ alert(r.error.message||r.error); pg.disabled=false; return; } load(); };
    // skills / resources multi-selects
    document.querySelectorAll("[data-ms]").forEach(function(cb){ cb.onchange=async function(){
      var skill=cb.getAttribute("data-ms")==="ms_skill", v=cb.value; cb.parentNode.classList.toggle("on", cb.checked);
      var r = skill ? await api(cb.checked?"upsert_skill":"remove_skill", cb.checked?{p_payload:{skill_key:v,is_custom:SKILLS.indexOf(v)<0},p_correlation:"ui"}:{p_skill_key:v,p_correlation:"ui"})
                    : await api(cb.checked?"upsert_resource":"remove_resource", cb.checked?{p_payload:{resource_key:v,is_custom:RESOURCES.indexOf(v)<0},p_correlation:"ui"}:{p_resource_key:v,p_correlation:"ui"});
      if(r.error){ alert(r.error.message||r.error); cb.checked=!cb.checked; return; }
      var list = skill ? (DATA.skills=DATA.skills||[]) : (DATA.resources=DATA.resources||[]), k = skill?"skill_key":"resource_key";
      if(cb.checked) list.push((function(){ var o={}; o[k]=v; return o; })()); else { for(var i=list.length-1;i>=0;i--) if(list[i][k]===v) list.splice(i,1); }
      paintMsSummary(cb.getAttribute("data-ms")); setStatus("skills","saved"); refreshCompletion(); }; });
    document.querySelectorAll("[data-ms-add]").forEach(function(b){ b.onclick=async function(){
      var id=b.getAttribute("data-ms-add"), inp=document.querySelector('[data-ms-other="'+id+'"]'), v=(inp.value||"").trim(); if(!v) return;
      var r = id==="ms_skill" ? await api("upsert_skill",{p_payload:{skill_key:v,is_custom:true},p_correlation:"ui"}) : await api("upsert_resource",{p_payload:{resource_key:v,is_custom:true},p_correlation:"ui"});
      if(r.error){ alert(r.error.message||r.error); return; } load(); }; });
    document.querySelectorAll("[data-ms-other]").forEach(function(i){ i.onkeydown=function(e){ if(e.key==="Enter"){ e.preventDefault(); document.querySelector('[data-ms-add="'+i.getAttribute("data-ms-other")+'"]').click(); } }; });
    // addresses: save / new / edit / default / remove
    var as=document.getElementById("cp_addr_save");
    if(as) as.onclick=async function(){ setStatus("address","saving"); try{ await saveAddress(); setStatus("address","saved"); await load(); }catch(e){ setStatus("address","error", e.message||e); var gm=document.getElementById("cp_geo_msg"); if(gm) gm.textContent="⚠ "+(e.message||e); } };
    var an=document.getElementById("cp_addr_new");
    if(an) an.onclick=function(){ fillAddr({}); };
    function fillAddr(a){
      var set=function(id,v){ var e=document.getElementById(id); if(e) e.value = v==null?"":v; };
      set("cp_addr_id",a.address_id); set("cp_addr_label",a.label||"Home"); set("cp_l1",a.line1); set("cp_l2",a.line2); set("cp_landmark",a.landmark);
      set("cp_city",a.city); set("cp_state",a.state); set("cp_pin",a.postal_code); set("cp_country",a.country||"India");
      var dflt=document.getElementById("cp_addr_default"); if(dflt) dflt.checked = !!a.is_default || !(DATA.addresses||[]).length;
      var m=document.getElementById("cp_addr_mode"); if(m) m.textContent = a.address_id ? "Editing: "+(a.label||"address") : "Add a new address";
    }
    document.querySelectorAll("[data-editaddr]").forEach(function(b){ b.onclick=function(){ var a=(DATA.addresses||[]).find(function(x){return x.address_id===b.getAttribute("data-editaddr");}); if(a){ fillAddr(a); document.getElementById("cp_l1").focus(); } }; });
    document.querySelectorAll("[data-defaddr]").forEach(function(b){ b.onclick=async function(){ var a=(DATA.addresses||[]).find(function(x){return x.address_id===b.getAttribute("data-defaddr");}); if(!a) return;
      var r=await api("upsert_address",{p_payload:{address_id:a.address_id,is_default:true},p_correlation:"ui"}); if(r.error) alert(r.error.message||r.error); load(); }; });
    document.querySelectorAll("[data-deladdr]").forEach(function(b){ b.onclick=async function(){ if(!confirm("Remove this address?")) return;
      var r=await api("delete_address",{p_address_id:b.getAttribute("data-deladdr"),p_correlation:"ui"}); if(r.error) alert(r.error.message||r.error); load(); }; });
    // add/remove collections
    document.querySelectorAll("[data-add]").forEach(function(b){ b.onclick=function(){ addItem(b.getAttribute("data-add")); }; });
    hookDel();
    if(window.ciConnect) window.ciConnect.wire();
    var rc=document.getElementById("cpReconnect"); if(rc) rc.onclick=function(e){ e.preventDefault(); currentPage="mediakit"; renderShell(); };
    // visibility toggles
    var vr=document.getElementById("cp_vis_rate"); if(vr) vr.onchange=function(){ api("set_profile_visibility",{p_field_or_group:"rate_card",p_tier:"marketplace_summary",p_allowed:vr.checked,p_correlation:"ui"}); };
    var vb=document.getElementById("cp_vis_brands"); if(vb) vb.onchange=function(){ api("set_profile_visibility",{p_field_or_group:"brand_experience",p_tier:"marketplace_summary",p_allowed:vb.checked,p_correlation:"ui"}); };
  }
  function paintMsSummary(id){
    var box=document.querySelector("#"+id+" .cp-ms-val"); if(!box) return;
    var on=[].slice.call(document.querySelectorAll('[data-ms="'+id+'"]:checked')).map(function(c){ return c.value; });
    box.innerHTML = on.length ? on.map(function(x){ return '<span class="cp-tag">'+esc(x)+'</span>'; }).join("") : '<span class="muted">'+(id==="ms_skill"?"Select your skills":"Select your resources")+'</span>';
  }
  function hookDel(){
    var del=function(sel, fn, argName){ document.querySelectorAll("["+sel+"]").forEach(function(b){ b.onclick=async function(){ b.disabled=true;
      var a={}; a[argName]=b.getAttribute(sel); if(fn!=="delete_pet" && fn!=="delete_managed_profile") a.p_correlation="ui";
      var r=await api(fn,a); if(r && r.error){ alert(r.error.message||r.error); b.disabled=false; return; } load(); }; }); };
    del("data-delbrand","delete_brand_experience","p_experience_id");
    del("data-rejbrand","reject_brand_experience","p_experience_id");
    del("data-delitem","delete_rate_card_item","p_rate_card_item_id");
    del("data-deldream","delete_dream_brand","p_aspiration_id");
    del("data-delpet","delete_pet","p_pet_id");
    del("data-delpage","delete_managed_profile","p_managed_id");
  }
  async function addItem(kind){
    try{
      var r;
      if(kind==="brand"){ var n=document.getElementById("cp_brand_name").value.trim(); if(!n) return; r=await api("upsert_brand_experience",{p_payload:{submitted_brand_name:n,relationship_type:document.getElementById("cp_brand_rel").value},p_correlation:"ui"}); }
      else if(kind==="rate"){ var amt=document.getElementById("cp_rate_amt").value; if(amt===""||Number(amt)<0){ alert("Enter a valid amount (≥ 0)"); return; } r=await api("save_rate_card_item",{p_payload:{deliverable_type:document.getElementById("cp_rate_deliv").value,amount:Number(amt)},p_correlation:"ui"}); }
      else if(kind==="dream"){ var b=document.getElementById("cp_dream_name").value.trim(); if(!b) return; var rank=((DATA.dream_brands||[]).length)+1; r=await api("upsert_dream_brand",{p_payload:{submitted_brand_name:b,priority_rank:rank},p_correlation:"ui"}); }
      if(r && r.error) throw r.error;
      load();
    }catch(e){ alert("Couldn't add: "+(e.message||e)); }
  }
  function markDirty(key){ dirty[key]=true; window.__cpDirty=true; }
  function scheduleSave(key, ms){ clearTimeout(saveTimers[key]); setStatus(key,"saving"); topSave("saving"); saveTimers[key]=setTimeout(function(){ saveSection(key); }, ms||1000); }

  // warn before discarding unsaved edits
  window.addEventListener("beforeunload", function(e){ if(window.__cpDirty){ e.preventDefault(); e.returnValue=""; } });

  (function(){ if(document.getElementById("cpReqCss")) return; var st=document.createElement("style"); st.id="cpReqCss";
    st.textContent='.cp-req{border:1px solid rgba(108,92,231,.35);background:rgba(108,92,231,.06);border-radius:12px;padding:12px 14px;margin-bottom:14px}'
      +'.cp-req-h{display:flex;justify-content:space-between;gap:8px;margin-bottom:8px;flex-wrap:wrap}.cp-req-list{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}'
      +'.cp-req-it{font-size:12px;padding:4px 10px;border-radius:999px;border:1px solid rgba(0,0,0,.12);text-decoration:none;color:inherit}'
      +'.cp-ready{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;border-color:rgba(16,185,129,.4);background:rgba(16,185,129,.07)}'
      +'.cp-req-it.done{opacity:.55;text-decoration:line-through}.cp-flash{box-shadow:0 0 0 3px rgba(108,92,231,.45);transition:box-shadow .3s}';
    document.head.appendChild(st); })();
  window.ciProfile = { boot: boot, load: load, loadReq: loadReq };

  // self-boot once app + a signed-in creator are ready (kept fully passive otherwise)
  var tries=0, t=setInterval(function(){
    tries++;
    if(window.sb && window.Auth && Auth.profile){ clearInterval(t); if(Auth.profile.role==="creator") boot(); }
    else if(tries>40) clearInterval(t);
  }, 800);
})();
