/* =========================================================
   HASIL PEMANTAUAN AMBIENT — parsing helper (dipakai import Excel)
   4 kategori (ambien udara, kebisingan, kebauan, getaran), tiap kategori bentuk datanya beda
   (lihat DB.hasilAmbien.{ambien,kebisingan,kebauan,getaran}) — karena itu tidak digabung jadi
   satu tabel datar spt DB.hasilPemantauan (emisi), supaya kolom yang cuma relevan utk 1-2
   kategori saja tidak ikut kosong di kategori lain.
========================================================= */
const AMB_KATEGORI_LABEL = {ambien:"Udara Ambien", kebisingan:"Kebisingan", kebauan:"Kebauan (Bau)", getaran:"Getaran"};
const AMB_KATEGORI_ORDER = ["ambien","kebisingan","kebauan","getaran"];
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
function ambDbBuildTable(cat, rows){
  if(cat==="ambien" || cat==="kebauan"){
    return `<thead><tr><th>Titik</th><th>Site</th><th>Periode</th><th>Tanggal</th><th>Parameter</th><th>Hasil</th><th>Satuan</th><th>Baku Mutu</th><th>%BM</th><th>Status</th><th>Metode</th></tr></thead>
      <tbody>${rows.map(r=>{
        const badge = HASIL_STATUS_BADGE[r.statusBakuMutu]||HASIL_STATUS_BADGE.not_evaluated;
        return `<tr><td>${escHtml(r.titik)}</td><td>${r.site}</td><td>${r.periode}</td><td class="muted">${r.tanggal||"-"}</td>
          <td>${escHtml(r.parameter)}</td><td style="font-family:var(--font-mono);">${escHtml(r.resultRaw)}</td><td class="muted">${escHtml(r.unit)}</td>
          <td class="muted">${r.baku!=null?r.baku:"-"}</td><td class="muted">${r.pctOfBaku!=null?r.pctOfBaku+"%":"-"}</td>
          <td><span class="badge ${badge[0]}">${badge[1]}</span></td><td class="muted" style="font-size:11px;">${escHtml(r.metode)}</td></tr>`;
      }).join("")}</tbody>`;
  }
  if(cat==="kebisingan"){
    return `<thead><tr><th>Titik</th><th>Site</th><th>Periode</th><th>Tanggal</th><th>L Siang</th><th>L Malam</th><th>L Siang-Malam</th><th>Baku Mutu</th><th>%BM</th><th>Status</th><th>Metode</th></tr></thead>
      <tbody>${rows.map(r=>{
        const badge = HASIL_STATUS_BADGE[r.statusBakuMutu]||HASIL_STATUS_BADGE.not_evaluated;
        return `<tr><td>${escHtml(r.titik)}</td><td>${r.site}</td><td>${r.periode}</td><td class="muted">${r.tanggal||"-"}</td>
          <td style="font-family:var(--font-mono);">${r.lSiang!=null?r.lSiang:"-"}</td><td style="font-family:var(--font-mono);">${r.lMalam!=null?r.lMalam:"-"}</td>
          <td style="font-family:var(--font-mono);font-weight:700;">${r.lSiangMalam!=null?r.lSiangMalam:"-"} <span class="muted">dB(A)</span></td>
          <td class="muted">${r.baku!=null?r.baku:"-"}</td><td class="muted">${r.pctOfBaku!=null?r.pctOfBaku+"%":"-"}</td>
          <td><span class="badge ${badge[0]}">${badge[1]}</span></td><td class="muted" style="font-size:11px;">${escHtml(r.metode)}</td></tr>`;
      }).join("")}</tbody>`;
  }
  return `<thead><tr><th>Titik</th><th>Site</th><th>Periode</th><th>Tanggal</th><th>Band Terburuk</th><th>Status Keseluruhan</th><th>Metode</th></tr></thead>
    <tbody>${rows.map(r=>{
      const badge = GETARAN_STATUS_BADGE[r.statusKeseluruhan] || ["b-gray", r.statusKeseluruhan||"-"];
      const worstBand = r.bands.slice().sort((a,b)=>(GETARAN_RANK[b.status]||0)-(GETARAN_RANK[a.status]||0))[0];
      return `<tr><td>${escHtml(r.titik)}</td><td>${r.site}</td><td>${r.periode}</td><td class="muted">${r.tanggal||"-"}</td>
        <td class="muted">${worstBand?worstBand.freq+" Hz — "+worstBand.nilai+" micron":"-"}</td>
        <td><span class="badge ${badge[0]}">${badge[1]}</span></td><td class="muted" style="font-size:11px;">${escHtml(r.metode)}</td></tr>`;
    }).join("")}</tbody>`;
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

  document.getElementById("ambDbTable").innerHTML = ambDbBuildTable(cat, rows);
  document.getElementById("ambDbCount").textContent = `${rows.length} dari ${ambDbRecords(cat).length} baris data ditampilkan.`;
}
["ambDbFltSite","ambDbFltPeriode","ambDbFltParameter","ambDbFltStatus","ambDbFltSearch"].forEach(id=>{
  document.addEventListener("input", e=>{ if(e.target.id===id) renderAmbienDb(); });
  document.addEventListener("change", e=>{ if(e.target.id===id) renderAmbienDb(); });
});
