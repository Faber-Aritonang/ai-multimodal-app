# AI Multimodal Application

[![Deploy to Railway & Vercel](https://github.com/Faber-Aritonang/ai-multimodal-app/actions/workflows/deploy.yml/badge.svg)](https://github.com/Faber-Aritonang/ai-multimodal-app/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Full-stack web application with AI-powered multimodal features: **chat**,
**text-to-image**, dan **image-to-image**. Fitur video & audio masih berstatus
feature flag ([lihat daftarnya](#feature-flags-pending-admin-approval)). Dibangun
di atas layanan gratis dan dirancang mudah dinaikkan ke layanan berbayar.

| | |
|---|---|
| 🌐 **Demo (live)** | <https://www.maubuatapa.my.id> |
| ⚙️ **API produksi** | <https://ai-multimodal-app-production.up.railway.app/health> |
| 📦 **Repositori** | <https://github.com/Faber-Aritonang/ai-multimodal-app> |
| 📚 **Dokumentasi** | [setup kredensial](docs/setup-kredensial.md) · [env produksi Railway](docs/env-produksi-railway.md) · [panduan kontribusi](CONTRIBUTING.md) |

> Demo berjalan di atas kuota gratis provider AI, jadi sesekali lambat atau
> menunggu giliran. Masuk memakai Google Sign-In; member baru menunggu
> persetujuan admin sebelum bisa memakai fiturnya.

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Quick Start](#quick-start)
- [Backend Setup](#backend-setup)
- [Frontend Setup](#frontend-setup)
- [Testing & Linting](#testing--linting)
- [API Documentation](#api-documentation)
- [Example API Usage](#example-api-usage)
- [Deployment](#deployment)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Future Improvements](#future-improvements)
- [Contributing](#contributing)
- [Contributors](#contributors)
- [License](#license)
- [Contact](#contact)

## Features

### Available Features
- **Chat**: AI-powered conversational chat — provider bisa ditukar (Groq **gratis** sebagai default, Gemini/OpenAI/OpenRouter sebagai fallback)
- **Text-to-Image**: Generate images from text prompts — provider bisa ditukar (Cloudflare Workers AI **gratis**, Pollinations tanpa API key, atau DALL·E 3), lengkap dengan riwayat & hapus
- **Image-to-Image**: Transformasi gambar yang diunggah sesuai prompt (FLUX.2 [klein] di Cloudflare). Gambar diperkecil otomatis di browser, riwayat menyimpan sebelum/sesudah
- **Referral**: Kode undangan, link `/register?ref=CODE`, dan QR code
- **User Authentication**: Google Sign-In via Firebase
- **Member Registration**: Full registration with admin approval workflow

### Feature Flags (Pending Admin Approval)
- **Text-to-Video**: Generate videos from text descriptions
- **Image-to-Video**: Create videos from images
- **Text-to-Sound**: Convert text to audio
- **Sound-to-Text**: Transcribe audio to text

## Tech Stack

### Free & Scalable Architecture

| Layer | Technology | Free Tier | Scale-Up Path |
|-------|------------|-----------|---------------|
| **Frontend** | React + Vite + TailwindCSS | ✅ Free | Vercel/Netlify |
| **Backend** | Node.js + Express | ✅ Free | Railway/Render |
| **Database** | MongoDB Atlas | ✅ 512MB Free | MongoDB Cloud |
| **Auth** | Firebase Auth | ✅ Free | Firebase Blaze |
| **Text-to-Image** | Cloudflare Workers AI (FLUX) + Pollinations fallback | ✅ 10.000 Neurons/hari (±65 gambar 1024x1024) | Black Forest Labs / OpenAI |
| **Chat (LLM)** | Groq + Gemini/OpenRouter fallback (endpoint OpenAI-compatible) | ✅ 1.000 request/hari (Groq) | OpenAI / paid tiers |
| **Hosting** | Local/Hostinger | ✅ Free | Paid VPS |

### Alternative Stack Options

For scale-up, consider:
- **Backend**: Supabase, Railway, Render, Fly.io
- **Database**: PostgreSQL on Supabase, PlanetScale
- **Auth**: Clerk, Auth0, Magic Link

## Quick Start

```bash
# Clone & setup
git clone https://github.com/Faber-Aritonang/ai-multimodal-app.git
cd ai-multimodal-app

# Backend
cd backend
npm install
cp .env.example .env
# Edit .env with your configuration
npm run dev

# Frontend
cd ../frontend
npm install
npm run dev
```

Visit `http://localhost:3000` (backend) and `http://localhost:5173` (frontend)

## Backend Setup

### 1. Install Dependencies
```bash
cd backend
npm install
```

### 2. Environment Variables
Copy `.env.example` to `.env` and configure (panduan detail: [`docs/setup-kredensial.md`](docs/setup-kredensial.md)):

```bash
# Server
PORT=3000
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/db-name
JWT_SECRET=your-super-secret-key-here

# Firebase (for Auth)
FIREBASE_SERVICE_ACCOUNT=./config/firebase-service-account.json

# AI APIs — semua fitur AI punya jalur gratis, OPENAI_API_KEY tidak wajib lagi.
# (Chat: Groq/Gemini/OpenRouter gratis · Text-to-Image: Pollinations tanpa key ·
#  Image-to-Image: Cloudflare atau PUBLIC_BASE_URL publik)
# OPENAI_API_KEY=sk-your-key   # opsional, hanya untuk provider berbayar

# Text-to-image gratis (lihat docs/setup-kredensial.md bagian 3b)
# Kalau dua nilai Cloudflare di bawah diisi, Cloudflare otomatis jadi provider
# utama; kalau dikosongkan, fitur tetap jalan lewat Pollinations (tanpa API key).
CLOUDFLARE_ACCOUNT_ID=your-cloudflare-account-id
CLOUDFLARE_API_TOKEN=your-cloudflare-api-token
IMAGE_PROVIDER=cloudflare
IMAGE_FALLBACK_PROVIDER=pollinations

# Image-to-image (kredensial Cloudflare di atas dipakai ulang oleh FLUX.2 [klein])
# Gambar input wajib < 512x512; frontend memperkecilnya otomatis.
# IMAGE_EDIT_PROVIDER=cloudflare
# IMAGE_EDIT_FALLBACK_PROVIDER=pollinations
# PUBLIC_BASE_URL=https://aplikasi-anda.example.com   # untuk jalur tanpa API key

# Chat gratis (lihat docs/setup-kredensial.md bagian 3c)
GROQ_API_KEY=gsk_your-groq-key
CHAT_PROVIDER=groq
GEMINI_API_KEY=your-gemini-key
# Cadangan boleh lebih dari satu, dipisah koma dan dicoba berurutan.
CHAT_FALLBACK_PROVIDER=gemini,openrouter
# OpenRouter: model gratis berakhiran `:free`. Opsional — kalau key-nya kosong,
# provider ini hanya dilewati dan rantai cadangan lama tidak berubah.
# OPENROUTER_API_KEY=sk-or-your-openrouter-key
# Boleh beberapa model dipisah koma (dicoba berurutan; limit gratis berlaku
# per model). Model-model itu bisa berpikir (reasoning); penalarannya dimatikan
# default (off) agar jawaban tidak berupa jejak berpikir.
# OPENROUTER_CHAT_MODEL=nex-agi/nex-n2.5-mini:free,nvidia/nemotron-3-super-120b-a12b:free,inclusionai/ling-3.0-flash-vl:free,inclusionai/ling-3.0-flash-fin:free,z-ai/glm-5.2:free
# OPENROUTER_REASONING=off
# Model yang baru gagal dijeda 60 detik (dilewati tanpa request) agar kegagalan
# yang sama tidak dibayar berulang kali; set 0 untuk selalu mencoba semuanya.
# OPENROUTER_FAILURE_COOLDOWN_MS=60000
# Lihat docs/setup-kredensial.md bagian 3c untuk hasil pembandingannya.

# Penyimpanan media (opsional di lokal, WAJIB di produksi)
# Tanpa ini, gambar hasil generate disimpan di filesystem container dan ikut
# terhapus setiap deploy. Lihat "Penyimpanan media" di bawah.
# Pilihan A — Cloudinary (plan gratisnya tidak minta kartu kredit):
# CLOUDINARY_CLOUD_NAME=xxxxxxxx
# CLOUDINARY_API_KEY=123456789012345
# CLOUDINARY_API_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
# Pilihan B — object storage S3-compatible (R2/Supabase/B2/MinIO):
# STORAGE_PROVIDER=s3
# S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
# S3_BUCKET=nama-bucket
# S3_ACCESS_KEY_ID=...
# S3_SECRET_ACCESS_KEY=...
# S3_PUBLIC_BASE_URL=https://pub-xxxxxxxx.r2.dev
# S3_FORCE_PATH_STYLE=true   # hanya untuk MinIO/B2
```

### 3. Firebase Setup

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create a new project
3. Enable Google Sign-in in Authentication
4. Add `localhost` to Authentication → Settings → **Authorized domains**
5. Download service account key: Project Settings → Service accounts → Generate new private key
6. Place it at `./config/firebase-service-account.json`

### 3b. Tanpa Firebase: dev-login (development)

Belum punya kredensial Firebase? Aplikasi tetap bisa dipakai di lokal. Saat
`npm run dev`, halaman `/login` menampilkan panel **Dev login** yang masuk hanya
dengan email:

```bash
curl -X POST http://localhost:3000/api/v1/auth/dev-login \
  -H 'Content-Type: application/json' \
  -d '{"email":"dev.member@example.com","role":"member"}'
```

`role` boleh `member` (default, langsung disetujui) atau `guest` (untuk menguji
alur pending approval). Email yang sudah terdaftar di koleksi `admins` akan
mendapat token admin. Endpoint ini tidak dipasang sama sekali saat
`NODE_ENV=production`.

### 4. MongoDB Setup

Option A: MongoDB Atlas (Free Tier)
1. Go to [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
2. Create a free cluster
3. Get connection string
4. Add to `MONGODB_URI`

Option B: Local MongoDB
```bash
npm install -g mongod
mongod --port 27017
```

## Frontend Setup

### 1. Install Dependencies
```bash
cd frontend
npm install
```

### 2. Environment Variables

```bash
cp .env.example .env.local
```

Isi `frontend/.env.local` dengan Firebase Web App config (Firebase Console →
Project Settings → Your apps) dan `VITE_API_URL` (kosongkan saat development):

```env
VITE_API_URL=
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

```env
# Opsional: target proxy Vite saat development (default http://localhost:3000)
# Harus sama dengan PORT di backend/.env
VITE_PROXY_TARGET=http://localhost:3000
```

> `VITE_API_URL` hanya dipakai saat production (mis. Vercel tanpa proxy).
> Saat development, request `/api/v1` dan `/uploads` otomatis di-proxy Vite ke
> backend (lihat `VITE_PROXY_TARGET`).

Restart dev server setiap kali `.env.local` diubah.

### 3. Run Development Server
```bash
npm run dev
```

Visit `http://localhost:5173`

## Testing & Linting

```bash
# Backend - unit test (tanpa MongoDB/Firebase, aman untuk CI)
cd backend && npm test

# Frontend - ESLint
cd frontend && npm run lint

# Frontend - uji browser sungguhan (butuh aplikasi jalan + Chrome)
cd frontend && npm run test:browser
```

### Uji browser (`npm run test:browser`)

Menjalankan Chrome headless lewat protokol DevTools (CDP) dan memeriksa DOM,
respons HTTP, serta error console. Tanpa dependency tambahan — Node 22 sudah
punya `fetch` dan `WebSocket` global.

Yang diuji:

| Spec | Cakupan |
|------|---------|
| `chat.spec.cjs` | buat sesi, badge kuota, kirim pesan, balasan AI, label provider, markdown dirender, kuota berkurang, bersihkan sesi |
| `text-to-image.spec.cjs` | generate gambar sungguhan, gambar termuat di browser, gambar juga dimuat dari origin backend secara absolut (kondisi produksi), berkas di object storage memakai URL absolut, berkas yang hilang dijelaskan ke user, metadata resolusi+provider (hasil & riwayat), kuota, tombol hapus benar-benar menghapus data di server |
| `image-to-image.spec.cjs` | unggah lewat drag & drop, gambar diperkecil ke ≤512px, preset ukuran ikut bentuk gambar, hasil transformasi, dan — kalau kredensial provider belum ada — pastikan gagal dengan pesan jelas tanpa memakai kuota atau memberi hasil palsu |
| `dashboard-profile.spec.cjs` | dashboard (kartu tool, kuota) & profil (nama, referral, QR, Member Since) dibandingkan dengan data API |
| `pending-approval.spec.cjs` | member yang disetujui admin **saat tab-nya masih terbuka** benar-benar masuk tanpa refresh manual (dulu tertahan di halaman Pending Approval) |

Prasyarat: backend (`cd backend && npm start`) dan frontend
(`cd frontend && npm run dev`) sudah jalan, serta Chrome/Chromium terpasang.

```bash
# Konfigurasi opsional
TEST_BASE_URL=http://localhost:5173   # default
TEST_API_URL=http://localhost:4000    # default
TEST_MEMBER_EMAIL=dev.member@example.com
CHROME_BIN=/path/ke/chrome            # bila Chrome tidak terdeteksi otomatis

# Jalankan satu spec saja (mis. saat memperbaiki satu halaman)
TEST_SPECS=pending-approval npm run test:browser
```

Uji browser **tidak** jalan di CI karena butuh backend + frontend hidup, jadi ia
dijalankan manual di lokal. Yang dijaga CI: backend unit test, ESLint, build
frontend, serta job `Verify Frontend on Vercel` (menunggu deployment untuk commit
yang dipush, memeriksa tautan langsung `/`, `/login`, `/tools/text-to-image`, dan
memeriksa CORS dari origin produksi).

Catatan: spec memakai akun dev member, jadi setiap eksekusi memakai
**1 kuota chat** dan **1 kuota gambar**. Data yang dibuat (sesi chat, media)
dihapus kembali oleh spec, tapi kuotanya tidak bisa dikembalikan dari sini.

## API Documentation

### Auth Endpoints

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/api/v1/auth/register` | Register new user (creates pending member) | ❌ No |
| POST | `/api/v1/auth/login` | Login with Firebase token | ❌ No |
| POST | `/api/v1/auth/dev-login` | Login tanpa Firebase — **development only** (404 saat `NODE_ENV=production`) | ❌ No |
| GET | `/api/v1/auth/status` | Check authentication status | ✅ Optional |
| POST | `/api/v1/auth/logout` | Logout user | ✅ Optional |

### Member Endpoints

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/api/v1/member/profile` | Get user profile | ✅ Member |
| GET | `/api/v1/member/quota` | Get user quotas | ✅ Member |
| GET | `/api/v1/member/chat/sessions` | List chat sessions | ✅ Member |
| POST | `/api/v1/member/chat/sessions` | Create new chat session | ✅ Member |
| POST | `/api/v1/member/chat/sessions/:sessionId/message` | Send message | ✅ Member |
| GET | `/api/v1/member/chat/sessions/:sessionId` | Get session details | ✅ Member |
| DELETE | `/api/v1/member/chat/sessions/:sessionId` | Delete session | ✅ Member |
| GET | `/api/v1/member/members` | Daftar member approved | ✅ Member |
| GET | `/api/v1/member/members/:referralCode` | Profil pemilik kode referral | ✅ Member |
| GET | `/api/v1/member/referral-stats` | Statistik referral (jumlah yang diundang) | ✅ Member |
| POST | `/api/v1/media/text-to-image` | Generate gambar dari prompt | ✅ Member |
| GET | `/api/v1/media/history` | Riwayat media user | ✅ Member |
| DELETE | `/api/v1/media/:contentId` | Hapus media (record + file) | ✅ Member |
| GET | `/api/v1/media/status` | Daftar endpoint media | ❌ No |
| GET | `/api/v1/auth/referral/:referralCode` | Info pemilik kode referral (halaman undangan) | ❌ No |

### Admin Endpoints

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/api/v1/admin/pending-members` | List pending members | ✅ Admin |
| GET | `/api/v1/admin/approved-members` | List approved members | ✅ Admin |
| PUT | `/api/v1/admin/approve-member/:uid` | Approve member | ✅ Admin |
| DELETE | `/api/v1/admin/reject-member/:uid` | Reject member | ✅ Admin |
| GET | `/api/v1/admin/analytics` | Get analytics | ✅ Admin |

## Example API Usage

### Register User
```bash
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "firebaseToken": "user-firebase-id-token",
    "displayName": "John Doe",
    "email": "john@example.com"
  }'
```

### Get Auth Status
```bash
curl -X GET http://localhost:3000/api/v1/auth/status \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### Send Chat Message
```bash
curl -X POST http://localhost:3000/api/v1/member/chat/sessions/xxx/message \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello AI!"}'
```

### Generate Image (Text to Image)
```bash
curl -X POST http://localhost:3000/api/v1/media/text-to-image \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A futuristic city at sunset, cinematic lighting",
    "size": "1024x1024",
    "quality": "standard"
  }'
```

Respons memuat `provider` yang dipakai (mis. `cloudflare`, `pollinations`, `openai`).
Hasil generate disimpan di `backend/uploads/` dan disajikan statis di
`/uploads/<file>` (PNG atau JPEG mengikuti keluaran provider).
Quota `imageGeneration` berkurang 1 hanya jika gambar berhasil dibuat.

Provider text-to-image bisa diganti lewat `IMAGE_PROVIDER` /
`IMAGE_FALLBACK_PROVIDER` tanpa mengubah kode — lihat
[`docs/setup-kredensial.md`](docs/setup-kredensial.md) bagian 3b untuk penyiapan
provider gratis (Cloudflare Workers AI: ±65 gambar 1024x1024 per hari).

## Deployment

Deploy produksi berjalan **otomatis dari CI**: satu push ke `main` menjalankan
test & lint, mengunggah backend lewat `railway up`, memverifikasi `/health`
produksi, lalu memastikan deployment Vercel untuk commit itu benar-benar naik
(lihat [Pipeline otomatis](#pipeline-otomatis-githubworkflowsdeployyml)).
Langkah manual di bawah hanya perlu kalau menargetkan project atau platform lain.

### Backend Deployment (Railway)

Cara yang dipakai sekarang: service Railway dihubungkan ke repo ini dengan root
`backend/`, lalu setiap push ke `main` di-deploy oleh job `Deploy Backend to
Railway` (butuh secret `RAILWAY_TOKEN`).

Manual:

1. `railway login`, lalu `railway link` ke project tujuan
2. Isi variabel lingkungan di dashboard Railway — daftar lengkap per variabel,
   akibatnya kalau salah, dan cara verifikasinya ada di
   [`docs/env-produksi-railway.md`](docs/env-produksi-railway.md)
3. `railway up` dari folder `backend/`
4. Pastikan `GET /health` menjawab `"status":"OK"`, `"database":"connected"`,
   dan `storageMode` **bukan** `local`

### Frontend Deployment (Vercel)

1. Import repo ini di [Vercel](https://vercel.com), root directory `frontend/`
2. Set `VITE_API_URL` ke domain backend produksi
   (`https://ai-multimodal-app-production.up.railway.app`). Frontend juga memiliki
   fallback ke URL ini agar domain custom tidak mengirim request API ke
   route SPA (`/api/...`) yang hanya mengembalikan `index.html`.
3. Deploy — build berikutnya otomatis dari setiap push ke `main`

### Environment Variables for Production

**Backend (.env)**:
```
NODE_ENV=production
PORT=3000
MONGODB_URI=your-mongodb-connection-string
JWT_SECRET=production-secret-key
FIREBASE_SERVICE_ACCOUNT={"type":"service_account",...}
OPENAI_API_KEY=your-openai-key
GROQ_API_KEY=gsk_your-groq-key
CHAT_PROVIDER=groq
CHAT_FALLBACK_PROVIDER=gemini,openrouter
OPENROUTER_API_KEY=sk-or-your-openrouter-key
CLOUDFLARE_ACCOUNT_ID=your-cloudflare-account-id
CLOUDFLARE_API_TOKEN=your-cloudflare-api-token
IMAGE_PROVIDER=cloudflare
IMAGE_FALLBACK_PROVIDER=pollinations

# WAJIB di produksi — tanpa ini gambar hilang setiap deploy (lihat bagian
# "Penyimpanan media" di bawah). Diperiksa lewat GET /health → services.storage.
# Cukup tiga baris ini: begitu lengkap, mode "cloudinary" dipakai otomatis.
CLOUDINARY_CLOUD_NAME=xxxxxxxx
CLOUDINARY_API_KEY=123456789012345
CLOUDINARY_API_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
# Alternatif S3-compatible: STORAGE_PROVIDER=s3 + S3_ENDPOINT/S3_BUCKET/
# S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY/S3_PUBLIC_BASE_URL.
```

> Daftar lengkap per variabel — mana yang wajib, akibatnya kalau salah, dan
> perintah untuk memverifikasinya di produksi — ada di
> [`docs/env-produksi-railway.md`](docs/env-produksi-railway.md).

**Frontend**: Set in Vercel dashboard:
```
VITE_API_URL=https://ai-multimodal-app-production.up.railway.app
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

> **Tiga hal yang tidak terlihat dari kode, dan pernah membuat produksi tidak
> bisa dipakai:**
>
> | Wajib ada | Di mana | Akibat kalau hilang |
> |---|---|---|
> | domain utama `www.maubuatapa.my.id` di **Authorized domains** | Firebase Console → Authentication → Settings | tombol Google gagal: `auth/unauthorized-domain` |
> | **Root Directory = `backend`** | Railway → service → Settings → Source | deployment `FAILED` dalam ~10 detik (RAILPACK mencari `package.json` di akar repo) |
> | aturan **`rewrites` ke `/index.html`** | `frontend/vercel.json` | beranda terbuka, tetapi tiap tautan langsung (`/login`, `/tools/…`) dijawab 404 |
>
> Selain itu `FRONTEND_URL` di Railway harus memuat semua hostname frontend yang
> sedang dipakai: `https://ai-multimodal-app.vercel.app,https://maubuatapa.my.id,https://www.maubuatapa.my.id`.
> Kalau tidak, browser memblokir panggilan API sebagai CORS. Domain custom adalah
> alamat demo utama; domain Vercel tetap dicantumkan sebagai alias deployment.
>
> **Berkas `/uploads` harus boleh dimuat lintas origin.** Karena frontend
> (Vercel) dan backend (Railway) adalah dua origin berbeda, `helmet()` yang
> menyetel `Cross-Origin-Resource-Policy: same-origin` membuat browser menolak
> gambar dengan `ERR_BLOCKED_BY_RESPONSE.NotSameOrigin` — hasil generate tampil
> rusak (hanya teks `alt`) padahal permintaannya 200 dan berkasnya ada. Mount
> `/uploads` di `server.js` menimpanya menjadi `cross-origin`, dan ada test yang
> mengunci header itu. Di lokal bug ini tidak pernah muncul karena Vite
> mem-proxy `/uploads`, sehingga halaman dan gambarnya satu origin.
>
> Database produksi memakai user Atlas di database `admin`, jadi connection
> string-nya perlu `authSource=admin` **dan** nama database di depan `?`:
> `mongodb+srv://user:pass@cluster.xxxxx.mongodb.net/ai-multimodal?authSource=admin&retryWrites=true&w=majority`.
> Tanpa nama database, data masuk ke `test`; tanpa `authSource=admin`,
> autentikasi gagal walau user & password benar.
>
> **Admin pertama harus di-seed manual.** Registrasi selalu menghasilkan
> `role: 'guest'` + `isApproved: false`, dan hanya admin yang boleh menyetujui
> member — jadi selama koleksi `admins` masih kosong, **semua** pengguna
> (termasuk pembuat aplikasi) berhenti di halaman *Pending Approval* dan tidak
> ada yang bisa keluar dari sana. Jalankan `scripts/createAdmin.js` dengan
> `MONGODB_URI` yang diarahkan ke database produksi:
>
> ```bash
> cd backend
> MONGODB_URI='mongodb+srv://...' \
>   node scripts/createAdmin.js --uid <firebase-uid> --email <email> --name "Nama"
> ```
>
> `uid` Firebase-nya bisa dibaca dari koleksi `users` (dokumen user yang baru
> mendaftar). Setelah itu **login ulang**: JWT-nya akan berisi `role: 'admin'`
> dan aplikasi mengarahkan ke `/admin`, bukan ke *Pending Approval*.

### Penyimpanan media

Container Railway memakai filesystem **sementara**: setiap deploy (dan setiap
restart) mengganti container beserta seluruh isi `/app/uploads`. Tanpa object
storage, gambar hasil generate hilang pada deploy berikutnya — catatannya tetap
ada di database, jadi UI menampilkan gambar rusak dan kuota user sudah terpakai.
Karena itu produksi **wajib** memakai penyimpanan di luar container.

**Cloudinary** (yang dipakai sekarang) — plan gratisnya tidak meminta kartu
kredit dan gambarnya dilayani CDN-nya. Cukup tiga variabel, diambil dari
dashboard Cloudinary → *Product Environment Credentials*:

```
CLOUDINARY_CLOUD_NAME=xxxxxxxx
CLOUDINARY_API_KEY=123456789012345
CLOUDINARY_API_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
```

Begitu ketiganya lengkap, mode `cloudinary` dipakai otomatis — `STORAGE_PROVIDER`
tidak perlu diisi. Kuota gratisnya 25 credit/bulan (1 credit ≈ 1 GB penyimpanan
atau 1 GB bandwidth), sedangkan gambar di aplikasi ini rata-rata ~0,5 MB.

Alternatifnya object storage apa pun yang ber-API S3 (Cloudflare R2, Supabase
Storage, Backblaze B2, MinIO):

```
STORAGE_PROVIDER=s3
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_BUCKET=nama-bucket
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_PUBLIC_BASE_URL=https://pub-xxxxxxxx.r2.dev   # harus publik: dipakai <img>
S3_FORCE_PATH_STYLE=true                        # hanya untuk MinIO/B2
```

Urutan pemilihan mode: `STORAGE_PROVIDER` eksplisit → Cloudinary → S3 → folder
lokal. Cloudinary bukan S3, jadi mode itu punya jalur sendiri lewat Upload
API-nya; yang disimpan di database adalah `cloudinary://<public_id>` supaya
penghapusan tidak perlu menebak public_id dari URL-nya.

Cara memeriksa mode yang benar-benar aktif:

```bash
# Satu kata ini selalu ada, termasuk di production — di production nilainya
# harus BUKAN "local".
curl -s https://<domain-backend>/health | python3 -c "import sys,json; print(json.load(sys.stdin)['storageMode'])"
# cloudinary | s3 | local

# Di luar production ada detailnya juga (bucket / nama cloud):
curl -s http://localhost:3000/health | python3 -m json.tool | grep -A5 storage
```

Kalau hasilnya `"mode": "local"` di produksi, gambar akan hilang pada deploy
berikutnya. Tanpa kredensial apa pun (lokal/dev), penyimpanan otomatis memakai
folder `uploads/` seperti sebelumnya, jadi tidak ada setup tambahan untuk
development.

Catatan: berkas lama yang sudah hilang tidak bisa dipulihkan. Untuk membuat
riwayat tidak menggantung, `frontend` menampilkan pesan *"berkas gambar ini
sudah tidak ada di server"* di tempat gambar yang gagal dimuat — bukan ikon
gambar rusak berisi teks `alt`.

### Pipeline otomatis (`.github/workflows/deploy.yml`)

Setiap push ke `main` menjalankan tiga job:

1. **quality** — unit test backend + lint & build frontend. Tidak butuh secret;
   kalau gagal, deploy tidak dijalankan.
2. **deploy-backend** — `railway up` lewat **Railway CLI**, dijalankan dari
   **akar repo** sehingga konteks unggahannya sama dengan konteks deployment
   GitHub (subfolder `backend/` terbentuk benar).
3. **deploy-frontend** — **memverifikasi** deployment Vercel untuk commit yang
   di-push lewat REST API: menunggu sampai `READY`, gagal kalau `ERROR` atau
   lewat 10 menit, lalu memastikan `/`, `/login`, dan `/tools/text-to-image`
   benar-benar melayani aplikasi (penjaga untuk aturan `rewrites` SPA).

> **Penting:** job frontend **tidak mengunggah ulang** apa pun. Project Vercel
> terhubung ke repo GitHub dan membangun setiap push ke `main` sendiri
> (`source: git`), jadi `vercel deploy` dari CI hanya menghasilkan build kedua
> untuk commit yang sama. Token yang tersimpan di repo juga jenis token project
> yang ditolak CLI (`vercel whoami` → `User not found`), walau REST API
> menerimanya.
>
> Kalau deploy Vercel dijalankan manual lewat CLI, jalankan dari **akar repo**,
> bukan dari `frontend/`: project menetapkan `rootDirectory: frontend` dan CLI
> menyelesaikan nilai itu relatif terhadap direktori kerja
> (`join(cwd, rootDirectory)`) — dari dalam `frontend/` Vercel mencari
> `frontend/frontend` lalu gagal dengan *"The provided path ... does not
> exist"*.

> **Penting juga (Railway):** service `ai-multimodal-app` terhubung ke repo GitHub
> ini, sedangkan aplikasi backend ada di subfolder `backend`. Tanpa **Root
> Directory** yang diisi, builder RAILPACK mencari `package.json` di akar repo,
> tidak menemukannya, lalu deployment berhenti sekitar 10 detik dengan status
> `FAILED` dan log build yang cuma berisi *scheduling build* — pesan yang tidak
> menunjukkan penyebabnya. Setel **Settings → Source → Root Directory =
> `backend`**. Semua deployment gagal dari `27d209e` sampai `56e571c` berasal
> dari sebab ini, bukan dari kode aplikasi. Deployment pertama yang benar-benar
> menjalankan server adalah yang `rootDirectory: backend` (`SUCCESS`).

Service yang sama juga **auto-deploy dari GitHub** setiap ada push ke `main`
(`repoTriggers` aktif), jadi job `deploy-backend` bersifat pelengkap — bukan
satu-satunya jalur deploy.

Keduanya memakai CLI resmi, bukan action pihak ketiga: workflow lama memakai
`railway/railway-github-action` (repositori action-nya sudah tidak ada) dan
`amondnet/vercel-action@v30` (tag itu tidak pernah ada), sehingga setiap push
gagal di langkah *Set up job* — bukan karena kode aplikasi.

Secret yang wajib ada di repo (**Settings → Secrets and variables → Actions**):

| Secret | Dipakai untuk |
|---|---|
| `RAILWAY_TOKEN` | token project Railway (bukan token akun) |
| `RAILWAY_PROJECT_ID` | project Railway tujuan |
| `RAILWAY_SERVICE` | opsional — nama service Railway bila bukan `ai-multimodal-app` |
| `VERCEL_TOKEN` | token Vercel |
| `VERCEL_ORG_ID` | org/team Vercel |
| `VERCEL_PROJECT_ID` | project Vercel (frontend) |

Deploy bisa dijalankan manual lewat **Actions → Deploy to Railway & Vercel →
Run workflow** (lihat input `deploy_backend` / `deploy_frontend`).

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (React)                         │
│  ┌─────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │   Login     │───▶│ LoginPage    │───▶│ HomePage     │  │
│  │  Register   │───▶│ RegisterPage │───▶│ Dashboard    │  │
│  │             │───▶│ ChatPage     │───▶│ Profile      │  │
│  └─────────────┘    └──────────────┘    └──────────────┘  │
│           │                       │                       │
│           ▼                       ▼                       │
│  Firebase Auth     Axios (JWT token)                        │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                     Backend (Express)                       │
│  ┌─────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │   Auth      │───▶│ auth.js      │───▶│ authCtrl     │  │
│  │   Member    │───▶│ member.js    │───▶│ chatCtrl     │  │
│  │   Admin     │───▶│ admin.js     │───▶│ adminCtrl    │  │
│  └─────────────┘    └──────────────┘    └──────────────┘  │
│                                                  │        │
│  Middleware: auth.js, rateLimit, helmet           │        │
│                                                  ▼        │
│                                            MongoDB Atlas   │
└─────────────────────────────────────────────────────────────┘
```

## Project Structure

```
ai-multimodal-app/
├── backend/
│   ├── config/              # Configuration files
│   ├── controllers/         # Business logic
│   ├── middleware/          # Auth & validation middleware
│   ├── models/              # MongoDB schemas
│   ├── routes/              # API routes
│   ├── scripts/             # Utility scripts (seed admin)
│   ├── tests/               # Unit test (jest)
│   ├── server.js            # Main entry point
│   └── package.json
│
├── frontend/
│   ├── public/              # Static assets
│   ├── tests/browser/       # Uji browser (Chrome headless + CDP)
│   ├── src/
│   │   ├── components/      # Reusable components
│   │   ├── config/          # API & Firebase config
│   │   ├── pages/           # Page components
│   │   ├── App.jsx          # Router
│   │   └── main.jsx         # Entry point
│   └── package.json
│
├── docs/                     # Dokumentasi (setup kredensial, CI secrets)
└── README.md
```

## Future Improvements

### Phase 1: Core Features ✅
- [x] Backend scaffolding
- [x] MongoDB models
- [x] Auth middleware
- [x] Chat system
- [x] Frontend framework
- [x] UI components
- [x] Google authentication
- [x] Admin dashboard (approval member + analytics)
- [x] Referral code & QR code
- [x] Konfigurasi berbasis environment (VITE_* / .env)
- [x] Unit test backend (jest)

### Phase 2: Media Features
- [x] Text-to-Image — provider bisa ditukar (Cloudflare Workers AI gratis / Pollinations tanpa API key / DALL·E 3), plus riwayat & hapus
- [x] Image-to-Image — FLUX.2 [klein] (Cloudflare, gambar input diperkecil di browser), riwayat menyimpan sebelum/sesudah
- [ ] Text-to-Video (RunwayML, Pika Labs)
- [ ] Image-to-Video
- [ ] Text-to-Sound (ElevenLabs)
- [ ] Sound-to-Text (Whisper)

### Phase 3: Enhancements
- [ ] File upload & storage (Firebase Storage/Cloudinary) — saat ini hasil generate disimpan di disk lokal `backend/uploads/`
- [ ] Real-time chat (Socket.io)
- [ ] Admin dashboard with analytics
- [ ] User profile management
- [ ] Subscription plans
- [ ] Rate limiting per feature
- [ ] Caching (Redis)

## Contributing

Panduan lengkapnya ada di **[CONTRIBUTING.md](CONTRIBUTING.md)** — menyiapkan
lingkungan, menjalankan test, gaya commit, konvensi kode, dan hal-hal yang harus
dihindari (terutama jangan sampai ikut meng-commit `.env` beserta salinannya).
Ringkasnya:

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

Sebelum membuka PR, jalankan `cd backend && npm test` dan `cd frontend && npm run lint`.
Keduanya juga dijalankan otomatis oleh CI pada setiap push ke `main` — Pull
Request dari fork tidak ikut diuji, jadi jalankan manual.

## Contributors

| Kontributor | Peran |
|---|---|
| **[Jimmy Faber](https://github.com/Faber-Aritonang)** | Pembuat & pemelihara aplikasi — backend, frontend, dan pipeline deploy |

## License

Dirilis di bawah [MIT License](LICENSE) — Copyright (c) 2026 Jimmy Faber.

## Contact

- **Jimmy Faber** — [GitHub](https://github.com/Faber-Aritonang)
- Repositori: <https://github.com/Faber-Aritonang/ai-multimodal-app>
- Demo: <https://www.maubuatapa.my.id>
- Laporan bug & ide fitur: [Issues](https://github.com/Faber-Aritonang/ai-multimodal-app/issues)

---

**Note**: Proyek ini masih dikembangkan. Fitur inti (chat, text-to-image, image-to-image) sudah berjalan di demo; fitur video & audio masih berstatus feature flag dan baru aktif setelah disetujui admin.
