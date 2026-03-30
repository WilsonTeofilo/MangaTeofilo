import React, { useEffect, useMemo, useState } from 'react';
import { onValue, ref as dbRef } from 'firebase/database';
import { useNavigate } from 'react-router-dom';

import { auth, db } from '../../services/firebase';
import { isAdminUser } from '../../constants';
import {
  OBRA_PADRAO_ID,
  OBRA_SHITO_DEFAULT,
  ensureLegacyShitoObra,
  obterObraIdCapitulo,
} from '../../config/obras';
import './CapitulosAdminHub.css';

function toSortedObras(raw) {
  const list = ensureLegacyShitoObra(
    Object.entries(raw || {}).map(([id, data]) => ({ id, ...(data || {}) }))
  );
  if (!list.length) return [{ ...OBRA_SHITO_DEFAULT, id: OBRA_PADRAO_ID }];
  return list.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
}

export default function CapitulosAdminHub() {
  const navigate = useNavigate();
  const user = auth.currentUser;
  const [loading, setLoading] = useState(true);
  const [obras, setObras] = useState([]);
  const [capitulos, setCapitulos] = useState([]);
  const [obraId, setObraId] = useState(OBRA_PADRAO_ID);

  useEffect(() => {
    if (!isAdminUser(user)) {
      navigate('/');
      return;
    }
    const unsubObras = onValue(dbRef(db, 'obras'), (snapshot) => {
      const list = toSortedObras(snapshot.exists() ? snapshot.val() : {});
      setObras(list);
      setObraId((curr) => {
        if (list.some((o) => o.id === curr)) return curr;
        return list[0]?.id || OBRA_PADRAO_ID;
      });
      setLoading(false);
    });
    const unsubCaps = onValue(dbRef(db, 'capitulos'), (snapshot) => {
      const list = snapshot.exists()
        ? Object.entries(snapshot.val() || {}).map(([id, data]) => ({ id, ...(data || {}) }))
        : [];
      setCapitulos(list);
    });
    return () => {
      unsubObras();
      unsubCaps();
    };
  }, [navigate, user]);

  const obraAtual = useMemo(
    () => obras.find((o) => o.id === obraId) || { ...OBRA_SHITO_DEFAULT, id: obraId },
    [obras, obraId]
  );

  const capitulosObra = useMemo(() => {
    return capitulos
      .filter((cap) => obterObraIdCapitulo(cap) === obraId)
      .sort((a, b) => Number(b.numero || 0) - Number(a.numero || 0));
  }, [capitulos, obraId]);

  if (loading) return <div className="shito-app-splash" aria-hidden="true" />;

  return (
    <main className="capitulos-admin-hub">
      <header className="capitulos-admin-hub__head">
        <div>
          <h1>Capítulos</h1>
          <p>Selecione a obra primeiro. Depois crie ou edite capítulos dela.</p>
        </div>
      </header>

      <section className="capitulos-admin-hub__selector">
        <div className="capitulos-admin-hub__selector-main">
          <label>
            Selecionar obra
            <select value={obraId} onChange={(e) => setObraId(String(e.target.value || OBRA_PADRAO_ID))}>
              {obras.map((obra) => (
                <option key={obra.id} value={obra.id}>
                  {obra.tituloCurto || obra.titulo || obra.id}
                </option>
              ))}
            </select>
          </label>
          <div className="capitulos-admin-hub__selector-actions">
            <button
              type="button"
              className="capitulos-admin-hub__new-chapter"
              onClick={() => navigate(`/admin/manga?obra=${encodeURIComponent(obraId)}`)}
            >
              + Novo capítulo
            </button>
            <p className="capitulos-admin-hub__hint-create">
              Não encontrou a obra?
              <button type="button" className="capitulos-admin-hub__create-work" onClick={() => navigate('/admin/obras')}>
                Criar nova obra
              </button>
            </p>
          </div>
        </div>
        <div className="capitulos-admin-hub__selected">
          <strong>{obraAtual.titulo || obraAtual.id}</strong>
          <span>{obraAtual.isPublished ? 'Publicada' : 'Oculta'}</span>
        </div>
      </section>

      <section className="capitulos-admin-hub__list">
        <header>
          <h2>Capítulos da obra</h2>
          <span>{capitulosObra.length} capítulos</span>
        </header>
        {!capitulosObra.length ? (
          <p className="capitulos-admin-hub__empty">Nenhum capítulo ainda. Crie o primeiro.</p>
        ) : (
          <div className="capitulos-admin-hub__rows">
            {capitulosObra.map((cap) => (
              <article key={cap.id}>
                <div>
                  <strong>#{cap.numero} — {cap.titulo || 'Sem título'}</strong>
                  <span>{cap.publicReleaseAt ? 'Agendado' : 'Publicado'} · {cap.antecipadoMembros ? 'VIP antecipado' : 'VIP off'}</span>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    navigate(`/admin/manga?obra=${encodeURIComponent(obraId)}&edit=${encodeURIComponent(cap.id)}`)
                  }
                >
                  Editar
                </button>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

