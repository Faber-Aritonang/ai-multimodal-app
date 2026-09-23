/**
 * Spec: halaman /tools/sound-to-text
 *
 * Audio uji dibuat di halaman (WAV 1 detik, tanpa berkas fixture di repo) dan
 * dimasukkan lewat event drop, supaya jalur unggah yang dipakai user ikut teruji.
 *
 * Yang diperiksa bukan hanya "ada elemen <audio>", tetapi juga bahwa berkasnya
 * benar-benar bisa diputar (metadata terbaca), lalu seluruh alurnya: audio
 * dikirim, transkrip muncul di panel DAN di riwayat, kuota berkurang satu, dan
 * data ujinya dibersihkan lagi lewat API.
 *
 * Satu hal yang tidak bisa dipastikan spec ini: apakah provider benar-benar
 * menghasilkan teks. Audio sintetis (nada murni) memang bukan ucapan, jadi
 * provider yang sehat pun boleh menjawab "tidak ada teks" — dan itu diterima di
 * sini sebagai kegagalan yang jelas, bukan sebagai hasil palsu. Kedua ujungnya
 * diuji: transkrip yang benar-benar muncul, atau pesan error yang bisa
 * ditindaklanjuti — yang tidak boleh adalah menggantung tanpa keduanya.
 */

const READ_STATE = `(() => {
  const nl = String.fromCharCode(10);
  const kuota = document.querySelector('[data-testid="transcript-quota"]');
  const preview = document.querySelector('[data-testid="input-preview"]');
  const hasil = document.querySelector('[data-testid="latest-result"]');
  const keluaran = document.querySelector('[data-testid="transcript-output"]');
  const items = Array.from(document.querySelectorAll('[data-testid="history-item"]'));
  // Kotak error ditandai data-testid, bukan kelas warna (lihat catatan yang sama
  // di spec text-to-image).
  const err = Array.from(document.querySelectorAll('[data-testid="error-message"] p')).map((p) => p.innerText.trim())[0] || null;
  return {
    kuota: kuota ? kuota.innerText.trim() : null,
    adaPreview: Boolean(preview),
    tombolNonaktif: (() => {
      const b = document.querySelector('[data-testid="generate-button"]');
      return b ? b.disabled : null;
    })(),
    jumlahBahasa: (() => {
      const s = document.querySelector('[data-testid="language-select"]');
      return s ? s.options.length : 0;
    })(),
    bahasaTerpilih: (() => {
      const s = document.querySelector('[data-testid="language-select"]');
      return s ? s.value : null;
    })(),
    adaHasil: Boolean(hasil),
    transkrip: keluaran ? keluaran.innerText.trim() : null,
    metadata: hasil
      ? Array.from(hasil.querySelectorAll('p'))
          .map((p) => p.innerText.trim())
          .filter((t) => t.indexOf('via') !== -1 || /WAV|MP3|OGG|WEBM|M4A|FLAC/.test(t))
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
  name: 'sound-to-text',

  async run({ session, reporter, api, health }) {
    // Backend sendiri yang memutuskan apakah fitur ini bisa dijalankan (ada
    // kredensial provider transkripsi atau belum). Berbeda dari text-to-sound,
    // di sini nilai false itu normal: tidak ada provider transkripsi yang bisa
    // dipakai tanpa kunci sama sekali.
    const providerSiap = health?.services?.speechToTextReady === true;

    // Halaman mencatat detail kegagalan ke console untuk debugging; UI-nya
    // menampilkan pesan yang ramah. Tanpa izin ini, console.error itu dihitung
    // sebagai temuan walau perilakunya memang diharapkan.
    session.allowConsoleErrors(/Transcription failed/);

    await session.open('/tools/sound-to-text');

    const awal = await session.waitFor(async () => {
      const state = await session.evaluate(READ_STATE);
      return state.kuota ? state : null;
    }, { timeoutMs: 20000 });

    const kuotaAwal = awal ? angkaDari(awal.kuota) : null;
    reporter.check('halaman menampilkan sisa kuota audio', Number.isFinite(kuotaAwal), awal?.kuota);
    reporter.equal('tombol transkripsi nonaktif sebelum ada audio', awal?.tombolNonaktif, true);
    // Pilihan bahasa datang dari backend (GET /media/transcribe-options).
    reporter.check('daftar bahasa terisi', (awal?.jumlahBahasa || 0) >= 2, `terpilih: ${awal?.bahasaTerpilih}`);

    // 1. Buat WAV 1 detik di halaman lalu masukkan lewat event drop.
    const dropped = await session.evaluate(`(() => {
      const sampleRate = 8000;
      const samples = sampleRate;
      const buffer = new ArrayBuffer(44 + samples * 2);
      const view = new DataView(buffer);
      const tulis = (offset, teks) => {
        for (let i = 0; i < teks.length; i += 1) view.setUint8(offset + i, teks.charCodeAt(i));
      };

      tulis(0, 'RIFF');
      view.setUint32(4, 36 + samples * 2, true);
      tulis(8, 'WAVE');
      tulis(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      tulis(36, 'data');
      view.setUint32(40, samples * 2, true);

      for (let i = 0; i < samples; i += 1) {
        const nilai = Math.sin(2 * Math.PI * 440 * i / sampleRate);
        view.setInt16(44 + i * 2, Math.round(nilai * 0x7fff), true);
      }

      const file = new File([buffer], 'browser-test.wav', { type: 'audio/wav' });
      const dt = new DataTransfer();
      dt.items.add(file);

      const zone = document.querySelector('[data-testid="drop-zone"]');
      zone.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));

      return { ukuran: file.size };
    })()`);

    reporter.check('audio uji berhasil dibuat di browser', dropped?.ukuran > 0, JSON.stringify(dropped));

    const setelahDrop = await session.waitFor(async () => {
      const state = await session.evaluate(READ_STATE);
      return state.adaPreview ? state : null;
    }, { timeoutMs: 15000, intervalMs: 700 });

    if (!reporter.check('pemutar audio tampil setelah drop', Boolean(setelahDrop), setelahDrop?.teksError)) {
      return;
    }

    const tombolNonaktif = await session.evaluate(
      `(() => document.querySelector('[data-testid="generate-button"]').disabled)()`
    );
    reporter.equal('tombol transkripsi aktif setelah audio siap', tombolNonaktif, false);

    // 2. Transkripsi
    await session.evaluate(`(() => {
      document.querySelector('[data-testid="generate-button"]').click();
      return 'transkripsi diklik';
    })()`);

    // Penanda selesainya BUKAN sekadar "ada <audio> di halaman": panel hasil
    // ikut terisi otomatis dari riwayat, jadi audio milik hasil sebelumnya pun
    // memenuhi syarat itu. Yang dipakai: transkrip benar-benar muncul, atau
    // kotak error tampil.
    const selesai = await session.waitFor(async () => {
      const state = await session.evaluate(READ_STATE);
      if (state.teksError) return state;
      return state.transkrip ? state : null;
    }, { timeoutMs: 210000, intervalMs: 3000 });

    if (!reporter.check('permintaan transkripsi selesai (transkrip atau pesan error)',
      Boolean(selesai), selesai?.teksError)) {
      return;
    }

    const adaTranskrip = Boolean(selesai.transkrip);

    // ---------- Jalur kegagalan: harus jelas dan tidak memakai kuota ----------
    if (!adaTranskrip) {
      reporter.check(
        'pesan error bisa ditindaklanjuti (bukan pesan teknis mentah)',
        /GROQ_API_KEY|GEMINI_API_KEY|tidak mengembalikan teks/.test(selesai.teksError || ''),
        selesai.teksError
      );
      reporter.check('tidak ada bagian hasil yang menyesatkan', selesai.adaHasil === false);
      reporter.equal('kuota audio tidak terpakai saat gagal', angkaDari(selesai.kuota), kuotaAwal);

      if (!providerSiap) {
        reporter.check(
          'kegagalan tanpa kredensial memang diharapkan',
          /GROQ_API_KEY|GEMINI_API_KEY/.test(selesai.teksError || ''),
          selesai.teksError
        );
      }
    } else {
      // ---------- Jalur sukses: transkrip benar-benar sampai ----------
      reporter.check('transkrip berisi teks', selesai.transkrip.length > 0, selesai.transkrip);
      reporter.check(
        'metadata menyebut format dan provider',
        selesai.metadata.some((t) => /WAV|MP3|OGG|WEBM|M4A|FLAC/.test(t) && t.indexOf('via') !== -1),
        selesai.metadata.join(' ; ')
      );
      reporter.check(
        'riwayat menampilkan transkripsi yang baru dibuat',
        Boolean(selesai.riwayatPertama && selesai.jumlahRiwayat >= 1),
        selesai.riwayatPertama
      );
      reporter.equal('kuota audio berkurang 1', angkaDari(selesai.kuota), kuotaAwal - 1);
      reporter.equal('tidak ada respons HTTP >= 400', session.httpErrors.length, 0);
    }

    // ---------- Riwayat server & bersih-bersih (kedua jalur) ----------
    const daftar = await api.get('/media/history?type=sound-to-text&limit=1');
    const terbaru = daftar.body?.media?.[0];

    reporter.equal('permintaan tercatat dengan tipe sound-to-text', terbaru?.type, 'sound-to-text');

    if (adaTranskrip) {
      reporter.equal('transkrip tersimpan di record server', terbaru?.metadata?.transcript, selesai.transkrip);
    } else {
      reporter.equal('permintaan yang gagal tercatat sebagai failed', terbaru?.status, 'failed');
    }

    if (terbaru?.contentId) {
      const hapus = await api.del(`/media/${terbaru.contentId}`);
      reporter.equal('data uji dibersihkan lewat API', hapus.status, 200);
    }
  }
};
