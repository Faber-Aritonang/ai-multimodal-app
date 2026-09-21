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
| `JWT_SECRET` | nilai asli, 44 karakter (base64 dari 32 byte) | **Ya — paling mendesak** |
| `GROQ_API_KEY` | nilai asli, berawalan `gsk_` | **Ya** |
| `GEMINI_API_KEY` | nilai asli, 138 karakter | **Ya** |
| `CLOUDFLARE_API_TOKEN` | nilai asli, 53 karakter | **Ya (revoke)** |
| `CLOUDFLARE_ACCOUNT_ID` | 32 karakter hex | Tidak wajib (identifier, bukan rahasia) |
| `MONGODB_URI` | `mongodb://localhost…` **tanpa** `user:password` | Tidak ada (lihat catatan) |
| `FIREBASE_SERVICE_ACCOUNT` | hanya **path**: `./config/firebase-service-account.json` | Tidak ada (bukan kunci) |
| `OPENAI_API_KEY` | kosong | Tidak ada |
| `FRONTEND_URL`, `NODE_ENV`, `PORT`, `UPLOAD_DIR`, `RATE_LIMIT_*`, `OPENROUTER_CHAT_MODEL` | konfigurasi | Tidak ada |

Catatan penting dari tabel di atas:

- **`JWT_SECRET` adalah yang paling berbahaya.** Backend memakainya untuk
  menandatangani token login. Siapa pun yang memegang nilai lama bisa membuat
  token yang sah untuk akun mana pun, tanpa pernah login. Kalau secret di
  Railway masih sama dengan nilai bocor ini, seluruh akun praktis terbuka —
  rotasi ini bukan opsional.
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
# 1. Buat nilai baru. Jangan pakai nilai yang sudah pernah ada di repo.
openssl rand -base64 32

# 2. Pasang di Railway
railway variables --service ai-multimodal-app --environment production \
  --set "JWT_SECRET=$(openssl rand -base64 32)"

# 3. Tunggu deploy ulang selesai, lalu verifikasi (bagian E)
```

Efek samping yang harus diumumkan ke pengguna: **semua sesi lama langsung
ditolak**, semua orang login ulang. Token lama akan menjawab `401`.

### C2. `GROQ_API_KEY`

1. Buka **console.groq.com** → *API Keys* → **Create API Key**. Beri nama yang
   menunjukkan asalnya (mis. `railway-prod-2026-09`) supaya rotasi berikutnya
   mudah ditelusuri.
2. Pasang di Railway (bagian D).
3. Verifikasi: kirim satu pesan di UI chat, pastikan badge-nya `via groq`.
4. Setelah verifikasi hijau, **hapus kunci lama** di console.groq.com.

### C3. `GEMINI_API_KEY`

1. Buka **aistudio.google.com/apikey** → **Create API key**.
2. Pasang di Railway (bagian D).
3. Verifikasi: badge `via gemini` muncul saat Groq sengaja dilewati (mis. set
   `CHAT_PROVIDER=gemini` sementara), atau lihat log startup Railway.
4. Hapus kunci lama di AI Studio.

> Nilai `GEMINI_API_KEY` di berkas bocor **strukturnya tidak lazim**: 138
> karakter, memuat `=`, `_`, dan pola mirip tanggal — bukan bentuk key Gemini
> yang biasa (yang berawalan `AIza`). Kemungkinan besar itu hasil paste yang
> salah. Karena itu jangan hanya "memindahkan" nilai lama ke tempat lain:
> **buat ulang dari AI Studio** dan tempel utuh dalam satu baris.

### C4. `CLOUDFLARE_API_TOKEN` (+ `CLOUDFLARE_ACCOUNT_ID`)

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

---

## D. Memasang nilai baru di Railway

Service: **`ai-multimodal-app`** · Environment: **`production`**.
Mengubah variabel memicu deploy ulang otomatis.

### Lewat dashboard (paling aman)

Railway → project → service `ai-multimodal-app` → tab **Variables** → ubah
nilainya → tunggu deploy selesai di tab *Deployments*.

### Lewat CLI (bisa disalin-tempel, enak untuk beberapa kunci sekaligus)

```bash
npm install --global @railway/cli

# Autentikasi non-interaktif. Ambil project token dari
# Railway → Project Settings → Tokens. Jangan tempel token ini ke chat/issue.
export RAILWAY_TOKEN='…'
export RAILWAY_PROJECT_ID='…'

railway link --project "$RAILWAY_PROJECT_ID"

# Ganti satu per satu. Nilai rahasia jangan ditulis di riwayat shell
# (awali spasi bila shell mengaktifkan HISTCONTROL=ignorespace).
railway variables --service ai-multimodal-app --environment production \
  --set "JWT_SECRET=$(openssl rand -base64 32)"

railway variables --service ai-multimodal-app --environment production \
  --set "GROQ_API_KEY=gsk_…"

railway variables --service ai-multimodal-app --environment production \
  --set "GEMINI_API_KEY=…"

railway variables --service ai-multimodal-app --environment production \
  --set "CLOUDFLARE_API_TOKEN=…"
```

Bila flag berbeda di versi CLI Anda, cek `railway variables --help` — opsi
`--service` dan `--environment` yang dipakai di atas tersedia sejak CLI v3+.

> **Hati-hati:** `railway variables --json` mencetak **nilai** semua variabel,
> bukan hanya namanya. Jangan dijalankan di terminal yang di-log, di CI, atau
> di sesi yang output-nya ditempel ke mana pun. Untuk memeriksa *apakah* sebuah
> variabel sudah terpasang tanpa membocorkan isinya, cek log startup Railway
> (bagian E) — di sana hanya tercetak `configured`/`missing`.

---

## E. Verifikasi setelah rotasi

```bash
B=https://ai-multimodal-app-production.up.railway.app

# 1. Backend hidup, database tersambung, penyimpanan bukan "local"
curl -s $B/health
#    {"status":"OK",...,"database":"connected","storageMode":"cloudinary"}

# 2. JWT: token lama harus DITOLAK setelah JWT_SECRET diganti
#    Simpan token dari sesi sebelum rotasi, lalu:
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $TOKEN_LAMA" $B/api/v1/auth/me
#    401

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

Setelah kredensial dirotasi, baru lepas berkasnya dari tracking. Urutannya
penting: membersihkan repo **tidak** menghilangkan isi berkas dari riwayat,
jadi ia bukan pengganti rotasi.

```bash
git rm --cached backend/.env.save.1
git commit -m "Stop tracking the leaked env backup"
git push
```

Berkas tetap ada di disk sehingga Anda masih bisa membacanya untuk mengecek
kunci mana yang sudah diganti. Setelah tidak diperlukan, hapus manual:

```bash
rm backend/.env.save.1
```

Menghapus isinya dari riwayat (`git filter-repo`, lalu force-push) hanya perlu
kalau Anda ingin berkas itu benar-benar hilang dari repo. Konsekuensinya: semua
commit hash berubah, setiap clone dan PR lama harus di-clone ulang, dan force
push menimpa riwayat di GitHub. **Lakukan rotasi lebih dulu, apa pun
keputusannya** — selama kredensial sudah diganti, isi riwayat kehilangan nilainya.

Kredensial baru Jangan disimpan sebagai `.env.save*`. `.gitignore` sekarang
memuat `.env*`, jadi salinan apa pun berawalan `.env` sudah terabaikan — tetapi
aturan ignore tidak berlaku pada berkas yang **sudah** ter-track, dan tidak
melindungi Anda dari `git add -f`.

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

- [ ] `JWT_SECRET` baru dibuat, dipasang di Railway, deploy selesai
- [ ] Token lama benar-benar ditolak (401) setelah rotasi
- [ ] `GROQ_API_KEY` baru dipasang + diverifikasi (`via groq`), kunci lama **sudah dihapus**
- [ ] `GEMINI_API_KEY` dibuat ulang dari AI Studio + dipasang, kunci lama dihapus
- [ ] `CLOUDFLARE_API_TOKEN` lama di-revoke, token baru dipasang, generate gambar berhasil
- [ ] Dipastikan `MONGODB_URI` di Railway bukan URI lokal yang bocor
- [ ] Dipastikan `backend/config/firebase-service-account.json` tidak ter-track
- [ ] Berkas bocor dilepas dari tracking (`git rm --cached`) dan di-push
- [ ] Salinan lokal `.env.save.1` dihapus
- [ ] Tidak ada kredensial baru yang disimpan dengan nama `.env.save*`
