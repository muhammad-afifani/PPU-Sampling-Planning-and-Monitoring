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

  document.getElementById("dashStats").innerHTML = `
    <div class="stat"><div class="num">${wajib.length}</div><div class="lbl">Titik Wajib Pantau · ${escHtml(period)}</div></div>
    <div class="stat good"><div class="num">${pct}%</div><div class="lbl">Progress Selesai (${done.length}/${wajib.length})</div></div>
    <div class="stat warn"><div class="num">${scheduled.length}</div><div class="lbl">Terjadwal, Belum Sampling</div></div>
    <div class="stat ${failed.length?"bad":"good"}"><div class="num">${failed.length}</div><div class="lbl">Gagal / Lanjut Batch</div></div>
  `;
  if(emgTriggered.length){
    document.getElementById("dashStats").innerHTML += `
    <div class="stat bad"><div class="num">${emgTriggered.length}</div><div class="lbl">Emergency Engine RH&gt;200 jam · Wajib Pantau</div></div>`;
  }

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

  // per site recap
  const sites = [...new Set(pts.map(p=>p.site))];
  let rows = sites.map(s=>{
    const sp = pts.filter(p=>p.site===s && effectiveWajib(p, period));
    const d = sp.filter(p=>p.status==="done").length;
    return {site:s, total:sp.length, done:d, pct: sp.length?Math.round(d/sp.length*100):0};
  }).sort((a,b)=>b.total-a.total);
  document.getElementById("dashSiteTable").innerHTML = `
    <thead><tr><th>Site</th><th>Total Wajib</th><th>Selesai</th><th>Progress</th></tr></thead>
    <tbody>${rows.map(r=>`<tr><td><span class="pal-site-pill" style="--site-c:${HASIL_SITE_COLORS[r.site]||"#7f8fa0"};">${escHtml(r.site)}</span></td><td>${r.total}</td><td>${r.done}</td>
      <td style="min-width:160px;"><div class="progressbar"><div style="width:${r.pct}%"></div></div><span class="muted" style="font-size:11px;">${r.pct}%</span></td></tr>`).join("")}</tbody>`;

  // Panel pendamping: progress per grup sumber (Turbin/Gas Engine/Emergency/Flare/dst) — sudut
  // pandang lain dari data yang sama, biar kelihatan grup mana yang paling tertinggal. Tiap grup
  // digambar sbg kartu ber-ilustrasi (dashGrpCardHtml), bukan bar polos.
  const groupOrder = [...KATEGORI_SUMBER_ORDER];
  const groupRows = groupOrder.map(g=>{
    const gp = wajib.filter(p=>subgroupOf(p)===g);
    const d = gp.filter(p=>p.status==="done").length;
    return {label:g, done:d, total:gp.length};
  }).filter(g=>g.total>0);
  document.getElementById("dashGroupBars").innerHTML = groupRows.length
    ? groupRows.map(g=>dashGrpCardHtml(g.label, g.done, g.total)).join("")
    : "<div class='hint'>Belum ada titik wajib pantau.</div>";
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

  document.getElementById("dashScTeamChips").innerHTML = `
    <button type="button" class="chip-toggle all ${dashScSel.team.size===0?'active':''}" data-action="dashScTeamChip" data-val="">Semua</button>
    <button type="button" class="chip-toggle ${dashScSel.team.has('emisi')?'active':''}" data-action="dashScTeamChip" data-val="emisi">Emisi</button>
    <button type="button" class="chip-toggle ${dashScSel.team.has('ambient')?'active':''}" data-action="dashScTeamChip" data-val="ambient">Ambient</button>
  `;

  const periode = periodeSel.value;
  const batchOpts = dashScAvailableBatches(periode);
  // Buang pilihan batch yang sudah tidak ada di daftar (mis. krn filter Tim baru saja diubah) —
  // pola sama dgn hdRenderCerobongChecklist, supaya filter tidak diam-diam masih "nyangkut" ke batch
  // yang sudah tidak relevan/tidak kelihatan lagi chipnya.
  const batchOptIds = new Set(batchOpts.map(b=>b.id));
  [...dashScSel.batch].forEach(id=>{ if(!batchOptIds.has(id)) dashScSel.batch.delete(id); });
  document.getElementById("dashScBatchChips").innerHTML = batchOpts.length
    ? `<button type="button" class="chip-toggle all ${dashScSel.batch.size===0?'active':''}" data-action="dashScBatchChip" data-val="">Semua Batch</button>`
      + batchOpts.map(b=>`<button type="button" class="chip-toggle ${dashScSel.batch.has(b.id)?'active':''}" data-action="dashScBatchChip" data-val="${b.id}">${escHtml(b.name)}</button>`).join("")
    : `<span class="hint" style="margin:0;">(belum ada batch)</span>`;
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
   Kartu grup sumber ber-ilustrasi ("eye-catching", bukan ms-icon linear biasa) — tiap jenis
   peralatan dapat bentuk SVG sendiri (turbin=baling2, flare=api, dst) + cincin progress yang
   warnanya ikut threshold selesai (SAMA persis dgn progressBarRow), terpisah dari warna identitas
   grup supaya "grup apa" & "progress berapa" tidak numpuk di 1 channel warna yang sama.
   dashGrpVisual() SENGAJA dibungkus fungsi (bukan const top-level) krn GRP_* constants baru
   didefinisikan belakangan di 05-master-data.js (load order script ini > itu) — const top-level
   akan dievaluasi lebih dulu & meledak "GRP_FLARE is not defined". Dibungkus fungsi = baru
   dievaluasi saat DIPANGGIL (render time, semua script sudah lengkap), pola yang sama dgn
   groupOrder/subgroupOf yg sudah dipakai renderDashboard() di atas.
--------------------------------------------------------- */
function dashGrpVisual(label){
  const map = {
    [GRP_FLARE]:        {color:"#e0654f", glyph:"flare"},
    [GRP_TURBIN]:        {color:"#2b7fb0", glyph:"turbin"},
    [GRP_GAS_ENGINE]:    {color:"#7c5cbf", glyph:"engine"},
    [GRP_EMERGENCY]:     {color:"#e8a33d", glyph:"emergency"},
    [GRP_HEATER]:        {color:"#c2478a", glyph:"heater"},
    [GRP_GLYCOL]:        {color:"#0ea5a0", glyph:"glycol"},
    [GRP_ENGINE_KECIL]:  {color:"#64748b", glyph:"engine"},
    [GRP_AMBIENT]:       {color:"#3fb27f", glyph:"leaf"},
  };
  return map[label] || {color:"#64748b", glyph:"engine"};
}
function dashGrpGlyphInner(glyph){
  switch(glyph){
    case "flare": return `<path d="M12 21c-3.5 0-6-2.4-6-5.8 0-2.6 1.7-4.3 2.8-6.2.5-.9 1-2 1-3.3 0 0 2.6 1.7 2.6 4.5 0 1-.4 1.8-.4 1.8 1.6-.6 3-2.3 3-4.3 2 2 3 4.4 3 6.8 0 3.7-2.5 6.5-6 6.5z" fill="currentColor"/>`;
    case "turbin": return `<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.4" opacity=".45"/><g fill="currentColor"><rect x="10.6" y="3.6" width="2.8" height="7.6" rx="1.4"/><rect x="10.6" y="3.6" width="2.8" height="7.6" rx="1.4" transform="rotate(120 12 12)"/><rect x="10.6" y="3.6" width="2.8" height="7.6" rx="1.4" transform="rotate(240 12 12)"/><circle cx="12" cy="12" r="2.3"/></g>`;
    case "engine": return `<rect x="3.5" y="9.2" width="13" height="9" rx="1.6" fill="currentColor" opacity=".85"/><rect x="14" y="5.2" width="3" height="6" rx="1" fill="currentColor"/><rect x="17.4" y="12" width="3.1" height="3.1" rx="0.8" fill="currentColor" opacity=".55"/><circle cx="7.3" cy="13.7" r="1.3" fill="var(--surface-card)"/><circle cx="11.3" cy="13.7" r="1.3" fill="var(--surface-card)"/>`;
    case "emergency": return `<rect x="3.5" y="10.2" width="12" height="8" rx="1.5" fill="currentColor" opacity=".8"/><rect x="12.7" y="6.2" width="3" height="5" rx="1" fill="currentColor"/><circle cx="7.3" cy="14.2" r="1.15" fill="var(--surface-card)"/><circle cx="11" cy="14.2" r="1.15" fill="var(--surface-card)"/><path d="M20.3 3.8l-4.6 6.1h3.1L16.2 16l5.2-6.7h-3.1z" fill="currentColor"/>`;
    case "heater": return `<rect x="5" y="4" width="14" height="17" rx="2.2" fill="currentColor" opacity=".16" stroke="currentColor" stroke-width="1.5"/><path d="M12 8.8c-1.2 1.4-2.15 2.6-2.15 4.05a2.15 2.15 0 0 0 4.3 0c0-1.45-.95-2.65-2.15-4.05z" fill="currentColor"/><rect x="8" y="16.8" width="8" height="2" rx="1" fill="currentColor" opacity=".55"/>`;
    case "glycol": return `<rect x="8" y="2.6" width="8" height="3" rx="1.4" fill="currentColor"/><rect x="6.4" y="5.3" width="11.2" height="14.4" rx="5.2" fill="currentColor" opacity=".8"/><rect x="9.4" y="19.6" width="5.2" height="2" rx="1" fill="currentColor"/><line x1="6.6" y1="10.6" x2="17.4" y2="10.6" stroke="var(--surface-card)" stroke-width="1.3"/><line x1="6.6" y1="14.7" x2="17.4" y2="14.7" stroke="var(--surface-card)" stroke-width="1.3"/>`;
    case "leaf": return `<path d="M12 21c-4.5 0-8-3.4-8-8.3C4 7.7 8.8 4 12 3c1 3.6 5 5.6 5 10.2 0 4.3-2.3 7.8-5 7.8z" fill="currentColor" opacity=".85"/><path d="M12 20V9" stroke="var(--surface-card)" stroke-width="1.3" stroke-linecap="round"/>`;
    default: return `<circle cx="12" cy="12" r="7" fill="currentColor"/>`;
  }
}
// Cincin progress kecil (stroke-dasharray) — warnanya ikut threshold selesai yang SAMA dgn
// progressBarRow (100%=hijau, >=50%=teal, sisanya amber) supaya "bahasa warna progress" konsisten
// di semua tempat, terpisah dari warna identitas grup/badge di tengahnya.
function dashProgressRingSvg(pct, size, stroke){
  const r = (size-stroke)/2, c = size/2, circ = 2*Math.PI*r;
  const color = pct>=100?"var(--green-500)":pct>=50?"var(--teal-500)":"var(--amber-500)";
  const dash = circ*Math.min(1,Math.max(0,pct/100));
  // dash===0 tidak digambar sama sekali (bukan cuma dasharray "0 circ") krn stroke-linecap:round
  // tetap menampilkan bulatan kecil di 0% kalau lingkaran tetap dirender dgn panjang goresan 0.
  const fg = dash>0 ? `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${dash.toFixed(1)} ${(circ-dash).toFixed(1)}"/>` : "";
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="transform:rotate(-90deg);display:block;">
    <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="var(--gray-200)" stroke-width="${stroke}"/>
    ${fg}
  </svg>`;
}
function dashGrpCardHtml(label, done, total){
  const pct = total? Math.round(done/total*100) : 0;
  const vis = dashGrpVisual(label);
  const ringSize=54, badgeSize=32;
  return `<div class="dash-grp-card" title="${escHtml(label)}: ${done}/${total} selesai (${pct}%)">
    <div style="position:relative;width:${ringSize}px;height:${ringSize}px;flex-shrink:0;">
      ${dashProgressRingSvg(pct, ringSize, 5)}
      <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;">
        <div style="width:${badgeSize}px;height:${badgeSize}px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:${vis.color};background:color-mix(in srgb, ${vis.color} 16%, var(--surface-card));">
          <svg width="20" height="20" viewBox="0 0 24 24">${dashGrpGlyphInner(vis.glyph)}</svg>
        </div>
      </div>
    </div>
    <div class="dash-grp-body">
      <div class="dash-grp-label">${escHtml(label)}</div>
      <div class="dash-grp-frac"><b>${done}</b>/${total} <span class="muted">(${pct}%)</span></div>
    </div>
  </div>`;
}
