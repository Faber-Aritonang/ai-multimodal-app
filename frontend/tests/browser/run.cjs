#!/usr/bin/env node
/**
 * Runner uji browser.
 *
 *   npm run test:browser
 *
 * Prasyarat (keduanya harus sudah jalan):
 *   - backend  : http://localhost:4000  (dengan dev-login aktif, NODE_ENV != production)
 *   - frontend : http://localhost:5173  (vite dev server)
 *
 * Konfigurasi lewat env (semua opsional):
 *   TEST_BASE_URL      default http://localhost:5173
 *   TEST_API_URL       default http://localhost:4000
 *   TEST_MEMBER_EMAIL  default dev.member@example.com
 *   CHROME_BIN         path binary Chrome bila tidak terdeteksi otomatis
 *
 * Catatan: spec memakai akun dev member dan akan memakai 1 kuota chat
 * (chat.spec), 1 kuota gambar (text-to-image.spec), dan 1 kuota video/audio
 * (text-to-sound.spec & sound-to-text.spec) — dua yang terakhir hanya bila
 * kredensial providernya sudah diisi (dan sound-to-text bisa berakhir sebagai
 * kegagalan yang jelas untuk audio sintetis, tanpa memakai kuota). Semuanya
 * menghapus kembali data yang dibuatnya lewat API, tapi kuota tidak bisa
 * dikembalikan dari sini — jalankan saat kuota dev tersedia. Satu pengecualian:
 * history.spec hanya MEMBACA riwayat yang sudah ada, jadi ia tidak memakai kuota
 * dan tidak membuat data baru.
 *
 * share-link.spec juga tidak memakai kuota: ia memakai satu hasil selesai yang
 * sudah ada di riwayat, membuat tautan baca-saja untuknya, membukanya tanpa
 * login, lalu mencabutnya lagi. Kalau item itu ternyata SUDAH dibagikan sebelum
 * spec berjalan (mis. sisa sesi sebelumnya), pencabutannya dilewati — jangan
 * matikan tautan yang mungkin sudah disebar hanya untuk menyelesaikan test.
 *
 * PENGECUALIAN PENTING — video:
 * text-to-video.spec & image-to-video.spec TIDAK menghasilkan video sungguhan
 * secara default. Provider video satu-satunya (NaraRouter) berbayar per pekerjaan
 * dan satu video memakan 1-5 menit, jadi menjalankannya di setiap run berarti
 * membelanjakan saldo dan menunggu lama tanpa alasan. Keduanya tetap menguji
 * tentang opsi/validasi/pesan kegagalan; alur generate lengkapnya hanya jalan bila
 * diminta eksplisit:
 *
 *   TEST_VIDEO_GENERATE=1 npm run test:browser
 *
 * Kuota yang terpakai saat itu: 1 kuota video per spec video.
 */

const { launchSession, Reporter, findChrome, sleep } = require('./lib/harness.cjs');

const BASE_URL = (process.env.TEST_BASE_URL || 'http://localhost:5173').replace(/\/+$/, '');
const API_URL = (process.env.TEST_API_URL || 'http://localhost:4000').replace(/\/+$/, '');
const MEMBER_EMAIL = process.env.TEST_MEMBER_EMAIL || 'dev.member@example.com';

const ALL_SPECS = [
  require('./specs/chat.spec.cjs'),
  require('./specs/text-to-image.spec.cjs'),
  require('./specs/image-to-image.spec.cjs'),
  require('./specs/text-to-video.spec.cjs'),
  require('./specs/image-to-video.spec.cjs'),
  require('./specs/text-to-sound.spec.cjs'),
  require('./specs/sound-to-text.spec.cjs'),
  require('./specs/dashboard-profile.spec.cjs'),
  require('./specs/history.spec.cjs'),
  require('./specs/share-link.spec.cjs'),
  require('./specs/pending-approval.spec.cjs'),
  require('./specs/admin-logout.spec.cjs')
];

// Filter opsional untuk saat mengembangkan satu spec saja, mis.:
//   TEST_SPECS=pending-approval npm run test:browser
const SPEC_FILTER = (process.env.TEST_SPECS || '')
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean);

const SPECS = SPEC_FILTER.length
  ? ALL_SPECS.filter((spec) => SPEC_FILTER.includes(spec.name))
  : ALL_SPECS;

const createApi = (token) => {
  const request = async (pathname, { method = 'GET', body, authenticated = true } = {}) => {
    const headers = { 'Content-Type': 'application/json' };
    if (authenticated && token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(`${API_URL}/api/v1${pathname}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });

    const text = await response.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }

    return { status: response.status, ok: response.ok, body: parsed };
  };

  return {
    request,
    get: (pathname) => request(pathname),
    post: (pathname, body) => request(pathname, { method: 'POST', body }),
    del: (pathname) => request(pathname, { method: 'DELETE' }),
    publicPost: (pathname, body) => request(pathname, { method: 'POST', body, authenticated: false })
  };
};

const preflight = async () => {
  const problems = [];

  try {
    const response = await fetch(BASE_URL, { method: 'GET' });
    if (response.status >= 500) problems.push(`frontend ${BASE_URL} merespons ${response.status}`);
  } catch (error) {
    problems.push(`frontend ${BASE_URL} tidak bisa dihubungi (${error.message})`);
  }

  let health = null;
  try {
    const response = await fetch(`${API_URL}/health`);
    health = await response.json();
  } catch (error) {
    problems.push(`backend ${API_URL} tidak bisa dihubungi (${error.message})`);
  }

  if (problems.length) {
    console.error('Prasyarat belum terpenuhi:');
    problems.forEach((problem) => console.error(`  - ${problem}`));
    console.error('\nJalankan dulu: backend (npm start) dan frontend (npm run dev).');
    process.exit(2);
  }

  let auth = null;
  try {
    const response = await fetch(`${API_URL}/api/v1/auth/dev-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: MEMBER_EMAIL, name: 'Dev Member', role: 'member' })
    });
    auth = await response.json();

    if (!response.ok || !auth?.token) {
      throw new Error(auth?.message || `HTTP ${response.status}`);
    }
  } catch (error) {
    console.error(`Dev-login gagal untuk ${MEMBER_EMAIL}: ${error.message}`);
    console.error('Uji browser butuh dev-login (backend di luar production dengan JWT_SECRET terisi).');
    process.exit(2);
  }

  return { health, auth };
};

const main = async () => {
  const chromePath = findChrome();
  if (!chromePath) {
    console.error('Chrome/Chromium tidak ditemukan. Set CHROME_BIN lalu ulangi.');
    process.exit(2);
  }

  const { health, auth } = await preflight();
  const api = createApi(auth.token);

  console.log(`Chrome  : ${chromePath}`);
  console.log(`Frontend: ${BASE_URL}`);
  console.log(
    `Backend : ${API_URL} (db: ${health?.database}, chat: ${health?.services?.chatProvider}, image: ${health?.services?.imageProvider})`
  );
  console.log(`Akun    : ${MEMBER_EMAIL}\n`);

  const results = [];

  for (const spec of SPECS) {
    const reporter = new Reporter(spec.name);
    let session = null;

    try {
      session = await launchSession({ baseUrl: BASE_URL, profileName: spec.name });
      await session.setAuth({ token: auth.token, user: auth.user });
      // `health` ikut dikirim supaya spec bisa menyesuaikan diri dengan
      // konfigurasi provider yang sebenarnya (mis. kredensial belum diisi).
      // `apiUrl` dipakai spec untuk memuat media secara absolut — di produksi
      // halaman dan gambarnya berbeda origin, dan itu justru kondisi yang harus
      // diuji (lihat text-to-image.spec.cjs).
      await spec.run({ session, reporter, api, baseUrl: BASE_URL, sleep, health, apiUrl: API_URL });
    } catch (error) {
      reporter.check('spec selesai tanpa error tak terduga', false, error.message);
    } finally {
      if (session) await session.close();
    }

    const unexpected = session ? session.unexpectedConsoleErrors : [];
    reporter.check('tidak ada error console di browser', session ? unexpected.length === 0 : false,
      unexpected.length ? unexpected.join(' | ') : null);
    reporter.check('tidak ada request yang gagal di level jaringan',
      session ? session.networkFailures.length === 0 : false,
      session && session.networkFailures.length ? session.networkFailures.join(' | ') : null);

    console.log(reporter.print());
    console.log('');
    results.push({ name: spec.name, reporter });
  }

  const failed = results.filter((item) => item.reporter.failedChecks.length > 0);
  const totalChecks = results.reduce((sum, item) => sum + item.reporter.checks.length, 0);

  if (failed.length) {
    console.log(`HASIL: ${failed.length} spec gagal dari ${results.length} spec.`);
    failed.forEach((item) => {
      item.reporter.failedChecks.forEach((check) => console.log(`  - [${item.name}] ${check.label}`));
    });
    process.exit(1);
  }

  console.log(`HASIL: ${results.length} spec lulus, ${totalChecks} assertion.`);
  process.exit(0);
};

main().catch((error) => {
  console.error('Runner gagal:', error);
  process.exit(1);
});
