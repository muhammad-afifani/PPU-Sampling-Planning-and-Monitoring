/* =========================================================
   GERBANG AKSES — VISITOR vs STAF PHM
   ---------------------------------------------------------
   Halaman ini akan dibuka publik (bukan cuma internal PHM). SEBELUM konten aplikasi apapun
   dirender, pengunjung wajib pilih salah satu jalur:
   - "Visitor"  -> isi nama + email singkat, lanjut LIHAT aplikasi tapi kode titik/cerobong &
                   koordinat DISAMARKAN (lihat applyVisitorDataMask, dipanggil dari migrateDB()
                   di 01-state.js tiap kali DB baru dimuat/diganti selama mode-nya visitor).
   - "Staf PHM" -> login user/password, lihat SELURUH data apa adanya.

   PENTING (sama spt gerbang password Budget, lihat 23-budget-proyeksi.js) — ini SEKADAR
   penyaring tampilan, BUKAN keamanan sungguhan: tools ini 100% client-side (HTML/JS statis di
   GitHub Pages), jadi siapapun yang buka source/DevTools bisa lihat username/password PHM di
   bawah ini apa adanya. Repo tempat aplikasi ini di-hosting PUBLIC, jadi file data mentah
   (default-data.js & backup .json di root repo) tetap bisa diunduh LANGSUNG oleh siapapun yg
   tahu caranya, terlepas dari gerbang ini. Cocok utk menyaring pengunjung kasual/awam, TIDAK
   cocok kalau tujuannya menyembunyikan data dari pihak yg niat & cukup teknis — sudah
   didiskusikan & disetujui pemilik tools ini secara eksplisit.

   Visitor TIDAK PERNAH menulis ke localStorage (lihat guard isVisitorSession di save()/
   applyUndoRedoState(), 01-state.js) — sesi visitor murni hidup di memori tab ini, hilang begitu
   reload, supaya kalau perangkat ini dipakai bersama, data ASLI staf PHM (kalau ada tersimpan di
   localStorage device yg sama) tidak pernah tertimpa/tercampur oleh sesi visitor manapun.
========================================================= */
const GATE_STORAGE_KEY = "phmAccessGate_v1";
const GATE_LOG_KEY = "phmVisitorLog_v1";
const GATE_PHM_USERNAME = "phm.env-balikpapan";
const GATE_PHM_PASSWORD = "Balikpapan@123";
const GATE_CONTACT_NAME = "Ifan";
const GATE_CONTACT_EMAIL = "muhammad.afifani007@gmail.com";
const GATE_CONTACT_WA = "085259707649";
// Isi endpoint Formspree (atau layanan form-to-email sejenis, daftar gratis) di sini kalau nanti
// mau notifikasi email OTOMATIS tiap ada visitor submit nama+email. Kosong = dilewati -- submission
// cuma dicatat lokal di browser visitor itu sendiri (GATE_LOG_KEY), TIDAK terkirim kemana-mana.
const VISITOR_NOTIFY_WEBHOOK_URL = "";

let gateState = null; // {mode:"visitor"|"phm", nama?, email?, unlockedAt}

function loadGateState(){
  try{ const raw = localStorage.getItem(GATE_STORAGE_KEY); gateState = raw ? JSON.parse(raw) : null; }
  catch(e){ gateState = null; }
}
function saveGateState(){
  try{ localStorage.setItem(GATE_STORAGE_KEY, JSON.stringify(gateState)); }catch(e){ /* localStorage penuh/disabled -- gerbang akan tanya ulang next reload, bukan fatal */ }
}
function logVisitorLocally(entry){
  try{
    const raw = localStorage.getItem(GATE_LOG_KEY);
    const list = raw ? JSON.parse(raw) : [];
    list.push(entry);
    localStorage.setItem(GATE_LOG_KEY, JSON.stringify(list.slice(-200)));
  }catch(e){ /* abaikan -- log lokal murni pelengkap, bukan sumber kebenaran */ }
}
function notifyVisitorWebhook(entry){
  if(!VISITOR_NOTIFY_WEBHOOK_URL) return;
  fetch(VISITOR_NOTIFY_WEBHOOK_URL, {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body: JSON.stringify({nama:entry.nama, email:entry.email, waktu:entry.waktu, halaman: location.href})
  }).catch(()=>{ /* diam-diam gagal (mis. offline) -- jangan blokir visitor cuma krn notifikasi gagal */ });
}

/* ---------- Penyamaran data mode visitor (dipanggil dari migrateDB(), 01-state.js) ----------
   p.id TETAP dipakai apa adanya sbg kunci internal di seluruh app (join/filter/cari titik) — yang
   disamarkan cuma p.nama (teks yg TAMPIL) & DB.pointCoords (koordinat), jadi SEMUA fitur lain
   (jadwal, tracking, hasil, chart, dst) tetap berfungsi normal, cuma labelnya generik. */
function applyVisitorDataMask(){
  if(!DB) return;
  if(Array.isArray(DB.points)){
    const sorted = DB.points.slice().sort((a,b)=>String(a.id).localeCompare(String(b.id)));
    sorted.forEach((p,i)=>{ p.nama = "TITIK-"+String(i+1).padStart(3,"0"); });
  }
  if(DB.pointCoords){ Object.keys(DB.pointCoords).forEach(k=>{ delete DB.pointCoords[k]; }); }
}

/* ---------- Render popup ---------- */
function gateContactNoteHtml(){
  const waDigits = GATE_CONTACT_WA.replace(/^0/,"62").replace(/[^0-9]/g,"");
  return `<div class="gate-contact-note">Butuh akses penuh (login staf PHM)? Hubungi <b>${escHtml(GATE_CONTACT_NAME)}</b> —
    <a href="mailto:${escHtml(GATE_CONTACT_EMAIL)}">${escHtml(GATE_CONTACT_EMAIL)}</a> ·
    WA <a href="https://wa.me/${escHtml(waDigits)}" target="_blank" rel="noopener noreferrer">${escHtml(GATE_CONTACT_WA)}</a></div>`;
}
function renderGateChoice(){
  const host = document.getElementById("accessGate"); if(!host) return;
  host.innerHTML = `
    <div class="gate-card">
      <div class="gate-logo"><img src="${LOGO_PHM_B64||""}" alt="Pertamina Hulu Mahakam" class="grayscale" onerror="this.style.display='none'"></div>
      <h2>Emission Sampling Planner &amp; Tracker</h2>
      <div class="gate-sub">Tools perencanaan &amp; pemantauan sampling emisi/ambient PT Pertamina Hulu Mahakam. Silakan pilih salah satu untuk melanjutkan:</div>
      <div class="gate-choice-row">
        <button class="gate-choice-btn" data-action="gateShowPhm">
          <span class="gate-choice-title">Staf PHM</span>
          <span class="gate-choice-desc">Login untuk lihat seluruh data apa adanya</span>
        </button>
        <button class="gate-choice-btn alt" data-action="gateShowVisitor">
          <span class="gate-choice-title">Visitor / Tamu</span>
          <span class="gate-choice-desc">Lihat-lihat tools ini — kode titik &amp; koordinat disamarkan</span>
        </button>
      </div>
      ${gateContactNoteHtml()}
    </div>`;
}
function renderGateVisitorForm(){
  const host = document.getElementById("accessGate"); if(!host) return;
  host.innerHTML = `
    <div class="gate-card">
      <button class="gate-back" data-action="gateBack" type="button">&larr; Kembali</button>
      <h2>Masuk sebagai Visitor</h2>
      <div class="gate-sub">Isi nama &amp; email singkat sebelum melihat-lihat. Kode titik/cerobong &amp; koordinat akan disamarkan — data asli hanya untuk staf PHM yang login.</div>
      <div class="field" style="margin-top:12px;"><label>Nama</label><input type="text" id="gateVisitorNama" placeholder="Nama Anda"></div>
      <div class="field" style="margin-top:10px;"><label>Email</label><input type="email" id="gateVisitorEmail" placeholder="nama@email.com"></div>
      <button class="btn primary btn-block" style="margin-top:14px;" data-action="gateSubmitVisitor">Lanjutkan sebagai Visitor</button>
      ${gateContactNoteHtml()}
    </div>`;
  setTimeout(()=>{ const el = document.getElementById("gateVisitorNama"); if(el) el.focus(); }, 50);
}
function renderGatePhmForm(){
  const host = document.getElementById("accessGate"); if(!host) return;
  host.innerHTML = `
    <div class="gate-card">
      <button class="gate-back" data-action="gateBack" type="button">&larr; Kembali</button>
      <h2>Login Staf PHM</h2>
      <div class="gate-sub">Masuk dengan akun yang diberikan untuk melihat seluruh data apa adanya.</div>
      <div class="field" style="margin-top:12px;"><label>Username</label><input type="text" id="gatePhmUser" autocomplete="username" placeholder="username"></div>
      <div class="field" style="margin-top:10px;"><label>Password</label><input type="password" id="gatePhmPass" autocomplete="current-password" placeholder="password"></div>
      <div class="gate-error" id="gatePhmError" style="display:none;"></div>
      <button class="btn primary btn-block" style="margin-top:14px;" data-action="gateSubmitPhm">Login</button>
      ${gateContactNoteHtml()}
    </div>`;
  setTimeout(()=>{ const el = document.getElementById("gatePhmUser"); if(el) el.focus(); }, 50);
}

/* ---------- Actions ---------- */
function gateShowVisitor(){ renderGateVisitorForm(); }
function gateShowPhm(){ renderGatePhmForm(); }
function gateBack(){ renderGateChoice(); }
function gateSubmitVisitor(){
  const nama = document.getElementById("gateVisitorNama").value.trim();
  const email = document.getElementById("gateVisitorEmail").value.trim();
  if(!nama){ toast("Nama wajib diisi.","err"); return; }
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ toast("Format email tidak valid.","err"); return; }
  const entry = {nama, email, waktu: new Date().toISOString()};
  logVisitorLocally(entry);
  notifyVisitorWebhook(entry);
  gateState = {mode:"visitor", nama, email, unlockedAt: entry.waktu};
  saveGateState();
  gateResolve();
}
function gateSubmitPhm(){
  const user = document.getElementById("gatePhmUser").value.trim();
  const pass = document.getElementById("gatePhmPass").value;
  const errEl = document.getElementById("gatePhmError");
  if(user===GATE_PHM_USERNAME && pass===GATE_PHM_PASSWORD){
    gateState = {mode:"phm", unlockedAt: new Date().toISOString()};
    saveGateState();
    gateResolve();
  } else if(errEl){
    errEl.textContent = "Username atau password salah.";
    errEl.style.display = "block";
  }
}
function gateLogout(){
  askConfirm("Keluar dari sesi ini? Anda perlu login/pilih visitor lagi untuk melanjutkan.", ()=>{
    gateState = null;
    try{ localStorage.removeItem(GATE_STORAGE_KEY); }catch(e){}
    location.reload();
  });
}
// Dipanggil HANYA dari submit visitor/PHM (baru pertama kali resolve gerbang, bukan resume sesi
// dari localStorage) -- makanya auto-fetch data terbaru repo dipicu di sini saja.
function gateResolve(){
  const host = document.getElementById("accessGate");
  if(host) host.style.display = "none";
  bootApp();
  renderGateStatusBadge();
  if(typeof checkRepoBackupUpdate==="function"){
    setTimeout(()=>{ checkRepoBackupUpdate(); }, 500);
  }
}
function renderGateStatusBadge(){
  const el = document.getElementById("gateStatusBadge");
  if(!el || !gateState) return;
  el.innerHTML = gateState.mode==="phm"
    ? `<span class="badge b-teal">Staf PHM</span><button class="btn small ghost" data-action="gateLogout">Keluar</button>`
    : `<span class="badge b-gray" title="${escHtml(gateState.email||"")}">Visitor${gateState.nama?": "+escHtml(gateState.nama):""}</span><button class="btn small ghost" data-action="gateLogout">Keluar</button>`;
}
Object.assign(ACTIONS, {
  gateShowVisitor, gateShowPhm, gateBack, gateSubmitVisitor, gateSubmitPhm, gateLogout
});
document.addEventListener("keydown", e=>{
  if(e.key!=="Enter") return;
  if(e.target && (e.target.id==="gateVisitorNama" || e.target.id==="gateVisitorEmail")) gateSubmitVisitor();
  if(e.target && (e.target.id==="gatePhmUser" || e.target.id==="gatePhmPass")) gateSubmitPhm();
});

/* ---------- Bootstrap ---------- */
loadGateState();
if(gateState && (gateState.mode==="visitor" || gateState.mode==="phm")){
  // Sesi sebelumnya di browser ini sudah resolve -- langsung boot, TIDAK auto-fetch data terbaru
  // lagi (itu cuma dipicu sekali pas gerbang BARU diisi, lihat gateResolve()) supaya tidak
  // mengganggu tiap kali reload halaman di tengah kerja sehari-hari.
  const host = document.getElementById("accessGate");
  if(host) host.style.display = "none";
  bootApp();
  renderGateStatusBadge();
} else {
  renderGateChoice();
}
