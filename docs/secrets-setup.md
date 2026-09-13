# GitHub Actions Secrets Setup

## Required Secrets

Set these secrets di GitHub Repository → Settings → Secrets and variables → Actions:

### Backend (Railway)

1. **RAILWAY_TOKEN** (string)
   - Dapat dari: Railway Dashboard → Settings → API Tokens → Create Token
   - Scope: `read:projects`, `write:deployments`

2. **RAILWAY_PROJECT_ID** (string)
   - Dapat dari: Railway Dashboard → Project Settings → Project Information

### Frontend (Vercel)

3. **VERCEL_TOKEN** (string)
   - Dapat dari: Vercel Dashboard → Settings → Tokens → Create Token

4. **VERCEL_ORG_ID** (string)
   - Dapat dari: Vercel Dashboard → Settings → General → Team ID

5. **VERCEL_PROJECT_ID_FRONTEND** (string)
   - Dapat dari: Vercel Dashboard → Project Settings → General → Project ID

### Firebase (untuk backend)

6. **FIREBASE_SERVICE_ACCOUNT_KEY** (JSON)
   - Dari: Firebase Console → Project Settings → Service Accounts → Generate New Private Key
   - Salin seluruh isi JSON file

### OpenAI (untuk chat)

7. **OPENAI_API_KEY** (string)
   - Dari: https://platform.openai.com/api-keys

---

## Setup Instructions

### 1. Install Railway CLI
```bash
npm install -g railway
railway login
```

### 2. Inisialisasi Railway Project
```bash
cd backend
railway init
railway up
```

Setelah berhasil, Railway akan memberikan:
- Project ID
- API Token

### 3. Deploy Frontend ke Vercel
```bash
cd frontend
npm install -g vercel
vercel --login
vercel
```

Setelah berhasil, Vercel akan memberikan:
- Project ID
- Organization ID
- Token

---

## Alternatif: Manual Deploy

Jika tidak ingin menggunakan GitHub Actions, deploy manual:

### Backend ke Railway
```bash
cd backend
railway up
```

### Frontend ke Vercel
```bash
cd frontend
vercel --prod
```

---

## Environment Variables (Backend)

Set di Railway Dashboard → Project → Settings → Variables:

| Variable | Contoh Value | Deskripsi |
|----------|--------------|-----------|
| MONGODB_URI | mongodb+srv://... | MongoDB connection string |
| JWT_SECRET | random-32-char-string | JWT signing secret |
| NODE_ENV | production | Environment |
| OPENAI_API_KEY | sk-... | OpenAI API key |
| FIREBASE_SERVICE_ACCOUNT | JSON di secrets | Firebase service account |
| PORT | 3000 | Server port |

### Generate JWT Secret
```bash
openssl rand -base64 32
```