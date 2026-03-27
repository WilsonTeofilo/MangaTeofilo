import React from 'react';
import { useNavigate } from 'react-router-dom';
import './FinanceiroAdmin.css';

export default function FinanceiroAdmin() {
  const navigate = useNavigate();

  return (
    <main className="admin-empty-page">
      <section className="admin-empty-card">
        <h1>Financeiro Administrativo</h1>
        <p>Area reservada para planos, promocoes, vendas normais e integracao de pagamentos.</p>
        <button type="button" onClick={() => navigate('/')}>Voltar para inicio</button>
      </section>
    </main>
  );
}
