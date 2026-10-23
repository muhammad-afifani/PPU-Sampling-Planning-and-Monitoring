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
    let enabled = false, ctx = null, out = null, lastTap = 0;
    try{ enabled = localStorage.getItem(SOUND_KEY)==="1"; }catch(e){ /* storage diblokir — tetap mati */ }
    function unlock(){
      if(!enabled || !AC) return;
      try{
        if(!ctx){
          ctx = new AC();
          const comp = ctx.createDynamicsCompressor();
          out = ctx.createGain(); out.gain.value = 0.9;
          out.connect(comp); comp.connect(ctx.destination);
        }
        if(ctx.state==="suspended") ctx.resume().catch(()=>{});
      }catch(e){ ctx = null; }
    }
    function tone(o){
      const t = ctx.currentTime + (o.delay||0) + 0.005, dur = o.dur||0.1;
      const osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = o.type || "sine";
      osc.frequency.setValueAtTime(o.f, t);
      if(o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t+dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(o.gain||0.05, t+0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t+dur);
      osc.connect(g); g.connect(out);
      osc.start(t); osc.stop(t+dur+0.02);
    }
    const voices = {
      tap(){ tone({f:1500, to:950, type:"triangle", dur:0.045, gain:0.03}); },
      success(){ tone({f:784, dur:0.12, gain:0.045}); tone({f:1175, dur:0.22, gain:0.04, delay:0.075}); },
      error(){ tone({f:330, to:290, type:"triangle", dur:0.14, gain:0.055}); tone({f:220, type:"triangle", dur:0.2, gain:0.05, delay:0.12}); },
      on(){ tone({f:660, dur:0.08, gain:0.04}); tone({f:990, dur:0.14, gain:0.035, delay:0.06}); },
    };
    function play(name){
      if(!enabled || !ctx || ctx.state!=="running") return;
      if(name==="tap"){ const n = performance.now(); if(n-lastTap < 70) return; lastTap = n; }
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

  // Bunyi "tap" hanya utk kontrol yang disengaja (aksi utama, navigasi, tab, segmented) — tidak
  // utk hover/scroll/sel tabel supaya tidak repetitif.
  const TAP_SEL = ".btn.primary, nav .navbtn, .hd-tab, .dp-tab, .hd-seg-group button, .dp-seg .btn, .gate-choice-btn, .ux-cmd-item, .ux-icon-btn:not(#uxSoundToggle)";
  document.addEventListener("pointerdown", e=>{
    Sound.unlock();
    const t = e.target.closest && e.target.closest(TAP_SEL);
    if(t && !t.disabled) Sound.play("tap");
  }, true);
  document.addEventListener("keydown", e=>{
    Sound.unlock();
    if((e.key==="Enter"||e.key===" ") && e.target.matches && e.target.matches(TAP_SEL)) Sound.play("tap");
  }, true);
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
    const btn = activeNav(); if(!btn) return;
    const page = btn.dataset.page;
    if(page===lastPage) return;
    lastPage = page;
    if(crumbGroup) crumbGroup.textContent = groupLabel(btn);
    if(crumbPage){
      crumbPage.textContent = btn.dataset.label || btn.textContent.trim();
      crumbPage.style.animation = "none"; void crumbPage.offsetWidth; crumbPage.style.animation = "";
    }
    closeDrawer();
    keepNavItemVisible(btn);
    armReveal($("page-"+page));
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
    new MutationObserver(()=>{
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
    cmdOpenBtn && cmdOpenBtn.setAttribute("aria-expanded","true");
    setTimeout(()=>{ cmdInput.focus(); moveSel(0); }, 0);
  }
  function closeCmd(restore){
    if(!cmd.classList.contains("show")) return;
    cmd.classList.remove("show");
    cmdOpenBtn && cmdOpenBtn.setAttribute("aria-expanded","false");
    if(restore!==false && cmdReturnFocus && cmdReturnFocus.focus) cmdReturnFocus.focus({preventScroll:true});
  }
  function runSel(i){
    const it = cmdShown[i]; if(!it) return;
    closeCmd(false);
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
