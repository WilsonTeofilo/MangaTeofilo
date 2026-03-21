// src/App.jsx
import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';

// Firebase imports
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, onAuthStateChanged } from 'firebase/auth';

// Pages
import Login from './Login';
import ShitoGame from './ShitoGame';
import SobreAutor from './SobreAutor';
import Apoie from './Apoie';  // ← Import corrigido (ajuste o caminho se estiver em src/pages/Apoie.jsx)

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

// Inicializa Firebase apenas uma vez
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

    // Cleanup do listener
    return () => unsubscribe();
  }, []);

  if (carregando) {
    return <div className="loading">Carregando Alma...</div>;
  }

  return (
    <Router>
      <Routes>
        <Route path="/" element={<ShitoGame user={usuario} />} />
        <Route path="/login" element={<Login user={usuario} />} />
        <Route path="/sobre-autor" element={<SobreAutor user={usuario} />} />
        <Route path="/apoie" element={<Apoie user={usuario} />} />  {/* ← Rota corrigida e adicionada */}

        {/* Rota futura para capítulos */}
        {/* <Route path="/capitulos" element={<Capitulos user={usuario} />} /> */}

        {/* Rota 404 para evitar páginas em branco vazias */}
        <Route path="*" element={
          <div style={{ 
            height: '100vh', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            color: 'white', 
            fontSize: '2rem' 
          }}>
            Página não encontrada (404) — Volte para <a href="/" style={{ color: '#ffcc00' }}>Início</a>
          </div>
        } />
      </Routes>
    </Router>
  );
}