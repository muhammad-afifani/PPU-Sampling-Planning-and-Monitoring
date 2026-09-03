/* =========================================================
   DATA PAGE
========================================================= */
// `fetch(url, {cache:"no-store"})` cuma matiin cache LOKAL browser — file backup lengkap dari
// online (checkFullBackupUpdate/checkRepoBackupUpdate di bawah) biasanya diambil lewat
// raw.githubusercontent.com, yang jalan di belakang CDN (Fastly) dgn cache sendiri yg TIDAK peduli
// header cache browser sama sekali. Efeknya: push backup baru ke repo lalu LANGSUNG ambil dari
// perangkat lain bisa saja masih dapat versi lama dari CDN edge selama beberapa menit — persis
// gejala "sudah export yang terbaru tapi pas di-import di device lain datanya lama/kosong". Query
// param unik di URL (nilainya tidak dipakai server, cuma bikin URL-nya beda tiap panggilan) memaksa
// CDN anggap ini request baru & ambil ulang dari origin — teknik yg sama dipakai utk cache-busting
// asset CSS/JS lokal (lihat ?v= di index.html).
function cacheBustUrl(url){
  return url + (url.includes("?") ? "&" : "?") + "_cb=" + Date.now();
}
// Ringkasan isi file SEBELUM di-download — supaya user bisa cek sendiri dgn mata "file yg baru
// aku buat ini beneran isinya lengkap ya" TANPA harus kirim dulu ke laptop lain buat tahu, karena
// mekanisme export/import-nya sendiri sudah diverifikasi benar berkali-kali; kalau ada yg hilang,
// gejalanya akan kelihatan di ringkasan INI, bukan baru ketahuan pas dibuka di laptop lain.
function exportAll(){
  const finalizedCount = DB.batches.filter(b=>b.finalized).length;
  const summary = `Mengekspor: ${DB.points.length} titik, ${DB.batches.length} batch (${finalizedCount} sudah final), ${DB.personil.length} personil, ${DB.hasilPemantauan.length} data hasil pemantauan, ${Object.keys(DB.tracking||{}).length} tracking. Dari session browser INI — cek angkanya sesuai yang kamu kerjakan sebelum dikirim ke laptop lain.`;
  toast(summary, DB.batches.length ? "ok" : "err");
  downloadBlob(JSON.stringify(DB,null,2), `phm_emisi_backup_${todayStr()}.json`, "application/json");
}
// Satu handler dipakai bareng utk 2 jalur backup-lengkap (pilih file, cek update online) — supaya
// validasi & cara terapnya identik di manapun sumbernya. Selalu tampilkan perbandingan "punya kamu
// vs isi file" dulu sebelum tombol tegas "Timpa" diklik — tidak ada auto-apply diam-diam, walaupun
// datang dari fetch online.
let pendingFullBackup = null;
function handleFullBackupPackage(data, sourceLabel){
  // Cek bentuknya benar-benar backup lengkap (bukan file lain yg kebetulan valid JSON) SEBELUM
  // menimpa apapun — kalau field inti (batches/personil/meta) hilang, migrateDB() akan mengisinya
  // dengan DEFAULT KOSONG, alias diam-diam MENGHAPUS semua batch/tracking yang ada tanpa peringatan
  // sama sekali. Ditolak tegas di sini drpd nanti nyaring lewat gejala "kok data hilang" yang membingungkan.
  const looksLikeFullBackup = data && typeof data==="object" && Array.isArray(data.points) && Array.isArray(data.batches) && Array.isArray(data.personil) && data.meta && typeof data.meta==="object";
  if(!looksLikeFullBackup){
    toast('File/link ini sepertinya bukan backup lengkap yang valid (field points/batches/personil/meta tidak lengkap) — import dibatalkan supaya data kamu saat ini tidak ikut hilang/tertimpa.',"err");
    return;
  }
  pendingFullBackup = {data, sourceLabel};
  const curFinalized = DB.batches.filter(b=>b.finalized).length;
  const newFinalized = data.batches.filter(b=>b.finalized).length;
  openModal(`
    <h3>Restore Backup Lengkap</h3>
    <p class="hint"><b>Data kamu SAAT INI</b> (akan hilang kalau lanjut): ${DB.points.length} titik, ${DB.batches.length} batch (${curFinalized} final), ${DB.personil.length} personil, ${Object.keys(DB.tracking||{}).length} tracking.</p>
    <p class="hint"><b>Data DARI "${escHtml(sourceLabel)}"</b>: ${data.points.length} titik, ${data.batches.length} batch (${newFinalized} final), ${data.personil.length} personil, ${Object.keys(data.tracking||{}).length} tracking.</p>
    <p style="font-weight:700;color:#a02a24;">Ini akan MENIMPA SELURUH data kamu saat ini dengan data di atas. Ada snapshot pengaman otomatis sebelum diterapkan (bisa di-undo lewat Riwayat &amp; Restore kalau salah pilih).</p>
    <div class="actions">
      <button class="btn ghost" data-action="closeModal">Batal</button>
      <button class="btn danger" data-action="applyFullBackupImport">Timpa dengan Data Ini</button>
    </div>
  `);
}
function applyFullBackupImport(){
  const pending = pendingFullBackup; if(!pending) return;
  const {data, sourceLabel} = pending;
  snapshotBefore(`Sebelum import backup "${sourceLabel}"`);
  const keepSnapshots = DB.snapshots, keepLog = DB.activityLog;
  DB = data;
  migrateDB();
  if(!DB.snapshots.length) DB.snapshots = keepSnapshots; else DB.snapshots = keepSnapshots.concat(DB.snapshots).slice(0,8);
  if(!DB.activityLog.length) DB.activityLog = keepLog;
  logChange(`Import backup dari "${sourceLabel}"`);
  save();
  closeModal();
  // Ringkasan APA YANG BENERAN MASUK setelah restore — sama spt ringkasan di exportAll(), supaya
  // kalau ada yang hilang/tidak sesuai harapan, kelihatan LANGSUNG di sini, bukan baru sadar
  // belakangan pas buka halaman lain satu-satu.
  const finalizedCount = DB.batches.filter(b=>b.finalized).length;
  toast(`Restore berhasil dari "${sourceLabel}": ${DB.points.length} titik, ${DB.batches.length} batch (${finalizedCount} sudah final), ${DB.personil.length} personil, ${Object.keys(DB.tracking||{}).length} tracking.`,"ok");
  showPage("dashboard");
  pendingFullBackup = null;
}
document.getElementById("importAllFile").addEventListener("change", e=>{
  const file = e.target.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = ()=>{
    try{ handleFullBackupPackage(JSON.parse(reader.result), file.name); }
    catch(err){ toast("File tidak valid: "+err.message,"err"); }
  };
  reader.readAsText(file);
});
async function checkFullBackupUpdate(){
  const url = document.getElementById("fullBackupUrl").value.trim();
  if(!url){ toast("Isi dulu URL backup lengkap.","err"); return; }
  try{
    const res = await fetch(cacheBustUrl(url), {cache:"no-store"});
    if(!res.ok) throw new Error("HTTP "+res.status);
    const data = await res.json();
    handleFullBackupPackage(data, url.split("/").pop()||url);
  }catch(err){
    toast('Gagal mengambil data online: '+err.message+'. Kalau file ini dibuka langsung dari folder (bukan lewat alamat web), browser menolak koneksi online-nya — pakai "Pilih File" sebagai gantinya.',"err");
  }
}
// Repo tempat aplikasi ini di-hosting (GitHub Pages) — dipakai utk cari otomatis file backup
// terbaru di root repo, TANPA perlu simpan/perbarui nama file atau tanggal secara manual di kode
// ini. exportAll() selalu menamai file dgn pola phm_emisi_backup_YYYY-MM-DD.json (lihat di atas),
// jadi begitu file baru diunggah ke repo dgn nama itu, tombol "Ambil Data Terbaru dari Repository"
// otomatis ketemu & pakai yang tanggalnya paling baru — tidak ada lagi link/nama file yg jadi basi
// kalau lupa diperbarui satu-satu tiap kali ada backup baru (masalah nyata di versi sebelumnya,
// lihat riwayat commit ONBOARDING_BACKUP_URL).
const REPO_CONTENTS_API = "https://api.github.com/repos/muhammad-afifani/PPU-Sampling-Planning-and-Monitoring/contents/";
const BACKUP_FILENAME_RE = /^phm_emisi_backup_\d{4}-\d{2}-\d{2}\.json$/;
async function checkRepoBackupUpdate(){
  try{
    const res = await fetch(cacheBustUrl(REPO_CONTENTS_API), {cache:"no-store"});
    if(!res.ok) throw new Error("HTTP "+res.status);
    const files = await res.json();
    const backups = (Array.isArray(files)?files:[]).filter(f=>BACKUP_FILENAME_RE.test(f.name));
    if(!backups.length) throw new Error('Tidak ada file "phm_emisi_backup_YYYY-MM-DD.json" di root repository.');
    // Nama file mengandung tanggal format ISO (YYYY-MM-DD), jadi urutan string = urutan tanggal —
    // tidak perlu parsing tanggal terpisah.
    backups.sort((a,b)=> b.name.localeCompare(a.name));
    const latest = backups[0];
    const dataRes = await fetch(cacheBustUrl(latest.download_url), {cache:"no-store"});
    if(!dataRes.ok) throw new Error("HTTP "+dataRes.status);
    const data = await dataRes.json();
    handleFullBackupPackage(data, latest.name);
  }catch(err){
    toast('Gagal mengambil data terbaru dari repository: '+err.message+'. Kalau aplikasi ini dibuka langsung dari folder (bukan lewat alamat web), browser menolak koneksi online-nya — pakai "Pilih File" sebagai gantinya.',"err");
  }
}

/* =========================================================
   TUR ONBOARDING (pertama kali buka tools ini)
   ---------------------------------------------------------
   Tools ini masih prototipe — belum ada server pusat, jadi org yg baru pertama kali buka file
   HTML-nya cuma lihat data kosong/bawaan sampai mereka manual narik backup terbaru lewat kartu
   Backup Lengkap. Tur ini nuntun 1x saja (ditandai DB.meta.onboardingSeen, lihat migrateDB) supaya
   user baru tidak bingung harus ngapain, tanpa ganggu user yg sudah pernah pakai.
========================================================= */
// Dipisah dari maybeShowOnboarding() supaya HTML-nya bisa dipakai ulang dari tombol "Lihat Panduan
// Update Data" di modal Tentang (replayOnboarding) tanpa duplikasi isi.
function renderOnboardingModal(){
  openModal(`
    <h3>👋 Selamat Datang di PHM Emission Sampling Planner</h3>
    <p>Apakah ini pertama kali mengakses aplikasi prototipe ini?</p>
    <p class="hint">Aplikasi ini masih tahap pengembangan (prototipe) — belum ada server pusat yang otomatis menyinkronkan data ke semua pengguna. Agar langsung menampilkan jadwal dan data terbaru (bukan data kosong bawaan), diperlukan satu kali update data dari repository. Klik "Mulai Update Data" di bawah — data terbaru akan diambil otomatis, dan ringkasan perbandingannya ditampilkan lebih dulu sebelum diterapkan.</p>
    <div class="actions">
      <button class="btn ghost" data-action="dismissOnboarding">Lewati (bukan pertama kali)</button>
      <button class="btn primary" data-action="startOnboardingUpdate">Mulai Update Data</button>
    </div>
  `);
}
function maybeShowOnboarding(){
  if(DB.meta.onboardingSeen) return;
  renderOnboardingModal();
}
function dismissOnboarding(){ DB.meta.onboardingSeen = true; save(); closeModal(); }
function replayOnboarding(){ renderOnboardingModal(); }
function openAboutModal(){
  openModal(`
    <h3>&#8505;&#65039; Tentang Tools Ini</h3>
    <p style="font-size:13px;line-height:1.7;">PHM Emission Sampling Planner &amp; Tracker adalah tools prototipe untuk membantu perencanaan, penjadwalan, dan pelacakan pemantauan emisi &amp; udara ambien di lingkungan kerja PHM — mulai dari database titik pantau, perencanaan batch &amp; jadwal Gantt, hingga Berita Acara. Tools ini masih dalam tahap pengembangan aktif.</p>
    <p style="font-size:13px;">Dibuat oleh <b>Muhammad Afifani Romadhan</b>.</p>
    <div class="actions" style="flex-wrap:wrap;">
      <button class="btn ghost" data-action="closeModal">Tutup</button>
      <button class="btn ghost" data-action="replayOnboarding">Lihat Panduan Update Data</button>
      <a href="https://muhammad-afifani.github.io/Portofolio/" target="_blank" rel="noopener" class="btn primary">Lihat Portofolio / CV &rarr;</a>
    </div>
  `);
}
function startOnboardingUpdate(){
  DB.meta.onboardingSeen = true; save();
  closeModal();
  showPage("data");
  checkRepoBackupUpdate();
}

function resetDefault(){
  askConfirm("Reset ke data default (139 sumber emisi PHM + ambient default)? Data batch/tracking saat ini akan hilang.", ()=>{
    snapshotBefore("Sebelum reset ke data default");
    const keepSnapshots = DB.snapshots, keepLog = DB.activityLog;
    DB = freshDB();
    DB.snapshots = keepSnapshots; DB.activityLog = keepLog;
    logChange("Reset data ke default (139 sumber emisi PHM + ambient default)");
    save(); toast("Data direset ke default.","ok"); showPage("dashboard");
  });
}
function resetEmpty(){
  askConfirm("Reset TOTAL ke kosong? Semua data termasuk master titik pantau akan dihapus.", ()=>{
    snapshotBefore("Sebelum reset total (kosong)");
    const keepSnapshots = DB.snapshots, keepLog = DB.activityLog;
    DB = freshDB(); DB.points=[];
    DB.snapshots = keepSnapshots; DB.activityLog = keepLog;
    logChange("Reset total — semua data (termasuk master titik pantau) dikosongkan");
    save(); toast("Data dikosongkan total.","ok"); showPage("dashboard");
  });
}
function downloadTemplatePoints(){
  csvExport(["id","site","kategori","nama","kategoriSumber","regulasi","parameter","parameterCatatan","wajib","frekuensiBulan","tidakBeroperasi","alasanTidakWajib","kapasitas","kapasitasKW","jenisBahanBakar","runningHour","pemantauanTerakhir","prediksiBerikutnya","lastSampling"], [], "template_titik_pantau.csv");
}
function downloadTemplatePersonil(){
  csvExport(["nama","role","ktpExp","mcuExp","spkExp","medpassExp","clsrExp","ppcExp","fotoBiruAda","bosietExp","vaksinAda","ptsidExp"], [], "template_personil.csv");
}

