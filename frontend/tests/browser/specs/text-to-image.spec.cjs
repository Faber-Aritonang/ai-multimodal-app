/**
 * Spec: halaman /tools/text-to-image
 *
 * Menguji generate gambar sungguhan (provider gratis), lalu memastikan UI
 * jujur soal ukuran: provider sering mengembalikan resolusi berbeda dari yang
 * diminta, dan itu harus terlihat di hasil maupun di riwayat.
 */

const PROMPT = `wide panoramic mountain range at sunrise, automated browser test ${Date.now()}`;

const READ_STATE = `(() => {
  const nl = String.fromCharCode(10);
  const kuota = document.querySelector('[data-testid="image-quota"]');
  const hasil = document.querySelector('[data-testid="latest-result"]');
  const img = hasil ? hasil.querySelector('img') : null;
  const figs = Array.from(document.querySelectorAll('[data-testid="history-item"]'));
  const err = Array.from(document.querySelectorAll('.bg-red-50 p')).map((p) => p.innerText.trim())[0] || null;
  return {
    kuota: kuota ? kuota.innerText.trim() : null,
    adaBagianHasil: Boolean(hasil),
    hasilDimuat: img ? img.naturalWidth + 'x' + img.naturalHeight : null,
    hasilUrl: img ? img.getAttribute('src') : null,
    adaTombolUnduh: hasil ? Boolean(hasil.querySelector('a[download]')) : null,
    metadata: hasil
      ? Array.from(hasil.querySelectorAll('p'))
          .map((p) => p.innerText.trim())
          .filter((t) => t.indexOf('via') !== -1 || /[0-9]+x[0-9]+/.test(t))
      : [],
    jumlahRiwayat: figs.length,
    riwayatPertama: figs[0] ? figs[0].innerText.split(nl).join(' | ') : null,
    riwayatTermuat: figs.filter((f) => {
      const i = f.querySelector('img');
      return i && i.naturalWidth > 0;
    }).length,
    teksError: err
  };
})()`;

const angkaDari = (teks) => {
  const cocok = String(teks || '').match(/[0-9]+/);
  return cocok ? Number(cocok[0]) : null;
};

module.exports = {
  name: 'text-to-image',

  async run({ session, reporter, api, sleep, apiUrl }) {
    await session.open('/tools/text-to-image');

    const awal = await session.waitFor(async () => {
      const state = await session.evaluate(READ_STATE);
      return state.kuota ? state : null;
    }, { timeoutMs: 20000 });

    const kuotaAwal = awal ? angkaDari(awal.kuota) : null;
    reporter.check(
      'halaman menampilkan sisa kuota gambar',
      Number.isFinite(kuotaAwal) && kuotaAwal > 0,
      awal?.kuota
    );

    // Pilih Landscape lalu jeda: klik berurutan tanpa jeda membuat React belum
    // sempat re-render, sehingga permintaan memakai ukuran yang lama.
    await session.evaluate(`(() => {
      const tombol = Array.from(document.querySelectorAll('button')).find((b) => b.innerText.indexOf('Landscape') !== -1);
      if (tombol) tombol.click();
      return tombol ? 'landscape dipilih' : 'tombol landscape tidak ada';
    })()`);
    await sleep(1000);

    const ukuranAktif = await session.evaluate(`(() => {
      const tombol = Array.from(document.querySelectorAll('button')).find((b) => b.innerText.indexOf('Landscape') !== -1);
      return tombol ? tombol.className.indexOf('border-primary-500') !== -1 : null;
    })()`);
    reporter.equal('tombol ukuran Landscape terpilih', ukuranAktif, true);

    await session.evaluate(`(() => {
      const ta = document.querySelector('#prompt');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, ${JSON.stringify(PROMPT)});
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return 'prompt terisi';
    })()`);
    await sleep(500);
    await session.evaluate(`(() => {
      const tombol = Array.from(document.querySelectorAll('button')).find((b) => b.innerText.indexOf('Generate image') !== -1);
      tombol.click();
      return 'generate diklik';
    })()`);

    const hasil = await session.waitFor(async () => {
      const state = await session.evaluate(READ_STATE);
      if (state.teksError) return state;
      return state.hasilDimuat && state.hasilDimuat !== '0x0' ? state : null;
    }, { timeoutMs: 150000, intervalMs: 2500 });

    if (!reporter.check('gambar berhasil dibuat dan dimuat browser', Boolean(hasil && !hasil.teksError),
      hasil?.teksError || hasil?.hasilDimuat)) return;

    // URL-nya relatif ('/uploads/...') saat dev memakai proxy Vite, dan absolut
    // ke backend saat VITE_API_URL diisi (seperti di produksi). Keduanya benar.
    reporter.matches('hasil memakai URL media di /uploads/', hasil.hasilUrl, /^(https?:\/\/[^/]+)?\/uploads\//);
    reporter.check('tautan unduh tersedia', hasil.adaTombolUnduh === true);
    reporter.check(
      'metadata hasil menyebut resolusi asli + provider',
      hasil.metadata.some((t) => /[0-9]+x[0-9]+/.test(t) && t.indexOf('via') !== -1),
      hasil.metadata.join(' ; ')
    );

    const kuotaSesudah = angkaDari(hasil.kuota);
    reporter.equal('kuota gambar berkurang 1', kuotaSesudah, kuotaAwal - 1);

    // Item riwayat harus menampilkan resolusi + provider juga (bukan hanya hasil terbaru)
    reporter.check(
      'riwayat menampilkan resolusi + provider',
      Boolean(hasil.riwayatPertama && /[0-9]+x[0-9]+/.test(hasil.riwayatPertama) && hasil.riwayatPertama.indexOf('via') !== -1),
      hasil.riwayatPertama
    );
    reporter.check(
      'semua gambar riwayat termuat',
      hasil.riwayatTermuat === hasil.jumlahRiwayat,
      `${hasil.riwayatTermuat} dari ${hasil.jumlahRiwayat}`
    );

    // Bug produksi yang tidak akan terlihat dari assertion di atas: di produksi
    // halaman (domain Vercel) dan gambar (domain backend) berbeda origin, dan
    // helmet() menyetel Cross-Origin-Resource-Policy: same-origin sehingga
    // browser menolak gambarnya (ERR_BLOCKED_BY_RESPONSE.NotSameOrigin) — hasil
    // generate tampil rusak padahal berkasnya 200. Di lokal gambar dimuat lewat
    // proxy Vite (satu origin), jadi kondisi produksi harus dibuat eksplisit di
    // sini: muat URL backend secara absolut, seperti yang dilakukan produksi.
    if (apiUrl) {
      // Ambil path-nya dulu: kalau src sudah absolut (VITE_API_URL diisi), hanya
      // path yang diperlukan supaya URL backend-nya tetap terbentuk benar.
      const mediaPath = String(hasil.hasilUrl).replace(/^https?:\/\/[^/]+/, '');
      const lintasOrigin = await session.evaluate(`(async () => {
        const url = ${JSON.stringify(`${apiUrl}${mediaPath}`)};
        return await new Promise((resolve) => {
          const img = new Image();
          img.onload = () => resolve('dimuat ' + img.naturalWidth + 'x' + img.naturalHeight);
          img.onerror = () => resolve('DITOLAK');
          img.src = url;
          setTimeout(() => resolve('timeout'), 15000);
        });
      })()`);

      reporter.contains(
        'gambar bisa dimuat lintas origin (kondisi produksi)',
        lintasOrigin,
        'dimuat'
      );
    }

    // contentId terbaru dari API -> dipakai memastikan tombol hapus benar-benar
    // menghapus data (bukan hanya menyembunyikan kartu di UI).
    const sebelumHapus = await api.get('/media/history?type=text-to-image&limit=1');
    const contentIdTerbaru = sebelumHapus.body?.media?.[0]?.contentId || null;

    await session.evaluate(`(() => {
      // window.confirm memblokir headless Chrome, jadi jawab otomatis.
      window.confirm = () => true;
      const tombol = document.querySelector('[data-testid="history-item"] button[title="Delete"]');
      if (tombol) tombol.click();
      return 'hapus diklik';
    })()`);

    const sesudahHapus = await session.waitFor(async () => {
      const state = await session.evaluate(READ_STATE);
      return state.jumlahRiwayat < hasil.jumlahRiwayat ? state : null;
    }, { timeoutMs: 15000, intervalMs: 1000 });

    reporter.check('tombol hapus mengurangi riwayat', Boolean(sesudahHapus), sesudahHapus?.jumlahRiwayat);

    if (contentIdTerbaru) {
      const daftar = await api.get('/media/history?type=text-to-image&limit=12');
      const masihAda = (daftar.body?.media || []).some((item) => item.contentId === contentIdTerbaru);
      reporter.check('media benar-benar terhapus dari server', masihAda === false, contentIdTerbaru);
    }

    reporter.equal('tidak ada respons HTTP >= 400', session.httpErrors.length, 0);
  }
};
