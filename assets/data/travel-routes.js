/* =========================================================
   REFERENSI WAKTU TEMPUH ANTAR SITE (FYI)
   ---------------------------------------------------------
   Kebiasaan jam berangkat & moda transport per rute site-ke-site, dari info lapangan tim —
   MURNI informasi (FYI) yang ditampilkan di panduan cetak & tooltip perpindahan site di Gantt.
   TIDAK memengaruhi logika penjadwalan/validasi sama sekali (beda dari crewChangeDay yang memang
   jadi constraint keberangkatan — lihat findValidStart di 02-nav-util.js). Rute yang tidak
   terdaftar di sini otomatis balik ke panduan umum (kira-kira berangkat pagi jam 07:00-08:00 atau
   siang jam 13:00, tempuh 1-2 jam) yang sudah ada di buildPrintGuideHtml.

   Key pakai kode site asli (lihat DEFAULT_ROUTE_EMISI/AMBIENT & MASTER_SITE_ORDER):
   - SPS = Jetty Senipah, hub darat + laut (site pertama di MASTER_SITE_ORDER).
   - HCA = Handil / Handil Central Area — titik ambient "Handil Village" & "Handil Camp" di
     DEFAULT_AMBIENT memang terdaftar di bawah site HCA, jadi "Handil" & "HCA" site yang sama.
   - BPN = Balikpapan (Base Office, lihat DEFAULT_SITE_RULES.BPN.transport).
========================================================= */
const TRAVEL_ROUTES = {
  "SPS>BEKAPAI": {label:"Laut · berangkat ±06:30 WITA", note:"Dari Jetty Senipah (SPS). Personil standby di jetty plg lambat ±06:00 WITA."},
  "BEKAPAI>SPS": {label:"Laut · siang–sore", note:"Tergantung jadwal tim Marine Transport — umumnya berangkat dari BEKAPAI ±13:00–16:00 WITA (setelah istirahat siang)."},
  "SPS>HCA": {label:"Darat · fleksibel", note:"Transport SCI sendiri, jadwal menyesuaikan kebutuhan (tidak terpaku jam tetap)."},
  "HCA>SPS": {label:"Darat · fleksibel", note:"Transport SCI sendiri, jadwal menyesuaikan kebutuhan (tidak terpaku jam tetap)."},
  "HCA>SPU": {label:"Seatruck · ±09:00 WITA"},
  "SPU>HCA": {label:"Seatruck · ±07:00 WITA"},
  "HCA>CPU": {label:"Seatruck · ±09:00 WITA"},
  "CPU>HCA": {label:"Seatruck · ±07:00 atau ±15:00 WITA"},
  "HCA>NPU": {label:"Seatruck · berangkat ±09:00 dari HCA", note:"Transit/mampir dulu di CPU (HCA di tengah — SPU ke arah kanan, CPU/NPU ke arah kiri); umumnya tiba di NPU ±12:00 WITA."},
  "NPU>HCA": {label:"Seatruck · ±05:30 atau ±13:00 WITA"},
  "SPU>CPU": {label:"Seatruck · transit via HCA", note:"Harus transit dulu via HCA, kecuali ada request khusus sea truck direct (baru bisa langsung)."},
  "CPU>SPU": {label:"Seatruck · transit via HCA", note:"Harus transit dulu via HCA, kecuali ada request khusus sea truck direct (baru bisa langsung)."},
  "SPU>NPU": {label:"Seatruck · transit via HCA", note:"Harus transit dulu via HCA, kecuali ada request khusus sea truck direct (baru bisa langsung)."},
  "NPU>SPU": {label:"Seatruck · transit via HCA", note:"Harus transit dulu via HCA, kecuali ada request khusus sea truck direct (baru bisa langsung)."},
  "BPN>SPS": {label:"Darat · fleksibel", note:"Booking kendaraan diatur oleh SCI."},
  "SPS>BPN": {label:"Darat · fleksibel", note:"Booking kendaraan diatur oleh SCI."},
  "BPN>HCA": {label:"Darat · fleksibel", note:"Booking kendaraan diatur oleh SCI (rute darat BPN–SPS–HCA)."},
  "HCA>BPN": {label:"Darat · fleksibel", note:"Booking kendaraan diatur oleh SCI (rute darat BPN–SPS–HCA)."},
};
function travelRouteInfo(fromSite, toSite){
  return TRAVEL_ROUTES[fromSite+">"+toSite] || null;
}
