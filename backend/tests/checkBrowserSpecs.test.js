/**
 * Test untuk scripts/check-browser-specs.js
 *
 * Penjaga ini menggantikan satu hal yang tidak bisa dilakukan CI dengan murah
 * (menjalankan uji browser sungguhan), jadi ia harus tegas pada masalah yang
 * nyata: spec yang tidak pernah didaftarkan. Dua sisi yang dikunci:
 *
 *   1. keadaan repo saat ini bersih (kalau tidak, aturannya cuma berisik);
 *   2. setiap jenis masalah benar-benar terdeteksi pada contoh buatan — aturan
 *      yang tidak menangkap apa pun tidak menahan apa pun.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  periksaRegistri,
  daftarRequireRunner,
  SPEC_DIR,
  RUNNER
} = require('../../scripts/check-browser-specs');

/** Susun repo tiruan: `run.cjs` + berkas spec sesuai permintaan. */
const buatRepo = ({ runner = '', specs = {} }) => {
  const akar = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-specs-'));
  const direktorSpec = path.join(akar, SPEC_DIR);
  const berkasRunner = path.join(akar, RUNNER);

  fs.mkdirSync(direktorSpec, { recursive: true });
  fs.writeFileSync(berkasRunner, runner);

  for (const [nama, isi] of Object.entries(specs)) {
    fs.writeFileSync(path.join(direktorSpec, nama), isi);
  }

  return akar;
};

const specSah = (nama) =>
  `module.exports = { name: ${JSON.stringify(nama)}, async run() {} };\n`;

const jenisTemuan = (temuan) => temuan.map((item) => item.jenis);
const direktoriSementara = [];

afterEach(() => {
  while (direktoriSementara.length) {
    fs.rmSync(direktoriSementara.pop(), { recursive: true, force: true });
  }
});

const repo = (opsi) => {
  const akar = buatRepo(opsi);
  direktoriSementara.push(akar);
  return akar;
};

describe('daftarRequireRunner', () => {
  test('mengambil jalur spec secara berurutan', () => {
    const isi = [
      "const ALL_SPECS = [",
      "  require('./specs/a.spec.cjs'),",
      '  require("./specs/b.spec.cjs")',
      '];'
    ].join('\n');

    expect(daftarRequireRunner(isi)).toEqual(['./specs/a.spec.cjs', './specs/b.spec.cjs']);
  });

  test('require yang bukan spec diabaikan', () => {
    const isi = "require('./lib/harness.cjs');\nrequire('./specs/a.spec.cjs');";

    expect(daftarRequireRunner(isi)).toEqual(['./specs/a.spec.cjs']);
  });

  test('teks kosong menghasilkan daftar kosong', () => {
    expect(daftarRequireRunner('')).toEqual([]);
    expect(daftarRequireRunner(undefined)).toEqual([]);
  });
});

describe('registri repo ini', () => {
  test('seluruh spec terdaftar, bisa dimuat, dan namanya unik', () => {
    // Inilah aturan yang membuat "spec ada tapi tidak pernah dijalankan" tidak
    // bisa lolos lagi — persis keadaan history.spec.cjs sebelum didaftarkan.
    expect(periksaRegistri()).toEqual([]);
  });
});

describe('deteksi masalah', () => {
  test('spec yang tidak didaftarkan di run.cjs', () => {
    const akar = repo({
      runner: "const ALL_SPECS = [ require('./specs/terdaftar.spec.cjs') ];",
      specs: { 'terdaftar.spec.cjs': specSah('terdaftar'), 'lupa.spec.cjs': specSah('lupa') }
    });

    const temuan = periksaRegistri({ akar });

    expect(jenisTemuan(temuan)).toEqual(['tidak-terdaftar']);
    expect(temuan[0].berkas).toContain('lupa.spec.cjs');
  });

  test('require yang menunjuk berkas yang tidak ada', () => {
    const akar = repo({
      runner: "const ALL_SPECS = [ require('./specs/hilang.spec.cjs') ];",
      specs: {}
    });

    const temuan = periksaRegistri({ akar });

    expect(jenisTemuan(temuan)).toEqual(['berkas-hilang']);
  });

  test('spec yang bentuk ekspornya salah', () => {
    const akar = repo({
      runner: "const ALL_SPECS = [ require('./specs/rusak.spec.cjs') ];",
      specs: {
        // `run` ada tetapi bukan fungsi — runner akan gagal saat memanggilnya.
        'rusak.spec.cjs': "module.exports = { name: 'rusak', run: 'bukan fungsi' };\n"
      }
    });

    expect(jenisTemuan(periksaRegistri({ akar }))).toEqual(['bentuk-salah']);
  });

  test('spec yang gagal dimuat (syntax error)', () => {
    const akar = repo({
      runner: "const ALL_SPECS = [ require('./specs/error.spec.cjs') ];",
      specs: { 'error.spec.cjs': 'module.exports = { name: \n' }
    });

    expect(jenisTemuan(periksaRegistri({ akar }))).toEqual(['gagal-dimuat']);
  });

  test('dua spec dengan nama yang sama', () => {
    // TEST_SPECS memfilter berdasarkan nama, jadi nama ganda membuat salah satu
    // spec mustahil dijalankan sendiri.
    const akar = repo({
      runner:
        "const ALL_SPECS = [ require('./specs/a.spec.cjs'), require('./specs/b.spec.cjs') ];",
      specs: { 'a.spec.cjs': specSah('sama'), 'b.spec.cjs': specSah('sama') }
    });

    expect(jenisTemuan(periksaRegistri({ akar }))).toEqual(['nama-ganda']);
  });

  test('ekstensi yang tidak akan dibaca runner', () => {
    const akar = repo({ runner: 'const ALL_SPECS = [];', specs: { 'baru.spec.js': 'x' } });

    expect(jenisTemuan(periksaRegistri({ akar }))).toEqual(['ekstensi-salah']);
  });

  test('runner atau folder spec yang hilang', () => {
    const tanpaRunner = repo({ runner: '', specs: {} });
    fs.rmSync(path.join(tanpaRunner, RUNNER), { force: true });

    expect(jenisTemuan(periksaRegistri({ akar: tanpaRunner }))).toEqual(['runner-hilang']);

    const tanpaFolder = repo({ runner: 'const ALL_SPECS = [];' });
    fs.rmSync(path.join(tanpaFolder, SPEC_DIR), { recursive: true, force: true });

    expect(jenisTemuan(periksaRegistri({ akar: tanpaFolder }))).toEqual(['folder-hilang']);
  });

  test('repo tiruan yang sehat tidak menghasilkan temuan', () => {
    const akar = repo({
      runner: "const ALL_SPECS = [ require('./specs/a.spec.cjs'), require('./specs/b.spec.cjs') ];",
      specs: { 'a.spec.cjs': specSah('a'), 'b.spec.cjs': specSah('b') }
    });

    expect(periksaRegistri({ akar })).toEqual([]);
  });
});
