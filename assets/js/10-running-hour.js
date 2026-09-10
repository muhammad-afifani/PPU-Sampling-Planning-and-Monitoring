/* =========================================================
   RUNNING HOUR DETAIL
========================================================= */
function renderRunningHour(){
  const siteSel = document.getElementById("rhFltSite");
  if(!siteSel.dataset.filled){
    siteSel.innerHTML = `<option value="">Semua</option>` + allSites().map(s=>`<option value="${escHtml(s)}">${s}</option>`).join("");
    siteSel.dataset.filled = "1";
  }
  const periodeSel = document.getElementById("rhPeriode");
  if(!periodeSel.dataset.filled){
    periodeSel.innerHTML = listPeriodOptions(6,4).map(lab=>`<option value="${escHtml(lab)}" ${lab===currentPeriodStr()?"selected":""}>${lab}${lab===currentPeriodStr()?" (aktif)":""}</option>`).join("");
    periodeSel.dataset.filled = "1";
  }
  const site = siteSel.value;
  const search = document.getElementById("rhFltSearch").value.trim().toLowerCase();
  const emgOnly = document.getElementById("rhFltEmergency").checked;
  const period = periodeSel.value || currentPeriodStr();

  const allEmisi = DB.points.filter(p=>p.kategori==="emisi" && p.kategoriSumber!==KATEGORI_SUMBER_FUEL_QUALITY);
  let pts = allEmisi.slice();
  if(site) pts = pts.filter(p=>p.site===site);
  if(search) pts = pts.filter(p=>p.nama.toLowerCase().includes(search));
  if(emgOnly) pts = pts.filter(isEmergencyEngine);
  pts.sort((a,c)=> a.site===c.site ? a.nama.localeCompare(c.nama) : a.site.localeCompare(c.site));

  // stat cards
  const emgList = allEmisi.filter(isEmergencyEngine);
  const emgTriggered = emgList.filter(p=>wajibReason(p, period).type==="emergency-triggered");
  const noHist = allEmisi.filter(p=>!DB.rhMonthly[p.nama]).length;
  document.getElementById("rhStats").innerHTML = `
    <div class="stat"><div class="num">${allEmisi.length}</div><div class="lbl">Total Sumber Emisi</div></div>
    <div class="stat"><div class="num">${emgList.length}</div><div class="lbl">Emergency Engine</div></div>
    <div class="stat ${emgTriggered.length?"bad":"good"}"><div class="num">${emgTriggered.length}</div><div class="lbl">Emergency Wajib Pantau &middot; ${escHtml(period)}</div></div>
    <div class="stat ${noHist?"warn":""}"><div class="num">${noHist}</div><div class="lbl">Belum Ada Riwayat Bulanan</div></div>
  `;

  const semesters = allSemestersInData().slice(-6);

  document.getElementById("rhTable").innerHTML = `
    <thead><tr>
      <th>Site</th><th>Nama Titik</th><th>Kategori Sumber</th>
      <th style="width:95px;">RH Manual</th><th>RH Bulan Terakhir</th>
      ${semesters.map(s=>`<th style="text-align:right;">${s.label}</th>`).join("")}
      <th style="text-align:right;background:var(--navy-700);">Trailing 12 Bln<div style="font-weight:400;font-size:9px;opacity:.8;">s.d. sblm ${escHtml(period)}</div></th>
      <th style="width:170px;">Status Wajib &middot; ${escHtml(period)}</th>
      <th>Pemantauan Terakhir</th><th>Prediksi Berikutnya</th><th></th>
    </tr></thead>
    <tbody>${pts.map(p=>{
      const emg = isEmergencyEngine(p);
      const trailing = trailingRhSum(p.nama, period);
      const latest = rhLatestKnown(p.nama);
      return `<tr>
        <td>${p.site}</td>
        <td><b>${escHtml(p.nama)}</b></td>
        <td class="muted" style="font-size:11px;">${escHtml(p.kategoriSumber||"-")}${emg?' <span class="badge b-red" style="margin-left:3px;">Emergency</span>':""}</td>
        <td><input type="number" step="0.1" min="0" style="width:80px;" value="${p.runningHour??""}" data-action="editRh" data-id="${p.id}" data-field="runningHour"></td>
        <td class="muted" style="font-size:11.5px;">${latest?`${latest.value} <span style="font-size:10px;">(${latest.label})</span>`:"-"}</td>
        ${semesters.map(s=>{
          const v = semesterRhSum(p.nama, s.sem, s.year);
          return `<td class="muted" style="text-align:right;">${v==null?"-":v}</td>`;
        }).join("")}
        <td style="text-align:right;font-weight:700;background:#f3fbfa;">${trailing==null?"<span class='muted'>-</span>":trailing}</td>
        <td>${wajibBadgeHtml(p, period)}</td>
        <td><input type="text" style="width:120px;" value="${escHtml(p.pemantauanTerakhir||"")}" placeholder="mis. S1 2026" data-action="editRh" data-id="${p.id}" data-field="pemantauanTerakhir"></td>
        <td><input type="text" style="width:120px;" value="${escHtml(p.prediksiBerikutnya||"")}" placeholder="mis. S2 2026" data-action="editRh" data-id="${p.id}" data-field="prediksiBerikutnya"></td>
        <td><button class="btn small" data-action="openRhDetail" data-id="${p.id}">Detail Bulanan</button></td>
      </tr>`;
    }).join("")}</tbody>`;
  document.getElementById("rhCount").textContent = pts.length+" dari "+allEmisi.length+" sumber emisi ditampilkan. \"RH Manual\" = angka ringkas yang dipakai di Database Titik Pantau & Perencanaan Batch; terisi otomatis dari bulan terakhir riwayat saat import Excel bulanan atau edit langsung di \"Detail Bulanan\", tapi tetap bisa dikoreksi manual di kolom ini juga.";
}
document.getElementById("rhFltSite").addEventListener("change", renderRunningHour);
document.getElementById("rhFltSearch").addEventListener("input", renderRunningHour);
document.getElementById("rhPeriode").addEventListener("change", renderRunningHour);
document.getElementById("rhFltEmergency").addEventListener("change", renderRunningHour);
document.addEventListener("change", e=>{
  if(e.target.dataset.action==="editRh"){
    const p = DB.points.find(x=>x.id===e.target.dataset.id); if(!p) return;
    const field = e.target.dataset.field;
    p[field] = field==="runningHour" ? (e.target.value===""?null:Number(e.target.value)) : e.target.value;
    save();
    if(field==="runningHour") renderRunningHour();
  }
});
// Modal detail bulanan: grid tahun x bulan utk satu titik, BISA diedit langsung per sel (tidak
// harus import file) — jendela trailing 12 bulan (dipakai cek ambang Emergency Engine) di-highlight.
let rhDetailOpenId = null;
function openRhDetail(id){
  rhDetailOpenId = id;
  const p = DB.points.find(x=>x.id===id); if(!p) return;
  const arr = DB.rhMonthly[p.nama];
  const period = (document.getElementById("rhPeriode")||{}).value || currentPeriodStr();
  const trailingLabels = new Set(trailingWindowLabels(period));
  const now = new Date();
  const years = [...new Set([...(DB.rhMonths||[]).map(lab=>2000+Number(lab.split("-")[1])), now.getFullYear(), now.getFullYear()+1])].sort((a,b)=>a-b);
  let note = "";
  if(isEmergencyEngine(p)){
    const r = wajibReason(p, period);
    note = `<div class="section-note" style="${r.type==="emergency-triggered"?"border-color:#e0554f;background:#fdeceb;color:#a02a24;":""}">
      <b>Emergency Engine</b> — total RH 12 bulan terakhir (sel teal di bawah, jendela periode <b>${escHtml(period)}</b>): <b>${r.rh!=null?r.rh:"tidak ada data"} jam</b>.
      ${r.type==="emergency-triggered" ? "Di atas ambang 200 jam/tahun &rarr; <b>WAJIB dipantau</b> periode ini." : "Di bawah/sama dengan ambang 200 jam/tahun &rarr; tidak wajib dipantau periode ini."}
    </div>`;
  }
  const rows = years.map(y=>{
    const cells = MONTH_SHORT_EN.map((m,i)=>{
      const lab = monthLabel(y,i);
      const idx = (DB.rhMonths||[]).indexOf(lab);
      const v = (idx>=0 && arr) ? arr[idx] : null;
      const hl = trailingLabels.has(lab);
      return `<td style="padding:2px;${hl?"background:#d9f7f3;":""}"><input type="number" step="0.1" min="0" value="${v==null?"":v}" placeholder="-"
        style="width:64px;text-align:right;border:1px solid transparent;background:transparent;font-weight:${hl?"700":"400"};"
        data-action="editRhMonthly" data-nama="${escHtml(p.nama)}" data-year="${y}" data-month="${i}"></td>`;
    }).join("");
    const s1 = semesterRhSum(p.nama,1,y), s2 = semesterRhSum(p.nama,2,y);
    return `<tr><td style="padding:5px 7px;"><b>${y}</b></td>${cells}<td style="text-align:right;padding:5px 7px;font-weight:700;">${s1==null?"-":s1}</td><td style="text-align:right;padding:5px 7px;font-weight:700;">${s2==null?"-":s2}</td></tr>`;
  }).join("");
  openModal(`<h3>Riwayat Running Hour Bulanan</h3>
    <div class="hint" style="margin-bottom:10px;"><b>${escHtml(p.nama)}</b> &middot; ${escHtml(p.site)} &middot; ${escHtml(p.kategoriSumber||"-")}</div>
    ${note}
    <div class="tablewrap" style="max-height:420px;">
      <table><thead><tr><th>Tahun</th>${MONTH_SHORT_EN.map(m=>`<th style="text-align:right;">${m}</th>`).join("")}<th style="text-align:right;">Tot. S1</th><th style="text-align:right;">Tot. S2</th></tr></thead>
      <tbody>${rows}</tbody></table>
    </div>
    <div class="hint" style="margin-top:8px;">Sel teal = 12 bulan yang dihitung untuk jendela wajib-pantau periode ${escHtml(period)}. Ganti periode di filter halaman lalu buka lagi detail ini untuk lihat jendela lain. Klik langsung ke tiap sel untuk mengisi/mengubah angkanya — tersimpan otomatis saat pindah sel (tidak perlu tombol Simpan terpisah), kosongkan sel untuk menghapus nilai bulan itu.</div>
    <div class="actions"><button class="btn ghost" data-action="closeModal">Tutup</button></div>`, {wide:true});
}
document.addEventListener("change", e=>{
  if(e.target.dataset.action!=="editRhMonthly") return;
  const nama = e.target.dataset.nama, year = Number(e.target.dataset.year), month = Number(e.target.dataset.month);
  const lab = monthLabel(year, month);
  if(DB.rhMonths.indexOf(lab)<0){
    DB.rhMonths.push(lab);
    Object.keys(DB.rhMonthly).forEach(nm=>{ DB.rhMonthly[nm].push(null); });
  }
  const idx = DB.rhMonths.indexOf(lab);
  if(!DB.rhMonthly[nama]) DB.rhMonthly[nama] = new Array(DB.rhMonths.length).fill(null);
  while(DB.rhMonthly[nama].length < DB.rhMonths.length) DB.rhMonthly[nama].push(null);
  const raw = e.target.value.trim();
  DB.rhMonthly[nama][idx] = raw==="" ? null : Math.round(Number(raw)*1000)/1000;
  const point = DB.points.find(x=>x.kategori==="emisi" && x.nama===nama);
  if(point){ const latest = rhLatestKnown(nama); point.runningHour = latest ? latest.value : null; }
  touchDataset("rhMonthly"); save();
  if(rhDetailOpenId) openRhDetail(rhDetailOpenId);
  renderRunningHour(); renderMaster();
});
function exportRhXlsx(){
  const headers = ["id","site","nama","runningHour","pemantauanTerakhir","prediksiBerikutnya"];
  const rows = DB.points.filter(p=>p.kategori==="emisi" && p.kategoriSumber!==KATEGORI_SUMBER_FUEL_QUALITY).map(p=>({id:p.id, site:p.site, nama:p.nama, runningHour:p.runningHour??"", pemantauanTerakhir:p.pemantauanTerakhir||"", prediksiBerikutnya:p.prediksiBerikutnya||""}));
  const wb = xlsxWorkbookFromSheets([["RH Terkini", xlsxSheetFromRows(headers, rows)]]);
  xlsxDownload(wb, `running_hour_${todayStr()}.xlsx`);
}
function importRhXlsx(){
  xlsxImport(wb=>{
    const ws = wb.Sheets["RH Terkini"] || wb.Sheets[wb.SheetNames[0]];
    const rows = xlsxSheetToRows(ws);
    snapshotBefore(`Sebelum import RH Terkini Excel`);
    let updated=0, skipped=0;
    rows.forEach(r=>{
      const p = DB.points.find(x=>x.id===r.id);
      if(!p){ skipped++; return; }
      if(r.runningHour!==undefined && r.runningHour!=="") p.runningHour = Number(r.runningHour);
      if(r.pemantauanTerakhir!==undefined) p.pemantauanTerakhir = r.pemantauanTerakhir;
      if(r.prediksiBerikutnya!==undefined) p.prediksiBerikutnya = r.prediksiBerikutnya;
      updated++;
    });
    logChange(`Import RH Terkini Excel — ${updated} titik diperbarui${skipped?`, ${skipped} id tidak ditemukan`:""}`);
    touchDataset("rh"); save(); renderRunningHour(); renderMaster();
    toast(`${updated} titik diperbarui.`+(skipped?` ${skipped} baris dilewati (id tidak ditemukan).`:""), skipped?"err":"ok");
  });
}
function downloadTemplateRhXlsx(){
  const wb = xlsxWorkbookFromSheets([["RH Terkini", xlsxSheetFromRows(["id","site","nama","runningHour","pemantauanTerakhir","prediksiBerikutnya"], [])]]);
  xlsxDownload(wb, "template_running_hour.xlsx");
}
// Export riwayat bulanan lengkap — format lebar sama seperti sebelumnya (baris=nama titik, kolom=bulan).
function exportRhMonthlyXlsx(){
  const headers = ["NAMA ENGINE", ...DB.rhMonths];
  const rows = Object.keys(DB.rhMonthly).sort().map(nama=>{
    const row = {"NAMA ENGINE": nama};
    DB.rhMonths.forEach((lab,i)=>{ row[lab] = DB.rhMonthly[nama][i]==null ? "" : DB.rhMonthly[nama][i]; });
    return row;
  });
  const wb = xlsxWorkbookFromSheets([["Riwayat Bulanan", xlsxSheetFromRows(headers, rows)]]);
  xlsxDownload(wb, `running_hour_bulanan_${todayStr()}.xlsx`);
}
function downloadTemplateRhMonthlyXlsx(){
  const headers = ["NAMA ENGINE", ...MONTH_SHORT_EN.map((m,i)=>monthLabel(new Date().getFullYear(),i))];
  const wb = xlsxWorkbookFromSheets([["Riwayat Bulanan", xlsxSheetFromRows(headers, [])]]);
  xlsxDownload(wb, "template_running_hour_bulanan.xlsx");
}
// Dibaca sbg array-of-array (bukan array-of-object) supaya kolom bulan yg jumlah & namanya dinamis
// (beda-beda tiap file, tergantung rentang tanggal yg diexport) tetap terbaca apa adanya berurutan,
// termasuk kalau ada 2 kolom "nama bulan" yg mirip tapi beda kapitalisasi/spasi — dicocokkan via
// rhNormalizeMonthLabels() supaya tidak numpuk jadi kolom duplikat (lihat catatan di fungsi itu).
function importRhMonthlyXlsx(){
  xlsxImport(wb=>{
    const ws = wb.Sheets["Riwayat Bulanan"] || wb.Sheets[wb.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json(ws, {header:1, defval:"", raw:true});
    if(!aoa.length){ toast("File kosong.","err"); return; }
    const header = aoa[0].map(h=>String(h==null?"":h).trim());
    const monthCols = header.slice(1);
    if(!monthCols.length){ toast("Tidak ada kolom bulan terdeteksi di header.","err"); return; }
    snapshotBefore(`Sebelum import Riwayat Bulanan Excel`);
    monthCols.forEach(lab=>{
      if(lab && DB.rhMonths.indexOf(lab)<0){
        DB.rhMonths.push(lab);
        Object.keys(DB.rhMonthly).forEach(nm=>{ DB.rhMonthly[nm].push(null); });
      }
    });
    let rowsUpdated=0, monthsWritten=0;
    for(let i=1;i<aoa.length;i++){
      const cols = aoa[i];
      const nama = String(cols[0]==null?"":cols[0]).trim();
      if(!nama) continue;
      if(!DB.rhMonthly[nama]) DB.rhMonthly[nama] = new Array(DB.rhMonths.length).fill(null);
      monthCols.forEach((lab,ci)=>{
        if(!lab) return;
        const idx = DB.rhMonths.indexOf(lab); if(idx<0) return;
        const raw = cols[ci+1];
        if(raw===""||raw==null) return;
        if(String(raw).toUpperCase()==="NA"){ DB.rhMonthly[nama][idx] = null; return; }
        const num = Number(String(raw).replace(",","."));
        if(!isNaN(num)){ DB.rhMonthly[nama][idx] = Math.round(num*1000)/1000; monthsWritten++; }
      });
      rowsUpdated++;
      const point = DB.points.find(x=>x.kategori==="emisi" && x.nama===nama);
      if(point){ const latest = rhLatestKnown(nama); if(latest) point.runningHour = latest.value; }
    }
    rhNormalizeMonthLabels();
    logChange(`Import Riwayat Bulanan RH Excel — ${rowsUpdated} titik, ${monthsWritten} sel bulan diperbarui`);
    touchDataset("rhMonthly"); save(); renderRunningHour(); renderMaster();
    toast(`${rowsUpdated} titik diperbarui (${monthsWritten} sel bulan).`,"ok");
  });
}
function renderTracking(){
  refreshTrackingBatchSelect();
  refreshTrackingSiteSelect();
  const {pts, beforeStatus} = getFilteredTrackingPoints();
  renderKomSiteTable(beforeStatus);
  renderSamplingEmisiTable(beforeStatus);

  const docPts = pts.filter(p=>ensureTracking(p.id).samplingStatus==="sampled");
  document.getElementById("trackingTable").innerHTML = `
    <thead><tr><th>Site</th><th>Titik</th>${TRACK_STEPS.map(([key,label])=>`<th>${label}<br><button class="btn small ghost" data-action="bulkTrackColumn" data-key="${key}" style="margin-top:3px;padding:2px 6px;font-size:10px;">Centang Semua</button></th>`).join("")}<th>Status</th></tr></thead>
    <tbody>${docPts.map(p=>{
      const t = ensureTracking(p.id);
      const overall = trackingOverallStatus(t,p);
      const badge = overall==="done"?"b-green":overall==="overdue"?"b-red":"b-blue";
      const label = overall==="done"?"Selesai":overall==="overdue"?"Overdue":"On Track";
      return `<tr><td>${p.site}</td><td>${escHtml(p.nama)}</td>
        ${TRACK_STEPS.map(([key])=>`<td class="trk-cell${t[key]?" done":""}" style="text-align:center;"><input type="checkbox" data-action="toggleTrack" data-id="${p.id}" data-key="${key}" ${t[key]?"checked":""}></td>`).join("")}
        <td><span class="badge ${badge}">${label}</span></td>
      </tr>`;
    }).join("")}</tbody>`;
}
// Tahap 1: eksekusi sampling di lapangan per titik — status, tanggal aktual (kalau sudah
// disampling), dan catatan (kalau ditunda ke batch berikutnya atau sebab lain seperti maintenance).
// Dipakai juga sebagai sumber data status pemantauan pada Berita Acara.
function renderSamplingEmisiTable(pts){
  const el = document.getElementById("samplingEmisiTable");
  if(!el) return;
  el.innerHTML = `
    <thead><tr><th>Site</th><th>Titik</th><th>Kategori Sumber</th><th>Wajib Pantau</th><th style="width:190px;">Status Sampling</th><th style="width:150px;">Tanggal Sampling</th><th>Catatan</th><th style="width:60px;">Aksi</th></tr></thead>
    <tbody>${pts.map(p=>{
      const t = ensureTracking(p.id);
      const status = t.samplingStatus||"";
      const isFilled = status || t.dates.actual || t.samplingNote;
      const notePlaceholder = status==="deferred" ? "mis. Batch 2" : status==="other" ? "mis. Under Maintenance" : status==="notdue" ? "kosongkan = teks otomatis periode lalu" : "";
      return `<tr>
        <td>${p.site}</td>
        <td><b>${escHtml(p.nama)}</b></td>
        <td class="muted" style="font-size:11px;">${escHtml(p.kategoriSumber||"-")}</td>
        <td>${wajibBadgeHtml(p)}</td>
        <td><select data-action="setSamplingStatus" data-id="${p.id}">
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
document.addEventListener("change", e=>{
  if(e.target.dataset.action==="toggleTrack"){
    const id=e.target.dataset.id, key=e.target.dataset.key;
    const t = DB.tracking[id];
    t[key] = e.target.checked;
    t.dates[key] = e.target.checked? todayStr() : "";
    if(key==="simpelInput" && e.target.checked){ const p=DB.points.find(x=>x.id===id); if(p) p.status="done"; }
    save(); renderTracking();
  }
  if(e.target.dataset.action==="setSamplingStatus"){
    const id=e.target.dataset.id;
    const t = ensureTracking(id);
    t.samplingStatus = e.target.value;
    const p = DB.points.find(x=>x.id===id);
    if(e.target.value==="sampled"){
      t.actual = true;
      if(!t.dates.actual) t.dates.actual = todayStr();
      if(p){ p.actualStart = p.actualStart||t.dates.actual; p.actualEnd = t.dates.actual; p.status = "done"; }
    } else {
      // Status Sampling ini SATU-SATUNYA tempat p.status (dipakai S-Curve/Dashboard) disinkron
      // dari hasil eksekusi lapangan — sebelumnya cuma DB.tracking[id] yang keupdate, p.status
      // dibiarkan macet di "scheduled" walau sudah ditandai selesai/gagal di sini, jadi S-Curve
      // tidak pernah menghitungnya. "Direncanakan Batch Berikutnya" = masih di-plan, cuma
      // ditunda (Hold) — SAMA seperti titik yang di-exclude manual dgn alasan batch2 (lihat
      // applyScheduleToPoints). "Tidak Disampling, Sebab Lain" = genuinely gagal periode ini.
      // "Belum Masuk Periode Sampling" = SAMA seperti deferred (Hold, bukan gagal) — titik ini
      // memang tidak seharusnya diproses periode ini (biasanya sudah dieliminasi dari batch juga).
      t.actual = false;
      if(p){
        p.actualStart = ""; p.actualEnd = "";
        p.status = (e.target.value==="deferred" || e.target.value==="notdue") ? "pending" : e.target.value==="other" ? "failed" : "scheduled";
      }
    }
    save(); renderTracking();
  }
  if(e.target.dataset.action==="setSamplingDate"){
    const id=e.target.dataset.id;
    const t = ensureTracking(id);
    t.dates.actual = e.target.value;
    const p = DB.points.find(x=>x.id===id);
    if(p && e.target.value){ p.actualStart = p.actualStart||e.target.value; p.actualEnd = e.target.value; p.status = "done"; }
    save(); renderTracking();
  }
  if(e.target.dataset.action==="setSamplingNote"){
    const id=e.target.dataset.id;
    ensureTracking(id).samplingNote = e.target.value;
    save();
  }
});
// Export/Import Tracking BA/CoA (Tahap 1 sampling + Tahap 2 dokumen) sebagai CSV — dicocokkan
// lewat kolom id (harus sama dengan id di Database Titik Pantau), mengikuti pola Export/Import
// dataset lain di tools ini (Titik Pantau, Personil, dst).
const TRACKING_XLSX_HEADERS = ["id","nama","site","samplingStatus","samplingDate","samplingNote","ba","baDate","draftSent","draftSentDate","reviewed","reviewedDate","approved","approvedDate","finalReceived","finalReceivedDate","simpelInput","simpelInputDate"];
function exportTrackingXlsx(){
  const rows = DB.points.filter(p=>DB.tracking[p.id]).map(p=>{
    const t = ensureTracking(p.id);
    return {
      id: p.id, nama: p.nama, site: p.site,
      samplingStatus: t.samplingStatus||"", samplingDate: t.dates.actual||"", samplingNote: t.samplingNote||"",
      ba: t.ba?1:0, baDate: t.dates.ba||"",
      draftSent: t.draftSent?1:0, draftSentDate: t.dates.draftSent||"",
      reviewed: t.reviewed?1:0, reviewedDate: t.dates.reviewed||"",
      approved: t.approved?1:0, approvedDate: t.dates.approved||"",
      finalReceived: t.finalReceived?1:0, finalReceivedDate: t.dates.finalReceived||"",
      simpelInput: t.simpelInput?1:0, simpelInputDate: t.dates.simpelInput||""
    };
  });
  const wb = xlsxWorkbookFromSheets([["Tracking", xlsxSheetFromRows(TRACKING_XLSX_HEADERS, rows)]]);
  xlsxDownload(wb, `tracking_ba_coa_${todayStr()}.xlsx`);
}
function importTrackingXlsx(){
  xlsxImport(wb=>{
    const ws = wb.Sheets["Tracking"] || wb.Sheets[wb.SheetNames[0]];
    const rows = xlsxSheetToRows(ws);
    let updated=0, skipped=0;
    rows.forEach(r=>{
      const p = DB.points.find(x=>x.id===r.id);
      if(!p){ skipped++; return; }
      const t = ensureTracking(p.id);
      if(r.samplingStatus!==undefined) t.samplingStatus = r.samplingStatus;
      if(r.samplingDate!==undefined) t.dates.actual = r.samplingDate;
      if(r.samplingNote!==undefined) t.samplingNote = r.samplingNote;
      ["ba","draftSent","reviewed","approved","finalReceived","simpelInput"].forEach(key=>{
        if(r[key]!==undefined) t[key] = /^1|true|ya$/i.test(String(r[key]));
        if(r[key+"Date"]!==undefined) t.dates[key] = r[key+"Date"];
      });
      updated++;
    });
    touchDataset("tracking"); save();
    toast(`Import Tracking selesai: ${updated} titik diperbarui${skipped?`, ${skipped} id tidak ditemukan`:""}.`, skipped?"err":"ok");
    renderTracking();
  });
}
function downloadTemplateTrackingXlsx(){
  const wb = xlsxWorkbookFromSheets([["Tracking", xlsxSheetFromRows(TRACKING_XLSX_HEADERS, [])]]);
  xlsxDownload(wb, "template_tracking_ba_coa.xlsx");
}

