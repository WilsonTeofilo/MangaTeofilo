import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';

// Firebase imports
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, onAuthStateChanged } from 'firebase/auth';

// Componentes Globais
import Header from './Header'; 

// Pages
import Login from './Login';
import ShitoGame from './ShitoGame';
import SobreAutor from './SobreAutor';
import Apoie from './Apoie';
import AdminPanel from './AdminPanel';
import Capitulos from './Capitulos'; // Novo Import
import Leitor from './Leitor';       // Novo Import (o próximo que vamos criar)

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

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const auth = getAuth(app);

export default function App() {
  const [usuario, setUsuario] = useState(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUsuario(user);
      setCarregando(false);
    });
    return () => unsubscribe();
  }, []);

  if (carregando) {
    return (
      <div className="loading-screen" style={{
        height: '100vh', background: '#050505', display: 'flex', 
        alignItems: 'center', justifyContent: 'center', color: '#ffcc00'
      }}>
        Carregando Alma...
      </div>
    );
  }

  return (
    <Router>
      {/* O Header recebe o usuário para mostrar "Olá, Wilson" ou o botão Login */}
      <Header usuario={usuario} />

      <Routes>
        {/* HOME */}
        <Route path="/" element={<ShitoGame user={usuario} />} />
        
        {/* VITRINE DE CAPÍTULOS (Manga Livre style) */}
        <Route path="/capitulos" element={<Capitulos user={usuario} />} />

        {/* O LEITOR (Onde as páginas do mangá aparecem) */}
        <Route path="/ler/:id" element={<Leitor user={usuario} />} />
        
        {/* AUTH E ADMIN */}
        <Route path="/login" element={<Login user={usuario} />} />
        <Route path="/admin" element={<AdminPanel user={usuario} />} />
        
        {/* INSTITUCIONAL */}
        <Route path="/sobre-autor" element={<SobreAutor user={usuario} />} />
        <Route path="/apoie" element={<Apoie user={usuario} />} />

        {/* Rota 404 */}
        <Route path="*" element={
          <div style={{ 
            height: '80vh', display: 'flex', alignItems: 'center', 
            justifyContent: 'center', color: 'white', fontSize: '1.5rem' 
          }}>
            A névoa encobriu esta página (404)
          </div>
        } />
      </Routes>
    </Router>
  );
}