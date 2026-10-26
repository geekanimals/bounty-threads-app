/* ================= 💰 Payments — paid & barter + paid campaigns (Super Admin only) =================
   Every creator A–Z: their fee + terms (set here or from the bulk sheet), bank / UPI details (verified automatically
   by RazorpayX when connected, else by hand), advance / balance payments — pay through RazorpayX, export the RazorpayX
   bulk-payout file, import its report (UTRs), or record a transfer made elsewhere. Fees are never shown to brands. */
let _pay = null;        // { camp, data, q, f, sel: Set(payout_id), err }
const PAY_DET = { pending:["Not added","warn"], submitted:["Check by hand","warn"], verifying:["Checking…",""], verified:["Verified ✓","good"],
                  failed:["Failed ✗","bad"], needs_update:["Asked again","warn"] };
const PAY_PO = { waiting:["not due yet",""], due:["due","warn"], queued:["sending…",""], processing:["sent — waiting for the bank",""],
                 paid:["paid ✓","good"], failed:["failed","bad"], cancelled:["cancelled",""] };
const PAY_PART = { advance:"Advance", balance:"Balance", full:"Fee" };
const payInr = n => n==null || n==="" ? "—" : "₹" + Math.round(+n).toLocaleString("en-IN");
const payRpc = (fn, args) => sb.schema("api").rpc(fn, args||{}).then(r=>r, e=>({ error:e }));
const payErr = e => (e && (e.message || e.error_description)) || String(e);

function payCampKind(){ return ((typeof _wsCampaign!=="undefined" && _wsCampaign) || {}).campaign_type || (_bpCamp && _bpCamp.kind) || ""; }
function payIsPaidCamp(){ return ["paid","barter_paid"].includes(payCampKind()); }

async function loadPayments(){
  if(!_bpCamp) return;
  const keep = _pay && _pay.camp===_bpCamp.id ? _pay : null;
  const { data, error } = await payRpc("campaign_payments", { p_campaign: _bpCamp.id });
  _pay = { camp:_bpCamp.id, data: error ? null : data, err: error ? payErr(error) : null,
           q: keep ? keep.q : "", f: keep ? keep.f : "all", sel: keep ? keep.sel : new Set() };
  // drop selections that can't be paid any more
  if(_pay.data) { const ok = new Set(payRows().flatMap(r=> payReadyOuts(r).map(o=>o.payout_id))); _pay.sel.forEach(id=>{ if(!ok.has(id)) _pay.sel.delete(id); }); }
  payRepaint();
}
function payRepaint(){ const box = document.getElementById("payBox"); if(!box) return; box.innerHTML = payHtml(); wirePayments(); }
function payAfterPaint(){ if(!_pay || _pay.camp!==(_bpCamp&&_bpCamp.id)) loadPayments(); else wirePayments(); }

function payRows(){ return ((_pay && _pay.data && _pay.data.rows) || []); }
function payWho(r){ const c = r.creator||{}; return (c.username||r.applied_profile) ? "@"+(c.username||r.applied_profile) : (r.name || c.name || "Creator"); }
// payouts that can go now: due / failed, details verified, not on hold
function payReadyOuts(r){ const p = r.payment||{}; if(p.on_hold || p.details_status!=="verified") return [];
  return (p.payouts||[]).filter(o=> ["due","failed"].includes(o.status) && +o.amount > 0); }
function payMatch(r){
  const p = r.payment||{}, po = p.payouts||[], f = (_pay && _pay.f) || "all";
  if(f==="nofee" && p.amount!=null) return false;
  if(f==="nodetails" && p.method) return false;
  if(f==="unverified" && !(p.method && p.details_status!=="verified")) return false;
  if(f==="due" && !po.some(o=> ["due","failed"].includes(o.status))) return false;
  if(f==="sent" && !po.some(o=> ["queued","processing"].includes(o.status))) return false;
  if(f==="paid" && !(po.length && po.every(o=> o.status==="paid"))) return false;
  const q = ((_pay && _pay.q) || "").trim().toLowerCase();
  if(q && ![payWho(r), r.name, (r.creator||{}).name, p.upi_id, p.account_name].join(" ").toLowerCase().includes(q)) return false;
  return true;
}
function payTerms(p, days){
  if(p.amount==null) return "";
  const d = p.due_days || days || 7, a = +p.advance_pct||0;
  return a>=100 ? "all in advance (after signing)" : a>0 ? `${a}% advance (${payInr(Math.round(p.amount*a/100))}) after signing · balance ${d} days after posts` : `paid ${d} days after every post is live`;
}
function payHtml(){
  if(!_pay || _pay.camp!==(_bpCamp&&_bpCamp.id)) return skel("list",4);
  if(_pay.err) return `<div class="ci-err-inline">${esc(_pay.err)}</div>`;
  const D = _pay.data||{}, rows = payRows(), shown = rows.filter(payMatch), prov = D.provider||{};
  const all = rows.flatMap(r=> (r.payment||{}).payouts||[]);
  const sum = st => all.filter(o=> st.includes(o.status)).reduce((a,o)=> a + (+o.amount||0), 0);
  const agreed = rows.reduce((a,r)=> a + (+((r.payment||{}).amount)||0), 0);
  const nofee = rows.filter(r=> (r.payment||{}).amount==null).length, nodet = rows.filter(r=> !(r.payment||{}).method).length;
  const unv = rows.filter(r=> (r.payment||{}).method && (r.payment||{}).details_status!=="verified").length;
  const selOuts = rows.flatMap(r=> payReadyOuts(r)).filter(o=> _pay.sel.has(o.payout_id));
  const selTot = selOuts.reduce((a,o)=> a + (+o.amount||0), 0);
  const F = [["all","Everyone"],["nofee","Fee not set"],["nodetails","No bank / UPI"],["unverified","Not verified"],["due","Due now"],["sent","Being paid"],["paid","Fully paid"]];
  return `<div class="pay">
    <div class="pay-kpis">
      <div><b>${payInr(agreed)}</b><span>agreed (${rows.filter(r=>(r.payment||{}).amount!=null).length} creators)</span></div>
      <div><b>${payInr(sum(["paid"]))}</b><span>paid</span></div>
      <div class="${sum(["due","failed"])?"warn":""}"><b>${payInr(sum(["due","failed"]))}</b><span>due (ready to pay)</span></div>
      <div><b>${payInr(sum(["queued","processing"]))}</b><span>being paid</span></div>
      <div class="${nofee?"warn":""}"><b>${nofee}</b><span>fee not set${nofee?" — contracts waiting":""}</span></div>
      <div class="${nodet+unv?"warn":""}"><b>${nodet} · ${unv}</b><span>no details · not verified</span></div>
    </div>
    <div class="pay-prov ${prov.connected?"on":""}">${prov.connected
      ? `🟢 <b>Razorpay connected</b>${prov.mode==="test"?' <span class="tag warn">test mode</span>':""}${prov.account?` · paying from ••${esc(prov.account)}`:""}${prov.balance!=null?` · balance <b>${payInr(prov.balance)}</b>`:""} — tap <b>💸 Pay</b> on a creator, or select several and pay them in one go. Bank / UPI details are checked automatically.`
      : `⚪ <b>Razorpay not connected</b>${prov.error?` — ${esc(prov.error)}`:""}. Until then: verify details by hand, pay from your bank / UPI and record it with the UTR + screenshot, or use the RazorpayX bulk file.`}
      <button type="button" class="mini-btn ghost" data-payping>↻ Check Razorpay</button>${prov.checked_at?` <span class="muted">checked ${esc(typeof fmtDateTime==="function" ? fmtDateTime(prov.checked_at) : prov.checked_at)}</span>`:""}</div>
    <div class="pay-bar">
      <input type="search" id="payQ" placeholder="🔎 @handle, name, UPI…" value="${esc(_pay.q||"")}">
      <select id="payF">${F.map(([k,l])=>`<option value="${k}"${_pay.f===k?" selected":""}>${l}</option>`).join("")}</select>
      <button type="button" class="btn sm ghost" data-payup>📥 Upload fees (sheet)</button>
      <button type="button" class="btn sm ghost" data-paycsv>⬇ CSV</button>
      <button type="button" class="btn sm ghost" data-payimp>⬆ Import RazorpayX report</button>
    </div>
    <div class="pay-selbar${selOuts.length?" on":""}">
      <label class="cp-check"><input type="checkbox" id="payAll"${selOuts.length && selOuts.length===rows.filter(payMatch).flatMap(payReadyOuts).length?" checked":""}> Select everything ready to pay</label>
      <span><b>${selOuts.length}</b> payment${selOuts.length===1?"":"s"} · <b>${payInr(selTot)}</b></span>
      <button type="button" class="btn sm" data-payrzp${!selOuts.length||!prov.connected?" disabled":""} title="${prov.connected?"":"Connect RazorpayX first"}">⚡ Pay selected via Razorpay</button>
      <button type="button" class="btn sm ghost" data-payfile${selOuts.length?"":" disabled"}>⬇ RazorpayX bulk file</button>
    </div>
    <div class="pay-list">${shown.length ? shown.map(payRowHtml).join("") : `<div class="muted" style="padding:14px">${rows.length?"Nobody matches.":"No creator is approved on this campaign yet — they appear here as soon as they are."}</div>`}</div>
    <div class="muted pay-foot">Fees are visible only to Super Admins — never to the brand, agencies or other creators. Each creator sees only their own fee, in their contract. Account numbers are stored encrypted; every full-number view is logged.</div>
  </div>`;
}
function payRowHtml(r){
  const p = r.payment||{}, P = esc(r.participation_id), c = r.creator||{}, po = p.payouts||[], ready = payReadyOuts(r);
  const det = PAY_DET[p.details_status] || [p.details_status||"—",""];
  const signed = r.contract && r.contract.signed_at;
  const pic = c.profile_picture_url ? `<img class="ap-pic" src="${esc(safeUrl(c.profile_picture_url))}" alt="" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">` : `<span class="avatar">${esc(payWho(r).replace(/^@/,"").slice(0,2).toUpperCase())}</span>`;
  const where = p.method==="upi" ? `UPI <b>${esc(p.upi_id||"")}</b>` : p.method==="bank" ? `A/c ••${esc(p.account_last4||"")} · ${esc(p.ifsc||"")}${p.bank_name?` · ${esc(p.bank_name)}`:""}` : `<span class="muted">no bank / UPI yet</span>`;
  const anyBusy = po.some(o=> ["queued","processing"].includes(o.status));
  return `<div class="pay-row${p.on_hold?" hold":""}" data-payrow="${P}">
    <label class="pay-ck" title="${ready.length?"Select to pay":"Nothing ready to pay"}"><input type="checkbox" data-paysel="${P}"${ready.length?"":" disabled"}${ready.length && ready.every(o=>_pay.sel.has(o.payout_id))?" checked":""}></label>
    <div class="pay-who">${pic}<div><b>${esc(payWho(r))}</b>${r.name?` <span class="muted">${esc(r.name)}</span>`:""}
      <div class="muted">${c.followers!=null?fmtNum(c.followers)+" followers · ":""}${esc(typeof hubStepLabel==="function" ? hubStepLabel(r.stage) : String(r.stage).replace(/_/g," "))}${signed?" · contract signed ✓":r.contract&&r.contract.issued_at?" · contract sent":p.amount==null?" · <b>contract waiting for the fee</b>":""}</div></div></div>
    <div class="pay-fee">${p.amount!=null ? `<b>${payInr(p.amount)}</b> <span class="muted">${esc(payTerms(p, (_pay.data||{}).due_days))}</span>${p.fee_source==="bulk"?' <span class="tag">from sheet</span>':""}` : `<span class="tag warn">Fee not set</span>`}
      ${p.terms_note?`<div class="muted">📝 ${esc(p.terms_note)}</div>`:""}
      ${r.first_fee?`<div class="muted pay-first">First fee with Geek: <b>${payInr(r.first_fee.amount)}</b> · ${esc(r.first_fee.campaign||"")}</div>`:""}
      ${p.amount!=null?`<div class="pay-left">Paid <b>${payInr(p.paid_total||0)}</b> · left <b>${payInr(p.left!=null?p.left:p.amount)}</b></div>`:""}
      <div class="pay-mini"><button type="button" class="mini-btn${p.amount==null?"":" ghost"}" data-payfee="${P}">${p.amount==null?"💰 Set fee & terms":"✏️ Fee & terms"}</button>
        ${p.amount!=null && +(p.left!=null?p.left:p.amount) > 0 ? `<button type="button" class="mini-btn" data-paypay="${P}">💸 Pay</button>` : ""}</div></div>
    <div class="pay-det">${where} <span class="tag ${det[1]}">${esc(det[0])}</span>${p.details_source&&p.details_source!=="creator"?` <span class="muted">(${esc(p.details_source==="bulk"?"from sheet":"added by team")})</span>`:""}
      ${p.verify_name?`<div class="muted">Name at bank: <b>${esc(p.verify_name)}</b>${p.account_name&&p.verify_name.toLowerCase()!==String(p.account_name).toLowerCase()?` · typed: ${esc(p.account_name)}`:""}</div>`:p.account_name?`<div class="muted">Name: ${esc(p.account_name)}</div>`:""}
      ${p.verify_message&&p.details_status!=="verified"?`<div class="muted">${esc(p.verify_message)}</div>`:""}
      ${p.details_status==="needs_update"&&p.request_reason?`<div class="muted">Asked: “${esc(p.request_reason)}”</div>`:""}
      <div class="pay-mini">
        <button type="button" class="mini-btn ghost" data-paydet="${P}"${anyBusy?" disabled":""}>✏️ Edit</button>
        ${p.method?`<button type="button" class="mini-btn ghost" data-payreveal="${P}">👁 Full details</button>`:""}
        ${p.method&&p.details_status!=="verified"?`<button type="button" class="mini-btn" data-payverify="${P}">✓ Verified by me</button>`:""}
        ${p.method&&(_pay.data.provider||{}).connected&&p.details_status!=="verifying"?`<button type="button" class="mini-btn ghost" data-payauto="${P}">↻ Auto-check</button>`:""}
        <button type="button" class="mini-btn ghost" data-payask="${P}"${anyBusy?" disabled":""}>✉️ Ask again</button></div></div>
    <div class="pay-outs">${po.length ? po.map(o=>{ const s = PAY_PO[o.status]||[o.status,""];
        return `<div class="pay-out"><span>${esc(PAY_PART[o.part]||o.part)} <b>${payInr(o.amount)}</b></span>
          <span class="tag ${s[1]}">${esc(s[0])}${o.status==="due"&&o.due_at?` · by ${esc(fmtDate(o.due_at))}`:o.status==="waiting"?` · ${esc(o.part==="advance"||(o.part==="full"&&+p.advance_pct>=100)?"after signing":"after the posts")}`:""}</span>
          ${o.utr?`<span class="muted">UTR ${esc(o.utr)}</span>`:""}${o.note==="part payment"?`<span class="muted">part payment</span>`:""}
          ${o.proof_path?`<button type="button" class="mini-btn ghost" data-payproof="${esc(o.proof_path)}">📎 Screenshot</button>`:o.status==="paid"?`<button type="button" class="mini-btn ghost" data-payaddproof="${esc(o.payout_id)}">📎 Add screenshot</button>`:""}${o.status==="failed"&&o.failure_reason?`<span class="muted">${esc(o.failure_reason)}</span>`:""}
          ${o.status==="processing"&&o.provider==="razorpayx_bulk"?`<span class="muted">in the bulk file · ref ${esc(o.ref_code)}</span>`:""}
          <span class="pay-oacts">${["due","failed"].includes(o.status)||(o.status==="processing"&&o.provider==="razorpayx_bulk")?`<button type="button" class="mini-btn ghost" data-paymark="${esc(o.payout_id)}">✅ Paid (UTR)</button>`:""}
            ${(o.status==="processing"&&o.provider==="razorpayx_bulk")||o.status==="failed"?`<button type="button" class="mini-btn ghost" data-payreset="${esc(o.payout_id)}">↺ Back to due</button>`:""}</span></div>`; }).join("")
      : `<span class="muted">${p.amount==null?"—":"no payments yet"}</span>`}
      <div class="pay-mini">${p.on_hold?`<span class="tag bad">⏸ On hold${p.hold_reason?`: ${esc(p.hold_reason)}`:""}</span> <button type="button" class="mini-btn" data-payhold="${P}" data-on="0">▶ Release</button>`
        : `<button type="button" class="mini-btn ghost" data-payhold="${P}" data-on="1">⏸ Hold</button>`}</div></div>
  </div>`;
}
function wirePayments(){
  const box = document.getElementById("payBox"); if(!box || !_pay) return;
  const q = box.querySelector("#payQ"); if(q) q.oninput = ()=>{ _pay.q = q.value; const pos = q.selectionStart; payRepaint(); const n = document.getElementById("payQ"); if(n){ n.focus(); try{ n.setSelectionRange(pos,pos); }catch(e){} } };
  const f = box.querySelector("#payF"); if(f) f.onchange = ()=>{ _pay.f = f.value; payRepaint(); };
  const rowOf = pid => payRows().find(r=> r.participation_id===pid) || {};
  box.querySelectorAll("[data-paysel]").forEach(ck=> ck.onchange = ()=>{ payReadyOuts(rowOf(ck.dataset.paysel)).forEach(o=> ck.checked ? _pay.sel.add(o.payout_id) : _pay.sel.delete(o.payout_id)); payRepaint(); });
  const all = box.querySelector("#payAll"); if(all) all.onchange = ()=>{ const outs = payRows().filter(payMatch).flatMap(payReadyOuts);
    if(all.checked) outs.forEach(o=> _pay.sel.add(o.payout_id)); else _pay.sel.clear(); payRepaint(); };
  box.querySelectorAll("[data-payfee]").forEach(b=> b.onclick = ()=> payFeeModal(rowOf(b.dataset.payfee)));
  box.querySelectorAll("[data-paydet]").forEach(b=> b.onclick = ()=> payDetailsModal(rowOf(b.dataset.paydet)));
  box.querySelectorAll("[data-payreveal]").forEach(b=> b.onclick = ()=> payReveal(rowOf(b.dataset.payreveal)));
  box.querySelectorAll("[data-payverify]").forEach(b=> b.onclick = async ()=>{ const r = rowOf(b.dataset.payverify);
    if(!await confirmChange(`Mark ${payWho(r)}'s payment details as verified`, "Only do this after you've checked the account / UPI ID is in their own name.")) return;
    const note = (prompt("How did you check? (optional — e.g. ₹1 test transfer, bank statement)", "checked by the Geek team")||"").trim();
    const { error } = await payRpc("payment_verify", { p_participation: r.participation_id, p_mode:"manual", p_note: note||null });
    gateToast(error ? payErr(error) : "Payment details verified ✓"); loadPayments(); });
  box.querySelectorAll("[data-payauto]").forEach(b=> b.onclick = async ()=>{ const { error } = await payRpc("payment_verify", { p_participation: b.dataset.payauto, p_mode:"auto" });
    gateToast(error ? payErr(error) : "Automatic check started — the result shows here in a minute ✓"); loadPayments(); });
  box.querySelectorAll("[data-payask]").forEach(b=> b.onclick = async ()=>{ const r = rowOf(b.dataset.payask);
    const reason = (prompt(`What's wrong with ${payWho(r)}'s payment details? (they get this on WhatsApp / email / app)`, r.payment && r.payment.details_status==="failed" ? "the bank could not verify this account" : "the account name doesn't match your name")||"").trim();
    if(!reason) return;
    const { error } = await payRpc("payment_request_details", { p_participation: r.participation_id, p_reason: reason });
    gateToast(error ? payErr(error) : `Asked ${payWho(r)} for new details ✓`); loadPayments(); });
  box.querySelectorAll("[data-payhold]").forEach(b=> b.onclick = async ()=>{ const on = b.dataset.on==="1";
    const reason = on ? (prompt("Why is this payment on hold? (e.g. a post was taken down)")||"").trim() : null;
    if(on && !reason) return;
    const { error } = await payRpc("payment_hold", { p_participation: b.dataset.payhold, p_hold: on, p_reason: reason });
    gateToast(error ? payErr(error) : on ? "On hold ✓" : "Released ✓"); loadPayments(); });
  box.querySelectorAll("[data-paymark]").forEach(b=> b.onclick = ()=> payMarkPaidModal(b.dataset.paymark));
  box.querySelectorAll("[data-payreset]").forEach(b=> b.onclick = async ()=>{
    if(!await confirmChange("Put this payment back to “due”", "Only if it was NOT paid through the RazorpayX bulk file (or it failed). It can then be paid again.")) return;
    const { error } = await payRpc("payout_reset", { p_payout: b.dataset.payreset }); gateToast(error ? payErr(error) : "Back to due ✓"); loadPayments(); });
  box.querySelectorAll("[data-payping]").forEach(b=> b.onclick = async ()=>{ b.disabled = true; b.textContent = "Checking…";
    const { error } = await payRpc("payments_ping"); if(error){ gateToast(payErr(error)); b.disabled = false; b.textContent = "↻ Check Razorpay"; return; }
    setTimeout(loadPayments, 6000); });
  box.querySelectorAll("[data-paypay]").forEach(b=> b.onclick = ()=> payPayModal(rowOf(b.dataset.paypay)));
  box.querySelectorAll("[data-payproof]").forEach(b=> b.onclick = ()=> payOpenProof(b.dataset.payproof));
  box.querySelectorAll("[data-payaddproof]").forEach(b=> b.onclick = ()=> payAddProof(b.dataset.payaddproof));
  const up = box.querySelector("[data-payup]"); if(up) up.onclick = payUploadModal;
  const csv = box.querySelector("[data-paycsv]"); if(csv) csv.onclick = payCsv;
  const imp = box.querySelector("[data-payimp]"); if(imp) imp.onclick = payImportModal;
  const rz = box.querySelector("[data-payrzp]"); if(rz) rz.onclick = payViaRazorpay;
  const fl = box.querySelector("[data-payfile]"); if(fl) fl.onclick = payBulkFile;
}
function paySelected(){ return payRows().flatMap(payReadyOuts).filter(o=> _pay.sel.has(o.payout_id)); }

/* ---- fee & terms for one creator ---- */
function payFeeModal(r){
  const p = r.payment||{}, days = p.due_days || (_pay.data||{}).due_days || 7, adv = +p.advance_pct||0;
  const ADV = [0,10,20,25,30,40,50,60,70,75,100];
  const m = bpModal(`💰 Fee & terms — ${esc(payWho(r))}`, `<form class="modal-form" id="pfF">
    <p class="muted" style="margin:0">The fee you agreed with ${esc(payWho(r))}. It goes into <b>their</b> contract only — the brand never sees it.${r.contract&&r.contract.signed_at?" <b>They already signed</b>: the change is logged; tell them about it.":" If the contract isn't signed yet it is re-written with this fee (and sent now if it was waiting)."}</p>
    ${r.first_fee?`<div class="muted">First fee with Geek: <b>${payInr(r.first_fee.amount)}</b> on ${esc(r.first_fee.campaign||"another campaign")}</div>`:""}
    <div class="mf-row"><label>Total fee (₹)<input name="amount" type="number" min="1" step="1" required value="${p.amount!=null?esc(p.amount):""}" placeholder="15000"></label>
      <label>Advance<select name="adv">${ADV.map(a=>`<option value="${a}"${a===adv?" selected":""}>${a===0?"No advance":a===100?"100% — all in advance":a+"% advance"}</option>`).join("")}${ADV.includes(adv)?"":`<option value="${adv}" selected>${adv}% advance</option>`}</select></label></div>
    <div class="mf-row"><label>Balance paid — days after every post is live<select name="days">${[3,5,7,10,15,30,45,60].map(n=>`<option value="${n}"${n===days?" selected":""}>${n} days</option>`).join("")}</select></label>
      <label>Other agreed terms <span class="muted" style="font-weight:400">(optional — goes into the contract)</span><input name="note" maxlength="300" value="${esc(p.terms_note||"")}" placeholder="e.g. includes 1 story repost"></label></div>
    <div class="cm-ctprev" id="pfPrev"></div>
    <div class="auth-err" id="pfErr"></div><button class="btn" type="submit">Save fee</button></form>`);
  const form = m.querySelector("#pfF");
  const prev = ()=>{ const a = +form.amount.value||0, ad = +form.adv.value||0, d = +form.days.value||7;
    document.getElementById("pfPrev").innerHTML = a ? `📜 In the contract: total <b>${payInr(a)}</b> — ${ad>=100?"paid in full after signing (once details are verified)":ad>0?`advance <b>${payInr(Math.round(a*ad/100))}</b> after signing, balance <b>${payInr(a-Math.round(a*ad/100))}</b> within ${d} days after every post is live`:`paid in full within ${d} days after every post is live`}.` : ""; };
  form.oninput = prev; form.onchange = prev; prev();
  form.onsubmit = async e=>{ e.preventDefault(); const btn = form.querySelector("button[type=submit]"), err = document.getElementById("pfErr");
    btn.disabled = true; btn.textContent = "Saving…";
    const { data, error } = await payRpc("payment_set_terms", { p_participation: r.participation_id, p_amount: +form.amount.value,
      p_advance_pct: +form.adv.value, p_due_days: +form.days.value, p_note: form.note.value.trim()||null });
    if(error){ err.textContent = payErr(error); btn.disabled = false; btn.textContent = "Save fee"; return; }
    m.remove(); gateToast(`Fee saved ✓${data && data.stage==="contract_sent" && !data.contract_signed ? " — contract sent to them" : ""}`);
    loadPayments(); if(typeof loadBarterProcess==="function") loadBarterProcess(true); };
}
/* ---- edit bank / UPI on their behalf ---- */
function payDetailsModal(r){
  const p = r.payment||{}, bank = p.method!=="upi";
  const m = bpModal(`🏦 Payment details — ${esc(payWho(r))}`, `<form class="modal-form" id="pdF">
    <p class="muted" style="margin:0">Use this when the creator sent their details another way (WhatsApp, email). They must be in the creator's own name. The automatic check runs again.</p>
    <div class="cm-seg" id="pdSeg"><label class="${bank?"act":""}"><input type="radio" name="m" value="bank"${bank?" checked":""}> 🏦 Bank account</label><label class="${!bank?"act":""}"><input type="radio" name="m" value="upi"${!bank?" checked":""}> 📱 UPI ID</label></div>
    <label>Account holder name<input name="name" required maxlength="80" value="${esc(p.account_name||"")}"></label>
    <div id="pdB"${bank?"":" hidden"}><div class="mf-row"><label>Account number<input name="no" inputmode="numeric" autocomplete="off" maxlength="22" placeholder="${p.account_last4?"•••• "+esc(p.account_last4)+" — type the full number":"9–18 digits"}"></label>
      <label>IFSC<input name="ifsc" maxlength="11" style="text-transform:uppercase" value="${esc(p.ifsc||"")}" placeholder="HDFC0001234"></label></div></div>
    <div id="pdU"${bank?" hidden":""}><label>UPI ID<input name="upi" maxlength="100" autocomplete="off" value="${esc(p.upi_id||"")}" placeholder="name@okhdfcbank"></label></div>
    <div class="auth-err" id="pdErr"></div><button class="btn" type="submit">Save &amp; verify</button></form>`);
  const form = m.querySelector("#pdF");
  form.querySelectorAll("input[name=m]").forEach(x=> x.onchange = ()=>{ const b = form.m.value==="bank"; m.querySelector("#pdB").hidden = !b; m.querySelector("#pdU").hidden = b;
    form.querySelectorAll("#pdSeg label").forEach(l=> l.classList.toggle("act", l.querySelector("input").checked)); });
  form.onsubmit = async e=>{ e.preventDefault(); const btn = form.querySelector("button[type=submit]"), err = document.getElementById("pdErr"), b = form.m.value==="bank";
    btn.disabled = true; btn.textContent = "Saving…";
    const { error } = await payRpc("payment_admin_details", { p_participation: r.participation_id, p_method: form.m.value, p_account_name: form.name.value.trim(),
      p_account_no: b ? form.no.value.replace(/[\s-]/g,"") : null, p_ifsc: b ? form.ifsc.value.trim().toUpperCase() : null, p_upi: b ? null : form.upi.value.trim().toLowerCase() });
    if(error){ err.textContent = payErr(error); btn.disabled = false; btn.textContent = "Save & verify"; return; }
    m.remove(); gateToast("Payment details saved ✓"); loadPayments(); };
}
async function payReveal(r){
  const { data, error } = await payRpc("payment_reveal", { p_participation: r.participation_id });
  if(error){ gateToast(payErr(error)); return; }
  const d = data||{}, line = (k,v)=> v ? `<div class="bpp-row"><span>${esc(k)}</span><div><b>${esc(v)}</b> <button type="button" class="mini-btn ghost" data-copyv="${esc(v)}">Copy</button></div></div>` : "";
  const m = bpModal(`👁 ${esc(payWho(r))} — full payment details`, `<div class="modal-form">
    ${line("Name", d.account_name)}${d.method==="upi" ? line("UPI ID", d.upi_id) : line("Account number", d.account_no) + line("IFSC", d.ifsc)}
    <div class="muted" style="font-size:12px">This view is logged. Don't share these details outside the payment.</div></div>`);
  m.querySelectorAll("[data-copyv]").forEach(b=> b.onclick = async ()=>{ try{ await navigator.clipboard.writeText(b.dataset.copyv); b.textContent = "Copied ✓"; }catch(e){ prompt("Copy:", b.dataset.copyv); } });
}
function payMarkPaidModal(payoutId){
  const r = payRows().find(x=> ((x.payment||{}).payouts||[]).some(o=> o.payout_id===payoutId)) || {}, o = ((r.payment||{}).payouts||[]).find(x=> x.payout_id===payoutId) || {};
  const m = bpModal(`✅ Record a payment — ${esc(payWho(r))}`, `<form class="modal-form" id="pmF">
    <p class="muted" style="margin:0">${esc(PAY_PART[o.part]||"Payment")} of <b>${payInr(o.amount)}</b> paid outside the app (net banking / UPI / RazorpayX dashboard). The creator is told, with the UTR.</p>
    ${payManualFields()}
    <div class="auth-err" id="pmErr"></div><button class="btn" type="submit">Mark paid</button></form>`);
  const form = m.querySelector("#pmF");
  form.onsubmit = async e=>{ e.preventDefault(); const btn = form.querySelector("button[type=submit]"), err = document.getElementById("pmErr");
    if(!form.utr.value.trim() && !(form.proof.files||[]).length){ err.textContent = "Add the UTR or a screenshot of the payment."; return; }
    btn.disabled = true; btn.textContent = "Saving…";
    let path = null; try{ path = await payUploadProof(r.participation_id, form.proof.files[0]); }catch(ex){ err.textContent = payErr(ex); btn.disabled = false; btn.textContent = "Mark paid"; return; }
    const { error } = await payRpc("payout_mark_paid", { p_payout: payoutId, p_utr: form.utr.value.trim()||null, p_paid_on: form.on.value||null, p_note: form.note.value.trim()||null, p_proof_path: path });
    if(error){ err.textContent = payErr(error); btn.disabled = false; btn.textContent = "Mark paid"; return; }
    m.remove(); _pay.sel.delete(payoutId); gateToast("Recorded as paid ✓ — the creator was told"); loadPayments(); };
}
/* ---- the screenshot of a payment: private bucket, Super Admins upload, the creator can open their own ---- */
function payManualFields(){
  return `<div class="mf-row"><label>UTR / transaction reference<input name="utr" maxlength="40" placeholder="e.g. 425123456789"></label>
      <label>Paid on<input name="on" type="date" value="${new Date().toISOString().slice(0,10)}"></label></div>
    <label>Screenshot of the payment <span class="muted" style="font-weight:400">(image or PDF — the creator can open and download it)</span><input name="proof" type="file" accept="image/*,.pdf"></label>
    <label>Note <span class="muted" style="font-weight:400">(optional, team only)</span><input name="note" maxlength="200" placeholder="from HDFC current account"></label>
    <div class="muted" style="font-size:12px">Add the UTR, the screenshot, or both.</div>`;
}
async function payUploadProof(pid, file){
  if(!file) return null;
  if(file.size > 10*1024*1024) throw new Error("The screenshot must be under 10 MB.");
  const ext = (String(file.name||"").match(/\.([a-z0-9]{2,5})$/i)||[,"png"])[1].toLowerCase();
  const path = `${pid}/${Date.now()}-${Math.random().toString(36).slice(2,8)}.${ext}`;
  const { error } = await sb.storage.from("payment-proofs").upload(path, file, { contentType: file.type || "image/png", upsert:false });
  if(error) throw new Error("Couldn't upload the screenshot: " + (error.message||error));
  return path;
}
async function payOpenProof(path){
  const { data, error } = await sb.storage.from("payment-proofs").createSignedUrl(path, 600);
  if(error || !data){ gateToast("Couldn't open the screenshot: " + payErr(error)); return; }
  window.open(data.signedUrl, "_blank", "noopener");
}
function payAddProof(payoutId){
  const r = payRows().find(x=> ((x.payment||{}).payouts||[]).some(o=> o.payout_id===payoutId)) || {};
  const m = bpModal(`📎 Payment screenshot — ${esc(payWho(r))}`, `<form class="modal-form" id="paF"><input name="proof" type="file" accept="image/*,.pdf" required>
    <div class="muted" style="font-size:12px">The creator can open and download it from the campaign in their app.</div>
    <div class="auth-err" id="paErr"></div><button class="btn" type="submit">Upload</button></form>`);
  const form = m.querySelector("#paF");
  form.onsubmit = async e=>{ e.preventDefault(); const btn = form.querySelector("button[type=submit]"), err = document.getElementById("paErr");
    btn.disabled = true; btn.textContent = "Uploading…";
    try{ const path = await payUploadProof(r.participation_id, form.proof.files[0]);
      const { error } = await payRpc("payout_set_proof", { p_payout: payoutId, p_path: path }); if(error) throw error;
      m.remove(); gateToast("Screenshot added ✓"); loadPayments();
    }catch(ex){ err.textContent = payErr(ex); btn.disabled = false; btn.textContent = "Upload"; } };
}
/* ---- 💸 Pay one creator any amount: Razorpay, or record a manual transfer (UTR + screenshot) ---- */
function payPayModal(r){
  const p = r.payment||{}, prov = (_pay.data||{}).provider||{}, left = +(p.left!=null ? p.left : p.amount)||0;
  const dueNow = (p.payouts||[]).filter(o=> ["due","failed"].includes(o.status)).reduce((a,o)=> a + (+o.amount||0), 0);
  const canRzp = prov.connected && p.details_status==="verified" && !p.on_hold;
  const why = !prov.connected ? "Razorpay isn't connected yet" : p.on_hold ? "payments are on hold" : p.details_status!=="verified" ? "bank / UPI details not verified yet" : "";
  const where = p.method==="upi" ? `UPI ${esc(p.upi_id||"")}` : p.method==="bank" ? `A/c ••${esc(p.account_last4||"")} · ${esc(p.ifsc||"")}` : "no bank / UPI yet";
  const m = bpModal(`💸 Pay ${esc(payWho(r))}`, `<form class="modal-form" id="ppF">
    <div class="pay-sum"><div><span>Total fee</span><b>${payInr(p.amount)}</b></div><div><span>Paid</span><b>${payInr(p.paid_total||0)}</b></div>
      <div><span>Left</span><b>${payInr(left)}</b></div><div><span>Due now</span><b>${payInr(dueNow)}</b></div></div>
    <div class="muted" style="font-size:12.5px">Pays to: <b>${where}</b>${p.verify_name?` · name at bank ${esc(p.verify_name)}`:""} · ${esc(payTerms(p, (_pay.data||{}).due_days))}</div>
    <label>Amount to pay now (₹)<input name="amt" type="number" min="1" max="${left}" step="1" required value="${dueNow||left}"></label>
    <div class="pay-quick">${[["Due now",dueNow],["Everything left",left],["Half of what's left",Math.round(left/2)]].filter(x=>x[1]>0).map(([l,v])=>`<button type="button" class="mini-btn ghost" data-amt="${v}">${l} · ${payInr(v)}</button>`).join("")}</div>
    <div class="cm-seg" id="ppHow"><label class="${canRzp?"act":""}"><input type="radio" name="how" value="razorpay"${canRzp?" checked":""}${canRzp?"":" disabled"}> ⚡ Pay via Razorpay</label>
      <label class="${canRzp?"":"act"}"><input type="radio" name="how" value="manual"${canRzp?"":" checked"}> ✅ Paid manually</label></div>
    ${canRzp?"":`<div class="muted" style="font-size:12px">Razorpay: ${esc(why)}.</div>`}
    <div id="ppMan"${canRzp?" hidden":""}>${payManualFields()}</div>
    <div class="auth-err" id="ppErr"></div><button class="btn" type="submit">${canRzp?"⚡ Pay now":"Record payment"}</button></form>`);
  const form = m.querySelector("#ppF"), sub = form.querySelector("button[type=submit]");
  form.querySelectorAll("[data-amt]").forEach(b=> b.onclick = ()=>{ form.amt.value = b.dataset.amt; });
  form.querySelectorAll("input[name=how]").forEach(x=> x.onchange = ()=>{ const man = form.how.value==="manual";
    m.querySelector("#ppMan").hidden = !man; sub.textContent = man ? "Record payment" : "⚡ Pay now";
    form.querySelectorAll("#ppHow label").forEach(l=> l.classList.toggle("act", l.querySelector("input").checked)); });
  form.onsubmit = async e=>{ e.preventDefault(); const err = document.getElementById("ppErr"), amt = Math.round(+form.amt.value||0), how = form.how.value;
    err.textContent = "";
    if(amt<=0 || amt>left){ err.textContent = `Enter an amount up to ${payInr(left)}.`; return; }
    if(how==="manual" && !form.utr.value.trim() && !(form.proof.files||[]).length){ err.textContent = "Add the UTR or a screenshot of the payment."; return; }
    if(how==="razorpay" && !await confirmChange(`Pay ${payInr(amt)} to ${payWho(r)} through Razorpay`, `To ${p.method==="upi"?"UPI "+p.upi_id:"bank a/c ••"+p.account_last4}. Money leaves your RazorpayX account right away.`)) return;
    sub.disabled = true; sub.textContent = "Saving…";
    try{
      const path = how==="manual" ? await payUploadProof(r.participation_id, form.proof.files[0]) : null;
      const { data, error } = await payRpc("payout_pay", { p_participation: r.participation_id, p_amount: amt, p_how: how,
        p_utr: how==="manual" ? (form.utr.value.trim()||null) : null, p_paid_on: how==="manual" ? (form.on.value||null) : null,
        p_note: how==="manual" ? (form.note.value.trim()||null) : null, p_proof_path: path });
      if(error) throw error;
      m.remove(); gateToast(how==="razorpay" ? `⚡ ${payInr(amt)} sent to Razorpay ✓ — the UTR shows here when it lands` : `Recorded ${payInr(amt)} ✓ — the creator was told${data && +data.left>0?` · ${payInr(data.left)} left`:""}`);
      loadPayments();
    }catch(ex){ err.textContent = payErr(ex); sub.disabled = false; sub.textContent = how==="manual" ? "Record payment" : "⚡ Pay now"; } };
}
/* ---- pay many: RazorpayX API (queued → worker) ---- */
async function payViaRazorpay(){
  const outs = paySelected(); if(!outs.length) return;
  const tot = outs.reduce((a,o)=> a + (+o.amount||0), 0);
  if(!await confirmChange(`Pay ${outs.length} creator payment${outs.length>1?"s":""} — ${payInr(tot)} — through Razorpay`,
      "Money leaves your RazorpayX account right away (IMPS / UPI). Each creator is told with the UTR once it lands.")) return;
  const { data, error } = await payRpc("payout_queue", { p_payouts: outs.map(o=> o.payout_id) });
  if(error){ gateToast(payErr(error)); return; }
  const bad = (data && data.errors) || [];
  _pay.sel.clear();
  gateToast(`⚡ ${data.queued} payment${data.queued===1?"":"s"} sent to RazorpayX (${payInr(data.total)})${bad.length?` · ${bad.length} skipped`:""} ✓`);
  if(bad.length) alert("Skipped:\n" + bad.map(x=> x.error).join("\n"));
  loadPayments();
}
/* ---- pay many: the RazorpayX dashboard bulk-payout file ---- */
async function payBulkFile(){
  const outs = paySelected(); if(!outs.length) return;
  const tot = outs.reduce((a,o)=> a + (+o.amount||0), 0);
  if(!await confirmChange(`Make the RazorpayX bulk-payout file — ${outs.length} payment${outs.length>1?"s":""}, ${payInr(tot)}`,
      "They are marked “sent” here. Upload the file on RazorpayX → Payouts → Bulk, approve with OTP, then ⬆ Import the RazorpayX report here so each creator gets their UTR. Not uploaded? Use ↺ Back to due.")) return;
  const { data, error } = await payRpc("payout_export", { p_payouts: outs.map(o=> o.payout_id) });
  if(error){ gateToast(payErr(error)); return; }
  const rows = (data && data.rows) || [], stamp = new Date().toISOString().slice(0,10);
  const narr = x => ("Geek " + (x.campaign||"")).replace(/[^A-Za-z0-9 ]/g,"").slice(0,30);
  const bank = rows.filter(x=> x.method==="bank").map(x=> ({ "Bene Name": x.account_name, "Bene Account number": x.account_no, "IFSC": x.ifsc,
      "Payout Amount": Math.round(+x.amount), "Payout Mode": +x.amount > 200000 ? "NEFT" : "IMPS", "Payout Narration": narr(x), "Phone number": String(x.phone||"").replace(/\D/g,"").slice(-10),
      "Email ID": "", "Contact reference ID": x.handle ? "@"+x.handle : "", "Payout reference ID": x.ref_code }));
  const upi = rows.filter(x=> x.method==="upi").map(x=> ({ "Bene Name": x.account_name, "Bene UPI ID": x.upi_id, "Payout Amount": Math.round(+x.amount),
      "Payout Mode": "UPI", "Payout Narration": narr(x), "Phone number": String(x.phone||"").replace(/\D/g,"").slice(-10), "Email ID": "",
      "Contact reference ID": x.handle ? "@"+x.handle : "", "Payout reference ID": x.ref_code }));
  const slug = String(_bpCamp.name||"campaign").replace(/[^A-Za-z0-9]+/g,"-").slice(0,40);
  if(bank.length) downloadBlob(toCsv(bank), `razorpayx-bulk-bank-${slug}-${stamp}.csv`, "text/csv");
  if(upi.length) setTimeout(()=> downloadBlob(toCsv(upi), `razorpayx-bulk-upi-${slug}-${stamp}.csv`, "text/csv"), 400);
  _pay.sel.clear();
  const bad = (data && data.errors) || [];
  gateToast(`⬇ RazorpayX file ready — ${rows.length} payment${rows.length===1?"":"s"}${bank.length&&upi.length?" (2 files: bank + UPI)":""} ✓`);
  if(bad.length) alert("Skipped:\n" + bad.map(x=> x.error).join("\n"));
  bpModal("Next: upload it on RazorpayX", `<div class="modal-form"><ol class="pay-steps">
      <li>RazorpayX dashboard → <b>Payouts → Bulk → + Bulk Payouts</b>, pick the ${bank.length&&upi.length?"bank and the UPI":upi.length?"UPI":"bank account"} template.</li>
      <li>If RazorpayX's template has different column names, copy each column of this file into the matching one (amounts are in ₹).</li>
      <li>Upload, choose the purpose (<b>Payout</b>) and your account, confirm with the OTP.</li>
      <li>When it's processed, download the <b>batch report</b> and use <b>⬆ Import RazorpayX report</b> here — every creator gets their UTR.</li></ol>
      <div class="muted" style="font-size:12px">The file has full account numbers — delete it from Downloads after uploading.</div></div>`);
  loadPayments();
}
/* ---- the RazorpayX report back (UTRs) ---- */
function payImportModal(){
  const m = bpModal("⬆ Import the RazorpayX report", `<div class="modal-form">
    <p class="muted" style="margin:0">The batch / payouts report from RazorpayX (.csv or .xlsx). Rows are matched on <b>Payout reference ID</b> (GEEK…); processed ones become paid with their UTR and the creator is told.</p>
    <input type="file" id="piFile" accept=".csv,.xlsx,.xls">
    <div class="auth-err" id="piErr"></div><div id="piOut"></div></div>`);
  m.querySelector("#piFile").onchange = async e=>{
    const err = document.getElementById("piErr"), out = document.getElementById("piOut"); err.textContent = ""; out.innerHTML = "";
    try{
      const rows = await bkReadFile(e.target.files[0]); if(!rows || rows.length < 2) throw new Error("No rows in that file.");
      const hi = rows.findIndex(r=> r.some(c=> /reference/i.test(c))); if(hi<0) throw new Error("Couldn't find a “Payout reference ID” column.");
      const head = rows[hi].map(h=> String(h||"").toLowerCase());
      const col = re => head.findIndex(h=> re.test(h));
      const iRef = head.findIndex(h=> /payout ?reference|reference ?id/.test(h) && !/contact/.test(h)), iUtr = col(/\butr\b/), iSt = col(/^status$|payout status|^status /), iWhy = col(/reason|failure|status ?details|description/);
      if(iRef<0) throw new Error("Couldn't find the “Payout reference ID” column.");
      const data = rows.slice(hi+1).map(r=> ({ ref: String(r[iRef]||"").trim(), utr: iUtr>=0 ? String(r[iUtr]||"").trim() : "", status: iSt>=0 ? String(r[iSt]||"").trim() : "", reason: iWhy>=0 ? String(r[iWhy]||"").trim() : "" }))
        .filter(x=> /^GEEK[0-9A-F]{6,}$/i.test(x.ref));
      if(!data.length) throw new Error("No GEEK… payment references in that file — is it the report of the file made here?");
      const { data:res, error } = await payRpc("payout_import_results", { p_rows: data });
      if(error) throw error;
      out.innerHTML = `<div class="hub-ok">✓ ${res.paid} paid · ${res.failed} failed · ${res.not_found} not found</div>`;
      loadPayments();
    }catch(ex){ err.textContent = payErr(ex); }
  };
}
/* ---- fees (+ details) for creators already on the campaign, from a sheet ---- */
const PAY_COLS = [["handle",/insta|handle|username|^ig\b|profile/],["phone",/whats ?app|phone|mobile/],["email",/e-?mail/],["name",/^(full ?name|name|creator( name)?)$/],
  ["fee",/^(?!.*(advance|%|day|term|note|mode|status|upi|account|ifsc|bank)).*(fee|amount|commercial|price|rate|charge|budget|deal|payment)/],
  ["advance_pct",/advance/],["pay_days",/days/],["pay_terms",/terms|note/],["upi",/upi|vpa/],
  ["account_no",/^(?!.*(name|holder|type)).*(a\/?c|account)/],["ifsc",/ifsc/],["account_name",/holder|account ?name|beneficiary|bene ?name|name (as )?(in|on|per) bank/]];
function payUploadModal(){
  const m = bpModal("📥 Upload fees for this campaign's creators", `<div class="modal-form">
    <p class="muted" style="margin:0">A sheet (.xlsx / .csv / Google Sheet download) with one row per creator already on this campaign — matched on <b>Instagram</b>, <b>WhatsApp</b> or <b>email</b>.
      Columns: <b>Fee</b> · <b>Advance %</b> · <b>Pay days</b> (after the posts) · <b>Terms</b> · and optionally <b>UPI</b> or <b>Account no</b> + <b>IFSC</b> + <b>Account holder</b>.
      Contracts that were waiting go out with the fee. (New creators? Use 📥 Bulk upload — the same columns work there.)</p>
    <input type="file" id="puFile" accept=".csv,.xlsx,.xls">
    <div id="puPrev"></div><div class="auth-err" id="puErr"></div></div>`);
  let rows = null;
  m.querySelector("#puFile").onchange = async e=>{
    const err = document.getElementById("puErr"), pv = document.getElementById("puPrev"); err.textContent = ""; pv.innerHTML = "";
    try{
      const all = await bkReadFile(e.target.files[0]); if(!all || all.length<2) throw new Error("No rows in that file.");
      const head = all[0].map(h=> String(h||"").trim().toLowerCase()), used = new Set(), map = {};
      PAY_COLS.forEach(([k,re])=>{ const i = head.findIndex((h,ix)=> !used.has(ix) && re.test(h)); if(i>=0){ map[k] = i; used.add(i); } });
      if(map.fee==null && map.upi==null && map.account_no==null) throw new Error("Couldn't find a Fee (or UPI / Account no) column.");
      if(map.handle==null && map.phone==null && map.email==null) throw new Error("Add an Instagram, WhatsApp or email column to match the creators.");
      rows = all.slice(1).filter(r=> r.some(Boolean)).map((r,i)=>{ const o = { i: String(i+2) }; Object.entries(map).forEach(([k,ix])=> o[k] = String(r[ix]||"").trim()); return o; });
      pv.innerHTML = `<div class="muted" style="margin:6px 0">Found <b>${rows.length}</b> rows · columns: ${Object.keys(map).map(k=>`<span class="tag">${esc(k.replace("_"," "))}</span>`).join(" ")}</div>
        <table class="pay-tbl"><tr><th>Row</th><th>Creator</th><th>Fee</th><th>Advance</th><th>Days</th><th>Pay to</th></tr>${rows.slice(0,8).map(x=>`<tr><td>${esc(x.i)}</td><td>${esc(x.handle||x.phone||x.email||"")}</td><td>${esc(x.fee||"")}</td><td>${esc(x.advance_pct||"")}</td><td>${esc(x.pay_days||"")}</td><td>${esc(x.upi||(x.account_no?"a/c ••"+x.account_no.slice(-4):""))}</td></tr>`).join("")}</table>
        ${rows.length>8?`<div class="muted">…and ${rows.length-8} more</div>`:""}
        <button class="btn" id="puGo" style="margin-top:8px">Save ${rows.length} fee${rows.length===1?"":"s"}</button>`;
      document.getElementById("puGo").onclick = async ()=>{ const b = document.getElementById("puGo"); b.disabled = true; b.textContent = "Saving…";
        const { data, error } = await payRpc("payment_bulk_terms", { p_campaign: _bpCamp.id, p_rows: rows });
        if(error){ err.textContent = payErr(error); b.disabled = false; b.textContent = "Try again"; return; }
        const bad = data.errors||[];
        pv.innerHTML = `<div class="hub-ok">✓ ${data.updated} updated${data.not_found?` · ${data.not_found} not on this campaign`:""}${bad.length?` · ${bad.length} with a problem`:""}</div>`
          + (bad.length?`<div class="muted" style="font-size:12.5px">${bad.slice(0,20).map(x=>`Row ${esc(x.row||"?")}: ${esc(x.error)}`).join("<br>")}</div>`:"");
        loadPayments(); if(typeof loadBarterProcess==="function") loadBarterProcess(true); };
    }catch(ex){ err.textContent = payErr(ex); }
  };
}
function payCsv(){
  const rows = payRows().map(r=>{ const p = r.payment||{}, po = p.payouts||[], g = part => po.find(o=> o.part===part) || {};
    const adv = g("advance"), bal = po.find(o=> o.part==="balance" || o.part==="full") || {};
    return { creator: payWho(r), name: r.name||"", stage: r.stage, fee: p.amount ?? "", advance_pct: p.advance_pct ?? "", pay_days: p.due_days ?? "", terms: p.terms_note||"",
      method: p.method||"", pay_to: p.method==="upi" ? p.upi_id : p.method==="bank" ? "a/c ••"+(p.account_last4||"")+" "+(p.ifsc||"") : "", details: p.details_status||"",
      advance: adv.amount ?? "", advance_status: adv.status||"", advance_utr: adv.utr||"",
      balance: bal.amount ?? "", balance_status: bal.status||"", balance_due: bal.due_at||"", balance_utr: bal.utr||"", on_hold: p.on_hold ? (p.hold_reason||"yes") : "" }; });
  downloadBlob(toCsv(rows), `payments-${String(_bpCamp.name||"campaign").replace(/[^A-Za-z0-9]+/g,"-").slice(0,40)}-${new Date().toISOString().slice(0,10)}.csv`, "text/csv");
}
/* ---- a creator's agreed fees on their profile (Super Admins) ---- */
async function payFillRates(sel, args, thisPid){
  let el = null; for(let i=0; i<15 && !(el = document.querySelector(sel)); i++) await new Promise(r=> setTimeout(r, 200));
  if(!el || !window.__isAdmin) return;
  const { data, error } = await payRpc("creator_rates", args);
  if(error){ el.textContent = "—"; return; }
  const L = (data && data.list) || [];
  if(!L.length){ el.innerHTML = `<span class="muted">No paid campaign with Geek yet</span>`; return; }
  const first = L[0], cur = thisPid ? null : L[L.length-1];
  el.innerHTML = `<div>First: <b>${payInr(first.amount)}</b> · ${esc(first.campaign||"")} <span class="muted">(${esc(fmtDate(first.agreed_at))}${first.deliverables?" · "+esc(first.deliverables):""})</span></div>`
    + (L.length>1 ? `<div>Latest: <b>${payInr((cur||L[L.length-1]).amount)}</b> · ${esc((cur||L[L.length-1]).campaign||"")} · ${L.length} paid campaigns, ${payInr(L.reduce((a,x)=>a+(+x.paid||0),0))} paid in total</div>` : "")
    + `<details class="pay-rates"><summary class="muted">All fees</summary>${L.map(x=>`<div>${payInr(x.amount)} · ${esc(x.campaign||"")}${x.story?" · ⭐ Story":""}${x.advance_pct?` · ${x.advance_pct}% advance`:""} <span class="muted">${esc(fmtDate(x.agreed_at))}${x.deliverables?" · "+esc(x.deliverables):""}</span></div>`).join("")}</details>`;
}
window.payFillRates = payFillRates;
