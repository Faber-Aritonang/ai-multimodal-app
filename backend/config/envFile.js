/**
 * Preferensi nilai .env untuk kredensial AI
 *
 * Secara default `dotenv` TIDAK menimpa variabel yang sudah ada di environment,
 * sehingga variabel shell menang atas file .env. Itu berbahaya untuk kredensial:
 * nilai yang rusak di ~/.bashrc (mis. tanda kutip tidak ditutup, sehingga dua
 * baris bergabung menjadi satu nilai) akan diam-diam menimpa key yang benar di
 * .env — gejalanya cuma "401 Invalid API Key" atau "Connection error" yang
 * membingungkan.
 *
 * Helper ini hanya menyentuh daftar key kredensial AI di bawah, dan hanya
 * dipakai saat NODE_ENV bukan production. Konfigurasi lain (PORT, MONGODB_URI,
 * UPLOAD_DIR, dst.) sama sekali tidak diubah supaya perilaku test dan deploy
 * tetap seperti sebelumnya.
 */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const AI_CREDENTIAL_KEYS = [
  'GROQ_API_KEY',
  'GEMINI_API_KEY',
  'OPENAI_API_KEY',
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_API_TOKEN',
  'POLLINATIONS_TOKEN'
];

/**
 * Pakai nilai dari file .env untuk key kredensial yang disebutkan, menimpa
 * nilai yang datang dari shell.
 *
 * @param {object} [options]
 * @param {string[]} [options.keys] key yang boleh ditimpa
 * @param {string} [options.envPath] lokasi file .env (default: cwd/.env)
 * @param {object} [options.env] objek environment (default: process.env)
 * @returns {string[]} daftar key yang nilainya diganti
 */
const preferEnvFile = ({
  keys = AI_CREDENTIAL_KEYS,
  envPath = path.resolve(process.cwd(), '.env'),
  env = process.env
} = {}) => {
  let parsed;

  try {
    parsed = dotenv.parse(fs.readFileSync(envPath));
  } catch {
    // Tanpa file .env (mis. di produksi) tidak ada yang perlu dilakukan.
    return [];
  }

  const changed = [];

  for (const key of keys) {
    const fromFile = parsed[key];

    if (!fromFile || env[key] === fromFile) continue;

    env[key] = fromFile;
    changed.push(key);
  }

  return changed;
};

module.exports = { preferEnvFile, AI_CREDENTIAL_KEYS };
