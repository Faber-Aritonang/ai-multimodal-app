/**
 * Uji kunci Composio tanpa men-deploy apa pun.
 *
 * Pemakaian:
 *   node scripts/checkComposio.js          (dari folder backend)
 *   npm run check:composio
 *
 * Kenapa ada: kegagalan connector Google di aplikasi hanya muncul sebagai
 * `503` + pesan umum di browser, dan penyebabnya (kunci dicabut, izin kurang,
 * kredensial tidak sampai ke container) baru ketahuan setelah membuka log
 * Railway. Skrip ini menanyakan hal yang sama langsung ke Composio dari mesin
 * tempat kuncinya diisi, jadi jawabannya bisa dibaca sebelum deploy.
 *
 * Skrip TIDAK mencetak nilai kunci. Yang dicetak hanya panjangnya dan empat
 * karakter terakhirnya — itu cukup untuk memastikan kunci yang dipakai di sini
 * memang kunci yang sama dengan yang terpasang di server (Composio sendiri pun
 * meredaksi bagian tengah kunci di pesan galatnya).
 *
 * Kode keluar: 0 bila SEMUA pemeriksaan lolos, 1 bila ada yang gagal, supaya
 * bisa dipakai di skrip lain.
 */

require('dotenv').config();

const composio = require('../config/composio');

const kunci = String(process.env.COMPOSIO_API_KEY || '').trim();
const tampilkanKunci = () => (kunci ? `${kunci.slice(0, 3)}…${kunci.slice(-4)} (${kunci.length} karakter)` : '(kosong)');

/**
 * Jenis kunci, dibaca dari awalan. Composio punya lebih dari satu jenis kunci
 * yang semuanya disebut "API key" di dashboard, dan hanya satu yang diterima
 * REST API ini:
 *   ak_   project API key (mode PLATFORM)      -> dipakai backend ini
 *   ck_   consumer key (bagian "FOR YOU")      -> hanya untuk Composio Connect/MCP
 *   uak_  user API key                         -> header x-user-api-key
 */
const jenisKunci = () => {
  if (!kunci) return '(kosong)';
  if (kunci.startsWith('ak_')) return 'ak_ (project API key mode PLATFORM) — jenis yang benar';
  if (kunci.startsWith('ck_')) return 'ck_ (consumer key bagian "FOR YOU") — TIDAK diterima REST API ini';
  if (kunci.startsWith('uak_')) return 'uak_ (user API key) — TIDAK diterima sebagai x-api-key';
  return `${kunci.slice(0, 3)}… (awalan tidak dikenal) — kemungkinan nilai terpotong/salah salin`;
};

// Probe pertama read-only; tiga sisanya adalah probe IZIN untuk langkah yang
// persis dilakukan tombol Connect dan loop tool chat. Probe izin sengaja
// mengirim payload yang pasti ditolak validasi (id palsu, toolkit tak ada):
//   - izin kurang  -> 403 APIKey_InsufficientPermissions (dicek SEBELUM validasi)
//   - izin cukup   -> 400/404 dari validasi, dan tidak ada resource yang dibuat
// Jadi aman dijalankan berkali-kali tanpa efek samping.
const probe = [
  {
    label: 'GET /connected_accounts',
    run: () => composio.request('/connected_accounts?limit=1'),
    catatan: 'dipakai saat panel connector memuat status'
  },
  {
    label: 'GET /toolkits',
    run: () => composio.request('/toolkits?limit=1'),
    catatan: 'katalog toolkit; gagal di sini = kunci/API bermasalah'
  },
  {
    label: 'POST /toolkits/gmail/scopes/recommended',
    run: () => composio.request('/toolkits/gmail/scopes/recommended', {
      method: 'POST',
      body: {
        tools: composio.TOOLKIT_TOOLS.gmail,
        auth_scheme: 'OAUTH2',
        toolkit_version: 'latest'
      }
    }),
    catatan: 'langkah pertama tombol Connect'
  },
  {
    label: 'POST /auth_configs (probe izin write)',
    izinProbe: true,
    run: () => composio.request('/auth_configs', {
      method: 'POST',
      body: { toolkit: { slug: '__probe_tidak_ada__' }, auth_config: { type: 'use_composio_managed_auth' } }
    }),
    catatan: 'tombol Connect membuat auth config; butuh izin WRITE auth_configs'
  },
  {
    label: 'POST /connected_accounts/link (probe izin write)',
    izinProbe: true,
    run: () => composio.request('/connected_accounts/link', {
      method: 'POST',
      body: { auth_config_id: 'ac_probe_invalid', user_id: 'ai-multimodal:probe' }
    }),
    catatan: 'tombol Connect memulai OAuth; butuh izin WRITE connected_accounts'
  },
  {
    label: 'POST /tools/execute/... (probe izin execute)',
    izinProbe: true,
    run: () => composio.request('/tools/execute/GMAIL_FETCH_EMAILS', {
      method: 'POST',
      body: { connected_account_id: 'ca_probe_invalid', user_id: 'ai-multimodal:probe', version: 'latest', arguments: {} }
    }),
    catatan: 'chat mengeksekusi tool Gmail/Drive; butuh izin EXECUTE tools'
  }
];

// Khusus probe izin: 403 APIKey_InsufficientPermissions = izin kurang (gagal),
// sedangkan penolakan validasi lain (400/404/…) berarti izinnya CUKUP (lolos).
const izinCukup = (error) => {
  if (error.upstreamStatus === 403 && error.upstreamSlug === 'APIKey_InsufficientPermissions') return false;
  return Boolean(error.upstreamStatus) && error.upstreamStatus < 500;
};

const main = async () => {
  console.log(`API root     : ${composio.API_ROOT}`);
  console.log(`COMPOSIO_API_KEY: ${tampilkanKunci()}`);
  console.log(`jenis kunci  : ${jenisKunci()}`);
  console.log(`mode auth    : ${composio.usesCustomGoogleClient()
    ? 'custom — OAuth client Google sendiri (COMPOSIO_GOOGLE_CLIENT_ID terisi)'
    : 'managed — OAuth app Composio (bisa diblokir Google: "Aplikasi ini diblokir")'}`);
  console.log('');

  if (!kunci) {
    console.error('GAGAL: COMPOSIO_API_KEY belum diisi di backend/.env');
    console.error('Connector Google akan dijawab 503 "Composio is not configured on the server."');
    process.exit(1);
  }

  let gagal = 0;
  const kegagalanIzin = [];

  for (const { label, run, catatan, izinProbe } of probe) {
    try {
      await run();
      console.log(`OK    ${label}  (${catatan})`);
    } catch (error) {
      if (izinProbe && izinCukup(error)) {
        // Probe izin ditolak oleh validasi (bukan oleh pemeriksa izin): artinya
        // izinnya ada, dan payload probe memang sengaja tidak valid.
        console.log(`OK    ${label}  (${catatan})`);
        continue;
      }
      gagal += 1;
      if (error.upstreamSlug === 'APIKey_InsufficientPermissions') kegagalanIzin.push(label);
      const status = error.upstreamStatus ? `HTTP ${error.upstreamStatus}` : 'tanpa status';
      const slug = error.upstreamSlug ? ` ${error.upstreamSlug}` : '';
      console.error(`GAGAL ${label}  -> ${status}${slug}  (${catatan})`);
      if (error.upstreamMessage) console.error(`      pesan Composio: ${error.upstreamMessage}`);
      console.error(`      pesan ke user : ${error.message}`);
    }
  }

  console.log('');

  if (!gagal) {
    console.log('Kunci diterima Composio dan izinnya cukup untuk tombol Connect serta loop tool chat.');
    console.log('Kalau tombol Connect masih 503 di server, bandingkan kunci di server dengan yang diuji di sini.');
    return;
  }

  console.error(`${gagal} dari ${probe.length} pemeriksaan gagal.`);
  console.error('');

  // Bila SEMUA kegagalan murni soal izin (APIKey_InsufficientPermissions),
  // kuncinya sendiri benar — jangan arahkan ke penggantian kunci.
  if (kegagalanIzin.length === gagal) {
    console.error('Kuncinya BENAR, tetapi aksesnya read-only. Tombol Connect dan chat butuh izin');
    console.error('  WRITE/EXECUTE, dan tidak ada kode yang bisa menggantikan izin ini. Perbaikannya:');
    console.error('    1. dashboard.composio.dev (mode PLATFORM) -> Settings -> API Keys.');
    console.error('    2. Edit kunci yang dipakai (atau buat kunci baru) dan beri akses:');
    console.error('         auth_configs        : READ + WRITE');
    console.error('         connected_accounts  : READ + WRITE');
    console.error('         tools               : EXECUTE');
    console.error('    3. Simpan, isi COMPOSIO_API_KEY dengan kunci itu (bila kuncinya baru),');
    console.error('       lalu ulangi skrip ini.');
    console.error('  Kunci read-only hanya cukup untuk menampilkan status panel; setiap tombol');
    console.error('  Connect akan tetap 503 selama write-nya belum diberikan.');
    process.exitCode = 1;
    return;
  }

  // Petunjuk yang paling spesifik lebih dulu: awalan kunci jauh lebih
  // menentukan daripada status HTTP-nya, dan dua jenis kunci di bawah ini
  // sama-sama menghasilkan 401 yang terlihat identik.
  if (kunci.startsWith('ck_')) {
    console.error('Kunci yang dipasang berawalan `ck_` — itu CONSUMER KEY dari bagian');
    console.error('  "FOR YOU" (untuk Composio Connect / MCP), bukan project API key.');
    console.error('  REST API v3.1 selalu menolaknya, berapa kali pun dibuat ulang dari');
    console.error('  tempat yang sama. Perbaikannya:');
    console.error('    1. Buka dashboard.composio.dev dan alihkan product switcher (kiri');
    console.error('       atas) dari "FOR YOU" ke PLATFORM.');
    console.error('       Penanda: halaman kunci di FOR YOU bernama "Sessions & API Key".');
    console.error('       Kalau masih melihat halaman itu, masih di surface yang salah.');
    console.error('    2. Di PLATFORM: sidebar "API Keys" (atau Settings -> API Keys) ->');
    console.error('       Create API Key -> salin kuncinya. Bentuknya `ak_…`.');
    console.error('    3. Isi COMPOSIO_API_KEY dengan kunci `ak_…` itu, lalu ulangi skrip ini.');
  } else if (kunci.startsWith('uak_')) {
    console.error('Kunci yang dipasang adalah user API key (`uak_…`) dan dikirim sebagai');
    console.error('  x-api-key. Endpoint project tidak menerimanya — pakai project API key');
    console.error('  (`ak_…`) dari dashboard.composio.dev, mode PLATFORM.');
  } else if (kunci.startsWith('ak_')) {
    console.error('Kunci sudah berjenis benar (`ak_…`) tetapi Composio masih menolaknya.');
    console.error('  Cek apakah diketik/di-copy lengkap (panjang berubah-ubah, jadi jangan');
    console.error('  dipotong), apakah project-nya masih ada, dan apakah nilainya di');
    console.error('  backend/.env adalah yang sedang dipakai (bukan baris kedua).');
  } else {
    console.error('Awalan kunci tidak dikenal — kemungkinan nilainya terpotong atau bukan');
    console.error('  kunci Composio sama sekali.');
  }

  console.error('');
  if (kegagalanIzin.length) {
    console.error('Sebagian kegagalan di atas adalah APIKey_InsufficientPermissions: kunci perlu');
    console.error('  diberi izin WRITE auth_configs + connected_accounts dan EXECUTE tools di');
    console.error('  dashboard.composio.dev -> Settings -> API Keys.');
  }
  process.exitCode = 1;
};

main().catch((error) => {
  // Jaring pengaman: kegagalan tak terduga tidak boleh tampil sebagai stack
  // trace tanpa penjelasan.
  console.error('Pemeriksaan tidak bisa diselesaikan:', error.message);
  process.exitCode = 1;
});
