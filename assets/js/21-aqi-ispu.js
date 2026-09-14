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
// "Visual per tanggal sampling": 1 baris per site, tiap event sampling digambar sbg lingkaran
// berwarna sesuai kategori, urut kronologis — hover utk detail titik/tanggal/indeks.
function aqiIspuBuildTimeline(events){
  if(!events.length) return "<div class='hint' style='padding:14px;'>Tidak ada data sampling pada filter ini.</div>";
  const bySite = {};
  events.forEach(ev=>{ (bySite[ev.site]=bySite[ev.site]||[]).push(ev); });
  const sites = Object.keys(bySite).sort();
  const rowH=44, padL=118, padR=20, padT=14, dotGap=34;
  const maxCols = Math.max(...sites.map(s=>bySite[s].length));
  const W = Math.max(560, padL + maxCols*dotGap + padR);
  const H = padT + sites.length*rowH + 6;
  let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;font-size:10px;background:var(--surface-card);border:1px solid var(--gray-200);border-radius:10px;">`;
  sites.forEach((site,ri)=>{
    const y = padT + ri*rowH + rowH/2;
    const evs = bySite[site].slice().sort((a,b)=>(a.tanggalSort||"").localeCompare(b.tanggalSort||""));
    svg += `<text x="10" y="${y+4}" font-weight="700" fill="var(--gray-900)" font-size="11">${escHtml(site)}</text>`;
    if(ri>0) svg += `<line x1="0" y1="${padT+ri*rowH}" x2="${W}" y2="${padT+ri*rowH}" stroke="var(--gray-200)"/>`;
    evs.forEach((ev,ci)=>{
      const x = padL + ci*dotGap + 15;
      const cat = ev.category;
      svg += `<circle cx="${x}" cy="${y}" r="11" fill="${cat.color}" stroke="var(--surface-card)" stroke-width="1.5"><title>${escHtml(ev.titik)} — ${ev.tanggal||"-"} (${ev.periode})\nIndeks: ${ev.index} — ${cat.name}\nParameter dominan: ${AQIISPU_POLLUTANT_LABEL[ev.dominant]||ev.dominant}</title></circle>`;
      svg += `<text x="${x}" y="${y+3.5}" text-anchor="middle" font-size="8.5" font-weight="800" fill="${cat.text}" style="pointer-events:none;">${ev.index}</text>`;
    });
  });
  svg += `</svg>`;
  return svg;
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
function renderAqiIspu(){
  document.getElementById("aqiIspuStdAqiBtn").classList.toggle("active", aqiIspuStandard==="aqi");
  document.getElementById("aqiIspuStdIspuBtn").classList.toggle("active", aqiIspuStandard==="ispu");

  const allEvents = aqiIspuGroupEvents().map(ev=>aqiIspuComputeEvent(ev, aqiIspuStandard)).filter(Boolean);
  const sites = [...new Set(allEvents.map(e=>e.site))].sort();
  const periods = [...new Set(allEvents.map(e=>e.periode))].sort((a,b)=>hasilPeriodParts(a).order-hasilPeriodParts(b).order);
  aqiIspuPopulateFilters(sites, periods);

  const fromOrder = aqiIspuFlt.from ? hasilPeriodParts(aqiIspuFlt.from).order : -Infinity;
  const toOrder = aqiIspuFlt.to ? hasilPeriodParts(aqiIspuFlt.to).order : Infinity;
  const filtered = allEvents.filter(ev=>{
    if(aqiIspuFlt.site && ev.site!==aqiIspuFlt.site) return false;
    return ev.periodeOrder>=fromOrder && ev.periodeOrder<=toOrder;
  }).sort((a,b)=>(a.tanggalSort||"").localeCompare(b.tanggalSort||""));

  if(!DB.hasilAmbien.ambien.length){
    document.getElementById("aqiIspuBody").innerHTML = `<div class="card"><div class="hint" style="padding:14px;">Belum ada data kategori "Udara Ambien" di Database Hasil Ambient — isi atau import data dulu, indeks akan otomatis terhitung dari situ.</div></div>`;
    return;
  }

  const goodN = filtered.filter(ev=>ev.index<=50).length;
  const badN = filtered.filter(ev=>ev.index>100).length;
  const avgIndex = filtered.length ? Math.round(filtered.reduce((a,b)=>a+b.index,0)/filtered.length) : null;
  const worst = filtered.length ? filtered.reduce((a,b)=> b.index>a.index?b:a) : null;

  const cats = aqiIspuStandard==="ispu" ? ISPU_CATEGORIES : AQI_CATEGORIES;
  const catCounts = {}; filtered.forEach(ev=>{ catCounts[ev.category.name]=(catCounts[ev.category.name]||0)+1; });
  const donutSeg = cats.map(c=>[c.name, catCounts[c.name]||0, c.color]).filter(s=>s[1]>0);
  const donut = ambBuildDonut(donutSeg, filtered.length?Math.round(goodN/filtered.length*100)+"%":"-", cats[0].name.split(" ")[0]);

  const lastPeriod = periods[periods.length-1];
  const rankRows = filtered.filter(ev=>ev.periode===lastPeriod).sort((a,b)=>b.index-a.index).slice(0,15)
    .map(ev=>({titik:ev.titik, index:ev.index, standard:aqiIspuStandard}));

  const detail = filtered.slice().sort((a,b)=>(b.tanggalSort||"").localeCompare(a.tanggalSort||"")).slice(0,200);
  const stdLabel = aqiIspuStandard==="ispu" ? "ISPU" : "AQI";

  // Peta selalu pakai HANYA data pada filter Site aktif (tapi TIDAK ikut filter Dari/Sampai Periode
  // — peta punya selector periode sendiri) supaya bisa lihat sebaran periode manapun tanpa perlu
  // ubah filter atas dulu.
  const mapScope = allEvents.filter(ev=> !aqiIspuFlt.site || ev.site===aqiIspuFlt.site);
  const mapPeriods = [...new Set(mapScope.map(e=>e.periode))].sort((a,b)=>hasilPeriodParts(a).order-hasilPeriodParts(b).order);
  const mapPeriode = (aqiIspuMapPeriode && mapPeriods.includes(aqiIspuMapPeriode)) ? aqiIspuMapPeriode : mapPeriods[mapPeriods.length-1];
  const mapEvents = mapScope.filter(ev=>ev.periode===mapPeriode);
  const mapPeriodeSel = document.getElementById("aqiIspuMapPeriodeSel");
  mapPeriodeSel.innerHTML = mapPeriods.map(p=>`<option value="${p}" ${p===mapPeriode?"selected":""}>${p}</option>`).join("");

  document.getElementById("aqiIspuBody").innerHTML = `
    <div class="grid cols-4" style="margin-bottom:16px;">
      <div class="stat"><div class="num">${filtered.length}</div><div class="lbl">Event Sampling Terfilter</div></div>
      <div class="stat ${avgIndex==null?'':(avgIndex<=50?'good':avgIndex<=100?'warn':'bad')}"><div class="num">${avgIndex!=null?avgIndex:"-"}</div><div class="lbl">Rata Rata Indeks ${stdLabel}</div></div>
      <div class="stat ${filtered.length && goodN/filtered.length>=0.8?'good':'warn'}"><div class="num">${filtered.length?Math.round(goodN/filtered.length*100)+"%":"-"}</div><div class="lbl">Proporsi Kategori Terbaik</div></div>
      <div class="stat ${badN>0?'bad':'good'}"><div class="num">${badN}</div><div class="lbl">Event ${aqiIspuStandard==="ispu"?"Tidak Sehat+":"Unhealthy+"}</div></div>
    </div>
    <div class="card">
      <h3>Riwayat Seluruh Titik (Timeline) <span class="muted" style="text-transform:none;font-weight:400;">— tiap titik berwarna sesuai kategori ${stdLabel} hasil sampling hari itu</span></h3>
      <div class="hint" style="margin-top:-6px;margin-bottom:8px;">Arahkan kursor ke tiap titik untuk detail (titik, tanggal, indeks, parameter dominan). Diurutkan kronologis per site.</div>
      ${aqiIspuBuildTimeline(filtered)}
      ${aqiIspuLegendHtml(aqiIspuStandard)}
    </div>
    <div class="grid cols-2">
      <div class="card"><h3>Distribusi Kategori ${stdLabel}</h3>
        <div>${donut.svg}</div><div class="legend">${donut.legend}</div>
      </div>
      <div class="card"><h3>Peringkat Titik Berdasarkan Indeks ${stdLabel} <span class="muted" style="text-transform:none;font-weight:400;">(periode terakhir: ${lastPeriod||"-"})</span></h3>
        ${aqiIspuBuildRankChart(rankRows)}
      </div>
    </div>
    ${worst ? `<div class="card"><h3>Kondisi Terburuk pada Filter Ini</h3>
      <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
        <span class="badge" style="background:${worst.category.color};color:${worst.category.text};font-size:13px;padding:6px 12px;">${escHtml(worst.category.name)}</span>
        <div style="font-size:13px;">
          <b>${escHtml(worst.titik)}</b> (${worst.site}) — ${worst.tanggal||"-"} (${worst.periode})<br>
          <span class="muted">Indeks ${stdLabel}: <b>${worst.index}</b> — parameter dominan ${AQIISPU_POLLUTANT_LABEL[worst.dominant]||worst.dominant}</span>
        </div>
      </div>
    </div>` : ""}
    <div class="card"><h3>Rincian Event Sampling</h3>
      <div class="tablewrap"><table>${aqiIspuBuildTable(detail)}</table></div>
      <div class="hint">Menampilkan ${detail.length} dari ${filtered.length} event sampling (1 event = 1 titik + 1 tanggal, gabungan semua parameter yang diukur hari itu), urut tanggal terbaru.</div>
    </div>
  `;

  aqiIspuInitMap();
  document.getElementById("aqiIspuMapLegend").innerHTML = aqiIspuLegendHtml(aqiIspuStandard);
  const noteEl = document.getElementById("aqiIspuMapNote");
  if(typeof L==="undefined"){
    noteEl.textContent = "";
  } else if(!mapEvents.length){
    noteEl.textContent = "Tidak ada event sampling pada periode/site ini.";
  } else {
    const mappedN = aqiIspuDrawMapMarkers(mapEvents);
    const missingN = mapEvents.length - mappedN;
    noteEl.textContent = missingN>0
      ? `${mappedN} dari ${mapEvents.length} titik tampil di peta (${missingN} titik belum punya koordinat, tetap ada di tabel rincian di bawah).`
      : `${mappedN} titik ditampilkan untuk periode ${mapPeriode}.`;
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
Object.assign(ACTIONS, {
  aqiIspuInfoModal,
  aqiIspuSetStandard:(t)=>{ aqiIspuStandard = t.dataset.std; renderAqiIspu(); }
});
