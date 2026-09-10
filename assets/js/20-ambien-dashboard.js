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
  let paths = "";
  if(segments.length===1){
    const rMid=(r+rInner)/2, strokeW=r-rInner;
    paths = `<circle cx="${cx}" cy="${cy}" r="${rMid}" fill="none" stroke="${segments[0][2]}" stroke-width="${strokeW}"/>`;
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
      paths += `<path d="M${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2} L${xi2},${yi2} A${rInner},${rInner} 0 ${large} 0 ${xi1},${yi1} Z" fill="${color}"/>`;
      angle = endAngle;
    });
  }
  const svg = `<svg viewBox="0 0 220 220" style="width:220px;height:220px;display:block;margin:0 auto;">
    ${paths}
    <text x="110" y="104" text-anchor="middle" font-size="24" font-weight="800" fill="var(--navy-900)">${centerVal}</text>
    <text x="110" y="124" text-anchor="middle" font-size="11" fill="var(--gray-500)">${escHtml(centerLabel)}</text>
  </svg>`;
  const legend = segments.map(([label,val,color])=>`<span class="item"><span class="sw" style="background:${color}"></span>${escHtml(label)}: ${val}</span>`).join("");
  return {svg, legend};
}
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
  const W=760,H=260,padL=44,padR=16,padT=16,padB=34;
  const plotW=W-padL-padR, plotH=H-padT-padB;
  const vals = record.hourly.map(h=>h.nilai);
  const maxY = Math.max(...vals, record.baku||0)*1.1;
  const minY = Math.min(0, Math.min(...vals)*0.9);
  const n = record.hourly.length;
  function xFor(i){ return padL+(n<=1?plotW/2:(i/(n-1))*plotW); }
  function yFor(v){ return padT+plotH-((v-minY)/(maxY-minY))*plotH; }
  let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;font-size:10.5px;background:var(--surface-card);border:1px solid var(--gray-200);border-radius:10px;">`;
  for(let g=0; g<=4; g++){
    const y = padT+plotH-(g/4)*plotH;
    svg += `<line x1="${padL}" y1="${y}" x2="${W-padR}" y2="${y}" stroke="var(--gray-200)"/>`;
    svg += `<text x="2" y="${y+4}" fill="var(--gray-500)">${Math.round(minY+(maxY-minY)*g/4)}</text>`;
  }
  record.hourly.forEach((h,i)=>{ if(i%2===0) svg += `<text x="${xFor(i)}" y="${H-10}" text-anchor="middle" fill="var(--gray-500)">${h.jam}</text>`; });
  let pathD=""; record.hourly.forEach((h,i)=>{ pathD += (i?" L":"M")+xFor(i)+","+yFor(h.nilai); });
  svg += `<path d="${pathD}" fill="none" stroke="#0ea5a0" stroke-width="2.5"/>`;
  record.hourly.forEach((h,i)=> svg += `<circle cx="${xFor(i)}" cy="${yFor(h.nilai)}" r="3" fill="#0ea5a0"/>`);
  if(record.baku!=null){
    const yb = yFor(record.baku);
    svg += `<line x1="${padL}" y1="${yb}" x2="${W-padR}" y2="${yb}" stroke="#e0554f" stroke-width="1.3" stroke-dasharray="5,4"/>`;
    svg += `<text x="${W-padR}" y="${yb-4}" text-anchor="end" fill="#e0554f" font-weight="700">Baku Mutu L Siang-Malam: ${record.baku}</text>`;
  }
  svg += `</svg>`;
  return svg;
}
function ambBuildVibSpectrum(record){
  if(!record) return "<div class='hint' style='padding:14px;'>Tidak ada data profil spektrum untuk dipilih.</div>";
  const W=760,H=280,padL=50,padR=16,padT=16,padB=46;
  const plotW=W-padL-padR, plotH=H-padT-padB;
  const bands = record.bands;
  const n = bands.length;
  const notDisturbVals = bands.map(b=>{ const m=(b.notDisturb||"").match(/[\d.]+/); return m?parseFloat(m[0]):0; });
  const maxY = Math.max(...bands.map(b=>b.nilai), ...notDisturbVals)*1.15 || 1;
  const bw = plotW/n;
  const colorFor = s=> s==="Not Disturb"?"#3fb27f" : s==="Disturb"?"#e8a33d" : "#e0554f";
  let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;font-size:10.5px;background:var(--surface-card);border:1px solid var(--gray-200);border-radius:10px;">`;
  for(let g=0; g<=4; g++){
    const y = padT+plotH-(g/4)*plotH;
    svg += `<line x1="${padL}" y1="${y}" x2="${W-padR}" y2="${y}" stroke="var(--gray-200)"/>`;
    svg += `<text x="2" y="${y+4}" fill="var(--gray-500)">${Math.round(maxY*g/4)}</text>`;
  }
  bands.forEach((b,i)=>{
    const x = padL+i*bw, barH = (b.nilai/maxY)*plotH, y = padT+plotH-barH;
    svg += `<rect x="${x+bw*0.18}" y="${y}" width="${bw*0.64}" height="${Math.max(1,barH)}" rx="3" fill="${colorFor(b.status)}"/>`;
    svg += `<text x="${x+bw/2}" y="${padT+plotH+16}" text-anchor="middle" fill="var(--gray-500)">${b.freq}</text>`;
  });
  svg += `<text x="${padL+plotW/2}" y="${H-6}" text-anchor="middle" fill="var(--gray-600)" font-size="11">Frekuensi (Hz)</text>`;
  svg += `</svg>`;
  return svg;
}

/* ---------- Tab: Udara Ambien & Kebauan (bentuk data & logika identik) ---------- */
function ambRenderParamTab(cat){
  const all = DB.hasilAmbien[cat];
  const sites = [...new Set(all.map(r=>r.site))].sort();
  const params = [...new Set(all.map(r=>r.parameter))].sort();
  const periods = [...new Set(all.map(r=>r.periode))].sort((a,b)=>hasilPeriodParts(a).order-hasilPeriodParts(b).order);
  if(!ambDashFlt.param && params.length) ambDashFlt.param = params[0];

  const fromOrder = ambDashFlt.from ? hasilPeriodParts(ambDashFlt.from).order : -Infinity;
  const toOrder = ambDashFlt.to ? hasilPeriodParts(ambDashFlt.to).order : Infinity;
  const filtered = all.filter(r=>{
    if(ambDashFlt.site && r.site!==ambDashFlt.site) return false;
    return r.periodeOrder>=fromOrder && r.periodeOrder<=toOrder;
  });
  const filteredParam = filtered.filter(r=>r.parameter===ambDashFlt.param);

  const withStd = filtered.filter(r=>r.statusBakuMutu==="ok"||r.statusBakuMutu==="exceed");
  const okN = filtered.filter(r=>r.statusBakuMutu==="ok").length;
  const exceedN = filtered.filter(r=>r.statusBakuMutu==="exceed").length;
  const compliance = withStd.length ? Math.round(okN/withStd.length*1000)/10 : null;

  const periodsInScope = [...new Set(filteredParam.map(r=>r.periode))].sort((a,b)=>hasilPeriodParts(a).order-hasilPeriodParts(b).order);
  const sitesInScope = ambDashFlt.site ? [ambDashFlt.site] : [...new Set(filteredParam.map(r=>r.site))].sort();
  const seriesArr = sitesInScope.map((s,i)=>({
    label:s, color: HASIL_SITE_COLORS[s]||HD_PALETTE[i%HD_PALETTE.length],
    values: periodsInScope.map(p=>{
      const recs = filteredParam.filter(r=>r.site===s && r.periode===p && r.resultNumeric!=null);
      if(!recs.length) return null;
      return Math.round(recs.reduce((a,b)=>a+b.resultNumeric,0)/recs.length*100)/100;
    })
  }));
  const stdVals = filteredParam.map(r=>r.baku).filter(v=>v!=null);
  const standardRef = stdVals.length ? stdVals[0] : null;

  const donutSeg = [["Memenuhi Baku Mutu",okN,"#3fb27f"],["Melebihi Baku Mutu",exceedN,"#e0554f"]].filter(s=>s[1]>0);
  const donut = ambBuildDonut(donutSeg, withStd.length?Math.round(okN/withStd.length*100)+"%":"-", "memenuhi");

  const lastPeriod = periodsInScope[periodsInScope.length-1];
  const rankRows = filteredParam.filter(r=>r.periode===lastPeriod && r.pctOfBaku!=null)
    .sort((a,b)=>b.pctOfBaku-a.pctOfBaku).slice(0,15).map(r=>({titik:r.titik, pctOfBaku:r.pctOfBaku}));

  const bySite = {};
  filteredParam.filter(r=>r.pctOfBaku!=null).forEach(r=>{ (bySite[r.site]=bySite[r.site]||[]).push(r.pctOfBaku); });
  const siteRows = Object.keys(bySite).map(s=>({site:s, avgPct: Math.round(bySite[s].reduce((a,b)=>a+b,0)/bySite[s].length*10)/10})).sort((a,b)=>b.avgPct-a.avgPct);

  const detail = filteredParam.slice().sort((a,b)=>b.periodeOrder-a.periodeOrder).slice(0,200);
  const unitLabel = filteredParam[0] ? filteredParam[0].unit : (cat==="ambien"?"µg/Nm³":"ppm");

  document.getElementById("ambDashBody").innerHTML = `
    <div class="toolbar card" style="padding:12px 14px;">
      <div class="field"><label>Site</label><select id="ambDashFltSite"><option value="">Semua</option>${sites.map(s=>`<option value="${s}" ${ambDashFlt.site===s?"selected":""}>${s}</option>`).join("")}</select></div>
      <div class="field"><label>Parameter</label><select id="ambDashFltParam">${params.map(p=>`<option value="${escHtml(p)}" ${ambDashFlt.param===p?"selected":""}>${escHtml(p)}</option>`).join("")}</select></div>
      <div class="field"><label>Dari Periode</label><select id="ambDashFltFrom"><option value="">Awal</option>${periods.map(p=>`<option value="${p}" ${ambDashFlt.from===p?"selected":""}>${p}</option>`).join("")}</select></div>
      <div class="field"><label>Sampai Periode</label><select id="ambDashFltTo"><option value="">Akhir</option>${periods.map(p=>`<option value="${p}" ${ambDashFlt.to===p?"selected":""}>${p}</option>`).join("")}</select></div>
    </div>
    <div class="grid cols-4" style="margin-bottom:16px;">
      <div class="stat"><div class="num">${filtered.length}</div><div class="lbl">Total Data Terfilter</div></div>
      <div class="stat"><div class="num">${sitesInScope.length}</div><div class="lbl">Site Tercakup</div></div>
      <div class="stat ${compliance==null?'':(compliance>=95?'good':compliance>=80?'warn':'bad')}"><div class="num">${compliance!=null?compliance+"%":"-"}</div><div class="lbl">Tingkat Kepatuhan Baku Mutu</div></div>
      <div class="stat ${exceedN>0?'bad':'good'}"><div class="num">${exceedN}</div><div class="lbl">Melebihi Baku Mutu</div></div>
    </div>
    <div class="grid cols-2">
      <div class="card"><h3>Tren Hasil per Periode <span class="muted" style="text-transform:none;font-weight:400;">— ${escHtml(ambDashFlt.param)} (${unitLabel})</span></h3>
        <div class="hint" style="margin-top:-6px;margin-bottom:8px;">Rata rata hasil pengukuran per site pada tiap periode, dibandingkan garis putus putus baku mutu.</div>
        ${ambBuildTrendChart(periodsInScope, seriesArr, {standardRef})}
        <div class="legend">${ambBuildTrendLegend(seriesArr)}</div>
      </div>
      <div class="card"><h3>Kepatuhan Baku Mutu</h3>
        <div class="hint" style="margin-top:-6px;margin-bottom:8px;">Proporsi data pada filter aktif yang memenuhi dibandingkan yang melebihi baku mutu, dihitung dari data yang memiliki nilai baku mutu.</div>
        <div>${donut.svg}</div><div class="legend">${donut.legend}</div>
      </div>
    </div>
    <div class="grid cols-2">
      <div class="card"><h3>Peringkat Titik Terhadap Baku Mutu <span class="muted" style="text-transform:none;font-weight:400;">(periode terakhir: ${lastPeriod||"-"})</span></h3>
        ${ambBuildRankChart(rankRows, "pctOfBaku", "titik", 100, "%")}
      </div>
      <div class="card"><h3>Perbandingan Rata Rata per Site <span class="muted" style="text-transform:none;font-weight:400;">(% baku mutu)</span></h3>
        ${ambBuildRankChart(siteRows, "avgPct", "site", 100, "%")}
      </div>
    </div>
    <div class="card"><h3>Rincian Data Terfilter</h3>
      <div class="tablewrap"><table>${ambDbBuildTable(cat, detail)}</table></div>
      <div class="hint">Menampilkan ${detail.length} dari ${filteredParam.length} baris data untuk parameter ${escHtml(ambDashFlt.param)} (urut periode terbaru).</div>
    </div>
  `;
}

/* ---------- Tab: Kebisingan ---------- */
function ambRenderKebisinganTab(){
  const all = DB.hasilAmbien.kebisingan;
  const sites = [...new Set(all.map(r=>r.site))].sort();
  const periods = [...new Set(all.map(r=>r.periode))].sort((a,b)=>hasilPeriodParts(a).order-hasilPeriodParts(b).order);
  const fromOrder = ambDashFlt.from ? hasilPeriodParts(ambDashFlt.from).order : -Infinity;
  const toOrder = ambDashFlt.to ? hasilPeriodParts(ambDashFlt.to).order : Infinity;
  const filtered = all.filter(r=>{
    if(ambDashFlt.site && r.site!==ambDashFlt.site) return false;
    return r.periodeOrder>=fromOrder && r.periodeOrder<=toOrder;
  });
  const withStd = filtered.filter(r=>r.statusBakuMutu==="ok"||r.statusBakuMutu==="exceed");
  const okN = filtered.filter(r=>r.statusBakuMutu==="ok").length;
  const exceedN = filtered.filter(r=>r.statusBakuMutu==="exceed").length;
  const compliance = withStd.length ? Math.round(okN/withStd.length*1000)/10 : null;
  const avgLsm = filtered.length ? Math.round(filtered.reduce((a,b)=>a+(b.lSiangMalam||0),0)/filtered.length*10)/10 : null;

  const periodsInScope = [...new Set(filtered.map(r=>r.periode))].sort((a,b)=>hasilPeriodParts(a).order-hasilPeriodParts(b).order);
  const sitesInScope = ambDashFlt.site ? [ambDashFlt.site] : sites;
  const seriesArr = sitesInScope.map((s,i)=>({
    label:s, color: HASIL_SITE_COLORS[s]||HD_PALETTE[i%HD_PALETTE.length],
    values: periodsInScope.map(p=>{
      const recs = filtered.filter(r=>r.site===s && r.periode===p);
      if(!recs.length) return null;
      return Math.round(recs.reduce((a,b)=>a+b.lSiangMalam,0)/recs.length*10)/10;
    })
  }));
  const stdVals = filtered.map(r=>r.baku).filter(v=>v!=null);
  const standardRef = stdVals.length ? stdVals[0] : null;

  const donutSeg = [["Memenuhi Baku Mutu",okN,"#3fb27f"],["Melebihi Baku Mutu",exceedN,"#e0554f"]].filter(s=>s[1]>0);
  const donut = ambBuildDonut(donutSeg, withStd.length?Math.round(okN/withStd.length*100)+"%":"-", "memenuhi");

  const lastPeriod = periodsInScope[periodsInScope.length-1];
  const rankRows = filtered.filter(r=>r.periode===lastPeriod).map(r=>({titik:r.titik, lSiangMalam:r.lSiangMalam})).sort((a,b)=>b.lSiangMalam-a.lSiangMalam).slice(0,15);

  const profileOptions = filtered.slice().sort((a,b)=>b.periodeOrder-a.periodeOrder);
  if(!ambDashProfileKey || !profileOptions.some(r=>r.id===ambDashProfileKey)) ambDashProfileKey = profileOptions[0] ? profileOptions[0].id : "";
  const profileRec = profileOptions.find(r=>r.id===ambDashProfileKey);

  const detail = filtered.slice().sort((a,b)=>b.periodeOrder-a.periodeOrder).slice(0,200);

  document.getElementById("ambDashBody").innerHTML = `
    <div class="toolbar card" style="padding:12px 14px;">
      <div class="field"><label>Site</label><select id="ambDashFltSite"><option value="">Semua</option>${sites.map(s=>`<option value="${s}" ${ambDashFlt.site===s?"selected":""}>${s}</option>`).join("")}</select></div>
      <div class="field"><label>Dari Periode</label><select id="ambDashFltFrom"><option value="">Awal</option>${periods.map(p=>`<option value="${p}" ${ambDashFlt.from===p?"selected":""}>${p}</option>`).join("")}</select></div>
      <div class="field"><label>Sampai Periode</label><select id="ambDashFltTo"><option value="">Akhir</option>${periods.map(p=>`<option value="${p}" ${ambDashFlt.to===p?"selected":""}>${p}</option>`).join("")}</select></div>
    </div>
    <div class="grid cols-4" style="margin-bottom:16px;">
      <div class="stat"><div class="num">${filtered.length}</div><div class="lbl">Total Data Terfilter</div></div>
      <div class="stat"><div class="num">${avgLsm!=null?avgLsm:"-"}</div><div class="lbl">Rata Rata L Siang-Malam (dB(A))</div></div>
      <div class="stat ${compliance==null?'':(compliance>=95?'good':compliance>=80?'warn':'bad')}"><div class="num">${compliance!=null?compliance+"%":"-"}</div><div class="lbl">Tingkat Kepatuhan Baku Mutu</div></div>
      <div class="stat ${exceedN>0?'bad':'good'}"><div class="num">${exceedN}</div><div class="lbl">Melebihi Baku Mutu</div></div>
    </div>
    <div class="grid cols-2">
      <div class="card"><h3>Tren L Siang-Malam per Periode</h3>
        <div class="hint" style="margin-top:-6px;margin-bottom:8px;">Rata rata nilai L Siang-Malam (Lsm) per site pada tiap periode, dibandingkan garis putus putus baku mutu kebisingan lingkungan (Kepmen LH 48/1996).</div>
        ${ambBuildTrendChart(periodsInScope, seriesArr, {standardRef})}
        <div class="legend">${ambBuildTrendLegend(seriesArr)}</div>
      </div>
      <div class="card"><h3>Kepatuhan Baku Mutu</h3>
        <div>${donut.svg}</div><div class="legend">${donut.legend}</div>
      </div>
    </div>
    <div class="card"><h3>Peringkat Titik Berdasarkan L Siang-Malam <span class="muted" style="text-transform:none;font-weight:400;">(periode terakhir: ${lastPeriod||"-"})</span></h3>
      ${ambBuildRankChart(rankRows, "lSiangMalam", "titik", standardRef, " dB(A)")}
    </div>
    <div class="card">
      <h3>Profil Pengukuran 24 Jam</h3>
      <div class="hint" style="margin-top:-6px;margin-bottom:8px;">Menampilkan 24 pembacaan per jam (L1&ndash;L24) hasil pengukuran kebisingan pada satu titik &amp; tanggal terpilih, sesuai metode SNI 8427-2017.</div>
      <div class="field" style="max-width:460px;margin-bottom:10px;"><label>Titik &amp; Tanggal Pengukuran</label>
        <select id="ambDashProfileSel">${profileOptions.map(r=>`<option value="${r.id}" ${r.id===ambDashProfileKey?"selected":""}>${escHtml(r.titik)} — ${r.tanggal} (${r.periode})</option>`).join("")}</select>
      </div>
      ${ambBuildHourlyProfile(profileRec)}
    </div>
    <div class="card"><h3>Rincian Data Terfilter</h3>
      <div class="tablewrap"><table>${ambDbBuildTable("kebisingan", detail)}</table></div>
      <div class="hint">Menampilkan ${detail.length} dari ${filtered.length} baris data (urut periode terbaru).</div>
    </div>
  `;
}

/* ---------- Tab: Getaran ---------- */
function ambRenderGetaranTab(){
  const all = DB.hasilAmbien.getaran;
  const sites = [...new Set(all.map(r=>r.site))].sort();
  const periods = [...new Set(all.map(r=>r.periode))].sort((a,b)=>hasilPeriodParts(a).order-hasilPeriodParts(b).order);
  const fromOrder = ambDashFlt.from ? hasilPeriodParts(ambDashFlt.from).order : -Infinity;
  const toOrder = ambDashFlt.to ? hasilPeriodParts(ambDashFlt.to).order : Infinity;
  const filtered = all.filter(r=>{
    if(ambDashFlt.site && r.site!==ambDashFlt.site) return false;
    return r.periodeOrder>=fromOrder && r.periodeOrder<=toOrder;
  });
  const counts = {"Not Disturb":0,"Disturb":0,"Uncomfortable":0,"Painful":0};
  filtered.forEach(r=>{ counts[r.statusKeseluruhan] = (counts[r.statusKeseluruhan]||0)+1; });
  const donutSeg = [["Not Disturb",counts["Not Disturb"],"#3fb27f"],["Disturb",counts["Disturb"],"#e8a33d"],["Uncomfortable",counts["Uncomfortable"],"#e0554f"],["Painful",counts["Painful"],"#a02a24"]].filter(s=>s[1]>0);
  const pctOk = filtered.length ? Math.round(counts["Not Disturb"]/filtered.length*100) : null;
  const donut = ambBuildDonut(donutSeg, pctOk!=null?pctOk+"%":"-", "Not Disturb");
  const disturbN = filtered.length - counts["Not Disturb"];

  const profileOptions = filtered.slice().sort((a,b)=>b.periodeOrder-a.periodeOrder);
  if(!ambDashProfileKey || !profileOptions.some(r=>r.id===ambDashProfileKey)) ambDashProfileKey = profileOptions[0] ? profileOptions[0].id : "";
  const profileRec = profileOptions.find(r=>r.id===ambDashProfileKey);

  const detail = filtered.slice().sort((a,b)=>b.periodeOrder-a.periodeOrder).slice(0,200);

  document.getElementById("ambDashBody").innerHTML = `
    <div class="toolbar card" style="padding:12px 14px;">
      <div class="field"><label>Site</label><select id="ambDashFltSite"><option value="">Semua</option>${sites.map(s=>`<option value="${s}" ${ambDashFlt.site===s?"selected":""}>${s}</option>`).join("")}</select></div>
      <div class="field"><label>Dari Periode</label><select id="ambDashFltFrom"><option value="">Awal</option>${periods.map(p=>`<option value="${p}" ${ambDashFlt.from===p?"selected":""}>${p}</option>`).join("")}</select></div>
      <div class="field"><label>Sampai Periode</label><select id="ambDashFltTo"><option value="">Akhir</option>${periods.map(p=>`<option value="${p}" ${ambDashFlt.to===p?"selected":""}>${p}</option>`).join("")}</select></div>
    </div>
    <div class="grid cols-4" style="margin-bottom:16px;">
      <div class="stat"><div class="num">${filtered.length}</div><div class="lbl">Total Data Terfilter</div></div>
      <div class="stat"><div class="num">${sites.length}</div><div class="lbl">Site Tercakup</div></div>
      <div class="stat ${pctOk==null?'':(pctOk>=95?'good':pctOk>=80?'warn':'bad')}"><div class="num">${pctOk!=null?pctOk+"%":"-"}</div><div class="lbl">Proporsi "Not Disturb"</div></div>
      <div class="stat ${disturbN>0?'bad':'good'}"><div class="num">${disturbN}</div><div class="lbl">Terindikasi Disturb / Uncomfortable</div></div>
    </div>
    <div class="grid cols-2">
      <div class="card"><h3>Distribusi Status Getaran</h3>
        <div class="hint" style="margin-top:-6px;margin-bottom:8px;">Klasifikasi kenyamanan berdasarkan ISO 2631-2:2003, dievaluasi per pita frekuensi lalu diambil status terburuk pada tiap titik &amp; periode.</div>
        <div>${donut.svg}</div><div class="legend">${donut.legend}</div>
      </div>
      <div class="card">
        <h3>Profil Spektrum Getaran per Pita Frekuensi</h3>
        <div class="hint" style="margin-top:-6px;margin-bottom:8px;">Nilai getaran (micron) pada tiap pita frekuensi 4&ndash;63 Hz untuk satu titik &amp; tanggal terpilih. Warna batang mengikuti status ISO 2631-2 pita tersebut.</div>
        <div class="field" style="margin-bottom:10px;"><label>Titik &amp; Tanggal Pengukuran</label>
          <select id="ambDashProfileSel">${profileOptions.map(r=>`<option value="${r.id}" ${r.id===ambDashProfileKey?"selected":""}>${escHtml(r.titik)} — ${r.tanggal} (${r.periode})</option>`).join("")}</select>
        </div>
        ${ambBuildVibSpectrum(profileRec)}
      </div>
    </div>
    <div class="card"><h3>Rincian Data Terfilter</h3>
      <div class="tablewrap"><table>${ambDbBuildTable("getaran", detail)}</table></div>
      <div class="hint">Menampilkan ${detail.length} dari ${filtered.length} baris data (urut periode terbaru).</div>
    </div>
  `;
}

function renderAmbienDashboard(){
  document.getElementById("ambDashCategoryTabs").innerHTML = AMB_KATEGORI_ORDER.map(c=>
    `<button type="button" class="chip-toggle ${ambDashCat===c?'active':''}" data-action="ambDashSetCat" data-cat="${c}">${AMB_KATEGORI_LABEL[c]} <span class="muted">(${ambDbRecords(c).length})</span></button>`
  ).join("");
  if(ambDashCat==="ambien") ambRenderParamTab("ambien");
  else if(ambDashCat==="kebauan") ambRenderParamTab("kebauan");
  else if(ambDashCat==="kebisingan") ambRenderKebisinganTab();
  else ambRenderGetaranTab();
}
["ambDashFltSite","ambDashFltParam","ambDashFltFrom","ambDashFltTo"].forEach(id=>{
  document.addEventListener("change", e=>{
    if(e.target.id!==id) return;
    if(id==="ambDashFltSite") ambDashFlt.site = e.target.value;
    if(id==="ambDashFltParam") ambDashFlt.param = e.target.value;
    if(id==="ambDashFltFrom") ambDashFlt.from = e.target.value;
    if(id==="ambDashFltTo") ambDashFlt.to = e.target.value;
    renderAmbienDashboard();
  });
});
document.addEventListener("change", e=>{
  if(e.target.id==="ambDashProfileSel"){ ambDashProfileKey = e.target.value; renderAmbienDashboard(); }
});
Object.assign(ACTIONS, {
  importAmbienXlsx, exportAmbienXlsx, downloadTemplateAmbien, resetAmbienData,
  ambDbSetCat:(t)=>{ ambDbCat = t.dataset.cat; renderAmbienDb(); },
  ambDashSetCat:(t)=>{ ambDashCat = t.dataset.cat; ambDashFlt = {site:"",from:"",to:"",param:""}; ambDashProfileKey=""; renderAmbienDashboard(); },
  addAmbRecordBtn:(t)=>addAmbRecord(t.dataset.cat),
  editAmbRecord:(t)=>editAmbRecord(t.dataset.cat, t.dataset.id),
  deleteAmbRecord:(t)=>deleteAmbRecord(t.dataset.cat, t.dataset.id),
  saveAmbParam:(t)=>saveAmbParam(t.dataset.cat, t.dataset.id),
  saveKebisingan:(t)=>saveKebisingan(t.dataset.id),
  saveGetaran:(t)=>saveGetaran(t.dataset.id)
});
