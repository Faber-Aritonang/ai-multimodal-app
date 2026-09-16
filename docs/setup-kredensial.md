# Panduan Setup Kredensial (Lokal)

Panduan langkah demi langkah untuk menyiapkan kredensial yang dibutuhkan proyek ini
sampai `npm run dev` di backend dan frontend bisa jalan tanpa error.

Yang akan kita siapkan:

| Kredensial | Dipakai untuk | Gratis? |
|---|---|---|
| MongoDB URI | database user, chat, media | ✅ Atlas free tier 512MB |
| Firebase Web Config | Google Sign-In di frontend | ✅ gratis |
| Firebase Service Account | verifikasi token di backend | ✅ gratis |
| OpenAI API Key | fitur chat | ⚠️ butuh kredit |

Total waktu: ±20 menit.

---

## 1. MongoDB Atlas (database)

1. Daftar di [mongodb.com/cloud/atlas](https://www.mongodb.com/cloud/atlas/register).
2. Buat cluster: pilih **M0 Free**, region terdekat (mis. Singapore), klik **Create**.
3. **Database Access** → **Add New Database User**
   - Authentication: **Password**
   - Username: mis. `appuser`
   - Password: klik **Autogenerate Secure Password** lalu **simpan passwordnya**
   - Built-in Role: **Read and write to any database**
4. **Network Access** → **Add IP Address**
   - Untuk development pilih **Allow Access from Anywhere** (`0.0.0.0/0`).
     Cukup aman untuk dev; jangan dipakai di produksi.
5. Kembali ke cluster → **Connect** → **Drivers** → pilih **Node.js**.
   Salin connection string-nya, bentuknya:

```
mongodb+srv://appuser:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
```

6. Ubah jadi (ganti `<password>` dengan password asli, dan tambahkan nama database):

```
mongodb+srv://appuser:PASSWORD_ANDA@cluster0.xxxxx.mongodb.net/ai-multimodal?retryWrites=true&w=majority
```

> Ragu dengan Atlas? Alternatifnya pakai MongoDB lokal:
> `MONGODB_URI=mongodb://localhost:27017/ai-multimodal`
> (butuh MongoDB terinstall di komputer).

---

## 2. Firebase (autentikasi Google)

### 2a. Buat project & aktifkan Google Sign-In

1. Buka [console.firebase.google.com](https://console.firebase.google.com/) → **Add project**.
2. Beri nama (mis. `ai-multimodal`). Google Analytics boleh dimatikan.
3. Di sidebar: **Build** → **Authentication** → **Get started**.
4. Tab **Sign-in method** → **Google** → **Enable** → pilih email support → **Save**.
5. Tab **Settings** → **Authorized domains** → **Add domain** → tambahkan `localhost`.
   `localhost` biasanya sudah ada, tapi tanpa ini login akan ditolak dengan
   `auth/unauthorized-domain` saat dijalankan dari dev server.

### 2b. Ambil Web Config (untuk frontend)

1. **Project settings** (ikon gear) → scroll ke **Your apps**.
2. Klik ikon **Web** (`</>`), beri nickname, klik **Register app**.
3. Salin objek `firebaseConfig` yang muncul, nilainya akan dipakai di `.env.local`:

```
apiKey            -> VITE_FIREBASE_API_KEY
authDomain        -> VITE_FIREBASE_AUTH_DOMAIN
projectId         -> VITE_FIREBASE_PROJECT_ID
storageBucket     -> VITE_FIREBASE_STORAGE_BUCKET
messagingSenderId -> VITE_FIREBASE_MESSAGING_SENDER_ID
appId             -> VITE_FIREBASE_APP_ID
```

### 2c. Ambil Service Account (untuk backend)

1. Masih di **Project settings** → tab **Service accounts**.
2. Klik **Generate new private key** → **Generate key**. Sebuah file `.json` akan terunduh.
3. Simpan file itu sebagai `backend/config/firebase-service-account.json`
   (path ini sudah masuk `.gitignore`, jadi tidak akan ter-commit).

---

> **Catatan penting soal `.env` vs variabel shell.** Secara default `dotenv`
> tidak menimpa variabel yang sudah ada di environment. Karena itu aplikasi ini
> (di luar `NODE_ENV=production`) **mengutamakan nilai kredensial AI dari
> `.env`** — lihat `backend/config/envFile.js`. Ini mencegah nilai rusak di shell
> (mis. `export GROQ_API_KEY=...` dengan tanda kutip tidak ditutup di `~/.bashrc`)
> diam-diam menimpa key yang benar. Nilai yang tercemar baris baru juga otomatis
> dibersihkan (`sanitizeSecret`). Kalau startup menampilkan baris
> `Config: GROQ_API_KEY diambil dari .env ...`, artinya nilai shell Anda berbeda
> dan diabaikan.

## 3. Isi file environment

### Backend

```bash
cd backend
cp .env.example .env
```

Edit `backend/.env`:

```env
PORT=3000
NODE_ENV=development
FRONTEND_URL=http://localhost:5173

# Dari langkah 1
MONGODB_URI=mongodb+srv://appuser:PASSWORD@cluster0.xxxxx.mongodb.net/ai-multimodal?retryWrites=true&w=majority

# Generate dengan: openssl rand -base64 32
JWT_SECRET=ganti-dengan-hasil-openssl-rand

# Dari langkah 2c
FIREBASE_SERVICE_ACCOUNT=./config/firebase-service-account.json

# Dari platform.openai.com/api-keys (dipakai fitur chat; teks-to-image opsional)
OPENAI_API_KEY=sk-...

# Opsional: override model
# OPENAI_CHAT_MODEL=gpt-3.5-turbo
# OPENAI_IMAGE_MODEL=dall-e-3

# Provider text-to-image (GRATIS, lihat langkah 3b)
# CLOUDFLARE_ACCOUNT_ID=...
# CLOUDFLARE_API_TOKEN=...
# IMAGE_PROVIDER=cloudflare
# IMAGE_FALLBACK_PROVIDER=pollinations

# Provider chat (GRATIS, lihat langkah 3c)
# GROQ_API_KEY=gsk_...
# GEMINI_API_KEY=...
# CHAT_PROVIDER=groq
# CHAT_FALLBACK_PROVIDER=gemini

# Opsional: lokasi penyimpanan hasil generate (default: backend/uploads)
# UPLOAD_DIR=uploads
```

### Frontend

```bash
cd frontend
cp .env.example .env.local
```

Edit `frontend/.env.local`:

```env
# Kosongkan saat development (request lewat proxy Vite ke backend)
VITE_API_URL=

# Port backend yang dipakai proxy Vite saat development.
# Harus sama dengan PORT di backend/.env. Default: http://localhost:3000
VITE_PROXY_TARGET=http://localhost:3000

# Dari langkah 2b
VITE_FIREBASE_API_KEY=AIza...
VITE_FIREBASE_AUTH_DOMAIN=ai-multimodal.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=ai-multimodal
VITE_FIREBASE_STORAGE_BUCKET=ai-multimodal.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=1234567890
VITE_FIREBASE_APP_ID=1:1234567890:web:abcdef
```

> Setelah mengubah `.env.local`, **restart** `npm run dev` agar Vite membaca ulang.

---

## 3b. Text-to-Image gratis (Cloudflare + Pollinations)

Fitur text-to-image **tidak memerlukan OpenAI**. Ada tiga provider yang bisa
dipilih lewat `IMAGE_PROVIDER`, dan satu fallback otomatis:

| Provider | Kredensial | Gratis? | Keterangan |
|---|---|---|---|
| `cloudflare` | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` | **Ya** — 10.000 Neurons/hari, tanpa kartu kredit | FLUX.1 [schnell]. ±154 neurons per gambar 1024x1024 ≈ **±65 gambar/hari** |
| `pollinations` | tidak ada | **Ya** | FLUX publik. Dipakai sebagai fallback default, jadi fitur ini selalu hidup walau belum ada kredensial |
| `openai` | `OPENAI_API_KEY` | Tidak | DALL·E 3, butuh billing aktif |

**Urutan default tanpa mengisi apa pun:** kalau kredensial Cloudflare ada →
`cloudflare` lalu `pollinations`; kalau hanya ada `OPENAI_API_KEY` → `openai`;
kalau keduanya kosong → `pollinations`. Fallback dipakai ketika kredensial
provider utama belum diisi, ukuran yang diminta tidak didukung, atau provider
utama sedang gagal/kuotanya habis.

### Langkah mengaktifkan Cloudflare Workers AI (disarankan)

1. Daftar/masuk ke **https://dash.cloudflare.com** (gratis, tanpa kartu kredit).
2. Buka **Workers & Pages → AI** (atau menu **Workers AI**). **Account ID**
   tertera di sisi kanan halaman ini — salin ke `CLOUDFLARE_ACCOUNT_ID`.
3. Buat token: **My Profile → API Tokens → Create Token** → pilih template
   **Workers AI** → **Continue → Create Token** → salin ke `CLOUDFLARE_API_TOKEN`.
   (Token hanya ditampilkan sekali.)
4. Isi `backend/.env`:

```env
CLOUDFLARE_ACCOUNT_ID=abc123...
CLOUDFLARE_API_TOKEN=...
IMAGE_PROVIDER=cloudflare
IMAGE_FALLBACK_PROVIDER=pollinations
```

5. Restart backend, lalu cek `/health`:

```bash
curl -s http://localhost:4000/health | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).services))'
# { firebase: 'configured', openai: 'missing',
#   imageProvider: 'cloudflare', imageFallback: 'pollinations',
#   imageProviders: { cloudflare: 'configured', pollinations: 'configured', openai: 'missing' },
#   devLogin: 'enabled' }
```

### Image-to-Image (FLUX.2 [klein])

Fitur image-to-image memakai **kredensial Cloudflare yang sama** seperti di atas.

| Item | Nilai |
|---|---|
| Model | `@cf/black-forest-labs/flux-2-klein-4b` (bisa diganti lewat `CLOUDFLARE_EDIT_MODEL`) |
| Kuota gratis | 10.000 neurons/hari · ±110 neurons per gambar 1024x1024 ≈ **±90 gambar/hari** |
| Batas gambar input | **< 512x512** — frontend memperkecilnya otomatis lewat canvas sebelum dikirim |
| Format request | wajib `multipart/form-data` (ditangani aplikasi) |
| Provider cadangan | `pollinations`, tapi hanya dipakai kalau `PUBLIC_BASE_URL` diisi (lihat di bawah) |

> ⚠️ Model lama `@cf/runwayml/stable-diffusion-v1-5-img2img` **sudah tidak ada** di
> katalog Workers AI (halaman dokumentasinya 404 dan namanya tidak ada di tabel
> harga). Jangan diarahkan ke model itu.

Setelah kredensial diisi, `/health` melaporkan:

```json
"imageEditProvider": "cloudflare",
"imageEditFallback": "none",
"imageEditReady": true
```

`imageEditReady: false` berarti fitur ini **belum bisa dipakai**. Permintaannya
akan dijawab 503 dengan pesan yang menjelaskan sebabnya — bukan menghasilkan
gambar yang dikira hasil edit.

#### Hasil uji langsung dengan kredensial sungguhan

Diukur dengan gambar input 512x512 PNG, satu permintaan per baris:

| Yang diuji | Hasil terukur |
|---|---|
| Waktu proses | **5-11 detik** per gambar |
| Resolusi keluaran | mengikuti `size` yang diminta — minta `1792x1024` dapat `1792x1024`; minta `1024x1024` dapat `1024x1024` |
| Format keluaran | JPEG (dibaca dari magic bytes, bukan dari header provider) |
| Gambar input benar-benar dipakai | diuji dengan input separuh merah / separuh biru, lalu warna hasil dibaca per bagian: bagian atas tetap lebih merah (R 237 vs B 121), bagian bawah lebih biru (B 240 vs R 175) → hasilnya mengikuti komposisi input, bukan gambar baru dari prompt |
| Metadata tersimpan | `resolution`, `requestedResolution`, **`inputResolution`**, `provider`, `model` |

> Catatan untuk pengembang: `inputResolution` pernah hilang tanpa error karena
> Mongoose membuang field metadata yang tidak terdaftar di schema. Sekarang ada
> test yang membaca daftar field langsung dari controller dan membandingkannya
> dengan schema, jadi field metadata baru tidak bisa lagi hilang diam-diam.

Kalau koneksi ke provider gagal di level jaringan, pesannya menyebut sebabnya
(mis. `cloudflare: fetch failed (UND_ERR_SOCKET · other side closed)`), bukan
sekadar `fetch failed` — supaya bisa dibedakan dari kredensial yang salah.

#### Jalur tanpa API key (Pollinations) — baca sebelum memakainya

Pollinations bisa mengedit gambar lewat parameter `image=`, tapi ia **mengambil
gambar input dari URL**, bukan dari bytes yang kita kirim. Dua konsekuensi yang
sudah diuji langsung:

1. Gambar lokal (`http://localhost:4000/uploads/...`) **tidak bisa** diambil provider.
2. Kalau URL-nya tidak terjangkau, Pollinations tetap membalas **HTTP 200** dan
   membuat gambar **hanya dari prompt** — input diabaikan tanpa error apa pun.

Karena itu jalur ini hanya diaktifkan bila `PUBLIC_BASE_URL` diisi **dan** tidak
menunjuk ke alamat privat (localhost / 192.168.x / 10.x / 172.16-31.x):

```env
PUBLIC_BASE_URL=https://aplikasi-anda.example.com
```

Tanpa itu, aplikasi menolak dengan pesan yang jelas (`Provider pollinations tidak
dipakai karena butuh PUBLIC_BASE_URL...`) daripada mengirimkan "hasil edit" yang
sebenarnya bukan hasil edit.

### Catatan penting

- **Ukuran gambar.** FLUX.1 [schnell] di Workers AI selalu menghasilkan
  1024x1024, jadi pilihan *Landscape* / *Portrait* di UI otomatis dialihkan ke
  provider fallback. Kalau ingin semua ukuran ditangani Cloudflare, ganti model
  lewat `CLOUDFLARE_IMAGE_MODEL`.
- **Resolusi bisa berbeda dari yang diminta.** Provider (khususnya Pollinations)
  kadang mengembalikan gambar yang lebih kecil — misalnya minta 1792x1024 dan
  dapat 1015x580. Aplikasi membaca dimensi **asli** dari file gambarnya, jadi
  `metadata.resolution` berisi ukuran sebenarnya dan
  `metadata.requestedResolution` berisi ukuran yang diminta.
- **Kuota aplikasi tetap berlaku.** Setiap gambar yang berhasil mengurangi
  `quota.imageGeneration` user, berapa pun providernya.
- **Mengganti provider** cukup dengan mengubah env lalu restart backend — tidak
  ada perubahan kode.
- Untuk mematikan fallback: `IMAGE_FALLBACK_PROVIDER=none`.

---

## 3c. Chat gratis (Groq + Gemini)

Fitur chat (LLM) juga tidak wajib memakai OpenAI. Provider dipilih lewat
`CHAT_PROVIDER`; semuanya memakai endpoint yang **kompatibel dengan OpenAI**,
jadi tidak ada dependency baru.

| Provider | Kredensial | Gratis? | Kuota gratis |
|---|---|---|---|
| `groq` | `GROQ_API_KEY` | **Ya**, tanpa kartu kredit | 30 req/menit, **1.000 req/hari**, 8K token/menit, 200K token/hari |
| `gemini` | `GEMINI_API_KEY` | **Ya** | free tier paling longgar |
| `openai` | `OPENAI_API_KEY` | Tidak | butuh billing aktif |

**Urutan default tanpa mengisi apa pun:** provider pertama yang punya key, urut
**Groq → Gemini → OpenAI**. Fallback otomatis dipakai kalau provider utama gagal
(mis. kuota harian gratisnya habis) atau balasannya kosong.

> ⚠️ Berbeda dari text-to-image, **chat wajib punya minimal satu API key** — tidak
> ada provider chat yang benar-benar tanpa kredensial.

### Langkah mengaktifkan Groq (disarankan)

1. Buka **https://console.groq.com/keys** (login Google/GitHub, tanpa kartu kredit).
2. **Create API Key** → salin nilainya (hanya tampil sekali).
3. Isi `backend/.env`:

```env
GROQ_API_KEY=gsk_...
CHAT_PROVIDER=groq
# Fallback dipakai saat kuota Groq harian habis — opsional tapi disarankan.
GEMINI_API_KEY=...
CHAT_FALLBACK_PROVIDER=gemini
```

4. Restart backend dan cek `/health`:

```bash
curl -s http://localhost:4000/health | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).services))'
# chatProvider: 'groq', chatProviders: { groq: 'configured', gemini: 'configured', openai: 'missing' }
```

### Pilihan model gratis

Model gratis di Groq saat ini bukan lagi Llama (sudah di-deprecate Juni 2026),
melainkan `gpt-oss` dan `qwen`:

```env
# default
GROQ_CHAT_MODEL=openai/gpt-oss-120b
# alternatif yang juga gratis:
# GROQ_CHAT_MODEL=openai/gpt-oss-20b
# GROQ_CHAT_MODEL=qwen/qwen3.8-27b
# GROQ_CHAT_MODEL=groq/compound        (agentic, bisa web search, 250 req/hari)
```

Untuk Gemini, model bisa diganti lewat `GEMINI_CHAT_MODEL` (default
`gemini-3.8-flash`). Daftar model yang benar-benar tersedia untuk key Anda:

```bash
curl -s https://generativelanguage.googleapis.com/v1beta/openai/models \
  -H "Authorization: Bearer $GEMINI_API_KEY" | head -c 400
```

### Hasil pengukuran nyata (Groq + Gemini, terverifikasi dari mesin ini)

| Provider | Waktu balas | Catatan |
|---|---|---|
| `groq` / `openai/gpt-oss-120b` | **±0,9 detik** | jawaban langsung, kualitas baik |
| `gemini` / `gemini-3.8-flash` | **17–60 detik** | free tier memang lambat, dan kadang `503` sesaat lalu berhasil saat di-retry |
| `gemini-flash-latest` | ±30 detik | alternatif kalau `gemini-3.8-flash` sedang padat |

Karena itu **Groq tetap jadi provider utama** dan Gemini idealnya hanya fallback
(pemakaian nyata: saat kuota harian Groq habis).

> ⚠️ **Jangan pakai `gemini-2.5-flash`** — model itu sudah tidak tersedia untuk
> pengguna baru (API membalas `404 This model is no longer available to new
> users`). Yang terverifikasi bekerja: `gemini-3.8-flash`, `gemini-flash-latest`,
> `gemini-3.5-flash`.

### Catatan

- **Nama parameter batas token berbeda per provider** dan sudah ditangani di
  `config/chatProviders.js`: Groq memakai `max_completion_tokens` (karena
  `max_tokens` di sana sudah deprecated), Gemini/OpenAI memakai `max_tokens`.
  Batasnya diatur lewat `CHAT_MAX_TOKENS` (default 2000).
- **Batas waktu request** diatur lewat `CHAT_REQUEST_TIMEOUT_MS` (default 90000 ms)
  dengan 1 kali retry. Tanpa ini, default SDK OpenAI adalah 10 menit — terlalu
  lama untuk endpoint yang tidak streaming.
- **Kuota aplikasi tetap berlaku**: `quota.chat` user berkurang 1 hanya setelah
  balasan diterima. Kalau provider gagal, pesan user tetap tersimpan.
- **Balasan kosong dianggap gagal.** Model reasoning seperti `gpt-oss` bisa
  mengembalikan teks kosong kalau jatah tokennya habis untuk berpikir —
  aplikasi akan mencoba provider berikutnya, bukan menampilkan bubble kosong.
  Kalau sering terjadi di Groq, naikkan `CHAT_MAX_TOKENS`.
- **Data di free tier Gemini dipakai Google** untuk perbaikan produk. Kalau itu
  tidak diinginkan, pakai Groq sebagai provider utama.
- Endpoint chat mengembalikan `provider` dan `model` yang menjawab, jadi mudah
  dicek siapa yang benar-benar merespons.

---

## 3d. Penyimpanan media (Cloudinary) — wajib di produksi

Tanpa ini, gambar hasil generate **hilang setiap deploy**. Container Railway
memakai filesystem sementara: setiap deploy/restart mengganti container beserta
isi `/app/uploads`, sedangkan record-nya tetap ada di database — akibatnya UI
menampilkan gambar rusak (yang terlihat hanya teks `alt`) padahal kuota user
sudah terpakai. Berkas yang sudah hilang tidak bisa dipulihkan.

### Langkah

1. Daftar di [cloudinary.com](https://cloudinary.com/users/register_free) —
   plan **Free** tidak meminta kartu kredit (25 credit/bulan; 1 credit ≈ 1 GB
   penyimpanan atau 1 GB bandwidth).
2. Buka **Dashboard → Product Environment Credentials**. Salin tiga nilai:
   **Cloud name**, **API Key**, **API Secret** (klik ikon mata untuk membuka).
   Salin lewat ikon 📋 — huruf dan angka di layar itu mudah tertukar
   (mis. `l`/`1`, `t`/`1`, `i`/`j`) dan cloud name yang salah menghasilkan
   `401 Invalid cloud_name`.
3. Isi di `backend/.env` (lokal, opsional) **dan** di dashboard Railway →
   service backend → *Variables* (wajib):

```
CLOUDINARY_CLOUD_NAME=nama-cloud
CLOUDINARY_API_KEY=123456789012345
CLOUDINARY_API_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
```

Begitu ketiganya lengkap, mode `cloudinary` dipakai otomatis —
`STORAGE_PROVIDER` **tidak perlu** diisi. Kalau ingin memaksa memakai folder
lokal di mesin dev (mis. agar kuota Cloudinary tidak terpakai saat menguji),
set `STORAGE_PROVIDER=local`.

### Cara memastikan sudah aktif

```bash
curl -s https://<domain-backend>/health \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['storageMode'])"
# cloudinary
```

Medan `storageMode` **selalu** dikirim, termasuk di production (blok `services`
yang berisi detail infrastruktur tetap hanya muncul di luar production). Kalau
nilainya `local` di produksi, gambar akan hilang pada deploy berikutnya — dan
sejak itu pula log startup server akan menulis
`Penyimpanan media: mode=local` sebagai peringatan di platform hosting.

### Yang perlu diketahui

- **Berkas disimpan sebagai `cloudinary://<public_id>`** di kolom `outputFile`,
  dan URL CDN-nya di `outputUrl`. Penghapusan media memakai public_id itu,
  sekaligus *purge* salinan CDN-nya supaya gambar yang dihapus tidak tetap
  tampil dari cache.
- **Menghapus aset yang sudah tidak ada dianggap berhasil** (`not found`),
  supaya tombol hapus tidak gagal 500 untuk record sisa.
- Isi folder `uploads/` **tidak lagi dipakai** di produksi; folder itu hanya
  jalur dev/test.
- Alternatif tanpa Cloudinary: object storage apa pun ber-API S3 (R2, Supabase
  Storage, B2, MinIO) lewat `STORAGE_PROVIDER=s3` + variabel `S3_*`. Catatan:
  **Cloudflare R2 meminta metode pembayaran** saat aktivasi, sedangkan
  Cloudinary tidak.
- Kredensial yang pernah ditempel di chat sebaiknya dirotasi setelah setup:
  **API Secret** bisa di-*regenerate* dari halaman API Keys yang sama.

---

## 4. Buat akun admin pertama

Alur aplikasi: user Google Sign-In masuk sebagai `guest` dan butuh approval admin
sebelum bisa memakai fitur member. Jadi admin harus dibuat lebih dulu.

### 4a. Login sekali dengan akun Google yang akan jadi admin

Jalankan aplikasi (langkah 5 di bawah), lalu login di halaman `/login` dengan akun
Google calon admin. Login pertama akan gagal dengan pesan
_"User not registered"_ dan diarahkan ke `/register`.

Jika itu terjadi, daftar dulu sebagai member pending agar UID tercatat:

1. Di halaman `/register`, klik **Sign up with Google**.
2. Setelah dialog Firebase muncul, **UID akun Anda sekarang ada di Firebase Console**
   → **Authentication** → tab **Users**. Salin kolom **User UID**.

Alternatif tanpa lewat UI: login sekali lewat `/login`, lalu ambil UID dari
Firebase Console → Authentication → Users (user akan muncul setelah proses sign-in
Google berhasil, walau backend menolak login-nya).

### 4b. Seed admin ke database

```bash
cd backend
node scripts/createAdmin.js --uid "UID_DARI_LANGKAH_4A" --email "email@anda.com" --name "Nama Admin"
```

Atau lewat env:

```bash
ADMIN_UID=xxx ADMIN_EMAIL=xxx ADMIN_NAME="Admin" npm run seed:admin
```

### 4c. Login ulang

Login lagi dengan akun Google tersebut. Backend sekarang mengenali UID itu sebagai
admin, JWT berisi `role: 'admin'`, dan frontend otomatis membuka `/admin`.

Dari dashboard admin Anda bisa approve/reject member pendaftar di `/admin/members`.

---

## 5. Jalankan aplikasi

Dua terminal:

```bash
# Terminal 1 - backend
cd backend
npm run dev          # http://localhost:3000

# Terminal 2 - frontend
cd frontend
npm run dev          # http://localhost:5173
```

Cek backend siap:

```bash
curl http://localhost:3000/health
# {"status":"OK","timestamp":"...","database":"connected","services":{...}}
```

`"database":"connected"` artinya `MONGODB_URI` sudah benar. Field `services`
menunjukkan apakah Firebase & OpenAI sudah terbaca (hanya muncul di luar
production):

```json
"services": { "firebase": "configured", "openai": "missing", "devLogin": "enabled" }
```

`firebase: "missing"` berarti path service account tidak ketemu (path relatif
dihitung dari folder `backend/`).

---

### 5a. Mode dev-login (tanpa Firebase, development saja)

Kalau kredensial Firebase belum siap, aplikasi tetap bisa dipakai di lokal lewat
**dev-login**: login hanya dengan email, tanpa Google. Panel ini tampil di
halaman `/login` pada bagian *Dev login (tanpa Firebase)* saat `npm run dev`.

```bash
curl -X POST http://localhost:3000/api/v1/auth/dev-login \
  -H 'Content-Type: application/json' \
  -d '{"email":"dev.member@example.com","role":"member"}'
```

| Body | Hasil |
|---|---|
| `role: "member"` (default) | user dibuat/di-set sebagai member yang sudah disetujui |
| `role: "guest"` | user belum disetujui, berguna untuk menguji halaman `/pending-approval` dan alur approve admin |
| email yang ada di koleksi `admins` | token dengan role `admin` untuk masuk ke `/admin` |

Catatan keamanan: endpoint ini **tidak pernah aktif** saat
`NODE_ENV=production` — route-nya tidak dipasang sama sekali (404). Jadi mode ini
aman dipakai untuk menguji fitur tanpa menunggu setup Google Sign-In.

---

## 6. Troubleshooting

| Gejala | Penyebab & solusi |
|---|---|
| `MONGODB_URI` error / `Database connection error` | Password atau nama database salah, atau IP belum di-whitelist di **Network Access**. Karakter spesial di password harus di-URL-encode (`@` → `%40`). |
| `FIREBASE_SERVICE_ACCOUNT is not set` | `backend/.env` belum diisi, atau file service account belum ada di path yang ditulis. Path relatif dihitung dari folder `backend/`. |
| `FIREBASE_SERVICE_ACCOUNT contains invalid JSON` | File key rusak, atau JSON di-paste sebagian. Unduh ulang dari Firebase Console. |
| Frontend error `auth/invalid-api-key` | `frontend/.env.local` belum diisi, atau dev server belum di-restart setelah diedit. |
| `auth/unauthorized-domain` | Domain belum diizinkan. Tambahkan `localhost` (development) atau domain Vercel (produksi) di Firebase Console → Authentication → Settings → **Authorized domains**. |
| `auth/configuration-not-found` | Provider Google belum diaktifkan: Authentication → Sign-in method → Google → Enable. |
| `auth/api-key-not-valid` | `VITE_FIREBASE_API_KEY` salah/tercampur. Salin ulang dari Project Settings → General → Your apps, lalu restart dev server. |
| `firebase: "missing"` di `/health` padahal `FIREBASE_SERVICE_ACCOUNT` sudah diisi | Isinya path default (`./config/firebase-service-account.json`) tapi file key belum di-download. Lihat langkah 2c. |
| Butuh mencoba aplikasi tanpa Firebase | Pakai **dev-login** (bagian 5a). Hanya aktif saat `NODE_ENV` bukan `production`. |
| Backend gagal start karena port dipakai proses lain (`EADDRINUSE`) | Ubah `PORT` di `backend/.env`, lalu samakan `VITE_PROXY_TARGET` di `frontend/.env.local`. |
| `Auth service temporarily unavailable` di chat | `OPENAI_API_KEY` belum diisi atau kredit OpenAI habis. Cek log backend. |
| `OPENAI_API_KEY is not set` (HTTP 503) saat generate gambar | Isi `OPENAI_API_KEY` di `backend/.env`, lalu restart backend. |
| `Image generation failed` (HTTP 502) | Kredit/billing OpenAI habis, prompt ditolak moderation, atau rate limit. Cek pesan `error` di response dan log backend. |
| Gambar tidak muncul setelah generate | Cek folder `backend/uploads/` sudah berisi file PNG. Saat development, `/uploads` di-proxy Vite ke backend (lihat `vite.config.js`). |
| `Quota for imageGeneration exhausted` | Kuota gambar user habis. Admin bisa approve ulang dengan kuota baru, atau ubah `quota.imageGeneration` di MongoDB. |
| Login berhasil tapi selalu diarahkan ke `/pending-approval` | Akun belum di-approve. Buka `/admin/members` dengan akun admin lalu approve. |
| CORS error di browser | `FRONTEND_URL` di `backend/.env` harus sama persis dengan origin frontend (termasuk port). |

---

## 7. Ringkasan perintah berguna

```bash
# Backend
npm run dev              # jalankan server dengan nodemon
npm test                 # jalankan unit test (tidak butuh DB)
npm run seed:admin       # upsert admin dari env ADMIN_UID/ADMIN_EMAIL

# Frontend
npm run dev              # dev server Vite
npm run lint             # ESLint
npm run build            # build produksi
```
