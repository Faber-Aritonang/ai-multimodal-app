/**
 * Spec: halaman /tools/image-to-video
 *
 * Sama seperti text-to-video: generate video sungguhan TIDAK dijalankan secara
 * default karena providernya berbayar per pekerjaan. Yang diuji di sini adalah
 * bagian yang paling mudah rusak dan tidak memakan biaya — unggahan gambar
 * pertama (termasuk pengecilan di browser), validasi server, dan pesan
 * kegagalan yang jelas saat kredensialnya belum ada.
 *
 * Alur lengkap dijalankan hanya bila diminta:
 *   TEST_VIDEO_GENERATE=1 npm run test:browser
 */

const PROMPT = `the camera slowly pushes in, automated browser test ${Date.now()}`;

const READ_STATE = `(() => {
  const kuota = document.querySelector('[data-testid="video-quota"]');
  const tombolGenerate = document.querySelector('[data-testid="generate-button"]');
  const pratinjau = document.querySelector('[data-testid="input-preview"]');
  const hasil = document.querySelector('[data-testid="latest-result"]');
  const vid = hasil ? hasil.querySelector('video') : null;
  const err = Array.from(document.querySelectorAll('[data-testid="error-message"] p'))
    .map((p) => p.innerText.trim())[0] || null;
  const proses = document.querySelector('[data-testid="generate-progress"]');
  return {
    kuota: kuota ? kuota.innerText.trim() : null,
    adaDropZone: Boolean(document.querySelector('[data-testid="drop-zone"]')),
    adaPratinjau: Boolean(pratinjau),
    pratinjauUrl: pratinjau ? pratinjau.getAttribute('src') : null,
    // Baris di bawah kotak unggah melaporkan ukuran hasil pengecilan di browser.
    infoBerkas: pratinjau
      ? (pratinjau.parentElement.parentElement.innerText.split(String.fromCharCode(10))
          .map((t) => t.trim())
          .filter((t) => t.indexOf('processed at') !== -1)[0] || null)
      : null,
    tombolNonaktif: tombolGenerate ? tombolGenerate.disabled : null,
    adaPrompt: Boolean(document.querySelector('[data-testid="prompt-input"]')),
    videoDimuat: vid ? vid.readyState + ':' + vid.videoWidth + 'x' + vid.videoHeight : null,
    videoUrl: vid ? vid.getAttribute('src') : null,
    metadata: hasil
      ? Array.from(hasil.querySelectorAll('p')).map((p) => p.innerText.trim())
          .filter((t) => t.indexOf('via') !== -1 || /[0-9]+p/.test(t))
      : [],
    teksProses: proses ? proses.innerText.trim() : null,
    teksError: err,
    teksHalaman: document.body.innerText
  };
})()`;

const SELECTOR_DROP = '[data-testid="drop-zone"]';
const SELECTOR_PROMPT = '[data-testid="prompt-input"]';

/**
 * Jatuhkan gambar yang dibuat di dalam halaman itu sendiri.
 *
 * Dipakai DataTransfer + DragEvent karena harness tidak menyentuh dialog berkas
 * OS: kotak unggahnya memang menangani `drop`, jadi jalur yang diuji tetap jalur
 * yang dipakai user. Gambarnya digambar lewat canvas supaya benar-benar bisa
 * didekode browser (PNG 8 byte tidak cukup untuk di-`img.onload`).
 */
const jatuhkanGambar = (width = 1600, height = 900) => `(async () => {
  const canvas = document.createElement('canvas');
  canvas.width = ${width};
  canvas.height = ${height};
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#22d3ee';
  ctx.fillRect(20, 20, canvas.width - 40, canvas.height - 40);
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  const file = new File([blob], 'first-frame.png', { type: 'image/png' });
  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(file);
  const zone = document.querySelector(${JSON.stringify(SELECTOR_DROP)});
  if (!zone) return 'tidak ada drop zone';
  zone.dispatchEvent(new DragEvent('drop', { dataTransfer, bubbles: true, cancelable: true }));
  return 'gambar dijatuhkan';
})()`;

const isiPrompt = (teks) => `(() => {
  const ta = document.querySelector(${JSON.stringify(SELECTOR_PROMPT)});
  if (!ta) return 'tidak ada prompt';
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, ${JSON.stringify(teks)});
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  return 'prompt terisi';
})()`;

module.exports = {
  name: 'image-to-video',

  async run({ session, reporter, api, sleep, health }) {
    const videoReady = health?.services?.videoReady === true;
    const jalankanPenuh = process.env.TEST_VIDEO_GENERATE === '1' && videoReady;

    const opsi = (await api.get('/media/video-options')).body || {};

    await session.open('/tools/image-to-video');

    const awal = await session.waitFor(async () => {
      const state = await session.evaluate(READ_STATE);
      return state.adaDropZone ? state : null;
    }, { timeoutMs: 20000 });

    reporter.check('halaman image-to-video terbuka', Boolean(awal), awal?.teksError);
    reporter.check('kotak unggah gambar pertama tersedia', awal?.adaDropZone === true);
    reporter.check('mode i2v ditawarkan server', (opsi.modes || []).includes('i2v'), (opsi.modes || []).join(','));
    reporter.equal('tombol generate nonaktif tanpa gambar', awal?.tombolNonaktif, true);

    await session.evaluate(jatuhkanGambar());
    await sleep(2000);

    const adaGambar = await session.evaluate(READ_STATE);
    reporter.check('gambar yang dijatuhkan tampil sebagai pratinjau', adaGambar.adaPratinjau === true);
    reporter.matches(
      'pratinjau memakai data URL hasil pengecilan di browser',
      adaGambar.pratinjauUrl || '',
      /^data:image\/(jpeg|png|webp);base64,/
    );
    // Batas sisi di browser adalah 1280px; 1600px yang dijatuhkan di atas harus
    // turun, dan itu dilaporkan apa adanya ke user. Pemisahnya tanda kali
    // Unicode (×) seperti di halaman image-to-image, jadi keduanya diterima
    // supaya spec tidak rapuh terhadap pilihan tipografinya.
    reporter.matches(
      'ukuran hasil pengecilan dilaporkan ke user',
      adaGambar.infoBerkas || '',
      /processed at 1280 [×x] 720/
    );

    await session.evaluate(isiPrompt(PROMPT));
    await sleep(600);

    const siap = await session.evaluate(READ_STATE);
    reporter.equal('tombol generate aktif setelah gambar + prompt ada', siap.tombolNonaktif, false);

    // ---- Jalur validasi server (tidak memakan biaya) ----
    const tanpaGambar = await api.post('/media/image-to-video', { prompt: PROMPT });
    reporter.equal('tanpa gambar ditolak server', tanpaGambar.status, 400);

    const bukanGambar = await api.post('/media/image-to-video', {
      prompt: PROMPT,
      image: 'data:image/png;base64,' + btoa('bukan gambar sama sekali')
    });
    reporter.equal('berkas yang bukan gambar ditolak server', bukanGambar.status, 400);

    const resolusiPalsu = await api.post('/media/image-to-video', {
      prompt: PROMPT,
      image: adaGambar.pratinjauUrl,
      resolution: '480p'
    });
    reporter.equal('resolusi 480p ditolak server', resolusiPalsu.status, 400);

    if (jalankanPenuh) {
      await session.evaluate(`(() => {
        document.querySelector('[data-testid="generate-button"]').click();
        return 'generate diklik';
      })()`);

      const hasil = await session.waitFor(async () => {
        const state = await session.evaluate(READ_STATE);
        if (state.teksError) return state;
        return state.videoDimuat && state.videoDimuat.indexOf('0x0') === -1 ? state : null;
      }, { timeoutMs: 480000, intervalMs: 5000 });

      if (!reporter.check('video berhasil dibuat dan bisa diputar browser',
        Boolean(hasil && !hasil.teksError),
        hasil?.teksError || hasil?.videoDimuat)) return;

      reporter.check(
        'metadata menyebut resolusi, mode i2v, dan provider',
        hasil.metadata.some((t) => t.indexOf('via') !== -1 && t.indexOf('i2v') !== -1),
        hasil.metadata.join(' ; ')
      );
      const kuotaSekarang = Number(String(hasil.kuota || '').match(/[0-9]+/)?.[0] ?? NaN);
      const kuotaMula = Number(String(awal?.kuota || '').match(/[0-9]+/)?.[0] ?? NaN);
      reporter.equal('kuota video berkurang 1', kuotaSekarang, kuotaMula - 1);
    } else if (videoReady) {
      reporter.check('alur generate dilewati (set TEST_VIDEO_GENERATE=1 untuk mengujinya)', true);
    } else {
      await session.evaluate(`(() => {
        document.querySelector('[data-testid="generate-button"]').click();
        return 'generate diklik';
      })()`);

      const gagal = await session.waitFor(async () => {
        const state = await session.evaluate(READ_STATE);
        return state.teksError ? state : null;
      }, { timeoutMs: 30000, intervalMs: 1000 });

      reporter.check('kegagalan dijelaskan di UI', Boolean(gagal), gagal?.teksError);
      reporter.matches(
        'pesan menyebut kredensial provider yang belum diisi',
        gagal?.teksError || '',
        /BYNARA_API_KEY|All video providers failed|contact the administrator/i
      );
    }

    reporter.equal('tidak ada respons HTTP >= 400', session.httpErrors.length, 0);
  }
};
