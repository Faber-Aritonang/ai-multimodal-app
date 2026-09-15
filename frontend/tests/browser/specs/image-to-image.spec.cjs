/**
 * Spec: halaman /tools/image-to-image
 *
 * Dua mode, dipilih dari konfigurasi backend yang sebenarnya:
 *   - provider siap   -> uji alur lengkap: hasil transformasi, metadata, kuota, bersih-bersih
 *   - belum dikonfigurasi -> uji bahwa permintaan gagal dengan pesan yang jelas,
 *     tidak ada kuota yang terpakai, dan tidak ada hasil palsu
 *
 * Gambar input dibuat di halaman lewat canvas (tanpa file fixture di repo) dan
 * dimasukkan lewat event drop, supaya jalur unggah yang dipakai user ikut teruji.
 */

const MAX_EDGE = 512;

const READ_STATE = `(() => {
  const nl = String.fromCharCode(10);
  const kuota = document.querySelector('[data-testid="image-quota"]');
  const preview = document.querySelector('[data-testid="input-preview"]');
  const hasil = document.querySelector('[data-testid="latest-result"]');
  const img = hasil ? hasil.querySelector('img[alt]') : null;
  const figs = Array.from(document.querySelectorAll('[data-testid="history-item"]'));
  const err = Array.from(document.querySelectorAll('.bg-red-50 p')).map((p) => p.innerText.trim())[0] || null;
  return {
    kuota: kuota ? kuota.innerText.trim() : null,
    adaPreview: Boolean(preview),
    lebarPreview: preview ? preview.naturalWidth : null,
    ukuranTerpilih: (() => {
      const aktif = Array.from(document.querySelectorAll('button')).find(
        (b) => b.className.indexOf('border-primary-500') !== -1 && /Square|Landscape|Portrait/.test(b.innerText)
      );
      return aktif ? aktif.innerText.split(nl)[0].trim() : null;
    })(),
    catatanInput: (() => {
      const p = Array.from(document.querySelectorAll('p')).find((el) => el.innerText.indexOf('processed at') !== -1);
      return p ? p.innerText.trim() : null;
    })(),
    adaBagianHasil: Boolean(hasil),
    hasilDimuat: img ? img.naturalWidth + 'x' + img.naturalHeight : null,
    jumlahGambarHasil: hasil ? hasil.querySelectorAll('img').length : 0,
    metadata: hasil
      ? Array.from(hasil.querySelectorAll('p'))
          .map((p) => p.innerText.trim())
          .filter((t) => t.indexOf('via') !== -1 || /[0-9]+x[0-9]+/.test(t))
      : [],
    jumlahRiwayat: figs.length,
    riwayatPertama: figs[0] ? figs[0].innerText.split(nl).join(' | ') : null,
    tombolNonaktif: (() => {
      const b = document.querySelector('[data-testid="generate-button"]');
      return b ? b.disabled : null;
    })(),
    teksError: err
  };
})()`;

const angkaDari = (teks) => {
  const cocok = String(teks || '').match(/[0-9]+/);
  return cocok ? Number(cocok[0]) : null;
};

module.exports = {
  name: 'image-to-image',

  async run({ session, reporter, api, sleep, health }) {
    // Backend sendiri yang memutuskan apakah image-to-image bisa dijalankan
    // (kredensial Cloudflare ada, atau PUBLIC_BASE_URL publik diisi).
    const providerSiap = health?.services?.imageEditReady === true;

    await session.open('/tools/image-to-image');

    const awal = await session.waitFor(async () => {
      const state = await session.evaluate(READ_STATE);
      return state.kuota ? state : null;
    }, { timeoutMs: 20000 });

    const kuotaAwal = awal ? angkaDari(awal.kuota) : null;
    reporter.check('halaman menampilkan sisa kuota gambar', Number.isFinite(kuotaAwal), awal?.kuota);
    reporter.equal('tombol transform nonaktif sebelum ada gambar', awal?.tombolNonaktif, true);

    // 1. Buat gambar 900x600 di halaman lalu masukkan lewat event drop.
    const dropped = await session.evaluate(`(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 900;
      canvas.height = 600;
      const ctx = canvas.getContext('2d');

      const gradient = ctx.createLinearGradient(0, 0, 900, 600);
      gradient.addColorStop(0, '#1d4ed8');
      gradient.addColorStop(1, '#f59e0b');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 900, 600);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(80, 80, 300, 200);

      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      const file = new File([blob], 'browser-test.png', { type: 'image/png' });

      const dt = new DataTransfer();
      dt.items.add(file);

      const zone = document.querySelector('[data-testid="drop-zone"]');
      zone.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));

      return { ukuran: file.size };
    })()`);

    reporter.check('gambar uji berhasil dibuat di browser', dropped?.ukuran > 0, JSON.stringify(dropped));

    const setelahDrop = await session.waitFor(async () => {
      const state = await session.evaluate(READ_STATE);
      return state.adaPreview && state.catatanInput ? state : null;
    }, { timeoutMs: 15000, intervalMs: 700 });

    if (!reporter.check('preview gambar tampil setelah drop', Boolean(setelahDrop), setelahDrop?.catatanInput)) {
      reporter.check('tidak ada error di halaman', !setelahDrop?.teksError, setelahDrop?.teksError);
      return;
    }

    // Gambar diperkecil di browser sebelum dikirim (batas provider 512px)
    reporter.check(
      `gambar input diperkecil ke <= ${MAX_EDGE}px`,
      setelahDrop.lebarPreview <= MAX_EDGE && setelahDrop.lebarPreview > 0,
      `${setelahDrop.lebarPreview}px · ${setelahDrop.catatanInput}`
    );
    // 900x600 (landscape) seharusnya memilih preset Landscape
    reporter.equal('preset ukuran mengikuti bentuk gambar', setelahDrop.ukuranTerpilih, 'Landscape');

    // 2. Isi prompt
    await session.evaluate(`(() => {
      const ta = document.querySelector('[data-testid="prompt-input"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, 'turn it into a watercolor painting with warm sunset light');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return 'prompt terisi';
    })()`);
    await sleep(400);

    const tombolNonaktif = await session.evaluate(
      `(() => document.querySelector('[data-testid="generate-button"]').disabled)()`
    );
    reporter.equal('tombol transform aktif setelah gambar + prompt siap', tombolNonaktif, false);

    // 3. Transform
    await session.evaluate(`(() => {
      document.querySelector('[data-testid="generate-button"]').click();
      return 'transform diklik';
    })()`);

    const selesai = await session.waitFor(async () => {
      const state = await session.evaluate(READ_STATE);
      if (state.teksError) return state;
      return state.hasilDimuat && state.hasilDimuat !== '0x0' ? state : null;
    }, { timeoutMs: 210000, intervalMs: 3000 });

    if (!reporter.check('permintaan transformasi selesai (hasil atau pesan error)',
      Boolean(selesai), selesai?.teksError)) {
      return;
    }

    // ---------- Mode tanpa kredensial: gagal dengan jelas, bukan hasil palsu ----------
    if (!providerSiap) {
      // Halaman sengaja mencatat detail kegagalan ke console untuk debugging,
      // sementara UI menampilkan pesan yang ramah ke user.
      session.allowConsoleErrors(/Image transformation failed/);

      reporter.check(
        'pesan error menjelaskan cara mengaktifkan (bukan pesan generik)',
        /CLOUDFLARE_ACCOUNT_ID|PUBLIC_BASE_URL/.test(selesai.teksError || ''),
        selesai.teksError
      );
      reporter.check('tidak ada bagian hasil yang menyesatkan', selesai.adaBagianHasil === false);
      reporter.equal('kuota gambar tidak terpakai saat gagal', angkaDari(selesai.kuota), kuotaAwal);

      const gagal = await api.get('/media/history?type=image-to-image&limit=1');
      const record = gagal.body?.media?.[0];

      reporter.equal('permintaan yang gagal tercatat sebagai failed', record?.status, 'failed');

      if (record?.contentId) {
        const hapus = await api.del(`/media/${record.contentId}`);
        reporter.equal('record gagal dibersihkan lewat API', hapus.status, 200);
      }

      return;
    }

    // ---------- Mode provider siap: alur lengkap ----------
    reporter.equal('menampilkan pasangan sebelum & sesudah', selesai.jumlahGambarHasil, 2);
    reporter.check(
      'metadata menyebut resolusi, gambar asal, dan provider',
      selesai.metadata.some((t) => /[0-9]+x[0-9]+/.test(t) && t.indexOf('from ') !== -1 && t.indexOf('via') !== -1),
      selesai.metadata.join(' ; ')
    );
    reporter.check(
      'riwayat menampilkan hasil transformasi',
      Boolean(selesai.riwayatPertama && selesai.jumlahRiwayat >= 1),
      selesai.riwayatPertama
    );
    reporter.equal('kuota gambar berkurang 1', angkaDari(selesai.kuota), kuotaAwal - 1);
    reporter.equal('tidak ada respons HTTP >= 400', session.httpErrors.length, 0);

    const daftar = await api.get('/media/history?type=image-to-image&limit=1');
    const terbaru = daftar.body?.media?.[0];

    if (terbaru?.contentId) {
      const hapus = await api.del(`/media/${terbaru.contentId}`);
      reporter.equal('hasil uji dibersihkan lewat API', hapus.status, 200);
    }
  }
};
