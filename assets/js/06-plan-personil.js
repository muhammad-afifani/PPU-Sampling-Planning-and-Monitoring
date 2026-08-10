/* =========================================================
   PLAN PEMANTAUAN PER PERIODE
   ---------------------------------------------------------
   Snapshot kepatuhan untuk satu semester: daftar semua titik yang wajib
   dipantau periode itu (reguler + Emergency Engine yang kena ambang RH),
   status monitoring-nya, dan jalan pintas untuk kirim ke Perencanaan Batch.
========================================================= */
let rcLastPeriode = null;
// Tebak progress satu titik UNTUK periode tertentu dari status + tanggal aktual/rencana yang ada
// (bukan histori penuh — tool ini tidak menyimpan "riwayat per periode" terpisah).
function periodOfPointStatus(p, period){
  if(p.status==="done"){
    if(p.pemantauanTerakhir && p.pemantauanTerakhir.trim()===period) return "done-period";
    const po = periodOfDateStr(p.actualEnd);
    if(po && po.label===period) return "done-period";
    return "done-other";
  }
  if(p.status==="scheduled"){
    const po = periodOfDateStr(p.planStart);
    if(po && po.label===period) return "scheduled-period";
    return "scheduled-other";
  }
  if(p.status==="failed") return "failed";
  return "pending";
}
function rencanaProgressBadge(p, period){
  const map = {
    "done-period": ["b-green","Sudah Dipantau Periode Ini"],
    "done-other": ["b-green","Done (periode lain)"],
    "scheduled-period": ["b-blue","Terjadwal Periode Ini"],
    "scheduled-other": ["b-blue","Terjadwal (periode lain)"],
    "failed": ["b-red","Gagal / Lanjut Batch"],
    "pending": ["b-amber","Belum Direncanakan"]
  };
  const m = map[periodOfPointStatus(p, period)];
  return `<span class="badge ${m[0]}">${m[1]}</span>`;
}
// Recap "sudah dicek dari mana sampai mana" untuk satu periode — dari milih periode, Master Data
// diverifikasi, personil ditunjuk, sampai batch & jadwalnya jadi. Murni dihitung ulang tiap
// render (bukan status tersimpan sendiri) supaya selalu mencerminkan kondisi terkini.
function renderRencanaChecklist(period, wajibPts, elId){
  const el = document.getElementById(elId||"rcChecklist"); if(!el) return;
  const verifiedWajib = wajibPts.filter(p=>verifyStatus(p)==="verified");
  const pctVerified = wajibPts.length ? Math.round(verifiedWajib.length/wajibPts.length*100) : 100;
  const verifiedDates = wajibPts.filter(p=>p.lastVerified).map(p=>p.lastVerified).sort();
  const oldestVerified = verifiedDates[0];
  const relatedBatches = DB.batches.filter(b=>b.period===period);
  const anyPersonilAssigned = relatedBatches.some(b=>(b.assignedPersonil||[]).length>0);
  const anyScheduled = relatedBatches.some(b=>(b.schedule||[]).length>0);

  const steps = [
    {label:"1. Periode Pemantauan Dipilih", done:true, note:`Periode aktif: ${period}`},
    {label:"2. Database Titik Pantau Diverifikasi", done: wajibPts.length>0 && verifiedWajib.length===wajibPts.length,
      note: wajibPts.length
        ? `${verifiedWajib.length}/${wajibPts.length} titik wajib sudah dicek (${pctVerified}%)${oldestVerified?" · verifikasi tertua: "+fmtDateTimeId(oldestVerified):""}. Cek/tandai di halaman Database Titik Pantau.`
        : "Belum ada titik wajib pantau untuk periode ini."},
    {label:"3. Personil Ditunjuk untuk Batch", done: anyPersonilAssigned,
      note: relatedBatches.length ? (anyPersonilAssigned?"Tim sudah ditunjuk di Perencanaan Batch.":"Batch sudah ada tapi belum ada personil ditunjuk.") : "Belum ada batch untuk periode ini — kirim titik terpilih ke batch di bawah."},
    {label:"4. Batch Dibuat & Jadwal Diterapkan", done: anyScheduled,
      note: relatedBatches.length ? (anyScheduled?relatedBatches.length+" batch untuk periode ini, jadwal sudah dibuat.":"Batch ada tapi jadwal belum dibuat — buka Perencanaan Batch.") : "Belum ada batch untuk periode ini."}
  ];
  const doneCount = steps.filter(s=>s.done).length;
  el.innerHTML = `<div class="hint" style="margin-bottom:8px;">${doneCount} dari ${steps.length} langkah selesai untuk periode <b>${escHtml(period)}</b>.</div>`
    + steps.map(s=>`
    <div style="display:flex;align-items:flex-start;gap:9px;padding:7px 0;border-bottom:1px solid var(--gray-200);">
      <span class="badge ${s.done?"b-green":"b-gray"}" style="flex-shrink:0;margin-top:1px;">${s.done?"&#10003;":"&#9675;"}</span>
      <div><b style="font-size:12.5px;">${escHtml(s.label)}</b><div class="muted" style="font-size:11px;margin-top:1px;">${s.note}</div></div>
    </div>`).join("");
}
function renderRencana(){
  document.getElementById("btnRcTable").classList.toggle("primary", rcView==="table");
  document.getElementById("btnRcCard").classList.toggle("primary", rcView==="card");
  document.getElementById("rcTableCard").style.display = rcView==="table" ? "block" : "none";
  document.getElementById("rcCardWrap").style.display = rcView==="card" ? "block" : "none";
  const periodeSel = document.getElementById("rcPeriode");
  if(!periodeSel.dataset.filled){
    periodeSel.innerHTML = listPeriodOptions(4,4).map(lab=>`<option value="${escHtml(lab)}" ${lab===currentPeriodStr()?"selected":""}>${lab}${lab===currentPeriodStr()?" (aktif)":""}</option>`).join("");
    periodeSel.dataset.filled = "1";
  }
  const siteSel = document.getElementById("rcFltSite");
  if(!siteSel.dataset.filled){
    siteSel.innerHTML = `<option value="">Semua</option>` + allSites().map(s=>`<option value="${escHtml(s)}">${s}</option>`).join("");
    siteSel.dataset.filled = "1";
  }
  const period = periodeSel.value || currentPeriodStr();
  const site = siteSel.value;
  const search = document.getElementById("rcFltSearch").value.trim().toLowerCase();

  // Pertahankan centang yang sudah ada selama periode belum berganti (supaya expand/filter ulang
  // tidak mereset pilihan pengguna); reset otomatis kalau ganti periode.
  const existingChecks = new Map();
  if(rcLastPeriode === period){
    document.querySelectorAll(".rcChk").forEach(c=>existingChecks.set(c.dataset.id, c.checked));
  }
  rcLastPeriode = period;

  const all = DB.points.filter(p=>!p.tidakBeroperasi);
  const wajibPts = all.filter(p=>effectiveWajib(p, period));
  const exemptEmg = all.filter(p=>isEmergencyEngine(p) && wajibReason(p, period).type==="emergency-exempt");
  // Sama seperti di Dashboard — checklist verifikasi cuma menghitung titik yg jatuh tempo periode
  // ini (isDueThisPeriod), tabel pemilihan titik di bawah TETAP pakai wajibPts polos (tidak
  // difilter) krn halaman ini memang dipakai utk browse/pilih titik lebih luas, bukan cuma yg
  // due sekarang.
  renderRencanaChecklist(period, wajibPts.filter(p=>isDueThisPeriod(p,period)));

  let rows = wajibPts.slice();
  if(site) rows = rows.filter(p=>p.site===site);
  if(search) rows = rows.filter(p=>p.nama.toLowerCase().includes(search));
  rows.sort((a,b)=> a.site===b.site ? a.nama.localeCompare(b.nama) : a.site.localeCompare(b.site));

  const doneCount = wajibPts.filter(p=>periodOfPointStatus(p,period).startsWith("done")).length;
  const emgTrigCount = wajibPts.filter(p=>isEmergencyEngine(p)).length;
  const belumCount = wajibPts.filter(p=>periodOfPointStatus(p,period)==="pending").length;
  document.getElementById("rcStats").innerHTML = `
    <div class="stat"><div class="num">${wajibPts.length}</div><div class="lbl">Total Wajib Pantau ${escHtml(period)}</div></div>
    <div class="stat good"><div class="num">${doneCount}</div><div class="lbl">Sudah/Pernah Dipantau</div></div>
    <div class="stat warn"><div class="num">${belumCount}</div><div class="lbl">Belum Direncanakan</div></div>
    <div class="stat ${emgTrigCount?"bad":""}"><div class="num">${emgTrigCount}</div><div class="lbl">Termasuk Emergency (RH&gt;200j)</div></div>
  `;

  // Resume per grup sumber (Turbin/Gas Engine/Emergency/Flare/dst) — dihitung dari `rows`, yaitu
  // set yang SAMA dipakai tabel di bawah (sudah kena filter periode+site+cari), jadi otomatis
  // ikut berubah begitu filter di atas diganti. Pola & urutan grup sama persis dengan panel
  // "Progress per Grup Sumber" di Dashboard supaya istilahnya konsisten se-tools.
  const rcGroupRows = KATEGORI_SUMBER_ORDER.map(g=>{
    const gp = rows.filter(p=>subgroupOf(p)===g);
    const d = gp.filter(p=>periodOfPointStatus(p,period).startsWith("done")).length;
    return {label:g, done:d, total:gp.length};
  }).filter(g=>g.total>0);
  document.getElementById("rcGroupBars").innerHTML = rcGroupRows.length
    ? rcGroupRows.map(g=>progressBarRow(g.label, g.done, g.total)).join("")
    : "<div class='hint'>Tidak ada titik wajib pantau yang cocok filter saat ini.</div>";

  document.getElementById("rcTable").innerHTML = `
    <thead><tr><th style="width:26px;"></th><th>Site</th><th>Nama Titik</th><th>Grup</th><th>Dasar Wajib</th><th>Status</th><th>Progress Periode Ini</th></tr></thead>
    <tbody>${rows.map(p=>{
      const chk = existingChecks.has(p.id) ? existingChecks.get(p.id) : true;
      const reason = wajibReason(p, period);
      const dasar = reason.type==="emergency-triggered" ? `Emergency (RH ${reason.rh}j &gt;200j)` : "Reguler";
      return `<tr>
        <td><input type="checkbox" class="rcChk" data-id="${p.id}" ${chk?"checked":""}></td>
        <td>${p.site}</td>
        <td><b>${escHtml(p.nama)}</b></td>
        <td class="muted" style="font-size:11.5px;">${escHtml(subgroupOf(p))}</td>
        <td class="muted" style="font-size:11.5px;">${dasar}</td>
        <td>${pointStatusBadge(p)}</td>
        <td>${rencanaProgressBadge(p, period)}</td>
      </tr>`;
    }).join("") || `<tr><td colspan="7" class="hint" style="padding:14px;">Tidak ada titik wajib pantau yang cocok dengan filter untuk periode ini.</td></tr>`}</tbody>`;

  renderRencanaCards(period, site, search);

  document.getElementById("rcExemptTable").innerHTML = `
    <thead><tr><th>Site</th><th>Nama Titik</th><th>Kategori Sumber</th><th style="text-align:right;">RH Trailing 12 Bln</th><th>Ambang</th></tr></thead>
    <tbody>${exemptEmg.map(p=>{
      const rh = wajibReason(p, period).rh;
      return `<tr><td>${p.site}</td><td>${escHtml(p.nama)}</td><td class="muted">${escHtml(p.kategoriSumber||"-")}</td>
        <td style="text-align:right;">${rh==null?"tidak ada data":rh+" jam"}</td>
        <td class="muted">&le; 200 jam/tahun</td></tr>`;
    }).join("") || `<tr><td colspan="5" class="hint" style="padding:14px;">Tidak ada Emergency Engine yang cocok filter, atau semuanya sudah di atas ambang.</td></tr>`}</tbody>`;
}
document.getElementById("rcPeriode").addEventListener("change", renderRencana);
document.getElementById("rcFltSite").addEventListener("change", renderRencana);
document.getElementById("rcFltSearch").addEventListener("input", renderRencana);

// Tampilan alternatif "kartu per site" — SEMUA titik (bukan cuma yang wajib) dikelompokkan per
// site lalu per grup sumber, satu pill per titik, warna menandakan status. Klik pill = buka
// modal edit yang sama seperti di Database Titik Pantau (link langsung ke data master).
let rcView = "table";
function rencanaPillHtml(p, period){
  const wajib = effectiveWajib(p, period);
  let style = "cursor:pointer;";
  if(!wajib) style += "opacity:.55;background:var(--gray-100);border-style:dashed;";
  else if(p.status==="done") style += "background:#d7f0e2;border-color:#3fb27f;";
  else if(p.status==="scheduled") style += "background:#dbe8fb;border-color:#3d78c9;";
  else if(p.status==="failed") style += "background:#fbdcda;border-color:#e0554f;";
  else style += "background:#fbeacb;border-color:#e8a33d;"; // wajib tapi hold / belum direncanakan
  const title = `${p.site} · ${subgroupOf(p)} · ${wajib?"Wajib":"Tidak Wajib"} periode ${period} · ${pointStatusBadgeText(p)}`;
  return `<span class="pt-pill" style="${style}" data-action="editPoint" data-id="${p.id}" title="${escHtml(title)}">${escHtml(p.nama)}</span>`;
}
function renderRencanaCards(period, site, search){
  const el = document.getElementById("rcCardWrap"); if(!el) return;
  let pts = DB.points.slice();
  if(site) pts = pts.filter(p=>p.site===site);
  if(search) pts = pts.filter(p=>p.nama.toLowerCase().includes(search));
  const bySite = {};
  pts.forEach(p=>{ (bySite[p.site]=bySite[p.site]||[]).push(p); });
  const sites = Object.keys(bySite).sort((a,b)=>{
    const ia=MASTER_SITE_ORDER.indexOf(a), ib=MASTER_SITE_ORDER.indexOf(b);
    return (ia<0?99:ia)-(ib<0?99:ib);
  });
  el.innerHTML = sites.map(s=>{
    const sitePts = bySite[s];
    const bySub = {};
    sitePts.forEach(p=>{ const sg=subgroupOf(p); (bySub[sg]=bySub[sg]||[]).push(p); });
    const subs = Object.keys(bySub).sort((a,b)=>subgroupOrderIdx(bySub[a][0])-subgroupOrderIdx(bySub[b][0]));
    return `<div class="card" style="margin-bottom:10px;">
      <h3 style="margin-bottom:8px;">${s}</h3>
      ${subs.map(sg=>`<div style="margin-bottom:8px;">
        <div class="muted" style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;margin-bottom:4px;">${escHtml(sg)} <span style="font-weight:400;">(${bySub[sg].length})</span></div>
        <div>${bySub[sg].map(p=>rencanaPillHtml(p, period)).join("")}</div>
      </div>`).join("")}
    </div>`;
  }).join("") || "<div class='hint' style='padding:14px;'>Tidak ada titik yang cocok filter.</div>";
}

function sendPlanToBatch(team){
  const period = document.getElementById("rcPeriode").value || currentPeriodStr();
  const checkedIds = [...document.querySelectorAll(".rcChk:checked")].map(c=>c.dataset.id);
  const items = checkedIds.filter(id=>{
    const p = DB.points.find(x=>x.id===id); if(!p) return false;
    return team==="emisi" ? p.kategori==="emisi" : p.kategori!=="emisi";
  });
  if(!items.length){ toast(`Tidak ada titik ${team==="emisi"?"Emisi":"Ambient/Lainnya"} yang tercentang.`,"err"); return; }
  const key = team==="emisi"?"lastBatchIdEmisi":"lastBatchIdAmbient";
  DB.meta[key] = (DB.meta[key]||0)+1;
  const n = DB.meta[key];
  const b = {id: uid("B"), team, name: `Batch ${n} - ${team==="emisi"?"Emisi":"Ambient"} ${period}`,
    period, dayOverrides:{}, finalized:false, finalizedAt:null, baStatusOverrides:{},
    start:"", end:"", ratio: team==="emisi"?4:2, buffer:1, items: items.slice(), schedule:[], assignedPersonil:[]};
  DB.batches.push(b);
  items.forEach(id=>{ const p = DB.points.find(x=>x.id===id); if(p) p.batchId = b.id; });
  logChange(`Batch baru dari Plan Pemantauan periode ${period}: "${b.name}" (${items.length} titik)`);
  save();
  toast(`Batch "${b.name}" dibuat dengan ${items.length} titik. Lanjut isi tanggal di Perencanaan Batch.`,"ok");
  document.getElementById("plTeam").value = team;
  refreshBatchSelect();
  document.getElementById("plBatch").value = b.id;
  showPage("planner");
}

/* =========================================================
   PERSONIL
========================================================= */
function completenessPct(p){
  let ok=0;
  PERSONIL_ITEMS.forEach(it=>{
    const rec = p.items[it];
    if(!rec) return;
    if(it===PERSONIL_NUMBER_FIELD){ if(rec.exp) ok++; }
    else if(PERSONIL_DATED[it]){ if(rec.exp && rec.exp >= todayStr()) ok++; }
    else { if(rec.ada) ok++; }
  });
  return Math.round(ok/PERSONIL_ITEMS.length*100);
}
// Pakai komponen tanggal LOKAL (bukan toISOString, yang mengambil tanggal UTC — bisa mundur
// satu hari kalau jam lokal masih pagi di timezone UTC+, mis. jam 00:00-07:59 WIB).
function todayStr(){
  const d = new Date();
  return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
}
// Batch mana saja tempat personil ini ditunjuk berangkat (dihitung dari batch.assignedPersonil) —
// dipakai supaya halaman Personil & Perencanaan Batch saling ngelink tanpa data ganda.
function batchesForPersonil(personilId){
  return DB.batches
    .filter(b=>(b.assignedPersonil||[]).some(a=>a.id===personilId))
    .map(b=>({batch:b, lead:b.assignedPersonil.find(a=>a.id===personilId).lead}));
}
function renderPersonil(){
  document.getElementById("personilTable").innerHTML = `
  <thead><tr><th style="min-width:120px;">Nama</th><th style="min-width:90px;">Role</th>${PERSONIL_ITEMS.map(it=>`<th style="min-width:104px;white-space:nowrap;">${PERSONIL_LABELS[it]}</th>`).join("")}<th style="min-width:120px;">Kelengkapan</th><th style="min-width:100px;">Dokumentasi</th><th style="min-width:170px;">Ditugaskan di Batch</th><th style="min-width:130px;">Aksi</th></tr></thead>
  <tbody>${DB.personil.map(p=>{
    const pct = completenessPct(p);
    const assignments = batchesForPersonil(p.id);
    return `<tr><td><b>${escHtml(p.nama)}</b></td><td>${p.role}</td>
      ${PERSONIL_ITEMS.map(it=>{
        const rec = p.items[it]||{};
        if(it===PERSONIL_NUMBER_FIELD){
          return rec.exp ? `<td style="white-space:nowrap;">${escHtml(rec.exp)}</td>` : `<td style="white-space:nowrap;"><span class="badge b-red">Kosong</span></td>`;
        } else if(PERSONIL_DATED[it]){
          if(!rec.exp) return `<td style="white-space:nowrap;"><span class="badge b-red">Kosong</span></td>`;
          const days = Math.round((new Date(rec.exp)-new Date())/86400000);
          const badge = days<0?'<span class="badge b-red">Expired</span>':(days<=30?`<span class="badge b-amber">${days} hr lagi</span>`:'<span class="badge b-green">Berlaku</span>');
          return `<td style="white-space:nowrap;">${badge}<div class="muted" style="font-size:10.5px;margin-top:3px;">s.d. ${rec.exp}</div></td>`;
        } else {
          return `<td style="white-space:nowrap;">${rec.ada?'<span class="badge b-green">Ada</span>':'<span class="badge b-red">Tdk Ada</span>'}</td>`;
        }
      }).join("")}
      <td style="min-width:110px;"><div class="progressbar"><div style="width:${pct}%;background:${pct===100?'var(--green-500)':pct>=70?'var(--amber-500)':'var(--red-500)'}"></div></div><span class="muted" style="font-size:11px;">${pct}%</span></td>
      <td>${p.dokumentasiLink ? `<a href="${escHtml(p.dokumentasiLink)}" target="_blank" rel="noopener noreferrer" class="btn small ghost">Buka Link</a>` : '<span class="muted" style="font-size:11px;">-</span>'}</td>
      <td style="min-width:160px;font-size:11px;">${assignments.length ? assignments.map(a=>`<div class="badge ${a.lead?"b-teal":"b-gray"}" style="margin:1px 0;">${escHtml(a.batch.name)}${a.lead?" (Ketua)":""}</div>`).join("") : '<span class="muted">Belum ditugaskan</span>'}</td>
      <td><button class="btn small" data-action="editPersonil" data-id="${p.id}">Edit</button>
          <button class="btn small danger" data-action="deletePersonil" data-id="${p.id}">Hapus</button></td>
    </tr>`;
  }).join("")}</tbody>`;
}
function personilFormHtml(p){
  p = p || {id:"", nama:"", role:"PPC Udara", items:{}, dokumentasiLink:""};
  const itemFields = PERSONIL_ITEMS.map(it=>{
    const rec = p.items[it]||{};
    if(it===PERSONIL_NUMBER_FIELD){
      return `<div class="field"><label>${PERSONIL_LABELS[it]}</label><input type="text" inputmode="numeric" pattern="[0-9]*" id="pi_${it}" value="${escHtml(rec.exp||"")}" placeholder="nomor PTS ID"></div>`;
    } else if(PERSONIL_DATED[it]){
      return `<div class="field"><label>${PERSONIL_LABELS[it]} (exp)</label><input type="date" id="pi_${it}" value="${rec.exp||""}"></div>`;
    } else {
      return `<div class="field"><label>${PERSONIL_LABELS[it]}</label><select id="pi_${it}"><option value="0" ${!rec.ada?"selected":""}>Belum Ada</option><option value="1" ${rec.ada?"selected":""}>Ada</option></select></div>`;
    }
  }).join("");
  return `
  <h3>${p.id?"Edit":"Tambah"} Personil</h3>
  <div class="grid cols-2">
    <div class="field"><label>Nama</label><input type="text" id="p_nama" value="${escHtml(p.nama)}"></div>
    <div class="field"><label>Role</label><select id="p_role"><option ${p.role==="PPC Udara"?"selected":""}>PPC Udara</option><option ${p.role==="Observer"?"selected":""}>Observer</option></select></div>
  </div>
  <div class="grid cols-2" style="margin-top:10px;">${itemFields}</div>
  <div class="field" style="margin-top:10px;"><label>Link Dokumentasi (mis. folder Drive/SharePoint berisi PDF KTP/MCU/dst)</label><input type="url" id="p_dokLink" value="${escHtml(p.dokumentasiLink||"")}" placeholder="https://..."></div>
  <div class="actions">
    <button class="btn ghost" data-action="closeModal">Batal</button>
    <button class="btn primary" data-action="savePersonil" data-id="${p.id}">Simpan</button>
  </div>`;
}
function addPersonil(){ openModal(personilFormHtml(null)); }
function editPersonil(id){ openModal(personilFormHtml(DB.personil.find(p=>p.id===id))); }
function savePersonil(id){
  const items = {};
  PERSONIL_ITEMS.forEach(it=>{
    if(it===PERSONIL_NUMBER_FIELD) items[it] = {exp: document.getElementById("pi_"+it).value.trim()};
    else if(PERSONIL_DATED[it]) items[it] = {exp: document.getElementById("pi_"+it).value};
    else items[it] = {ada: document.getElementById("pi_"+it).value==="1"};
  });
  const val = {nama: document.getElementById("p_nama").value.trim(), role: document.getElementById("p_role").value, items, dokumentasiLink: document.getElementById("p_dokLink").value.trim()};
  if(!val.nama){ toast("Nama wajib diisi.","err"); return; }
  if(id){ Object.assign(DB.personil.find(p=>p.id===id), val); }
  else { DB.personil.push({id: uid("PS"), ...val}); }
  touchDataset("personil"); save(); closeModal(); renderPersonil();
}
function deletePersonil(id){
  askConfirm("Hapus personil ini?", ()=>{
    DB.personil = DB.personil.filter(p=>p.id!==id);
    touchDataset("personil"); save(); renderPersonil(); toast("Personil dihapus.");
  });
}
function exportPersonilCsv(){
  const headers=["nama","role","ktpExp","mcuExp","spkExp","medpassExp","clsrExp","ppcExp","fotoBiruAda","bosietExp","vaksinAda","ptsidExp"];
  const rows = DB.personil.map(p=>({
    nama:p.nama, role:p.role,
    ktpExp:(p.items.ktp||{}).exp||"", mcuExp:(p.items.mcu||{}).exp||"", spkExp:(p.items.spk||{}).exp||"",
    medpassExp:(p.items.medpass||{}).exp||"", clsrExp:(p.items.clsr||{}).exp||"", ppcExp:(p.items.ppc||{}).exp||"",
    fotoBiruAda:(p.items.fotoBiru||{}).ada?1:0, bosietExp:(p.items.bosiet||{}).exp||"",
    vaksinAda:(p.items.vaksin||{}).ada?1:0, ptsidExp:(p.items.ptsid||{}).exp||""
  }));
  csvExport(headers, rows, "personil_export.csv");
}
function importPersonilCsv(){
  const inp = document.getElementById("hiddenCsvFile");
  inp.onchange = ()=>{
    const file = inp.files[0]; if(!file) return;
    const reader = new FileReader();
    reader.onload = ()=>{
      const rows = csvParse(reader.result);
      rows.forEach(r=>{
        if(!r.nama) return;
        DB.personil.push({id: uid("PS"), nama:r.nama, role:r.role||"PPC Udara", items:{
          ktp:{exp:r.ktpExp||""}, mcu:{exp:r.mcuExp||""}, spk:{exp:r.spkExp||""}, medpass:{exp:r.medpassExp||""},
          clsr:{exp:r.clsrExp||""}, ppc:{exp:r.ppcExp||""}, fotoBiru:{ada:/^1|true|ya$/i.test(r.fotoBiruAda||"")},
          bosiet:{exp:r.bosietExp||""}, vaksin:{ada:/^1|true|ya$/i.test(r.vaksinAda||"")}, ptsid:{exp:r.ptsidExp||""}
        }});
      });
      touchDataset("personil"); save(); renderPersonil();
      toast("Import personil selesai: "+rows.length+" baris diproses.","ok");
    };
    reader.readAsText(file);
    inp.value="";
  };
  inp.click();
}

/* =========================================================
   ROSTER PERSONIL (CETAK A4) — utk dibagikan ke ENV site
   ---------------------------------------------------------
   QR code di-generate lokal (vendor/qrcode-generator.js, murni JS tanpa dependensi jaringan)
   supaya tetap jalan walau tools ini dibuka offline via file:// — bukan dari layanan pembuat
   QR online yang butuh koneksi internet tiap kali dicetak.
========================================================= */
function personilDocQrSvg(url){
  if(!url) return "";
  try{
    const qr = qrcode(0, "M");
    qr.addData(url);
    qr.make();
    return qr.createSvgTag({cellSize:2, margin:1});
  }catch(e){ console.error("Gagal membuat QR dokumentasi personil:", e); return ""; }
}
function buildPersonilPrintHtml(){
  const printedAt = new Date().toLocaleString("id-ID", {dateStyle:"long", timeStyle:"short"});
  const rows = DB.personil.slice().sort((a,b)=>a.nama.localeCompare(b.nama));
  const rowsHtml = rows.map((p,i)=>{
    const pct = completenessPct(p);
    const pctColor = pct===100?"#2f9e5b":pct>=70?"#c98a1a":"#c0392b";
    const missing = [];
    PERSONIL_ITEMS.forEach(it=>{
      const rec = p.items[it]||{};
      if(it===PERSONIL_NUMBER_FIELD){ if(!rec.exp) missing.push(PERSONIL_LABELS[it]+" kosong"); }
      else if(PERSONIL_DATED[it]){
        if(!rec.exp) missing.push(PERSONIL_LABELS[it]+" kosong");
        else if(rec.exp < todayStr()) missing.push(PERSONIL_LABELS[it]+" expired ("+rec.exp+")");
      } else if(!rec.ada) missing.push(PERSONIL_LABELS[it]+" tidak ada");
    });
    const qr = personilDocQrSvg(p.dokumentasiLink);
    const docCell = qr
      ? `<div class="pg-qr">${qr}</div><div class="pg-qr-url">${escHtml(p.dokumentasiLink)}</div>`
      : (p.dokumentasiLink ? `<div class="pg-qr-url">${escHtml(p.dokumentasiLink)}</div>` : `<span class="muted">-</span>`);
    return `<tr>
      <td>${i+1}</td>
      <td><b>${escHtml(p.nama)}</b></td>
      <td>${escHtml(p.role)}</td>
      <td style="text-align:center;"><b style="color:${pctColor};">${pct}%</b></td>
      <td style="font-size:8.5px;">${missing.length ? missing.map(escHtml).join("<br>") : '<span style="color:#2f9e5b;">Lengkap</span>'}</td>
      <td style="text-align:center;">${docCell}</td>
    </tr>`;
  }).join("");
  return `<table class="pg-guide-page pg-batch">
    <thead><tr><td>
      <div class="pg-header">
        <div><h1>Roster Personil PPC &amp; Observer</h1><div class="sub">Kelengkapan dokumen &amp; akses dokumentasi pendukung — bahan persiapan &amp; perizinan akses site</div></div>
        <div class="sub" style="text-align:right;">Dicetak ${escHtml(printedAt)}</div>
      </div>
    </td></tr></thead>
    <tfoot><tr><td>
      <div class="pg-foot">Dicetak otomatis dari PHM Emission Sampling Planner &amp; Tracker. Kolom Link Dokumentasi berisi QR code &amp; tautan menuju folder dokumen pendukung (KTP/MCU/dst) tiap personil — scan atau salin tautannya ke browser utk membuka.</div>
    </td></tr></tfoot>
    <tbody><tr><td>
      <table class="pg-table pg-personil-table">
        <thead><tr><th style="width:16px;">No</th><th>Nama</th><th style="width:90px;">Role</th><th style="width:56px;">Kelengkapan</th><th>Dokumen Perlu Perhatian</th><th style="width:110px;">Link Dokumentasi</th></tr></thead>
        <tbody>${rowsHtml || `<tr><td colspan="6">Belum ada data personil.</td></tr>`}</tbody>
      </table>
    </td></tr></tbody>
  </table>`;
}
function printPersonilRoster(){
  if(!DB.personil.length){ toast("Belum ada data personil untuk dicetak.","err"); return; }
  setPrintOrientation("portrait");
  document.getElementById("printGuideArea").innerHTML = buildPersonilPrintHtml();
  window.print();
}

