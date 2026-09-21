/* =========================================================
   ROADMAP WAJIB PANTAU (multi-tahun)
   ---------------------------------------------------------
   Proyeksi ke depan kapan tiap titik jatuh tempo disampling lagi, sejauh 5/10 tahun — jawaban atas
   permintaan user yang sebelumnya bikin tabel ini manual di Excel tiap kali (lihat lampiran).
   Prinsip: SATU sumber kebenaran siklus per titik, sama dgn yang sudah dipakai di tempat lain
   (p.frekuensiBulan/p.pemantauanTerakhir/nextPeriodAfter, 03-period-logic.js) — bukan logika baru,
   cuma dijalankan BERULANG ke depan (bukan cuma 1x "prediksi berikutnya" spt p.prediksiBerikutnya).
========================================================= */
let roadmapState = { site:"", years:5 };

// Deret N periode BERURUTAN mulai dari startPeriodStr sendiri (termasuk).
function roadmapPeriodSeq(startPeriodStr, count){
  const start = parsePeriodStr(startPeriodStr);
  if(!start) return [];
  let totalSem = start.year*2 + (start.sem-1);
  const out = [];
  for(let i=0;i<count;i++){
    out.push(periodLabel((totalSem%2)+1, Math.floor(totalSem/2)));
    totalSem++;
  }
  return out;
}
// Deret periode JATUH TEMPO (wajib sampling) 1 titik, dari periode aktif sekarang sampai N semester
// ke depan. Basis siklus: lanjutkan dari pemantauanTerakhir kalau ada (siklus berjalan terus tiap
// frekuensiBulan sejak sampling terakhir), atau mulai dari periode aktif kalau belum pernah
// disampling sama sekali. Titik yang prediksinya sudah lewat (terlambat) tetap dianggap jatuh tempo
// MULAI periode aktif (bukan ikut nongol di periode lampau yang sudah lewat).
function roadmapDuePeriods(p, semestersAhead){
  if(!p.wajib || !p.frekuensiBulan) return [];
  const stepSem = Math.max(1, Math.round(Number(p.frekuensiBulan)/6));
  const activeParts = parsePeriodStr(currentPeriodStr());
  if(!activeParts) return [];
  const nowSem = activeParts.year*2 + (activeParts.sem-1);
  const horizonEnd = nowSem + semestersAhead;

  let cursor;
  const last = p.pemantauanTerakhir ? parsePeriodStr(p.pemantauanTerakhir) : null;
  cursor = last ? (last.year*2 + (last.sem-1)) + stepSem : nowSem;
  while(cursor < nowSem) cursor += stepSem;

  const due = [];
  while(cursor <= horizonEnd){
    due.push(periodLabel((cursor%2)+1, Math.floor(cursor/2)));
    cursor += stepSem;
  }
  return due;
}
function refreshRoadmapSiteSelect(){
  const sel = document.getElementById("rmSite");
  if(sel.options.length) return;
  const sites = [...new Set(DB.points.map(p=>p.site))].sort();
  sel.innerHTML = `<option value="">Semua Site</option>` + sites.map(s=>`<option value="${escHtml(s)}">${escHtml(s)}</option>`).join("");
}
function roadmapApplyYears(years){
  roadmapState.years = years;
  renderRoadmapPantau();
}
function renderRoadmapPantau(){
  refreshRoadmapSiteSelect();
  document.getElementById("rmSite").value = roadmapState.site;
  document.querySelectorAll("[data-action='roadmapSetYears']").forEach(btn=>{
    btn.classList.toggle("active", Number(btn.dataset.years)===roadmapState.years);
  });

  const semestersAhead = roadmapState.years*2;
  const periods = roadmapPeriodSeq(currentPeriodStr(), semestersAhead+1);

  const siteFilter = roadmapState.site;
  let pts = DB.points.filter(p=> (!siteFilter || p.site===siteFilter) && !p.tidakBeroperasi);
  pts.sort((a,b)=> a.site===b.site ? a.nama.localeCompare(b.nama) : a.site.localeCompare(b.site));

  // Cache due-periods per titik sekali (dipakai ulang di rekap & grid detail) — hindari hitung dua kali.
  const dueMap = new Map();
  pts.forEach(p=> dueMap.set(p.id, new Set(roadmapDuePeriods(p, semestersAhead))));

  // Rekap ringkas: jumlah titik jatuh tempo per site x semester — jawaban langsung "berapa titik
  // yang harus disampling tiap semester di masing2 site" tanpa perlu hitung manual dari grid detail.
  const sites = [...new Set(pts.map(p=>p.site))].sort();
  const recap = {};
  pts.forEach(p=>{
    (dueMap.get(p.id)||new Set()).forEach(per=>{
      recap[p.site] = recap[p.site] || {};
      recap[p.site][per] = (recap[p.site][per]||0)+1;
    });
  });
  const grandTotal = periods.map(per=> sites.reduce((a,s)=>a+((recap[s]&&recap[s][per])||0),0));
  document.getElementById("rmRecapTable").innerHTML = `
    <thead><tr><th>Site</th>${periods.map(per=>`<th style="text-align:center;">${escHtml(per)}</th>`).join("")}<th style="text-align:center;">Total</th></tr></thead>
    <tbody>${sites.map(s=>{
      const rowTotal = periods.reduce((a,per)=>a+((recap[s]&&recap[s][per])||0),0);
      return `<tr><td><span class="pal-site-pill" style="--site-c:${HASIL_SITE_COLORS[s]||"#7f8fa0"};">${escHtml(s)}</span></td>
        ${periods.map(per=>{
          const n = (recap[s]&&recap[s][per])||0;
          return `<td style="text-align:center;${n?"font-weight:700;":"color:var(--gray-300);"}">${n||"&middot;"}</td>`;
        }).join("")}
        <td style="text-align:center;font-weight:800;">${rowTotal}</td></tr>`;
    }).join("")}
    <tr style="border-top:2px solid var(--gray-300);"><td><b>Total Semua Site</b></td>${grandTotal.map(n=>`<td style="text-align:center;font-weight:800;">${n||"&middot;"}</td>`).join("")}<td style="text-align:center;font-weight:800;">${grandTotal.reduce((a,b)=>a+b,0)}</td></tr>
    </tbody>`;

  // Grid detail per titik — titik non-wajib tetap ditampilkan (baris tanpa titik merah sama sekali)
  // supaya daftarnya tetap lengkap 1:1 dengan Database Titik Pantau, bukan cuma yang wajib saja.
  document.getElementById("rmDetailTable").innerHTML = `
    <thead><tr><th>Site</th><th style="min-width:170px;">Titik</th><th>Kategori</th><th>Keterangan</th><th>Pemantauan Terakhir</th>
      ${periods.map(per=>`<th style="text-align:center;min-width:44px;">${escHtml(per)}</th>`).join("")}</tr></thead>
    <tbody>${pts.map(p=>{
      const due = dueMap.get(p.id)||new Set();
      const ket = !p.wajib ? `<span class="muted" style="font-style:italic;">Tidak wajib dipantau</span>` : frekuensiLabelShort(p.frekuensiBulan);
      return `<tr><td>${escHtml(p.site)}</td><td>${escHtml(p.nama)}</td><td class="muted" style="font-size:11px;">${escHtml(monitoringTypeLabel(p))}</td>
        <td style="font-size:11px;">${ket}</td><td class="muted" style="font-size:11px;">${escHtml(p.pemantauanTerakhir||"-")}</td>
        ${periods.map(per=>{
          if(!due.has(per)) return `<td></td>`;
          return `<td style="text-align:center;" title="Wajib sampling ${escHtml(per)} — parameter: ${escHtml(p.parameter||"-")}"><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--red-500);"></span></td>`;
        }).join("")}
      </tr>`;
    }).join("")}</tbody>`;
  document.getElementById("rmCount").textContent = `${pts.length} titik ditampilkan` + (siteFilter?` di site ${siteFilter}`:"") + ` — ${grandTotal.reduce((a,b)=>a+b,0)} kali wajib sampling terjadwal dalam ${roadmapState.years} tahun ke depan.`;
}
function roadmapSetSite(){
  roadmapState.site = document.getElementById("rmSite").value;
  renderRoadmapPantau();
}
Object.assign(ACTIONS, { roadmapSetYears: (t)=>roadmapApplyYears(Number(t.dataset.years)) });
document.getElementById("rmSite").addEventListener("change", roadmapSetSite);
