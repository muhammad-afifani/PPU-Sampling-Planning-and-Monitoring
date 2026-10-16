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
// Filter TAMPILAN hasil simulasi (bukan lingkup perhitungan): titik mana yang muncul di grafik
// Trend, Nilai Tertinggi, Impact Table, Rekap per Site, dan ekspor. KPI & Sensitivity Curve tetap
// dihitung dari seluruh lingkup supaya angka dampaknya tidak ikut berubah karena filter tampilan.
let simShowFilter = "all";      // "all" | "ever" | "now" | "manual"
let simSiteShow = new Set();    // kosong = semua site
let simManual = new Set();      // titik pilihan manual
let simDriverScope = "scope";   // Driver Analysis: "scope" (seluruh lingkup) | "shown" (titik yang ditampilkan)
let simLast = null;             // hasil hitung terakhir, dipakai ekspor Excel
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
  if(simShowFilter!=="all" && engineCount<=20) return "engine";
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
  const wide = document.getElementById("simResultWide");
  if(wide) wide.innerHTML = "";
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

  // ---- Filter tampilan ----
  const sitesAll = [...new Set(engines.map(e=>e.site))].sort();
  [...simSiteShow].forEach(x=>{ if(!sitesAll.includes(x)) simSiteShow.delete(x); });
  [...simManual].forEach(c=>{ if(!engines.some(e=>e.cerobong===c)) simManual.delete(c); });
  const shown = simDisplayEngines(engines);
  const shownSet = new Set(shown.map(e=>e.cerobong));
  const scopeShown = scope.filter(r=>shownSet.has(r.cerobong));
  const shownMode = simResolveTrendMode(shown.length, new Set(scopeShown.map(r=>r.site)).size);
  simLast = {parameter, unit, threshold, std, from, to, engines, shown, scope};

  const tableRows = simShowAll ? shown : shown.slice(0, Math.max(shown.filter(e=>e.exceedCount).length, 12));
  const table = !shown.length ? hdEmpty("Tidak ada titik yang cocok dengan filter tampilan.") : `<div class="tablewrap hd-table-wrap"><table class="hd-table">
    <thead><tr><th>Titik atau engine</th><th class="num">Terbaru</th><th class="num">Maks tercatat</th><th>Trend vs usulan</th><th>Data &gt; usulan</th><th class="num">Reduksi diperlukan</th><th>Status</th></tr></thead>
    <tbody>${tableRows.map(e=>{
      const need = e.currentlyExceeds ? (e.latest.resultNumeric-threshold)/e.latest.resultNumeric*100 : null;
      const share = e.exceedCount/e.records.length*100;
      return `<tr>
        <td><div class="hd-cell-main"><span class="hd-site"><i style="background:${hdSiteColor(e.site)}"></i>${escHtml(e.cerobong)}</span><span class="hd-cell-sub">${escHtml(e.site)} &middot; ${escHtml(e.namaSumber||"")}</span></div></td>
        <td class="num ${e.currentlyExceeds?"sim-bad":""}">${hdNum(e.latest.resultNumeric)} <span class="muted">${e.latest.periode}</span></td>
        <td class="num">${hdNum(e.maxVal)}</td>
        <td>${simSpark(e.series, threshold)}</td>
        <td><div class="hd-bullet"><div class="track"><i style="width:${share.toFixed(1)}%;background:${e.exceedCount?SIM_PROPOSAL_COLOR:"#2f9e67"}"></i></div><span class="v">${e.exceedCount}/${e.records.length}</span></div></td>
        <td class="num">${need==null?"-":`<span class="hd-delta up">\u2212${hdNum(need,0)}%</span>`}</td>
        <td>${simStatusBadge(e)}</td>
      </tr>`;
    }).join("")}</tbody></table></div>
    ${shown.length>tableRows.length || simShowAll ? `<button type="button" class="btn small ghost" data-action="simToggleAll" style="margin-top:8px;">${simShowAll?"Tampilkan ringkas":`Tampilkan semua ${shown.length} titik`}</button>` : ""}`;

  out.innerHTML = `
    <div class="sim-verdict ${verdictTone}">
      <div class="sim-verdict-badge">${verdictTitle}</div>
      <p>${verdictText}</p>
      <div class="sim-verdict-meta">${escHtml(parameter)} &middot; ${scope.length} baris dari ${engines.length} titik &middot; ${from} sampai ${to}</div>
    </div>
    <div class="hd-kpis sim-kpis">${kpis}</div>
    <div class="card sim-card">
      <div class="cardhead"><div><h3>Sensitivity Curve</h3><div class="hint hd-sub">Persentase titik terdampak untuk setiap kandidat angka baku mutu (seluruh lingkup). Garis vertikal hitam adalah usulan saat ini; geser slider untuk melihat di angka berapa dampaknya mulai melonjak.</div></div>
        <button class="btn small ghost" data-action="hdZoomChart" data-target="simSensWrap" data-title="Sensitivity Curve Usulan Baku Mutu">Perbesar</button></div>
      <div id="simSensWrap">${buildSimSensitivity(engines, threshold, std, unit)}</div>
    </div>`;
  (wide || out).insertAdjacentHTML("beforeend", `
    ${buildSimShowFilter(engines, shown, sitesAll)}
    <div class="hd-row">
      <div class="card hd-col-wide">
        <div class="cardhead"><div><h3>Trend vs Usulan</h3><div class="hint hd-sub">${simTrendMode==="auto"?`Mode otomatis: <b>${shownMode==="engine"?"per titik":shownMode==="site"?"per site":"rata-rata gabungan"}</b> (${shown.length} titik ditampilkan).`:"Mode dipilih manual."} Area jingga muda berada di atas usulan.</div></div>
          <button class="btn small ghost" data-action="hdZoomChart" data-target="simTrendWrap" data-title="Trend Nilai terhadap Usulan Baku Mutu">Perbesar</button></div>
        <div class="hd-seg">${hdSeg("simSetTrendMode", simTrendMode, [["auto","Otomatis"],["engine","Per Titik"],["site","Per Site"],["avg","Rata-rata"]]).replace(/data-val=/g,"data-mode=")}</div>
        <div id="simTrendWrap">${scopeShown.length ? buildSimTrendChart(scopeShown, hdSortPeriods(scopeShown.map(r=>r.periode)), threshold, unit, shownMode, std) : hdEmpty("Tidak ada titik yang cocok dengan filter tampilan.")}</div>
      </div>
      <div class="card hd-col-side">
        <div class="cardhead"><div><h3>Nilai Tertinggi per Titik</h3><div class="hint hd-sub">Nilai maksimum tiap titik yang ditampilkan, dibandingkan usulan.</div></div>
          <button class="btn small ghost" data-action="hdZoomChart" data-target="simEngineWrap" data-title="Nilai Tertinggi per Titik terhadap Usulan">Perbesar</button></div>
        <div id="simEngineWrap">${shown.length ? buildSimEngineChart(shown, threshold, unit, std) : hdEmpty("Tidak ada titik.")}</div>
      </div>
    </div>
    <div class="card sim-card">
      <div class="cardhead"><div><h3>Rekap per Site</h3><div class="hint hd-sub">Jumlah titik yang pernah dan masih melebihi usulan ${hdNum(threshold)} ${escHtml(unit)} di tiap site, sesuai filter tampilan. Siap disalin ke laporan atau diekspor ke Excel.</div></div>
        <div class="sim-head-actions"><button class="btn small" data-action="simExportXlsx">Export Excel</button><button class="btn small ghost" data-action="hdZoomChart" data-target="simSiteWrap" data-title="Rekap per Site terhadap Usulan Baku Mutu">Perbesar</button></div></div>
      <div id="simSiteWrap">${buildSimSiteSummary(shown, threshold, unit)}</div>
    </div>
    <div class="card sim-card">
      <div class="cardhead"><div><h3>Impact Table</h3><div class="hint hd-sub">Detail titik yang ditampilkan; titik terdampak di urutan teratas. Reduksi diperlukan = penurunan dari data terbaru agar berada di bawah usulan.</div></div>
        <button class="btn small ghost" data-action="hdZoomChart" data-target="simImpactWrap" data-title="Impact Table Usulan Baku Mutu">Perbesar</button></div>
      <div id="simImpactWrap">${table}</div>
    </div>
    <div class="card sim-card">
      <div class="cardhead"><div><h3>Driver Analysis &middot; apa yang berkaitan dengan tingginya ${escHtml(parameter)}?</h3><div class="hint hd-sub">Korelasi ${escHtml(parameter)} dengan Running Hour dan parameter pendukung yang diukur pada titik dan periode yang sama.</div></div>
        <button class="btn small ghost" data-action="hdZoomChart" data-target="simDriverWrap" data-title="Driver Analysis">Perbesar</button></div>
      <div class="hd-seg">${hdSeg("simSetDriverScope", simDriverScope, [["scope",`Seluruh lingkup (${engines.length} titik)`],["shown",`Titik yang ditampilkan (${shown.length})`]])}</div>
      <div id="simDriverWrap">${buildSimDriverAnalysis(simDriverScope==="shown" ? scopeShown : scope, threshold, parameter, unit, from, to)}</div>
    </div>`);
}
function simStatusBadge(e){
  return e.currentlyExceeds ? `<span class="badge b-red">Masih melebihi</span>` : e.exceedCount ? `<span class="badge hd-b-warn">Pernah melebihi</span>` : `<span class="badge b-green">Selalu di bawah</span>`;
}
function simDisplayEngines(engines){
  return engines.filter(e=>{
    if(simSiteShow.size && !simSiteShow.has(e.site)) return false;
    if(simShowFilter==="ever") return e.exceedCount>0;
    if(simShowFilter==="now") return e.currentlyExceeds;
    if(simShowFilter==="manual") return simManual.has(e.cerobong);
    return true;
  });
}
function buildSimShowFilter(engines, shown, sites){
  const inSite = e=>!simSiteShow.size || simSiteShow.has(e.site);
  const nAll = engines.filter(inSite).length, nEver = engines.filter(e=>inSite(e) && e.exceedCount>0).length, nNow = engines.filter(e=>inSite(e) && e.currentlyExceeds).length;
  const siteChips = `<button type="button" class="chip-toggle all ${simSiteShow.size?"":"active"}" data-action="simSiteToggle" data-val="" aria-pressed="${!simSiteShow.size}">Semua site</button>` + sites.map(s=>{
    const es = engines.filter(e=>e.site===s), imp = es.filter(e=>e.exceedCount>0).length, on = simSiteShow.has(s);
    return `<button type="button" class="chip-toggle ${on?"active":""}" data-action="simSiteToggle" data-val="${escHtml(s)}" aria-pressed="${on}"><span class="hd-chip-dot" style="background:${hdSiteColor(s)}"></span>${escHtml(s)} <span class="hd-chip-n">${imp}/${es.length}</span></button>`;
  }).join("");
  const manual = simShowFilter!=="manual" ? "" : `<div class="field"><label>Pilih titik (titik bertanda jingga pernah melebihi usulan)</label>
    <div class="sim-manual-tools"><button type="button" class="btn small" data-action="simManualPreset" data-val="ever">Pilih semua yang terdampak</button><button type="button" class="btn small ghost" data-action="simManualPreset" data-val="clear">Kosongkan</button></div>
    <div class="chipbar sim-manual">${engines.filter(inSite).map(e=>{ const on = simManual.has(e.cerobong); return `<button type="button" class="chip-toggle ${on?"active":""} ${e.exceedCount?"sim-imp":""}" data-action="simManualToggle" data-val="${escHtml(e.cerobong)}" aria-pressed="${on}">${escHtml(e.cerobong)}</button>`; }).join("")}</div></div>`;
  return `<div class="card sim-card sim-filter">
    <div class="sim-filter-row">
      <div class="field"><label>Tampilkan di grafik &amp; tabel</label>${hdSeg("simShowFilter", simShowFilter, [["all",`Semua titik (${nAll})`],["ever",`Pernah melebihi (${nEver})`],["now",`Masih melebihi (${nNow})`],["manual","Pilih manual"]])}</div>
      <div class="field"><label>Site &middot; terdampak / total</label><div class="chipbar">${siteChips}</div></div>
    </div>
    ${manual}
    <div class="hint" style="margin:0;">Menampilkan <b>${shown.length}</b> dari ${engines.length} titik. Filter ini hanya mengatur tampilan; KPI dan Sensitivity Curve tetap menghitung seluruh lingkup.</div>
  </div>`;
}
function simSiteRows(shown, threshold){
  const sites = [...new Set(shown.map(e=>e.site))].sort();
  return sites.map(s=>{
    const es = shown.filter(e=>e.site===s);
    const ever = es.filter(e=>e.exceedCount>0), now = es.filter(e=>e.currentlyExceeds);
    const top = es.slice().sort((a,b)=>b.maxVal-a.maxVal)[0];
    return {site:s, total:es.length, ever, now, rowsOver: es.reduce((a,e)=>a+e.exceedCount,0), rows: es.reduce((a,e)=>a+e.records.length,0), top};
  });
}
function buildSimSiteSummary(shown, threshold, unit){
  if(!shown.length) return hdEmpty("Tidak ada titik yang cocok dengan filter tampilan.");
  const rows = simSiteRows(shown, threshold);
  const tot = {total:0, ever:0, now:0, rowsOver:0, rows:0};
  rows.forEach(r=>{ tot.total+=r.total; tot.ever+=r.ever.length; tot.now+=r.now.length; tot.rowsOver+=r.rowsOver; tot.rows+=r.rows; });
  return `<div class="tablewrap hd-table-wrap"><table class="hd-table sim-site-table">
    <thead><tr><th>Site</th><th class="num">Titik</th><th class="num">Pernah melebihi</th><th class="num">Masih melebihi</th><th>% titik terdampak</th><th class="num">Data &gt; usulan</th><th>Titik yang pernah melebihi (nilai maks)</th></tr></thead>
    <tbody>${rows.map(r=>{ const pct = r.ever.length/r.total*100; return `<tr>
      <td><span class="hd-site"><i style="background:${hdSiteColor(r.site)}"></i>${escHtml(r.site)}</span></td>
      <td class="num">${r.total}</td>
      <td class="num ${r.ever.length?"strong":""}">${r.ever.length}</td>
      <td class="num ${r.now.length?"sim-bad":""}">${r.now.length}</td>
      <td><div class="hd-bullet"><div class="track"><i style="width:${pct.toFixed(1)}%;background:${r.ever.length?SIM_PROPOSAL_COLOR:"#2f9e67"}"></i></div><span class="v">${hdNum(pct,0)}%</span></div></td>
      <td class="num">${r.rowsOver}/${r.rows}</td>
      <td class="sim-names">${r.ever.length ? r.ever.sort((a,b)=>b.maxVal-a.maxVal).map(e=>`<span class="sim-name ${e.currentlyExceeds?"now":""}">${escHtml(e.cerobong)} <b>${hdNum(e.maxVal)}</b></span>`).join("") : `<span class="muted">Tertinggi ${escHtml(r.top.cerobong)} ${hdNum(r.top.maxVal)}</span>`}</td>
    </tr>`; }).join("")}</tbody>
    <tfoot><tr><td><b>Total</b></td><td class="num"><b>${tot.total}</b></td><td class="num"><b>${tot.ever}</b></td><td class="num"><b>${tot.now}</b></td><td><b>${hdNum(tot.ever/tot.total*100,0)}%</b></td><td class="num"><b>${tot.rowsOver}/${tot.rows}</b></td><td class="muted">Satuan ${escHtml(unit)}. Nama berwarna merah: data terbarunya masih melebihi.</td></tr></tfoot>
  </table></div>`;
}

/* ---------------- Driver Analysis ---------------- */
// Pasangkan nilai parameter uji dengan Running Hour semester dan setiap parameter pendukung pada
// titik & periode yang sama. Selain korelasi gabungan (pooled), dihitung juga korelasi DALAM engine
// (nilai dikurangi rata-rata engine masing-masing) — korelasi gabungan bisa menyesatkan karena
// perbedaan antar engine (mis. turbin besar vs kecil), sedangkan korelasi dalam engine menjawab
// "saat engine yang sama naik, apakah NOx-nya ikut naik?".
const SIM_DRIVER_HINT = {
  "Gas Temperatur":"suhu gas buang tinggi menandakan suhu pembakaran tinggi, pemicu utama thermal NOx",
  "O₂":"kelebihan udara; di sekitar titik optimum menambah NOx, kelebihan besar justru mendinginkan nyala",
  "CO₂":"proksi jumlah bahan bakar yang terbakar atau beban pembakaran",
  "Laju Alir (v)":"throughput gas buang; laju tinggi bisa mengencerkan konsentrasi",
  "Running Hour":"beban operasi dan keausan; jam jalan tinggi bisa menurunkan efisiensi pembakaran"
};
// Batas fisik: nilai di luar rentang ini hampir pasti salah input (mis. CO2 384%), jadi dikeluarkan
// dari korelasi supaya tidak mendominasi hasil, lalu dilaporkan sebagai temuan kualitas data.
const SIM_PLAUSIBLE = {"O₂":[0,21], "CO₂":[0,25]};
function simDriverPairs(rows, driver){
  if(driver==="Running Hour") return rows.map(r=>{ const x = hdRhSemester(r.cerobong, r.periode); return x!=null && x>0 ? {x, y:r.resultNumeric, r} : null; }).filter(Boolean);
  const m = new Map();
  DB.hasilPemantauan.forEach(d=>{ if(d.parameter===driver && d.resultNumeric!=null) m.set(d.cerobong+"||"+d.periode, d); });
  return rows.map(r=>{ const d = m.get(r.cerobong+"||"+r.periode); return d ? {x:d.resultNumeric, y:r.resultNumeric, r, unit:d.unit} : null; }).filter(Boolean);
}
function simSplitPlausible(pairs, driver){
  const lim = SIM_PLAUSIBLE[driver];
  if(!lim) return {ok:pairs, bad:[]};
  return {ok:pairs.filter(p=>p.x>=lim[0] && p.x<=lim[1]), bad:pairs.filter(p=>p.x<lim[0] || p.x>lim[1])};
}
function simWithinR(pairs){
  const by = {};
  pairs.forEach(p=>{ (by[p.r.cerobong] = by[p.r.cerobong] || []).push(p); });
  const dm = [];
  Object.values(by).forEach(g=>{
    if(g.length<2) return;
    const mx = hdMean(g.map(p=>p.x)), my = hdMean(g.map(p=>p.y));
    g.forEach(p=>dm.push({x:p.x-mx, y:p.y-my}));
  });
  return {r: hdPearsonR(dm), n: dm.length};
}
function simDriverStats(rows, threshold){
  const drivers = ["Running Hour"].concat(hdAllValues("parameter").filter(p=>!hdIsEmisiParam(p)));
  return drivers.map(d=>{
    const split = simSplitPlausible(simDriverPairs(rows, d), d);
    const pairs = split.ok;
    const r = hdPearsonR(pairs), w = simWithinR(pairs);
    const over = pairs.filter(p=>p.y>threshold).map(p=>p.x), under = pairs.filter(p=>p.y<=threshold).map(p=>p.x);
    const mO = hdMean(over), mU = hdMean(under);
    return {driver:d, unit: d==="Running Hour" ? "jam/semester" : (pairs[0]?.unit||""), pairs, n:pairs.length, r, rw:w.r, nw:w.n,
      mOver:mO, mUnder:mU, diff: mO!=null && mU ? (mO-mU)/Math.abs(mU)*100 : null, nOver:over.length, bad:split.bad};
  });
}
function simRBar(r, n){
  if(r==null) return `<span class="muted">n &lt; 3</span>`;
  if(n!=null && n<8) return `<span class="muted sim-rsmall" title="Pasangan data kurang dari 8, korelasi belum bermakna">${r>=0?"+":"\u2212"}${Math.abs(r).toFixed(2)} &middot; n kecil</span>`;
  const w = Math.min(50, Math.abs(r)*50);
  const color = Math.abs(r)>=0.4 ? (r>0?"#c2620a":"#2563a8") : "var(--gray-500)";
  return `<div class="sim-rbar" role="img" aria-label="r ${r.toFixed(2)}"><span class="axis"></span><i style="${r>=0?`left:50%`:`right:50%`};width:${w.toFixed(1)}%;background:${color}"></i></div><b class="sim-rval" style="color:${color}">${r>=0?"+":"\u2212"}${Math.abs(r).toFixed(2)}</b>`;
}
function simMiniScatter(st, threshold, unitY){
  const ps = st.pairs; if(ps.length<3) return "";
  const W=260, H=170, pl=36, pr=8, pt=10, pb=28;
  const xs = ps.map(p=>p.x), ys = ps.map(p=>p.y);
  const sx = xs.slice().sort((a,b)=>a-b), q = f=>sx[Math.min(sx.length-1, Math.max(0, Math.round(f*(sx.length-1))))];
  const x0 = ps.length>=20 ? q(0.02) : sx[0], x1 = ps.length>=20 ? q(0.98) : sx[sx.length-1];
  const yMax = hdNiceMax(Math.max(...ys, threshold)*1.05);
  const X = v=>pl+(x1>x0?(Math.max(x0,Math.min(x1,v))-x0)/(x1-x0):0.5)*(W-pl-pr), Y = v=>pt+(H-pt-pb)-v/yMax*(H-pt-pb);
  let s = `<svg class="hd-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Sebaran ${escHtml(st.driver)} terhadap hasil">`;
  [0,0.5,1].forEach(g=>{ s += `<line x1="${pl}" y1="${Y(yMax*g).toFixed(1)}" x2="${W-pr}" y2="${Y(yMax*g).toFixed(1)}" class="hd-grid"/><text x="${pl-4}" y="${(Y(yMax*g)+3).toFixed(1)}" text-anchor="end" class="hd-axis tiny">${hdNum(yMax*g)}</text>`; });
  s += `<line x1="${pl}" y1="${Y(threshold).toFixed(1)}" x2="${W-pr}" y2="${Y(threshold).toFixed(1)}" stroke="${SIM_PROPOSAL_COLOR}" stroke-width="1.5"/>`;
  ps.forEach(p=>{ const o = p.y>threshold, clip = p.x<x0 || p.x>x1; s += `<circle cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="${o?3.6:2.8}" fill="${clip?"none":o?SIM_PROPOSAL_COLOR:"#5a7fb0"}" stroke="${clip?(o?SIM_PROPOSAL_COLOR:"#5a7fb0"):"none"}" fill-opacity="${o?.95:.45}"><title>${escHtml(p.r.cerobong)} ${p.r.periode}: ${escHtml(st.driver)} ${hdNum(p.x)}, ${hdNum(p.y)} ${escHtml(unitY)}</title></circle>`; });
  if(st.r!=null){
    const mx = hdMean(xs), my = hdMean(ys); let num=0, den=0; ps.forEach(p=>{ num+=(p.x-mx)*(p.y-my); den+=(p.x-mx)**2; });
    const b = den?num/den:0, a = my-b*mx, cl = v=>Math.max(0,Math.min(yMax,v));
    s += `<line x1="${X(x0).toFixed(1)}" y1="${Y(cl(a+b*x0)).toFixed(1)}" x2="${X(x1).toFixed(1)}" y2="${Y(cl(a+b*x1)).toFixed(1)}" stroke="var(--heading-2)" stroke-width="1.4" stroke-dasharray="4 3"/>`;
  }
  s += `<text x="${pl}" y="${H-8}" class="hd-axis tiny">${hdNum(x0)}</text><text x="${W-pr}" y="${H-8}" text-anchor="end" class="hd-axis tiny">${hdNum(x1)}</text><text x="${(pl+W-pr)/2}" y="${H-8}" text-anchor="middle" class="hd-axis tiny">${escHtml(st.driver)} (${escHtml(st.unit)})</text></svg>`;
  return s;
}
function buildSimDriverAnalysis(rows, threshold, parameter, unit, from, to){
  if(rows.length<3) return hdEmpty("Data belum cukup untuk analisis korelasi (minimal 3 pasangan).");
  const stats = simDriverStats(rows, threshold).filter(s=>s.n>0);
  if(!stats.length) return hdEmpty("Tidak ada parameter pendukung atau Running Hour yang tercatat pada titik dan periode yang sama.");
  const ranked = stats.filter(s=>s.rw!=null && s.nw>=8).sort((a,b)=>Math.abs(b.rw)-Math.abs(a.rw));
  const pooledRanked = stats.filter(s=>s.r!=null && s.n>=8).sort((a,b)=>Math.abs(b.r)-Math.abs(a.r));
  const fmtR = r=>r==null?"-":(r>=0?"+":"\u2212")+Math.abs(r).toFixed(2);
  const lines = [];
  const top = ranked[0];
  if(top && Math.abs(top.rw)>=0.2){
    const {strength} = hdCorrInterpretation(top.rw);
    lines.push(`Di dalam engine yang sama, <b>${escHtml(top.driver)}</b> paling berkaitan dengan ${escHtml(parameter)} (r ${fmtR(top.rw)}, korelasi ${strength}, ${top.rw>0?"searah":"berlawanan arah"}). ${SIM_DRIVER_HINT[top.driver]?`Secara teknis: ${SIM_DRIVER_HINT[top.driver]}.`:""}`);
  }else{
    lines.push(`Tidak ada parameter pendukung yang berkorelasi berarti dengan ${escHtml(parameter)} di dalam engine yang sama (semua |r| &lt; 0,2). Naik turunnya ${escHtml(parameter)} kemungkinan dipengaruhi faktor di luar data ini, misalnya kondisi burner, kualitas bahan bakar, atau beban saat sampling.`);
  }
  const pTop = pooledRanked[0];
  if(pTop && Math.abs(pTop.r)>=0.4 && (!top || pTop.driver!==top.driver || Math.abs(top.rw)<0.2)){
    lines.push(`Antar engine, ${escHtml(pTop.driver)} berkorelasi ${hdCorrInterpretation(pTop.r).strength} (r ${fmtR(pTop.r)}), yang lebih mencerminkan perbedaan jenis atau ukuran engine daripada perubahan kondisi operasi.`);
  }
  const big = stats.filter(s=>s.diff!=null && s.nOver>=3 && s.n>=8 && Math.abs(s.diff)>=10).sort((a,b)=>Math.abs(b.diff)-Math.abs(a.diff))[0];
  if(big) lines.push(`Saat ${escHtml(parameter)} melebihi usulan, rata-rata <b>${escHtml(big.driver)}</b> ${big.diff>0?"lebih tinggi":"lebih rendah"} ${hdNum(Math.abs(big.diff),0)}% (${hdNum(big.mOver)} vs ${hdNum(big.mUnder)} ${escHtml(big.unit)}). Perbedaan rata-rata ini bisa juga berasal dari jenis engine yang berbeda, jadi bandingkan dengan kolom r dalam engine.`);
  const bad = stats.filter(s=>s.bad.length);
  if(bad.length) lines.push(`<span class="sim-dq">Kualitas data:</span> ${bad.map(s=>`${s.bad.length} nilai ${escHtml(s.driver)} di luar batas fisik (${s.bad.slice(0,3).map(p=>`${escHtml(p.r.cerobong)} ${p.r.periode}: ${hdNum(p.x)}${escHtml(s.unit)}`).join("; ")}${s.bad.length>3?", ...":""})`).join("; ")} tidak diikutkan dalam korelasi. Periksa kembali data di Database Hasil Emisi.`);
  if(rows.length && stats.every(s=>s.n<8)) lines.push(`Jumlah pasangan data masih di bawah 8, jadi angka korelasi di bawah belum bisa dijadikan kesimpulan. Pilih "Seluruh lingkup" atau perluas rentang periode.`);
  const tableRows = stats.map(s=>{
    const strong = s.rw!=null && s.nw>=8 && Math.abs(s.rw)>=0.4;
    return `<tr class="${strong?"sim-strong":""}">
      <td><b>${escHtml(s.driver)}</b><div class="hd-cell-sub">${escHtml(s.unit)}</div></td>
      <td class="num">${s.n}</td>
      <td>${simRBar(s.r, s.n)}</td>
      <td>${simRBar(s.rw, s.nw)}</td>
      <td class="num">${s.r==null||s.n<8?"-":(s.r*s.r).toFixed(2)}</td>
      <td class="num">${hdNum(s.mOver)} <span class="muted">(n=${s.nOver})</span></td>
      <td class="num">${hdNum(s.mUnder)}</td>
      <td class="num">${s.diff==null?"-":`<span class="hd-delta ${s.diff>0.05?"up-neutral":s.diff<-0.05?"down-neutral":""}">${hdSignedPct(s.diff)}</span>`}</td>
    </tr>`;
  }).join("");
  return `<div class="sim-driver-summary">${lines.map(l=>`<p>${l}</p>`).join("")}</div>
    <div class="tablewrap hd-table-wrap"><table class="hd-table sim-driver-table">
      <thead><tr><th>Faktor</th><th class="num">n pasangan</th><th>r antar semua data</th><th>r dalam engine</th><th class="num">R&sup2;</th><th class="num">Rata-rata saat &gt; usulan</th><th class="num">Saat &le; usulan</th><th class="num">Selisih</th></tr></thead>
      <tbody>${tableRows}</tbody></table></div>
    <div class="sim-scatter-grid">${stats.map(s=>{ const sc = simMiniScatter(s, threshold, unit); return sc ? `<figure><figcaption><b>${escHtml(s.driver)}</b> <span class="muted">r ${fmtR(s.r)} &middot; dalam engine ${fmtR(s.rw)}</span></figcaption>${sc}</figure>` : ""; }).join("")}</div>
    <div class="hint">Titik jingga: data ${escHtml(parameter)} di atas usulan ${hdNum(threshold)} ${escHtml(unit)}. Garis putus-putus: garis regresi. Lingkaran kosong di tepi grafik: nilai ekstrem di luar persentil 2 sampai 98 (tetap dihitung). Korelasi menunjukkan keterkaitan, bukan bukti sebab-akibat; |r| &ge; 0,7 kuat, 0,4 sampai 0,7 sedang, 0,2 sampai 0,4 lemah. Periode ${escHtml(from)} sampai ${escHtml(to)}.</div>`;
}

/* ---------------- Ekspor Excel simulasi ---------------- */
function simExportXlsx(){
  if(!simLast){ toast("Jalankan simulasi terlebih dahulu.", "warn"); return; }
  const {parameter, unit, threshold, from, to, shown, scope} = simLast;
  const siteRows = simSiteRows(shown, threshold).map(r=>({
    "Site": r.site, "Jumlah titik": r.total, "Pernah melebihi usulan": r.ever.length, "Masih melebihi (data terbaru)": r.now.length,
    "% titik terdampak": Math.round(r.ever.length/r.total*1000)/10, "Data melebihi usulan": r.rowsOver, "Total data": r.rows,
    "Titik yang pernah melebihi": r.ever.map(e=>`${e.cerobong} (${e.maxVal})`).join("; "), "Nilai tertinggi": r.top.maxVal, "Titik nilai tertinggi": r.top.cerobong
  }));
  const engRows = shown.map(e=>({
    "Titik": e.cerobong, "Site": e.site, "Jenis sumber": e.namaSumber, "Nilai terbaru": e.latest.resultNumeric, "Periode terbaru": e.latest.periode,
    "Nilai maks": e.maxVal, "Data melebihi usulan": e.exceedCount, "Total data": e.records.length,
    "Status": e.currentlyExceeds ? "Masih melebihi" : e.exceedCount ? "Pernah melebihi" : "Selalu di bawah",
    "Reduksi diperlukan (%)": e.currentlyExceeds ? Math.round((e.latest.resultNumeric-threshold)/e.latest.resultNumeric*1000)/10 : ""
  }));
  const shownSet = new Set(shown.map(e=>e.cerobong));
  const overRows = scope.filter(r=>shownSet.has(r.cerobong) && r.resultNumeric>threshold).sort((a,b)=>a.site.localeCompare(b.site)||b.resultNumeric-a.resultNumeric).map(r=>({
    "Titik": r.cerobong, "Site": r.site, "Periode": r.periode, "Tanggal sampling": r.dateOfSampling||"", "Hasil": r.resultNumeric, "Satuan": r.unit, "Usulan": threshold, "BM resmi": r.standard, "Selisih": Math.round((r.resultNumeric-threshold)*100)/100
  }));
  const drv = simDriverStats(simDriverScope==="shown" ? scope.filter(r=>shownSet.has(r.cerobong)) : scope, threshold).filter(s=>s.n>0).map(s=>({
    "Faktor": s.driver, "Satuan": s.unit, "n pasangan": s.n, "r antar semua data": s.r==null?"":Math.round(s.r*1000)/1000, "r dalam engine": s.rw==null?"":Math.round(s.rw*1000)/1000,
    "R kuadrat": s.r==null?"":Math.round(s.r*s.r*1000)/1000, "Rata-rata saat melebihi": s.mOver==null?"":Math.round(s.mOver*100)/100, "Rata-rata saat di bawah": s.mUnder==null?"":Math.round(s.mUnder*100)/100
  }));
  const info = [{"Keterangan":"Parameter","Nilai":parameter},{"Keterangan":"Usulan baku mutu","Nilai":`${threshold} ${unit}`},{"Keterangan":"Periode","Nilai":`${from} sampai ${to}`},{"Keterangan":"Filter tampilan","Nilai":{all:"Semua titik",ever:"Pernah melebihi",now:"Masih melebihi",manual:"Pilih manual"}[simShowFilter]+(simSiteShow.size?`, site ${[...simSiteShow].join(", ")}`:"")},{"Keterangan":"Dibuat","Nilai":new Date().toLocaleString("id-ID")}];
  const sheet = rows=>xlsxSheetFromRows(rows.length?Object.keys(rows[0]):["-"], rows);
  const wb = xlsxWorkbookFromSheets([["Info", sheet(info)],["Rekap per Site", sheet(siteRows)],["Detail Titik", sheet(engRows)],["Data Melebihi Usulan", sheet(overRows)],["Driver Analysis", sheet(drv)]]);
  xlsxDownload(wb, `simulasi_bm_${String(parameter).replace(/[^A-Za-z0-9]+/g,"")}_${threshold}_${from.replace(/\s/g,"")}-${to.replace(/\s/g,"")}.xlsx`);
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
