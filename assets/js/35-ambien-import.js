/* =========================================================
   IMPORT HASIL AMBIENT (Udara Ambien, Kebisingan, Kebauan, Getaran) — pasangan 33/34 utk emisi.
   Dokumen CoA/SHU dikenali jenisnya dari isinya, titik dicocokkan ke Database Titik Pantau kategori
   yg sesuai, baku mutu diisi dari regulasi (PP 22/2021 Lamp. VII, KepMenLH 48/49/50 1996), lalu
   direview di halaman Import yang sama dgn emisi sebelum masuk DB.hasilAmbien.
========================================================= */
const AMB_KINDS = ["ambien","kebisingan","kebauan","getaran"];
const AMB_KIND_LABEL = {ambien:"Udara Ambien", kebisingan:"Kebisingan", kebauan:"Kebauan", getaran:"Getaran"};
const AMB_REGULASI = {ambien:"PP 22/2021 Lampiran VII", kebisingan:"KepMenLH 48/1996", kebauan:"KepMenLH 50/1996", getaran:"KepMenLH 49/1996"};
// Parameter (label = ejaan yg sudah dipakai di Database Hasil Ambient). re = cara mengenali di CoA (Inggris)
// maupun di kolom parameter Database Titik Pantau (Indonesia).
const AMB_SPECS = {
  ambien: [
    {kode:"SO2",   label:"Sulfur Dioxide (SO2)", durasi:"1 Hour", baku:150, re:/sul(?:f|ph)ur\s*d\w*(?:xide|ksida)|\bs[o0]\s*[2₂]\b/i},
    {kode:"CO",    label:"Carbon Monoxide (CO)", durasi:"1 Hour", baku:10000, re:/(?:carbon|karbon)\s*(?:n?m[o0]n|nm|m)\w*(?:xide|ksida)/i},
    {kode:"NOx",   label:"Nitrogen Dioxide (NOx)", durasi:"1 Hour", baku:200, re:/n?itrogen\s*d\w*(?:xide|ksida)|n?itrogen\s*o\w*ide|\bn[o0]\s*[2₂x]\b/i},
    {kode:"O3",    label:"Oxidant (O3)", durasi:"1 Hour", baku:150, re:/oxidant|oksidan|\bozon/i},
    {kode:"NMHC",  label:"Non Methane Hydrocarbon (NMHC)", durasi:"3 Hour", baku:160, re:/non\s*-?\s*methane|nmhc|hidrokarbon/i},
    {kode:"TSP",   label:"TSP (Dust)", durasi:"24 Hour", baku:230, re:/\bdust\b|\btsp\b|total\s*suspended|\bdebu\b/i},
    // OCR sering membaca subskrip PM₁₀ / PM₂.₅ sbg "PM;q" / "PM; 5"
    {kode:"PM2.5", label:"PM2.5", durasi:"24 Hour", baku:55, re:/\bpm\s*(?:2\s*[.,]?\s*5|[;:,.]\s*5)\b/i},
    {kode:"PM10",  label:"PM10", durasi:"24 Hour", baku:75, re:/\bpm\s*[1l]\s*[0o]\b|\bpm\s*[;:,.]\s*(?:[1l][0oq]|[oq])\b|\bpmio\b/i},
    {kode:"Pb",    label:"Lead (Pb)", durasi:"24 Hour", baku:2, re:/\blead\b|timbal|\(\s*pb\s*\)/i}
  ],
  kebauan: [
    {kode:"NH3", label:"Ammonia (NH3)", baku:2, re:/ammonia|amonia|\bnh\s*[3₃]\b/i},
    {kode:"Methyl Mercaptan", label:"Methyl Mercaptant", baku:0.002, re:/mercapt|merkapt/i},
    {kode:"Methyl Sulfide", label:"Methyl Sulfide", baku:0.01, re:/(?:methyl|metil)\s*sul/i},
    {kode:"H2S", label:"Hydrogen Sulfide (H2S)", baku:0.02, re:/(?:hydrogen|hidrogen)\s*sul|\bh\s*[2₂]\s*s\b/i},
    {kode:"Styrene", label:"Styrene", baku:0.1, re:/styren|stiren/i}
  ]
};
const AMB_UNIT = {ambien:"µg/Nm³", kebauan:"ppm", kebisingan:"dB(A)", getaran:"micron"};
function ambSpec(kind, kode){ return (AMB_SPECS[kind]||[]).find(x=>x.kode===kode) || null; }
function ambCanon(kind, text){ const t = String(text||""); const sp = (AMB_SPECS[kind]||[]).find(x=>x.re.test(t) || x.kode===t || x.label===t); return sp ? sp.kode : ""; }
function ambPointKategori(kind){ return AMB_CAT_POINTS_KATEGORI[kind] || kind; }
// Parameter wajib titik ambien/kebauan dari kolom "parameter" Database Titik Pantau.
function ambRequired(p, kind){
  if(kind==="kebisingan") return ["LSM (24 jam)"];
  if(kind==="getaran") return ["13 pita frekuensi"];
  const list = String(p && p.parameter || "").split(/,\s*/).map(x=>ambCanon(kind, x)).filter(Boolean);
  return list.length ? [...new Set(list)] : (AMB_SPECS[kind]||[]).map(x=>x.kode);
}
// Baku mutu kebisingan per titik = baku terakhir di riwayat titik itu (kawasan permukiman 55 / industri 70,
// KepMenLH 48/1996), default 70.
function ambNoiseBaku(p){
  const last = p ? (DB.hasilAmbien.kebisingan||[]).filter(r=>r.titikId===p.id && r.baku!=null).sort((a,b)=>b.periodeOrder-a.periodeOrder)[0] : null;
  return last ? {value:last.baku, src:`Riwayat ${last.periode} (KepMenLH 48/1996)`} : {value:70, src:"KepMenLH 48/1996 — kawasan industri 70 dB(A)"};
}
// Leq siang (L1–L16, 06–22), malam (L17–L24, 22–06), siang-malam (malam +5 dB) — KepMenLH 48/1996.
function ambNoiseCalc(vals){
  const n = vals.map(v=>parseFloat(String(v||"").replace(",",".")));
  if(n.length<24 || n.some(x=>isNaN(x))) return null;
  const e = a=>10*Math.log10(a.reduce((s,x)=>s+Math.pow(10,0.1*x),0)/a.length);
  const ls = e(n.slice(0,16)), lm = e(n.slice(16)), lsm = 10*Math.log10((16*Math.pow(10,0.1*ls) + 8*Math.pow(10,0.1*(lm+5)))/24);
  const r = x=>Math.round(x*10)/10;
  return {ls:r(ls), lm:r(lm), lsm:r(lsm)};
}
function ambDetectKind(text){
  const t = String(text||"");
  if(/vibration|getaran|micron|not\s*disturb|uncomfortable/i.test(t)) return "getaran";
  if(/d\s*b\s*\(?\s*a\s*\)|l\s*day\s*night|kebisingan|\bnoise\b|\bL\s*1\s*\(\s*0?6/i.test(t)) return "kebisingan";
  if(/ammonia|amonia|styren|mercapt|merkapt|methyl\s*sul|metil\s*sul|\bodou?r|kebauan/i.test(t)) return "kebauan";
  if(/ambient|ambien|\bpm\s*[1l]\s*[0o]\b|\bpm\s*2\s*[.,]?\s*5|\bnmhc\b|oxidant|\btsp\b/i.test(t)) return "ambien";
  return "emisi";
}

/* ---------- Parser baris CoA ambien ---------- */
const AMB_UNIT_RE = /[µμu]\s*g\s*\/\s*n?\s*m\s*\^?\s*[3³]?|\bpg\s*\/\s*n?m\S?|\bppm\b|\bmg\s*\/\s*n?m\S?/i;
const AMB_METHOD_START = /(sn[il1]\s*\d|p[o0]\s*\/|masa\b|niosh|astm|us\s*epa|\biso\s*\d|spektro|gravim)/i;
const AMB_METHOD_RE = /(sn[il1]\s*[\d][\d\-.: ]*\d|p[o0]\s*\/\s*bpp[\w\-\/. ]*?\d+|\(\s*(?:elektro|electro)\w*\s*\)|masa\s*method\s*\d+|niosh\s*\d+(?:\s*-\s*\d{4})?|astm\s*[\w\-]+(?:\s*\(\d{4}\))?|iso\s*[\d][\d\-:. ]*\d)/ig;
function ambRowFromLine(line, kind){
  if(/^\W*(tested\s*for|subject|parameter\b.*\b(unit|period)|note\b|catatan|\*\)|<\s*=)/i.test(line)) return null;
  for(const sp of AMB_SPECS[kind]){
    const m = line.match(sp.re); if(!m) continue;
    let rest = line.slice(m.index + m[0].length);
    let durasi = "";
    const dm = rest.match(/(\d{1,2})\s*(?:h[o0]urs?|jam)\b/i);
    if(dm){ durasi = `${dm[1]} Hour`; rest = rest.slice(0, dm.index) + " " + rest.slice(dm.index + dm[0].length); }
    rest = rest.replace(/\(\s*[a-z]{1,3}\s*[\dx₂₃,;.]*\s*\)/ig," ").replace(/\bas\b/ig," ").replace(/[#*]/g," ");
    const um = rest.match(AMB_UNIT_RE);
    let vals = um ? rest.slice(um.index + um[0].length) : rest.replace(/\b(s[o0]|n[o0]|[o0]|nh|h)\s*[2₃3x]\b/ig," ");
    if(!um && sp.kode==="PM10") vals = vals.replace(/^\s*[1l][0o]\b/," ");
    const ms = vals.search(AMB_METHOD_START);
    const valText = ms>=0 ? vals.slice(0, ms) : vals;
    const values = coaValues(valText);
    // pangkat ³ satuan µg/m³ yg terpisah dari satuannya (sel bertingkat) ikut terbaca sbg angka
    if(!um && values.length>=3 && /^[23]$/.test(values[0])) values.shift();
    const methods = (line.match(AMB_METHOD_RE)||[]).map(x=>x.trim());
    return {kode:sp.kode, durasi, values, methods};
  }
  return null;
}
// Kebisingan: satu baris bisa memuat 2 kolom tabel ("L1 (06.00) dB(A) 53.3   L13 (18.00) dB(A) 52.6")
function ambNoiseFromLine(line, out){
  const re = /L\s*([12]?\d)\s*\(\s*\d{1,2}\s*[.:,]\s*\d{2}\s*\)\s*(?:d\s*b\s*\(?\s*a?\s*\)?)?\s*([\d]+[.,]\d)/gi; let m;
  while((m = re.exec(line))){ const i = Number(m[1]); if(i>=1 && i<=24 && out.vals[i-1]==null) out.vals[i-1] = m[2].replace(",","."); }
  const after = (s)=>{ const v = coaValues(s.replace(/\b\d{1,2}[.:,]?00\b/g," ").replace(/d\s*b\s*\(?\s*a?\s*\)?/i," ").replace(/sn[il1]\s*[\d][\d\-.: ]*\d/i," ")); return v; };
  let mm;
  if((mm = line.match(/L\s*(?:day|siang)\s*[-–]?\s*(?:night|malam)(.*)$/i))){ const v = after(mm[1]); if(v[0] && out.lsm==null) out.lsm = v[0]; if(v[1] && out.bmDoc==null) out.bmDoc = v[1]; }
  else if((mm = line.match(/L\s*(?:night|malam)\b(.*)$/i))){ const v = after(mm[1]); if(v[0] && out.lm==null) out.lm = v[0]; }
  else if((mm = line.match(/L\s*(?:day|siang)\b(.*)$/i))){ const v = after(mm[1]); if(v[0] && out.ls==null) out.ls = v[0]; }
  const mt = line.match(/sn[il1]\s*8427[\-: ]*\d{4}/i); if(mt && !out.metode) out.metode = mt[0].replace(/^sn[il1]/i,"SNI");
}
// Getaran: "4 micron 9.6841 < 100 100 – 500 ..." (frekuensi, satuan, hasil, ambang)
function ambVibFromLine(line, out){
  const m = line.match(/^\W*(\d{1,3}(?:[.,]\d)?)\s+(?:micron|mikron|[µμu]\s*m\b|\S{0,7})\s*([\d]+[.,]\d+)/i);
  if(!m) return;
  let f = Number(m[1].replace(",","."));
  if(!GETARAN_FREQ_BANDS.includes(f) && GETARAN_FREQ_BANDS.includes(f/10)) f = f/10;   // "125" = 12.5 (koma hilang saat OCR)
  if(!GETARAN_FREQ_BANDS.includes(f) || out.vals[f]!=null) return;
  out.vals[f] = m[2].replace(",",".");
}
function ambCuacaFromLine(line, out){
  const m = line.match(/^\W*(temperat\w*|suhu|humidity|kelembab\w*|kelembap\w*|pressure|tekanan|wind\s*speed|kecepatan\s*angin|wind\s*direction|arah\s*angin|weather|cuaca)\b[^:;]*[:;]\s*(.+)$/i);
  if(!m) return;
  const k = m[1].toLowerCase();
  const key = /temper|suhu/.test(k) ? "suhu" : /humid|lembab|lembap/.test(k) ? "kelembapan" : /press|tekanan/.test(k) ? "tekanan" : /speed|kecepatan/.test(k) ? "kecepatanAngin" : /direction|arah/.test(k) ? "arahAngin" : "cuaca";
  if(out[key]) return;
  let v = m[2].replace(/[–—−]/g,"-").replace(/\s*(°\s*c|%|mmhg|m\s*\/\s*s)(?=\s|$)/ig,"").replace(/\s+/g," ").trim();
  v = v.split(/\s{3,}/)[0].replace(/\s*~\s*/g," - ").replace(/^[^\w]+|[|\[\]]+/g,"").trim();
  // desimal hilang saat OCR: suhu 240-315 -> 24.0-31.5, kelembapan 860 -> 86.0
  if(key==="suhu" || key==="kelembapan") v = v.replace(/\b(\d{3})\b/g, (x)=>Number(x) > (key==="suhu" ? 60 : 100) ? (Number(x)/10).toFixed(1) : x);
  out[key] = v;
}
// Satu halaman (beberapa varian pembacaan) -> sampel mentah ambien
function ambParsePage(Vs, kind, meta){
  const pk = ambPointKategori(kind);
  let name = "", bs = -1, date = "";
  Vs.forEach(L=>L.forEach(l=>{ const n = coaFindSampleName(l); if(n){ const sc = heMatchPoint(n, pk).score; if(sc > bs){ bs = sc; name = n; } } if(!date) date = coaFindSamplingDate(l); }));
  const raw = {...meta, kind, name, date: date || meta.docDate || "", rows:[], noise:null, vib:null, cuaca:{}, metode:""};
  if(kind==="ambien" || kind==="kebauan"){
    const byKode = new Map();
    Vs.forEach(L=>{ const seen = new Set(); L.forEach((l,i)=>{
      const r = ambRowFromLine(l, kind); if(!r || seen.has(r.kode)) return;
      // nilai/metode yg terbelah ke baris tetangga (sel bertingkat)
      if(r.values.length<2) [i+1, i-1].forEach(j=>{ if(j<0||j>=L.length||ambRowFromLine(L[j], kind)) return; const um = L[j].match(AMB_UNIT_RE); let t = um ? L[j].slice(um.index+um[0].length) : ""; const ms = t.search(AMB_METHOD_START); if(ms>=0) t = t.slice(0,ms); const v = coaValues(t); if(v.length > r.values.length) r.values = v; });
      if(L[i+1] && !ambRowFromLine(L[i+1], kind)) (L[i+1].match(AMB_METHOD_RE)||[]).forEach(x=>{ x = x.trim(); if(x.startsWith("(") && !r.methods.includes(x)) r.methods.push(x); });
      seen.add(r.kode); if(!byKode.has(r.kode)) byKode.set(r.kode, []); byKode.get(r.kode).push(r);
      if(kind==="ambien") ambCuacaFromLine(l, raw.cuaca);
    }); if(kind==="ambien") L.forEach(l=>ambCuacaFromLine(l, raw.cuaca)); });
    byKode.forEach((cands, kode)=>{
      const key = c=>c.values.slice(0,2).join("|");
      let best = cands[0], sc = -1;
      cands.forEach(c=>{ const s = cands.filter(o=>key(o)===key(c) && key(c)).length*4 + Math.min(c.values.length,2)*3 + c.values.slice(0,2).filter(v=>/\./.test(v)).length; if(s>sc){ sc = s; best = c; } });
      const methods = best.methods.length ? best.methods : (cands.find(c=>c.methods.length)||{methods:[]}).methods;
      raw.rows.push({kode, durasi: best.durasi || (cands.find(c=>c.durasi)||{}).durasi || "", values: best.values, methods});
    });
  } else if(kind==="kebisingan"){
    const out = {vals:Array(24).fill(null), ls:null, lm:null, lsm:null, bmDoc:null, metode:""};
    Vs.forEach(L=>L.forEach(l=>ambNoiseFromLine(l, out)));
    raw.noise = out;
  } else {
    const out = {vals:{}, metode:""};
    Vs.forEach(L=>L.forEach(l=>{ ambVibFromLine(l, out); const mt = l.match(/iso\s*2631[\-\d: ]*\d{4}/i); if(mt && !out.metode) out.metode = mt[0].toUpperCase().replace(/\s+/g," "); }));
    if(!out.metode && Vs.some(L=>L.some(l=>/49\s*\/\s*1996/.test(l)))) out.metode = "ISO 2631-2: 2003";
    raw.vib = out;
  }
  return raw;
}

/* ---------- Sampel review ---------- */
function ambSampleFromParsed(raw){
  const pk = ambPointKategori(raw.kind);
  const mt = heMatchPoint(raw.name, pk);
  const s = {id:coaNewId("s"), kind:raw.kind, source: raw.method==="ocr" ? "ocr" : "pdf", fileName:raw.fileName, page:raw.page, method:raw.method, conf:raw.conf, angle:raw.angle, thumb:raw.thumb, text:raw.text,
    nameRead:raw.name, pointId: mt.point ? mt.point.id : "", matchScore:mt.score, candidates:mt.candidates,
    dateOfSampling: raw.date||"", periodeManual:"", lab:raw.lab, ref:raw.ref, rows:[], cuaca:{suhu:"",kelembapan:"",tekanan:"",kecepatanAngin:"",arahAngin:"",cuaca:"", ...(raw.cuaca||{})}};
  if(raw.kind==="ambien" || raw.kind==="kebauan"){
    raw.rows.forEach(r=>{ const sp = ambSpec(raw.kind, r.kode); s.rows.push({id:coaNewId("r"), kode:r.kode, durasi: r.durasi || (sp&&sp.durasi) || "", unit:AMB_UNIT[raw.kind], value:r.values[0]||"", bmDoc:r.values[1]||null, valuesRead:r.values.join(" | "), metode:(r.methods||[]).join(" "), include:true, found:true, standardOverride:null}); });
    ambSyncRows(s);
  }
  if(raw.kind==="kebisingan"){ const n = raw.noise; s.noise = {vals:n.vals.map(v=>v==null?"":v), ls:n.ls||"", lm:n.lm||"", lsm:n.lsm||"", bmDoc:n.bmDoc||null, metode:n.metode||"SNI 8427-2017", standardOverride:null}; }
  if(raw.kind==="getaran"){ const vals = {}; GETARAN_FREQ_BANDS.forEach(f=>{ vals[f] = raw.vib.vals[f]!=null ? raw.vib.vals[f] : ""; }); s.vib = {vals, metode: raw.vib.metode || "ISO 2631-2: 2003"}; }
  return s;
}
function ambSyncRows(s){
  if(s.kind!=="ambien" && s.kind!=="kebauan") return;
  const p = coaPoint(s); if(!p || s.source==="excel") return;
  ambRequired(p, s.kind).forEach(k=>{ if(!s.rows.some(r=>r.kode===k)){ const sp = ambSpec(s.kind, k); s.rows.push({id:coaNewId("r"), kode:k, durasi:(sp&&sp.durasi)||"", unit:AMB_UNIT[s.kind], value:"", bmDoc:null, valuesRead:"", metode:"", include:true, found:false, standardOverride:null}); } });
  const order = (AMB_SPECS[s.kind]||[]).map(x=>x.kode);
  s.rows.sort((a,b)=>order.indexOf(a.kode)-order.indexOf(b.kode));
}
function ambHistMedian(p, kind, kode){
  const v = (DB.hasilAmbien[kind]||[]).filter(r=>r.titikId===p.id && r.parameterKode===kode && r.resultStatus==="measured" && r.resultNumeric!=null).map(r=>r.resultNumeric).sort((a,b)=>a-b);
  return v.length ? v[Math.floor(v.length/2)] : null;
}
function ambRowDerive(s, r){
  const p = coaPoint(s), periode = coaPeriode(s), sp = ambSpec(s.kind, r.kode);
  const res = hasilParseResult(r.value);
  const bm = sp ? sp.baku : null;
  const standard = r.standardOverride!=null && r.standardOverride!=="" ? Number(r.standardOverride) : (bm!=null ? bm : (r.bmDoc!=null && !isNaN(Number(r.bmDoc)) ? Number(r.bmDoc) : null));
  const status = ambStatusVsBaku(res.numeric, res.status, standard);
  const pct = ambPctOf(res.numeric, standard);
  const flags = [];
  if(!sp) flags.push({lv:"warn", t:"Parameter tidak dikenal"});
  if(!r.found && !r.value) flags.push({lv:"err", t:"Tidak ditemukan di dokumen — isi manual atau hapus centang"});
  else if(!r.value && r.include) flags.push({lv:"err", t:"Nilai kosong / tidak terbaca"});
  if(r.value && res.status==="other") flags.push({lv:"warn", t:"Format nilai tidak biasa — cek"});
  if(r.bmDoc!=null && bm!=null && Math.abs(Number(String(r.bmDoc).replace(/[^\d.]/g,"")) - bm) > 0.001*bm) flags.push({lv:"warn", t:`Baku mutu di dokumen ${r.bmDoc} ≠ regulasi ${bm}`});
  if(p && res.numeric!=null && res.status==="measured"){ const med = ambHistMedian(p, s.kind, r.kode); if(med && res.numeric>0 && (res.numeric > med*6 || res.numeric < med/6)) flags.push({lv:"warn", t:`Jauh dari riwayat titik ini (median ${med})`}); }
  if(r.include && p && periode){
    const twin = coaState.samples.find(o=>o!==s && o.kind===s.kind && o.pointId===s.pointId && coaPeriode(o)===periode && (o.rows||[]).some(x=>x.include && x.kode===r.kode && x.value));
    if(twin) flags.push({lv:"warn", t:`Parameter ini juga ada di ${twin.fileName} — yang terakhir menimpa`});
    const dup = (DB.hasilAmbien[s.kind]||[]).find(x=>x.titikId===p.id && x.periode===periode && x.parameterKode===r.kode);
    if(dup) flags.push({lv:"info", t:`Sudah ada di database ${periode} (${dup.resultRaw}) — ${coaState.replace?"akan diganti":"dilewati"}`});
  }
  return {p, periode, res, bm, standard, status, pct, flags};
}
function ambNoiseDerive(s){
  const p = coaPoint(s), n = s.noise;
  const calc = ambNoiseCalc(n.vals);
  const num = v=>{ const x = parseFloat(String(v||"").replace(",",".")); return isNaN(x) ? null : x; };
  const lsm = num(n.lsm)!=null ? num(n.lsm) : (calc ? calc.lsm : null);
  const ls = num(n.ls)!=null ? num(n.ls) : (calc ? calc.ls : null), lm = num(n.lm)!=null ? num(n.lm) : (calc ? calc.lm : null);
  const bmT = ambNoiseBaku(p);
  const baku = n.standardOverride!=null && n.standardOverride!=="" ? Number(n.standardOverride) : bmT.value;
  const flags = [];
  const filled = n.vals.filter(v=>num(v)!=null).length;
  if(filled<24) flags.push({lv: filled ? "warn" : "err", t:`${24-filled} dari 24 pembacaan jam (L1–L24) belum terisi`});
  n.vals.forEach((v,i)=>{ const x = num(v); if(x!=null && (x<20 || x>130)) flags.push({lv:"err", t:`L${i+1} = ${v} dB(A) tidak wajar`}); });
  if(lsm==null) flags.push({lv:"err", t:"LSM (L Day Night) belum ada"});
  if(calc && num(n.lsm)!=null && Math.abs(calc.lsm - num(n.lsm)) > 0.6) flags.push({lv:"warn", t:`LSM dokumen ${n.lsm} ≠ hitungan tools dari 24 jam ${calc.lsm} — cek angka jam`});
  if(calc && num(n.ls)!=null && Math.abs(calc.ls - num(n.ls)) > 0.6) flags.push({lv:"warn", t:`LS dokumen ${n.ls} ≠ hitungan ${calc.ls}`});
  if(calc && num(n.lm)!=null && Math.abs(calc.lm - num(n.lm)) > 0.6) flags.push({lv:"warn", t:`LM dokumen ${n.lm} ≠ hitungan ${calc.lm}`});
  if(n.bmDoc!=null && n.bmDoc!=="" && Number(n.bmDoc)!==bmT.value && (n.standardOverride==null || n.standardOverride==="")) flags.push({lv:"warn", t:`Baku mutu di dokumen ${n.bmDoc} ≠ baku titik ${bmT.value} (${bmT.src})`});
  return {p, calc, ls, lm, lsm, baku, bmSrc:bmT.src, status: ambStatusVsBaku(lsm, lsm!=null?"measured":"not_sampled", baku), pct: ambPctOf(lsm, baku), flags};
}
function ambVibDerive(s){
  const bands = GETARAN_FREQ_BANDS.map(f=>{ const x = parseFloat(String(s.vib.vals[f]||"").replace(",",".")); const v = isNaN(x) ? null : x; return {freq:f, nilai:v, status: v==null ? "" : getaranStatusFor(f, v)}; });
  let worst = "Not Disturb"; bands.forEach(b=>{ if(b.status && (GETARAN_RANK[b.status]||0) > (GETARAN_RANK[worst]||0)) worst = b.status; });
  const flags = [];
  const missing = bands.filter(b=>b.nilai==null).length;
  if(missing) flags.push({lv: missing===13 ? "err" : "warn", t:`${missing} dari 13 pita frekuensi belum terisi`});
  bands.forEach(b=>{ if(b.nilai!=null && b.nilai>5000) flags.push({lv:"err", t:`${b.freq} Hz = ${b.nilai} µm tidak wajar`}); });
  return {bands, worst: missing===13 ? "" : worst, flags};
}
function ambSampleFlags(s){
  const p = coaPoint(s), f = [], periode = coaPeriode(s);
  if(!p) f.push({lv:"err", t: s.nameRead ? `"${s.nameRead}" tidak cocok dgn titik ${AMB_KIND_LABEL[s.kind]} di Database Titik Pantau — pilih titiknya` : "Nama titik tidak terbaca — pilih titiknya"});
  else if(s.matchScore<0.97 && s.source!=="excel") f.push({lv:"warn", t:`Dicocokkan otomatis (kemiripan ${Math.round(s.matchScore*100)}%) dari "${s.nameRead}" — pastikan benar`});
  if(!periode) f.push({lv:"err", t:"Tanggal sampling tidak terbaca — isi tanggal"});
  if(s.method==="ocr" && s.conf<70) f.push({lv:"warn", t:`Kualitas scan rendah (keyakinan OCR ${s.conf}%) — cek semua angka`});
  if(p && periode && (s.kind==="kebisingan" || s.kind==="getaran")){
    const dup = (DB.hasilAmbien[s.kind]||[]).find(x=>x.titikId===p.id && x.periode===periode);
    if(dup) f.push({lv:"info", t:`Sudah ada data ${AMB_KIND_LABEL[s.kind]} ${periode} utk titik ini — ${coaState.replace?"akan diganti":"dilewati"}`});
    const twin = coaState.samples.find(o=>o!==s && o.kind===s.kind && o.pointId===s.pointId && coaPeriode(o)===periode);
    if(twin) f.push({lv:"warn", t:`Titik & periode sama dgn ${twin.fileName} — yang terakhir menimpa`});
  }
  return f;
}
function ambIssueCount(s){
  const own = ambSampleFlags(s).filter(x=>x.lv!=="info").length;
  if(s.kind==="kebisingan") return own + ambNoiseDerive(s).flags.filter(x=>x.lv!=="info").length;
  if(s.kind==="getaran") return own + ambVibDerive(s).flags.filter(x=>x.lv!=="info").length;
  return own + s.rows.filter(r=>r.include).reduce((a,r)=>a+ambRowDerive(s,r).flags.filter(x=>x.lv!=="info").length,0);
}
function ambRowCount(s){ return s.kind==="kebisingan" || s.kind==="getaran" ? 1 : s.rows.filter(r=>r.include).length; }

/* ---------- Render kartu sampel ambien ---------- */
function ambSampleHtml(s){
  const p = coaPoint(s), periode = coaPeriode(s), sflags = ambSampleFlags(s), issues = ambIssueCount(s);
  if(coaState.onlyIssues && !issues) return "";
  let body = "", chips = "";
  if(s.kind==="ambien" || s.kind==="kebauan"){
    const req = p ? ambRequired(p, s.kind) : [];
    const have = new Set(s.rows.filter(r=>r.include && r.value).map(r=>r.kode));
    chips = req.length ? `<div class="coa-req"><span class="muted">Parameter wajib:</span> ${req.map(k=>`<span class="hec-chip ${have.has(k)?"ok":"miss"}">${have.has(k)?"&#10003;":"&#10007;"} ${escHtml(k)}</span>`).join("")}</div>` : "";
    body = `<div class="coa-tablewrap"><table class="coa-table"><thead><tr><th class="c">&#10003;</th><th>Parameter</th>${s.kind==="ambien"?"<th>Periode sampling</th>":""}<th>Hasil</th><th>Satuan</th><th>BM di dokumen</th><th>Baku mutu</th><th>% BM</th><th>Status</th><th>Metode</th><th>Catatan review</th></tr></thead><tbody>${s.rows.map(r=>{
      const d = ambRowDerive(s, r), sp = ambSpec(s.kind, r.kode);
      if(coaState.onlyIssues && r.include && !d.flags.some(f=>f.lv!=="info")) return "";
      const badge = COA_STATUS_BADGE[d.status] || COA_STATUS_BADGE.not_evaluated;
      const err = d.flags.some(f=>f.lv==="err"), warn = d.flags.some(f=>f.lv==="warn");
      return `<tr class="${r.include?"":"off"} ${err?"has-err":warn?"has-warn":""}">
        <td class="c"><input type="checkbox" class="amb-in" data-sid="${s.id}" data-rid="${r.id}" data-f="include" ${r.include?"checked":""} aria-label="Ikut diimport"></td>
        <td><b>${escHtml(sp?sp.label:r.kode)}</b>${!r.found?`<div class="coa-kind">tidak ditemukan</div>`:""}</td>
        ${s.kind==="ambien"?`<td><input type="text" class="amb-in coa-unit" data-sid="${s.id}" data-rid="${r.id}" data-f="durasi" value="${escHtml(r.durasi)}" aria-label="Periode sampling"></td>`:""}
        <td><input type="text" class="amb-in coa-val" data-sid="${s.id}" data-rid="${r.id}" data-f="value" value="${escHtml(r.value)}" placeholder="isi hasil" aria-label="Hasil"></td>
        <td class="muted">${escHtml(r.unit)}</td>
        <td class="muted mono">${escHtml(r.bmDoc||"–")}</td>
        <td><input type="text" class="amb-in coa-bm" data-sid="${s.id}" data-rid="${r.id}" data-f="standard" value="${d.standard!=null?d.standard:""}" title="${escHtml(AMB_REGULASI[s.kind])}" aria-label="Baku mutu"></td>
        <td class="mono">${d.pct!=null?d.pct+"%":"–"}</td>
        <td><span class="badge ${badge[0]}">${badge[1]}</span></td>
        <td><input type="text" class="amb-in coa-met" data-sid="${s.id}" data-rid="${r.id}" data-f="metode" value="${escHtml(r.metode)}" aria-label="Metode"></td>
        <td class="coa-flagcell"><div class="coa-flags">${d.flags.map(coaFlagHtml).join("")}</div></td></tr>`;
    }).join("")}</tbody></table></div>`;
    if(s.kind==="ambien"){
      const C = [["suhu","Suhu (°C)"],["kelembapan","Kelembapan (%)"],["tekanan","Tekanan (mmHg)"],["kecepatanAngin","Kec. angin (m/s)"],["arahAngin","Arah angin"],["cuaca","Cuaca"]];
      body = `<div class="amb-cuaca">${C.map(([k,l])=>`<label><span>${l}</span><input type="text" class="amb-in" data-sid="${s.id}" data-f="cuaca.${k}" value="${escHtml(s.cuaca[k]||"")}"></label>`).join("")}</div>` + body;
    }
  } else if(s.kind==="kebisingan"){
    const d = ambNoiseDerive(s), n = s.noise, badge = COA_STATUS_BADGE[d.status] || COA_STATUS_BADGE.not_evaluated;
    body = `<div class="amb-noise"><div class="amb-hours">${n.vals.map((v,i)=>{ const x = parseFloat(v); const bad = v!=="" && (isNaN(x) || x<20 || x>130); return `<label class="${v===""?"empty":""} ${bad?"bad":""} ${i>=16?"night":""}"><span>L${i+1} <em>${KEBISINGAN_JAM_LABELS[i]}</em></span><input type="text" class="amb-in" data-sid="${s.id}" data-f="noise.${i}" value="${escHtml(v)}" aria-label="L${i+1}"></label>`; }).join("")}</div>
      <div class="amb-noise-sum">
        <label><span>LS siang (L Day)</span><input type="text" class="amb-in" data-sid="${s.id}" data-f="noise.ls" value="${escHtml(n.ls)}"><em>hitung: ${d.calc?d.calc.ls:"–"}</em></label>
        <label><span>LM malam (L Night)</span><input type="text" class="amb-in" data-sid="${s.id}" data-f="noise.lm" value="${escHtml(n.lm)}"><em>hitung: ${d.calc?d.calc.lm:"–"}</em></label>
        <label><span>LSM (L Day Night)</span><input type="text" class="amb-in" data-sid="${s.id}" data-f="noise.lsm" value="${escHtml(n.lsm)}"><em>hitung: ${d.calc?d.calc.lsm:"–"}</em></label>
        <label><span>Baku mutu dB(A)</span><input type="text" class="amb-in" data-sid="${s.id}" data-f="noise.standard" value="${d.baku!=null?d.baku:""}" title="${escHtml(d.bmSrc)}"><em>dokumen: ${escHtml(n.bmDoc||"–")}</em></label>
        <label><span>Metode</span><input type="text" class="amb-in" data-sid="${s.id}" data-f="noise.metode" value="${escHtml(n.metode)}"></label>
        <div class="amb-noise-st"><span class="badge ${badge[0]}">${badge[1]}</span>${d.pct!=null?`<b>${d.pct}%</b> BM`:""}</div>
      </div>
      ${d.flags.length?`<div class="coa-flags amb-flags">${d.flags.map(coaFlagHtml).join("")}</div>`:""}</div>`;
  } else {
    const d = ambVibDerive(s), wb = GETARAN_STATUS_BADGE[d.worst];
    body = `<div class="coa-tablewrap"><table class="coa-table amb-vib"><thead><tr><th>Frekuensi (Hz)</th><th>Hasil (micron)</th><th>Not Disturb</th><th>Disturb</th><th>Uncomfortable</th><th>Painful</th><th>Status</th></tr></thead><tbody>${d.bands.map(b=>{ const t = GETARAN_THRESHOLDS[b.freq], sb = GETARAN_STATUS_BADGE[b.status];
      return `<tr class="${b.nilai==null?"has-err":""}"><td class="mono"><b>${b.freq}</b></td><td><input type="text" class="amb-in coa-val" data-sid="${s.id}" data-f="vib.${b.freq}" value="${escHtml(s.vib.vals[b.freq])}" aria-label="${b.freq} Hz"></td><td class="muted">${t.notDisturb}</td><td class="muted">${t.disturb}</td><td class="muted">${t.uncomfortable}</td><td class="muted">${t.painful}</td><td>${sb?`<span class="badge ${sb[0]}">${sb[1]}</span>`:"–"}</td></tr>`; }).join("")}</tbody></table></div>
      <div class="amb-vib-foot"><span>Status keseluruhan: ${wb?`<span class="badge ${wb[0]}">${wb[1]}</span>`:"–"}</span><label>Metode <input type="text" class="amb-in coa-met" data-sid="${s.id}" data-f="vib.metode" value="${escHtml(s.vib.metode)}"></label>${d.flags.length?`<div class="coa-flags">${d.flags.map(coaFlagHtml).join("")}</div>`:""}</div>`;
  }
  return `<article class="card coa-sample amb-sample k-${s.kind} ${issues?"has-issue":""}" data-sid="${s.id}">
    <header class="coa-sh">
      <div class="coa-sh-src"><span class="amb-kind-tag k-${s.kind}">${AMB_KIND_LABEL[s.kind]}</span><span class="coa-src-tag ${s.source}">${s.source==="excel"?"Excel":s.method==="ocr"?`OCR ${s.conf}%`:"Teks PDF"}</span><span class="muted">${escHtml(s.fileName||"")}${s.page?` · hal. ${s.page}`:""}${s.angle?` · diluruskan ${s.angle}°`:""}</span>
        ${s.thumb?`<button type="button" class="btn small ghost" data-action="coaShowDoc" data-sid="${s.id}">Lihat dokumen</button>`:""}
        <button type="button" class="btn small ghost danger" data-action="coaRemoveSample" data-sid="${s.id}">Buang</button></div>
      <div class="coa-sh-grid" data-sid="${s.id}">
        <div class="field"><label>Titik pantau ${s.nameRead && s.source!=="excel"?`<span class="muted">(terbaca: "${escHtml(s.nameRead)}")</span>`:""}</label><select class="coa-sel" data-f="pointId">${coaPointOptions(s)}</select></div>
        <div class="field"><label>Tanggal sampling</label><input type="date" class="coa-sin" data-f="dateOfSampling" value="${escHtml(s.dateOfSampling||"")}"></div>
        <div class="field"><label>Periode</label><input type="text" class="coa-sin" data-f="periodeManual" value="${escHtml(periode)}" placeholder="S2 2026"></div>
        <div class="coa-meta">${p ? `<div><span>Site</span><b>${escHtml(p.site)}</b></div><div><span>Kategori</span><b>${AMB_KIND_LABEL[s.kind]}</b></div><div><span>Regulasi</span><b>${escHtml(p.regulasi||AMB_REGULASI[s.kind])}</b></div><div><span>Wajib pantau</span><b>${effectiveWajib(p, periode||currentPeriodStr())?"Ya":"Tidak"}</b></div><div><span>Frekuensi</span><b>${escHtml(frekuensiLabelShort(p.frekuensiBulan))}</b></div>` : `<div class="muted">Pilih titik untuk mengisi site, regulasi &amp; baku mutu otomatis.</div>`}</div>
      </div>
      ${chips}
      ${sflags.length ? `<div class="coa-sflags">${sflags.map(coaFlagHtml).join("")}</div>` : ""}
    </header>
    ${body}
    <div class="coa-sfoot">${s.text?`<details class="coa-raw"><summary>Teks hasil baca</summary><pre>${escHtml(s.text)}</pre></details>`:""}</div>
  </article>`;
}
document.addEventListener("change", e=>{
  const t = e.target; if(!t.classList || !t.classList.contains("amb-in")) return;
  const s = coaState.samples.find(x=>x.id===t.dataset.sid); if(!s) return;
  const f = t.dataset.f, v = t.type==="checkbox" ? t.checked : t.value.trim();
  if(f.startsWith("cuaca.")) s.cuaca[f.slice(6)] = v;
  else if(f.startsWith("noise.")){ const k = f.slice(6); if(/^\d+$/.test(k)) s.noise.vals[Number(k)] = v.replace(",","."); else if(k==="standard") s.noise.standardOverride = v; else s.noise[k] = v; }
  else if(f.startsWith("vib.")){ const k = f.slice(4); if(k==="metode") s.vib.metode = v; else s.vib.vals[Number(k)] = v.replace(",","."); }
  else {
    const r = s.rows.find(x=>x.id===t.dataset.rid); if(!r) return;
    if(f==="include") r.include = v;
    else if(f==="value"){ r.value = v; if(v){ r.found = true; r.include = true; } }
    else if(f==="standard") r.standardOverride = v==="" ? null : v;
    else r[f] = v;
  }
  renderCoaReader();
});

/* ---------- Record DB.hasilAmbien dari sampel review ---------- */
function ambRecordsFor(s){
  const p = coaPoint(s), periode = coaPeriode(s);
  const {sem, tahun, order} = hasilPeriodParts(periode);
  const base = {titikId: p ? p.id : null, titik: p ? p.nama : s.nameRead, site: p ? p.site : (s.siteXls||""), tanggal: s.dateOfSampling||"", periode, semester:sem, tahun, periodeOrder:order};
  if(s.kind==="ambien" || s.kind==="kebauan"){
    return s.rows.filter(r=>r.include && r.value).map(r=>{
      const d = ambRowDerive(s, r), sp = ambSpec(s.kind, r.kode);
      const rec = {id:(s.kind==="ambien"?"AMBRES_":"ODRRES_")+uid("x"), ...base, parameter: sp ? sp.label : r.kode, parameterKode: r.kode, unit: r.unit || AMB_UNIT[s.kind],
        resultRaw: d.res.raw, resultNumeric: d.res.numeric, resultStatus: d.res.status, baku: d.standard, statusBakuMutu: d.status, pctOfBaku: d.pct, metode: r.metode};
      if(s.kind==="ambien"){ rec.durasi = r.durasi; rec.cuaca = {...s.cuaca}; }
      return {row:r, rec};
    });
  }
  if(s.kind==="kebisingan"){
    const d = ambNoiseDerive(s); if(d.lsm==null) return [];
    const hourly = s.noise.vals.map((v,i)=>({label:`L${i+1} (${KEBISINGAN_JAM_LABELS[i]})`, jam:KEBISINGAN_JAM_LABELS[i], nilai: v==="" ? null : Number(v)})).filter(h=>h.nilai!=null && !isNaN(h.nilai));
    return [{rec:{id:"NOIRES_"+uid("x"), ...base, unit:"dB(A)", hourly, lSiang:d.ls, lMalam:d.lm, lSiangMalam:d.lsm, baku:d.baku, statusBakuMutu:d.status, pctOfBaku:d.pct, metode:s.noise.metode}}];
  }
  const d = ambVibDerive(s); const bands = d.bands.filter(b=>b.nilai!=null).map(b=>{ const t = GETARAN_THRESHOLDS[b.freq]; return {freq:b.freq, nilai:b.nilai, notDisturb:t.notDisturb, disturb:t.disturb, uncomfortable:t.uncomfortable, painful:t.painful, status:b.status}; });
  if(!bands.length) return [];
  return [{rec:{id:"VIBRES_"+uid("x"), ...base, unit:"micron", bands, statusKeseluruhan:d.worst, metode:s.vib.metode}}];
}
// Rencana import ambien: {ready:[{s, cat, rec, row}], blocked, replaced}
function ambImportPlan(samples){
  const ready = []; let blocked = 0, replaced = 0;
  samples.forEach(s=>{
    const ok = coaPoint(s) && coaPeriode(s) && hasilPeriodParts(coaPeriode(s)).order!=null;
    const recs = ambRecordsFor(s);
    if(!ok || !recs.length){ blocked += Math.max(1, ambRowCount(s)); return; }
    recs.forEach(x=>{ if(ambFindExisting(s.kind, x.rec)) replaced++; ready.push({s, cat:s.kind, rec:x.rec, row:x.row}); });
  });
  return {ready, blocked, replaced};
}
function ambFindExisting(cat, rec){
  return (DB.hasilAmbien[cat]||[]).find(x=>x.titikId===rec.titikId && x.periode===rec.periode && (cat==="kebisingan" || cat==="getaran" || x.parameterKode===rec.parameterKode));
}
function ambCommit(plan){
  let add = 0, rep = 0, skip = 0; const done = new Set();
  plan.ready.forEach(x=>{
    const ex = ambFindExisting(x.cat, x.rec);
    if(ex){ if(coaState.replace){ Object.assign(ex, x.rec, {id:ex.id}); rep++; } else { skip++; return; } }
    else { DB.hasilAmbien[x.cat].push(x.rec); add++; }
    done.add(x.row ? x.row.id : x.s.id);
  });
  if(add || rep) touchDataset("hasilAmbien");
  return {add, rep, skip, done};
}

/* ---------- Excel ambien (template/export/review) — sheet sama dgn format lama, + pita status ---------- */
const AMB_XLSX = {
  ambien: {sheet:"AMBIEN", cols:[["SAMPLE IDENTIFICATION","W",26],["DATE OF SAMPLING","W",14],["PARAMETER","W",28],["TEST RESULT","W",12],["SITE","A",8],["SEMESTER","A",10],["PERIODE","A",10],["REQUIREMENT","A",12],["METHOD","O",18],["TEMPERATUR(°C)","O",13],["HUMIDITY(%)","O",12],["PRESSURE(mmHg)","O",14],["WINDSPEED(m/s)","O",13],["WIND DIRECTION","O",14],["WEATHER","O",10]]},
  kebisingan: {sheet:"KEBISINGAN (NOISE)", cols:[["SAMPLE IDENTIFICATION","W",26],["DATE OF MEASURMENT","W",14],["TIME OF MEASURMENT","W",22],["TEST RESULT","W",12],["SITE","A",8],["SEMESTER","A",10],["UNIT","A",8],["REQUIREMENT","A",12],["METHOD","O",16],["REMARKS","O",12]]},
  getaran: {sheet:"GETARAN", cols:[["SAMPLE IDENTIFICATION","W",26],["DATE OF MEASUREMENT","W",14],["FREQUENCY (Hz)","W",12],["TEST RESULT","W",12],["SITE","A",8],["SEMESTER","A",10],["UNIT","A",8],["NOTDISTURB","A",10],["DISTURB","A",10],["UNCOMFORTABLE","A",13],["PAINFUL","A",10],["STATUS","A",13],["METHOD","O",16]]},
  kebauan: {sheet:"KEBAUAN (ODOR)", cols:[["SAMPLE IDENTIFICATION","W",26],["DATE OF MEASUREMENT","W",14],["PARAMETER","W",26],["TEST RESULT","W",12],["SITE","A",8],["SEMESTER","A",10],["UNIT","A",8],["REQUIREMENT","A",12],["METHOD","O",20]]}
};
function ambXlsxSheet(kind, rows, extra){
  const def = AMB_XLSX[kind];
  const cols = def.cols.map(([h,s,w])=>({h,s,w})).concat((extra||[]).map(c=>({h:c.h, s:"X", w:c.w||18})));
  const GRID = "CBD5E1", band = [], head = [], merges = []; let runStart = 0;
  cols.forEach((c,i)=>{
    const g = HE_XLSX_GROUP[c.s] || {label:"INFO REVIEW (tidak diimport)", fill:"334155", soft:"E2E8F0"};
    band.push({v:(i===0 || cols[i-1].s!==c.s) ? g.label : "", st:{b:true, sz:9, color:"FFFFFF", fill:g.fill, border:GRID, h:"center"}});
    head.push({v:c.h, st:{b:true, sz:9, color:"0F172A", fill:g.soft, border:GRID, h:"center", wrap:true}});
    if(!cols[i+1] || cols[i+1].s!==c.s){ if(i>runStart) merges.push(`${xsCol(runStart)}1:${xsCol(i)}1`); runStart = i+1; }
  });
  const out = [band, head];
  rows.forEach(r=>out.push(cols.map(c=>{ const v = r[c.h], st = {sz:9, border:GRID, ...((r.__styles||{})[c.h]||{})};
    if(/^DATE/.test(c.h) && v && /^\d{4}-\d{2}-\d{2}$/.test(v)) return {v:xsSerial(v), t:"n", st:{...st, num:"date", h:"left"}};
    if(typeof v==="number" && isFinite(v)) return {v, t:"n", st};
    if(typeof v==="string" && /^-?\d+(\.\d+)?$/.test(v.trim()) && c.s!=="X") return {v:Number(v), t:"n", st};
    return {v: v==null ? "" : String(v), st}; })));
  const pk = ambPointKategori(kind), nPts = DB.points.filter(p=>p.kategori===pk).length;
  const vals = [{sqref:`A3:A${Math.max(out.length,400)}`, formula:`'Referensi Titik Ambien'!$${({ambien:"A",kebisingan:"B",kebauan:"C",getaran:"D"})[kind]}$3:$${({ambien:"A",kebisingan:"B",kebauan:"C",getaran:"D"})[kind]}$${2+nPts}`}];
  if(kind==="ambien" || kind==="kebauan") vals.push({sqref:`C3:C${Math.max(out.length,400)}`, formula:`"${AMB_SPECS[kind].map(x=>x.label).join(",")}"`});
  return {name:def.sheet, rows:out, widths:cols.map(c=>c.w), heights:{0:20, 1:30}, merges, freeze:{y:2, x:1}, autoFilter:`A2:${xsCol(cols.length-1)}${Math.max(3,out.length)}`, validations:vals};
}
function ambGuideSheet(){
  const rows = [[{v:"Petunjuk Template Import Hasil Ambient", st:{b:true, sz:13, color:"12294A"}}],
    [{v:"Isi kolom WAJIB (merah) saja. Kolom OTOMATIS (hijau) diisi tools saat import: site & semester dari titik/tanggal, durasi sampling & baku mutu dari regulasi (PP 22/2021 Lamp. VII, KepMenLH 48/49/50 1996), ambang & status getaran dari tabel KepMenLH 49/1996, LS/LM/LSM kebisingan dihitung dari 24 pembacaan jam. Semua baris direview dulu di halaman Import sebelum masuk database.", st:{sz:9, color:"334155", wrap:true}}], [],
    ["Sheet","Cara isi"].map(v=>({v, st:{b:true, sz:9, color:"FFFFFF", fill:"12294A"}}))];
  [["AMBIEN","1 baris = 1 parameter (SO2, CO, NO2, O3, NMHC, TSP, PM10, PM2.5, Pb). Hasil di bawah deteksi tulis <115. Data cuaca opsional (cukup di baris pertama titik)."],
   ["KEBISINGAN (NOISE)","1 baris = 1 jam: TIME OF MEASURMENT L1 (06.00) … L24 (05.00). Baris L Day / L Night / L Day Night opsional — kalau kosong dihitung tools."],
   ["GETARAN","1 baris = 1 pita frekuensi (4, 5, 6.3, 8, 10, 12.5, 16, 20, 25, 31.5, 40, 50, 63 Hz). Ambang & status otomatis."],
   ["KEBAUAN (ODOR)","1 baris = 1 parameter (NH3, H2S, Styrene, Methyl Mercaptan, Methyl Sulfide)."]].forEach(([a,b])=>rows.push([{v:a, st:{b:true, sz:9, border:"CBD5E1"}}, {v:b, st:{sz:9, border:"CBD5E1", wrap:true}}]));
  rows.push([], [{v:"Baku mutu yang dipakai tools", st:{b:true, sz:10, color:"12294A"}}]);
  ["ambien","kebauan"].forEach(k=>AMB_SPECS[k].forEach(sp=>rows.push([{v:`${AMB_KIND_LABEL[k]} — ${sp.label}`, st:{sz:9, border:"CBD5E1"}}, {v:`${sp.baku} ${AMB_UNIT[k]}${sp.durasi?` (${sp.durasi})`:""} · ${AMB_REGULASI[k]}`, st:{sz:9, border:"CBD5E1"}}])));
  rows.push([{v:"Kebisingan — LSM", st:{sz:9, border:"CBD5E1"}}, {v:"Baku terakhir titik di riwayat (55 permukiman / 70 industri), KepMenLH 48/1996", st:{sz:9, border:"CBD5E1"}}]);
  return {name:"Petunjuk Ambien", rows, widths:[34,110], merges:["A1:B1","A2:B2"], heights:{1:54}};
}
function ambRefSheet(){
  const lists = AMB_KINDS.map(k=>DB.points.filter(p=>p.kategori===ambPointKategori(k)).sort((a,b)=>a.site.localeCompare(b.site)||a.nama.localeCompare(b.nama)));
  const n = Math.max(...lists.map(l=>l.length));
  const rows = [[{v:"Daftar titik per kategori (dipakai utk dropdown SAMPLE IDENTIFICATION)", st:{b:true, sz:11, color:"12294A"}}],
    AMB_KINDS.map(k=>({v:AMB_KIND_LABEL[k], st:{b:true, sz:9, color:"FFFFFF", fill:"0B7F7B", border:"94A3B8", h:"center"}})).concat(AMB_KINDS.map(k=>({v:`Site · ${AMB_KIND_LABEL[k]}`, st:{b:true, sz:9, color:"FFFFFF", fill:"64748B", border:"94A3B8", h:"center"}})))];
  for(let i=0;i<n;i++) rows.push(lists.map(l=>({v:l[i]?l[i].nama:"", st:{sz:9, border:"E2E8F0"}})).concat(lists.map(l=>({v:l[i]?l[i].site:"", st:{sz:9, border:"E2E8F0", h:"center"}}))));
  return {name:"Referensi Titik Ambien", rows, widths:[30,30,30,30,10,10,10,10], merges:["A1:H1"]};
}
function ambRowsForExcel(kind, records){
  const out = [];
  records.forEach(r=>{
    if(kind==="ambien") out.push({"SAMPLE IDENTIFICATION":r.titik, "DATE OF SAMPLING":r.tanggal, "PARAMETER":r.parameter, "TEST RESULT":r.resultRaw, "SITE":r.site, "SEMESTER":r.periode, "PERIODE":r.durasi, "REQUIREMENT":r.baku!=null?r.baku:"", "METHOD":r.metode,
      "TEMPERATUR(°C)":(r.cuaca||{}).suhu, "HUMIDITY(%)":(r.cuaca||{}).kelembapan, "PRESSURE(mmHg)":(r.cuaca||{}).tekanan, "WINDSPEED(m/s)":(r.cuaca||{}).kecepatanAngin, "WIND DIRECTION":(r.cuaca||{}).arahAngin, "WEATHER":(r.cuaca||{}).cuaca, ...(r.__x||{})});
    if(kind==="kebauan") out.push({"SAMPLE IDENTIFICATION":r.titik, "DATE OF MEASUREMENT":r.tanggal, "PARAMETER":r.parameter, "TEST RESULT":r.resultRaw, "SITE":r.site, "SEMESTER":r.periode, "UNIT":r.unit, "REQUIREMENT":r.baku!=null?r.baku:"", "METHOD":r.metode, ...(r.__x||{})});
    if(kind==="kebisingan"){
      const b = {"SAMPLE IDENTIFICATION":r.titik, "DATE OF MEASURMENT":r.tanggal, "SITE":r.site, "SEMESTER":r.periode, "UNIT":r.unit, "METHOD":r.metode, ...(r.__x||{})};
      (r.hourly||[]).forEach(h=>out.push({...b, "TIME OF MEASURMENT":h.label, "TEST RESULT":h.nilai, "REQUIREMENT":"-", "REMARKS":"Result"}));
      out.push({...b, "TIME OF MEASURMENT":"L Day (06.00 - 21.00)", "TEST RESULT":r.lSiang!=null?r.lSiang:"", "REQUIREMENT":"-", "REMARKS":"Final Result"});
      out.push({...b, "TIME OF MEASURMENT":"L Night (22.00 - 05.00)", "TEST RESULT":r.lMalam!=null?r.lMalam:"", "REQUIREMENT":"-", "REMARKS":"Final Result"});
      out.push({...b, "TIME OF MEASURMENT":"L Day Night", "TEST RESULT":r.lSiangMalam!=null?r.lSiangMalam:"", "REQUIREMENT":r.baku!=null?r.baku:"", "REMARKS":"Final Result"});
    }
    if(kind==="getaran"){
      const b = {"SAMPLE IDENTIFICATION":r.titik, "DATE OF MEASUREMENT":r.tanggal, "SITE":r.site, "SEMESTER":r.periode, "UNIT":r.unit, "METHOD":r.metode, ...(r.__x||{})};
      (r.bands||[]).forEach(x=>out.push({...b, "FREQUENCY (Hz)":x.freq, "TEST RESULT":x.nilai, "NOTDISTURB":x.notDisturb, "DISTURB":x.disturb, "UNCOMFORTABLE":x.uncomfortable, "PAINFUL":x.painful, "STATUS":x.status}));
    }
  });
  return out;
}
function exportAmbienXlsx(){
  const sheets = AMB_KINDS.map(k=>ambXlsxSheet(k, ambRowsForExcel(k, (DB.hasilAmbien[k]||[]).slice().sort((a,b)=>b.periodeOrder-a.periodeOrder || a.site.localeCompare(b.site) || a.titik.localeCompare(b.titik)))));
  const blob = heXlsxBlob([...sheets, ambGuideSheet(), ambRefSheet()]);
  downloadBlob(blob, "hasil_pemantauan_ambient_export.xlsx", blob.type);
}
function downloadTemplateAmbien(){
  const blob = heXlsxBlob([...AMB_KINDS.map(k=>ambXlsxSheet(k, [])), ambGuideSheet(), ambRefSheet()]);
  downloadBlob(blob, "template_hasil_pemantauan_ambient.xlsx", blob.type);
  toast("Template ambien diunduh: isi kolom merah (wajib), kolom hijau diisi tools saat import.", "ok");
}
// Excel ambien -> sampel review (header di baris 1 atau 2; pita status diabaikan)
function ambSheetRows(ws){
  const arr = XLSX.utils.sheet_to_json(ws, {header:1, defval:"", raw:true});
  const hi = arr.slice(0,10).findIndex(r=>r.map(c=>String(c).trim().toUpperCase()).includes("SAMPLE IDENTIFICATION"));
  if(hi<0) return [];
  const heads = arr[hi].map(h=>String(h).trim().toUpperCase());
  return arr.slice(hi+1).filter(r=>r.some(c=>String(c).trim()!=="")).map(r=>{ const o = {}; heads.forEach((h,i)=>{ if(h) o[h] = r[i]; }); return o; });
}
function ambSamplesFromWorkbook(wb){
  const samples = [];
  const find = re=>wb.SheetNames.find(n=>re.test(n));
  const groups = (rows, dateKeys)=>{ const g = new Map(); rows.forEach(r=>{ const name = String(r["SAMPLE IDENTIFICATION"]||"").trim(); if(!name) return; const date = heParseDateAny(dateKeys.map(k=>r[k]).find(v=>v!=="" && v!=null)); const per = String(r["SEMESTER"]||"").trim() || hePeriodeOfDate(date); const k = name+"|"+(date||per); if(!g.has(k)) g.set(k, {name, date, per, site:String(r["SITE"]||"").trim(), rows:[]}); g.get(k).rows.push(r); }); return [...g.values()]; };
  const mk = (kind, g)=>{ const pk = ambPointKategori(kind); const exact = DB.points.find(p=>p.kategori===pk && p.nama.trim()===g.name); const mt = heMatchPoint(g.name, pk);
    return {id:coaNewId("s"), kind, source:"excel", fileName:"Excel", page:null, method:"excel", conf:100, thumb:null, text:"", nameRead:g.name, pointId: exact ? exact.id : (mt.point ? mt.point.id : ""), matchScore: exact ? 1 : mt.score, candidates:mt.candidates,
      dateOfSampling:g.date||"", periodeManual: g.date ? "" : g.per, siteXls:g.site, lab:"", ref:"", rows:[], cuaca:{suhu:"",kelembapan:"",tekanan:"",kecepatanAngin:"",arahAngin:"",cuaca:""}}; };
  [["ambien",/^AMBIEN/i,["DATE OF SAMPLING","DATE OF MEASUREMENT"]],["kebauan",/KEBAUAN|ODOR/i,["DATE OF MEASUREMENT","DATE OF SAMPLING"]]].forEach(([kind, re, dk])=>{
    const sn = find(re); if(!sn) return;
    groups(ambSheetRows(wb.Sheets[sn]), dk).forEach(g=>{
      const s = mk(kind, g);
      g.rows.forEach((r,i)=>{ const kode = ambCanon(kind, r["PARAMETER"]); if(!kode) return; const res = String(r["TEST RESULT"]==null?"":r["TEST RESULT"]).trim();
        s.rows.push({id:coaNewId("r"), kode, durasi:String(r["PERIODE"]||"").trim() || ((ambSpec(kind,kode)||{}).durasi||""), unit:String(r["UNIT"]||"").trim() || AMB_UNIT[kind], value:res, bmDoc: r["REQUIREMENT"]!==""&&r["REQUIREMENT"]!=null ? String(r["REQUIREMENT"]) : null, valuesRead:res, metode:String(r["METHOD"]||"").trim(), include:!!res, found:true, standardOverride:null});
        if(kind==="ambien"){ const C = {suhu:"TEMPERATUR(°C)", kelembapan:"HUMIDITY(%)", tekanan:"PRESSURE(MMHG)", kecepatanAngin:"WINDSPEED(M/S)", arahAngin:"WIND DIRECTION", cuaca:"WEATHER"}; Object.entries(C).forEach(([k,h])=>{ if(!s.cuaca[k] && r[h]!=="" && r[h]!=null) s.cuaca[k] = String(r[h]); }); }
      });
      if(s.rows.length) samples.push(s);
    });
  });
  const sn = find(/KEBISINGAN|NOISE/i);
  if(sn) groups(ambSheetRows(wb.Sheets[sn]), ["DATE OF MEASURMENT","DATE OF MEASUREMENT"]).forEach(g=>{
    const s = mk("kebisingan", g); const out = {vals:Array(24).fill(""), ls:"", lm:"", lsm:"", bmDoc:null, metode:"", standardOverride:null};
    g.rows.forEach(r=>{ const lab = String(r["TIME OF MEASURMENT"]||r["TIME OF MEASUREMENT"]||"").trim(), v = r["TEST RESULT"]==null ? "" : String(r["TEST RESULT"]).trim();
      const m = lab.match(/^L\s*(\d{1,2})\b/); if(m && Number(m[1])>=1 && Number(m[1])<=24) out.vals[Number(m[1])-1] = v;
      else if(/day\s*night/i.test(lab)){ out.lsm = v; if(r["REQUIREMENT"]!=="" && r["REQUIREMENT"]!=null && r["REQUIREMENT"]!=="-") out.bmDoc = String(r["REQUIREMENT"]); }
      else if(/night/i.test(lab)) out.lm = v; else if(/day/i.test(lab)) out.ls = v;
      if(!out.metode && r["METHOD"]) out.metode = String(r["METHOD"]).trim(); });
    s.noise = out; samples.push(s);
  });
  const sg = find(/GETARAN|VIBRATION/i);
  if(sg) groups(ambSheetRows(wb.Sheets[sg]), ["DATE OF MEASUREMENT","DATE OF MEASURMENT"]).forEach(g=>{
    const s = mk("getaran", g); const vals = {}; GETARAN_FREQ_BANDS.forEach(f=>vals[f] = ""); let metode = "";
    g.rows.forEach(r=>{ const f = Number(String(r["FREQUENCY (HZ)"]||"").replace(",",".")); if(GETARAN_FREQ_BANDS.includes(f)) vals[f] = r["TEST RESULT"]==null ? "" : String(r["TEST RESULT"]); if(!metode && r["METHOD"]) metode = String(r["METHOD"]).trim(); });
    s.vib = {vals, metode: metode || "ISO 2631-2: 2003"}; samples.push(s);
  });
  return samples;
}
// Import Excel gabungan (emisi dan/atau ambien) -> halaman review
function importHasilAnyXlsx(){
  xlsxImport(wb=>{
    const amb = ambSamplesFromWorkbook(wb);
    const emSheet = wb.Sheets["Hasil Pemantauan"] || (wb.SheetNames.length===1 && !amb.length ? wb.Sheets[wb.SheetNames[0]] : null);
    let emRows = [];
    if(emSheet) emRows = heSheetRows(emSheet).filter(r=>!/\(contoh/i.test(String(r["REMARKS"]||"")));
    const emSamples = heSamplesFromRows(emRows);
    const all = emSamples.concat(amb);
    if(!all.length){ toast("Tidak ada data yang dikenali — pakai Template Excel emisi atau ambien.","err"); return; }
    coaAddSamples(all, `Excel (${emSamples.length} sampel emisi, ${amb.length} sampel ambien)`);
    showPage("coareader");
    toast(`${all.length} sampel dari Excel siap direview. Periksa lalu klik "Import ke Database".`, "ok");
  });
}

/* ---------- Kelengkapan data ambien per periode ---------- */
function ambCompleteness(periode){
  const out = {periode, kinds:{}};
  AMB_KINDS.forEach(kind=>{
    const pk = ambPointKategori(kind), recs = (DB.hasilAmbien[kind]||[]).filter(r=>r.periode===periode);
    const items = [];
    DB.points.filter(p=>p.kategori===pk).forEach(p=>{
      const mine = recs.filter(r=>r.titikId===p.id || (!r.titikId && r.titik===p.nama));
      const wajib = effectiveWajib(p, periode) && isDueThisPeriod(p, periode), sampled = heSampledIn(p, periode);
      if(!wajib && !sampled && !mine.length) return;
      let req, have;
      if(kind==="ambien" || kind==="kebauan"){ req = ambRequired(p, kind); const h = new Set(mine.map(r=>r.parameterKode)); have = req.filter(k=>h.has(k)); }
      else if(kind==="kebisingan"){ req = ["LSM","24 jam"]; const r = mine[0]; have = r ? [r.lSiangMalam!=null?"LSM":null, (r.hourly||[]).length>=24?"24 jam":null].filter(Boolean) : []; }
      else { req = ["13 pita"]; const r = mine[0]; have = r && (r.bands||[]).length>=13 ? ["13 pita"] : []; }
      items.push({p, kind, wajib, sampled, req, have, status: have.length===req.length ? "lengkap" : (mine.length ? "sebagian" : "kosong"), reason: wajib ? (sampled ? "Wajib · sudah disampling" : "Wajib pantau") : (sampled ? "Sudah disampling" : "Ada data hasil")});
    });
    out.kinds[kind] = {items, total:items.length, lengkap:items.filter(x=>x.status==="lengkap").length, sebagian:items.filter(x=>x.status==="sebagian").length, kosong:items.filter(x=>x.status==="kosong").length};
  });
  const all = Object.values(out.kinds).flatMap(k=>k.items);
  out.total = all.length; out.lengkap = all.filter(x=>x.status==="lengkap").length; out.sebagian = all.filter(x=>x.status==="sebagian").length; out.kosong = all.filter(x=>x.status==="kosong").length;
  out.items = all;
  return out;
}
let ambCompPeriode = "", ambCompOpen = false;
function renderAmbienCompleteness(){
  const el = document.getElementById("ambienCompleteness"); if(!el) return;
  const set = new Set([currentPeriodStr()]); AMB_KINDS.forEach(k=>(DB.hasilAmbien[k]||[]).forEach(r=>r.periode && set.add(r.periode))); DB.batches.forEach(b=>b.period && set.add(b.period));
  const opts = [...set].filter(p=>hasilPeriodParts(p).order!=null).sort((a,b)=>hasilPeriodParts(b).order-hasilPeriodParts(a).order);
  if(!ambCompPeriode || !opts.includes(ambCompPeriode)) ambCompPeriode = currentPeriodStr();
  const c = ambCompleteness(ambCompPeriode);
  const inc = c.items.filter(x=>x.status!=="lengkap").sort((a,b)=>({kosong:0,sebagian:1}[a.status]-{kosong:0,sebagian:1}[b.status]) || AMB_KINDS.indexOf(a.kind)-AMB_KINDS.indexOf(b.kind) || a.p.site.localeCompare(b.p.site));
  const pct = (a,b)=>b?Math.round(a/b*100):0;
  el.innerHTML = `<section class="card hec-card" aria-label="Kelengkapan data hasil ambient">
    <div class="hec-head"><div><div class="hec-eyebrow">Kelengkapan data</div><h3>Hasil ambient yang wajib masuk &middot; ${escHtml(c.periode)}</h3>
      <div class="hec-sub">Target = titik wajib pantau yang jatuh tempo, titik yang sudah disampling di batch periode ini, atau yang sudah punya data.</div></div>
      <div class="hec-tools"><label class="hec-lbl" for="ambCompPeriode">Periode</label><select id="ambCompPeriode">${opts.map(o=>`<option value="${escHtml(o)}" ${o===c.periode?"selected":""}>${escHtml(o)}${o===currentPeriodStr()?" (aktif)":""}</option>`).join("")}</select>
      <button type="button" class="btn small primary" data-action="goToPage" data-page="coareader">Baca CoA/SHU (PDF)</button></div></div>
    <div class="amb-comp-grid">${AMB_KINDS.map(k=>{ const x = c.kinds[k]; return `<div class="amb-comp-k k-${k}"><div class="amb-comp-t">${AMB_KIND_LABEL[k]}</div><div class="amb-comp-n"><b>${x.lengkap}</b>/${x.total} lengkap</div><div class="hec-bar"><i style="width:${pct(x.lengkap,x.total)}%"></i></div><div class="amb-comp-s">${x.sebagian?`<span class="w">${x.sebagian} sebagian</span>`:""}${x.kosong?`<span class="b">${x.kosong} belum ada</span>`:""}${!x.sebagian&&!x.kosong?`<span class="g">semua lengkap</span>`:""}</div></div>`; }).join("")}</div>
    ${inc.length ? `<details class="hec-list" ${ambCompOpen?"open":""} id="ambCompDetails"><summary>${inc.length} titik belum lengkap — lihat yang belum masuk</summary><div class="hec-table-wrap"><table class="hec-table"><thead><tr><th>Kategori</th><th>Site</th><th>Titik</th><th>Target karena</th><th>Kelengkapan</th></tr></thead><tbody>
      ${inc.map(x=>`<tr class="st-${x.status}"><td>${AMB_KIND_LABEL[x.kind]}</td><td>${escHtml(x.p.site)}</td><td><b>${escHtml(x.p.nama)}</b></td><td class="muted">${escHtml(x.reason)}</td><td>${x.req.map(r=>`<span class="hec-chip ${x.have.includes(r)?"ok":"miss"}">${x.have.includes(r)?"&#10003;":"&#10007;"} ${escHtml(r)}</span>`).join("")}</td></tr>`).join("")}
      </tbody></table></div></details>` : `<div class="hec-allok">Semua titik target ambient di ${escHtml(c.periode)} sudah lengkap datanya.</div>`}
  </section>`;
  const d = document.getElementById("ambCompDetails"); if(d) d.addEventListener("toggle", ()=>{ ambCompOpen = d.open; });
}
document.addEventListener("change", e=>{ if(e.target.id==="ambCompPeriode"){ ambCompPeriode = e.target.value; renderAmbienCompleteness(); } });

Object.assign(ACTIONS, {importAmbienXlsx: ()=>importHasilAnyXlsx(), importHasilXlsx: ()=>importHasilAnyXlsx(), exportAmbienXlsx, downloadTemplateAmbien});
