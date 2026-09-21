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
// File backup lengkap bisa beberapa MB (foto ikut disertakan) — fetch(...).json() biasa tidak
// kasih progress apapun sampai selesai total, jadi kalau koneksi lambat kelihatan spt macet/hang.
// Baca body-nya manual per potongan (ReadableStream) & panggil onProgress(pct, bytesSoFar, totalBytes)
// tiap potongan diterima, baru JSON.parse di akhir setelah semua potongan digabung — persis proses
// yang sama dgn res.json(), cuma dipecah supaya progresnya kelihatan di tengah jalan (lihat
// progressToast di 02-nav-util.js, dipakai checkRepoBackupUpdate/checkFullBackupUpdate di bawah).
async function fetchJsonWithProgress(url, onProgress){
  const res = await fetch(url, {cache:"no-store"});
  if(!res.ok) throw new Error("HTTP "+res.status);
  const totalStr = res.headers.get("content-length");
  const total = totalStr ? Number(totalStr) : 0;
  // Tanpa body.getReader() (browser sangat lama) atau tanpa Content-Length (mis. server tidak
  // mengirimnya, atau di-strip proxy) — tidak bisa dapat progres asli, fallback ke res.json() biasa
  // apa adanya, tapi tetap kasih tanda "indeterminate" (lihat pemanggil) drpd diam total.
  if(!res.body || !total){
    onProgress(null, 0, 0);
    return await res.json();
  }
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  while(true){
    const {done, value} = await reader.read();
    if(done) break;
    chunks.push(value);
    received += value.length;
    onProgress(Math.min(99, Math.round(received/total*100)), received, total);
  }
  onProgress(100, received, total);
  const text = await new Blob(chunks).text();
  return JSON.parse(text);
}
// Ringkasan isi file SEBELUM di-download — supaya user bisa cek sendiri dgn mata "file yg baru
// aku buat ini beneran isinya lengkap ya" TANPA harus kirim dulu ke laptop lain buat tahu, karena
// mekanisme export/import-nya sendiri sudah diverifikasi benar berkali-kali; kalau ada yg hilang,
// gejalanya akan kelihatan di ringkasan INI, bukan baru ketahuan pas dibuka di laptop lain.
// "Sertakan foto Dokumentasi Sampling" (checkbox #exportIncludePhotos, default KOSONG) — foto
// tersimpan sbg data-URI (base64) yang gampang membengkakkan ukuran file jadi puluhan MB kalau
// titiknya banyak, sedangkan kebutuhan export paling umum (pindah data teks antar device/backup
// harian) tidak butuh fotonya. Kalau dikosongkan, dokumentasiFoto diganti {} DAN ditandai
// _dokFotoExcluded:true (properti sementara, bukan bagian skema DB) — dibaca applyFullBackupImport
// supaya foto yang SUDAH ADA di device tujuan TIDAK ikut terhapus cuma krn file yg diimport memang
// sengaja tidak menyertakan foto (beda dgn file yang foto-nya betul-betul kosong krn belum diisi).
async function exportAll(){
  const finalizedCount = DB.batches.filter(b=>b.finalized).length;
  const includePhotos = document.getElementById("exportIncludePhotos").checked;
  let data, fotoBytes = 0;
  if(includePhotos){
    // Byte foto (dataUrl) sekarang di IndexedDB, bukan lagi ikut nyempil di DB.dokumentasiFoto
    // (lihat 17-dokumentasi-foto.js) — direkonstruksi PENUH dgn dataUrl disisipkan lagi KHUSUS utk
    // file JSON export ini, supaya file backup tetap 1 file portable yang berdiri sendiri (bisa
    // di-restore di perangkat lain tanpa bergantung IndexedDB perangkat asal sama sekali).
    const idbEntries = await dokFotoIdbGetAll();
    const idbMap = new Map(idbEntries.map(e=>[e.id, e.dataUrl]));
    fotoBytes = idbEntries.reduce((s,e)=>s+(e.dataUrl?e.dataUrl.length:0),0);
    const fullDokFoto = {};
    Object.keys(DB.dokumentasiFoto||{}).forEach(pointId=>{
      fullDokFoto[pointId] = {};
      const cats = DB.dokumentasiFoto[pointId];
      Object.keys(cats).forEach(cat=>{
        fullDokFoto[pointId][cat] = (cats[cat]||[]).map(ph=>({...ph, dataUrl: idbMap.get(ph.id)||""}));
      });
    });
    data = {...DB, dokumentasiFoto: fullDokFoto};
    // _dokFotoExcluded murni penanda sementara KHUSUS utk file export yg SENGAJA tidak menyertakan
    // foto (lihat applyFullBackupImport) — kalau DB yang sedang aktif kebetulan sendiri membawa
    // properti ini (mis. file backup lama sempat dimuat langsung jadi localStorage tanpa lewat
    // migrateDB), jangan sampai ikut ter-spread ke file export yg SEBENARNYA menyertakan foto.
    delete data._dokFotoExcluded;
  } else {
    data = {...DB, dokumentasiFoto:{}, _dokFotoExcluded:true};
  }
  // Lampiran sertifikat Personil PPU (byte-nya di IndexedDB terpisah, sama alasan dgn foto di atas)
  // — SELALU disertakan (bukan opsional spt foto: jumlahnya jauh lebih sedikit, satu per personil,
  // jadi tidak perlu toggle). lampiranDataUrl ditempel SEMENTARA per record khusus utk file export
  // ini saja (TIDAK pernah disimpan balik ke DB.personilPPU yang aktif).
  if(Array.isArray(data.personilPPU) && data.personilPPU.length){
    const ppuIdbEntries = await ppuLampiranIdbGetAll();
    const ppuIdbMap = new Map(ppuIdbEntries.map(e=>[e.id, e.dataUrl]));
    data.personilPPU = data.personilPPU.map(p=> p.lampiranId ? {...p, lampiranDataUrl: ppuIdbMap.get(p.lampiranId)||""} : {...p});
  }
  const fotoNote = includePhotos
    ? ` Foto Dokumentasi Sampling ${fmtBytes(fotoBytes)} ikut disertakan.`
    : ` Foto Dokumentasi Sampling TIDAK disertakan (centang opsinya kalau perlu pindah foto ke perangkat lain).`;
  const summary = `Mengekspor: ${DB.points.length} titik, ${DB.batches.length} batch (${finalizedCount} sudah final), ${DB.personil.length} personil, ${DB.hasilPemantauan.length} data hasil pemantauan, ${Object.keys(DB.tracking||{}).length} tracking.${fotoNote} Dari session browser INI — cek angkanya sesuai yang kamu kerjakan sebelum dikirim ke laptop lain.`;
  toast(summary, DB.batches.length ? "ok" : "err");
  downloadBlob(JSON.stringify(data,null,2), `phm_emisi_backup_${todayStr()}.json`, "application/json");
}
/* ---------- Diff detail per "menu" sebelum backup lengkap menimpa data ----------
   Permintaan user: sebelum file JSON-ALL diimport/ditimpa, tunjukkan detail APA yg berubah per
   menu/dataset (ditambah/dihapus/diubah) + kapan terakhir diupdate — supaya tidak "timpa buta".
   diffArrayById/diffKeyedObject sengaja generic (dipakai ulang utk semua section) drpd nulis
   perbandingan khusus tiap dataset satu-satu. "Diubah" dihitung dari JSON.stringify tidak sama —
   kasar (urutan field beda pun kehitung "diubah"), makanya diberi catatan di modal supaya user tidak
   salah baca angkanya sebagai diff persis field-per-field. "Terakhir diupdate" diambil dari
   DB.meta.datasetUpdatedAt (touchDataset, 01-state.js) yang MEMANG SUDAH ada di dataset yg
   punya import/export sendiri — bukan infrastruktur baru. */
function diffArrayById(oldArr, newArr){
  oldArr = Array.isArray(oldArr) ? oldArr : [];
  newArr = Array.isArray(newArr) ? newArr : [];
  const oldMap = new Map(oldArr.map(x=>[x.id,x]));
  const newMap = new Map(newArr.map(x=>[x.id,x]));
  let added=0, removed=0, modified=0;
  newMap.forEach((v,id)=>{ if(!oldMap.has(id)) added++; else if(JSON.stringify(v)!==JSON.stringify(oldMap.get(id))) modified++; });
  oldMap.forEach((v,id)=>{ if(!newMap.has(id)) removed++; });
  return {added, removed, modified};
}
function diffKeyedObject(oldObj, newObj){
  oldObj = (oldObj && typeof oldObj==="object") ? oldObj : {};
  newObj = (newObj && typeof newObj==="object") ? newObj : {};
  const oldKeys = Object.keys(oldObj), newKeys = Object.keys(newObj);
  const oldSet = new Set(oldKeys), newSet = new Set(newKeys);
  let added=0, removed=0, modified=0;
  newKeys.forEach(k=>{ if(!oldSet.has(k)) added++; else if(JSON.stringify(newObj[k])!==JSON.stringify(oldObj[k])) modified++; });
  oldKeys.forEach(k=>{ if(!newSet.has(k)) removed++; });
  return {added, removed, modified};
}
// Dokumentasi Foto strukturnya {pointId:{kategori:[{id,...}], final, finalAt}} — dihitung per FOTO
// (leaf), bukan per titik, supaya "5 foto baru" lebih informatif drpd "1 titik berubah". Tanda final
// yang berubah dihitung sbg 1 "diubah" per titik.
function diffDokFotoSection(oldD, newD){
  oldD = (oldD && typeof oldD==="object") ? oldD : {};
  newD = (newD && typeof newD==="object") ? newD : {};
  let added=0, removed=0, modified=0;
  const allPoints = new Set([...Object.keys(oldD), ...Object.keys(newD)]);
  allPoints.forEach(pid=>{
    const oc = oldD[pid]||{}, nc = newD[pid]||{};
    const allCats = new Set([...Object.keys(oc), ...Object.keys(nc)]);
    allCats.forEach(cat=>{
      const oa = Array.isArray(oc[cat]) ? oc[cat] : null;
      const na = Array.isArray(nc[cat]) ? nc[cat] : null;
      if(!oa && !na) return; // field "final"/"finalAt", bukan array foto
      const oldIds = new Set((oa||[]).map(p=>p.id));
      const newIds = new Set((na||[]).map(p=>p.id));
      newIds.forEach(id=>{ if(!oldIds.has(id)) added++; });
      oldIds.forEach(id=>{ if(!newIds.has(id)) removed++; });
    });
    if(!!oc.final !== !!nc.final) modified++;
  });
  return {added, removed, modified};
}
// personilPPU dari file export bisa membawa field sementara lampiranDataUrl (lihat exportAll) yang
// TIDAK PERNAH ada di DB.personilPPU yang aktif — dibuang dulu sebelum diff supaya keberadaan field
// itu sendiri tidak selalu kehitung "diubah" utk tiap personil yang punya lampiran walau isinya sama.
function diffPersonilPpuSection(oldArr, newArr){
  const strip = arr => (Array.isArray(arr)?arr:[]).map(p=>{ const {lampiranDataUrl, ...rest} = p; return rest; });
  return diffArrayById(strip(oldArr), strip(newArr));
}
function computeBackupDiffRows(oldDB, newDB){
  const rows = [];
  const push = (label, diff, datasetKey) => {
    if(!diff.added && !diff.removed && !diff.modified) return;
    let lastUpdated = null;
    if(datasetKey && newDB.meta && newDB.meta.datasetUpdatedAt && newDB.meta.datasetUpdatedAt[datasetKey]){
      lastUpdated = formatRelativeTime(newDB.meta.datasetUpdatedAt[datasetKey]);
    }
    rows.push({label, added: diff.added, removed: diff.removed, modified: diff.modified, lastUpdated});
  };
  push("Database Titik Pantau", diffArrayById(oldDB.points, newDB.points), "points");
  push("Koordinat Titik Pantau", diffKeyedObject(oldDB.pointCoords, newDB.pointCoords), "coords");
  push("Personil PPC & Observer", diffArrayById(oldDB.personil, newDB.personil), "personil");
  push("Personil Kompetensi PPU", diffPersonilPpuSection(oldDB.personilPPU, newDB.personilPPU), "personilPPU");
  push("Aturan Site & Rute (Emisi)", diffArrayById(oldDB.routeEmisi, newDB.routeEmisi));
  push("Aturan Site & Rute (Ambient)", diffArrayById(oldDB.routeAmbient, newDB.routeAmbient));
  push("Perencanaan Batch / Scheduling", diffArrayById(oldDB.batches, newDB.batches));
  push("Tracking BA / CoA", diffKeyedObject(oldDB.tracking, newDB.tracking), "tracking");
  push("Running Hour Bulanan", diffKeyedObject(oldDB.rhMonthly, newDB.rhMonthly), "rhMonthly");
  push("Hasil Emisi (Database Hasil Emisi)", diffArrayById(oldDB.hasilPemantauan, newDB.hasilPemantauan), "hasilPemantauan");
  const ambienCatLabels = {ambien:"Hasil Ambien — Udara Ambien", kebisingan:"Hasil Ambien — Kebisingan", kebauan:"Hasil Ambien — Kebauan", getaran:"Hasil Ambien — Getaran"};
  Object.keys(ambienCatLabels).forEach(k=>{
    push(ambienCatLabels[k], diffArrayById((oldDB.hasilAmbien||{})[k], (newDB.hasilAmbien||{})[k]), "hasilAmbien");
  });
  push("Dokumentasi Foto Sampling", diffDokFotoSection(oldDB.dokumentasiFoto, newDB.dokumentasiFoto));
  return rows;
}
function backupDiffTableHtml(rows){
  if(!rows.length) return `<p class="hint">Tidak ada perbedaan terdeteksi antara data kamu saat ini dan isi file ini (identik).</p>`;
  return `<div class="tablewrap" style="max-height:260px;">
    <table style="width:100%;border-collapse:collapse;font-size:12px;">
    <thead><tr style="border-bottom:1.5px solid var(--gray-300);position:sticky;top:0;background:#fff;">
      <th style="text-align:left;padding:4px 6px;">Menu / Data</th>
      <th style="text-align:center;padding:4px 6px;">Ditambah</th>
      <th style="text-align:center;padding:4px 6px;">Dihapus</th>
      <th style="text-align:center;padding:4px 6px;">Diubah</th>
      <th style="text-align:left;padding:4px 6px;">Terakhir Diupdate (file ini)</th>
    </tr></thead>
    <tbody>${rows.map(r=>`<tr style="border-bottom:1px solid var(--gray-200);">
      <td style="padding:4px 6px;">${escHtml(r.label)}</td>
      <td style="text-align:center;padding:4px 6px;${r.added?"color:#0d8a4f;font-weight:700;":"color:var(--gray-300);"}">${r.added||"&middot;"}</td>
      <td style="text-align:center;padding:4px 6px;${r.removed?"color:#a02a24;font-weight:700;":"color:var(--gray-300);"}">${r.removed||"&middot;"}</td>
      <td style="text-align:center;padding:4px 6px;${r.modified?"color:#b8860b;font-weight:700;":"color:var(--gray-300);"}">${r.modified||"&middot;"}</td>
      <td style="padding:4px 6px;" class="muted">${r.lastUpdated?escHtml(r.lastUpdated):"-"}</td>
    </tr>`).join("")}</tbody>
  </table></div>
  <div class="hint" style="margin-top:6px;">Kolom "Diubah" dihitung kasar dari perbandingan data mentah (bisa saja cuma urutan field yang beda, bukan berarti isinya benar-benar beda) — dipakai utk gambaran skala perubahan, bukan diff presisi field-per-field.</div>`;
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
  // File yg sengaja tidak menyertakan foto (_dokFotoExcluded, lihat exportAll) TIDAK akan menghapus
  // foto yang sudah ada di device ini — perlu ditulis di sini supaya user yang lihat "0 foto" di
  // ringkasan file tidak salah paham kalau foto lokalnya bakal ikut kehapus.
  const fotoNote = data._dokFotoExcluded
    ? `Foto Dokumentasi Sampling TIDAK disertakan di file ini — foto yang sudah ada di perangkat ini <b>akan tetap disimpan</b>, tidak ikut terhapus.`
    : `Foto Dokumentasi Sampling: ${Object.keys(data.dokumentasiFoto||{}).length} titik di file ini (akan MENIMPA foto yang sudah ada di perangkat ini).`;
  // dokumentasiFoto SENGAJA dilewati dari diff kalau file ini _dokFotoExcluded (foto lokal tetap
  // dipertahankan apa adanya saat diterapkan, lihat applyFullBackupImport — jadi dibandingkan pun
  // percuma, isi data.dokumentasiFoto={} bukan representasi apa yg SEBENARNYA akan terjadi).
  const diffCompareData = data._dokFotoExcluded ? {...data, dokumentasiFoto: DB.dokumentasiFoto} : data;
  const diffRows = computeBackupDiffRows(DB, diffCompareData);
  openModal(`
    <h3>Restore Backup Lengkap</h3>
    <p class="hint"><b>Data kamu SAAT INI</b> (akan hilang kalau lanjut): ${DB.points.length} titik, ${DB.batches.length} batch (${curFinalized} final), ${DB.personil.length} personil, ${Object.keys(DB.tracking||{}).length} tracking.</p>
    <p class="hint"><b>Data DARI "${escHtml(sourceLabel)}"</b>: ${data.points.length} titik, ${data.batches.length} batch (${newFinalized} final), ${data.personil.length} personil, ${Object.keys(data.tracking||{}).length} tracking.</p>
    <p class="hint">${fotoNote}</p>
    <p style="font-weight:700;margin-bottom:4px;">Detail per menu yang berubah:</p>
    ${backupDiffTableHtml(diffRows)}
    <p style="font-weight:700;color:#a02a24;margin-top:10px;">Ini akan MENIMPA SELURUH data kamu saat ini dengan data di atas. Ada snapshot pengaman otomatis sebelum diterapkan (bisa di-undo lewat Riwayat &amp; Restore kalau salah pilih).</p>
    <div class="actions">
      <button class="btn ghost" data-action="closeModal">Batal</button>
      <button class="btn danger" data-action="applyFullBackupImport">Timpa dengan Data Ini</button>
    </div>
  `, {wide:true});
}
async function applyFullBackupImport(){
  const pending = pendingFullBackup; if(!pending) return;
  const {data, sourceLabel} = pending;
  snapshotBefore(`Sebelum import backup "${sourceLabel}"`);
  const keepSnapshots = DB.snapshots, keepLog = DB.activityLog;
  const keepDokFoto = DB.dokumentasiFoto;
  const dokFotoWasExcluded = !!data._dokFotoExcluded;
  // Foto yg datang DENGAN dataUrl (file export lama dari sebelum migrasi IndexedDB, atau file baru
  // yg "Sertakan Foto" dicentang — lihat exportAll) ditulis dulu ke IndexedDB DI SINI, dataUrl-nya
  // baru dilepas dari metadata SETELAH tulisnya benar2 berhasil — supaya kalau IndexedDB gagal
  // (browser lama dsb), foto tetap tidak hilang (metadata tetap membawa datanya sendiri spt sedia
  // kala, cuma tidak dapat untung penyimpanan lebih hemat).
  if(!dokFotoWasExcluded && data.dokumentasiFoto){
    const toPut = [];
    Object.keys(data.dokumentasiFoto).forEach(pointId=>{
      const cats = data.dokumentasiFoto[pointId];
      Object.keys(cats).forEach(cat=>{
        (cats[cat]||[]).forEach(ph=>{ if(ph.dataUrl) toPut.push(ph); });
      });
    });
    if(toPut.length){
      try{
        await dokFotoIdbBulkPut(toPut.map(ph=>({id:ph.id, dataUrl:ph.dataUrl})));
        toPut.forEach(ph=>{ dokFotoUrlCache.set(ph.id, ph.dataUrl); delete ph.dataUrl; });
      }catch(err){
        toast("Sebagian/seluruh foto gagal ditulis ke penyimpanan IndexedDB saat restore (foto tetap tersimpan apa adanya, cuma belum optimal) — coba lagi nanti kalau perlu.","err");
      }
    }
  }
  // Lampiran sertifikat Personil PPU — sama pola dgn dokFoto di atas: ditulis ke IndexedDB dulu,
  // field sementara lampiranDataUrl baru dilepas SETELAH tulisnya berhasil.
  if(Array.isArray(data.personilPPU) && data.personilPPU.length){
    const toPutPpu = data.personilPPU.filter(p=>p.lampiranDataUrl && p.lampiranId);
    if(toPutPpu.length){
      try{
        await ppuLampiranIdbBulkPut(toPutPpu.map(p=>({id:p.lampiranId, dataUrl:p.lampiranDataUrl})));
      }catch(err){
        toast("Sebagian/seluruh lampiran Personil PPU gagal ditulis ke penyimpanan IndexedDB saat restore.","err");
      }
    }
    data.personilPPU.forEach(p=>{ delete p.lampiranDataUrl; });
  }
  DB = data;
  migrateDB();
  if(!DB.snapshots.length) DB.snapshots = keepSnapshots; else DB.snapshots = keepSnapshots.concat(DB.snapshots).slice(0,8);
  if(!DB.activityLog.length) DB.activityLog = keepLog;
  // File export yg sengaja tidak menyertakan foto tidak boleh diam-diam menghapus foto yang sudah
  // ada di perangkat ini — lihat catatan _dokFotoExcluded di exportAll (12-data-page.js).
  if(dokFotoWasExcluded) DB.dokumentasiFoto = keepDokFoto;
  delete DB._dokFotoExcluded;
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
  const fname = url.split("/").pop()||url;
  const prog = progressToast(`Mengunduh ${fname}…`);
  try{
    const data = await fetchJsonWithProgress(cacheBustUrl(url), (pct, received)=>{
      prog.update(pct, pct==null
        ? `Mengunduh ${fname}… (${fmtBytes(received)})`
        : `Mengunduh ${fname}… ${pct}%`);
    });
    prog.remove();
    handleFullBackupPackage(data, fname);
  }catch(err){
    prog.remove();
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
  const prog = progressToast("Mencari backup terbaru di repository…");
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
    prog.update(0, `Mengunduh ${latest.name}…`);
    const data = await fetchJsonWithProgress(cacheBustUrl(latest.download_url), (pct, received)=>{
      prog.update(pct, pct==null
        ? `Mengunduh ${latest.name}… (${fmtBytes(received)})`
        : `Mengunduh ${latest.name}… ${pct}%`);
    });
    prog.remove();
    handleFullBackupPackage(data, latest.name);
  }catch(err){
    prog.remove();
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
function downloadTemplatePointsXlsx(){
  const wb = xlsxWorkbookFromSheets([
    ["Emisi", xlsxSheetFromRows(POINTS_XLSX_HEADERS_EMISI, [])],
    ["Ambient & Lingkungan", xlsxSheetFromRows(POINTS_XLSX_HEADERS_AMBIENT, [])]
  ]);
  xlsxDownload(wb, "template_titik_pantau.xlsx");
}
function downloadTemplatePersonilXlsx(){
  const wb = xlsxWorkbookFromSheets([["Personil", xlsxSheetFromRows(PERSONIL_XLSX_HEADERS, [])]]);
  xlsxDownload(wb, "template_personil.xlsx");
}

