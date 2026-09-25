import { Component } from 'react'
import { reportError } from '../utils/errorReporter'

/**
 * Error boundary aplikasi.
 *
 * Tanpa ini, satu galat saat render membuat React melepas SELURUH pohon
 * komponen: yang tersisa hanya halaman putih kosong. User tidak tahu apa yang
 * terjadi, tidak punya cara memulihkan selain memuat ulang manual, dan tidak ada
 * satu pun jejak yang sampai ke developer.
 *
 * Yang dilakukan di sini:
 *   1. menampilkan halaman pengganti yang menjelaskan keadaannya dan memberi
 *      tombol untuk memulihkan (muat ulang / kembali ke beranda);
 *   2. mengirim galatnya (beserta `componentStack`, yaitu komponen mana yang
 *      melempar — React hanya memberikannya di sini) ke backend.
 *
 * Boundary ini sengaja berupa class: React hanya mendukung `componentDidCatch`
 * di class component, dan itu satu-satunya cara menangkap galat render.
 *
 * Yang TIDAK ditangkap: galat di event handler dan di kode asinkron. Keduanya
 * ditangani penangkap global di utils/errorReporter.js — pemisahan ini disengaja
 * karena React memang tidak melewatkan keduanya ke boundary.
 */
class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    reportError(error, {
      kind: 'boundary',
      componentStack: info?.componentStack || undefined
    })
  }

  render() {
    const { error } = this.state

    if (!error) return this.props.children

    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="glass-panel w-full max-w-xl p-6 sm:p-8" role="alert">
          <p className="hud mb-2">galat aplikasi</p>
          <h1 className="text-xl font-semibold text-slate-100">
            Terjadi kesalahan saat menampilkan halaman ini
          </h1>
          <p className="mt-3 text-sm text-slate-400">
            Halaman ini gagal dimuat. Pekerjaan yang sedang berjalan di server (mis. generate
            video) tetap berlanjut dan hasilnya bisa dilihat di halaman Riwayat setelah dimuat
            ulang.
          </p>

          {/* Pesannya ditampilkan agar bisa disalin user ke laporan. Isinya bisa
              jadi istilah teknis, tetapi menyembunyikannya membuat laporan hanya
              berbunyi "error" tanpa petunjuk apa pun. */}
          <p className="glass-inset mt-4 max-h-32 overflow-y-auto break-words p-3 font-mono text-[11px] text-rose-200">
            {String(error?.message || error)}
          </p>

          <div className="mt-5 flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
              Muat ulang halaman
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                window.location.href = '/'
              }}
            >
              Kembali ke beranda
            </button>
          </div>
        </div>
      </div>
    )
  }
}

export default ErrorBoundary
