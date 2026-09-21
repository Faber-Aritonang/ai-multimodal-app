# Rotasi Kredensial — `backend/.env.save.1`

Dokumen ini adalah daftar langkah untuk mengganti kredensial yang ter-commit di
`backend/.env.save.1`. Ditulis karena berkas itu sudah masuk riwayat git dan
**tidak bisa "dibatalkan"** — selama kredensial di dalamnya belum dirotasi, isi
repo sudah cukup untuk memakai layanan berbayar/akun atas nama pemiliknya.

Bacaan terkait: [`env-produksi-railway.md`](./env-produksi-railway.md) (variabel
produksi), [`setup-kredensial.md`](./setup-kredensial.md) (setup lokal),
[`secrets-setup.md`](./secrets-setup.md) (secret GitHub Actions).

---

## A. Apa yang bocor, dan apa yang tidak

Dua berkas terlibat, keduanya dengan daftar kunci yang **identik** (sudah
dibandingkan, tidak ada beda):

| Berkas | Keberadaannya sekarang | Ditambahkan | Dihapus |
|---|---|---|---|
| `backend/.env.save` | hanya di riwayat | sebelum `0788a58` | `0788a58` (2026-09-21 01:30) |
| `backend/.env.save.1` | **masih ter-track di HEAD** | `2ad0e63` (2026-09-21 01:04) | belum |

Karena penghapusan berkas hanya menghapus salinan di commit berikutnya, **isi
`.env.save` tetap bisa dibaca siapa pun dari riwayat** (`git show 0788a58^:backend/.env.save`).
Jadi keduanya dihitung sebagai bocor.

### Isi per kunci

| Kunci | Isi yang bocor | Perlu dirotasi? |
|---|---|---|
| `GROQ_API_KEY` | nilai asli, berawalan `gsk_` | **Ya — kunci ini terbukti masih hidup** |
| `OPENROUTER_API_KEY` | nilai asli, 73 karakter, berawalan `sk-or-v1-` | Tidak — ditolak `401 User not found` saat diuji |
| `JWT_SECRET` | nilai asli, 44 karakter (base64 dari 32 byte) | Verifikasi dulu; produksi sudah bukan nilai ini |
| `GEMINI_API_KEY` | nilai asli, 46 karakter | Tidak — tidak berhasil diautentikasi saat diuji |
| `CLOUDFLARE_API_TOKEN` | nilai asli, 53 karakter | Tidak — sudah tidak berlaku saat diuji |
| `CLOUDFLARE_ACCOUNT_ID` | 32 karakter hex | Tidak wajib (identifier, bukan rahasia) |
| `MONGODB_URI` | `mongodb://localhost…` **tanpa** `user:password` | Tidak ada (lihat catatan) |
| `FIREBASE_SERVICE_ACCOUNT` | hanya **path**: `./config/firebase-service-account.json` | Tidak ada (bukan kunci) |
| `OPENAI_API_KEY` | kosong | Tidak ada |
| `FRONTEND_URL`, `NODE_ENV`, `PORT`, `UPLOAD_DIR`, `RATE_LIMIT_*`, `OPENROUTER_CHAT_MODEL` | konfigurasi | Tidak ada |

### Hasil pemeriksaan langsung (21 September 2026)

Setiap kunci diuji ke providernya masing-masing dengan permintaan **read-only**
(tidak ada yang dibuat, diubah, atau dihapus):

| Kunci | Uji | Hasil | Artinya |
|---|---|---|---|
| `GROQ_API_KEY` | `GET api.groq.com/openai/v1/models` | **200** | **masih hidup** — siapa pun yang bisa membaca repo ini bisa memakai kuota Groq akun tersebut |
| `OPENROUTER_API_KEY` | `GET openrouter.ai/api/v1/key` | 401 `User not found` | tidak bisa dipakai (kunci dicabut atau akunnya sudah tidak ada) |
| `GEMINI_API_KEY` | `GET generativelanguage.googleapis.com/v1beta/models` | 401 | tidak berhasil diautentikasi |
| `CLOUDFLARE_API_TOKEN` | `GET api.cloudflare.com/client/v4/user/tokens/verify` | 401 `Invalid API Token` | sudah tidak berlaku |
| nilai `JWT_SECRET` dari berkas ini | JWT HS256 → `GET /api/v1/member/profile` produksi | 401 `Invalid token` | `JWT_SECRET` produksi bukan nilai ini |

```bash
# Cara mengulang pemeriksaan di atas (nilai dibaca dari berkas, tidak dicetak)
GROQ=$(grep -m1 '^GROQ_API_KEY=' backend/.env.save.1 | cut -d= -f2-)
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $GROQ" \
  https://api.groq.com/openai/v1/models
#    200 = masih hidup, 401 = sudah dicabut
```

Kesimpulan praktis: hanya **satu** kunci dari berkas ini yang masih menjadi
lubang aktif, yaitu `GROQ_API_KEY`. Itu yang harus ditangani lebih dulu; sisanya
sudah tidak berbahaya dan pengerjaannya bisa menyusul.

### Perhatian: berkas ini rusak, dua barisnya tergabung

Baris 48 tidak berisi satu variabel. Nilai `GEMINI_API_KEY` langsung disambung
`OPENROUTER_API_KEY=…` **tanpa baris baru**:

```
GEMINI_API_KEY=<46 karakter>OPENROUTER_API_KEY=sk-or-v1-…
```

Akibatnya nyata dan sudah pernah terjadi di dokumen ini sendiri:

- Inventaris pertama melewatkan `OPENROUTER_API_KEY`, karena pencarian pola
  `^KEY=` hanya melihat variabel di awal baris.
- Uji pertama `GEMINI_API_KEY` mengirim 138 karakter gabungan dua kunci, jadi
  hasil `401`-nya tidak membuktikan apa pun. Angka pada tabel di atas sudah
  memakai nilai yang sudah dipisah dengan benar.

Jadi jangan mengambil nilai apa pun dari berkas ini dengan asumsi satu baris =
satu variabel. Pisahkan dulu, dan periksa panjangnya wajar untuk provider yang
bersangkutan.

### Perbandingan langsung dengan variabel produksi (21 September 2026)

Dijalankan terhadap service yang sebenarnya — project `truthful-imagination`,
service `ai-multimodal-app`, environment `production` — dengan nilai
dibandingkan **di dalam skrip**, sehingga tidak ada satu pun nilai yang tercetak.
Service itu punya 24 variabel; 21 nama dari berkas bocor dicocokkan satu per satu.

| Variabel dari berkas bocor | Di produksi | Tindakan |
|---|---|---|
| `GROQ_API_KEY` | BEDA | rotasi selesai ✅ |
| `JWT_SECRET` | BEDA | tidak perlu diganti ✅ |
| `MONGODB_URI` | BEDA | tidak perlu diganti ✅ |
| `FIREBASE_SERVICE_ACCOUNT` | BEDA | tidak perlu diganti ✅ |
| `FRONTEND_URL`, `NODE_ENV` | BEDA | bukan rahasia |
| `OPENROUTER_API_KEY` | **SAMA** | satu-satunya nilai bocor yang masih terpasang — lihat di bawah |
| 14 nama lain (lihat catatan) | tidak ada di Railway | sebagian punya akibat fungsional |

**`OPENROUTER_API_KEY` adalah satu-satunya yang masih cocok**, dan kuncinya sudah
mati — diuji ulang: `401 User not found`. Jadi tidak ada paparan, tetapi ada dua
akibat yang perlu diketahui: cadangan chat OpenRouter tidak pernah bekerja, dan
menggantinya dengan kunci baru akan memulihkannya. Membiarkannya berarti chat
hanya punya jalur Groq.

**14 nama yang tidak ada di Railway, per akibarnya:**

- `GEMINI_API_KEY` — dipakai `config/chatProviders.js`. Tidak ada di produksi
  berarti cadangan chat **Gemini memang tidak tersedia**.
- `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `OPENAI_API_KEY` — dipakai
  `config/imageProviders.js`. Tidak ada berarti provider gambar itu mati dan
  hanya Pollinations (tanpa API key) yang jalan.
- `PORT`, `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS`, `UPLOAD_DIR`,
  `OPENROUTER_CHAT_MODEL`, `OPENAI_CHAT_MODEL` — semuanya punya nilai bawaan di
  kode, dan `PORT` disuntikkan platform sendiri. Aman.
- `ADMIN_EMAIL`, `ADMIN_UID`, `ADMIN_NAME` — hanya dipakai
  `scripts/createAdmin.js`, bukan oleh server.

Catatan penting dari tabel di atas:

- **`JWT_SECRET` adalah yang paling berbahaya *kalau* masih dipakai.** Backend
  memakainya untuk menandatangani token login, jadi siapa pun yang memegang
  nilai ini bisa membuat token sah untuk akun mana pun tanpa pernah login.
  **Hasil ukur 21 September 2026:** token yang ditandatangani dengan nilai dari
  berkas ini **ditolak** oleh produksi
  (`GET /api/v1/member/profile` → `401 Invalid token`), yang berarti
  `JWT_SECRET` di Railway sudah **bukan** nilai bocor ini. Jadi lubang "siapa
  pun bisa membuat token" sedang tidak terbuka di produksi. Tetap pastikan
  lewat tab Variables, karena nilai yang sama bisa saja dipakai di environment
  lain (mis. `.env` lokal yang dipakai bersama).
- **`MONGODB_URI` yang bocor adalah database lokal**, bukan Atlas. Tidak ada
  password di dalamnya, jadi tidak ada yang perlu dirotasi. Tapi wajib
  dipastikan: nilai `MONGODB_URI` di service Railway **bukan** string yang sama.
  Nilai yang bocor berbentuk `mongodb://localhost…` tanpa `user:password`,
  sedangkan produksi harus `mongodb+srv://…@…mongodb.net`. Periksa lewat
  Railway → service `ai-multimodal-app` → tab **Variables** (tidak perlu CLI).
  Kalau ternyata sama, ganti password user Atlas lewat langkah C5.
- **`FIREBASE_SERVICE_ACCOUNT` aman.** Yang ter-commit adalah *path*-nya, bukan
  kuncinya, dan berkas `backend/config/firebase-service-account.json` sendiri
  **tidak pernah ada di riwayat git** (sudah diverifikasi dengan
  `git log --all --full-history`). Private key Firebase tidak bocor.
- **`OPENAI_API_KEY` kosong**, jadi tidak ada kredit OpenAI yang terpapar.

> Catatan tentang repo publik: komentar di `.github/workflows/deploy.yml`
> menyatakan repo ini publik. Kalau benar, kredensial di atas sudah bisa dibaca
> publik sejak **2026-09-21 01:04**, termasuk oleh bot yang memindai GitHub.
> Terapkan kecepatan rotasi sesuai asumsi itu, bukan menganggapnya internal.
> Secret GitHub Actions (`RAILWAY_TOKEN`, `VERCEL_TOKEN`, dst.) **tidak** ikut
> bocor — GitHub menyimpan secret tetap terenkripsi, dan nilainya memang tidak
> pernah ditulis di berkas ini.

---

## B. Urutan kerja (jangan diacak)

Untuk API key (Groq, Gemini, Cloudflare) ada cara yang **tanpa downtime**:

1. **Terbitkan kunci baru** di dashboard provider. Jangan cabut yang lama dulu.
2. **Pasang kunci baru di Railway** untuk service `ai-multimodal-app` →
   variabel yang diubah memicu deploy ulang otomatis.
3. **Verifikasi** fitur terkait benar-benar memakai kunci baru (bagian E).
4. **Baru cabut kunci lama** di provider. Kunci lama boleh hidup beberapa
   menit setelah deploy, itu justru yang membuat peralihan mulus.

`JWT_SECRET` tidak bisa diperlakukan begitu: token hanya punya satu
penandatangan, jadi tidak ada masa tumpang tindih. Merotasinya langsung
memutus semua sesi yang sedang berjalan dan **semua user harus login ulang**.
Itu memang konsekuensi yang diinginkan.

Cabut kunci lama satu per satu, dan pastikan key lain yang jadi cadangan sudah
terpasang lebih dulu — jangan sampai chat kehabisan seluruh provider di tengah
proses karena key Groq dan Gemini dicabut bersamaan.

---

## C. Langkah per kredensial

### C1. `JWT_SECRET` (paling mendesak)

Tidak ada dashboard untuk ini — nilainya dibuat sendiri.

```bash
# 1. Buat nilai baru dan langsung pasang tanpa pernah mencetaknya.
#    Nilai lewat stdin, jadi tidak masuk ke daftar argumen proses maupun
#    riwayat shell.
openssl rand -base64 32 | railway variable set JWT_SECRET --stdin \
  --service ai-multimodal-app --environment production --project "$PROJECT"

# 2. Tunggu deploy ulang selesai, lalu verifikasi (bagian E)
```

Efek samping yang harus diumumkan ke pengguna: **semua sesi lama langsung
ditolak**, semua orang login ulang. Token lama akan menjawab `401`.

### C2. `GROQ_API_KEY` — kunci yang masih hidup, kerjakan ini lebih dulu

Nilainya sudah dipastikan berlaku (`GET /openai/v1/models` → 200), jadi ini
satu-satunya tindakan di dokumen ini yang menutup lubang yang benar-benar
terbuka.

1. Buat kunci baru **sebelum** menghapus yang lama, supaya tidak ada masa
   produksi tidak punya key chat. Buka **console.groq.com** → *API Keys* →
   **Create API Key**. Beri nama yang
   menunjukkan asalnya (mis. `railway-prod-2026-09`) supaya rotasi berikutnya
   mudah ditelusuri.
2. Pasang di Railway (bagian D).
3. Verifikasi: kirim satu pesan di UI chat, pastikan badge-nya `via groq`.
4. Setelah verifikasi hijau, **hapus kunci lama** di console.groq.com.

### C3. `GEMINI_API_KEY`

> **Status terukur: nilai di berkas bocor tidak valid** (401 saat diuji), jadi
> tidak ada kunci yang perlu dicabut untuk nilai ini. Langkah di bawah tetap
> berguna kalau Gemini ingin dipakai sebagai cadangan — pastikan saja kunci yang
> terpasang di Railway bukan kunci yang gagal itu.

1. Buka **aistudio.google.com/apikey** → **Create API key**.
2. Pasang di Railway (bagian D).
3. Verifikasi: badge `via gemini` muncul saat Groq sengaja dilewati (mis. set
   `CHAT_PROVIDER=gemini` sementara), atau lihat log startup Railway.
4. Hapus kunci lama di AI Studio.

> Nilai `GEMINI_API_KEY` di berkas bocor **tidak berhasil diautentikasi** (401),
> dan panjangnya 46 karakter — bukan bentuk key Gemini yang berawalan `AIza`.
> Nilai 138 karakter yang sempat disebut di dokumen ini ternyata artefak baris
> tergabung (lihat catatan di bagian A), bukan nilai kuncinya. Karena itu jangan
> hanya "memindahkan" nilai lama ke tempat lain: **buat ulang dari AI Studio**
> dan tempel utuh dalam satu baris.

### C4. `CLOUDFLARE_API_TOKEN` (+ `CLOUDFLARE_ACCOUNT_ID`)

> **Status terukur: token di berkas bocor sudah tidak berlaku** (401
> `Invalid API Token`), jadi kemungkinan besar rotationya sudah pernah dilakukan
> atau token itu sudah dihapus. Buka halaman API Tokens untuk memastikan tidak
> ada token lain yang tidak dikenal, lalu tutup kasus ini.

Kredensial ini dipakai fitur text-to-image dan image-to-image (model FLUX.2
[Klein] lewat Workers AI).

1. Buka **dash.cloudflare.com** → *My Profile* → **API Tokens**.
2. **Delete** token yang bocor. Token Cloudflare tidak bisa diedit, jadi rotasi
   = hapus lalu buat baru.
3. **Create Token** → izin minimum yang dibutuhkan (Workers AI / akun yang
   relevan). Beri masa berlaku (*TTL*) bila tersedia.
4. Pasang `CLOUDFLARE_API_TOKEN` baru di Railway. `CLOUDFLARE_ACCOUNT_ID` tidak
   perlu diganti — ambil ulang dari halaman akun kalau lupa, itu bukan rahasia.
5. Verifikasi: generate 1 gambar, lalu 1 image-to-image. Metadata hasil
   menampilkan provider yang dipakai (harus `cloudflare`, bukan `pollinations`).

### C5. `MONGODB_URI` — biasanya tidak perlu

Yang bocor adalah URI lokal tanpa kredensial, jadi tidak ada password untuk
diganti. **Namun** kalau ternyata password user Atlas pernah tersimpan di
berkas lain yang ikut ter-commit, rotasinya:

1. MongoDB Atlas → *Database Access* → user yang dipakai aplikasi →
   **Edit** → **Edit Password** / *Generate new password*.
2. Perbarui `MONGODB_URI` di Railway dengan password baru (ingat: karakter
   spesial harus di-URL-encode, `@` → `%40`).
3. Verifikasi: `/health` harus menjawab `"database":"connected"`.

### C6. `FIREBASE_SERVICE_ACCOUNT` — tidak perlu

Nilainya hanya path. Tidak ada kunci yang bocor, dan berkas JSON service
account tidak pernah masuk repo. Yang perlu dilakukan hanya **memastikan
berkasnya tetap tidak ter-track**:

```bash
git ls-files backend/config/firebase-service-account.json
# harus kosong
```

Kalau suatu saat berkas itu sampai ter-commit, private key-nya harus dirotasi
lewat Firebase Console → *Project Settings* → *Service Accounts* → **Generate
new private key**, lalu key lama dihapus.

### C7. `OPENAI_API_KEY` — tidak ada yang perlu dilakukan

Nilainya kosong di berkas bocor. Cukup pastikan tidak ada key OpenAI yang
pernah ditulis dengan nama berkas serupa:

```bash
git log --all --full-history --name-only --pretty=format: | sort -u | grep -iE '\.env'
```

### C8. `OPENROUTER_API_KEY` — tidak ada yang perlu dilakukan

Kunci ini sempat terlewat dari inventaris karena posisinya di tengah baris
(bagian A), jadi pastikan dulu bahwa yang ada di Railway bukan nilai ini. Kalau
ternyata sama: kuncinya sekarang menjawab `401 User not found`, artinya tidak
bisa dipakai siapa pun — termasuk aplikasi Anda. Bukan lubang keamanan, tapi
berarti cadangan chat OpenRouter memang tidak pernah aktif, dan dokumen
`OPENROUTER_CHAT_MODEL` di `docs/env-produksi-railway.md` patut dicurigai belum
pernah terpakai.

Kalau ingin OpenRouter benar-benar berfungsi sebagai cadangan, buat kunci baru
di **openrouter.ai/keys**, pasang sebagai `OPENROUTER_API_KEY`, lalu cek baris
`Provider chat:` di log startup Railway: harus muncul `openrouter=configured`.

---

## D. Memasang nilai baru di Railway

Service: **`ai-multimodal-app`** · Environment: **`production`**.
Mengubah variabel memicu deploy ulang otomatis.

### Lewat dashboard (paling aman)

Railway → project → service `ai-multimodal-app` → tab **Variables** → ubah
nilainya → tunggu deploy selesai di tab *Deployments*.

### Lewat CLI (bisa disalin-tempel, enak untuk beberapa kunci sekaligus)

```bash
npm install --global @railway/cli        # versi yang diuji: 5.58.0

# Autentikasi non-interaktif. Ambil project token dari
# Railway → Project Settings → Tokens. Jangan tempel token ini ke chat/issue.
export RAILWAY_TOKEN='…'
PROJECT='<RAILWAY_PROJECT_ID>'
SERVICE=ai-multimodal-app
ENV=production

# Ganti satu per satu. Nilai dibaca dari stdin sehingga tidak pernah masuk ke
# daftar argumen proses maupun riwayat shell.
openssl rand -base64 32 | railway variable set JWT_SECRET \
  --stdin --service "$SERVICE" --environment "$ENV" --project "$PROJECT"

printf '%s' 'gsk_…' | railway variable set GROQ_API_KEY \
  --stdin --service "$SERVICE" --environment "$ENV" --project "$PROJECT"

printf '%s' '…' | railway variable set GEMINI_API_KEY \
  --stdin --service "$SERVICE" --environment "$ENV" --project "$PROJECT"

printf '%s' '…' | railway variable set CLOUDFLARE_API_TOKEN \
  --stdin --service "$SERVICE" --environment "$ENV" --project "$PROJECT"
```

Bentuk `railway variables --set KEY=value` yang lama masih jalan tetapi sudah
ditandai *legacy* di CLI 5.x; `railway variable set KEY --stdin` adalah bentuk
sekarang. Cek `railway variable set --help` di versi Anda kalau flag-nya berbeda.

> **Hati-hati:** `railway variable list --json` mencetak **nilai** semua
> variabel, bukan hanya namanya. Jangan dijalankan di terminal yang di-log, di
> CI, atau di sesi yang output-nya ditempel ke mana pun. Untuk memeriksa *apakah*
> sebuah variabel sudah terpasang tanpa membocorkan isinya, cek log startup
> Railway (bagian E) — di sana hanya tercetak `configured`/`missing`.

---

## E. Verifikasi setelah rotasi

```bash
B=https://ai-multimodal-app-production.up.railway.app

# 1. Backend hidup, database tersambung, penyimpanan bukan "local"
curl -s $B/health
#    {"status":"OK",...,"database":"connected","storageMode":"cloudinary"}

# 2. JWT: buktikan secret LAMA sudah tidak berlaku, tanpa perlu sesi login.
#    Endpoint /api/v1/member/profile memverifikasi tanda tangan JWT lebih dulu,
#    baru menyentuh database — jadi status 401 vs 404 di sini murni soal rahasia:
#      401 Invalid token  -> tanda tangan ditolak (secret lama sudah mati)  ✔
#      404 User not found -> tanda tangan DITERIMA (secret lama masih hidup) ✘
SECRET_LAMA='<nilai yang mau diuji, mis. dari berkas bocor>'
TOKEN=$(SECRET="$SECRET_LAMA" node -e 'const jwt=require("./backend/node_modules/jsonwebtoken");process.stdout.write(jwt.sign({uid:"probe-rotasi-tidak-ada"},process.env.SECRET))')
curl -s -w '\nHTTP %{http_code}\n' -H "Authorization: Bearer $TOKEN" \
  $B/api/v1/member/profile

# 3. Endpoint dev tetap mati
curl -s -o /dev/null -w '%{http_code}\n' -X POST $B/api/v1/auth/dev-login -d '{}'
#    404
```

Lalu di UI: login ulang, kirim 1 pesan chat, dan generate 1 gambar. Log startup
Railway menegaskan kunci mana yang sudah terbaca proses tanpa mencetak isinya:

```
Penyimpanan media: mode=cloudinary
Provider chat: groq > gemini > openrouter (groq=configured gemini=configured openai=missing openrouter=configured)
```

`missing` di baris itu berarti variabelnya belum sampai ke service ini (salah
nama, dipasang di service/environment lain, atau container belum restart).

---

## F. Membersihkan berkas dari repo

**Status: sudah dikerjakan.** `backend/.env.save.1` sudah dilepas dari tracking
(`git rm --cached`) dan salinan lokalnya sudah dihapus. Langkah ini sengaja bisa
dikerjakan lebih dulu daripada rotasi, karena isinya tetap terbaca dari riwayat
lewat `git show 4805098:backend/.env.save.1` — jadi acuan untuk membandingkan
nilai tidak ikut hilang. Yang tidak boleh ditunda adalah rotasinya sendiri.

Kalau perlu mengulang langkah ini:

```bash
git rm --cached backend/.env.save.1
rm backend/.env.save.1
git commit -m "Stop tracking the leaked env backup"
git push
```

Menghapus isinya dari riwayat (`git filter-repo`, lalu force-push) hanya perlu
kalau Anda ingin berkas itu benar-benar hilang dari repo. Konsekuensinya: semua
commit hash berubah, setiap clone dan PR lama harus di-clone ulang, dan force
push menimpa riwayat di GitHub. **Rotasi tetap wajib lebih dulu, apa pun
keputusan soal riwayat** — selama kredensial sudah diganti, isi riwayat
kehilangan nilainya.

Agar tidak terulang, ada tiga lapisan yang sekarang aktif:

| Lapisan | Berkas | Kapan bekerja |
|---|---|---|
| Hook pre-commit | `scripts/git-hooks/pre-commit` | menolak commit yang membawa berkas mirip kredensial; pasang dengan `bash scripts/install-git-hooks.sh` |
| Gerbang CI | `.github/workflows/deploy.yml` (job `quality`) | menolak push ke `main` kalau ada berkas/pola rahasia yang ter-track |
| Aturan ignore | `.gitignore` | menyaring sejak `git add`; **tidak** berlaku pada berkas yang sudah ter-track dan tidak menahan `git add -f` |

Pemeriksaannya ada di [`scripts/check-no-secrets.js`](../scripts/check-no-secrets.js)
dan sengaja **tidak pernah mencetak nilai** yang cocok — hanya lokasi dan nama
aturan, karena log run repo ini publik.

---

## G. Di luar berkas ini (ikut diaudit)

Kredensial berikut **tidak** ada di `.env.save.1`, tapi relevan karena
berhubungan dengan deploy. Rotasi mereka hanya perlu kalau Anda menduga ada
kebocoran lain:

| Kredensial | Lokasi | Cara rotasi |
|---|---|---|
| `RAILWAY_TOKEN`, `RAILWAY_PROJECT_ID` | GitHub → Settings → Secrets and variables → Actions | Railway → Project Settings → Tokens → buat token baru, hapus lama |
| `VERCEL_TOKEN`, `VERCEL_PROJECT_ID` | GitHub → Secrets and variables → Actions | Vercel → Settings → Tokens → buat, lalu hapus lama |
| `RAILWAY_SERVICE` (opsional) | GitHub → Secrets and variables → Actions | bukan rahasia; hanya nama service |

Berkas yang memakainya: [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml).

---

## H. Checklist

- [ ] **`GROQ_API_KEY`** (satu-satunya lubang yang masih terbuka): kunci baru dipasang di Railway → chat diverifikasi `via groq` → kunci lama **dicabut di console.groq.com**
- [x] Dipastikan `OPENROUTER_API_KEY` di produksi **masih** nilai bocor (dibandingkan langsung, 21 Sep 2026). Nilainya `401 User not found`, jadi tidak ada paparan — tetapi cadangan chat OpenRouter tetap mati sampai kuncinya diganti
- [ ] Diganti `OPENROUTER_API_KEY` di Railway dengan kunci baru (atau dihapus, kalau memang tidak dipakai) supaya cadangan chat hidup lagi
- [ ] Dipastikan `GEMINI_API_KEY` di Railway bukan nilai bocor (nilai itu tidak berhasil diautentikasi, jadi kalau itu yang terpasang, Gemini memang tidak pernah jalan)
- [ ] Tidak ada token asing yang masih aktif di halaman API Tokens Cloudflare
- [ ] `JWT_SECRET` diperiksa di tab Variables, dan diganti **hanya kalau** nilainya masih sama dengan yang bocor (kalau diganti: semua user login ulang)
- [ ] Dipastikan `MONGODB_URI` di Railway bukan URI lokal yang bocor
- [ ] Dipastikan `backend/config/firebase-service-account.json` tidak ter-track
- [x] Berkas bocor dilepas dari tracking (`git rm --cached`)
- [x] Salinan lokal `.env.save.1` dihapus
- [ ] Hook pre-commit terpasang (`bash scripts/install-git-hooks.sh`) di mesin yang dipakai
- [ ] Tidak ada kredensial baru yang disimpan dengan nama `.env.save*`
