/* =========================================================
   GLOBAL ACTION DISPATCH
========================================================= */
const ACTIONS = {
  addPoint, editPoint:(t)=>editPoint(t.dataset.id), deletePoint:(t)=>deletePoint(t.dataset.id), savePoint:(t)=>savePoint(t.dataset.id),
  verifyAllVisible,
  goToPage:(t)=>showPage(t.dataset.page),
  importPointsCsv, exportPointsCsv,
  addPersonil, editPersonil:(t)=>editPersonil(t.dataset.id), deletePersonil:(t)=>deletePersonil(t.dataset.id), savePersonil:(t)=>savePersonil(t.dataset.id),
  importPersonilCsv, exportPersonilCsv, printPersonilRoster,
  importRhCsv, exportRhCsv, doImportRhCsv,
  importRhMonthlyCsv, exportRhMonthlyCsv, doImportRhMonthlyCsv,
  openRhDetail:(t)=>openRhDetail(t.dataset.id),
  openPeriodModal, savePeriod,
  rcPickAll:()=>{ document.querySelectorAll(".rcChk").forEach(c=>c.checked=true); },
  rcPickNone:()=>{ document.querySelectorAll(".rcChk").forEach(c=>c.checked=false); },
  sendPlanToBatch:(t)=>sendPlanToBatch(t.dataset.team),
  printRencanaExport, doPrintRencanaExport,
  setRcView:(t)=>{
    rcView = t.dataset.view;
    document.getElementById("btnRcTable").classList.toggle("primary", rcView==="table");
    document.getElementById("btnRcCard").classList.toggle("primary", rcView==="card");
    document.getElementById("rcTableCard").style.display = rcView==="table" ? "block" : "none";
    document.getElementById("rcCardWrap").style.display = rcView==="card" ? "block" : "none";
  },
  closeModal,
  newBatch, deleteBatch, generateSchedule, recalcSchedule, carryOverBatch, printSamplingGuide, doPrintSamplingGuide, printBeritaAcara, exportTrackingCsv, importTrackingCsv,
  finalizeBatchSchedule, unfinalizeBatchSchedule,
  togglePlSticky:(t)=>{
    const el = document.getElementById("plStickyBody");
    const collapsed = el.classList.toggle("collapsed");
    t.innerHTML = collapsed ? "&#9660; Perluas Panel" : "&#9650; Ciutkan Panel";
    syncActiveStickyOffset();
  },
  toggleAdvanced:()=>{
    const el = document.getElementById("advancedSettings");
    el.style.display = el.style.display==="none" ? "flex" : "none";
    syncActiveStickyOffset();
  },
  toggleRouteWidget:()=>{
    const el = document.getElementById("plRouteWidget");
    const show = el.style.display==="none";
    el.style.display = show ? "block" : "none";
    if(show) renderPlannerRouteWidget();
    syncActiveStickyOffset();
  },
  pickAllPoints:()=>{ document.querySelectorAll(".ptChk").forEach(c=>c.checked=true); updateSelectedCount(); },
  pickNonePoints:()=>{ document.querySelectorAll(".ptChk").forEach(c=>c.checked=false); updateSelectedCount(); },
  addBlocked:()=>{
    const site=document.getElementById("blkSite").value, start=document.getElementById("blkStart").value,
      end=document.getElementById("blkEnd").value, reason=document.getElementById("blkReason").value;
    if(!site||!start||!end){ toast("Lengkapi site, tanggal mulai & selesai.","err"); return; }
    ensureSiteRule(site).blocked.push({start,end,reason});
    save(); renderRules();
    document.getElementById("blkStart").value=""; document.getElementById("blkEnd").value=""; document.getElementById("blkReason").value="";
  },
  removeBlocked:(t)=>{
    const site=t.dataset.site, idx=Number(t.dataset.idx);
    DB.siteRules[site].blocked.splice(idx,1); save(); renderRules();
  },
  moveRoute:(t)=>{
    const list=t.dataset.list, idx=Number(t.dataset.idx), dir=Number(t.dataset.dir);
    const arr = DB[list]; const j = idx+dir;
    if(j<0||j>=arr.length) return;
    [arr[idx],arr[j]] = [arr[j],arr[idx]];
    logChange(`Urutan rute ${list==="routeEmisi"?"Emisi":"Ambient"} diubah — "${arr[j]}" & "${arr[idx]}" ditukar`);
    save(); refreshRouteViews();
  },
  exportAll, resetDefault, resetEmpty, downloadTemplatePoints, downloadTemplatePersonil,
  checkFullBackupUpdate, checkRepoBackupUpdate, applyFullBackupImport,
  dismissOnboarding, startOnboardingUpdate, replayOnboarding, openAboutModal,
  importHasilCsv, exportHasilCsv, downloadTemplateHasil, resetHasilData,
  hdChip:(t)=>{
    const field = t.dataset.field, val = t.dataset.val;
    if(!val){ hdSel[field].clear(); }
    else if(hdSel[field].has(val)){ hdSel[field].delete(val); }
    else{ hdSel[field].add(val); }
    renderHasilDashboard();
  },
  hdResetFilters:()=>{
    hdSel.site.clear(); hdSel.sumber.clear(); hdSel.cerobong.clear();
    const p = document.getElementById("hdFltPermen"); if(p) p.value="";
    const k = document.getElementById("hdFltKapasitas"); if(k) k.value="";
    const s = document.getElementById("hdCerobongSearch"); if(s) s.value="";
    hdCerobongPanelOpen = false; hdCorrParams = [];
    renderHasilDashboard();
  },
  hdToggleFilterCollapse:()=>{ hdFilterCollapsed = !hdFilterCollapsed; renderHasilDashboard(); },
  hdToggleCerobongPanel:()=>{
    hdCerobongPanelOpen = !hdCerobongPanelOpen;
    const p = document.getElementById("hdCerobongPanel");
    if(p) p.style.display = hdCerobongPanelOpen ? "block" : "none";
    if(hdCerobongPanelOpen){ hdRenderCerobongChecklist(); document.getElementById("hdCerobongSearch")?.focus(); }
  },
  hdCerobongCheckAll:()=>{ hdVisibleCerobongOptions().forEach(c=>hdSel.cerobong.add(c)); renderHasilDashboard(); },
  hdCerobongUncheckAll:()=>{ hdVisibleCerobongOptions().forEach(c=>hdSel.cerobong.delete(c)); renderHasilDashboard(); },
  hdSetCompareMode:(t)=>{ hdCompareMode = t.dataset.mode; renderHasilDashboard(); },
  hdCorrToggle:(t)=>{
    const p = t.dataset.val;
    const idx = hdCorrParams.indexOf(p);
    if(idx>=0) hdCorrParams.splice(idx,1);
    else{ if(hdCorrParams.length>=3) hdCorrParams.shift(); hdCorrParams.push(p); }
    renderHasilDashboard();
  },
  hdCorrToggleCerobongPanel:()=>{
    hdCorrCerobongPanelOpen = !hdCorrCerobongPanelOpen;
    const p = document.getElementById("hdCorrCerobongPanel");
    if(p) p.style.display = hdCorrCerobongPanelOpen ? "block" : "none";
    if(hdCorrCerobongPanelOpen){ hdCorrRenderCerobongChecklist(); document.getElementById("hdCorrCerobongSearch")?.focus(); }
  },
  hdCorrCerobongUncheckAll:()=>{ hdCorrSel.cerobong.clear(); renderHasilDashboard(); },
  hdRunSimulation,
  simToggleCerobongPanel:()=>{
    simCerobongPanelOpen = !simCerobongPanelOpen;
    const p = document.getElementById("simCerobongPanel");
    if(p) p.style.display = simCerobongPanelOpen ? "block" : "none";
    if(simCerobongPanelOpen){ simRenderCerobongChecklist(); document.getElementById("simCerobongSearch")?.focus(); }
  },
  simCerobongCheckAll:()=>{ simVisibleCerobongOptions().forEach(c=>simSel.cerobong.add(c)); simRenderCerobongChecklist(); },
  simCerobongUncheckAll:()=>{ simVisibleCerobongOptions().forEach(c=>simSel.cerobong.delete(c)); simRenderCerobongChecklist(); },
  simChip:(t)=>{
    const field = t.dataset.field, val = t.dataset.val;
    if(!val){ simSel[field].clear(); } else if(simSel[field].has(val)){ simSel[field].delete(val); } else { simSel[field].add(val); }
    simRenderScopeChips();
    simRenderCerobongChecklist();
  },
  simSetTrendMode:(t)=>{ simTrendMode = t.dataset.mode; hdRunSimulation(); },
  // Menampilkan salinan isi chart pada modal yang lebih lebar, dipakai sebagai fungsi memperbesar
  // tampilan chart tanpa perlu membuat ulang logika chart di tempat lain.
  hdZoomChart:(t)=>{
    const src = document.getElementById(t.dataset.target);
    if(!src) return;
    const title = t.dataset.title || "";
    openModal(`<h3>${escHtml(title)}</h3><div style="max-height:75vh;overflow:auto;">${src.innerHTML}</div><div class="actions"><button class="btn" data-action="closeModal">Tutup</button></div>`, {wide:true});
  },
  setMasterView:(t)=>{ masterView = t.dataset.view; save2LocalUiState(); renderMaster(); },
  expandAllMaster:()=>{
    const rows = filteredMasterRows();
    rows.forEach(p=>{ masterExpanded.add(p.site); masterExpanded.add(p.site+"::"+subgroupOf(p)); });
    renderMaster();
  },
  // Level 1 saja: buka header site (biar kelihatan rekap "X titik, Y wajib, Z selesai" tiap site
  // sekilas), tapi jenis sumber (level 2) di dalamnya tetap diciutkan sampai diklik manual satu-satu
  // atau pakai "Expand Semua". Subgroup yang sudah kebuka dari sesi sebelumnya sengaja diciutkan
  // ulang di sini supaya hasilnya benar-benar cuma level 1, bukan tercampur sisa state lama.
  expandSitesOnlyMaster:()=>{
    const rows = filteredMasterRows();
    const sites = new Set(rows.map(p=>p.site));
    [...masterExpanded].forEach(k=>{ if(k.includes("::")) masterExpanded.delete(k); });
    sites.forEach(s=>masterExpanded.add(s));
    renderMaster();
  },
  collapseAllMaster:()=>{ masterExpanded.clear(); renderMaster(); },
  toggleMasterGroup:(t)=>{
    const key = t.dataset.key;
    if(masterExpanded.has(key)) masterExpanded.delete(key); else masterExpanded.add(key);
    renderMaster();
  },
  openAdjustDuration:(t)=>{ openAdjustDurationModal(t.dataset.batchId, Number(t.dataset.rowIdx)); },
  openDayDetail:(t)=>{ openDayDetailModal(t.dataset.batchId, Number(t.dataset.rowIdx)); },
  resetDayOverrides:(t)=>{ resetDayOverrides(t.dataset.batchId, Number(t.dataset.rowIdx)); },
  stageExcludePoint:(t)=>{ stageExcludePoint(t.dataset.batchId, t.dataset.pointId); },
  applyExcludeReschedule:(t)=>{ applyExcludeReschedule(t.dataset.batchId, Number(t.dataset.rowIdx)); },
  saveAdjustDuration:(t)=>{
    const b = DB.batches.find(x=>x.id===t.dataset.batchId); if(!b) return;
    const rowIdx = Number(t.dataset.rowIdx);
    const row = b.schedule[rowIdx]; if(!row) return;
    const newWorkDays = Math.max(0, Number(document.getElementById("adjWorkDays").value)||0);
    const newBufferDays = Math.max(0, Number(document.getElementById("adjBufferDays").value)||0);
    const note = document.getElementById("adjNote").value.trim();
    const before = `${row.workDays}h+${row.bufferDays}buf`;
    row.workDays = newWorkDays;
    row.bufferDays = newBufferDays;
    row.adjustNote = note;
    recalcScheduleFrom(b, rowIdx);
    applyScheduleToPoints(b, b.team);
    logChange(`Durasi site ${row.site} (${b.name}) diubah manual: ${before} → ${newWorkDays}h+${newBufferDays}buf${note?` — "${note}"`:""}`);
    save();
    closeModal();
    renderGantt();
    renderMaster();
    toast(`Durasi site ${row.site} diperbarui.`,"ok");
  },
  toggleExcludePoint:(t)=>{
    const b = DB.batches.find(x=>x.id===t.dataset.batchId); if(!b) return;
    if(!b.excluded) b.excluded = [];
    const pointId = t.dataset.pointId;
    const point = DB.points.find(x=>x.id===pointId); if(!point) return;
    const nowExcluded = b.excluded.indexOf(pointId)<0;
    // Ambient-family di titik yang sama = satu kunjungan — exclude/confirm berlaku ke semua
    // parameter di titik itu sekaligus, bukan cuma satu parameter (tidak masuk akal cuma
    // batalkan "kebauan" tapi tetap datang untuk ambient di hari yang sama).
    const groupKey = schedulingGroupKey(point);
    const siblingIds = b.items.filter(id=>{
      const pt = DB.points.find(x=>x.id===id);
      return pt && schedulingGroupKey(pt)===groupKey;
    });
    siblingIds.forEach(id=>{
      const idx = b.excluded.indexOf(id);
      if(nowExcluded && idx<0) b.excluded.push(id);
      if(!nowExcluded && idx>=0) b.excluded.splice(idx,1);
    });
    recomputeSiteForPoint(b, pointId, nowExcluded);
  },
  restoreSnapshotBtn:(t)=>{ restoreSnapshot(Number(t.dataset.idx)); },
  exportCoordsCsv, importCoordsCsv, doImportCoordsCsv,
  toggleCoordSite:(t)=>{
    const key = t.dataset.key;
    if(coordTableExpanded.has(key)) coordTableExpanded.delete(key); else coordTableExpanded.add(key);
    renderCoordTable();
  },
  expandAllCoord:()=>{
    allSites().forEach(s=>coordTableExpanded.add(s));
    renderCoordTable();
  },
  collapseAllCoord:()=>{ coordTableExpanded.clear(); renderCoordTable(); },
  flyToCoord:(t)=>{
    const key = t.dataset.key;
    const latlng = DB.pointCoords[key];
    if(!latlng) return;
    // Zoom ke koordinat aslinya — begitu event zoomend kepicu, renderMap() otomatis jalan lagi dan
    // titik ini otomatis pisah dari bubble (kalau tadinya gabung). Titik yang tetangganya SANGAT
    // berdekatan kadang belum pisah di zoom 16 — kalau masih kegabung, zoom makin dalam tiap
    // percobaan sampai batas maksimal (di situ dijamin ketemu, entah beneran pisah atau lewat
    // fallback spiderfy) supaya popup-nya pasti kebuka, bukan diam saja tanpa penjelasan.
    const maxZ = mapInstance.getMaxZoom();
    let targetZoom = Math.min(16, maxZ);
    mapInstance.setView(latlng, targetZoom);
    const tryOpen = (attempt)=>{
      const m = markerIndex.get(key);
      if(m){ m.openPopup(); return; }
      if(attempt<6){
        if(targetZoom < maxZ){ targetZoom = Math.min(maxZ, targetZoom+2); mapInstance.setView(latlng, targetZoom); }
        setTimeout(()=>tryOpen(attempt+1), 220);
      }
    };
    setTimeout(()=>tryOpen(0), 250);
  },
  openVerifyModal:(t)=>{ openVerifyModal(t.dataset.key, t.dataset.verif); },
  clearVerifierIdentity:(t)=>{ verifierIdentity = null; openVerifyModal(t.dataset.key, t.dataset.verif); },
  confirmVerify:(t)=>{
    const key = t.dataset.key, verif = t.dataset.verif;
    if(!verifierIdentity){
      const name = (document.getElementById("verifName")||{}).value?.trim();
      if(!name){ toast("Isi nama dulu ya, biar tercatat siapa yang verifikasi.","err"); return; }
      const site = (document.getElementById("verifSite")||{}).value?.trim();
      verifierIdentity = {name, site};
    }
    const note = (document.getElementById("verifNote")||{}).value?.trim() || "";
    const prev = DB.coordVerification[key];
    const isToggleOff = prev && prev.status===verif && prev.note===note;
    if(isToggleOff){
      delete DB.coordVerification[key];
      logChange(`Tanda koordinat "${key.split("::").slice(1).join("::")||key}" dibatalkan oleh ${verifierIdentity.name}`);
    } else {
      DB.coordVerification[key] = {status:verif, by:verifierIdentity.name, site:verifierIdentity.site||"", at:new Date().toISOString(), note};
      logChange(`Koordinat "${key.split("::").slice(1).join("::")||key}" ditandai ${verif==="ok"?"sesuai":"tidak sesuai"} oleh ${verifierIdentity.name}${note?` — catatan: ${note}`:""}`);
    }
    save(); closeModal(); renderMap();
  },
  removeVerify:(t)=>{
    const key = t.dataset.key;
    delete DB.coordVerification[key];
    logChange(`Tanda koordinat "${key.split("::").slice(1).join("::")||key}" dihapus`);
    save(); closeModal(); renderMap();
  },
  openKomDetail:(t)=>{ openKomDetail(t.dataset.key); },
  saveKomDetail:(t)=>{
    const key = t.dataset.key;
    const date = document.getElementById("komDate").value || todayStr();
    const attendees = document.getElementById("komAttendees").value.trim();
    const notes = document.getElementById("komNotes").value.trim();
    DB.komStatus[key] = {done:true, date, attendees, notes};
    const nPeserta = attendees.split("\n").map(s=>s.trim()).filter(Boolean).length;
    logChange(`KOM site (${key.split("::")[1]}) dicatat — ${nPeserta} peserta, ${date}`);
    save(); closeModal(); renderTracking();
    toast("Catatan KOM disimpan.","ok");
  },
  clearKomDetail:(t)=>{
    const key = t.dataset.key;
    delete DB.komStatus[key];
    logChange(`Catatan KOM site (${key.split("::")[1]}) dihapus`);
    save(); closeModal(); renderTracking();
  },
  deleteSnapshotBtn:(t)=>{ deleteSnapshot(Number(t.dataset.idx)); },
  clearAllSnapshots,
  bulkTrackColumn:(t)=>{
    const key = t.dataset.key;
    const {pts} = getFilteredTrackingPoints();
    // Kolom dokumen (Tahap 2) cuma ditampilkan utk titik yang sudah berstatus "Sudah Disampling"
    // (Tahap 1) — "Centang Semua" harus konsisten dengan baris yang benar-benar tampil di tabel.
    const docPts = pts.filter(p=>ensureTracking(p.id).samplingStatus==="sampled");
    if(!docPts.length) return;
    const allChecked = docPts.every(p=>DB.tracking[p.id] && DB.tracking[p.id][key]);
    const newVal = !allChecked;
    docPts.forEach(p=>{
      const tr = ensureTracking(p.id);
      tr[key] = newVal;
      tr.dates[key] = newVal ? todayStr() : "";
      if(key==="simpelInput" && newVal){ p.status = "done"; }
    });
    const label = TRACK_STEPS.find(s=>s[0]===key)[1];
    logChange(`Kolom "${label}" di-bulk ${newVal?"centang":"kosongkan"} untuk ${docPts.length} titik`);
    save(); renderTracking();
    toast(`"${label}" di-${newVal?"centang":"kosongkan"} untuk ${docPts.length} baris yang tampil.`,"ok");
  },
  // Kosongkan lagi status/tanggal/catatan sampling (Tahap 1) satu titik — utk salah input tanpa
  // harus utak-atik dropdown+tanggal+catatan satu-satu. TIDAK menyentuh Tahap 2 (BA/draft/dst),
  // itu checklist dokumen terpisah yang punya alurnya sendiri.
  resetSamplingRecord:(t)=>{
    const id = t.dataset.id;
    const p = DB.points.find(x=>x.id===id);
    askConfirm(`Kosongkan status, tanggal, dan catatan sampling untuk "${p?p.nama:id}"?`, ()=>{
      const tr = ensureTracking(id);
      tr.samplingStatus = ""; tr.actual = false; tr.dates.actual = ""; tr.samplingNote = "";
      logChange(`Status/tanggal/catatan sampling "${p?p.nama:id}" direset`);
      save(); renderTracking();
      toast("Data sampling titik ini dikosongkan.","ok");
    });
  },
  // Reset borongan — cakupannya persis baris yang lagi tampil di tabel Tahap 1 (ikut filter
  // Tim/Batch/Site di atas): kosongkan Site di filter = reset semua site sekaligus, isi Site
  // tertentu = reset cuma site itu. Satu mekanisme utk dua kebutuhan ("per site" & "semua data"),
  // tanpa perlu tombol/UI terpisah.
  resetSamplingRecordsBulk:()=>{
    const {beforeStatus} = getFilteredTrackingPoints();
    const filled = beforeStatus.filter(p=>{ const t=ensureTracking(p.id); return t.samplingStatus || t.dates.actual || t.samplingNote; });
    if(!filled.length){ toast("Tidak ada data sampling terisi pada baris yang sedang tampil.","err"); return; }
    askConfirm(`Kosongkan status, tanggal, dan catatan sampling utk ${filled.length} titik yang sedang tampil (sesuai filter Tim/Batch/Site/Status aktif)?`, ()=>{
      filled.forEach(p=>{
        const tr = ensureTracking(p.id);
        tr.samplingStatus = ""; tr.actual = false; tr.dates.actual = ""; tr.samplingNote = "";
      });
      logChange(`Reset massal status/tanggal/catatan sampling utk ${filled.length} titik (sesuai filter Tracking aktif)`);
      save(); renderTracking();
      toast(`${filled.length} titik direset.`,"ok");
    });
  },
  exportMomPdf
};
function save2LocalUiState(){ /* view preference kept in-memory only, resets on reload */ }
document.addEventListener("click", e=>{
  const t = e.target.closest("[data-action]");
  if(!t) return;
  const fn = ACTIONS[t.dataset.action];
  if(fn) fn(t);
});
document.addEventListener("change", e=>{
  if(e.target.dataset.action==="setCrewDay"){ ensureSiteRule(e.target.dataset.site).crewChangeDay = e.target.value; save(); }
  if(e.target.dataset.action==="setRatio"){ ensureSiteRule(e.target.dataset.site)[e.target.dataset.field] = Number(e.target.value)||1; save(); }
  if(e.target.dataset.action==="setPermitLeadDays"){ ensureSiteRule(e.target.dataset.site).permitLeadDays = Math.max(0, Number(e.target.value)||0); save(); }
  if(e.target.dataset.action==="setTransport"){ ensureSiteRule(e.target.dataset.site).transport = e.target.value; save(); }
  if(e.target.dataset.action==="setFlareOneDay"){ ensureSiteRule(e.target.dataset.site).flareOneDay = e.target.checked; save(); toast("Perubahan berlaku ke jadwal Emisi berikutnya yang di-generate/dihitung ulang di site ini — jadwal yang sudah ada tidak berubah otomatis.","ok"); }
});

/* =========================================================
   INIT
========================================================= */
load();
showPage("dashboard");
// TIDAK auto-popup lagi (lihat catatan di renderOnboardingModal) — tools ini dibuka via file://
// yang di-save-ulang berkala dgn nama baru (tanggal berubah tiap kali), dan localStorage file://
// terikat ke PATH FILE PERSIS, bukan ke folder — jadi tiap file baru = origin kosong = "keliatan"
// spt pertama kali buka terus-menerus walau sebenarnya bukan. Entry point-nya sekarang tombol
// "Info & Panduan Setup" yg SELALU kelihatan di brand/logo area (bukan footer kecil yg gampang
// kelewat), diklik kalau perlu, bukan dipaksa muncul sendiri.
if(document.getElementById("brandLogoImg")) document.getElementById("brandLogoImg").src = LOGO_PHM_B64;
