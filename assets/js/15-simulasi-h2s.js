/* =========================================================
   SIMULASI USULAN BAKU MUTU BARU (What-if Simulator)
========================================================= */
// Bagian simulasi bersifat independen terhadap filter dashboard utama (hdSel dan lain lain) supaya
// dapat diuji tanpa mengubah tampilan dashboard yang sedang dilihat. Hanya bekerja pada parameter
// emisi yang memang memiliki konsep baku mutu, karena parameter pendukung tidak diatur baku mutunya.
// Hasil dihitung ulang langsung setiap kontrol berubah (tanpa tombol "Jalankan"), supaya pengguna
// bisa menggeser usulan dan langsung melihat dampaknya, layaknya simulator sungguhan.
let simSel = { cerobong: new Set(), sumber: new Set(), permen: new Set() };
let simCerobongPanelOpen = false;
let simTrendMode = "auto"; // "auto", "engine", "site", atau "avg", lihat simResolveTrendMode
let simShowAll = false;
let simRunTimer = null;
const SIM_PROPOSAL_COLOR = "#d97706";
function simScheduleRun(){ clearTimeout(simRunTimer); simRunTimer = setTimeout(hdRunSimulation, 120); }

function simAvailableCerobong(){
  const parameter = document.getElementById("simParam")?.value || "";
  const kapasitas = document.getElementById("simKapasitas")?.value || "";
  const bahanBakar = document.getElementById("simBahanBakar")?.value || "";
  const set = new Set();
  DB.hasilPemantauan.forEach(r=>{
    if(parameter && r.parameter!==parameter) return;
    if(simSel.sumber.size && !simSel.sumber.has(r.namaSumber)) return;
    if(simSel.permen.size && !simSel.permen.has(r.regulasiCek)) return;
    if(kapasitas && r.kategoriKapasitas!==kapasitas) return;
    if(bahanBakar && r.jenisBahanBakar!==bahanBakar) return;
    set.add(r.cerobong);
  });
  return [...set].sort();
}
function simVisibleCerobongOptions(){
  const q = (document.getElementById("simCerobongSearch")?.value||"").toLowerCase();
  const all = simAvailableCerobong();
  return q ? all.filter(c=>c.toLowerCase().includes(q)) : all;
}
function simRenderCerobongChecklist(){
  const all = simAvailableCerobong();
  [...simSel.cerobong].forEach(c=>{ if(!all.includes(c)) simSel.cerobong.delete(c); });
  const btn = document.getElementById("simCerobongBtnLabel");
  if(btn){
    const n = simSel.cerobong.size;
    btn.textContent = n===0 ? `Semua titik pada lingkup (${all.length})` : `${n} titik dipilih, klik untuk mengubah`;
  }
  const list = document.getElementById("simCerobongList");
  if(!list) return;
  const visible = simVisibleCerobongOptions();
  list.innerHTML = visible.length ? visible.map(c=>`<label class="xsel-opt"><input type="checkbox" class="simCerobongCheck" data-val="${escHtml(c)}" ${simSel.cerobong.has(c)?"checked":""}> ${escHtml(c)}</label>`).join("")
    : `<div class="xsel-empty">Tidak ada titik yang sesuai dengan lingkup atau pencarian.</div>`;
}
// Chip centang untuk lingkup Jenis Sumber dan Permen LH, dapat mencentang lebih dari satu pilihan.
function simRenderChipBar(field, values, labelMap){
  const all = `<button type="button" class="chip-toggle all ${simSel[field].size===0?'active':''}" data-action="simChip" data-field="${field}" data-val="" aria-pressed="${simSel[field].size===0}">Semua</button>`;
  return all + values.map(v=>{ const on = simSel[field].has(v); return `<button type="button" class="chip-toggle ${on?'active':''}" data-action="simChip" data-field="${field}" data-val="${escHtml(v)}" aria-pressed="${on}">${escHtml((labelMap&&labelMap[v])||v)}</button>`; }).join("");
}
const SIM_PERMEN_SHORT = {"PERMEN LH 13 2009":"Permen LH 13/2009 · Turbin, Heater, Flare", "PERMEN LH 11 2021":"Permen LHK 11/2021 · Genset"};
function simRenderScopeChips(){
  const param = document.getElementById("simParam")?.value || "";
  // Hanya tawarkan jenis sumber yang memang punya data parameter ini, supaya chip tidak menyesatkan.
  const sumbers = [...new Set(DB.hasilPemantauan.filter(r=>!param || r.parameter===param).map(r=>r.namaSumber))].filter(Boolean).sort();
  [...simSel.sumber].forEach(s=>{ if(!sumbers.includes(s)) simSel.sumber.delete(s); });
  document.getElementById("simSumberChips").innerHTML = simRenderChipBar("sumber", sumbers);
  document.getElementById("simPermenChips").innerHTML = simRenderChipBar("permen", Object.keys(HD_PERMEN_LABEL), SIM_PERMEN_SHORT);
}
function simRenderParamTabs(){
  const sel = document.getElementById("simParam"), tabs = document.getElementById("simParamTabs");
  if(!sel || !tabs) return;
  const cur = sel.value;
  tabs.innerHTML = [...sel.options].map(o=>{
    const n = DB.hasilPemantauan.filter(r=>r.parameter===o.value && r.resultNumeric!=null).length;
    return `<button type="button" role="tab" class="${o.value===cur?"on":""}" aria-selected="${o.value===cur}" data-action="simSetParam" data-val="${escHtml(o.value)}">${escHtml(o.value)} <span>${n}</span></button>`;
  }).join("");
}
// Rekaman terukur pada lingkup & rentang periode simulasi yang aktif.
function simScopeRows(){
  const parameter = document.getElementById("simParam")?.value || "";
  const kapasitas = document.getElementById("simKapasitas")?.value || "";
  const bahanBakar = document.getElementById("simBahanBakar")?.value || "";
  const from = document.getElementById("simFrom")?.value, to = document.getElementById("simTo")?.value;
  const fromOrder = from ? hasilPeriodParts(from).order : -Infinity, toOrder = to ? hasilPeriodParts(to).order : Infinity;
  return DB.hasilPemantauan.filter(r=>{
    if(r.parameter!==parameter || r.resultNumeric==null) return false;
    if(simSel.sumber.size && !simSel.sumber.has(r.namaSumber)) return false;
    if(simSel.permen.size && !simSel.permen.has(r.regulasiCek)) return false;
    if(kapasitas && r.kategoriKapasitas!==kapasitas) return false;
    if(bahanBakar && r.jenisBahanBakar!==bahanBakar) return false;
    if(simSel.cerobong.size && !simSel.cerobong.has(r.cerobong)) return false;
    if(r.periodeOrder<fromOrder || r.periodeOrder>toOrder) return false;
    return true;
  });
}
function simOfficialStd(scope){
  const stds = scope.map(r=>r.standard).filter(v=>v!=null);
  if(!stds.length) return null;
  return {median: hdMedian(stds), min: Math.min(...stds), max: Math.max(...stds)};
}
// Dipanggil tiap render dashboard; isi dropdown sekali saja, lalu jalankan simulasi awal dengan
// usulan = baku mutu resmi (baseline), supaya bagian ini tidak pernah tampil kosong.
function hdRenderSimulationFilters(){
  const paramSel = document.getElementById("simParam");
  if(!paramSel || paramSel.options.length) return;
  const emisiParams = hdAllValues("parameter").filter(hdIsEmisiParam);
  const stdCount = p=>DB.hasilPemantauan.filter(r=>r.parameter===p && r.standard!=null && r.resultNumeric!=null).length;
  const ordered = emisiParams.slice().sort((a,b)=>stdCount(b)-stdCount(a));
  paramSel.innerHTML = ordered.map(p=>`<option value="${escHtml(p)}">${escHtml(p)}</option>`).join("");
  paramSel.value = ordered[0] || "";
  document.getElementById("simKapasitas").innerHTML += hdAllValues("kategoriKapasitas").map(k=>`<option value="${escHtml(k)}">${escHtml(k)}</option>`).join("");
  document.getElementById("simBahanBakar").innerHTML += hdAllValues("jenisBahanBakar").map(b=>`<option value="${escHtml(b)}">${escHtml(b)}</option>`).join("");
  const periods = [...new Set(DB.hasilPemantauan.map(r=>r.periode))].sort((a,b)=>hasilPeriodParts(a).order-hasilPeriodParts(b).order);
  const fromSel = document.getElementById("simFrom"), toSel = document.getElementById("simTo");
  fromSel.innerHTML = periods.map(p=>`<option value="${p}">${p}</option>`).join("");
  toSel.innerHTML = periods.map(p=>`<option value="${p}">${p}</option>`).join("");
  fromSel.value = periods[0]||"";
  toSel.value = periods[periods.length-1]||"";
  simRenderParamTabs();
  simRenderScopeChips();
  simRenderCerobongChecklist();
  simResetThresholdToOfficial();
  hdRunSimulation();
}
function simResetThresholdToOfficial(){
  const std = simOfficialStd(simScopeRows());
  const inp = document.getElementById("simThreshold");
  if(inp) inp.value = std ? std.median : "";
}
function simSetParam(val){
  const sel = document.getElementById("simParam");
  if(!sel || !val) return;
  sel.value = val;
  simSel.cerobong.clear();
  simRenderParamTabs(); simRenderScopeChips(); simRenderCerobongChecklist();
  simResetThresholdToOfficial();
  hdRunSimulation();
}
function simApplyPreset(val){
  const inp = document.getElementById("simThreshold");
  if(!inp) return;
  inp.value = val;
  hdRunSimulation();
}

// Menentukan tampilan tren yang representatif (lihat catatan lama: banyak garis per titik saling
// tumpang tindih, jadi otomatis dialihkan ke per site kalau titiknya banyak dan tidak ada yang dicentang).
const SIM_TREND_ENGINE_LIMIT = 10;
function simResolveTrendMode(engineCount, siteCount){
  if(simTrendMode!=="auto") return simTrendMode;
  if(simSel.cerobong.size>0) return "engine";
  if(engineCount<=SIM_TREND_ENGINE_LIMIT) return "engine";
  return "site";
}

/* ---------------- Charts simulasi ---------------- */
// Kurva sensitivitas: untuk setiap kandidat ambang, berapa persen titik yang pernah melebihi
// (garis jingga) dan yang masih melebihi pada data terbarunya (garis merah). Inilah alat utama
// untuk memilih angka usulan: terlihat langsung di angka berapa dampaknya melonjak.
function buildSimSensitivity(engines, threshold, std, unit){
  const n = engines.length;
  const maxAll = Math.max(...engines.map(e=>e.maxVal));
  const xMax = hdNiceMax(Math.max(maxAll, threshold, std?std.median:0)*1.08);
  const W=780, H=280, padL=48, padR=18, padT=24, padB=40, plotW=W-padL-padR, plotH=H-padT-padB;
  const x = v=>padL+v/xMax*plotW, y = p=>padT+plotH-p/100*plotH;
  const steps = 160;
  const ever = [], latest = [];
  for(let i=0;i<=steps;i++){
    const t = xMax*i/steps;
    ever.push([t, engines.filter(e=>e.maxVal>t).length/n*100]);
    latest.push([t, engines.filter(e=>e.latest.resultNumeric>t).length/n*100]);
  }
  const path = pts=>pts.map(([t,p],k)=>`${k?"L":"M"}${x(t).toFixed(1)},${y(p).toFixed(1)}`).join(" ");
  const area = pts=>path(pts)+` L${x(xMax).toFixed(1)},${y(0)} L${x(0)},${y(0)} Z`;
  let svg = `<svg class="hd-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Kurva sensitivitas persentase titik terdampak terhadap angka usulan">`;
  for(let g=0; g<=4; g++){
    svg += `<line x1="${padL}" y1="${y(g*25)}" x2="${W-padR}" y2="${y(g*25)}" class="hd-grid"/><text x="${padL-8}" y="${y(g*25)+4}" text-anchor="end" class="hd-axis">${g*25}%</text>`;
    svg += `<text x="${x(xMax*g/4).toFixed(1)}" y="${H-padB+18}" text-anchor="middle" class="hd-axis">${hdNum(xMax*g/4)}</text>`;
  }
  svg += `<text x="${(padL+W-padR)/2}" y="${H-6}" text-anchor="middle" class="hd-axis">Kandidat baku mutu (${escHtml(unit)})</text>`;
  svg += `<path d="${area(ever)}" fill="${SIM_PROPOSAL_COLOR}" fill-opacity=".1"/>`;
  svg += `<path d="${path(ever)}" fill="none" stroke="${SIM_PROPOSAL_COLOR}" stroke-width="2.5"/>`;
  svg += `<path d="${path(latest)}" fill="none" stroke="#b42318" stroke-width="2" stroke-dasharray="5 4"/>`;
  if(std){
    svg += `<line x1="${x(std.median).toFixed(1)}" y1="${padT-8}" x2="${x(std.median).toFixed(1)}" y2="${y(0)}" class="hd-ref"/>`;
    svg += `<text x="${(x(std.median)+5).toFixed(1)}" y="${padT-10}" class="hd-ref-label">BM resmi ${hdNum(std.median)}</text>`;
  }
  const pe = engines.filter(e=>e.maxVal>threshold).length/n*100, pl = engines.filter(e=>e.latest.resultNumeric>threshold).length/n*100;
  const tx = x(Math.min(threshold, xMax));
  svg += `<line x1="${tx.toFixed(1)}" y1="${padT}" x2="${tx.toFixed(1)}" y2="${y(0)}" stroke="var(--heading)" stroke-width="2"/>`;
  svg += `<circle cx="${tx.toFixed(1)}" cy="${y(pe).toFixed(1)}" r="5.5" fill="${SIM_PROPOSAL_COLOR}" stroke="var(--surface-card)" stroke-width="2"/>`;
  svg += `<circle cx="${tx.toFixed(1)}" cy="${y(pl).toFixed(1)}" r="4.5" fill="#b42318" stroke="var(--surface-card)" stroke-width="2"/>`;
  const labLeft = tx > W*0.62;
  svg += `<g font-size="12" font-weight="700"><rect x="${(labLeft?tx-178:tx+8).toFixed(1)}" y="${(y(pe)-30).toFixed(1)}" width="170" height="22" rx="6" fill="var(--heading)"/><text x="${(labLeft?tx-170:tx+16).toFixed(1)}" y="${(y(pe)-15).toFixed(1)}" fill="var(--surface-card)">Usulan ${hdNum(threshold)} &middot; ${hdNum(pe,0)}% titik</text></g>`;
  svg += `</svg>`;
  const legend = `<div class="legend"><span class="item"><span class="sw" style="background:${SIM_PROPOSAL_COLOR}"></span>Pernah melebihi dalam rentang periode</span><span class="item"><span class="sw hd-sw-ref" style="border-top-color:#b42318"></span>Masih melebihi pada data terbaru</span>${std?`<span class="item"><span class="sw hd-sw-ref"></span>Baku mutu resmi</span>`:""}</div>`;
  return svg+legend;
}
function buildSimTrendChart(scope, periodsInScope, threshold, unit, mode, std){
  if(!periodsInScope.length) return hdEmpty("Tidak ada periode data pada rentang yang dipilih.");
  let seriesKeys = [], keyFn, colorFn;
  if(mode==="site"){
    seriesKeys = [...new Set(scope.map(r=>r.site))].sort(); keyFn = r=>r.site; colorFn = k=>hdSiteColor(k);
  }else if(mode!=="avg"){
    seriesKeys = simSel.cerobong.size>0 ? [...simSel.cerobong].filter(c=>scope.some(r=>r.cerobong===c)) : [...new Set(scope.map(r=>r.cerobong))];
    keyFn = r=>r.cerobong; colorFn = (k,i)=>HD_PALETTE[i%HD_PALETTE.length];
  }
  if(mode!=="avg" && !seriesKeys.length) return hdEmpty("Tidak ada data untuk ditampilkan pada rentang periode ini.");
  const W=780, H=300, padL=50, padR=18, padT=22, padB=36, plotW=W-padL-padR, plotH=H-padT-padB;
  const n = periodsInScope.length;
  const showStd = std && std.median<=Math.max(...scope.map(r=>r.resultNumeric), threshold)*2.5;
  const yMax = hdNiceMax(Math.max(...scope.map(r=>r.resultNumeric), threshold, showStd?std.median:0)*1.08);
  const x = i=>padL+(n<=1?plotW/2:i/(n-1)*plotW), y = v=>padT+plotH-v/yMax*plotH;
  let svg = `<svg class="hd-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Trend nilai terhadap usulan baku mutu">`;
  svg += `<rect x="${padL}" y="${padT}" width="${plotW}" height="${Math.max(0,y(threshold)-padT).toFixed(1)}" fill="${SIM_PROPOSAL_COLOR}" fill-opacity=".07"/>`;
  for(let g=0; g<=4; g++){ const v = yMax*g/4; svg += `<line x1="${padL}" y1="${y(v).toFixed(1)}" x2="${W-padR}" y2="${y(v).toFixed(1)}" class="hd-grid"/><text x="${padL-8}" y="${(y(v)+4).toFixed(1)}" text-anchor="end" class="hd-axis">${hdNum(v)}</text>`; }
  periodsInScope.forEach((p,i)=>{ svg += `<text x="${x(i).toFixed(1)}" y="${H-12}" text-anchor="middle" class="hd-axis ${i===n-1?"strong":""}">${p}</text>`; });
  if(showStd) svg += `<line x1="${padL}" y1="${y(std.median).toFixed(1)}" x2="${W-padR}" y2="${y(std.median).toFixed(1)}" class="hd-ref"/><text x="${W-padR}" y="${(y(std.median)-6).toFixed(1)}" text-anchor="end" class="hd-ref-label">BM resmi ${hdNum(std.median)}</text>`;
  svg += `<line x1="${padL}" y1="${y(threshold).toFixed(1)}" x2="${W-padR}" y2="${y(threshold).toFixed(1)}" stroke="${SIM_PROPOSAL_COLOR}" stroke-width="2"/><text x="${padL+6}" y="${(y(threshold)-6).toFixed(1)}" font-size="11" font-weight="700" fill="${SIM_PROPOSAL_COLOR}">Usulan ${hdNum(threshold)}</text>`;
  let legend = "";
  if(mode==="avg"){
    const top=[], bot=[], avg=[];
    periodsInScope.forEach((p,i)=>{
      const vals = scope.filter(r=>r.periode===p).map(r=>r.resultNumeric);
      if(!vals.length) return;
      top.push([x(i), y(Math.max(...vals))]); bot.push([x(i), y(Math.min(...vals))]); avg.push([x(i), y(hdMean(vals))]);
    });
    if(top.length){
      svg += `<path d="M${top.map(p=>p.map(v=>v.toFixed(1)).join(",")).join("L")}L${bot.slice().reverse().map(p=>p.map(v=>v.toFixed(1)).join(",")).join("L")}Z" fill="#0ea5a0" fill-opacity=".16"/>`;
      svg += `<path d="M${avg.map(p=>p.map(v=>v.toFixed(1)).join(",")).join("L")}" fill="none" stroke="#0b7f7a" stroke-width="2.5"/>`;
      avg.forEach(p=>{ svg += `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="4" fill="#0b7f7a"/>`; });
    }
    legend = `<span class="item"><span class="sw" style="background:#0b7f7a"></span>Rata-rata seluruh titik</span><span class="item"><span class="sw" style="background:#0ea5a0;opacity:.35"></span>Rentang min sampai maks</span>`;
  }else{
    seriesKeys.forEach((k,i)=>{
      const color = colorFn(k,i);
      const pts = periodsInScope.map((p,pi)=>{ const vals = scope.filter(r=>keyFn(r)===k && r.periode===p).map(r=>r.resultNumeric); return vals.length ? [pi, hdMean(vals)] : null; }).filter(Boolean);
      for(let j=1;j<pts.length;j++){ const [i0,v0]=pts[j-1],[i1,v1]=pts[j]; svg += `<line x1="${x(i0).toFixed(1)}" y1="${y(v0).toFixed(1)}" x2="${x(i1).toFixed(1)}" y2="${y(v1).toFixed(1)}" stroke="${color}" stroke-width="2.2" stroke-linecap="round" ${i1-i0>1?'stroke-dasharray="3 5"':""}/>`; }
      pts.forEach(([pi,v])=>{ svg += `<circle cx="${x(pi).toFixed(1)}" cy="${y(v).toFixed(1)}" r="${v>threshold?5:3.6}" fill="${color}" stroke="${v>threshold?"#b42318":"var(--surface-card)"}" stroke-width="${v>threshold?2:1.5}"><title>${escHtml(k)} ${periodsInScope[pi]}: ${hdNum(v)} ${escHtml(unit)}</title></circle>`; });
    });
    legend = seriesKeys.map((k,i)=>`<span class="item"><span class="sw" style="background:${colorFn(k,i)}"></span>${escHtml(k)}</span>`).join("");
  }
  svg += `</svg>`;
  legend += `<span class="item"><span class="sw" style="background:${SIM_PROPOSAL_COLOR}"></span>Usulan baku mutu</span><span class="item muted">Titik bercincin merah: melebihi usulan.</span>`;
  return `${svg}<div class="legend">${legend}</div>`;
}
// Nilai tertinggi per titik sebagai batang HTML (teks tajam di semua ukuran layar), dengan penanda usulan.
function buildSimEngineChart(engines, threshold, unit, std){
  if(!engines.length) return "";
  const rows = engines.slice().sort((a,b)=>b.maxVal-a.maxVal).slice(0,15);
  const scale = Math.max(threshold, ...rows.map(r=>r.maxVal))*1.08;
  const pos = v=>(Math.min(v,scale)/scale*100).toFixed(1)+"%";
  return `<div class="sim-bars">${rows.map(r=>{
    const cls = r.currentlyExceeds ? "bad" : r.exceedCount ? "warn" : "ok";
    return `<div class="sim-bar-row">
      <span class="sim-bar-name" title="${escHtml(r.cerobong)}"><i style="background:${hdSiteColor(r.site)}"></i>${escHtml(r.cerobong)}</span>
      <span class="sim-bar-track"><i class="${cls}" style="width:${pos(r.maxVal)}"></i><b style="left:${pos(threshold)}"></b>${std&&std.median<=scale?`<em style="left:${pos(std.median)}"></em>`:""}</span>
      <span class="sim-bar-val ${cls}">${hdNum(r.maxVal)}</span>
    </div>`;
  }).join("")}</div>
  <div class="legend"><span class="item"><span class="sw" style="background:#b42318"></span>Data terbaru pun melebihi</span><span class="item"><span class="sw" style="background:${SIM_PROPOSAL_COLOR}"></span>Pernah melebihi</span><span class="item"><span class="sw" style="background:#2f9e67"></span>Selalu di bawah usulan</span><span class="item"><span class="sw" style="background:var(--heading);width:3px"></span>Usulan</span>${std?`<span class="item"><span class="sw hd-sw-ref"></span>BM resmi</span>`:""}</div>
  ${engines.length>15?`<div class="hint">15 dari ${engines.length} titik dengan nilai tertinggi. Satuan ${escHtml(unit)}.</div>`:`<div class="hint">Satuan ${escHtml(unit)}.</div>`}`;
}
function simSpark(values, threshold){
  const pts = values.map((v,i)=>v==null?null:[i,v]).filter(Boolean);
  if(!pts.length) return "-";
  const W=110, H=30, n=values.length, hi = Math.max(threshold, ...pts.map(p=>p[1]))*1.1 || 1;
  const x = i=>4+(n<=1?(W-8)/2:i/(n-1)*(W-8)), y = v=>H-3-v/hi*(H-6);
  let s = `<svg class="hd-spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true"><line x1="2" y1="${y(threshold).toFixed(1)}" x2="${W-2}" y2="${y(threshold).toFixed(1)}" stroke="${SIM_PROPOSAL_COLOR}" stroke-width="1.2" stroke-dasharray="3 2"/>`;
  s += `<path d="${pts.map(([i,v],k)=>`${k?"L":"M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")}" fill="none" stroke="var(--heading-2)" stroke-width="1.6"/>`;
  pts.forEach(([i,v])=>{ if(v>threshold) s += `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="2.6" fill="#b42318"/>`; });
  return s+`</svg>`;
}

function hdRunSimulation(){
  const out = document.getElementById("simResult");
  if(!out) return;
  const parameter = document.getElementById("simParam").value;
  const from = document.getElementById("simFrom").value, to = document.getElementById("simTo").value;
  const inp = document.getElementById("simThreshold");
  const scope = simScopeRows();
  const std = simOfficialStd(scope);
  if(inp && inp.value==="" && std) inp.value = std.median;
  const threshold = parseFloat(inp?.value);
  const unit = scope[0]?.unit || "";
  // Sinkronkan kontrol usulan (satuan, slider, catatan BM resmi, preset)
  const maxAll = scope.length ? Math.max(...scope.map(r=>r.resultNumeric)) : 0;
  const slider = document.getElementById("simSlider");
  if(slider){
    const sMax = hdNiceMax(Math.max(maxAll, std?std.median:0, isFinite(threshold)?threshold:0)*1.2 || 100);
    slider.max = sMax; slider.step = sMax/200;
    if(isFinite(threshold)) slider.value = threshold;
  }
  const unitEl = document.getElementById("simUnit"); if(unitEl) unitEl.textContent = unit;
  const ref = document.getElementById("simRefNote");
  if(ref){
    ref.innerHTML = std
      ? `BM resmi lingkup ini <b>${hdNum(std.median)} ${escHtml(unit)}</b>${std.min!==std.max?` <span class="warn">(bervariasi ${hdNum(std.min)} sampai ${hdNum(std.max)}; persempit lingkup per regulasi atau jenis sumber agar perbandingannya adil)</span>`:""}. Nilai tertinggi tercatat ${hdNum(maxAll)} ${escHtml(unit)}.`
      : scope.length ? `Lingkup ini belum memiliki baku mutu resmi. Nilai tertinggi tercatat ${hdNum(maxAll)} ${escHtml(unit)}.` : "";
  }
  const presets = document.getElementById("simPresets");
  if(presets){
    const base = std ? std.median : null;
    presets.innerHTML = base ? [["BM resmi",base],["−10%",base*0.9],["−20%",base*0.8],["−30%",base*0.7],["−50%",base*0.5]].map(([l,v])=>{
      const val = Math.round(v*100)/100;
      return `<button type="button" class="${isFinite(threshold)&&Math.abs(threshold-val)<1e-9?"on":""}" data-action="simPreset" data-val="${val}">${l}<span>${hdNum(val)}</span></button>`;
    }).join("") : "";
  }
  if(!parameter){ out.innerHTML = hdEmpty("Pilih parameter yang ingin diuji terlebih dahulu."); return; }
  if(!scope.length){ out.innerHTML = hdEmpty("Tidak ada riwayat data terukur untuk kombinasi parameter, lingkup, dan periode ini."); return; }
  if(!isFinite(threshold)){ out.innerHTML = hdEmpty("Masukkan angka usulan baku mutu baru, atau pilih salah satu preset."); return; }

  const byEngine = {};
  scope.forEach(r=>{ (byEngine[r.cerobong] = byEngine[r.cerobong] || {cerobong:r.cerobong, site:r.site, namaSumber:r.namaSumber, records:[]}).records.push(r); });
  const periodsInScope = hdSortPeriods(scope.map(r=>r.periode));
  const engines = Object.values(byEngine).map(o=>{
    o.records.sort((a,b)=>a.periodeOrder-b.periodeOrder);
    const exceedCount = o.records.filter(r=>r.resultNumeric>threshold).length;
    const maxVal = Math.max(...o.records.map(r=>r.resultNumeric));
    const latest = o.records[o.records.length-1];
    const series = periodsInScope.map(p=>{ const r = o.records.find(x=>x.periode===p); return r ? r.resultNumeric : null; });
    return {...o, exceedCount, maxVal, latest, series, currentlyExceeds: latest.resultNumeric>threshold, unit: latest.unit};
  }).sort((a,b)=> (b.currentlyExceeds-a.currentlyExceeds) || (b.exceedCount-a.exceedCount) || (b.maxVal-a.maxVal));
  const impacted = engines.filter(e=>e.exceedCount>0);
  const nowExceed = engines.filter(e=>e.currentlyExceeds);
  const rowsExceed = scope.filter(r=>r.resultNumeric>threshold).length;
  const resolvedMode = simResolveTrendMode(engines.length, new Set(scope.map(r=>r.site)).size);
  const tighten = std ? (threshold-std.median)/std.median*100 : null;
  const pctImp = impacted.length/engines.length*100;

  // Ambang "aman": tidak berdampak ke titik mana pun, dan ambang yang hanya berdampak ke ~10% titik.
  const maxSorted = engines.map(e=>e.maxVal).sort((a,b)=>b-a);
  const p10 = maxSorted[Math.min(maxSorted.length-1, Math.floor(engines.length*0.1))];

  const kpis = [
    hdKpi({label:"Titik terdampak", icon:HD_IC.alert, tone: impacted.length?"bad":"good",
      value:`${impacted.length}<small> / ${engines.length}</small>`,
      spark:`<div class="hd-mini-bar" role="img" aria-label="${hdNum(pctImp,0)}% titik terdampak"><i style="width:${pctImp.toFixed(1)}%;background:${impacted.length?SIM_PROPOSAL_COLOR:"#2f9e67"}"></i></div>`,
      foot:`${hdNum(pctImp,0)}% titik pernah melebihi ${hdNum(threshold)} ${escHtml(unit)}`}),
    hdKpi({label:"Melebihi saat ini", icon:HD_IC.clock, tone: nowExceed.length?"warn":"",
      value: hdNum(nowExceed.length,0), suffix:" titik",
      foot: nowExceed.length ? "Data terbarunya di atas usulan, harus turun sebelum usulan berlaku" : "Semua data terbaru di bawah usulan"}),
    hdKpi({label:"Data melebihi usulan", icon:HD_IC.db, value: hdNum(rowsExceed,0), suffix:` / ${scope.length} baris`,
      foot:`${hdNum(rowsExceed/scope.length*100,1)}% dari riwayat ${from} sampai ${to}`}),
    hdKpi({label:"Usulan vs BM resmi", icon:HD_IC.trend, tone: tighten!=null && tighten<-0.05 ? "warn" : "",
      value: tighten==null ? "-" : hdSignedPct(tighten),
      foot: std ? (tighten<-0.05 ? `Pengetatan dari ${hdNum(std.median)} menjadi ${hdNum(threshold)} ${escHtml(unit)}` : tighten>0.05 ? `Pelonggaran dari ${hdNum(std.median)} ${escHtml(unit)}` : `Sama dengan BM resmi ${hdNum(std.median)} ${escHtml(unit)}`) : "Lingkup ini tanpa BM resmi"})
  ].join("");

  const worst = nowExceed[0] || impacted[0];
  const verdictTone = nowExceed.length ? "bad" : impacted.length ? "warn" : "good";
  const verdictTitle = nowExceed.length ? "Berdampak langsung" : impacted.length ? "Berdampak pada riwayat" : "Aman untuk lingkup ini";
  const verdictText = !impacted.length
    ? `Tidak ada satu pun dari ${engines.length} titik yang pernah melebihi ${hdNum(threshold)} ${escHtml(unit)} pada ${from} sampai ${to}. Dengan data saat ini, usulan ini masih bisa diperketat sampai sekitar ${hdNum(maxSorted[0])} ${escHtml(unit)} tanpa berdampak.`
    : `${impacted.length} dari ${engines.length} titik (${hdNum(pctImp,0)}%) pernah melebihi usulan${nowExceed.length?`, dan <b>${nowExceed.length} titik masih melebihi pada data terbarunya</b>`:", namun semua data terbarunya sudah di bawah usulan"}. ${worst?`Paling berat: <b>${escHtml(worst.cerobong)}</b> (${escHtml(worst.site)}), perlu turun ${hdNum((worst.currentlyExceeds?worst.latest.resultNumeric:worst.maxVal)-threshold)} ${escHtml(unit)} (${hdNum(((worst.currentlyExceeds?worst.latest.resultNumeric:worst.maxVal)-threshold)/(worst.currentlyExceeds?worst.latest.resultNumeric:worst.maxVal)*100,0)}%).`:""} Usulan &ge; ${hdNum(maxSorted[0])} tidak berdampak ke titik mana pun${p10<maxSorted[0]?`; usulan sekitar ${hdNum(p10)} hanya berdampak ke &plusmn;10% titik`:""}.`;

  const tableRows = simShowAll ? engines : engines.slice(0, Math.max(impacted.length, 12));
  const table = `<div class="tablewrap hd-table-wrap"><table class="hd-table">
    <thead><tr><th>Titik atau engine</th><th class="num">Terbaru</th><th class="num">Maks tercatat</th><th>Trend vs usulan</th><th>Data &gt; usulan</th><th class="num">Reduksi diperlukan</th><th>Status</th></tr></thead>
    <tbody>${tableRows.map(e=>{
      const need = e.currentlyExceeds ? (e.latest.resultNumeric-threshold)/e.latest.resultNumeric*100 : null;
      const share = e.exceedCount/e.records.length*100;
      const status = e.currentlyExceeds ? `<span class="badge b-red">Masih melebihi</span>` : e.exceedCount ? `<span class="badge hd-b-warn">Pernah melebihi</span>` : `<span class="badge b-green">Selalu di bawah</span>`;
      return `<tr>
        <td><div class="hd-cell-main"><span class="hd-site"><i style="background:${hdSiteColor(e.site)}"></i>${escHtml(e.cerobong)}</span><span class="hd-cell-sub">${escHtml(e.site)} &middot; ${escHtml(e.namaSumber||"")}</span></div></td>
        <td class="num ${e.currentlyExceeds?"sim-bad":""}">${hdNum(e.latest.resultNumeric)} <span class="muted">${e.latest.periode}</span></td>
        <td class="num">${hdNum(e.maxVal)}</td>
        <td>${simSpark(e.series, threshold)}</td>
        <td><div class="hd-bullet"><div class="track"><i style="width:${share.toFixed(1)}%;background:${e.exceedCount?SIM_PROPOSAL_COLOR:"#2f9e67"}"></i></div><span class="v">${e.exceedCount}/${e.records.length}</span></div></td>
        <td class="num">${need==null?"-":`<span class="hd-delta up">−${hdNum(need,0)}%</span>`}</td>
        <td>${status}</td>
      </tr>`;
    }).join("")}</tbody></table></div>
    ${engines.length>tableRows.length || simShowAll ? `<button type="button" class="btn small ghost" data-action="simToggleAll" style="margin-top:8px;">${simShowAll?"Tampilkan ringkas":`Tampilkan semua ${engines.length} titik`}</button>` : ""}`;

  out.innerHTML = `
    <div class="sim-verdict ${verdictTone}">
      <div class="sim-verdict-badge">${verdictTitle}</div>
      <p>${verdictText}</p>
      <div class="sim-verdict-meta">${escHtml(parameter)} &middot; ${scope.length} baris dari ${engines.length} titik &middot; ${from} sampai ${to}</div>
    </div>
    <div class="hd-kpis sim-kpis">${kpis}</div>
    <div class="card sim-card">
      <div class="cardhead"><div><h3>Sensitivity Curve</h3><div class="hint hd-sub">Persentase titik terdampak untuk setiap kandidat angka baku mutu. Garis vertikal hitam adalah usulan saat ini; geser slider untuk melihat titik di mana dampaknya mulai melonjak.</div></div>
        <button class="btn small ghost" data-action="hdZoomChart" data-target="simSensWrap" data-title="Sensitivity Curve Usulan Baku Mutu">Perbesar</button></div>
      <div id="simSensWrap">${buildSimSensitivity(engines, threshold, std, unit)}</div>
    </div>
    <div class="hd-row">
      <div class="card hd-col-wide">
        <div class="cardhead"><div><h3>Trend vs Usulan</h3><div class="hint hd-sub">${simTrendMode==="auto"?`Mode otomatis: <b>${resolvedMode==="engine"?"per titik":resolvedMode==="site"?"per site":"rata-rata gabungan"}</b> (${engines.length} titik pada lingkup).`:"Mode dipilih manual."} Area jingga muda berada di atas usulan.</div></div>
          <button class="btn small ghost" data-action="hdZoomChart" data-target="simTrendWrap" data-title="Trend Nilai terhadap Usulan Baku Mutu">Perbesar</button></div>
        <div class="hd-seg">${hdSeg("simSetTrendMode", simTrendMode, [["auto","Otomatis"],["engine","Per Titik"],["site","Per Site"],["avg","Rata-rata"]]).replace(/data-val=/g,"data-mode=")}</div>
        <div id="simTrendWrap">${buildSimTrendChart(scope, periodsInScope, threshold, unit, resolvedMode, std)}</div>
      </div>
      <div class="card hd-col-side">
        <div class="cardhead"><div><h3>Nilai Tertinggi per Titik</h3><div class="hint hd-sub">Nilai maksimum tiap titik pada rentang periode, dibandingkan usulan.</div></div>
          <button class="btn small ghost" data-action="hdZoomChart" data-target="simEngineWrap" data-title="Nilai Tertinggi per Titik terhadap Usulan">Perbesar</button></div>
        <div id="simEngineWrap">${buildSimEngineChart(engines, threshold, unit, std)}</div>
      </div>
    </div>
    <div class="card sim-card">
      <div class="cardhead"><div><h3>Impact Table</h3><div class="hint hd-sub">Titik terdampak di urutan teratas. Reduksi diperlukan = penurunan dari data terbaru agar berada di bawah usulan.</div></div></div>
      ${table}
    </div>`;
}

/* =========================================================
   PEMANTAUAN KANDUNGAN SULFUR (H2S) — bagian berdiri sendiri di dasar Dashboard, TIDAK ikut
   filter dashboard di atas (selalu menampilkan seluruh riwayat), karena tujuannya murni sebagai
   bukti pendukung kepatuhan Pasal 12 ayat (2) huruf b, bukan analisis yang perlu difilter-filter.
========================================================= */
const H2S_TO_SULFUR_FACTOR = 32.06/34.08; // fraksi massa S dalam molekul H2S
const H2S_LIMIT_PCT = 0.5;                // ambang kandungan sulfur, % berat
const SCI_SUP_DIGITS = {"-":"⁻","0":"⁰","1":"¹","2":"²","3":"³","4":"⁴","5":"⁵","6":"⁶","7":"⁷","8":"⁸","9":"⁹"};
function fmtSci(num){
  if(num==null || !isFinite(num)) return "-";
  if(num===0) return "0";
  const exp = Math.floor(Math.log10(Math.abs(num)));
  const mantissa = num/Math.pow(10,exp);
  const expStr = String(exp).split("").map(c=>SCI_SUP_DIGITS[c]||c).join("");
  return `${mantissa.toFixed(2)} &times; 10${expStr}`;
}
function fmtDecPct(num){
  if(num==null || !isFinite(num)) return "-";
  return num.toFixed(5)+"%";
}
// % (fraksi massa x 100) ke ppm: 1% = 10.000 ppm. Lebih mudah dibaca daripada 0,00373%.
function h2sPpm(pct){ return pct*1e4; }
function h2sRecords(){
  return DB.hasilPemantauan.filter(r=>r.parameter==="H2S" && r.resultNumeric!=null)
    .slice().sort((a,b)=> a.site.localeCompare(b.site) || a.cerobong.localeCompare(b.cerobong) || a.periodeOrder-b.periodeOrder);
}
function buildH2STrendChart(records){
  const sites = [...new Set(records.map(r=>r.site))].sort();
  const periods = hdSortPeriods(records.map(r=>r.periode));
  if(!periods.length) return hdEmpty("Belum ada data H₂S.");
  const W=420, H=280, padL=44, padR=74, padT=24, padB=36, plotW=W-padL-padR, plotH=H-padT-padB;
  const yMax = hdNiceMax(Math.max(...records.map(r=>h2sPpm(r.resultNumeric)))*1.1 || 1);
  const n = periods.length;
  const x = i=>padL+(n<=1?plotW/2:i/(n-1)*plotW), y = v=>padT+plotH-v/yMax*plotH;
  let svg = `<svg class="hd-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Trend H2S per site dalam ppm">`;
  for(let g=0; g<=4; g++){ const v = yMax*g/4; svg += `<line x1="${padL}" y1="${y(v).toFixed(1)}" x2="${W-padR}" y2="${y(v).toFixed(1)}" class="hd-grid"/><text x="${padL-6}" y="${(y(v)+4).toFixed(1)}" text-anchor="end" class="hd-axis">${hdNum(v)}</text>`; }
  periods.forEach((p,i)=>{ svg += `<text x="${x(i).toFixed(1)}" y="${H-12}" text-anchor="middle" class="hd-axis ${i===n-1?"strong":""}">${p.replace(/^S(\d) \d{2}(\d{2})$/,"S$1 '$2")}</text>`; });
  svg += `<text x="${padL}" y="${padT-10}" class="hd-axis tiny">ppm</text>`;
  const labels = [];
  sites.forEach(site=>{
    const color = hdSiteColor(site);
    const pts = periods.map((p,i)=>{ const vals = records.filter(r=>r.site===site && r.periode===p).map(r=>h2sPpm(r.resultNumeric)); return vals.length ? [i, hdMean(vals)] : null; }).filter(Boolean);
    for(let k=1;k<pts.length;k++){ const [i0,v0]=pts[k-1],[i1,v1]=pts[k]; svg += `<line x1="${x(i0).toFixed(1)}" y1="${y(v0).toFixed(1)}" x2="${x(i1).toFixed(1)}" y2="${y(v1).toFixed(1)}" stroke="${color}" stroke-width="2.2" stroke-linecap="round"/>`; }
    pts.forEach(([i,v])=>{ svg += `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3.4" fill="${color}" stroke="var(--surface-card)" stroke-width="1.2"><title>${escHtml(site)} ${periods[i]}: ${hdNum(v)} ppm</title></circle>`; });
    if(pts.length){ const [, lv] = pts[pts.length-1]; labels.push({site, color, y:y(lv), v:lv}); }
  });
  labels.sort((a,b)=>a.y-b.y);
  for(let i=1;i<labels.length;i++) if(labels[i].y-labels[i-1].y<13) labels[i].y = labels[i-1].y+13;
  labels.forEach(l=>{ svg += `<text x="${W-padR+8}" y="${(l.y+4).toFixed(1)}" class="hd-end-label" font-size="11" fill="${l.color}">${escHtml(l.site)} ${hdNum(l.v)}</text>`; });
  return svg+`</svg>`;
}
// Strip plot logaritmik: satu lajur per site, sumbu x = setara kandungan sulfur (% berat) dari 10^-5
// sampai 1, dengan ambang 0,5% sebagai garis merah dan wilayah di atasnya diarsir.
function buildH2SLogStrip(records){
  if(!records.length) return hdEmpty("Belum ada data H₂S.");
  const sites = [...new Set(records.map(r=>r.site))].sort();
  const lo = -5, hi = 0; // log10(% berat)
  const W=720, laneH=30, padL=56, padR=36, padT=56, padB=44;
  const H = padT + sites.length*laneH + padB;
  const plotW = W-padL-padR;
  const x = pct=>padL+(Math.max(lo, Math.min(hi, Math.log10(Math.max(pct, 1e-12))))-lo)/(hi-lo)*plotW;
  let svg = `<svg class="hd-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Posisi setiap hasil uji sulfur terhadap ambang 0,5% pada skala logaritmik">`;
  const xl = x(H2S_LIMIT_PCT);
  svg += `<rect x="${xl.toFixed(1)}" y="${padT-10}" width="${(W-padR-xl).toFixed(1)}" height="${sites.length*laneH+10}" fill="#b42318" fill-opacity=".09"/>`;
  for(let e=lo; e<=hi; e++){
    const xx = x(Math.pow(10,e));
    svg += `<line x1="${xx.toFixed(1)}" y1="${padT-10}" x2="${xx.toFixed(1)}" y2="${padT+sites.length*laneH}" class="hd-grid"/>`;
    const lab = e===0 ? "1%" : e===-1 ? "0,1%" : `${"0,"+"0".repeat(-e-1)}1%`;
    svg += `<text x="${xx.toFixed(1)}" y="${padT+sites.length*laneH+16}" text-anchor="middle" class="hd-axis">${lab}</text>`;
    svg += `<text x="${xx.toFixed(1)}" y="${padT+sites.length*laneH+30}" text-anchor="middle" class="hd-axis tiny">${hdNum(Math.pow(10,e)*1e4)} ppm</text>`;
  }
  sites.forEach((s,i)=>{
    const cy = padT + i*laneH + laneH/2;
    svg += `<line x1="${padL}" y1="${cy}" x2="${W-padR}" y2="${cy}" stroke="var(--gray-200)" stroke-dasharray="2 4"/>`;
    svg += `<text x="${padL-10}" y="${cy+4}" text-anchor="end" class="hd-axis strong">${escHtml(s)}</text>`;
    const rs = records.filter(r=>r.site===s);
    const latestOrder = Math.max(...rs.map(r=>r.periodeOrder));
    rs.forEach(r=>{
      const sul = r.resultNumeric*H2S_TO_SULFUR_FACTOR;
      const isLatest = r.periodeOrder===latestOrder;
      svg += `<circle cx="${x(sul).toFixed(1)}" cy="${cy}" r="${isLatest?6:4.2}" fill="${hdSiteColor(s)}" fill-opacity="${isLatest?1:.45}" stroke="${isLatest?"var(--heading)":"none"}" stroke-width="1.5"><title>${escHtml(r.cerobong)} ${r.periode}: ${hdNum(h2sPpm(r.resultNumeric))} ppm H2S, setara sulfur ${fmtDecPct(sul)}</title></circle>`;
    });
  });
  svg += `<line x1="${xl.toFixed(1)}" y1="${padT-36}" x2="${xl.toFixed(1)}" y2="${padT+sites.length*laneH}" stroke="#b42318" stroke-width="2"/>`;
  svg += `<text x="${(xl-6).toFixed(1)}" y="${padT-40}" text-anchor="end" class="hd-ref-label">Ambang 0,5% berat</text>`;
  // Braket headroom dari nilai tertinggi ke ambang.
  const worst = records.reduce((a,b)=>b.resultNumeric>a.resultNumeric?b:a);
  const wx = x(worst.resultNumeric*H2S_TO_SULFUR_FACTOR), by = padT-12;
  const ratio = H2S_LIMIT_PCT/(worst.resultNumeric*H2S_TO_SULFUR_FACTOR);
  svg += `<line x1="${wx.toFixed(1)}" y1="${by}" x2="${(xl-2).toFixed(1)}" y2="${by}" stroke="var(--heading)" stroke-width="1.5" marker-end="url(#h2sArrow)"/>`;
  svg += `<defs><marker id="h2sArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="var(--heading)"/></marker></defs>`;
  svg += `<text x="${((wx+xl)/2).toFixed(1)}" y="${by-6}" text-anchor="middle" font-size="12" font-weight="800" fill="var(--heading)">${hdNum(ratio,0)}&times; headroom</text>`;
  svg += `</svg>`;
  return svg + `<div class="legend"><span class="item"><span class="sw" style="border-radius:6px;background:var(--gray-500)"></span>Titik besar bergaris: periode terbaru per site</span><span class="item"><span class="sw" style="background:#b42318;opacity:.25"></span>Wilayah di atas ambang</span><span class="item muted">Setara sulfur = H&#8322;S &times; 0,9407</span></div>`;
}
function buildH2SMatrix(records){
  if(!records.length) return hdEmpty("Belum ada data H₂S.");
  const periods = hdSortPeriods(records.map(r=>r.periode));
  const pts = [...new Map(records.map(r=>[r.cerobong, r])).values()].sort((a,b)=>a.site.localeCompare(b.site));
  const maxPpm = Math.max(...records.map(r=>h2sPpm(r.resultNumeric)));
  const shade = v=>{ const t = maxPpm ? v/maxPpm : 0; return t>0.75?["#1f6f69","#fff"]:t>0.5?["#2c8f87","#fff"]:t>0.25?["#93cdc6","#0f1b2d"]:t>0.08?["#cfe8e5","#0f1b2d"]:["#eef6f5","#0f1b2d"]; };
  const head = `<tr><th></th>${periods.map((p,i)=>`<th class="${i===periods.length-1?"strong":""}">${p}</th>`).join("")}<th>Trend</th></tr>`;
  const body = pts.map(pt=>{
    const vals = periods.map(p=>{ const r = records.find(x=>x.cerobong===pt.cerobong && x.periode===p); return r ? h2sPpm(r.resultNumeric) : null; });
    return `<tr><th class="rowh"><div class="hd-cell-main"><span class="hd-site"><i style="background:${hdSiteColor(pt.site)}"></i>${escHtml(pt.site)}</span><span class="hd-cell-sub">${escHtml(pt.cerobong)}</span></div></th>${vals.map((v,i)=>{
      if(v==null) return `<td class="hd-hc empty">&ndash;</td>`;
      const [bg,fg] = shade(v);
      return `<td class="hd-hc" style="background:${bg};color:${fg}" title="${escHtml(pt.cerobong)} ${periods[i]}: ${hdNum(v)} ppm"><b>${hdNum(v)}</b><small>${hdNum(v/1e4*H2S_TO_SULFUR_FACTOR/H2S_LIMIT_PCT*100,3)}% ambang</small></td>`;
    }).join("")}<td>${hdSpark(vals, {w:90, h:28, color:hdSiteColor(pt.site), zero:true}) || "-"}</td></tr>`;
  }).join("");
  return `<div class="tablewrap hd-table-wrap"><table class="hd-heat h2s-matrix">${head}${body}</table></div>`;
}
function renderH2SSection(){
  const wrap = document.getElementById("h2sDetailTable");
  if(!wrap) return; // halaman lain, bukan Dashboard Hasil Emisi
  const records = h2sRecords();
  document.getElementById("h2sTrendWrap").innerHTML = buildH2STrendChart(records);
  const strip = document.getElementById("h2sLogStrip"); if(strip) strip.innerHTML = buildH2SLogStrip(records);
  const mx = document.getElementById("h2sMatrix"); if(mx) mx.innerHTML = buildH2SMatrix(records);
  const banner = document.getElementById("h2sBanner");
  if(!records.length){
    document.getElementById("h2sSummary").innerHTML = "";
    if(banner) banner.innerHTML = hdEmpty("Belum ada data H₂S.");
    wrap.innerHTML = "<tbody><tr><td class='hint'>Belum ada data H2S.</td></tr></tbody>";
    return;
  }
  const worst = records.reduce((a,b)=> b.resultNumeric>a.resultNumeric ? b : a);
  const worstSulfur = worst.resultNumeric*H2S_TO_SULFUR_FACTOR;
  const ratio = H2S_LIMIT_PCT/worstSulfur;
  const periods = hdSortPeriods(records.map(r=>r.periode));
  const pts = new Set(records.map(r=>r.cerobong));
  const allOk = records.every(r=>r.resultNumeric*H2S_TO_SULFUR_FACTOR<H2S_LIMIT_PCT);
  const avgOf = p=>hdMean(records.filter(r=>r.periode===p).map(r=>h2sPpm(r.resultNumeric)));
  const last = periods[periods.length-1], prev = periods[periods.length-2], first = periods[0];
  const aLast = avgOf(last), aPrev = prev ? avgOf(prev) : null, aFirst = avgOf(first);
  const growth = aFirst ? aLast/aFirst : null;
  const latestWorst = records.filter(r=>r.periode===last).reduce((a,b)=>b.resultNumeric>a.resultNumeric?b:a);
  if(banner){
    banner.innerHTML = `<div class="sim-verdict ${allOk?"good":"bad"}">
      <div class="sim-verdict-badge">${allOk?"Compliant":"Perlu tindakan"}</div>
      <p>${allOk?`Seluruh <b>${records.length} hasil uji</b> dari ${pts.size} titik fuel gas pada ${periods.length} periode berada di bawah ambang 0,5% berat.`:"Ada hasil uji yang setara sulfurnya mencapai ambang 0,5% berat."} Nilai tertinggi <b>${hdNum(h2sPpm(worst.resultNumeric))} ppm</b> (${escHtml(worst.cerobong)}, ${escHtml(worst.site)}, ${worst.periode}), setara sulfur ${fmtDecPct(worstSulfur)}, sekitar <b>${hdNum(ratio,0)}&times; di bawah ambang</b>.${growth && growth>=2?` Perlu dicatat, rata-rata H&#8322;S naik <b>${hdNum(growth,1)}&times;</b> dari ${first} (${hdNum(aFirst)} ppm) ke ${last} (${hdNum(aLast)} ppm); masih aman, tetapi layak dipantau kinerja unit sweetening-nya.`:""}</p>
      <div class="sim-verdict-meta">Dasar: Pasal 12 ayat (2) huruf b Permen LH 13/2009 &middot; pengganti baku mutu SO&#8322; numerik untuk Turbin Gas, Heater/Reboiler, Glycol Reboiler</div>
    </div>`;
  }
  const slots = pts.size*periods.length;
  document.getElementById("h2sSummary").innerHTML = [
    hdKpi({label:"H₂S tertinggi", icon:HD_IC.alert, value:hdNum(h2sPpm(worst.resultNumeric)), suffix:" ppm",
      foot:`${fmtSci(worst.resultNumeric)}% &middot; ${escHtml(worst.cerobong)}, ${worst.periode}`}),
    hdKpi({label:"Setara sulfur", icon:HD_IC.db, value:hdNum(worstSulfur/H2S_LIMIT_PCT*100,2), suffix:"% ambang",
      foot:`${fmtDecPct(worstSulfur)} dari batas 0,5% berat`}),
    hdKpi({label:"Headroom", icon:HD_IC.shield, tone:allOk?"good":"bad", value:`${hdNum(ratio,0)}&times;`,
      foot:"Kelipatan jarak nilai tertinggi ke ambang batas"}),
    hdKpi({label:`Rata-rata ${escHtml(last)}`, icon:HD_IC.trend, tone: aPrev && aLast>aPrev*1.5 ? "warn" : "",
      value:hdNum(aLast), suffix:" ppm",
      spark: hdSpark(periods.map(avgOf), {color:"var(--heading-2)", label:"Rata-rata H2S per periode"}),
      foot: aPrev ? `${hdSignedPct((aLast-aPrev)/aPrev*100)} vs ${prev} &middot; tertinggi ${escHtml(latestWorst.site)} ${hdNum(h2sPpm(latestWorst.resultNumeric))} ppm` : "-"}),
    hdKpi({label:"Coverage", icon:HD_IC.clock, value:`${records.length}<small> / ${slots}</small>`,
      spark:`<div class="hd-mini-bar"><i style="width:${(records.length/slots*100).toFixed(1)}%"></i></div>`,
      foot:`${pts.size} titik &times; ${periods.length} periode (${first} sampai ${last})`})
  ].join("");

  wrap.innerHTML = `
    <thead><tr><th>Site</th><th>Titik</th><th>Periode</th><th class="num">H2S, ppm</th><th class="num">H2S, notasi ilmiah</th><th class="num">H2S, desimal</th><th class="num">Setara sulfur (S)</th><th class="num">% dari ambang 0,5%</th><th>Status</th></tr></thead>
    <tbody>${records.map(r=>{
      const sulfur = r.resultNumeric*H2S_TO_SULFUR_FACTOR;
      const badge = HASIL_STATUS_BADGE[r.statusBakuMutu] || HASIL_STATUS_BADGE.not_evaluated;
      return `<tr>
        <td><span class="hd-site"><i style="background:${hdSiteColor(r.site)}"></i>${escHtml(r.site)}</span></td><td>${escHtml(r.cerobong)}</td><td>${r.periode}</td>
        <td class="num strong">${hdNum(h2sPpm(r.resultNumeric))}</td>
        <td class="num">${fmtSci(r.resultNumeric)}%</td>
        <td class="num muted">${fmtDecPct(r.resultNumeric)}</td>
        <td class="num">${fmtDecPct(sulfur)}</td>
        <td class="num muted">${(sulfur/H2S_LIMIT_PCT*100).toFixed(4)}%</td>
        <td><span class="badge ${badge[0]}">${badge[1]}</span></td>
      </tr>`;
    }).join("")}</tbody>`;
}
// Hitung ulang langsung: kontrol lingkup/periode (change), angka usulan & slider (input, di-debounce).
document.addEventListener("change", e=>{
  const id = e.target.id;
  if(["simKapasitas","simBahanBakar","simFrom","simTo"].includes(id)) simScheduleRun();
  if(e.target.classList?.contains("simCerobongCheck")) simScheduleRun();
});
document.addEventListener("input", e=>{
  if(e.target.id==="simThreshold") simScheduleRun();
  if(e.target.id==="simSlider"){
    const inp = document.getElementById("simThreshold");
    if(inp) inp.value = Math.round(Number(e.target.value)*100)/100;
    simScheduleRun();
  }
});
