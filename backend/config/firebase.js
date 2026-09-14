/**
 * Firebase Admin Configuration
 * Inisialisasi lazy: hanya dijalankan saat pertama kali dibutuhkan,
 * sehingga server tetap bisa start walau kredensial belum diisi.
 *
 * Mendukung dua format FIREBASE_SERVICE_ACCOUNT:
 *   1. JSON string langsung (produksi, mis. Railway secret):
 *      FIREBASE_SERVICE_ACCOUNT={"type":"service_account",...}
 *   2. Path ke file service account (lokal):
 *      FIREBASE_SERVICE_ACCOUNT=./config/firebase-service-account.json
 */

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

/**
 * Ambil kredensial service account dari env.
 * Throws dengan pesan deskriptif jika konfigurasi tidak valid.
 */
function getServiceAccountCredentials() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;

  if (!raw || !raw.trim()) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT is not set. ' +
      'Set it to a JSON string or a path to the service account file.'
    );
  }

  // Format 1: JSON string langsung
  if (raw.trim().startsWith('{')) {
    try {
      const serviceAccount = JSON.parse(raw);
      // Perbaiki private key yang newline-nya ter-escape saat di-paste ke env
      if (serviceAccount.private_key) {
        serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
      }
      return serviceAccount;
    } catch (err) {
      throw new Error('FIREBASE_SERVICE_ACCOUNT contains invalid JSON: ' + err.message);
    }
  }

  // Format 2: path file
  const filePath = path.isAbsolute(raw)
    ? raw
    : path.resolve(process.cwd(), raw);

  if (!fs.existsSync(filePath)) {
    throw new Error(
      `FIREBASE_SERVICE_ACCOUNT is not a JSON string and no file exists at: ${filePath}. ` +
      'Download the key from Firebase Console -> Project Settings -> Service Accounts.'
    );
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    throw new Error(`Failed to parse service account file ${filePath}: ` + err.message);
  }
}

/**
 * Dapatkan instance firebase-admin yang sudah ter-inisialisasi.
 * Inisialisasi dilakukan sekali, saat pertama kali dipanggil (lazy).
 */
function getFirebaseAdmin() {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(getServiceAccountCredentials()),
    });
    console.log('Firebase Admin SDK initialized');
  }
  return admin;
}

module.exports = { getFirebaseAdmin, getServiceAccountCredentials };
