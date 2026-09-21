/* =========================================================
   PERSONIL KOMPETENSI PPU (Manager Energi / Penanggung Jawab PPU / Operator PPU)
   ---------------------------------------------------------
   Registri sertifikasi kompetensi personil (LSP), TERPISAH dari DB.personil (yg utk kelengkapan
   dokumen personil sampling lapangan PPC/Observer, lihat 06-plan-personil.js — konsep berbeda:
   itu "siap berangkat sampling", ini "kompeten bersertifikat PPU sesuai regulasi"). Ditampilkan sbg
   kartu tambahan di halaman Personil PPC & Observer yang sama (bukan nav terpisah, tetap satu
   payung "Personil").
   Lampiran (scan sertifikat PDF/gambar) disimpan di IndexedDB terpisah (phmPersonilLampiranDB),
   pola PERSIS sama dgn dokFotoIdb* (17-dokumentasi-foto.js) — DB.personilPPU di localStorage cuma
   metadata ringan {..., lampiranId, lampiranFilename, lampiranMime}, byte filenya di sini.
========================================================= */

/* ---------- Penyimpanan blob lampiran: IndexedDB ---------- */
const PPU_LAMPIRAN_IDB_NAME = "phmPersonilLampiranDB";
const PPU_LAMPIRAN_IDB_STORE = "lampiran";
let ppuLampiranIdbPromise = null;
function ppuLampiranIdbOpen(){
  if(ppuLampiranIdbPromise) return ppuLampiranIdbPromise;
  ppuLampiranIdbPromise = new Promise((resolve, reject)=>{
    if(!window.indexedDB){ reject(new Error("Browser ini tidak mendukung IndexedDB.")); return; }
    const req = indexedDB.open(PPU_LAMPIRAN_IDB_NAME, 1);
    req.onupgradeneeded = ()=>{ if(!req.result.objectStoreNames.contains(PPU_LAMPIRAN_IDB_STORE)) req.result.createObjectStore(PPU_LAMPIRAN_IDB_STORE); };
    req.onsuccess = ()=>resolve(req.result);
    req.onerror = ()=>reject(req.error||new Error("Gagal membuka penyimpanan lampiran (IndexedDB)."));
  });
  return ppuLampiranIdbPromise;
}
function ppuLampiranIdbPut(id, dataUrl){
  return ppuLampiranIdbOpen().then(db=>new Promise((resolve,reject)=>{
    const tx = db.transaction(PPU_LAMPIRAN_IDB_STORE,"readwrite");
    tx.objectStore(PPU_LAMPIRAN_IDB_STORE).put(dataUrl, id);
    tx.oncomplete = ()=>resolve();
    tx.onerror = ()=>reject(tx.error);
  }));
}
function ppuLampiranIdbGet(id){
  return ppuLampiranIdbOpen().then(db=>new Promise((resolve,reject)=>{
    const tx = db.transaction(PPU_LAMPIRAN_IDB_STORE,"readonly");
    const req = tx.objectStore(PPU_LAMPIRAN_IDB_STORE).get(id);
    req.onsuccess = ()=>resolve(req.result);
    req.onerror = ()=>reject(req.error);
  }));
}
function ppuLampiranIdbDelete(id){
  return ppuLampiranIdbOpen().then(db=>new Promise((resolve,reject)=>{
    const tx = db.transaction(PPU_LAMPIRAN_IDB_STORE,"readwrite");
    tx.objectStore(PPU_LAMPIRAN_IDB_STORE).delete(id);
    tx.oncomplete = ()=>resolve();
    tx.onerror = ()=>reject(tx.error);
  }));
}
// Semua entry {id,dataUrl} — dipakai export JSON backup lengkap (file portable berdiri sendiri,
// sama alasannya dgn dokFotoIdbGetAll di 17-dokumentasi-foto.js).
function ppuLampiranIdbGetAll(){
  return ppuLampiranIdbOpen().then(db=>new Promise((resolve,reject)=>{
    const tx = db.transaction(PPU_LAMPIRAN_IDB_STORE,"readonly");
    const store = tx.objectStore(PPU_LAMPIRAN_IDB_STORE);
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
function ppuLampiranIdbBulkPut(entries){
  if(!entries.length) return Promise.resolve();
  return ppuLampiranIdbOpen().then(db=>new Promise((resolve,reject)=>{
    const tx = db.transaction(PPU_LAMPIRAN_IDB_STORE,"readwrite");
    const store = tx.objectStore(PPU_LAMPIRAN_IDB_STORE);
    entries.forEach(e=>store.put(e.dataUrl, e.id));
    tx.oncomplete = ()=>resolve();
    tx.onerror = ()=>reject(tx.error);
  }));
}
const PPU_LAMPIRAN_MAX_BYTES = 8*1024*1024; // dataUrl base64 ~33% lbh besar dari file asli, cukup longgar utk scan sertifikat

/* ---------- Data & tabel ---------- */
const PPU_KUALIFIKASI_OPTIONS = ["Manager Energi", "Penanggung Jawab PPU", "Operator PPU"];
function ensurePersonilPpuArr(){ if(!Array.isArray(DB.personilPPU)) DB.personilPPU = []; return DB.personilPPU; }
function personilPpuMasaBerlakuLabel(p){
  if(!p.masaBerlakuMulai && !p.masaBerlakuSelesai) return "-";
  return `${p.masaBerlakuMulai||"?"} s/d ${p.masaBerlakuSelesai||"?"}`;
}
function personilPpuStatusBerlaku(p){
  if(!p.masaBerlakuSelesai) return null;
  const days = Math.round((new Date(p.masaBerlakuSelesai)-new Date())/86400000);
  if(days<0) return {text:"Expired", color:"#c0392b"};
  if(days<=60) return {text:`${days} hr lagi`, color:"#c98a1a"};
  return {text:"Berlaku", color:"#2f9e5b"};
}
function personilPpuMatchesFilter(p){
  const kual = document.getElementById("ppuFltKualifikasi");
  if(kual && kual.value && p.kualifikasi!==kual.value) return false;
  const site = document.getElementById("ppuFltSite");
  if(site && site.value && !(p.sites||[]).includes(site.value)) return false;
  const q = document.getElementById("ppuFltSearch");
  if(q && q.value.trim() && !p.nama.toLowerCase().includes(q.value.trim().toLowerCase())) return false;
  return true;
}
function renderPersonilPPU(){
  const host = document.getElementById("ppuTable");
  if(!host) return;
  const siteSel = document.getElementById("ppuFltSite");
  if(siteSel && !siteSel.dataset.filled){
    siteSel.innerHTML = `<option value="">Semua Site</option>` + allSites().map(s=>`<option value="${escHtml(s)}">${s}</option>`).join("");
    siteSel.dataset.filled = "1";
  }
  const all = ensurePersonilPpuArr();
  const rows = all.filter(personilPpuMatchesFilter).slice().sort((a,b)=>a.nama.localeCompare(b.nama));
  host.innerHTML = `
    <thead><tr>
      <th style="width:30px;">No</th>
      <th>Kualifikasi Kompetensi</th>
      <th>Nama Personil</th>
      <th>Nomor Sertifikat</th>
      <th>Masa Berlaku</th>
      <th>Nama LSP</th>
      <th>No. Registrasi LSP</th>
      <th>Alokasi Site</th>
      <th>Lampiran</th>
      <th style="width:130px;">Aksi</th>
    </tr></thead>
    <tbody>${rows.length ? rows.map((p,i)=>{
      const st = personilPpuStatusBerlaku(p);
      return `<tr>
        <td>${i+1}</td>
        <td>${escHtml(p.kualifikasi)}</td>
        <td><b>${escHtml(p.nama)}</b></td>
        <td>${escHtml(p.nomorSertifikat||"-")}</td>
        <td style="white-space:nowrap;">${escHtml(personilPpuMasaBerlakuLabel(p))}${st?`<div style="margin-top:2px;"><span class="badge" style="background:${st.color}22;color:${st.color};font-weight:700;">${st.text}</span></div>`:""}</td>
        <td>${escHtml(p.namaLSP||"-")}</td>
        <td>${escHtml(p.noRegistrasiLSP||"-")}</td>
        <td>${(p.sites||[]).length ? p.sites.map(s=>`<span class="badge b-gray" style="margin:1px;">${escHtml(s)}</span>`).join("") : '<span class="muted" style="font-size:11px;">-</span>'}</td>
        <td>${p.lampiranId ? `<button class="btn small ghost" data-action="downloadPersonilPpuLampiran" data-id="${p.id}">Download File</button>` : '<span class="muted" style="font-size:11px;">-</span>'}</td>
        <td style="white-space:nowrap;"><button class="btn small" data-action="editPersonilPpu" data-id="${p.id}">Edit</button> <button class="btn small danger" data-action="deletePersonilPpuBtn" data-id="${p.id}">Hapus</button></td>
      </tr>`;
    }).join("") : `<tr><td colspan="10" class="muted" style="text-align:center;padding:20px;">${all.length?"Tidak ada personil yang cocok dengan filter.":'Belum ada data personil kompetensi PPU. Klik "+ Tambah Personil PPU" utk mulai.'}</td></tr>`}</tbody>`;
  const countEl = document.getElementById("ppuCount");
  if(countEl) countEl.textContent = rows.length===all.length ? `${all.length} personil` : `${rows.length} dari ${all.length} personil ditampilkan`;
}
["ppuFltKualifikasi","ppuFltSite","ppuFltSearch"].forEach(id=>{
  document.addEventListener("input", e=>{ if(e.target.id===id) renderPersonilPPU(); });
  document.addEventListener("change", e=>{ if(e.target.id===id) renderPersonilPPU(); });
});

/* ---------- Form tambah/edit ---------- */
function personilPpuFormHtml(p){
  p = p || {id:"", kualifikasi:PPU_KUALIFIKASI_OPTIONS[0], nama:"", nomorSertifikat:"", masaBerlakuMulai:"", masaBerlakuSelesai:"", namaLSP:"", noRegistrasiLSP:"", sites:[], lampiranId:"", lampiranFilename:""};
  const siteChecks = allSites().map(s=>`<label class="checkline"><input type="checkbox" class="ppuSiteChk" value="${escHtml(s)}" ${(p.sites||[]).includes(s)?"checked":""}> ${escHtml(s)}</label>`).join("");
  return `
  <h3>${p.id?"Edit":"Tambah"} Personil Kompetensi PPU</h3>
  <div class="grid cols-2">
    <div class="field"><label>Kualifikasi Kompetensi</label><select id="ppu_kualifikasi">${PPU_KUALIFIKASI_OPTIONS.map(k=>`<option ${p.kualifikasi===k?"selected":""}>${escHtml(k)}</option>`).join("")}</select></div>
    <div class="field"><label>Nama Personil</label><input type="text" id="ppu_nama" value="${escHtml(p.nama)}"></div>
  </div>
  <div class="grid cols-2" style="margin-top:10px;">
    <div class="field"><label>Nomor Sertifikat</label><input type="text" id="ppu_nomorSertifikat" value="${escHtml(p.nomorSertifikat)}"></div>
    <div class="field"><label>Nama LSP</label><input type="text" id="ppu_namaLSP" value="${escHtml(p.namaLSP)}"></div>
  </div>
  <div class="grid cols-2" style="margin-top:10px;">
    <div class="field"><label>Masa Berlaku Mulai</label><input type="date" id="ppu_masaBerlakuMulai" value="${p.masaBerlakuMulai||""}"></div>
    <div class="field"><label>Masa Berlaku s/d</label><input type="date" id="ppu_masaBerlakuSelesai" value="${p.masaBerlakuSelesai||""}"></div>
  </div>
  <div class="field" style="margin-top:10px;"><label>No. Registrasi LSP</label><input type="text" id="ppu_noRegistrasiLSP" value="${escHtml(p.noRegistrasiLSP)}"></div>
  <div class="field" style="margin-top:10px;"><label>Alokasi Site <span class="muted" style="font-weight:400;">(personil ini ditugaskan di site mana saja)</span></label>
    <div class="grid cols-4">${siteChecks || '<span class="hint">Belum ada site di Database Titik Pantau.</span>'}</div>
  </div>
  <div class="field" style="margin-top:10px;"><label>Lampiran Sertifikat (PDF/Gambar, maks ${(PPU_LAMPIRAN_MAX_BYTES/1024/1024).toFixed(0)}MB)</label>
    <input type="file" id="ppu_lampiranFile" accept="application/pdf,image/*">
    <div class="hint" style="margin-top:4px;">${p.lampiranId?`File saat ini: <b>${escHtml(p.lampiranFilename||"lampiran")}</b> — pilih file baru utk mengganti.`:"Belum ada lampiran."}</div>
  </div>
  <div class="actions">
    <button class="btn ghost" data-action="closeModal">Batal</button>
    <button class="btn primary" data-action="savePersonilPpuBtn" data-id="${p.id}">Simpan</button>
  </div>`;
}
function addPersonilPpu(){ openModal(personilPpuFormHtml(null), {wide:true}); }
function editPersonilPpu(id){
  const p = ensurePersonilPpuArr().find(x=>x.id===id);
  if(p) openModal(personilPpuFormHtml(p), {wide:true});
}
async function savePersonilPpu(id){
  const nama = document.getElementById("ppu_nama").value.trim();
  if(!nama){ toast("Nama personil wajib diisi.","err"); return; }
  const fileInp = document.getElementById("ppu_lampiranFile");
  const file = fileInp.files[0];
  if(file && file.size > PPU_LAMPIRAN_MAX_BYTES){
    toast(`File terlalu besar (maks ${(PPU_LAMPIRAN_MAX_BYTES/1024/1024).toFixed(0)}MB) — kompres dulu file-nya.`, "err");
    return;
  }
  const sites = [...document.querySelectorAll(".ppuSiteChk:checked")].map(c=>c.value);
  const val = {
    kualifikasi: document.getElementById("ppu_kualifikasi").value,
    nama,
    nomorSertifikat: document.getElementById("ppu_nomorSertifikat").value.trim(),
    masaBerlakuMulai: document.getElementById("ppu_masaBerlakuMulai").value,
    masaBerlakuSelesai: document.getElementById("ppu_masaBerlakuSelesai").value,
    namaLSP: document.getElementById("ppu_namaLSP").value.trim(),
    noRegistrasiLSP: document.getElementById("ppu_noRegistrasiLSP").value.trim(),
    sites
  };
  const existing = id ? ensurePersonilPpuArr().find(x=>x.id===id) : null;
  let lampiranId = existing ? existing.lampiranId : "";
  let lampiranFilename = existing ? existing.lampiranFilename : "";
  let lampiranMime = existing ? existing.lampiranMime : "";
  const oldLampiranId = lampiranId;
  if(file){
    let dataUrl;
    try{
      dataUrl = await new Promise((resolve,reject)=>{
        const reader = new FileReader();
        reader.onload = ()=>resolve(reader.result);
        reader.onerror = ()=>reject(new Error("Gagal membaca file lampiran."));
        reader.readAsDataURL(file);
      });
    }catch(err){ toast(err.message,"err"); return; }
    const newLampiranId = uid("PPUL");
    try{
      await ppuLampiranIdbPut(newLampiranId, dataUrl);
    }catch(err){
      toast("Gagal menyimpan lampiran ke penyimpanan (IndexedDB): "+err.message, "err");
      return;
    }
    lampiranId = newLampiranId;
    lampiranFilename = file.name;
    lampiranMime = file.type || "application/octet-stream";
    if(oldLampiranId) ppuLampiranIdbDelete(oldLampiranId).catch(()=>{});
  }
  val.lampiranId = lampiranId; val.lampiranFilename = lampiranFilename; val.lampiranMime = lampiranMime;
  if(id && existing){ Object.assign(existing, val); }
  else { ensurePersonilPpuArr().push({id: uid("PPU"), createdAt: new Date().toISOString(), ...val}); }
  touchDataset("personilPPU"); save(); closeModal(); renderPersonilPPU();
  toast(id?"Personil PPU diperbarui.":"Personil PPU ditambahkan.", "ok");
}
function deletePersonilPpu(id){
  const p = ensurePersonilPpuArr().find(x=>x.id===id);
  if(!p) return;
  askConfirm(`Hapus data personil "${p.nama}" (${p.kualifikasi}) ini? Lampirannya juga akan ikut terhapus.`, async ()=>{
    if(p.lampiranId){ try{ await ppuLampiranIdbDelete(p.lampiranId); }catch(e){ /* metadata tetap dihapus walau blob gagal dihapus */ } }
    DB.personilPPU = DB.personilPPU.filter(x=>x.id!==id);
    touchDataset("personilPPU"); save(); renderPersonilPPU();
    toast("Personil PPU dihapus.","ok");
  });
}
async function downloadPersonilPpuLampiran(id){
  const p = ensurePersonilPpuArr().find(x=>x.id===id);
  if(!p || !p.lampiranId) return;
  let dataUrl;
  try{ dataUrl = await ppuLampiranIdbGet(p.lampiranId); }
  catch(e){ toast("Gagal membaca lampiran dari penyimpanan.","err"); return; }
  if(!dataUrl){ toast("File lampiran tidak ditemukan di penyimpanan (mungkin sudah terhapus).","err"); return; }
  const fallbackExt = p.lampiranMime==="application/pdf" ? ".pdf" : "";
  const filename = p.lampiranFilename || sanitizeFotoFilename(p.nama+"_sertifikat"+fallbackExt);
  downloadDataUrl(dataUrl, sanitizeFotoFilename(filename));
}

/* ---------- Export/Import Excel (metadata saja — lampiran tidak ikut, diisi manual per personil via UI) ---------- */
const PPU_XLSX_HEADERS = ["id","kualifikasi","nama","nomorSertifikat","masaBerlakuMulai","masaBerlakuSelesai","namaLSP","noRegistrasiLSP","sites"];
function personilPpuRowForExport(p){
  return {
    id:p.id, kualifikasi:p.kualifikasi, nama:p.nama, nomorSertifikat:p.nomorSertifikat||"",
    masaBerlakuMulai:p.masaBerlakuMulai||"", masaBerlakuSelesai:p.masaBerlakuSelesai||"",
    namaLSP:p.namaLSP||"", noRegistrasiLSP:p.noRegistrasiLSP||"", sites:(p.sites||[]).join(", ")
  };
}
function exportPersonilPpuXlsx(){
  const wb = xlsxWorkbookFromSheets([["Personil PPU", xlsxSheetFromRows(PPU_XLSX_HEADERS, ensurePersonilPpuArr().map(personilPpuRowForExport))]]);
  xlsxDownload(wb, `personil_ppu_export_${todayStr()}.xlsx`);
}
function importPersonilPpuXlsx(){
  xlsxImport(wb=>{
    const ws = wb.Sheets["Personil PPU"] || wb.Sheets[wb.SheetNames[0]];
    const rows = xlsxSheetToRows(ws);
    let added=0, updated=0;
    rows.forEach(r=>{
      if(!r.nama) return;
      const val = {
        kualifikasi: PPU_KUALIFIKASI_OPTIONS.includes(r.kualifikasi) ? r.kualifikasi : (r.kualifikasi||PPU_KUALIFIKASI_OPTIONS[0]),
        nama: r.nama, nomorSertifikat: r.nomorSertifikat||"",
        masaBerlakuMulai: r.masaBerlakuMulai instanceof Date ? xlsxDateToIso(r.masaBerlakuMulai) : (r.masaBerlakuMulai||""),
        masaBerlakuSelesai: r.masaBerlakuSelesai instanceof Date ? xlsxDateToIso(r.masaBerlakuSelesai) : (r.masaBerlakuSelesai||""),
        namaLSP: r.namaLSP||"", noRegistrasiLSP: r.noRegistrasiLSP||"",
        sites: String(r.sites||"").split(",").map(s=>s.trim()).filter(Boolean)
      };
      if(r.id){
        const existing = ensurePersonilPpuArr().find(p=>p.id===r.id);
        if(existing){ Object.assign(existing, val); updated++; return; }
      }
      ensurePersonilPpuArr().push({id: uid("PPU"), createdAt: new Date().toISOString(), lampiranId:"", lampiranFilename:"", lampiranMime:"", ...val});
      added++;
    });
    touchDataset("personilPPU"); save(); renderPersonilPPU();
    toast(`Import Personil PPU selesai: ${added} baru, ${updated} diperbarui. (Lampiran PDF tidak ikut lewat Excel — tambahkan manual lewat Edit per personil.)`,"ok");
  });
}

Object.assign(ACTIONS, {
  addPersonilPpu,
  editPersonilPpu:(t)=>editPersonilPpu(t.dataset.id),
  savePersonilPpuBtn:(t)=>savePersonilPpu(t.dataset.id),
  deletePersonilPpuBtn:(t)=>deletePersonilPpu(t.dataset.id),
  downloadPersonilPpuLampiran:(t)=>downloadPersonilPpuLampiran(t.dataset.id),
  exportPersonilPpuXlsx,
  importPersonilPpuXlsx
});
