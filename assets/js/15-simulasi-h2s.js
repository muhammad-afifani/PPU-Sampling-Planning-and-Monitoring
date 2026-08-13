/* =========================================================
   SIMULASI USULAN BAKU MUTU BARU
========================================================= */
// Bagian simulasi bersifat independen terhadap filter dashboard utama (hdSel dan lain lain) supaya
// dapat diuji tanpa mengubah tampilan dashboard yang sedang dilihat. Hanya bekerja pada parameter
// emisi yang memang memiliki konsep baku mutu, karena parameter pendukung tidak diatur baku mutunya.
let simSel = { cerobong: new Set(), sumber: new Set(), permen: new Set() };
let simCerobongPanelOpen = false;
let simTrendMode = "auto"; // "auto", "engine", "site", atau "avg", lihat simResolveTrendMode
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
    btn.textContent = n===0 ? "Semua titik pada lingkup di atas" : `${n} titik dipilih, klik untuk mengubah`;
  }
  const list = document.getElementById("simCerobongList");
  if(!list) return;
  const visible = simVisibleCerobongOptions();
  list.innerHTML = visible.length ? visible.map(c=>`<label class="xsel-opt"><input type="checkbox" class="simCerobongCheck" data-val="${escHtml(c)}" ${simSel.cerobong.has(c)?"checked":""}> ${escHtml(c)}</label>`).join("")
    : `<div class="xsel-empty">Tidak ada titik yang sesuai dengan lingkup atau pencarian.</div>`;
}
// Chip centang untuk lingkup Jenis Sumber dan Permen LH pada simulasi, dapat mencentang lebih dari
// satu pilihan sekaligus, mengikuti pola yang sama dengan chip Site dan Jenis Sumber pada filter
// dashboard utama, supaya konsisten dan tidak perlu ctrl klik seperti pada listbox biasa.
function simRenderChipBar(field, values, labelMap){
  const all = `<button type="button" class="chip-toggle all ${simSel[field].size===0?'active':''}" data-action="simChip" data-field="${field}" data-val="">Semua</button>`;
  return all + values.map(v=>`<button type="button" class="chip-toggle ${simSel[field].has(v)?'active':''}" data-action="simChip" data-field="${field}" data-val="${escHtml(v)}">${escHtml((labelMap&&labelMap[v])||v)}</button>`).join("");
}
function simRenderScopeChips(){
  document.getElementById("simSumberChips").innerHTML = simRenderChipBar("sumber", hdAllValues("namaSumber"));
  document.getElementById("simPermenChips").innerHTML = simRenderChipBar("permen", Object.keys(HD_PERMEN_LABEL), HD_PERMEN_LABEL);
}
function hdRenderSimulationFilters(){
  const paramSel = document.getElementById("simParam");
  if(!paramSel || paramSel.options.length) return; // isi sekali saja, tidak perlu diulang tiap render dashboard
  const emisiParams = hdAllValues("parameter").filter(hdIsEmisiParam);
  paramSel.innerHTML = emisiParams.map(p=>`<option value="${escHtml(p)}">${escHtml(p)}</option>`).join("");
  document.getElementById("simKapasitas").innerHTML += hdAllValues("kategoriKapasitas").map(k=>`<option value="${escHtml(k)}">${escHtml(k)}</option>`).join("");
  document.getElementById("simBahanBakar").innerHTML += hdAllValues("jenisBahanBakar").map(b=>`<option value="${escHtml(b)}">${escHtml(b)}</option>`).join("");
  const periods = [...new Set(DB.hasilPemantauan.map(r=>r.periode))].sort((a,b)=>hasilPeriodParts(a).order-hasilPeriodParts(b).order);
  const fromSel = document.getElementById("simFrom"), toSel = document.getElementById("simTo");
  fromSel.innerHTML = periods.map(p=>`<option value="${p}">${p}</option>`).join("");
  toSel.innerHTML = periods.map(p=>`<option value="${p}">${p}</option>`).join("");
  fromSel.value = periods[0]||"";
  toSel.value = periods[periods.length-1]||"";
  simRenderScopeChips();
  simRenderCerobongChecklist();
}
// Menentukan tampilan tren yang representatif. Kalau ada titik yang dicentang secara eksplisit,
// tampilan per titik tetap dipertahankan walaupun jumlahnya banyak, karena itu memang yang diminta
// pengguna. Kalau tidak ada titik yang dicentang dan jumlah titik pada lingkup cukup banyak, garis
// per titik akan saling tumpang tindih dan sulit dibaca, sehingga tampilan otomatis dialihkan ke
// per site, atau ke rata rata gabungan kalau bahkan jumlah site pun tetap terlalu banyak.
const SIM_TREND_ENGINE_LIMIT = 10;
function simResolveTrendMode(engineCount, siteCount){
  if(simTrendMode!=="auto") return simTrendMode;
  if(simSel.cerobong.size>0) return "engine";
  if(engineCount<=SIM_TREND_ENGINE_LIMIT) return "engine";
  return "site";
}
// Chart tren, memperlihatkan nilai rata rata per periode terhadap ambang usulan. Mendukung tiga
// tampilan: per titik atau engine, per site, atau rata rata gabungan dengan pita rentang minimum
// sampai maksimum.
function buildSimTrendChart(scope, periodsInScope, threshold, unit, mode){
  if(!periodsInScope.length) return "<div class='hint' style='padding:14px;'>Tidak ada periode data pada rentang yang dipilih.</div>";
  let seriesKeys, keyFn, colorFn;
  if(mode==="site"){
    seriesKeys = [...new Set(scope.map(r=>r.site))].sort();
    keyFn = r=>r.site;
    colorFn = (k)=>HASIL_SITE_COLORS[k]||"#7f8fa0";
  }else if(mode==="avg"){
    seriesKeys = [];
  }else{
    seriesKeys = simSel.cerobong.size>0 ? [...simSel.cerobong].filter(c=>scope.some(r=>r.cerobong===c)) : [...new Set(scope.map(r=>r.cerobong))];
    keyFn = r=>r.cerobong;
    colorFn = (k,i)=>HD_PALETTE[i%HD_PALETTE.length];
  }
  if(mode!=="avg" && !seriesKeys.length) return "<div class='hint' style='padding:14px;'>Tidak ada data untuk ditampilkan pada rentang periode ini.</div>";

  const W=760,H=290,padL=54,padR=16,padT=18,padB=34;
  const plotW=W-padL-padR, plotH=H-padT-padB;
  const n = periodsInScope.length;
  const allVals = scope.map(r=>r.resultNumeric);
  let maxY = Math.max(...allVals, threshold)*1.15;
  if(!isFinite(maxY) || maxY<=0) maxY = threshold*1.2 || 100;
  function xFor(i){ return padL + (n<=1?plotW/2:(i/(n-1))*plotW); }
  function yFor(v){ return padT + plotH - (v/maxY)*plotH; }

  let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;font-size:11.5px;background:var(--surface-card);border:1px solid var(--gray-200);border-radius:10px;">`;
  for(let g=0; g<=4; g++){
    const y = padT + plotH - (g/4)*plotH;
    svg += `<line x1="${padL}" y1="${y}" x2="${W-padR}" y2="${y}" stroke="var(--gray-200)"/>`;
    svg += `<text x="2" y="${y+4}" fill="var(--gray-500)">${Math.round(maxY*g/4)}</text>`;
  }
  periodsInScope.forEach((p,i)=>{ svg += `<text x="${xFor(i)}" y="${H-10}" text-anchor="middle" fill="var(--gray-500)">${p}</text>`; });
  svg += `<text x="2" y="12" fill="var(--gray-500)">Satuan, ${escHtml(unit)}</text>`;
  const ys = yFor(threshold);
  svg += `<line x1="${padL}" y1="${ys}" x2="${W-padR}" y2="${ys}" stroke="#e8a33d" stroke-width="1.5" stroke-dasharray="6,4"/>`;
  svg += `<text x="${W-padR-2}" y="${ys-5}" text-anchor="end" fill="#e8a33d" font-weight="700">Usulan ${threshold}</text>`;

  let legend = "";
  if(mode==="avg"){
    const bandTop=[], bandBot=[], avgPts=[];
    periodsInScope.forEach((p,i)=>{
      const vals = scope.filter(r=>r.periode===p).map(r=>r.resultNumeric);
      if(!vals.length) return;
      bandTop.push([xFor(i), yFor(Math.max(...vals))]);
      bandBot.push([xFor(i), yFor(Math.min(...vals))]);
      avgPts.push([xFor(i), yFor(vals.reduce((a,b)=>a+b,0)/vals.length)]);
    });
    if(bandTop.length){
      const bandPath = "M"+bandTop.map(p=>p.join(",")).join("L")+"L"+bandBot.slice().reverse().map(p=>p.join(",")).join("L")+"Z";
      svg += `<path d="${bandPath}" fill="#0ea5a0" fill-opacity="0.15" stroke="none"/>`;
      let linePath=""; avgPts.forEach((pt,k)=>{ linePath += (k===0?"M":"L")+pt[0]+","+pt[1]+" "; });
      svg += `<path d="${linePath.trim()}" fill="none" stroke="#0ea5a0" stroke-width="2.5"/>`;
      avgPts.forEach(pt=>{ svg += `<circle cx="${pt[0]}" cy="${pt[1]}" r="3.5" fill="#0ea5a0"/>`; });
    }
    legend = `<span class="item"><span class="sw" style="background:#0ea5a0;"></span>Rata rata seluruh titik pada lingkup</span><span class="item"><span class="sw" style="background:#0ea5a0;opacity:.3;"></span>Rentang nilai minimum sampai maksimum</span>`;
  }else{
    seriesKeys.forEach((key,i)=>{
      const color = colorFn(key,i);
      const pts = periodsInScope.map((p,pi)=>{
        const vals = scope.filter(r=>keyFn(r)===key && r.periode===p).map(r=>r.resultNumeric);
        if(!vals.length) return null;
        const avg = vals.reduce((a,b)=>a+b,0)/vals.length;
        return [xFor(pi), yFor(avg)];
      });
      const validPts = pts.map((pt,pi)=>pt?[pi,pt]:null).filter(Boolean);
      if(validPts.length<1) return;
      let path = "";
      validPts.forEach(([pi,pt],k)=>{ path += (k===0?"M":"L")+pt[0]+","+pt[1]+" "; });
      svg += `<path d="${path.trim()}" fill="none" stroke="${color}" stroke-width="2.5"/>`;
      validPts.forEach(([pi,pt])=>{ svg += `<circle cx="${pt[0]}" cy="${pt[1]}" r="3.5" fill="${color}"/>`; });
    });
    legend = seriesKeys.map((k,i)=>`<span class="item"><span class="sw" style="background:${colorFn(k,i)}"></span>${escHtml(k)}</span>`).join("");
  }
  svg += `</svg>`;
  legend += `<span class="item"><span class="sw" style="background:#e8a33d;"></span>Usulan baku mutu baru</span>`;
  return `${svg}<div class="legend">${legend}</div>`;
}
// Chart batang per titik, menunjukkan nilai tertinggi yang pernah tercatat dibandingkan ambang usulan.
function buildSimEngineChart(engines, threshold, unit){
  if(!engines.length) return "";
  const rows = engines.slice().sort((a,b)=>b.maxVal-a.maxVal).slice(0,20);
  const W=600, barH=26, gap=9, padL=170, padR=90, topPad=10;
  const H = topPad + rows.length*(barH+gap);
  const maxV = Math.max(threshold, ...rows.map(r=>r.maxVal))*1.15;
  const plotW = W-padL-padR;
  let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;font-size:11px;background:var(--surface-card);border:1px solid var(--gray-200);border-radius:10px;">`;
  rows.forEach((r,i)=>{
    const y = topPad + i*(barH+gap);
    const barLen = (r.maxVal/maxV)*plotW;
    const color = r.currentlyExceeds?"#e0554f":r.exceedCount>0?"#e8a33d":"#3fb27f";
    svg += `<text x="${padL-8}" y="${y+barH/2+4}" text-anchor="end" fill="var(--gray-900)" font-weight="700">${escHtml(r.cerobong)}</text>`;
    svg += `<rect x="${padL}" y="${y}" width="${Math.max(2,barLen)}" height="${barH}" rx="6" fill="${color}"/>`;
    svg += `<text x="${padL+Math.max(2,barLen)+6}" y="${y+barH/2+4}" fill="var(--gray-900)" font-weight="700">${r.maxVal} ${escHtml(unit)}</text>`;
  });
  const xThr = padL + (threshold/maxV)*plotW;
  svg += `<line x1="${xThr}" y1="0" x2="${xThr}" y2="${H}" stroke="#e8a33d" stroke-width="1.5" stroke-dasharray="5,3"/>`;
  svg += `</svg>`;
  return svg;
}
function hdRunSimulation(){
  const parameter = document.getElementById("simParam").value;
  const kapasitas = document.getElementById("simKapasitas").value;
  const bahanBakar = document.getElementById("simBahanBakar").value;
  const from = document.getElementById("simFrom").value;
  const to = document.getElementById("simTo").value;
  const fromOrder = from ? hasilPeriodParts(from).order : -Infinity;
  const toOrder = to ? hasilPeriodParts(to).order : Infinity;
  const threshold = parseFloat(document.getElementById("simThreshold").value);
  const out = document.getElementById("simResult");
  if(!parameter){ out.innerHTML = "<div class='hint' style='padding:10px 0;'>Pilih parameter yang ingin diuji terlebih dahulu.</div>"; return; }
  if(!isFinite(threshold)){ out.innerHTML = "<div class='hint' style='padding:10px 0;'>Masukkan angka usulan baku mutu baru, cukup angka saja, misalnya 250.</div>"; return; }

  const scope = DB.hasilPemantauan.filter(r=>{
    if(r.parameter!==parameter) return false;
    if(r.resultNumeric==null) return false;
    if(simSel.sumber.size && !simSel.sumber.has(r.namaSumber)) return false;
    if(simSel.permen.size && !simSel.permen.has(r.regulasiCek)) return false;
    if(kapasitas && r.kategoriKapasitas!==kapasitas) return false;
    if(bahanBakar && r.jenisBahanBakar!==bahanBakar) return false;
    if(simSel.cerobong.size && !simSel.cerobong.has(r.cerobong)) return false;
    if(r.periodeOrder<fromOrder || r.periodeOrder>toOrder) return false;
    return true;
  });
  if(!scope.length){
    out.innerHTML = "<div class='hint' style='padding:10px 0;'>Tidak ada riwayat data untuk kombinasi parameter dan lingkup ini.</div>";
    return;
  }
  const byEngine = {};
  scope.forEach(r=>{
    const key = r.cerobong;
    const o = byEngine[key] || (byEngine[key] = {cerobong:r.cerobong, site:r.site, namaSumber:r.namaSumber, records:[]});
    o.records.push(r);
  });
  const engines = Object.values(byEngine).map(o=>{
    const exceedCount = o.records.filter(r=>r.resultNumeric>threshold).length;
    const maxVal = Math.max(...o.records.map(r=>r.resultNumeric));
    const latest = o.records.slice().sort((a,b)=>b.periodeOrder-a.periodeOrder)[0];
    const currentlyExceeds = latest.resultNumeric>threshold;
    return {...o, exceedCount, maxVal, latest, currentlyExceeds, unit:latest.unit};
  }).sort((a,b)=> (b.currentlyExceeds-a.currentlyExceeds) || (b.exceedCount-a.exceedCount) || (b.maxVal-a.maxVal));
  const impacted = engines.filter(e=>e.exceedCount>0);
  const existingStd = scope.find(r=>r.standard!=null)?.standard;
  const unit = engines[0]?.unit || "";
  const periodsInScope = [...new Set(scope.map(r=>r.periode))].sort((a,b)=>hasilPeriodParts(a).order-hasilPeriodParts(b).order);
  const siteCount = new Set(scope.map(r=>r.site)).size;
  const resolvedMode = simResolveTrendMode(engines.length, siteCount);

  const lingkupTeks = [
    simSel.sumber.size?`jenis sumber ${[...simSel.sumber].join(", ")}`:"",
    simSel.permen.size?`regulasi ${[...simSel.permen].map(p=>HD_PERMEN_LABEL[p]||p).join(", ")}`:"",
    kapasitas?`kapasitas ${kapasitas}`:"",
    bahanBakar?`bahan bakar ${bahanBakar}`:"",
    simSel.cerobong.size?`${simSel.cerobong.size} titik yang dicentang`:""
  ].filter(Boolean).join(", ");

  let html = `<div class="hint" style="margin:10px 0;">Simulasi diuji terhadap ${scope.length} baris riwayat dari ${engines.length} titik atau engine, pada periode ${from} sampai dengan ${to}${lingkupTeks?`, dengan lingkup ${escHtml(lingkupTeks)}`:""}. `;
  if(existingStd!=null) html += `Baku mutu resmi yang berlaku saat ini untuk lingkup ini adalah ${existingStd} ${escHtml(unit)}. `;
  html += `Angka usulan yang diuji adalah ${threshold} ${escHtml(unit)}.</div>`;
  html += `<div class="stat ${impacted.length?'bad':'good'}" style="display:inline-block;margin-bottom:14px;"><div class="num">${impacted.length} dari ${engines.length}</div><div class="lbl">Titik atau Engine Berpotensi Terdampak</div></div>`;

  if(!impacted.length){
    html += `<div class="hint">Tidak ada riwayat yang melebihi usulan ${threshold}. Berdasarkan data yang tersedia saat ini, usulan tersebut aman untuk seluruh lingkup yang diuji.</div>`;
  }else{
    const modeBtn = (m,label)=>`<button type="button" class="btn small ${simTrendMode===m?'primary':'ghost'}" data-action="simSetTrendMode" data-mode="${m}">${label}</button>`;
    html += `<div class="grid cols-2" style="margin-bottom:14px;">
      <div class="card" style="margin-bottom:0;">
        <div class="cardhead"><h3 style="font-size:12.5px;">Tren Nilai Terhadap Usulan</h3><button class="btn small ghost" data-action="hdZoomChart" data-target="simTrendWrap" data-title="Tren Nilai Terhadap Usulan Baku Mutu Baru">Perbesar</button></div>
        <div class="toolbar" style="margin:0 0 8px;gap:5px;">
          ${modeBtn("auto","Otomatis")}${modeBtn("engine","Per Titik atau Engine")}${modeBtn("site","Per Site")}${modeBtn("avg","Rata rata Gabungan")}
        </div>
        <div class="hint" style="margin:0 0 8px;">${simTrendMode==="auto"?`Mode otomatis sedang menampilkan tampilan <b>${resolvedMode==="engine"?"per titik atau engine":resolvedMode==="site"?"per site":"rata rata gabungan"}</b>, karena lingkup ini memiliki ${engines.length} titik atau engine yang cocok dengan filter.`:"Tampilan dipilih secara manual."}</div>
        <div id="simTrendWrap">${buildSimTrendChart(scope, periodsInScope, threshold, unit, resolvedMode)}</div>
      </div>
      <div class="card" style="margin-bottom:0;">
        <div class="cardhead"><h3 style="font-size:12.5px;">Nilai Tertinggi per Titik</h3><button class="btn small ghost" data-action="hdZoomChart" data-target="simEngineWrap" data-title="Nilai Tertinggi per Titik Terhadap Usulan Baku Mutu Baru">Perbesar</button></div>
        <div class="hint" style="margin:0 0 8px;">${engines.length>20?`Menampilkan 20 dari ${engines.length} titik dengan nilai tertinggi.`:"&nbsp;"}</div>
        <div id="simEngineWrap">${buildSimEngineChart(engines, threshold, unit)}</div>
      </div>
    </div>`;
    html += `<div class="tablewrap" style="max-height:340px;"><table>
      <thead><tr><th>Cerobong</th><th>Site</th><th>Jenis Sumber</th><th>Data Melebihi Usulan</th><th>Nilai Tertinggi Tercatat</th><th>Periode Terbaru</th><th>Status</th></tr></thead>
      <tbody>${engines.map(e=>{
        const warn = e.exceedCount>0;
        return `<tr>
          <td>${escHtml(e.cerobong)}</td><td>${escHtml(e.site)}</td><td class="muted">${escHtml(e.namaSumber)}</td>
          <td>${warn?`<span class="badge b-red">${e.exceedCount} dari ${e.records.length} data</span>`:`<span class="badge b-green">0 dari ${e.records.length} data</span>`}</td>
          <td style="font-family:var(--font-mono);">${e.maxVal} ${escHtml(e.unit)}</td>
          <td class="muted">${e.latest.periode}</td>
          <td>${e.currentlyExceeds?`<span class="badge b-red">Saat ini pun melebihi</span>`:warn?`<span class="badge b-amber">Pernah melebihi</span>`:`<span class="badge b-green">Selalu memenuhi</span>`}</td>
        </tr>`;
      }).join("")}</tbody>
    </table></div>`;
  }
  out.innerHTML = html;
}

/* =========================================================
   PEMANTAUAN KANDUNGAN SULFUR (H2S) — bagian berdiri sendiri di dasar Dashboard, TIDAK ikut
   filter dashboard di atas (selalu menampilkan seluruh riwayat), karena tujuannya murni sebagai
   bukti pendukung kepatuhan Pasal 12 ayat (2) huruf b, bukan analisis yang perlu difilter-filter.
========================================================= */
const H2S_TO_SULFUR_FACTOR = 32.06/34.08; // fraksi massa S dalam molekul H2S
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
function buildH2STrendChart(records){
  const sites = [...new Set(records.map(r=>r.site))].sort();
  const periods = [...new Set(records.map(r=>r.periode))].sort((a,b)=>hasilPeriodParts(a).order-hasilPeriodParts(b).order);
  if(!periods.length) return "<div class='hint' style='padding:14px;'>Belum ada data H2S.</div>";
  const allVals = records.map(r=>r.resultNumeric);
  const maxY = Math.max(...allVals)*1.15 || 0.001;

  const W=380,H=260,padL=54,padR=14,padT=16,padB=34;
  const plotW=W-padL-padR, plotH=H-padT-padB;
  const n = periods.length;
  function xFor(i){ return padL+(n<=1?plotW/2:(i/(n-1))*plotW); }
  function yFor(v){ return padT+plotH-(v/maxY)*plotH; }
  let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;font-size:10px;background:var(--surface-card);border:1px solid var(--gray-200);border-radius:10px;">`;
  for(let g=0; g<=4; g++){
    const y = padT+plotH-(g/4)*plotH;
    svg += `<line x1="${padL}" y1="${y}" x2="${W-padR}" y2="${y}" stroke="var(--gray-200)"/>`;
    svg += `<text x="2" y="${y+3}" fill="var(--gray-500)">${fmtSci(maxY*g/4)}</text>`;
  }
  periods.forEach((p,i)=>{ svg += `<text x="${xFor(i)}" y="${H-10}" text-anchor="middle" fill="var(--gray-500)">${p}</text>`; });
  sites.forEach((site,si)=>{
    const color = HASIL_SITE_COLORS[site]||HD_PALETTE[si%HD_PALETTE.length];
    const pts = periods.map((p,i)=>{
      const rec = records.find(r=>r.site===site && r.periode===p);
      return rec ? [xFor(i), yFor(rec.resultNumeric)] : null;
    });
    const validPts = pts.map((pt,i)=>pt?[i,pt]:null).filter(Boolean);
    if(validPts.length<1) return;
    let path=""; validPts.forEach(([i,pt],k)=>{ path += (k===0?"M":"L")+pt[0]+","+pt[1]+" "; });
    svg += `<path d="${path.trim()}" fill="none" stroke="${color}" stroke-width="2.2"/>`;
    validPts.forEach(([i,pt])=>{ svg += `<circle cx="${pt[0]}" cy="${pt[1]}" r="3" fill="${color}"/>`; });
  });
  svg += `</svg>`;
  const legend = sites.map((s,i)=>`<span class="item"><span class="sw" style="background:${HASIL_SITE_COLORS[s]||HD_PALETTE[i%HD_PALETTE.length]}"></span>${escHtml(s)}</span>`).join("");
  return `${svg}<div class="legend" style="margin-top:6px;">${legend}</div>`;
}
function renderH2SSection(){
  const wrap = document.getElementById("h2sDetailTable");
  if(!wrap) return; // halaman lain, bukan Dashboard Hasil Pemantauan
  const records = DB.hasilPemantauan.filter(r=>r.parameter==="H2S" && r.resultNumeric!=null)
    .slice().sort((a,b)=> a.site.localeCompare(b.site) || a.cerobong.localeCompare(b.cerobong) || a.periodeOrder-b.periodeOrder);

  document.getElementById("h2sTrendWrap").innerHTML = buildH2STrendChart(records);

  if(!records.length){
    document.getElementById("h2sSummary").innerHTML = "<div class='hint'>Belum ada data H2S.</div>";
    wrap.innerHTML = "<tbody><tr><td class='hint'>Belum ada data H2S.</td></tr></tbody>";
    return;
  }
  const worst = records.reduce((a,b)=> b.resultNumeric>a.resultNumeric ? b : a);
  const worstSulfur = worst.resultNumeric*H2S_TO_SULFUR_FACTOR;
  document.getElementById("h2sSummary").innerHTML = `
    <div class="hd-param-pill" style="display:inline-block;margin:0 8px 8px 0;"><div class="lbl">Nilai H2S Tertinggi Tercatat</div><div class="val" style="font-size:12.5px;">${fmtSci(worst.resultNumeric)}% <span class="muted" style="font-weight:400;">(${fmtDecPct(worst.resultNumeric)})</span></div><div class="meta">${escHtml(worst.cerobong)}, ${escHtml(worst.site)}, ${worst.periode}</div></div>
    <div class="hd-param-pill" style="display:inline-block;margin:0 0 8px 0;"><div class="lbl">Setara Kandungan Sulfur (S)</div><div class="val" style="font-size:12.5px;">${fmtSci(worstSulfur)}% <span class="muted" style="font-weight:400;">(${fmtDecPct(worstSulfur)})</span></div><div class="meta">${(worstSulfur/0.5*100).toFixed(3)}% dari ambang batas 0,5%</div></div>
    <div class="hint" style="margin-top:4px;">Bahkan nilai TERTINGGI yang pernah tercatat, setelah dikonversi ke Kandungan Sulfur, masih sekitar ${Math.round(0.5/worstSulfur)} kali lebih kecil dari ambang batas 0,5% berat pada Pasal 12 ayat (2) huruf b — status pengecualian baku mutu SO2 numerik untuk Turbin Gas, Heater/Reboiler, dan Glycol Reboiler tetap valid berdasarkan seluruh riwayat pemantauan sampai saat ini.</div>
  `;

  wrap.innerHTML = `
    <thead><tr><th>Site</th><th>Titik</th><th>Periode</th><th>H2S, Notasi Ilmiah</th><th>H2S, Desimal</th><th>Setara Kandungan Sulfur (S)</th><th>% dari Ambang Batas 0,5%</th><th>Status</th></tr></thead>
    <tbody>${records.map(r=>{
      const sulfur = r.resultNumeric*H2S_TO_SULFUR_FACTOR;
      const pctThreshold = sulfur/0.5*100;
      const badge = HASIL_STATUS_BADGE[r.statusBakuMutu] || HASIL_STATUS_BADGE.not_evaluated;
      return `<tr>
        <td>${escHtml(r.site)}</td><td>${escHtml(r.cerobong)}</td><td>${r.periode}</td>
        <td style="font-family:var(--font-mono);">${fmtSci(r.resultNumeric)}%</td>
        <td style="font-family:var(--font-mono);" class="muted">${fmtDecPct(r.resultNumeric)}</td>
        <td style="font-family:var(--font-mono);">${fmtSci(sulfur)}% <span class="muted">(${fmtDecPct(sulfur)})</span></td>
        <td class="muted">${pctThreshold.toFixed(4)}%</td>
        <td><span class="badge ${badge[0]}">${badge[1]}</span></td>
      </tr>`;
    }).join("")}</tbody>`;
}

