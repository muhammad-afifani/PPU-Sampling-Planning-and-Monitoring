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
   TIDAK ada fitur crop/potong sama sekali (dicabut lagi sesuai masukan user) — foto SELALU ditampilkan
   utuh apa adanya (bukan di-cover/dipotong), baik di grid halaman ini, lightbox, maupun hasil cetak.
========================================================= */
const DOKFOTO_CATEGORIES = [
  {key:"personil", label:"Petugas Laboratorium / PPC", noTeknis:1, ketentuan:"Petugas Laboratorium", format:"jpeg"},
  {key:"alat", label:"Peralatan Sampling", noTeknis:2, ketentuan:"Peralatan Sampling", format:"jpeg"},
  {key:"aktivitas", label:"Aktivitas Sampling", noTeknis:3, ketentuan:"Aktivitas Sampling", format:"jpeg"},
  {key:"baSigned", label:"Bukti BA Sudah Ditandatangani", noTeknis:4, ketentuan:"BA Sampling", format:"png"}
];
function dokFotoCatMeta(key){ return DOKFOTO_CATEGORIES.find(c=>c.key===key); }
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
// Estimasi ukuran penyimpanan foto SAJA (bukan seluruh DB) supaya user bisa pantau sendiri
// pertumbuhannya dari halaman ini — lihat catatan kuota di ensureDokFoto di atas.
function dokFotoStorageBytes(){
  return new Blob([JSON.stringify(DB.dokumentasiFoto||{})]).size;
}
function fmtBytes(n){
  if(n < 1024) return n+" B";
  if(n < 1024*1024) return (n/1024).toFixed(0)+" KB";
  return (n/1024/1024).toFixed(1)+" MB";
}
function sanitizeFotoFilename(s){ return String(s||"").replace(/[\\/:*?"<>|]/g,"_"); }

/* ---------- Resize + kompres gambar sebelum disimpan ---------- */
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
        resolve(format==="png" ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", quality||0.75));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
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
  for(const file of files){
    try{
      const dataUrl = await readAndResizeImage(file, 1000, meta.format, 0.75);
      ensureDokFoto(pointId)[cat].push({id: uid("FOTO"), dataUrl, addedAt: new Date().toISOString()});
      okCount++;
    }catch(err){ errors.push(err.message); }
  }
  e.target.value = "";
  if(okCount){
    try{
      save();
      toast(`${okCount} foto ditambahkan ke "${meta.label}"${errors.length?`. ${errors.length} file dilewati (bukan gambar valid).`:"."}`, "ok");
    }catch(err){
      // Rollback penambahan di memori kalau gagal disimpan (kuota localStorage penuh dsb) — supaya
      // tampilan tidak menampilkan foto yang sebenarnya TIDAK tersimpan (hilang tanpa peringatan
      // begitu halaman di-reload). Pesan detail penyebabnya sudah ditoast oleh save() sendiri.
      const arr = ensureDokFoto(pointId)[cat];
      arr.splice(arr.length-okCount, okCount);
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
function downloadSingleDokFoto(pointId, cat, photoId){
  const p = DB.points.find(x=>x.id===pointId);
  const meta = dokFotoCatMeta(cat);
  const photo = (ensureDokFoto(pointId)[cat]||[]).find(ph=>ph.id===photoId);
  if(!photo || !p || !meta) return;
  const ext = meta.format==="png" ? "png" : "jpg";
  downloadDataUrl(photo.dataUrl, `${sanitizeFotoFilename(p.nama)}_${meta.key||cat}.${ext}`);
}
// Diunduh satu-satu dengan jeda kecil (bukan sekaligus) — beberapa browser menahan/minta izin
// tambahan kalau banyak file di-download bersamaan dalam satu tick tanpa jeda sama sekali.
async function downloadDokFotoAll(pointId){
  const p = DB.points.find(x=>x.id===pointId);
  if(!p) return;
  const d = ensureDokFoto(pointId);
  const files = [];
  DOKFOTO_CATEGORIES.forEach(cat=>{
    d[cat.key].forEach((ph,i)=>{
      const ext = cat.format==="png" ? "png" : "jpg";
      files.push({dataUrl: ph.dataUrl, filename: `${sanitizeFotoFilename(p.nama)}_${cat.key}${d[cat.key].length>1?"_"+(i+1):""}.${ext}`});
    });
  });
  if(!files.length){ toast("Titik ini belum punya foto.","err"); return; }
  for(const f of files){
    downloadDataUrl(f.dataUrl, f.filename);
    await new Promise(res=>setTimeout(res, 220));
  }
  toast(`${files.length} foto diunduh.`, "ok");
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

/* ---------- Lightbox (lihat foto utuh — TIDAK pernah dipotong/cover, object-fit:contain) ---------- */
function openDokFotoLightbox(pointId, cat, photoId){
  const photo = (ensureDokFoto(pointId)[cat]||[]).find(p=>p.id===photoId);
  if(!photo) return;
  const cap = dokFotoPointCaptionHtml(pointId);
  openModal(`
    <h3>${cap.title} <span class="muted" style="font-weight:400;font-size:13px;">&mdash; ${escHtml(dokFotoCatMeta(cat).label)}</span></h3>
    <div class="hint" style="margin-top:-6px;">${cap.sub}</div>
    <div style="text-align:center;background:var(--gray-100);border-radius:8px;padding:10px;margin-top:10px;">
      <img src="${photo.dataUrl}" style="max-width:100%;max-height:75vh;border-radius:4px;">
    </div>
    <div class="actions">
      <button class="btn danger" data-action="deleteDokFoto" data-point="${pointId}" data-cat="${cat}" data-id="${photoId}">Hapus Foto</button>
      <button class="btn ghost" data-action="downloadSingleDokFoto" data-point="${pointId}" data-cat="${cat}" data-id="${photoId}">Download Foto Ini</button>
      <span class="spacer"></span>
      <button class="btn ghost" data-action="closeModal">Tutup</button>
    </div>
  `, {wide:true});
}

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
  return photos.map(ph=>`<img src="${ph.dataUrl}" style="max-width:100%;height:auto;display:block;margin-bottom:8px;border:1px solid #999;">`).join("");
}
function buildDokFotoLampiranHtml(pointIds){
  const cfg = ensureBaConfig();
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
  const html = buildDokFotoLampiranHtml(pointIds);
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
function getFilteredDokFotoPoints(){
  const team = document.getElementById("dokTeam").value;
  const batchId = document.getElementById("dokBatch").value;
  const site = document.getElementById("dokSite").value;
  let pts = DB.points.filter(p=>p.batchId);
  if(team) pts = pts.filter(p=> team==="emisi" ? p.kategori==="emisi" : p.kategori!=="emisi");
  if(batchId) pts = pts.filter(p=>p.batchId===batchId);
  if(site) pts = pts.filter(p=>p.site===site);
  return pts.sort((a,b)=> a.site.localeCompare(b.site) || a.nama.localeCompare(b.nama));
}
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
// Grid natural (bukan cover/crop): tiap foto ditampilkan APA ADANYA (width penuh kolom, height
// otomatis mengikuti rasio asli) — foto potrait jadi tinggi, foto lanskap jadi pendek, tidak ada
// yang terpotong sama sekali, sesuai permintaan "jangan ada fitur crop, foto harus utuh".
function dokFotoThumbHtml(pointId, cat){
  const meta = dokFotoCatMeta(cat.key);
  const photos = ensureDokFoto(pointId)[cat.key];
  const thumbs = photos.map(ph=>`
    <div class="dokfoto-thumb">
      <img src="${ph.dataUrl}" data-action="openDokFotoLightbox" data-point="${pointId}" data-cat="${cat.key}" data-id="${ph.id}" alt="${escHtml(meta.label)}">
      <button class="dokfoto-thumb-del" data-action="deleteDokFoto" data-point="${pointId}" data-cat="${cat.key}" data-id="${ph.id}" title="Hapus">&times;</button>
    </div>`).join("");
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
  return `<details class="card dokfoto-point-card" data-point-id="${p.id}" ${isOpen?"open":""}>
    <summary class="dokfoto-point-summary">
      <div>
        <div class="dokfoto-point-title"><span class="dokfoto-point-chevron">&#9662;</span><b>${cap.title}</b></div>
        <div class="dokfoto-point-sub">${cap.sub}</div>
      </div>
      <div class="dokfoto-point-actions">
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
function renderDokumentasiFoto(){
  refreshDokBatchSelect();
  refreshDokSiteSelect();
  const el = document.getElementById("dokFotoList");
  const sizeEl = document.getElementById("dokFotoStorageSize");
  if(sizeEl) sizeEl.textContent = fmtBytes(dokFotoStorageBytes());
  const pts = getFilteredDokFotoPoints();
  if(!pts.length){
    el.innerHTML = `<div class="card hint" style="text-align:center;padding:28px;">Tidak ada titik yang cocok dengan filter di atas. Dokumentasi foto hanya tersedia untuk titik yang sudah masuk sebuah batch (lihat Perencanaan Batch/Scheduling Tools).</div>`;
    return;
  }
  const groups = groupDokFotoPointsByKategori(pts);
  el.innerHTML = groups.map(g=>`
    <div class="reg-divider">${escHtml(g.label)} <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:normal;">&mdash; ${g.points.length} titik</span></div>
    ${g.points.map(p=>dokFotoPointCardHtml(p)).join("")}
  `).join("");
}
document.getElementById("dokTeam").addEventListener("change", ()=>{ refreshDokBatchSelect(); renderDokumentasiFoto(); });
document.getElementById("dokBatch").addEventListener("change", ()=>renderDokumentasiFoto());
document.getElementById("dokSite").addEventListener("change", ()=>renderDokumentasiFoto());

Object.assign(ACTIONS, {
  triggerAddDokFoto:(t)=>{
    const inp = document.getElementById("hiddenPhotoFile");
    inp.dataset.point = t.dataset.point;
    inp.dataset.cat = t.dataset.cat;
    inp.value = "";
    inp.click();
  },
  openDokFotoLightbox:(t)=>openDokFotoLightbox(t.dataset.point, t.dataset.cat, t.dataset.id),
  deleteDokFoto:(t)=>deleteDokFoto(t.dataset.point, t.dataset.cat, t.dataset.id),
  downloadSingleDokFoto:(t)=>downloadSingleDokFoto(t.dataset.point, t.dataset.cat, t.dataset.id),
  downloadDokFotoAll:(t)=>downloadDokFotoAll(t.dataset.point),
  printSingleDokFotoLampiran:(t)=>printSingleDokFotoLampiran(t.dataset.point),
  printAllVisibleDokFotoLampiran,
  expandAllDokFoto:()=>{
    document.querySelectorAll("#dokFotoList .dokfoto-point-card").forEach(d=>{ d.open=true; dokFotoExpanded[d.dataset.pointId]=true; });
  },
  collapseAllDokFoto:()=>{
    document.querySelectorAll("#dokFotoList .dokfoto-point-card").forEach(d=>{ d.open=false; dokFotoExpanded[d.dataset.pointId]=false; });
  }
});
