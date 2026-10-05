/* =========================================================
   LABORATORIUM (Setup)
   ---------------------------------------------------------
   Registri laboratorium jasa kontraktor (mis. Sucofindo) yang dipakai utk sampling emisi dan/atau
   ambien — alamat, kontak, akreditasi KAN (ISO 17025) & registrasi Laboratorium Lingkungan KLH,
   plus daftar parameter pengukuran yang dicakup tiap lab. Field & dokumen mengikuti formulir
   registrasi laboratorium lingkungan versi pemerintah (KAN wajib utk semua lab uji; KLH wajib utk
   lab yang menguji parameter lingkungan seperti emisi/ambien).
   Lampiran (Sertifikat Akreditasi KAN, Surat Registrasi KLH, Rujukan Gubernur — semua PDF) disimpan
   di IndexedDB terpisah (phmLaboratoriumLampiranDB), pola PERSIS sama dgn ppuLampiranIdb*
   (24-personil-ppu.js) — DB.laboratorium di localStorage cuma metadata ringan {...Id, ...Filename,
   ...Mime}, byte filenya di sini. Beda dgn PPU: 1 record laboratorium bisa punya SAMPAI 3 lampiran
   sekaligus (bukan cuma 1), jadi helper IndexedDB-nya digeneralisasi lewat daftar LAB_LAMPIRAN_KINDS
   supaya baca/simpan/hapus/export-import ketiganya tidak perlu ditulis 3x berulang.
========================================================= */

/* ---------- Penyimpanan blob lampiran: IndexedDB ---------- */
const LAB_LAMPIRAN_IDB_NAME = "phmLaboratoriumLampiranDB";
const LAB_LAMPIRAN_IDB_STORE = "lampiran";
let labLampiranIdbPromise = null;
function labLampiranIdbOpen(){
  if(labLampiranIdbPromise) return labLampiranIdbPromise;
  labLampiranIdbPromise = new Promise((resolve, reject)=>{
    if(!window.indexedDB){ reject(new Error("Browser ini tidak mendukung IndexedDB.")); return; }
    const req = indexedDB.open(LAB_LAMPIRAN_IDB_NAME, 1);
    req.onupgradeneeded = ()=>{ if(!req.result.objectStoreNames.contains(LAB_LAMPIRAN_IDB_STORE)) req.result.createObjectStore(LAB_LAMPIRAN_IDB_STORE); };
    req.onsuccess = ()=>resolve(req.result);
    req.onerror = ()=>reject(req.error||new Error("Gagal membuka penyimpanan lampiran (IndexedDB)."));
  });
  return labLampiranIdbPromise;
}
function labLampiranIdbPut(id, dataUrl){
  return labLampiranIdbOpen().then(db=>new Promise((resolve,reject)=>{
    const tx = db.transaction(LAB_LAMPIRAN_IDB_STORE,"readwrite");
    tx.objectStore(LAB_LAMPIRAN_IDB_STORE).put(dataUrl, id);
    tx.oncomplete = ()=>resolve();
    tx.onerror = ()=>reject(tx.error);
  }));
}
function labLampiranIdbGet(id){
  return labLampiranIdbOpen().then(db=>new Promise((resolve,reject)=>{
    const tx = db.transaction(LAB_LAMPIRAN_IDB_STORE,"readonly");
    const req = tx.objectStore(LAB_LAMPIRAN_IDB_STORE).get(id);
    req.onsuccess = ()=>resolve(req.result);
    req.onerror = ()=>reject(req.error);
  }));
}
function labLampiranIdbDelete(id){
  return labLampiranIdbOpen().then(db=>new Promise((resolve,reject)=>{
    const tx = db.transaction(LAB_LAMPIRAN_IDB_STORE,"readwrite");
    tx.objectStore(LAB_LAMPIRAN_IDB_STORE).delete(id);
    tx.oncomplete = ()=>resolve();
    tx.onerror = ()=>reject(tx.error);
  }));
}
// Semua entry {id,dataUrl} — dipakai export JSON backup lengkap (file portable berdiri sendiri).
function labLampiranIdbGetAll(){
  return labLampiranIdbOpen().then(db=>new Promise((resolve,reject)=>{
    const tx = db.transaction(LAB_LAMPIRAN_IDB_STORE,"readonly");
    const store = tx.objectStore(LAB_LAMPIRAN_IDB_STORE);
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
function labLampiranIdbBulkPut(entries){
  if(!entries.length) return Promise.resolve();
  return labLampiranIdbOpen().then(db=>new Promise((resolve,reject)=>{
    const tx = db.transaction(LAB_LAMPIRAN_IDB_STORE,"readwrite");
    const store = tx.objectStore(LAB_LAMPIRAN_IDB_STORE);
    entries.forEach(e=>store.put(e.dataUrl, e.id));
    tx.oncomplete = ()=>resolve();
    tx.onerror = ()=>reject(tx.error);
  }));
}
const LAB_LAMPIRAN_MAX_BYTES = 2*1024*1024; // 2MB per lampiran, sesuai permintaan — lebih ketat dari PPU (8MB)
// 3 jenis lampiran yang bisa dimiliki 1 record laboratorium — field DB-nya selalu {kind}Id/
// {kind}Filename/{kind}Mime (pola PERSIS lampiranId/lampiranFilename/lampiranMime milik PPU, cuma
// diulang 3x dgn prefix beda) supaya kode baca/simpan/hapus/export-import bisa di-loop generik.
const LAB_LAMPIRAN_KINDS = [
  {key:"sertifikat", label:"Sertifikat Akreditasi (KAN)"},
  {key:"suratRegistrasi", label:"Surat Registrasi (KLH)"},
  {key:"rujukanGubernur", label:"Rujukan Gubernur"}
];
// Nama file lampiran TIDAK boleh mengandung @ & # / — sesuai syarat sistem tujuan (portal registrasi
// pemerintah) yang filenya nanti diunggah ulang ke sana. Diperluas dari pola sanitizeFotoFilename
// (17-dokumentasi-foto.js, yg cuma strip karakter terlarang filesystem \/:*?"<>|) dgn 4 karakter
// tambahan ini, bukan dipakai gantiin punya foto krn aturannya memang beda.
function sanitizeLabFilename(s){ return String(s||"").replace(/[\\/:*?"<>|@&#]/g,"_"); }

/* ---------- Data referensi: Provinsi & saran Parameter Pengukuran ---------- */
// 38 provinsi Indonesia (data administratif nasional yang stabil) — Kabkota SENGAJA dibuat isian
// teks bebas (bukan dropdown bertingkat) krn daftar kabupaten/kota lengkap se-Indonesia (500+ entri)
// terlalu besar utk dihardcode akurat di sini tanpa risiko salah/usang.
const PROVINSI_INDONESIA = [
  "Aceh","Sumatera Utara","Sumatera Barat","Riau","Kepulauan Riau","Jambi","Sumatera Selatan",
  "Kepulauan Bangka Belitung","Bengkulu","Lampung","DKI Jakarta","Jawa Barat","Banten","Jawa Tengah",
  "DI Yogyakarta","Jawa Timur","Bali","Nusa Tenggara Barat","Nusa Tenggara Timur","Kalimantan Barat",
  "Kalimantan Tengah","Kalimantan Selatan","Kalimantan Timur","Kalimantan Utara","Sulawesi Utara",
  "Gorontalo","Sulawesi Tengah","Sulawesi Barat","Sulawesi Selatan","Sulawesi Tenggara","Maluku",
  "Maluku Utara","Papua","Papua Barat","Papua Tengah","Papua Pegunungan","Papua Selatan","Papua Barat Daya"
];
// Cuma SARAN (datalist, bukan enum tertutup) — field parameter tetap text input bebas diisi manual
// sesuai permintaan ("parameter nya bisa aku isi manual"), daftar ini sekadar bantu ketik cepat utk
// parameter yang paling umum diuji (emisi & ambien).
const LAB_PARAMETER_SUGGESTIONS = [
  "NITROGEN OKSIDA (NOX) - MG/NM3","SULFUR DIOKSIDA (SO2) - MG/NM3","KARBON MONOKSIDA (CO) - MG/NM3",
  "PARTIKULAT (TOTAL SUSPENDED PARTICULATE) - MG/NM3","OPASITAS - %","HIDROGEN SULFIDA (H2S) - MG/NM3",
  "AMONIA (NH3) - MG/NM3","TOTAL REDUCED SULFUR (TRS) - MG/NM3","HIDROKARBON (HC) - PPM","OKSIGEN (O2) - %",
  "SULFUR DIOKSIDA (SO2) AMBIEN - UG/NM3","NITROGEN DIOKSIDA (NO2) AMBIEN - UG/NM3",
  "KARBON MONOKSIDA (CO) AMBIEN - UG/NM3","OKSIDAN (O3) AMBIEN - UG/NM3","PARTIKULAT (PM10) - UG/NM3",
  "PARTIKULAT (PM2.5) - UG/NM3","DEBU (TSP) AMBIEN - UG/NM3","TIMBAL (PB) AMBIEN - UG/NM3",
  "KEBISINGAN (NOISE LEVEL) - DB(A)","KEBAUAN (ODOUR) - SKALA/NO","GETARAN (VIBRATION) - MM/S"
];

/* ---------- Data & tabel ---------- */
function ensureLaboratoriumArr(){ if(!Array.isArray(DB.laboratorium)) DB.laboratorium = []; return DB.laboratorium; }
function labStatusBerlaku(habisBerlaku){
  if(!habisBerlaku) return null;
  const days = Math.round((new Date(habisBerlaku)-new Date())/86400000);
  if(days<0) return {text:"Expired", color:"#c0392b"};
  if(days<=60) return {text:`${days} hr lagi`, color:"#c98a1a"};
  return {text:"Berlaku", color:"#2f9e5b"};
}
function labMatchesFilter(l){
  const q = document.getElementById("labFltSearch");
  if(q && q.value.trim() && !l.nama.toLowerCase().includes(q.value.trim().toLowerCase())) return false;
  const scope = document.getElementById("labFltScope");
  if(scope && scope.value==="emisi" && !l.scopeEmisi) return false;
  if(scope && scope.value==="ambien" && !l.scopeAmbien) return false;
  return true;
}
function labScopeBadgesHtml(l){
  const badges = [];
  if(l.scopeEmisi) badges.push(`<span class="badge b-teal">Emisi</span>`);
  if(l.scopeAmbien) badges.push(`<span class="badge b-gray">Ambien</span>`);
  return badges.join(" ") || '<span class="muted" style="font-size:11px;">-</span>';
}
function renderLaboratorium(){
  const host = document.getElementById("labTable");
  if(!host) return;
  const all = ensureLaboratoriumArr();
  const rows = all.filter(labMatchesFilter).slice().sort((a,b)=>a.nama.localeCompare(b.nama));
  host.innerHTML = `
    <thead><tr>
      <th style="width:30px;">No</th>
      <th>Nama Laboratorium</th>
      <th>Provinsi / Kabkota</th>
      <th>Lingkup</th>
      <th>Akreditasi KAN</th>
      <th>Registrasi KLH</th>
      <th>Parameter</th>
      <th style="width:130px;">Aksi</th>
    </tr></thead>
    <tbody>${rows.length ? rows.map((l,i)=>{
      const stKan = labStatusBerlaku(l.kanHabisBerlaku);
      const stKlh = labStatusBerlaku(l.klhHabisBerlaku);
      return `<tr>
        <td>${i+1}</td>
        <td><b>${escHtml(l.nama)}</b><div class="muted" style="font-size:11px;">${escHtml(l.telepon||"-")}${l.email?" &middot; "+escHtml(l.email):""}</div></td>
        <td>${escHtml(l.provinsi||"-")}${l.kabkota?", "+escHtml(l.kabkota):""}</td>
        <td>${labScopeBadgesHtml(l)}</td>
        <td>${escHtml(l.kanNoAkreditasi||"-")}${stKan?`<div style="margin-top:2px;"><span class="badge" style="background:${stKan.color}22;color:${stKan.color};font-weight:700;">${stKan.text}</span></div>`:""}</td>
        <td>${escHtml(l.klhNoRegistrasi||"-")}${stKlh?`<div style="margin-top:2px;"><span class="badge" style="background:${stKlh.color}22;color:${stKlh.color};font-weight:700;">${stKlh.text}</span></div>`:""}</td>
        <td>${(l.parameters||[]).length} parameter</td>
        <td style="white-space:nowrap;"><button class="btn small" data-action="editLaboratorium" data-id="${l.id}">Edit</button> <button class="btn small danger" data-action="deleteLaboratoriumBtn" data-id="${l.id}">Hapus</button></td>
      </tr>`;
    }).join("") : `<tr><td colspan="8" class="muted" style="text-align:center;padding:20px;">${all.length?"Tidak ada laboratorium yang cocok dengan filter.":'Belum ada data laboratorium. Klik "+ Tambah Laboratorium" utk mulai.'}</td></tr>`}</tbody>`;
  const countEl = document.getElementById("labCount");
  if(countEl) countEl.textContent = rows.length===all.length ? `${all.length} laboratorium` : `${rows.length} dari ${all.length} laboratorium ditampilkan`;
}
["labFltScope","labFltSearch"].forEach(id=>{
  document.addEventListener("input", e=>{ if(e.target.id===id) renderLaboratorium(); });
  document.addEventListener("change", e=>{ if(e.target.id===id) renderLaboratorium(); });
});

/* ---------- Form tambah/edit ---------- */
// Draft baris Parameter Pengukuran selagi modal form terbuka — state sementara di luar DB (SAMA
// pola dgn blkRows/addBlocked di 07-rules-planner.js), supaya tombol +/- baris parameter cuma
// re-render kontainer barisnya sendiri (#labParamRows) tanpa menutup/membuka ulang modal dan
// kehilangan isian field lain yang sudah diketik di form yang sama.
let labDraftParameters = [];
function labParameterRowsHtml(){
  if(!labDraftParameters.length) return `<div class="hint" style="padding:4px 0;">Belum ada parameter — klik "+ Tambah Parameter".</div>`;
  return `<table style="width:100%;"><tbody>${labDraftParameters.map((row,i)=>`
    <tr>
      <td style="width:46%;"><input type="text" list="labParamSuggestions" class="labParamNama" data-idx="${i}" value="${escHtml(row.nama)}" placeholder="mis. NITROGEN OKSIDA (NOX) - MG/NM3" style="width:100%;border:1px solid var(--gray-300);border-radius:6px;padding:6px 8px;font:inherit;"></td>
      <td style="width:46%;"><input type="text" class="labParamMetode" data-idx="${i}" value="${escHtml(row.metode)}" placeholder="mis. SNI 7119.10:2011" style="width:100%;border:1px solid var(--gray-300);border-radius:6px;padding:6px 8px;font:inherit;"></td>
      <td style="width:8%;text-align:right;"><button type="button" class="btn small danger" data-action="removeLabParamRow" data-idx="${i}">&times;</button></td>
    </tr>`).join("")}</tbody></table>`;
}
function renderLabParamRows(){
  const el = document.getElementById("labParamRows");
  if(el) el.innerHTML = labParameterRowsHtml();
}
function syncLabDraftParametersFromDom(){
  document.querySelectorAll(".labParamNama").forEach(inp=>{ const i=Number(inp.dataset.idx); if(labDraftParameters[i]) labDraftParameters[i].nama = inp.value.trim(); });
  document.querySelectorAll(".labParamMetode").forEach(inp=>{ const i=Number(inp.dataset.idx); if(labDraftParameters[i]) labDraftParameters[i].metode = inp.value.trim(); });
}
function addLabParamRow(){
  syncLabDraftParametersFromDom();
  labDraftParameters.push({nama:"", metode:""});
  renderLabParamRows();
}
function removeLabParamRow(t){
  syncLabDraftParametersFromDom();
  labDraftParameters.splice(Number(t.dataset.idx),1);
  renderLabParamRows();
}
function labLampiranFieldHtml(kind, l){
  const idKey = kind.key+"Id", fnKey = kind.key+"Filename";
  const downloadBtn = l[idKey] ? ` <button type="button" class="btn small ghost" data-action="downloadLaboratoriumLampiran" data-id="${escHtml(l.id)}" data-kind="${kind.key}">Download</button>` : "";
  return `<div class="field" style="margin-top:10px;"><label>${escHtml(kind.label)} (PDF, maks ${(LAB_LAMPIRAN_MAX_BYTES/1024/1024).toFixed(0)}MB)</label>
    <input type="file" id="lab_${kind.key}File" accept="application/pdf">
    <div class="hint" style="margin-top:4px;">${l[idKey]?`File saat ini: <b>${escHtml(l[fnKey]||"lampiran")}</b> — pilih file baru utk mengganti.${downloadBtn}`:"Belum ada lampiran."}</div>
  </div>`;
}
function laboratoriumFormHtml(l){
  l = l || {id:"", nama:"", alamat:"", provinsi:"", kabkota:"", telepon:"", fax:"", email:"",
    scopeEmisi:false, scopeAmbien:false,
    kanNoAkreditasi:"", kanMulaiBerlaku:"", kanHabisBerlaku:"",
    klhNoRegistrasi:"", klhMulaiBerlaku:"", klhHabisBerlaku:"", parameters:[]};
  labDraftParameters = (l.parameters||[]).map(p=>({...p}));
  return `
  <h3>${l.id?"Edit":"Tambah"} Laboratorium</h3>
  <div class="grid cols-2">
    <div class="field"><label>Nama Laboratorium</label><input type="text" id="lab_nama" value="${escHtml(l.nama)}" placeholder="mis. PT Sucofindo (Persero) - Cabang Balikpapan"></div>
    <div class="field"><label>Alamat</label><input type="text" id="lab_alamat" value="${escHtml(l.alamat)}"></div>
  </div>
  <div class="grid cols-2" style="margin-top:10px;">
    <div class="field"><label>Provinsi</label><select id="lab_provinsi"><option value="">- pilih -</option>${PROVINSI_INDONESIA.map(p=>`<option ${l.provinsi===p?"selected":""}>${escHtml(p)}</option>`).join("")}</select></div>
    <div class="field"><label>Kabupaten/Kota</label><input type="text" id="lab_kabkota" value="${escHtml(l.kabkota)}" placeholder="mis. Kota Balikpapan"></div>
  </div>
  <div class="grid cols-3" style="margin-top:10px;">
    <div class="field"><label>Telepon</label><input type="text" id="lab_telepon" value="${escHtml(l.telepon)}"></div>
    <div class="field"><label>Fax</label><input type="text" id="lab_fax" value="${escHtml(l.fax)}"></div>
    <div class="field"><label>Email</label><input type="email" id="lab_email" value="${escHtml(l.email)}"></div>
  </div>
  <div class="field" style="margin-top:10px;"><label>Lingkup Sampling yang Dicakup</label>
    <div class="grid cols-2">
      <label class="checkline"><input type="checkbox" id="lab_scopeEmisi" ${l.scopeEmisi?"checked":""}> Sampling Emisi</label>
      <label class="checkline"><input type="checkbox" id="lab_scopeAmbien" ${l.scopeAmbien?"checked":""}> Sampling Ambien</label>
    </div>
  </div>
  <div class="card" style="margin-top:14px;padding:12px 14px;">
    <h4 style="margin:0 0 8px;">Akreditasi KAN (ISO/IEC 17025)</h4>
    <div class="grid cols-3">
      <div class="field"><label>No. Akreditasi</label><input type="text" id="lab_kanNoAkreditasi" value="${escHtml(l.kanNoAkreditasi)}"></div>
      <div class="field"><label>Mulai Berlaku</label><input type="date" id="lab_kanMulaiBerlaku" value="${l.kanMulaiBerlaku||""}"></div>
      <div class="field"><label>Habis Berlaku</label><input type="date" id="lab_kanHabisBerlaku" value="${l.kanHabisBerlaku||""}"></div>
    </div>
    ${labLampiranFieldHtml(LAB_LAMPIRAN_KINDS[0], l)}
  </div>
  <div class="card" style="margin-top:10px;padding:12px 14px;">
    <h4 style="margin:0 0 8px;">Registrasi Laboratorium Lingkungan (KLH)</h4>
    <div class="grid cols-3">
      <div class="field"><label>No. Registrasi</label><input type="text" id="lab_klhNoRegistrasi" value="${escHtml(l.klhNoRegistrasi)}"></div>
      <div class="field"><label>Mulai Berlaku</label><input type="date" id="lab_klhMulaiBerlaku" value="${l.klhMulaiBerlaku||""}"></div>
      <div class="field"><label>Habis Berlaku</label><input type="date" id="lab_klhHabisBerlaku" value="${l.klhHabisBerlaku||""}"></div>
    </div>
    ${labLampiranFieldHtml(LAB_LAMPIRAN_KINDS[1], l)}
    ${labLampiranFieldHtml(LAB_LAMPIRAN_KINDS[2], l)}
  </div>
  <div class="field" style="margin-top:14px;">
    <div class="toolbar" style="padding:0;margin-bottom:6px;"><label style="margin:0;">Parameter Pengukuran</label><span class="spacer"></span><button type="button" class="btn small" data-action="addLabParamRow">+ Tambah Parameter</button></div>
    <div class="hint" style="margin-bottom:6px;">Nama parameter bisa dipilih dari saran atau diisi manual; kolom Metode/Acuan diisi bebas (mis. nomor SNI).</div>
    <datalist id="labParamSuggestions">${LAB_PARAMETER_SUGGESTIONS.map(s=>`<option value="${escHtml(s)}">`).join("")}</datalist>
    <div id="labParamRows">${labParameterRowsHtml()}</div>
  </div>
  <div class="actions">
    <button class="btn ghost" data-action="closeModal">Batal</button>
    <button class="btn primary" data-action="saveLaboratoriumBtn" data-id="${l.id}">Simpan</button>
  </div>`;
}
function addLaboratorium(){ openModal(laboratoriumFormHtml(null), {wide:true, scrollBody:true}); }
function editLaboratorium(id){
  const l = ensureLaboratoriumArr().find(x=>x.id===id);
  if(l) openModal(laboratoriumFormHtml(l), {wide:true, scrollBody:true});
}
async function saveLaboratorium(id){
  const nama = document.getElementById("lab_nama").value.trim();
  if(!nama){ toast("Nama laboratorium wajib diisi.","err"); return; }
  // Validasi ukuran SEMUA file yang dipilih dulu sebelum mulai menulis apapun ke IndexedDB — supaya
  // tidak ada kondisi "2 dari 3 lampiran kesimpan, yang ke-3 ditolak" yang membingungkan.
  for(const kind of LAB_LAMPIRAN_KINDS){
    const inp = document.getElementById(`lab_${kind.key}File`);
    const file = inp && inp.files[0];
    if(file && file.size > LAB_LAMPIRAN_MAX_BYTES){
      toast(`${kind.label}: file terlalu besar (maks ${(LAB_LAMPIRAN_MAX_BYTES/1024/1024).toFixed(0)}MB) — kompres dulu file-nya.`, "err");
      return;
    }
  }
  syncLabDraftParametersFromDom();
  const parameters = labDraftParameters.filter(p=>p.nama);
  const val = {
    nama, alamat: document.getElementById("lab_alamat").value.trim(),
    provinsi: document.getElementById("lab_provinsi").value, kabkota: document.getElementById("lab_kabkota").value.trim(),
    telepon: document.getElementById("lab_telepon").value.trim(), fax: document.getElementById("lab_fax").value.trim(),
    email: document.getElementById("lab_email").value.trim(),
    scopeEmisi: document.getElementById("lab_scopeEmisi").checked, scopeAmbien: document.getElementById("lab_scopeAmbien").checked,
    kanNoAkreditasi: document.getElementById("lab_kanNoAkreditasi").value.trim(),
    kanMulaiBerlaku: document.getElementById("lab_kanMulaiBerlaku").value, kanHabisBerlaku: document.getElementById("lab_kanHabisBerlaku").value,
    klhNoRegistrasi: document.getElementById("lab_klhNoRegistrasi").value.trim(),
    klhMulaiBerlaku: document.getElementById("lab_klhMulaiBerlaku").value, klhHabisBerlaku: document.getElementById("lab_klhHabisBerlaku").value,
    parameters
  };
  const existing = id ? ensureLaboratoriumArr().find(x=>x.id===id) : null;
  // Upload tiap lampiran yang DIGANTI (file baru dipilih) — yang tidak disentuh tetap pakai Id/
  // Filename/Mime lama dari existing (atau kosong kalau record baru).
  for(const kind of LAB_LAMPIRAN_KINDS){
    const idKey = kind.key+"Id", fnKey = kind.key+"Filename", mimeKey = kind.key+"Mime";
    val[idKey] = existing ? existing[idKey] : "";
    val[fnKey] = existing ? existing[fnKey] : "";
    val[mimeKey] = existing ? existing[mimeKey] : "";
    const inp = document.getElementById(`lab_${kind.key}File`);
    const file = inp && inp.files[0];
    if(!file) continue;
    let dataUrl;
    try{
      dataUrl = await new Promise((resolve,reject)=>{
        const reader = new FileReader();
        reader.onload = ()=>resolve(reader.result);
        reader.onerror = ()=>reject(new Error(`Gagal membaca file ${kind.label}.`));
        reader.readAsDataURL(file);
      });
    }catch(err){ toast(err.message,"err"); return; }
    const oldId = val[idKey];
    const newId = uid("LABL");
    try{
      await labLampiranIdbPut(newId, dataUrl);
    }catch(err){
      toast(`Gagal menyimpan ${kind.label} ke penyimpanan (IndexedDB): `+err.message, "err");
      return;
    }
    val[idKey] = newId;
    val[fnKey] = sanitizeLabFilename(file.name);
    val[mimeKey] = file.type || "application/pdf";
    if(oldId) labLampiranIdbDelete(oldId).catch(()=>{});
  }
  if(id && existing){ Object.assign(existing, val); }
  else { ensureLaboratoriumArr().push({id: uid("LAB"), createdAt: new Date().toISOString(), ...val}); }
  save(); closeModal(); renderLaboratorium();
  toast(id?"Data laboratorium diperbarui.":"Laboratorium ditambahkan.", "ok");
}
function deleteLaboratorium(id){
  const l = ensureLaboratoriumArr().find(x=>x.id===id);
  if(!l) return;
  askConfirm(`Hapus data laboratorium "${l.nama}" ini? Semua lampirannya (sertifikat/registrasi/rujukan) juga akan ikut terhapus.`, async ()=>{
    for(const kind of LAB_LAMPIRAN_KINDS){
      const idVal = l[kind.key+"Id"];
      if(idVal){ try{ await labLampiranIdbDelete(idVal); }catch(e){ /* metadata tetap dihapus walau blob gagal dihapus */ } }
    }
    DB.laboratorium = DB.laboratorium.filter(x=>x.id!==id);
    save(); renderLaboratorium();
    toast("Laboratorium dihapus.","ok");
  });
}
async function downloadLaboratoriumLampiran(t){
  const id = t.dataset.id, kindKey = t.dataset.kind;
  const l = ensureLaboratoriumArr().find(x=>x.id===id);
  const kind = LAB_LAMPIRAN_KINDS.find(k=>k.key===kindKey);
  if(!l || !kind) return;
  const idVal = l[kindKey+"Id"];
  if(!idVal) return;
  let dataUrl;
  try{ dataUrl = await labLampiranIdbGet(idVal); }
  catch(e){ toast("Gagal membaca lampiran dari penyimpanan.","err"); return; }
  if(!dataUrl){ toast("File lampiran tidak ditemukan di penyimpanan (mungkin sudah terhapus).","err"); return; }
  const filename = l[kindKey+"Filename"] || sanitizeLabFilename(l.nama+"_"+kind.key+".pdf");
  downloadDataUrl(dataUrl, filename);
}

Object.assign(ACTIONS, {
  addLaboratorium,
  editLaboratorium:(t)=>editLaboratorium(t.dataset.id),
  saveLaboratoriumBtn:(t)=>saveLaboratorium(t.dataset.id),
  deleteLaboratoriumBtn:(t)=>deleteLaboratorium(t.dataset.id),
  downloadLaboratoriumLampiran,
  addLabParamRow,
  removeLabParamRow
});
