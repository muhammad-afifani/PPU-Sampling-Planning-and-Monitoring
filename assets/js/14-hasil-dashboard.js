/* =========================================================
   HASIL PEMANTAUAN — Dashboard page
========================================================= */
// Klasifikasi parameter: hanya 5 parameter emisi ini yang jadi objek baku mutu (NOx, CO, SO2,
// Partikulat, Opasitas) — sisanya (O2, CO2, suhu gas, laju alir) cuma data pendukung yang tidak
// pernah dibandingkan ke baku mutu, jadi dipisah di UI (optgroup, badge, dsb) supaya tidak
// disalahartikan sebagai parameter yang wajib comply.
// H2S ikut dimasukkan sebagai parameter dievaluasi thd baku mutu (bukan cuma parameter pendukung)
// karena Pasal 12 ayat (2) huruf b Permen LH 13/2009 menjadikan kandungan sulfur bahan bakar
// (didekati lewat H2S) sebagai baku mutu PENGGANTI SO2 bagi Turbin/Heater/Glycol Reboiler — jadi
// H2S punya ambang batas sendiri (0,5% berat, lihat field "standard" pada rekaman datanya).
const HD_EMISI_PARAMS = new Set(["NOx","CO","SO₂","Total Partikulat","Opasitas","H2S"]);
function hdIsEmisiParam(p){ return HD_EMISI_PARAMS.has(p); }
const HASIL_SITE_COLORS = {SPS:"#0ea5a0", HCA:"#3d78c9", CPU:"#e0554f", NPU:"#e8a33d", SPU:"#7c5cbf", BEKAPAI:"#3fb27f", BPN:"#64748b"};
const HD_PALETTE = ["#0ea5a0","#e0554f","#e8a33d","#3d78c9","#7c5cbf","#3fb27f","#c2478a","#8a5c11","#64748b","#2b7fb0","#a02a24","#1c7a4f"];
const HD_PERMEN_LABEL = {"PERMEN LH 13 2009":"Permen LH 13/2009 (Turbin/Heater/Flare)", "PERMEN LH 11 2021":"Permen LHK 11/2021 (Genset Diesel & Gas)"};

// State filter multi-pilih dashboard (chip Site & Jenis Sumber, checklist Titik/Cerobong) —
// terpisah dari filter single-value (parameter/permen/kapasitas/periode) yang cukup disimpan
// langsung di DOM <select>. hdFilterCollapsed & hdCerobongPanelOpen murni preferensi tampilan
// (reset saat reload, sama seperti pola save2LocalUiState lain di app ini).
let hdSel = { site: new Set(), sumber: new Set(), cerobong: new Set() };
let hdFilterCollapsed = false;
let hdCerobongPanelOpen = false;
let hdCompareMode = "nominal"; // "nominal" atau "percent", menentukan tampilan chart Perbandingan Antar Titik
let hdCorrParams = []; // maksimal 3 parameter yang dipilih untuk chart Tren Multi Parameter (Korelasi)
// Pemilih titik/engine KHUSUS untuk chart Korelasi, independen dari filter dashboard di atas (hdSel).
// Kosong berarti korelasi tetap ikut filter dashboard seperti biasa; kalau diisi, cakupan korelasi
// HANYA memakai titik yang dicentang di sini, supaya bisa melihat korelasi 1 engine tertentu saja
// tanpa perlu (dan tanpa terganggu oleh) filter Site/Jenis Sumber/Titik/Permen/Kapasitas di atas.
let hdCorrSel = { cerobong: new Set() };
let hdCorrCerobongPanelOpen = false;
function hdCorrVisibleCerobong(){
  const q = (document.getElementById("hdCorrCerobongSearch")?.value||"").toLowerCase();
  const all = hdAllValues("cerobong");
  return q ? all.filter(c=>c.toLowerCase().includes(q)) : all;
}
function hdCorrRenderCerobongChecklist(){
  const btn = document.getElementById("hdCorrCerobongBtnLabel");
  if(btn){
    const n = hdCorrSel.cerobong.size;
    btn.textContent = n===0 ? "Ikuti filter dashboard di atas" : `${n} titik dipilih, klik untuk mengubah`;
  }
  const list = document.getElementById("hdCorrCerobongList");
  if(!list) return;
  const visible = hdCorrVisibleCerobong();
  list.innerHTML = visible.length ? visible.map(c=>`<label class="xsel-opt"><input type="checkbox" class="hdCorrCerobongCheck" data-val="${escHtml(c)}" ${hdCorrSel.cerobong.has(c)?"checked":""}> ${escHtml(c)}</label>`).join("")
    : `<div class="xsel-empty">Tidak ada titik yang cocok pencarian.</div>`;
}
// Deskripsi cakupan filter dashboard yang sedang aktif, dipakai supaya chart Tren Multi Parameter
// dan panel statistik R kuadrat menyebutkan dengan jelas data mana yang dipakai, dan bagaimana
// nilainya dihitung apabila cakupan tersebut meliputi lebih dari satu titik atau jenis sumber.
function hdScopeDescription(){
  const parts = [];
  parts.push(hdSel.site.size ? `site ${[...hdSel.site].join(", ")}` : "seluruh site");
  parts.push(hdSel.sumber.size ? `jenis sumber ${[...hdSel.sumber].join(", ")}` : "seluruh jenis sumber");
  parts.push(hdSel.cerobong.size ? `${hdSel.cerobong.size} titik yang dicentang pada filter Titik atau Cerobong` : "seluruh titik pada cakupan tersebut");
  const permen = document.getElementById("hdFltPermen")?.value;
  if(permen) parts.push(HD_PERMEN_LABEL[permen] || permen);
  const kapasitas = document.getElementById("hdFltKapasitas")?.value;
  if(kapasitas) parts.push(`kapasitas ${kapasitas}`);
  const from = document.getElementById("hdFltPeriodeFrom")?.value, to = document.getElementById("hdFltPeriodeTo")?.value;
  if(from && to) parts.push(`periode ${from} sampai dengan ${to}`);
  return parts.join(", ");
}

function hdAllValues(field){
  return [...new Set(DB.hasilPemantauan.map(r=>r[field]))].filter(Boolean).sort();
}
// Opsi Titik/Cerobong yang ditawarkan menyempit mengikuti Site & Jenis Sumber & Permen &
// Kapasitas yang sedang aktif — supaya user tidak harus mencari di antara titik yang sudah pasti
// tidak relevan dengan kombinasi filter lain.
function hdAvailableCerobong(){
  const permen = document.getElementById("hdFltPermen")?.value || "";
  const kapasitas = document.getElementById("hdFltKapasitas")?.value || "";
  const set = new Set();
  DB.hasilPemantauan.forEach(r=>{
    if(hdSel.site.size && !hdSel.site.has(r.site)) return;
    if(hdSel.sumber.size && !hdSel.sumber.has(r.namaSumber)) return;
    if(permen && r.regulasiCek!==permen) return;
    if(kapasitas && r.kategoriKapasitas!==kapasitas) return;
    set.add(r.cerobong);
  });
  return [...set].sort();
}
function hdVisibleCerobongOptions(){
  const q = (document.getElementById("hdCerobongSearch")?.value||"").toLowerCase();
  const all = hdAvailableCerobong();
  return q ? all.filter(c=>c.toLowerCase().includes(q)) : all;
}
function hdRenderChipBar(field, values){
  const all = `<button type="button" class="chip-toggle all ${hdSel[field].size===0?'active':''}" data-action="hdChip" data-field="${field}" data-val="">Semua</button>`;
  return all + values.map(v=>`<button type="button" class="chip-toggle ${hdSel[field].has(v)?'active':''}" data-action="hdChip" data-field="${field}" data-val="${escHtml(v)}">${escHtml(v)}</button>`).join("");
}
// Checklist gaya Excel (centang + kotak cari) menggantikan <select multiple> — ctrl/cmd+klik di
// listbox native gampang bikin pilihan sebelumnya kehapus tanpa sadar. Dipanggil lagi tiap kali
// pencarian diketik ATAU centang berubah, jadi HANYA membangun ulang isi panel (bukan seluruh
// filter bar) supaya fokus input pencarian & posisi scroll list tidak hilang.
function hdRenderCerobongChecklist(){
  const all = hdAvailableCerobong();
  [...hdSel.cerobong].forEach(c=>{ if(!all.includes(c)) hdSel.cerobong.delete(c); });
  const btn = document.getElementById("hdCerobongBtnLabel");
  if(btn){
    const n = hdSel.cerobong.size;
    btn.textContent = n===0 ? "Semua titik, tidak difilter" : `${n} titik dipilih, klik untuk mengubah`;
  }
  const list = document.getElementById("hdCerobongList");
  if(!list) return;
  const visible = hdVisibleCerobongOptions();
  list.innerHTML = visible.length ? visible.map(c=>`<label class="xsel-opt"><input type="checkbox" class="hdCerobongCheck" data-val="${escHtml(c)}" ${hdSel.cerobong.has(c)?"checked":""}> ${escHtml(c)}</label>`).join("")
    : `<div class="xsel-empty">Tidak ada titik yang cocok filter/pencarian.</div>`;
}
function renderHdFilterBar(){
  const sites = hdAllValues("site");
  const sumbers = hdAllValues("namaSumber");
  const kapasitasList = hdAllValues("kategoriKapasitas");
  const periods = [...new Set(DB.hasilPemantauan.map(r=>r.periode))].sort((a,b)=>hasilPeriodParts(a).order-hasilPeriodParts(b).order);
  const params = hdAllValues("parameter");
  const emisiParams = params.filter(hdIsEmisiParam);
  const pendukungParams = params.filter(p=>!hdIsEmisiParam(p));

  document.getElementById("hdFilterBarWrap").classList.toggle("collapsed", hdFilterCollapsed);
  const collapseBtn = document.getElementById("hdFilterCollapseBtn");
  if(collapseBtn) collapseBtn.textContent = hdFilterCollapsed ? "Tampilkan Filter" : "Ciutkan Filter";

  const bar = document.getElementById("hdFilterBar");
  if(!bar) return {sites, periods};
  const curParam = document.getElementById("hdFltParameter")?.value || "";
  const curPermen = document.getElementById("hdFltPermen")?.value || "";
  const curKapasitas = document.getElementById("hdFltKapasitas")?.value || "";
  const curFrom = document.getElementById("hdFltPeriodeFrom")?.value || "";
  const curTo = document.getElementById("hdFltPeriodeTo")?.value || "";
  const curSearch = document.getElementById("hdCerobongSearch")?.value || "";
  const listScroll = document.getElementById("hdCerobongList")?.scrollTop || 0;

  bar.innerHTML = `
    <div class="card">
      <div class="toolbar">
        <div class="field"><label>Parameter</label><select id="hdFltParameter">
          <optgroup label="Emisi, dievaluasi terhadap baku mutu">${emisiParams.map(p=>`<option value="${escHtml(p)}">${escHtml(p)}</option>`).join("")}</optgroup>
          <optgroup label="Parameter pendukung, bukan objek baku mutu">${pendukungParams.map(p=>`<option value="${escHtml(p)}">${escHtml(p)}</option>`).join("")}</optgroup>
        </select></div>
        <div class="field"><label>Dari Periode</label><select id="hdFltPeriodeFrom">${periods.map(p=>`<option value="${p}">${p}</option>`).join("")}</select></div>
        <div class="field"><label>Sampai Periode</label><select id="hdFltPeriodeTo">${periods.map(p=>`<option value="${p}">${p}</option>`).join("")}</select></div>
        <div class="field"><label>Permen atau Regulasi</label><select id="hdFltPermen">
          <option value="">Semua Regulasi</option>
          <option value="PERMEN LH 13 2009">${HD_PERMEN_LABEL["PERMEN LH 13 2009"]}</option>
          <option value="PERMEN LH 11 2021">${HD_PERMEN_LABEL["PERMEN LH 11 2021"]}</option>
        </select></div>
        <div class="field"><label>Kapasitas</label><select id="hdFltKapasitas">
          <option value="">Semua Kapasitas</option>
          ${kapasitasList.map(k=>`<option value="${escHtml(k)}">${escHtml(k)}</option>`).join("")}
        </select></div>
        <div class="field" style="min-width:220px;">
          <label>Titik atau Cerobong, centang untuk membandingkan</label>
          <div class="xsel" id="hdCerobongXsel">
            <button type="button" class="xsel-btn" data-action="hdToggleCerobongPanel"><span id="hdCerobongBtnLabel">Semua titik, tidak difilter</span> <span>&#9662;</span></button>
            <div class="xsel-panel" id="hdCerobongPanel" style="display:none;">
              <input type="text" id="hdCerobongSearch" placeholder="cari nama titik atau cerobong" value="${escHtml(curSearch)}">
              <div class="xsel-toolbar">
                <button type="button" class="btn small ghost" data-action="hdCerobongCheckAll">Centang Semua yang Tampil</button>
                <button type="button" class="btn small ghost" data-action="hdCerobongUncheckAll">Kosongkan</button>
              </div>
              <div class="xsel-list" id="hdCerobongList"></div>
            </div>
          </div>
        </div>
      </div>
      <div class="field" style="margin-bottom:6px;">
        <label>Site</label>
        <div class="chipbar">${hdRenderChipBar("site", sites)}</div>
      </div>
      <div class="field">
        <label>Jenis Sumber Emisi, Kelompok Engine</label>
        <div class="chipbar">${hdRenderChipBar("sumber", sumbers)}</div>
      </div>
    </div>`;

  document.getElementById("hdFltParameter").value = curParam;
  document.getElementById("hdFltPermen").value = curPermen;
  document.getElementById("hdFltKapasitas").value = curKapasitas;
  if(!document.getElementById("hdFltParameter").value){
    // default ke parameter emisi yang paling banyak punya baku mutu (NOx biasanya)
    const withStd = emisiParams.find(p=> DB.hasilPemantauan.some(r=>r.parameter===p && r.standard!=null)) || params[0];
    document.getElementById("hdFltParameter").value = withStd;
  }
  const fromSel = document.getElementById("hdFltPeriodeFrom"), toSel = document.getElementById("hdFltPeriodeTo");
  fromSel.value = periods.includes(curFrom) ? curFrom : (periods[0]||"");
  toSel.value = periods.includes(curTo) ? curTo : (periods[periods.length-1]||"");

  const panel = document.getElementById("hdCerobongPanel");
  if(panel && hdCerobongPanelOpen) panel.style.display = "block";
  hdRenderCerobongChecklist();
  const listEl = document.getElementById("hdCerobongList");
  if(listEl) listEl.scrollTop = listScroll;
  return {sites, periods};
}

function hasilDashboardFiltered(){
  const parameter = document.getElementById("hdFltParameter").value;
  const from = document.getElementById("hdFltPeriodeFrom").value;
  const to = document.getElementById("hdFltPeriodeTo").value;
  const permen = document.getElementById("hdFltPermen")?.value || "";
  const kapasitas = document.getElementById("hdFltKapasitas")?.value || "";
  const fromOrder = from ? hasilPeriodParts(from).order : -Infinity;
  const toOrder = to ? hasilPeriodParts(to).order : Infinity;
  return DB.hasilPemantauan.filter(r=>{
    if(parameter && r.parameter!==parameter) return false;
    if(hdSel.site.size && !hdSel.site.has(r.site)) return false;
    if(hdSel.sumber.size && !hdSel.sumber.has(r.namaSumber)) return false;
    if(hdSel.cerobong.size && !hdSel.cerobong.has(r.cerobong)) return false;
    if(permen && r.regulasiCek!==permen) return false;
    if(kapasitas && r.kategoriKapasitas!==kapasitas) return false;
    if(r.periodeOrder<fromOrder || r.periodeOrder>toOrder) return false;
    return true;
  });
}
// Sama seperti hasilDashboardFiltered tapi tanpa filter parameter — dipakai Profil Multi-Parameter
// supaya semua parameter titik terpilih ikut muncul, bukan cuma parameter yang lagi dipilih di atas.
function hasilDashboardFilteredAllParams(){
  const from = document.getElementById("hdFltPeriodeFrom").value;
  const to = document.getElementById("hdFltPeriodeTo").value;
  const permen = document.getElementById("hdFltPermen")?.value || "";
  const kapasitas = document.getElementById("hdFltKapasitas")?.value || "";
  const fromOrder = from ? hasilPeriodParts(from).order : -Infinity;
  const toOrder = to ? hasilPeriodParts(to).order : Infinity;
  return DB.hasilPemantauan.filter(r=>{
    if(hdSel.site.size && !hdSel.site.has(r.site)) return false;
    if(hdSel.sumber.size && !hdSel.sumber.has(r.namaSumber)) return false;
    if(hdSel.cerobong.size && !hdSel.cerobong.has(r.cerobong)) return false;
    if(permen && r.regulasiCek!==permen) return false;
    if(kapasitas && r.kategoriKapasitas!==kapasitas) return false;
    if(r.periodeOrder<fromOrder || r.periodeOrder>toOrder) return false;
    return true;
  });
}
// Hitung jumlah titik/engine unik yang lolos kombinasi filter aktif (site/sumber/cerobong/permen/
// kapasitas/periode) TANPA ikut membatasi ke parameter yang lagi dipilih — soalnya identitas satu
// engine tidak tergantung parameter mana yang sedang dilihat. Dipecah per site sesuai permintaan.
function hdRenderEngineCounts(filteredAllParams){
  const seen = new Set(); const bySite = {};
  filteredAllParams.forEach(r=>{
    const key = r.site+"||"+r.cerobong;
    if(seen.has(key)) return; seen.add(key);
    bySite[r.site] = (bySite[r.site]||0)+1;
  });
  const total = seen.size;
  const perSite = Object.entries(bySite).sort((a,b)=>b[1]-a[1]).map(([s,n])=>`<span class="hd-engine-count-badge">${escHtml(s)}: ${n}</span>`).join("");
  document.getElementById("hdEngineCounts").innerHTML = `<span class="hd-engine-count-badge" style="background:var(--teal-100);border-color:var(--teal-500);color:#0b6b66;">Total ${total} titik/engine</span>${perSite}`;
}
function renderHasilDashboard(){
  const {sites, periods} = renderHdFilterBar();
  const filtered = hasilDashboardFiltered();
  const filteredAllParams = hasilDashboardFilteredAllParams();
  const parameter = document.getElementById("hdFltParameter").value;
  document.getElementById("hdTrendParamLabel").textContent = parameter ? "— "+parameter : "";
  const fromPeriodeVal = document.getElementById("hdFltPeriodeFrom").value, toPeriodeVal = document.getElementById("hdFltPeriodeTo").value;
  const fromOrder = fromPeriodeVal ? hasilPeriodParts(fromPeriodeVal).order : -Infinity;
  const toOrder = toPeriodeVal ? hasilPeriodParts(toPeriodeVal).order : Infinity;

  const measured = filtered.filter(r=>r.resultNumeric!=null);
  const withStd = filtered.filter(r=>r.statusBakuMutu==="ok"||r.statusBakuMutu==="exceed");
  const okCount = filtered.filter(r=>r.statusBakuMutu==="ok").length;
  const exceedCount = filtered.filter(r=>r.statusBakuMutu==="exceed").length;
  const compliance = withStd.length ? Math.round(okCount/withStd.length*1000)/10 : null;
  const periodsInScope = [...new Set(filtered.map(r=>r.periode))].sort((a,b)=>hasilPeriodParts(a).order-hasilPeriodParts(b).order);
  const periodsInScopeAll = [...new Set(filteredAllParams.map(r=>r.periode))].sort((a,b)=>hasilPeriodParts(a).order-hasilPeriodParts(b).order);

  document.getElementById("hdStats").innerHTML = `
    <div class="stat"><div class="num">${filtered.length}</div><div class="lbl">Total Data Terfilter</div></div>
    <div class="stat"><div class="num">${measured.length}</div><div class="lbl">Data Terukur</div></div>
    <div class="stat ${compliance==null?'':(compliance>=95?'good':compliance>=80?'warn':'bad')}"><div class="num">${compliance!=null?compliance+"%":"-"}</div><div class="lbl">Tingkat Kepatuhan Baku Mutu</div></div>
    <div class="stat ${exceedCount>0?'bad':'good'}"><div class="num">${exceedCount}</div><div class="lbl">Melebihi Baku Mutu</div></div>
  `;
  document.getElementById("hdFilterSummary").textContent = `Menampilkan ${filtered.length} baris data (dari total ${DB.hasilPemantauan.length} baris) sesuai kombinasi filter aktif.`;
  hdRenderEngineCounts(filteredAllParams);

  document.getElementById("hdTrendChart").innerHTML = buildHasilTrendChart(filtered, parameter, periodsInScope, sites, hdSel.site, hdSel.cerobong);
  document.getElementById("hdTrendLegend").innerHTML = buildHasilTrendLegend(filtered, hdSel.site, sites, hdSel.cerobong);
  const donut = buildHasilDonutChart(filtered);
  document.getElementById("hdDonutChart").innerHTML = donut.svg;
  document.getElementById("hdDonutLegend").innerHTML = donut.legend;
  document.getElementById("hdRankChart").innerHTML = buildHasilRankChart(filtered, parameter, periodsInScope);
  document.getElementById("hdSiteChart").innerHTML = buildHasilSiteChart(filtered, parameter);

  document.getElementById("hdCompareModeToggle").innerHTML = `
    <div class="toolbar" style="margin:0;gap:6px;">
      <button type="button" class="btn small ${hdCompareMode==='nominal'?'primary':'ghost'}" data-action="hdSetCompareMode" data-mode="nominal">Nilai Nominal</button>
      <button type="button" class="btn small ${hdCompareMode==='percent'?'primary':'ghost'}" data-action="hdSetCompareMode" data-mode="percent">% Baku Mutu</button>
    </div>`;
  const compareResult = buildHasilCompareChart(filtered, parameter, periodsInScope, hdSel.cerobong, hdCompareMode);
  document.getElementById("hdCompareChart").innerHTML = compareResult.svg;
  document.getElementById("hdCompareUnitNote").innerHTML = compareResult.unitNote;
  document.getElementById("hdCompareParamLabel").textContent = parameter || "-";
  document.getElementById("hdProfileChart").innerHTML = buildHasilEngineProfile(filteredAllParams, hdSel.cerobong, periodsInScopeAll);
  document.getElementById("hdProfileTitleLabel").textContent = hdSel.cerobong.size ? `(${hdSel.cerobong.size} titik terpilih)` : "";

  hdRenderSimulationFilters();
  renderH2SSection();

  // Titik/Engine khusus Korelasi (hdCorrSel) independen dari filter dashboard di atas — kalau
  // dicentang, cakupan data korelasi HANYA memakai titik yang dicentang di sini (tetap dibatasi
  // rentang periode aktif), mengabaikan Site/Jenis Sumber/Titik/Permen/Kapasitas di filter utama.
  // Kalau kosong (default), korelasi tetap ikut filter dashboard seperti sebelumnya.
  hdCorrRenderCerobongChecklist();
  const corrUsesOwnScope = hdCorrSel.cerobong.size>0;
  const corrDataScope = corrUsesOwnScope
    ? DB.hasilPemantauan.filter(r=>hdCorrSel.cerobong.has(r.cerobong) && r.periodeOrder>=fromOrder && r.periodeOrder<=toOrder)
    : filteredAllParams;
  const periodsInScopeCorr = [...new Set(corrDataScope.map(r=>r.periode))].sort((a,b)=>hasilPeriodParts(a).order-hasilPeriodParts(b).order);

  const allParamsList = hdAllValues("parameter");
  const corrScopeLabel = corrUsesOwnScope
    ? `${hdCorrSel.cerobong.size} titik yang dipilih pada "Titik atau Engine Khusus untuk Korelasi" (${[...hdCorrSel.cerobong].join(", ")}), periode ${fromPeriodeVal} sampai dengan ${toPeriodeVal}`
    : hdScopeDescription();
  document.getElementById("hdCorrScopeNote").textContent = corrUsesOwnScope
    ? `Data yang dipakai pada grafik dan analisis di bawah ini HANYA dari ${hdCorrSel.cerobong.size} titik yang dipilih pada "Titik atau Engine Khusus untuk Korelasi" di bawah, tidak mengikuti filter dashboard di bagian atas. Rentang periode tetap mengikuti filter Dari Periode/Sampai Periode di atas.`
    : `Data yang dipakai pada grafik dan analisis di bawah ini mengikuti filter dashboard yang sedang aktif, yaitu ${hdScopeDescription()}. Apabila cakupan tersebut meliputi lebih dari satu titik, nilai pada tiap periode dihitung sebagai rata rata dari seluruh titik yang termasuk dalam cakupan tersebut. Untuk melihat satu titik tertentu secara spesifik, gunakan pemilih "Titik atau Engine Khusus untuk Korelasi" di bawah ini.`;
  document.getElementById("hdCorrParamPicker").innerHTML = hdRenderCorrPicker(allParamsList);
  document.getElementById("hdCorrChart").innerHTML = buildHasilCorrelationChart(corrDataScope, periodsInScopeCorr, hdCorrParams);
  document.getElementById("hdCorrLegend").innerHTML = buildHasilCorrelationLegend(hdCorrParams, corrDataScope);
  document.getElementById("hdCorrStats").innerHTML = buildHasilCorrelationStats(corrDataScope, hdCorrParams, corrScopeLabel);

  const detail = filtered.slice().sort((a,b)=>b.periodeOrder-a.periodeOrder).slice(0,300);
  document.getElementById("hdDetailTable").innerHTML = `
    <thead><tr><th>Cerobong</th><th>Site</th><th>Periode</th><th>Parameter</th><th>Hasil</th><th>Baku Mutu</th><th>Status</th></tr></thead>
    <tbody>${detail.map(r=>{
      const badge = HASIL_STATUS_BADGE[r.statusBakuMutu] || HASIL_STATUS_BADGE.not_evaluated;
      return `<tr><td>${escHtml(r.cerobong)}</td><td>${r.site}</td><td>${r.periode}</td><td>${escHtml(r.parameter)}</td>
        <td style="font-family:var(--font-mono);">${escHtml(r.resultRaw)} ${escHtml(r.unit)}</td><td class="muted">${r.standard!=null?r.standard:"-"}</td>
        <td><span class="badge ${badge[0]}">${badge[1]}</span></td></tr>`;
    }).join("")}</tbody>`;
  document.getElementById("hdDetailCount").textContent = "Menampilkan "+detail.length+" dari "+filtered.length+" baris terfilter (urut periode terbaru).";
}
["hdFltParameter","hdFltPeriodeFrom","hdFltPeriodeTo","hdFltPermen","hdFltKapasitas"].forEach(id=>{
  document.addEventListener("change", e=>{ if(e.target.id===id) renderHasilDashboard(); });
});
// Checklist Titik/Cerobong: centang langsung update state + render ulang seluruh dashboard
// (panel & posisi scroll listnya dipertahankan lewat renderHdFilterBar, lihat hdCerobongPanelOpen).
document.addEventListener("change", e=>{
  if(e.target.classList?.contains("hdCerobongCheck")){
    const val = e.target.dataset.val;
    if(e.target.checked) hdSel.cerobong.add(val); else hdSel.cerobong.delete(val);
    renderHasilDashboard();
  }
});
// Mengetik di kotak cari cukup membangun ulang isi panel checklist (bukan seluruh dashboard) —
// supaya fokus & kursor input pencarian tidak hilang tiap huruf diketik.
document.addEventListener("input", e=>{ if(e.target.id==="hdCerobongSearch") hdRenderCerobongChecklist(); });
// Klik di luar panel checklist Titik/Cerobong menutupnya (perilaku dropdown pada umumnya).
document.addEventListener("click", e=>{
  if(hdCerobongPanelOpen && !e.target.closest("#hdCerobongXsel")){
    hdCerobongPanelOpen = false;
    const p = document.getElementById("hdCerobongPanel");
    if(p) p.style.display = "none";
  }
  if(simCerobongPanelOpen && !e.target.closest("#simCerobongXsel")){
    simCerobongPanelOpen = false;
    const p = document.getElementById("simCerobongPanel");
    if(p) p.style.display = "none";
  }
  if(hdCorrCerobongPanelOpen && !e.target.closest("#hdCorrCerobongXsel")){
    hdCorrCerobongPanelOpen = false;
    const p = document.getElementById("hdCorrCerobongPanel");
    if(p) p.style.display = "none";
  }
});
// Checklist Titik/Engine khusus Korelasi — terpisah dari checklist filter dashboard di atas,
// mengikuti pola yang sama (centang tidak menutup panel, mengetik hanya membangun ulang isi panel).
document.addEventListener("change", e=>{
  if(e.target.classList?.contains("hdCorrCerobongCheck")){
    const val = e.target.dataset.val;
    if(e.target.checked) hdCorrSel.cerobong.add(val); else hdCorrSel.cerobong.delete(val);
    renderHasilDashboard();
  }
});
document.addEventListener("input", e=>{ if(e.target.id==="hdCorrCerobongSearch") hdCorrRenderCerobongChecklist(); });
// Checklist Titik/Cerobong pada bagian Simulasi bekerja terpisah dari checklist filter dashboard
// di atas, mengikuti pola yang sama: centang memperbarui state tanpa menutup panel, mengetik pada
// kotak cari hanya membangun ulang isi panel, dan mengganti lingkup (parameter, jenis sumber, dan
// seterusnya) akan memperbarui daftar titik yang tersedia.
document.addEventListener("change", e=>{
  if(e.target.classList?.contains("simCerobongCheck")){
    const val = e.target.dataset.val;
    if(e.target.checked) simSel.cerobong.add(val); else simSel.cerobong.delete(val);
    simRenderCerobongChecklist();
  }
  if(["simParam","simKapasitas","simBahanBakar"].includes(e.target.id)) simRenderCerobongChecklist();
});
document.addEventListener("input", e=>{ if(e.target.id==="simCerobongSearch") simRenderCerobongChecklist(); });

function buildHasilTrendChart(filtered, parameter, periodsInScope, allSites, selectedSites, selectedCerobong){
  if(!parameter || !periodsInScope.length) return "<div class='hint' style='padding:14px;'>Pilih parameter untuk melihat tren.</div>";
  const dataByParam = filtered.filter(r=>r.parameter===parameter && r.resultNumeric!=null);
  if(!dataByParam.length) return "<div class='hint' style='padding:14px;'>Tidak ada data terukur untuk parameter ini pada rentang/filter saat ini.</div>";
  // Mode perbandingan: kalau ada titik/cerobong spesifik dipilih, plot per-cerobong (biar bisa
  // membandingkan langsung antar engine) — kalau tidak, fallback ke agregat per-site seperti semula.
  const compareMode = selectedCerobong && selectedCerobong.size>0;
  let seriesKeys, keyFn, colorFn;
  if(compareMode){
    seriesKeys = [...selectedCerobong].filter(c=>dataByParam.some(r=>r.cerobong===c));
    keyFn = r=>r.cerobong;
    colorFn = (k,i)=>HD_PALETTE[i%HD_PALETTE.length];
  }else{
    seriesKeys = selectedSites && selectedSites.size ? [...selectedSites].filter(s=>allSites.includes(s)) : allSites.filter(s=>dataByParam.some(r=>r.site===s));
    keyFn = r=>r.site;
    colorFn = k=>HASIL_SITE_COLORS[k]||"#7f8fa0";
  }
  if(!seriesKeys.length) return "<div class='hint' style='padding:14px;'>Tidak ada data untuk kombinasi filter ini.</div>";

  const stdVals = dataByParam.map(r=>r.standard).filter(v=>v!=null);
  const standardRef = stdVals.length ? stdVals.sort((a,b)=>a-b)[Math.floor(stdVals.length/2)] : null;

  const W=760,H=300,padL=54,padR=16,padT=18,padB=34;
  const plotW=W-padL-padR, plotH=H-padT-padB;
  const n = periodsInScope.length;

  let maxY = Math.max(...dataByParam.map(r=>r.resultNumeric), standardRef||0) * 1.15;
  if(!isFinite(maxY) || maxY<=0) maxY = 100;

  function xFor(i){ return padL + (n<=1?plotW/2:(i/(n-1))*plotW); }
  function yFor(v){ return padT + plotH - (v/maxY)*plotH; }

  let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;font-size:11.5px;background:var(--surface-card);border:1px solid var(--gray-200);border-radius:10px;">`;
  for(let g=0; g<=4; g++){
    const y = padT + plotH - (g/4)*plotH;
    svg += `<line x1="${padL}" y1="${y}" x2="${W-padR}" y2="${y}" stroke="var(--gray-200)"/>`;
    svg += `<text x="2" y="${y+4}" fill="var(--gray-500)">${Math.round(maxY*g/4)}</text>`;
  }
  periodsInScope.forEach((p,i)=>{ svg += `<text x="${xFor(i)}" y="${H-10}" text-anchor="middle" fill="var(--gray-500)">${p}</text>`; });

  if(standardRef){
    const ys = yFor(standardRef);
    svg += `<line x1="${padL}" y1="${ys}" x2="${W-padR}" y2="${ys}" stroke="#e0554f" stroke-width="1.5" stroke-dasharray="6,4"/>`;
    svg += `<text x="${W-padR-2}" y="${ys-5}" text-anchor="end" fill="#e0554f" font-weight="700">Baku Mutu ${standardRef}</text>`;
  }

  seriesKeys.forEach((key,i)=>{
    const color = colorFn(key,i);
    const pts = periodsInScope.map((p,pi)=>{
      const vals = dataByParam.filter(r=>keyFn(r)===key && r.periode===p).map(r=>r.resultNumeric);
      if(!vals.length) return null;
      const avg = vals.reduce((a,b)=>a+b,0)/vals.length;
      return [xFor(pi), yFor(avg)];
    });
    const validPts = pts.map((pt,pi)=>pt?[pi,pt]:null).filter(Boolean);
    if(validPts.length<1) return;
    let path = "";
    validPts.forEach(([pi,pt],k)=>{ path += (k===0?"M":"L")+pt[0]+","+pt[1]+" "; });
    svg += `<path d="${path.trim()}" fill="none" stroke="${color}" stroke-width="2.5"/>`;
    validPts.forEach(([pi,pt])=>{ svg += `<circle cx="${pt[0]}" cy="${pt[1]}" r="3.5" fill="${color}"/>`; });
  });
  svg += `</svg>`;
  return svg;
}
function buildHasilTrendLegend(filtered, selectedSites, allSites, selectedCerobong){
  const compareMode = selectedCerobong && selectedCerobong.size>0;
  let items;
  if(compareMode){
    items = [...selectedCerobong].map((c,i)=>({label:c, color:HD_PALETTE[i%HD_PALETTE.length]}));
  }else{
    const sitesToPlot = selectedSites && selectedSites.size ? [...selectedSites] : allSites.filter(s=>filtered.some(r=>r.site===s));
    items = sitesToPlot.map(s=>({label:s, color:HASIL_SITE_COLORS[s]||"#7f8fa0"}));
  }
  return items.map(it=>`<span class="item"><span class="sw" style="background:${it.color}"></span>${escHtml(it.label)}</span>`).join("")
    + `<span class="item"><span class="sw" style="background:#e0554f;opacity:.5;"></span>Baku Mutu (referensi)</span>`;
}
function buildHasilDonutChart(filtered){
  const withStd = filtered.filter(r=>r.statusBakuMutu==="ok"||r.statusBakuMutu==="exceed");
  const ok = filtered.filter(r=>r.statusBakuMutu==="ok").length;
  const exceed = filtered.filter(r=>r.statusBakuMutu==="exceed").length;
  const na = filtered.filter(r=>r.statusBakuMutu==="not_applicable").length;
  const ne = filtered.filter(r=>r.statusBakuMutu==="not_evaluated").length;
  const total = ok+exceed+na+ne;
  if(!total) return {svg:"<div class='hint' style='padding:14px;'>Tidak ada data pada filter ini.</div>", legend:""};
  const segs = [["ok",ok,"#3fb27f"],["exceed",exceed,"#e0554f"],["not_applicable",na,"#c8d2db"],["not_evaluated",ne,"#e8a33d"]].filter(s=>s[1]>0);
  const cx=110,cy=110,r=80,rInner=48;
  let paths = "";
  if(segs.length===1){
    // Kasus satu segmen penuh (mis. kepatuhan 100%) — arc SVG sweep 360° dianggap degenerate
    // (titik awal = titik akhir) sehingga path-nya tidak tergambar sama sekali. Pakai <circle>
    // berstroke sbg gantinya supaya donut tetap tampil walau isinya cuma satu warna.
    const color = segs[0][2];
    const rMid = (r+rInner)/2, strokeW = r-rInner;
    paths = `<circle cx="${cx}" cy="${cy}" r="${rMid}" fill="none" stroke="${color}" stroke-width="${strokeW}"/>`;
  }else{
    let angle=-90;
    segs.forEach(([key,val,color])=>{
      const frac = val/total, sweep = frac*360;
      const x1 = cx + r*Math.cos(angle*Math.PI/180), y1 = cy + r*Math.sin(angle*Math.PI/180);
      const endAngle = angle+sweep;
      const x2 = cx + r*Math.cos(endAngle*Math.PI/180), y2 = cy + r*Math.sin(endAngle*Math.PI/180);
      const large = sweep>180?1:0;
      const xi1 = cx + rInner*Math.cos(angle*Math.PI/180), yi1 = cy + rInner*Math.sin(angle*Math.PI/180);
      const xi2 = cx + rInner*Math.cos(endAngle*Math.PI/180), yi2 = cy + rInner*Math.sin(endAngle*Math.PI/180);
      paths += `<path d="M${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2} L${xi2},${yi2} A${rInner},${rInner} 0 ${large} 0 ${xi1},${yi1} Z" fill="${color}"/>`;
      angle = endAngle;
    });
  }
  const svg = `<svg viewBox="0 0 220 220" style="width:220px;height:220px;display:block;margin:0 auto;">
    ${paths}
    <text x="110" y="104" text-anchor="middle" font-size="24" font-weight="800" fill="var(--navy-900)">${Math.round(ok/total*100)}%</text>
    <text x="110" y="124" text-anchor="middle" font-size="11" fill="var(--gray-500)">memenuhi</text>
  </svg>`;
  const labels = {ok:["Memenuhi Baku Mutu","#3fb27f"], exceed:["Melebihi Baku Mutu","#e0554f"], not_applicable:["Tidak Ada Baku Mutu","#c8d2db"], not_evaluated:["Belum Dievaluasi","#e8a33d"]};
  const legend = segs.map(([key,val])=>`<span class="item"><span class="sw" style="background:${labels[key][1]}"></span>${labels[key][0]}: ${val}</span>`).join("");
  return {svg, legend};
}
function buildHasilRankChart(filtered, parameter, periodsInScope){
  if(!parameter || !periodsInScope.length) return "<div class='hint' style='padding:14px;'>Pilih parameter untuk melihat ranking.</div>";
  const lastPeriod = periodsInScope[periodsInScope.length-1];
  const rows = filtered.filter(r=>r.parameter===parameter && r.periode===lastPeriod && r.pctOfStandard!=null)
    .sort((a,b)=>b.pctOfStandard-a.pctOfStandard).slice(0,15);
  if(!rows.length) return `<div class='hint' style='padding:14px;'>Tidak ada data dengan baku mutu untuk ${escHtml(parameter)} pada periode ${lastPeriod}.</div>`;
  const W=560, rowH=26, padL=200, padR=50, topPad=10;
  const H = topPad + rows.length*rowH + 10;
  const maxPct = Math.max(100, ...rows.map(r=>r.pctOfStandard))*1.05;
  const plotW = W-padL-padR;
  let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;font-size:11px;background:var(--surface-card);border:1px solid var(--gray-200);border-radius:10px;">`;
  rows.forEach((r,i)=>{
    const y = topPad + i*rowH;
    const barLen = (r.pctOfStandard/maxPct)*plotW;
    const color = r.pctOfStandard>=100?"#e0554f":r.pctOfStandard>=80?"#e8a33d":"#3fb27f";
    svg += `<text x="${padL-8}" y="${y+rowH/2+4}" text-anchor="end" fill="var(--gray-900)">${escHtml(r.cerobong)}</text>`;
    svg += `<rect x="${padL}" y="${y+4}" width="${Math.max(2,barLen)}" height="${rowH-10}" rx="4" fill="${color}"/>`;
    svg += `<text x="${padL+barLen+6}" y="${y+rowH/2+4}" fill="var(--gray-900)" font-weight="700">${r.pctOfStandard}%</text>`;
  });
  const x100 = padL + (100/maxPct)*plotW;
  svg += `<line x1="${x100}" y1="0" x2="${x100}" y2="${H}" stroke="#e0554f" stroke-width="1" stroke-dasharray="3,3" opacity="0.6"/>`;
  svg += `</svg>`;
  return svg;
}
function buildHasilSiteChart(filtered, parameter){
  if(!parameter) return "<div class='hint' style='padding:14px;'>Pilih parameter untuk melihat perbandingan site.</div>";
  const bySite = {};
  filtered.filter(r=>r.parameter===parameter && r.pctOfStandard!=null).forEach(r=>{ (bySite[r.site]=bySite[r.site]||[]).push(r.pctOfStandard); });
  const sites = Object.keys(bySite);
  if(!sites.length) return "<div class='hint' style='padding:14px;'>Tidak ada data dengan baku mutu untuk parameter ini.</div>";
  const avgs = sites.map(s=>({site:s, avg: bySite[s].reduce((a,b)=>a+b,0)/bySite[s].length, n: bySite[s].length})).sort((a,b)=>b.avg-a.avg);
  const W=520, barH=30, gap=12, padL=90, padR=60, topPad=10;
  const H = topPad + avgs.length*(barH+gap);
  const maxPct = Math.max(100, ...avgs.map(a=>a.avg))*1.05;
  const plotW = W-padL-padR;
  let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;font-size:11.5px;background:var(--surface-card);border:1px solid var(--gray-200);border-radius:10px;">`;
  avgs.forEach((a,i)=>{
    const y = topPad + i*(barH+gap);
    const barLen = (a.avg/maxPct)*plotW;
    const color = HASIL_SITE_COLORS[a.site] || "#7f8fa0";
    svg += `<text x="${padL-8}" y="${y+barH/2+4}" text-anchor="end" fill="var(--gray-900)" font-weight="700">${a.site}</text>`;
    svg += `<rect x="${padL}" y="${y}" width="${Math.max(2,barLen)}" height="${barH}" rx="6" fill="${color}"/>`;
    svg += `<text x="${padL+barLen+6}" y="${y+barH/2+4}" fill="var(--gray-900)">${Math.round(a.avg*10)/10}% <tspan fill="#9db3c9" font-size="10px">(n=${a.n})</tspan></text>`;
  });
  svg += `</svg>`;
  return svg;
}
// Bar chart pembanding langsung antar titik/engine yang dipilih user di filter Titik & Cerobong,
// untuk parameter yang sedang aktif di dropdown Parameter. Kalau parameter itu punya baku mutu
// (emisi), dibandingkan pakai %BM; kalau parameter pendukung (tidak ada baku mutu), dibandingkan
// pakai nilai mentahnya (mis. suhu gas dalam oC).
// mode "nominal" = nilai hasil apa adanya (default — lebih gampang dibaca insinyur lapangan
// dibanding %), mode "percent" opsional kalau mau lihat kedekatan ke baku mutu. Kalau parameter
// pendukung (tidak ada baku mutu) dipilih, otomatis nominal walau toggle di-set "percent".
function buildHasilCompareChart(filtered, parameter, periodsInScope, selectedCerobong, mode){
  if(!selectedCerobong || !selectedCerobong.size) return {svg:"<div class='hint' style='padding:14px;'>Pilih 1 atau lebih Titik/Cerobong pada filter di atas untuk membandingkan langsung antar engine di sini.</div>", unitNote:""};
  if(!parameter || !periodsInScope.length) return {svg:"<div class='hint' style='padding:14px;'>Pilih parameter untuk melihat perbandingan.</div>", unitNote:""};
  const lastPeriod = periodsInScope[periodsInScope.length-1];
  const rows = [...selectedCerobong].map(c=>{
    const rec = filtered.find(r=>r.cerobong===c && r.parameter===parameter && r.periode===lastPeriod);
    return rec ? {cerobong:c, pct:rec.pctOfStandard, val:rec.resultNumeric, unit:rec.unit, standard:rec.standard, status:rec.statusBakuMutu} : null;
  }).filter(Boolean);
  if(!rows.length) return {svg:`<div class='hint' style='padding:14px;'>Tidak ada data ${escHtml(parameter)} pada periode ${lastPeriod} untuk titik yang dipilih.</div>`, unitNote:""};
  const hasStd = rows.some(r=>r.pct!=null);
  const useStd = mode==="percent" && hasStd;
  const metric = r=> useStd ? (r.pct!=null?r.pct:0) : (r.val!=null?r.val:0);
  rows.sort((a,b)=>metric(b)-metric(a));
  // W/padR dilebihkan + label diringkas (satuan dipindah ke keterangan di atas chart, bukan
  // diulang tiap baris) supaya angka tidak lagi kepotong viewBox seperti sebelumnya. Sebagai
  // jaring pengaman tambahan, kalau perkiraan lebar teks tetap akan melewati tepi kanvas, teks
  // dipindah ke DALAM bar (rata kanan, putih) alih-alih dipotong.
  const W=600, barH=28, gap=10, padL=170, padR=118, topPad=10;
  const H = topPad + rows.length*(barH+gap);
  const maxV = Math.max(useStd?100:1, ...rows.map(metric))*1.35;
  const plotW = W-padL-padR;
  let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;font-size:11px;background:var(--surface-card);border:1px solid var(--gray-200);border-radius:10px;">`;
  rows.forEach((r,i)=>{
    const y = topPad + i*(barH+gap);
    const m = metric(r);
    const barLen = (m/maxV)*plotW;
    const color = r.pct!=null ? (r.pct>=100?"#e0554f":r.pct>=80?"#e8a33d":"#3fb27f") : HD_PALETTE[i%HD_PALETTE.length];
    svg += `<text x="${padL-8}" y="${y+barH/2+4}" text-anchor="end" fill="var(--gray-900)" font-weight="700">${escHtml(r.cerobong)}</text>`;
    svg += `<rect x="${padL}" y="${y}" width="${Math.max(2,barLen)}" height="${barH}" rx="6" fill="${color}"/>`;
    const label = useStd ? `${m}%` : `${Math.round(m*100)/100}${r.pct!=null?` &middot; ${r.pct}%BM`:""}`;
    const estW = label.replace(/&\w+;/g,"x").length*6.3;
    const xOutside = padL+barLen+6;
    if(xOutside+estW > W-4){
      svg += `<text x="${padL+Math.max(2,barLen)-6}" y="${y+barH/2+4}" text-anchor="end" fill="#fff" font-weight="700">${label}</text>`;
    }else{
      svg += `<text x="${xOutside}" y="${y+barH/2+4}" fill="var(--gray-900)" font-weight="700">${label}</text>`;
    }
  });
  const unitNote = `Satuan: ${rows[0].unit}${hasStd?" &middot; %BM = persentase terhadap baku mutu":""}`;
  if(useStd){
    const x100 = padL + (100/maxV)*plotW;
    svg += `<line x1="${x100}" y1="0" x2="${x100}" y2="${H}" stroke="#e0554f" stroke-width="1" stroke-dasharray="3,3" opacity="0.6"/>`;
  }else if(hasStd){
    // mode nominal tapi parameter ini punya baku mutu — tetap tampilkan garis referensinya
    // dalam satuan nominal (median standard antar titik terpilih, cukup representatif).
    const stds = rows.map(r=>r.standard).filter(v=>v!=null).sort((a,b)=>a-b);
    if(stds.length){
      const stdRef = stds[Math.floor(stds.length/2)];
      if(stdRef<=maxV){
        const xr = padL + (stdRef/maxV)*plotW;
        svg += `<line x1="${xr}" y1="0" x2="${xr}" y2="${H}" stroke="#e0554f" stroke-width="1" stroke-dasharray="3,3" opacity="0.6"/>`;
        svg += `<text x="${xr}" y="10" text-anchor="middle" fill="#e0554f" font-size="9.5">BM ${stdRef}</text>`;
      }
    }
  }
  svg += `</svg>`;
  return {svg, unitNote};
}
// Rincian "kartu profil" per titik terpilih — menampilkan SEMUA parameter yang tercatat di titik
// itu SEPANJANG rentang periode yang lagi difilter (bukan cuma satu periode terakhir — kalau user
// pilih rentang Dari s.d Sampai Periode, di sinilah datanya diakomodasi): nilai terbaru ditonjolkan,
// tren mini (sparkline) di sepanjang rentang itu ditampilkan di bawahnya biar histori tetap kelihatan.
function hdSparkline(values, color, w, h){
  w = w||72; h = h||22;
  if(values.length<2) return "";
  const min = Math.min(...values), max = Math.max(...values);
  const range = (max-min)||Math.abs(max)||1;
  const step = w/(values.length-1);
  const pts = values.map((v,i)=> `${(i*step).toFixed(1)},${(h-2-((v-min)/range)*(h-4)).toFixed(1)}`).join(" ");
  const lastX = ((values.length-1)*step).toFixed(1), lastY = (h-2-((values[values.length-1]-min)/range)*(h-4)).toFixed(1);
  return `<svg viewBox="0 0 ${w} ${h}" style="width:${w}px;height:${h}px;display:block;"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.6"/><circle cx="${lastX}" cy="${lastY}" r="2" fill="${color}"/></svg>`;
}
function buildHasilEngineProfile(filteredAllParams, selectedCerobong, periodsInScope){
  if(!selectedCerobong || !selectedCerobong.size) return "<div class='hint' style='padding:14px;'>Pilih satu atau lebih titik pada filter Titik atau Cerobong di atas untuk melihat rincian semua parameternya di sini.</div>";
  if(!periodsInScope.length) return "<div class='hint' style='padding:14px;'>Tidak ada data pada rentang periode ini.</div>";
  const rangeLabel = periodsInScope.length>1 ? `${periodsInScope[0]} sampai dengan ${periodsInScope[periodsInScope.length-1]} (${periodsInScope.length} periode)` : periodsInScope[0];
  let html = `<div class="hint" style="margin:0 0 10px;">Rentang periode yang aktif adalah <b>${escHtml(rangeLabel)}</b>. Angka besar pada tiap kartu menunjukkan data terbaru pada rentang ini, sedangkan grafik kecil di bawahnya menunjukkan tren sepanjang rentang tersebut.</div>`;
  [...selectedCerobong].forEach(c=>{
    const recsAll = filteredAllParams.filter(r=>r.cerobong===c);
    if(!recsAll.length) return;
    const head = recsAll.slice().sort((a,b)=>b.periodeOrder-a.periodeOrder)[0];
    const paramsForC = [...new Set(recsAll.map(r=>r.parameter))];
    html += `<div class="hd-profile-card">
      <div class="hd-profile-head"><span>${escHtml(c)}</span><span class="muted" style="font-weight:400;">${escHtml(head.namaSumber||"")} &middot; ${escHtml(head.site)}</span></div>
      <div class="hd-profile-sub">${head.kategoriKapasitas && head.kategoriKapasitas!=="Tidak Dipersyaratkan" ? escHtml(head.kategoriKapasitas)+" &middot; " : ""}${head.regulasiCek ? escHtml(HD_PERMEN_LABEL[head.regulasiCek]||head.regulasiCek) : ""}</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;">
        ${paramsForC.map(p=>{
          const series = recsAll.filter(r=>r.parameter===p).sort((a,b)=>a.periodeOrder-b.periodeOrder);
          const last = series[series.length-1];
          const isEmisi = hdIsEmisiParam(p);
          const badge = isEmisi ? (HASIL_STATUS_BADGE[last.statusBakuMutu]||HASIL_STATUS_BADGE.not_evaluated) : ["b-blue","Pendukung"];
          const numericSeries = series.filter(r=>r.resultNumeric!=null).map(r=>r.resultNumeric);
          const spark = hdSparkline(numericSeries, isEmisi?"#0ea5a0":"#7c5cbf");
          return `<div class="hd-param-pill">
            <div class="lbl">${escHtml(p)}</div>
            <div class="val">${escHtml(last.resultRaw)} <span class="muted" style="font-weight:400;font-size:10.5px;">${escHtml(last.unit)}</span></div>
            ${spark ? `<div style="margin:3px 0;">${spark}</div>` : ""}
            <div class="meta">${series.length} data periode &middot; terakhir ${last.periode}</div>
            <span class="badge ${badge[0]}" style="margin-top:3px;">${badge[1]}</span>
          </div>`;
        }).join("")}
      </div>
    </div>`;
  });
  return html || `<div class='hint' style='padding:14px;'>Tidak ada data pada rentang periode ${escHtml(rangeLabel)} untuk titik yang dipilih.</div>`;
}
// Chip picker parameter utk chart Tren Multi-Parameter (Korelasi) — maks 3 dipilih, yg pertama
// jadi sumbu kiri (satuan asli), sisanya sumbu kanan (dinormalisasi ke % dari nilai maks masing2)
// supaya parameter beda satuan (mis. NOx mg/Nm3 vs Gas Temperatur oC) tetap bisa ditumpuk 1 chart.
function hdRenderCorrPicker(params){
  return params.map(p=>{
    const idx = hdCorrParams.indexOf(p);
    const active = idx>=0;
    return `<button type="button" class="chip-toggle ${active?'active':''}" data-action="hdCorrToggle" data-val="${escHtml(p)}">${active?(idx+1)+". ":""}${escHtml(p)}</button>`;
  }).join("");
}
function buildHasilCorrelationChart(filteredAllParams, periodsInScope, corrParams){
  if(!corrParams || corrParams.length<2) return "<div class='hint' style='padding:14px;'>Centang dua sampai tiga parameter di atas, misalnya NOx dan Gas Temperatur, untuk melihat tren gabungan dan kecenderungan korelasinya.</div>";
  if(!periodsInScope.length) return "<div class='hint' style='padding:14px;'>Tidak ada data pada rentang periode ini.</div>";
  const seriesByParam = corrParams.map((p,pi)=>{
    const recs = filteredAllParams.filter(r=>r.parameter===p && r.resultNumeric!=null);
    const values = periodsInScope.map(per=>{
      const vals = recs.filter(r=>r.periode===per).map(r=>r.resultNumeric);
      return vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : null;
    });
    return {param:p, values, unit: recs[0]?.unit||"", color: HD_PALETTE[pi%HD_PALETTE.length]};
  });
  if(seriesByParam.every(s=>s.values.every(v=>v==null))) return "<div class='hint' style='padding:14px;'>Tidak ada data terukur untuk kombinasi parameter &amp; filter ini.</div>";

  const W=780,H=320,padL=58,padR=58,padT=20,padB=34;
  const plotW=W-padL-padR, plotH=H-padT-padB;
  const n = periodsInScope.length;
  function xFor(i){ return padL+(n<=1?plotW/2:(i/(n-1))*plotW); }

  const primary = seriesByParam[0];
  const primaryVals = primary.values.filter(v=>v!=null);
  let maxPrimary = Math.max(...primaryVals,0)*1.15; if(!isFinite(maxPrimary)||maxPrimary<=0) maxPrimary=100;
  function yForPrimary(v){ return padT+plotH-(v/maxPrimary)*plotH; }
  function yForPct(pct){ return padT+plotH-(pct/100)*plotH; }

  let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;font-size:11px;background:var(--surface-card);border:1px solid var(--gray-200);border-radius:10px;">`;
  for(let g=0; g<=4; g++){
    const y = padT+plotH-(g/4)*plotH;
    svg += `<line x1="${padL}" y1="${y}" x2="${W-padR}" y2="${y}" stroke="var(--gray-200)"/>`;
    svg += `<text x="2" y="${y+4}" fill="${primary.color}">${Math.round(maxPrimary*g/4)}</text>`;
    svg += `<text x="${W-padR+6}" y="${y+4}" fill="#9db3c9">${g*25}%</text>`;
  }
  periodsInScope.forEach((p,i)=>{ svg += `<text x="${xFor(i)}" y="${H-8}" text-anchor="middle" fill="var(--gray-500)">${p}</text>`; });
  svg += `<text x="2" y="12" fill="${primary.color}" font-weight="700">${escHtml(primary.param)} (${escHtml(primary.unit)})</text>`;
  svg += `<text x="${W-padR+6}" y="12" text-anchor="end" fill="#9db3c9" font-weight="700">lainnya, persen dari nilai maksimum</text>`;

  seriesByParam.forEach((s,si)=>{
    const yFor = si===0 ? yForPrimary : (v)=>{
      const vals = s.values.filter(x=>x!=null); const mx = Math.max(...vals.map(Math.abs))||1;
      return yForPct((v/mx)*100);
    };
    const pts = s.values.map((v,i)=> v==null ? null : [xFor(i), yFor(v)]);
    const validPts = pts.map((pt,i)=>pt?[i,pt]:null).filter(Boolean);
    if(validPts.length<1) return;
    let path = "";
    validPts.forEach(([i,pt],k)=>{ path += (k===0?"M":"L")+pt[0]+","+pt[1]+" "; });
    svg += `<path d="${path.trim()}" fill="none" stroke="${s.color}" stroke-width="2.5" ${si>0?'stroke-dasharray="5,3"':''}/>`;
    validPts.forEach(([i,pt])=>{ svg += `<circle cx="${pt[0]}" cy="${pt[1]}" r="3.5" fill="${s.color}"/>`; });
  });
  svg += `</svg>`;
  return svg;
}
function buildHasilCorrelationLegend(corrParams, filteredAllParams){
  if(!corrParams || corrParams.length<2) return "";
  return corrParams.map((p,i)=>{
    const unit = filteredAllParams.find(r=>r.parameter===p)?.unit || "";
    return `<span class="item"><span class="sw" style="background:${HD_PALETTE[i%HD_PALETTE.length]}"></span>${escHtml(p)} (${escHtml(unit)})${i===0?", sumbu kiri":", sumbu kanan, dinormalisasi"}</span>`;
  }).join("");
}
// Pasangkan nilai 2 parameter yang tercatat di kombinasi (cerobong, periode) YANG SAMA — ini
// granularitas paling halus yang tersedia di data (bukan rata-rata per periode seperti chart tren
// di atasnya), supaya jumlah sampel utk hitungan statistik cukup banyak (lintas titik & periode).
function hdBuildParamPairs(filteredAllParams, paramA, paramB){
  const byKey = {};
  filteredAllParams.forEach(r=>{
    if(r.parameter!==paramA && r.parameter!==paramB) return;
    if(r.resultNumeric==null) return;
    const key = r.cerobong+"||"+r.periode;
    const o = byKey[key] || (byKey[key] = {cerobong:r.cerobong, periode:r.periode});
    o[r.parameter] = r.resultNumeric;
  });
  return Object.values(byKey).filter(o=>o[paramA]!=null && o[paramB]!=null).map(o=>({x:o[paramA], y:o[paramB], cerobong:o.cerobong, periode:o.periode}));
}
function hdPearsonR(pairs){
  const n = pairs.length;
  if(n<3) return null;
  const mx = pairs.reduce((a,p)=>a+p.x,0)/n, my = pairs.reduce((a,p)=>a+p.y,0)/n;
  let num=0, dx2=0, dy2=0;
  pairs.forEach(p=>{ const dx=p.x-mx, dy=p.y-my; num+=dx*dy; dx2+=dx*dx; dy2+=dy*dy; });
  const denom = Math.sqrt(dx2*dy2);
  return denom===0 ? null : num/denom;
}
function hdCorrInterpretation(r){
  const abs = Math.abs(r);
  const strength = abs>=0.7?"kuat":abs>=0.4?"sedang":abs>=0.2?"lemah":"sangat lemah atau tidak ada";
  const dir = r>0?"positif, artinya kedua parameter cenderung naik bersama":r<0?"negatif, artinya kedua parameter cenderung berlawanan arah":"netral";
  return {strength, dir};
}
// Scatter plot kecil beserta garis regresi linear sederhana, membantu melihat pola hubungan di
// balik angka R kuadrat, karena korelasi yang tinggi juga dapat terjadi akibat kebetulan atau outlier.
function hdBuildScatter(pairs, colorA, paramA, paramB, unitA, unitB){
  const W=280,H=200,pad=34;
  const xs = pairs.map(p=>p.x), ys = pairs.map(p=>p.y);
  const minX=Math.min(...xs), maxX=Math.max(...xs), minY=Math.min(...ys), maxY=Math.max(...ys);
  const rx = (maxX-minX)||1, ry=(maxY-minY)||1;
  function xFor(v){ return pad + ((v-minX)/rx)*(W-pad-14); }
  function yFor(v){ return H-pad - ((v-minY)/ry)*(H-pad-14); }
  let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:300px;height:auto;display:block;background:var(--surface-card);border:1px solid var(--gray-200);border-radius:8px;">`;
  svg += `<line x1="${pad}" y1="${H-pad}" x2="${W-8}" y2="${H-pad}" stroke="var(--gray-300)"/><line x1="${pad}" y1="${H-pad}" x2="${pad}" y2="8" stroke="var(--gray-300)"/>`;
  svg += `<text x="${pad}" y="${H-8}" font-size="9" fill="var(--gray-500)">${escHtml(paramA)} (${escHtml(unitA)})</text>`;
  svg += `<text x="4" y="16" font-size="9" fill="var(--gray-500)" transform="rotate(-90 4 16)">${escHtml(paramB)} (${escHtml(unitB)})</text>`;
  // garis regresi linear y = a + bx, metode kuadrat terkecil (least squares)
  const n = pairs.length, mx=xs.reduce((a,b)=>a+b,0)/n, my=ys.reduce((a,b)=>a+b,0)/n;
  let num=0, den=0; pairs.forEach(p=>{ num+=(p.x-mx)*(p.y-my); den+=(p.x-mx)*(p.x-mx); });
  const slope = den===0?0:num/den, intercept = my-slope*mx;
  const yAtMinX = intercept+slope*minX, yAtMaxX = intercept+slope*maxX;
  svg += `<line x1="${xFor(minX)}" y1="${yFor(yAtMinX)}" x2="${xFor(maxX)}" y2="${yFor(yAtMaxX)}" stroke="#e0554f" stroke-width="1.5" stroke-dasharray="4,3"/>`;
  pairs.forEach(p=>{ svg += `<circle cx="${xFor(p.x)}" cy="${yFor(p.y)}" r="3" fill="${colorA}" fill-opacity="0.65"/>`; });
  svg += `</svg>`;
  return svg;
}
// Tabel data pasangan beserta langkah perhitungan Pearson r, ditampilkan supaya angka R kuadrat
// tidak muncul sebagai kotak hitam, melainkan dapat ditelusuri dari nilai mentahnya.
function hdBuildCalcTable(pairs, paramA, paramB, r){
  const n = pairs.length;
  const mx = pairs.reduce((a,p)=>a+p.x,0)/n, my = pairs.reduce((a,p)=>a+p.y,0)/n;
  let sumDxDy=0, sumDx2=0, sumDy2=0;
  const rows = pairs.map(p=>{
    const dx=p.x-mx, dy=p.y-my, dxdy=dx*dy, dx2=dx*dx, dy2=dy*dy;
    sumDxDy+=dxdy; sumDx2+=dx2; sumDy2+=dy2;
    return {...p, dx, dy, dxdy, dx2, dy2};
  });
  const cap = 40;
  const shown = rows.slice(0, cap);
  const r2 = r*r;
  const fmt = v=> Math.round(v*1000)/1000;
  return `
    <div class="tablewrap" style="max-height:260px;">
      <table class="calc-table">
        <thead><tr><th>Cerobong</th><th>Periode</th><th>X (${escHtml(paramA)})</th><th>Y (${escHtml(paramB)})</th><th>X kurang rata rata X</th><th>Y kurang rata rata Y</th><th>Hasil kali</th><th>Kuadrat X</th><th>Kuadrat Y</th></tr></thead>
        <tbody>${shown.map(row=>`<tr><td>${escHtml(row.cerobong)}</td><td>${row.periode}</td><td>${fmt(row.x)}</td><td>${fmt(row.y)}</td><td>${fmt(row.dx)}</td><td>${fmt(row.dy)}</td><td>${fmt(row.dxdy)}</td><td>${fmt(row.dx2)}</td><td>${fmt(row.dy2)}</td></tr>`).join("")}</tbody>
      </table>
    </div>
    ${rows.length>cap?`<div class="hint" style="margin-top:4px;">Menampilkan ${cap} dari ${rows.length} data yang digunakan pada perhitungan, jumlah dan rata rata di bawah tetap dihitung dari seluruh ${rows.length} data.</div>`:""}
    <div class="calc-formula">
      Jumlah data (n) = ${n}<br>
      Rata rata X = ${fmt(mx)}, rata rata Y = ${fmt(my)}<br>
      Jumlah hasil kali (X kurang rata rata X) dan (Y kurang rata rata Y) = ${fmt(sumDxDy)}<br>
      Jumlah kuadrat (X kurang rata rata X) = ${fmt(sumDx2)}<br>
      Jumlah kuadrat (Y kurang rata rata Y) = ${fmt(sumDy2)}<br>
      Koefisien korelasi, r = ${fmt(sumDxDy)} dibagi akar dari (${fmt(sumDx2)} dikali ${fmt(sumDy2)}) = ${fmt(r)}<br>
      R kuadrat = r dikuadratkan = ${fmt(r)} dikuadratkan = ${fmt(r2)}
    </div>`;
}
// Panel statistik R kuadrat, dibangun otomatis dari parameter yang dicentang pada pemilih Korelasi.
// Apabila tiga parameter dipilih, parameter pertama dipasangkan dengan tiap parameter berikutnya,
// sehingga terbentuk dua pasangan analisis.
function buildHasilCorrelationStats(filteredAllParams, corrParams, scopeLabel){
  if(!corrParams || corrParams.length<2) return "";
  const primary = corrParams[0];
  const secondaries = corrParams.slice(1);
  const scope = scopeLabel || hdScopeDescription();
  const panels = secondaries.map((sec,i)=>{
    const pairs = hdBuildParamPairs(filteredAllParams, primary, sec);
    const r = hdPearsonR(pairs);
    const unitA = filteredAllParams.find(x=>x.parameter===primary)?.unit||"";
    const unitB = filteredAllParams.find(x=>x.parameter===sec)?.unit||"";
    if(r==null){
      return `<div class="hd-profile-card"><div class="hd-profile-head">${escHtml(primary)} dan ${escHtml(sec)}</div><div class="hint" style="margin:6px 0 0;">Jumlah data pasangan, yaitu titik dan periode yang sama sama memiliki hasil ukur untuk kedua parameter, belum mencukupi minimal tiga data untuk menghitung korelasi pada filter saat ini.</div></div>`;
    }
    const r2 = Math.round(r*r*1000)/1000;
    const {strength, dir} = hdCorrInterpretation(r);
    const scatter = hdBuildScatter(pairs, HD_PALETTE[(i+1)%HD_PALETTE.length], primary, sec, unitA, unitB);
    return `<div class="hd-profile-card">
      <div class="hd-profile-head">${escHtml(primary)} dan ${escHtml(sec)} <span class="muted" style="font-weight:400;">(jumlah data pasangan, n = ${pairs.length})</span></div>
      <div class="hint" style="margin-top:2px;">Dihitung dari data hasil filter dashboard yang sedang aktif, yaitu ${escHtml(scope)}.</div>
      <div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:8px;align-items:flex-start;">
        <div style="flex:0 0 auto;">${scatter}</div>
        <div style="flex:1;min-width:180px;">
          <div class="hd-param-pill" style="display:inline-block;margin-right:8px;"><div class="lbl">Koefisien Korelasi, r</div><div class="val">${r.toFixed(3)}</div></div>
          <div class="hd-param-pill" style="display:inline-block;"><div class="lbl">R Kuadrat</div><div class="val">${r2}</div></div>
          <div class="hint" style="margin-top:8px;">Korelasi tergolong <b>${strength}</b>, dengan arah <b>${dir}</b>. Nilai R kuadrat sebesar ${r2} berarti sekitar <b>${Math.round(r2*100)} persen</b> variasi ${escHtml(sec)} pada data ini sejalan dengan variasi ${escHtml(primary)}, sedangkan sisanya dipengaruhi oleh faktor lain di luar kedua parameter ini. Garis putus putus berwarna merah pada grafik sebar di sebelah kiri merupakan garis tren linear, atau garis regresi, dari titik titik data.</div>
        </div>
      </div>
      <details style="margin-top:10px;">
        <summary style="cursor:pointer;font-size:11.5px;font-weight:700;color:#0b6b66;">Lihat tabel data dan langkah perhitungan</summary>
        <div style="padding-top:8px;">${hdBuildCalcTable(pairs, primary, sec, r)}</div>
      </details>
    </div>`;
  }).join("");
  return `<details class="card guide" open><summary>Analisis Statistik Korelasi, R Kuadrat</summary><div class="guide-body">${panels}</div></details>`;
}

