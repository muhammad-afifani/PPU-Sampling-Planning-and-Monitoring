/* =========================================================
   TANDA TANGAN (TTD) PPC — dipakai otomatis di Berita Acara sbg TTD Ketua Tim Sampling
   ---------------------------------------------------------
   Alur: gambar TTD (JPG/PNG) diunggah per personil PPC di menu Personil → saat Berita Acara dibuat,
   TTD milik Ketua Tim batch (penunjukan "Ketua" di Perencanaan Batch) ditempel di kolom tanda
   tangan Pihak Laboratorium → BA (Word .docx / cetak-PDF) tinggal disirkulasikan ke Environment
   Supervisor tiap site utk ditandatangani. Halaman "Sertifikat Tanda Tangan Elektronik" (ID dokumen,
   hash SHA-256 isi BA & gambar TTD, waktu, QR) ikut di halaman terakhir.

   Keputusan penyimpanan (sengaja BUKAN di DB/localStorage):
   - Byte gambar di IndexedDB terpisah (pola sama dgn lampiran sertifikat PPU, 24-personil-ppu.js) —
     DB.personil tidak bertambah berat, dan TTD tidak ikut ke snapshot Undo / JSON backup biasa.
   - TTD itu data sensitif (bisa dipalsukan kalau bocor) sedangkan file backup JSON pernah ikut di-
     commit ke repo publik → TTD HANYA ikut backup kalau kotak "Sertakan TTD PPC" dicentang
     (default kosong), lihat exportAll/applyFullBackupImport di 12-data-page.js.
   - Sesi Visitor tidak pernah memuat/menempel/menyimpan TTD (ppcTtdAllowed()).
   - Cache memori (ppcTtdCache) dimuat sekali dari IndexedDB supaya pembuat BA (sinkron, dipanggil
     tiap ketukan di form BA) bisa membaca TTD tanpa async.

   PENTING — sertifikat di sini adalah catatan penandatanganan elektronik VISUAL/internal, BUKAN
   tanda tangan digital kriptografis bersertifikat (PSrE/PKI) — lihat teks di halaman sertifikat.
========================================================= */
const PPC_TTD_IDB_NAME = "phmPpcTtdDB";
const PPC_TTD_IDB_STORE = "ttd";
const PPC_TTD_MAX_W = 600, PPC_TTD_MAX_H = 240, PPC_TTD_MAX_BYTES = 8*1024*1024;
let ppcTtdIdbPromise = null;
const ppcTtdCache = new Map();          // personilId -> dataUrl (PNG)
let ppcTtdLoadPromise = null;
const ppcTtdHashMemo = new Map();       // personilId -> {url, hash}

/* ---------- IndexedDB ---------- */
function ppcTtdIdbOpen(){
  if(ppcTtdIdbPromise) return ppcTtdIdbPromise;
  ppcTtdIdbPromise = new Promise((resolve, reject)=>{
    if(!window.indexedDB){ reject(new Error("Browser ini tidak mendukung IndexedDB.")); return; }
    const req = indexedDB.open(PPC_TTD_IDB_NAME, 1);
    req.onupgradeneeded = ()=>{ if(!req.result.objectStoreNames.contains(PPC_TTD_IDB_STORE)) req.result.createObjectStore(PPC_TTD_IDB_STORE); };
    req.onsuccess = ()=>resolve(req.result);
    req.onerror = ()=>reject(req.error);
  });
  ppcTtdIdbPromise.catch(()=>{ ppcTtdIdbPromise = null; });
  return ppcTtdIdbPromise;
}
function ppcTtdIdbTx(mode, work){
  return ppcTtdIdbOpen().then(db=>new Promise((resolve, reject)=>{
    const tx = db.transaction(PPC_TTD_IDB_STORE, mode);
    let result;
    work(tx.objectStore(PPC_TTD_IDB_STORE), v=>{ result = v; });
    tx.oncomplete = ()=>resolve(result);
    tx.onerror = ()=>reject(tx.error);
    tx.onabort = ()=>reject(tx.error || new Error("Transaksi IndexedDB dibatalkan."));
  }));
}
const ppcTtdIdbPut = (id, dataUrl)=>ppcTtdIdbTx("readwrite", s=>{ s.put(dataUrl, id); });
const ppcTtdIdbDelete = id=>ppcTtdIdbTx("readwrite", s=>{ s.delete(id); });
const ppcTtdIdbAll = ()=>ppcTtdIdbTx("readonly", (s, out)=>{
  const rows = [];
  s.openCursor().onsuccess = e=>{ const c = e.target.result; if(c){ rows.push({id:c.key, dataUrl:c.value}); c.continue(); } else out(rows); };
});

/* ---------- Akses & cache ---------- */
// Sama dgn guard isRealPhmSession di save() (01-state.js): default AMAN (diblokir) selama gerbang
// akses belum resolve atau saat mode visitor.
function ppcTtdAllowed(){ return typeof gateState!=="undefined" && !!gateState && gateState.mode==="phm"; }
function ppcIsPPC(p){ return !!p && /^PPC/i.test(p.role||""); }
function ppcTtdAfterLoad(){
  try{
    const act = id=>{ const e = document.getElementById(id); return !!e && e.classList.contains("active"); };
    if(act("page-personil") && typeof renderPersonil==="function") renderPersonil();
    if(act("page-tracking") && document.getElementById("baPaper") && typeof renderBeritaAcara==="function") renderBeritaAcara();
  }catch(e){ /* render ulang hanyalah kosmetik — jangan sampai memutus pemuatan */ }
}
function ppcTtdEnsureLoaded(){
  if(!ppcTtdAllowed()) return Promise.resolve(false);
  if(!ppcTtdLoadPromise){
    ppcTtdLoadPromise = ppcTtdIdbAll()
      .then(rows=>{ rows.forEach(r=>{ if(r.dataUrl) ppcTtdCache.set(r.id, r.dataUrl); }); return true; })
      .catch(()=>false)
      .then(ok=>{ if(ok && ppcTtdCache.size) ppcTtdAfterLoad(); return ok; });
  }
  return ppcTtdLoadPromise;
}
// Data-URL TTD personil (string kosong = tidak ada / tidak boleh dipakai).
function ppcTtdUrl(p){
  if(!ppcIsPPC(p) || !ppcTtdAllowed()) return "";
  if(!ppcTtdLoadPromise) ppcTtdEnsureLoaded();
  return ppcTtdCache.get(p.id) || "";
}
function ppcTtdBadgeHtml(p){
  if(!ppcIsPPC(p)) return "";
  if(!ppcTtdAllowed()) return "";
  return ppcTtdUrl(p)
    ? `<span class="pz-ttd-chip has" title="Tanda tangan tersimpan — dipakai otomatis di Berita Acara bila ditunjuk jadi Ketua Tim">&#10003; TTD</span>`
    : `<span class="pz-ttd-chip" title="Belum ada tanda tangan (unggah lewat Edit Personil)">Belum ada TTD</span>`;
}
// Lepas TTD dari perangkat ini (personil dihapus) — data sensitif tidak dibiarkan menggantung.
function ppcTtdForget(id){
  ppcTtdCache.delete(id); ppcTtdHashMemo.delete(id);
  if(ppcTtdAllowed()) ppcTtdIdbDelete(id).catch(()=>{});
}

/* ---------- Pengolahan gambar ---------- */
function ppcTtdLoadImage(file){
  return new Promise((resolve, reject)=>{
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = ()=>{ URL.revokeObjectURL(url); resolve(img); };
    img.onerror = ()=>{ URL.revokeObjectURL(url); reject(new Error("File gambar tidak bisa dibaca.")); };
    img.src = url;
  });
}
// Skala ke maks 600x240 px (tanpa pembesaran), opsional jadikan latar putih transparan, lalu
// potong margin kosong di sekeliling goresan supaya ukurannya di BA konsisten & rapi.
function ppcTtdRender(img, removeBg){
  const sw = img.naturalWidth || img.width, sh = img.naturalHeight || img.height;
  if(!sw || !sh) throw new Error("Ukuran gambar tidak valid.");
  const k = Math.min(1, PPC_TTD_MAX_W/sw, PPC_TTD_MAX_H/sh);
  const w = Math.max(1, Math.round(sw*k)), h = Math.max(1, Math.round(sh*k));
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
  const ctx = cv.getContext("2d", {willReadFrequently:true});
  // Latar putih dulu supaya PNG transparan & JPG diperlakukan sama saat mendeteksi "tinta".
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const id = ctx.getImageData(0, 0, w, h), px = id.data, n = w*h;
  const lum = new Uint8Array(n), hist = new Uint32Array(256);
  for(let i=0;i<n;i++){ const l = Math.round(0.299*px[i*4] + 0.587*px[i*4+1] + 0.114*px[i*4+2]); lum[i] = l; hist[l]++; }
  // Putih-kertas diperkirakan dari persentil ke-85 kecerahan (foto TTD hampir selalu didominasi
  // kertas) — jadi foto yang agak redup/abu-abu tetap bersih, bukan hanya yang putih murni.
  let acc = 0, p85 = 255;
  for(let v=0; v<256; v++){ acc += hist[v]; if(acc >= n*0.85){ p85 = v; break; } }
  const white = Math.max(120, Math.min(250, p85 - 22)), black = Math.max(0, white - 70);
  let x0 = w, y0 = h, x1 = -1, y1 = -1, inkR = 0, inkG = 0, inkB = 0, inkN = 0;
  for(let y=0; y<h; y++) for(let x=0; x<w; x++){
    const i = y*w+x, l = lum[i];
    if(l < white){ if(x<x0) x0=x; if(x>x1) x1=x; if(y<y0) y0=y; if(y>y1) y1=y; }
    if(l <= black+12){ inkR += px[i*4]; inkG += px[i*4+1]; inkB += px[i*4+2]; inkN++; }
  }
  if(x1<0) throw new Error("Gambar tampak kosong (tidak ada goresan tanda tangan terdeteksi).");
  if(removeBg){
    // Alpha dari seberapa gelap piksel dibanding putih-kertas; warna semua piksel goresan disamakan
    // ke warna tinta rata-rata → tidak ada bayangan/halo abu-abu di sekitar goresan.
    const ink = inkN ? [Math.round(inkR/inkN), Math.round(inkG/inkN), Math.round(inkB/inkN)] : [20,20,20];
    for(let i=0;i<n;i++){
      const l = lum[i];
      const a = l>=white ? 0 : l<=black ? 255 : Math.round((white-l)/(white-black)*255);
      px[i*4] = ink[0]; px[i*4+1] = ink[1]; px[i*4+2] = ink[2]; px[i*4+3] = a;
    }
  }
  ctx.putImageData(id, 0, 0);
  const pad = Math.round(Math.max(w, h)*0.02) + 2;
  x0 = Math.max(0, x0-pad); y0 = Math.max(0, y0-pad); x1 = Math.min(w-1, x1+pad); y1 = Math.min(h-1, y1+pad);
  const cw = x1-x0+1, ch = y1-y0+1;
  const out = document.createElement("canvas"); out.width = cw; out.height = ch;
  out.getContext("2d").drawImage(cv, x0, y0, cw, ch, 0, 0, cw, ch);
  return out.toDataURL("image/png");
}

/* ---------- Form Personil (Tambah/Edit) ---------- */
let ppcTtdPending = null;   // {pid, dataUrl, removed, img}
function ppcTtdFormReset(p){ ppcTtdPending = {pid:(p&&p.id)||"", dataUrl:null, removed:false, img:null}; }
function ppcTtdFormHtml(p){
  if(!ppcTtdAllowed()){
    return `<div class="pz-ttd" id="p_ttdBox"><label class="pz-ttd-lbl">Tanda Tangan</label><div class="hint">Tanda tangan hanya bisa dikelola pada sesi Staf PHM.</div></div>`;
  }
  const cur = p ? ppcTtdUrl(p) : "";
  return `<div class="pz-ttd" id="p_ttdBox" ${ppcIsPPC(p||{role:"PPC Emisi"}) ? "" : "hidden"}>
    <label class="pz-ttd-lbl">Tanda Tangan (JPG / PNG) &mdash; khusus PPC</label>
    <div class="pz-ttd-row">
      <div class="pz-ttd-preview" id="p_ttdPreview">${ppcTtdPreviewInner(cur)}</div>
      <div class="pz-ttd-ctl">
        <input type="file" id="p_ttdFile" accept="image/png,image/jpeg">
        <label class="checkline"><input type="checkbox" id="p_ttdBg" checked> Jadikan latar putih transparan</label>
        <div><button type="button" class="btn small danger" data-action="ppcTtdClear" id="p_ttdClear" ${cur?"":"hidden"}>Hapus TTD</button></div>
      </div>
    </div>
    <div class="hint">Dipakai otomatis di kolom tanda tangan Berita Acara kalau personil ini ditunjuk sebagai <b>Ketua Tim</b> di Perencanaan Batch. Foto TTD di kertas putih paling bagus; latar &amp; margin dirapikan otomatis. Disimpan di perangkat ini saja (tidak ikut backup JSON kecuali dicentang saat export).</div>
  </div>`;
}
function ppcTtdPreviewInner(url){
  return url ? `<img src="${url}" alt="Pratinjau tanda tangan">` : `<span class="muted">Belum ada tanda tangan</span>`;
}
function ppcTtdPaintPreview(){
  const box = document.getElementById("p_ttdPreview"); if(!box || !ppcTtdPending) return;
  const pd = ppcTtdPending;
  const pers = pd.pid ? DB.personil.find(x=>x.id===pd.pid) : null;
  const url = pd.dataUrl || (pd.removed ? "" : (pers ? ppcTtdUrl(pers) : ""));
  box.innerHTML = ppcTtdPreviewInner(url);
  const clr = document.getElementById("p_ttdClear"); if(clr) clr.hidden = !url;
}
function ppcTtdRebuildFromImage(){
  const pd = ppcTtdPending; if(!pd || !pd.img) return;
  try{
    pd.dataUrl = ppcTtdRender(pd.img, !!(document.getElementById("p_ttdBg")||{}).checked);
    pd.removed = false;
  }catch(err){
    pd.dataUrl = null; pd.img = null;
    const f = document.getElementById("p_ttdFile"); if(f) f.value = "";
    toast(err.message, "err");
  }
  ppcTtdPaintPreview();
}
document.addEventListener("change", async e=>{
  const t = e.target;
  if(t.id==="p_role"){
    const box = document.getElementById("p_ttdBox"); if(box) box.hidden = !ppcIsPPC({role:t.value});
  } else if(t.id==="p_ttdFile"){
    const file = t.files && t.files[0]; if(!file || !ppcTtdPending) return;
    if(!/^image\/(png|jpeg)$/.test(file.type)){ toast("Format harus JPG atau PNG.","err"); t.value = ""; return; }
    if(file.size>PPC_TTD_MAX_BYTES){ toast("Ukuran file maksimal 8 MB.","err"); t.value = ""; return; }
    try{ ppcTtdPending.img = await ppcTtdLoadImage(file); }
    catch(err){ toast(err.message,"err"); t.value = ""; return; }
    ppcTtdRebuildFromImage();
  } else if(t.id==="p_ttdBg"){
    ppcTtdRebuildFromImage();
  }
});
function ppcTtdClear(){
  if(!ppcTtdPending) return;
  ppcTtdPending.dataUrl = null; ppcTtdPending.img = null; ppcTtdPending.removed = true;
  const f = document.getElementById("p_ttdFile"); if(f) f.value = "";
  ppcTtdPaintPreview();
}
// Dipanggil savePersonil (06-plan-personil.js) SESUDAH objek personil final ada (id sudah pasti).
function ppcTtdApplyPending(person){
  const pd = ppcTtdPending; ppcTtdPending = null;
  if(!pd || !person || !ppcTtdAllowed() || !ppcIsPPC(person)) return;
  if(pd.dataUrl){
    ppcTtdCache.set(person.id, pd.dataUrl); ppcTtdHashMemo.delete(person.id);
    ppcTtdIdbPut(person.id, pd.dataUrl).catch(()=>toast("TTD gagal disimpan ke penyimpanan browser — masih bisa dipakai selama tab ini terbuka, unggah ulang nanti.","err"));
    if(typeof logChange==="function") logChange(`TTD PPC diperbarui: ${person.nama}`);
  } else if(pd.removed && ppcTtdCache.has(person.id)){
    ppcTtdForget(person.id);
    if(typeof logChange==="function") logChange(`TTD PPC dihapus: ${person.nama}`);
  }
}

/* ---------- Hash SHA-256 (sinkron, tanpa crypto.subtle — tetap jalan di file:// & browser lama) ---------- */
const PPC_SHA_K = [
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
];
function ppcSha256Hex(bytes){
  const ror = (x,n)=>(x>>>n)|(x<<(32-n));
  const len = bytes.length;
  const buf = new Uint8Array(((len+9+63)>>6)<<6);
  buf.set(bytes); buf[len] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(buf.length-8, Math.floor(len/0x20000000));
  dv.setUint32(buf.length-4, (len<<3)>>>0);
  const H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const w = new Uint32Array(64);
  for(let off=0; off<buf.length; off+=64){
    for(let i=0;i<16;i++) w[i] = dv.getUint32(off+i*4);
    for(let i=16;i<64;i++){
      const s0 = ror(w[i-15],7)^ror(w[i-15],18)^(w[i-15]>>>3);
      const s1 = ror(w[i-2],17)^ror(w[i-2],19)^(w[i-2]>>>10);
      w[i] = (w[i-16]+s0+w[i-7]+s1)>>>0;
    }
    let [a,b,c,d,e,f,g,h] = H;
    for(let i=0;i<64;i++){
      const S1 = ror(e,6)^ror(e,11)^ror(e,25);
      const t1 = (h+S1+((e&f)^(~e&g))+PPC_SHA_K[i]+w[i])>>>0;
      const S0 = ror(a,2)^ror(a,13)^ror(a,22);
      const t2 = (S0+((a&b)^(a&c)^(b&c)))>>>0;
      h=g; g=f; f=e; e=(d+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0;
    }
    H[0]=(H[0]+a)>>>0; H[1]=(H[1]+b)>>>0; H[2]=(H[2]+c)>>>0; H[3]=(H[3]+d)>>>0;
    H[4]=(H[4]+e)>>>0; H[5]=(H[5]+f)>>>0; H[6]=(H[6]+g)>>>0; H[7]=(H[7]+h)>>>0;
  }
  return H.map(x=>x.toString(16).padStart(8,"0")).join("");
}
const ppcSha256Text = s=>ppcSha256Hex(new TextEncoder().encode(s));
function ppcDataUrlBytes(dataUrl){
  const m = /^data:[^;,]+;base64,(.*)$/s.exec(dataUrl||""); if(!m) return new Uint8Array(0);
  const bin = atob(m[1]), out = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) out[i] = bin.charCodeAt(i);
  return out;
}
function ppcTtdImageHash(p){
  const url = ppcTtdUrl(p); if(!url) return "";
  const memo = ppcTtdHashMemo.get(p.id);
  if(memo && memo.url===url) return memo.hash;
  const hash = ppcSha256Hex(ppcDataUrlBytes(url));
  ppcTtdHashMemo.set(p.id, {url, hash});
  return hash;
}

/* ---------- QR (digambar langsung ke canvas → PNG, sinkron) ---------- */
function ppcTtdQrPng(text, targetPx){
  if(typeof qrcode!=="function") return "";
  const ascii = String(text).normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^\x20-\x7e]/g,"?");
  const qr = qrcode(0, "M"); qr.addData(ascii); qr.make();
  const n = qr.getModuleCount(), quiet = 3;
  const cell = Math.max(2, Math.floor((targetPx||240)/(n+quiet*2)));
  const size = (n+quiet*2)*cell;
  const cv = document.createElement("canvas"); cv.width = cv.height = size;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0,0,size,size);
  ctx.fillStyle = "#000";
  for(let r=0;r<n;r++) for(let c=0;c<n;c++) if(qr.isDark(r,c)) ctx.fillRect((c+quiet)*cell, (r+quiet)*cell, cell, cell);
  return cv.toDataURL("image/png");
}

/* ---------- Penghubung ke Berita Acara ---------- */
function ppcNameTokens(s){
  return String(s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/[^a-z\s]/g," ").split(/\s+/).filter(t=>t.length>=3);
}
// Nama penandatangan yang diketik di BA dianggap = ketua tim kalau semua kata (≥3 huruf) dari
// salah satunya ada di yang lain — tahan thd gelar (ST, MT), urutan & huruf besar/kecil.
function ppcNameMatches(a, b){
  const A = ppcNameTokens(a), B = ppcNameTokens(b);
  if(!A.length || !B.length) return false;
  const [s, l] = A.length<=B.length ? [A,B] : [B,A];
  return s.every(t=>l.includes(t));
}
function ppcTtdBaOpts(){
  const cfg = typeof ensureBaConfig==="function" ? ensureBaConfig() : {};
  const a = document.getElementById("baTtdAuto"), c = document.getElementById("baTtdCert");
  return {auto: a ? a.checked : cfg.ttdAuto!==false, cert: c ? c.checked : cfg.ttdCert!==false};
}
// Status penempelan TTD utk batch + nama penandatangan Lab yang sedang diketik di form BA.
//  status: visitor | off | no-lead | not-ppc | no-ttd | mismatch | ok
function ppcTtdBaState(batchId, namaLab){
  const opts = ppcTtdBaOpts();
  if(!ppcTtdAllowed()) return {status:"visitor", opts};
  const kt = typeof ketuaTimInfo==="function" ? ketuaTimInfo(batchId) : null;
  const b = DB.batches.find(x=>x.id===batchId);
  const lead = b && (b.assignedPersonil||[]).find(a=>a.lead);
  const p = lead ? DB.personil.find(x=>x.id===lead.id) : null;
  if(!kt || !p) return {status:"no-lead", opts};
  const base = {opts, personil:p, nama:p.nama, role:p.role};
  if(!ppcIsPPC(p)) return {...base, status:"not-ppc"};
  const url = ppcTtdUrl(p);
  if(!url) return {...base, status:"no-ttd"};
  if(!opts.auto) return {...base, status:"off", url};
  if((namaLab||"").trim() && !ppcNameMatches(namaLab, p.nama)) return {...base, status:"mismatch", url};
  return {...base, status:"ok", url};
}
function ppcTtdBaHintHtml(batchId, namaLab){
  const st = ppcTtdBaState(batchId, namaLab);
  const who = st.nama ? `<b>${escHtml(st.nama)}</b>` : "";
  switch(st.status){
    case "visitor": return `Tempel TTD otomatis hanya tersedia pada sesi Staf PHM.`;
    case "no-lead": return `Ketua Tim Sampling untuk batch ini belum ditunjuk di Perencanaan Batch &mdash; TTD belum bisa ditempel.`;
    case "not-ppc": return `Ketua Tim batch ini (${who}) berperan <b>${escHtml(st.role||"-")}</b>, bukan PPC &mdash; TTD hanya tersedia untuk PPC.`;
    case "no-ttd": return `Ketua Tim batch ini: ${who} &mdash; <b>belum punya tanda tangan</b>. Unggah di menu Personil &rarr; Edit. <button type="button" class="btn small ghost" data-action="goToPage" data-page="personil">Buka Personil</button>`;
    case "off": return `Penempelan TTD otomatis dimatikan (Ketua Tim: ${who}).`;
    case "mismatch": return `<span class="ba-ttd-warn">Nama penandatangan Lab (<b>${escHtml(namaLab)}</b>) berbeda dengan Ketua Tim batch ini (${who}) &mdash; TTD <b>tidak ditempel</b> agar tidak salah orang.</span> <button type="button" class="btn small" data-action="useKetuaTimName">Pakai nama ${escHtml(st.nama)}</button>`;
    case "ok": return `<span class="ba-ttd-ok">&#10003; TTD Ketua Tim ${who} akan ditempel otomatis di kolom Pihak Laboratorium.</span> <img class="ba-ttd-thumb" src="${st.url}" alt="TTD ${escHtml(st.nama)}">`;
  }
  return "";
}
function ppcPlainText(html){
  const t = document.createElement("textarea");
  t.innerHTML = String(html==null?"":html).replace(/<br\s*\/?>/gi," ").replace(/<[^>]+>/g,"");
  return t.value.replace(/\s+/g," ").trim();
}
// Sertifikat penandatanganan elektronik (isi dihitung dari data BA yang SAMA dgn dokumen keluarannya).
// signedAt = waktu unduh/cetak (tidak masuk hash, supaya hash tetap sama utk isi yang sama).
function ppcTtdBuildCert(d, st, signedAt){
  const rows = [];
  d.groups.forEach(g=>g.rows.forEach(r=>rows.push([r.no, r.titik, r.kategori, ppcPlainText(r.frekuensi), ppcPlainText(r.statusHtml)])));
  const imgHash = ppcTtdImageHash(st.personil);
  const canonical = JSON.stringify({
    v:1, team:d.team, site:d.site, batch:d.batchId, judul:d.judul, tanggal:d.tanggalPelaksanaan, tempat:d.tempatTanggal,
    phm:[d.namaPhm, d.jabatanPhm], lab:[d.labPerusahaan, d.namaLab, d.jabatanLab], ttd:imgHash, rows
  });
  const hash = ppcSha256Text(canonical);
  const b = DB.batches.find(x=>x.id===d.batchId);
  const bn = b ? (b.name.match(/Batch\s*(\d+)/i)||[])[1] : "";
  const docId = `BA-${d.team==="emisi"?"EMISI":"AMBIENT"}-${String(d.site).replace(/[^A-Za-z0-9]/g,"")}-${DB.meta.semester}${DB.meta.tahun}${bn?`-B${bn}`:""}-${hash.slice(0,8).toUpperCase()}`;
  const when = signedAt || new Date();
  const fmt = new Intl.DateTimeFormat("id-ID", {day:"numeric", month:"long", year:"numeric", hour:"2-digit", minute:"2-digit", hour12:false, timeZoneName:"short"});
  const signedAtText = fmt.format(when).replace(/\./g,":").replace(" pukul","");
  const qrText = `PHM-BA|${docId}|SHA256:${hash}|${st.nama}|${when.toISOString()}`;
  return {
    docId, hash, imgHash, signerName:d.namaLab, signerRole:d.jabatanLab, company:d.labPerusahaan,
    signedAtText, signedAtIso:when.toISOString(), qrPng: ppcTtdQrPng(qrText, 300), qrText,
    next: {name:d.namaPhm, role:d.jabatanPhm, site:d.site}
  };
}
function useKetuaTimName(){
  const team = document.getElementById("baTeam").value;
  const st = ppcTtdBaState(document.getElementById("baBatch").value, "");
  if(!st.personil) return;
  const inp = document.getElementById("baNamaLab");
  inp.value = st.personil.nama; inp.dataset.touched = "1";
  ensureBaConfig()[team].namaLab = st.personil.nama;
  save();
  toast("Nama Ketua Tim dipakai sbg penandatangan Lab.","ok");
  if(typeof renderBeritaAcara==="function") renderBeritaAcara();
}
Object.assign(ACTIONS, {ppcTtdClear, useKetuaTimName});

/* ---------- Backup (opt-in) ---------- */
async function ppcTtdExportMap(){
  await ppcTtdEnsureLoaded();
  const out = {};
  DB.personil.forEach(p=>{ const u = ppcTtdCache.get(p.id); if(u && ppcIsPPC(p)) out[p.id] = u; });
  return out;
}
async function ppcTtdImportMap(map){
  if(!map || typeof map!=="object" || !ppcTtdAllowed()) return 0;
  const ids = Object.keys(map).filter(id=>/^data:image\/png;base64,/.test(map[id]||""));
  for(const id of ids){
    try{ await ppcTtdIdbPut(id, map[id]); ppcTtdCache.set(id, map[id]); ppcTtdHashMemo.delete(id); }
    catch(err){ toast("Sebagian TTD PPC gagal ditulis ke penyimpanan browser saat restore.","err"); break; }
  }
  return ids.length;
}
setTimeout(ppcTtdEnsureLoaded, 0);
