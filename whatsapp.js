/* WhatsApp login (OTP) + 1:1 integrated chat. Talks only to the secure Edge Functions + RLS-scoped tables;
 * backend is Meta WhatsApp Cloud API. Degrades gracefully if the functions/tables aren't deployed yet. */
(function () {
  "use strict";
  function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function sbc(){ return window.sb || null; }
  function fn(name,body){ return sbc().functions.invoke(name,{ body: body||{} }); }
  // the Edge Function's own error message (non-2xx bodies live on error.context), not just the HTTP status
  async function fnErr(r){ if(r.error) return typeof fnError==="function" ? await fnError(r.error) : (r.error.message||String(r.error)); return (r.data||{}).error||""; }
  function fmt(t){ if(!t) return ""; try{ return new Date(t).toLocaleString("en-IN",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}); }catch(e){ return ""; } }

  /* ============================ WhatsApp OTP login ============================ */
  function overlay(html){
    var o=document.getElementById("waOverlay"); if(!o){ o=document.createElement("div"); o.id="waOverlay"; o.className="wa-overlay"; document.body.appendChild(o); }
    o.innerHTML='<div class="wa-modal">'+html+'</div>'; o.style.display="flex"; return o;
  }
  function closeOverlay(){ var o=document.getElementById("waOverlay"); if(o) o.style.display="none"; }
  var _phone="", _linkMode=false;
  function openLink(){ _linkMode=true; startOverlay("Link your WhatsApp", "Get campaign updates on WhatsApp. We'll send a 6-digit code to confirm the number."); }
  function openLogin(){ _linkMode=false; startOverlay("Sign in with WhatsApp", "We'll send a 6-digit code to your WhatsApp."); }
  function startOverlay(title, sub){
    overlay('<div class="ci-mh"><h3>'+esc(title)+'</h3><button class="wa-x" id="waClose">×</button></div>'
      + '<div class="muted">'+esc(sub)+'</div>'
      + '<label class="wa-f"><span>WhatsApp number (international)</span><input id="waPhone" placeholder="+91 98123 45678"></label>'
      + '<button class="btn" id="waSend">Send code</button><div class="wa-msg" id="waMsg"></div>');
    document.getElementById("waClose").onclick=closeOverlay;
    document.getElementById("waSend").onclick=sendCode;
  }
  async function sendCode(){
    var phone=(document.getElementById("waPhone").value||"").trim(); var msg=document.getElementById("waMsg");
    if(!/^\+?[0-9 \-]{8,}$/.test(phone)){ msg.textContent="Enter a valid number in international format."; return; }
    _phone=phone; msg.textContent="Sending…";
    try{ var r=await fn("wa-otp-start",{ phone: phone }); var em=await fnErr(r); if(em) throw new Error(em);
      codeStep();
    }catch(e){ msg.textContent="Couldn't send: "+(e.message||e); }
  }
  function codeStep(){
    overlay('<div class="ci-mh"><h3>Enter your code</h3><button class="wa-x" id="waClose">×</button></div>'
      + '<div class="muted">Sent to '+esc(_phone)+' on WhatsApp.</div>'
      + '<label class="wa-f"><span>6-digit code</span><input id="waCode" inputmode="numeric" maxlength="6" placeholder="••••••"></label>'
      + '<button class="btn" id="waVerify">'+(_linkMode?'Verify &amp; link':'Verify &amp; sign in')+'</button>'
      + '<button class="btn ghost sm" id="waResend">Resend</button><div class="wa-msg" id="waMsg"></div>');
    document.getElementById("waClose").onclick=closeOverlay;
    document.getElementById("waResend").onclick=sendCode;
    document.getElementById("waVerify").onclick=verifyCode;
  }
  async function verifyCode(){
    var code=(document.getElementById("waCode").value||"").trim(); var msg=document.getElementById("waMsg");
    if(!/^\d{6}$/.test(code)){ msg.textContent="Enter the 6-digit code."; return; }
    msg.textContent="Verifying…";
    try{
      var r=await fn("wa-otp-verify",{ phone:_phone, code:code, link:_linkMode }); var d=r.data||{};
      var em=await fnErr(r); if(em) throw new Error(em);
      if(_linkMode){ msg.textContent="Linked ✓"; closeOverlay(); renderStatus(); return; }
      var v=await sbc().auth.verifyOtp({ token_hash:d.token_hash, type:"magiclink" });
      if(v.error) throw v.error;
      msg.textContent="Signed in ✓";
      if(window.Auth) await Auth.currentSession();
      if(window.Tracker) Tracker.security("login", { method: "whatsapp_otp" });
      closeOverlay();
      var authRoot=document.getElementById("authRoot"); if(authRoot){ authRoot.classList.remove("open"); authRoot.innerHTML=""; }
      if(window.Auth) await Auth.currentSession();
      if(typeof bootOS==="function") bootOS(); else location.reload();
    }catch(e){ msg.textContent="Couldn't verify: "+(e.message||e); }
  }
  window.waLogin = { open: openLogin, link: openLink };

  /* ============================ 1:1 chat page ============================ */
  var _conv=null, _channel=null;
  window.renderWhatsApp = function(){
    return '<div id="waStatus" class="wa-status"></div>'
      + '<div id="waChat" class="wa-chat">'
      + '<div class="wa-list"><div class="ci-mh" style="padding:10px"><h3>Messages</h3><button class="btn sm" id="waNew">New</button></div>'
      + '<div id="waConvs"><div class="muted" style="padding:12px">Loading…</div></div></div>'
      + '<div class="wa-thread"><div id="waThreadHead" class="wa-thead muted" style="padding:12px">Select a conversation</div>'
      + '<div id="waMessages" class="wa-msgs"></div>'
      + '<div class="wa-compose" id="waCompose" style="display:none"><input id="waInput" placeholder="Type a message…"><button class="btn" id="waSendMsg">Send</button></div>'
      + '</div></div>';
  };
  // my WhatsApp number: link it (email / Instagram accounts) and pause / resume campaign updates
  async function renderStatus(){
    var el=document.getElementById("waStatus"); if(!el) return;
    try{
      var u=(await sbc().auth.getUser()).data.user; if(!u) return;
      var r=await sbc().from("wa_contacts").select("phone_e164,verified_at,opt_out_at").eq("user_id",u.id).maybeSingle();
      if(r.error) throw r.error; var c=r.data;
      if(!c||!c.verified_at){
        el.innerHTML='<span>💬 Get campaign updates on WhatsApp.</span><button class="btn sm" id="waLinkBtn">Link WhatsApp</button>';
        document.getElementById("waLinkBtn").onclick=openLink; return;
      }
      var off=!!c.opt_out_at;
      el.innerHTML='<span>💬 WhatsApp <b>'+esc(c.phone_e164)+'</b> · '+(off?'updates paused':'receiving campaign updates')+'</span>'
        +'<button class="btn ghost sm" id="waOptBtn">'+(off?'Resume updates':'Pause updates')+'</button>';
      document.getElementById("waOptBtn").onclick=async function(){
        var x=await sbc().rpc("wa_set_opt_out",{ p_opt_out: !off }); if(x.error){ alert(x.error.message); return; } renderStatus(); };
    }catch(e){ el.innerHTML=''; }
  }
  async function load(){
    renderStatus();
    var nb=document.getElementById("waNew"); if(nb) nb.onclick=newConversation;
    try{
      var r=await sbc().from("wa_conversations").select("id,subject,contact_phone_e164,last_message_at").order("last_message_at",{ascending:false,nullsFirst:false}).limit(100);
      if(r.error) throw r.error;
      renderConvs(r.data||[]);
    }catch(e){ document.getElementById("waConvs").innerHTML='<div class="ci-err-inline" style="padding:12px">Couldn\'t load conversations: '+esc(e.message||e)+'</div>'; }
  }
  function renderConvs(list){
    var el=document.getElementById("waConvs");
    if(!list.length){ el.innerHTML='<div class="muted" style="padding:12px">No conversations yet. Tap “New”.</div>'; return; }
    el.innerHTML=list.map(function(c){ return '<div class="wa-conv" data-id="'+esc(c.id)+'"><b>'+esc(c.subject||c.contact_phone_e164)+'</b>'
      +'<div class="muted">'+esc(c.contact_phone_e164)+' · '+fmt(c.last_message_at)+'</div></div>'; }).join("");
    el.querySelectorAll("[data-id]").forEach(function(d){ d.onclick=function(){ openConv(d.getAttribute("data-id"), d.querySelector("b").textContent); }; });
  }
  async function openConv(id, title){
    _conv=id;
    document.getElementById("waThreadHead").innerHTML='<b>'+esc(title)+'</b>';
    document.getElementById("waCompose").style.display="flex";
    document.getElementById("waSendMsg").onclick=sendMsg;
    document.getElementById("waInput").onkeydown=function(e){ if(e.key==="Enter") sendMsg(); };
    var box=document.getElementById("waMessages"); box.innerHTML='<div class="muted">Loading…</div>';
    try{
      var r=await sbc().from("wa_messages").select("id,direction,body,status,created_at").eq("conversation_id",id).order("created_at",{ascending:true}).limit(500);
      if(r.error) throw r.error;
      renderMsgs(r.data||[]);
      subscribe(id);
    }catch(e){ box.innerHTML='<div class="ci-err-inline">Couldn\'t load: '+esc(e.message||e)+'</div>'; }
  }
  function renderMsgs(list){
    var box=document.getElementById("waMessages");
    box.innerHTML=list.map(bubble).join("");
    box.scrollTop=box.scrollHeight;
  }
  var TICKS={ queued:"…", sent:"✓", delivered:"✓✓", read:"✓✓ read", failed:"⚠ failed" };
  function meta(m){ return fmt(m.created_at)+(m.direction==="outbound"?" · "+esc(TICKS[m.status]||m.status):""); }
  function bubble(m){ return '<div class="wa-b '+(m.direction==="outbound"?"out":"in")+'" data-mid="'+esc(m.id)+'">'+esc(m.body||"")
    +'<span class="wa-meta">'+meta(m)+'</span></div>'; }
  function subscribe(id){
    if(_channel){ try{ sbc().removeChannel(_channel); }catch(e){} }
    _channel=sbc().channel("wa:"+id)
      .on("postgres_changes",{event:"INSERT",schema:"public",table:"wa_messages",filter:"conversation_id=eq."+id},function(p){
        if(_conv!==id) return; var box=document.getElementById("waMessages"); if(!box) return;
        box.insertAdjacentHTML("beforeend", bubble(p.new)); box.scrollTop=box.scrollHeight;
      })
      .on("postgres_changes",{event:"UPDATE",schema:"public",table:"wa_messages",filter:"conversation_id=eq."+id},function(p){
        var b=document.querySelector('[data-mid="'+p.new.id+'"] .wa-meta'); if(b) b.innerHTML=meta(p.new);
      }).subscribe();
  }
  async function sendMsg(){
    var inp=document.getElementById("waInput"); var text=(inp.value||"").trim(); if(!text||!_conv) return;
    inp.value=""; inp.disabled=true;
    try{ var r=await fn("wa-send",{ conversation_id:_conv, text:text }); var em=await fnErr(r);
      if(em) throw new Error(em);
      // the INSERT realtime event will render the bubble
    }catch(e){ alert("Couldn't send: "+(e.message||e)+(/24-hour/.test(e.message||"")?"\n\nStart a “New” chat with an approved template to reopen it.":"")); inp.value=text; }
    inp.disabled=false; inp.focus();
  }
  function newConversation(){
    overlay('<div class="ci-mh"><h3>New WhatsApp chat</h3><button class="wa-x" id="waClose">×</button></div>'
      + '<label class="wa-f"><span>WhatsApp number</span><input id="nwPhone" placeholder="+91 98123 45678"></label>'
      + '<label class="wa-f"><span>Message</span><textarea id="nwText" rows="3" placeholder="Hi! …"></textarea></label>'
      + '<div class="ci-note">Outside the 24-hour window WhatsApp requires a pre-approved template for the first message.</div>'
      + '<div id="nwTpl" style="display:none"><label class="wa-f"><span>Approved template name</span><input id="nwTplName" placeholder="campaign_update"></label>'
      + '<label class="wa-f"><span>Template variables (comma-separated, in order)</span><input id="nwTplVars" placeholder="Priya, Summer Glow"></label></div>'
      + '<button class="btn" id="nwSend">Send</button><div class="wa-msg" id="waMsg"></div>');
    document.getElementById("waClose").onclick=closeOverlay;
    document.getElementById("nwSend").onclick=async function(){
      var phone=(document.getElementById("nwPhone").value||"").trim(), text=(document.getElementById("nwText").value||"").trim(); var msg=document.getElementById("waMsg");
      var tpl=(document.getElementById("nwTplName").value||"").trim();
      var vars=(document.getElementById("nwTplVars").value||"").split(",").map(function(v){ return v.trim(); }).filter(Boolean);
      if(!phone||(!text&&!tpl)){ msg.textContent="Enter a number and a message."; return; } msg.textContent="Sending…";
      var body=tpl ? { to_phone:phone, template:tpl, variables:vars } : { to_phone:phone, text:text };
      try{ var r=await fn("wa-send",body); var d=r.data||{}; var em=await fnErr(r);
        if(em) throw new Error(em);
        closeOverlay(); await load(); if(d.conversation_id) openConv(d.conversation_id, phone);
      }catch(e){
        if(/24-hour/.test(e.message||"")){ document.getElementById("nwTpl").style.display="block"; msg.textContent="This number hasn't messaged you in 24h — send an approved template first."; return; }
        msg.textContent="Couldn't send: "+(e.message||e);
      }
    };
  }
  window.waChat = { load: load };
})();
