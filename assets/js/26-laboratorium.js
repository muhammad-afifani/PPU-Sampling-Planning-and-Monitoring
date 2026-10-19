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

/* ---------- Katalog parameter pemantauan (baris matriks cakupan) ---------- */
// Parameter yang BENAR-BENAR dipantau aplikasi ini (hasil emisi & ambien) — dipakai sbg baris
// matriks "parameter mana dikerjakan lab mana". Parameter bebas yg diketik di form lab dicocokkan ke
// katalog ini lewat regex (otomatis) atau dipilih manual per baris (linkKey).
const LAB_KATEGORI = [
  {key:"emisi", label:"Emisi"},
  {key:"ambien", label:"Udara Ambien"},
  {key:"kebisingan", label:"Kebisingan"},
  {key:"kebauan", label:"Kebauan"},
  {key:"getaran", label:"Getaran"},
  {key:"lain", label:"Lainnya"}
];
const LAB_KATEGORI_LABEL = Object.fromEntries(LAB_KATEGORI.map(k=>[k.key,k.label]));
const LAB_CATALOG_STATIC = [
  ["emisi","Opasitas",/opasitas|opacity|ringelmann/],
  ["emisi","NOx",/\bnox\b|nitrogen oksida|nitrogen oxide/],
  ["emisi","SO₂",/\bso2\b|sulfur dioksida|sulphur dioxide|sulfur dioxide/],
  ["emisi","CO",/\bco\b|karbon monoksida|carbon monoxide/],
  ["emisi","Total Partikulat",/partikulat|particulate|\btsp\b|debu|dust/],
  ["emisi","H2S",/\bh2s\b|hidrogen sulfida|hydrogen sulfide/],
  ["emisi","CO₂",/\bco2\b|karbon dioksida|carbon dioxide/],
  ["emisi","O₂",/\bo2\b|oksigen|oxygen/],
  ["emisi","Gas Temperatur",/temperatur|temperature|suhu/],
  ["emisi","Laju Alir (v)",/laju alir|flow ?rate|velocity|kecepatan alir/],
  ["ambien","PM2.5",/pm\s?2[.,]?5/],
  ["ambien","PM10",/pm\s?10/],
  ["ambien","Sulfur Dioxide (SO2)",/\bso2\b|sulfur dioksida|sulfur dioxide/],
  ["ambien","Carbon Monoxide (CO)",/\bco\b|karbon monoksida|carbon monoxide/],
  ["ambien","Nitrogen Dioxide (NOx)",/\bno2\b|\bnox\b|nitrogen dioksida|nitrogen dioxide/],
  ["ambien","Oxidant (O3)",/\bo3\b|oksidan|oxidant|ozon/],
  ["ambien","Non Methane Hydrocarbon (NMHC)",/nmhc|hidrokarbon|hydrocarbon|\bhc\b/],
  ["ambien","TSP (Dust)",/\btsp\b|debu|dust|total suspended|partikulat/],
  ["ambien","Lead (Pb)",/\bpb\b|timbal|lead/],
  ["kebisingan","Kebisingan (Noise Level)",/bising|noise|\bdb ?\(?a\)?/],
  ["kebauan","Ammonia (NH3)",/\bnh3\b|amonia|ammonia/],
  ["kebauan","Hydrogen Sulfide (H2S)",/\bh2s\b|hidrogen sulfida|hydrogen sulfide/],
  ["kebauan","Methyl Mercaptant",/mercapt|merkaptan/],
  ["kebauan","Methyl Sulfide",/methyl sulfide|metil sulfida/],
  ["kebauan","Styrene",/styrene|stiren/],
  ["kebauan","Kebauan (Odour)",/kebauan|\bbau\b|odou?r/],
  ["getaran","Getaran (Vibration)",/getar|vibra/]
];
function labNormText(s){
  return String(s||"").toLowerCase().replace(/₂/g,"2").replace(/₃/g,"3").replace(/₅/g,"5").replace(/[µμ]/g,"u").replace(/\s+/g," ");
}
let labCatalogCache = null, labCatalogSig = "";
// Katalog = daftar statis + parameter lain yg muncul di data hasil (supaya parameter baru yg
// ditambahkan ke hasil pemantauan otomatis ikut jadi baris matriks, tanpa perlu ubah kode).
function labCatalog(){
  const emi = Array.isArray(DB.hasilPemantauan) ? [...new Set(DB.hasilPemantauan.map(h=>h.parameter).filter(Boolean))] : [];
  const amb = DB.hasilAmbien && typeof DB.hasilAmbien==="object" ? DB.hasilAmbien : {};
  const ambBy = {};
  ["ambien","kebauan"].forEach(k=>{ ambBy[k] = Array.isArray(amb[k]) ? [...new Set(amb[k].map(h=>h.parameter).filter(Boolean))] : []; });
  const sig = emi.join("|")+"#"+ambBy.ambien.join("|")+"#"+ambBy.kebauan.join("|");
  if(labCatalogCache && sig===labCatalogSig) return labCatalogCache;
  const list = LAB_CATALOG_STATIC.map(([kategori,label,re])=>({key:kategori+"::"+label, kategori, label, re}));
  const has = new Set(list.map(p=>p.key));
  const addDyn = (kategori, label)=>{
    const key = kategori+"::"+label;
    if(has.has(key)) return;
    has.add(key);
    list.push({key, kategori, label, re:new RegExp(labNormText(label).replace(/[.*+?^${}()|[\]\\]/g,"\\$&"))});
  };
  emi.forEach(p=>addDyn("emisi", p));
  ambBy.ambien.forEach(p=>addDyn("ambien", p));
  ambBy.kebauan.forEach(p=>addDyn("kebauan", p));
  labCatalogCache = list; labCatalogSig = sig;
  return list;
}
function labCatalogByKey(key){ return labCatalog().find(p=>p.key===key) || null; }
// Kategori otomatis dari nama + satuan yg diketik (mis. "... - MG/NM3" = emisi, "UG/NM3" = ambien).
function labDetectKategori(nama){
  const t = labNormText(nama);
  if(!t.trim()) return "";
  if(/getar|vibra|mm\/s/.test(t)) return "getaran";
  if(/bising|noise|db ?\(?a\)?/.test(t)) return "kebisingan";
  if(/kebauan|\bbau\b|odou?r|mercapt|merkaptan|styrene|stiren|metil sulfida|methyl sulfide|\bnh3\b|amonia|ammonia/.test(t)) return "kebauan";
  if(/ambien|ambient|ug\/n?m3|pm\s?10|pm\s?2[.,]?5|oksidan|\bo3\b|timbal|\bpb\b|nmhc/.test(t)) return "ambien";
  if(/mg\/n?m3|opasitas|laju alir|temperatur|\bo2\b|oksigen|\bnox\b|cerobong|stack|emisi/.test(t)) return "emisi";
  return "";
}
function labParamKategori(p){ return p.kategori || labDetectKategori(p.nama) || "lain"; }
function labAutoLink(nama, kategori){
  const t = labNormText(nama);
  if(!t.trim()) return null;
  const hit = labCatalog().find(c=>c.kategori===kategori && c.re.test(t));
  return hit ? hit.key : null;
}
// Kunci katalog yg terhubung dgn 1 baris parameter lab: manual (linkKey) > otomatis; "__none" = sengaja tidak dihubungkan.
function labParamLinkKey(p){
  if(p.linkKey==="__none") return null;
  if(p.linkKey) return p.linkKey;
  return labAutoLink(p.nama, labParamKategori(p));
}

/* ---------- Status dokumen & helper tampilan ---------- */
function ensureLaboratoriumArr(){ if(!Array.isArray(DB.laboratorium)) DB.laboratorium = []; return DB.laboratorium; }
function labDaysLeft(habis){ return habis ? Math.round((new Date(habis+"T00:00:00")-new Date(new Date().toDateString()))/86400000) : null; }
function labStatusBerlaku(habisBerlaku){
  if(!habisBerlaku) return null;
  const days = labDaysLeft(habisBerlaku);
  if(days<0) return {key:"expired", text:"Kedaluwarsa", color:"#b42318", days};
  if(days<=90) return {key:"soon", text:`${days} hari lagi`, color:"#c2620a", days};
  return {key:"ok", text:"Berlaku", color:"#146c43", days};
}
function labDocValid(l, which){
  const no = which==="kan" ? l.kanNoAkreditasi : l.klhNoRegistrasi;
  const st = labStatusBerlaku(which==="kan" ? l.kanHabisBerlaku : l.klhHabisBerlaku);
  return !!no && (!st || st.key!=="expired");
}
function labFmtDate(d){ return d ? new Date(d+"T00:00:00").toLocaleDateString("id-ID",{day:"numeric",month:"short",year:"numeric"}) : "-"; }
function labShortName(l){
  const n = String(l.nama||"").replace(/^(PT|CV|PD|UPT|UPTD)\.?\s+/i,"").replace(/\s*\(Persero\)/i,"");
  return n.length>22 ? n.slice(0,21)+"…" : n;
}
function labInitials(l){
  const words = String(l.nama||"?").replace(/^(PT|CV|PD|UPT|UPTD)\.?\s+/i,"").split(/[\s()\-]+/).filter(Boolean);
  return ((words[0]||"?")[0] + ((words[1]||"")[0]||"")).toUpperCase();
}
const LAB_AVATAR_COLORS = ["#12294a","#0e7c74","#7a4bb8","#c2620a","#3d78c9","#8a5c11","#b42318"];
function labAvatarHtml(l, size){
  size = size || 44;
  if(l.logoDataUrl) return `<span class="lab-logo" style="width:${size}px;height:${size}px;"><img src="${l.logoDataUrl}" alt="Logo ${escHtml(l.nama)}"></span>`;
  const idx = [...String(l.nama||"")].reduce((a,c)=>a+c.charCodeAt(0),0) % LAB_AVATAR_COLORS.length;
  return `<span class="lab-logo lab-logo-ini" style="width:${size}px;height:${size}px;background:${LAB_AVATAR_COLORS[idx]};font-size:${Math.round(size*0.36)}px;">${escHtml(labInitials(l))}</span>`;
}
// Bar masa berlaku: posisi hari ini di antara tanggal mulai & habis berlaku.
function labValidityHtml(l, which){
  const no = which==="kan" ? l.kanNoAkreditasi : l.klhNoRegistrasi;
  const mulai = which==="kan" ? l.kanMulaiBerlaku : l.klhMulaiBerlaku;
  const habis = which==="kan" ? l.kanHabisBerlaku : l.klhHabisBerlaku;
  const title = which==="kan" ? "Akreditasi KAN" : "Registrasi KLH";
  const docKind = which==="kan" ? "sertifikat" : "suratRegistrasi";
  if(!no) return `<div class="lab-doc empty"><div class="lab-doc-head"><b>${title}</b><span class="lab-st st-none">Belum ada</span></div><div class="lab-doc-no">Nomor belum diisi</div></div>`;
  const st = labStatusBerlaku(habis);
  let pct = null;
  if(mulai && habis){ const a = new Date(mulai), b = new Date(habis); pct = Math.max(0, Math.min(100, (Date.now()-a)/(b-a)*100)); }
  return `<div class="lab-doc"><div class="lab-doc-head"><b>${title}</b>${st?`<span class="lab-st st-${st.key}">${st.text}</span>`:`<span class="lab-st st-none">Tanpa tanggal</span>`}</div>
    <div class="lab-doc-no mono">${escHtml(no)}${l[docKind+"Id"]?` <button type="button" class="lab-doc-dl" data-action="downloadLaboratoriumLampiran" data-id="${escHtml(l.id)}" data-kind="${docKind}" title="Unduh ${escHtml(title)} (PDF)">PDF</button>`:""}</div>
    ${pct!=null?`<div class="lab-doc-bar"><i class="st-${st?st.key:"ok"}" style="width:${pct.toFixed(1)}%"></i></div>`:""}
    <div class="lab-doc-dates"><span>${labFmtDate(mulai)}</span><span>s/d ${labFmtDate(habis)}</span></div></div>`;
}
function labMatchesFilter(l){
  const q = document.getElementById("labFltSearch");
  const term = q && q.value.trim().toLowerCase();
  if(term && !(l.nama||"").toLowerCase().includes(term) && !(l.parameters||[]).some(p=>(p.nama||"").toLowerCase().includes(term))) return false;
  const scope = document.getElementById("labFltScope");
  if(scope && scope.value==="emisi" && !l.scopeEmisi) return false;
  if(scope && scope.value==="ambien" && !l.scopeAmbien) return false;
  return true;
}
function labScopeBadgesHtml(l){
  const badges = [];
  if(l.scopeEmisi) badges.push(`<span class="lab-chip emi">Emisi</span>`);
  if(l.scopeAmbien) badges.push(`<span class="lab-chip amb">Ambien</span>`);
  return badges.join("") || '<span class="lab-chip none">Lingkup belum diisi</span>';
}

/* ---------- Rekap cakupan parameter (lab x parameter pemantauan) ---------- */
// Per parameter katalog: lab mana yg mengerjakan, apakah parameter itu masuk ruang lingkup KAN/KLH
// lab tsb (centang per baris parameter) DAN dokumen lab-nya masih berlaku, serta apakah analisisnya
// disubkon ke lab lain. Satu sumber angka utk KPI, kartu lab & matriks.
function labCoverage(labs){
  const byKey = {};
  labs.forEach(l=>{
    (l.parameters||[]).forEach(p=>{
      const key = labParamLinkKey(p);
      if(!key) return;
      const kan = !!p.kan && labDocValid(l,"kan"), klh = !!p.klh && labDocValid(l,"klh");
      const cell = {lab:l, p, kan, klh, kanFlag:!!p.kan, klhFlag:!!p.klh, analisisLab: p.analisisLabId ? ensureLaboratoriumArr().find(x=>x.id===p.analisisLabId)||null : null};
      (byKey[key] = byKey[key] || {}); 
      const prev = byKey[key][l.id];
      // 1 lab bisa menulis parameter yg sama 2x (mis. beda metode) — ambil yg status dokumennya terbaik.
      if(!prev || (cell.kan+cell.klh) > (prev.kan+prev.klh)) byKey[key][l.id] = cell;
    });
  });
  return byKey;
}
function labParamStatus(cells){
  const list = Object.values(cells||{});
  if(!list.length) return {key:"none", label:"Belum ada lab", color:"#b42318"};
  if(list.some(c=>c.kan && c.klh)) return {key:"full", label:"KAN + KLH", color:"#146c43"};
  if(list.some(c=>c.kan)) return {key:"kan", label:"KAN saja", color:"#8a6d1a"};
  if(list.some(c=>c.klh)) return {key:"klh", label:"KLH saja", color:"#8a6d1a"};
  return {key:"noacc", label:"Belum terakreditasi", color:"#c2620a"};
}
function labCatsInUse(){
  const cat = labCatalog();
  return LAB_KATEGORI.filter(k=>k.key!=="lain" && cat.some(p=>p.kategori===k.key));
}

function labKpisHtml(labs){
  const all = ensureLaboratoriumArr();
  const cov = labCoverage(all);
  const cat = labCatalog();
  const covered = cat.filter(p=>cov[p.key] && Object.keys(cov[p.key]).length);
  const full = cat.filter(p=>labParamStatus(cov[p.key]).key==="full");
  const sub = all.reduce((a,l)=>a+(l.parameters||[]).filter(p=>p.analisisLabId).length,0);
  const docInfo = (which)=>{
    const withNo = all.filter(l=>which==="kan"?l.kanNoAkreditasi:l.klhNoRegistrasi);
    const valid = withNo.filter(l=>labDocValid(l,which));
    const upcoming = withNo.map(l=>({l, d:labDaysLeft(which==="kan"?l.kanHabisBerlaku:l.klhHabisBerlaku)})).filter(x=>x.d!=null).sort((a,b)=>a.d-b.d)[0];
    const expired = withNo.length - valid.length;
    const soon = withNo.filter(l=>{ const s = labStatusBerlaku(which==="kan"?l.kanHabisBerlaku:l.klhHabisBerlaku); return s && s.key==="soon"; }).length;
    return {withNo, valid, upcoming, expired, soon};
  };
  const kan = docInfo("kan"), klh = docInfo("klh");
  const docFoot = (x)=> x.upcoming ? (x.upcoming.d<0 ? `${escHtml(labShortName(x.upcoming.l))} kedaluwarsa ${-x.upcoming.d} hari lalu` : `terdekat habis: ${escHtml(labShortName(x.upcoming.l))} &middot; ${x.upcoming.d} hari lagi`) : "belum ada tanggal habis berlaku";
  const pct = (a,b)=> b ? Math.round(a/b*100) : 0;
  return [
    hdKpi({label:"Laboratorium Mitra", icon:HD_IC.db, value:all.length, foot:`${all.filter(l=>l.scopeEmisi).length} lingkup emisi &middot; ${all.filter(l=>l.scopeAmbien).length} lingkup ambien`}),
    hdKpi({label:"Akreditasi KAN Berlaku", icon:HD_IC.shield, tone: kan.expired?"bad":kan.soon?"warn":kan.valid.length?"good":"", value:kan.valid.length, suffix:` / ${all.length}`, foot:docFoot(kan)}),
    hdKpi({label:"Registrasi KLH Berlaku", icon:HD_IC.shield, tone: klh.expired?"bad":klh.soon?"warn":klh.valid.length?"good":"", value:klh.valid.length, suffix:` / ${all.length}`, foot:docFoot(klh)}),
    hdKpi({label:"Parameter Pemantauan Tercakup", icon:HD_IC.gauge, tone: covered.length<cat.length?"warn":"good", value:covered.length, suffix:` / ${cat.length}`, foot:`${cat.length-covered.length} parameter belum ada lab yang mengerjakan`}),
    hdKpi({label:"Tercakup KAN + KLH", icon:HD_IC.spark, value:pct(full.length,cat.length)+"%", foot:`${full.length} parameter diuji lab dgn akreditasi KAN &amp; registrasi KLH berlaku`}),
    hdKpi({label:"Analisis di Lab Lain", icon:HD_IC.trend, value:sub, suffix:" parameter", foot: sub?"disubkontrakkan ke laboratorium lain (lihat matriks)":"semua parameter dianalisis di lab sendiri"})
  ].join("");
}
function labCardHtml(l, cov){
  const params = l.parameters||[];
  const byCat = {};
  params.forEach(p=>{ const k = labParamKategori(p); byCat[k] = (byCat[k]||0)+1; });
  const linked = new Set(params.map(labParamLinkKey).filter(Boolean));
  const kanN = params.filter(p=>p.kan).length, klhN = params.filter(p=>p.klh).length, subN = params.filter(p=>p.analisisLabId).length;
  const docs = LAB_LAMPIRAN_KINDS.map(k=>`<span class="lab-docdot ${l[k.key+"Id"]?"on":""}" title="${escHtml(k.label)}: ${l[k.key+"Id"]?"terlampir":"belum ada"}"></span>`).join("");
  return `<article class="lab-card">
    <div class="lab-card-top">
      ${labAvatarHtml(l, 52)}
      <div class="lab-card-id"><h4>${escHtml(l.nama)}</h4>
        <div class="lab-card-loc">${escHtml([l.kabkota, l.provinsi].filter(Boolean).join(", ")||"Lokasi belum diisi")}</div>
        <div class="lab-chips">${labScopeBadgesHtml(l)}</div></div>
      <div class="lab-card-act"><button class="btn small" data-action="editLaboratorium" data-id="${l.id}">Edit</button><button class="btn small ghost lab-del" data-action="deleteLaboratoriumBtn" data-id="${l.id}" title="Hapus laboratorium" aria-label="Hapus laboratorium">&times;</button></div>
    </div>
    <div class="lab-docs">${labValidityHtml(l,"kan")}${labValidityHtml(l,"klh")}</div>
    <div class="lab-card-stats">
      <div><b>${params.length}</b><span>parameter</span></div>
      <div><b>${linked.size}</b><span>terkait pemantauan</span></div>
      <div><b>${kanN}</b><span>lingkup KAN</span></div>
      <div><b>${klhN}</b><span>lingkup KLH</span></div>
      ${subN?`<div class="warn"><b>${subN}</b><span>dianalisis lab lain</span></div>`:""}
    </div>
    <div class="lab-card-foot">
      <div class="lab-catbar">${Object.entries(byCat).map(([k,n])=>`<span class="lab-cat c-${k}">${escHtml(LAB_KATEGORI_LABEL[k]||k)} ${n}</span>`).join("") || '<span class="muted">Belum ada parameter</span>'}</div>
      <div class="lab-card-meta"><span class="lab-docdots" title="Lampiran: Sertifikat KAN, Surat Registrasi KLH, Rujukan Gubernur">${docs}</span>${l.telepon?`<span>${escHtml(l.telepon)}</span>`:""}${l.email?`<span>${escHtml(l.email)}</span>`:""}</div>
    </div>
  </article>`;
}
let labMatrixCat = "emisi";
function labMatrixHtml(labs){
  const cats = labCatsInUse();
  if(!cats.some(c=>c.key===labMatrixCat)) labMatrixCat = (cats[0]||{key:"emisi"}).key;
  const all = ensureLaboratoriumArr();
  const cov = labCoverage(all);
  const rowsAll = labCatalog();
  const tabs = cats.map(c=>{
    const list = rowsAll.filter(p=>p.kategori===c.key);
    const n = list.filter(p=>cov[p.key] && Object.keys(cov[p.key]).length).length;
    return `<button type="button" class="${c.key===labMatrixCat?"on":""}" aria-pressed="${c.key===labMatrixCat}" data-action="labSetMatrixCat" data-val="${c.key}">${escHtml(c.label)} <small>${n}/${list.length}</small></button>`;
  }).join("");
  const rows = rowsAll.filter(p=>p.kategori===labMatrixCat);
  const cols = labs;
  if(!all.length) return `<div class="hd-seg-group lab-tabs">${tabs}</div>${hdEmpty('Belum ada laboratorium. Klik "+ Tambah Laboratorium", isi parameter yang dikerjakan, lalu matriks ini terisi otomatis.')}`;
  const head = `<tr><th class="lab-mx-param">Parameter pemantauan</th>${cols.map(l=>`<th class="lab-mx-lab"><div>${labAvatarHtml(l,26)}<span title="${escHtml(l.nama)}">${escHtml(labShortName(l))}</span></div></th>`).join("")}<th>Status cakupan</th></tr>`;
  const body = rows.map(p=>{
    const cells = cov[p.key]||{};
    const st = labParamStatus(cells);
    return `<tr><td class="lab-mx-param"><b>${escHtml(p.label)}</b></td>${cols.map(l=>{
      const c = cells[l.id];
      if(!c) return `<td class="lab-mx-cell none"><span>—</span></td>`;
      const tag = (on, flag, label)=> on ? `<span class="lab-acc ok" title="${label} — masuk ruang lingkup &amp; dokumen berlaku">${label}</span>` : flag ? `<span class="lab-acc exp" title="${label} dicentang tapi dokumen lab tidak berlaku/kosong">${label}</span>` : `<span class="lab-acc off" title="Tidak masuk ruang lingkup ${label}">${label}</span>`;
      return `<td class="lab-mx-cell yes"><div><span class="lab-mx-check" title="${escHtml(c.p.nama)}${c.p.metode?" · "+escHtml(c.p.metode):""}">&#10003;</span>${tag(c.kan,c.kanFlag,"KAN")}${tag(c.klh,c.klhFlag,"KLH")}</div>${c.analisisLab?`<div class="lab-mx-sub" title="Sampling oleh ${escHtml(l.nama)}, analisis di ${escHtml(c.analisisLab.nama)}">&rarr; ${escHtml(labShortName(c.analisisLab))}</div>`:""}${c.p.metode?`<div class="lab-mx-met">${escHtml(c.p.metode)}</div>`:""}</td>`;
    }).join("")}<td><span class="lab-status" style="--c:${st.color}">${st.label}</span></td></tr>`;
  }).join("");
  // Parameter yg diisi di lab tapi tidak terhubung ke parameter pemantauan mana pun (kategori ini).
  const extra = [];
  all.forEach(l=>(l.parameters||[]).forEach(p=>{ if(labParamKategori(p)===labMatrixCat && !labParamLinkKey(p)) extra.push({l,p}); }));
  return `<div class="hd-seg-group lab-tabs" role="group" aria-label="Kategori parameter">${tabs}</div>
    <div class="tablewrap lab-mx-wrap"><table class="dp-table lab-mx"><thead>${head}</thead><tbody>${body || `<tr><td colspan="${cols.length+2}" class="muted" style="text-align:center;padding:16px;">Tidak ada parameter pemantauan di kategori ini.</td></tr>`}</tbody></table></div>
    <div class="lab-mx-legend"><span><span class="lab-mx-check">&#10003;</span> lab mengerjakan parameter</span><span><span class="lab-acc ok">KAN</span> masuk ruang lingkup &amp; dokumen berlaku</span><span><span class="lab-acc exp">KAN</span> dicentang tapi dokumen kedaluwarsa/kosong</span><span><span class="lab-acc off">KAN</span> di luar ruang lingkup</span><span>&rarr; Lab = analisis disubkon ke lab tsb</span></div>
    ${extra.length?`<div class="lab-extra"><b>Parameter lain yang dicatat lab (tidak terhubung ke daftar pemantauan):</b> ${extra.map(({l,p})=>`<span class="lab-extra-chip">${escHtml(p.nama)} <small>${escHtml(labShortName(l))}</small></span>`).join("")}</div>`:""}`;
}
function renderLaboratorium(){
  const host = document.getElementById("labCards");
  if(!host) return;
  const all = ensureLaboratoriumArr();
  const rows = all.filter(labMatchesFilter).slice().sort((a,b)=>a.nama.localeCompare(b.nama));
  const kpiEl = document.getElementById("labKpis");
  if(kpiEl) kpiEl.innerHTML = labKpisHtml(rows);
  const cov = labCoverage(all);
  host.innerHTML = rows.length ? rows.map(l=>labCardHtml(l, cov)).join("")
    : hdEmpty(all.length ? "Tidak ada laboratorium yang cocok dengan filter." : 'Belum ada data laboratorium. Klik "+ Tambah Laboratorium" untuk mulai.');
  const mx = document.getElementById("labMatrix");
  if(mx) mx.innerHTML = labMatrixHtml(rows);
  const countEl = document.getElementById("labCount");
  if(countEl) countEl.textContent = rows.length===all.length ? `${all.length} laboratorium` : `${rows.length} dari ${all.length} laboratorium`;
}
["labFltScope","labFltSearch"].forEach(id=>{
  document.addEventListener("input", e=>{ if(e.target.id===id) renderLaboratorium(); });
  document.addEventListener("change", e=>{ if(e.target.id===id) renderLaboratorium(); });
});
function labSetMatrixCat(t){ labMatrixCat = t.dataset.val; const mx = document.getElementById("labMatrix"); if(mx) mx.innerHTML = labMatrixHtml(ensureLaboratoriumArr().filter(labMatchesFilter).slice().sort((a,b)=>a.nama.localeCompare(b.nama))); }

/* ---------- Form tambah/edit ---------- */
// Draft baris Parameter Pengukuran & logo selagi modal terbuka — state sementara di luar DB (SAMA
// pola dgn blkRows/addBlocked di 07-rules-planner.js), supaya tambah/hapus baris cuma re-render
// kontainer barisnya sendiri (#labParamRows) tanpa kehilangan isian field lain di form yg sama.
// Modal memakai struktur header / body-scroll / footer (.modal.scrollbody) — dulu isi form langsung
// jadi anak .modal.scrollbody (grid overflow:hidden) sehingga bagian bawah terpotong & tidak bisa discroll.
let labDraftParameters = [], labDraftLogo = "", labEditingId = "";
const LAB_LOGO_MAX_INPUT = 2*1024*1024, LAB_LOGO_MAX_PX = 240;
function labKategoriOptionsHtml(row){
  const auto = labDetectKategori(row.nama);
  return `<option value="">Otomatis${auto?` (${escHtml(LAB_KATEGORI_LABEL[auto])})`:""}</option>` + LAB_KATEGORI.map(k=>`<option value="${k.key}" ${row.kategori===k.key?"selected":""}>${escHtml(k.label)}</option>`).join("");
}
function labLinkOptionsHtml(row){
  const kat = labParamKategori(row);
  const auto = labAutoLink(row.nama, kat);
  const autoLbl = auto ? (labCatalogByKey(auto)||{}).label : null;
  const groups = LAB_KATEGORI.filter(k=>k.key!=="lain").map(k=>{
    const list = labCatalog().filter(p=>p.kategori===k.key);
    return list.length ? `<optgroup label="${escHtml(k.label)}">${list.map(p=>`<option value="${escHtml(p.key)}" ${row.linkKey===p.key?"selected":""}>${escHtml(p.label)}</option>`).join("")}</optgroup>` : "";
  }).join("");
  return `<option value="">${autoLbl?`Otomatis: ${escHtml(autoLbl)}`:"Otomatis: tidak ditemukan"}</option><option value="__none" ${row.linkKey==="__none"?"selected":""}>Tidak terkait</option>${groups}`;
}
function labAnalisisOptionsHtml(row){
  const others = ensureLaboratoriumArr().filter(x=>x.id!==labEditingId).sort((a,b)=>a.nama.localeCompare(b.nama));
  return `<option value="">Lab ini</option>${others.map(o=>`<option value="${escHtml(o.id)}" ${row.analisisLabId===o.id?"selected":""}>${escHtml(o.nama)}</option>`).join("")}`;
}
function labParameterRowsHtml(){
  if(!labDraftParameters.length) return `<div class="labf-pempty">Belum ada parameter. Pakai tombol <b>+ Emisi / + Ambien …</b> di atas untuk mengisi cepat dari daftar parameter pemantauan, atau <b>+ Tambah Parameter</b> untuk mengetik manual.</div>`;
  return `<div class="labf-phead"><span>#</span><span>Parameter</span><span>Metode / acuan</span><span>Kategori</span><span>Terkait pemantauan</span><span>Dianalisis di</span><span class="c">KAN</span><span class="c">KLH</span><span></span></div>`
  + labDraftParameters.map((row,i)=>`<div class="labf-prow" data-idx="${i}">
      <span class="labf-pn">${i+1}</span>
      <input type="text" class="labPF" data-idx="${i}" data-f="nama" data-label="Parameter" list="labParamSuggestions" value="${escHtml(row.nama)}" placeholder="mis. NITROGEN OKSIDA (NOX) - MG/NM3" aria-label="Nama parameter">
      <input type="text" class="labPF" data-idx="${i}" data-f="metode" value="${escHtml(row.metode||"")}" placeholder="mis. SNI 7117.10:2011" aria-label="Metode">
      <select class="labPF" data-idx="${i}" data-f="kategori" aria-label="Kategori">${labKategoriOptionsHtml(row)}</select>
      <select class="labPF" data-idx="${i}" data-f="linkKey" aria-label="Terkait parameter pemantauan">${labLinkOptionsHtml(row)}</select>
      <select class="labPF" data-idx="${i}" data-f="analisisLabId" aria-label="Dianalisis di">${labAnalisisOptionsHtml(row)}</select>
      <label class="labf-flag f-kan" title="Parameter masuk ruang lingkup akreditasi KAN"><input type="checkbox" class="labPF" data-idx="${i}" data-f="kan" ${row.kan?"checked":""}><span>KAN</span></label>
      <label class="labf-flag f-klh" title="Parameter masuk registrasi laboratorium lingkungan KLH"><input type="checkbox" class="labPF" data-idx="${i}" data-f="klh" ${row.klh?"checked":""}><span>KLH</span></label>
      <button type="button" class="labf-prm" data-action="removeLabParamRow" data-idx="${i}" title="Hapus baris" aria-label="Hapus baris parameter">&times;</button>
    </div>`).join("");
}
function renderLabParamRows(){
  const el = document.getElementById("labParamRows");
  if(el) el.innerHTML = labParameterRowsHtml();
  labfRefreshSummary();
}
function syncLabDraftParametersFromDom(){
  document.querySelectorAll("#labParamRows .labPF").forEach(inp=>{
    const row = labDraftParameters[Number(inp.dataset.idx)];
    if(!row) return;
    const f = inp.dataset.f;
    row[f] = inp.type==="checkbox" ? inp.checked : (f==="nama"||f==="metode" ? inp.value.trim() : inp.value);
  });
}
function addLabParamRow(){
  syncLabDraftParametersFromDom();
  labDraftParameters.push({nama:"", metode:"", kategori:"", linkKey:"", analisisLabId:"", kan:false, klh:false});
  renderLabParamRows();
  const inputs = document.querySelectorAll('#labParamRows .labPF[data-f="nama"]');
  if(inputs.length) inputs[inputs.length-1].focus();
}
function removeLabParamRow(t){
  syncLabDraftParametersFromDom();
  labDraftParameters.splice(Number(t.dataset.idx),1);
  renderLabParamRows();
}
// Isi cepat dari katalog parameter pemantauan kategori tsb (yg belum ada di draft).
function labAddCatalogParams(t){
  syncLabDraftParametersFromDom();
  const cat = t.dataset.cat;
  const have = new Set(labDraftParameters.map(labParamLinkKey).filter(Boolean));
  const add = labCatalog().filter(p=>p.kategori===cat && !have.has(p.key));
  if(!add.length){ toast(`Semua parameter ${LAB_KATEGORI_LABEL[cat]} sudah ada di daftar.`, "ok"); return; }
  add.forEach(p=>labDraftParameters.push({nama:p.label, metode:"", kategori:cat, linkKey:p.key, analisisLabId:"", kan:false, klh:false}));
  renderLabParamRows();
  toast(`${add.length} parameter ${LAB_KATEGORI_LABEL[cat]} ditambahkan — lengkapi metode & centang KAN/KLH.`, "ok");
}
function labBulkFlag(t){
  syncLabDraftParametersFromDom();
  const f = t.dataset.f;
  if(!labDraftParameters.length) return;
  const allOn = labDraftParameters.every(p=>p[f]);
  labDraftParameters.forEach(p=>{ p[f] = !allOn; });
  renderLabParamRows();
}
function labLampiranFieldHtml(kind, l){
  const idKey = kind.key+"Id", fnKey = kind.key+"Filename";
  const has = !!l[idKey];
  return `<div class="labf-file">
    <div class="labf-file-lbl">${escHtml(kind.label)} <small>PDF, maks ${(LAB_LAMPIRAN_MAX_BYTES/1024/1024).toFixed(0)}MB</small></div>
    <label class="labf-drop ${has?"has":""}">
      <input type="file" id="lab_${kind.key}File" accept="application/pdf">
      <span class="labf-drop-ic" aria-hidden="true">PDF</span>
      <span class="labf-drop-txt" id="lab_${kind.key}FileTxt">${has?`<b>${escHtml(l[fnKey]||"lampiran.pdf")}</b><small>Terlampir &middot; klik untuk mengganti</small>`:`<b>Pilih file PDF</b><small>atau tarik &amp; lepas ke sini</small>`}</span>
      ${has?`<button type="button" class="btn small ghost" data-action="downloadLaboratoriumLampiran" data-id="${escHtml(l.id)}" data-kind="${kind.key}">Unduh</button>`:""}
    </label>
  </div>`;
}
function labfStatusPill(no, habis){
  if(!no) return `<span class="lab-st st-none">Belum diisi</span>`;
  const st = labStatusBerlaku(habis);
  return st ? `<span class="lab-st st-${st.key}">${st.text}</span>` : `<span class="lab-st st-none">Tanggal habis kosong</span>`;
}
function labfVal(id){ const el = document.getElementById(id); return el ? (el.type==="checkbox" ? el.checked : el.value.trim()) : ""; }
// Ringkasan live di header modal (lingkup, status KAN/KLH, jumlah parameter) — ikut berubah saat diketik.
function labfRefreshSummary(){
  const sum = document.getElementById("labfSummary");
  if(!sum) return;
  syncLabDraftParametersFromDom();
  const params = labDraftParameters.filter(p=>p.nama);
  const scope = [labfVal("lab_scopeEmisi")?`<span class="lab-chip emi">Emisi</span>`:"", labfVal("lab_scopeAmbien")?`<span class="lab-chip amb">Ambien</span>`:""].join("") || `<span class="lab-chip none">Lingkup belum dipilih</span>`;
  sum.innerHTML = `${scope}<span class="labf-sumitem">KAN ${labfStatusPill(labfVal("lab_kanNoAkreditasi"), labfVal("lab_kanHabisBerlaku"))}</span><span class="labf-sumitem">KLH ${labfStatusPill(labfVal("lab_klhNoRegistrasi"), labfVal("lab_klhHabisBerlaku"))}</span><span class="labf-sumitem"><b>${params.length}</b> parameter</span>`;
  const kanSt = document.getElementById("labfKanSt"); if(kanSt) kanSt.innerHTML = labfStatusPill(labfVal("lab_kanNoAkreditasi"), labfVal("lab_kanHabisBerlaku"));
  const klhSt = document.getElementById("labfKlhSt"); if(klhSt) klhSt.innerHTML = labfStatusPill(labfVal("lab_klhNoRegistrasi"), labfVal("lab_klhHabisBerlaku"));
  const navN = document.getElementById("labfNavParamN"); if(navN) navN.textContent = params.length;
  const stats = document.getElementById("labfParamStats");
  if(stats){
    const by = {}; params.forEach(p=>{ const k = labParamKategori(p); by[k] = (by[k]||0)+1; });
    const linked = params.filter(p=>labParamLinkKey(p)).length;
    stats.innerHTML = `${Object.entries(by).map(([k,n])=>`<span class="lab-cat c-${k}">${escHtml(LAB_KATEGORI_LABEL[k]||k)} ${n}</span>`).join("")}<span class="labf-pstat">${linked}/${params.length} terkait pemantauan &middot; ${params.filter(p=>p.kan).length} KAN &middot; ${params.filter(p=>p.klh).length} KLH</span>`;
  }
  const logo = document.getElementById("labfLogoPrev");
  if(logo) logo.innerHTML = labAvatarHtml({nama: labfVal("lab_nama")||"Lab", logoDataUrl: labDraftLogo}, 64);
}
function laboratoriumFormHtml(l){
  l = l || {id:"", nama:"", alamat:"", provinsi:"", kabkota:"", telepon:"", fax:"", email:"",
    scopeEmisi:false, scopeAmbien:false,
    kanNoAkreditasi:"", kanMulaiBerlaku:"", kanHabisBerlaku:"",
    klhNoRegistrasi:"", klhMulaiBerlaku:"", klhHabisBerlaku:"", parameters:[]};
  labEditingId = l.id || "";
  labDraftLogo = l.logoDataUrl || "";
  labDraftParameters = (l.parameters||[]).map(p=>({nama:p.nama||"", metode:p.metode||"", kategori:p.kategori||"", linkKey:p.linkKey||"", analisisLabId:p.analisisLabId||"", kan:!!p.kan, klh:!!p.klh}));
  const quickAdd = labCatsInUse().map(c=>`<button type="button" class="btn small ghost" data-action="labAddCatalogParams" data-cat="${c.key}" title="Tambahkan semua parameter pemantauan ${escHtml(c.label)} yang belum ada">+ ${escHtml(c.label)}</button>`).join("");
  return `
  <div class="labf-head">
    <div class="labf-logo">
      <div id="labfLogoPrev">${labAvatarHtml({nama:l.nama||"Lab", logoDataUrl:labDraftLogo}, 64)}</div>
      <div class="labf-logo-act">
        <label class="btn small">Unggah logo<input type="file" id="lab_logoFile" accept="image/png,image/jpeg,image/svg+xml,image/webp" hidden></label>
        <button type="button" class="btn small ghost" data-action="labRemoveLogo">Hapus</button>
      </div>
    </div>
    <div class="labf-title">
      <div class="labf-eyebrow">Setup <span aria-hidden="true">/</span> Laboratorium</div>
      <h3>${l.id?"Edit":"Tambah"} Laboratorium</h3>
      <div class="labf-summary" id="labfSummary"></div>
    </div>
    <button type="button" class="labf-x" data-action="closeModal" aria-label="Tutup">&times;</button>
  </div>
  <nav class="labf-nav" aria-label="Bagian formulir">
    <button type="button" data-action="labfJump" data-target="labfSecId"><b>1</b>Identitas &amp; kontak</button>
    <button type="button" data-action="labfJump" data-target="labfSecKan"><b>2</b>Akreditasi KAN</button>
    <button type="button" data-action="labfJump" data-target="labfSecKlh"><b>3</b>Registrasi KLH</button>
    <button type="button" data-action="labfJump" data-target="labfSecParam"><b>4</b>Parameter <span class="labf-navn" id="labfNavParamN">${labDraftParameters.length}</span></button>
  </nav>
  <div class="labf-body" id="labfBody">
    <section class="labf-sec" id="labfSecId">
      <div class="labf-sec-head"><h4>Identitas &amp; kontak</h4></div>
      <div class="labf-grid g2">
        <div class="field"><label>Nama laboratorium <span class="req">*</span></label><input type="text" id="lab_nama" value="${escHtml(l.nama)}" placeholder="mis. PT Sucofindo (Persero) - Cabang Balikpapan"></div>
        <div class="field"><label>Alamat</label><input type="text" id="lab_alamat" value="${escHtml(l.alamat)}"></div>
        <div class="field"><label>Provinsi</label><select id="lab_provinsi"><option value="">- pilih -</option>${PROVINSI_INDONESIA.map(p=>`<option ${l.provinsi===p?"selected":""}>${escHtml(p)}</option>`).join("")}</select></div>
        <div class="field"><label>Kabupaten/Kota</label><input type="text" id="lab_kabkota" value="${escHtml(l.kabkota)}" placeholder="mis. Kota Balikpapan"></div>
      </div>
      <div class="labf-grid g3">
        <div class="field"><label>Telepon</label><input type="text" id="lab_telepon" value="${escHtml(l.telepon)}"></div>
        <div class="field"><label>Fax</label><input type="text" id="lab_fax" value="${escHtml(l.fax)}"></div>
        <div class="field"><label>Email</label><input type="email" id="lab_email" value="${escHtml(l.email)}"></div>
      </div>
      <div class="labf-scope">
        <div class="labf-scope-lbl">Lingkup sampling yang dicakup</div>
        <label class="labf-tog"><input type="checkbox" id="lab_scopeEmisi" ${l.scopeEmisi?"checked":""}><span><b>Sampling Emisi</b><small>Cerobong, flare, opasitas</small></span></label>
        <label class="labf-tog"><input type="checkbox" id="lab_scopeAmbien" ${l.scopeAmbien?"checked":""}><span><b>Sampling Ambien</b><small>Udara ambien, kebisingan, kebauan, getaran</small></span></label>
      </div>
    </section>
    <section class="labf-sec" id="labfSecKan">
      <div class="labf-sec-head"><h4>Akreditasi KAN <small>ISO/IEC 17025</small></h4><span id="labfKanSt"></span></div>
      <div class="labf-grid g3">
        <div class="field"><label>No. akreditasi</label><input type="text" id="lab_kanNoAkreditasi" value="${escHtml(l.kanNoAkreditasi)}" placeholder="mis. LP-524-IDN"></div>
        <div class="field"><label>Mulai berlaku</label><input type="date" id="lab_kanMulaiBerlaku" value="${l.kanMulaiBerlaku||""}"></div>
        <div class="field"><label>Habis berlaku</label><input type="date" id="lab_kanHabisBerlaku" value="${l.kanHabisBerlaku||""}"></div>
      </div>
      ${labLampiranFieldHtml(LAB_LAMPIRAN_KINDS[0], l)}
    </section>
    <section class="labf-sec" id="labfSecKlh">
      <div class="labf-sec-head"><h4>Registrasi laboratorium lingkungan <small>KLH</small></h4><span id="labfKlhSt"></span></div>
      <div class="labf-grid g3">
        <div class="field"><label>No. registrasi</label><input type="text" id="lab_klhNoRegistrasi" value="${escHtml(l.klhNoRegistrasi)}"></div>
        <div class="field"><label>Mulai berlaku</label><input type="date" id="lab_klhMulaiBerlaku" value="${l.klhMulaiBerlaku||""}"></div>
        <div class="field"><label>Habis berlaku</label><input type="date" id="lab_klhHabisBerlaku" value="${l.klhHabisBerlaku||""}"></div>
      </div>
      <div class="labf-grid g2">${labLampiranFieldHtml(LAB_LAMPIRAN_KINDS[1], l)}${labLampiranFieldHtml(LAB_LAMPIRAN_KINDS[2], l)}</div>
    </section>
    <section class="labf-sec" id="labfSecParam">
      <div class="labf-sec-head"><h4>Parameter pengukuran</h4><div class="labf-pstats" id="labfParamStats"></div></div>
      <div class="labf-ptools">
        <span class="labf-ptools-lbl">Isi cepat:</span>${quickAdd}
        <span class="spacer"></span>
        <button type="button" class="btn small ghost" data-action="labBulkFlag" data-f="kan" title="Centang/kosongkan KAN semua baris">KAN semua</button>
        <button type="button" class="btn small ghost" data-action="labBulkFlag" data-f="klh" title="Centang/kosongkan KLH semua baris">KLH semua</button>
        <button type="button" class="btn small primary" data-action="addLabParamRow">+ Tambah Parameter</button>
      </div>
      <div class="hint labf-phint">Centang <b>KAN</b>/<b>KLH</b> bila parameter itu masuk ruang lingkup sertifikat akreditasi/registrasi lab ini. <b>Terkait pemantauan</b> menghubungkan baris ke parameter di hasil pemantauan (otomatis dari nama, bisa diubah). <b>Dianalisis di</b> dipakai bila sampel parameter tsb diolah di laboratorium lain.</div>
      <datalist id="labParamSuggestions">${LAB_PARAMETER_SUGGESTIONS.map(s=>`<option value="${escHtml(s)}">`).join("")}</datalist>
      <div id="labParamRows" class="labf-prows">${labParameterRowsHtml()}</div>
    </section>
  </div>
  <div class="actions labf-actions">
    <span class="labf-foot-hint">Perubahan tersimpan setelah klik <b>Simpan</b>.</span>
    <button class="btn ghost" data-action="closeModal">Batal</button>
    <button class="btn primary" data-action="saveLaboratoriumBtn" data-id="${l.id}">Simpan</button>
  </div>`;
}
function labOpenForm(l){
  openModal(laboratoriumFormHtml(l), {wide:true, scrollBody:true, cls:"labf-modal"});
  labfRefreshSummary();
  wireScrollShadow(document.getElementById("labfBody"));
}
function addLaboratorium(){ labOpenForm(null); }
function editLaboratorium(id){
  const l = ensureLaboratoriumArr().find(x=>x.id===id);
  if(l) labOpenForm(l);
}
function labfJump(t){
  const body = document.getElementById("labfBody"), sec = document.getElementById(t.dataset.target);
  if(body && sec) body.scrollTo({top: sec.offsetTop - body.offsetTop - 4, behavior:"smooth"});
}
function labRemoveLogo(){ labDraftLogo = ""; const f = document.getElementById("lab_logoFile"); if(f) f.value = ""; labfRefreshSummary(); }
// Logo diperkecil ke maks 240px (PNG, transparansi dipertahankan) lalu disimpan sbg data URL di
// record lab — cukup kecil (~10-40KB) utk localStorage, dan bisa langsung tampil sinkron di kartu/matriks.
function labReadLogo(file){
  if(!file) return;
  if(!/^image\//.test(file.type)){ toast("Logo harus berupa gambar (PNG/JPG/SVG/WebP).","err"); return; }
  if(file.size > LAB_LOGO_MAX_INPUT){ toast("File logo terlalu besar (maks 2MB).","err"); return; }
  const reader = new FileReader();
  reader.onload = ()=>{
    const img = new Image();
    img.onload = ()=>{
      const w = img.naturalWidth || LAB_LOGO_MAX_PX, h = img.naturalHeight || LAB_LOGO_MAX_PX;
      const k = Math.min(1, LAB_LOGO_MAX_PX/Math.max(w,h));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(w*k)); c.height = Math.max(1, Math.round(h*k));
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      try{ labDraftLogo = c.toDataURL("image/png"); }catch(e){ labDraftLogo = reader.result; }
      labfRefreshSummary();
    };
    img.onerror = ()=>toast("Gambar logo tidak bisa dibaca.","err");
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}
document.addEventListener("change", e=>{
  const t = e.target;
  if(t.id==="lab_logoFile") labReadLogo(t.files[0]);
  const kind = t.id && t.id.startsWith("lab_") && t.id.endsWith("File") ? LAB_LAMPIRAN_KINDS.find(k=>t.id===`lab_${k.key}File`) : null;
  if(kind){
    const txt = document.getElementById(`lab_${kind.key}FileTxt`), f = t.files[0];
    if(txt && f) txt.innerHTML = `<b>${escHtml(sanitizeLabFilename(f.name))}</b><small>${(f.size/1024).toFixed(0)} KB${f.size>LAB_LAMPIRAN_MAX_BYTES?' &middot; <span class="labf-err">melebihi 2MB</span>':" &middot; siap disimpan"}</small>`;
    if(f) t.closest(".labf-drop").classList.add("has");
  }
  if(t.classList && t.classList.contains("labPF") && (t.dataset.f==="kategori" || t.dataset.f==="linkKey" || t.type==="checkbox")){
    syncLabDraftParametersFromDom();
    if(t.dataset.f==="kategori"){ const row = labDraftParameters[Number(t.dataset.idx)]; const ls = document.querySelector(`#labParamRows .labPF[data-idx="${t.dataset.idx}"][data-f="linkKey"]`); if(row && ls) ls.innerHTML = labLinkOptionsHtml(row); }
    labfRefreshSummary();
  }
  if(t.closest && t.closest(".labf-modal") && /^lab_(scope|kan|klh)/.test(t.id||"")) labfRefreshSummary();
});
document.addEventListener("input", e=>{
  const t = e.target;
  if(t.classList && t.classList.contains("labPF") && t.dataset.f==="nama"){
    // Perbarui teks opsi "Otomatis" (kategori & keterkaitan) tanpa re-render baris (fokus tetap).
    const i = t.dataset.idx, row = labDraftParameters[Number(i)];
    if(!row) return;
    row.nama = t.value.trim();
    const ks = document.querySelector(`#labParamRows .labPF[data-idx="${i}"][data-f="kategori"]`);
    const ls = document.querySelector(`#labParamRows .labPF[data-idx="${i}"][data-f="linkKey"]`);
    if(ks){ const v = ks.value; ks.innerHTML = labKategoriOptionsHtml({...row, kategori:v}); ks.value = v; }
    if(ls){ const v = ls.value; ls.innerHTML = labLinkOptionsHtml({...row, linkKey:v, kategori: ks?ks.value:row.kategori}); ls.value = v; }
    return;
  }
  if(t.id && /^lab_(nama|kanNoAkreditasi|klhNoRegistrasi)$/.test(t.id)) labfRefreshSummary();
});
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
  const parameters = labDraftParameters.filter(p=>p.nama).map(p=>({nama:p.nama, metode:p.metode||"", kategori:p.kategori||"", linkKey:p.linkKey||"", analisisLabId:p.analisisLabId||"", kan:!!p.kan, klh:!!p.klh}));
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
    parameters, logoDataUrl: labDraftLogo || ""
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
    // Baris parameter lab lain yg analisisnya dirujuk ke lab yg dihapus dikembalikan ke "Lab ini".
    DB.laboratorium.forEach(x=>(x.parameters||[]).forEach(p=>{ if(p.analisisLabId===id) p.analisisLabId = ""; }));
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
  removeLabParamRow,
  labAddCatalogParams, labBulkFlag, labfJump, labRemoveLogo, labSetMatrixCat
});
