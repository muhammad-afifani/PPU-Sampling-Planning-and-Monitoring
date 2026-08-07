/* =========================================================
   TRACKING
========================================================= */
function refreshTrackingBatchSelect(){
  const team = document.getElementById("trkTeam").value;
  const sel = document.getElementById("trkBatch");
  const list = team? DB.batches.filter(b=>b.team===team) : DB.batches;
  sel.innerHTML = `<option value="">Semua</option>`+list.map(b=>`<option value="${b.id}">${b.name}</option>`).join("");
}
document.getElementById("trkTeam").addEventListener("change", ()=>{ refreshTrackingBatchSelect(); renderTracking(); });
// Dibungkus arrow (bukan diarahkan langsung ke renderTracking) karena fungsi itu didefinisikan
// di file assets/js/10-running-hour.js, yang baru dimuat SETELAH file ini — referensi langsung
// di top-level di sini akan dievaluasi sebelum sempat terdefinisi. Dibungkus supaya baru
// dicari saat event "change" beneran terjadi (setelah semua file <script> selesai dimuat).
document.getElementById("trkBatch").addEventListener("change", ()=>renderTracking());
document.getElementById("trkStatus").addEventListener("change", ()=>renderTracking());

// KOM tidak lagi di sini — dipindah jadi status per (batch,site) di tabel "KOM per Site"
// karena KOM biasanya cuma sekali per site, bukan per titik/engine.
// "planned" & "actual" dikeluarkan dari daftar ini — sekarang jadi bagian Tahap 1 (Sampling Emisi
// di Lapangan) dengan tampilan sendiri (status + tanggal + catatan per titik, lihat
// renderSamplingEmisiTable), bukan checkbox polos lagi. Daftar di sini murni Tahap 2 (dokumen
// & pelaporan), yang cuma relevan setelah suatu titik berstatus "sudah disampling" di Tahap 1.
const TRACK_STEPS = [
  ["ba","BA Ditandatangani"],
  ["draftSent","Draft SHU Dikirim"],["reviewed","Draft Direview"],["approved","Draft Approved"],
  ["finalReceived","SHU Asli Terbit"],["simpelInput","Input SIMPEL PPU"]
];
// Status eksekusi sampling lapangan per titik (Tahap 1) — terpisah dari checklist dokumen (Tahap 2).
const SAMPLING_STATUS_LABELS = {
  sampled: "Sudah Disampling",
  deferred: "Direncanakan Batch Berikutnya",
  other: "Tidak Disampling, Sebab Lain"
};
// Satu sumber kebenaran untuk bentuk record DB.tracking[id] — dipakai di semua tempat yang perlu
// bikin/pastikan record ini ada, supaya field baru (samplingStatus/samplingNote) tidak ketinggalan
// ditambahkan kalau nanti ada penambahan lapangan baru lagi.
function ensureTracking(id){
  if(!DB.tracking[id]) DB.tracking[id] = {planned:false, actual:false, ba:false, draftSent:false, reviewed:false, approved:false, finalReceived:false, simpelInput:false, dates:{}, samplingStatus:"", samplingNote:""};
  const t = DB.tracking[id];
  if(t.samplingStatus===undefined) t.samplingStatus = "";
  if(t.samplingNote===undefined) t.samplingNote = "";
  if(!t.dates) t.dates = {};
  return t;
}
function komKey(batchId, site){ return batchId+"::"+site; }
// Modal catat KOM (Kick Off Meeting) per (batch,site) — absen peserta & ringkasan materi yang
// disampaikan, bukan cuma centang selesai/belum seperti sebelumnya.
function openKomDetail(key){
  const site = key.split("::")[1];
  const k = DB.komStatus[key] || {done:false, date:"", attendees:"", notes:""};
  openModal(`<h3>KOM — ${escHtml(site)}</h3>
    <p class="hint">Catat tanggal, peserta (absen), dan materi yang sudah disampaikan saat Kick Off Meeting site ini.</p>
    <div class="field"><label>Tanggal KOM</label><input type="date" id="komDate" value="${escHtml(k.date||todayStr())}"></div>
    <div class="field" style="margin-top:8px;"><label>Peserta / Absen (satu nama per baris)</label>
      <textarea id="komAttendees" rows="4" style="width:100%;padding:7px 9px;border:1px solid var(--gray-300);border-radius:6px;" placeholder="mis. Ali (PPC)&#10;Budi (Observer)&#10;Citra (Site Rep)">${escHtml(k.attendees||"")}</textarea>
    </div>
    <div class="field" style="margin-top:8px;"><label>Materi / Yang Sudah Disampaikan</label>
      <textarea id="komNotes" rows="4" style="width:100%;padding:7px 9px;border:1px solid var(--gray-300);border-radius:6px;" placeholder="mis. Jadwal sampling, titik yang dikunjungi, akses &amp; APD, kontak darurat">${escHtml(k.notes||"")}</textarea>
    </div>
    <div class="actions">
      ${k.done ? `<button class="btn danger" style="margin-right:auto;" data-action="clearKomDetail" data-key="${escHtml(key)}">Hapus Catatan</button>` : ""}
      <button class="btn ghost" data-action="closeModal">Batal</button>
      <button class="btn primary" data-action="saveKomDetail" data-key="${escHtml(key)}">Simpan</button>
    </div>`);
}
function trackingOverallStatus(t, p){
  if(!t) return "ontrack";
  if(t.simpelInput) return "done";
  if(p.status==="failed") return "overdue";
  if(t.ba && t.dates.ba){
    const days = Math.round((new Date()-new Date(t.dates.ba))/86400000);
    if(!t.finalReceived && days>21) return "overdue";
  }
  return "ontrack";
}
function getFilteredTrackingPoints(){
  const team = document.getElementById("trkTeam").value;
  const batchId = document.getElementById("trkBatch").value;
  const statusF = document.getElementById("trkStatus").value;
  let pts = DB.points.filter(p=>p.batchId);
  if(team) pts = pts.filter(p=> team==="emisi"? p.kategori==="emisi" : p.kategori!=="emisi");
  if(batchId) pts = pts.filter(p=>p.batchId===batchId);
  const beforeStatus = pts;
  if(statusF) pts = pts.filter(p=>trackingOverallStatus(DB.tracking[p.id],p)===statusF);
  return {pts, beforeStatus};
}
function renderKomSiteTable(scopePts){
  const pairs = {};
  scopePts.forEach(p=>{ const k=komKey(p.batchId,p.site); if(!pairs[k]) pairs[k]={batchId:p.batchId, site:p.site, count:0}; pairs[k].count++; });
  const rows = Object.values(pairs).sort((a,c)=>a.site.localeCompare(c.site));
  document.getElementById("komSiteTable").innerHTML = rows.length ? `
    <thead><tr><th>Batch</th><th>Site</th><th>Jml Titik</th><th>KOM (Kick Off Meeting)</th></tr></thead>
    <tbody>${rows.map(r=>{
      const b = DB.batches.find(x=>x.id===r.batchId);
      const key = komKey(r.batchId, r.site);
      const k = DB.komStatus[key] || {done:false, date:"", attendees:"", notes:""};
      const nPeserta = (k.attendees||"").split("\n").map(s=>s.trim()).filter(Boolean).length;
      return `<tr>
        <td>${b?escHtml(b.name):"-"}</td>
        <td><b>${r.site}</b></td>
        <td>${r.count}</td>
        <td class="trk-cell${k.done?" done":""}">
          <button class="btn small ${k.done?"":"ghost"}" data-action="openKomDetail" data-key="${escHtml(key)}">
            ${k.done ? `&#10003; ${nPeserta} peserta &middot; ${escHtml(k.date||"-")}` : "Catat KOM"}
          </button>
        </td>
      </tr>`;
    }).join("")}</tbody>` : "<div class='hint' style='padding:10px;'>Belum ada titik yang masuk batch untuk filter ini.</div>";
}

/* =========================================================
   LOKASI PETA (Leaflet + Esri World Imagery satelit / OpenStreetMap jalan)
========================================================= */
let mapInstance = null, mapMarkersLayer = null;
// Identitas verifikator disimpan di memori (bukan localStorage) — cukup diisi sekali per sesi
// buka file ini, supaya tiap klik Sesuai/Tidak Sesuai tercatat siapa yang menandai tanpa perlu
// isi ulang berkali-kali. Reset lagi kalau file dibuka ulang (sengaja, karena sesi baru = orang baru).
let verifierIdentity = null;
let markerIndex = new Map(); // key "site::nama" -> Leaflet marker (pin), cuma berisi titik yang lagi tampil individual (bukan yang lagi jadi bubble)
let coordTableExpanded = new Set();
// Warna per jenis peralatan ("Ketentuan Teknis") — dicek berurutan, pertama yang cocok dipakai.
// Cuma warna (bukan ikon/emoji) supaya pin tetap kecil & tidak penuh di peta.
const ENGINE_TYPE_COLORS = [
  {test:/flare/i, color:"#e0554f", label:"Flare"},
  {test:/turbine/i, color:"#e8a33d", label:"Turbine"},
  {test:/diesel/i, color:"#8a5c11", label:"Diesel"},
  {test:/gas.*(engine|booster)|gas lift/i, color:"#0ea5a0", label:"Gas Engine"},
  {test:/heater|reboiler/i, color:"#9b59b6", label:"Heater/Reboiler"},
  {test:/compressor/i, color:"#3d78c9", label:"Compressor"},
  {test:/pump/i, color:"#2dd4c8", label:"Pump"}
];
function engineTypeInfo(p){
  if(p.kategori!=="emisi") return {color:"#5b7fa6", label: NONEMISI_LABEL[p.kategori]||p.kategori};
  const src = p.kategoriSumber||"";
  for(const t of ENGINE_TYPE_COLORS){ if(t.test.test(src)) return t; }
  return {color:"#7f8fa0", label:"Lainnya"};
}
// Cluster titik yang berdekatan jadi satu "bubble" (radius dalam PIXEL layar, bukan meter — jadi
// selalu proporsional di zoom berapa pun, beda dari pendekatan offset-meter lama yang bisa tetap
// numpuk di zoom rendah). Otomatis pecah lagi begitu di-zoom masuk atau bubble-nya diklik
// (spiderfy) — jadi titik yang tadinya numpuk & susah diklik tetap bisa dijangkau satu-satu.
function ensureMarkersLayer(){
  if(mapMarkersLayer){ mapMarkersLayer.clearLayers(); return mapMarkersLayer; }
  mapMarkersLayer = L.layerGroup().addTo(mapInstance);
  return mapMarkersLayer;
}
/* =========================================================
   PIXEL-BASED DECLUTTER
   ---------------------------------------------------------
   Pin SELALU di koordinat asli (tidak pernah digeser). Titik yang jaraknya
   berdekatan DI LAYAR (radius piksel, otomatis proporsional di zoom berapa
   pun) dikumpulkan jadi satu bubble angka — MURNI berdasarkan zoom saat itu,
   tidak ada status "diingat" sama sekali, jadi zoom keluar SELALU balik jadi
   bubble lagi (tidak pernah "nyangkut" kebuka). Klik bubble = jalan pintas
   zoom masuk ke lokasi itu (bukan "buka paksa") — begitu zoom-nya cukup,
   titik-titiknya otomatis pisah sendiri karena jaraknya sudah > ambang piksel.
   Begitu tampil individual, notasinya (label) ditata satu per satu: coba
   taruh langsung di atas pin dulu, tapi kalau areanya sudah dipakai notasi
   lain, dicoba slot berikutnya (muter ke beberapa arah & jarak, jaraknya
   proporsional ke lebar teksnya sendiri) sampai ketemu yang kosong — lalu
   ditarik garis kuning dari pin ke notasinya. Dihitung ulang total tiap
   zoom/geser peta karena posisi piksel semuanya berubah.
========================================================= */
// Arah kandidat (unit vector) tempat label dicoba ditaruh, urut dari yang paling wajar (atas)
// duluan. Radius tiap arah membesar per "tier" (lihat layoutLabels) — jarak kandidat dihitung
// dari lebar teks LABEL ITU SENDIRI (bukan angka piksel tetap), jadi nama panjang otomatis
// dicoba di posisi yang cukup jauh supaya tidak nabrak tetangganya.
const LABEL_DIRS = [
  [0,-1], [0.87,-0.5], [-0.87,-0.5], [0.87,0.5], [-0.87,0.5],
  [0,1], [1,0], [-1,0], [0.5,-0.87], [-0.5,-0.87], [0.5,0.87], [-0.5,0.87]
];
function labelSize(text){
  return {w: Math.max(30, text.length*5.9 + 14), h: 20};
}
function rectsOverlap(a,b){
  return !(a.x+a.w<b.x || b.x+b.w<a.x || a.y+a.h<b.y || b.y+b.h<a.y);
}
// Tata semua label titik yang tampil individual — dipanggil dengan array {key,latlng,nama}.
// Mengembalikan pusat kotak label (buat divIcon, di-anchor tengah) + titik ujung garis leader
// (dipotong pas di tepi kotak, dari arah yang benar — bukan selalu dari bawah/kiri).
function layoutLabels(items){
  const MARGIN = 4;
  const placed = [];
  return items.map(it=>{
    const p = mapInstance.latLngToContainerPoint(it.latlng);
    const {w,h} = labelSize(it.nama);
    const baseR = Math.max(w,h)/2 + 12;
    let chosen = null;
    for(let tier=0; tier<7 && !chosen; tier++){
      const r = baseR*(1 + tier*0.78);
      for(let d=0; d<LABEL_DIRS.length; d++){
        const [ux,uy] = LABEL_DIRS[d];
        const cx = p.x+ux*r, cy = p.y+uy*r;
        const rect = {x:cx-w/2-MARGIN, y:cy-h/2-MARGIN, w:w+MARGIN*2, h:h+MARGIN*2};
        if(!placed.some(pr=>rectsOverlap(pr,rect))){ chosen = {cx,cy,rect,tier,d}; break; }
      }
    }
    if(!chosen){
      const r = baseR*6.5, [ux,uy] = LABEL_DIRS[0];
      const cx = p.x+ux*r, cy = p.y+uy*r;
      chosen = {cx, cy, rect:{x:cx-w/2,y:cy-h/2,w,h}, tier:99, d:0};
    }
    placed.push(chosen.rect);
    // Potong garis leader pas di tepi kotak (bukan sampai ke tengah) supaya tidak menembus teks —
    // proyeksikan titik pin terhadap kotak label sepanjang sumbu x/y mana yang lebih dulu kena tepi.
    const dx = chosen.cx-p.x, dy = chosen.cy-p.y;
    const tX = dx!==0 ? (w/2)/Math.abs(dx) : Infinity;
    const tY = dy!==0 ? (h/2)/Math.abs(dy) : Infinity;
    const t = Math.min(tX,tY,1);
    const edge = {x: chosen.cx - dx*t, y: chosen.cy - dy*t};
    const isDefault = chosen.tier===0 && chosen.d===0;
    return {key:it.key, moved: !isDefault, labelCenter:{x:chosen.cx,y:chosen.cy}, leaderEnd:edge};
  });
}
// Kelompokkan titik yang jaraknya berdekatan DI LAYAR (piksel, bukan meter) — selalu proporsional
// di zoom berapa pun, beda dari pendekatan meter lama yang bisa tetap numpuk di zoom rendah.
function groupByPixelProximity(points, thresholdPx){
  const withPixel = points.map(p=>({p, key:p.site+"::"+p.nama, pt: mapInstance.latLngToContainerPoint(DB.pointCoords[p.site+"::"+p.nama])}));
  const groups = [];
  const used = new Set();
  withPixel.forEach(a=>{
    if(used.has(a.key)) return;
    const group = [a]; used.add(a.key);
    withPixel.forEach(b=>{
      if(used.has(b.key)) return;
      if(Math.hypot(a.pt.x-b.pt.x, a.pt.y-b.pt.y)<=thresholdPx){ group.push(b); used.add(b.key); }
    });
    groups.push(group);
  });
  return groups;
}
function pointStatusBadgeText(p){
  const map = {scheduled:"Scheduled", done:"Done", failed:"Gagal"};
  if(map[p.status]) return map[p.status];
  const reason = p.holdReason ? HOLD_REASON_LABELS[p.holdReason] : "";
  return "Hold"+(reason?": "+reason:"");
}
function gmapsLink(lat,lng){ return `https://www.google.com/maps?q=${lat},${lng}`; }
function decimalToDMS(dec, isLat){
  const hemi = isLat ? (dec<0?"LS":"LU") : (dec<0?"BB":"BT");
  const abs = Math.abs(dec);
  const deg = Math.floor(abs);
  const minFull = (abs-deg)*60;
  const min = Math.floor(minFull);
  const sec = ((minFull-min)*60).toFixed(2);
  return `${deg}° ${min}' ${sec}" ${hemi}`;
}
function coordsDMS(lat,lng){ return decimalToDMS(lat,true)+", "+decimalToDMS(lng,false); }
function makeDivIcon(type, size, verif){
  const ring = verif==="wrong" ? "#e0554f" : (verif==="ok" ? "#3fb27f" : "#fff");
  return L.divIcon({
    className: "",
    html: `<div class="map-pin" style="background:${type.color};border-color:${ring};width:${size}px;height:${size}px;"></div>`,
    iconSize:[size,size], iconAnchor:[size/2,size/2], popupAnchor:[0,-size/2]
  });
}
// Blok verifikasi dipakai bareng di popup peta & tabel — badge status (dengan tooltip siapa/kapan/
// catatan) + 2 tombol Sesuai/Tidak Sesuai yang membuka modal identitas+catatan sebelum tersimpan.
function verifBlockHtml(key, opts){
  opts = opts||{};
  const v = DB.coordVerification[key];
  const badgeCls = v?.status==="ok" ? "b-green" : v?.status==="wrong" ? "b-red" : "b-amber";
  const badgeLabel = v?.status==="ok" ? "Sesuai" : v?.status==="wrong" ? "Tidak Sesuai" : "Apakah sesuai titik aktual?";
  const title = v ? `Oleh ${v.by}${v.site?" ("+v.site+")":""} — ${new Date(v.at).toLocaleString("id-ID")}${v.note?" — "+v.note:""}` : "Apakah sesuai titik aktual? Belum ada yang menjawab.";
  const badge = `<span class="badge ${badgeCls}" title="${escHtml(title)}">${badgeLabel}</span>`;
  const btns = `<span class="${opts.inline?"":"toolbar"}" style="gap:5px;margin:${opts.inline?"0":"6px 0 0"};display:inline-flex;">
      <button class="btn small ${v?.status==="ok"?"primary":"ghost"}" data-action="openVerifyModal" data-key="${escHtml(key)}" data-verif="ok" title="Tandai Sesuai">&#10003;</button>
      <button class="btn small ${v?.status==="wrong"?"danger":"ghost"}" data-action="openVerifyModal" data-key="${escHtml(key)}" data-verif="wrong" title="Tandai Tidak Sesuai">&#10007;</button>
    </span>`;
  return {badge, btns, note: v?.note||""};
}
function openVerifyModal(key, verif){
  const namaOnly = key.split("::").slice(1).join("::") || key;
  const existing = DB.coordVerification[key];
  openModal(`<h3>${verif==="ok"?"Tandai Sesuai":"Tandai Tidak Sesuai"}</h3>
    <p class="hint">${escHtml(namaOnly)}</p>
    ${verifierIdentity ? `
      <div class="hint">Diisi sebagai <b>${escHtml(verifierIdentity.name)}</b>${verifierIdentity.site?" ("+escHtml(verifierIdentity.site)+")":""}. <a href="#" data-action="clearVerifierIdentity" data-key="${escHtml(key)}" data-verif="${verif}" style="font-weight:700;">Ganti nama</a></div>
    ` : `
      <div class="inline-fields">
        <div class="field"><label>Nama Kamu</label><input type="text" id="verifName" placeholder="mis. Ali" autofocus></div>
        <div class="field"><label>Site/Tim (opsional)</label><input type="text" id="verifSite" placeholder="mis. SPU"></div>
      </div>
      <div class="hint" style="margin-top:6px;">Cukup diisi sekali — klik Sesuai/Tidak Sesuai berikutnya nggak perlu isi ulang selama file ini belum ditutup.</div>
    `}
    <div class="field" style="margin-top:10px;"><label>Catatan (opsional)${verif==="wrong"?" — mis. lokasi sebenarnya di mana / link GMaps yang benar":""}</label>
      <textarea id="verifNote" rows="3" style="width:100%;padding:7px 9px;border:1px solid var(--gray-300);border-radius:6px;" placeholder="opsional">${escHtml(existing?.note||"")}</textarea>
    </div>
    <div class="actions">
      ${existing?`<button class="btn danger" style="margin-right:auto;" data-action="removeVerify" data-key="${escHtml(key)}">Hapus Tanda</button>`:""}
      <button class="btn ghost" data-action="closeModal">Batal</button>
      <button class="btn primary" data-action="confirmVerify" data-key="${escHtml(key)}" data-verif="${verif}">Simpan</button>
    </div>`);
}
function pointPopupHtml(p, c){
  const type = engineTypeInfo(p);
  const key = p.site+"::"+p.nama;
  const vb = verifBlockHtml(key, {inline:true});
  return `<b>${escHtml(p.nama)}</b><br>
    <span class="muted">${escHtml(p.site)} &middot; ${escHtml(type.label)}</span><br>
    ${pointStatusBadgeText(p)}
    <div style="margin-top:6px;font-size:11px;line-height:1.6;">
      Desimal: ${c[0].toFixed(6)}, ${c[1].toFixed(6)}<br>
      DMS: ${coordsDMS(c[0],c[1])}
    </div>
    <a href="${gmapsLink(c[0],c[1])}" target="_blank" rel="noopener" style="font-size:11.5px;font-weight:700;">Buka di Google Maps &rarr;</a>
    <div class="hint" style="margin-top:6px;margin-bottom:3px;">Koordinat titik ini sesuai lokasi aktual? ${vb.badge}</div>
    ${vb.btns}
    ${vb.note?`<div class="hint" style="margin-top:5px;font-style:italic;">"${escHtml(vb.note)}"</div>`:""}`;
}
function mapFilteredPoints(){
  const status = document.getElementById("mapFltStatus").value;
  const site = document.getElementById("mapFltSite").value;
  let pts = DB.points.slice();
  if(site) pts = pts.filter(p=>p.site===site);
  if(status==="inBatch") pts = pts.filter(p=>!!p.batchId);
  else if(status==="notInBatch") pts = pts.filter(p=>!p.batchId);
  else if(status==="done") pts = pts.filter(p=>p.status==="done");
  return pts;
}
function renderMap(){
  const siteSel = document.getElementById("mapFltSite");
  if(!siteSel.dataset.filled){
    siteSel.innerHTML = `<option value="">Semua Site</option>`+allSites().map(s=>`<option value="${escHtml(s)}">${s}</option>`).join("");
    siteSel.dataset.filled = "1";
  }
  const el = document.getElementById("siteMap");
  if(typeof L === "undefined"){
    el.innerHTML = "<div class='hint' style='padding:20px;'>Peta tidak bisa dimuat — perlu koneksi internet saat pertama kali buka halaman ini (untuk load tile peta). Coba refresh setelah online.</div>";
    return;
  }
  if(!mapInstance){
    el.innerHTML = "";
    // maxZoom dinaikkan ke 21 supaya titik yang sangat berdekatan tetap bisa dipisah di posisi
    // koordinat aslinya (makin dalam zoom = makin jauh jaraknya dalam pixel). Citra satelit Esri
    // di area terpencil sering cuma tersedia sampai zoom 17 (maxNativeZoom) — lebih dalam dari itu
    // Leaflet otomatis membesarkan (upscale) tile terakhir yang ada, bukan menampilkan error/blank.
    mapInstance = L.map("siteMap", {maxZoom:21}).setView([-0.75,117.4], 9);
    const satellite = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 21, maxNativeZoom: 17, attribution: "Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics"
    });
    const street = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 21, maxNativeZoom: 19, attribution: "&copy; OpenStreetMap contributors"
    });
    satellite.addTo(mapInstance);
    L.control.layers({"Satelit":satellite, "Peta Jalan":street}).addTo(mapInstance);
    // Leaflet popup mematikan propagasi klik ke document (biar klik di dalam popup nggak nutup
    // peta) — akibatnya listener ACTIONS global di document tidak pernah kebagian klik tombol di
    // dalam popup. Makanya di-pasang listener lokal langsung di tiap popup begitu ia terbuka.
    mapInstance.on("popupopen", e=>{
      const el = e.popup.getElement();
      if(!el || el.dataset.actionsBound) return;
      el.dataset.actionsBound = "1";
      el.addEventListener("click", ev=>{
        const t = ev.target.closest("[data-action]");
        if(!t) return;
        const fn = ACTIONS[t.dataset.action];
        if(fn) fn(t);
      });
    });
    // Posisi piksel semua titik berubah tiap zoom/geser peta — tata ulang seluruhnya (murni dari
    // zoom SAAT INI, tanpa status yang "diingat") supaya selalu konsisten: zoom keluar SELALU balik
    // jadi bubble, zoom masuk SELALU memisahkan yang cukup renggang.
    mapInstance.on("zoomend moveend", renderMap);
  }
  ensureMarkersLayer();
  markerIndex.clear();

  const filtered = mapFilteredPoints();
  const withCoord = filtered.filter(p=>DB.pointCoords[p.site+"::"+p.nama]);
  const withoutCoord = filtered.length - withCoord.length;
  document.getElementById("mapCoordCount").textContent =
    `${withCoord.length} dari ${filtered.length} titik sumber emisi (sesuai filter) punya koordinat.` +
    (withoutCoord ? ` ${withoutCoord} titik belum ada koordinat.` : "");
  document.getElementById("verifierIndicator").innerHTML = verifierIdentity
    ? `Verifikator saat ini: <b>${escHtml(verifierIdentity.name)}</b>${verifierIdentity.site?" ("+escHtml(verifierIdentity.site)+")":""} — dipakai otomatis tiap kamu tandai Sesuai/Tidak Sesuai.`
    : "";

  {
    // 1) Kelompokkan titik yang berdekatan DI LAYAR (piksel, dihitung ulang total tiap render) jadi
    //    satu bubble angka. 2) Yang SUDAH renggang di zoom sekarang (group.length===1) dirender
    //    individual: pin PERSIS di koordinat aslinya, lalu label-nya ditata biar tidak tabrakan
    //    (layoutLabels) — kalau posisi defaultnya kepakai titik lain, digeser ke slot lain dan
    //    ditarik garis kuning dari pin ke label barunya. Tidak ada status "expanded" yang disimpan —
    //    semua murni hasil hitung ulang zoom saat ini, jadi zoom keluar selalu balik jadi bubble.
    const groups = groupByPixelProximity(withCoord, 52);
    const singles = []; // {key, latlng, nama, p, trueLatLng?, spiderCenter?} — titik yang dirender individual
    const atMaxZoom = mapInstance.getZoom() >= mapInstance.getMaxZoom();
    groups.forEach(group=>{
      if(group.length===1){
        group.forEach(g=>singles.push({key:g.key, latlng:DB.pointCoords[g.key], nama:g.p.nama, p:g.p}));
        return;
      }
      const lat = group.reduce((s,g)=>s+DB.pointCoords[g.key][0],0)/group.length;
      const lng = group.reduce((s,g)=>s+DB.pointCoords[g.key][1],0)/group.length;
      const n = group.length;
      if(!atMaxZoom){
        const size = n<6?32:n<15?40:48;
        const bg = n<6?"#0ea5a0":n<15?"#2b7fb0":"#0d1f38";
        const icon = L.divIcon({className:"", html:`<div class="map-cluster" style="width:${size}px;height:${size}px;background:${bg};"><span class="n">${n}</span></div>`, iconSize:[size,size]});
        const bubble = L.marker([lat,lng], {icon}).addTo(mapMarkersLayer);
        bubble.bindTooltip(`${n} titik berdekatan — klik untuk zoom masuk`, {direction:"top", offset:[0,-size/2], className:"muted-tooltip"});
        // Klik bubble = jalan pintas zoom masuk ke situ (bukan "buka paksa") — begitu zoom-nya
        // cukup, grup ini otomatis pisah sendiri di render berikutnya (dipicu event zoomend).
        bubble.on("click", ()=>{ mapInstance.setView([lat,lng], Math.min(mapInstance.getZoom()+3, mapInstance.getMaxZoom())); });
      } else {
        // Sudah di zoom maksimal (21 — jauh lebih dalam dari batas citra asli 17, tile di-upscale)
        // dan titik-titiknya TETAP berdekatan di layar — berarti jaraknya di dunia nyata memang
        // cuma 1-2 meter (mis. beberapa pompa di jetty yang sama, praktis titik yang sama persis).
        // Ini kasus ekstrem terakhir: sebar melingkar kecil di sekitar titik tengahnya ("spiderfy")
        // supaya tetap semua bisa diklik satu-satu — pin jadi sedikit tidak persis di titik GPS
        // aslinya HANYA untuk kasus sedekat ini, tapi popup-nya tetap menampilkan koordinat asli, dan
        // ditarik garis abu-abu tipis dari pusat ke tiap pin biar jelas itu "sekitar sini".
        const R = Math.max(20, Math.min(42, 13+n*3.5));
        const centerPt = mapInstance.latLngToContainerPoint([lat,lng]);
        L.circleMarker([lat,lng], {radius:3, color:"#fff", weight:1.5, fillColor:"#0d1f38", fillOpacity:1, interactive:false}).addTo(mapMarkersLayer);
        group.forEach((g,i)=>{
          const ang = (i/n)*2*Math.PI - Math.PI/2;
          const spidPt = {x: centerPt.x+Math.cos(ang)*R, y: centerPt.y+Math.sin(ang)*R};
          const spidLatLng = mapInstance.containerPointToLatLng([spidPt.x, spidPt.y]);
          L.polyline([[lat,lng], spidLatLng], {color:"#fff", weight:1.2, opacity:.7, interactive:false}).addTo(mapMarkersLayer);
          singles.push({key:g.key, latlng:spidLatLng, nama:g.p.nama, p:g.p, trueLatLng:DB.pointCoords[g.key]});
        });
      }
    });
    const placements = layoutLabels(singles);
    const placementByKey = new Map(placements.map(r=>[r.key,r]));
    singles.forEach(item=>{
      const type = engineTypeInfo(item.p);
      const popupLatLng = item.trueLatLng || item.latlng;
      const pin = L.marker(item.latlng, {icon: makeDivIcon(type, 13, DB.coordVerification[item.key]?.status)}).addTo(mapMarkersLayer);
      pin.bindPopup(pointPopupHtml(item.p, popupLatLng));
      markerIndex.set(item.key, pin);
      const placement = placementByKey.get(item.key);
      // Label di-anchor TENGAH (bukan selalu bawah-tengah) supaya kotaknya bisa "tumbuh" ke arah
      // mana pun tanpa garisnya jadi aneh — garis leader sendiri dipotong pas di tepi kotak
      // (leaderEnd), jadi selalu masuk dari sisi yang benar sesuai arah sebenarnya ke pin.
      const labelLatLng = mapInstance.containerPointToLatLng([placement.labelCenter.x, placement.labelCenter.y]);
      if(placement.moved){
        const leaderLatLng = mapInstance.containerPointToLatLng([placement.leaderEnd.x, placement.leaderEnd.y]);
        // Kuning terang + outline gelap tipis (lewat 2 polyline ditumpuk) supaya kelihatan jelas
        // di atas citra satelit terang MAUPUN gelap, bukan cuma satu warna gelap yang gampang hilang.
        L.polyline([item.latlng, leaderLatLng], {color:"#000", weight:3.4, opacity:.35, interactive:false}).addTo(mapMarkersLayer);
        L.polyline([item.latlng, leaderLatLng], {color:"#ffd400", weight:1.8, opacity:.95, interactive:false}).addTo(mapMarkersLayer);
      }
      const labelIcon = L.divIcon({className:"", html:`<div class="map-label" style="transform:translate(-50%,-50%);">${escHtml(item.nama)}</div>`, iconSize:[0,0]});
      const labelMarker = L.marker(labelLatLng, {icon:labelIcon}).addTo(mapMarkersLayer);
      labelMarker.bindPopup(pointPopupHtml(item.p, popupLatLng));
    });
  }
  setTimeout(()=>mapInstance.invalidateSize(), 50);
  renderCoordTable();
}
document.getElementById("mapFltStatus").addEventListener("change", renderMap);
document.getElementById("mapFltSite").addEventListener("change", renderMap);
// Cari & zoom ke engine — typeahead sederhana, cuma titik yang punya koordinat yang muncul di
// hasil (yang belum ada koordinatnya percuma di-zoom, tidak akan ketemu pin-nya).
function renderMapSearchResults(q){
  const box = document.getElementById("mapSearchResults");
  q = q.trim().toLowerCase();
  if(!q){ box.classList.remove("show"); box.innerHTML=""; return; }
  const matches = DB.points.filter(p=>{
    if(!DB.pointCoords[p.site+"::"+p.nama]) return false;
    return p.nama.toLowerCase().includes(q) || p.site.toLowerCase().includes(q);
  }).slice(0,20);
  box.innerHTML = matches.length
    ? matches.map(p=>`<div class="res-item" data-key="${escHtml(p.site+"::"+p.nama)}"><b>${escHtml(p.nama)}</b> <span class="muted">— ${escHtml(p.site)}</span></div>`).join("")
    : `<div class="res-empty">Tidak ada titik dengan koordinat yang cocok.</div>`;
  box.classList.add("show");
}
document.getElementById("mapSearchEngine").addEventListener("input", e=>renderMapSearchResults(e.target.value));
document.getElementById("mapSearchEngine").addEventListener("keydown", e=>{
  if(e.key==="Escape"){ e.target.value=""; document.getElementById("mapSearchResults").classList.remove("show"); }
});
document.getElementById("mapSearchResults").addEventListener("click", e=>{
  const item = e.target.closest(".res-item[data-key]");
  if(!item) return;
  const key = item.dataset.key;
  document.getElementById("mapSearchEngine").value = "";
  document.getElementById("mapSearchResults").classList.remove("show");
  // Reset filter site/status supaya titik yang dicari dijamin muncul di peta (kalau kebetulan
  // lagi difilter keluar), baru zoom ke situ.
  document.getElementById("mapFltSite").value = "";
  document.getElementById("mapFltStatus").value = "";
  renderMap();
  setTimeout(()=>ACTIONS.flyToCoord({dataset:{key}}), 50);
});
document.addEventListener("click", e=>{
  if(e.target.closest("#mapSearchEngine") || e.target.closest("#mapSearchResults")) return;
  const box = document.getElementById("mapSearchResults");
  if(box) box.classList.remove("show");
});
// Tabel kompak — diklik utk zoom+buka popup titik itu di peta, dipisah per site lalu per Emisi/Ambient.
function renderCoordTable(){
  const bySite = {};
  DB.points.forEach(p=>{
    if(!DB.pointCoords[p.site+"::"+p.nama]) return;
    if(!bySite[p.site]) bySite[p.site] = {emisi:[], lain:[]};
    (p.kategori==="emisi" ? bySite[p.site].emisi : bySite[p.site].lain).push(p);
  });
  const sites = Object.keys(bySite).sort();
  document.getElementById("coordTableWrap").innerHTML = sites.length ? sites.map(site=>{
    const {emisi,lain} = bySite[site];
    const total = emisi.length+lain.length;
    const expanded = coordTableExpanded.has(site);
    let html = `<div class="tree-site">
      <div class="tree-head"><span class="tree-toggle" data-action="toggleCoordSite" data-key="${escHtml(site)}" style="flex:1;">
        <span class="tree-caret">${expanded?"&#9660;":"&#9654;"}</span> <b>${escHtml(site)}</b> <span class="muted" style="color:#9db3c9;">&mdash; ${total} titik</span>
      </span></div>
      <div style="display:${expanded?"block":"none"};">`;
    [["Emisi",emisi],["Ambient &amp; Lainnya",lain]].forEach(([label,arr])=>{
      if(!arr.length) return;
      html += `<div class="tree-sub"><div class="tree-subhead">${label} (${arr.length})</div>
        <table class="tree-table coord-tbl">
        <colgroup><col style="width:26%;"><col style="width:15%;"><col style="width:24%;"><col style="width:24%;"><col style="width:11%;"></colgroup>
        <tbody>${arr.map(p=>{
          const c = DB.pointCoords[p.site+"::"+p.nama];
          const key = p.site+"::"+p.nama;
          const vb = verifBlockHtml(key, {inline:true});
          return `<tr class="coord-row" data-action="flyToCoord" data-key="${escHtml(key)}">
            <td class="coord-nama" title="${escHtml(p.nama)}">${escHtml(p.nama)}</td>
            <td class="muted" style="font-size:11px;">${c[0].toFixed(5)}, ${c[1].toFixed(5)}</td>
            <td class="muted" style="font-size:10.5px;">${coordsDMS(c[0],c[1])}</td>
            <td>${vb.badge} ${vb.btns}</td>
            <td><a href="${gmapsLink(c[0],c[1])}" target="_blank" rel="noopener" onclick="event.stopPropagation()">GMaps &#8599;</a></td>
          </tr>`;
        }).join("")}</tbody></table>
      </div>`;
    });
    html += `</div></div>`;
    return html;
  }).join("") : "<div class='hint' style='padding:10px;'>Belum ada titik dengan koordinat.</div>";
}
function exportCoordsCsv(){
  const rows = Object.entries(DB.pointCoords).map(([key,c])=>{
    const [site,...rest] = key.split("::");
    return {site, nama: rest.join("::"), lat:c[0], lng:c[1]};
  });
  csvExport(["site","nama","lat","lng"], rows, `koordinat_titik_${todayStr()}.csv`);
}
function importCoordsCsv(){
  openModal(`<h3>Import Koordinat CSV</h3>
    <p class="hint">Kolom wajib: <b>site;nama;lat;lng</b> (pakai Export dulu buat format contohnya). Site+nama harus persis sama dengan yang ada di Database Titik Pantau supaya nyambung ke peta.</p>
    <input type="file" id="coordsImportFile" accept=".csv">
    <div class="actions"><button class="btn ghost" data-action="closeModal">Batal</button><button class="btn primary" data-action="doImportCoordsCsv">Import</button></div>`);
}
function doImportCoordsCsv(){
  const file = document.getElementById("coordsImportFile").files[0];
  if(!file){ toast("Pilih file CSV dulu.","err"); return; }
  const reader = new FileReader();
  reader.onload = ()=>{
    try{
      const rows = csvParse(reader.result);
      snapshotBefore(`Sebelum import koordinat CSV "${file.name}"`);
      let updated=0;
      rows.forEach(r=>{
        if(!r.site || !r.nama || r.lat==="" || r.lng==="") return;
        DB.pointCoords[r.site+"::"+r.nama] = [Number(r.lat), Number(r.lng)];
        updated++;
      });
      logChange(`Import koordinat dari "${file.name}" — ${updated} titik diperbarui`);
      touchDataset("coords"); save(); closeModal();
      if(mapInstance){ mapInstance.remove(); mapInstance=null; }
      renderMap();
      toast(`${updated} koordinat diperbarui.`,"ok");
    }catch(err){ toast("Gagal import: "+err.message,"err"); }
  };
  reader.readAsText(file);
}

