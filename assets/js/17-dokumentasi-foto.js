/* =========================================================
   DOKUMENTASI FOTO SAMPLING
   ---------------------------------------------------------
   Lampiran foto per titik (format "Data Pendukung/Lampiran SIMPEL PPU"): Petugas Laboratorium/PPC,
   Peralatan Sampling, Aktivitas Sampling (masing-masing boleh lebih dari 1 foto), dan 1 bukti
   screenshot BA yang sudah ditandatangani. Disimpan di DB.dokumentasiFoto[pointId] supaya ikut
   ke-export/import lewat backup JSON biasa — lihat exportAll/handleFullBackupPackage/
   applyFullBackupImport di 12-data-page.js: field ini generic ikut JSON.stringify/assign seluruh
   DB (bukan allowlist per field), TAPI ada saklar "Sertakan foto dokumentasi" di halaman Data yang
   sengaja mengosongkannya di file export (foto bisa berat) — lihat catatan _dokFotoExcluded di sana
   utk kenapa import HARUS bisa membedakan "file ini memang sengaja tanpa foto" dari "titiknya
   betul-betul tidak punya foto", supaya import file ringan tidak diam-diam menghapus foto yang
   sudah ada di device tsb.
   Foto TIDAK disimpan mentah dari kamera/galeri — selalu diresize+dikompres dulu (readAndResizeImage)
   supaya localStorage (kuota per-origin biasanya cuma beberapa MB) tidak cepat penuh kalau titiknya
   banyak. Kategori "baSigned" (screenshot dokumen) pakai PNG (lossless, teks tanda tangan tetap
   tajam), 3 kategori foto lapangan lainnya pakai JPEG (jauh lebih kecil utk foto asli/gradasi warna).
   Crop & ukuran cetak: NON-DESTRUKTIF — file/byte foto asli di IndexedDB TIDAK PERNAH disentuh oleh
   fitur ini. photo.crop {top,right,bottom,left} (persen dipotong tiap sisi) & photo.printSizePct cuma
   metadata tampilan, diterapkan saat RENDER SAJA (dokFotoBoxHtml, dipakai bareng di grid/lightbox/cetak
   PDF spy hasilnya konsisten) — kapan saja bisa direset/diubah lagi krn originalnya selalu utuh. Ini
   kebalikan dari versi lama (fitur crop sempat dicabut total krn dulu foto bisa kepotong PERMANEN) —
   sekarang beda krn originalnya dijamin tidak pernah ikut terpotong.
========================================================= */
/* ---------- Penyimpanan blob foto: IndexedDB, BUKAN localStorage ----------
   localStorage per-origin biasanya cuma beberapa MB TOTAL (dipakai bersama SELURUH data aplikasi
   lain — titik, tracking, hasil pemantauan, dst, semuanya di-JSON.stringify jadi SATU string tiap
   save()), jadi gampang penuh begitu foto (walau sudah diresize+dikompres, lihat readAndResizeImage
   di bawah) terkumpul dari banyak titik — apalagi tiap foto sempat kehitung sampai 6x krn dulu ikut
   disalin ke tiap snapshot riwayat (sudah diperbaiki, lihat snapshotBefore di 01-state.js). IndexedDB
   kuotanya jauh lebih besar (biasanya ratusan MB-GB, tergantung disk kosong browser) & memang
   didesain utk blob berukuran besar, jadi byte foto (dataUrl) disimpan DI SINI. DB.dokumentasiFoto
   di localStorage TETAP ADA tapi cuma metadata ringan {id, addedAt} per foto — dataUrl-nya diambil
   dari sini saat dibutuhkan (dokFotoIdbGet/GetMany), lewat cache in-memory dokFotoUrlCache supaya
   render grid/lightbox/cetak/download tidak perlu baca IndexedDB berulang-ulang utk foto yang sama.
   Foto yang SUDAH tersimpan sebelum perubahan ini (dataUrl masih nyempil di DB.dokumentasiFoto)
   dipindahkan otomatis sekali oleh dokFotoMigrateLegacyPhotos() di bagian bawah file ini. */
const DOKFOTO_IDB_NAME = "phmDokFotoDB";
const DOKFOTO_IDB_STORE = "foto";
let dokFotoIdbPromise = null;
function dokFotoIdbOpen(){
  if(dokFotoIdbPromise) return dokFotoIdbPromise;
  dokFotoIdbPromise = new Promise((resolve, reject)=>{
    if(!window.indexedDB){ reject(new Error("Browser ini tidak mendukung IndexedDB.")); return; }
    const req = indexedDB.open(DOKFOTO_IDB_NAME, 1);
    req.onupgradeneeded = ()=>{ if(!req.result.objectStoreNames.contains(DOKFOTO_IDB_STORE)) req.result.createObjectStore(DOKFOTO_IDB_STORE); };
    req.onsuccess = ()=>resolve(req.result);
    req.onerror = ()=>reject(req.error||new Error("Gagal membuka penyimpanan foto (IndexedDB)."));
  });
  return dokFotoIdbPromise;
}
function dokFotoIdbPut(id, dataUrl){
  return dokFotoIdbOpen().then(db=>new Promise((resolve,reject)=>{
    const tx = db.transaction(DOKFOTO_IDB_STORE,"readwrite");
    tx.objectStore(DOKFOTO_IDB_STORE).put(dataUrl, id);
    tx.oncomplete = ()=>resolve();
    tx.onerror = ()=>reject(tx.error);
  }));
}
function dokFotoIdbGet(id){
  return dokFotoIdbOpen().then(db=>new Promise((resolve,reject)=>{
    const tx = db.transaction(DOKFOTO_IDB_STORE,"readonly");
    const req = tx.objectStore(DOKFOTO_IDB_STORE).get(id);
    req.onsuccess = ()=>resolve(req.result);
    req.onerror = ()=>reject(req.error);
  }));
}
// Ambil banyak sekaligus dlm SATU transaksi — dipakai render grid thumbnail/cetak lampiran, jauh
// lebih cepat drpd buka transaksi terpisah utk tiap foto satu-satu.
function dokFotoIdbGetMany(ids){
  if(!ids.length) return Promise.resolve(new Map());
  return dokFotoIdbOpen().then(db=>new Promise((resolve,reject)=>{
    const tx = db.transaction(DOKFOTO_IDB_STORE,"readonly");
    const store = tx.objectStore(DOKFOTO_IDB_STORE);
    const out = new Map();
    ids.forEach(id=>{
      const req = store.get(id);
      req.onsuccess = ()=>{ if(req.result!==undefined) out.set(id, req.result); };
    });
    tx.oncomplete = ()=>resolve(out);
    tx.onerror = ()=>reject(tx.error);
  }));
}
function dokFotoIdbDelete(id){
  return dokFotoIdbOpen().then(db=>new Promise((resolve,reject)=>{
    const tx = db.transaction(DOKFOTO_IDB_STORE,"readwrite");
    tx.objectStore(DOKFOTO_IDB_STORE).delete(id);
    tx.oncomplete = ()=>resolve();
    tx.onerror = ()=>reject(tx.error);
  }));
}
function dokFotoIdbDeleteMany(ids){
  if(!ids.length) return Promise.resolve();
  return dokFotoIdbOpen().then(db=>new Promise((resolve,reject)=>{
    const tx = db.transaction(DOKFOTO_IDB_STORE,"readwrite");
    const store = tx.objectStore(DOKFOTO_IDB_STORE);
    ids.forEach(id=>store.delete(id));
    tx.oncomplete = ()=>resolve();
    tx.onerror = ()=>reject(tx.error);
  }));
}
// Semua entry {id,dataUrl} — dipakai export JSON (backup lengkap tetap 1 file portable, berdiri
// sendiri tanpa bergantung IndexedDB perangkat asal) & estimasi ukuran total foto tersimpan.
function dokFotoIdbGetAll(){
  return dokFotoIdbOpen().then(db=>new Promise((resolve,reject)=>{
    const tx = db.transaction(DOKFOTO_IDB_STORE,"readonly");
    const store = tx.objectStore(DOKFOTO_IDB_STORE);
    const out = [];
    const req = store.openCursor();
    req.onsuccess = ()=>{
      const cur = req.result;
      if(cur){ out.push({id:cur.key, dataUrl:cur.value}); cur.continue(); }
    };
    tx.oncomplete = ()=>resolve(out);
    tx.onerror = ()=>reject(tx.error);
  }));
}
function dokFotoIdbBulkPut(entries){
  if(!entries.length) return Promise.resolve();
  return dokFotoIdbOpen().then(db=>new Promise((resolve,reject)=>{
    const tx = db.transaction(DOKFOTO_IDB_STORE,"readwrite");
    const store = tx.objectStore(DOKFOTO_IDB_STORE);
    entries.forEach(e=>store.put(e.dataUrl, e.id));
    tx.oncomplete = ()=>resolve();
    tx.onerror = ()=>reject(tx.error);
  }));
}
// Cache in-memory {id -> dataUrl}, murni mempercepat render berulang tanpa baca ulang IndexedDB tiap
// kali — BUKAN sumber kebenaran (itu tetap IndexedDB), boleh hilang isinya kapan saja (reload halaman
// dsb) tanpa efek samping krn selalu diisi ulang dari dokFotoWarmCache saat dibutuhkan.
const dokFotoUrlCache = new Map();
async function dokFotoWarmCache(ids){
  const missing = ids.filter(id=>!dokFotoUrlCache.has(id));
  if(!missing.length) return;
  const fetched = await dokFotoIdbGetMany(missing);
  fetched.forEach((dataUrl,id)=>dokFotoUrlCache.set(id, dataUrl));
}
function dokFotoUrlFor(id){ return dokFotoUrlCache.get(id) || ""; }

const DOKFOTO_CATEGORIES = [
  {key:"personil", label:"Petugas Laboratorium / PPC", noTeknis:1, ketentuan:"Petugas Laboratorium", format:"jpeg"},
  {key:"alat", label:"Peralatan Sampling", noTeknis:2, ketentuan:"Peralatan Sampling", format:"jpeg"},
  {key:"aktivitas", label:"Aktivitas Sampling", noTeknis:3, ketentuan:"Aktivitas Sampling", format:"jpeg"},
  {key:"baSigned", label:"Bukti BA Sudah Ditandatangani", noTeknis:4, ketentuan:"BA Sampling", format:"png"}
];
function dokFotoCatMeta(key){ return DOKFOTO_CATEGORIES.find(c=>c.key===key); }
// Label super-ringkas per kategori, KHUSUS kolom sempit (tabel rekap) — nama lengkapnya tetap ada
// lewat title="" tooltip di <th>, jadi tidak hilang informasinya, cuma tidak menuh-menuhin kolom.
function dokFotoCatShortLabel(key){
  return {personil:"Petugas", alat:"Alat", aktivitas:"Aktivitas", baSigned:"BA"}[key] || key;
}
function ensureDokFoto(pointId){
  if(!DB.dokumentasiFoto) DB.dokumentasiFoto = {};
  if(!DB.dokumentasiFoto[pointId]) DB.dokumentasiFoto[pointId] = {};
  const d = DB.dokumentasiFoto[pointId];
  DOKFOTO_CATEGORIES.forEach(c=>{ if(!Array.isArray(d[c.key])) d[c.key] = []; });
  return d;
}
function dokFotoHasAnyPhoto(pointId){
  const d = ensureDokFoto(pointId);
  return DOKFOTO_CATEGORIES.some(c=>d[c.key].length>0);
}

/* ---------- Render foto non-destruktif (crop & ukuran cetak) ----------
   SATU helper dipakai di grid thumbnail, lightbox, DAN cetak PDF supaya hasilnya konsisten di mana-
   mana (prinsip yg sama dipakai di seluruh tools ini utk hal yg muncul di banyak tempat) — byte foto
   (dataUrl) yang dikirim ke sini SELALU yang asli utuh dari IndexedDB, crop cuma soal bagaimana itu
   DITAMPILKAN (pakai <img> posisi absolut yg digeser & diperbesar sehingga cuma area crop yg keliatan,
   BUKAN CSS background-image — supaya elemen fotonya tetap <img> biasa yg pasti ikut tercetak di PDF
   walau setting "background graphics" browser user mati, beda dgn background-image yg suka disembunyikan
   printer/PDF secara default). */
function dokFotoCropOf(photo){
  const c = photo && photo.crop;
  if(!c) return null;
  const top = Number(c.top)||0, right = Number(c.right)||0, bottom = Number(c.bottom)||0, left = Number(c.left)||0;
  if(!top && !right && !bottom && !left) return null;
  return {top, right, bottom, left};
}
function dokFotoBoxHtml(photo, dataUrl, opts){
  opts = opts||{};
  const imgAttrs = opts.imgAttrs||"";
  const crop = dokFotoCropOf(photo);
  if(!crop || !photo.w || !photo.h){
    return `<img src="${dataUrl}" ${imgAttrs} style="${opts.plainImgStyle||"width:100%;height:auto;display:block;"}">`;
  }
  const visW = Math.max(5, 100-crop.left-crop.right), visH = Math.max(5, 100-crop.top-crop.bottom);
  const aspect = `${Math.max(1, photo.w*visW/100).toFixed(0)} / ${Math.max(1, photo.h*visH/100).toFixed(0)}`;
  const imgW = (10000/visW).toFixed(3), imgH = (10000/visH).toFixed(3);
  const imgL = (-100*crop.left/visW).toFixed(3), imgT = (-100*crop.top/visH).toFixed(3);
  return `<div style="position:relative;overflow:hidden;aspect-ratio:${aspect};${opts.cropWrapStyle||""}">
    <img src="${dataUrl}" ${imgAttrs} style="position:absolute;max-width:none;width:${imgW}%;height:${imgH}%;left:${imgL}%;top:${imgT}%;display:block;">
  </div>`;
}
// Estimasi ukuran penyimpanan foto SAJA (bukan seluruh DB) supaya user bisa pantau sendiri
// pertumbuhannya dari halaman ini — dihitung dari IndexedDB (tempat dataUrl-nya sekarang benar2
// tersimpan), bukan DB.dokumentasiFoto lagi (yg skrg cuma metadata ringan {id,addedAt}, ukurannya
// tidak mencerminkan foto sama sekali).
async function dokFotoStorageBytes(){
  const all = await dokFotoIdbGetAll();
  return all.reduce((sum,e)=>sum + (e.dataUrl ? e.dataUrl.length : 0), 0);
}
function fmtBytes(n){
  if(n < 1024) return n+" B";
  if(n < 1024*1024) return (n/1024).toFixed(0)+" KB";
  return (n/1024/1024).toFixed(1)+" MB";
}
function sanitizeFotoFilename(s){ return String(s||"").replace(/[\\/:*?"<>|]/g,"_"); }

/* ---------- Resize + kompres gambar sebelum disimpan ---------- */
// Resolve {dataUrl, width, height} — width/height (ukuran hasil resize) disimpan di metadata foto
// (photo.w/photo.h) supaya fitur crop non-destruktif (dokFotoBoxHtml) bisa langsung hitung aspect
// ratio area crop tanpa perlu decode ulang gambar tiap kali dirender.
function readAndResizeImage(file, maxEdge, format, quality){
  return new Promise((resolve, reject)=>{
    if(!file.type || !file.type.startsWith("image/")){ reject(new Error(`"${file.name}" bukan file gambar.`)); return; }
    const reader = new FileReader();
    reader.onerror = ()=>reject(new Error(`Gagal membaca file "${file.name}".`));
    reader.onload = ()=>{
      const img = new Image();
      img.onerror = ()=>reject(new Error(`"${file.name}" tidak bisa dibaca sebagai gambar.`));
      img.onload = ()=>{
        const scale = Math.min(1, maxEdge/Math.max(img.naturalWidth, img.naturalHeight));
        const cw = Math.max(1, Math.round(img.naturalWidth*scale));
        const ch = Math.max(1, Math.round(img.naturalHeight*scale));
        const canvas = document.createElement("canvas");
        canvas.width = cw; canvas.height = ch;
        canvas.getContext("2d").drawImage(img, 0, 0, cw, ch);
        const dataUrl = format==="png" ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", quality||0.75);
        resolve({dataUrl, width: cw, height: ch});
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
// Dimensi gambar dari dataUrl yang SUDAH tersimpan (foto lama, sebelum photo.w/h ada) — dipakai
// sekali oleh crop editor saat baru pertama kali dibuka utk foto lama, lalu disimpan ke photo.w/h
// (metadata saja, TIDAK menyentuh byte foto) supaya tidak perlu decode ulang di kesempatan berikutnya.
function dokFotoImageDims(dataUrl){
  return new Promise((resolve, reject)=>{
    const img = new Image();
    img.onload = ()=>resolve({width: img.naturalWidth, height: img.naturalHeight});
    img.onerror = ()=>reject(new Error("Gagal membaca dimensi gambar."));
    img.src = dataUrl;
  });
}

/* ---------- Tambah foto (input file tersembunyi, dipicu tombol "+ Tambah" per kategori) ---------- */
document.getElementById("hiddenPhotoFile").addEventListener("change", async e=>{
  const files = Array.from(e.target.files||[]);
  const pointId = e.target.dataset.point, cat = e.target.dataset.cat;
  const meta = dokFotoCatMeta(cat);
  if(!files.length || !pointId || !meta) return;
  let okCount = 0;
  const errors = [];
  const addedIds = [];
  for(const file of files){
    try{
      const {dataUrl, width, height} = await readAndResizeImage(file, 1000, meta.format, 0.75);
      const id = uid("FOTO");
      // Byte foto ditulis ke IndexedDB DULU (kuota jauh lebih besar drpd localStorage) — kalau ini
      // gagal (mis. browser lama tanpa IndexedDB), foto ini dilewati spt error gambar biasa, TANPA
      // sempat masuk metadata DB.dokumentasiFoto sama sekali (tidak ada metadata yatim tanpa byte).
      await dokFotoIdbPut(id, dataUrl);
      dokFotoUrlCache.set(id, dataUrl);
      ensureDokFoto(pointId)[cat].push({id, addedAt: new Date().toISOString(), w: width, h: height});
      addedIds.push(id);
      okCount++;
    }catch(err){ errors.push(err.message); }
  }
  e.target.value = "";
  if(okCount){
    try{
      save();
      toast(`${okCount} foto ditambahkan ke "${meta.label}"${errors.length?`. ${errors.length} file dilewati (bukan gambar valid).`:"."}`, "ok");
    }catch(err){
      // Rollback penambahan di memori kalau gagal disimpan (localStorage penuh dsb — kini jauh lebih
      // jarang krn byte foto sendiri sudah di IndexedDB, tapi metadata lain di DB tetap bisa bikin
      // localStorage penuh) — supaya tampilan tidak menampilkan foto yang sebenarnya TIDAK tersimpan.
      const arr = ensureDokFoto(pointId)[cat];
      arr.splice(arr.length-okCount, okCount);
      dokFotoIdbDeleteMany(addedIds).catch(()=>{});
      addedIds.forEach(id=>dokFotoUrlCache.delete(id));
      toast("Foto GAGAL disimpan (penyimpanan browser penuh) — lihat pesan di atas. Coba kompres/kurangi jumlah foto, atau kosongkan Riwayat & Snapshot lama.", "err");
    }
  } else if(errors.length){
    toast("Tidak ada foto yang berhasil ditambahkan: "+errors.join(" "), "err");
  }
  renderDokumentasiFoto();
});

/* ---------- Hapus foto ---------- */
function deleteDokFoto(pointId, cat, photoId){
  askConfirm("Hapus foto ini? Tindakan ini tidak bisa dibatalkan.", ()=>{
    const d = ensureDokFoto(pointId);
    d[cat] = d[cat].filter(p=>p.id!==photoId);
    save();
    dokFotoIdbDelete(photoId).catch(()=>{}); // bersihkan byte-nya juga — gagal di sini tidak fatal, metadatanya sudah terhapus
    dokFotoUrlCache.delete(photoId);
    renderDokumentasiFoto();
    toast("Foto dihapus.", "ok");
  });
}

/* ---------- Download foto ---------- */
function downloadDataUrl(dataUrl, filename){
  const a = document.createElement("a");
  a.href = dataUrl; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}
async function downloadSingleDokFoto(pointId, cat, photoId){
  const p = DB.points.find(x=>x.id===pointId);
  const meta = dokFotoCatMeta(cat);
  const photo = (ensureDokFoto(pointId)[cat]||[]).find(ph=>ph.id===photoId);
  if(!photo || !p || !meta) return;
  const dataUrl = dokFotoUrlCache.get(photoId) || await dokFotoIdbGet(photoId);
  if(!dataUrl){ toast("Foto tidak ditemukan di penyimpanan (mungkin sudah terhapus).","err"); return; }
  const ext = meta.format==="png" ? "png" : "jpg";
  downloadDataUrl(dataUrl, `${sanitizeFotoFilename(p.nama)}_${meta.key||cat}.${ext}`);
}
// Diunduh satu-satu dengan jeda kecil (bukan sekaligus) — beberapa browser menahan/minta izin
// tambahan kalau banyak file di-download bersamaan dalam satu tick tanpa jeda sama sekali.
async function downloadDokFotoAll(pointId){
  const p = DB.points.find(x=>x.id===pointId);
  if(!p) return;
  const d = ensureDokFoto(pointId);
  const entries = [];
  DOKFOTO_CATEGORIES.forEach(cat=>{
    d[cat.key].forEach((ph,i)=>{
      const ext = cat.format==="png" ? "png" : "jpg";
      entries.push({id: ph.id, filename: `${sanitizeFotoFilename(p.nama)}_${cat.key}${d[cat.key].length>1?"_"+(i+1):""}.${ext}`});
    });
  });
  if(!entries.length){ toast("Titik ini belum punya foto.","err"); return; }
  const urls = await dokFotoIdbGetMany(entries.map(en=>en.id));
  let n = 0;
  for(const en of entries){
    const dataUrl = dokFotoUrlCache.get(en.id) || urls.get(en.id);
    if(!dataUrl) continue;
    downloadDataUrl(dataUrl, en.filename);
    n++;
    await new Promise(res=>setTimeout(res, 220));
  }
  toast(`${n} foto diunduh.`, "ok");
}

/* ---------- Judul umum "Nama Titik — site — kategori — tanggal sampling", dipakai di lightbox &
   kartu titik supaya konsisten dgn format contoh Lampiran SIMPEL PPU (Kode Cerobong/Sumber Emisi
   di kepala tiap lampiran foto). ---------- */
function dokFotoKategoriLabel(p){
  return p.kategori==="emisi" ? (p.kategoriSumber||"-") : (NONEMISI_LABEL[p.kategori]||p.kategori);
}
function dokFotoPointCaptionHtml(pointId){
  const p = DB.points.find(x=>x.id===pointId);
  if(!p) return { title: "", sub: "" };
  const t = ensureTracking(pointId);
  const dateInfo = (t.samplingStatus==="sampled" && t.dates.actual) ? ` &middot; Disampling ${fmtTanggalIndo(t.dates.actual)}` : "";
  return { title: escHtml(p.nama), sub: `${escHtml(p.site)} &middot; ${escHtml(dokFotoKategoriLabel(p))}${dateInfo}` };
}

/* ---------- Lightbox (preview foto sebagaimana ditampilkan di grid/cetak — kalau sudah di-crop,
   yang tampil di sini area crop-nya; tombol "Atur Crop / Ukuran" membuka editor yg menunjukkan foto
   ASLI utuh utk diubah). ---------- */
async function openDokFotoLightbox(pointId, cat, photoId){
  const photo = (ensureDokFoto(pointId)[cat]||[]).find(p=>p.id===photoId);
  if(!photo) return;
  const dataUrl = dokFotoUrlCache.get(photoId) || await dokFotoIdbGet(photoId);
  if(!dataUrl){ toast("Foto tidak ditemukan di penyimpanan (mungkin sudah terhapus).","err"); return; }
  const cap = dokFotoPointCaptionHtml(pointId);
  const cropped = !!dokFotoCropOf(photo);
  const box = dokFotoBoxHtml(photo, dataUrl, {
    plainImgStyle:"max-width:100%;max-height:75vh;border-radius:4px;display:block;margin:0 auto;",
    cropWrapStyle:"max-width:520px;max-height:75vh;margin:0 auto;border-radius:4px;"
  });
  openModal(`
    <h3>${cap.title} <span class="muted" style="font-weight:400;font-size:13px;">&mdash; ${escHtml(dokFotoCatMeta(cat).label)}</span></h3>
    <div class="hint" style="margin-top:-6px;">${cap.sub}${cropped?` &middot; <span style="color:var(--teal-600,#0d8a7a);">foto ini sudah di-crop/resize (non-destruktif, foto asli tetap utuh)</span>`:""}</div>
    <div style="text-align:center;background:var(--gray-100);border-radius:8px;padding:10px;margin-top:10px;">
      ${box}
    </div>
    <div class="actions">
      <button class="btn" data-action="openDokFotoCropEditor" data-point="${pointId}" data-cat="${cat}" data-id="${photoId}">Atur Crop / Ukuran</button>
      <button class="btn danger" data-action="deleteDokFoto" data-point="${pointId}" data-cat="${cat}" data-id="${photoId}">Hapus Foto</button>
      <button class="btn ghost" data-action="downloadSingleDokFoto" data-point="${pointId}" data-cat="${cat}" data-id="${photoId}">Download Foto Ini</button>
      <span class="spacer"></span>
      <button class="btn ghost" data-action="closeModal">Tutup</button>
    </div>
  `, {wide:true});
}

/* ---------- Editor Crop & Ukuran (non-destruktif) ----------
   dokFotoCropDraft: state sementara SELAMA modal ini terbuka (belum ditulis ke DB.dokumentasiFoto
   sampai tombol "Simpan" ditekan) — ditutup/Batal tanpa Simpan = tidak ada perubahan sama sekali.
   Foto ASLI (byte di IndexedDB) tidak pernah disentuh oleh apapun di sini; yang diubah cuma metadata
   photo.crop {top,right,bottom,left dalam persen} & photo.printSizePct, dan itu pun bisa direset/
   diubah lagi kapan saja lewat tombol yang sama. */
let dokFotoCropDraft = null;
async function openDokFotoCropEditor(pointId, cat, photoId){
  const photo = (ensureDokFoto(pointId)[cat]||[]).find(p=>p.id===photoId);
  if(!photo) return;
  const dataUrl = dokFotoUrlCache.get(photoId) || await dokFotoIdbGet(photoId);
  if(!dataUrl){ toast("Foto tidak ditemukan di penyimpanan (mungkin sudah terhapus).","err"); return; }
  if(!photo.w || !photo.h){
    try{
      const dim = await dokFotoImageDims(dataUrl);
      photo.w = dim.width; photo.h = dim.height;
      save();
    }catch(err){ /* biarkan w/h kosong; preview crop tetap jalan berikutnya begitu berhasil */ }
  }
  const c = dokFotoCropOf(photo) || {top:0, right:0, bottom:0, left:0};
  dokFotoCropDraft = { pointId, cat, photoId, dataUrl, w: photo.w, h: photo.h, crop: {...c}, printSizePct: photo.printSizePct||100 };
  renderDokFotoCropEditor();
}
function dokFotoCropPreviewHtml(){
  const d = dokFotoCropDraft;
  const previewPhoto = { w: d.w, h: d.h, crop: d.crop };
  return dokFotoBoxHtml(previewPhoto, d.dataUrl, {
    plainImgStyle:"max-width:100%;max-height:320px;display:block;margin:0 auto;",
    cropWrapStyle:"max-width:320px;max-height:320px;margin:0 auto;background:var(--gray-200);"
  });
}
function renderDokFotoCropEditor(){
  const d = dokFotoCropDraft;
  if(!d) return;
  const sideLabels = [["top","Atas"],["bottom","Bawah"],["left","Kiri"],["right","Kanan"]];
  const sizeOpts = [100, 70, 40];
  openModal(`
    <h3>Atur Crop &amp; Ukuran Foto</h3>
    <div class="hint" style="margin-top:-6px;">Pengaturan ini <b>tidak mengubah file foto asli</b> — foto asli tetap tersimpan utuh, jadi area crop &amp; ukuran cetak bisa diubah atau dikembalikan kapan saja. Berguna utk memangkas bagian foto yang tidak perlu dan mengecilkan ukuran cetak supaya PDF tidak kebanyakan halaman.</div>
    <div id="dokFotoCropModal" style="display:grid;grid-template-columns:minmax(0,260px) 1fr;gap:18px;margin-top:14px;align-items:start;">
      <div id="dfcPreviewHost" style="border:1px solid var(--gray-200);border-radius:8px;padding:10px;background:#fff;">${dokFotoCropPreviewHtml()}</div>
      <div>
        ${sideLabels.map(([side,label])=>`
          <label style="display:block;font-size:12px;font-weight:700;margin:10px 0 4px;">Potong dari ${label}: <span id="dfc${side.charAt(0).toUpperCase()+side.slice(1)}Val">${d.crop[side]}</span>%</label>
          <input type="range" class="dfc-slider" data-side="${side}" min="0" max="45" value="${d.crop[side]}" style="width:100%;">
        `).join("")}
        <label style="display:block;font-size:12px;font-weight:700;margin:14px 0 4px;">Ukuran saat Cetak PDF</label>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${sizeOpts.map(p=>`<button type="button" class="btn small ${d.printSizePct===p?"":"ghost"}" data-dfc-size="${p}">${p===100?"Penuh":p+"%"}</button>`).join("")}
        </div>
        <div class="hint" style="margin-top:10px;">Ukuran cetak cuma berlaku saat "Cetak PDF" (grid &amp; lightbox tetap tampil normal) — dipakai kalau foto full-size bikin halaman PDF kebanyakan.</div>
      </div>
    </div>
    <div class="actions">
      <button class="btn ghost" data-action="dokFotoCropReset">Reset (Tampilkan Penuh)</button>
      <span class="spacer"></span>
      <button class="btn ghost" data-action="closeModal">Batal</button>
      <button class="btn" data-action="dokFotoCropSave">Simpan</button>
    </div>
  `, {wide:true});
}
function dokFotoCropSliderInput(el){
  const d = dokFotoCropDraft;
  if(!d) return;
  const side = el.dataset.side;
  const opp = {top:"bottom", bottom:"top", left:"right", right:"left"}[side];
  let val = Math.max(0, Math.min(45, Number(el.value)||0));
  const maxForSide = Math.max(0, 90-d.crop[opp]);
  if(val>maxForSide){ val = maxForSide; el.value = val; }
  d.crop[side] = val;
  const lbl = document.getElementById("dfc"+side.charAt(0).toUpperCase()+side.slice(1)+"Val");
  if(lbl) lbl.textContent = val;
  // Update label & preview saja (BUKAN render ulang seluruh modal): kalau slider ikut dibuat ulang di
  // tengah drag, gesture drag-nya keputus di sebagian browser. Tombol ukuran cetak tetap lewat
  // renderDokFotoCropEditor penuh krn itu klik diskrit, bukan drag berkelanjutan spt slider ini.
  const host = document.getElementById("dfcPreviewHost");
  if(host) host.innerHTML = dokFotoCropPreviewHtml();
}
document.addEventListener("input", e=>{
  if(e.target.classList && e.target.classList.contains("dfc-slider")) dokFotoCropSliderInput(e.target);
});
document.addEventListener("click", e=>{
  const btn = e.target.closest("[data-dfc-size]");
  if(btn && dokFotoCropDraft){ dokFotoCropDraft.printSizePct = Number(btn.dataset.dfcSize); renderDokFotoCropEditor(); }
});

/* ---------- Cetak / Export PDF, format "Data Pendukung/Lampiran SIMPEL PPU" (contoh dilampirkan
   user): header identitas + tabel 4 baris (Petugas Laboratorium/Peralatan Sampling/Aktivitas
   Sampling/BA Sampling). Memakai mekanisme cetak yang sama dgn Berita Acara (setPrintOrientation +
   #printGuideArea + window.print(), lihat printBeritaAcara di 11-berita-acara.js) — .pg-batch bikin
   tiap titik otomatis mulai di halaman baru kalau yang dicetak lebih dari 1 titik sekaligus. ---------- */
function dokFotoLampiranTitleFor(team){
  return team==="emisi" ? "Foto Sampling Emisi" : "Foto Pengukuran Kualitas Udara Ambien &amp; Kebisingan";
}
function dokFotoPhotosCellHtml(photos){
  if(!photos.length) return `<span class="muted" style="font-style:italic;">(belum ada foto)</span>`;
  // photo.printSizePct (diatur lewat "Atur Crop / Ukuran") mengecilkan lebar cetak per foto — dipakai
  // user utk memangkas jumlah halaman PDF saat foto full-size terlalu banyak, TANPA mengubah file asli.
  return photos.map(ph=>{
    const pct = (ph.printSizePct && ph.printSizePct<100) ? ph.printSizePct : 100;
    const box = dokFotoBoxHtml(ph, dokFotoUrlFor(ph.id), {
      plainImgStyle:"width:100%;height:auto;display:block;border:1px solid #999;",
      cropWrapStyle:"border:1px solid #999;"
    });
    return `<div style="width:${pct}%;margin-bottom:8px;">${box}</div>`;
  }).join("");
}
async function buildDokFotoLampiranHtml(pointIds){
  const cfg = ensureBaConfig();
  // Kumpulkan SEMUA id foto dari semua titik yg mau dicetak dulu & warm cache SEKALI di awal —
  // dokFotoPhotosCellHtml di atas tetap sinkron (baca dari cache), drpd fetch IndexedDB satu-satu
  // per <img> yg mau ribet dijadikan async sendiri-sendiri di tengah .map().
  const allIds = [];
  pointIds.forEach(pointId=>{
    const d = ensureDokFoto(pointId);
    DOKFOTO_CATEGORIES.forEach(cat=>d[cat.key].forEach(ph=>allIds.push(ph.id)));
  });
  await dokFotoWarmCache(allIds);
  return pointIds.map(pointId=>{
    const p = DB.points.find(x=>x.id===pointId);
    if(!p) return "";
    const d = ensureDokFoto(pointId);
    const team = p.kategori==="emisi" ? "emisi" : "ambient";
    const titikFieldLabel = p.kategori==="emisi" ? "Kode Cerobong" : "Titik Sampling";
    const sumberFieldLabel = p.kategori==="emisi" ? "Sumber Emisi" : "Jenis Pengukuran";
    return `<div class="pg-batch pg-dokfoto">
      <div class="pg-dokfoto-title">
        <h1>DATA PENDUKUNG/LAMPIRAN SIMPEL PPU</h1>
        <div class="sub">${dokFotoLampiranTitleFor(team)}</div>
      </div>
      <table class="pg-ba-meta">
        <tr><td style="width:150px;">Nama Perusahaan</td><td style="width:14px;">:</td><td>PT Pertamina Hulu Mahakam &ndash; Lapangan ${escHtml(p.site)}</td></tr>
        <tr><td>${titikFieldLabel}</td><td>:</td><td>${escHtml(p.nama)}</td></tr>
        <tr><td>${sumberFieldLabel}</td><td>:</td><td>${escHtml(dokFotoKategoriLabel(p))}</td></tr>
        <tr><td>Nama Laboratorium</td><td>:</td><td>${escHtml(cfg[team].labPerusahaan)}</td></tr>
      </table>
      <table class="pg-dokfoto-table">
        <thead><tr><th style="width:26px;">No</th><th style="width:150px;">Ketentuan Teknis</th><th>Dokumentasi/Foto</th></tr></thead>
        <tbody>
          ${DOKFOTO_CATEGORIES.map(cat=>`<tr><td>${cat.noTeknis}</td><td>${escHtml(cat.ketentuan)}</td><td>${dokFotoPhotosCellHtml(d[cat.key])}</td></tr>`).join("")}
        </tbody>
      </table>
    </div>`;
  }).filter(Boolean).join("");
}
function dokFotoLampiranFilename(pointIds){
  if(pointIds.length===1){
    const p = DB.points.find(x=>x.id===pointIds[0]);
    return `Foto Sampling_${p?sanitizeFotoFilename(p.nama):"titik"}`;
  }
  return `Foto Sampling_${pointIds.length} titik_${DB.meta.semester} ${DB.meta.tahun}`;
}
async function printDokFotoLampiran(pointIds){
  if(!pointIds || !pointIds.length){ toast("Tidak ada titik untuk dicetak.","err"); return; }
  const html = await buildDokFotoLampiranHtml(pointIds);
  if(!html){ toast("Titik tidak ditemukan.","err"); return; }
  setPrintOrientation("portrait", 15);
  document.getElementById("printGuideArea").innerHTML = html;
  // Tunggu semua <img> selesai decode dulu (sama spt printBeritaAcara) — kalau tidak, hasil cetak/
  // PDF bisa menangkap kondisi foto masih kosong walau di layar akhirnya normal.
  const imgs = Array.from(document.querySelectorAll("#printGuideArea img"));
  await Promise.all(imgs.map(img=>{
    if(img.decode) return img.decode().catch(()=>{});
    if(img.complete) return Promise.resolve();
    return new Promise(res=>{ img.onload = res; img.onerror = res; });
  }));
  const originalTitle = document.title;
  document.title = dokFotoLampiranFilename(pointIds);
  window.print();
  document.title = originalTitle;
}
function printSingleDokFotoLampiran(pointId){ printDokFotoLampiran([pointId]); }
function printAllVisibleDokFotoLampiran(){
  const withPhotos = getFilteredDokFotoPoints().filter(p=>dokFotoHasAnyPhoto(p.id));
  if(!withPhotos.length){ toast("Tidak ada titik dengan foto pada filter Tim/Batch/Site saat ini.","err"); return; }
  printDokFotoLampiran(withPhotos.map(p=>p.id));
}

/* ---------- Filter, pengelompokan per jenis sumber emisi, & render halaman ---------- */
function refreshDokBatchSelect(){
  const team = document.getElementById("dokTeam").value;
  const sel = document.getElementById("dokBatch");
  const cur = sel.value;
  const list = DB.batches.filter(b=> !team || b.team===team);
  sel.innerHTML = '<option value="">Semua</option>' + list.map(b=>`<option value="${b.id}">${escHtml(b.name)}</option>`).join("");
  if(list.some(b=>b.id===cur)) sel.value = cur;
}
function refreshDokSiteSelect(){
  const sel = document.getElementById("dokSite");
  const cur = sel.value;
  const sites = [...new Set(DB.points.filter(p=>p.batchId).map(p=>p.site))].sort();
  sel.innerHTML = '<option value="">Semua</option>' + sites.map(s=>`<option value="${escHtml(s)}">${escHtml(s)}</option>`).join("");
  if(sites.includes(cur)) sel.value = cur;
}
// Semesta titiknya SAMA dgn Tracking BA/CoA (p.batchId terisi) — dokumentasi foto memang cuma
// relevan utk titik yang benar-benar masuk sebuah batch eksekusi, titik yang tidak wajib/belum
// pernah dijadwalkan tidak perlu foto apapun.
function getFilteredDokFotoPointsBase(){
  const team = document.getElementById("dokTeam").value;
  const batchId = document.getElementById("dokBatch").value;
  const site = document.getElementById("dokSite").value;
  let pts = DB.points.filter(p=>p.batchId);
  if(team) pts = pts.filter(p=> team==="emisi" ? p.kategori==="emisi" : p.kategori!=="emisi");
  if(batchId) pts = pts.filter(p=>p.batchId===batchId);
  if(site) pts = pts.filter(p=>p.site===site);
  return pts.sort((a,b)=> a.site.localeCompare(b.site) || a.nama.localeCompare(b.nama));
}
// Filter Status (final/ada foto belum final/belum ada foto) dipisah dari filter dasar Tim/Batch/Site
// supaya rekap (dokFotoRecapCounts) bisa hitung total PER STATUS dari filter dasar yang sama, tanpa
// filter status itu sendiri ikut memotong angkanya (baru diterapkan belakangan di sini).
function getFilteredDokFotoPoints(){
  const statusEl = document.getElementById("dokStatus");
  const status = statusEl ? statusEl.value : "";
  const pts = getFilteredDokFotoPointsBase();
  return status ? pts.filter(p=>dokFotoStatusOf(p.id)===status) : pts;
}
function dokFotoIsFinal(pointId){ return !!ensureDokFoto(pointId).final; }
function dokFotoStatusOf(pointId){
  if(dokFotoIsFinal(pointId)) return "final";
  return dokFotoHasAnyPhoto(pointId) ? "notfinal" : "empty";
}
// Tandai/batalkan "final" per TITIK (bukan per foto) — dipakai user utk merekap mana yg fotonya
// sudah lengkap & oke, mana yg masih perlu direvisi, terutama saat pekerjaan dibagi ke banyak orang.
function toggleDokFotoFinal(pointId){
  const d = ensureDokFoto(pointId);
  if(!d.final && !dokFotoHasAnyPhoto(pointId)){
    toast("Titik ini belum ada foto sama sekali — tambahkan foto dulu sebelum ditandai final.", "err");
    return;
  }
  d.final = !d.final;
  d.finalAt = d.final ? new Date().toISOString() : null;
  save();
  renderDokumentasiFoto();
  toast(d.final ? "Foto titik ini ditandai FINAL." : "Tanda final dibatalkan — foto boleh diubah lagi.", "ok");
}
function dokFotoRecapCounts(){
  const pts = getFilteredDokFotoPointsBase();
  const counts = {total: pts.length, final: 0, notfinal: 0, empty: 0};
  pts.forEach(p=>{ counts[dokFotoStatusOf(p.id)]++; });
  return counts;
}
function renderDokFotoRecap(){
  const host = document.getElementById("dokFotoRecap");
  if(!host) return;
  const counts = dokFotoRecapCounts();
  const curStatus = document.getElementById("dokStatus").value;
  const chip = (status,label,n,cls)=>`<button type="button" class="dokfoto-recap-chip ${cls}${curStatus===status?" active":""}" data-action="dokFotoFilterStatus" data-status="${status}">${escHtml(label)} <b>${n}</b></button>`;
  host.innerHTML = `
    <span class="muted" style="font-size:11.5px;font-weight:700;">Rekap Kelengkapan Foto (mengikuti filter Tim/Batch/Site):</span>
    ${chip("", "Semua Titik", counts.total, "all")}
    ${chip("final", "Sudah Final", counts.final, "ok")}
    ${chip("notfinal", "Ada Foto, Belum Final", counts.notfinal, "warn")}
    ${chip("empty", "Belum Ada Foto", counts.empty, "err")}
    <button type="button" class="btn small ghost" style="margin-left:auto;" data-action="dokFotoSampledRecapModal">Tabel Rekap vs Status Sampling</button>
  `;
}
/* ---------- Tabel rekap: titik yang SUDAH DISAMPLING (Tracking BA/CoA) apakah fotonya sudah lengkap
   per kategori atau belum ---------- jawaban atas permintaan "recap semacam tabel utk semua engine
   yg sudah disampling apakah sudah ada fotonya atau belum, yg kurang mana saja". Beda dari chip rekap
   final di atas (itu berbasis status TANDA FINAL user, ini berbasis status SAMPLING dari Tracking —
   dua sudut pandang yang saling melengkapi, bukan pengganti satu sama lain). */
function dokFotoSampledRecapRows(onlySampled){
  let pts = getFilteredDokFotoPointsBase();
  if(onlySampled) pts = pts.filter(p=> ensureTracking(p.id).samplingStatus==="sampled");
  return pts.map(p=>{
    const d = ensureDokFoto(p.id);
    const t = ensureTracking(p.id);
    const catStatus = DOKFOTO_CATEGORIES.map(cat=>({label: cat.label, has: (d[cat.key]||[]).length>0}));
    return { p, t, catStatus, allComplete: catStatus.every(c=>c.has), final: !!d.final };
  });
}
let dokFotoRecapOnlySampled = true;
function renderDokFotoSampledRecapModal(onlySampled){
  dokFotoRecapOnlySampled = onlySampled;
  const rows = dokFotoSampledRecapRows(onlySampled);
  const doneCount = rows.filter(r=>r.allComplete).length;
  openModal(`
    <h3>Rekap Foto vs Status Sampling</h3>
    <div class="hint" style="margin-top:-6px;">${onlySampled?"Titik yang statusnya <b>sudah disampling</b>":"Semua titik"} (mengikuti filter Tim/Batch/Site di halaman) &mdash; ${rows.length} titik, <span style="color:var(--green-600,#0d8a4f);font-weight:700;">${doneCount} sudah lengkap 4 kategori foto</span>, <span style="color:#a02a24;font-weight:700;">${rows.length-doneCount} masih kurang</span>.</div>
    <div class="actions" style="margin:10px 0;">
      <button class="btn small ${onlySampled?"":"ghost"}" data-action="dokFotoRecapToggleScope" data-only-sampled="1">Sudah Disampling Saja</button>
      <button class="btn small ${onlySampled?"ghost":""}" data-action="dokFotoRecapToggleScope" data-only-sampled="0">Semua Titik</button>
    </div>
    <div class="tablewrap" style="max-height:58vh;">
    <table style="width:100%;border-collapse:collapse;font-size:12px;">
      <thead><tr style="border-bottom:1.5px solid var(--gray-300);position:sticky;top:0;background:#fff;">
        <th style="text-align:left;padding:5px 6px;">Titik</th><th style="text-align:left;padding:5px 6px;">Site</th>
        <th style="text-align:center;padding:5px 6px;min-width:64px;">Status</th>
        ${DOKFOTO_CATEGORIES.map(c=>`<th style="text-align:center;padding:5px 4px;min-width:40px;" title="${escHtml(c.label)}">${escHtml(dokFotoCatShortLabel(c.key))}</th>`).join("")}
        <th style="text-align:center;padding:5px 6px;">Final</th>
      </tr></thead>
      <tbody>${rows.length ? rows.map(r=>{
        const statusLabel = r.t.samplingStatus ? (SAMPLING_STATUS_LABELS[r.t.samplingStatus]||r.t.samplingStatus) : "Belum diisi";
        return `<tr style="border-bottom:1px solid var(--gray-200);${r.allComplete?"":"background:#fff8f0;"}">
          <td style="padding:5px 6px;">${escHtml(r.p.nama)}</td>
          <td style="padding:5px 6px;" class="muted">${escHtml(r.p.site)}</td>
          <td style="text-align:center;padding:5px 6px;"><span class="badge ${r.t.samplingStatus==="sampled"?"b-green":"b-teal"}" style="font-size:9.5px;white-space:nowrap;" title="${escHtml(statusLabel)}">${r.t.samplingStatus==="sampled"?"Sudah":"Belum"}</span></td>
          ${r.catStatus.map(c=>`<td style="text-align:center;padding:5px 4px;">${c.has?'<span style="color:var(--green-600,#0d8a4f);font-weight:800;">&#10003;</span>':'<span style="color:#a02a24;font-weight:800;">&#10007;</span>'}</td>`).join("")}
          <td style="text-align:center;padding:5px 6px;">${r.final?'<span style="color:var(--green-600,#0d8a4f);font-weight:800;">&#10003;</span>':""}</td>
        </tr>`;
      }).join("") : `<tr><td colspan="${4+DOKFOTO_CATEGORIES.length}" class="hint" style="text-align:center;padding:20px;">Tidak ada titik yang cocok (coba "Semua Titik" atau ubah filter Tim/Batch/Site).</td></tr>`}</tbody>
    </table>
    </div>
    <div class="actions">
      <span class="spacer"></span>
      <button class="btn ghost" data-action="closeModal">Tutup</button>
    </div>
  `, {wide:true});
}

/* ---------- Export/Import "Foto Saja" (terpisah dari backup JSON lengkap) ----------
   Dipakai saat kerjaan foto dibagi ke banyak orang: tiap orang filter ke titik/batch/site bagiannya
   sendiri, export, lalu hasilnya digabung (import) satu-satu ke satu perangkat kompilasi — TANPA
   perlu kirim-terima file JSON lengkap (yang bisa menimpa data LAIN yang sedang dikerjakan orang lain
   di perangkat kompilasi itu, mis. tracking/batch). Import di sini SELALU menggabungkan (union by
   photo id), tidak pernah menghapus/menimpa foto yang sudah ada — foto yang id-nya sudah ada dilewati
   begitu saja (bukan duplikat, bukan hilang), supaya aman diimport berkali-kali dari orang manapun
   tanpa perlu koordinasi urutan siapa duluan.
   Format file SENGAJA mandiri (self-contained, byte foto ikut disertakan sbg dataUrl di "photos"
   terpisah dari metadata di "points") — sama seperti alasan file backup JSON lengkap menyertakan
   dataUrl (lihat exportAll, 12-data-page.js): supaya file ini bisa dibuka lagi di perangkat manapun
   tanpa bergantung IndexedDB perangkat asal. */
const DOKFOTO_EXPORT_TYPE = "phm-dokfoto-export-v1";
async function exportDokFotoOnly(){
  const pts = getFilteredDokFotoPoints();
  if(!pts.length){ toast("Tidak ada titik yang cocok dengan filter Tim/Batch/Site/Status saat ini untuk diekspor.","err"); return; }
  const allIds = [];
  const pointsOut = {};
  pts.forEach(p=>{
    const d = ensureDokFoto(p.id);
    const categories = {};
    let hasAny = false;
    DOKFOTO_CATEGORIES.forEach(cat=>{
      const arr = d[cat.key]||[];
      if(arr.length){
        categories[cat.key] = arr.map(ph=>({...ph}));
        hasAny = true;
        arr.forEach(ph=>allIds.push(ph.id));
      }
    });
    if(!hasAny && !d.final) return; // titik tanpa foto & belum ditandai apapun — tidak perlu ikut file
    pointsOut[p.id] = { nama: p.nama, site: p.site, categories, final: !!d.final, finalAt: d.finalAt||null };
  });
  if(!Object.keys(pointsOut).length){ toast("Tidak ada foto pada titik yang sesuai filter saat ini untuk diekspor.","err"); return; }
  const idbMap = await dokFotoIdbGetMany(allIds);
  const photos = {};
  allIds.forEach(id=>{ const url = dokFotoUrlCache.get(id) || idbMap.get(id); if(url) photos[id] = url; });
  const payload = { type: DOKFOTO_EXPORT_TYPE, exportedAt: new Date().toISOString(), points: pointsOut, photos };
  const teamVal = document.getElementById("dokTeam").value;
  const filterDesc = [teamVal ? (teamVal==="emisi"?"Emisi":"Ambient") : "", document.getElementById("dokSite").value].filter(Boolean).join("_") || "SemuaTitik";
  downloadBlob(JSON.stringify(payload), `Foto Dokumentasi_${filterDesc}_${todayStr()}.json`, "application/json");
  toast(`Export foto berhasil: ${Object.keys(pointsOut).length} titik, ${allIds.length} foto.`, "ok");
}
let pendingDokFotoImport = null;
function handleDokFotoImportFile(data, sourceLabel){
  if(!data || typeof data!=="object" || data.type!==DOKFOTO_EXPORT_TYPE || !data.points || !data.photos){
    toast('File ini bukan file "Export Foto Saja" yang valid dari tools ini — import dibatalkan.', "err");
    return;
  }
  const preview = [];
  let totalNewPhotos = 0, totalDupPhotos = 0, totalUnknownPoints = 0, totalFinalChanges = 0;
  Object.keys(data.points).forEach(pointId=>{
    const src = data.points[pointId];
    const p = DB.points.find(x=>x.id===pointId);
    if(!p){ totalUnknownPoints++; return; }
    const localD = ensureDokFoto(pointId);
    const catLines = [];
    Object.keys(src.categories||{}).forEach(cat=>{
      const meta = dokFotoCatMeta(cat);
      if(!meta) return; // kategori tidak dikenal (versi lain) — dilewati aman
      const localIds = new Set((localD[cat]||[]).map(ph=>ph.id));
      const incoming = src.categories[cat]||[];
      const newOnes = incoming.filter(ph=>!localIds.has(ph.id) && data.photos[ph.id]);
      const dupCount = incoming.length - newOnes.length;
      totalNewPhotos += newOnes.length;
      totalDupPhotos += dupCount;
      if(newOnes.length || dupCount) catLines.push(`${meta.label}: +${newOnes.length}${dupCount?` (${dupCount} sudah ada)`:""}`);
    });
    const willFinal = !!src.final && !localD.final;
    if(willFinal) totalFinalChanges++;
    if(catLines.length || willFinal) preview.push({ pointId, nama: p.nama, site: p.site, lines: catLines, willFinal });
  });
  pendingDokFotoImport = data;
  const unknownNote = totalUnknownPoints ? `<p class="hint" style="color:#a02a24;">${totalUnknownPoints} titik di file ini tidak ditemukan di database titik pantau perangkat ini (dilewati, tidak diimport).</p>` : "";
  const rowsHtml = preview.length ? `<div class="tablewrap" style="max-height:280px;"><table style="width:100%;border-collapse:collapse;font-size:12px;">
    <thead><tr style="border-bottom:1.5px solid var(--gray-300);"><th style="text-align:left;padding:4px 6px;">Titik</th><th style="text-align:left;padding:4px 6px;">Perubahan</th></tr></thead>
    <tbody>${preview.map(r=>`<tr style="border-bottom:1px solid var(--gray-200);"><td style="padding:4px 6px;">${escHtml(r.nama)} <span class="muted">(${escHtml(r.site)})</span></td><td style="padding:4px 6px;">${r.lines.map(escHtml).join(", ")}${r.willFinal?`${r.lines.length?", ":""}<span style="color:#0d8a4f;font-weight:700;">akan ditandai Final</span>`:""}</td></tr>`).join("")}</tbody>
  </table></div>` : `<p class="hint">Tidak ada foto baru untuk diimport dari file ini (semua foto di file ini sudah ada di perangkat ini).</p>`;
  openModal(`
    <h3>Import Foto Saja</h3>
    <p class="hint">Dari "${escHtml(sourceLabel)}" &mdash; ${Object.keys(data.points).length} titik, ${Object.keys(data.photos).length} foto di file ini. Ini <b>MENGGABUNGKAN</b> foto baru ke data yang sudah ada (bukan menimpa) — foto yang sudah ada di perangkat ini tidak dihapus/diduplikasi, dan data lain (titik/tracking/hasil pemantauan dst) sama sekali tidak terpengaruh.</p>
    ${unknownNote}
    <p style="font-weight:700;">Ringkasan: <span style="color:#0d8a4f;">+${totalNewPhotos} foto baru</span>${totalDupPhotos?`, ${totalDupPhotos} sudah ada (dilewati)`:""}${totalFinalChanges?`, ${totalFinalChanges} titik akan ditandai Final`:""}.</p>
    ${rowsHtml}
    <div class="actions">
      <button class="btn ghost" data-action="closeModal">Batal</button>
      <button class="btn primary" data-action="applyDokFotoImport" ${(totalNewPhotos||totalFinalChanges)?"":"disabled"}>Gabungkan Foto Ini</button>
    </div>
  `, {wide:true});
}
async function applyDokFotoImport(){
  const data = pendingDokFotoImport; if(!data) return;
  const toPut = [];
  let addedPhotos = 0, finalizedPoints = 0;
  Object.keys(data.points).forEach(pointId=>{
    const p = DB.points.find(x=>x.id===pointId);
    if(!p) return;
    const src = data.points[pointId];
    const localD = ensureDokFoto(pointId);
    Object.keys(src.categories||{}).forEach(cat=>{
      if(!dokFotoCatMeta(cat)) return;
      const localIds = new Set((localD[cat]||[]).map(ph=>ph.id));
      (src.categories[cat]||[]).forEach(ph=>{
        if(localIds.has(ph.id)) return;
        const dataUrl = data.photos[ph.id];
        if(!dataUrl) return; // metadata tanpa byte foto (file rusak/tak lengkap) — dilewati aman
        localD[cat].push({...ph});
        toPut.push({id: ph.id, dataUrl});
        addedPhotos++;
      });
    });
    if(src.final && !localD.final){
      localD.final = true;
      localD.finalAt = src.finalAt || new Date().toISOString();
      finalizedPoints++;
    }
  });
  if(toPut.length){
    try{ await dokFotoIdbBulkPut(toPut); toPut.forEach(e=>dokFotoUrlCache.set(e.id, e.dataUrl)); }
    catch(err){ toast("Sebagian foto gagal ditulis ke penyimpanan (IndexedDB) — coba lagi.", "err"); }
  }
  save();
  closeModal();
  pendingDokFotoImport = null;
  renderDokumentasiFoto();
  toast(`Import foto selesai: ${addedPhotos} foto baru ditambahkan${finalizedPoints?`, ${finalizedPoints} titik ditandai Final`:""}.`, "ok");
}
document.getElementById("importDokFotoFile").addEventListener("change", e=>{
  const file = e.target.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = ()=>{
    try{ handleDokFotoImportFile(JSON.parse(reader.result), file.name); }
    catch(err){ toast("File tidak valid: "+err.message, "err"); }
    e.target.value = "";
  };
  reader.readAsText(file);
});

// Sub-kelompok per jenis sumber emisi/ambient (mis. "Turbine Engine Generator" terpisah dari
// "Flare") supaya daftar titik yang panjang lebih gampang dipindai — dgn urutan prioritas yang
// SAMA dgn Berita Acara (baKategoriSortRank/BA_KATEGORI_PRIORITY, 11-berita-acara.js) supaya
// konsisten kategori mana yang ditaruh paling atas di kedua halaman ini.
function groupDokFotoPointsByKategori(pts){
  const grouped = {};
  pts.forEach(p=>{ const k = dokFotoKategoriLabel(p); (grouped[k]=grouped[k]||[]).push(p); });
  const labels = Object.keys(grouped).sort((a,b)=>{
    const ra = baKategoriSortRank(a, grouped[a]), rb = baKategoriSortRank(b, grouped[b]);
    if(ra[0]!==rb[0]) return ra[0]-rb[0];
    if(ra[1]!==rb[1]) return ra[1]-rb[1];
    return a.localeCompare(b);
  });
  return labels.map(label=>({ label, points: grouped[label] }));
}
// Grid natural (bukan cover/crop) SELAMA foto belum diatur crop-nya sendiri oleh user: foto tampil
// APA ADANYA (width penuh kolom, height mengikuti rasio asli). Kalau photo.crop diisi lewat "Atur
// Crop / Ukuran" (non-destruktif, byte asli tidak pernah disentuh), area crop itulah yang ditampilkan
// di sini juga — supaya grid, lightbox, & hasil cetak PDF konsisten (dokFotoBoxHtml, 1 sumber render).
function dokFotoThumbHtml(pointId, cat){
  const meta = dokFotoCatMeta(cat.key);
  const photos = ensureDokFoto(pointId)[cat.key];
  const thumbs = photos.map(ph=>{
    const box = dokFotoBoxHtml(ph, dokFotoUrlFor(ph.id), {
      imgAttrs:`data-action="openDokFotoLightbox" data-point="${pointId}" data-cat="${cat.key}" data-id="${ph.id}" alt="${escHtml(meta.label)}"`,
      plainImgStyle:"width:100%;height:auto;display:block;cursor:zoom-in;",
      cropWrapStyle:"cursor:zoom-in;background:var(--gray-200);"
    });
    const cropBadge = dokFotoCropOf(ph) ? `<span class="dokfoto-thumb-badge" title="Sudah di-crop/resize (non-destruktif, foto asli tetap utuh &amp; bisa diubah lagi)">&#9986;</span>` : "";
    return `
    <div class="dokfoto-thumb">
      ${box}
      ${cropBadge}
      <button class="dokfoto-thumb-edit" data-action="openDokFotoCropEditor" data-point="${pointId}" data-cat="${cat.key}" data-id="${ph.id}" title="Atur crop/ukuran foto">&#9998;</button>
      <button class="dokfoto-thumb-del" data-action="deleteDokFoto" data-point="${pointId}" data-cat="${cat.key}" data-id="${ph.id}" title="Hapus">&times;</button>
    </div>`;
  }).join("");
  return `<div class="dokfoto-cat">
    <div class="dokfoto-cat-label">${escHtml(meta.label)} <span class="muted" style="font-weight:400;">(${photos.length} foto)</span></div>
    <div class="dokfoto-thumbgrid">
      ${thumbs}
      <button class="dokfoto-add-btn" data-action="triggerAddDokFoto" data-point="${pointId}" data-cat="${cat.key}">+ Tambah Foto</button>
    </div>
  </div>`;
}
// Status buka/tutup tiap kartu titik (<details>) — disimpan di memori terpisah dari DB (murni
// preferensi tampilan, sama seperti spExpanded di 08-gantt-print.js) supaya TIDAK ke-reset ke
// default tiap kali halaman ini di-render ulang (tambah/hapus foto memanggil renderDokumentasiFoto
// lagi, kalau statusnya tidak disimpan terpisah, kartu yang baru saja diciutkan user akan otomatis
// kebuka lagi begitu ada 1 foto ditambahkan di kartu manapun).
const dokFotoExpanded = {};
document.getElementById("dokFotoList").addEventListener("toggle", e=>{
  const d = e.target.closest(".dokfoto-point-card");
  if(d) dokFotoExpanded[d.dataset.pointId] = d.open;
}, true);
// Tombol Download/Cetak ikut duduk di dalam <summary> (biar satu baris sama judul+badge) — tanpa
// ini, klik tombolnya JUGA memicu perilaku bawaan <summary> (buka/tutup <details>) krn klik tetap
// dianggap klik pada summary itu sendiri. preventDefault() di sini menahan toggle bawaan itu SAJA
// (listener data-action global di 16-actions-init.js tetap jalan normal, cuma default action-nya
// yang ditahan — lihat MDN "click" event default action utk elemen <summary>).
document.getElementById("dokFotoList").addEventListener("click", e=>{
  if(e.target.closest(".dokfoto-point-actions")) e.preventDefault();
});
function dokFotoPointCardHtml(p){
  const t = ensureTracking(p.id);
  const statusLabel = t.samplingStatus ? (SAMPLING_STATUS_LABELS[t.samplingStatus]||t.samplingStatus) : "Belum diisi statusnya";
  const cap = dokFotoPointCaptionHtml(p.id);
  const isOpen = dokFotoExpanded[p.id]!==false; // default terbuka
  const isFinal = dokFotoIsFinal(p.id);
  const finalBtn = isFinal
    ? `<button class="btn small" style="background:var(--green-500,#1a9e5c);border-color:var(--green-500,#1a9e5c);color:#fff;" data-action="toggleDokFotoFinal" data-point="${p.id}" title="Klik utk batalkan tanda final">&#10003; Final</button>`
    : `<button class="btn small ghost" data-action="toggleDokFotoFinal" data-point="${p.id}" title="Tandai foto titik ini sudah lengkap/oke">Tandai Final</button>`;
  return `<details class="card dokfoto-point-card" data-point-id="${p.id}" ${isOpen?"open":""}>
    <summary class="dokfoto-point-summary">
      <div>
        <div class="dokfoto-point-title"><span class="dokfoto-point-chevron">&#9662;</span><b>${cap.title}</b></div>
        <div class="dokfoto-point-sub">${cap.sub}</div>
      </div>
      <div class="dokfoto-point-actions">
        ${finalBtn}
        <button class="btn small ghost" data-action="downloadDokFotoAll" data-point="${p.id}" title="Download semua foto titik ini">Download Foto</button>
        <button class="btn small" data-action="printSingleDokFotoLampiran" data-point="${p.id}" title="Cetak lampiran SIMPEL PPU titik ini">Cetak PDF</button>
        <span class="badge ${t.samplingStatus==="sampled"?"b-green":"b-teal"}">${escHtml(statusLabel)}</span>
      </div>
    </summary>
    <div class="dokfoto-point-body">
      ${DOKFOTO_CATEGORIES.map(cat=>dokFotoThumbHtml(p.id, cat)).join("")}
    </div>
  </details>`;
}
async function renderDokumentasiFoto(){
  refreshDokBatchSelect();
  refreshDokSiteSelect();
  renderDokFotoRecap();
  const el = document.getElementById("dokFotoList");
  const sizeEl = document.getElementById("dokFotoStorageSize");
  const pts = getFilteredDokFotoPoints();
  if(!pts.length){
    el.innerHTML = `<div class="card hint" style="text-align:center;padding:28px;">Tidak ada titik yang cocok dengan filter di atas. Dokumentasi foto hanya tersedia untuk titik yang sudah masuk sebuah batch (lihat Perencanaan Batch/Scheduling Tools).</div>`;
  } else {
    // Warm cache utk semua foto yg akan ditampilkan SEBELUM membangun HTML (dokFotoThumbHtml baca
    // dari cache secara sinkron) — satu batch fetch IndexedDB, bukan satu per foto.
    const allIds = [];
    pts.forEach(p=>{ const d=ensureDokFoto(p.id); DOKFOTO_CATEGORIES.forEach(cat=>d[cat.key].forEach(ph=>allIds.push(ph.id))); });
    await dokFotoWarmCache(allIds);
    const groups = groupDokFotoPointsByKategori(pts);
    el.innerHTML = groups.map(g=>`
      <div class="reg-divider">${escHtml(g.label)} <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:normal;">&mdash; ${g.points.length} titik</span></div>
      ${g.points.map(p=>dokFotoPointCardHtml(p)).join("")}
    `).join("");
  }
  if(sizeEl) sizeEl.textContent = fmtBytes(await dokFotoStorageBytes());
}
document.getElementById("dokTeam").addEventListener("change", ()=>{ refreshDokBatchSelect(); renderDokumentasiFoto(); });
document.getElementById("dokBatch").addEventListener("change", ()=>renderDokumentasiFoto());
document.getElementById("dokSite").addEventListener("change", ()=>renderDokumentasiFoto());
document.getElementById("dokStatus").addEventListener("change", ()=>renderDokumentasiFoto());

Object.assign(ACTIONS, {
  triggerAddDokFoto:(t)=>{
    const inp = document.getElementById("hiddenPhotoFile");
    inp.dataset.point = t.dataset.point;
    inp.dataset.cat = t.dataset.cat;
    inp.value = "";
    inp.click();
  },
  openDokFotoLightbox:(t)=>openDokFotoLightbox(t.dataset.point, t.dataset.cat, t.dataset.id),
  openDokFotoCropEditor:(t)=>openDokFotoCropEditor(t.dataset.point, t.dataset.cat, t.dataset.id),
  dokFotoCropReset:()=>{
    if(!dokFotoCropDraft) return;
    dokFotoCropDraft.crop = {top:0, right:0, bottom:0, left:0};
    dokFotoCropDraft.printSizePct = 100;
    renderDokFotoCropEditor();
  },
  dokFotoCropSave:()=>{
    const d = dokFotoCropDraft;
    if(!d) return;
    const photo = (ensureDokFoto(d.pointId)[d.cat]||[]).find(p=>p.id===d.photoId);
    if(!photo){ dokFotoCropDraft=null; closeModal(); return; }
    const hasCrop = d.crop.top||d.crop.right||d.crop.bottom||d.crop.left;
    photo.crop = hasCrop ? {...d.crop} : null;
    photo.printSizePct = (d.printSizePct && d.printSizePct!==100) ? d.printSizePct : null;
    if(d.w) photo.w = d.w;
    if(d.h) photo.h = d.h;
    save();
    dokFotoCropDraft = null;
    closeModal();
    renderDokumentasiFoto();
    toast("Pengaturan crop/ukuran foto disimpan (foto asli tetap utuh, bisa diubah lagi kapan saja).", "ok");
  },
  deleteDokFoto:(t)=>deleteDokFoto(t.dataset.point, t.dataset.cat, t.dataset.id),
  downloadSingleDokFoto:(t)=>downloadSingleDokFoto(t.dataset.point, t.dataset.cat, t.dataset.id),
  downloadDokFotoAll:(t)=>downloadDokFotoAll(t.dataset.point),
  toggleDokFotoFinal:(t)=>toggleDokFotoFinal(t.dataset.point),
  dokFotoFilterStatus:(t)=>{
    document.getElementById("dokStatus").value = t.dataset.status;
    renderDokumentasiFoto();
  },
  exportDokFotoOnly,
  triggerImportDokFotoOnly:()=>document.getElementById("importDokFotoFile").click(),
  applyDokFotoImport,
  dokFotoSampledRecapModal:()=>renderDokFotoSampledRecapModal(true),
  dokFotoRecapToggleScope:(t)=>renderDokFotoSampledRecapModal(t.dataset.onlySampled==="1"),
  printSingleDokFotoLampiran:(t)=>printSingleDokFotoLampiran(t.dataset.point),
  printAllVisibleDokFotoLampiran,
  expandAllDokFoto:()=>{
    document.querySelectorAll("#dokFotoList .dokfoto-point-card").forEach(d=>{ d.open=true; dokFotoExpanded[d.dataset.pointId]=true; });
  },
  collapseAllDokFoto:()=>{
    document.querySelectorAll("#dokFotoList .dokfoto-point-card").forEach(d=>{ d.open=false; dokFotoExpanded[d.dataset.pointId]=false; });
  }
});

// Migrasi sekali: foto yang tersimpan SEBELUM foto dipindah ke IndexedDB (dataUrl masih nyempil
// langsung di metadata DB.dokumentasiFoto, dari versi lama tools ini) dipindahkan ke IndexedDB,
// dataUrl-nya dihapus dari metadata localStorage — supaya browser lama yang localStorage-nya sudah
// penuh berisi foto ikut lega begitu file ini dimuat, bukan cuma foto BARU yang diuntungkan.
// Dipanggil TANPA ditunggu (fire-and-forget) di akhir file ini — pada titik ini load() di
// 16-actions-init.js (file bernomor lebih kecil, sudah lebih dulu dieksekusi krn urutan <script>)
// sudah pasti selesai jadi DB terjamin sudah terisi, DAN halaman pertama (dashboard) sudah SEMPAT
// dirender — migrasi jalan di LATAR BELAKANG, tidak menunda apapun di layar. dokFotoUrlCache
// langsung diisi dari dataUrl yang MASIH ada di memori sebelum dihapus, jadi kalaupun user buka
// halaman Dokumentasi Foto persis di tengah proses migrasi, foto tetap langsung tampil normal
// (tidak nunggu tulis-baca ulang ke IndexedDB dulu).
async function dokFotoMigrateLegacyPhotos(){
  if(DB.meta && DB.meta.dokFotoMigratedToIdb) return;
  const legacy = [];
  Object.keys(DB.dokumentasiFoto||{}).forEach(pointId=>{
    const cats = DB.dokumentasiFoto[pointId];
    Object.keys(cats).forEach(cat=>{
      (cats[cat]||[]).forEach(ph=>{
        if(ph.dataUrl){ legacy.push(ph); dokFotoUrlCache.set(ph.id, ph.dataUrl); }
      });
    });
  });
  if(!legacy.length){
    if(!DB.meta) DB.meta = {};
    DB.meta.dokFotoMigratedToIdb = true;
    save();
    return;
  }
  try{
    await dokFotoIdbBulkPut(legacy.map(ph=>({id:ph.id, dataUrl:ph.dataUrl})));
    legacy.forEach(ph=>{ delete ph.dataUrl; });
    if(!DB.meta) DB.meta = {};
    DB.meta.dokFotoMigratedToIdb = true;
    save();
    logChange(`Migrasi ${legacy.length} foto dokumentasi dari localStorage ke IndexedDB (kapasitas penyimpanan jauh lebih besar) selesai otomatis.`);
    // Kalau user sedang membuka halaman Dokumentasi Foto persis saat migrasi ini kelar, render
    // ulang supaya #dokFotoStorageSize (kini dihitung dari IndexedDB) langsung ikut kekinian.
    if(document.getElementById("page-dokumentasi")?.classList.contains("active")) renderDokumentasiFoto();
  }catch(err){
    // Belum ditandai selesai kalau gagal — akan dicoba lagi otomatis di load berikutnya. dataUrl
    // TETAP ada di metadata (tidak sempat dihapus) jadi tidak ada foto yang hilang krn ini.
    console.error("Migrasi foto ke IndexedDB gagal, akan dicoba lagi di load berikutnya:", err);
  }
}
dokFotoMigrateLegacyPhotos();
