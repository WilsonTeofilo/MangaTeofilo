import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HelmetProvider } from 'react-helmet-async';

// 1. CSS GLOBAL (Reset, Tokens de Cores, Scrollbar e Body)
// Esse cara precisa vir ANTES do App para garantir que o fundo
// seja sempre o "Preto Profundo" (#0a0a0a) em todas as rotas.
import './index.css';

// 2. COMPONENTE PRINCIPAL
import App from './App.jsx';

// 3. RENDERIZAÇÃO
const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error("Elemento 'root' não encontrado. Verifique seu index.html.");
}

createRoot(rootElement).render(
  <StrictMode>
    <HelmetProvider>
      <App />
    </HelmetProvider>
  </StrictMode>
);