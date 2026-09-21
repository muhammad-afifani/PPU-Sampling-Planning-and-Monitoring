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

   Gerbang password (budgetUnlocked, module-level — reset tiap reload): SEKADAR penghalang kasual
   sesuai permintaan user, BUKAN keamanan sungguhan — tools ini 100% client-side (HTML/JS statis di
   GitHub Pages, tanpa server/backend), jadi siapapun yang buka file 23-budget-proyeksi.js ini
   langsung lihat passwordnya polos di BUDGET_PASSWORD di bawah, dan seluruh data DB (termasuk
   budgetConfig/budgetManualItems dst) tetap ada di localStorage/file backup JSON terlepas dari
   gerbang ini. Dijelaskan ke user secara eksplisit di respons chat, bukan diam-diam dianggap aman.
========================================================= */
let budgetState = { yearsBack: 0, yearsAhead: 1, markupPct: 0, colorBy: "type", hiddenSeries: new Set(), annualYear: null };
const BUDGET_PASSWORD = "Balikpapan@123";
let budgetUnlocked = false;

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
// Urutan KANONIK persis daftar harga kontrak PHM-SCI yg dikirim user (utk tabel Atur Harga & label
// resmi) — dipakai sbg array acuan urutan (BUKAN Object.keys, supaya urutannya tetap benar walau
// DB.budgetConfig.unitPrices punya sesi lama yg key-nya sempat ke-insert beda urutan). "NOx (Wet
// Method)" SENGAJA tidak dibuatkan key harga sendiri — permintaan user "utk NOx selalu pakai yg
// usepa" berarti token "NOx" cuma dihargai SATU cara (Dry/USEPA), jadi label resminya langsung
// menyebut itu.
const BUDGET_PARAM_ORDER = ["NOx","Total Partikulat","SO2","CO","H2S","Opasitas","ambient","kebisingan","kebauan","getaran","BTEX"];
const BUDGET_PARAM_FULL_LABEL = {
  NOx: "Stacks NOx Sampling as per PerMenLH No. 13/2009 – Dry Method (Method 7, 7E USEPA)",
  "Total Partikulat": "Stacks Particulate Sampling as per PerMenLH No. 13/2009 (Isokinetic)",
  SO2: "Stacks SO2 Sampling as per PerMenLH No. 13/2009",
  CO: "Stacks CO Sampling as per PerMenLH No. 13/2009",
  H2S: "H2S (Sulphur Content in Fuel) by Flue Gas Analyzer",
  Opasitas: "Flares/Stacks Opacity Measurements",
  ambient: "Ambient Monitoring",
  kebisingan: "Noise Monitoring",
  kebauan: "Odor Monitoring — Internal, Tidak Dilaporkan ke Regulator",
  getaran: "Vibration Monitoring (Building) — Internal, Tidak Dilaporkan ke Regulator",
  BTEX: "BTEX Analysis"
};
const BUDGET_PARAM_SHORT_LABEL = {
  NOx:"NOx", "Total Partikulat":"Partikulat", SO2:"SO2", CO:"CO", H2S:"H2S", Opasitas:"Opasitas",
  ambient:"Ambient", kebisingan:"Noise", kebauan:"Odor", getaran:"Getaran", BTEX:"BTEX"
};
function budgetTokenLabel(token, short){
  if(short) return BUDGET_PARAM_SHORT_LABEL[token] || token;
  return BUDGET_PARAM_FULL_LABEL[token] || token;
}
// kebauan/getaran: tetap dibayar ke SCI spt kategori lain (TIDAK ada perbedaan harga/perhitungan) —
// "(Internal)" cuma penanda bahwa keduanya pemantauan internal & tidak masuk pelaporan resmi.
const BUDGET_KATEGORI_LABEL = {emisi:"Emisi", ambient:"Ambient Udara", kebisingan:"Kebisingan", kebauan:"Kebauan/Odor (Internal)", getaran:"Getaran (Internal)"};

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
// Biaya item manual — utk jenis "samplingTambahan" (>1x/sampling ulang), biaya SELALU dihitung ULANG
// dari harga satuan parameter yg SEDANG AKTIF (bukan disimpan statis) — supaya kalau harga di "Atur
// Harga Satuan" diubah belakangan, item tambahan ini otomatis ikut ter-update juga (tetap "ngelink"),
// bukan jadi angka mati yg bisa berbeda dari harga resmi terbaru.
function budgetManualItemCost(m){
  if(m.jenis==="samplingTambahan") return (Number(m.jumlah)||0) * budgetUnitPrice(m.parameterToken);
  return (Number(m.jumlah)||1) * (Number(m.biayaSatuan)||0);
}
function budgetRowCost(row){
  const sumCost = pts => pts.reduce((s,p)=>s+budgetPointCost(p), 0);
  const actualCost = sumCost(row.actualPts);
  const projectedCost = sumCost(row.projectedPts);
  const totalTitik = row.actualPts.length + row.projectedPts.length;
  const mobilisasi = totalTitik>0 ? (Number(DB.budgetConfig.mobilisasiPaketPerSemester)||0) : 0;
  const manualItems = DB.budgetManualItems.filter(m=>m.periode===row.periode);
  const samplingItems = manualItems.filter(m=>m.jenis==="samplingTambahan");
  const genericItems = manualItems.filter(m=>m.jenis!=="samplingTambahan");
  const manualSampling = samplingItems.reduce((s,m)=>s+budgetManualItemCost(m), 0);
  const manualGeneric = genericItems.reduce((s,m)=>s+budgetManualItemCost(m), 0);
  const manual = manualSampling + manualGeneric;
  const base = actualCost + projectedCost + mobilisasi + manual;
  return { actualCost, projectedCost, mobilisasi, manualSampling, manualGeneric, manual, manualItems, samplingItems, genericItems, base, totalTitik };
}
function budgetApplyMarkup(base, pct){ return base * (1 + (Number(pct)||0)/100); }
// Rincian per parameter/kategori, diagregasi lintas SEMUA periode yg ditampilkan (union titik AKTUAL
// + PROYEKSI tiap periode + item manual "samplingTambahan") — dipakai tabel "Rincian Biaya per
// Parameter" & basis breakdown chart per-parameter.
function budgetParamTotals(rows){
  const totals = {};
  const add = (token, count, cost) => { if(!totals[token]) totals[token] = {count:0, cost:0}; totals[token].count+=count; totals[token].cost+=cost; };
  const periodsInRows = new Set(rows.map(r=>r.periode));
  rows.forEach(row=>{
    [...row.actualPts, ...row.projectedPts].forEach(p=>{
      budgetPointBreakdown(p).forEach(({token,price})=>add(token,1,price));
    });
  });
  DB.budgetManualItems.forEach(m=>{
    if(m.jenis!=="samplingTambahan" || !periodsInRows.has(m.periode)) return;
    add(m.parameterToken, Number(m.jumlah)||0, budgetManualItemCost(m));
  });
  return totals;
}
// Minus di depan "Rp" (bukan di antara "Rp" dan angka) — toLocaleString taruh tanda minus nempel ke
// angka, jadi "Rp"+"-500" akan terbaca "Rp-500" yang janggal; sisa budget negatif (over-budget) perlu
// jelas dibaca sbg NEGATIF, bukan disalahartikan nomor kode.
function fmtRupiah(n){
  const neg = n<0;
  return (neg?"-":"") + "Rp" + Math.round(Math.abs(n)).toLocaleString("id-ID");
}
function fmtRupiahRingkas(n){
  const neg = n<0, abs = Math.abs(n);
  if(abs>=1e9) return (neg?"-":"")+"Rp"+(abs/1e9).toFixed(2)+" M";
  if(abs>=1e6) return (neg?"-":"")+"Rp"+(abs/1e6).toFixed(1)+" jt";
  return fmtRupiah(n);
}

/* ---------- Chart batang bertumpuk per semester — warna bisa dipilih mewakili apa ----------
   4 pilihan "warnai berdasarkan": Jenis (Aktual/Proyeksi/dll, default), Site, Parameter, Kategori
   (emisi/ambien/kebisingan/kebauan/getaran). budgetState.hiddenSeries: set key yg lagi disembunyikan
   dari chart (klik legend utk toggle) — SATU set dipakai apapun dimensinya, dikosongkan otomatis
   kalau dimensi warna diganti (supaya tidak nyangkut nyembunyiin key yg sudah tidak relevan).
   Pola sumbu/gridline SAMA dgn buildHasilTrendChart (14-hasil-dashboard.js) supaya konsisten dgn
   chart lain di app ini — warna kategori TETAP (bukan diurut ulang per ranking nilai per periode). */
const BUDGET_TYPE_COLORS = {"Aktual":"#0ea5a0", "Proyeksi":"#e8a33d", "Sampling Tambahan":"#8a5c11", "Mobilisasi & Lainnya":"#94a3b8"};
const BUDGET_KATEGORI_COLORS = {emisi:"#0ea5a0", ambient:"#3d78c9", kebisingan:"#e8a33d", kebauan:"#c2478a", getaran:"#7c5cbf"};
function budgetDimColor(dim, key){
  if(dim==="type") return BUDGET_TYPE_COLORS[key] || "#94a3b8";
  if(dim==="site") return HASIL_SITE_COLORS[key] || "#7f8fa0";
  if(dim==="kategori") return BUDGET_KATEGORI_COLORS[key] || "#94a3b8";
  if(dim==="parameter") return HD_PALETTE[BUDGET_PARAM_ORDER.indexOf(key) % HD_PALETTE.length] || "#94a3b8";
  return "#94a3b8";
}
function budgetDimKeyForPoint(dim, p){
  if(dim==="site") return p.site;
  if(dim==="kategori") return p.kategori==="emisi" ? "emisi" : p.kategori;
  return null; // "parameter" ditangani per-token di pemanggil (1 titik bisa >1 parameter)
}
// Breakdown biaya 1 baris/periode berdasarkan dimensi warna terpilih -> {key: cost}.
function budgetRowBreakdownByDim(row, cost, dim){
  const map = {};
  const add = (k,v) => { if(v<=0) return; map[k] = (map[k]||0)+v; };
  if(dim==="type"){
    add("Aktual", cost.actualCost);
    add("Proyeksi", cost.projectedCost);
    add("Sampling Tambahan", cost.manualSampling);
    add("Mobilisasi & Lainnya", cost.mobilisasi + cost.manualGeneric);
    return map;
  }
  if(dim==="parameter"){
    [...row.actualPts, ...row.projectedPts].forEach(p=>{
      budgetPointBreakdown(p).forEach(({token,price})=>add(token, price));
    });
    cost.samplingItems.forEach(m=>add(m.parameterToken, budgetManualItemCost(m)));
    add("Lainnya (Mobilisasi/Manual)", cost.mobilisasi + cost.manualGeneric);
    return map;
  }
  // site / kategori: berbasis titik
  [...row.actualPts, ...row.projectedPts].forEach(p=>add(budgetDimKeyForPoint(dim,p), budgetPointCost(p)));
  cost.samplingItems.forEach(m=>{
    const p = DB.points.find(x=>x.id===m.titikId);
    if(p) add(budgetDimKeyForPoint(dim,p), budgetManualItemCost(m));
  });
  add(dim==="site" ? "Mobilisasi/Lainnya" : "lainnya", cost.mobilisasi + cost.manualGeneric);
  return map;
}
// Urutan legend TETAP per dimensi (bukan diurut ulang oleh nilai) — dikumpulkan dari SEMUA baris
// yg tampil (union key), supaya urutan warnanya stabil walau proporsinya beda tiap periode.
function budgetDimAllKeys(rows, costs, dim){
  if(dim==="type") return Object.keys(BUDGET_TYPE_COLORS);
  if(dim==="parameter") return [...BUDGET_PARAM_ORDER, "Lainnya (Mobilisasi/Manual)"];
  if(dim==="kategori") return [...Object.keys(BUDGET_KATEGORI_LABEL), "lainnya"];
  const keys = new Set();
  rows.forEach((row,i)=>Object.keys(budgetRowBreakdownByDim(row, costs[i], dim)).forEach(k=>keys.add(k)));
  const sites = [...keys].filter(k=>k!=="Mobilisasi/Lainnya").sort();
  return keys.has("Mobilisasi/Lainnya") ? [...sites, "Mobilisasi/Lainnya"] : sites;
}
function budgetDimKeyLabel(dim, key){
  if(dim==="parameter") return budgetTokenLabel(key, true);
  if(dim==="kategori") return BUDGET_KATEGORI_LABEL[key] || key;
  return key;
}
function buildBudgetChart(rows, costs){
  const dim = budgetState.colorBy;
  const allKeys = budgetDimAllKeys(rows, costs, dim);
  const visibleKeys = allKeys.filter(k=>!budgetState.hiddenSeries.has(k));
  const breakdowns = rows.map((row,i)=>budgetRowBreakdownByDim(row, costs[i], dim));
  const mk = budgetState.markupPct/100;
  const rowTotals = breakdowns.map(bd=> visibleKeys.reduce((s,k)=>s+(bd[k]||0),0) * (1+mk) );

  const W=920, H=340, padL=64, padR=16, padT=18, padB=44;
  const plotW=W-padL-padR, plotH=H-padT-padB;
  const n = rows.length;
  const maxY = Math.max(...rowTotals, 1) * 1.15;
  const nowP = currentPeriodStr();
  function xFor(i){ return padL + (i+0.5)*(plotW/n); }
  let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;font-size:11px;background:var(--surface-card);border:1px solid var(--gray-200);border-radius:10px;">`;
  for(let g=0; g<=4; g++){
    const y = padT + plotH - (g/4)*plotH;
    svg += `<line x1="${padL}" y1="${y}" x2="${W-padR}" y2="${y}" stroke="var(--gray-200)"/>`;
    svg += `<text x="2" y="${y+4}" fill="var(--gray-500)">${fmtRupiahRingkas(maxY*g/4)}</text>`;
  }
  const barW = Math.min(46, (plotW/n)*0.5);
  rows.forEach((row,i)=>{
    const bd = breakdowns[i];
    const cx = xFor(i);
    const yBase = padT+plotH;
    let yCur = yBase, total = 0;
    visibleKeys.forEach(key=>{
      const v = (bd[key]||0)*(1+mk);
      if(v<=0) return;
      const h = (v/maxY)*plotH;
      svg += `<rect class="bgt-chart-seg" data-periode="${escHtml(row.periode)}" data-label="${escHtml(budgetDimKeyLabel(dim,key))}" data-value="${escHtml(fmtRupiah(v))}" x="${cx-barW/2}" y="${yCur-h}" width="${barW}" height="${h}" fill="${budgetDimColor(dim,key)}"/>`;
      yCur -= h; total += v;
    });
    if(total>0) svg += `<text x="${cx}" y="${yCur-5}" text-anchor="middle" font-size="9.5" font-weight="700" fill="var(--gray-700)">${fmtRupiahRingkas(total)}</text>`;
    const isNow = row.periode===nowP;
    svg += `<text x="${cx}" y="${H-padB+16}" text-anchor="middle" font-size="10.5" fill="${isNow?'#0d8a7a':'var(--gray-500)'}" font-weight="${isNow?'800':'400'}">${escHtml(row.periode)}</text>`;
    if(isNow) svg += `<rect x="${cx-plotW/n/2}" y="${padT}" width="${plotW/n}" height="${plotH}" fill="#0ea5a0" opacity="0.06" pointer-events="none"/>`;
  });
  svg += `</svg>`;
  return svg;
}
function budgetChartLegendHtml(rows, costs){
  const dim = budgetState.colorBy;
  const allKeys = budgetDimAllKeys(rows, costs, dim);
  return allKeys.map(key=>{
    const off = budgetState.hiddenSeries.has(key);
    const internalNote = (dim==="kategori" && (key==="kebauan"||key==="getaran")) ? " — dibayar ke SCI spt kategori lain, tapi pemantauan internal & tidak dilaporkan ke regulator" : "";
    return `<span class="bgt-legend-chip${off?" off":""}" data-action="budgetToggleSeries" data-key="${escHtml(key)}" title="Klik utk ${off?"tampilkan":"sembunyikan"}${escHtml(internalNote)}"><span class="sw" style="background:${budgetDimColor(dim,key)}"></span>${escHtml(budgetDimKeyLabel(dim,key))}</span>`;
  }).join("");
}
// Tooltip instan pas hover batang chart — didaftarkan SEKALI di level dokumen (bukan di dalam
// buildBudgetChart) krn innerHTML #bgtChart diganti total tiap re-render, jadi listener langsung di
// elemen <rect> akan hilang; delegasi ke document supaya tetap nempel walau chart di-render ulang.
document.addEventListener("mousemove", e=>{
  const tip = document.getElementById("bgtChartTooltip");
  if(!tip) return;
  const seg = e.target.closest && e.target.closest(".bgt-chart-seg");
  if(!seg){ tip.style.display = "none"; return; }
  tip.innerHTML = `<b>${escHtml(seg.dataset.periode)} &middot; ${escHtml(seg.dataset.label)}</b><br>${escHtml(seg.dataset.value)}`;
  tip.style.display = "block";
  const pad = 14;
  const tipW = tip.offsetWidth || 160;
  let left = e.clientX + pad;
  if(left + tipW > window.innerWidth - 8) left = e.clientX - tipW - pad;
  let top = e.clientY + pad;
  if(top + tip.offsetHeight > window.innerHeight - 8) top = e.clientY - tip.offsetHeight - pad;
  tip.style.left = left + "px";
  tip.style.top = top + "px";
});
document.addEventListener("mouseout", e=>{
  if(!e.target.closest || !e.target.closest(".bgt-chart-seg")) return;
  if(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest(".bgt-chart-seg")) return;
  const tip = document.getElementById("bgtChartTooltip");
  if(tip) tip.style.display = "none";
});
// Tabel PERSIS sesuai apa yg lagi ditampilkan di chart di atasnya — dimensi warna (colorBy) & seri yg
// disembunyikan (hiddenSeries) SAMA dipakai di sini, jadi angka di tabel selalu sinkron sama chart.
function buildBudgetChartDetailTableHtml(rows, costs){
  const dim = budgetState.colorBy;
  const allKeys = budgetDimAllKeys(rows, costs, dim);
  const visibleKeys = allKeys.filter(k=>!budgetState.hiddenSeries.has(k));
  const breakdowns = rows.map((row,i)=>budgetRowBreakdownByDim(row, costs[i], dim));
  const mk = budgetState.markupPct/100;
  if(!visibleKeys.length){
    return `<div class="hint" style="padding:10px;text-align:center;">Semua seri disembunyikan &mdash; klik salah satu chip warna di legend utk menampilkan.</div>`;
  }
  const dimLabel = {type:"Jenis", site:"Site", parameter:"Parameter", kategori:"Kategori"}[dim] || dim;
  let html = `<table style="width:100%;border-collapse:collapse;font-size:11px;">
    <thead><tr>
      <th style="text-align:left;padding:4px 6px;">${escHtml(dimLabel)}</th>
      ${rows.map(r=>`<th style="text-align:right;padding:4px 6px;">${escHtml(r.periode)}</th>`).join("")}
      <th style="text-align:right;padding:4px 6px;font-weight:800;">Total</th>
    </tr></thead><tbody>`;
  visibleKeys.forEach(key=>{
    const vals = breakdowns.map(bd=>(bd[key]||0)*(1+mk));
    const total = vals.reduce((s,v)=>s+v,0);
    html += `<tr>
      <td style="padding:3px 6px;"><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${budgetDimColor(dim,key)};margin-right:5px;"></span>${escHtml(budgetDimKeyLabel(dim,key))}</td>
      ${vals.map(v=>`<td style="text-align:right;padding:3px 6px;font-variant-numeric:tabular-nums;${v<=0?" color:var(--gray-400);":""}">${v>0?fmtRupiah(v):"&middot;"}</td>`).join("")}
      <td style="text-align:right;padding:3px 6px;font-weight:700;font-variant-numeric:tabular-nums;">${fmtRupiah(total)}</td>
    </tr>`;
  });
  const colTotals = rows.map((row,i)=> visibleKeys.reduce((s,k)=>s+(breakdowns[i][k]||0),0) * (1+mk));
  const grandTotal = colTotals.reduce((s,v)=>s+v,0);
  html += `<tr style="border-top:2px solid var(--gray-300);font-weight:800;">
    <td style="padding:4px 6px;">Total${mk?` (+${budgetState.markupPct}%)`:""}</td>
    ${colTotals.map(v=>`<td style="text-align:right;padding:4px 6px;font-variant-numeric:tabular-nums;">${fmtRupiah(v)}</td>`).join("")}
    <td style="text-align:right;padding:4px 6px;font-variant-numeric:tabular-nums;">${fmtRupiah(grandTotal)}</td>
  </tr></tbody></table>`;
  return html;
}

/* ---------- Item biaya manual (mobilisasi tambahan/teknisi/sampling tambahan/lainnya) — CRUD ---------- */
const BUDGET_MANUAL_JENIS_LABEL = {
  mobilisasi: "Mobilization and Demobilization for Additional Sampling (if required/provisional)",
  teknisi: "Technician for Additional Sampling (if required/provisional) – per day",
  samplingTambahan: "Sampling Tambahan/Ulang (>1x) — terhubung ke harga parameter",
  lainnya: "Lainnya"
};
function budgetManualPointOptionsHtml(selectedId){
  const emisi = DB.points.filter(p=>p.kategori==="emisi" && !p.tidakBeroperasi).sort((a,b)=> a.site===b.site?a.nama.localeCompare(b.nama):a.site.localeCompare(b.site));
  return emisi.map(p=>`<option value="${p.id}" ${p.id===selectedId?"selected":""}>${escHtml(p.site)} — ${escHtml(p.nama)} (${escHtml((p.parameter||"").trim())})</option>`).join("");
}
function budgetManualFormHtml(rec){
  rec = rec || {id:"", periode: currentPeriodStr(), jenis:"mobilisasi", deskripsi:"", jumlah:1, biayaSatuan:3850000, catatan:"", titikId:"", parameterToken:"NOx"};
  const isSampling = rec.jenis==="samplingTambahan";
  return `<h3>${rec.id?"Edit":"Tambah"} Item Biaya Manual</h3>
    <div class="hint" style="margin-top:-6px;">Utk biaya "jika diperlukan/provisional" (mobilisasi tambahan, teknisi tambahan, sampling ulang &gt;1x, dll) yang sifatnya per-kejadian — diisi manual, tidak dihitung otomatis dari proyeksi titik.</div>
    <div class="grid cols-2" style="margin-top:10px;">
      <div class="field"><label>Periode</label><input type="text" id="bm_periode" value="${escHtml(rec.periode)}" placeholder="S1 2026"></div>
      <div class="field"><label>Jenis</label><select id="bm_jenis">
        ${Object.keys(BUDGET_MANUAL_JENIS_LABEL).map(k=>`<option value="${k}" ${rec.jenis===k?"selected":""}>${escHtml(BUDGET_MANUAL_JENIS_LABEL[k])}</option>`).join("")}
      </select></div>
    </div>
    <div id="bm_fieldsSampling" style="display:${isSampling?"":"none"};margin-top:10px;">
      <div class="grid cols-2">
        <div class="field"><label>Titik</label><select id="bm_titikId">${budgetManualPointOptionsHtml(rec.titikId)}</select></div>
        <div class="field"><label>Parameter</label><select id="bm_parameterToken">
          ${BUDGET_PARAM_ORDER.filter(t=>!["ambient","kebisingan","kebauan","getaran"].includes(t)).map(t=>`<option value="${t}" ${rec.parameterToken===t?"selected":""}>${escHtml(budgetTokenLabel(t))} (${fmtRupiah(budgetUnitPrice(t))})</option>`).join("")}
        </select></div>
      </div>
      <div class="field" style="margin-top:10px;max-width:220px;"><label>Jumlah Sampling Tambahan (kali)</label><input type="number" id="bm_jumlahSampling" value="${rec.jumlah}" min="1" step="1"></div>
      <div class="hint" style="margin-top:6px;">Biaya dihitung otomatis = jumlah &times; harga satuan parameter yang SEDANG AKTIF di "Atur Harga Satuan" (tetap ter-update kalau harganya berubah belakangan).</div>
    </div>
    <div id="bm_fieldsGeneric" style="display:${isSampling?"none":""};">
      <div class="field" style="margin-top:10px;"><label>Deskripsi</label><input type="text" id="bm_deskripsi" value="${escHtml(rec.deskripsi)}" placeholder="mis. Mobilisasi tambahan sampling ulang GEG 500 BKP"></div>
      <div class="grid cols-2" style="margin-top:10px;">
        <div class="field"><label>Jumlah (trip/hari)</label><input type="number" id="bm_jumlah" value="${rec.jumlah}" min="1" step="1"></div>
        <div class="field"><label>Biaya Satuan (Rp)</label><input type="number" id="bm_biayaSatuan" value="${rec.biayaSatuan}" min="0" step="1000"></div>
      </div>
    </div>
    <div class="field" style="margin-top:10px;"><label>Catatan (opsional)</label><textarea id="bm_catatan" rows="2" style="width:100%;padding:7px 9px;border:1px solid var(--gray-300);border-radius:6px;">${escHtml(rec.catatan)}</textarea></div>
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
// Toggle field generik <-> field sampling tambahan saat Jenis diganti — TIDAK render ulang seluruh
// modal (supaya isian field lain yg sudah diketik tidak hilang), cuma tampilkan/sembunyikan blok.
document.addEventListener("change", e=>{
  if(e.target.id==="bm_jenis"){
    const isSampling = e.target.value==="samplingTambahan";
    const gen = document.getElementById("bm_fieldsGeneric"), samp = document.getElementById("bm_fieldsSampling");
    if(gen) gen.style.display = isSampling ? "none" : "";
    if(samp) samp.style.display = isSampling ? "" : "none";
  }
});
function saveBudgetManual(id){
  const periode = document.getElementById("bm_periode").value.trim();
  if(!parsePeriodStr(periode)){ toast('Format Periode harus "S1 2026" atau "S2 2026".', "err"); return; }
  const jenis = document.getElementById("bm_jenis").value;
  let val;
  if(jenis==="samplingTambahan"){
    const titikId = document.getElementById("bm_titikId").value;
    const p = DB.points.find(x=>x.id===titikId);
    if(!p){ toast("Pilih titik dulu.", "err"); return; }
    const parameterToken = document.getElementById("bm_parameterToken").value;
    const jumlah = Math.max(1, Number(document.getElementById("bm_jumlahSampling").value)||1);
    val = {
      periode, jenis, titikId, parameterToken, jumlah,
      deskripsi: `Sampling tambahan ${budgetTokenLabel(parameterToken,true)} — ${p.nama} (${p.site})`,
      biayaSatuan: null,
      catatan: document.getElementById("bm_catatan").value.trim()
    };
  } else {
    val = {
      periode, jenis,
      deskripsi: document.getElementById("bm_deskripsi").value.trim(),
      jumlah: Math.max(1, Number(document.getElementById("bm_jumlah").value)||1),
      biayaSatuan: Math.max(0, Number(document.getElementById("bm_biayaSatuan").value)||0),
      titikId: "", parameterToken: "",
      catatan: document.getElementById("bm_catatan").value.trim()
    };
  }
  if(id){ Object.assign(DB.budgetManualItems.find(x=>x.id===id), val); }
  else { DB.budgetManualItems.push({id:uid("BGT"), ...val}); }
  save(); closeModal(); renderBudgetPageContent();
  toast(id?"Item biaya diperbarui.":"Item biaya ditambahkan.", "ok");
}
function deleteBudgetManual(id){
  askConfirm("Hapus item biaya manual ini?", ()=>{
    DB.budgetManualItems = DB.budgetManualItems.filter(x=>x.id!==id);
    save(); renderBudgetPageContent(); toast("Item biaya dihapus.", "ok");
  });
}

/* ---------- Pengaturan harga satuan (kontrak PHM-SCI), urutan KANONIK BUDGET_PARAM_ORDER ---------- */
function budgetConfigModalHtml(){
  const up = DB.budgetConfig.unitPrices;
  const rows = BUDGET_PARAM_ORDER.map(k=>`<tr>
    <td style="padding:5px 8px;">${escHtml(budgetTokenLabel(k))}</td>
    <td style="padding:5px 8px;text-align:right;"><input type="number" class="bcfg-price" data-token="${escHtml(k)}" value="${up[k]||0}" min="0" step="1000" style="width:130px;text-align:right;"></td>
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
      <div class="field"><label>Mobilization and Demobilization — Emission and Ambient Monitoring per Semester (Rp)</label><input type="number" id="bcfg_mobpaket" value="${DB.budgetConfig.mobilisasiPaketPerSemester}" min="0" step="100000"></div>
    </div>
    <div class="hint" style="margin-top:6px;">Mobilisasi paket ini otomatis dihitung SEKALI tiap semester yang ada aktivitas sampling (aktual maupun proyeksi) — utk mobilisasi/teknisi tambahan yang sifatnya provisional, tambahkan lewat "Tambah Biaya Manual" di halaman Budget.</div>
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
  save(); closeModal(); renderBudgetPageContent();
  toast("Pengaturan harga satuan disimpan.", "ok");
}

/* ---------- Tabel detail per jenis sampling & peralatan (spt spreadsheet manual user) ----------
   Dikelompokkan: "EMISI <kombinasi parameter>" (mis. "EMISI NOx & CO") -> baris per KATEGORI SUMBER
   (jenis peralatan, p.kategoriSumber — SATU baris bisa mewakili banyak titik sejenis, sama spt
   contoh user), dan kategori non-emisi masing2 jadi grup sendiri (Ambient/Noise/Odor/Vibration) ->
   baris per SITE. Kolom = tiap periode yg lagi ditampilkan (sama dgn tabel Ringkasan). Item manual
   "samplingTambahan" masuk ke subKey yg sama (bukan subKey terpisah spt sebelumnya) supaya muncul
   sbg salah satu baris titik saat di-expand, ditandai tag "Sampling Tambahan".
   Odor (kebauan) & Getaran: TETAP dibayar ke SCI (harga & perhitungan SAMA spt kategori lain, TIDAK
   ada logika khusus) — cuma labelnya ditandai "internal/tidak dilaporkan" krn permintaan user
   ("masuknya pemantauan internal dan tidak dilaporan utk kebauan dan getaran"), bukan exclude biaya. */
function budgetGroupKeyForPoint(p){
  if(p.kategori==="emisi") return "EMISI " + budgetParamTokensForPoint(p).map(t=>budgetTokenLabel(t,true)).join(" & ");
  const labels = {
    ambient: "AMBIENT MONITORING",
    kebisingan: "NOISE MONITORING",
    kebauan: "ODOR MONITORING (INTERNAL, TIDAK DILAPORKAN)",
    getaran: "VIBRATION MONITORING (INTERNAL, TIDAK DILAPORKAN)"
  };
  return labels[p.kategori] || p.kategori.toUpperCase();
}
function budgetSubRowKeyForPoint(p){
  return p.kategori==="emisi" ? (p.kategoriSumber||"Lainnya") : p.site;
}
// groups[g][s] = { periode: [{key,nama,site,cost,tag,jumlah?}, ...] } — array per titik/item (bukan
// angka tunggal) supaya bisa di-drill-down; komposisinya SENGAJA dibiarkan beda2 per periode (tidak
// dipaksa sama), krn titik yg disampling emang bisa beda tiap semester.
function budgetBuildDetailGroups(periods, rows){
  const groups = {};
  let groupOrderCounter = 0;
  const groupOrder = {};
  const ensure = (g,s,periode) => {
    if(!groups[g]){ groups[g] = {}; groupOrder[g] = groupOrderCounter++; }
    if(!groups[g][s]) groups[g][s] = {};
    if(!groups[g][s][periode]) groups[g][s][periode] = [];
    return groups[g][s][periode];
  };
  rows.forEach(row=>{
    row.actualPts.forEach(p=>{
      const g = budgetGroupKeyForPoint(p), s = budgetSubRowKeyForPoint(p);
      ensure(g,s,row.periode).push({key:"pt:"+p.id, nama:p.nama, site:p.site, cost:budgetPointCost(p), tag:"Aktual"});
    });
    row.projectedPts.forEach(p=>{
      const g = budgetGroupKeyForPoint(p), s = budgetSubRowKeyForPoint(p);
      ensure(g,s,row.periode).push({key:"pt:"+p.id, nama:p.nama, site:p.site, cost:budgetPointCost(p), tag:"Proyeksi"});
    });
  });
  const periodSet = new Set(periods);
  DB.budgetManualItems.forEach(m=>{
    if(m.jenis!=="samplingTambahan" || !periodSet.has(m.periode)) return;
    const p = DB.points.find(x=>x.id===m.titikId);
    if(!p) return;
    const g = budgetGroupKeyForPoint(p), s = budgetSubRowKeyForPoint(p);
    ensure(g, s, m.periode).push({key:"manual:"+m.id, nama:p.nama, site:p.site, cost:budgetManualItemCost(m), tag:"Sampling Tambahan", jumlah:m.jumlah});
  });
  return {groups, groupOrder};
}
function budgetCellTotal(cellsByPeriode, periode){
  return (cellsByPeriode[periode]||[]).reduce((s,c)=>s+c.cost, 0);
}
// Ratakan array per-periode jadi satu baris per titik/item unik (key = id fisik, bukan nama, supaya
// aman kalau ada 2 titik kebetulan nama sama) — cells[periode] cuma terisi kalau titik itu ADA
// kontribusi biaya di periode tsb, jadi kolom yg kosong artinya titik itu tidak disampling periode itu.
function budgetDetailPointRows(cellsByPeriode, periods){
  const rowMap = new Map();
  periods.forEach(periode=>{
    (cellsByPeriode[periode]||[]).forEach(c=>{
      if(!rowMap.has(c.key)) rowMap.set(c.key, {nama:c.nama, site:c.site, cells:{}});
      rowMap.get(c.key).cells[periode] = {cost:c.cost, tag:c.tag, jumlah:c.jumlah};
    });
  });
  return [...rowMap.values()].sort((a,b)=> a.nama.localeCompare(b.nama) || a.site.localeCompare(b.site));
}
// Expand/collapse state — module-level, key "groupKey||subKey", TIDAK di-reset tiap re-render (sama
// pola dgn dokFotoExpanded di 17-dokumentasi-foto.js) — toggle-nya cuma re-render #bgtDetailTable
// sendiri (targeted), bukan seluruh halaman.
const budgetDetailExpanded = {};
function budgetToggleDetailRow(key){
  budgetDetailExpanded[key] = !budgetDetailExpanded[key];
  const host = document.getElementById("bgtDetailTable");
  if(!host) return;
  const {periods, rows, costs} = budgetComputeCurrentView();
  host.innerHTML = buildBudgetDetailTableHtml(periods, rows, costs);
}
// forceExpand: dipakai Cetak PDF supaya laporan SELALU tampil rincian penuh per titik, terlepas dari
// status collapse/expand yg lagi aktif di layar (yg mana bisa beda2 per baris tergantung klik user).
function buildBudgetDetailTableHtml(periods, rows, costs, forceExpand){
  const {groups, groupOrder} = budgetBuildDetailGroups(periods, rows);
  const groupKeys = Object.keys(groups).sort((a,b)=>groupOrder[a]-groupOrder[b]);
  let html = `<table style="width:100%;border-collapse:collapse;font-size:11.5px;">
    <thead><tr style="background:var(--navy-900,#1a2942);color:#fff;">
      <th style="text-align:left;padding:6px 8px;min-width:170px;">Jenis Sampling</th>
      <th style="text-align:left;padding:6px 8px;min-width:170px;">Ketentuan Teknis</th>
      ${periods.map(p=>`<th style="text-align:right;padding:6px 8px;">${escHtml(p)}</th>`).join("")}
    </tr></thead><tbody>`;
  if(!groupKeys.length){
    html += `<tr><td colspan="${2+periods.length}" class="hint" style="text-align:center;padding:20px;">Tidak ada titik aktual/proyeksi pada rentang periode ini.</td></tr>`;
  }
  const tagDot = {Aktual:"#0ea5a0", Proyeksi:"#e8a33d", "Sampling Tambahan":"#8a5c11"};
  groupKeys.forEach(g=>{
    const subKeys = Object.keys(groups[g]).sort();
    subKeys.forEach(s=>{
      const cellsByPeriode = groups[g][s];
      const pointRows = budgetDetailPointRows(cellsByPeriode, periods);
      const rowKey = g + "||" + s;
      const expanded = forceExpand || !!budgetDetailExpanded[rowKey];
      const namesList = pointRows.map(r=>r.nama).join(", ") || "-";
      const qtyLabel = ` <span class="muted" style="font-weight:400;">(${pointRows.length} titik)</span>`;
      html += `<tr class="bgt-detail-subrow"${forceExpand?"":` data-action="budgetToggleDetailRow" data-key="${escHtml(rowKey)}" style="cursor:pointer;"`} title="Titik: ${escHtml(namesList)}">
        <td style="padding:4px 8px;" class="muted">${forceExpand?"":`<span style="display:inline-block;width:12px;">${expanded?"&#9662;":"&#9656;"}</span>`}${escHtml(g)}</td>
        <td style="padding:4px 8px;">${escHtml(s)}${qtyLabel}</td>
        ${periods.map(p=>`<td style="text-align:right;padding:4px 8px;font-variant-numeric:tabular-nums;">${fmtRupiah(budgetCellTotal(cellsByPeriode,p))}</td>`).join("")}</tr>`;
      if(expanded){
        pointRows.forEach(pr=>{
          html += `<tr class="bgt-detail-pointrow"><td></td><td style="padding:3px 8px 3px 22px;font-size:10.5px;" class="muted">${escHtml(pr.nama)} <span style="opacity:.7;">&middot; ${escHtml(pr.site)}</span></td>
            ${periods.map(p=>{
              const c = pr.cells[p];
              if(!c) return `<td style="text-align:right;padding:3px 8px;color:var(--gray-400);">&middot;</td>`;
              return `<td style="text-align:right;padding:3px 8px;font-variant-numeric:tabular-nums;font-size:10.5px;" title="${escHtml(c.tag)}${c.jumlah?" &times;"+c.jumlah:""}"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${tagDot[c.tag]||"#94a3b8"};margin-right:4px;"></span>${fmtRupiah(c.cost)}</td>`;
            }).join("")}</tr>`;
        });
      }
    });
    const groupTotal = periods.map(p=> subKeys.reduce((s,sk)=>s+budgetCellTotal(groups[g][sk],p), 0));
    html += `<tr style="background:var(--gray-100);font-weight:700;"><td colspan="2" style="padding:4px 8px;">${escHtml(g)} Total</td>
      ${groupTotal.map(v=>`<td style="text-align:right;padding:4px 8px;font-variant-numeric:tabular-nums;">${fmtRupiah(v)}</td>`).join("")}</tr>`;
  });
  // Mobilisasi paket per periode
  html += `<tr><td colspan="2" style="padding:4px 8px;font-weight:700;">Mobilization and Demobilization (Package, per Semester)</td>
    ${costs.map(c=>`<td style="text-align:right;padding:4px 8px;font-variant-numeric:tabular-nums;">${fmtRupiah(c.mobilisasi)}</td>`).join("")}</tr>`;
  // Item manual generik (mobilisasi tambahan/teknisi/lainnya), dikelompokkan per jenis
  ["mobilisasi","teknisi","lainnya"].forEach(jenis=>{
    const anyThisJenis = costs.some(c=>c.genericItems.some(m=>m.jenis===jenis));
    if(!anyThisJenis) return;
    html += `<tr><td colspan="2" style="padding:4px 8px;font-weight:700;">${escHtml(BUDGET_MANUAL_JENIS_LABEL[jenis])}</td>
      ${costs.map(c=>`<td style="text-align:right;padding:4px 8px;font-variant-numeric:tabular-nums;">${fmtRupiah(c.genericItems.filter(m=>m.jenis===jenis).reduce((s,m)=>s+budgetManualItemCost(m),0))}</td>`).join("")}</tr>`;
  });
  const grandTotal = costs.map(c=>c.base);
  html += `<tr style="border-top:2px solid var(--gray-400);font-weight:800;background:#fff7cc;"><td colspan="2" style="padding:6px 8px;">Grand Total</td>
    ${grandTotal.map(v=>`<td style="text-align:right;padding:6px 8px;font-variant-numeric:tabular-nums;">${fmtRupiah(v)}</td>`).join("")}</tr></tbody></table>
  <div class="hint" style="font-size:10.5px;margin-top:6px;">Catatan: Ambient, Noise, Odor (Kebauan) &amp; Getaran seluruhnya tetap dibayar ke SCI sesuai kontrak. Namun Odor (Kebauan) dan Getaran adalah pemantauan <b>internal</b> dan <b>tidak termasuk pelaporan resmi</b> ke regulator.</div>`;
  return html;
}

/* ---------- Budget Tahunan: alokasi vs terserap vs pengeluaran lain ----------
   "Terserap" = biaya AKTUAL SAJA (titik yg beneran sudah ada hasil + mobilisasi periode itu + item
   manual periode itu) — proyeksi TIDAK dihitung sbg sudah terserap (masih estimasi, belum tentu
   kejadian), konsisten dgn prinsip Aktual/Proyeksi yg dipakai di seluruh halaman ini. */
function budgetYearActualSpend(year){
  const periods = [periodLabel(1,year), periodLabel(2,year)];
  let samplingCost = 0, mobilisasi = 0, manualGeneric = 0, manualSampling = 0;
  periods.forEach(per=>{
    const actualPts = budgetActualPointsForPeriod(per);
    samplingCost += actualPts.reduce((s,p)=>s+budgetPointCost(p), 0);
    if(actualPts.length) mobilisasi += Number(DB.budgetConfig.mobilisasiPaketPerSemester)||0;
    DB.budgetManualItems.filter(m=>m.periode===per).forEach(m=>{
      if(m.jenis==="samplingTambahan") manualSampling += budgetManualItemCost(m);
      else manualGeneric += budgetManualItemCost(m);
    });
  });
  const expenses = DB.budgetExpenses.filter(e=>Number(e.tahun)===year).reduce((s,e)=>s+(Number(e.jumlah)||0), 0);
  const total = samplingCost + mobilisasi + manualGeneric + manualSampling + expenses;
  return {samplingCost, mobilisasi, manualGeneric, manualSampling, expenses, total};
}
function budgetExpenseFormHtml(rec){
  rec = rec || {id:"", tahun: new Date().getFullYear(), deskripsi:"", jumlah:0, tanggal: todayStr(), kategori:"Peralatan"};
  return `<h3>${rec.id?"Edit":"Tambah"} Pengeluaran Lain</h3>
    <div class="hint" style="margin-top:-6px;">Pengeluaran di luar biaya sampling (mis. beli kamera anti-ATEX, alat pelindung, dll) yang ikut mengurangi budget tahunan.</div>
    <div class="grid cols-2" style="margin-top:10px;">
      <div class="field"><label>Tahun</label><input type="number" id="be_tahun" value="${rec.tahun}" min="2020" max="2100" step="1"></div>
      <div class="field"><label>Tanggal</label><input type="date" id="be_tanggal" value="${escHtml(rec.tanggal)}"></div>
    </div>
    <div class="field" style="margin-top:10px;"><label>Deskripsi</label><input type="text" id="be_deskripsi" value="${escHtml(rec.deskripsi)}" placeholder="mis. Kamera anti-ATEX untuk area Flare"></div>
    <div class="grid cols-2" style="margin-top:10px;">
      <div class="field"><label>Kategori</label><input type="text" id="be_kategori" value="${escHtml(rec.kategori)}" placeholder="mis. Peralatan, APD, Pelatihan"></div>
      <div class="field"><label>Jumlah (Rp)</label><input type="number" id="be_jumlah" value="${rec.jumlah}" min="0" step="10000"></div>
    </div>
    <div class="actions">
      <button class="btn ghost" data-action="closeModal">Batal</button>
      <button class="btn primary" data-action="saveBudgetExpense" data-id="${rec.id}">Simpan</button>
    </div>`;
}
function addBudgetExpense(){ openModal(budgetExpenseFormHtml(null)); }
function editBudgetExpense(id){ const r = DB.budgetExpenses.find(x=>x.id===id); if(r) openModal(budgetExpenseFormHtml(r)); }
function saveBudgetExpense(id){
  const val = {
    tahun: Number(document.getElementById("be_tahun").value)||new Date().getFullYear(),
    tanggal: document.getElementById("be_tanggal").value,
    deskripsi: document.getElementById("be_deskripsi").value.trim(),
    kategori: document.getElementById("be_kategori").value.trim()||"Lainnya",
    jumlah: Math.max(0, Number(document.getElementById("be_jumlah").value)||0)
  };
  if(!val.deskripsi){ toast("Deskripsi wajib diisi.", "err"); return; }
  if(id){ Object.assign(DB.budgetExpenses.find(x=>x.id===id), val); }
  else { DB.budgetExpenses.push({id:uid("BGE"), ...val}); }
  save(); closeModal(); renderBudgetAnnualSection();
  toast(id?"Pengeluaran diperbarui.":"Pengeluaran ditambahkan.", "ok");
}
function deleteBudgetExpense(id){
  askConfirm("Hapus catatan pengeluaran ini?", ()=>{
    DB.budgetExpenses = DB.budgetExpenses.filter(x=>x.id!==id);
    save(); renderBudgetAnnualSection(); toast("Pengeluaran dihapus.", "ok");
  });
}
function budgetAllocFormHtml(year){
  const cur = DB.budgetAnnual[year] || {allocated:0, catatan:""};
  return `<h3>Atur Alokasi Budget Tahun ${year}</h3>
    <div class="field" style="margin-top:10px;"><label>Alokasi Budget (Rp)</label><input type="number" id="ba_allocated" value="${cur.allocated}" min="0" step="1000000"></div>
    <div class="field" style="margin-top:10px;"><label>Catatan (opsional)</label><textarea id="ba_catatan" rows="2" style="width:100%;padding:7px 9px;border:1px solid var(--gray-300);border-radius:6px;">${escHtml(cur.catatan||"")}</textarea></div>
    <div class="actions">
      <button class="btn ghost" data-action="closeModal">Batal</button>
      <button class="btn primary" data-action="saveBudgetAlloc" data-year="${year}">Simpan</button>
    </div>`;
}
function openBudgetAllocModal(year){ openModal(budgetAllocFormHtml(year)); }
function saveBudgetAlloc(year){
  year = Number(year);
  DB.budgetAnnual[year] = {
    allocated: Math.max(0, Number(document.getElementById("ba_allocated").value)||0),
    catatan: document.getElementById("ba_catatan").value.trim()
  };
  save(); closeModal(); renderBudgetAnnualSection();
  toast(`Alokasi budget ${year} disimpan.`, "ok");
}
function budgetYearGaugeHtml(year){
  const alloc = (DB.budgetAnnual[year]||{}).allocated||0;
  const spend = budgetYearActualSpend(year);
  const pct = alloc>0 ? Math.min(999, Math.round(spend.total/alloc*100)) : 0;
  const barColor = pct>100 ? "#a02a24" : pct>85 ? "#e8a33d" : "#0ea5a0";
  const sisa = alloc - spend.total;
  return `<div class="card" style="padding:14px 16px;">
    <div style="display:flex;justify-content:space-between;align-items:baseline;">
      <div class="muted" style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;">Tahun ${year}${year===new Date().getFullYear()?' <span class="badge b-teal" style="font-size:9px;">AKTIF</span>':""}</div>
      <button class="btn small ghost" data-action="openBudgetAllocModalBtn" data-year="${year}">Atur Alokasi</button>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:6px;">
      <div><span class="muted" style="font-size:11px;">Alokasi</span><div style="font-size:18px;font-weight:800;">${fmtRupiahRingkas(alloc)}</div></div>
      <div style="text-align:right;"><span class="muted" style="font-size:11px;">Terserap</span><div style="font-size:18px;font-weight:800;color:${barColor};">${fmtRupiahRingkas(spend.total)}</div></div>
    </div>
    <div class="progressbar" style="margin-top:8px;"><div style="width:${Math.min(100,pct)}%;background:${barColor};"></div></div>
    <div class="hint" style="margin-top:6px;display:flex;justify-content:space-between;">
      <span>${pct}% terpakai</span><span>Sisa: ${fmtRupiahRingkas(sisa)}</span>
    </div>
    <div class="hint" style="margin-top:8px;font-size:10.5px;">Sampling: ${fmtRupiah(spend.samplingCost)} &middot; Mobilisasi: ${fmtRupiah(spend.mobilisasi)} &middot; Manual: ${fmtRupiah(spend.manualGeneric+spend.manualSampling)} &middot; Pengeluaran Lain: ${fmtRupiah(spend.expenses)}</div>
  </div>`;
}
function renderBudgetAnnualSection(){
  const host = document.getElementById("bgtAnnualCards");
  if(!host) return;
  const curYear = new Date().getFullYear();
  const years = [...new Set([curYear, curYear+1, ...Object.keys(DB.budgetAnnual).map(Number)])].sort((a,b)=>a-b).filter(y=>y>=curYear-1 && y<=curYear+2);
  host.innerHTML = years.map(budgetYearGaugeHtml).join("");
  const expenses = DB.budgetExpenses.slice().sort((a,b)=>(b.tanggal||"").localeCompare(a.tanggal||""));
  document.getElementById("bgtExpenseTable").innerHTML = expenses.length ? `
    <thead><tr><th>Tahun</th><th>Tanggal</th><th>Kategori</th><th>Deskripsi</th><th style="text-align:right;">Jumlah</th><th></th></tr></thead>
    <tbody>${expenses.map(e=>`<tr>
      <td>${e.tahun}</td><td class="muted">${escHtml(e.tanggal||"-")}</td><td>${escHtml(e.kategori)}</td><td>${escHtml(e.deskripsi)}</td>
      <td style="text-align:right;font-weight:700;">${fmtRupiah(e.jumlah)}</td>
      <td style="white-space:nowrap;"><button class="btn small ghost" data-action="editBudgetExpenseBtn" data-id="${e.id}">Edit</button> <button class="btn small danger" data-action="deleteBudgetExpenseBtn" data-id="${e.id}">Hapus</button></td>
    </tr>`).join("")}</tbody>` : `<tbody><tr><td class="hint" style="padding:16px;text-align:center;">Belum ada catatan pengeluaran lain. Klik "Tambah Pengeluaran" utk peralatan/APD/dll yang ikut mengurangi budget tahunan.</td></tr></tbody>`;
}

/* ---------- Export Excel ---------- */
function exportBudgetXlsx(){
  const {periods, rows, costs} = budgetComputeCurrentView();
  const mk = budgetState.markupPct;
  const sheetRingkasan = xlsxSheetFromRows(
    ["Periode","Titik Aktual","Titik Proyeksi","Biaya Aktual (Rp)","Biaya Proyeksi (Rp)","Mobilisasi (Rp)","Sampling Tambahan (Rp)","Item Manual Lain (Rp)","Total (Rp)",`Total +${mk}% (Rp)`],
    rows.map((row,i)=>{
      const c = costs[i];
      return {
        "Periode": row.periode, "Titik Aktual": row.actualPts.length, "Titik Proyeksi": row.projectedPts.length,
        "Biaya Aktual (Rp)": Math.round(c.actualCost), "Biaya Proyeksi (Rp)": Math.round(c.projectedCost),
        "Mobilisasi (Rp)": Math.round(c.mobilisasi), "Sampling Tambahan (Rp)": Math.round(c.manualSampling), "Item Manual Lain (Rp)": Math.round(c.manualGeneric),
        "Total (Rp)": Math.round(c.base), [`Total +${mk}% (Rp)`]: Math.round(budgetApplyMarkup(c.base,mk))
      };
    })
  );
  const paramTotals = budgetParamTotals(rows);
  const sheetRincian = xlsxSheetFromRows(
    ["Parameter","Jumlah Titik x Kunjungan","Harga Satuan (Rp)","Total Biaya (Rp)"],
    BUDGET_PARAM_ORDER.filter(tok=>paramTotals[tok]).map(tok=>({
      "Parameter": budgetTokenLabel(tok), "Jumlah Titik x Kunjungan": paramTotals[tok].count,
      "Harga Satuan (Rp)": budgetUnitPrice(tok), "Total Biaya (Rp)": Math.round(paramTotals[tok].cost)
    }))
  );
  const {groups, groupOrder} = budgetBuildDetailGroups(periods, rows);
  const detailRows = [];
  Object.keys(groups).sort((a,b)=>groupOrder[a]-groupOrder[b]).forEach(g=>{
    Object.keys(groups[g]).sort().forEach(s=>{
      const cellsByPeriode = groups[g][s];
      const pointRows = budgetDetailPointRows(cellsByPeriode, periods);
      const r = {"Jenis Sampling": g, "Ketentuan Teknis": `${s} (${pointRows.length} titik)`};
      periods.forEach(p=>{ r[p] = Math.round(budgetCellTotal(cellsByPeriode, p)); });
      detailRows.push(r);
      pointRows.forEach(pr=>{
        const rr = {"Jenis Sampling": "", "Ketentuan Teknis": `   - ${pr.nama} (${pr.site})`};
        periods.forEach(p=>{ rr[p] = pr.cells[p] ? Math.round(pr.cells[p].cost) : ""; });
        detailRows.push(rr);
      });
    });
  });
  const sheetDetail = xlsxSheetFromRows(["Jenis Sampling","Ketentuan Teknis",...periods], detailRows);
  const manualInRange = DB.budgetManualItems.filter(m=>periods.includes(m.periode));
  const sheetManual = xlsxSheetFromRows(
    ["Periode","Jenis","Deskripsi","Jumlah","Biaya Satuan (Rp)","Total (Rp)","Catatan"],
    manualInRange.map(m=>({
      "Periode": m.periode, "Jenis": BUDGET_MANUAL_JENIS_LABEL[m.jenis]||m.jenis, "Deskripsi": m.deskripsi,
      "Jumlah": m.jumlah, "Biaya Satuan (Rp)": m.jenis==="samplingTambahan"?budgetUnitPrice(m.parameterToken):m.biayaSatuan,
      "Total (Rp)": Math.round(budgetManualItemCost(m)), "Catatan": m.catatan
    }))
  );
  const sheetAnnual = xlsxSheetFromRows(
    ["Tahun","Alokasi (Rp)","Terserap (Rp)","Sisa (Rp)","Catatan"],
    Object.keys(DB.budgetAnnual).map(Number).sort().map(year=>{
      const spend = budgetYearActualSpend(year);
      return { "Tahun": year, "Alokasi (Rp)": DB.budgetAnnual[year].allocated, "Terserap (Rp)": Math.round(spend.total), "Sisa (Rp)": Math.round(DB.budgetAnnual[year].allocated-spend.total), "Catatan": DB.budgetAnnual[year].catatan||"" };
    })
  );
  const wb = xlsxWorkbookFromSheets([["Ringkasan per Semester",sheetRingkasan],["Rincian per Parameter",sheetRincian],["Detail per Jenis & Peralatan",sheetDetail],["Item Biaya Manual",sheetManual],["Budget Tahunan",sheetAnnual]]);
  xlsxDownload(wb, `Budget Proyeksi Biaya_${currentPeriodStr().replace(" ","")}_${todayStr()}.xlsx`);
  toast("Export Excel budget berhasil.", "ok");
}

/* ---------- Export PDF (print) — reuse pola cetak yg sama dgn laporan lain (setPrintOrientation +
   #printGuideArea + window.print(), lihat printBeritaAcara/doPrintDispersiReport). ---------- */
function buildBudgetReportHtml(){
  const {periods, rows, costs} = budgetComputeCurrentView();
  const mk = budgetState.markupPct;
  const grandBase = costs.reduce((s,c)=>s+c.base,0);
  return `<div class="pg-batch">
    <div style="text-align:center;margin-bottom:14px;padding-bottom:8px;border-bottom:1.5px solid #333;">
      <h1 style="font-size:15px;margin:0 0 3px;letter-spacing:.03em;">LAPORAN BUDGET &amp; PROYEKSI BIAYA SAMPLING</h1>
      <div style="font-size:11px;font-weight:700;">PT Pertamina Hulu Mahakam &mdash; Periode ${periods[0]} s/d ${periods[periods.length-1]}</div>
      <div style="font-size:10px;margin-top:2px;">${escHtml(DB.budgetConfig.contractNote)}</div>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:10px;margin-bottom:16px;">
      <thead><tr style="background:#1a2942;color:#fff;">
        <th style="border:1px solid #999;padding:5px 6px;">Periode</th><th style="border:1px solid #999;padding:5px 6px;">Titik Aktual</th><th style="border:1px solid #999;padding:5px 6px;">Titik Proyeksi</th>
        <th style="border:1px solid #999;padding:5px 6px;">Biaya Sampling</th><th style="border:1px solid #999;padding:5px 6px;">Mobilisasi</th><th style="border:1px solid #999;padding:5px 6px;">Item Manual</th>
        <th style="border:1px solid #999;padding:5px 6px;">Total</th>${mk?`<th style="border:1px solid #999;padding:5px 6px;">Total +${mk}%</th>`:""}
      </tr></thead>
      <tbody>${rows.map((row,i)=>{ const c=costs[i]; return `<tr>
        <td style="border:1px solid #999;padding:4px 6px;text-align:center;">${row.periode}</td>
        <td style="border:1px solid #999;padding:4px 6px;text-align:center;">${row.actualPts.length}</td>
        <td style="border:1px solid #999;padding:4px 6px;text-align:center;">${row.projectedPts.length}</td>
        <td style="border:1px solid #999;padding:4px 6px;text-align:right;">${fmtRupiah(c.actualCost+c.projectedCost)}</td>
        <td style="border:1px solid #999;padding:4px 6px;text-align:right;">${fmtRupiah(c.mobilisasi)}</td>
        <td style="border:1px solid #999;padding:4px 6px;text-align:right;">${fmtRupiah(c.manual)}</td>
        <td style="border:1px solid #999;padding:4px 6px;text-align:right;font-weight:700;">${fmtRupiah(c.base)}</td>
        ${mk?`<td style="border:1px solid #999;padding:4px 6px;text-align:right;font-weight:700;">${fmtRupiah(budgetApplyMarkup(c.base,mk))}</td>`:""}
      </tr>`; }).join("")}
      <tr style="font-weight:800;"><td colspan="6" style="border:1px solid #999;padding:5px 6px;text-align:right;">GRAND TOTAL</td>
        <td style="border:1px solid #999;padding:5px 6px;text-align:right;">${fmtRupiah(grandBase)}</td>
        ${mk?`<td style="border:1px solid #999;padding:5px 6px;text-align:right;">${fmtRupiah(budgetApplyMarkup(grandBase,mk))}</td>`:""}
      </tr></tbody>
    </table>
    <div style="font-size:11px;font-weight:700;margin-bottom:6px;">Rincian Detail per Jenis Sampling &amp; Peralatan</div>
    ${buildBudgetDetailTableHtml(periods, rows, costs, true).replace(/font-size:11.5px;/,"font-size:9.5px;").replace(/padding:6px 8px;/g,"padding:4px 5px;").replace(/<table /,'<table style="border:1px solid #999;" ')}
  </div>`;
}
function printBudgetReport(){
  const html = buildBudgetReportHtml();
  setPrintOrientation("landscape", 12);
  document.getElementById("printGuideArea").innerHTML = html;
  const originalTitle = document.title;
  document.title = `Budget Proyeksi Biaya_${currentPeriodStr().replace(" ","")}`;
  window.print();
  document.title = originalTitle;
}

/* ---------- Render halaman + gerbang password ---------- */
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
function budgetApplyYearsBack(years){ budgetState.yearsBack = years; renderBudgetPageContent(); }
function budgetApplyYearsAhead(years){ budgetState.yearsAhead = years; renderBudgetPageContent(); }
function budgetSetMarkup(pct){ budgetState.markupPct = pct; renderBudgetPageContent(); }
function budgetApplyCustomMarkup(){
  const v = Number(document.getElementById("bgtCustomMarkup").value);
  if(!isFinite(v) || v<0){ toast("Markup harus angka ≥ 0.", "err"); return; }
  budgetState.markupPct = v;
  renderBudgetPageContent();
}
function budgetSetColorBy(dim){
  budgetState.colorBy = dim;
  budgetState.hiddenSeries = new Set();
  renderBudgetPageContent();
}
function budgetToggleSeries(key){
  if(budgetState.hiddenSeries.has(key)) budgetState.hiddenSeries.delete(key);
  else budgetState.hiddenSeries.add(key);
  renderBudgetPageContent();
}
function renderBudgetPage(){
  const lock = document.getElementById("bgtLockScreen"), content = document.getElementById("bgtContent");
  if(!lock || !content) return;
  if(!budgetUnlocked){
    lock.style.display = "";
    content.style.display = "none";
    const pwInput = document.getElementById("bgtPasswordInput");
    if(pwInput){ pwInput.value = ""; setTimeout(()=>pwInput.focus(), 50); }
    return;
  }
  lock.style.display = "none";
  content.style.display = "";
  renderBudgetPageContent();
}
function budgetTryUnlock(){
  const val = document.getElementById("bgtPasswordInput").value;
  if(val === BUDGET_PASSWORD){
    budgetUnlocked = true;
    document.getElementById("bgtLockScreen").style.display = "none";
    document.getElementById("bgtContent").style.display = "";
    renderBudgetPageContent();
  } else {
    toast("Password salah.", "err");
    const pwInput = document.getElementById("bgtPasswordInput");
    if(pwInput){ pwInput.value = ""; pwInput.focus(); }
  }
}
document.addEventListener("keydown", e=>{
  if(e.key==="Enter" && e.target && e.target.id==="bgtPasswordInput") budgetTryUnlock();
});
function renderBudgetPageContent(){
  if(!budgetUnlocked) return;
  const noteEl = document.getElementById("bgtContractNote");
  if(noteEl) noteEl.textContent = DB.budgetConfig.contractNote;
  document.querySelectorAll("[data-action='budgetSetYearsBack']").forEach(b=>b.classList.toggle("active", Number(b.dataset.yearsBack)===budgetState.yearsBack));
  document.querySelectorAll("[data-action='budgetSetYearsAhead']").forEach(b=>b.classList.toggle("active", Number(b.dataset.yearsAhead)===budgetState.yearsAhead));
  document.querySelectorAll("[data-action='budgetSetMarkup']").forEach(b=>b.classList.toggle("active", Number(b.dataset.markup)===budgetState.markupPct));
  document.querySelectorAll("[data-action='budgetSetColorBy']").forEach(b=>b.classList.toggle("active", b.dataset.colorBy===budgetState.colorBy));

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
  document.getElementById("bgtChartLegend").innerHTML = budgetChartLegendHtml(rows, costs);
  const chartDetailHost = document.getElementById("bgtChartDetailTable");
  if(chartDetailHost) chartDetailHost.innerHTML = buildBudgetChartDetailTableHtml(rows, costs);

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
      <td>${escHtml(m.periode)}</td><td class="muted" style="font-size:10.5px;">${escHtml(BUDGET_MANUAL_JENIS_LABEL[m.jenis]||m.jenis)}</td>
      <td>${escHtml(m.deskripsi||"-")}${m.catatan?`<div class="hint" style="font-size:10.5px;">${escHtml(m.catatan)}</div>`:""}</td>
      <td style="text-align:center;">${m.jumlah}</td><td style="text-align:right;" class="muted">${fmtRupiah(m.jenis==="samplingTambahan"?budgetUnitPrice(m.parameterToken):m.biayaSatuan)}</td>
      <td style="text-align:right;font-weight:700;">${fmtRupiah(budgetManualItemCost(m))}</td>
      <td style="white-space:nowrap;"><button class="btn small ghost" data-action="editBudgetManualBtn" data-id="${m.id}">Edit</button> <button class="btn small danger" data-action="deleteBudgetManualBtn" data-id="${m.id}">Hapus</button></td>
    </tr>`).join("")}</tbody>` : `<tbody><tr><td class="hint" style="padding:16px;text-align:center;">Belum ada item biaya manual pada rentang periode ini. Klik "Tambah Biaya Manual" utk mobilisasi/teknisi/sampling tambahan yang provisional.</td></tr></tbody>`;

  const detailHost = document.getElementById("bgtDetailTable");
  if(detailHost) detailHost.innerHTML = buildBudgetDetailTableHtml(periods, rows, costs);

  renderBudgetAnnualSection();
}
Object.assign(ACTIONS, {
  budgetTryUnlock,
  budgetSetYearsBack:(t)=>budgetApplyYearsBack(Number(t.dataset.yearsBack)),
  budgetSetYearsAhead:(t)=>budgetApplyYearsAhead(Number(t.dataset.yearsAhead)),
  budgetSetMarkup:(t)=>budgetSetMarkup(Number(t.dataset.markup)),
  budgetApplyCustomMarkup,
  budgetSetColorBy:(t)=>budgetSetColorBy(t.dataset.colorBy),
  budgetToggleSeries:(t)=>budgetToggleSeries(t.dataset.key),
  budgetToggleDetailRow:(t)=>budgetToggleDetailRow(t.dataset.key),
  openBudgetConfigModal, saveBudgetConfig,
  addBudgetManual,
  editBudgetManualBtn:(t)=>editBudgetManual(t.dataset.id),
  deleteBudgetManualBtn:(t)=>deleteBudgetManual(t.dataset.id),
  saveBudgetManual:(t)=>saveBudgetManual(t.dataset.id),
  addBudgetExpense,
  editBudgetExpenseBtn:(t)=>editBudgetExpense(t.dataset.id),
  deleteBudgetExpenseBtn:(t)=>deleteBudgetExpense(t.dataset.id),
  saveBudgetExpense:(t)=>saveBudgetExpense(t.dataset.id),
  openBudgetAllocModalBtn:(t)=>openBudgetAllocModal(t.dataset.year),
  saveBudgetAlloc:(t)=>saveBudgetAlloc(t.dataset.year),
  exportBudgetXlsx,
  printBudgetReport
});
