import { Link } from 'react-router-dom'

/**
 * Tautan ke arsip lengkap (`/history`), tersaring untuk satu jenis hasil.
 *
 * Muncul di setiap halaman alat, di sebelah judul panel riwayatnya. Panel itu
 * hanya menampilkan 12 hasil terakhir, dan sebelum ini satu-satunya jalan ke
 * arsip lengkap adalah menu samping — yang tidak menyebutkan bahwa di sana ada
 * pencarian, filter, paginasi, dan tombol "Generate ulang". Akibatnya hasil lama
 * dianggap hilang padahal masih tersimpan.
 *
 * `type` dibawa sebagai query supaya halaman Riwayat terbuka sudah tersaring,
 * bukan menampilkan campuran semua jenis: orang yang menekan tautan ini sedang
 * mencari lanjutan dari daftar yang sedang dilihatnya.
 *
 * Dipakai bersama oleh lima halaman alat supaya teks dan tujuannya tidak
 * menyimpang satu sama lain.
 */
const HistoryLink = ({ type }) => (
  <Link to={`/history?type=${type}`} className="hud transition-colors hover:text-cyan-200">
    lihat semua riwayat →
  </Link>
)

export default HistoryLink
