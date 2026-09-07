/* =========================================================
   MODEL DISPERSI EMISI — Gaussian plume per titik cerobong, dibangun di atas data riil:
   DB.points (kategori emisi), DB.hasilPemantauan (konsentrasi + Laju Alir (v) + running hour),
   dan DB.pointCoords. Tidak ada data sintetis — titik tanpa koordinat atau tanpa data sampling
   parameter+laju alir pada periode terpilih otomatis dilewati (tidak dipaksakan/di-dummy-kan).

   Fisika: Gaussian plume ground-level standar (dengan refleksi tanah) + koefisien sigma-y/sigma-z
   pendekatan Briggs (rural power-law) per kelas stabilitas Pasquill-Gifford A-F — sama seperti
   basis screening model AERMOD/ISCST3 versi sederhana. Mode "Live" = satu snapshot arah+kecepatan
   angin (kerucut sempit). Mode "Periode" = superposisi 16 sektor arah angin historis (Open-Meteo),
   dibobot frekuensi kejadian tiap sektor — inilah yang menghasilkan bentuk kipas melebar & natural.
========================================================= */

/* ---------- Parameter pencemar yang dimodelkan sebagai plume (butuh konsentrasi mg/Nm3 di
   cerobong + laju alir gas buang) ---------- */
const DISPERSI_MASS_PARAMS = {
  "NOx": {label:"NOx", desc:"Nitrogen oksida (NO+NO₂) — produk pembakaran suhu tinggi; kontributor hujan asam & pembentukan ozon troposfer."},
  "SO₂": {label:"SO₂", desc:"Sulfur dioksida — dari bahan bakar bersulfur; penyebab utama hujan asam & iritasi saluran pernapasan."},
  "CO": {label:"CO", desc:"Karbon monoksida — produk pembakaran tidak sempurna; mengikat hemoglobin darah."},
  "Total Partikulat": {label:"Partikulat (TSP)", desc:"Partikel padat/cair tersuspensi di udara — berdampak pada sistem pernapasan & visibilitas."}
};
// Ikut dicek kepatuhannya (tabel Laporan Kepatuhan) tapi TIDAK dimodelkan sebagai plume massa —
// Opasitas cuma kepekatan visual (%), bukan besaran massa. H2S/"Pemantauan Kandungan Sulfur Bahan
// Bakar" SENGAJA tidak diikutkan di halaman ini sama sekali: itu uji kadar sulfur BAHAN BAKAR (%
// berat, bukan konsentrasi di keluaran cerobong) sesuai Pasal 12 ayat (2) huruf b Permen LH 13/2009,
// jadi bukan fenomena dispersi cerobong seperti 4 parameter di atas — lihat Dashboard Hasil
// Pemantauan untuk data itu.
const DISPERSI_COMPLIANCE_EXTRA = ["Opasitas"];

/* ---------- Pengelompokan jenis sumber (utk warna & default geometri cerobong) dari 17 nilai
   kategoriSumber riil yang jauh lebih rinci dari sekadar 6-7 tipe generik ---------- */
const DISPERSI_ENGINE_TYPE_RULES = [
  {test:/flare/i, key:"Flare", color:"#e0554f", height:18, diameter:0.6},
  {test:/turbine/i, key:"Turbine", color:"#e8a33d", height:12, diameter:1.0},
  {test:/glycol|heater|reboiler/i, key:"Heater/Reboiler", color:"#5c3f9e", height:10, diameter:0.7},
  {test:/emergency/i, key:"Emergency Engine", color:"#9c3269", height:6, diameter:0.4},
  {test:/diesel/i, key:"Diesel", color:"#8a5c11", height:6, diameter:0.4},
  {test:/gas/i, key:"Gas Engine/Compressor", color:"#0ea5a0", height:8, diameter:0.5},
  {test:/pump|compressor/i, key:"Pompa/Kompresor Lain", color:"#3d78c9", height:7, diameter:0.4}
];
const DISPERSI_ENGINE_TYPE_DEFAULT = {key:"Lainnya", color:"#7f8fa0", height:8, diameter:0.5};
function dispersiEngineType(kategoriSumber){
  const k = kategoriSumber||"";
  return DISPERSI_ENGINE_TYPE_RULES.find(r=>r.test.test(k)) || DISPERSI_ENGINE_TYPE_DEFAULT;
}

/* ---------- Kelas stabilitas atmosfer Pasquill-Gifford ---------- */
const DISPERSI_STABILITY_CLASSES = [
  {key:"A", label:"A — Sangat Tidak Stabil"}, {key:"B", label:"B — Tidak Stabil"},
  {key:"C", label:"C — Agak Tidak Stabil"}, {key:"D", label:"D — Netral (umum siang berangin)"},
  {key:"E", label:"E — Agak Stabil"}, {key:"F", label:"F — Stabil (umum malam tenang)"}
];

/* ---------- Fisika dispersi Gaussian (Briggs rural power-law, sama seperti basis screening
   model AERMOD/ISCST3 sederhana) — murni matematika, tidak menyentuh DB sama sekali ---------- */
function dispersiSigmaYZ(stabKey, x){
  const sy = ({A:0.22,B:0.16,C:0.11,D:0.08,E:0.06,F:0.04})[stabKey] * x * Math.pow(1+0.0001*x,-0.5);
  let sz;
  if(stabKey==="A") sz = 0.20*x;
  else if(stabKey==="B") sz = 0.12*x;
  else if(stabKey==="C") sz = 0.08*x*Math.pow(1+0.0002*x,-0.5);
  else if(stabKey==="D") sz = 0.06*x*Math.pow(1+0.0015*x,-0.5);
  else if(stabKey==="E") sz = 0.03*x*Math.pow(1+0.0003*x,-1);
  else sz = 0.016*x*Math.pow(1+0.0003*x,-1);
  return {sy: Math.max(sy,1), sz: Math.max(sz,1)};
}
// Ground-level Gaussian plume DENGAN refleksi tanah (bentuk baku: 2x istilah refleksi terlipat jadi
// koefisien pi, bukan 2*pi) — Qgs g/s, u m/s, sy/sz/He/y meter, hasil ug/m3.
function dispersiGroundConc(Qgs, u, sy, sz, He, y){
  if(u<=0.3) u = 0.3;
  const c = Qgs/(Math.PI*u*sy*sz) * Math.exp(-(y*y)/(2*sy*sy)) * Math.exp(-(He*He)/(2*sz*sz));
  return c*1e6; // g/m3 -> ug/m3
}
function dispersiMetersPerDegLat(){ return 110540; }
function dispersiMetersPerDegLng(lat){ return 111320*Math.cos(lat*Math.PI/180); }
function dispersiToLocalXY(lat,lng,originLat,originLng){
  return {dx:(lng-originLng)*dispersiMetersPerDegLng(originLat), dy:(lat-originLat)*dispersiMetersPerDegLat()};
}
function dispersiToLatLng(dx,dy,originLat,originLng){
  return {lat: originLat + dy/dispersiMetersPerDegLat(), lng: originLng + dx/dispersiMetersPerDegLng(originLat)};
}
function dispersiPlumeBearing(windDirFromDeg){ return (windDirFromDeg+180)%360; }
function dispersiRotateToPlume(dx,dy,bearingDeg){
  const th = bearingDeg*Math.PI/180;
  return { x: dx*Math.sin(th)+dy*Math.cos(th), y: dx*Math.cos(th)-dy*Math.sin(th) };
}
const DISPERSI_COLOR_STOPS = [[0,[13,31,56]],[0.12,[45,120,150]],[0.28,[14,165,160]],[0.48,[90,200,90]],[0.65,[232,214,60]],[0.82,[232,140,50]],[1,[224,40,30]]];
function dispersiColorForFrac(f){
  f = Math.max(0, Math.min(1, f));
  for(let i=0;i<DISPERSI_COLOR_STOPS.length-1;i++){
    const [f0,c0] = DISPERSI_COLOR_STOPS[i], [f1,c1] = DISPERSI_COLOR_STOPS[i+1];
    if(f>=f0 && f<=f1){
      const t = f1===f0?0:(f-f0)/(f1-f0);
      return [0,1,2].map(k=>Math.round(c0[k]+(c1[k]-c0[k])*t));
    }
  }
  return DISPERSI_COLOR_STOPS[DISPERSI_COLOR_STOPS.length-1][1];
}
const DISPERSI_COMPASS8 = ["N","NE","E","SE","S","SW","W","NW"];
function dispersiCompassLabel(deg){ return DISPERSI_COMPASS8[Math.round(deg/45)%8]; }
const DISPERSI_COMPASS16 = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
function dispersiCompassLabel16(deg){ return DISPERSI_COMPASS16[Math.round(deg/22.5)%16]; }
function dispersiFmt(n, decimals){
  if(n==null || !isFinite(n)) return "—";
  return n.toLocaleString("id-ID", {minimumFractionDigits:decimals==null?1:decimals, maximumFractionDigits:decimals==null?1:decimals});
}

/* ---------- Adapter data riil: DB.points + DB.pointCoords + DB.hasilPemantauan ----------
   engineId pada DB.hasilPemantauan = DB.points.id (dipastikan match 1:1, lihat verifikasi data). */
function dispersiStacks(){
  return DB.points.filter(p=>p.kategori==="emisi").map(p=>{
    const coord = DB.pointCoords[p.site+"::"+p.nama];
    if(!coord) return null;
    const tipe = dispersiEngineType(p.kategoriSumber);
    return {
      id: p.id, nama: p.nama, site: p.site, kategoriSumber: p.kategoriSumber,
      lat: coord[0], lng: coord[1], tipe,
      stackHeight: p.stackHeight!=null ? p.stackHeight : tipe.height,
      stackHeightIsDefault: p.stackHeight==null,
      stackDiameter: p.stackDiameter!=null ? p.stackDiameter : tipe.diameter,
      stackDiameterIsDefault: p.stackDiameter==null
    };
  }).filter(Boolean);
}
function dispersiSiteList(){
  return [...new Set(dispersiStacks().map(s=>s.site))].sort();
}
function dispersiSiteCenter(site, stacksAtSite){
  const list = stacksAtSite || dispersiStacks().filter(s=>s.site===site);
  if(!list.length) return null;
  return {
    lat: list.reduce((a,s)=>a+s.lat,0)/list.length,
    lng: list.reduce((a,s)=>a+s.lng,0)/list.length
  };
}
// Semua periode sampling riil yang ada di data, terurut lama->baru, plus opsi agregat "Tahun"
// (rata-rata S1+S2) utk tahun yang punya kedua semesternya — begini cara "bulanan maupun
// tahunan" dilihat, tanpa berpura-pura data ini tersedia per bulan kalender (aslinya per semester).
function dispersiPeriodList(){
  const seen = new Map();
  DB.hasilPemantauan.forEach(r=>{ if(r.periode && !seen.has(r.periode)) seen.set(r.periode, r.periodeOrder); });
  return [...seen.entries()].map(([periode,order])=>({periode,order})).sort((a,b)=>a.order-b.order);
}
function dispersiYearList(){
  const years = new Map();
  dispersiPeriodList().forEach(({periode})=>{
    const {sem,tahun} = hasilPeriodParts(periode);
    if(tahun==null) return;
    if(!years.has(tahun)) years.set(tahun, new Set());
    years.get(tahun).add(sem);
  });
  return [...years.entries()].map(([tahun,sems])=>({tahun, periods:[...sems].sort().map(s=>`S${s} ${tahun}`)})).sort((a,b)=>a.tahun-b.tahun);
}
// sel: "S1 2026" (periode tunggal) atau "Y:2026" (agregat tahun) -> {type, periods:[...]}
function dispersiResolveSelection(sel){
  if(!sel) return null;
  if(sel.indexOf("Y:")===0){
    const tahun = Number(sel.slice(2));
    const y = dispersiYearList().find(x=>x.tahun===tahun);
    return {type:"year", tahun, periods: y?y.periods:[]};
  }
  return {type:"periode", periode:sel, periods:[sel]};
}
function dispersiSelectionLabel(sel){
  const r = dispersiResolveSelection(sel);
  if(!r) return "—";
  return r.type==="year" ? `Tahun ${r.tahun} (rata-rata ${r.periods.join(" + ")})` : r.periode;
}
function dispersiFlowRecord(engineId, periode){
  return DB.hasilPemantauan.find(r=>r.engineId===engineId && r.periode===periode && r.parameter==="Laju Alir (v)") || null;
}
function dispersiParamRecord(engineId, param, periode){
  return DB.hasilPemantauan.find(r=>r.engineId===engineId && r.periode===periode && r.parameter===param) || null;
}
// g/s dari konsentrasi (mg/Nm3) x laju alir tercatat (m3/s, diperlakukan setara Nm3/s —
// penyederhanaan yang ditandai transparan di UI, bukan normalisasi suhu/tekanan penuh).
function dispersiEmissionRateGs(concRec, flowRec){
  if(!concRec || !flowRec || concRec.resultNumeric==null || flowRec.resultNumeric==null) return null;
  return concRec.resultNumeric * flowRec.resultNumeric / 1000;
}
// Hasil lengkap 1 stack+param pada SATU periode literal (bukan agregat tahun) — null kalau
// datanya memang tidak ada (konsentrasi atau laju alir tidak tercatat pada periode itu).
function dispersiBebanSinglePeriode(stack, param, periode){
  const concRec = dispersiParamRecord(stack.id, param, periode);
  const flowRec = dispersiFlowRecord(stack.id, periode);
  const Qgs = dispersiEmissionRateGs(concRec, flowRec);
  if(Qgs==null) return null;
  const runningHour = concRec.runningHour!=null ? concRec.runningHour : (flowRec.runningHour!=null ? flowRec.runningHour : null);
  const bebanJamKg = Qgs*3.6;
  const bebanTahunKg = runningHour!=null ? bebanJamKg*runningHour : null;
  return {
    stack, param, periode, concRec, flowRec, Qgs, runningHour, bebanJamKg,
    bebanBulanKg: bebanTahunKg!=null ? bebanTahunKg/12 : null,
    bebanTahunKg, bebanTahunTon: bebanTahunKg!=null ? bebanTahunKg/1000 : null
  };
}
// Hasil utk 1 stack+param mengikuti SELEKSI periode (periode tunggal ATAU agregat tahun — kalau
// tahun, rata-ratakan tiap besaran dari semester yang datanya ada; kalau tidak satupun semester
// punya data, null — "biarin", tidak dipaksakan). complianceRef selalu memakai periode PALING
// BARU di antara yang tersedia (status kepatuhan itu kategorikal, tidak masuk akal dirata-rata).
function dispersiBebanForSelection(stack, param, sel){
  const results = sel.periods.map(p=>dispersiBebanSinglePeriode(stack, param, p)).filter(Boolean);
  if(!results.length) return null;
  const avg = (key)=>{
    const vals = results.map(r=>r[key]).filter(v=>v!=null);
    return vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : null;
  };
  return {
    stack, param, sel, results, latest: results[results.length-1],
    concLabel: results.length>1 ? results.map(r=>dispersiFmt(r.concRec.resultNumeric,1)).join(" / ") : dispersiFmt(results[0].concRec.resultNumeric,1),
    unit: results[0].concRec.unit,
    flowLabel: results.length>1 ? results.map(r=>dispersiFmt(r.flowRec.resultNumeric,1)).join(" / ") : dispersiFmt(results[0].flowRec.resultNumeric,1),
    runningHour: avg("runningHour"),
    Qgs: avg("Qgs"),
    bebanJamKg: avg("bebanJamKg"),
    bebanBulanKg: avg("bebanBulanKg"),
    bebanTahunKg: avg("bebanTahunKg"),
    bebanTahunTon: avg("bebanTahunTon")
  };
}
function dispersiComplianceRow(stack, param, sel){
  const periode = sel.periods[sel.periods.length-1];
  const rec = dispersiParamRecord(stack.id, param, periode);
  if(!rec || rec.resultNumeric==null) return null;
  const STATUS_LABEL = {ok:"Memenuhi", exceed:"Melebihi", not_applicable:"Tidak Dipersyaratkan", not_evaluated:"Belum Dievaluasi"};
  const STATUS_COLOR = {ok:["#d7f0e2","#1c7a4f"], exceed:["#fbdcda","#a02a24"], not_applicable:["#e6eaee","#465468"], not_evaluated:["#e6eaee","#465468"]};
  const [bg,fg] = STATUS_COLOR[rec.statusBakuMutu] || STATUS_COLOR.not_evaluated;
  return {
    stack, param, periode, rec,
    hasilLabel: dispersiFmt(rec.resultNumeric, param==="H2S"?5:1), unit: rec.unit,
    standardLabel: rec.standard!=null ? dispersiFmt(rec.standard,1)+" "+rec.unit : "—",
    pctLabel: rec.pctOfStandard!=null ? dispersiFmt(rec.pctOfStandard,1)+"%" : "—",
    statusLabel: STATUS_LABEL[rec.statusBakuMutu]||rec.statusBakuMutu, statusBg:bg, statusColor:fg
  };
}
// Rentang tanggal kalender dari satu periode/tahun — dipakai HANYA sbg jendela query angin
// historis (Open-Meteo Archive), bukan sbg filter data sampling (yang tetap per-periode literal
// di atas). S1 = Jan-Jun, S2 = Jul-Des; dipotong ke hari ini kalau periodenya sedang berjalan.
function dispersiPeriodDateRange(sel){
  const today = new Date().toISOString().slice(0,10);
  if(sel.type==="year"){
    const end = `${sel.tahun}-12-31`;
    return {start:`${sel.tahun}-01-01`, end: end>today?today:end};
  }
  const {sem,tahun} = hasilPeriodParts(sel.periode);
  const end = sem===1 ? `${tahun}-06-30` : `${tahun}-12-31`;
  return {start: sem===1?`${tahun}-01-01`:`${tahun}-07-01`, end: end>today?today:end};
}

/* ---------- State halaman ---------- */
let dispersiState = {
  site: null, param: "NOx", sel: null, stability: "D", windMode: "live", mapLayer: "satellite",
  selectedStackIds: null,
  wind: {speed:null, dirFrom:null, updatedAt:null, error:null, loading:false},
  periodWind: {loading:false, error:null, avgSpeed:null, dominantDeg:null, dominantLabel:null, sampleCount:0, clamped:false, history:[], historyLabel:""}
};
function dispersiEnsureState(){
  const sites = dispersiSiteList();
  if(!dispersiState.site || !sites.includes(dispersiState.site)) dispersiState.site = sites[0]||null;
  const periods = dispersiPeriodList();
  if(!dispersiState.sel){
    const latest = periods[periods.length-1];
    dispersiState.sel = latest ? latest.periode : null;
  }
  if(dispersiState.selectedStackIds==null && dispersiState.site){
    dispersiState.selectedStackIds = new Set(dispersiStacks().filter(s=>s.site===dispersiState.site).map(s=>s.id));
  }
}

/* ---------- Wind: Open-Meteo, gratis tanpa API key ----------
   Live: Forecast API (current + hourly past_days=7) — dipoll ulang tiap 5 menit selagi halaman
   ini terbuka & mode Live aktif. Periode: Archive API (start_date/end_date bebas, delay arsip
   ~5 hari jadi tanggal akhir dipotong otomatis). Titik query = titik tengah (centroid) seluruh
   titik emisi ber-koordinat pada site terpilih — bukan stasiun BMKG lapangan asli, jadi untuk
   kebutuhan operasional presisi tinggi tetap silangkan dengan data angin lapangan/BMKG setempat. */
// Dipanggil tiap data angin (live atau periode) selesai dimuat/gagal — plume perlu dihitung ulang
// (arah/kecepatan angin baru) dan panel angin/rose/tabel perlu re-render, tapi peta itu sendiri
// TIDAK perlu di-init ulang (lihat dispersiRenderSidePanels).
function dispersiRefreshMapAndPanels(){
  dispersiUpdatePlume();
  dispersiRenderSidePanels();
}
async function dispersiFetchLiveWind(){
  const center = dispersiSiteCenter(dispersiState.site);
  if(!center) return;
  dispersiState.wind.loading = true;
  try{
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${center.lat}&longitude=${center.lng}&current=wind_speed_10m,wind_direction_10m&hourly=wind_speed_10m,wind_direction_10m&past_days=7&forecast_days=1&wind_speed_unit=ms`;
    const res = await fetch(url);
    if(!res.ok) throw new Error("bad response");
    const data = await res.json();
    dispersiState.wind = {speed:data.current.wind_speed_10m, dirFrom:data.current.wind_direction_10m, updatedAt:new Date().toISOString(), error:null, loading:false};
  }catch(err){
    dispersiState.wind = {speed: dispersiState.wind.speed, dirFrom: dispersiState.wind.dirFrom, updatedAt:new Date().toISOString(), error:"Gagal memuat data angin live (perlu koneksi internet ke Open-Meteo) — memakai nilai terakhir.", loading:false};
  }
  dispersiRefreshMapAndPanels();
}
async function dispersiFetchPeriodWind(){
  const center = dispersiSiteCenter(dispersiState.site);
  const sel = dispersiResolveSelection(dispersiState.sel);
  if(!center || !sel) return;
  dispersiState.periodWind.loading = true;
  try{
    const {start, end} = dispersiPeriodDateRange(sel);
    const maxEndDate = new Date(Date.now()-5*86400000).toISOString().slice(0,10);
    const endDate = end>maxEndDate ? maxEndDate : end;
    const clamped = endDate!==end;
    if(endDate<start) throw new Error("range too recent");
    const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${center.lat}&longitude=${center.lng}&start_date=${start}&end_date=${endDate}&hourly=wind_speed_10m,wind_direction_10m&wind_speed_unit=ms&timezone=auto`;
    const res = await fetch(url);
    if(!res.ok) throw new Error("bad response");
    const data = await res.json();
    const dirs = data.hourly.wind_direction_10m||[], speeds = data.hourly.wind_speed_10m||[];
    const hist = dirs.map((d,i)=>({dir:d,speed:speeds[i]})).filter(h=>h.dir!=null && h.speed!=null);
    if(!hist.length) throw new Error("no data");
    const avgSpeed = hist.reduce((a,h)=>a+h.speed,0)/hist.length;
    const N=16, bins=new Array(N).fill(0);
    hist.forEach(h=>{ bins[Math.round(h.dir/(360/N))%N]++; });
    let maxI=0; bins.forEach((v,i)=>{ if(v>bins[maxI]) maxI=i; });
    dispersiState.periodWind = {
      loading:false, error:null, avgSpeed, dominantDeg:maxI*(360/N), dominantLabel:dispersiCompassLabel16(maxI*(360/N)),
      sampleCount:hist.length, clamped, history:hist, historyLabel:`${start} – ${endDate}`
    };
  }catch(err){
    dispersiState.periodWind = {loading:false, error:"Data angin historis Open-Meteo untuk rentang ini belum tersedia.", avgSpeed:null, dominantDeg:null, dominantLabel:null, sampleCount:0, clamped:false, history:[], historyLabel:""};
  }
  dispersiRefreshMapAndPanels();
}
function dispersiRefreshWind(){
  if(dispersiState.windMode==="periode") dispersiFetchPeriodWind(); else dispersiFetchLiveWind();
}
let dispersiWindTimer = null;
function dispersiEnsureWindTimer(){
  if(dispersiWindTimer) return;
  dispersiWindTimer = setInterval(()=>{ if(document.getElementById("page-dispersi").classList.contains("active") && dispersiState.windMode==="live") dispersiFetchLiveWind(); }, 5*60*1000);
}

/* ---------- Peta Leaflet + overlay plume ---------- */
let dispersiMapInstance=null, dispersiTileLayer=null, dispersiMarkersLayer=null, dispersiPlumeLayerObj=null;
function dispersiBuildTileLayer(mode){
  if(mode==="street") return L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {maxZoom:21, maxNativeZoom:19, attribution:"&copy; OpenStreetMap contributors"});
  return L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {maxZoom:21, maxNativeZoom:17, attribution:"Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics"});
}
function dispersiInitMap(){
  if(dispersiMapInstance) return;
  const el = document.getElementById("dispersiMap");
  if(typeof L==="undefined"){
    el.innerHTML = "<div class='hint' style='padding:20px;'>Peta tidak bisa dimuat — perlu koneksi internet saat pertama kali buka halaman ini (untuk load tile peta). Coba refresh setelah online.</div>";
    return;
  }
  const center = dispersiSiteCenter(dispersiState.site) || {lat:-0.75,lng:117.4};
  dispersiMapInstance = L.map(el, {maxZoom:21}).setView([center.lat, center.lng], 13);
  dispersiTileLayer = dispersiBuildTileLayer(dispersiState.mapLayer).addTo(dispersiMapInstance);
  dispersiMarkersLayer = L.layerGroup().addTo(dispersiMapInstance);
  if(window.ResizeObserver){
    new ResizeObserver(()=>{ if(dispersiMapInstance) dispersiMapInstance.invalidateSize(); }).observe(el);
  }
  [30,150,500,1200].forEach(ms=>setTimeout(()=>{ if(dispersiMapInstance) dispersiMapInstance.invalidateSize(); }, ms));
  dispersiDrawMarkers();
  dispersiUpdatePlume();
}
function dispersiSetMapLayer(mode){
  if(mode===dispersiState.mapLayer) return;
  dispersiState.mapLayer = mode;
  if(dispersiMapInstance && dispersiTileLayer){
    dispersiMapInstance.removeLayer(dispersiTileLayer);
    dispersiTileLayer = dispersiBuildTileLayer(mode).addTo(dispersiMapInstance);
  }
  renderDispersi();
}
function dispersiDrawMarkers(){
  if(!dispersiMapInstance) return;
  dispersiMarkersLayer.clearLayers();
  const stacks = dispersiStacks().filter(s=>s.site===dispersiState.site);
  stacks.forEach(s=>{
    const selected = dispersiState.selectedStackIds.has(s.id);
    const size = selected?16:11;
    const icon = L.divIcon({className:"", iconSize:[size,size], iconAnchor:[size/2,size/2],
      html:`<div style="width:${size}px;height:${size}px;border-radius:50%;background:${s.tipe.color};border:2px solid ${selected?"#0d1f38":"#fff"};box-shadow:0 1px 3px rgba(0,0,0,.4);"></div>`});
    const marker = L.marker([s.lat,s.lng], {icon}).addTo(dispersiMarkersLayer);
    marker.bindTooltip(`${escHtml(s.nama)} (${selected?"termasuk":"klik untuk sertakan"})`, {direction:"top"});
    marker.on("click", ()=>dispersiToggleStack(s.id));
  });
}
function dispersiToggleStack(id){
  if(dispersiState.selectedStackIds.has(id)) dispersiState.selectedStackIds.delete(id);
  else dispersiState.selectedStackIds.add(id);
  dispersiDrawMarkers();
  dispersiUpdatePlume();
  dispersiRenderSidePanels();
}
// Grid konsentrasi 200x200 (CALC) dihitung lalu diperhalus (box blur 3x) supaya batas antar-band
// jadi kurva mulus (bukan kotak-kotak piksel), dibagi 8 band non-linear (akar pangkat 0.55 spy band
// rendah tidak keliatan kepipihkan oleh puncak plume), lalu diupscale ke 900px (OUT) dengan
// image-smoothing kualitas tinggi sebelum ditempel sbg imageOverlay georeferensi — ini yang
// bikin tepian plume tetap halus walau di-zoom, bukan pecah jadi kotak piksel kasar.
function dispersiUpdatePlume(){
  if(!dispersiMapInstance) return;
  if(dispersiPlumeLayerObj){ dispersiMapInstance.removeLayer(dispersiPlumeLayerObj); dispersiPlumeLayerObj=null; }
  if(!DISPERSI_MASS_PARAMS[dispersiState.param]) return;
  const sel = dispersiResolveSelection(dispersiState.sel);
  if(!sel) return;
  const stacks = dispersiStacks().filter(s=>s.site===dispersiState.site && dispersiState.selectedStackIds.has(s.id));
  if(!stacks.length) return;
  const sources = stacks.map(s=>{
    const b = dispersiBebanForSelection(s, dispersiState.param, sel);
    if(!b || b.Qgs==null) return null;
    return {stack:s, Qgs:b.Qgs};
  }).filter(Boolean);
  if(!sources.length) return;

  let windCases;
  if(dispersiState.windMode==="periode"){
    const hist = dispersiState.periodWind.history;
    if(!hist.length) return;
    const N=16, bins=new Array(N).fill(0), speedSum=new Array(N).fill(0);
    hist.forEach(h=>{ const idx=Math.round(h.dir/(360/N))%N; bins[idx]++; speedSum[idx]+=h.speed; });
    const total = hist.length;
    windCases = [];
    for(let i=0;i<N;i++){ if(bins[i]) windCases.push({dirFrom:i*(360/N), u:Math.max(speedSum[i]/bins[i],0.5), weight:bins[i]/total}); }
  } else {
    if(dispersiState.wind.dirFrom==null) return;
    windCases = [{dirFrom:dispersiState.wind.dirFrom, u:Math.max(dispersiState.wind.speed||2,0.5), weight:1}];
  }
  if(!windCases.length) return;

  const originLat = stacks.reduce((a,s)=>a+s.lat,0)/stacks.length;
  const originLng = stacks.reduce((a,s)=>a+s.lng,0)/stacks.length;
  const HALF_M = 6000;
  const bounds = [
    [originLat-HALF_M/dispersiMetersPerDegLat(), originLng-HALF_M/dispersiMetersPerDegLng(originLat)],
    [originLat+HALF_M/dispersiMetersPerDegLat(), originLng+HALF_M/dispersiMetersPerDegLng(originLat)]
  ];
  const CALC=200, OUT=900;
  const canvas = document.createElement("canvas"); canvas.width=CALC; canvas.height=CALC;
  const ctx = canvas.getContext("2d");
  const grid = new Float32Array(CALC*CALC);
  const originXY = sources.map(src=>dispersiToLocalXY(src.stack.lat, src.stack.lng, originLat, originLng));
  for(let py=0; py<CALC; py++){
    const worldY = (0.5-py/CALC)*HALF_M*2;
    for(let px=0; px<CALC; px++){
      const worldX = (px/CALC-0.5)*HALF_M*2;
      let total = 0;
      for(let wc=0; wc<windCases.length; wc++){
        const bearing = dispersiPlumeBearing(windCases[wc].dirFrom);
        const u = windCases[wc].u, weight = windCases[wc].weight;
        for(let i=0;i<sources.length;i++){
          const {dx,dy} = originXY[i];
          const {x,y} = dispersiRotateToPlume(worldX-dx, worldY-dy, bearing);
          if(x<=5) continue;
          const {sy,sz} = dispersiSigmaYZ(dispersiState.stability, x);
          total += weight*dispersiGroundConc(sources[i].Qgs, u, sy, sz, sources[i].stack.stackHeight, y);
        }
      }
      grid[py*CALC+px] = total;
    }
  }
  const boxBlur = (src)=>{
    const out = new Float32Array(src.length);
    for(let py=0; py<CALC; py++){
      for(let px=0; px<CALC; px++){
        let sum=0,n=0;
        for(let oy=-1;oy<=1;oy++) for(let ox=-1;ox<=1;ox++){
          const nx=px+ox, ny=py+oy;
          if(nx<0||nx>=CALC||ny<0||ny>=CALC) continue;
          sum += src[ny*CALC+nx]; n++;
        }
        out[py*CALC+px] = sum/n;
      }
    }
    return out;
  };
  let smooth = boxBlur(grid); smooth = boxBlur(smooth); smooth = boxBlur(smooth);
  // maxV diambil dari grid yg SUDAH dihaluskan, bukan grid mentah — titik tepat di dekat sumber
  // (x kecil, sigma y/z minimal) punya lonjakan tajam yg nyaris hilang kena 3x box blur; kalau
  // dipakai sbg pembagi, seluruh badan plume yg jadi perhatian utama malah keliatan pucat/gelap
  // semua karena dibandingkan ke puncak mentah yg jauh lebih tinggi dari apapun yg benar2 tervisualisasi.
  let maxV = 0.0001;
  for(let i=0;i<smooth.length;i++){ if(smooth[i]>maxV) maxV = smooth[i]; }

  const BANDS=8;
  const bandOf = (frac)=>Math.min(BANDS-1, Math.floor(Math.pow(frac,0.55)*BANDS));
  const bandIdx = new Int16Array(CALC*CALC);
  for(let i=0;i<smooth.length;i++){ const frac=smooth[i]/maxV; bandIdx[i] = frac<0.02 ? -1 : bandOf(frac); }
  const imgData = ctx.createImageData(CALC,CALC);
  for(let py=0; py<CALC; py++){
    for(let px=0; px<CALC; px++){
      const i = py*CALC+px;
      const b = bandIdx[i];
      const di = i*4;
      if(b===-1){ imgData.data[di+3]=0; continue; }
      const frac = (b+0.5)/BANDS;
      const [r,g,bl] = dispersiColorForFrac(frac);
      let isEdge=false;
      if(px<CALC-1 && bandIdx[i+1]!==b && bandIdx[i+1]!==-1) isEdge=true;
      if(py<CALC-1 && bandIdx[i+CALC]!==b && bandIdx[i+CALC]!==-1) isEdge=true;
      if(isEdge){ imgData.data[di]=255; imgData.data[di+1]=255; imgData.data[di+2]=255; imgData.data[di+3]=218; }
      else { imgData.data[di]=r; imgData.data[di+1]=g; imgData.data[di+2]=bl; imgData.data[di+3]=Math.round(Math.min(0.85,0.28+frac*0.6)*255); }
    }
  }
  ctx.putImageData(imgData,0,0);
  const outCanvas = document.createElement("canvas"); outCanvas.width=OUT; outCanvas.height=OUT;
  const octx = outCanvas.getContext("2d");
  octx.imageSmoothingEnabled = true; octx.imageSmoothingQuality = "high";
  octx.drawImage(canvas,0,0,CALC,CALC,0,0,OUT,OUT);
  dispersiPlumeLayerObj = L.imageOverlay(outCanvas.toDataURL(), bounds, {opacity:1}).addTo(dispersiMapInstance);
}

/* ---------- Builder tabel/panel (dipakai bareng oleh tampilan layar & export PDF) ---------- */
function dispersiSelectedStacks(){
  return dispersiStacks().filter(s=>s.site===dispersiState.site && dispersiState.selectedStackIds && dispersiState.selectedStackIds.has(s.id));
}
function dispersiBebanRowsHtml(stacks, param, sel){
  const rows = stacks.map(s=>{
    const b = dispersiBebanForSelection(s, param, sel);
    const heightNote = s.stackHeightIsDefault ? " title=\"Tinggi cerobong pakai perkiraan standar jenis sumber (belum diinput manual) — lihat Database Titik Pantau.\"" : "";
    if(!b){
      return `<tr><td><span style="width:8px;height:8px;border-radius:50%;background:${s.tipe.color};display:inline-block;margin-right:5px;"></span>${escHtml(s.nama)}<span${heightNote} style="color:var(--gray-500);">${s.stackHeightIsDefault?" ~":""}</span></td>
        <td style="text-align:right;">—</td><td style="text-align:right;">—</td><td style="text-align:right;">—</td><td style="text-align:right;">—</td><td style="text-align:right;">—</td><td style="text-align:right;">—</td></tr>`;
    }
    return `<tr><td><span style="width:8px;height:8px;border-radius:50%;background:${s.tipe.color};display:inline-block;margin-right:5px;"></span>${escHtml(s.nama)}<span${heightNote} style="color:var(--gray-500);">${s.stackHeightIsDefault?" ~":""}</span></td>
      <td style="text-align:right;font-family:var(--font-mono);">${b.concLabel} <span style="color:var(--gray-500);">${b.unit}</span></td>
      <td style="text-align:right;font-family:var(--font-mono);color:var(--gray-700);">${b.flowLabel} m³/s</td>
      <td style="text-align:right;font-family:var(--font-mono);color:var(--gray-700);">${dispersiFmt(b.runningHour,0)} j</td>
      <td style="text-align:right;font-family:var(--font-mono);">${dispersiFmt(b.bebanJamKg,3)} kg</td>
      <td style="text-align:right;font-family:var(--font-mono);font-weight:700;">${dispersiFmt(b.bebanBulanKg,1)} kg</td>
      <td style="text-align:right;font-family:var(--font-mono);font-weight:700;">${dispersiFmt(b.bebanTahunTon,2)} ton</td></tr>`;
  }).join("");
  return rows || `<tr><td colspan="7" style="text-align:center;color:var(--gray-500);padding:14px;">Tidak ada titik terpilih.</td></tr>`;
}
function dispersiComplianceRowsHtml(stacks, sel){
  const params = Object.keys(DISPERSI_MASS_PARAMS).concat(DISPERSI_COMPLIANCE_EXTRA);
  const rows = [];
  stacks.forEach(s=>{
    params.forEach(param=>{
      const c = dispersiComplianceRow(s, param, sel);
      if(!c) return;
      rows.push(`<tr><td style="font-weight:600;">${escHtml(s.nama)}</td><td style="color:var(--gray-700);">${escHtml(param)}</td>
        <td style="text-align:right;font-family:var(--font-mono);">${c.hasilLabel} ${c.unit}</td>
        <td style="text-align:right;font-family:var(--font-mono);color:var(--gray-500);">${c.standardLabel}</td>
        <td style="text-align:right;font-family:var(--font-mono);color:var(--gray-500);">${c.pctLabel}</td>
        <td><span class="b-pill" style="background:${c.statusBg};color:${c.statusColor};">${c.statusLabel}</span></td></tr>`);
    });
  });
  return rows.join("") || `<tr><td colspan="6" style="text-align:center;color:var(--gray-500);padding:14px;">Tidak ada data kepatuhan pada titik/periode terpilih.</td></tr>`;
}
function dispersiSummaryTableHtml(stacks, param, sel, groupKey, labelFn, colorFn){
  const groups = {};
  stacks.forEach(s=>{
    const key = groupKey(s);
    if(!groups[key]) groups[key] = {key, titik:0, bebanBulan:0, bebanTahunTon:0, color: colorFn?colorFn(s):null};
    const b = dispersiBebanForSelection(s, param, sel);
    if(b){ groups[key].titik++; groups[key].bebanBulan += b.bebanBulanKg||0; groups[key].bebanTahunTon += b.bebanTahunTon||0; }
  });
  const list = Object.values(groups).sort((a,b)=>b.bebanBulan-a.bebanBulan);
  if(!list.length) return `<div class="hint">Tidak ada data.</div>`;
  return `<table style="width:100%;border-collapse:collapse;font-size:12px;">
    <thead><tr><th style="text-align:left;padding:6px 4px;color:var(--gray-500);font-size:10.5px;text-transform:uppercase;">${labelFn.head}</th><th style="text-align:right;padding:6px 4px;color:var(--gray-500);font-size:10.5px;text-transform:uppercase;">Titik</th><th style="text-align:right;padding:6px 4px;color:var(--gray-500);font-size:10.5px;text-transform:uppercase;">kg/bln</th><th style="text-align:right;padding:6px 4px;color:var(--gray-500);font-size:10.5px;text-transform:uppercase;">ton/thn</th></tr></thead>
    <tbody>${list.map(g=>`<tr style="border-top:1px solid var(--gray-200);"><td style="padding:6px 4px;">${g.color?`<span style="width:8px;height:8px;border-radius:50%;background:${g.color};display:inline-block;margin-right:6px;"></span>`:""}${escHtml(labelFn.row(g.key))}</td><td style="text-align:right;padding:6px 4px;color:var(--gray-700);">${g.titik}</td><td style="text-align:right;padding:6px 4px;font-family:var(--font-mono);">${dispersiFmt(g.bebanBulan,1)}</td><td style="text-align:right;padding:6px 4px;font-family:var(--font-mono);font-weight:700;">${dispersiFmt(g.bebanTahunTon,2)}</td></tr>`).join("")}</tbody></table>`;
}
function dispersiTrendHtml(){
  const periods = dispersiPeriodList();
  const stacks = dispersiSelectedStacks();
  const selectedPeriods = dispersiResolveSelection(dispersiState.sel).periods;
  const vals = periods.map(({periode})=>stacks.reduce((sum,s)=>{
    const b = dispersiBebanSinglePeriode(s, dispersiState.param, periode);
    return sum + (b && b.bebanBulanKg!=null ? b.bebanBulanKg : 0);
  },0));
  const maxV = Math.max(1, ...vals);
  return `<div style="display:flex;align-items:flex-end;gap:16px;height:140px;padding:0 6px;">
    ${periods.map(({periode},i)=>{
      const inSel = selectedPeriods.includes(periode);
      const h = Math.round((vals[i]/maxV)*100)+6;
      return `<div style="display:flex;flex-direction:column;align-items:center;gap:6px;flex:1;">
        <div style="font-size:10.5px;color:var(--gray-700);font-family:var(--font-mono);">${dispersiFmt(vals[i],1)}</div>
        <div style="width:34px;border-radius:5px 5px 0 0;height:${h}px;background:${inSel?"var(--teal-500)":"var(--gray-300)"};"></div>
        <div style="font-size:10.5px;color:var(--gray-500);">${periode}</div>
      </div>`;
    }).join("")}
  </div>
  <div class="hint" style="margin-top:6px;">kg/bulan (rata-rata dari beban tahunan) &middot; batang teal = termasuk seleksi periode saat ini. Data sampel per semester (~6 bulan), sesuai kadens sampling aktual — bukan data harian/bulanan kalender asli.</div>`;
}
function dispersiWindRoseHtml(history){
  const sectorLabels = ["N","NE","E","SE","S","SW","W","NW"];
  const bins = new Array(8).fill(0);
  (history||[]).forEach(h=>{ bins[Math.round(h.dir/45)%8]++; });
  const maxBin = Math.max(1, ...bins);
  const bars = sectorLabels.map((label,i)=>{
    const angle = i*45;
    const len = Math.round((bins[i]/maxBin)*52)+4;
    const lx = 50+Math.sin(angle*Math.PI/180)*68, ly = 50-Math.cos(angle*Math.PI/180)*68;
    return `<div style="position:absolute;left:50%;bottom:50%;width:8px;height:${len}px;background:var(--teal-500);border-radius:3px 3px 0 0;transform:translateX(-50%) rotate(${angle}deg);transform-origin:bottom center;"></div>
      <div style="position:absolute;left:${lx}%;top:${ly}%;transform:translate(-50%,-50%);font-size:9.5px;color:var(--gray-500);">${label}</div>`;
  }).join("");
  return `<div style="position:relative;width:150px;height:150px;margin:0 auto;">
    <div style="position:absolute;inset:0;border:1px solid var(--gray-200);border-radius:50%;"></div>
    <div style="position:absolute;inset:22px;border:1px solid var(--gray-200);border-radius:50%;"></div>
    ${bars}
  </div>`;
}
function dispersiWindPanelHtml(){
  const s = dispersiState;
  if(s.windMode==="live"){
    const blowTo = ((s.wind.dirFrom||0)+180)%360;
    return `<div style="display:flex;gap:16px;align-items:center;">
      <div style="position:relative;width:88px;height:88px;flex-shrink:0;">
        <div style="position:absolute;inset:0;border:2px solid var(--gray-200);border-radius:50%;"></div>
        <div style="position:absolute;top:5px;left:50%;font-size:9px;color:var(--gray-500);transform:translateX(-50%);">N</div>
        <div style="position:absolute;left:50%;top:50%;width:0;height:0;transform:translate(-50%,-50%) rotate(${blowTo}deg);">
          <div style="width:0;height:0;border-left:8px solid transparent;border-right:8px solid transparent;border-bottom:26px solid var(--ms-accent);margin-left:-8px;margin-top:-26px;"></div>
        </div>
      </div>
      <div>
        <div style="font-family:var(--font-mono);font-size:22px;font-weight:800;color:var(--heading);">${s.wind.speed!=null?dispersiFmt(s.wind.speed,1):"—"} <span style="font-size:12px;font-weight:600;color:var(--gray-500);">m/s</span></div>
        <div style="font-size:12px;color:var(--gray-700);margin-top:2px;">dari ${s.wind.dirFrom!=null?dispersiCompassLabel(blowTo):"—"} (${s.wind.dirFrom!=null?Math.round(s.wind.dirFrom):"—"}°)</div>
        <div style="font-size:10.5px;color:var(--gray-500);margin-top:5px;">Sumber: Open-Meteo &middot; ${s.wind.updatedAt?new Date(s.wind.updatedAt).toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit"}):"—"} &middot; auto-refresh 5 menit</div>
      </div>
    </div>
    ${s.wind.error?`<div style="font-size:11px;color:#a02a24;margin-top:8px;">${escHtml(s.wind.error)}</div>`:""}`;
  }
  const pw = s.periodWind;
  return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
    <div><div style="font-size:10px;color:var(--gray-500);text-transform:uppercase;">Rata-rata Kecepatan</div><div style="font-family:var(--font-mono);font-size:18px;font-weight:800;color:var(--heading);">${pw.avgSpeed!=null?dispersiFmt(pw.avgSpeed,1):"—"} <span style="font-size:11px;font-weight:600;color:var(--gray-500);">m/s</span></div></div>
    <div><div style="font-size:10px;color:var(--gray-500);text-transform:uppercase;">Arah Dominan</div><div style="font-family:var(--font-mono);font-size:18px;font-weight:800;color:var(--heading);">${pw.dominantLabel||"—"}</div></div>
    <div><div style="font-size:10px;color:var(--gray-500);text-transform:uppercase;">Sampel Per Jam</div><div style="font-family:var(--font-mono);font-size:13px;font-weight:700;color:var(--gray-700);">${pw.sampleCount}</div></div>
    <div><div style="font-size:10px;color:var(--gray-500);text-transform:uppercase;">Rentang Dipakai</div><div style="font-size:11px;font-weight:600;color:var(--gray-700);">${escHtml(pw.historyLabel||"—")}</div></div>
  </div>
  ${pw.error?`<div style="font-size:11px;color:#a02a24;margin-top:8px;">${escHtml(pw.error)}</div>`:""}
  ${pw.clamped?`<div style="font-size:10.5px;color:#8a5c11;margin-top:6px;">Delay arsip Open-Meteo ~5 hari — tanggal akhir dipotong ke data terbaru yang tersedia.</div>`:""}`;
}
function dispersiDashboardStatsHtml(){
  const stacks = dispersiSelectedStacks();
  const totalEmisi = dispersiStacks().filter(s=>s.site===dispersiState.site).length;
  const sel = dispersiResolveSelection(dispersiState.sel);
  let withData=0, bebanBulanTotal=0, bebanTahunTotal=0, exceedCount=0;
  stacks.forEach(s=>{
    const b = dispersiBebanForSelection(s, dispersiState.param, sel);
    if(b){ withData++; bebanBulanTotal+=b.bebanBulanKg||0; bebanTahunTotal+=b.bebanTahunTon||0; }
    Object.keys(DISPERSI_MASS_PARAMS).concat(DISPERSI_COMPLIANCE_EXTRA).forEach(p=>{
      const c = dispersiComplianceRow(s, p, sel);
      if(c && c.rec.statusBakuMutu==="exceed") exceedCount++;
    });
  });
  const windNow = dispersiState.windMode==="live"
    ? (dispersiState.wind.speed!=null ? `${dispersiFmt(dispersiState.wind.speed,1)} m/s, dari ${dispersiCompassLabel(((dispersiState.wind.dirFrom||0)+180)%360)}` : "—")
    : (dispersiState.periodWind.avgSpeed!=null ? `${dispersiFmt(dispersiState.periodWind.avgSpeed,1)} m/s, dominan ${dispersiState.periodWind.dominantLabel}` : "—");
  return `<div class="grid cols-4">
    <div class="stat"><div class="num">${withData}/${totalEmisi}</div><div class="lbl">Titik dgn Data Dispersi &middot; ${escHtml(dispersiState.site||"")}</div></div>
    <div class="stat good"><div class="num">${dispersiFmt(bebanBulanTotal,1)}</div><div class="lbl">Total kg ${escHtml(dispersiState.param)}/bulan (terpilih)</div></div>
    <div class="stat"><div class="num">${dispersiFmt(bebanTahunTotal,2)}</div><div class="lbl">Total ton ${escHtml(dispersiState.param)}/tahun (terpilih)</div></div>
    <div class="stat ${exceedCount?"bad":"good"}"><div class="num">${exceedCount}</div><div class="lbl">Parameter Melebihi Baku Mutu</div></div>
  </div>
  <div class="hint" style="margin-top:8px;">Angin saat ini (${dispersiState.windMode==="live"?"Live":"rata-rata Periode"}): <b>${windNow}</b> &middot; Periode data: <b>${escHtml(dispersiSelectionLabel(dispersiState.sel))}</b></div>`;
}

/* ---------- Render halaman ---------- */
function dispersiChip(active, action, val, label){
  return `<button type="button" class="chip-toggle ${active?"active":""}" data-action="${action}" data-val="${escHtml(val)}">${escHtml(label)}</button>`;
}
let dispersiWindFetchedOnce = false;
function renderDispersi(){
  dispersiEnsureState();
  const sites = dispersiSiteList();
  if(!sites.length){
    document.getElementById("dispersiBody").innerHTML = `<div class="section-note">Belum ada titik emisi dengan koordinat (Lokasi Titik Pantau) — isi koordinat dulu supaya Model Dispersi Emisi bisa menampilkan peta.</div>`;
    return;
  }
  if(!dispersiWindFetchedOnce){ dispersiWindFetchedOnce = true; dispersiRefreshWind(); }
  document.getElementById("dispersiSiteChips").innerHTML = sites.map(s=>dispersiChip(s===dispersiState.site,"dispersiSetSite",s,s)).join("");
  document.getElementById("dispersiParamChips").innerHTML = Object.keys(DISPERSI_MASS_PARAMS).map(p=>dispersiChip(p===dispersiState.param,"dispersiSetParam",p,DISPERSI_MASS_PARAMS[p].label)).join("");
  const periodSel = document.getElementById("dispersiPeriode");
  const periodOptions = dispersiPeriodList().map(({periode})=>`<option value="${periode}">${periode}</option>`).join("")
    + dispersiYearList().filter(y=>y.periods.length>1).map(y=>`<option value="Y:${y.tahun}">Tahun ${y.tahun} (rata-rata S1+S2)</option>`).join("");
  periodSel.innerHTML = periodOptions;
  periodSel.value = dispersiState.sel;
  document.getElementById("dispersiStability").value = dispersiState.stability;
  document.getElementById("dispersiLiveBtn").classList.toggle("active", dispersiState.windMode==="live");
  document.getElementById("dispersiPeriodeBtn").classList.toggle("active", dispersiState.windMode==="periode");
  document.getElementById("dispersiSatBtn").classList.toggle("active", dispersiState.mapLayer==="satellite");
  document.getElementById("dispersiStreetBtn").classList.toggle("active", dispersiState.mapLayer==="street");
  document.getElementById("dispersiParamDesc").textContent = DISPERSI_MASS_PARAMS[dispersiState.param].desc;

  document.getElementById("dispersiStats").innerHTML = dispersiDashboardStatsHtml();

  if(!dispersiMapInstance) dispersiInitMap();
  else {
    const center = dispersiSiteCenter(dispersiState.site);
    if(center) dispersiMapInstance.setView([center.lat,center.lng], 13);
    dispersiDrawMarkers();
    dispersiUpdatePlume();
  }
  dispersiRenderSidePanels();
  dispersiEnsureWindTimer();
}
// Bagian yang TIDAK butuh peta digambar ulang (tabel, panel angin, ringkasan, tren) — dipisah
// dari renderDispersi supaya toggle marker/refresh angin tidak perlu re-init peta Leaflet.
function dispersiRenderSidePanels(){
  const stacks = dispersiSelectedStacks();
  const sel = dispersiResolveSelection(dispersiState.sel);
  document.getElementById("dispersiWindPanel").innerHTML = dispersiWindPanelHtml();
  document.getElementById("dispersiWindRose").innerHTML = dispersiWindRoseHtml(dispersiState.windMode==="live" ? [] : dispersiState.periodWind.history);
  document.getElementById("dispersiBebanTable").innerHTML = dispersiBebanRowsHtml(stacks, dispersiState.param, sel);
  document.getElementById("dispersiComplianceTable").innerHTML = dispersiComplianceRowsHtml(stacks, sel);
  // Kedua tabel ringkasan ini SENGAJA lintas-site (dispersiStacks() penuh, bukan stacks yg
  // di-scope ke site+seleksi map saat ini) — tujuannya beri konteks gambaran besar (semua site,
  // semua jenis sumber) sebagai pelengkap peta yang fokus ke satu site, bukan duplikat filter peta.
  const allStacks = dispersiStacks();
  document.getElementById("dispersiSummaryTipe").innerHTML = dispersiSummaryTableHtml(allStacks, dispersiState.param, sel, s=>s.tipe.key, {head:"Jenis Sumber", row:k=>k}, s=>s.tipe.color);
  document.getElementById("dispersiSummarySite").innerHTML = dispersiSummaryTableHtml(allStacks, dispersiState.param, sel, s=>s.site, {head:"Site", row:k=>k});
  document.getElementById("dispersiTrend").innerHTML = dispersiTrendHtml();
}
function dispersiSetSite(el){
  dispersiState.site = el.dataset.val;
  dispersiState.selectedStackIds = new Set(dispersiStacks().filter(s=>s.site===dispersiState.site).map(s=>s.id));
  dispersiRefreshWind();
  renderDispersi();
}
function dispersiSetParam(el){ dispersiState.param = el.dataset.val; dispersiUpdatePlume(); dispersiRenderSidePanels(); document.getElementById("dispersiParamChips").innerHTML = Object.keys(DISPERSI_MASS_PARAMS).map(p=>dispersiChip(p===dispersiState.param,"dispersiSetParam",p,DISPERSI_MASS_PARAMS[p].label)).join(""); document.getElementById("dispersiParamDesc").textContent = DISPERSI_MASS_PARAMS[dispersiState.param].desc; document.getElementById("dispersiStats").innerHTML = dispersiDashboardStatsHtml(); }
function dispersiOnPeriodeChange(){ dispersiState.sel = document.getElementById("dispersiPeriode").value; dispersiRefreshWind(); dispersiUpdatePlume(); dispersiRenderSidePanels(); document.getElementById("dispersiStats").innerHTML = dispersiDashboardStatsHtml(); }
function dispersiOnStabilityChange(){ dispersiState.stability = document.getElementById("dispersiStability").value; dispersiUpdatePlume(); }
function dispersiSetWindModeLive(){ dispersiState.windMode="live"; dispersiRefreshWind(); renderDispersi(); }
function dispersiSetWindModePeriode(){ dispersiState.windMode="periode"; dispersiRefreshWind(); renderDispersi(); }
function dispersiSetMapLayerSat(){ dispersiSetMapLayer("satellite"); }
function dispersiSetMapLayerStreet(){ dispersiSetMapLayer("street"); }
function dispersiSelectAllAtSite(){ dispersiState.selectedStackIds = new Set(dispersiStacks().filter(s=>s.site===dispersiState.site).map(s=>s.id)); dispersiDrawMarkers(); dispersiUpdatePlume(); dispersiRenderSidePanels(); }
function dispersiDeselectAll(){ dispersiState.selectedStackIds = new Set(); dispersiDrawMarkers(); dispersiUpdatePlume(); dispersiRenderSidePanels(); }

/* ---------- Export PDF: Laporan Beban Emisi ---------- */
function dispersiReportFilename(){
  return `Laporan Beban Emisi_${dispersiState.site}_${dispersiSelectionLabel(dispersiState.sel).replace(/[^\w \-()+]/g,"")}`;
}
function buildDispersiReportHtml(){
  const stacks = dispersiSelectedStacks();
  if(!stacks.length) return null;
  const sel = dispersiResolveSelection(dispersiState.sel);
  const params = Object.keys(DISPERSI_MASS_PARAMS);
  let bebanRows = "";
  let no=1;
  stacks.forEach(s=>{
    params.forEach(param=>{
      const b = dispersiBebanForSelection(s, param, sel);
      if(!b) return;
      bebanRows += `<tr><td>${no++}</td><td>${escHtml(s.nama)}</td><td>${escHtml(s.tipe.key)}</td><td>${escHtml(param)}</td>
        <td style="text-align:right;">${b.concLabel} ${b.unit}</td><td style="text-align:right;">${b.flowLabel} m³/s</td>
        <td style="text-align:right;">${dispersiFmt(b.runningHour,0)} j</td>
        <td style="text-align:right;">${dispersiFmt(b.bebanJamKg,3)} kg</td><td style="text-align:right;">${dispersiFmt(b.bebanBulanKg,1)} kg</td><td style="text-align:right;">${dispersiFmt(b.bebanTahunTon,2)} ton</td></tr>`;
    });
  });
  let complianceRows = "";
  no=1;
  stacks.forEach(s=>{
    params.concat(DISPERSI_COMPLIANCE_EXTRA).forEach(param=>{
      const c = dispersiComplianceRow(s, param, sel);
      if(!c) return;
      complianceRows += `<tr><td>${no++}</td><td>${escHtml(s.nama)}</td><td>${escHtml(param)}</td><td style="text-align:right;">${c.hasilLabel} ${c.unit}</td><td style="text-align:right;">${c.standardLabel}</td><td style="text-align:right;">${c.pctLabel}</td><td>${c.statusLabel}</td></tr>`;
    });
  });
  const summaryTipe = dispersiSummaryTableHtml(stacks, dispersiState.param, sel, s=>s.tipe.key, {head:"Jenis Sumber", row:k=>k});
  const genDate = new Date().toLocaleDateString("id-ID", {day:"numeric",month:"long",year:"numeric"});
  return `<div class="pg-batch pg-dispersi">
    <div style="text-align:center;margin-bottom:14px;padding-bottom:10px;border-bottom:1.5px solid #333;">
      <div style="font-weight:800;font-size:16px;letter-spacing:.01em;">LAPORAN BEBAN EMISI &amp; KEPATUHAN BAKU MUTU</div>
      <div style="font-size:11.5px;color:#555;margin-top:3px;">Model Dispersi Emisi — PT Pertamina Hulu Mahakam</div>
    </div>
    <table class="pg-ba-meta"><tr><td style="width:150px;">Site</td><td style="width:14px;">:</td><td>${escHtml(dispersiState.site)}</td></tr>
      <tr><td>Periode Data</td><td>:</td><td>${escHtml(dispersiSelectionLabel(dispersiState.sel))}</td></tr>
      <tr><td>Jumlah Titik Dianalisis</td><td>:</td><td>${stacks.length} titik emisi</td></tr>
      <tr><td>Tanggal Cetak</td><td>:</td><td>${genDate}</td></tr></table>

    <div style="font-weight:700;font-size:12.5px;margin:14px 0 6px;">Beban Pencemar per Titik</div>
    <table class="pg-ba-table"><thead><tr><th style="width:24px;">No</th><th>Titik</th><th>Jenis Sumber</th><th>Parameter</th><th style="text-align:right;">Konsentrasi</th><th style="text-align:right;">Laju Alir</th><th style="text-align:right;">Jam Operasi</th><th style="text-align:right;">Beban/Jam</th><th style="text-align:right;">Beban/Bln</th><th style="text-align:right;">Beban/Thn</th></tr></thead>
      <tbody>${bebanRows||`<tr><td colspan="10" style="text-align:center;">Tidak ada data.</td></tr>`}</tbody></table>

    <div style="font-weight:700;font-size:12.5px;margin:14px 0 6px;">Laporan Kepatuhan Baku Mutu</div>
    <table class="pg-ba-table"><thead><tr><th style="width:24px;">No</th><th>Titik</th><th>Parameter</th><th style="text-align:right;">Hasil</th><th style="text-align:right;">Baku Mutu</th><th style="text-align:right;">%BM</th><th>Status</th></tr></thead>
      <tbody>${complianceRows||`<tr><td colspan="7" style="text-align:center;">Tidak ada data.</td></tr>`}</tbody></table>

    <div style="font-weight:700;font-size:12.5px;margin:14px 0 6px;">Ringkasan Beban ${escHtml(dispersiState.param)} per Jenis Sumber</div>
    ${summaryTipe}

    <div class="pg-foot" style="margin-top:16px;">
      Metodologi: model dispersi Gaussian ground-level (koefisien Briggs rural, kelas stabilitas ${dispersiState.stability}), beban = konsentrasi &times; laju alir tercatat (m&sup3;/s, diperlakukan setara Nm&sup3;/s). Beban/bulan = rata-rata dari beban/tahun (beban/jam &times; jam operasi 1 tahun terakhir) &divide; 12 — data sampling per semester, bukan pengukuran bulanan kalender. Baku mutu &amp; status kepatuhan diambil langsung dari data hasil pemantauan (Permen LH 13/2009 &amp; Permen LHK 11/2021 sesuai kategori kapasitas/bahan bakar tiap titik). Dibuat otomatis oleh Emission Sampling Planner &amp; Tracker.
    </div>
  </div>`;
}
async function printDispersiReport(){
  const html = buildDispersiReportHtml();
  if(!html){ toast("Tidak ada titik terpilih dengan data pada site/periode ini.","err"); return; }
  setPrintOrientation("landscape", 12);
  document.getElementById("printGuideArea").innerHTML = html;
  const originalTitle = document.title;
  document.title = dispersiReportFilename();
  window.print();
  document.title = originalTitle;
}

Object.assign(ACTIONS, {
  dispersiSetSite, dispersiSetParam, dispersiOnPeriodeChange, dispersiOnStabilityChange,
  dispersiSetWindModeLive, dispersiSetWindModePeriode, dispersiSetMapLayerSat, dispersiSetMapLayerStreet,
  dispersiRefreshWind, dispersiSelectAllAtSite, dispersiDeselectAll, printDispersiReport
});
document.addEventListener("change", e=>{
  if(e.target.id==="dispersiPeriode") dispersiOnPeriodeChange();
  if(e.target.id==="dispersiStability") dispersiOnStabilityChange();
});
