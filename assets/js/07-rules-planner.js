/* =========================================================
   RULES / SITE SETTINGS
========================================================= */
function allSites(){ return [...new Set(DB.points.map(p=>p.site))].sort(); }
function ensureSiteRule(site){
  if(!DB.siteRules[site]) DB.siteRules[site] = {crewChangeDay:"", blocked:[], ratioEmisi:4, ratioAmbient:2, transport:"", flareOneDay:false};
  else if(DB.siteRules[site].flareOneDay===undefined) DB.siteRules[site].flareOneDay = false;
  return DB.siteRules[site];
}
// Dipakai di halaman Aturan Site & Rute DAN widget ringkas di Perencanaan Batch — supaya
// urutan rute bisa diubah dari kedua tempat, bukan cuma dari settingan site.
// Preview jadwal site ini kalau sudah ada batch (periode aktif, tim terkait) yang jadwalnya
// sudah dibuat di Perencanaan Batch — supaya urutan rute di sini "ngelink" dengan jadwal nyata.
function siteSchedulePreview(site, team){
  if(!team) return null;
  const period = currentPeriodStr();
  const batches = DB.batches.filter(b=>b.team===team && b.period===period && b.schedule && b.schedule.length);
  for(const b of batches){
    const row = b.schedule.find(r=>r.site===site);
    if(row) return {batchName:b.name, start:row.start, end:row.end};
  }
  return null;
}
function renderRouteList(containerId, listKey){
  const el = document.getElementById(containerId); if(!el) return;
  const team = listKey==="routeEmisi" ? "emisi" : (listKey==="routeAmbient" ? "ambient" : null);
  el.innerHTML = DB[listKey].map((s,i)=>{
    const prev = siteSchedulePreview(s, team);
    return `
    <li draggable="true" data-list="${listKey}" data-idx="${i}">
      <span class="route-drag-handle" title="Tarik untuk urutkan">&#8942;&#8942;</span>
      <span><b>${i+1}.</b> ${escHtml(s)}${prev?`<div class="muted" style="font-size:10px;margin-top:2px;">&#128197; ${prev.start} &rarr; ${prev.end} <span style="opacity:.75;">(${escHtml(prev.batchName)})</span></div>`:""}</span>
      <span class="rbtns">
        <button class="btn small ghost" data-action="moveRoute" data-list="${listKey}" data-idx="${i}" data-dir="-1">&#8593;</button>
        <button class="btn small ghost" data-action="moveRoute" data-list="${listKey}" data-idx="${i}" data-dir="1">&#8595;</button>
      </span>
    </li>`;
  }).join("");
}
function refreshRouteViews(){
  renderRouteList("routeAmbient","routeAmbient");
  renderRouteList("routeEmisi","routeEmisi");
  renderPlannerRouteWidget();
}
function renderPlannerRouteWidget(){
  const teamEl = document.getElementById("plTeam"); if(!teamEl) return;
  const team = teamEl.value;
  renderRouteList("plRouteList", team==="emisi"?"routeEmisi":"routeAmbient");
}
document.addEventListener("dragstart", e=>{
  const li = e.target.closest(".route-list li[draggable='true']");
  if(!li) return;
  e.dataTransfer.setData("text/plain", JSON.stringify({list:li.dataset.list, idx:Number(li.dataset.idx)}));
  e.dataTransfer.effectAllowed = "move";
});
document.addEventListener("dragover", e=>{
  const li = e.target.closest(".route-list li[draggable='true']");
  if(!li) return;
  e.preventDefault();
  li.classList.add("dragover");
});
document.addEventListener("dragleave", e=>{
  const li = e.target.closest(".route-list li[draggable='true']");
  if(li) li.classList.remove("dragover");
});
document.addEventListener("drop", e=>{
  const li = e.target.closest(".route-list li[draggable='true']");
  if(!li) return;
  e.preventDefault();
  li.classList.remove("dragover");
  let payload; try{ payload = JSON.parse(e.dataTransfer.getData("text/plain")); }catch(_){ return; }
  if(!payload || payload.list!==li.dataset.list) return;
  const arr = DB[payload.list];
  const from = payload.idx, to = Number(li.dataset.idx);
  if(from===to || !arr[from]) return;
  const [item] = arr.splice(from,1);
  arr.splice(to,0,item);
  logChange(`Urutan rute ${payload.list==="routeEmisi"?"Emisi":"Ambient"} diubah — "${item}" dipindah ke posisi ${to+1}`);
  save();
  refreshRouteViews();
});
function renderRules(){
  allSites().forEach(ensureSiteRule);
  renderRouteList("routeAmbient","routeAmbient");
  renderRouteList("routeEmisi","routeEmisi");

  document.getElementById("siteRuleCards").innerHTML = allSites().map(s=>{
    const r = ensureSiteRule(s);
    const hasFlare = DB.points.some(p=>p.site===s && p.kategori==="emisi" && normKS(p.kategoriSumber)==="FLARE");
    return `<div class="card" style="padding:12px 14px;margin-bottom:0;">
      <h3 style="margin-bottom:10px;">${s}</h3>
      <div class="field"><label>Hari Crew Change</label><select data-action="setCrewDay" data-site="${s}">
        <option value="" ${r.crewChangeDay===""?"selected":""}>Tidak ada</option>
        ${DOW_LABEL.map((d,i)=>`<option value="${i}" ${String(r.crewChangeDay)===String(i)?"selected":""}>${d}</option>`).join("")}
      </select></div>
      <div class="grid cols-2" style="margin-top:8px;">
        <div class="field"><label>Rasio Emisi (titik/hari)</label><input type="number" min="0.5" step="0.5" value="${r.ratioEmisi}" data-action="setRatio" data-site="${s}" data-field="ratioEmisi"></div>
        <div class="field"><label>Rasio Ambient (titik/hari)</label><input type="number" min="0.5" step="0.5" value="${r.ratioAmbient}" data-action="setRatio" data-site="${s}" data-field="ratioAmbient"></div>
      </div>
      <div class="field" style="margin-top:8px;"><label>Catatan Transport</label><input type="text" value="${escHtml(r.transport||"")}" data-action="setTransport" data-site="${s}" placeholder="mis. darat, seatruck, offshore"></div>
      ${hasFlare ? `<label class="checkline" style="margin-top:10px;"><input type="checkbox" data-action="setFlareOneDay" data-site="${s}" ${r.flareOneDay?"checked":""}> Semua titik Flare di site ini selesai dalam 1 hari (tidak dihitung per titik terhadap Rasio Emisi)</label>` : ""}
    </div>`;
  }).join("");

  const blkSel = document.getElementById("blkSite");
  blkSel.innerHTML = allSites().map(s=>`<option value="${s}">${s}</option>`).join("");

  let blkRows=[];
  allSites().forEach(s=>{ (DB.siteRules[s].blocked||[]).forEach((b,i)=>blkRows.push({site:s, idx:i, ...b})); });
  document.getElementById("blockedTable").innerHTML = `
    <thead><tr><th>Site</th><th>Mulai</th><th>Selesai</th><th>Alasan</th><th>Aksi</th></tr></thead>
    <tbody>${blkRows.map(b=>`<tr><td>${b.site}</td><td>${b.start}</td><td>${b.end}</td><td>${escHtml(b.reason)}</td>
      <td><button class="btn small danger" data-action="removeBlocked" data-site="${b.site}" data-idx="${b.idx}">Hapus</button></td></tr>`).join("")}</tbody>`;
}

/* =========================================================
   PLANNER / SCHEDULING ENGINE
========================================================= */
function getBatchesForTeam(team){ return DB.batches.filter(b=>b.team===team); }
function currentBatch(){
  const team = document.getElementById("plTeam").value;
  const bid = document.getElementById("plBatch").value;
  return DB.batches.find(b=>b.id===bid && b.team===team);
}
function refreshBatchSelect(){
  const team = document.getElementById("plTeam").value;
  const sel = document.getElementById("plBatch");
  const list = getBatchesForTeam(team);
  sel.innerHTML = list.map(b=>`<option value="${b.id}">${b.name}</option>`).join("") || "<option value=''>(belum ada batch)</option>";
}
document.getElementById("plTeam").addEventListener("change", ()=>{ refreshBatchSelect(); loadBatchIntoForm(); renderPlanner(); });
document.getElementById("plBatch").addEventListener("change", ()=>{ loadBatchIntoForm(); renderPlanner(); });

function newBatch(){
  const team = document.getElementById("plTeam").value;
  const key = team==="emisi"?"lastBatchIdEmisi":"lastBatchIdAmbient";
  DB.meta[key] = (DB.meta[key]||0)+1;
  const n = DB.meta[key];
  const b = {id: uid("B"), team, name: `Batch ${n} - ${team==="emisi"?"Emisi":"Ambient"} ${DB.meta.semester} ${DB.meta.tahun}`,
    period: currentPeriodStr(), dayOverrides:{}, finalized:false, finalizedAt:null, baStatusOverrides:{},
    start:"", end:"", ratio: team==="emisi"?4:2, buffer:1, items:[], schedule:[], assignedPersonil:[]};
  DB.batches.push(b); save();
  logChange(`Batch baru dibuat: "${b.name}"`);
  refreshBatchSelect();
  document.getElementById("plBatch").value = b.id;
  loadBatchIntoForm(); renderPlanner();
}
function deleteBatch(){
  const b = currentBatch(); if(!b) return;
  askConfirm("Hapus batch ini? Titik yang terkait akan dilepas dari batch.", ()=>{
    snapshotBefore(`Sebelum hapus batch "${b.name}"`);
    DB.points.forEach(p=>{ if(p.batchId===b.id){ p.batchId=""; p.status="pending"; p.planStart=""; p.planEnd=""; } });
    DB.batches = DB.batches.filter(x=>x.id!==b.id);
    logChange(`Batch "${b.name}" dihapus`);
    save(); refreshBatchSelect(); loadBatchIntoForm(); renderPlanner(); toast("Batch dihapus.");
  });
}
function loadBatchIntoForm(){
  const b = currentBatch();
  document.getElementById("plName").value = b?b.name:"";
  document.getElementById("plStart").value = b?b.start:"";
  document.getElementById("plEnd").value = b?(b.end||""):"";
  document.getElementById("plRatio").value = b?b.ratio:4;
  document.getElementById("plBuffer").value = b?b.buffer:1;
}
["plName","plStart","plEnd","plRatio","plBuffer"].forEach(id=>{
  // "input" (bukan "change") supaya nilai langsung tersimpan tiap ketukan/spinner klik —
  // "change" baru menyimpan saat blur, jadi kalau user ganti batch/halaman sebelum blur,
  // nilai yang baru diketik (mis. buffer "0") hilang dan balik ke nilai lama.
  document.getElementById(id).addEventListener("input", ()=>{
    const b = currentBatch(); if(!b) return;
    b.name = document.getElementById("plName").value;
    b.start = document.getElementById("plStart").value;
    b.end = document.getElementById("plEnd").value;
    b.ratio = Number(document.getElementById("plRatio").value)||1;
    b.buffer = Number(document.getElementById("plBuffer").value)||0;
    save(); refreshBatchSelect();
    if(id==="plEnd" || id==="plStart") renderScheduleTable(b);
  });
});

// Tim personil per batch — data disimpan di batch.assignedPersonil = [{id, lead}], bukan di
// data personil itu sendiri (personil = bank data, batch = siapa berangkat kapan).
function renderPlannerPersonilTeam(){
  const el = document.getElementById("plPersonilTeam"); if(!el) return;
  const b = currentBatch();
  if(!b){ el.innerHTML = "<div class='hint' style='padding:10px;'>Pilih/buat batch dulu.</div>"; return; }
  if(!DB.personil.length){ el.innerHTML = "<div class='hint' style='padding:10px;'>Belum ada data personil. Tambahkan dulu di halaman Personil PPC &amp; Observer.</div>"; return; }
  const assigned = b.assignedPersonil || [];
  const assignedMap = new Map(assigned.map(a=>[a.id, a.lead]));
  el.innerHTML = `<table><thead><tr><th style="width:32px;"></th><th>Nama</th><th>Role</th><th style="width:120px;">Ketua Tim</th></tr></thead>
    <tbody>${DB.personil.map(p=>{
      const checked = assignedMap.has(p.id);
      const isLead = assignedMap.get(p.id)===true;
      return `<tr>
        <td><input type="checkbox" class="plPersChk" data-id="${p.id}" ${checked?"checked":""}></td>
        <td>${escHtml(p.nama)}</td>
        <td class="muted">${escHtml(p.role)}</td>
        <td><label class="checkline"><input type="radio" name="plPersLead" class="plPersLead" data-id="${p.id}" ${isLead?"checked":""} ${checked?"":"disabled"}> Ketua</label></td>
      </tr>`;
    }).join("")}</tbody></table>
    <div class="hint" id="plPersonilSummary" style="margin-top:8px;"></div>`;
  updatePlPersonilSummary(b);
}
function updatePlPersonilSummary(b){
  const el = document.getElementById("plPersonilSummary"); if(!el) return;
  const assigned = b.assignedPersonil||[];
  if(!assigned.length){ el.textContent = "Belum ada personil ditunjuk berangkat untuk batch ini."; return; }
  const names = assigned.map(a=>{
    const p = DB.personil.find(x=>x.id===a.id);
    return p ? escHtml(p.nama)+(a.lead?" (Ketua Tim)":"") : null;
  }).filter(Boolean);
  el.innerHTML = "<b>Berangkat:</b> "+(names.join(", ")||"-");
}
document.addEventListener("change", e=>{
  if(e.target.classList && e.target.classList.contains("plPersChk")){
    const b = currentBatch(); if(!b) return;
    if(!b.assignedPersonil) b.assignedPersonil = [];
    const id = e.target.dataset.id;
    if(e.target.checked){
      if(!b.assignedPersonil.some(a=>a.id===id)) b.assignedPersonil.push({id, lead:false});
    } else {
      b.assignedPersonil = b.assignedPersonil.filter(a=>a.id!==id);
    }
    save(); renderPlannerPersonilTeam();
  }
  if(e.target.classList && e.target.classList.contains("plPersLead")){
    const b = currentBatch(); if(!b) return;
    const id = e.target.dataset.id;
    (b.assignedPersonil||[]).forEach(a=>{ a.lead = (a.id===id); });
    save(); renderPlannerPersonilTeam();
  }
});

let plExpanded = new Set();
let plLastRenderedBatchId = null;
function renderPlanner(){
  refreshBatchSelect();
  const b = currentBatch();
  const team = document.getElementById("plTeam").value;
  renderPlannerRouteWidget();
  renderPlannerPersonilTeam();
  document.getElementById("plScheduleCard").style.display = (b && b.schedule && b.schedule.length) ? "block" : "none";
  if(!b){ plLastRenderedBatchId = null; document.getElementById("plPointPicker").innerHTML = "<div class='hint' style='padding:14px;'>Klik <b>+ Batch Baru</b> di atas untuk mulai.</div>"; document.getElementById("plScheduleTable").innerHTML=""; updateSelectedCount(); return; }
  loadBatchIntoForm();

  // Preserve checkbox choices already on screen (e.g. after expand/collapse) instead of
  // re-deriving them from scratch — otherwise re-rendering the tree silently re-checks
  // boxes the user had just unchecked.
  const existingChecks = new Map();
  if(plLastRenderedBatchId === b.id){
    document.querySelectorAll(".ptChk").forEach(c=>{ existingChecks.set(c.dataset.id, c.checked); });
  }
  plLastRenderedBatchId = b.id;

  const eligible = DB.points.filter(p=>{
    if(team==="emisi") { if(p.kategori!=="emisi") return false; }
    else { if(p.kategori==="emisi") return false; }
    // Titik wajib pantau MUNCUL otomatis spt biasa; titik yang TIDAK wajib tapi sudah dicentang
    // Verifikasi di Database (verifyStatus==="verified") juga ikut dimunculkan di sini — itu cara
    // user secara sengaja bilang "saya tetap mau pantau ini periode ini walau bukan wajib" (mis.
    // permintaan khusus), tanpa harus buka form edit & centang toggle "Wajib" segala. Ditandai
    // beda visualnya di baris (lihat badge "manual" di bawah) supaya tetap jelas beda dari yg
    // memang wajib menurut aturan.
    if(!(effectiveWajib(p) || verifyStatus(p)==="verified") || p.tidakBeroperasi) return false;
    if(p.status==="done") return false;
    if(p.batchId && p.batchId!==b.id) return false; // already in another batch
    return true;
  });
  const bySite = {};
  eligible.forEach(p=>{ (bySite[p.site]=bySite[p.site]||[]).push(p); });
  const route = team==="emisi"?DB.routeEmisi:DB.routeAmbient;
  const orderedSites = route.filter(s=>bySite[s]);
  Object.keys(bySite).forEach(s=>{ if(!orderedSites.includes(s)) orderedSites.push(s); });

  const isFresh = !b.items || b.items.length===0;

  document.getElementById("plPointPicker").innerHTML = orderedSites.map(site=>{
    const sitePts = bySite[site];
    const siteExpanded = plExpanded.has(site);
    const bySub = {};
    sitePts.forEach(p=>{ const sg = subgroupOf(p); (bySub[sg]=bySub[sg]||[]).push(p); });
    const subs = Object.keys(bySub).sort((a,c)=>subgroupOrderIdx(bySub[a][0])-subgroupOrderIdx(bySub[c][0]));
    let html = `<div class="tree-site">
      <div class="tree-head">
        <span class="tree-toggle" data-action="togglePlGroup" data-key="${escHtml(site)}">
          <span class="tree-caret">${siteExpanded?"&#9660;":"&#9654;"}</span>
          <b>${site}</b> <span class="muted" style="color:#9db3c9;">— ${sitePts.length} titik</span>
        </span>
        <span class="spacer"></span>
        <button class="btn small ghost" data-action="siteAllToggle" data-site="${escHtml(site)}">pilih/kosongkan semua</button>
      </div>
      <div style="display:${siteExpanded?"block":"none"};">`;
    subs.forEach(sg=>{
      const subKey = site+"::"+sg;
      const subExpanded = plExpanded.has(subKey);
      const pts = bySub[sg];
      html += `<div class="tree-sub">
        <div class="tree-subhead">
          <span class="tree-toggle" data-action="togglePlGroup" data-key="${escHtml(subKey)}">
            <span class="tree-caret">${subExpanded?"&#9660;":"&#9654;"}</span>
            ${escHtml(sg)} <span class="muted">(${pts.length})</span>
          </span>
          <span class="spacer"></span>
          <button class="btn small ghost" data-action="subAllToggle" data-site="${escHtml(site)}" data-sub="${escHtml(sg)}">pilih/kosongkan</button>
        </div>
        <div style="display:${subExpanded?"block":"none"};">
        <table class="tree-table"><thead><tr><th style="width:30px;"></th><th>Nama</th><th style="width:110px;">${rhColumnLabel(currentPeriodStr())}</th><th style="width:90px;">Prediksi</th></tr></thead><tbody>`;
      pts.forEach(p=>{
        const defaultChecked = isFresh || p.batchId===b.id;
        const chk = existingChecks.has(p.id) ? existingChecks.get(p.id) : defaultChecked;
        const rhVal = rhYearValue(p, currentPeriodStr());
        html += `<tr>
          <td style="padding-left:34px;"><input type="checkbox" class="ptChk" data-id="${p.id}" data-site="${escHtml(site)}" data-sub="${escHtml(sg)}" ${chk?"checked":""}></td>
          <td>${escHtml(p.nama)}${p.status==="failed"?' <span class="badge b-red">gagal batch lalu</span>':""}${!effectiveWajib(p)?' <span class="badge b-amber" title="Bukan titik wajib pantau — muncul di sini krn sudah dicentang Verifikasi di Database Titik Pantau">manual</span>':""}</td>
          <td class="muted">${rhVal!=null?rhVal:"-"}</td>
          <td style="white-space:nowrap;">${prediksiCellHtml(p)}</td>
        </tr>`;
      });
      html += `</tbody></table></div></div>`;
    });
    html += `</div></div>`;
    return html;
  }).join("") || "<div class='hint' style='padding:14px;'>Tidak ada titik wajib pantau yang eligible untuk tim ini (mungkin sudah semua selesai atau masuk batch lain).</div>";

  updateSelectedCount();
  renderScheduleTable(b);
}
// Grup tampilan ringkas 3-bucket (Emisi / Flare / Ambient & Noise) dari subgroup tree yang lebih
// rinci — dipakai cuma utk badge rekap per site di header Perencanaan Batch, bukan pengelompokan
// baru (subgroup asli tetap dipakai di picker/tree).
function plBucketOf(subgroup){
  if(subgroup===GRP_FLARE) return "Flare";
  if(subgroup===GRP_AMBIENT) return "Ambient & Noise";
  return "Emisi";
}
function updateSelectedCount(){
  const boxes = [...document.querySelectorAll(".ptChk:checked")];
  const el = document.getElementById("plSelectedCount");
  if(el) el.textContent = boxes.length+" titik";
  const bySite = {};
  boxes.forEach(b=>{
    const site = b.dataset.site;
    const bucket = plBucketOf(b.dataset.sub);
    const rec = bySite[site] || (bySite[site] = {"Emisi":0, "Flare":0, "Ambient & Noise":0});
    rec[bucket]++;
  });
  const wrap = document.getElementById("plSelectedBreakdown");
  if(!wrap) return;
  const sites = Object.keys(bySite).sort();
  wrap.innerHTML = sites.map(site=>{
    const r = bySite[site];
    const parts = [];
    if(r["Emisi"]) parts.push(`<span class="cnt b-emisi">Emisi ${r["Emisi"]}</span>`);
    if(r["Flare"]) parts.push(`<span class="cnt b-flare">Flare ${r["Flare"]}</span>`);
    if(r["Ambient & Noise"]) parts.push(`<span class="cnt b-ambient">Ambient &amp; Noise ${r["Ambient & Noise"]}</span>`);
    return `<div class="site-chip"><b>${escHtml(site)}</b>${parts.join("")}</div>`;
  }).join("");
}
document.addEventListener("change", e=>{
  if(e.target.classList && e.target.classList.contains("ptChk")) updateSelectedCount();
});
document.addEventListener("click", e=>{
  const t = e.target.closest("[data-action]"); if(!t) return;
  if(t.dataset.action==="togglePlGroup"){
    const key = t.dataset.key;
    if(plExpanded.has(key)) plExpanded.delete(key); else plExpanded.add(key);
    renderPlanner();
  }
  if(t.dataset.action==="siteAllToggle"){
    const site = t.dataset.site;
    const boxes = document.querySelectorAll(`.ptChk[data-site="${CSS.escape(site)}"]`);
    const allChecked = [...boxes].every(b=>b.checked);
    boxes.forEach(b=>b.checked = !allChecked);
    updateSelectedCount();
  }
  if(t.dataset.action==="subAllToggle"){
    const site = t.dataset.site, sub = t.dataset.sub;
    const boxes = document.querySelectorAll(`.ptChk[data-site="${CSS.escape(site)}"][data-sub="${CSS.escape(sub)}"]`);
    const allChecked = [...boxes].every(b=>b.checked);
    boxes.forEach(b=>b.checked = !allChecked);
    updateSelectedCount();
  }
  if(t.dataset.action==="expandAllPl"){
    document.querySelectorAll("#plPointPicker .tree-toggle[data-key]").forEach(el=>plExpanded.add(el.dataset.key));
    renderPlanner();
  }
  if(t.dataset.action==="collapseAllPl"){
    plExpanded.clear();
    renderPlanner();
  }
});

function applyScheduleToPoints(b, team){
  const excluded = b.excluded||[];
  b.items.forEach(id=>{
    const p = DB.points.find(x=>x.id===id); if(!p) return;
    p.batchId = b.id; p.team = team;
    if(excluded.includes(id)){
      // Ditandai "tidak bisa disampling periode ini" — lepas dari jadwal aktif tapi tetap
      // tercatat di batch ini supaya bisa dikonfirmasi lagi tanpa perlu dipilih ulang.
      p.status = "pending"; p.planStart = ""; p.planEnd = "";
      return;
    }
    const row = b.schedule.find(r=>r.site===p.site);
    p.status = "scheduled";
    if(row){ p.planStart = row.start; p.planEnd = row.end; }
    ensureTracking(id).planned = true;
  });
}
function generateSchedule(){
  // b dideklarasikan DI LUAR try (bukan di dalamnya) supaya tetap terjangkau di blok catch — kalau
  // save() gagal (mis. localStorage penuh) SETELAH b.items/b.schedule sudah dimutasi di memori,
  // catch masih bisa render ulang tabel supaya layar tidak nyangkut nampilin kondisi lama/kosong
  // yang beda dari apa yg sebenarnya ada di memori saat itu.
  let b;
  try{
  b = currentBatch(); if(!b){ toast("Buat/pilih batch dulu — klik \"+ Batch Baru\".","err"); return; }
  const team = document.getElementById("plTeam").value;
  if(!b.start){ toast("Isi Tanggal Mulai Rencana dulu.","err"); return; }
  const checked = [...document.querySelectorAll(".ptChk:checked")].map(c=>c.dataset.id);
  if(!checked.length){ toast("Pilih minimal satu titik pantau (default seharusnya sudah tercentang semua).","err"); return; }
  snapshotBefore(`Sebelum generate jadwal "${b.name}"`);
  b.items = checked;
  b.ratio = Number(document.getElementById("plRatio").value)||1;
  b.buffer = Number(document.getElementById("plBuffer").value)||0;

  const bySite = {};
  checked.forEach(id=>{ const p = DB.points.find(x=>x.id===id); if(p) (bySite[p.site]=bySite[p.site]||[]).push(p); });
  const route = team==="emisi"?DB.routeEmisi:DB.routeAmbient;
  const orderedSites = route.filter(s=>bySite[s]);
  Object.keys(bySite).forEach(s=>{ if(!orderedSites.includes(s)) orderedSites.push(s); });

  let cursor = b.start;
  const schedule = [];
  let safetyTripped = false;
  const trippedSites = [];
  orderedSites.forEach(site=>{
    // Hitung per kelompok kunjungan (ambient-family di lokasi sama = 1, Flare-gabung kalau
    // diaktifkan = 1 juga), bukan per record mentah — lihat dayCountGroupKey.
    const count = new Set(bySite[site].map(dayCountGroupKey)).size;
    // Pakai rasio titik/hari khusus site ini (Aturan Site & Rute) kalau sudah diatur;
    // rasio di Pengaturan Lanjutan batch cuma jadi default untuk site yang belum diatur.
    const rule = DB.siteRules[site];
    const perSiteRatio = rule ? Number(team==="emisi"?rule.ratioEmisi:rule.ratioAmbient) : 0;
    const ratio = perSiteRatio>0 ? perSiteRatio : b.ratio;
    const workDays = Math.max(1, Math.ceil(count/ratio));
    const bufferDays = b.buffer;
    const totalWorkNeeded = workDays + bufferDays;
    let start = findValidStart(site, cursor);
    let d = start;
    let counted = 0;
    let lastDate = start;
    let iterations = 0;
    while(counted < totalWorkNeeded && iterations < 730){
      if(!isBlocked(site,d)){ counted++; lastDate = d; }
      iterations++;
      if(counted < totalWorkNeeded) d = addDays(d,1);
    }
    if(iterations>=730){ safetyTripped = true; trippedSites.push(site); }
    schedule.push({site, count, workDays, bufferDays, start, end: lastDate,
      crewChangeNote: isCrewChange(site,start)?`Mulai bertepatan crew change (${DOW_LABEL[dayOfWeek(start)]})`:""});
    cursor = addDays(lastDate,1);
  });
  b.schedule = schedule;
  applyScheduleToPoints(b, team);
  logChange(`Generate jadwal "${b.name}" — ${orderedSites.length} site, ${checked.length} titik, mulai ${b.start}`);
  save();
  document.getElementById("plScheduleCard").style.display = "block";
  renderScheduleTable(b);
  renderMaster();
  if(safetyTripped) toast("Site "+trippedSites.join(", ")+" butuh lebih dari 2 tahun karena hari valid tidak cukup — cek Hari Terhold/Crew Change site tersebut di Aturan Site & Rute.","err");
  else toast("Jadwal dibuat & diterapkan untuk "+orderedSites.length+" site, "+checked.length+" titik. Cek halaman Gantt & S-Curve.","ok");
  }catch(err){
    toast("Gagal generate jadwal: "+err.message,"err");
    console.error(err);
    // save() di atas mungkin gagal PERSIS di titik itu (mis. localStorage penuh) padahal
    // b.items/b.schedule/status titik sudah kadung dimutasi di memori sebelumnya — render ulang
    // di sini supaya tabel yg tampil konsisten dgn kondisi memori saat ini, bukan nyangkut di
    // tampilan lama/kosong dari sebelum tombol diklik.
    if(b){ renderScheduleTable(b); renderMaster(); }
  }
}
function recalcScheduleFrom(b, idx, forcedStart){
  let cursor = forcedStart!==undefined ? forcedStart : b.schedule[idx].start;
  for(let i=idx;i<b.schedule.length;i++){
    const row = b.schedule[i];
    const totalNeeded = Number(row.workDays)+Number(row.bufferDays);
    // Baris yang sengaja digeser/di-drag (i===idx) dihormati apa adanya (biar keliatan
    // kalau start-nya kebetulan pas crew change). Baris setelahnya (cascade otomatis)
    // dicarikan hari mulai yang valid seperti saat generate pertama kali.
    let start = (i===idx) ? cursor : findValidStart(row.site, cursor);
    let d = start, counted=0, lastDate=start, iterations=0;
    while(counted < totalNeeded && iterations<730){
      if(!isBlocked(row.site,d)){ counted++; lastDate=d; }
      iterations++;
      if(counted < totalNeeded) d = addDays(d,1);
    }
    row.start = start; row.end = lastDate;
    row.crewChangeNote = isCrewChange(row.site,start)?`Mulai bertepatan crew change (${DOW_LABEL[dayOfWeek(start)]})`:"";
    cursor = addDays(lastDate,1);
  }
}
function recalcSchedule(){
  let b;
  try{
  b = currentBatch(); if(!b || !b.schedule.length){ toast("Belum ada jadwal untuk dihitung ulang. Klik \"Buat & Terapkan Jadwal\" dulu.","err"); return; }
  const team = document.getElementById("plTeam").value;
  snapshotBefore(`Sebelum hitung ulang jadwal "${b.name}"`);
  recalcScheduleFrom(b, 0);
  applyScheduleToPoints(b, team);
  logChange(`Hitung ulang jadwal "${b.name}" (durasi/buffer diubah manual)`);
  save(); renderScheduleTable(b); renderMaster();
  toast("Perubahan diterapkan & disimpan ke titik pantau.","ok");
  }catch(err){
    toast("Gagal hitung ulang: "+err.message,"err"); console.error(err);
    if(b){ renderScheduleTable(b); renderMaster(); }
  }
}
function renderScheduleTable(b){
  const warnEl = document.getElementById("plScheduleWarning");
  if(!b || !b.schedule || !b.schedule.length){ document.getElementById("plScheduleTable").innerHTML = "<div class='hint' style='padding:10px;'>Belum ada jadwal. Klik \"Buat &amp; Terapkan Jadwal\" di atas.</div>"; if(warnEl) warnEl.innerHTML=""; return; }
  if(warnEl){
    const actualEnd = b.schedule[b.schedule.length-1].end;
    if(b.end && actualEnd > b.end){
      const overDays = daysBetweenInclusive(b.end, actualEnd)-1;
      warnEl.innerHTML = `<div class="section-note" style="border-color:#e0554f;background:#fdeceb;color:#a02a24;">
        Jadwal berakhir <b>${actualEnd}</b>, melebihi target selesai <b>${b.end}</b> sebanyak <b>${overDays} hari</b>.
        Geser site tertentu di kalender (halaman Gantt &amp; S-Curve), atau kurangi hari kerja/buffer di bawah lalu klik "Terapkan Perubahan".
      </div>`;
    } else warnEl.innerHTML = "";
  }
  document.getElementById("plScheduleTable").innerHTML = `
    <thead><tr><th>Site</th><th>Jml Titik</th><th>Hari Kerja</th><th>Buffer</th><th>Mulai</th><th>Selesai</th><th>Catatan</th></tr></thead>
    <tbody>${b.schedule.map((r,i)=>`<tr>
      <td><b>${r.site}</b></td><td>${r.count}</td>
      <td><input type="number" min="1" style="width:60px;" value="${r.workDays}" data-action="editSchedField" data-idx="${i}" data-field="workDays"></td>
      <td><input type="number" min="0" style="width:60px;" value="${r.bufferDays}" data-action="editSchedField" data-idx="${i}" data-field="bufferDays"></td>
      <td>${r.start} <span class="muted">(${DOW_LABEL[dayOfWeek(r.start)]})</span></td>
      <td>${r.end} <span class="muted">(${DOW_LABEL[dayOfWeek(r.end)]})</span></td>
      <td class="muted" style="font-size:11px;">${r.crewChangeNote||""}</td>
    </tr>`).join("")}</tbody>`;
}
document.addEventListener("change", e=>{
  if(e.target.dataset.action==="editSchedField"){
    const b = currentBatch(); if(!b) return;
    b.schedule[Number(e.target.dataset.idx)][e.target.dataset.field] = Number(e.target.value);
    save();
  }
});
function carryOverBatch(){
  const team = document.getElementById("plTeam").value;
  const notDone = DB.points.filter(p=>{
    if(team==="emisi"){ if(p.kategori!=="emisi") return false; } else { if(p.kategori==="emisi") return false; }
    return effectiveWajib(p) && !p.tidakBeroperasi && p.batchId && p.status!=="done";
  });
  if(!notDone.length){ toast("Tidak ada titik yang belum selesai untuk tim ini.","err"); return; }
  notDone.forEach(p=>{ p.status="failed"; });
  save();
  newBatch();
  toast(notDone.length+" titik ditandai gagal/belum selesai. Batch baru dibuat — silakan centang titik tersebut lalu generate ulang jadwalnya.","ok");
}

