/* =========================================================
   HASIL PEMANTAUAN — parsing helper (dipakai import CSV)
========================================================= */
const HASIL_MONTHS = {Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12};
// Sel tanggal Excel (dibaca cellDates:true) datang sbg objek Date, sedangkan CSV lama & input
// manual berupa teks "DD-Mon-YYYY" — dua-duanya perlu diterima krn hasilParseDate dipakai baik
// oleh import file maupun (tidak langsung, lewat isian form) alur tambah/edit manual.
function hasilParseDate(s){
  if(s instanceof Date) return xlsxDateToIso(s);
  s = (s||"").trim(); if(!s) return "";
  const m = s.match(/^(\d{1,2})-(\w{3})-(\d{4})/);
  if(!m) return "";
  const mm = HASIL_MONTHS[m[2]]; if(!mm) return "";
  return `${m[3]}-${String(mm).padStart(2,"0")}-${String(Number(m[1])).padStart(2,"0")}`;
}
function hasilParseResult(raw){
  raw = (raw==null?"":String(raw)).trim();
  if(!raw || /^N\/A/i.test(raw)) return {raw, numeric:null, status:"not_sampled"};
  if(raw==="Surat Pernyataan") return {raw, numeric:null, status:"declaration"};
  if(raw.startsWith("<")){ const m = raw.match(/[\d.]+/); return {raw, numeric: m?parseFloat(m[0]):null, status:"below_detection"}; }
  if(/^-?\d+(\.\d+)?$/.test(raw)) return {raw, numeric: parseFloat(raw), status:"measured"};
  const m2 = raw.match(/[\d.]+/);
  return {raw, numeric: m2?parseFloat(m2[0]):null, status:"other"};
}
function hasilParseStandard(raw){
  raw = (raw==null?"":String(raw)).trim();
  if(!raw || /^N\/A$/i.test(raw)) return null;
  if(raw.indexOf("(***)")>=0){ const m = raw.match(/[\d.]+/); return m?parseFloat(m[0]):null; }
  if(/^-?\d+(\.\d+)?$/.test(raw)) return parseFloat(raw);
  const m2 = raw.match(/[\d.]+/);
  return m2?parseFloat(m2[0]):null;
}
function hasilStatusVsStandard(resultNumeric, resultStatus, standard){
  if(resultNumeric==null || (resultStatus!=="measured" && resultStatus!=="below_detection")) return "not_evaluated";
  if(standard==null) return "not_applicable";
  return resultNumeric > standard ? "exceed" : "ok";
}
function hasilPeriodParts(p){
  const m = (p||"").match(/S(\d)\s*(\d{4})/);
  if(!m) return {sem:null, tahun:null, order:null};
  const sem = Number(m[1]), tahun = Number(m[2]);
  return {sem, tahun, order: tahun*2+(sem-1)};
}
const HASIL_SITE_MAP = {BKP:"BEKAPAI", PCK:"SPS"};
function hasilBuildRecord(r, idx, engineLookup){
  const cerobong = (r["NAMA CEROBONG (SK NO 2020)"]||"").trim();
  const periode = (r["PERIODE"]||"").trim();
  const {sem, tahun, order} = hasilPeriodParts(periode);
  if(!cerobong || order==null) return null;
  const res = hasilParseResult(r["RESULT"]);
  if(res.status==="not_sampled") return null;

  const eng = engineLookup[cerobong];
  const std13 = hasilParseStandard(r["STANDARD PERMEN LH 13 2009"]);
  const std11 = hasilParseStandard(r["STANDAR PERMEN LH 11 2021"]);
  const cekPermen = (r["CHCEK PERMEN"]||"").trim();
  let standard = cekPermen.indexOf("13")>=0 ? std13 : (cekPermen.indexOf("11")>=0 ? std11 : (std13!=null?std13:std11));

  const STATUS_MAP = {"OK":"ok","Melebihi Baku Mutu":"exceed","N/A":"not_applicable","":"not_evaluated"};
  const rawStatus = (r["CEK BAKU MUTU VS RESULT"]||"").trim();
  let statusBm = STATUS_MAP[rawStatus] !== undefined ? STATUS_MAP[rawStatus] : "not_evaluated";
  if((statusBm==="not_evaluated"||statusBm==="not_applicable") && res.numeric!=null && standard!=null && (res.status==="measured"||res.status==="below_detection")){
    statusBm = res.numeric > standard ? "exceed" : "ok";
  }
  if((res.status==="measured"||res.status==="below_detection") && standard==null) statusBm = "not_applicable";
  if(res.status==="declaration"||res.status==="other"){ if(statusBm!=="ok" && statusBm!=="exceed") statusBm = "not_evaluated"; }

  let pct = null;
  if(res.numeric!=null && standard) pct = Math.round((res.numeric/standard*100)*10)/10;

  let site = (r["SITE"]||"").trim();
  site = HASIL_SITE_MAP[site] || site;

  return {
    id: "HPI_"+uid("x"),
    engineId: eng ? eng.id : null,
    cerobong, site,
    namaSumber: (r["NAMA SUMBER EMISI"]||"").trim(),
    kategoriKapasitas: (r["KATEGORI KAPASITAS"]||"").trim(),
    jenisBahanBakar: (r["JENIS BAHAN BAKAR"]||"").trim(),
    periode, semester: sem, tahun, periodeOrder: order,
    parameter: (r["PARAMETER"]||"").trim(),
    unit: (r["UNIT"]||"").trim(),
    resultRaw: res.raw, resultNumeric: res.numeric, resultStatus: res.status,
    dateOfSampling: hasilParseDate(r["DATE OF SAMPLING"]),
    runningHour: (r["RUNNING HOUR (1 Tahun kebelakang)"]!=null && r["RUNNING HOUR (1 Tahun kebelakang)"]!=="") ? parseFloat(r["RUNNING HOUR (1 Tahun kebelakang)"]) : null,
    standard, pctOfStandard: pct,
    regulasiCek: cekPermen, statusBakuMutu: statusBm,
    metode: (r["Metode"]||"").trim(),
    keterangan: (r["KETERANGAN"]||"").trim(),
    remarks: (r["REMARKS"]||"").trim()
  };
}
// Header LENGKAP (termasuk kolom yg selalu kosong di app ini spt LATITUDE/KAPASITAS/ALAT
// PENGENDALI dst — bukan bagian dari skema internal DB.hasilPemantauan) tetap DITERIMA saat
// import, supaya file asli dari sumber lain (mis. file induk lab yg field-nya lebih lengkap)
// tetap bisa langsung dipakai tanpa perlu dirapikan manual dulu — kolom yg tidak dikenal cukup
// diabaikan. Export/Template APP INI SENDIRI cuma memuat kolom yg benar" dipakai (HASIL_XLSX_HEADERS
// di bawah), supaya tidak menghasilkan file kosong-kosong spt keluhan CSV lama.
const HASIL_XLSX_HEADERS = ["NAMA CEROBONG (SK NO 2020)","SITE","NAMA SUMBER EMISI","KATEGORI KAPASITAS","JENIS BAHAN BAKAR","PERIODE","PARAMETER","UNIT","RESULT","DATE OF SAMPLING","RUNNING HOUR (1 Tahun kebelakang)","STANDARD PERMEN LH 13 2009","STANDAR PERMEN LH 11 2021","CHCEK PERMEN","CEK BAKU MUTU VS RESULT","Metode","KETERANGAN","REMARKS"];
function importHasilXlsx(){
  xlsxImport(wb=>{
    const ws = wb.Sheets["Hasil Pemantauan"] || wb.Sheets[wb.SheetNames[0]];
    const rows = xlsxSheetToRows(ws);
    const engineLookup = {}; DB.points.forEach(p=>{ if(p.kategori==="emisi") engineLookup[p.nama.trim()] = p; });
    let added = 0;
    rows.forEach((r,i)=>{
      const rec = hasilBuildRecord(r, i, engineLookup);
      if(rec){ DB.hasilPemantauan.push(rec); added++; }
    });
    touchDataset("hasilPemantauan"); save();
    toast(`Import selesai: ${added} baris data hasil pemantauan ditambahkan.`, "ok");
    renderHasilDb();
  });
}
function hasilRowForExport(r){
  const REV_STATUS = {ok:"OK", exceed:"Melebihi Baku Mutu", not_applicable:"N/A", not_evaluated:""};
  return {
    "NAMA CEROBONG (SK NO 2020)": r.cerobong, "SITE": r.site, "NAMA SUMBER EMISI": r.namaSumber,
    "KATEGORI KAPASITAS": r.kategoriKapasitas, "JENIS BAHAN BAKAR": r.jenisBahanBakar,
    "PERIODE": r.periode, "PARAMETER": r.parameter, "UNIT": r.unit, "RESULT": r.resultRaw,
    "DATE OF SAMPLING": r.dateOfSampling, "RUNNING HOUR (1 Tahun kebelakang)": r.runningHour!=null?r.runningHour:"",
    "STANDARD PERMEN LH 13 2009": r.regulasiCek.indexOf("13")>=0 ? (r.standard!=null?r.standard:"") : "",
    "STANDAR PERMEN LH 11 2021": r.regulasiCek.indexOf("11")>=0 ? (r.standard!=null?r.standard:"") : "",
    "CHCEK PERMEN": r.regulasiCek, "CEK BAKU MUTU VS RESULT": REV_STATUS[r.statusBakuMutu] || "",
    "Metode": r.metode, "KETERANGAN": r.keterangan, "REMARKS": r.remarks
  };
}
function exportHasilXlsx(){
  const wb = xlsxWorkbookFromSheets([["Hasil Pemantauan", xlsxSheetFromRows(HASIL_XLSX_HEADERS, DB.hasilPemantauan.map(hasilRowForExport))]]);
  xlsxDownload(wb, "hasil_pemantauan_export.xlsx");
}
function downloadTemplateHasilXlsx(){
  const wb = xlsxWorkbookFromSheets([["Hasil Pemantauan", xlsxSheetFromRows(HASIL_XLSX_HEADERS, [])]]);
  xlsxDownload(wb, "template_hasil_pemantauan.xlsx");
}
function resetHasilData(){
  askConfirm("Reset Database Hasil Pemantauan ke data default (kembali ke dataset awal, semua data yang kamu import akan hilang)?", ()=>{
    DB.hasilPemantauan = [...DEFAULT_HASIL_PEMANTAUAN];
    save(); toast("Database Hasil Pemantauan direset ke default.","ok"); renderHasilDb();
  });
}

/* =========================================================
   HASIL PEMANTAUAN — Tambah/Edit/Hapus manual (satu baris), alternatif dari import Excel
========================================================= */
const HASIL_STATUS_OVERRIDE_LABEL = {"":"Otomatis (hitung dari Hasil vs Baku Mutu)", ok:"Memenuhi Baku Mutu", exceed:"Melebihi Baku Mutu", not_applicable:"Tidak Ada Baku Mutu", not_evaluated:"Belum Dievaluasi"};
function hasilFormHtml(rec){
  rec = rec || {id:"", cerobong:"", site:"", namaSumber:"", kategoriKapasitas:"", jenisBahanBakar:"", periode:"", parameter:"", unit:"", resultRaw:"", dateOfSampling:"", runningHour:null, standard:null, regulasiCek:"", statusOverride:"", metode:"", keterangan:"", remarks:""};
  const emisiPoints = DB.points.filter(p=>p.kategori==="emisi").sort((a,b)=> a.site===b.site ? a.nama.localeCompare(b.nama) : a.site.localeCompare(b.site));
  const paramList = [...new Set(DB.hasilPemantauan.map(r=>r.parameter))].filter(Boolean).sort();
  const periodeList = [...new Set(DB.hasilPemantauan.map(r=>r.periode))].filter(Boolean).sort((a,b)=>hasilPeriodParts(a).order-hasilPeriodParts(b).order);
  const permenList = [...new Set(DB.hasilPemantauan.map(r=>r.regulasiCek))].filter(Boolean).sort();
  return `
  <h3>${rec.id?"Edit":"Tambah"} Data Hasil Pemantauan</h3>
  <div class="grid cols-2">
    <div class="field"><label>Cerobong (Titik Emisi)</label>
      <select id="h_cerobongSel">
        <option value="">- pilih dari Database Titik Pantau, atau isi manual di bawah -</option>
        ${emisiPoints.map(p=>`<option value="${escHtml(p.nama)}" ${rec.cerobong===p.nama?"selected":""}>${escHtml(p.site)} — ${escHtml(p.nama)}</option>`).join("")}
      </select>
    </div>
    <div class="field"><label>Nama Cerobong (bebas, kalau tidak ada di daftar)</label><input type="text" id="h_cerobong" value="${escHtml(rec.cerobong)}"></div>
  </div>
  <div class="grid cols-2" style="margin-top:10px;">
    <div class="field"><label>Site</label><input type="text" id="h_site" value="${escHtml(rec.site)}" placeholder="mis. SPU"></div>
    <div class="field"><label>Nama/Jenis Sumber</label><input type="text" id="h_namaSumber" value="${escHtml(rec.namaSumber)}" placeholder="mis. Flare, Turbin Gas"></div>
  </div>
  <div class="grid cols-2" style="margin-top:10px;">
    <div class="field"><label>Kategori Kapasitas</label><input type="text" id="h_kategoriKapasitas" value="${escHtml(rec.kategoriKapasitas)}"></div>
    <div class="field"><label>Jenis Bahan Bakar</label><input type="text" id="h_jenisBahanBakar" value="${escHtml(rec.jenisBahanBakar)}"></div>
  </div>
  <div class="grid cols-2" style="margin-top:10px;">
    <div class="field"><label>Periode</label><input type="text" id="h_periode" value="${escHtml(rec.periode)}" placeholder="mis. S1 2026" list="h_periodeList"><datalist id="h_periodeList">${periodeList.map(p=>`<option value="${escHtml(p)}">`).join("")}</datalist></div>
    <div class="field"><label>Tanggal Sampling</label><input type="date" id="h_tanggal" value="${escHtml(rec.dateOfSampling)}"></div>
  </div>
  <div class="grid cols-2" style="margin-top:10px;">
    <div class="field"><label>Parameter</label><input type="text" id="h_parameter" value="${escHtml(rec.parameter)}" list="h_paramList"><datalist id="h_paramList">${paramList.map(p=>`<option value="${escHtml(p)}">`).join("")}</datalist></div>
    <div class="field"><label>Satuan</label><input type="text" id="h_unit" value="${escHtml(rec.unit)}" placeholder="mis. mg/Nm³"></div>
  </div>
  <div class="grid cols-2" style="margin-top:10px;">
    <div class="field"><label>Hasil (Result)</label><input type="text" id="h_result" value="${escHtml(rec.resultRaw)}" placeholder="mis. 120, &lt;20, atau Surat Pernyataan"></div>
    <div class="field"><label>Baku Mutu</label><input type="number" step="any" id="h_standard" value="${rec.standard!=null?rec.standard:""}"></div>
  </div>
  <div class="grid cols-2" style="margin-top:10px;">
    <div class="field"><label>Regulasi (Cek Permen)</label><input type="text" id="h_regulasi" value="${escHtml(rec.regulasiCek)}" list="h_permenList" placeholder="mis. PERMEN LH 13 2009"><datalist id="h_permenList">${permenList.map(p=>`<option value="${escHtml(p)}">`).join("")}</datalist></div>
    <div class="field"><label>Status Baku Mutu</label><select id="h_statusOverride">${Object.keys(HASIL_STATUS_OVERRIDE_LABEL).map(k=>`<option value="${k}" ${(rec.statusOverride||"")===k?"selected":""}>${HASIL_STATUS_OVERRIDE_LABEL[k]}</option>`).join("")}</select></div>
  </div>
  <div class="grid cols-2" style="margin-top:10px;">
    <div class="field"><label>Running Hour (1 tahun terakhir)</label><input type="number" step="any" id="h_runningHour" value="${rec.runningHour!=null?rec.runningHour:""}"></div>
    <div class="field"><label>Metode</label><input type="text" id="h_metode" value="${escHtml(rec.metode)}"></div>
  </div>
  <div class="grid cols-2" style="margin-top:10px;">
    <div class="field"><label>Keterangan</label><input type="text" id="h_keterangan" value="${escHtml(rec.keterangan)}"></div>
    <div class="field"><label>Remarks</label><input type="text" id="h_remarks" value="${escHtml(rec.remarks)}"></div>
  </div>
  <div class="actions">
    <button class="btn ghost" data-action="closeModal">Batal</button>
    <button class="btn primary" data-action="saveHasil" data-id="${rec.id}">Simpan</button>
  </div>`;
}
function addHasil(){ openModal(hasilFormHtml(null)); }
function editHasil(id){
  const r = DB.hasilPemantauan.find(x=>x.id===id); if(!r) return;
  openModal(hasilFormHtml({...r, resultRaw:r.resultRaw, statusOverride:""}));
}
document.addEventListener("change", e=>{
  if(e.target.id!=="h_cerobongSel") return;
  const p = DB.points.find(x=>x.kategori==="emisi" && x.nama===e.target.value);
  document.getElementById("h_cerobong").value = e.target.value;
  if(p){
    document.getElementById("h_site").value = p.site;
    document.getElementById("h_namaSumber").value = p.kategoriSumber||"";
    document.getElementById("h_kategoriKapasitas").value = p.kategoriKapasitas||"";
    document.getElementById("h_jenisBahanBakar").value = p.jenisBahanBakar||"";
  }
});
function saveHasil(id){
  const cerobong = (document.getElementById("h_cerobongSel").value || document.getElementById("h_cerobong").value).trim();
  const periode = document.getElementById("h_periode").value.trim();
  const parameter = document.getElementById("h_parameter").value.trim();
  if(!cerobong || !periode || !parameter){ toast("Cerobong, Periode, dan Parameter wajib diisi.","err"); return; }
  const {sem, tahun, order} = hasilPeriodParts(periode);
  if(order==null){ toast('Format Periode harus "S1 2026" atau "S2 2026".',"err"); return; }
  const res = hasilParseResult(document.getElementById("h_result").value);
  const standardEl = document.getElementById("h_standard").value;
  const standard = standardEl===""? null : Number(standardEl);
  const pct = (res.numeric!=null && standard) ? Math.round((res.numeric/standard*100)*10)/10 : null;
  const override = document.getElementById("h_statusOverride").value;
  const statusBm = override || hasilStatusVsStandard(res.numeric, res.status, standard);
  const eng = DB.points.find(p=>p.kategori==="emisi" && p.nama===cerobong);
  const rhEl = document.getElementById("h_runningHour").value;
  const val = {
    engineId: eng?eng.id:null, cerobong, site: document.getElementById("h_site").value.trim(),
    namaSumber: document.getElementById("h_namaSumber").value.trim(), kategoriKapasitas: document.getElementById("h_kategoriKapasitas").value.trim(),
    jenisBahanBakar: document.getElementById("h_jenisBahanBakar").value.trim(),
    periode, semester: sem, tahun, periodeOrder: order,
    parameter, unit: document.getElementById("h_unit").value.trim(),
    resultRaw: res.raw, resultNumeric: res.numeric, resultStatus: res.status,
    dateOfSampling: document.getElementById("h_tanggal").value,
    runningHour: rhEl===""?null:Number(rhEl),
    standard, pctOfStandard: pct,
    regulasiCek: document.getElementById("h_regulasi").value.trim(), statusBakuMutu: statusBm,
    metode: document.getElementById("h_metode").value.trim(), keterangan: document.getElementById("h_keterangan").value.trim(),
    remarks: document.getElementById("h_remarks").value.trim()
  };
  if(id){ Object.assign(DB.hasilPemantauan.find(r=>r.id===id), val); }
  else { DB.hasilPemantauan.push({id:"HPI_"+uid("x"), ...val}); }
  touchDataset("hasilPemantauan"); save(); closeModal(); renderHasilDb();
  toast(id?"Data diperbarui.":"Data ditambahkan.","ok");
}
function deleteHasil(id){
  askConfirm("Hapus baris data hasil pemantauan ini?", ()=>{
    DB.hasilPemantauan = DB.hasilPemantauan.filter(r=>r.id!==id);
    touchDataset("hasilPemantauan"); save(); renderHasilDb(); toast("Data dihapus.","ok");
  });
}

/* =========================================================
   HASIL PEMANTAUAN — Database page
========================================================= */
const HASIL_STATUS_BADGE = {
  ok: ["b-green","Memenuhi Baku Mutu"], exceed: ["b-red","Melebihi Baku Mutu"],
  not_applicable: ["b-gray","Tidak Ada Baku Mutu"], not_evaluated: ["b-amber","Belum Dievaluasi"]
};
function hasilPopulateCommonFilters(prefix){
  const sites = [...new Set(DB.hasilPemantauan.map(r=>r.site))].sort();
  const params = [...new Set(DB.hasilPemantauan.map(r=>r.parameter))].sort();
  const periods = [...new Set(DB.hasilPemantauan.map(r=>r.periode))].sort((a,b)=>hasilPeriodParts(a).order-hasilPeriodParts(b).order);
  const siteSel = document.getElementById(prefix+"FltSite");
  if(siteSel){ const cur=siteSel.value; siteSel.innerHTML = '<option value="">Semua</option>'+sites.map(s=>`<option value="${s}">${s}</option>`).join(""); siteSel.value=cur; }
  const paramSel = document.getElementById(prefix+"FltParameter");
  if(paramSel){ const cur=paramSel.value; paramSel.innerHTML = (prefix==="hdb"?'<option value="">Semua</option>':'')+params.map(p=>`<option value="${escHtml(p)}">${escHtml(p)}</option>`).join(""); if(cur) paramSel.value=cur; }
  const perSel = document.getElementById(prefix+"FltPeriode");
  if(perSel){ const cur=perSel.value; perSel.innerHTML = '<option value="">Semua</option>'+periods.map(p=>`<option value="${p}">${p}</option>`).join(""); perSel.value=cur; }
  return {sites, params, periods};
}
function renderHasilDb(){
  hasilPopulateCommonFilters("hdb");
  const site = document.getElementById("hdbFltSite").value;
  const periode = document.getElementById("hdbFltPeriode").value;
  const parameter = document.getElementById("hdbFltParameter").value;
  const status = document.getElementById("hdbFltStatus").value;
  const q = document.getElementById("hdbFltSearch").value.toLowerCase();

  let rows = DB.hasilPemantauan.filter(r=>{
    if(site && r.site!==site) return false;
    if(periode && r.periode!==periode) return false;
    if(parameter && r.parameter!==parameter) return false;
    if(status && r.statusBakuMutu!==status) return false;
    if(q && !r.cerobong.toLowerCase().includes(q)) return false;
    return true;
  }).sort((a,b)=> b.periodeOrder-a.periodeOrder || a.site.localeCompare(b.site) || a.cerobong.localeCompare(b.cerobong));

  document.getElementById("hasildbTable").innerHTML = `
    <thead><tr><th>Cerobong</th><th>Site</th><th>Periode</th><th>Tanggal</th><th>Parameter</th><th>Hasil</th><th>Satuan</th><th>Baku Mutu</th><th>% BM</th><th>Status</th><th>Metode</th><th></th></tr></thead>
    <tbody>${rows.map(r=>{
      const badge = HASIL_STATUS_BADGE[r.statusBakuMutu] || HASIL_STATUS_BADGE.not_evaluated;
      return `<tr>
        <td>${escHtml(r.cerobong)}</td><td>${r.site}</td><td>${r.periode}</td><td class="muted">${r.dateOfSampling||"-"}</td>
        <td>${escHtml(r.parameter)}</td><td style="font-family:var(--font-mono);">${escHtml(r.resultRaw)}</td><td class="muted">${escHtml(r.unit)}</td>
        <td class="muted">${r.standard!=null?r.standard:"-"}</td><td class="muted">${r.pctOfStandard!=null?r.pctOfStandard+"%":"-"}</td>
        <td><span class="badge ${badge[0]}">${badge[1]}</span></td>
        <td class="muted" style="font-size:11px;">${escHtml(r.metode)}</td>
        <td style="white-space:nowrap;"><button class="btn small ghost" data-action="editHasil" data-id="${r.id}">Edit</button> <button class="btn small danger" data-action="deleteHasil" data-id="${r.id}">Hapus</button></td>
      </tr>`;
    }).join("")}</tbody>`;
  document.getElementById("hasildbCount").textContent = rows.length+" dari "+DB.hasilPemantauan.length+" baris data ditampilkan.";
}
["hdbFltSite","hdbFltPeriode","hdbFltParameter","hdbFltStatus","hdbFltSearch"].forEach(id=>{
  document.addEventListener("input", e=>{ if(e.target.id===id) renderHasilDb(); });
  document.addEventListener("change", e=>{ if(e.target.id===id) renderHasilDb(); });
});

