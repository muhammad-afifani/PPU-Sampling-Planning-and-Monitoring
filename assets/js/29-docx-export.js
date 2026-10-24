/* =========================================================
   EXPORT WORD (.docx) ASLI — Berita Acara
   ---------------------------------------------------------
   Export Word lama (28-word-export.js) menyerialkan HTML cetak jadi MHTML ber-ekstensi .doc. Word
   merendernya dgn aturan HTML sendiri, jadi tata letak cetak ikut berantakan: tabel titik di dalam
   tabel pembungkus (<tr> yang dipaksa tidak boleh terpotong) meloncat utuh ke halaman 2 dan
   meninggalkan halaman 1 hampir kosong, <tfoot> pita merah muncul tepat di bawah kalimat pembuka,
   dst. Di sini file .docx (WordprocessingML) disusun LANGSUNG dari data Berita Acara (baCollectData,
   sumber yg sama dgn pratinjau & cetak) tanpa melewati HTML:
   - tabel titik adalah tabel Word biasa → mengalir antar halaman, baris judul kolom diulang
     (w:tblHeader), tiap baris tidak terpotong (w:cantSplit), judul kategori ikut baris berikutnya
   - pita merah = footer Word sungguhan → muncul di SETIAP halaman
   - blok tanda tangan dijaga tetap satu halaman (keepNext)
   File .docx = arsip ZIP; ditulis di sini tanpa library (metode "store", CRC32 sendiri).
========================================================= */

/* ---------- ZIP minimal (tanpa kompresi) ---------- */
let dxCrcTable = null;
function dxCrc32(bytes){
  if(!dxCrcTable){
    dxCrcTable = new Uint32Array(256);
    for(let n=0;n<256;n++){ let c=n; for(let k=0;k<8;k++) c = (c&1) ? (0xEDB88320 ^ (c>>>1)) : (c>>>1); dxCrcTable[n] = c>>>0; }
  }
  let crc = 0xFFFFFFFF;
  for(let i=0;i<bytes.length;i++) crc = dxCrcTable[(crc^bytes[i])&0xFF] ^ (crc>>>8);
  return (crc^0xFFFFFFFF)>>>0;
}
function dxBytes(x){ return typeof x==="string" ? new TextEncoder().encode(x) : x; }
function dxZip(files){
  const enc = new TextEncoder();
  const locals = [], centrals = [];
  let offset = 0;
  const d = new Date();
  const dosTime = (d.getHours()<<11) | (d.getMinutes()<<5) | (d.getSeconds()>>1);
  const dosDate = ((d.getFullYear()-1980)<<9) | ((d.getMonth()+1)<<5) | d.getDate();
  files.forEach(f=>{
    const name = enc.encode(f.name), data = dxBytes(f.data), crc = dxCrc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0,0x04034b50,true); lh.setUint16(4,20,true); lh.setUint16(6,0x0800,true); lh.setUint16(8,0,true);
    lh.setUint16(10,dosTime,true); lh.setUint16(12,dosDate,true); lh.setUint32(14,crc,true);
    lh.setUint32(18,data.length,true); lh.setUint32(22,data.length,true); lh.setUint16(26,name.length,true); lh.setUint16(28,0,true);
    locals.push(new Uint8Array(lh.buffer), name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0,0x02014b50,true); ch.setUint16(4,20,true); ch.setUint16(6,20,true); ch.setUint16(8,0x0800,true); ch.setUint16(10,0,true);
    ch.setUint16(12,dosTime,true); ch.setUint16(14,dosDate,true); ch.setUint32(16,crc,true);
    ch.setUint32(20,data.length,true); ch.setUint32(24,data.length,true); ch.setUint16(28,name.length,true);
    ch.setUint32(42,offset,true);
    centrals.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + data.length;
  });
  const cdSize = centrals.reduce((a,b)=>a+b.length,0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0,0x06054b50,true); end.setUint16(8,files.length,true); end.setUint16(10,files.length,true);
  end.setUint32(12,cdSize,true); end.setUint32(16,offset,true);
  return new Blob([...locals, ...centrals, new Uint8Array(end.buffer)], {type:"application/vnd.openxmlformats-officedocument.wordprocessingml.document"});
}

/* ---------- Pembangun XML WordprocessingML ---------- */
function dxEsc(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,""); }
// Teks polos dari potongan HTML yang sudah di-escape (mis. hasil baStatusFor).
function dxHtmlToText(html){ const t = document.createElement("textarea"); t.innerHTML = String(html||"").replace(/<br\s*\/?>/gi,"\n").replace(/<[^>]+>/g,""); return t.value; }
function dxRun(text, o){
  o = o||{};
  const rpr = [];
  // Urutan elemen mengikuti skema OOXML (rFonts, b, i, color, sz, u) — Word ketat soal urutan ini.
  if(o.mono) rpr.push('<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:cs="Courier New"/>');
  if(o.b) rpr.push("<w:b/>");
  if(o.i) rpr.push("<w:i/>");
  if(o.color) rpr.push(`<w:color w:val="${o.color}"/>`);
  if(o.sz) rpr.push(`<w:sz w:val="${o.sz}"/><w:szCs w:val="${o.sz}"/>`);
  if(o.u) rpr.push('<w:u w:val="single"/>');
  const parts = String(text==null?"":text).split("\n");
  const body = parts.map((t,i)=>(i?"<w:br/>":"")+`<w:t xml:space="preserve">${dxEsc(t)}</w:t>`).join("");
  return `<w:r>${rpr.length?`<w:rPr>${rpr.join("")}</w:rPr>`:""}${body}</w:r>`;
}
function dxP(runs, o){
  o = o||{};
  const ppr = [];
  if(o.keepNext) ppr.push("<w:keepNext/>");
  if(o.keepLines) ppr.push("<w:keepLines/>");
  if(o.pageBreakBefore) ppr.push("<w:pageBreakBefore/>");
  if(o.borderBottom) ppr.push(`<w:pBdr><w:bottom w:val="single" w:sz="${o.borderBottom}" w:space="4" w:color="333333"/></w:pBdr>`);
  ppr.push(`<w:spacing w:before="${o.before||0}" w:after="${o.after||0}"${o.line?` w:line="${o.line}" w:lineRule="auto"`:""}/>`);
  if(o.ind) ppr.push(`<w:ind w:left="${o.ind}"/>`);
  if(o.jc) ppr.push(`<w:jc w:val="${o.jc}"/>`);
  if(o.markSz) ppr.push(`<w:rPr><w:sz w:val="${o.markSz}"/><w:szCs w:val="${o.markSz}"/></w:rPr>`);
  return `<w:p><w:pPr>${ppr.join("")}</w:pPr>${Array.isArray(runs)?runs.join(""):(runs||"")}</w:p>`;
}
function dxBorder(side, sz, color, val){ return `<w:${side} w:val="${val||"single"}" w:sz="${sz}" w:space="0" w:color="${color}"/>`; }
function dxCell(width, content, o){
  o = o||{};
  const pr = [`<w:tcW w:w="${width}" w:type="dxa"/>`];
  if(o.span>1) pr.push(`<w:gridSpan w:val="${o.span}"/>`);
  if(o.borders) pr.push(`<w:tcBorders>${o.borders}</w:tcBorders>`);
  if(o.fill) pr.push(`<w:shd w:val="clear" w:color="auto" w:fill="${o.fill}"/>`);
  pr.push(`<w:vAlign w:val="${o.vAlign||"center"}"/>`);
  return `<w:tc><w:tcPr>${pr.join("")}</w:tcPr>${content||dxP("")}</w:tc>`;
}
function dxRow(cells, o){
  o = o||{};
  const pr = [];
  if(o.cantSplit!==false) pr.push("<w:cantSplit/>");
  if(o.header) pr.push("<w:tblHeader/>");
  if(o.height) pr.push(`<w:trHeight w:val="${o.height}" w:hRule="atLeast"/>`);
  return `<w:tr>${pr.length?`<w:trPr>${pr.join("")}</w:trPr>`:""}${cells.join("")}</w:tr>`;
}
function dxTable(widths, rows, o){
  o = o||{};
  const total = widths.reduce((a,b)=>a+b,0);
  const mar = o.cellMar || {top:50,bottom:50,left:90,right:90};
  return `<w:tbl><w:tblPr><w:tblW w:w="${total}" w:type="dxa"/>${o.borders?`<w:tblBorders>${o.borders}</w:tblBorders>`:""}<w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="${mar.top}" w:type="dxa"/><w:left w:w="${mar.left}" w:type="dxa"/><w:bottom w:w="${mar.bottom}" w:type="dxa"/><w:right w:w="${mar.right}" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${widths.map(w=>`<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>${rows.join("")}</w:tbl>`;
}
// Gambar inline (PNG) — ukuran dlm EMU (1 cm = 360000). rId merujuk relasi di part pemiliknya.
function dxImage(rId, id, name, cxEmu, cyEmu){
  return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cxEmu}" cy="${cyEmu}"/><wp:docPr id="${id}" name="${dxEsc(name)}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="${dxEsc(name)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cxEmu}" cy="${cyEmu}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}
function dxDataUrlBytes(dataUrl){
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl||"");
  if(!m) return null;
  const bin = atob(m[2]); const out = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) out[i] = bin.charCodeAt(i);
  return {mime:m[1], bytes:out};
}
// Lebar/tinggi piksel PNG dari header IHDR (logo & pita merah semuanya PNG).
function dxPngSize(bytes){
  if(bytes.length<24 || bytes[1]!==0x50) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {w:dv.getUint32(16), h:dv.getUint32(20)};
}
const DX_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';

/* ---------- Berita Acara → .docx ---------- */
const DX_PAGE = {w:11906, h:16838};                     // A4 potret
const dxMm = mm=>Math.round(mm*56.6929);                // mm -> twips
// Satu field Word sederhana (PAGE / NUMPAGES) dgn teks cadangan.
function dxField(instr, fallback, o){ return `<w:fldSimple w:instr=" ${instr} ">${dxRun(fallback,o)}</w:fldSimple>`; }
// Sel tanda tangan Ketua Tim: gambar TTD (maks 4,6 x 1,75 cm, rasio asli) + cap kecil ID dokumen.
function dxSignatureCell(sigImg, d){
  const EMU_CM = 360000, maxW = 4.6*EMU_CM, maxH = 1.75*EMU_CM;
  const k = Math.min(maxW/sigImg.px.w, maxH/sigImg.px.h);
  const img = dxP(dxImage("rIdImg4", 4, "Tanda tangan Ketua Tim", Math.round(sigImg.px.w*k), Math.round(sigImg.px.h*k)), {jc:"center", keepNext:true});
  const stamp = d.cert ? dxP(dxRun(`Ditandatangani elektronik · ${d.cert.docId}`, {sz:11, color:"666666"}), {jc:"center", keepNext:true}) : "";
  return img + stamp;
}
// Halaman terakhir: Sertifikat Tanda Tangan Elektronik (isi sama dgn baCertHtml di 11-berita-acara.js).
function dxCertificateBody(body, d, sigImg, qrImg, CW, noBorders){
  const c = d.cert, EMU_CM = 360000, SZ = 18;
  body.push(dxP(dxRun("SERTIFIKAT TANDA TANGAN ELEKTRONIK",{b:true,sz:26}),{jc:"center",pageBreakBefore:true,after:40}));
  body.push(dxP(dxRun(`${dxHtmlToText(d.judul)} — Lapangan ${d.site}`,{sz:19,color:"555555"}),{jc:"center",after:200,borderBottom:12}));
  const kw = [2500, 260, CW-2760];
  const fields = [
    ["ID Dokumen", c.docId, true],
    ["Penandatangan", `${c.signerName}${c.signerRole?`, ${c.signerRole}`:""}`],
    ["Perusahaan", c.company],
    ["Waktu penandatanganan", c.signedAtText],
    ["Metode", "Gambar tanda tangan terdaftar pada sistem Emission Sampling Planner & Tracker PT Pertamina Hulu Mahakam"],
    ["SHA-256 isi dokumen", c.hash, true],
    ["SHA-256 gambar TTD", c.imgHash, true]
  ];
  const lineB = dxBorder("bottom",4,"DDDDDD");
  body.push(dxTable(kw, fields.map(([k,v,mono])=>dxRow([
    dxCell(kw[0], dxP(dxRun(k,{sz:SZ,b:true,color:"444444"})), {vAlign:"top",borders:lineB}),
    dxCell(kw[1], dxP(dxRun(":",{sz:SZ})), {vAlign:"top",borders:lineB}),
    dxCell(kw[2], dxP(dxRun(v,{sz:mono?16:SZ,mono})), {vAlign:"top",borders:lineB})
  ])), {borders:noBorders, cellMar:{top:70,bottom:70,left:40,right:40}}));
  // TTD terdaftar (kiri) + QR (kanan)
  const half = Math.floor(CW/2), half2 = CW-half;
  const sk = Math.min(5.2*EMU_CM/sigImg.px.w, 2.2*EMU_CM/sigImg.px.h), qs = Math.round(3.4*EMU_CM);
  const cap = t=>dxP(dxRun(t,{sz:15,color:"666666"}),{jc:"center",before:40});
  body.push(dxP("",{markSz:12}));
  body.push(dxTable([half,half2],[dxRow([
    dxCell(half, dxP(dxImage("rIdImg4",5,"Tanda tangan terdaftar",Math.round(sigImg.px.w*sk),Math.round(sigImg.px.h*sk)),{jc:"center"})+cap("Tanda tangan terdaftar"), {vAlign:"bottom"}),
    dxCell(half2, dxP(dxImage("rIdImg5",6,"QR verifikasi",qs,qs),{jc:"center"})+cap("QR data verifikasi"), {vAlign:"bottom"})
  ])], {borders:noBorders, cellMar:{top:60,bottom:60,left:60,right:60}}));
  // Alur penandatanganan
  body.push(dxP(dxRun("Alur penandatanganan",{b:true,sz:SZ}),{before:200,after:80,keepNext:true}));
  const fw = [2600, 3300, CW-5900];
  const gb = ["top","left","bottom","right"].map(s=>dxBorder(s,4,"999999")).join("");
  const head = ["Penandatangan","Peran","Status"];
  const flowRows = [
    dxRow(head.map((h,i)=>dxCell(fw[i], dxP(dxRun(h,{b:true,sz:16})), {borders:gb,fill:"F2F2F2"}))),
    dxRow([
      dxCell(fw[0], dxP(dxRun(c.signerName,{sz:16})), {borders:gb}),
      dxCell(fw[1], dxP(dxRun(`Ketua Tim Sampling — ${c.company}`,{sz:16})), {borders:gb}),
      dxCell(fw[2], dxP(dxRun(`Telah ditandatangani · ${c.signedAtText}`,{sz:16,color:"1C7A4F",b:true})), {borders:gb})
    ]),
    dxRow([
      dxCell(fw[0], dxP(dxRun(c.next.name||"(nama belum diisi)",{sz:16})), {borders:gb}),
      dxCell(fw[1], dxP(dxRun(c.next.role||`Environment Supervisor ${c.next.site}`,{sz:16})), {borders:gb}),
      dxCell(fw[2], dxP(dxRun("Menunggu tanda tangan",{sz:16,color:"9A5A06",b:true})), {borders:gb})
    ])
  ];
  body.push(dxTable(fw, flowRows, {borders:gb, cellMar:{top:60,bottom:60,left:90,right:90}}));
  body.push(dxP(dxRun("Hash SHA-256 dihitung dari isi Berita Acara (judul, tanggal, daftar titik & status, nama/jabatan penandatangan) dan dari gambar tanda tangan; perubahan sekecil apa pun pada isi menghasilkan hash berbeda. Sertifikat ini adalah catatan penandatanganan elektronik internal dari sistem tersebut di atas dan bukan tanda tangan digital bersertifikat (PSrE/PKI). Untuk kekuatan hukum tanda tangan digital tersertifikasi, tandatangani berkas PDF akhir dengan sertifikat elektronik resmi.",{i:true,sz:15,color:"555555"}),{before:200,line:260}));
}
function dxBuildBeritaAcara(d){
  const M = d.margins || {top:18,right:18,bottom:18,left:18};
  const DX_CONTENT_W = DX_PAGE.w - dxMm(M.left) - dxMm(M.right);
  const images = {};  // rId -> {name, bytes, px:{w,h}}
  const reg = (rId, name, dataUrl)=>{ const u = dxDataUrlBytes(dataUrl); if(!u) return null; images[rId] = {name, bytes:u.bytes, px:dxPngSize(u.bytes)||{w:400,h:100}}; return images[rId]; };
  const logoL = reg("rIdImg1","logo-skkmigas.png", LOGO_SKKMIGAS_B64);
  const logoR = reg("rIdImg2","logo-phm.png", LOGO_PHM_B64);
  const band = reg("rIdImg3","footer-band.png", FOOTER_BAND_B64);
  // TTD Ketua Tim + QR sertifikat (24b-ppc-ttd.js) — hanya ada kalau d.ttd/d.cert terisi; selain itu
  // XML yang dihasilkan PERSIS sama dgn sebelum fitur ini.
  const sigImg = d.ttd ? reg("rIdImg4","ttd-ketua-tim.png", d.ttd.url) : null;
  const qrImg = d.cert ? reg("rIdImg5","qr-sertifikat.png", d.cert.qrPng) : null;
  const EMU_CM = 360000;
  const logoH = 1.55*EMU_CM;  // tinggi logo ≈ 60px cetak
  const sizeByH = im=>({cx:Math.round(logoH*im.px.w/im.px.h), cy:Math.round(logoH)});
  const body = [];
  const noBorders = ["top","left","bottom","right","insideH","insideV"].map(s=>dxBorder(s,0,"auto","nil")).join("");

  // Logo kiri (SKK Migas) & kanan (PHM) — tabel tanpa garis
  const lsz = logoL ? sizeByH(logoL) : {cx:1,cy:1}, rsz = logoR ? sizeByH(logoR) : {cx:1,cy:1};
  const half = Math.floor(DX_CONTENT_W/2), half2 = DX_CONTENT_W-half;
  body.push(dxTable([half, half2], [dxRow([
    dxCell(half, dxP(logoL?dxImage("rIdImg1",1,"SKK Migas",lsz.cx,lsz.cy):"",{jc:"left"}), {vAlign:"center"}),
    dxCell(half2, dxP(logoR?dxImage("rIdImg2",2,"Pertamina Hulu Mahakam",rsz.cx,rsz.cy):"",{jc:"right"}), {vAlign:"center"})
  ])], {borders:noBorders, cellMar:{top:0,bottom:0,left:0,right:0}}));
  // Satu baris kosong berhuruf kecil (6pt) antara logo dan judul — jarak rapat tapi tetap lega.
  body.push(dxP("",{markSz:12,keepNext:true}));

  // Judul & subjudul: satu ukuran huruf (10,5pt, tebal)
  body.push(dxP(dxRun("BERITA ACARA",{b:true,sz:21}),{jc:"center",after:20,keepNext:true}));
  body.push(dxP(dxRun(d.judul,{b:true,sz:21}),{jc:"center",after:200,borderBottom:12,keepNext:true}));
  body.push(dxP(dxRun(d.intro,{sz:19}),{after:140,line:276,keepNext:true}));

  // Meta (Hari/Tanggal, Lokasi, Ketua Tim)
  const metaRows = [["Hari / Tanggal", d.tanggalPelaksanaan], ["Lokasi", `Lapangan ${d.site} PT Pertamina Hulu Mahakam`]];
  const mw = [2300, 260, DX_CONTENT_W-2560];
  body.push(dxTable(mw, metaRows.map(([k,v])=>dxRow([
    dxCell(mw[0], dxP(dxRun(k,{sz:19})), {vAlign:"top"}),
    dxCell(mw[1], dxP(dxRun(":",{sz:19})), {vAlign:"top"}),
    dxCell(mw[2], dxP(dxRun(v,{sz:19})), {vAlign:"top"})
  ],{cantSplit:true})), {borders:noBorders, cellMar:{top:30,bottom:30,left:0,right:60}}));
  body.push(dxP(dxRun("Adapun titik lokasi yang dilakukan pengukuran adalah sebagai berikut:",{sz:19}),{before:140,after:120,keepNext:true}));

  // Tabel titik
  const W = [520, 1350, 1850, 2340, 1500].map(w=>Math.round(w*DX_CONTENT_W/9866)); W.push(DX_CONTENT_W - W.reduce((a,b)=>a+b,0));
  const line = dxBorder("top",4,"999999")+dxBorder("left",4,"999999")+dxBorder("bottom",4,"999999")+dxBorder("right",4,"999999");
  const tblBorders = ["top","left","bottom","right","insideH","insideV"].map(s=>dxBorder(s,4,"999999")).join("");
  const TS = 16;  // 8pt
  const heads = ["No.","Lokasi","Kategori",d.titikHeader,"Kewajiban Pemantauan","Status Pemantauan"];
  const headBorders = dxBorder("top",4,"999999")+dxBorder("left",4,"999999")+dxBorder("bottom",12,"333333")+dxBorder("right",4,"999999");
  const rows = [dxRow(heads.map((h,i)=>dxCell(W[i], dxP(dxRun(h,{b:true,sz:TS}),{jc:i===4?"center":"left"}), {borders:headBorders,fill:"F2F2F2"})),{header:true})];
  d.groups.forEach(g=>{
    const catBorders = dxBorder("top",12,"333333")+dxBorder("left",36,"A02A24")+dxBorder("bottom",4,"999999")+dxBorder("right",4,"999999");
    rows.push(dxRow([dxCell(DX_CONTENT_W, dxP(dxRun(g.kategori,{b:true,sz:TS}),{keepNext:true}), {span:6,borders:catBorders})]));
    g.rows.forEach(r=>{
      const cells = [String(r.no), r.lokasi, r.kategori, r.titik, r.frekuensi, dxHtmlToText(r.statusHtml)];
      rows.push(dxRow(cells.map((t,i)=>dxCell(W[i], dxP(dxRun(t,{sz:TS}),{jc:i===4?"center":"left"}), {borders:line}))));
    });
  });
  body.push(dxTable(W, rows, {borders:tblBorders, cellMar:{top:60,bottom:60,left:90,right:90}}));
  if(d.footerNote) body.push(dxP(dxRun(d.footerNote,{i:true,sz:17,color:"555555"}),{before:100}));

  // Penutup & tanda tangan — dijaga utuh dalam 1 halaman
  body.push(dxP(dxRun("Demikian Berita Acara ini dibuat untuk dipergunakan sebagaimana mestinya.",{sz:19}),{before:360,keepNext:true}));
  body.push(dxP(dxRun(d.tempatTanggal,{sz:19}),{before:100,jc:"right",keepNext:true}));
  body.push(dxP(dxRun("Mengetahui,",{sz:19}),{before:300,jc:"center",keepNext:true}));
  const sw = [half, half2];
  const cp = (txt,o)=>dxP(dxRun(txt,Object.assign({sz:19},o||{})),{jc:"center",keepNext:true});
  body.push(dxTable(sw, [
    dxRow([dxCell(sw[0], cp(`PT Pertamina Hulu Mahakam, ${d.site}`)), dxCell(sw[1], cp(d.labPerusahaan))]),
    dxRow([dxCell(sw[0], dxP("",{keepNext:true}), {}), dxCell(sw[1], sigImg ? dxSignatureCell(sigImg, d) : dxP("",{keepNext:true}), {})], {height:1300}),
    dxRow([dxCell(sw[0], cp(d.namaPhm,{b:true,u:true})+cp(d.jabatanPhm)), dxCell(sw[1], cp(d.namaLab,{b:true,u:true})+cp(d.jabatanLab))], {})
  ], {borders:noBorders, cellMar:{top:30,bottom:30,left:60,right:60}}));
  if(d.cert && sigImg && qrImg) dxCertificateBody(body, d, sigImg, qrImg, DX_CONTENT_W, noBorders);
  body.push(dxP("",{}));  // paragraf penutup wajib setelah tabel

  const bandSz = band ? {cx:Math.round(DX_CONTENT_W/1440*914400), cy:Math.round(DX_CONTENT_W/1440*914400*band.px.h/band.px.w)} : {cx:1,cy:1};
  const sect = `<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter1"/><w:pgSz w:w="${DX_PAGE.w}" w:h="${DX_PAGE.h}"/><w:pgMar w:top="${dxMm(M.top)}" w:right="${dxMm(M.right)}" w:bottom="${dxMm(M.bottom)}" w:left="${dxMm(M.left)}" w:header="567" w:footer="340" w:gutter="0"/></w:sectPr>`;
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${DX_NS}><w:body>${body.join("")}${sect}</w:body></w:document>`;
  // Footer: "Halaman n dari N" (rata kanan) di atas pita merah — tampil di SETIAP halaman.
  const pageNo = d.showPageNo!==false ? dxP([dxRun("Halaman ",{sz:16,color:"555555"}), dxField("PAGE","1",{sz:16,color:"555555"}), dxRun(" dari ",{sz:16,color:"555555"}), dxField("NUMPAGES","1",{sz:16,color:"555555"})],{jc:"right",after:60}) : "";
  const footerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${DX_NS}>${pageNo}${dxP(band?dxImage("rIdImg3",3,"Pita footer",bandSz.cx,bandSz.cy):"",{jc:"center"})}</w:ftr>`;
  return {documentXml, footerXml, images};
}
function dxPackage(built, title){
  const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const imgs = Object.entries(built.images);
  const files = [
    {name:"[Content_Types].xml", data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`},
    {name:"_rels/.rels", data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`},
    {name:"docProps/core.xml", data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${dxEsc(title)}</dc:title><dc:creator>PHM Emission Sampling Planner &amp; Tracker</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/,"Z")}</dcterms:created></cp:coreProperties>`},
    {name:"word/document.xml", data:built.documentXml},
    {name:"word/footer1.xml", data:built.footerXml},
    {name:"word/settings.xml", data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:defaultTabStop w:val="720"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`},
    {name:"word/styles.xml", data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial"/><w:color w:val="1A1A1A"/><w:sz w:val="20"/><w:szCs w:val="20"/><w:lang w:val="id-ID" w:eastAsia="en-US" w:bidi="ar-SA"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style></w:styles>`},
    {name:"word/_rels/document.xml.rels", data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="${REL}/styles" Target="styles.xml"/><Relationship Id="rIdSettings" Type="${REL}/settings" Target="settings.xml"/><Relationship Id="rIdFooter1" Type="${REL}/footer" Target="footer1.xml"/>${imgs.filter(([id])=>id!=="rIdImg3").map(([id,im])=>`<Relationship Id="${id}" Type="${REL}/image" Target="media/${im.name}"/>`).join("")}</Relationships>`},
    {name:"word/_rels/footer1.xml.rels", data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${imgs.filter(([id])=>id==="rIdImg3").map(([id,im])=>`<Relationship Id="${id}" Type="${REL}/image" Target="media/${im.name}"/>`).join("")}</Relationships>`}
  ];
  imgs.forEach(([id,im])=>files.push({name:"word/media/"+im.name, data:im.bytes}));
  return dxZip(files);
}
async function exportBeritaAcaraDocx(){
  const d = baCollectData();
  if(!d){ toast("Pilih Tim, Batch, dan Site yang sudah punya jadwal & titik terlebih dahulu.","err"); return; }
  const name = baExportFilename();
  const blob = dxPackage(dxBuildBeritaAcara(d), name);
  downloadBlob(blob, sanitizeFotoFilename(name)+".docx", blob.type);
  toast("Berita Acara diunduh sebagai file Word (.docx).","ok");
}
// Untuk pengujian: blob .docx tanpa mengunduh.
function buildBeritaAcaraDocxBlob(){
  const d = baCollectData(); if(!d) return null;
  return dxPackage(dxBuildBeritaAcara(d), baExportFilename());
}
Object.assign(ACTIONS, { exportBeritaAcaraWord: exportBeritaAcaraDocx, exportBeritaAcaraDocx });
