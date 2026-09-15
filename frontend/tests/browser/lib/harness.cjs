/**
 * Harness uji browser tanpa dependency tambahan.
 *
 * Memakai Chrome yang sudah terpasang di mesin (headless) lewat protokol
 * DevTools (CDP) — jadi tidak perlu Playwright/Puppeteer: Node 22 sudah punya
 * `fetch` dan `WebSocket` global.
 *
 * Yang disediakan:
 *   findChrome()          -> path binary Chrome, atau null
 *   launchSession(opts)   -> { session } dengan Chrome + koneksi CDP siap
 *   session.open(url)     -> navigasi + tunggu render
 *   session.evaluate(js)  -> jalankan ekspresi di halaman, ambil nilainya
 *   session.waitFor(fn)   -> polling sampai predicate mengembalikan nilai truthy
 *   session.httpErrors / consoleErrors / networkFailures
 *   Reporter              -> kumpulan assertion + cetak hasil
 *
 * Catatan penting: ekspresi yang dikirim ke `evaluate` tidak boleh memakai
 * backslash (mis. RegExp `\d`) karena literal-nya rusak saat dikirim sebagai
 * string. Pakai `[0-9]`, `[ ]`, atau String.fromCharCode(10) sebagai gantinya.
 */

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const CHROME_CANDIDATES = [
  process.env.CHROME_BIN,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium'
].filter(Boolean);

/**
 * Cari binary Chrome/Chromium. CHROME_BIN selalu menang.
 * @returns {string|null}
 */
const findChrome = () => {
  for (const candidate of CHROME_CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate;
  }

  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    const result = spawnSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf8' });
    if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
  }

  return null;
};

/**
 * Buka koneksi CDP ke target page dan kembalikan objek { send, onEvent, close }.
 */
const connectCdp = async (webSocketDebuggerUrl) => {
  const socket = new WebSocket(webSocketDebuggerUrl);

  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = () => reject(new Error('Gagal membuka WebSocket CDP'));
  });

  let nextId = 0;
  const pending = new Map();
  const listeners = [];

  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);

    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
      return;
    }

    listeners.forEach((listener) => listener(message));
  };

  return {
    send: (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++nextId;
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      }),
    onEvent: (listener) => listeners.push(listener),
    close: () => {
      try {
        socket.close();
      } catch {
        // diabaikan: koneksi memang sudah ditutup
      }
    }
  };
};

// Derau yang selalu muncul di dev dan bukan indikasi bug aplikasi.
const IGNORED_CONSOLE_PATTERNS = [
  /\[vite\]/i,
  /React DevTools/i,
  /React Router Future Flag/i,
  /Download the React DevTools/i
];

class BrowserSession {
  constructor({ chrome, cdp, baseUrl, profileDir }) {
    this.chrome = chrome;
    this.cdp = cdp;
    this.baseUrl = baseUrl;
    this.profileDir = profileDir;
    this.consoleErrors = [];
    this.consoleLogs = [];
    this.httpErrors = [];
    this.networkFailures = [];
    // Pola error console yang memang diharapkan oleh spec (mis. kegagalan yang
    // sengaja dipicu untuk menguji pesan error di UI).
    this.allowedConsoleErrorPatterns = [];

    cdp.onEvent((message) => {
      if (message.method === 'Runtime.consoleAPICalled') {
        const { type, args } = message.params;
        const text = (args || []).map((a) => a.value ?? a.type).join(' ');
        if (IGNORED_CONSOLE_PATTERNS.some((re) => re.test(text))) return;
        if (type === 'error') this.consoleErrors.push(text.slice(0, 300));
        else this.consoleLogs.push(`[${type}] ${text.slice(0, 300)}`);
      }

      if (message.method === 'Runtime.exceptionThrown') {
        const details = message.params.exceptionDetails;
        this.consoleErrors.push((details.exception?.description || details.text || '').slice(0, 300));
      }

      if (message.method === 'Network.responseReceived' && message.params.response.status >= 400) {
        this.httpErrors.push(`${message.params.response.status} ${message.params.response.url}`);
      }

      if (message.method === 'Network.loadingFailed') {
        this.networkFailures.push(`${message.params.errorText} (${message.params.type})`);
      }
    });
  }

  /** Isi localStorage sebelum halaman aplikasi dibuka. */
  async setAuth({ token, user }) {
    await this.open('/login', { settleMs: 2500 });
    await this.evaluate(`
      localStorage.setItem('authToken', ${JSON.stringify(token)});
      localStorage.setItem('user', ${JSON.stringify(JSON.stringify(user))});
      'auth disimpan'
    `);
  }

  /** Buka path aplikasi (relatif terhadap baseUrl) dan tunggu render. */
  async open(pathname, { settleMs = 3500 } = {}) {
    await this.cdp.send('Page.navigate', { url: `${this.baseUrl}${pathname}` });
    await sleep(settleMs);
  }

  /** Jalankan ekspresi di konteks halaman. */
  async evaluate(expression) {
    const result = await this.cdp.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    });

    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || 'evaluate gagal');
    }

    return result.result.value;
  }

  /**
   * Izinkan error console tertentu. Dipakai saat spec sengaja memicu kegagalan:
   * halaman tetap menampilkan pesan ramah ke user, tapi mencatat detail teknis
   * ke console untuk debugging.
   */
  allowConsoleErrors(pattern) {
    this.allowedConsoleErrorPatterns.push(pattern);
  }

  /** Error console yang tidak diizinkan oleh spec mana pun. */
  get unexpectedConsoleErrors() {
    return this.consoleErrors.filter(
      (text) => !this.allowedConsoleErrorPatterns.some((pattern) => pattern.test(text))
    );
  }

  /**
   * Polling sampai `read()` mengembalikan nilai truthy.
   * @returns {Promise<any>} nilai terakhir (truthy), atau null kalau timeout
   */
  async waitFor(read, { timeoutMs = 60000, intervalMs = 1500 } = {}) {
    const deadline = Date.now() + timeoutMs;
    let last = null;

    while (Date.now() < deadline) {
      last = await read();
      if (last) return last;
      await sleep(intervalMs);
    }

    return null;
  }

  async close() {
    try {
      this.cdp.close();
    } catch {
      // diabaikan
    }
    try {
      this.chrome.kill('SIGKILL');
    } catch {
      // diabaikan
    }
  }
}

/**
 * Jalankan Chrome headless + siapkan BrowserSession.
 * @param {{baseUrl: string, profileName: string, windowSize?: string}} opts
 */
const launchSession = async ({ baseUrl, profileName, windowSize = '1280,1000' }) => {
  const chromePath = findChrome();
  if (!chromePath) {
    throw new Error(
      'Chrome/Chromium tidak ditemukan. Set CHROME_BIN ke path binary Chrome untuk menjalankan uji browser.'
    );
  }

  const port = 9400 + Math.floor(Math.random() * 500);
  const profileDir = path.join(os.tmpdir(), `browser-test-${profileName}-${Date.now()}`);
  fs.rmSync(profileDir, { recursive: true, force: true });

  const chrome = spawn(
    chromePath,
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      `--window-size=${windowSize}`,
      'about:blank'
    ],
    { stdio: 'ignore' }
  );

  const deadline = Date.now() + 20000;
  let target = null;

  while (Date.now() < deadline && !target) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = list.find((item) => item.type === 'page');
    } catch {
      await sleep(300);
    }
  }

  if (!target) {
    chrome.kill('SIGKILL');
    throw new Error('Chrome DevTools tidak siap dalam 20 detik');
  }

  const cdp = await connectCdp(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Network.enable');

  return new BrowserSession({ chrome, cdp, baseUrl, profileDir });
};

/**
 * Kumpulan assertion sederhana dengan keluaran yang bisa dibaca.
 */
class Reporter {
  constructor(name) {
    this.name = name;
    this.checks = [];
  }

  check(label, ok, detail = null) {
    this.checks.push({ label, ok: Boolean(ok), detail });
    return Boolean(ok);
  }

  equal(label, actual, expected) {
    return this.check(
      label,
      Object.is(actual, expected),
      Object.is(actual, expected) ? null : `dapat ${JSON.stringify(actual)}, harusnya ${JSON.stringify(expected)}`
    );
  }

  contains(label, haystack, needle) {
    const ok = typeof haystack === 'string' && haystack.includes(needle);
    return this.check(label, ok, ok ? null : `${JSON.stringify(haystack)} tidak memuat ${JSON.stringify(needle)}`);
  }

  matches(label, value, pattern) {
    const ok = typeof value === 'string' && pattern.test(value);
    return this.check(label, ok, ok ? null : `${JSON.stringify(value)} tidak cocok ${pattern}`);
  }

  get failedChecks() {
    return this.checks.filter((item) => !item.ok);
  }

  print() {
    const lines = [`── ${this.name} ──`];
    this.checks.forEach((item) => {
      lines.push(`  ${item.ok ? 'PASS' : 'FAIL'}  ${item.label}${item.detail ? ` — ${item.detail}` : ''}`);
    });
    return lines.join('\n');
  }
}

module.exports = { findChrome, launchSession, Reporter, sleep, BrowserSession };
