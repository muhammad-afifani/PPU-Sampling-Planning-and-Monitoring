/* =========================================================
   DASHBOARD
========================================================= */
// Ikon kecil di kartu "Peringatan" — SATU bentuk (segitiga seru) utk semua sumber peringatan
// (dokumen personil, titik gagal, emergency engine dst — subjeknya beda2, lihat renderDashboard),
// tingkat keparahannya sudah dibedakan lewat warna tint kartu (.dash-alert.sev-* di style.css) +
// warna ikon ini sendiri (currentColor ikut warna itu) — bukan lewat ganti bentuk per subjek, supaya
// tidak menyiratkan makna yang salah (mis. ikon orang dipakai utk peringatan titik/mesin).
function dashAlertIcon(){
  return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path><line x1="12" x2="12" y1="9" y2="13"></line><line x1="12" x2="12.01" y1="17" y2="17"></line></svg>`;
}
function renderDashboard(){
  const pts = DB.points;
  const period = currentPeriodStr();
  const wajib = pts.filter(p=>effectiveWajib(p, period));
  const done = wajib.filter(p=>p.status==="done");
  const scheduled = wajib.filter(p=>p.status==="scheduled");
  const failed = wajib.filter(p=>p.status==="failed");
  const pct = wajib.length? Math.round(done.length/wajib.length*100):0;
  const emgTriggered = pts.filter(p=>wajibReason(p, period).type==="emergency-triggered");

  const statCards = [
    `<div class="stat"><div class="num">${wajib.length}</div><div class="lbl">Titik Wajib Pantau · ${escHtml(period)}</div></div>`,
    `<div class="stat good"><div class="num">${pct}%</div><div class="lbl">Progress Selesai (${done.length}/${wajib.length})</div></div>`,
    `<div class="stat warn"><div class="num">${scheduled.length}</div><div class="lbl">Terjadwal, Belum Sampling</div></div>`,
    `<div class="stat ${failed.length?"bad":"good"}"><div class="num">${failed.length}</div><div class="lbl">Gagal / Lanjut Batch</div></div>`,
  ];
  if(emgTriggered.length){
    statCards.push(`<div class="stat bad"><div class="num">${emgTriggered.length}</div><div class="lbl">Emergency Engine RH&gt;200 jam · Wajib Pantau</div></div>`);
  }
  // Jumlah kolom grid = jumlah kartu (4 atau 5 kalau kartu Emergency ikut muncul) — dipasang lewat
  // JS (bukan cuma class CSS tetap) supaya baris ini SELALU 1 baris rata, tidak pernah numpuk ke
  // baris ke-2 gara-gara kartu ke-5 kelebihan dari grid 4 kolom tetap.
  const dashStatsEl = document.getElementById("dashStats");
  dashStatsEl.style.gridTemplateColumns = `repeat(${statCards.length}, 1fr)`;
  dashStatsEl.innerHTML = statCards.join("");

  // s-curve — lihat renderDashboardSCurve() di bawah (scoped ke filter Periode/Tim/Batch).
  renderDashboardSCurve();

  // warnings — {sev,html}, sev menentukan aksen warna kartu (lihat .dash-alert di style.css).
  let warn = [];
  DB.personil.forEach(p=>{
    PERSONIL_ITEMS.forEach(it=>{
      if(PERSONIL_DATED[it] && p.items[it] && p.items[it].exp){
        const days = Math.round((new Date(p.items[it].exp) - new Date())/86400000);
        if(days<0) warn.push({sev:"critical", html:`<b>${escHtml(p.nama)}</b> — ${PERSONIL_LABELS[it]} sudah expired`});
        else if(days<=30) warn.push({sev:"warning", html:`<b>${escHtml(p.nama)}</b> — ${PERSONIL_LABELS[it]} expired dalam ${days} hari`});
      }
    });
  });
  failed.slice(0,8).forEach(p=>warn.push({sev:"warning", html:`Titik <b>${escHtml(p.nama)}</b> (${p.site}) berstatus gagal — perlu dijadwalkan batch lanjutan`}));
  emgTriggered.filter(p=>p.status!=="done").forEach(p=>{
    const rh = wajibReason(p, period).rh;
    warn.push({sev:"critical", html:`<b>${escHtml(p.nama)}</b> (${p.site}) — Emergency Engine, RH 12 bulan terakhir <b>${rh} jam</b> (&gt;200 jam) &rarr; <b>wajib dipantau periode ${escHtml(period)}</b> tapi belum selesai.`});
  });
  document.getElementById("dashWarnings").innerHTML = warn.length
    ? warn.slice(0,12).map(w=>`<div class="dash-alert sev-${w.sev}"><span class="dash-alert-icon">${dashAlertIcon()}</span><div class="dash-alert-body">${w.html}</div></div>`).join("")
    : "<div class='hint'>Tidak ada peringatan aktif.</div>";

  // Rekap matriks Site × Grup Sumber (glyph ring per grup, heat-cell, bar status) — lihat renderDashboardSiteRecap().
  renderDashboardSiteRecap(wajib);

  // Peringkat beban emisi & kualitas ambien — lihat renderDashboardEmisiAmbienRanking() di bawah.
  renderDashboardEmisiAmbienRanking();
}

/* ---------------------------------------------------------
   S-CURVE — filter Periode/Tim/Batch
   ---------------------------------------------------------
   Sebelumnya S-Curve Dashboard selalu menggabung SEMUA batch dari SEMUA periode sekaligus
   (buildSCurveSVG(DB.batches,...) tanpa filter), jadi rentang tanggalnya makin panjang tiap kali
   ada batch baru dibuat di periode berikutnya. Filter di bawah mempersempit populasi batch yang
   dikirim ke buildSCurveSVG (lihat parameter `batches` di 08-gantt-print.js, sekarang dipakai utk
   membatasi titik yg dihitung lewat keanggotaan p.batchId) supaya kurva tetap satu jendela periode
   yang koheren — Tim & Batch sendiri boleh gabungan beberapa pilihan sekaligus (chip multi-pilih,
   Set kosong = "Semua", lihat dashScSel di bawah), bukan cuma satu tim/satu batch spt sebelumnya.
========================================================= */
function dashScPeriodList(){
  const periods = [...new Set(DB.batches.map(b=>b.period).filter(Boolean))];
  periods.sort((a,b)=>{
    const pa = parsePeriodStr(a), pb = parsePeriodStr(b);
    if(pa && pb) return periodCompare(pa,pb);
    return String(a).localeCompare(String(b));
  });
  return periods;
}
// Tim & Batch dulu <select> satu-pilihan (radio) — sekarang chip multi-pilih (Set kosong = "Semua",
// pola sama persis dgn hdSel di 14-hasil-dashboard.js) supaya bisa lihat gabungan mis. Emisi+Ambient
// atau beberapa batch sekaligus dalam satu kurva-S, bukan cuma satu per satu.
let dashScSel = { team: new Set(), batch: new Set() };
function dashScTeamMatches(team){ return dashScSel.team.size===0 || dashScSel.team.has(team); }
function dashScAvailableBatches(periode){
  return DB.batches.filter(b=>b.period===periode && dashScTeamMatches(b.team));
}
function refreshDashScSelects(){
  const periodeSel = document.getElementById("dashScPeriode");
  const periods = dashScPeriodList();
  // Simpan pilihan lama SEBELUM innerHTML diganti — rebuild <select> otomatis reset ke opsi
  // pertama walau opsi lama masih ada (pola sama dgn refreshBatchSelect/refreshGanttBatchSelect).
  const prevPeriode = periodeSel.value;
  periodeSel.innerHTML = periods.length
    ? periods.map(p=>`<option value="${escHtml(p)}">${escHtml(p)}</option>`).join("")
    : `<option value="">(belum ada batch)</option>`;
  if(periods.includes(prevPeriode)) periodeSel.value = prevPeriode;
  else if(periods.includes(currentPeriodStr())) periodeSel.value = currentPeriodStr();
  else if(periods.length) periodeSel.value = periods[periods.length-1];

  // Tim: 2 kotak centang (bukan "Semua/Emisi/Ambient" spt radio) — dua-duanya tercentang = semua tim
  // (disimpan sbg Set kosong), minimal 1 harus tetap tercentang (lihat dashScTeamChip di 16-actions-init.js).
  const scChip = (on, action, val, label, extra)=>`<button type="button" class="sc-chip ${on?"on":""}" data-action="${action}" data-val="${escHtml(val)}" aria-pressed="${on}"><span class="sc-chk" aria-hidden="true"></span>${label}${extra||""}</button>`;
  document.getElementById("dashScTeamChips").innerHTML =
    scChip(dashScTeamMatches("emisi"), "dashScTeamChip", "emisi", "Emisi")
    + scChip(dashScTeamMatches("ambient"), "dashScTeamChip", "ambient", "Ambient");

  const periode = periodeSel.value;
  const batchOpts = dashScAvailableBatches(periode);
  // Buang pilihan batch yang sudah tidak ada di daftar (mis. krn filter Tim baru saja diubah) —
  // pola sama dgn hdRenderCerobongChecklist, supaya filter tidak diam-diam masih "nyangkut" ke batch
  // yang sudah tidak relevan/tidak kelihatan lagi chipnya.
  const batchOptIds = new Set(batchOpts.map(b=>b.id));
  [...dashScSel.batch].forEach(id=>{ if(!batchOptIds.has(id)) dashScSel.batch.delete(id); });
  // Angka selesai/total di tiap batch — populasi sama dgn yang dihitung kurva (buildSCurveSVG).
  const batchCount = b=>{
    const ps = DB.points.filter(p=>p.batchId===b.id && p.planStart && p.planEnd && effectiveWajib(p) && !p.tidakBeroperasi);
    return `${ps.filter(p=>p.status==="done").length}/${ps.length} selesai`;
  };
  if(batchOpts.length) renderBatchPicker("dashScBatchChips", {batches:batchOpts, selected:dashScSel.batch, toggle:"dashScBatchChip", all:"dashScBatchAll", meta:batchCount});
  else document.getElementById("dashScBatchChips").innerHTML = `<span class="hint" style="margin:0;line-height:32px;">Belum ada batch di periode ini</span>`;

  const defaultPeriode = periods.includes(currentPeriodStr()) ? currentPeriodStr() : periods[periods.length-1];
  document.getElementById("dashScResetBtn").style.display =
    (dashScSel.team.size || dashScSel.batch.size || (periods.length && periodeSel.value!==defaultPeriode)) ? "" : "none";
}
function renderDashboardSCurve(){
  refreshDashScSelects();
  const periode = document.getElementById("dashScPeriode").value;
  let scBatches = periode ? dashScAvailableBatches(periode) : [];
  if(dashScSel.batch.size) scBatches = scBatches.filter(b=>dashScSel.batch.has(b.id));
  const teamView = dashScSel.team.size ? [...dashScSel.team] : ["emisi","ambient"];
  document.getElementById("dashSCurve").innerHTML = buildSCurveSVG(scBatches, DB.points, teamView);
}
document.getElementById("dashScPeriode").addEventListener("change", renderDashboardSCurve);

/* ---------------------------------------------------------
   SIMBOL GRUP SUMBER — tiap jenis peralatan punya glyph SVG sendiri (flare = cerobong + api,
   turbin = baling2 dlm rumah turbin, gas engine = blok mesin + silinder, emergency = genset + petir,
   glycol = kolom/bejana, ambient = daun) & warna identitas (--grp-* di style.css, lolos cek kontras &
   beda warna utk buta warna). Dipakai di matriks Rekap Site, kartu Peringkat, dan legend-nya.
   dashGrpVisual() SENGAJA dibungkus fungsi (bukan const top-level) krn GRP_* constants baru
   didefinisikan belakangan di 05-master-data.js (load order script ini > itu).
--------------------------------------------------------- */
function dashGrpVisual(label){
  const map = {
    [GRP_TURBIN]:       {color:"var(--grp-turbin)", glyph:"turbin"},
    [GRP_FLARE]:        {color:"var(--grp-flare)", glyph:"flare"},
    [GRP_GAS_ENGINE]:   {color:"var(--grp-gas)", glyph:"engine"},
    [GRP_GLYCOL]:       {color:"var(--grp-glycol)", glyph:"glycol"},
    [GRP_EMERGENCY]:    {color:"var(--grp-emergency)", glyph:"emergency"},
    [GRP_HEATER]:       {color:"var(--grp-heater)", glyph:"heater"},
    [GRP_ENGINE_KECIL]: {color:"var(--grp-kecil)", glyph:"engine"},
    [GRP_AMBIENT]:      {color:"var(--grp-ambient)", glyph:"leaf"},
  };
  return {...(map[label] || {color:"var(--gray-500)", glyph:"engine"}), ...dashGrpNames(label)};
}
// Urutan segmen batang bertumpuk — sengaja tidak menaruh Turbin (biru) bersebelahan dgn Gas Engine
// (ungu); pasangan bersebelahan di urutan ini yang divalidasi beda warnanya.
function dashGrpStackOrder(){ return [GRP_TURBIN, GRP_FLARE, GRP_GAS_ENGINE, GRP_GLYCOL, GRP_EMERGENCY, GRP_HEATER, GRP_ENGINE_KECIL, GRP_AMBIENT]; }
// "Glycol Reboiler / Dehydrator (Emisi & Opasitas)" -> {short:"Glycol Reboiler", sub:"Dehydrator · Emisi & Opasitas"}
// — nama panjang dulu dibungkus jadi 3-4 baris di kartunya.
function dashGrpNames(label){
  const m = String(label).match(/^(.*?)\s*\((.*)\)\s*$/);
  const main = m ? m[1] : String(label);
  const paren = m ? m[2].replace(/\s*\/\s*/g, " · ") : "";
  const parts = main.split(/\s+\/\s+/);
  return {short: parts[0], sub: [...parts.slice(1), paren].filter(Boolean).join(" · ")};
}
// `cut` = warna "lubang" di glyph (harus sama dgn latar di bawahnya supaya lubangnya kebaca).
function dashGrpGlyphInner(glyph, cut){
  const c = `style="fill:${cut||"var(--surface-card)"}"`;
  const cs = `style="stroke:${cut||"var(--surface-card)"}"`;
  switch(glyph){
    case "flare": return `<path d="M12 1.6c-1 2-3.2 3.3-3.2 5.9A3.2 3.2 0 0 0 12 10.7a3.2 3.2 0 0 0 3.2-3.2c0-1.5-.7-2.4-1.5-3.3.1 1.3-.5 2.1-1.4 2.5.4-1.7-.1-3.2-1.3-5.1z" fill="currentColor"/><rect x="10.7" y="11.3" width="2.6" height="8.6" rx="1" fill="currentColor" opacity=".9"/><path d="M12 13.2l-4.6 6.7M12 13.2l4.6 6.7" stroke="currentColor" stroke-width="1.1" opacity=".55" fill="none"/><rect x="6.5" y="19.6" width="11" height="2.6" rx="1.2" fill="currentColor"/>`;
    case "turbin": return `<circle cx="12" cy="12" r="9.2" fill="none" stroke="currentColor" stroke-width="1.6" opacity=".5"/><g fill="currentColor"><path d="M12 12c-1.6-1.4-2-4.2-.7-7.4 1 .1 2.5.6 3 1.7.6 1.4-.7 3.6-2.3 5.7z"/><path d="M12 12c-1.6-1.4-2-4.2-.7-7.4 1 .1 2.5.6 3 1.7.6 1.4-.7 3.6-2.3 5.7z" transform="rotate(120 12 12)"/><path d="M12 12c-1.6-1.4-2-4.2-.7-7.4 1 .1 2.5.6 3 1.7.6 1.4-.7 3.6-2.3 5.7z" transform="rotate(240 12 12)"/><circle cx="12" cy="12" r="2.4"/></g><circle cx="12" cy="12" r=".9" ${c}/>`;
    case "engine": return `<rect x="4.4" y="4.8" width="3" height="4" rx=".8" fill="currentColor" opacity=".75"/><rect x="8.5" y="4.8" width="3" height="4" rx=".8" fill="currentColor" opacity=".75"/><rect x="12.6" y="4.8" width="3" height="4" rx=".8" fill="currentColor" opacity=".75"/><rect x="2.8" y="8.4" width="14.6" height="10.4" rx="2" fill="currentColor"/><circle cx="10.1" cy="13.6" r="3" ${c}/><circle cx="10.1" cy="13.6" r="1.1" fill="currentColor"/><path d="M17.4 11.2h2.3a1.4 1.4 0 0 1 1.4 1.4v4.2" stroke="currentColor" stroke-width="1.9" fill="none" stroke-linecap="round"/><rect x="4.5" y="18.8" width="2.2" height="2" rx=".6" fill="currentColor"/><rect x="13.5" y="18.8" width="2.2" height="2" rx=".6" fill="currentColor"/>`;
    case "emergency": return `<rect x="2.8" y="9.8" width="12.6" height="8.8" rx="1.6" fill="currentColor"/><rect x="11.8" y="5.8" width="3" height="4.6" rx="1" fill="currentColor" opacity=".8"/><circle cx="6.8" cy="14.2" r="1.25" ${c}/><circle cx="10.7" cy="14.2" r="1.25" ${c}/><rect x="4.2" y="18.6" width="2" height="2" rx=".5" fill="currentColor"/><rect x="11.9" y="18.6" width="2" height="2" rx=".5" fill="currentColor"/><path d="M20.6 3.4l-4.4 6.2h3l-2.6 6.4 5.4-7h-3.1z" fill="currentColor"/>`;
    case "heater": return `<rect x="5" y="4" width="14" height="17" rx="2.2" fill="currentColor" opacity=".2" stroke="currentColor" stroke-width="1.5"/><path d="M12 8.6c-1.3 1.5-2.3 2.8-2.3 4.3a2.3 2.3 0 0 0 4.6 0c0-1.5-1-2.8-2.3-4.3z" fill="currentColor"/><rect x="8" y="16.8" width="8" height="2" rx="1" fill="currentColor" opacity=".6"/>`;
    case "glycol": return `<rect x="8" y="2.4" width="8" height="3" rx="1.4" fill="currentColor"/><rect x="6.4" y="5.1" width="11.2" height="14.6" rx="5.2" fill="currentColor"/><rect x="9.4" y="19.6" width="5.2" height="2.2" rx="1" fill="currentColor"/><line x1="6.6" y1="10.4" x2="17.4" y2="10.4" stroke-width="1.3" ${cs}/><line x1="6.6" y1="14.6" x2="17.4" y2="14.6" stroke-width="1.3" ${cs}/>`;
    case "leaf": return `<path d="M12 21c-4.5 0-8-3.4-8-8.3C4 7.7 8.8 4 12 3c1 3.6 5 5.6 5 10.2 0 4.3-2.3 7.8-5 7.8z" fill="currentColor"/><path d="M12 20V9.5M12 14.5l2.6-2.2M12 17l-2.4-2" stroke-width="1.3" stroke-linecap="round" fill="none" ${cs}/>`;
    default: return `<circle cx="12" cy="12" r="7" fill="currentColor"/>`;
  }
}
// Ubin ikon: latar tint warna grup + glyph warna grup.
function dashGlyphTile(label, size, radius){
  const v = dashGrpVisual(label);
  const bg = `color-mix(in srgb, ${v.color} 15%, var(--surface-card))`;
  const g = Math.round(size*0.6);
  return `<span class="dash-glyph" style="width:${size}px;height:${size}px;border-radius:${radius==null?Math.round(size*0.28):radius}px;background:${bg};color:${v.color};" aria-hidden="true"><svg width="${g}" height="${g}" viewBox="0 0 24 24">${dashGrpGlyphInner(v.glyph, bg)}</svg></span>`;
}
// Cincin progress (stroke-dasharray) mengelilingi glyph — warna cincin ikut ambang selesai
// (100% hijau, >=50% teal, sisanya amber), terpisah dari warna identitas grup di tengahnya.
function dashProgressRingSvg(pct, size, stroke){
  const r = (size-stroke)/2, c = size/2, circ = 2*Math.PI*r;
  const color = pct>=100?"var(--green-500)":pct>=50?"var(--teal-500)":"var(--amber-500)";
  const dash = circ*Math.min(1,Math.max(0,pct/100));
  // dash===0 tidak digambar (stroke-linecap:round tetap menampilkan bulatan kecil di 0%).
  const fg = dash>0 ? `<circle class="dash-ring-fill" cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${dash.toFixed(1)} ${(circ-dash).toFixed(1)}"/>` : "";
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="transform:rotate(-90deg);display:block;">
    <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="var(--gray-200)" stroke-width="${stroke}"/>
    ${fg}
  </svg>`;
}
function dashGlyphRing(label, pct, size){
  const v = dashGrpVisual(label);
  const inner = Math.round(size*0.66);
  const bg = `color-mix(in srgb, ${v.color} 15%, var(--surface-card))`;
  return `<div style="position:relative;width:${size}px;height:${size}px;flex-shrink:0;">
    ${dashProgressRingSvg(pct, size, Math.max(3, Math.round(size/11)))}
    <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;">
      <span class="dash-glyph" style="width:${inner}px;height:${inner}px;border-radius:50%;background:${bg};color:${v.color};"><svg width="${Math.round(inner*0.62)}" height="${Math.round(inner*0.62)}" viewBox="0 0 24 24">${dashGrpGlyphInner(v.glyph, bg)}</svg></span>
    </div>
  </div>`;
}

/* ---------- Tooltip generik [data-tip] (judul di data-tip-title, baris dipisah \n) ---------- */
function dashTipEl(){
  let t = document.getElementById("dashTip");
  if(!t){ t = document.createElement("div"); t.id = "dashTip"; t.className = "dash-tip"; t.setAttribute("role","tooltip"); document.body.appendChild(t); }
  return t;
}
document.addEventListener("mousemove", e=>{
  const host = e.target.closest && e.target.closest("[data-tip]");
  if(!host){ const t = document.getElementById("dashTip"); if(t) t.style.display = "none"; return; }
  const tip = dashTipEl();
  const title = host.getAttribute("data-tip-title");
  tip.innerHTML = (title ? `<b>${escHtml(title)}</b><br>` : "") + escHtml(host.getAttribute("data-tip")).replace(/\n/g, "<br>");
  tip.style.display = "block";
  const pad = 14, w = tip.offsetWidth, h = tip.offsetHeight;
  let left = e.clientX + pad, top = e.clientY + pad;
  if(left + w > window.innerWidth - 8) left = e.clientX - w - pad;
  if(top + h > window.innerHeight - 8) top = e.clientY - h - pad;
  tip.style.left = left + "px"; tip.style.top = top + "px";
});
document.addEventListener("scroll", ()=>{ const t = document.getElementById("dashTip"); if(t) t.style.display = "none"; }, true);

function dashLiveStamp(id){
  const el = document.getElementById(id); if(!el) return;
  const d = new Date();
  el.innerHTML = `<span class="dot" aria-hidden="true"></span>Live &middot; ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  el.title = "Diperbarui otomatis tiap data berubah";
}
function dashFmt(n, dec){ return (n==null||!isFinite(n)) ? "—" : n.toLocaleString("id-ID", {minimumFractionDigits:dec||0, maximumFractionDigits:dec||0}); }
// Ton ringkas: 1.386.922 -> "1,39 jt"; 3.927,7 -> "3.928"; 12,2 -> "12,2"
function dashFmtTon(n){
  if(n==null || !isFinite(n)) return "—";
  if(n>=1e6) return dashFmt(n/1e6, 2)+" jt";
  if(n>=1000) return dashFmt(n, 0);
  return dashFmt(n, n>=100 ? 0 : 1);
}
// Gambar ulang elemen pada lebar pikselnya sendiri tiap ukurannya berubah (teks chart tidak ikut
// menyusut spt kalau viewBox tetap diskalakan) — pola sama dgn plot S-Curve (08-gantt-print.js).
const dashSizedRO = window.ResizeObserver ? new ResizeObserver(entries=>entries.forEach(en=>{
  const el = en.target, w = Math.round(el.clientWidth);
  if(w && el._dashDraw && el._dashW!==w){ el._dashW = w; el.innerHTML = el._dashDraw(w); }
})) : null;
function dashRenderSized(el, drawFn){
  el._dashDraw = drawFn;
  const w = Math.round(el.clientWidth) || 640;
  el._dashW = w;
  el.innerHTML = drawFn(w);
  if(dashSizedRO && !el._dashObserved){ dashSizedRO.observe(el); el._dashObserved = true; }
}

/* =========================================================
   REKAP PER SITE × GRUP SUMBER (matriks)
   ---------------------------------------------------------
   Gabungan 2 panel lama (tabel progress per site + kartu progress per grup sumber) jadi 1 matriks:
   kolom = grup sumber (ikon engine + cincin progress total grup itu), baris = site, sel = selesai/
   total titik wajib site×grup (tint makin pekat = makin selesai). Kolom terakhir: komposisi status
   (Done/Scheduled/Hold/Gagal) + persen selesai site. Baris bisa diklik -> Database Titik Pantau
   terfilter site itu.
========================================================= */
function renderDashboardSiteRecap(wajib){
  const groups = dashGrpStackOrder().filter(g=>wajib.some(p=>subgroupOf(p)===g));
  const sites = [...new Set(wajib.map(p=>p.site))];
  const stat = list=>({
    total:list.length, done:list.filter(p=>p.status==="done").length,
    scheduled:list.filter(p=>p.status==="scheduled").length, pending:list.filter(p=>p.status==="pending").length,
    failed:list.filter(p=>p.status==="failed").length,
  });
  const rows = sites.map(site=>{
    const sp = wajib.filter(p=>p.site===site);
    const byGrp = {};
    groups.forEach(g=>{ byGrp[g] = stat(sp.filter(p=>subgroupOf(p)===g)); });
    return {site, ...stat(sp), byGrp};
  }).sort((a,b)=>b.total-a.total || a.site.localeCompare(b.site));
  const pct = (d,t)=>t ? Math.round(d/t*100) : 0;
  const el = document.getElementById("dashSiteMatrix");
  if(!rows.length){ el.innerHTML = "<div class='hint'>Belum ada titik wajib pantau periode ini.</div>"; dashLiveStamp("dashRecapLive"); return; }

  const head = groups.map(g=>{
    const v = dashGrpVisual(g);
    const s = stat(wajib.filter(p=>subgroupOf(p)===g));
    const pc = pct(s.done, s.total);
    return `<th scope="col" data-tip-title="${escHtml(g)}" data-tip="${s.done} dari ${s.total} titik selesai (${pc}%)\nTerjadwal ${s.scheduled} · Hold ${s.pending} · Gagal ${s.failed}">
      <div class="dsm-grp-h">${dashGlyphRing(g, pc, 46)}<span class="nm">${escHtml(v.short)}</span><span class="fr">${s.done}/${s.total} &middot; ${pc}%</span></div></th>`;
  }).join("");
  const statusSeg = r=>["done","scheduled","pending","failed"].filter(k=>r[k]).map(k=>
    `<span style="width:${(r[k]/r.total*100).toFixed(2)}%;background:${SCURVE_STATUS_META[k].barColor};"></span>`).join("");
  const body = rows.map((r,ri)=>{
    const cells = groups.map(g=>{
      const s = r.byGrp[g];
      if(!s.total) return `<td><div class="dsm-cell empty" aria-label="tidak ada">&mdash;</div></td>`;
      const pc = pct(s.done, s.total);
      const tint = `color-mix(in srgb, var(--teal-500) ${Math.round(8 + pc*0.5)}%, var(--surface-card))`;
      return `<td><div class="dsm-cell dash-fade-up" style="background:${tint};animation-delay:${(ri*40)}ms;" data-tip-title="${escHtml(r.site)} · ${escHtml(dashGrpVisual(g).short)}" data-tip="${s.done} dari ${s.total} titik selesai (${pc}%)\nTerjadwal ${s.scheduled} · Hold ${s.pending} · Gagal ${s.failed}">${s.done}<span style="opacity:.55;font-weight:700;">/${s.total}</span>${pc>=100?'<span class="ok" aria-label="selesai">&#10003;</span>':""}</div></td>`;
    }).join("");
    const pc = pct(r.done, r.total);
    return `<tr tabindex="0" data-action="dashSiteDrill" data-site="${escHtml(r.site)}" title="Buka titik ${escHtml(r.site)} di Database Titik Pantau">
      <td><div class="dsm-site"><span class="pal-site-pill" style="--site-c:${HASIL_SITE_COLORS[r.site]||"#7f8fa0"};">${escHtml(r.site)}</span><span class="cnt">${r.total} titik wajib</span></div></td>
      ${cells}
      <td><div class="dsm-prog" data-tip-title="${escHtml(r.site)}" data-tip="Done ${r.done} · Terjadwal ${r.scheduled} · Hold ${r.pending} · Gagal ${r.failed}"><div class="dsm-stack dash-grow-x" style="flex:1;animation-delay:${ri*40}ms;">${statusSeg(r)}</div><span class="pct">${pc}%</span></div></td>
    </tr>`;
  }).join("");
  const legend = `<div class="dsm-legend">
    <span class="it"><span class="heat"></span>Sel: makin pekat = makin banyak selesai</span>
    ${["done","scheduled","pending","failed"].map(k=>`<span class="it"><span class="sw" style="background:${SCURVE_STATUS_META[k].barColor};"></span>${SCURVE_STATUS_META[k].label}</span>`).join("")}
    <span class="it">Cincin ikon = progress total grup</span>
  </div>`;
  el.innerHTML = `<div class="dsm-wrap"><table class="dsm">
    <thead><tr><th scope="col" class="dsm-site-h">Site</th>${head}<th scope="col" class="dsm-prog-h">Status &amp; Progress</th></tr></thead>
    <tbody>${body}</tbody></table></div>${legend}`;
  dashLiveStamp("dashRecapLive");
}
document.addEventListener("keydown", e=>{
  if((e.key==="Enter"||e.key===" ") && e.target.matches && e.target.matches('tr[data-action="dashSiteDrill"]')){ e.preventDefault(); e.target.click(); }
});

/* =========================================================
   PERINGKAT BEBAN EMISI & KUALITAS AMBIEN
   ---------------------------------------------------------
   "Dari yang sudah disampling, bebannya berapa & yang paling besar yang mana". Beban emisi dihitung
   dari fungsi yang SAMA PERSIS dgn halaman Model Dispersi Emisi (dispersiStacks/dispersiBebanCarry
   Forward, 18-model-dispersi.js, termasuk carry-forward utk titik yg frekuensi pantaunya
   <1x/semester) supaya angkanya selalu konsisten dgn laporan Beban Emisi. Kualitas ambien dari
   aqiIspuGroupEvents/aqiIspuComputeEvent (21-aqi-ispu.js). Kedua file itu di-load SETELAH file ini
   tapi aman krn semua pemanggilannya ada di DALAM fungsi (dieksekusi saat render).
========================================================= */
// Total beban [param] utk SATU periode (default periode TERBARU kalau `periode` kosong/tidak valid),
// dirinci per site, per grup sumber, dan per site×grup (dasar batang bertumpuk).
function dashEmisiRankData(param, periode){
  const periods = dispersiPeriodList();
  const stacks = dispersiStacks();
  const empty = {bySite:{}, byGroup:{}, bySiteGroup:{}, countBySite:{}, countByGroup:{}, periode:null, total:0, pointCount:0, stackCount:stacks.length};
  if(!periods.length || !stacks.length) return empty;
  const usePeriode = periode && periods.some(p=>p.periode===periode) ? periode : periods[periods.length-1].periode;
  const r = {...empty, periode:usePeriode};
  stacks.forEach(s=>{
    const b = dispersiBebanCarryForward(s, param, usePeriode);
    if(!b || b.bebanTahunTon==null) return;
    const p = DB.points.find(x=>x.id===s.id);
    const grp = p ? subgroupOf(p) : (s.kategoriSumber||"Lainnya");
    r.bySite[s.site] = (r.bySite[s.site]||0) + b.bebanTahunTon;
    r.byGroup[grp] = (r.byGroup[grp]||0) + b.bebanTahunTon;
    (r.bySiteGroup[s.site] = r.bySiteGroup[s.site]||{})[grp] = (r.bySiteGroup[s.site][grp]||0) + b.bebanTahunTon;
    r.countBySite[s.site] = (r.countBySite[s.site]||0)+1;
    r.countByGroup[grp] = (r.countByGroup[grp]||0)+1;
    r.total += b.bebanTahunTon;
    r.pointCount++;
  });
  return r;
}
// Total beban SELURUH site utk SETIAP periode — dasar chart tren. Periode tanpa data apapun = null
// (bukan 0) supaya chart tidak menyiratkan "beban nol" padahal "belum ada data".
function dashEmisiTrendSeries(param){
  const periods = dispersiPeriodList();
  const stacks = dispersiStacks();
  const values = periods.map(p=>{
    let sum = 0, any = false;
    stacks.forEach(s=>{
      const b = dispersiBebanCarryForward(s, param, p.periode);
      if(b && b.bebanTahunTon!=null){ sum += b.bebanTahunTon; any = true; }
    });
    return any ? sum : null;
  });
  return {labels: periods.map(p=>p.periode), values};
}
function dashRankedEntries(obj){
  return Object.entries(obj).map(([label,value])=>({label,value})).sort((a,b)=>b.value-a.value);
}
// Kualitas ambien terkini per site — event PALING BARU per site (indeks tertinggi kalau >1 event di
// periode yg sama), plus titik/periode/polutan dominannya utk keterangan.
function dashAmbienRankData(){
  const bySite = {};
  aqiIspuGroupEvents().forEach(ev=>{
    const c = aqiIspuComputeEvent(ev, aqiIspuStandard);
    if(!c) return;
    const cur = bySite[ev.site];
    if(!cur || c.periodeOrder>cur.periodeOrder || (c.periodeOrder===cur.periodeOrder && c.index>cur.index)) bySite[ev.site] = c;
  });
  return Object.entries(bySite).map(([site,ev])=>({site, index:ev.index, category:ev.category, titik:ev.titik, periode:ev.periode,
    dominant:(AQIISPU_POLLUTANT_LABEL[ev.dominant]||ev.dominant)})).sort((a,b)=>b.index-a.index);
}
function refreshDashEmisiParamSelect(){
  const sel = document.getElementById("dashEmisiParam");
  if(sel.options.length) return; // statis (bukan bergantung DB), cukup diisi sekali
  const keys = Object.keys(DISPERSI_MASS_PARAMS).filter(k=>!DISPERSI_MASS_PARAMS[k].qualitative);
  sel.innerHTML = keys.map(k=>`<option value="${escHtml(k)}">${escHtml(DISPERSI_MASS_PARAMS[k].label)}</option>`).join("");
  sel.value = keys.includes("CO₂") ? "CO₂" : keys[0];
}
// Periode HASIL PEMANTAUAN EMISI (beda dari periode batch di S-Curve). Pilihan lama dipertahankan
// kalau masih ada, else default ke yang PALING BARU.
function refreshDashEmisiPeriodeSelect(){
  const sel = document.getElementById("dashEmisiPeriode");
  const periods = dispersiPeriodList();
  const prev = sel.value;
  sel.innerHTML = periods.length
    ? periods.map(p=>`<option value="${escHtml(p.periode)}">${escHtml(p.periode)}</option>`).join("")
    : `<option value="">(belum ada data)</option>`;
  if(periods.some(p=>p.periode===prev)) sel.value = prev;
  else if(periods.length) sel.value = periods[periods.length-1].periode;
}
function refreshDashEmisiTopNSelect(){
  const sel = document.getElementById("dashEmisiTopN");
  if(sel.options.length) return;
  sel.innerHTML = `<option value="5">Top 5 site</option><option value="8" selected>Top 8 site</option><option value="10">Top 10 site</option>`;
}

// Kolom tren per periode — periode terpilih warna penuh + label nilai, lainnya redup. Klik batang =
// pilih periode itu. Nilai null digambar sbg kerangka putus2 "belum ada data".
function dashTrendSvg(labels, values, selected, paramLabel, W){
  const H = 240, padL = 50, padR = 12, padT = 26, padB = 30;
  const plotW = Math.max(80, W-padL-padR), plotH = H-padT-padB;
  const maxV = Math.max(...values.filter(v=>v!=null), 0);
  const niceStep = v=>{ if(v<=0) return 1; const e = Math.pow(10, Math.floor(Math.log10(v))); const f = v/e; return (f<=1?1:f<=2?2:f<=5?5:10)*e; };
  const step = niceStep(maxV/4), top = Math.max(step, Math.ceil(maxV/step)*step);
  const y = v=>padT + plotH - (v/top)*plotH;
  const n = labels.length, slot = plotW/n, bw = Math.min(56, slot*0.56);
  const parts = [];
  for(let v=0; v<=top+1e-9; v+=step){
    parts.push(`<line x1="${padL}" y1="${y(v)}" x2="${padL+plotW}" y2="${y(v)}" stroke="var(--gray-200)" ${v?'stroke-dasharray="2,4"':""}/>`);
    parts.push(`<text x="${padL-8}" y="${y(v)+4}" text-anchor="end" font-size="11" fill="var(--gray-500)">${escSvg(dashFmtTon(v))}</text>`);
  }
  labels.forEach((lab,i)=>{
    const cx = padL + slot*i + slot/2, v = values[i], isSel = lab===selected;
    const prevIdx = (()=>{ for(let j=i-1;j>=0;j--) if(values[j]!=null) return j; return -1; })();
    if(v==null){
      parts.push(`<rect x="${cx-bw/2}" y="${padT+plotH-28}" width="${bw}" height="28" rx="4" fill="none" stroke="var(--gray-300)" stroke-dasharray="3,3"/><text x="${cx}" y="${padT+plotH-10}" text-anchor="middle" font-size="10" fill="var(--gray-500)">n/a</text>`);
    } else {
      const dlt = prevIdx>=0 && values[prevIdx] ? (v-values[prevIdx])/values[prevIdx]*100 : null;
      const tip = `Total beban ${paramLabel}: ${dashFmt(v,1)} ton/tahun${dlt!=null?`\n${dlt>=0?"▲ naik":"▼ turun"} ${dashFmt(Math.abs(dlt),1)}% vs ${labels[prevIdx]}`:""}\nKlik utk melihat periode ini`;
      parts.push(`<rect class="bar dash-grow-y" data-action="dashEmisiPickPeriode" data-val="${escSvg(lab)}" data-tip-title="${escSvg(lab)}" data-tip="${escSvg(tip)}" x="${(cx-bw/2).toFixed(1)}" y="${y(v).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(2,padT+plotH-y(v)).toFixed(1)}" rx="4" fill="var(--sc-act)" opacity="${isSel?1:0.38}" style="animation-delay:${i*60}ms"/>`);
      if(isSel || v===maxV) parts.push(`<text x="${cx}" y="${y(v)-8}" text-anchor="middle" font-size="11.5" font-weight="800" fill="var(--heading)">${escSvg(dashFmtTon(v))}</text>`);
    }
    parts.push(`<text x="${cx}" y="${H-10}" text-anchor="middle" font-size="11" font-weight="${isSel?800:500}" fill="${isSel?"var(--heading)":"var(--gray-500)"}">${escSvg(lab)}</text>`);
  });
  parts.push(`<text x="${padL}" y="12" font-size="10.5" fill="var(--gray-500)">ton/tahun</text>`);
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Tren total beban ${escSvg(paramLabel)} per periode">${parts.join("")}</svg>`;
}
// Donut kontribusi per site (Top N + "Lainnya"), celah 2px antar potongan, tooltip per potongan.
function dashSiteDonutHtml(segs, total){
  const R = 70, r = 46, cx = 84, cy = 84;
  const pol = (rad, a)=>[cx + rad*Math.cos(a), cy + rad*Math.sin(a)];
  let a0 = -Math.PI/2;
  const gapA = segs.length>1 ? 0.025 : 0;
  const paths = segs.map(s=>{
    const sweep = s.value/total*Math.PI*2;
    const a1 = a0 + Math.max(0.0001, sweep-gapA), a2 = a0;
    let d;
    if(segs.length===1){
      d = `M${cx},${cy-R} A${R},${R} 0 1 1 ${cx-0.01},${cy-R} L${cx-0.01},${cy-r} A${r},${r} 0 1 0 ${cx},${cy-r} Z`;
    } else {
      const large = (a1-a2)>Math.PI ? 1 : 0;
      const [x1,y1] = pol(R,a2), [x2,y2] = pol(R,a1), [x3,y3] = pol(r,a1), [x4,y4] = pol(r,a2);
      d = `M${x1.toFixed(2)},${y1.toFixed(2)} A${R},${R} 0 ${large} 1 ${x2.toFixed(2)},${y2.toFixed(2)} L${x3.toFixed(2)},${y3.toFixed(2)} A${r},${r} 0 ${large} 0 ${x4.toFixed(2)},${y4.toFixed(2)} Z`;
    }
    a0 += sweep;
    return `<path d="${d}" fill="${s.color}" data-tip-title="${escSvg(s.label)}" data-tip="${escSvg(dashFmt(s.value,1))} ton/tahun (${dashFmt(s.value/total*100,1)}%)"/>`;
  }).join("");
  const centerStr = dashFmtTon(total);
  const fs = centerStr.length<=5 ? 22 : centerStr.length<=7 ? 18 : 15;
  const svg = `<svg width="168" height="168" viewBox="0 0 168 168" role="img" aria-label="Kontribusi beban per site" class="dash-fade-up">${paths}
    <text x="${cx}" y="${cy+2}" text-anchor="middle" font-size="${fs}" font-weight="800" fill="var(--heading)">${escSvg(centerStr)}</text>
    <text x="${cx}" y="${cy+19}" text-anchor="middle" font-size="10.5" fill="var(--gray-500)">ton/tahun</text></svg>`;
  const legend = segs.map(s=>`<div class="row" data-tip-title="${escHtml(s.label)}" data-tip="${dashFmt(s.value,1)} ton/tahun"><span class="sw" style="background:${s.color};"></span><span class="nm">${escHtml(s.label)}</span><span class="v">${dashFmtTon(s.value)}</span><span class="p">${dashFmt(s.value/total*100,1)}%</span></div>`).join("");
  return `<div class="dash-donut-wrap">${svg}<div class="dash-donut-legend">${legend}</div></div>`;
}

function renderDashboardEmisiAmbienRanking(){
  // showPage("dashboard") dipanggil SINKRON di init 16-actions-init.js, SEBELUM script 18 (Model
  // Dispersi) & 21 (AQI/ISPU) selesai dimuat. Coba lagi di tick berikutnya drpd lempar error yang
  // memutus sisa init().
  if(typeof DISPERSI_MASS_PARAMS==="undefined" || typeof aqiIspuGroupEvents==="undefined"){
    setTimeout(renderDashboardEmisiAmbienRanking, 0);
    return;
  }
  refreshDashEmisiParamSelect();
  refreshDashEmisiPeriodeSelect();
  refreshDashEmisiTopNSelect();
  const param = document.getElementById("dashEmisiParam").value;
  const topN = Number(document.getElementById("dashEmisiTopN").value) || 8;
  const R = dashEmisiRankData(param, document.getElementById("dashEmisiPeriode").value);
  const {periode, total} = R;
  const siteRows = dashRankedEntries(R.bySite), groupRows = dashRankedEntries(R.byGroup);
  const paramLabel = (DISPERSI_MASS_PARAMS[param]||{}).label || param;
  const stdLabel = aqiIspuStandard==="ispu" ? "ISPU" : "AQI";
  const ambienRows = dashAmbienRankData();

  document.getElementById("dashEmisiRankNote").innerHTML = periode
    ? `Beban ${escHtml(paramLabel)} periode <b>${escHtml(periode)}</b>, dihitung dari titik yang sudah punya hasil sampling &amp; jam operasi tercatat (sama dgn Model Dispersi Emisi).`
    : `Belum ada data hasil pemantauan emisi untuk dihitung bebannya.`;
  dashLiveStamp("dashRankLive");

  // KPI
  const trend = dashEmisiTrendSeries(param);
  const selIdx = trend.labels.indexOf(periode);
  let prevIdx = -1; for(let j=selIdx-1;j>=0;j--){ if(trend.values[j]!=null){ prevIdx = j; break; } }
  const delta = prevIdx>=0 && trend.values[prevIdx] ? (total-trend.values[prevIdx])/trend.values[prevIdx]*100 : null;
  // Emisi turun = baik (hijau), naik = buruk (merah) — selalu dgn panah + kata, bukan warna saja.
  const deltaBadge = delta==null ? `<div class="k-sub">periode pertama (tanpa pembanding)</div>`
    : `<span class="badge ${delta<=0?"b-green":"b-red"}">${delta<=0?"&#9660; turun":"&#9650; naik"} ${dashFmt(Math.abs(delta),1)}% vs ${escHtml(trend.labels[prevIdx])}</span>`;
  const topGrp = groupRows[0];
  const avgAmb = ambienRows.length ? Math.round(ambienRows.reduce((s,r)=>s+r.index,0)/ambienRows.length) : null;
  const avgCat = avgAmb!=null ? aqiIspuCategoryFor(avgAmb, aqiIspuStandard) : null;
  const icoTile = (svgInner, color)=>`<span class="k-ico" style="background:color-mix(in srgb, ${color} 14%, var(--surface-card));color:${color};"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${svgInner}</svg></span>`;
  const k = (ico, lbl, num, sub)=>`<div class="k dash-fade-up">${ico}<div class="k-body"><div class="k-lbl">${lbl}</div><div class="k-num">${num}</div>${sub}</div></div>`;
  document.getElementById("dashEmisiKpiRow").innerHTML = [
    k(icoTile(`<path d="M4 20V10M9 20V4M14 20v-7M19 20v-11"/>`, "var(--sc-act)"), `Total Beban ${escHtml(paramLabel)}`,
      periode ? `${dashFmtTon(total)}<small>ton/thn</small>` : "—", deltaBadge),
    k(icoTile(`<path d="M7 21V9l3-2v14M14 21V4l3 2v15M4 21h16"/>`, "var(--grp-turbin)"), "Titik Terhitung",
      `${R.pointCount}<small>/ ${R.stackCount} cerobong</small>`, `<div class="k-sub">${siteRows.length} site punya data beban</div>`),
    k(topGrp ? dashGlyphTile(topGrp.label, 38, 10) : icoTile(`<circle cx="12" cy="12" r="6"/>`, "var(--gray-500)"), "Sumber Dominan",
      topGrp ? `<span class="txt" title="${escHtml(topGrp.label)}">${escHtml(dashGrpVisual(topGrp.label).short)}</span>` : "—",
      topGrp ? `<div class="k-sub">${dashFmt(topGrp.value/total*100,1)}% dari total beban</div>` : `<div class="k-sub">belum ada data</div>`),
    k(icoTile(`<path d="M3 8h11a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h8"/>`, avgCat ? avgCat.color : "var(--gray-500)"), `Rata-rata Indeks ${stdLabel}`,
      avgAmb!=null ? `${avgAmb}<small>${ambienRows.length} site</small>` : "—",
      avgCat ? `<span class="dash-aqi-cat" style="background:${avgCat.color};color:${avgCat.text};margin-top:6px;">${escHtml(avgCat.name)}</span>` : `<div class="k-sub">belum ada data ambien</div>`),
  ].join("");

  // Tren
  const trendEl = document.getElementById("dashEmisiTrend");
  if(trend.labels.length) dashRenderSized(trendEl, W=>dashTrendSvg(trend.labels, trend.values, periode, paramLabel, W));
  else { trendEl._dashDraw = null; trendEl.innerHTML = "<div class='hint' style='padding:14px;'>Belum ada data historis untuk ditampilkan.</div>"; }

  // Donut kontribusi site (Top N + Lainnya, total tetap 100% dari total asli)
  const donutSegs = siteRows.slice(0,topN).map(r=>({label:r.label, value:r.value, color:HASIL_SITE_COLORS[r.label]||"#7f8fa0"}));
  const restVal = siteRows.slice(topN).reduce((s,r)=>s+r.value,0);
  if(restVal>0) donutSegs.push({label:`Lainnya (${siteRows.length-topN} site)`, value:restVal, color:"var(--gray-300)"});
  document.getElementById("dashEmisiDonutSub").textContent = siteRows.length ? `Porsi tiap site dari total ${dashFmt(total,1)} ton/tahun` : "";
  document.getElementById("dashEmisiDonut").innerHTML = donutSegs.length && total>0 ? dashSiteDonutHtml(donutSegs, total) : "<div class='hint'>Belum ada data.</div>";

  // Site × jenis sumber (batang bertumpuk, panjang relatif thd site terbesar)
  const maxSite = Math.max(1, ...siteRows.map(r=>r.value));
  const grpPresent = dashGrpStackOrder().filter(g=>R.byGroup[g]>0);
  Object.keys(R.byGroup).forEach(g=>{ if(!grpPresent.includes(g) && R.byGroup[g]>0) grpPresent.push(g); });
  const sxgLegend = `<div class="dash-sxg-legend">${grpPresent.map(g=>`<span class="it">${dashGlyphTile(g, 20, 6)}${escHtml(dashGrpVisual(g).short)}</span>`).join("")}</div>`;
  document.getElementById("dashEmisiRankSite").innerHTML = siteRows.length
    ? sxgLegend + siteRows.slice(0,topN).map((r,i)=>{
        const segs = grpPresent.filter(g=>(R.bySiteGroup[r.label]||{})[g]>0).map(g=>{
          const v = R.bySiteGroup[r.label][g];
          return `<span style="width:${(v/r.value*100).toFixed(2)}%;background:${dashGrpVisual(g).color};" data-tip-title="${escHtml(r.label)} · ${escHtml(dashGrpVisual(g).short)}" data-tip="${dashFmt(v,1)} ton/tahun (${dashFmt(v/r.value*100,1)}% dari site ini)"></span>`;
        }).join("");
        return `<div class="dash-sxg-row dash-fade-up" style="animation-delay:${i*50}ms;">
          <span class="rk ${i<3?"top":""}">${i+1}</span>
          <span><span class="pal-site-pill" style="--site-c:${HASIL_SITE_COLORS[r.label]||"#7f8fa0"};">${escHtml(r.label)}</span></span>
          <div style="width:${Math.max(4, r.value/maxSite*100).toFixed(2)}%;"><div class="dash-sxg-bar dash-grow-x" style="animation-delay:${i*50}ms;">${segs}</div></div>
          <span class="val">${dashFmtTon(r.value)} t<small>${dashFmt(r.value/total*100,1)}% &middot; ${R.countBySite[r.label]||0} titik</small></span>
        </div>`;
      }).join("")
    : "<div class='hint'>Belum ada data beban emisi.</div>";

  // Kualitas ambien per site — skala kategori (pita warna resmi AQI/ISPU) + penanda indeks.
  document.getElementById("dashAmbienStdLabel").textContent = stdLabel;
  const cats = aqiIspuStandard==="ispu" ? ISPU_CATEGORIES : AQI_CATEGORIES;
  const scaleMax = 300;
  const band = cats.filter(c=>c.lo<scaleMax).map(c=>`<span style="width:${((Math.min(c.hi+1,scaleMax)-c.lo)/scaleMax*100).toFixed(2)}%;background:${c.color};"></span>`).join("");
  document.getElementById("dashAmbienRank").innerHTML = ambienRows.length
    ? ambienRows.slice(0,topN).map((r,i)=>`<div class="dash-aqi-row dash-fade-up" style="animation-delay:${i*50}ms;" data-tip-title="${escHtml(r.site)} · ${stdLabel} ${r.index}" data-tip="${escHtml(r.category.name)}\nPolutan dominan: ${escHtml(r.dominant)}\n${escHtml(r.titik||"")} · ${escHtml(r.periode||"")}">
        <span><span class="pal-site-pill" style="--site-c:${HASIL_SITE_COLORS[r.site]||"#7f8fa0"};">${escHtml(r.site)}</span></span>
        <div style="min-width:0;"><div class="dash-aqi-scale">${band}<i class="dash-aqi-mark" style="left:${Math.min(100, r.index/scaleMax*100).toFixed(2)}%;background:${r.category.color};"></i></div>
          <div class="dash-aqi-meta">Dominan ${escHtml(r.dominant)} &middot; ${escHtml(r.periode||"")}</div></div>
        <div class="dash-aqi-idx"><b>${r.index}</b><span class="dash-aqi-cat" style="background:${r.category.color};color:${r.category.text};">${escHtml(r.category.name.replace(/\s*\(.*\)$/,""))}</span></div>
      </div>`).join("")
    : "<div class='hint'>Belum ada data hasil pemantauan ambien.</div>";

  // Ubin per grup sumber
  document.getElementById("dashEmisiRankGroup").innerHTML = groupRows.length
    ? groupRows.map((r,i)=>{
        const v = dashGrpVisual(r.label);
        const share = r.value/total*100;
        return `<div class="dash-grp-tile dash-fade-up" style="animation-delay:${i*50}ms;" data-tip-title="${escHtml(r.label)}" data-tip="${dashFmt(r.value,1)} ton/tahun · ${dashFmt(share,1)}% dari total\n${R.countByGroup[r.label]||0} titik terhitung">
          ${dashGlyphTile(r.label, 42, 12)}
          <div class="bd"><div class="nm">${escHtml(v.short)}</div><div class="sb">${escHtml(v.sub||" ")}</div>
            <div class="v">${dashFmtTon(r.value)}<small>ton/thn</small></div>
            <div class="share"><span class="dash-grow-x" style="width:${Math.max(1.5,share).toFixed(2)}%;background:${v.color};animation-delay:${i*50}ms;"></span></div>
            <div class="ft"><span>${dashFmt(share,1)}% total</span><span>${R.countByGroup[r.label]||0} titik</span></div></div>
        </div>`;
      }).join("")
    : "<div class='hint'>Belum ada data beban emisi.</div>";
}
document.getElementById("dashEmisiParam").addEventListener("change", renderDashboardEmisiAmbienRanking);
document.getElementById("dashEmisiPeriode").addEventListener("change", renderDashboardEmisiAmbienRanking);
document.getElementById("dashEmisiTopN").addEventListener("change", renderDashboardEmisiAmbienRanking);
