/* =========================================================
   MODEL AQI/ISPU AMBIENT — indeks kualitas udara dihitung dari data Database Hasil Ambient
   kategori "Udara Ambien" (DB.hasilAmbien.ambien: PM10, PM2.5, SO2, CO, O3, NOx/NO2, dst).
   Dua standar bisa dipilih:
   - AQI: metodologi US EPA (dipakai IQAir secara global, termasuk iqair.com/id) — breakpoint
     resmi US EPA AQI Technical Assistance Document, kategori Good..Hazardous.
   - ISPU: Indonesia, Permen LHK No. P.14/MENLHK/SETJEN/KUM.1/7/2020 (basis nilai parameter
     PM10/SO2/CO/O3/NO2 mewarisi Kepdal No. 107 Tahun 1997 / Kep-45/MENLH/10/1997, PM2.5
     ditambahkan pada revisi 2020), kategori Baik..Berbahaya.
   CATATAN SUMBER: skema kategori/warna & breakpoint PM10 ISPU terverifikasi silang dari
   beberapa referensi publik. Breakpoint ISPU utk SO2/CO/O3/NO2/PM2.5 direkonstruksi dari
   referensi terbaik yang bisa diakses sesi ini (ispu.menlhk.go.id & jdih.menlhk.go.id tidak
   bisa diakses langsung dari sandbox ini) — SEBELUM dipakai pelaporan resmi, silangkan dulu ke
   regulasi resmi lewat tombol "Info & Referensi" di halaman ini (tabel lengkap ditampilkan di
   sana apa adanya, supaya mudah dicek/dikoreksi). Breakpoint AQI (US EPA) jauh lebih stabil &
   terdokumentasi luas, termasuk revisi PM2.5 2024.
========================================================= */
let aqiIspuStandard = "aqi";
let aqiIspuFlt = {site:"", from:"", to:""};

// Kolom parameter di DB.hasilAmbien.ambien yang punya padanan standar AQI/ISPU. "NOx" di data
// sumbernya berlabel "Nitrogen Dioxide (NOx)" — diperlakukan sbg pembacaan NO2 utk perhitungan
// indeks (baik AQI maupun ISPU memang berbasis NO2, bukan NOx total). TSP/NMHC/Pb tidak dipakai
// krn bukan bagian dari 6 parameter standar AQI ataupun ISPU.
const AQIISPU_POLLUTANT_LABEL = {"PM10":"PM10", "PM2.5":"PM2.5", "SO2":"SO2", "CO":"CO", "O3":"O3", "NOx":"NO2"};

const AQI_CATEGORIES = [
  {lo:0,   hi:50,  name:"Good (Baik)", color:"#00b050", text:"#ffffff"},
  {lo:51,  hi:100, name:"Moderate (Sedang)", color:"#ffd400", text:"#3a2f00"},
  {lo:101, hi:150, name:"Unhealthy for Sensitive Groups", color:"#ff7e00", text:"#3a1e00"},
  {lo:151, hi:200, name:"Unhealthy (Tidak Sehat)", color:"#ff0000", text:"#ffffff"},
  {lo:201, hi:300, name:"Very Unhealthy (Sangat Tidak Sehat)", color:"#8f3f97", text:"#ffffff"},
  {lo:301, hi:500, name:"Hazardous (Berbahaya)", color:"#7e0023", text:"#ffffff"}
];
const ISPU_CATEGORIES = [
  {lo:0,   hi:50,  name:"Baik", color:"#1a9c3f", text:"#ffffff"},
  {lo:51,  hi:100, name:"Sedang", color:"#2166d6", text:"#ffffff"},
  {lo:101, hi:199, name:"Tidak Sehat", color:"#f2c200", text:"#3a2f00"},
  {lo:200, hi:299, name:"Sangat Tidak Sehat", color:"#e0332a", text:"#ffffff"},
  {lo:300, hi:500, name:"Berbahaya", color:"#141414", text:"#ffffff"}
];

// Konversi µg/Nm3 (satuan tersimpan seragam utk semua parameter Udara Ambien di app ini) -> ppm,
// pada 25 C / 1 atm (volume molar 24.45 L/mol): ppm = (ug/m3 / 1000) * 24.45 / MW. Cuma dipakai
// utk standar AQI (breakpoint resmi US EPA memakai ppm/ppb utk gas) — ISPU memakai µg/m3 langsung
// utk semua parameter, jadi tidak perlu konversi.
const AQI_MW = {CO:28.01, SO2:64.07, NOx:46.01, O3:48.00};
// Breakpoint resmi US EPA: CO & O3 dlm ppm, tapi SO2 & NOx(NO2) dlm ppb (ppm x 1000) — lihat
// AQI_BREAKPOINTS di bawah untuk satuan tiap tabel.
const AQI_UNIT_IS_PPB = {SO2:true, NOx:true};
function aqiIspuToAqiUnit(paramKode, ugPerM3){
  const mw = AQI_MW[paramKode];
  if(!mw) return ugPerM3; // PM10/PM2.5 tetap µg/m3 (tanpa konversi)
  const ppm = (ugPerM3/1000)*24.45/mw;
  return AQI_UNIT_IS_PPB[paramKode] ? ppm*1000 : ppm;
}

// Tabel breakpoint: [batasKonsentrasiBawah, batasKonsentrasiAtas, indeksBawah, indeksAtas].
// AQI (US EPA): PM2.5/PM10 dlm µg/m3 (PM2.5 sesuai revisi EPA 2024); CO/O3 dlm ppm; SO2/NOx(NO2) dlm ppb.
const AQI_BREAKPOINTS = {
  "PM2.5":[[0,9.0,0,50],[9.1,35.4,51,100],[35.5,55.4,101,150],[55.5,125.4,151,200],[125.5,225.4,201,300],[225.5,325.4,301,500]],
  "PM10": [[0,54,0,50],[55,154,51,100],[155,254,101,150],[255,354,151,200],[355,424,201,300],[425,604,301,500]],
  "CO":   [[0,4.4,0,50],[4.5,9.4,51,100],[9.5,12.4,101,150],[12.5,15.4,151,200],[15.5,30.4,201,300],[30.5,50.4,301,500]],
  "SO2":  [[0,35,0,50],[36,75,51,100],[76,185,101,150],[186,304,151,200],[305,604,201,300],[605,1004,301,500]],
  "NOx":  [[0,53,0,50],[54,100,51,100],[101,360,101,150],[361,649,151,200],[650,1249,201,300],[1250,2049,301,500]],
  "O3":   [[0,0.054,0,50],[0.055,0.070,51,100],[0.071,0.085,101,150],[0.086,0.105,151,200],[0.106,0.200,201,300],[0.201,0.504,301,500]]
};
// ISPU (Indonesia): seluruh parameter dlm µg/m3. PM10 terverifikasi silang ke Permen LHK
// P.14/2020 (50/150/350/420/500); parameter lain direkonstruksi dari referensi terbaik yang
// tersedia — lihat catatan sumber di header file & modal Info & Referensi.
const ISPU_BREAKPOINTS = {
  "PM10": [[0,50,0,50],[51,150,51,100],[151,350,101,199],[351,420,200,299],[421,500,300,500]],
  "PM2.5":[[0,15.5,0,50],[15.6,55.4,51,100],[55.5,150.4,101,199],[150.5,250.4,200,299],[250.5,500,300,500]],
  "SO2":  [[0,52,0,50],[53,180,51,100],[181,400,101,199],[401,800,200,299],[801,1000,300,500]],
  "CO":   [[0,5000,0,50],[5001,10000,51,100],[10001,17000,101,199],[17001,34000,200,299],[34001,46000,300,500]],
  "O3":   [[0,120,0,50],[121,235,51,100],[236,400,101,199],[401,800,200,299],[801,1000,300,500]],
  "NOx":  [[0,80,0,50],[81,200,51,100],[201,1130,101,199],[1131,2260,200,299],[2261,3000,300,500]]
};

function aqiIspuSubIndex(paramKode, ugPerM3, standard){
  if(ugPerM3==null || isNaN(ugPerM3)) return null;
  const table = (standard==="ispu" ? ISPU_BREAKPOINTS : AQI_BREAKPOINTS)[paramKode];
  if(!table) return null;
  const c = standard==="ispu" ? ugPerM3 : aqiIspuToAqiUnit(paramKode, ugPerM3);
  for(const [lo,hi,iLo,iHi] of table){
    if(c>=lo && c<=hi) return Math.round(((iHi-iLo)/(hi-lo))*(c-lo)+iLo);
  }
  const last = table[table.length-1];
  return c>last[1] ? last[3] : Math.round(table[0][2]); // di atas tabel -> indeks maksimum; di bawah -> 0
}
function aqiIspuCategoryFor(index, standard){
  const cats = standard==="ispu" ? ISPU_CATEGORIES : AQI_CATEGORIES;
  return cats.find(c=>index>=c.lo && index<=c.hi) || cats[cats.length-1];
}
// Kelompokkan baris parameter Udara Ambien jadi "event sampling" (1 titik + 1 periode = 1 event,
// berisi banyak parameter). Dikelompokkan per PERIODE (bukan per tanggal persis) krn data riil
// kadang mencatat 1-2 parameter (mis. SO2) dgn tanggal sedikit beda dari parameter lain pada
// putaran sampling yang sama (mis. CPA Camp S2 2025: SO2 tercatat 2025-08-19, 7 parameter lain
// 2025-08-27) — kalau dikelompokkan per tanggal persis, parameter itu kepisah jadi event sendiri
// beranggota 1 parameter, bukan tergabung ke event lengkapnya. Semua tanggal berbeda yang muncul
// dalam 1 periode tetap dikumpulkan (tanggalRange) supaya tidak ada info yang hilang/disamarkan.
function aqiIspuGroupEvents(){
  const groups = new Map();
  DB.hasilAmbien.ambien.forEach(r=>{
    if(!AQIISPU_POLLUTANT_LABEL[r.parameterKode] || r.resultNumeric==null) return;
    const key = (r.titikId||r.titik)+"|"+r.periode;
    if(!groups.has(key)) groups.set(key, {titikId:r.titikId, titik:r.titik, site:r.site, tanggals:new Set(), periode:r.periode, periodeOrder:r.periodeOrder, params:{}});
    const g = groups.get(key);
    if(r.tanggal) g.tanggals.add(r.tanggal);
    g.params[r.parameterKode] = r.resultNumeric;
  });
  return [...groups.values()].map(g=>{
    const dates = [...g.tanggals].sort();
    const tanggal = dates.length<=1 ? (dates[0]||null) : (dates[0]+" s/d "+dates[dates.length-1]);
    return {titikId:g.titikId, titik:g.titik, site:g.site, tanggal, tanggalSort:dates[dates.length-1]||"", periode:g.periode, periodeOrder:g.periodeOrder, params:g.params};
  });
}
function aqiIspuComputeEvent(ev, standard){
  const subIdx = {};
  let dominant=null, dominantVal=-1;
  Object.keys(ev.params).forEach(pk=>{
    const idx = aqiIspuSubIndex(pk, ev.params[pk], standard);
    if(idx==null) return;
    subIdx[pk] = idx;
    if(idx>dominantVal){ dominantVal=idx; dominant=pk; }
  });
  if(dominant==null) return null;
  return {...ev, subIdx, index:dominantVal, dominant, category: aqiIspuCategoryFor(dominantVal, standard)};
}

/* ---------- Chart builders ---------- */
function aqiIspuBuildRankChart(rows){ // rows: [{titik, index, standard}]
  if(!rows.length) return "<div class='hint' style='padding:14px;'>Tidak ada data untuk ditampilkan.</div>";
  const W=560, rowH=26, padL=200, padR=54, topPad=10;
  const H = topPad + rows.length*rowH + 10;
  const plotW = W-padL-padR, maxVal=500;
  let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;font-size:11px;background:var(--surface-card);border:1px solid var(--gray-200);border-radius:10px;">`;
  rows.forEach((r,i)=>{
    const y = topPad + i*rowH;
    const barLen = Math.max(2, (r.index/maxVal)*plotW);
    const cat = aqiIspuCategoryFor(r.index, r.standard);
    svg += `<text x="${padL-8}" y="${y+rowH/2+4}" text-anchor="end" fill="var(--gray-900)">${escHtml(r.titik)}</text>`;
    svg += `<rect x="${padL}" y="${y+4}" width="${barLen}" height="${rowH-10}" rx="4" fill="${cat.color}"><title>${escHtml(cat.name)}</title></rect>`;
    svg += `<text x="${padL+barLen+6}" y="${y+rowH/2+4}" fill="var(--gray-900)" font-weight="700">${r.index}</text>`;
  });
  svg += `</svg>`;
  return svg;
}
// "Riwayat Seluruh Titik": tabel kompak tren per semester — baris = titik, kolom = periode
// (S1/S2 berurutan), sel = badge warna kategori berisi angka indeks. Baik nunjukin tren
// naik/turun tiap titik antar semester (baca 1 baris ke kanan) maupun ringkas krn lebar kolom
// tetap (beda dgn timeline lingkaran lama yg makin lebar kalau titik makin sering disampling).
function aqiIspuBuildTrendTable(events, periods){
  if(!events.length || !periods.length) return "<div class='hint' style='padding:14px;'>Tidak ada data sampling pada filter ini.</div>";
  const byTitik = {};
  events.forEach(ev=>{
    const key = ev.site+"::"+ev.titik;
    if(!byTitik[key]) byTitik[key] = {site:ev.site, titik:ev.titik, byPeriode:{}};
    byTitik[key].byPeriode[ev.periode] = ev;
  });
  const rows = Object.values(byTitik).sort((a,b)=> a.site===b.site ? a.titik.localeCompare(b.titik) : a.site.localeCompare(b.site));
  const headerHtml = periods.map(p=>{
    const {sem, tahun} = hasilPeriodParts(p);
    return `<th style="text-align:center;white-space:nowrap;">${sem?`S${sem}<br><span class="muted" style="font-weight:400;font-size:10px;">${tahun}</span>`:escHtml(p)}</th>`;
  }).join("");
  const rowsHtml = rows.map(r=>`<tr>
    <td>${escHtml(r.titik)}</td><td class="muted">${r.site}</td>
    ${periods.map(p=>{
      const ev = r.byPeriode[p];
      if(!ev) return `<td class="muted" style="text-align:center;">-</td>`;
      return `<td style="text-align:center;"><span class="aqi-pill" style="background:${ev.category.color};color:${ev.category.text};" title="${escHtml(ev.tanggal||"")} — ${escHtml(ev.category.name)} — parameter dominan ${AQIISPU_POLLUTANT_LABEL[ev.dominant]||ev.dominant}">${ev.index}</span></td>`;
    }).join("")}
  </tr>`).join("");
  return `<div class="tablewrap"><table class="dp-table" style="font-size:11.5px;">
    <thead><tr><th>Titik</th><th>Site</th>${headerHtml}</tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table></div>`;
}
function aqiIspuLegendHtml(standard){
  const cats = standard==="ispu" ? ISPU_CATEGORIES : AQI_CATEGORIES;
  return `<div class="legend">${cats.map(c=>`<span class="item"><span class="sw" style="background:${c.color}"></span>${escHtml(c.name)} (${c.lo}-${c.hi===500?"500+":c.hi})</span>`).join("")}</div>`;
}
function aqiIspuSubIndexBreakdownHtml(ev){
  return Object.keys(ev.subIdx).map(pk=>{
    const isDom = pk===ev.dominant;
    return `<span style="${isDom?'font-weight:800;color:var(--gray-900);':'color:var(--gray-500);'}">${AQIISPU_POLLUTANT_LABEL[pk]||pk} ${ev.subIdx[pk]}</span>`;
  }).join(" &middot; ");
}
function aqiIspuBuildTable(rows){
  return `<thead><tr><th>Titik</th><th>Site</th><th>Periode</th><th>Tanggal</th><th>Sub-Indeks per Parameter</th><th>Indeks</th><th>Dominan</th><th>Kategori</th></tr></thead>
    <tbody>${rows.map(ev=>`<tr>
      <td>${escHtml(ev.titik)}</td><td>${ev.site}</td><td>${ev.periode}</td><td class="muted">${ev.tanggal||"-"}</td>
      <td style="font-size:11px;">${aqiIspuSubIndexBreakdownHtml(ev)}</td>
      <td style="font-family:var(--font-mono);font-weight:800;">${ev.index}</td>
      <td class="muted">${AQIISPU_POLLUTANT_LABEL[ev.dominant]||ev.dominant}</td>
      <td><span class="badge" style="background:${ev.category.color};color:${ev.category.text};">${escHtml(ev.category.name)}</span></td>
    </tr>`).join("")}</tbody>`;
}

/* ---------- Peta sebaran (Leaflet) — gaya kartu IQAir: lingkaran berwarna kategori + angka indeks ---------- */
let aqiIspuMapInstance=null, aqiIspuMapMarkersLayer=null;
let aqiIspuMapPeriode = ""; // "" = ikut periode terakhir pada filter aktif (auto-follow)
function aqiIspuInitMap(){
  if(aqiIspuMapInstance) return;
  const el = document.getElementById("aqiIspuMap");
  if(!el) return;
  if(typeof L==="undefined"){
    el.innerHTML = "<div class='hint' style='padding:20px;'>Peta tidak bisa dimuat — perlu koneksi internet saat pertama kali buka halaman ini (untuk load tile peta). Coba refresh setelah online.</div>";
    return;
  }
  aqiIspuMapInstance = L.map(el, {maxZoom:19}).setView([-0.75,117.4], 9);
  const satellite = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    maxZoom:19, maxNativeZoom:17, attribution:"Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics"
  });
  const street = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {maxZoom:19, maxNativeZoom:19, attribution:"&copy; OpenStreetMap contributors"});
  satellite.addTo(aqiIspuMapInstance);
  L.control.layers({"Satelit":satellite, "Peta Jalan":street}).addTo(aqiIspuMapInstance);
  aqiIspuMapMarkersLayer = L.layerGroup().addTo(aqiIspuMapInstance);
  if(window.ResizeObserver) new ResizeObserver(()=>{ if(aqiIspuMapInstance) aqiIspuMapInstance.invalidateSize(); }).observe(el);
  [30,150,500,1200].forEach(ms=>setTimeout(()=>{ if(aqiIspuMapInstance) aqiIspuMapInstance.invalidateSize(); }, ms));
}
function aqiIspuMapIcon(ev){
  const cat = ev.category, size=38;
  return L.divIcon({
    className:"",
    html:`<div style="width:${size}px;height:${size}px;border-radius:50%;background:${cat.color};color:${cat.text};display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;border:2.5px solid rgba(255,255,255,.92);box-shadow:0 1px 6px rgba(0,0,0,.4);">${ev.index}</div>`,
    iconSize:[size,size], iconAnchor:[size/2,size/2], popupAnchor:[0,-size/2-2]
  });
}
// Kembalikan jumlah titik yang berhasil digambar (punya koordinat) — dipakai render() utk catatan
// "sekian titik belum berkoordinat" biar transparan, bukan cuma diam-diam hilang dari peta.
function aqiIspuDrawMapMarkers(events){
  if(!aqiIspuMapInstance || !aqiIspuMapMarkersLayer) return 0;
  aqiIspuMapMarkersLayer.clearLayers();
  const coordsList = [];
  events.forEach(ev=>{
    const c = DB.pointCoords[ev.site+"::"+ev.titik];
    if(!c) return;
    coordsList.push(c);
    L.marker(c, {icon: aqiIspuMapIcon(ev)}).bindPopup(`<div style="font-size:12px;min-width:200px;">
        <b>${escHtml(ev.titik)}</b><br><span class="muted">${ev.site} &middot; ${ev.periode} &middot; ${ev.tanggal||"-"}</span>
        <div style="margin-top:6px;">${aqiIspuSubIndexBreakdownHtml(ev)}</div>
        <div style="margin-top:6px;"><span class="badge" style="background:${ev.category.color};color:${ev.category.text};">${escHtml(ev.category.name)}</span> <b style="font-family:var(--font-mono);">${ev.index}</b></div>
      </div>`).addTo(aqiIspuMapMarkersLayer);
  });
  if(coordsList.length===1) aqiIspuMapInstance.setView(coordsList[0], 13);
  else if(coordsList.length>1) aqiIspuMapInstance.fitBounds(L.latLngBounds(coordsList), {padding:[40,40], maxZoom:13});
  return coordsList.length;
}

/* ---------- Page render ---------- */
function aqiIspuPopulateFilters(sites, periods){
  const siteSel = document.getElementById("aqiIspuFltSite");
  const curSite = siteSel.value || aqiIspuFlt.site;
  siteSel.innerHTML = '<option value="">Semua</option>'+sites.map(s=>`<option value="${s}" ${curSite===s?"selected":""}>${s}</option>`).join("");
  const fromSel = document.getElementById("aqiIspuFltFrom");
  const curFrom = fromSel.value || aqiIspuFlt.from;
  fromSel.innerHTML = '<option value="">Awal</option>'+periods.map(p=>`<option value="${p}" ${curFrom===p?"selected":""}>${p}</option>`).join("");
  const toSel = document.getElementById("aqiIspuFltTo");
  const curTo = toSel.value || aqiIspuFlt.to;
  toSel.innerHTML = '<option value="">Akhir</option>'+periods.map(p=>`<option value="${p}" ${curTo===p?"selected":""}>${p}</option>`).join("");
}
/* ---------- Tampilan gaya IQAir: panel indeks, polutan, rekomendasi, peringkat, tren ---------- */
// Pedoman WHO 2021 (rata-rata 24 jam; O3 8 jam) — hanya pembanding "x kali pedoman" seperti IQAir.
const AQI_WHO_GUIDE = {"PM2.5":15, "PM10":45, "NOx":25, "SO2":40, "CO":4000, "O3":100};
const AQI_POLLUTANT_NAME = {"PM2.5":"Partikulat halus (PM2.5)", "PM10":"Partikulat (PM10)", "NOx":"Nitrogen dioksida (NO₂)", "SO2":"Sulfur dioksida (SO₂)", "CO":"Karbon monoksida (CO)", "O3":"Ozon (O₃)"};
const AQI_POLLUTANT_ORDER = ["PM2.5","PM10","O3","NOx","SO2","CO"];
const AQI_ADVICE = [
  ["Kualitas udara baik. Aman untuk aktivitas di luar ruangan.", "Buka jendela untuk sirkulasi udara bersih."],
  ["Kualitas udara dapat diterima. Kelompok sangat sensitif sebaiknya membatasi aktivitas berat di luar ruangan.", "Pantau kondisi bila ada gejala pernapasan."],
  ["Kelompok sensitif (anak, lansia, penderita asma/jantung) kurangi aktivitas berat di luar ruangan.", "Pertimbangkan masker saat di luar ruangan."],
  ["Semua orang sebaiknya mengurangi aktivitas di luar ruangan dan memakai masker.", "Tutup jendela, gunakan pembersih udara bila tersedia."],
  ["Hindari aktivitas di luar ruangan. Kelompok sensitif tetap di dalam ruangan.", "Wajib masker; tutup jendela dan gunakan pembersih udara."],
  ["Kondisi darurat kesehatan: tetap di dalam ruangan.", "Hindari seluruh aktivitas fisik di luar ruangan."]
];
let aqiSelKey = "";
const aqiStdLabel = ()=> aqiIspuStandard==="ispu" ? "ISPU" : "AQI US";
const aqiCats = ()=> aqiIspuStandard==="ispu" ? ISPU_CATEGORIES : AQI_CATEGORIES;
function aqiCatIdx(index){ const cs = aqiCats(); const c = aqiIspuCategoryFor(index, aqiIspuStandard); return Math.max(0, cs.indexOf(c)); }
function aqiFaceSvg(level, color){
  // Wajah sederhana gaya IQAir: senyum (baik) sampai cemberut (buruk).
  const mouth = ["M20 38 Q32 48 44 38","M21 40 Q32 45 43 40","M21 42 L43 42","M21 44 Q32 38 43 44","M20 46 Q32 36 44 46","M20 47 Q32 34 44 47"][Math.min(5,level)];
  return `<svg class="aqi-face" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="29" fill="rgba(255,255,255,.18)" stroke="currentColor" stroke-width="2.5"/><circle cx="23" cy="26" r="3.2" fill="currentColor"/><circle cx="41" cy="26" r="3.2" fill="currentColor"/><path d="${mouth}" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>`;
}
function aqiScaleBarHtml(){
  return `<div class="aqi-scale">${aqiCats().map(c=>`<div class="aqi-scale-seg" style="background:${c.color};color:${c.text}"><b>${c.lo}–${c.hi===500?"500+":c.hi}</b><span>${escHtml(c.name)}</span></div>`).join("")}</div>`;
}
function aqiPillHtml(index){
  const c = aqiIspuCategoryFor(index, aqiIspuStandard);
  return `<span class="aqi-pill" style="background:${c.color};color:${c.text}" title="${escHtml(c.name)}">${index}</span>`;
}
function aqiNowPanel(ev, options){
  const c = ev.category, lvl = aqiCatIdx(ev.index);
  const domConc = ev.params[ev.dominant];
  return `<div class="aqi-now" style="--aqi-c:${c.color};--aqi-t:${c.text}">
    <div class="aqi-now-head"><span class="aqi-now-eyebrow">Indeks kualitas udara &middot; ${aqiStdLabel()}</span>
      <select id="aqiSelTitik" aria-label="Pilih titik">${options.map(o=>`<option value="${escHtml(o.key)}" ${o.key===aqiSelKey?"selected":""}>${escHtml(o.label)}</option>`).join("")}</select></div>
    <div class="aqi-now-main">
      <div class="aqi-now-num">${ev.index}<small>${aqiStdLabel()}</small></div>
      <div class="aqi-now-cat"><b>${escHtml(c.name)}</b><span>Polutan utama: ${escHtml(AQIISPU_POLLUTANT_LABEL[ev.dominant]||ev.dominant)} ${domConc!=null?`&middot; ${hdNum(domConc)} µg/m³`:""}</span></div>
      ${aqiFaceSvg(lvl)}
    </div>
    <div class="aqi-now-foot">${escHtml(ev.titik)} &middot; ${escHtml(ev.site)} &middot; ${escHtml(ev.tanggal||"-")} &middot; ${escHtml(ev.periode)}</div>
  </div>`;
}
function aqiPollutantGrid(ev){
  return `<div class="aqi-pol-grid">${AQI_POLLUTANT_ORDER.filter(pk=>ev.params[pk]!=null).map(pk=>{
    const conc = ev.params[pk], sub = ev.subIdx[pk];
    const c = sub!=null ? aqiIspuCategoryFor(sub, aqiIspuStandard) : null;
    const who = AQI_WHO_GUIDE[pk] ? conc/AQI_WHO_GUIDE[pk] : null;
    return `<div class="aqi-pol ${pk===ev.dominant?"dom":""}">
      <div class="aqi-pol-head"><span>${escHtml(AQI_POLLUTANT_NAME[pk]||pk)}</span>${sub!=null?`<span class="aqi-pill sm" style="background:${c.color};color:${c.text}">${sub}</span>`:""}</div>
      <div class="aqi-pol-val">${hdNum(conc)}<small>µg/m³</small></div>
      <div class="aqi-pol-bar"><i style="width:${Math.min(100,(sub||0)/300*100).toFixed(1)}%;background:${c?c.color:"#7f8fa0"}"></i></div>
      <div class="aqi-pol-foot">${who!=null?`${who>=1?`<b class="warn">${hdNum(who,1)}×</b>`:`${hdNum(who,2)}×`} pedoman WHO 24 jam`:"&nbsp;"}${pk===ev.dominant?` &middot; <b>dominan</b>`:""}</div>
    </div>`;
  }).join("")}</div>`;
}
function aqiAdviceHtml(ev){
  const lvl = Math.min(AQI_ADVICE.length-1, aqiCatIdx(ev.index));
  const [a,b] = AQI_ADVICE[lvl];
  const c = ev.category;
  return `<div class="aqi-advice" style="--aqi-c:${c.color}">
    <div class="aqi-advice-ic">${HD_IC.shield}</div>
    <div><b>Rekomendasi kesehatan &middot; ${escHtml(c.name)}</b><ul><li>${a}</li><li>${b}</li></ul>
    <div class="hint" style="margin:4px 0 0;">Indeks dihitung dari sekali sampling lab (bukan pemantauan kontinu), jadi menggambarkan kondisi saat pengambilan contoh.</div></div>
  </div>`;
}
function aqiRankingHtml(events, period){
  const rows = events.filter(e=>e.periode===period).sort((a,b)=>b.index-a.index);
  if(!rows.length) return hdEmpty("Tidak ada data pada periode ini.");
  return `<ol class="aqi-rank">${rows.map((e,i)=>`<li class="${(e.site+"::"+e.titik)===aqiSelKey?"on":""}">
    <span class="aqi-rank-n">${i+1}</span>
    <button type="button" class="aqi-rank-name" data-action="aqiPickTitik" data-key="${escHtml(e.site+"::"+e.titik)}"><b>${escHtml(e.titik)}</b><small><span class="hd-site"><i style="background:${hdSiteColor(e.site)}"></i>${escHtml(e.site)}</span> &middot; dominan ${escHtml(AQIISPU_POLLUTANT_LABEL[e.dominant]||e.dominant)}</small></button>
    ${aqiPillHtml(e.index)}
  </li>`).join("")}</ol>`;
}
// Tren indeks per site (maks per periode) dengan latar pita warna kategori — gaya grafik riwayat IQAir.
function aqiTrendSvg(events, periods){
  const sites = [...new Set(events.map(e=>e.site))].sort();
  if(!periods.length || !sites.length) return hdEmpty("Tidak ada data.");
  const series = sites.map(s=>({key:s, color:hdSiteColor(s), values: periods.map(p=>{ const v = events.filter(e=>e.site===s && e.periode===p).map(e=>e.index); return v.length?Math.max(...v):null; })})).filter(s=>s.values.some(v=>v!=null));
  const dataMax = Math.max(...series.flatMap(s=>s.values.filter(v=>v!=null)), 60);
  const cats = aqiCats();
  const capCat = cats.find(c=>dataMax<=c.hi) || cats[cats.length-1];
  const yMax = Math.min(500, capCat.hi===500?500:capCat.hi + 0);
  const W=780, H=300, padL=44, padR=110, padT=14, padB=34, plotW=W-padL-padR, plotH=H-padT-padB, n=periods.length;
  const x = i=>padL+(n<=1?plotW/2:i/(n-1)*plotW), y = v=>padT+plotH-Math.min(v,yMax)/yMax*plotH;
  let svg = `<svg class="hd-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Tren indeks ${aqiStdLabel()} per site">`;
  cats.forEach(c=>{ if(c.lo>yMax) return; const y0 = y(Math.min(c.hi,yMax)), y1 = y(c.lo); svg += `<rect x="${padL}" y="${y0.toFixed(1)}" width="${plotW}" height="${(y1-y0).toFixed(1)}" fill="${c.color}" opacity=".13"/><text x="${padL+6}" y="${(y0+12).toFixed(1)}" class="hd-axis" opacity=".8">${escHtml(c.name.split(" (")[0])}</text>`; });
  for(let g=0; g<=4; g++){ const v = yMax*g/4, yy = y(v); svg += `<line x1="${padL}" y1="${yy.toFixed(1)}" x2="${W-padR}" y2="${yy.toFixed(1)}" class="hd-grid"/><text x="${padL-8}" y="${(yy+4).toFixed(1)}" text-anchor="end" class="hd-axis">${Math.round(v)}</text>`; }
  periods.forEach((p,i)=>{ svg += `<text x="${x(i).toFixed(1)}" y="${H-12}" text-anchor="middle" class="hd-axis ${i===n-1?"strong":""}">${p}</text>`; });
  series.forEach(s=>{
    const pts = s.values.map((v,i)=>v==null?null:[i,v]).filter(Boolean);
    for(let k=1;k<pts.length;k++){ const [i0,v0]=pts[k-1],[i1,v1]=pts[k]; svg += `<line x1="${x(i0).toFixed(1)}" y1="${y(v0).toFixed(1)}" x2="${x(i1).toFixed(1)}" y2="${y(v1).toFixed(1)}" stroke="${s.color}" stroke-width="2.4" stroke-linecap="round"/>`; }
    pts.forEach(([i,v])=>{ const c = aqiIspuCategoryFor(v, aqiIspuStandard); svg += `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="5" fill="${c.color}" stroke="${s.color}" stroke-width="2"><title>${escHtml(s.key)} · ${periods[i]}: ${v} (${escHtml(c.name)})</title></circle>`; });
  });
  const labels = series.map(s=>{ const pts = s.values.map((v,i)=>v==null?null:[i,v]).filter(Boolean); const lv = pts[pts.length-1][1]; return {s, y:y(lv), v:lv}; }).sort((a,b)=>a.y-b.y);
  for(let i=1;i<labels.length;i++) if(labels[i].y-labels[i-1].y<14) labels[i].y = labels[i-1].y+14;
  const ov = labels.length ? labels[labels.length-1].y-(padT+plotH) : 0; if(ov>0) labels.forEach(l=>{ l.y -= ov; });
  labels.forEach(l=>{ svg += `<text x="${W-padR+10}" y="${(l.y+4).toFixed(1)}" class="hd-end-label" fill="${l.s.color}">${escHtml(l.s.key)} ${l.v}</text>`; });
  svg += `</svg>`;
  return svg + `<div class="legend">${series.map(s=>`<span class="item"><span class="sw" style="background:${s.color}"></span>${escHtml(s.key)}</span>`).join("")}<span class="item muted">Nilai = indeks tertinggi antar titik di site tsb pada periode itu. Latar = pita kategori.</span></div>`;
}
function aqiPeriodStackHtml(events, periods){
  const cats = aqiCats();
  return periods.map(p=>{
    const ev = events.filter(e=>e.periode===p), tot = ev.length;
    if(!tot) return "";
    const cnt = {}; ev.forEach(e=>{ cnt[e.category.name] = (cnt[e.category.name]||0)+1; });
    return `<div class="aqi-stackrow"><span class="aqi-stack-p">${p}</span><div class="hd-stack">${cats.filter(c=>cnt[c.name]).map(c=>`<i style="width:${(cnt[c.name]/tot*100).toFixed(1)}%;background:${c.color}" title="${escHtml(c.name)}: ${cnt[c.name]}"></i>`).join("")}</div><small>${tot} titik</small></div>`;
  }).join("") + `<div class="legend" style="margin-top:10px;">${cats.map(c=>`<span class="item"><span class="sw" style="background:${c.color}"></span>${escHtml(c.name)}</span>`).join("")}</div>`;
}

/* ---------- Pembanding model global: CAMS (Copernicus) via Open-Meteo Air Quality API ----------
   Open data (CC BY 4.0), tanpa API key, bisa dipanggil langsung dari browser. Ini data MODEL
   (grid global ±40 km), bukan stasiun pemantau — dipakai sbg pembanding/konteks, bukan pengganti
   hasil laboratorium. WAQI/aqicn & IQAir API butuh token pribadi sehingga tidak dipakai di sini. */
const AQI_OM_URL = "https://air-quality-api.open-meteo.com/v1/air-quality";
const AQI_OM_MAP = {"PM2.5":"pm2_5", "PM10":"pm10", "CO":"carbon_monoxide", "NOx":"nitrogen_dioxide", "SO2":"sulphur_dioxide", "O3":"ozone"};
let aqiOm = {curStatus:"idle", cur:{}, curAt:null, curErr:"", ev:{}};
function aqiSiteCoord(site){
  const pts = Object.entries(DB.pointCoords||{}).filter(([k])=>k.startsWith(site+"::")).map(([,v])=>v).filter(v=>Array.isArray(v));
  if(!pts.length) return null;
  return [pts.reduce((a,p)=>a+p[0],0)/pts.length, pts.reduce((a,p)=>a+p[1],0)/pts.length];
}
function aqiEventCoord(ev){ return (DB.pointCoords||{})[ev.site+"::"+ev.titik] || aqiSiteCoord(ev.site); }
async function aqiOmLoadCurrent(force){
  if(aqiOm.curStatus==="loading" || (aqiOm.curStatus==="ok" && !force)) return;
  const sites = [...new Set((DB.hasilAmbien.ambien||[]).map(r=>r.site))].sort().map(s=>({s, c:aqiSiteCoord(s)})).filter(x=>x.c);
  if(!sites.length){ aqiOm.curStatus = "error"; aqiOm.curErr = "Belum ada koordinat titik ambient."; aqiRenderCompare(); return; }
  aqiOm.curStatus = "loading"; aqiRenderCompare();
  const vars = ["us_aqi","pm2_5","pm10","carbon_monoxide","nitrogen_dioxide","sulphur_dioxide","ozone"].join(",");
  const url = `${AQI_OM_URL}?latitude=${sites.map(x=>x.c[0].toFixed(4)).join(",")}&longitude=${sites.map(x=>x.c[1].toFixed(4)).join(",")}&current=${vars}&timezone=Asia%2FMakassar`;
  try{
    const res = await fetch(url);
    if(!res.ok) throw new Error("HTTP "+res.status);
    let js = await res.json();
    if(!Array.isArray(js)) js = [js];
    aqiOm.cur = {};
    sites.forEach((x,i)=>{ if(js[i] && js[i].current) aqiOm.cur[x.s] = js[i].current; });
    aqiOm.curAt = new Date(); aqiOm.curStatus = "ok";
  }catch(e){ aqiOm.curStatus = "error"; aqiOm.curErr = "Tidak bisa memuat data model ("+(e.message||e)+"). Pastikan perangkat terhubung internet."; }
  aqiRenderCompare();
}
async function aqiOmLoadEvent(ev){
  const key = ev.site+"::"+ev.titik+"::"+ev.periode;
  if(aqiOm.ev[key] && aqiOm.ev[key].status!=="error") return;
  const c = aqiEventCoord(ev);
  const date = String(ev.tanggal||"").slice(0,10);
  if(!c || !/^\d{4}-\d{2}-\d{2}$/.test(date)){ aqiOm.ev[key] = {status:"error", err:"Titik ini belum punya koordinat atau tanggal sampling."}; aqiRenderCompare(); return; }
  aqiOm.ev[key] = {status:"loading"}; aqiRenderCompare();
  const url = `${AQI_OM_URL}?latitude=${c[0].toFixed(4)}&longitude=${c[1].toFixed(4)}&hourly=${Object.values(AQI_OM_MAP).join(",")}&start_date=${date}&end_date=${date}&timezone=Asia%2FMakassar`;
  try{
    const res = await fetch(url);
    if(!res.ok) throw new Error("HTTP "+res.status);
    const js = await res.json();
    const h = js.hourly||{};
    const mean = {};
    Object.entries(AQI_OM_MAP).forEach(([pk,v])=>{ const a = (h[v]||[]).filter(x=>x!=null); mean[pk] = a.length ? a.reduce((s,x)=>s+x,0)/a.length : null; });
    aqiOm.ev[key] = {status:"ok", mean, date};
  }catch(e){ aqiOm.ev[key] = {status:"error", err:"Tidak bisa memuat data model ("+(e.message||e)+")."}; }
  aqiRenderCompare();
}
let aqiCompareEv = null;
function aqiRenderCompare(){
  const el = document.getElementById("aqiCompareWrap");
  if(!el) return;
  // A. Kondisi terkini per site (model).
  let cur;
  if(aqiOm.curStatus==="loading") cur = `<div class="hint" style="padding:10px 0;">Memuat data model terkini&hellip;</div>`;
  else if(aqiOm.curStatus==="error") cur = `<div class="hint" style="padding:10px 0;color:var(--hd-bad);">${escHtml(aqiOm.curErr)}</div>`;
  else if(aqiOm.curStatus==="ok"){
    cur = `<div class="aqi-live-grid">${Object.entries(aqiOm.cur).map(([s,v])=>{
      const conc = {"PM2.5":v.pm2_5, "PM10":v.pm10, "CO":v.carbon_monoxide, "NOx":v.nitrogen_dioxide, "SO2":v.sulphur_dioxide, "O3":v.ozone};
      const ev = aqiIspuComputeEvent({params:Object.fromEntries(Object.entries(conc).filter(([,x])=>x!=null))}, aqiIspuStandard);
      if(!ev) return "";
      return `<div class="aqi-live" style="--aqi-c:${ev.category.color};--aqi-t:${ev.category.text}">
        <div class="aqi-live-top"><span class="hd-site"><i style="background:${hdSiteColor(s)}"></i>${escHtml(s)}</span><span class="aqi-live-num">${ev.index}</span></div>
        <div class="aqi-live-cat">${escHtml(ev.category.name)}</div>
        <div class="aqi-live-sub">PM2.5 ${hdNum(v.pm2_5)} &middot; PM10 ${hdNum(v.pm10)} µg/m³ &middot; dominan ${escHtml(AQIISPU_POLLUTANT_LABEL[ev.dominant]||ev.dominant)}</div>
      </div>`;
    }).join("")}</div><div class="hint" style="margin:6px 0 0;">Diperbarui ${aqiOm.curAt?aqiOm.curAt.toLocaleString("id-ID",{dateStyle:"medium",timeStyle:"short"}):"-"} &middot; indeks ${aqiStdLabel()} dihitung dari konsentrasi model dengan rumus yang sama dengan hasil lab.</div>`;
  } else cur = `<div class="hint" style="padding:10px 0;">Klik "Muat kondisi terkini" untuk mengambil data model.</div>`;
  // B. Hasil sampling vs model pada tanggal sampling (titik terpilih).
  let cmp = "";
  const ev = aqiCompareEv;
  if(ev){
    const key = ev.site+"::"+ev.titik+"::"+ev.periode, st = aqiOm.ev[key];
    let body;
    if(!st) body = `<button class="btn small primary" data-action="aqiOmLoadEvent">Bandingkan dengan model pada ${escHtml(String(ev.tanggal||"").slice(0,10))}</button>`;
    else if(st.status==="loading") body = `<div class="hint">Memuat data model untuk tanggal sampling&hellip;</div>`;
    else if(st.status==="error") body = `<div class="hint" style="color:var(--hd-bad);">${escHtml(st.err)}</div> <button class="btn small" data-action="aqiOmLoadEvent">Coba lagi</button>`;
    else {
      const modelEv = aqiIspuComputeEvent({params:Object.fromEntries(Object.entries(st.mean).filter(([pk,x])=>x!=null && ev.params[pk]!=null))}, aqiIspuStandard);
      body = `<div class="tablewrap"><table class="dp-table"><thead><tr><th>Polutan</th><th class="num">Lab <span>(µg/m³)</span></th><th class="num">Model CAMS <span>(µg/m³, rerata 24 jam)</span></th><th class="num">Selisih</th><th>Indeks lab</th><th>Indeks model</th></tr></thead><tbody>
        ${AQI_POLLUTANT_ORDER.filter(pk=>ev.params[pk]!=null).map(pk=>{
          const lab = ev.params[pk], mod = st.mean[pk];
          const sl = aqiIspuSubIndex(pk, lab, aqiIspuStandard), sm = mod!=null ? aqiIspuSubIndex(pk, mod, aqiIspuStandard) : null;
          const d = mod!=null && mod>0 ? (lab-mod)/mod*100 : null;
          return `<tr><td><b>${escHtml(AQIISPU_POLLUTANT_LABEL[pk]||pk)}</b></td><td class="num">${hdNum(lab)}</td><td class="num">${mod!=null?hdNum(mod):"-"}</td><td class="num">${d==null?"-":hdSignedPct(d)}</td><td>${sl!=null?aqiPillHtml(sl):"-"}</td><td>${sm!=null?aqiPillHtml(sm):"-"}</td></tr>`;
        }).join("")}
        <tr><td colspan="4"><b>Indeks akhir</b> <span class="muted">(sub-indeks tertinggi)</span></td><td>${aqiPillHtml(ev.index)} <small class="muted">${escHtml(AQIISPU_POLLUTANT_LABEL[ev.dominant]||ev.dominant)}</small></td><td>${modelEv?aqiPillHtml(modelEv.index)+` <small class="muted">${escHtml(AQIISPU_POLLUTANT_LABEL[modelEv.dominant]||modelEv.dominant)}</small>`:"-"}</td></tr>
      </tbody></table></div>
      <div class="hint">Model = rata-rata 24 jam CAMS pada koordinat titik, ${escHtml(st.date)} (WITA). Hasil lab adalah pengukuran lokal; perbedaan besar wajar karena model beresolusi kasar dan tidak menangkap sumber lokal.</div>`;
    }
    cmp = `<div class="aqi-cmp"><div class="aqi-cmp-head"><b>Hasil sampling vs model</b> <span class="muted">&middot; ${escHtml(ev.titik)} (${escHtml(ev.site)}), ${escHtml(ev.tanggal||"-")}</span></div>${body}</div>`;
  }
  el.innerHTML = `<div class="aqi-cmp-bar"><b>Kondisi terkini per site (model)</b><span class="spacer"></span><button class="btn small" data-action="aqiOmLoadCurrent">${aqiOm.curStatus==="ok"?"Muat ulang":"Muat kondisi terkini"}</button></div>${cur}${cmp}`;
}

/* ---------- Render halaman ---------- */
function renderAqiIspu(){
  document.getElementById("aqiIspuStdAqiBtn").classList.toggle("active", aqiIspuStandard==="aqi");
  document.getElementById("aqiIspuStdIspuBtn").classList.toggle("active", aqiIspuStandard==="ispu");
  const scale = document.getElementById("aqiScaleBar"); if(scale) scale.innerHTML = aqiScaleBarHtml();

  const allEvents = aqiIspuGroupEvents().map(ev=>aqiIspuComputeEvent(ev, aqiIspuStandard)).filter(Boolean);
  const sites = [...new Set(allEvents.map(e=>e.site))].sort();
  const periods = [...new Set(allEvents.map(e=>e.periode))].sort((a,b)=>hasilPeriodParts(a).order-hasilPeriodParts(b).order);
  aqiIspuPopulateFilters(sites, periods);

  const fromOrder = aqiIspuFlt.from ? hasilPeriodParts(aqiIspuFlt.from).order : -Infinity;
  const toOrder = aqiIspuFlt.to ? hasilPeriodParts(aqiIspuFlt.to).order : Infinity;
  const filtered = allEvents.filter(ev=>(!aqiIspuFlt.site || ev.site===aqiIspuFlt.site) && ev.periodeOrder>=fromOrder && ev.periodeOrder<=toOrder)
    .sort((a,b)=>(a.tanggalSort||"").localeCompare(b.tanggalSort||""));
  const top = document.getElementById("aqiIspuTop"), body = document.getElementById("aqiIspuBody");
  if(!DB.hasilAmbien.ambien.length || !filtered.length){
    top.innerHTML = hdEmpty(DB.hasilAmbien.ambien.length ? "Tidak ada data pada filter ini." : `Belum ada data kategori "Udara Ambien" di Database Hasil Ambient — isi atau import data dulu, indeks akan otomatis terhitung dari situ.`);
    body.innerHTML = ""; return;
  }
  const fPeriods = [...new Set(filtered.map(e=>e.periode))].sort((a,b)=>hasilPeriodParts(a).order-hasilPeriodParts(b).order);
  const last = fPeriods[fPeriods.length-1];
  const lastEvents = filtered.filter(e=>e.periode===last).sort((a,b)=>b.index-a.index);
  if(!lastEvents.some(e=>(e.site+"::"+e.titik)===aqiSelKey)) aqiSelKey = lastEvents[0] ? lastEvents[0].site+"::"+lastEvents[0].titik : "";
  const sel = lastEvents.find(e=>(e.site+"::"+e.titik)===aqiSelKey) || lastEvents[0];
  aqiCompareEv = sel;
  const options = lastEvents.map(e=>({key:e.site+"::"+e.titik, label:`${e.titik} (${e.site}) — ${e.index}`}));

  // KPI
  const per = fPeriods.map(p=>{ const ev = filtered.filter(e=>e.periode===p); return {p, avg: hdMean(ev.map(e=>e.index)), good: ev.length?ev.filter(e=>e.index<=50).length/ev.length*100:null, bad: ev.filter(e=>e.index>100).length}; });
  const lastPer = per[per.length-1], prevPer = per.length>1 ? per[per.length-2] : null;
  const domCnt = {}; lastEvents.forEach(e=>{ domCnt[e.dominant]=(domCnt[e.dominant]||0)+1; });
  const domTop = Object.entries(domCnt).sort((a,b)=>b[1]-a[1])[0];
  const worst = filtered.reduce((a,b)=>b.index>a.index?b:a);
  const badAll = filtered.filter(e=>e.index>100);
  const kpis = [
    hdKpi({label:`Rata-rata ${aqiStdLabel()}`, icon:HD_IC.gauge, value: hdNum(lastPer.avg,0), tone: lastPer.avg<=50?"good":lastPer.avg<=100?"warn":"bad",
      spark: hdSpark(per.map(x=>x.avg), {color:"var(--heading-2)", label:"Rata-rata indeks per periode"}),
      foot: prevPer ? `${hdSignedPct((lastPer.avg-prevPer.avg)/prevPer.avg*100)} dibanding ${prevPer.p}` : `${last}`}),
    hdKpi({label:`Kategori ${aqiCats()[0].name.split(" (")[0]}`, icon:HD_IC.shield, value: hdPct(lastPer.good,0), tone: lastPer.good>=80?"good":"warn",
      spark: hdSpark(per.map(x=>x.good), {color:"#2f9e67", ref:100}), foot: `${lastEvents.filter(e=>e.index<=50).length} dari ${lastEvents.length} titik &middot; ${last}`}),
    hdKpi({label: aqiIspuStandard==="ispu"?"Tidak Sehat ke atas":"Unhealthy (SG) ke atas", icon:HD_IC.alert, value: hdNum(badAll.length,0), suffix:" event", tone: badAll.length?"bad":"",
      spark: hdSpark(per.map(x=>x.bad), {bars:true, color:"#b42318", zero:true}), foot: badAll.length ? `Terakhir: ${escHtml(badAll[badAll.length-1].titik)}, ${badAll[badAll.length-1].periode}` : "Tidak ada event di atas kategori sedang"}),
    hdKpi({label:"Indeks Tertinggi", icon:HD_IC.trend, value: worst.index, tone: worst.index>100?"bad":worst.index>50?"warn":"",
      foot: `${escHtml(worst.titik)} (${escHtml(worst.site)}) &middot; ${worst.periode} &middot; ${escHtml(AQIISPU_POLLUTANT_LABEL[worst.dominant]||worst.dominant)}`}),
    hdKpi({label:"Polutan Dominan", icon:HD_IC.spark, value: domTop?escHtml(AQIISPU_POLLUTANT_LABEL[domTop[0]]||domTop[0]):"-", foot: domTop?`Penentu indeks di ${domTop[1]} dari ${lastEvents.length} titik &middot; ${last}`:"-"}),
    hdKpi({label:"Titik Dipantau", icon:HD_IC.db, value: lastEvents.length, suffix:" titik", foot: `${new Set(lastEvents.map(e=>e.site)).size} site &middot; ${fPeriods.length} periode pada filter`})
  ].join("");

  top.innerHTML = `
    <div class="hd-kpis">${kpis}</div>
    <div class="aqi-main">
      <div class="aqi-main-left">
        ${aqiNowPanel(sel, options)}
        ${aqiAdviceHtml(sel)}
      </div>
      <div class="card aqi-main-right">
        <div class="cardhead"><div><h3>Polutan Udara</h3><div class="hint hd-sub">Konsentrasi tiap polutan pada ${escHtml(sel.titik)}, sub-indeks ${aqiStdLabel()}, dan perbandingan terhadap pedoman WHO 2021.</div></div></div>
        ${aqiPollutantGrid(sel)}
      </div>
    </div>
    <div class="hd-row">
      <div class="card hd-col-side aqi-rank-card">
        <div class="cardhead"><div><h3>Peringkat Titik &middot; ${last}</h3><div class="hint hd-sub">Dari indeks tertinggi. Klik nama titik untuk melihat detailnya di atas.</div></div></div>
        ${aqiRankingHtml(filtered, last)}
      </div>
      <div class="card hd-col-wide">
        <div class="cardhead"><div><h3>Pembanding Model Global &middot; CAMS</h3><div class="hint hd-sub">Data terbuka Copernicus Atmosphere Monitoring Service via Open-Meteo (CC BY 4.0), tanpa API key. Ini data <b>model</b> (grid ±40 km), bukan stasiun pemantau — gunakan sebagai konteks, bukan pengganti hasil laboratorium.</div></div></div>
        <div id="aqiCompareWrap"></div>
      </div>
    </div>`;

  body.innerHTML = `
    <div class="hd-row">
      <div class="card hd-col-wide">
        <div class="cardhead"><div><h3>Tren Indeks ${aqiStdLabel()} per Site</h3><div class="hint hd-sub">Indeks tertinggi tiap site per periode, dengan latar pita kategori.</div></div>
          <button class="btn small ghost" data-action="hdZoomChart" data-target="aqiTrendWrap" data-title="Tren Indeks per Site">Perbesar</button></div>
        <div id="aqiTrendWrap">${aqiTrendSvg(filtered, fPeriods)}</div>
      </div>
      <div class="card hd-col-side">
        <div class="cardhead"><div><h3>Komposisi Kategori per Periode</h3><div class="hint hd-sub">Proporsi titik di tiap kategori ${aqiStdLabel()}.</div></div></div>
        ${aqiPeriodStackHtml(filtered, fPeriods)}
      </div>
    </div>
    <div class="card">
      <div class="cardhead"><div><h3>Riwayat Seluruh Titik</h3><div class="hint hd-sub">Indeks tiap titik per semester; baca satu baris ke kanan untuk melihat tren. Arahkan kursor ke angka untuk tanggal &amp; polutan dominan.</div></div></div>
      ${aqiIspuBuildTrendTable(filtered, fPeriods)}
    </div>
    <div class="card">
      <div class="cardhead"><div><h3>Rincian Event Sampling</h3><div class="hint hd-sub">1 event = 1 titik dalam 1 periode, gabungan semua parameter yang diukur. Urut tanggal terbaru.</div></div></div>
      <div class="tablewrap"><table>${aqiIspuBuildTable(filtered.slice().sort((a,b)=>(b.tanggalSort||"").localeCompare(a.tanggalSort||"")).slice(0,200))}</table></div>
    </div>`;
  aqiRenderCompare();
  if(aqiOm.curStatus==="idle") aqiOmLoadCurrent();

  // Peta (elemen statis di markup supaya instance Leaflet tidak hilang saat render ulang)
  const mapScope = allEvents.filter(ev=> !aqiIspuFlt.site || ev.site===aqiIspuFlt.site);
  const mapPeriods = [...new Set(mapScope.map(e=>e.periode))].sort((a,b)=>hasilPeriodParts(a).order-hasilPeriodParts(b).order);
  const mapPeriode = (aqiIspuMapPeriode && mapPeriods.includes(aqiIspuMapPeriode)) ? aqiIspuMapPeriode : mapPeriods[mapPeriods.length-1];
  const mapEvents = mapScope.filter(ev=>ev.periode===mapPeriode);
  document.getElementById("aqiIspuMapPeriodeSel").innerHTML = mapPeriods.map(p=>`<option value="${p}" ${p===mapPeriode?"selected":""}>${p}</option>`).join("");
  aqiIspuInitMap();
  document.getElementById("aqiIspuMapLegend").innerHTML = aqiIspuLegendHtml(aqiIspuStandard);
  const noteEl = document.getElementById("aqiIspuMapNote");
  if(typeof L==="undefined") noteEl.textContent = "";
  else if(!mapEvents.length) noteEl.textContent = "Tidak ada event sampling pada periode/site ini.";
  else {
    const mappedN = aqiIspuDrawMapMarkers(mapEvents), missingN = mapEvents.length-mappedN;
    noteEl.textContent = missingN>0 ? `${mappedN} dari ${mapEvents.length} titik tampil di peta (${missingN} titik belum punya koordinat).` : `${mappedN} titik ditampilkan untuk periode ${mapPeriode}.`;
  }
}
function aqiIspuInfoModal(){
  function bpTableHtml(table, unit){
    return `<table style="font-size:11.5px;width:100%;"><thead><tr><th>Indeks</th><th>Konsentrasi (${unit})</th></tr></thead><tbody>
      ${table.map(([lo,hi,iLo,iHi])=>`<tr><td>${iLo}&ndash;${iHi}</td><td>${lo}&ndash;${hi}</td></tr>`).join("")}
    </tbody></table>`;
  }
  const aqiUnits = {"PM2.5":"µg/m³, 24 jam","PM10":"µg/m³, 24 jam","CO":"ppm, 8 jam","SO2":"ppb, 1 jam","NOx (sbg NO2)":"ppb, 1 jam","O3":"ppm, 8 jam"};
  const ispuUnits = {"PM10":"µg/m³, 24 jam","PM2.5":"µg/m³, 24 jam","SO2":"µg/m³","CO":"µg/m³","O3":"µg/m³","NOx (sbg NO2)":"µg/m³"};
  openModal(`
    <h3>&#8505;&#65039; Info Model AQI/ISPU &amp; Referensi</h3>
    <div style="max-height:65vh;overflow:auto;font-size:13px;line-height:1.65;">
      <p><b>Cara kerja:</b> tiap baris data parameter Udara Ambien (Database Hasil Ambient) dikelompokkan per titik+tanggal+periode jadi satu "event sampling". Untuk tiap parameter yang punya padanan standar (PM10, PM2.5, SO2, CO, O3, dan NOx yang diperlakukan sebagai pembacaan NO2), dihitung sub-indeks memakai rumus interpolasi resmi US EPA: <span style="font-family:var(--font-mono);">I&#8347; = ((I&#8341;i&minus;I&#8343;o)/(BP&#8341;i&minus;BP&#8343;o)) &times; (C&#8347;&minus;BP&#8343;o) + I&#8343;o</span>. Indeks akhir event = sub-indeks tertinggi ("parameter dominan") — standar dipakai kedua model (AQI maupun ISPU) sama sama memakai pendekatan pollutant dominan ini.</p>
      <p><b>Konversi satuan:</b> data di app ini disimpan seragam µg/Nm&sup3; utk semua parameter Udara Ambien. ISPU memakai µg/m&sup3; langsung (tanpa konversi). AQI (breakpoint resmi US EPA memakai ppm/ppb utk gas) dikonversi dari µg/m&sup3; ke ppm memakai volume molar 24,45 L/mol pada 25&deg;C/1&nbsp;atm: ppm = (µg/m&sup3;&divide;1000)&times;24,45&divide;BM (BM = berat molekul CO 28,01 / SO2 64,07 / NO2 46,01 / O3 48,00). Penyederhanaan: memakai pembulatan biasa, bukan pemotongan desimal presisi US EPA (PM2.5/CO 1 desimal, PM10/NO2/SO2 bilangan bulat, O3 3 desimal).</p>
      <div class="reg-divider">Standar AQI — US EPA (dipakai IQAir secara global, termasuk iqair.com/id)</div>
      <p class="hint" style="margin-top:-4px;">Kategori &amp; breakpoint resmi US EPA AQI Technical Assistance Document, termasuk revisi PM2.5 Mei 2024 (batas "Good" turun dari 12,0 ke 9,0 µg/m&sup3;).</p>
      <table style="font-size:12px;width:100%;margin-bottom:8px;"><thead><tr><th>Indeks</th><th>Kategori</th></tr></thead><tbody>
        ${AQI_CATEGORIES.map(c=>`<tr><td>${c.lo}&ndash;${c.hi}</td><td><span class="badge" style="background:${c.color};color:${c.text};">${escHtml(c.name)}</span></td></tr>`).join("")}
      </tbody></table>
      <div class="grid cols-3" style="gap:10px;">
        ${Object.keys(AQI_BREAKPOINTS).map((pk,i)=>{
          const label = pk==="NOx"?"NOx (sbg NO2)":pk;
          return `<div><b style="font-size:11.5px;">${label}</b><div class="hint" style="margin:2px 0 4px;">${aqiUnits[label]}</div>${bpTableHtml(AQI_BREAKPOINTS[pk], aqiUnits[label].split(",")[0])}</div>`;
        }).join("")}
      </div>
      <div class="reg-divider">Standar ISPU — Indonesia (Permen LHK No. P.14/MENLHK/SETJEN/KUM.1/7/2020)</div>
      <p class="hint" style="margin-top:-4px;">Basis nilai parameter PM10/SO2/CO/O3/NO2 mewarisi Kepdal No. 107 Tahun 1997; PM2.5 ditambahkan pada revisi 2020 (bersama HC yang tidak dipakai di sini krn app ini tidak mengumpulkan data HC/hidrokarbon total yang sepadan). <b>Breakpoint PM10 terverifikasi silang ke beberapa referensi publik (50/150/350/420/500 µg/m&sup3;); kategori &amp; warna resmi (Baik&#8211;Berbahaya, Hijau&#8211;Hitam) juga terverifikasi. Breakpoint parameter lain (SO2, CO, O3, NO2, PM2.5) direkonstruksi dari referensi terbaik yang bisa diakses sesi ini — ispu.menlhk.go.id &amp; jdih.menlhk.go.id tidak bisa diakses langsung dari sandbox tool ini. Mohon silangkan ke regulasi resmi sebelum dipakai pelaporan formal/AMDAL.</b></p>
      <table style="font-size:12px;width:100%;margin-bottom:8px;"><thead><tr><th>Indeks</th><th>Kategori</th></tr></thead><tbody>
        ${ISPU_CATEGORIES.map(c=>`<tr><td>${c.lo}&ndash;${c.hi}</td><td><span class="badge" style="background:${c.color};color:${c.text};">${escHtml(c.name)}</span></td></tr>`).join("")}
      </tbody></table>
      <div class="grid cols-3" style="gap:10px;">
        ${Object.keys(ISPU_BREAKPOINTS).map(pk=>{
          const label = pk==="NOx"?"NOx (sbg NO2)":pk;
          return `<div><b style="font-size:11.5px;">${label}</b><div class="hint" style="margin:2px 0 4px;">${ispuUnits[label]}</div>${bpTableHtml(ISPU_BREAKPOINTS[pk], "µg/m³")}</div>`;
        }).join("")}
      </div>
      <p class="hint" style="margin-top:10px;">Referensi: Permen LHK No. P.14/MENLHK/SETJEN/KUM.1/7/2020 tentang Indeks Standar Pencemar Udara; Kepdal No. 107 Tahun 1997; US EPA AQI Technical Assistance Document (revisi PM2.5 2024); metodologi AQI IQAir (iqair.com/id).</p>
    </div>
    <div class="actions"><button class="btn primary" data-action="closeModal">Tutup</button></div>
  `, {wide:true});
}
["aqiIspuFltSite","aqiIspuFltFrom","aqiIspuFltTo"].forEach(id=>{
  document.addEventListener("change", e=>{
    if(e.target.id!==id) return;
    if(id==="aqiIspuFltSite") aqiIspuFlt.site = e.target.value;
    if(id==="aqiIspuFltFrom") aqiIspuFlt.from = e.target.value;
    if(id==="aqiIspuFltTo") aqiIspuFlt.to = e.target.value;
    renderAqiIspu();
  });
});
document.addEventListener("change", e=>{
  if(e.target.id==="aqiIspuMapPeriodeSel"){ aqiIspuMapPeriode = e.target.value; renderAqiIspu(); }
});
document.addEventListener("change", e=>{
  if(e.target.id==="aqiSelTitik"){ aqiSelKey = e.target.value; renderAqiIspu(); }
});
Object.assign(ACTIONS, {
  aqiIspuInfoModal,
  aqiIspuSetStandard:(t)=>{ aqiIspuStandard = t.dataset.std; renderAqiIspu(); },
  aqiPickTitik:(t)=>{ aqiSelKey = t.dataset.key; renderAqiIspu(); document.getElementById("aqiIspuTop")?.scrollIntoView({behavior:"smooth", block:"start"}); },
  aqiOmLoadCurrent:()=>aqiOmLoadCurrent(true),
  aqiOmLoadEvent:()=>{ if(aqiCompareEv) aqiOmLoadEvent(aqiCompareEv); }
});
