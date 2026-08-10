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
  document.getElementById("rhCount").textContent = pts.length+" dari "+allEmisi.length+" sumber emisi ditampilkan. \"RH Manual\" = angka ringkas yang dipakai di Database Titik Pantau & Perencanaan Batch; terisi otomatis dari bulan terakhir riwayat saat import CSV bulanan, tapi tetap bisa dikoreksi manual.";
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
// Modal detail bulanan: grid tahun x bulan untuk satu titik, dengan jendela trailing 12 bulan di-highlight.
function openRhDetail(id){
  const p = DB.points.find(x=>x.id===id); if(!p) return;
  const arr = DB.rhMonthly[p.nama];
  const period = (document.getElementById("rhPeriode")||{}).value || currentPeriodStr();
  const trailingLabels = new Set(trailingWindowLabels(period));
  const years = [...new Set((DB.rhMonths||[]).map(lab=>2000+Number(lab.split("-")[1])))].sort((a,b)=>a-b);
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
      return `<td style="text-align:right;padding:5px 7px;${hl?"background:#d9f7f3;font-weight:700;":""}">${v==null?"<span class='muted'>-</span>":v}</td>`;
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
    <div class="hint" style="margin-top:8px;">Sel teal = 12 bulan yang dihitung untuk jendela wajib-pantau periode ${escHtml(period)}. Ganti periode di filter halaman lalu buka lagi detail ini untuk lihat jendela lain.</div>
    <div class="actions"><button class="btn ghost" data-action="closeModal">Tutup</button></div>`, {wide:true});
}
function exportRhCsv(){
  const rows = DB.points.filter(p=>p.kategori==="emisi" && p.kategoriSumber!==KATEGORI_SUMBER_FUEL_QUALITY).map(p=>({id:p.id, site:p.site, nama:p.nama, runningHour:p.runningHour??"", pemantauanTerakhir:p.pemantauanTerakhir||"", prediksiBerikutnya:p.prediksiBerikutnya||""}));
  csvExport(["id","site","nama","runningHour","pemantauanTerakhir","prediksiBerikutnya"], rows, `running_hour_${todayStr()}.csv`);
}
function importRhCsv(){
  openModal(`<h3>Import RH Terkini (ringkas)</h3>
    <p class="hint">Kolom wajib: <b>id</b> (harus cocok dengan titik yang sudah ada — pakai Export dulu buat dapetin id-nya), lalu <b>runningHour</b>, <b>pemantauanTerakhir</b>, <b>prediksiBerikutnya</b> (opsional). Pemisah kolom pakai titik-koma (;), sama seperti hasil Export. Untuk update riwayat bulanan lengkap (dipakai cek ambang Emergency Engine), pakai tombol <b>Import Riwayat Bulanan (CSV)</b> di toolbar.</p>
    <input type="file" id="rhImportFile" accept=".csv">
    <div class="actions"><button class="btn ghost" data-action="closeModal">Batal</button><button class="btn primary" data-action="doImportRhCsv">Import</button></div>`);
}
function doImportRhCsv(){
  const file = document.getElementById("rhImportFile").files[0];
  if(!file){ toast("Pilih file CSV dulu.","err"); return; }
  const reader = new FileReader();
  reader.onload = ()=>{
    try{
      const rows = csvParse(reader.result);
      snapshotBefore(`Sebelum import Running Hour CSV "${file.name}"`);
      let updated=0, skipped=0;
      rows.forEach(r=>{
        const p = DB.points.find(x=>x.id===r.id);
        if(!p){ skipped++; return; }
        if(r.runningHour!==undefined && r.runningHour!=="") p.runningHour = Number(r.runningHour);
        if(r.pemantauanTerakhir!==undefined) p.pemantauanTerakhir = r.pemantauanTerakhir;
        if(r.prediksiBerikutnya!==undefined) p.prediksiBerikutnya = r.prediksiBerikutnya;
        updated++;
      });
      logChange(`Import Running Hour dari "${file.name}" — ${updated} titik diperbarui${skipped?`, ${skipped} id tidak ditemukan`:""}`);
      touchDataset("rh"); save(); closeModal(); renderRunningHour(); renderMaster();
      toast(`${updated} titik diperbarui.`+(skipped?` ${skipped} baris dilewati (id tidak ditemukan).`:""), skipped?"err":"ok");
    }catch(err){ toast("Gagal import: "+err.message,"err"); }
  };
  reader.readAsText(file);
}
// Export riwayat bulanan lengkap — format sama seperti CSV RH bulanan aslinya (baris=nama titik, kolom=bulan).
function exportRhMonthlyCsv(){
  const headers = ["NAMA ENGINE", ...DB.rhMonths];
  const rows = Object.keys(DB.rhMonthly).sort().map(nama=>{
    const row = {"NAMA ENGINE": nama};
    DB.rhMonths.forEach((lab,i)=>{ row[lab] = DB.rhMonthly[nama][i]==null ? "" : DB.rhMonthly[nama][i]; });
    return row;
  });
  csvExport(headers, rows, `running_hour_bulanan_${todayStr()}.csv`);
}
function importRhMonthlyCsv(){
  openModal(`<h3>Import Riwayat Bulanan Running Hour</h3>
    <p class="hint">Format lebar: kolom pertama <b>nama titik/engine</b> (harus persis sama dengan Nama Titik di Database Titik Pantau — dipakai untuk mencocokkan), kolom-kolom berikutnya adalah bulan (mis. <b>Jan-21</b>, <b>Feb-21</b>, dst). Pemisah kolom pakai titik-koma (;). Bulan yang belum ada akan otomatis ditambahkan ke riwayat; bulan yang sudah ada akan ditimpa dengan nilai baru. "RH Manual" tiap titik ikut ter-update otomatis ke nilai bulan terakhir yang terisi.</p>
    <input type="file" id="rhMonthlyImportFile" accept=".csv">
    <div class="actions"><button class="btn ghost" data-action="closeModal">Batal</button><button class="btn primary" data-action="doImportRhMonthlyCsv">Import</button></div>`);
}
function doImportRhMonthlyCsv(){
  const file = document.getElementById("rhMonthlyImportFile").files[0];
  if(!file){ toast("Pilih file CSV dulu.","err"); return; }
  const reader = new FileReader();
  reader.onload = ()=>{
    try{
      let text = reader.result;
      if(text.charCodeAt(0)===0xFEFF) text = text.slice(1); // strip BOM
      const lines = text.split(/\r?\n/).filter(l=>l.length);
      if(!lines.length){ toast("File kosong.","err"); return; }
      const header = lines[0].split(CSV_DELIM).map(h=>h.trim());
      const monthCols = header.slice(1);
      if(!monthCols.length){ toast("Tidak ada kolom bulan terdeteksi di header.","err"); return; }
      snapshotBefore(`Sebelum import Riwayat Bulanan CSV "${file.name}"`);
      // tambahkan bulan baru (yang belum ada) ke akhir DB.rhMonths, sambil pad array lama dengan null
      monthCols.forEach(lab=>{
        if(lab && DB.rhMonths.indexOf(lab)<0){
          DB.rhMonths.push(lab);
          Object.keys(DB.rhMonthly).forEach(nm=>{ DB.rhMonthly[nm].push(null); });
        }
      });
      let rowsUpdated=0, monthsWritten=0;
      for(let i=1;i<lines.length;i++){
        const cols = lines[i].split(CSV_DELIM);
        const nama = (cols[0]||"").trim();
        if(!nama) continue;
        if(!DB.rhMonthly[nama]) DB.rhMonthly[nama] = new Array(DB.rhMonths.length).fill(null);
        monthCols.forEach((lab,ci)=>{
          if(!lab) return;
          const idx = DB.rhMonths.indexOf(lab); if(idx<0) return;
          const raw = (cols[ci+1]||"").trim();
          if(raw==="") return;
          if(raw.toUpperCase()==="NA"){ DB.rhMonthly[nama][idx] = null; return; }
          const num = Number(raw.replace(",","."));
          if(!isNaN(num)){ DB.rhMonthly[nama][idx] = Math.round(num*1000)/1000; monthsWritten++; }
        });
        rowsUpdated++;
        // sinkron RH Manual (p.runningHour) ke nilai bulan terakhir yang terisi
        const point = DB.points.find(x=>x.kategori==="emisi" && x.nama===nama);
        if(point){ const latest = rhLatestKnown(nama); if(latest) point.runningHour = latest.value; }
      }
      logChange(`Import Riwayat Bulanan RH dari "${file.name}" — ${rowsUpdated} titik, ${monthsWritten} sel bulan diperbarui`);
      touchDataset("rhMonthly"); save(); closeModal(); renderRunningHour(); renderMaster();
      toast(`${rowsUpdated} titik diperbarui (${monthsWritten} sel bulan).`,"ok");
    }catch(err){ toast("Gagal import: "+err.message,"err"); console.error(err); }
  };
  reader.readAsText(file);
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
      const notePlaceholder = status==="deferred" ? "mis. Batch 2" : status==="other" ? "mis. Under Maintenance" : "";
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
    if(e.target.value==="sampled"){
      t.actual = true;
      if(!t.dates.actual) t.dates.actual = todayStr();
      const p = DB.points.find(x=>x.id===id);
      if(p){ p.actualStart = p.actualStart||t.dates.actual; p.actualEnd = t.dates.actual; }
    } else {
      t.actual = false;
    }
    save(); renderTracking();
  }
  if(e.target.dataset.action==="setSamplingDate"){
    const id=e.target.dataset.id;
    const t = ensureTracking(id);
    t.dates.actual = e.target.value;
    const p = DB.points.find(x=>x.id===id);
    if(p && e.target.value){ p.actualStart = p.actualStart||e.target.value; p.actualEnd = e.target.value; }
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
const TRACKING_CSV_HEADERS = ["id","nama","site","samplingStatus","samplingDate","samplingNote","ba","baDate","draftSent","draftSentDate","reviewed","reviewedDate","approved","approvedDate","finalReceived","finalReceivedDate","simpelInput","simpelInputDate"];
function exportTrackingCsv(){
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
  csvExport(TRACKING_CSV_HEADERS, rows, `tracking_ba_coa_${todayStr()}.csv`);
}
function importTrackingCsv(){
  const inp = document.getElementById("hiddenCsvFile");
  inp.onchange = ()=>{
    const file = inp.files[0]; if(!file) return;
    const reader = new FileReader();
    reader.onload = ()=>{
      try{
        const rows = csvParse(reader.result);
        let updated=0, skipped=0;
        rows.forEach(r=>{
          const p = DB.points.find(x=>x.id===r.id);
          if(!p){ skipped++; return; }
          const t = ensureTracking(p.id);
          if(r.samplingStatus!==undefined) t.samplingStatus = r.samplingStatus;
          if(r.samplingDate!==undefined) t.dates.actual = r.samplingDate;
          if(r.samplingNote!==undefined) t.samplingNote = r.samplingNote;
          ["ba","draftSent","reviewed","approved","finalReceived","simpelInput"].forEach(key=>{
            if(r[key]!==undefined) t[key] = /^1|true|ya$/i.test(r[key]);
            if(r[key+"Date"]!==undefined) t.dates[key] = r[key+"Date"];
          });
          updated++;
        });
        touchDataset("tracking"); save();
        toast(`Import Tracking selesai: ${updated} titik diperbarui${skipped?`, ${skipped} id tidak ditemukan`:""}.`, skipped?"err":"ok");
        renderTracking();
      }catch(err){ toast("Gagal import: "+err.message,"err"); console.error(err); }
    };
    reader.readAsText(file);
    inp.value = "";
  };
  inp.click();
}

