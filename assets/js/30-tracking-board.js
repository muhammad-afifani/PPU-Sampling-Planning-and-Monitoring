/* =========================================================
   TRACKING BA / CoA — halaman gabungan (Papan Status · Sampling Lapangan · Berita Acara · KOM)
   ---------------------------------------------------------
   Dulu "Tracking BA/CoA" (tabel centang) dan "Berita Acara" adalah dua halaman terpisah. Sekarang
   satu halaman bertab supaya alurnya nyambung: status sampling per engine → Berita Acara →
   draft SHU/CoA → SHU asli → input SIMPEL PPU. Data & aturannya TIDAK berubah — semua tetap di
   DB.tracking[id] (lihat ensureTracking di 09-tracking-map.js) dan perubahan status lewat
   trkSetSamplingStatus / trkSetStep (10-running-hour.js) yg juga menyinkronkan p.status.
========================================================= */
let trkTab = "board";      // board | sampling | ba | kom
let trkView = "flow";      // flow | kanban | matrix  (di tab Papan Status)
let trkStage = null;       // null = semua tahap, 0..7 = saring engine di tahap itu
const TRK_TABS = [["board","Papan Status"],["sampling","Sampling Lapangan"],["ba","Berita Acara"],["kom","KOM per Site"]];
const TRK_VIEWS = [["flow","Alur per Engine"],["kanban","Papan"],["matrix","Matriks"]];
// 7 langkah: sampling (diturunkan dari samplingStatus) + 6 langkah dokumen (TRACK_STEPS).
const TRK_SHORT = {ba:"BA TTD", draftSent:"Draft Dikirim", reviewed:"Direview", approved:"Approved", finalReceived:"SHU Asli", simpelInput:"SIMPEL"};
const TRK_FLOW = [{key:"sampled", short:"Sampling", label:"Sampling di lapangan"}]
  .concat(TRACK_STEPS.map(([key,label])=>({key, short:TRK_SHORT[key]||label, label})));
// 8 tahap (posisi engine) = jumlah langkah berurutan yg sudah selesai (0..7).
const TRK_STAGES = [
  {n:0, label:"Belum Disampling", next:"Sampling di lapangan"},
  {n:1, label:"Sudah Disampling", next:"Tanda tangan BA"},
  {n:2, label:"BA Ditandatangani", next:"Kirim draft SHU"},
  {n:3, label:"Draft Dikirim", next:"Review draft"},
  {n:4, label:"Draft Direview", next:"Approval draft"},
  {n:5, label:"Draft Approved", next:"Menunggu SHU asli"},
  {n:6, label:"SHU Asli Terbit", next:"Input SIMPEL PPU"},
  {n:7, label:"Selesai di SIMPEL", next:"Selesai"}
];
const TRK_STAGE_COLORS = ["#8896ab","#5b9fd6","#3d78c9","#7a4bb8","#b8741a","#c2620a","#2f9e8f","#2f9e67"];
const TRK_MONTH = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];
function trkFmtShort(d){
  if(!d) return "";
  const [y,m,dd] = String(d).split("-").map(Number);
  if(!y||!m||!dd) return "";
  return `${dd} ${TRK_MONTH[m-1]}`;
}
function trkStepDone(t, i){ return i===0 ? t.samplingStatus==="sampled" : !!t[TRACK_STEPS[i-1][0]]; }
function trkStepDate(t, i){ return i===0 ? (t.dates.actual||"") : (t.dates[TRACK_STEPS[i-1][0]]||""); }
function trkStageOf(t){ let n = 0; while(n<7 && trkStepDone(t,n)) n++; return n; }
function trkDoneCount(t){ let n = 0; for(let i=0;i<7;i++) if(trkStepDone(t,i)) n++; return n; }
function trkDaysSince(dateStr){ return dateStr ? Math.max(0, Math.round((new Date(todayStr())-new Date(dateStr))/86400000)) : null; }
function trkLastDate(t){
  let last = "";
  for(let i=0;i<7;i++){ if(trkStepDone(t,i)){ const d = trkStepDate(t,i); if(d && d>last) last = d; } }
  return last;
}
function trkEngines(pts){
  return pts.map(p=>{
    const t = ensureTracking(p.id);
    return {p, t, stage:trkStageOf(t), done:trkDoneCount(t), overall:trackingOverallStatus(t,p)};
  });
}
function trkSelectOptionsReset(){
  document.getElementById("trkTeam").value = ""; document.getElementById("trkBatch").value = "";
  document.getElementById("trkFltSite").value = ""; document.getElementById("trkStatus").value = "";
  trkStage = null;
}

/* ---------- Tab & kerangka halaman ---------- */
function renderTrkTabs(f){
  const sampled = f.beforeStatus.filter(p=>ensureTracking(p.id).samplingStatus==="sampled").length;
  const komN = new Set(f.beforeStatus.map(p=>{ const b = DB.batches.find(x=>x.id===p.batchId); return komKey(b?b.period:"-", p.site); })).size;
  const nums = {board:`${f.pts.length}`, sampling:`${sampled}/${f.beforeStatus.length}`, ba:"", kom:`${komN}`};
  document.getElementById("trkTabs").innerHTML = TRK_TABS.map(([k,label])=>
    `<button type="button" class="hd-tab ${k===trkTab?"on":""}" role="tab" aria-selected="${k===trkTab}" data-action="trkSetTab" data-val="${k}">${label}${nums[k]?` <span class="n">${nums[k]}</span>`:""}</button>`).join("");
  ["board","sampling","ba","kom"].forEach(k=>{
    const pane = document.getElementById("trkPane"+k[0].toUpperCase()+k.slice(1));
    if(pane) pane.style.display = k===trkTab ? "" : "none";
  });
  document.getElementById("trkFilterBar").style.display = trkTab==="ba" ? "none" : "";
  const cnt = document.getElementById("trkFilterCount");
  if(cnt) cnt.textContent = `${f.beforeStatus.length} engine/titik tampil`;
}
function renderTracking(){
  refreshTrackingBatchSelect();
  refreshTrackingSiteSelect();
  const f = getFilteredTrackingPoints();
  renderTrkTabs(f);
  if(trkTab==="board") renderTrkBoard(f);
  else if(trkTab==="sampling"){ renderSamplingSummary(f.beforeStatus); renderSamplingEmisiTable(f.beforeStatus); }
  else if(trkTab==="ba") renderBeritaAcara();
  else if(trkTab==="kom") renderKomSiteTable(f.beforeStatus);
}
function trkSetTab(t){
  trkTab = t.dataset.val;
  renderTracking();
  window.scrollTo({top:0});
}

/* ---------- Papan Status ---------- */
function renderTrkBoard(f){
  const list = trkEngines(f.pts);
  renderTrkKpis(list);
  renderTrkFunnel(list);
  document.getElementById("trkViewSeg").innerHTML = TRK_VIEWS.map(([k,l])=>`<button type="button" class="${k===trkView?"on":""}" aria-pressed="${k===trkView}" data-action="trkSetView" data-val="${k}">${l}</button>`).join("");
  document.getElementById("trkViewHint").textContent = trkView==="flow" ? "Klik lingkaran langkah untuk menandai selesai/batal, klik nama engine untuk detail & tanggal." : trkView==="kanban" ? "Kolom = langkah terakhir yang sudah selesai. Tombol hijau memajukan engine ke langkah berikutnya." : "Centang langsung per kolom; \"Centang Semua\" berlaku untuk baris yang tampil.";
  const shown = trkStage==null ? list : list.filter(e=>e.stage===trkStage);
  const body = document.getElementById("trkBoardBody");
  if(!list.length){
    body.innerHTML = `<div class="card">${hdEmpty('Belum ada titik yang tampil untuk filter Tim/Batch/Site/Status ini. Halaman ini hanya menampilkan titik yang <b>sudah dijadwalkan lewat Perencanaan Batch</b>.')}<div style="text-align:center;margin-top:10px;"><button class="btn small ghost" data-action="goToPage" data-page="planner">Buka Perencanaan Batch &rarr;</button></div></div>`;
    return;
  }
  if(!shown.length){ body.innerHTML = `<div class="card">${hdEmpty("Tidak ada engine di tahap ini untuk filter yang aktif.")}</div>`; return; }
  body.innerHTML = trkView==="flow" ? trkFlowHtml(shown) : trkView==="kanban" ? trkKanbanHtml(shown) : trkMatrixHtml(shown);
}
function renderTrkKpis(list){
  const n = list.length;
  const c = (fn)=>list.filter(fn).length;
  const sampled = c(e=>e.stage>=1 || e.t.samplingStatus==="sampled");
  const ba = c(e=>e.t.ba), fin = c(e=>e.t.finalReceived), simpel = c(e=>e.t.simpelInput), over = c(e=>e.overall==="overdue");
  const pct = (a,b)=>b?Math.round(a/b*100):0;
  const waitBa = c(e=>e.t.samplingStatus==="sampled" && !e.t.ba);
  const draftRun = c(e=>e.t.draftSent && !e.t.finalReceived);
  const sites = new Set(list.map(e=>e.p.site)).size;
  document.getElementById("trkKpis").innerHTML = [
    hdKpi({label:"Engine Terjadwal", icon:HD_IC.db, value:n, foot:`${sites} site &middot; sudah masuk batch`}),
    hdKpi({label:"Sudah Disampling", icon:HD_IC.gauge, value:sampled, suffix:` / ${n}`, foot:`${pct(sampled,n)}% selesai di lapangan`, tone: n&&sampled===n?"good":""}),
    hdKpi({label:"BA Ditandatangani", icon:HD_IC.shield, value:ba, suffix:` / ${sampled}`, foot: waitBa ? `${waitBa} engine menunggu tanda tangan BA` : "tidak ada yang menunggu BA", tone: waitBa?"warn":(ba?"good":"")}),
    hdKpi({label:"SHU Asli Terbit", icon:HD_IC.clock, value:fin, suffix:` / ${ba}`, foot: draftRun ? `${draftRun} engine masih di proses draft` : "tidak ada draft berjalan"}),
    hdKpi({label:"Selesai di SIMPEL", icon:HD_IC.trend, value:simpel, suffix:` / ${n}`, foot:`${pct(simpel,n)}% tuntas sampai SIMPEL PPU`, tone: n&&simpel===n?"good":""}),
    hdKpi({label:"Overdue", icon:HD_IC.alert, value:over, tone: over?"bad":"good", foot: over ? "BA lebih dari 21 hari tanpa SHU asli, atau gagal sampling" : "tidak ada dokumen yang terlambat"})
  ].join("");
}
function renderTrkFunnel(list){
  const counts = TRK_STAGES.map(s=>list.filter(e=>e.stage===s.n).length);
  const total = list.length || 1;
  document.getElementById("trkFunnel").innerHTML = `<div class="trk-funnel">${TRK_STAGES.map((s,i)=>{
    const on = trkStage===s.n;
    return `<button type="button" class="trk-fstage ${on?"on":""} ${counts[i]?"":"zero"}" style="--c:${TRK_STAGE_COLORS[i]}" aria-pressed="${on}" data-action="trkSetStage" data-val="${s.n}" title="${escHtml(s.label)} — berikutnya: ${escHtml(s.next)}">
      <span class="trk-fstage-n">${i+1}</span>
      <span class="trk-fstage-lbl">${escHtml(s.label)}</span>
      <span class="trk-fstage-val">${counts[i]}</span>
      <span class="trk-fstage-bar"><i style="width:${(counts[i]/total*100).toFixed(1)}%"></i></span>
      <span class="trk-fstage-next">&rarr; ${escHtml(s.next)}</span>
    </button>`;
  }).join("")}</div>`;
  const chip = document.getElementById("trkStageChip");
  chip.innerHTML = trkStage==null ? "" : `<span class="hd-tag trk-stagechip" style="--c:${TRK_STAGE_COLORS[trkStage]}">Tahap: ${escHtml(TRK_STAGES[trkStage].label)} <button type="button" data-action="trkSetStage" data-val="" aria-label="Hapus saringan tahap">&times;</button></span>`;
}
function trkSetStage(t){ const v = t.dataset.val; trkStage = (v===""||trkStage===Number(v)) ? null : Number(v); renderTracking(); }
function trkSetView(t){ trkView = t.dataset.val; renderTracking(); }

const TRK_CHECK = '<svg viewBox="0 0 16 16" aria-hidden="true"><polyline points="3.5 8.5 6.5 11.5 12.5 4.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
function trkOverallBadge(e){
  const {t, overall} = e;
  const ba = t.ba && t.dates.ba && !t.finalReceived ? trkDaysSince(t.dates.ba) : null;
  if(overall==="done") return `<span class="trk-badge ok">Selesai</span>`;
  if(overall==="overdue") return `<span class="trk-badge bad" title="BA lebih dari 21 hari tanpa SHU asli terbit, atau sampling gagal">Overdue${ba!=null?` &middot; ${ba} hr`:""}</span>`;
  return `<span class="trk-badge">${ba!=null?`${ba} hr sejak BA`:"On Track"}</span>`;
}
function trkSamplingChip(e){
  const st = e.t.samplingStatus;
  if(st==="sampled" || !st) return st ? "" : `<span class="trk-mini muted">status sampling belum diisi</span>`;
  const note = e.t.samplingNote ? ` &middot; ${escHtml(e.t.samplingNote)}` : "";
  return `<span class="trk-mini st-${st}">${escHtml(SAMPLING_STATUS_LABELS[st]||st)}${note}</span>`;
}
function trkNextBtn(e, cls){
  if(e.stage<1 || e.stage>=7) return "";
  const step = TRACK_STEPS[e.stage-1];
  return `<button type="button" class="trk-next ${cls||""}" data-action="trkAdvance" data-id="${e.p.id}" title="Tandai selesai: ${escHtml(step[1])} (tanggal hari ini)">&#10003; ${escHtml(TRK_SHORT[step[0]]||step[1])}</button>`;
}
function trkStepperHtml(e, withDates){
  const cur = e.stage;
  return `<ol class="trk-steps">${TRK_FLOW.map((s,i)=>{
    const done = trkStepDone(e.t,i);
    const locked = i>=1 && e.t.samplingStatus!=="sampled";
    const state = done ? "done" : (i===cur ? "current" : "todo");
    const date = done ? trkFmtShort(trkStepDate(e.t,i)) : "";
    const tip = `${s.label}${done?` — selesai ${trkStepDate(e.t,i)||""}`:locked?" — tandai sudah disampling dulu":" — klik untuk menandai selesai"}`;
    return `<li class="trk-node ${state} ${locked?"locked":""} ${done&&i<6&&trkStepDone(e.t,i+1)?"link":""}">
      <button type="button" class="trk-dot" data-action="trkNode" data-id="${e.p.id}" data-i="${i}" title="${escHtml(tip)}" aria-label="${escHtml(s.label)}: ${done?"selesai":"belum"}">${done?TRK_CHECK:(i+1)}</button>
      ${withDates?`<span class="trk-node-date">${date||"&nbsp;"}</span>`:""}
    </li>`;
  }).join("")}</ol>`;
}
function trkFlowHtml(list){
  const bySite = {};
  list.forEach(e=>{ (bySite[e.p.site] = bySite[e.p.site] || []).push(e); });
  const sites = Object.keys(bySite).sort((a,b)=>a.localeCompare(b));
  const head = `<div class="trk-steps-head" aria-hidden="true">${TRK_FLOW.map(s=>`<span>${escHtml(s.short)}</span>`).join("")}</div>`;
  return sites.map(site=>{
    const rows = bySite[site].sort((a,b)=>(a.p.kategoriSumber||"").localeCompare(b.p.kategoriSumber||"") || a.p.nama.localeCompare(b.p.nama));
    const avg = rows.reduce((a,e)=>a+e.done/7,0)/rows.length;
    const nDone = rows.filter(e=>e.overall==="done").length, nOver = rows.filter(e=>e.overall==="overdue").length;
    return `<details class="card trk-site" open>
      <summary><span class="trk-site-name">${escHtml(site)}</span>
        <span class="trk-site-meta">${rows.length} engine${nDone?` &middot; ${nDone} selesai`:""}${nOver?` &middot; <b class="bad">${nOver} overdue</b>`:""}</span>
        <span class="trk-site-prog" title="Rata-rata kemajuan ${Math.round(avg*100)}%"><i style="width:${(avg*100).toFixed(1)}%"></i></span><span class="trk-site-pct">${Math.round(avg*100)}%</span></summary>
      <div class="trk-flow">
        <div class="trk-row trk-row-head"><span>Engine</span>${head}<span>Status</span></div>
        ${rows.map(e=>`<div class="trk-row ${e.overall}">
          <div class="trk-eng"><button type="button" class="trk-eng-name" data-action="trkOpenDetail" data-id="${e.p.id}" title="Buka detail & tanggal">${escHtml(e.p.nama)}</button>
            <small>${escHtml(e.p.kategoriSumber||"-")}</small>${trkSamplingChip(e)}</div>
          ${trkStepperHtml(e, true)}
          <div class="trk-right"><div class="trk-pbar"><i style="width:${(e.done/7*100).toFixed(1)}%"></i></div><div class="trk-right-line"><b>${e.done}/7</b>${trkOverallBadge(e)}</div>${trkNextBtn(e)}</div>
        </div>`).join("")}
      </div>
    </details>`;
  }).join("");
}
function trkKanbanHtml(list){
  const cols = TRK_STAGES.map(s=>({s, items:list.filter(e=>e.stage===s.n)}));
  return `<div class="trk-kanban">${cols.map(({s,items})=>`<section class="trk-col" style="--c:${TRK_STAGE_COLORS[s.n]}">
    <header><span class="trk-col-n">${s.n+1}</span><b>${escHtml(s.label)}</b><span class="trk-col-count">${items.length}</span></header>
    <div class="trk-col-next">&rarr; ${escHtml(s.next)}</div>
    <div class="trk-col-body">${items.length ? items.sort((a,b)=>a.p.site.localeCompare(b.p.site)||a.p.nama.localeCompare(b.p.nama)).map(e=>{
      const last = trkLastDate(e.t), days = trkDaysSince(last);
      return `<article class="trk-card ${e.overall}">
        <button type="button" class="trk-card-name" data-action="trkOpenDetail" data-id="${e.p.id}">${escHtml(e.p.nama)}</button>
        <div class="trk-card-sub"><span class="trk-site-tag">${escHtml(e.p.site)}</span> ${escHtml(e.p.kategoriSumber||"-")}</div>
        ${trkSamplingChip(e)}
        <div class="trk-pips" aria-label="${e.done} dari 7 langkah">${TRK_FLOW.map((x,i)=>`<i class="${trkStepDone(e.t,i)?"on":""}"></i>`).join("")}</div>
        <div class="trk-card-foot"><span>${last?`${trkFmtShort(last)}${days!=null?` &middot; ${days} hr`:""}`:"&nbsp;"}</span>${trkOverallBadge(e)}</div>
        ${trkNextBtn(e,"wide")}
      </article>`;
    }).join("") : `<div class="trk-col-empty">Kosong</div>`}</div>
  </section>`).join("")}</div>`;
}
function trkMatrixHtml(list){
  const docPts = list.filter(e=>e.t.samplingStatus==="sampled");
  if(!docPts.length) return `<div class="card">${hdEmpty('Belum ada titik berstatus "Sudah Disampling" untuk filter ini — checklist dokumen baru muncul setelah statusnya diisi di tab <b>Sampling Lapangan</b>.')}</div>`;
  return `<div class="card"><div class="tablewrap"><table id="trackingTable">
    <thead><tr><th>Site</th><th>Titik</th>${TRACK_STEPS.map(([key,label])=>`<th>${label}<br><button class="btn small ghost" data-action="bulkTrackColumn" data-key="${key}" style="margin-top:3px;padding:2px 6px;font-size:10px;">Centang Semua</button></th>`).join("")}<th>Status</th></tr></thead>
    <tbody>${docPts.map(({p,t,overall})=>{
      const badge = overall==="done"?"b-green":overall==="overdue"?"b-red":"b-blue";
      const label = overall==="done"?"Selesai":overall==="overdue"?"Overdue":"On Track";
      return `<tr><td>${escHtml(p.site)}</td><td>${escHtml(p.nama)}</td>
        ${TRACK_STEPS.map(([key])=>`<td class="trk-cell${t[key]?" done":""}" style="text-align:center;"><input type="checkbox" data-action="toggleTrack" data-id="${p.id}" data-key="${key}" ${t[key]?"checked":""}></td>`).join("")}
        <td><span class="badge ${badge}">${label}</span></td></tr>`;
    }).join("")}</tbody></table></div></div>`;
}

/* ---------- Aksi di papan ---------- */
function trkNode(t){
  const id = t.dataset.id, i = Number(t.dataset.i);
  if(i===0){ trkOpenDetail(id); return; }
  const tr = ensureTracking(id);
  if(tr.samplingStatus!=="sampled"){ toast("Tandai engine ini 'Sudah Disampling' dulu (klik nama engine atau lingkaran Sampling).","err"); return; }
  const key = TRACK_STEPS[i-1][0], label = TRACK_STEPS[i-1][1];
  if(tr[key]){
    const p = DB.points.find(x=>x.id===id);
    askConfirm(`Batalkan "${label}" untuk ${p?p.nama:id}?`, ()=>{ trkSetStep(id,key,false); save(); renderTracking(); });
  } else { trkSetStep(id,key,true); save(); renderTracking(); toast(`${label}: ditandai selesai hari ini.`,"ok"); }
}
function trkAdvance(t){
  const id = t.dataset.id, tr = ensureTracking(id), stage = trkStageOf(tr);
  if(stage<1 || stage>=7) return;
  const key = TRACK_STEPS[stage-1][0];
  trkSetStep(id,key,true); save(); renderTracking();
  toast(`${TRACK_STEPS[stage-1][1]}: ditandai selesai hari ini.`,"ok");
}

/* ---------- Modal detail engine ---------- */
function trkOpenDetail(id){
  const p = DB.points.find(x=>x.id===id); if(!p) return;
  const t = ensureTracking(id);
  const sampled = t.samplingStatus==="sampled";
  openModal(`<div class="trkd">
    <div class="trkd-head"><div><div class="trkd-eyebrow">${escHtml(p.site)} &middot; ${escHtml(p.kategoriSumber||"-")}</div><h3>${escHtml(p.nama)}</h3></div><div class="trkd-prog"><b>${trkDoneCount(t)}</b>/7</div></div>
    <section class="trkd-sec"><h4>1 &middot; Sampling di lapangan</h4>
      <div class="trkd-grid">
        <div class="field"><label>Status</label><select id="trkdStatus"><option value="">- belum diisi -</option>${Object.entries(SAMPLING_STATUS_LABELS).map(([k,l])=>`<option value="${k}" ${t.samplingStatus===k?"selected":""}>${escHtml(l)}</option>`).join("")}</select></div>
        <div class="field"><label>Tanggal sampling</label><input type="date" id="trkdSampDate" value="${t.dates.actual||""}" ${sampled?"":"disabled"}></div>
      </div>
      <div class="field" style="margin-top:8px;"><label>Catatan sampling <span class="muted">(batch tujuan / alasan tidak disampling)</span></label><input type="text" id="trkdSampNote" value="${escHtml(t.samplingNote||"")}" ${sampled?"disabled":""}></div>
    </section>
    <section class="trkd-sec"><h4>2 &middot; Dokumen &amp; pelaporan</h4>
      <div class="trkd-steps ${sampled?"":"off"}" id="trkdSteps">${TRACK_STEPS.map(([key,label],i)=>`<label class="trkd-step ${t[key]?"done":""}">
        <input type="checkbox" class="trkdChk" data-key="${key}" ${t[key]?"checked":""} ${sampled?"":"disabled"}>
        <span class="trkd-step-n">${i+2}</span><span class="trkd-step-lbl">${escHtml(label)}</span>
        <input type="date" class="trkdDate" data-key="${key}" value="${t.dates[key]||""}" ${t[key]&&sampled?"":"disabled"}>
      </label>`).join("")}</div>
      ${sampled?"":`<div class="hint" style="margin-top:6px;">Langkah dokumen terbuka setelah status sampling = "Sudah Disampling".</div>`}
    </section>
    <section class="trkd-sec"><h4>Catatan tracking</h4><textarea id="trkdNote" rows="2" placeholder="mis. menunggu tanda tangan lab, draft revisi ke-2">${escHtml(t.trkNote||"")}</textarea></section>
    <div class="actions"><button class="btn ghost" data-action="closeModal">Batal</button><button class="btn primary" data-action="trkSaveDetail" data-id="${id}">Simpan</button></div>
  </div>`, {});
}
document.addEventListener("change", e=>{
  const el = e.target;
  if(el.id==="trkdStatus"){
    const sampled = el.value==="sampled";
    const d = document.getElementById("trkdSampDate"); d.disabled = !sampled; if(sampled && !d.value) d.value = todayStr();
    document.getElementById("trkdSampNote").disabled = sampled;
    document.querySelectorAll("#trkdSteps .trkdChk").forEach(c=>{ c.disabled = !sampled; });
    document.querySelectorAll("#trkdSteps .trkdDate").forEach(x=>{ const chk = document.querySelector(`#trkdSteps .trkdChk[data-key="${x.dataset.key}"]`); x.disabled = !(sampled && chk.checked); });
    document.getElementById("trkdSteps").classList.toggle("off", !sampled);
  }
  if(el.classList && el.classList.contains("trkdChk")){
    const d = document.querySelector(`#trkdSteps .trkdDate[data-key="${el.dataset.key}"]`);
    d.disabled = !el.checked; if(el.checked && !d.value) d.value = todayStr(); if(!el.checked) d.value = "";
    el.closest(".trkd-step").classList.toggle("done", el.checked);
  }
});
function trkSaveDetail(t){
  const id = t.dataset.id, tr = ensureTracking(id);
  const status = document.getElementById("trkdStatus").value;
  if(status!==tr.samplingStatus) trkSetSamplingStatus(id, status);
  if(status==="sampled"){ const d = document.getElementById("trkdSampDate").value; if(d) trkSetSamplingDate(id, d); }
  else ensureTracking(id).samplingNote = document.getElementById("trkdSampNote").value.trim();
  if(status==="sampled"){
    TRACK_STEPS.forEach(([key])=>{
      const chk = document.querySelector(`#trkdSteps .trkdChk[data-key="${key}"]`).checked;
      const d = document.querySelector(`#trkdSteps .trkdDate[data-key="${key}"]`).value;
      trkSetStep(id, key, chk, d);
    });
  }
  ensureTracking(id).trkNote = document.getElementById("trkdNote").value.trim();
  const p = DB.points.find(x=>x.id===id);
  logChange(`Tracking "${p?p.nama:id}" diperbarui (${trkDoneCount(ensureTracking(id))}/7 langkah)`);
  save(); closeModal(); renderTracking();
  toast("Tracking engine disimpan.","ok");
}

/* ---------- Tab Sampling Lapangan ---------- */
function renderSamplingSummary(pts){
  const el = document.getElementById("trkSamplingSummary"); if(!el) return;
  const c = {sampled:0, deferred:0, other:0, notdue:0, none:0};
  pts.forEach(p=>{ const s = ensureTracking(p.id).samplingStatus; c[s||"none"]++; });
  const items = [["sampled","Sudah Disampling"],["deferred","Batch Berikutnya"],["other","Sebab Lain"],["notdue","Belum Masuk Periode"],["none","Belum Diisi"]];
  el.innerHTML = items.map(([k,l])=>`<span class="trk-chip st-${k}"><b>${c[k]}</b> ${l}</span>`).join("");
}
// Tahap 1: eksekusi sampling di lapangan per titik — status, tanggal aktual (kalau sudah
// disampling), dan catatan (kalau ditunda ke batch berikutnya atau sebab lain seperti maintenance).
// Dipakai juga sebagai sumber data status pemantauan pada Berita Acara.
function renderSamplingEmisiTable(pts){
  const el = document.getElementById("samplingEmisiTable");
  if(!el) return;
  if(!pts.length){
    el.innerHTML = `<tbody><tr><td style="padding:16px;">
      <div class="hint">Belum ada titik yang tampil di sini utk filter Tim/Batch/Site yang dipilih — halaman ini cuma menampilkan titik yang <b>sudah dijadwalkan lewat Perencanaan Batch</b> (klik "+ Batch Baru", pilih titiknya, lalu buat jadwal). Kalau kamu yakin sudah bikin batch utk tim/periode ini tapi tetap kosong di sini, cek juga filter Batch &amp; Site di atas (mungkin ke-set ke pilihan yang tidak cocok).</div>
      <button class="btn small ghost" style="margin-top:8px;" data-action="goToPage" data-page="planner">Buka Perencanaan Batch &rarr;</button>
    </td></tr></tbody>`;
    return;
  }
  el.innerHTML = `
    <thead><tr><th>Site</th><th>Titik</th><th>Kategori Sumber</th><th>Wajib Pantau</th><th style="width:200px;">Status Sampling</th><th style="width:150px;">Tanggal Sampling</th><th>Catatan</th><th style="width:60px;">Aksi</th></tr></thead>
    <tbody>${pts.map(p=>{
      const t = ensureTracking(p.id);
      const status = t.samplingStatus||"";
      const isFilled = status || t.dates.actual || t.samplingNote;
      const notePlaceholder = status==="deferred" ? "mis. Batch 2" : status==="other" ? "mis. Under Maintenance" : status==="notdue" ? "kosongkan = teks otomatis periode lalu" : "";
      return `<tr class="trk-st-row st-${status||"none"}">
        <td>${escHtml(p.site)}</td>
        <td><b>${escHtml(p.nama)}</b></td>
        <td class="muted" style="font-size:11px;">${escHtml(p.kategoriSumber||"-")}</td>
        <td>${wajibBadgeHtml(p)}</td>
        <td><select class="trk-st-select" data-action="setSamplingStatus" data-id="${p.id}">
          <option value="">- pilih status -</option>
          <option value="sampled" ${status==="sampled"?"selected":""}>${SAMPLING_STATUS_LABELS.sampled}</option>
          <option value="deferred" ${status==="deferred"?"selected":""}>${SAMPLING_STATUS_LABELS.deferred}</option>
          <option value="other" ${status==="other"?"selected":""}>${SAMPLING_STATUS_LABELS.other}</option>
          <option value="notdue" ${status==="notdue"?"selected":""}>${SAMPLING_STATUS_LABELS.notdue}</option>
        </select></td>
        <td><input type="date" data-action="setSamplingDate" data-id="${p.id}" value="${t.dates.actual||""}" ${status!=="sampled"?"disabled":""} style="width:100%;"></td>
        <td><input type="text" data-action="setSamplingNote" data-id="${p.id}" value="${escHtml(t.samplingNote||"")}" placeholder="${notePlaceholder}" style="width:100%;" ${status==="sampled"?"disabled":""}></td>
        <td><button class="btn small danger" data-action="resetSamplingRecord" data-id="${p.id}" title="Kosongkan status, tanggal, dan catatan sampling titik ini" ${isFilled?"":"disabled"}>Reset</button></td>
      </tr>`;
    }).join("")}</tbody>`;
}

Object.assign(ACTIONS, {
  trkSetTab, trkSetView, trkSetStage, trkNode, trkAdvance, trkSaveDetail, baSetZoom,
  trkOpenDetail:(t)=>trkOpenDetail(t.dataset.id),
  trkResetFilter:()=>{ trkSelectOptionsReset(); renderTracking(); }
});
