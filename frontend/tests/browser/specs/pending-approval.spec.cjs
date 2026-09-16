/**
 * Spec: alur approval member
 *
 * Menguji jalur yang paling mahal kalau salah: member yang sudah disetujui admin
 * tetap tertahan di halaman "Pending Approval".
 *
 * Penyebabnya halus. Halaman pending memantau status tiap 30 detik, tapi dulu ia
 * hanya memanggil navigate('/dashboard') tanpa memperbarui state `user` di
 * App.jsx. ProtectedRoute masih membaca isApproved: false dari login, lalu
 * melempar user balik ke halaman pending — berputar tanpa akhir sampai ia
 * refresh sendiri, padahal layarnya menjanjikan "usually takes less than a
 * minute".
 *
 * Spec ini menirukan kondisi nyata itu: token guest ditanam di browser lebih
 * dulu (sesi lama), baru approval terjadi di server.
 */

const PENDING_EMAIL = 'dev.pending@example.com';

const READ_PAGE = `(() => ({
  path: location.pathname,
  judul: Array.from(document.querySelectorAll('h1')).map((h) => h.innerText.trim())
}))()`;

module.exports = {
  name: 'pending-approval',

  async run({ session, reporter, api }) {
    // 1. Sesi lama yang dipegang browser: user guest, belum disetujui.
    const guest = await api.post('/auth/dev-login', { email: PENDING_EMAIL, role: 'guest' });
    reporter.check('dev-login guest berhasil', guest.ok && Boolean(guest.body?.token), guest.body?.message);
    reporter.equal('user guest memang belum disetujui', guest.body?.user?.isApproved, false);

    await session.setAuth({ token: guest.body.token, user: guest.body.user });

    // 2. Route member harus menahannya di halaman pending.
    await session.open('/dashboard');

    const pending = await session.waitFor(async () => {
      const state = await session.evaluate(READ_PAGE);
      return state.path === '/pending-approval' ? state : null;
    }, { timeoutMs: 15000 });

    reporter.equal('route member menahan user yang belum disetujui', pending?.path, '/pending-approval');
    reporter.check('halaman pending menampilkan judulnya',
      (pending?.judul || []).includes('Pending Approval'), JSON.stringify(pending?.judul));

    // 3. Admin menyetujui dari sisi server (tab user tidak disentuh).
    const approved = await api.post('/auth/dev-login', { email: PENDING_EMAIL, role: 'member' });
    reporter.equal('approval di server berhasil', approved.body?.user?.isApproved, true);

    // 4. Tanpa reload manual, halaman harus berpindah sendiri setelah
    //    pemeriksaan status berikutnya (interval 30 detik di halaman pending).
    const moved = await session.waitFor(async () => {
      const state = await session.evaluate(READ_PAGE);
      return state.path === '/dashboard' ? state : null;
    }, { timeoutMs: 75000, intervalMs: 2000 });

    reporter.equal('user masuk ke dashboard tanpa reload manual', moved?.path, '/dashboard');

    reporter.equal('tidak ada respons HTTP >= 400', session.httpErrors.length, 0);
  }
};
