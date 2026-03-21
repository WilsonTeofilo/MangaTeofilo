import { initializeApp } from "firebase/app";
import { 
  getAuth, 
  GoogleAuthProvider 
} from "firebase/auth";
import { getDatabase } from "firebase/database";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyCIfoyLhykhz6IstjXNfHvMOltnPUHNvIA",
  authDomain: "shitoproject-ed649.firebaseapp.com",
  projectId: "shitoproject-ed649",
  storageBucket: "shitoproject-ed649.firebasestorage.app",
  messagingSenderId: "613627655546",
  appId: "1:613627655546:web:370838bb5e3867f431d2c3",
  measurementId: "G-5QNETWX5RW",
  databaseURL: "https://shitoproject-ed649-default-rtdb.firebaseio.com"
};

// Inicializa o Firebase uma única vez
const app = initializeApp(firebaseConfig);

// Serviços principais
export const auth = getAuth(app);
export const db = getDatabase(app);
export const storage = getStorage(app);

// Provider específico para autenticação com Google
// (agora exportado corretamente para ser usado no Login.jsx)
export const googleProvider = new GoogleAuthProvider();

// Opcional: configurações extras úteis para Google Auth (pode adicionar se quiser)
googleProvider.setCustomParameters({
  prompt: 'select_account'  // força escolha de conta (evita login automático com conta errada)
});

// Exportação como objeto (opcional, mas ajuda em imports mais limpos em alguns casos)
export const firebaseServices = {
  auth,
  db,
  storage,
  googleProvider
};