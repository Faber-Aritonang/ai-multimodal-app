# Kesehatan Dependency

Catatan keadaan dependency, apa yang menghalangi tiap kenaikan versi, dan apa yang
harus diverifikasi sebelum menaikkannya.

Bacaan terkait: [`env-produksi-railway.md`](./env-produksi-railway.md) (variabel
produksi), [`backup-restore.md`](./backup-restore.md) (titik pulih sebelum
perubahan besar).

---

## A. Cara memeriksa keadaan sekarang

```bash
cd backend  && npm outdated && npm audit
cd frontend && npm outdated && npm audit
```

`npm outdated` menunjukkan versi terpasang, versi tertinggi yang masih diizinkan
rentang `package.json` (`Wanted`), dan versi terbaru yang ada (`Latest`).
`npm audit` menunjukkan kerentanan yang diketahui beserta rantai dependensinya.

## B. Keadaan per 24 September 2026

### Backend — 10 kerentanan (1 critical, 5 high, 4 moderate)

Semuanya bermuara pada satu rantai: `firebase-admin@11` →
`@google-cloud/firestore` / `@google-cloud/storage` → `google-gax` →
`protobufjs` (critical) dan `@grpc/grpc-js` (high).

Yang membuat ini **tidak mendesak** (dan sekaligus tidak boleh diabaikan):

- aplikasi ini memakai `firebase-admin` **hanya untuk Auth** (`admin.credential.cert`
  + `verifyIdToken`); Firestore dan Storage Admin tidak pernah diinstansiasi, jadi
  kode dari paket itulah yang tidak pernah jalan;
- advisory `protobufjs` yang berstatus critical menyangkut pembuatan kode lewat
  CLI `pbjs`, bukan pemakaian runtime-nya.

Yang membuat ini **tetap harus diselesaikan**: satu-satunya cara paket itu berhenti
muncul di `npm audit` adalah dengan menaikkannya.

### Frontend — 14 kerentanan (2 high, 12 moderate)

| Paket | Tingkat | Muncul lewat |
|---|---|---|
| `undici` | high | `firebase` → `@firebase/auth`, `@firebase/functions`, dst. (satu salinan 6.19.7 yang di-dedup) |
| `vite` (+ `esbuild`) | high / moderate | build tool |
| `react-router`, `react-router-dom` | moderate | router aplikasi |
| `firebase`, `@firebase/*` (auth, firestore, functions, storage + versi `-compat`) | moderate | SDK Firebase |

## C. Urutan pengerjaan yang disarankan

Aturannya satu: **satu paket per perubahan**. Kenaikan major yang digabung membuat
penyebab kegagalan tidak bisa dipisahkan — dan seluruh strategi pemulihan di repo
ini (backup + verifikasi deploy + `requestId` di log) menjadi jauh lebih sulit
dipakai kalau yang berubah sekaligus banyak.

### 1. `react-router-dom` 6 → 7 (frontend)

- Menutup: 2 moderate.
- Syarat versi: `node >= 20` (CI sudah Node 20), `react >= 18` (sekarang 18.3).
- Kenapa ini lebih dulu: ia tidak menyentuh build tool, dan area yang perlu
  diperiksa terbatas pada routing.
- Yang harus diverifikasi: `ProtectedRoute` / `GuestRoute` benar-benar mengalihkan
  (`/dashboard`, `/admin`, `/pending-approval`, `/login`), tautan langsung ke rute
  bersarang tetap dilayani, dan `/share/:token` tetap publik.
- Verifikasi otomatis: `npm run lint`, `npm run build`, lalu `npm run test:browser`
  (manual).

### 2. `vite` 4 → 8 (+ `@vitejs/plugin-react` 4 → 6) (frontend)

- Menutup: 1 high (`vite`) + moderate (`esbuild`).
- Syarat versi: `vite@8` = `^20.19.0 || >=22.12.0`; `@vitejs/plugin-react@6` sama.
  Node 20 milik CI memenuhi asalkan runner-nya ≥ 20.19.
- Kenapa terpisah dari router: ini menyentuh cara build, dan kalau digabung, build
  yang gagal tidak bisa dipastikan penyebabnya router atau bundler.
- Yang harus diverifikasi: `vite.config.js` masih sah, proxy dev (`/uploads`,
  `/api`) masih bekerja, `vercel.json` (rewrites SPA) masih cocok, ukuran bundel
  tidak melonjak, dan `VITE_API_URL` masih terbaca saat build.

### 3. `firebase` 10 → 12 (frontend)

- Menutup: 9 moderate (paket `firebase` + 8 `@firebase/*`), dan — karena `undici` masuk lewat rantai `@firebase/auth` — sekaligus kandidat penutup kerentanan **high** `undici`.
- Kenapa setelah yang lain: SDK auth menyentuh alur login, dan itu bagian yang
  paling sulit diuji otomatis (butuh popup Google sungguhan).
- Yang harus diverifikasi: login Google, sesi bertahan setelah refresh, logout
  benar-benar memutus sesi, dan `getIdToken()` masih dipakai `config/api.js`.

### 4. Node 22 di CI + `engines`, lalu `firebase-admin` 11 → 14 (backend)

- Menutup: 1 critical + 5 high sekaligus.
- Syarat versi: **`firebase-admin@14` mensyaratkan `node >= 22`** — jadi ini bukan
  sekadar kenaikan paket.
- Urutannya (jangan dibalik):
  1. `node-version: '22'` di job `quality` (`.github/workflows/deploy.yml`) dan
     pastikan job `quality` hijau;
  2. tambahkan `"engines": { "node": ">=22" }` di `backend/package.json` supaya
     versi Node di Railway tidak lagi implisit — lalu **periksa satu deploy**
     (Railway membaca `engines` lewat Nixpacks, dan itu satu-satunya bagian di
     sini yang tidak bisa diuji dari lokal);
  3. baru naikkan `firebase-admin`;
  4. uji **login Google secara manual** (Firebase Auth tidak terjangkau unit test,
     dan `verifyIdToken` adalah satu-satunya bagian yang dipakai aplikasi).
- Titik pulih: buat backup dulu (`npm run backup:db`) — lihat
  [`backup-restore.md`](./backup-restore.md).

### 5. Major lain di backend (hanya bila ada alasan)

`express` 4 → 5, `mongoose` 8 → 9, `openai` 4 → 7, `helmet` 7 → 8,
`express-rate-limit` 7 → 8, `dotenv` 16 → 18, `bcryptjs` 2 → 3. Semuanya major,
dan **tidak satu pun menutup kerentanan yang diketahui sekarang** — jadi tidak ada
alasan mengerjakannya bersamaan dengan poin di atas. Kerjakan hanya kalau ada
kebutuhan nyata (fitur, perbaikan bug, atau dukungan Node baru), satu per satu.

Catatan khusus `express` 5: itu perubahan perilaku (penanganan galat asinkron,
`req.query` yang read-only, penghapusan beberapa API lama). Middleware di repo ini
sudah memakai pola yang kompatibel, tetapi rute dan penangan galat tetap perlu
diperiksa ulang — termasuk `middleware/errorHandler.js` yang bergantung pada
`res.headersSent` dan normalisasi `err.status`.

## D. Kenapa `npm audit fix --force` tidak dipakai

Perintah itu memasang versi di luar rentang `package.json` **tanpa** memisahkan
perubahan besar, jadi satu perintah bisa mengubah bundler, router, dan SDK
sekaligus. Yang terjadi kemudian khas: aplikasi gagal di tempat yang tidak ada
hubungannya dengan kerentanan yang sedang ditutup, dan tidak ada cara memisahkan
penyebabnya. Perintah yang aman untuk dijalankan adalah `npm audit fix` biasa
(hanya menaikkan di dalam rentang semver) — dan itu pun tetap harus diikuti test.

## E. Kerentanan yang "tidak terjangkau"

Kalau sebuah advisory hanya berlaku pada kode yang tidak pernah dijalankan
aplikasi ini (seperti Firestore/Storage Admin di atas), itu **bukan** alasan untuk
mengabaikannya — tetapi juga bukan alasan untuk terburu-buru. Cara menuliskannya:
sebutkan jalur paketnya, siapa yang memakainya (`Auth` saja), dan apa pemicu yang
membuatnya menjadi mendesak (mis. mulai memakai Firestore). Itulah bentuk yang
dipakai di `README.md` bagian *Phase 4* supaya keputusannya bisa ditinjau ulang
tanpa menelusuri riwayat percakapan.
