/* =========================================================
   UI EXPERIENCE LAYER — topbar, palet perintah, drawer mobile, reveal-on-scroll, suara opsional
   ---------------------------------------------------------
   Lapisan presentasi murni, dimuat PALING TERAKHIR. Prinsipnya:
   - TIDAK membungkus/mengganti fungsi app mana pun (showPage, toast, openModal, dst). State app
     cuma DIBACA lewat MutationObserver (menu aktif, label periode, tema, toast baru).
   - Semua aksi dari topbar & palet perintah diteruskan sbg klik ke tombol/aksi yang SUDAH ada
     (.navbtn, #btnThemeToggle, [data-action=openPeriodModal], #btnUndo, ...), jadi jalurnya sama
     persis dgn klik manual & tidak ada logika bisnis yang diduplikasi.
   - Preferensi tampilan (suara) disimpan di localStorage key sendiri ("phmSound"), terpisah dari
     DB — pola yang sama dgn phmTheme/phmSidebarCollapsed di 02-nav-util.js.
========================================================= */
(function(){
  "use strict";
  const $ = id => document.getElementById(id);
  const reduceMotion = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : {matches:false};
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const gateOpen = ()=>{ const g = $("accessGate"); return !!g && getComputedStyle(g).display!=="none"; };

  /* ---------- Suara (Web Audio, disintesis — tanpa file audio, OFF secara default) ----------
     AudioContext baru dibuat di dalam gesture user (pointerdown/keydown) supaya patuh aturan
     autoplay browser; tidak pernah ada bunyi saat halaman dimuat. Toast yang muncul sebelum user
     berinteraksi (mis. cek backup otomatis) otomatis dilewati tanpa bunyi. */
  const SOUND_KEY = "phmSound";
  const Sound = (function(){
    const AC = window.AudioContext || window.webkitAudioContext;
    let enabled = false, ctx = null, out = null, noiseBuf = null, lastAt = 0;
    try{ enabled = localStorage.getItem(SOUND_KEY)==="1"; }catch(e){ /* storage diblokir — tetap mati */ }
    function unlock(){
      if(!enabled || !AC) return;
      try{
        if(!ctx){
          ctx = new AC();
          const comp = ctx.createDynamicsCompressor();
          out = ctx.createGain(); out.gain.value = 0.9;
          out.connect(comp); comp.connect(ctx.destination);
          // 0,25 dtk white noise sekali buat — dipakai ulang utk bunyi "thock" & "whoosh".
          noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate*0.25), ctx.sampleRate);
          const d = noiseBuf.getChannelData(0); for(let i=0;i<d.length;i++) d[i] = Math.random()*2-1;
        }
        if(ctx.state==="suspended") ctx.resume().catch(()=>{});
      }catch(e){ ctx = null; }
    }
    function env(g, t, peak, dur, attack){
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t+(attack||0.006));
      g.gain.exponentialRampToValueAtTime(0.0001, t+dur);
    }
    function tone(o){
      const t = ctx.currentTime + (o.delay||0) + 0.005, dur = o.dur||0.1;
      const osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = o.type || "sine";
      osc.frequency.setValueAtTime(o.f, t);
      if(o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t+(o.sweep||dur));
      env(g, t, o.gain||0.05, dur, o.attack);
      osc.connect(g); g.connect(out);
      osc.start(t); osc.stop(t+dur+0.02);
    }
    // Noise lewat band-pass — frekuensi bisa disapu (from→to) utk efek "whoosh".
    function noise(o){
      const t = ctx.currentTime + (o.delay||0) + 0.005, dur = o.dur||0.05;
      const src = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
      src.buffer = noiseBuf; bp.type = "bandpass"; bp.Q.value = o.q||1.2;
      bp.frequency.setValueAtTime(o.f, t);
      if(o.to) bp.frequency.exponentialRampToValueAtTime(o.to, t+dur);
      env(g, t, o.gain||0.03, dur, o.attack||0.01);
      src.connect(bp); bp.connect(g); g.connect(out);
      src.start(t); src.stop(t+dur+0.02);
    }
    // Palet suara — tiap JENIS kontrol punya karakter sendiri supaya telinga bisa membedakan
    // "pindah halaman" vs "pindah tab di dalam halaman" vs "aksi", tanpa perlu melihat layar.
    const voices = {
      nav(){ tone({f:420, to:1350, dur:0.11, sweep:0.07, gain:0.05}); tone({f:2600, dur:0.03, gain:0.008, delay:0.012}); },   // tetesan air "bloop" — menu sidebar
      groupOpen(){ tone({f:300, to:460, type:"triangle", dur:0.09, gain:0.035}); },                                           // buka grup menu
      groupClose(){ tone({f:460, to:290, type:"triangle", dur:0.09, gain:0.032}); },                                          // tutup grup menu
      tab(){ tone({f:2350, type:"triangle", dur:0.028, gain:0.024}); tone({f:1180, dur:0.04, gain:0.016}); },                  // tick tajam — tab di dalam halaman
      seg(){ tone({f:1650, type:"triangle", dur:0.03, gain:0.022}); },                                                         // tick rendah — segmented control
      chipOn(){ tone({f:880, to:1320, dur:0.06, gain:0.03}); },                                                               // pop naik — chip/filter aktif
      chipOff(){ tone({f:1150, to:720, dur:0.06, gain:0.026}); },                                                             // pop turun — chip/filter mati
      press(){ noise({f:1900, dur:0.025, gain:0.035, q:0.9}); tone({f:230, to:140, dur:0.08, gain:0.05}); },                   // "thock" — tombol aksi utama
      tap(){ tone({f:1500, to:950, type:"triangle", dur:0.04, gain:0.02}); },                                                 // ketuk lembut — tombol sekunder
      slide(){ noise({f:500, to:2400, dur:0.2, gain:0.03, q:0.7}); },                                                         // whoosh — ciutkan/perluas sidebar
      open(){ noise({f:700, to:1900, dur:0.14, gain:0.018, q:0.8}); tone({f:520, to:780, dur:0.12, gain:0.022}); },            // modal/palet terbuka
      close(){ noise({f:1700, to:650, dur:0.12, gain:0.016, q:0.8}); tone({f:700, to:470, dur:0.1, gain:0.018}); },            // modal/palet tertutup
      themeDark(){ tone({f:784, dur:0.09, gain:0.03}); tone({f:523, dur:0.16, gain:0.03, delay:0.07}); },
      themeLight(){ tone({f:523, dur:0.09, gain:0.03}); tone({f:784, dur:0.16, gain:0.03, delay:0.07}); },
      success(){ tone({f:784, dur:0.12, gain:0.045}); tone({f:1175, dur:0.22, gain:0.04, delay:0.075}); },
      error(){ tone({f:330, to:290, type:"triangle", dur:0.14, gain:0.055}); tone({f:220, type:"triangle", dur:0.2, gain:0.05, delay:0.12}); },
      on(){ tone({f:660, dur:0.08, gain:0.04}); tone({f:990, dur:0.14, gain:0.035, delay:0.06}); },
    };
    const FEEDBACK = {success:1, error:1, on:1};
    function play(name){
      if(!enabled || !ctx || ctx.state!=="running" || !voices[name]) return;
      // Bunyi UI berturut-turut dibatasi (mis. klik ganda/klik cepat) supaya tidak menumpuk;
      // bunyi umpan balik hasil operasi (sukses/eror) selalu lolos.
      if(!FEEDBACK[name]){ const n = performance.now(); if(n-lastAt < 55) return; lastAt = n; }
      try{ voices[name](); }catch(e){ /* audio gagal = diam saja, bukan error app */ }
    }
    function setEnabled(v){
      enabled = !!v;
      try{ localStorage.setItem(SOUND_KEY, enabled ? "1" : "0"); }catch(e){}
      if(enabled){ unlock(); setTimeout(()=>play("on"), 30); }
    }
    return { play, unlock, setEnabled, get enabled(){ return enabled; }, supported: !!AC };
  })();

  const soundBtn = $("uxSoundToggle");
  function syncSoundBtn(){
    if(!soundBtn) return;
    const on = Sound.enabled;
    soundBtn.setAttribute("aria-pressed", on ? "true" : "false");
    soundBtn.title = !Sound.supported ? "Browser ini tidak mendukung suara antarmuka"
      : on ? "Suara antarmuka: nyala (klik untuk mematikan)" : "Suara antarmuka: mati (klik untuk menyalakan)";
    soundBtn.setAttribute("aria-label", on ? "Matikan suara antarmuka" : "Nyalakan suara antarmuka");
    soundBtn.querySelector(".ms-icon").innerHTML = msIcon(on ? "volume-2" : "volume-x", 17);
    soundBtn.disabled = !Sound.supported;
  }
  function toggleSound(){ Sound.setEnabled(!Sound.enabled); syncSoundBtn(); flip(soundBtn); }
  if(soundBtn) soundBtn.addEventListener("click", toggleSound);
  syncSoundBtn();

  // Klasifikasi kontrol → suara. Hanya kontrol yang disengaja diklik; hover/scroll/sel tabel
  // tidak berbunyi supaya tidak repetitif. State chip dibaca SEBELUM klik diproses app
  // (pointerdown), jadi "aktif" berarti klik ini akan mematikannya.
  function soundFor(t){
    if(!t || !t.closest || t.closest("[disabled]")) return null;
    if(t.closest("#uxSoundToggle")) return null;
    if(t.closest("#navMenu .navbtn")) return t.closest(".navbtn").classList.contains("active") ? "tap" : "nav";
    const gh = t.closest(".navgroup-head"); if(gh) return gh.closest(".navgroup").classList.contains("closed") ? "groupOpen" : "groupClose";
    if(t.closest("#btnSidebarToggle")) return "slide";
    if(t.closest("#btnThemeToggle, #uxThemeBtn")) return document.documentElement.getAttribute("data-theme")==="dark" ? "themeLight" : "themeDark";
    if(t.closest(".hd-tab, .dp-tab, .sim-param-tabs button, [role=tab]")) return "tab";
    if(t.closest(".hd-seg-group button, .dp-seg .btn")) return "seg";
    const chip = t.closest(".chip-toggle, .sc-chip");
    if(chip) return (chip.classList.contains("active") || chip.classList.contains("on")) ? "chipOff" : "chipOn";
    if(t.closest(".ux-cmd-item")) return "nav";
    if(t.closest(".btn.primary, .gate-choice-btn, .hd-btn-solid")) return "press";
    if(t.closest(".btn, .ux-icon-btn, .hd-btn-outline, .theme-toggle, .ux-search")) return "tap";
    return null;
  }
  document.addEventListener("pointerdown", e=>{
    Sound.unlock();
    if(e.button===0) Sound.play(soundFor(e.target));
  }, true);
  document.addEventListener("keydown", e=>{
    Sound.unlock();
    if((e.key==="Enter"||e.key===" ") && !(e.target.matches && e.target.matches("input,textarea,select"))) Sound.play(soundFor(e.target));
  }, true);
  // Modal (#overlay) & palet perintah: bunyi buka/tutup mengikuti perubahan state nyata.
  const overlayEl = $("overlay");
  if(overlayEl && window.MutationObserver){
    let wasShown = overlayEl.classList.contains("show");
    new MutationObserver(()=>{
      const shown = overlayEl.classList.contains("show");
      if(shown!==wasShown){ wasShown = shown; Sound.play(shown ? "open" : "close"); }
    }).observe(overlayEl, {attributes:true, attributeFilter:["class"]});
  }
  // Bunyi konfirmasi/eror mengikuti toast yang BENAR-BENAR dimunculkan app (sesudah operasinya
  // selesai) — jadi tidak pernah ada bunyi "sukses" sebelum operasinya sukses.
  const stack = $("toastStack");
  if(stack && window.MutationObserver){
    new MutationObserver(muts=>{
      for(const m of muts) for(const n of m.addedNodes){
        if(!(n instanceof HTMLElement) || !n.classList.contains("toast") || n.classList.contains("toast-progress")) continue;
        if(n.classList.contains("err")) Sound.play("error");
        else if(n.classList.contains("ok")) Sound.play("success");
      }
    }).observe(stack, {childList:true});
  }

  function flip(btn){
    if(!btn || reduceMotion.matches) return;
    btn.classList.remove("ux-flip"); void btn.offsetWidth; btn.classList.add("ux-flip");
  }

  /* ---------- Topbar: breadcrumb, periode, tema, jam ---------- */
  const crumbGroup = $("uxCrumbGroup"), crumbPage = $("uxCrumbPage");
  let lastPage = null;
  function activeNav(){ return document.querySelector("#navMenu .navbtn.active"); }
  function groupLabel(btn){
    const head = btn && btn.closest(".navgroup") && btn.closest(".navgroup").querySelector(".navgroup-head span");
    return head ? head.textContent.trim() : "Ringkasan";
  }
  function onPageChange(){
    const btn = activeNav();
    if(!btn){ Liquid.place(null); return; }
    const page = btn.dataset.page;
    // Perubahan class lain di menu (grup dibuka/tutup, filter cari menu, rail diciutkan) → pill
    // cukup disesuaikan posisinya tanpa animasi alir.
    if(page===lastPage){ Liquid.place(btn); return; }
    const firstRun = lastPage===null;
    lastPage = page;
    if(crumbGroup) crumbGroup.textContent = groupLabel(btn);
    if(crumbPage){
      crumbPage.textContent = btn.dataset.label || btn.textContent.trim();
      crumbPage.style.animation = "none"; void crumbPage.offsetWidth; crumbPage.style.animation = "";
    }
    closeDrawer();
    keepNavItemVisible(btn);
    if(firstRun) Liquid.place(btn); else Liquid.move(btn);
    armReveal($("page-"+page));
    Motion.finishCounts();
    if(!gateOpen()) Motion.enter($("page-"+page));
    updateScrollProgress();
  }
  // Item menu aktif selalu terlihat di daftar menu sidebar (mis. dibuka dari palet perintah atau
  // tautan antar-halaman). Sengaja mengatur scrollTop <nav> saja, BUKAN scrollIntoView — yang itu
  // bisa ikut menggeser scroll window yang baru di-reset showPage() ke atas.
  function keepNavItemVisible(btn){
    const list = $("navMenu"); if(!list || !btn.offsetParent) return;
    const lr = list.getBoundingClientRect(), br = btn.getBoundingClientRect(), pad = 12;
    if(br.top < lr.top + pad) list.scrollTop -= (lr.top + pad) - br.top;
    else if(br.bottom > lr.bottom - pad) list.scrollTop += br.bottom - (lr.bottom - pad);
  }
  let pageChangeQueued = false;
  const navMenu = $("navMenu");
  if(navMenu && window.MutationObserver){
    new MutationObserver(muts=>{
      // Mutasi dari layer pill sendiri (class ux-goo/ux-off) diabaikan supaya tidak memicu ulang.
      if(!muts.some(m=>!Liquid.owns(m.target))) return;
      if(pageChangeQueued) return; pageChangeQueued = true;
      requestAnimationFrame(()=>{ pageChangeQueued = false; onPageChange(); });
    }).observe(navMenu, {attributes:true, subtree:true, attributeFilter:["class"]});
  }

  const periodLabel = $("uxPeriodLabel"), periodSrc = $("periodActiveTagWrap");
  function syncPeriod(){
    if(!periodLabel || !periodSrc) return;
    const txt = periodSrc.textContent.replace(/\s+/g," ").trim();
    // "S2 2026 aktif" → akhiran "aktif" dipisah supaya bisa disembunyikan di layar sempit.
    const m = txt.match(/^(.*?)(\s+aktif)$/i);
    periodLabel.innerHTML = !txt ? "Periode aktif" : m ? escHtml(m[1]) + `<span class="ux-period-sfx">${escHtml(m[2])}</span>` : escHtml(txt);
  }
  if(periodSrc && window.MutationObserver) new MutationObserver(syncPeriod).observe(periodSrc, {childList:true, subtree:true, characterData:true});
  syncPeriod();

  const themeBtn = $("uxThemeBtn");
  function syncThemeBtn(){
    if(!themeBtn) return;
    const isDark = document.documentElement.getAttribute("data-theme")==="dark";
    // Sama dgn konvensi toggle asli: ikon = TUJUAN sekali klik (bulan = pindah ke gelap).
    themeBtn.querySelector(".ms-icon").innerHTML = msIcon(isDark ? "sun" : "moon", 17);
    themeBtn.title = isDark ? "Ganti ke tema terang" : "Ganti ke tema gelap";
    themeBtn.setAttribute("aria-label", themeBtn.title);
  }
  if(themeBtn){
    themeBtn.addEventListener("click", ()=>{ const b = $("btnThemeToggle"); if(b) b.click(); flip(themeBtn); });
    new MutationObserver(syncThemeBtn).observe(document.documentElement, {attributes:true, attributeFilter:["data-theme"]});
    syncThemeBtn();
  }

  const clockEl = $("uxClock");
  const fmtDay = new Intl.DateTimeFormat("id-ID", {weekday:"short", day:"numeric", month:"short"});
  const fmtTime = new Intl.DateTimeFormat("id-ID", {hour:"2-digit", minute:"2-digit", hour12:false});
  function tickClock(){
    if(!clockEl) return;
    const now = new Date();
    clockEl.textContent = fmtDay.format(now) + " · " + fmtTime.format(now);
    setTimeout(tickClock, 60000 - (now.getSeconds()*1000 + now.getMilliseconds()) + 50);
  }
  tickClock();

  /* ---------- Drawer navigasi mobile (≤900px) ---------- */
  const menuBtn = $("uxMenuBtn"), scrim = $("uxScrim");
  const mqDrawer = window.matchMedia("(max-width:900px)");
  function openDrawer(){
    document.body.classList.add("ux-nav-open");
    Sound.play("slide");
    if(menuBtn){ menuBtn.setAttribute("aria-expanded","true"); menuBtn.setAttribute("aria-label","Tutup menu navigasi"); }
    setTimeout(()=>{ const a = activeNav() || document.querySelector("#navMenu .navbtn"); if(a) a.focus({preventScroll:false}); }, 60);
  }
  function closeDrawer(){
    if(!document.body.classList.contains("ux-nav-open")) return;
    document.body.classList.remove("ux-nav-open");
    if(menuBtn){ menuBtn.setAttribute("aria-expanded","false"); menuBtn.setAttribute("aria-label","Buka menu navigasi"); }
  }
  if(menuBtn) menuBtn.addEventListener("click", ()=> document.body.classList.contains("ux-nav-open") ? closeDrawer() : openDrawer());
  if(scrim) scrim.addEventListener("click", closeDrawer);
  // Tombol di brand sidebar (Ubah Periode, Info, dst) membuka modal — drawer ditutup supaya modal
  // tidak tertumpuk di belakang drawer; klik menu (.navbtn) juga menutup drawer, termasuk saat
  // halaman yang diklik sudah aktif (onPageChange tidak terpicu krn halamannya tidak berubah).
  document.querySelector(".sidebar").addEventListener("click", e=>{
    if(mqDrawer.matches && e.target.closest("[data-action], .navbtn")) closeDrawer();
  });
  const onDrawerMq = e=>{ if(!e.matches) closeDrawer(); };
  if(mqDrawer.addEventListener) mqDrawer.addEventListener("change", onDrawerMq); else mqDrawer.addListener(onDrawerMq);

  /* ---------- Palet perintah (Ctrl/⌘+K) ---------- */
  const cmdOpenBtn = $("uxCmdOpen");
  const kbd = $("uxCmdKbd"); if(kbd) kbd.textContent = isMac ? "⌘ K" : "Ctrl K";
  if(cmdOpenBtn) cmdOpenBtn.title = "Cari halaman & perintah (" + (isMac ? "⌘K" : "Ctrl+K") + ")";
  const cmd = document.createElement("div");
  cmd.className = "ux-cmd"; cmd.id = "uxCmd";
  cmd.setAttribute("role","dialog"); cmd.setAttribute("aria-modal","true"); cmd.setAttribute("aria-label","Cari halaman dan perintah");
  cmd.innerHTML = `<div class="ux-cmd-box">
      <div class="ux-cmd-head">${msIcon("search",17)}
        <input class="ux-cmd-input" id="uxCmdInput" type="text" placeholder="Ketik nama halaman atau perintah…" autocomplete="off" spellcheck="false"
          role="combobox" aria-expanded="true" aria-controls="uxCmdList" aria-autocomplete="list">
        <kbd class="ux-kbd">Esc</kbd></div>
      <div class="ux-cmd-list" id="uxCmdList" role="listbox"></div>
      <div class="ux-cmd-foot"><span><kbd class="ux-kbd">↑</kbd><kbd class="ux-kbd">↓</kbd>pilih</span><span><kbd class="ux-kbd">Enter</kbd>buka</span><span><kbd class="ux-kbd">Esc</kbd>tutup</span></div>
    </div>`;
  document.body.appendChild(cmd);
  const cmdInput = $("uxCmdInput"), cmdList = $("uxCmdList");
  let cmdItems = [], cmdShown = [], cmdSel = 0, cmdReturnFocus = null;

  function clickIfEnabled(el){ if(el && !el.disabled) el.click(); }
  function buildCmdItems(){
    const items = [];
    document.querySelectorAll("#navMenu .navbtn").forEach(btn=>{
      const ico = btn.querySelector(".navbtn-icon");
      items.push({
        section:"Halaman", label: btn.dataset.label || btn.textContent.trim(), meta: groupLabel(btn),
        icon: ico ? ico.dataset.icon : "file-text", current: btn.classList.contains("active"),
        run(){ const g = btn.closest(".navgroup"); if(g) g.classList.remove("closed"); btn.click(); },
      });
    });
    const undo = $("btnUndo"), redo = $("btnRedo"), themeLbl = $("themeToggleLabel");
    items.push(
      {section:"Perintah", label:"Ubah Periode Aktif", meta:"Periode", icon:"calendar", run(){ clickIfEnabled(document.querySelector('.sidebar [data-action="openPeriodModal"]')); }},
      {section:"Perintah", label:"Info & Panduan Setup", meta:"Bantuan", icon:"book-open", run(){ clickIfEnabled(document.querySelector('.sidebar [data-action="openAboutModal"]')); }},
      {section:"Perintah", label:"Undo perubahan terakhir", meta: undo && undo.disabled ? "tidak ada" : "Riwayat", icon:"history", disabled: !undo || undo.disabled, run(){ clickIfEnabled(undo); }},
      {section:"Perintah", label:"Redo perubahan", meta: redo && redo.disabled ? "tidak ada" : "Riwayat", icon:"refresh-cw", disabled: !redo || redo.disabled, run(){ clickIfEnabled(redo); }},
      {section:"Perintah", label: themeLbl ? "Ganti ke " + themeLbl.textContent.trim() : "Ganti tema", meta:"Tampilan", icon: document.documentElement.getAttribute("data-theme")==="dark" ? "sun" : "moon", run(){ clickIfEnabled($("btnThemeToggle")); }},
      {section:"Perintah", label: Sound.enabled ? "Matikan suara antarmuka" : "Nyalakan suara antarmuka", meta:"Tampilan", icon: Sound.enabled ? "volume-x" : "volume-2", disabled: !Sound.supported, run(){ toggleSound(); }},
    );
    return items;
  }
  function scoreOf(label, q){
    const l = label.toLowerCase();
    if(!q) return 1;
    if(l.startsWith(q)) return 4;
    if(l.split(/[\s/&()-]+/).some(w=>w.startsWith(q))) return 3;
    if(l.includes(q)) return 2;
    let i = 0; for(const ch of l){ if(ch===q[i]) i++; if(i===q.length) return 1; }
    return 0;
  }
  function hl(label, q){
    const safe = escHtml(label);
    if(!q) return safe;
    const i = label.toLowerCase().indexOf(q);
    if(i<0) return safe;
    return escHtml(label.slice(0,i)) + "<mark>" + escHtml(label.slice(i, i+q.length)) + "</mark>" + escHtml(label.slice(i+q.length));
  }
  function renderCmd(){
    const q = cmdInput.value.trim().toLowerCase();
    cmdShown = cmdItems.map(it=>({it, s: Math.max(scoreOf(it.label, q), scoreOf(it.meta, q)/2)}))
      .filter(x=>x.s>0 && !x.it.disabled)
      .sort((a,b)=> q ? b.s-a.s : 0)
      .map(x=>x.it);
    if(cmdSel >= cmdShown.length) cmdSel = Math.max(0, cmdShown.length-1);
    if(!cmdShown.length){ cmdList.innerHTML = `<div class="ux-cmd-empty">Tidak ada halaman atau perintah yang cocok dengan “${escHtml(cmdInput.value.trim())}”.</div>`; cmdInput.removeAttribute("aria-activedescendant"); return; }
    let html = "", sec = null;
    cmdShown.forEach((it, i)=>{
      if(!q && it.section!==sec){ sec = it.section; html += `<div class="ux-cmd-sec" role="presentation">${escHtml(sec)}</div>`; }
      html += `<button type="button" class="ux-cmd-item${i===cmdSel?" sel":""}${it.current?" cur":""}" id="uxCmdOpt${i}" role="option" aria-selected="${i===cmdSel}" data-i="${i}" tabindex="-1">
        <span class="ux-cmd-ico">${msIcon(it.icon, 15)}</span><span class="ux-cmd-label">${hl(it.label, q)}</span>
        <span class="ux-cmd-meta">${escHtml(it.meta)}</span><span class="ux-cmd-enter">${msIcon("corner-down-left", 14)}</span></button>`;
    });
    cmdList.innerHTML = html;
    cmdInput.setAttribute("aria-activedescendant", "uxCmdOpt"+cmdSel);
  }
  function moveSel(d){
    if(!cmdShown.length) return;
    cmdSel = (cmdSel + d + cmdShown.length) % cmdShown.length;
    cmdList.querySelectorAll(".ux-cmd-item").forEach(el=>{ const on = +el.dataset.i===cmdSel; el.classList.toggle("sel", on); el.setAttribute("aria-selected", on); });
    cmdInput.setAttribute("aria-activedescendant", "uxCmdOpt"+cmdSel);
    const el = $("uxCmdOpt"+cmdSel); if(el) el.scrollIntoView({block:"nearest"});
  }
  function openCmd(){
    if(gateOpen() || $("overlay").classList.contains("show")) return;
    closeDrawer();
    cmdReturnFocus = document.activeElement;
    cmdItems = buildCmdItems();
    const cur = cmdItems.findIndex(it=>it.current);
    cmdInput.value = ""; cmdSel = cur>=0 ? cur : 0;
    renderCmd();
    cmd.classList.add("show");
    Sound.play("open");
    cmdOpenBtn && cmdOpenBtn.setAttribute("aria-expanded","true");
    setTimeout(()=>{ cmdInput.focus(); moveSel(0); }, 0);
  }
  function closeCmd(restore, silent){
    if(!cmd.classList.contains("show")) return;
    cmd.classList.remove("show");
    if(!silent) Sound.play("close");
    cmdOpenBtn && cmdOpenBtn.setAttribute("aria-expanded","false");
    if(restore!==false && cmdReturnFocus && cmdReturnFocus.focus) cmdReturnFocus.focus({preventScroll:true});
  }
  function runSel(i){
    const it = cmdShown[i]; if(!it) return;
    closeCmd(false, true);
    Sound.play(it.section==="Halaman" ? "nav" : "tap");
    it.run();
  }
  if(cmdOpenBtn){ cmdOpenBtn.setAttribute("aria-expanded","false"); cmdOpenBtn.addEventListener("click", openCmd); }
  cmdInput.addEventListener("input", ()=>{ cmdSel = 0; renderCmd(); });
  cmdInput.addEventListener("keydown", e=>{
    if(e.key==="ArrowDown"){ e.preventDefault(); moveSel(1); }
    else if(e.key==="ArrowUp"){ e.preventDefault(); moveSel(-1); }
    else if(e.key==="Enter"){ e.preventDefault(); runSel(cmdSel); }
    else if(e.key==="Tab"){ e.preventDefault(); moveSel(e.shiftKey ? -1 : 1); }
  });
  cmdList.addEventListener("mousemove", e=>{
    const el = e.target.closest(".ux-cmd-item"); if(!el || +el.dataset.i===cmdSel) return;
    cmdSel = +el.dataset.i; moveSel(0);
  });
  cmdList.addEventListener("click", e=>{ const el = e.target.closest(".ux-cmd-item"); if(el) runSel(+el.dataset.i); });
  cmd.addEventListener("mousedown", e=>{ if(e.target===cmd) closeCmd(); });

  document.addEventListener("keydown", e=>{
    if((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key==="k" || e.key==="K")){
      if(gateOpen()) return;
      e.preventDefault();
      cmd.classList.contains("show") ? closeCmd() : openCmd();
      return;
    }
    if(e.key==="Escape"){
      if(cmd.classList.contains("show")){ e.preventDefault(); closeCmd(); return; }
      if(document.body.classList.contains("ux-nav-open")){ closeDrawer(); if(menuBtn) menuBtn.focus(); }
    }
  });

  /* ---------- Reveal-on-scroll ----------
     Hanya kartu tingkat-atas yang SAAT halaman dibuka berada di bawah lipatan layar yang di-"arm"
     (jadi tidak ada konten di atas lipatan yang berkedip). Begitu masuk viewport → muncul, lalu
     class-nya dilepas lagi (elemen kembali persis ke kondisi asli, tanpa transform tersisa).
     Tiap elemen paling banyak sekali seumur halaman dimuat. */
  const armed = new WeakSet();
  const io = "IntersectionObserver" in window ? new IntersectionObserver(entries=>{
    entries.forEach(en=>{
      if(!en.isIntersecting) return;
      const el = en.target; io.unobserve(el);
      el.classList.add("ux-revealed");
      setTimeout(()=>el.classList.remove("ux-reveal","ux-revealed"), 700);
    });
  }, {rootMargin:"0px", threshold:0}) : null;
  function armReveal(pageEl){
    if(!io || !pageEl || reduceMotion.matches) return;
    const vh = window.innerHeight;
    let n = 0;
    pageEl.querySelectorAll(".card, .stat, .dash-rank-subcard").forEach(el=>{
      if(n>=80 || armed.has(el)) return;
      if(el.parentElement.closest(".card, .stickytop, .modal, .stat, .dash-rank-subcard")) return;
      armed.add(el);
      const r = el.getBoundingClientRect();
      if(r.height===0 || r.top < vh*0.92) return;
      el.classList.add("ux-reveal"); io.observe(el); n++;
    });
  }

  /* ---------- Highlight menu "cair" (liquid / slime) ----------
     Satu pill lime bersama yang MENGALIR dari item lama ke item baru: tepi depan melesat duluan,
     tepi belakang menyusul (pill meregang lalu menyusut), sedikit "dipencet" di tengah jalan,
     meninggalkan tetesan yang menyusul & menyatu kembali (filter gooey SVG), lalu mendarat dgn
     goyangan squash-and-stretch kecil. Posisi diambil dari offsetTop/offsetLeft (layout murni,
     tidak terpengaruh transform animasi) relatif ke #navMenu. Tanpa Web Animations API, pill
     cukup melompat (tetap fungsional). */
  const Liquid = (function(){
    const nav = $("navMenu");
    const noop = {move(){}, place(){}, owns(){ return false; }};
    if(!nav) return noop;
    const NS = "http://www.w3.org/2000/svg";
    const defs = document.createElementNS(NS, "svg");
    defs.setAttribute("width","0"); defs.setAttribute("height","0"); defs.setAttribute("aria-hidden","true");
    defs.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;";
    defs.innerHTML = '<defs><filter id="uxGoo" x="-30%" y="-10%" width="160%" height="120%" color-interpolation-filters="sRGB">'
      + '<feGaussianBlur in="SourceGraphic" stdDeviation="5" result="b"/>'
      + '<feColorMatrix in="b" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 19 -8" result="g"/>'
      + '<feComposite in="SourceGraphic" in2="g" operator="atop"/></filter></defs>';
    document.body.appendChild(defs);
    const layer = document.createElement("div"); layer.className = "ux-liquid-layer"; layer.setAttribute("aria-hidden","true");
    const pill = document.createElement("span"); pill.className = "ux-liquid-pill";
    const drop = document.createElement("span"); drop.className = "ux-liquid-drop";
    layer.append(pill, drop);
    nav.prepend(layer);
    nav.classList.add("ux-liquid");
    const canAnimate = "animate" in Element.prototype;
    let cur = null, curBtn = null, anim = null, dropAnim = null;

    const visible = b => !!b && b.offsetParent!==null && !b.classList.contains("hidden-by-search");
    function rectOf(b){
      if(b.offsetParent===nav) return {x:b.offsetLeft, y:b.offsetTop, w:b.offsetWidth, h:b.offsetHeight};
      const r = b.getBoundingClientRect(), n = nav.getBoundingClientRect();
      return {x:r.left-n.left-nav.clientLeft+nav.scrollLeft, y:r.top-n.top-nav.clientTop+nav.scrollTop, w:r.width, h:r.height};
    }
    function apply(r){
      pill.style.transform = `translate(${r.x}px,${r.y}px)`;
      pill.style.width = r.w+"px"; pill.style.height = r.h+"px";
      cur = r;
    }
    function setOff(off){ if(pill.classList.contains("ux-off")!==off) pill.classList.toggle("ux-off", off); }
    function setGoo(on){
      if(layer.classList.contains("ux-goo")===on) return;
      layer.classList.toggle("ux-goo", on);
      layer.style.height = on ? nav.scrollHeight+"px" : "0";
    }
    const running = a => a && a.playState==="running";
    function stop(){ if(anim){ anim.cancel(); anim = null; } if(dropAnim){ dropAnim.cancel(); dropAnim = null; } setGoo(false); }
    function place(b){
      b = b || activeNav();
      if(!visible(b)){ setOff(true); return; }
      setOff(false); curBtn = b;
      if(running(anim)) return;              // posisi akhir disinkronkan lagi begitu animasi selesai
      apply(rectOf(b));
    }
    function liveRect(){
      const p = pill.getBoundingClientRect(), n = nav.getBoundingClientRect();
      return {x:p.left-n.left-nav.clientLeft+nav.scrollLeft, y:p.top-n.top-nav.clientTop+nav.scrollTop, w:p.width, h:p.height};
    }
    function move(b){
      if(!visible(b)){ place(b); return; }
      const to = rectOf(b);
      const from = running(anim) ? liveRect() : cur;
      stop(); setOff(false); curBtn = b;
      if(!from || !canAnimate || reduceMotion.matches){ apply(to); return; }
      const dist = to.y - from.y, ad = Math.abs(dist), down = dist > 0;
      if(ad < 1 && Math.abs(to.w-from.w) < 1){ apply(to); return; }
      const dur = Math.round(Math.min(780, 430 + ad*0.42)), wob = 300, total = dur + wob, mf = dur/total;
      const lead = t=>1-Math.pow(1-t, 3);
      const trail = t=>{ t = Math.max(0, (t-0.16)/0.84); return t<0.5 ? 4*t*t*t : 1-Math.pow(-2*t+2, 3)/2; };
      const frames = [], N = 28;
      for(let i=0;i<=N;i++){
        const t = i/N;
        const topP = down ? trail(t) : lead(t), botP = down ? lead(t) : trail(t);
        const top = from.y + (to.y-from.y)*topP;
        const bot = from.y+from.h + ((to.y+to.h)-(from.y+from.h))*botP;
        const w0 = from.w + (to.w-from.w)*t, w = w0*(1 - 0.12*Math.sin(Math.PI*t));
        const x = from.x + (to.x-from.x)*t + (w0-w)/2;
        frames.push({offset:t*mf, transform:`translate(${x}px,${top}px)`, width:w+"px", height:Math.max(10, bot-top)+"px"});
      }
      // Pendaratan: squash → stretch → diam (berpusat di item tujuan).
      [[0.32,1.05,0.86],[0.66,0.98,1.06],[1,1,1]].forEach(([o,sx,sy])=>{
        const w = to.w*sx, h = to.h*sy;
        frames.push({offset:mf+(1-mf)*o, transform:`translate(${to.x-(w-to.w)/2}px,${to.y-(h-to.h)/2}px)`, width:w+"px", height:h+"px"});
      });
      apply(to);                               // state akhir ditulis dulu; animasi menimpanya selama berjalan
      setGoo(true);
      anim = pill.animate(frames, {duration:total, easing:"linear"});
      if(ad > 28){
        const d = 16, x0 = from.x+from.w/2-d/2, x1 = to.x+to.w/2-d/2;
        const y0 = down ? from.y+from.h-d-2 : from.y+2, y1 = to.y+to.h/2-d/2;
        dropAnim = drop.animate([
          {offset:0, opacity:0, transform:`translate(${x0}px,${y0}px) scale(.5)`},
          {offset:0.14, opacity:1, transform:`translate(${x0}px,${y0}px) scale(1)`},
          {offset:0.74, opacity:1, transform:`translate(${x1}px,${y1+(down?-1:1)*to.h*0.55}px) scale(.85)`},
          {offset:1, opacity:0, transform:`translate(${x1}px,${y1}px) scale(.35)`},
        ], {duration:Math.round(dur*1.12), delay:50, easing:"cubic-bezier(.55,0,.3,1)"});
      }
      const a = anim;
      a.finished.then(()=>{ if(anim!==a) return; anim = null; dropAnim = null; setGoo(false); place(curBtn); }).catch(()=>{});
    }
    // Ukuran item berubah (rail diciutkan/diperluas, font selesai dimuat, drawer mobile) → ikut.
    if(window.ResizeObserver){
      const ro = new ResizeObserver(()=>place(curBtn));
      ro.observe(nav); nav.querySelectorAll(".navbtn").forEach(b=>ro.observe(b));
    }
    return { move, place, owns: n => layer===n || layer.contains(n) };
  })();

  /* ---------- Motion saat halaman dibuka: count-up angka & chart "tumbuh" ----------
     Setiap kali sebuah halaman DIBUKA (bukan saat filter/re-render biasa):
     - Angka KPI besar (font ≥16px, di luar tabel) menghitung dari 0 → nilai akhir (easeOutExpo),
       format Indonesia dipertahankan persis (titik ribuan, koma desimal, prefix/suffix spt %).
       Begitu selesai, teks DIKEMBALIKAN ke string aslinya byte-per-byte. Kalau app mengubah teks
       itu di tengah jalan, count-up langsung berhenti & tidak menimpa. Klik/tombol keyboard
       apa pun langsung menyelesaikan semua hitungan (salinan DOM spt "Perbesar" chart tidak
       pernah menangkap angka setengah jalan).
     - Chart SVG: bar tumbuh dari sumbunya (berurutan), garis tren "tergambar", titik scatter
       pop, cincin donut terisi, irisan pie berputar masuk, grid & label fade-in.
     - Bar HTML (track progress, stacked bar): memanjang dari kiri.
     - Baris tabel yang terlihat muncul berurutan.
     Semua lewat Web Animations API dgn fill "backwards": TIDAK ada atribut/data yang diubah,
     dan setelah selesai elemen kembali persis spt aslinya. Elemen di bawah lipatan layar baru
     dianimasikan saat discroll mendekat. Elemen yg sudah punya animasi bawaan app dilewati. */
  const Motion = (function(){
    const ok = "animate" in Element.prototype && "IntersectionObserver" in window;
    const counts = new Set();
    const noop = {enter(){}, finishCounts(){}};
    if(!ok) return noop;
    let io = null, jobs = new Map(), seen = new WeakSet(), watch = null, watchTimer = 0, burst = 0, burstAt = 0;
    const EASE = "cubic-bezier(.22,1,.36,1)", POP = "cubic-bezier(.34,1.56,.64,1)", DRAW = "cubic-bezier(.65,0,.35,1)";
    const busy = el => el.getAnimations().length > 0 || !!el.closest(".dash-grow-x,.dash-grow-y,.dash-fade-up,.dash-ring-fill");

    // ---- count-up ----
    const NUM = /^(\s*(?:[+\-−~≈<>±]\s?)?(?:Rp\s?)?)(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+,\d+|\d+\.\d{1,2}|\d+)(\s*[^\d]{0,12})$/;
    function parseNum(str){
      const m = NUM.exec(str); if(!m) return null;
      const pre = m[1], num = m[2], suf = m[3];
      let dec = 0, decSep = ",", group = false, v;
      if(/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(num)){ group = true; const [i, f=""] = num.split(","); dec = f.length; v = parseFloat(i.replace(/\./g,"") + (f ? "."+f : "")); }
      else if(num.includes(",")){ const [i, f] = num.split(","); dec = f.length; v = parseFloat(i+"."+f); }
      else if(num.includes(".")){ dec = num.split(".")[1].length; decSep = "."; v = parseFloat(num); }
      else v = parseInt(num, 10);
      if(!(v > 0) || !isFinite(v)) return null;
      if(!dec && !group && v>=1900 && v<=2100) return null;        // kemungkinan besar angka tahun
      if(/^\s*(jan|feb|mar|apr|mei|may|jun|jul|agu|agt|aug|sep|okt|oct|nov|des|dec)/i.test(suf)) return null;   // tanggal ("26 Nov") bukan kuantitas
      const fmt = x=>{
        const [i, f] = x.toFixed(dec).split(".");
        return pre + (group ? i.replace(/\B(?=(\d{3})+(?!\d))/g, ".") : i) + (dec ? decSep+f : "") + suf;
      };
      return {v, fmt};
    }
    function countUp(node, delay){
      const orig = node.nodeValue, p = parseNum(orig); if(!p) return;
      const dur = 950 + Math.min(650, Math.log10(p.v+1)*170);
      let start = null, last = p.fmt(0), raf = 0, tm = 0, done = false;
      const c = {
        finish(){
          if(done) return; done = true; clearTimeout(tm); cancelAnimationFrame(raf); counts.delete(c);
          if(node.nodeValue===last) node.nodeValue = orig;
        }
      };
      node.nodeValue = last;
      const step = ts=>{
        if(done) return;
        if(node.nodeValue!==last){ done = true; counts.delete(c); return; }   // app mengubahnya → mundur
        if(start===null) start = ts;
        const t = Math.min(1, (ts-start)/dur);
        if(t>=1){ c.finish(); return; }
        last = p.fmt(p.v*(1-Math.pow(2, -10*t)));
        node.nodeValue = last;
        raf = requestAnimationFrame(step);
      };
      counts.add(c);
      tm = setTimeout(()=>{ raf = requestAnimationFrame(step); }, delay||0);
    }
    function finishCounts(){ [...counts].forEach(c=>c.finish()); }

    // ---- SVG chart ----
    function withOrigin(el, box, origin, keyframes, opts){
      const pb = el.style.transformBox, po = el.style.transformOrigin;
      el.style.transformBox = box; el.style.transformOrigin = origin;
      const a = el.animate(keyframes, Object.assign({fill:"backwards"}, opts));
      const restore = ()=>{ el.style.transformBox = pb; el.style.transformOrigin = po; };
      a.finished.then(restore, restore);
    }
    const fade = (el, opts)=> el.animate([{opacity:0},{opacity:1}], Object.assign({fill:"backwards", easing:"ease-out"}, opts));
    function animSvg(svg, base){
      const vb = svg.viewBox && svg.viewBox.baseVal, br = svg.getBoundingClientRect();
      const W = (vb && vb.width) || br.width, H = (vb && vb.height) || br.height;
      if(!W || !H) return;
      const els = svg.querySelectorAll("rect,path,polyline,polygon,line,circle,ellipse,text");
      if(els.length > 3000){ fade(svg, {duration:500, delay:base}); return; }
      const square = Math.abs(W-H)/Math.max(W,H) < 0.22;
      const cl = v=>Math.max(0, Math.min(1, v));
      els.forEach(el=>{
        if(el.closest("defs,clipPath,mask,marker,pattern,symbol") || el.getAnimations().length) return;
        const cs = getComputedStyle(el);
        if(cs.display==="none" || cs.visibility==="hidden") return;
        let bb; try{ bb = el.getBBox(); }catch(e){ return; }
        const tag = el.tagName.toLowerCase();
        const hasT = el.hasAttribute("transform") || cs.transform!=="none";
        const fx = cl(bb.x/W), fy = cl(bb.y/H);
        const fillOn = cs.fill!=="none" && parseFloat(cs.fillOpacity)!==0;
        const strokeOn = cs.stroke!=="none" && parseFloat(cs.strokeWidth)>0;
        const dashed = !!cs.strokeDasharray && cs.strokeDasharray!=="none";
        if(tag==="text"){ fade(el, {duration:520, delay:base+260+fx*220}); return; }
        if(tag==="line"){ fade(el, {duration:480, delay:base+fx*120}); return; }
        if(tag==="rect"){
          if(bb.width<0.5 || bb.height<0.5) return;
          const bg = (bb.width>=0.8*W && bb.height>=0.45*H) || (bb.height>=0.85*H && bb.width>=0.45*W);
          if(bg || hasT){ fade(el, {duration:420, delay:base}); return; }
          if(bb.height > bb.width*1.15) withOrigin(el, "fill-box", "50% 100%", [{transform:"scaleY(0)"},{transform:"none"}], {duration:780, delay:base+fx*480, easing:EASE});
          else if(bb.width > bb.height*1.15) withOrigin(el, "fill-box", "0 50%", [{transform:"scaleX(0)"},{transform:"none"}], {duration:780, delay:base+fy*480, easing:EASE});
          else withOrigin(el, "fill-box", "50% 50%", [{transform:"scale(.3)", opacity:0},{transform:"none", opacity:1}], {duration:480, delay:base+(fx+fy)*260, easing:POP});
          return;
        }
        if(tag==="circle" || tag==="ellipse"){
          const r = bb.width/2;
          if(!fillOn && strokeOn && dashed){
            el.animate([{strokeDasharray:`0 ${Math.ceil(2*Math.PI*r*1.2)}`},{strokeDasharray:cs.strokeDasharray}], {duration:1150, delay:base+120, easing:EASE, fill:"backwards"});
          } else if(fillOn && r<=9 && !hasT){
            withOrigin(el, "fill-box", "50% 50%", [{transform:"scale(0)", opacity:0},{transform:"none", opacity:1}], {duration:520, delay:base+180+fx*520, easing:POP});
          } else fade(el, {duration:500, delay:base+60});
          return;
        }
        // path / polyline / polygon
        if(!fillOn && strokeOn && !dashed && tag!=="polygon"){
          let L = 0; try{ L = el.getTotalLength(); }catch(e){}
          if(L > 2){
            el.animate([{strokeDasharray:`${L} ${L}`, strokeDashoffset:L},{strokeDasharray:`${L} ${L}`, strokeDashoffset:0}], {duration:1250, delay:base+160, easing:DRAW, fill:"backwards"});
            return;
          }
        }
        if(fillOn && !hasT){
          if(square) withOrigin(el, "view-box", "50% 50%", [{transform:"rotate(-28deg) scale(.72)", opacity:0},{transform:"none", opacity:1}], {duration:950, delay:base+fx*160, easing:EASE});
          else withOrigin(el, "fill-box", "50% 100%", [{transform:"scaleY(0)", opacity:0},{transform:"none", opacity:1}], {duration:900, delay:base+120, easing:EASE});
          return;
        }
        fade(el, {duration:600, delay:base+200});
      });
    }

    // ---- HTML bar ----
    function animBar(el, base){
      if(busy(el) || getComputedStyle(el).transform!=="none") return;
      const st = el.getAttribute("style")||"";
      const vertical = /(^|;)\s*height:\s*[\d.]+%/.test(st) && !/(^|;)\s*width:\s*[\d.]+%/.test(st);
      withOrigin(el, "border-box", vertical ? "50% 100%" : "0 50%", [{transform:vertical?"scaleY(0)":"scaleX(0)"},{transform:"none"}], {duration:950, delay:base, easing:EASE});
    }
    function animStack(el, base){
      if(busy(el) || getComputedStyle(el).clipPath!=="none") return;
      el.animate([{clipPath:"inset(0 100% 0 0)"},{clipPath:"inset(0 0 0 0)"}], {duration:1000, delay:base, easing:EASE, fill:"backwards"});
    }

    // ---- penjadwalan: langsung kalau sudah di layar, sisanya saat discroll mendekat ----
    function nextDelay(){
      const now = performance.now();
      if(now-burstAt > 120){ burst = 0; burstAt = now; }
      return Math.min(420, (burst++)*45);
    }
    function schedule(el, fn){
      if(seen.has(el)) return; seen.add(el);
      const r = el.getBoundingClientRect();
      if(r.bottom > -20 && r.top < window.innerHeight + 60) fn(nextDelay());
      else { jobs.set(el, fn); io.observe(el); }
    }
    function onIntersect(entries){
      entries.forEach(en=>{
        if(!en.isIntersecting) return;
        const fn = jobs.get(en.target); io.unobserve(en.target); jobs.delete(en.target);
        if(fn) fn(nextDelay());
      });
    }
    const SKIP = "table,select,textarea,option,script,style,input,.modal,.leaflet-container,.ux-noanim";
    function scan(root){
      if(!root.querySelectorAll || root.closest(".modal,.leaflet-container")) return;
      // Chart SVG (ikon kecil diabaikan)
      const svgs = root.tagName && root.tagName.toLowerCase()==="svg" ? [root] : root.querySelectorAll("svg");
      svgs.forEach(svg=>{
        if(svg.parentElement && svg.parentElement.closest("svg")) return;
        if(svg.closest(".modal,.leaflet-container,.ux-noanim,.ms-icon")) return;
        const r = svg.getBoundingClientRect(); if(r.width < 60 || r.height < 36) return;
        schedule(svg, d=>animSvg(svg, d));
      });
      // Bar HTML: anak ber-inline width/height % di dalam track tipis
      // Dibatasi 300 kandidat pertama (urutan dokumen ≈ yang paling atas/terlihat duluan) supaya
      // halaman tabel ribuan baris tidak membayar biaya pemindaian penuh tiap dibuka.
      const groups = new Map();
      let budget = 300;
      root.querySelectorAll('[style*="%"]').forEach(el=>{
        if(budget<=0) return;
        if(el.closest("svg,.modal,.leaflet-container,.ux-noanim")) return;
        const st = el.getAttribute("style")||"";
        const w = /(^|;)\s*width:\s*[\d.]+%/.test(st), h = /(^|;)\s*height:\s*[\d.]+%/.test(st);
        if(!w && !h) return;
        budget--;
        const r = el.getBoundingClientRect(); if(!r.width && !r.height) return;
        if((w && r.height > 26) || (h && !w && r.width > 64) || el.children.length > 2) return;
        const p = el.parentElement; if(!p) return;
        if(!groups.has(p)) groups.set(p, []); groups.get(p).push(el);
      });
      groups.forEach((kids, p)=>{
        if(kids.length >= 2) schedule(p, d=>animStack(p, d));
        else schedule(kids[0], d=>animBar(kids[0], d));
      });
      // Angka KPI besar
      const byParent = new Map();
      const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT|NodeFilter.SHOW_TEXT, {acceptNode(n){
        if(n.nodeType===1) return n.matches(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
        const v = n.nodeValue; return v.length < 26 && /\d/.test(v) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }});
      let n;
      while((n = tw.nextNode())){
        const el = n.parentElement; if(!el || !parseNum(n.nodeValue)) continue;
        if(parseFloat(getComputedStyle(el).fontSize) < 16 || !el.getClientRects().length) continue;
        if(!byParent.has(el)) byParent.set(el, []); byParent.get(el).push(n);
      }
      byParent.forEach((nodes, el)=> schedule(el, d=>nodes.forEach(t=>countUp(t, d))));
    }
    function rows(pageEl){
      const vh = window.innerHeight; let k = 0;
      pageEl.querySelectorAll("table").forEach(tb=>{
        if(k>=42 || tb.closest(".modal,.stickytop,svg")) return;
        const r = tb.getBoundingClientRect(); if(!r.height || r.top > vh || r.bottom < 0) return;
        for(const body of tb.tBodies){
          for(const tr of body.rows){
            if(k>=42) return;
            const rr = tr.getBoundingClientRect();
            if(rr.top > vh) return;
            if(rr.bottom < 0 || !rr.height || tr.getAnimations().length) continue;
            tr.animate([{opacity:0},{opacity:1}], {duration:460, delay:80+k*18, easing:"ease-out", fill:"backwards"});
            k++;
          }
        }
      });
      let j = 0;
      pageEl.querySelectorAll(".tree-site").forEach(el=>{
        const r = el.getBoundingClientRect(); if(j>=12 || r.top > vh || r.bottom < 0 || el.getAnimations().length) return;
        el.animate([{opacity:0, transform:"translateX(-10px)"},{opacity:1, transform:"none"}], {duration:520, delay:90+j*45, easing:EASE, fill:"backwards"});
        j++;
      });
    }
    // Pindah tab/segmented di dalam halaman: hanya node BARU hasil re-render yang dianimasikan
    // (KPI yang tidak ikut di-render ulang tidak dihitung ulang).
    function watchChanges(pageEl){
      if(!pageEl || reduceMotion.matches) return;
      if(!io) io = new IntersectionObserver(onIntersect, {rootMargin:"0px 0px 60px 0px", threshold:0});
      if(watch) watch.disconnect();
      clearTimeout(watchTimer);
      burst = 0; burstAt = performance.now();
      watch = new MutationObserver(muts=>muts.forEach(m=>m.addedNodes.forEach(x=>{ if(x.nodeType===1) scan(x); })));
      watch.observe(pageEl, {childList:true, subtree:true});
      watchTimer = setTimeout(()=>watch.disconnect(), 900);
    }
    function enter(pageEl){
      if(!pageEl || reduceMotion.matches) return;
      if(io) io.disconnect();
      if(watch) watch.disconnect();
      clearTimeout(watchTimer);
      jobs = new Map(); seen = new WeakSet(); burst = 0; burstAt = performance.now();
      io = new IntersectionObserver(onIntersect, {rootMargin:"0px 0px 60px 0px", threshold:0});
      scan(pageEl);
      rows(pageEl);
      // Chart yang dibangun belakangan (setelah data/timeout) tetap ditangkap selama 1,5 dtk.
      watch = new MutationObserver(muts=>muts.forEach(m=>m.addedNodes.forEach(x=>{ if(x.nodeType===1) scan(x); })));
      watch.observe(pageEl, {childList:true, subtree:true});
      watchTimer = setTimeout(()=>watch.disconnect(), 1500);
    }
    // Klik / aktivasi keyboard (atau cetak) langsung menuntaskan hitungan ke angka finalnya.
    // Scroll sengaja TIDAK, supaya angka di bawah layar tetap sempat terlihat menghitung.
    document.addEventListener("pointerdown", ()=>{ if(counts.size) finishCounts(); }, {capture:true, passive:true});
    document.addEventListener("keydown", e=>{ if(counts.size && (e.key==="Enter" || e.key===" " || e.ctrlKey || e.metaKey)) finishCounts(); }, true);
    window.addEventListener("beforeprint", finishCounts);
    return { enter, watchChanges, finishCounts };
  })();
  const VIEW_SWITCH = ".hd-tab, .dp-tab, .hd-seg-group button, .dp-seg .btn, .sim-param-tabs button, [role=tab]";
  document.addEventListener("click", e=>{
    const t = e.target.closest && e.target.closest(VIEW_SWITCH);
    if(!t) return;
    const pg = t.closest(".page"); if(pg) Motion.watchChanges(pg);
  }, true);

  /* ---------- Ripple cahaya di titik klik ---------- */
  const RIPPLE = ".btn.primary, .hd-btn-solid, .gate-choice-btn, nav .navbtn";
  document.addEventListener("pointerdown", e=>{
    if(reduceMotion.matches || e.button!==0) return;
    const b = e.target.closest && e.target.closest(RIPPLE);
    if(!b || b.disabled || !b.animate) return;
    const r = b.getBoundingClientRect();
    b.style.setProperty("--ux-rx", (e.clientX - r.left)+"px");
    b.style.setProperty("--ux-ry", (e.clientY - r.top)+"px");
    try{ b.animate([{opacity:1, transform:"scale(.96)"},{opacity:0, transform:"scale(1.02)"}], {duration:620, easing:"cubic-bezier(.22,1,.36,1)", pseudoElement:"::after"}); }catch(err){ /* browser tanpa dukungan pseudoElement — lewati */ }
  }, true);

  // Gerbang akses ditutup (pilih Visitor / login PHM) → putar ulang motion halaman aktif, karena
  // saat boot hitungannya terjadi di balik gerbang & tidak terlihat.
  const gateEl = $("accessGate");
  if(gateEl && window.MutationObserver){
    new MutationObserver(()=>{
      if(gateOpen()) return;
      requestAnimationFrame(()=>{ const b = activeNav(); if(b){ Liquid.place(b); Motion.enter($("page-"+b.dataset.page)); } });
    }).observe(gateEl, {attributes:true, attributeFilter:["style"]});
  }

  /* ---------- Indikator progres scroll ---------- */
  const bar = document.createElement("div");
  bar.className = "ux-scroll-progress"; bar.setAttribute("aria-hidden","true");
  document.body.appendChild(bar);
  let barQueued = false;
  function updateScrollProgress(){
    if(barQueued) return; barQueued = true;
    requestAnimationFrame(()=>{
      barQueued = false;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const on = max > 240;
      bar.classList.toggle("on", on && window.scrollY > 4);
      bar.style.transform = "scaleX(" + (on ? Math.min(1, window.scrollY/max) : 0) + ")";
    });
  }
  window.addEventListener("scroll", updateScrollProgress, {passive:true});
  window.addEventListener("resize", updateScrollProgress, {passive:true});

  /* ---------- Init ---------- */
  onPageChange();
})();
