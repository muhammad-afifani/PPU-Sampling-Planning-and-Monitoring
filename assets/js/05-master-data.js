/* =========================================================
   MASTER TITIK PANTAU — grouped tree view (Site -> Kategori Sumber)
========================================================= */
let masterView = "tree";
let masterExpanded = new Set();
const MASTER_SITE_ORDER = ["SPS","BEKAPAI","HCA","CPU","NPU","SPU","BPN"];
const NONEMISI_LABEL = {ambient:"Ambient Udara", kebisingan:"Kebisingan", kebauan:"Kebauan", getaran:"Getaran"};
const NONEMISI_BADGE = {ambient:"b-blue", kebisingan:"b-amber", kebauan:"b-teal", getaran:"b-gray"};

// Ambient/kebisingan/kebauan/getaran di lokasi yang sama = SATU titik kunjungan (semua parameter
// disampling sekaligus dalam ~24 jam), bukan 4 titik terpisah — jadi dikelompokkan jadi satu unit
// untuk hitungan hari kerja & tampilan, walau datanya di balik layar tetap 4 record (histori
// tracking per parameter tidak hilang).
const AMBIENT_FAMILY = ["ambient","kebisingan","kebauan","getaran"];
function schedulingGroupKey(p){
  return AMBIENT_FAMILY.includes(p.kategori) ? p.site+"::"+p.nama : p.id;
}
// Grouping KHUSUS perhitungan jumlah hari & penempatan tanggal — beda dari schedulingGroupKey di
// atas (yang berarti "titik ini SAMA/tak terpisahkan", dipakai utk dedup tampilan, cascade
// exclude, & cari status sibling). Flare (kalau DB.siteRules[site].flareOneDay dinyalakan di
// Aturan Site & Rute) ditambahkan SEBAGAI 1 slot hari kerja di sini SAJA — tiap titik Flare tetap
// dianggap titik terpisah untuk hal lain (tetap semua muncul di daftar, exclude 1 flare tidak
// ikut meng-exclude flare lain), cuma kebetulan boleh dijadwalkan selesai di hari yang sama.
function dayCountGroupKey(p){
  if(p.kategori==="emisi" && normKS(p.kategoriSumber)==="FLARE" && DB.siteRules[p.site]?.flareOneDay) return p.site+"::FLARE";
  return schedulingGroupKey(p);
}
// Kelompokkan titik jadi "grup TAMPILAN" pakai schedulingGroupKey yang sama dgn di atas — dulu
// cuma dipakai utk hitung hari kerja, sekarang dipakai juga utk daftar/tabel/cetak supaya
// ambient-family di lokasi fisik yang sama (mis. "Kompleks Gunung Utara" ambient + kebisingan)
// tampil SATU baris, bukan 1 baris per parameter (dari lapangan: kelihatan spt duplikat/bug &
// bikin total titik pantau seolah dobel, padahal cuma 1 lokasi dgn beberapa parameter). DB.points
// TIDAK diubah/digabung sama sekali — tetap N record independen (status/verifikasi/prediksi/riwayat
// per parameter tidak hilang), ini murni transformasi tampilan. Dipakai di Database Titik Pantau
// (tree & flat), cetak Daftar Titik Pantau, dan Berita Acara.
function groupPointsForDisplay(pts){
  const map = new Map();
  pts.forEach(p=>{
    const key = schedulingGroupKey(p);
    if(!map.has(key)) map.set(key, []);
    map.get(key).push(p);
  });
  return [...map.values()];
}
// Render 1 baris per anggota grup (masing2 diawali tag kategori kecil) kalau grupnya >1 anggota —
// supaya kolom yang NILAINYA beda per parameter (Progress/Wajib/Prediksi/Verifikasi/Aksi) tetap
// jelas "punya siapa" walau sekarang numpuk jadi 1 baris tabel. Grup 1 anggota (titik emisi biasa,
// atau ambient-family yang kebetulan sendirian di lokasi itu) render APA ADANYA, tanpa tag —
// tidak ada yang berubah secara visual dari sebelumnya.
// Kalau SEMUA anggota kebetulan menghasilkan tampilan PERSIS SAMA (mis. 4 parameter di lokasi yang
// sama-sama belum diverifikasi/masih "Hold") — cukup ditulis SEKALI + jumlah anggotanya, bukan
// ditumpuk 4x isinya identik persis (cuma bikin baris makin tinggi tanpa nambah info baru).
function groupStackHtml(group, renderFn){
  if(group.length<=1) return renderFn(group[0]);
  const rendered = group.map(renderFn);
  if(rendered.every(h=>h===rendered[0])){
    return `<div class="ms-stack-same">${rendered[0]}<span class="muted" style="font-size:9.5px;margin-left:4px;white-space:nowrap;">(${group.length} parameter)</span></div>`;
  }
  return `<div class="ms-stack">${group.map((p,i)=>`<div class="ms-stack-row"><span class="badge ${NONEMISI_BADGE[p.kategori]||"b-gray"} ms-stack-tag">${escHtml(NONEMISI_LABEL[p.kategori]||p.kategori)}</span><div class="ms-stack-val">${rendered[i]}</div></div>`).join("")}</div>`;
}
// Pengelompokan tree "Site -> Kategori Sumber" untuk titik emisi. Prioritas (paling spesifik
// menang duluan): kapasitas kecil > Gas Engine (termasuk kompresor gas berkode GEK/1-U-xxxx) >
// Turbin (gabungan compressor & generator) > Flare/Heater/Glycol Reboiler > Emergency/Diesel
// standby > sisanya per kategoriSumber asli.
const GRP_ENGINE_KECIL = "Engine Tidak Wajib Pantau (<100 kW)";
const GRP_GAS_ENGINE = "Gas Engine (Generator & Kompresor)";
const GRP_EMERGENCY = "Emergency Engine (Diesel Standby)";
const GRP_TURBIN = "Turbin Engine";
const GRP_FLARE = "Flare (Opasitas)";
const GRP_HEATER = "Heater (Emisi & Opasitas)";
const GRP_GLYCOL = "Glycol Reboiler / Dehydrator (Emisi & Opasitas)";
const GRP_AMBIENT = "Ambient & Lingkungan (Ambient / Kebisingan / Kebauan / Getaran)";
// Titik pemantauan kandungan sulfur (H2S) pada fuel gas supply tiap site — bukan mesin pembakaran
// dengan jam operasional sendiri (beda dari genset/turbin/heater), jadi tidak punya konsep "Running
// Hour" sama sekali (mirip Ambient), walau tetap dikategorikan "emisi" karena memang bagian dari
// kewajiban pemantauan emisi (Pasal 12 ayat 2b Permen LH 13/2009), bukan ambient/kebisingan/dst.
const KATEGORI_SUMBER_FUEL_QUALITY = "Pemantauan Kandungan Sulfur Bahan Bakar";
function emisiSubgroup(p){
  const ks = normKS(p.kategoriSumber);
  // Flare/Heater/Glycol Reboiler TIDAK tunduk pada pengecualian kapasitas <100 kW (itu aturan
  // khusus utk Engine per Permen LHK 11/2021) — jadi 3 jenis ini dicek DULUAN, sebelum
  // isUnder100kW, supaya unit kecil spt Heater 12 kW (mis. "H 6320" di SPS) tetap masuk grup
  // Heater-nya sendiri, bukan kelewat ke "Engine Tidak Wajib Pantau (<100 kW)".
  if(ks==="FLARE") return GRP_FLARE;
  if(ks==="HEATER") return GRP_HEATER;
  if(ks==="GLYCOL REBOILER") return GRP_GLYCOL;
  if(isUnder100kW(p)) return GRP_ENGINE_KECIL;
  if(isGasEngineKS(ks)) return GRP_GAS_ENGINE;
  if(isTurbineKS(ks)) return GRP_TURBIN;
  if(ks.indexOf("EMERGENCY")>=0 || isDieselStandbyKS(ks)) return GRP_EMERGENCY;
  return p.kategoriSumber || "Lainnya";
}
// Grup otomatis MURNI dari aturan (mengabaikan override manual) — dipakai untuk menampilkan
// "kalau otomatis, sebenarnya masuk grup X" di form edit.
function autoSubgroupOf(p){
  return p.kategori==="emisi" ? emisiSubgroup(p) : GRP_AMBIENT;
}
// Grup tree yang sebenarnya dipakai untuk render Master — override manual (groupOverride)
// menang kalau diisi, kalau tidak baru pakai hasil otomatis.
function subgroupOf(p){
  return p.groupOverride || autoSubgroupOf(p);
}
const KATEGORI_SUMBER_ORDER = [GRP_FLARE, GRP_TURBIN, GRP_GAS_ENGINE, GRP_EMERGENCY, GRP_HEATER, GRP_GLYCOL, GRP_ENGINE_KECIL, GRP_AMBIENT];
const ALL_TREE_GROUPS = KATEGORI_SUMBER_ORDER;
function subgroupOrderIdx(p){
  const i = KATEGORI_SUMBER_ORDER.indexOf(subgroupOf(p));
  return i<0?99:i;
}
// Label "jenis pemantauan" untuk ditampilkan (beda dari field `kategori` internal yang tetap
// "emisi" untuk keperluan filter) — Flare cuma Opasitas, Heater/Glycol Reboiler Emisi & Opasitas.
function monitoringTypeLabel(p){
  if(p.kategori!=="emisi") return NONEMISI_LABEL[p.kategori] || p.kategori;
  const ks = normKS(p.kategoriSumber);
  if(ks==="FLARE") return "Opasitas";
  if(ks==="HEATER" || ks==="GLYCOL REBOILER") return "Emisi & Opasitas";
  return "Emisi";
}
// Baris spesifikasi singkat di bawah nama titik — disesuaikan per jenis sumber supaya tidak
// menampilkan info yang tidak relevan (Flare/Heater/Glycol Reboiler tidak diatur berbasis
// kapasitas kW di regulasinya, Turbin tidak pakai pita kapasitas Permen LHK 11/2021).
function specLineFor(p){
  if(p.kategori!=="emisi") return "";
  const ks = normKS(p.kategoriSumber);
  if(ks==="FLARE") return "Flare";
  if(ks==="HEATER" || ks==="GLYCOL REBOILER") return "Heater/Glycol Reboiler/Dehydrator";
  if(isTurbineKS(ks)) return [p.kapasitas, p.jenisBahanBakar].filter(Boolean).join(" · ");
  return [p.kapasitas, p.jenisBahanBakar, p.kategoriKapasitas].filter(Boolean).join(" · ");
}
const HOLD_REASON_LABELS = {tidak_wajib:"Tidak Wajib Pantau", tidak_beroperasi:"Tidak Beroperasi", maintenance:"Under Maintenance", sudah_tidak_ada:"Sudah Tidak Ada di Tempat"};
function pointStatusBadge(p){
  if(p.status==="scheduled") return '<span class="badge b-blue">Scheduled</span>';
  if(p.status==="done") return '<span class="badge b-green">Done</span>';
  if(p.status==="failed") return '<span class="badge b-red">Gagal</span>';
  const reason = p.holdReason ? HOLD_REASON_LABELS[p.holdReason] : "";
  return `<span class="badge b-gray" title="Titik ini sedang tidak dipantau (hold), bukan menunggu jadwal.">Hold${reason?": "+escHtml(reason):""}</span>`;
}
// Badge "wajib pantau" yang sudah memperhitungkan ambang RH Emergency Engine untuk periode terpilih.
function wajibBadgeHtml(p, period){
  const r = wajibReason(p, period||currentPeriodStr());
  if(r.type==="nonop") return '<span class="badge b-gray">Tidak Beroperasi</span>';
  if(r.type==="reguler") return '<span class="badge b-teal">Wajib Pantau</span>';
  if(r.type==="emergency-triggered") return `<span class="badge b-red" title="Emergency Engine, RH 12 bulan terakhir ${r.rh} jam > 200 jam">&#9888; Wajib (Emergency, ${r.rh}j)</span>`;
  if(r.type==="emergency-exempt") return `<span class="badge b-gray" title="Emergency Engine, RH 12 bulan terakhir ${r.rh??0} jam ≤ 200 jam">Tidak Wajib (Emergency, ${r.rh??0}j)</span>`;
  return `<span class="badge b-amber">Tidak Wajib</span>${p.alasanTidakWajib?`<div class="muted" style="font-size:10px;margin-top:2px;">${escHtml(p.alasanTidakWajib)}</div>`:""}`;
}
// Highlight kolom "Prediksi Periode Berikutnya" terhadap periode acuan (default: periode aktif) —
// biar langsung kelihatan titik mana yang JATUH TEMPO periode ini (biru) atau malah sudah LEWAT
// dari prediksinya (merah) tanpa harus membandingkan manual satu-satu ke badge "Periode Aktif" di
// sidebar. Terima param `period` opsional supaya bisa dipakai juga di cetak Rencana per-periode
// (yang periodenya bisa beda dari periode aktif saat ini, lewat pemilih periode di halaman itu).
//
// Titik yang WAJIB pantau tapi belum pernah punya prediksi tercatat (belum pernah disampling —
// prediksiBerikutnya cuma keisi OTOMATIS begitu ada pemantauanTerakhir, lihat 01-state.js &
// migrateDB) tidak dibiarkan tampil "-" polos (bikin seolah "belum wajib"/kosong info) — mengikuti
// asumsi aman yang sama dgn isDueThisPeriod (03-period-logic.js): titik tanpa prediksi dianggap
// jatuh tempo SEKARANG, jadi ditampilkan sebagai badge periode berjalan. Ini murni tampilan (fallback
// display), TIDAK menulis nilai ke p.prediksiBerikutnya — begitu titik ini disampling & pemantauanTerakhir
// terisi, auto-hitung prediksi yang sebenarnya (existing logic) tetap akan mengisi field-nya dgn benar.
function prediksiCellHtml(p, period){
  period = period || currentPeriodStr();
  const val = p.prediksiBerikutnya;
  if(!val){
    if(effectiveWajib(p, period)) return `<span class="badge b-blue" title="Belum ada tanggal pemantauan terakhir/prediksi tercatat untuk titik ini — karena wajib pantau, dianggap jatuh tempo pada periode ${escHtml(period)} sampai diisi tanggal pemantauan sebenarnya">${escHtml(period)}</span>`;
    return `<span class="muted">-</span>`;
  }
  const parts = hasilPeriodParts(val);
  const curParts = hasilPeriodParts(period);
  if(parts.order==null || curParts.order==null) return escHtml(val);
  if(parts.order===curParts.order) return `<span class="badge b-blue" title="Jatuh tempo pada periode ${escHtml(period)}">${escHtml(val)}</span>`;
  if(parts.order<curParts.order) return `<span class="badge b-red" title="Prediksi sudah lewat dari periode ${escHtml(period)} — cek apakah sudah disampling atau jadwalnya perlu diperbarui">${escHtml(val)}, lewat</span>`;
  return `<span class="muted">${escHtml(val)}</span>`;
}
// Nama batch yang enak dibaca dari id-nya (bukan id mentah semacam "B_lj9go6f").
function batchNameOf(batchId){
  if(!batchId) return "-";
  const b = DB.batches.find(x=>x.id===batchId);
  return b ? b.name : "-";
}
function fmtDateTimeId(iso){
  if(!iso) return "";
  return new Date(iso).toLocaleString("id-ID",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"});
}
// Header kolom "Verifikasi" dengan tooltip (garis putus-putus = penanda ada penjelasan saat
// di-hover) — user baru sering bingung kolom ini fungsinya apa, jadi dijelaskan tujuannya di sini
// sekali, dipakai ulang di semua tempat kolom ini muncul (tree & tabel datar).
const VERIF_TH_HTML = `<span class="th-help" title="Verifikasi = penanda titik/engine ini sudah dicek & datanya (terutama lokasi) dikonfirmasi sesuai kondisi aktual. Setiap mau bikin Perencanaan Batch, titik yang akan disampling sebaiknya sudah diverifikasi dulu sebelum lanjut ke tahap penjadwalan. Klik centang/silang di kolom ini untuk menandai Sesuai/Tidak Sesuai.">Verifikasi</span>`;
// "Sudah dicek" per titik — verifikasi manual sebelum bikin batch, dengan notice kalau data
// berubah (updatedAt) SETELAH terakhir diverifikasi (lastVerified).
function verifyStatus(p){
  if(!p.lastVerified) return "unverified";
  if(p.updatedAt && p.updatedAt > p.lastVerified) return "stale";
  return "verified";
}
// Sel verifikasi = checkbox toggle (centang = tandai dicek sekarang, hilangkan centang = batal
// verifikasi) + keterangan kecil kapan/apakah berubah sejak itu. Dipisah dari kolom Aksi supaya
// tombol Edit/Hapus tidak berdesakan.
function verifyCellHtml(p){
  const st = verifyStatus(p);
  const checked = st!=="unverified";
  let sub;
  if(st==="unverified") sub = '<div class="muted" style="font-size:10px;">Belum dicek</div>';
  else if(st==="stale") sub = `<div style="font-size:10px;color:var(--amber-500);font-weight:700;">&#9888; berubah sejak ${fmtDateTimeId(p.lastVerified)}</div>`;
  else sub = `<div class="muted" style="font-size:10px;">${fmtDateTimeId(p.lastVerified)}</div>`;
  return `<label class="checkline"><input type="checkbox" class="verifyChk" data-id="${p.id}" ${checked?"checked":""}> OK</label>${sub}`;
}
document.addEventListener("change", e=>{
  if(e.target.classList && e.target.classList.contains("verifyChk")){
    const p = DB.points.find(x=>x.id===e.target.dataset.id); if(!p) return;
    p.lastVerified = e.target.checked ? new Date().toISOString() : null;
    save(); renderMaster();
  }
});
function verifyAllVisible(){
  const rows = filteredMasterRows();
  if(!rows.length){ toast("Tidak ada titik yang cocok filter saat ini.","err"); return; }
  askConfirm(`Tandai ${rows.length} titik yang sedang ditampilkan (sesuai filter) sebagai sudah dicek?`, ()=>{
    const now = new Date().toISOString();
    rows.forEach(p=>{ p.lastVerified = now; });
    save(); renderMaster();
    toast(`${rows.length} titik ditandai sudah dicek.`,"ok");
  });
}
// Hapus tanda "berubah sejak dicek" (stale) TANPA menstempel verifikasi baru — beda dari
// verifyAllVisible di atas (yang menstempel lastVerified=now, seolah baru saja dicek ulang beneran
// hari ini). Di sini cuma p.updatedAt yang dikosongkan, jadi verifyStatus balik ke "verified" tapi
// tanggal yang tetap ditampilkan adalah tanggal verifikasi ASLI (bisa lama) — sesuai permintaan:
// buang tanda kuningnya kalau sudah lama, bukan pura-pura baru saja diverifikasi ulang.
function clearStaleVisible(){
  const rows = filteredMasterRows().filter(p=>verifyStatus(p)==="stale");
  if(!rows.length){ toast('Tidak ada titik berstatus "Berubah Sejak Dicek" pada filter yang sedang aktif.',"err"); return; }
  askConfirm(`Hapus tanda "berubah sejak dicek" pada ${rows.length} titik yang sedang ditampilkan (sesuai filter)? Tanggal verifikasi terakhir TIDAK berubah — cuma tanda kuningnya yang dihilangkan, bukan verifikasi ulang.`, ()=>{
    rows.forEach(p=>{ p.updatedAt = null; });
    save(); renderMaster();
    toast(`Tanda "berubah sejak dicek" dihapus dari ${rows.length} titik.`,"ok");
  });
}
function populateSiteFilter(){
  const sites = [...new Set(DB.points.map(p=>p.site))].sort();
  const sel = document.getElementById("fltSite");
  const cur = sel.value;
  sel.innerHTML = '<option value="">Semua</option>'+sites.map(s=>`<option value="${s}">${s}</option>`).join("");
  sel.value = cur;
}
// Bandingkan prediksiBerikutnya satu titik ke periode aktif — dipakai filter "Prediksi Semester"
// di Database Titik Pantau. Beda dari isDueThisPeriod (yg juga mengharuskan effectiveWajib): di
// sini murni soal tanggal prediksinya sendiri, terlepas dari status wajib, supaya filter "Belum
// Ada Prediksi" dkk tetap berguna juga utk titik yg belum/tidak wajib.
function prediksiFilterMatch(p, mode, period){
  const pred = parsePeriodStr(p.prediksiBerikutnya);
  if(mode==="unset") return !pred;
  if(!pred) return false;
  const cur = parsePeriodStr(period);
  if(!cur) return false;
  const cmp = periodCompare(pred, cur);
  if(mode==="due") return cmp===0;
  if(mode==="overdue") return cmp<0;
  if(mode==="future") return cmp>0;
  return true;
}
function filteredMasterRows(){
  const site = document.getElementById("fltSite").value;
  const kategori = document.getElementById("fltKategori").value;
  const status = document.getElementById("fltStatus").value;
  const wajibOnly = document.getElementById("fltWajib").value;
  const verify = document.getElementById("fltVerify").value;
  const prediksi = document.getElementById("fltPrediksi").value;
  const q = document.getElementById("fltSearch").value.toLowerCase();
  const period = currentPeriodStr();
  return DB.points.filter(p=>{
    if(site && p.site!==site) return false;
    if(kategori && p.kategori!==kategori) return false;
    if(status && p.status!==status) return false;
    if(wajibOnly && !effectiveWajib(p)) return false;
    if(verify && verifyStatus(p)!==verify) return false;
    if(prediksi && !prediksiFilterMatch(p, prediksi, period)) return false;
    if(q && !(p.nama||"").toLowerCase().includes(q)) return false;
    return true;
  });
}
function renderMasterTree(rows){
  const bySite = {};
  rows.forEach(p=>{ (bySite[p.site]=bySite[p.site]||[]).push(p); });
  const sites = Object.keys(bySite).sort((a,b)=>{
    const ia = MASTER_SITE_ORDER.indexOf(a), ib = MASTER_SITE_ORDER.indexOf(b);
    return (ia<0?99:ia)-(ib<0?99:ib);
  });
  const activeFilter = !!(document.getElementById("fltSearch").value || document.getElementById("fltStatus").value || document.getElementById("fltWajib").value || document.getElementById("fltKategori").value || document.getElementById("fltVerify").value || document.getElementById("fltPrediksi").value);
  if(!sites.length) return "<div class='hint' style='padding:14px;'>Tidak ada titik yang cocok dengan filter.</div>";
  let html = "";
  sites.forEach(site=>{
    const sitePts = bySite[site];
    const expanded = activeFilter || masterExpanded.has(site);
    // Dihitung per GRUP (lokasi fisik), bukan per record mentah — 1 lokasi ambient+kebisingan
    // dihitung 1 titik di sini, konsisten dgn baris tabel di bawah yang sekarang juga digabung
    // (lihat groupPointsForDisplay) — supaya angka "N titik" tidak lagi kelihatan dobel dari
    // seharusnya. "wajib" = grup yg SALAH SATU anggotanya wajib (1 anggota wajib = tetap perlu
    // dikunjungi); "selesai" = grup yg SEMUA anggotanya sudah done (baru benar2 tuntas semua
    // parameter di lokasi itu).
    const siteGroups = groupPointsForDisplay(sitePts);
    const doneCount = siteGroups.filter(g=>g.every(p=>p.status==="done")).length;
    const wajibCount = siteGroups.filter(g=>g.some(p=>effectiveWajib(p))).length;
    html += `<div class="tree-site">
      <div class="tree-head" data-action="toggleMasterGroup" data-key="${escHtml(site)}">
        <span class="tree-caret">${expanded?"&#9660;":"&#9654;"}</span>
        <b>${site}</b> <span class="muted" style="color:#9db3c9;">— ${siteGroups.length} titik · ${wajibCount} wajib · ${doneCount} selesai</span>
      </div>`;
    if(expanded){
      const bySub = {};
      sitePts.forEach(p=>{ const sg = subgroupOf(p); (bySub[sg]=bySub[sg]||[]).push(p); });
      const subs = Object.keys(bySub).sort((a,b)=>subgroupOrderIdx(bySub[a][0])-subgroupOrderIdx(bySub[b][0]));
      subs.forEach(sg=>{
        const subKey = site+"::"+sg;
        const subExpanded = activeFilter || masterExpanded.has(subKey);
        const pts = bySub[sg];
        // Titik ambient-family di lokasi (site+nama) yang sama digabung jadi 1 grup tampilan —
        // 1 baris tabel per grup, bukan 1 baris per parameter (lihat groupPointsForDisplay).
        // Dihitung sekali di sini (dipakai jumlah di judul subgrup MAUPUN baris tabel di bawah)
        // supaya angkanya konsisten walau subgrup lagi diciutkan/dibuka.
        const ptGroups = groupPointsForDisplay(pts);
        html += `<div class="tree-sub">
          <div class="tree-subhead" data-action="toggleMasterGroup" data-key="${escHtml(subKey)}">
            <span class="tree-caret">${subExpanded?"&#9660;":"&#9654;"}</span>
            ${escHtml(sg)} <span class="muted">(${ptGroups.length} titik)</span>
          </div>`;
        if(subExpanded){
          html += `<table class="tree-table"><thead><tr>
            <th style="width:26px;">Progres</th><th>Nama / Spesifikasi</th><th>Parameter Wajib Pantau</th>
            <th style="width:90px;">${rhColumnLabel(currentPeriodStr())}</th><th style="width:150px;">Status</th><th style="width:150px;white-space:nowrap;">Prediksi</th><th style="width:130px;">${VERIF_TH_HTML}</th><th style="width:120px;"></th>
          </tr></thead><tbody>`;
          ptGroups.forEach(group=>{
            const p0 = group[0];
            const specLine = specLineFor(p0);
            // Grup gabungan (Turbin/Gas Engine/Emergency/Ambient) mencakup lebih dari satu jenis
            // sumber asli — tampilkan tag kecil biar tetap kelihatan jenis aslinya apa. Kalau
            // beberapa titik digabung jadi 1 baris (mis. Ambient+Kebisingan lokasi sama), tampilkan
            // SEMUA kategori anggotanya di sini sekaligus (bukan cuma anggota pertama) — ini
            // satu-satunya tempat "parameter apa saja" terlihat, krn baris per-parameter terpisah
            // sudah tidak ada lagi.
            const subTag = group.length>1
              ? group.map(p=>`<span class="badge ${NONEMISI_BADGE[p.kategori]||"b-gray"}" style="margin-left:5px;font-size:9.5px;">${escHtml(NONEMISI_LABEL[p.kategori]||p.kategori)}</span>`).join("")
              : (p0.kategori==="emisi"
                  ? (p0.kategoriSumber ? `<span class="badge b-gray" style="margin-left:5px;font-size:9.5px;">${escHtml(p0.kategoriSumber)}</span>` : "")
                  : `<span class="badge ${NONEMISI_BADGE[p0.kategori]||"b-gray"}" style="margin-left:5px;font-size:9.5px;">${escHtml(NONEMISI_LABEL[p0.kategori]||p0.kategori)}</span>`)
                + (p0.groupOverride ? `<span class="badge b-amber" style="margin-left:3px;font-size:9.5px;" title="Grup dipindah manual, otomatis harusnya: ${escHtml(autoSubgroupOf(p0))}">dipindah manual</span>` : "");
            html += `<tr>
              <td style="padding-left:34px;">${groupStackHtml(group, p=>pointStatusBadge(p))}</td>
              <td><b>${escHtml(p0.nama)}</b>${subTag}${specLine?`<div class="muted" style="font-size:10.5px;">${escHtml(specLine)}</div>`:""}</td>
              <td>${groupStackHtml(group, p=>escHtml(p.parameter||"-")+(p.parameterCatatan?`<div class="muted" style="font-size:10px;">${escHtml(p.parameterCatatan)}</div>`:""))}</td>
              <td class="muted">${(()=>{const v=rhYearValue(p0,currentPeriodStr()); return v!=null?v:"-";})()}</td>
              <td>${groupStackHtml(group, p=>wajibBadgeHtml(p))}</td>
              <td style="white-space:nowrap;">${groupStackHtml(group, p=>prediksiCellHtml(p))}</td>
              <td>${groupStackHtml(group, p=>verifyCellHtml(p))}</td>
              <td style="text-align:right;white-space:nowrap;">
                ${groupStackHtml(group, p=>`<button class="btn small" data-action="editPoint" data-id="${p.id}">Edit</button> <button class="btn small danger" data-action="deletePoint" data-id="${p.id}">Hapus</button>`)}
              </td>
            </tr>`;
          });
          html += `</tbody></table>`;
        }
        html += `</div>`;
      });
    }
    html += `</div>`;
  });
  return html;
}
// Kolom Tampilan Tabel Datar didefinisikan sbg data (bukan markup statis) supaya sebagian bisa
// disembunyikan/ditampilkan lewat "Atur Kolom" tanpa menduplikasi logika render-nya. Nama Titik &
// Aksi dikunci (locked:true) — identitas baris & tombol Edit/Hapus, tidak masuk akal disembunyikan.
// groupVaries:true = nilai kolom ini BEDA per parameter (ambient/kebisingan/dst di lokasi yang
// sama bisa punya parameter/status/wajib/prediksi/verifikasi/aksi masing2 sendiri) — dipakai
// renderMasterFlat menumpuk isinya per anggota grup (lihat groupStackHtml). Kolom tanpa flag ini
// dianggap SAMA utk semua anggota grup (site/nama sesuai definisi schedulingGroupKey; grup/sumber,
// kapasitas, bahan bakar, RH cuma relevan/terisi di titik emisi jadi otomatis sama krn ambient-
// family tidak pernah punya nilai itu; batch nyaris selalu sama krn dijadwalkan bareng 1 kunjungan)
// — cukup diambil dari anggota pertama grup, tidak perlu ditumpuk berulang.
const MASTER_FLAT_COLUMNS = [
  {key:"site", label:"Site", locked:false, th:()=>"Site", td:"", cell:p=>p.site},
  // Bukan groupVaries: nilainya (NONEMISI_LABEL[kategori]) persis sama dgn tag kategori yg sudah
  // ditambahkan groupStackHtml, jadi ditumpuk malah keliatan dobel ("Ambient Udara" 2x). Kolom
  // "Grup / Sumber" di sebelah sudah menyebut semua kategori tergabung, cukup diambil dari
  // anggota pertama grup.
  {key:"jenis", label:"Jenis Pantau", locked:false, th:()=>"Jenis Pantau", td:"", cell:p=>`<span class="badge b-gray">${escHtml(monitoringTypeLabel(p))}</span>`},
  {key:"nama", label:"Nama Titik", locked:true, th:()=>"Nama Titik", td:"", cell:p=>escHtml(p.nama)},
  {key:"grup", label:"Grup / Sumber", locked:false, th:()=>"Grup / Sumber", td:'class="muted" style="font-size:11.5px;"', cell:p=>`${escHtml(subgroupOf(p))}${p.kategori==="emisi"&&p.kategoriSumber?`<div style="font-size:10px;">${escHtml(p.kategoriSumber)}</div>`:""}`},
  {key:"kapasitas", label:"Kapasitas", locked:false, th:()=>"Kapasitas", td:'class="muted" style="font-size:11px;"', cell:p=>escHtml(p.kapasitas||"-")},
  {key:"bahanBakar", label:"Bahan Bakar", locked:false, th:()=>"Bahan Bakar", td:'class="muted" style="font-size:11px;"', cell:p=>escHtml(p.jenisBahanBakar||"-")},
  {key:"parameter", label:"Parameter Wajib", locked:false, th:()=>"Parameter Wajib", td:'style="font-size:11.5px;"', cell:p=>escHtml(p.parameter||"-"), groupVaries:true},
  {key:"periodePantau", label:"Periode Pantau", locked:false, th:()=>"Periode Pantau", td:'class="muted" style="font-size:11px;white-space:nowrap;"', cell:p=>escHtml(frekuensiTextFor(p)), groupVaries:true},
  {key:"rh", label:"RH/Tahun", locked:false, th:period=>rhColumnLabel(period), td:'class="muted"', cell:(p,period)=>{ const v=rhYearValue(p,period); return v!=null?v:"-"; }},
  {key:"progress", label:"Progress", locked:false, th:()=>"Progress", td:"", cell:p=>pointStatusBadge(p), groupVaries:true},
  {key:"wajib", label:"Wajib", locked:false, th:()=>"Wajib", td:"", cell:p=>wajibBadgeHtml(p), groupVaries:true},
  {key:"prediksi", label:"Prediksi", locked:false, th:()=>"Prediksi", td:'style="white-space:nowrap;"', cell:p=>prediksiCellHtml(p), groupVaries:true},
  {key:"verifikasi", label:"Verifikasi", locked:false, th:()=>VERIF_TH_HTML, td:"", cell:p=>verifyCellHtml(p), groupVaries:true},
  {key:"batch", label:"Batch", locked:false, th:()=>"Batch", td:'class="muted" style="font-size:11px;"', cell:p=>escHtml(batchNameOf(p.batchId))},
  {key:"aksi", label:"Aksi", locked:true, th:()=>"Aksi", td:'style="white-space:nowrap;"', cell:p=>`<button class="btn small" data-action="editPoint" data-id="${p.id}">Edit</button>
      <button class="btn small danger" data-action="deletePoint" data-id="${p.id}">Hapus</button>`, groupVaries:true},
];
function masterHiddenCols(){ return DB.meta.masterHiddenCols || []; }
function masterVisibleColumns(){
  const hidden = new Set(masterHiddenCols());
  return MASTER_FLAT_COLUMNS.filter(c=>c.locked || !hidden.has(c.key));
}
function renderMasterFlat(rows){
  const period = currentPeriodStr();
  const cols = masterVisibleColumns();
  // Sama seperti tree view: titik ambient-family di lokasi yang sama digabung jadi 1 baris tabel
  // (lihat groupPointsForDisplay) — kolom yang nilainya beda per parameter (groupVaries) ditumpuk
  // di dalam sel yang sama, bukan bikin baris tabel terpisah lagi per parameter.
  const groups = groupPointsForDisplay(rows);
  document.getElementById("masterTable").innerHTML = `
    <thead><tr>${cols.map(c=>`<th>${c.th(period)}</th>`).join("")}</tr></thead>
    <tbody>${groups.map(group=>`<tr>${cols.map(c=>`<td ${c.td}>${c.groupVaries ? groupStackHtml(group, p=>c.cell(p,period)) : c.cell(group[0],period)}</td>`).join("")}</tr>`).join("")}</tbody>`;
}
// Modal "Atur Kolom" — checkbox per kolom yang bisa disembunyikan, diterapkan LANGSUNG tiap
// dicentang/dikosongkan (bukan tombol "Terapkan" terpisah) supaya langsung kelihatan efeknya di
// tabel di belakang modal. Pilihan disimpan di DB.meta.masterHiddenCols, jadi tetap diingat lain kali
// tools ini dibuka lagi (bukan cuma sesi ini saja).
function openMasterColumnPicker(){
  const hidden = new Set(masterHiddenCols());
  const rowsHtml = MASTER_FLAT_COLUMNS.filter(c=>!c.locked).map(c=>`
    <label class="checkline" style="display:block;padding:4px 0;">
      <input type="checkbox" class="masterColChk" data-key="${c.key}" ${hidden.has(c.key)?"":"checked"}> ${escHtml(c.label)}
    </label>`).join("");
  openModal(`
    <h3>Atur Kolom — Tampilan Tabel Datar</h3>
    <div class="hint" style="margin-bottom:8px;">Pilih kolom yang mau ditampilkan. Nama Titik &amp; Aksi selalu tampil (identitas baris &amp; tombol Edit/Hapus). Perubahan langsung diterapkan &amp; diingat utk kunjungan berikutnya.</div>
    ${rowsHtml}
    <div class="actions"><button class="btn primary" data-action="closeModal">Tutup</button></div>
  `);
}
document.addEventListener("change", e=>{
  if(e.target.classList && e.target.classList.contains("masterColChk")){
    const key = e.target.dataset.key;
    const hidden = new Set(masterHiddenCols());
    if(e.target.checked) hidden.delete(key); else hidden.add(key);
    DB.meta.masterHiddenCols = [...hidden];
    save(); renderMaster();
  }
});
function renderMaster(){
  // Dibungkus try/catch: kalau ada error render di tengah jalan (mis. data lama/edge-case),
  // sebelumnya tabel diam saja tidak berubah (kelihatan seperti "filter tidak jalan") karena
  // innerHTML baru tidak sempat ditulis. Sekarang errornya kelihatan lewat toast + console.
  try{
  populateSiteFilter();
  const rows = filteredMasterRows();
  document.getElementById("btnViewTree").classList.toggle("primary", masterView==="tree");
  document.getElementById("btnViewFlat").classList.toggle("primary", masterView==="flat");
  // Expand/Collapse Semua cuma relevan di Tampilan Tree — di Tampilan Tabel Datar semua baris
  // sudah kelihatan rata (tidak ada yang di-collapse), jadi tombolnya cuma bikin bingung kalau
  // tetap ditampilkan (kelihatan seperti tombol yang seharusnya ngapa-ngapain tapi diam saja).
  document.getElementById("masterTreeControls").style.display = masterView==="tree" ? "flex" : "none";
  document.getElementById("masterFlatControls").style.display = masterView==="flat" ? "flex" : "none";
  if(masterView==="tree"){
    document.getElementById("masterTreeWrap").style.display="block";
    document.getElementById("masterFlatWrap").style.display="none";
    document.getElementById("masterTreeWrap").innerHTML = renderMasterTree(rows);
  } else {
    document.getElementById("masterTreeWrap").style.display="none";
    document.getElementById("masterFlatWrap").style.display="block";
    renderMasterFlat(rows);
  }
  const verifiedCount = DB.points.filter(p=>verifyStatus(p)==="verified").length;
  const staleCount = DB.points.filter(p=>verifyStatus(p)==="stale").length;
  // "Titik" di sini dihitung per lokasi (grup ambient-family digabung, konsisten dgn tabel di
  // atasnya) supaya tidak kelihatan dobel; "parameter" tetap per record karena verifikasi memang
  // dilakukan per parameter (1 lokasi ambient bisa punya sebagian parameter sudah dicek, sebagian belum).
  document.getElementById("masterCount").innerHTML = `${groupPointsForDisplay(rows).length} dari ${groupPointsForDisplay(DB.points).length} titik ditampilkan &middot; `
    + `<b>${verifiedCount}</b> dari ${DB.points.length} parameter sudah dicek`
    + (staleCount ? ` &middot; <span style="color:var(--amber-500);font-weight:700;">${staleCount} berubah sejak terakhir dicek</span>` : "");
  }catch(err){
    console.error("renderMaster error:", err);
    toast("Gagal menampilkan Database Titik Pantau: "+err.message,"err");
  }
}
["fltSite","fltKategori","fltStatus","fltWajib","fltVerify","fltPrediksi","fltSearch"].forEach(id=>{
  document.addEventListener("input", e=>{ if(e.target.id===id) renderMaster(); });
  document.addEventListener("change", e=>{ if(e.target.id===id) renderMaster(); });
});

function pointFormHtml(p){
  p = p || {id:"", site:"", kategori:"emisi", nama:"", kategoriSumber:"", regulasi:"", parameter:"", parameterCatatan:"", wajib:true, frekuensiBulan:6, tidakBeroperasi:false, alasanTidakWajib:"", kapasitas:"", kapasitasKW:"", kategoriKapasitas:"", jenisBahanBakar:"", runningHour:"", pemantauanTerakhir:"", prediksiBerikutnya:"", lastSampling:"", keterangan:"", groupOverride:"", holdReason:""};
  return `
  <h3>${p.id?"Edit":"Tambah"} Titik Pantau</h3>
  <div class="grid cols-2">
    <div class="field"><label>Site</label><input type="text" id="f_site" value="${escHtml(p.site)}" placeholder="mis. SPS"></div>
    <div class="field"><label>Kategori</label><select id="f_kategori">
      ${["emisi","ambient","kebisingan","kebauan","getaran"].map(k=>`<option value="${k}" ${p.kategori===k?"selected":""}>${k}</option>`).join("")}
    </select></div>
  </div>
  <div class="field" style="margin-top:10px;"><label>Nama Titik / Sumber Emisi</label><input type="text" id="f_nama" value="${escHtml(p.nama)}"></div>
  <div class="grid cols-2" style="margin-top:10px;">
    <div class="field"><label>Kategori Sumber (Ketentuan Teknis)</label><input type="text" id="f_kategoriSumber" value="${escHtml(p.kategoriSumber)}" placeholder="mis. Flare, Diesel Engine Generator"></div>
    <div class="field"><label>Regulasi</label><select id="f_regulasi">
      <option value="" ${!p.regulasi?"selected":""}>-</option>
      <option value="PERMEN LH 13/2009" ${p.regulasi==="PERMEN LH 13/2009"?"selected":""}>PERMEN LH 13/2009</option>
      <option value="PERMEN LHK 11/2021" ${p.regulasi==="PERMEN LHK 11/2021"?"selected":""}>PERMEN LHK 11/2021</option>
      <option value="PP 22/2021" ${p.regulasi==="PP 22/2021"?"selected":""}>PP 22/2021 (Ambient)</option>
      <option value="KEPMEN LH 48/1996" ${p.regulasi==="KEPMEN LH 48/1996"?"selected":""}>KEPMEN LH 48/1996 (Kebisingan)</option>
      <option value="KEPMEN LH 50/1996" ${p.regulasi==="KEPMEN LH 50/1996"?"selected":""}>KEPMEN LH 50/1996 (Kebauan)</option>
      <option value="KEPMEN LH 49/1996" ${p.regulasi==="KEPMEN LH 49/1996"?"selected":""}>KEPMEN LH 49/1996 (Getaran)</option>
    </select></div>
  </div>
  <div class="grid cols-3" style="margin-top:10px;">
    <div class="field"><label>Kapasitas (teks)</label><input type="text" id="f_kapasitas" value="${escHtml(p.kapasitas)}" placeholder="mis. 1.4 MW"></div>
    <div class="field"><label>Kapasitas (KW)</label><input type="number" id="f_kapasitasKW" value="${p.kapasitasKW||""}"></div>
    <div class="field"><label>Jenis Bahan Bakar</label><input type="text" id="f_bahanBakar" value="${escHtml(p.jenisBahanBakar||"")}" placeholder="Gas / Minyak"></div>
  </div>
  <div class="field" style="margin-top:10px;"><label>Grup Tree (pindah manual, opsional)</label><select id="f_groupOverride">
    <option value="">Otomatis${p.id?` — saat ini: "${escHtml(autoSubgroupOf(p))}"`:""}</option>
    ${ALL_TREE_GROUPS.map(g=>`<option value="${escHtml(g)}" ${p.groupOverride===g?"selected":""}>${escHtml(g)}</option>`).join("")}
  </select>
  <div class="hint">Biarkan "Otomatis" kalau grupnya sudah benar. Pakai ini kalau titik ini sebenarnya harus masuk grup lain — mis. dianggap Heater walau kapasitasnya di bawah 100 kW.</div></div>
  <div class="field" style="margin-top:10px;"><label>Parameter Wajib Pantau</label><input type="text" id="f_parameter" value="${escHtml(p.parameter)}" placeholder="pisahkan dengan koma"></div>
  <div class="field" style="margin-top:10px;"><label>Catatan Parameter (alasan/dasar penentuan)</label><input type="text" id="f_paramCatatan" value="${escHtml(p.parameterCatatan||"")}"></div>
  <div class="grid cols-3" style="margin-top:10px;">
    <div class="field"><label>Frekuensi (bulan)</label><input type="number" id="f_freq" value="${p.frekuensiBulan||""}" placeholder="6/12/36"></div>
    <div class="field"><label>RH Manual (jam) — angka terkini, bukan total setahun</label><input type="number" id="f_runningHour" value="${p.runningHour!=null?p.runningHour:""}"></div>
    <div class="field"><label>Sampling Terakhir</label><input type="date" id="f_last" value="${p.lastSampling||""}"></div>
  </div>
  <div class="grid cols-2" style="margin-top:10px;">
    <div class="field"><label>Pemantauan Terakhir (periode)</label><input type="text" id="f_pemantauanTerakhir" value="${escHtml(p.pemantauanTerakhir||"")}" placeholder="mis. S1 2026"></div>
    <div class="field"><label>Prediksi Periode Berikutnya</label><input type="text" id="f_prediksi" value="${escHtml(p.prediksiBerikutnya||"")}" placeholder="mis. S2 2026"></div>
  </div>
  <div class="grid cols-2" style="margin-top:10px;">
    <div class="field"><label>Status Pemantauan</label><select id="f_status">
      ${[["pending","Hold (tidak sedang dipantau)"],["scheduled","Scheduled"],["done","Done"],["failed","Gagal / Batch Lanjut"]].map(([v,l])=>`<option value="${v}" ${(p.status||"pending")===v?"selected":""}>${l}</option>`).join("")}
    </select></div>
    <div class="field"><label>Alasan Hold (kalau status Hold)</label><select id="f_holdReason">
      <option value="">- pilih alasan -</option>
      ${Object.entries(HOLD_REASON_LABELS).map(([v,l])=>`<option value="${v}" ${p.holdReason===v?"selected":""}>${l}</option>`).join("")}
    </select></div>
  </div>
  <div class="hint" style="margin-top:4px;">Status biasanya otomatis dari Perencanaan Batch/Tracking — ubah manual di sini hanya untuk koreksi. "Hold" dipakai untuk titik yang memang tidak sedang dipantau (beda dari "menunggu jadwal") — isi alasannya biar jelas kenapa.</div>
  <div class="inline-fields" style="margin-top:10px;">
    <label class="checkline"><input type="checkbox" id="f_wajib" ${p.wajib?"checked":""}> Wajib dipantau</label>
    <label class="checkline"><input type="checkbox" id="f_tidakOp" ${p.tidakBeroperasi?"checked":""}> Tidak beroperasi saat ini</label>
  </div>
  <div class="field" style="margin-top:10px;"><label>Alasan Tidak Wajib (jika ada)</label><input type="text" id="f_alasanTidakWajib" value="${escHtml(p.alasanTidakWajib||"")}"></div>
  <div class="field" style="margin-top:10px;"><label>Keterangan</label><input type="text" id="f_ket" value="${escHtml(p.keterangan||"")}"></div>
  ${p.id && isEmergencyEngine(p) ? (()=>{
    const r = wajibReason(p);
    return `<div class="section-note" style="margin-top:12px;">
      <b>Emergency Engine</b> — RH 12 bulan terakhir (periode ${escHtml(currentPeriodStr())}): <b>${r.rh!=null?r.rh:"tidak ada data"} jam</b>.
      ${r.type==="emergency-triggered" ? "Di atas ambang 200 jam/tahun → <b>wajib dipantau</b> periode ini walau centang \"Wajib dipantau\" di atas tidak dicentang." : "Masih di bawah ambang 200 jam/tahun → tidak wajib dipantau periode ini."}
      Cek detail bulanan di menu <b>Running Hour Detail</b>.
    </div>`;
  })() : ""}
  <div class="actions">
    <button class="btn ghost" data-action="closeModal">Batal</button>
    <button class="btn primary" data-action="savePoint" data-id="${p.id}">Simpan</button>
  </div>`;
}
function editPoint(id){
  const p = DB.points.find(x=>x.id===id);
  openModal(pointFormHtml(p));
}
function addPoint(){ openModal(pointFormHtml(null)); }
function savePoint(id){
  const val = {
    site: document.getElementById("f_site").value.trim().toUpperCase(),
    kategori: document.getElementById("f_kategori").value,
    nama: document.getElementById("f_nama").value.trim(),
    kategoriSumber: document.getElementById("f_kategoriSumber").value.trim(),
    regulasi: document.getElementById("f_regulasi").value,
    parameter: document.getElementById("f_parameter").value.trim(),
    parameterCatatan: document.getElementById("f_paramCatatan").value.trim(),
    frekuensiBulan: document.getElementById("f_freq").value ? Number(document.getElementById("f_freq").value) : "",
    kapasitas: document.getElementById("f_kapasitas").value.trim(),
    kapasitasKW: document.getElementById("f_kapasitasKW").value ? Number(document.getElementById("f_kapasitasKW").value) : null,
    jenisBahanBakar: document.getElementById("f_bahanBakar").value.trim(),
    runningHour: document.getElementById("f_runningHour").value ? Number(document.getElementById("f_runningHour").value) : null,
    pemantauanTerakhir: document.getElementById("f_pemantauanTerakhir").value.trim(),
    prediksiBerikutnya: document.getElementById("f_prediksi").value.trim(),
    lastSampling: document.getElementById("f_last").value,
    status: document.getElementById("f_status").value,
    holdReason: document.getElementById("f_holdReason").value,
    groupOverride: document.getElementById("f_groupOverride").value,
    wajib: document.getElementById("f_wajib").checked,
    tidakBeroperasi: document.getElementById("f_tidakOp").checked,
    alasanTidakWajib: document.getElementById("f_alasanTidakWajib").value.trim(),
    keterangan: document.getElementById("f_ket").value.trim(),
    updatedAt: new Date().toISOString()
  };
  if(!val.site || !val.nama){ toast("Site dan Nama Titik wajib diisi.","err"); return; }
  // Ambient/Kebisingan/Kebauan/Getaran siklusnya SELALU tetap (6 bulan, Permen LH 13/2009) —
  // bukan variatif spt Engine (6bln/1th/3th tergantung kapasitas), jadi prediksi periode
  // berikutnya bisa dihitung otomatis dari Pemantauan Terakhir + frekuensi, tidak perlu ditebak
  // manual tiap titik. Tidak menimpa kalau kolom Prediksi sudah diisi manual oleh user.
  if(AMBIENT_FAMILY.includes(val.kategori) && val.pemantauanTerakhir && !val.prediksiBerikutnya){
    val.prediksiBerikutnya = nextPeriodAfter(val.pemantauanTerakhir, val.frekuensiBulan||6);
  }
  if(id){
    const p = DB.points.find(x=>x.id===id);
    Object.assign(p, val);
  } else {
    DB.points.push({id: uid("PT"), status:"pending", batchId:"", planStart:"", planEnd:"", actualStart:"", actualEnd:"", team: val.kategori==="emisi"?"emisi":"ambient", ...val});
  }
  touchDataset("points"); save(); closeModal(); renderMaster();
}
function deletePoint(id){
  askConfirm("Hapus titik pantau ini?", ()=>{
    DB.points = DB.points.filter(p=>p.id!==id);
    touchDataset("points"); save(); renderMaster(); toast("Titik pantau dihapus.");
  });
}
function importPointsCsv(){
  const inp = document.getElementById("hiddenCsvFile");
  inp.onchange = ()=>{
    const file = inp.files[0]; if(!file) return;
    const reader = new FileReader();
    reader.onload = ()=>{
      const rows = csvParse(reader.result);
      let added=0, updated=0;
      rows.forEach(r=>{
        const rec = {
          site:(r.site||"").toUpperCase(), kategori:r.kategori||"emisi", nama:r.nama||"",
          kategoriSumber:r.kategoriSumber||"", regulasi:r.regulasi||"", parameter:r.parameter||"",
          parameterCatatan:r.parameterCatatan||"",
          wajib: /^(1|true|ya|wajib)$/i.test(r.wajib||""), frekuensiBulan: r.frekuensiBulan?Number(r.frekuensiBulan):"",
          tidakBeroperasi: /^(1|true|ya)$/i.test(r.tidakBeroperasi||""), kapasitas:r.kapasitas||"",
          kapasitasKW: r.kapasitasKW?Number(r.kapasitasKW):null, jenisBahanBakar:r.jenisBahanBakar||"",
          runningHour: r.runningHour?Number(r.runningHour):null, pemantauanTerakhir:r.pemantauanTerakhir||"",
          prediksiBerikutnya:r.prediksiBerikutnya||"", alasanTidakWajib:r.alasanTidakWajib||"",
          lastSampling:r.lastSampling||""
        };
        if(!rec.site||!rec.nama) return;
        if(r.id){
          const existing = DB.points.find(p=>p.id===r.id);
          if(existing){ Object.assign(existing, rec); updated++; return; }
        }
        DB.points.push({id: uid("PT"), status:"pending", batchId:"", planStart:"", planEnd:"", actualStart:"", actualEnd:"", team: rec.kategori==="emisi"?"emisi":"ambient", keterangan:"", ...rec});
        added++;
      });
      touchDataset("points"); save(); renderMaster();
      toast(`Import selesai: ${added} titik baru, ${updated} diperbarui.`,"ok");
    };
    reader.readAsText(file);
    inp.value="";
  };
  inp.click();
}
function exportPointsCsv(){
  const headers=["id","site","kategori","nama","kategoriSumber","regulasi","parameter","parameterCatatan","wajib","frekuensiBulan","tidakBeroperasi","alasanTidakWajib","kapasitas","kapasitasKW","jenisBahanBakar","runningHour","pemantauanTerakhir","prediksiBerikutnya","lastSampling","status","batchId"];
  csvExport(headers, DB.points, "titik_pantau_export.csv");
}

