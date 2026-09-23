# Variabel Env Produksi (Railway) & Cara Verifikasinya

Service: **`ai-multimodal-app`** · Environment: **`production`** · URL:
`https://ai-multimodal-app-production.up.railway.app`

Dokumen ini menjawab dua hal: **apa yang wajib diisi**, dan **bagaimana
membuktikan bahwa nilainya benar-benar aktif** — bukan sekadar "build hijau".
Tiga kegagalan nyata di repo ini (CORS diblokir, penyimpanan `local`, gambar
hilang tiap deploy) semuanya terjadi sambil CI tetap hijau.

Cara membaca tabel: kolom **akibat kalau salah** adalah gejala yang benar-benar
pernah muncul, supaya mudah dicocokkan saat produksi bermasalah.

---

## A. Wajib — tanpa ini aplikasi mati atau rusak

| Variabel | Nilai | Akibat kalau kosong/salah | Cara verifikasi |
|---|---|---|---|
| `NODE_ENV` | `production` | `trust proxy` tidak aktif sehingga `req.ip` berisi IP proxy: **semua pengunjung berbagi satu hitungan rate limit** → 429 massal. Route `dev-login` juga ikut hidup (siapa pun bisa membuat token). | `POST /api/v1/auth/dev-login` harus menjawab **404** |
| `MONGODB_URI` | `mongodb+srv://…` | `server.js` memanggil `process.exit(1)` saat connect gagal → tidak ada satu pun endpoint yang naik | `/health` → `"database":"connected"` |
| `JWT_SECRET` | `openssl rand -base64 32` | verifikasi token gagal; endpoint auth menjawab `JWT_SECRET is not set. Isi backend/.env terlebih dahulu.` | login dari UI berhasil, `/health` → `"status":"OK"` |
| `FRONTEND_URL` | `https://ai-multimodal-app.vercel.app,https://maubuatapa.my.id,https://www.maubuatapa.my.id` (beberapa domain dipisah koma) | browser memblokir **setiap** panggilan API sebagai CORS error, padahal backend menjawab 200 | header `access-control-allow-origin` memuat domain yang sedang dibuka |
| `CLOUDINARY_URL`<br>*(atau ketiga variabel `CLOUDINARY_CLOUD_NAME` + `CLOUDINARY_API_KEY` + `CLOUDINARY_API_SECRET`)* | satu baris *API Environment variable* dari dashboard Cloudinary: `cloudinary://<api_key>:<api_secret>@<cloud_name>` | **Kalau kosong:** mode penyimpanan jatuh ke `local`: container diganti tiap deploy → **gambar user hilang tanpa satu pun error**, record tetap ada dan tampil sebagai gambar rusak. **Kalau terisi tapi salah:** mode terbaca `cloudinary` sementara **setiap upload ditolak provider** — job deploy juga sengaja gagal. **Kenapa satu nilai:** dengan tiga variabel terpisah, key+secret dari satu Product Environment bisa dipasangkan dengan cloud name dari environment lain, dan hasilnya `401 Invalid cloud_name` yang sulit dilacak. | `/health` → `"storageMode":"cloudinary"` **dan** `"storageCheck":"ok"` (lihat catatan di bawah) |
| `FIREBASE_SERVICE_ACCOUNT` | isi JSON service account dalam satu baris, atau path berkas | login Google tidak bisa dipakai (`auth/…` gagal) | login Google dari frontend produksi |

> Alternatif Cloudinary: `STORAGE_PROVIDER=s3` + `S3_ENDPOINT`, `S3_BUCKET`,
> `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_BASE_URL`
> (+ `S3_REGION`, `S3_FORCE_PATH_STYLE` bila perlu) → `/health` harus
> melaporkan `"storageMode":"s3"`. **Jangan** menyetel
> `STORAGE_PROVIDER=local` di produksi.

---

## B. Wajib untuk fitur AI (satu key per fitur)

| Fitur | Variabel | Cara verifikasi |
|---|---|---|
| Chat | minimal **satu** dari `GROQ_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY` | kirim satu pesan di UI; setiap balasan menampilkan provider yang benar-benar menjawab (mis. `via groq`, `via openrouter`) |
| Chat — cadangan OpenRouter | `OPENROUTER_API_KEY` | badge `via openrouter` muncul saat Groq/Gemini kehabisan kuota. Tanpa key ini provider hanya dilewati, bukan error. |
| Text-to-Image | `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` (fallback `pollinations` tidak butuh key) | generate 1 gambar; metadata hasil menampilkan provider yang dipakai |
| Image-to-Image | kredensial Cloudflare yang sama (FLUX.2 [klein]) | unggah + edit 1 gambar; hasilnya benar-benar mengikuti gambar input |
| Text-to-Sound | **tidak wajib apa pun** — Edge TTS (suara Indonesia, tanpa kunci API) sudah melayani. Opsional: `GEMINI_API_KEY` (logat bisa diarahkan, gratis tanpa billing) + `ELEVENLABS_API_KEY` | generate 1 audio di `/tools/text-to-sound`; log boot menampilkan `Provider suara: gemini > edge (...)`. Tanpa kunci apa pun halaman tetap berfungsi (Edge, MP3). |

> Kode OpenRouter baru ada di commit `feat(chat): tambah OpenRouter…`.
> Key-nya **baru relevan setelah commit itu ter-deploy**; mengisinya lebih dulu
> tidak ada salahnya, tetapi tidak akan mengubah apa pun sebelum deploy selesai.

---

## C. Opsional (tuning — semuanya punya default di kode)

| Variabel | Default | Guna |
|---|---|---|
| `CHAT_PROVIDER` / `CHAT_FALLBACK_PROVIDER` | provider pertama yang punya key, urut `groq → gemini → openai → openrouter` | memaksa urutan provider; cadangan boleh beberapa nama dipisah koma (`gemini,openrouter`) |

> `CHAT_FALLBACK_PROVIDER` mengatur **urutan** cadangan, bukan membatasinya:
> nama yang ditulis dicoba lebih dulu, lalu provider lain yang key-nya sudah
> diisi ikut di belakangnya. Jadi `gemini` saja tetap menghasilkan
> `groq → gemini → openrouter` begitu `OPENROUTER_API_KEY` ada — menambah key
> selalu berefek. Satu-satunya nilai yang mematikan cadangan adalah `none`.
>
> (Perilaku ini berubah di commit `feat(chat): provider berkey selalu jadi
> cadangan`. Sebelumnya daftar dihormati **persis**, sehingga key baru tidak
> berefek sampai daftar lama ikut disunting.)
| `OPENROUTER_CHAT_MODEL` | 4 model gratis berurutan (lihat docs bagian 3c) | daftar model OpenRouter; dicoba berurutan |
| `OPENROUTER_REASONING` | `off` | `off` / `exclude` / `default` — mematikan jejak berpikir |
| `OPENROUTER_FAILURE_COOLDOWN_MS` | `60000` | jeda sebelum model yang baru gagal dicoba lagi (`0` = selalu coba) |
| `CHAT_MAX_TOKENS` | `2000` | batas token keluaran per balasan |
| `CHAT_REQUEST_TIMEOUT_MS` | `90000` | batas waktu satu request ke provider chat |
| `IMAGE_PROVIDER` / `IMAGE_FALLBACK_PROVIDER` | `bynara` bila `BYNARA_API_KEY` ada, lalu `cloudflare`, lalu `pollinations` | urutan provider gambar |
| `BYNARA_API_KEY` | — | kunci NaraRouter (`sk-nry-`); cukup satu variabel untuk generate + unduh hasil |
| `IMAGE_REQUEST_TIMEOUT_MS` | `120000` | batas waktu request gambar |
| `IMAGE_EDIT_PROVIDER` / `IMAGE_EDIT_FALLBACK_PROVIDER` | `bynara` lalu `cloudflare` | urutan provider image-to-image; `pollinations` tidak tersedia di sini |
| `SOUND_PROVIDER` | provider pertama yang punya key, urut `gemini → elevenlabs → openai → edge` | provider text-to-sound; `none` mematikan fiturnya |
| `SOUND_FALLBACK_PROVIDER` | `edge` | provider cadangan saat provider utama gagal/kuotanya habis — jalur yang dipakai begitu kuota gratis Gemini (HTTP 429) habis. Edge dipilih sebagai default karena tidak butuh kunci, jadi cadangannya benar-benar bisa dipakai |
| `EDGE_TTS_WSS_URL` | endpoint Read Aloud Edge | alamat WebSocket provider Edge; diisi hanya bila Microsoft memindahkannya |
| `SOUND_REQUEST_TIMEOUT_MS` | `120000` | batas waktu satu request sintesis suara |
| `GEMINI_TTS_MODEL` | `gemini-3.1-flash-tts-preview` | model Gemini TTS (status preview). Hanya model ini yang dipakai untuk permintaan WAV karena backend membungkus PCM-nya sendiri |
| `ELEVENLABS_MODEL` | `eleven_multilingual_v2` | model ElevenLabs; ini yang mendukung Bahasa Indonesia |
| `ELEVENLABS_VOICE_ID` | — | paksa satu ID voice ElevenLabs. Tanpa ini, ID dibaca dari akun pemilik kunci (`GET /v1/voices`) karena daftar voice bawaan berbeda antar akun |
| `OPENAI_TTS_MODEL` | `gpt-4o-mini-tts` | model OpenAI TTS (berbayar, tidak dipakai otomatis). Hanya model `gpt-4o-*` yang menerima `instructions`, jadi pada `tts-1`/`tts-1-hd` deskripsi gaya diabaikan |
| `PUBLIC_BASE_URL` | — | hanya untuk menyusun tautan berkas di penyimpanan lokal; provider gambar tidak memakainya |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` | 15 menit / 1000 | jaring pengaman terhadap penyalahgunaan |
| `UPLOAD_DIR` | `uploads` | lokasi berkas sementara (mode `local`) |
| `PORT` | diisi Railway | jangan diubah manual |
| Model per provider | lihat `backend/.env.example` | `GROQ_CHAT_MODEL`, `GEMINI_CHAT_MODEL`, `CLOUDFLARE_IMAGE_MODEL`, `CLOUDFLARE_EDIT_MODEL`, `POLLINATIONS_MODEL`, `BYNARA_IMAGE_MODEL`, `OPENAI_*` |

---

## D. Kalau nilai variabel harus diganti (rotasi)

Mengganti nilai di Railway **memicu deploy ulang otomatis** untuk service itu,
jadi tidak perlu men-deploy ulang secara manual. Untuk rotasi API key, urutan
"terbitkan baru → pasang → verifikasi → cabut yang lama" membuat peralihan
berjalan tanpa downtime; `JWT_SECRET` tidak bisa begitu karena token hanya punya
satu penandatangan (semua sesi lama langsung mati).

```bash
# Ganti satu variabel lalu tunggu deploy selesai. Nilai lewat stdin supaya tidak
# masuk ke daftar argumen proses maupun riwayat shell.
openssl rand -base64 32 | railway variable set JWT_SECRET --stdin \
  --service ai-multimodal-app --environment production --project "$PROJECT"
```

> `railway variable list --json` mencetak **nilai** setiap variabel, bukan hanya
> namanya — jangan dijalankan di CI atau di terminal yang output-nya disimpan.
> Untuk memeriksa apakah sebuah key sudah terbaca proses tanpa membocorkan
> isinya, pakai log startup Railway (lihat bagian provider chat di bawah).

Langkah lengkap per kredensial (termasuk dari mana tiap kunci diambil, cara
verifikasinya, dan cara memastikan kunci lama benar-benar mati) ada di
[`rotasi-kredensial.md`](./rotasi-kredensial.md).

---

## Verifikasi cepat setelah deploy

Jalankan dari mesin mana pun (tidak ada nilai rahasia yang tercetak):

```bash
B=https://ai-multimodal-app-production.up.railway.app

# 1. Backend hidup + database + penyimpanan + kredensial penyimpanannya
curl -s $B/health
#    {"status":"OK",...,"database":"connected","storageMode":"cloudinary","storageCheck":"ok"}
#
#    Dua kolom ini menjawab dua hal berbeda dan keduanya harus bagus:
#      storageMode  = mode apa yang dipakai            -> local | cloudinary | s3
#      storageCheck = apakah kredensialnya BERLAKU     -> pending | ok | failed | skipped
#      commit       = kode VERSI APA yang sedang live    -> SHA git; null bila penandanya
#                     tidak terbaca (lihat "Kode versi apa yang sedang live" di bawah)
#    Nilai yang salah tulis tetap membuat storageMode terbaca `cloudinary`,
#    karena pemeriksaan konfigurasi hanya bertanya "apakah variabelnya kosong".
#
#    Kalau pemeriksaannya gagal, ada satu kolom tambahan yang menyebut sebabnya:
#      {"storageMode":"cloudinary","storageCheck":"failed","storageCheckReason":"HTTP 401"}
#    `HTTP 401`/`403` berarti nilainya salah (atau sudah dicabut), `timeout`
#    berarti providernya tidak menjawab — dua hal dengan perbaikan berbeda.
#    Isinya KODE, bukan pesan provider: pesan aslinya memuat nama cloud/bucket,
#    sedangkan `/health` ini publik.

# 2. NODE_ENV benar-benar production (route dev wajib mati)
curl -s -o /dev/null -w '%{http_code}\n' -X POST $B/api/v1/auth/dev-login -d '{}'
#    404

# 3. CORS mengizinkan frontend yang sedang dipakai
for O in https://ai-multimodal-app.vercel.app https://maubuatapa.my.id https://www.maubuatapa.my.id; do
  curl -s -D - -o /dev/null -H "Origin: $O" "$B/health" \
    | grep -i access-control-allow-origin
done
#    access-control-allow-origin: <origin yang sedang diuji>

# 4. Origin asing tetap ditolak (tidak boleh ada header di atas)
curl -s -D - -o /dev/null -H 'Origin: https://situs-asing.example' $B/health \
  | grep -i access-control-allow-origin || echo 'ditolak (benar)'
#    ditolak (benar)
```

Hasil keempat perintah di atas terakhir diukur **17 September 2026** dan
semuanya sesuai harapan. Setelah mengubah variabel di Railway, tunggu deploy
ulang selesai baru jalankan verifikasi ini.

### Gejala → penyebab

| Gejala di produksi | Penyebab yang paling sering |
|---|---|
| Browser: `blocked by CORS policy` | `FRONTEND_URL` tidak memuat hostname yang sedang dibuka; setelah deploy kode terbaru, tiga domain aplikasi di-whitelist bawaan, tetapi tetap isi `FRONTEND_URL` agar konfigurasi eksplisit |
| Gambar hasil generate hilang tiap deploy | penyimpanan `local` → `CLOUDINARY_URL`/`CLOUDINARY_*` (atau `S3_*`) belum lengkap |
| `storageMode` jatuh ke `local` padahal `CLOUDINARY_URL` sudah diisi | `storageCredentialSource` bernilai `url-invalid`: variabelnya ada tetapi bentuknya tidak terbaca (mis. titik dua berlebih setelah skema, atau bagian nama cloud kosong). Bentuk yang benar: `cloudinary://<api_key>:<api_secret>@<cloud_name>`. |
| Generate gambar selalu gagal padahal `/health` bilang `cloudinary` | `storageCheck` bernilai `failed`: kredensialnya terisi tetapi **ditolak provider** (salah salin, sudah dicabut, atau placeholder). Sebabnya dibaca dari `storageCheckReason` di `/health`: `HTTP 401`/`403` = nilainya salah, `timeout` = provider tidak menjawab. **Kalau 401-nya dari Cloudinary:** `api_key` dan `api_secret` biasanya sudah benar — yang salah `CLOUDINARY_CLOUD_NAME`. Cara tercepat menghilangkan seluruh kelas kesalahan ini: pakai satu nilai `CLOUDINARY_URL`, lalu pastikan `storageCredentialSource` di `/health` bernilai `url`. Langkahnya ada di `docs/setup-kredensial.md`. |
| Banyak user kena 429 bersamaan | `NODE_ENV` bukan `production` → hitungan rate limit memakai IP proxy |
| `POST /auth/dev-login` menjawab 200 | `NODE_ENV` belum `production` — **segera perbaiki**, ini membuka pembuatan token tanpa login |
| User melaporkan `Image generation failed. Please try again.` padahal tidak ada gambar yang tersimpan | sejak pemeriksaan penyimpanan ditambahkan, **kegagalan konfigurasi penyimpanan tidak lagi memakai pesan itu**: user menerima `503` berisi `Media storage is not configured correctly on the server … Retrying will not help`. Kalau pesan "coba lagi" masih muncul, penyebabnya bukan konfigurasi penyimpanan — cek record berstatus `failed` di koleksi media dan baris `Text-to-image error:` di log Railway. |
| Chat: `AI service temporarily unavailable` | tidak ada satu pun key provider chat yang valid |
| Chat: balasan bilang cadangannya cuma dua provider, padahal `OPENROUTER_API_KEY` sudah diisi | key-nya belum terbaca proses — cek baris `Provider chat:` di log startup Railway (`openrouter=missing` berarti variabelnya belum sampai ke service) |
| Balasan chat memuat teks "Here's a thinking process:" | model reasoning dipakai dengan `OPENROUTER_REASONING=default`; set `off` |
| Semua user tiba-tiba diminta login ulang, token lama menjawab 401 | `JWT_SECRET` baru saja dirotasi. Ini perilaku yang benar — token lama memang tidak lagi ditandatangani oleh secret yang aktif. |
| Setelah mengganti API key, fitur masih memakai key lama | deploy ulang belum selesai, atau key dipasang di service/environment yang bukan `ai-multimodal-app`/`production`. Cek baris `Provider chat:` di log startup. |

### Kenapa status provider tidak terlihat di `/health` produksi

`/health` sengaja **hanya** melaporkan `status`, `database`, `storageMode`,
`storageCheck` (+ `storageCheckReason` saat gagal), `commit` (+ `commitSource`),
dan `storageCredentialSource` saat `NODE_ENV=production`; objek `services` (daftar
provider gambar & chat) hanya muncul di development/test supaya info
infrastruktur tidak dibocorkan ke repo publik. Kolom penyimpanan tetap
dilaporkan karena mode `local` dan kredensial yang ditolak keduanya **merusak
data user secara diam-diam**, dan `storageCredentialSource` hanya berisi nama
variabel — bukan nilainya. Kolom `commit` juga tidak membocorkan apa pun (SHA
git repo ini sudah publik), dan tanpanya job deploy tidak bisa membedakan kode
baru dari kode lama. Karena itu verifikasi provider chat di produksi dilakukan
lewat:

1. **badge provider di UI chat** — setiap balasan menyimpan dan menampilkan
   provider yang benar-benar menjawab (`via groq`, `via openrouter`, …); atau
2. **log startup Railway** (Deploy Logs / service logs), yang mencetak rantai
   dan status tiap key tepat di bawah baris mode penyimpanan:

   ```
   Penyimpanan media: mode=cloudinary, kredensial dari CLOUDINARY_URL
   Provider chat: groq > gemini > openrouter (groq=configured gemini=configured openai=missing openrouter=configured)
   ```

   Bagian `kredensial dari …` menjawab "konfigurasi ini dibaca dari
   `CLOUDINARY_URL` atau dari tiga variabel `CLOUDINARY_*`?" — dua konfigurasi
   yang berperilaku sama saat benar dan berbeda saat salah.

   Baris kedua itu menjawab langsung "apakah key OpenRouter sudah terbaca
   proses?": kalau tertulis `openrouter=missing` maka variabelnya belum sampai
   ke service ini (nama salah tulis, dipasang di service/environment lain, atau
   container belum restart) — bukan soal modelnya. Kalau `openrouter=configured`,
   namanya pasti muncul juga di rantai (`groq > … > openrouter`). Nilainya hanya
   `configured`/`missing`, tidak pernah memuat isi key.

### Kode versi apa yang sedang live (`commit`)

Kolom `commit` menjawab pertanyaan yang berbeda dari semua kolom di atas: bukan
"apakah konfigurasinya benar", melainkan "kode **versi apa** yang sedang
melayani user". Dua jalur deploy membawa penandanya dengan cara berbeda:

| `commitSource` | Dari mana nilainya |
|---|---|
| `railway-git` | Railway mengisi `RAILWAY_GIT_COMMIT_SHA` untuk deployment yang berasal dari **integrasi GitHub** (setiap push ke `main`) |
| `build-meta` | dari `backend/build-meta.json` yang ditulis job CI tepat sebelum `railway up` — jalur CLI mengunggah direktori lokal, jadi tidak ada metadata git yang bisa dibaca |

`commit: null` berarti tidak ada satu pun sumber yang terbaca (mis. deployment
dibangun dari mesin lokal tanpa penanda). Ini bukan kegagalan: job deploy hanya
memberi `::warning::` saat penandanya tidak dilaporkan, dan **gagal** saat
nilainya ada tetapi berbeda dari commit yang baru di-push — karena itu berarti
deploy-nya belum selesai atau kode lama yang masih live.

```bash
curl -s https://ai-multimodal-app-production.up.railway.app/health | python3 -m json.tool | grep -E '"commit"|"commitSource"'
#    "commit": "56e1648641c4a7cd9a534f6339742021f319fc7c",
#    "commitSource": "railway-git",
#
# Cocokkan dengan commit yang seharusnya live:
#    git rev-parse HEAD
```
