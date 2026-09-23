/**
 * Spec: halaman /tools/text-to-video
 *
 * PENTING — berbeda dari spec fitur lain, di sini generate video sungguhan TIDAK
 * dijalankan secara default. Alasannya bukan teknis: provider video satu-satunya
 * (NaraRouter) berbayar per pekerjaan, dan satu video memakan 1-5 menit. Menjalankan
 * itu di setiap `npm run test:browser` berarti setiap kali menjalankan test Anda
 * membelanjakan saldo NaraRouter dan menunggu lama.
 *
 * Karena itu spec ini menguji hal yang tidak memakan biaya dan justru paling
 * sering salah: opsi yang ditampilkan cocok dengan yang divalidasi server, tombol
 * generate tidak bisa ditekan tanpa prompt, validasi server menolak nilai yang
 * tidak didukung provider, dan pesan kegagalan jelas saat kredensialnya belum ada.
 *
 * Alur lengkap (generate + tunggu + putar) dijalankan HANYA bila diminta:
 *   TEST_VIDEO_GENERATE=1 npm run test:browser
 */

const PROMPT = `a paper boat drifting down a rain-soaked street, automated browser test ${Date.now()}`;

const READ_STATE = `(() => {
  const nl = String.fromCharCode(10);
  const kuota = document.querySelector('[data-testid="video-quota"]');
  const tombolGenerate = document.querySelector('[data-testid="generate-button"]');
  const hasil = document.querySelector('[data-testid="latest-result"]');
  const vid = hasil ? hasil.querySelector('video') : null;
  const figs = Array.from(document.querySelectorAll('[data-testid="history-item"]'));
  const err = Array.from(document.querySelectorAll('[data-testid="error-message"] p'))
    .map((p) => p.innerText.trim())[0] || null;
  return {
    kuota: kuota ? kuota.innerText.trim() : null,
    adaHasil: Boolean(hasil),
    videoDimuat: vid ? vid.readyState + ':' + vid.videoWidth + 'x' + vid.videoHeight : null,
    videoUrl: vid ? vid.getAttribute('src') : null,
    adaTombolUnduh: hasil ? Boolean(hasil.querySelector('a[download]')) : null,
    metadata: hasil
      ? Array.from(hasil.querySelectorAll('p'))
          .map((p) => p.innerText.trim())
          .filter((t) => t.indexOf('via') !== -1 || /[0-9]+p/.test(t))
      : [],
    resolusiTombol: Array.from(document.querySelectorAll('button'))
      .map((b) => b.innerText.trim())
      .filter((t) => /^[0-9]+p$/.test(t)),
    durasiTombol: Array.from(document.querySelectorAll('[data-testid="duration-options"] button'))
      .map((b) => Number(b.innerText.trim().replace('s', ''))),
    promptAda: Boolean(document.querySelector('[data-testid="prompt-input"]')),
    tombolNonaktif: tombolGenerate ? tombolGenerate.disabled : null,
    jumlahRiwayat: figs.length,
    adaPanelProses: Boolean(document.querySelector('[data-testid="video-progress-panel"]')),
    pesanBerkasHilang: document.querySelectorAll('[data-testid="media-missing"]').length,
    teksError: err,
    teksHalaman: document.body.innerText
  };
})()`;

const angkaDari = (teks) => {
  const cocok = String(teks || '').match(/[0-9]+/);
  return cocok ? Number(cocok[0]) : null;
};

const isiPrompt = (teks) => `(() => {
  const ta = document.querySelector('#prompt');
  if (!ta) return 'tidak ada prompt';
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, ${JSON.stringify(teks)});
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  return 'prompt terisi';
})()`;

module.exports = {
  name: 'text-to-video',

  async run({ session, reporter, api, sleep, health }) {
    const videoReady = health?.services?.videoReady === true;
    const jalankanPenuh = process.env.TEST_VIDEO_GENERATE === '1' && videoReady;

    // Opsi yang benar-benar divalidasi server — UI harus menampilkan hal yang sama.
    const opsiApi = await api.get('/media/video-options');
    const opsi = opsiApi.body || {};

    await session.open('/tools/text-to-video');

    const awal = await session.waitFor(async () => {
      const state = await session.evaluate(READ_STATE);
      return state.promptAda ? state : null;
    }, { timeoutMs: 20000 });

    reporter.check('halaman text-to-video terbuka', Boolean(awal), awal?.teksError);
    reporter.check('kolom prompt tersedia', awal?.promptAda === true);

    const kuotaAwal = awal ? angkaDari(awal.kuota) : null;
    reporter.check('halaman menampilkan sisa kuota video', Number.isFinite(kuotaAwal), awal?.kuota);

    // UI harus menawarkan persis resolusi yang divalidasi server (dan 480p tidak
    // boleh muncul: providernya hanya mendukung 720p/1080p).
    reporter.equal(
      'pilihan resolusi di UI sama dengan daftar server',
      (awal?.resolusiTombol || []).join(','),
      (opsi.resolutions || []).join(',')
    );
    reporter.check('480p tidak ditawarkan', !(awal?.resolusiTombol || []).includes('480p'));

    // Rentang durasi 3-15 detik yang ditawarkan provider harus tampil seluruhnya.
    reporter.equal(
      'pilihan durasi di UI sama dengan daftar server',
      (awal?.durasiTombol || []).join(','),
      (opsi.durations || []).join(',')
    );
    reporter.equal('durasi terendah 3 detik ditawarkan', awal?.durasiTombol?.[0], 3);
    reporter.equal('durasi tertinggi 15 detik ditawarkan', awal?.durasiTombol?.slice(-1)[0], 15);

    // Tombol tidak boleh bisa ditekan tanpa prompt — tanpa ini, satu klik tidak
    // sengaja akan memulai pekerjaan berbayar.
    reporter.equal('tombol generate nonaktif tanpa prompt', awal?.tombolNonaktif, true);

    await session.evaluate(isiPrompt(PROMPT));
    await sleep(600);

    const sesudahPrompt = await session.evaluate(READ_STATE);
    reporter.equal('tombol generate aktif setelah prompt diisi', sesudahPrompt.tombolNonaktif, false);

    // ---- Validasi server yang tidak bisa dilakukan UI: nilai yang tidak didukung
    // ---- provider harus ditolak 400 sebelum pekerjaan berbayar dimulai.
    const resolusiPalsu = await api.post('/media/text-to-video', {
      prompt: PROMPT,
      resolution: '480p'
    });
    reporter.equal('resolusi 480p ditolak server', resolusiPalsu.status, 400);

    const durasiPalsu = await api.post('/media/text-to-video', { prompt: PROMPT, duration: 60 });
    reporter.equal('durasi 60 detik ditolak server', durasiPalsu.status, 400);

    const durasiTerlaluPendek = await api.post('/media/text-to-video', { prompt: PROMPT, duration: 2 });
    reporter.equal('durasi 2 detik (di bawah 3) ditolak server', durasiTerlaluPendek.status, 400);

    const durasiTerlaluPanjang = await api.post('/media/text-to-video', { prompt: PROMPT, duration: 16 });
    reporter.equal('durasi 16 detik (di atas 15) ditolak server', durasiTerlaluPanjang.status, 400);

    // Memilih durasi hanya mengubah UI — tidak memulai pekerjaan berbayar.
    await session.evaluate(`(() => {
      const tombol = document.querySelector('[data-testid="duration-option-12"]');
      if (tombol) tombol.click();
      return 'durasi diklik';
    })()`);
    const sesudahDurasi = await session.evaluate(`document.body.innerText.indexOf('12 detik') !== -1`);
    reporter.equal('memilih durasi 12 detik tercermin di ringkasan', sesudahDurasi, true);

    const promptKosong = await api.post('/media/text-to-video', { prompt: '   ' });
    reporter.equal('prompt kosong ditolak server', promptKosong.status, 400);

    if (jalankanPenuh) {
      // ---- Alur lengkap (berbayar): generate, tunggu 1-5 menit, lalu putar ----
      await session.evaluate(`(() => {
        document.querySelector('[data-testid="generate-button"]').click();
        return 'generate diklik';
      })()`);

      // Panel proses harus muncul cepat: tanpa itu user tidak tahu apa-apa sedang
      // terjadi dan memuat ulang halaman di tengah pekerjaan.
      const panelProses = await session.waitFor(async () => {
        const state = await session.evaluate(READ_STATE);
        return state.adaPanelProses || state.teksError ? state : null;
      }, { timeoutMs: 20000, intervalMs: 1000 });
      reporter.check('panel proses tampil selama rendering', panelProses?.adaPanelProses === true);

      const hasil = await session.waitFor(async () => {
        const state = await session.evaluate(READ_STATE);
        if (state.teksError) return state;
        return state.videoDimuat && state.videoDimuat.indexOf('0x0') === -1 ? state : null;
      }, { timeoutMs: 480000, intervalMs: 5000 });

      if (!reporter.check('video berhasil dibuat dan bisa diputar browser',
        Boolean(hasil && !hasil.teksError),
        hasil?.teksError || hasil?.videoDimuat)) return;

      reporter.check('tautan unduh tersedia', hasil.adaTombolUnduh === true);
      reporter.check(
        'metadata menyebut resolusi, durasi, dan provider',
        hasil.metadata.some((t) => /[0-9]+p/.test(t) && t.indexOf('via') !== -1),
        hasil.metadata.join(' ; ')
      );
      reporter.equal('kuota video berkurang 1', angkaDari(hasil.kuota), kuotaAwal - 1);
      reporter.check('riwayat memuat videonya', hasil.jumlahRiwayat > 0, hasil.jumlahRiwayat);

      // Berkas yang hilang harus dijelaskan, bukan menjadi pemutar kosong.
      const namaBerkas = String(hasil.videoUrl).split('/').pop();
      await session.blockUrls([`*${namaBerkas}*`]);
      await session.open('/tools/text-to-video', { settleMs: 7000 });

      const berkasHilang = await session.waitFor(async () => {
        const state = await session.evaluate(READ_STATE);
        return state.pesanBerkasHilang > 0 ? state : null;
      }, { timeoutMs: 25000, intervalMs: 1500 });

      reporter.check('berkas video yang hilang dijelaskan ke user', Boolean(berkasHilang));

      await session.unblockUrls();
      session.clearNetworkFailures();
    } else if (videoReady) {
      // Kredensial ada tetapi alur penuh tidak diminta: jangan belanjakan kuota.
      reporter.check(
        'alur generate dilewati (set TEST_VIDEO_GENERATE=1 untuk mengujinya)',
        true
      );
    } else {
      // Tanpa kredensial: klik generate dan pastikan pesannya jelas — bukan
      // "coba lagi" untuk masalah yang hanya bisa diperbaiki admin.
      await session.evaluate(`(() => {
        document.querySelector('[data-testid="generate-button"]').click();
        return 'generate diklik';
      })()`);

      const gagal = await session.waitFor(async () => {
        const state = await session.evaluate(READ_STATE);
        return state.teksError ? state : null;
      }, { timeoutMs: 30000, intervalMs: 1000 });

      reporter.check('kegagalan dijelaskan di UI', Boolean(gagal), gagal?.teksError);
      reporter.equal(
        'kuota tidak berkurang saat pembuatan gagal',
        angkaDari(gagal?.kuota),
        kuotaAwal
      );
      // Pesannya harus menyebut apa yang perlu diperbaiki, bukan ajakan mengulang.
      reporter.matches(
        'pesan menyebut kredensial provider yang belum diisi',
        gagal?.teksError || '',
        /BYNARA_API_KEY|All video providers failed|contact the administrator/i
      );
    }

    reporter.equal('tidak ada respons HTTP >= 400', session.httpErrors.length, 0);
  }
};
