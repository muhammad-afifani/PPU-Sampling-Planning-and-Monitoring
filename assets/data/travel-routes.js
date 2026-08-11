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

   Field "mode" (laut/seatruck/darat) dipakai kode (lihat buildSiteBriefingHtml di 08-gantt-print.js)
   utk menentukan apakah info personil+PTS perlu ditampilkan di preview per-site: PTS dicek pas
   naik transport air (laut/seatruck), TIDAK utk transport darat (itu urusan personil PPC pesan
   sendiri ke kantor mereka, site tidak perlu ikut koordinasi/tahu PTS-nya — lihat catatan user).
   Rute yang tidak terdaftar di tabel ini (mode tidak diketahui) DIANGGAP tetap perlu ditampilkan
   info personil+PTS-nya (default aman: lebih baik kelebihan info drpd kelewat pas boarding).

   Field "bookingOverride" (opsional): rute khusus di mana tanggung jawab booking transport BUKAN
   site keberangkatan (aturan umum), melainkan site tetap yang disebut di sini — dipakai kode
   (lihat bookingResponsibilityText di 08-gantt-print.js). Kasus BEKAPAI: booking laut ke/dari
   BEKAPAI SELALU jadi urusan BEKAPAI sendiri, termasuk pas keberangkatan dari SPS menuju BEKAPAI
   (SPS tidak ikut booking sama sekali) — lihat catatan user.
========================================================= */
const TRAVEL_ROUTES = {
  "SPS>BEKAPAI": {label:"Laut · berangkat ±06:30 WITA", mode:"laut", note:"Dari Jetty Senipah (SPS). Personil standby di jetty plg lambat ±06:00 WITA.", equipmentNote:"Peralatan sampling didrop sore hari H-1 keberangkatan (perlu diangkut ke basket dulu) — koordinasikan dengan tim Marine di jetty Senipah.", bookingOverride:"BEKAPAI"},
  "BEKAPAI>SPS": {label:"Laut · siang–sore", mode:"laut", note:"Tergantung jadwal tim Marine Transport — umumnya berangkat dari BEKAPAI ±13:00–16:00 WITA (setelah istirahat siang)."},
  "SPS>HCA": {label:"Darat · fleksibel", mode:"darat", note:"Transport SCI sendiri, jadwal menyesuaikan kebutuhan (tidak terpaku jam tetap)."},
  "HCA>SPS": {label:"Darat · fleksibel", mode:"darat", note:"Transport SCI sendiri, jadwal menyesuaikan kebutuhan (tidak terpaku jam tetap)."},
  "HCA>SPU": {label:"Seatruck · ±09:00 WITA", mode:"seatruck"},
  "SPU>HCA": {label:"Seatruck · ±07:00 WITA", mode:"seatruck"},
  "HCA>CPU": {label:"Seatruck · ±09:00 WITA", mode:"seatruck"},
  "CPU>HCA": {label:"Seatruck · ±07:00 atau ±15:00 WITA", mode:"seatruck"},
  "HCA>NPU": {label:"Seatruck · berangkat ±09:00 dari HCA", mode:"seatruck", note:"Transit/mampir dulu di CPU (HCA di tengah — SPU ke arah kanan, CPU/NPU ke arah kiri); umumnya tiba di NPU ±12:00 WITA."},
  "NPU>HCA": {label:"Seatruck · ±05:30 atau ±13:00 WITA", mode:"seatruck"},
  "SPU>CPU": {label:"Seatruck · transit via HCA", mode:"seatruck", note:"Harus transit dulu via HCA, kecuali ada request khusus sea truck direct (baru bisa langsung)."},
  "CPU>SPU": {label:"Seatruck · transit via HCA", mode:"seatruck", note:"Harus transit dulu via HCA, kecuali ada request khusus sea truck direct (baru bisa langsung)."},
  "SPU>NPU": {label:"Seatruck · transit via HCA", mode:"seatruck", note:"Harus transit dulu via HCA, kecuali ada request khusus sea truck direct (baru bisa langsung)."},
  "NPU>SPU": {label:"Seatruck · transit via HCA", mode:"seatruck", note:"Harus transit dulu via HCA, kecuali ada request khusus sea truck direct (baru bisa langsung)."},
  "BPN>SPS": {label:"Darat · fleksibel", mode:"darat", note:"Booking kendaraan diatur oleh SCI."},
  "SPS>BPN": {label:"Darat · fleksibel", mode:"darat", note:"Booking kendaraan diatur oleh SCI."},
  "BPN>HCA": {label:"Darat · fleksibel", mode:"darat", note:"Booking kendaraan diatur oleh SCI (rute darat BPN–SPS–HCA)."},
  "HCA>BPN": {label:"Darat · fleksibel", mode:"darat", note:"Booking kendaraan diatur oleh SCI (rute darat BPN–SPS–HCA)."},
};
function travelRouteInfo(fromSite, toSite){
  return TRAVEL_ROUTES[fromSite+">"+toSite] || null;
}
