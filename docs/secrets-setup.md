# GitHub Actions Secrets Setup

Berkas ini melengkapi [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml),
yang merupakan sumber kebenaran untuk daftar secret-nya. Kalau keduanya berbeda,
workflow yang benar.

## Required Secrets

Set di GitHub Repository → Settings → Secrets and variables → Actions:

| Secret | Wajib | Dipakai job | Dari mana |
|---|---|---|---|
| `RENDER_DEPLOY_HOOK_URL` | tidak | `deploy-backend` | Render → service `ai-multimodal-backend` → Settings → **Deploy Hook** → Create Deploy Hook |
| `VERCEL_TOKEN` | ya | `deploy-frontend` | Vercel → Settings → Tokens → Create Token |
| `VERCEL_PROJECT_ID` | ya | `deploy-frontend` | Vercel → Project Settings → General → Project ID |

Catatan nama yang mudah salah:

- Secretnya bernama **`VERCEL_PROJECT_ID`**. Versi lama dokumen ini menulis
  `VERCEL_PROJECT_ID_FRONTEND`; nama itu membuat `project-id` terkirim **kosong**
  dan job verifikasi gagal seolah-olah tokennya yang salah. `VERCEL_ORG_ID`
  tidak dipakai workflow ini, jadi tidak perlu diisi.
- `RENDER_DEPLOY_HOOK_URL` berisi **URL rahasia** dari halaman Deploy Hook, bukan
  API key. Siapa pun yang memegang URL itu bisa memicu deploy service tersebut.
  Jangan tempel ke chat/issue; kalau bocor, hapus hook-nya di Render dan buat
  yang baru (URL lama langsung mati).

## Satu pemicu deploy, bukan dua

Render bisa men-deploy sendiri setiap ada push ke `main` (*Auto-Deploy*), dan
workflow ini juga bisa memicu deploy lewat deploy hook. **Pilih salah satu:**

| Keadaan | Yang terjadi |
|---|---|
| `RENDER_DEPLOY_HOOK_URL` **diisi**, Auto-Deploy **dimatikan** | setiap push memicu satu deploy; CI yang memulainya, jadi deploy pasti berjalan untuk commit itu |
| `RENDER_DEPLOY_HOOK_URL` **kosong**, Auto-Deploy **aktif** | setiap push memicu satu deploy dari Render sendiri; CI hanya memverifikasi hasilnya |
| keduanya aktif | dua deployment untuk commit yang sama — job tetap hijau, tetapi build gratisnya terbuang |
| keduanya mati | deploy tidak pernah berjalan; job `deploy-backend` gagal setelah 15 menit menunggu commit baru muncul di `/health` |

Job `deploy-backend` mencetak `::notice::` saat hook kosong, supaya keadaan
"mengandalkan Auto-Deploy" terlihat di log alih-alih jadi tebakan.

## Verifikasi deploy: kode yang live harus commit yang di-push

Job `deploy-backend` dulu hanya tahu "perintah deploy-nya selesai", dan itu tidak
membedakan "kode baru sudah live" dari "deploy gagal sementara kode lama masih
melayani user" — yang kedua tetap terlihat hijau. Pemeriksaan `/health` yang lain
(database, penyimpanan, kredensialnya) membaca kolom yang sama benarnya di kode
lama maupun baru, jadi tak satu pun menangkapnya. Karena itu `/health`
melaporkan commit yang berjalan, dan step `Verifikasi produksi` menuntut nilainya
sama dengan `GITHUB_SHA`:

| Keadaan di `/health` | Perilaku job |
|---|---|
| `commit` sama dengan commit yang di-push | `::notice::` — deploy terbukti |
| `commit` berbeda | `::error::` dan job **gagal** (setelah menunggu sampai 15 menit, karena deployment barunya bisa jadi masih berjalan) |
| `commit` tidak dilaporkan sama sekali | `::error::` dan job **gagal** — tidak ada bukti bahwa kode baru live. Biasanya berarti deploy Render tidak pernah dipicu (Auto-Deploy mati dan hook kosong), build-nya gagal, atau kode yang live masih versi lama yang belum mengirim kolom `commit` |

Kolom `commitSource` menyebut jalur penandanya. Produksi sekarang di Render, yang
mengisi `RENDER_GIT_COMMIT` sendiri (`commitSource: "render-git"`). Nilai
`railway-git` masih mungkin muncul pada deployment lama yang belum diganti, dan
`build-meta` adalah jalur cadangan untuk platform yang mengunggah direktori lokal
tanpa metadata git.

Batas tunggunya 15 menit — bukan 5 — karena instance Render free tidur saat tidak
ada trafik (±30-60 detik untuk bangun) dan build-nya sendiri makan beberapa
menit. Selama batas itu job **terus menunggu** meski `/health` belum melaporkan
commit, lalu gagal kalau nilainya tidak pernah muncul — jadi deployment pertama
yang masih memakai kode lama (belum mengirim kolom `commit`) memang merah sampai
satu kali di-deploy manual. Job-nya juga gagal (bukan hijau) kalau `storageMode` bernilai `local` atau
`storageCheck` bernilai `failed`, jadi kredensial Cloudinary yang salah tidak
bisa lolos hanya karena build-nya sukses.

## Catatan untuk job `quality` di CI

Job **quality** (unit test backend + lint + build frontend) berjalan sebelum
deploy dan **tidak membutuhkan secret apa pun**: test backend memakai mock tanpa
MongoDB/Firebase. Build di job ini juga tidak butuh `VITE_*`, karena bundle
produksi dibangun ulang di sisi Vercel memakai environment variables di
dashboard Vercel.

---

## Setup Instructions

### 1. Backend (Render)

Service **`ai-multimodal-backend`** sudah terhubung ke repo GitHub ini dengan
**Root Directory = `backend`**. Tidak ada perintah unggah dari mesin lokal:
Render menarik commit dari GitHub dan membangunnya sendiri.

1. Render → service `ai-multimodal-backend` → Settings → **Build & Deploy**.
2. Pilih salah satu pemicu seperti tabel di atas (Auto-Deploy, atau Deploy Hook
   yang URL-nya disimpan sebagai secret GitHub).
3. Isi variabel runtime di tab **Environment** — daftar lengkap beserta akibat
   tiap variabel kalau salah ada di
   [`env-produksi-render.md`](./env-produksi-render.md).
4. Untuk deploy manual tanpa menunggu push: tombol **Manual Deploy → Deploy
   latest commit** di kanan atas halaman service.

> **Penting — Root Directory harus `backend`.** Aplikasi backend ada di
> subfolder `backend`, dan builder Render mencari `package.json` relatif
> terhadap root directory itu. Kalau dikosongkan, build gagal dalam hitungan
> detik dengan log yang tidak menyebut sebabnya.

### 2. Frontend (Vercel)

Project Vercel terhubung ke repo GitHub dan membangun setiap push ke `main`
sendiri (`source: git`), jadi **tidak perlu** `vercel --prod` dari mesin lokal:
mengunggah lagi hanya menghasilkan dua build untuk commit yang sama. Job
`deploy-frontend` hanya *memverifikasi* hasilnya lewat REST API.

`VITE_API_URL` di project Vercel harus menunjuk backend Render
(`https://ai-multimodal-backend.onrender.com`, tanpa slash di akhir). Mengubah
nilainya **wajib diikuti Redeploy** — `VITE_*` hanya dibaca saat build.

---

## Environment Variables (Backend)

Ini **variabel runtime** milik service Render, bukan secret GitHub Actions.
Daftar lengkap beserta efek tiap variabel kalau salah ada di
[`env-produksi-render.md`](./env-produksi-render.md) — sengaja tidak
diduplikasi di sini agar tidak ada dua sumber yang bisa saling menyimpang.

Minimum supaya aplikasi hidup (bukan sekadar build hijau):

| Variabel | Contoh | Guna |
|---|---|---|
| `NODE_ENV` | `production` | mengaktifkan `trust proxy` dan mematikan route `dev-login` |
| `MONGODB_URI` | `mongodb+srv://…` | database; gagal connect → proses keluar |
| `JWT_SECRET` | `openssl rand -base64 32` | menandatangani token login |
| `FRONTEND_URL` | `https://ai-multimodal-app.vercel.app,https://maubuatapa.my.id,https://www.maubuatapa.my.id` | CORS |
| `CLOUDINARY_CLOUD_NAME`<br>`CLOUDINARY_API_KEY`<br>`CLOUDINARY_API_SECRET` | dari dashboard Cloudinary | penyimpanan media; tanpa ini mode jatuh ke `local` dan gambar user hilang tiap deploy |
| `FIREBASE_SERVICE_ACCOUNT` | JSON dalam satu baris, atau path | login Google |

Untuk fitur AI, tambahkan minimal satu provider chat (`GROQ_API_KEY`,
`GEMINI_API_KEY`, atau `OPENROUTER_API_KEY`) dan kredensial Cloudflare
(`CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN`) untuk text-to-image.
**Text-to-sound tidak butuh variabel apa pun**: Edge TTS (suara neural Indonesia
bawaan Microsoft) melayaninya tanpa kunci API. Opsional, `GEMINI_API_KEY` yang
sudah dipakai fitur chat juga menjadi provider suara dengan logat yang bisa
diarahkan (gratis, tanpa billing), dan `ELEVENLABS_API_KEY` menyediakan
cadangan free tier 10.000 karakter/bulan. Keempatnya bersuara Indonesia — itu
syarat sebuah provider masuk ke daftar, jadi tidak ada kunci yang bisa
menggeser halaman ini ke bahasa lain. Fitur yang key-nya belum ada tetap tampil di UI tetapi
menjawab dengan pesan yang menyebut variabel mana yang harus diisi.

### Mengisi variabel

Lewat dashboard: Render → service `ai-multimodal-backend` → tab **Environment**
→ **Edit** → **Save Changes**. Mengubah variabel memicu deploy ulang otomatis.

Lewat API (beberapa variabel sekaligus, nilai tidak masuk riwayat shell) —
langkah lengkapnya ada di
[`rotasi-kredensial.md` bagian D](./rotasi-kredensial.md#d-memasang-nilai-baru-di-render).
Hati-hati: `GET /v1/services/{id}/env-vars` mencetak **nilai** semua variabel,
bukan hanya namanya.

---

## Kalau ada kredensial yang bocor

Menghapus berkas dari commit berikutnya tidak cukup — isinya tetap terbaca dari
riwayat git, jadi kredensialnya harus diganti di provider. Langkah per kunci,
termasuk cara memverifikasi kunci lama benar-benar sudah mati, ada di
[`rotasi-kredensial.md`](./rotasi-kredensial.md).
