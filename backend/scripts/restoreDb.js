#!/usr/bin/env node
/**
 * Skrip: restore database dari folder backup.
 *
 * Pemakaian:
 *   npm run restore:db -- --dir backups/2026-09-24_16-12-06            # hanya MELIHAT
 *   npm run restore:db -- --dir backups/2026-09-24_16-12-06 --yes      # tulis (gabung)
 *   npm run restore:db -- --dir backups/... --yes --replace            # tulis (ganti isi)
 *
 * Kenapa defaultnya hanya melihat: satu-satunya cara skrip ini merusak data
 * adalah menulis ke database yang salah, dan itu terjadi karena orang menekan
 * Enter tanpa membaca. Tanpa `--yes` skrip ini hanya melaporkan apa yang AKAN
 * dikerjakannya.
 *
 * Dua mode tulis:
 *   (bawaan)  GABUNG  — dokumen dimasukkan; _id yang sudah ada dilewati dan
 *                       dilaporkan jumlahnya. Aman diulang, tidak menghapus
 *                       apa pun.
 *   --replace         — isi koleksi tujuan dihapus lebih dulu, lalu diisi ulang
 *                       dari backup. Ini "kembalikan ke keadaan snapshot".
 *
 * Keseluruhan berkas diperiksa terhadap `manifest.json` (ukuran + checksum)
 * SEBELUM satu dokumen pun ditulis. Backup yang terpotong — mis. proses yang
 * dimatikan di tengah — harus ketahuan di langkah ini, bukan setelah koleksinya
 * dikosongkan. Gunakan `--skip-checksum` hanya kalau Anda memang menambal
 * berkasnya sendiri dan tahu persis apa yang berubah.
 *
 * Proteksi `NODE_ENV=production`: restore ke database produksi sering justru
 * itulah tujuannya (memulihkan data yang terhapus di produksi), tetapi tidak
 * boleh terjadi karena variabel lingkungan yang tertinggal di terminal. Karena
 * itu ia menuntut flag tambahan `--allow-production`.
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const mongoose = require('mongoose');
const {
  NAMA_MANIFEST,
  koleksiDariBerkas,
  parseDoc,
  periksaManifest,
  verifikasiEntri,
  bacaTujuan
} = require('../config/backup');

// Ukuran batch saat memasukkan dokumen. Cukup besar agar tidak satu round-trip
// per dokumen, cukup kecil agar satu kegagalan tidak mengirim puluhan ribu
// perintah sekaligus ke cluster free tier.
const UKURAN_BATCH = 500;

const parseArgs = (argv) => {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true;
      args[key] = value;
      if (value !== true) i++;
    }
  }
  return args;
};

const daftarNama = (nilai) =>
  String(nilai || '')
    .split(',')
    .map((nama) => nama.trim())
    .filter(Boolean);

/** Folder backup terbaru di dalam `backups/`, kalau `--dir` tidak disebut. */
const folderTerbaru = (akar) => {
  if (!fs.existsSync(akar)) return null;

  const kandidat = fs
    .readdirSync(akar, { withFileTypes: true })
    .filter((item) => item.isDirectory() && fs.existsSync(path.join(akar, item.name, NAMA_MANIFEST)))
    .map((item) => item.name)
    .sort();

  return kandidat.length ? path.join(akar, kandidat[kandidat.length - 1]) : null;
};

const bacaBarisJson = async (berkas, { onBaris }) => {
  const aliran = fs.createReadStream(berkas, { encoding: 'utf8' });
  const pembaca = readline.createInterface({ input: aliran, crlfDelay: Infinity });
  let nomor = 0;

  try {
    for await (const baris of pembaca) {
      nomor += 1;
      const rapi = baris.trim();
      if (!rapi) continue;

      try {
        await onBaris(parseDoc(rapi));
      } catch (error) {
        throw new Error(`${path.basename(berkas)}: baris ${nomor} gagal dipakai (${error.message})`);
      }
    }
  } finally {
    pembaca.close();
    aliran.destroy();
  }
};

/** Kumpulkan dokumen lalu masukkan per batch. */
const pulihkanKoleksi = async (koleksi, berkas, { ganti }) => {
  if (ganti) {
    const dihapus = await koleksi.deleteMany({});
    console.log(`  ${koleksi.collectionName}: ${dihapus.deletedCount} dokumen lama dihapus`);
  }

  let batch = [];
  let terpasang = 0;
  let terlewat = 0;
  let gagal = 0;

  const masukkan = async () => {
    if (!batch.length) return;

    const sekarang = batch;
    batch = [];

    try {
      const hasil = await koleksi.insertMany(sekarang, { ordered: false });
      terpasang += Array.isArray(hasil) ? hasil.length : 0;
    } catch (error) {
      // `ordered: false` berarti sisanya tetap dicoba. Yang dihitung sebagai
      // "terlewat" hanya bentrokan kunci unik (dokumen sudah ada) — itu keadaan
      // normal untuk mode gabung. Kegagalan lain dihitung sebagai gagal, supaya
      // restore yang tidak utuh tidak pernah terlihat sukses.
      const rincian = Array.isArray(error.writeErrors) ? error.writeErrors : [];
      const bukanBentrok = rincian.filter((item) => item?.err?.code !== 11000);

      terlewat += rincian.filter((item) => item?.err?.code === 11000).length;
      gagal += bukanBentrok.length;

      if (!rincian.length) gagal += sekarang.length;

      if (bukanBentrok.length) {
        console.error(`  !! ${koleksi.collectionName}: ${bukanBentrok[0].err?.message || error.message}`);
      }
    }
  };

  await bacaBarisJson(berkas, {
    onBaris: async (dokumen) => {
      batch.push(dokumen);
      if (batch.length >= UKURAN_BATCH) await masukkan();
    }
  });

  await masukkan();

  return { terpasang, terlewat, gagal };
};

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help === true) {
    console.log('Pemakaian: npm run restore:db -- --dir <folder> [--yes] [--replace] [--only a,b]');
    return;
  }

  if (!process.env.MONGODB_URI) {
    console.error('Error: MONGODB_URI belum diisi. Isi di backend/.env atau lewat environment.');
    process.exit(1);
  }

  const dir = args.dir
    ? path.resolve(process.cwd(), args.dir)
    : folderTerbaru(path.resolve(process.cwd(), 'backups'));

  if (!dir) {
    console.error('Error: folder backup tidak ditemukan. Sebutkan dengan --dir <folder>.');
    process.exit(1);
  }

  const berkasManifest = path.join(dir, NAMA_MANIFEST);

  if (!fs.existsSync(berkasManifest)) {
    console.error(`Error: ${berkasManifest} tidak ada. Jadi folder itu bukan hasil backup skrip ini.`);
    process.exit(1);
  }

  const pemeriksaan = periksaManifest(fs.readFileSync(berkasManifest, 'utf8'));

  if (!pemeriksaan.ok) {
    console.error(`Error: manifest tidak bisa dipakai — ${pemeriksaan.alasan}.`);
    process.exit(1);
  }

  const { manifest } = pemeriksaan;
  const hanya = daftarNama(args.only);
  const dikecualikan = daftarNama(args.exclude);
  const tujuanKoneksi = bacaTujuan(process.env.MONGODB_URI) || { host: null, database: null };

  // Berkas di folder yang tidak tercatat di manifest juga dilaporkan: menambah
  // berkas ke folder backup adalah cara paling mudah membuat "backup" berisi
  // data yang tidak pernah diperiksa.
  const berkasDiFolder = fs.readdirSync(dir).filter((nama) => koleksiDariBerkas(nama));
  const tercatat = manifest.collections.map((entri) => entri.file);
  const tidakTercatat = berkasDiFolder.filter((nama) => !tercatat.includes(nama));

  const dipakai = manifest.collections
    .filter((entri) => (hanya.length ? hanya.includes(entri.name) : true))
    .filter((entri) => !dikecualikan.includes(entri.name));

  if (!dipakai.length) {
    console.error('Error: tidak ada koleksi di manifest yang cocok dengan filter.');
    process.exit(1);
  }

  console.log(`Sumber      : ${dir}`);
  console.log(`Dibuat      : ${manifest.createdAt}`);
  console.log(`Tujuan      : ${tujuanKoneksi.host || '(tidak dikenali)'}  Database: ${tujuanKoneksi.database || '(default)'}`);
  console.log(`Mode        : ${args.replace ? 'GANTI (isi koleksi dihapus lebih dulu)' : 'GABUNG (dokumen yang sudah ada dilewati)'}`);
  console.log('');

  // Verifikasi isi berkas lebih dulu. Restore yang mengosongkan koleksi lalu
  // gagal karena berkasnya terpotong adalah kegagalan terburuk yang bisa
  // dilakukan skrip ini, dan urutan di sini yang mencegahnya.
  console.log('Memeriksa berkas:');

  for (const entri of dipakai) {
    const isi = fs.readFileSync(path.join(dir, entri.file), 'utf8');
    const hasil = args['skip-checksum'] === true ? { ok: true } : verifikasiEntri(entri, isi);

    if (!hasil.ok) {
      console.error(`  ${entri.file}: RUSAK — ${hasil.alasan}`);
      console.error('Restore dihentikan. Pakai --skip-checksum HANYA kalau Anda tahu isi berkas ini.');
      process.exit(1);
    }

    console.log(`  ${entri.file}: ${entri.documents} dokumen, ${entri.bytes} byte, checksum OK`);
  }

  if (tidakTercatat.length) {
    console.log('');
    console.log('Catatan: berkas berikut ada di folder tetapi tidak tercatat di manifest (tidak dipulihkan):');
    for (const nama of tidakTercatat) console.log(`  ${nama}`);
  }

  if (args.yes !== true) {
    console.log('');
    console.log('Mode uji (tanpa --yes): tidak ada yang ditulis. Tambahkan --yes untuk menjalankannya.');
    return;
  }

  if (process.env.NODE_ENV === 'production' && args['allow-production'] !== true) {
    console.error('');
    console.error('Error: NODE_ENV=production. Restore ke produksi harus diminta eksplisit dengan');
    console.error('--allow-production, supaya variabel lingkungan yang tertinggal di terminal tidak');
    console.error('menulis ke database yang sedang melayani user.');
    process.exit(1);
  }

  try {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });

    const db = mongoose.connection.db;
    const ringkasan = [];

    console.log('');

    for (const entri of dipakai) {
      const hasil = await pulihkanKoleksi(db.collection(entri.name), path.join(dir, entri.file), {
        ganti: args.replace === true
      });

      ringkasan.push({ nama: entri.name, ...hasil });
    }

    console.log('');
    console.log('Ringkasan:');

    for (const item of ringkasan) {
      console.log(
        `  ${item.nama}: ${item.terpasang} terpasang, ${item.terlewat} dilewati (sudah ada), ${item.gagal} gagal`
      );
    }

    const gagal = ringkasan.reduce((jumlah, item) => jumlah + item.gagal, 0);

    if (gagal) {
      console.error('');
      console.error(`Restore SELESAI SEBAGIAN: ${gagal} dokumen gagal dimasukkan (lihat pesan di atas).`);
      process.exit(1);
    }

    console.log('');
    console.log('Restore selesai.');
  } catch (error) {
    console.error(`Restore gagal: ${error.message}`);
    process.exit(1);
  } finally {
    await mongoose.connection.close().catch(() => {});
  }
}

main();
