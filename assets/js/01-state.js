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
    hasilPemantauan: [...DEFAULT_HASIL_PEMANTAUAN],
    hasilAmbien: {ambien:[...DEFAULT_HASIL_AMBIEN.ambien], kebisingan:[...DEFAULT_HASIL_AMBIEN.kebisingan], kebauan:[...DEFAULT_HASIL_AMBIEN.kebauan], getaran:[...DEFAULT_HASIL_AMBIEN.getaran]},
    dokumentasiFoto: {}
  };
}
function uid(pfx){ return pfx+"_"+Math.random().toString(36).slice(2,9); }

// Safety defaults untuk field yang mungkin belum ada di data lama (localStorage lama atau file
// backup JSON dari versi sebelumnya) — dipanggil tiap kali DB diganti dari sumber luar.
function migrateDB(){
  if(!DB.tracking) DB.tracking = {};
  if(!DB.hasilPemantauan) DB.hasilPemantauan = [...DEFAULT_HASIL_PEMANTAUAN];
  if(!DB.hasilAmbien) DB.hasilAmbien = {ambien:[...DEFAULT_HASIL_AMBIEN.ambien], kebisingan:[...DEFAULT_HASIL_AMBIEN.kebisingan], kebauan:[...DEFAULT_HASIL_AMBIEN.kebauan], getaran:[...DEFAULT_HASIL_AMBIEN.getaran]};
  ["ambien","kebisingan","kebauan","getaran"].forEach(k=>{ if(!Array.isArray(DB.hasilAmbien[k])) DB.hasilAmbien[k] = []; });
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
  if(!DB.dokumentasiFoto) DB.dokumentasiFoto = {};
  // _dokFotoExcluded cuma penanda sementara di payload export (backup tanpa foto), bukan bagian skema DB —
  // kalau ada file backup lama yg nyangkut lewat import & ke-load sbg DB langsung, bersihkan biar tidak
  // ikut kebawa ke export berikutnya (bisa bikin foto yg sebenarnya ada dianggap "sengaja dikecualikan").
  if(DB._dokFotoExcluded !== undefined) delete DB._dokFotoExcluded;
  if(!DB.rhMonths) DB.rhMonths = [...RH_MONTHS_DEFAULT];
  if(!DB.rhMonthly) DB.rhMonthly = JSON.parse(JSON.stringify(RH_MONTHLY_DEFAULT));
  if(!DB.meta) DB.meta = {semester:"S1", tahun:new Date().getFullYear(), lastBatchIdEmisi:0, lastBatchIdAmbient:0};
  if(DB.meta.currentPeriod!==undefined) delete DB.meta.currentPeriod; // field lama, tidak dipakai lagi — diganti meta.semester+meta.tahun
  // Backfill koordinat 12 titik Udara Ambien/Kebisingan/Kebauan/Getaran (Akomodasi/Camp/Office/
  // Kompleks) yg sebelumnya belum punya entry di pointCoords sama sekali (murni tambahan data,
  // bukan koreksi — jadi aman ditambahkan tanpa syarat, sekali saja lewat flag di meta).
  if(!DB.meta.ambientCoordsSeeded){
    const AMBIENT_COORDS_SEED = {
      "CPU::Akomodasi CPU (CPU Camp)":[-0.461833333,117.5852778],
      "NPU::Akomodasi NPU (NPU Camp)":[-0.823914444,117.2510131],
      "SPS::SPS Camp Accomodation":[-0.582527778,117.3774444],
      "SPU::Akomodasi SPU (SPU Camp)":[-0.998277778,117.4993333],
      "BKP::Main Deck (Living Quarter-LQ) Bekapai":[-0.965572222,117.1445306],
      "HCA::Handil Village":[-0.843882222,117.2632981],
      "SPS::SPS Main Gate":[-1.258666667,116.8838333],
      "HCA::Handil Camp":[-0.818742778,117.2517603],
      "BPN::Kompleks Gunung Utara":[-0.972438889,117.1515278],
      "BPN::Kompleks Sepinggan":[-1.255555556,116.8285278],
      "CPU::TRF Office":[-0.972444444,117.1515278],
      "HCA::CPA Camp":[-0.340161389,117.4226011]
    };
    Object.keys(AMBIENT_COORDS_SEED).forEach(key=>{ if(!DB.pointCoords[key]) DB.pointCoords[key] = AMBIENT_COORDS_SEED[key]; });
    DB.meta.ambientCoordsSeeded = true;
  }
  // Koreksi sekali: 11 dari 12 koordinat di atas ternyata tertukar antar titik (nilai lat/lon-nya
  // benar sbg SATU SET, tapi ke-assign ke site::nama yg SALAH — user kirim ulang tabel DMS yg sudah
  // dikoreksi & dicocokkan manual ke lokasi asli). "Main Deck (Living Quarter-LQ) Bekapai" SENGAJA
  // tidak diikutkan — nilai di tabel resend-nya ternyata masih duplikat persis dari 2 titik lain
  // (fragment lat SPS Camp Accomodation + fragment lon Handil Village), jadi kemungkinan besar juga
  // salah ketik/salah tempel, bukan data GPS asli offshore Bekapai yg sebenarnya — dibiarkan apa
  // adanya sampai user kirim koordinat yg benar-benar terverifikasi utk titik itu.
  if(!DB.meta.ambientCoordsCorrectedV2){
    const AMBIENT_COORDS_FIX_V2 = {
      "CPU::Akomodasi CPU (CPU Camp)":[-0.5825197,117.3774403],
      "NPU::Akomodasi NPU (NPU Camp)":[-0.4618381,117.5852825],
      "SPS::SPS Camp Accomodation":[-0.9655722,117.1445306],
      "SPU::Akomodasi SPU (SPU Camp)":[-0.6924583,117.5029056],
      "HCA::Handil Village":[-0.8187428,117.2517603],
      "SPS::SPS Main Gate":[-0.9724389,117.1515278],
      "HCA::Handil Camp":[-0.8239144,117.2510131],
      "BPN::Kompleks Gunung Utara":[-1.2555417,116.8285250],
      "BPN::Kompleks Sepinggan":[-1.2586528,116.8866111],
      "CPU::TRF Office":[-0.3401614,117.4226011],
      "HCA::CPA Camp":[-0.8438822,117.2632981],
    };
    Object.keys(AMBIENT_COORDS_FIX_V2).forEach(key=>{ DB.pointCoords[key] = AMBIENT_COORDS_FIX_V2[key]; });
    DB.meta.ambientCoordsCorrectedV2 = true;
  }
  if(!DB.meta.rhMonthsNormalized){ rhNormalizeMonthLabels(); DB.meta.rhMonthsNormalized = true; }
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
  // b.period di atas MEMANG sudah keisi (bukan kosong) utk sebagian besar batch — tapi bisa basi:
  // sendPlanToBatch() nge-stamp period dari dropdown "rcPeriode" di Plan Pemantauan pada saat batch
  // dibuat (b.start masih "" waktu itu), lalu Nama Batch bisa diketik ulang manual belakangan di
  // Perencanaan Batch (bebas teks, terpisah dari field period) begitu user sadar dropdown-nya salah
  // pilih — namanya kekoreksi tapi b.period yang tidak pernah ditampilkan ke user tidak ikut
  // kekoreksi, jadi tetap basi selamanya. Baru ketahuan sekarang krn b.period ditampilkan tekstual
  // di filter S-Curve Dashboard. Disamakan sekali di sini ke periode yg ditunjukkan tanggal mulai
  // ASLI (periodOfDateStr, sumber paling bisa diandalkan) utk batch yg sudah py tanggal — supaya
  // data yg sudah kepalanjur basi di banyak user ikut kekoreksi, bukan cuma mencegah kasus baru.
  if(!DB.meta.batchPeriodSyncedFromDates){
    DB.batches.forEach(b=>{
      if(!b.start) return;
      const po = periodOfDateStr(b.start);
      if(po && po.label!==b.period) b.period = po.label;
    });
    DB.meta.batchPeriodSyncedFromDates = true;
  }
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
  // Migrasi sekali: site "BEKAPAI" diganti jadi kode 3-huruf "BKP" supaya konsisten dgn site lain
  // (CPU/SPU/NPU/SPS/HCA/BPN semuanya sudah 3 huruf — BEKAPAI dulu satu-satunya nama panjang).
  // Field .site di tiap koleksi diganti langsung; key gabungan "site::nama" (pointCoords,
  // coordVerification) & "periode::site" (komStatus) ikut diganti supaya tidak jadi entry
  // yatim/tidak ketemu lagi oleh titik yang site-nya sudah berubah.
  if(!DB.meta.siteBekapaiRenamedToBkp){
    const renameSite = s => s==="BEKAPAI" ? "BKP" : s;
    DB.points.forEach(p=>{ p.site = renameSite(p.site); });
    DB.hasilPemantauan.forEach(r=>{ if(r.site) r.site = renameSite(r.site); });
    ["ambien","kebisingan","kebauan","getaran"].forEach(k=>{
      (DB.hasilAmbien[k]||[]).forEach(r=>{ if(r.site) r.site = renameSite(r.site); });
    });
    DB.routeAmbient = DB.routeAmbient.map(renameSite);
    DB.routeEmisi = DB.routeEmisi.map(renameSite);
    if(DB.siteRules && DB.siteRules.BEKAPAI){ DB.siteRules.BKP = DB.siteRules.BEKAPAI; delete DB.siteRules.BEKAPAI; }
    const renameSitePrefixedKeys = (obj)=>{
      const out = {};
      Object.keys(obj).forEach(key=>{
        const newKey = key.indexOf("BEKAPAI::")===0 ? "BKP::"+key.slice("BEKAPAI::".length) : key;
        out[newKey] = obj[key];
      });
      return out;
    };
    DB.pointCoords = renameSitePrefixedKeys(DB.pointCoords);
    DB.coordVerification = renameSitePrefixedKeys(DB.coordVerification);
    Object.values(DB.coordVerification).forEach(v=>{ if(v && v.site) v.site = renameSite(v.site); });
    // Jadwal batch (Gantt) & override per-hari-nya sama-sama menyimpan site: schedule[].site dipakai
    // langsung utk pengelompokan baris Gantt, dayOverrides di-key "site::engineId" persis pola
    // pointCoords di atas.
    DB.batches.forEach(b=>{
      (b.schedule||[]).forEach(row=>{ if(row.site) row.site = renameSite(row.site); });
      if(b.dayOverrides) b.dayOverrides = renameSitePrefixedKeys(b.dayOverrides);
    });
    const renamedKom = {};
    Object.keys(DB.komStatus).forEach(key=>{
      const suffix = "::BEKAPAI";
      const newKey = key.slice(-suffix.length)===suffix ? key.slice(0,-suffix.length)+"::BKP" : key;
      renamedKom[newKey] = DB.komStatus[key];
    });
    DB.komStatus = renamedKom;
    DB.meta.siteBekapaiRenamedToBkp = true;
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
  // Titik awal undo/redo (lihat blok di bawah save()) — state persis begitu file ini dibuka,
  // sebelum interaksi apapun sesi ini. lastUndoPushTime SENGAJA 0 (bukan Date.now()) — kalau
  // diisi waktu sekarang, save() PERTAMA yang terjadi dlm UNDO_COALESCE_MS stlh file dibuka
  // (sangat mungkin, mis. user langsung klik sesuatu) akan gagal terdorong ke undoStack sama
  // sekali (dikira "lanjutan ketukan beruntun" dari load(), padahal actionnya sendiri belum
  // pernah ada) — 0 menjamin cek "sudah lewat UNDO_COALESCE_MS" selalu benar utk dorongan pertama.
  lastSavedSnapshot = snapshotForUndo(DB);
  lastUndoPushTime = 0;
  updateUndoRedoButtons();
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
    // Dorong state SEBELUM perubahan ini ke undoStack (lihat blok Undo/Redo di bawah) — ketukan
    // beruntun (mis. tiap huruf field teks) dlm UNDO_COALESCE_MS digabung jd 1 langkah, TIDAK
    // dorong entry baru tiap panggilan, spy Undo tidak cuma mundur 1 huruf demi 1 huruf.
    const nowTs = Date.now();
    if(lastSavedSnapshot && (nowTs-lastUndoPushTime>UNDO_COALESCE_MS)){
      undoStack.push(lastSavedSnapshot);
      if(undoStack.length>UNDO_MAX_STEPS) undoStack.shift();
      redoStack = [];
      lastUndoPushTime = nowTs;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(DB));
    lastSavedSnapshot = snapshotForUndo(DB);
    updateStorageUsageBadge();
    updateUndoRedoButtons();
  }catch(err){
    const isQuotaErr = err && (err.name==="QuotaExceededError" || err.code===22 || err.code===1014);
    if(!isQuotaErr) throw err;
    const droppedCount = (DB.snapshots||[]).length;
    while(DB.snapshots && DB.snapshots.length){
      DB.snapshots.pop();
      try{
        localStorage.setItem(STORAGE_KEY, JSON.stringify(DB));
        lastSavedSnapshot = snapshotForUndo(DB);
        updateStorageUsageBadge();
        updateUndoRedoButtons();
        toast(`Penyimpanan browser hampir penuh — ${droppedCount-DB.snapshots.length} snapshot riwayat lama dihapus otomatis utk mengosongkan ruang (data titik/tracking/hasil pemantauan tidak terpengaruh). Cek halaman Riwayat & Restore.`,"err");
        return;
      }catch(err2){
        if(!(err2 && (err2.name==="QuotaExceededError" || err2.code===22 || err2.code===1014))) throw err2;
      }
    }
    updateStorageUsageBadge();
    toast("Penyimpanan browser (localStorage) penuh dan semua snapshot riwayat sudah dikosongkan otomatis, tapi tetap belum cukup. Buka menu Data (Import/Export) → Export Semua Data utk backup, lalu hapus data lama yang tidak perlu (mis. Hasil Emisi periode sangat lampau) utk mengosongkan ruang.","err");
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
  // Cuma 1 target nyata di HTML (halaman Riwayat & Restore) — "storageUsageBadge" polos yg dulu
  // disebut di sini tidak pernah punya elemen padanannya, jadi dihapus drpd terus jadi lookup mati.
  const el = document.getElementById("storageUsageBadgeRiwayat");
  if(el) el.innerHTML = `<span>~${mb} MB terpakai ${quotaLabel}</span><div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${color};"></div></div>`;
}
// Pencatatan "terakhir diupdate" per kategori dataset yang punya kebutuhan CSV (import/export),
// dipakai oleh daftar dataset di halaman Data (Import/Export) supaya terlihat mana yang sudah lama
// tidak diperbarui. Dipanggil di titik mutasi utama tiap dataset (import CSV, tambah/ubah/hapus data,
// atau reset), bukan pada setiap pemanggilan save() yang terlalu umum untuk kebutuhan ini.
const DATASET_LABELS = {
  points: "Database Titik Pantau",
  personil: "Personil PPC & Observer",
  coords: "Koordinat Titik Pantau",
  hasilPemantauan: "Hasil Emisi (Database Hasil Emisi)",
  hasilAmbien: "Hasil Pemantauan Ambient (Udara Ambien, Kebisingan, Kebauan, Getaran)",
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
const DATASET_PAGE = {points:"master", personil:"personil", coords:"lokasi", hasilPemantauan:"hasildb", hasilAmbien:"ambiendb", rh:"runninghour", rhMonthly:"runninghour", tracking:"tracking"};
const DATASET_PAGE_LABEL = {master:"Database Titik Pantau", personil:"Personil PPC & Observer", lokasi:"Lokasi Titik Pantau", hasildb:"Database Hasil Emisi", ambiendb:"Database Hasil Ambient", runninghour:"Running Hour Detail", tracking:"Tracking BA / CoA"};
function datasetCount(key){
  if(key==="points") return DB.points.length;
  if(key==="personil") return DB.personil.length;
  if(key==="coords") return Object.keys(DB.pointCoords||{}).length;
  if(key==="hasilPemantauan") return DB.hasilPemantauan.length;
  if(key==="hasilAmbien") return Object.values(DB.hasilAmbien||{}).reduce((s,a)=>s+a.length,0);
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
  // dokumentasiFoto SENGAJA tidak ikut disalin — snapshot ini titik-balik utk data operasional
  // (jadwal/titik/tracking/hasil pemantauan), bukan riwayat foto (foto sudah py tombol hapus
  // sendiri di halaman Dokumentasi Foto). Ikut menyalin foto ke tiap snapshot artinya tiap foto
  // terhitung sampai 6x (1 salinan aktif + maks 5 salinan snapshot) thd kuota localStorage —
  // penyebab utama keluhan "penyimpanan penuh" walau foto sendiri sudah dikompres saat upload.
  // restoreSnapshot() di bawah mempertahankan dokumentasiFoto AKTIF saat restore, konsisten
  // dgn snapshot yang memang tidak pernah menyimpan foto sama sekali.
  delete copy.dokumentasiFoto;
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
    const keepDokFoto = DB.dokumentasiFoto;
    DB = JSON.parse(JSON.stringify(snap.data));
    DB.snapshots = keepSnapshots;
    // dokumentasiFoto tidak pernah ikut tersimpan di snapshot (lihat snapshotBefore) — dipertahankan
    // dari kondisi AKTIF saat ini, bukan ikut ditimpa/dikosongkan oleh restore.
    DB.dokumentasiFoto = keepDokFoto;
    logChange(`Restore ke snapshot "${snap.label}" (${new Date(snap.ts).toLocaleString("id-ID")})`);
    save();
    toast("Data berhasil di-restore.","ok");
    showPage("riwayat");
  });
}

/* =========================================================
   UNDO / REDO — jaring pengaman generik utk SEMUA perubahan, beda dari snapshot Riwayat & Restore
   di atas (yang manual/bernama & tersimpan permanen di DB.snapshots, sengaja dibatasi 5 biar hemat
   kuota). Ini sebaliknya: otomatis & diam-diam tiap panggilan save(), tapi HANYA di memori (tidak
   ikut ke localStorage) — reset tiap file di-reload, sama seperti undo history aplikasi lain pada
   umumnya kalau ditutup-buka lagi, dan supaya tidak menambah beban kuota localStorage yang sudah
   pernah jadi masalah (lihat catatan foto/IndexedDB). dokumentasiFoto juga TIDAK ikut ke-cover di
   sini, sama seperti snapshot Riwayat — foto sudah punya penyimpanan & alur hapusnya sendiri
   (IndexedDB), sengaja dikecualikan drpd bikin undo/redo ikut coba sinkron ulang blob tiap langkah.
========================================================= */
let undoStack = [], redoStack = [], lastSavedSnapshot = null, lastUndoPushTime = 0;
const UNDO_MAX_STEPS = 20;
// Ketukan beruntun dlm jendela ini (mis. tiap huruf yg diketik di field teks yg pakai event
// "input", jadi save() terpanggil tiap keystroke) digabung jd SATU langkah undo, bukan puluhan.
const UNDO_COALESCE_MS = 1200;
function snapshotForUndo(db){
  const copy = JSON.parse(JSON.stringify(db));
  delete copy.snapshots;
  delete copy.dokumentasiFoto;
  return copy;
}
function updateUndoRedoButtons(){
  const undoBtn = document.getElementById("btnUndo");
  const redoBtn = document.getElementById("btnRedo");
  if(undoBtn){
    undoBtn.disabled = !undoStack.length;
    undoBtn.title = undoStack.length ? `Undo — batalkan perubahan terakhir (${undoStack.length} langkah tersimpan)` : "Tidak ada perubahan untuk di-undo";
  }
  if(redoBtn){
    redoBtn.disabled = !redoStack.length;
    redoBtn.title = redoStack.length ? `Redo — kembalikan lagi (${redoStack.length} langkah tersimpan)` : "Tidak ada perubahan untuk di-redo";
  }
}
function applyUndoRedoState(snapshotData){
  const keepSnapshots = DB.snapshots;
  const keepDokFoto = DB.dokumentasiFoto;
  DB = JSON.parse(JSON.stringify(snapshotData));
  DB.snapshots = keepSnapshots;
  DB.dokumentasiFoto = keepDokFoto;
  lastSavedSnapshot = snapshotForUndo(DB);
  // 0, bukan Date.now() — sama alasannya dgn load() di atas: spy save() PERTAMA setelah
  // undo/redo ini (kapanpun user bertindak lagi) pasti terdorong sbg langkah baru, bukan
  // dianggap "masih lanjutan" dari aksi undo/redo itu sendiri.
  lastUndoPushTime = 0;
  // Tulis LANGSUNG ke localStorage (bukan lewat save()) supaya tindakan undo/redo ini sendiri
  // TIDAK ikut mendorong entry baru ke undoStack — kalau lewat save(), undo akan "mengunci diri
  // sendiri" (redo jadi tidak pernah bisa balik ke keadaan semula krn undoStack ikut berubah
  // tiap kali di-undo). Dua stack terpisah (undo/redo) sudah menangani riwayat maju-mundurnya.
  try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(DB)); }catch(err){ /* quota — Undo/Redo tetap jalan di memori, tanpa alur recovery penuh spt save() */ }
  updateStorageUsageBadge();
  updateUndoRedoButtons();
  renderPage(document.querySelector(".navbtn.active")?.dataset.page || "dashboard");
}
function performUndo(){
  if(!undoStack.length){ toast("Tidak ada perubahan untuk di-undo.","err"); return; }
  const target = undoStack.pop();
  redoStack.push(lastSavedSnapshot);
  if(redoStack.length>UNDO_MAX_STEPS) redoStack.shift();
  applyUndoRedoState(target);
  toast("Perubahan terakhir dibatalkan (Undo).","ok");
}
function performRedo(){
  if(!redoStack.length){ toast("Tidak ada perubahan untuk di-redo.","err"); return; }
  const target = redoStack.pop();
  undoStack.push(lastSavedSnapshot);
  if(undoStack.length>UNDO_MAX_STEPS) undoStack.shift();
  applyUndoRedoState(target);
  toast("Perubahan dikembalikan lagi (Redo).","ok");
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

