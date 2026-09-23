/* =========================================================
   GERBANG AKSES — VISITOR vs STAF PHM
   ---------------------------------------------------------
   Halaman ini akan dibuka publik (bukan cuma internal PHM). Aplikasi SELALU langsung di-boot
   (bootApp() dipanggil TANPA nunggu gerbang resolve — lihat blok Bootstrap di bawah) supaya
   dashboard-nya kelihatan REDUP di belakang gerbang yang transparan, bukan layar gelap total.
   Data yg dimuat itu DEFAULT AMAN (disamarkan) selama belum terbukti staf PHM — lihat guard di
   migrateDB()/save()/applyUndoRedoState() (01-state.js): kode titik/cerobong & koordinat cuma
   ditampilkan APA ADANYA begitu gateState.mode==="phm" persis (bukan cuma "bukan visitor").

   Dua jalur di popup:
   - "Visitor/Tamu" -> SATU klik langsung lanjut (tanpa isi apapun) — data yg SUDAH kelihatan
     redup di belakang gerbang itu memang sudah tersamar sejak boot pertama, jadi tinggal
     sembunyikan gerbangnya saja.
   - "Staf PHM"     -> login user/password. Begitu benar, bootApp() dipanggil ULANG (re-load fresh
     dari localStorage) supaya data ASLI (bukan yg tadi kepalang tersamar di memori) yang tampil —
     localStorage sendiri TIDAK PERNAH tersentuh oleh proses masking (cuma DB in-memory yg diubah),
     jadi re-load ini otomatis balik ke data asli utuh.

   PENTING (sama spt gerbang password Budget, lihat 23-budget-proyeksi.js) — ini SEKADAR
   penyaring tampilan, BUKAN keamanan sungguhan: tools ini 100% client-side (HTML/JS statis di
   GitHub Pages), jadi siapapun yang buka source/DevTools bisa lihat username/password PHM di
   bawah ini apa adanya. Repo tempat aplikasi ini di-hosting PUBLIC, jadi file data mentah
   (default-data.js & backup .json di root repo) tetap bisa diunduh LANGSUNG oleh siapapun yg
   tahu caranya, terlepas dari gerbang ini. Cocok utk menyaring pengunjung kasual/awam, TIDAK
   cocok kalau tujuannya menyembunyikan data dari pihak yg niat & cukup teknis — sudah
   didiskusikan & disetujui pemilik tools ini secara eksplisit.

   Visitor TIDAK PERNAH menulis ke localStorage nyata (lihat guard "isRealPhmSession" di save()/
   applyUndoRedoState(), 01-state.js) — sesi visitor murni hidup di memori tab ini, hilang begitu
   reload, supaya kalau perangkat ini dipakai bersama, data ASLI staf PHM (kalau ada tersimpan di
   localStorage device yg sama) tidak pernah tertimpa/tercampur oleh sesi visitor manapun.
========================================================= */
const GATE_STORAGE_KEY = "phmAccessGate_v1";
const GATE_PHM_USERNAME = "phm.env-balikpapan";
const GATE_PHM_PASSWORD = "Balikpapan@123";
const GATE_CONTACT_NAME = "Ifan";
const GATE_CONTACT_EMAIL = "muhammad.afifani007@gmail.com";
const GATE_CONTACT_WA = "085259707649";

let gateState = null; // {mode:"visitor"|"phm", unlockedAt}

function loadGateState(){
  try{ const raw = localStorage.getItem(GATE_STORAGE_KEY); gateState = raw ? JSON.parse(raw) : null; }
  catch(e){ gateState = null; }
}
function saveGateState(){
  try{ localStorage.setItem(GATE_STORAGE_KEY, JSON.stringify(gateState)); }catch(e){ /* localStorage penuh/disabled -- gerbang akan tanya ulang next reload, bukan fatal */ }
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
        <button class="gate-choice-btn alt" data-action="gateChooseVisitor">
          <span class="gate-choice-title">Visitor / Tamu</span>
          <span class="gate-choice-desc">Lanjut lihat-lihat — kode titik &amp; koordinat disamarkan</span>
        </button>
      </div>
      ${gateContactNoteHtml()}
    </div>`;
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
function gateShowPhm(){ renderGatePhmForm(); }
function gateBack(){ renderGateChoice(); }
// Data di belakang gerbang SUDAH tersamar sejak boot pertama (lihat Bootstrap) -- tinggal catat
// pilihannya & sembunyikan gerbangnya, TIDAK perlu bootApp() ulang sama sekali.
function gateChooseVisitor(){
  gateState = {mode:"visitor", unlockedAt: new Date().toISOString()};
  saveGateState();
  const host = document.getElementById("accessGate");
  if(host) host.style.display = "none";
  renderGateStatusBadge();
  if(typeof checkRepoBackupUpdate==="function"){
    setTimeout(()=>{ checkRepoBackupUpdate(); }, 500);
  }
}
function gateSubmitPhm(){
  const user = document.getElementById("gatePhmUser").value.trim();
  const pass = document.getElementById("gatePhmPass").value;
  const errEl = document.getElementById("gatePhmError");
  if(user===GATE_PHM_USERNAME && pass===GATE_PHM_PASSWORD){
    gateState = {mode:"phm", unlockedAt: new Date().toISOString()};
    saveGateState();
    const host = document.getElementById("accessGate");
    if(host) host.style.display = "none";
    // Data yg lagi di memori (DB) masih versi TERSAMAR dari boot pertama -- bootApp() DIPANGGIL
    // ULANG di sini supaya load() re-parse FRESH dari localStorage (yg tidak pernah tersentuh
    // proses masking) jadi yg muncul persis data ASLI, bukan nyoba "unmask" di tempat (tidak bisa,
    // nilai aslinya sudah ketimpa di object DB yg lama).
    bootApp();
    renderGateStatusBadge();
    if(typeof checkRepoBackupUpdate==="function"){
      setTimeout(()=>{ checkRepoBackupUpdate(); }, 500);
    }
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
function renderGateStatusBadge(){
  const el = document.getElementById("gateStatusBadge");
  if(!el || !gateState) return;
  el.innerHTML = gateState.mode==="phm"
    ? `<span class="badge b-teal">Staf PHM</span><button class="btn small ghost" data-action="gateLogout">Keluar</button>`
    : `<span class="badge b-gray">Visitor</span><button class="btn small ghost" data-action="gateLogout">Keluar</button>`;
}
Object.assign(ACTIONS, {
  gateShowPhm, gateBack, gateChooseVisitor, gateSubmitPhm, gateLogout
});
document.addEventListener("keydown", e=>{
  if(e.key==="Enter" && e.target && (e.target.id==="gatePhmUser" || e.target.id==="gatePhmPass")) gateSubmitPhm();
});

/* ---------- Bootstrap ----------
   bootApp() SELALU dipanggil duluan, terlepas dari gerbang sudah resolve atau belum — supaya
   dashboard kelihatan (redup, lewat .access-gate yg transparan) di belakang popup, bukan layar
   gelap kosong. Amannya dijamin oleh default-mask di migrateDB() (01-state.js): selama gateState
   belum persis {mode:"phm"}, data yg baru dimuat OTOMATIS tersamar duluan SEBELUM sempat dirender
   — jadi apapun yg "bocor" keliatan redup di belakang gerbang pasti sudah aman. */
loadGateState();
bootApp();
if(gateState && gateState.mode==="phm"){
  // Sesi PHM sebelumnya di browser ini -- data yg baru di-load barusan sudah ASLI (migrateDB tidak
  // masking krn gateState.mode sudah "phm"), langsung sembunyikan gerbang, TIDAK auto-fetch lagi
  // (itu cuma dipicu sekali pas gerbang BARU di-resolve) supaya tidak mengganggu tiap reload halaman
  // di tengah kerja sehari-hari.
  const host = document.getElementById("accessGate");
  if(host) host.style.display = "none";
  renderGateStatusBadge();
} else if(gateState && gateState.mode==="visitor"){
  // Sesi visitor sebelumnya -- data yg baru di-load barusan otomatis sudah tersamar, tinggal
  // sembunyikan gerbangnya.
  const host = document.getElementById("accessGate");
  if(host) host.style.display = "none";
  renderGateStatusBadge();
} else {
  // Belum pernah pilih apa2 -- data yg baru di-load barusan otomatis tersamar (default aman),
  // tampilkan pilihan Visitor/Staf PHM di atas dashboard yg redup itu.
  renderGateChoice();
}
