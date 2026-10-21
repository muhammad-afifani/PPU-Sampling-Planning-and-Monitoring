/* =========================================================
   IMPORT HASIL EMISI — pembaca PDF CoA/SHU (teks PDF + OCR) & review sebelum import
   Alur: unggah beberapa PDF/foto CoA → tiap halaman dibaca (lapisan teks PDF via pdf.js; kalau
   halaman berupa scan/gambar → OCR Tesseract.js di browser, tanpa API key) → nama sampel dicocokkan
   ke titik emisi → parameter wajib + pendukung disusun per baris, baku mutu/regulasi/running hour
   diisi otomatis (33-hasil-import.js) → review & edit → unduh Excel atau import ke Database.
   Pustaka dimuat saat dipakai saja: pdf.js dari assets/vendor (cadangan CDN), Tesseract dari CDN
   (±5 MB sekali unduh, disimpan cache browser utk pemakaian berikutnya).
========================================================= */
const COA_LIB = {
  pdfjs: ["assets/vendor/pdfjs/pdf.min.js", "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js", "https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.min.js"],
  tess: [
    {js:"https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js", worker:"https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js", core:"https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1", lang:"https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int"},
    {js:"https://unpkg.com/tesseract.js@5.1.1/dist/tesseract.min.js", worker:"https://unpkg.com/tesseract.js@5.1.1/dist/worker.min.js", core:"https://unpkg.com/tesseract.js-core@5.1.1", lang:"https://unpkg.com/@tesseract.js-data/eng@1.0.0/4.0.0_best_int"}
  ]
};
function coaLoadScript(src){
  return new Promise((ok, fail)=>{ const s = document.createElement("script"); s.src = src; s.onload = ()=>ok(src); s.onerror = ()=>{ s.remove(); fail(new Error("gagal memuat "+src)); }; document.head.appendChild(s); });
}
let coaPdfjsReady = null, coaTessWorker = null, coaTessReady = null;
function coaEnsurePdfjs(){
  if(window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if(coaPdfjsReady) return coaPdfjsReady;
  coaPdfjsReady = (async()=>{
    let lastErr;
    for(const src of COA_LIB.pdfjs){
      try{ await coaLoadScript(src); if(window.pdfjsLib){ window.pdfjsLib.GlobalWorkerOptions.workerSrc = src.replace(/pdf\.min\.js$/, "pdf.worker.min.js"); return window.pdfjsLib; } }catch(e){ lastErr = e; }
    }
    coaPdfjsReady = null; throw lastErr || new Error("pdf.js tidak tersedia");
  })();
  return coaPdfjsReady;
}
function coaEnsureOcr(onStatus){
  if(coaTessWorker) return Promise.resolve(coaTessWorker);
  if(coaTessReady) return coaTessReady;
  coaTessReady = (async()=>{
    let lastErr;
    for(const src of COA_LIB.tess){
      try{
        if(!window.Tesseract){ onStatus && onStatus("Mengunduh mesin OCR (sekali saja, ±5 MB)…"); await coaLoadScript(src.js); }
        onStatus && onStatus("Menyiapkan OCR (data bahasa Inggris)…");
        const w = await window.Tesseract.createWorker("eng", 1, {workerPath:src.worker, corePath:src.core, langPath:src.lang,
          logger: m=>{ if(m && m.status && onStatus && /load|initiali/i.test(m.status)) onStatus(`OCR: ${m.status}${m.progress?` ${Math.round(m.progress*100)}%`:""}`); }});
        coaTessWorker = w; return w;
      }catch(e){ lastErr = e; console.warn("OCR source gagal", src.js, e); }
    }
    coaTessReady = null;
    throw new Error("Mesin OCR tidak bisa diunduh (cek koneksi internet / CDN jsdelivr & unpkg). PDF yang punya lapisan teks tetap bisa dibaca tanpa OCR.");
  })();
  return coaTessReady;
}

/* ---------- Pra-proses citra scan utk OCR (fungsi murni di array grayscale) ----------
   median 3x3 (bintik/derau) → perbesar ke ±2400 px → rentang kontras → koreksi kemiringan
   (varians profil proyeksi) → pertajam → hapus garis tabel (biner Sauvola utk mendeteksi garis).
   Garis tabel dihapus krn bikin Tesseract salah memotong baris/kolom pada sel bergaris. */
function coaMedian3(g,w,h){ const o = new Uint8ClampedArray(g.length), a = new Array(9);
  for(let y=0;y<h;y++) for(let x=0;x<w;x++){ let k=0; for(let dy=-1;dy<=1;dy++){ const yy=Math.min(h-1,Math.max(0,y+dy)); for(let dx=-1;dx<=1;dx++){ const xx=Math.min(w-1,Math.max(0,x+dx)); a[k++]=g[yy*w+xx]; } } a.sort((p,q)=>p-q); o[y*w+x]=a[4]; } return o; }
function coaResize(g,w,h,s){ const W=Math.round(w*s), H=Math.round(h*s), o=new Uint8ClampedArray(W*H);
  for(let y=0;y<H;y++){ const fy=(y+0.5)/s-0.5, y0=Math.max(0,Math.floor(fy)), y1=Math.min(h-1,y0+1), ty=Math.min(1,Math.max(0,fy-y0));
    for(let x=0;x<W;x++){ const fx=(x+0.5)/s-0.5, x0=Math.max(0,Math.floor(fx)), x1=Math.min(w-1,x0+1), tx=Math.min(1,Math.max(0,fx-x0));
      const a=g[y0*w+x0]*(1-tx)+g[y0*w+x1]*tx, b=g[y1*w+x0]*(1-tx)+g[y1*w+x1]*tx; o[y*W+x]=a*(1-ty)+b*ty; } }
  return {g:o,w:W,h:H}; }
function coaHist(g){ const hs=new Uint32Array(256); for(let i=0;i<g.length;i++) hs[g[i]]++; return hs; }
function coaStretch(g){ const hs=coaHist(g), n=g.length; let lo=0,hi=255,c=0; for(let i=0;i<256;i++){ c+=hs[i]; if(c>n*0.005){ lo=i; break; } } c=0; for(let i=255;i>=0;i--){ c+=hs[i]; if(c>n*0.02){ hi=i; break; } }
  if(hi-lo<10) return g; const o=new Uint8ClampedArray(n), k=255/(hi-lo); for(let i=0;i<n;i++) o[i]=(g[i]-lo)*k; return o; }
function coaOtsu(g){ const hs=coaHist(g), n=g.length; let sum=0; for(let i=0;i<256;i++) sum+=i*hs[i]; let sB=0,wB=0,best=0,th=128;
  for(let t=0;t<256;t++){ wB+=hs[t]; if(!wB) continue; const wF=n-wB; if(!wF) break; sB+=t*hs[t]; const mB=sB/wB, mF=(sum-sB)/wF, v=wB*wF*(mB-mF)*(mB-mF); if(v>best){ best=v; th=t; } } return th; }
function coaSkewAngle(g,w,h){
  const s=Math.min(1, 900/w), r=s<1?coaResize(g,w,h,s):{g,w,h}; const th=coaOtsu(r.g); const pts=[];
  for(let y=0;y<r.h;y++) for(let x=0;x<r.w;x++) if(r.g[y*r.w+x]<th) pts.push(x,y);
  if(pts.length<200) return 0;
  const score=(deg)=>{ const a=deg*Math.PI/180, sn=Math.sin(a), cs=Math.cos(a), bins=new Float64Array(r.h*2+r.w); let s2=0;
    for(let i=0;i<pts.length;i+=2){ bins[Math.round(pts[i+1]*cs - pts[i]*sn + r.w)]++; } for(let i=0;i<bins.length;i++) s2+=bins[i]*bins[i]; return s2; };
  let best=0, bs=-1; for(let d=-8; d<=8; d+=0.5){ const v=score(d); if(v>bs){ bs=v; best=d; } }
  for(let d=best-0.5; d<=best+0.5; d+=0.1){ const v=score(d); if(v>bs){ bs=v; best=d; } }
  return Math.round(best*100)/100; }
function coaRotate(g,w,h,deg){ if(Math.abs(deg)<0.05) return {g,w,h}; const a=-deg*Math.PI/180, sn=Math.sin(a), cs=Math.cos(a);
  const W=Math.ceil(Math.abs(w*cs)+Math.abs(h*sn)), H=Math.ceil(Math.abs(w*sn)+Math.abs(h*cs)), o=new Uint8ClampedArray(W*H).fill(255), cx=w/2, cy=h/2, CX=W/2, CY=H/2;
  for(let y=0;y<H;y++) for(let x=0;x<W;x++){ const dx=x-CX, dy=y-CY, sx=dx*cs+dy*sn+cx, sy=-dx*sn+dy*cs+cy; if(sx<0||sy<0||sx>=w-1||sy>=h-1) continue;
    const x0=sx|0, y0=sy|0, tx=sx-x0, ty=sy-y0, i=y0*w+x0; o[y*W+x]=(g[i]*(1-tx)+g[i+1]*tx)*(1-ty)+(g[i+w]*(1-tx)+g[i+w+1]*tx)*ty; }
  return {g:o,w:W,h:H}; }
function coaUnsharp(g,w,h,amt){ const o=new Uint8ClampedArray(g.length);
  for(let y=0;y<h;y++) for(let x=0;x<w;x++){ let s=0; for(let dy=-1;dy<=1;dy++){ const yy=Math.min(h-1,Math.max(0,y+dy)); for(let dx=-1;dx<=1;dx++){ const xx=Math.min(w-1,Math.max(0,x+dx)); s+=g[yy*w+xx]; } } const v=g[y*w+x]; o[y*w+x]=v+amt*(v-s/9); } return o; }
function coaSauvola(g,w,h,win,k){ const W1=w+1, I=new Float64Array(W1*(h+1)), I2=new Float64Array(W1*(h+1));
  for(let y=0;y<h;y++){ let a=0,b=0; for(let x=0;x<w;x++){ const v=g[y*w+x]; a+=v; b+=v*v; I[(y+1)*W1+x+1]=I[y*W1+x+1]+a; I2[(y+1)*W1+x+1]=I2[y*W1+x+1]+b; } }
  const o=new Uint8ClampedArray(w*h), r=win>>1;
  for(let y=0;y<h;y++){ const y0=Math.max(0,y-r), y1=Math.min(h,y+r+1); for(let x=0;x<w;x++){ const x0=Math.max(0,x-r), x1=Math.min(w,x+r+1), n=(y1-y0)*(x1-x0);
    const s=I[y1*W1+x1]-I[y0*W1+x1]-I[y1*W1+x0]+I[y0*W1+x0], s2=I2[y1*W1+x1]-I2[y0*W1+x1]-I2[y1*W1+x0]+I2[y0*W1+x0], m=s/n, sd=Math.sqrt(Math.max(0,s2/n-m*m));
    o[y*w+x] = g[y*w+x] < m*(1+k*(sd/128-1)) ? 0 : 255; } }
  return o; }
function coaLineMask(b,w,h){ const m=new Uint8Array(w*h), Lh=Math.round(w*0.05), Lv=Math.round(h*0.02), GAP=3;
  for(let y=0;y<h;y++){ let x=0; while(x<w){ if(b[y*w+x]){ x++; continue; } let e=x, gap=0, last=x; while(e<w){ if(!b[y*w+e]){ last=e; gap=0; } else if(++gap>GAP) break; e++; } if(last-x>=Lh) for(let k=x;k<=last;k++) m[y*w+k]=1; x=last+1; } }
  for(let x=0;x<w;x++){ let y=0; while(y<h){ if(b[y*w+x]){ y++; continue; } let e=y, gap=0, last=y; while(e<h){ if(!b[e*w+x]){ last=e; gap=0; } else if(++gap>GAP) break; e++; } if(last-y>=Lv) for(let k=y;k<=last;k++) m[k*w+x]=1; y=last+1; } }
  return m; }
// Buang bintik 1 piksel (lebih gelap dr tetangga & tetangga gelapnya <2) — titik desimal 2x2 tetap aman,
// beda dgn median 3x3 yg ikut menghapus titik desimal huruf kecil (12.4 terbaca 124).
function coaSpeck(g,w,h){ const o=g.slice();
  for(let y=1;y<h-1;y++) for(let x=1;x<w-1;x++){ const i=y*w+x, v=g[i]; let s=0, dark=0;
    for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++){ if(!dx&&!dy) continue; const n=g[i+dy*w+dx]; s+=n; if(n < v+45) dark++; }
    const m=s/8; if(m - v > 40 && dark<2) o[i]=m; }
  return o; }
// Dua cabang pembersih derau (median = tahan derau berat, bintik = jaga titik desimal) → 3 varian citra
// utk OCR: A median+tanpa garis, B bintik+tanpa garis, C bintik polos (segmentasi kolom utk header).
async function coaPreprocess(g,w,h){
  let a = {g: w<2600 ? coaMedian3(g,w,h) : g, w, h}; await coaTick();
  let b = {g: coaSpeck(coaSpeck(g,w,h),w,h), w, h}; await coaTick();
  const sc = w < 2000 ? Math.min(2.5, 2400/w) : 1;
  if(sc>1.05){ a = coaResize(a.g,w,h,sc); b = coaResize(b.g,w,h,sc); }
  a.g = coaStretch(a.g); b.g = coaStretch(b.g);
  const angle = coaSkewAngle(a.g, a.w, a.h); a = coaRotate(a.g, a.w, a.h, angle); b = coaRotate(b.g, b.w, b.h, angle); await coaTick();
  const lm = coaLineMask(coaSauvola(a.g, a.w, a.h, 51, 0.3), a.w, a.h); await coaTick();
  const A = coaUnsharp(a.g, a.w, a.h, 0.6), C = coaUnsharp(b.g, b.w, b.h, 0.6), B = C.slice();
  const W = a.w;
  for(let y=1;y<a.h-1;y++) for(let x=1;x<W-1;x++){ const i=y*W+x; if(lm[i]){ for(const t of [A,B]){ t[i]=255; t[i-1]=255; t[i+1]=255; t[i-W]=255; t[i+W]=255; } } }
  return {w:a.w, h:a.h, angle, A, B, C};
}
function coaGrayFromCanvas(cv){ const d = cv.getContext("2d").getImageData(0,0,cv.width,cv.height).data, g = new Uint8ClampedArray(cv.width*cv.height);
  for(let i=0,j=0;i<d.length;i+=4,j++) g[j] = (d[i]*299 + d[i+1]*587 + d[i+2]*114)/1000; return g; }
function coaCanvasFromGray(g,w,h,rot){ // rot: 0/90/180/270 (searah jarum jam)
  const cv = document.createElement("canvas"); cv.width=w; cv.height=h; const ctx = cv.getContext("2d"), id = ctx.createImageData(w,h);
  for(let j=0;j<g.length;j++){ const v = g[j], i=j*4; id.data[i]=id.data[i+1]=id.data[i+2]=v; id.data[i+3]=255; } ctx.putImageData(id,0,0);
  rot = ((rot||0)%360+360)%360; if(!rot) return cv;
  const out = document.createElement("canvas"); out.width = rot===180 ? w : h; out.height = rot===180 ? h : w;
  const c2 = out.getContext("2d"); c2.translate(out.width/2, out.height/2); c2.rotate(rot*Math.PI/180); c2.drawImage(cv, -w/2, -h/2); return out; }
const coaTick = ()=>new Promise(r=>setTimeout(r, 0));

/* ---------- Baca satu file -> halaman {lines, method, conf, thumb} ---------- */
async function coaPdfTextLines(pdfjs, page){
  const vp = page.getViewport({scale:1});
  const tc = await page.getTextContent();
  const items = tc.items.filter(it=>it.str && it.str.trim()).map(it=>{
    const t = pdfjs.Util.transform(vp.transform, it.transform);
    const h = Math.hypot(t[2], t[3]) || 8;
    return {s:it.str, x:t[4], y:t[5], h, w: it.width * (Math.hypot(t[0],t[1]) / (Math.hypot(it.transform[0], it.transform[1])||1))};
  }).sort((a,b)=>a.y-b.y || a.x-b.x);
  const lines = [];
  items.forEach(it=>{
    const ln = lines.find(l=>Math.abs(l.y - it.y) <= 0.6*Math.max(l.h, it.h));
    if(ln){ ln.items.push(it); if(it.h > ln.h){ ln.h = it.h; ln.y = it.y; } }
    else lines.push({y:it.y, h:it.h, items:[it]});
  });
  lines.sort((a,b)=>a.y-b.y);
  return lines.map(l=>{
    l.items.sort((a,b)=>a.x-b.x);
    let out = "", prevEnd = null;
    l.items.forEach(it=>{
      const sup = it.h < 0.85*l.h && (l.y - it.y) > 0.22*l.h;   // naik dari baseline = pangkat (m³, 10⁻³)
      if(prevEnd!=null){ const gap = it.x - prevEnd; out += gap > 2.2*l.h ? "   " : gap > 0.18*l.h ? " " : ""; }
      out += (sup ? "^" : "") + it.s;
      prevEnd = it.x + it.w;
    });
    return out.replace(/\s+$/,"");
  });
}
async function coaOcrCanvas(cv, file, onStatus){
  const worker = await coaEnsureOcr(onStatus);
  onStatus && onStatus(`${file}: pra-proses citra (luruskan, bersihkan derau, hapus garis tabel)…`); await coaTick();
  let pre = await coaPreprocess(coaGrayFromCanvas(cv), cv.width, cv.height);
  const run = async(gray, psm, rot)=>{ await worker.setParameters({tessedit_pageseg_mode:String(psm), preserve_interword_spaces:"1"}); const r = await worker.recognize(coaCanvasFromGray(gray, pre.w, pre.h, rot)); return {lines:r.data.text.split(/\n/), conf:r.data.confidence}; };
  // Halaman terbalik / menyamping (scan diletakkan salah arah): kalau kata kunci CoA hampir tidak
  // terbaca, coba putar 90/180/270 dan ambil arah dgn kata kunci terbanyak (skor keyakinan Tesseract
  // tidak bisa dipercaya utk teks menyamping). Setelah arah ketemu, citra asli diputar lalu diproses ulang
  // (pelurusan & hapus garis tabel harus dihitung di arah yang benar).
  const kw = r=>(r.lines.join(" ").match(/sample|sampling|date|result|parameter|unit|method|oxide|concentration|report|analysis|opacity|sulfide|identification|hasil|tanggal|metode|baku|mutu/gi)||[]).length;
  onStatus && onStatus(`${file}: OCR 1/3 (kemiringan dikoreksi ${pre.angle}°)…`);
  let a = await run(pre.A, 6, 0), aK = kw(a), rot = 0;
  if(aK < 3){
    for(const d of [180, 90, 270]){ onStatus && onStatus(`${file}: halaman tampak terbalik/menyamping — mencoba putar ${d}°…`); const r2 = await run(pre.A, 6, d), k2 = kw(r2); if(k2 > aK){ aK = k2; rot = d; } if(aK >= 6) break; }
    if(rot){
      const out = document.createElement("canvas"); out.width = rot===180 ? cv.width : cv.height; out.height = rot===180 ? cv.height : cv.width;
      const c2 = out.getContext("2d"); c2.fillStyle = "#fff"; c2.fillRect(0,0,out.width,out.height); c2.translate(out.width/2, out.height/2); c2.rotate(rot*Math.PI/180); c2.drawImage(cv, -cv.width/2, -cv.height/2);
      cv = out; onStatus && onStatus(`${file}: diputar ${rot}°, pra-proses ulang…`);
      pre = await coaPreprocess(coaGrayFromCanvas(cv), cv.width, cv.height);
      a = await run(pre.A, 6, 0);
    }
  }
  onStatus && onStatus(`${file}: OCR 2/3…`);
  const b = await run(pre.B, 6, 0);
  onStatus && onStatus(`${file}: OCR 3/3 (header)…`);
  const c = await run(pre.C, 4, 0);
  return {variants:[a.lines, b.lines, c.lines], conf: Math.round(Math.max(a.conf, b.conf, c.conf)), angle: Math.round((pre.angle + rot)*100)/100, canvas: rot ? cv : null};
}
function coaThumb(cv){ const s = Math.min(1, 900/cv.width), t = document.createElement("canvas"); t.width = Math.round(cv.width*s); t.height = Math.round(cv.height*s); t.getContext("2d").drawImage(cv,0,0,t.width,t.height); return t.toDataURL("image/jpeg", 0.72); }
async function coaReadPdf(file, opts, onStatus){
  const pdfjs = await coaEnsurePdfjs();
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({data:buf}).promise;
  const pages = [];
  for(let n=1; n<=doc.numPages; n++){
    onStatus && onStatus(`${file.name}: halaman ${n}/${doc.numPages}…`);
    const page = await doc.getPage(n);
    let lines = opts.forceOcr ? [] : await coaPdfTextLines(pdfjs, page);
    const chars = lines.join("").replace(/\s/g,"").length;
    const vp = page.getViewport({scale: chars >= 40 && !opts.forceOcr ? 1.6 : 3.5}), cv = document.createElement("canvas");
    cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
    await page.render({canvasContext: cv.getContext("2d"), viewport: vp}).promise;
    const thumb = coaThumb(cv);
    if(chars >= 40 && !opts.forceOcr){ pages.push({pageNo:n, variants:[lines], method:"text", conf:100, thumb}); continue; }
    const o = await coaOcrCanvas(cv, `${file.name} hal. ${n}`, onStatus);
    pages.push({pageNo:n, variants:o.variants, method:"ocr", conf:o.conf, angle:o.angle, thumb: o.canvas ? coaThumb(o.canvas) : thumb});
  }
  return pages;
}
async function coaReadImage(file, onStatus){
  const url = URL.createObjectURL(file);
  try{
    const img = await new Promise((ok, fail)=>{ const im = new Image(); im.onload = ()=>ok(im); im.onerror = ()=>fail(new Error("gambar tidak bisa dibuka")); im.src = url; });
    const s = Math.min(1, 3400/Math.max(img.naturalWidth, img.naturalHeight));
    const cv = document.createElement("canvas"); cv.width = Math.round(img.naturalWidth*s); cv.height = Math.round(img.naturalHeight*s);
    const ctx = cv.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0,0,cv.width,cv.height); ctx.drawImage(img,0,0,cv.width,cv.height);
    const o = await coaOcrCanvas(cv, file.name, onStatus);
    return [{pageNo:1, variants:o.variants, method:"ocr", conf:o.conf, angle:o.angle, thumb:coaThumb(o.canvas || cv)}];
  } finally { URL.revokeObjectURL(url); }
}

/* ---------- Parser teks CoA/SHU -> sampel + baris parameter ---------- */
const COA_ROW_RE = [
  ["NOx", /n?itrogen\s*o\w*ide|\bn\s*[o0]\s*[x×y]\b|\bn[o0]x\b/i],
  ["SO₂", /sul(?:f|ph)ur\s*d\w*ide|\bs[o0]\s*[2₂]\b/i],
  ["CO₂", /carbon\s*d\w*xide|carbon\s*di\w*/i],
  ["CO", /carbon\s*(?:n?m[o0]n|nm|m)\w*xide|^\W*c[o0]\b(?!\s*[2₂])/i],
  ["Total Partikulat", /total\s*partic\w*|partikulat/i],
  ["Opasitas", /opacity|opasitas/i],
  ["H2S", /hydrogen\s*sul\w*|hidrogen\s*sul\w*|\bh\s*[2₂,]\s*s\b/i],
  ["O₂", /^\W*ox[yv]gen|^\W*oksigen/i],
  ["Gas Temperatur", /gas\s*temp\w*|temperat\w*/i],
  ["Laju Alir (v)", /flow\s*rate|flowrate|fowrate|laju\s*alir/i],
  ["Kecepatan Gas", /veloc\w*|kecepatan/i],
  ["Kadar Air", /moisture|kadar\s*air/i],
  ["Isokinetik", /isokinet\w*/i],
  ["__capacity", /^\W*capac\w*|^\W*kapasitas/i],
  ["__fuel", /^\W*fuel\b|^\W*bahan\s*bakar/i]
];
const COA_SKIP_RE = /^\W*(tested\s*for|subject|note\b|catatan|parameter\s+unit|regulation|method\s*of\s*sampling|type\s*of\s*sample|description)/i;
const COA_UNIT_RE = /\bm[gq]\s*\/?\s*n?\s*m(?:\^?[3³](?![\d.,])|[?*'’"°](?!\d))?|µg\s*\/\s*n?m\S?|°\s*c\b|\bo\s*c\b|\bm\s*\^?[3³]?\s*\/\s*s\b|\bm\s*\/\s*s\b|\bkw\b|%/i;
const COA_METHOD_RE = /(p[o0]\s*\/\s*bpp[\w\-\/. ]*?\d+|sn[il1]\s*[\d][\d\-.: ]*\d|thermocoupl\w*|calculat\w*|\(\s*(?:elektro|electro)\w*\s*\)|electrometric|gravimetri\w*|us\s*epa[\w\- ]*\d*|astm\s*[\w\-]+)/ig;
const COA_METHOD_START = /(p[o0]\s*\/|sn[il1]\s*\d|thermo|calcul|electro|elektro|astm|us\s*epa|gravim)/i;
function coaCleanLine(s){
  return String(s||"").replace(/[–—−]/g,"-").replace(/[’‘]/g,"'").replace(/[“”]/g,'"').replace(/\bN\s*m\s*\^\s*3/g,"Nm3").replace(/\bm\s*\^\s*3/g,"m3").replace(/\s+/g," ").trim();
}
function coaNum(s){ return s.replace(/\s+/g,"").replace(/^≤/,"<").replace(/^≥/,">").replace(/(\d),(\d)/,"$1.$2"); }
// Nilai2 numerik dari potongan teks (setelah satuan, sebelum metode)
function coaValues(t){
  const out = []; const re = /([<>≤≥]\s*)?(\d+(?:[.,]\d+)?)(\s*[x×X*]\s*10\s*(?:\^?\s*[-–−]?\s*\d{1,2})?)?/g; let m;
  while((m = re.exec(t))){
    let v = coaNum((m[1]||"") + m[2]);
    if(m[3]){ const e = m[3].match(/10\s*\^?\s*([-–−]?)\s*(\d{1,2})?$/); v += e && e[2] ? ` x 10^${e[1]?"-":""}${e[2]}` : " x 10^?"; }
    out.push(v);
  }
  return out;
}
function coaRowFromLine(line){
  if(COA_SKIP_RE.test(line)) return null;
  for(const [param, re] of COA_ROW_RE){
    const m = line.match(re); if(!m) continue;
    let rest = line.slice(m.index + m[0].length);
    rest = rest.replace(/\bas\s+n[o0]\s*[2₂]?/ig," ").replace(/\(\s*(act|std|actual|standard)\s*\)/ig, (x,y)=>` [${y.toUpperCase()}] `)
               .replace(/\(\s*[a-z]{1,3}\s*[\dx₂,;:.]*\s*[a-z]?\s*\)/ig," ").replace(/[#*]/g," ");
    const variant = (rest.match(/\[(ACT|STD|ACTUAL|STANDARD)\]/)||[])[1] || "";
    rest = rest.replace(/\[(ACT|STD|ACTUAL|STANDARD)\]/g," ");
    const um = rest.match(COA_UNIT_RE);
    let unit = "", vals = rest;
    if(um){ unit = um[0]; vals = rest.slice(um.index + um[0].length); if(/m/i.test(unit)) vals = vals.replace(/^\s*[?*'’"°]?\s*[3³](?=\s)/, " "); }
    else vals = rest.replace(/\b(n[o0]|s[o0]|c[o0]|[o0]|h)\s*[2₂x]\b/ig," ");
    const ms = vals.search(COA_METHOD_START);
    const valText = ms>=0 ? vals.slice(0, ms) : vals;
    const methods = (line.match(COA_METHOD_RE)||[]).map(x=>x.trim());
    if(param==="__fuel"){ const f = valText.replace(/^[\s:\-]+/,"").trim().split(/\s{2,}|\s/)[0]||""; return {param, text: /gas|diesel|solar|minyak|hsd|oil/i.test(f) ? f : ""}; }
    if(param==="__capacity"){ const v = (valText.match(/[<>]?\s*\d[\d.,]*/)||[""])[0]; return {param, text: v.replace(/\s+/g," ").trim()}; }
    let values = coaValues(valText);
    const want = HE_PARAMS[param] && HE_PARAMS[param].kind==="main" ? 3 : 1;
    if(values.length > want && /^[23]$/.test(values[0]) && /m/i.test(unit||"mg")) values = values.slice(1);   // pangkat ³ satuan yg lepas
    return {param, unit, values, methods, variant};
  }
  return null;
}
function coaNormUnit(u, param){
  const t = String(u||"").toLowerCase();
  if(/mg|µg/.test(t)) return "mg/Nm³";
  if(/%/.test(t)) return "%";
  if(/c\b/.test(t)) return "oC";
  if(/m\s*\^?[3³]?\s*\/\s*s/.test(t) && /3|³/.test(t)) return "m3/s";
  if(/m\s*\/\s*s/.test(t)) return param==="Laju Alir (v)" ? "m3/s" : "m/s";
  return (HE_PARAMS[param]||{}).unit || u || "";
}
function coaFindSampleName(line){
  const m = line.match(/^\W*(?:sampl\w*|sampel|contoh)\s+[a-z1|]\w*\s*[:;]\s*(.+)$/i) || line.match(/^\W*(?:identifikasi|kode|nama)\s+(?:contoh|sampel|sample|titik)\w*[^:;]*[:;]\s*(.+)$/i);
  if(!m) return "";
  if(/\b(was|were|submitted|drawn|identified by)\b/i.test(m[1])) return "";
  return m[1].split(/\s{3,}/)[0].replace(/^[\s:;.\-"']+|[\s,.;:"']+$/g,"").trim();
}
function coaFindSamplingDate(line){
  if(/receiv|terima|analy|analis/i.test(line)) return "";
  const m = line.match(/(date\s*of\s*sampl\w*|sampling\s*date|tanggal\s*(?:pengambilan|sampling|sampel)\w*)(.*)$/i);
  return m ? heParseDateAny(m[2]) : "";
}
function coaFindRef(line){
  const m = line.match(/^\W*(reference|referensi|no\.?\s*(?:sertifikat|certificate|report|laporan)|(?:certificate|report)\s*no\.?|nomor\s*(?:sertifikat|laporan))\s*[:;]\s*(.+)$/i);
  return m ? m[2].split(/\s{3,}/)[0].trim() : "";
}
// Satu blok baris (satu varian teks halaman) -> nama sampel (posisi), baris parameter (posisi), tanggal
function coaParseBlock(L, fmt){
  const names = []; L.forEach((l,i)=>{ const n = coaFindSampleName(l); if(n) names.push({i, n}); });
  let date = ""; L.forEach(l=>{ if(!date) date = coaFindSamplingDate(l); });
  const isRowLine = l=>!!coaRowFromLine(l);
  const rows = [];
  L.forEach((l,i)=>{
    const r = coaRowFromLine(l); if(!r) return;
    if(r.param.startsWith("__")){ rows.push({i, r}); return; }
    // Sel tabel bertingkat (label 2 baris / angka di baris sebelah) — ambil baris tetangga non-parameter
    // yg angkanya lebih lengkap.
    const want = HE_PARAMS[r.param] && HE_PARAMS[r.param].kind==="main" ? (fmt==="emisi3" ? 3 : 2) : 1;
    [i+1, i-1].forEach(j=>{
      if(j<0 || j>=L.length || r.values.length>=want || isRowLine(L[j]) || coaFindSampleName(L[j])) return;
      const um = L[j].match(COA_UNIT_RE); let t = um ? L[j].slice(um.index+um[0].length) : L[j];
      const ms = t.search(COA_METHOD_START); if(ms>=0) t = t.slice(0, ms);
      const v = coaValues(t.replace(/\b(n[o0]|s[o0]|c[o0]|[o0]|h)\s*[2₂x]\b/ig," "));
      if(v.length > r.values.length){ r.values = v; if(!r.unit && um) r.unit = um[0]; }
    });
    // Metode yg terbelah ke atas/bawah: dari atas hanya kode (PO/BPP…, SNI…), dari bawah hanya lanjutan
    // dlm kurung "(Elektrokimia)" — supaya "(Elektrokimia)" milik baris di atasnya tidak ikut terambil.
    for(const j of [i-1, i-2, i+1, i+2]){
      if(j<0 || j>=L.length) continue;
      if(isRowLine(L[j])) continue;
      if(Math.abs(j-i)===2 && isRowLine(L[(i+j)/2])) continue;
      (L[j].match(COA_METHOD_RE)||[]).forEach(x=>{ x = x.trim(); if((j<i) === x.startsWith("(")) return; if(!r.methods.includes(x)) r.methods[j<i?"unshift":"push"](x); });
    }
    rows.push({i, r});
  });
  return {names, date, rows};
}
function coaFieldPlausible(param, v){
  const n = hasilParseResult(v).numeric; if(n==null) return false;
  const R = {"O₂":[0,21], "CO₂":[0,20], "Gas Temperatur":[20,1200], "Laju Alir (v)":[0.01,2000], "Kecepatan Gas":[0.1,120], "Kadar Air":[0,60], "Isokinetik":[50,150], "Opasitas":[0,100], "H2S":[0,5]}[param];
  return R ? n>=R[0] && n<=R[1] : true;
}
// Gabung pembacaan beberapa varian OCR utk satu parameter: suara terbanyak, lalu kelengkapan kolom,
// kewajaran nilai, dan adanya titik desimal.
function coaMergeRow(cands, param, fmt){
  if(cands.length===1) return cands[0];
  const want = HE_PARAMS[param] && HE_PARAMS[param].kind==="main" ? (fmt==="emisi3" ? 3 : 2) : 1;
  const key = c=>c.values.slice(0, want).join("|");
  let best = null, bs = -1;
  cands.forEach(c=>{
    const votes = cands.filter(o=>key(o)===key(c) && key(c)!=="").length;
    const n = Math.min(c.values.length, want);
    const plaus = c.values.slice(0, want).every(v=>coaFieldPlausible(param, v)) ? 1 : 0;
    const dec = c.values.slice(0, want).filter(v=>/\./.test(v)).length;
    const sc = votes*4 + n*3 + plaus*3 + dec - (c.values.length>want+1 ? 1 : 0);
    if(sc > bs){ bs = sc; best = c; }
  });
  const out = {...best, methods: best.methods.slice()};
  if(!out.methods.length) cands.forEach(c=>c.methods.forEach(m=>{ if(!out.methods.includes(m)) out.methods.push(m); }));
  if(!out.unit) out.unit = (cands.find(c=>c.unit)||{}).unit || "";
  return out;
}
// Halaman-halaman satu dokumen -> daftar sampel mentah
function coaParsePages(pages, fileName){
  const allText = pages.map(p=>p.variants.map(v=>v.join("\n")).join("\n")).join("\n");
  let fmt = /co[r1il]{1,3}e[ce]t|co[r1il]{1,3}e[ce]i|terkoreks|measurement\s*conc/i.test(allText) ? "emisi3" : "single";
  const lab = /sucofindo/i.test(allText) ? "Sucofindo" : ((DB.laboratorium||[]).find(l=>l.nama && allText.toLowerCase().includes((l.nama.replace(/^PT\.?\s*/i,"").split(/[\s(]/)[0]||"").toLowerCase()))||{}).nama || "";
  let docDate = "", docRef = "";
  pages.forEach(p=>p.variants.forEach(v=>v.map(coaCleanLine).forEach(l=>{ if(!docDate) docDate = coaFindSamplingDate(l); if(!docRef) docRef = coaFindRef(l); })));
  const samples = [];
  let last = null;
  pages.forEach(pg=>{
    const Vs = pg.variants.map(v=>v.map(coaCleanLine).filter(Boolean));
    const parsed = Vs.map(L=>coaParseBlock(L, fmt));
    if(fmt==="single" && parsed.some(p=>p.rows.some(x=>HE_PARAMS[x.r.param] && HE_PARAMS[x.r.param].kind==="main" && x.r.values.length>=3))){ fmt = "emisi3"; }
    const text = Vs.map((L,k)=>(k?`\n--- pembacaan OCR ${k+1} ---\n`:"")+L.join("\n")).join("");
    const mk = (name)=>({name, fileName, page:pg.pageNo, method:pg.method, conf:pg.conf, angle:pg.angle, thumb:pg.thumb, text, fmt, lab, ref:docRef, date:"", capacity:"", fuel:"", rows:[]});
    const addRow = (s, r)=>{
      if(r.param==="__fuel"){ if(r.text && !s.fuel) s.fuel = r.text; return; }
      if(r.param==="__capacity"){ if(r.text && !s.capacity) s.capacity = r.text; return; }
      if(r.param==="Laju Alir (v)" && /STD|STANDARD/.test(r.variant) && s.rows.some(x=>x.param==="Laju Alir (v)")) return;
      const ex = s.rows.find(x=>x.param===r.param);
      if(ex){ if(r.param==="Laju Alir (v)" && /ACT/.test(r.variant)) s.rows.splice(s.rows.indexOf(ex),1); else return; }
      s.rows.push({param:r.param, unit:coaNormUnit(r.unit, r.param), values:r.values, methods:r.methods, variant:r.variant});
    };
    if(Vs.length > 1){
      // Halaman OCR (1 sampel per halaman): pilih nama yg paling cocok dgn Database Titik Pantau, lalu
      // gabungkan baris tiap parameter dari 3 pembacaan.
      const nameCands = parsed.flatMap(p=>p.names.map(x=>x.n));
      let name = ""; let bs = -1; nameCands.forEach(n=>{ const sc = heMatchPoint(n).score; if(sc > bs){ bs = sc; name = n; } });
      const hasRows = parsed.some(p=>p.rows.some(x=>!x.r.param.startsWith("__")));
      if(!name && !hasRows) return;
      let s;
      if(!name && last && last.fileName===fileName) s = last;
      else { s = mk(name); s.date = parsed.map(p=>p.date).find(Boolean) || docDate; samples.push(s); }
      const byParam = new Map();
      parsed.forEach(p=>{ const seen = new Set(); p.rows.forEach(({r})=>{ const k = r.param + (r.param==="Laju Alir (v)" && /STD|STANDARD/.test(r.variant) ? "#std" : ""); if(seen.has(k)) return; seen.add(k); if(!byParam.has(k)) byParam.set(k, []); byParam.get(k).push(r); }); });
      byParam.forEach((cands, k)=>{ const r = k.startsWith("__") ? cands.find(c=>c.text) || cands[0] : coaMergeRow(cands, cands[0].param, fmt); addRow(s, r); });
      s.fmt = fmt; last = s; return;
    }
    const L = Vs[0], P = parsed[0];
    const pageSamples = P.names.map(x=>({...x, s:mk(x.n)}));
    const sampleAt = (i)=>{ let s = null; pageSamples.forEach(ps=>{ if(ps.i<=i) s = ps.s; }); return s || (pageSamples[0] && pageSamples[0].s) || null; };
    if(!pageSamples.length && P.rows.some(x=>!x.r.param.startsWith("__"))){
      if(last && last.fileName===fileName) pageSamples.push({i:0, s:last, cont:true}); else pageSamples.push({i:0, s:mk("")});
    }
    pageSamples.forEach(ps=>{ if(!ps.cont){ ps.s.date = P.date || docDate; samples.push(ps.s); } last = ps.s; });
    P.rows.forEach(({i, r})=>{ const s = sampleAt(i) || last; if(s) addRow(s, r); });
    if(L.length && !pageSamples.length){ /* halaman tanpa data (syarat & ketentuan dll) */ }
  });
  samples.forEach(s=>{ s.fmt = fmt; });
  return samples;
}

/* ---------- State & sampel review ---------- */
const coaState = {samples:[], files:[], useValue:"corrected", forceOcr:false, onlyIssues:false, busy:false, showDoc:null, replace:true};
let coaSeq = 0;
function coaNewId(p){ return (p||"s")+(++coaSeq); }
// Sampel mentah hasil parser -> sampel review (cocokkan titik, susun baris wajib + pendukung)
function coaSampleFromParsed(raw){
  const mt = heMatchPoint(raw.name);
  const s = {id:coaNewId("s"), source: raw.method==="ocr" ? "ocr" : "pdf", fileName:raw.fileName, page:raw.page, method:raw.method, conf:raw.conf, angle:raw.angle, thumb:raw.thumb, text:raw.text,
    nameRead:raw.name, pointId: mt.point ? mt.point.id : "", matchScore:mt.score, candidates:mt.candidates,
    dateOfSampling: raw.date || "", periodeManual:"", lab:raw.lab, ref:raw.ref, capacity:raw.capacity, fuel:raw.fuel, fmt:raw.fmt, rows:[]};
  raw.rows.forEach(r=>s.rows.push(coaRowFromParsed(r, raw.fmt)));
  if(raw.method==="ocr") s.rows.forEach(r=>{ coaFixDecimal(s, r); coaGuessExponent(s, r); });
  coaSyncRequiredRows(s);
  return s;
}
// OCR sering menghilangkan titik desimal di huruf kecil tabel field data (12.4 -> 124). Kalau nilai
// bulat tidak wajar / jauh dari riwayat cerobong sedangkan nilai/10 wajar & dekat riwayat, pakai nilai/10
// dan beri catatan supaya dicek.
function coaFixDecimal(s, r){
  if((HE_PARAMS[r.param]||{}).kind==="main") return;
  const list = (r.valuesList||[]).filter(v=>/^\d+(\.\d+)?$/.test(v)); if(!list.length) return;
  const p = coaPoint(s), med = p ? coaHistMedian(p, r.param) : null;
  const cands = [];
  list.forEach((v,i)=>{ cands.push({v, n:Number(v), fix:false, i}); if(/^\d{2,}$/.test(v)) cands.push({v:String(Number(v)/10), n:Number(v)/10, fix:true, i}); });
  const score = c=>(coaFieldPlausible(r.param, c.v) ? 0 : 5) + (med && c.n>0 ? Math.abs(Math.log(c.n/med)) : 0) + (c.fix ? 0.4 : 0) + (c.i===list.length-1 ? 0 : 0.25) + (c.i===0 && list.length>1 && /^(9|96|5)$/.test(list[0]) && (HE_PARAMS[r.param]||{}).unit==="%" ? 1 : 0);
  cands.sort((a,b)=>score(a)-score(b));
  const best = cands[0];
  if(best.v!==r.single){ r.autoFix = best.fix ? `OCR membaca ${list[best.i]}; titik desimal disisipkan → ${best.v} — cek dokumen` : `Dipilih ${best.v} dari bacaan [${list.join(", ")}] — cek dokumen`; r.single = best.v; }
}
// Pangkat 10 hilang saat OCR ("3.1 x 10⁻³" terbaca "31x10°") — tebak dari riwayat cerobong yg sama
// (mantisa 31 atau 3.1, pangkat yg hasilnya paling dekat median riwayat), tetap diberi catatan cek.
function coaGuessExponent(s, r){
  const v = r.single || ""; const m = v.match(/^([<>]?)(\d+(?:\.\d+)?) x 10\^(\?|\d+)$/); if(!m) return;
  const p = coaPoint(s), med = p ? coaHistMedian(p, r.param) : null; if(!med) return;
  const mant = [Number(m[2])]; if(/^\d{2}$/.test(m[2])) mant.unshift(Number(m[2])/10);   // bentuk baku (mantisa < 10) didahulukan bila sama dekat
  let best = null;
  mant.forEach(mt=>{ for(let e=-8;e<=2;e++){ const val = mt*Math.pow(10,e), d = Math.abs(Math.log(val/med)); if(!best || d<best.d) best = {mt, e, d}; } });
  if(best && best.d < 2.3){ r.single = `${m[1]}${best.mt} x 10^${best.e}`; r.autoFix = `OCR membaca "${v.replace(" x 10^?"," x 10^?")}"; pangkat ditebak dari riwayat (median ${med}) → ${r.single} — cek dokumen`; }
}
function coaRowFromParsed(r, fmt){
  const v = r.values||[], kind = (HE_PARAMS[r.param]||{}).kind;
  const row = {id:coaNewId("r"), param:r.param, unit:r.unit, found:true, include: kind!=="extra", metode:(r.methods||[]).join(" "), measured:null, corrected:null, single:null, bmCoa:null, valuesRead:v.join(" | "), edited:false, value:"", standardOverride:null};
  if(kind==="main" && fmt==="emisi3"){ row.measured = v[0]||null; row.corrected = v[1]||null; row.bmCoa = v[2]||null; if(v.length===1) row.single = v[0]; }
  else if(kind==="main"){ row.single = v[0]||null; row.bmCoa = v[1]||null; }
  else { row.single = v[0]||null; row.valuesList = v.slice(); }
  return row;
}
// Pastikan semua parameter wajib + pendukung titik terpilih punya baris (yg tdk ketemu = isian manual).
function coaSyncRequiredRows(s){
  const p = DB.points.find(x=>x.id===s.pointId);
  if(!p || s.source==="excel") return;
  heRequiredParams(p).concat(heSupportParams(p)).forEach(param=>{
    if(!s.rows.some(r=>r.param===param)) s.rows.push({id:coaNewId("r"), param, unit:(HE_PARAMS[param]||{}).unit||"", found:false, include:true, metode:"", measured:null, corrected:null, single:null, bmCoa:null, valuesRead:"", edited:false, value:"", standardOverride:null});
  });
  const order = Object.keys(HE_PARAMS);
  s.rows.sort((a,b)=>(order.indexOf(a.param)<0?99:order.indexOf(a.param)) - (order.indexOf(b.param)<0?99:order.indexOf(b.param)));
}
function coaSampleFromExcel(g){
  const mt = heMatchPoint(g.name);
  const exact = DB.points.find(p=>p.kategori==="emisi" && p.nama.trim()===g.name);
  const s = {id:coaNewId("s"), source:"excel", fileName:"Excel", page:null, method:"excel", conf:100, thumb:null, text:"",
    nameRead:g.name, pointId: exact ? exact.id : (mt.point ? mt.point.id : ""), matchScore: exact ? 1 : mt.score, candidates:mt.candidates,
    dateOfSampling:g.date||"", periodeManual: g.date ? "" : g.periode, lab:"", ref:"", capacity:"", fuel:"", fmt:"single", rows:[]};
  g.rows.forEach(r=>{
    const param = heCanonParam(r["PARAMETER"]);
    const result = r["RESULT"]==null ? "" : String(r["RESULT"]).trim();
    const std = r["STANDARD PERMEN LH 13 2009"]!=="" && r["STANDARD PERMEN LH 13 2009"]!=null ? r["STANDARD PERMEN LH 13 2009"] : r["STANDAR PERMEN LH 11 2021"];
    s.rows.push({id:coaNewId("r"), param, unit: String(r["UNIT"]||"").trim() || (HE_PARAMS[param]||{}).unit || "", found:true, include: !!result, metode:String(r["Metode"]||"").trim(),
      measured:null, corrected:null, single: result||null, bmCoa: std!=null && std!=="" ? String(std) : null, valuesRead:result, edited:false, value:"", standardOverride:null,
      xls:{site:String(r["SITE"]||"").trim(), namaSumber:String(r["NAMA SUMBER EMISI"]||"").trim(), kategoriKapasitas:String(r["KATEGORI KAPASITAS"]||"").trim(), jenisBahanBakar:String(r["JENIS BAHAN BAKAR"]||"").trim(),
        rh: r["RUNNING HOUR (1 Tahun kebelakang)"], regulasi:String(r["CHCEK PERMEN"]||"").trim(), keterangan:String(r["KETERANGAN"]||"").trim(), remarks:String(r["REMARKS"]||"").trim()}});
  });
  return s;
}
function coaAddSamples(samples, label){
  coaState.samples = coaState.samples.concat(samples);
  if(label) coaState.files.push({id:coaNewId("f"), name:label, status:"done", msg:`${samples.length} sampel`, method:"excel"});
  if(document.getElementById("page-coareader") && document.getElementById("page-coareader").classList.contains("active")) renderCoaReader();
}

/* ---------- Nilai turunan per baris (dihitung ulang tiap render) ---------- */
function coaPoint(s){ return DB.points.find(p=>p.id===s.pointId) || null; }
function coaPeriode(s){ return s.periodeManual || hePeriodeOfDate(s.dateOfSampling) || ""; }
function coaRowValue(r){
  if(r.edited) return r.value;
  if(coaState.useValue==="measured") return r.measured || r.single || r.corrected || "";
  return r.corrected || r.single || r.measured || "";
}
// Median riwayat hasil (cerobong yg sama; kalau riwayatnya <2 data, pakai sumber sejenis — kelompok
// regulasi & bahan bakar sama; riwayat cerobong sendiri cukup 1 data) — dipakai utk menandai angka yg janggal dan memilih bacaan OCR.
const coaMedCache = new Map();
function coaHistMedian(p, param, own){
  const k = p.id+"|"+param+"|"+(own?1:0); if(coaMedCache.has(k)) return coaMedCache.get(k);
  const med = (arr, min)=>{ const v = arr.map(r=>r.resultNumeric).sort((a,b)=>a-b); return v.length>=min ? v[Math.floor(v.length/2)] : null; };
  const ok = r=>r.parameter===param && r.resultNumeric!=null && r.resultStatus==="measured";
  let m = med(DB.hasilPemantauan.filter(r=>ok(r) && (r.engineId===p.id || r.cerobong===p.nama)), 1);
  if(m==null && !own){
    const g = pointRegGroup(p), f = regKeyFuel(p.jenisBahanBakar);
    const ptById = new Map(DB.points.map(x=>[x.id, x]));
    m = med(DB.hasilPemantauan.filter(r=>{ if(!ok(r)) return false; const q = ptById.get(r.engineId); return q && pointRegGroup(q)===g && regKeyFuel(q.jenisBahanBakar)===f; }), 2);
  }
  coaMedCache.set(k, m); return m;
}
function coaDerive(s, r){
  const p = coaPoint(s), periode = coaPeriode(s);
  const val = String(coaRowValue(r)||"").trim();
  const res = hasilParseResult(val);
  const bm = p ? heBakuMutu(p, r.param) : {value:null, src:"Titik belum dipilih"};
  let standard = r.standardOverride!=null && r.standardOverride!=="" ? Number(r.standardOverride) : bm.value;
  if(standard==null && s.source==="excel" && r.bmCoa!=null && r.bmCoa!=="" && !isNaN(Number(r.bmCoa))) standard = Number(r.bmCoa);
  const status = hasilStatusVsStandard(res.numeric, res.status, standard);
  const pct = res.numeric!=null && standard ? Math.round(res.numeric/standard*1000)/10 : null;
  const flags = [];
  const kind = (HE_PARAMS[r.param]||{}).kind;
  if(!HE_PARAMS[r.param]) flags.push({lv:"warn", t:`Parameter "${r.param}" tidak dikenal — cek ejaan`});
  if(r.autoFix && !r.edited) flags.push({lv:"warn", t:r.autoFix});
  if(!r.found) flags.push({lv:"err", t:"Tidak ditemukan di dokumen — isi manual atau hapus centang"});
  else if(!val && r.include) flags.push({lv:"err", t:"Nilai kosong / tidak terbaca"});
  if(val && /\^\?/.test(val)) flags.push({lv:"err", t:"Pangkat 10 tidak terbaca — tulis mis. 3.1 x 10^-3"});
  if(val && res.status==="other") flags.push({lv:"warn", t:"Format nilai tidak biasa — cek"});
  if(r.found && kind==="main" && s.fmt==="emisi3" && !r.edited && s.source!=="excel" && (!r.measured || !r.corrected)) flags.push({lv:"warn", t:"Kolom terukur/terkoreksi tidak lengkap terbaca"});
  if(r.bmCoa!=null && r.bmCoa!=="" && bm.value!=null && Math.abs(Number(String(r.bmCoa).replace(/[^\d.]/g,"")) - bm.value) > 0.001*bm.value) flags.push({lv:"warn", t:`BM di dokumen ${r.bmCoa} ≠ BM regulasi tools ${bm.value}`});
  const n = res.numeric;
  if(n!=null){
    if((r.param==="O₂" && n>21) || (r.param==="CO₂" && n>25) || (r.param==="Opasitas" && n>100) || (r.param==="H2S" && n>5) || (r.param==="Gas Temperatur" && n>1500)) flags.push({lv:"err", t:"Nilai tidak wajar untuk parameter ini — cek titik desimal/OCR"});
    if(p){ const med = coaHistMedian(p, r.param, true); if(med && (n > med*4 || n < med/4) && n>0) flags.push({lv:"warn", t:`Jauh dari riwayat cerobong ini (median ${med})`}); }
    if(n===0 && kind==="main") flags.push({lv:"warn", t:"Nilai 0 — pastikan bukan salah baca"});
  }
  if(r.include && p && periode){
    const twin = coaState.samples.find(o=>o!==s && o.pointId===s.pointId && coaPeriode(o)===periode && o.rows.some(x=>x.include && x.param===r.param && String(coaRowValue(x)||"").trim()));
    if(twin) flags.push({lv:"warn", t:`Parameter ini juga ada di ${twin.fileName}${twin.page?` hal. ${twin.page}`:""} (titik & periode sama) — hapus centang salah satu; kalau keduanya diimport, yang terakhir menimpa`});
    const dup = DB.hasilPemantauan.find(x=>(x.engineId===p.id || x.cerobong===heIdentity(p).cerobong) && x.periode===periode && heCanonParam(x.parameter)===r.param);
    if(dup) flags.push({lv:"info", t:`Sudah ada di database ${periode} (${dup.resultRaw}) — ${coaState.replace?"akan diganti":"dilewati"}`});
  }
  return {p, periode, val, res, bm, standard, status, pct, flags};
}
function coaSampleFlags(s){
  const p = coaPoint(s), f = [];
  if(!p) f.push({lv:"err", t: s.nameRead ? `"${s.nameRead}" tidak cocok dgn titik di Database Titik Pantau — pilih titiknya` : "Nama sampel tidak terbaca — pilih titiknya"});
  else if(s.matchScore<0.97 && s.source!=="excel") f.push({lv:"warn", t:`Dicocokkan otomatis (kemiripan ${Math.round(s.matchScore*100)}%) dari "${s.nameRead}" — pastikan benar`});
  if(!coaPeriode(s)) f.push({lv:"err", t:"Tanggal sampling tidak terbaca — isi tanggal"});
  if(s.method==="ocr" && s.conf<70) f.push({lv:"warn", t:`Kualitas scan rendah (keyakinan OCR ${s.conf}%) — cek semua angka`});
  if(p && s.fuel && regKeyFuel(s.fuel)==null && !/gas/i.test(s.fuel)){}
  if(p && s.fuel){ const a = regKeyFuel(s.fuel) || (/diesel|solar|hsd|oil/i.test(s.fuel)?"minyak":/gas/i.test(s.fuel)?"gas":null), b = regKeyFuel(p.jenisBahanBakar); if(a && b && a!==b) f.push({lv:"warn", t:`Bahan bakar di dokumen "${s.fuel}" ≠ Database Titik Pantau "${p.jenisBahanBakar}"`}); }
  return f;
}
function coaIssueCount(s){ return coaSampleFlags(s).filter(x=>x.lv!=="info").length + s.rows.filter(r=>r.include).reduce((a,r)=>a+coaDerive(s,r).flags.filter(x=>x.lv!=="info").length,0); }

/* ---------- Render halaman ---------- */
const COA_STATUS_BADGE = {ok:["b-green","Memenuhi"], exceed:["b-red","Melebihi BM"], not_applicable:["b-gray","Tanpa BM"], not_evaluated:["b-amber","Belum dievaluasi"]};
function renderCoaReader(){
  const root = document.getElementById("coaRoot"); if(!root) return;
  const pending = coaState.files.filter(f=>f.status!=="done" && f.status!=="error").length;
  const samples = coaState.samples;
  const rowsIncl = samples.reduce((a,s)=>a+s.rows.filter(r=>r.include).length,0);
  const issues = samples.reduce((a,s)=>a+coaIssueCount(s),0);
  const comp = heCompleteness(currentPeriodStr());
  root.innerHTML = `
  <div class="coa-top">
    <section class="card coa-drop-card">
      <div class="coa-drop" id="coaDrop" tabindex="0" role="button" aria-label="Pilih atau tarik file PDF CoA/SHU">
        <div class="coa-drop-ic" aria-hidden="true"><svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M12 18v-6"/><path d="m9 15 3-3 3 3"/></svg></div>
        <div><b>Tarik PDF CoA / SHU ke sini, atau klik untuk memilih</b><div class="muted">Bisa banyak file sekaligus. PDF digital dibaca langsung; PDF hasil scan / foto (JPG, PNG) dibaca dengan OCR di browser — tanpa API key, data tidak dikirim ke server mana pun.</div></div>
        <input type="file" id="coaFileInput" accept=".pdf,application/pdf,image/*" multiple hidden>
      </div>
      <div class="coa-opts">
        <div class="coa-opt"><span class="coa-opt-lbl">Nilai emisi yang dipakai</span><div class="hd-seg-group" role="group">
          <button type="button" class="${coaState.useValue==="corrected"?"on":""}" data-action="coaSetUse" data-val="corrected" aria-pressed="${coaState.useValue==="corrected"}">Terkoreksi O₂</button>
          <button type="button" class="${coaState.useValue==="measured"?"on":""}" data-action="coaSetUse" data-val="measured" aria-pressed="${coaState.useValue==="measured"}">Terukur</button></div></div>
        <label class="coa-chk"><input type="checkbox" id="coaForceOcr" ${coaState.forceOcr?"checked":""}> Paksa OCR (kalau teks PDF berantakan)</label>
        <label class="coa-chk"><input type="checkbox" id="coaReplace" ${coaState.replace?"checked":""}> Ganti data lama (cerobong + periode + parameter sama)</label>
        <button type="button" class="btn small ghost" data-action="importHasilXlsx" title="Excel juga masuk ke review ini dulu">Import dari Excel…</button>
        <button type="button" class="btn small ghost" data-action="downloadTemplateHasilXlsx">Template Excel</button>
      </div>
      ${coaState.files.length ? `<ul class="coa-files">${coaState.files.map(f=>`<li class="st-${f.status}"><span class="coa-fdot"></span><b>${escHtml(f.name)}</b><span class="muted">${escHtml(f.msg||"")}</span>${f.method?`<span class="coa-ftag">${f.method==="ocr"?"OCR":f.method==="excel"?"Excel":f.method==="mixed"?"Teks + OCR":"Teks PDF"}</span>`:""}</li>`).join("")}</ul>` : ""}
    </section>
    <aside class="card coa-side">
      <div class="hec-eyebrow">Kelengkapan ${escHtml(comp.periode)}</div>
      <div class="coa-side-kpis"><div><b>${comp.lengkap}</b><span>lengkap</span></div><div class="warn"><b>${comp.sebagian}</b><span>sebagian</span></div><div class="bad"><b>${comp.kosong}</b><span>belum ada</span></div></div>
      <div class="hec-bar"><i style="width:${comp.reqTotal?Math.round(comp.reqHave/comp.reqTotal*100):0}%"></i></div>
      <div class="muted coa-side-note">${comp.reqHave}/${comp.reqTotal} parameter wajib dari ${comp.total} titik target sudah masuk. <a href="#" data-action="goToPage" data-page="hasildb">Lihat rinciannya</a></div>
    </aside>
  </div>
  ${samples.length ? `
  <div class="coa-bar card">
    <div class="coa-bar-stats"><b>${samples.length}</b> sampel &middot; <b>${rowsIncl}</b> baris akan diimport &middot; <span class="${issues?"coa-bad":"coa-good"}"><b>${issues}</b> perlu dicek</span>${pending?` &middot; <span class="muted">${pending} file masih diproses…</span>`:""}</div>
    <label class="coa-chk"><input type="checkbox" id="coaOnlyIssues" ${coaState.onlyIssues?"checked":""}> Tampilkan yang perlu dicek saja</label>
    <span class="spacer"></span>
    <button type="button" class="btn small ghost" data-action="coaClear">Kosongkan</button>
    <button type="button" class="btn small" data-action="coaDownloadXlsx">Unduh Excel</button>
    <button type="button" class="btn small primary" data-action="coaImport" ${coaState.busy||!rowsIncl?"disabled":""}>Import ke Database (${rowsIncl})</button>
  </div>
  <div class="coa-samples">${samples.map(coaSampleHtml).join("")}</div>` : `<div class="card coa-empty"><b>Belum ada dokumen.</b> Unggah PDF CoA/SHU (turbin, gas engine, diesel, flare/heater opasitas, H2S fuel gas) — tools mengenali nama sumber emisi, menyusun parameter wajib + pendukung sesuai regulasi titik, dan mengisi baku mutu &amp; running hour otomatis.</div>`}
  ${coaState.showDoc ? coaDocViewerHtml() : ""}`;
}
function coaPointOptions(s){
  const pts = DB.points.filter(p=>p.kategori==="emisi").sort((a,b)=>a.site.localeCompare(b.site)||a.nama.localeCompare(b.nama));
  const cand = (s.candidates||[]).filter(c=>c.s>=0.35).map(c=>pts.find(p=>p.id===c.id)).filter(Boolean);
  const bySite = {}; pts.forEach(p=>(bySite[p.site]=bySite[p.site]||[]).push(p));
  return `<option value="">— pilih titik —</option>${cand.length?`<optgroup label="Paling mirip dgn &quot;${escHtml(s.nameRead||"")}&quot;">${cand.map(p=>`<option value="${p.id}" ${p.id===s.pointId?"selected":""}>${escHtml(p.nama)} · ${escHtml(p.site)}</option>`).join("")}</optgroup>`:""}${Object.keys(bySite).map(site=>`<optgroup label="${escHtml(site)}">${bySite[site].map(p=>`<option value="${p.id}" ${p.id===s.pointId && !cand.includes(p)?"selected":""}>${escHtml(p.nama)}</option>`).join("")}</optgroup>`).join("")}`;
}
function coaFlagHtml(f){ return `<span class="coa-flag ${f.lv}">${escHtml(f.t)}</span>`; }
function coaSampleHtml(s){
  const p = coaPoint(s), periode = coaPeriode(s), sflags = coaSampleFlags(s);
  const issues = coaIssueCount(s);
  if(coaState.onlyIssues && !issues) return "";
  const req = p ? heRequiredParams(p) : [], sup = p ? heSupportParams(p) : [];
  const have = new Set(s.rows.filter(r=>r.include && String(coaRowValue(r)||"").trim()).map(r=>r.param));
  const chip = (x)=>`<span class="hec-chip ${have.has(x)?"ok":"miss"}">${have.has(x)?"&#10003;":"&#10007;"} ${escHtml(x)}</span>`;
  const rh = p ? heRunningHour(p, periode) : null;
  const rows = s.rows.map(r=>{
    const d = coaDerive(s, r);
    if(coaState.onlyIssues && !d.flags.some(f=>f.lv!=="info") && r.include) return "";
    const badge = COA_STATUS_BADGE[d.status] || COA_STATUS_BADGE.not_evaluated;
    const kind = (HE_PARAMS[r.param]||{}).kind || "";
    const err = d.flags.some(f=>f.lv==="err"), warn = d.flags.some(f=>f.lv==="warn");
    return `<tr class="${r.include?"":"off"} ${err?"has-err":warn?"has-warn":""}" data-sid="${s.id}" data-rid="${r.id}">
      <td class="c"><input type="checkbox" class="coa-in" data-f="include" ${r.include?"checked":""} aria-label="Ikut diimport"></td>
      <td>${r.manual ? `<select class="coa-in" data-f="param" aria-label="Parameter">${Object.keys(HE_PARAMS).map(k=>`<option ${k===r.param?"selected":""}>${escHtml(k)}</option>`).join("")}</select>` : `<b>${escHtml(r.param)}</b>`}<div class="coa-kind k-${kind}">${kind==="main"?"wajib/BM":kind==="field"?"pendukung":kind==="extra"?"data lapangan":""}${!r.found?" · tidak ditemukan":""}</div></td>
      <td><input type="text" class="coa-in coa-val" data-f="value" value="${escHtml(d.val)}" placeholder="isi hasil" aria-label="Hasil ${escHtml(r.param)}"></td>
      <td><input type="text" class="coa-in coa-unit" data-f="unit" value="${escHtml(r.unit)}" aria-label="Satuan"></td>
      <td class="muted mono">${s.fmt==="emisi3" && kind==="main" ? `${escHtml(r.measured||"–")} / ${escHtml(r.corrected||"–")}` : escHtml(r.single||"–")}</td>
      <td class="muted mono">${escHtml(r.bmCoa||"–")}</td>
      <td><input type="text" class="coa-in coa-bm" data-f="standard" value="${d.standard!=null?d.standard:""}" placeholder="—" title="${escHtml(d.bm.src)}" aria-label="Baku mutu"></td>
      <td class="mono">${d.pct!=null?d.pct+"%":"–"}</td>
      <td><span class="badge ${badge[0]}">${badge[1]}</span></td>
      <td><input type="text" class="coa-in coa-met" data-f="metode" value="${escHtml(r.metode)}" aria-label="Metode"></td>
      <td class="coa-flagcell"><div class="coa-flags">${d.flags.map(coaFlagHtml).join("")}</div></td>
    </tr>`;
  }).join("");
  return `<article class="card coa-sample ${issues?"has-issue":""}" data-sid="${s.id}">
    <header class="coa-sh">
      <div class="coa-sh-src"><span class="coa-src-tag ${s.source}">${s.source==="excel"?"Excel":s.method==="ocr"?`OCR ${s.conf}%`:"Teks PDF"}</span><span class="muted">${escHtml(s.fileName||"")}${s.page?` · hal. ${s.page}`:""}${s.angle?` · diluruskan ${s.angle}°`:""}</span>
        ${s.thumb?`<button type="button" class="btn small ghost" data-action="coaShowDoc" data-sid="${s.id}">Lihat dokumen</button>`:""}
        <button type="button" class="btn small ghost danger" data-action="coaRemoveSample" data-sid="${s.id}" aria-label="Hapus sampel ini dari review">Buang</button></div>
      <div class="coa-sh-grid" data-sid="${s.id}">
        <div class="field"><label>Titik / cerobong ${s.nameRead && s.source!=="excel"?`<span class="muted">(terbaca: "${escHtml(s.nameRead)}")</span>`:""}</label><select class="coa-sel" data-f="pointId">${coaPointOptions(s)}</select></div>
        <div class="field"><label>Tanggal sampling</label><input type="date" class="coa-sin" data-f="dateOfSampling" value="${escHtml(s.dateOfSampling||"")}"></div>
        <div class="field"><label>Periode</label><input type="text" class="coa-sin" data-f="periodeManual" value="${escHtml(periode)}" placeholder="S2 2026"></div>
        <div class="coa-meta">${p ? `<div><span>Site</span><b>${escHtml(p.site)}</b></div><div><span>Jenis</span><b>${escHtml(p.kategoriSumber||"-")}</b></div><div><span>Kapasitas</span><b>${escHtml(p.kategoriKapasitas||"-")}</b>${s.capacity?`<em>CoA: ${escHtml(s.capacity)} kW</em>`:""}</div><div><span>Bahan bakar</span><b>${escHtml(p.jenisBahanBakar||"-")}</b>${s.fuel?`<em>CoA: ${escHtml(s.fuel)}</em>`:""}</div><div><span>Regulasi</span><b>${escHtml(heRegulasi(p))}</b></div><div><span>RH 12 bln</span><b>${rh!=null?rh.toLocaleString("id-ID"):"–"}</b></div>` : `<div class="muted">Pilih titik untuk mengisi site, jenis sumber, regulasi, baku mutu &amp; running hour otomatis.</div>`}</div>
      </div>
      ${p ? `<div class="coa-req"><span class="muted">Parameter wajib:</span> ${req.map(chip).join("")} ${sup.length?`<span class="muted coa-req-sep">Pendukung:</span> ${sup.map(chip).join("")}`:""}</div>` : ""}
      ${sflags.length ? `<div class="coa-sflags">${sflags.map(coaFlagHtml).join("")}</div>` : ""}
    </header>
    <div class="coa-tablewrap"><table class="coa-table"><thead><tr><th class="c" title="Ikut diimport">&#10003;</th><th>Parameter</th><th>Hasil dipakai</th><th>Satuan</th><th>${s.fmt==="emisi3"?"Terukur / Terkoreksi":"Terbaca"}</th><th>BM di dokumen</th><th>Baku mutu</th><th>% BM</th><th>Status</th><th>Metode</th><th>Catatan review</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="coa-sfoot"><button type="button" class="btn small ghost" data-action="coaAddRow" data-sid="${s.id}">+ Tambah parameter</button>${s.text?`<details class="coa-raw"><summary>Teks hasil baca</summary><pre>${escHtml(s.text)}</pre></details>`:""}</div>
  </article>`;
}
function coaDocViewerHtml(){
  const s = coaState.samples.find(x=>x.id===coaState.showDoc); if(!s) return "";
  return `<div class="coa-doc" role="dialog" aria-label="Pratinjau dokumen"><div class="coa-doc-head"><b>${escHtml(s.fileName)}${s.page?` · hal. ${s.page}`:""}</b><span class="muted">Bandingkan dengan tabel review. Klik gambar untuk memperbesar / memperkecil.</span><button type="button" class="btn small" data-action="coaShowDoc" data-sid="">Tutup</button></div><div class="coa-doc-body"><img class="coa-doc-img" data-action="coaZoomDoc" src="${s.thumb}" alt="Halaman dokumen ${escHtml(s.fileName)}"></div></div>`;
}

/* ---------- Proses file ---------- */
async function coaHandleFiles(fileList){
  const files = [...fileList].filter(f=>/pdf$/i.test(f.type) || /\.pdf$/i.test(f.name) || /^image\//.test(f.type));
  if(!files.length){ toast("Pilih file PDF atau gambar (JPG/PNG).","err"); return; }
  const entries = files.map(f=>({id:coaNewId("f"), name:f.name, status:"queued", msg:"menunggu…", file:f}));
  coaState.files.push(...entries); coaState.busy = true; coaMedCache.clear(); renderCoaReader();
  for(const e of entries){
    e.status = "reading"; e.msg = "membaca…"; renderCoaReader();
    const onStatus = (m)=>{ e.msg = m.replace(e.name+": ",""); const li = document.querySelector(`.coa-files li.st-reading .muted`); if(li) li.textContent = e.msg; };
    try{
      const pages = /^image\//.test(e.file.type) ? await coaReadImage(e.file, onStatus) : await coaReadPdf(e.file, {forceOcr:coaState.forceOcr}, onStatus);
      const methods = new Set(pages.map(p=>p.method)); e.method = methods.size>1 ? "mixed" : [...methods][0];
      const raw = coaParsePages(pages, e.name).filter(s=>s.rows.length || s.name);
      const samples = raw.map(coaSampleFromParsed);
      coaState.samples.push(...samples);
      e.status = "done"; e.msg = samples.length ? `${samples.length} sampel · ${samples.reduce((a,s)=>a+s.rows.filter(r=>r.found).length,0)} parameter terbaca` : "tidak ada data hasil yang dikenali";
      if(!samples.length) e.status = "error";
    }catch(err){ console.error(err); e.status = "error"; e.msg = err.message || String(err); }
    delete e.file; renderCoaReader();
  }
  coaState.busy = false; renderCoaReader();
}

/* ---------- Edit di tabel review ---------- */
document.addEventListener("change", e=>{
  const t = e.target;
  if(t.id==="coaFileInput"){ coaHandleFiles(t.files); t.value = ""; return; }
  if(t.id==="coaForceOcr"){ coaState.forceOcr = t.checked; return; }
  if(t.id==="coaReplace"){ coaState.replace = t.checked; renderCoaReader(); return; }
  if(t.id==="coaOnlyIssues"){ coaState.onlyIssues = t.checked; renderCoaReader(); return; }
  if(t.classList.contains("coa-sel") || t.classList.contains("coa-sin")){
    const s = coaState.samples.find(x=>x.id===t.closest("[data-sid]").dataset.sid); if(!s) return;
    const f = t.dataset.f;
    if(f==="pointId"){ s.pointId = t.value; s.matchScore = 1; s.rows = s.rows.filter(r=>r.found || r.edited); coaSyncRequiredRows(s); }
    else if(f==="dateOfSampling"){ s.dateOfSampling = t.value; s.periodeManual = ""; }
    else if(f==="periodeManual"){ const v = t.value.trim().toUpperCase().replace(/^S\s*(\d)\s*/, "S$1 "); s.periodeManual = v===hePeriodeOfDate(s.dateOfSampling) ? "" : v; }
    renderCoaReader(); return;
  }
  if(t.classList.contains("coa-in")){
    const tr = t.closest("tr[data-rid]"); const s = coaState.samples.find(x=>x.id===tr.dataset.sid); if(!s) return;
    const r = s.rows.find(x=>x.id===tr.dataset.rid); if(!r) return;
    const f = t.dataset.f;
    if(f==="include") r.include = t.checked;
    else if(f==="value"){ r.edited = true; r.value = t.value.trim(); if(r.value && !r.found){ r.found = true; r.include = true; } }
    else if(f==="unit") r.unit = t.value.trim();
    else if(f==="standard") r.standardOverride = t.value.trim()==="" ? null : t.value.trim();
    else if(f==="metode") r.metode = t.value.trim();
    else if(f==="param"){ r.param = heCanonParam(t.value); r.unit = r.unit || (HE_PARAMS[r.param]||{}).unit || ""; }
    renderCoaReader();
  }
});
document.addEventListener("click", e=>{
  const d = e.target.closest("#coaDrop"); if(d && !e.target.closest("input")) document.getElementById("coaFileInput").click();
});
document.addEventListener("keydown", e=>{ if(e.target && e.target.id==="coaDrop" && (e.key==="Enter"||e.key===" ")){ e.preventDefault(); document.getElementById("coaFileInput").click(); } });
["dragover","dragenter"].forEach(ev=>document.addEventListener(ev, e=>{ const d = e.target.closest && e.target.closest("#coaDrop"); if(d){ e.preventDefault(); d.classList.add("over"); } }));
["dragleave","drop"].forEach(ev=>document.addEventListener(ev, e=>{ const d = e.target.closest && e.target.closest("#coaDrop"); if(d){ d.classList.remove("over"); if(ev==="drop"){ e.preventDefault(); coaHandleFiles(e.dataTransfer.files); } } }));

/* ---------- Unduh Excel / Import ---------- */
function coaRecordFor(s, r){
  const d = coaDerive(s, r), p = d.p;
  const id = p ? heIdentity(p) : {cerobong:s.nameRead, site:(r.xls&&r.xls.site)||"", namaSumber:(r.xls&&r.xls.namaSumber)||"", kategoriKapasitas:(r.xls&&r.xls.kategoriKapasitas)||"", jenisBahanBakar:(r.xls&&r.xls.jenisBahanBakar)||""};
  const x = r.xls || {};
  const rh = p ? heRunningHour(p, d.periode) : null;
  const metode = r.metode || (p ? ((DB.hasilPemantauan.filter(h=>(h.engineId===p.id||h.cerobong===id.cerobong) && h.parameter===r.param && h.metode).sort((a,b)=>b.periodeOrder-a.periodeOrder)[0])||{}).metode || "" : "");
  return heMakeRecord({engineId: p ? p.id : null, ...id, periode:d.periode, parameter:r.param, unit: r.unit || (HE_PARAMS[r.param]||{}).unit || "",
    resultRaw:d.val, dateOfSampling:s.dateOfSampling, runningHour: rh!=null ? rh : (x.rh!=="" && x.rh!=null ? x.rh : null),
    standard:d.standard, regulasiCek: p ? heRegulasi(p) : (x.regulasi||""), metode,
    keterangan: x.keterangan || (p ? heFrekuensiText(p) : ""), remarks: x.remarks || (p ? heRemarksText(p, r.param) : ""),
    sumberDokumen: s.source==="excel" ? "" : [s.fileName, s.page?`hal. ${s.page}`:"", s.lab, s.ref].filter(Boolean).join(" · ")});
}
function coaDownloadXlsx(){
  const STATUS_TXT = {ok:"OK", exceed:"Melebihi Baku Mutu", not_applicable:"N/A", not_evaluated:""};
  const rows = [];
  coaState.samples.forEach(s=>s.rows.filter(r=>r.include).forEach(r=>{
    const rec = coaRecordFor(s, r), d = coaDerive(s, r);
    const o = hasilRowForExport(rec);
    o["CEK BAKU MUTU VS RESULT"] = STATUS_TXT[rec.statusBakuMutu]||"";
    o["SUMBER DOKUMEN"] = rec.sumberDokumen || (s.source==="excel"?"Excel":"");
    o["TERUKUR / TERKOREKSI"] = s.fmt==="emisi3" && (HE_PARAMS[r.param]||{}).kind==="main" ? `${r.measured||"-"} / ${r.corrected||"-"}` : (r.single||"");
    o["BM DI DOKUMEN"] = r.bmCoa||"";
    o["CATATAN REVIEW"] = coaSampleFlags(s).concat(d.flags).filter(f=>f.lv!=="info").map(f=>f.t).join("; ");
    if(o["CATATAN REVIEW"]) o.__styles = {"RESULT":{fill:"FEF3C7"}, "CATATAN REVIEW":{color:"B42318"}};
    rows.push(o);
  }));
  if(!rows.length){ toast("Belum ada baris yang dicentang untuk diunduh.","err"); return; }
  const blob = heXlsxBlob([heMainSheet(rows, [{h:"SUMBER DOKUMEN", w:30},{h:"TERUKUR / TERKOREKSI", w:18},{h:"BM DI DOKUMEN", w:12},{h:"CATATAN REVIEW", w:50}]), heGuideSheet(), heRefSheet()]);
  downloadBlob(blob, `review_hasil_emisi_${todayStr()}.xlsx`, blob.type);
  toast("Excel review diunduh — file ini bisa diedit lalu diimport lagi lewat Import Excel.","ok");
}
function coaImport(){
  const todo = [];
  coaState.samples.forEach(s=>s.rows.filter(r=>r.include).forEach(r=>{ const d = coaDerive(s, r); todo.push({s, r, d}); }));
  const blockers = todo.filter(x=>!x.d.p && !(x.s.source==="excel" && x.s.nameRead) || !x.d.periode || !x.d.val || x.d.res.status==="not_sampled" || /\^\?/.test(x.d.val));
  const ready = todo.filter(x=>!blockers.includes(x));
  if(!ready.length){ toast("Belum ada baris yang siap diimport — lengkapi titik, tanggal, dan hasil dulu.","err"); return; }
  let replaced = 0;
  ready.forEach(x=>{ const rec = coaRecordFor(x.s, x.r); if(DB.hasilPemantauan.some(h=>(h.engineId && h.engineId===rec.engineId || h.cerobong===rec.cerobong) && h.periode===rec.periode && heCanonParam(h.parameter)===rec.parameter)) replaced++; });
  const msg = `Import ${ready.length} baris ke Database Hasil Emisi?` + (replaced ? ` ${replaced} baris sudah ada (cerobong + periode + parameter sama) dan akan ${coaState.replace?"DIGANTI":"DILEWATI"}.` : "") + (blockers.length ? ` ${blockers.length} baris belum lengkap (titik/tanggal/hasil kosong) tidak ikut diimport.` : "");
  askConfirm(msg, ()=>{
    let add = 0, rep = 0, skip = 0;
    const doneRows = new Set();
    ready.forEach(x=>{
      const rec = coaRecordFor(x.s, x.r);
      const ex = DB.hasilPemantauan.find(h=>(h.engineId && h.engineId===rec.engineId || h.cerobong===rec.cerobong) && h.periode===rec.periode && heCanonParam(h.parameter)===rec.parameter);
      if(ex){ if(coaState.replace){ Object.assign(ex, rec, {id:ex.id}); rep++; } else { skip++; return; } }
      else { DB.hasilPemantauan.push({id:"HPI_"+uid("x"), ...rec}); add++; }
      doneRows.add(x.r.id);
    });
    touchDataset("hasilPemantauan"); save(); coaMedCache.clear();
    logChange && logChange(`Import hasil emisi: ${add} baru, ${rep} diganti${skip?`, ${skip} dilewati`:""} (review CoA/Excel)`);
    coaState.samples.forEach(s=>{ s.rows = s.rows.filter(r=>!doneRows.has(r.id)); });
    coaState.samples = coaState.samples.filter(s=>s.rows.some(r=>r.include && (r.found || r.edited)));
    renderCoaReader();
    toast(`Import selesai: ${add} baris baru, ${rep} diganti${skip?`, ${skip} dilewati`:""}.${coaState.samples.length?" Baris yang belum lengkap tetap di review.":""}`, "ok");
  });
}

Object.assign(ACTIONS, {
  coaSetUse:(t)=>{ coaState.useValue = t.dataset.val; renderCoaReader(); },
  coaClear:()=>askConfirm("Kosongkan semua dokumen & baris di review (belum diimport)?", ()=>{ coaState.samples = []; coaState.files = []; coaState.showDoc = null; renderCoaReader(); }),
  coaRemoveSample:(t)=>{ coaState.samples = coaState.samples.filter(s=>s.id!==t.dataset.sid); renderCoaReader(); },
  coaShowDoc:(t)=>{ coaState.showDoc = t.dataset.sid || null; renderCoaReader(); },
  coaZoomDoc:(t)=>{ t.classList.toggle("zoom"); },
  coaAddRow:(t)=>{
    const s = coaState.samples.find(x=>x.id===t.dataset.sid); if(!s) return;
    const used = new Set(s.rows.map(r=>r.param)); const param = Object.keys(HE_PARAMS).find(k=>!used.has(k)) || "NOx";
    s.rows.push({id:coaNewId("r"), param, unit:(HE_PARAMS[param]||{}).unit||"", found:false, include:true, metode:"", measured:null, corrected:null, single:null, bmCoa:null, valuesRead:"", edited:false, value:"", standardOverride:null, manual:true});
    renderCoaReader();
  },
  coaDownloadXlsx, coaImport
});
