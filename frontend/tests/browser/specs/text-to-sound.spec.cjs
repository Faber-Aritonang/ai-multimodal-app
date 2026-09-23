/**
 * Spec: halaman /tools/text-to-sound
 *
 * Dua mode, dipilih dari konfigurasi backend yang sebenarnya:
 *   - provider siap   -> uji alur lengkap: audio benar-benar bisa diputar di
 *     browser, metadata, kuota, dan bersih-bersih
 *   - belum dikonfigurasi -> uji bahwa permintaan gagal dengan pesan yang jelas,
 *     tidak ada kuota yang terpakai, dan tidak ada hasil palsu
 *
 * Yang diperiksa bukan hanya "ada elemen <audio>", tetapi juga bahwa berkasnya
 * benar-benar termuat (`readyState`) — pemutar yang diam karena berkasnya 404
 * adalah kegagalan yang nyata dan pernah terjadi pada fitur gambar.
 */

const READ_STATE = `(() => {
  const nl = String.fromCharCode(10);
  const kuota = document.querySelector('[data-testid="sound-quota"]');
  const hasil = document.querySelector('[data-testid="latest-result"]');
  const audio = document.querySelector('[data-testid="media-audio"]');
  const items = Array.from(document.querySelectorAll('[data-testid="history-item"]'));
  // Kotak error ditandai data-testid, bukan kelas warna (lihat catatan yang sama
  // di spec text-to-image).
  const err = Array.from(document.querySelectorAll('[data-testid="error-message"] p')).map((p) => p.innerText.trim())[0] || null;
  const tombol = document.querySelector('[data-testid="generate-button"]');
  const select = document.querySelector('[data-testid="voice-select"]');
  return {
    kuota: kuota ? kuota.innerText.trim() : null,
    tombolNonaktif: tombol ? tombol.disabled : null,
    voiceTerpilih: select ? select.value : null,
    jumlahVoice: select ? select.options.length : 0,
    adaHasil: Boolean(hasil),
    audio: audio
      ? { readyState: audio.readyState, duration: Number.isFinite(audio.duration) ? audio.duration : null }
      : null,
    metadata: hasil
      ? Array.from(hasil.querySelectorAll('p'))
          .map((p) => p.innerText.trim())
          .filter((t) => t.indexOf('via') !== -1 || /WAV|MP3/.test(t))
      : [],
    jumlahRiwayat: items.length,
    riwayatPertama: items[0] ? items[0].innerText.split(nl).join(' | ') : null,
    teksError: err
  };
})()`;

const angkaDari = (teks) => {
  const cocok = String(teks || '').match(/[0-9]+/);
  return cocok ? Number(cocok[0]) : null;
};

module.exports = {
  name: 'text-to-sound',

  async run({ session, reporter, api, sleep, health }) {
    // Backend sendiri yang memutuskan apakah fitur ini bisa dijalankan
    // (kredensial provider suara sudah sampai ke container atau belum).
    const providerSiap = health?.services?.soundReady === true;

    await session.open('/tools/text-to-sound');

    const awal = await session.waitFor(async () => {
      const state = await session.evaluate(READ_STATE);
      return state.kuota ? state : null;
    }, { timeoutMs: 20000 });

    const kuotaAwal = awal ? angkaDari(awal.kuota) : null;
    reporter.check('halaman menampilkan sisa kuota audio', Number.isFinite(kuotaAwal), awal?.kuota);
    reporter.equal('tombol generate nonaktif sebelum ada teks', awal?.tombolNonaktif, true);
    // Pemilih voice harus benar-benar terisi (bukan daftar kosong), karena
    // daftarnya datang dari provider yang aktif di backend.
    reporter.check('daftar voice bawaan terisi', (awal?.jumlahVoice || 0) >= 2, `voice terpilih: ${awal?.voiceTerpilih}`);

    // 1. Isi teks yang akan diucapkan
    await session.evaluate(`(() => {
      const ta = document.querySelector('[data-testid="text-input"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, 'Selamat pagi, ini contoh suara yang dibuat dari teks.');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return 'teks terisi';
    })()`);
    await sleep(400);

    const tombolNonaktif = await session.evaluate(
      `(() => document.querySelector('[data-testid="generate-button"]').disabled)()`
    );
    reporter.equal('tombol generate aktif setelah teks diisi', tombolNonaktif, false);

    // 2. Generate
    await session.evaluate(`(() => {
      document.querySelector('[data-testid="generate-button"]').click();
      return 'generate diklik';
    })()`);

    const selesai = await session.waitFor(async () => {
      const state = await session.evaluate(READ_STATE);
      if (state.teksError) return state;
      // `readyState >= 1` berarti metadatanya sudah terbaca — audio benar-benar
      // tersedia, bukan sekadar elemen yang terpasang.
      return state.audio && state.audio.readyState >= 1 ? state : null;
    }, { timeoutMs: 210000, intervalMs: 3000 });

    if (!reporter.check('permintaan sintesis selesai (audio atau pesan error)',
      Boolean(selesai), selesai?.teksError)) {
      return;
    }

    // ---------- Mode tanpa kredensial: gagal dengan jelas, bukan hasil palsu ----------
    if (!providerSiap) {
      // Halaman sengaja mencatat detail kegagalan ke console untuk debugging,
      // sementara UI menampilkan pesan yang ramah ke user.
      session.allowConsoleErrors(/Speech generation failed/);

      reporter.check(
        'pesan error menyebut cara mengaktifkannya (bukan pesan generik)',
        /SOUND_PROVIDER=none|GEMINI_API_KEY/.test(selesai.teksError || ''),
        selesai.teksError
      );
      reporter.check('tidak ada bagian hasil yang menyesatkan', selesai.adaHasil === false);
      reporter.equal('kuota audio tidak terpakai saat gagal', angkaDari(selesai.kuota), kuotaAwal);

      const gagal = await api.get('/media/history?type=text-to-sound&limit=1');
      const record = gagal.body?.media?.[0];

      reporter.equal('permintaan yang gagal tercatat sebagai failed', record?.status, 'failed');

      if (record?.contentId) {
        const hapus = await api.del(`/media/${record.contentId}`);
        reporter.equal('record gagal dibersihkan lewat API', hapus.status, 200);
      }

      return;
    }

    // ---------- Mode provider siap: alur lengkap ----------
    reporter.check('audio termuat dan bisa diputar di browser', selesai.audio.readyState >= 1, JSON.stringify(selesai.audio));
    reporter.check(
      'metadata menyebut format dan provider',
      selesai.metadata.some((t) => /WAV|MP3/.test(t) && t.indexOf('via') !== -1),
      selesai.metadata.join(' ; ')
    );
    reporter.check(
      'riwayat menampilkan audio yang baru dibuat',
      Boolean(selesai.riwayatPertama && selesai.jumlahRiwayat >= 1),
      selesai.riwayatPertama
    );
    reporter.equal('kuota audio berkurang 1', angkaDari(selesai.kuota), kuotaAwal - 1);
    reporter.equal('tidak ada respons HTTP >= 400', session.httpErrors.length, 0);

    const daftar = await api.get('/media/history?type=text-to-sound&limit=1');
    const terbaru = daftar.body?.media?.[0];

    // Formatnya ikut provider yang melayani: Edge (tanpa kunci) menghasilkan
    // MP3, sedangkan Gemini hanya WAV. Yang penting formatnya salah satu yang
    // memang ditawarkan halaman ini.
    reporter.check(
      'riwayat server menyimpan format berkasnya',
      /^(wav|mp3)$/.test(String(terbaru?.metadata?.format || '')),
      terbaru?.metadata?.format
    );

    if (terbaru?.contentId) {
      const hapus = await api.del(`/media/${terbaru.contentId}`);
      reporter.equal('hasil uji dibersihkan lewat API', hapus.status, 200);
    }
  }
};
