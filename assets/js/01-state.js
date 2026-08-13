/* =========================================================
   DB / STATE
========================================================= */
let DB = null;

function freshDB(){
  const now = new Date();
  return {
    meta:{semester: (now.getMonth()<6?"S1":"S2"), tahun: now.getFullYear(), lastBatchIdEmisi:0, lastBatchIdAmbient:0, regDataVersion:2, onboardingSeen:false},
    points: [...DEFAULT_ENGINES.map(e=>({...e, status:"pending", batchId:"", planStart:"", planEnd:"", actualStart:"", actualEnd:"", team:"emisi", keterangan:""})),
             ...DEFAULT_AMBIENT.map(a=>({...a}))],
    personil: [],
    siteRules: JSON.parse(JSON.stringify(DEFAULT_SITE_RULES)),
    routeAmbient: [...DEFAULT_ROUTE_AMBIENT],
    routeEmisi: [...DEFAULT_ROUTE_EMISI],
    batches: [],
    tracking: {},
    komStatus: {},
    activityLog: [],
    snapshots: [],
    pointCoords: {...POINT_COORDS},
    coordVerification: {},
    rhMonths: [...RH_MONTHS_DEFAULT],
    rhMonthly: JSON.parse(JSON.stringify(RH_MONTHLY_DEFAULT)),
    hasilPemantauan: [...DEFAULT_HASIL_PEMANTAUAN]
  };
}
function uid(pfx){ return pfx+"_"+Math.random().toString(36).slice(2,9); }

// Safety defaults untuk field yang mungkin belum ada di data lama (localStorage lama atau file
// backup JSON dari versi sebelumnya) — dipanggil tiap kali DB diganti dari sumber luar.
function migrateDB(){
  if(!DB.tracking) DB.tracking = {};
  if(!DB.hasilPemantauan) DB.hasilPemantauan = [...DEFAULT_HASIL_PEMANTAUAN];
  if(!DB.batches) DB.batches = [];
  if(!DB.routeAmbient) DB.routeAmbient = [...DEFAULT_ROUTE_AMBIENT];
  if(!DB.routeEmisi) DB.routeEmisi = [...DEFAULT_ROUTE_EMISI];
  // BPN ditambahkan belakangan ke rute Emisi (awalnya cuma di rute Ambient) — jaga-jaga kalau
  // ada engine kedaruratan di BPN yang jadi wajib pantau (>200 jam/tahun). Sesi lama yang sudah
  // punya routeEmisi tersimpan (tanpa BPN) tidak kena baris di atas krn arraynya sudah ada, jadi
  // ditambahkan eksplisit di sini, di akhir urutan supaya tidak mengacak urutan rute yg sudah biasa dipakai.
  if(!DB.routeEmisi.includes("BPN")) DB.routeEmisi.push("BPN");
  if(!DB.komStatus) DB.komStatus = {}; // KOM sekarang per (batch,site), bukan per titik
  if(!DB.activityLog) DB.activityLog = [];
  if(!DB.snapshots) DB.snapshots = [];
  if(!DB.pointCoords) DB.pointCoords = {...POINT_COORDS};
  if(!DB.coordVerification) DB.coordVerification = {};
  if(!DB.rhMonths) DB.rhMonths = [...RH_MONTHS_DEFAULT];
  if(!DB.rhMonthly) DB.rhMonthly = JSON.parse(JSON.stringify(RH_MONTHLY_DEFAULT));
  if(!DB.meta) DB.meta = {semester:"S1", tahun:new Date().getFullYear(), lastBatchIdEmisi:0, lastBatchIdAmbient:0};
  if(DB.meta.currentPeriod!==undefined) delete DB.meta.currentPeriod; // field lama, tidak dipakai lagi — diganti meta.semester+meta.tahun
  // Tur onboarding "pertama kali buka tools ini" cuma utk sesi yg BENAR2 baru (freshDB, belum
  // pernah ada data sama sekali) — sesi yg sudah pernah jalan sebelumnya (lewat baris migrateDB
  // manapun, termasuk yg baru pertama kali dapat field ini) dianggap "sudah pernah lihat", supaya
  // tidak muncul tiba-tiba ke user yang sudah lama pakai tools ini.
  if(DB.meta.onboardingSeen===undefined) DB.meta.onboardingSeen = true;
  DB.batches.forEach(b=>{ if(!b.assignedPersonil) b.assignedPersonil = []; });
  // Batch lama belum punya field period terstruktur — sebelumnya checklist Dashboard mencocokkan
  // batch ke periode dgn cara rapuh (cari substring "S2 2026" dst di dalam b.name bebas-teks), yang
  // gagal senyap begitu ada batch yg dibuat lewat "Kirim ke Batch" di halaman Plan Pemantauan dgn
  // dropdown periode BEDA dari periode aktif saat itu — akibatnya langkah "Personil Ditunjuk untuk
  // Batch" di Dashboard tetap abu-abu walau personil sudah ditunjuk di Perencanaan Batch. Diperbaiki
  // dgn field b.period eksplisit (lihat newBatch/sendPlanToBatch); baris ini isi field itu utk batch
  // yg sudah ada, ambil dari pola "S1/S2 <tahun>" di namanya (format lama selalu menyisipkan itu).
  DB.batches.forEach(b=>{
    if(b.period) return;
    const m = (b.name||"").match(/S[12]\s+\d{4}/);
    b.period = m ? m[0] : currentPeriodStr();
  });
  DB.batches.forEach(b=>{
    if(!b.dayOverrides) b.dayOverrides = {};
    if(b.finalized===undefined) b.finalized = false;
    if(b.finalizedAt===undefined) b.finalizedAt = null;
    if(!b.baStatusOverrides) b.baStatusOverrides = {};
    if(!b.excluded) b.excluded = [];
    // Alasan titik dikeluarkan dari batch ini (lihat papan Detail Harian di Gantt) — terpisah dari
    // b.excluded (yang cuma daftar ID) supaya bisa dicatat KENAPA: masuk batch berikutnya, atau
    // sumbernya sendiri tidak beroperasi (TBC kapan tersedia lagi). Murni catatan/dokumentasi,
    // tidak memengaruhi logika penjadwalan.
    if(!b.excludeReasons) b.excludeReasons = {};
    (b.schedule||[]).forEach(row=>{ if(row.dayDetailNote===undefined) row.dayDetailNote = ""; });
  });
  // Migrasi sekali: KOM dulu di-key per (batchId,site) — diganti ke (periode,site) supaya batch
  // Emisi & Ambient yang mengunjungi site sama di periode sama otomatis gabung jadi 1 baris/catatan
  // KOM (lihat komKey di tracking). Entry lama dipetakan ke periode batch aslinya; kalau 2 entry
  // lama kebetulan jatuh ke key baru yang sama (batch Emisi & Ambient sama-sama sudah dicatat
  // KOM-nya terpisah), digabung — bukan saling timpa.
  if(!DB.meta.komMigratedV2){
    const migrated = {};
    Object.keys(DB.komStatus).forEach(oldKey=>{
      const [batchId, site] = oldKey.split("::");
      const b = DB.batches.find(x=>x.id===batchId);
      const newKey = komKey(b ? b.period : "(periode tidak diketahui)", site);
      const entry = DB.komStatus[oldKey];
      const existing = migrated[newKey];
      migrated[newKey] = existing ? {
        done: existing.done || entry.done,
        date: [existing.date, entry.date].filter(Boolean).sort().pop() || "",
        attendees: [existing.attendees, entry.attendees].filter(Boolean).join("\n"),
        notes: [existing.notes, entry.notes].filter(Boolean).join("\n")
      } : entry;
    });
    DB.komStatus = migrated;
    DB.meta.komMigratedV2 = true;
  }
  DB.personil.forEach(p=>{ if(p.dokumentasiLink===undefined) p.dokumentasiLink = ""; });
  DB.points.forEach(p=>{
    if(p.groupOverride===undefined) p.groupOverride = "";
    if(p.holdReason===undefined) p.holdReason = "";
    if(p.lastVerified===undefined) p.lastVerified = null;
    if(p.updatedAt===undefined) p.updatedAt = null;
  });
  // Backfill sekali: titik Ambient/Kebisingan/Kebauan/Getaran yg sudah ada Pemantauan Terakhirnya
  // tapi kolom Prediksi Berikutnya masih kosong — siklusnya tetap 6 bulan, jadi bisa dihitung
  // otomatis (lihat nextPeriodAfter), tidak perlu dibuka+disimpan manual satu-satu lewat form
  // supaya isian lama ikut lengkap. Tidak menimpa yg sudah terisi manual.
  DB.points.forEach(p=>{
    if(AMBIENT_FAMILY.includes(p.kategori) && p.pemantauanTerakhir && !p.prediksiBerikutnya){
      p.prediksiBerikutnya = nextPeriodAfter(p.pemantauanTerakhir, p.frekuensiBulan||6);
    }
  });
  // Sesi lama (data sudah tersimpan di localStorage sebelum koreksi baku mutu/periode pantau)
  // disinkronkan ulang SEKALI dari data default terbaru (dicocokkan lewat nama), versi-kan supaya
  // tidak menimpa ulang perubahan manual user pada field ini di kemudian hari.
  // v1: pita kapasitas 100/500/1000/3000 kW (dulu keliru pakai ambang 570 kWth)
  // v2: angka baku mutu persis + metode SNI di catatan, param Gas 500-1000/1000-3000 KW (hapus
  //     Total Partikulat yang salah), dan periode pantau (100-500=3th, 500-1000=1th, >=1000=6bln;
  //     Turbin/Flare/Heater/Glycol Reboiler Permen LH 13/2009 = 6 bulan semua).
  // v3: Turbine Engine Generator dikoreksi jadi 1x/tahun (12 bulan) — v2 keliru menyamaratakan
  //     SEMUA "Turbin" (Generator maupun Compressor) jadi 6 bulan; yang benar cuma Turbine Engine
  //     Compressor/Flare/Heater/Glycol Reboiler yang 6 bulan, Turbine Engine Generator 1x/tahun.
  const REG_DATA_VERSION = 3;
  if((DB.meta.regDataVersion||0) < REG_DATA_VERSION){
    const defaultByName = {};
    DEFAULT_ENGINES.forEach(e=>{ defaultByName[e.nama.trim()] = e; });
    DB.points.forEach(p=>{
      const def = defaultByName[(p.nama||"").trim()];
      if(!def) return;
      p.kategoriKapasitas = def.kategoriKapasitas;
      p.parameterCatatan = def.parameterCatatan;
      p.parameter = def.parameter;
      p.frekuensiBulan = def.frekuensiBulan;
    });
    DB.meta.regDataVersion = REG_DATA_VERSION;
  }
  // Titik & data hasil pemantauan Kandungan Sulfur (H2S) ditambahkan belakangan ke referensi
  // default (dasar Pasal 12 ayat (2) huruf b Permen LH 13/2009) — sesi lama yang sudah berjalan
  // (sudah punya batch/tracking sendiri) perlu DIGABUNGKAN datanya, bukan direset total, supaya
  // kerjaan user yang sudah ada tidak hilang cuma karena mau lihat referensi baru ini.
  if(!DB.meta.h2sDataMerged){
    const existingIds = new Set(DB.points.map(p=>p.id));
    const newPoints = DEFAULT_ENGINES.filter(p=>p.id.startsWith("ENG_H2S_") && !existingIds.has(p.id));
    if(newPoints.length) DB.points.push(...newPoints);
    const existingHasilIds = new Set(DB.hasilPemantauan.map(r=>r.id));
    const newHasil = DEFAULT_HASIL_PEMANTAUAN.filter(r=>r.parameter==="H2S" && !existingHasilIds.has(r.id));
    if(newHasil.length) DB.hasilPemantauan.push(...newHasil);
    if(newPoints.length || newHasil.length) logChange(`Menggabungkan referensi baru: ${newPoints.length} titik & ${newHasil.length} data hasil pemantauan Kandungan Sulfur (H2S), sesuai Pasal 12 ayat (2) huruf b Permen LH 13/2009`);
    DB.meta.h2sDataMerged = true;
  }
}
function load(){
  const raw = localStorage.getItem(STORAGE_KEY);
  if(raw){ try{ DB = JSON.parse(raw); }catch(e){ DB = freshDB(); } }
  else { DB = freshDB(); }
  migrateDB();
  updateStorageUsageBadge();
  probeRealStorageQuota();
}
// Kalau localStorage penuh (QuotaExceededError), penyebab paling umum adalah DB.snapshots —
// tiap snapshot (lihat snapshotBefore) adalah salinan PENUH seluruh database, dibuat otomatis
// sebelum operasi berisiko (generate/hitung ulang jadwal, import, dst). Sebelum menyerah & bikin
// operasi yg sedang berjalan gagal total, coba buang snapshot TERLAMA dulu (paling aman utk
// dikorbankan drpd data operasional titik/tracking/hasil pemantauan) & ulangi — baru kalau itupun
// tetap tidak cukup, lempar error apa adanya spy pemanggil (yg mayoritas sudah dibungkus try/catch)
// bisa tampilkan pesannya ke user.
function save(){
  try{
    localStorage.setItem(STORAGE_KEY, JSON.stringify(DB));
    updateStorageUsageBadge();
  }catch(err){
    const isQuotaErr = err && (err.name==="QuotaExceededError" || err.code===22 || err.code===1014);
    if(!isQuotaErr) throw err;
    const droppedCount = (DB.snapshots||[]).length;
    while(DB.snapshots && DB.snapshots.length){
      DB.snapshots.pop();
      try{
        localStorage.setItem(STORAGE_KEY, JSON.stringify(DB));
        updateStorageUsageBadge();
        toast(`Penyimpanan browser hampir penuh — ${droppedCount-DB.snapshots.length} snapshot riwayat lama dihapus otomatis utk mengosongkan ruang (data titik/tracking/hasil pemantauan tidak terpengaruh). Cek halaman Riwayat & Restore.`,"err");
        return;
      }catch(err2){
        if(!(err2 && (err2.name==="QuotaExceededError" || err2.code===22 || err2.code===1014))) throw err2;
      }
    }
    updateStorageUsageBadge();
    toast("Penyimpanan browser (localStorage) penuh dan semua snapshot riwayat sudah dikosongkan otomatis, tapi tetap belum cukup. Buka menu Data (Import/Export) → Export Semua Data utk backup, lalu hapus data lama yang tidak perlu (mis. Hasil Pemantauan periode sangat lampau) utk mengosongkan ruang.","err");
    throw err;
  }
}
// "MB terpakai" SELALU angka ASLI (bukan prediksi) — ukuran byte sebenarnya dari string DB yang
// tersimpan di localStorage saat ini (new Blob().size), dihitung ulang tiap load()/save() berhasil
// jadi otomatis kekinian tanpa perlu direfresh manual. Yang tadinya cuma perkiraan adalah PENYEBUT-nya
// (kapasitas maksimum) — localStorage sendiri tidak punya API standar utk tanya batas pastinya,
// jadi dulu dipakai asumsi konservatif 5MB. Browser modern (Chrome/Edge/Firefox) sebenarnya expose
// Storage API (navigator.storage.estimate()) yang memberi kuota ASLI per-origin (mencakup seluruh
// penyimpanan origin ini, bukan cuma key localStorage kita, tapi origin ini memang cuma pakai
// localStorage) — biasanya jauh lebih besar dari 5MB (ratusan MB-GB, tergantung disk kosong), jadi
// dipakai KALAU berhasil didapat (async, sekali per load, di-cache). Kalau API-nya tidak ada/gagal
// (browser lama, atau context file:// yang originnya "null" di sebagian browser), fallback diam2 ke
// asumsi 5MB lama supaya badge tetap tampil masuk akal.
const STORAGE_QUOTA_ASSUMED_BYTES = 5*1024*1024;
let REAL_QUOTA_BYTES = null;
function probeRealStorageQuota(){
  if(!(navigator.storage && navigator.storage.estimate)) return;
  navigator.storage.estimate().then(est=>{
    if(est && est.quota){ REAL_QUOTA_BYTES = est.quota; updateStorageUsageBadge(); }
  }).catch(()=>{ /* API ada tapi gagal (mis. origin file:// dibatasi) — tetap pakai asumsi 5MB */ });
}
function fmtBytesHuman(bytes){
  const mb = bytes/1024/1024;
  if(mb>=1024) return (mb/1024).toFixed(1)+" GB";
  return (mb>=10?Math.round(mb):mb.toFixed(1))+" MB";
}
function storageUsageInfo(){
  const raw = localStorage.getItem(STORAGE_KEY) || "";
  const bytes = new Blob([raw]).size;
  const quota = REAL_QUOTA_BYTES || STORAGE_QUOTA_ASSUMED_BYTES;
  const pct = Math.min(100, Math.round(bytes/quota*100));
  return {bytes, pct, quota, isReal: !!REAL_QUOTA_BYTES};
}
function updateStorageUsageBadge(){
  const {bytes, pct, quota, isReal} = storageUsageInfo();
  const mb = (bytes/1024/1024).toFixed(2);
  const color = pct>=85 ? "var(--red-500)" : pct>=60 ? "var(--amber-500)" : "var(--teal-400)";
  const quotaLabel = isReal
    ? `dari &#8776;${fmtBytesHuman(quota)} kuota browser aktual (${pct}%)`
    : `(&#8776;${pct}% dari perkiraan kapasitas browser — kuota aktual blm bisa dibaca di browser ini)`;
  [document.getElementById("storageUsageBadge"), document.getElementById("storageUsageBadgeRiwayat")].forEach(el=>{
    if(!el) return;
    el.innerHTML = `<span>~${mb} MB terpakai ${quotaLabel}</span><div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${color};"></div></div>`;
  });
}
// Pencatatan "terakhir diupdate" per kategori dataset yang punya kebutuhan CSV (import/export),
// dipakai oleh daftar dataset di halaman Data (Import/Export) supaya terlihat mana yang sudah lama
// tidak diperbarui. Dipanggil di titik mutasi utama tiap dataset (import CSV, tambah/ubah/hapus data,
// atau reset), bukan pada setiap pemanggilan save() yang terlalu umum untuk kebutuhan ini.
const DATASET_LABELS = {
  points: "Database Titik Pantau",
  personil: "Personil PPC & Observer",
  coords: "Koordinat Titik Pantau",
  hasilPemantauan: "Hasil Pemantauan (Database Hasil Pemantauan)",
  rh: "Running Hour Harian",
  rhMonthly: "Running Hour Bulanan",
  tracking: "Tracking BA / CoA"
};
function touchDataset(key){
  if(!DB.meta) DB.meta = {};
  if(!DB.meta.datasetUpdatedAt) DB.meta.datasetUpdatedAt = {};
  DB.meta.datasetUpdatedAt[key] = new Date().toISOString();
}
function formatRelativeTime(iso){
  const then = new Date(iso).getTime();
  if(!isFinite(then)) return null;
  const days = Math.floor((Date.now()-then)/86400000);
  if(days<=0) return "hari ini";
  if(days===1) return "kemarin";
  if(days<30) return `${days} hari yang lalu`;
  if(days<365) return `${Math.floor(days/30)} bulan yang lalu`;
  return `${Math.floor(days/365)} tahun yang lalu`;
}
const DATASET_PAGE = {points:"master", personil:"personil", coords:"lokasi", hasilPemantauan:"hasildb", rh:"runninghour", rhMonthly:"runninghour", tracking:"tracking"};
const DATASET_PAGE_LABEL = {master:"Database Titik Pantau", personil:"Personil PPC & Observer", lokasi:"Lokasi Titik Pantau", hasildb:"Database Hasil Pemantauan", runninghour:"Running Hour Detail", tracking:"Tracking BA / CoA"};
function datasetCount(key){
  if(key==="points") return DB.points.length;
  if(key==="personil") return DB.personil.length;
  if(key==="coords") return Object.keys(DB.pointCoords||{}).length;
  if(key==="hasilPemantauan") return DB.hasilPemantauan.length;
  if(key==="rh") return DB.points.filter(p=>p.kategori==="emisi" && p.runningHour!=null).length;
  if(key==="rhMonthly") return Object.keys(DB.rhMonthly||{}).length;
  if(key==="tracking") return Object.keys(DB.tracking||{}).length;
  return 0;
}
// Daftar status tiap dataset yang punya kebutuhan CSV (import/export), dipakai halaman Data
// (Import/Export) supaya user tahu dataset mana yang sudah lama tidak diperbarui datanya.
function renderDataStatus(){
  const body = document.getElementById("dataStatusBody");
  if(!body) return;
  const rows = Object.keys(DATASET_LABELS).map(key=>{
    const iso = DB.meta?.datasetUpdatedAt?.[key];
    const rel = iso ? formatRelativeTime(iso) : null;
    const days = iso ? Math.floor((Date.now()-new Date(iso).getTime())/86400000) : null;
    const badge = days==null ? ["b-gray","Belum pernah diupdate sejak data awal"]
      : days<=90 ? ["b-green", `${rel} (${new Date(iso).toLocaleDateString("id-ID")})`]
      : days<=180 ? ["b-amber", `${rel} (${new Date(iso).toLocaleDateString("id-ID")})`]
      : ["b-red", `${rel} (${new Date(iso).toLocaleDateString("id-ID")})`];
    const page = DATASET_PAGE[key];
    return `<tr>
      <td><b>${escHtml(DATASET_LABELS[key])}</b></td>
      <td class="muted">${datasetCount(key)} baris</td>
      <td><span class="badge ${badge[0]}">${escHtml(badge[1])}</span></td>
      <td><button class="btn small ghost" data-action="goToPage" data-page="${page}">Buka ${escHtml(DATASET_PAGE_LABEL[page])}</button></td>
    </tr>`;
  }).join("");
  body.innerHTML = rows;
}

/* =========================================================
   RIWAYAT (activity log + lightweight snapshot restore)
========================================================= */
function logChange(msg){
  if(!DB.activityLog) DB.activityLog = [];
  DB.activityLog.unshift({ts: new Date().toISOString(), msg});
  if(DB.activityLog.length>300) DB.activityLog.length = 300;
}
// Dipanggil SEBELUM perubahan besar/berisiko (generate ulang jadwal, reset, import) supaya ada
// titik balik yang bisa di-restore — bukan undo per-keystroke (terlalu berat untuk localStorage),
// tapi snapshot di titik-titik penting.
function snapshotBefore(label){
  if(!DB.snapshots) DB.snapshots = [];
  const copy = JSON.parse(JSON.stringify(DB));
  delete copy.snapshots;
  DB.snapshots.unshift({ts: new Date().toISOString(), label, data: copy});
  // Dikecilkan dari 8 ke 5 — tiap snapshot itu SALINAN PENUH seluruh database, jadi 8 salinan
  // riwayat gampang bikin localStorage kepenuhan begitu data operasional (titik/tracking/hasil
  // pemantauan berbulan-bulan) sudah cukup besar. 5 masih cukup buat jaring pengaman beberapa
  // langkah ke belakang tanpa borosin ruang sebanyak sebelumnya.
  if(DB.snapshots.length>5) DB.snapshots.length = 5;
}
function clearAllSnapshots(){
  if(!(DB.snapshots||[]).length){ toast("Tidak ada snapshot untuk dihapus.","err"); return; }
  askConfirm(`Hapus semua ${DB.snapshots.length} snapshot riwayat? Ini hanya menghapus titik balik restore, TIDAK menghapus data titik/tracking/hasil pemantauan/batch kamu. Berguna kalau localStorage browser terasa penuh.`, ()=>{
    DB.snapshots = [];
    save();
    logChange("Semua snapshot riwayat dihapus manual (kosongkan ruang localStorage)");
    toast("Semua snapshot dihapus.","ok");
    renderRiwayat();
  });
}
function restoreSnapshot(idx){
  const snap = DB.snapshots[idx]; if(!snap) return;
  askConfirm(`Restore ke kondisi "${snap.label}" (${new Date(snap.ts).toLocaleString("id-ID")})? Perubahan setelah titik itu akan hilang.`, ()=>{
    const keepSnapshots = DB.snapshots;
    DB = JSON.parse(JSON.stringify(snap.data));
    DB.snapshots = keepSnapshots;
    logChange(`Restore ke snapshot "${snap.label}" (${new Date(snap.ts).toLocaleString("id-ID")})`);
    save();
    toast("Data berhasil di-restore.","ok");
    showPage("riwayat");
  });
}
function deleteSnapshot(idx){
  DB.snapshots.splice(idx,1); save(); renderRiwayat();
}
function renderRiwayat(){
  const snaps = DB.snapshots||[];
  document.getElementById("snapshotTable").innerHTML = snaps.length ? `
    <thead><tr><th>Waktu</th><th>Kondisi Sebelum</th><th>Aksi</th></tr></thead>
    <tbody>${snaps.map((s,i)=>`<tr>
      <td class="muted" style="white-space:nowrap;">${new Date(s.ts).toLocaleString("id-ID")}</td>
      <td>${escHtml(s.label)}</td>
      <td><button class="btn small primary" data-action="restoreSnapshotBtn" data-idx="${i}">Restore</button>
        <button class="btn small danger" data-action="deleteSnapshotBtn" data-idx="${i}">Hapus</button></td>
    </tr>`).join("")}</tbody>` : "<div class='hint' style='padding:10px;'>Belum ada snapshot. Snapshot dibuat otomatis saat kamu generate/hitung ulang jadwal, reset data, atau import.</div>";

  const log = DB.activityLog||[];
  document.getElementById("activityLogWrap").innerHTML = log.length ? `
    <table><thead><tr><th style="width:170px;">Waktu</th><th>Perubahan</th></tr></thead>
    <tbody>${log.map(l=>`<tr><td class="muted" style="white-space:nowrap;">${new Date(l.ts).toLocaleString("id-ID")}</td><td>${escHtml(l.msg)}</td></tr>`).join("")}</tbody></table>`
    : "<div class='hint' style='padding:10px;'>Belum ada aktivitas tercatat.</div>";
}

