/* =========================================================
   HASIL PEMANTAUAN — parsing helper (dipakai import CSV)
========================================================= */
const HASIL_MONTHS = {Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12};
function hasilParseDate(s){
  s = (s||"").trim(); if(!s) return "";
  const m = s.match(/^(\d{1,2})-(\w{3})-(\d{4})/);
  if(!m) return "";
  const mm = HASIL_MONTHS[m[2]]; if(!mm) return "";
  return `${m[3]}-${String(mm).padStart(2,"0")}-${String(Number(m[1])).padStart(2,"0")}`;
}
function hasilParseResult(raw){
  raw = (raw||"").trim();
  if(!raw || /^N\/A/i.test(raw)) return {raw, numeric:null, status:"not_sampled"};
  if(raw==="Surat Pernyataan") return {raw, numeric:null, status:"declaration"};
  if(raw.startsWith("<")){ const m = raw.match(/[\d.]+/); return {raw, numeric: m?parseFloat(m[0]):null, status:"below_detection"}; }
  if(/^-?\d+(\.\d+)?$/.test(raw)) return {raw, numeric: parseFloat(raw), status:"measured"};
  const m2 = raw.match(/[\d.]+/);
  return {raw, numeric: m2?parseFloat(m2[0]):null, status:"other"};
}
function hasilParseStandard(raw){
  raw = (raw||"").trim();
  if(!raw || /^N\/A$/i.test(raw)) return null;
  if(raw.indexOf("(***)")>=0){ const m = raw.match(/[\d.]+/); return m?parseFloat(m[0]):null; }
  if(/^-?\d+(\.\d+)?$/.test(raw)) return parseFloat(raw);
  const m2 = raw.match(/[\d.]+/);
  return m2?parseFloat(m2[0]):null;
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
    runningHour: r["RUNNING HOUR (1 Tahun kebelakang)"] ? parseFloat(r["RUNNING HOUR (1 Tahun kebelakang)"]) : null,
    standard, pctOfStandard: pct,
    regulasiCek: cekPermen, statusBakuMutu: statusBm,
    metode: (r["Metode"]||"").trim(),
    keterangan: (r["KETERANGAN"]||"").trim(),
    remarks: (r["REMARKS"]||"").trim()
  };
}
const HASIL_CSV_HEADERS = ["No","NAMA CEROBONG (SK NO 2020)","SITE","NAMA SUMBER EMISI","LATITUDE","LONGITUDE","JENIS SUMBER EMISI","KAPASITAS","KAPASITAS (KW)","KATEGORI KAPASITAS","ALAT PENGENDALI","JENIS BAHAN BAKAR","JENIS SUMBER EMISI-2","STATUS PEMANTAUAN","KETERANGAN","SIMPEL PPU","PERIODE","PARAMETER","UNIT","RESULT","DATE OF SAMPLING","RUNNING HOUR (1 Tahun kebelakang)","STANDARD PERMEN LH 13 2009","STANDAR PERMEN LH 11 2021","Metode","CODE REMARK","REMARKS","CHCEK PERMEN","CEK BAKU MUTU VS RESULT"];

function importHasilCsv(){
  const inp = document.getElementById("hiddenCsvFile");
  inp.onchange = ()=>{
    const file = inp.files[0]; if(!file) return;
    const reader = new FileReader();
    reader.onload = ()=>{
      try{
        const rows = csvParse(reader.result);
        const engineLookup = {}; DB.points.forEach(p=>{ if(p.kategori==="emisi") engineLookup[p.nama.trim()] = p; });
        let added = 0;
        rows.forEach((r,i)=>{
          const rec = hasilBuildRecord(r, i, engineLookup);
          if(rec){ DB.hasilPemantauan.push(rec); added++; }
        });
        touchDataset("hasilPemantauan"); save();
        toast(`Import selesai: ${added} baris data hasil pemantauan ditambahkan.`, "ok");
        renderHasilDb();
      }catch(err){ toast("Gagal import: "+err.message, "err"); console.error(err); }
    };
    reader.readAsText(file);
    inp.value = "";
  };
  inp.click();
}
function exportHasilCsv(){
  const REV_STATUS = {ok:"OK", exceed:"Melebihi Baku Mutu", not_applicable:"N/A", not_evaluated:""};
  const rows = DB.hasilPemantauan.map(r=>({
    "No":"", "NAMA CEROBONG (SK NO 2020)": r.cerobong, "SITE": r.site, "NAMA SUMBER EMISI": r.namaSumber,
    "LATITUDE":"", "LONGITUDE":"", "JENIS SUMBER EMISI":"", "KAPASITAS":"", "KAPASITAS (KW)":"",
    "KATEGORI KAPASITAS": r.kategoriKapasitas, "ALAT PENGENDALI":"", "JENIS BAHAN BAKAR": r.jenisBahanBakar,
    "JENIS SUMBER EMISI-2":"", "STATUS PEMANTAUAN":"", "KETERANGAN": r.keterangan, "SIMPEL PPU":"",
    "PERIODE": r.periode, "PARAMETER": r.parameter, "UNIT": r.unit, "RESULT": r.resultRaw,
    "DATE OF SAMPLING": r.dateOfSampling, "RUNNING HOUR (1 Tahun kebelakang)": r.runningHour!=null?r.runningHour:"",
    "STANDARD PERMEN LH 13 2009": r.regulasiCek.indexOf("13")>=0 ? (r.standard!=null?r.standard:"") : "",
    "STANDAR PERMEN LH 11 2021": r.regulasiCek.indexOf("11")>=0 ? (r.standard!=null?r.standard:"") : "",
    "Metode": r.metode, "CODE REMARK":"", "REMARKS": r.remarks, "CHCEK PERMEN": r.regulasiCek,
    "CEK BAKU MUTU VS RESULT": REV_STATUS[r.statusBakuMutu] || ""
  }));
  csvExport(HASIL_CSV_HEADERS, rows, "hasil_pemantauan_export.csv");
}
function downloadTemplateHasil(){ csvExport(HASIL_CSV_HEADERS, [], "template_hasil_pemantauan.csv"); }
function resetHasilData(){
  askConfirm("Reset Database Hasil Pemantauan ke data default (kembali ke dataset awal, semua data yang kamu import akan hilang)?", ()=>{
    DB.hasilPemantauan = [...DEFAULT_HASIL_PEMANTAUAN];
    save(); toast("Database Hasil Pemantauan direset ke default.","ok"); renderHasilDb();
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
    <thead><tr><th>Cerobong</th><th>Site</th><th>Periode</th><th>Tanggal</th><th>Parameter</th><th>Hasil</th><th>Satuan</th><th>Baku Mutu</th><th>% BM</th><th>Status</th><th>Metode</th></tr></thead>
    <tbody>${rows.map(r=>{
      const badge = HASIL_STATUS_BADGE[r.statusBakuMutu] || HASIL_STATUS_BADGE.not_evaluated;
      return `<tr>
        <td>${escHtml(r.cerobong)}</td><td>${r.site}</td><td>${r.periode}</td><td class="muted">${r.dateOfSampling||"-"}</td>
        <td>${escHtml(r.parameter)}</td><td style="font-family:var(--font-mono);">${escHtml(r.resultRaw)}</td><td class="muted">${escHtml(r.unit)}</td>
        <td class="muted">${r.standard!=null?r.standard:"-"}</td><td class="muted">${r.pctOfStandard!=null?r.pctOfStandard+"%":"-"}</td>
        <td><span class="badge ${badge[0]}">${badge[1]}</span></td>
        <td class="muted" style="font-size:11px;">${escHtml(r.metode)}</td>
      </tr>`;
    }).join("")}</tbody>`;
  document.getElementById("hasildbCount").textContent = rows.length+" dari "+DB.hasilPemantauan.length+" baris data ditampilkan.";
}
["hdbFltSite","hdbFltPeriode","hdbFltParameter","hdbFltStatus","hdbFltSearch"].forEach(id=>{
  document.addEventListener("input", e=>{ if(e.target.id===id) renderHasilDb(); });
  document.addEventListener("change", e=>{ if(e.target.id===id) renderHasilDb(); });
});

