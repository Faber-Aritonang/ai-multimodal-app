# AI Multimodal Application

Full-stack web application with AI-powered multimodal features including chat, text-to-image, text-to-video, and more. Built with free tech stack, designed for easy scale-up to paid services.

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Quick Start](#quick-start)
- [Backend Setup](#backend-setup)
- [Frontend Setup](#frontend-setup)
- [API Documentation](#api-documentation)
- [Deployment](#deployment)
- [Architecture](#architecture)
- [Future Improvements](#future-improvements)

## Features

### Available Features
- **Chat**: AI-powered conversational chat — provider bisa ditukar (Groq **gratis** sebagai default, Gemini/OpenAI sebagai fallback)
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
| **Chat (LLM)** | Groq + Gemini fallback (endpoint OpenAI-compatible) | ✅ 1.000 request/hari (Groq) | OpenAI / paid tiers |
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
# (Chat: Groq/Gemini gratis · Text-to-Image: Pollinations tanpa key ·
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
CHAT_FALLBACK_PROVIDER=gemini
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
| `text-to-image.spec.cjs` | generate gambar sungguhan, gambar termuat di browser, metadata resolusi+provider (hasil & riwayat), kuota, tombol hapus benar-benar menghapus data di server |
| `image-to-image.spec.cjs` | unggah lewat drag & drop, gambar diperkecil ke ≤512px, preset ukuran ikut bentuk gambar, hasil transformasi, dan — kalau kredensial provider belum ada — pastikan gagal dengan pesan jelas tanpa memakai kuota atau memberi hasil palsu |
| `dashboard-profile.spec.cjs` | dashboard (kartu tool, kuota) & profil (nama, referral, QR, Member Since) dibandingkan dengan data API |

Prasyarat: backend (`cd backend && npm start`) dan frontend
(`cd frontend && npm run dev`) sudah jalan, serta Chrome/Chromium terpasang.

```bash
# Konfigurasi opsional
TEST_BASE_URL=http://localhost:5173   # default
TEST_API_URL=http://localhost:4000    # default
TEST_MEMBER_EMAIL=dev.member@example.com
CHROME_BIN=/path/ke/chrome            # bila Chrome tidak terdeteksi otomatis
```

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

### Backend Deployment (Railway)

1. Push backend to GitHub:
```bash
cd backend
git init
git add .
git commit -m "Initial commit"
git push origin main
```

2. Go to [Railway.app](https://railway.app)
3. Create new project → Deploy from GitHub
4. Set environment variables in Railway dashboard
5. Deploy!

### Frontend Deployment (Vercel)

1. Push frontend to GitHub:
```bash
cd frontend
git init
git add .
git commit -m "Initial commit"
git push origin main
```

2. Go to [Vercel.com](https://vercel.com)
3. Create new project → Import from GitHub
4. Configure project settings
5. Deploy!

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
CHAT_FALLBACK_PROVIDER=gemini
CLOUDFLARE_ACCOUNT_ID=your-cloudflare-account-id
CLOUDFLARE_API_TOKEN=your-cloudflare-api-token
IMAGE_PROVIDER=cloudflare
IMAGE_FALLBACK_PROVIDER=pollinations
```

**Frontend**: Set in Vercel dashboard:
```
VITE_API_URL=https://ai-multimodal-backend.up.railway.app
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

> Jangan lupa menambahkan domain Vercel ke Firebase Console → Authentication →
> Settings → Authorized domains, dan URL Vercel ke `FRONTEND_URL` di Railway.

### Pipeline otomatis (`.github/workflows/deploy.yml`)

Setiap push ke `main` menjalankan tiga job:

1. **quality** — unit test backend + lint & build frontend. Tidak butuh secret;
   kalau gagal, deploy tidak dijalankan.
2. **deploy-backend** — `railway up` lewat **Railway CLI** (mengunggah direktori
   `backend`, Railway membangunnya di sana).
3. **deploy-frontend** — alur resmi **Vercel CLI**: `vercel pull` → `vercel build`
   → `vercel deploy --prebuilt --prod`.

Keduanya memakai CLI resmi, bukan action pihak ketiga: workflow lama memakai
`railway/railway-github-action` (repositori action-nya sudah tidak ada) dan
`amondnet/vercel-action@v30` (tag itu tidak pernah ada), sehingga setiap push
gagal di langkah *Set up job* — bukan karena kode aplikasi.

Secret yang wajib ada di repo (**Settings → Secrets and variables → Actions**):

| Secret | Dipakai untuk |
|---|---|
| `RAILWAY_TOKEN` | token project Railway (bukan token akun) |
| `RAILWAY_PROJECT_ID` | project Railway tujuan |
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

## License

This project is licensed under the MIT License.

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## Contact

Project by [Faber-Aritonang](https://github.com/Faber-Aritonang)

---

**Note**: This is a work-in-progress project. Media generation features will be added in subsequent iterations.