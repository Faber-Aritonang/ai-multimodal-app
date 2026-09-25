# Backup & Restore Database

Prosedur menyelamatkan data aplikasi bila ada yang terhapus atau tertimpa.

Bacaan terkait: [`env-produksi-railway.md`](./env-produksi-railway.md) (variabel
produksi), [`rotasi-kredensial.md`](./rotasi-kredensial.md) (kredensial yang
pernah bocor).

---

## A. Kenapa ini ada

Database produksi berjalan di **MongoDB Atlas free tier**, dan tier itu **tidak
punya point-in-time recovery otomatis**. Yang tersedia hanya snapshot manual
tanpa jadwal. Artinya:

- satu `deleteMany` tanpa filter (atau satu skrip yang salah menyambung ke
  database produksi) menghapus riwayat gambar, audio, dan percakapan seluruh
  user **secara permanen**;
- sampai dokumen ini dibuat, tidak ada satu pun berkas di repo ini yang bisa
  memulihkannya.

Karena itu backup tidak diandalkan pada satu perintah manual yang lupa
dijalankan: prosedurnya ditulis, skripnya bisa dijalankan di mana saja repo ini
bisa dijalankan (tanpa memasang `mongodump`), dan isi berkasnya bisa
**diverifikasi** sebelum dipakai memulihkan.

## B. Apa yang dihasilkan

Satu folder berisi satu berkas NDJSON per koleksi (satu dokumen per baris) plus
`manifest.json`:

```
backend/backups/2026-09-24_16-12-06/
├── admins.ndjson
├── chatmessages.ndjson
├── mediacontents.ndjson
├── users.ndjson
└── manifest.json
```

```json
{
  "format": "ai-multimodal-backup",
  "version": 1,
  "createdAt": "2026-09-24T16:12:06.265Z",
  "host": "cluster0.xxxxx.mongodb.net",
  "database": "ai-multimodal",
  "collections": [
    {
      "name": "users",
      "file": "users.ndjson",
      "documents": 12,
      "bytes": 8123,
      "sha256": "…"
    }
  ]
}
```

Nilai BSON ditandai eksplisit supaya kembali utuh saat dipulihkan: `ObjectId`
sebagai `{"$oid":"…"}`, tanggal sebagai `{"$date":"…"}`, dan biner sebagai
`{"$binary":"…"}`. Tanpa penanda ini, `_id` dan `createdAt` kembali sebagai
**string** — dokumennya tampak benar tetapi tidak cocok dengan relasi mana pun
(lihat `backend/config/backup.js`).

`manifest.json` **tidak memuat kredensial**: hanya host dan nama database
(`bacaTujuan`). Manifest adalah berkas yang paling mungkin ikut dibagikan, dan
repo ini publik.

## C. Membuat backup

```bash
cd backend
npm run backup:db                                  # ke backups/<waktu-sekarang>/
npm run backup:db -- --out backups/sebelum-migrasi # nama folder sendiri
npm run backup:db -- --only users,mediacontents    # hanya koleksi tertentu
npm run backup:db -- --exclude chatmessages        # kecualikan koleksi tertentu
```

Skripnya **hanya membaca** database: tidak ada tulis, tidak ada drop, dan tidak
ada indeks yang diubah. Aman dijalankan selagi aplikasi melayani, dengan satu
catatan: dokumen yang berubah tepat saat backup berjalan bisa terbaca dalam
keadaan setengah jalan, jadi untuk backup yang dipakai sebagai titik pulih
jalankan saat pemakaian sedang sepi.

Keluaran yang diharapkan (isi nyata tentu berbeda):

```
Backup ke: /path/backend/backups/2026-09-24_16-12-06
Host: cluster0.xxxxx.mongodb.net  Database: ai-multimodal
  chatmessages: 143 dokumen, 51230 byte
  mediacontents: 87 dokumen, 30221 byte
  users: 12 dokumen, 8123 byte
Selesai: 3 koleksi, 242 dokumen.
Manifest: /path/backend/backups/2026-09-24_16-12-06/manifest.json
Simpan folder ini di luar repo (isi database memuat data user).
```

## D. Memulihkan

Defaultnya **hanya melihat**. Tidak ada satu dokumen pun ditulis tanpa `--yes`:

```bash
cd backend

# 1. Lihat rencananya (memeriksa manifest + checksum tiap berkas)
npm run restore:db -- --dir backups/2026-09-24_16-12-06

# 2. Jalankan: dokumen yang sudah ada dilewati (aman diulang)
npm run restore:db -- --dir backups/2026-09-24_16-12-06 --yes

# 3. Jalankan dengan mengganti isi koleksi (kembali ke keadaan snapshot)
npm run restore:db -- --dir backups/2026-09-24_16-12-06 --yes --replace
```

Kalau `--dir` tidak disebut, folder backup **terbaru** di `backend/backups/`
yang dipakai.

| Flag | Artinya |
|---|---|
| `--dir <folder>` | folder sumber; bawaannya backup terbaru |
| `--yes` | benar-benar menulis (wajib; tanpa ini hanya laporan) |
| `--replace` | hapus isi koleksi tujuan lebih dulu, lalu isi ulang |
| `--only a,b` / `--exclude c` | batasi koleksi yang dipulihkan |
| `--skip-checksum` | lewati pemeriksaan checksum (hanya bila berkasnya ditambal sendiri) |
| `--allow-production` | wajib bila `NODE_ENV=production` |

### Mode GABUNG vs GANTI

| | GABUNG (bawaan) | GANTI (`--replace`) |
|---|---|---|
| Menghapus data yang ada | tidak | ya, seluruh isi koleksi tujuan |
| Dokumen yang `_id`-nya sama | dilewati, dihitung | ditulis ulang |
| Aman diulang | ya | ya, tetapi hasilnya selalu = snapshot |
| Cocok untuk | memulihkan data yang hilang sebagian | memutar balik kesalahan massal |

## E. Pengaman yang terpasang

1. **Manifest diperiksa lebih dulu.** Folder yang salah pilih (`--dir` keliru)
   berhenti dengan pesan jelas sebelum menyentuh database.
2. **Ukuran dan checksum tiap berkas diperiksa** sebelum satu dokumen pun
   ditulis. Backup yang terpotong — mis. proses dimatikan di tengah — ketahuan
   di langkah ini, bukan setelah koleksinya dikosongkan.
3. **`--yes` wajib.** Tanpa itu skripnya hanya melapor.
4. **`NODE_ENV=production` menuntut `--allow-production`.** Restore ke produksi
   sering memang tujuannya, tetapi tidak boleh terjadi karena variabel
   lingkungan yang tertinggal di terminal.
5. **Nama koleksi divalidasi** sebelum dipakai sebagai nama berkas, sehingga
   koleksi bernama aneh tidak bisa menulis di luar folder backup.
6. **`backend/backups/` diabaikan git** (`.gitignore`). Isinya data user: email,
   prompt, isi percakapan.

## F. Latihan pemulihan (drill)

Backup yang belum pernah dipulihkan bukan backup — ia hanya berkas. Latihannya
murah dan cukup dilakukan sekali, lalu diulang setiap kali skripnya berubah.

### F.1 Yang sudah diperiksa di repo ini (24 September 2026)

| Yang diuji | Cara | Hasil |
|---|---|---|
| Logika serialisasi & manifest | `npx jest tests/backup.test.js` | 36 test lolos (ObjectId/Date/Buffer kembali utuh, manifest rusak ditolak, checksum & ukuran terverifikasi) |
| Restore mode uji pada folder sintetis | `npm run restore:db -- --dir /tmp/backup-drill` | manifest dibaca, 2 berkas diperiksa, "Mode uji (tanpa --yes): tidak ada yang ditulis" — **exit 0** |
| Berkas yang diubah setelah backup | satu baris ditambahkan ke `users.ndjson` | `users.ndjson: RUSAK — ukurannya 271 byte, manifest mencatat 258`, restore dihentikan — **exit 1** |
| Folder tanpa manifest | `npm run restore:db -- --dir /tmp` | `Error: /tmp/manifest.json tidak ada` — **exit 1** |
| `--yes` tanpa database | `MONGODB_URI=mongodb://localhost:27017/uji npm run restore:db -- --dir … --yes` | `Restore gagal: connect ECONNREFUSED` — **exit 1**, bukan sukses palsu |

**Belum diuji di lingkungan itu:** pemulihan sungguhan ke cluster MongoDB, karena
tidak ada MongoDB di mesin pengembangan ini. Langkah di bawah adalah bagian yang
harus dijalankan sekali oleh pemilik proyek.

### F.2 Drill yang perlu dijalankan sekali (butuh cluster)

Lakukan di database **uji**, bukan database produksi:

```bash
cd backend

# 1. Backup database produksi (read-only)
npm run backup:db -- --out backups/drill

# 2. Arahkan MONGODB_URI ke database UJI, mis. db bernama `ai-multimodal-drill`
#    (nama database ada di akhir URI, sebelum tanda `?`)
export MONGODB_URI='mongodb+srv://…/ai-multimodal-drill?retryWrites=true&w=majority'

# 3. Pulihkan ke database uji
npm run restore:db -- --dir backups/drill --yes

# 4. Bandingkan jumlah dokumen dengan manifest
#    Angka di kolom `documents` manifest harus sama dengan `terpasang` di ringkasan.
```

Yang dianggap **berhasil**: setiap koleksi melaporkan `0 gagal`, jumlah
`terpasang` sama dengan `documents` di manifest, dan aplikasi bisa dibuka dengan
`MONGODB_URI` yang menunjuk database uji (login, buka Riwayat, buka satu hasil).

Kalau ada koleksi yang `terlewat` (bukan `gagal`), itu berarti dokumennya sudah
ada di tujuan — perilaku normal mode GABUNG, bukan kerusakan.

## G. Jadwal dan penyimpanan salinan

| Kapan | Perintah | Alasan |
|---|---|---|
| Sebelum setiap perubahan skema/data | `npm run backup:db -- --out backups/sebelum-<ubahannya>` | titik pulih yang bisa dibandingkan setelahnya |
| Rutin (mis. mingguan, atau setelah ada data penting) | `npm run backup:db` | menutup celah hilangnya data akibat kesalahan yang tidak disadari |
| Sebelum restore GANTI | backup lagi | `--replace` menghapus isi koleksi tujuan |

Aturan menyimpan salinan:

- **Di luar working tree.** `backend/backups/` hanya untuk pemulihan cepat di
  mesin sendiri; folder itu di-`gitignore` dan tetap bisa hilang bila mesinnya
  rusak.
- **Tidak pernah masuk repo.** Repo ini publik, dan isi backup memuat data user.
  Berkas yang di-commit tidak bisa "dibatalkan" — lihat
  [`rotasi-kredensial.md`](./rotasi-kredensial.md) untuk pelajaran mahalnya.
- **Simpan di tempat yang berbeda dari databasenya** (drive pribadi, arsip
  terenkripsi). Backup yang tersimpan di akun yang sama dengan database-nya
  tidak menolong saat akunnya bermasalah.
- **Berikan batas waktu simpan.** Backup berisi data pribadi user; yang tidak
  lagi diperlukan sebaiknya dihapus, bukan disimpan selamanya.

## H. Batasan yang perlu diketahui

- **Bukan point-in-time recovery.** Yang dipulihkan adalah keadaan *saat backup
  dibuat*. Perubahan setelah itu tidak ada di dalamnya.
- **Bukan replika.** Backup tidak mengambil alih peran database; ia hanya berkas
  yang bisa dipulihkan.
- **Belum otomatis.** Belum ada job terjadwal yang menjalankannya, karena
  menjalankan backup terjadwal ke folder yang sama dengan cepat menghabiskan
  ruang disk tanpa ada yang menghapusnya. Kalau nanti dijadwalkan (mis. lewat
  cron di mesin sendiri), tambahkan dulu aturan retensi.
- **Ukuran berkas mengikuti jumlah media yang disimpan.** Yang disimpan di
  dokumen hanyalah URL/referensi berkas, bukan isi gambarnya, jadi ukurannya
  jauh lebih kecil dari folder `uploads/` — tetapi media milik user tetap perlu
  salinan sendiri bila penyimpanannya lokal (mode `cloudinary`/`s3` menyimpannya
  di luar database).

## I. Berkas terkait

| Berkas | Isinya |
|---|---|
| `backend/config/backup.js` | logika murni: serialisasi BSON, nama berkas, manifest, verifikasi |
| `backend/scripts/backupDb.js` | CLI backup (read-only) |
| `backend/scripts/restoreDb.js` | CLI restore (mode uji / gabung / ganti) |
| `backend/tests/backup.test.js` | test logika di atas |
