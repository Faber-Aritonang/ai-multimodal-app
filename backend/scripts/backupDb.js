#!/usr/bin/env node
/**
 * Skrip: backup database.
 *
 * Pemakaian:
 *   npm run backup:db
 *   npm run backup:db -- --out backups/label-saya
 *   npm run backup:db -- --only users,media --exclude chatmessages
 *
 * Hasilnya: satu berkas NDJSON per koleksi + `manifest.json` berisi jumlah
 * dokumen, ukuran, dan checksum tiap berkas. Alat lain (`restoreDb.js`) membaca
 * berkas yang sama, jadi keduanya tidak bisa menyimpang soal bentuk data.
 *
 * Kenapa tidak `mongodump`: biner itu tidak ada di mesin developer maupun di
 * runner CI repo ini, dan memasangnya di Railway tidak masuk akal. Lihat catatan
 * lengkap di config/backup.js.
 *
 * Catatan operasional:
 *   - Skrip ini HANYA MEMBACA database. Tidak ada tulis, tidak ada drop.
 *   - Aman dijalankan saat aplikasi melayani: pembacaannya lewat cursor biasa,
 *     bukan snapshot terkunci. Konsekuensinya, dokumen yang berubah tepat saat
 *     backup berjalan bisa terbaca dalam keadaan setengah jalan; untuk backup
 *     yang dipakai sebagai titik pulih, jalankan saat pemakaian sedang sepi.
 *   - URI MongoDB TIDAK pernah dicetak dan TIDAK pernah disimpan ke manifest —
 *     hanya host dan nama database-nya (manifest adalah berkas yang paling
 *     mungkin ikut dibagikan, dan repo ini publik).
 */

require('dotenv').config();

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { once } = require('events');
const mongoose = require('mongoose');
const {
  NAMA_MANIFEST,
  serializeDoc,
  bacaTujuan,
  buatEntriKoleksi,
  buatManifest
} = require('../config/backup');

/** Parser argumen sederhana, mengikuti gaya scripts/createAdmin.js. */
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

const capWaktuUntukFolder = () =>
  new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);

/**
 * Tulis satu koleksi ke berkasnya sambil menghitung jumlah/ukuran/checksum.
 *
 * Ditulis baris demi baris dari cursor, bukan dengan `find().toArray()`: tabel
 * terbesar (percakapan & media) tidak perlu masuk memori utuh, dan proses yang
 * mati di tengah tetap meninggalkan berkas yang jelas terpotong (dibandingkan
 * manifest-nya) alih-alih kehabisan memori.
 */
const tulisKoleksi = async (koleksi, berkasTujuan) => {
  const aliran = fs.createWriteStream(berkasTujuan, { encoding: 'utf8' });
  const hash = crypto.createHash('sha256');
  let documents = 0;
  let bytes = 0;

  try {
    for await (const dokumen of koleksi.find({})) {
      const baris = `${serializeDoc(dokumen)}\n`;

      bytes += Buffer.byteLength(baris, 'utf8');
      hash.update(baris);
      documents += 1;

      // `drain` menahan pembacaan berikutnya saat buffer disk penuh; tanpa ini
      // proses bisa menghabiskan memori pada koleksi besar.
      if (!aliran.write(baris)) await once(aliran, 'drain');
    }

    aliran.end();
    await once(aliran, 'finish');
  } catch (error) {
    aliran.destroy();
    throw error;
  }

  return { documents, bytes, sha256: hash.digest('hex') };
};

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help === true) {
    console.log('Pemakaian: npm run backup:db -- [--out <folder>] [--only a,b] [--exclude c]');
    return;
  }

  if (!process.env.MONGODB_URI) {
    console.error('Error: MONGODB_URI belum diisi. Isi di backend/.env atau lewat environment.');
    process.exit(1);
  }

  const tujuan = path.resolve(process.cwd(), args.out || path.join('backups', capWaktuUntukFolder()));
  const hanya = daftarNama(args.only);
  const dikecualikan = daftarNama(args.exclude);
  const tujuanKoneksi = bacaTujuan(process.env.MONGODB_URI) || { host: null, database: null };

  try {
    // Timeout seleksi dipendekkan: skrip ini dijalankan manual, dan menunggu 30
    // detik (bawaan driver) sebelum memberi tahu bahwa cluster tidak terlihat
    // hanya membuat orang mengira skripnya menggantung.
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });

    const db = mongoose.connection.db;
    const daftarKoleksi = (await db.listCollections({}, { nameOnly: true }).toArray())
      .map((item) => item.name)
      .filter((nama) => (hanya.length ? hanya.includes(nama) : true))
      .filter((nama) => !dikecualikan.includes(nama))
      .sort();

    if (!daftarKoleksi.length) {
      console.error('Error: tidak ada koleksi yang cocok dengan filter.');
      process.exit(1);
    }

    fs.mkdirSync(tujuan, { recursive: true });

    console.log(`Backup ke: ${tujuan}`);
    console.log(`Host: ${tujuanKoneksi.host || '(tidak dikenali)'}  Database: ${tujuanKoneksi.database || '(default)'}`);

    const entri = [];

    for (const nama of daftarKoleksi) {
      const hasil = await tulisKoleksi(db.collection(nama), path.join(tujuan, `${nama}.ndjson`));
      entri.push(buatEntriKoleksi({ nama, ...hasil }));

      console.log(`  ${nama}: ${hasil.documents} dokumen, ${hasil.bytes} byte`);
    }

    const manifest = buatManifest({
      host: tujuanKoneksi.host,
      database: tujuanKoneksi.database,
      koleksi: entri
    });

    fs.writeFileSync(path.join(tujuan, NAMA_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);

    const total = entri.reduce((jumlah, item) => jumlah + item.documents, 0);
    console.log(`Selesai: ${entri.length} koleksi, ${total} dokumen.`);
    console.log(`Manifest: ${path.join(tujuan, NAMA_MANIFEST)}`);
    console.log('Simpan folder ini di luar repo (isi database memuat data user).');
  } catch (error) {
    // Pesan error dari driver BISA memuat host dan nama database, tetapi tidak
    // pernah kredensialnya; itu batas yang sama dengan yang berlaku di /health.
    console.error(`Backup gagal: ${error.message}`);
    process.exit(1);
  } finally {
    await mongoose.connection.close().catch(() => {});
  }
}

main();
