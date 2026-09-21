/**
 * Test untuk scripts/check-no-secrets.js
 *
 * Penjaga ini menolak commit dan menghentikan job `quality` di CI, jadi polanya
 * perlu dijaga test: aturan yang berisik akan dimatikan orang, dan aturan yang
 * terlalu longgar tidak menahan apa pun. Dua hal yang paling penting di sini:
 *
 *   1. `*.env.example` tidak boleh pernah ditandai — berkas itu memang harus
 *      ter-commit karena isinya placeholder.
 *   2. Contoh di dokumentasi dan fixture test tidak boleh ikut tertangkap,
 *      karena itu sumber positif palsu yang paling sering muncul.
 *
 * Kunci palsu di bawah dirakit saat runtime, bukan ditulis utuh: berkas test ini
 * ikut diperiksa penjaganya sendiri, sehingga kunci yang benar-benar cocok pola
 * di dalamnya akan membuat repo menolak commit atas test-nya sendiri.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  periksaNama,
  periksaIsi,
  periksaBerkas,
  MAX_BYTES
} = require('../../scripts/check-no-secrets');

const groqPalsu = () => 'gsk_' + 'a'.repeat(52);
const openrouterPalsu = () => 'sk-or-v1-' + 'ab12'.repeat(12);
const openaiPalsu = () => 'sk-' + 'A'.repeat(48);
const jwtPalsu = () =>
  'eyJ' + 'a'.repeat(12) + '.' + 'b'.repeat(12) + '.' + 'c'.repeat(12);
const kunciPrivatPalsu = () =>
  '-----BEGIN PRIVATE KEY-----\n' + 'MIIEvQ'.repeat(40) + '\n-----END PRIVATE KEY-----';
const mongoUri = (sandi) =>
  `mongodb+srv://appuser:${sandi}@cluster0.xxxxx.mongodb.net/ai-multimodal`;

const namaAturan = (temuan) => temuan.map((t) => t.aturan);

describe('periksaNama', () => {
  test('menandai semua varian berkas .env', () => {
    for (const berkas of [
      '.env',
      'backend/.env',
      'backend/.env.local',
      'backend/.env.save',
      'backend/.env.save.1',
      'frontend/.env.production',
      // Salinan per environment: mudah dibuat, dan sama berisi kredensial asli.
      'prod.env',
      'backend/staging.env'
    ]) {
      expect(periksaNama(berkas)).toHaveLength(1);
    }
  });

  test('membiarkan berkas .env.example, apa pun direktorinya', () => {
    expect(periksaNama('backend/.env.example')).toEqual([]);
    expect(periksaNama('frontend/.env.example')).toEqual([]);
    expect(periksaNama('.env.example')).toEqual([]);
  });

  test('menandai kunci privat, sertifikat, dan kredensial service account', () => {
    for (const berkas of [
      'certs/server.pem',
      'keys/app.key',
      'android/release.p12',
      'keys/id_rsa',
      'keys/id_rsa.pub',
      'backend/config/firebase-service-account.json',
      'secrets/firebase-adminsdk-abc12.json',
      'secrets/client_secret_123.json',
      '.railway-token'
    ]) {
      expect(periksaNama(berkas).length).toBeGreaterThan(0);
    }
  });

  test('tidak menandai berkas sumber biasa', () => {
    for (const berkas of [
      'backend/server.js',
      'backend/config/firebase.js',
      'backend/config/firebase-service-account.example.json',
      'README.md',
      'frontend/src/pages/ChatPage.jsx',
      'scripts/check-no-secrets.js'
    ]) {
      expect(periksaNama(berkas)).toEqual([]);
    }
  });
});

describe('periksaIsi - kunci provider', () => {
  test('menandai kunci Groq', () => {
    expect(namaAturan(periksaIsi(`GROQ_API_KEY=${groqPalsu()}`))).toEqual([
      'Groq API key'
    ]);
  });

  test('tidak menandai potongan yang terlalu pendek', () => {
    expect(periksaIsi('gsk_abc123')).toEqual([]);
    expect(periksaIsi('gsk_')).toEqual([]);
  });

  test('kunci OpenRouter dilaporkan sekali, dengan label yang benar', () => {
    // Kalau aturan OpenAI tidak mengecualikan `sk-or-v1-`, satu nilai dilaporkan
    // dua kali dengan dua nama berbeda dan pesannya jadi menyesatkan.
    expect(namaAturan(periksaIsi(`OPENROUTER_API_KEY=${openrouterPalsu()}`))).toEqual(
      ['OpenRouter API key']
    );
  });

  test('menandai kunci OpenAI', () => {
    expect(namaAturan(periksaIsi(`OPENAI_API_KEY=${openaiPalsu()}`))).toEqual([
      'OpenAI API key'
    ]);
  });

  test('placeholder di .env.example tidak ditandai', () => {
    for (const contoh of [
      'OPENAI_API_KEY=sk-your-openai-key-here',
      'OPENAI_API_KEY=sk-xxx',
      'GEMINI_API_KEY=your-gemini-key',
      'GROQ_API_KEY=gsk_...'
    ]) {
      expect(periksaIsi(contoh)).toEqual([]);
    }
  });
});

describe('periksaIsi - kunci privat dan JWT', () => {
  test('menandai kunci privat dengan badan base64 yang panjang', () => {
    expect(namaAturan(periksaIsi(kunciPrivatPalsu()))).toEqual([
      'kunci privat (badan base64)'
    ]);
  });

  test('tidak menandai fixture test dengan badan pendek', () => {
    // Bentuk yang dipakai tests/firebase.config.test.js
    const fixture =
      "private_key: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n'";
    expect(periksaIsi(fixture)).toEqual([]);
  });

  test('menandai JWT', () => {
    expect(namaAturan(periksaIsi(`token=${jwtPalsu()}`))).toEqual(['JWT']);
  });
});

describe('periksaIsi - MongoDB URI', () => {
  test('menandai URI dengan password yang terlihat asli', () => {
    expect(namaAturan(periksaIsi(`MONGODB_URI=${mongoUri('K7p3Qm9zX2vB8n4R')}`))).toEqual([
      'MongoDB URI berisi user:password'
    ]);
  });

  test('contoh password di dokumentasi tidak ditandai', () => {
    for (const sandi of [
      'PASSWORD',
      'PASSWORD_ANDA',
      'password',
      'PASS',
      'pwd',
      'SANDI_ANDA',
      'changeme',
      'xxxx',
      '<password>',
      '${MONGODB_PASSWORD}'
    ]) {
      expect(periksaIsi(mongoUri(sandi))).toEqual([]);
    }
  });

  test('URI tanpa kredensial tidak ditandai', () => {
    expect(periksaIsi('MONGODB_URI=mongodb://localhost:27017/ai-multimodal')).toEqual([]);
    expect(periksaIsi('MONGODB_URI=mongodb+srv://cluster0.xxxxx.mongodb.net')).toEqual([]);
  });
});

describe('periksaIsi - pelaporan lokasi', () => {
  test('melaporkan nomor baris tempat temuan berada', () => {
    const teks = ['# komentar', 'AMAN=1', `GROQ_API_KEY=${groqPalsu()}`, 'X=2'].join('\n');
    const temuan = periksaIsi(teks);

    expect(temuan).toHaveLength(1);
    expect(temuan[0].baris).toBe(3);
    expect(temuan[0].jenis).toBe('isi');
  });

  test('teks tanpa rahasia menghasilkan daftar kosong', () => {
    expect(periksaIsi('')).toEqual([]);
    expect(periksaIsi('const a = 1;\nconsole.log(a);\n')).toEqual([]);
  });
});

describe('periksaBerkas', () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-no-secrets-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('menggabungkan temuan nama dan isi', () => {
    const berkas = path.join(dir, '.env.save');
    fs.writeFileSync(berkas, `GROQ_API_KEY=${groqPalsu()}\n`);

    expect(namaAturan(periksaBerkas(berkas))).toEqual([
      'berkas .env (kecuali .env.example)',
      'Groq API key'
    ]);
  });

  test('berkas yang tidak ada tidak membuat pemeriksaan gagal', () => {
    // Terjadi saat berkas dihapus di commit yang sama: temuannya hanya dari
    // nama, dan pembacaan isinya gagal secara wajar (tanpa melempar error).
    const temuan = periksaBerkas(path.join(dir, '.env.hilang'));
    expect(namaAturan(temuan)).toEqual(['berkas .env (kecuali .env.example)']);
  });

  test('berkas biner dilewati', () => {
    const berkas = path.join(dir, 'gambar.bin');
    fs.writeFileSync(berkas, Buffer.from([0x00, 0x01, 0x67, 0x73, 0x6b, 0x5f, 0x00]));

    expect(periksaBerkas(berkas)).toEqual([]);
  });

  test('berkas yang lebih besar dari batas dilewati', () => {
    const berkas = path.join(dir, 'besar.js');
    fs.writeFileSync(berkas, ' '.repeat(MAX_BYTES + 1) + groqPalsu());

    expect(periksaBerkas(berkas)).toEqual([]);
  });

  test('berkas biasa yang bersih tidak ditandai', () => {
    const berkas = path.join(dir, 'server.js');
    fs.writeFileSync(berkas, "require('express');\nconst PORT = process.env.PORT;\n");

    expect(periksaBerkas(berkas)).toEqual([]);
  });
});
