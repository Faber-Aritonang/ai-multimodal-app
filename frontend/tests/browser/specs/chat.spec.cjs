/**
 * Spec: halaman /chat
 *
 * Menguji alur yang benar-benar dipakai user: buka chat -> badge kuota tampil ->
 * kirim pesan -> balasan AI muncul dengan label provider -> kuota berkurang ->
 * data uji dibersihkan.
 */

const MESSAGE =
  'Tampilkan tabel markdown 2 baris yang membandingkan Groq dan Gemini, ' +
  'lalu tulis kata PENTING dengan **tebal**.';

// Dibaca dari DOM halaman. Tanpa backslash: ekspresi ini dikirim sebagai string.
const READ_STATE = `(() => {
  const nl = String.fromCharCode(10);
  const bubbles = Array.from(document.querySelectorAll('[data-testid="chat-message"]'));
  const last = bubbles[bubbles.length - 1];
  const badge = document.querySelector('[data-testid="chat-quota"]');
  return {
    path: location.pathname,
    badge: badge ? badge.innerText.trim() : null,
    badgeMerah: badge ? badge.className.indexOf('text-red-600') !== -1 : null,
    jumlahBubble: bubbles.length,
    adaBalasan: bubbles.some((b) => b.getAttribute('data-role') === 'assistant'),
    teksTerakhir: last ? last.innerText.split(nl).join(' | ').slice(0, 200) : null,
    labelProvider: last ? (last.innerText.match(/via [a-z]+[^ ]*/) || [null])[0] : null,
    strong: last ? last.querySelectorAll('strong').length : 0,
    tabel: last ? last.querySelectorAll('table').length : 0,
    blokKode: last ? last.querySelectorAll('pre').length : 0,
    simbolMentah: last ? last.innerText.indexOf('**') !== -1 : null,
    barisTabelMentah: last ? last.innerText.indexOf('|---') !== -1 : null
  };
})()`;

const angkaDari = (teks) => {
  const cocok = String(teks || '').match(/[0-9]+/);
  return cocok ? Number(cocok[0]) : null;
};

module.exports = {
  name: 'chat',

  async run({ session, reporter, api, sleep }) {
    await session.open('/chat');

    const awal = await session.waitFor(async () => {
      const state = await session.evaluate(READ_STATE);
      return state.badge ? state : null;
    }, { timeoutMs: 20000 });

    reporter.check('halaman chat membuat sesi baru', Boolean(awal && awal.path.startsWith('/chat/')), awal?.path);
    const kuotaAwal = awal ? angkaDari(awal.badge) : null;
    reporter.check(
      'badge sisa kuota tampil di header',
      Number.isFinite(kuotaAwal) && kuotaAwal > 0,
      awal?.badge
    );

    await session.evaluate(`(() => {
      const ta = document.querySelector('textarea');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, ${JSON.stringify(MESSAGE)});
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return 'terkirim';
    })()`);

    const sesudah = await session.waitFor(async () => {
      const state = await session.evaluate(READ_STATE);
      return state.jumlahBubble >= 2 && state.adaBalasan ? state : null;
    }, { timeoutMs: 90000, intervalMs: 2000 });

    if (!reporter.check('balasan AI muncul di UI', Boolean(sesudah), sesudah?.teksTerakhir)) return;

    reporter.matches('balasan diberi label provider yang menjawab', sesudah.labelProvider, /via (groq|gemini|openai)/);
    reporter.check(
      'markdown dirender, bukan simbol mentah',
      sesudah.simbolMentah === false && sesudah.barisTabelMentah === false,
      `**=${sesudah.simbolMentah} |---=${sesudah.barisTabelMentah} · ${sesudah.teksTerakhir}`
    );
    reporter.check(
      'elemen markdown ter-render di DOM',
      sesudah.strong + sesudah.tabel + sesudah.blokKode > 0,
      `strong=${sesudah.strong} tabel=${sesudah.tabel} pre=${sesudah.blokKode}`
    );

    const kuotaSesudah = angkaDari(sesudah.badge);
    reporter.equal('kuota chat berkurang 1 setelah balasan', kuotaSesudah, kuotaAwal - 1);

    reporter.equal('tidak ada respons HTTP >= 400', session.httpErrors.length, 0);

    // Bersihkan sesi yang dibuat spec ini (kuota tidak bisa dikembalikan dari sini).
    const sessionId = awal?.path?.split('/').filter(Boolean)[1];
    if (sessionId) {
      const hapus = await api.del(`/member/chat/sessions/${sessionId}`);
      reporter.equal('sesi uji dibersihkan lewat API', hapus.status, 200);
    }

    await sleep(200);
  }
};
