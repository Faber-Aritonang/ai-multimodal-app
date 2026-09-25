/**
 * Spec: halaman /history
 *
 * Halaman ini adalah satu-satunya tempat user bisa mencari kembali hasil lama
 * dan menjalankannya lagi, jadi yang diuji adalah tiga hal yang paling mudah
 * rusak tanpa terlihat: jumlah hasil harus sama dengan yang dilaporkan API,
 * pencarian harus benar-benar menyaring (bukan hanya mengubah tampilan kolom),
 * dan tombol "Generate ulang" harus mengantar ke alat yang benar dengan prompt
 * yang sudah terisi.
 *
 * Data yang dipakai adalah riwayat akun dev apa adanya — spec ini TIDAK membuat
 * hasil baru (mahal dan memakai kuota), dan pemeriksaan yang butuh item hanya
 * dijalankan bila itemnya memang ada.
 */

// Isi <input>/<select> lewat native setter + event `input`/`change`, karena
// menulis el.value langsung tidak memicu onChange milik React.
const setFieldValue = (selector, value, prototypeName = 'HTMLInputElement', eventName = 'input') => `
(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return false;
  const setter = Object.getOwnPropertyDescriptor(window.${prototypeName}.prototype, 'value').set;
  setter.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event(${JSON.stringify(eventName)}, { bubbles: true }));
  return true;
})()`;

const READ_PAGE = `(() => {
  const teks = (testid) => {
    const el = document.querySelector('[data-testid="' + testid + '"]');
    return el ? el.innerText.trim() : null;
  };
  const items = Array.from(document.querySelectorAll('[data-testid="history-item"]'));
  return {
    path: location.pathname,
    total: teks('history-total'),
    jumlahItem: items.length,
    jenisItem: Array.from(new Set(items.map((el) => el.getAttribute('data-media-type')))),
    kosong: Boolean(document.querySelector('[data-testid="history-empty"]')),
    adaTombolBerikutnya: Boolean(document.querySelector('[data-testid="history-next"]'))
  };
})()`;

const jumlahDariTeks = (teks) => {
  const match = String(teks || '').match(/^([0-9]+)/);
  return match ? Number(match[1]) : null;
};

module.exports = {
  name: 'history',

  async run({ session, reporter, api }) {
    const halamanPertama = await api.get('/media/history?limit=12&page=1');
    const totalApi = halamanPertama.body?.total ?? 0;
    const itemPertama = halamanPertama.body?.media?.[0] || null;

    await session.open('/history');

    const awal = await session.waitFor(async () => {
      const state = await session.evaluate(READ_PAGE);
      return state.path === '/history' && state.total ? state : null;
    }, { timeoutMs: 15000 });

    reporter.equal('halaman riwayat terbuka', awal?.path, '/history');
    reporter.equal('jumlah hasil sama dengan API', jumlahDariTeks(awal?.total), totalApi);

    // ---------- Pencarian ----------
    const diisi = await session.evaluate(setFieldValue('#history-search', 'zzzz-tidak-mungkin-ada'));
    reporter.check('kolom pencarian bisa diisi', diisi, 'input #history-search tidak ditemukan');

    const kosong = await session.waitFor(async () => {
      const state = await session.evaluate(READ_PAGE);
      return state.kosong ? state : null;
    }, { timeoutMs: 15000, intervalMs: 700 });

    reporter.check('kata kunci tanpa hasil menampilkan keadaan kosong', Boolean(kosong));
    reporter.equal('tidak ada item yang ditampilkan', kosong?.jumlahItem, 0);
    reporter.equal('hitungan hasil ikut menjadi 0', jumlahDariTeks(kosong?.total), 0);

    // Dikosongkan lagi supaya filter berikutnya diuji pada daftar penuh.
    await session.evaluate(setFieldValue('#history-search', ''));
    await session.waitFor(async () => {
      const state = await session.evaluate(READ_PAGE);
      return jumlahDariTeks(state.total) === totalApi ? state : null;
    }, { timeoutMs: 15000, intervalMs: 700 });

    // ---------- Filter jenis ----------
    if (itemPertama) {
      const jenis = itemPertama.type;
      await session.evaluate(
        setFieldValue('#history-type', jenis, 'HTMLSelectElement', 'change')
      );

      const tersaring = await session.waitFor(async () => {
        const state = await session.evaluate(READ_PAGE);
        // Menunggu sampai daftarnya benar-benar berganti jenis (bukan sekadar
        // sudah dirender) supaya assertion tidak menilai render lama.
        return state.jenisItem.length === 1 && state.jenisItem[0] === jenis ? state : null;
      }, { timeoutMs: 15000, intervalMs: 700 });

      reporter.check(
        `filter jenis hanya menampilkan ${jenis}`,
        Boolean(tersaring),
        JSON.stringify(tersaring?.jenisItem)
      );

      // ---------- Generate ulang ----------
      const target = {
        'text-to-image': { path: '/tools/text-to-image', field: 'prompt' },
        'image-to-image': { path: '/tools/image-to-image', field: 'prompt' },
        'text-to-video': { path: '/tools/text-to-video', field: 'prompt' },
        'image-to-video': { path: '/tools/image-to-video', field: 'prompt' },
        'text-to-sound': { path: '/tools/text-to-sound', field: 'text' },
        'sound-to-text': { path: '/tools/sound-to-text', field: null }
      }[jenis];

      const diklik = await session.evaluate(`
        (() => {
          const tombol = document.querySelector('[data-testid="history-rerun"]');
          if (!tombol) return false;
          tombol.click();
          return true;
        })()
      `);

      reporter.check('tombol Generate ulang bisa ditekan', diklik, 'tidak ada tombol di daftar');

      const pindah = await session.waitFor(async () => {
        const state = await session.evaluate(`(() => ({ path: location.pathname }))()`);
        return state.path === target.path ? state : null;
      }, { timeoutMs: 15000, intervalMs: 500 });

      reporter.equal('Generate ulang membuka alat yang sesuai', pindah?.path, target.path);

      if (target.field) {
        const nilai = await session.evaluate(
          `(() => { const el = document.getElementById(${JSON.stringify(target.field)}); return el ? el.value : null; })()`
        );

        reporter.equal('prompt lama sudah terisi di alat tujuan', nilai, itemPertama.prompt);
      }
    } else {
      reporter.check('riwayat akun dev masih kosong — pemeriksaan item dilewati', true, null);
    }

    reporter.equal('tidak ada respons HTTP >= 400', session.httpErrors.length, 0);
  }
};
