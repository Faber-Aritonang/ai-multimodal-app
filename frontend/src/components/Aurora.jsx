/*
 * Latar dekoratif aplikasi.
 *
 * Dipasang sekali di App (bukan di tiap halaman) supaya blob aurora tidak
 * dibuat ulang setiap navigasi — kalau dibuat per halaman, animasinya akan
 * berkedip dan ikut ter-reset.
 */

// Titik-titik kecil bergerak halus sebagai penanda "hidup"; disembunyikan dari
// pembaca layar karena murni dekoratif.
const Aurora = () => (
  <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
    <div className="absolute inset-0 bg-ink-950" />
    <div className="aurora-blob aurora-blob--cyan" />
    <div className="aurora-blob aurora-blob--violet" />
    <div className="aurora-blob aurora-blob--fuchsia" />
    <div className="aurora-grid absolute inset-0" />
    <div className="aurora-noise absolute inset-0" />
    {/* Vinyet: menggelapkan tepi atas agar topbar tetap terbaca. */}
    <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-ink-950 via-ink-950/70 to-transparent" />
  </div>
)

export default Aurora
