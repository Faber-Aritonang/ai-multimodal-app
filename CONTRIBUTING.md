# Panduan Kontribusi

Terima kasih sudah tertarik membantu **AI Multimodal Application**. Dokumen ini
menjelaskan cara menyiapkan lingkungan, standar perubahan, dan hal-hal yang
paling sering membuat pull request tertahan.

## Sebelum mulai

- Node.js 20+ dan npm (versi yang dipakai CI)
- MongoDB — lokal (Docker) atau Atlas
- Chrome/Chromium, hanya kalau ingin menjalankan uji browser

Panduan kredensial (Groq, Gemini, OpenRouter, Cloudflare, Cloudinary, Firebase,
penyimpanan media) ada di [`docs/setup-kredensial.md`](docs/setup-kredensial.md).
Daftar variabel lengkap: [`backend/.env.example`](backend/.env.example).

## Menyiapkan lingkungan

```bash
git clone https://github.com/Faber-Aritonang/ai-multimodal-app.git
cd ai-multimodal-app

# Backend
cd backend
npm install
cp .env.example .env     # isi minimal MONGODB_URI, JWT_SECRET, dan satu key chat
npm run dev

# Frontend (terminal terpisah)
cd frontend
npm install
npm run dev              # http://localhost:5173
```

Kalau MongoDB dijalankan lewat Docker, nyalakan container-nya **sebelum**
`npm run dev`:

```bash
docker start ai-multimodal-mongo
```

Backend berhenti (`process.exit(1)`) saat koneksi database gagal, dan nodemon
hanya akan menunggu perubahan berkas — gejalanya "backend tidak mau jalan" tanpa
pesan yang jelas.

## Alur kontribusi

1. Fork repo, lalu buat branch dari `main`: `git checkout -b fix/nama-singkat`
2. Kerjakan satu hal saja per pull request
3. Tambahkan atau sesuaikan test untuk perilaku yang berubah
4. Jalankan pemeriksaan di bawah sampai bersih
5. Commit, push ke fork Anda, lalu buka Pull Request ke `main`

> CI di repo ini hanya berjalan untuk push ke `main`, jadi Pull Request dari fork
> **tidak** otomatis diuji. Pastikan pemeriksaan di bawah sudah Anda jalankan.

## Pemeriksaan sebelum membuka PR

```bash
cd backend && npm test          # unit test, tanpa MongoDB/Firebase
cd frontend && npm run lint     # ESLint (dijalankan dengan --fix)
cd frontend && npm run build    # pastikan build produksi lolos

# Opsional: uji browser sungguhan
# butuh backend + frontend hidup dan Chrome terpasang
cd frontend && npm run test:browser
```

Menjalankan satu berkas test saja saat memperbaiki sesuatu:

```bash
cd backend && npx jest tests/chatProviders.test.js
```

Uji browser memakai akun dev member, jadi setiap eksekusi memakai 1 kuota chat
dan 1 kuota gambar. Rinciannya (termasuk cara menjalankan satu spec) ada di
bagian *Testing & Linting* pada [README](README.md#testing--linting).

## Gaya commit

Awali pesan dengan jenis perubahan, lalu jelaskan **alasan**-nya, bukan sekadar
apa yang diubah:

```
feat(chat): tambah OpenRouter sebagai cadangan chat gratis
fix(chat): jadikan provider berkey selalu ikut sebagai cadangan
docs: rapikan README, tambahkan link demo dan kontributor
chore: tambahkan .mailmap untuk satu identitas kontributor
```

Jenis yang dipakai: `feat`, `fix`, `docs`, `chore`, `refactor`, `ci`, `test`.
Lingkup dalam tanda kurung bersifat opsional (`chat`, `media`, `backend`,
`frontend`).

## Konvensi kode

- **Bahasa**: komentar dan dokumentasi berbahasa Indonesia mengikuti isi repo.
- **Konfigurasi lewat environment** dengan default yang wajar di kode
  (`backend/config/*.js`). Fitur opsional tidak boleh menuntut key baru: ikuti
  pola `isConfigured()` pada provider sehingga key yang kosong membuat fitur itu
  dilewati, bukan error.
- **Provider AI baru** (chat/gambar) ditambahkan di
  `backend/config/chatProviders.js` atau `backend/config/imageProviders.js`,
  mengikuti provider yang sudah ada, lengkap dengan test.
- **Frontend**: halaman di `frontend/src/pages`, komponen di
  `frontend/src/components`, pemanggilan API lewat `frontend/src/config/api.js`.
- **Dependency**: utamakan yang sudah ada. Dua contoh nyata: provider
  OpenAI-compatible memakai SDK yang sudah dipakai provider lain, dan uji
  browser memakai `fetch`/`WebSocket` bawaan Node tanpa paket tambahan.
- **Dokumentasi ikut diperbarui** kalau env berubah: `backend/.env.example`,
  bagian yang relevan di `README.md`, `docs/setup-kredensial.md`, dan
  `docs/env-produksi-railway.md`.

## Jangan pernah commit rahasia

Repo ini **publik**. Yang di-track hanya `backend/.env.example`.

- Jangan commit `backend/.env` atau salinannya (`.env.save`, `.env.save.1`, …).
  Salinan seperti itu mudah terbentuk saat mengubah kredensial, dan isinya sama
  rahasianya dengan aslinya.
- Jangan mencetak nilai rahasia ke log. `/health` hanya melaporkan status
  `configured`/`missing`, dan blok detail provider hanya muncul di luar
  production.
- Kredensial produksi diisi di dashboard platform (Railway/Vercel), bukan di
  repo.

## Menambah provider atau model

Provider chat dan model gratisnya bisa ditambah tanpa mengubah kode:
`CHAT_PROVIDER`, `CHAT_FALLBACK_PROVIDER`, dan `OPENROUTER_CHAT_MODEL` menerima
daftar dipisah koma. Hasil pengukuran model yang pernah dicoba (termasuk yang
tidak layak dipakai) ada di bagian 3c `docs/setup-kredensial.md` — periksa dulu
sebelum menambah model baru, lalu ukur ulang lewat kode provider yang asli.

## Melaporkan bug

Sertakan: langkah reproduksi, hasil yang diharapkan vs yang terjadi, commit yang
dipakai, dan — kalau menyangkut fitur AI — provider/model yang tampil di badge
balasan (`via groq`, `via openrouter`, …). Bug bisa dilaporkan lewat
[Issues](https://github.com/Faber-Aritonang/ai-multimodal-app/issues).

## Lisensi

Dengan berkontribusi, Anda menyetujui bahwa kontribusi Anda dilisensikan di
bawah [MIT License](LICENSE).
