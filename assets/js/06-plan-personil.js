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

  // Resume Titik Emisi vs Ambient — dihitung dari `rows`, set yang SAMA dipakai tabel di bawah
  // (sudah kena filter periode+site+cari), jadi otomatis ikut berubah begitu filter di atas
  // diganti. Angka besar (kartu .stat, bukan bar tipis) + rincian per site supaya langsung
  // kebaca tanpa harus menyipitkan mata.
  const rcEmisiCount = rows.filter(p=>p.kategori==="emisi").length;
  const rcAmbientCount = rows.length - rcEmisiCount;
  const rcSites = [...new Set(rows.map(p=>p.site))].sort();
  document.getElementById("rcGroupBars").innerHTML = `
    <div class="grid cols-2" style="margin-bottom:12px;">
      <div class="stat"><div class="num">${rcEmisiCount}</div><div class="lbl">Titik Emisi</div></div>
      <div class="stat"><div class="num">${rcAmbientCount}</div><div class="lbl">Titik Ambient (Ambient/Kebisingan/Kebauan/Getaran)</div></div>
    </div>
    <div class="tablewrap"><table>
      <thead><tr><th>Site</th><th style="text-align:right;">Emisi</th><th style="text-align:right;">Ambient</th><th style="text-align:right;">Total</th></tr></thead>
      <tbody>${rcSites.map(s=>{
        const sp = rows.filter(p=>p.site===s);
        const e = sp.filter(p=>p.kategori==="emisi").length;
        const a = sp.length - e;
        return `<tr><td>${escHtml(s)}</td><td style="text-align:right;">${e}</td><td style="text-align:right;">${a}</td><td style="text-align:right;"><b>${sp.length}</b></td></tr>`;
      }).join("") || `<tr><td colspan="4" class="hint" style="padding:10px;">Tidak ada titik wajib pantau yang cocok filter saat ini.</td></tr>`}</tbody>
    </table></div>`;

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

// Cetak A4 "Daftar Titik Pantau per Periode" — daftar sumber emisi & titik ambient (termasuk
// kebisingan/kebauan/getaran) per site, serinci Database Titik Pantau, tapi discope ke satu
// periode tertentu. mode "wajib" = cuma titik yang wajib pantau periode ini (sama seperti isi
// rcTable di layar); mode "all" = SEMUA titik di site terpilih, masing-masing diberi status wajib
// periode ini supaya kelihatan mana yang dipantau & mana yang tidak dlm satu dokumen.
function buildRencanaPrintHtml(period, site, mode){
  let pts = DB.points.slice();
  if(site) pts = pts.filter(p=>p.site===site);
  if(mode==="wajib") pts = pts.filter(p=>!p.tidakBeroperasi && effectiveWajib(p, period));
  if(!pts.length) return null;

  const bySite = {};
  pts.forEach(p=>{ (bySite[p.site]=bySite[p.site]||[]).push(p); });
  const sites = Object.keys(bySite).sort((a,b)=>{
    const ia=MASTER_SITE_ORDER.indexOf(a), ib=MASTER_SITE_ORDER.indexOf(b);
    return (ia<0?99:ia)-(ib<0?99:ib);
  });

  const printedAt = new Date().toLocaleString("id-ID", {dateStyle:"long", timeStyle:"short"});
  const totalEmisi = pts.filter(p=>p.kategori==="emisi").length;
  const totalAmbient = pts.length - totalEmisi;

  const siteBlocks = sites.map(s=>{
    const sitePts = bySite[s].slice().sort((a,b)=>{
      const gi = subgroupOrderIdx(a)-subgroupOrderIdx(b);
      return gi!==0 ? gi : a.nama.localeCompare(b.nama);
    });
    const wajibCount = sitePts.filter(p=>effectiveWajib(p, period)).length;
    const rowsHtml = sitePts.map((p,i)=>{
      const spec = specLineFor(p) || [p.kapasitas, p.jenisBahanBakar].filter(Boolean).join(", ") || "-";
      return `<tr>
        <td>${i+1}</td>
        <td><span class="badge b-gray">${escHtml(monitoringTypeLabel(p))}</span></td>
        <td><b>${escHtml(p.nama)}</b></td>
        <td class="muted" style="font-size:8.5px;">${escHtml(subgroupOf(p))}${p.kategori==="emisi"&&p.kategoriSumber?`<div>${escHtml(p.kategoriSumber)}</div>`:""}</td>
        <td>${escHtml(spec)}</td>
        <td>${escHtml(p.parameter||"-")}</td>
        <td>${wajibBadgeHtml(p, period)}</td>
        <td>${pointStatusBadge(p)}</td>
        <td style="white-space:nowrap;">${prediksiCellHtml(p)}</td>
      </tr>`;
    }).join("");
    return `<div class="pg-site">
      <div class="pg-site-head"><span>Site ${escHtml(s)} (${sitePts.length} titik${mode==="all"?`, ${wajibCount} wajib periode ini`:""})</span></div>
      <table class="pg-table">
        <thead><tr><th style="width:16px;">No</th><th style="width:70px;">Jenis Pantau</th><th>Nama Titik</th><th style="width:110px;">Grup / Sumber</th><th style="width:90px;">Spesifikasi</th><th>Parameter Wajib</th><th style="width:110px;">Wajib Periode Ini</th><th style="width:70px;">Status</th><th style="width:80px;">Prediksi</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>`;
  }).join("");

  return `<table class="pg-guide-page">
    <thead><tr><td>
      <div class="pg-header">
        <div>
          <h1>Daftar Titik Pantau Emisi &amp; Ambient</h1>
          <div class="sub">Periode ${escHtml(period)}${site?` &middot; Site ${escHtml(site)}`:" &middot; Semua Site"} &middot; ${mode==="wajib"?"Hanya yang wajib dipantau periode ini":"Semua titik, lengkap dengan status wajib/tidaknya"}</div>
        </div>
        <div class="sub" style="text-align:right;">Dicetak ${escHtml(printedAt)}</div>
      </div>
      <div class="pg-meta">
        <div><b>Total Titik</b>${pts.length} titik</div>
        <div><b>Titik Emisi</b>${totalEmisi} titik</div>
        <div><b>Titik Ambient</b>${totalAmbient} titik (Ambient/Kebisingan/Kebauan/Getaran)</div>
        <div><b>Jumlah Site</b>${sites.length} site</div>
      </div>
    </td></tr></thead>
    <tfoot><tr><td>
      <div class="pg-foot">Dicetak otomatis dari PHM Emission Sampling Planner &amp; Tracker &mdash; halaman Plan Pemantauan per Periode. Kolom "Wajib Periode Ini" memperhitungkan ambang RH Emergency Engine (&gt;200 jam/tahun trailing 12 bulan) utk periode yang dipilih.</div>
    </td></tr></tfoot>
    <tbody><tr><td>${siteBlocks}</td></tr></tbody>
  </table>`;
}
function printRencanaExport(){
  const period = document.getElementById("rcPeriode").value || currentPeriodStr();
  const site = document.getElementById("rcFltSite").value;
  const probe = buildRencanaPrintHtml(period, site, "wajib");
  if(!probe){ toast("Tidak ada titik yang cocok (periode/site terpilih) untuk dicetak.","err"); return; }
  openModal(`
    <h3>Preferensi Cetak Daftar Titik Pantau</h3>
    <div class="hint" style="margin-bottom:8px;">Periode: <b>${escHtml(period)}</b> &middot; Site: <b>${site?escHtml(site):"Semua Site"}</b> (ikut filter yang sedang aktif di halaman ini).</div>
    <div class="field"><label>Titik yang Dicetak</label>
      <select id="rpMode">
        <option value="wajib">Hanya yang Wajib Dipantau Periode Ini</option>
        <option value="all">Semua Titik (dengan status wajib/tidak per titik)</option>
      </select>
    </div>
    <div class="field" style="margin-top:10px;"><label>Orientasi Kertas</label>
      <select id="rpOrientation"><option value="landscape">Lanskap (Landscape) &mdash; disarankan, kolomnya cukup banyak</option><option value="portrait">Potret (Portrait)</option></select>
    </div>
    <div class="actions"><button class="btn ghost" data-action="closeModal">Batal</button><button class="btn primary" data-action="doPrintRencanaExport">Cetak</button></div>
  `);
}
function doPrintRencanaExport(){
  const period = document.getElementById("rcPeriode").value || currentPeriodStr();
  const site = document.getElementById("rcFltSite").value;
  const mode = document.getElementById("rpMode").value;
  const orientation = document.getElementById("rpOrientation").value;
  const html = buildRencanaPrintHtml(period, site, mode);
  if(!html){ toast("Tidak ada titik yang cocok untuk dicetak.","err"); closeModal(); return; }
  setPrintOrientation(orientation);
  document.getElementById("printGuideArea").innerHTML = html;
  closeModal();
  const originalTitle = document.title;
  document.title = `Daftar Titik Pantau_${period}${site?"_"+site:""}`;
  window.print();
  document.title = originalTitle;
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
  // Nama & Role dibekukan (sticky) horizontal — tabel ini lebar (10 kolom dokumen + dst), tanpa ini
  // dua kolom identitas itu ikut hilang begitu discroll ke kanan, jadi susah tahu baris siapa yang
  // lagi dilihat. Pola & lebar sama dgn .dg-col-sticky di Gantt (kolom Site).
  document.getElementById("personilTable").innerHTML = `
  <thead><tr><th class="pz-nama">Nama</th><th class="pz-role">Role</th>${PERSONIL_ITEMS.map(it=>`<th style="min-width:104px;white-space:nowrap;">${PERSONIL_LABELS[it]}</th>`).join("")}<th style="min-width:120px;">Kelengkapan</th><th style="min-width:100px;">Dokumentasi</th><th style="min-width:170px;">Ditugaskan di Batch</th><th style="min-width:130px;">Aksi</th></tr></thead>
  <tbody>${DB.personil.map(p=>{
    const pct = completenessPct(p);
    const assignments = batchesForPersonil(p.id);
    return `<tr><td class="pz-nama" title="${escHtml(p.nama)}"><b>${escHtml(p.nama)}</b>${p.telepon?`<div class="muted" style="font-size:10.5px;margin-top:1px;">${escHtml(p.telepon)}</div>`:""}</td><td class="pz-role">${p.role}</td>
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
  renderPersonilAlokasi();
}
// Timeline "personil X pindah dari site A (tgl) ke site B (tgl)" — dihitung dari batch yang sudah
// ditunjuk (assignedPersonil, lihat Perencanaan Batch) beserta jadwal per-site batch itu
// (b.schedule), BUKAN data terpisah, jadi otomatis ikut kalau penunjukan/jadwal berubah.
function renderPersonilAlokasi(){
  const el = document.getElementById("personilAlokasi");
  if(!el) return;
  const rows = DB.personil.map(p=>{
    const items = [];
    batchesForPersonil(p.id).forEach(({batch, lead})=>{
      (batch.schedule||[]).forEach(row=>{
        items.push({site: row.site, start: row.start, end: row.end, batchName: batch.name, team: batch.team, lead});
      });
    });
    items.sort((a,b)=> (a.start||"").localeCompare(b.start||""));
    return {p, items};
  }).filter(r=>r.items.length);

  el.innerHTML = rows.length ? rows.map(r=>`
    <div class="pal-card">
      <div class="pal-name"><b>${escHtml(r.p.nama)}</b> <span class="muted" style="font-weight:400;">(${escHtml(r.p.role)})</span></div>
      <div class="pal-timeline">
        ${r.items.map((it,i)=>`
          ${i>0?'<span class="pal-arrow">&rarr;</span>':""}
          <div class="pal-item" title="${escHtml(it.batchName)}${it.lead?" — Ketua Tim":""}">
            <span class="badge ${it.team==="emisi"?"b-teal":"b-blue"}">${escHtml(it.site)}</span>
            <span class="pal-date">${escHtml(it.start||"?")} &rarr; ${escHtml(it.end||"?")}</span>
          </div>`).join("")}
      </div>
    </div>`).join("")
    : "<div class='hint' style='padding:10px;'>Belum ada personil yang ditugaskan ke batch manapun — tunjuk dulu di Perencanaan Batch.</div>";
}
const PERSONIL_ROLES = ["PPC Emisi","PPC Ambient","Observer"];
function personilFormHtml(p){
  p = p || {id:"", nama:"", role:"PPC Emisi", items:{}, dokumentasiLink:"", telepon:""};
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
  // Role lama ("PPC Udara", sebelum dipecah jadi Emisi/Ambient) tetap ditampilkan sbg opsi kalau
  // personil ini masih memakainya, supaya tidak diam-diam ganti ke opsi pertama pas form dibuka —
  // user perlu pilih manual jadi Emisi atau Ambient (tidak bisa ditebak otomatis dari data lama).
  const roleOptions = PERSONIL_ROLES.includes(p.role) || !p.role ? PERSONIL_ROLES : [p.role, ...PERSONIL_ROLES];
  return `
  <h3>${p.id?"Edit":"Tambah"} Personil</h3>
  <div class="grid cols-2">
    <div class="field"><label>Nama</label><input type="text" id="p_nama" value="${escHtml(p.nama)}"></div>
    <div class="field"><label>Role</label><select id="p_role">${roleOptions.map(r=>`<option ${p.role===r?"selected":""}>${escHtml(r)}</option>`).join("")}</select></div>
  </div>
  <div class="grid cols-2" style="margin-top:10px;">
    <div class="field"><label>No. Telepon / WhatsApp</label><input type="tel" id="p_telepon" value="${escHtml(p.telepon||"")}" placeholder="08xx-xxxx-xxxx"></div>
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
  const val = {nama: document.getElementById("p_nama").value.trim(), role: document.getElementById("p_role").value, items, dokumentasiLink: document.getElementById("p_dokLink").value.trim(), telepon: document.getElementById("p_telepon").value.trim()};
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
        DB.personil.push({id: uid("PS"), nama:r.nama, role:r.role||"PPC Emisi", items:{
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
   KELENGKAPAN DATA PERSONIL (CETAK A4) — utk dibagikan ke ENV site
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
// Baris "Label: nilai" per item (KTP/MCU/dst) LENGKAP dgn tanggal kedaluwarsanya — beda dari badge
// ringkas di tabel layar (yang cuma nunjukin status), di sini semua item ditulis apa adanya
// (termasuk yg masih berlaku) supaya kelengkapan datanya kelihatan utuh begitu dicetak di kertas.
function personilItemDetailHtml(p){
  return PERSONIL_ITEMS.map(it=>{
    const rec = p.items[it]||{};
    let text, color;
    if(it===PERSONIL_NUMBER_FIELD){
      if(rec.exp){ text = "No. "+rec.exp; color = "#333"; } else { text = "kosong"; color = "#c0392b"; }
    } else if(PERSONIL_DATED[it]){
      if(!rec.exp){ text = "kosong"; color = "#c0392b"; }
      else {
        const days = Math.round((new Date(rec.exp)-new Date())/86400000);
        text = "s.d. "+rec.exp;
        color = days<0 ? "#c0392b" : days<=30 ? "#c98a1a" : "#2f9e5b";
      }
    } else {
      text = rec.ada ? "Ada" : "Tidak ada";
      color = rec.ada ? "#2f9e5b" : "#c0392b";
    }
    return `<div class="pg-pi-item"><b>${escHtml(PERSONIL_LABELS[it])}:</b> <span style="color:${color};">${escHtml(text)}</span></div>`;
  }).join("");
}
function buildPersonilPrintHtml(){
  const printedAt = new Date().toLocaleString("id-ID", {dateStyle:"long", timeStyle:"short"});
  const rows = DB.personil.slice().sort((a,b)=>a.nama.localeCompare(b.nama));
  const rowsHtml = rows.map((p,i)=>{
    const pct = completenessPct(p);
    const pctColor = pct===100?"#2f9e5b":pct>=70?"#c98a1a":"#c0392b";
    const qr = personilDocQrSvg(p.dokumentasiLink);
    const docCell = qr
      ? `<div class="pg-qr">${qr}</div><div class="pg-qr-url">${escHtml(p.dokumentasiLink)}</div>`
      : (p.dokumentasiLink ? `<div class="pg-qr-url">${escHtml(p.dokumentasiLink)}</div>` : `<span class="muted">-</span>`);
    return `<tr>
      <td>${i+1}</td>
      <td><b>${escHtml(p.nama)}</b></td>
      <td>${escHtml(p.role)}</td>
      <td style="text-align:center;"><b style="color:${pctColor};">${pct}%</b></td>
      <td><div class="pg-pi-grid">${personilItemDetailHtml(p)}</div></td>
      <td style="text-align:center;">${docCell}</td>
    </tr>`;
  }).join("");
  return `<table class="pg-guide-page pg-batch">
    <thead><tr><td>
      <div class="pg-header">
        <div><h1>Kelengkapan Data Personil</h1><div class="sub">PPC Emisi, PPC Ambient &amp; Observer — rincian dokumen beserta tanggal kedaluwarsa, bahan persiapan &amp; perizinan akses site</div></div>
        <div class="sub" style="text-align:right;">Dicetak ${escHtml(printedAt)}</div>
      </div>
    </td></tr></thead>
    <tfoot><tr><td>
      <div class="pg-foot">Dicetak otomatis dari PHM Emission Sampling Planner &amp; Tracker. Kolom Link Dokumentasi berisi QR code &amp; tautan menuju folder dokumen pendukung (KTP/MCU/dst) tiap personil — scan atau salin tautannya ke browser utk membuka.</div>
    </td></tr></tfoot>
    <tbody><tr><td>
      <table class="pg-table pg-personil-table">
        <thead><tr><th style="width:16px;">No</th><th>Nama</th><th style="width:90px;">Role</th><th style="width:56px;">Kelengkapan</th><th>Rincian Dokumen &amp; Tanggal Kedaluwarsa</th><th style="width:110px;">Link Dokumentasi</th></tr></thead>
        <tbody>${rowsHtml || `<tr><td colspan="6">Belum ada data personil.</td></tr>`}</tbody>
      </table>
    </td></tr></tbody>
  </table>`;
}
function printPersonilRoster(){
  if(!DB.personil.length){ toast("Belum ada data personil untuk dicetak.","err"); return; }
  setPrintOrientation("portrait");
  document.getElementById("printGuideArea").innerHTML = buildPersonilPrintHtml();
  // document.title dipakai browser sbg nama file bawaan di dialog "Simpan sebagai PDF" — pola sama
  // dengan baExportFilename() di Berita Acara, diset sementara lalu dikembalikan lagi sesudahnya.
  const originalTitle = document.title;
  document.title = `Kelengkapan Data Personil_${DB.meta.semester} ${DB.meta.tahun}`;
  window.print();
  document.title = originalTitle;
}

