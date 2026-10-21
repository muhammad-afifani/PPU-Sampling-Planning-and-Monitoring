/* =========================================================
   GANTT WBS (Bar Chart) — Scheduling Tools
   ---------------------------------------------------------
   Struktur berjenjang: [Batch | Tim] › Site (kunjungan) › Jenis sumber › Titik. Datanya SAMA PERSIS
   dgn Tabel Harian: rentang site dari b.schedule, tanggal tiap titik dari dailyAssignmentForRow
   (termasuk hasil drag-drop Detail Harian), titik dikeluarkan dari b.excluded, status dari Tracking.
   Jadi kedua mode tampilan selalu selaras — WBS hanya cara baca yang berbeda.
   Model (wbsBuildModel) juga dipakai export PDF/Word/Excel di 32-schedule-export.js.
========================================================= */
let wbsScale = "day";        // day | week | month
let wbsGroup = "batch";      // batch | team | none
let wbsLevel = 2;            // node level < wbsLevel terbuka (1 = site, 2 = jenis, 3 = titik)
let wbsOpen = new Map();     // override buka/tutup manual per node id
let wbsCompact = window.innerWidth < 1600;
let wbsLastPx = 30;
const WBS_HH = 54, WBS_RH = 26;
const WBS_PX = {day:30, week:9, month:2.6};
const WBS_COLS = [
  {k:"code", label:"WBS", w:70},
  {k:"name", label:"Nama Aktivitas", w:268},
  {k:"start", label:"Mulai", w:80, full:true},
  {k:"end", label:"Selesai", w:80, full:true},
  {k:"dur", label:"Durasi", w:56, full:true},
  {k:"pct", label:"Progres", w:94}
];
const WBS_STATUS = {
  done:{label:"Selesai disampling", color:"#2f9e67"},
  late:{label:"Lewat jadwal, belum disampling", color:"#e8590c"},
  failed:{label:"Tidak disampling (sebab lain)", color:"#c0392b"},
  deferred:{label:"Ditunda ke batch berikutnya", color:"#c98a1a"},
  notdue:{label:"Belum masuk periode", color:"#9aa5b1"},
  excluded:{label:"Dikeluarkan dari batch", color:"#9aa5b1"},
  plan_emisi:{label:"Terjadwal (Emisi)", color:"#0ea5a0"},
  plan_ambient:{label:"Terjadwal (Ambient)", color:"#3d78c9"}
};
const WBS_TEAM_DARK = {emisi:"#0b7f7b", ambient:"#2f5fa3"};
function wbsDiff(a, b){ return daysBetweenInclusive(a, b) - 1; }   // b - a dalam hari
function wbsFmt(d){ return d ? `${Number(d.slice(8,10))} ${MONTH_SHORT_ID[Number(d.slice(5,7))-1]} ${d.slice(2,4)}` : "-"; }
function wbsCatOf(p){ return p.kategori==="emisi" ? (p.kategoriSumber||"Lainnya") : (NONEMISI_LABEL[p.kategori]||p.kategori); }
function wbsPointStatus(p, b, date, excluded){
  if(excluded) return "excluded";
  const t = DB.tracking[p.id] || {};
  if(p.status==="done" || t.samplingStatus==="sampled") return "done";
  if(t.samplingStatus==="other" || p.status==="failed") return "failed";
  // "Ditunda" hanya utk yg sudah lewat jadwalnya; yg dijadwalkan lagi di tanggal mendatang = rencana biasa.
  if(t.samplingStatus==="deferred" && !(date && date >= todayStr())) return "deferred";
  if(t.samplingStatus==="notdue") return "notdue";
  if(date && date < todayStr()) return "late";
  return b.team==="emisi" ? "plan_emisi" : "plan_ambient";
}

/* ---------- Model ---------- */
function wbsSiteNode(b, row, rowIdx){
  const asg = dailyAssignmentForRow(b, row);
  const dateOf = new Map();
  Object.keys(asg).forEach(d=>asg[d].points.forEach(p=>dateOf.set(p.id, d)));
  const workDates = Object.keys(asg).filter(d=>!asg[d].isBuffer).sort();
  const workEnd = workDates.length ? workDates[workDates.length-1] : row.end;
  const excluded = b.excluded || [];
  const pts = allPointsForSite(b, row.site);
  const cats = new Map();
  pts.forEach(p=>{
    const cat = wbsCatOf(p);
    if(!cats.has(cat)) cats.set(cat, []);
    const ex = excluded.includes(p.id);
    const date = ex ? null : (dateOf.get(p.id) || null);
    const siblings = AMBIENT_FAMILY.includes(p.kategori) ? DB.points.filter(x=>schedulingGroupKey(x)===schedulingGroupKey(p)) : [p];
    const st = wbsPointStatus(p, b, date, ex);
    const exReason = ex ? ((b.excludeReasons||{})[p.id]||{}).reason : null;
    cats.get(cat).push({
      id:`p:${b.id}:${p.id}`, level:3, type:"point", name:p.nama,
      note: siblings.length>1 ? `${siblings.length} parameter` : (ex ? (exReason==="batch2" ? `→ ${nextBatchLabel(b)}` : "dikeluarkan") : ""),
      start:date, end:date, status:st, done: st==="done"?1:0, total: ex?0:1, point:p, batch:b, team:b.team, excluded:ex, children:[]
    });
  });
  const catNodes = [...cats.entries()].map(([cat, kids])=>{
    kids.sort((a,c)=> (a.excluded-c.excluded) || (a.start||"9").localeCompare(c.start||"9") || a.name.localeCompare(c.name));
    const dates = kids.map(k=>k.start).filter(Boolean).sort();
    return {id:`c:${b.id}:${rowIdx}:${cat}`, level:2, type:"cat", name:cat, start:dates[0]||null, end:dates[dates.length-1]||null,
      done:kids.reduce((a,k)=>a+k.done,0), total:kids.reduce((a,k)=>a+k.total,0), team:b.team, batch:b, children:kids};
  }).sort((a,c)=>(a.start||"9").localeCompare(c.start||"9") || a.name.localeCompare(c.name));
  return {id:`s:${b.id}:${rowIdx}`, level:1, type:"site", name:row.site, site:row.site, start:row.start, end:row.end, workEnd,
    workDays:row.workDays, bufferDays:row.bufferDays||0, batch:b, rowIdx, team:b.team,
    done:catNodes.reduce((a,k)=>a+k.done,0), total:catNodes.reduce((a,k)=>a+k.total,0), children:catNodes};
}
function wbsSummarize(node){
  const kids = node.children;
  const s = kids.map(k=>k.start).filter(Boolean).sort(), e = kids.map(k=>k.end).filter(Boolean).sort();
  node.start = s[0]||null; node.end = e[e.length-1]||null;
  node.done = kids.reduce((a,k)=>a+k.done,0); node.total = kids.reduce((a,k)=>a+k.total,0);
  return node;
}
function wbsBuildModel(batches, group){
  group = group || wbsGroup;
  const siteNodes = [];
  batches.forEach(b=>(b.schedule||[]).forEach((row, idx)=>siteNodes.push(wbsSiteNode(b, row, idx))));
  let top;
  if(group==="team"){
    top = ["emisi","ambient"].map(team=>{
      const kids = siteNodes.filter(s=>s.team===team).sort((a,c)=>a.start.localeCompare(c.start));
      return kids.length ? wbsSummarize({id:`t:${team}`, level:0, type:"team", name:`Tim ${team==="emisi"?"Emisi":"Ambient"}`, team, children:kids}) : null;
    }).filter(Boolean);
  } else if(group==="none"){
    top = siteNodes.slice().sort((a,c)=>a.start.localeCompare(c.start) || a.name.localeCompare(c.name));
  } else {
    top = batches.map(b=>{
      const kids = siteNodes.filter(s=>s.batch===b);
      return kids.length ? wbsSummarize({id:`b:${b.id}`, level:0, type:"batch", name:b.name, team:b.team, batch:b, children:kids}) : null;
    }).filter(Boolean).sort((a,c)=>(a.start||"").localeCompare(c.start||""));
  }
  // Kode WBS berjenjang (1, 1.2, 1.2.3, 1.2.3.4) mengikuti urutan tampil.
  const code = (nodes, prefix)=>nodes.forEach((n,i)=>{ n.code = prefix ? `${prefix}.${i+1}` : `${i+1}`; code(n.children, n.code); });
  code(top, "");
  // Relasi FS: kunjungan site berurutan dalam batch yang sama (rute tim).
  const links = [];
  batches.forEach(b=>{ for(let i=0;i<(b.schedule||[]).length-1;i++) links.push({from:`s:${b.id}:${i}`, to:`s:${b.id}:${i+1}`}); });
  const all = [];
  const walk = n=>{ all.push(n); n.children.forEach(walk); };
  top.forEach(walk);
  const dates = all.flatMap(n=>[n.start,n.end]).filter(Boolean).sort();
  return {top, links, all, minDate:dates[0]||null, maxDate:dates[dates.length-1]||null, hasTopLevel: group!=="none"};
}
function wbsIsOpen(n){ return wbsOpen.has(n.id) ? wbsOpen.get(n.id) : n.level < wbsLevel; }
// Baris yang tampil (mengikuti buka/tutup) + info garis cabang pohon utk tiap baris.
function wbsVisibleRows(model, openFn){
  openFn = openFn || wbsIsOpen;
  const rows = [];
  const walk = (nodes, depth, trail)=>nodes.forEach((n,i)=>{
    const isLast = i===nodes.length-1;
    rows.push({node:n, depth, trail, isLast});
    if(n.children.length && openFn(n)) walk(n.children, depth+1, trail.concat([isLast]));
  });
  walk(model.top, 0, []);
  return rows;
}
function wbsRange(model, scale){
  let s = model.minDate, e = model.maxDate;
  if(!s) return null;
  if(scale==="week"){ const dow = (dayOfWeek(s)+6)%7; s = addDays(s, -dow); const dowE = (dayOfWeek(e)+6)%7; e = addDays(e, 6-dowE); }
  else if(scale==="month"){ s = s.slice(0,8)+"01"; const [y,m] = e.split("-").map(Number); const last = new Date(y, m, 0).getDate(); e = `${e.slice(0,8)}${String(last).padStart(2,"0")}`; }
  else { s = addDays(s,-1); e = addDays(e,2); }
  return {start:s, end:e, days:daysBetweenInclusive(s,e)};
}

/* ---------- Skala waktu (dipakai layar & cetak) ---------- */
// Mengembalikan isi <svg> header 2 tingkat + daftar garis grid vertikal & kolom akhir pekan.
function wbsScaleParts(range, px, scale, H){
  H = H || 54;
  const half = H/2;
  const x = d=>wbsDiff(range.start, d)*px;
  let top = "", bottom = "", grid = [], weekend = [];
  const runs = (keyFn, labelFn)=>{
    const out = []; let cur = null;
    for(let i=0;i<range.days;i++){
      const d = addDays(range.start,i), k = keyFn(d);
      if(!cur || cur.k!==k){ cur = {k, start:d, n:0, label:labelFn(d)}; out.push(cur); }
      cur.n++;
    }
    return out;
  };
  const monthRuns = runs(d=>d.slice(0,7), d=>`${MONTH_SHORT_ID[Number(d.slice(5,7))-1]} ${d.slice(0,4)}`);
  const tier1 = scale==="month" ? runs(d=>d.slice(0,4), d=>d.slice(0,4)) : monthRuns;
  tier1.forEach(r=>{
    const x0 = x(r.start), w = r.n*px;
    top += `<rect x="${x0}" y="0" width="${w}" height="${half}" class="wbs-h1"/><text x="${x0+Math.min(w/2, Math.max(28, w/2))}" y="${half-7}" text-anchor="middle" class="wbs-h1t">${w>34?escHtml(r.label):""}</text><line x1="${x0}" y1="0" x2="${x0}" y2="${half}" class="wbs-hl1"/>`;
  });
  if(scale==="day"){
    for(let i=0;i<range.days;i++){
      const d = addDays(range.start,i), dow = dayOfWeek(d), x0 = i*px;
      const we = dow===0||dow===6;
      if(we) weekend.push([x0, px]);
      bottom += `<rect x="${x0}" y="${half}" width="${px}" height="${half}" class="wbs-h2${we?" we":""}"/><text x="${x0+px/2}" y="${half+10}" text-anchor="middle" class="wbs-h2d">${DOW_SHORT_ID[dow].slice(0,1)}</text><text x="${x0+px/2}" y="${H-6}" text-anchor="middle" class="wbs-h2t">${Number(d.slice(8,10))}</text>`;
      grid.push(x0);
    }
  } else if(scale==="week"){
    for(let i=0;i<range.days;i+=7){
      const d = addDays(range.start,i), x0 = i*px, w = 7*px;
      bottom += `<rect x="${x0}" y="${half}" width="${w}" height="${half}" class="wbs-h2"/><text x="${x0+w/2}" y="${H-7}" text-anchor="middle" class="wbs-h2t">${w>36?`${Number(d.slice(8,10))} ${MONTH_SHORT_ID[Number(d.slice(5,7))-1]}`:Number(d.slice(8,10))}</text>`;
      grid.push(x0);
      for(let k=0;k<7;k++){ const dw = dayOfWeek(addDays(d,k)); if(dw===0||dw===6) weekend.push([x0+k*px, px]); }
    }
  } else {
    monthRuns.forEach(r=>{
      const x0 = x(r.start), w = r.n*px;
      bottom += `<rect x="${x0}" y="${half}" width="${w}" height="${half}" class="wbs-h2"/><text x="${x0+w/2}" y="${H-7}" text-anchor="middle" class="wbs-h2t">${w>26?MONTH_SHORT_ID[Number(r.start.slice(5,7))-1]:""}</text>`;
      grid.push(x0);
    });
  }
  return {top, bottom, grid, weekend, monthStarts: monthRuns.map(r=>x(r.start))};
}

/* ---------- Bar per baris (dipakai layar & cetak) ---------- */
function wbsCaps(x0, x1, mid, h, color){
  const t = Math.min(6, Math.max(3,(x1-x0)/3));
  return `<polygon points="${x0},${mid-h/2} ${x0+t},${mid-h/2} ${x0},${mid+h/2+4}" fill="${color}"/><polygon points="${x1-t},${mid-h/2} ${x1},${mid-h/2} ${x1},${mid+h/2+4}" fill="${color}"/>`;
}
function wbsBarSvg(n, x, mid, px, opts){
  opts = opts||{};
  if(!n.start) return "";
  const x0 = x(n.start), x1 = x(n.end) + px;
  const labelX = x1 + 6;
  const lbl = (txt, cls)=> opts.noLabels ? "" : `<text x="${labelX}" y="${mid+4}" class="${cls||"wbs-blbl"}">${escHtml(txt)}</text>`;
  if(n.type==="batch" || n.type==="team"){
    const c = "#1f2937";
    return `<g class="wbs-sum"><rect x="${x0}" y="${mid-3}" width="${Math.max(2,x1-x0)}" height="5" fill="${c}"/>${wbsCaps(x0,x1,mid-0.5,5,c)}</g>${lbl(`${n.name} · ${wbsFmt(n.start)} → ${wbsFmt(n.end)}`, "wbs-blbl strong")}`;
  }
  if(n.type==="site"){
    const dark = WBS_TEAM_DARK[n.team]||"#334155";
    const xw = x(n.workEnd) + px;
    const pct = n.total ? n.done/n.total : 0;
    const h = opts.small ? 9 : 12;
    let s = `<rect x="${x0}" y="${mid-h/2}" width="${Math.max(2,xw-x0)}" height="${h}" rx="2" fill="${dark}" opacity=".32"/>`;
    s += `<rect x="${x0}" y="${mid-h/2}" width="${Math.max(0,(xw-x0)*pct)}" height="${h}" rx="2" fill="${dark}"/>`;
    if(x1>xw+0.5) s += `<rect x="${xw}" y="${mid-h/2}" width="${x1-xw}" height="${h}" rx="2" fill="url(#wbsHatch)" stroke="${dark}" stroke-width=".8" stroke-dasharray="2 2"/>`;
    return s + lbl(`${n.name} — ${n.done}/${n.total} titik`, "wbs-blbl strong");
  }
  if(n.type==="cat"){
    const c = "#64748b";
    return `<rect x="${x0}" y="${mid-2}" width="${Math.max(2,x1-x0)}" height="4" fill="${c}"/>${wbsCaps(x0,x1,mid,4,c)}`;
  }
  const st = WBS_STATUS[n.status] || WBS_STATUS.plan_emisi;
  const w = Math.max(4, x1-x0-2), h = opts.small ? 8 : 11;
  return `<rect x="${x0+1}" y="${mid-h/2}" width="${w}" height="${h}" rx="2.5" fill="${st.color}"><title>${escHtml(n.name)} · ${escHtml(n.start)} · ${escHtml(st.label)}</title></rect>${px>=20?lbl(n.name):""}`;
}

/* ---------- Render layar ---------- */
function wbsToolbarHtml(){
  const seg = (action, cur, opts)=>`<div class="hd-seg-group" role="group">${opts.map(([v,l])=>`<button type="button" class="${String(v)===String(cur)?"on":""}" aria-pressed="${String(v)===String(cur)}" data-action="${action}" data-val="${v}">${l}</button>`).join("")}</div>`;
  return `<div class="wbs-tool"><span class="wbs-tool-lbl">Kelompok</span>${seg("wbsSetGroup", wbsGroup, [["batch","Batch"],["team","Tim"],["none","Site saja"]])}</div>
    <div class="wbs-tool"><span class="wbs-tool-lbl">Skala</span>${seg("wbsSetScale", wbsScale, [["day","Hari"],["week","Minggu"],["month","Bulan"]])}</div>
    <div class="wbs-tool"><span class="wbs-tool-lbl">Buka sampai</span>${seg("wbsSetLevel", wbsLevel, [[1,"Site"],[2,"Jenis sumber"],[3,"Titik"]])}</div>
    <div class="wbs-tool"><span class="wbs-tool-lbl">Kolom</span>${seg("wbsSetCompact", wbsCompact?"1":"0", [["0","Lengkap"],["1","Ringkas"]])}</div>
    <button type="button" class="btn small ghost" data-action="wbsScrollToday" title="Geser timeline ke hari ini">Hari ini</button>`;
}
function wbsTreeHtml(r){
  let s = "";
  for(let i=1;i<r.trail.length;i++) s += `<span class="wbs-ind ${r.trail[i]?"n":"v"}"></span>`;
  if(r.depth>0) s += `<span class="wbs-ind ${r.isLast?"l":"t"}"></span>`;
  return s;
}
function wbsRender(batches){
  const tb = document.getElementById("wbsToolbar");
  if(tb) tb.innerHTML = wbsToolbarHtml();
  const model = wbsBuildModel(batches);
  const meta = document.getElementById("ganttMeta");
  if(!model.top.length){
    if(meta) meta.textContent = "";
    return "<div class='hint' style='padding:16px;'>Belum ada jadwal untuk ditampilkan. Buka halaman <b>Perencanaan Batch</b>, isi tanggal mulai, lalu klik <b>Buat &amp; Terapkan Jadwal</b>.</div>";
  }
  const range = wbsRange(model, wbsScale);
  const rows = wbsVisibleRows(model);
  if(meta){
    const sites = model.all.filter(n=>n.type==="site").length, pts = model.all.filter(n=>n.type==="point" && !n.excluded).length;
    meta.innerHTML = `<b>${wbsFmt(model.minDate)}</b> &rarr; <b>${wbsFmt(model.maxDate)}</b> &middot; ${daysBetweenInclusive(model.minDate, model.maxDate)} hari &middot; ${sites} kunjungan site &middot; ${pts} titik`;
  }
  const cols = WBS_COLS.filter(c=>!(wbsCompact && c.full));
  const LW = cols.reduce((a,c)=>a+c.w,0);
  // Skala minimum per hari; kalau rentangnya pendek, timeline direntangkan memenuhi lebar kartu.
  const avail = Math.max(0, ((document.getElementById("ganttWrap")||{}).clientWidth||0) - LW - 4);
  const px = Math.max(WBS_PX[wbsScale], avail/range.days);
  wbsLastPx = px;
  const CW = Math.ceil(range.days*px);
  const H = rows.length*WBS_RH;
  const x = d=>wbsDiff(range.start, d)*px;
  const parts = wbsScaleParts(range, px, wbsScale, WBS_HH);
  const today = todayStr();
  const tx = (today>=range.start && today<=range.end) ? x(today)+px/2 : null;
  const tmpl = cols.map(c=>c.w+"px").join(" ");

  // Grid kiri
  const head = `<div class="wbs-lhead" style="grid-template-columns:${tmpl}">${cols.map(c=>`<div class="wbs-hc ${c.k}">${c.label}</div>`).join("")}</div>`;
  const lrows = rows.map((r,i)=>{
    const n = r.node;
    const pct = n.total ? Math.round(n.done/n.total*100) : (n.type==="point" ? (n.done?100:0) : 0);
    const hasKids = n.children.length>0;
    const open = hasKids && wbsIsOpen(n);
    const tog = hasKids ? `<button type="button" class="wbs-tog" data-action="wbsToggle" data-id="${escHtml(n.id)}" aria-expanded="${open}" aria-label="${open?"Tutup":"Buka"} ${escHtml(n.name)}">${open?"&minus;":"+"}</button>` : `<span class="wbs-tog-sp"></span>`;
    let nameBtn = `<span class="wbs-name">${escHtml(n.name)}</span>`;
    if(n.type==="site") nameBtn = `<button type="button" class="wbs-name link" data-action="openDayDetail" data-batch-id="${n.batch.id}" data-row-idx="${n.rowIdx}" title="Buka Detail Harian site ini (atur titik per hari)">${escHtml(n.name)}</button>`;
    if(n.type==="point") nameBtn = `<button type="button" class="wbs-name link" data-action="wbsOpenPoint" data-id="${n.point.id}" title="Buka detail tracking titik ini">${escHtml(n.name)}</button>`;
    const tag = n.type==="site" && wbsGroup!=="batch" ? `<span class="wbs-tag">${escHtml((n.batch.name.match(/Batch\s*\d+/i)||[n.batch.name])[0])}</span>`
      : n.type==="point" && n.note ? `<span class="wbs-tag ${n.excluded?"ex":""}">${escHtml(n.note)}</span>` : "";
    const stDot = n.type==="point" ? `<span class="wbs-sdot" style="background:${(WBS_STATUS[n.status]||{}).color}" title="${escHtml((WBS_STATUS[n.status]||{}).label||"")}"></span>` : "";
    const dur = n.type==="site" ? `${n.workDays}h${n.bufferDays?` +${n.bufferDays}`:""}` : (n.start ? `${daysBetweenInclusive(n.start,n.end)}h` : "-");
    const cells = {
      code:`<div class="wbs-c code">${escHtml(n.code)}</div>`,
      name:`<div class="wbs-c name">${wbsTreeHtml(r)}${tog}${stDot}${nameBtn}${tag}</div>`,
      start:`<div class="wbs-c date">${wbsFmt(n.start)}</div>`,
      end:`<div class="wbs-c date">${wbsFmt(n.end)}</div>`,
      dur:`<div class="wbs-c num">${dur}</div>`,
      pct:`<div class="wbs-c pct">${n.type==="point" ? (n.excluded?`<span class="muted">—</span>`:`<span class="wbs-st" style="--c:${(WBS_STATUS[n.status]||{}).color}">${n.done?"Selesai":n.status==="late"?"Terlambat":n.status==="failed"?"Gagal":n.status==="deferred"?"Ditunda":"Terjadwal"}</span>`) : `<span class="wbs-pbar"><i style="width:${pct}%"></i></span><b>${pct}%</b>`}</div>`
    };
    return `<div class="wbs-row lv${n.level} t-${n.type}" data-i="${i}" style="grid-template-columns:${tmpl}">${cols.map(c=>cells[c.k]).join("")}</div>`;
  }).join("");

  // Timeline
  let bg = "";
  rows.forEach((r,i)=>{ const lv = r.node.level; if(lv<=1) bg += `<rect x="0" y="${i*WBS_RH}" width="${CW}" height="${WBS_RH}" class="wbs-band lv${lv}"/>`; });
  parts.weekend.forEach(([wx,w])=>{ bg += `<rect x="${wx}" y="0" width="${w}" height="${H}" class="wbs-we"/>`; });
  parts.grid.forEach(gx=>{ bg += `<line x1="${gx}" y1="0" x2="${gx}" y2="${H}" class="wbs-gl"/>`; });
  parts.monthStarts.forEach(gx=>{ bg += `<line x1="${gx}" y1="0" x2="${gx}" y2="${H}" class="wbs-gm"/>`; });
  for(let i=1;i<=rows.length;i++) bg += `<line x1="0" y1="${i*WBS_RH}" x2="${CW}" y2="${i*WBS_RH}" class="wbs-gh"/>`;
  const rowIndex = new Map(rows.map((r,i)=>[r.node.id, i]));
  let links = "";
  model.links.forEach(l=>{
    const a = rowIndex.get(l.from), b = rowIndex.get(l.to);
    if(a==null || b==null) return;
    const na = rows[a].node, nb = rows[b].node;
    const x1 = x(na.end)+px, y1 = a*WBS_RH+WBS_RH/2, x2 = x(nb.start), y2 = b*WBS_RH+WBS_RH/2;
    const d = x2 >= x1+14 ? `M${x1},${y1} H${x1+7} V${y2} H${x2-1}` : `M${x1},${y1} H${x1+7} V${y1+WBS_RH/2} H${x2-9} V${y2} H${x2-1}`;
    links += `<path d="${d}" class="wbs-link" marker-end="url(#wbsArrow)"/>`;
  });
  const bars = rows.map((r,i)=>wbsBarSvg(r.node, x, i*WBS_RH+WBS_RH/2, px)).join("");
  const defs = `<defs><pattern id="wbsHatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="#fff"/><line x1="0" y1="0" x2="0" y2="5" stroke="#94a3b8" stroke-width="2"/></pattern><marker id="wbsArrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L8,4 L0,8 z" fill="#334155"/></marker></defs>`;
  const todaySvg = tx!=null ? `<line x1="${tx}" y1="0" x2="${tx}" y2="${H}" class="wbs-today"/>` : "";
  const headSvg = `<svg width="${CW}" height="${WBS_HH}" class="wbs-svg">${parts.top}${parts.bottom}${tx!=null?`<line x1="${tx}" y1="${WBS_HH/2}" x2="${tx}" y2="${WBS_HH}" class="wbs-today"/><circle cx="${tx}" cy="${WBS_HH-4}" r="3" fill="#dc2626"/>`:""}</svg>`;
  const bodySvg = `<svg width="${CW}" height="${H}" class="wbs-svg" id="wbsBodySvg">${defs}${bg}<rect id="wbsHl" x="0" y="-100" width="${CW}" height="${WBS_RH}" class="wbs-hlrect"/>${todaySvg}${links}${bars}</svg>`;

  const legend = `<div class="legend gn-legend wbs-legend">
    <span class="item"><svg width="30" height="12" class="wbs-sum"><rect x="0" y="4" width="30" height="4" fill="#1f2937"/><polygon points="0,4 5,4 0,11" fill="#1f2937"/><polygon points="25,4 30,4 30,11" fill="#1f2937"/></svg> Ringkasan batch/tim</span>
    <span class="item"><svg width="34" height="12"><rect x="0" y="0" width="22" height="12" rx="2" fill="#0b7f7b" opacity=".32"/><rect x="0" y="0" width="12" height="12" rx="2" fill="#0b7f7b"/><rect x="22" y="0" width="12" height="12" fill="url(#wbsHatchL)" stroke="#0b7f7b" stroke-dasharray="2 2"/><defs><pattern id="wbsHatchL" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="#fff"/><line x1="0" y1="0" x2="0" y2="5" stroke="#94a3b8" stroke-width="2"/></pattern></defs></svg> Kunjungan site (gelap = progres, arsir = buffer)</span>
    <span class="item"><svg width="26" height="12"><rect x="0" y="4" width="26" height="4" fill="#64748b"/></svg> Jenis sumber</span>
    ${["plan_emisi","plan_ambient","done","late","deferred","failed"].map(k=>`<span class="item"><span class="sw" style="background:${WBS_STATUS[k].color}"></span>${WBS_STATUS[k].label}</span>`).join("")}
    <span class="item"><svg width="28" height="12"><path d="M0,3 H8 V9 H26" fill="none" stroke="#334155" stroke-width="1.2"/><path d="M22,6 L28,9 L22,12z" fill="#334155"/></svg> Relasi Finish-to-Start antar site</span>
    <span class="item"><span class="sw" style="background:#dc2626;width:3px;"></span> Hari ini</span>
  </div>`;
  return `<div class="wbs-scroll" id="wbsScroll"><div class="wbs-grid" style="grid-template-columns:${LW}px ${CW}px;width:${LW+CW}px;">
    ${head}<div class="wbs-chead">${headSvg}</div>
    <div class="wbs-lbody">${lrows}</div><div class="wbs-cbody">${bodySvg}</div>
  </div></div>${legend}`;
}
function wbsAfterRender(){
  const sc = document.getElementById("wbsScroll");
  if(sc && wbsPendingTodayScroll){ wbsPendingTodayScroll = false; wbsScrollToday(); }
}
let wbsPendingTodayScroll = false;
function wbsScrollToday(){
  const sc = document.getElementById("wbsScroll"); if(!sc) return;
  const model = wbsBuildModel(ganttSelectedBatches());
  const range = wbsRange(model, wbsScale); if(!range) return;
  const today = todayStr();
  const lw = (document.querySelector("#wbsScroll .wbs-lhead")||{}).offsetWidth || 0;
  const target = (today<range.start ? 0 : wbsDiff(range.start, today>range.end?range.end:today))*wbsLastPx;
  sc.scrollTo({left: Math.max(0, target - (sc.clientWidth-lw)/2), behavior:"smooth"});
}
// Sorot baris yang sama di grid kiri & timeline saat kursor di atasnya.
document.addEventListener("mouseover", e=>{
  const row = e.target.closest && e.target.closest("#wbsScroll .wbs-row");
  const hl = document.getElementById("wbsHl");
  if(!hl) return;
  hl.setAttribute("y", row ? Number(row.dataset.i)*WBS_RH : -100);
  document.querySelectorAll("#wbsScroll .wbs-row.hover").forEach(r=>{ if(r!==row) r.classList.remove("hover"); });
  if(row) row.classList.add("hover");
});
function wbsRerender(){ renderGantt(); }
Object.assign(ACTIONS, {
  ganttToggleTeam, ganttToggleBatch, batchPickerMenu, ganttBatchAll,
  wbsSetGroup:(t)=>{ wbsGroup = t.dataset.val; wbsOpen.clear(); wbsRerender(); },
  wbsSetScale:(t)=>{ wbsScale = t.dataset.val; wbsRerender(); },
  wbsSetLevel:(t)=>{ wbsLevel = Number(t.dataset.val); wbsOpen.clear(); wbsRerender(); },
  wbsSetCompact:(t)=>{ wbsCompact = t.dataset.val==="1"; wbsRerender(); },
  wbsToggle:(t)=>{
    const id = t.dataset.id;
    const model = wbsBuildModel(ganttSelectedBatches());
    const n = model.all.find(x=>x.id===id); if(!n) return;
    wbsOpen.set(id, !wbsIsOpen(n));
    const sc = document.getElementById("wbsScroll"), pos = sc ? {l:sc.scrollLeft, t:sc.scrollTop} : null;
    wbsRerender();
    const sc2 = document.getElementById("wbsScroll"); if(sc2 && pos){ sc2.scrollLeft = pos.l; sc2.scrollTop = pos.t; }
  },
  wbsScrollToday,
  wbsOpenPoint:(t)=>{ if(typeof trkOpenDetail==="function") trkOpenDetail(t.dataset.id); }
});
