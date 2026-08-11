/* =========================================================
   PERIODE PEMANTAUAN, RUNNING HOUR BULANAN & LOGIKA EMERGENCY ENGINE
   ---------------------------------------------------------
   Aturan: Emergency Engine (kategoriSumber mengandung "Emergency") baru WAJIB
   dipantau di suatu periode (semester) kalau total running hour 12 bulan
   TERAKHIR SEBELUM periode itu dimulai > 200 jam. Contoh: periode S2 2026
   (mulai Jul-26) memakai jendela Jul-25 s.d. Jun-26 (S2 2025 + S1 2026).
========================================================= */
const MONTH_SHORT_EN = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function monthLabel(year, month0){ return MONTH_SHORT_EN[((month0%12)+12)%12]+"-"+String(year).slice(-2); }
function parsePeriod(str){
  const m = /^S\s*([12])\D*(\d{4})$/i.exec(String(str||"").trim());
  if(!m) return null;
  return {sem:Number(m[1]), year:Number(m[2])};
}
function periodLabel(sem, year){ return "S"+sem+" "+year; }
function currentPeriodStr(){ return periodLabel(Number(String(DB.meta.semester||"S1").replace(/\D/g,""))||1, DB.meta.tahun); }
// Parse teks bebas "S1 2026"/"S2 2026" (format yg dipakai periodLabel & field prediksiBerikutnya/
// pemantauanTerakhir yg diisi manual) jadi {sem,year} numerik supaya bisa dibandingkan urutannya —
// string compare polos ("S1 2026" vs "S2 2025") salah kalau tahunnya beda, jadi wajib lewat sini.
function parsePeriodStr(s){
  const m = String(s||"").trim().match(/^S([12])\s+(\d{4})$/i);
  return m ? {sem:Number(m[1]), year:Number(m[2])} : null;
}
// -1 kalau a sebelum b, 0 kalau sama, 1 kalau a setelah b.
function periodCompare(a, b){
  if(a.year!==b.year) return a.year<b.year ? -1 : 1;
  return a.sem===b.sem ? 0 : (a.sem<b.sem ? -1 : 1);
}
// Titik "wajib pantau" (effectiveWajib) bisa punya siklus lebih panjang dari 1 semester (mis. 3
// tahun) — jadi walau statusnya permanen "wajib", belum tentu JATUH TEMPO di periode aktif ini.
// Dipakai KHUSUS utk checklist verifikasi/rencana per-periode (bukan mengubah arti "wajib" itu
// sendiri di kartu statistik utama Dashboard/Plan Pemantauan lainnya), supaya "titik wajib yang
// perlu dicek periode ini" tidak kecampur dgn titik yg prediksinya masih jauh di masa depan.
// Titik tanpa prediksiBerikutnya terisi dianggap tetap perlu dicek (default aman, bukan disembunyikan).
function isDueThisPeriod(p, period){
  const pred = parsePeriodStr(p.prediksiBerikutnya);
  if(!pred) return true;
  const cur = parsePeriodStr(period);
  if(!cur) return true;
  return periodCompare(pred, cur) <= 0;
}
// Hitung "periode berikutnya" dari sebuah periode + jarak dalam bulan (dibulatkan ke semester
// terdekat — cukup akurat utk siklus 6/12/36 bulan yg semuanya kelipatan semester genap).
function nextPeriodAfter(periodStr, months){
  const cur = parsePeriodStr(periodStr); if(!cur) return "";
  const totalSem = (cur.year*2 + (cur.sem-1)) + Math.max(1, Math.round((Number(months)||6)/6));
  return periodLabel((totalSem%2)+1, Math.floor(totalSem/2));
}
// Label ringkas siklus pemantauan (p.frekuensiBulan) — "1x6 Bln"/"1x1 Thn"/"1x3 Thn" dst, dipakai
// di kolom cetak yang sempit (Panduan Sampling A4). Kelipatan 12 ditulis dalam tahun (lebih ringkas
// & lazim dibaca drpd "1x12 Bln"/"1x36 Bln"), sisanya polos dalam bulan.
function frekuensiLabelShort(months){
  const m = Number(months);
  if(!m) return "-";
  return m % 12 === 0 ? `1x${m/12} Thn` : `1x${m} Bln`;
}
function semesterMonthLabels(sem, year){
  const startMonth0 = sem===1 ? 0 : 6;
  return [0,1,2,3,4,5].map(i=>monthLabel(year, startMonth0+i));
}
// 12 label bulan TEPAT SEBELUM periode dimulai (tidak termasuk bulan pertama periode itu sendiri).
function trailingWindowLabels(period){
  const p = parsePeriod(period); if(!p) return [];
  let y = p.year, m = p.sem===1 ? 0 : 6;
  const labels = [];
  for(let i=0;i<12;i++){
    m -= 1; if(m<0){ m = 11; y -= 1; }
    labels.unshift(monthLabel(y,m));
  }
  return labels;
}
// Label rentang 2 semester yang dipakai jendela trailing 12 bulan, mis. "S2 2025–S1 2026" —
// dipakai supaya kolom "RH (jam)" di berbagai halaman jelas ini RH jam apa/periode mana.
function trailingWindowPeriodLabel(period){
  const p = parsePeriod(period); if(!p) return "";
  if(p.sem===1) return periodLabel(1,p.year-1)+"–"+periodLabel(2,p.year-1);
  return periodLabel(2,p.year-1)+"–"+periodLabel(1,p.year);
}
// Nilai RH/tahun yang ditampilkan di kolom ringkas (Master, picker Planner): trailing 12 bulan
// dari riwayat bulanan kalau ada datanya, jatuh ke RH manual (p.runningHour) kalau tidak.
function rhYearValue(p, period){
  if(p.kategori==="emisi"){
    const v = trailingRhSum(p.nama, period);
    if(v!=null) return v;
  }
  return p.runningHour;
}
function rhColumnLabel(period){
  return `RH/Tahun<div style="font-weight:400;font-size:9px;opacity:.85;">(${escHtml(trailingWindowPeriodLabel(period))})</div>`;
}
function rhSumForLabels(nama, labels){
  const arr = DB.rhMonthly[nama]; if(!arr) return null;
  let sum = 0, any = false;
  labels.forEach(lab=>{
    const idx = DB.rhMonths.indexOf(lab); if(idx<0) return;
    const v = arr[idx];
    if(v!=null && !isNaN(v)){ sum += v; any = true; }
  });
  return any ? Math.round(sum*100)/100 : null;
}
function semesterRhSum(nama, sem, year){ return rhSumForLabels(nama, semesterMonthLabels(sem, year)); }
function trailingRhSum(nama, period){ return rhSumForLabels(nama, trailingWindowLabels(period)); }
// Bulan berisi data terakhir (non-null) untuk satu titik — dipakai sebagai "RH Bulan Terakhir".
function rhLatestKnown(nama){
  const arr = DB.rhMonthly[nama]; if(!arr) return null;
  for(let i=arr.length-1;i>=0;i--){
    if(arr[i]!=null && !isNaN(arr[i])) return {label: DB.rhMonths[i], value: arr[i]};
  }
  return null;
}
// Semua semester yang tercakup data RH saat ini, urut kronologis — dipakai untuk kolom rekap.
function allSemestersInData(){
  const set = new Set();
  (DB.rhMonths||[]).forEach(lab=>{
    const [mm, yy] = lab.split("-");
    const year = 2000+Number(yy);
    const sem = MONTH_SHORT_EN.indexOf(mm) < 6 ? 1 : 2;
    set.add(sem+"|"+year);
  });
  return [...set].map(s=>{ const [sem,year]=s.split("|").map(Number); return {sem,year,label:periodLabel(sem,year)}; })
    .sort((a,b)=> a.year-b.year || a.sem-b.sem);
}
// Daftar periode (semester) untuk dropdown pilihan, +/- N semester dari sekarang.
function listPeriodOptions(back, forward){
  const nowSem = Number(String(DB.meta.semester||"S1").replace(/\D/g,""))||1, nowYear = DB.meta.tahun;
  let idx = 0; // index semester absolut relatif thd sekarang
  const out = [];
  for(let i=-back;i<=forward;i++){
    let sem = nowSem, year = nowYear, k = i;
    // geser k langkah semester dari titik sekarang
    let semAbs = (nowYear*2 + (nowSem-1)) + k;
    year = Math.floor(semAbs/2); sem = (semAbs%2)+1;
    out.push(periodLabel(sem, year));
  }
  return out;
}
// Normalisasi kategoriSumber untuk perbandingan (whitespace ganda, huruf besar/kecil) —
// beberapa data sumber punya spasi ganda/inkonsisten (mis. "Gas Lift  Compressor").
function normKS(s){ return String(s||"").trim().replace(/\s+/g," ").toUpperCase(); }
const CAPACITY_EXEMPT_KW = 100; // di bawah ini dianggap exempt permanen (bukan soal jam operasi)
function isUnder100kW(p){ return p.kapasitasKW!=null && p.kapasitasKW < CAPACITY_EXEMPT_KW; }
const GAS_ENGINE_KS = ["GAS ENGINE GENERATOR","EMERGENCY GAS ENGINE GENERATOR","GAS LIFT COMPRESSOR","GAS BOOSTER COMPRESSOR"];
function isGasEngineKS(ks){ return GAS_ENGINE_KS.indexOf(ks)>=0; }
function isDieselStandbyKS(ks){ return ks.indexOf("DIESEL")>=0; }
function isTurbineKS(ks){ return ks.indexOf("TURBINE")>=0; }

/* =========================================================
   BAKU MUTU — cross-link tabel referensi statis ke Database Titik Pantau
   Hover baris tabel (kapasitas/bahan bakar/parameter) di halaman Baku Mutu & Periode Pantau utk
   lihat titik pantau PHM mana yang match kombinasi itu — dihitung langsung dari DB.points, bukan
   data terpisah, jadi otomatis ikut kalau Database Titik Pantau berubah.
========================================================= */
// Kelompok regulasi satu titik emisi (dipisah dari klasifikasi warna engineTypeInfo yang untuk peta)
function pointRegGroup(p){
  if(p.kategori!=="emisi") return null;
  const ks = normKS(p.kategoriSumber);
  if(isTurbineKS(ks)) return "turbin";
  if(ks.indexOf("FLARE")>=0) return "flare";
  if(ks.indexOf("HEATER")>=0 || ks.indexOf("REBOILER")>=0) return "heater";
  return "genset"; // Diesel/Gas Engine Generator, Pump, Compressor, Fire (Water) Pump — Permen LHK 11/2021
}
function regKeyBand(kw){
  if(kw==null || kw<CAPACITY_EXEMPT_KW) return null;
  if(kw<500) return "100-500";
  if(kw<1000) return "500-1000";
  return "1000-3000";
}
function regKeyFuel(fuel){
  const f = String(fuel||"").toLowerCase();
  if(f.indexOf("gas")>=0) return "gas";
  if(f.indexOf("minyak")>=0 || f.indexOf("solar")>=0 || f.indexOf("diesel")>=0) return "minyak";
  return null;
}
function pointsForRegKey(key){
  const [group, a, b] = key.split("|");
  return DB.points.filter(p=>{
    if(pointRegGroup(p)!==group) return false;
    const fuel = regKeyFuel(p.jenisBahanBakar);
    if(group==="genset") return regKeyBand(p.kapasitasKW)===a && fuel===b;
    return fuel===a;
  });
}
let bmPopoverEl = null;
function bmPopover(){
  if(!bmPopoverEl){
    bmPopoverEl = document.createElement("div");
    bmPopoverEl.className = "bm-popover";
    bmPopoverEl.style.display = "none";
    // Popover di-append ke <body> (bukan di dalam #page-bakumutu), jadi listener hover/scroll di
    // dalamnya harus dipasang langsung di sini — kalau cursor keluar dari popover ini sendiri
    // (bukan pindah balik ke baris tabelnya), baru ditutup.
    bmPopoverEl.addEventListener("mouseleave", bmHidePopover);
    document.body.appendChild(bmPopoverEl);
  }
  return bmPopoverEl;
}
function bmPositionPopover(evt){
  const pop = bmPopover();
  const pad = 14;
  let x = evt.clientX + pad, y = evt.clientY + pad;
  const r = pop.getBoundingClientRect();
  if(x + r.width > window.innerWidth - 10) x = evt.clientX - r.width - pad;
  if(y + r.height > window.innerHeight - 10) y = evt.clientY - r.height - pad;
  pop.style.left = Math.max(8,x)+"px";
  pop.style.top = Math.max(8,y)+"px";
}
function bmShowPopover(tr, evt){
  const key = tr.dataset.regkey;
  if(!key) return;
  const matches = pointsForRegKey(key);
  const pop = bmPopover();
  const body = matches.length
    ? `<ul>${matches.map(p=>`<li><b>${escHtml(p.site)}</b> — ${escHtml(p.nama)} <span class="muted">(${escHtml(p.kapasitas||(p.kapasitasKW!=null?p.kapasitasKW+" kW":"-"))}, ${escHtml(p.jenisBahanBakar||"-")})</span></li>`).join("")}</ul>`
    : `<div class="none">Tidak ada titik pantau PHM saat ini yang match kombinasi ini.</div>`;
  pop.innerHTML = `<div class="t">${matches.length} titik pantau match</div>${body}`;
  pop.style.display = "block";
  bmPositionPopover(evt);
}
function bmHidePopover(){ if(bmPopoverEl) bmPopoverEl.style.display = "none"; }
// Baris ke-2/3/dst dalam satu grup rowspan Kapasitas TIDAK memiliki sel Kapasitas sendiri (sel itu
// milik baris pertama grup, "menjulur" ke bawah lewat rowspan) — akibatnya highlight :hover pada
// baris tsb terlihat "terputus" dari sel Kapasitas di sebelah kirinya (background hover cuma
// menutupi sel yang baris itu miliki). Dicari manual sel rowspan pemiliknya (baris sebelumnya yang
// sel pertamanya punya atribut rowspan), lalu diberi highlight yang sama secara eksplisit lewat JS
// supaya terlihat menyatu, sama seperti saat baris pertama grup itu sendiri yang di-hover.
function bmFindRowspanCell(tr){
  let el = tr;
  while(el){
    const firstTd = el.children[0];
    if(firstTd && firstTd.hasAttribute("rowspan")) return firstTd;
    el = el.previousElementSibling;
  }
  return null;
}
(function(){
  const page = document.getElementById("page-bakumutu");
  page.addEventListener("mouseover", e=>{
    const tr = e.target.closest("tr[data-regkey]");
    if(!tr) return;
    bmShowPopover(tr, e);
    const cell = bmFindRowspanCell(tr);
    if(cell) cell.classList.add("bm-rowspan-hover");
  });
  page.addEventListener("mousemove", e=>{
    if(e.target.closest("tr[data-regkey]")) bmPositionPopover(e);
  });
  page.addEventListener("mouseout", e=>{
    const tr = e.target.closest("tr[data-regkey]");
    if(!tr) return;
    const cell = bmFindRowspanCell(tr);
    if(cell) cell.classList.remove("bm-rowspan-hover");
    const to = e.relatedTarget;
    // Jangan ditutup kalau cursor pindah ke baris data-regkey lain ATAU ke popover itu sendiri
    // (mis. mau scroll daftarnya kalau titik yang match banyak) — popover live di <body>, jadi
    // "keluar" dari baris tabel ke arah popover pun tetap terhitung mouseout di sini.
    const toTr = to && to.closest ? to.closest("tr[data-regkey]") : null;
    const toPopover = to && to.closest ? to.closest(".bm-popover") : null;
    if(toTr !== tr && !toPopover) bmHidePopover();
  });
})();
// Emergency Engine (untuk aturan wajib-pantau RH>200 jam/tahun) = semua genset/pompa diesel
// standby (Diesel Engine Generator/Pump/Fire Pump/Fire Water Pump/Compressor, termasuk yang
// ber-notasi "Emergency" eksplisit) DAN genset gas ber-notasi "Emergency" — kecuali yang
// kapasitasnya <100 kW (exempt permanen, lihat isUnder100kW). Gas Engine non-emergency (GEG/GEK/
// 1-U-xxxx produksi) TIDAK termasuk kategori ini — itu masuk grup "Gas Engine" tersendiri.
function isEmergencyEngine(p){
  if(p.kategori!=="emisi") return false;
  if(isUnder100kW(p)) return false;
  const ks = normKS(p.kategoriSumber);
  return ks.indexOf("EMERGENCY")>=0 || isDieselStandbyKS(ks);
}
const RH_WAJIB_THRESHOLD = 200; // jam/tahun — di atas ini Emergency Engine wajib dipantau
// Alasan wajib/tidaknya satu titik dipantau, untuk periode tertentu.
// type: "nonop" | "reguler" | "emergency-triggered" | "emergency-exempt" | "not-wajib"
function wajibReason(p, period){
  period = period || currentPeriodStr();
  if(p.tidakBeroperasi) return {type:"nonop"};
  if(p.wajib) return {type:"reguler"};
  if(isEmergencyEngine(p)){
    const rh = trailingRhSum(p.nama, period);
    return {type: (rh!=null && rh>RH_WAJIB_THRESHOLD) ? "emergency-triggered" : "emergency-exempt", rh, period};
  }
  return {type:"not-wajib"};
}
function effectiveWajib(p, period){
  const r = wajibReason(p, period);
  return r.type==="reguler" || r.type==="emergency-triggered";
}
// Periode (semester) tempat sebuah tanggal jatuh — dipakai untuk menebak "sudah dipantau periode ini?"
function periodOfDateStr(dateStr){
  if(!dateStr) return null;
  const [y,m] = dateStr.split("-").map(Number);
  if(!y||!m) return null;
  const sem = m<=6 ? 1 : 2;
  return {sem, year:y, label:periodLabel(sem,y)};
}
function openPeriodModal(){
  openModal(`<h3>Ubah Periode Pemantauan Aktif</h3>
    <p class="hint">Periode ini dipakai untuk nama batch baru, status "Wajib Pantau" di Database Titik Pantau &amp; Plan Pemantauan, dan jendela 12 bulan cek ambang RH Emergency Engine (200 jam/tahun).</p>
    <div class="grid cols-2">
      <div class="field"><label>Semester</label><select id="f_periodSem">
        <option value="S1" ${DB.meta.semester==="S1"?"selected":""}>S1 (Jan–Jun)</option>
        <option value="S2" ${DB.meta.semester==="S2"?"selected":""}>S2 (Jul–Des)</option>
      </select></div>
      <div class="field"><label>Tahun</label><input type="number" id="f_periodTahun" value="${DB.meta.tahun}" style="width:100%;"></div>
    </div>
    <div class="actions">
      <button class="btn ghost" data-action="closeModal">Batal</button>
      <button class="btn primary" data-action="savePeriod">Simpan</button>
    </div>`);
}
function savePeriod(){
  const sem = document.getElementById("f_periodSem").value;
  const tahun = Number(document.getElementById("f_periodTahun").value)||DB.meta.tahun;
  DB.meta.semester = sem; DB.meta.tahun = tahun;
  logChange(`Periode pemantauan aktif diubah ke ${periodLabel(Number(sem.replace(/\D/g,"")), tahun)}`);
  save(); closeModal(); updateMetaLine();
  renderPage(document.querySelector(".navbtn.active")?.dataset.page || "dashboard");
  toast(`Periode aktif sekarang ${currentPeriodStr()}.`,"ok");
}

