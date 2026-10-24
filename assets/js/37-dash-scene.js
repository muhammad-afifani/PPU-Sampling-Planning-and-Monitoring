/* =========================================================
   DASHBOARD SCENE — pemilih latar animasi header Dashboard (#dashScene)
   ---------------------------------------------------------
   Presentasi murni (gaya & animasi di assets/css/dash-scene.css). JS ini hanya:
   - memasang data-scene (gtg | reb | flare | eng | all) & kelas .is-paused di #dashScene,
   - menyinkronkan aria-pressed tombol,
   - menyimpan pilihan di localStorage key sendiri ("phmDashScene", "phmDashSceneMotion") —
     terpisah dari DB, pola yang sama dgn phmTheme/phmSound.
========================================================= */
(function(){
  "use strict";
  const root = document.getElementById("dashScene");
  if(!root) return;
  const KEY_SCENE = "phmDashScene", KEY_MOTION = "phmDashSceneMotion";
  const SCENES = ["gtg","reb","flare","eng","all"];
  const read = k=>{ try{ return localStorage.getItem(k); }catch(e){ return null; } };
  const write = (k,v)=>{ try{ localStorage.setItem(k, v); }catch(e){ /* storage diblokir — pilihan cuma berlaku sesi ini */ } };

  let scene = SCENES.includes(read(KEY_SCENE)) ? read(KEY_SCENE) : "all";
  let paused = read(KEY_MOTION)==="0";

  function apply(){
    root.setAttribute("data-scene", scene);
    root.classList.toggle("is-paused", paused);
    root.querySelectorAll("[data-dscene]").forEach(b=>b.setAttribute("aria-pressed", String(b.getAttribute("data-dscene")===scene)));
    const pb = root.querySelector("[data-dscene-pause]");
    if(pb){
      const t = paused ? "Putar animasi latar" : "Jeda animasi latar";
      pb.setAttribute("aria-pressed", String(paused));
      pb.setAttribute("aria-label", t);
      pb.title = t;
    }
  }

  root.addEventListener("click", e=>{
    const b = e.target.closest("[data-dscene]");
    if(b){
      scene = b.getAttribute("data-dscene");
      write(KEY_SCENE, scene);
      apply();
      return;
    }
    if(e.target.closest("[data-dscene-pause]")){
      paused = !paused;
      write(KEY_MOTION, paused ? "0" : "1");
      apply();
    }
  });

  apply();
})();
