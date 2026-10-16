// Media kit — Audience section as charts (used by the app's Media Kit and the public kit page p.html).
// Instagram follower_demographics, stored on social_accounts.audience:
//   gender_age { "F · 18-24": n, "M · 25-34": n, "U · 13-17": n }, country { "IN": n }, city { "Mumbai, Maharashtra": n }
(function(){
  var AGES = ["13-17","18-24","25-34","35-44","45-54","55-64","65+"];
  var G = { F:{ label:"Women", cls:"w" }, M:{ label:"Men", cls:"m" }, U:{ label:"Other", cls:"u" } };
  function esc(v){ return String(v==null?"":v).replace(/[&<>"']/g,function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
  function pct(v,t){ return t ? Math.round(1000*v/t)/10 : 0; }
  function fmtPct(p){ return (p>=10||p===0 ? Math.round(p) : p.toFixed(1)) + "%"; }
  var regionName = (function(){
    try{ var dn = new Intl.DisplayNames(["en"], { type:"region" }); return function(c){ try{ return dn.of(String(c).toUpperCase()) || c; }catch(e){ return c; } }; }
    catch(e){ return function(c){ return c; }; }
  })();
  function sum(o){ return Object.keys(o||{}).reduce(function(s,k){ return s+(Number(o[k])||0); },0); }

  function parseGA(ga){
    var cells = {}, byG = { F:0, M:0, U:0 }, ages = {};
    Object.keys(ga||{}).forEach(function(k){
      var v = Number(ga[k])||0; if(!v) return;
      var m = /^\s*([A-Za-z])[^0-9]*(.*)$/.exec(String(k)) || [];        // "F · 18-24" / "F.18-24"
      var g = String(m[1]||"").toUpperCase(), a = String(m[2]||"").trim();
      if(!G[g]) g = "U";
      if(AGES.indexOf(a) < 0) a = a || "?";
      cells[a] = cells[a] || { F:0, M:0, U:0 }; cells[a][g] += v; byG[g] += v; ages[a] = 1;
    });
    var order = AGES.filter(function(a){ return ages[a]; }).concat(Object.keys(ages).filter(function(a){ return AGES.indexOf(a)<0; }));
    return { cells:cells, byG:byG, ages:order };
  }

  function genderSplit(byG, total){
    var keys = ["F","M","U"].filter(function(g){ return byG[g] > 0; });
    var seg = keys.map(function(g){ var p = pct(byG[g], total);
      return '<span class="aud-seg aud-'+G[g].cls+'" style="flex:'+byG[g]+'" title="'+G[g].label+': '+fmtPct(p)+'"></span>'; }).join("");
    var lab = keys.map(function(g){ return '<span class="aud-key"><i class="aud-dot aud-'+G[g].cls+'"></i>'+G[g].label+' <b>'+fmtPct(pct(byG[g], total))+'</b></span>'; }).join("");
    return '<div class="aud-split" role="img" aria-label="Gender split">'+seg+'</div><div class="aud-keys">'+lab+'</div>';
  }

  function ageChart(p, total){
    var showU = p.byG.U > 0;
    var max = 0; p.ages.forEach(function(a){ ["F","M","U"].forEach(function(g){ max = Math.max(max, p.cells[a][g]); }); });
    var top = p.ages.slice().sort(function(a,b){ var s=function(x){ return p.cells[x].F+p.cells[x].M+p.cells[x].U; }; return s(b)-s(a); })[0];
    var cols = p.ages.map(function(a){
      var c = p.cells[a], all = c.F+c.M+c.U;
      var bars = ["F","M"].concat(showU?["U"]:[]).map(function(g){
        var h = max ? Math.max(c[g] ? 3 : 0, Math.round(100*c[g]/max)) : 0;
        return '<span class="aud-vbar aud-'+G[g].cls+'" style="height:'+h+'%" data-tip="'+esc(a)+' · '+G[g].label+': '+fmtPct(pct(c[g], total))+'"></span>';
      }).join("");
      return '<div class="aud-col'+(a===top?' top':'')+'"><div class="aud-val">'+fmtPct(pct(all,total))+'</div><div class="aud-bars">'+bars+'</div><div class="aud-age">'+esc(a)+'</div></div>';
    }).join("");
    return '<div class="aud-chart" role="img" aria-label="Followers by age and gender">'+cols+'</div>';
  }

  function tableView(p, total){
    var r = function(a,b){ return '<tr><td>'+esc(a)+'</td><td>'+esc(b)+'</td></tr>'; };
    var rows = p.ages.map(function(a){ var c=p.cells[a]; return r(a, "Women "+fmtPct(pct(c.F,total))+" · Men "+fmtPct(pct(c.M,total))+(c.U?" · Other "+fmtPct(pct(c.U,total)):"")); }).join("");
    return '<details class="aud-table"><summary>Show as table</summary><table class="mk-rates"><tbody>'+rows+'</tbody></table></details>';
  }

  window.mkAudienceHtml = function(aud){
    aud = (aud && typeof aud === "object") ? aud : {};
    var ga = aud.gender_age || {}, total = sum(ga), p = parseGA(ga);
    var C = aud.country && sum(aud.country) ? hbarsNamed(aud.country, 5, "Top countries", regionName) : "";
    var Ci = aud.city && sum(aud.city) ? hbarsNamed(aud.city, 6, "Top cities", function(x){ return String(x).split(",")[0]; }) : "";
    if(!total && !C && !Ci) return "";
    var out = '<div class="aud'+((total && (C||Ci)) ? '' : ' one')+'">';
    if(total){
      out += '<div class="aud-main">';
      out += '<div class="aud-block"><div class="mk-sub">Gender</div>'+genderSplit(p.byG, total)+'</div>';
      out += '<div class="aud-block"><div class="aud-head"><div class="mk-sub">Age &amp; gender</div><div class="aud-keys sm">'
          + '<span class="aud-key"><i class="aud-dot aud-w"></i>Women</span><span class="aud-key"><i class="aud-dot aud-m"></i>Men</span>'
          + (p.byG.U ? '<span class="aud-key"><i class="aud-dot aud-u"></i>Other</span>' : '') + '</div></div>'
          + ageChart(p, total) + tableView(p, total) + '</div></div>';
    }
    if(C || Ci) out += '<div class="aud-geo">'+C+Ci+'</div>';
    return out + '</div>';
  };
  function hbarsNamed(obj, k, title, name){
    var total = sum(obj);
    var rows = Object.keys(obj).map(function(x){ return [x, Number(obj[x])||0]; }).sort(function(a,b){ return b[1]-a[1]; }).slice(0,k);
    var max = rows.length ? rows[0][1] : 1;
    return '<div class="aud-block"><div class="mk-sub">'+title+'</div>'+rows.map(function(r){
      var p = pct(r[1], total), n = name(r[0]);
      return '<div class="aud-hrow" data-tip="'+esc(n)+': '+fmtPct(p)+'"><span class="aud-hl" title="'+esc(r[0])+'">'+esc(n)+'</span><span class="aud-htrack"><span style="width:'+Math.max(2, Math.round(100*r[1]/max))+'%"></span></span><span class="aud-hv">'+fmtPct(p)+'</span></div>';
    }).join("")+'</div>';
  }

  // one floating tooltip for every chart mark with data-tip
  if(!window.__audTip){
    window.__audTip = true;
    document.addEventListener("mouseover", function(e){
      var t = e.target && e.target.closest ? e.target.closest("[data-tip]") : null;
      var tip = document.getElementById("audTip");
      if(!t){ if(tip) tip.style.display = "none"; return; }
      if(!tip){ tip = document.createElement("div"); tip.id = "audTip"; tip.className = "aud-tip"; document.body.appendChild(tip); }
      tip.textContent = t.getAttribute("data-tip"); tip.style.display = "block";
      var r = t.getBoundingClientRect();
      tip.style.left = Math.min(window.innerWidth - tip.offsetWidth - 8, Math.max(8, r.left + r.width/2 - tip.offsetWidth/2)) + "px";
      tip.style.top = Math.max(8, r.top - tip.offsetHeight - 8) + "px";
    });
    document.addEventListener("scroll", function(){ var tip = document.getElementById("audTip"); if(tip) tip.style.display = "none"; }, true);
  }
})();
