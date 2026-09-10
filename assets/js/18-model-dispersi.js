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
  "Total Partikulat": {label:"Partikulat (TSP)", desc:"Partikel padat/cair tersuspensi di udara — berdampak pada sistem pernapasan & visibilitas."},
  // CO2 dicatat di data hasil pemantauan dlm % VOLUME (bukan mg/Nm3 spt 4 parameter di atas) —
  // molarMassGMol menandai param mana yg perlu dikonversi & dgn massa molar apa (lihat
  // dispersiConcMgNm3). Bukan pencemar kriteria beracun spt yg lain (tidak ada baku mutu ambien
  // PP22/EPA), jadi TIDAK muncul di DISPERSI_AMBIENT_STD — tetap dimodelkan sbg beban massa emisi
  // (kg CO2) krn ini gas rumah kaca yg relevan dilaporkan, cuma bukan utk pembanding baku mutu udara.
  "CO₂": {label:"CO₂", desc:"Karbon dioksida — gas rumah kaca utama hasil pembakaran sempurna bahan bakar. Dicatat dlm % volume di stack test, dikonversi ke mg/Nm³ via massa molar (44 g/mol) sblm dihitung beban massanya. Tidak dibandingkan ke baku mutu udara ambien (bukan pencemar kriteria beracun spt NOx/SO₂/CO/Partikulat).", molarMassGMol:44.01},
  // Opasitas BUKAN konsentrasi massa (cuma kepekatan visual %), jadi "Qgs"-nya di sini murni
  // opasitas x laju alir sbg proxy pola sebaran RELATIF — bukan g/s riil, tidak dipakai utk
  // beban/kg (qualitative:true menandai ini ke semua tabel beban/ringkasan/tren/dampak ambien).
  // Ditambahkan khusus supaya Flare — yang praktik pemantauannya memang visual/opasitas, bukan
  // sampling gas presisi seperti engine — tetap bisa divisualisasikan pola sebarannya.
  "Opasitas": {label:"Opasitas (Pola Relatif)", desc:"Pola sebaran RELATIF berdasarkan opasitas (%) × laju alir — bukan konsentrasi massa, jadi tidak dipakai utk beban pencemar/kg. Terutama berguna utk Flare, yang praktiknya dipantau visual (opasitas/Ringelmann), bukan sampling gas presisi.", qualitative:true}
};
// H2S/"Pemantauan Kandungan Sulfur Bahan Bakar" SENGAJA tidak diikutkan di halaman ini sama
// sekali (plume, DISPERSI_MASS_PARAMS, ATAU tabel Laporan Kepatuhan): itu uji kadar sulfur BAHAN
// BAKAR (% berat, bukan konsentrasi di keluaran cerobong) sesuai Pasal 12 ayat (2) huruf b Permen
// LH 13/2009, jadi bukan fenomena dispersi cerobong — lihat Dashboard Hasil Pemantauan utk data
// itu. Array ini disiapkan kalau suatu saat ada parameter kepatuhan tambahan di luar 5 di atas.
const DISPERSI_COMPLIANCE_EXTRA = [];
function dispersiIsQualitativeMode(){
  return dispersiIsFlowMode() || !!(DISPERSI_MASS_PARAMS[dispersiState.param] && DISPERSI_MASS_PARAMS[dispersiState.param].qualitative);
}
// Mode ke-5 (bukan pencemar spesifik): pola sebaran KESELURUHAN gas buang berdasarkan laju alir
// tercatat saja (tanpa dikalikan konsentrasi) — jawaban atas "arahnya kemana keluaran cerobongnya"
// terlepas dari kadar polutan tertentu. Tidak dipakai utk beban/kepatuhan (itu perlu parameter riil).
const DISPERSI_FLOW_MODE_KEY = "FLOW";
const DISPERSI_FLOW_MODE_META = {label:"Keluaran Cerobong (Semua Arah)", desc:"Pola sebaran KESELURUHAN gas buang berdasarkan laju alir tercatat (bukan konsentrasi pencemar tertentu) — menunjukkan ke arah mana asap/gas buang bergerak, bukan beban pencemar. Pilih salah satu parameter pencemar untuk melihat beban & kepatuhan baku mutu."};
function dispersiIsFlowMode(){ return dispersiState.param===DISPERSI_FLOW_MODE_KEY; }
// Baku Mutu Udara Ambien Nasional (PP 22/2021 Lampiran VII) & US EPA NAAQS — acuan umum
// pembanding (µg/m³) utk konsentrasi PUNCAK hasil model, BUKAN pengganti kajian dispersi
// regulatory penuh (perlu simulasi meteorologi per jam sepanjang minimal 1 tahun, bukan
// screening satu kombinasi angin+stabilitas seperti di halaman ini). Cross-check ke teks resmi
// PP 22/2021 sebelum dipakai pelaporan kepatuhan — angka di sini murni konteks/indikasi awal.
const DISPERSI_AMBIENT_STD = {
  "NOx": {ambientLabel:"NO₂ (ambien)", pp22:{"24 jam":65,"1 tahun":50}, epa:{"1 jam":188,"1 tahun":100}},
  "SO₂": {ambientLabel:"SO₂ (ambien)", pp22:{"24 jam":75,"1 tahun":45}, epa:{"1 jam":196}},
  "CO": {ambientLabel:"CO (ambien)", pp22:{"8 jam":10000}, epa:{"8 jam":10000}},
  "Total Partikulat": {ambientLabel:"PM10/TSP (ambien)", pp22:{"24 jam":75,"1 tahun":40}, epa:{"24 jam":150}}
};

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
// Palet kelas kecepatan angin baku — dipakai bareng oleh Wind Rose & grafik ringkasan angin harian
// Mode Expert, supaya konvensi warna "kecepatan angin" konsisten di semua visualisasi halaman ini.
const DISPERSI_SPEED_BINS = [
  {max:2, label:"<2", color:"#bfe3ea"},
  {max:4, label:"2–4", color:"#7cc3d6"},
  {max:6, label:"4–6", color:"#2fa0ba"},
  {max:8, label:"6–8", color:"#0ea5a0"},
  {max:Infinity, label:"≥8", color:"#0a6b63"}
];
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
      lat: coord[0], lng: coord[1], tipe, frekuensiBulan: p.frekuensiBulan,
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
// Sebagian parameter (CO2) dicatat hasil sampling-nya dlm % VOLUME, bukan mg/Nm3 spt param massa
// lain — dikonversi via massa molar gas ideal pd kondisi Normal (Nm3 = 0derajatC/1atm, volume molar
// 22,414 L/mol, konvensi baku konversi ppm<->mg/m3 di kondisi standar/normal):
//   mg/Nm3 = (%vol x 10.000 ppm/%) x (massaMolar g/mol / 22,414 L/mol)
// Param tanpa molarMassGMol (NOx/SO2/CO/Total Partikulat, semua sudah mg/Nm3 asli) dikembalikan
// apa adanya tanpa konversi apapun.
function dispersiConcMgNm3(concRec, param){
  if(!concRec || concRec.resultNumeric==null) return null;
  const meta = DISPERSI_MASS_PARAMS[param];
  if(meta && meta.molarMassGMol && concRec.unit==="%"){
    return concRec.resultNumeric * 10000 * meta.molarMassGMol / 22.414;
  }
  return concRec.resultNumeric;
}
// g/s dari konsentrasi (mg/Nm3, sesudah dikonversi kalau param-nya % volume spt CO2) x laju alir
// tercatat (m3/s, diperlakukan setara Nm3/s — penyederhanaan yang ditandai transparan di UI, bukan
// normalisasi suhu/tekanan penuh).
function dispersiEmissionRateGs(concRec, flowRec, param){
  if(!concRec || !flowRec || concRec.resultNumeric==null || flowRec.resultNumeric==null) return null;
  const concMgNm3 = dispersiConcMgNm3(concRec, param);
  return concMgNm3 * flowRec.resultNumeric / 1000;
}
// Mode "Keluaran Cerobong": pakai laju alir APA ADANYA sbg kekuatan sumber (bukan g/s riil) —
// hanya utk bentuk/pola sebaran relatif antar titik & sektor angin, bukan angka beban yg berarti,
// jadi tidak perlu konversi densitas gas buang yg presisi (skala warna selalu dinormalisasi relatif).
function dispersiFlowOnlyQgs(stack, sel){
  const recs = sel.periods.map(p=>dispersiFlowRecord(stack.id, p)).filter(r=>r && r.resultNumeric!=null);
  if(!recs.length) return null;
  return recs.reduce((a,r)=>a+r.resultNumeric,0)/recs.length;
}
// Sama spt dispersiFlowOnlyQgs tapi utk mode Opasitas — sengaja TIDAK butuh laju alir sama sekali.
// Verifikasi data: 0 dari 20 titik Flare di seluruh dataset punya rekaman "Laju Alir (v)" —
// Flare secara operasional memang tidak diukur laju alirnya (bukan duct tertutup spt exhaust
// engine), makanya praktik pemantauannya visual/opasitas. Kalau formula Opasitas x laju alir
// dipaksakan (spt param massa lain), Flare TIDAK AKAN PERNAH bisa divisualisasikan (persis
// masalah yg mau diperbaiki) — jadi di sini opasitas % dipakai sendirian sbg kekuatan sumber.
function dispersiOpasitasOnlyQgs(stack, sel){
  const recs = sel.periods.map(p=>dispersiParamRecord(stack.id, "Opasitas", p)).filter(r=>r && r.resultNumeric!=null);
  if(!recs.length) return null;
  return recs.reduce((a,r)=>a+r.resultNumeric,0)/recs.length;
}
// Titik masuk tunggal utk "kekuatan sumber" plume, apapun parameternya (massa riil, Opasitas,
// atau mode Keluaran Cerobong) — dipakai konsisten di compute plume & hitungan "titik dgn data"
// biar tidak ada tempat yg lupa memberi jalur khusus utk parameter kualitatif.
function dispersiQgsForStack(stack, param, sel){
  if(param===DISPERSI_FLOW_MODE_KEY) return dispersiFlowOnlyQgs(stack, sel);
  if(param==="Opasitas") return dispersiOpasitasOnlyQgs(stack, sel);
  const b = dispersiBebanForSelection(stack, param, sel);
  return (b && b.Qgs!=null) ? b.Qgs : null;
}
// Hasil lengkap 1 stack+param pada SATU periode literal (bukan agregat tahun) — null kalau
// datanya memang tidak ada (konsentrasi atau laju alir tidak tercatat pada periode itu).
function dispersiBebanSinglePeriode(stack, param, periode){
  const concRec = dispersiParamRecord(stack.id, param, periode);
  const flowRec = dispersiFlowRecord(stack.id, periode);
  const Qgs = dispersiEmissionRateGs(concRec, flowRec, param);
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
// Periode lain (selain "periode") yg urutannya lebih lama, terurut BARU->LAMA — dipakai carry-
// forward di bawah utk mencari hasil terakhir suatu engine sebelum periode target.
function dispersiPriorPeriods(periode){
  const allPeriods = dispersiPeriodList();
  const targetOrder = (allPeriods.find(p=>p.periode===periode)||{}).order;
  if(targetOrder==null) return [];
  return allPeriods.filter(p=>p.order<targetOrder).sort((a,b)=>b.order-a.order);
}
// RH "ekuivalen tahunan" utk PERIODE TARGET (bukan periode sumber konsentrasi) — dari log RH
// BULANAN (DB.rhMonthly, diisi terpisah dari hasil sampling di halaman Running Hour Detail), krn
// mesin yg TIDAK dijadwalkan sampling ulang semester ini (khususnya sumber 1x/tahun) tetap
// beroperasi & jam jalannya tetap tercatat tiap bulan terlepas dari jadwal sampling gas cerobong.
// Dikembalikan sbg figur x2 (bukan RH riil semester itu apa adanya) krn seluruh pipeline
// bebanTahunKg di bawah menganggap "runningHour" sbg estimasi TAHUNAN (dibagi /2 lagi nanti di
// laporan per-semester, /12 utk per-bulan) — x2 di sini "dibatalkan" oleh /2 itu, hasil bersihnya =
// RH riil semester target apa adanya. null kalau titik itu memang belum ada riwayat RH bulanan
// sama sekali (fallback ke RH milik record sampling sumber, lihat pemanggil).
function dispersiCarryForwardAnnualRH(stack, periode){
  const {sem, tahun} = hasilPeriodParts(periode);
  if(sem==null) return null;
  const semRH = semesterRhSum(stack.nama, sem, tahun);
  return semRH!=null ? semRH*2 : null;
}
// Engine yg frekuensi pemantauannya lebih jarang dari 1x/semester (mis. wajib 1x/tahun, jadwalnya
// cuma jatuh di salah satu semester) SEHARUSNYA masih dianggap "berlaku" pakai hasil terakhirnya
// di periode2 lain sampai jadwal sampling berikutnya — bukan tiba2 jadi lubang/kosong di semester
// yg bukan gilirannya. carriedFrom ditandai supaya UI bisa memberi tahu ini bukan data baru.
// PENTING: konsentrasi & laju alir ikut dari periode SUMBER (persis hasil sampling itu), tapi jam
// operasi (runningHour) dipakai milik periode TARGET (dispersiCarryForwardAnnualRH) — semester yg
// tidak disampling ulang tetap py jam operasi sendiri (mesin tetap jalan), bukan ikut jam operasi
// semester lama saat sampling terakhir terjadi.
function dispersiBebanCarryForward(stack, param, periode){
  const exact = dispersiBebanSinglePeriode(stack, param, periode);
  if(exact) return exact;
  for(const p of dispersiPriorPeriods(periode)){
    const r = dispersiBebanSinglePeriode(stack, param, p.periode);
    if(!r) continue;
    const targetRH = dispersiCarryForwardAnnualRH(stack, periode);
    const runningHour = targetRH!=null ? targetRH : r.runningHour;
    const bebanTahunKg = runningHour!=null ? r.bebanJamKg*runningHour : null;
    return {
      ...r, runningHour, carriedFrom: p.periode,
      bebanBulanKg: bebanTahunKg!=null ? bebanTahunKg/12 : null,
      bebanTahunKg, bebanTahunTon: bebanTahunKg!=null ? bebanTahunKg/1000 : null
    };
  }
  return null;
}
// Hasil utk 1 stack+param mengikuti SELEKSI periode (periode tunggal ATAU agregat tahun — kalau
// tahun, rata-ratakan tiap besaran dari semester yang datanya ada [carry-forward kalau salah satu
// semesternya bukan giliran sampling]; kalau tidak satupun periode ATAUPUN riwayatnya punya data,
// null — "biarin", tidak dipaksakan). complianceRef selalu memakai periode PALING BARU di antara
// yang tersedia (status kepatuhan itu kategorikal, tidak masuk akal dirata-rata).
function dispersiBebanForSelection(stack, param, sel){
  const results = sel.periods.map(p=>dispersiBebanCarryForward(stack, param, p)).filter(Boolean);
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
    bebanTahunTon: avg("bebanTahunTon"),
    carriedFrom: results[results.length-1].carriedFrom || null
  };
}
function dispersiComplianceRow(stack, param, sel){
  const periode = sel.periods[sel.periods.length-1];
  let rec = dispersiParamRecord(stack.id, param, periode);
  let carriedFrom = null;
  if(!rec || rec.resultNumeric==null){
    for(const p of dispersiPriorPeriods(periode)){
      const r = dispersiParamRecord(stack.id, param, p.periode);
      if(r && r.resultNumeric!=null){ rec = r; carriedFrom = p.periode; break; }
    }
  }
  if(!rec || rec.resultNumeric==null) return null;
  const STATUS_LABEL = {ok:"Memenuhi", exceed:"Melebihi", not_applicable:"Tidak Dipersyaratkan", not_evaluated:"Belum Dievaluasi"};
  const STATUS_COLOR = {ok:["#d7f0e2","#1c7a4f"], exceed:["#fbdcda","#a02a24"], not_applicable:["#e6eaee","#465468"], not_evaluated:["#e6eaee","#465468"]};
  const [bg,fg] = STATUS_COLOR[rec.statusBakuMutu] || STATUS_COLOR.not_evaluated;
  return {
    stack, param, periode, rec, carriedFrom,
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
  selectedStackIds: null, lastPeakConcUgm3: null, lastPlumeSnapshotDataUrl: null, lastPlumeBasemapUrl: null, lastPlumeSnapshotMeta: null,
  wind: {speed:null, dirFrom:null, temp:null, humidity:null, updatedAt:null, error:null, loading:false, history:[], historyLabel:""},
  periodWind: {loading:false, error:null, avgSpeed:null, avgTemp:null, avgHumidity:null, dominantDeg:null, dominantLabel:null, sampleCount:0, clamped:false, history:[], historyLabel:""},
  // Mode angin ke-3 (selain Live/Periode): rentang tanggal BEBAS pilihan user (tidak terbatas ke
  // opsi semester/tahun yang disediakan) — start/end diisi user lewat 2 input tanggal, sisa field
  // lain identik strukturnya dgn periodWind (sama2 hasil dispersiFetchArchiveWindAggregate).
  customWind: {start:null, end:null, loading:false, error:null, avgSpeed:null, avgTemp:null, avgHumidity:null, dominantDeg:null, dominantLabel:null, sampleCount:0, clamped:false, history:[], historyLabel:""}
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
  dispersiScheduleUpdatePlume();
  dispersiRenderSidePanels();
}
async function dispersiFetchLiveWind(){
  const center = dispersiSiteCenter(dispersiState.site);
  if(!center) return;
  dispersiState.wind.loading = true;
  try{
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${center.lat}&longitude=${center.lng}&current=wind_speed_10m,wind_direction_10m,temperature_2m,relative_humidity_2m&hourly=wind_speed_10m,wind_direction_10m&past_days=7&forecast_days=1&wind_speed_unit=ms`;
    const res = await fetch(url);
    if(!res.ok) throw new Error("bad response");
    const data = await res.json();
    // hourly 7-hari-terakhir yg SAMA dgn dipakai utk current dipakai juga utk wind rose mode Live —
    // sebelumnya dibuang begitu saja shg wind rose selalu kosong/kelihatan rusak di mode Live.
    const dirs = data.hourly.wind_direction_10m||[], speeds = data.hourly.wind_speed_10m||[];
    const hist = dirs.map((d,i)=>({dir:d,speed:speeds[i]})).filter(h=>h.dir!=null && h.speed!=null);
    dispersiState.wind = {
      speed:data.current.wind_speed_10m, dirFrom:data.current.wind_direction_10m,
      temp:data.current.temperature_2m, humidity:data.current.relative_humidity_2m,
      updatedAt:new Date().toISOString(), error:null, loading:false,
      history:hist, historyLabel:"7 hari terakhir"
    };
  }catch(err){
    dispersiState.wind = {
      speed: dispersiState.wind.speed, dirFrom: dispersiState.wind.dirFrom,
      temp: dispersiState.wind.temp, humidity: dispersiState.wind.humidity,
      updatedAt:new Date().toISOString(), error:"Gagal memuat data angin live (perlu koneksi internet ke Open-Meteo) — memakai nilai terakhir.", loading:false,
      history: dispersiState.wind.history||[], historyLabel: dispersiState.wind.historyLabel||"7 hari terakhir"
    };
  }
  dispersiRefreshMapAndPanels();
}
// Fetch + agregasi baku (rata-rata kecepatan/suhu/kelembapan, arah dominan dari 16 sektor) utk 1
// rentang tanggal Open-Meteo Archive — dipakai BERSAMA oleh mode Periode (rentang dari periode
// sampling terpilih, lihat dispersiPeriodDateRange) & mode Kustom (rentang tanggal bebas pilihan
// user) di bawah, karena keduanya cuma beda SUMBER rentang tanggalnya, bukan cara mengolah hasilnya.
async function dispersiFetchArchiveWindAggregate(lat, lng, start, end){
  const maxEndDate = new Date(Date.now()-5*86400000).toISOString().slice(0,10);
  const endDate = end>maxEndDate ? maxEndDate : end;
  const clamped = endDate!==end;
  if(endDate<start) throw new Error("range too recent");
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lng}&start_date=${start}&end_date=${endDate}&hourly=wind_speed_10m,wind_direction_10m,temperature_2m,relative_humidity_2m&wind_speed_unit=ms&timezone=auto`;
  const res = await fetch(url);
  if(!res.ok) throw new Error("bad response");
  const data = await res.json();
  const dirs = data.hourly.wind_direction_10m||[], speeds = data.hourly.wind_speed_10m||[];
  const hist = dirs.map((d,i)=>({dir:d,speed:speeds[i]})).filter(h=>h.dir!=null && h.speed!=null);
  if(!hist.length) throw new Error("no data");
  const avgSpeed = hist.reduce((a,h)=>a+h.speed,0)/hist.length;
  const temps = (data.hourly.temperature_2m||[]).filter(v=>v!=null);
  const hums = (data.hourly.relative_humidity_2m||[]).filter(v=>v!=null);
  const avgTemp = temps.length ? temps.reduce((a,b)=>a+b,0)/temps.length : null;
  const avgHumidity = hums.length ? hums.reduce((a,b)=>a+b,0)/hums.length : null;
  const N=16, bins=new Array(N).fill(0);
  hist.forEach(h=>{ bins[Math.round(h.dir/(360/N))%N]++; });
  let maxI=0; bins.forEach((v,i)=>{ if(v>bins[maxI]) maxI=i; });
  return {
    loading:false, error:null, avgSpeed, avgTemp, avgHumidity, dominantDeg:maxI*(360/N), dominantLabel:dispersiCompassLabel16(maxI*(360/N)),
    sampleCount:hist.length, clamped, history:hist, historyLabel:`${start} – ${endDate}`
  };
}
async function dispersiFetchPeriodWind(){
  const center = dispersiSiteCenter(dispersiState.site);
  const sel = dispersiResolveSelection(dispersiState.sel);
  if(!center || !sel) return;
  dispersiState.periodWind.loading = true;
  try{
    const {start, end} = dispersiPeriodDateRange(sel);
    dispersiState.periodWind = await dispersiFetchArchiveWindAggregate(center.lat, center.lng, start, end);
  }catch(err){
    dispersiState.periodWind = {loading:false, error:"Data angin historis Open-Meteo untuk rentang ini belum tersedia.", avgSpeed:null, avgTemp:null, avgHumidity:null, dominantDeg:null, dominantLabel:null, sampleCount:0, clamped:false, history:[], historyLabel:""};
  }
  dispersiRefreshMapAndPanels();
}
// Mode Kustom: SAMA persis alurnya dgn Periode, bedanya rentang start/end datang dari 2 input
// tanggal user (dispersiState.customWind.start/end, diisi lewat dispersiApplyCustomWindRange) —
// bukan diturunkan dari daftar semester/tahun yang disediakan. Dipakai kalau user mau melihat pola
// angin pada rentang tanggal spesifik yang tidak dibatasi pilihan periode sampling yang ada.
async function dispersiFetchCustomWind(){
  const center = dispersiSiteCenter(dispersiState.site);
  const {start, end} = dispersiState.customWind;
  if(!center || !start || !end) return;
  dispersiState.customWind = {...dispersiState.customWind, loading:true};
  try{
    const agg = await dispersiFetchArchiveWindAggregate(center.lat, center.lng, start, end);
    dispersiState.customWind = {...agg, start, end};
  }catch(err){
    dispersiState.customWind = {start, end, loading:false, error:"Data angin historis Open-Meteo untuk rentang tanggal ini belum tersedia (terlalu baru utk arsip &plusmn;5 hari, atau memang di luar cakupan Open-Meteo).", avgSpeed:null, avgTemp:null, avgHumidity:null, dominantDeg:null, dominantLabel:null, sampleCount:0, clamped:false, history:[], historyLabel:""};
  }
  dispersiRefreshMapAndPanels();
}
function dispersiRefreshWind(){
  if(dispersiState.windMode==="periode") dispersiFetchPeriodWind();
  else if(dispersiState.windMode==="custom") dispersiFetchCustomWind();
  else dispersiFetchLiveWind();
}
function dispersiWindModeLabel(mode){ return mode==="live"?"Live":mode==="custom"?"Kustom":"Periode"; }
// Objek hasil agregasi angin yang SEDANG AKTIF di luar mode Live (periodWind ATAU customWind) —
// dipakai di banyak tempat (stat ringkas, panel angin, hint dampak ambien) supaya tidak perlu
// mengulang ternary windMode==="custom"?...:... di tiap pemanggil.
function dispersiActiveWindAgg(){ return dispersiState.windMode==="custom" ? dispersiState.customWind : dispersiState.periodWind; }
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
// Bingkai peta mengikuti SEBARAN NYATA titik site ini (fitBounds), bukan setView+zoom tetap —
// beberapa site (mis. SPU) titik-titiknya tersebar puluhan km (beberapa platform/cluster berbeda,
// bukan satu lokasi kompak), jadi zoom tetap yg dipusatkan ke rata-rata koordinat bisa sama sekali
// tidak menampilkan titik manapun di layar. fitBounds selalu menampilkan SEMUA titik site terpilih.
function dispersiFitSiteBounds(){
  if(!dispersiMapInstance) return;
  const stacks = dispersiStacks().filter(s=>s.site===dispersiState.site);
  if(!stacks.length) return;
  if(stacks.length===1){ dispersiMapInstance.setView([stacks[0].lat, stacks[0].lng], 14); return; }
  const bounds = L.latLngBounds(stacks.map(s=>[s.lat,s.lng]));
  dispersiMapInstance.fitBounds(bounds, {padding:[50,50], maxZoom:15});
}
function dispersiInitMap(){
  if(dispersiMapInstance) return;
  const el = document.getElementById("dispersiMap");
  if(typeof L==="undefined"){
    el.innerHTML = "<div class='hint' style='padding:20px;'>Peta tidak bisa dimuat — perlu koneksi internet saat pertama kali buka halaman ini (untuk load tile peta). Coba refresh setelah online.</div>";
    return;
  }
  dispersiMapInstance = L.map(el, {maxZoom:21}).setView([-0.75,117.4], 9);
  dispersiTileLayer = dispersiBuildTileLayer(dispersiState.mapLayer).addTo(dispersiMapInstance);
  dispersiMarkersLayer = L.layerGroup().addTo(dispersiMapInstance);
  if(window.ResizeObserver){
    new ResizeObserver(()=>{ if(dispersiMapInstance) dispersiMapInstance.invalidateSize(); }).observe(el);
  }
  [30,150,500,1200].forEach(ms=>setTimeout(()=>{ if(dispersiMapInstance) dispersiMapInstance.invalidateSize(); }, ms));
  // Plume dihitung ULANG tiap kali tampilan peta berubah (zoom atau geser) — sebelumnya plume
  // adalah gambar statis terikat ke kotak geografis tetap di sekitar titik, jadi kalau di-zoom out
  // kelihatan seperti "kepotong" (di luar kotak itu kosong) dan kalau di-zoom in jadi blur (piksel
  // gambar yg sama diperbesar). Sekarang kotak & resolusinya SELALU mengikuti area yang benar-benar
  // sedang terlihat, jadi selalu tajam & tidak pernah terpotong — didebounce 350ms supaya tidak
  // menghitung ulang tiap frame animasi zoom/geser, cukup sekali setelah gestur selesai.
  dispersiMapInstance.on("zoomend moveend", ()=>dispersiScheduleUpdatePlume(350));
  dispersiDrawMarkers();
  dispersiFitSiteBounds();
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
  dispersiScheduleUpdatePlume();
  dispersiRenderSidePanels();
}
// Toggle SEMUA titik jenis sumber (tipe) tertentu di site aktif sekaligus — jalan pintas dari
// klik satu-satu tiap marker. "Aktif" (semua anggota tipe ini sudah kepilih) -> klik lagi = keluarkan
// semuanya; kalau campuran/belum ada yg kepilih -> klik = masukkan semuanya.
function dispersiToggleTipe(el){
  const key = el.dataset.val;
  const stacksOfType = dispersiStacks().filter(s=>s.site===dispersiState.site && s.tipe.key===key);
  if(!stacksOfType.length) return;
  const allSelected = stacksOfType.every(s=>dispersiState.selectedStackIds.has(s.id));
  stacksOfType.forEach(s=>{ if(allSelected) dispersiState.selectedStackIds.delete(s.id); else dispersiState.selectedStackIds.add(s.id); });
  dispersiDrawMarkers();
  dispersiScheduleUpdatePlume();
  dispersiRenderSidePanels();
  dispersiRenderTipeChips();
}
function dispersiTipeChipsHtml(){
  const stacksAtSite = dispersiStacks().filter(s=>s.site===dispersiState.site);
  const byTipe = {};
  stacksAtSite.forEach(s=>{ (byTipe[s.tipe.key] = byTipe[s.tipe.key]||[]).push(s); });
  const keys = Object.keys(byTipe).sort((a,b)=>byTipe[b].length-byTipe[a].length);
  if(!keys.length) return "";
  return keys.map(key=>{
    const list = byTipe[key];
    const allSelected = list.every(s=>dispersiState.selectedStackIds.has(s.id));
    const someSelected = list.some(s=>dispersiState.selectedStackIds.has(s.id));
    const color = list[0].tipe.color;
    return `<button type="button" class="chip-toggle ${allSelected?"active":""}" data-action="dispersiToggleTipe" data-val="${escHtml(key)}" style="${someSelected&&!allSelected?"box-shadow:inset 0 0 0 1.5px "+color+";":""}">
      <span style="width:7px;height:7px;border-radius:50%;background:${color};display:inline-block;margin-right:5px;"></span>${escHtml(key)} (${list.length})
    </button>`;
  }).join("");
}
function dispersiRenderTipeChips(){
  const el = document.getElementById("dispersiTipeChips");
  if(el) el.innerHTML = dispersiTipeChipsHtml();
}

/* ---------- Filter Titik Emisi (checklist gaya Excel, pola .xsel yang sama dgn checklist
   Titik/Cerobong di Dashboard Hasil Pemantauan) — pelengkap klik-per-marker di peta & chip Jenis
   Sumber: kadang mau pilih 2-3 titik SPESIFIK by name (misal buat preview/laporan 1 unit saja)
   tanpa harus mencari-cari pin-nya di peta satu-satu. Tidak menambah state baru — tetap menulis ke
   dispersiState.selectedStackIds yang sama dipakai peta/plume/tabel/preview, jadi semuanya otomatis
   ikut tersinkron. ---------- */
let dispersiTitikPanelOpen = false;
function dispersiVisibleTitikOptions(){
  const q = (document.getElementById("dispersiTitikSearch")?.value||"").toLowerCase().trim();
  const all = dispersiStacks().filter(s=>s.site===dispersiState.site);
  return q ? all.filter(s=>s.nama.toLowerCase().includes(q)) : all;
}
function dispersiRenderTitikChecklist(){
  const all = dispersiStacks().filter(s=>s.site===dispersiState.site);
  const btn = document.getElementById("dispersiTitikBtnLabel");
  if(btn){
    const n = dispersiState.selectedStackIds ? dispersiState.selectedStackIds.size : 0;
    btn.textContent = n===all.length ? `Semua ${all.length} titik di site ini` : n===0 ? "Tidak ada titik dipilih" : `${n} dari ${all.length} titik dipilih`;
  }
  const list = document.getElementById("dispersiTitikList");
  if(!list) return;
  const visible = dispersiVisibleTitikOptions();
  list.innerHTML = visible.length ? visible.map(s=>`<label class="xsel-opt"><input type="checkbox" class="dispersiTitikCheck" data-val="${escHtml(s.id)}" ${dispersiState.selectedStackIds.has(s.id)?"checked":""}> <span style="width:7px;height:7px;border-radius:50%;background:${s.tipe.color};display:inline-block;flex-shrink:0;"></span> ${escHtml(s.nama)}</label>`).join("")
    : `<div class="xsel-empty">Tidak ada titik yang cocok pencarian.</div>`;
}
function dispersiToggleTitikPanel(){
  dispersiTitikPanelOpen = !dispersiTitikPanelOpen;
  const p = document.getElementById("dispersiTitikPanel");
  if(p) p.style.display = dispersiTitikPanelOpen ? "block" : "none";
  if(dispersiTitikPanelOpen){ dispersiRenderTitikChecklist(); document.getElementById("dispersiTitikSearch")?.focus(); }
}
function dispersiTitikCheckAllVisible(){
  dispersiVisibleTitikOptions().forEach(s=>dispersiState.selectedStackIds.add(s.id));
  dispersiDrawMarkers(); dispersiScheduleUpdatePlume(); dispersiRenderSidePanels(); dispersiRenderTitikChecklist();
}
function dispersiTitikUncheckAllVisible(){
  dispersiVisibleTitikOptions().forEach(s=>dispersiState.selectedStackIds.delete(s.id));
  dispersiDrawMarkers(); dispersiScheduleUpdatePlume(); dispersiRenderSidePanels(); dispersiRenderTitikChecklist();
}
document.addEventListener("change", e=>{
  if(e.target.classList?.contains("dispersiTitikCheck")){
    dispersiToggleStack(e.target.dataset.val);
    dispersiRenderTitikChecklist();
  }
});
document.addEventListener("input", e=>{ if(e.target.id==="dispersiTitikSearch") dispersiRenderTitikChecklist(); });
// Status render plume ("loading"/"no-data"/"ready") ditampilkan di #dispersiPlumeStatus supaya
// user bisa bedakan "lagi dihitung", "memang tidak ada data", atau "beneran macet" — sebelumnya
// diam saja tanpa indikasi apapun kalau plume tidak muncul.
function dispersiSetPlumeStatus(status, message){
  const el = document.getElementById("dispersiPlumeStatus");
  if(!el) return;
  if(status==="loading"){ el.style.color="var(--gray-500)"; el.textContent = "⏳ Menghitung plume…"; }
  else if(status==="no-data"){ el.style.color="#8a5c11"; el.textContent = message||"Tidak ada data untuk ditampilkan."; }
  else if(status==="ready"){ el.style.color="var(--green-500)"; el.textContent = "✓ Plume terhitung · "+new Date().toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit",second:"2-digit"}); }
  else { el.textContent = ""; }
}
let dispersiPlumeComputeTimer = null;
// Dipanggil dari SEMUA pemicu perubahan (ganti site/parameter/periode/stabilitas/seleksi titik/
// mode angin/zoom-geser peta) — didebounce supaya perubahan yg beruntun (mis. gestur zoom) tidak
// memicu hitungan berat berkali-kali, dan status "Menghitung..." langsung tampil sebelum hitungan
// beratnya (sinkron, bisa makan waktu) mulai — beri browser kesempatan mengecat teks itu dulu.
function dispersiScheduleUpdatePlume(delay){
  dispersiSetPlumeStatus("loading");
  clearTimeout(dispersiPlumeComputeTimer);
  // Panel Dampak Kualitas Udara Ambien dibaca dari dispersiState.lastPeakConcUgm3, yang HANYA
  // terisi/dikosongkan di dalam dispersiComputePlumeNow (jalan async lewat setTimeout ini) —
  // tanpa refresh eksplisit di sini, panel itu akan tampil basi (nilai hitungan sebelumnya) sampai
  // ada pemicu render lain yang tidak berhubungan sama sekali dengan selesainya hitungan plume ini.
  dispersiPlumeComputeTimer = setTimeout(()=>{ dispersiComputePlumeNow(); dispersiRefreshAmbientImpactPanel(); dispersiRefreshLegend(); }, delay==null?15:delay);
}
function dispersiRefreshAmbientImpactPanel(){
  const el = document.getElementById("dispersiAmbientImpact");
  if(el) el.innerHTML = dispersiAmbientImpactHtml();
}
function dispersiRefreshLegend(){
  const el = document.getElementById("dispersiLegend");
  if(el) el.innerHTML = dispersiLegendHtml();
}
// Legenda gradien warna plume — warnanya di-normalisasi ulang tiap plume dihitung ulang (puncak
// lokal saat ini = warna paling merah), jadi legendanya HARUS ikut dihitung ulang setiap saat itu
// juga (bukan skala tetap) supaya angka yang ditampilkan sesuai warna yang benar-benar kelihatan
// di peta saat itu — sesuai keluhan "setiap digeser warnanya jadi dynamic, kasih tau ini apa".
function dispersiLegendHtml(){
  const gradientCss = DISPERSI_COLOR_STOPS.map(([f,c])=>`rgb(${c[0]},${c[1]},${c[2]}) ${(f*100).toFixed(0)}%`).join(", ");
  if(!dispersiPlumeLayerObj){
    return `<div class="hint" style="margin-top:6px;">Legenda warna akan muncul setelah plume berhasil dihitung (lihat status di atas).</div>`;
  }
  const qualitative = dispersiIsQualitativeMode();
  const bar = `<div style="height:10px;border-radius:5px;background:linear-gradient(to right, ${gradientCss});border:1px solid var(--gray-300);"></div>`;
  if(qualitative){
    return `<div style="margin-top:8px;">
      ${bar}
      <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--gray-500);margin-top:3px;"><span>Rendah</span><span>Sedang</span><span>Tinggi (relatif thd puncak lokal)</span></div>
      <div class="hint" style="margin-top:4px;">Skala RELATIF (${dispersiIsFlowMode()?"pola keluaran cerobong":"opasitas × laju alir"}) — bukan konsentrasi terukur, jadi tanpa satuan. Warna dinormalisasi ulang tiap plume dihitung ulang (peta digeser/zoom/ganti filter), jadi bukan skala tetap antar tampilan.</div>
    </div>`;
  }
  const peak = dispersiState.lastPeakConcUgm3;
  const decimals = peak==null ? 1 : (peak<1 ? 3 : peak<10 ? 2 : 1);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f=>dispersiFmt((peak||0)*f, decimals));
  return `<div style="margin-top:8px;">
    ${bar}
    <div style="display:flex;justify-content:space-between;font-size:10px;font-family:var(--font-mono);color:var(--gray-500);margin-top:3px;">${ticks.map(t=>`<span>${t}</span>`).join("")}</div>
    <div class="hint" style="margin-top:4px;">Konsentrasi ground-level (µg/m&sup3;) — merah = puncak lokal saat ini (<b>${dispersiFmt(peak,decimals)} µg/m&sup3;</b>), biru tua = mendekati nol. Skala dinormalisasi ulang tiap plume dihitung ulang (peta digeser/zoom/ganti filter/angin), jadi warna yang sama bisa berarti nilai berbeda antar tampilan — selalu baca angka di sini, bukan cuma warnanya.</div>
  </div>`;
}
// --- Util anotasi kartografis kecil, dipakai HANYA utk snapshot statis PDF (bukan peta Leaflet
// interaktif) — cincin jarak, scale bar, panah utara/angin, spy peta cetak tidak "polosan". ---
function dispersiNiceNumber(x){
  if(!(x>0)) return 1;
  const exp = Math.floor(Math.log10(x));
  const base = x/Math.pow(10,exp);
  const niceBase = base<1.5?1:base<3.5?2:base<7.5?5:10;
  return niceBase*Math.pow(10,exp);
}
function dispersiFmtDistance(m){
  return m>=1000 ? dispersiFmt(m/1000,(m%1000===0)?0:1)+" km" : dispersiFmt(m,0)+" m";
}
// Panah generik (dipakai utk panah utara & panah arah angin) — menunjuk ke bearingDeg (0=atas
// kanvas/utara, searah jarum jam, konsisten dgn dispersiPlumeBearing), label kecil di bawahnya.
function dispersiDrawCompassArrow(ctx, cx, cy, len, bearingDeg, color, label){
  const th = bearingDeg*Math.PI/180;
  const dx = Math.sin(th), dy = -Math.cos(th);
  const tipX = cx+dx*len, tipY = cy+dy*len, tailX = cx-dx*len*0.35, tailY = cy-dy*len*0.35;
  ctx.save();
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2.5; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(tailX,tailY); ctx.lineTo(tipX,tipY); ctx.stroke();
  const headLen = len*0.32, headAng = 0.45;
  ctx.beginPath(); ctx.moveTo(tipX,tipY);
  ctx.lineTo(tipX-Math.sin(th+headAng)*headLen, tipY+Math.cos(th+headAng)*headLen);
  ctx.lineTo(tipX-Math.sin(th-headAng)*headLen, tipY+Math.cos(th-headAng)*headLen);
  ctx.closePath(); ctx.fill();
  if(label){
    ctx.font = "700 12px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.fillText(label, cx, cy+len*0.55);
  }
  ctx.restore();
}
// URL basemap statis (Esri REST "export" — bukan ubin XYZ) utk 1 area bbox jadi SATU gambar PNG,
// dipakai lewat <img src> LANGSUNG (bukan digambar ke canvas) — jadi TIDAK PERNAH men-taint canvas
// manapun di sini, beda dgn coba merender tile peta lintas-origin ke dalam canvas (itu bikin
// toDataURL gagal). Basemap ditempatkan sbg lapisan TERPISAH di belakang lapisan plume+anotasi
// (lihat mapSection di buildDispersiReportHtml) — kalau basemap gagal dimuat (mis. tidak ada
// internet sama sekali saat window.print()), lapisan plume+anotasi di atasnya tetap tampil normal.
function dispersiBasemapExportUrl(mode, sw, ne, w, h){
  const service = mode==="street" ? "World_Street_Map" : "World_Imagery";
  const bbox = `${sw.lng},${sw.lat},${ne.lng},${ne.lat}`;
  return `https://server.arcgisonline.com/ArcGIS/rest/services/${service}/MapServer/export?bbox=${bbox}&bboxSR=4326&imageSR=4326&size=${w},${h}&format=png32&transparent=false&f=image`;
}
// Grid konsentrasi 200x200 (CALC) dihitung lalu diperhalus (box blur 3x) supaya batas antar-band
// jadi kurva mulus, dibagi 8 band non-linear (akar pangkat 0.55 spy band rendah tidak keliatan
// kepipihkan oleh puncak plume), lalu diupscale dgn image-smoothing kualitas tinggi ke ukuran
// output sebelum ditempel sbg imageOverlay georeferensi. Kotak geografis & resolusi efektifnya
// SELALU mengikuti VIEWPORT peta saat ini (bukan kotak tetap di sekitar titik) — supaya tidak
// pernah "kepotong" saat zoom out (kotaknya toh selalu sebesar yg kelihatan) atau blur saat zoom in
// (dihitung ulang dgn kotak yg lebih kecil = piksel dunia-nyata lebih rapat).
// Superposisi 16 sektor arah angin dari histori per-jam (dipakai bareng oleh mode Periode & mode
// Kustom — keduanya rentang tanggal angin yg dibobot frekuensi kejadian, cuma beda sumber
// rentangnya) — dipisah dari dispersiComputePlumeNow supaya bisa dipakai ulang tanpa duplikasi.
function dispersiWindCasesFromHistory(hist){
  const N=16, bins=new Array(N).fill(0), speedSum=new Array(N).fill(0);
  hist.forEach(h=>{ const idx=Math.round(h.dir/(360/N))%N; bins[idx]++; speedSum[idx]+=h.speed; });
  const total = hist.length;
  const cases = [];
  for(let i=0;i<N;i++){ if(bins[i]) cases.push({dirFrom:i*(360/N), u:Math.max(speedSum[i]/bins[i],0.5), weight:bins[i]/total}); }
  return cases;
}
// Grid konsentrasi 200x200 dihitung lalu diperhalus (box blur 3x) supaya batas antar-band jadi
// kurva mulus — inti fisika Gaussian plume, dipisah dari dispersiComputePlumeNow supaya bisa
// dipakai ulang PERSIS SAMA oleh render peta interaktif MAUPUN kanvas Mode Expert (timelapse per
// jam), tanpa duplikasi rumus. Murni angka in-out (parameter eksplisit semua, tidak menyentuh
// DOM/Leaflet/dispersiState) — supaya aman dipanggil berulang-ulang cepat (tiap jam) tanpa efek
// samping/state bersama.
function dispersiComputeConcGrid(sources, windCases, stability, centerLat, centerLng, halfWidthM, halfHeightM, GW, GH){
  const grid = new Float32Array(GW*GH);
  const originXY = sources.map(src=>dispersiToLocalXY(src.stack.lat, src.stack.lng, centerLat, centerLng));
  for(let py=0; py<GH; py++){
    const worldY = (0.5-py/GH)*halfHeightM*2;
    for(let px=0; px<GW; px++){
      const worldX = (px/GW-0.5)*halfWidthM*2;
      let total = 0;
      for(let wc=0; wc<windCases.length; wc++){
        const bearing = dispersiPlumeBearing(windCases[wc].dirFrom);
        const u = windCases[wc].u, weight = windCases[wc].weight;
        for(let i=0;i<sources.length;i++){
          const {dx,dy} = originXY[i];
          const {x,y} = dispersiRotateToPlume(worldX-dx, worldY-dy, bearing);
          if(x<=5) continue;
          const {sy,sz} = dispersiSigmaYZ(stability, x);
          total += weight*dispersiGroundConc(sources[i].Qgs, u, sy, sz, sources[i].stack.stackHeight, y);
        }
      }
      grid[py*GW+px] = total;
    }
  }
  const boxBlur = (src)=>{
    const out = new Float32Array(src.length);
    for(let py=0; py<GH; py++){
      for(let px=0; px<GW; px++){
        let sum=0,n=0;
        for(let oy=-1;oy<=1;oy++) for(let ox=-1;ox<=1;ox++){
          const nx=px+ox, ny=py+oy;
          if(nx<0||nx>=GW||ny<0||ny>=GH) continue;
          sum += src[ny*GW+nx]; n++;
        }
        out[py*GW+px] = sum/n;
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
  return {smooth, maxV};
}
// Grid hasil dispersiComputeConcGrid -> kanvas berwarna (8 band non-linear, transparan di luar
// badan plume) — sama spt di atas, dipisah utk dipakai ulang oleh peta interaktif & Mode Expert.
function dispersiGridToColorCanvas(smooth, maxV, GW, GH, OW, OH){
  const canvas = document.createElement("canvas"); canvas.width=GW; canvas.height=GH;
  const ctx = canvas.getContext("2d");
  const BANDS=8;
  const bandOf = (frac)=>Math.min(BANDS-1, Math.floor(Math.pow(frac,0.55)*BANDS));
  const imgData = ctx.createImageData(GW,GH);
  for(let py=0; py<GH; py++){
    for(let px=0; px<GW; px++){
      const i = py*GW+px;
      const frac = smooth[i]/maxV;
      const di = i*4;
      if(frac<0.02){ imgData.data[di+3]=0; continue; }
      const b = bandOf(frac);
      const bandFrac = (b+0.5)/BANDS;
      const [r,g,bl] = dispersiColorForFrac(bandFrac);
      imgData.data[di]=r; imgData.data[di+1]=g; imgData.data[di+2]=bl;
      imgData.data[di+3]=Math.round(Math.min(0.85,0.28+bandFrac*0.6)*255);
    }
  }
  ctx.putImageData(imgData,0,0);
  const outCanvas = document.createElement("canvas"); outCanvas.width=OW; outCanvas.height=OH;
  const octx = outCanvas.getContext("2d");
  octx.imageSmoothingEnabled = true; octx.imageSmoothingQuality = "high";
  octx.drawImage(canvas,0,0,GW,GH,0,0,OW,OH);
  return outCanvas;
}
function dispersiComputePlumeNow(){
  if(!dispersiMapInstance) return;
  if(dispersiPlumeLayerObj){ dispersiMapInstance.removeLayer(dispersiPlumeLayerObj); dispersiPlumeLayerObj=null; }
  // Direset di awal (bukan cuma di jalur sukses) supaya SEMUA early-return "no-data" di bawah
  // otomatis tidak menyisakan puncak konsentrasi BASI dari hitungan sebelumnya di panel Dampak
  // Kualitas Udara Ambien — jalur sukses di akhir fungsi ini yg akan mengisinya lagi kalau relevan.
  dispersiState.lastPeakConcUgm3 = null;
  dispersiState.lastPlumeSnapshotDataUrl = null;
  dispersiState.lastPlumeBasemapUrl = null;
  const flowMode = dispersiIsFlowMode();
  if(!flowMode && !DISPERSI_MASS_PARAMS[dispersiState.param]){ dispersiSetPlumeStatus("no-data","Parameter tidak dikenal."); return; }
  const sel = dispersiResolveSelection(dispersiState.sel);
  if(!sel){ dispersiSetPlumeStatus("no-data","Periode data belum dipilih."); return; }
  const stacks = dispersiStacks().filter(s=>s.site===dispersiState.site && dispersiState.selectedStackIds.has(s.id));
  if(!stacks.length){ dispersiSetPlumeStatus("no-data",'Tidak ada titik terpilih di peta — klik titik, atau tombol "Pilih Semua".'); return; }
  const sources = stacks.map(s=>{
    const q = dispersiQgsForStack(s, dispersiState.param, sel);
    return q==null ? null : {stack:s, Qgs:q};
  }).filter(Boolean);
  if(!sources.length){ dispersiSetPlumeStatus("no-data","Tidak ada data konsentrasi/laju alir pada titik & periode yang dipilih untuk parameter ini."); return; }

  let windCases;
  if(dispersiState.windMode==="periode" || dispersiState.windMode==="custom"){
    const hist = (dispersiState.windMode==="custom" ? dispersiState.customWind : dispersiState.periodWind).history;
    if(!hist.length){ dispersiSetPlumeStatus("no-data",'Data angin periode/rentang kustom belum tersedia — coba "Refresh Angin" (mode Kustom: pastikan rentang tanggal sudah diterapkan).'); return; }
    windCases = dispersiWindCasesFromHistory(hist);
  } else {
    if(dispersiState.wind.dirFrom==null){ dispersiSetPlumeStatus("no-data",'Data angin live belum tersedia — coba "Refresh Angin".'); return; }
    windCases = [{dirFrom:dispersiState.wind.dirFrom, u:Math.max(dispersiState.wind.speed||2,0.5), weight:1}];
  }
  if(!windCases.length){ dispersiSetPlumeStatus("no-data","Data angin tidak cukup untuk dihitung."); return; }

  const viewBounds = dispersiMapInstance.getBounds();
  const sw = viewBounds.getSouthWest(), ne = viewBounds.getNorthEast();
  const centerLat = (sw.lat+ne.lat)/2, centerLng = (sw.lng+ne.lng)/2;
  const halfWidthM = Math.max(200, Math.abs(ne.lng-sw.lng)/2 * dispersiMetersPerDegLng(centerLat));
  const halfHeightM = Math.max(200, Math.abs(ne.lat-sw.lat)/2 * dispersiMetersPerDegLat());
  // Di luar ~30km, asumsi model screening ini (medan datar, angin&stabilitas seragam, tanpa
  // transformasi kimia) sudah tidak realistis, dan grid tetap 200x200 jadi terlalu kasar utk
  // berarti apa2 — daripada merender smear yg keliatan seperti plume "sampai ke benua lain" saat
  // di-zoom-out jauh, plume sengaja tidak dihitung sama sekali di luar jangkauan ini.
  const MAX_HALF_M = 15000;
  if(halfWidthM>MAX_HALF_M || halfHeightM>MAX_HALF_M){
    dispersiSetPlumeStatus("no-data","Peta di-zoom-out terlalu jauh (>30km) untuk menampilkan plume secara berarti — perbesar (zoom in) ke sekitar titik cerobong.");
    return;
  }
  const bounds = [[sw.lat, sw.lng],[ne.lat, ne.lng]];
  // Grid & kanvas output SEBANDING dgn rasio viewport asli (halfWidthM:halfHeightM), BUKAN dipaksa
  // persegi spt sebelumnya — persegi paksa bikin skala meter/piksel X vs Y beda (anisotropik),
  // jadi plume-nya melar/menyusut tidak wajar dibanding tampilan interaktifnya (Leaflet imageOverlay
  // diam2 "membetulkan" ini via bounds-stretch, tapi gambar statis di laporan PDF TIDAK pernah
  // dibetulkan siapapun) — sekaligus inilah penyebab hasil cetak sebelumnya kelihatan "kotak" &
  // kepotong, bukan menampilkan bentuk sebenarnya area yg sedang dilihat.
  const aspect = halfWidthM/halfHeightM;
  const GW = aspect>=1 ? 200 : Math.max(70,Math.round(200*aspect));
  const GH = aspect>=1 ? Math.max(70,Math.round(200/aspect)) : 200;
  const OW = aspect>=1 ? 900 : Math.max(320,Math.round(900*aspect));
  const OH = aspect>=1 ? Math.max(320,Math.round(900/aspect)) : 900;
  const {smooth, maxV} = dispersiComputeConcGrid(sources, windCases, dispersiState.stability, centerLat, centerLng, halfWidthM, halfHeightM, GW, GH);
  // Puncak grid yg SUDAH dihaluskan ini adalah konsentrasi ground-level riil (ug/m3, bukan
  // sekadar nilai relatif 0-1 utk pewarnaan) — disimpan utk panel Dampak Kualitas Udara Ambien.
  dispersiState.lastPeakConcUgm3 = flowMode ? null : maxV;
  const outCanvas = dispersiGridToColorCanvas(smooth, maxV, GW, GH, OW, OH);
  dispersiPlumeLayerObj = L.imageOverlay(outCanvas.toDataURL(), bounds, {opacity:1}).addTo(dispersiMapInstance);
  // Simpan snapshot statis LATAR TRANSPARAN (plume + anotasi kartografis + titik-titik sumber
  // BERNOMOR, TANPA warna latar) utk opsi "sertakan gambar" di export PDF — ditempel sbg lapisan
  // TERPISAH di ATAS gambar basemap riil (dispersiBasemapExportUrl, <img> biasa, lihat mapSection)
  // via CSS position:absolute, bukan digambar bareng ke satu canvas — jadi kanvas ini SENDIRI tetap
  // 100% hasil gambar sendiri (tidak pernah menyentuh pixel tile eksternal apapun), aman dari
  // masalah taint/toDataURL berapa pun basemap-nya nanti berhasil dimuat atau tidak saat cetak.
  // Cincin jarak/scale bar/panah utara & angin ditambahkan supaya tetap informatif walau basemap
  // gagal dimuat — nomor tiap titik dipakai lagi di tabel "Indeks Titik" pada laporan PDF.
  const snapCanvas = document.createElement("canvas"); snapCanvas.width=OW; snapCanvas.height=OH;
  const sctx = snapCanvas.getContext("2d");
  // Grid & output kini SEBANDING dgn rasio viewport asli (lihat GW/GH/OW/OH di atas), jadi
  // meter/piksel X == meter/piksel Y (isotropik) — cincin jarak skrg lingkaran sungguhan, bukan
  // elips lagi.
  const pxPerM = OW/(halfWidthM*2);
  const scx = OW/2, scy = OH/2;
  const ringStep = dispersiNiceNumber(Math.min(halfWidthM,halfHeightM)/2.6);
  sctx.save();
  sctx.strokeStyle = "rgba(13,31,56,.16)"; sctx.lineWidth = 1;
  sctx.font = "10px sans-serif"; sctx.fillStyle = "rgba(13,31,56,.6)"; sctx.textBaseline = "bottom";
  for(let r=ringStep, n=0; r<Math.max(halfWidthM,halfHeightM)*1.45 && n<6; r+=ringStep, n++){
    sctx.beginPath(); sctx.arc(scx,scy,r*pxPerM,0,Math.PI*2); sctx.stroke();
    const lx = scx + r*pxPerM*Math.SQRT1_2, ly = scy - r*pxPerM*Math.SQRT1_2;
    if(lx<OW-32 && lx>0 && ly>16) sctx.fillText(dispersiFmtDistance(r), lx+3, ly-2);
  }
  sctx.restore();
  sctx.drawImage(outCanvas,0,0,OW,OH);
  const sourcePins = sources.map((src,i)=>{
    const {dx,dy} = dispersiToLocalXY(src.stack.lat, src.stack.lng, centerLat, centerLng);
    return {no:i+1, stack:src.stack, px:scx+dx*pxPerM, py:scy-dy*pxPerM};
  });
  sourcePins.forEach(pin=>{
    sctx.beginPath(); sctx.arc(pin.px,pin.py,9,0,Math.PI*2);
    sctx.fillStyle = pin.stack.tipe.color; sctx.fill();
    sctx.lineWidth = 1.8; sctx.strokeStyle = "#fff"; sctx.stroke();
    sctx.lineWidth = 1; sctx.strokeStyle = "#0d1f38"; sctx.stroke();
    sctx.font = "700 10px sans-serif"; sctx.fillStyle = "#fff"; sctx.textAlign = "center"; sctx.textBaseline = "middle";
    sctx.fillText(String(pin.no), pin.px, pin.py+0.5);
  });
  sctx.textAlign = "left";
  // Panah utara (peta tidak dirotasi, atas kanvas = Utara — sama spt konvensi worldY di grid plume).
  dispersiDrawCompassArrow(sctx, OW-46, 46, 22, 0, "#0d1f38", "U");
  // Panah arah angin dominan (kasus berbobot terbesar kalau mode Periode; satu-satunya kasus kalau
  // Live) — bearingnya SAMA dgn dispersiPlumeBearing yg dipakai menghitung plume-nya sendiri, jadi
  // panahnya konsisten dgn ke mana plume sungguhan mengarah, bukan sekadar dekorasi lepas.
  const dominantCase = windCases.reduce((a,b)=>(b.weight>a.weight?b:a), windCases[0]);
  dispersiDrawCompassArrow(sctx, 46, 46, 22, dispersiPlumeBearing(dominantCase.dirFrom), "#1a6fb0", `${dispersiFmt(dominantCase.u,1)} m/s`);
  // Scale bar bawah-kiri — lebar piksel target dulu, lalu dibulatkan ke angka meter yg "enak dibaca".
  const niceM = dispersiNiceNumber((Math.min(OW,OH)*0.24)/pxPerM);
  const barPx = niceM*pxPerM, barX = 24, barY = OH-28;
  sctx.save();
  sctx.strokeStyle = "#0d1f38"; sctx.fillStyle = "#0d1f38"; sctx.lineWidth = 2;
  sctx.beginPath(); sctx.moveTo(barX,barY); sctx.lineTo(barX+barPx,barY); sctx.stroke();
  [barX,barX+barPx].forEach(x=>{ sctx.beginPath(); sctx.moveTo(x,barY-5); sctx.lineTo(x,barY+5); sctx.stroke(); });
  sctx.font = "11px sans-serif"; sctx.textAlign = "left"; sctx.textBaseline = "bottom";
  sctx.fillText(dispersiFmtDistance(niceM), barX, barY-7);
  sctx.restore();

  dispersiState.lastPlumeSnapshotDataUrl = snapCanvas.toDataURL();
  dispersiState.lastPlumeBasemapUrl = dispersiBasemapExportUrl(dispersiState.mapLayer, sw, ne, OW, OH);
  dispersiState.lastPlumeSnapshotMeta = {
    site:dispersiState.site, paramLabel:dispersiCurrentParamMeta().label, windMode:dispersiState.windMode,
    stability:dispersiState.stability, sel:dispersiSelectionLabel(dispersiState.sel),
    peakConcUgm3: dispersiState.lastPeakConcUgm3, qualitative: flowMode || dispersiIsQualitativeMode(),
    windDirFrom: dominantCase.dirFrom, windSpeed: dominantCase.u, aspectW: OW, aspectH: OH,
    sourceIndex: sourcePins.map(p=>({no:p.no, nama:p.stack.nama, tipe:p.stack.tipe.key, color:p.stack.tipe.color}))
  };
  dispersiSetPlumeStatus("ready");
}

/* ---------- Builder tabel/panel (dipakai bareng oleh tampilan layar & export PDF) ---------- */
function dispersiSelectedStacks(){
  return dispersiStacks().filter(s=>s.site===dispersiState.site && dispersiState.selectedStackIds && dispersiState.selectedStackIds.has(s.id));
}
function dispersiBebanRowsHtml(stacks, param, sel){
  const rows = stacks.map(s=>{
    const b = dispersiBebanForSelection(s, param, sel);
    const heightNote = s.stackHeightIsDefault ? " title=\"Tinggi cerobong pakai perkiraan standar jenis sumber (belum diinput manual) — lihat Database Titik Pantau.\"" : "";
    const nameCell = `<span style="width:8px;height:8px;border-radius:50%;background:${s.tipe.color};display:inline-block;margin-right:5px;"></span>${escHtml(s.nama)}<span${heightNote} style="color:var(--gray-500);">${s.stackHeightIsDefault?" ~":""}</span>`;
    if(!b){
      return `<tr><td>${nameCell}</td>
        <td style="text-align:right;">—</td><td style="text-align:right;">—</td><td style="text-align:right;">—</td><td style="text-align:right;">—</td><td style="text-align:right;">—</td><td style="text-align:right;">—</td></tr>`;
    }
    // carriedFrom: engine ini tidak wajib/tidak dijadwalkan sampling PERSIS di periode terpilih
    // (mis. frekuensi 1x/tahun) — hasil terakhirnya (dari periode carriedFrom) masih dipakai,
    // BUKAN dikosongkan, karena secara teknis nilai itu masih berlaku sampai jadwal berikutnya.
    const carryNote = b.carriedFrom ? ` <span title="Belum ada sampling baru di periode ini — memakai hasil terakhir dari ${escHtml(b.carriedFrom)}" style="color:var(--amber-500);font-weight:700;cursor:help;">†</span>` : "";
    return `<tr><td>${nameCell}${carryNote}</td>
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
      const carryNote = c.carriedFrom ? ` <span title="Belum ada sampling baru di periode ini — memakai hasil terakhir dari ${escHtml(c.carriedFrom)}" style="color:var(--amber-500);font-weight:700;cursor:help;">†</span>` : "";
      rows.push(`<tr><td style="font-weight:600;">${escHtml(s.nama)}</td><td style="color:var(--gray-700);">${escHtml(param)}${carryNote}</td>
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
// Wind rose SEBENARNYA (polar diagram baku ilmu meteorologi): 8 arah mata angin, tiap "petal"
// ditumpuk (stacked) per kelas kecepatan angin — bukan cuma 1 batang polos spt sebelumnya. Dibangun
// sbg SVG dgn viewBox tetap (BUKAN posisi persentase absolut spt versi lama yg lx/ly-nya bisa
// tembus s/d 120% dari kotak 112px & numpuk ke panel Tren di sebelahnya) — viewBox SVG otomatis
// membungkus semua elemen yg digambar di dalam koordinatnya sendiri, jadi tidak mungkin meluber
// keluar kotak berapa pun ukuran tampil kotaknya. Panjang tiap petal = persentase kejadian dari
// TOTAL jam data (bukan relatif ke arah terbanyak saja) supaya skalanya bisa dibaca lintas render.
function dispersiWindRoseHtml(history){
  const hist = (history||[]).filter(h=>h && h.dir!=null && h.speed!=null);
  if(!hist.length) return `<div class="hint" style="width:128px;">Belum ada data histori angin.</div>`;
  const SPEED_BINS = DISPERSI_SPEED_BINS;
  const total = hist.length;
  let calmCount = 0;
  const bins = DISPERSI_COMPASS8.map(()=>SPEED_BINS.map(()=>0));
  hist.forEach(h=>{
    if(h.speed<0.5){ calmCount++; return; }
    const d = Math.round(h.dir/45)%8;
    let bi = SPEED_BINS.findIndex(sb=>h.speed<sb.max);
    if(bi<0) bi = SPEED_BINS.length-1;
    bins[d][bi]++;
  });
  const dirTotalsPct = bins.map(row=>row.reduce((a,b)=>a+b,0)/total*100);
  const rawMax = Math.max(...dirTotalsPct, 0.001);
  const niceMax = rawMax<=10 ? Math.ceil(rawMax/2.5)*2.5 : Math.ceil(rawMax/5)*5;
  const cx=64, cy=64, rInner=8, rMax=44;
  const scale = (rMax-rInner)/niceMax;
  const labelA = 22.5*Math.PI/180; // sisipkan label cincin di antara N & NE spy tak numpuk petal
  const gridRings = [0.25,0.5,0.75,1].map(f=>{
    const r = rInner+(rMax-rInner)*f;
    const lx = cx+Math.sin(labelA)*r, ly = cy-Math.cos(labelA)*r;
    return `<circle cx="${cx}" cy="${cy}" r="${r.toFixed(1)}" fill="none" stroke="var(--gray-200)" stroke-width="1"/><text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" font-size="6" fill="var(--gray-400)" text-anchor="middle">${dispersiFmt(niceMax*f, niceMax*f<10?1:0)}%</text>`;
  }).join("");
  const spokes = DISPERSI_COMPASS8.map((_,i)=>{
    const a = i*45*Math.PI/180;
    const x2 = cx+Math.sin(a)*rMax, y2 = cy-Math.cos(a)*rMax;
    return `<line x1="${cx}" y1="${cy}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="var(--gray-200)" stroke-width="1"/>`;
  }).join("");
  const petals = DISPERSI_COMPASS8.map((label,i)=>{
    const a = i*45*Math.PI/180, dx = Math.sin(a), dy = -Math.cos(a);
    let rCursor = rInner;
    const segs = SPEED_BINS.map((sb,bi)=>{
      const pct = bins[i][bi]/total*100;
      if(!pct) return "";
      const r0=rCursor, r1=rCursor+pct*scale; rCursor=r1;
      const x1=(cx+dx*r0).toFixed(1), y1=(cy+dy*r0).toFixed(1), x2=(cx+dx*r1).toFixed(1), y2=(cy+dy*r1).toFixed(1);
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${sb.color}" stroke-width="9" stroke-linecap="butt"><title>${label} &middot; ${sb.label} m/s: ${dispersiFmt(pct,1)}%</title></line>`;
    }).join("");
    const lx = cx+Math.sin(a)*(rMax+11), ly = cy-Math.cos(a)*(rMax+11);
    return segs+`<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" font-size="9" font-weight="700" fill="var(--gray-600)" text-anchor="middle" dominant-baseline="middle">${label}</text>`;
  }).join("");
  const legend = SPEED_BINS.map(sb=>`<span style="display:inline-flex;align-items:center;gap:3px;"><span style="width:7px;height:7px;border-radius:1.5px;background:${sb.color};display:inline-block;flex-shrink:0;"></span>${sb.label}</span>`).join("");
  const calmPct = calmCount/total*100;
  return `<svg viewBox="0 0 128 128" width="128" height="128" style="display:block;margin:0 auto;max-width:100%;overflow:visible;">${gridRings}${spokes}${petals}</svg>
    <div style="display:flex;flex-wrap:wrap;gap:4px 7px;justify-content:center;font-size:8px;color:var(--gray-500);margin-top:5px;max-width:128px;margin-left:auto;margin-right:auto;">${legend}</div>
    <div class="hint" style="text-align:center;margin-top:3px;font-size:9.5px;">m/s &middot; n=${total} jam${calmPct>=0.5?` &middot; tenang (&lt;0,5 m/s) ${dispersiFmt(calmPct,1)}%`:""}</div>`;
}
// Sparkline tren kecepatan angin dari histori per-jam yg SAMA dgn dipakai wind rose (bukan
// panggilan API baru) — didownsample maks 24 batang (rata-rata per kelompok jam) supaya tetap
// terbaca walau rentang periode berisi ribuan jam data.
function dispersiWindTrendHtml(history){
  if(!history || !history.length) return `<div class="hint">Belum ada data untuk ditampilkan.</div>`;
  const BUCKETS = Math.min(24, history.length);
  const bucketSize = Math.ceil(history.length/BUCKETS);
  const bars = [];
  for(let i=0;i<history.length;i+=bucketSize){
    const chunk = history.slice(i, i+bucketSize);
    bars.push(chunk.reduce((a,h)=>a+h.speed,0)/chunk.length);
  }
  const maxV = Math.max(1, ...bars);
  const avg = bars.reduce((a,b)=>a+b,0)/bars.length;
  return `<div style="display:flex;align-items:flex-end;gap:2px;height:70px;">
    ${bars.map(v=>`<div style="flex:1;background:var(--teal-400);border-radius:2px 2px 0 0;height:${Math.max(3,Math.round(v/maxV*66))}px;" title="${dispersiFmt(v,1)} m/s"></div>`).join("")}
  </div>
  <div class="hint" style="margin-top:3px;display:flex;justify-content:space-between;font-size:9.5px;"><span>${dispersiFmt(Math.min(...bars),1)} min</span><span>${dispersiFmt(avg,1)} rata-rata</span><span>${dispersiFmt(Math.max(...bars),1)} maks (m/s)</span></div>`;
}
// Bandingkan puncak konsentrasi ground-level hasil model (sudah dihitung di dispersiComputePlumeNow,
// nilai riil ug/m3 bukan sekadar skala warna) thd baku mutu ambien — mengisi ruang kosong panel
// Data Angin sekaligus memberi konteks "seberapa besar dampaknya" spt diminta, dgn disclaimer jelas
// ini estimasi screening (bukan simulasi meteorologi tahunan penuh spt AERMOD regulatory).
function dispersiAmbientImpactHtml(){
  if(dispersiIsQualitativeMode()) return `<div class="hint">Perbandingan baku mutu ambien tidak berlaku utk mode "${escHtml(dispersiCurrentParamMeta().label)}" (pola relatif, bukan konsentrasi massa) — pilih parameter pencemar bersatuan massa (NOx/SO₂/CO/Partikulat).</div>`;
  const std = DISPERSI_AMBIENT_STD[dispersiState.param];
  if(!std) return "";
  const peak = dispersiState.lastPeakConcUgm3;
  if(peak==null) return `<div class="hint">Belum ada plume terhitung pada titik/angin saat ini.</div>`;
  const rows = [];
  Object.entries(std.pp22||{}).forEach(([period,val])=>rows.push({source:"PP 22/2021 (Nasional)", period, val}));
  Object.entries(std.epa||{}).forEach(([period,val])=>rows.push({source:"US EPA NAAQS", period, val}));
  return `
    <div style="font-size:10px;color:var(--gray-500);text-transform:uppercase;letter-spacing:.02em;margin-bottom:3px;">Konsentrasi Puncak Terdekat Sumber &middot; ${escHtml(std.ambientLabel)}</div>
    <div style="font-family:var(--font-mono);font-size:19px;font-weight:800;color:var(--heading);margin-bottom:6px;">${dispersiFmt(peak,1)} <span style="font-size:11px;font-weight:600;color:var(--gray-500);">µg/m³</span></div>
    <table style="width:100%;border-collapse:collapse;font-size:10.5px;">
      <thead><tr><th style="text-align:left;padding:2px 4px;color:var(--gray-500);font-weight:600;">Acuan</th><th style="text-align:right;padding:2px 4px;color:var(--gray-500);font-weight:600;">Ambang</th><th style="text-align:right;padding:2px 4px;color:var(--gray-500);font-weight:600;">%</th></tr></thead>
      <tbody>${rows.map(r=>{
        const pct = Math.round(peak/r.val*1000)/10;
        const color = pct>100?"#a02a24":pct>50?"#8a5c11":"#1c7a4f";
        return `<tr style="border-top:1px solid var(--gray-200);"><td style="padding:2px 4px;">${escHtml(r.source)} <span style="color:var(--gray-500);">(${escHtml(r.period)})</span></td><td style="text-align:right;padding:2px 4px;font-family:var(--font-mono);">${dispersiFmt(r.val,0)}</td><td style="text-align:right;padding:2px 4px;font-family:var(--font-mono);font-weight:700;color:${color};">${dispersiFmt(pct,0)}%</td></tr>`;
      }).join("")}</tbody>
    </table>
    <div class="hint" style="margin-top:6px;">Nilai TERTINGGI di mana pun dalam tampilan peta saat ini (biasanya persis di dekat cerobong, bukan di lokasi reseptor publik) — estimasi screening 1 kombinasi angin+stabilitas dari mode ${dispersiWindModeLabel(dispersiState.windMode)}, bukan rata-rata 24 jam/tahunan tervalidasi. Kajian AMDAL/kepatuhan resmi perlu simulasi meteorologi per jam min. 1 tahun (AERMOD penuh); silangkan angka baku mutu nasional ke teks resmi PP 22/2021 sebelum dipakai pelaporan.</div>
  `;
}
function dispersiWindPanelHtml(){
  const s = dispersiState;
  if(s.windMode==="live"){
    const blowTo = ((s.wind.dirFrom||0)+180)%360;
    const extra = [];
    if(s.wind.temp!=null) extra.push(`${dispersiFmt(s.wind.temp,1)}°C`);
    if(s.wind.humidity!=null) extra.push(`Kelembapan ${dispersiFmt(s.wind.humidity,0)}%`);
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
        <div style="font-size:12px;color:var(--gray-700);margin-top:2px;">dari ${s.wind.dirFrom!=null?dispersiCompassLabel(s.wind.dirFrom):"—"} (${s.wind.dirFrom!=null?Math.round(s.wind.dirFrom):"—"}°)</div>
        ${extra.length?`<div style="font-size:11.5px;color:var(--gray-700);margin-top:3px;">${extra.join(" &middot; ")}</div>`:""}
        <div style="font-size:10.5px;color:var(--gray-500);margin-top:5px;">Sumber: Open-Meteo &middot; ${s.wind.updatedAt?new Date(s.wind.updatedAt).toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit"}):"—"} &middot; auto-refresh 5 menit</div>
      </div>
    </div>
    ${s.wind.error?`<div style="font-size:11px;color:#a02a24;margin-top:8px;">${escHtml(s.wind.error)}</div>`:""}`;
  }
  if(s.windMode==="custom"){
    if(!s.customWind.start || !s.customWind.end) return `<div class="hint">Pilih rentang tanggal bebas di atas, lalu klik "Terapkan" untuk memuat pola angin pada rentang tersebut.</div>`;
    return dispersiWindStatsGridHtml(s.customWind);
  }
  return dispersiWindStatsGridHtml(s.periodWind);
}
// Grid statistik angin (rata-rata kecepatan, arah dominan, jumlah sampel, rentang tanggal dipakai)
// — dipakai bareng oleh mode Periode & mode Kustom, keduanya sama-sama hasil
// dispersiFetchArchiveWindAggregate jadi bentuk datanya identik, cuma beda sumber rentang tanggal.
function dispersiWindStatsGridHtml(w){
  const extraRows = [];
  if(w.avgTemp!=null) extraRows.push(`<div><div style="font-size:10px;color:var(--gray-500);text-transform:uppercase;">Suhu Rata-rata</div><div style="font-family:var(--font-mono);font-size:14px;font-weight:700;color:var(--gray-700);">${dispersiFmt(w.avgTemp,1)}°C</div></div>`);
  if(w.avgHumidity!=null) extraRows.push(`<div><div style="font-size:10px;color:var(--gray-500);text-transform:uppercase;">Kelembapan Rata-rata</div><div style="font-family:var(--font-mono);font-size:14px;font-weight:700;color:var(--gray-700);">${dispersiFmt(w.avgHumidity,0)}%</div></div>`);
  return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
    <div><div style="font-size:10px;color:var(--gray-500);text-transform:uppercase;">Rata-rata Kecepatan</div><div style="font-family:var(--font-mono);font-size:18px;font-weight:800;color:var(--heading);">${w.avgSpeed!=null?dispersiFmt(w.avgSpeed,1):"—"} <span style="font-size:11px;font-weight:600;color:var(--gray-500);">m/s</span></div></div>
    <div><div style="font-size:10px;color:var(--gray-500);text-transform:uppercase;">Arah Dominan</div><div style="font-family:var(--font-mono);font-size:18px;font-weight:800;color:var(--heading);">${w.dominantLabel||"—"}</div></div>
    <div><div style="font-size:10px;color:var(--gray-500);text-transform:uppercase;">Sampel Per Jam</div><div style="font-family:var(--font-mono);font-size:13px;font-weight:700;color:var(--gray-700);">${w.sampleCount}</div></div>
    <div><div style="font-size:10px;color:var(--gray-500);text-transform:uppercase;">Rentang Dipakai</div><div style="font-size:11px;font-weight:600;color:var(--gray-700);">${escHtml(w.historyLabel||"—")}</div></div>
    ${extraRows.join("")}
  </div>
  ${w.error?`<div style="font-size:11px;color:#a02a24;margin-top:8px;">${escHtml(w.error)}</div>`:""}
  ${w.clamped?`<div style="font-size:10.5px;color:#8a5c11;margin-top:6px;">Delay arsip Open-Meteo ~5 hari — tanggal akhir dipotong ke data terbaru yang tersedia.</div>`:""}`;
}
function dispersiDashboardStatsHtml(){
  const stacks = dispersiSelectedStacks();
  const totalEmisi = dispersiStacks().filter(s=>s.site===dispersiState.site).length;
  const sel = dispersiResolveSelection(dispersiState.sel);
  const windNow = dispersiState.windMode==="live"
    ? (dispersiState.wind.speed!=null ? `${dispersiFmt(dispersiState.wind.speed,1)} m/s, dari ${dispersiCompassLabel(dispersiState.wind.dirFrom)}` : "—")
    : (dispersiActiveWindAgg().avgSpeed!=null ? `${dispersiFmt(dispersiActiveWindAgg().avgSpeed,1)} m/s, dominan ${dispersiActiveWindAgg().dominantLabel}` : "—");
  if(dispersiIsQualitativeMode()){
    const withData = stacks.filter(s=>dispersiQgsForStack(s, dispersiState.param, sel)!=null).length;
    const modeLabel = dispersiCurrentParamMeta().label;
    return `<div class="grid cols-4">
      <div class="stat"><div class="num">${withData}/${totalEmisi}</div><div class="lbl">Titik dgn Data &middot; ${escHtml(dispersiState.site||"")}</div></div>
      <div class="stat"><div class="num">${stacks.length}</div><div class="lbl">Titik Ditampilkan di Peta</div></div>
      <div class="stat"><div class="num">${escHtml(dispersiState.stability)}</div><div class="lbl">Kelas Stabilitas Atmosfer</div></div>
      <div class="stat"><div class="num">${dispersiWindModeLabel(dispersiState.windMode)}</div><div class="lbl">Sumber Angin Plume</div></div>
    </div>
    <div class="hint" style="margin-top:8px;">Mode ${escHtml(modeLabel)}: pola sebaran relatif, bukan beban pencemar teregulasi. Angin saat ini (${dispersiState.windMode==="live"?"Live":"rata-rata "+dispersiWindModeLabel(dispersiState.windMode)}): <b>${windNow}</b> &middot; Periode data: <b>${escHtml(dispersiSelectionLabel(dispersiState.sel))}</b></div>`;
  }
  let withData=0, bebanBulanTotal=0, bebanTahunTotal=0, exceedCount=0;
  stacks.forEach(s=>{
    const b = dispersiBebanForSelection(s, dispersiState.param, sel);
    if(b){ withData++; bebanBulanTotal+=b.bebanBulanKg||0; bebanTahunTotal+=b.bebanTahunTon||0; }
    Object.keys(DISPERSI_MASS_PARAMS).concat(DISPERSI_COMPLIANCE_EXTRA).forEach(p=>{
      const c = dispersiComplianceRow(s, p, sel);
      if(c && c.rec.statusBakuMutu==="exceed") exceedCount++;
    });
  });
  return `<div class="grid cols-4">
    <div class="stat"><div class="num">${withData}/${totalEmisi}</div><div class="lbl">Titik dgn Data Dispersi &middot; ${escHtml(dispersiState.site||"")}</div></div>
    <div class="stat good"><div class="num">${dispersiFmt(bebanBulanTotal,1)}</div><div class="lbl">Total kg ${escHtml(dispersiState.param)}/bulan (terpilih)</div></div>
    <div class="stat"><div class="num">${dispersiFmt(bebanTahunTotal,2)}</div><div class="lbl">Total ton ${escHtml(dispersiState.param)}/tahun (terpilih)</div></div>
    <div class="stat ${exceedCount?"bad":"good"}"><div class="num">${exceedCount}</div><div class="lbl">Parameter Melebihi Baku Mutu</div></div>
  </div>
  <div class="hint" style="margin-top:8px;">Angin saat ini (${dispersiState.windMode==="live"?"Live":"rata-rata "+dispersiWindModeLabel(dispersiState.windMode)}): <b>${windNow}</b> &middot; Periode data: <b>${escHtml(dispersiSelectionLabel(dispersiState.sel))}</b></div>`;
}

/* ---------- Render halaman ---------- */
function dispersiChip(active, action, val, label){
  return `<button type="button" class="chip-toggle ${active?"active":""}" data-action="${action}" data-val="${escHtml(val)}">${escHtml(label)}</button>`;
}
function dispersiParamChipsHtml(){
  return Object.keys(DISPERSI_MASS_PARAMS).map(p=>dispersiChip(p===dispersiState.param,"dispersiSetParam",p,DISPERSI_MASS_PARAMS[p].label)).join("")
    + dispersiChip(dispersiState.param===DISPERSI_FLOW_MODE_KEY, "dispersiSetParam", DISPERSI_FLOW_MODE_KEY, DISPERSI_FLOW_MODE_META.label);
}
function dispersiCurrentParamMeta(){ return dispersiIsFlowMode() ? DISPERSI_FLOW_MODE_META : DISPERSI_MASS_PARAMS[dispersiState.param]; }
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
  const titikPanelEl = document.getElementById("dispersiTitikPanel");
  if(titikPanelEl) titikPanelEl.style.display = dispersiTitikPanelOpen ? "block" : "none";
  dispersiRenderTitikChecklist();
  document.getElementById("dispersiParamChips").innerHTML = dispersiParamChipsHtml();
  const periodSel = document.getElementById("dispersiPeriode");
  const periodOptions = dispersiPeriodList().map(({periode})=>`<option value="${periode}">${periode}</option>`).join("")
    + dispersiYearList().filter(y=>y.periods.length>1).map(y=>`<option value="Y:${y.tahun}">Tahun ${y.tahun} (rata-rata S1+S2)</option>`).join("");
  periodSel.innerHTML = periodOptions;
  periodSel.value = dispersiState.sel;
  document.getElementById("dispersiStability").value = dispersiState.stability;
  document.getElementById("dispersiLiveBtn").classList.toggle("active", dispersiState.windMode==="live");
  document.getElementById("dispersiPeriodeBtn").classList.toggle("active", dispersiState.windMode==="periode");
  document.getElementById("dispersiCustomBtn").classList.toggle("active", dispersiState.windMode==="custom");
  const customRow = document.getElementById("dispersiCustomWindRow");
  if(customRow) customRow.style.display = dispersiState.windMode==="custom" ? "flex" : "none";
  if(dispersiState.windMode==="custom"){
    const fromEl = document.getElementById("dispersiCustomFrom"), toEl = document.getElementById("dispersiCustomTo");
    if(fromEl && !fromEl.value) fromEl.value = dispersiState.customWind.start || new Date(Date.now()-7*86400000).toISOString().slice(0,10);
    if(toEl && !toEl.value) toEl.value = dispersiState.customWind.end || new Date().toISOString().slice(0,10);
  }
  document.getElementById("dispersiSatBtn").classList.toggle("active", dispersiState.mapLayer==="satellite");
  document.getElementById("dispersiStreetBtn").classList.toggle("active", dispersiState.mapLayer==="street");
  document.getElementById("dispersiParamDesc").textContent = dispersiCurrentParamMeta().desc;

  document.getElementById("dispersiStats").innerHTML = dispersiDashboardStatsHtml();

  // fitBounds SENGAJA tidak dipanggil di sini (cuma di dispersiSetSite/dispersiInitMap) — dipanggil
  // di tiap render akan mereset pan/zoom user tiap ganti parameter/mode angin/layer peta, padahal
  // yg diinginkan adalah plume mengikuti VIEW SAAT INI, bukan paksa balik ke framing awal site.
  if(!dispersiMapInstance) dispersiInitMap();
  else {
    dispersiDrawMarkers();
    dispersiScheduleUpdatePlume();
  }
  dispersiRenderSidePanels();
  dispersiEnsureWindTimer();
}
// Bagian yang TIDAK butuh peta digambar ulang (tabel, panel angin, ringkasan, tren) — dipisah
// dari renderDispersi supaya toggle marker/refresh angin tidak perlu re-init peta Leaflet.
function dispersiRenderSidePanels(){
  const stacks = dispersiSelectedStacks();
  const sel = dispersiResolveSelection(dispersiState.sel);
  const qualitativeMode = dispersiIsQualitativeMode();
  const windHist = dispersiState.windMode==="live" ? dispersiState.wind.history : dispersiActiveWindAgg().history;
  const windHistLabel = dispersiState.windMode==="live" ? dispersiState.wind.historyLabel : dispersiActiveWindAgg().historyLabel;
  document.getElementById("dispersiWindPanel").innerHTML = dispersiWindPanelHtml();
  const roseLabelEl = document.getElementById("dispersiWindRoseLabel");
  if(roseLabelEl) roseLabelEl.textContent = windHistLabel ? " · "+windHistLabel : "";
  document.getElementById("dispersiWindRose").innerHTML = dispersiWindRoseHtml(windHist);
  document.getElementById("dispersiWindTrend").innerHTML = dispersiWindTrendHtml(windHist);
  document.getElementById("dispersiAmbientImpact").innerHTML = dispersiAmbientImpactHtml();
  dispersiRefreshLegend();
  const naNote = `<tr><td colspan="7" style="text-align:center;color:var(--gray-500);padding:14px;">Tidak berlaku utk mode "${escHtml(dispersiCurrentParamMeta().label)}" (pola relatif) — pilih salah satu parameter bersatuan massa (NOx/SO₂/CO/Partikulat) untuk melihat beban.</td></tr>`;
  document.getElementById("dispersiBebanTable").innerHTML = qualitativeMode ? naNote : dispersiBebanRowsHtml(stacks, dispersiState.param, sel);
  document.getElementById("dispersiComplianceTable").innerHTML = dispersiComplianceRowsHtml(stacks, sel);
  // Kedua tabel ringkasan ini SENGAJA lintas-site (dispersiStacks() penuh, bukan stacks yg
  // di-scope ke site+seleksi map saat ini) — tujuannya beri konteks gambaran besar (semua site,
  // semua jenis sumber) sebagai pelengkap peta yang fokus ke satu site, bukan duplikat filter peta.
  const allStacks = dispersiStacks();
  const naHint = `<div class="hint">Tidak berlaku utk mode "${escHtml(dispersiCurrentParamMeta().label)}" (pola relatif) — pilih parameter bersatuan massa.</div>`;
  document.getElementById("dispersiSummaryTipe").innerHTML = qualitativeMode ? naHint : dispersiSummaryTableHtml(allStacks, dispersiState.param, sel, s=>s.tipe.key, {head:"Jenis Sumber", row:k=>k}, s=>s.tipe.color);
  document.getElementById("dispersiSummarySite").innerHTML = qualitativeMode ? naHint : dispersiSummaryTableHtml(allStacks, dispersiState.param, sel, s=>s.site, {head:"Site", row:k=>k});
  document.getElementById("dispersiTrend").innerHTML = qualitativeMode ? naHint : dispersiTrendHtml();
  dispersiRenderTipeChips();
}
function dispersiSetSite(el){
  dispersiState.site = el.dataset.val;
  dispersiState.selectedStackIds = new Set(dispersiStacks().filter(s=>s.site===dispersiState.site).map(s=>s.id));
  dispersiRefreshWind();
  renderDispersi();
  // Reframe peta ke titik-titik site BARU — satu-satunya kasus yg boleh mereset pan/zoom user,
  // krn site sebelumnya bisa jadi ada di lokasi geografis yg sama sekali berbeda.
  if(dispersiMapInstance) dispersiFitSiteBounds();
}
function dispersiSetParam(el){
  dispersiState.param = el.dataset.val;
  dispersiScheduleUpdatePlume();
  dispersiRenderSidePanels();
  document.getElementById("dispersiParamChips").innerHTML = dispersiParamChipsHtml();
  document.getElementById("dispersiParamDesc").textContent = dispersiCurrentParamMeta().desc;
  document.getElementById("dispersiStats").innerHTML = dispersiDashboardStatsHtml();
}
function dispersiOnPeriodeChange(){ dispersiState.sel = document.getElementById("dispersiPeriode").value; dispersiRefreshWind(); dispersiScheduleUpdatePlume(); dispersiRenderSidePanels(); document.getElementById("dispersiStats").innerHTML = dispersiDashboardStatsHtml(); }
function dispersiOnStabilityChange(){ dispersiState.stability = document.getElementById("dispersiStability").value; dispersiScheduleUpdatePlume(); }
function dispersiSetWindModeLive(){ dispersiState.windMode="live"; dispersiRefreshWind(); renderDispersi(); }
function dispersiSetWindModePeriode(){ dispersiState.windMode="periode"; dispersiRefreshWind(); renderDispersi(); }
// Mode Kustom SENGAJA tidak langsung fetch spt Live/Periode di atas (belum tentu ada rentang
// tanggal yg valid saat baru pindah mode) — nunggu user isi 2 tanggal & klik "Terapkan"
// (dispersiApplyCustomWindRange) baru benar2 query Open-Meteo.
function dispersiSetWindModeCustom(){ dispersiState.windMode="custom"; renderDispersi(); }
function dispersiApplyCustomWindRange(){
  const from = document.getElementById("dispersiCustomFrom")?.value;
  const to = document.getElementById("dispersiCustomTo")?.value;
  if(!from || !to){ toast("Isi tanggal awal dan akhir dulu.","err"); return; }
  if(from>to){ toast("Tanggal awal harus sebelum atau sama dengan tanggal akhir.","err"); return; }
  dispersiState.customWind = {...dispersiState.customWind, start:from, end:to};
  dispersiFetchCustomWind();
}
function dispersiSetMapLayerSat(){ dispersiSetMapLayer("satellite"); }
function dispersiSetMapLayerStreet(){ dispersiSetMapLayer("street"); }
function dispersiSelectAllAtSite(){ dispersiState.selectedStackIds = new Set(dispersiStacks().filter(s=>s.site===dispersiState.site).map(s=>s.id)); dispersiDrawMarkers(); dispersiScheduleUpdatePlume(); dispersiRenderSidePanels(); }
function dispersiDeselectAll(){ dispersiState.selectedStackIds = new Set(); dispersiDrawMarkers(); dispersiScheduleUpdatePlume(); dispersiRenderSidePanels(); }
function dispersiManualRefreshPlume(){ dispersiScheduleUpdatePlume(0); }

/* ---------- Export PDF: Laporan Beban Emisi (per semester, BUKAN estimasi tahunan) ----------
   Laporan ini SENGAJA dipisah dari terminologi "dispersi"/model plume — ini murni rekap data
   pemantauan (kapan disampling, berapa RH, berapa beban tiap semester), sesuai permintaan: cetak
   yang bisa dipakai sbg laporan resmi per periode, bukan artefak dari fitur peta yang prototipe. */
function dispersiReportFilename(periods){
  return `Laporan Beban Emisi_${dispersiState.site}_${(periods||[]).join("-").replace(/[^\w\-]/g,"")}`;
}
function printDispersiReport(){
  const stacks = dispersiSelectedStacks();
  if(!stacks.length){ toast("Tidak ada titik terpilih di peta untuk dicetak.","err"); return; }
  const periods = dispersiPeriodList();
  openModal(`
    <h3>Preferensi Cetak Laporan Beban Emisi</h3>
    <div class="hint" style="margin-bottom:10px;">Mengikuti site &amp; titik yang sedang dipilih di peta: <b>${escHtml(dispersiState.site)}</b>, ${stacks.length} titik. Beban dihitung PER SEMESTER, jam operasi selalu dari semester yang dilaporkan (riwayat Running Hour bulanan) — konsentrasi pakai hasil sampling semester itu kalau ada, atau hasil terakhir yang masih berlaku (ditandai &dagger;) utk titik yang frekuensi pemantauannya lebih jarang dari 1x/semester. Total tahunan hanya muncul kalau semester 1 &amp; 2 pada tahun yang sama-sama tercentang &amp; punya beban (riil maupun &dagger;).</div>
    <div class="field"><label>Periode yang Dicetak</label>
      <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:4px;">
        ${periods.map(p=>`<label class="checkline"><input type="checkbox" class="dispPrintPeriode" value="${escHtml(p.periode)}" checked> ${escHtml(p.periode)}</label>`).join("")}
      </div>
    </div>
    <div class="field" style="margin-top:12px;"><label>Parameter yang Dicetak</label>
      <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:4px;">
        ${Object.keys(DISPERSI_MASS_PARAMS).filter(p=>!DISPERSI_MASS_PARAMS[p].qualitative).map(p=>`<label class="checkline"><input type="checkbox" class="dispPrintParam" value="${escHtml(p)}" checked> ${escHtml(DISPERSI_MASS_PARAMS[p].label)}</label>`).join("")}
      </div>
    </div>
    <div class="checkline" style="margin-top:12px;"><label><input type="checkbox" id="dispPrintIncludeMap"> Sertakan gambar peta sebaran (prototipe)</label></div>
    <div class="hint" style="margin-top:2px;">Kalau tidak dicentang, laporan hanya berisi data angka (tanpa gambar peta) — cocok utk laporan resmi. Gambar peta memakai kondisi angin/parameter yang sedang aktif di layar saat ini.</div>
    <div class="field" style="margin-top:12px;"><label>Orientasi Kertas</label>
      <select id="dispPrintOrientation"><option value="landscape" selected>Lanskap (Landscape)</option><option value="portrait">Potret (Portrait)</option></select>
    </div>
    <div class="actions"><button class="btn ghost" data-action="closeModal">Batal</button><button class="btn primary" data-action="doPrintDispersiReport">Cetak</button></div>
  `);
}
async function doPrintDispersiReport(){
  const selectedPeriods = [...document.querySelectorAll(".dispPrintPeriode:checked")].map(el=>el.value);
  const selectedParams = [...document.querySelectorAll(".dispPrintParam:checked")].map(el=>el.value);
  const includeMap = document.getElementById("dispPrintIncludeMap").checked;
  const orientation = document.getElementById("dispPrintOrientation").value;
  if(!selectedPeriods.length){ toast("Pilih minimal 1 periode.","err"); return; }
  if(!selectedParams.length){ toast("Pilih minimal 1 parameter.","err"); return; }
  const html = buildDispersiReportHtml(selectedPeriods, includeMap, selectedParams);
  closeModal();
  if(!html){ toast("Tidak ada titik terpilih dengan data pada periode yang dipilih.","err"); return; }
  setPrintOrientation(orientation, 15);
  document.getElementById("printGuideArea").innerHTML = html;
  // Tunggu logo kop (SKK Migas/PHM, selalu ada) + gambar peta opsional selesai decode dulu — sama
  // spt printBeritaAcara/printDokFotoLampiran, supaya hasil cetak/PDF tidak menangkap kondisi
  // gambar masih kosong walau di layar akhirnya normal.
  const imgs = Array.from(document.querySelectorAll("#printGuideArea img"));
  await Promise.all(imgs.map(img=>{
    if(img.decode) return img.decode().catch(()=>{});
    if(img.complete) return Promise.resolve();
    return new Promise(res=>{ img.onload=res; img.onerror=res; });
  }));
  const originalTitle = document.title;
  document.title = dispersiReportFilename(selectedPeriods);
  window.print();
  document.title = originalTitle;
}
// Tiga helper di bawah ini DIPAKAI BERSAMA oleh laporan tabular (mapSection di
// buildDispersiReportHtml) & preview kartografis profesional (dispersiProfessionalPreviewBody) —
// dipisah supaya kedua tampilan itu SELALU konsisten (satu sumber logika legenda/indeks titik),
// bukan 2 salinan kode yang bisa diam-diam melenceng satu sama lain seiring waktu.
function dispersiLegendBlockHtml(snapMeta){
  const gradientCss = DISPERSI_COLOR_STOPS.map(([f,c])=>`rgb(${c[0]},${c[1]},${c[2]}) ${(f*100).toFixed(0)}%`).join(", ");
  const bar = `<div style="height:9px;border-radius:4px;background:linear-gradient(to right, ${gradientCss});border:1px solid #ccc;max-width:320px;"></div>`;
  if(snapMeta?.qualitative) return `${bar}
    <div style="display:flex;justify-content:space-between;font-size:9px;color:#777;max-width:320px;margin-top:2px;"><span>Rendah</span><span>Tinggi (relatif)</span></div>
    <div style="font-size:9.5px;color:#777;margin-top:3px;">Skala relatif — bukan konsentrasi terukur, tanpa satuan.</div>`;
  const peak = snapMeta?.peakConcUgm3;
  const decimals = peak==null?1:(peak<1?3:peak<10?2:1);
  const ticks = [0,0.5,1].map(f=>dispersiFmt((peak||0)*f, decimals));
  return `${bar}
    <div style="display:flex;justify-content:space-between;font-size:9px;font-family:monospace;color:#777;max-width:320px;margin-top:2px;">${ticks.map(t=>`<span>${t}</span>`).join("")}</div>
    <div style="font-size:9.5px;color:#777;margin-top:3px;">Puncak konsentrasi lokal saat digenerate: <b>${dispersiFmt(peak,decimals)} &micro;g/m&sup3;</b> (merah) &middot; biru tua &asymp; nol.</div>`;
}
function dispersiWindLabelFromMeta(snapMeta){
  return snapMeta?.windDirFrom!=null ? `${dispersiFmt(snapMeta.windSpeed,1)} m/s dari ${dispersiCompassLabel(snapMeta.windDirFrom)} (${Math.round(snapMeta.windDirFrom)}&deg;)` : "—";
}
function dispersiSourceIndexRowsHtml(snapMeta){
  return (snapMeta?.sourceIndex||[]).map(s=>`<tr><td style="text-align:center;font-weight:700;">${s.no}</td><td><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${s.color};margin-right:5px;vertical-align:1px;"></span>${escHtml(s.nama)}</td><td style="color:#777;font-size:9.5px;">${escHtml(s.tipe)}</td></tr>`).join("");
}
function buildDispersiReportHtml(selectedPeriods, includeMap, selectedParams){
  const stacks = dispersiSelectedStacks();
  if(!stacks.length) return null;
  const allMassParams = Object.keys(DISPERSI_MASS_PARAMS).filter(p=>!DISPERSI_MASS_PARAMS[p].qualitative);
  // selectedParams opsional (default: SEMUA parameter massa) — supaya user bisa pilih mau cetak
  // NOx/CO/dst yang mana saja lewat checkbox "Parameter yang Dicetak", bukan selalu semuanya
  // sekaligus tanpa opsi spt sebelumnya.
  const massParams = (selectedParams && selectedParams.length) ? allMassParams.filter(p=>selectedParams.includes(p)) : allMassParams;
  const compParams = massParams.concat(["Opasitas"]);
  const periodsSorted = dispersiPeriodList().filter(p=>selectedPeriods.includes(p.periode));

  // Beban per semester: PAKAI carry-forward (dispersiBebanCarryForward) — titik yg frekuensi
  // pemantauannya lebih jarang dari 1x/semester (mis. wajib 1x/tahun) TIDAK disampling ulang tiap
  // semester, tapi konsentrasinya tetap berlaku sepanjang siklusnya, jadi semester yg bukan
  // gilirannya tetap dihitung bebannya pakai hasil sampling terakhir — bukan jadi lubang/kosong di
  // laporan. Jam operasi (runningHour) tetap dari SEMESTER INI SENDIRI (log RH bulanan), bukan ikut
  // semester lama saat sampling terakhir terjadi — lihat dispersiBebanCarryForward. Baris yg
  // konsentrasinya di-carry-forward ditandai "†" + tanggal sampling ASLI supaya transparan, dan
  // Frekuensi Pantau ditampilkan per titik spy jelas kenapa ada yg begitu. Dikelompokkan PER
  // PERIODE (bukan satu tabel besar tercampur per titik) supaya tiap semester jadi seksi laporan
  // yang berdiri sendiri & gampang dibandingkan — bukan daftar mentah yang meloncat-loncat periode
  // per baris.
  const byPeriode = {};
  const byStackParamYear = {};
  const summaryByPeriodeParam = {};
  stacks.forEach(s=>{
    massParams.forEach(param=>{
      periodsSorted.forEach(({periode})=>{
        const r = dispersiBebanCarryForward(s, param, periode);
        if(!r) return;
        const {sem, tahun} = hasilPeriodParts(periode);
        const bebanSemesterKg = r.bebanTahunKg!=null ? r.bebanTahunKg/2 : null;
        const key = s.id+"|"+param+"|"+tahun;
        (byStackParamYear[key] = byStackParamYear[key]||[]).push({sem, bebanSemesterKg, stack:s, param, tahun});
        (byPeriode[periode] = byPeriode[periode]||[]).push({stack:s, param, r, bebanSemesterKg});
        const sKey = periode+"|"+param;
        summaryByPeriodeParam[sKey] = summaryByPeriodeParam[sKey] || {periode, param, total:0, titik:0};
        summaryByPeriodeParam[sKey].total += bebanSemesterKg||0;
        summaryByPeriodeParam[sKey].titik++;
      });
    });
  });
  let bebanSections = "", anyCarried = false;
  periodsSorted.forEach(({periode})=>{
    const rows = byPeriode[periode];
    if(!rows || !rows.length) return;
    let no=1;
    const trs = rows.map(({stack:s, param, r, bebanSemesterKg})=>{
      if(r.carriedFrom) anyCarried = true;
      const dateCell = r.carriedFrom
        ? `${escHtml(r.concRec.dateOfSampling||"—")} <span style="color:#8a5c11;font-weight:700;">&dagger;</span>`
        : escHtml(r.concRec.dateOfSampling||"—");
      return `<tr><td>${no++}</td><td>${escHtml(s.nama)}</td><td>${escHtml(param)}</td>
      <td style="text-align:center;">${escHtml(frekuensiLabelShort(s.frekuensiBulan))}</td>
      <td style="text-align:right;">${dateCell}</td>
      <td style="text-align:right;">${dispersiFmt(r.concRec.resultNumeric,1)} ${escHtml(r.concRec.unit)}</td>
      <td style="text-align:right;">${dispersiFmt(r.flowRec.resultNumeric,1)} m&sup3;/s</td>
      <td style="text-align:right;">${dispersiFmt(r.runningHour,0)} j <span style="color:#777;">(${dispersiFmt(r.runningHour!=null?r.runningHour/12:null,0)} j/bln)</span></td>
      <td style="text-align:right;font-weight:700;">${dispersiFmt(bebanSemesterKg,1)} kg</td></tr>`;
    }).join("");
    bebanSections += `<div style="font-weight:700;font-size:12px;margin:12px 0 5px;color:#0d1f38;">Semester ${escHtml(periode)} <span style="font-weight:400;color:#777;">(${rows.length} data)</span></div>
      <table class="pg-ba-table"><thead><tr><th style="width:22px;">No</th><th>Titik</th><th>Parameter</th><th>Frekuensi Pantau</th><th>Tgl Sampling</th><th style="text-align:right;">Konsentrasi</th><th style="text-align:right;">Laju Alir</th><th style="text-align:right;">Jam Operasi Semester Ini (per bulan)</th><th style="text-align:right;">Beban Semester</th></tr></thead>
        <tbody>${trs}</tbody></table>`;
  });
  // Total tahunan HANYA kalau S1 & S2 tahun itu SAMA-SAMA ada datanya — bukan hasil ekstrapolasi
  // 1 semester, sesuai permintaan "kalau setahun ya harus complete dulu datanya".
  let annualRows = "";
  Object.values(byStackParamYear).forEach(entries=>{
    const sems = new Set(entries.map(e=>e.sem));
    if(sems.has(1) && sems.has(2)){
      const total = entries.reduce((a,e)=>a+(e.bebanSemesterKg||0),0);
      const {stack, param, tahun} = entries[0];
      annualRows += `<tr><td>${escHtml(stack.nama)}</td><td>${escHtml(param)}</td><td>${escHtml(tahun)}</td><td style="text-align:right;font-weight:700;">${dispersiFmt(total,1)} kg</td><td style="text-align:right;font-weight:700;">${dispersiFmt(total/1000,3)} ton</td></tr>`;
    }
  });
  // Ringkasan: rekap "total berapa" per semester x parameter, ditaruh di awal laporan (sebelum
  // rincian) spy pembaca langsung dapat angka intinya tanpa perlu menjumlah sendiri dari tabel rinci.
  const summaryRows = Object.values(summaryByPeriodeParam).sort((a,b)=> (a.periode<b.periode?-1:a.periode>b.periode?1:0) || a.param.localeCompare(b.param))
    .map(g=>`<tr><td>${escHtml(g.periode)}</td><td>${escHtml(g.param)}</td><td style="text-align:right;">${g.titik}</td><td style="text-align:right;font-weight:700;">${dispersiFmt(g.total,1)} kg</td><td style="text-align:right;font-weight:700;">${dispersiFmt(g.total/1000,3)} ton</td></tr>`).join("");

  const STATUS_LABEL = {ok:"Memenuhi", exceed:"Melebihi", not_applicable:"Tidak Dipersyaratkan", not_evaluated:"Belum Dievaluasi"};
  let complianceRows = "", cno=1;
  stacks.forEach(s=>{
    compParams.forEach(param=>{
      periodsSorted.forEach(({periode})=>{
        const rec = dispersiParamRecord(s.id, param, periode);
        if(!rec || rec.resultNumeric==null) return;
        complianceRows += `<tr><td>${cno++}</td><td>${escHtml(s.nama)}</td><td>${escHtml(param)}</td><td>${escHtml(periode)}</td>
          <td style="text-align:right;">${dispersiFmt(rec.resultNumeric,1)} ${escHtml(rec.unit)}</td>
          <td style="text-align:right;">${rec.standard!=null?dispersiFmt(rec.standard,1)+" "+escHtml(rec.unit):"—"}</td>
          <td style="text-align:right;">${rec.pctOfStandard!=null?dispersiFmt(rec.pctOfStandard,1)+"%":"—"}</td>
          <td>${escHtml(STATUS_LABEL[rec.statusBakuMutu]||rec.statusBakuMutu)}</td></tr>`;
      });
    });
  });

  const genDate = new Date().toLocaleDateString("id-ID", {day:"numeric",month:"long",year:"numeric"});
  const snapMeta = dispersiState.lastPlumeSnapshotMeta;
  let mapSection = "";
  if(includeMap){
    if(!dispersiState.lastPlumeSnapshotDataUrl){
      mapSection = `<div style="font-size:11px;color:#a02a24;margin:10px 0;">Gambar peta sebaran belum tersedia (belum ada plume berhasil dihitung utk titik/parameter saat ini) — buka halaman Model Dispersi Emisi, pastikan plume tampil di peta, baru cetak ulang.</div>`;
    } else {
      // Legenda warna dibekukan dari kondisi SAAT snapshot diambil (bukan state layar saat ini,
      // krn bisa saja user sudah ganti filter lagi sebelum benar2 klik cetak) — sama spt seluruh
      // konten laporan lain di sini, yg selalu berdasar data riil bukan tampilan layar sesaat.
      const legendHtml = dispersiLegendBlockHtml(snapMeta);
      const windLabel = dispersiWindLabelFromMeta(snapMeta);
      const idxRows = dispersiSourceIndexRowsHtml(snapMeta);
      // Rasio gambar dari aspectW:aspectH sungguhan (ikut viewport peta saat digenerate, TIDAK
      // dipaksa persegi lagi) — dipakai sbg aspect-ratio wrapper spy kedua layer (basemap + plume)
      // pas bertumpuk tanpa perlu tahu ukuran aslinya di CSS statis.
      const ratio = (snapMeta?.aspectW && snapMeta?.aspectH) ? `${snapMeta.aspectW}/${snapMeta.aspectH}` : "1/1";
      mapSection = `
    <div style="font-weight:700;font-size:12.5px;margin:14px 0 6px;">Peta Sebaran</div>
    <div style="font-size:10px;color:#a02a24;margin-bottom:8px;">Latar peta (citra satelit/jalan) diambil dari layanan basemap Esri saat laporan digenerate — kalau tidak ada koneksi internet saat mencetak, latar bisa jadi kosong tapi lapisan pola sebaran &amp; titik sumber di atasnya tetap tampil normal. Pola sebaran (warna) &amp; anotasi (cincin jarak, panah utara/angin, skala bar) tetap hasil MODEL SCREENING, bukan pengukuran langsung. Kondisi saat digenerate: site ${escHtml(snapMeta?.site||"")}, parameter ${escHtml(snapMeta?.paramLabel||"")}, mode angin ${dispersiWindModeLabel(snapMeta?.windMode)} (dominan ${windLabel}), stabilitas ${escHtml(snapMeta?.stability||"")}.</div>
    <div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap;">
      <div style="flex:1 1 420px;max-width:640px;min-width:320px;">
        <div style="position:relative;width:100%;aspect-ratio:${ratio};background:#eef2f5;border:1px solid #ccc;border-radius:6px;overflow:hidden;">
          <img src="${dispersiState.lastPlumeBasemapUrl||""}" onerror="this.style.display='none'" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;">
          <img src="${dispersiState.lastPlumeSnapshotDataUrl}" style="position:absolute;inset:0;width:100%;height:100%;">
        </div>
        <div style="margin-top:8px;">${legendHtml}</div>
      </div>
      <div style="flex:1 1 180px;min-width:170px;">
        <div style="font-weight:700;font-size:11px;margin-bottom:4px;color:#0d1f38;">Indeks Titik pada Peta</div>
        <table class="pg-ba-table" style="font-size:10px;"><thead><tr><th style="width:20px;">No</th><th>Titik</th><th>Jenis</th></tr></thead>
          <tbody>${idxRows||`<tr><td colspan="3" style="text-align:center;">&mdash;</td></tr>`}</tbody></table>
      </div>
    </div>`;
    }
  }

  return `<div class="pg-batch pg-dispersi">
    <div class="pg-ba-logos">
      <div class="pg-ba-logo-left"><img src="${LOGO_SKKMIGAS_B64}" alt="SKK Migas"></div>
      <div class="pg-ba-logo-right"><img src="${LOGO_PHM_B64}" alt="Pertamina Hulu Mahakam"></div>
    </div>
    <div class="pg-ba-title">
      <h1>LAPORAN BEBAN EMISI</h1>
      <div class="sub">Rekap Beban Pencemar per Semester — PT Pertamina Hulu Mahakam</div>
    </div>
    <table class="pg-ba-meta"><tr><td style="width:150px;">Site</td><td style="width:14px;">:</td><td>${escHtml(dispersiState.site)}</td></tr>
      <tr><td>Periode Dicetak</td><td>:</td><td>${escHtml(selectedPeriods.join(", "))}</td></tr>
      <tr><td>Jumlah Titik</td><td>:</td><td>${stacks.length} titik emisi</td></tr>
      <tr><td>Tanggal Cetak</td><td>:</td><td>${genDate}</td></tr></table>

    <div style="font-weight:700;font-size:12.5px;margin:14px 0 6px;">Ringkasan Beban Emisi (Total per Semester &amp; Parameter)</div>
    <table class="pg-ba-table"><thead><tr><th>Periode</th><th>Parameter</th><th style="text-align:right;">Jumlah Titik</th><th style="text-align:right;">Total (kg)</th><th style="text-align:right;">Total (ton)</th></tr></thead>
      <tbody>${summaryRows||`<tr><td colspan="5" style="text-align:center;">Tidak ada data pada periode yang dipilih.</td></tr>`}</tbody></table>

    <div style="font-weight:700;font-size:12.5px;margin:14px 0 6px;">Rincian Beban Emisi per Semester</div>
    ${anyCarried ? `<div style="font-size:10px;color:#8a5c11;margin:-2px 0 8px;">&dagger; = konsentrasi memakai hasil sampling TERAKHIR dari periode lain (belum dijadwalkan sampling ulang di semester ini sesuai Frekuensi Pantau-nya) — berlaku sepanjang siklus pemantauannya. Jam Operasi tetap dihitung dari semester yang sedang dilaporkan (bukan ikut semester sampling asalnya).</div>` : ""}
    ${bebanSections || `<div style="font-size:11px;color:#777;margin:6px 0;">Tidak ada data pada periode yang dipilih.</div>`}

    ${annualRows ? `<div style="font-weight:700;font-size:12.5px;margin:14px 0 6px;">Total Tahunan (hanya kalau S1 &amp; S2 tahun sama-sama lengkap)</div>
    <table class="pg-ba-table"><thead><tr><th>Titik</th><th>Parameter</th><th>Tahun</th><th style="text-align:right;">Total kg</th><th style="text-align:right;">Total ton</th></tr></thead>
      <tbody>${annualRows}</tbody></table>` : ""}

    <div style="font-weight:700;font-size:12.5px;margin:14px 0 6px;">Kepatuhan Baku Mutu per Periode</div>
    <table class="pg-ba-table"><thead><tr><th style="width:22px;">No</th><th>Titik</th><th>Parameter</th><th>Periode</th><th style="text-align:right;">Hasil</th><th style="text-align:right;">Baku Mutu</th><th style="text-align:right;">%BM</th><th>Status</th></tr></thead>
      <tbody>${complianceRows||`<tr><td colspan="8" style="text-align:center;">Tidak ada data.</td></tr>`}</tbody></table>

    ${mapSection}

    <div class="pg-foot" style="margin-top:16px;">
      Beban semester = konsentrasi &times; laju alir tercatat (m&sup3;/s, diperlakukan setara Nm&sup3;/s) &times; jam operasi SEMESTER YANG DILAPORKAN (dari riwayat Running Hour bulanan, bukan estimasi). Konsentrasi &amp; laju alir memakai hasil sampling RIIL pada semester itu sendiri kalau ada, atau hasil sampling terakhir yang masih berlaku (ditandai &dagger;) kalau titik ini memang belum dijadwalkan sampling ulang sesuai Frekuensi Pantau-nya (mis. titik 1x/tahun) — bukan estimasi/ekstrapolasi. Total tahunan hanya ditampilkan kalau kedua semester (S1 &amp; S2) tahun tsb sama-sama punya beban (riil maupun &dagger;). Baku mutu &amp; status kepatuhan diambil langsung dari data hasil pemantauan (Permen LH 13/2009 &amp; Permen LHK 11/2021 sesuai kategori kapasitas/bahan bakar tiap titik). Dibuat otomatis oleh Emission Sampling Planner &amp; Tracker.
    </div>
    <img class="pg-ba-footer-band" src="${FOOTER_BAND_B64}" alt="">
  </div>`;
}

/* ---------- Preview Kartografis Profesional (gaya peta AMDAL/ANDAL: peta besar + sidebar formal
   berlogo, judul, legenda, arah utara, skala, indeks titik sumber) ---------- */
// Field panah angin: array panah SERAGAM (arah & kecepatan SAMA semua) di atas peta, mirip gaya
// output CALPUFF/AERMOD (medan vektor angin). SENGAJA seragam (bukan pura-pura spt medan spasial
// riil) — model di halaman ini cuma mengambil 1 titik data angin (pusat site) per perhitungan,
// BUKAN medan meteorologi spasial sungguhan spt WRF/CALMET, jadi menggambar arah/kecepatan yang
// beda-beda tiap panah justru akan menyesatkan (mengklaim presisi spasial yang tidak ada datanya).
// Keseragaman inilah yang justru transparan menunjukkan asumsi model: 1 angin dominan berlaku rata
// di seluruh area yang dimodelkan.
function dispersiWindVectorFieldSvg(dirFromDeg, speedMs, boxW, boxH){
  if(dirFromDeg==null || speedMs==null || !boxW || !boxH) return "";
  const blowTo = (dirFromDeg+180)%360;
  const th = blowTo*Math.PI/180, dx = Math.sin(th), dy = -Math.cos(th);
  const speedFrac = Math.max(0, Math.min(1, speedMs/12));
  const unit = Math.min(boxW,boxH);
  const len = unit*(0.08+speedFrac*0.06);
  const [r,g,b] = dispersiColorForFrac(0.18+speedFrac*0.55);
  const colorCss = `rgba(${r},${g},${b},.92)`;
  const cols=5, rows=4;
  let arrows = "";
  for(let ri=0; ri<rows; ri++){
    for(let ci=0; ci<cols; ci++){
      const cx = (ci+0.5)/cols*boxW, cy = (ri+0.5)/rows*boxH;
      const x1 = cx-dx*len*0.5, y1 = cy-dy*len*0.5, x2 = cx+dx*len*0.5, y2 = cy+dy*len*0.5;
      arrows += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${colorCss}" stroke-width="${Math.max(1,unit*0.006).toFixed(1)}" stroke-linecap="round" marker-end="url(#dispArrowHead)"/>`;
    }
  }
  return `<svg viewBox="0 0 ${boxW} ${boxH}" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;">
    <defs><marker id="dispArrowHead" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="3.4" markerHeight="3.4" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 Z" fill="${colorCss}"/></marker></defs>
    ${arrows}
  </svg>`;
}
// SATU builder dipakai baik utk preview di layar (modal) MAUPUN saat ditekan cetak — jadi preview &
// hasil cetak/PDF-nya dijamin identik, bukan 2 jalur render terpisah yang bisa beda. SELALU baca
// dispersiState & lastPlumeSnapshotMeta TERKINI saat dipanggil (tidak disimpan/di-cache di closure
// manapun) — jadi otomatis ikut "dinamis": ganti site/parameter/periode/mode-angin di halaman peta,
// lalu buka preview ini (lagi), tampilannya otomatis mengikuti kondisi yang baru dipilih, termasuk
// arah & kecepatan angin dominan hasil periode/tanggal yang sedang aktif.
function dispersiProfessionalPreviewBody(){
  const snapMeta = dispersiState.lastPlumeSnapshotMeta;
  if(!dispersiState.lastPlumeSnapshotDataUrl || !snapMeta){
    return `<div style="padding:34px 20px;text-align:center;color:#a02a24;font-size:13px;">Gambar peta sebaran belum tersedia untuk kondisi filter saat ini — pastikan minimal 1 titik terpilih &amp; plume berhasil tampil di peta pada halaman Model Dispersi Emisi, baru buka preview ini lagi.</div>`;
  }
  const ratio = (snapMeta.aspectW && snapMeta.aspectH) ? `${snapMeta.aspectW}/${snapMeta.aspectH}` : "1/1";
  const windLabel = dispersiWindLabelFromMeta(snapMeta);
  const stab = DISPERSI_STABILITY_CLASSES.find(s=>s.key===snapMeta.stability);
  const vectorField = dispersiWindVectorFieldSvg(snapMeta.windDirFrom, snapMeta.windSpeed, snapMeta.aspectW, snapMeta.aspectH);
  const genDate = new Date().toLocaleDateString("id-ID", {day:"numeric",month:"long",year:"numeric"});
  return `
  <div class="pg-dispersi-pro">
    <div class="pg-dispersi-pro-map">
      <div style="position:relative;width:100%;aspect-ratio:${ratio};background:#eef2f5;overflow:hidden;">
        <img src="${dispersiState.lastPlumeBasemapUrl||""}" onerror="this.style.display='none'" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;">
        <img src="${dispersiState.lastPlumeSnapshotDataUrl}" style="position:absolute;inset:0;width:100%;height:100%;">
        ${vectorField}
      </div>
    </div>
    <div class="pg-dispersi-pro-sidebar">
      <div class="pg-ba-logos" style="margin:0 0 12px;min-height:44px;">
        <div class="pg-ba-logo-left"><img src="${LOGO_SKKMIGAS_B64}" alt="SKK Migas"></div>
        <div class="pg-ba-logo-right"><img src="${LOGO_PHM_B64}" alt="Pertamina Hulu Mahakam"></div>
      </div>
      <div class="pg-dispersi-pro-title">
        <div class="eyebrow">DOKUMEN TEKNIS PEMANTAUAN KUALITAS UDARA</div>
        <h1>PETA MODEL SEBARAN DISPERSI EMISI</h1>
        <div class="sub">${escHtml(snapMeta.paramLabel)} &middot; ${escHtml(snapMeta.site)}</div>
      </div>
      <table class="pg-ba-meta pg-dispersi-pro-meta">
        <tr><td>Periode Data</td><td>:</td><td>${escHtml(snapMeta.sel)}</td></tr>
        <tr><td>Kelas Stabilitas</td><td>:</td><td>${escHtml(stab?stab.label:(snapMeta.stability||"—"))}</td></tr>
        <tr><td>Sumber Angin</td><td>:</td><td>${dispersiWindModeLabel(snapMeta.windMode)} (Open-Meteo)</td></tr>
        <tr><td>Angin Dominan</td><td>:</td><td>${windLabel}</td></tr>
        <tr><td>Titik Sumber</td><td>:</td><td>${(snapMeta.sourceIndex||[]).length} titik</td></tr>
        <tr><td>Tanggal Dibuat</td><td>:</td><td>${genDate}</td></tr>
      </table>
      <div class="pg-dispersi-pro-block">
        <div class="pg-dispersi-pro-label">Legenda ${snapMeta.qualitative?"Pola Relatif":"Konsentrasi (&micro;g/m&sup3;)"}</div>
        ${dispersiLegendBlockHtml(snapMeta)}
      </div>
      <div class="pg-dispersi-pro-block" style="display:flex;gap:12px;align-items:flex-start;">
        <div style="flex-shrink:0;text-align:center;">
          <svg width="32" height="32" viewBox="0 0 34 34"><circle cx="17" cy="17" r="15" fill="none" stroke="#999" stroke-width="1"/><path d="M17,4 L21,18 L17,15 L13,18 Z" fill="#0d1f38"/><text x="17" y="30" font-size="7" text-anchor="middle" fill="#555">U</text></svg>
          <div style="font-size:8px;color:#777;margin-top:1px;">Arah Utara</div>
        </div>
        <div style="font-size:9.5px;color:#555;line-height:1.5;">Peta tidak dirotasi (atas peta = Utara). Skala grafis (garis berskala jarak) tertera pada citra peta di sisi kiri — representasi ini tetap akurat pada ukuran cetak berapa pun, berbeda dari rasio skala numerik yang bergantung pada ukuran kertas aktual saat dicetak.</div>
      </div>
      <div class="pg-dispersi-pro-block">
        <div class="pg-dispersi-pro-label">Indeks Titik Sumber</div>
        <table class="pg-ba-table" style="font-size:9.5px;"><thead><tr><th style="width:20px;">No</th><th>Titik</th><th>Jenis</th></tr></thead>
          <tbody>${dispersiSourceIndexRowsHtml(snapMeta)||`<tr><td colspan="3" style="text-align:center;">&mdash;</td></tr>`}</tbody></table>
      </div>
      <div class="pg-dispersi-pro-block pg-foot" style="border-top:1.5px solid #a02a24;padding-top:6px;margin-bottom:0;">
        Panah pada peta menunjukkan arah &amp; kecepatan angin DOMINAN yang dipakai model (nilai seragam di seluruh area yang ditampilkan, bukan medan angin spasial terukur per titik). Hasil merupakan model screening Gaussian plume berbasis data pemantauan yang tersimpan di aplikasi ini — BUKAN keluaran AERMOD/CALPUFF &amp; bukan pengganti kajian dispersi regulatory. Lihat "Info Model Dispersi &amp; Data Angin" untuk penjelasan metodologi &amp; keterbatasan selengkapnya.
      </div>
    </div>
  </div>`;
}
function dispersiOpenProfessionalPreview(){
  openModal(`
    <h3>Preview Peta Profesional (Format AMDAL)</h3>
    <div class="hint" style="margin-bottom:10px;">Mengikuti kondisi filter yang sedang aktif di halaman peta saat ini (site, parameter, periode/tanggal, mode &amp; kelas stabilitas angin). Untuk melihat kondisi lain (mis. semester atau tanggal berbeda) — tutup preview ini, ganti filter di halaman, lalu buka preview lagi.</div>
    <div style="max-height:68vh;overflow:auto;border:1px solid var(--gray-200);border-radius:8px;">${dispersiProfessionalPreviewBody()}</div>
    <div class="actions"><button class="btn ghost" data-action="closeModal">Tutup</button><button class="btn primary" data-action="dispersiPrintProfessionalPreview">Cetak / Simpan PDF</button></div>
  `, {wide:true});
}
async function dispersiPrintProfessionalPreview(){
  const snapMeta = dispersiState.lastPlumeSnapshotMeta;
  if(!dispersiState.lastPlumeSnapshotDataUrl || !snapMeta){ toast("Peta belum tersedia untuk dicetak — lihat catatan di preview.","err"); return; }
  const html = `<div class="pg-batch pg-dispersi-pro-page">${dispersiProfessionalPreviewBody()}</div>`;
  closeModal();
  setPrintOrientation("landscape", 10);
  document.getElementById("printGuideArea").innerHTML = html;
  const imgs = Array.from(document.querySelectorAll("#printGuideArea img"));
  await Promise.all(imgs.map(img=>{
    if(img.decode) return img.decode().catch(()=>{});
    if(img.complete) return Promise.resolve();
    return new Promise(res=>{ img.onload=res; img.onerror=res; });
  }));
  const originalTitle = document.title;
  document.title = `Peta Model Dispersi_${dispersiState.site}_${snapMeta.paramLabel}`.replace(/[^\w\-]/g,"_");
  window.print();
  document.title = originalTitle;
}

/* ---------- Mode Expert: Timelapse Sebaran Per Jam ----------
   Animasi jam-per-jam (00:00 s/d jam terakhir data tersedia) dari SATU tanggal pilihan — beda dari
   mode Live/Periode/Kustom di panel utama (yang menunjukkan kondisi SAAT INI atau RATA-RATA sebuah
   rentang), di sini tiap frame pakai data angin SATU JAM SPESIFIK apa adanya (kerucut sempit spt
   mode Live, bukan superposisi) supaya perubahan ARAH terlihat jelas antar jam. Kekuatan sumber
   (Qgs) SENGAJA dibekukan dari Parameter & Periode Data yang aktif di panel utama saat modal dibuka
   (bukan ikut berubah tiap jam — data sampling toh tidak ada per jam) — transparansi ini ditulis
   eksplisit di caption bawah supaya tidak disalahartikan sbg rekonstruksi kejadian aktual per jam.
   Geometri peta (pusat & lebar area) dihitung MANDIRI dari sebaran titik sumber terpilih (bukan
   bergantung viewport peta utama) supaya Mode Expert selalu punya framing yang masuk akal
   walaupun peta utama belum pernah di-zoom/geser ke titik yang relevan. */
let dispersiTimelapse = {
  loaded:false, date:null, hours:[], frameCache:{}, frameIdx:0, playing:false, timer:null,
  geo:null, basemapUrl:null, sources:[], staticSvg:"", sourcePins:[],
  paramLabel:"", selLabel:"", stabilityLabel:"", qualitative:false
};
// Pusat & setengah-lebar area (meter) dari sebaran titik sumber terpilih sendiri — bukan dari
// viewport peta utama (lihat catatan di atas). Faktor 3.2x jarak titik terjauh dari pusat memberi
// ruang cukup utk plume melebar ke satu sisi, dgn batas bawah 400m (titik tunggal) & batas atas
// sama dgn MAX_HALF_M peta utama (konsisten dgn batas realistis model screening ini).
function dispersiTimelapseComputeGeo(sources){
  const lats = sources.map(s=>s.stack.lat), lngs = sources.map(s=>s.stack.lng);
  const centerLat = lats.reduce((a,b)=>a+b,0)/lats.length;
  const centerLng = lngs.reduce((a,b)=>a+b,0)/lngs.length;
  let maxDistM = 300;
  sources.forEach(s=>{
    const {dx,dy} = dispersiToLocalXY(s.stack.lat, s.stack.lng, centerLat, centerLng);
    maxDistM = Math.max(maxDistM, Math.hypot(dx,dy));
  });
  const halfM = Math.min(15000, Math.max(400, maxDistM*3.2));
  const GW=200, GH=200, OW=620, OH=620;
  return {
    centerLat, centerLng, halfWidthM:halfM, halfHeightM:halfM, GW, GH, OW, OH,
    sw: dispersiToLatLng(-halfM,-halfM,centerLat,centerLng), ne: dispersiToLatLng(halfM,halfM,centerLat,centerLng)
  };
}
// Angin per-jam utk SATU tanggal: Archive API (kalau tanggalnya cukup lama, konsisten dgn delay
// arsip &plusmn;5 hari yg sama dipakai mode Periode/Kustom) atau fallback Forecast API (utk tanggal
// yg terlalu baru utk arsip — forecast API-nya sendiri sudah menyertakan riwayat 7 hari terakhir
// lewat past_days). Menyertakan suhu/kelembapan tiap jam jg (bukan cuma arah+kecepatan) supaya
// panel detail Mode Expert bisa menampilkan info selengkap mode Live/Periode.
async function dispersiFetchTimelapseWindHours(lat, lng, dateStr){
  const maxArchiveDate = new Date(Date.now()-5*86400000).toISOString().slice(0,10);
  let times=[], dirs=[], speeds=[], temps=[], hums=[];
  if(dateStr<=maxArchiveDate){
    const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lng}&start_date=${dateStr}&end_date=${dateStr}&hourly=wind_speed_10m,wind_direction_10m,temperature_2m,relative_humidity_2m&wind_speed_unit=ms&timezone=auto`;
    const res = await fetch(url);
    if(!res.ok) throw new Error("bad response");
    const data = await res.json();
    times = data.hourly.time||[]; dirs = data.hourly.wind_direction_10m||[]; speeds = data.hourly.wind_speed_10m||[];
    temps = data.hourly.temperature_2m||[]; hums = data.hourly.relative_humidity_2m||[];
  } else {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&hourly=wind_speed_10m,wind_direction_10m,temperature_2m,relative_humidity_2m&past_days=7&forecast_days=2&wind_speed_unit=ms&timezone=auto`;
    const res = await fetch(url);
    if(!res.ok) throw new Error("bad response");
    const data = await res.json();
    const allT=data.hourly.time||[], allD=data.hourly.wind_direction_10m||[], allS=data.hourly.wind_speed_10m||[], allTemp=data.hourly.temperature_2m||[], allHum=data.hourly.relative_humidity_2m||[];
    allT.forEach((t,i)=>{ if(t.slice(0,10)===dateStr){ times.push(t); dirs.push(allD[i]); speeds.push(allS[i]); temps.push(allTemp[i]); hums.push(allHum[i]); } });
  }
  const hours = times.map((t,i)=>({hour:Number(t.slice(11,13)), time:t, dir:dirs[i], speed:speeds[i], temp:temps[i], humidity:hums[i]}))
    .filter(h=>h.dir!=null && h.speed!=null).sort((a,b)=>a.hour-b.hour);
  if(!hours.length) throw new Error("no data");
  return hours;
}
// Lapisan anotasi kartografis (cincin jarak, titik sumber bernomor, panah utara, skala bar) —
// GEOMETRINYA TIDAK BERUBAH antar jam (site/titik/area yang sama), jadi dihitung SEKALI saja
// sbg SVG (bukan digambar ulang ke canvas tiap frame spt panah angin yg memang berubah arah) —
// beda dari snapshot canvas peta utama yang menggambar semuanya jadi satu bitmap sekali jalan.
function dispersiTimelapseBuildStaticLayer(geo, sources){
  const {centerLat, centerLng, halfWidthM, halfHeightM, OW, OH} = geo;
  const pxPerM = OW/(halfWidthM*2);
  const scx = OW/2, scy = OH/2;
  const ringStep = dispersiNiceNumber(Math.min(halfWidthM,halfHeightM)/2.6);
  let rings = "";
  for(let r=ringStep, n=0; r<Math.max(halfWidthM,halfHeightM)*1.45 && n<6; r+=ringStep, n++){
    rings += `<circle cx="${scx}" cy="${scy}" r="${(r*pxPerM).toFixed(1)}" fill="none" stroke="rgba(13,31,56,.18)" stroke-width="1.5"/>`;
    const lx = scx + r*pxPerM*Math.SQRT1_2, ly = scy - r*pxPerM*Math.SQRT1_2;
    if(lx<OW-32 && lx>0 && ly>16) rings += `<text x="${(lx+3).toFixed(1)}" y="${(ly-2).toFixed(1)}" font-size="11" fill="rgba(13,31,56,.65)">${dispersiFmtDistance(r)}</text>`;
  }
  const sourcePins = sources.map((src,i)=>{
    const {dx,dy} = dispersiToLocalXY(src.stack.lat, src.stack.lng, centerLat, centerLng);
    return {no:i+1, stack:src.stack, px:scx+dx*pxPerM, py:scy-dy*pxPerM};
  });
  let pins = "";
  sourcePins.forEach(p=>{
    pins += `<circle cx="${p.px.toFixed(1)}" cy="${p.py.toFixed(1)}" r="9" fill="${p.stack.tipe.color}" stroke="#fff" stroke-width="2"/><circle cx="${p.px.toFixed(1)}" cy="${p.py.toFixed(1)}" r="9" fill="none" stroke="#0d1f38" stroke-width="1"/><text x="${p.px.toFixed(1)}" y="${(p.py+3.5).toFixed(1)}" font-size="10" font-weight="700" fill="#fff" text-anchor="middle">${p.no}</text>`;
  });
  const nx = OW-42, ny=42;
  const northArrow = `<line x1="${nx}" y1="${ny+10}" x2="${nx}" y2="${ny-18}" stroke="#0d1f38" stroke-width="2.5" stroke-linecap="round" marker-end="url(#tlNorthHead)"/><text x="${nx}" y="${ny+24}" font-size="12" font-weight="700" fill="#0d1f38" text-anchor="middle">U</text>`;
  const niceM = dispersiNiceNumber((Math.min(OW,OH)*0.22)/pxPerM);
  const barPx = niceM*pxPerM, barX=20, barY=OH-22;
  const scaleBar = `<line x1="${barX}" y1="${barY}" x2="${barX+barPx}" y2="${barY}" stroke="#0d1f38" stroke-width="2"/><line x1="${barX}" y1="${barY-5}" x2="${barX}" y2="${barY+5}" stroke="#0d1f38" stroke-width="2"/><line x1="${barX+barPx}" y1="${barY-5}" x2="${barX+barPx}" y2="${barY+5}" stroke="#0d1f38" stroke-width="2"/><text x="${barX}" y="${barY-8}" font-size="12" fill="#0d1f38">${dispersiFmtDistance(niceM)}</text>`;
  const svg = `<svg viewBox="0 0 ${OW} ${OH}" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;">
    <defs><marker id="tlNorthHead" viewBox="0 0 10 10" refX="5" refY="8" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,10 L5,0 L10,10 Z" fill="#0d1f38"/></marker></defs>
    ${rings}${pins}${northArrow}${scaleBar}
  </svg>`;
  return {svg, sourcePins};
}
function dispersiOpenExpertMode(){
  const defaultDate = new Date(Date.now()-7*86400000).toISOString().slice(0,10);
  dispersiTimelapse = {loaded:false, date:null, hours:[], frameCache:{}, frameIdx:0, playing:false, timer:null, geo:null, basemapUrl:null, sources:[], staticSvg:"", sourcePins:[], paramLabel:"", selLabel:"", stabilityLabel:"", qualitative:false};
  openModal(`
    <h3>&#127916; Mode Expert &mdash; Timelapse Sebaran Per Jam</h3>
    <div class="hint" style="margin-bottom:10px;">Simulasikan bagaimana pola sebaran berubah sepanjang hari mengikuti data angin per jam pada satu tanggal pilihan. Kekuatan sumber emisi dibekukan dari Parameter &amp; Periode Data yang sedang aktif di halaman (<b>${escHtml(dispersiCurrentParamMeta().label)}</b>, periode <b>${escHtml(dispersiSelectionLabel(dispersiState.sel))}</b>); titik yang dipakai mengikuti seleksi peta/filter Titik Emisi saat ini (<b>${dispersiSelectedStacks().length} titik</b>).</div>
    <div style="display:flex;align-items:flex-end;gap:10px;flex-wrap:wrap;margin-bottom:14px;">
      <div class="field" style="margin:0;"><label>Tanggal</label><input type="date" id="tlDateInput" value="${defaultDate}"></div>
      <button class="btn primary" data-action="dispersiTimelapseLoad">Muat Data Hari Ini</button>
    </div>
    <div id="tlBody"><div class="hint">Pilih tanggal (disarankan &ge;5 hari yang lalu supaya data arsip penuh 24 jam), lalu klik "Muat Data Hari Ini".</div></div>
    <div class="actions"><button class="btn ghost" data-action="dispersiTimelapseCloseModal">Tutup</button></div>
  `, {wide:true});
}
function dispersiTimelapseCloseModal(){ dispersiTimelapseStopTimer(); closeModal(); }
function dispersiTimelapseStopTimer(){
  if(dispersiTimelapse.timer){ clearInterval(dispersiTimelapse.timer); dispersiTimelapse.timer=null; }
  dispersiTimelapse.playing = false;
}
async function dispersiTimelapseLoad(){
  dispersiTimelapseStopTimer();
  const dateStr = document.getElementById("tlDateInput")?.value;
  if(!dateStr){ toast("Pilih tanggal dulu.","err"); return; }
  const stacks = dispersiSelectedStacks();
  if(!stacks.length){ toast('Tidak ada titik terpilih — pilih titik di peta atau Filter Titik Emisi dulu.',"err"); return; }
  const sel = dispersiResolveSelection(dispersiState.sel);
  if(!sel){ toast("Periode data belum dipilih.","err"); return; }
  const flowMode = dispersiIsFlowMode();
  if(!flowMode && !DISPERSI_MASS_PARAMS[dispersiState.param]){ toast("Parameter tidak dikenal.","err"); return; }
  const sources = stacks.map(s=>{ const q=dispersiQgsForStack(s,dispersiState.param,sel); return q==null?null:{stack:s,Qgs:q}; }).filter(Boolean);
  if(!sources.length){ toast("Tidak ada data konsentrasi/laju alir pada titik & periode terpilih untuk parameter ini.","err"); return; }
  document.getElementById("tlBody").innerHTML = `<div class="hint">Memuat data angin per jam Open-Meteo untuk ${escHtml(dateStr)}…</div>`;
  const geo = dispersiTimelapseComputeGeo(sources);
  try{
    const hours = await dispersiFetchTimelapseWindHours(geo.centerLat, geo.centerLng, dateStr);
    const {svg, sourcePins} = dispersiTimelapseBuildStaticLayer(geo, sources);
    const stab = DISPERSI_STABILITY_CLASSES.find(x=>x.key===dispersiState.stability);
    dispersiTimelapse = {
      loaded:true, date:dateStr, hours, frameCache:{}, frameIdx:0, playing:false, timer:null,
      geo, basemapUrl: dispersiBasemapExportUrl(dispersiState.mapLayer, geo.sw, geo.ne, geo.OW, geo.OH),
      sources, staticSvg:svg, sourcePins,
      paramLabel: dispersiCurrentParamMeta().label, selLabel: dispersiSelectionLabel(dispersiState.sel),
      stabilityLabel: stab?stab.label:dispersiState.stability, qualitative: flowMode || dispersiIsQualitativeMode()
    };
    document.getElementById("tlBody").innerHTML = dispersiTimelapseBodyHtml();
    dispersiTimelapseRenderFrame(0);
  }catch(err){
    document.getElementById("tlBody").innerHTML = `<div class="hint" style="color:#a02a24;">Data angin per jam Open-Meteo untuk tanggal ini belum/tidak tersedia — coba tanggal lain (idealnya &ge;5 hari yang lalu supaya data arsip sudah lengkap 24 jam).</div>`;
  }
}
function dispersiTimelapseBodyHtml(){
  const tl = dispersiTimelapse;
  return `
  <div style="display:grid;grid-template-columns:minmax(0,1fr) 260px;gap:16px;align-items:start;">
    <div>
      <div style="position:relative;width:100%;max-width:560px;aspect-ratio:1/1;margin:0 auto;background:#eef2f5;border:1px solid #ccc;border-radius:8px;overflow:hidden;">
        <img id="tlBasemapImg" src="${tl.basemapUrl||""}" onerror="this.style.display='none'" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;">
        <img id="tlPlumeImg" style="position:absolute;inset:0;width:100%;height:100%;">
        <div id="tlStaticLayer" style="position:absolute;inset:0;">${tl.staticSvg}</div>
        <div id="tlWindArrow" style="position:absolute;top:14px;left:14px;width:0;height:0;transform-origin:14px 14px;">
          <div style="width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-bottom:22px solid #1a6fb0;margin-left:-7px;"></div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:10px;margin:12px auto 0;max-width:560px;">
        <button type="button" class="btn small" id="tlPlayBtn" data-action="dispersiTimelapseTogglePlay">&#9654; Putar</button>
        <input type="range" id="tlSlider" min="0" max="${tl.hours.length-1}" value="0" style="flex:1;">
        <span id="tlTimeLabel" style="font-family:var(--font-mono);font-weight:700;min-width:42px;text-align:right;">--:--</span>
      </div>
      <div style="max-width:560px;margin:10px auto 0;">${dispersiTimelapseDayChartHtml()}</div>
    </div>
    <div>
      <div id="tlReadout"></div>
      <div class="hint" style="margin-top:12px;">Animasi ini mensimulasikan bagaimana pola sebaran akan terlihat seandainya angin pada tanggal terpilih bertiup sesuai data historis per jam Open-Meteo, dengan kekuatan sumber emisi (Qgs) tetap konstan dari data parameter &amp; periode pemantauan yang sedang aktif — <b>bukan rekonstruksi kejadian aktual</b> (sampling tidak dilakukan tiap jam), melainkan alat bantu visual untuk memahami sensitivitas arah &amp; luas sebaran terhadap perubahan angin sepanjang hari.</div>
    </div>
  </div>`;
}
// Grafik ringkasan angin 24 jam (batang kecepatan diwarnai per DISPERSI_SPEED_BINS, konsisten dgn
// Wind Rose) — bisa diklik (dispersiTimelapseScrubTo) utk lompat langsung ke jam itu, dan diberi
// garis "playhead" merah yang mengikuti posisi animasi (lihat dispersiTimelapseRenderFrame).
function dispersiTimelapseDayChartHtml(){
  const hours = dispersiTimelapse.hours;
  const maxSpeed = Math.max(1, ...hours.map(h=>h.speed));
  const bars = hours.map((h,i)=>{
    const bin = DISPERSI_SPEED_BINS.find(b=>h.speed<b.max) || DISPERSI_SPEED_BINS[DISPERSI_SPEED_BINS.length-1];
    const hpx = Math.max(4, Math.round((h.speed/maxSpeed)*54));
    return `<div class="tlBar" data-idx="${i}" title="${String(h.hour).padStart(2,"0")}:00 · ${dispersiCompassLabel16(h.dir)} · ${dispersiFmt(h.speed,1)} m/s" style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:64px;cursor:pointer;">
      <div style="width:100%;max-width:10px;height:${hpx}px;background:${bin.color};border-radius:2px 2px 0 0;"></div>
    </div>`;
  }).join("");
  const legend = DISPERSI_SPEED_BINS.map(b=>`<span style="display:inline-flex;align-items:center;gap:3px;"><span style="width:7px;height:7px;border-radius:1.5px;background:${b.color};display:inline-block;"></span>${b.label}</span>`).join("");
  return `<div style="position:relative;">
    <div id="tlDayChartBars" style="display:flex;gap:2px;align-items:flex-end;height:64px;border-bottom:1px solid var(--gray-200);padding-bottom:2px;">${bars}</div>
    <div id="tlPlayhead" style="position:absolute;top:0;bottom:2px;width:2px;background:#a02a24;pointer-events:none;left:0;"></div>
  </div>
  <div style="display:flex;justify-content:space-between;font-size:9px;color:var(--gray-500);margin-top:2px;"><span>${String(hours[0]?.hour??0).padStart(2,"0")}:00</span><span>m/s per jam (${escHtml(dispersiTimelapse.date||"")})</span><span>${String(hours[hours.length-1]?.hour??23).padStart(2,"0")}:00</span></div>
  <div style="display:flex;flex-wrap:wrap;gap:4px 8px;font-size:8.5px;color:var(--gray-500);margin-top:4px;">${legend}</div>`;
}
// Dihitung malas (baru dikerjakan saat jam itu pertama kali ditampilkan) & di-cache per jam —
// grid 200x200 + 3x box blur cukup cepat utk dihitung ulang tiap jam tanpa jeda terasa, tapi
// cache tetap mencegah kerja ulang percuma saat user maju-mundur/scrub ke jam yang sama.
function dispersiTimelapseFrameData(idx){
  const tl = dispersiTimelapse;
  if(tl.frameCache[idx]) return tl.frameCache[idx];
  const h = tl.hours[idx];
  const windCases = [{dirFrom:h.dir, u:Math.max(h.speed,0.5), weight:1}];
  const {smooth, maxV} = dispersiComputeConcGrid(tl.sources, windCases, dispersiState.stability, tl.geo.centerLat, tl.geo.centerLng, tl.geo.halfWidthM, tl.geo.halfHeightM, tl.geo.GW, tl.geo.GH);
  const canvas = dispersiGridToColorCanvas(smooth, maxV, tl.geo.GW, tl.geo.GH, tl.geo.OW, tl.geo.OH);
  const frame = {dataUrl:canvas.toDataURL(), peakConc: tl.qualitative?null:maxV};
  tl.frameCache[idx] = frame;
  return frame;
}
function dispersiTimelapseRenderFrame(idx){
  const tl = dispersiTimelapse;
  if(!tl.loaded || !tl.hours.length) return;
  idx = Math.max(0, Math.min(tl.hours.length-1, Math.round(Number(idx))));
  tl.frameIdx = idx;
  const h = tl.hours[idx];
  const frame = dispersiTimelapseFrameData(idx);
  const img = document.getElementById("tlPlumeImg"); if(img) img.src = frame.dataUrl;
  const slider = document.getElementById("tlSlider"); if(slider) slider.value = idx;
  const timeLabel = document.getElementById("tlTimeLabel"); if(timeLabel) timeLabel.textContent = String(h.hour).padStart(2,"0")+":00";
  const blowTo = (h.dir+180)%360;
  const arrow = document.getElementById("tlWindArrow"); if(arrow) arrow.style.transform = `rotate(${blowTo}deg)`;
  const playhead = document.getElementById("tlPlayhead"); if(playhead) playhead.style.left = ((idx+0.5)/tl.hours.length*100)+"%";
  document.querySelectorAll("#tlDayChartBars .tlBar").forEach(el=>{ el.style.opacity = Number(el.dataset.idx)===idx ? "1" : "0.5"; });
  const readout = document.getElementById("tlReadout");
  if(readout){
    const peakRow = tl.qualitative
      ? `<div class="hint">Mode "${escHtml(tl.paramLabel)}": pola relatif, bukan konsentrasi massa.</div>`
      : `<div><div style="font-size:10px;color:var(--gray-500);text-transform:uppercase;">Puncak Konsentrasi Jam Ini</div><div style="font-family:var(--font-mono);font-size:20px;font-weight:800;color:var(--heading);">${dispersiFmt(frame.peakConc,frame.peakConc<1?3:1)} <span style="font-size:11px;font-weight:600;color:var(--gray-500);">&micro;g/m&sup3;</span></div></div>`;
    readout.innerHTML = `
      <div style="font-family:var(--font-mono);font-size:34px;font-weight:800;color:var(--heading);line-height:1;">${String(h.hour).padStart(2,"0")}:00</div>
      <div style="font-size:11px;color:var(--gray-500);margin:2px 0 12px;">${escHtml(tl.date)}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;">
        <div><div style="font-size:10px;color:var(--gray-500);text-transform:uppercase;">Arah Angin</div><div style="font-family:var(--font-mono);font-size:16px;font-weight:800;color:var(--heading);">${dispersiCompassLabel16(h.dir)} <span style="font-size:11px;color:var(--gray-500);">(${Math.round(h.dir)}&deg;)</span></div></div>
        <div><div style="font-size:10px;color:var(--gray-500);text-transform:uppercase;">Kecepatan</div><div style="font-family:var(--font-mono);font-size:16px;font-weight:800;color:var(--heading);">${dispersiFmt(h.speed,1)} <span style="font-size:11px;color:var(--gray-500);">m/s</span></div></div>
        ${h.temp!=null?`<div><div style="font-size:10px;color:var(--gray-500);text-transform:uppercase;">Suhu</div><div style="font-family:var(--font-mono);font-size:14px;font-weight:700;">${dispersiFmt(h.temp,1)}&deg;C</div></div>`:""}
        ${h.humidity!=null?`<div><div style="font-size:10px;color:var(--gray-500);text-transform:uppercase;">Kelembapan</div><div style="font-family:var(--font-mono);font-size:14px;font-weight:700;">${dispersiFmt(h.humidity,0)}%</div></div>`:""}
      </div>
      ${peakRow}
      <div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--gray-200);font-size:10.5px;color:var(--gray-500);line-height:1.6;">
        <div><b>Parameter:</b> ${escHtml(tl.paramLabel)}</div>
        <div><b>Periode Data (kekuatan sumber):</b> ${escHtml(tl.selLabel)}</div>
        <div><b>Kelas Stabilitas:</b> ${escHtml(tl.stabilityLabel)}</div>
        <div><b>Titik Sumber:</b> ${tl.sources.length} titik</div>
      </div>`;
  }
}
function dispersiTimelapseScrubTo(idx){ dispersiTimelapseStopTimer(); dispersiTimelapseRenderFrame(idx); const btn=document.getElementById("tlPlayBtn"); if(btn) btn.innerHTML="&#9654; Putar"; }
function dispersiTimelapseTogglePlay(){
  const tl = dispersiTimelapse;
  if(!tl.loaded || !tl.hours.length) return;
  if(tl.playing){ dispersiTimelapseStopTimer(); const btn=document.getElementById("tlPlayBtn"); if(btn) btn.innerHTML="&#9654; Putar"; return; }
  tl.playing = true;
  const btn=document.getElementById("tlPlayBtn"); if(btn) btn.innerHTML="&#10074;&#10074; Jeda";
  tl.timer = setInterval(()=>{
    // Modal bisa ditutup lewat klik overlay/tombol X yang tidak lewat dispersiTimelapseCloseModal
    // (mis. backdrop click bawaan) — jaga-jaga timer tetap dimatikan sendiri kalau elemennya sudah
    // tidak ada di DOM, bukan terus jalan diam-diam di belakang layar.
    if(!document.getElementById("tlSlider")){ dispersiTimelapseStopTimer(); return; }
    dispersiTimelapseRenderFrame((dispersiTimelapse.frameIdx+1) % dispersiTimelapse.hours.length);
  }, 750);
}
document.addEventListener("input", e=>{ if(e.target.id==="tlSlider") dispersiTimelapseScrubTo(e.target.value); });
document.addEventListener("click", e=>{
  const bar = e.target.closest ? e.target.closest(".tlBar") : null;
  if(bar) dispersiTimelapseScrubTo(bar.dataset.idx);
});

// Penjelasan sumber data angin & cara kerja model, dipisah dari sekian banyak hint kecil yang
// tersebar di halaman ini (tooltip, footer laporan, dst) jadi SATU tempat lengkap yang gampang
// ditemukan — sesuai pola openAboutModal/renderOnboardingModal (12-data-page.js) yang sudah ada.
function dispersiInfoModal(){
  openModal(`
    <h3>&#8505;&#65039; Info Model Dispersi &amp; Data Angin</h3>
    <div style="max-height:65vh;overflow:auto;font-size:13px;line-height:1.65;">
      <h4 style="margin:2px 0 4px;color:var(--navy-800);">Apa Itu Pemodelan Dispersi Udara &amp; Kedudukan Modul Ini</h4>
      <p>Pemodelan dispersi udara (air dispersion modeling) adalah metode perhitungan untuk memperkirakan bagaimana pencemar yang dilepaskan dari suatu sumber emisi (cerobong, flare, dan sejenisnya) menyebar di atmosfer akibat pengaruh angin, turbulensi, dan kondisi termal udara, sehingga konsentrasinya pada suatu titik di permukaan tanah dapat diestimasi. Metode ini merupakan bagian baku dari kajian Analisis Mengenai Dampak Lingkungan (AMDAL) serta pelaporan kepatuhan emisi udara pada industri hulu migas.</p>
      <p>Dua perangkat lunak yang umum menjadi acuan regulatory untuk keperluan tersebut:</p>
      <ul style="margin:4px 0 10px;padding-left:20px;">
        <li><b>AERMOD</b> — model dispersi untuk jarak dekat hingga menengah (umumnya di bawah 50 km dari sumber), dikembangkan oleh AERMIC (AMS/EPA Regulatory Model Improvement Committee), yaitu kelompok kerja gabungan American Meteorological Society (AMS) dan United States Environmental Protection Agency (US EPA). AERMOD ditetapkan sebagai model preferred oleh US EPA dalam Guideline on Air Quality Models (40 CFR Part 51, Appendix W) untuk sebagian besar kajian dispersi jarak dekat, dan menjadi acuan yang lazim diadaptasi pula pada kajian AMDAL di Indonesia.</li>
        <li><b>CALPUFF</b> — model dispersi non-steady-state berbasis puff, dikembangkan oleh Sigma Research Corporation (kemudian Earth Tech), dipakai untuk kondisi yang tidak dapat diasumsikan seragam oleh AERMOD: transport jarak jauh (di atas 50 km), medan/terrain kompleks, atau angin yang berubah arah secara signifikan sepanjang lintasan sebaran. CALPUFF sempat berstatus preferred model US EPA untuk transport jarak jauh, meski status tersebut telah direvisi pada pembaruan Appendix W tahun 2017 yang kini menempatkannya sebagai model alternatif berbasis persetujuan kasus per kasus (case-by-case), bukan lagi preferred baku.</li>
      </ul>
      <p>Kedua model tersebut mensyaratkan data meteorologi per jam yang telah diproses (umumnya melalui AERMET/CALMET) sepanjang minimal satu tahun, data terrain, serta parameter emisi yang lengkap dan tervalidasi — sebuah simulasi penuh yang berada di luar cakupan aplikasi ini. <b>Modul Model Dispersi Emisi pada aplikasi ini bukan AERMOD maupun CALPUFF</b>, dan tidak dimaksudkan untuk menggantikan keduanya. Modul ini adalah alat bantu screening internal yang dibangun langsung dari data yang sudah tersimpan di aplikasi (hasil stack sampling, running hour, koordinat titik), menggunakan persamaan Gaussian plume ground-level klasik dengan koefisien dispersi pendekatan Briggs — landasan matematis yang sama dengan model-model screening generasi sebelumnya (seperti SCREEN3/ISCST3) dan juga menjadi inti perhitungan di balik AERMOD sendiri, hanya tanpa lapisan pemrosesan meteorologi &amp; terrain yang membuat AERMOD/CALPUFF absah dipakai untuk pelaporan regulatory penuh. Fungsi modul ini adalah memberikan indikasi arah &amp; pola sebaran secara cepat dari data pemantauan yang sudah tercatat, sebagai pelengkap pemantauan harian — bukan pengganti kajian AMDAL atau studi dispersi bersertifikat yang mensyaratkan AERMOD/CALPUFF.</p>
      <h4 style="margin:14px 0 4px;color:var(--navy-800);">Sumber Data Angin</h4>
      <p>Data angin diambil otomatis dari <b>Open-Meteo</b> (layanan cuaca gratis, tanpa API key) berdasarkan koordinat pusat site yang sedang dipilih:</p>
      <ul style="margin:4px 0 10px;padding-left:20px;">
        <li><b>Mode Live</b>: Forecast API &mdash; kondisi angin (kecepatan, arah, suhu, kelembapan) SAAT INI, plus riwayat per jam 7 hari terakhir (dipakai jg utk Wind Rose &amp; tren kecepatan di kartu Data Angin). Auto-refresh tiap 5 menit.</li>
        <li><b>Mode Periode</b>: Archive API &mdash; riwayat angin per jam SEPANJANG semester/periode yang dipilih (bukan cuma 7 hari), dikelompokkan jadi 16 sektor arah &amp; dibobot frekuensi kejadian tiap sektor. Ada delay arsip Open-Meteo &plusmn;5 hari &mdash; kalau periode masih berjalan, tanggal akhir otomatis dipotong ke data terbaru yang tersedia.</li>
      </ul>
      <h4 style="margin:14px 0 4px;color:var(--navy-800);">Cara Kerja Model &amp; Visualisasi</h4>
      <p>Pola sebaran dihitung pakai <b>model Gaussian plume ground-level</b> (dengan refleksi tanah) + koefisien sigma-y/sigma-z pendekatan Briggs (rural power-law) per <b>kelas stabilitas atmosfer Pasquill-Gifford (A&ndash;F)</b> &mdash; dasar matematis yang sama dipakai basis model screening AERMOD/ISCST3 versi sederhana.</p>
      <ul style="margin:4px 0 10px;padding-left:20px;">
        <li><b>Live</b>: satu snapshot arah+kecepatan angin &rarr; plume berbentuk kerucut sempit.</li>
        <li><b>Periode</b>: superposisi SEMUA sektor arah angin sepanjang periode, dibobot frekuensi &rarr; plume berbentuk kipas melebar (mendekati pola sebaran jangka panjang).</li>
        <li>Grid konsentrasi dihitung ulang otomatis mengikuti VIEWPORT peta saat ini (bukan kotak tetap di sekitar titik) &mdash; tidak pernah kepotong saat zoom-out, tidak blur saat zoom-in.</li>
        <li><b>Skala warna SELALU dinormalisasi ke puncak konsentrasi lokal saat itu juga</b> (bukan skala tetap) &mdash; warna yang sama bisa berarti NILAI BERBEDA di tampilan berbeda. Legenda angka di bawah peta ikut berubah tiap plume dihitung ulang (peta digeser/zoom/ganti filter/angin) &mdash; selalu baca angkanya, bukan cuma warnanya.</li>
      </ul>
      <h4 style="margin:14px 0 4px;color:var(--navy-800);">Peta pada Laporan PDF</h4>
      <p>Latar peta (citra satelit/jalan, mengikuti pilihan Satelit/Jalan di layar) diambil dari layanan basemap <b>Esri</b> saat laporan dicetak &mdash; butuh koneksi internet SAAT ITU. Kalau tidak ada internet, latar peta bisa kosong tapi lapisan pola sebaran, cincin jarak, panah utara/angin, &amp; titik sumber di atasnya tetap tampil normal (digambar lokal di browser dari data yang sama dengan peta interaktif).</p>
      <h4 style="margin:14px 0 4px;color:var(--navy-800);">Keterbatasan</h4>
      <p class="hint">Ini model SCREENING sederhana: medan datar, angin &amp; stabilitas seragam di seluruh area, tanpa transformasi kimia atmosfer. BUKAN pengganti kajian dispersi regulatory penuh (perlu simulasi meteorologi per jam minimal 1 tahun, model AERMOD lengkap). Gunakan sebagai indikasi awal/screening, silangkan ke kajian resmi untuk keputusan kepatuhan.</p>
    </div>
    <div class="actions"><button class="btn primary" data-action="closeModal">Tutup</button></div>
  `, {wide:true});
}
Object.assign(ACTIONS, {
  dispersiSetSite, dispersiSetParam, dispersiOnPeriodeChange, dispersiOnStabilityChange,
  dispersiSetWindModeLive, dispersiSetWindModePeriode, dispersiSetMapLayerSat, dispersiSetMapLayerStreet,
  dispersiRefreshWind, dispersiSelectAllAtSite, dispersiDeselectAll, printDispersiReport, doPrintDispersiReport,
  dispersiToggleTipe, dispersiManualRefreshPlume, dispersiInfoModal,
  dispersiOpenProfessionalPreview, dispersiPrintProfessionalPreview,
  dispersiToggleTitikPanel, dispersiTitikCheckAllVisible, dispersiTitikUncheckAllVisible,
  dispersiSetWindModeCustom, dispersiApplyCustomWindRange,
  dispersiOpenExpertMode, dispersiTimelapseLoad, dispersiTimelapseTogglePlay, dispersiTimelapseCloseModal
});
document.addEventListener("change", e=>{
  if(e.target.id==="dispersiPeriode") dispersiOnPeriodeChange();
  if(e.target.id==="dispersiStability") dispersiOnStabilityChange();
});
