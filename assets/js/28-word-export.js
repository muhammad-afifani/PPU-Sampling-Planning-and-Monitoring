/* =========================================================
   EXPORT WORD (.doc) UNTUK DOKUMEN CETAK
   ---------------------------------------------------------
   Opsi Word utk 3 dokumen yang sebelumnya cuma bisa dicetak/PDF: Berita Acara, Daftar Titik Pantau
   (Plan Pemantauan), dan Lampiran Dokumentasi Foto Sampling.

   Cara kerja (1 mesin utk ketiganya, supaya isi Word = isi cetak):
   1. HTML cetak (buildBeritaAcaraHtml dkk) dirender sebentar di #printGuideArea yang disembunyikan
      di luar layar, ukuran lebarnya = lebar area cetak kertas — dgn begitu CSS .pg-* asli (yang
      tidak dikenal Word) bekerja normal & bisa dibaca lewat getComputedStyle.
   2. Tiap elemen diserialisasi ulang dgn STYLE INLINE hasil hitungan (font, warna, border, padding,
      lebar kolom dlm persen, page-break) — Word tidak mengerti class CSS/variabel CSS/flex/grid.
      Kotak flex/grid (kepala dokumen: logo kiri-kanan, kotak meta) diubah jadi tabel biasa.
   3. Foto yang di-crop non-destruktif (dokFotoBoxHtml: wrapper overflow:hidden + <img> absolut,
      yg tidak didukung Word) dipotong sungguhan lewat <canvas> jadi 1 gambar.
   4. Hasilnya dibungkus MHTML (multipart/related, gambar jadi bagian terpisah) dgn ekstensi .doc —
      Word membukanya normal (mode Print Layout), gambar ikut tertanam, bukan tautan.
========================================================= */
const WX_MM_PX = 96/25.4;

function wxPt(px){ const v = parseFloat(px); return isNaN(v) ? 0 : Math.round(v*75)/100; }
function wxEsc(s){ return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
let wxColorCtx = null;
// Warna computed bisa berupa rgb()/rgba()/color(srgb ...) (hasil color-mix) — dinormalkan lewat
// canvas jadi "#rrggbb" supaya dikenal Word. Alpha 0 → null (transparan).
function wxColor(v){
  if(!v || v==="transparent") return null;
  if(!wxColorCtx) wxColorCtx = document.createElement("canvas").getContext("2d");
  wxColorCtx.clearRect(0,0,1,1);
  wxColorCtx.fillStyle = "#000"; wxColorCtx.fillStyle = v;
  wxColorCtx.clearRect(0,0,1,1); wxColorCtx.fillRect(0,0,1,1);
  const d = wxColorCtx.getImageData(0,0,1,1).data;
  if(d[3]<12) return null;
  const hex = n=>n.toString(16).padStart(2,"0");
  // getImageData sudah premultiplied terhadap kanvas transparan — untuk alpha<255 ratakan ke putih.
  const a = d[3]/255;
  const mix = c=>Math.round(c*a + 255*(1-a));
  return "#"+hex(a<1?mix(d[0]):d[0])+hex(a<1?mix(d[1]):d[1])+hex(a<1?mix(d[2]):d[2]);
}
function wxFont(ff){
  if(/mono|courier/i.test(ff)) return "'Courier New',monospace";
  return "Arial,Helvetica,sans-serif";
}
function wxBorders(cs, out){
  ["top","right","bottom","left"].forEach(side=>{
    const w = parseFloat(cs["border"+side[0].toUpperCase()+side.slice(1)+"Width"]);
    const st = cs["border"+side[0].toUpperCase()+side.slice(1)+"Style"];
    if(w>0 && st && st!=="none" && st!=="hidden"){
      out.push(`border-${side}:${Math.max(0.5, wxPt(w))}pt ${st==="double"?"double":(st==="dashed"||st==="dotted"?st:"solid")} ${wxColor(cs["border"+side[0].toUpperCase()+side.slice(1)+"Color"])||"#000"}`);
    }
  });
}
function wxBreaks(cs, out){
  const bb = cs.breakBefore||cs.pageBreakBefore, ba = cs.breakAfter||cs.pageBreakAfter, bi = cs.breakInside||cs.pageBreakInside;
  if(bb==="page"||bb==="always"||bb==="left"||bb==="right") out.push("page-break-before:always");
  if(ba==="page"||ba==="always") out.push("page-break-after:always");
  if(bi==="avoid"||bi==="avoid-page") out.push("page-break-inside:avoid");
}
function wxTextStyle(cs, out){
  out.push(`font-family:${wxFont(cs.fontFamily)}`);
  out.push(`font-size:${wxPt(cs.fontSize)}pt`);
  if(parseInt(cs.fontWeight,10)>=600 || cs.fontWeight==="bold") out.push("font-weight:bold");
  if(cs.fontStyle==="italic") out.push("font-style:italic");
  const c = wxColor(cs.color); if(c) out.push(`color:${c}`);
  if(/underline/.test(cs.textDecorationLine||"")) out.push("text-decoration:underline");
  if(cs.lineHeight && cs.lineHeight!=="normal") out.push(`line-height:${wxPt(cs.lineHeight)}pt`);
}
function wxBlockBox(el, cs, out, opts){
  opts = opts||{};
  const bg = wxColor(cs.backgroundColor); if(bg) out.push(`background:${bg}`);
  wxBorders(cs, out);
  if(!opts.noPadding){
    const p = ["Top","Right","Bottom","Left"].map(s=>wxPt(cs["padding"+s]));
    if(p.some(x=>x>0)) out.push(`padding:${p.join("pt ")}pt`);
  }
  ["Top","Bottom","Left","Right"].forEach(s=>{
    const raw = cs["margin"+s]; const v = parseFloat(raw);
    if(raw!=="auto" && v>0) out.push(`margin-${s.toLowerCase()}:${wxPt(v)}pt`);
  });
  wxBreaks(cs, out);
}
// ---- Gambar
function wxRegisterImage(st, dataUrl){
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
  if(!m) return null;
  if(st.imgMap[dataUrl]) return st.imgMap[dataUrl];
  const ext = /png/.test(m[1]) ? "png" : /gif/.test(m[1]) ? "gif" : "jpg";
  const name = `image${st.images.length+1}.${ext}`;
  st.images.push({name, mime:m[1], b64:m[2]});
  st.imgMap[dataUrl] = name;
  return name;
}
function wxImgDataUrl(img){
  if(/^data:/.test(img.src)) return img.src;
  try{
    const c = document.createElement("canvas");
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext("2d").drawImage(img,0,0);
    return c.toDataURL("image/png");
  }catch(e){ return ""; }
}
function wxImgTag(name, w, h, extra){
  return `<img src="${name}" width="${Math.max(1,Math.round(w))}" height="${Math.max(1,Math.round(h))}" style="${extra||""}vertical-align:bottom;">`;
}
function wxSerImg(img, st){
  const r = img.getBoundingClientRect();
  const data = wxImgDataUrl(img);
  const name = data ? wxRegisterImage(st, data) : null;
  if(!name || r.width<1) return "";
  const cs = getComputedStyle(img); const b = []; wxBorders(cs, b);
  return wxImgTag(name, r.width, r.height, b.join(";")+(b.length?";":""));
}
function wxIsCropWrap(el, cs){
  if(el.tagName!=="DIV" || cs.overflow!=="hidden" || el.children.length!==1) return false;
  const c = el.children[0];
  return c.tagName==="IMG" && getComputedStyle(c).position==="absolute";
}
// Wrapper crop (overflow:hidden + img absolut ber-offset persen) → 1 gambar hasil potongan sungguhan.
function wxSerCrop(wrap, st){
  const img = wrap.children[0], wr = wrap.getBoundingClientRect(), ir = img.getBoundingClientRect();
  const nw = img.naturalWidth, nh = img.naturalHeight;
  if(!nw || !nh || ir.width<1 || ir.height<1 || wr.width<1) return wxSerImg(img, st);
  const sx = Math.max(0, (wr.left-ir.left)/ir.width*nw), sy = Math.max(0, (wr.top-ir.top)/ir.height*nh);
  const sw = Math.min(nw-sx, wr.width/ir.width*nw), sh = Math.min(nh-sy, wr.height/ir.height*nh);
  const scale = Math.min(1, 1600/sw);
  const c = document.createElement("canvas");
  c.width = Math.max(1,Math.round(sw*scale)); c.height = Math.max(1,Math.round(sh*scale));
  let url = "";
  try{ c.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height); url = c.toDataURL("image/jpeg", 0.88); }catch(e){ return wxSerImg(img, st); }
  const name = wxRegisterImage(st, url); if(!name) return "";
  const b = []; wxBorders(getComputedStyle(wrap), b);
  return wxImgTag(name, wr.width, wr.height, b.join(";")+(b.length?";":""));
}
// ---- Teks & elemen
function wxText(node, parentCs){
  let t = node.nodeValue.replace(/\s+/g," ");
  if(parentCs && parentCs.textTransform==="uppercase") t = t.toUpperCase();
  else if(parentCs && parentCs.textTransform==="lowercase") t = t.toLowerCase();
  return wxEsc(t);
}
function wxKids(el, cs, st){
  const tag = el.tagName.toLowerCase();
  const skipWs = /^(table|thead|tbody|tfoot|tr)$/.test(tag) || /flex|grid/.test(cs.display);
  let out = "";
  el.childNodes.forEach(n=>{
    if(n.nodeType===3){ if(skipWs && !n.nodeValue.trim()) return; out += wxText(n, cs); }
    else if(n.nodeType===1) out += wxSer(n, st);
  });
  return out;
}
function wxCellWidth(el, tbl){
  const row = el.parentElement;
  if(!tbl || !row || tbl.rows[0]!==row || el.colSpan>1) return "";
  const tw = tbl.getBoundingClientRect().width, cw = el.getBoundingClientRect().width;
  return tw>0 ? `width:${Math.round(cw/tw*1000)/10}%;` : "";
}
// Kotak flex/grid → tabel (Word tidak mengenal display:flex/grid).
function wxTableize(el, cs, st){
  const kids = Array.from(el.children).filter(c=>getComputedStyle(c).display!=="none");
  if(!kids.length) return "";
  const isGrid = /grid/.test(cs.display);
  const cols = isGrid ? Math.max(1, cs.gridTemplateColumns.split(/\s+/).filter(x=>/px|fr|%/.test(x)).length) : kids.length;
  const space = /space-between/.test(cs.justifyContent);
  const gap = wxPt(cs.columnGap);
  const cr = el.getBoundingClientRect();
  const vAlign = /center/.test(cs.alignItems) ? "middle" : "top";
  const rows = [];
  for(let i=0;i<kids.length;i+=cols) rows.push(kids.slice(i,i+cols));
  const box = []; wxBorders(cs, box);
  ["Top","Bottom"].forEach(s=>{ const v=parseFloat(cs["margin"+s]); if(cs["margin"+s]!=="auto" && v>0) box.push(`margin-${s.toLowerCase()}:${wxPt(v)}pt`); });
  const mL = Math.max(0, parseFloat(cs.marginLeft)||0), mR = Math.max(0, parseFloat(cs.marginRight)||0);
  const bg = wxColor(cs.backgroundColor); if(bg) box.push(`background:${bg}`);
  const pt = wxPt(cs.paddingTop), pb = wxPt(cs.paddingBottom);
  const html = rows.map(row=>`<tr>${row.map((k,i)=>{
    let w;
    if(isGrid) w = 100/cols;
    else if(space && kids.length===2) w = 50;
    else { const tot = kids.reduce((a,x)=>a+x.getBoundingClientRect().width,0)||1; w = k.getBoundingClientRect().width/tot*100; }
    const align = (space && kids.length>1 && i===row.length-1 && !isGrid) ? "right" : (space && i>0 && i<row.length-1 ? "center" : "left");
    const kcs = getComputedStyle(k);
    const ta = kcs.textAlign==="center" ? "center" : kcs.textAlign==="right"||kcs.textAlign==="end" ? "right" : align;
    return `<td valign="${vAlign}" style="width:${Math.round(w*10)/10}%;text-align:${ta};padding:${pt}pt ${(gap&&i<row.length-1?gap:0)+(i===row.length-1?wxPt(mR):0)}pt ${pb}pt ${i===0?wxPt(mL):0}pt;border:none;">${wxSer(k, st)}</td>`;
  }).join("")}</tr>`).join("");
  return `<table width="100%" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;${box.join(";")}">${html}</table>`;
}
function wxSer(el, st){
  const cs = getComputedStyle(el);
  if(cs.display==="none") return "";
  const tag = el.tagName.toLowerCase();
  if(/^(script|style|button|input|select|textarea|noscript)$/.test(tag)) return "";
  if(tag==="br") return "<br>";
  if(tag==="img") return wxSerImg(el, st);
  if(wxIsCropWrap(el, cs)) return wxSerCrop(el, st);
  const isRowFlex = /flex/.test(cs.display) && !/column/.test(cs.flexDirection);
  if((isRowFlex || /grid/.test(cs.display)) && el.children.length) return wxTableize(el, cs, st);
  const out = [];
  wxTextStyle(cs, out);
  const attrs = [];
  if(tag==="table"){
    wxBlockBox(el, cs, out, {noPadding:true});
    out.push("border-collapse:"+(cs.borderCollapse==="separate"?"separate":"collapse"));
    const pr = el.parentElement ? el.parentElement.getBoundingClientRect().width : 0;
    const w = el.getBoundingClientRect().width;
    out.push(`width:${pr>0 ? Math.min(100, Math.round(w/pr*100)) : 100}%`);
    attrs.push('cellspacing="0"','cellpadding="0"');
  } else if(tag==="td" || tag==="th"){
    wxBlockBox(el, cs, out);
    out.push(`text-align:${cs.textAlign==="center"?"center":(cs.textAlign==="right"||cs.textAlign==="end")?"right":(cs.textAlign==="justify"?"justify":"left")}`);
    out.push(`vertical-align:${/middle|center/.test(cs.verticalAlign)?"middle":(/bottom/.test(cs.verticalAlign)?"bottom":"top")}`);
    const w = wxCellWidth(el, el.closest("table")); if(w) out.push(w.replace(/;$/,""));
    if(cs.whiteSpace==="nowrap") out.push("white-space:nowrap");
    if(el.colSpan>1) attrs.push(`colspan="${el.colSpan}"`);
    if(el.rowSpan>1) attrs.push(`rowspan="${el.rowSpan}"`);
  } else if(/^(thead|tbody|tfoot|tr)$/.test(tag)){
    wxBreaks(cs, out);
    const bg = wxColor(cs.backgroundColor); if(bg && tag==="tr") out.push(`background:${bg}`);
  } else if(cs.display==="inline" || cs.display==="inline-block"){
    const bg = wxColor(cs.backgroundColor); if(bg) out.push(`background:${bg}`);
    wxBorders(cs, out);
    if(cs.whiteSpace==="nowrap") out.push("white-space:nowrap");
    if(tag==="a" && el.getAttribute("href")) attrs.push(`href="${wxEsc(el.getAttribute("href"))}"`);
  } else {
    wxBlockBox(el, cs, out);
    const ta = cs.textAlign; if(ta==="center"||ta==="right"||ta==="end"||ta==="justify") out.push(`text-align:${ta==="end"?"right":ta}`);
    const w = el.style.width; if(/%$/.test(w)) out.push(`width:${w}`);
    if(cs.whiteSpace==="nowrap") out.push("white-space:nowrap");
  }
  const safeTag = /^(table|thead|tbody|tfoot|tr|td|th|h1|h2|h3|h4|p|ul|ol|li|b|strong|i|em|u|small|sub|sup|a|span|div)$/.test(tag) ? tag : (cs.display==="inline"?"span":"div");
  return `<${safeTag} ${attrs.join(" ")} style="${out.join(";")}">${wxKids(el, cs, st)}</${safeTag}>`;
}
// ---- MHTML
function wxB64(str){
  const bytes = new TextEncoder().encode(str);
  let bin = ""; const CH = 0x8000;
  for(let i=0;i<bytes.length;i+=CH) bin += String.fromCharCode.apply(null, bytes.subarray(i,i+CH));
  return btoa(bin);
}
function wxWrap(b64){ return b64.replace(/(.{76})/g,"$1\r\n"); }
function wxBuildMhtml(bodyHtml, images, o){
  const w = o.orientation==="landscape";
  const m = (o.marginMm/10).toFixed(2)+"cm";
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"><title>${wxEsc(o.title||"Dokumen")}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom><w:DoNotOptimizeForBrowser/></w:WordDocument></xml><![endif]-->
<style>
@page Section1{size:${w?"29.7cm 21.0cm":"21.0cm 29.7cm"};mso-page-orientation:${w?"landscape":"portrait"};margin:${m} ${m} ${m} ${m};}
div.Section1{page:Section1;}
body{font-family:Arial,Helvetica,sans-serif;}
table{border-collapse:collapse;}
thead{display:table-header-group;}
tr{page-break-inside:avoid;}
</style></head><body><div class="Section1">${bodyHtml}</div></body></html>`;
  const B = "----=_NextPart_PHM_"+Date.now().toString(36);
  const base = "file:///C:/PHM/";
  let out = `MIME-Version: 1.0\r\nContent-Type: multipart/related; boundary="${B}"; type="text/html"\r\n\r\n`;
  out += `--${B}\r\nContent-Type: text/html; charset="utf-8"\r\nContent-Transfer-Encoding: base64\r\nContent-Location: ${base}dokumen.htm\r\n\r\n${wxWrap(wxB64(html))}\r\n\r\n`;
  images.forEach(im=>{
    out += `--${B}\r\nContent-Type: ${im.mime}\r\nContent-Transfer-Encoding: base64\r\nContent-Location: ${base}${im.name}\r\n\r\n${wxWrap(im.b64)}\r\n\r\n`;
  });
  return out + `--${B}--\r\n`;
}
async function wxRenderHost(html, o, fn){
  const host = document.getElementById("printGuideArea");
  const keep = {css:host.style.cssText, html:host.innerHTML};
  const pageW = (o.orientation==="landscape" ? 297 : 210) - 2*o.marginMm;
  host.style.cssText = `display:block;position:fixed;left:-30000px;top:0;width:${Math.round(pageW*WX_MM_PX)}px;background:#fff;color:#000;`;
  host.innerHTML = html;
  try{
    await Promise.all(Array.from(host.querySelectorAll("img")).map(img=>{
      if(img.decode) return img.decode().catch(()=>{});
      return img.complete ? Promise.resolve() : new Promise(r=>{ img.onload = img.onerror = r; });
    }));
    return await fn(host);
  } finally {
    host.style.cssText = keep.css; host.innerHTML = keep.html;
  }
}
// Titik masuk: html = hasil buildXxxHtml (yang sama dgn utk cetak).
async function wordExportFromHtml(html, o){
  o = Object.assign({orientation:"portrait", marginMm:15, filename:"Dokumen", title:""}, o||{});
  const st = {images:[], imgMap:{}};
  const body = await wxRenderHost(html, o, host=>Array.from(host.childNodes).map(n=>{
    if(n.nodeType===3) return n.nodeValue.trim() ? wxText(n, getComputedStyle(host)) : "";
    return n.nodeType===1 ? wxSer(n, st) : "";
  }).join(""));
  const mhtml = wxBuildMhtml(body, st.images, o);
  downloadBlob(mhtml, sanitizeFotoFilename(o.filename)+".doc", "application/msword");
  return {images:st.images.length};
}

/* ---------- Aksi per dokumen ---------- */
async function exportBeritaAcaraWord(){
  const html = buildBeritaAcaraHtml();
  if(!html){ toast("Pilih Tim, Batch, dan Site yang sudah punya jadwal & titik terlebih dahulu.","err"); return; }
  toast("Menyusun file Word…","ok");
  await wordExportFromHtml(html, {orientation:"portrait", marginMm:18, filename:baExportFilename(), title:baExportFilename()});
  toast("Berita Acara diunduh sebagai file Word (.doc).","ok");
}
async function doExportRencanaWord(){
  const period = document.getElementById("rcPeriode").value || currentPeriodStr();
  const site = document.getElementById("rcFltSite").value;
  const mode = document.getElementById("rpMode").value;
  const orientation = document.getElementById("rpOrientation").value;
  const html = buildRencanaPrintHtml(period, site, mode);
  if(!html){ toast("Tidak ada titik yang cocok untuk diekspor.","err"); closeModal(); return; }
  closeModal();
  toast("Menyusun file Word…","ok");
  const name = `Daftar Titik Pantau_${period}${site?"_"+site:""}`;
  await wordExportFromHtml(html, {orientation, marginMm:12, filename:name, title:name});
  toast("Daftar Titik Pantau diunduh sebagai file Word (.doc).","ok");
}
async function exportDokFotoLampiranWord(pointIds){
  if(!pointIds || !pointIds.length){ toast("Tidak ada titik untuk diekspor.","err"); return; }
  const html = await buildDokFotoLampiranHtml(pointIds);
  if(!html){ toast("Titik tidak ditemukan.","err"); return; }
  toast("Menyusun file Word (foto ikut tertanam)…","ok");
  const name = dokFotoLampiranFilename(pointIds);
  const r = await wordExportFromHtml(html, {orientation:"portrait", marginMm:15, filename:name, title:name});
  toast(`Lampiran foto diunduh sebagai file Word (.doc) — ${r.images} gambar tertanam.`,"ok");
}
function exportAllVisibleDokFotoLampiranWord(){
  const withPhotos = getFilteredDokFotoPoints().filter(p=>dokFotoHasAnyPhoto(p.id));
  if(!withPhotos.length){ toast("Tidak ada titik dengan foto pada filter Tim/Batch/Site saat ini.","err"); return; }
  return exportDokFotoLampiranWord(withPhotos.map(p=>p.id));
}
Object.assign(ACTIONS, {
  exportBeritaAcaraWord,
  doExportRencanaWord,
  exportSingleDokFotoLampiranWord:(t)=>exportDokFotoLampiranWord([t.dataset.point]),
  exportAllVisibleDokFotoLampiranWord
});
