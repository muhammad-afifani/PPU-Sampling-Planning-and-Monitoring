/* =========================================================
   BUDGET & PROYEKSI BIAYA
   ---------------------------------------------------------
   Jawaban atas permintaan user: "aku bisa tahu budget yg harus dikeluarkan ... ngelink dengan hasil
   sampling yang sudah dilaksanakan dan yang akan dilaksanakan". Prinsip yang sama dipakai lagi di
   sini spt fitur2 lain sesi ini — SATU sumber kebenaran, bukan logika baru:
   - "Titik mana yg wajib sampling periode X" -> roadmapDuePeriods (22-roadmap-pantau.js, TIDAK
     diubah/dipanggil apa adanya) -> ini bagian PROYEKSI (estimasi, belum tentu jadi).
   - "Titik mana yg SUDAH ada hasil periode X" -> hasilAktualUntukPeriode (13-hasil-db.js) -> ini
     bagian AKTUAL (harga yg BENERAN sudah/akan pasti keluar, krn sampling-nya sudah terjadi).
   - Parameter yg disampling tiap titik -> p.parameter (titik emisi, token "NOx"/"CO"/dst persis
     ejaan yg dipakai di seluruh Database Titik Pantau) & p.kategori (titik non-emisi, flat per
     titik per kunjungan) -> dikalikan DB.budgetConfig.unitPrices (harga kontrak PHM-SCI 4710009303).
   Kalau titik SUDAH actual periode itu, TIDAK dihitung dobel sbg proyeksi juga (union, actual menang).
========================================================= */
let budgetState = { yearsBack: 0, yearsAhead: 1, markupPct: 0 };

/* ---------- Resolusi parameter -> harga satuan per titik ---------- */
function budgetParamTokensForPoint(p){
  if(p.kategori==="emisi") return (p.parameter||"").split(",").map(s=>s.trim()).filter(Boolean);
  return [p.kategori]; // ambient/kebisingan/kebauan/getaran: 1 harga flat per titik per kunjungan
}
function budgetUnitPrice(token){
  return Number(DB.budgetConfig.unitPrices[token]) || 0;
}
function budgetPointBreakdown(p){
  return budgetParamTokensForPoint(p).map(token=>({token, price: budgetUnitPrice(token)}));
}
function budgetPointCost(p){
  return budgetPointBreakdown(p).reduce((sum,b)=>sum+b.price, 0);
}
function budgetTokenLabel(token){
  const labels = {
    NOx:"NOx (Stack, Dry Method 7/7E USEPA)", CO:"CO (Stack)", SO2:"SO2 (Stack)",
    "Total Partikulat":"Partikulat/TSP (Stack, Isokinetik)", Opasitas:"Opasitas (Flare/Stack)",
    H2S:"H2S (Kandungan Sulfur Bahan Bakar)", BTEX:"BTEX",
    ambient:"Udara Ambien (per titik/kunjungan)", kebisingan:"Kebisingan (per titik/kunjungan)",
    kebauan:"Kebauan/Odor (per titik/kunjungan)", getaran:"Getaran/Vibrasi (per titik/kunjungan)"
  };
  return labels[token] || token;
}

/* ---------- Titik AKTUAL (sudah ada hasil) vs PROYEKSI (wajib, belum ada hasil) per periode ---------- */
function budgetActualPointsForPeriod(periode){
  const ids = new Set();
  DB.hasilPemantauan.forEach(r=>{ if(r.periode===periode) ids.add(r.engineId); });
  Object.keys(HASIL_AMBIEN_KATEGORI_KEY).forEach(kat=>{
    const catKey = HASIL_AMBIEN_KATEGORI_KEY[kat];
    (DB.hasilAmbien[catKey]||[]).forEach(r=>{ if(r.periode===periode) ids.add(r.titikId); });
  });
  return [...ids].map(id=>DB.points.find(p=>p.id===id)).filter(Boolean);
}
// Satu pass utk seluruh rentang periode yg ditampilkan — dueSets dihitung SEKALI per titik (bukan
// per periode) drpd manggil roadmapDuePeriods berulang, lebih efisien utk titik yg banyak.
function budgetPeriodRows(periods, semestersAheadForDue){
  const dueSets = new Map();
  DB.points.forEach(p=>{ dueSets.set(p.id, new Set(roadmapDuePeriods(p, semestersAheadForDue))); });
  return periods.map(periode=>{
    const actualPts = budgetActualPointsForPeriod(periode);
    const actualIds = new Set(actualPts.map(p=>p.id));
    const projectedPts = DB.points.filter(p=> !actualIds.has(p.id) && !p.tidakBeroperasi && (dueSets.get(p.id)||new Set()).has(periode));
    return { periode, actualPts, projectedPts };
  });
}
function budgetRowCost(row){
  const sumCost = pts => pts.reduce((s,p)=>s+budgetPointCost(p), 0);
  const actualCost = sumCost(row.actualPts);
  const projectedCost = sumCost(row.projectedPts);
  const totalTitik = row.actualPts.length + row.projectedPts.length;
  const mobilisasi = totalTitik>0 ? (Number(DB.budgetConfig.mobilisasiPaketPerSemester)||0) : 0;
  const manualItems = DB.budgetManualItems.filter(m=>m.periode===row.periode);
  const manual = manualItems.reduce((s,m)=> s + (Number(m.jumlah)||1)*(Number(m.biayaSatuan)||0), 0);
  const base = actualCost + projectedCost + mobilisasi + manual;
  return { actualCost, projectedCost, mobilisasi, manual, manualItems, base, totalTitik };
}
function budgetApplyMarkup(base, pct){ return base * (1 + (Number(pct)||0)/100); }
// Rincian per parameter/kategori, diagregasi lintas SEMUA periode yg ditampilkan (union titik AKTUAL
// + PROYEKSI tiap periode) — dipakai tabel "Rincian Biaya per Parameter" & basis pie/bar breakdown.
function budgetParamTotals(rows){
  const totals = {};
  rows.forEach(row=>{
    [...row.actualPts, ...row.projectedPts].forEach(p=>{
      budgetPointBreakdown(p).forEach(({token,price})=>{
        if(!totals[token]) totals[token] = {count:0, cost:0};
        totals[token].count++; totals[token].cost += price;
      });
    });
  });
  return totals;
}
function fmtRupiah(n){ return "Rp" + Math.round(n).toLocaleString("id-ID"); }
function fmtRupiahRingkas(n){
  const abs = Math.abs(n);
  if(abs>=1e9) return "Rp"+(n/1e9).toFixed(2)+" M";
  if(abs>=1e6) return "Rp"+(n/1e6).toFixed(1)+" jt";
  return fmtRupiah(n);
}

/* ---------- Chart batang bertumpuk per semester (Aktual / Proyeksi / Mobilisasi+Lainnya) ----------
   Pola sumbu/gridline SAMA dgn buildHasilTrendChart (14-hasil-dashboard.js) supaya konsisten dgn
   chart lain di app ini — 1 sumbu, warna kategori TETAP (bukan diurut ulang per ranking nilai). */
function buildBudgetChart(rows, costs){
  const W=920, H=320, padL=64, padR=16, padT=18, padB=44;
  const plotW=W-padL-padR, plotH=H-padT-padB;
  const n = rows.length;
  const maxY = Math.max(...costs.map(c=>budgetApplyMarkup(c.base, budgetState.markupPct)), 1) * 1.15;
  const nowP = currentPeriodStr();
  const COL_ACTUAL = "#0ea5a0", COL_PROJECTED = "#e8a33d", COL_OTHER = "#94a3b8";
  function xFor(i){ return padL + (i+0.5)*(plotW/n); }
  function yFor(v){ return padT + plotH - (Math.min(v,maxY)/maxY)*plotH; }
  let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;font-size:11px;background:var(--surface-card);border:1px solid var(--gray-200);border-radius:10px;">`;
  for(let g=0; g<=4; g++){
    const y = padT + plotH - (g/4)*plotH;
    svg += `<line x1="${padL}" y1="${y}" x2="${W-padR}" y2="${y}" stroke="var(--gray-200)"/>`;
    svg += `<text x="2" y="${y+4}" fill="var(--gray-500)">${fmtRupiahRingkas(maxY*g/4)}</text>`;
  }
  const barW = Math.min(46, (plotW/n)*0.5);
  rows.forEach((row,i)=>{
    const c = costs[i];
    const mk = budgetState.markupPct/100;
    const cx = xFor(i);
    const vA = c.actualCost*(1+mk), vP = c.projectedCost*(1+mk), vO = (c.mobilisasi+c.manual)*(1+mk);
    const yBase = padT+plotH;
    const hA = (vA/maxY)*plotH, hP = (vP/maxY)*plotH, hO = (vO/maxY)*plotH;
    let yCur = yBase;
    if(hA>0){ svg += `<rect x="${cx-barW/2}" y="${yCur-hA}" width="${barW}" height="${hA}" fill="${COL_ACTUAL}"/>`; yCur -= hA; }
    if(hP>0){ svg += `<rect x="${cx-barW/2}" y="${yCur-hP}" width="${barW}" height="${hP}" fill="${COL_PROJECTED}"/>`; yCur -= hP; }
    if(hO>0){ svg += `<rect x="${cx-barW/2}" y="${yCur-hO}" width="${barW}" height="${hO}" fill="${COL_OTHER}"/>`; yCur -= hO; }
    const total = vA+vP+vO;
    if(total>0) svg += `<text x="${cx}" y="${yCur-5}" text-anchor="middle" font-size="9.5" font-weight="700" fill="var(--gray-700)">${fmtRupiahRingkas(total)}</text>`;
    const isNow = row.periode===nowP;
    svg += `<text x="${cx}" y="${H-padB+16}" text-anchor="middle" font-size="10.5" fill="${isNow?'#0d8a7a':'var(--gray-500)'}" font-weight="${isNow?'800':'400'}">${escHtml(row.periode)}</text>`;
    if(isNow) svg += `<rect x="${cx-plotW/n/2}" y="${padT}" width="${plotW/n}" height="${plotH}" fill="#0ea5a0" opacity="0.06"/>`;
  });
  svg += `</svg>`;
  return svg;
}
function budgetChartLegendHtml(){
  return `<span class="item"><span class="sw" style="background:#0ea5a0"></span>Aktual (sudah ada hasil)</span>
    <span class="item"><span class="sw" style="background:#e8a33d"></span>Proyeksi (wajib, estimasi)</span>
    <span class="item"><span class="sw" style="background:#94a3b8"></span>Mobilisasi &amp; Item Manual</span>`;
}

/* ---------- Item biaya manual (mobilisasi tambahan/teknisi/lainnya) — CRUD ---------- */
const BUDGET_MANUAL_JENIS_LABEL = {mobilisasi:"Mobilisasi/Demobilisasi Tambahan", teknisi:"Teknisi Tambahan", lainnya:"Lainnya"};
function budgetManualFormHtml(rec){
  rec = rec || {id:"", periode: currentPeriodStr(), jenis:"mobilisasi", deskripsi:"", jumlah:1, biayaSatuan:3850000, catatan:""};
  return `<h3>${rec.id?"Edit":"Tambah"} Item Biaya Manual</h3>
    <div class="hint" style="margin-top:-6px;">Utk biaya "jika diperlukan/provisional" (mobilisasi tambahan, teknisi tambahan, dll) yang sifatnya per-kejadian — diisi manual, tidak dihitung otomatis dari proyeksi titik.</div>
    <div class="grid cols-2" style="margin-top:10px;">
      <div class="field"><label>Periode</label><input type="text" id="bm_periode" value="${escHtml(rec.periode)}" placeholder="S1 2026"></div>
      <div class="field"><label>Jenis</label><select id="bm_jenis">
        ${Object.keys(BUDGET_MANUAL_JENIS_LABEL).map(k=>`<option value="${k}" ${rec.jenis===k?"selected":""}>${BUDGET_MANUAL_JENIS_LABEL[k]}</option>`).join("")}
      </select></div>
    </div>
    <div class="field" style="margin-top:10px;"><label>Deskripsi</label><input type="text" id="bm_deskripsi" value="${escHtml(rec.deskripsi)}" placeholder="mis. Mobilisasi tambahan sampling ulang GEG 500 BKP"></div>
    <div class="grid cols-2" style="margin-top:10px;">
      <div class="field"><label>Jumlah (trip/hari)</label><input type="number" id="bm_jumlah" value="${rec.jumlah}" min="1" step="1"></div>
      <div class="field"><label>Biaya Satuan (Rp)</label><input type="number" id="bm_biayaSatuan" value="${rec.biayaSatuan}" min="0" step="1000"></div>
    </div>
    <div class="field" style="margin-top:10px;"><label>Catatan (opsional)</label><input type="text" id="bm_catatan" value="${escHtml(rec.catatan)}"></div>
    <div class="actions">
      <button class="btn ghost" data-action="closeModal">Batal</button>
      <button class="btn primary" data-action="saveBudgetManual" data-id="${rec.id}">Simpan</button>
    </div>`;
}
function addBudgetManual(){ openModal(budgetManualFormHtml(null)); }
function editBudgetManual(id){
  const r = DB.budgetManualItems.find(x=>x.id===id); if(!r) return;
  openModal(budgetManualFormHtml(r));
}
function saveBudgetManual(id){
  const periode = document.getElementById("bm_periode").value.trim();
  if(!parsePeriodStr(periode)){ toast('Format Periode harus "S1 2026" atau "S2 2026".', "err"); return; }
  const val = {
    periode, jenis: document.getElementById("bm_jenis").value,
    deskripsi: document.getElementById("bm_deskripsi").value.trim(),
    jumlah: Math.max(1, Number(document.getElementById("bm_jumlah").value)||1),
    biayaSatuan: Math.max(0, Number(document.getElementById("bm_biayaSatuan").value)||0),
    catatan: document.getElementById("bm_catatan").value.trim()
  };
  if(id){ Object.assign(DB.budgetManualItems.find(x=>x.id===id), val); }
  else { DB.budgetManualItems.push({id:uid("BGT"), ...val}); }
  save(); closeModal(); renderBudgetPage();
  toast(id?"Item biaya diperbarui.":"Item biaya ditambahkan.", "ok");
}
function deleteBudgetManual(id){
  askConfirm("Hapus item biaya manual ini?", ()=>{
    DB.budgetManualItems = DB.budgetManualItems.filter(x=>x.id!==id);
    save(); renderBudgetPage(); toast("Item biaya dihapus.", "ok");
  });
}

/* ---------- Pengaturan harga satuan (kontrak PHM-SCI) ---------- */
function budgetConfigModalHtml(){
  const up = DB.budgetConfig.unitPrices;
  const rows = Object.keys(up).map(k=>`<tr>
    <td style="padding:5px 8px;">${escHtml(budgetTokenLabel(k))}</td>
    <td style="padding:5px 8px;text-align:right;"><input type="number" class="bcfg-price" data-token="${escHtml(k)}" value="${up[k]}" min="0" step="1000" style="width:130px;text-align:right;"></td>
  </tr>`).join("");
  return `<h3>Pengaturan Harga Satuan Budget</h3>
    <div class="hint" style="margin-top:-6px;">${escHtml(DB.budgetConfig.contractNote)} Harga bisa diubah kapan saja kalau ada kontrak/adendum baru.</div>
    <div class="tablewrap" style="max-height:360px;margin-top:10px;">
      <table style="width:100%;border-collapse:collapse;font-size:12.5px;">
        <thead><tr style="border-bottom:1.5px solid var(--gray-300);position:sticky;top:0;background:#fff;"><th style="text-align:left;padding:5px 8px;">Parameter</th><th style="text-align:right;padding:5px 8px;">Harga Satuan (Rp)</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="grid cols-2" style="margin-top:12px;">
      <div class="field"><label>Mobilisasi &amp; Demobilisasi Paket / Semester (Rp)</label><input type="number" id="bcfg_mobpaket" value="${DB.budgetConfig.mobilisasiPaketPerSemester}" min="0" step="100000"></div>
    </div>
    <div class="hint" style="margin-top:6px;">Mobilisasi paket ini otomatis dihitung SEKALI tiap semester yang ada aktivitas sampling (aktual maupun proyeksi) — utk mobilisasi tambahan yang sifatnya provisional, tambahkan lewat "Tambah Biaya Manual" di halaman Budget.</div>
    <div class="actions">
      <button class="btn ghost" data-action="closeModal">Batal</button>
      <button class="btn primary" data-action="saveBudgetConfig">Simpan</button>
    </div>`;
}
function openBudgetConfigModal(){ openModal(budgetConfigModalHtml(), {wide:true}); }
function saveBudgetConfig(){
  document.querySelectorAll(".bcfg-price").forEach(inp=>{
    DB.budgetConfig.unitPrices[inp.dataset.token] = Math.max(0, Number(inp.value)||0);
  });
  DB.budgetConfig.mobilisasiPaketPerSemester = Math.max(0, Number(document.getElementById("bcfg_mobpaket").value)||0);
  save(); closeModal(); renderBudgetPage();
  toast("Pengaturan harga satuan disimpan.", "ok");
}

/* ---------- Export Excel ---------- */
function exportBudgetXlsx(){
  const {periods, rows, costs} = budgetComputeCurrentView();
  const sheetRingkasan = xlsxSheetFromRows(
    ["Periode","Titik Aktual","Titik Proyeksi","Biaya Aktual (Rp)","Biaya Proyeksi (Rp)","Mobilisasi (Rp)","Item Manual (Rp)","Total (Rp)","Total +10% (Rp)","Total +15% (Rp)"],
    rows.map((row,i)=>{
      const c = costs[i];
      return {
        "Periode": row.periode, "Titik Aktual": row.actualPts.length, "Titik Proyeksi": row.projectedPts.length,
        "Biaya Aktual (Rp)": Math.round(c.actualCost), "Biaya Proyeksi (Rp)": Math.round(c.projectedCost),
        "Mobilisasi (Rp)": Math.round(c.mobilisasi), "Item Manual (Rp)": Math.round(c.manual),
        "Total (Rp)": Math.round(c.base), "Total +10% (Rp)": Math.round(budgetApplyMarkup(c.base,10)), "Total +15% (Rp)": Math.round(budgetApplyMarkup(c.base,15))
      };
    })
  );
  const paramTotals = budgetParamTotals(rows);
  const sheetRincian = xlsxSheetFromRows(
    ["Parameter","Jumlah Titik x Kunjungan","Harga Satuan (Rp)","Total Biaya (Rp)"],
    Object.keys(paramTotals).sort((a,b)=>paramTotals[b].cost-paramTotals[a].cost).map(tok=>({
      "Parameter": budgetTokenLabel(tok), "Jumlah Titik x Kunjungan": paramTotals[tok].count,
      "Harga Satuan (Rp)": budgetUnitPrice(tok), "Total Biaya (Rp)": Math.round(paramTotals[tok].cost)
    }))
  );
  const manualInRange = DB.budgetManualItems.filter(m=>periods.includes(m.periode));
  const sheetManual = xlsxSheetFromRows(
    ["Periode","Jenis","Deskripsi","Jumlah","Biaya Satuan (Rp)","Total (Rp)","Catatan"],
    manualInRange.map(m=>({
      "Periode": m.periode, "Jenis": BUDGET_MANUAL_JENIS_LABEL[m.jenis]||m.jenis, "Deskripsi": m.deskripsi,
      "Jumlah": m.jumlah, "Biaya Satuan (Rp)": m.biayaSatuan, "Total (Rp)": m.jumlah*m.biayaSatuan, "Catatan": m.catatan
    }))
  );
  const wb = xlsxWorkbookFromSheets([["Ringkasan per Semester",sheetRingkasan],["Rincian per Parameter",sheetRincian],["Item Biaya Manual",sheetManual]]);
  xlsxDownload(wb, `Budget Proyeksi Biaya_${currentPeriodStr().replace(" ","")}_${todayStr()}.xlsx`);
  toast("Export Excel budget berhasil.", "ok");
}

/* ---------- Render halaman ---------- */
function budgetComputeCurrentView(){
  const semAhead = budgetState.yearsAhead*2;
  const semBack = budgetState.yearsBack*2;
  const nowParts = parsePeriodStr(currentPeriodStr());
  const nowSem = nowParts.year*2 + (nowParts.sem-1);
  const startSem = nowSem - semBack;
  const periods = roadmapPeriodSeq(periodLabel((startSem%2)+1, Math.floor(startSem/2)), semBack+semAhead+1);
  const rows = budgetPeriodRows(periods, semAhead);
  const costs = rows.map(budgetRowCost);
  return {periods, rows, costs};
}
function budgetApplyYearsBack(years){ budgetState.yearsBack = years; renderBudgetPage(); }
function budgetApplyYearsAhead(years){ budgetState.yearsAhead = years; renderBudgetPage(); }
function budgetSetMarkup(pct){ budgetState.markupPct = pct; renderBudgetPage(); }
function renderBudgetPage(){
  const noteEl = document.getElementById("bgtContractNote");
  if(noteEl) noteEl.textContent = DB.budgetConfig.contractNote;
  document.querySelectorAll("[data-action='budgetSetYearsBack']").forEach(b=>b.classList.toggle("active", Number(b.dataset.yearsBack)===budgetState.yearsBack));
  document.querySelectorAll("[data-action='budgetSetYearsAhead']").forEach(b=>b.classList.toggle("active", Number(b.dataset.yearsAhead)===budgetState.yearsAhead));
  document.querySelectorAll("[data-action='budgetSetMarkup']").forEach(b=>b.classList.toggle("active", Number(b.dataset.markup)===budgetState.markupPct));

  const {periods, rows, costs} = budgetComputeCurrentView();
  const nowP = currentPeriodStr();
  const nextP = nextPeriodAfter(nowP, 6);
  const mk = budgetState.markupPct;

  const nowRow = rows.findIndex(r=>r.periode===nowP);
  const nextRow = rows.findIndex(r=>r.periode===nextP);
  const totalAheadCost = costs.reduce((s,c,i)=> periodCompare(parsePeriodStr(rows[i].periode), parsePeriodStr(nowP))>=0 ? s+c.base : s, 0);

  const statCard = (label, value, sub)=>`<div class="card" style="padding:14px 16px;">
    <div class="muted" style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;">${escHtml(label)}</div>
    <div style="font-size:22px;font-weight:800;color:var(--heading);margin-top:4px;font-variant-numeric:tabular-nums;">${fmtRupiahRingkas(value)}</div>
    <div class="muted" style="font-size:11px;margin-top:2px;">${sub}</div>
  </div>`;
  document.getElementById("bgtStatCards").innerHTML = [
    statCard("Semester Ini ("+nowP+")", nowRow>=0?budgetApplyMarkup(costs[nowRow].base,mk):0, nowRow>=0?`${costs[nowRow].actualCost>0?"sebagian sudah aktual · ":""}${rows[nowRow].actualPts.length+rows[nowRow].projectedPts.length} titik`:"tidak ada data"),
    statCard("Semester Depan ("+nextP+")", nextRow>=0?budgetApplyMarkup(costs[nextRow].base,mk):0, nextRow>=0?`estimasi proyeksi · ${rows[nextRow].actualPts.length+rows[nextRow].projectedPts.length} titik`:"di luar rentang Proyeksi terpilih"),
    statCard(`Total ${budgetState.yearsAhead} Tahun ke Depan`, budgetApplyMarkup(totalAheadCost,mk), `${periods.filter(p=>periodCompare(parsePeriodStr(p),parsePeriodStr(nowP))>=0).length} semester${mk?` · markup +${mk}%`:""}`)
  ].join("");

  document.getElementById("bgtChart").innerHTML = buildBudgetChart(rows, costs);
  document.getElementById("bgtChartLegend").innerHTML = budgetChartLegendHtml();

  document.getElementById("bgtTable").innerHTML = `
    <thead><tr>
      <th>Periode</th><th style="text-align:center;">Titik Aktual</th><th style="text-align:center;">Titik Proyeksi</th>
      <th style="text-align:right;">Biaya Sampling</th><th style="text-align:right;">Mobilisasi</th><th style="text-align:right;">Item Manual</th>
      <th style="text-align:right;">Total${mk?` (+${mk}%)`:""}</th>
    </tr></thead>
    <tbody>${rows.map((row,i)=>{
      const c = costs[i];
      const isNow = row.periode===nowP;
      return `<tr style="${isNow?"background:#e6f7f5;":""}">
        <td style="font-weight:${isNow?"800":"400"};">${escHtml(row.periode)}${isNow?' <span class="badge b-teal" style="font-size:9px;">SEKARANG</span>':""}</td>
        <td style="text-align:center;">${row.actualPts.length||"&middot;"}</td>
        <td style="text-align:center;">${row.projectedPts.length||"&middot;"}</td>
        <td style="text-align:right;font-variant-numeric:tabular-nums;">${fmtRupiah(c.actualCost+c.projectedCost)}</td>
        <td style="text-align:right;font-variant-numeric:tabular-nums;" class="muted">${fmtRupiah(c.mobilisasi)}</td>
        <td style="text-align:right;font-variant-numeric:tabular-nums;" class="muted">${fmtRupiah(c.manual)}${c.manualItems.length?` <span title="${c.manualItems.map(m=>escHtml(m.deskripsi)).join('; ')}">(${c.manualItems.length})</span>`:""}</td>
        <td style="text-align:right;font-weight:700;font-variant-numeric:tabular-nums;">${fmtRupiah(budgetApplyMarkup(c.base,mk))}</td>
      </tr>`;
    }).join("")}
    <tr style="border-top:2px solid var(--gray-300);font-weight:800;">
      <td colspan="6" style="text-align:right;">TOTAL (${periods[0]} &ndash; ${periods[periods.length-1]})</td>
      <td style="text-align:right;font-variant-numeric:tabular-nums;">${fmtRupiah(budgetApplyMarkup(costs.reduce((s,c)=>s+c.base,0), mk))}</td>
    </tr></tbody>`;

  const paramTotals = budgetParamTotals(rows);
  const paramTokensSorted = Object.keys(paramTotals).sort((a,b)=>paramTotals[b].cost-paramTotals[a].cost);
  document.getElementById("bgtParamTable").innerHTML = paramTokensSorted.length ? `
    <thead><tr><th>Parameter</th><th style="text-align:center;">Titik &times; Kunjungan</th><th style="text-align:right;">Harga Satuan</th><th style="text-align:right;">Total Biaya</th></tr></thead>
    <tbody>${paramTokensSorted.map(tok=>`<tr>
      <td>${escHtml(budgetTokenLabel(tok))}</td>
      <td style="text-align:center;">${paramTotals[tok].count}</td>
      <td style="text-align:right;" class="muted">${fmtRupiah(budgetUnitPrice(tok))}</td>
      <td style="text-align:right;font-weight:700;">${fmtRupiah(paramTotals[tok].cost)}</td>
    </tr>`).join("")}</tbody>` : `<tbody><tr><td class="hint" style="padding:16px;text-align:center;">Tidak ada titik aktual/proyeksi pada rentang periode ini.</td></tr></tbody>`;

  const manualInRange = DB.budgetManualItems.filter(m=>periods.includes(m.periode)).sort((a,b)=>hasilPeriodParts(a.periode).order-hasilPeriodParts(b.periode).order);
  document.getElementById("bgtManualTable").innerHTML = manualInRange.length ? `
    <thead><tr><th>Periode</th><th>Jenis</th><th>Deskripsi</th><th style="text-align:center;">Jumlah</th><th style="text-align:right;">Satuan</th><th style="text-align:right;">Total</th><th></th></tr></thead>
    <tbody>${manualInRange.map(m=>`<tr>
      <td>${escHtml(m.periode)}</td><td class="muted">${escHtml(BUDGET_MANUAL_JENIS_LABEL[m.jenis]||m.jenis)}</td>
      <td>${escHtml(m.deskripsi||"-")}${m.catatan?`<div class="hint" style="font-size:10.5px;">${escHtml(m.catatan)}</div>`:""}</td>
      <td style="text-align:center;">${m.jumlah}</td><td style="text-align:right;" class="muted">${fmtRupiah(m.biayaSatuan)}</td>
      <td style="text-align:right;font-weight:700;">${fmtRupiah(m.jumlah*m.biayaSatuan)}</td>
      <td style="white-space:nowrap;"><button class="btn small ghost" data-action="editBudgetManualBtn" data-id="${m.id}">Edit</button> <button class="btn small danger" data-action="deleteBudgetManualBtn" data-id="${m.id}">Hapus</button></td>
    </tr>`).join("")}</tbody>` : `<tbody><tr><td class="hint" style="padding:16px;text-align:center;">Belum ada item biaya manual pada rentang periode ini. Klik "Tambah Biaya Manual" utk mobilisasi/teknisi tambahan yang provisional.</td></tr></tbody>`;
}
Object.assign(ACTIONS, {
  budgetSetYearsBack:(t)=>budgetApplyYearsBack(Number(t.dataset.yearsBack)),
  budgetSetYearsAhead:(t)=>budgetApplyYearsAhead(Number(t.dataset.yearsAhead)),
  budgetSetMarkup:(t)=>budgetSetMarkup(Number(t.dataset.markup)),
  openBudgetConfigModal, saveBudgetConfig,
  addBudgetManual,
  editBudgetManualBtn:(t)=>editBudgetManual(t.dataset.id),
  deleteBudgetManualBtn:(t)=>deleteBudgetManual(t.dataset.id),
  saveBudgetManual:(t)=>saveBudgetManual(t.dataset.id),
  exportBudgetXlsx
});
