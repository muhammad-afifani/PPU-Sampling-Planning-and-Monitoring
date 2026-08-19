/* =========================================================
   DASHBOARD
========================================================= */
function renderDashboard(){
  const pts = DB.points;
  const period = currentPeriodStr();
  const wajib = pts.filter(p=>effectiveWajib(p, period));
  const done = wajib.filter(p=>p.status==="done");
  const scheduled = wajib.filter(p=>p.status==="scheduled");
  const failed = wajib.filter(p=>p.status==="failed");
  const pct = wajib.length? Math.round(done.length/wajib.length*100):0;
  const emgTriggered = pts.filter(p=>wajibReason(p, period).type==="emergency-triggered");

  const complPersonil = DB.personil.filter(p=>completenessPct(p)===100).length;

  document.getElementById("dashStats").innerHTML = `
    <div class="stat"><div class="num">${wajib.length}</div><div class="lbl">Titik Wajib Pantau · ${escHtml(period)}</div></div>
    <div class="stat good"><div class="num">${pct}%</div><div class="lbl">Progress Selesai (${done.length}/${wajib.length})</div></div>
    <div class="stat warn"><div class="num">${scheduled.length}</div><div class="lbl">Terjadwal, Belum Sampling</div></div>
    <div class="stat bad"><div class="num">${failed.length}</div><div class="lbl">Gagal / Lanjut Batch</div></div>
  `;
  if(emgTriggered.length){
    document.getElementById("dashStats").innerHTML += `
    <div class="stat bad"><div class="num">${emgTriggered.length}</div><div class="lbl">Emergency Engine RH&gt;200 jam · Wajib Pantau</div></div>`;
  }

  // s-curve combined
  document.getElementById("dashSCurve").innerHTML = buildSCurveSVG(DB.batches, DB.points, "all");

  // warnings
  let warn = [];
  DB.personil.forEach(p=>{
    PERSONIL_ITEMS.forEach(it=>{
      if(PERSONIL_DATED[it] && p.items[it] && p.items[it].exp){
        const days = Math.round((new Date(p.items[it].exp) - new Date())/86400000);
        if(days<0) warn.push(`<b>${escHtml(p.nama)}</b> — ${PERSONIL_LABELS[it]} sudah expired`);
        else if(days<=30) warn.push(`<b>${escHtml(p.nama)}</b> — ${PERSONIL_LABELS[it]} expired dalam ${days} hari`);
      }
    });
  });
  failed.slice(0,8).forEach(p=>warn.push(`Titik <b>${escHtml(p.nama)}</b> (${p.site}) berstatus gagal — perlu dijadwalkan batch lanjutan`));
  emgTriggered.filter(p=>p.status!=="done").forEach(p=>{
    const rh = wajibReason(p, period).rh;
    warn.push(`<b>${escHtml(p.nama)}</b> (${p.site}) — Emergency Engine, RH 12 bulan terakhir <b>${rh} jam</b> (&gt;200 jam) &rarr; <b>wajib dipantau periode ${escHtml(period)}</b> tapi belum selesai.`);
  });
  document.getElementById("dashWarnings").innerHTML = warn.length? "<ul style='margin:0;padding-left:18px;font-size:12.5px;line-height:1.9;'>"+warn.slice(0,12).map(w=>"<li>"+w+"</li>").join("")+"</ul>" : "<div class='hint'>Tidak ada peringatan aktif.</div>";

  // per site recap
  const sites = [...new Set(pts.map(p=>p.site))];
  let rows = sites.map(s=>{
    const sp = pts.filter(p=>p.site===s && effectiveWajib(p, period));
    const d = sp.filter(p=>p.status==="done").length;
    return {site:s, total:sp.length, done:d, pct: sp.length?Math.round(d/sp.length*100):0};
  }).sort((a,b)=>b.total-a.total);
  document.getElementById("dashSiteTable").innerHTML = `
    <thead><tr><th>Site</th><th>Total Wajib</th><th>Selesai</th><th>Progress</th></tr></thead>
    <tbody>${rows.map(r=>`<tr><td>${r.site}</td><td>${r.total}</td><td>${r.done}</td>
      <td style="min-width:160px;"><div class="progressbar"><div style="width:${r.pct}%"></div></div><span class="muted" style="font-size:11px;">${r.pct}%</span></td></tr>`).join("")}</tbody>`;

  // Panel pendamping: progress per grup sumber (Turbin/Gas Engine/Emergency/Flare/dst) — sudut
  // pandang lain dari data yang sama, biar kelihatan grup mana yang paling tertinggal.
  const groupOrder = [...KATEGORI_SUMBER_ORDER];
  const groupRows = groupOrder.map(g=>{
    const gp = wajib.filter(p=>subgroupOf(p)===g);
    const d = gp.filter(p=>p.status==="done").length;
    return {label:g, done:d, total:gp.length};
  }).filter(g=>g.total>0);
  document.getElementById("dashGroupBars").innerHTML = groupRows.length
    ? groupRows.map(g=>progressBarRow(g.label, g.done, g.total)).join("")
    : "<div class='hint'>Belum ada titik wajib pantau.</div>";
}

