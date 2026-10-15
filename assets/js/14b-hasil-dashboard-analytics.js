/* =========================================================
   HASIL PEMANTAUAN — Dashboard analytics (redesign)
   ---------------------------------------------------------
   Lapisan analitik di atas filter Dashboard Hasil Emisi (14-hasil-dashboard.js): hero + tab
   parameter, narasi ringkasan otomatis, KPI, Trend multi-mode, Distribution %BM, Priority
   Watchlist, Heatmap, Profil per Jenis Sumber, Running Hour (trend, korelasi vs emisi, utilisasi),
   dan Engine Trend Scorecard. Semua builder menerima satu objek konteks (hdBuildContext) supaya
   filter dihitung sekali per render, bukan berulang di tiap chart.
========================================================= */

// Preferensi tampilan, reset saat reload (sama seperti state UI dashboard lain di app ini).
let hdTrendMode = null;          // null = otomatis (per engine kalau ada titik dicentang, selain itu per site)
let hdHeatMode = "site";         // "site" | "engine"
let hdRhGran = "semester";       // "semester" | "month"
let hdScoreSort = "pct";         // "pct" | "delta" | "name"
let hdScoreShowAll = false;
let hdRhShowAll = false;

// Zona relatif terhadap baku mutu. Batas 70% dipakai sebagai Early Warning: titik yang masih patuh
// tetapi sudah cukup dekat ke ambang sehingga layak dijadwalkan inspeksi sebelum periode berikutnya.
const HD_ZONES = {
  safe:   {label:"Normal",        range:"di bawah 50%",  color:"#7fb3ad", tint:"rgba(127,179,173,.14)"},
  watch:  {label:"Watch",         range:"50 sampai 70%", color:"#e2b45a", tint:"rgba(226,180,90,.16)"},
  warn:   {label:"Early Warning", range:"70 sampai 100%",color:"#c2620a", tint:"rgba(194,98,10,.13)"},
  exceed: {label:"Exceedance",    range:"di atas 100%",  color:"#b42318", tint:"rgba(180,35,24,.12)"}
};
function hdZoneOf(pct, status){
  if(status==="exceed" || (pct!=null && pct>100)) return "exceed";
  if(pct==null) return null;
  return pct>=70 ? "warn" : pct>=50 ? "watch" : "safe";
}
function hdNum(v, d){
  if(v==null || !isFinite(v)) return "-";
  const digits = d==null ? (Math.abs(v)>=100 ? 0 : Math.abs(v)>=10 ? 1 : Math.abs(v)>=1 ? 2 : 4) : d;
  return Number(v).toLocaleString("id-ID", {maximumFractionDigits:digits});
}
function hdPct(v, d){ return v==null || !isFinite(v) ? "-" : hdNum(v, d==null?1:d)+"%"; }
function hdSignedPct(v){
  if(v==null || !isFinite(v)) return "-";
  const s = Math.abs(v)<0.05 ? "" : v>0 ? "+" : "−";
  return s+hdNum(Math.abs(v),1)+"%";
}
function hdMean(a){ return a.length ? a.reduce((x,y)=>x+y,0)/a.length : null; }
function hdMedian(a){ if(!a.length) return null; const s=[...a].sort((x,y)=>x-y); return s[Math.floor(s.length/2)]; }
function hdSortPeriods(list){ return [...new Set(list)].sort((a,b)=>hasilPeriodParts(a).order-hasilPeriodParts(b).order); }
function hdTrunc(s, n){ s = String(s||""); return s.length>n ? s.slice(0,n-1)+"…" : s; }
function hdSiteColor(s){ return HASIL_SITE_COLORS[s] || "#7f8fa0"; }
// Tick sumbu Y yang "bulat" (1, 2, 2.5, 5 x 10^n) supaya label sumbu enak dibaca.
function hdNiceMax(max){
  if(!(max>0)) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(max)));
  const f = max/exp;
  const nf = [1,1.2,1.5,2,2.5,3,4,5,6,8,10].find(x=>f<=x+1e-9);
  return nf*exp;
}
const HD_IC = {
  shield:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>',
  alert:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  clock:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 7 12 12 15 15"/></svg>',
  trend:'<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>',
  db:'<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.7-4 3-9 3s-9-1.3-9-3"/><path d="M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5"/></svg>',
  gauge:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 14l4-4"/><path d="M3.3 19a10 10 0 1 1 17.4 0"/></svg>',
  spark:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l3 6 6 .9-4.5 4.3 1 6.3L12 16.8 6.5 19.5l1-6.3L3 8.9 9 8z"/></svg>'
};

/* ---------------- Running Hour helpers ---------------- */
// Running Hour per semester diambil dari data bulanan engine (DB.rhMonthly, menu Running Hour
// Detail), BUKAN dari kolom runningHour di rekaman hasil — kolom itu diisi lab dengan basis yang
// tidak seragam (kadang 1 tahun ke belakang, kadang sejak overhaul), jadi tidak bisa dibandingkan.
function hdRhSemester(cerobong, periode){
  const pp = parsePeriod(periode);
  if(!pp || !DB.rhMonthly || !DB.rhMonthly[cerobong]) return null;
  return semesterRhSum(cerobong, pp.sem, pp.year);
}
function hdSemesterHours(periode){
  const pp = parsePeriod(periode); if(!pp) return null;
  const start = Date.UTC(pp.year, pp.sem===1?0:6, 1), end = Date.UTC(pp.year, pp.sem===1?6:12, 1);
  return Math.round((end-start)/36e5);
}
// Engine/titik pada cakupan filter non-periode (site, jenis sumber, titik, regulasi, kapasitas).
function hdScopeEngines(){
  const permen = document.getElementById("hdFltPermen")?.value || "";
  const kapasitas = document.getElementById("hdFltKapasitas")?.value || "";
  const map = new Map();
  DB.hasilPemantauan.forEach(r=>{
    if(hdSel.site.size && !hdSel.site.has(r.site)) return;
    if(hdSel.sumber.size && !hdSel.sumber.has(r.namaSumber)) return;
    if(hdSel.cerobong.size && !hdSel.cerobong.has(r.cerobong)) return;
    if(permen && r.regulasiCek!==permen) return;
    if(kapasitas && r.kategoriKapasitas!==kapasitas) return;
    if(!map.has(r.cerobong)) map.set(r.cerobong, {cerobong:r.cerobong, site:r.site, sumber:r.namaSumber});
  });
  return [...map.values()];
}

/* ---------------- Konteks render ---------------- */
function hdBuildContext(filtered, filteredAllParams, periodsInScope){
  const parameter = document.getElementById("hdFltParameter")?.value || "";
  const from = document.getElementById("hdFltPeriodeFrom")?.value, to = document.getElementById("hdFltPeriodeTo")?.value;
  const fromOrder = from ? hasilPeriodParts(from).order : -Infinity, toOrder = to ? hasilPeriodParts(to).order : Infinity;
  const rangePeriods = hdSortPeriods(DB.hasilPemantauan.filter(r=>r.periodeOrder>=fromOrder && r.periodeOrder<=toOrder).map(r=>r.periode));
  const numeric = filtered.filter(r=>r.resultNumeric!=null);
  const hasStd = filtered.some(r=>r.pctOfStandard!=null);
  const last = periodsInScope[periodsInScope.length-1] || null;
  const prev = periodsInScope.length>1 ? periodsInScope[periodsInScope.length-2] : null;
  const byKey = {};
  filtered.forEach(r=>{ const k = r.cerobong+"||"+r.periode; if(!byKey[k] || (r.resultNumeric!=null && byKey[k].resultNumeric==null)) byKey[k] = r; });
  const engines = hdScopeEngines();
  return {
    parameter, from, to, filtered, all: filteredAllParams, numeric, periods: periodsInScope, rangePeriods,
    hasStd, last, prev, byKey,
    unit: (numeric[0]||filtered[0])?.unit || "",
    stdRef: hdMedian(filtered.map(r=>r.standard).filter(v=>v!=null)),
    lastRows: last ? filtered.filter(r=>r.periode===last) : [],
    prevRows: prev ? filtered.filter(r=>r.periode===prev) : [],
    engines, rhEngines: engines.filter(e=>DB.rhMonthly && DB.rhMonthly[e.cerobong])
  };
}
function hdPeriodStat(rows){
  const evalRows = rows.filter(r=>r.statusBakuMutu==="ok"||r.statusBakuMutu==="exceed");
  const ok = rows.filter(r=>r.statusBakuMutu==="ok").length;
  const exceed = rows.filter(r=>r.statusBakuMutu==="exceed").length;
  const pcts = rows.map(r=>r.pctOfStandard).filter(v=>v!=null);
  const vals = rows.map(r=>r.resultNumeric).filter(v=>v!=null);
  const warnSet = new Set(rows.filter(r=>hdZoneOf(r.pctOfStandard, r.statusBakuMutu)==="warn").map(r=>r.cerobong));
  return {n:rows.length, evalN:evalRows.length, ok, exceed, warn:warnSet.size,
    compliance: evalRows.length ? ok/evalRows.length*100 : null,
    avgPct: hdMean(pcts), avgVal: hdMean(vals), maxVal: vals.length?Math.max(...vals):null, measured: vals.length};
}
function hdRhTotal(ctx, periode){
  let sum = 0, any = false;
  ctx.rhEngines.forEach(e=>{ const v = hdRhSemester(e.cerobong, periode); if(v!=null){ sum += v; any = true; } });
  return any ? sum : null;
}

/* ---------------- Sparkline & toggle kecil ---------------- */
function hdSpark(values, opts){
  opts = opts||{};
  const w = opts.w||110, h = opts.h||34, color = opts.color||"currentColor";
  const pts = values.map((v,i)=>v==null?null:[i,v]).filter(Boolean);
  if(pts.length<2 && !opts.bars) return "";
  const vals = pts.map(p=>p[1]);
  const lo = opts.zero ? 0 : Math.min(...vals), hi = Math.max(...vals, opts.ref||-Infinity);
  const range = (hi-lo) || Math.abs(hi) || 1;
  const step = values.length>1 ? (w-8)/(values.length-1) : 0;
  const x = i=>4+i*step, y = v=>h-4-((v-lo)/range)*(h-8);
  const label = opts.label ? ` role="img" aria-label="${escHtml(opts.label)}"` : ` aria-hidden="true"`;
  if(opts.bars){
    const bw = Math.max(4, Math.min(16, (w-8)/values.length-4));
    return `<svg class="hd-spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"${label}>${values.map((v,i)=>{
      if(v==null) return "";
      const bh = Math.max(2, (v/(hi||1))*(h-6));
      const bx = values.length>1 ? 4+i*((w-8-bw)/(values.length-1)) : (w-bw)/2;
      return `<rect x="${bx.toFixed(1)}" y="${(h-2-bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="2" fill="${color}" opacity="${i===values.length-1?1:.45}"/>`;
    }).join("")}</svg>`;
  }
  const d = pts.map(([i,v],k)=>`${k?"L":"M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const [li,lv] = pts[pts.length-1];
  return `<svg class="hd-spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"${label}><path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${x(li).toFixed(1)}" cy="${y(lv).toFixed(1)}" r="3" fill="${color}"/></svg>`;
}
function hdSeg(action, current, options){
  return `<div class="hd-seg-group" role="group">${options.map(([val,label])=>
    `<button type="button" class="${val===current?"on":""}" aria-pressed="${val===current}" data-action="${action}" data-val="${escHtml(val)}">${escHtml(label)}</button>`).join("")}</div>`;
}
function hdEmpty(msg){ return `<div class="hd-empty">${msg}</div>`; }

/* ---------------- Hero & tab parameter ---------------- */
function hdRenderHero(){
  const meta = document.getElementById("hdHeroMeta");
  if(meta){
    const upd = DB.meta?.datasetUpdatedAt?.hasilPemantauan;
    const dt = upd ? new Date(upd) : null;
    const nTitik = new Set(DB.hasilPemantauan.map(r=>r.cerobong)).size;
    const dateTxt = dt && !isNaN(dt) ? dt.toLocaleDateString("id-ID",{day:"numeric",month:"short",year:"numeric"}) : "";
    meta.innerHTML = `<span class="dot" aria-hidden="true"></span>${dateTxt?`Data per ${escHtml(dateTxt)} &middot; `:""}${hdNum(DB.hasilPemantauan.length,0)} baris &middot; ${nTitik} titik`;
  }
  const tabs = document.getElementById("hdParamTabs");
  if(!tabs) return;
  const cur = document.getElementById("hdFltParameter")?.value || "";
  const all = hasilDashboardFilteredAllParams();
  const count = {}; all.forEach(r=>{ count[r.parameter] = (count[r.parameter]||0)+1; });
  const params = hdAllValues("parameter");
  const emisi = params.filter(hdIsEmisiParam).sort((a,b)=>(count[b]||0)-(count[a]||0));
  const pendukung = params.filter(p=>!hdIsEmisiParam(p));
  const isPendukung = pendukung.includes(cur);
  tabs.innerHTML = emisi.map(p=>`<button type="button" role="tab" class="hd-tab ${p===cur?"on":""}" aria-selected="${p===cur}" data-action="hdSetParam" data-val="${escHtml(p)}">${escHtml(p)} <span class="n">${count[p]||0}</span></button>`).join("")
    + `<span class="hd-tab-sep" aria-hidden="true"></span>
       <label class="hd-tab-support ${isPendukung?"on":""}"><span>Supporting parameter</span>
         <select id="hdTabSupport" aria-label="Parameter pendukung">
           <option value="">${isPendukung?"Pilih":"O₂, CO₂, suhu, laju alir"}</option>
           ${pendukung.map(p=>`<option value="${escHtml(p)}" ${p===cur?"selected":""}>${escHtml(p)} (${count[p]||0})</option>`).join("")}
         </select></label>`;
}

/* ---------------- Narasi ringkasan otomatis ---------------- */
function buildHdInsight(ctx){
  if(!ctx.parameter || !ctx.filtered.length) return "";
  const p = escHtml(ctx.parameter), unit = escHtml(ctx.unit);
  const sentences = [], badges = [];
  if(ctx.last){
    const st = hdPeriodStat(ctx.lastRows);
    if(ctx.hasStd){
      if(st.evalN){
        sentences.push(`Pada <b>${ctx.last}</b>, <b>${st.ok} dari ${st.evalN}</b> data ${p} yang terevaluasi memenuhi baku mutu (${hdPct(st.compliance)}).`);
      }
      const exceedRows = ctx.lastRows.filter(r=>r.statusBakuMutu==="exceed").sort((a,b)=>(b.pctOfStandard||0)-(a.pctOfStandard||0));
      if(exceedRows.length){
        const e = exceedRows[0];
        sentences.push(`<b>${exceedRows.length} data melebihi baku mutu</b>, tertinggi ${escHtml(e.cerobong)} (${escHtml(e.site)}) di ${hdPct(e.pctOfStandard)} BM.`);
        badges.push(`<span class="hd-badge bad">${exceedRows.length} exceedance</span>`);
      }else if(st.evalN) badges.push(`<span class="hd-badge good">Compliant</span>`);
      const warnRows = ctx.lastRows.filter(r=>hdZoneOf(r.pctOfStandard, r.statusBakuMutu)==="warn").sort((a,b)=>b.pctOfStandard-a.pctOfStandard);
      if(warnRows.length){
        const w = warnRows[0];
        const sumberSet = [...new Set(warnRows.map(r=>r.namaSumber))];
        sentences.push(`Namun <b>${warnRows.length} titik sudah di zona Early Warning (&ge;70% BM)</b>${sumberSet.length===1?`, semuanya ${escHtml(sumberSet[0])}`:""}, tertinggi <b>${escHtml(w.cerobong)} (${escHtml(w.site)}) di ${hdPct(w.pctOfStandard)}</b>.`);
        badges.push(`<span class="hd-badge warn">${warnRows.length} titik Early Warning</span>`);
      }else if(st.evalN){
        sentences.push(`Tidak ada titik di zona Early Warning (&ge;70% BM).`);
      }
      const ne = ctx.lastRows.filter(r=>r.statusBakuMutu==="not_evaluated").length;
      if(ne) sentences.push(`${ne} data belum dievaluasi (surat pernyataan atau tanpa baku mutu).`);
    }else{
      badges.push(`<span class="hd-badge info">Supporting parameter</span>`);
      sentences.push(`${p} adalah parameter pendukung, tidak dibandingkan dengan baku mutu. Rata-rata pada <b>${ctx.last}</b> adalah <b>${hdNum(st.avgVal)} ${unit}</b> dari ${st.measured} titik terukur.`);
    }
  }
  // Site dengan perubahan rata-rata terbesar dari periode pertama ke terakhir pada rentang aktif.
  if(ctx.periods.length>=2){
    const first = ctx.periods[0], lastP = ctx.last;
    const sites = [...new Set(ctx.numeric.map(r=>r.site))];
    const moves = sites.map(s=>{
      const a = hdMean(ctx.numeric.filter(r=>r.site===s && r.periode===first).map(r=>r.resultNumeric));
      const b = hdMean(ctx.numeric.filter(r=>r.site===s && r.periode===lastP).map(r=>r.resultNumeric));
      return (a!=null && b!=null && a>0) ? {s, a, b, ch:(b-a)/a*100, abs:b-a} : null;
    }).filter(Boolean).sort((x,y)=>y.abs-x.abs); // urut kenaikan absolut: % naik dari basis kecil (mis. 14 ke 52) menyesatkan
    if(moves.length){
      const up = moves[0];
      if(up.ch>=5) sentences.push(`Rata-rata ${p} site <b>${escHtml(up.s)} naik ${hdNum(up.ch,0)}%</b> sejak ${first}, dari ${hdNum(up.a)} menjadi ${hdNum(up.b)} ${unit}${ctx.hasStd?", sehingga layak diprioritaskan untuk inspeksi pembakaran":""}.`);
      else{
        const dn = moves[moves.length-1];
        sentences.push(`Tidak ada site yang naik signifikan sejak ${first}; penurunan terbesar ${escHtml(dn.s)} sebesar ${hdSignedPct(dn.ch)}.`);
      }
    }
  }
  if(ctx.last && ctx.rhEngines.length){
    const a = hdRhTotal(ctx, ctx.last), b = ctx.prev ? hdRhTotal(ctx, ctx.prev) : null;
    if(a!=null) sentences.push(`Total Running Hour ${ctx.rhEngines.length} engine pada cakupan ini ${hdNum(a,0)} jam di ${ctx.last}${b?` (${hdSignedPct((a-b)/b*100)} dibanding ${ctx.prev})`:""}.`);
  }
  if(!sentences.length) return "";
  return `<section class="hd-insight" aria-label="Ringkasan otomatis">
    <div class="hd-insight-ic" aria-hidden="true">${HD_IC.spark}</div>
    <div class="hd-insight-body">
      <div class="hd-insight-head"><h3>Executive Summary &middot; ${p}${ctx.last?` &middot; ${ctx.last}`:""}</h3>${badges.join("")}</div>
      <p>${sentences.join(" ")}</p>
    </div>
    <button type="button" class="btn small" data-action="hdJump" data-target="hdSecWatch">Lihat Watchlist &rarr;</button>
  </section>`;
}

/* ---------------- KPI ---------------- */
function hdKpi(o){
  return `<div class="hd-kpi ${o.tone||""}">
    <div class="hd-kpi-head"><span class="hd-kpi-label">${o.label}</span><span class="hd-kpi-ic">${o.icon||""}</span></div>
    <div class="hd-kpi-body"><span class="hd-kpi-val">${o.value}${o.suffix?`<small>${o.suffix}</small>`:""}</span>${o.spark||""}</div>
    <div class="hd-kpi-foot">${o.foot||""}</div>
  </div>`;
}
function buildHdKpis(ctx){
  if(!ctx.parameter) return "";
  const per = ctx.periods.map(p=>({p, st:hdPeriodStat(ctx.filtered.filter(r=>r.periode===p))}));
  const lastSt = per.length ? per[per.length-1].st : hdPeriodStat([]);
  const prevSt = per.length>1 ? per[per.length-2].st : null;
  const tiles = [];
  const rangeTxt = ctx.periods.length>1 ? `${ctx.periods[0]} sampai ${ctx.last}` : (ctx.last||"-");
  if(ctx.hasStd){
    const all = hdPeriodStat(ctx.filtered);
    tiles.push(hdKpi({label:"Compliance Rate", icon:HD_IC.shield,
      tone: all.compliance==null?"":all.compliance>=99.95?"good":all.compliance>=95?"warn":"bad",
      value: all.compliance==null?"-":hdPct(all.compliance, all.compliance>=99.95||all.compliance===0?0:1),
      spark: hdSpark(per.map(x=>x.st.compliance), {color:"#2f9e67", ref:100, label:"Compliance per periode: "+per.map(x=>x.p+" "+hdPct(x.st.compliance)).join(", ")}),
      foot:`${all.ok} dari ${all.evalN} data terevaluasi &middot; ${escHtml(rangeTxt)}`}));
    const exRows = ctx.filtered.filter(r=>r.statusBakuMutu==="exceed").sort((a,b)=>b.periodeOrder-a.periodeOrder);
    const lastEx = exRows[0] || DB.hasilPemantauan.filter(r=>r.parameter===ctx.parameter && r.statusBakuMutu==="exceed").sort((a,b)=>b.periodeOrder-a.periodeOrder)[0];
    tiles.push(hdKpi({label:"Exceedance", icon:HD_IC.alert, tone: exRows.length?"bad":"",
      value: hdNum(exRows.length,0), suffix: exRows.length?" data":"",
      foot: lastEx ? `Terakhir: ${escHtml(lastEx.cerobong)}, ${lastEx.periode}, ${hdNum(lastEx.resultNumeric)} ${escHtml(lastEx.unit)} (${hdPct(lastEx.pctOfStandard,0)} BM)` : "Belum pernah ada data yang melebihi baku mutu"}));
    tiles.push(hdKpi({label:"Early Warning ≥70% BM", icon:HD_IC.clock, tone: lastSt.warn?"warn":"",
      value: hdNum(lastSt.warn,0), suffix:" titik",
      spark: hdSpark(per.map(x=>x.st.warn), {bars:true, color:"#c2620a", label:"Titik Early Warning per periode: "+per.map(x=>x.p+" "+x.st.warn).join(", ")}),
      foot: ctx.last ? `Periode ${ctx.last}${prevSt?` &middot; ${ctx.prev}: ${prevSt.warn} titik`:""}` : "-"}));
    const dAvg = prevSt && prevSt.avgPct!=null && lastSt.avgPct!=null ? lastSt.avgPct-prevSt.avgPct : null;
    tiles.push(hdKpi({label:"Rata-rata % Baku Mutu", icon:HD_IC.trend,
      value: hdPct(lastSt.avgPct),
      spark: hdSpark(per.map(x=>x.st.avgPct), {color:"var(--heading-2)", label:"Rata-rata %BM per periode: "+per.map(x=>x.p+" "+hdPct(x.st.avgPct)).join(", ")}),
      foot: dAvg==null ? `Periode ${ctx.last||"-"}` : `<b class="${dAvg>0.05?"up":dAvg<-0.05?"down":""}">${dAvg>0.05?"▲":dAvg<-0.05?"▼":"•"} ${hdNum(Math.abs(dAvg),1)} poin</b> dibanding ${ctx.prev}`}));
  }else{
    const dVal = prevSt && prevSt.avgVal ? (lastSt.avgVal-prevSt.avgVal)/prevSt.avgVal*100 : null;
    const maxRec = ctx.lastRows.filter(r=>r.resultNumeric!=null).sort((a,b)=>b.resultNumeric-a.resultNumeric)[0];
    tiles.push(hdKpi({label:`Rata-rata ${escHtml(ctx.last||"")}`, icon:HD_IC.trend, value: hdNum(lastSt.avgVal), suffix:" "+escHtml(ctx.unit),
      spark: hdSpark(per.map(x=>x.st.avgVal), {color:"var(--heading-2)"}),
      foot: dVal==null ? "Parameter pendukung, tanpa baku mutu" : `${hdSignedPct(dVal)} dibanding ${ctx.prev}`}));
    tiles.push(hdKpi({label:"Nilai Tertinggi", icon:HD_IC.alert, value: maxRec?hdNum(maxRec.resultNumeric):"-", suffix:" "+escHtml(ctx.unit),
      foot: maxRec ? `${escHtml(maxRec.cerobong)} (${escHtml(maxRec.site)})` : "-"}));
  }
  const lastTitik = new Set(ctx.lastRows.map(r=>r.cerobong)).size;
  const notMeasured = ctx.lastRows.filter(r=>r.resultNumeric==null).length;
  const bdl = ctx.lastRows.filter(r=>r.resultStatus==="below_detection").length;
  const mPct = ctx.lastRows.length ? lastSt.measured/ctx.lastRows.length*100 : 0;
  tiles.push(hdKpi({label:"Data Coverage", icon:HD_IC.db, value: hdNum(lastTitik,0), suffix:" titik diuji",
    spark:`<div class="hd-mini-bar" role="img" aria-label="${lastSt.measured} terukur, ${notMeasured} tidak terukur"><i style="width:${mPct.toFixed(1)}%"></i></div>`,
    foot:`${lastSt.measured} terukur${bdl?` (${bdl} di bawah deteksi)`:""}${notMeasured?` &middot; ${notMeasured} surat pernyataan`:""}`}));
  if(ctx.last){
    const rhSeries = ctx.periods.map(p=>hdRhTotal(ctx, p));
    const a = rhSeries[rhSeries.length-1], b = rhSeries.length>1 ? rhSeries[rhSeries.length-2] : null;
    tiles.push(hdKpi({label:"Running Hour", icon:HD_IC.gauge, value: a==null?"-":hdNum(a,0), suffix: a==null?"":" jam",
      spark: hdSpark(rhSeries, {bars:true, color:"#3d78c9", label:"Total Running Hour per periode"}),
      foot: a==null ? "Tidak ada data Running Hour untuk cakupan ini" : `${ctx.rhEngines.length} engine &middot; ${ctx.last}${b?` &middot; ${hdSignedPct((a-b)/b*100)} vs ${ctx.prev}`:""}`}));
  }
  return tiles.join("");
}

/* ---------------- Trend chart ---------------- */
function hdTrendResolvedMode(ctx){
  let m = hdTrendMode || (hdSel.cerobong.size ? "engine" : "site");
  if(m==="pct" && !ctx.hasStd) m = "site";
  return m;
}
function hdTopEngines(ctx, n){
  const latestBy = {};
  ctx.numeric.forEach(r=>{ const cur = latestBy[r.cerobong]; if(!cur || r.periodeOrder>cur.periodeOrder) latestBy[r.cerobong] = r; });
  return Object.values(latestBy).sort((a,b)=> ctx.hasStd ? (b.pctOfStandard||0)-(a.pctOfStandard||0) : b.resultNumeric-a.resultNumeric).slice(0,n).map(r=>r.cerobong);
}
function buildHdTrend(ctx){
  const mode = hdTrendResolvedMode(ctx);
  const toggle = hdSeg("hdSetTrendMode", mode, [["site","Per Site"],["engine","Per Engine"],["max","Max per Site"]].concat(ctx.hasStd?[["pct","% Baku Mutu"]]:[]));
  if(!ctx.parameter || !ctx.periods.length) return {toggle, svg: hdEmpty("Pilih parameter untuk melihat trend."), legend:""};
  if(!ctx.numeric.length) return {toggle, svg: hdEmpty("Tidak ada data terukur untuk parameter ini pada filter saat ini."), legend:""};
  let keys, keyFn, colorFn, agg = "mean", valFn = r=>r.resultNumeric, autoNote = "";
  if(mode==="engine"){
    keys = hdSel.cerobong.size ? [...hdSel.cerobong].filter(c=>ctx.numeric.some(r=>r.cerobong===c)) : hdTopEngines(ctx, 8);
    if(!hdSel.cerobong.size) autoNote = "8 engine dengan hasil terakhir tertinggi. Centang titik di filter atau klik di Scorecard untuk memilih sendiri.";
    keyFn = r=>r.cerobong; colorFn = (k,i)=>HD_PALETTE[i%HD_PALETTE.length];
  }else{
    const sites = [...new Set(ctx.numeric.map(r=>r.site))].sort();
    keys = hdSel.site.size ? sites.filter(s=>hdSel.site.has(s)) : sites;
    keyFn = r=>r.site; colorFn = k=>hdSiteColor(k);
    if(mode==="max") agg = "max";
    if(mode==="pct") valFn = r=>r.pctOfStandard;
  }
  const n = ctx.periods.length;
  const series = keys.map((k,i)=>{
    const values = ctx.periods.map(p=>{
      const vals = ctx.numeric.filter(r=>keyFn(r)===k && r.periode===p).map(valFn).filter(v=>v!=null);
      if(!vals.length) return null;
      return agg==="max" ? Math.max(...vals) : hdMean(vals);
    });
    return {key:k, color:colorFn(k,i), values};
  }).filter(s=>s.values.some(v=>v!=null));
  if(!series.length) return {toggle, svg: hdEmpty("Tidak ada data untuk kombinasi filter ini."), legend:""};
  // Sorot seri dengan kenaikan ABSOLUT terbesar (titik pertama ke terakhir yang ada datanya) — sama
  // dengan narasi Executive Summary; kenaikan relatif dari basis kecil (14 ke 52) menyesatkan.
  let hiKey = null, hiCh = 0, hiAbs = 0;
  series.forEach(s=>{
    const v = s.values.filter(x=>x!=null);
    if(v.length>=2 && v[0]>0){ const abs = v[v.length-1]-v[0]; if(abs>hiAbs){ hiAbs = abs; hiCh = abs/v[0]*100; hiKey = s.key; } }
  });
  const ref = mode==="pct" ? 100 : (mode==="engine" && keys.length ? hdMedian(ctx.filtered.filter(r=>keys.includes(r.cerobong)).map(r=>r.standard).filter(v=>v!=null)) : ctx.stdRef);
  const dataMax = Math.max(...series.flatMap(s=>s.values.filter(v=>v!=null)));
  const showRef = ref!=null && ref<=dataMax*4;
  const yMax = hdNiceMax(Math.max(dataMax, showRef?ref:0)*1.08);
  const W=780, H=320, padL=50, padR=112, padT=22, padB=36;
  const plotW = W-padL-padR, plotH = H-padT-padB;
  const x = i=>padL + (n<=1 ? plotW/2 : i/(n-1)*plotW);
  const y = v=>padT + plotH - v/yMax*plotH;
  let svg = `<svg class="hd-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Trend ${escHtml(ctx.parameter)} per periode">`;
  if(showRef){
    svg += `<rect x="${padL}" y="${y(ref).toFixed(1)}" width="${plotW}" height="${(y(ref*0.7)-y(ref)).toFixed(1)}" class="hd-band"/>`;
  }
  for(let g=0; g<=4; g++){
    const v = yMax*g/4, yy = y(v);
    svg += `<line x1="${padL}" y1="${yy.toFixed(1)}" x2="${W-padR}" y2="${yy.toFixed(1)}" class="hd-grid"/>`;
    svg += `<text x="${padL-8}" y="${(yy+4).toFixed(1)}" text-anchor="end" class="hd-axis">${hdNum(v)}${mode==="pct"?"%":""}</text>`;
  }
  ctx.periods.forEach((p,i)=>{ svg += `<text x="${x(i).toFixed(1)}" y="${H-12}" text-anchor="middle" class="hd-axis ${i===n-1?"strong":""}">${p}</text>`; });
  if(showRef){
    svg += `<line x1="${padL}" y1="${y(ref).toFixed(1)}" x2="${W-padR}" y2="${y(ref).toFixed(1)}" class="hd-ref"/>`;
    svg += `<text x="${W-padR}" y="${(y(ref)-6).toFixed(1)}" text-anchor="end" class="hd-ref-label">Baku mutu ${hdNum(ref)}${mode==="pct"?"%":""}</text>`;
    svg += `<text x="${W-padR}" y="${(y(ref*0.7)-6).toFixed(1)}" text-anchor="end" class="hd-warn-label">Early Warning &ge;${hdNum(ref*0.7)}${mode==="pct"?"%":""}</text>`;
  }
  const ordered = [...series].sort((a,b)=>(a.key===hiKey)-(b.key===hiKey));
  ordered.forEach(s=>{
    const pts = s.values.map((v,i)=>v==null?null:[i,v]).filter(Boolean);
    const wide = s.key===hiKey;
    for(let k=1;k<pts.length;k++){
      const [i0,v0] = pts[k-1], [i1,v1] = pts[k];
      svg += `<line x1="${x(i0).toFixed(1)}" y1="${y(v0).toFixed(1)}" x2="${x(i1).toFixed(1)}" y2="${y(v1).toFixed(1)}" stroke="${s.color}" stroke-width="${wide?3.5:2}" stroke-linecap="round" ${i1-i0>1?'stroke-dasharray="3 5"':""} opacity="${wide||!hiKey?1:.85}"/>`;
    }
    pts.forEach(([i,v])=>{
      svg += `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="${wide?5:3.6}" fill="${s.color}" stroke="var(--surface-card)" stroke-width="1.5"><title>${escHtml(s.key)} &middot; ${ctx.periods[i]}: ${hdNum(v)}${mode==="pct"?"%":" "+escHtml(ctx.unit)}</title></circle>`;
    });
  });
  // Label akhir garis langsung di kanan plot, dengan penghindar tabrakan sederhana (jarak min 14px).
  const labels = series.map(s=>{
    const pts = s.values.map((v,i)=>v==null?null:[i,v]).filter(Boolean);
    const [, lv] = pts[pts.length-1];
    return {s, y:y(lv), v:lv};
  }).sort((a,b)=>a.y-b.y);
  for(let i=1;i<labels.length;i++) if(labels[i].y-labels[i-1].y<14) labels[i].y = labels[i-1].y+14;
  const overflow = labels.length ? labels[labels.length-1].y-(padT+plotH) : 0;
  if(overflow>0) labels.forEach(l=>{ l.y -= overflow; });
  labels.forEach(l=>{
    svg += `<text x="${W-padR+10}" y="${(l.y+4).toFixed(1)}" class="hd-end-label" fill="${l.s.color}" ${l.s.key===hiKey?'font-weight="800"':""}>${escHtml(hdTrunc(l.s.key,13))} ${hdNum(l.v)}</text>`;
  });
  svg += `</svg>`;
  const legend = series.map(s=>`<span class="item"><span class="sw" style="background:${s.color}"></span>${escHtml(s.key)}${s.key===hiKey?` <b class="up">&#9650; ${hdNum(hiCh,0)}%</b>`:""}</span>`).join("")
    + (showRef ? `<span class="item"><span class="sw hd-sw-ref"></span>Baku mutu</span><span class="item"><span class="sw hd-sw-band"></span>Zona Early Warning</span>` : "")
    + (ref!=null && !showRef ? `<span class="item muted">Baku mutu ${hdNum(ref)} ${escHtml(ctx.unit)} jauh di atas skala data, garis tidak digambar supaya trend tetap terbaca.</span>` : "")
    + (series.some(s=>{ const idx = s.values.map((v,i)=>v==null?null:i).filter(v=>v!=null); return idx.some((v,k)=>k && v-idx[k-1]>1); }) ? `<span class="item muted">Garis putus-putus: tidak ada data pada periode di antaranya.</span>` : "")
    + (autoNote ? `<span class="item muted">${autoNote}</span>` : "");
  return {toggle, svg, legend};
}

/* ---------------- Distribution ---------------- */
function buildHdDistribution(ctx){
  if(!ctx.last) return hdEmpty("Tidak ada data pada rentang ini.");
  if(ctx.hasStd){
    const rows = ctx.lastRows.filter(r=>r.pctOfStandard!=null);
    if(!rows.length) return hdEmpty(`Tidak ada data dengan baku mutu pada ${ctx.last}.`);
    const bins = Array(11).fill(0);
    rows.forEach(r=>{ bins[r.pctOfStandard>100 ? 10 : Math.min(9, Math.floor(r.pctOfStandard/10))] += 1; });
    const zc = {safe:0, watch:0, warn:0, exceed:0};
    rows.forEach(r=>{ zc[hdZoneOf(r.pctOfStandard, r.statusBakuMutu)]++; });
    const maxC = Math.max(...bins, 1);
    const W=420, H=230, padL=28, base=190, top=18, bw=28, step=34;
    let svg = `<svg class="hd-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Histogram persen baku mutu ${ctx.last}: ${bins.map((c,i)=>(i<10?`${i*10}-${i*10+10}%`:">100%")+" "+c).join(", ")}">`;
    const ticks = [0, Math.ceil(maxC/2), maxC];
    ticks.forEach(t=>{ const yy = base-(t/maxC)*(base-top); svg += `<line x1="${padL}" y1="${yy}" x2="${W-6}" y2="${yy}" class="hd-grid"/><text x="${padL-6}" y="${yy+4}" text-anchor="end" class="hd-axis">${t}</text>`; });
    bins.forEach((c,i)=>{
      const zone = i>=10 ? "exceed" : i>=7 ? "warn" : i>=5 ? "watch" : "safe";
      const h = c ? Math.max(3,(c/maxC)*(base-top)) : 2;
      const bx = padL+8+i*step;
      svg += `<rect x="${bx}" y="${base-h}" width="${bw}" height="${h}" rx="3" fill="${HD_ZONES[zone].color}" ${c?"":'opacity=".35"'}><title>${i<10?`${i*10} sampai ${i*10+10}%`:"di atas 100%"}: ${c} titik</title></rect>`;
      if(c) svg += `<text x="${bx+bw/2}" y="${base-h-5}" text-anchor="middle" class="hd-axis strong">${c}</text>`;
      if(i%2===0 || i===10) svg += `<text x="${bx+bw/2}" y="${base+16}" text-anchor="middle" class="hd-axis">${i<10?i*10:">100"}</text>`;
    });
    const x100 = padL+8+10*step-3;
    svg += `<line x1="${x100}" y1="${top-6}" x2="${x100}" y2="${base+2}" class="hd-ref"/><text x="${x100-4}" y="${top-8}" text-anchor="end" class="hd-ref-label">100% BM</text>`;
    svg += `<text x="${W/2}" y="${H-4}" text-anchor="middle" class="hd-axis">% baku mutu</text></svg>`;
    const total = rows.length;
    const stack = `<div class="hd-stack" role="img" aria-label="${Object.keys(zc).map(z=>HD_ZONES[z].label+" "+zc[z]).join(", ")}">${Object.keys(zc).filter(z=>zc[z]).map(z=>`<i style="width:${(zc[z]/total*100).toFixed(1)}%;background:${HD_ZONES[z].color}"></i>`).join("")}</div>`;
    const tiles = `<div class="hd-zone-grid">${Object.keys(zc).map(z=>`<div class="hd-zone" style="background:${HD_ZONES[z].tint}">
      <span class="hd-zone-lbl"><i style="background:${HD_ZONES[z].color}"></i>${HD_ZONES[z].label}, ${HD_ZONES[z].range}</span>
      <span class="hd-zone-val ${z==="warn"&&zc[z]?"warn":z==="exceed"&&zc[z]?"bad":""}">${zc[z]} <small>titik</small></span></div>`).join("")}</div>`;
    return `<div class="hint" style="margin:0 0 8px;">${ctx.last}, ${total} titik dengan baku mutu.</div>${stack}${svg}${tiles}`;
  }
  const vals = ctx.lastRows.map(r=>r.resultNumeric).filter(v=>v!=null);
  if(!vals.length) return hdEmpty(`Tidak ada data terukur pada ${ctx.last}.`);
  const lo = Math.min(...vals), hi = Math.max(...vals), k = 8, w = (hi-lo)/k || 1;
  const bins = Array(k).fill(0); vals.forEach(v=>{ bins[Math.min(k-1, Math.floor((v-lo)/w))]++; });
  const maxC = Math.max(...bins), W=420, H=210, base=170, top=16, step=48, bw=38;
  let svg = `<svg class="hd-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Histogram nilai ${escHtml(ctx.parameter)}">`;
  bins.forEach((c,i)=>{
    const h = c ? Math.max(3,(c/maxC)*(base-top)) : 2, bx = 18+i*step;
    svg += `<rect x="${bx}" y="${base-h}" width="${bw}" height="${h}" rx="3" fill="#5a7fb0" ${c?"":'opacity=".35"'}><title>${hdNum(lo+i*w)} sampai ${hdNum(lo+(i+1)*w)}: ${c}</title></rect>`;
    if(c) svg += `<text x="${bx+bw/2}" y="${base-h-5}" text-anchor="middle" class="hd-axis strong">${c}</text>`;
    svg += `<text x="${bx+bw/2}" y="${base+16}" text-anchor="middle" class="hd-axis">${hdNum(lo+i*w)}</text>`;
  });
  svg += `<text x="${W/2}" y="${H-4}" text-anchor="middle" class="hd-axis">${escHtml(ctx.parameter)} (${escHtml(ctx.unit)})</text></svg>`;
  return `<div class="hint" style="margin:0 0 8px;">${ctx.last}, ${vals.length} titik terukur. Parameter pendukung tidak memiliki zona baku mutu.</div>${svg}
    <div class="hd-zone-grid">${[["Minimum",lo],["Median",hdMedian(vals)],["Rata-rata",hdMean(vals)],["Maksimum",hi]].map(([l,v])=>`<div class="hd-zone"><span class="hd-zone-lbl">${l}</span><span class="hd-zone-val">${hdNum(v)} <small>${escHtml(ctx.unit)}</small></span></div>`).join("")}</div>`;
}

/* ---------------- Priority Watchlist ---------------- */
function hdZoneBadge(z){
  if(!z) return `<span class="badge b-gray">-</span>`;
  const cls = {safe:"b-green", watch:"b-amber", warn:"hd-b-warn", exceed:"b-red"}[z];
  return `<span class="badge ${cls}">${HD_ZONES[z].label}</span>`;
}
function hdEngineBtn(c){
  const on = hdSel.cerobong.has(c);
  return `<button type="button" class="hd-link ${on?"on":""}" data-action="hdPickCerobong" data-val="${escHtml(c)}" title="${on?"Hapus dari":"Tambahkan ke"} perbandingan">${escHtml(c)}</button>`;
}
function buildHdWatchlist(ctx){
  if(!ctx.last) return hdEmpty("Tidak ada data pada rentang ini.");
  const rows = ctx.lastRows.filter(r=>r.resultNumeric!=null)
    .sort((a,b)=> ctx.hasStd ? (b.pctOfStandard||0)-(a.pctOfStandard||0) : b.resultNumeric-a.resultNumeric).slice(0,10);
  if(!rows.length) return hdEmpty(`Tidak ada data terukur pada ${ctx.last}.`);
  const scale = ctx.hasStd ? Math.max(100, ...rows.map(r=>r.pctOfStandard||0)) : Math.max(...rows.map(r=>r.resultNumeric));
  const body = rows.map((r,i)=>{
    const prevRec = ctx.prev ? ctx.byKey[r.cerobong+"||"+ctx.prev] : null;
    const d = prevRec && prevRec.resultNumeric ? (r.resultNumeric-prevRec.resultNumeric)/prevRec.resultNumeric*100 : null;
    const zone = ctx.hasStd ? hdZoneOf(r.pctOfStandard, r.statusBakuMutu) : null;
    const metric = ctx.hasStd ? (r.pctOfStandard||0) : r.resultNumeric;
    const rh = hdRhSemester(r.cerobong, r.periode);
    const barColor = zone ? HD_ZONES[zone].color : "#5a7fb0";
    return `<tr>
      <td class="hd-rank">${i+1}</td>
      <td><div class="hd-cell-main">${hdEngineBtn(r.cerobong)}<span class="hd-cell-sub">${escHtml(r.namaSumber||"")}</span></div></td>
      <td><span class="hd-site"><i style="background:${hdSiteColor(r.site)}"></i>${escHtml(r.site)}</span></td>
      <td class="num">${escHtml(r.resultRaw)} <span class="muted">${escHtml(r.unit)}</span></td>
      <td><div class="hd-bullet"><div class="track"><i style="width:${Math.min(100,metric/scale*100).toFixed(1)}%;background:${barColor}"></i>${ctx.hasStd?`<b style="left:${(70/scale*100).toFixed(1)}%"></b>`:""}</div><span class="v ${zone==="warn"||zone==="exceed"?"warn":""}">${ctx.hasStd?hdPct(r.pctOfStandard):hdNum(r.resultNumeric)}</span></div></td>
      <td class="num"><span class="hd-delta ${d==null?"":d>0.05?"up":d<-0.05?"down":""}">${d==null?"-":(d>0.05?"▲ ":d<-0.05?"▼ ":"")+hdSignedPct(d)}</span></td>
      <td class="num">${rh==null?"-":hdNum(rh,0)}</td>
      <td class="muted">${r.dateOfSampling?escHtml(new Date(r.dateOfSampling).toLocaleDateString("id-ID",{day:"numeric",month:"short",year:"numeric"})):"-"}</td>
      <td>${ctx.hasStd?hdZoneBadge(zone):`<span class="badge b-blue">Pendukung</span>`}</td>
    </tr>`;
  }).join("");
  return `<div class="tablewrap hd-table-wrap"><table class="hd-table">
    <thead><tr><th>#</th><th>Titik atau engine</th><th>Site</th><th class="num">Hasil</th><th>${ctx.hasStd?"% baku mutu":"Relatif"}</th><th class="num">vs ${ctx.prev||"-"}</th><th class="num">RH semester</th><th>Sampling</th><th>Status</th></tr></thead>
    <tbody>${body}</tbody></table></div>
    <div class="hint">${ctx.hasStd?"Penanda putih pada batang adalah ambang Early Warning 70% BM. ":""}Kenaikan terhadap periode sebelumnya diberi warna jingga, penurunan hijau. RH semester dari data Running Hour bulanan.</div>`;
}

/* ---------------- Heatmap ---------------- */
function hdHeatColor(p){
  if(p==null) return ["var(--gray-100)","var(--gray-500)"];
  if(p>100) return ["#8f1d14","#ffffff"];
  if(p>=70) return ["#c2410c","#ffffff"];
  if(p>=55) return ["#2c7f78","#ffffff"];
  if(p>=40) return ["#93cdc6","#0f1b2d"];
  if(p>=25) return ["#cfe8e5","#0f1b2d"];
  return ["#eef6f5","#0f1b2d"];
}
function buildHdHeatmap(ctx){
  const toggle = hdSeg("hdSetHeatMode", hdHeatMode, [["site","Site × Periode"],["engine","Engine × Periode"]]);
  if(!ctx.periods.length || !ctx.numeric.length) return {toggle, html: hdEmpty("Tidak ada data terukur untuk heatmap."), title:"", sub:""};
  const keys = hdHeatMode==="engine" ? hdTopEngines(ctx, 15) : [...new Set(ctx.numeric.map(r=>r.site))].sort();
  const keyFn = hdHeatMode==="engine" ? (r=>r.cerobong) : (r=>r.site);
  // Parameter pendukung (tanpa baku mutu): warna dari skala min-maks data (dipetakan ke 0-69 supaya
  // hanya memakai gradasi teal, tidak pernah warna zona peringatan yang artinya khusus baku mutu).
  const nums = ctx.numeric.map(r=>r.resultNumeric);
  const gMin = Math.min(...nums), gMax = Math.max(...nums);
  const cellOf = (k,p)=>{
    const rs = ctx.numeric.filter(r=>keyFn(r)===k && r.periode===p);
    if(!rs.length) return null;
    const v = hdMean(rs.map(r=>r.resultNumeric));
    const pcts = rs.map(r=>r.pctOfStandard).filter(x=>x!=null);
    const pct = ctx.hasStd ? hdMean(pcts) : (gMax>gMin ? (v-gMin)/(gMax-gMin)*69 : 30);
    return {v, pct, rel: !ctx.hasStd};
  };
  const head = `<tr><th></th>${ctx.periods.map((p,i)=>`<th class="${i===ctx.periods.length-1?"strong":""}">${p.replace(/^S(\d) (\d{2})(\d{2})$/,"S$1 '$3")}</th>`).join("")}<th>&Delta;</th></tr>`;
  const body = keys.map(k=>{
    const cells = ctx.periods.map(p=>cellOf(k,p));
    const vs = cells.filter(Boolean);
    const d = vs.length>=2 && vs[0].v>0 ? (vs[vs.length-1].v-vs[0].v)/vs[0].v*100 : null;
    const site = hdHeatMode==="engine" ? (ctx.numeric.find(r=>r.cerobong===k)||{}).site : k;
    return `<tr><th class="rowh"><span class="hd-site"><i style="background:${hdSiteColor(site)}"></i>${hdHeatMode==="engine"?hdEngineBtn(k):escHtml(k)}</span></th>${cells.map((c,i)=>{
      if(!c) return `<td class="hd-hc empty" title="Tidak ada data">&ndash;</td>`;
      const [bg,fg] = hdHeatColor(c.pct);
      return `<td class="hd-hc" style="background:${bg};color:${fg}" title="${escHtml(k)} ${ctx.periods[i]}: ${hdNum(c.v)} ${escHtml(ctx.unit)}${ctx.hasStd?` (${hdPct(c.pct,0)} BM)`:""}"><b>${hdNum(c.v)}</b>${ctx.hasStd?`<small>${hdPct(c.pct,0)}</small>`:""}</td>`;
    }).join("")}<td class="num"><span class="hd-delta ${d==null?"":d>0.05?"up":d<-0.05?"down":""}">${d==null?"-":hdSignedPct(d)}</span></td></tr>`;
  }).join("");
  const legend = ctx.hasStd ? `<div class="hd-heat-legend"><span>% BM</span>${[["<25",10],["25–40",30],["40–55",45],["55–70",60],["70–100",80],[">100",120]].map(([l,p])=>{ const [bg,fg]=hdHeatColor(p); return `<i style="background:${bg};color:${fg}">${l}</i>`; }).join("")}<i class="empty">tanpa data</i></div>`
    : `<div class="hint">Parameter pendukung: warna menunjukkan posisi nilai di antara terendah (${hdNum(gMin)}) dan tertinggi (${hdNum(gMax)}) ${escHtml(ctx.unit)} pada filter ini.</div>`;
  const sub = hdHeatMode==="engine"
    ? `15 engine dengan hasil terakhir tertinggi. Nilai rata-rata dalam ${escHtml(ctx.unit)}${ctx.hasStd?", warna menunjukkan % baku mutu":""}.`
    : `Rata-rata ${escHtml(ctx.parameter)} per site dalam ${escHtml(ctx.unit)}${ctx.hasStd?", warna menunjukkan % baku mutu":""}. &Delta; = perubahan periode pertama ke terakhir.`;
  return {toggle, title: hdHeatMode==="engine"?"Engine × Periode":"Site × Periode", sub,
    html:`<div class="tablewrap hd-table-wrap"><table class="hd-heat">${head}${body}</table></div>${legend}`};
}

/* ---------------- Profil per Jenis Sumber ---------------- */
function buildHdSourceProfile(ctx){
  if(!ctx.last) return hdEmpty("Tidak ada data pada rentang ini.");
  const groups = {};
  ctx.lastRows.forEach(r=>{ (groups[r.namaSumber||"Lainnya"] = groups[r.namaSumber||"Lainnya"] || []).push(r); });
  const names = Object.keys(groups);
  if(!names.length) return hdEmpty(`Tidak ada data pada ${ctx.last}.`);
  const allVals = ctx.lastRows.map(r=>r.resultNumeric).filter(v=>v!=null);
  const ref = ctx.stdRef;
  const showRef = ref!=null && allVals.length && ref<=Math.max(...allVals)*4;
  const axis = Math.max(...allVals, showRef?ref:0, 1)*1.04;
  const pos = v=>(v/axis*100).toFixed(1)+"%";
  const items = names.map(n=>{
    const vals = groups[n].map(r=>r.resultNumeric).filter(v=>v!=null);
    return {n, total:new Set(groups[n].map(r=>r.cerobong)).size, vals};
  }).sort((a,b)=>(b.vals.length?hdMean(b.vals):-1)-(a.vals.length?hdMean(a.vals):-1));
  const html = items.map(it=>{
    if(!it.vals.length) return `<div class="hd-src empty"><div class="hd-src-head"><b>${escHtml(it.n)}</b><span>${it.total} titik &middot; belum dievaluasi</span></div></div>`;
    const lo = Math.min(...it.vals), hi = Math.max(...it.vals), m = hdMean(it.vals);
    const hiWarn = showRef && hi>=ref*0.7;
    return `<div class="hd-src">
      <div class="hd-src-head"><b>${escHtml(it.n)}</b><span>${it.total} titik${it.vals.length<it.total?` &middot; ${it.vals.length} terukur`:""}</span></div>
      <div class="hd-src-track" role="img" aria-label="${escHtml(it.n)}: min ${hdNum(lo)}, rata-rata ${hdNum(m)}, maks ${hdNum(hi)}">
        <i class="rng" style="left:${pos(lo)};width:calc(${pos(hi)} - ${pos(lo)} + 2px)"></i>
        <i class="mean" style="left:calc(${pos(m)} - 5px)"></i>
        ${showRef?`<i class="mk warn" style="left:${pos(ref*0.7)}"></i><i class="mk ref" style="left:${pos(ref)}"></i>`:""}
      </div>
      <div class="hd-src-foot"><span>min ${hdNum(lo)}</span><span class="strong">rata-rata ${hdNum(m)}</span><span class="${hiWarn?"warn":""}">maks ${hdNum(hi)}</span></div>
    </div>`;
  }).join("");
  return `${html}<div class="hd-src-axis"><span>0</span>${showRef?`<span class="warn">${hdNum(ref*0.7)} (70%)</span><span class="ref">${hdNum(ref)} BM</span>`:`<span>${hdNum(axis)}</span>`}</div>
    <div class="hint">Satuan ${escHtml(ctx.unit)}, periode ${ctx.last}. Titik putih adalah rata-rata.</div>`;
}

/* ---------------- Running Hour ---------------- */
function buildHdRhTrend(ctx){
  const toggle = hdSeg("hdSetRhGran", hdRhGran, [["semester","Per Semester"],["month","Bulanan"]]);
  if(!ctx.rhEngines.length) return {toggle, svg: hdEmpty("Tidak ada data Running Hour bulanan untuk engine pada cakupan filter ini. Data Running Hour diisi di menu Running Hour Detail."), legend:"", sub:""};
  const sites = [...new Set(ctx.rhEngines.map(e=>e.site))].sort();
  let cols = [];
  if(hdRhGran==="month"){
    const labels = ctx.rangePeriods.flatMap(p=>{ const pp = parsePeriod(p); return pp ? semesterMonthLabels(pp.sem, pp.year) : []; });
    cols = labels.map(lab=>{
      const idx = DB.rhMonths.indexOf(lab);
      const bySite = {}; let any = false;
      sites.forEach(s=>{ bySite[s] = 0; });
      if(idx>=0) ctx.rhEngines.forEach(e=>{ const v = DB.rhMonthly[e.cerobong][idx]; if(v!=null && !isNaN(v)){ bySite[e.site] += Number(v); any = true; } });
      return {label: lab, bySite, any};
    });
    while(cols.length && !cols[cols.length-1].any) cols.pop();
  }else{
    cols = ctx.rangePeriods.map(p=>{
      const bySite = {}; let any = false;
      sites.forEach(s=>{ bySite[s] = 0; });
      ctx.rhEngines.forEach(e=>{ const v = hdRhSemester(e.cerobong, p); if(v!=null){ bySite[e.site] += v; any = true; } });
      return {label:p, bySite, any};
    });
  }
  if(!cols.some(c=>c.any)) return {toggle, svg: hdEmpty("Data Running Hour belum tersedia untuk rentang periode ini."), legend:"", sub:""};
  const totals = cols.map(c=>sites.reduce((a,s)=>a+c.bySite[s],0));
  const yMax = hdNiceMax(Math.max(...totals)*1.1);
  const W=880, H=300, padL=60, padR=16, padT=24, padB=40, plotW=W-padL-padR, plotH=H-padT-padB;
  const slot = plotW/cols.length, bw = Math.min(56, slot*0.68);
  const y = v=>padT+plotH-v/yMax*plotH;
  let svg = `<svg class="hd-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Running Hour per site ${hdRhGran==="month"?"per bulan":"per semester"}">`;
  for(let g=0; g<=4; g++){ const v = yMax*g/4; svg += `<line x1="${padL}" y1="${y(v).toFixed(1)}" x2="${W-padR}" y2="${y(v).toFixed(1)}" class="hd-grid"/><text x="${padL-8}" y="${(y(v)+4).toFixed(1)}" text-anchor="end" class="hd-axis">${hdNum(v,0)}</text>`; }
  cols.forEach((c,i)=>{
    const cx = padL+slot*i+slot/2;
    let acc = 0;
    sites.forEach(s=>{
      const v = c.bySite[s]; if(!v) return;
      const y0 = y(acc), y1 = y(acc+v);
      svg += `<rect x="${(cx-bw/2).toFixed(1)}" y="${y1.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0.5,y0-y1).toFixed(1)}" fill="${hdSiteColor(s)}"><title>${escHtml(s)} ${c.label}: ${hdNum(v,0)} jam</title></rect>`;
      acc += v;
    });
    const every = hdRhGran==="month" ? Math.ceil(cols.length/12) : 1;
    if(i%every===0 || i===cols.length-1){
      svg += `<text x="${cx.toFixed(1)}" y="${H-padB+18}" text-anchor="middle" class="hd-axis ${i===cols.length-1?"strong":""}">${c.label}</text>`;
      if(totals[i]) svg += `<text x="${cx.toFixed(1)}" y="${(y(totals[i])-6).toFixed(1)}" text-anchor="middle" class="hd-axis strong">${hdNum(totals[i]/1000,1)}k</text>`;
    }
  });
  svg += `</svg>`;
  const legend = sites.map(s=>`<span class="item"><span class="sw" style="background:${hdSiteColor(s)}"></span>${escHtml(s)} &middot; ${ctx.rhEngines.filter(e=>e.site===s).length} engine</span>`).join("")
    + `<span class="item muted">Label di atas batang: total ribu jam.</span>`;
  const lastI = totals.length-1;
  const sub = `Total jam operasi ${ctx.rhEngines.length} engine pada cakupan filter, ditumpuk per site. ${cols[lastI].label}: ${hdNum(totals[lastI],0)} jam${lastI>0&&totals[lastI-1]?` (${hdSignedPct((totals[lastI]-totals[lastI-1])/totals[lastI-1]*100)} dibanding ${cols[lastI-1].label})`:""}.`;
  return {toggle, svg, legend, sub};
}
function buildHdRhScatter(ctx){
  if(!ctx.parameter) return hdEmpty("Pilih parameter.");
  const pairs = ctx.numeric.map(r=>{
    const rh = hdRhSemester(r.cerobong, r.periode);
    const yv = ctx.hasStd ? r.pctOfStandard : r.resultNumeric;
    return rh!=null && yv!=null ? {x:rh, y:yv, r} : null;
  }).filter(Boolean);
  if(pairs.length<3) return hdEmpty("Data pasangan Running Hour dan hasil uji belum cukup (minimal 3) untuk filter ini.");
  const W=420, H=300, padL=48, padR=14, padT=16, padB=40;
  const xMax = hdNiceMax(Math.max(...pairs.map(p=>p.x))*1.05), yMax = hdNiceMax(Math.max(...pairs.map(p=>p.y), ctx.hasStd?100:0)*1.05);
  const x = v=>padL+v/xMax*(W-padL-padR), y = v=>padT+(H-padT-padB)-v/yMax*(H-padT-padB);
  let svg = `<svg class="hd-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Sebaran Running Hour terhadap ${escHtml(ctx.parameter)}">`;
  for(let g=0; g<=4; g++){
    svg += `<line x1="${padL}" y1="${y(yMax*g/4).toFixed(1)}" x2="${W-padR}" y2="${y(yMax*g/4).toFixed(1)}" class="hd-grid"/><text x="${padL-6}" y="${(y(yMax*g/4)+4).toFixed(1)}" text-anchor="end" class="hd-axis">${hdNum(yMax*g/4)}</text>`;
    svg += `<text x="${x(xMax*g/4).toFixed(1)}" y="${H-padB+16}" text-anchor="middle" class="hd-axis">${hdNum(xMax*g/4,0)}</text>`;
  }
  if(ctx.hasStd){ svg += `<line x1="${padL}" y1="${y(100)}" x2="${W-padR}" y2="${y(100)}" class="hd-ref"/><line x1="${padL}" y1="${y(70)}" x2="${W-padR}" y2="${y(70)}" class="hd-warnline"/>`; }
  const r = hdPearsonR(pairs);
  if(r!=null){
    const mx = hdMean(pairs.map(p=>p.x)), my = hdMean(pairs.map(p=>p.y));
    let num=0, den=0; pairs.forEach(p=>{ num += (p.x-mx)*(p.y-my); den += (p.x-mx)**2; });
    const b = den ? num/den : 0, a = my-b*mx;
    const x0 = Math.min(...pairs.map(p=>p.x)), x1 = Math.max(...pairs.map(p=>p.x));
    const clampY = v=>Math.max(0, Math.min(yMax, v));
    svg += `<line x1="${x(x0).toFixed(1)}" y1="${y(clampY(a+b*x0)).toFixed(1)}" x2="${x(x1).toFixed(1)}" y2="${y(clampY(a+b*x1)).toFixed(1)}" stroke="var(--heading-2)" stroke-width="1.5" stroke-dasharray="5 4"/>`;
  }
  pairs.forEach(p=>{ svg += `<circle cx="${x(p.x).toFixed(1)}" cy="${y(p.y).toFixed(1)}" r="4" fill="${hdSiteColor(p.r.site)}" fill-opacity=".75" stroke="var(--surface-card)"><title>${escHtml(p.r.cerobong)} ${p.r.periode}: RH ${hdNum(p.x,0)} jam, ${ctx.hasStd?hdPct(p.y):hdNum(p.y)+" "+escHtml(ctx.unit)}</title></circle>`; });
  svg += `<text x="${(padL+W-padR)/2}" y="${H-6}" text-anchor="middle" class="hd-axis">Running Hour semester (jam)</text>`;
  svg += `<text x="12" y="${padT+4}" class="hd-axis" transform="rotate(-90 12 ${padT+4})" text-anchor="end">${ctx.hasStd?"% baku mutu":escHtml(ctx.unit)}</text></svg>`;
  let stat = "";
  if(r!=null){
    const {strength, dir} = hdCorrInterpretation(r);
    stat = `<div class="hd-stat-row"><div class="hd-param-pill"><div class="lbl">r</div><div class="val">${r.toFixed(2)}</div></div><div class="hd-param-pill"><div class="lbl">R&sup2;</div><div class="val">${(r*r).toFixed(2)}</div></div><div class="hd-param-pill"><div class="lbl">n</div><div class="val">${pairs.length}</div></div></div>
      <div class="hint">Korelasi <b>${strength}</b>, ${dir}. ${Math.abs(r)<0.2?"Beban operasi (jam jalan) bukan penjelas utama variasi hasil pada data ini; periksa faktor lain seperti suhu pembakaran atau kondisi engine.":"Jam operasi ikut menjelaskan sebagian variasi hasil; engine dengan jam jalan tinggi layak dipantau lebih ketat."}</div>`;
  }
  return svg+stat;
}
function buildHdRhTable(ctx){
  if(!ctx.rhEngines.length) return {html: hdEmpty("Tidak ada data Running Hour untuk engine pada cakupan ini."), sub:""};
  const periods = ctx.rangePeriods;
  const withData = periods.filter(p=>ctx.rhEngines.some(e=>hdRhSemester(e.cerobong,p)!=null && hdRhSemester(e.cerobong,p)>0));
  const lastP = ctx.last && withData.includes(ctx.last) ? ctx.last : withData[withData.length-1];
  if(!lastP) return {html: hdEmpty("Data Running Hour belum tersedia untuk rentang periode ini."), sub:""};
  const prevP = periods[periods.indexOf(lastP)-1] || null;
  const hours = hdSemesterHours(lastP);
  const withParam = new Set(ctx.numeric.map(r=>r.cerobong));
  const scope = ctx.rhEngines.some(e=>withParam.has(e.cerobong)) ? ctx.rhEngines.filter(e=>withParam.has(e.cerobong)) : ctx.rhEngines;
  const rows = scope.map(e=>{
    const a = hdRhSemester(e.cerobong, lastP), b = prevP ? hdRhSemester(e.cerobong, prevP) : null;
    const series = periods.map(p=>hdRhSemester(e.cerobong, p));
    const rec = ctx.parameter ? ctx.filtered.filter(r=>r.cerobong===e.cerobong && r.resultNumeric!=null).sort((x,y)=>y.periodeOrder-x.periodeOrder)[0] : null;
    return {...e, a, b, series, rec, util: a!=null && hours ? a/hours*100 : null};
  }).sort((x,y)=>(y.a||0)-(x.a||0));
  const shown = hdRhShowAll ? rows : rows.slice(0,12);
  const body = shown.map(r=>{
    const d = r.a!=null && r.b ? (r.a-r.b)/r.b*100 : null;
    const z = r.rec ? hdZoneOf(r.rec.pctOfStandard, r.rec.statusBakuMutu) : null;
    return `<tr>
      <td><div class="hd-cell-main">${hdEngineBtn(r.cerobong)}<span class="hd-cell-sub">${escHtml(r.sumber||"")}</span></div></td>
      <td><span class="hd-site"><i style="background:${hdSiteColor(r.site)}"></i>${escHtml(r.site)}</span></td>
      <td class="num strong">${r.a==null?"-":hdNum(r.a,0)}</td>
      <td><div class="hd-bullet"><div class="track"><i style="width:${Math.min(100,r.util||0).toFixed(1)}%;background:#3d78c9"></i></div><span class="v">${r.util==null?"-":hdPct(r.util,0)}</span></div></td>
      <td class="num"><span class="hd-delta ${d==null?"":d>0.05?"up-neutral":d<-0.05?"down-neutral":""}">${d==null?"-":hdSignedPct(d)}</span></td>
      <td>${hdSpark(r.series, {w:96, h:26, color:"#3d78c9", zero:true}) || "-"}</td>
      <td class="num">${r.rec?`${escHtml(r.rec.resultRaw)} <span class="muted">${escHtml(r.rec.unit)}</span>${r.rec.periode!==lastP?` <span class="muted">(${r.rec.periode})</span>`:""}`:"-"}</td>
      <td>${r.rec && r.rec.pctOfStandard!=null ? `<span class="hd-pill" style="background:${HD_ZONES[z].tint};color:${z==="safe"?"var(--gray-900)":HD_ZONES[z].color}">${hdPct(r.rec.pctOfStandard,0)} BM</span>` : "-"}</td>
    </tr>`;
  }).join("");
  const more = rows.length>12 ? `<button type="button" class="btn small ghost" data-action="hdToggleRhAll">${hdRhShowAll?"Tampilkan 12 teratas":`Tampilkan semua ${rows.length} engine`}</button>` : "";
  const fleetUtil = hdMean(rows.filter(r=>r.util!=null).map(r=>r.util));
  const idle = rows.filter(r=>r.a===0).length;
  return {sub:`${scope.length} engine yang diuji ${escHtml(ctx.parameter)}${scope.length<ctx.rhEngines.length?` (dari ${ctx.rhEngines.length} engine dengan data Running Hour)`:""}. Semester ${lastP} (${hdNum(hours,0)} jam kalender), rata-rata utilisasi ${hdPct(fleetUtil,0)}${idle?`, ${idle} engine tidak beroperasi (RH 0)`:""}. Diurutkan dari jam operasi tertinggi.`,
    html:`<div class="tablewrap hd-table-wrap"><table class="hd-table">
      <thead><tr><th>Engine</th><th>Site</th><th class="num">RH ${lastP}</th><th>Utilization</th><th class="num">vs ${prevP||"-"}</th><th>RH trend</th><th class="num">${escHtml(ctx.parameter||"Hasil")} terakhir</th><th>% BM</th></tr></thead>
      <tbody>${body}</tbody></table></div>${more}`};
}

/* ---------------- Engine Trend Scorecard ---------------- */
function hdMiniTrend(values, std, color, periods){
  const W=232, H=60, padX=6, padT=6, padB=14;
  const pts = values.map((v,i)=>v==null?null:[i,v]).filter(Boolean);
  if(!pts.length) return "";
  const vmax = Math.max(...pts.map(p=>p[1]));
  const showStd = std!=null && std<=vmax*4;
  const yMax = Math.max(vmax, showStd?std:0)*1.12 || 1;
  const n = values.length;
  const x = i=>padX+(n<=1?(W-2*padX)/2:i/(n-1)*(W-2*padX)), y = v=>padT+(H-padT-padB)-v/yMax*(H-padT-padB);
  let s = `<svg class="hd-mini" viewBox="0 0 ${W} ${H}" aria-hidden="true">`;
  if(showStd) s += `<line x1="${padX}" y1="${y(std).toFixed(1)}" x2="${W-padX}" y2="${y(std).toFixed(1)}" class="hd-ref"/><rect x="${padX}" y="${y(std).toFixed(1)}" width="${W-2*padX}" height="${(y(std*0.7)-y(std)).toFixed(1)}" class="hd-band"/>`;
  s += `<line x1="${padX}" y1="${H-padB}" x2="${W-padX}" y2="${H-padB}" class="hd-grid"/>`;
  for(let k=1;k<pts.length;k++){ const [i0,v0]=pts[k-1],[i1,v1]=pts[k]; s += `<line x1="${x(i0).toFixed(1)}" y1="${y(v0).toFixed(1)}" x2="${x(i1).toFixed(1)}" y2="${y(v1).toFixed(1)}" stroke="${color}" stroke-width="2" stroke-linecap="round" ${i1-i0>1?'stroke-dasharray="2 4"':""}/>`; }
  pts.forEach(([i,v],k)=>{ s += `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="${k===pts.length-1?3.4:2.2}" fill="${color}"/>`; });
  if(periods.length) s += `<text x="${padX}" y="${H-2}" class="hd-axis tiny">${periods[0]}</text><text x="${W-padX}" y="${H-2}" text-anchor="end" class="hd-axis tiny">${periods[periods.length-1]}</text>`;
  return s+`</svg>`;
}
function buildHdScorecard(ctx){
  const toggle = hdSeg("hdSetScoreSort", hdScoreSort, [["pct", ctx.hasStd?"% BM tertinggi":"Nilai tertinggi"],["delta","Kenaikan terbesar"],["name","Nama A-Z"]]);
  if(!ctx.numeric.length) return {toggle, html: hdEmpty("Tidak ada data terukur untuk parameter ini pada filter saat ini.")};
  const engines = [...new Set(ctx.numeric.map(r=>r.cerobong))];
  const cards = engines.map(c=>{
    const values = ctx.periods.map(p=>{ const r = ctx.byKey[c+"||"+p]; return r && r.resultNumeric!=null ? r.resultNumeric : null; });
    const recs = ctx.periods.map(p=>ctx.byKey[c+"||"+p]).filter(r=>r && r.resultNumeric!=null);
    const last = recs[recs.length-1], prev = recs[recs.length-2];
    const delta = prev && prev.resultNumeric ? (last.resultNumeric-prev.resultNumeric)/prev.resultNumeric*100 : null;
    return {c, values, last, prev, delta, zone: hdZoneOf(last.pctOfStandard, last.statusBakuMutu), rh: hdRhSemester(c, last.periode)};
  });
  cards.sort((a,b)=> hdScoreSort==="name" ? a.c.localeCompare(b.c)
    : hdScoreSort==="delta" ? (b.delta??-Infinity)-(a.delta??-Infinity)
    : ctx.hasStd ? (b.last.pctOfStandard??-1)-(a.last.pctOfStandard??-1) : b.last.resultNumeric-a.last.resultNumeric);
  const shown = hdScoreShowAll ? cards : cards.slice(0,18);
  const html = `<div class="hd-score-grid">${shown.map(k=>{
    const color = hdSiteColor(k.last.site);
    const on = hdSel.cerobong.has(k.c);
    return `<button type="button" class="hd-score ${on?"on":""} ${k.zone==="warn"?"z-warn":k.zone==="exceed"?"z-exceed":""}" data-action="hdPickCerobong" data-val="${escHtml(k.c)}" aria-pressed="${on}">
      <span class="hd-score-head"><span class="hd-site"><i style="background:${color}"></i>${escHtml(k.last.site)}</span>${ctx.hasStd&&k.zone?hdZoneBadge(k.zone):""}</span>
      <span class="hd-score-name">${escHtml(k.c)}</span>
      <span class="hd-score-sub">${escHtml(k.last.namaSumber||"")}</span>
      <span class="hd-score-val">${escHtml(k.last.resultRaw)} <small>${escHtml(k.last.unit)}</small>${k.last.pctOfStandard!=null?`<em>${hdPct(k.last.pctOfStandard,0)} BM</em>`:""}</span>
      ${hdMiniTrend(k.values, k.last.standard, color, ctx.periods)}
      <span class="hd-score-foot"><span class="hd-delta ${k.delta==null?"":k.delta>0.05?"up":k.delta<-0.05?"down":""}">${k.delta==null?"periode tunggal":`${hdSignedPct(k.delta)} vs ${k.prev.periode}`}</span><span>${k.last.periode!==ctx.last?`<b class="hd-stale">data ${k.last.periode}</b>`:k.rh==null?"":`RH ${hdNum(k.rh,0)} jam`}</span></span>
    </button>`;
  }).join("")}</div>${cards.length>18?`<div style="margin-top:12px;"><button type="button" class="btn small" data-action="hdToggleScoreAll">${hdScoreShowAll?"Tampilkan 18 teratas":`Tampilkan semua ${cards.length} engine`}</button></div>`:""}`;
  return {toggle, html};
}

/* ---------------- Render orkestrasi ---------------- */
function hdRenderAnalytics(ctx){
  const set = (id, html)=>{ const el = document.getElementById(id); if(el) el.innerHTML = html; };
  const setTxt = (id, txt)=>{ const el = document.getElementById(id); if(el) el.innerHTML = txt; };
  hdRenderHero();
  set("hdInsight", buildHdInsight(ctx));
  set("hdStats", buildHdKpis(ctx));
  const tr = buildHdTrend(ctx);
  set("hdTrendModeToggle", tr.toggle); set("hdTrendChart", tr.svg); set("hdTrendLegend", tr.legend);
  set("hdDistChart", buildHdDistribution(ctx));
  setTxt("hdDistSub", ctx.hasStd ? `Sebaran titik pada ${ctx.last||"periode terakhir"}, dikelompokkan per 10% baku mutu dan zona status.` : `Sebaran nilai pada ${ctx.last||"periode terakhir"}.`);
  set("hdWatchlist", buildHdWatchlist(ctx));
  const hm = buildHdHeatmap(ctx);
  set("hdHeatModeToggle", hm.toggle); set("hdHeatmap", hm.html); setTxt("hdHeatTitle", hm.title ? `&middot; ${hm.title}` : ""); setTxt("hdHeatSub", hm.sub);
  set("hdSourceProfile", buildHdSourceProfile(ctx));
  const rt = buildHdRhTrend(ctx);
  set("hdRhGranToggle", rt.toggle); set("hdRhTrend", rt.svg); set("hdRhTrendLegend", rt.legend); if(rt.sub) setTxt("hdRhTrendSub", rt.sub);
  set("hdRhScatter", buildHdRhScatter(ctx));
  setTxt("hdRhScatterSub", `Setiap titik adalah satu engine pada satu periode: Running Hour semester itu terhadap ${ctx.hasStd?"% baku mutu":"nilai"} ${escHtml(ctx.parameter)}. Warna mengikuti site.`);
  const rtab = buildHdRhTable(ctx);
  set("hdRhTable", rtab.html); if(rtab.sub) setTxt("hdRhTableSub", rtab.sub);
  const sc = buildHdScorecard(ctx);
  set("hdScoreSortToggle", sc.toggle); set("hdScorecard", sc.html);
  setTxt("hdScoreParamLabel", ctx.parameter ? `&middot; ${escHtml(ctx.parameter)}` : "");
}

/* ---------------- Aksi ---------------- */
function hdSetParam(val){
  const sel = document.getElementById("hdFltParameter");
  if(!sel || !val) return;
  sel.value = val;
  renderHasilDashboard();
}
function hdTogglePickCerobong(val){
  if(!val) return;
  if(hdSel.cerobong.has(val)) hdSel.cerobong.delete(val); else hdSel.cerobong.add(val);
  renderHasilDashboard();
  toast(hdSel.cerobong.has(val) ? `${val} ditambahkan ke perbandingan (${hdSel.cerobong.size} titik dipilih).` : `${val} dihapus dari perbandingan.`, "ok");
}
function hdExportFiltered(){
  const rows = hasilDashboardFiltered();
  if(!rows.length){ toast("Tidak ada baris data pada filter aktif.", "warn"); return; }
  const p = document.getElementById("hdFltParameter")?.value || "semua";
  const from = document.getElementById("hdFltPeriodeFrom")?.value || "", to = document.getElementById("hdFltPeriodeTo")?.value || "";
  const wb = xlsxWorkbookFromSheets([["Hasil Emisi Terfilter", xlsxSheetFromRows(HASIL_XLSX_HEADERS, rows.map(hasilRowForExport))]]);
  const safe = s=>String(s).replace(/[^A-Za-z0-9]+/g,"_").replace(/^_|_$/g,"");
  xlsxDownload(wb, `hasil_emisi_${safe(p)}_${safe(from)}-${safe(to)}.xlsx`);
}
// Halaman cetak app ini menyembunyikan .app seluruhnya (lihat @media print di style.css) dan hanya
// mencetak #printGuideArea, jadi ringkasan dashboard disalin ke sana sebagai laporan A4 lanskap.
function hdPrintDashboard(){
  const area = document.getElementById("printGuideArea");
  if(!area) { window.print(); return; }
  const grab = id=>document.getElementById(id)?.innerHTML || "";
  const p = document.getElementById("hdFltParameter")?.value || "";
  const block = (title, html)=> html ? `<section class="hd-print-block"><h3>${title}</h3>${html}</section>` : "";
  area.innerHTML = `<div class="hd-print">
    <header class="hd-print-head"><div><h1>Dashboard Hasil Emisi &middot; ${escHtml(p)}</h1><div class="sub">${escHtml(hdScopeDescription())}</div></div><div class="sub">Dicetak ${new Date().toLocaleString("id-ID")}</div></header>
    ${grab("hdInsight")}
    <div class="hd-kpis">${grab("hdStats")}</div>
    ${block("Trend Hasil per Periode", grab("hdTrendChart")+`<div class="legend">${grab("hdTrendLegend")}</div>`)}
    <div class="hd-print-2">${block("Distribution terhadap Baku Mutu", grab("hdDistChart"))}${block("Heatmap", grab("hdHeatmap"))}</div>
    ${block("Priority Watchlist", grab("hdWatchlist"))}
    ${block("Running Hour Trend per Site", grab("hdRhTrend")+`<div class="legend">${grab("hdRhTrendLegend")}</div>`)}
    ${block("Engine Utilization", grab("hdRhTable"))}
  </div>`;
  if(typeof setPrintOrientation==="function") setPrintOrientation("landscape", 10);
  window.print();
}
function hdJumpTo(id){
  const el = document.getElementById(id);
  if(el) el.scrollIntoView({behavior:"smooth", block:"start"});
}
document.addEventListener("change", e=>{
  if(e.target.id==="hdTabSupport" && e.target.value) hdSetParam(e.target.value);
});
