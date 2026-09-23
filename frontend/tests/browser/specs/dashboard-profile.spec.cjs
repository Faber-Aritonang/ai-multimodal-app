/**
 * Spec: halaman /dashboard dan /profile
 *
 * Halaman-halaman ini sebelumnya tidak pernah diuji. Spec ini membandingkan apa
 * yang tampil di UI dengan data asli dari API (kuota, referral, profil), jadi
 * nilai yang salah atau kosong akan langsung terlihat.
 */

const READ_DASHBOARD = `(() => {
  const kartu = Array.from(document.querySelectorAll('[data-testid="tool-card"]'));
  const kuota = {};
  Array.from(document.querySelectorAll('[data-testid="quota-value"]')).forEach((el) => {
    kuota[el.getAttribute('data-quota-key')] = el.innerText.trim();
  });
  // Halaman punya beberapa h1 (layout memakai satu untuk judul aplikasi),
  // jadi dicari yang isinya sapaan ke user.
  const sapaan = Array.from(document.querySelectorAll('h1'))
    .map((h) => h.innerText.trim())
    .find((t) => t.indexOf('Welcome back') !== -1) || null;
  return {
    path: location.pathname,
    judul: sapaan,
    kuota,
    jumlahKartu: kartu.length,
    kartuTersedia: kartu.filter((k) => k.getAttribute('data-available') === 'true').length,
    kartuSegera: kartu.filter((k) => k.getAttribute('data-available') === 'false').length,
    adaBadgeSegera: document.body.innerText.indexOf('Coming Soon') !== -1
  };
})()`;

const READ_PROFILE = `(() => {
  const teks = (testid) => {
    const el = document.querySelector('[data-testid="' + testid + '"]');
    return el ? (el.value !== undefined && el.value !== null && el.tagName === 'INPUT' ? el.value : el.innerText.trim()) : null;
  };
  const kuota = {};
  Array.from(document.querySelectorAll('[data-testid="quota-value"]')).forEach((el) => {
    kuota[el.getAttribute('data-quota-key')] = el.innerText.trim();
  });
  const qr = document.querySelector('[data-testid="referral-qr"]');
  return {
    path: location.pathname,
    nama: teks('profile-name'),
    email: teks('profile-email'),
    kodeReferral: teks('referral-code'),
    tautanReferral: teks('referral-link'),
    totalReferral: teks('referral-total'),
    memberSince: teks('member-since'),
    adaQr: qr ? Boolean(qr.querySelector('svg')) : false,
    kuota
  };
})()`;

module.exports = {
  name: 'dashboard-profile',

  async run({ session, reporter, api }) {
    const kuotaApi = await api.get('/member/quota');
    const referralApi = await api.get('/member/referral-stats');
    const profilApi = await api.get('/member/profile');

    // ---------- Dashboard ----------
    await session.open('/dashboard');

    const dashboard = await session.waitFor(async () => {
      const state = await session.evaluate(READ_DASHBOARD);
      return state.judul ? state : null;
    }, { timeoutMs: 15000 });

    reporter.check('dashboard terbuka', dashboard?.path === '/dashboard', dashboard?.path);
    reporter.contains('judul menyapa user dengan namanya', dashboard?.judul, profilApi.body?.user?.displayName || 'Dev Member');
    // Angka ini berubah saat fitur baru diaktifkan — assertion-nya menyengaja
    // agar daftar fitur di dashboard tidak diam-diam bergeser.
    reporter.equal('jumlah kartu tool', dashboard?.jumlahKartu, 7);

    // Bertambah saat text-to-video & image-to-video diaktifkan: chat,
    // text-to-image, image-to-image, text-to-video, image-to-video,
    // text-to-sound, sound-to-text.
    reporter.equal('kartu yang bisa dipakai', dashboard?.kartuTersedia, 7);
    // Tidak ada kartu yang tersisa sebagai rencana: seluruh alat sudah jalan.
    reporter.equal('kartu "Coming Soon"', dashboard?.kartuSegera, 0);
    reporter.equal('tidak ada label Coming Soon di dashboard', dashboard?.adaBadgeSegera, false);

    if (kuotaApi.body?.quota) {
      reporter.equal('kuota chat di dashboard sesuai API', dashboard?.kuota?.chat, String(kuotaApi.body.quota.chat));
      reporter.equal('kuota gambar di dashboard sesuai API', dashboard?.kuota?.imageGeneration, String(kuotaApi.body.quota.imageGeneration));
    }

    // ---------- Profile ----------
    await session.open('/profile');

    const profile = await session.waitFor(async () => {
      const state = await session.evaluate(READ_PROFILE);
      return state.nama ? state : null;
    }, { timeoutMs: 15000 });

    reporter.equal('profile terbuka', profile?.path, '/profile');
    reporter.equal('nama di profil sesuai API', profile?.nama, profilApi.body?.user?.displayName);
    reporter.equal('email di profil sesuai API', profile?.email, profilApi.body?.user?.email);
    reporter.check('kode referral tampil', Boolean(profile?.kodeReferral && profile.kodeReferral !== 'Belum tersedia'), profile?.kodeReferral);
    reporter.equal('kode referral sama dengan API', profile?.kodeReferral, referralApi.body?.referralCode);
    reporter.check('tautan undangan memuat kode referral',
      typeof profile?.tautanReferral === 'string' && profile.tautanReferral.indexOf(`?ref=${referralApi.body?.referralCode}`) !== -1,
      profile?.tautanReferral);
    reporter.equal('total referral sesuai API', profile?.totalReferral, String(referralApi.body?.totalReferrals ?? 0));
    reporter.equal('QR code referral ter-render', profile?.adaQr, true);

    if (kuotaApi.body?.quota) {
      reporter.equal('kuota chat di profil sesuai API', profile?.kuota?.chat, String(kuotaApi.body.quota.chat));
      reporter.equal('kuota gambar di profil sesuai API', profile?.kuota?.imageGeneration, String(kuotaApi.body.quota.imageGeneration));
    }

    // createdAt tidak pernah dikirim oleh login/dev-login/status, jadi nilai ini
    // dulu selalu 'N/A' untuk semua user.
    const memberSince = profile?.memberSince;
    reporter.check(
      'Member Since menampilkan tanggal, bukan N/A',
      Boolean(memberSince && memberSince !== 'N/A' && memberSince.length > 0),
      memberSince
    );

    reporter.equal('tidak ada respons HTTP >= 400', session.httpErrors.length, 0);
  }
};
