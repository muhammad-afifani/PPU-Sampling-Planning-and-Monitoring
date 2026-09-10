/* =========================================================
   HASIL PEMANTAUAN AMBIENT — parsing helper (dipakai import Excel)
   4 kategori (ambien udara, kebisingan, kebauan, getaran), tiap kategori bentuk datanya beda
   (lihat DB.hasilAmbien.{ambien,kebisingan,kebauan,getaran}) — karena itu tidak digabung jadi
   satu tabel datar spt DB.hasilPemantauan (emisi), supaya kolom yang cuma relevan utk 1-2
   kategori saja tidak ikut kosong di kategori lain.
========================================================= */
const AMB_KATEGORI_LABEL = {ambien:"Udara Ambien", kebisingan:"Kebisingan", kebauan:"Kebauan (Bau)", getaran:"Getaran"};
const AMB_KATEGORI_ORDER = ["ambien","kebisingan","kebauan","getaran"];
// Kunci DB.hasilAmbien ("ambien") beda dgn nilai DB.points.kategori utk keluarga yg sama ("ambient",
// warisan dari AMBIENT_FAMILY di 05-master-data.js) — 3 kategori lain kebetulan sama persis, cuma
// "ambien" yg perlu dipetakan, tapi tetap dipetakan semua di sini spy tidak ada asumsi tersembunyi.
const AMB_CAT_POINTS_KATEGORI = {ambien:"ambient", kebisingan:"kebisingan", kebauan:"kebauan", getaran:"getaran"};
const AMBIEN_PARAM_MAP = {
  "Sulfur Dioxide (SO2)":"SO2", "Carbon Monoxide (CO)":"CO", "Nitrogen Dioxide (NOx)":"NOx",
  "Oxidant (O3)":"O3", "Non Methane Hydrocarbon (NMHC)":"NMHC", "TSP (Dust)":"TSP",
  "PM10":"PM10", "PM2.5":"PM2.5", "Lead (Pb)":"Pb"
};
const KEBAUAN_PARAM_MAP = {
  "Ammonia (NH3)":"NH3", "Hydrogen Sulfide (H2S)":"H2S", "Styrene":"Styrene",
  "Methyl Mercaptant":"Methyl Mercaptan", "Methyl Sulfide":"Methyl Sulfide"
};
const GETARAN_RANK = {"Not Disturb":0, "Disturb":1, "Uncomfortable":2, "Painful":3};
const GETARAN_STATUS_BADGE = {
  "Not Disturb":["b-green","Not Disturb"], "Disturb":["b-amber","Disturb"],
  "Uncomfortable":["b-red","Uncomfortable"], "Painful":["b-red","Painful"]
};
// Ambang kenyamanan ISO 2631-2:2003 per pita frekuensi — tabel BAKU (bukan data per titik/periode,
// sama utk semua pengukuran), diverifikasi cocok 100% (468/468 baris) dgn data riil yg diupload
// user. A/B/C = batas atas Not Disturb/Disturb/Uncomfortable (angka, utk hitung status otomatis
// dari nilai yg diisi manual); notDisturb/disturb/uncomfortable/painful = teks aslinya (utk tabel).
const GETARAN_FREQ_BANDS = [4,5,6.3,8,10,12.5,16,20,25,31.5,40,50,63];
const GETARAN_THRESHOLDS = {
  4:{notDisturb:"<100",disturb:"100–500",uncomfortable:">500–1000",painful:">1000",A:100,B:500,C:1000},
  5:{notDisturb:"<80",disturb:"80–350",uncomfortable:">350–1000",painful:">1000",A:80,B:350,C:1000},
  6.3:{notDisturb:"<70",disturb:"70–275",uncomfortable:">275–1000",painful:">1000",A:70,B:275,C:1000},
  8:{notDisturb:"<50",disturb:"50–160",uncomfortable:">160–500",painful:">500",A:50,B:160,C:500},
  10:{notDisturb:"<37",disturb:"37–120",uncomfortable:">120–300",painful:">300",A:37,B:120,C:300},
  12.5:{notDisturb:"<32",disturb:"32–90",uncomfortable:">90–220",painful:">220",A:32,B:90,C:220},
  16:{notDisturb:"<25",disturb:"25–60",uncomfortable:">60–120",painful:">120",A:25,B:60,C:120},
  20:{notDisturb:"<20",disturb:"20–40",uncomfortable:">40–85",painful:">85",A:20,B:40,C:85},
  25:{notDisturb:"<17",disturb:"17–30",uncomfortable:">30–50",painful:">50",A:17,B:30,C:50},
  31.5:{notDisturb:"<12",disturb:"12–20",uncomfortable:">20–30",painful:">30",A:12,B:20,C:30},
  40:{notDisturb:"<9",disturb:"9–15",uncomfortable:">15–20",painful:">20",A:9,B:15,C:20},
  50:{notDisturb:"<8",disturb:"8–12",uncomfortable:">12–15",painful:">15",A:8,B:12,C:15},
  63:{notDisturb:"<6",disturb:"6–9",uncomfortable:">9–12",painful:">12",A:6,B:9,C:12}
};
function getaranStatusFor(freq, nilai){
  const t = GETARAN_THRESHOLDS[freq];
  if(!t || nilai==null || isNaN(nilai)) return "";
  if(nilai < t.A) return "Not Disturb";
  if(nilai <= t.B) return "Disturb";
  if(nilai <= t.C) return "Uncomfortable";
  return "Painful";
}
// Label 24 jam pembacaan Kebisingan (L1=06.00 s.d. L24=05.00 keesokan harinya), sesuai pola data riil.
const KEBISINGAN_JAM_LABELS = ["06.00","07.00","08.00","09.00","10.00","11.00","12.00","13.00","14.00","15.00","16.00","17.00","18.00","19.00","20.00","21.00","22.00","23.00","00.00","01.00","02.00","03.00","04.00","05.00"];
function ambEngineLookup(kategori){
  const map = {};
  DB.points.forEach(p=>{ if(p.kategori===kategori) map[p.nama.trim()] = p; });
  return map;
}
// BKP di sheet Excel sumber = BEKAPAI di Database Titik Pantau — sama seperti HASIL_SITE_MAP yang
// sudah dipakai utk Hasil Pemantauan Emisi (13-hasil-db.js), dipakai ulang di sini apa adanya.
function ambSite(raw){ const s=(raw||"").trim(); return HASIL_SITE_MAP[s] || s; }
function ambSiteRaw(site){ return site==="BEKAPAI" ? "BKP" : site; }
function ambResult(raw){ return hasilParseResult(raw==null ? "" : String(raw)); }
function ambStatusVsBaku(resultNumeric, resultStatus, baku){
  if(resultNumeric==null || (resultStatus!=="measured" && resultStatus!=="below_detection")) return "not_evaluated";
  if(baku==null) return "not_applicable";
  return resultNumeric > baku ? "exceed" : "ok";
}
function ambPctOf(resultNumeric, baku){ return (resultNumeric!=null && baku) ? Math.round((resultNumeric/baku*100)*10)/10 : null; }
function ambBakuFromCell(v){ return (v!=="" && v!=null && !isNaN(Number(v))) ? Number(v) : null; }

/* ---------- AMBIEN & KEBAUAN (bentuk sama: 1 baris sheet = 1 record) ---------- */
function ambBuildAmbienRecords(wb){
  const ws = wb.Sheets["AMBIEN"]; if(!ws) return [];
  const lookup = ambEngineLookup("ambient");
  return xlsxSheetToRows(ws).map(r=>{
    const nama = (r["SAMPLE IDENTIFICATION"]||"").trim();
    const periode = (r["SEMESTER"]||"").trim();
    const {sem, tahun, order} = hasilPeriodParts(periode);
    if(!nama || order==null) return null;
    const res = ambResult(r["TEST RESULT"]);
    if(res.status==="not_sampled") return null;
    const eng = lookup[nama];
    const paramRaw = (r["PARAMETER"]||"").trim();
    const baku = ambBakuFromCell(r["REQUIREMENT"]);
    return {
      id:"AMBRES_"+uid("x"), titikId: eng?eng.id:null, titik:nama, site: ambSite(r["SITE"]),
      tanggal: xlsxDateToIso(r["DATE OF SAMPLING"]), periode, semester:sem, tahun, periodeOrder:order,
      parameter: paramRaw, parameterKode: AMBIEN_PARAM_MAP[paramRaw] || paramRaw,
      durasi: (r["PERIODE"]||"").trim(), unit:"µg/Nm³",
      resultRaw: res.raw, resultNumeric: res.numeric, resultStatus: res.status,
      baku, statusBakuMutu: ambStatusVsBaku(res.numeric, res.status, baku), pctOfBaku: ambPctOf(res.numeric, baku),
      metode: (r["METHOD"]||"").trim(),
      cuaca: {
        suhu:(r["TEMPERATUR(°C)"]||"").trim(), kelembapan:(r["HUMIDITY(%)"]||"").trim(), tekanan:(r["PRESSURE(mmHg)"]||"").trim(),
        kecepatanAngin:(r["WINDSPEED(m/s)"]||"").trim(), arahAngin:(r["WIND DIRECTION"]||"").trim(), cuaca:(r["WEATHER"]||"").trim()
      }
    };
  }).filter(Boolean);
}
function ambBuildKebauanRecords(wb){
  const ws = wb.Sheets["KEBAUAN (ODOR)"]; if(!ws) return [];
  const lookup = ambEngineLookup("kebauan");
  return xlsxSheetToRows(ws).map(r=>{
    const nama = (r["SAMPLE IDENTIFICATION"]||"").trim();
    const periode = (r["SEMESTER"]||"").trim();
    const {sem, tahun, order} = hasilPeriodParts(periode);
    if(!nama || order==null) return null;
    const res = ambResult(r["TEST RESULT"]);
    if(res.status==="not_sampled") return null;
    const eng = lookup[nama];
    const paramRaw = (r["PARAMETER"]||"").trim();
    const baku = ambBakuFromCell(r["REQUIREMENT"]);
    return {
      id:"ODRRES_"+uid("x"), titikId: eng?eng.id:null, titik:nama, site: ambSite(r["SITE"]),
      tanggal: xlsxDateToIso(r["DATE OF MEASUREMENT"]), periode, semester:sem, tahun, periodeOrder:order,
      parameter: paramRaw, parameterKode: KEBAUAN_PARAM_MAP[paramRaw] || paramRaw,
      unit: (r["UNIT"]||"").trim(),
      resultRaw: res.raw, resultNumeric: res.numeric, resultStatus: res.status,
      baku, statusBakuMutu: ambStatusVsBaku(res.numeric, res.status, baku), pctOfBaku: ambPctOf(res.numeric, baku),
      metode: (r["METHOD"]||"").trim()
    };
  }).filter(Boolean);
}

/* ---------- KEBISINGAN (27 baris/grup: L1-L24 + L Day + L Night + L Day Night) ---------- */
function ambBuildKebisinganRecords(wb){
  const ws = wb.Sheets["KEBISINGAN (NOISE)"]; if(!ws) return [];
  const lookup = ambEngineLookup("kebisingan");
  const rows = xlsxSheetToRows(ws);
  const groups = new Map();
  rows.forEach(r=>{
    const nama = (r["SAMPLE IDENTIFICATION"]||"").trim();
    const tgl = xlsxDateToIso(r["DATE OF MEASURMENT"]);
    const periode = (r["SEMESTER"]||"").trim();
    if(!nama || !periode) return;
    const key = nama+"|"+tgl+"|"+periode;
    if(!groups.has(key)) groups.set(key, {nama, tgl, periode, site:r["SITE"], rows:[]});
    groups.get(key).rows.push(r);
  });
  return [...groups.values()].map(g=>{
    const {sem, tahun, order} = hasilPeriodParts(g.periode);
    if(order==null) return null;
    const eng = lookup[g.nama];
    const hourly = []; let lSiang=null, lMalam=null, lSiangMalam=null, baku=null, metode="";
    g.rows.forEach(r=>{
      const label = (r["TIME OF MEASURMENT"]||"").trim();
      const val = Number(r["TEST RESULT"]);
      metode = metode || (r["METHOD"]||"").trim();
      const mHour = label.match(/^L(\d+)\s*\(([\d.]+)\)/);
      if(mHour){ hourly.push({label, jam:mHour[2], nilai:val}); return; }
      if(label.startsWith("L Day (")) lSiang = val;
      else if(label.startsWith("L Night")) lMalam = val;
      else if(label.startsWith("L Day Night")){ lSiangMalam = val; baku = ambBakuFromCell(r["REQUIREMENT"]); }
    });
    hourly.sort((a,b)=> Number(a.label.match(/^L(\d+)/)[1]) - Number(b.label.match(/^L(\d+)/)[1]));
    if(!hourly.length && lSiangMalam==null) return null;
    return {
      id:"NOIRES_"+uid("x"), titikId: eng?eng.id:null, titik:g.nama, site: ambSite(g.site),
      tanggal:g.tgl, periode:g.periode, semester:sem, tahun, periodeOrder:order,
      unit:"dB(A)", hourly, lSiang, lMalam, lSiangMalam,
      baku, statusBakuMutu: ambStatusVsBaku(lSiangMalam, lSiangMalam!=null?"measured":"not_sampled", baku), pctOfBaku: ambPctOf(lSiangMalam, baku),
      metode
    };
  }).filter(Boolean);
}

/* ---------- GETARAN (13 baris/grup, 1 baris = 1 pita frekuensi) ---------- */
function ambBuildGetaranRecords(wb){
  const ws = wb.Sheets["GETARAN"]; if(!ws) return [];
  const lookup = ambEngineLookup("getaran");
  const rows = xlsxSheetToRows(ws);
  const groups = new Map();
  rows.forEach(r=>{
    const nama = (r["SAMPLE IDENTIFICATION"]||"").trim();
    const tgl = xlsxDateToIso(r["DATE OF MEASUREMENT"] || r["DATE OF MEASURMENT"]);
    const periode = (r["SEMESTER"]||"").trim();
    if(!nama || !periode) return;
    const key = nama+"|"+tgl+"|"+periode;
    if(!groups.has(key)) groups.set(key, {nama, tgl, periode, site:r["SITE"], rows:[]});
    groups.get(key).rows.push(r);
  });
  return [...groups.values()].map(g=>{
    const {sem, tahun, order} = hasilPeriodParts(g.periode);
    if(order==null) return null;
    const eng = lookup[g.nama];
    const bands = g.rows.map(r=>({
      freq: Number(r["FREQUENCY (Hz)"]), nilai: Number(r["TEST RESULT"]),
      notDisturb:(r["NOTDISTURB"]||"").trim(), disturb:(r["DISTURB"]||"").trim(),
      uncomfortable:(r["UNCOMFORTABLE"]||"").trim(), painful:(r["PAINFUL"]||"").trim(),
      status:(r["STATUS"]||"").trim()
    })).sort((a,b)=>a.freq-b.freq);
    if(!bands.length) return null;
    let worst = bands[0].status;
    bands.forEach(b=>{ if((GETARAN_RANK[b.status]||0) > (GETARAN_RANK[worst]||0)) worst = b.status; });
    return {
      id:"VIBRES_"+uid("x"), titikId: eng?eng.id:null, titik:g.nama, site: ambSite(g.site),
      tanggal:g.tgl, periode:g.periode, semester:sem, tahun, periodeOrder:order,
      unit:"micron", bands, statusKeseluruhan: worst,
      metode: (g.rows[0]["METHOD"]||"").trim()
    };
  }).filter(Boolean);
}

/* ---------- Import / Export / Template / Reset ---------- */
function importAmbienXlsx(){
  xlsxImport(wb=>{
    const recAmbien = ambBuildAmbienRecords(wb), recKebisingan = ambBuildKebisinganRecords(wb);
    const recKebauan = ambBuildKebauanRecords(wb), recGetaran = ambBuildGetaranRecords(wb);
    const total = recAmbien.length+recKebisingan.length+recKebauan.length+recGetaran.length;
    if(!total){ toast("Tidak ada baris data yang berhasil dibaca dari file ini — pastikan nama sheet & kolom sesuai Template.","err"); return; }
    DB.hasilAmbien.ambien.push(...recAmbien); DB.hasilAmbien.kebisingan.push(...recKebisingan);
    DB.hasilAmbien.kebauan.push(...recKebauan); DB.hasilAmbien.getaran.push(...recGetaran);
    touchDataset("hasilAmbien"); save();
    toast(`Import selesai: ${recAmbien.length} data udara ambien, ${recKebisingan.length} data kebisingan, ${recKebauan.length} data kebauan, ${recGetaran.length} data getaran ditambahkan.`, "ok");
    renderAmbienDb();
  });
}
const AMBIEN_XLSX_HEADERS = ["NO","SAMPLE IDENTIFICATION","SITE","LATITUDE","LONGITUDE","DATE OF SAMPLING","SEMESTER","PARAMETER","PERIODE","TEST RESULT","REQUIREMENT","METHOD","TEMPERATUR(°C)","HUMIDITY(%)","PRESSURE(mmHg)","WINDSPEED(m/s)","WIND DIRECTION","WEATHER"];
const KEBAUAN_XLSX_HEADERS = ["NO","SAMPLE IDENTIFICATION","SITE","LATITUDE","LONGITUDE","PARAMETER","DATE OF MEASUREMENT","SEMESTER","UNIT","TEST RESULT","REQUIREMENT","METHOD"];
const KEBISINGAN_XLSX_HEADERS = ["NO","SAMPLE IDENTIFICATION","SITE","LATITUDE","LONGITUDE","DATE OF MEASURMENT","SEMESTER","TIME OF MEASURMENT","UNIT","TEST RESULT","REQUIREMENT","METHOD","REMARKS"];
const GETARAN_XLSX_HEADERS = ["NO","SAMPLE IDENTIFICATION","DATE OF MEASUREMENT","SEMESTER","SITE","LATITUDE","LONGITUDE","FREQUENCY (Hz)","UNIT","TEST RESULT","NOTDISTURB","DISTURB","UNCOMFORTABLE","PAINFUL","STATUS","METHOD"];
function ambExportAmbienRows(){
  return DB.hasilAmbien.ambien.map((r,i)=>({
    "NO":i+1, "SAMPLE IDENTIFICATION":r.titik, "SITE":ambSiteRaw(r.site), "LATITUDE":"", "LONGITUDE":"",
    "DATE OF SAMPLING":r.tanggal, "SEMESTER":r.periode, "PARAMETER":r.parameter, "PERIODE":r.durasi,
    "TEST RESULT":r.resultRaw, "REQUIREMENT": r.baku!=null?r.baku:"", "METHOD":r.metode,
    "TEMPERATUR(°C)":r.cuaca.suhu, "HUMIDITY(%)":r.cuaca.kelembapan, "PRESSURE(mmHg)":r.cuaca.tekanan,
    "WINDSPEED(m/s)":r.cuaca.kecepatanAngin, "WIND DIRECTION":r.cuaca.arahAngin, "WEATHER":r.cuaca.cuaca
  }));
}
function ambExportKebauanRows(){
  return DB.hasilAmbien.kebauan.map((r,i)=>({
    "NO":i+1, "SAMPLE IDENTIFICATION":r.titik, "SITE":ambSiteRaw(r.site), "LATITUDE":"", "LONGITUDE":"",
    "PARAMETER":r.parameter, "DATE OF MEASUREMENT":r.tanggal, "SEMESTER":r.periode, "UNIT":r.unit,
    "TEST RESULT":r.resultRaw, "REQUIREMENT": r.baku!=null?r.baku:"", "METHOD":r.metode
  }));
}
function ambExportKebisinganRows(){
  const out = [];
  DB.hasilAmbien.kebisingan.forEach((r,i)=>{
    const base = {"NO":i+1, "SAMPLE IDENTIFICATION":r.titik, "SITE":ambSiteRaw(r.site), "LATITUDE":"", "LONGITUDE":"",
      "DATE OF MEASURMENT":r.tanggal, "SEMESTER":r.periode, "UNIT":r.unit, "METHOD":r.metode};
    r.hourly.forEach(h=> out.push({...base, "TIME OF MEASURMENT":h.label, "TEST RESULT":h.nilai, "REQUIREMENT":"-", "REMARKS":"Result"}));
    out.push({...base, "TIME OF MEASURMENT":"L Day (06.00 - 21.00)", "TEST RESULT": r.lSiang!=null?r.lSiang:"", "REQUIREMENT":"-", "REMARKS":"Final Result"});
    out.push({...base, "TIME OF MEASURMENT":"L Night (22.00 - 05.00)", "TEST RESULT": r.lMalam!=null?r.lMalam:"", "REQUIREMENT":"-", "REMARKS":"Final Result"});
    out.push({...base, "TIME OF MEASURMENT":"L Day Night", "TEST RESULT": r.lSiangMalam!=null?r.lSiangMalam:"", "REQUIREMENT": r.baku!=null?r.baku:"", "REMARKS":"Final Result"});
  });
  return out;
}
function ambExportGetaranRows(){
  const out = [];
  DB.hasilAmbien.getaran.forEach((r,i)=>{
    const base = {"NO":i+1, "SAMPLE IDENTIFICATION":r.titik, "DATE OF MEASUREMENT":r.tanggal, "SEMESTER":r.periode,
      "SITE":ambSiteRaw(r.site), "LATITUDE":"", "LONGITUDE":"", "UNIT":r.unit, "METHOD":r.metode};
    r.bands.forEach(b=> out.push({...base, "FREQUENCY (Hz)":b.freq, "TEST RESULT":b.nilai,
      "NOTDISTURB":b.notDisturb, "DISTURB":b.disturb, "UNCOMFORTABLE":b.uncomfortable, "PAINFUL":b.painful, "STATUS":b.status}));
  });
  return out;
}
function exportAmbienXlsx(){
  const wb = xlsxWorkbookFromSheets([
    ["AMBIEN", xlsxSheetFromRows(AMBIEN_XLSX_HEADERS, ambExportAmbienRows())],
    ["KEBISINGAN (NOISE)", xlsxSheetFromRows(KEBISINGAN_XLSX_HEADERS, ambExportKebisinganRows())],
    ["GETARAN", xlsxSheetFromRows(GETARAN_XLSX_HEADERS, ambExportGetaranRows())],
    ["KEBAUAN (ODOR)", xlsxSheetFromRows(KEBAUAN_XLSX_HEADERS, ambExportKebauanRows())]
  ]);
  xlsxDownload(wb, "hasil_pemantauan_ambient_export.xlsx");
}
function downloadTemplateAmbien(){
  const wb = xlsxWorkbookFromSheets([
    ["AMBIEN", xlsxSheetFromRows(AMBIEN_XLSX_HEADERS, [])],
    ["KEBISINGAN (NOISE)", xlsxSheetFromRows(KEBISINGAN_XLSX_HEADERS, [])],
    ["GETARAN", xlsxSheetFromRows(GETARAN_XLSX_HEADERS, [])],
    ["KEBAUAN (ODOR)", xlsxSheetFromRows(KEBAUAN_XLSX_HEADERS, [])]
  ]);
  xlsxDownload(wb, "template_hasil_pemantauan_ambient.xlsx");
}
function resetAmbienData(){
  askConfirm("Reset Database Hasil Ambient ke data default (kembali ke dataset awal, semua data yang kamu import akan hilang)?", ()=>{
    DB.hasilAmbien = {ambien:[...DEFAULT_HASIL_AMBIEN.ambien], kebisingan:[...DEFAULT_HASIL_AMBIEN.kebisingan], kebauan:[...DEFAULT_HASIL_AMBIEN.kebauan], getaran:[...DEFAULT_HASIL_AMBIEN.getaran]};
    save(); toast("Database Hasil Ambient direset ke default.","ok"); renderAmbienDb();
  });
}

/* =========================================================
   HASIL PEMANTAUAN AMBIENT — Tambah/Edit/Hapus manual, alternatif dari import Excel.
   Ambien & Kebauan berbagi bentuk form yg sama (parameter+hasil), Kebisingan & Getaran punya
   form sendiri krn bentuk datanya beda (24 jam / pita frekuensi — lihat catatan skema di atas).
========================================================= */
function ambTitikOptions(cat, selectedId){
  const pointsKategori = AMB_CAT_POINTS_KATEGORI[cat] || cat;
  const pts = DB.points.filter(p=>p.kategori===pointsKategori).sort((a,b)=> a.site===b.site ? a.nama.localeCompare(b.nama) : a.site.localeCompare(b.site));
  return `<option value="">- pilih titik -</option>` + pts.map(p=>`<option value="${escHtml(p.id)}" ${selectedId===p.id?"selected":""}>${escHtml(p.site)} — ${escHtml(p.nama)}</option>`).join("");
}
/* ---- Ambien & Kebauan (parameter+hasil) ---- */
function ambParamFormHtml(cat, rec){
  rec = rec || {id:"", titikId:"", periode:"", tanggal:"", parameter:"", durasi:"", unit: cat==="ambien"?"µg/Nm³":"ppm", resultRaw:"", baku:null, metode:"", cuaca:{suhu:"",kelembapan:"",tekanan:"",kecepatanAngin:"",arahAngin:"",cuaca:""}};
  const cuaca = rec.cuaca || {};
  const paramList = [...new Set(DB.hasilAmbien[cat].map(r=>r.parameter))].filter(Boolean).sort();
  const periodeList = [...new Set(DB.hasilAmbien[cat].map(r=>r.periode))].filter(Boolean).sort((a,b)=>hasilPeriodParts(a).order-hasilPeriodParts(b).order);
  return `
  <h3>${rec.id?"Edit":"Tambah"} Data ${AMB_KATEGORI_LABEL[cat]}</h3>
  <div class="field"><label>Titik</label><select id="ap_titik">${ambTitikOptions(cat, rec.titikId)}</select></div>
  <div class="grid cols-2" style="margin-top:10px;">
    <div class="field"><label>Periode</label><input type="text" id="ap_periode" value="${escHtml(rec.periode)}" placeholder="mis. S1 2026" list="ap_periodeList"><datalist id="ap_periodeList">${periodeList.map(p=>`<option value="${escHtml(p)}">`).join("")}</datalist></div>
    <div class="field"><label>Tanggal</label><input type="date" id="ap_tanggal" value="${escHtml(rec.tanggal)}"></div>
  </div>
  <div class="grid cols-2" style="margin-top:10px;">
    <div class="field"><label>Parameter</label><input type="text" id="ap_parameter" value="${escHtml(rec.parameter)}" list="ap_paramList"><datalist id="ap_paramList">${paramList.map(p=>`<option value="${escHtml(p)}">`).join("")}</datalist></div>
    <div class="field"><label>Satuan</label><input type="text" id="ap_unit" value="${escHtml(rec.unit)}"></div>
  </div>
  ${cat==="ambien"?`<div class="field" style="margin-top:10px;"><label>Durasi Pengukuran</label><input type="text" id="ap_durasi" value="${escHtml(rec.durasi)}" placeholder="mis. 1 Hour, 24 Hour"></div>`:""}
  <div class="grid cols-2" style="margin-top:10px;">
    <div class="field"><label>Hasil</label><input type="text" id="ap_result" value="${escHtml(rec.resultRaw)}" placeholder="mis. 21, atau &lt;21"></div>
    <div class="field"><label>Baku Mutu</label><input type="number" step="any" id="ap_baku" value="${rec.baku!=null?rec.baku:""}"></div>
  </div>
  <div class="field" style="margin-top:10px;"><label>Metode</label><input type="text" id="ap_metode" value="${escHtml(rec.metode)}"></div>
  ${cat==="ambien"?`
  <div class="reg-divider" style="margin-top:14px;">Data Cuaca &amp; Lingkungan Saat Sampling (opsional)</div>
  <div class="grid cols-2">
    <div class="field"><label>Temperatur</label><input type="text" id="ap_suhu" value="${escHtml(cuaca.suhu)}" placeholder="mis. 24 - 30"></div>
    <div class="field"><label>Kelembapan</label><input type="text" id="ap_kelembapan" value="${escHtml(cuaca.kelembapan)}" placeholder="mis. 79 - 94"></div>
  </div>
  <div class="grid cols-2" style="margin-top:10px;">
    <div class="field"><label>Tekanan</label><input type="text" id="ap_tekanan" value="${escHtml(cuaca.tekanan)}" placeholder="mis. 755 - 760"></div>
    <div class="field"><label>Kecepatan Angin</label><input type="text" id="ap_kecepatanAngin" value="${escHtml(cuaca.kecepatanAngin)}" placeholder="mis. 0.1 - 3.6"></div>
  </div>
  <div class="grid cols-2" style="margin-top:10px;">
    <div class="field"><label>Arah Angin</label><input type="text" id="ap_arahAngin" value="${escHtml(cuaca.arahAngin)}"></div>
    <div class="field"><label>Cuaca</label><input type="text" id="ap_cuaca" value="${escHtml(cuaca.cuaca)}" placeholder="mis. Clear, Cloudy"></div>
  </div>`:""}
  <div class="actions">
    <button class="btn ghost" data-action="closeModal">Batal</button>
    <button class="btn primary" data-action="saveAmbParam" data-cat="${cat}" data-id="${rec.id}">Simpan</button>
  </div>`;
}
function addAmbParam(cat){ openModal(ambParamFormHtml(cat, null)); }
function editAmbParam(cat, id){
  const r = DB.hasilAmbien[cat].find(x=>x.id===id); if(!r) return;
  openModal(ambParamFormHtml(cat, r));
}
function saveAmbParam(cat, id){
  const point = DB.points.find(p=>p.id===document.getElementById("ap_titik").value);
  if(!point){ toast("Pilih titik dulu.","err"); return; }
  const periode = document.getElementById("ap_periode").value.trim();
  const {sem,tahun,order} = hasilPeriodParts(periode);
  if(order==null){ toast('Format Periode harus "S1 2026" atau "S2 2026".',"err"); return; }
  const parameter = document.getElementById("ap_parameter").value.trim();
  if(!parameter){ toast("Parameter wajib diisi.","err"); return; }
  const res = ambResult(document.getElementById("ap_result").value);
  const bakuEl = document.getElementById("ap_baku").value;
  const baku = bakuEl===""?null:Number(bakuEl);
  const paramMap = cat==="ambien" ? AMBIEN_PARAM_MAP : KEBAUAN_PARAM_MAP;
  const val = {
    titikId: point.id, titik: point.nama, site: point.site,
    tanggal: document.getElementById("ap_tanggal").value, periode, semester:sem, tahun, periodeOrder:order,
    parameter, parameterKode: paramMap[parameter] || parameter,
    unit: document.getElementById("ap_unit").value.trim(),
    resultRaw: res.raw, resultNumeric: res.numeric, resultStatus: res.status,
    baku, statusBakuMutu: ambStatusVsBaku(res.numeric, res.status, baku), pctOfBaku: ambPctOf(res.numeric, baku),
    metode: document.getElementById("ap_metode").value.trim()
  };
  if(cat==="ambien"){
    val.durasi = document.getElementById("ap_durasi").value.trim();
    val.cuaca = {
      suhu: document.getElementById("ap_suhu").value.trim(), kelembapan: document.getElementById("ap_kelembapan").value.trim(),
      tekanan: document.getElementById("ap_tekanan").value.trim(), kecepatanAngin: document.getElementById("ap_kecepatanAngin").value.trim(),
      arahAngin: document.getElementById("ap_arahAngin").value.trim(), cuaca: document.getElementById("ap_cuaca").value.trim()
    };
  }
  if(id){ Object.assign(DB.hasilAmbien[cat].find(r=>r.id===id), val); }
  else { DB.hasilAmbien[cat].push({id:(cat==="ambien"?"AMBRES_":"ODRRES_")+uid("x"), ...val}); }
  touchDataset("hasilAmbien"); save(); closeModal(); renderAmbienDb();
  toast(id?"Data diperbarui.":"Data ditambahkan.","ok");
}
/* ---- Kebisingan (24 jam + L Siang/Malam/Siang-Malam) ---- */
function kebisinganFormHtml(rec){
  rec = rec || {id:"", titikId:"", periode:"", tanggal:"", hourly:[], lSiang:null, lMalam:null, lSiangMalam:null, baku:70, metode:"SNI 8427-2017"};
  const periodeList = [...new Set(DB.hasilAmbien.kebisingan.map(r=>r.periode))].filter(Boolean).sort((a,b)=>hasilPeriodParts(a).order-hasilPeriodParts(b).order);
  const hourlyMap = {}; (rec.hourly||[]).forEach(h=>{ hourlyMap[h.jam] = h.nilai; });
  return `
  <h3>${rec.id?"Edit":"Tambah"} Data Kebisingan</h3>
  <div class="field"><label>Titik</label><select id="kb_titik">${ambTitikOptions("kebisingan", rec.titikId)}</select></div>
  <div class="grid cols-2" style="margin-top:10px;">
    <div class="field"><label>Periode</label><input type="text" id="kb_periode" value="${escHtml(rec.periode)}" placeholder="mis. S1 2026" list="kb_periodeList"><datalist id="kb_periodeList">${periodeList.map(p=>`<option value="${escHtml(p)}">`).join("")}</datalist></div>
    <div class="field"><label>Tanggal</label><input type="date" id="kb_tanggal" value="${escHtml(rec.tanggal)}"></div>
  </div>
  <div class="reg-divider" style="margin-top:14px;">24 Pembacaan per Jam, dB(A) (opsional — dipakai utk grafik profil 24 jam)</div>
  <div class="grid" style="grid-template-columns:repeat(6,1fr);gap:8px;">
    ${KEBISINGAN_JAM_LABELS.map((jam,i)=>`<div class="field"><label style="font-size:10.5px;">${jam}</label><input type="number" step="0.1" id="kb_h_${i}" value="${hourlyMap[jam]!=null?hourlyMap[jam]:""}"></div>`).join("")}
  </div>
  <div class="reg-divider" style="margin-top:14px;">Hasil Akhir (dari lab, sesuai Kepmen LH 48/1996)</div>
  <div class="grid cols-3">
    <div class="field"><label>L Siang (06.00-21.00)</label><input type="number" step="any" id="kb_lsiang" value="${rec.lSiang!=null?rec.lSiang:""}"></div>
    <div class="field"><label>L Malam (22.00-05.00)</label><input type="number" step="any" id="kb_lmalam" value="${rec.lMalam!=null?rec.lMalam:""}"></div>
    <div class="field"><label>L Siang-Malam</label><input type="number" step="any" id="kb_lsm" value="${rec.lSiangMalam!=null?rec.lSiangMalam:""}"></div>
  </div>
  <div class="grid cols-2" style="margin-top:10px;">
    <div class="field"><label>Baku Mutu (L Siang-Malam)</label><input type="number" step="any" id="kb_baku" value="${rec.baku!=null?rec.baku:""}" placeholder="mis. 70"></div>
    <div class="field"><label>Metode</label><input type="text" id="kb_metode" value="${escHtml(rec.metode||"SNI 8427-2017")}"></div>
  </div>
  <div class="actions">
    <button class="btn ghost" data-action="closeModal">Batal</button>
    <button class="btn primary" data-action="saveKebisingan" data-id="${rec.id}">Simpan</button>
  </div>`;
}
function addKebisingan(){ openModal(kebisinganFormHtml(null)); }
function editKebisingan(id){
  const r = DB.hasilAmbien.kebisingan.find(x=>x.id===id); if(!r) return;
  openModal(kebisinganFormHtml(r));
}
function saveKebisingan(id){
  const point = DB.points.find(p=>p.id===document.getElementById("kb_titik").value);
  if(!point){ toast("Pilih titik dulu.","err"); return; }
  const periode = document.getElementById("kb_periode").value.trim();
  const {sem,tahun,order} = hasilPeriodParts(periode);
  if(order==null){ toast('Format Periode harus "S1 2026" atau "S2 2026".',"err"); return; }
  const hourly = [];
  KEBISINGAN_JAM_LABELS.forEach((jam,i)=>{
    const v = document.getElementById("kb_h_"+i).value;
    if(v!=="") hourly.push({label:`L${i+1} (${jam})`, jam, nilai:Number(v)});
  });
  const lsEl = document.getElementById("kb_lsiang").value, lmEl = document.getElementById("kb_lmalam").value, lsmEl = document.getElementById("kb_lsm").value;
  const lSiang = lsEl===""?null:Number(lsEl), lMalam = lmEl===""?null:Number(lmEl), lSiangMalam = lsmEl===""?null:Number(lsmEl);
  if(!hourly.length && lSiangMalam==null){ toast("Isi minimal L Siang-Malam, atau data pembacaan per jam.","err"); return; }
  const bakuEl = document.getElementById("kb_baku").value;
  const baku = bakuEl===""?null:Number(bakuEl);
  const val = {
    titikId: point.id, titik: point.nama, site: point.site,
    tanggal: document.getElementById("kb_tanggal").value, periode, semester:sem, tahun, periodeOrder:order,
    unit:"dB(A)", hourly, lSiang, lMalam, lSiangMalam,
    baku, statusBakuMutu: ambStatusVsBaku(lSiangMalam, lSiangMalam!=null?"measured":"not_sampled", baku), pctOfBaku: ambPctOf(lSiangMalam, baku),
    metode: document.getElementById("kb_metode").value.trim()
  };
  if(id){ Object.assign(DB.hasilAmbien.kebisingan.find(r=>r.id===id), val); }
  else { DB.hasilAmbien.kebisingan.push({id:"NOIRES_"+uid("x"), ...val}); }
  touchDataset("hasilAmbien"); save(); closeModal(); renderAmbienDb();
  toast(id?"Data diperbarui.":"Data ditambahkan.","ok");
}
/* ---- Getaran (per pita frekuensi, status dihitung otomatis dari ambang ISO 2631-2) ---- */
function getaranFormHtml(rec){
  rec = rec || {id:"", titikId:"", periode:"", tanggal:"", metode:"ISO 2631-2: 2003", bands:[]};
  const periodeList = [...new Set(DB.hasilAmbien.getaran.map(r=>r.periode))].filter(Boolean).sort((a,b)=>hasilPeriodParts(a).order-hasilPeriodParts(b).order);
  const bandMap = {}; (rec.bands||[]).forEach(b=>{ bandMap[b.freq] = b.nilai; });
  return `
  <h3>${rec.id?"Edit":"Tambah"} Data Getaran</h3>
  <div class="field"><label>Titik</label><select id="vb_titik">${ambTitikOptions("getaran", rec.titikId)}</select></div>
  <div class="grid cols-2" style="margin-top:10px;">
    <div class="field"><label>Periode</label><input type="text" id="vb_periode" value="${escHtml(rec.periode)}" placeholder="mis. S1 2026" list="vb_periodeList"><datalist id="vb_periodeList">${periodeList.map(p=>`<option value="${escHtml(p)}">`).join("")}</datalist></div>
    <div class="field"><label>Tanggal</label><input type="date" id="vb_tanggal" value="${escHtml(rec.tanggal)}"></div>
  </div>
  <div class="reg-divider" style="margin-top:14px;">Nilai per Pita Frekuensi (micron)</div>
  <div class="hint" style="margin-top:-6px;margin-bottom:8px;">Ambang ISO 2631-2:2003 tiap pita sudah baku dan tidak bisa diubah — status kenyamanan dihitung otomatis dari nilai yang diisi.</div>
  <div class="tablewrap"><table style="font-size:12px;">
    <thead><tr><th>Freq (Hz)</th><th>Nilai (micron)</th><th>Not Disturb</th><th>Disturb</th><th>Uncomfortable</th><th>Painful</th></tr></thead>
    <tbody>${GETARAN_FREQ_BANDS.map(f=>{
      const t = GETARAN_THRESHOLDS[f], key = String(f).replace(".","_");
      return `<tr><td><b>${f}</b></td><td><input type="number" step="any" id="vb_f_${key}" value="${bandMap[f]!=null?bandMap[f]:""}" style="width:90px;"></td>
        <td class="muted">${t.notDisturb}</td><td class="muted">${t.disturb}</td><td class="muted">${t.uncomfortable}</td><td class="muted">${t.painful}</td></tr>`;
    }).join("")}</tbody>
  </table></div>
  <div class="field" style="margin-top:10px;max-width:320px;"><label>Metode</label><input type="text" id="vb_metode" value="${escHtml(rec.metode||"ISO 2631-2: 2003")}"></div>
  <div class="actions">
    <button class="btn ghost" data-action="closeModal">Batal</button>
    <button class="btn primary" data-action="saveGetaran" data-id="${rec.id}">Simpan</button>
  </div>`;
}
function addGetaran(){ openModal(getaranFormHtml(null)); }
function editGetaran(id){
  const r = DB.hasilAmbien.getaran.find(x=>x.id===id); if(!r) return;
  openModal(getaranFormHtml(r));
}
function saveGetaran(id){
  const point = DB.points.find(p=>p.id===document.getElementById("vb_titik").value);
  if(!point){ toast("Pilih titik dulu.","err"); return; }
  const periode = document.getElementById("vb_periode").value.trim();
  const {sem,tahun,order} = hasilPeriodParts(periode);
  if(order==null){ toast('Format Periode harus "S1 2026" atau "S2 2026".',"err"); return; }
  const bands = [];
  GETARAN_FREQ_BANDS.forEach(f=>{
    const key = String(f).replace(".","_");
    const v = document.getElementById("vb_f_"+key).value;
    if(v==="") return;
    const nilai = Number(v), t = GETARAN_THRESHOLDS[f];
    bands.push({freq:f, nilai, notDisturb:t.notDisturb, disturb:t.disturb, uncomfortable:t.uncomfortable, painful:t.painful, status:getaranStatusFor(f,nilai)});
  });
  if(!bands.length){ toast("Isi minimal satu nilai pita frekuensi.","err"); return; }
  let worst = bands[0].status;
  bands.forEach(b=>{ if((GETARAN_RANK[b.status]||0) > (GETARAN_RANK[worst]||0)) worst = b.status; });
  const val = {
    titikId: point.id, titik: point.nama, site: point.site,
    tanggal: document.getElementById("vb_tanggal").value, periode, semester:sem, tahun, periodeOrder:order,
    unit:"micron", bands, statusKeseluruhan: worst,
    metode: document.getElementById("vb_metode").value.trim()
  };
  if(id){ Object.assign(DB.hasilAmbien.getaran.find(r=>r.id===id), val); }
  else { DB.hasilAmbien.getaran.push({id:"VIBRES_"+uid("x"), ...val}); }
  touchDataset("hasilAmbien"); save(); closeModal(); renderAmbienDb();
  toast(id?"Data diperbarui.":"Data ditambahkan.","ok");
}
function deleteAmbRecord(cat, id){
  askConfirm("Hapus baris data ini?", ()=>{
    DB.hasilAmbien[cat] = DB.hasilAmbien[cat].filter(r=>r.id!==id);
    touchDataset("hasilAmbien"); save(); renderAmbienDb(); toast("Data dihapus.","ok");
  });
}

/* =========================================================
   HASIL PEMANTAUAN AMBIENT — Database page (tab per kategori)
========================================================= */
let ambDbCat = "ambien";
function ambDbRecords(cat){ return DB.hasilAmbien[cat] || []; }
function ambDbFilterBarHtml(cat){
  return `
    <div class="field"><label>Site</label><select id="ambDbFltSite"><option value="">Semua</option></select></div>
    <div class="field"><label>Periode</label><select id="ambDbFltPeriode"><option value="">Semua</option></select></div>
    ${(cat==="ambien"||cat==="kebauan") ? `<div class="field"><label>Parameter</label><select id="ambDbFltParameter"><option value="">Semua</option></select></div>` : ""}
    ${(cat==="ambien"||cat==="kebauan"||cat==="kebisingan") ? `<div class="field"><label>Status Baku Mutu</label><select id="ambDbFltStatus">
        <option value="">Semua</option><option value="ok">Memenuhi Baku Mutu</option><option value="exceed">Melebihi Baku Mutu</option>
        <option value="not_applicable">Tidak Ada Baku Mutu</option><option value="not_evaluated">Belum Dievaluasi</option>
      </select></div>` : ""}
    ${cat==="getaran" ? `<div class="field"><label>Status</label><select id="ambDbFltStatus">
        <option value="">Semua</option><option value="Not Disturb">Not Disturb</option><option value="Disturb">Disturb</option><option value="Uncomfortable">Uncomfortable</option><option value="Painful">Painful</option>
      </select></div>` : ""}
    <div class="spacer"></div>
    <div class="field"><label>Cari Titik</label><div class="search-wrap"><span class="search-ico">&#128269;</span><input type="text" id="ambDbFltSearch" placeholder="nama titik..."></div></div>
  `;
}
function ambDbPopulateFilters(cat){
  const data = ambDbRecords(cat);
  const sites = [...new Set(data.map(r=>r.site))].sort();
  const periods = [...new Set(data.map(r=>r.periode))].sort((a,b)=>hasilPeriodParts(a).order-hasilPeriodParts(b).order);
  const siteSel = document.getElementById("ambDbFltSite");
  if(siteSel){ const cur=siteSel.value; siteSel.innerHTML = '<option value="">Semua</option>'+sites.map(s=>`<option value="${s}">${s}</option>`).join(""); siteSel.value=cur; }
  const perSel = document.getElementById("ambDbFltPeriode");
  if(perSel){ const cur=perSel.value; perSel.innerHTML = '<option value="">Semua</option>'+periods.map(p=>`<option value="${p}">${p}</option>`).join(""); perSel.value=cur; }
  const paramSel = document.getElementById("ambDbFltParameter");
  if(paramSel){
    const params = [...new Set(data.map(r=>r.parameter))].sort();
    const cur=paramSel.value; paramSel.innerHTML = '<option value="">Semua</option>'+params.map(p=>`<option value="${escHtml(p)}">${escHtml(p)}</option>`).join(""); paramSel.value=cur;
  }
}
function ambDbActionsCell(cat, id){
  return `<td style="white-space:nowrap;"><button class="btn small ghost" data-action="editAmbRecord" data-cat="${cat}" data-id="${id}">Edit</button> <button class="btn small danger" data-action="deleteAmbRecord" data-cat="${cat}" data-id="${id}">Hapus</button></td>`;
}
function ambDbBuildTable(cat, rows, withActions){
  const actionsTh = withActions ? "<th></th>" : "";
  if(cat==="ambien" || cat==="kebauan"){
    return `<thead><tr><th>Titik</th><th>Site</th><th>Periode</th><th>Tanggal</th><th>Parameter</th><th>Hasil</th><th>Satuan</th><th>Baku Mutu</th><th>%BM</th><th>Status</th><th>Metode</th>${actionsTh}</tr></thead>
      <tbody>${rows.map(r=>{
        const badge = HASIL_STATUS_BADGE[r.statusBakuMutu]||HASIL_STATUS_BADGE.not_evaluated;
        return `<tr><td>${escHtml(r.titik)}</td><td>${r.site}</td><td>${r.periode}</td><td class="muted">${r.tanggal||"-"}</td>
          <td>${escHtml(r.parameter)}</td><td style="font-family:var(--font-mono);">${escHtml(r.resultRaw)}</td><td class="muted">${escHtml(r.unit)}</td>
          <td class="muted">${r.baku!=null?r.baku:"-"}</td><td class="muted">${r.pctOfBaku!=null?r.pctOfBaku+"%":"-"}</td>
          <td><span class="badge ${badge[0]}">${badge[1]}</span></td><td class="muted" style="font-size:11px;">${escHtml(r.metode)}</td>${withActions?ambDbActionsCell(cat,r.id):""}</tr>`;
      }).join("")}</tbody>`;
  }
  if(cat==="kebisingan"){
    return `<thead><tr><th>Titik</th><th>Site</th><th>Periode</th><th>Tanggal</th><th>L Siang</th><th>L Malam</th><th>L Siang-Malam</th><th>Baku Mutu</th><th>%BM</th><th>Status</th><th>Metode</th>${actionsTh}</tr></thead>
      <tbody>${rows.map(r=>{
        const badge = HASIL_STATUS_BADGE[r.statusBakuMutu]||HASIL_STATUS_BADGE.not_evaluated;
        return `<tr><td>${escHtml(r.titik)}</td><td>${r.site}</td><td>${r.periode}</td><td class="muted">${r.tanggal||"-"}</td>
          <td style="font-family:var(--font-mono);">${r.lSiang!=null?r.lSiang:"-"}</td><td style="font-family:var(--font-mono);">${r.lMalam!=null?r.lMalam:"-"}</td>
          <td style="font-family:var(--font-mono);font-weight:700;">${r.lSiangMalam!=null?r.lSiangMalam:"-"} <span class="muted">dB(A)</span></td>
          <td class="muted">${r.baku!=null?r.baku:"-"}</td><td class="muted">${r.pctOfBaku!=null?r.pctOfBaku+"%":"-"}</td>
          <td><span class="badge ${badge[0]}">${badge[1]}</span></td><td class="muted" style="font-size:11px;">${escHtml(r.metode)}</td>${withActions?ambDbActionsCell(cat,r.id):""}</tr>`;
      }).join("")}</tbody>`;
  }
  return `<thead><tr><th>Titik</th><th>Site</th><th>Periode</th><th>Tanggal</th><th>Band Terburuk</th><th>Status Keseluruhan</th><th>Metode</th>${actionsTh}</tr></thead>
    <tbody>${rows.map(r=>{
      const badge = GETARAN_STATUS_BADGE[r.statusKeseluruhan] || ["b-gray", r.statusKeseluruhan||"-"];
      const worstBand = r.bands.slice().sort((a,b)=>(GETARAN_RANK[b.status]||0)-(GETARAN_RANK[a.status]||0))[0];
      return `<tr><td>${escHtml(r.titik)}</td><td>${r.site}</td><td>${r.periode}</td><td class="muted">${r.tanggal||"-"}</td>
        <td class="muted">${worstBand?worstBand.freq+" Hz — "+worstBand.nilai+" micron":"-"}</td>
        <td><span class="badge ${badge[0]}">${badge[1]}</span></td><td class="muted" style="font-size:11px;">${escHtml(r.metode)}</td>${withActions?ambDbActionsCell(cat,r.id):""}</tr>`;
    }).join("")}</tbody>`;
}
function editAmbRecord(cat, id){
  if(cat==="ambien" || cat==="kebauan") editAmbParam(cat, id);
  else if(cat==="kebisingan") editKebisingan(id);
  else editGetaran(id);
}
function renderAmbienDb(){
  document.getElementById("ambDbCategoryTabs").innerHTML = AMB_KATEGORI_ORDER.map(c=>
    `<button type="button" class="chip-toggle ${ambDbCat===c?'active':''}" data-action="ambDbSetCat" data-cat="${c}">${AMB_KATEGORI_LABEL[c]} <span class="muted">(${ambDbRecords(c).length})</span></button>`
  ).join("");

  const cat = ambDbCat;
  const bar = document.getElementById("ambDbFilterBar");
  if(bar.dataset.cat !== cat){ bar.dataset.cat = cat; bar.innerHTML = ambDbFilterBarHtml(cat); }
  ambDbPopulateFilters(cat);

  const site = document.getElementById("ambDbFltSite").value;
  const periode = document.getElementById("ambDbFltPeriode").value;
  const paramEl = document.getElementById("ambDbFltParameter");
  const parameter = paramEl ? paramEl.value : "";
  const statusEl = document.getElementById("ambDbFltStatus");
  const status = statusEl ? statusEl.value : "";
  const q = (document.getElementById("ambDbFltSearch").value||"").toLowerCase();

  const rows = ambDbRecords(cat).filter(r=>{
    if(site && r.site!==site) return false;
    if(periode && r.periode!==periode) return false;
    if(parameter && r.parameter!==parameter) return false;
    if(status){
      if(cat==="getaran"){ if(r.statusKeseluruhan!==status) return false; }
      else if(r.statusBakuMutu!==status) return false;
    }
    if(q && !r.titik.toLowerCase().includes(q)) return false;
    return true;
  }).sort((a,b)=> b.periodeOrder-a.periodeOrder || a.site.localeCompare(b.site) || a.titik.localeCompare(b.titik));

  document.getElementById("ambDbTable").innerHTML = ambDbBuildTable(cat, rows, true);
  document.getElementById("ambDbCount").textContent = `${rows.length} dari ${ambDbRecords(cat).length} baris data ditampilkan.`;
  const addBtn = document.getElementById("ambDbAddBtn");
  if(addBtn) addBtn.dataset.cat = cat;
}
function addAmbRecord(cat){
  if(cat==="ambien" || cat==="kebauan") addAmbParam(cat);
  else if(cat==="kebisingan") addKebisingan();
  else addGetaran();
}
["ambDbFltSite","ambDbFltPeriode","ambDbFltParameter","ambDbFltStatus","ambDbFltSearch"].forEach(id=>{
  document.addEventListener("input", e=>{ if(e.target.id===id) renderAmbienDb(); });
  document.addEventListener("change", e=>{ if(e.target.id===id) renderAmbienDb(); });
});
