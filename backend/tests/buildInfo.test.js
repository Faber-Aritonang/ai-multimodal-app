/**
 * Test: identitas build (config/buildInfo).
 *
 * Kolom `commit` di `/health` adalah pembanding langkah verifikasi deploy, jadi
 * dua hal yang dikunci di sini:
 *   1. nilainya BENAR (jalur mana pun yang dipakai produksi), dan
 *   2. nilainya AMAN saat penandanya rusak — berkas hilang, bukan JSON, atau
 *      isinya bukan SHA tidak boleh membuat `/health` melempar, karena kalau
 *      `/health` mati maka SELURUH verifikasi deploy mati, termasuk pemeriksaan
 *      penyimpanan yang jauh lebih penting.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { getBuildInfo } = require('../config/buildInfo');

const SHA = '56e1648641c4a7cd9a534f6339742021f319fc7c';
const SHA_META = 'a73d45fbddb0d8e033cb8c8057ff3617ccee1f99';

const dirSementara = fs.mkdtempSync(path.join(os.tmpdir(), 'build-info-'));
let berkas;

const tulisPenanda = (isi) => {
  berkas = path.join(dirSementara, `build-meta-${Date.now()}-${Math.random()}.json`);
  fs.writeFileSync(berkas, typeof isi === 'string' ? isi : JSON.stringify(isi));
  process.env.BUILD_META_PATH = berkas;
};

const tanpaPenanda = () => {
  berkas = path.join(dirSementara, 'tidak-ada.json');
  process.env.BUILD_META_PATH = berkas;
};

const envRender = process.env.RENDER_GIT_COMMIT;
const envRailway = process.env.RAILWAY_GIT_COMMIT_SHA;

afterEach(() => {
  if (berkas && fs.existsSync(berkas)) fs.rmSync(berkas, { force: true });
  if (envRender === undefined) delete process.env.RENDER_GIT_COMMIT;
  else process.env.RENDER_GIT_COMMIT = envRender;
  if (envRailway === undefined) delete process.env.RAILWAY_GIT_COMMIT_SHA;
  else process.env.RAILWAY_GIT_COMMIT_SHA = envRailway;
  delete process.env.BUILD_META_PATH;
});

afterAll(() => {
  fs.rmSync(dirSementara, { recursive: true, force: true });
});

describe('getBuildInfo', () => {
  test('tanpa sumber apa pun nilainya null, bukan error', () => {
    delete process.env.RENDER_GIT_COMMIT;
    delete process.env.RAILWAY_GIT_COMMIT_SHA;
    tanpaPenanda();

    expect(getBuildInfo()).toEqual({ commit: null, source: null });
  });

  test('RENDER_GIT_COMMIT dipakai lebih dulu karena Render mengisinya sendiri', () => {
    process.env.RENDER_GIT_COMMIT = SHA;
    // Sumber lain sengaja diisi nilai berbeda: kalau urutannya terbalik,
    // deployment yang sedang live akan dilaporkan memakai commit yang salah.
    process.env.RAILWAY_GIT_COMMIT_SHA = SHA_META;
    tulisPenanda({ commit: SHA_META });

    expect(getBuildInfo()).toEqual({ commit: SHA, source: 'render-git' });
  });

  test('RAILWAY_GIT_COMMIT_SHA masih dibaca untuk deployment lama', () => {
    delete process.env.RENDER_GIT_COMMIT;
    process.env.RAILWAY_GIT_COMMIT_SHA = SHA;
    tulisPenanda({ commit: SHA_META });

    expect(getBuildInfo()).toEqual({ commit: SHA, source: 'railway-git' });
  });

  test('penanda dari job CI dipakai saat platform tidak mengisinya', () => {
    delete process.env.RENDER_GIT_COMMIT;
    delete process.env.RAILWAY_GIT_COMMIT_SHA;
    tulisPenanda({ commit: SHA, builtAt: '2026-09-22T09:47:12Z' });

    expect(getBuildInfo()).toEqual({ commit: SHA, source: 'build-meta' });
  });

  test('SHA huruf besar dinormalkan, supaya pembandingannya tidak bergantung penulisan', () => {
    // Nilai dari dua sisi pembanding (platform dan GitHub) harus bisa
    // dibandingkan sebagai string biasa; SHA hanya case-insensitive secara kebetulan.
    delete process.env.RAILWAY_GIT_COMMIT_SHA;
    process.env.RENDER_GIT_COMMIT = SHA.toUpperCase();

    expect(getBuildInfo().commit).toBe(SHA);
  });

  test.each([
    ['berkas penanda tidak ada', undefined],
    ['berkas penanda bukan JSON', '{ ini bukan json'],
    ['isi penanda bukan SHA', JSON.stringify({ commit: 'not-a-commit-sha' })],
    ['SHA terlalu pendek untuk sebuah commit', JSON.stringify({ commit: 'abc12' })],
    ['penanda tanpa kolom commit', JSON.stringify({ builtAt: '2026-09-22T09:47:12Z' })]
  ])('%s -> commit null', (_nama, isi) => {
    delete process.env.RENDER_GIT_COMMIT;
    delete process.env.RAILWAY_GIT_COMMIT_SHA;
    if (isi === undefined) tanpaPenanda();
    else tulisPenanda(isi);

    expect(getBuildInfo()).toEqual({ commit: null, source: null });
  });

  test('nilai placeholder di env tidak dianggap commit', () => {
    // Sama seperti perlakuan pada kredensial: nilai contoh dari dokumentasi tidak
    // boleh lolos sebagai konfigurasi yang sah, karena di sini ia akan membuat
    // perbandingan commit selalu tidak cocok.
    delete process.env.RAILWAY_GIT_COMMIT_SHA;
    process.env.RENDER_GIT_COMMIT = 'commit-anda-di-sini';
    tulisPenanda({ commit: SHA });

    expect(getBuildInfo()).toEqual({ commit: SHA, source: 'build-meta' });
  });
});
