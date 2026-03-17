import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { getAuth, onAuthStateChanged } from "firebase/auth";
import Login from './Login';
import ShitoGame from './ShitoGame';

export default function App() {
  const [usuario, setUsuario] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const auth = getAuth();

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setUsuario(user);
      setCarregando(false);
    });
    return () => unsub();
  }, []);

  if (carregando) return <div className="loading">Carregando Alma...</div>;

  return (
    <Router>
      <Routes>
        {/* Se logado, vai pro jogo. Se não, fica no login */}
        <Route path="/" element={usuario ? <Navigate to="/game" /> : <Login />} />
        <Route path="/game" element={usuario ? <ShitoGame /> : <Navigate to="/" />} />
      </Routes>
    </Router>
  );
}