/* =========================================================
   NAV
========================================================= */
function showPage(p){
  document.querySelectorAll(".page").forEach(el=>el.classList.remove("active"));
  document.querySelectorAll(".navbtn").forEach(el=>el.classList.remove("active"));
  document.getElementById("page-"+p).classList.add("active");
  document.querySelector('.navbtn[data-page="'+p+'"]').classList.add("active");
  renderPage(p);
  // Ganti halaman harus selalu mulai dari atas — tanpa ini, scroll position lama (dari halaman
  // sebelumnya) kebawa ke halaman baru karena yang scroll adalah window/body, bukan div per-halaman.
  window.scrollTo(0,0);
}
document.getElementById("navMenu").addEventListener("click", e=>{
  const b = e.target.closest(".navbtn"); if(!b) return;
  showPage(b.dataset.page);
});

// Collapse sidebar jadi rail ikon-saja — preferensi tampilan murni, disimpan terpisah dari DB
// (bukan bagian data yang di-export/restore) supaya tetap keingat tiap buka file ini lagi.
(function(){
  const sidebarEl = document.querySelector(".sidebar");
  const toggleBtn = document.getElementById("btnSidebarToggle");
  function setCollapsed(collapsed){
    sidebarEl.classList.toggle("collapsed", collapsed);
    toggleBtn.title = collapsed ? "Perluas menu" : "Ciutkan menu";
    localStorage.setItem("phmSidebarCollapsed", collapsed ? "1" : "0");
  }
  toggleBtn.addEventListener("click", ()=> setCollapsed(!sidebarEl.classList.contains("collapsed")));
  setCollapsed(localStorage.getItem("phmSidebarCollapsed")==="1");
})();

function updateMetaLine(){
  const el = document.getElementById("metaLine"); if(!el) return;
  el.innerHTML = `Semester ${escHtml(DB.meta.semester)} &middot; Tahun ${escHtml(DB.meta.tahun)} <span class="tag-pill" style="background:var(--teal-500);">${escHtml(currentPeriodStr())} aktif</span>`;
}
function renderPage(p){
  updateMetaLine();
  if(p==="dashboard") renderDashboard();
  if(p==="master") renderMaster();
  if(p==="rencana") renderRencana();
  if(p==="personil") renderPersonil();
  if(p==="rules") renderRules();
  if(p==="planner") renderPlanner();
  if(p==="gantt") renderGantt();
  if(p==="tracking") renderTracking();
  if(p==="runninghour") renderRunningHour();
  if(p==="hasildashboard") renderHasilDashboard();
  if(p==="hasildb") renderHasilDb();
  if(p==="riwayat") renderRiwayat();
  if(p==="lokasi") renderMap();
  if(p==="data") renderDataStatus();
  if(p==="beritaacara") renderBeritaAcara();
  syncStickyOffset(p);
}
// Ukur tinggi header sticky (.stickytop) halaman aktif lalu simpan sebagai custom property
// --stickyoffset di elemen halaman itu — dipakai .tree-head/.tree-subhead supaya nempel PAS
// di bawah header, bukan ketiban/ketimpa olehnya.
function syncStickyOffset(pageId){
  const pageEl = document.getElementById("page-"+pageId);
  if(!pageEl) return;
  const st = pageEl.querySelector(".stickytop");
  pageEl.style.setProperty("--stickyoffset", (st ? st.offsetHeight : 0)+"px");
}
function syncActiveStickyOffset(){
  const active = document.querySelector(".navbtn.active");
  if(active) syncStickyOffset(active.dataset.page);
}
window.addEventListener("resize", syncActiveStickyOffset);
// <details> di dalam .stickytop (mis. "Cara Pakai Singkat") bisa berubah tinggi saat dibuka/tutup —
// event "toggle" tidak bubble, jadi listener dipasang di fase capture supaya tetap kena walau
// targetnya di dalam halaman manapun.
document.addEventListener("toggle", e=>{
  if(e.target.closest && e.target.closest(".stickytop")) syncActiveStickyOffset();
}, true);

/* =========================================================
   UTIL
========================================================= */
function fmtDate(d){ if(!d) return "-"; return d; }
// Dibangun & dihitung murni pakai komponen UTC (Date.UTC/getUTCDate/getUTCDay) supaya hasilnya
// tidak tergantung timezone browser/OS. Sebelumnya pakai new Date(dateStr+"T00:00:00") lalu
// .toISOString() — di timezone UTC+ (mis. WITA/WIB), local-midnight itu jatuh ke tanggal UTC
// SEBELUMNYA, jadi addDays(x,1) sering balik ke tanggal yang sama (macet, tidak pernah maju).
function addDays(dateStr, n){
  const [y,m,d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m-1, d));
  dt.setUTCDate(dt.getUTCDate()+n);
  return dt.toISOString().slice(0,10);
}
function dayOfWeek(dateStr){
  const [y,m,d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m-1, d)).getUTCDay();
} // 0=Sun..6=Sat
const DOW_LABEL = ["Minggu","Senin","Selasa","Rabu","Kamis","Jumat","Sabtu"];
const MONTH_SHORT_ID = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];
function isBlocked(site, dateStr){
  const r = DB.siteRules[site]; if(!r || !r.blocked) return false;
  return r.blocked.some(b => dateStr >= b.start && dateStr <= b.end);
}
function isCrewChange(site, dateStr){
  const r = DB.siteRules[site]; if(!r || r.crewChangeDay==="" || r.crewChangeDay==null) return false;
  return dayOfWeek(dateStr) === Number(r.crewChangeDay);
}
// Crew change hanya masalah kalau jatuh di hari PERTAMA tim datang ke site (belum ada
// orang di sana untuk terima kedatangan). Kalau jatuh di tengah kunjungan, tim sudah di
// lokasi sehingga sampling tetap jalan seperti biasa — hanya "Hari Terhold" (site benar-benar
// tutup/shutdown) yang menghentikan hitungan hari kerja di tengah kunjungan.
function findValidStart(site, fromDateStr){
  let d = fromDateStr, iterations = 0;
  while((isBlocked(site,d) || isCrewChange(site,d)) && iterations < 730){ d = addDays(d,1); iterations++; }
  return d;
}
function daysBetweenInclusive(start,end){
  const s=new Date(start+"T00:00:00"), e=new Date(end+"T00:00:00");
  return Math.round((e-s)/86400000)+1;
}
function escHtml(s){ return (s==null?"":String(s)).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
// Baris mini progress-bar dipakai di beberapa panel ringkasan (Dashboard, S-Curve) — dua varian:
// "progress" (done/total, warna ikut persen) dan "distribusi" (count vs grand total, satu warna
// tetap per kategori) supaya makna angkanya jelas beda meski tampilannya mirip.
function progressBarRow(label, done, total, color){
  const pct = total? Math.round(done/total*100) : 0;
  const c = color || (pct===100?"var(--green-500)":pct>=50?"var(--teal-500)":"var(--amber-500)");
  return `<div style="margin-bottom:9px;">
    <div style="display:flex;justify-content:space-between;gap:8px;font-size:11px;margin-bottom:3px;"><span>${escHtml(label)}</span><b>${done}/${total} (${pct}%)</b></div>
    <div class="progressbar"><div style="width:${pct}%;background:${c};"></div></div>
  </div>`;
}
function distributionBarRow(label, count, grandTotal, color){
  const pct = grandTotal? Math.round(count/grandTotal*100) : 0;
  return `<div style="margin-bottom:9px;">
    <div style="display:flex;justify-content:space-between;gap:8px;font-size:11px;margin-bottom:3px;"><span>${escHtml(label)}</span><b>${count}</b></div>
    <div class="progressbar"><div style="width:${pct}%;background:${color||"var(--teal-500)"};"></div></div>
  </div>`;
}
function openModal(html, opts){
  document.getElementById("modalBox").innerHTML = html;
  document.getElementById("modalBox").classList.toggle("wide", !!(opts&&opts.wide));
  document.getElementById("overlay").classList.add("show");
}
function closeModal(){ document.getElementById("overlay").classList.remove("show"); document.getElementById("modalBox").innerHTML=""; document.getElementById("modalBox").classList.remove("wide"); }
document.getElementById("overlay").addEventListener("click", e=>{ if(e.target.id==="overlay") closeModal(); });

/* Custom toast/confirm — native alert()/confirm() can be blocked by locked-down corporate browser policies */
function toast(msg, type){
  const stack = document.getElementById("toastStack");
  const el = document.createElement("div");
  el.className = "toast"+(type?" "+type:"");
  el.textContent = msg;
  stack.appendChild(el);
  setTimeout(()=>{ el.style.transition="opacity .3s"; el.style.opacity="0"; setTimeout(()=>el.remove(),320); }, 4200);
}
function askConfirm(msg, onYes){
  openModal(`<h3>Konfirmasi</h3><p style="font-size:13px;color:var(--gray-700);">${escHtml(msg)}</p>
    <div class="actions">
      <button class="btn ghost" data-action="closeModal">Batal</button>
      <button class="btn primary" id="confirmYesBtn">Ya, Lanjutkan</button>
    </div>`);
  document.getElementById("confirmYesBtn").onclick = ()=>{ closeModal(); onYes(); };
}

/* =========================================================
   CSV HELPERS
========================================================= */
// Delimiter ";" (bukan ",") karena Windows locale Indonesia biasanya pakai koma sebagai
// pemisah desimal, sehingga Excel menjadikan ";" sebagai pemisah kolom CSV default — file akan
// otomatis kebuka rapi per kolom tanpa perlu "Text to Columns" manual, dan koma di dalam field
// (mis. daftar parameter "NOx, CO") tidak lagi ambigu karena bukan karakter pemisah.
const CSV_DELIM = ";";
function csvParse(text){
  const rows=[]; let row=[]; let cur=""; let inQ=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(inQ){
      if(c==='"'){ if(text[i+1]==='"'){cur+='"';i++;} else inQ=false; }
      else cur+=c;
    } else {
      if(c==='"') inQ=true;
      else if(c===CSV_DELIM){ row.push(cur); cur=""; }
      else if(c==='\n'){ row.push(cur); rows.push(row); row=[]; cur=""; }
      else if(c==='\r'){}
      else cur+=c;
    }
  }
  if(cur.length||row.length){ row.push(cur); rows.push(row); }
  if(!rows.length) return [];
  const headers = rows[0].map(h=>h.trim());
  return rows.slice(1).filter(r=>r.some(v=>v!=="")).map(r=>{
    const o={}; headers.forEach((h,i)=>o[h]=r[i]!==undefined?r[i].trim():""); return o;
  });
}
function csvCell(v){
  v = v==null?"":String(v);
  if(v.indexOf('"')>=0 || v.indexOf(CSV_DELIM)>=0 || v.indexOf("\n")>=0) return '"'+v.replace(/"/g,'""')+'"';
  return v;
}
function csvExport(headers, rows, filename){
  let out = headers.join(CSV_DELIM)+"\n";
  rows.forEach(r=>{ out += headers.map(h=>csvCell(r[h])).join(CSV_DELIM)+"\n"; });
  // BOM UTF-8 di depan WAJIB ada — tanpanya Excel (terutama locale Windows non-UTF8) salah
  // menebak encoding file sbg Windows-1252/ANSI, sehingga karakter khusus (en dash "–", simbol
  // derajat "°", superscript, dst) tampil sbg mojibake "â€“" dst padahal isi file aslinya benar.
  downloadBlob("﻿"+out, filename, "text/csv;charset=utf-8");
}
function downloadBlob(content, filename, mime){
  const blob = new Blob([content], {type:mime});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href=url; a.download=filename; document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

