/* =========================================================
   HASIL EMISI — data "given" dari tools (auto-isi), template/import Excel lewat review,
   dan dashboard ringkas kelengkapan data vs titik wajib pantau.
   Dipakai bersama oleh import Excel (13/33) dan pembaca PDF CoA/SHU (34-coa-reader.js):
   keduanya menghasilkan "sampel" yang direview dulu di halaman Import Hasil Emisi sebelum
   benar-benar masuk ke DB.hasilPemantauan.
========================================================= */

// Parameter kanonik = nama yang dipakai di Database Hasil Emisi (lihat data default).
// kind: main = parameter baku mutu (dibandingkan dgn BM), field = parameter pendukung (field data CoA),
// extra = data lapangan tambahan (tidak wajib, default tidak ikut diimport).
const HE_PARAMS = {
  "NOx":              {unit:"mg/Nm³", kind:"main"},
  "SO₂":              {unit:"mg/Nm³", kind:"main"},
  "CO":               {unit:"mg/Nm³", kind:"main"},
  "Total Partikulat": {unit:"mg/Nm³", kind:"main"},
  "Opasitas":         {unit:"%",      kind:"main"},
  "H2S":              {unit:"%",      kind:"main"},
  "O₂":               {unit:"%",      kind:"field"},
  "CO₂":              {unit:"%",      kind:"field"},
  "Gas Temperatur":   {unit:"oC",     kind:"field"},
  "Laju Alir (v)":    {unit:"m3/s",   kind:"field"},
  "Kecepatan Gas":    {unit:"m/s",    kind:"extra"},
  "Kadar Air":        {unit:"%",      kind:"extra"},
  "Isokinetik":       {unit:"%",      kind:"extra"}
};
const HE_SUPPORT_PARAMS = ["O₂","CO₂","Gas Temperatur","Laju Alir (v)"];
// Ejaan lain (Excel lama, kolom parameter titik, hasil OCR) -> nama kanonik
function heCanonParam(s){
  const t = String(s||"").trim(); if(!t) return "";
  if(HE_PARAMS[t]) return t;
  const k = t.toLowerCase().replace(/[₂]/g,"2").replace(/\s+/g," ");
  if(/^(nox|no x|nitrogen ox)/.test(k)) return "NOx";
  if(/^(so2|so 2|sulf|sulph)/.test(k)) return "SO₂";
  if(/^(co2|co 2|carbon diox|karbon diok)/.test(k)) return "CO₂";
  if(/^(co|carbon monox|karbon monok)\b/.test(k)) return "CO";
  if(/partikulat|particulate|^tp$|^pm$/.test(k)) return "Total Partikulat";
  if(/opasitas|opacity/.test(k)) return "Opasitas";
  if(/^h2s|hydrogen sulf|hidrogen sulf/.test(k)) return "H2S";
  if(/^o2|^o 2|oxygen|oksigen/.test(k)) return "O₂";
  if(/temperat/.test(k)) return "Gas Temperatur";
  if(/laju alir|flow ?rate/.test(k)) return "Laju Alir (v)";
  if(/velocity|kecepatan/.test(k)) return "Kecepatan Gas";
  if(/moisture|kadar air/.test(k)) return "Kadar Air";
  if(/isokinet/.test(k)) return "Isokinetik";
  return t;
}
function heIsFuelQuality(p){ return p && p.kategoriSumber===KATEGORI_SUMBER_FUEL_QUALITY; }
// Parameter WAJIB satu titik emisi = kolom "parameter" di Database Titik Pantau (mis. "NOx, CO, SO2").
function heRequiredParams(p){
  if(!p) return [];
  const list = String(p.parameter||"").split(/[,;/]+/).map(heCanonParam).filter(Boolean);
  if(list.length) return [...new Set(list)];
  const g = pointRegGroup(p);
  if(heIsFuelQuality(p)) return ["H2S"];
  if(g==="flare") return ["Opasitas"];
  if(g==="turbin") return ["NOx"];
  if(g==="heater") return ["NOx","Opasitas"];
  return ["NOx","CO"];
}
// Parameter PENDUKUNG (field data CoA) — hanya utk sumber bercerobong (bukan flare / uji H2S fuel gas).
function heSupportParams(p){
  if(!p || heIsFuelQuality(p) || pointRegGroup(p)==="flare") return [];
  return HE_SUPPORT_PARAMS.slice();
}
// Regulasi dlm format kolom "CHCEK PERMEN" Database Hasil Emisi.
function heRegulasi(p){
  const r = String(p && p.regulasi || "");
  if(/11\s*\/?\s*2021/.test(r)) return "PERMEN LH 11 2021";
  if(/13\s*\/?\s*2009/.test(r)) return "PERMEN LH 13 2009";
  return p && pointRegGroup(p)==="genset" ? "PERMEN LH 11 2021" : "PERMEN LH 13 2009";
}
// Baku mutu per regulasi (sama dgn tabel di Laporan EMF / halaman Baku Mutu).
const HE_BM_P13 = {
  turbin: {gas:{"NOx":320,"SO₂":150,"Total Partikulat":50}, minyak:{"NOx":450,"SO₂":650,"Total Partikulat":100,"Opasitas":20}},
  heater: {gas:{"NOx":400,"SO₂":150,"Total Partikulat":50,"Opasitas":20}, minyak:{"NOx":800,"SO₂":1200,"Total Partikulat":150,"Opasitas":20}},
  flare:  {gas:{"Opasitas":40}, minyak:{"Opasitas":40}}
};
const HE_BM_P11 = {
  "100-500":   {minyak:{"NOx":3400,"CO":170}, gas:{"NOx":300,"CO":450}},
  "500-1000":  {minyak:{"Total Partikulat":95,"SO₂":160,"NOx":1850,"CO":77}, gas:{"SO₂":150,"NOx":300,"CO":250}},
  "1000-3000": {minyak:{"Total Partikulat":90,"SO₂":120,"NOx":2300,"CO":168}, gas:{"SO₂":60,"NOx":285,"CO":250}}
};
const HE_BM_H2S = 0.5;   // % berat sulfur fuel gas (Pasal 12 ayat 2 huruf b Permen LH 13/2009)
// Baku mutu satu parameter utk satu titik. Urutan sumber: (1) catatan parameter titik itu sendiri
// ("NOx maks 300 mg/Nm³" di Database Titik Pantau), (2) tabel regulasi menurut jenis/kapasitas/bahan
// bakar, (3) baku mutu terakhir yg pernah tercatat utk cerobong+parameter yg sama. Parameter pendukung
// (O₂, CO₂, suhu, laju alir) memang tanpa baku mutu -> null.
function heBakuMutu(p, param){
  const info = HE_PARAMS[param];
  if(info && info.kind!=="main") return {value:null, src:"Parameter pendukung — tanpa baku mutu"};
  if(!p) return {value:null, src:"Titik belum dipilih"};
  if(param==="H2S") return heIsFuelQuality(p) ? {value:HE_BM_H2S, src:"Permen LH 13/2009 Ps.12(2)b — sulfur fuel gas 0,5%"} : {value:null, src:"H2S hanya dipantau di titik fuel gas"};
  const cat = String(p.parameterCatatan||"").replace(/&sup3;/g,"³");
  const re = /(NOx|CO|SO2|SO₂|Total Partikulat|Opasitas)\s+maks\s+([\d.,]+)/gi; let m;
  while((m = re.exec(cat))){ if(heCanonParam(m[1])===param) return {value:Number(m[2].replace(",",".")), src:"Catatan parameter di Database Titik Pantau"}; }
  const g = pointRegGroup(p), fuel = regKeyFuel(p.jenisBahanBakar) || "gas";
  let v = null, src = "";
  if(g==="genset"){ const band = regKeyBand(p.kapasitasKW); const t = band && HE_BM_P11[band]; if(t && t[fuel] && t[fuel][param]!=null){ v = t[fuel][param]; src = `Permen LHK 11/2021 — ${band} kW, ${fuel}`; } }
  else if(HE_BM_P13[g] && HE_BM_P13[g][fuel] && HE_BM_P13[g][fuel][param]!=null){ v = HE_BM_P13[g][fuel][param]; src = `Permen LH 13/2009 — ${g}, ${fuel}`; }
  if(v!=null) return {value:v, src};
  const hist = DB.hasilPemantauan.filter(r=>(r.engineId===p.id || r.cerobong===p.nama) && r.parameter===param && r.standard!=null).sort((a,b)=>b.periodeOrder-a.periodeOrder)[0];
  if(hist) return {value:hist.standard, src:`Riwayat ${hist.periode}`};
  return {value:null, src:"Tidak dipersyaratkan utk sumber ini"};
}
function heFrekuensiText(p){
  if(heIsFuelQuality(p)) return "Kandungan sulfur bahan bakar sesuai Pasal 12 ayat (2) huruf b Permen LH 13/2009, pengganti baku mutu SO2 numerik untuk Turbin/Heater/Glycol Reboiler";
  const m = Number(p && p.frekuensiBulan);
  if(!m) return "";
  return m % 12 === 0 ? `${m/12} tahun sekali` : `${m} bulan sekali`;
}
function heRemarksText(p, param){
  if(!p) return "";
  if(HE_PARAMS[param] && HE_PARAMS[param].kind!=="main"){
    const reg = heRegulasi(p)==="PERMEN LH 11 2021" ? "Permen LH 11 Tahun 2021" : "Permen LH 13 Tahun 2009";
    return `Berdasarkan ${reg}, Sumber emisi ini tidak dipersyaratkan untuk memantau parameter tersebut.`;
  }
  return heRequiredParams(p).includes(param) ? "Dipantau" : "";
}
// Running hour 12 bulan ke belakang dari riwayat bulanan (halaman Running Hour), sama dgn kolom
// "Trailing 12 Bln" di sana.
function heRunningHour(p, periode){
  if(!p || heIsFuelQuality(p) || !periode) return null;
  const v = trailingRhSum(p.nama, periode);
  return v==null || isNaN(v) ? null : Math.round(v*100)/100;
}
// Identitas sumber (site, jenis, kapasitas, bahan bakar) — ikut ejaan riwayat cerobong yang sama
// kalau ada (supaya filter Dashboard Hasil Emisi tetap konsisten), selain itu dari Database Titik Pantau.
function heIdentity(p){
  const last = DB.hasilPemantauan.filter(r=>r.engineId===p.id || r.cerobong===p.nama).sort((a,b)=>b.periodeOrder-a.periodeOrder)[0];
  return {
    cerobong: last ? last.cerobong : p.nama, site: p.site,
    namaSumber: last ? last.namaSumber : (p.kategoriSumber||""),
    kategoriKapasitas: last ? last.kategoriKapasitas : (p.kategoriKapasitas||""),
    jenisBahanBakar: last ? last.jenisBahanBakar : (p.jenisBahanBakar||"")
  };
}
function hePeriodeOfDate(iso){ const r = periodOfDateStr(iso); return r ? r.label : ""; }

// Tanggal dlm berbagai format (Inggris/Indonesia, angka, objek Date Excel) -> YYYY-MM-DD
const HE_MONTHS = {jan:1,january:1,januari:1,feb:2,february:2,februari:2,mar:3,march:3,maret:3,apr:4,april:4,may:5,mei:5,jun:6,june:6,juni:6,jul:7,july:7,juli:7,aug:8,august:8,agu:8,agt:8,agustus:8,ags:8,sep:9,sept:9,september:9,oct:10,october:10,okt:10,oktober:10,nov:11,november:11,nop:11,nopember:11,dec:12,december:12,des:12,desember:12};
function heParseDateAny(v){
  if(v instanceof Date) return xlsxDateToIso(v);
  if(typeof v==="number" && v>20000 && v<80000){ const d = new Date(Date.UTC(1899,11,30) + v*86400000); return xlsxDateToIso(d); }
  const s = String(v||"").trim(); if(!s) return "";
  // Rentang ("August 26 up to August 27, 2026", "26 - 27 Agustus 2026") -> tanggal mulai
  let r = s.match(/([A-Za-z]{3,10})\.?\s+(\d{1,2})\s*(?:up\s*to|to|until|s\.?\s*\/?\s*d\.?|sampai|hingga|[-–—])\s*(?:[A-Za-z]{3,10}\.?\s+)?\d{1,2}\s*[,.]?\s*(\d{4})/i);
  if(r && HE_MONTHS[r[1].toLowerCase()]) return heIso(+r[3], HE_MONTHS[r[1].toLowerCase()], +r[2]);
  r = s.match(/(\d{1,2})\s*(?:up\s*to|to|s\.?\s*\/?\s*d\.?|sampai|hingga|[-–—])\s*\d{1,2}\s+([A-Za-z]{3,10})\.?\s*[,.]?\s*(\d{4})/i);
  if(r && HE_MONTHS[r[2].toLowerCase()]) return heIso(+r[3], HE_MONTHS[r[2].toLowerCase()], +r[1]);
  let m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/); if(m) return heIso(+m[1],+m[2],+m[3]);
  m = s.match(/(\d{1,2})\s*[\/.\-]\s*(\d{1,2})\s*[\/.\-]\s*(\d{4})/); if(m) return heIso(+m[3],+m[2],+m[1]);
  m = s.match(/(\d{1,2})\s*[-\s.]\s*([A-Za-z]{3,10})\.?[\s,\-.]*(\d{4})/); if(m && HE_MONTHS[m[2].toLowerCase()]) return heIso(+m[3], HE_MONTHS[m[2].toLowerCase()], +m[1]);
  m = s.match(/([A-Za-z]{3,10})\.?\s+(\d{1,2})\s*[,.]?\s*(\d{4})/); if(m && HE_MONTHS[m[1].toLowerCase()]) return heIso(+m[3], HE_MONTHS[m[1].toLowerCase()], +m[2]);
  return hasilParseDate(s);
}
function heIso(y,mo,d){ if(!(y>1990 && y<2100 && mo>=1 && mo<=12 && d>=1 && d<=31)) return ""; return `${y}-${String(mo).padStart(2,"0")}-${String(d).padStart(2,"0")}`; }

// Pencocokan nama sampel di CoA -> titik emisi. Huruf/angka yg sering tertukar saat OCR (B/8, O/0,
// I/1, S/5, Z/2) disamakan dulu supaya "P 83008" hasil scan tetap ketemu "P 8300B".
function heNormName(s){ return String(s||"").toUpperCase().replace(/[^A-Z0-9]/g,""); }
function heFoldOcr(s){ return heNormName(s).replace(/B/g,"8").replace(/[OQD]/g,"0").replace(/[IL]/g,"1").replace(/S/g,"5").replace(/Z/g,"2").replace(/G/g,"6"); }
function heBigrams(s){ const out = new Map(); for(let i=0;i<s.length-1;i++){ const b = s.slice(i,i+2); out.set(b,(out.get(b)||0)+1); } return out; }
function heDice(a, b){
  if(!a || !b) return 0; if(a===b) return 1;
  const A = heBigrams(a), B = heBigrams(b); let inter = 0;
  A.forEach((n,k)=>{ if(B.has(k)) inter += Math.min(n, B.get(k)); });
  return 2*inter/((a.length-1)+(b.length-1) || 1);
}
function heMatchPoint(name, kategori){
  const pts = DB.points.filter(p=>p.kategori===(kategori||"emisi"));
  const n = heNormName(name), f = heFoldOcr(name);
  if(!n) return {point:null, score:0, candidates:[]};
  const scored = pts.map(p=>{
    const pn = heNormName(p.nama), pf = heFoldOcr(p.nama);
    let s = pn===n ? 1 : pf===f ? 0.97 : Math.max(heDice(n, pn), heDice(f, pf)*0.95);
    if(s<1 && (pn.includes(n) || n.includes(pn)) && Math.min(pn.length, n.length)>=4) s = Math.max(s, 0.85);
    return {p, s};
  }).sort((a,b)=>b.s-a.s);
  const best = scored[0];
  return {point: best && best.s>=0.62 ? best.p : null, score: best ? best.s : 0, candidates: scored.slice(0,6).map(x=>({id:x.p.id, s:x.s}))};
}

// Satu baris siap simpan ke DB.hasilPemantauan (skema sama dgn import Excel & form manual).
function heMakeRecord(o){
  const {sem, tahun, order} = hasilPeriodParts(o.periode);
  const res = hasilParseResult(o.resultRaw);
  const standard = o.standard==="" || o.standard==null || isNaN(Number(o.standard)) ? null : Number(o.standard);
  const pct = (res.numeric!=null && standard) ? Math.round((res.numeric/standard*100)*10)/10 : null;
  return {
    engineId: o.engineId||null, cerobong: o.cerobong, site: o.site||"",
    namaSumber: o.namaSumber||"", kategoriKapasitas: o.kategoriKapasitas||"", jenisBahanBakar: o.jenisBahanBakar||"",
    periode: o.periode, semester: sem, tahun, periodeOrder: order,
    parameter: o.parameter, unit: o.unit||"",
    resultRaw: res.raw, resultNumeric: res.numeric, resultStatus: res.status,
    dateOfSampling: o.dateOfSampling||"", runningHour: o.runningHour==null||o.runningHour==="" ? null : Number(o.runningHour),
    standard, pctOfStandard: pct, regulasiCek: o.regulasiCek||"",
    statusBakuMutu: hasilStatusVsStandard(res.numeric, res.status, standard),
    metode: o.metode||"", keterangan: o.keterangan||"", remarks: o.remarks||"",
    ...(o.sumberDokumen ? {sumberDokumen: o.sumberDokumen} : {})
  };
}

/* ---------- Kelengkapan data hasil vs titik wajib pantau / sudah disampling ---------- */
function heSampledIn(p, periode){
  if(!p.batchId) return false;
  const b = DB.batches.find(x=>x.id===p.batchId);
  const t = DB.tracking[p.id];
  return !!(b && b.period===periode && t && t.samplingStatus==="sampled");
}
function heParamsWithData(p, periode){
  return new Set(DB.hasilPemantauan.filter(r=>r.periode===periode && (r.engineId===p.id || (!r.engineId && r.cerobong===p.nama))).map(r=>heCanonParam(r.parameter)));
}
function heCompleteness(periode){
  const items = [];
  DB.points.filter(p=>p.kategori==="emisi").forEach(p=>{
    const have = heParamsWithData(p, periode);
    const wajib = effectiveWajib(p, periode) && isDueThisPeriod(p, periode);
    const sampled = heSampledIn(p, periode);
    if(!wajib && !sampled && !have.size) return;
    const req = heRequiredParams(p), sup = heSupportParams(p);
    const reqHave = req.filter(x=>have.has(x)), supHave = sup.filter(x=>have.has(x));
    const status = reqHave.length===req.length ? "lengkap" : (have.size ? "sebagian" : "kosong");
    items.push({p, wajib, sampled, req, sup, reqHave, supHave, have, status,
      reason: wajib ? (sampled ? "Wajib · sudah disampling" : "Wajib pantau") : (sampled ? "Sudah disampling" : "Ada data hasil")});
  });
  const sum = k=>items.reduce((a,x)=>a+x[k].length,0);
  return {periode, items,
    total: items.length, lengkap: items.filter(x=>x.status==="lengkap").length,
    sebagian: items.filter(x=>x.status==="sebagian").length, kosong: items.filter(x=>x.status==="kosong").length,
    reqTotal: sum("req"), reqHave: sum("reqHave"), supTotal: sum("sup"), supHave: sum("supHave")};
}
let heCompPeriode = "", heCompOpen = false;
function heCompPeriodOptions(){
  const set = new Set(DB.hasilPemantauan.map(r=>r.periode).filter(Boolean));
  set.add(currentPeriodStr());
  DB.batches.forEach(b=>{ if(b.period) set.add(b.period); });
  return [...set].filter(p=>hasilPeriodParts(p).order!=null).sort((a,b)=>hasilPeriodParts(b).order-hasilPeriodParts(a).order);
}
function heCompletenessCardHtml(){
  const opts = heCompPeriodOptions();
  if(!heCompPeriode || !opts.includes(heCompPeriode)) heCompPeriode = currentPeriodStr();
  const c = heCompleteness(heCompPeriode);
  const pct = (a,b)=> b ? Math.round(a/b*100) : 0;
  const incomplete = c.items.filter(x=>x.status!=="lengkap" || x.supHave.length<x.sup.length)
    .sort((a,b)=> ({kosong:0,sebagian:1,lengkap:2}[a.status]-{kosong:0,sebagian:1,lengkap:2}[b.status]) || a.p.site.localeCompare(b.p.site) || a.p.nama.localeCompare(b.p.nama));
  const chip = (x, ok)=>`<span class="hec-chip ${ok?"ok":"miss"}">${ok?"&#10003;":"&#10007;"} ${escHtml(x)}</span>`;
  return `<section class="card hec-card" aria-label="Kelengkapan data hasil emisi">
    <div class="hec-head">
      <div><div class="hec-eyebrow">Kelengkapan data</div><h3>Hasil emisi yang wajib masuk &middot; ${escHtml(c.periode)}</h3>
        <div class="hec-sub">Target = titik wajib pantau yang jatuh tempo (Roadmap Wajib Pantau), titik yang sudah disampling di batch periode ini, atau yang sudah punya data.</div></div>
      <div class="hec-tools"><label class="hec-lbl" for="hecPeriode">Periode</label><select id="hecPeriode">${opts.map(o=>`<option value="${escHtml(o)}" ${o===c.periode?"selected":""}>${escHtml(o)}${o===currentPeriodStr()?" (aktif)":""}</option>`).join("")}</select>
        <button type="button" class="btn small primary" data-action="goToPage" data-page="coareader">Baca CoA/SHU (PDF)</button></div>
    </div>
    <div class="hec-kpis">
      <div class="hec-kpi"><b>${c.total}</b><span>titik target</span></div>
      <div class="hec-kpi good"><b>${c.lengkap}</b><span>lengkap</span></div>
      <div class="hec-kpi warn"><b>${c.sebagian}</b><span>sebagian</span></div>
      <div class="hec-kpi bad"><b>${c.kosong}</b><span>belum ada data</span></div>
      <div class="hec-bar-wrap"><div class="hec-bar-lbl"><span>Parameter wajib terisi</span><b>${c.reqHave}/${c.reqTotal} &middot; ${pct(c.reqHave,c.reqTotal)}%</b></div><div class="hec-bar"><i style="width:${pct(c.reqHave,c.reqTotal)}%"></i></div>
        <div class="hec-bar-lbl"><span>Parameter pendukung (O₂, CO₂, suhu, laju alir)</span><b>${c.supHave}/${c.supTotal} &middot; ${pct(c.supHave,c.supTotal)}%</b></div><div class="hec-bar sup"><i style="width:${pct(c.supHave,c.supTotal)}%"></i></div></div>
    </div>
    ${incomplete.length ? `<details class="hec-list" ${heCompOpen?"open":""} id="hecDetails"><summary>${incomplete.length} titik belum lengkap — lihat parameter yang belum masuk</summary>
      <div class="hec-table-wrap"><table class="hec-table"><thead><tr><th>Site</th><th>Titik / cerobong</th><th>Jenis sumber</th><th>Target karena</th><th>Parameter wajib</th><th>Pendukung</th></tr></thead><tbody>
      ${incomplete.map(x=>`<tr class="st-${x.status}"><td>${escHtml(x.p.site)}</td><td><b>${escHtml(x.p.nama)}</b></td><td class="muted">${escHtml(x.p.kategoriSumber||"-")}</td><td class="muted">${escHtml(x.reason)}</td>
        <td>${x.req.map(r=>chip(r, x.have.has(r))).join("")}</td><td>${x.sup.length ? x.sup.map(r=>chip(r, x.have.has(r))).join("") : `<span class="muted">—</span>`}</td></tr>`).join("")}
      </tbody></table></div></details>` : `<div class="hec-allok">Semua titik target di ${escHtml(c.periode)} sudah lengkap datanya.</div>`}
  </section>`;
}
function renderHasilCompleteness(){
  const el = document.getElementById("hasilCompleteness"); if(!el) return;
  el.innerHTML = heCompletenessCardHtml();
  const d = document.getElementById("hecDetails"); if(d) d.addEventListener("toggle", ()=>{ heCompOpen = d.open; });
}
document.addEventListener("change", e=>{
  if(e.target.id==="hecPeriode"){ heCompPeriode = e.target.value; renderHasilCompleteness(); }
});

/* ---------- Template / export / import Excel ---------- */
// Status kolom template: W = wajib diisi, A = otomatis dari tools (boleh dikosongkan), O = opsional.
const HE_XLSX_COLS = [
  {h:"NAMA CEROBONG (SK NO 2020)", s:"W", w:30, note:"Nama titik/cerobong persis seperti di Database Titik Pantau (pilih dari daftar). Dipakai untuk mengambil semua data otomatis di bawah."},
  {h:"PARAMETER", s:"W", w:18, note:"Nama parameter: NOx, SO₂, CO, Total Partikulat, Opasitas, H2S, atau pendukung O₂, CO₂, Gas Temperatur, Laju Alir (v)."},
  {h:"RESULT", s:"W", w:14, note:"Hasil uji. Boleh angka (141.3), di bawah deteksi (<26.2), notasi pangkat (3.1 x 10^-3), atau \"Surat Pernyataan\". Untuk emisi cerobong pakai konsentrasi TERKOREKSI O₂."},
  {h:"DATE OF SAMPLING", s:"W", w:16, note:"Tanggal sampling. Format bebas: 29-Aug-2026, 29/08/2026, August 29, 2026, atau tanggal Excel."},
  {h:"PERIODE", s:"A", w:11, note:"Otomatis dari tanggal sampling (Jan–Jun = S1, Jul–Des = S2). Isi manual hanya jika tanggal kosong."},
  {h:"UNIT", s:"A", w:10, note:"Otomatis dari parameter (mg/Nm³, %, oC, m3/s)."},
  {h:"SITE", s:"A", w:8, note:"Otomatis dari Database Titik Pantau."},
  {h:"NAMA SUMBER EMISI", s:"A", w:26, note:"Otomatis (jenis sumber) dari Database Titik Pantau / riwayat cerobong."},
  {h:"KATEGORI KAPASITAS", s:"A", w:18, note:"Otomatis dari Database Titik Pantau / riwayat cerobong."},
  {h:"JENIS BAHAN BAKAR", s:"A", w:12, note:"Otomatis dari Database Titik Pantau."},
  {h:"RUNNING HOUR (1 Tahun kebelakang)", s:"A", w:14, note:"Otomatis: total 12 bulan sebelum periode, dari riwayat bulanan di halaman Running Hour."},
  {h:"STANDARD PERMEN LH 13 2009", s:"A", w:14, note:"Otomatis: baku mutu sesuai regulasi titik (Permen LH 13/2009). Kosongkan saja."},
  {h:"STANDAR PERMEN LH 11 2021", s:"A", w:14, note:"Otomatis: baku mutu sesuai regulasi titik (Permen LHK 11/2021). Kosongkan saja."},
  {h:"CHCEK PERMEN", s:"A", w:18, note:"Otomatis: regulasi yang berlaku untuk titik."},
  {h:"CEK BAKU MUTU VS RESULT", s:"A", w:16, note:"Otomatis: dibandingkan hasil vs baku mutu saat import."},
  {h:"Metode", s:"O", w:20, note:"Metode uji (mis. SNI 19-7117.5-2005, PO/BPP-LP/34). Kosong = ikut metode riwayat cerobong yang sama."},
  {h:"KETERANGAN", s:"O", w:18, note:"Kosong = otomatis frekuensi pemantauan (mis. 6 bulan sekali)."},
  {h:"REMARKS", s:"O", w:22, note:"Kosong = otomatis (Dipantau / catatan parameter pendukung)."}
];
const HE_XLSX_GROUP = {W:{label:"WAJIB DIISI", fill:"B42318", soft:"FDECEA"}, A:{label:"OTOMATIS — boleh dikosongkan, diisi tools", fill:"0B7F7B", soft:"E3F4F3"}, O:{label:"OPSIONAL", fill:"64748B", soft:"F1F5F9"}};
// Workbook bergaya sederhana (multi-sheet) — pakai registri style & ZIP yg sama dgn export WBS.
function heXlsxBlob(sheets){
  const ST = xsStyles();
  const sheetXml = sheets.map(sh=>{
    const rows = sh.rows.map((cells, ri)=>{
      const r = ri+1;
      const cx = cells.map((c, ci)=>{
        if(c==null) return "";
        const ref = `${xsCol(ci)}${r}`, s = c.st ? ST.style(c.st) : 0;
        if(c.v==null || c.v==="") return `<c r="${ref}" s="${s}"/>`;
        if(c.t==="n") return `<c r="${ref}" s="${s}"><v>${c.v}</v></c>`;
        return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${xsEsc(c.v)}</t></is></c>`;
      }).join("");
      const ht = sh.heights && sh.heights[ri] ? ` ht="${sh.heights[ri]}" customHeight="1"` : "";
      return `<row r="${r}"${ht}>${cx}</row>`;
    }).join("");
    const ncol = Math.max(1, ...sh.rows.map(r=>r.length));
    const cols = `<cols>${sh.widths.map((w,i)=>`<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join("")}</cols>`;
    const pane = sh.freeze ? `<pane ${sh.freeze.x?`xSplit="${sh.freeze.x}" `:""}ySplit="${sh.freeze.y}" topLeftCell="${xsCol(sh.freeze.x||0)}${sh.freeze.y+1}" activePane="${sh.freeze.x?"bottomRight":"bottomLeft"}" state="frozen"/>` : "";
    const merges = sh.merges && sh.merges.length ? `<mergeCells count="${sh.merges.length}">${sh.merges.map(m=>`<mergeCell ref="${m}"/>`).join("")}</mergeCells>` : "";
    const af = sh.autoFilter ? `<autoFilter ref="${sh.autoFilter}"/>` : "";
    const dv = sh.validations && sh.validations.length ? `<dataValidations count="${sh.validations.length}">${sh.validations.map(v=>`<dataValidation type="list" allowBlank="1" showErrorMessage="0" sqref="${v.sqref}"><formula1>${xsEsc(v.formula)}</formula1></dataValidation>`).join("")}</dataValidations>` : "";
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${xsCol(ncol-1)}${Math.max(1,sh.rows.length)}"/><sheetViews><sheetView workbookViewId="0"${sh.tab?' tabSelected="1"':""}>${pane}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${rows}</sheetData>${af}${merges}${dv}<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`;
  });
  const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const files = [
    {name:"[Content_Types].xml", data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((s,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`},
    {name:"_rels/.rels", data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`},
    {name:"xl/workbook.xml", data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${REL}"><sheets>${sheets.map((s,i)=>`<sheet name="${xsEsc(s.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join("")}</sheets>${sheets.some(s=>s.autoFilter)?`<definedNames>${sheets.map((s,i)=>s.autoFilter?`<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${xsEsc(s.name)}'!$${s.autoFilter.replace(/(\D+)(\d+):(\D+)(\d+)/,"$1$$$2:$$$3$$$4")}</definedName>`:"").join("")}</definedNames>`:""}</workbook>`},
    {name:"xl/_rels/workbook.xml.rels", data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((s,i)=>`<Relationship Id="rId${i+1}" Type="${REL}/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length+1}" Type="${REL}/styles" Target="styles.xml"/></Relationships>`},
    ...sheetXml.map((x,i)=>({name:`xl/worksheets/sheet${i+1}.xml`, data:x})),
    {name:"xl/styles.xml", data:ST.xml()}
  ];
  return new Blob([dxZip(files)], {type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
}
// Sheet utama "Hasil Pemantauan": baris 1 = pita WAJIB/OTOMATIS/OPSIONAL, baris 2 = header, data mulai baris 3.
// extraCols: kolom tambahan di kanan (mis. info review dari pembaca CoA) — diabaikan saat import.
function heMainSheet(dataRows, extraCols){
  extraCols = extraCols || [];
  const cols = HE_XLSX_COLS.concat(extraCols.map(c=>({h:c.h, s:"X", w:c.w||18})));
  const GRID = "CBD5E1";
  const band = [], head = [], merges = [];
  let runStart = 0;
  cols.forEach((c,i)=>{
    const g = HE_XLSX_GROUP[c.s] || {label:"INFO REVIEW (tidak diimport)", fill:"334155"};
    band.push({v: (i===0 || cols[i-1].s!==c.s) ? g.label : "", st:{b:true, sz:9, color:"FFFFFF", fill:g.fill, border:GRID, h:"center"}});
    head.push({v:c.h, st:{b:true, sz:9, color:"0F172A", fill:(HE_XLSX_GROUP[c.s]||{soft:"E2E8F0"}).soft, border:GRID, h:"center", wrap:true}});
    if(!cols[i+1] || cols[i+1].s!==c.s){ if(i>runStart) merges.push(`${xsCol(runStart)}1:${xsCol(i)}1`); runStart = i+1; }
  });
  const rows = [band, head];
  dataRows.forEach(r=>{
    rows.push(cols.map(c=>{
      const v = r[c.h];
      const st = {sz:9, border:GRID, ...(r.__styles && r.__styles[c.h] || {})};
      if(c.h==="DATE OF SAMPLING" && v && /^\d{4}-\d{2}-\d{2}$/.test(v)) return {v: xsSerial(v), t:"n", st:{...st, num:"date", h:"left"}};
      if(typeof v==="number" && isFinite(v)) return {v, t:"n", st};
      if(typeof v==="string" && /^-?\d+(\.\d+)?$/.test(v.trim()) && c.s!=="X") return {v:Number(v), t:"n", st};
      return {v: v==null ? "" : String(v), st};
    }));
  });
  const nRef = Math.max(rows.length, 400);
  return {name:"Hasil Pemantauan", tab:true, rows, widths: cols.map(c=>c.w), heights:{0:20, 1:32}, merges, freeze:{y:2, x:1},
    autoFilter:`A2:${xsCol(cols.length-1)}${Math.max(3, rows.length)}`,
    validations:[
      {sqref:`A3:A${nRef}`, formula:`'Referensi Titik'!$A$3:$A$${2+DB.points.filter(p=>p.kategori==="emisi").length}`},
      {sqref:`B3:B${nRef}`, formula:`"${Object.keys(HE_PARAMS).filter(k=>HE_PARAMS[k].kind!=="extra").join(",")}"`}
    ]};
}
function heGuideSheet(){
  const rows = [
    [{v:"Petunjuk Template Import Hasil Emisi", st:{b:true, sz:13, color:"12294A"}}],
    [{v:"Cukup isi 4 kolom WAJIB per baris (satu baris = satu parameter). Kolom OTOMATIS boleh dikosongkan — saat import, tools mengisinya dari Database Titik Pantau, riwayat Running Hour, dan tabel baku mutu regulasi. Semua baris tampil dulu di halaman review (bisa diedit) sebelum benar-benar masuk database.", st:{sz:9, color:"334155", wrap:true}}],
    [],
    ["Kolom","Status","Keterangan / sumber data otomatis"].map(v=>({v, st:{b:true, sz:9, color:"FFFFFF", fill:"12294A", border:"94A3B8"}}))
  ];
  HE_XLSX_COLS.forEach(c=>{
    const g = HE_XLSX_GROUP[c.s];
    rows.push([{v:c.h, st:{b:true, sz:9, border:"CBD5E1"}}, {v:{W:"WAJIB",A:"OTOMATIS",O:"OPSIONAL"}[c.s], st:{b:true, sz:9, color:"FFFFFF", fill:g.fill, border:"CBD5E1", h:"center"}}, {v:c.note, st:{sz:9, border:"CBD5E1", wrap:true}}]);
  });
  rows.push([], [{v:"Parameter yang dikenali", st:{b:true, sz:10, color:"12294A"}}]);
  Object.keys(HE_PARAMS).filter(k=>HE_PARAMS[k].kind!=="extra").forEach(k=>rows.push([{v:k, st:{sz:9, border:"CBD5E1"}}, {v:HE_PARAMS[k].kind==="main"?"Baku mutu":"Pendukung", st:{sz:9, border:"CBD5E1", h:"center"}}, {v:`Satuan default ${HE_PARAMS[k].unit}`, st:{sz:9, border:"CBD5E1"}}]));
  return {name:"Petunjuk", rows, widths:[34,14,110], merges:["A1:C1","A2:C2"], heights:{1:42}};
}
function heRefSheet(){
  const periode = currentPeriodStr();
  const heads = ["Nama Cerobong","Site","Jenis Sumber","Kategori Kapasitas","Bahan Bakar","Regulasi","Parameter Wajib","Parameter Pendukung","BM NOx","BM SO₂","BM CO","BM Total Partikulat","BM Opasitas","BM H2S (%)",`Wajib Pantau ${periode}`,`RH 12 bln (s.d. ${periode})`];
  const rows = [[{v:`Referensi titik emisi — data yang otomatis dipakai saat import (periode aktif ${periode})`, st:{b:true, sz:11, color:"12294A"}}],
    heads.map(h=>({v:h, st:{b:true, sz:9, color:"FFFFFF", fill:"0B7F7B", border:"94A3B8", wrap:true, h:"center"}}))];
  DB.points.filter(p=>p.kategori==="emisi").sort((a,b)=>a.site.localeCompare(b.site)||a.nama.localeCompare(b.nama)).forEach(p=>{
    const bm = k=>{ const v = heBakuMutu(p, k).value; return v==null ? {v:"", st:{sz:9, border:"E2E8F0"}} : {v, t:"n", st:{sz:9, border:"E2E8F0", h:"center"}}; };
    const rh = heRunningHour(p, periode);
    const st = {sz:9, border:"E2E8F0"};
    rows.push([{v:p.nama, st:{...st, b:true}}, {v:p.site, st}, {v:p.kategoriSumber||"", st}, {v:p.kategoriKapasitas||"", st}, {v:p.jenisBahanBakar||"", st}, {v:heRegulasi(p), st},
      {v:heRequiredParams(p).join(", "), st}, {v:heSupportParams(p).join(", "), st},
      bm("NOx"), bm("SO₂"), bm("CO"), bm("Total Partikulat"), bm("Opasitas"), bm("H2S"),
      {v:effectiveWajib(p, periode) ? "Ya" : "Tidak", st:{...st, h:"center"}}, rh==null ? {v:"", st} : {v:rh, t:"n", st}]);
  });
  return {name:"Referensi Titik", rows, widths:[30,8,30,18,11,18,30,34,9,9,9,12,11,11,14,14], merges:["A1:H1"], heights:{1:30}, freeze:{y:2, x:1}, autoFilter:`A2:P${rows.length}`};
}
function heTemplateRows(){
  // 3 baris contoh supaya format jelas (boleh dihapus) — ambil titik nyata dari database.
  const p = DB.points.find(x=>x.kategori==="emisi" && pointRegGroup(x)==="turbin") || DB.points.find(x=>x.kategori==="emisi");
  if(!p) return [];
  const soft = {fill:"FFFBEB", color:"92400E"};
  const ex = (param, result)=>({"NAMA CEROBONG (SK NO 2020)":p.nama, "PARAMETER":param, "RESULT":result, "DATE OF SAMPLING":todayStr(), "REMARKS":"(contoh — hapus baris ini)",
    __styles:{"NAMA CEROBONG (SK NO 2020)":soft, "PARAMETER":soft, "RESULT":soft, "DATE OF SAMPLING":soft, "REMARKS":soft}});
  return [ex("NOx", 141.3), ex("O₂", 16.7), ex("Gas Temperatur", 453.2)];
}
function downloadTemplateHasilXlsx(){
  const blob = heXlsxBlob([heMainSheet(heTemplateRows()), heGuideSheet(), heRefSheet()]);
  downloadBlob(blob, "template_hasil_pemantauan_emisi.xlsx", blob.type);
  toast("Template diunduh: isi kolom merah (wajib), kolom hijau otomatis diisi tools saat import.", "ok");
}
function exportHasilXlsx(){
  const rows = DB.hasilPemantauan.slice().sort((a,b)=>b.periodeOrder-a.periodeOrder || a.site.localeCompare(b.site) || a.cerobong.localeCompare(b.cerobong)).map(hasilRowForExport);
  const blob = heXlsxBlob([heMainSheet(rows), heGuideSheet(), heRefSheet()]);
  downloadBlob(blob, "hasil_pemantauan_emisi_export.xlsx", blob.type);
}
// Baris header bisa di baris 1 (file lama/sumber lain) atau baris 2 (template baru dgn pita status).
const HE_HEADER_ALIAS = {"NAMA CEROBONG":"NAMA CEROBONG (SK NO 2020)", "CEROBONG":"NAMA CEROBONG (SK NO 2020)", "SAMPLE IDENTIFICATION":"NAMA CEROBONG (SK NO 2020)",
  "HASIL":"RESULT", "HASIL UJI":"RESULT", "TANGGAL SAMPLING":"DATE OF SAMPLING", "TANGGAL":"DATE OF SAMPLING", "SATUAN":"UNIT", "METODE":"Metode", "RUNNING HOUR":"RUNNING HOUR (1 Tahun kebelakang)"};
function heSheetRows(ws){
  const arr = XLSX.utils.sheet_to_json(ws, {header:1, defval:"", raw:true});
  let hi = arr.slice(0,10).findIndex(r=>{ const u = r.map(c=>String(c).trim().toUpperCase()); return u.includes("PARAMETER") && (u.includes("RESULT") || u.includes("HASIL") || u.includes("HASIL UJI")); });
  if(hi<0) return [];
  const known = new Set(HE_XLSX_COLS.map(c=>c.h));
  const heads = arr[hi].map(h=>{ const t = String(h).trim(); if(known.has(t)) return t; const u = t.toUpperCase(); const k = [...known].find(x=>x.toUpperCase()===u); return k || HE_HEADER_ALIAS[u] || t; });
  return arr.slice(hi+1).filter(r=>r.some(c=>String(c).trim()!=="")).map(r=>{ const o = {}; heads.forEach((h,i)=>{ if(h) o[h] = r[i]; }); return o; });
}
// Import Excel -> sampel review (dikelompokkan per cerobong + tanggal/periode), bukan langsung masuk DB.
// Baris sheet "Hasil Pemantauan" (emisi) -> sampel review, dikelompokkan per cerobong + tanggal/periode.
// Import Excel sendiri (emisi/ambien sekaligus) ada di importHasilAnyXlsx (35-ambien-import.js).
function heSamplesFromRows(rows){
  const groups = new Map();
  rows.forEach(r=>{
    const name = String(r["NAMA CEROBONG (SK NO 2020)"]||"").trim();
    const date = heParseDateAny(r["DATE OF SAMPLING"]);
    const periode = String(r["PERIODE"]||"").trim() || hePeriodeOfDate(date);
    const key = name+"|"+(date||periode);
    if(!groups.has(key)) groups.set(key, {name, date, periode, rows:[]});
    groups.get(key).rows.push(r);
  });
  return [...groups.values()].map(g=>coaSampleFromExcel(g));
}
function importHasilXlsx(){ importHasilAnyXlsx(); }
