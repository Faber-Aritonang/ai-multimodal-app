/**
 * Test: backup & restore database (config/backup.js).
 *
 * Atlas free tier tidak punya point-in-time recovery, jadi berkas backup ini
 * adalah satu-satunya jalan pulang kalau data terhapus. Karena itu yang diuji di
 * sini bukan "apakah bisa menulis berkas", melainkan tiga janji yang menentukan
 * apakah pemulihannya benar-benar berhasil:
 *
 *   1. nilai BSON kembali UTUH setelah bolak-balik (ObjectId dan Date yang
 *      berubah jadi string akan menghasilkan dokumen yang tampak benar tetapi
 *      tidak cocok dengan relasi mana pun);
 *   2. manifest menolak folder yang salah atau format baru yang tidak dimengerti
 *      SEBELUM satu dokumen pun ditulis;
 *   3. berkas yang terpotong/berubah terdeteksi dari ukuran & checksum.
 */

const { Types } = require('mongoose');
const {
  FORMAT,
  VERSI,
  EKSTENSI,
  NAMA_MANIFEST,
  namaBerkasKoleksi,
  koleksiDariBerkas,
  serializeDoc,
  parseDoc,
  parseNdjson,
  toNdjson,
  bacaTujuan,
  buatEntriDariIsi,
  buatManifest,
  periksaManifest,
  verifikasiEntri
} = require('../config/backup');

// Password memakai kata "rahasia" supaya URI di test ini tidak ditandai penjaga
// rahasia repo (scripts/check-no-secrets.js) — sama seperti contoh di
// dokumentasi. Atlas memakai password acak, jadi tidak ada yang tertutupi.
const URI = 'mongodb+srv://appuser:RAHASIA_ANDA@cluster0.xxxxx.mongodb.net/ai-multimodal?retryWrites=true';

describe('nama berkas koleksi', () => {
  test('nama koleksi biasa diterima', () => {
    expect(namaBerkasKoleksi('users')).toBe(`users${EKSTENSI}`);
    expect(namaBerkasKoleksi('media_contents')).toBe(`media_contents${EKSTENSI}`);
    expect(namaBerkasKoleksi('chat-sessions')).toBe(`chat-sessions${EKSTENSI}`);
  });

  test.each([
    ['naik satu direktori', '../../.env'],
    ['berisi pemisah direktori', 'users/berkas'],
    ['berisi titik', 'users.ndjson'],
    ['kosong', ''],
    ['berisi spasi', 'users tabel'],
    ['terlalu panjang', 'a'.repeat(121)]
  ])('nama koleksi %s ditolak', (_nama, nilai) => {
    // Nama koleksi dipakai sebagai nama berkas: yang tidak divalidasi bisa
    // menulis di luar folder backup.
    expect(() => namaBerkasKoleksi(nilai)).toThrow();
  });

  test('nama koleksi bisa dibaca kembali dari nama berkasnya', () => {
    expect(koleksiDariBerkas(`users${EKSTENSI}`)).toBe('users');
    expect(koleksiDariBerkas(NAMA_MANIFEST)).toBeNull();
    expect(koleksiDariBerkas('catatan.txt')).toBeNull();
    expect(koleksiDariBerkas(`../users${EKSTENSI}`)).toBeNull();
  });
});

describe('bolak-balik dokumen', () => {
  test('ObjectId kembali sebagai ObjectId, bukan string', () => {
    const asli = { _id: new Types.ObjectId(), uid: 'user-1' };
    const hasil = parseDoc(serializeDoc(asli));

    expect(hasil._id).toBeInstanceOf(Types.ObjectId);
    expect(hasil._id.equals(asli._id)).toBe(true);
    expect(hasil.uid).toBe('user-1');
  });

  test('Date kembali sebagai Date, bukan string', () => {
    const asli = { createdAt: new Date('2026-09-24T16:12:06.265Z') };
    const hasil = parseDoc(serializeDoc(asli));

    expect(hasil.createdAt).toBeInstanceOf(Date);
    expect(hasil.createdAt.toISOString()).toBe('2026-09-24T16:12:06.265Z');
  });

  test('Buffer kembali sebagai Buffer', () => {
    const asli = { potongan: Buffer.from([0x01, 0x02, 0xff]) };
    const hasil = parseDoc(serializeDoc(asli));

    expect(Buffer.isBuffer(hasil.potongan)).toBe(true);
    expect(hasil.potongan.equals(asli.potongan)).toBe(true);
  });

  test('struktur bersarang, array, dan nilai unicode utuh', () => {
    const asli = {
      _id: new Types.ObjectId(),
      prompt: 'kucing oranye di atap 🐈',
      quota: { chat: 100, audioGeneration: 10 },
      metadata: { provider: 'gemini', tags: ['a', null, 1, true] },
      revisions: [{ at: new Date('2026-01-02T03:04:05.000Z'), note: 'pertama' }],
      kosong: null,
      jumlah: 0
    };

    const hasil = parseDoc(serializeDoc(asli));

    expect(hasil.prompt).toBe('kucing oranye di atap 🐈');
    expect(hasil.quota).toEqual({ chat: 100, audioGeneration: 10 });
    expect(hasil.metadata.tags).toEqual(['a', null, 1, true]);
    expect(hasil.revisions[0].at).toBeInstanceOf(Date);
    expect(hasil.revisions[0].note).toBe('pertama');
    expect(hasil.kosong).toBeNull();
    expect(hasil.jumlah).toBe(0);
  });

  test('ObjectId yang rusak tidak membuat pemulihan gagal total', () => {
    // Barisnya tetap terbaca (dan ketahuan saat diperiksa manusia) alih-alih
    // menggagalkan seluruh berkas.
    const hasil = parseDoc('{"_id":{"$oid":"bukan-object-id"}}');

    expect(hasil._id).toEqual({ $oid: 'bukan-object-id' });
  });
});

describe('berkas NDJSON', () => {
  test('satu dokumen per baris, dan bisa dibaca kembali', () => {
    const daftar = [{ a: 1 }, { a: 2 }, { a: 3 }];
    const isi = `${toNdjson(daftar)}\n`;

    expect(isi.trim().split('\n')).toHaveLength(3);
    expect(parseNdjson(isi)).toEqual(daftar);
  });

  test('baris kosong (termasuk baris terakhir) dilewati', () => {
    const isi = '{"a":1}\n\n{"a":2}\n';

    expect(parseNdjson(isi)).toHaveLength(2);
  });

  test('berkas yang rusak dilaporkan beserta nomor barisnya', () => {
    // Restore yang diam-diam melewatkan baris rusak jauh lebih berbahaya
    // daripada restore yang berhenti: yang pertama menghasilkan database
    // setengah terisi tanpa ada yang tahu.
    expect(() => parseNdjson('{"a":1}\nbukan json\n')).toThrow(/Baris 2/);
  });

  test('berkas kosong menghasilkan daftar kosong, bukan error', () => {
    expect(parseNdjson('')).toEqual([]);
    expect(parseNdjson(undefined)).toEqual([]);
  });
});

describe('bacaTujuan', () => {
  test('mengambil host dan nama database dari URI', () => {
    expect(bacaTujuan(URI)).toEqual({
      host: 'cluster0.xxxxx.mongodb.net',
      database: 'ai-multimodal'
    });
  });

  test('tidak pernah memuat kredensialnya', () => {
    // Manifest adalah berkas yang paling mungkin ikut dibagikan; repo ini publik.
    const hasil = bacaTujuan(URI);

    expect(JSON.stringify(hasil)).not.toContain('RAHASIA_ANDA');
    expect(JSON.stringify(hasil)).not.toContain('appuser');
  });

  test('URI lokal tanpa kredensial tetap terbaca', () => {
    expect(bacaTujuan('mongodb://localhost:27017/ai-multimodal')).toEqual({
      host: 'localhost:27017',
      database: 'ai-multimodal'
    });
  });

  test('URI tanpa nama database dianggap tanpa database', () => {
    expect(bacaTujuan('mongodb://localhost:27017/')).toEqual({
      host: 'localhost:27017',
      database: null
    });
  });

  test('nilai kosong atau bentuk asing menghasilkan null', () => {
    expect(bacaTujuan('')).toBeNull();
    expect(bacaTujuan(undefined)).toBeNull();
    expect(bacaTujuan('postgres://localhost/db')).toBeNull();
  });
});

describe('manifest', () => {
  const isi = '{"a":1}\n{"a":2}\n';
  const entri = () => buatEntriDariIsi({ nama: 'users', isi });

  test('entri mencatat jumlah dokumen, ukuran byte, dan checksum', () => {
    const hasil = entri();

    expect(hasil).toMatchObject({
      name: 'users',
      file: `users${EKSTENSI}`,
      documents: 2,
      bytes: Buffer.byteLength(isi, 'utf8')
    });
    expect(hasil.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  test('ukuran dihitung dalam byte, bukan jumlah karakter', () => {
    // Prompt berbahasa Indonesia dan emoji membuat keduanya berbeda; ukuran yang
    // salah membuat verifikasi berkas menolak backup yang sebenarnya utuh.
    const unicode = '{"prompt":"kucing di atap 🐈"}\n';

    expect(buatEntriDariIsi({ nama: 'media', isi: unicode }).bytes).toBe(
      Buffer.byteLength(unicode, 'utf8')
    );
  });

  test('bentuk manifest dikenali oleh pemeriksanya', () => {
    const manifest = buatManifest({
      host: 'cluster0.xxxxx.mongodb.net',
      database: 'ai-multimodal',
      koleksi: [entri()],
      createdAt: '2026-09-24T16:12:06.265Z'
    });

    expect(manifest.format).toBe(FORMAT);
    expect(manifest.version).toBe(VERSI);
    expect(manifest.createdAt).toBe('2026-09-24T16:12:06.265Z');
    expect(periksaManifest(manifest).ok).toBe(true);
  });

  test.each([
    ['bukan JSON', '{ bukan json'],
    ['format lain', JSON.stringify({ format: 'pg-dump', version: 1, collections: [] })],
    ['tanpa kolom collections', JSON.stringify({ format: FORMAT, version: 1 })],
    [
      'versi lebih baru',
      JSON.stringify({ format: FORMAT, version: VERSI + 1, collections: [] })
    ],
    [
      'nama koleksi tidak wajar',
      JSON.stringify({ format: FORMAT, version: VERSI, collections: [{ name: '../users' }] })
    ],
    [
      'entri tanpa nama',
      JSON.stringify({ format: FORMAT, version: VERSI, collections: [{ file: 'x.ndjson' }] })
    ]
  ])('manifest %s ditolak sebelum restore berjalan', (_nama, isiManifest) => {
    const hasil = periksaManifest(isiManifest);

    expect(hasil.ok).toBe(false);
    expect(typeof hasil.alasan).toBe('string');
  });

  test('manifest dari versi lama tetap diterima', () => {
    expect(
      periksaManifest({ format: FORMAT, version: 1, collections: [{ name: 'users' }] }).ok
    ).toBe(true);
  });
});

describe('verifikasi berkas terhadap manifest', () => {
  const entri = buatEntriDariIsi({ nama: 'users', isi: '{"a":1}\n' });

  test('berkas yang utuh lolos', () => {
    expect(verifikasiEntri(entri, '{"a":1}\n')).toEqual({ ok: true });
  });

  test('berkas terpotong terdeteksi dari ukurannya', () => {
    const hasil = verifikasiEntri(entri, '{"a"');

    expect(hasil.ok).toBe(false);
    expect(hasil.alasan).toMatch(/ukuran/i);
  });

  test('isi yang berubah terdeteksi dari checksumnya', () => {
    // Panjangnya sengaja sama supaya yang menangkap perubahan adalah checksum,
    // bukan pemeriksaan ukuran.
    const diubah = '{"a":2}\n';
    const hasil = verifikasiEntri(entri, diubah);

    expect(diubah.length).toBe('{"a":1}\n'.length);
    expect(hasil.ok).toBe(false);
    expect(hasil.alasan).toMatch(/checksum/i);
  });

  test('manifest tanpa checksum tetap bisa diverifikasi dari ukurannya', () => {
    expect(verifikasiEntri({ bytes: 8 }, '{"a":1}\n').ok).toBe(true);
  });
});
