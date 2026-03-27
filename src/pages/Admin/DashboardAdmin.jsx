import React from 'react';
import { useNavigate } from 'react-router-dom';
import './DashboardAdmin.css';

export default function DashboardAdmin() {
  const navigate = useNavigate();

  return (
    <main className="admin-empty-page">
      <section className="admin-empty-card">
        <h1>Dashboard Administrativo</h1>
        <p>Area reservada para metricas de leitores, assinaturas e conversao de promocoes.</p>
        <button type="button" onClick={() => navigate('/')}>Voltar para inicio</button>
      </section>
    </main>
  );
}
