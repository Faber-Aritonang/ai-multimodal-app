/**
 * Test: config/chatPersona
 *
 * Mengunci kontrak system prompt: identitas model harus jujur (bukan hasil
 * karangan model), kuota user ikut disertakan, dan tidak ada kredensial yang
 * bocor ke isi prompt.
 */

process.env.GROQ_API_KEY = 'gsk_test_key_1234567890';
delete process.env.GEMINI_API_KEY;
delete process.env.OPENAI_API_KEY;
delete process.env.CHAT_PROVIDER;
delete process.env.CHAT_FALLBACK_PROVIDER;

const { buildSystemPrompt, withSystemPrompt } = require('../config/chatPersona');
const { PROVIDERS } = require('../config/chatProviders');

describe('buildSystemPrompt', () => {
  test('menyebut provider & model yang sebenarnya dipakai', () => {
    const prompt = buildSystemPrompt();

    expect(prompt).toContain('Groq');
    expect(prompt).toContain('openai/gpt-oss-120b');
  });

  test('melarang model mengklaim sebagai produk/model lain', () => {
    const prompt = buildSystemPrompt();

    expect(prompt).toMatch(/jangan mengklaim sebagai produk atau model lain/i);
  });

  test('menyebut provider cadangan beserta modelnya, bukan hanya keberadaannya', () => {
    process.env.GEMINI_API_KEY = 'gemini-test';
    process.env.CHAT_FALLBACK_PROVIDER = 'gemini';

    try {
      const prompt = buildSystemPrompt();

      // Uji nyata: tanpa nama model cadangan di prompt, model mengarang
      // "kebijakan layanan tidak mengungkapkan model cadangan" saat ditanya.
      expect(prompt).toContain('Google Gemini (free tier)');
      expect(prompt).toContain(PROVIDERS.gemini.getModel());
    } finally {
      delete process.env.GEMINI_API_KEY;
      delete process.env.CHAT_FALLBACK_PROVIDER;
    }
  });

  test('tanpa cadangan, daftar cadangan tidak muncul', () => {
    process.env.CHAT_FALLBACK_PROVIDER = 'none';

    try {
      expect(buildSystemPrompt()).not.toContain('Provider cadangan yang dipakai otomatis');
    } finally {
      delete process.env.CHAT_FALLBACK_PROVIDER;
    }
  });

  test('melarang mengarang kebijakan/alasan saat tidak tahu', () => {
    expect(buildSystemPrompt()).toMatch(/jangan mengarang kebijakan/i);
  });

  test('menyertakan kuota user yang sebenarnya', () => {
    const prompt = buildSystemPrompt({
      member: { quota: { chat: 42, imageGeneration: 7 } }
    });

    expect(prompt).toContain('42 pesan tersisa');
    expect(prompt).toContain('7 gambar tersisa');
    // Batas token per user tidak ada di aplikasi ini — provider yang membatasi.
    expect(prompt).toMatch(/tidak ada batas token harian per user/i);
  });

  test('tanpa kuota di member, bagian kuota dilewati tanpa error', () => {
    const prompt = buildSystemPrompt({ member: { uid: 'uid-1' } });

    expect(prompt).toContain('Jangan mengklaim sebagai produk atau model lain');
    expect(prompt).not.toContain('pesan tersisa');
  });

  test('tidak pernah memuat nilai kredensial', () => {
    const prompt = buildSystemPrompt();

    expect(prompt).not.toContain('gsk_test_key_1234567890');
    expect(prompt).not.toMatch(/gsk_[A-Za-z0-9]{12,}/);
  });
});

describe('withSystemPrompt', () => {
  test('menaruh system prompt paling depan tanpa mengubah riwayat aslinya', () => {
    const history = [{ role: 'user', content: 'halo' }];
    const messages = withSystemPrompt(history, { member: { quota: { chat: 1 } } });

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[1]).toEqual({ role: 'user', content: 'halo' });
    // Array sumber tidak boleh ikut termutasi (dipakai juga untuk menyimpan sesi)
    expect(history).toHaveLength(1);
  });
});
