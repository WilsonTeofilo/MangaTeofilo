// src/services/firebase.js
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getDatabase } from 'firebase/database';
import { getStorage } from 'firebase/storage';
import { getFunctions } from 'firebase/functions';

const firebaseConfig = {
  apiKey:            'AIzaSyCIfoyLhykhz6IstjXNfHvMOltnPUHNvIA',
  authDomain:        'shitoproject-ed649.firebaseapp.com',
  projectId:         'shitoproject-ed649',
  storageBucket:     'shitoproject-ed649.firebasestorage.app',
  messagingSenderId: '613627655546',
  appId:             '1:613627655546:web:370838bb5e3867f431d2c3',
  measurementId:     'G-5QNETWX5RW',
  databaseURL:       'https://shitoproject-ed649-default-rtdb.firebaseio.com',
};

const app = initializeApp(firebaseConfig);

export const auth      = getAuth(app);
export const db        = getDatabase(app);
export const storage   = getStorage(app);
export const functions = getFunctions(app, 'us-central1');

// SEM connectAuthEmulator, SEM connectDatabaseEmulator, SEM connectFunctionsEmulator
// Tudo vai direto pro Firebase de produção — simples e funcional.

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

