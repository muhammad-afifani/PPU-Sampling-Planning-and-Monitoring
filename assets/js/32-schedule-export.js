/* =========================================================
   EXPORT JADWAL WBS — PDF (cetak), Word (.docx), Excel (.xlsx)
   ---------------------------------------------------------
   Semua memakai model yang sama dgn Gantt WBS di layar (wbsBuildModel, 31-wbs-gantt.js), jadi isi
   export = isi layar. PDF & Word mengikuti baris yang sedang TERBUKA (atur lewat "Buka sampai" /
   tombol +/−), Excel memuat SEMUA level dgn outline Excel (bisa dibuka/tutup level 1-3 di Excel).
   Word & Excel ditulis langsung (WordprocessingML / SpreadsheetML + ZIP dari 29-docx-export.js),
   tanpa library tambahan, supaya warna bar, header berulang & outline benar-benar terbawa.
========================================================= */
function wbsExportContext(){
  const batches = ganttSelectedBatches();
  const model = wbsBuildModel(batches);
  if(!model.top.length){ toast("Belum ada jadwal pada Tim/Batch terpilih untuk diekspor.","err"); return null; }
  const teams = [...new Set(batches.map(b=>b.team))].map(t=>t==="emisi"?"Emisi":"Ambient");
  return {
    batches, model, rows: wbsVisibleRows(model),
    title: "Jadwal Sampling Pemantauan Lingkungan (WBS)",
    sub: `Tim ${teams.join(" & ")} · ${batches.length} batch: ${batches.map(b=>b.name).join(", ")}`,
    periode: `${wbsFmtLong(model.minDate)} s.d. ${wbsFmtLong(model.maxDate)} (${daysBetweenInclusive(model.minDate, model.maxDate)} hari)`,
    printedAt: new Date().toLocaleString("id-ID",{dateStyle:"long", timeStyle:"short"}),
    fileBase: `Jadwal WBS_${teams.join("-")}_${DB.meta.semester} ${DB.meta.tahun}`
  };
}
function wbsFmtLong(d){ return d ? `${Number(d.slice(8,10))} ${MONTH_SHORT_ID[Number(d.slice(5,7))-1]} ${d.slice(0,4)}` : "-"; }
function wbsAutoUnit(days){ return days<=35 ? "day" : days<=200 ? "week" : "month"; }
// Daftar periode kolom timeline (hari/minggu/bulan) utk tabel Word & Excel.
function wbsPeriods(range, unit){
  const out = [];
  if(unit==="day"){
    for(let i=0;i<range.days;i++){ const d = addDays(range.start,i), dw = dayOfWeek(d); out.push({start:d, end:d, label:String(Number(d.slice(8,10))), mkey:d.slice(0,7), we:dw===0||dw===6}); }
  } else if(unit==="week"){
    for(let i=0;i<range.days;i+=7){ const d = addDays(range.start,i); out.push({start:d, end:addDays(d,6), label:`${Number(d.slice(8,10))}/${Number(d.slice(5,7))}`, mkey:d.slice(0,7)}); }
  } else {
    let d = range.start;
    while(d<=range.end){
      const [y,m] = d.split("-").map(Number), last = new Date(y,m,0).getDate();
      const e = `${d.slice(0,8)}${String(last).padStart(2,"0")}`;
      out.push({start:d, end:e, label:MONTH_SHORT_ID[m-1], mkey:d.slice(0,4)});
      d = addDays(e,1);
    }
  }
  return out;
}
function wbsMonthLabel(mkey){ return mkey.length===4 ? mkey : `${MONTH_SHORT_ID[Number(mkey.slice(5,7))-1]} ${mkey.slice(0,4)}`; }
function wbsBarColor(n){
  if(n.type==="batch" || n.type==="team") return "1F2937";
  if(n.type==="site") return (WBS_TEAM_DARK[n.team]||"#334155").slice(1).toUpperCase();
  if(n.type==="cat") return "94A3B8";
  return ((WBS_STATUS[n.status]||WBS_STATUS.plan_emisi).color).slice(1).toUpperCase();
}
function wbsNodePct(n){ return n.type==="point" ? (n.excluded ? null : n.done) : (n.total ? n.done/n.total : 0); }
function wbsNodeDur(n){ return n.type==="site" ? `${n.workDays}h${n.bufferDays?` +${n.bufferDays} buffer`:""}` : (n.start ? `${daysBetweenInclusive(n.start,n.end)}h` : "-"); }
function wbsNodeLabel(n){ return n.name + (n.type==="site" && wbsGroup!=="batch" ? ` (${(n.batch.name.match(/Batch\s*\d+/i)||[n.batch.name])[0]})` : "") + (n.type==="point" && n.note ? ` — ${n.note}` : ""); }
function wbsStatusText(n){
  if(n.type!=="point") return `${Math.round((wbsNodePct(n)||0)*100)}%`;
  if(n.excluded) return "—";
  return {done:"Selesai", late:"Terlambat", failed:"Gagal", deferred:"Ditunda", notdue:"Belum periode"}[n.status] || "Rencana";
}

/* ---------- PDF (cetak) ---------- */
function buildWbsPrintHtml(ctx){
  const {model, rows} = ctx;
  const unit = wbsAutoUnit(daysBetweenInclusive(model.minDate, model.maxDate));
  const range = wbsRange(model, unit);
  const TW = 560, px = TW/range.days;
  const x = d=>wbsDiff(range.start, d)*px;
  const parts = wbsScaleParts(range, px, unit, 30);
  const defs = `<defs><pattern id="wbsHatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="#fff"/><line x1="0" y1="0" x2="0" y2="5" stroke="#94a3b8" stroke-width="2"/></pattern></defs>`;
  const gridLines = parts.grid.map(g=>`<line x1="${g}" y1="0" x2="${g}" y2="16" stroke="#e5e9ef" stroke-width=".6"/>`).join("") + parts.monthStarts.map(g=>`<line x1="${g}" y1="0" x2="${g}" y2="16" stroke="#b8c2d0" stroke-width=".8"/>`).join("");
  const today = todayStr();
  const tx = (today>=range.start && today<=range.end) ? x(today)+px/2 : null;
  const body = rows.map(r=>{
    const n = r.node;
    const svg = `<svg width="${TW}" height="16" class="pg-wbs-svg">${gridLines}${tx!=null?`<line x1="${tx}" y1="0" x2="${tx}" y2="16" stroke="#dc2626" stroke-width=".8" stroke-dasharray="2 2"/>`:""}${wbsBarSvg(n, x, 8, px, {noLabels:true, small:true})}</svg>`;
    return `<tr class="lv${n.level}"><td class="c">${escHtml(n.code)}</td><td class="nm" style="padding-left:${4+r.depth*9}px">${escHtml(wbsNodeLabel(n))}</td><td>${wbsFmt(n.start)}</td><td>${wbsFmt(n.end)}</td><td class="r">${escHtml(wbsNodeDur(n).replace(" buffer",""))}</td><td class="r">${escHtml(wbsStatusText(n))}</td><td class="tl">${svg}</td></tr>`;
  }).join("");
  const unitLabel = {day:"harian", week:"mingguan", month:"bulanan"}[unit];
  const legend = [["Ringkasan batch/tim","#1f2937"],["Kunjungan site","#0b7f7b"],["Jenis sumber","#94a3b8"],["Rencana Emisi",WBS_STATUS.plan_emisi.color],["Rencana Ambient",WBS_STATUS.plan_ambient.color],["Selesai",WBS_STATUS.done.color],["Terlambat",WBS_STATUS.late.color],["Ditunda",WBS_STATUS.deferred.color],["Gagal",WBS_STATUS.failed.color]]
    .map(([l,c])=>`<span><i style="background:${c}"></i>${l}</span>`).join("");
  return `<div class="pg-wbs">
    <div class="pg-wbs-head"><div><h1>${escHtml(ctx.title)}</h1><div class="sub">${escHtml(ctx.sub)}</div><div class="sub">Periode ${escHtml(ctx.periode)} &middot; skala ${unitLabel}</div></div><div class="pg-wbs-meta">Dicetak ${escHtml(ctx.printedAt)}</div></div>
    <table class="pg-wbs-table"><thead><tr><th class="c">WBS</th><th>Nama Aktivitas</th><th>Mulai</th><th>Selesai</th><th class="r">Durasi</th><th class="r">Progres</th><th class="tl"><svg width="${TW}" height="30" class="pg-wbs-svg">${defs}${parts.top}${parts.bottom}</svg></th></tr></thead>
    <tbody>${body}</tbody></table>
    <div class="pg-wbs-legend">${legend}</div>
  </div>`;
}
async function wbsExportPdf(){
  const ctx = wbsExportContext(); if(!ctx) return;
  setPrintOrientation("landscape", 10, {pageNumber:true});
  document.getElementById("printGuideArea").innerHTML = buildWbsPrintHtml(ctx);
  const originalTitle = document.title;
  document.title = ctx.fileBase;
  window.print();
  document.title = originalTitle;
}

/* ---------- Word (.docx) ---------- */
function sxCell(w, content, o){
  o = o||{};
  const pr = [`<w:tcW w:w="${w}" w:type="dxa"/>`];
  if(o.span>1) pr.push(`<w:gridSpan w:val="${o.span}"/>`);
  if(o.vMerge) pr.push(o.vMerge==="restart" ? `<w:vMerge w:val="restart"/>` : `<w:vMerge/>`);
  const bc = o.bc || "D9DEE6";
  pr.push(`<w:tcBorders><w:top w:val="single" w:sz="2" w:space="0" w:color="${bc}"/><w:left w:val="single" w:sz="2" w:space="0" w:color="${bc}"/><w:bottom w:val="single" w:sz="2" w:space="0" w:color="${bc}"/><w:right w:val="single" w:sz="2" w:space="0" w:color="${bc}"/></w:tcBorders>`);
  if(o.fill) pr.push(`<w:shd w:val="clear" w:color="auto" w:fill="${o.fill}"/>`);
  pr.push(`<w:tcMar><w:top w:w="${o.padV==null?20:o.padV}" w:type="dxa"/><w:left w:w="${o.padH==null?50:o.padH}" w:type="dxa"/><w:bottom w:w="${o.padV==null?20:o.padV}" w:type="dxa"/><w:right w:w="${o.padH==null?50:o.padH}" w:type="dxa"/></w:tcMar>`);
  pr.push(`<w:vAlign w:val="${o.vAlign||"center"}"/>`);
  return `<w:tc><w:tcPr>${pr.join("")}</w:tcPr>${content}</w:tc>`;
}
function sxText(t, o){
  o = o||{};
  return dxP(dxRun(t, {b:o.b, sz:o.sz||14, color:o.color}), {jc:o.jc||"left", ind:o.ind||0, markSz:o.sz||14});
}
function buildWbsDocx(ctx){
  const {model, rows} = ctx;
  const unit = wbsAutoUnit(daysBetweenInclusive(model.minDate, model.maxDate));
  const range = wbsRange(model, unit);
  const periods = wbsPeriods(range, unit);
  const PW = 16838, PH = 11906, M = 567, CWt = PW - 2*M;
  const fixed = [760, 3700, 1120, 1120, 820, 760];
  const fixedW = fixed.reduce((a,b)=>a+b,0);
  const pw = Math.max(120, Math.floor((CWt - fixedW)/periods.length));
  const widths = fixed.concat(periods.map(()=>pw));
  const today = todayStr();
  const HDR = "12294A";
  // Header 2 baris (diulang tiap halaman): kolom tetap digabung vertikal, bulan digabung horizontal.
  const monthRuns = [];
  periods.forEach(p=>{ const l = monthRuns[monthRuns.length-1]; if(l && l.k===p.mkey) l.n++; else monthRuns.push({k:p.mkey, n:1}); });
  const fixedHeads = ["WBS","Nama Aktivitas","Mulai","Selesai","Durasi","Progres"];
  const hText = (t, jc)=>sxText(t, {b:true, sz:13, color:"FFFFFF", jc});
  const head1 = dxRow(fixedHeads.map((h,i)=>sxCell(fixed[i], hText(h, i>=4?"right":"left"), {fill:HDR, vMerge:"restart", bc:"3A4E6E"}))
    .concat(monthRuns.map(r=>sxCell(pw*r.n, hText(wbsMonthLabel(r.k), "center"), {fill:"0F1F38", span:r.n, bc:"3A4E6E"}))), {header:true});
  const head2 = dxRow(fixedHeads.map((h,i)=>sxCell(fixed[i], dxP("",{markSz:12}), {fill:HDR, vMerge:"continue", bc:"3A4E6E"}))
    .concat(periods.map(p=>{
      const isToday = today>=p.start && today<=p.end;
      return sxCell(pw, sxText(p.label, {b:true, sz:11, color:isToday?"FCA5A5":"E6EDF6", jc:"center"}), {fill:p.we?"1F3558":"16294A", bc:"3A4E6E", padH:10});
    })), {header:true});
  const bands = {0:"E6EBF2", 1:"E3F4F3", 2:"F3F5F8"};
  const body = rows.map(r=>{
    const n = r.node, band = bands[n.level], bold = n.level<=1;
    const color = wbsBarColor(n);
    const cells = [
      sxCell(fixed[0], sxText(n.code, {sz:12, color:"64748B"}), {fill:band}),
      sxCell(fixed[1], sxText(wbsNodeLabel(n), {b:bold, sz:14, ind:r.depth*160}), {fill:band}),
      sxCell(fixed[2], sxText(wbsFmt(n.start), {b:bold, sz:13}), {fill:band}),
      sxCell(fixed[3], sxText(wbsFmt(n.end), {b:bold, sz:13}), {fill:band}),
      sxCell(fixed[4], sxText(wbsNodeDur(n).replace(" buffer",""), {sz:13, jc:"right"}), {fill:band}),
      sxCell(fixed[5], sxText(wbsStatusText(n), {b:bold, sz:13, jc:"right"}), {fill:band})
    ];
    periods.forEach(p=>{
      const on = n.start && n.start<=p.end && n.end>=p.start;
      cells.push(sxCell(pw, dxP("",{markSz:8}), {fill: on ? color : (p.we ? "F1F3F6" : band), padH:0, padV:0}));
    });
    return dxRow(cells, {height:300});
  }).join("");
  const tbl = `<w:tbl><w:tblPr><w:tblW w:w="${widths.reduce((a,b)=>a+b,0)}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="20" w:type="dxa"/><w:left w:w="50" w:type="dxa"/><w:bottom w:w="20" w:type="dxa"/><w:right w:w="50" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${widths.map(w=>`<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>${head1}${head2}${body}</w:tbl>`;
  const unitLabel = {day:"harian", week:"mingguan", month:"bulanan"}[unit];
  // Legenda warna: tabel kecil kotak warna + keterangan.
  const legendItems = [["Ringkasan batch/tim","1F2937"],["Kunjungan site Emisi","0B7F7B"],["Kunjungan site Ambient","2F5FA3"],["Jenis sumber","94A3B8"],["Rencana Emisi","0EA5A0"],["Rencana Ambient","3D78C9"],["Selesai","2F9E67"],["Terlambat","E8590C"],["Ditunda","C98A1A"],["Gagal","C0392B"]];
  const lw = [];
  const legendCells = [];
  legendItems.forEach(([l,c])=>{ lw.push(220, 1350); legendCells.push(sxCell(220, dxP("",{markSz:10}), {fill:c, bc:"FFFFFF", padH:0}), sxCell(1350, sxText(l,{sz:12, color:"475569"}), {bc:"FFFFFF"})); });
  const legend = `<w:tbl><w:tblPr><w:tblW w:w="${lw.reduce((a,b)=>a+b,0)}" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${lw.map(w=>`<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>${dxRow(legendCells)}</w:tbl>`;
  const bodyXml = [
    dxP(dxRun(ctx.title.toUpperCase(), {b:true, sz:24, color:"12294A"}), {after:40}),
    dxP(dxRun(ctx.sub, {sz:16, color:"334155"}), {after:20}),
    dxP(dxRun(`Periode ${ctx.periode} · skala ${unitLabel} · dicetak ${ctx.printedAt}`, {sz:16, color:"64748B"}), {after:120}),
    tbl,
    dxP("", {after:80}),
    legend,
    dxP("", {})
  ].join("");
  const sect = `<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter1"/><w:pgSz w:w="${PW}" w:h="${PH}" w:orient="landscape"/><w:pgMar w:top="${M}" w:right="${M}" w:bottom="${M+200}" w:left="${M}" w:header="340" w:footer="300" w:gutter="0"/></w:sectPr>`;
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${DX_NS}><w:body>${bodyXml}${sect}</w:body></w:document>`;
  const fr = {sz:14, color:"64748B"};
  const footerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${DX_NS}>${dxP([dxRun(`${ctx.title} · PT Pertamina Hulu Mahakam   ·   Halaman `, fr), dxField("PAGE","1",fr), dxRun(" dari ", fr), dxField("NUMPAGES","1",fr)], {jc:"right"})}</w:ftr>`;
  const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  return dxZip([
    {name:"[Content_Types].xml", data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>`},
    {name:"_rels/.rels", data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/></Relationships>`},
    {name:"word/document.xml", data:documentXml},
    {name:"word/footer1.xml", data:footerXml},
    {name:"word/settings.xml", data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:defaultTabStop w:val="720"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`},
    {name:"word/styles.xml", data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial"/><w:color w:val="1A1A1A"/><w:sz w:val="16"/><w:szCs w:val="16"/><w:lang w:val="id-ID"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:semiHidden/><w:tblPr><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style></w:styles>`},
    {name:"word/_rels/document.xml.rels", data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="${REL}/styles" Target="styles.xml"/><Relationship Id="rIdSettings" Type="${REL}/settings" Target="settings.xml"/><Relationship Id="rIdFooter1" Type="${REL}/footer" Target="footer1.xml"/></Relationships>`}
  ]);
}
function wbsExportWord(){
  const ctx = wbsExportContext(); if(!ctx) return;
  const blob = buildWbsDocx(ctx);
  downloadBlob(blob, sanitizeFotoFilename(ctx.fileBase)+".docx", blob.type);
  toast(`Jadwal WBS diunduh sebagai Word (.docx) — ${ctx.rows.length} baris sesuai yang sedang terbuka.`,"ok");
}

/* ---------- Excel (.xlsx) ---------- */
function xsEsc(s){ return dxEsc(s); }
function xsCol(i){ let s = ""; i++; while(i>0){ const m = (i-1)%26; s = String.fromCharCode(65+m)+s; i = Math.floor((i-1)/26); } return s; }
function xsSerial(d){ const [y,m,dd] = d.split("-").map(Number); return Math.round((Date.UTC(y,m-1,dd) - Date.UTC(1899,11,30))/86400000); }
// Registri style kecil: setiap kombinasi font/fill/border/format/perataan → 1 indeks cellXfs.
function xsStyles(){
  const fonts = ['<font><sz val="9"/><name val="Arial"/></font>'];
  const fills = ['<fill><patternFill patternType="none"/></fill>','<fill><patternFill patternType="gray125"/></fill>'];
  const borders = ['<border><left/><right/><top/><bottom/><diagonal/></border>'];
  const xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  const fontIdx = new Map(), fillIdx = new Map(), borderIdx = new Map(), xfIdx = new Map();
  const font = (o)=>{ const k = JSON.stringify(o); if(fontIdx.has(k)) return fontIdx.get(k); fonts.push(`<font>${o.b?"<b/>":""}<sz val="${o.sz||9}"/><color rgb="FF${o.color||"1A1A1A"}"/><name val="Arial"/></font>`); fontIdx.set(k, fonts.length-1); return fonts.length-1; };
  const fill = (hex)=>{ if(!hex) return 0; if(fillIdx.has(hex)) return fillIdx.get(hex); fills.push(`<fill><patternFill patternType="solid"><fgColor rgb="FF${hex}"/><bgColor indexed="64"/></patternFill></fill>`); fillIdx.set(hex, fills.length-1); return fills.length-1; };
  const border = (hex)=>{ if(!hex) return 0; if(borderIdx.has(hex)) return borderIdx.get(hex); const s = `<left style="thin"><color rgb="FF${hex}"/></left><right style="thin"><color rgb="FF${hex}"/></right><top style="thin"><color rgb="FF${hex}"/></top><bottom style="thin"><color rgb="FF${hex}"/></bottom>`; borders.push(`<border>${s}<diagonal/></border>`); borderIdx.set(hex, borders.length-1); return borders.length-1; };
  const style = (o)=>{
    const k = JSON.stringify(o); if(xfIdx.has(k)) return xfIdx.get(k);
    const f = font({b:o.b, sz:o.sz, color:o.color}), fi = fill(o.fill), bo = border(o.border);
    const num = o.num==="date" ? 164 : o.num==="pct" ? 9 : 0;
    const al = (o.h||o.v||o.indent||o.wrap) ? `<alignment${o.h?` horizontal="${o.h}"`:""} vertical="${o.v||"center"}"${o.indent?` indent="${o.indent}"`:""}${o.wrap?` wrapText="1"`:""}/>` : `<alignment vertical="center"/>`;
    xfs.push(`<xf numFmtId="${num}" fontId="${f}" fillId="${fi}" borderId="${bo}" xfId="0" applyFont="1"${fi?` applyFill="1"`:""}${bo?` applyBorder="1"`:""}${num?` applyNumberFormat="1"`:""} applyAlignment="1">${al}</xf>`);
    xfIdx.set(k, xfs.length-1); return xfs.length-1;
  };
  const xml = ()=>`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="d mmm yyyy"/></numFmts><fonts count="${fonts.length}">${fonts.join("")}</fonts><fills count="${fills.length}">${fills.join("")}</fills><borders count="${borders.length}">${borders.join("")}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join("")}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  return {style, xml};
}
function buildWbsXlsx(ctx){
  const {model} = ctx;
  const unit = wbsScale;   // Excel mengikuti skala di layar (tidak terbatas lebar kertas)
  const range = wbsRange(model, unit);
  const periods = wbsPeriods(range, unit);
  const allRows = wbsVisibleRows(model, ()=>true);   // semua level, dibuka/tutup lewat outline Excel
  const ST = xsStyles();
  const GRID = "D9DEE6", HDR = "12294A";
  const FIX = 6, firstData = 6;
  const today = todayStr();
  const rowsXml = [];
  const merges = [];
  const cell = (c, r, s, v, type)=>{
    const ref = `${xsCol(c)}${r}`;
    if(v==null || v==="") return `<c r="${ref}" s="${s}"/>`;
    if(type==="n") return `<c r="${ref}" s="${s}"><v>${v}</v></c>`;
    return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${xsEsc(v)}</t></is></c>`;
  };
  const lastCol = FIX + periods.length - 1;
  // Judul
  rowsXml.push(`<row r="1" ht="22" customHeight="1">${cell(0,1,ST.style({b:true,sz:14,color:HDR}), ctx.title)}</row>`);
  rowsXml.push(`<row r="2">${cell(0,2,ST.style({sz:9,color:"334155"}), ctx.sub)}</row>`);
  rowsXml.push(`<row r="3">${cell(0,3,ST.style({sz:9,color:"64748B"}), `Periode ${ctx.periode} · skala ${{day:"harian",week:"mingguan",month:"bulanan"}[unit]} · dibuat ${ctx.printedAt} · gunakan tombol 1-4 di kiri atas untuk membuka/tutup level WBS`)}</row>`);
  merges.push(`A1:${xsCol(Math.min(lastCol, 12))}1`, `A2:${xsCol(Math.min(lastCol, 12))}2`, `A3:${xsCol(Math.min(lastCol, 12))}3`);
  // Header 2 baris
  const hs = ST.style({b:true, sz:9, color:"FFFFFF", fill:HDR, border:"3A4E6E", h:"center"});
  const hsL = ST.style({b:true, sz:9, color:"FFFFFF", fill:HDR, border:"3A4E6E", h:"left"});
  const heads = ["WBS","Nama Aktivitas","Mulai","Selesai","Durasi","Progres"];
  let r4 = heads.map((h,i)=>cell(i,4, i===1?hsL:hs, h)).join(""), r5 = heads.map((h,i)=>cell(i,5,hs,"")).join("");
  heads.forEach((h,i)=>merges.push(`${xsCol(i)}4:${xsCol(i)}5`));
  let ci = FIX, runStart = FIX;
  periods.forEach((p,i)=>{
    const nextKey = periods[i+1] ? periods[i+1].mkey : null;
    r4 += cell(ci, 4, ST.style({b:true, sz:9, color:"DBE6F0", fill:"0F1F38", border:"3A4E6E", h:"center"}), i===0 || periods[i-1].mkey!==p.mkey ? wbsMonthLabel(p.mkey) : "");
    const isToday = today>=p.start && today<=p.end;
    r5 += cell(ci, 5, ST.style({b:true, sz:8, color:isToday?"FCA5A5":"E6EDF6", fill:p.we?"1F3558":"16294A", border:"3A4E6E", h:"center"}), p.label);
    if(nextKey!==p.mkey){ if(ci>runStart) merges.push(`${xsCol(runStart)}4:${xsCol(ci)}4`); runStart = ci+1; }
    ci++;
  });
  rowsXml.push(`<row r="4" ht="18" customHeight="1">${r4}</row>`, `<row r="5" ht="18" customHeight="1">${r5}</row>`);
  // Baris data dgn outline level
  const bands = {0:"E6EBF2", 1:"E3F4F3", 2:"F3F5F8"};
  allRows.forEach((rw, idx)=>{
    const n = rw.node, r = firstData + idx, band = bands[n.level] || null, bold = n.level<=1;
    const base = {sz:9, b:bold, fill:band, border:GRID};
    const pct = wbsNodePct(n);
    let x = "";
    x += cell(0, r, ST.style({...base, b:false, color:"64748B"}), n.code);
    x += cell(1, r, ST.style({...base, indent:Math.min(rw.depth*2, 15)}), wbsNodeLabel(n));
    x += n.start ? cell(2, r, ST.style({...base, num:"date", h:"left"}), xsSerial(n.start), "n") : cell(2, r, ST.style(base), "-");
    x += n.end ? cell(3, r, ST.style({...base, num:"date", h:"left"}), xsSerial(n.end), "n") : cell(3, r, ST.style(base), "-");
    x += cell(4, r, ST.style({...base, h:"right"}), wbsNodeDur(n));
    x += n.type==="point" ? cell(5, r, ST.style({...base, h:"right", color:(WBS_STATUS[n.status]||{}).color ? (WBS_STATUS[n.status].color).slice(1).toUpperCase() : "1A1A1A"}), wbsStatusText(n))
      : cell(5, r, ST.style({...base, num:"pct", h:"right"}), Math.round((pct||0)*1000)/1000, "n");
    const color = wbsBarColor(n);
    periods.forEach((p,i)=>{
      const on = n.start && n.start<=p.end && n.end>=p.start;
      x += cell(FIX+i, r, ST.style({fill: on ? color : (p.we ? "F1F3F6" : band), border:GRID}), "");
    });
    rowsXml.push(`<row r="${r}"${rw.depth?` outlineLevel="${Math.min(rw.depth,7)}"`:""}>${x}</row>`);
  });
  const lastRow = firstData + allRows.length - 1;
  const pwid = unit==="day" ? 3.4 : unit==="week" ? 6.5 : 8;
  const cols = `<cols><col min="1" max="1" width="10" customWidth="1"/><col min="2" max="2" width="48" customWidth="1"/><col min="3" max="4" width="12" customWidth="1"/><col min="5" max="5" width="11" customWidth="1"/><col min="6" max="6" width="10" customWidth="1"/><col min="7" max="${lastCol+1}" width="${pwid}" customWidth="1"/></cols>`;
  const maxDepth = Math.max(0, ...allRows.map(r=>r.depth));
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetPr><outlinePr summaryBelow="0"/><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${xsCol(lastCol)}${lastRow}"/><sheetViews><sheetView workbookViewId="0" zoomScale="90" zoomScaleNormal="90"><pane xSplit="${FIX}" ySplit="5" topLeftCell="${xsCol(FIX)}6" activePane="bottomRight" state="frozen"/><selection pane="bottomRight" activeCell="${xsCol(FIX)}6" sqref="${xsCol(FIX)}6"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15" outlineLevelRow="${maxDepth}"/>${cols}<sheetData>${rowsXml.join("")}</sheetData><mergeCells count="${merges.length}">${merges.map(m=>`<mergeCell ref="${m}"/>`).join("")}</mergeCells><pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/><headerFooter><oddFooter>&amp;L${xsEsc(ctx.title)}&amp;RHalaman &amp;P dari &amp;N</oddFooter></headerFooter></worksheet>`;
  const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const zip = dxZip([
    {name:"[Content_Types].xml", data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`},
    {name:"_rels/.rels", data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`},
    {name:"xl/workbook.xml", data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${REL}"><sheets><sheet name="Jadwal WBS" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm.Print_Titles" localSheetId="0">'Jadwal WBS'!$4:$5</definedName></definedNames></workbook>`},
    {name:"xl/_rels/workbook.xml.rels", data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL}/styles" Target="styles.xml"/></Relationships>`},
    {name:"xl/worksheets/sheet1.xml", data:sheet},
    {name:"xl/styles.xml", data:ST.xml()}
  ]);
  return new Blob([zip], {type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
}
function wbsExportExcel(){
  const ctx = wbsExportContext(); if(!ctx) return;
  const blob = buildWbsXlsx(ctx);
  downloadBlob(blob, sanitizeFotoFilename(ctx.fileBase)+".xlsx", blob.type);
  toast("Jadwal WBS diunduh sebagai Excel (.xlsx) — semua level, bisa dibuka/tutup dgn outline 1-4.","ok");
}
Object.assign(ACTIONS, { wbsExportPdf, wbsExportWord, wbsExportExcel });
