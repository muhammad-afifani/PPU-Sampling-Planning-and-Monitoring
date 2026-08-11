/* =========================================================
   GANTT
========================================================= */
// Adjust durasi manual per site langsung dari Gantt: titik tetap sama, tapi hari kerja/buffer bisa
// dipercepat/diperpanjang sendiri, dengan catatan alasan supaya ketahuan "normalnya segini, di-adjust segitu".
function openAdjustDurationModal(batchId, rowIdx){
  const b = DB.batches.find(x=>x.id===batchId); if(!b) return;
  const row = b.schedule[rowIdx]; if(!row) return;
  const rule = DB.siteRules[row.site];
  const perSiteRatio = rule ? Number(b.team==="emisi"?rule.ratioEmisi:rule.ratioAmbient) : 0;
  const ratio = perSiteRatio>0 ? perSiteRatio : b.ratio;
  const normalWorkDays = row.count>0 ? Math.max(1, Math.ceil(row.count/ratio)) : 0;
  openModal(`
    <h3>Adjust Durasi — ${escHtml(row.site)} <span class="muted" style="font-weight:400;font-size:12px;">(${b.name})</span></h3>
    <div class="hint" style="margin-bottom:10px;">Normalnya <b>${normalWorkDays} hari kerja</b> (${row.count} titik &divide; rasio ${ratio}/hari). Saat ini: <b>${row.workDays} hari kerja + ${row.bufferDays} buffer</b>. Titik pantau tidak berubah — cuma durasinya.</div>
    <div class="inline-fields">
      <div class="field"><label>Hari Kerja</label><input type="number" min="0" id="adjWorkDays" value="${row.workDays}" style="width:90px;"></div>
      <div class="field"><label>Buffer (hari)</label><input type="number" min="0" id="adjBufferDays" value="${row.bufferDays}" style="width:90px;"></div>
    </div>
    <div class="field" style="margin-top:10px;"><label>Catatan / Alasan</label><textarea id="adjNote" rows="3" style="width:100%;padding:7px 9px;border:1px solid var(--gray-300);border-radius:6px;" placeholder="mis. dipercepat karena akses terbatas minggu depan">${escHtml(row.adjustNote||"")}</textarea></div>
    <div class="actions">
      <button class="btn ghost" data-action="closeModal">Batal</button>
      <button class="btn primary" data-action="saveAdjustDuration" data-batch-id="${b.id}" data-row-idx="${rowIdx}">Simpan &amp; Terapkan</button>
    </div>
  `);
}
// Semua titik/parameter yang tergabung 1 unit penjadwalan dgn p (ambient-family, atau Flare kalau
// flareOneDay dinyalakan di site itu) — dipakai utk label "(N digabung)" di kartu Detail Harian.
function groupSiblingsFor(p){
  const key = schedulingGroupKey(p);
  return key===p.id ? [p] : DB.points.filter(x=>schedulingGroupKey(x)===key);
}
const EXCLUDE_REASON_LABELS = {
  batch2: "Masuk Batch Berikutnya",
  notdue: "Belum Masuk Periode Sampling",
  tbc: "Tidak Beroperasi (TBC — belum pasti kapan tersedia)"
};
// Keluarkan/sertakan-lagi 1 titik (+ semua sibling separuh penjadwalan yg sama) dari batch ini —
// dipanggil dari tombol "x" di kartu Detail Harian. BEDA dgn toggleExcludePoint (dipakai pill di
// kolom "Titik Pantau" day-grid, yg langsung recompute+reschedule OTOMATIS tiap klik): di sini
// perubahan cuma DISIMPAN (staged) — jadwal (row.count/workDays/tanggal) BARU dihitung ulang saat
// user eksplisit klik "Jalankan Ulang Jadwal" (lihat applyExcludeReschedule), supaya beberapa titik
// bisa dikeluarkan dulu (dgn alasannya masing2) sebelum jadwalnya "diguncang" sekali jalan.
function stageExcludePoint(batchId, pointId){
  const b = DB.batches.find(x=>x.id===batchId); if(!b) return;
  if(!b.excluded) b.excluded = [];
  if(!b.excludeReasons) b.excludeReasons = {};
  const point = DB.points.find(x=>x.id===pointId); if(!point) return;
  const nowExcluded = b.excluded.indexOf(pointId)<0;
  siblingIdsInBatch(b, point).forEach(id=>{
    const idx = b.excluded.indexOf(id);
    if(nowExcluded && idx<0) b.excluded.push(id);
    if(!nowExcluded && idx>=0) b.excluded.splice(idx,1);
    if(nowExcluded) b.excludeReasons[id] = b.excludeReasons[id] || {reason:"batch2", note:""};
    else delete b.excludeReasons[id];
  });
  logChange(`${point.nama} (${point.site}) ${nowExcluded?"dikeluarkan dari":"disertakan lagi ke"} batch "${b.name}" — jadwal belum dihitung ulang`);
  save();
  const row = b.schedule.find(r=>r.site===point.site);
  if(row) renderDayDetailModal(b, row);
  renderGantt();
}
// Tombol "Jalankan Ulang Jadwal Site Ini" — hitung ulang hari kerja site ini dari titik yang MASIH
// aktif (b.items dikurangi b.excluded), lalu recalcScheduleFrom menggeser tanggal site ini &
// seluruh site SETELAHNYA di batch yang sama supaya tetap berurutan tanpa celah/tabrakan. Logikanya
// sama persis dgn recomputeSiteForPoint (dipakai toggleExcludePoint), cuma dipanggil manual di sini
// alih-alih otomatis tiap klik, sesuai alur "keluarkan beberapa titik dulu, baru terapkan sekali".
function applyExcludeReschedule(batchId, rowIdx){
  const b = DB.batches.find(x=>x.id===batchId); if(!b) return;
  const row = b.schedule[rowIdx]; if(!row) return;
  const excluded = b.excluded||[];
  const activePts = b.items.map(id=>DB.points.find(x=>x.id===id)).filter(pt=>pt && pt.site===row.site && !excluded.includes(pt.id));
  const activeCount = new Set(activePts.map(dayCountGroupKey)).size;
  const rule = DB.siteRules[row.site];
  const perSiteRatio = rule ? Number(b.team==="emisi"?rule.ratioEmisi:rule.ratioAmbient) : 0;
  const ratio = perSiteRatio>0 ? perSiteRatio : b.ratio;
  row.count = activeCount;
  row.workDays = activeCount>0 ? Math.max(1, Math.ceil(activeCount/ratio)) : 0;
  recalcScheduleFrom(b, rowIdx);
  applyScheduleToPoints(b, b.team);
  logChange(`Jadwal site ${row.site} (${b.name}) dihitung ulang — ${activeCount} titik aktif setelah pengurangan`);
  save();
  renderDayDetailModal(b, row);
  renderGantt();
  renderMaster();
  toast(`Jadwal site ${row.site} dihitung ulang: ${row.workDays} hari kerja utk ${activeCount} titik aktif.`,"ok");
}
// Papan "Detail Harian" per site — tiap kolom 1 tanggal valid (kerja+buffer) di rentang site itu,
// kartu titik/grup bisa di-drag antar kolom utk override manual pembagian rata otomatis (lihat
// dailyAssignmentForRow & b.dayOverrides). Dibuka dari tombol di baris site pada Gantt (day-grid).
function openDayDetailModal(batchId, rowIdx){
  const b = DB.batches.find(x=>x.id===batchId); if(!b) return;
  const row = b.schedule[rowIdx]; if(!row) return;
  renderDayDetailModal(b, row);
}
function renderDayDetailModal(b, row){
  const asg = dailyAssignmentForRow(b, row);
  const dates = Object.keys(asg).sort();
  const hasOverride = Object.keys(b.dayOverrides||{}).some(k=>k.startsWith(row.site+"::"));
  const cols = dates.map(dt=>{
    const a = asg[dt];
    const cc = isCrewChange(row.site, dt);
    const cards = a.points.map(p=>{
      const siblings = groupSiblingsFor(p);
      const isAmbientGrp = AMBIENT_FAMILY.includes(p.kategori);
      const isFlareGrp = !isAmbientGrp && dayCountGroupKey(p)!==schedulingGroupKey(p);
      const sub = isAmbientGrp
        ? (NONEMISI_LABEL[p.kategori]||p.kategori) + (siblings.length>1?` (${siblings.length} parameter digabung)`:"")
        : (p.kategoriSumber||p.parameter||"-");
      return `<div class="daydetail-card" draggable="true" data-batch-id="${b.id}" data-site="${row.site}" data-group-key="${escHtml(dayCountGroupKey(p))}" title="Tarik ke kolom hari lain utk custom manual${isFlareGrp?" — semua titik Flare lain yg digabung ikut pindah bersama":""}">
        <button class="daydetail-card-x" data-action="stageExcludePoint" data-batch-id="${b.id}" data-point-id="${p.id}" title="Keluarkan dari batch ini (mis. melebihi periode) — masuk ke daftar Titik Dikeluarkan di bawah">&times;</button>
        <b>${escHtml(p.nama)}</b><div class="sub">${escHtml(sub)}</div>${isFlareGrp?`<div class="sub" style="color:#a02a24;">&#128293; Digabung 1 hari</div>`:""}
      </div>`;
    }).join("");
    return `<div class="daydetail-col${a.isBuffer?" buffer":""}${cc?" cc":""}" data-date="${dt}" data-batch-id="${b.id}" data-site="${escHtml(row.site)}">
      <div class="daydetail-col-head">
        <div class="dow">${DOW_LABEL[dayOfWeek(dt)]}</div>
        <div class="dnum">${Number(dt.slice(8,10))}</div>
        <div class="mon">${MONTH_SHORT_ID[Number(dt.slice(5,7))-1]}</div>
        ${a.isBuffer?`<span class="tag buffer">Buffer</span>`:""}
        ${cc?`<span class="tag cc">Crew Change</span>`:""}
      </div>
      <div class="daydetail-col-body">${cards}</div>
    </div>`;
  }).join("");
  const rowIdx = b.schedule.indexOf(row);
  // Titik yang sudah dikeluarkan dari batch ini (klik "x" di kartu) — dideduplikasi per grup
  // penjadwalan sama seperti kartu aktif, supaya 1 kunjungan ambient-family cuma tampil 1 baris
  // biar tidak ganda utk tiap parameternya.
  const excludedForSite = dedupeByGroup((b.excluded||[]).map(id=>DB.points.find(p=>p.id===id)).filter(p=>p && p.site===row.site));
  const excludedHtml = excludedForSite.length ? `
    <div class="daydetail-excluded">
      <h4>Titik Dikeluarkan dari Batch Ini (${excludedForSite.length})</h4>
      <div class="hint" style="margin-bottom:8px;">Belum ikut dihitung dalam jadwal site ini sampai kamu klik "Jalankan Ulang Jadwal" di bawah. Statusnya balik jadi Belum Direncanakan — siap dipilih lagi utk batch berikutnya di halaman Plan Pemantauan.</div>
      ${excludedForSite.map(p=>{
        const r = (b.excludeReasons||{})[p.id] || {reason:"batch2", note:""};
        return `<div class="daydetail-excluded-row">
          <div class="name"><b>${escHtml(p.nama)}</b></div>
          <select data-action="setExcludeReason" data-batch-id="${b.id}" data-point-id="${p.id}">
            <option value="batch2" ${r.reason==="batch2"?"selected":""}>${EXCLUDE_REASON_LABELS.batch2}</option>
            <option value="notdue" ${r.reason==="notdue"?"selected":""}>${EXCLUDE_REASON_LABELS.notdue}</option>
            <option value="tbc" ${r.reason==="tbc"?"selected":""}>${EXCLUDE_REASON_LABELS.tbc}</option>
          </select>
          ${r.reason==="tbc" ? `<input type="text" data-action="setExcludeNote" data-batch-id="${b.id}" data-point-id="${p.id}" value="${escHtml(r.note||"")}" placeholder="Catatan / perkiraan tersedia kapan">` : ""}
          <button class="btn small ghost" data-action="stageExcludePoint" data-batch-id="${b.id}" data-point-id="${p.id}">&#8635; Sertakan Lagi</button>
        </div>`;
      }).join("")}
    </div>` : "";
  // Struktur header/body-scroll/footer EKSPLISIT (bukan mengandalkan position:sticky di tengah
  // konten) — modal ini bisa jadi panjang (banyak kolom hari + daftar titik dikeluarkan). Cuma
  // h3+hint (kepala) & tombol Tutup (kaki) yang TIDAK ikut discroll; sisanya (Reset, catatan,
  // kolom hari, daftar dikeluarkan, Jalankan Ulang Jadwal) ada di .daydetail-modal-body yang
  // scroll sendiri (CSS grid lewat class scrollbody — lihat style.css), jadi kaki modal selalu
  // kelihatan. wireScrollShadow dipanggil di bawah supaya ada bayangan visual yang jelas kalau
  // body ini masih bisa discroll lebih jauh, bukan cuma mengandalkan user coba-coba scroll sendiri.
  openModal(`
    <h3>Detail Harian — ${escHtml(row.site)} <span class="muted" style="font-weight:400;font-size:12px;">(${escHtml(b.name)})</span></h3>
    <div class="hint" style="margin-bottom:10px;">Tarik (drag) kartu titik ke kolom hari lain utk custom manual — sisanya tetap terbagi rata otomatis. Kolom bergaris miring = hari buffer/cadangan (boleh diisi kalau memang mau dipakai). Klik &times; di pojok kartu utk keluarkan titik itu dari batch ini (mis. jadwal kepanjangan/melebihi periode). Perubahan tersimpan otomatis. &#8595; Scroll ke bawah utk lihat titik yang dikeluarkan &amp; tombol jalankan ulang jadwal.</div>
    <div class="daydetail-modal-body">
      <div class="daydetail-actionbar" style="margin-bottom:10px;">
        <button class="btn small ghost" data-action="resetDayOverrides" data-batch-id="${b.id}" data-row-idx="${rowIdx}" ${hasOverride?"":"disabled"}>Reset ke Otomatis</button>
      </div>
      <div class="field" style="margin-bottom:10px;">
        <label>Catatan Saat Sampling utk Site Ini <span class="muted" style="font-weight:400;">(otomatis muncul di Tracking BA/CoA &rarr; KOM per Site, dan di Panduan Sampling A4 saat dicetak)</span></label>
        <textarea data-action="setDayDetailNote" data-batch-id="${b.id}" data-row-idx="${rowIdx}" rows="2" style="width:100%;padding:7px 9px;border:1px solid var(--gray-300);border-radius:6px;" placeholder="mis. Akses site perlu izin masuk H-3, kontak PIC lapangan: ...">${escHtml(row.dayDetailNote||"")}</textarea>
      </div>
      <div class="daydetail-scroll"><div class="daydetail-cols">${cols}</div></div>
      ${excludedHtml}
      <div class="daydetail-actionbar" style="margin-top:10px;">
        <button class="btn primary" data-action="applyExcludeReschedule" data-batch-id="${b.id}" data-row-idx="${rowIdx}">&#128260; Jalankan Ulang Jadwal Site Ini</button>
        <span class="hint" style="align-self:center;max-width:360px;">Menghitung ulang hari kerja site ini dari titik yang masih aktif, lalu menggeser tanggal site-site setelahnya di batch ini kalau perlu.</span>
      </div>
    </div>
    <div class="actions"><button class="btn ghost" data-action="closeModal">Tutup</button></div>
  `, {wide:true, scrollBody:true});
  wireScrollShadow(document.querySelector(".daydetail-modal-body"));
}
// Catatan Saat Sampling (field di atas; nama field internal dayDetailNote dipertahankan biar tidak
// perlu migrasi data lagi) dikumpulkan lintas-halaman lewat fungsi ini — dipakai KOM per Site
// (Tracking), Panduan Sampling A4 (cetak), dan Export MoM, supaya sekali isi di sini otomatis
// muncul di semua tempat itu tanpa perlu diketik ulang.
function dayDetailNotesForSite(site, period){
  const notes = [];
  DB.batches.filter(b=>b.period===period).forEach(b=>{
    (b.schedule||[]).forEach(row=>{
      if(row.site===site && row.dayDetailNote) notes.push({team:b.team, note:row.dayDetailNote, batchName:b.name});
    });
  });
  return notes;
}
// Titik-titik yg 1 unit penjadwalan sama dgn point (lihat schedulingGroupKey) — dipakai supaya
// alasan/catatan yg diisi utk 1 kartu ambient-family kegabung otomatis nempel ke semua parameter
// pasangannya juga, konsisten dgn cara b.excluded sendiri sudah memperlakukan grup ini (stageExcludePoint).
function siblingIdsInBatch(b, point){
  const groupKey = schedulingGroupKey(point);
  return b.items.filter(id=>{
    const pt = DB.points.find(x=>x.id===id);
    return pt && schedulingGroupKey(pt)===groupKey;
  });
}
document.addEventListener("change", e=>{
  if(e.target.dataset.action==="setDayDetailNote"){
    const b = DB.batches.find(x=>x.id===e.target.dataset.batchId); if(!b) return;
    const row = b.schedule[Number(e.target.dataset.rowIdx)]; if(!row) return;
    row.dayDetailNote = e.target.value.trim();
    logChange(`Catatan saat sampling site ${row.site} (${b.name}) diperbarui`);
    save();
  }
  if(e.target.dataset.action==="setExcludeReason"){
    const b = DB.batches.find(x=>x.id===e.target.dataset.batchId); if(!b) return;
    const point = DB.points.find(x=>x.id===e.target.dataset.pointId); if(!point) return;
    if(!b.excludeReasons) b.excludeReasons = {};
    siblingIdsInBatch(b, point).forEach(id=>{
      b.excludeReasons[id] = b.excludeReasons[id] || {reason:"batch2", note:""};
      b.excludeReasons[id].reason = e.target.value;
    });
    save();
    const row = b.schedule.find(r=>r.site===point.site);
    if(row) renderDayDetailModal(b, row);
  }
  if(e.target.dataset.action==="setExcludeNote"){
    const b = DB.batches.find(x=>x.id===e.target.dataset.batchId); if(!b) return;
    const point = DB.points.find(x=>x.id===e.target.dataset.pointId); if(!point) return;
    if(!b.excludeReasons) b.excludeReasons = {};
    siblingIdsInBatch(b, point).forEach(id=>{
      b.excludeReasons[id] = b.excludeReasons[id] || {reason:"tbc", note:""};
      b.excludeReasons[id].note = e.target.value.trim();
    });
    save();
  }
});
function resetDayOverrides(batchId, rowIdx){
  const b = DB.batches.find(x=>x.id===batchId); if(!b) return;
  const row = b.schedule[rowIdx]; if(!row) return;
  Object.keys(b.dayOverrides||{}).forEach(k=>{ if(k.startsWith(row.site+"::")) delete b.dayOverrides[k]; });
  logChange(`Reset custom harian site ${row.site} (${b.name}) ke pembagian otomatis`);
  save();
  renderDayDetailModal(b, row);
  renderGantt();
}
document.addEventListener("dragstart", e=>{
  const card = e.target.closest(".daydetail-card[draggable='true']");
  if(!card) return;
  e.dataTransfer.setData("application/x-day-override", JSON.stringify({batchId:card.dataset.batchId, site:card.dataset.site, groupKey:card.dataset.groupKey}));
  e.dataTransfer.effectAllowed = "move";
});
document.addEventListener("dragover", e=>{
  const col = e.target.closest(".daydetail-col[data-date]");
  if(!col) return;
  e.preventDefault();
  col.classList.add("dragover");
});
document.addEventListener("dragleave", e=>{
  const col = e.target.closest(".daydetail-col[data-date]");
  if(col) col.classList.remove("dragover");
});
document.addEventListener("drop", e=>{
  const col = e.target.closest(".daydetail-col[data-date]");
  if(!col) return;
  e.preventDefault();
  col.classList.remove("dragover");
  let payload; try{ payload = JSON.parse(e.dataTransfer.getData("application/x-day-override")); }catch(_){ return; }
  if(!payload || !payload.batchId || payload.site!==col.dataset.site) return;
  const b = DB.batches.find(x=>x.id===payload.batchId); if(!b) return;
  const row = b.schedule.find(r=>r.site===payload.site); if(!row) return;
  if(!b.dayOverrides) b.dayOverrides = {};
  b.dayOverrides[payload.site+"::"+payload.groupKey] = col.dataset.date;
  logChange(`Custom harian: 1 titik/grup di site ${payload.site} (${b.name}) dipindah manual ke ${col.dataset.date}`);
  save();
  renderDayDetailModal(b, row);
  renderGantt();
});
function refreshGanttBatchSelect(){
  const view = document.getElementById("ganttView").value;
  const sel = document.getElementById("ganttBatch");
  const prevValue = sel.value;
  let list = view==="overlay"? DB.batches : DB.batches.filter(b=>b.team===view);
  sel.innerHTML = `<option value="">Semua batch</option>` + list.map(b=>`<option value="${b.id}">${b.name}</option>`).join("");
  // Rebuild innerHTML mereset seleksi ke opsi pertama ("Semua batch") walau opsi lama masih ada di
  // daftar baru — dipasang lagi manual di sini kalau masih valid, supaya filter Batch yg sedang
  // dipilih user TIDAK diam-diam balik ke "Semua batch" tiap kali renderGantt() jalan (mis. abis
  // drag-drop di Detail Harian, adjust durasi, dll — semua itu render ulang lewat sini).
  if(list.some(b=>b.id===prevValue)) sel.value = prevValue;
}
document.getElementById("ganttView").addEventListener("change", ()=>{ refreshGanttBatchSelect(); renderGantt(); });
document.getElementById("ganttBatch").addEventListener("change", renderGantt);
document.getElementById("ganttMode").addEventListener("change", renderGantt);

/* =========================================================
   PANDUAN SAMPLING A4 (CETAK)
========================================================= */
// Membangun halaman cetak berisi jadwal per site beserta daftar titik dan kolom ceklist kosong,
// dimaksudkan untuk dibawa fisik oleh tim sampling di lapangan sebagai panduan kerja, bukan untuk
// dilihat di layar. Memakai data batch yang sudah fix dari halaman Perencanaan Batch/Gantt, jadi
// tidak menduplikasi logika penjadwalan, hanya menyusun ulang tampilannya supaya pas untuk kertas A4.
const PG_MONTH_ID = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];
const DOW_SHORT_ID = ["Min","Sen","Sel","Rab","Kam","Jum","Sab"];
// Tabel Gantt ringkas per hari, satu baris per site, satu kolom per tanggal kalender — memakai
// fungsi isBlocked yang sama persis dengan yang dipakai saat generate jadwal, supaya pembagian
// hari kerja vs buffer vs libur/terhold di sini konsisten dengan jadwal aslinya, bukan sekadar
// tebakan hari kalender berurutan.
function buildPrintGanttGrid(b){
  const schedule = b.schedule||[];
  if(!schedule.length) return "";
  const allStart = schedule[0].start, allEnd = schedule[schedule.length-1].end;
  const dates = [];
  let d = allStart;
  let guard = 0;
  while(d<=allEnd && guard<730){ dates.push(d); d = addDays(d,1); guard++; }
  if(!dates.length) return "";
  const monthGroups = [];
  dates.forEach(dt=>{
    const key = dt.slice(0,7);
    const last = monthGroups[monthGroups.length-1];
    if(last && last.key===key) last.count++; else monthGroups.push({key, count:1});
  });
  let html = `<div class="pg-gantt"><table><thead><tr><th class="pg-gantt-site">Site</th>`;
  html += monthGroups.map(g=>`<th colspan="${g.count}">${PG_MONTH_ID[Number(g.key.slice(5,7))-1]} ${g.key.slice(0,4)}</th>`).join("");
  html += `</tr><tr><th class="pg-gantt-site"></th>` + dates.map(dt=>`<th>${Number(dt.slice(8,10))}</th>`).join("") + `</tr></thead><tbody>`;
  schedule.forEach(row=>{
    let counted = 0;
    html += `<tr><td class="pg-gantt-site" title="${escHtml(row.site)}">${escHtml(row.site)}</td>`;
    dates.forEach(dt=>{
      if(dt<row.start || dt>row.end){ html += "<td></td>"; return; }
      if(isBlocked(row.site, dt)){ html += `<td class="pg-gantt-off"></td>`; return; }
      counted++;
      html += `<td class="${counted<=row.workDays?'pg-gantt-work':'pg-gantt-buffer'}"></td>`;
    });
    html += `</tr>`;
  });
  html += `</tbody></table></div>
  <div class="hint" style="font-size:8.5px;margin:2px 0 10px;">Kotak pekat = hari kerja sampling, kotak muda = hari buffer/cadangan, kotak kosong/putih = hari libur atau terhold sesuai Aturan Site &amp; Rute.</div>`;
  return html;
}
// Membangun halaman cetak berisi jadwal per site beserta daftar titik dan kolom ceklist kosong,
// dimaksudkan untuk dibawa fisik oleh tim sampling di lapangan sebagai panduan kerja, bukan untuk
// dilihat di layar. Memakai data batch yang sudah fix dari halaman Perencanaan Batch/Gantt, jadi
// tidak menduplikasi logika penjadwalan, hanya menyusun ulang tampilannya supaya pas untuk kertas A4.
function buildPrintGuideHtml(includeGantt){
  const view = document.getElementById("ganttView").value;
  const batchId = document.getElementById("ganttBatch").value;
  const teamForView = view==="overlay" ? null : view;
  let batches = teamForView ? DB.batches.filter(b=>b.team===teamForView) : DB.batches.slice();
  if(batchId) batches = batches.filter(b=>b.id===batchId);
  batches = batches.filter(b=>(b.schedule||[]).length && (b.items||[]).length);
  if(!batches.length) return null;

  const printedAt = new Date().toLocaleString("id-ID", {dateStyle:"long", timeStyle:"short"});
  const sections = batches.map(b=>{
    const excluded = b.excluded||[];
    const pts = b.items.map(id=>DB.points.find(p=>p.id===id)).filter(p=>p && !excluded.includes(p.id));
    // b.assignedPersonil isinya array {id, lead} (lihat renderPlannerPersonilTeam), BUKAN array
    // id string polos — pakai a.id, bukan langsung "a" sbg id, kalau tidak DB.personil.find selalu
    // gagal cocok (banding string id vs objek {id,lead} tidak akan pernah sama) & selalu tampil
    // "belum diisi" walau personil sudah ditunjuk di Perencanaan Batch.
    const personilNames = (b.assignedPersonil||[]).map(a=>DB.personil.find(p=>p.id===a.id)?.nama).filter(Boolean);
    // Rincian per-hari (bukan cuma daftar titik per-site polos) — pakai dailyAssignmentForRow yang
    // sama dgn papan "Detail Harian" di Gantt, jadi kalau jadwalnya sudah di-custom manual (drag
    // titik ke hari lain), hasil cetak ini otomatis ikut mencerminkan susunan finalnya, bukan cuma
    // pembagian rata generik. Baris pemisah hari (mirip kategori-row di Berita Acara) diberi aksen
    // merah tipis; hari buffer tetap ditampilkan (supaya kelihatan sbg cadangan) walau kosong.
    const siteRows = (b.schedule||[]).map((row, rowIdx)=>{
      const sitePts = pts.filter(p=>p.site===row.site);
      if(!sitePts.length) return "";
      // Site berikutnya yang BENERAN tercetak (bukan cuma entri berikutnya di b.schedule mentah) —
      // discan maju krn ada kemungkinan 1+ site di antaranya kosong utk konteks cetak ini (mis.
      // semua titiknya kebetulan dikeluarkan dari batch, lihat fitur exclude di Detail Harian).
      let nextPrintedRow = null;
      for(let j=rowIdx+1;j<(b.schedule||[]).length;j++){
        const candidate = b.schedule[j];
        if(pts.some(p=>p.site===candidate.site)){ nextPrintedRow = candidate; break; }
      }
      // Info perpindahan — kalau rutenya ada di TRAVEL_ROUTES (travel-routes.js, data FYI dari tim
      // lapangan) dipakai persis, kalau tidak baru balik ke panduan umum (jam bukan data tersimpan,
      // jadwal cuma per-tanggal, jadi generik memang seharusnya cuma perkiraan bukan jam presisi).
      const route = nextPrintedRow ? travelRouteInfo(row.site, nextPrintedRow.site) : null;
      const travelInfoHtml = route
        ? `<b>${escHtml(route.label)}</b>${route.note?" &mdash; "+escHtml(route.note):""}`
        : `Umumnya berangkat pagi (&plusmn;07:00&ndash;08:00 WIB) atau siang usai istirahat (&plusmn;13:00 WIB); perjalanan antar site sekitar 1&ndash;2 jam.`;
      const transitionNote = nextPrintedRow ? `<tr><td>
        <div class="pg-transition-note">&#8594; <b>Pindah ke Site ${escHtml(nextPrintedRow.site)}</b> &mdash; ${escHtml(fmtHariTanggalIndo(nextPrintedRow.start))}. ${travelInfoHtml}</div>
      </td></tr>` : "";
      const rangeLabel = row.start===row.end ? row.start : `${row.start} s.d. ${row.end}`;
      const asg = dailyAssignmentForRow(b, row);
      let rowNum = 0;
      const dayBlocks = Object.keys(asg).sort().map(dt=>{
        const a = asg[dt];
        const dayLabel = `${fmtHariTanggalIndo(dt)}${a.isBuffer?" — Buffer/Cadangan":""}`;
        const ptRows = a.points.map(p=>{
          rowNum++;
          const jenis = p.kategori==="emisi" ? escHtml(p.kategoriSumber||"-") : escHtml(NONEMISI_LABEL[p.kategori]||p.kategori);
          const spec = [p.kapasitas, p.jenisBahanBakar].filter(Boolean).join(", ") || "-";
          return `<tr>
            <td>${rowNum}</td>
            <td><b>${escHtml(p.nama)}</b></td>
            <td>${jenis}</td>
            <td>${escHtml(p.parameter||"-")}</td>
            <td>${escHtml(spec)}</td>
            <td style="text-align:center;"><span class="pg-box"></span></td>
            <td></td>
          </tr>`;
        }).join("");
        return `<tr class="pg-day-row${a.isBuffer?" pg-day-buffer":""}"><td colspan="7">${escHtml(dayLabel)}</td></tr>${ptRows || `<tr class="pg-day-empty"><td colspan="7">Belum ada titik dialokasikan ke hari ini.</td></tr>`}`;
      }).join("");
      // Titik yang dikeluarkan dari batch ini (lihat Detail Harian di Gantt) ikut dicetak di sini
      // supaya tim lapangan & yang menyusun batch berikutnya sama-sama lihat catatannya di kertas,
      // bukan cuma di layar.
      const excludedForSite = dedupeByGroup((b.excluded||[]).map(id=>DB.points.find(p=>p.id===id)).filter(p=>p && p.site===row.site));
      const excludedNote = excludedForSite.length ? `<div class="pg-site-note pg-site-note-excluded"><b>Tidak Ikut Batch Ini (${excludedForSite.length}):</b> ${excludedForSite.map(p=>{
        const r = (b.excludeReasons||{})[p.id] || {reason:"batch2", note:""};
        const reasonLabel = EXCLUDE_REASON_LABELS[r.reason] || r.reason;
        return `${escHtml(p.nama)} (${escHtml(reasonLabel)}${r.note?": "+escHtml(r.note):""})`;
      }).join("; ")}</div>` : "";
      // Batas ajukan izin masuk — H-N mundur dari tanggal mulai site ini (permitLeadDays per site,
      // diatur di Aturan Site & Rute, default H-2). Cuma pengingat/FYI, bukan constraint jadwal.
      const permitLeadDays = DB.siteRules[row.site]?.permitLeadDays ?? 2;
      const permitDate = addDays(row.start, -permitLeadDays);
      const permitNote = `<div class="pg-site-note pg-site-note-permit"><b>Ajukan Izin Masuk Site (H-${permitLeadDays}):</b> selambat-lambatnya ${escHtml(fmtHariTanggalIndo(permitDate))} — berjaga kalau jadwal kedatangan maju lebih cepat.</div>`;
      return `<tr><td>
        <div class="pg-site">
          <div class="pg-site-head"><span>Site ${escHtml(row.site)} (${sitePts.length} titik)</span><span>Jadwal: ${escHtml(rangeLabel)}</span></div>
          ${permitNote}
          ${row.dayDetailNote ? `<div class="pg-site-note"><b>Catatan Saat Sampling:</b> ${escHtml(row.dayDetailNote)}</div>` : ""}
          ${excludedNote}
          <table class="pg-table">
            <thead><tr><th style="width:16px;">No</th><th>Nama Titik / Cerobong</th><th>Jenis Sumber</th><th>Parameter Wajib</th><th>Kapasitas / Bahan Bakar</th><th style="width:40px;">Selesai</th><th style="width:110px;">Catatan Lapangan</th></tr></thead>
            <tbody>${dayBlocks}</tbody>
          </table>
        </div>
      </td></tr>${transitionNote}`;
    }).join("");
    return `<table class="pg-guide-page pg-batch">
      <thead><tr><td>
        <div class="pg-header">
          <div>
            <h1>Panduan Sampling Emisi &amp; Ambient PHM</h1>
            <div class="sub">${escHtml(b.name)}</div>
          </div>
          <div class="sub" style="text-align:right;">Dicetak ${escHtml(printedAt)}</div>
        </div>
        <div class="pg-meta">
          <div><b>Tim</b>${b.team==="emisi"?"Emisi":"Ambient"}</div>
          <div><b>Periode</b>Semester ${escHtml(DB.meta.semester)} Tahun ${escHtml(DB.meta.tahun)}</div>
          <div><b>Rentang Jadwal</b>${escHtml(b.start||"-")} s.d. ${escHtml((b.schedule[b.schedule.length-1]||{}).end||"-")}</div>
          <div><b>Jumlah Site</b>${(b.schedule||[]).length} site</div>
          <div><b>Jumlah Titik</b>${pts.length} titik</div>
          <div><b>Personil Ditugaskan</b>${personilNames.length?escHtml(personilNames.join(", ")):"belum diisi di Perencanaan Batch"}</div>
        </div>
      </td></tr></thead>
      <tfoot><tr><td>
        <div class="pg-foot">Dicetak otomatis dari PHM Emission Sampling Planner &amp; Tracker. Kolom Selesai dan Catatan Lapangan diisi manual oleh tim di lapangan, lalu diinput kembali ke tools pada halaman Tracking BA/CoA sekembalinya dari lokasi.</div>
      </td></tr></tfoot>
      <tbody>
        ${includeGantt ? `<tr><td>${buildPrintGanttGrid(b)}</td></tr>` : ""}
        ${siteRows || "<tr><td><div class='hint'>Tidak ada titik pada batch ini.</div></td></tr>"}
      </tbody>
    </table>`;
  }).join("");
  return sections;
}
// Menyetel orientasi kertas cetak secara dinamis lewat <style> terpisah — aturan @page tidak bisa
// diberi selector class/parent seperti elemen biasa, jadi cara paling aman adalah menulis ulang
// isinya tiap kali preferensi orientasi berubah, sebelum window.print() dipanggil.
function setPrintOrientation(orientation, marginMm){
  let styleEl = document.getElementById("printOrientationStyle");
  if(!styleEl){ styleEl = document.createElement("style"); styleEl.id = "printOrientationStyle"; document.head.appendChild(styleEl); }
  styleEl.textContent = `@page{size:A4 ${orientation==="landscape"?"landscape":"portrait"};margin:${marginMm||12}mm;}`;
}
// Tombol "Cetak Panduan Sampling" membuka dialog preferensi dulu (orientasi kertas & sertakan/tidak
// tabel Gantt ringkas) sebelum benar-benar mencetak, supaya jadwal yang berlangsung sangat lama bisa
// disesuaikan tampilannya (mis. pilih Lanskap, atau matikan tabel Gantt & cukup pakai daftar titik).
function printSamplingGuide(){
  const probe = buildPrintGuideHtml(false);
  if(!probe){ toast("Tidak ada batch dengan jadwal & titik pada filter Batch saat ini — buat jadwal dulu di Perencanaan Batch.","err"); return; }
  openModal(`
    <h3>Preferensi Cetak Panduan Sampling</h3>
    <div class="field"><label>Orientasi Kertas</label>
      <select id="pgOrientation"><option value="portrait">Potret (Portrait)</option><option value="landscape">Lanskap (Landscape)</option></select>
    </div>
    <div class="checkline" style="margin-top:10px;"><label><input type="checkbox" id="pgIncludeGantt" checked> Sertakan Tabel Jadwal Gantt Ringkas per Hari</label></div>
    <div class="hint">Tabel Gantt ringkas menampilkan seluruh site dalam satu tabel kalender harian per batch, supaya urutan dan tumpang tindih jadwal terlihat sekilas tanpa perlu membaca satu per satu. Untuk jadwal yang berlangsung sangat lama, gunakan orientasi Lanskap supaya kolom tanggal tidak terlalu sempit, atau nonaktifkan tabel ini dan cukup gunakan daftar titik per site.</div>
    <div class="actions"><button class="btn ghost" data-action="closeModal">Batal</button><button class="btn primary" data-action="doPrintSamplingGuide">Cetak</button></div>
  `);
}
function doPrintSamplingGuide(){
  const orientation = document.getElementById("pgOrientation").value;
  const includeGantt = document.getElementById("pgIncludeGantt").checked;
  const html = buildPrintGuideHtml(includeGantt);
  if(!html){ toast("Tidak ada batch dengan jadwal & titik pada filter Batch saat ini.","err"); closeModal(); return; }
  setPrintOrientation(orientation);
  document.getElementById("printGuideArea").innerHTML = html;
  closeModal();
  window.print();
}

// Kelompokkan ambient-family (ambient/kebisingan/kebauan/getaran) di lokasi sama jadi satu
// representasi tampilan — pilih satu record wakil per kelompok (namanya identik di ke-4nya).
function dedupeByGroup(pts){
  const seen = new Set(), out = [];
  pts.forEach(p=>{ const k=schedulingGroupKey(p); if(seen.has(k)) return; seen.add(k); out.push(p); });
  return out;
}
function pointsForRow(b, row){
  const excluded = b.excluded||[];
  const raw = b.items.map(id=>DB.points.find(p=>p.id===id)).filter(p=>p && p.site===row.site && !excluded.includes(p.id));
  return dedupeByGroup(raw);
}
// Semua titik batch ini di site tsb, TERMASUK yang sudah ditandai "tidak bisa disampling" —
// dipakai khusus untuk kolom detail yang bisa diklik (beda dari pointsForRow yang cuma titik aktif).
function allPointsForSite(b, site){
  const raw = b.items.map(id=>DB.points.find(p=>p.id===id)).filter(p=>p && p.site===site);
  return dedupeByGroup(raw);
}
// Titik ditandai tidak bisa disampling periode ini (mis. hasil KOM: engine masih running) —
// otomatis mengecilkan/membesarkan hari kerja site itu & menggeser site-site setelahnya.
function recomputeSiteForPoint(b, pointId, nowExcluded){
  const p = DB.points.find(x=>x.id===pointId); if(!p) return;
  const rowIdx = b.schedule.findIndex(r=>r.site===p.site);
  if(rowIdx<0) return;
  const row = b.schedule[rowIdx];
  const excluded = b.excluded||[];
  const activePts = b.items.map(id=>DB.points.find(x=>x.id===id)).filter(pt=>pt && pt.site===p.site && !excluded.includes(pt.id));
  const activeCount = new Set(activePts.map(dayCountGroupKey)).size;
  const rule = DB.siteRules[p.site];
  const perSiteRatio = rule ? Number(b.team==="emisi"?rule.ratioEmisi:rule.ratioAmbient) : 0;
  const ratio = perSiteRatio>0 ? perSiteRatio : b.ratio;
  row.count = activeCount;
  row.workDays = activeCount>0 ? Math.max(1, Math.ceil(activeCount/ratio)) : 0;
  recalcScheduleFrom(b, rowIdx);
  applyScheduleToPoints(b, b.team);
  logChange(`${p.nama} (${p.site}) ditandai ${nowExcluded?"tidak bisa disampling":"bisa disampling lagi"} — jadwal site disesuaikan`);
  save();
  renderGantt();
  renderMaster();
  toast(`${p.nama} ditandai ${nowExcluded?"TIDAK bisa disampling periode ini":"kembali dikonfirmasi bisa disampling"} — jadwal site ${p.site} disesuaikan otomatis.`,"ok");
}
// Key dipakai di b.dayOverrides utk mengunci 1 GRUP HARI (lihat dayCountGroupKey — ambient-family
// atau Flare yg digabung) ke tanggal tertentu secara manual — dicek di dailyAssignmentForRow
// SEBELUM jatuh ke pembagian rata otomatis, jadi hasil drag-drop di papan Detail Harian bertahan
// lintas render/reload, bukan cuma efek visual sesaat. Pakai dayCountGroupKey (bukan
// schedulingGroupKey polos) supaya drag 1 kartu Flare ikut memindah SEMUA titik Flare digabung
// itu ke hari yang sama, konsisten dgn cara hari itu dihitung di generateSchedule.
function dayOverrideKey(site, p){ return site+"::"+dayCountGroupKey(p); }
// Distributes a site's points across its actual valid work days (skipping blocked/crew-change
// days) so the calendar can show which specific point is sampled on which day. Titik dikelompokkan
// dulu per dayCountGroupKey (unit PENJADWALAN, bisa gabung banyak titik Flare jadi 1 slot hari) —
// auto-bagi-rata & override jalan di level grup itu, baru grupnya "dipecah" lagi jadi titik-titik
// individualnya saat ditaruh ke tanggal, supaya SEMUA titik Flare tetap muncul namanya
// masing-masing di kartu terpisah (bukan cuma 1 titik wakil), cuma mendarat di hari yang sama.
// Titik yang sudah dikunci manual (b.dayOverrides, lihat Detail Harian di Gantt) dipasang duluan
// ke tanggalnya; sisanya dibagi rata seperti biasa ke seluruh hari kerja.
function dailyAssignmentForRow(b, row){
  const days = [];
  let d = row.start, iter = 0;
  while(d <= row.end && iter < 1000){
    if(!isBlocked(row.site,d)) days.push(d);
    d = addDays(d,1); iter++;
  }
  const workDates = days.slice(0, row.workDays);
  const pts = pointsForRow(b, row);
  const groups = new Map();
  pts.forEach(p=>{
    const k = dayCountGroupKey(p);
    if(!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  });
  const overrides = b.dayOverrides || {};
  const overriddenGroups = [], autoGroups = [];
  groups.forEach((members, key)=>{
    const od = overrides[row.site+"::"+key];
    if(od && days.includes(od)) overriddenGroups.push({members, date: od});
    else autoGroups.push(members);
  });
  const perDay = Math.ceil(autoGroups.length / (workDates.length||1)) || 1;
  const map = {};
  days.forEach(dt=>{ map[dt] = {points: [], isBuffer: !workDates.includes(dt)}; });
  let ptr = 0;
  workDates.forEach(dt=>{
    autoGroups.slice(ptr, ptr+perDay).forEach(members=>{ map[dt].points.push(...members); });
    ptr += perDay;
  });
  overriddenGroups.forEach(({members,date})=>{ map[date].points.push(...members); });
  return map;
}

// Day-grid Gantt: satu baris per site, satu kolom per hari kalender, seluruh rentang
// jadwal tampil sekaligus (scroll horizontal) — tidak dipaginasi per bulan seperti
// kalender lama, supaya langsung kelihatan site A berapa hari lalu pindah ke site B berapa hari.
function buildDayGridView(rows){
  if(!rows.length){
    document.getElementById("ganttMeta").textContent = "";
    return "<div class='hint' style='padding:16px;'>Belum ada jadwal untuk ditampilkan. Buka halaman <b>Perencanaan Batch</b>, isi tanggal mulai, lalu klik <b>Buat &amp; Terapkan Jadwal</b>.</div>";
  }
  const allDates = rows.flatMap(r=>[r.start,r.end]);
  const minDate = allDates.reduce((a,b)=>a<b?a:b), maxDate = allDates.reduce((a,b)=>a>b?a:b);
  const totalDays = daysBetweenInclusive(minDate, maxDate);
  document.getElementById("ganttMeta").innerHTML = `Periode jadwal: <b>${minDate}</b> &rarr; <b>${maxDate}</b> (${totalDays} hari) &middot; ${rows.length} baris site &middot; tarik (drag) kotak berwarna ke tanggal lain untuk menggeser jadwal.`;

  const asgByRow = new Map(rows.map(r=>[r, (r.batch && r.rowIdx!=null) ? dailyAssignmentForRow(r.batch, r) : {}]));
  const today = todayStr();
  // Kumpulan tanggal yang jadi hari crew change utk SETIDAKNYA satu site yang lagi tampil — dipakai
  // menandai kolom tanggal itu di HEADER (penanda cepat sekilas), di atas outline merah per-sel yang
  // sudah ada di tiap baris site (lihat dg-cc di bawah).
  const ccDates = new Set();
  rows.forEach(r=>{
    let d = r.start, iter=0;
    while(d<=r.end && iter<1000){ if(isCrewChange(r.site,d)) ccDates.add(d); d=addDays(d,1); iter++; }
  });

  // Header dua-tingkat: baris bulan (colspan per bulan) di atas, baris tanggal polos di bawah —
  // lebih rapi daripada nama bulan diulang-ulang kecil di tiap kolom tanggal.
  const dateList = []; for(let i=0;i<totalDays;i++) dateList.push(addDays(minDate,i));
  const monthRuns = [];
  dateList.forEach(dt=>{
    const key = dt.slice(0,7);
    const last = monthRuns[monthRuns.length-1];
    if(last && last.key===key) last.count++; else monthRuns.push({key, count:1});
  });
  let html = `<div class="daygrid-scroll"><table class="daygrid"><thead>`;
  html += `<tr><th class="dg-th-label dg-col-sticky" rowspan="2">Site</th>`;
  monthRuns.forEach(m=>{
    const [y,mo] = m.key.split("-");
    html += `<th class="dg-th-month" colspan="${m.count}">${MONTH_SHORT_ID[Number(mo)-1]} ${y}</th>`;
  });
  html += `<th class="dg-th-label" style="min-width:220px;" rowspan="2">Titik Pantau</th></tr><tr>`;
  dateList.forEach(dt=>{
    const dow = dayOfWeek(dt);
    const isWeekend = dow===0||dow===6;
    const isToday = dt===today;
    const isCC = ccDates.has(dt);
    html += `<th class="dg-th-date${isWeekend?" weekend":""}${isToday?" today":""}${isCC?" dg-th-cc":""}" title="${isCC?"Ada site dgn crew change tanggal ini":""}"><span class="dow">${DOW_SHORT_ID[dow]}</span><span class="dd">${Number(dt.slice(8,10))}</span></th>`;
  });
  html += `</tr></thead><tbody>`;

  const showTeamDivider = new Set(rows.map(r=>r.team)).size>1;
  const colspan = totalDays+2;
  let lastTeam = null;
  rows.forEach(r=>{
    if(showTeamDivider && r.team!==lastTeam){
      lastTeam = r.team;
      const label = r.team==="emisi" ? "Tim Emisi" : "Tim Ambient";
      const color = r.team==="emisi" ? "#0ea5a0" : "#3d78c9";
      html += `<tr class="dg-team-divider"><td colspan="${colspan}" style="border-left:4px solid ${color};">${label}</td></tr>`;
    }
    const asg = asgByRow.get(r) || {};
    const color = r.team==="emisi" ? "#0ea5a0" : "#3d78c9";
    const adjustBtn = r.batch ? `<button class="btn small ghost" data-action="openAdjustDuration" data-batch-id="${r.batch.id}" data-row-idx="${r.rowIdx}" title="Adjust durasi manual (percepat/perpanjang) + catatan" style="padding:1px 6px;font-size:10px;">&#9998; Adjust</button>` : "";
    const dayDetailBtn = r.batch ? `<button class="btn small ghost" data-action="openDayDetail" data-batch-id="${r.batch.id}" data-row-idx="${r.rowIdx}" title="Custom manual: titik mana masuk hari mana (drag-drop), atau keluarkan titik dari batch ini" style="padding:1px 6px;font-size:10px;">&#128203; Detail Harian</button>` : "";
    // Badge "N dikeluarkan" — ringkasan cepat supaya kelihatan tanpa perlu buka Detail Harian dulu;
    // dedupeByGroup sama seperti daftar di modalnya, biar angkanya konsisten (1 kunjungan
    // ambient-family = 1 hitungan, bukan per parameter).
    const excludedCount = r.batch ? dedupeByGroup((r.batch.excluded||[]).map(id=>DB.points.find(p=>p.id===id)).filter(p=>p && p.site===r.site)).length : 0;
    const excludedBadge = excludedCount ? `<span class="badge b-red" style="font-size:9.5px;padding:1px 6px;" title="Titik yang dikeluarkan dari batch ini di site ${escHtml(r.site)} — buka Detail Harian utk lihat/kelola">&#9888; ${excludedCount} dikeluarkan</span>` : "";
    const dragHandle = r.batch ? `<span class="route-drag-handle" title="Tarik untuk ubah urutan site di batch ini">&#8942;&#8942;</span>` : "";
    // Tanggal tim pindah dari site INI ke site berikutnya di batch yang sama (kalau ada) — dipakai
    // menandai kolom perpindahan dgn anak panah di bawah, DAN ditulis sbg info singkat di kolom
    // label kiri (dihitung di sini, sebelum baris label, supaya bisa dipakai di keduanya). Diambil
    // dari tanggal mulai site berikutnya (bukan field terpisah) supaya OTOMATIS ikut kalau site
    // manapun digeser drag-drop, tidak perlu disinkronkan manual.
    const nextRow = (r.batch && r.rowIdx!=null) ? r.batch.schedule[r.rowIdx+1] : null;
    const transitionDate = nextRow ? nextRow.start : null;
    const transitionInfoLine = nextRow ? `<br><span style="color:#c98a1a;">&#8594; Pindah ke ${escHtml(nextRow.site)}: mulai ${nextRow.start} <span class="muted" style="font-size:10px;">(tarik &#8594; di kalender utk geser)</span></span>` : "";
    html += `<tr><td class="dg-td-label dg-col-sticky" draggable="${r.batch?"true":"false"}" data-batch-id="${r.batch?r.batch.id:""}" data-row-idx="${r.rowIdx}"><div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">${dragHandle}<b>${escHtml(r.site)}</b>${adjustBtn}${dayDetailBtn}${excludedBadge}</div><div class="sub">${escHtml(r.batchName)} &middot; ${r.workDays} hari kerja${r.bufferDays?" + "+r.bufferDays+" buffer":""} &middot; ${r.start} &rarr; ${r.end}${r.adjustNote?`<br><span style="color:#a02a24;">&#9998; ${escHtml(r.adjustNote)}</span>`:""}${transitionInfoLine}</div></td>`;
    for(let i=0;i<totalDays;i++){
      const dt = addDays(minDate,i);
      const inRange = dt>=r.start && dt<=r.end;
      const isToday = dt===today;
      if(!inRange){
        // Outline merah crew change ditandai di SELURUH kolom tanggal site ini (bukan cuma yang
        // kebetulan lagi dalam rentang jadwal aktif) — supaya pola "site X selalu crew change tiap
        // hari Y" langsung kelihatan di sepanjang kalender, bukan cuma pas ada jadwal jalan.
        const ccEmpty = isCrewChange(r.site, dt);
        if(dt===transitionDate){
          // Kotak "pindah ke site berikutnya" — transisi selalu jatuh SETELAH r.end (dicek lewat
          // minAllowed di handleScheduleDrop & cursor di recalcScheduleFrom), jadi selalu masuk
          // cabang !inRange ini, tidak pernah bentrok sama kotak kerja aktif site ini sendiri.
          // draggable: bisa ditarik ke kolom tanggal lain (row manapun, cuma tanggal targetnya yang
          // dipakai — lihat setupGanttDragDrop) utk geser transisi ini; buffer site r "dikorbankan"
          // otomatis kalau digeser lebih awal (lihat handleTransitionDrop), hari kerja wajib tetap
          // dihormati/tidak bisa dipotong.
          const routeInfo = travelRouteInfo(r.site, nextRow.site);
          const title = `Pindah ke ${nextRow.site} — mulai ${nextRow.start}${routeInfo?` · ${routeInfo.label}`:""}${ccEmpty?` (${r.site}: hari crew change)`:""} — tarik utk geser tanggal pindah`;
          html += `<td class="dg-day-cell dg-empty dg-transition${isToday?" dg-today-col":""}${ccEmpty?" dg-cc-empty":""}" draggable="true" data-batch-id="${r.batch.id}" data-row-idx="${r.rowIdx}" data-date="${dt}" title="${escHtml(title)}"><span class="dg-transition-arrow">&#8594;</span></td>`;
        } else {
          const title = ccEmpty ? `${r.site} — ${dt} (hari crew change)` : "";
          html += `<td class="dg-day-cell dg-empty${isToday?" dg-today-col":""}${ccEmpty?" dg-cc-empty":""}" data-date="${dt}" title="${escHtml(title)}"></td>`;
        }
      } else {
        const a = asg[dt] || {points:[], isBuffer:false};
        const names = a.points.map(p=>p.nama).join(", ");
        const cc = isCrewChange(r.site, dt);
        const title = `${r.site} — ${dt}${names?" — "+names:(a.isBuffer?" — buffer":"")}${cc?" (hari crew change)":""}`;
        const cls = "dg-day-cell"+(a.isBuffer?" dg-buffer":"")+(cc?" dg-cc":"")+(isToday?" dg-today-col":"");
        html += `<td class="${cls}" draggable="true" data-batch-id="${r.batch?r.batch.id:""}" data-row-idx="${r.rowIdx}" data-date="${dt}" style="background:${color};" title="${escHtml(title)}">${Number(dt.slice(8,10))}</td>`;
      }
    }
    const detailPts = r.batch ? allPointsForSite(r.batch, r.site) : [];
    const excludedIds = r.batch ? (r.batch.excluded||[]) : [];
    const pillsHtml = detailPts.map(p=>{
      const excl = excludedIds.includes(p.id);
      const siblings = AMBIENT_FAMILY.includes(p.kategori) ? DB.points.filter(x=>schedulingGroupKey(x)===schedulingGroupKey(p)) : [p];
      const suffix = siblings.length>1 ? ` (${siblings.length} parameter: ${siblings.map(s=>NONEMISI_LABEL[s.kategori]||s.kategori).join(", ")})` : "";
      const action = excl?"konfirmasi bisa disampling lagi":"tandai TIDAK bisa disampling periode ini";
      return `<span class="pt-pill${excl?" excluded":""}" data-action="toggleExcludePoint" data-batch-id="${r.batch.id}" data-point-id="${p.id}" title="Klik untuk ${action}${suffix?" — semua parameter di titik ini ikut":""}">${escHtml(p.nama)}${escHtml(suffix)}</span>`;
    }).join("");
    html += `<td class="dg-td-detail">${pillsHtml || "-"}</td></tr>`;
  });
  html += `</tbody></table></div>`;
  html += `<div class="legend" style="margin-top:12px;">
    <span class="item"><span class="sw" style="background:#0ea5a0"></span> Sampling Emisi</span>
    <span class="item"><span class="sw" style="background:#3d78c9"></span> Sampling Ambient</span>
    <span class="item"><span class="sw" style="background:#0ea5a0;opacity:.5;"></span> Hari Buffer (pudar)</span>
    <span class="item"><span class="sw" style="background:#fff;box-shadow:inset 0 0 0 2px #e0554f;"></span> Hari Crew Change (info — larangan cuma berlaku utk BERANGKAT dari site itu, datang tetap aman)</span>
    <span class="item"><span class="sw" style="background:#fdf3e3;box-shadow:inset 0 0 0 2px #c98a1a;"></span> &#8594; Pindah ke Site Berikutnya</span>
  </div>`;
  return html;
}

// Status "Finalisasi Jadwal" murni penanda/badge (bukan kunci teknis) — batch yang sedang dipilih
// di filter Batch masih tetap bisa di-generate ulang/di-custom kalau perlu, finalize cuma cara tim
// bilang "ini sudah oke, siap dicetak & dibawa" biar kelihatan jelas di layar.
function renderFinalizeStatus(){
  const el = document.getElementById("ganttFinalizeStatus"); if(!el) return;
  const batchId = document.getElementById("ganttBatch").value;
  const b = DB.batches.find(x=>x.id===batchId);
  if(!b){ el.innerHTML = ""; return; }
  if(b.finalized){
    el.innerHTML = `<div class="section-note" style="border-color:#3fb27f;background:#eafaf1;color:#1f7a4d;margin-top:8px;">&#9989; Jadwal batch "<b>${escHtml(b.name)}</b>" sudah <b>difinalisasi</b> pada ${fmtDateTimeId(b.finalizedAt)}. <button class="btn small ghost" data-action="unfinalizeBatchSchedule" style="margin-left:8px;">Batalkan Finalisasi</button></div>`;
  } else {
    el.innerHTML = "";
  }
}
function finalizeBatchSchedule(){
  const batchId = document.getElementById("ganttBatch").value;
  const b = DB.batches.find(x=>x.id===batchId);
  if(!b){ toast('Pilih 1 batch spesifik dulu di filter "Batch" di atas (bukan "Semua batch").',"err"); return; }
  if(!(b.schedule||[]).length){ toast("Batch ini belum punya jadwal — generate dulu di Perencanaan Batch.","err"); return; }
  b.finalized = true; b.finalizedAt = new Date().toISOString();
  logChange(`Jadwal batch "${b.name}" difinalisasi`);
  save();
  renderFinalizeStatus();
  toast(`Jadwal "${b.name}" ditandai final. Siap dicetak lewat "Cetak Panduan Sampling".`,"ok");
}
function unfinalizeBatchSchedule(){
  const batchId = document.getElementById("ganttBatch").value;
  const b = DB.batches.find(x=>x.id===batchId); if(!b) return;
  b.finalized = false;
  logChange(`Finalisasi jadwal batch "${b.name}" dibatalkan`);
  save();
  renderFinalizeStatus();
  toast("Finalisasi dibatalkan — batch bisa di-custom/generate ulang lagi.","ok");
}
// Ringkasan "hari crew change" per site yang lagi tampil di filter Gantt saat ini — pembanding
// cepat tanpa harus buka halaman Aturan Site & Rute, sumber datanya tetap dari sana (DB.siteRules).
function renderGanttCrewChangeInfo(batches){
  const el = document.getElementById("ganttCrewChangeInfo");
  if(!el) return;
  const sites = [...new Set(batches.flatMap(b=>(b.schedule||[]).map(r=>r.site)))].sort();
  if(!sites.length){ el.innerHTML = ""; return; }
  el.innerHTML = `<b>Hari Crew Change per Site:</b> ` + sites.map(s=>{
    const day = DB.siteRules[s] ? DB.siteRules[s].crewChangeDay : "";
    return `${escHtml(s)}: <b style="${day===""||day==null?"":"color:#a02a24;"}">${day===""||day==null?"tidak diatur":DOW_LABEL[Number(day)]}</b>`;
  }).join(" &middot; ") + ` <span class="muted">(ubah di Aturan Site &amp; Rute)</span>`;
}
function renderGantt(){
  refreshGanttBatchSelect();
  renderFinalizeStatus();
  const view = document.getElementById("ganttView").value;
  const batchId = document.getElementById("ganttBatch").value;
  let batches = view==="overlay" ? DB.batches : DB.batches.filter(b=>b.team===view);
  if(batchId) batches = batches.filter(b=>b.id===batchId);
  renderGanttCrewChangeInfo(batches);
  const mode = document.getElementById("ganttMode").value;
  if(mode==="bar"){
    document.getElementById("ganttWrap").innerHTML = buildGanttSVG(batches);
  } else {
    const rows = [];
    batches.forEach(b=>(b.schedule||[]).forEach((r,idx)=>rows.push({...r, team:b.team, batchName:b.name, batch:b, rowIdx:idx})));
    // Overlay: kelompokkan per tim (Emisi dulu, lalu Ambient) supaya ada pemisah visual yang jelas,
    // bukan tercampur acak sesuai urutan batch dibuat.
    if(view==="overlay") rows.sort((a,c)=> a.team===c.team ? 0 : (a.team==="emisi"?-1:1));
    document.getElementById("ganttWrap").innerHTML = buildDayGridView(rows);
  }
  document.getElementById("scurveWrap").innerHTML = buildSCurveSVG(batches, DB.points, view);
}
function handleScheduleDrop(batchId, rowIdx, newDate){
  const b = DB.batches.find(x=>x.id===batchId); if(!b) return;
  const row = b.schedule[rowIdx]; if(!row || !newDate) return;
  if(newDate === row.start) return;
  const minAllowed = rowIdx>0 ? addDays(b.schedule[rowIdx-1].end,1) : null;
  if(minAllowed && newDate < minAllowed){
    toast(`Tidak bisa dimulai sebelum site ${b.schedule[rowIdx-1].site} selesai (${minAllowed}).`,"err");
    return;
  }
  recalcScheduleFrom(b, rowIdx, newDate);
  if(rowIdx===0) b.start = newDate;
  applyScheduleToPoints(b, b.team);
  logChange(`Site ${row.site} (${b.name}) digeser ke ${newDate}`);
  save();
  renderGantt();
  renderMaster();
  loadBatchIntoForm();
  toast(`Site ${row.site} dipindah ke ${newDate}. Jadwal site setelahnya ikut menyesuaikan.`+(row.crewChangeNote?` Catatan: ${row.crewChangeNote}.`:""),"ok");
}
// Hitung berapa hari VALID (bukan isBlocked) dalam rentang [start,end] inklusif di site tsb — cara
// hitungnya persis sama dgn loop counted++ di recalcScheduleFrom, supaya hasil geser transisi
// (lihat handleTransitionDrop) konsisten dgn cara jadwal aslinya dihitung.
function countValidDaysInclusive(site, start, end){
  let d = start, count = 0, iterations = 0;
  while(d<=end && iterations<730){
    if(!isBlocked(site,d)) count++;
    d = addDays(d,1);
    iterations++;
  }
  return count;
}
// Tanggal transisi PALING CEPAT yg masih menghormati hari kerja wajib site ini (buffer sudah
// dikorbankan smp 0) — dipakai utk pesan error yg actionable pas geser transisi ditolak.
function earliestTransitionDate(site, start, workDays){
  let d = start, counted = 0, iterations = 0, lastDate = start;
  while(counted<workDays && iterations<730){
    if(!isBlocked(site,d)){ counted++; lastDate = d; }
    d = addDays(d,1);
    iterations++;
  }
  return addDays(lastDate,1);
}
// Geser tanggal PINDAH dari site (rowIdx) ke site berikutnya — beda dari handleScheduleDrop (yang
// menggeser tanggal MULAI satu site apa adanya): di sini hari buffer site yang DITINGGALKAN
// (rowIdx) yang "dikorbankan"/ditambah supaya transisinya jatuh di tanggal baru, hari kerja WAJIB
// site itu tetap dihormati (tidak bisa dipotong). Site rowIdx sendiri TIDAK pindah tanggal mulai;
// yang berubah cuma end/bufferDays-nya, lalu recalcScheduleFrom yang biasa meng-cascade ke site-site
// setelahnya (termasuk mencari hari valid pertama utk site berikutnya via findValidStart, jadi
// kalau tanggal yang diminta user kebetulan jatuh pas isBlocked/crew change site berikutnya,
// otomatis digeser ke hari valid terdekat — sama seperti generate/adjust biasa, bukan dipaksa).
function handleTransitionDrop(batchId, rowIdx, newDate){
  const b = DB.batches.find(x=>x.id===batchId); if(!b) return;
  const row = b.schedule[rowIdx];
  const nextRow = b.schedule[rowIdx+1];
  if(!row || !nextRow || !newDate) return;
  if(newDate === nextRow.start) return;
  if(newDate <= row.start){
    toast(`Tanggal pindah harus setelah site ${row.site} mulai (${row.start}).`,"err");
    return;
  }
  const availableDays = countValidDaysInclusive(row.site, row.start, addDays(newDate,-1));
  if(availableDays < row.workDays){
    const minDate = earliestTransitionDate(row.site, row.start, row.workDays);
    toast(`Tidak bisa dipindah ke ${newDate} — site ${row.site} masih butuh ${row.workDays} hari kerja wajib (buffer boleh dikorbankan, hari kerja inti tidak). Paling cepat: ${minDate}.`,"err");
    return;
  }
  row.bufferDays = availableDays - row.workDays;
  recalcScheduleFrom(b, rowIdx);
  applyScheduleToPoints(b, b.team);
  const actualDate = nextRow.start;
  logChange(`Transisi ${row.site} → ${nextRow.site} (${b.name}) digeser ke ${actualDate}${actualDate!==newDate?` (diminta ${newDate})`:""} — buffer ${row.site} disesuaikan jadi ${row.bufferDays} hari`);
  save();
  renderGantt();
  renderMaster();
  loadBatchIntoForm();
  if(actualDate===newDate){
    toast(`Transisi ${row.site} → ${nextRow.site} dipindah ke ${newDate}. Jadwal site setelahnya ikut menyesuaikan.`,"ok");
  } else {
    toast(`Digeser ke ${actualDate} (bukan ${newDate} persis) — ${nextRow.site} perlu hari valid pertama (cek Hari Terhold/Crew Change site tsb).`,"ok");
  }
}
// Geser urutan SITE di jadwal satu batch (drag baris label di kiri) — beda dari drag kotak
// tanggal (yang cuma menggeser tanggal mulai satu site). Reorder dibatasi dalam satu batch yang
// sama karena urutan & kaskade tanggal cuma masuk akal per-batch. Setelah reorder, tanggal
// dihitung ulang dari awal, lalu disebar ke titik pantau (Master), Gantt, dan S-Curve — semuanya
// baca dari DB.batches/DB.points yang sama jadi otomatis ikut update begitu di-render ulang.
function handleRowReorder(batchId, fromIdx, toIdx){
  const b = DB.batches.find(x=>x.id===batchId); if(!b) return;
  if(fromIdx===toIdx) return;
  const sched = b.schedule;
  const moved = sched[fromIdx]; if(!moved) return;
  snapshotBefore(`Sebelum ubah urutan site "${b.name}"`);
  sched.splice(fromIdx,1);
  sched.splice(toIdx,0,moved);
  recalcScheduleFrom(b, 0, b.start);
  applyScheduleToPoints(b, b.team);
  logChange(`Urutan site di jadwal "${b.name}" diubah — ${moved.site} dipindah ke posisi ${toIdx+1}`);
  save();
  renderGantt(); renderMaster(); loadBatchIntoForm();
  toast(`Urutan site diperbarui, tanggal jadwal dihitung ulang otomatis.`,"ok");
}
(function setupGanttDragDrop(){
  const wrap = document.getElementById("ganttWrap");
  wrap.addEventListener("dragstart", e=>{
    // Kotak transisi (panah →) dicek DULUAN — dia juga punya class dg-day-cell, jadi kalau cabang
    // day-cell biasa di bawah dicek lebih dulu, drag transisi bakal ketangkep sana & salah dianggap
    // "geser tanggal mulai site ini apa adanya" (handleScheduleDrop) alih-alih "geser transisi,
    // korbankan buffer site yg ditinggalkan" (handleTransitionDrop) — dua semantik yg beda.
    const transitionCell = e.target.closest("td.dg-transition[draggable='true']");
    if(transitionCell){
      e.dataTransfer.setData("application/x-transition-drag", JSON.stringify({batchId:transitionCell.dataset.batchId, rowIdx:Number(transitionCell.dataset.rowIdx)}));
      e.dataTransfer.effectAllowed = "move";
      return;
    }
    const chip = e.target.closest("td.dg-day-cell[draggable='true']");
    if(chip){
      e.dataTransfer.setData("text/plain", JSON.stringify({batchId:chip.dataset.batchId, rowIdx:Number(chip.dataset.rowIdx)}));
      e.dataTransfer.effectAllowed = "move";
      return;
    }
    const label = e.target.closest("td.dg-td-label[draggable='true']");
    if(label){
      e.dataTransfer.setData("application/x-row-reorder", JSON.stringify({batchId:label.dataset.batchId, rowIdx:Number(label.dataset.rowIdx)}));
      e.dataTransfer.effectAllowed = "move";
    }
  });
  wrap.addEventListener("dragover", e=>{
    const cell = e.target.closest("td[data-date]");
    if(cell){ e.preventDefault(); cell.classList.add("dragover"); return; }
    const label = e.target.closest("td.dg-td-label[draggable='true']");
    if(label){ e.preventDefault(); label.classList.add("dragover"); }
  });
  wrap.addEventListener("dragleave", e=>{
    const cell = e.target.closest("td[data-date]");
    if(cell) cell.classList.remove("dragover");
    const label = e.target.closest("td.dg-td-label[draggable='true']");
    if(label) label.classList.remove("dragover");
  });
  wrap.addEventListener("drop", e=>{
    const cell = e.target.closest("td[data-date]");
    if(cell){
      e.preventDefault();
      cell.classList.remove("dragover");
      // Drop target-nya cuma peduli TANGGAL kolom yg dituju (cell.dataset.date), bukan row visual
      // tempat kolom itu digambar — jadi transisi bisa "ditarik ke bawah" ke row site berikutnya
      // seperti diminta, atau digeser ke kolom lain di row asalnya sendiri, dua-duanya valid.
      const transitionRaw = e.dataTransfer.getData("application/x-transition-drag");
      if(transitionRaw){
        let payload; try{ payload = JSON.parse(transitionRaw); }catch(_){ return; }
        if(!payload || !payload.batchId) return;
        handleTransitionDrop(payload.batchId, payload.rowIdx, cell.dataset.date);
        return;
      }
      let payload;
      try{ payload = JSON.parse(e.dataTransfer.getData("text/plain")); }catch(_){ return; }
      if(!payload || !payload.batchId) return;
      handleScheduleDrop(payload.batchId, payload.rowIdx, cell.dataset.date);
      return;
    }
    const label = e.target.closest("td.dg-td-label[draggable='true']");
    if(label){
      e.preventDefault();
      label.classList.remove("dragover");
      let payload;
      try{ payload = JSON.parse(e.dataTransfer.getData("application/x-row-reorder")); }catch(_){ return; }
      if(!payload || !payload.batchId) return;
      if(payload.batchId !== label.dataset.batchId){
        toast("Cuma bisa ubah urutan site dalam batch yang sama.","err");
        return;
      }
      handleRowReorder(payload.batchId, payload.rowIdx, Number(label.dataset.rowIdx));
    }
  });
})();

function buildGanttSVG(batches){
  const rows = [];
  batches.forEach(b=>{
    (b.schedule||[]).forEach(r=>{
      rows.push({batchName:b.name, team:b.team, site:r.site, start:r.start, end:r.end, workDays:r.workDays, bufferDays:r.bufferDays, count:r.count});
    });
  });
  if(!rows.length){
    document.getElementById("ganttMeta").textContent = "";
    return "<div class='hint' style='padding:16px;'>Belum ada jadwal untuk ditampilkan. Buka halaman <b>Perencanaan Batch</b>, isi tanggal mulai, lalu klik <b>Buat &amp; Terapkan Jadwal</b>.</div>";
  }

  const allDates = rows.flatMap(r=>[r.start, r.end]);
  const minDate = allDates.reduce((a,b)=>a<b?a:b);
  const maxDate = allDates.reduce((a,b)=>a>b?a:b);
  const totalDays = daysBetweenInclusive(minDate,maxDate);
  document.getElementById("ganttMeta").innerHTML = `Periode: <b>${minDate}</b> &rarr; <b>${maxDate}</b> (${totalDays} hari) &nbsp;·&nbsp; ${rows.length} baris site`;

  const dayW = Math.max(30, Math.min(52, Math.floor(2200/totalDays)));
  const rowH = 58, leftW = 220, topH = 60;
  const W = leftW + totalDays*dayW + 20;
  const H = topH + rows.length*rowH + 16;

  let svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="font-size:13px;background:#fff;border:1px solid var(--gray-200);border-radius:10px;font-family:var(--font-ui);">`;
  // day grid + labels
  for(let i=0;i<totalDays;i++){
    const dt = addDays(minDate,i);
    const x = leftW + i*dayW;
    const dow = dayOfWeek(dt);
    const isWeekend = dow===0||dow===6;
    svg += `<rect x="${x}" y="${topH}" width="${dayW}" height="${H-topH}" fill="${isWeekend?'#f4f7f9':'#fff'}" />`;
    svg += `<text x="${x+dayW/2}" y="22" text-anchor="middle" fill="#7f8fa0" font-size="10.5px">${DOW_LABEL[dow].slice(0,3)}</text>`;
    svg += `<text x="${x+dayW/2}" y="40" text-anchor="middle" fill="#1c2733" font-weight="700" font-size="13px">${dt.slice(8,10)}</text>`;
    if(dt.slice(8,10)==="01"||i===0) svg += `<text x="${x+4}" y="54" fill="#0ea5a0" font-weight="700" font-size="10.5px">${dt.slice(0,7)}</text>`;
    svg += `<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="#eef1f4"/>`;
  }
  svg += `<line x1="${leftW}" y1="${topH}" x2="${W}" y2="${topH}" stroke="#c8d2db" stroke-width="1.5"/>`;
  svg += `<rect x="0" y="0" width="${leftW}" height="${H}" fill="#fff"/>`;
  svg += `<line x1="${leftW}" y1="0" x2="${leftW}" y2="${H}" stroke="#c8d2db" stroke-width="1.5"/>`;

  rows.forEach((r,ri)=>{
    const y = topH + ri*rowH;
    if(ri%2===1) svg += `<rect x="0" y="${y}" width="${W}" height="${rowH}" fill="#fafbfc"/>`;
    svg += `<text x="14" y="${y+rowH/2-4}" fill="#1c2733" font-weight="700" font-size="14px">${r.site}</text>`;
    svg += `<text x="14" y="${y+rowH/2+14}" fill="#8391a3" font-size="10.5px">${escSvg(r.batchName)} · ${r.count} titik</text>`;
    svg += `<line x1="0" y1="${y+rowH}" x2="${W}" y2="${y+rowH}" stroke="#eef1f4"/>`;

    for(let i=0;i<totalDays;i++){
      const dt = addDays(minDate,i);
      if(isCrewChange(r.site, dt)){
        svg += `<rect x="${leftW+i*dayW}" y="${y+2}" width="${dayW}" height="${rowH-4}" fill="#e0554f" opacity="0.22"/>`;
      }
      if(isBlocked(r.site, dt)){
        svg += `<rect x="${leftW+i*dayW}" y="${y+2}" width="${dayW}" height="${rowH-4}" fill="#7f8fa0" opacity="0.22"/>`;
      }
    }

    const startOff = daysBetweenInclusive(minDate, r.start)-1;
    const workLen = r.workDays;
    const bufLen = r.bufferDays;
    const barColor = r.team==="emisi" ? "#0ea5a0" : "#3d78c9";
    const barY = y+12, barH = rowH-24;
    svg += `<rect x="${leftW+startOff*dayW+2}" y="${barY}" width="${Math.max(0,workLen*dayW-4)}" height="${barH}" rx="6" fill="${barColor}"/>`;
    if(workLen*dayW>46){
      svg += `<text x="${leftW+startOff*dayW+10}" y="${barY+barH/2+4}" fill="#fff" font-weight="700" font-size="11.5px">${workLen}h · ${r.count} titik</text>`;
    }
    if(bufLen>0){
      svg += `<rect x="${leftW+(startOff+workLen)*dayW+2}" y="${barY}" width="${Math.max(0,bufLen*dayW-4)}" height="${barH}" rx="6" fill="${barColor}" opacity="0.3" stroke="${barColor}" stroke-width="1.5" stroke-dasharray="3,3"/>`;
    }
  });
  svg += `</svg>`;
  return svg;
}
function escSvg(s){ return escHtml(s); }

function buildSCurveSVG(batches, points, view){
  let relevant = points.filter(p=>p.planStart && p.planEnd && effectiveWajib(p) && !p.tidakBeroperasi);
  if(view==="emisi") relevant = relevant.filter(p=>p.kategori==="emisi");
  if(view==="ambient") relevant = relevant.filter(p=>p.kategori!=="emisi");
  if(!relevant.length) return "<div class='hint' style='padding:14px;'>Belum ada jadwal untuk kurva-S. Buka <b>Perencanaan Batch</b> → isi tanggal mulai → klik <b>Buat &amp; Terapkan Jadwal</b>, lalu kembali ke sini.</div>";

  const allDates = relevant.flatMap(p=>[p.planStart,p.planEnd]);
  const minDate = allDates.reduce((a,b)=>a<b?a:b);
  const maxDate = allDates.reduce((a,b)=>a>b?a:b);
  const totalDays = daysBetweenInclusive(minDate,maxDate);
  const total = relevant.length;
  const doneNow = relevant.filter(p=>p.status==="done").length;

  const W = Math.max(600, Math.min(1200, totalDays*18)), H=300, padL=44,padB=30,padT=18,padR=14;
  const plotW = W-padL-padR, plotH = H-padT-padB;

  let plannedPts=[], actualPts=[];
  let cum=0;
  for(let i=0;i<totalDays;i++){
    const dt = addDays(minDate,i);
    cum = relevant.filter(p=>p.planEnd<=dt).length;
    plannedPts.push([i,cum]);
  }
  let acum=0;
  for(let i=0;i<totalDays;i++){
    const dt = addDays(minDate,i);
    acum = relevant.filter(p=>p.status==="done" && p.actualEnd && p.actualEnd<=dt).length;
    actualPts.push([i,acum]);
  }
  function toXY(i,v){ return [padL + (i/(totalDays-1||1))*plotW, padT + plotH - (v/total)*plotH]; }
  const pathPlanned = plannedPts.map((pt,i)=>(i===0?"M":"L")+toXY(pt[0],pt[1]).join(",")).join(" ");
  const pathActual = actualPts.map((pt,i)=>(i===0?"M":"L")+toXY(pt[0],pt[1]).join(",")).join(" ");

  let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;font-size:12px;background:#fff;border:1px solid var(--gray-200);border-radius:10px;">`;
  for(let g=0; g<=4; g++){
    const v = total*g/4, y = padT+plotH-(g/4)*plotH;
    svg += `<line x1="${padL}" y1="${y}" x2="${W-padR}" y2="${y}" stroke="#eef1f4"/>`;
    svg += `<text x="2" y="${y+4}" fill="#7f8fa0" font-size="11px">${Math.round(g/4*100)}%</text>`;
  }

  // Garis "Hari ini" — biar langsung kelihatan posisi sekarang relatif ke rencana.
  const today = todayStr();
  let deltaHtml = "";
  if(today>=minDate && today<=maxDate){
    const todayIdx = daysBetweenInclusive(minDate, today)-1;
    const [tx] = toXY(todayIdx, 0);
    svg += `<line x1="${tx}" y1="${padT}" x2="${tx}" y2="${padT+plotH}" stroke="#e0a53d" stroke-width="1.5" stroke-dasharray="3,3"/>`;
    svg += `<text x="${tx+4}" y="${padT+11}" fill="#b5790f" font-size="10.5px" font-weight="700">Hari ini</text>`;
    const plannedAtToday = plannedPts[todayIdx][1], actualAtToday = actualPts[todayIdx][1];
    const delta = actualAtToday - plannedAtToday;
    if(delta>0) deltaHtml = `<span class="badge b-green">${delta} titik lebih cepat dari rencana</span>`;
    else if(delta<0) deltaHtml = `<span class="badge b-red">${Math.abs(delta)} titik lebih lambat dari rencana</span>`;
    else deltaHtml = `<span class="badge b-blue">Tepat sesuai rencana</span>`;
  }

  svg += `<path d="${pathPlanned}" fill="none" stroke="#3d78c9" stroke-width="2.5" stroke-dasharray="6,4"/>`;
  svg += `<path d="${pathActual}" fill="none" stroke="#3fb27f" stroke-width="3"/>`;
  // Titik hover (native tooltip lewat <title>) tiap kelipatan minggu + hari terakhir, biar bisa
  // cek angka pastinya tanpa bikin SVG kebanjiran node kalau rentangnya panjang.
  const markEvery = Math.max(1, Math.round(totalDays/24));
  plannedPts.forEach((pt,i)=>{
    if(i%markEvery!==0 && i!==plannedPts.length-1) return;
    const [x,y] = toXY(pt[0],pt[1]);
    svg += `<circle cx="${x}" cy="${y}" r="3" fill="#3d78c9"><title>${addDays(minDate,i)} — rencana: ${pt[1]}/${total}</title></circle>`;
  });
  actualPts.forEach((pt,i)=>{
    if(i%markEvery!==0 && i!==actualPts.length-1) return;
    const [x,y] = toXY(pt[0],pt[1]);
    svg += `<circle cx="${x}" cy="${y}" r="3.5" fill="#3fb27f"><title>${addDays(minDate,i)} — aktual: ${pt[1]}/${total}</title></circle>`;
  });
  svg += `<text x="${padL}" y="${H-8}" fill="#7f8fa0" font-size="11px">${minDate}</text>`;
  svg += `<text x="${W-padR-70}" y="${H-8}" fill="#7f8fa0" font-size="11px">${maxDate}</text>`;
  svg += `</svg>`;
  svg = `<div class="hint" style="margin-bottom:6px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">${doneNow} dari ${total} titik selesai (${Math.round(doneNow/total*100)}%) ${deltaHtml}</div>` + svg;
  svg += `<div class="legend"><span class="item"><span class="sw" style="background:#3d78c9"></span>Rencana (kumulatif)</span><span class="item"><span class="sw" style="background:#3fb27f"></span>Aktual (kumulatif)</span><span class="item"><span class="sw" style="background:#e0a53d"></span>Hari ini</span></div>`;
  // Panel status di sebelah kanan chart — supaya ruang di samping S-Curve tidak kosong, dan
  // sekalian kasih sudut pandang lain (distribusi status) dari data yang sama.
  const statusCounts = {done:0, scheduled:0, pending:0, failed:0};
  relevant.forEach(p=>{ statusCounts[p.status] = (statusCounts[p.status]||0)+1; });
  const statusPanel = `<div style="min-width:170px;flex-shrink:0;">
    <div class="muted" style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;margin-bottom:8px;">Distribusi Status</div>
    ${distributionBarRow("Done", statusCounts.done, total, "var(--green-500)")}
    ${distributionBarRow("Scheduled", statusCounts.scheduled, total, "var(--teal-500)")}
    ${distributionBarRow("Hold", statusCounts.pending, total, "var(--gray-500)")}
    ${distributionBarRow("Gagal", statusCounts.failed, total, "var(--red-500)")}
  </div>`;
  const combined = `<div style="display:flex;gap:18px;align-items:flex-start;flex-wrap:wrap;">
    <div style="flex:2;min-width:280px;">${svg}</div>
    ${statusPanel}
  </div>`;
  return combined;
}

