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
- `RAILWAY_TOKEN` di sini adalah **project token**, bukan token akun, dan
  keduanya memakai variabel yang **berbeda**: project token lewat
  `RAILWAY_TOKEN`, token akun/workspace lewat `RAILWAY_API_TOKEN`. Versi lama
  dokumen ini menulis "memakai variabel yang sama" — itu tidak benar. Token akun
  yang ditaruh di `RAILWAY_TOKEN` akan diperlakukan sebagai project token dan
  ditolak `Unauthorized`.

## `RAILWAY_TOKEN` harus milik project yang benar

Project token terikat pada **satu project dan satu environment**. Kalau ia dibuat
untuk project lain, `railway up` menolaknya — dan pesan yang muncul tidak selalu
menyebut sebabnya (lihat dua gejalanya di bawah).

Itu penyebab nyata job `deploy-backend` merah di **setiap** run: token yang
terpasang dibuat di project `vibrant-victory` (13 Sep 2026, 15:18), sedangkan
service `ai-multimodal-app` ada di project `truthful-imagination` (dibuat 15:36
di hari yang sama). Karena tokennya tidak punya akses ke project itu, tidak ada
satu pun deployment yang pernah dihasilkan oleh `railway up`.

**Dua gejala, satu sebab.** Pesan yang muncul tergantung apa yang ditemukan
lebih dulu, jadi keduanya harus dikenali sebagai masalah yang sama:

```text
Unauthorized. Please check that your RAILWAY_TOKEN is valid and has access to the
resource you're trying to use.
```

```text
Service 'ai-multimodal-app' not found
```

Gejala kedua (terukur 22 Sep 2026, CLI 5.59.0, run `35708660353`) muncul saat
project yang dipakai — entah dari `RAILWAY_PROJECT_ID`, entah dari tokennya
sendiri — tidak memuat service bernama itu. Pesannya menyesatkan: yang perlu
diperiksa bukan nama service-nya, melainkan **project**-nya. Pemetaan
project → id → service, tanpa membuka dashboard:

```bash
railway list --json | python3 -c "
import json, sys
for p in json.load(sys.stdin):
    print(p['name'], p['id'], [e['node']['name'] for e in (p.get('services') or {}).get('edges', [])])
"
# truthful-imagination d63db879-cc03-4d43-840c-4caf2e9710c9 ['ai-multimodal-app']
# vibrant-victory      4eeb42e9-a5b0-4108-8d85-aad7ef71af37 ['pretty-connection']
```

**Cara memastikan.** Buka Railway → project yang benar
(`truthful-imagination`) → *Project Settings* → **Tokens**. Token yang dipakai
harus muncul di daftar project itu. Kalau tidak muncul, ia milik project lain
atau memang token akun.

**Perbaikan.** Buat token baru dari halaman itu dengan environment `production`,
lalu perbarui secret `RAILWAY_TOKEN` di GitHub. Periksa sekaligus
`RAILWAY_PROJECT_ID`: harus
`d63db879-cc03-4d43-840c-4caf2e9710c9`.

> Project `truthful-imagination` juga punya environment sisa bernama
> `" MONGODB_URI"` (dengan spasi di depan) — akibat nilai variabel yang pernah
> tertempel ke kolom "environment baru". Hapus supaya tidak terpilih keliru saat
> membuat token, karena environment yang dipilih menentukan token ini bisa
> dipakai di mana.

**Sejak 22 Sep 2026, sebabnya dipisahkan sendiri oleh CI.** Job `deploy-backend`
dimulai dengan step `Kenali kredensial Railway` yang membaca daftar project yang
bisa diakses token, lalu membandingkannya dengan `RAILWAY_PROJECT_ID` dan nama
service. Hasilnya dinaikkan jadi anotasi job, jadi terbaca dari halaman commit
tanpa membuka log:

| Temuan | Arti & tindakan |
|---|---|
| `::notice::Kredensial cocok: …` | kedua secret sudah menunjuk project yang benar |
| `::error::Project X tidak memuat service Y` + baris `RAILWAY_PROJECT_ID untuk service Y adalah <id>` | project-nya salah; pakai id yang disebut baris berikutnya |
| `::warning::Token Railway ini tidak bisa membaca daftar project` | token yang dipasang adalah token **project** (hanya berlaku di project tempat ia dibuat) atau sudah dicabut |

Step itu **tidak pernah menggagalkan job** (`continue-on-error: true`) — penilainya
tetap step deploy; ia hanya memisahkan dua sebab yang pesannya sama persis.

**Akibat samping yang perlu diketahui:** karena step `Deploy ke Railway` adalah
step paling awal di job itu, kegagalannya membuat step sesudahnya — termasuk
`Verifikasi produksi - database, penyimpanan & kredensialnya` — berstatus
*skipped*. Artinya selama token ini masih salah, pemeriksaan kredensial
penyimpanan **tidak pernah berjalan di CI**, meskipun kodenya ada. Selama itu
pula satu-satunya cara memeriksanya adalah `curl` manual ke `/health`.

## Verifikasi deploy: kode yang live harus commit yang di-push

Job `deploy-backend` dulu hanya tahu "perintah deploy-nya selesai", dan itu tidak
membedakan "kode baru sudah live" dari "deploy gagal sementara kode lama masih
melayani user" — yang kedua tetap terlihat hijau. Pemeriksaan `/health` yang lain
(database, penyimpanan, kredensialnya) membaca kolom yang sama benarnya di kode
lama maupun baru, jadi tak satu pun menangkapnya. Karena itu `/health`
melaporkan commit yang berjalan, dan step `Verifikasi produksi` menuntut nilainya
sama dengan `GITHUB_SHA`:

| Keadaan di `/health` | Perilaku job |
|---|---|
| `commit` sama dengan commit yang di-push | `::notice::` — deploy terbukti |
| `commit` berbeda | `::error::` dan job **gagal** (setelah menunggu sampai 5 menit, karena deployment barunya bisa jadi masih berjalan) |
| `commit` tidak dilaporkan | `::warning::` — deployment sebelum kolom ini ada memang belum memuatnya; pada deploy berikutnya, ketiadaannya berarti penandanya tidak terbaca |

Kolom `commitSource` menyebut jalur penandanya, karena hanya salah satu jalur
yang membawa metadata git: Railway mengisi `RAILWAY_GIT_COMMIT_SHA` untuk
deployment dari **integrasi GitHub**, sedangkan `railway up` mengunggah direktori
lokal tanpa metadata git — karena itu step `Deploy ke Railway` menulis
`backend/build-meta.json` sebelum mengunggah dan menghapusnya lagi sesudahnya
(`trap`). Berkas itu sengaja **tidak** masuk `.gitignore`: `railway up`
menghormati `.gitignore` (lihat flag `--no-gitignore` di CLI-nya), sehingga
berkas yang di-ignore justru hilang dari unggahan.

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
**Text-to-sound tidak butuh variabel apa pun**: Edge TTS (suara neural Indonesia
bawaan Microsoft) melayaninya tanpa kunci API. Opsional, `GEMINI_API_KEY` yang
sudah dipakai fitur chat juga menjadi provider suara dengan logat yang bisa
diarahkan (gratis, tanpa billing), dan `ELEVENLABS_API_KEY` menyediakan
cadangan free tier 10.000 karakter/bulan. MiMo (`MIMO_API_KEY`) hanya mendukung
Mandarin/Inggris. Fitur yang key-nya belum ada tetap tampil di UI tetapi
menjawab dengan pesan yang menyebut variabel mana yang harus diisi.

### Mengisi variabel lewat CLI

```bash
openssl rand -base64 32 | railway variable set JWT_SECRET --stdin \
  --service ai-multimodal-app --environment production --project "$PROJECT"
```

Nilai dibaca dari stdin sehingga tidak masuk ke daftar argumen proses maupun
riwayat shell. Mengubah variabel memicu deploy ulang otomatis. Hati-hati:
`railway variable list --json` mencetak **nilai** semua variabel, bukan hanya
namanya.

---

## Kalau ada kredensial yang bocor

Menghapus berkas dari commit berikutnya tidak cukup — isinya tetap terbaca dari
riwayat git, jadi kredensialnya harus diganti di provider. Langkah per kunci,
termasuk cara memverifikasi kunci lama benar-benar sudah mati, ada di
[`rotasi-kredensial.md`](./rotasi-kredensial.md).
