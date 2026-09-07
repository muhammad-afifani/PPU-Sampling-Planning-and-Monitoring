/* =========================================================
   DOKUMENTASI FOTO SAMPLING
   ---------------------------------------------------------
   Lampiran foto per titik (format "Data Pendukung/Lampiran SIMPEL PPU"): Petugas Laboratorium/PPC,
   Peralatan Sampling, Aktivitas Sampling (masing-masing boleh lebih dari 1 foto), dan 1 bukti
   screenshot BA yang sudah ditandatangani. Disimpan di DB.dokumentasiFoto[pointId] supaya ikut
   ke-export/import lewat backup JSON biasa (lihat exportAll/applyFullBackupImport di 12-data-page.js
   — keduanya generic JSON.stringify/assign seluruh DB, jadi field baru di sini otomatis ikut tanpa
   perlu sentuh kode export/import itu sendiri).
   Foto TIDAK disimpan mentah dari kamera/galeri — selalu diresize+dikompres dulu (readAndResizeImage)
   supaya localStorage (kuota per-origin biasanya cuma beberapa MB) tidak cepat penuh kalau titiknya
   banyak. Kategori "baSigned" (screenshot dokumen) pakai PNG (lossless, teks tanda tangan tetap
   tajam), 3 kategori foto lapangan lainnya pakai JPEG (jauh lebih kecil utk foto asli/gradasi warna).
========================================================= */
const DOKFOTO_CATEGORIES = [
  {key:"personil", label:"Petugas Laboratorium / PPC", ratio: 4/3, format:"jpeg"},
  {key:"alat", label:"Peralatan Sampling", ratio: 4/3, format:"jpeg"},
  {key:"aktivitas", label:"Aktivitas Sampling", ratio: 4/3, format:"jpeg"},
  {key:"baSigned", label:"Bukti BA Sudah Ditandatangani", ratio: 3/4, format:"png"}
];
function dokFotoCatMeta(key){ return DOKFOTO_CATEGORIES.find(c=>c.key===key); }
function ensureDokFoto(pointId){
  if(!DB.dokumentasiFoto) DB.dokumentasiFoto = {};
  if(!DB.dokumentasiFoto[pointId]) DB.dokumentasiFoto[pointId] = {};
  const d = DB.dokumentasiFoto[pointId];
  DOKFOTO_CATEGORIES.forEach(c=>{ if(!Array.isArray(d[c.key])) d[c.key] = []; });
  return d;
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

/* ---------- Lightbox (lihat penuh) ---------- */
function openDokFotoLightbox(pointId, cat, photoId){
  const photo = (ensureDokFoto(pointId)[cat]||[]).find(p=>p.id===photoId);
  if(!photo) return;
  openModal(`
    <h3>${escHtml(dokFotoCatMeta(cat).label)}</h3>
    <div style="text-align:center;background:var(--gray-100);border-radius:8px;padding:10px;">
      <img src="${photo.dataUrl}" style="max-width:100%;max-height:65vh;border-radius:4px;">
    </div>
    <div class="actions">
      <button class="btn danger" data-action="deleteDokFoto" data-point="${pointId}" data-cat="${cat}" data-id="${photoId}">Hapus Foto</button>
      <button class="btn" data-action="openDokFotoCrop" data-point="${pointId}" data-cat="${cat}" data-id="${photoId}">Atur Crop / Zoom</button>
      <span class="spacer"></span>
      <button class="btn ghost" data-action="closeModal">Tutup</button>
    </div>
  `, {wide:true});
}

/* ---------- Editor crop/zoom ----------
   Pendekatan: crop rect dihitung & digambar LANGSUNG di ruang piksel gambar asli (canvas
   drawImage(img, sx,sy,sw,sh, 0,0,outW,outH)) — bukan CSS object-position — supaya matematika
   pan/zoom presisi & gampang diverifikasi (tidak bergantung pembulatan sub-piksel CSS).
   dokFotoCropState hidup selama modal terbuka saja, direset tiap dibuka ulang. */
let dokFotoCropState = null;
function dokFotoCropBaseRect(nw, nh, ratio){
  if(nw/nh > ratio) return {w: nh*ratio, h: nh};
  return {w: nw, h: nw/ratio};
}
function dokFotoCropClamp(){
  const s = dokFotoCropState;
  s.cropW = s.baseW/s.zoom; s.cropH = s.baseH/s.zoom;
  s.cx = Math.min(Math.max(s.cx, s.cropW/2), s.nw - s.cropW/2);
  s.cy = Math.min(Math.max(s.cy, s.cropH/2), s.nh - s.cropH/2);
}
function dokFotoCropDraw(){
  const s = dokFotoCropState;
  const ctx = s.canvas.getContext("2d");
  ctx.clearRect(0, 0, s.canvas.width, s.canvas.height);
  ctx.drawImage(s.img, s.cx-s.cropW/2, s.cy-s.cropH/2, s.cropW, s.cropH, 0, 0, s.canvas.width, s.canvas.height);
}
function openDokFotoCrop(pointId, cat, photoId){
  const photo = (ensureDokFoto(pointId)[cat]||[]).find(p=>p.id===photoId);
  const meta = dokFotoCatMeta(cat);
  if(!photo || !meta) return;
  const ratio = meta.ratio;
  const canvasW = 380, canvasH = Math.round(canvasW/ratio);
  openModal(`
    <h3>Atur Crop / Zoom — ${escHtml(meta.label)}</h3>
    <div class="hint" style="margin-top:-6px;">Geser foto di area gelap untuk memindahkan posisi, geser slider untuk memperbesar bagian yang ditampilkan. Foto asli tidak berubah sampai "Simpan" ditekan.</div>
    <div class="dokfoto-crop-stage" id="dokFotoCropStage" style="max-width:${canvasW}px;aspect-ratio:${ratio};">
      <canvas id="dokFotoCropCanvas" width="${canvasW}" height="${canvasH}"></canvas>
    </div>
    <div class="field" style="margin-top:14px;">
      <label>Perbesar</label>
      <input type="range" id="dokFotoCropZoom" min="100" max="300" value="100" style="width:100%;">
    </div>
    <div class="actions">
      <button class="btn ghost" data-action="closeModal">Batal</button>
      <button class="btn" data-action="resetDokFotoCrop">Reset</button>
      <span class="spacer"></span>
      <button class="btn primary" data-action="saveDokFotoCrop">Simpan</button>
    </div>
  `, {wide:true});
  const stage = document.getElementById("dokFotoCropStage");
  const canvas = document.getElementById("dokFotoCropCanvas");
  const zoomSlider = document.getElementById("dokFotoCropZoom");
  const img = new Image();
  img.onload = ()=>{
    const base = dokFotoCropBaseRect(img.naturalWidth, img.naturalHeight, ratio);
    dokFotoCropState = {
      pointId, cat, photoId, meta, img, canvas,
      nw: img.naturalWidth, nh: img.naturalHeight,
      baseW: base.w, baseH: base.h, zoom: 1,
      cx: img.naturalWidth/2, cy: img.naturalHeight/2,
      cropW: base.w, cropH: base.h
    };
    dokFotoCropDraw();
  };
  img.src = photo.dataUrl;

  let dragging = false, lastX = 0, lastY = 0;
  stage.addEventListener("pointerdown", e=>{
    if(!dokFotoCropState) return;
    dragging = true; lastX = e.clientX; lastY = e.clientY;
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener("pointermove", e=>{
    if(!dragging || !dokFotoCropState) return;
    const s = dokFotoCropState;
    const rect = stage.getBoundingClientRect();
    const dxImg = (e.clientX-lastX) * (s.cropW/rect.width);
    const dyImg = (e.clientY-lastY) * (s.cropH/rect.height);
    s.cx -= dxImg; s.cy -= dyImg;
    lastX = e.clientX; lastY = e.clientY;
    dokFotoCropClamp();
    dokFotoCropDraw();
  });
  const stopDrag = ()=>{ dragging = false; };
  stage.addEventListener("pointerup", stopDrag);
  stage.addEventListener("pointercancel", stopDrag);
  zoomSlider.addEventListener("input", ()=>{
    if(!dokFotoCropState) return;
    dokFotoCropState.zoom = Number(zoomSlider.value)/100;
    dokFotoCropClamp();
    dokFotoCropDraw();
  });
}
function resetDokFotoCrop(){
  if(!dokFotoCropState) return;
  const s = dokFotoCropState;
  s.zoom = 1; s.cx = s.nw/2; s.cy = s.nh/2;
  dokFotoCropClamp();
  dokFotoCropDraw();
  const slider = document.getElementById("dokFotoCropZoom");
  if(slider) slider.value = 100;
}
function saveDokFotoCrop(){
  const s = dokFotoCropState;
  if(!s) return;
  const outLong = 700;
  const outW = s.meta.ratio >= 1 ? outLong : Math.round(outLong*s.meta.ratio);
  const outH = s.meta.ratio >= 1 ? Math.round(outLong/s.meta.ratio) : outLong;
  const out = document.createElement("canvas");
  out.width = outW; out.height = outH;
  out.getContext("2d").drawImage(s.img, s.cx-s.cropW/2, s.cy-s.cropH/2, s.cropW, s.cropH, 0, 0, outW, outH);
  const dataUrl = s.meta.format==="png" ? out.toDataURL("image/png") : out.toDataURL("image/jpeg", 0.78);
  const photo = (ensureDokFoto(s.pointId)[s.cat]||[]).find(p=>p.id===s.photoId);
  if(photo){
    photo.dataUrl = dataUrl;
    try{
      save();
      toast("Tampilan foto disimpan.", "ok");
    }catch(err){
      toast("Gagal menyimpan perubahan crop (penyimpanan browser penuh). Perubahan dibatalkan.", "err");
      return; // dataUrl lama sudah ditimpa di memori tapi belum ke-load ulang dari manapun; render
               // ulang dari DB saat ini (belum ter-save) tetap konsisten sampai user reload — cukup
               // aman krn kegagalan save() berarti localStorage TIDAK berubah, jadi reload berikutnya
               // otomatis balik ke versi lama yang sebelumnya sudah tersimpan.
    }
  }
  dokFotoCropState = null;
  closeModal();
  renderDokumentasiFoto();
}

/* ---------- Filter & render halaman ---------- */
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
function dokFotoThumbHtml(pointId, cat){
  const meta = dokFotoCatMeta(cat.key);
  const photos = ensureDokFoto(pointId)[cat.key];
  const thumbs = photos.map(ph=>`
    <div class="dokfoto-thumb" style="aspect-ratio:${meta.ratio};">
      <img src="${ph.dataUrl}" data-action="openDokFotoLightbox" data-point="${pointId}" data-cat="${cat.key}" data-id="${ph.id}" alt="${escHtml(meta.label)}">
      <button class="dokfoto-thumb-edit" data-action="openDokFotoCrop" data-point="${pointId}" data-cat="${cat.key}" data-id="${ph.id}" title="Atur crop/zoom">&#9998;</button>
      <button class="dokfoto-thumb-del" data-action="deleteDokFoto" data-point="${pointId}" data-cat="${cat.key}" data-id="${ph.id}" title="Hapus">&times;</button>
    </div>`).join("");
  return `<div class="dokfoto-cat">
    <div class="dokfoto-cat-label">${escHtml(meta.label)} <span class="muted">(${photos.length} foto)</span></div>
    <div class="dokfoto-thumbstrip">
      ${thumbs}
      <button class="dokfoto-add-btn" style="aspect-ratio:${meta.ratio};" data-action="triggerAddDokFoto" data-point="${pointId}" data-cat="${cat.key}">+ Tambah<br>Foto</button>
    </div>
  </div>`;
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
  el.innerHTML = pts.map(p=>{
    const t = ensureTracking(p.id);
    const statusLabel = t.samplingStatus ? (SAMPLING_STATUS_LABELS[t.samplingStatus]||t.samplingStatus) : "Belum diisi statusnya";
    const kategoriLabel = p.kategori==="emisi" ? (p.kategoriSumber||"-") : (NONEMISI_LABEL[p.kategori]||p.kategori);
    return `<div class="card dokfoto-point-card">
      <div class="dokfoto-point-head">
        <div><b>${escHtml(p.nama)}</b> <span class="muted">(${escHtml(p.site)} &middot; ${escHtml(kategoriLabel)})</span></div>
        <span class="badge ${t.samplingStatus==="sampled"?"b-green":"b-teal"}">${escHtml(statusLabel)}</span>
      </div>
      ${DOKFOTO_CATEGORIES.map(cat=>dokFotoThumbHtml(p.id, cat)).join("")}
    </div>`;
  }).join("");
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
  openDokFotoCrop:(t)=>openDokFotoCrop(t.dataset.point, t.dataset.cat, t.dataset.id),
  deleteDokFoto:(t)=>deleteDokFoto(t.dataset.point, t.dataset.cat, t.dataset.id),
  resetDokFotoCrop, saveDokFotoCrop
});
