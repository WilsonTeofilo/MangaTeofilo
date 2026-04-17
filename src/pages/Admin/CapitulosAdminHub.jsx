import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

import { auth, db } from '../../services/firebase';
import { canAccessAdminPath } from '../../auth/adminPermissions';
import { useCapitulosAdminHubData } from './hooks/useCapitulosAdminHubData';
import './CapitulosAdminHub.css';

export default function CapitulosAdminHub({ adminAccess, workspace = 'admin' }) {
  const navigate = useNavigate();
  const user = auth.currentUser;
  const isMangaka = Boolean(adminAccess?.isMangaka);
  const editorPathBase = workspace === 'creator' ? '/creator/editor' : '/admin/manga';
  const obrasPath = workspace === 'creator' ? '/creator/obras' : '/admin/obras';
  const isCreatorWorkspace = workspace === 'creator';
  const canAccessWorkspace = isCreatorWorkspace
    ? isMangaka
    : canAccessAdminPath('/admin/capitulos', adminAccess);
  const {
    loading,
    obras,
    obraId,
    setObraId,
    obraAtual,
    capitulosObra,
    capsSemWorkId,
  } = useCapitulosAdminHubData({
    db,
    canAccessWorkspace,
    isCreatorWorkspace,
    userUid: user?.uid || '',
  });

  useEffect(() => {
    if (!canAccessWorkspace) {
      navigate('/');
      return undefined;
    }
    return undefined;
  }, [canAccessWorkspace, navigate]);

  if (loading) return <div className="shito-app-splash" aria-hidden="true" />;

  return (
    <main className="capitulos-admin-hub">
      <header className="capitulos-admin-hub__head">
        <div>
          <h1>{isMangaka ? 'Meus capítulos' : isCreatorWorkspace ? 'Fluxo de capítulos' : 'Capítulos'}</h1>
          <p>
            {isMangaka
              ? 'Selecione uma obra sua e publique sem depender do admin.'
              : isCreatorWorkspace
                ? 'Acompanhe e edite capítulos no domínio creator, com supervisão quando permitido.'
                : 'Selecione a obra primeiro. Depois crie ou edite capítulos dela.'}
          </p>
        </div>
      </header>

      <section className="capitulos-admin-hub__selector">
        <div className="capitulos-admin-hub__selector-main">
          <label>
            Selecionar obra
            <select value={obraId} onChange={(e) => setObraId(String(e.target.value || ''))}>
              {!obras.length ? <option value="">Nenhuma obra cadastrada</option> : null}
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
              disabled={!obraId}
              onClick={() => navigate(`${editorPathBase}?obra=${encodeURIComponent(obraId)}`)}
            >
              + Novo capítulo
            </button>
            <p className="capitulos-admin-hub__hint-create">
              {isMangaka ? 'Ainda não criou a obra base?' : 'Não encontrou a obra?'}
              <button type="button" className="capitulos-admin-hub__create-work" onClick={() => navigate(obrasPath)}>
                {isMangaka ? 'Criar minha obra' : 'Criar nova obra'}
              </button>
            </p>
          </div>
        </div>
        <div className="capitulos-admin-hub__selected">
          <strong>{obraAtual?.titulo || obraAtual?.id || 'Nenhuma obra selecionada'}</strong>
          <span>{obraAtual ? (obraAtual.isPublished ? 'Publicada' : 'Oculta') : 'Sem catálogo ativo'}</span>
        </div>
      </section>

      <section className="capitulos-admin-hub__list">
        {capsSemWorkId > 0 ? (
          <p className="capitulos-admin-hub__workid-warn" role="status">
            {capsSemWorkId} capítulo(s) sem campo <code>workId</code> (legado). Use em Equipe → Backfill workId ou
            re-salve o capítulo no editor para alinhar à fase multi-obra.
          </p>
        ) : null}
        <header>
          <h2>{isMangaka ? 'Linha editorial da obra' : 'Capítulos da obra'}</h2>
          <span>{capitulosObra.length} capítulos</span>
        </header>
        {!capitulosObra.length ? (
          <p className="capitulos-admin-hub__empty">
            {isMangaka ? 'Nenhum capítulo ainda. Publique o primeiro para tirar a obra do zero.' : 'Nenhum capítulo ainda. Crie o primeiro.'}
          </p>
        ) : (
          <div className="capitulos-admin-hub__rows">
            {capitulosObra.map((cap) => (
              <article key={cap.id}>
                <div>
                  <strong>#{cap.numero} — {cap.titulo || 'Sem título'}</strong>
                  <span>{cap.publicReleaseAt ? 'Agendado' : 'Publicado'} · {cap.antecipadoMembros ? 'Membership antecipada' : 'Membership off'}</span>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    navigate(`${editorPathBase}?obra=${encodeURIComponent(obraId)}&edit=${encodeURIComponent(cap.id)}`)
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
