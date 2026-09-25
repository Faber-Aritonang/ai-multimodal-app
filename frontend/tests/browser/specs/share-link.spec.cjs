/**
 * Spec: tautan baca-saja (`/share/:token`).
 *
 * Ini satu-satunya fitur yang mengeluarkan data user TANPA login, jadi yang
 * diuji adalah batasnya, bukan tampilannya: token harus acak dan panjang,
 * menekan Bagikan dua kali tidak boleh mengganti tautan yang sudah disebar,
 * tautannya bisa dibuka tanpa token auth, isinya tidak memuat identitas pemilik
 * maupun referensi penyimpanan, dan tautan yang dicabut benar-benar mati (404).
 *
 * Data yang dipakai adalah satu hasil selesai dari riwayat akun dev apa adanya —
 * spec ini TIDAK membuat hasil baru (mahal dan memakai kuota). Karena itu ia juga
 * tidak mengubah data:
 *   - kalau item itu SUDAH punya tautan sebelum spec berjalan (mis. dari sesi
 *     sebelumnya), pencabutan dilewati — mencabutnya berarti mematikan tautan
 *     yang mungkin sudah disebar.
 *   - kalau belum, tautannya dicabut lagi di akhir supaya keadaannya kembali
 *     seperti semula.
 */

module.exports = {
  name: 'share-link',

  async run({ session, reporter, api, apiUrl }) {
    const riwayat = await api.get('/media/history?status=completed&limit=1');
    const item = riwayat.body?.media?.[0] || null;

    if (!item) {
      reporter.check('ada hasil selesai untuk dibagikan (dilewati bila riwayat kosong)', true, null);
      return;
    }

    const sudahDibagikanSebelumnya = Boolean(item.shareToken);

    // ---------- Membuat tautan ----------
    const dibuat = await api.post(`/media/${item.contentId}/share`);

    reporter.equal('permintaan membuat tautan dijawab 200', dibuat.status, 200);

    const token = dibuat.body?.shareToken;

    // 24 byte acak -> 32 karakter base64url. Bentuknya dikunci karena token yang
    // pendek/berpola berarti tautannya bisa ditebak, dan itulah satu-satunya
    // yang menjaga endpoint publik ini.
    reporter.check(
      'token berbentuk 32 karakter base64url',
      /^[A-Za-z0-9_-]{32}$/.test(token || ''),
      String(token)
    );
    reporter.equal('path tautan yang dilaporkan server', dibuat.body?.sharePath, `/share/${token}`);

    // ---------- Idempoten ----------
    const dibuatLagi = await api.post(`/media/${item.contentId}/share`);

    reporter.equal(
      'menekan Bagikan dua kali tidak mengganti tautan yang sudah disebar',
      dibuatLagi.body?.shareToken,
      token
    );

    // ---------- Dibaca tanpa login ----------
    const respons = await fetch(`${apiUrl}/api/v1/share/${token}`);
    const isi = await respons.json();
    const teksIsi = JSON.stringify(isi);

    reporter.equal('tautan bisa dibuka tanpa login', respons.status, 200);
    reporter.equal('prompt hasilnya ikut terkirim', isi.media?.prompt, item.prompt);
    reporter.equal('jenis hasilnya ikut terkirim', isi.media?.type, item.type);
    reporter.check(
      'identitas & referensi penyimpanan tidak ikut terkirim',
      !teksIsi.includes('"userId"') && !teksIsi.includes('"outputFile"') && !teksIsi.includes('"shareToken"'),
      null
    );
    reporter.check('nama pemilik dilaporkan tanpa identitas akunnya', typeof isi.media?.sharedBy !== 'object', null);

    // ---------- Halaman publiknya ----------
    await session.open(`/share/${token}`);

    const halaman = await session.waitFor(
      async () => {
        const state = await session.evaluate(`(() => {
          return {
            path: window.location.pathname,
            teks: document.body.innerText,
            pilihan: document.querySelectorAll('[data-testid="share-error"]').length
          };
        })()`);

        return state.teks && state.teks.includes('baca-saja') ? state : null;
      },
      { timeoutMs: 15000 }
    );

    reporter.equal('halaman tautan terbuka di jalurnya', halaman?.path, `/share/${token}`);
    reporter.check('halaman menandai dirinya baca-saja', Boolean(halaman?.teks?.includes('baca-saja')), null);
    reporter.check(
      'halaman tidak menampilkan pesan tautan tidak ditemukan',
      halaman?.pilihan === 0,
      'data-testid="share-error" muncul di halaman'
    );

    // ---------- Dicabut ----------
    if (sudahDibagikanSebelumnya) {
      reporter.check(
        'item dev ini sudah dibagikan sebelumnya — uji pencabutan dilewati agar tautannya tidak mati',
        true,
        null
      );
      return;
    }

    const dicabut = await api.del(`/media/${item.contentId}/share`);

    reporter.equal('permintaan mencabut tautan dijawab 200', dicabut.status, 200);

    const setelahDicabut = await fetch(`${apiUrl}/api/v1/share/${token}`);

    reporter.equal('tautan yang sudah dicabut tidak bisa dibuka lagi', setelahDicabut.status, 404);

    reporter.equal('tidak ada respons HTTP >= 400 dari pemakaian normal', session.httpErrors.length, 0);
  }
};
