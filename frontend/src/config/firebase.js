// Firebase configuration
// Nilai dibaca dari environment Vite (VITE_*).
// Salin frontend/.env.example -> frontend/.env.local lalu isi nilainya dari:
// Firebase Console -> Project Settings -> Your apps -> SDK setup and configuration

import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  onAuthStateChanged,
  signOut
} from 'firebase/auth';

const env = import.meta.env;

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID
};

// Variabel yang wajib ada agar Firebase Auth bisa diinisialisasi
const REQUIRED_CONFIG = ['apiKey', 'authDomain', 'projectId', 'appId'];

const ENV_NAME_BY_KEY = {
  apiKey: 'VITE_FIREBASE_API_KEY',
  authDomain: 'VITE_FIREBASE_AUTH_DOMAIN',
  projectId: 'VITE_FIREBASE_PROJECT_ID',
  storageBucket: 'VITE_FIREBASE_STORAGE_BUCKET',
  messagingSenderId: 'VITE_FIREBASE_MESSAGING_SENDER_ID',
  appId: 'VITE_FIREBASE_APP_ID'
};

const missingConfig = REQUIRED_CONFIG.filter((key) => !firebaseConfig[key]);

export const isFirebaseConfigured = missingConfig.length === 0;

export const firebaseConfigError = isFirebaseConfigured
  ? null
  : `Firebase belum dikonfigurasi. Variabel yang belum diisi: ${missingConfig
      .map((key) => ENV_NAME_BY_KEY[key])
      .join(', ')}. Salin frontend/.env.example ke frontend/.env.local lalu isi nilainya.`;

if (firebaseConfigError) {
  console.error(`[Firebase] ${firebaseConfigError}`);
}

// Inisialisasi hanya jika konfigurasi lengkap, supaya halaman login tetap bisa
// dirender dan menampilkan pesan error yang jelas alih-alih layar putih.
let app = null;
let auth = null;
let googleProvider = null;

if (isFirebaseConfigured) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);

  googleProvider = new GoogleAuthProvider();
  googleProvider.setCustomParameters({
    prompt: 'select_account'
  });
}

/**
 * Pesan bantuan untuk error Firebase yang paling sering muncul saat setup.
 * Kode error aslinya tetap ditampilkan supaya mudah dicari di dokumentasi.
 * Panduan langkah demi langkah: docs/setup-kredensial.md
 */
const FIREBASE_ERROR_HINTS = {
  'auth/configuration-not-found':
    'Provider Google belum diaktifkan di Firebase Console. Buka Authentication -> Sign-in method -> Google, lalu aktifkan.',
  'auth/operation-not-allowed':
    'Google Sign-In dinonaktifkan untuk project ini. Aktifkan di Authentication -> Sign-in method.',
  'auth/unauthorized-domain':
    'Domain aplikasi ini belum diizinkan. Tambahkan localhost (dan domain produksi) di Authentication -> Settings -> Authorized domains.',
  'auth/invalid-api-key':
    'VITE_FIREBASE_API_KEY salah. Salin ulang dari Project Settings -> General -> Your apps.',
  'auth/api-key-not-valid.-please-pass-a-valid-api-key.':
    'VITE_FIREBASE_API_KEY tidak valid. Salin ulang dari Project Settings -> General -> Your apps.',
  'auth/network-request-failed':
    'Tidak bisa menghubungi server Firebase. Periksa koneksi internet atau pemblokir iklan.',
  'auth/internal-error':
    'Firebase mengembalikan error internal. Biasanya karena konfigurasi project belum lengkap.'
};

const describeFirebaseError = (error) => {
  const code = error?.code ? ` (kode: ${error.code})` : '';
  const hint = FIREBASE_ERROR_HINTS[error?.code];

  if (hint) return `${hint}${code}`;
  return `${error?.message || 'Google sign-in gagal.'}${code}`;
};

// Sign in with Google
export const signInWithGoogle = async () => {
  if (!isFirebaseConfigured) {
    return { success: false, error: firebaseConfigError };
  }

  try {
    const result = await signInWithPopup(auth, googleProvider);
    const user = result.user;

    return {
      success: true,
      user: {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        photoURL: user.photoURL
      },
      token: user.accessToken || await user.getIdToken()
    };
  } catch (error) {
    // Fallback ke redirect jika popup diblokir browser
    if (
      error.code === 'auth/popup-blocked' ||
      error.code === 'auth/popup-closed-by-user' ||
      error.code === 'auth/cancelled-popup-request'
    ) {
      try {
        await signInWithRedirect(auth, googleProvider);
        return { success: true, redirecting: true };
      } catch (redirectError) {
        console.error('Google sign-in redirect error:', redirectError);
        return {
          success: false,
          code: redirectError.code,
          error: describeFirebaseError(redirectError)
        };
      }
    }

    console.error('Google sign-in error:', error);
    return {
      success: false,
      code: error.code,
      error: describeFirebaseError(error)
    };
  }
};

// Sign out
export const signOutUser = async () => {
  if (!isFirebaseConfigured) {
    return { success: true };
  }

  try {
    await signOut(auth);
    return { success: true };
  } catch (error) {
    console.error('Sign out error:', error);
    return { success: false, error: error.message };
  }
};

// Get current user token
export const getCurrentUser = async () => {
  if (!isFirebaseConfigured) {
    return null;
  }

  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      resolve(user || null);
    });
  });
};

export { app, auth, onAuthStateChanged };
