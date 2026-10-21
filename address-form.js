/* Geek OS — delivery address form (one component, used everywhere a creator adds or edits an address)
 * Works like Amazon's: Full name · Mobile · PIN code → City + State fill in on their own · Flat / house no. · Area / street
 * (suggestions from the PIN's localities) · Landmark (live suggestions near that PIN) · Town / City · State ·
 * default · delivery instructions. Every field is required except the instructions. Before saving, the address is found
 * on the map and the creator confirms the pin is in their area ("tab hi save").
 * Lookups go through the geo-lookup Edge Function (India Post + OpenStreetMap). If those services are down the creator can
 * still save after ticking "I've checked, this address is correct" — the address is then saved as not map-verified.
 *
 *   var ctl = GeekAddress.mount(el, address, { name, phone });
 *   var payload = await ctl.collect();   // throws Error("…") with what's missing; payload goes to api.upsert_address
 */
(function(){
  var STATES = ["Andaman and Nicobar Islands","Andhra Pradesh","Arunachal Pradesh","Assam","Bihar","Chandigarh","Chhattisgarh",
    "Dadra and Nagar Haveli and Daman and Diu","Delhi","Goa","Gujarat","Haryana","Himachal Pradesh","Jammu and Kashmir","Jharkhand",
    "Karnataka","Kerala","Ladakh","Lakshadweep","Madhya Pradesh","Maharashtra","Manipur","Meghalaya","Mizoram","Nagaland","Odisha",
    "Puducherry","Punjab","Rajasthan","Sikkim","Tamil Nadu","Telangana","Tripura","Uttar Pradesh","Uttarakhand","West Bengal"];
  var ALIAS = { "orissa":"Odisha","pondicherry":"Puducherry","uttaranchal":"Uttarakhand","nct of delhi":"Delhi","new delhi":"Delhi",
    "national capital territory of delhi":"Delhi","jammu & kashmir":"Jammu and Kashmir","daman and diu":"Dadra and Nagar Haveli and Daman and Diu",
    "dadra and nagar haveli":"Dadra and Nagar Haveli and Daman and Diu","andaman & nicobar islands":"Andaman and Nicobar Islands" };
  function canonState(s){ s=String(s||"").trim(); if(!s) return ""; var k=s.toLowerCase().replace(/\s+/g," ");
    if(ALIAS[k]) return ALIAS[k]; for(var i=0;i<STATES.length;i++){ if(STATES[i].toLowerCase()===k.replace(/&/g,"and")) return STATES[i]; } return ""; }
  function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g,function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
  function digits(s){ return String(s||"").replace(/\D/g,""); }
  function phone10(s){ var d=digits(s); if(d.length===12 && d.slice(0,2)==="91") d=d.slice(2); if(d.length===11 && d[0]==="0") d=d.slice(1); return d; }
  async function geo(body){
    try{ var r=await window.sb.functions.invoke("geo-lookup",{ body: body }); if(r.error) return { ok:false, down:true }; return r.data||{ ok:false, down:true }; }
    catch(e){ return { ok:false, down:true }; }
  }
  var uid=0;

  function mount(root, a, opts){
    a=a||{}; opts=opts||{}; var id="ga"+(++uid);
    var f=function(k){ return id+"_"+k; };
    var name=a.recipient_name||opts.name||"", ph=phone10(a.recipient_phone||opts.phone||"");
    var st=canonState(a.state);
    root.innerHTML=''
      + '<div class="ga" id="'+id+'">'
      + '<div class="ga-loc"><button type="button" class="btn sm ghost" id="'+f("loc")+'">📍 Use my current location</button><span class="ga-hint" id="'+f("locmsg")+'"></span></div>'
      + '<label class="ga-f"><span>Country/Region</span><select disabled><option>India</option></select></label>'
      + '<label class="ga-f"><span>Full name (First and Last name) <i>*</i></span><input id="'+f("name")+'" autocomplete="name" maxlength="80" value="'+esc(name)+'"></label>'
      + '<label class="ga-f"><span>Mobile number <i>*</i></span><div class="ga-ph"><b>+91</b><input id="'+f("phone")+'" inputmode="numeric" autocomplete="tel-national" maxlength="10" value="'+esc(ph)+'" placeholder="10-digit mobile number"></div><small>May be used to assist delivery</small></label>'
      + '<label class="ga-f"><span>Pincode <i>*</i></span><input id="'+f("pin")+'" inputmode="numeric" autocomplete="postal-code" maxlength="6" value="'+esc(a.postal_code||"")+'" placeholder="6 digits [0-9] PIN code"><small id="'+f("pinmsg")+'"></small></label>'
      + '<label class="ga-f"><span>Flat, House no., Building, Company, Apartment <i>*</i></span><input id="'+f("l1")+'" autocomplete="address-line1" maxlength="120" value="'+esc(a.line1||"")+'"></label>'
      + '<label class="ga-f ga-ac"><span>Area, Street, Sector, Village <i>*</i></span><input id="'+f("l2")+'" autocomplete="off" maxlength="160" value="'+esc(a.line2||"")+'"><div class="ga-menu" id="'+f("l2m")+'" hidden></div></label>'
      + '<label class="ga-f ga-ac"><span>Landmark <i>*</i></span><input id="'+f("lm")+'" autocomplete="off" maxlength="120" value="'+esc(a.landmark||"")+'" placeholder="E.g. near Apollo Hospital"><div class="ga-menu" id="'+f("lmm")+'" hidden></div></label>'
      + '<div class="ga-row">'
      +   '<label class="ga-f ga-ac"><span>Town/City <i>*</i></span><input id="'+f("city")+'" autocomplete="address-level2" maxlength="80" value="'+esc(a.city||"")+'"><div class="ga-menu" id="'+f("citym")+'" hidden></div></label>'
      +   '<label class="ga-f"><span>State <i>*</i></span><select id="'+f("state")+'"><option value="">Choose a state</option>'+STATES.map(function(s){ return '<option'+(s===st?' selected':'')+'>'+esc(s)+'</option>'; }).join("")+'</select></label>'
      + '</div>'
      + '<div class="ga-map" id="'+f("map")+'" hidden></div>'
      + '<details class="ga-di"'+(a.delivery_instructions?' open':'')+'><summary>Delivery instructions (optional)</summary><textarea id="'+f("di")+'" rows="2" maxlength="300" placeholder="E.g. call before delivery, gate code, best time">'+esc(a.delivery_instructions||"")+'</textarea></details>'
      + '</div>';
    var $=function(k){ return document.getElementById(f(k)); };
    var state={ pinInfo:null, check:null, checking:null, pinned:false, coords: (a.lat!=null && a.lng!=null) ? { lat:+a.lat, lon:+a.lng } : null,
                verified: !!a.geo_verified_at, sig: null };
    var sigNow=function(){ return [$("pin").value,$("l1").value,$("l2").value,$("lm").value,$("city").value,$("state").value].map(function(x){ return String(x||"").trim().toLowerCase(); }).join("|"); };
    if(state.verified) state.sig=sigNow();

    // ---- dropdown helper (suggestions under an input) ----
    function menu(input, box, fetcher, onPick){
      var t=null, items=[], act=-1, seq=0;
      var close=function(){ box.hidden=true; act=-1; };
      var paint=function(){ if(!items.length){ close(); return; }
        box.innerHTML=items.map(function(it,i){ return '<button type="button" class="ga-opt'+(i===act?' act':'')+'" data-i="'+i+'"><b>'+esc(it.title)+'</b>'+(it.sub?'<span>'+esc(it.sub)+'</span>':'')+'</button>'; }).join("");
        box.hidden=false; };
      input.addEventListener("input", function(){ clearTimeout(t); var q=input.value.trim(); var my=++seq;
        t=setTimeout(async function(){ var r=await fetcher(q); if(my!==seq) return; items=r||[]; act=-1; if(document.activeElement===input) paint(); }, 260); });
      input.addEventListener("focus", async function(){ var r=await fetcher(input.value.trim(), true); items=r||[]; if(document.activeElement===input) paint(); });
      input.addEventListener("keydown", function(e){ if(box.hidden) return;
        if(e.key==="ArrowDown"){ e.preventDefault(); act=Math.min(items.length-1,act+1); paint(); }
        else if(e.key==="ArrowUp"){ e.preventDefault(); act=Math.max(0,act-1); paint(); }
        else if(e.key==="Enter" && act>=0){ e.preventDefault(); onPick(items[act]); close(); }
        else if(e.key==="Escape"){ close(); } });
      box.addEventListener("mousedown", function(e){ var b=e.target.closest(".ga-opt"); if(!b) return; e.preventDefault(); onPick(items[+b.dataset.i]); close(); });
      input.addEventListener("blur", function(){ setTimeout(close, 150); });
    }

    // ---- PIN code → city + state ----
    var pinMsg=function(t, cls){ var m=$("pinmsg"); m.className=cls||""; m.innerHTML=t||""; };
    async function lookupPin(){
      var pin=digits($("pin").value).slice(0,6); $("pin").value=pin;
      state.pinInfo=null;
      if(pin.length<6){ pinMsg(pin.length?"Enter all 6 digits":""); return; }
      if(!/^[1-9]/.test(pin)){ pinMsg("⚠ A PIN code can't start with 0","bad"); return; }
      pinMsg("Checking PIN code…");
      var r=await geo({ action:"pincode", pin:pin });
      if(digits($("pin").value)!==pin) return;
      if(r && r.ok){
        state.pinInfo=r;
        var s=canonState(r.state); if(s) $("state").value=s;
        if(!$("city").value.trim() || state.autoCity){ $("city").value=r.city||r.district||""; state.autoCity=true; }
        pinMsg("✓ "+esc([r.city||r.district, r.state].filter(Boolean).join(", ")),"ok");
        if(r.at && !state.coords) state.coords={ lat:r.at.lat, lon:r.at.lon };
      } else if(r && r.down){ pinMsg("Couldn't check the PIN right now — please fill the city and state yourself.","warn"); }
      else pinMsg("⚠ "+esc((r&&r.error)||"We couldn't find this PIN code — please check it"),"bad");
      invalidate();
    }
    $("pin").addEventListener("input", function(){ var d=digits($("pin").value); if($("pin").value!==d) $("pin").value=d.slice(0,6); if(d.length===6) lookupPin(); else { state.pinInfo=null; pinMsg(d.length?"Enter all 6 digits":""); } });
    $("city").addEventListener("input", function(){ state.autoCity=false; });
    $("phone").addEventListener("input", function(){ var d=phone10($("phone").value); if($("phone").value!==d) $("phone").value=d.slice(0,10); });

    // ---- suggestions: area (PIN's localities + map), landmark (map, near the PIN), city ----
    var near=async function(q){ if(q.length<2) return [];
      var r=await geo({ action:"suggest", q:q, pin:digits($("pin").value), city:$("city").value.trim(), state:$("state").value });
      return (r && r.items || []).map(function(x){ return { title:x.name, sub:[x.street, x.locality, x.city, x.postcode].filter(Boolean).join(", "), raw:x }; }); };
    menu($("l2"), $("l2m"), async function(q, focus){
      var loc=((state.pinInfo&&state.pinInfo.localities)||[]).filter(function(n){ return !q || n.toLowerCase().indexOf(q.toLowerCase())>=0; }).slice(0,6)
        .map(function(n){ return { title:n, sub:"Area of PIN "+digits($("pin").value) }; });
      if(focus || q.length<3) return loc;
      var m=await near(q); return loc.concat(m.filter(function(x){ return x.raw.street || x.raw.locality; }).slice(0,5));
    }, function(it){ $("l2").value = it.raw && it.raw.street ? [it.raw.street, it.raw.locality].filter(Boolean).join(", ") : it.title; invalidate(); });
    menu($("lm"), $("lmm"), async function(q){ if(q.length<2) return [];
      var m=await near(q.replace(/^(near|opp\.?|opposite|behind|beside)\s+/i,""));
      return m.slice(0,7); },
      function(it){ $("lm").value = /^(near|opp|opposite|behind|beside)\b/i.test($("lm").value) ? $("lm").value.replace(/^(\S+)\s.*$/,"$1 ")+it.title : "Near "+it.title;
        if(it.raw && it.raw.lat){ state.coords={ lat:it.raw.lat, lon:it.raw.lon }; } invalidate(); });
    menu($("city"), $("citym"), async function(q){
      var P=state.pinInfo, L=P ? [P.city, P.district].filter(Boolean) : [];
      return L.filter(function(x,i){ return L.indexOf(x)===i && (!q || x.toLowerCase().indexOf(q.toLowerCase())>=0); }).map(function(x){ return { title:x, sub:P.state }; });
    }, function(it){ $("city").value=it.title; invalidate(); });

    // ---- the map check ----
    function invalidate(){ if(state.sig && state.sig!==sigNow()){ state.verified=false; state.pinned=false; state.check=null; } paintMap(); }
    ["l1","l2","lm","city","state"].forEach(function(k){ $(k).addEventListener("change", invalidate); });
    function paintMap(){
      var box=$("map"), c=state.check;
      if(!c){ box.hidden=true; box.innerHTML=""; return; }
      box.hidden=false;
      if(c.down){ box.innerHTML='<div class="ga-mapmsg warn">The map check isn\'t available right now.</div>'
          + '<label class="ga-ck"><input type="checkbox" id="'+f("sure")+'"'+(state.pinned?' checked':'')+'> I\'ve checked — this address is correct</label>';
      } else {
        var bad = !c.pin_ok ? "This PIN code doesn't exist — please check it."
                : c.state_ok===false ? "The state doesn't match this PIN code ("+esc(c.state)+")."
                : c.near_pin===false ? "The area / landmark looks far ("+c.km+" km) from this PIN code — please check them." : "";
        var lat=c.lat, lon=c.lon, d=c.level==="street"?0.004:c.level==="area"?0.01:0.03;
        var frame = c.found ? '<iframe title="Map" loading="lazy" src="https://www.openstreetmap.org/export/embed.html?bbox='+(lon-d)+'%2C'+(lat-d)+'%2C'+(lon+d)+'%2C'+(lat+d)+'&layer=mapnik&marker='+lat+'%2C'+lon+'"></iframe>' : "";
        box.innerHTML = (bad ? '<div class="ga-mapmsg bad">⚠ '+bad+'</div>' : '')
          + frame
          + (c.found ? '<div class="ga-mapmsg'+(bad?"":" ok")+'">📍 '+(c.level==="pin"?"Your PIN code area: ":c.level==="area"?"Near: ":"Found: ")+esc(c.display||"")
              + ' <a href="https://www.google.com/maps/search/?api=1&query='+lat+','+lon+'" target="_blank" rel="noopener">Open in Google Maps ↗</a></div>' : '<div class="ga-mapmsg warn">We couldn\'t place this address on the map.</div>')
          + (bad && !c.pin_ok ? '' : '<label class="ga-ck"><input type="checkbox" id="'+f("sure")+'"'+(state.pinned?' checked':'')+'> '+(c.found && !bad ? 'Yes — the pin is in my area, ship here' : 'I\'ve checked — this address is correct')+'</label>');
      }
      var s=$("sure"); if(s) s.onchange=function(){ state.pinned=s.checked; };
    }
    async function check(){
      var body={ action:"verify", pin:digits($("pin").value), line1:$("l1").value.trim(), line2:$("l2").value.trim(), landmark:$("lm").value.trim(),
                 city:$("city").value.trim(), state:$("state").value };
      var r=await geo(body);
      state.check = r && r.ok ? r : { down:true };
      state.sig=sigNow(); state.pinned=false;
      if(state.check.found){ state.coords={ lat:state.check.lat, lon:state.check.lon }; }
      paintMap();
      return state.check;
    }

    // ---- current location ----
    $("loc").onclick=function(){
      var msg=$("locmsg"), btn=$("loc");
      if(!navigator.geolocation){ msg.textContent="Location isn't available in this browser — type the address."; return; }
      btn.disabled=true; btn.textContent="📍 Locating…"; msg.textContent="";
      navigator.geolocation.getCurrentPosition(async function(pos){
        var r=await geo({ action:"reverse", lat:pos.coords.latitude, lon:pos.coords.longitude });
        btn.disabled=false; btn.textContent="📍 Use my current location";
        if(!r || !r.ok){ msg.textContent="Couldn't look up your address — please type it."; return; }
        var set=function(k,v){ if(v) $(k).value=v; };
        set("l1",r.house); set("l2",r.street); set("lm",r.landmark?("Near "+r.landmark):""); set("city",r.city);
        var s=canonState(r.state); if(s) $("state").value=s;
        if(r.pin){ $("pin").value=digits(r.pin).slice(0,6); lookupPin(); }
        state.coords={ lat:r.lat, lon:r.lon };
        msg.innerHTML="✓ Filled from your location — check the flat / house number.";
        if(!$("l1").value) $("l1").focus();
      }, function(){ btn.disabled=false; btn.textContent="📍 Use my current location"; msg.textContent="Location permission was denied — type the address."; }, { enableHighAccuracy:true, timeout:12000 });
    };

    if(a.postal_code && /^\d{6}$/.test(a.postal_code)) setTimeout(function(){ geo({ action:"pincode", pin:a.postal_code }).then(function(r){ if(r&&r.ok){ state.pinInfo=r; if(!state.verified) pinMsg("✓ "+esc([r.city||r.district, r.state].filter(Boolean).join(", ")),"ok"); } }); }, 0);

    // ---- collect: validate everything; the map check must be confirmed ----
    async function collect(extra){
      var v=function(k){ return String($(k).value||"").trim(); };
      var miss=[];
      if(v("name").split(/\s+/).filter(Boolean).length<2) miss.push("full name (first and last)");
      if(!/^[6-9]\d{9}$/.test(phone10(v("phone")))) miss.push("a 10-digit mobile number");
      if(!/^[1-9]\d{5}$/.test(v("pin"))) miss.push("a 6-digit PIN code");
      if(v("l1").length<2) miss.push("flat / house no.");
      if(v("l2").length<3) miss.push("area / street");
      if(v("lm").length<3) miss.push("landmark");
      if(v("city").length<2) miss.push("town / city");
      if(!v("state")) miss.push("state");
      if(miss.length){ var e0=new Error("Please add "+miss.join(", ")+"."); e0.field=true; throw e0; }
      if(state.pinInfo && canonState(state.pinInfo.state) && canonState(state.pinInfo.state)!==v("state"))
        throw new Error("This PIN code is in "+state.pinInfo.state+" — please pick that state.");
      if(state.verified && state.sig===sigNow()){
        // nothing changed since it was confirmed
      } else {
        if(!state.check || state.sig!==sigNow()){ await check(); $("map").scrollIntoView({ block:"nearest", behavior:"smooth" });
          var e1=new Error(state.check.down ? "Please confirm the address below, then save again." : state.check.pin_ok===false ? "This PIN code doesn't exist — please check it." : "Check the pin on the map below and confirm it, then save again."); e1.map=true; throw e1; }
        if(state.check.pin_ok===false) throw new Error("This PIN code doesn't exist — please check it.");
        if(!state.pinned){ $("map").scrollIntoView({ block:"nearest", behavior:"smooth" }); var e2=new Error("Tick the box under the map to confirm the address."); e2.map=true; throw e2; }
      }
      var mapOk = state.check ? (!!state.check.found && state.check.near_pin!==false && state.check.state_ok!==false) : state.verified;
      return Object.assign({
        recipient_name: v("name"), recipient_phone: "+91"+phone10(v("phone")),
        line1: v("l1"), line2: v("l2"), landmark: v("lm"), city: v("city"), state: v("state"), postal_code: v("pin"), country: "India",
        delivery_instructions: v("di") || null,
        lat: state.coords ? Math.round(state.coords.lat*1e6)/1e6 : null, lng: state.coords ? Math.round(state.coords.lon*1e6)/1e6 : null,
        map_verified: mapOk
      }, extra||{});
    }
    return { collect: collect, check: check, el: document.getElementById(id) };
  }
  window.GeekAddress = { mount: mount, states: STATES, canonState: canonState };
})();
