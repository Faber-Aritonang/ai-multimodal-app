# GitHub Actions Secrets Setup

Berkas ini melengkapi [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml),
yang merupakan sumber kebenaran untuk daftar secret-nya. Kalau keduanya berbeda,
workflow yang benar.

## Required Secrets

Set di GitHub Repository → Settings → Secrets and variables → Actions:

| Secret | Wajib | Dipakai job | Dari mana |
|---|---|---|---|
| `RAILWAY_TOKEN` | ya | `deploy-backend` | Railway → Project Settings → **Tokens** → Create Token |
| `RAILWAY_PROJECT_ID` | ya | `deploy-backend` | Railway → Project Settings → Project Information |
| `VERCEL_TOKEN` | ya | `deploy-frontend` | Vercel → Settings → Tokens → Create Token |
| `VERCEL_PROJECT_ID` | ya | `deploy-frontend` | Vercel → Project Settings → General → Project ID |
| `RAILWAY_SERVICE` | tidak | `deploy-backend` | hanya perlu kalau nama service bukan `ai-multimodal-app` |

Catatan nama yang mudah salah:

- Secretnya bernama **`VERCEL_PROJECT_ID`**. Versi lama dokumen ini menulis
  `VERCEL_PROJECT_ID_FRONTEND`; nama itu membuat `project-id` terkirim **kosong**
  dan job verifikasi gagal seolah-olah tokennya yang salah. `VERCEL_ORG_ID`
  tidak dipakai workflow ini, jadi tidak perlu diisi.
- `RAILWAY_TOKEN` di sini adalah **project token**, bukan token akun. Token akun
  (`railway login`) dan project token memakai variabel yang sama tetapi tidak
  bisa saling menggantikan.

## Catatan untuk job `quality` di CI

Job **quality** (unit test backend + lint + build frontend) berjalan sebelum
deploy dan **tidak membutuhkan secret apa pun**: test backend memakai mock tanpa
MongoDB/Firebase. Build di job ini juga tidak butuh `VITE_*`, karena bundle
produksi dibangun ulang di sisi Vercel memakai environment variables di
dashboard Vercel.

---

## Setup Instructions

### 1. Install Railway CLI

```bash
npm install --global @railway/cli
railway login            # atau: export RAILWAY_TOKEN='…' untuk non-interaktif
```

### 2. Hubungkan ke project Railway

```bash
railway link --project "<RAILWAY_PROJECT_ID>"
```

> **Penting — `railway up` dijalankan dari AKAR repo, bukan dari `backend/`.**
> Service Railway menetapkan `rootDirectory: backend`, dan builder
> menggabungkannya dengan konteks unggahan. Mengunggah direktori `backend`
> membuat builder mencari `backend/backend` lalu gagal dengan deployment
> `FAILED` bertanda `commit=-`, tanpa log build yang menjelaskan sebabnya.
> Dari akar repo, konteks unggahan sama dengan konteks deployment GitHub
> sehingga `backend/` terbentuk benar.
>
> ```bash
> # dari akar repo
> railway up --service ai-multimodal-app --environment production --ci
> ```
>
> Tanpa `--detach`, perintah ini menunggu build selesai dan gagal kalau
> build-nya gagal — itu yang membuat statusnya jujur.

### 3. Deploy Frontend (Vercel)

Project Vercel terhubung ke repo GitHub dan membangun setiap push ke `main`
sendiri (`source: git`), jadi **tidak perlu** `vercel --prod` dari mesin lokal:
mengunggah lagi hanya menghasilkan dua build untuk commit yang sama. Job
`deploy-frontend` hanya *memverifikasi* hasilnya lewat REST API.

---

## Environment Variables (Backend)

Ini **variabel runtime** milik service Railway, bukan secret GitHub Actions.
Daftar lengkap beserta efek tiap variabel kalau salah ada di
[`env-produksi-railway.md`](./env-produksi-railway.md) — sengaja tidak
diduplikasi di sini agar tidak ada dua sumber yang bisa saling menyimpang.

Minimum supaya aplikasi hidup (bukan sekadar build hijau):

| Variabel | Contoh | Guna |
|---|---|---|
| `NODE_ENV` | `production` | mengaktifkan `trust proxy` dan mematikan route `dev-login` |
| `MONGODB_URI` | `mongodb+srv://…` | database; gagal connect → proses keluar |
| `JWT_SECRET` | `openssl rand -base64 32` | menandatangani token login |
| `FRONTEND_URL` | `https://ai-multimodal-app.vercel.app,https://maubuatapa.my.id` | CORS |
| `CLOUDINARY_CLOUD_NAME`<br>`CLOUDINARY_API_KEY`<br>`CLOUDINARY_API_SECRET` | dari dashboard Cloudinary | penyimpanan media; tanpa ini mode jatuh ke `local` dan gambar user hilang tiap deploy |
| `FIREBASE_SERVICE_ACCOUNT` | JSON dalam satu baris, atau path | login Google |

Untuk fitur AI, tambahkan minimal satu provider chat (`GROQ_API_KEY`,
`GEMINI_API_KEY`, atau `OPENROUTER_API_KEY`) dan kredensial Cloudflare
(`CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN`) untuk text-to-image.

### Mengisi variabel lewat CLI

```bash
railway variables --service ai-multimodal-app --environment production \
  --set "JWT_SECRET=$(openssl rand -base64 32)"
```

Mengubah variabel memicu deploy ulang otomatis. Hati-hati:
`railway variables --json` mencetak **nilai** semua variabel, bukan hanya
namanya.

---

## Kalau ada kredensial yang bocor

Menghapus berkas dari commit berikutnya tidak cukup — isinya tetap terbaca dari
riwayat git, jadi kredensialnya harus diganti di provider. Langkah per kunci,
termasuk cara memverifikasi kunci lama benar-benar sudah mati, ada di
[`rotasi-kredensial.md`](./rotasi-kredensial.md).
