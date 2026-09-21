/* =========================================================
   ROADMAP WAJIB PANTAU (multi-tahun)
   ---------------------------------------------------------
   Proyeksi ke depan kapan tiap titik jatuh tempo disampling lagi, sejauh 5/10 tahun — jawaban atas
   permintaan user yang sebelumnya bikin tabel ini manual di Excel tiap kali (lihat lampiran).
   Prinsip: SATU sumber kebenaran siklus per titik, sama dgn yang sudah dipakai di tempat lain
   (p.frekuensiBulan/p.pemantauanTerakhir/nextPeriodAfter, 03-period-logic.js) — bukan logika baru,
   cuma dijalankan BERULANG ke depan (bukan cuma 1x "prediksi berikutnya" spt p.prediksiBerikutnya).
   Juga bisa menunjukkan RIWAYAT (periode sebelum sekarang) berdampingan dgn proyeksi ke depan, ditandai
   sudah-dipantau (centang hijau, dari hasilAktualUntukPeriode — data hasil AKTUAL, 13-hasil-db.js)
   vs wajib-tapi-belum (titik merah, dari roadmapDuePeriods — cuma berlaku periode sekarang & depan,
   TIDAK diubah dari perilaku aslinya spy proyeksinya tetap teruji sama). ---------- */
let roadmapState = { site:"", team:"", years:5, yearsBack:2 };

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
// MULAI periode aktif (bukan ikut nongol di periode lampau yang sudah lewat) — SENGAJA cuma menjangkau
// sekarang+masa depan (bukan riwayat, lihat catatan blok atas kenapa riwayat dipisah pakai sumber lain).
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
function roadmapApplyYearsBack(years){
  roadmapState.yearsBack = years;
  renderRoadmapPantau();
}
function renderRoadmapPantau(){
  refreshRoadmapSiteSelect();
  document.getElementById("rmSite").value = roadmapState.site;
  document.getElementById("rmTeam").value = roadmapState.team;
  document.querySelectorAll("[data-action='roadmapSetYears']").forEach(btn=>{
    btn.classList.toggle("active", Number(btn.dataset.years)===roadmapState.years);
  });
  document.querySelectorAll("[data-action='roadmapSetYearsBack']").forEach(btn=>{
    btn.classList.toggle("active", Number(btn.dataset.yearsBack)===roadmapState.yearsBack);
  });

  const semestersAhead = roadmapState.years*2;
  const semestersBack = roadmapState.yearsBack*2;
  const nowParts = parsePeriodStr(currentPeriodStr());
  const nowSem = nowParts.year*2 + (nowParts.sem-1);
  const historyStartSem = nowSem - semestersBack;
  const historyStart = periodLabel((historyStartSem%2)+1, Math.floor(historyStartSem/2));
  const periods = roadmapPeriodSeq(historyStart, semestersBack+semestersAhead+1);
  const nowPeriodStr = currentPeriodStr();

  const siteFilter = roadmapState.site;
  const teamFilter = roadmapState.team;
  let pts = DB.points.filter(p=> (!siteFilter || p.site===siteFilter) && !p.tidakBeroperasi);
  if(teamFilter) pts = pts.filter(p=> teamFilter==="emisi" ? p.kategori==="emisi" : p.kategori!=="emisi");
  pts.sort((a,b)=> a.site===b.site ? a.nama.localeCompare(b.nama) : a.site.localeCompare(b.site));

  // Cache due-periods (proyeksi sekarang+depan SAJA) & actual-periods (riwayat, bisa periode manapun)
  // per titik sekali — dipakai ulang di rekap & grid detail, hindari hitung berulang.
  const dueMap = new Map(), actualMap = new Map();
  pts.forEach(p=>{
    dueMap.set(p.id, new Set(roadmapDuePeriods(p, semestersAhead)));
    actualMap.set(p.id, new Set(periods.filter(per=>hasilAktualUntukPeriode(p, per))));
  });

  // Rekap ringkas: jumlah titik jatuh tempo (proyeksi, BUKAN riwayat) per site x semester — jawaban
  // langsung "berapa titik yang harus disampling tiap semester di masing2 site" tanpa perlu hitung
  // manual dari grid detail. Riwayat sengaja tidak ikut direkap di sini (rekap ini murni utk rencana
  // ke depan) — makanya cuma iterasi periods yg due, sisanya (periode riwayat) otomatis 0/kosong.
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
    <thead><tr><th>Site</th>${periods.map(per=>`<th style="text-align:center;${per===nowPeriodStr?"background:var(--teal-50,#e6f7f5);":""}">${escHtml(per)}</th>`).join("")}<th style="text-align:center;">Total</th></tr></thead>
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

  // Grid detail per titik — titik non-wajib tetap ditampilkan (baris tanpa tanda sama sekali) supaya
  // daftarnya tetap lengkap 1:1 dengan Database Titik Pantau, bukan cuma yang wajib saja. Tiap sel:
  // centang hijau = SUDAH ada hasil aktual periode itu (riwayat ATAU proyeksi yg kebetulan sudah
  // disampling duluan), titik merah = wajib tapi BELUM ada hasil (cuma bisa muncul di periode
  // sekarang/depan, lihat roadmapDuePeriods), kosong = tidak wajib periode itu & belum ada hasil.
  document.getElementById("rmDetailTable").innerHTML = `
    <thead><tr><th>Site</th><th style="min-width:170px;">Titik</th><th>Kategori</th><th>Keterangan</th><th>Pemantauan Terakhir</th>
      ${periods.map(per=>`<th style="text-align:center;min-width:44px;${per===nowPeriodStr?"background:var(--teal-50,#e6f7f5);":""}">${escHtml(per)}</th>`).join("")}</tr></thead>
    <tbody>${pts.map(p=>{
      const due = dueMap.get(p.id)||new Set();
      const actual = actualMap.get(p.id)||new Set();
      const ket = !p.wajib ? `<span class="muted" style="font-style:italic;">Tidak wajib dipantau</span>` : frekuensiLabelShort(p.frekuensiBulan);
      return `<tr><td>${escHtml(p.site)}</td><td>${escHtml(p.nama)}</td><td class="muted" style="font-size:11px;">${escHtml(monitoringTypeLabel(p))}</td>
        <td style="font-size:11px;">${ket}</td><td class="muted" style="font-size:11px;">${escHtml(p.pemantauanTerakhir||"-")}</td>
        ${periods.map(per=>{
          const cellBg = per===nowPeriodStr?"background:var(--teal-50,#e6f7f5);":"";
          if(actual.has(per)) return `<td style="text-align:center;${cellBg}" title="Sudah dipantau ${escHtml(per)} — parameter: ${escHtml(p.parameter||"-")}"><span style="color:var(--green-600,#0d8a4f);font-weight:800;">&#10003;</span></td>`;
          if(due.has(per)) return `<td style="text-align:center;${cellBg}" title="Wajib sampling ${escHtml(per)} — parameter: ${escHtml(p.parameter||"-")}"><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--red-500);"></span></td>`;
          return `<td style="${cellBg}"></td>`;
        }).join("")}
      </tr>`;
    }).join("")}</tbody>`;
  document.getElementById("rmCount").textContent = `${pts.length} titik ditampilkan` + (siteFilter?` di site ${siteFilter}`:"") + (teamFilter?` — tim ${teamFilter==="emisi"?"Emisi":"Ambient"}`:"") + ` — ${grandTotal.reduce((a,b)=>a+b,0)} kali wajib sampling terjadwal dalam ${roadmapState.years} tahun ke depan (plus riwayat ${roadmapState.yearsBack} tahun ke belakang).`;
}
function roadmapSetSite(){
  roadmapState.site = document.getElementById("rmSite").value;
  renderRoadmapPantau();
}
function roadmapSetTeam(){
  roadmapState.team = document.getElementById("rmTeam").value;
  renderRoadmapPantau();
}
Object.assign(ACTIONS, {
  roadmapSetYears: (t)=>roadmapApplyYears(Number(t.dataset.years)),
  roadmapSetYearsBack: (t)=>roadmapApplyYearsBack(Number(t.dataset.yearsBack))
});
document.getElementById("rmSite").addEventListener("change", roadmapSetSite);
document.getElementById("rmTeam").addEventListener("change", roadmapSetTeam);
