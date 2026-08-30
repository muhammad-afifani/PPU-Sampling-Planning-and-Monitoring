/* =========================================================
   BERITA ACARA PENGAMBILAN CONTOH UJI UDARA EMISI
========================================================= */
// Nama bulan lengkap (bukan singkatan MONTH_SHORT_ID) — dipakai persis spt format tanggal di
// contoh Berita Acara yang sudah ditandatangani ("18 Februari 2026", bukan "18 Feb 2026").
const MONTH_FULL_ID = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
function fmtTanggalIndo(dateStr){
  if(!dateStr) return "";
  const [y,m,d] = dateStr.split("-").map(Number);
  return `${d} ${MONTH_FULL_ID[m-1]} ${y}`;
}
function fmtHariTanggalIndo(dateStr){
  if(!dateStr) return "";
  return `${DOW_LABEL[dayOfWeek(dateStr)]}, ${fmtTanggalIndo(dateStr)}`;
}
// Data penandatangan (PHM & Lab) disimpan per Tim supaya tidak perlu diketik ulang tiap ganti
// site/batch — bukan data krusial yang butuh migrasi berat, cukup default kosong kalau belum ada.
function ensureBaConfig(){
  if(!DB.baConfig) DB.baConfig = {};
  ["emisi","ambient"].forEach(team=>{
    if(!DB.baConfig[team]) DB.baConfig[team] = {namaPhm:"", jabatanPhm:"", labPerusahaan:"PT Sucofindo", namaLab:"", jabatanLab:"Ketua Tim Pemantauan Emisi", footerNote:""};
    // Field lama tersimpan sebelum footerNote ditambahkan belum tentu punya properti ini.
    if(DB.baConfig[team].footerNote===undefined) DB.baConfig[team].footerNote = "";
  });
  return DB.baConfig;
}
// Frekuensi wajib pantau dlm bentuk teks spt di contoh BA ("1 x 6 bulan", "1 x 1 tahun") — dibaca
// dari p.frekuensiBulan yg sudah ada di Database Titik Pantau, bukan menghitung ulang dari nol.
// Titik yang SEDANG tidak wajib pantau periode ini (mis. Emergency Engine RH di bawah ambang, atau
// memang bukan parameter wajib PROPER) tidak diisi angka frekuensi sama sekali — mengisi "1 x 6
// bulan" dkk di sana menyiratkan ada kewajiban rutin yang sebenarnya tidak berlaku periode ini.
function frekuensiTextFor(p){
  if(!effectiveWajib(p)) return "*Tidak Wajib Pantau";
  const bln = Number(p.frekuensiBulan)||0;
  if(!bln) return "*";
  if(bln%12===0) return `1 x ${bln/12} tahun`;
  return `1 x ${bln} bulan`;
}
// Ambient/Kebisingan/Kebauan/Getaran di lokasi yang sama disampling bersamaan dalam satu
// kunjungan (lihat schedulingGroupKey) — kalau titik ini sendiri belum dicatat status
// sampling-nya tapi salah satu "saudara serumpun"-nya (nama & site sama) sudah tercatat
// "Sudah Disampling", pakai tanggal itu, supaya Kebauan/Getaran tidak perlu diisi manual
// terpisah padahal sebenarnya diambil bersamaan dengan Ambient/Kebisingan.
function ambientSiblingSampledDate(p){
  if(!AMBIENT_FAMILY.includes(p.kategori)) return null;
  const siblings = DB.points.filter(x=>x.id!==p.id && schedulingGroupKey(x)===schedulingGroupKey(p));
  for(const sib of siblings){
    const t = ensureTracking(sib.id);
    if(t.samplingStatus==="sampled" && t.dates.actual) return t.dates.actual;
  }
  return null;
}
// Menyusun teks "Status Pemantauan" satu baris Berita Acara, persis kategori yang dipakai di
// contoh yang sudah ditandatangani: tanggal aktual kalau sudah disampling, referensi ke batch lain
// kalau memang dijadwalkan di batch berbeda, alasan tidak wajib (emergency dsb), atau keterangan
// bebas (Under Maintenance/Demolished/dst) yang diisi manual di titik tsb / Tahap 1 Tracking.
// Status kosong ("- pilih status -" belum diisi) SENGAJA dikembalikan sebagai string kosong,
// bukan "Belum Disampling" — supaya kolomnya kosong di kertas cetak dan bisa diisi tangan.
function baStatusFor(p, selectedBatchId){
  // Override manual MENANG DULUAN dari semua logika otomatis di bawah — diisi lewat kolom Status
  // Pemantauan yang bisa diedit langsung di pratinjau halaman Berita Acara (lihat #baPreviewTable
  // & listener "baStatusInput"), disimpan per (batch, titik) di b.baStatusOverrides supaya beda
  // batch/ekspor bisa beda catatan manual utk titik yang sama.
  const ovB = DB.batches.find(x=>x.id===selectedBatchId);
  const ov = ovB && ovB.baStatusOverrides && ovB.baStatusOverrides[p.id];
  if(ov) return escHtml(ov);
  // Titik yang benar-benar tidak beroperasi (rusak/maintenance/demolished dst) apa adanya,
  // tidak peduli statusnya wajib pantau atau tidak menurut aturan.
  if(p.tidakBeroperasi){
    return p.keterangan ? escHtml(p.keterangan) : "Tidak Beroperasi";
  }
  // Kalau titik ini benar-benar dimasukkan ke batch terpilih DAN sudah dicatat status
  // sampling-nya di Tahap 1 (Tracking), catatan aktual itu yang menang duluan — meskipun titik
  // tsb sebenarnya masuk kategori "tidak wajib" (mis. Emergency Engine RH rendah yang tetap
  // sempat diambil datanya karena kru sudah di lokasi), supaya BA mencerminkan kejadian nyata,
  // bukan cuma aturan teoretis.
  if(p.batchId && p.batchId===selectedBatchId){
    const t = ensureTracking(p.id);
    if(t.samplingStatus==="sampled") return `Dipantau ${escHtml(fmtTanggalIndo(t.dates.actual))}`;
    if(t.samplingStatus==="deferred") return escHtml(t.samplingNote || "Batch Berikutnya");
    if(t.samplingStatus==="other") return escHtml(t.samplingNote || "Tidak Disampling");
  }
  const siblingDate = ambientSiblingSampledDate(p);
  if(siblingDate) return `Dipantau ${escHtml(fmtTanggalIndo(siblingDate))}`;
  const reason = wajibReason(p);
  // Emergency Engine yang RH-nya masih di bawah ambang: alasan exempt-nya adalah RH itu sendiri,
  // jadi SELALU tulis fakta RH-nya apa adanya — walau kebetulan p.pemantauanTerakhir terisi (mis.
  // pernah disampling sekali dulu), JANGAN dibingkai sbg "sudah dipantau periode lalu" krn itu
  // menyiratkan siklus rutin yang sebenarnya tidak berlaku utk Emergency Engine (exempt-nya
  // ditentukan RH tiap periode, bukan jadwal tetap).
  if(reason.type==="emergency-exempt"){
    return escHtml(`Tidak dipantau — Emergency Engine, RH 12 bulan terakhir ${reason.rh??0} jam (di bawah ambang ${RH_WAJIB_THRESHOLD} jam/tahun)`);
  }
  // Titik yang PERMANEN tidak wajib (bukan soal siklus/RH, mis. kapasitas di bawah ambang 100 kW)
  // — kasih ALASAN KONKRET-nya (bukan cuma "Tidak Wajib Pantau" generik), diutamakan alasan yang
  // paling sering muncul (kapasitas kecil) baru fallback ke catatan manual di database.
  if(reason.type==="not-wajib"){
    if(isUnder100kW(p)) return escHtml(`Tidak Wajib Pantau — Kapasitas ${p.kapasitasKW} kW (di bawah ambang ${CAPACITY_EXEMPT_KW} kW)`);
    if(p.alasanTidakWajib && !/^tidak wajib( di ?pantau)?\.?$/i.test(p.alasanTidakWajib.trim())) return escHtml(p.alasanTidakWajib);
    if(p.pemantauanTerakhir) return escHtml(`Terakhir dipantau ${p.pemantauanTerakhir}`);
    return "Tidak Wajib Pantau";
  }
  // Sisanya: reguler/emergency-triggered TAPI siklusnya (1 tahun/3 tahun dst) belum jatuh tempo
  // periode aktif ini (lihat isDueThisPeriod) — di sini BOLEH dibingkai "sudah dipantau periode
  // lalu" krn titik jenis ini memang berjadwal rutin/periodik, beda dari Emergency Engine di atas.
  if(!isDueThisPeriod(p, currentPeriodStr())){
    if(p.pemantauanTerakhir) return escHtml(`Sudah dipantau periode lalu (${p.pemantauanTerakhir})`);
    if(p.prediksiBerikutnya) return escHtml(`Prediksi pantau berikutnya ${p.prediksiBerikutnya}`);
    return "Belum Pernah Dipantau";
  }
  // Sisanya (reguler / emergency-triggered, DAN due periode ini) = wajib dipantau periode ini,
  // tapi belum ada catatan status sampling utk batch terpilih di atas — dikosongkan saja (lihat
  // catatan fungsi di atas).
  if(p.batchId===selectedBatchId) return "";
  if(p.batchId){
    const otherBatch = DB.batches.find(b=>b.id===p.batchId);
    const m = otherBatch ? otherBatch.name.match(/Batch\s*(\d+)/i) : null;
    return escHtml(m ? `Batch ${m[1]}` : (otherBatch?otherBatch.name:"Batch Lain"));
  }
  return "";
}
function refreshBaBatchSelect(){
  const team = document.getElementById("baTeam").value;
  const sel = document.getElementById("baBatch");
  const cur = sel.value;
  const list = DB.batches.filter(b=>b.team===team);
  sel.innerHTML = list.map(b=>`<option value="${b.id}">${escHtml(b.name)}</option>`).join("") || "<option value=''>(belum ada batch)</option>";
  if(list.some(b=>b.id===cur)) sel.value = cur;
}
function refreshBaSiteSelect(){
  const batchId = document.getElementById("baBatch").value;
  const b = DB.batches.find(x=>x.id===batchId);
  const sel = document.getElementById("baSite");
  const cur = sel.value;
  const sites = b ? (b.schedule||[]).map(r=>r.site) : [];
  sel.innerHTML = sites.map(s=>`<option value="${escHtml(s)}">${escHtml(s)}</option>`).join("") || "<option value=''>(batch belum punya jadwal)</option>";
  if(sites.includes(cur)) sel.value = cur;
}
// Berita Acara Emisi dan Ambient (Udara Ambien/Kebisingan/Kebauan/Getaran) SENGAJA dipisah,
// tidak pernah digabung dalam satu dokumen — ditentukan dari Tim yang dipilih, bukan dari site.
// Kolom "Kategori" & judul dokumen ikut menyesuaikan biar tidak salah kaprah menyebut titik
// ambient sebagai "sumber emisi".
function baFilteredPoints(site, team, includeKebauan){
  let pts = DB.points.filter(p=>p.site===site);
  pts = pts.filter(p=> team==="emisi" ? p.kategori==="emisi" : AMBIENT_FAMILY.includes(p.kategori));
  if(team==="ambient" && !includeKebauan) pts = pts.filter(p=>p.kategori!=="kebauan" && p.kategori!=="getaran");
  return pts.sort((a,b)=>a.nama.localeCompare(b.nama));
}
function baTitleFor(team, includeKebauan){
  if(team==="emisi") return "PENGAMBILAN CONTOH UJI UDARA EMISI";
  return includeKebauan
    ? "PENGUKURAN KUALITAS UDARA AMBIEN, KEBISINGAN, KEBAUAN, DAN GETARAN"
    : "PENGUKURAN KUALITAS UDARA AMBIEN DAN KEBISINGAN";
}
function baKategoriLabelFor(p){
  return p.kategori==="emisi" ? (p.kategoriSumber||"-") : (NONEMISI_LABEL[p.kategori]||p.kategori);
}
// Urutan prioritas kategori khusus tampilan Berita Acara — kategori yang paling sering jadi FOKUS
// pemantauan wajib (Turbin, Flare, Gas Booster/Lift Compressor, H2S) ditaruh paling atas, baru
// diikuti jenis lain; lihat baKategoriSortRank di bawah utk logika lengkap (kategori berisi titik
// wajib SELALU didahulukan dari kategori isinya semua tidak-wajib, lepas dari daftar ini).
const BA_KATEGORI_PRIORITY = [
  "Turbine Engine Generator", "Turbine Engine Compressor",
  "Flare",
  "Gas Booster Compressor", "Gas Lift Compressor", "Gas Engine Generator",
  KATEGORI_SUMBER_FUEL_QUALITY
];
function baKategoriSortRank(kat, ptsInKat){
  const anyWajib = ptsInKat.some(p=>effectiveWajib(p)) ? 0 : 1;
  const prio = BA_KATEGORI_PRIORITY.indexOf(kat);
  return [anyWajib, prio<0?999:prio];
}
function renderBeritaAcara(){
  const cfg = ensureBaConfig();
  refreshBaBatchSelect();
  refreshBaSiteSelect();
  const team = document.getElementById("baTeam").value;
  document.getElementById("baIncludeKebauanWrap").style.display = team==="ambient" ? "flex" : "none";
  const includeKebauan = document.getElementById("baIncludeKebauan").checked;
  document.getElementById("baPageTitle").textContent = team==="emisi" ? "Berita Acara Pengambilan Contoh Uji Udara Emisi" : "Berita Acara Pengukuran Kualitas Udara Ambien & Kebisingan";
  if(!document.getElementById("baNamaPhm").dataset.touched){
    document.getElementById("baNamaPhm").value = cfg[team].namaPhm;
    document.getElementById("baJabatanPhm").value = cfg[team].jabatanPhm;
    document.getElementById("baNamaLabPerusahaan").value = cfg[team].labPerusahaan;
    document.getElementById("baNamaLab").value = cfg[team].namaLab;
    document.getElementById("baJabatanLab").value = cfg[team].jabatanLab;
    document.getElementById("baFooterNote").value = cfg[team].footerNote;
  }
  const batchId = document.getElementById("baBatch").value;
  const site = document.getElementById("baSite").value;
  const b = DB.batches.find(x=>x.id===batchId);
  const row = b ? (b.schedule||[]).find(r=>r.site===site) : null;
  if(row && !document.getElementById("baTanggalPelaksanaan").dataset.touched){
    document.getElementById("baTanggalPelaksanaan").value = row.start===row.end
      ? fmtHariTanggalIndo(row.start)
      : `${fmtHariTanggalIndo(row.start)} s.d. ${DOW_LABEL[dayOfWeek(row.end)]} ${fmtTanggalIndo(row.end)}`;
  }
  if(row && !document.getElementById("baTempatTanggal").dataset.touched){
    const signDate = addDays(row.end,1);
    document.getElementById("baTempatTanggal").value = `Lapangan ${site} PHM, ${fmtTanggalIndo(signDate)}`;
  }
  const pts = site ? baFilteredPoints(site, team, includeKebauan) : [];
  const titikHeader = team==="emisi" ? "Sumber Emisi (Titik Sampling)" : "Titik Sampling";
  // Ambient-family (ambient/kebisingan/kebauan/getaran) di lokasi yang sama digabung jadi 1 baris
  // (lihat groupPointsForDisplay, dipakai juga di Database Titik Pantau) — kolom yang beda per
  // parameter (Kewajiban Pemantauan, Status Pemantauan) ditumpuk di dalam sel yang sama, TIDAK
  // menghilangkan input per-parameter (tiap <input> tetap py data-point-id sendiri2, listener
  // "change" di bawah tetap kepakai apa adanya krn cuma cocokkan e.target, bukan peduli nesting).
  const groups = groupPointsForDisplay(pts);
  document.getElementById("baPreviewTable").innerHTML = pts.length ? `
    <thead><tr><th style="width:34px;">No</th><th>Lokasi</th><th>Kategori</th><th>${titikHeader}</th><th>Kewajiban Pemantauan</th><th>Status Pemantauan</th></tr></thead>
    <tbody>${groups.map((group,i)=>{ const p0 = group[0]; return `<tr>
      <td>${i+1}</td>
      <td>Lapangan ${escHtml(site)}</td>
      <td>${escHtml(baKategoriLabelFor(p0))}</td>
      <td>${escHtml(p0.nama)}</td>
      <td style="text-align:center;">${groupStackHtml(group, p=>frekuensiTextFor(p))}</td>
      <td>${groupStackHtml(group, p=>`<input type="text" class="baStatusInput" data-point-id="${p.id}" data-batch-id="${batchId}" value="${escHtml(baStatusFor(p, batchId))}" placeholder="(kosong, isi manual)" style="width:100%;min-width:180px;border:1px solid var(--gray-300);border-radius:4px;padding:4px 6px;font:inherit;">`)}</td>
    </tr>`; }).join("")}</tbody>` : "<div class='hint' style='padding:10px;'>Pilih Tim, Batch, dan Site yang sudah punya jadwal untuk melihat pratinjau.</div>";
}
// Kolom Status Pemantauan di pratinjau BA bisa diketik manual — override disimpan per (batch,
// titik) di b.baStatusOverrides & dibaca balik oleh baStatusFor (menang duluan dari semua logika
// otomatis), jadi ikut kepakai juga di HTML cetak/PDF-nya, bukan cuma tampilan di layar ini.
// Ngosongin isian = balik ke perhitungan otomatis lagi (bukan disimpan sbg teks kosong).
document.addEventListener("change", e=>{
  if(e.target.classList && e.target.classList.contains("baStatusInput")){
    const b = DB.batches.find(x=>x.id===e.target.dataset.batchId); if(!b) return;
    if(!b.baStatusOverrides) b.baStatusOverrides = {};
    const val = e.target.value.trim();
    if(val) b.baStatusOverrides[e.target.dataset.pointId] = val;
    else delete b.baStatusOverrides[e.target.dataset.pointId];
    save();
  }
});
["baTeam"].forEach(id=>document.getElementById(id).addEventListener("change", ()=>{
  ["baNamaPhm","baJabatanPhm","baNamaLabPerusahaan","baNamaLab","baJabatanLab","baFooterNote","baTanggalPelaksanaan","baTempatTanggal"].forEach(f=>delete document.getElementById(f).dataset.touched);
  refreshBaBatchSelect(); refreshBaSiteSelect(); renderBeritaAcara();
}));
["baBatch"].forEach(id=>document.getElementById(id).addEventListener("change", ()=>{
  ["baTanggalPelaksanaan","baTempatTanggal"].forEach(f=>delete document.getElementById(f).dataset.touched);
  refreshBaSiteSelect(); renderBeritaAcara();
}));
document.getElementById("baSite").addEventListener("change", ()=>{
  ["baTanggalPelaksanaan","baTempatTanggal"].forEach(f=>delete document.getElementById(f).dataset.touched);
  renderBeritaAcara();
});
document.getElementById("baIncludeKebauan").addEventListener("change", renderBeritaAcara);
// Field isian manual (nama/jabatan/tanggal) ditandai "touched" begitu user mengetik sendiri, supaya
// render ulang berikutnya (ganti site/batch) tidak menimpa balik apa yang baru saja diketik.
["baNamaPhm","baJabatanPhm","baNamaLabPerusahaan","baNamaLab","baJabatanLab","baFooterNote","baTanggalPelaksanaan","baTempatTanggal"].forEach(id=>{
  document.getElementById(id).addEventListener("input", e=>{
    e.target.dataset.touched = "1";
    const team = document.getElementById("baTeam").value;
    const cfg = ensureBaConfig();
    const map = {baNamaPhm:"namaPhm", baJabatanPhm:"jabatanPhm", baNamaLabPerusahaan:"labPerusahaan", baNamaLab:"namaLab", baJabatanLab:"jabatanLab", baFooterNote:"footerNote"};
    if(map[id]){ cfg[team][map[id]] = e.target.value; save(); }
  });
});
function buildBeritaAcaraHtml(){
  const team = document.getElementById("baTeam").value;
  const includeKebauan = document.getElementById("baIncludeKebauan").checked;
  const batchId = document.getElementById("baBatch").value;
  const site = document.getElementById("baSite").value;
  if(!site) return null;
  const pts = baFilteredPoints(site, team, includeKebauan);
  if(!pts.length) return null;
  const tanggalPelaksanaan = document.getElementById("baTanggalPelaksanaan").value;
  const tempatTanggal = document.getElementById("baTempatTanggal").value;
  const footerNote = document.getElementById("baFooterNote").value.trim();
  const namaPhm = document.getElementById("baNamaPhm").value;
  const jabatanPhm = document.getElementById("baJabatanPhm").value;
  const labPerusahaan = document.getElementById("baNamaLabPerusahaan").value;
  const namaLab = document.getElementById("baNamaLab").value;
  const jabatanLab = document.getElementById("baJabatanLab").value;
  const titikHeader = team==="emisi" ? "Sumber Emisi (Titik Sampling)" : "Titik Sampling";

  // Dikelompokkan per Kategori (jenis sumber emisi/ambient) — baris judul kelompok memisahkan
  // tiap kategori dgn jelas tanpa perlu bikin tabel terpisah-pisah (yang bikin thead/tfoot cetak
  // per halaman jadi ribet). Nomor urut tetap berjalan menerus dari 1 spt contoh BA yang sudah ada.
  // Emisi tetap diseksi per kategoriSumber persis spt semula (Turbin/Flare/dst TIDAK berubah) —
  // tapi seluruh ambient-family (ambient/kebisingan/kebauan/getaran) digabung jadi SATU seksi
  // "Ambient & Lingkungan" (pakai GRP_AMBIENT yg sama dgn Database Titik Pantau), supaya baris per
  // LOKASI-nya (lihat groupPointsForDisplay di bawah) tidak perlu dipecah ke 4 seksi berbeda yang
  // isinya lokasi yang sama berulang-ulang.
  const grouped = {};
  pts.forEach(p=>{ const k = p.kategori==="emisi" ? baKategoriLabelFor(p) : GRP_AMBIENT; (grouped[k]=grouped[k]||[]).push(p); });
  // Kategori berisi titik wajib pantau didahulukan drpd yg seluruhnya tidak-wajib, lalu di dalam
  // tiap kelompok itu diurutkan sesuai BA_KATEGORI_PRIORITY (Turbin/Flare/Gas Booster/H2S dulu),
  // sisanya alfabetis sbg fallback stabil — bukan alfabetis polos spt sebelumnya (yg bikin
  // "Diesel Engine..." nongol duluan drpd Flare/Turbin walau itu yg jadi fokus pemantauan).
  const kategoriList = Object.keys(grouped).sort((a,b)=>{
    const ra = baKategoriSortRank(a, grouped[a]), rb = baKategoriSortRank(b, grouped[b]);
    if(ra[0]!==rb[0]) return ra[0]-rb[0];
    if(ra[1]!==rb[1]) return ra[1]-rb[1];
    return a.localeCompare(b);
  });
  let rows = "", rowNum = 0;
  kategoriList.forEach(kat=>{
    rows += `<tr class="pg-ba-kategori-row"><td colspan="6">${escHtml(kat)}</td></tr>`;
    // Titik ambient-family di lokasi yang sama (mis. Ambient Udara + Kebisingan + Kebauan +
    // Getaran di "Kompleks Gunung Utara") jadi SATU baris — kolom Kategori/Kewajiban/Status yang
    // beda per parameter ditumpuk di dalam sel yang sama (lihat groupStackHtml), bukan diulang
    // jadi baris terpisah per parameter. Titik emisi (selalu grup 1 anggota) tampil apa adanya.
    groupPointsForDisplay(grouped[kat]).forEach(group=>{
      rowNum++;
      const p0 = group[0];
      rows += `<tr>
        <td>${rowNum}</td>
        <td>Lapangan ${escHtml(site)}</td>
        <td>${escHtml(baKategoriLabelFor(p0))}</td>
        <td>${escHtml(p0.nama)}</td>
        <td style="text-align:center;">${groupStackHtml(group, p=>frekuensiTextFor(p))}</td>
        <td>${groupStackHtml(group, p=>baStatusFor(p, batchId)||"&nbsp;")}</td>
      </tr>`;
    });
  });

  // Kepala dokumen (logo+judul+pembuka) SENGAJA di luar <table class="pg-ba-page"> supaya jadi
  // konten alir biasa yang cuma tampil SEKALI di halaman pertama — tidak ikut terulang di halaman
  // ke-2 dst (sesuai revisi: teks "BERITA ACARA...dst" hanya boleh muncul di awal dokumen).
  // .pg-ba-page sendiri kini cuma punya <tfoot> (pita merah, murni dekoratif) yg diulang browser
  // di SETIAP halaman cetak kalau <tbody>-nya (tabel titik sampling) meluber >1 halaman — header
  // kolom tabel (No/Lokasi/Kategori/dst) tetap terulang sendiri krn itu <thead> milik .pg-ba-table
  // yang nested di dalam tbody, terpisah dari mekanisme ini. Blok tanda tangan dibungkus 1 div
  // page-break-inside:avoid supaya "Demikian...” s/d nama terang tidak pernah terpotong tanggung
  // di sambungan halaman — kalau tidak muat di sisa halaman berjalan, browser otomatis dorong
  // seluruh blok itu ke halaman baru.
  return `<div class="pg-batch pg-ba">
    <div class="pg-ba-header-once">
      <div class="pg-ba-logos">
        <div class="pg-ba-logo-left"><img src="${LOGO_SKKMIGAS_B64}" alt="SKK Migas"></div>
        <div class="pg-ba-logo-right"><img src="${LOGO_PHM_B64}" alt="Pertamina Hulu Mahakam"></div>
      </div>
      <div class="pg-ba-title">
        <h1>BERITA ACARA</h1>
        <div class="sub">${baTitleFor(team, includeKebauan)}</div>
      </div>
      <div class="pg-ba-intro">Dengan ini menyatakan, bahwa telah dilakukan pengukuran ${team==="emisi"?"emisi dari sumber tidak bergerak":"kualitas lingkungan"} dalam rangka Kegiatan Pengendalian Pencemaran ${team==="emisi"?"Udara":"Lingkungan"}, pada:</div>
      <table class="pg-ba-meta"><tr><td style="width:150px;">Hari / Tanggal</td><td style="width:14px;">:</td><td>${escHtml(tanggalPelaksanaan)}</td></tr>
      <tr><td>Lokasi</td><td>:</td><td>Lapangan ${escHtml(site)} PT Pertamina Hulu Mahakam</td></tr></table>
      <div class="pg-ba-intro">Adapun titik lokasi yang dilakukan pengukuran adalah sebagai berikut:</div>
    </div>
    <table class="pg-ba-page">
      <tfoot><tr><td><img class="pg-ba-footer-band" src="${FOOTER_BAND_B64}" alt=""></td></tr></tfoot>
      <tbody><tr><td>
        <table class="pg-ba-table">
          <thead><tr><th style="width:28px;">No.</th><th>Lokasi</th><th>Kategori</th><th>${titikHeader}</th><th style="width:80px;">Kewajiban Pemantauan</th><th style="width:140px;">Status Pemantauan</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        ${footerNote ? `<div class="pg-ba-foot-note">${escHtml(footerNote)}</div>` : ""}
      </td></tr></tbody>
    </table>
    <div class="pg-ba-closing-block">
      <div class="pg-ba-closing">Demikian Berita Acara ini dibuat untuk dipergunakan sebagaimana mestinya.</div>
      <div style="text-align:right;margin-top:6px;">${escHtml(tempatTanggal)}</div>
      <div style="text-align:center;margin-top:22px;">Mengetahui,</div>
      <table class="pg-ba-sign"><tr>
        <td style="width:50%;">PT Pertamina Hulu Mahakam, ${escHtml(site)}</td>
        <td style="width:50%;">${escHtml(labPerusahaan)}</td>
      </tr>
      <tr><td class="sign-space"></td><td class="sign-space"></td></tr>
      <tr>
        <td><div class="sign-name">${escHtml(namaPhm)}</div><div>${escHtml(jabatanPhm)}</div></td>
        <td><div class="sign-name">${escHtml(namaLab)}</div><div>${escHtml(jabatanLab)}</div></td>
      </tr></table>
    </div>
  </div>`;
}
// Nama file usulan dialog "Simpan sebagai PDF" saat print — browser memakai document.title
// sebagai nama file bawaan, jadi diset sementara ke pola "BA {Tim}_{Site}_{Semester Tahun}_{Batch}"
// sebelum window.print() lalu dikembalikan setelahnya supaya judul tab/app tidak ikut berubah.
function baExportFilename(){
  const team = document.getElementById("baTeam").value;
  const site = document.getElementById("baSite").value || "Site";
  const batchId = document.getElementById("baBatch").value;
  const teamLabel = team==="emisi" ? "Emisi" : "Ambient";
  const b = DB.batches.find(x=>x.id===batchId);
  const batchNum = b ? (b.name.match(/Batch\s*(\d+)/)||[])[1] : "";
  return `BA ${teamLabel}_${site}_${DB.meta.semester} ${DB.meta.tahun}${batchNum?`_B${batchNum}`:""}`;
}
async function printBeritaAcara(){
  const html = buildBeritaAcaraHtml();
  if(!html){ toast("Pilih Tim, Batch, dan Site yang sudah punya jadwal &amp; titik terlebih dahulu.","err"); return; }
  // Margin kertas dilebihkan (18mm, bukan 12mm default) khusus dokumen resmi ini supaya logo &
  // teks kepala/kaki halaman punya jarak aman dari tepi kertas — beberapa printer fisik tidak bisa
  // benar-benar mencetak sampai tepi walau @page margin sudah diset, jadi margin ekstra ini jadi
  // buffer supaya tidak terlihat "kepotong".
  setPrintOrientation("portrait", 18);
  document.getElementById("printGuideArea").innerHTML = html;
  // window.print() dipanggil browser SEGERA setelah baris di atas kalau tidak ditunggu — <img> logo
  // & footer yang baru saja disuntik lewat innerHTML belum tentu selesai di-decode di titik itu
  // (walau src-nya data-URI, bukan network fetch, tetap ada proses decode async), jadi hasil cetak/
  // PDF bisa nangkap kondisi "masih kosong" itu meski di layar akhirnya tetap muncul normal. Nunggu
  // semua <img> selesai decode dulu sebelum print baru aman.
  const imgs = Array.from(document.querySelectorAll("#printGuideArea img"));
  await Promise.all(imgs.map(img=>{
    if(img.decode) return img.decode().catch(()=>{});
    if(img.complete) return Promise.resolve();
    return new Promise(res=>{ img.onload = res; img.onerror = res; });
  }));
  const originalTitle = document.title;
  document.title = baExportFilename();
  window.print();
  document.title = originalTitle;
}

