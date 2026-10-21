/* =========================================================
   HASIL PEMANTAUAN AMBIENT — Dashboard page (tab per kategori)
========================================================= */
let ambDashCat = "ambien";
let ambDashFlt = {site:"", from:"", to:"", param:""};
let ambDashProfileKey = "";

/* ---------- Chart builders (generik, dipakai lintas kategori) ---------- */
function ambBuildDonut(segments, centerVal, centerLabel){
  const total = segments.reduce((s,x)=>s+x[1],0);
  if(!total) return {svg:"<div class='hint' style='padding:14px;'>Tidak ada data pada filter ini.</div>", legend:""};
  const cx=110,cy=110,r=80,rInner=48;
  // Font angka tengah MENGECIL kalau digitnya banyak (dulu font-size="24" tetap, jadi angka panjang
  // spt "1.386.922" meluber keluar lubang donut yg cuma rInner*2=96px) — threshold panjang string
  // dipilih supaya nilai pendek (persentase dkk, dipakai di 4 pemanggil lain fungsi ini) tetap 24px
  // spt sebelumnya, tidak ada regresi.
  const centerValStr = String(centerVal);
  const centerFontSize = centerValStr.length<=4 ? 24 : centerValStr.length<=6 ? 20 : centerValStr.length<=8 ? 17 : 14;
  let paths = "";
  if(segments.length===1){
    const rMid=(r+rInner)/2, strokeW=r-rInner;
    paths = `<circle class="amb-donut-seg" data-label="${escHtml(segments[0][0])}" data-value="${escHtml(String(segments[0][1]))}" cx="${cx}" cy="${cy}" r="${rMid}" fill="none" stroke="${segments[0][2]}" stroke-width="${strokeW}"/>`;
  } else {
    let angle=-90;
    segments.forEach(([label,val,color])=>{
      const frac=val/total, sweep=frac*360;
      const x1=cx+r*Math.cos(angle*Math.PI/180), y1=cy+r*Math.sin(angle*Math.PI/180);
      const endAngle=angle+sweep;
      const x2=cx+r*Math.cos(endAngle*Math.PI/180), y2=cy+r*Math.sin(endAngle*Math.PI/180);
      const large=sweep>180?1:0;
      const xi1=cx+rInner*Math.cos(angle*Math.PI/180), yi1=cy+rInner*Math.sin(angle*Math.PI/180);
      const xi2=cx+rInner*Math.cos(endAngle*Math.PI/180), yi2=cy+rInner*Math.sin(endAngle*Math.PI/180);
      paths += `<path class="amb-donut-seg" data-label="${escHtml(label)}" data-value="${escHtml(String(val))}" d="M${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2} L${xi2},${yi2} A${rInner},${rInner} 0 ${large} 0 ${xi1},${yi1} Z" fill="${color}"/>`;
      angle = endAngle;
    });
  }
  const svg = `<svg viewBox="0 0 220 220" style="width:220px;height:220px;display:block;margin:0 auto;">
    ${paths}
    <text x="110" y="104" text-anchor="middle" font-size="${centerFontSize}" font-weight="800" fill="var(--heading)">${centerVal}</text>
    <text x="110" y="124" text-anchor="middle" font-size="11" fill="var(--gray-500)">${escHtml(centerLabel)}</text>
  </svg>`;
  const legend = segments.map(([label,val,color])=>`<span class="item"><span class="sw" style="background:${color}"></span>${escHtml(label)}: ${val}</span>`).join("");
  return {svg, legend};
}
// Tooltip hover utk segmen donut (.amb-donut-seg) — 1 listener delegated dipakai bareng SEMUA donut
// di app (Dashboard, AQI/ISPU, Ambien Dashboard, dst — semua lewat ambBuildDonut yg sama) krn
// elemen SVG-nya diganti2 tiap render (innerHTML), pola & gaya visual sama persis dgn tooltip chart
// Budget (.bgt-chart-tooltip, 23-budget-proyeksi.js) biar konsisten se-app.
document.addEventListener("mousemove", e=>{
  const tip = document.getElementById("ambDonutTooltip");
  if(!tip) return;
  const seg = e.target.closest && e.target.closest(".amb-donut-seg");
  if(!seg){ tip.style.display = "none"; return; }
  tip.innerHTML = `<b>${escHtml(seg.dataset.label)}</b>: ${escHtml(seg.dataset.value)}`;
  tip.style.display = "block";
  const pad = 14;
  const tipW = tip.offsetWidth || 160;
  let left = e.clientX + pad;
  if(left + tipW > window.innerWidth - 8) left = e.clientX - tipW - pad;
  let top = e.clientY + pad;
  if(top + tip.offsetHeight > window.innerHeight - 8) top = e.clientY - tip.offsetHeight - pad;
  tip.style.left = left + "px";
  tip.style.top = top + "px";
});
document.addEventListener("mouseout", e=>{
  if(!e.target.closest || !e.target.closest(".amb-donut-seg")) return;
  if(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest(".amb-donut-seg")) return;
  const tip = document.getElementById("ambDonutTooltip");
  if(tip) tip.style.display = "none";
});
function ambBuildTrendChart(periodsInScope, seriesArr, opts){
  opts = opts||{};
  seriesArr = seriesArr.filter(s=>s.values.some(v=>v!=null));
  if(!periodsInScope.length || !seriesArr.length) return "<div class='hint' style='padding:14px;'>Tidak ada data untuk ditampilkan.</div>";
  const W=760,H=280,padL=54,padR=16,padT=18,padB=34;
  const plotW=W-padL-padR, plotH=H-padT-padB;
  const n = periodsInScope.length;
  const allVals = seriesArr.flatMap(s=>s.values.filter(v=>v!=null));
  let maxY = Math.max(...allVals, opts.standardRef||0)*1.15;
  if(!isFinite(maxY) || maxY<=0) maxY = 100;
  function xFor(i){ return padL + (n<=1?plotW/2:(i/(n-1))*plotW); }
  function yFor(v){ return padT + plotH - (v/maxY)*plotH; }
  let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;font-size:11.5px;background:var(--surface-card);border:1px solid var(--gray-200);border-radius:10px;">`;
  for(let g=0; g<=4; g++){
    const y = padT + plotH - (g/4)*plotH;
    svg += `<line x1="${padL}" y1="${y}" x2="${W-padR}" y2="${y}" stroke="var(--gray-200)"/>`;
    svg += `<text x="2" y="${y+4}" fill="var(--gray-500)">${Math.round(maxY*g/4)}</text>`;
  }
  periodsInScope.forEach((p,i)=>{ svg += `<text x="${xFor(i)}" y="${H-10}" text-anchor="middle" fill="var(--gray-500)">${p}</text>`; });
  if(opts.standardRef!=null){
    const ys = yFor(opts.standardRef);
    svg += `<line x1="${padL}" y1="${ys}" x2="${W-padR}" y2="${ys}" stroke="#e0554f" stroke-width="1.5" stroke-dasharray="5,4"/>`;
    svg += `<text x="${W-padR}" y="${ys-4}" text-anchor="end" fill="#e0554f" font-weight="700">Baku Mutu ${opts.standardRef}</text>`;
  }
  seriesArr.forEach(s=>{
    let pathD = "";
    s.values.forEach((v,i)=>{ if(v==null) return; pathD += (pathD?" L":"M")+xFor(i)+","+yFor(v); });
    if(pathD) svg += `<path d="${pathD}" fill="none" stroke="${s.color}" stroke-width="2.5"/>`;
    s.values.forEach((v,i)=>{ if(v==null) return; svg += `<circle cx="${xFor(i)}" cy="${yFor(v)}" r="3.5" fill="${s.color}"/>`; });
  });
  svg += `</svg>`;
  return svg;
}
function ambBuildTrendLegend(seriesArr){
  return seriesArr.filter(s=>s.values.some(v=>v!=null)).map(s=>`<span class="item"><span class="sw" style="background:${s.color}"></span>${escHtml(s.label)}</span>`).join("");
}
function ambBuildRankChart(rows, valueField, labelField, refLine, unitSuffix){
  if(!rows.length) return "<div class='hint' style='padding:14px;'>Tidak ada data untuk ditampilkan.</div>";
  const W=560, rowH=26, padL=200, padR=54, topPad=10;
  const H = topPad + rows.length*rowH + 10;
  const maxVal = Math.max(refLine||0, ...rows.map(r=>r[valueField]))*1.08;
  const plotW = W-padL-padR;
  let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;font-size:11px;background:var(--surface-card);border:1px solid var(--gray-200);border-radius:10px;">`;
  rows.forEach((r,i)=>{
    const y = topPad + i*rowH;
    const val = r[valueField];
    const barLen = (val/maxVal)*plotW;
    const color = refLine!=null ? (val>=refLine?"#e0554f":val>=refLine*0.8?"#e8a33d":"#3fb27f") : "#3d78c9";
    svg += `<text x="${padL-8}" y="${y+rowH/2+4}" text-anchor="end" fill="var(--gray-900)">${escHtml(r[labelField])}</text>`;
    svg += `<rect x="${padL}" y="${y+4}" width="${Math.max(2,barLen)}" height="${rowH-10}" rx="4" fill="${color}"/>`;
    svg += `<text x="${padL+barLen+6}" y="${y+rowH/2+4}" fill="var(--gray-900)" font-weight="700">${val}${unitSuffix||""}</text>`;
  });
  if(refLine!=null){
    const xRef = padL+(refLine/maxVal)*plotW;
    svg += `<line x1="${xRef}" y1="0" x2="${xRef}" y2="${H}" stroke="#e0554f" stroke-width="1" stroke-dasharray="3,3" opacity="0.6"/>`;
  }
  svg += `</svg>`;
  return svg;
}
function ambBuildHourlyProfile(record){
  if(!record || !record.hourly || !record.hourly.length) return "<div class='hint' style='padding:14px;'>Titik/tanggal ini belum ada data pembacaan per jam (data L Siang-Malam saja tanpa rincian per jam, atau belum dipilih).</div>";
  const W=780,H=280,padL=44,padR=16,padT=18,padB=34;
  const plotW=W-padL-padR, plotH=H-padT-padB;
  const vals = record.hourly.map(h=>h.nilai).filter(v=>v!=null);
  const hi = Math.max(...vals, record.baku||0), lo = Math.min(...vals);
  const minY = Math.max(0, Math.floor((lo-6)/5)*5), maxY = Math.ceil((hi+4)/5)*5;
  const n = record.hourly.length;
  const xFor = i=>padL+(n<=1?plotW/2:(i/(n-1))*plotW);
  const yFor = v=>padT+plotH-((v-minY)/(maxY-minY))*plotH;
  const isNight = jam=>{ const h = parseInt(String(jam),10); return h>=22 || h<6; };
  let svg = `<svg class="hd-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Profil kebisingan 24 jam">`;
  // Pita malam (22.00–06.00) — dasar L Malam.
  let runStart = null;
  record.hourly.forEach((h,i)=>{
    const night = isNight(h.jam);
    if(night && runStart==null) runStart = i;
    if((!night || i===n-1) && runStart!=null){
      const end = night ? i : i-1;
      const x0 = xFor(runStart)-(runStart?plotW/(n-1)/2:0), x1 = xFor(end)+(end<n-1?plotW/(n-1)/2:0);
      svg += `<rect x="${x0.toFixed(1)}" y="${padT}" width="${(x1-x0).toFixed(1)}" height="${plotH}" fill="var(--tbl-head-bg)" opacity=".07"/>`;
      svg += `<text x="${((x0+x1)/2).toFixed(1)}" y="${padT+plotH-8}" text-anchor="middle" class="hd-axis">Malam (22.00–06.00)</text>`;
      runStart = null;
    }
  });
  for(let g=0; g<=4; g++){
    const v = minY+(maxY-minY)*g/4, y = yFor(v);
    svg += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W-padR}" y2="${y.toFixed(1)}" class="hd-grid"/><text x="${padL-8}" y="${(y+4).toFixed(1)}" text-anchor="end" class="hd-axis">${hdNum(v,0)}</text>`;
  }
  record.hourly.forEach((h,i)=>{ if(i%2===0) svg += `<text x="${xFor(i).toFixed(1)}" y="${H-12}" text-anchor="middle" class="hd-axis">${escHtml(h.jam)}</text>`; });
  if(record.baku!=null){
    const yb = yFor(record.baku);
    svg += `<line x1="${padL}" y1="${yb.toFixed(1)}" x2="${W-padR}" y2="${yb.toFixed(1)}" class="hd-ref"/><text x="${W-padR}" y="${(yb-6).toFixed(1)}" text-anchor="end" class="hd-ref-label">Baku mutu Lsm ${hdNum(record.baku,0)} dB(A)</text>`;
  }
  const pts = record.hourly.map((h,i)=>h.nilai==null?null:[i,h.nilai]).filter(Boolean);
  svg += `<path d="${pts.map(([i,v],k)=>`${k?"L":"M"}${xFor(i).toFixed(1)},${yFor(v).toFixed(1)}`).join(" ")}" fill="none" stroke="#0ea5a0" stroke-width="2.4" stroke-linejoin="round"/>`;
  pts.forEach(([i,v])=>{ svg += `<circle cx="${xFor(i).toFixed(1)}" cy="${yFor(v).toFixed(1)}" r="3.4" fill="#0ea5a0" stroke="var(--surface-card)" stroke-width="1.2"><title>${escHtml(record.hourly[i].label||record.hourly[i].jam)}: ${hdNum(v,1)} dB(A)</title></circle>`; });
  svg += `</svg>`;
  return svg;
}
function ambBuildVibSpectrum(record){
  if(!record) return "<div class='hint' style='padding:14px;'>Tidak ada data profil spektrum untuk dipilih.</div>";
  const W=780,H=290,padL=54,padR=16,padT=18,padB=48;
  const plotW=W-padL-padR, plotH=H-padT-padB;
  const bands = record.bands||[];
  const n = bands.length || 1;
  const ndVals = bands.map(b=>{ const m=(b.notDisturb||"").match(/[\d.]+/); return m?parseFloat(m[0]):null; });
  const maxY = hdNiceMax(Math.max(...bands.map(b=>b.nilai||0), ...ndVals.filter(v=>v!=null))*1.1 || 1);
  const bw = plotW/n;
  const colorFor = s=> (AMB_VIB_STATUS.find(x=>x[0]===s)||[0,"#7f8fa0"])[1];
  const yFor = v=>padT+plotH-(v/maxY)*plotH;
  let svg = `<svg class="hd-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Spektrum getaran">`;
  for(let g=0; g<=4; g++){ const v = maxY*g/4, y = yFor(v);
    svg += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W-padR}" y2="${y.toFixed(1)}" class="hd-grid"/><text x="${padL-8}" y="${(y+4).toFixed(1)}" text-anchor="end" class="hd-axis">${hdNum(v)}</text>`; }
  bands.forEach((b,i)=>{
    const x = padL+i*bw, barH = ((b.nilai||0)/maxY)*plotH, y = padT+plotH-barH;
    svg += `<rect x="${(x+bw*0.2).toFixed(1)}" y="${y.toFixed(1)}" width="${(bw*0.6).toFixed(1)}" height="${Math.max(1,barH).toFixed(1)}" rx="3" fill="${colorFor(b.status)}"><title>${b.freq} Hz: ${hdNum(b.nilai)} micron · ${escHtml(b.status||"")} (batas Not Disturb ${escHtml(b.notDisturb||"-")})</title></rect>`;
    if(ndVals[i]!=null){ const yl = yFor(ndVals[i]); svg += `<line x1="${(x+bw*0.1).toFixed(1)}" y1="${yl.toFixed(1)}" x2="${(x+bw*0.9).toFixed(1)}" y2="${yl.toFixed(1)}" stroke="#b42318" stroke-width="2" stroke-dasharray="4 3"/>`; }
    svg += `<text x="${(x+bw/2).toFixed(1)}" y="${padT+plotH+16}" text-anchor="middle" class="hd-axis">${b.freq}</text>`;
  });
  svg += `<text x="${padL+plotW/2}" y="${H-8}" text-anchor="middle" class="hd-axis">Frekuensi (Hz) &middot; garis merah putus-putus = batas Not Disturb tiap pita</text></svg>`;
  return svg;
}

/* =========================================================
   DASHBOARD HASIL AMBIENT — gaya & komponen setara Dashboard Hasil Emisi (hd-*): hero + tab
   kategori, Executive Summary, KPI + sparkline, Trend (mode), Distribution zona %BM, Priority
   Watchlist, Heatmap, Snapshot parameter × site, profil 24 jam / spektrum, detail data.
   Data dibaca dari DB.hasilAmbien (menu Database Hasil Ambient), tidak ada data yg diubah.
   Tiap kategori dinormalisasi ke baris {titik, site, periode, val, pct(%BM), status, ...} supaya
   semua section memakai logika yang sama:
   - Udara Ambien & Kebauan: per parameter, %BM = pctOfBaku.
   - Kebisingan: metrik Lsm / Ls / Lm; baku mutu (Kepmen LH 48/1996) hanya berlaku utk Lsm.
   - Getaran: band frekuensi terburuk terhadap batas "Not Disturb" ISO 2631-2 (100% = batas).
========================================================= */
const AMB_NOISE_METRICS = [["lSiangMalam","L Siang-Malam (Lsm)"],["lSiang","L Siang (Ls)"],["lMalam","L Malam (Lm)"]];
const AMB_VIB_PARAM = "Band terburuk vs batas Not Disturb";
const AMB_VIB_STATUS = [["Not Disturb","#3fb27f"],["Disturb","#e2b45a"],["Uncomfortable","#c2620a"],["Painful","#b42318"]];
let ambTrendMode = "site", ambHeatMode = "site";

function ambParamsOf(cat){
  if(cat==="kebisingan") return AMB_NOISE_METRICS.map(m=>m[1]);
  if(cat==="getaran") return [AMB_VIB_PARAM];
  return [...new Set((DB.hasilAmbien[cat]||[]).map(r=>r.parameter))];
}
function ambVibWorst(rec){
  let best = null;
  (rec.bands||[]).forEach(b=>{
    const m = String(b.notDisturb||"").match(/[\d.]+/); if(!m) return;
    const lim = parseFloat(m[0]); if(!(lim>0) || b.nilai==null) return;
    const p = b.nilai/lim*100;
    if(!best || p>best.pct) best = {pct:p, band:b, lim};
  });
  return best;
}
// Kebisingan memakai skala desibel (logaritmik): Lsm 52 dB vs baku 70 dB sudah ±75% BM walau masih
// jauh dari batas. Utk penentuan ZONA & warna saja, %BM kebisingan dipetakan ulang: Early Warning bila
// >=95% BM (±3 dB dari batas), Watch >=85%. Angka %BM yang ditampilkan tetap nilai aslinya.
function ambZonePct(cat, pct){
  if(pct==null || cat!=="kebisingan" || pct>=100) return pct;
  if(pct>=95) return 70+(pct-95)/5*30;
  if(pct>=85) return 50+(pct-85)/10*20;
  return pct*50/85;
}
function ambNormRows(cat, param){
  const all = DB.hasilAmbien[cat]||[];
  const base = r=>({rec:r, id:r.id, titik:r.titik, site:r.site, periode:r.periode, periodeOrder:r.periodeOrder, tanggal:r.tanggal});
  if(cat==="kebisingan"){
    const key = (AMB_NOISE_METRICS.find(m=>m[1]===param)||AMB_NOISE_METRICS[0])[0];
    const isLsm = key==="lSiangMalam";
    return all.map(r=>({...base(r), param:param||AMB_NOISE_METRICS[0][1], val:r[key], raw:r[key]!=null?hdNum(r[key],1):"-", unit:r.unit||"dB(A)",
      std:isLsm?r.baku:null, pct:isLsm?r.pctOfBaku:null, zp:isLsm?ambZonePct("kebisingan", r.pctOfBaku):null, status:isLsm?r.statusBakuMutu:null, bdl:false}));
  }
  if(cat==="getaran"){
    return all.map(r=>{ const w = ambVibWorst(r); return {...base(r), param:AMB_VIB_PARAM, val:w?w.band.nilai:null,
      raw:w?`${hdNum(w.band.nilai)} @ ${w.band.freq} Hz`:"-", unit:r.unit||"micron", std:w?w.lim:null, pct:w?w.pct:null, zp:w?w.pct:null, band:w?w.band.freq:null,
      status: r.statusKeseluruhan ? (r.statusKeseluruhan==="Not Disturb"?"ok":"exceed") : null, vibStatus:r.statusKeseluruhan, bdl:false}; });
  }
  return all.filter(r=>!param || r.parameter===param).map(r=>({...base(r), param:r.parameter, val:r.resultNumeric, raw:r.resultRaw, unit:r.unit,
    std:r.baku, pct:r.pctOfBaku, zp:r.pctOfBaku, status:r.statusBakuMutu, bdl:r.resultStatus==="below_detection"}));
}
function ambStat(rows){
  const ev = rows.filter(r=>r.status==="ok"||r.status==="exceed");
  const ok = ev.filter(r=>r.status==="ok").length, exceed = ev.length-ok;
  const pcts = rows.map(r=>r.pct).filter(v=>v!=null), vals = rows.map(r=>r.val).filter(v=>v!=null);
  return {n:rows.length, evalN:ev.length, ok, exceed, compliance: ev.length?ok/ev.length*100:null,
    avgPct:hdMean(pcts), maxPct:pcts.length?Math.max(...pcts):null, avgVal:hdMean(vals), maxVal:vals.length?Math.max(...vals):null,
    warn: new Set(rows.filter(r=>hdZoneOf(r.zp, r.status)==="warn").map(r=>r.titik)).size,
    bdl: rows.filter(r=>r.bdl).length};
}
function ambBuildCtx(){
  const cat = ambDashCat;
  const params = ambParamsOf(cat);
  if(!params.includes(ambDashFlt.param)) ambDashFlt.param = params[0]||"";
  const fromOrder = ambDashFlt.from ? hasilPeriodParts(ambDashFlt.from).order : -Infinity;
  const toOrder = ambDashFlt.to ? hasilPeriodParts(ambDashFlt.to).order : Infinity;
  const inScope = r=> (!ambDashFlt.site || r.site===ambDashFlt.site) && r.periodeOrder>=fromOrder && r.periodeOrder<=toOrder;
  const rows = ambNormRows(cat, ambDashFlt.param).filter(inScope);
  const multiParam = cat==="ambien" || cat==="kebauan";
  const catRows = multiParam ? ambNormRows(cat, "").filter(inScope) : rows;
  const periods = hdSortPeriods(rows.map(r=>r.periode));
  const last = periods[periods.length-1]||null, prev = periods.length>1 ? periods[periods.length-2] : null;
  const raw = DB.hasilAmbien[cat]||[];
  return {cat, params, multiParam, rows, catRows, periods, last, prev,
    numeric: rows.filter(r=>r.val!=null),
    lastRows: last ? rows.filter(r=>r.periode===last) : [], prevRows: prev ? rows.filter(r=>r.periode===prev) : [],
    hasStd: rows.some(r=>r.pct!=null), unit:(rows.find(r=>r.unit)||{}).unit||"", stdRef: hdMedian(rows.map(r=>r.std).filter(v=>v!=null)),
    allSites:[...new Set(raw.map(r=>r.site))].sort(), allPeriods: hdSortPeriods(raw.map(r=>r.periode)),
    paramLabel: cat==="getaran" ? "% batas Not Disturb" : ambDashFlt.param};
}
const ambPctLabel = ctx=> ctx.cat==="getaran" ? "% batas ND" : "% BM";
const ambStdWord = ctx=> ctx.cat==="getaran" ? "batas Not Disturb" : "baku mutu";

/* ---------- Hero, tab kategori & nav ---------- */
const AMB_CAT_DESC = {
  ambien:"Konsentrasi parameter udara ambien (SO₂, CO, NO₂, O₃, partikulat, dst) terhadap baku mutu PP 22/2021 Lampiran VII.",
  kebisingan:"Tingkat kebisingan lingkungan L Siang, L Malam dan L Siang-Malam terhadap baku mutu Kepmen LH 48/1996.",
  kebauan:"Parameter kebauan (NH₃, H₂S, Styrene, Mercaptan, dst) terhadap baku tingkat kebauan Kepmen LH 50/1996.",
  getaran:"Getaran lingkungan per pita frekuensi 4–63 Hz terhadap kriteria kenyamanan ISO 2631-2 (Not Disturb s/d Painful)."
};
function ambRenderHero(){
  const tabs = document.getElementById("ambDashCategoryTabs");
  if(tabs) tabs.innerHTML = AMB_KATEGORI_ORDER.map(c=>`<button type="button" role="tab" class="hd-tab ${ambDashCat===c?"on":""}" aria-selected="${ambDashCat===c}" data-action="ambDashSetCat" data-cat="${c}">${escHtml(AMB_KATEGORI_LABEL[c])} <span class="n">${ambDbRecords(c).length}</span></button>`).join("");
  const desc = document.getElementById("ambHeroDesc"); if(desc) desc.textContent = AMB_CAT_DESC[ambDashCat]||"";
  const meta = document.getElementById("ambHeroMeta");
  if(meta){
    const all = DB.hasilAmbien[ambDashCat]||[];
    const upd = DB.meta?.datasetUpdatedAt?.hasilAmbien;
    const dt = upd ? new Date(upd) : null;
    const dateTxt = dt && !isNaN(dt) ? dt.toLocaleDateString("id-ID",{day:"numeric",month:"short",year:"numeric"}) : "";
    meta.innerHTML = `<span class="dot" aria-hidden="true"></span>${dateTxt?`Data per ${escHtml(dateTxt)} &middot; `:""}${hdNum(all.length,0)} baris &middot; ${new Set(all.map(r=>r.titik)).size} titik`;
  }
  const nav = document.getElementById("ambSecNav");
  if(nav){
    const items = [["ambSecOverview","Overview"],["ambSecTrend","Trend &amp; Distribution"],["ambSecWatch","Watchlist &amp; Heatmap"],["ambSecSnap","Snapshot"]]
      .concat(ambDashCat==="kebisingan"?[["ambSecProfile","Profil 24 Jam"]]:ambDashCat==="getaran"?[["ambSecProfile","Spektrum &amp; Status"]]:[])
      .concat([["ambSecData","Detail Data"]]);
    nav.innerHTML = items.map(([id,l])=>`<button type="button" data-action="hdJump" data-target="${id}">${l}</button>`).join("")
      + `<span class="spacer"></span><button class="btn small ghost hd-reset" data-action="ambDashReset">Reset Filter</button>`;
  }
}
function ambFilterBar(ctx){
  const opt = (v,l,cur)=>`<option value="${escHtml(v)}" ${cur===v?"selected":""}>${escHtml(l)}</option>`;
  const paramChips = ctx.params.length>1 ? `<div class="amb-param-row"><span class="amb-param-lbl">${ctx.cat==="kebisingan"?"Metrik":"Parameter"}</span>${hdSeg("ambSetParam", ambDashFlt.param, ctx.params.map(p=>[p,p]))}</div>` : "";
  return `<div class="card amb-filter">
    <div class="amb-filter-fields">
      <div class="field"><label>Site</label><select id="ambDashFltSite">${opt("","Semua site",ambDashFlt.site)}${ctx.allSites.map(s=>opt(s,s,ambDashFlt.site)).join("")}</select></div>
      <div class="field"><label>Dari periode</label><select id="ambDashFltFrom">${opt("","Awal",ambDashFlt.from)}${ctx.allPeriods.map(p=>opt(p,p,ambDashFlt.from)).join("")}</select></div>
      <div class="field"><label>Sampai periode</label><select id="ambDashFltTo">${opt("","Akhir",ambDashFlt.to)}${ctx.allPeriods.map(p=>opt(p,p,ambDashFlt.to)).join("")}</select></div>
      <div class="hint amb-scope">${hdNum(ctx.rows.length,0)} baris ${escHtml(ctx.paramLabel)} &middot; ${new Set(ctx.rows.map(r=>r.titik)).size} titik &middot; ${new Set(ctx.rows.map(r=>r.site)).size} site &middot; ${ctx.periods.length} periode</div>
    </div>
    ${paramChips}
  </div>`;
}

/* ---------- Executive summary & KPI ---------- */
function ambInsight(ctx){
  if(!ctx.last) return "";
  const s = [];
  const catSt = ambStat(ctx.catRows);
  const lbl = AMB_KATEGORI_LABEL[ctx.cat];
  if(ctx.cat==="getaran"){
    const lastSt = ambStat(ctx.lastRows);
    s.push(`Pada ${ctx.last}, <b>${lastSt.ok} dari ${lastSt.evalN}</b> pengukuran getaran berstatus <b>Not Disturb</b>${lastSt.exceed?`, ${lastSt.exceed} pengukuran masuk kategori Disturb atau lebih tinggi`:""}.`);
  } else if(catSt.compliance!=null){
    s.push(`Kepatuhan ${escHtml(lbl.toLowerCase())} pada rentang ini <b>${hdPct(catSt.compliance, catSt.compliance>=99.95?0:1)}</b> (${catSt.ok} dari ${catSt.evalN} data memenuhi baku mutu)${catSt.exceed?`, dengan <b class="bad">${catSt.exceed} data melebihi</b>`:", tanpa satu pun data yang melebihi"}.`);
  }
  const top = ctx.lastRows.filter(r=>r.pct!=null).sort((a,b)=>b.pct-a.pct)[0];
  if(top) s.push(`Nilai tertinggi ${ctx.cat==="getaran"?"":escHtml(ctx.paramLabel)+" "}di ${ctx.last} ada di <b>${escHtml(top.titik)}</b> (${escHtml(top.site)}): ${escHtml(top.raw)} ${escHtml(top.unit)}, setara <b>${hdPct(top.pct,0)}</b> ${ambStdWord(ctx)}.`);
  const a = ambStat(ctx.lastRows), b = ctx.prev ? ambStat(ctx.prevRows) : null;
  if(b && a.avgPct!=null && b.avgPct!=null){
    const d = a.avgPct-b.avgPct;
    s.push(`Rata-rata ${ambPctLabel(ctx)} ${d>0.5?"naik":d<-0.5?"turun":"relatif stabil"} dari ${hdPct(b.avgPct)} (${ctx.prev}) ke ${hdPct(a.avgPct)} (${ctx.last}).`);
  }
  if(ctx.multiParam && ctx.rows.length){
    const bdlPct = ctx.rows.filter(r=>r.bdl).length/ctx.rows.length*100;
    if(bdlPct>=20) s.push(`${hdPct(bdlPct,0)} hasil ${escHtml(ctx.paramLabel)} berada di bawah batas deteksi metode (nilai "&lt;"), sehingga angka yang tampil adalah batas deteksinya, bukan konsentrasi sebenarnya.`);
  }
  const bySite = {}; ctx.lastRows.filter(r=>r.pct!=null).forEach(r=>{ (bySite[r.site]=bySite[r.site]||[]).push(r.pct); });
  const siteTop = Object.entries(bySite).map(([k,v])=>[k,hdMean(v)]).sort((x,y)=>y[1]-x[1])[0];
  if(siteTop && Object.keys(bySite).length>1) s.push(`Site dengan rata-rata ${ambPctLabel(ctx)} tertinggi: <b>${escHtml(siteTop[0])}</b> (${hdPct(siteTop[1])}).`);
  const exceedNow = ctx.cat==="getaran" ? ambStat(ctx.lastRows).exceed : ambStat(ctx.catRows.filter(r=>r.periode===ctx.last)).exceed;
  const badge = exceedNow ? `<span class="badge b-red">${exceedNow} ${ctx.cat==="getaran"?"di atas Not Disturb":"melebihi baku mutu"}</span>` : `<span class="badge b-green">Semua memenuhi</span>`;
  return `<section class="hd-insight" aria-label="Ringkasan otomatis">
    <div class="hd-insight-ic" aria-hidden="true">${HD_IC.spark}</div>
    <div class="hd-insight-body">
      <div class="hd-insight-head"><h3>Executive Summary &middot; ${escHtml(lbl)} &middot; ${ctx.last}</h3>${badge}</div>
      <ul class="amb-insight-list">${s.map(x=>`<li>${x}</li>`).join("")}</ul>
    </div>
  </section>`;
}
function ambKpis(ctx){
  if(!ctx.periods.length) return "";
  const per = ctx.periods.map(p=>({p, st:ambStat(ctx.rows.filter(r=>r.periode===p)), cst:ambStat(ctx.catRows.filter(r=>r.periode===p))}));
  const lastSt = per[per.length-1].st, prevSt = per.length>1 ? per[per.length-2].st : null;
  const catAll = ambStat(ctx.catRows);
  const tiles = [];
  const isVib = ctx.cat==="getaran";
  tiles.push(hdKpi({label: isVib?"Not Disturb":"Compliance Rate", icon:HD_IC.shield,
    tone: catAll.compliance==null?"":catAll.compliance>=99.95?"good":catAll.compliance>=95?"warn":"bad",
    value: catAll.compliance==null?"-":hdPct(catAll.compliance, catAll.compliance>=99.95||catAll.compliance===0?0:1),
    spark: hdSpark(per.map(x=>x.cst.compliance), {color:"#2f9e67", ref:100, label:"Kepatuhan per periode"}),
    foot: `${catAll.ok} dari ${catAll.evalN} data${ctx.multiParam?" (semua parameter)":""} &middot; ${ctx.periods.length>1?`${ctx.periods[0]} s/d ${ctx.last}`:ctx.last}`}));
  const exRows = ctx.catRows.filter(r=>r.status==="exceed").sort((a,b)=>b.periodeOrder-a.periodeOrder);
  tiles.push(hdKpi({label: isVib?"Di atas Not Disturb":"Exceedance", icon:HD_IC.alert, tone: exRows.length?"bad":"",
    value: hdNum(exRows.length,0), suffix: exRows.length?" data":"",
    spark: hdSpark(per.map(x=>x.cst.exceed), {bars:true, color:"#b42318", zero:true, label:"Data melebihi per periode"}),
    foot: exRows[0] ? `Terakhir: ${escHtml(exRows[0].titik)}${ctx.multiParam?`, ${escHtml(exRows[0].param)}`:""}, ${exRows[0].periode}` : `Belum ada data yang melebihi ${ambStdWord(ctx)}`}));
  if(ctx.hasStd){
    const d = prevSt && prevSt.avgPct!=null && lastSt.avgPct!=null ? lastSt.avgPct-prevSt.avgPct : null;
    tiles.push(hdKpi({label:`Rata-rata ${ambPctLabel(ctx)}`, icon:HD_IC.trend, value: hdPct(lastSt.avgPct),
      spark: hdSpark(per.map(x=>x.st.avgPct), {color:"var(--heading-2)", label:"Rata-rata per periode"}),
      foot: d==null ? `${escHtml(ctx.paramLabel)} &middot; ${ctx.last}` : `<b class="${d>0.05?"up":d<-0.05?"down":""}">${d>0.05?"▲":d<-0.05?"▼":"•"} ${hdNum(Math.abs(d),1)} poin</b> dibanding ${ctx.prev}`}));
  } else {
    const dv = prevSt && prevSt.avgVal ? (lastSt.avgVal-prevSt.avgVal)/prevSt.avgVal*100 : null;
    tiles.push(hdKpi({label:`Rata-rata ${escHtml(ctx.paramLabel)}`, icon:HD_IC.trend, value: hdNum(lastSt.avgVal,1), suffix:" "+escHtml(ctx.unit),
      spark: hdSpark(per.map(x=>x.st.avgVal), {color:"var(--heading-2)"}),
      foot: dv==null ? `${ctx.last} &middot; tanpa baku mutu tersendiri` : `${hdSignedPct(dv)} dibanding ${ctx.prev}`}));
  }
  const maxRec = ctx.lastRows.filter(r=>r.val!=null).sort((a,b)=> ctx.hasStd ? (b.pct||0)-(a.pct||0) : b.val-a.val)[0];
  tiles.push(hdKpi({label:"Nilai Tertinggi", icon:HD_IC.gauge, tone: maxRec && hdZoneOf(maxRec.zp, maxRec.status)==="exceed" ? "bad" : maxRec && hdZoneOf(maxRec.zp, maxRec.status)==="warn" ? "warn" : "",
    value: maxRec ? escHtml(isVib ? hdNum(maxRec.val) : maxRec.raw) : "-", suffix: maxRec ? " "+escHtml(maxRec.unit) : "",
    foot: maxRec ? `${escHtml(maxRec.titik)} (${escHtml(maxRec.site)})${maxRec.pct!=null?` &middot; ${hdPct(maxRec.pct,0)} ${ambPctLabel(ctx).replace("% ","")}`:""}${isVib&&maxRec.band?` &middot; ${maxRec.band} Hz`:""}` : "-"}));
  const titikN = new Set(ctx.lastRows.map(r=>r.titik)).size;
  tiles.push(hdKpi({label:"Titik Dipantau", icon:HD_IC.db, value: hdNum(titikN,0), suffix:" titik",
    spark: hdSpark(per.map(x=>new Set(ctx.rows.filter(r=>r.periode===x.p).map(r=>r.titik)).size), {bars:true, color:"#3d78c9", label:"Titik per periode"}),
    foot: `${new Set(ctx.lastRows.map(r=>r.site)).size} site &middot; ${ctx.last}`}));
  if(ctx.multiParam){
    const bdl = lastSt.bdl, n = lastSt.n;
    tiles.push(hdKpi({label:"Di Bawah Batas Deteksi", icon:HD_IC.clock, value: n?hdPct(bdl/n*100,0):"-",
      spark:`<div class="hd-mini-bar" role="img" aria-label="${bdl} dari ${n} di bawah deteksi"><i style="width:${n?(bdl/n*100).toFixed(1):0}%"></i></div>`,
      foot: `${bdl} dari ${n} hasil ${escHtml(ctx.paramLabel)} bernilai "&lt;" di ${ctx.last}`}));
  } else if(ctx.cat==="kebisingan"){
    const recs = (DB.hasilAmbien.kebisingan||[]).filter(r=>r.periode===ctx.last && (!ambDashFlt.site||r.site===ambDashFlt.site));
    const ls = hdMean(recs.map(r=>r.lSiang).filter(v=>v!=null)), lm = hdMean(recs.map(r=>r.lMalam).filter(v=>v!=null));
    tiles.push(hdKpi({label:"Siang vs Malam", icon:HD_IC.clock, value: ls!=null&&lm!=null?hdNum(ls-lm,1):"-", suffix:" dB",
      foot: `Rata-rata Ls ${hdNum(ls,1)} vs Lm ${hdNum(lm,1)} dB(A) &middot; ${ctx.last}`}));
  } else {
    const cnt = {}; ctx.lastRows.forEach(r=>{ if(r.band!=null) cnt[r.band]=(cnt[r.band]||0)+1; });
    const dom = Object.entries(cnt).sort((a,b)=>b[1]-a[1])[0];
    tiles.push(hdKpi({label:"Band Dominan", icon:HD_IC.clock, value: dom?dom[0]:"-", suffix: dom?" Hz":"",
      foot: dom ? `Band terburuk pada ${dom[1]} dari ${ctx.lastRows.length} pengukuran ${ctx.last}` : "-"}));
  }
  return tiles.join("");
}

/* ---------- Trend ---------- */
function ambTrend(ctx){
  const modes = [["site","Per Site"],["max","Max per Site"]].concat(ctx.hasStd?[["pct",ambPctLabel(ctx)+" per Site"]]:[]).concat([["titik","Per Titik (8 teratas)"]]);
  if(!modes.some(m=>m[0]===ambTrendMode)) ambTrendMode = "site";
  const mode = ambTrendMode;
  const toggle = hdSeg("ambSetTrendMode", mode, modes);
  if(!ctx.numeric.length) return {toggle, svg: hdEmpty("Tidak ada data terukur pada filter ini."), legend:""};
  let keys, keyFn, colorFn, agg="mean", valFn = r=>r.val;
  if(mode==="titik"){
    const latest = {}; ctx.numeric.forEach(r=>{ const c = latest[r.titik]; if(!c || r.periodeOrder>c.periodeOrder) latest[r.titik] = r; });
    keys = Object.values(latest).sort((a,b)=> ctx.hasStd ? (b.pct||0)-(a.pct||0) : b.val-a.val).slice(0,8).map(r=>r.titik);
    keyFn = r=>r.titik; colorFn = (k,i)=>HD_PALETTE[i%HD_PALETTE.length];
  } else {
    keys = [...new Set(ctx.numeric.map(r=>r.site))].sort(); keyFn = r=>r.site; colorFn = k=>hdSiteColor(k);
    if(mode==="max") agg = "max";
    if(mode==="pct") valFn = r=>r.pct;
  }
  const n = ctx.periods.length;
  const series = keys.map((k,i)=>({key:k, color:colorFn(k,i), values: ctx.periods.map(p=>{
    const v = ctx.numeric.filter(r=>keyFn(r)===k && r.periode===p).map(valFn).filter(x=>x!=null);
    return v.length ? (agg==="max"?Math.max(...v):hdMean(v)) : null;
  })})).filter(s=>s.values.some(v=>v!=null));
  if(!series.length) return {toggle, svg: hdEmpty("Tidak ada data untuk kombinasi filter ini."), legend:""};
  const isPct = mode==="pct";
  const ref = isPct ? 100 : ctx.stdRef;
  const dataMax = Math.max(...series.flatMap(s=>s.values.filter(v=>v!=null)));
  const dataMin = Math.min(...series.flatMap(s=>s.values.filter(v=>v!=null)));
  const showRef = ref!=null && ref<=dataMax*4;
  // Kebisingan (dB) tidak dimulai dari nol supaya selisih beberapa dB tetap terlihat.
  const yMin = ctx.cat==="kebisingan" && !isPct ? Math.max(0, Math.floor((Math.min(dataMin, showRef?ref:dataMin)-5)/5)*5) : 0;
  const yMax = hdNiceMax(Math.max(dataMax, showRef?ref:0)*1.08);
  const W=780, H=320, padL=54, padR=118, padT=22, padB=36, plotW=W-padL-padR, plotH=H-padT-padB;
  const x = i=>padL + (n<=1 ? plotW/2 : i/(n-1)*plotW);
  const y = v=>padT + plotH - (v-yMin)/(yMax-yMin)*plotH;
  const sfx = isPct?"%":"";
  let svg = `<svg class="hd-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Trend ${escHtml(ctx.paramLabel)}">`;
  if(showRef && ref*0.7>yMin) svg += `<rect x="${padL}" y="${y(ref).toFixed(1)}" width="${plotW}" height="${(y(Math.max(yMin,ref*0.7))-y(ref)).toFixed(1)}" class="hd-band"/>`;
  for(let g=0; g<=4; g++){ const v = yMin+(yMax-yMin)*g/4, yy = y(v);
    svg += `<line x1="${padL}" y1="${yy.toFixed(1)}" x2="${W-padR}" y2="${yy.toFixed(1)}" class="hd-grid"/><text x="${padL-8}" y="${(yy+4).toFixed(1)}" text-anchor="end" class="hd-axis">${hdNum(v)}${sfx}</text>`; }
  ctx.periods.forEach((p,i)=>{ svg += `<text x="${x(i).toFixed(1)}" y="${H-12}" text-anchor="middle" class="hd-axis ${i===n-1?"strong":""}">${p}</text>`; });
  if(showRef){
    svg += `<line x1="${padL}" y1="${y(ref).toFixed(1)}" x2="${W-padR}" y2="${y(ref).toFixed(1)}" class="hd-ref"/>`;
    svg += `<text x="${W-padR}" y="${(y(ref)-6).toFixed(1)}" text-anchor="end" class="hd-ref-label">${ctx.cat==="getaran"?"Batas Not Disturb":"Baku mutu"} ${hdNum(ref)}${sfx}</text>`;
  }
  series.forEach(s=>{
    const pts = s.values.map((v,i)=>v==null?null:[i,v]).filter(Boolean);
    for(let k=1;k<pts.length;k++){ const [i0,v0]=pts[k-1],[i1,v1]=pts[k];
      svg += `<line x1="${x(i0).toFixed(1)}" y1="${y(v0).toFixed(1)}" x2="${x(i1).toFixed(1)}" y2="${y(v1).toFixed(1)}" stroke="${s.color}" stroke-width="2.4" stroke-linecap="round" ${i1-i0>1?'stroke-dasharray="3 5"':""}/>`; }
    pts.forEach(([i,v])=>{ svg += `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="4" fill="${s.color}" stroke="var(--surface-card)" stroke-width="1.5"><title>${escHtml(s.key)} · ${ctx.periods[i]}: ${hdNum(v)}${isPct?"%":" "+escHtml(ctx.unit)}</title></circle>`; });
  });
  const labels = series.map(s=>{ const pts = s.values.map((v,i)=>v==null?null:[i,v]).filter(Boolean); const lv = pts[pts.length-1][1]; return {s, y:y(lv), v:lv}; }).sort((a,b)=>a.y-b.y);
  for(let i=1;i<labels.length;i++) if(labels[i].y-labels[i-1].y<14) labels[i].y = labels[i-1].y+14;
  const ov = labels.length ? labels[labels.length-1].y-(padT+plotH) : 0; if(ov>0) labels.forEach(l=>{ l.y -= ov; });
  labels.forEach(l=>{ svg += `<text x="${W-padR+10}" y="${(l.y+4).toFixed(1)}" class="hd-end-label" fill="${l.s.color}">${escHtml(hdTrunc(l.s.key,13))} ${hdNum(l.v)}${sfx}</text>`; });
  svg += `</svg>`;
  const legend = series.map(s=>`<span class="item"><span class="sw" style="background:${s.color}"></span>${escHtml(s.key)}</span>`).join("")
    + (showRef ? `<span class="item"><span class="sw hd-sw-ref"></span>${ctx.cat==="getaran"?"Batas Not Disturb":"Baku mutu"}</span><span class="item"><span class="sw hd-sw-band"></span>Zona Early Warning (&ge;70%)</span>` : "")
    + (ref!=null && !showRef ? `<span class="item muted">Baku mutu ${hdNum(ref)} ${escHtml(ctx.unit)} jauh di atas skala data, garis tidak digambar supaya trend tetap terbaca.</span>` : "")
    + (yMin>0 ? `<span class="item muted">Sumbu Y dimulai dari ${hdNum(yMin)} dB supaya selisih kecil tetap terlihat.</span>` : "");
  return {toggle, svg, legend};
}

/* ---------- Distribution zona ---------- */
function ambDistribution(ctx){
  if(ctx.cat==="getaran"){
    const cnt = {}; ctx.lastRows.forEach(r=>{ cnt[r.vibStatus] = (cnt[r.vibStatus]||0)+1; });
    const seg = AMB_VIB_STATUS.map(([l,c])=>[l, cnt[l]||0, c]).filter(s=>s[1]>0);
    const total = ctx.lastRows.length;
    if(!total) return hdEmpty("Tidak ada data pada rentang ini.");
    const d = ambBuildDonut(seg, total?hdPct((cnt["Not Disturb"]||0)/total*100,0):"-", "Not Disturb");
    return `<div class="hint" style="margin:0 0 8px;">${ctx.last}, ${total} pengukuran, status terburuk dari seluruh pita frekuensi.</div>${d.svg}
      <div class="hd-zone-grid">${AMB_VIB_STATUS.map(([l,c])=>`<div class="hd-zone" style="background:color-mix(in srgb, ${c} 14%, transparent)"><span class="hd-zone-lbl"><i style="background:${c}"></i>${l}</span><span class="hd-zone-val ${l!=="Not Disturb"&&cnt[l]?"bad":""}">${cnt[l]||0} <small>data</small></span></div>`).join("")}</div>`;
  }
  const rows = ctx.lastRows.filter(r=>r.pct!=null);
  if(!rows.length){
    const vals = ctx.lastRows.map(r=>r.val).filter(v=>v!=null);
    if(!vals.length) return hdEmpty("Tidak ada data pada rentang ini.");
    return `<div class="hint" style="margin:0 0 8px;">${ctx.last}, ${vals.length} titik. ${escHtml(ctx.paramLabel)} tidak memiliki baku mutu tersendiri.</div>
      <div class="hd-zone-grid">${[["Minimum",Math.min(...vals)],["Median",hdMedian(vals)],["Rata-rata",hdMean(vals)],["Maksimum",Math.max(...vals)]].map(([l,v])=>`<div class="hd-zone"><span class="hd-zone-lbl">${l}</span><span class="hd-zone-val">${hdNum(v,1)} <small>${escHtml(ctx.unit)}</small></span></div>`).join("")}</div>`;
  }
  const bins = Array(11).fill(0);
  rows.forEach(r=>{ bins[r.pct>100 ? 10 : Math.min(9, Math.floor(r.pct/10))]++; });
  const zc = {safe:0, watch:0, warn:0, exceed:0}; rows.forEach(r=>{ zc[hdZoneOf(r.zp, r.status)]++; });
  const noise = ctx.cat==="kebisingan";
  const zoneOfBin = i=> noise ? (i>=10?"exceed":i>=9?"warn":i>=8?"watch":"safe") : (i>=10?"exceed":i>=7?"warn":i>=5?"watch":"safe");
  const maxC = Math.max(...bins, 1), W=420, H=220, padL=28, base=182, top=16, bw=28, step=34;
  let svg = `<svg class="hd-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Histogram ${ambPctLabel(ctx)}">`;
  [0, Math.ceil(maxC/2), maxC].forEach(t=>{ const yy = base-(t/maxC)*(base-top); svg += `<line x1="${padL}" y1="${yy}" x2="${W-6}" y2="${yy}" class="hd-grid"/><text x="${padL-6}" y="${yy+4}" text-anchor="end" class="hd-axis">${t}</text>`; });
  bins.forEach((c,i)=>{
    const zone = zoneOfBin(i);
    const h = c ? Math.max(3,(c/maxC)*(base-top)) : 2, bx = padL+8+i*step;
    svg += `<rect x="${bx}" y="${base-h}" width="${bw}" height="${h}" rx="3" fill="${HD_ZONES[zone].color}" ${c?"":'opacity=".35"'}><title>${i<10?`${i*10}–${i*10+10}%`:">100%"}: ${c} data</title></rect>`;
    if(c) svg += `<text x="${bx+bw/2}" y="${base-h-5}" text-anchor="middle" class="hd-axis strong">${c}</text>`;
    if(i%2===0 || i===10) svg += `<text x="${bx+bw/2}" y="${base+16}" text-anchor="middle" class="hd-axis">${i<10?i*10:">100"}</text>`;
  });
  svg += `<text x="${W/2}" y="${H-2}" text-anchor="middle" class="hd-axis">${ambPctLabel(ctx)}</text></svg>`;
  const total = rows.length;
  const stack = `<div class="hd-stack">${Object.keys(zc).filter(z=>zc[z]).map(z=>`<i style="width:${(zc[z]/total*100).toFixed(1)}%;background:${HD_ZONES[z].color}"></i>`).join("")}</div>`;
  const noiseRange = {safe:"di bawah 85%", watch:"85 sampai 95%", warn:"95 sampai 100%", exceed:"di atas 100%"};
  const tiles = `<div class="hd-zone-grid">${Object.keys(zc).map(z=>`<div class="hd-zone" style="background:${HD_ZONES[z].tint}"><span class="hd-zone-lbl"><i style="background:${HD_ZONES[z].color}"></i>${HD_ZONES[z].label}, ${noise?noiseRange[z]:HD_ZONES[z].range}</span><span class="hd-zone-val ${z==="warn"&&zc[z]?"warn":z==="exceed"&&zc[z]?"bad":""}">${zc[z]} <small>data</small></span></div>`).join("")}</div>`;
  return `<div class="hint" style="margin:0 0 8px;">${ctx.last}, ${total} data dengan ${ambStdWord(ctx)}.${noise?" Skala desibel: Early Warning bila Lsm dalam ±3 dB dari baku mutu (&ge;95%).":""}</div>${stack}${svg}${tiles}`;
}

/* ---------- Watchlist ---------- */
function ambWatchlist(ctx){
  if(!ctx.last) return hdEmpty("Tidak ada data pada rentang ini.");
  const prevBy = {}; ctx.prevRows.forEach(r=>{ prevBy[r.titik] = r; });
  const rows = ctx.lastRows.filter(r=>r.val!=null).sort((a,b)=> ctx.hasStd ? (b.pct||0)-(a.pct||0) : b.val-a.val).slice(0,10);
  if(!rows.length) return hdEmpty(`Tidak ada data terukur pada ${ctx.last}.`);
  const scale = ctx.hasStd ? Math.max(100, ...rows.map(r=>r.pct||0)) : Math.max(...rows.map(r=>r.val));
  const body = rows.map((r,i)=>{
    const p = prevBy[r.titik];
    const d = p && p.val ? (r.val-p.val)/p.val*100 : null;
    const zone = ctx.hasStd ? hdZoneOf(r.zp, r.status) : null;
    const metric = ctx.hasStd ? (r.pct||0) : r.val;
    const barColor = zone ? HD_ZONES[zone].color : "#5a7fb0";
    const statusCell = ctx.cat==="getaran" ? `<span class="badge ${r.vibStatus==="Not Disturb"?"b-green":r.vibStatus==="Disturb"?"b-amber":"b-red"}">${escHtml(r.vibStatus||"-")}</span>` : ctx.hasStd ? hdZoneBadge(zone) : `<span class="badge b-blue">Info</span>`;
    return `<tr>
      <td class="hd-rank">${i+1}</td>
      <td><div class="hd-cell-main"><b>${escHtml(r.titik)}</b>${r.bdl?`<span class="hd-cell-sub">di bawah batas deteksi</span>`:""}</div></td>
      <td><span class="hd-site"><i style="background:${hdSiteColor(r.site)}"></i>${escHtml(r.site)}</span></td>
      <td class="num">${escHtml(r.raw)} <span class="muted">${escHtml(r.unit)}</span></td>
      <td><div class="hd-bullet"><div class="track"><i style="width:${Math.min(100,metric/scale*100).toFixed(1)}%;background:${barColor}"></i>${ctx.hasStd?`<b style="left:${((ctx.cat==="kebisingan"?95:70)/scale*100).toFixed(1)}%"></b>`:""}</div><span class="v ${zone==="warn"||zone==="exceed"?"warn":""}">${ctx.hasStd?hdPct(r.pct):hdNum(r.val)}</span></div></td>
      <td class="num"><span class="hd-delta ${d==null?"":d>0.05?"up":d<-0.05?"down":""}">${d==null?"-":(d>0.05?"▲ ":d<-0.05?"▼ ":"")+hdSignedPct(d)}</span></td>
      <td class="muted">${r.tanggal?escHtml(new Date(r.tanggal).toLocaleDateString("id-ID",{day:"numeric",month:"short",year:"numeric"})):"-"}</td>
      <td>${statusCell}</td>
    </tr>`;
  }).join("");
  return `<div class="tablewrap hd-table-wrap"><table class="hd-table">
    <thead><tr><th>#</th><th>Titik</th><th>Site</th><th class="num">Hasil</th><th>${ctx.hasStd?ambPctLabel(ctx):"Relatif"}</th><th class="num">vs ${ctx.prev||"-"}</th><th>Sampling</th><th>Status</th></tr></thead>
    <tbody>${body}</tbody></table></div>`;
}

/* ---------- Heatmap ---------- */
function ambHeatmap(ctx){
  const toggle = hdSeg("ambSetHeatMode", ambHeatMode, [["site","Site × Periode"],["titik","Titik × Periode"]]);
  if(!ctx.periods.length || !ctx.numeric.length) return {toggle, html: hdEmpty("Tidak ada data terukur untuk heatmap.")};
  const keyFn = ambHeatMode==="titik" ? (r=>r.titik) : (r=>r.site);
  let keys = [...new Set(ctx.numeric.map(keyFn))];
  if(ambHeatMode==="titik"){
    const latest = {}; ctx.numeric.forEach(r=>{ const c = latest[r.titik]; if(!c || r.periodeOrder>c.periodeOrder) latest[r.titik] = r; });
    keys = Object.values(latest).sort((a,b)=>(b.pct||b.val||0)-(a.pct||a.val||0)).slice(0,15).map(r=>r.titik);
  } else keys.sort();
  const nums = ctx.numeric.map(r=>r.val), gMin = Math.min(...nums), gMax = Math.max(...nums);
  const cellOf = (k,p)=>{ const rs = ctx.numeric.filter(r=>keyFn(r)===k && r.periode===p); if(!rs.length) return null;
    const v = hdMean(rs.map(r=>r.val)), pcts = rs.map(r=>r.pct).filter(x=>x!=null), zps = rs.map(r=>r.zp).filter(x=>x!=null);
    return {v, pct: ctx.hasStd ? hdMean(pcts) : null, zp: ctx.hasStd ? hdMean(zps) : (gMax>gMin ? (v-gMin)/(gMax-gMin)*69 : 30)}; };
  const head = `<tr><th></th>${ctx.periods.map((p,i)=>`<th class="${i===ctx.periods.length-1?"strong":""}">${p}</th>`).join("")}<th>&Delta;</th></tr>`;
  const body = keys.map(k=>{
    const cells = ctx.periods.map(p=>cellOf(k,p)), vs = cells.filter(Boolean);
    const d = vs.length>=2 && vs[0].v>0 ? (vs[vs.length-1].v-vs[0].v)/vs[0].v*100 : null;
    const site = ambHeatMode==="titik" ? (ctx.numeric.find(r=>r.titik===k)||{}).site : k;
    return `<tr><th class="rowh"><span class="hd-site"><i style="background:${hdSiteColor(site)}"></i>${escHtml(hdTrunc(k,34))}</span></th>${cells.map((c,i)=>{
      if(!c) return `<td class="hd-hc empty">&ndash;</td>`;
      const [bg,fg] = hdHeatColor(c.zp);
      return `<td class="hd-hc" style="background:${bg};color:${fg}" title="${escHtml(k)} ${ctx.periods[i]}: ${hdNum(c.v)} ${escHtml(ctx.unit)}${ctx.hasStd?` (${hdPct(c.pct,0)})`:""}"><b>${hdNum(c.v)}</b>${ctx.hasStd?`<small>${hdPct(c.pct,0)}</small>`:""}</td>`;
    }).join("")}<td class="num"><span class="hd-delta ${d==null?"":d>0.05?"up":d<-0.05?"down":""}">${d==null?"-":hdSignedPct(d)}</span></td></tr>`;
  }).join("");
  const legend = ctx.hasStd ? `<div class="hd-heat-legend"><span>${ambPctLabel(ctx)}</span>${(ctx.cat==="kebisingan"?[["<75",10],["75–80",30],["80–85",45],["85–95",60],["95–100",80],[">100",120]]:[["<25",10],["25–40",30],["40–55",45],["55–70",60],["70–100",80],[">100",120]]).map(([l,p])=>{ const [bg,fg]=hdHeatColor(p); return `<i style="background:${bg};color:${fg}">${l}</i>`; }).join("")}<i class="empty">tanpa data</i></div>`
    : `<div class="hint">Tanpa baku mutu: warna menunjukkan posisi nilai antara terendah (${hdNum(gMin)}) dan tertinggi (${hdNum(gMax)}) ${escHtml(ctx.unit)}.</div>`;
  return {toggle, html:`<div class="tablewrap hd-table-wrap"><table class="hd-heat">${head}${body}</table></div>${legend}`};
}

/* ---------- Snapshot ---------- */
// Ambien/Kebauan: semua parameter × site (maks %BM periode terakhir). Kebisingan: titik × Ls/Lm/Lsm.
// Getaran: titik × pita frekuensi (status ISO tiap pita) pada pengukuran terakhir.
function ambSnapshot(ctx){
  if(!ctx.last) return {title:"Snapshot", sub:"", html: hdEmpty("Tidak ada data pada rentang ini.")};
  const site = ambDashFlt.site;
  if(ctx.multiParam){
    const rows = ctx.catRows.filter(r=>r.periode===ctx.last);
    const sites = [...new Set(rows.map(r=>r.site))].sort();
    const params = ctx.params;
    const head = `<tr><th>Parameter</th>${sites.map(s=>`<th><span class="hd-site"><i style="background:${hdSiteColor(s)}"></i>${escHtml(s)}</span></th>`).join("")}<th>Maks</th></tr>`;
    const body = params.map(p=>{
      const pr = rows.filter(r=>r.param===p);
      const maxAll = pr.filter(r=>r.pct!=null).sort((a,b)=>b.pct-a.pct)[0];
      return `<tr><th class="rowh"><button type="button" class="hd-link ${p===ambDashFlt.param?"on":""}" data-action="ambSetParam" data-val="${escHtml(p)}">${escHtml(p)}</button></th>${sites.map(s=>{
        const sr = pr.filter(r=>r.site===s && r.pct!=null).sort((a,b)=>b.pct-a.pct)[0];
        if(!sr) return `<td class="hd-hc empty">&ndash;</td>`;
        const [bg,fg] = hdHeatColor(sr.pct);
        return `<td class="hd-hc" style="background:${bg};color:${fg}" title="${escHtml(sr.titik)}: ${escHtml(sr.raw)} ${escHtml(sr.unit)} (${hdPct(sr.pct,0)} BM)"><b>${hdPct(sr.pct,0)}</b><small>${escHtml(sr.raw)}</small></td>`;
      }).join("")}<td class="num">${maxAll?`<b>${hdPct(maxAll.pct,0)}</b>`:"-"}</td></tr>`;
    }).join("");
    return {title:`Snapshot Semua Parameter &middot; ${ctx.last}`, sub:`Persentase baku mutu tertinggi tiap parameter di tiap site pada ${ctx.last}. Klik nama parameter untuk membuka trend-nya.`,
      html:`<div class="tablewrap hd-table-wrap"><table class="hd-heat amb-snap">${head}${body}</table></div>`};
  }
  if(ctx.cat==="kebisingan"){
    const recs = (DB.hasilAmbien.kebisingan||[]).filter(r=>r.periode===ctx.last && (!site||r.site===site)).sort((a,b)=>(b.lSiangMalam||0)-(a.lSiangMalam||0));
    const cell = (v,std)=>{ if(v==null) return `<td class="hd-hc empty">&ndash;</td>`; const p = std ? v/std*100 : null; const [bg,fg] = p!=null?hdHeatColor(ambZonePct("kebisingan", p)):["var(--gray-100)","var(--heading)"]; return `<td class="hd-hc" style="background:${bg};color:${fg}"><b>${hdNum(v,1)}</b>${p!=null?`<small>${hdPct(p,0)}</small>`:""}</td>`; };
    const body = recs.map(r=>`<tr><th class="rowh"><span class="hd-site"><i style="background:${hdSiteColor(r.site)}"></i>${escHtml(hdTrunc(r.titik,34))}</span></th>${cell(r.lSiang)}${cell(r.lMalam)}${cell(r.lSiangMalam, r.baku)}<td class="num">${r.baku!=null?hdNum(r.baku,0):"-"}</td><td>${r.statusBakuMutu==="exceed"?`<span class="badge b-red">Melebihi</span>`:r.statusBakuMutu==="ok"?`<span class="badge b-green">Memenuhi</span>`:"-"}</td></tr>`).join("");
    return {title:`Snapshot Kebisingan per Titik &middot; ${ctx.last}`, sub:"L Siang (06–22), L Malam (22–06) dan L Siang-Malam (Lsm) tiap titik. Warna Lsm menunjukkan % baku mutu peruntukan titik tersebut.",
      html:`<div class="tablewrap hd-table-wrap"><table class="hd-heat amb-snap"><tr><th>Titik</th><th>L Siang</th><th>L Malam</th><th>Lsm</th><th>Baku mutu</th><th>Status</th></tr>${body}</table></div>`};
  }
  const recs = (DB.hasilAmbien.getaran||[]).filter(r=>r.periode===ctx.last && (!site||r.site===site));
  const freqs = [...new Set(recs.flatMap(r=>(r.bands||[]).map(b=>b.freq)))].sort((a,b)=>a-b);
  const colorOf = st=> (AMB_VIB_STATUS.find(x=>x[0]===st)||[0,"#e5e7eb"])[1];
  const body = recs.map(r=>`<tr><th class="rowh"><span class="hd-site"><i style="background:${hdSiteColor(r.site)}"></i>${escHtml(hdTrunc(r.titik,34))}</span></th>${freqs.map(f=>{
    const b = (r.bands||[]).find(x=>x.freq===f); if(!b) return `<td class="hd-hc empty">&ndash;</td>`;
    const c = colorOf(b.status);
    return `<td class="hd-hc" style="background:color-mix(in srgb, ${c} ${b.status==="Not Disturb"?22:70}%, var(--surface-card));color:${b.status==="Not Disturb"?"var(--heading)":"#fff"}" title="${f} Hz: ${hdNum(b.nilai)} micron · ${escHtml(b.status)} (ND ${escHtml(b.notDisturb||"")})"><b>${hdNum(b.nilai)}</b></td>`;
  }).join("")}<td>${`<span class="badge ${r.statusKeseluruhan==="Not Disturb"?"b-green":r.statusKeseluruhan==="Disturb"?"b-amber":"b-red"}">${escHtml(r.statusKeseluruhan||"-")}</span>`}</td></tr>`).join("");
  return {title:`Snapshot Getaran per Pita Frekuensi &middot; ${ctx.last}`, sub:"Nilai getaran (micron) tiap pita 4–63 Hz pada pengukuran periode terakhir. Warna mengikuti status ISO 2631-2 pita tersebut.",
    html:`<div class="tablewrap hd-table-wrap"><table class="hd-heat amb-snap"><tr><th>Titik</th>${freqs.map(f=>`<th>${f} Hz</th>`).join("")}<th>Status</th></tr>${body}</table></div>
    <div class="hd-heat-legend"><span>Status</span>${AMB_VIB_STATUS.map(([l,c])=>`<i style="background:${c};color:#fff">${l}</i>`).join("")}</div>`};
}

/* ---------- Profil (kebisingan 24 jam / getaran spektrum + status per site) ---------- */
function ambProfile(ctx){
  if(ctx.cat!=="kebisingan" && ctx.cat!=="getaran") return "";
  const recs = (DB.hasilAmbien[ctx.cat]||[]).filter(r=>(!ambDashFlt.site||r.site===ambDashFlt.site) && ctx.periods.includes(r.periode)).sort((a,b)=>b.periodeOrder-a.periodeOrder || a.titik.localeCompare(b.titik));
  if(!ambDashProfileKey || !recs.some(r=>r.id===ambDashProfileKey)) ambDashProfileKey = recs[0] ? recs[0].id : "";
  const rec = recs.find(r=>r.id===ambDashProfileKey);
  const sel = `<div class="field amb-profile-sel"><label>Titik &amp; tanggal pengukuran</label><select id="ambDashProfileSel">${recs.map(r=>`<option value="${r.id}" ${r.id===ambDashProfileKey?"selected":""}>${escHtml(r.titik)} — ${r.tanggal} (${r.periode})</option>`).join("")}</select></div>`;
  if(ctx.cat==="kebisingan"){
    const sum = rec ? `<div class="amb-profile-stats">${[["L Siang",rec.lSiang],["L Malam",rec.lMalam],["Lsm",rec.lSiangMalam],["Baku mutu",rec.baku]].map(([l,v])=>`<div><span>${l}</span><b>${v!=null?hdNum(v,1):"-"}</b><small>dB(A)</small></div>`).join("")}</div>` : "";
    return `<div class="card"><div class="cardhead"><div><h3>Profil Pengukuran 24 Jam</h3><div class="hint hd-sub">24 pembacaan per jam (L1–L24) pada satu titik dan tanggal, metode SNI 8427-2017. Garis merah putus-putus adalah baku mutu L Siang-Malam.</div></div>
      <button class="btn small ghost" data-action="hdZoomChart" data-target="ambProfileWrap" data-title="Profil Pengukuran 24 Jam">Perbesar</button></div>
      ${sel}<div id="ambProfileWrap">${sum}${ambBuildHourlyProfile(rec)}</div></div>`;
  }
  const bySite = {};
  ctx.lastRows.forEach(r=>{ const o = bySite[r.site] = bySite[r.site]||{}; o[r.vibStatus] = (o[r.vibStatus]||0)+1; });
  const sitesHtml = Object.keys(bySite).sort().map(s=>{
    const o = bySite[s], tot = Object.values(o).reduce((a,b)=>a+b,0);
    return `<div class="amb-vib-site"><span class="hd-site"><i style="background:${hdSiteColor(s)}"></i>${escHtml(s)}</span><div class="hd-stack">${AMB_VIB_STATUS.filter(([l])=>o[l]).map(([l,c])=>`<i style="width:${(o[l]/tot*100).toFixed(1)}%;background:${c}" title="${l}: ${o[l]}"></i>`).join("")}</div><small>${o["Not Disturb"]||0}/${tot} ND</small></div>`;
  }).join("");
  return `<div class="hd-row">
    <div class="card hd-col-wide"><div class="cardhead"><div><h3>Profil Spektrum Getaran</h3><div class="hint hd-sub">Nilai getaran tiap pita 4–63 Hz untuk satu titik dan tanggal. Warna batang mengikuti status ISO 2631-2 pita tersebut.</div></div>
      <button class="btn small ghost" data-action="hdZoomChart" data-target="ambProfileWrap" data-title="Profil Spektrum Getaran">Perbesar</button></div>
      ${sel}<div id="ambProfileWrap">${ambBuildVibSpectrum(rec)}</div></div>
    <div class="card hd-col-side"><div class="cardhead"><div><h3>Status per Site</h3><div class="hint hd-sub">Komposisi status getaran tiap site pada ${ctx.last||"-"}.</div></div></div>
      ${sitesHtml || hdEmpty("Tidak ada data.")}
      <div class="legend" style="margin-top:10px;">${AMB_VIB_STATUS.map(([l,c])=>`<span class="item"><span class="sw" style="background:${c}"></span>${l}</span>`).join("")}</div></div>
  </div>`;
}

/* ---------- Render utama ---------- */
function renderAmbienDashboard(){
  ambRenderHero();
  const ctx = ambBuildCtx();
  const body = document.getElementById("ambDashBody");
  if(!(DB.hasilAmbien[ctx.cat]||[]).length){ body.innerHTML = ambFilterBar(ctx) + hdEmpty(`Belum ada data ${escHtml(AMB_KATEGORI_LABEL[ctx.cat])}. Tambahkan lewat menu Database Hasil Ambient.`); return; }
  const tr = ambTrend(ctx), hm = ambHeatmap(ctx), snap = ambSnapshot(ctx);
  const detail = ctx.rows.slice().sort((a,b)=>b.periodeOrder-a.periodeOrder).map(r=>r.rec);
  const detailRecs = [...new Map(detail.map(r=>[r.id,r])).values()].slice(0,200);
  body.innerHTML = `
    ${ambFilterBar(ctx)}
    <div id="ambSecOverview" class="hd-anchor"></div>
    ${ambInsight(ctx)}
    <div class="hd-kpis">${ambKpis(ctx)}</div>

    <div id="ambSecTrend" class="hd-anchor"></div>
    <div class="hd-row">
      <div class="card hd-col-wide">
        <div class="cardhead"><div><h3>Trend ${escHtml(ctx.paramLabel)} per Periode <span class="muted" style="text-transform:none;font-weight:400;">${ctx.unit&&ctx.cat!=="getaran"?`(${escHtml(ctx.unit)})`:""}</span></h3>
          <div class="hint hd-sub">Naik turunnya hasil dari periode ke periode, dibandingkan garis ${ambStdWord(ctx)} dan zona Early Warning (&ge;70%).</div></div>
          <button class="btn small ghost" data-action="hdZoomChart" data-target="ambTrendWrap" data-title="Trend ${escHtml(ctx.paramLabel)}">Perbesar</button></div>
        <div class="hd-seg">${tr.toggle}</div>
        <div id="ambTrendWrap">${tr.svg}<div class="legend">${tr.legend}</div></div>
      </div>
      <div class="card hd-col-side">
        <div class="cardhead"><div><h3>${ctx.cat==="getaran"?"Distribusi Status ISO 2631-2":`Distribution terhadap ${ctx.cat==="getaran"?"Batas":"Baku Mutu"}`}</h3>
          <div class="hint hd-sub">Sebaran data periode terakhir.</div></div></div>
        <div id="ambDistWrap">${ambDistribution(ctx)}</div>
      </div>
    </div>

    <div id="ambSecWatch" class="hd-anchor"></div>
    <div class="card">
      <div class="cardhead"><div><h3>Priority Watchlist</h3><div class="hint hd-sub">10 titik dengan ${ctx.hasStd?ambPctLabel(ctx):"nilai"} tertinggi pada ${ctx.last||"-"}, dibandingkan periode sebelumnya di titik yang sama. Penanda putih pada batang = ambang Early Warning 70%.</div></div>
        <button class="btn small ghost" data-action="hdZoomChart" data-target="ambWatchWrap" data-title="Priority Watchlist">Perbesar</button></div>
      <div id="ambWatchWrap">${ambWatchlist(ctx)}</div>
    </div>
    <div class="card">
      <div class="cardhead"><div><h3>Heatmap ${ambHeatMode==="titik"?"Titik":"Site"} × Periode</h3><div class="hint hd-sub">Rata-rata ${escHtml(ctx.paramLabel)}${ctx.hasStd?`, warna menunjukkan ${ambPctLabel(ctx)}`:""}. &Delta; = perubahan periode pertama ke terakhir.</div></div>
        <button class="btn small ghost" data-action="hdZoomChart" data-target="ambHeatWrap" data-title="Heatmap">Perbesar</button></div>
      <div class="hd-seg">${hm.toggle}</div>
      <div id="ambHeatWrap">${hm.html}</div>
    </div>

    <div id="ambSecSnap" class="hd-anchor"></div>
    <div class="card">
      <div class="cardhead"><div><h3>${snap.title}</h3><div class="hint hd-sub">${snap.sub}</div></div>
        <button class="btn small ghost" data-action="hdZoomChart" data-target="ambSnapWrap" data-title="Snapshot">Perbesar</button></div>
      <div id="ambSnapWrap">${snap.html}</div>
    </div>

    <div id="ambSecProfile" class="hd-anchor"></div>
    ${ambProfile(ctx)}

    <div id="ambSecData" class="hd-anchor"></div>
    <div class="card">
      <div class="cardhead"><div><h3>Detail Data Terfilter</h3><div class="hint hd-sub">Menampilkan ${detailRecs.length} dari ${detail.length} baris ${escHtml(ctx.paramLabel)}, urut periode terbaru.</div></div>
        <button class="btn small ghost" data-action="exportAmbienXlsx">Export Excel</button></div>
      <div class="tablewrap"><table>${ambDbBuildTable(ctx.cat, detailRecs)}</table></div>
    </div>`;
}
["ambDashFltSite","ambDashFltFrom","ambDashFltTo"].forEach(id=>{
  document.addEventListener("change", e=>{
    if(e.target.id!==id) return;
    if(id==="ambDashFltSite") ambDashFlt.site = e.target.value;
    if(id==="ambDashFltFrom") ambDashFlt.from = e.target.value;
    if(id==="ambDashFltTo") ambDashFlt.to = e.target.value;
    renderAmbienDashboard();
  });
});
document.addEventListener("change", e=>{
  if(e.target.id==="ambDashProfileSel"){ ambDashProfileKey = e.target.value; renderAmbienDashboard(); }
});

Object.assign(ACTIONS, {
  importAmbienXlsx:()=>importHasilAnyXlsx(), exportAmbienXlsx:()=>exportAmbienXlsx(), downloadTemplateAmbien:()=>downloadTemplateAmbien(), resetAmbienData,
  ambDbSetCat:(t)=>{ ambDbCat = t.dataset.cat; renderAmbienDb(); },
  ambDashSetCat:(t)=>{ ambDashCat = t.dataset.cat; ambDashFlt = {site:ambDashFlt.site,from:"",to:"",param:""}; ambDashProfileKey=""; renderAmbienDashboard(); },
  ambSetParam:(t)=>{ ambDashFlt.param = t.dataset.val; renderAmbienDashboard(); },
  ambSetTrendMode:(t)=>{ ambTrendMode = t.dataset.val; renderAmbienDashboard(); },
  ambSetHeatMode:(t)=>{ ambHeatMode = t.dataset.val; renderAmbienDashboard(); },
  ambDashReset:()=>{ ambDashFlt = {site:"",from:"",to:"",param:""}; ambTrendMode = "site"; ambHeatMode = "site"; ambDashProfileKey=""; renderAmbienDashboard(); },
  addAmbRecordBtn:(t)=>addAmbRecord(t.dataset.cat),
  editAmbRecord:(t)=>editAmbRecord(t.dataset.cat, t.dataset.id),
  deleteAmbRecord:(t)=>deleteAmbRecord(t.dataset.cat, t.dataset.id),
  saveAmbParam:(t)=>saveAmbParam(t.dataset.cat, t.dataset.id),
  saveKebisingan:(t)=>saveKebisingan(t.dataset.id),
  saveGetaran:(t)=>saveGetaran(t.dataset.id)
});
