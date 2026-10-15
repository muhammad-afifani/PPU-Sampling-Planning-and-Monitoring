/* =========================================================
   LAPORAN EMF & EMP (Environmental Monitoring Feedback / Plan)
   ---------------------------------------------------------
   Generator tabel laporan EMF per site & per semester, disusun LANGSUNG dari database yang sudah
   ada (DB.points, DB.hasilPemantauan, DB.hasilAmbien, DB.pointCoords) — pengganti tabel manual
   versi Excel/PDF lama yang terlalu banyak kolom & penuh "N/A". Tiap tabel bisa disalin ke Word
   (HTML dgn style inline, jadi format border/header ikut terbawa saat paste), diunduh sbg 1 file
   Word (.doc), atau diekspor ke Excel (1 sheet per tabel, sel gabungan ikut).

   Satu "model tabel" (emfBuild*) dipakai bareng oleh SEMUA keluaran (pratinjau layar, salin ke
   Word, .doc, Excel) — supaya keempatnya tidak pernah beda isi.

   Sumber emisi yang TIDAK dipantau tetap dicantumkan (dgn alasan jelas: tidak wajib/emergency
   RH < 200 jam/tahun/kapasitas < 100 kW/belum jadwal/tidak beroperasi/surat pernyataan), sesuai
   kebiasaan laporan EMF — alasannya diturunkan dari logika yang sama dgn bagian lain app ini
   (wajibReason/isEmergencyEngine/isUnder100kW di 03-period-logic.js), bukan logika baru.
   EMP (rencana pemantauan) menyusul di tahap berikutnya.
========================================================= */
let emfState = {site:"", period:"", startNo:16, includeRef:true, includeSupport:true, idNumber:true};
let emfLastBlocks = [];

/* ---------- Referensi statis (baku mutu) ---------- */
// Nilai disamakan dgn halaman Baku Mutu & Periode Pantau app ini (yang juga jadi acuan kolom
// "standard" di Database Hasil Emisi) — BUKAN disalin mentah dari PDF laporan lama, krn PDF lama
// sempat beda sendiri (mis. SO2 minyak 1001–3000 kW tertulis 150 di tabel baku mutunya tapi 120
// di tabel hasilnya; satuan kebauan tertulis mg/l padahal KepMenLH 50/1996 dalam ppm).
const EMF_BM_TURBIN = {
  Gas: [["Total Partikulat","mg/Nm³","50"],["Sulfur Dioksida (SO₂)","mg/Nm³","150"],["Nitrogen Oksida (NOx) sbg NO₂","mg/Nm³","320"]],
  Minyak: [["Total Partikulat","mg/Nm³","100"],["Sulfur Dioksida (SO₂)","mg/Nm³","650"],["Nitrogen Oksida (NOx) sbg NO₂","mg/Nm³","450"],["Opasitas","%","20"]]
};
const EMF_BM_HEATER = {
  Gas: [["Total Partikulat","mg/Nm³","50"],["Sulfur Dioksida (SO₂)","mg/Nm³","150"],["Nitrogen Oksida (NOx) sbg NO₂","mg/Nm³","400"],["Opasitas","%","20"]],
  Minyak: [["Total Partikulat","mg/Nm³","150"],["Sulfur Dioksida (SO₂)","mg/Nm³","1200"],["Nitrogen Oksida (NOx) sbg NO₂","mg/Nm³","800"],["Opasitas","%","20"]]
};
const EMF_BM_GENSET = [
  ["101 – 500 kW","Minyak",[["Nitrogen Oksida (NOx)","3400"],["Karbon Monoksida (CO)","170"]]],
  ["101 – 500 kW","Gas",[["Nitrogen Oksida (NOx)","300"],["Karbon Monoksida (CO)","450"]]],
  ["501 – 1000 kW","Minyak",[["Total Partikulat","95"],["Sulfur Dioksida (SO₂)","160"],["Nitrogen Oksida (NOx)","1850"],["Karbon Monoksida (CO)","77"]]],
  ["501 – 1000 kW","Gas",[["Sulfur Dioksida (SO₂)","150"],["Nitrogen Oksida (NOx)","300"],["Karbon Monoksida (CO)","250"]]],
  ["1001 – 3000 kW","Minyak",[["Total Partikulat","90"],["Sulfur Dioksida (SO₂)","120"],["Nitrogen Oksida (NOx)","2300"],["Karbon Monoksida (CO)","168"]]],
  ["1001 – 3000 kW","Gas",[["Sulfur Dioksida (SO₂)","60"],["Nitrogen Oksida (NOx)","285"],["Karbon Monoksida (CO)","250"]]]
];
const EMF_AMB_PARAMS = [
  {kode:"SO2", label:"Sulfur Dioksida (SO₂)", durasi:"1 jam", baku:"150", metode:"Pararosanilin", alat:"Spektrofotometer"},
  {kode:"CO", label:"Karbon Monoksida (CO)", durasi:"1 jam", baku:"10000", metode:"NDIR", alat:"NDIR Analyzer"},
  {kode:"NOx", label:"Nitrogen Dioksida (NO₂)", durasi:"1 jam", baku:"200", metode:"Saltzman", alat:"Spektrofotometer"},
  {kode:"O3", label:"Oksidan (O₃)", durasi:"1 jam", baku:"150", metode:"Chemiluminescent", alat:"Spektrofotometer"},
  {kode:"NMHC", label:"Hidrokarbon Non Metana (NMHC)", durasi:"3 jam", baku:"160", metode:"Flame Ionization", alat:"Gas Chromatography"},
  {kode:"PM10", label:"Partikel < 10 µm (PM10)", durasi:"24 jam", baku:"75", metode:"Gravimetric", alat:"Hi-Vol"},
  {kode:"PM2.5", label:"Partikel < 2,5 µm (PM2,5)", durasi:"24 jam", baku:"55", metode:"Gravimetric", alat:"Hi-Vol"},
  {kode:"TSP", label:"Debu (TSP)", durasi:"24 jam", baku:"230", metode:"Gravimetric", alat:"Hi-Vol"},
  {kode:"Pb", label:"Timbal (Pb)", durasi:"24 jam", baku:"2", metode:"Gravimetric", alat:"Hi-Vol"}
];
const EMF_ODR_PARAMS = [
  {kode:"H2S", label:"Hidrogen Sulfida (H₂S)", baku:"0.02", metode:"Merkuri Tiosianat / Absorbsi Gas", alat:"Spektrofotometer / Gas Kromatograf"},
  {kode:"NH3", label:"Amonia (NH₃)", baku:"2", metode:"Indofenol", alat:"Spektrofotometer"},
  {kode:"Styrene", label:"Stirena (C₆H₅CHCH₂)", baku:"0.1", metode:"Absorbsi Gas", alat:"Gas Kromatograf"},
  {kode:"Methyl Mercaptan", label:"Metil Merkaptan (CH₃SH)", baku:"0.002", metode:"Absorbsi Gas", alat:"Gas Kromatograf"},
  {kode:"Methyl Sulfide", label:"Metil Sulfida ((CH₃)₂S)", baku:"0.01", metode:"Absorbsi Gas", alat:"Gas Kromatograf"}
];
const EMF_VIB_BM = [
  ["4","<100","100–500",">500–1000",">1000"],["5","<80","80–350",">350–1000",">1000"],
  ["6.3","<70","70–275",">275–1000",">1000"],["8","<50","50–160",">160–500",">500"],
  ["10","<37","37–120",">120–300",">300"],["12.5","<32","32–90",">90–220",">220"],
  ["16","<25","25–60",">60–120",">120"],["20","<20","20–40",">40–85",">85"],
  ["25","<17","17–30",">30–50",">50"],["31.5","<12","12–20",">20–30",">30"],
  ["40","<9","9–15",">15–20",">20"],["50","<8","8–12",">12–15",">15"],["63","<6","6–9",">9–12",">12"]
];
const EMF_VIB_STATUS = {"Not Disturb":"Tidak Mengganggu", "Disturb":"Mengganggu", "Uncomfortable":"Tidak Nyaman", "Painful":"Menyakitkan"};
const EMF_REG = {
  turbin:"Permen LH No. 13 Tahun 2009", heater:"Permen LH No. 13 Tahun 2009", flare:"Permen LH No. 13 Tahun 2009",
  genset:"Permen LHK No. 11 Tahun 2021", ambien:"PP No. 22 Tahun 2021 Lampiran VII",
  kebisingan:"KepMenLH No. 48 Tahun 1996", kebauan:"KepMenLH No. 50 Tahun 1996", getaran:"KepMenLH No. 49 Tahun 1996"
};
// Urutan & label parameter emisi di tabel hasil — parameter wajib/berbaku mutu dulu, baru data
// pendukung (O2/CO2/laju alir/suhu gas yang tidak punya baku mutu).
const EMF_EMISI_PARAM = {
  "NOx":{o:1,l:"NOx"}, "SO₂":{o:2,l:"SO₂"}, "SO2":{o:2,l:"SO₂"}, "Total Partikulat":{o:3,l:"Total Partikulat"},
  "CO":{o:4,l:"CO"}, "Opasitas":{o:5,l:"Opasitas"}, "H2S":{o:6,l:"H₂S"},
  "O₂":{o:10,l:"O₂"}, "CO₂":{o:11,l:"CO₂"}, "Laju Alir (v)":{o:12,l:"Laju Alir"}, "Gas Temperatur":{o:13,l:"Suhu Gas"}
};

/* ---------- Format angka & teks ---------- */
const EMF_SUP = {"0":"⁰","1":"¹","2":"²","3":"³","4":"⁴","5":"⁵","6":"⁶","7":"⁷","8":"⁸","9":"⁹","-":"⁻","+":"⁺"};
function emfLocalizeNumbers(s){
  return s.replace(/\d+(?:\.\d+)?/g, tok=>{
    const parts = tok.split(".");
    const intPart = parts[0].length>=4 ? parts[0].replace(/\B(?=(\d{3})+(?!\d))/g,".") : parts[0];
    return parts.length>1 ? intPart+","+parts[1] : intPart;
  });
}
// Nilai hasil/baku mutu — "1.57 x 10^-3" jadi "1,57 × 10⁻³" (pangkat pakai karakter superscript
// Unicode, bukan tag <sup>, supaya tetap benar di Word MAUPUN di Excel yang tidak kenal HTML).
function emfVal(v){
  if(v==null || v==="") return "–";
  let s = String(v).trim();
  if(!s) return "–";
  s = s.replace(/\s*[xX×]\s*10\s*\^\s*([+-]?\d+)/g, (m,e)=>" × 10"+e.split("").map(c=>EMF_SUP[c]||c).join(""));
  return emfState.idNumber ? emfLocalizeNumbers(s) : s;
}
function emfUnit(u){ return String(u||"").replace(/^oC$/i,"°C").replace(/^micron$/i,"µm").replace(/m3\//,"m³/").replace(/Nm3$/,"Nm³"); }
function emfPeriodText(period){
  const p = parsePeriodStr(period);
  return p ? `Semester ${p.sem} Tahun ${p.year}` : period;
}
function emfDateRange(dates){
  const ds = [...new Set(dates.filter(Boolean))].sort();
  if(!ds.length) return "";
  if(ds.length===1) return fmtTanggalIndo(ds[0]);
  const [y1,m1,d1] = ds[0].split("-").map(Number), [y2,m2,d2] = ds[ds.length-1].split("-").map(Number);
  if(y1===y2 && m1===m2) return `${d1}–${d2} ${MONTH_FULL_ID[m1-1]} ${y1}`;
  if(y1===y2) return `${d1} ${MONTH_FULL_ID[m1-1]} – ${d2} ${MONTH_FULL_ID[m2-1]} ${y1}`;
  return `${fmtTanggalIndo(ds[0])} – ${fmtTanggalIndo(ds[ds.length-1])}`;
}
function emfDms(dec, isLat){
  if(dec==null || isNaN(dec)) return "";
  const hemi = isLat ? (dec<0?"LS":"LU") : (dec<0?"BB":"BT");
  let totalTenths = Math.round(Math.abs(dec)*36000);
  const deg = Math.floor(totalTenths/36000); totalTenths -= deg*36000;
  const min = Math.floor(totalTenths/600); totalTenths -= min*600;
  const sec = (totalTenths/10).toFixed(1);
  const secTxt = emfState.idNumber ? sec.replace(".",",") : sec;
  return `${deg}° ${String(min).padStart(2,"0")}' ${secTxt.padStart(4,"0")}" ${hemi}`;
}
function emfCoordOf(site, nama){
  const c = DB.pointCoords && DB.pointCoords[site+"::"+nama];
  return c ? {ls:emfDms(c[0],true), bt:emfDms(c[1],false)} : null;
}
function emfCoordText(site, nama, sep){
  const c = emfCoordOf(site, nama);
  return c ? `${c.ls}${sep||"\n"}${c.bt}` : "–";
}
function emfFrekText(months){
  const m = Number(months);
  if(!m) return "–";
  return m%12===0 ? `1 x ${m/12} tahun` : `1 x ${m} bulan`;
}
function emfKapasitas(p){
  const parts = [];
  if(p.kapasitas && !/^n\/?a$/i.test(p.kapasitas)) parts.push(emfVal(p.kapasitas));
  if(p.jenisBahanBakar) parts.push(p.jenisBahanBakar);
  return parts.join(" · ") || "–";
}
// Nama yg tampil ke pembaca laporan (pada mode Visitor, DB.points.nama sudah disamarkan oleh
// gerbang akses — data hasil yg TIDAK punya pasangan titik di DB.points ikut disamarkan juga).
function emfIsMasked(){ return typeof gateState!=="undefined" && !(gateState && gateState.mode==="phm"); }

/* ---------- Pengelompokan & status sumber emisi ---------- */
function emfEmisiGroup(p){
  const ks = normKS(p.kategoriSumber);
  if(ks.indexOf("SULFUR")>=0) return "sulfur";
  return pointRegGroup(p) || "genset";
}
function emfSortByName(a,b){ return String(a.nama).localeCompare(String(b.nama), "id", {numeric:true}); }
// Sumber emisi site ini — termasuk entri data hasil yang engineId-nya tidak punya pasangan di
// DB.points (dibuatkan titik "bayangan" dari isi baris hasilnya) supaya TIDAK ada data hasil yang
// hilang diam2 dari laporan.
function emfEmisiSources(site, period){
  const pts = DB.points.filter(p=>p.site===site && p.kategori==="emisi");
  const known = new Set(pts.map(p=>p.id));
  const orphans = {};
  DB.hasilPemantauan.forEach(r=>{
    if(r.site!==site || r.periode!==period || known.has(r.engineId)) return;
    if(!orphans[r.engineId]){
      orphans[r.engineId] = {id:r.engineId, site, kategori:"emisi", nama: emfIsMasked() ? "TITIK-?" : (r.cerobong||r.engineId),
        kategoriSumber:r.namaSumber||"", jenisBahanBakar:r.jenisBahanBakar||"", kapasitas:"", wajib:true, frekuensiBulan:6, parameter:"", _orphan:true};
    }
  });
  return pts.concat(Object.values(orphans));
}
function emfHasilRows(p, period){
  return DB.hasilPemantauan.filter(r=>r.engineId===p.id && r.periode===period)
    .sort((a,b)=>((EMF_EMISI_PARAM[a.parameter]||{o:50}).o)-((EMF_EMISI_PARAM[b.parameter]||{o:50}).o));
}
function emfIsSupportRow(r){ return r.standard==null && r.statusBakuMutu!=="exceed"; }
function emfLastSampledBefore(p, period){
  const cur = parsePeriodStr(period); if(!cur) return null;
  let best = null;
  const consider = s=>{ const pp = parsePeriodStr(s); if(pp && periodCompare(pp,cur)<0 && (!best || periodCompare(pp,best)>0)) best = pp; };
  DB.hasilPemantauan.forEach(r=>{ if(r.engineId===p.id && r.resultStatus!=="declaration") consider(r.periode); });
  consider(p.pemantauanTerakhir);
  return best ? periodLabel(best.sem, best.year) : null;
}
// Catatan operasional yg tercatat KHUSUS utk periode laporan ini — alasan dikeluarkan dari batch
// (Scheduling Tools) atau catatan status sampling (Tracking) dari batch yg periodenya sama.
function emfOpsNote(p, period){
  for(const b of DB.batches.filter(x=>x.period===period)){
    if((b.excluded||[]).includes(p.id)){
      const r = (b.excludeReasons||{})[p.id] || {};
      if(r.note) return r.note;
      if(r.reason && typeof EXCLUDE_REASON_LABELS!=="undefined" && EXCLUDE_REASON_LABELS[r.reason]) return EXCLUDE_REASON_LABELS[r.reason];
    }
  }
  const b = p.batchId ? DB.batches.find(x=>x.id===p.batchId) : null;
  const t = DB.tracking && DB.tracking[p.id];
  if(b && b.period===period && t && ["deferred","other","notdue"].includes(t.samplingStatus) && t.samplingNote) return t.samplingNote;
  return "";
}
// Alasan sumber emisi tidak dipantau pada periode ini — {cat, text, warn}. cat dipakai utk
// ringkasan jumlah per alasan; warn=true artinya MESTINYA ada data (wajib & jatuh tempo) tapi
// belum diinput ke Database Hasil Emisi — ditandai merah supaya ketahuan sebelum disalin ke laporan.
// `text` ditulis sbg lanjutan kalimat "Tidak dipantau — …" (lihat emfNotSampledCell).
function emfNotSampledReason(p, period, hasDeclaration){
  const ops = emfOpsNote(p, period);
  if(hasDeclaration) return {cat:"declaration", text:"dilampirkan Surat Pernyataan"+(ops?` (${ops})`:""), wajib:true};
  if(p.tidakBeroperasi) return {cat:"nonop", text:"sumber emisi tidak beroperasi"+(p.keterangan?` (${p.keterangan})`:"")};
  if(ops) return {cat:"ops", text:ops.charAt(0).toLowerCase()+ops.slice(1), wajib:true};
  if(p._orphan) return {cat:"missing", text:"data hasil tidak lengkap", warn:true, wajib:true};
  const r = wajibReason(p, period);
  if(r.type==="emergency-exempt"){
    const rh = rhYearValue(p, period);
    const rhTxt = rh!=null && !isNaN(rh) ? `${emfVal(Math.round(rh*10)/10)} jam` : `< ${RH_WAJIB_THRESHOLD} jam`;
    return {cat:"emergency", text:`tidak wajib pantau, unit emergency dengan running hour 12 bulan terakhir ${rhTxt} (< ${RH_WAJIB_THRESHOLD} jam/tahun)`};
  }
  if(r.type==="not-wajib"){
    if(isUnder100kW(p)) return {cat:"under100", text:`tidak wajib pantau, kapasitas ${emfVal(p.kapasitasKW)} kW (< ${CAPACITY_EXEMPT_KW} kW)`};
    const alasan = (p.alasanTidakWajib||"").trim();
    return {cat:"notwajib", text: alasan && !/^tidak wajib( di ?pantau)?\.?$/i.test(alasan) ? `tidak wajib pantau (${alasan})` : "tidak wajib pantau"};
  }
  const last = emfLastSampledBefore(p, period);
  if(last){
    const next = nextPeriodAfter(last, p.frekuensiBulan||6);
    if(periodCompare(parsePeriodStr(next), parsePeriodStr(period))>0){
      return {cat:"notdue", text:`belum jadwal pantau (${emfFrekText(p.frekuensiBulan)}; terakhir ${last}, berikutnya ${next})`, wajib:true};
    }
  } else if(!isDueThisPeriod(p, period)){
    return {cat:"notdue", text:`belum jadwal pantau (${emfFrekText(p.frekuensiBulan)}${p.prediksiBerikutnya?`; berikutnya ${p.prediksiBerikutnya}`:""})`, wajib:true};
  }
  return {cat:"missing", text:"wajib pantau periode ini, namun data hasil belum diinput", warn:true, wajib:true};
}
// Satu sel lebar (gabungan kolom Parameter s/d Keterangan) berisi "Tidak dipantau — alasan" —
// dulu alasannya dijepit di kolom Keterangan yang sempit sementara sel gabungan di sebelahnya
// kosong melompong, bikin baris jadi tinggi. Parameter wajib cuma disebut utk sumber yg memang
// wajib (biar jelas apa yang mestinya diukur), tidak utk sumber yg tidak wajib pantau.
function emfNotSampledCell(p, why, cs){
  const param = why.wajib && p.parameter ? ` · parameter wajib: ${p.parameter.replace(/SO2/g,"SO₂")}` : "";
  return C(`Tidak dipantau — ${why.text}${param}`, why.warn ? {cs, color:"#C00000", bold:true} : {cs, italic:true, color:"#404040"});
}
const EMF_CAT_LABEL = {
  declaration:"dilampirkan surat pernyataan", nonop:"tidak beroperasi", ops:"terkendala operasional",
  emergency:"unit emergency dengan running hour < 200 jam/tahun", under100:"berkapasitas < 100 kW",
  notwajib:"tidak wajib pantau", notdue:"belum jadwal pantau", missing:"wajib pantau namun data hasil belum diinput"
};
function emfStatusCell(r){
  if(r.statusBakuMutu==="exceed") return C("Melebihi baku mutu", {color:"#C00000", bold:true, align:"center"});
  if(r.statusBakuMutu==="ok") return C("Memenuhi", {color:"#1E7B47", align:"center"});
  if(r.resultStatus==="declaration") return C("Surat Pernyataan", {align:"center", italic:true});
  if(r.standard==null) return C("Data pendukung", {color:"#595959", align:"center", italic:true});
  if(r.statusBakuMutu==="not_applicable") return C("Tidak dipersyaratkan", {color:"#595959", align:"center", italic:true});
  return C("Tidak dievaluasi", {color:"#595959", align:"center", italic:true});
}

/* ---------- Model tabel ---------- */
function C(v, o){ return Object.assign({v: v==null ? "" : String(v)}, o||{}); }
function emfBlock(o){ return Object.assign({id:"b"+(emfLastBlocks.length+Math.random()).toString(36).replace(".",""), caption:"", subcaption:"", tables:[], notes:[], summary:"", ref:false, empty:"", sheet:""}, o); }

// --- Referensi: Baku mutu turbin / heater / genset / flare
function emfBmFuelTable(map, fuels){
  const rows = [];
  fuels.forEach(fuel=>{
    const list = map[fuel] || [];
    list.forEach((it,i)=>{
      const row = [];
      if(i===0) row.push(C(fuel, {rs:list.length, align:"center"}));
      row.push(C(it[0]), C(it[1], {align:"center"}), C(emfVal(it[2]), {align:"center"}));
      rows.push(row);
    });
  });
  return {columns:[{l:"Jenis Bahan Bakar",w:22},{l:"Parameter",w:42},{l:"Satuan",w:16},{l:"Baku Mutu",w:20}], rows};
}
function emfFuelsOf(points){
  const f = [...new Set(points.map(p=>/minyak|solar|diesel/i.test(p.jenisBahanBakar||"") ? "Minyak" : "Gas"))];
  return f.length ? f.sort() : ["Gas"];
}
function emfBuildBmBlocks(site, sources){
  const out = [];
  const turbin = sources.filter(p=>emfEmisiGroup(p)==="turbin");
  const heater = sources.filter(p=>emfEmisiGroup(p)==="heater");
  const genset = sources.filter(p=>emfEmisiGroup(p)==="genset");
  const flare = sources.filter(p=>emfEmisiGroup(p)==="flare");
  if(turbin.length) out.push(emfBlock({ref:true, sheet:"BM Turbin Gas", caption:"Baku Mutu Emisi Proses Pembakaran dari Turbin Gas",
    subcaption:`${EMF_REG.turbin} — berlaku untuk compressor turbine & generator turbine.`,
    tables:[emfBmFuelTable(EMF_BM_TURBIN, emfFuelsOf(turbin))],
    notes:["Volume gas diukur dalam keadaan standar (25°C dan tekanan 1 atmosfer) dan semua parameter dikoreksi dengan O₂ sebesar 15% dalam keadaan kering."]}));
  if(heater.length) out.push(emfBlock({ref:true, sheet:"BM Boiler & Heater", caption:"Baku Mutu Emisi Proses Pembakaran dari Boiler & Heater",
    subcaption:`${EMF_REG.heater} — berlaku untuk heater, glycol reboiler & sejenisnya.`,
    tables:[emfBmFuelTable(EMF_BM_HEATER, emfFuelsOf(heater))],
    notes:["Volume gas diukur dalam keadaan standar (25°C dan tekanan 1 atmosfer) dan semua parameter dikoreksi dengan O₂ sebesar 3% dalam keadaan kering, kecuali opasitas."]}));
  if(genset.length){
    const rows = [];
    EMF_BM_GENSET.forEach(([kap, fuel, list])=>{
      list.forEach((it,i)=>{
        const row = [];
        if(i===0) row.push(C(fuel, {rs:list.length, align:"center"}), C(emfVal(kap), {rs:list.length, align:"center"}));
        row.push(C(it[0]), C("mg/Nm³", {align:"center"}), C(emfVal(it[1]), {align:"center"}));
        rows.push(row);
      });
    });
    out.push(emfBlock({ref:true, sheet:"BM Mesin Pemb. Dalam", caption:"Baku Mutu Emisi Mesin dengan Pembakaran Dalam",
      subcaption:`${EMF_REG.genset} — berlaku untuk diesel/gas engine generator, pump & compressor.`,
      tables:[{columns:[{l:"Jenis Bahan Bakar",w:17},{l:"Kapasitas",w:19},{l:"Parameter",w:34},{l:"Satuan",w:14},{l:"Baku Mutu",w:16}], rows}],
      notes:["Volume gas diukur dalam keadaan standar (25°C dan tekanan 1 atmosfer) dan semua parameter dikoreksi dengan O₂ sebesar 15%.",
        "Tidak berlaku bagi sumber emisi berkapasitas ≤ 100 kW, beroperasi kumulatif < 1.000 jam/tahun, atau untuk keperluan darurat/perbaikan/pemeliharaan yang beroperasi kumulatif ≤ 200 jam/tahun."]}));
  }
  if(flare.length) out.push(emfBlock({ref:true, sheet:"BM Flare", caption:"Baku Mutu Emisi Proses Pembakaran dari Unit Suar Bakar (Flare)",
    subcaption:EMF_REG.flare,
    tables:[{columns:[{l:"Jenis",w:34},{l:"Parameter",w:33},{l:"Baku Mutu",w:33}], rows:[[C("Cerobong Flare"), C("Opasitas"), C(emfVal("40")+" %", {align:"center"})]]}]}));
  return out;
}

// --- Daftar sumber emisi (inventaris)
function emfFrekKewajiban(p, period){
  if(p.tidakBeroperasi) return "Tidak beroperasi";
  const r = wajibReason(p, period);
  if(r.type==="emergency-exempt" || r.type==="emergency-triggered") return `${emfFrekText(p.frekuensiBulan)}, bila RH > ${RH_WAJIB_THRESHOLD} jam/tahun`;
  if(r.type==="not-wajib") return isUnder100kW(p) ? `Tidak wajib (< ${CAPACITY_EXEMPT_KW} kW)` : "Tidak wajib";
  return emfFrekText(p.frekuensiBulan);
}
function emfBuildListBlock(site, period, sources){
  const order = ["turbin","heater","flare","genset"];
  const list = sources.filter(p=>emfEmisiGroup(p)!=="sulfur")
    .sort((a,b)=>(order.indexOf(emfEmisiGroup(a))-order.indexOf(emfEmisiGroup(b))) || emfSortByName(a,b));
  if(!list.length) return null;
  const rows = list.map((p,i)=>[
    C(i+1, {align:"center"}), C(p.nama, {bold:true}), C(p.kategoriSumber||"–"), C(emfKapasitas(p)),
    C(p.parameter ? p.parameter.replace(/SO2/g,"SO₂") : "–"), C(emfFrekKewajiban(p, period)), C(emfCoordText(site, p.nama), {align:"center", nowrap:true})
  ]);
  return emfBlock({ref:true, sheet:"Daftar Sumber Emisi", caption:`Daftar Sumber Emisi ${site}`,
    tables:[{columns:[{l:"No",w:5},{l:"Nama Cerobong",w:18},{l:"Jenis Sumber",w:16},{l:"Kapasitas · Bahan Bakar",w:13},{l:"Parameter Pemantauan",w:14},{l:"Frekuensi Kewajiban",w:14},{l:"Koordinat",w:20}], rows}],
    notes:["RH = running hour (jam operasi) 12 bulan terakhir; unit emergency/standby wajib dipantau hanya bila RH > 200 jam/tahun."]});
}

// --- Kandungan sulfur bahan bakar (H2S)
function emfBuildSulfurBlock(site, period, sources){
  const pts = sources.filter(p=>emfEmisiGroup(p)==="sulfur");
  if(!pts.length) return null;
  const rows = [], dates = [];
  pts.sort(emfSortByName).forEach(p=>{
    const rs = emfHasilRows(p, period);
    if(!rs.length){
      const why = emfNotSampledReason(p, period, false);
      rows.push([C(p.nama, {bold:true}), emfNotSampledCell(p, why, 3)]);
      return;
    }
    rs.forEach(r=>{
      dates.push(r.dateOfSampling);
      const ok = r.statusBakuMutu==="ok";
      rows.push([C(p.nama, {bold:true}), C(emfVal(r.resultRaw), {align:"center"}), C("≤ "+emfVal(r.standard!=null?r.standard:"0.5"), {align:"center"}),
        C(ok ? "Memenuhi — baku mutu SO₂ numerik tidak berlaku" : (r.statusBakuMutu==="exceed" ? "Melebihi 0,5% — SO₂ wajib dipantau" : emfStatusCell(r).v), ok?{color:"#1E7B47"}:(r.statusBakuMutu==="exceed"?{color:"#C00000",bold:true}:{}))]);
    });
  });
  const dt = emfDateRange(dates);
  return emfBlock({sheet:"Kandungan Sulfur", caption:"Kandungan Sulfur dalam Bahan Bakar",
    subcaption:`${EMF_REG.turbin} Pasal 12 ayat (2) huruf b${dt?` · Tanggal pengukuran: ${dt}`:""}`,
    tables:[{columns:[{l:"Titik Pengambilan Contoh",w:34},{l:"Hasil H₂S (% berat)",w:18},{l:"Baku Mutu (%)",w:14},{l:"Status",w:34}], rows}],
    notes:["Bagi sumber emisi dengan kapasitas < 25 MW, baku mutu SO₂ tidak berlaku bila kandungan sulfur dalam bahan bakar ≤ 0,5% berat; kandungan sulfur dipantau 6 bulan sekali."]});
}

// --- Hasil pemantauan emisi (a: turbin/boiler/heater, b: mesin pembakaran dalam)
function emfBuildEmisiTable(list, site, period, stats){
  const rows = [];
  list.forEach((p, idx)=>{
    const all = emfHasilRows(p, period);
    const declOnly = all.length>0 && all.every(r=>r.resultStatus==="declaration");
    const measured = declOnly ? [] : all.filter(r=>r.resultStatus!=="declaration");
    // Sembunyikan data pendukung kalau opsinya dimatikan — KECUALI sumber itu memang cuma punya
    // data pendukung, supaya tidak salah dilaporkan "tidak dipantau" padahal sudah diukur.
    let shown = measured;
    if(!emfState.includeSupport && measured.some(r=>!emfIsSupportRow(r))) shown = measured.filter(r=>!emfIsSupportRow(r));
    const dates = all.map(r=>r.dateOfSampling).filter(Boolean);
    const lines = [p.nama, p.kategoriSumber, emfKapasitas(p)];
    if(shown.length && dates.length) lines.push("Sampling: "+emfDateRange(dates));
    const srcCell = C(lines.filter(Boolean).join("\n"), {rs: Math.max(1, shown.length), firstBold:true});
    const noCell = C(idx+1, {rs: Math.max(1, shown.length), align:"center"});
    stats.total++;
    if(!shown.length){
      const why = emfNotSampledReason(p, period, declOnly);
      stats.cats[why.cat] = (stats.cats[why.cat]||0)+1;
      rows.push([noCell, srcCell, emfNotSampledCell(p, why, 5)]);
      return;
    }
    stats.sampled++;
    stats.dates.push(...dates);
    shown.forEach((r,i)=>{
      const meta = EMF_EMISI_PARAM[r.parameter] || {l:r.parameter};
      const row = i===0 ? [noCell, srcCell] : [];
      if(r.statusBakuMutu==="exceed") stats.exceed.push(`${meta.l} pada ${p.nama} (${emfVal(r.resultRaw)} ${emfUnit(r.unit)}; baku mutu ${emfVal(r.standard)})`);
      row.push(C(`${meta.l} (${emfUnit(r.unit)})`, {nowrap:true}), C(emfVal(r.resultRaw), {align:"center", nowrap:true}), C(r.standard!=null?emfVal(r.standard):"–", {align:"center", nowrap:true}),
        C(r.metode && r.metode!=="N/A" ? r.metode : "–", {align:"center", nowrap:true}), emfStatusCell(r));
      rows.push(row);
    });
  });
  return {columns:[{l:"No",w:4},{l:"Sumber Emisi",w:24},{l:"Parameter (Satuan)",w:16},{l:"Hasil",w:10},{l:"Baku Mutu",w:9},{l:"Metode",w:19},{l:"Keterangan",w:18}], rows};
}
function emfSummaryEmisi(stats, groupLabel, reg){
  if(!stats.total) return "";
  const parts = [];
  parts.push(stats.sampled
    ? `Dari ${stats.total} sumber emisi ${groupLabel}, ${stats.sampled} sumber dipantau${stats.dates.length?` pada tanggal ${emfDateRange(stats.dates)}`:""}.`
    : `Tidak ada sumber emisi ${groupLabel} (${stats.total} unit) yang dipantau pada periode ini.`);
  if(stats.sampled){
    parts.push(stats.exceed.length
      ? `Terdapat ${stats.exceed.length} parameter yang melebihi baku mutu ${reg}: ${stats.exceed.join("; ")}.`
      : `Seluruh parameter wajib yang dipantau memenuhi baku mutu ${reg}.`);
  }
  const cats = Object.keys(stats.cats);
  if(cats.length){
    parts.push((stats.sampled ? "Sumber emisi yang tidak dipantau: " : "Rinciannya: ")+cats.map(c=>`${stats.cats[c]} sumber ${EMF_CAT_LABEL[c]||c}`).join(", ")+".");
  }
  return parts.join(" ");
}
function emfBuildEmisiBlock(site, period, sources){
  const a = sources.filter(p=>["turbin","heater"].includes(emfEmisiGroup(p))).sort(emfSortByName);
  const b = sources.filter(p=>emfEmisiGroup(p)==="genset").sort(emfSortByName);
  if(!a.length && !b.length) return null;
  const tables = [], summaries = [], notes = [];
  if(a.length){
    const st = {total:0, sampled:0, exceed:[], cats:{}, dates:[]};
    const t = emfBuildEmisiTable(a, site, period, st);
    t.subcaption = `a. Hasil pemantauan emisi dari turbin gas, ketel uap dan pemanas proses (boiler and process heater) — ${EMF_REG.turbin}`;
    tables.push(t);
    summaries.push(emfSummaryEmisi(st, "turbin gas/boiler/heater", EMF_REG.turbin));
    notes.push("Turbin gas & heater berkapasitas < 25 MW tidak wajib memantau Total Partikulat; SO₂ digantikan pemantauan kandungan sulfur bahan bakar (Permen LH 13/2009 Pasal 12 ayat (2) huruf b).");
  }
  if(b.length){
    const st = {total:0, sampled:0, exceed:[], cats:{}, dates:[]};
    const t = emfBuildEmisiTable(b, site, period, st);
    t.subcaption = `${a.length?"b":"a"}. Hasil pemantauan emisi dari mesin pembakaran dalam (internal combustion engine) — ${EMF_REG.genset}`;
    tables.push(t);
    summaries.push(emfSummaryEmisi(st, "mesin pembakaran dalam", EMF_REG.genset));
  }
  if(emfState.includeSupport) notes.push("Data pendukung = parameter pengukuran tanpa baku mutu (O₂, CO₂, laju alir, suhu gas) yang menyertai hasil pemantauan.");
  return emfBlock({sheet:"Hasil Emisi", caption:`Hasil Pemantauan Emisi di Lapangan ${site} ${emfPeriodText(period)}`, tables, notes, summary:summaries.filter(Boolean).join(" ")});
}

// --- Flare
function emfBuildFlareBlock(site, period, sources){
  const flares = sources.filter(p=>emfEmisiGroup(p)==="flare").sort(emfSortByName);
  if(!flares.length) return null;
  const rows = [], dates = [], exceed = [];
  let sampled = 0;
  flares.forEach((p,i)=>{
    const rs = emfHasilRows(p, period).filter(r=>r.parameter==="Opasitas" && r.resultStatus!=="declaration");
    const base = [C(i+1, {align:"center"}), C(p.nama, {bold:true}), C(emfCoordText(site, p.nama), {align:"center", nowrap:true})];
    if(!rs.length){
      const decl = emfHasilRows(p, period).some(r=>r.resultStatus==="declaration");
      const why = emfNotSampledReason(p, period, decl);
      rows.push(base.concat([emfNotSampledCell(p, why, 3)]));
      return;
    }
    sampled++;
    const r = rs[0];
    dates.push(r.dateOfSampling);
    if(r.statusBakuMutu==="exceed") exceed.push(`${p.nama} (${emfVal(r.resultRaw)}%)`);
    rows.push(base.concat([C(emfVal(r.resultRaw), {align:"center"}), C(emfVal(r.standard!=null?r.standard:40), {align:"center"}), emfStatusCell(r)]));
  });
  const dt = emfDateRange(dates);
  let summary = "";
  if(sampled) summary = exceed.length
    ? `Opasitas flare ${exceed.join(", ")} melebihi baku mutu 40% (${EMF_REG.flare}).`
    : `Hasil pemantauan opasitas ${sampled} flare di lapangan ${site} pada ${emfPeriodText(period)} memenuhi baku mutu (maks. 40%) sesuai ${EMF_REG.flare}.`;
  return emfBlock({sheet:"Hasil Flare", caption:`Hasil Pemantauan Flare di ${site} ${emfPeriodText(period)}`,
    subcaption:`Parameter: Opasitas (%) · Metode: SNI 19.7117.11-2005${dt?` · Tanggal pengukuran: ${dt}`:""}`,
    tables:[{columns:[{l:"No",w:6},{l:"Nama Flare",w:24},{l:"Koordinat",w:22},{l:"Hasil (%)",w:12},{l:"Baku Mutu (%)",w:14},{l:"Keterangan",w:22}], rows}], summary});
}

// --- Ambient family
function emfAmbRecords(cat, site, period){
  return ((DB.hasilAmbien && DB.hasilAmbien[cat]) || []).filter(r=>r.site===site && r.periode===period);
}
function emfAmbTitikName(r){
  const p = DB.points.find(x=>x.id===r.titikId);
  return p ? p.nama : r.titik;
}
function emfGroupByTitik(records){
  const map = new Map();
  records.forEach(r=>{ if(!map.has(r.titikId)) map.set(r.titikId, []); map.get(r.titikId).push(r); });
  return [...map.values()].sort((a,b)=>emfAmbTitikName(a[0]).localeCompare(emfAmbTitikName(b[0]), "id", {numeric:true}));
}
function emfLocLine(site, name, dates){
  const c = emfCoordOf(site, name);
  const dt = emfDateRange(dates);
  return `Lokasi: ${name}${c?` (${c.ls}, ${c.bt})`:""}${dt?` · Tanggal pengukuran: ${dt}`:""}`;
}
const EMF_WIND = {North:"Utara", South:"Selatan", East:"Timur", West:"Barat", Northeast:"Timur Laut", Northwest:"Barat Laut", Southeast:"Tenggara", Southwest:"Barat Daya",
  "North East":"Timur Laut", "North West":"Barat Laut", "South East":"Tenggara", "South West":"Barat Daya"};
const EMF_WEATHER = {Clear:"Cerah", Cloudy:"Berawan", "Partly Cloudy":"Cerah Berawan", Overcast:"Mendung", Rain:"Hujan", Rainy:"Hujan", Drizzle:"Gerimis"};
function emfWind(s){
  return String(s||"").split(/\s*-\s*/).map(w=>EMF_WIND[w.trim()]||w.trim()).filter(Boolean).join(" – ");
}
function emfWeatherNote(recs){
  const c = (recs.find(r=>r.cuaca)||{}).cuaca;
  if(!c) return "";
  const parts = [];
  if(c.suhu) parts.push(`Suhu ${emfVal(c.suhu)} °C`);
  if(c.kelembapan) parts.push(`Kelembapan ${emfVal(c.kelembapan)} %`);
  if(c.tekanan) parts.push(`Tekanan ${emfVal(c.tekanan)} mmHg`);
  if(c.kecepatanAngin) parts.push(`Kecepatan angin ${emfVal(c.kecepatanAngin)} m/s`);
  if(c.arahAngin) parts.push(`Arah angin ${emfWind(c.arahAngin)}`);
  if(c.cuaca) parts.push(`Cuaca ${EMF_WEATHER[c.cuaca]||c.cuaca}`);
  return parts.length ? "Kondisi meteorologi saat pengukuran: "+parts.join("; ")+"." : "";
}
function emfStatusOf(st){
  if(st==="exceed") return C("Melebihi", {color:"#C00000", bold:true, align:"center"});
  if(st==="ok") return C("Memenuhi", {color:"#1E7B47", align:"center"});
  return C("–", {align:"center"});
}
function emfAmbPointsOf(site, kategori){ return DB.points.filter(p=>p.site===site && p.kategori===kategori); }
function emfEmptyBlock(caption, site, period, what){
  return emfBlock({caption, empty:`Belum ada data hasil ${what} untuk ${site} pada ${emfPeriodText(period)} di Database Hasil Ambient — tabel ini akan otomatis terisi begitu datanya diimpor/diinput.`});
}
function emfBuildAmbienBlocks(site, period){
  const out = [];
  const recs = emfAmbRecords("ambien", site, period);
  const hasPoints = emfAmbPointsOf(site, "ambient").length>0;
  if(!recs.length && !hasPoints) return out;
  if(emfState.includeRef){
    out.push(emfBlock({ref:true, sheet:"BM Udara Ambien", caption:"Baku Mutu dan Frekuensi Pemantauan Udara Ambien",
      subcaption:`${EMF_REG.ambien} · Frekuensi pemantauan 1 x 6 bulan`,
      tables:[{columns:[{l:"Parameter",w:30},{l:"Waktu Pengukuran",w:13},{l:"Satuan",w:11},{l:"Baku Mutu",w:12},{l:"Metode Analisis",w:17},{l:"Peralatan",w:17}],
        rows:EMF_AMB_PARAMS.map(x=>[C(x.label), C(x.durasi, {align:"center"}), C("µg/Nm³", {align:"center"}), C(emfVal(x.baku), {align:"center"}), C(x.metode), C(x.alat)])}]}));
  }
  if(!recs.length){ out.push(emfEmptyBlock("Kualitas Udara Ambien", site, period, "udara ambien")); return out; }
  emfGroupByTitik(recs).forEach(group=>{
    const name = emfAmbTitikName(group[0]);
    const ordered = group.slice().sort((a,b)=>{
      const ia = EMF_AMB_PARAMS.findIndex(x=>x.kode===a.parameterKode), ib = EMF_AMB_PARAMS.findIndex(x=>x.kode===b.parameterKode);
      return (ia<0?99:ia)-(ib<0?99:ib);
    });
    const exceed = [];
    const rows = ordered.map((r,i)=>{
      const ref = EMF_AMB_PARAMS.find(x=>x.kode===r.parameterKode);
      if(r.statusBakuMutu==="exceed") exceed.push(ref?ref.label:r.parameter);
      const dur = ref ? ref.durasi : String(r.durasi||"").replace(/(\d+)\s*Hours?/i, "$1 jam");
      return [C(i+1, {align:"center"}), C(ref?ref.label:r.parameter), C(dur, {align:"center"}), C(emfVal(r.resultRaw), {align:"center"}),
        C(emfVal(r.baku!=null?r.baku:(ref?ref.baku:"")), {align:"center"}), C(r.metode||"–", {align:"center", nowrap:true}), emfStatusOf(r.statusBakuMutu)];
    });
    const summary = exceed.length
      ? `Kualitas udara ambien di ${name} pada ${emfPeriodText(period)} melebihi baku mutu ${EMF_REG.ambien} untuk parameter ${exceed.join(", ")}.`
      : `Kualitas udara ambien di ${name} pada ${emfPeriodText(period)} telah memenuhi baku mutu berdasarkan ${EMF_REG.ambien}.`;
    out.push(emfBlock({sheet:"Ambien "+name, caption:`Kualitas Udara Ambien di ${name}`, subcaption:emfLocLine(site, name, group.map(r=>r.tanggal)),
      tables:[{columns:[{l:"No",w:5},{l:"Parameter",w:28},{l:"Waktu Pengukuran",w:12},{l:"Hasil (µg/Nm³)",w:13},{l:"Baku Mutu (µg/Nm³)",w:13},{l:"Metode",w:17},{l:"Status",w:12}], rows}],
      notes:[emfWeatherNote(group), "Tanda \"<\" = di bawah batas deteksi metode analisis."].filter(Boolean), summary}));
  });
  return out;
}
function emfNoiseHourOrder(h){ const m = /^L\s*(\d+)/i.exec(h.label||""); return m ? Number(m[1]) : 99; }
function emfBuildKebisinganBlocks(site, period){
  const out = [];
  const recs = emfAmbRecords("kebisingan", site, period);
  const hasPoints = emfAmbPointsOf(site, "kebisingan").length>0;
  if(!recs.length && !hasPoints) return out;
  const baku = (recs.find(r=>r.baku!=null)||{}).baku || 70;
  if(emfState.includeRef){
    out.push(emfBlock({ref:true, sheet:"BM Kebisingan", caption:"Baku Mutu dan Frekuensi Pemantauan Kebisingan", subcaption:EMF_REG.kebisingan,
      tables:[{columns:[{l:"Peruntukan Kawasan",w:40},{l:"Tingkat Kebisingan (dB(A))",w:30},{l:"Frekuensi Pemantauan",w:30}],
        rows:[[C("Industri"), C(emfVal(baku), {align:"center"}), C("1 x 6 bulan", {align:"center"})]]}],
      notes:["Faktor toleransi: + 3 dB(A)."]}));
  }
  if(!recs.length){ out.push(emfEmptyBlock("Tingkat Kebisingan", site, period, "kebisingan")); return out; }
  emfGroupByTitik(recs).forEach(group=>{
    const r = group[0];
    const name = emfAmbTitikName(r);
    const b = r.baku!=null ? r.baku : baku;
    const main = [
      [C("L Siang (LS) — 06.00–22.00"), C(emfVal(r.lSiang), {align:"center"}), C("–", {align:"center"}), C(r.metode||"–", {align:"center", rs:3}), C("–", {align:"center"})],
      [C("L Malam (LM) — 22.00–06.00"), C(emfVal(r.lMalam), {align:"center"}), C("–", {align:"center"}), C("–", {align:"center"})],
      [C("L Siang-Malam (LSM)", {bold:true}), C(emfVal(r.lSiangMalam), {align:"center", bold:true}), C(emfVal(b)+" (+3)", {align:"center"}), emfStatusOf(r.statusBakuMutu)]
    ];
    const hours = (r.hourly||[]).slice().sort((x,y)=>emfNoiseHourOrder(x)-emfNoiseHourOrder(y));
    const tables = [{columns:[{l:"Parameter",w:34},{l:"Hasil (dB(A))",w:16},{l:"Baku Mutu (dB(A))",w:16},{l:"Metode",w:18},{l:"Status",w:16}], rows:main}];
    if(hours.length){
      const perCol = Math.ceil(hours.length/4);
      const hrows = [];
      for(let i=0;i<perCol;i++){
        const row = [];
        for(let c=0;c<4;c++){
          const h = hours[c*perCol+i];
          row.push(C(h ? h.label : "", {align:"center"}), C(h ? emfVal(h.nilai) : "", {align:"center"}));
        }
        hrows.push(row);
      }
      const hc = [];
      for(let c=0;c<4;c++) hc.push({l:"Waktu",w:14}, {l:"dB(A)",w:11});
      tables.push({subcaption:"Data pengukuran tingkat kebisingan per jam (Leq 10 menit)", columns:hc, rows:hrows});
    }
    const ok = r.statusBakuMutu!=="exceed";
    out.push(emfBlock({sheet:"Kebisingan "+name, caption:`Tingkat Kebisingan di ${name}`, subcaption:emfLocLine(site, name, [r.tanggal]), tables,
      summary:`Tingkat kebisingan siang-malam (LSM) di ${name} pada ${emfPeriodText(period)} sebesar ${emfVal(r.lSiangMalam)} dB(A), ${ok?"memenuhi":"melebihi"} baku mutu kawasan industri ${emfVal(b)} dB(A) berdasarkan ${EMF_REG.kebisingan}.`}));
  });
  return out;
}
function emfBuildKebauanBlocks(site, period){
  const out = [];
  const recs = emfAmbRecords("kebauan", site, period);
  const hasPoints = emfAmbPointsOf(site, "kebauan").length>0;
  if(!recs.length && !hasPoints) return out;
  if(emfState.includeRef){
    out.push(emfBlock({ref:true, sheet:"BM Kebauan", caption:"Baku Mutu dan Frekuensi Pemantauan Kebauan", subcaption:`${EMF_REG.kebauan} (odoran tunggal) · Frekuensi pemantauan 1 x 6 bulan`,
      tables:[{columns:[{l:"Parameter",w:32},{l:"Satuan",w:10},{l:"Baku Mutu",w:12},{l:"Metode",w:24},{l:"Peralatan",w:22}],
        rows:EMF_ODR_PARAMS.map(x=>[C(x.label), C("ppm", {align:"center"}), C(emfVal(x.baku), {align:"center"}), C(x.metode), C(x.alat)])}]}));
  }
  if(!recs.length){ out.push(emfEmptyBlock("Tingkat Kebauan", site, period, "kebauan")); return out; }
  emfGroupByTitik(recs).forEach(group=>{
    const name = emfAmbTitikName(group[0]);
    const ordered = group.slice().sort((a,b)=>{
      const ia = EMF_ODR_PARAMS.findIndex(x=>x.kode===a.parameterKode), ib = EMF_ODR_PARAMS.findIndex(x=>x.kode===b.parameterKode);
      return (ia<0?99:ia)-(ib<0?99:ib);
    });
    const exceed = [];
    const rows = ordered.map((r,i)=>{
      const ref = EMF_ODR_PARAMS.find(x=>x.kode===r.parameterKode);
      if(r.statusBakuMutu==="exceed") exceed.push(ref?ref.label:r.parameter);
      return [C(i+1, {align:"center"}), C(ref?ref.label:r.parameter), C(emfVal(r.resultRaw), {align:"center"}),
        C(emfVal(r.baku!=null?r.baku:(ref?ref.baku:"")), {align:"center"}), C(r.metode||"–", {align:"center", nowrap:true}), emfStatusOf(r.statusBakuMutu)];
    });
    out.push(emfBlock({sheet:"Kebauan "+name, caption:`Tingkat Kebauan pada ${name}`, subcaption:emfLocLine(site, name, group.map(r=>r.tanggal)),
      tables:[{columns:[{l:"No",w:6},{l:"Parameter",w:32},{l:"Hasil (ppm)",w:14},{l:"Baku Mutu (ppm)",w:14},{l:"Metode",w:20},{l:"Status",w:14}], rows}],
      notes:["Tanda \"<\" = di bawah batas deteksi metode analisis."],
      summary: exceed.length
        ? `Tingkat kebauan pada ${name} pada ${emfPeriodText(period)} melebihi baku mutu ${EMF_REG.kebauan} untuk parameter ${exceed.join(", ")}.`
        : `Tingkat kebauan pada ${name} pada ${emfPeriodText(period)} telah memenuhi baku mutu berdasarkan ${EMF_REG.kebauan}.`}));
  });
  return out;
}
function emfBuildGetaranBlocks(site, period){
  const out = [];
  const recs = emfAmbRecords("getaran", site, period);
  const hasPoints = emfAmbPointsOf(site, "getaran").length>0;
  if(!recs.length && !hasPoints) return out;
  if(emfState.includeRef){
    out.push(emfBlock({ref:true, sheet:"BM Getaran", caption:"Baku Mutu Pemantauan Getaran",
      subcaption:`${EMF_REG.getaran} Lampiran I — Baku Tingkat Getaran untuk Kenyamanan dan Kesehatan (nilai simpangan, mikron / 10⁻⁶ m)`,
      tables:[{columns:[{l:"Frekuensi (Hz)",w:16},{l:"Tidak Mengganggu",w:21},{l:"Mengganggu",w:21},{l:"Tidak Nyaman",w:21},{l:"Menyakitkan",w:21}],
        rows:EMF_VIB_BM.map(x=>x.map((v,i)=>C(emfVal(v), {align:"center"})))}]}));
  }
  if(!recs.length){ out.push(emfEmptyBlock("Tingkat Nilai Getaran", site, period, "getaran")); return out; }
  emfGroupByTitik(recs).forEach(group=>{
    const r = group[0];
    const name = emfAmbTitikName(r);
    const bands = (r.bands||[]).slice().sort((a,b)=>Number(a.freq)-Number(b.freq));
    const worse = bands.filter(b=>b.status && b.status!=="Not Disturb");
    const rows = bands.map((b,i)=>[C(i+1, {align:"center"}), C(emfVal(b.freq), {align:"center"}), C(emfVal(b.nilai), {align:"center"}),
      C(emfVal(b.notDisturb||""), {align:"center"}),
      C(EMF_VIB_STATUS[b.status]||b.status||"–", {align:"center", color: b.status==="Not Disturb" ? "#1E7B47" : "#C00000", bold: b.status!=="Not Disturb"})]);
    out.push(emfBlock({sheet:"Getaran "+name, caption:`Tingkat Nilai Getaran di ${name} pada ${emfPeriodText(period)}`, subcaption:emfLocLine(site, name, [r.tanggal]),
      tables:[{columns:[{l:"No",w:8},{l:"Frekuensi (Hz)",w:18},{l:"Hasil ("+emfUnit(r.unit||"micron")+")",w:20},{l:"Batas Tidak Mengganggu ("+emfUnit(r.unit||"micron")+")",w:28},{l:"Kategori",w:26}], rows}],
      notes:[r.metode ? `Metode: ${r.metode}.` : ""].filter(Boolean),
      summary: worse.length
        ? `Tingkat getaran di ${name} pada ${emfPeriodText(period)} berada di atas kategori tidak mengganggu pada frekuensi ${worse.map(b=>emfVal(b.freq)+" Hz").join(", ")} (${EMF_REG.getaran}).`
        : `Tingkat nilai getaran di ${name} pada ${emfPeriodText(period)} telah memenuhi baku mutu dengan kategori tidak mengganggu pada seluruh frekuensi (${emfVal(bands[0]?bands[0].freq:"")}–${emfVal(bands.length?bands[bands.length-1].freq:"")} Hz) berdasarkan ${EMF_REG.getaran}.`}));
  });
  return out;
}

// Susun seluruh blok laporan utk 1 site & periode, urutan mengikuti laporan EMF yang sudah berjalan.
// Bagian Udara Emisi cuma dicantumkan kalau site ini memang punya kewajiban/hasil emisi pada
// periode tsb — site yang sumber emisinya seluruhnya genset emergency tidak wajib (mis. BPN, yang
// laporan EMF-nya cuma ambien/kebisingan/kebauan/getaran) tidak perlu bagian emisi sama sekali.
function emfSiteHasEmisiDuty(sources, period){
  return sources.some(p=>p._orphan || DB.hasilPemantauan.some(r=>r.engineId===p.id && r.periode===period) || (!p.tidakBeroperasi && effectiveWajib(p, period)));
}
function emfBuildReport(site, period){
  emfLastBlocks = [];
  const sections = [];
  const sources = emfEmisiSources(site, period);
  if(sources.length && emfSiteHasEmisiDuty(sources, period)){
    const blocks = [];
    if(emfState.includeRef) blocks.push(...emfBuildBmBlocks(site, sources));
    const sulfur = emfBuildSulfurBlock(site, period, sources); if(sulfur) blocks.push(sulfur);
    if(emfState.includeRef){ const list = emfBuildListBlock(site, period, sources); if(list) blocks.push(list); }
    const emisi = emfBuildEmisiBlock(site, period, sources); if(emisi) blocks.push(emisi);
    const flare = emfBuildFlareBlock(site, period, sources); if(flare) blocks.push(flare);
    if(blocks.length) sections.push({title:"Udara Emisi", blocks});
  }
  [["Udara Ambien", emfBuildAmbienBlocks], ["Kebisingan", emfBuildKebisinganBlocks], ["Kebauan", emfBuildKebauanBlocks], ["Getaran", emfBuildGetaranBlocks]]
    .forEach(([title, fn])=>{ const blocks = fn(site, period); if(blocks.length) sections.push({title, blocks}); });
  // Penomoran tabel berurutan mulai dari "No. Tabel Awal" — blok kosong (belum ada data) tidak ikut
  // dinomori supaya urutan nomor di Word tetap rapat tanpa lompatan.
  let n = Math.max(1, Number(emfState.startNo)||1);
  sections.forEach(s=>s.blocks.forEach(b=>{ if(!b.empty){ b.num = n++; } emfLastBlocks.push(b); }));
  return sections;
}

/* ---------- Render: HTML (layar & Word) ---------- */
const EMF_CSS = {
  table:"border-collapse:collapse;width:100%;font-family:Arial,Helvetica,sans-serif;font-size:9pt;color:#000;margin:0 0 4pt 0;",
  th:"border:1px solid #000;background:#D9E2F3;color:#000;font-weight:bold;padding:3pt 4pt;text-align:center;vertical-align:middle;white-space:normal;position:static;",
  td:"border:1px solid #000;padding:2pt 4pt;vertical-align:middle;color:#000;",
  cap:"font-family:Arial,Helvetica,sans-serif;font-size:10pt;font-weight:bold;color:#000;margin:12pt 0 2pt 0;text-align:center;",
  sub:"font-family:Arial,Helvetica,sans-serif;font-size:9pt;color:#000;margin:0 0 4pt 0;text-align:center;",
  tsub:"font-family:Arial,Helvetica,sans-serif;font-size:9pt;font-weight:bold;color:#000;margin:6pt 0 3pt 0;",
  note:"font-family:Arial,Helvetica,sans-serif;font-size:8pt;font-style:italic;color:#000;margin:0 0 1pt 0;",
  sum:"font-family:Arial,Helvetica,sans-serif;font-size:10pt;color:#000;margin:4pt 0 0 0;text-align:justify;"
};
function emfCellHtml(cell, isHead, width){
  let style = isHead ? EMF_CSS.th : EMF_CSS.td;
  if(width) style += `width:${width}%;`;
  if(!isHead){
    style += `text-align:${cell.align||"left"};`;
    if(cell.bold) style += "font-weight:bold;";
    if(cell.italic) style += "font-style:italic;";
    if(cell.color) style += `color:${cell.color};`;
    if(cell.nowrap) style += "white-space:nowrap;";
  }
  const attrs = (cell.rs>1?` rowspan="${cell.rs}"`:"")+(cell.cs>1?` colspan="${cell.cs}"`:"")+(cell.nowrap&&!isHead?" nowrap":"");
  const tag = isHead ? "th" : "td";
  const lines = String(cell.v).split("\n").map(escHtml);
  const body = cell.firstBold && lines.length ? `<b>${lines[0]}</b>${lines.length>1?"<br>"+lines.slice(1).join("<br>"):""}` : lines.join("<br>");
  return `<${tag}${attrs} style="${style}">${body}</${tag}>`;
}
function emfTableHtml(t){
  const head = `<tr>${t.columns.map(c=>emfCellHtml({v:c.l}, true, c.w)).join("")}</tr>`;
  const body = t.rows.map(r=>`<tr>${r.map(c=>emfCellHtml(c, false)).join("")}</tr>`).join("");
  return (t.subcaption?`<p style="${EMF_CSS.tsub}">${escHtml(t.subcaption)}</p>`:"")+
    `<table style="${EMF_CSS.table}" border="1" cellspacing="0" cellpadding="0"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}
function emfBlockHtml(b){
  if(b.empty) return "";
  return `<p style="${EMF_CSS.cap}">Tabel ${b.num} ${escHtml(b.caption)}</p>`+
    (b.subcaption?`<p style="${EMF_CSS.sub}">${escHtml(b.subcaption)}</p>`:"")+
    b.tables.map(emfTableHtml).join("")+
    b.notes.map(n=>`<p style="${EMF_CSS.note}">${escHtml(n)}</p>`).join("")+
    (b.summary?`<p style="${EMF_CSS.sum}">${escHtml(b.summary)}</p>`:"");
}
function emfBlockText(b){
  const lines = [`Tabel ${b.num} ${b.caption}`];
  if(b.subcaption) lines.push(b.subcaption);
  b.tables.forEach(t=>{
    if(t.subcaption) lines.push(t.subcaption);
    const g = emfGrid(t);
    lines.push(t.columns.map(c=>c.l).join("\t"));
    g.grid.forEach(r=>lines.push(r.map(v=>String(v).replace(/\n/g," ")).join("\t")));
  });
  b.notes.forEach(n=>lines.push(n));
  if(b.summary) lines.push(b.summary);
  return lines.join("\n");
}

/* ---------- Render: Excel ---------- */
// Tempatkan sel (dgn rowspan/colspan) ke grid 2D + daftar merge — dipakai Excel & teks polos.
function emfGrid(t){
  const ncols = t.columns.length, grid = [], occ = [], merges = [];
  const ensure = r=>{ if(!grid[r]){ grid[r] = new Array(ncols).fill(""); occ[r] = new Array(ncols).fill(false); } };
  t.rows.forEach((row, ri)=>{
    ensure(ri);
    let c = 0;
    row.forEach(cell=>{
      while(c<ncols && occ[ri][c]) c++;
      const rs = cell.rs||1, cs = cell.cs||1;
      for(let dr=0; dr<rs; dr++){ ensure(ri+dr); for(let dc=0; dc<cs; dc++) if(c+dc<ncols) occ[ri+dr][c+dc] = true; }
      if(c<ncols) grid[ri][c] = cell.v;
      if(rs>1 || cs>1) merges.push({r:ri, c, rs, cs});
      c += cs;
    });
  });
  return {grid, merges};
}
function emfSheetName(base, used){
  // Excel membatasi nama sheet 31 karakter — keterangan dlm kurung (mis. "(SPU Camp)") dibuang dulu,
  // lalu dipotong di batas kata supaya tidak berakhir tanggung spt "Akomodasi SPU (SP".
  let name = String(base).replace(/\s*\([^)]*\)/g,"").replace(/[\[\]:*?\/\\]/g,"-").trim();
  if(name.length>28) name = name.slice(0,28).replace(/\s+\S*$/,"").trim();
  name = name || "Tabel";
  let candidate = name, i = 2;
  while(used.has(candidate.toLowerCase())){ candidate = `${name.slice(0,26)}-${i++}`; }
  used.add(candidate.toLowerCase());
  return candidate;
}
function emfBlockSheet(b){
  const width = Math.max(...b.tables.map(t=>t.columns.length), 1);
  const aoa = [], merges = [];
  const pushFull = text=>{ const r = aoa.length; aoa.push([text]); if(width>1) merges.push({s:{r, c:0}, e:{r, c:width-1}}); };
  pushFull(`Tabel ${b.num} ${b.caption}`);
  if(b.subcaption) pushFull(b.subcaption);
  b.tables.forEach(t=>{
    aoa.push([]);
    if(t.subcaption) pushFull(t.subcaption);
    aoa.push(t.columns.map(c=>c.l));
    const g = emfGrid(t), base = aoa.length;
    g.grid.forEach(r=>aoa.push(r.slice()));
    g.merges.forEach(m=>merges.push({s:{r:base+m.r, c:m.c}, e:{r:base+m.r+m.rs-1, c:m.c+m.cs-1}}));
  });
  if(b.notes.length || b.summary) aoa.push([]);
  b.notes.forEach(n=>pushFull(n));
  if(b.summary) pushFull(b.summary);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!merges"] = merges;
  const widest = b.tables.reduce((best,t)=>t.columns.length===width ? t : best, b.tables[0]);
  ws["!cols"] = (widest ? widest.columns : [{w:100}]).map(c=>({wch: Math.max(8, Math.round((c.w||10)*1.1))}));
  return ws;
}

/* ---------- Halaman ---------- */
function emfAvailablePeriods(site){
  const set = new Set();
  DB.hasilPemantauan.forEach(r=>{ if(!site || r.site===site) set.add(r.periode); });
  Object.values(DB.hasilAmbien||{}).forEach(list=>(list||[]).forEach(r=>{ if(!site || r.site===site) set.add(r.periode); }));
  set.add(currentPeriodStr());
  return [...set].filter(p=>parsePeriodStr(p)).sort((a,b)=>periodCompare(parsePeriodStr(b), parsePeriodStr(a)));
}
function emfLatestPeriodWithData(site){
  const hasData = p=> DB.hasilPemantauan.some(r=>r.site===site && r.periode===p) ||
    Object.values(DB.hasilAmbien||{}).some(list=>(list||[]).some(r=>r.site===site && r.periode===p));
  return emfAvailablePeriods(site).find(hasData) || currentPeriodStr();
}
function emfSites(){
  const present = new Set(DB.points.map(p=>p.site));
  return MASTER_SITE_ORDER.filter(s=>present.has(s)).concat([...present].filter(s=>!MASTER_SITE_ORDER.includes(s)).sort());
}
function emfCoverageHtml(site, period, sections){
  const items = [];
  const allSources = emfEmisiSources(site, period);
  const sources = allSources.filter(p=>emfEmisiGroup(p)!=="sulfur");
  if(sources.length && !emfSiteHasEmisiDuty(allSources, period)){
    items.push({ok:true, text:`Emisi: ${sources.length} sumber, tidak ada yang wajib pantau/ada hasil — bagian emisi tidak dicantumkan`});
  } else if(sources.length){
    const sampled = sources.filter(p=>emfHasilRows(p, period).some(r=>r.resultStatus!=="declaration")).length;
    items.push({ok:true, text:`Emisi: ${sampled} dari ${sources.length} sumber dipantau`});
    const missing = sources.filter(p=>!emfHasilRows(p, period).some(r=>r.resultStatus!=="declaration") && emfNotSampledReason(p, period, emfHasilRows(p, period).length>0).warn);
    if(missing.length) items.push({ok:false, text:`${missing.length} sumber wajib pantau belum ada data hasil: ${missing.map(p=>p.nama).join(", ")}`});
  }
  [["ambien","ambient","Udara ambien"],["kebisingan","kebisingan","Kebisingan"],["kebauan","kebauan","Kebauan"],["getaran","getaran","Getaran"]].forEach(([cat, kat, label])=>{
    const recs = emfAmbRecords(cat, site, period);
    const pts = emfAmbPointsOf(site, kat);
    if(!recs.length && !pts.length) return;
    const titik = new Set(recs.map(r=>r.titikId)).size;
    items.push(recs.length ? {ok:true, text:`${label}: ${titik} titik`} : {ok:false, text:`${label}: belum ada data`});
  });
  const tableCount = emfLastBlocks.filter(b=>!b.empty).length;
  if(!items.length) return `<div class="emf-empty">Site ${escHtml(site)} belum punya titik pantau maupun data hasil pada ${escHtml(emfPeriodText(period))}.</div>`;
  return `<div class="emf-coverage">
    <span class="emf-cov-title">${tableCount} tabel siap disalin</span>
    ${items.map(it=>`<span class="emf-cov-item ${it.ok?"ok":"warn"}">${escHtml(it.text)}</span>`).join("")}
  </div>`;
}
function emfReadControls(){
  const g = id=>document.getElementById(id);
  emfState.site = g("emfSite").value;
  emfState.period = g("emfPeriod").value;
  emfState.startNo = Number(g("emfStartNo").value)||1;
  emfState.includeRef = g("emfIncludeRef").checked;
  emfState.includeSupport = g("emfIncludeSupport").checked;
  emfState.idNumber = g("emfIdNumber").checked;
}
function renderLaporanEmf(){
  const siteSel = document.getElementById("emfSite"), perSel = document.getElementById("emfPeriod");
  if(!siteSel) return;
  const sites = emfSites();
  if(!emfState.site || !sites.includes(emfState.site)) emfState.site = sites[0] || "";
  siteSel.innerHTML = sites.map(s=>`<option value="${escHtml(s)}">${escHtml(s)}</option>`).join("");
  siteSel.value = emfState.site;
  const periods = emfAvailablePeriods(emfState.site);
  if(!emfState.period || !periods.includes(emfState.period)) emfState.period = emfLatestPeriodWithData(emfState.site);
  perSel.innerHTML = periods.map(p=>`<option value="${escHtml(p)}">${escHtml(emfPeriodText(p))}</option>`).join("");
  perSel.value = emfState.period;
  document.getElementById("emfStartNo").value = emfState.startNo;
  document.getElementById("emfIncludeRef").checked = emfState.includeRef;
  document.getElementById("emfIncludeSupport").checked = emfState.includeSupport;
  document.getElementById("emfIdNumber").checked = emfState.idNumber;

  const site = emfState.site, period = emfState.period;
  const sections = site ? emfBuildReport(site, period) : [];
  document.getElementById("emfCoverage").innerHTML = site ? emfCoverageHtml(site, period, sections) : "";
  document.getElementById("emfReport").innerHTML = sections.length ? `<div class="emf-paper">
    <div class="emf-paper-head">Laporan Pemantauan Lingkungan (EMF) — Lapangan ${escHtml(site)} · ${escHtml(emfPeriodText(period))}</div>
    ${sections.map(s=>`<div class="emf-section-title">${escHtml(s.title)}</div>`+s.blocks.map(b=>b.empty
      ? `<div class="emf-empty">${escHtml(b.caption)} — ${escHtml(b.empty)}</div>`
      : `<div class="emf-block${b.ref?" emf-ref":""}">
          <div class="emf-block-tools">${b.ref?`<span class="emf-ref-tag">Referensi</span>`:""}<button type="button" class="btn small" data-action="emfCopyBlock" data-block="${b.id}">Salin ke Word</button></div>
          ${emfBlockHtml(b)}
        </div>`).join("")).join("")}
  </div>` : "";
}
document.addEventListener("change", e=>{
  if(["emfSite","emfPeriod","emfStartNo","emfIncludeRef","emfIncludeSupport","emfIdNumber"].includes(e.target.id)){
    const siteChanged = e.target.id==="emfSite";
    emfReadControls();
    if(siteChanged) emfState.period = "";
    renderLaporanEmf();
  }
});

/* ---------- Aksi: salin / unduh ---------- */
async function emfCopyHtml(html, text){
  try{
    if(navigator.clipboard && window.ClipboardItem && window.isSecureContext){
      await navigator.clipboard.write([new ClipboardItem({
        "text/html": new Blob([html], {type:"text/html"}),
        "text/plain": new Blob([text], {type:"text/plain"})
      })]);
      return true;
    }
  }catch(err){ /* lanjut ke cara lama di bawah */ }
  const holder = document.createElement("div");
  holder.contentEditable = "true";
  holder.style.cssText = "position:fixed;left:-10000px;top:0;width:800px;background:#fff;";
  holder.innerHTML = html;
  document.body.appendChild(holder);
  const range = document.createRange();
  range.selectNodeContents(holder);
  const sel = window.getSelection();
  sel.removeAllRanges(); sel.addRange(range);
  let ok = false;
  try{ ok = document.execCommand("copy"); }catch(err){ ok = false; }
  sel.removeAllRanges();
  holder.remove();
  return ok;
}
function emfExportableBlocks(){ return emfLastBlocks.filter(b=>!b.empty); }
async function emfCopyBlock(t){
  const b = emfLastBlocks.find(x=>x.id===t.dataset.block);
  if(!b) return;
  const ok = await emfCopyHtml(emfBlockHtml(b), emfBlockText(b));
  toast(ok ? `Tabel ${b.num} disalin — tinggal Paste (Ctrl+V) di Word.` : "Gagal menyalin otomatis — blok tabelnya lalu Ctrl+C manual.", ok?"ok":"err");
}
async function emfCopyAll(){
  const blocks = emfExportableBlocks();
  if(!blocks.length){ toast("Belum ada tabel untuk disalin.","err"); return; }
  const html = blocks.map(emfBlockHtml).join(`<p style="margin:0;">&nbsp;</p>`);
  const ok = await emfCopyHtml(html, blocks.map(emfBlockText).join("\n\n"));
  toast(ok ? `${blocks.length} tabel disalin — Paste (Ctrl+V) di Word.` : "Gagal menyalin otomatis — gunakan Download Word (.doc).", ok?"ok":"err");
}
function emfFileBase(){ return `EMF_${emfState.site}_${String(emfState.period).replace(/\s+/g,"_")}`; }
function emfDownloadDoc(){
  const blocks = emfExportableBlocks();
  if(!blocks.length){ toast("Belum ada tabel untuk diunduh.","err"); return; }
  const title = `Tabel Laporan EMF ${emfState.site} ${emfPeriodText(emfState.period)}`;
  const doc = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>${escHtml(title)}</title>
<style>@page Section1{size:21cm 29.7cm;margin:2cm 2cm 2cm 2cm;} div.Section1{page:Section1;} body{font-family:Arial,Helvetica,sans-serif;font-size:10pt;} table{page-break-inside:auto;} tr{page-break-inside:avoid;} thead{display:table-header-group;}</style>
</head><body><div class="Section1">${blocks.map(emfBlockHtml).join(`<p style="margin:0;">&nbsp;</p>`)}</div></body></html>`;
  downloadBlob("﻿"+doc, emfFileBase()+".doc", "application/msword");
  toast(`${blocks.length} tabel diunduh sebagai ${emfFileBase()}.doc — buka di Word, lalu salin ke laporan.`,"ok");
}
function emfExportXlsx(){
  const blocks = emfExportableBlocks();
  if(!blocks.length){ toast("Belum ada tabel untuk diekspor.","err"); return; }
  const used = new Set();
  const wb = xlsxWorkbookFromSheets(blocks.map(b=>[emfSheetName(`T${b.num} ${b.sheet||b.caption}`, used), emfBlockSheet(b)]));
  xlsxDownload(wb, emfFileBase()+".xlsx");
  toast(`${blocks.length} tabel diekspor ke ${emfFileBase()}.xlsx (1 sheet per tabel).`,"ok");
}

Object.assign(ACTIONS, {emfCopyBlock, emfCopyAll, emfDownloadDoc, emfExportXlsx});
