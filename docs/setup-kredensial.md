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
5. Tab **Settings** → **Authorized domains** → **Add domain** → tambahkan `localhost`, `ai-multimodal-app.vercel.app`, `maubuatapa.my.id`, dan `www.maubuatapa.my.id`.
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

# Provider text-to-image (lihat langkah 3b)
# CLOUDFLARE_ACCOUNT_ID=...
# CLOUDFLARE_API_TOKEN=...
# IMAGE_PROVIDER=cloudflare
# IMAGE_FALLBACK_PROVIDER=pollinations

# Alternatif: Bynara / NaraRouter (Agnes Image 2.0 Flash)
# BYNARA_API_KEY=sk-nry-...

# Provider chat (GRATIS, lihat langkah 3c)
# GROQ_API_KEY=gsk_...
# GEMINI_API_KEY=...
# CHAT_PROVIDER=groq
# CHAT_FALLBACK_PROVIDER=gemini

# Provider text-to-sound (lihat langkah 3e)
# GEMINI_API_KEY sudah dipakai fitur chat; Edge tidak perlu kunci
# SOUND_PROVIDER=gemini

# Provider sound-to-text (lihat langkah 3f)
# GROQ_API_KEY=gsk_...              # gratis, 1.000 request/hari (disarankan)
# GEMINI_API_KEY sudah dipakai fitur chat/TTS
# STT_PROVIDER=groq
# STT_FALLBACK_PROVIDER=gemini

# Provider text-to-video & image-to-video (lihat langkah 3g)
# Tidak ada jalur gratis: WAJIB ada kunci. Memakai kunci yang sama dengan
# text-to-image, jadi kalau BYNARA_API_KEY di atas sudah diisi, tidak ada yang
# perlu ditambah.
# VIDEO_PROVIDER=bynara
# VIDEO_RESOLUTION=720p

# Opsional: lokasi penyimpanan hasil generate (default: backend/uploads)
# UPLOAD_DIR=uploads
```

> **Jangan menyimpan salinan berkas ini.** `backend/.env` memuat kredensial
> asli, jadi salinan apa pun — mis. `backend/.env.save`, `.env.bak`,
> `.env.save.1` — sama sensitifnya dengan berkas aslinya dan tidak boleh masuk
> git. `.gitignore` di repo ini sudah memuat `.env*`, tetapi aturan ignore
> **tidak berlaku** pada berkas yang sudah ter-track dan tidak menahan
> `git add -f`.
>
> Riwayat git tidak bisa "dibatalkan": sekali kredensial ter-commit, satu-satunya
> perbaikan yang benar-benar bekerja adalah **mengganti kredensialnya di
> provider**. Cara melakukannya per kunci ada di
> [`rotasi-kredensial.md`](./rotasi-kredensial.md).

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

Fitur text-to-image **tidak memerlukan OpenAI**. Ada empat provider yang bisa
dipilih lewat `IMAGE_PROVIDER`, dan satu fallback otomatis:

| Provider | Kredensial | Gratis? | Keterangan |
|---|---|---|---|
| `bynara` | `BYNARA_API_KEY` | Tergantung paket NaraRouter | Agnes Image 2.0 Flash. Satu kunci untuk generate + unduh hasil |
| `cloudflare` | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` | **Ya** — 10.000 Neurons/hari, tanpa kartu kredit | FLUX.1 [schnell]. ±154 neurons per gambar 1024x1024 ≈ **±65 gambar/hari** |
| `pollinations` | tidak ada | **Ya** | FLUX publik. Dipakai sebagai fallback default, jadi fitur ini selalu hidup walau belum ada kredensial |
| `openai` | `OPENAI_API_KEY` | Tidak | DALL·E 3, butuh billing aktif |

**Urutan default tanpa mengisi apa pun:** kalau `BYNARA_API_KEY` ada → `bynara`
lalu `pollinations`; kalau hanya kredensial Cloudflare yang ada → `cloudflare`
lalu `pollinations`; kalau hanya `OPENAI_API_KEY` → `openai`; kalau semuanya
kosong → `pollinations`. Fallback dipakai ketika kredensial provider utama belum
diisi, ukuran yang diminta tidak didukung, atau provider utama sedang
gagal/kuotanya habis.

### Mengaktifkan Bynara (NaraRouter)

Cukup satu variabel — host generate dan host unduhan hasil sudah punya nilai
bawaan yang benar:

```env
BYNARA_API_KEY=sk-nry-...
```

Yang dilakukan kode saat kunci ini ada:

1. **Generate** ke `https://api-images.bynara.id/v1/images/generations` dengan
   body `{model, prompt, size}` dan header `Authorization: Bearer <kunci>`.
2. **Unduh hasil** ke Buffer server. Gateway membalas path relatif
   (`/v1/images/<id>/download`) yang **tidak** dilayani host generate, melainkan
   `https://router.bynara.id` — dan unduhan itu juga butuh header
   `Authorization` yang sama. Nilai bawaan `BYNARA_DOWNLOAD_BASE_URL` sudah
   menunjuk ke sana; host generate dipakai sebagai cadangan bila host unduhan
   tidak menjawab.

Hasil dari Bynara berupa PNG dan diunggah ke penyimpanan remote seperti provider
lain, jadi URL gambar sementara milik gateway tidak ikut tersimpan.

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

### Image-to-Image

Ada dua provider, keduanya bekerja dari **bytes gambar** yang dikirim frontend
(bukan dari URL), jadi tidak ada perbedaan perilaku antara penyimpanan lokal dan
remote.

| Provider | Kredensial | Model | Catatan |
|---|---|---|---|
| `bynara` **(utama)** | `BYNARA_API_KEY` | `agnes-image-2.0-flash` (bisa diganti lewat `BYNARA_IMAGE_MODEL`) | Satu kunci untuk generate + edit |
| `cloudflare` | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` | `@cf/black-forest-labs/flux-2-klein-4b` (bisa diganti lewat `CLOUDFLARE_EDIT_MODEL`) | Kuota gratis 10.000 neurons/hari · ±110 neurons per gambar 1024x1024 ≈ **±90 gambar/hari** |

Catatan per provider:

- **Bynara** memakai `https://api-images.bynara.id/v1/images/edits` dan **hanya
  menerima `multipart/form-data`** dengan `image` sebagai berkas. JSON dengan
  `image` berisi data URL dibalas
  `400 {"type":"bad_request","message":"Invalid image edit request."}`.
- **Cloudflare FLUX.2 [klein]** juga multipart, dan hanya menerima gambar input
  **< 512x512** — frontend memperkecilnya otomatis lewat canvas sebelum dikirim.

> ⚠️ Model lama `@cf/runwayml/stable-diffusion-v1-5-img2img` **sudah tidak ada** di
> katalog Workers AI (halaman dokumentasinya 404 dan namanya tidak ada di tabel
> harga). Jangan diarahkan ke model itu.

Dengan `BYNARA_API_KEY` terisi, `/health` melaporkan:

```json
"imageEditProvider": "bynara",
"imageEditFallback": "cloudflare",
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

#### Kenapa Pollinations tidak dipakai untuk image-to-image

Pollinations bisa mengedit gambar lewat parameter `image=`, tapi ia **mengambil
gambar input dari URL**, bukan dari bytes yang kita kirim. Dua konsekuensi yang
sudah diuji langsung:

1. Gambar lokal (`http://localhost:4000/uploads/...`) **tidak bisa** diambil provider.
2. Kalau URL-nya tidak terjangkau, Pollinations tetap membalas **HTTP 200** dan
   membuat gambar **hanya dari prompt** — input diabaikan tanpa error apa pun.

Selain itu, hasil editnya sering hanya berupa gambar baru dari prompt sehingga
terlihat mirip tetapi tidak mengikuti gambar input. Karena itu Pollinations
**dihapus dari daftar provider edit**: `IMAGE_EDIT_PROVIDER=pollinations` ditolak
sebagai nama yang tidak dikenal, dan `PUBLIC_BASE_URL` tidak lagi memengaruhinya.
Bynara dan Cloudflare sudah bekerja dari bytes gambar, jadi hasil editnya tidak
bergantung pada URL apa pun.

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

## 3c. Chat gratis (Groq + Gemini + OpenRouter)

Fitur chat (LLM) juga tidak wajib memakai OpenAI. Provider dipilih lewat
`CHAT_PROVIDER`; semuanya memakai endpoint yang **kompatibel dengan OpenAI**,
jadi tidak ada dependency baru.

| Provider | Kredensial | Gratis? | Kuota gratis |
|---|---|---|---|
| `groq` | `GROQ_API_KEY` | **Ya**, tanpa kartu kredit | 30 req/menit, **1.000 req/hari**, 8K token/menit, 200K token/hari |
| `gemini` | `GEMINI_API_KEY` | **Ya** | free tier paling longgar |
| `openai` | `OPENAI_API_KEY` | Tidak | butuh billing aktif |
| `openrouter` | `OPENROUTER_API_KEY` | **Ya** untuk model `:free` | rate limit harian per model |

**Urutan default tanpa mengisi apa pun:** provider pertama yang punya key, urut
**Groq → Gemini → OpenAI → OpenRouter**. Fallback otomatis dipakai kalau provider
utama gagal (mis. kuota harian gratisnya habis) atau balasannya kosong.

Provider yang tidak punya key otomatis dilewati, jadi menambahkan
`OPENROUTER_API_KEY` **tidak mengubah** provider utama maupun cadangan yang sudah
berjalan — OpenRouter hanya ditambahkan di urutan paling akhir.

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
# chatProvider: 'groq', chatProviders: { groq: 'configured', gemini: 'configured', openai: 'missing', openrouter: 'missing' }
```

### Menambah OpenRouter sebagai cadangan tambahan

Berguna saat kuota gratis Groq **dan** Gemini sama-sama habis (atau Gemini sedang
`503`). Endpoint-nya kompatibel OpenAI, jadi tidak ada dependency baru.

1. Buka **https://openrouter.ai/keys** → **Create Key** → salin nilainya.
2. Isi `backend/.env` (tanpa mengubah baris yang sudah ada):

```env
OPENROUTER_API_KEY=sk-or-...
# Boleh satu model, boleh beberapa dipisah koma — dicoba berurutan.
OPENROUTER_CHAT_MODEL=nex-agi/nex-n2.5-mini:free,nvidia/nemotron-3-super-120b-a12b:free,inclusionai/ling-3.0-flash-vl:free,inclusionai/ling-3.0-flash-fin:free
```

Batas gratis OpenRouter berlaku **per model**, jadi menuliskan lebih dari satu
model berarti: kalau model pertama kena `429`/`503`, model berikutnya langsung
dicoba tanpa harus turun ke provider lain. Urutannya dipilih dari yang tercepat
ke yang paling lambat:

| Urutan | Model | Waktu | Kenapa di posisi ini |
|---|---|---|---|
| 1 | `nex-agi/nex-n2.5-mini:free` | **±0,7–1,0 detik** | tercepat & paling konsisten (6/6 berhasil) |
| 2 | `nvidia/nemotron-3-super-120b-a12b:free` | ±5,0–6,3 detik | lebih pintar untuk soal sulit, tapi lebih lambat dan pernah `503` |
| 3 | `inclusionai/ling-3.0-flash-vl:free` | ±1,0–1,9 detik | 4/4 berhasil, tapi tetap ditaruh setelah model yang sudah dipakai agar urutannya tidak bergeser |
| 4 | `inclusionai/ling-3.0-flash-fin:free` | ±0,8–2,3 detik | varian "fin" dari model ketiga; 3/3 berhasil |

Menuliskan model yang sama dua kali tidak masalah (dihitung sekali), tapi
sebaiknya tetap rapi: daftar ini yang menentukan urutan percobaan.

Kalau salah satu model gagal terus, ia **tidak** menghentikan permintaan: error
baru dikembalikan setelah semua model di daftar itu habis dicoba, dan pesan
errornya menyebut setiap model beserta sebabnya (mis.
`All OpenRouter models failed (nex-agi/nex-n2.5-mini:free: ... 429; nvidia/nemotron-3-super-120b-a12b:free: ... 503)`).

#### Kegagalan tidak dibayar berulang kali

Retry bawaan SDK **dimatikan** untuk OpenRouter (`maxRetries: 0`): percobaan ulang
di sini ditangani dengan pindah ke model berikutnya, jadi retry internal hanya
menggandakan waktu tunggu saat sebuah model sedang kena `429`/`5xx`.

Selain itu, model yang baru gagal **dijeda** (default 60 detik) dan dilewati
tanpa request selama jeda itu. Jeda dipasang per model dan dihapus otomatis
begitu model tersebut berhasil lagi, jadi ini bukan pemutusan permanen — model
pasti dicoba lagi setelah jeda habis. Terukur pada gangguan nyata
(list yang seluruh modelnya sedang gagal):

| Request saat gangguan | Sebelum | Sesudah |
|---|---|---|
| ke-1 (menemukan kegagalan) | ±6–8 detik | ±5,6 detik |
| ke-2 dan seterusnya | ±6 detik **per request** | **0 ms** |
| satu model saja yang gagal, sisanya sehat | ±6 detik | **0 ms** (langsung ke model berikutnya)

Atur lewat `OPENROUTER_FAILURE_COOLDOWN_MS` — mis. `0` untuk selalu mencoba
semua model (berguna saat menguji), atau nilai lebih besar kalau provider sering
kena batas harian:

```env
OPENROUTER_FAILURE_COOLDOWN_MS=60000   # default
# OPENROUTER_FAILURE_COOLDOWN_MS=0     # matikan jeda
```

> ℹ️ Jeda ini disimpan di memori proses, bukan di database: setiap instance
> backend punya catatannya sendiri dan kembali kosong setelah restart. Itu
> disengaja — tujuannya hanya menghindari pembayaran waktu berulang, bukan
> menyimpan status permanen.

> ⚠️ **Jangan lupa akhiran `:free`.** Tanpa akhiran itu, id akan cocok ke varian
> **berbayar** dan gagal dengan `402 Insufficient credits. This account never
> purchased credits.` — pesan yang menyesatkan, karena yang kurang sebenarnya
> cuma `:free` di belakang id. Nilai env model dikirim apa adanya (huruf
> besar/kecilnya tidak diubah, berbeda dari env nama provider) meskipun
> OpenRouter masih memaafkan perbedaan huruf besar/kecil; id yang benar-benar
> tidak ada dibalas `400 ... is not a valid model ID` dan otomatis dilewati ke
> model berikutnya.

#### Pemilihan model gratis: hasil pembandingan

Ke-22 model `:free` di katalog OpenRouter diuji dari mesin ini dengan prompt yang
sama, penalaran dimatikan, dan `max_tokens` 1200–2000:

| Model gratis | Waktu | Berhasil | Catatan |
|---|---|---|---|
| **`nex-agi/nex-n2.5-mini:free`** (default, urutan 1) | **±0,7–1,0 detik** | 6/6 | jawaban rapi & sesuai instruksi; secepat provider utama Groq |
| **`inclusionai/ling-3.0-flash-vl:free`** (default, urutan 3) | ±1,0–1,9 detik | 4/4 | jawaban bagus; kadang membungkus perintah dalam code fence |
| **`inclusionai/ling-3.0-flash-fin:free`** (default, urutan 4) | ±0,8–2,3 detik | 3/3 | varian "fin" dari model di atas; jawaban rapi |
| `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` | ±3,1 detik | 1/2 | sisanya `ResourceExhausted 16/16` dari sisi NVIDIA |
| `dots-studio/dots-3-note-preview:free` | ±3,4 detik | 1/1 | — |
| **`nvidia/nemotron-3-super-120b-a12b:free`** (default, urutan 2) | ±5,0–6,3 detik | 3/4 | pernah `503 Service temporarily overloaded`, karena itu bukan pilihan pertama |
| `nvidia/nemotron-3.5-lightning:free` (dipakai sebelumnya) | **±71–76 detik** | 2/2 | terlalu lambat; jawaban bisa berupa jejak berpikir |
| `google/gemma-4-31b-it:free`, `google/gemma-4-26b-a4b-it:free` | — | 0/2 | `429 rate-limited upstream` di dua ronde pengujian |
| `z-ai/glm-5.2:free` (**dikeluarkan** dari daftar default) | — | 0/8 | `429 rate-limited upstream` di empat ronde pengujian. Penyebabnya bukan kuota akun kita: `limit_source: "upstream_provider_shared_pool"`, provider "Decart", `provider_error_code: "overloaded"`. Varian `:free` hanya dilayani kolam bersama itu, sementara `z-ai/glm-5.2` (tanpa `:free`) punya ±30 provider yang semuanya berbayar — jadi provider routing pun tidak menolong. Bisa dimasukkan kembali lewat `OPENROUTER_CHAT_MODEL` kapan saja begitu kolamnya longgar, atau lewat BYOK (key Z.ai sendiri di https://openrouter.ai/settings/integrations) |
| `thinkingmachines/inkling-small:free` | — | — | hanya untuk agentic harness, bukan chat biasa |
| `liquid/lfm-2.5-2.6b:free` | — | — | menolak `reasoning.enabled=false` ("reasoning is mandatory") |

> ℹ️ **Kenapa berpikir (reasoning) dimatikan.** Beberapa model gratis di
> OpenRouter adalah *reasoning model*: kalau dibiarkan, ia memakai jatah
> `CHAT_MAX_TOKENS` untuk berpikir — yang tersisa di `content` hanya jejak
> berpikir ("Here's a thinking process: ..."), bukan jawaban — dan waktunya
> membengkak jauh (terukur pada `nvidia/nemotron-3.5-lightning:free`: ±100 detik
> tanpa parameter vs ±19 detik saat dimatikan). Karena itu provider ini mengirim
> `reasoning: { enabled: false }` secara default. Ubah lewat
> `OPENROUTER_REASONING` bila model pilihan Anda justru wajib berpikir:
>
> ```env
> OPENROUTER_REASONING=off       # default: reasoning dimatikan
> # OPENROUTER_REASONING=exclude # tetap berpikir, jejaknya tidak dikirim
> # OPENROUTER_REASONING=default # ikut perilaku model apa adanya
> ```
>
> Kalau memilih `exclude` atau `default`, naikkan `CHAT_REQUEST_TIMEOUT_MS`
> (mis. `150000`) supaya request tidak diputus sebelum provider menjawab.

3. Restart backend. Karena `CHAT_FALLBACK_PROVIDER` tidak diisi, rantai default
   menjadi **`groq → gemini → openrouter`** — provider utama dan cadangan lama
   tetap di posisinya.

Kalau `CHAT_FALLBACK_PROVIDER` diisi satu nama (mis. `gemini`), nama itu dicoba
**lebih dulu**, dan provider lain yang key-nya sudah diisi tetap ikut di
belakangnya — jadi `gemini` saja sudah cukup, hasilnya tetap
`groq → gemini → openrouter`. Tulis keduanya dipisah koma kalau ingin Gemini
**lalu** OpenRouter dicoba sebelum provider berkey lain:

```env
CHAT_PROVIDER=groq
CHAT_FALLBACK_PROVIDER=gemini,openrouter
```

Satu-satunya nilai yang benar-benar mematikan cadangan — termasuk untuk provider
yang key-nya sudah diisi — adalah `CHAT_FALLBACK_PROVIDER=none`. OpenRouter juga
bisa dijadikan provider utama lewat `CHAT_PROVIDER=openrouter`.

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
| `openrouter` / 4 model gratis berurutan (lihat tabel urutan di atas) | **±0,7–1,0 detik** | cadangan terakhir; reasoning dimatikan (lihat catatan di atas), limit gratis per model |
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
  `max_tokens` di sana sudah deprecated), Gemini/OpenAI/OpenRouter memakai
  `max_tokens`. Batasnya diatur lewat `CHAT_MAX_TOKENS` (default 2000).
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
2. Buka **Dashboard → Product Environment Credentials**, lalu salin **satu baris**
   *API Environment variable* — bukan tiga nilai terpisah. Salin lewat ikon 📋:
   huruf dan angka di layar itu mudah tertukar (mis. `l`/`1`, `t`/`1`, `i`/`j`),
   dan nama cloud yang salah menghasilkan `401 Invalid cloud_name`.

```
CLOUDINARY_URL=cloudinary://<api_key>:<api_secret>@<cloud_name>
```

3. Isi nilai itu di `backend/.env` (lokal, opsional) **dan** di dashboard
   Railway → service backend → *Variables* (wajib):

```
CLOUDINARY_URL=cloudinary://123456789012345:xxxxxxxxxxxxxxxxxxxxxxxxxxx@nama-cloud
```

**Kenapa satu baris, bukan tiga variabel.** Ketiga bagiannya harus berasal dari
Product Environment yang **sama**, dan mengambil API key + secret dari satu
environment sementara nama cloud dari environment lain adalah kesalahan yang
paling mudah terjadi — gejalanya pun menyesatkan: semua pemeriksaan "sudah diisi
atau belum" tetap lulus, `/health` tetap melaporkan `cloudinary`, dan yang gagal
hanya unggahan pertama user dengan `401 Invalid cloud_name`. Satu nilai tidak bisa
tidak cocok dengan dirinya sendiri.

Tiga variabel terpisah (`CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`,
`CLOUDINARY_API_SECRET`) **tetap didukung** dan dipakai kalau `CLOUDINARY_URL`
tidak ada atau bentuknya tidak terbaca. Bila keduanya diisi, **`CLOUDINARY_URL`
yang menang**; yang mana yang sedang dipakai selalu bisa dilihat dari
`storageCredentialSource` di `/health` dan dari baris `Penyimpanan media:` di log
startup.

> **Salin nilai dari ikon 📋, jangan ketik ulang.** Dua kekeliruan yang benar-benar
> terjadi: nama cloud kurang satu huruf di ujung, dan satu titik dua berlebih
> tepat setelah skema (`cloudinary://:…`). Yang terakhir masih terbaca — bagian
> kosong diabaikan — tetapi nilai yang diketik ulang adalah sumber kegagalan yang
> berulang, dan gejalanya selalu sama: `401` yang membingungkan.

Begitu kredensialnya lengkap, mode `cloudinary` dipakai otomatis —
`STORAGE_PROVIDER` **tidak perlu** diisi. Kalau ingin memaksa memakai folder
lokal di mesin dev (mis. agar kuota Cloudinary tidak terpakai saat menguji),
set `STORAGE_PROVIDER=local`.

### Cara memastikan sudah aktif

```bash
curl -s https://<domain-backend>/health \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['storageMode'], d['storageCheck'], d.get('storageCredentialSource'))"
# cloudinary ok url
```

Ketiga medan itu **selalu** dikirim, termasuk di production (blok `services` yang
berisi detail infrastruktur tetap hanya muncul di luar production), dan ketiganya
perlu dilihat karena artinya berbeda:

- **`storageMode`** — mode yang dipakai. Kalau nilainya `local` di produksi,
gambar akan hilang pada deploy berikutnya; log startup server juga menulis
`Penyimpanan media: mode=local` sebagai peringatan di platform hosting.
- **`storageCheck`** — hasil **benar-benar memanggil providernya** (`api.ping()`
untuk Cloudinary, `HeadBucket` untuk S3): `pending` (belum selesai), `ok`,
`failed`, atau `skipped` (mode `local`). Ini yang membedakan kredensial yang
**terisi** dari kredensial yang **berlaku** — nilai yang salah salin tetap
membuat `storageMode` terbaca `cloudinary`, dan tanpa kolom ini kegagalannya baru
terlihat saat user pertama kali men-generate gambar.
- **`storageCredentialSource`** — dari mana kredensial Cloudinary dibaca: `url`
(`CLOUDINARY_URL`), `vars` (tiga variabel terpisah), `url-invalid` (variabelnya
ada tetapi bentuknya tidak terbaca), atau `none`. Isinya **nama** variabel, bukan
nilainya, dan itu satu-satunya cara membedakan konfigurasi yang berperilaku sama
saat benar tetapi berbeda saat salah — persis kasus yang dulu hanya bisa
ditelusuri dari dalam dashboard.

  Nilai `url-invalid` sengaja **tidak** jatuh ke penyimpanan lokal: kalau begitu,
gambar user ditulis ke filesystem container dan hilang pada deploy berikutnya
tanpa satu pun error. Yang terjadi justru sebaliknya — mode tetap dilaporkan
`cloudinary`, dan setiap unggahan gagal dengan pesan yang menyebut variabelnya
beserta bentuk yang benar.

Kalau `storageCheck` bernilai `failed`, **sebabnya ikut dikirim** sebagai
`storageCheckReason`:

```json
{"storageMode":"cloudinary","storageCheck":"failed","storageCheckReason":"HTTP 401"}
```

- `HTTP 401` / `HTTP 403` — provider menolak nilainya: salah salin, sudah
dicabut, atau masih placeholder.
- `timeout` — providernya tidak menjawab dalam 10 detik; periksa jaringan, bukan
  nilainya.

Isinya sengaja hanya KODE, bukan pesan dari provider, karena pesannya memuat nama
cloud/bucket dan kolom ini tayang di `/health` publik serta di log CI repo publik.
Sebelum kolom ini ada, satu-satunya cara mengetahui sebabnya adalah membaca baris
`Verifikasi penyimpanan:` di log startup Railway.

### Kalau Cloudinary menjawab `HTTP 401`: mana dari ketiga nilai yang salah?

Cara tercepat menghilangkan seluruh kelas kegagalan ini: ganti ketiga variabel
dengan **satu** `CLOUDINARY_URL` (lihat langkah 2 di atas). Nilainya disalin utuh
dari satu baris dashboard, sehingga key, secret, dan nama cloud tidak mungkin
lagi berasal dari Product Environment yang berbeda. Setelah itu `/health` harus
melaporkan `storageCredentialSource: "url"`.

Kalau tetap memakai tiga variabel terpisah, `HTTP 401` saja tidak memisahkan
"kunci salah" dari "nama cloud salah", dan keduanya perlu diperiksa di tempat
berbeda. Cara memisahkannya: jalankan
`api.ping()` dengan pasangan key+secret yang ada, lalu ganti **nama cloud**-nya
dengan nama yang jelas tidak ada, dan bandingkan pesan galatnya.

| Uji | Pesan galat menyebut | Artinya |
|---|---|---|
| key+secret asli + cloud asli | `cloud_name` | key+secret **sudah benar** — yang salah nama cloud-nya |
| key+secret asli + cloud palsu | `cloud_name` (sama seperti di atas) | menegaskan: pesan ini soal nama cloud, bukan pasangan kuncinya |
| key+secret palsu + cloud asli | `api_secret` | pasangan api_key/api_secret-nya yang salah |

Kalau pesannya menyebut `cloud_name` padahal key+secret-nya sudah lolos,
penyebab yang paling sering: nama cloud disalin dari tempat lain (mis. nama
*project* di dashboard), atau `CLOUDINARY_CLOUD_NAME` diisi dari akun Cloudinary
yang berbeda dengan pemilik api_key. Nama cloud ada di dashboard Cloudinary pada
baris *API Environment variable*, berbentuk
`cloudinary://<api_key>:<api_secret>@<cloud_name>` — ambil bagian terakhirnya,
bukan dari judul halaman.

Yang **bukan** penyebab: spasi atau tanda kutip yang ikut tersalin. Nilai
variabel di Railway bisa berisi spasi di ujung, tetapi kode sudah memangkasnya
(`trimmed()` di `config/storage.js`) sebelum dipakai.

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

## 3e. Text-to-Sound — Edge (tanpa kunci) + Gemini sebagai pilihan utama

Fitur **Text to Sound** (`/tools/text-to-sound`) mengubah teks menjadi audio.
Empat provider tersedia, dan **semuanya bersuara Indonesia** — itu syaratnya,
karena halaman ini memang selalu mengucapkan teks Indonesia:

| Provider | Bahasa | Biaya | Dipilih lewat |
|---|---|---|---|
| **Edge TTS** | Indonesia (`id-ID-GadisNeural`, `id-ID-ArdiNeural`) | **gratis, tanpa kunci API** | `SOUND_PROVIDER=edge` |
| **Gemini TTS** | Indonesia + 70 bahasa lain, logat bisa diarahkan | **gratis, tanpa billing** | `SOUND_PROVIDER=gemini` |
| **ElevenLabs** | Indonesia (multilingual v2) | **gratis 10.000 karakter/bulan** | `SOUND_PROVIDER=elevenlabs` |
| **OpenAI** (`gpt-4o-mini-tts`) | Indonesia + puluhan bahasa lain | berbayar | `SOUND_PROVIDER=openai` |

Tanpa `SOUND_PROVIDER` diisi, yang dipakai adalah provider pertama yang
kredensialnya tersedia, urut **Gemini → ElevenLabs → OpenAI → Edge**, dan
cadangannya default `edge`.

### Tanpa kredensial apa pun, fiturnya tetap hidup

Edge TTS tidak membutuhkan kunci apa pun, jadi halaman ini **langsung bisa
dipakai** di mesin atau server yang belum diisi kredensial suara. Yang perlu
diketahui secara jujur: endpoint ini adalah jalur **Read Aloud** milik Microsoft
Edge, bukan API publik yang didokumentasikan. Gratis dan berfungsi (sudah diuji
langsung dari proyek ini), tetapi bisa berubah sewaktu-waktu. Karena itu:

- ia diletakkan di **paling belakang** urutan default: provider yang kredensialnya
  sudah diisi selalu didahulukan,
- ia hanya menghasilkan **MP3** (WAV dan PCM mentah ditolak server Microsoft —
  tidak dijawab dengan kode galat, hanya berakhir *timeout*),
- bisa dimatikan total dengan `SOUND_PROVIDER=none`,
- alamatnya bisa ditimpa lewat `EDGE_TTS_WSS_URL` bila Microsoft memindahkannya.

### Rantai gratis: Gemini dulu, Edge saat kuota habis

Kuota gratis Gemini TTS habis pada tengah bulan (Google membalas **HTTP 429**).
Cadangan defaultnya Edge — provider gratis yang **tidak** membutuhkan kunci,
jadi cadangannya benar-benar bisa dipakai alih-alih menunggu admin mengisi kunci.
Permintaan yang gagal di Gemini dicoba ke Edge tanpa user melakukan apa pun;
riwayat media mencatat provider yang benar-benar melayani, dan log server
menampilkan percobaan yang dilewati.

Karena Gemini (WAV) dan Edge (MP3) tidak punya format yang sama, ada satu
perilaku yang perlu diketahui: kalau provider utama gagal **sesaat** (mis. kuota
habis) sementara format yang diminta hanya bisa dihasilkan provider itu, Edge
melayaninya dengan formatnya sendiri dan penggantian itu dicatat. Substitusi ini
sengaja **tidak** dilakukan saat kegagalannya soal konfigurasi (kunci ditolak) —
masalah kunci harus terlihat apa adanya. Kalau halaman ini dipakai banyak user,
siapkan `OPENAI_API_KEY` (`SOUND_PROVIDER=gemini`, `SOUND_FALLBACK_PROVIDER=openai`).

### Satu perbedaan yang terlihat di UI: format berkas

Gemini mengembalikan **PCM mentah**, dan proyek ini tidak punya encoder MP3 —
backend membungkusnya menjadi WAV. Edge sebaliknya hanya bisa MP3. Jadi pilihan
format mengikuti provider yang aktif: saat Gemini yang aktif **MP3 tidak
ditawarkan**, saat Edge yang aktif **WAV tidak ditawarkan**, dan permintaan yang
formatnya tidak mungkin dijawab dijawab 400 dengan pesan yang menyebut
providernya. ElevenLabs/OpenAI bisa WAV dan MP3, Edge hanya MP3.

Kalau `GEMINI_API_KEY` terisi tetapi kuncinya sudah dicabut, yang muncul adalah
503 dengan pesan `Gemini TTS error: HTTP 401` — bukan audio dari Edge, karena
galat konfigurasi memang sengaja ditampilkan. Perbaikannya: ambil kunci baru,
atau kosongkan baris itu agar Edge menjadi provider utama (halaman lalu menawarkan
MP3 dan berfungsi tanpa kunci).

Daftar voice dan format dilayani `GET /media/sound-voices` sesuai provider yang
aktif, jadi dropdown di halaman tidak pernah menawarkan nilai milik provider
lain. Kolom *voice style* hanya mengatur **cara bicara** — ia tidak pernah
menggantikan voice yang dipilih user.

### Kenapa MiMo dihapus dari proyek ini

Provider MiMo (Xiaomi, `MIMO_API_KEY`) pernah ada di daftar dan sudah **dihapus**.
Sebabnya: dokumentasi resminya berbunyi *"Both Chinese and English are
supported"* — tidak ada suara Indonesia, sedangkan halaman ini selalu
mengucapkan teks Indonesia. Selama ia ada di daftar, mengisi `MIMO_API_KEY`
sudah cukup untuk memindahkan seluruh halaman ke suara Mandarin tanpa ada yang
memintanya, dan memperbaiki satu halaman itu tidak menghilangkan masalahnya:
selama provider tanpa suara Indonesia ada di daftar, kombinasi kunci di server
menentukan bahasa yang keluar. Menghapusnya tidak menghilangkan kemampuan apa
pun — Gemini, ElevenLabs, dan Edge sama-sama bersuara Indonesia dan gratis.

Kalau `MIMO_API_KEY` masih terisi di server, tidak ada yang perlu dibersihkan:
variabel itu tidak lagi dibaca, dan `/health` tidak lagi melaporkannya.

### Gemini TTS — provider utama

- endpoint-nya `/v1beta/interactions` (bukan `/v1/audio/speech`), hasilnya PCM
  ber-base64 yang dibungkus WAV oleh backend,
- kuncinya sama dengan provider chat Gemini: `GEMINI_API_KEY`. Kuota gratisnya
  **tidak memerlukan billing**, jadi fitur ini benar-benar tanpa biaya,
- modelnya masih berstatus *preview*, dan kuota gratisnya kecil — itu sebabnya
  ElevenLabs dipasang sebagai cadangan,
- deskripsi di kolom **voice style** dikirim sebagai arahan bahasa alami di depan
  teks (dokumentasi resminya bercontoh *“Say cheerfully: Have a wonderful day!”*).
  Tanpa deskripsi gaya, teks dikirim apa adanya supaya yang diucapkan persis
  teks yang diketik user.

### ElevenLabs — cadangan gratis

- endpoint-nya `/v1/text-to-speech/{voice_id}`; hasilnya berkas audio langsung,
- **ID voice dibaca dari akun pemilik kunci** lewat `GET /v1/voices`, karena free
  tier tidak boleh memakai voice voice library dan daftar voice bawaan ElevenLabs
  berbeda antar akun (berubah mulai Februari 2026). Kalau ID yang dipilih user
  tidak ada di akun itu, voice yang tersedia dipakai dan penggantiannya masuk log,
- kolom **voice style** **diabaikan** (dengan peringatan di log): provider ini
  tidak punya parameter arahan gaya bebas. Untuk mengatur logat/gaya, pakai Gemini.

### Peran kolom *voice style* di tiap provider

Tidak ada provider di sini yang membuat suara baru dari deskripsi; yang dipilih
user di dropdown voice selalu dipakai:

| Provider | Yang dilakukan dengan *voice style* |
|---|---|
| **Gemini** | dikirim sebagai arahan bahasa alami di depan teks |
| **OpenAI** | dikirim lewat parameter `instructions` (hanya model `gpt-4o-*`) |
| **Edge** | diabaikan, dengan peringatan di log |
| **ElevenLabs** | diabaikan, dengan peringatan di log |

### Langkah mengaktifkan

**Tidak ada variabel yang wajib diisi.** Edge TTS sudah cukup, dan opsional
kalau ingin logat yang bisa diarahkan (Gemini) atau suara berbayar (OpenAI).

1. Opsional, ambil kunci gratis:
   - **Gemini** — <https://aistudio.google.com/apikey> (tanpa billing)
   - **ElevenLabs** — <https://elevenlabs.io/app/settings/api-keys>

   Kalau `GEMINI_API_KEY` sudah diisi untuk fitur chat, tidak ada yang perlu
   ditambahkan — text-to-sound langsung ikut memakainya.
2. Isi `backend/.env` bila ingin provider selain Edge:

   ```env
   # Tanpa kunci API — suara Indonesia bawaan Microsoft (MP3).
   # Tidak perlu diisi apa pun; ini yang dipakai otomatis di mesin kosong.

   # Suara Indonesia, gratis, logat bisa diatur (kunci yang sama dengan chat)
   GEMINI_API_KEY=...
   # Cadangan/alternatif gratis lain (bila tidak ingin bergantung Edge)
   ELEVENLABS_API_KEY=sk_...
   # Opsional, semuanya punya default:
   # SOUND_PROVIDER=gemini            # gemini | edge | elevenlabs | openai | none
   # SOUND_FALLBACK_PROVIDER=edge
   # GEMINI_TTS_MODEL=gemini-3.1-flash-tts-preview
   # ELEVENLABS_MODEL=eleven_multilingual_v2
   # ELEVENLABS_VOICE_ID=             # paksa voice tertentu (opsional)
   # SOUND_REQUEST_TIMEOUT_MS=120000
   # EDGE_TTS_WSS_URL=                # hanya bila Microsoft memindahkan endpointnya
   ```

3. Restart backend, lalu buka `/health` (di luar production) dan pastikan:

   ```bash
   curl -s http://localhost:3000/health | python3 -m json.tool | grep -i sound
   # Tanpa kunci suara sama sekali:
   # "soundProvider": "edge",
   # "soundFallback": "none",      (rantainya hanya berisi satu provider)
   # "soundProviders": { ..., "edge": "configured", "gemini": "missing" },
   # "soundVoices": ["id-ID-GadisNeural", "id-ID-ArdiNeural"],
   # "soundReady": true,
   #
   # Dengan GEMINI_API_KEY:
   # "soundProvider": "gemini",
   # "soundFallback": "edge",
   # "soundVoices": ["Kore", "Puck", ...],
   ```

   Di produksi blok `services` tidak ditampilkan (isinya detail infrastruktur).
   Yang tersedia hanyalah baris log saat boot:

   ```
   Provider suara: gemini > edge (gemini=configured edge=configured ...)
   Provider suara: edge (gemini=missing ... edge=configured)   # tanpa kunci apa pun
   ```

4. Buka halaman `/tools/text-to-sound` dan pastikan dropdown **voice** berisi
   voice provider yang aktif (`id-ID-GadisNeural`, `id-ID-ArdiNeural` untuk Edge;
   `Kore`, `Puck`, … untuk Gemini; `Rachel`, `Adam`, … untuk ElevenLabs). Daftar
   itu berasal dari `GET /media/sound-voices` — kalau isinya tidak berubah setelah
   mengganti provider, halaman perlu dimuat ulang.
5. Uji jalur cadangannya (opsional): set `SOUND_PROVIDER=gemini` sementara kuota
   Gemini masih ada, lalu bandingkan metadata hasil di riwayat — kolom `via`
   menyebut provider yang benar-benar dipakai.

### Kalau Gemini membalas 401 walau kuncinya sudah diisi

Kunci Gemini yang **sudah dicabut/di-*revoke*** (atau kedaluwarsa) dibalas:

```
HTTP 401 — Request had invalid authentication credentials. Expected OAuth 2
access token, login cookie or other valid authentication credential.
```

Pesan itu tidak berarti salah cara pasang: kunci yang sama juga ditolak di
endpoint lain (`GET /v1beta/models`, maupun jalur OpenAI-compatible yang dipakai
fitur chat). Jadi fitur chat Gemini di aplikasi ini pun sedang tidak berjalan —
yaitu diam-diam dilayani provider chat lain (Groq). Buat kunci baru di
<https://aistudio.google.com/apikey>, isi ulang `GEMINI_API_KEY`, lalu restart
backend. Verifikasi cepat tanpa memakai kuota sintesis:

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  -H "x-goog-api-key: $GEMINI_API_KEY" \
  https://generativelanguage.googleapis.com/v1beta/models
# 200 = kunci hidup; 401 = kunci dicabut/kedaluwarsa
```

### Kuota

Audio memakai kuota **`audioGeneration`** — jatahnya sendiri, terpisah dari
`videoGeneration`. Sebelumnya keduanya berbagi satu jatah sehingga membuat video
menghabiskan kuota suara (dan sebaliknya) tanpa terlihat. Angkanya berkurang 1
hanya setelah audionya benar-benar berhasil dibuat dan tersimpan, dan kartu
`audio` di dashboard/profil menampilkannya. **Akun lama** yang belum punya field
ini tetap dilayani: `checkQuota` memakai sisa `videoGeneration` sebagai nilai
cadangan sampai kuota pertamanya terpakai, jadi tidak ada member yang tiba-tiba
terkunci 403 setelah pembaruan ini.

### Penyimpanan berkasnya

Hasilnya disimpan lewat modul penyimpanan yang sama dengan gambar. Satu detail
Cloudinary yang penting: **tidak ada kategori "audio"** di sana — berkas suara
masuk ke kategori `video`, dan referensinya disimpan sebagai
`cloudinary://video/<public_id>` supaya penghapusannya memakai kategori yang
sama. Mode `local`/S3 tidak terpengaruh.

---

## 3f. Sound-to-Text — Groq Whisper (gratis) + Gemini sebagai cadangan

Fitur **Sound to Text** (`/tools/sound-to-text`) mengubah audio menjadi teks.
Audio bisa **diunggah sebagai berkas** atau **direkam langsung dari mikrofon**.

Tiga provider tersedia, dan bedanya dengan text-to-sound penting untuk diketahui
lebih dulu:

| Provider | Model | Biaya | Dipilih lewat |
|---|---|---|---|
| **Groq** | `whisper-large-v3` | **gratis, 1.000 request/hari**, jawab < 2 detik | `STT_PROVIDER=groq` (default) |
| **Gemini** | `gemini-3.8-flash` (audio understanding) | **gratis**, kunci yang sama dengan chat/TTS | `STT_PROVIDER=gemini` / cadangan default |
| **OpenAI** | `whisper-1` (atau `gpt-4o-transcribe`) | berbayar | `STT_PROVIDER=openai` |

> ⚠️ **Tidak ada provider transkripsi yang bisa dipakai tanpa akun.** Berbeda dari
text-to-sound yang punya Edge sebagai jalur tanpa kunci, fitur ini memang tidak
jalan di mesin yang belum diisi kredensial apa pun. Permintaannya dijawab `503`
dengan pesan yang menyebut variabel yang harus diisi — bukan kegagalan senyap,
agar tidak ada yang menunggu hasil yang tidak akan pernah datang.

### Urutan default & cadangan

Tanpa `STT_PROVIDER` diisi, provider pertama yang **punya kunci** yang dipakai,
urut **Groq → Gemini → OpenAI**, dan cadangan defaultnya **Gemini**. Dua pilihan
pertama gratis, jadi akun yang sudah mengisi `GEMINI_API_KEY` untuk chat/TTS
langsung bisa memakai fitur ini tanpa variabel baru. OpenAI **tidak pernah dipakai
otomatis** karena berbayar; ia hanya melayani bila diminta eksplisit lewat
`STT_PROVIDER=openai`.

Kalau provider utama gagal **sesaat** (mis. kuota harian Groq habis → HTTP 429),
rantai otomatis mencoba cadangannya dan provider yang benar-benar melayani dicatat
di metadata serta log server. Kegagalan konfigurasi (kunci ditolak) **tidak**
ditutupi provider lain — masalah kunci harus terlihat apa adanya.

### Bahasa

Bahasa defaultnya **Indonesia** (`STT_DEFAULT_LANGUAGE`). Di halaman, kolom
**bahasa** bisa diganti ke English atau **Deteksi otomatis** (parameter bahasa
tidak dikirim, provider yang menentukan sendiri). Kolom **konteks** opsional untuk
membantu nama/istilah yang sulit (mis. "Aritonang, neural network").

### Format audio & rekaman mikrofon

Format yang diterima dari isi berkasnya: **WAV, MP3, M4A, OGG, FLAC, WEBM** (maks
25 MB). Satu detail yang menentukan di lapangan: **Gemini tidak menerima
WebM/Opus** — format yang paling sering dihasilkan `MediaRecorder`. Karena itu
rekaman mikrofon **dikonversi ke WAV di browser** sebelum dikirim, sehingga hasil
rekaman selalu bisa diproses provider mana pun. Berkas WebM yang diunggah manual
oleh user tetap diterima, dan kalau providernya Gemini ia dilewati ke provider
lain yang sanggup membacanya (bukan gagal).

### Langkah mengaktifkan

1. Ambil **satu** kunci gratis (Groq disarankan karena kuota terbesarnya):
   - **Groq** — <https://console.groq.com/keys> (tanpa kartu kredit). Kunci yang
     sama dipakai fitur chat, jadi kemungkinan sudah ada di `.env`.
   - **Gemini** — <https://aistudio.google.com/apikey>
2. Isi `backend/.env`:

   ```env
   GROQ_API_KEY=gsk_...
   # Cadangan saat kuota harian Groq habis (opsional tapi disarankan)
   GEMINI_API_KEY=...
   # Opsional, semuanya punya default:
   # STT_PROVIDER=groq                # groq | gemini | openai | none
   # STT_FALLBACK_PROVIDER=gemini
   # STT_DEFAULT_LANGUAGE=id
   # STT_REQUEST_TIMEOUT_MS=120000
   # GROQ_TRANSCRIBE_MODEL=whisper-large-v3
   # GEMINI_TRANSCRIBE_MODEL=gemini-3.8-flash
   ```

   `STT_PROVIDER=none` mematikan fiturnya tanpa menghapus kodenya.
3. Restart backend, lalu pastikan `/health` (di luar production) melaporkan siap:

   ```bash
   curl -s http://localhost:3000/health | python3 -m json.tool | grep -i speechToText
   # "speechToTextProvider": "groq",
   # "speechToTextFallback": "gemini",
   # "speechToTextProviders": { "groq": "configured", "gemini": "configured", "openai": "missing" },
   # "speechToTextReady": true,
   ```

   Di produksi blok `services` tidak ditampilkan; yang tersedia baris log saat boot:

   ```
   Provider transkripsi: groq > gemini (ready=true groq=configured gemini=configured openai=missing)
   ```
4. Buka `/tools/sound-to-text`, unggah atau rekam audio 5-15 detik, lalu tekan
   **Transcribe audio**. Pastikan teksnya muncul di panel **Latest result** dan di
   **Your transcriptions**, dan kolom `via` menyebut provider yang benar-benar
   melayani.

### Kuota

Sama seperti text-to-sound: transkripsi memakai kuota **`audioGeneration`**
(jatah yang sama dengan text-to-sound), dan angkanya berkurang 1 hanya setelah
transkripnya benar-benar berhasil. Audio yang diunggah tetap disimpan (di
penyimpanan media yang sama) supaya riwayat bisa memutarnya kembali — termasuk
rekaman yang transkripsinya gagal, sehingga user bisa mencoba ulang tanpa
mengunggah berkasnya lagi.

> Audio sintetis (nada murni) bisa dijawab provider sebagai "tidak ada teks".
> Itu bukan bug: provider transkripsi memang meminta ucapan, dan pesannya
> menjelaskannya. Uji dengan rekaman suara manusia.

---

## 3g. Text-to-Video & Image-to-Video (NaraRouter)

Fitur **Text to Video** (`/tools/text-to-video`) dan **Image to Video**
(`/tools/image-to-video`) menghasilkan video pendek lewat satu endpoint yang
sama, `POST /v1/videos` di NaraRouter, dengan model **`agnes-video-v2.0`**.

### Kenapa fitur ini berbeda: tidak ada jalur gratis

Semua fitur media lain punya jalan keluar tanpa kredensial (Pollinations untuk
gambar, Edge TTS untuk suara). Video **tidak**. Ini sudah diperiksa langsung ke
sumber masing-masing, jangan diulang dari nol tanpa alasan:

| Kandidat | Hasil pemeriksaan |
|---|---|
| **Cloudflare Workers AI** | Katalognya 65 model (teks, gambar, TTS, STT, embedding) — **tidak ada satu pun model video** |
| **Pollinations** | Punya banyak model video (Veo 3.1, Seedance, Wan, MiniMax) tetapi **semuanya `paid_only: true`**, dihargai pollen; akun gratis hanya ±1,5 pollen/minggu, dan satu-satunya model komunitasnya berstatus `down` |
| **OpenRouter Video API** | Rapi (job async + webhook) tetapi **berbayar per detik**, dan kunci OpenRouter repo ini dicabut (`docs/rotasi-kredensial.md`) |
| **Veo lewat Google API** | Butuh billing aktif di Google Cloud |

Karena itu providernya NaraRouter — kunci yang **sama** dengan text-to-image,
sehingga isi `BYNARA_API_KEY` di langkah 3b sudah cukup. Tanpa kunci itu
permintaannya dijawab `503` dengan pesan yang menyebut `BYNARA_API_KEY`, bukan
`502` "coba lagi".

### 1. Pastikan kuncinya ada

```bash
BYNARA_API_KEY=sk-nry-...
```

Model video `agnes-video-v2.0` masuk paket langganan NaraRouter (bukan
bayar-per-pakai), jadi pastikan paket/saldo akun Anda memuatnya —
`GET https://router.bynara.id/api/pricing` menandainya dengan
`"supports_video_generation": true`.

### 2. Verifikasi konfigurasi

```bash
curl -s http://localhost:3000/health | python3 -m json.tool | grep -i video
# "videoProvider": "bynara",
# "videoFallback": "none",
# "videoProviders": { "bynara": "configured" },
# "videoModels": { "bynara": "agnes-video-v2.0" },
# "videoReady": true,
```

Di produksi blok `services` tidak ditampilkan; yang tersedia baris log saat boot:

```
Provider video: bynara (ready=true bynara=configured)
```

`videoReady: false` berarti `BYNARA_API_KEY` belum sampai ke proses — bukan soal
modelnya (sama seperti sound-to-text, ini fitur yang benar-benar bisa mati).

### 3. Uji dari halaman

Buka `/tools/text-to-video`, tulis satu adegan, lalu tekan **Generate video**.
Yang benar akan terjadi:

1. Tombol berubah menjadi `Generating... Ns` dan panel **Rendering** muncul —
   endpointnya membalas `202` segera, bukan hasilnya.
2. Setelah 1-5 menit, panel **Latest result** terisi sendiri dengan pemutar video
   dan tautan **Download video**. Tidak perlu memuat ulang halaman.
3. Kuota **`videoGeneration`** berkurang 1 (lihat chip **sisa video** di kanan
   atas). Ia **tidak** berkurang kalau pembuatannya gagal.

### Pengaturan yang bisa diubah

| Variabel | Default | Kegunaan |
|---|---|---|
| `VIDEO_PROVIDER` | provider pertama yang punya kunci (`bynara`) | `none` mematikan fiturnya |
| `VIDEO_FALLBACK_PROVIDER` | `none` | belum ada provider video lain yang terpasang |
| `BYNARA_VIDEO_MODEL` | `agnes-video-v2.0` | alias model video |
| `VIDEO_RESOLUTION` | `720p` | `720p` / `1080p` saja |
| `VIDEO_DURATION` | `5` | durasi awal dalam detik (3-15); user bisa memilih 3-15 di UI |
| `VIDEO_RATIO` | `16:9` | hanya untuk text-to-video |
| `VIDEO_JOB_TIMEOUT_MS` | `600000` | batas total satu pekerjaan |
| `VIDEO_POLL_INTERVAL_MS` | `5000` | jeda antar pemeriksaan status |

> **480p tidak akan muncul** walau lebih murah. Dokumentasi NaraRouter hanya
> mendukung 720p dan 1080p; menawarkan nilai yang pasti ditolak provider hanya
> berubah menjadi kegagalan setelah user menunggu satu menit.
>
> **`GET /api/v1/media/video-options`** melayani daftar mode/resolusi/durasi/limit
> ke kedua halaman video, jadi aturan yang ditampilkan ke user selalu sama dengan
> yang divalidasi server.

### Cara kerjanya (dan kenapa berbeda dari fitur lain)

Endpoint videonya **asinkron**: `POST /v1/videos` membalas `202` dengan `id`, lalu
statusnya diperiksa lewat `GET /v1/videos/{id}` sampai `succeeded` (rata-rata
1-5 menit), baru berkasnya diunduh. Backend ini memantau pekerjaan itu **di latar
belakang** — permintaan dari browser tidak ditunggu. Efeknya terlihat di UI:
record-nya dibuat berstatus `processing`, dan halaman web memolling riwayat
sampai record itu menjadi `completed`/`failed`. Kalau kontainer backend
di-restart di tengah pekerjaan, record itu berhenti di `processing`; halaman
berhenti memolling sendiri setelah ±12 menit.

Untuk **image-to-video**, gambar diunggah sebagai `multipart/form-data` pada field
`image` (dokumentasi NaraRouter membedakan JSON untuk t2v dan multipart untuk
i2v), dan provider memakai gambar itu sebagai frame **pertama** — jadi bentuk
videonya mengikuti gambar, bukan `ratio` yang dikirim. Halaman web memperkecil
gambar ke maks 1280px di browser; server menolak di atas 1920px atau 8 MB.

> Biayanya nyata: satu video = satu pekerjaan berbayar di NaraRouter. Kunci yang
> sama juga dipakai text-to-image, jadi kegagalan karena saldo habis akan muncul
> sebagai `PROVIDER_UNPAID` di log backend.

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
| `auth/unauthorized-domain` | Domain belum diizinkan. Tambahkan `localhost`, `ai-multimodal-app.vercel.app`, `maubuatapa.my.id`, dan `www.maubuatapa.my.id` di Firebase Console → Authentication → Settings → **Authorized domains**. |
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
| Kredensial terlanjur ter-commit ke git | Menghapus berkasnya dari commit berikutnya tidak cukup — isinya tetap bisa dibaca dari riwayat. Kredensial harus **dirotasi di provider**, lihat [`rotasi-kredensial.md`](./rotasi-kredensial.md). |

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
