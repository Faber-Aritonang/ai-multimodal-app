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

# Dari platform.openai.com/api-keys (dipakai fitur chat & text-to-image)
OPENAI_API_KEY=sk-...

# Opsional: override model
# OPENAI_CHAT_MODEL=gpt-3.5-turbo
# OPENAI_IMAGE_MODEL=dall-e-3

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
