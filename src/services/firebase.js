// src/services/firebase.js
import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getDatabase } from 'firebase/database';
import { getStorage } from 'firebase/storage';
import { getFunctions } from 'firebase/functions';

const DEFAULT_PROD_FIREBASE_CONFIG = {
  apiKey: 'AIzaSyCIfoyLhykhz6IstjXNfHvMOltnPUHNvIA',
  authDomain: 'shitoproject-ed649.firebaseapp.com',
  projectId: 'shitoproject-ed649',
  storageBucket: 'shitoproject-ed649.firebasestorage.app',
  messagingSenderId: '613627655546',
  appId: '1:613627655546:web:370838bb5e3867f431d2c3',
  measurementId: 'G-5QNETWX5RW',
  databaseURL: 'https://shitoproject-ed649-default-rtdb.firebaseio.com',
};

function readStringEnv(value, fallback = '') {
  const normalized = String(value || '').trim();
  return normalized || fallback;
}

const appEnv = readStringEnv(import.meta.env.VITE_APP_ENV, import.meta.env.DEV ? 'dev' : 'prod').toLowerCase();
const projectId = readStringEnv(import.meta.env.VITE_FIREBASE_PROJECT_ID, DEFAULT_PROD_FIREBASE_CONFIG.projectId);

const firebaseConfig = {
  apiKey: readStringEnv(import.meta.env.VITE_FIREBASE_API_KEY, DEFAULT_PROD_FIREBASE_CONFIG.apiKey),
  authDomain: readStringEnv(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN, DEFAULT_PROD_FIREBASE_CONFIG.authDomain),
  projectId,
  storageBucket: readStringEnv(import.meta.env.VITE_FIREBASE_STORAGE_BUCKET, DEFAULT_PROD_FIREBASE_CONFIG.storageBucket),
  messagingSenderId: readStringEnv(
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    DEFAULT_PROD_FIREBASE_CONFIG.messagingSenderId
  ),
  appId: readStringEnv(import.meta.env.VITE_FIREBASE_APP_ID, DEFAULT_PROD_FIREBASE_CONFIG.appId),
  measurementId: readStringEnv(
    import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
    DEFAULT_PROD_FIREBASE_CONFIG.measurementId
  ),
  databaseURL: readStringEnv(import.meta.env.VITE_FIREBASE_DATABASE_URL, DEFAULT_PROD_FIREBASE_CONFIG.databaseURL),
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getDatabase(app);
export const storage = getStorage(app);
export const functions = getFunctions(
  app,
  readStringEnv(import.meta.env.VITE_FUNCTIONS_REGION, 'us-central1')
);

// Este cliente usa o Firebase configurado via Vite env.
// Emuladores locais so entram se outra camada do app conectar explicitamente neles.

export const firebaseRuntime = {
  appEnv,
  projectId,
};

let appCheckInitialized = false;

export function initializeClientAppCheck() {
  if (appCheckInitialized) return null;
  const siteKey = readStringEnv(import.meta.env.VITE_FIREBASE_APP_CHECK_SITE_KEY, '');
  const debugToken = readStringEnv(import.meta.env.VITE_FIREBASE_APP_CHECK_DEBUG_TOKEN, '');
  if (!siteKey) return null;
  if (debugToken && typeof globalThis !== 'undefined') {
    globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken;
  }
  const appCheck = initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(siteKey),
    isTokenAutoRefreshEnabled: true,
  });
  appCheckInitialized = true;
  return appCheck;
}

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

