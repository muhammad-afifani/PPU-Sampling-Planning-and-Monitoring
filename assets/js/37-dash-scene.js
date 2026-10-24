/* =========================================================
   DASHBOARD SCENE — diorama interaktif area operasi PHM (#dashScene)
   ---------------------------------------------------------
   Gaya & animasi di assets/css/dash-scene.css. JS ini hanya:
   - klik/Enter pada hotspot (tombol .dio-hot) atau pada gambar area (.dio-area) → kamera SVG
     (.dio-cam) di-zoom ke area itu + kartu detail (#dioCard) diisi;
   - angka di kartu DIHITUNG SAAT DIBUKA dari DB.points (titik wajib pantau periode aktif, sama
     dgn kartu KPI Dashboard: effectiveWajib + status done/scheduled/failed) — tidak ada data
     yang ditulis atau diubah;
   - Esc / tombol tutup / klik di luar area → kembali ke tampilan penuh; ‹ › pindah area.
   Pemetaan area → site/grup sumber ada di AREAS di bawah (ubah di sini kalau site bertambah).
========================================================= */
(function(){
  "use strict";
  const root = document.getElementById("dashScene");
  if(!root) return;
  const stage = root.querySelector(".dio-stage");
  const scroller = root.querySelector(".dio-scroll");
  const cam = root.querySelector(".dio-cam");
  const card = document.getElementById("dioCard");
  if(!stage || !cam || !card) return;
  const $c = id => document.getElementById(id);
  const VW = 1600, VH = 380;
  const reduceMotion = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : {matches:false};

  // GRP_* & subgroupOf didefinisikan di 05-master-data.js (dimuat sebelum file ini).
  const grp = p => (typeof subgroupOf==="function" ? subgroupOf(p) : "");
  const inGroups = list => p => list.indexOf(grp(p))>=0;
  const inSites = list => p => list.indexOf(p.site)>=0;

  // fbox = kotak fokus kamera (unit viewBox) — sengaja lebih rapat dari area klik.
  const AREAS = {
    ambient: {eyebrow:"Lingkungan", scope:"semua site", title:"Ambien & Kebisingan",
      desc:"Udara ambien, kebisingan, kebauan & getaran — diukur dengan HVAS dan sound level meter.",
      fbox:[30,198,150,102], match:()=>inGroups([GRP_AMBIENT])},
    sps: {eyebrow:"Area darat", scope:"site SPS", title:"Tank Farm & Area Proses",
      desc:"Terminal darat Senipah: tangki timbun (tank farm) dan area proses.",
      fbox:[158,196,522,106], match:()=>inSites(["SPS"])},
    turbin: {eyebrow:"Sumber emisi", scope:"semua site", title:"Turbin Gas",
      desc:"Turbine generator & compressor — emisi gas buang dipantau di cerobong exhaust.",
      fbox:[684,98,112,204], match:()=>inGroups([GRP_TURBIN])},
    reboiler: {eyebrow:"Sumber emisi", scope:"semua site", title:"Glycol Reboiler",
      desc:"Regenerasi glycol (dehydrator) — dipantau emisi & opasitasnya.",
      fbox:[790,180,112,122], match:()=>inGroups([GRP_GLYCOL])},
    engine: {eyebrow:"Sumber emisi", scope:"semua site", title:"Diesel / Gas Engine",
      desc:"Genset, pompa & kompresor diesel/gas, termasuk emergency engine standby.",
      fbox:[888,194,98,108], match:()=>inGroups([GRP_GAS_ENGINE, GRP_EMERGENCY, GRP_ENGINE_KECIL])},
    flare: {eyebrow:"Sumber emisi", scope:"semua site", title:"Flare",
      desc:"Pembakaran gas sisa proses — dipantau opasitas asapnya.",
      fbox:[970,56,100,246], match:()=>inGroups([GRP_FLARE])},
    swamp: {eyebrow:"Area rawa", scope:"site NPU, CPU, SPU", title:"Swamp Platform",
      desc:"Platform di atas tiang pancang di kawasan rawa, dijangkau transport air.",
      fbox:[1044,108,200,198], match:()=>inSites(["NPU","CPU","SPU"])},
    offshore: {eyebrow:"Lepas pantai", scope:"site BKP", title:"Offshore Platform",
      desc:"Platform jacket lepas pantai Bekapai, dijangkau transport laut.",
      fbox:[1200,66,170,238], match:()=>inSites(["BKP"])},
    rig: {eyebrow:"Pengeboran", title:"Jack-up Rig",
      desc:"Rig pengeboran lepas pantai yang bertumpu pada kaki baja hingga dasar laut.",
      fbox:[1388,82,212,222], match:()=>null, note:"Tidak ada titik pantau rig yang terdaftar di tools ini."},
  };

  const hots = [...root.querySelectorAll(".dio-hot")];
  const ORDER = hots.map(b=>b.getAttribute("data-area")).filter(k=>AREAS[k]);
  const areaEl = key => cam.querySelector('.dio-area[data-area="'+key+'"]');
  const hotEl = key => root.querySelector('.dio-hot[data-area="'+key+'"]');
  let current = null, returnFocus = null;

  function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

  function statsFor(a){
    let match = null;
    try{ match = a.match(); }catch(e){ match = null; /* GRP_* belum terdefinisi */ }
    if(!match || typeof DB==="undefined" || !DB || !Array.isArray(DB.points)) return null;
    let period = "";
    try{ period = currentPeriodStr(); }catch(e){ /* periode belum siap */ }
    const c = {total:0, done:0, scheduled:0, failed:0, period};
    DB.points.forEach(p=>{
      let ok = false;
      try{ ok = match(p) && effectiveWajib(p, period); }catch(e){ ok = false; }
      if(!ok) return;
      c.total++;
      if(p.status==="done") c.done++;
      else if(p.status==="scheduled") c.scheduled++;
      else if(p.status==="failed") c.failed++;
    });
    c.pct = c.total ? Math.round(c.done/c.total*100) : 0;
    return c;
  }

  function fillCard(key){
    const a = AREAS[key];
    $c("dioCardEyebrow").textContent = a.eyebrow;
    $c("dioCardTitle").textContent = a.title;
    $c("dioCardDesc").textContent = a.desc;
    const st = statsFor(a);
    let html;
    if(st){
      const per = st.period ? ` title="Periode ${esc(st.period)}"` : "";
      html = st.total
        ? `<div class="dio-stat-main"><b>${st.total}</b><span${per}>titik wajib pantau · ${esc(a.scope||"")}</span></div>`+
          `<div class="dio-bar" role="img" aria-label="Progres selesai ${st.pct}%"><i style="width:${st.pct}%"></i></div>`+
          `<div class="dio-chips"><span class="dio-chip ok">Selesai <b>${st.done}</b> (${st.pct}%)</span>`+
          `<span class="dio-chip wait">Terjadwal <b>${st.scheduled}</b></span>`+
          (st.failed ? `<span class="dio-chip bad">Gagal <b>${st.failed}</b></span>` : "")+`</div>`
        : `<p class="dio-note">Belum ada titik wajib pantau (${esc(a.scope||"")}) pada periode ini.</p>`;
    } else {
      html = `<p class="dio-note">${esc(a.note || "Data titik pantau belum dimuat.")}</p>`;
    }
    $c("dioCardStats").innerHTML = html;
    $c("dioCardPos").textContent = (ORDER.indexOf(key)+1)+" / "+ORDER.length;
  }

  function setActive(key){
    cam.querySelectorAll(".dio-area").forEach(g=>g.classList.toggle("is-active", g.getAttribute("data-area")===key));
  }

  function focusArea(key, trigger){
    if(!AREAS[key]) return;
    if(trigger) returnFocus = trigger;
    current = key;
    fillCard(key);
    card.hidden = false;
    setActive(key);
    const [bx, by, bw, bh] = AREAS[key].fbox;
    const cx = bx + bw/2, cy = by + bh/2;
    // Kartu menumpang di samping (banner lebar) atau turun ke bawah (banner sempit).
    const overlay = getComputedStyle(card).position==="absolute";
    const cardRight = overlay && cx < VW*0.42;
    root.classList.toggle("card-right", cardRight);
    const stageW = stage.getBoundingClientRect().width || 1;
    const f = overlay ? Math.min(0.5, (card.offsetWidth + 28) / stageW) : 0;
    const availW = VW * (1 - f);
    let s = Math.min(availW*0.84/bw, VH*0.9/bh, 3);
    s = Math.max(s, 1.15);
    const fx = overlay ? (cardRight ? availW/2 : VW*f + availW/2) : VW/2;
    const fy = VH*0.52;
    let tx = fx - cx*s, ty = fy - cy*s;
    tx = Math.min(0, Math.max(VW - VW*s, tx));
    ty = Math.min(0, Math.max(VH - VH*s, ty));
    cam.style.transform = `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${s.toFixed(3)})`;
    root.classList.add("is-zoom");
    root.setAttribute("data-focus", key);
    if(scroller && scroller.scrollWidth > scroller.clientWidth + 2){
      scroller.scrollTo({left:(scroller.scrollWidth - scroller.clientWidth)/2, behavior: reduceMotion.matches ? "auto" : "smooth"});
    }
  }

  function closeZoom(restoreFocus){
    if(!current) return;
    current = null;
    cam.style.transform = "";
    root.classList.remove("is-zoom","card-right");
    root.removeAttribute("data-focus");
    setActive(null);
    card.hidden = true;
    if(restoreFocus && returnFocus && document.contains(returnFocus)) returnFocus.focus({preventScroll:true});
    returnFocus = null;
  }

  function step(dir){
    if(!current) return;
    const i = ORDER.indexOf(current);
    focusArea(ORDER[(i + dir + ORDER.length) % ORDER.length]);
  }

  // Hotspot (tombol) — jalur keyboard & layar sentuh.
  hots.forEach(b=>{
    b.addEventListener("click", ()=>focusArea(b.getAttribute("data-area"), b));
    const hl = on => { const g = areaEl(b.getAttribute("data-area")); if(g) g.classList.toggle("is-hl", on); };
    b.addEventListener("mouseenter", ()=>hl(true));
    b.addEventListener("mouseleave", ()=>hl(false));
    b.addEventListener("focus", ()=>hl(true));
    b.addEventListener("blur", ()=>hl(false));
  });

  // Klik langsung pada gambar area; klik di luar area saat zoom → kembali.
  stage.addEventListener("click", e=>{
    if(e.target.closest(".dio-hot")) return;
    const g = e.target.closest(".dio-area");
    if(g){ const key = g.getAttribute("data-area"); focusArea(key, hotEl(key)); return; }
    if(current) closeZoom(false);
  });
  stage.addEventListener("pointerover", e=>{
    const g = e.target.closest && e.target.closest(".dio-area");
    if(!g || current) return;
    g.classList.add("is-hl");
    const h = hotEl(g.getAttribute("data-area")); if(h) h.classList.add("is-hl");
  });
  stage.addEventListener("pointerout", e=>{
    const g = e.target.closest && e.target.closest(".dio-area");
    if(!g || (e.relatedTarget && g.contains(e.relatedTarget))) return;
    g.classList.remove("is-hl");
    const h = hotEl(g.getAttribute("data-area")); if(h) h.classList.remove("is-hl");
  });

  $c("dioCardClose").addEventListener("click", ()=>closeZoom(true));
  $c("dioCardPrev").addEventListener("click", ()=>step(-1));
  $c("dioCardNext").addEventListener("click", ()=>step(1));
  root.addEventListener("keydown", e=>{
    if(!current) return;
    if(e.key==="Escape"){ e.preventDefault(); closeZoom(true); }
    else if(e.key==="ArrowRight" && card.contains(document.activeElement)){ e.preventDefault(); step(1); }
    else if(e.key==="ArrowLeft" && card.contains(document.activeElement)){ e.preventDefault(); step(-1); }
  });
  document.addEventListener("keydown", e=>{ if(e.key==="Escape" && current && !root.contains(document.activeElement)) closeZoom(false); });
  document.addEventListener("pointerdown", e=>{ if(current && !root.contains(e.target)) closeZoom(false); });

  // Animasi dijeda saat diorama tidak terlihat (scroll jauh ke bawah / pindah halaman).
  if("IntersectionObserver" in window){
    new IntersectionObserver(es=>es.forEach(en=>root.classList.toggle("is-offscreen", !en.isIntersecting)), {rootMargin:"80px"}).observe(stage);
  }

  // Ponsel: diorama digeser horizontal — buka di tengah (sumber emisi), bukan di ujung kiri.
  function centerScroll(){
    if(scroller && scroller.scrollWidth > scroller.clientWidth + 2 && scroller.scrollLeft===0){
      scroller.scrollLeft = scroller.scrollWidth*0.52 - scroller.clientWidth/2;
    }
  }
  if(document.readyState==="complete") centerScroll(); else window.addEventListener("load", centerScroll);
})();
