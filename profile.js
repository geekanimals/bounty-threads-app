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
  async function boot(){
    try{
      if(!window.sb || !window.sb.schema) { enabled=false; }
      else { var r = await api("creator_profile_api_enabled"); enabled = !!(r && !r.error && r.data === true); }
    }catch(e){ enabled=false; }
    window.__ciProfileEnabled = enabled;
    if(enabled && typeof renderShell === "function") renderShell();
  }

  /* ---------- page skeleton ---------- */
  window.renderProfile = function(){
    if(!enabled){
      return '<div class="card"><h3>Creator Profile</h3><div class="muted">This feature isn\'t enabled for your account yet.</div></div>';
    }
    return ''
      + '<div id="cpRoot" class="cp">'
      + '  <div id="cpHead" class="card cp-head"><div class="muted">Loading your profile…</div></div>'
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
      var c = await api("get_profile_completion"); COMP = (c && !c.error) ? c.data : null;
      renderAll();
    }catch(e){
      var err = document.getElementById("cpErr");
      if(err){ err.style.display="block"; err.textContent = "Couldn't load your profile. "+(e.message||e); }
    }
  }

  function header(){
    var pct = COMP ? COMP.completion_pct : 0;
    var missing = (COMP && COMP.missing_core) ? COMP.missing_core : [];
    var groups = COMP ? COMP.groups : {};
    var chip = function(k,label){ var on = groups && groups[k]; return '<span class="cp-chip '+(on?"on":"")+'">'+(on?"✓":"○")+" "+esc(label)+'</span>'; };
    return ''
      + '<div class="card cp-head">'
      + '  <div class="cp-head-top"><h3>Your Creator Profile</h3><span id="cpSave" class="cp-savestate"></span></div>'
      + '  <div class="cp-progress"><div class="cp-bar"><span style="width:'+pct+'%"></span></div><b>'+pct+'% complete</b></div>'
      + '  <div class="cp-chips">'+chip("personal","Personal")+chip("contact","Contact")+chip("professional","Professional")
      +      chip("skills","Skills")+chip("barter","Barter")+chip("rate_card","Rate card")
      +      '<span class="cp-chip opt">'+(groups&&groups.brand_experience?"✓":"○")+' Brands (optional)</span>'
      +      '<span class="cp-chip opt">'+(groups&&groups.dream_brands?"✓":"○")+' Dream brands (optional)</span></div>'
      + (missing.length ? '<div class="muted cp-todo">Still to complete: '+missing.map(esc).join(", ")+'</div>' : '<div class="muted cp-todo">Core profile complete. Optional sections don\'t affect completion.</div>')
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
      + (opts.noSave?'':'<button class="btn sm" data-save="'+key+'">Save & Continue</button>')+'</div>'
      + '<div class="cp-sec-b">'+inner+'</div>'
      + '<div class="cp-sec-status" data-status="'+key+'"></div></div>';
  }

  function renderAll(){
    document.getElementById("cpHead").outerHTML = header();
    var d = DATA, personal = d.personal||{}, contact = d.contact||{}, pro = d.professional||{}, conn = d.connection;
    var body = "";

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

    // A Personal
    var mar = personal.marital_status || "";
    var age = deriveAge(personal.date_of_birth);
    body += section("personal","Personal details",
        '<div class="cp-grid">'
      + field("First name","cp_first",personal.first_name,{source:srcOf("professional.display_name")?null:null})
      + field("Last name","cp_last",personal.last_name)
      + field("Gender (optional)","cp_gender",personal.gender,{select:[["","Prefer not to say"],["female","Female"],["male","Male"],["non_binary","Non-binary"],["other","Other"]],privacy:"Private"})
      + field("Date of birth (optional)","cp_dob",personal.date_of_birth,{type:"date",privacy:"Private",hint: age!=null? "Age "+age+" (calculated, never stored)":"Age is calculated from DOB, never stored"})
      + field("Marital status (optional)","cp_marital",mar,{select:[["","Prefer not to say"],["single","Single"],["married","Married"],["divorced","Divorced"],["widowed","Widowed"]],privacy:"Private"})
      + '<div id="cp_anniv_wrap" style="'+(mar==="married"?"":"display:none")+'">'+field("Marriage anniversary","cp_anniv",personal.marriage_anniversary,{type:"date",privacy:"Private"})+'</div>'
      + '</div><div class="cp-note">Optional sensitive fields never affect your profile quality, authenticity or ranking.</div>');

    // B Contact
    body += section("contact","Contact",
        '<div class="cp-grid">'
      + field("WhatsApp number","cp_wa",contact.whatsapp_e164,{privacy:"Private",hint:"International format, e.g. +919812345678"+(contact.whatsapp_verified_at?" · Verified":" · Not verified")})
      + field("Email","cp_email",contact.email,{type:"email",source:srcOf("contact.email"),privacy:"Private",hint:(contact.email_verified_at?"Verified":"Not verified")})
      + field("Preferred contact","cp_pref",contact.preferred_contact_method,{select:[["","—"],["whatsapp","WhatsApp"],["email","Email"]]})
      + '</div><div class="cp-note">WhatsApp and email verification are independent and never shown to brands.</div>');

    // C Delivery address
    var addr = (d.addresses && d.addresses[0]) || {};
    body += section("address","Delivery address",
        '<div class="cp-grid">'
      + '<input type="hidden" id="cp_addr_id" value="'+esc(val(addr.address_id))+'">'
      + field("Address line 1","cp_l1",addr.line1,{privacy:"Campaign-only"})
      + field("Address line 2","cp_l2",addr.line2)
      + field("Locality / landmark","cp_landmark",addr.landmark)
      + field("City","cp_city",addr.city)
      + field("State","cp_state",addr.state)
      + field("PIN / postal code","cp_pin",addr.postal_code)
      + field("Country","cp_country",addr.country||"India")
      + '</div><div class="cp-note">Your full address is private, used only for campaign logistics you approve — never shown in search or to brands.</div>');

    // D Professional
    body += section("professional","Professional",
        '<div class="cp-grid">'
      + field("Creator / display name","cp_dname",pro.display_name,{source:srcOf("professional.display_name")})
      + field("Instagram username","cp_iguser",conn?("@"+(conn.username||"")):(pro.instagram_username||""),{readonly:!!conn,source:conn?"from_instagram":null,hint:conn?"Read-only (verified connection)":""})
      + field("Primary city","cp_city2",pro.city_coarse)
      + field("State / market","cp_state2",pro.state_coarse)
      + field("Categories / niches (comma separated)","cp_cats",(pro.categories||[]).join(", "))
      + field("Content languages (comma separated)","cp_langs",(pro.languages||[]).join(", "))
      + field("Content formats (comma separated)","cp_formats",(pro.content_formats||[]).join(", "),{hint:"e.g. Reel, Story, Carousel, Live"})
      + field("Travel willingness","cp_travel",pro.travel_willingness,{select:[["","—"],["city_only","City only"],["domestic","Domestic"],["international","International"],["not_available","Not available"]]})
      + field("Availability","cp_avail",pro.availability_status,{select:[["","—"],["available","Available"],["limited","Limited"],["unavailable","Unavailable"]]})
      + field("Management","cp_mgmt",pro.management_status,{select:[["","—"],["self_managed","Self-managed"],["agency_managed","Agency-managed"],["celebrity_agent_managed","Celebrity / agent-managed"]]})
      + field("Bio","cp_bio",pro.bio,{textarea:true,source:srcOf("professional.bio")})
      + '</div>');

    // E Skills & Resources
    body += section("skills","Skills & resources",
        '<div class="cp-hint">Skills</div><div id="cp_skills" class="cp-tags">'+renderTags((d.skills||[]).map(function(s){return s.skill_key;}),"skill")+'</div>'
      + '<div class="cp-addrow"><input id="cp_skill_new" placeholder="Add a skill (e.g. Makeup)"><button class="btn sm ghost" data-add="skill">Add</button></div>'
      + '<div class="cp-hint" style="margin-top:12px">Resources / equipment</div><div id="cp_res" class="cp-tags">'+renderTags((d.resources||[]).map(function(r){return r.resource_key;}),"resource")+'</div>'
      + '<div class="cp-addrow"><input id="cp_res_new" placeholder="Add a resource (e.g. Professional camera)"><button class="btn sm ghost" data-add="resource">Add</button></div>',
      {noSave:true});

    // F Brands worked with
    var brands = (d.brand_experience||[]).filter(function(b){return !b.creator_rejected_at;});
    body += section("brands","Brands worked with",
        (brands.length ? '<div class="cp-list">'+brands.map(function(b){
            return '<div class="cp-item"><div><b>'+esc(b.submitted_brand_name||"(brand)")+'</b> <span class="cp-badge cp-self">Self-reported</span>'
              + '<div class="muted">'+esc(b.relationship_type||"")+(b.deliverables?" · "+esc(b.deliverables):"")+'</div></div>'
              + '<button class="btn sm ghost" data-delbrand="'+esc(b.experience_id)+'">Remove</button></div>';
          }).join("")+'</div>'
         : '<div class="muted">No detected brand collaborations yet. Add brands you\'ve worked with below.</div>')
      + '<div class="cp-addrow"><input id="cp_brand_name" placeholder="Brand name"><select id="cp_brand_rel"><option value="paid">Paid</option><option value="barter">Barter</option><option value="hybrid">Hybrid</option><option value="gifting">Gifting</option><option value="organic">Organic mention</option></select><button class="btn sm ghost" data-add="brand">Add</button></div>'
      + '<div class="cp-note">Manually added brands stay labelled “Self-reported” until independently verified.</div>',
      {noSave:true});

    // G Barter preferences
    var cp = d.commercial_preference||{};
    body += section("barter","Barter preferences",
        '<label class="cp-switch"><input type="checkbox" id="cp_barter_on"'+(cp.accepts_barter?" checked":"")+'> <span>Open to barter collaborations</span></label>'
      + '<div id="cp_barter_more" style="'+(cp.accepts_barter?"":"display:none")+'">'
      + '<div class="cp-grid">'
      + field("Scope","cp_barter_pref",cp.barter_preference,{select:[["","Any relevant brand"],["top_established_only","Top / established brands only"],["selected_brands_only","Selected brands only"]]})
      + field("Preferred categories (comma separated)","cp_barter_cats",(cp.preferred_categories||[]).join(", "))
      + field("Categories not accepted (comma separated)","cp_barter_excl",(cp.excluded_categories||[]).join(", "))
      + field("Minimum product value (₹)","cp_barter_min",cp.min_product_value,{type:"number"})
      + '</div><label class="cp-check"><input type="checkbox" id="cp_barter_travel"'+(cp.travel_ready?" checked":"")+'> Accept travel / visit barters</label>'
      + field("Notes / conditions","cp_barter_notes",cp.notes,{textarea:true})
      + '</div>');

    // H Paid rate card
    var items = ((d.rate_cards&&d.rate_cards[0]&&d.rate_cards[0].items)||[]);
    var DELIV = ["IG Reel","IG Story","IG Static Post","IG Carousel","IG Collab Reel","IG Live","Store/Restaurant Visit","UGC Video (no posting)","Usage Rights","Paid Amplification/Whitelisting","Exclusivity Add-on"];
    body += section("rate","Paid rate card",
        '<div class="cp-list" id="cp_rate_list">'+(items.length?items.map(function(it){
            return '<div class="cp-item"><div><b>'+esc(it.deliverable_type)+'</b> — ₹'+esc(it.amount)+' <span class="muted">× '+esc(it.unit_quantity||1)+'</span></div>'
              +'<button class="btn sm ghost" data-delitem="'+esc(it.rate_card_item_id)+'">Remove</button></div>';
          }).join(""):'<div class="muted">No rates added yet.</div>')+'</div>'
      + '<div class="cp-addrow"><select id="cp_rate_deliv">'+DELIV.map(function(x){return '<option>'+esc(x)+'</option>';}).join("")+'</select>'
      + '<input id="cp_rate_amt" type="number" min="0" placeholder="Amount ₹"><button class="btn sm ghost" data-add="rate">Add</button></div>'
      + '<div class="cp-note">Rates are your declared expectations (INR). Negotiated campaign commercials are stored separately and never shown here.</div>',
      {noSave:true});

    // I Dream brands
    var dreams = (d.dream_brands||[]);
    body += section("dreams","Top brands I want to work with",
        '<div class="cp-list" id="cp_dream_list">'+(dreams.length?dreams.map(function(x,i){
            return '<div class="cp-item"><div><b>#'+(x.priority_rank||i+1)+'</b> '+esc(x.submitted_brand_name||"(brand)")+'</div>'
              +'<button class="btn sm ghost" data-deldream="'+esc(x.aspiration_id)+'">Remove</button></div>';
          }).join(""):'<div class="muted">No dream brands yet (add up to 10).</div>')+'</div>'
      + (dreams.length<10 ? '<div class="cp-addrow"><input id="cp_dream_name" placeholder="Brand name"><button class="btn sm ghost" data-add="dream">Add</button></div>' : '<div class="muted">Maximum 10 reached.</div>')
      + '<div class="cp-note">Dream brands are preferences — not campaign history or brand affinity.</div>',
      {noSave:true});

    // J Visibility
    body += section("visibility","Visibility & privacy",
        '<div class="cp-note">Private always: WhatsApp, email, full DOB, marital status, anniversary, full address.</div>'
      + '<label class="cp-check"><input type="checkbox" id="cp_vis_rate" '+(visOn("rate_card")?"checked":"")+'> Show my rate range in the marketplace summary</label>'
      + '<label class="cp-check"><input type="checkbox" id="cp_vis_brands" '+(visOn("brand_experience")?"checked":"")+'> Show my verified brand experience to brands</label>'
      + '<div class="cp-note">Disabling data sharing may reduce Verified Data Coverage — it never lowers Performance, raises Fraud risk, or labels you unreliable.</div>',
      {noSave:true});

    document.getElementById("cpBody").innerHTML = body;
    wire();
  }

  function visOn(){ return false; } // default off; server is source of truth (no fabricated state)
  function renderTags(arr, kind){
    if(!arr || !arr.length) return '<span class="muted">None yet</span>';
    return arr.map(function(x){ return '<span class="cp-tag">'+esc(x)+'<button data-del'+kind+'="'+esc(x)+'">×</button></span>'; }).join("");
  }

  /* ---------- wiring ---------- */
  function setStatus(key, state, msg){
    var el = document.querySelector('[data-status="'+key+'"]'); if(!el) return;
    el.className = "cp-sec-status "+state; el.textContent = msg || (state==="saving"?"Saving…":state==="saved"?"Saved ✓":state==="error"?("Error: "+(msg||"")): "");
  }
  function topSave(state){ var s=document.getElementById("cpSave"); if(s){ s.className="cp-savestate "+state; s.textContent = state==="saving"?"Saving…":state==="saved"?"All changes saved":state==="error"?"Save failed":""; } }

  async function saveSection(key){
    var patch = collect(key); if(patch===null) return;
    setStatus(key,"saving"); topSave("saving");
    try{
      if(key==="address"){ await saveAddress(); }
      else { var r = await api("save_profile_section", { p_section: sectionApi(key), p_patch: patch, p_correlation:"ui" }); if(r.error) throw r.error; }
      setStatus(key,"saved"); topSave("saved"); dirty[key]=false;
      await refreshCompletion();
    }catch(e){ setStatus(key,"error", e.message||e); topSave("error"); }
  }
  function sectionApi(key){ return key==="barter"?"commercial_preference":key; }

  function collect(key){
    function v(id){ var e=document.getElementById(id); return e?e.value:undefined; }
    function num(id){ var x=v(id); return x===""||x==null?null:Number(x); }
    function arr(id){ var x=v(id); return x==null?undefined:x.split(",").map(function(s){return s.trim();}).filter(Boolean); }
    if(key==="personal"){
      var dob=v("cp_dob"); if(dob){ var d=new Date(dob); if(d>new Date()){ setStatus(key,"error","Date of birth can't be in the future"); return null; } }
      var mar=v("cp_marital");
      var p={ first_name:v("cp_first")||null, last_name:v("cp_last")||null, gender:v("cp_gender")||null,
              date_of_birth:v("cp_dob")||null, marital_status:mar||null,
              marriage_anniversary:(mar==="married"?(v("cp_anniv")||null):null) };
      return p;
    }
    if(key==="contact"){
      var wa=v("cp_wa"), em=v("cp_email");
      if(wa && !/^\+[1-9]\d{6,14}$/.test(wa)){ setStatus(key,"error","WhatsApp must be E.164, e.g. +919812345678"); return null; }
      if(em && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)){ setStatus(key,"error","Enter a valid email"); return null; }
      return { whatsapp_e164:wa||null, email:em||null, preferred_contact_method:v("cp_pref")||null };
    }
    if(key==="professional"){
      return { display_name:v("cp_dname")||null, city_coarse:v("cp_city2")||null, state_coarse:v("cp_state2")||null,
               categories:arr("cp_cats"), languages:arr("cp_langs"), content_formats:arr("cp_formats"),
               travel_willingness:v("cp_travel")||null, availability_status:v("cp_avail")||null,
               management_status:v("cp_mgmt")||null, bio:v("cp_bio")||null };
    }
    if(key==="barter"){
      var on=document.getElementById("cp_barter_on").checked;
      return { accepts_barter:on, barter_preference:v("cp_barter_pref")||null,
               preferred_categories:arr("cp_barter_cats"), excluded_categories:arr("cp_barter_excl"),
               min_product_value:num("cp_barter_min"), travel_ready:document.getElementById("cp_barter_travel").checked,
               notes:v("cp_barter_notes")||null };
    }
    return {};
  }

  async function saveAddress(){
    function v(id){ var e=document.getElementById(id); return e?e.value:null; }
    var pin=v("cp_pin");
    if(pin && !/^[A-Za-z0-9 \-]{3,12}$/.test(pin)) throw new Error("Enter a valid postal/PIN code");
    var payload={ line1:v("cp_l1")||null, line2:v("cp_l2")||null, landmark:v("cp_landmark")||null,
      city:v("cp_city")||null, state:v("cp_state")||null, postal_code:pin||null, country:v("cp_country")||"India", is_default:true };
    var id=v("cp_addr_id"); if(id) payload.address_id=id;
    var r=await api("upsert_address",{ p_payload:payload, p_correlation:"ui" }); if(r.error) throw r.error;
    if(r.data && !id){ document.getElementById("cp_addr_id").value=r.data; }
  }

  async function refreshCompletion(){ try{ var c=await api("get_profile_completion"); if(c&&!c.error){ COMP=c.data; document.querySelector(".cp-head").outerHTML=header(); } }catch(e){} }

  function wire(){
    // conditional anniversary + barter reveal
    var mar=document.getElementById("cp_marital");
    if(mar) mar.onchange=function(){ document.getElementById("cp_anniv_wrap").style.display = (mar.value==="married")?"":"none"; markDirty("personal"); };
    var bon=document.getElementById("cp_barter_on");
    if(bon) bon.onchange=function(){ document.getElementById("cp_barter_more").style.display = bon.checked?"":"none"; markDirty("barter"); };
    var dob=document.getElementById("cp_dob");
    if(dob) dob.onchange=function(){ var a=deriveAge(dob.value); var h=dob.parentNode.querySelector(".cp-hint"); if(h) h.textContent = a!=null?("Age "+a+" (calculated, never stored)"):"Age is calculated from DOB, never stored"; markDirty("personal"); };
    // Save & Continue buttons
    document.querySelectorAll("[data-save]").forEach(function(b){ b.onclick=function(){ saveSection(b.getAttribute("data-save")); }; });
    // auto-save (debounced) on input within a savable section
    document.querySelectorAll('.cp-sec[data-sec]').forEach(function(sec){
      var key=sec.getAttribute("data-sec");
      if(["personal","contact","professional","address","barter"].indexOf(key)<0) return;
      sec.addEventListener("input", function(){ markDirty(key); scheduleSave(key); });
    });
    // add/remove collections
    document.querySelectorAll("[data-add]").forEach(function(b){ b.onclick=function(){ addItem(b.getAttribute("data-add")); }; });
    hookDel();
    var rc=document.getElementById("cpReconnect"); if(rc) rc.onclick=function(e){ e.preventDefault(); currentPage="mediakit"; renderShell(); };
    // visibility toggles
    var vr=document.getElementById("cp_vis_rate"); if(vr) vr.onchange=function(){ api("set_profile_visibility",{p_field_or_group:"rate_card",p_tier:"marketplace_summary",p_allowed:vr.checked,p_correlation:"ui"}); };
    var vb=document.getElementById("cp_vis_brands"); if(vb) vb.onchange=function(){ api("set_profile_visibility",{p_field_or_group:"brand_experience",p_tier:"marketplace_summary",p_allowed:vb.checked,p_correlation:"ui"}); };
  }
  function hookDel(){
    document.querySelectorAll("[data-delskill]").forEach(function(b){ b.onclick=async function(){ await api("remove_skill",{p_skill_key:b.getAttribute("data-delskill"),p_correlation:"ui"}); load(); }; });
    document.querySelectorAll("[data-delresource]").forEach(function(b){ b.onclick=async function(){ await api("remove_resource",{p_resource_key:b.getAttribute("data-delresource"),p_correlation:"ui"}); load(); }; });
    document.querySelectorAll("[data-delbrand]").forEach(function(b){ b.onclick=async function(){ await api("delete_brand_experience",{p_experience_id:b.getAttribute("data-delbrand"),p_correlation:"ui"}); load(); }; });
    document.querySelectorAll("[data-delitem]").forEach(function(b){ b.onclick=async function(){ await api("delete_rate_card_item",{p_rate_card_item_id:b.getAttribute("data-delitem"),p_correlation:"ui"}); load(); }; });
    document.querySelectorAll("[data-deldream]").forEach(function(b){ b.onclick=async function(){ await api("delete_dream_brand",{p_aspiration_id:b.getAttribute("data-deldream"),p_correlation:"ui"}); load(); }; });
  }
  async function addItem(kind){
    try{
      if(kind==="skill"){ var s=document.getElementById("cp_skill_new").value.trim(); if(!s) return; await api("upsert_skill",{p_payload:{skill_key:s},p_correlation:"ui"}); }
      else if(kind==="resource"){ var r=document.getElementById("cp_res_new").value.trim(); if(!r) return; await api("upsert_resource",{p_payload:{resource_key:r},p_correlation:"ui"}); }
      else if(kind==="brand"){ var n=document.getElementById("cp_brand_name").value.trim(); if(!n) return; await api("upsert_brand_experience",{p_payload:{submitted_brand_name:n,relationship_type:document.getElementById("cp_brand_rel").value},p_correlation:"ui"}); }
      else if(kind==="rate"){ var amt=document.getElementById("cp_rate_amt").value; if(amt===""||Number(amt)<0){ alert("Enter a valid amount (≥ 0)"); return; } await api("save_rate_card_item",{p_payload:{deliverable_type:document.getElementById("cp_rate_deliv").value,amount:Number(amt)},p_correlation:"ui"}); }
      else if(kind==="dream"){ var b=document.getElementById("cp_dream_name").value.trim(); if(!b) return; var rank=((DATA.dream_brands||[]).length)+1; await api("upsert_dream_brand",{p_payload:{submitted_brand_name:b,priority_rank:rank},p_correlation:"ui"}); }
      load();
    }catch(e){ alert("Couldn't add: "+(e.message||e)); }
  }
  function markDirty(key){ dirty[key]=true; window.__cpDirty=true; }
  function scheduleSave(key){ clearTimeout(saveTimers[key]); topSave("saving"); saveTimers[key]=setTimeout(function(){ saveSection(key); }, 1200); }

  // warn before discarding unsaved edits
  window.addEventListener("beforeunload", function(e){ if(window.__cpDirty){ e.preventDefault(); e.returnValue=""; } });

  window.ciProfile = { boot: boot, load: load };

  // self-boot once app + a signed-in creator are ready (kept fully passive otherwise)
  var tries=0, t=setInterval(function(){
    tries++;
    if(window.sb && window.Auth && Auth.profile){ clearInterval(t); if(Auth.profile.role==="creator") boot(); }
    else if(tries>40) clearInterval(t);
  }, 800);
})();
