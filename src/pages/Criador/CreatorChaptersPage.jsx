import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { onValue, ref as dbRef } from 'firebase/database';

import CapitulosAdminHub from '../Admin/CapitulosAdminHub.jsx';
import { auth, db } from '../../services/firebase';
import { obraCreatorId } from '../../config/obras';
import './CreatorFrame.css';

export default function CreatorChaptersPage({ adminAccess }) {
  const navigate = useNavigate();
  const user = auth.currentUser;
  const [creatorWorks, setCreatorWorks] = useState([]);
  const [worksLoaded, setWorksLoaded] = useState(false);
  const [workPickerOpen, setWorkPickerOpen] = useState(false);
  const [selectedWorkId, setSelectedWorkId] = useState('');

  useEffect(() => {
    if (!user?.uid) {
      setCreatorWorks([]);
      setSelectedWorkId('');
      setWorksLoaded(true);
      return () => {};
    }

    const unsub = onValue(
      dbRef(db, 'obras'),
      (snapshot) => {
        const raw = snapshot.exists() ? snapshot.val() : {};
        const visibleWorks = Object.entries(raw || {})
          .map(([id, data]) => ({ id, ...(data || {}) }))
          .filter((obra) => obraCreatorId(obra) === user.uid)
          .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));

        setCreatorWorks(visibleWorks);
        setSelectedWorkId((current) => {
          if (visibleWorks.some((obra) => obra.id === current)) return current;
          return visibleWorks[0]?.id || '';
        });
        setWorksLoaded(true);
      },
      () => {
        setCreatorWorks([]);
        setSelectedWorkId('');
        setWorksLoaded(true);
      }
    );

    return () => unsub();
  }, [user?.uid]);

  const selectedWork = useMemo(
    () => creatorWorks.find((obra) => obra.id === selectedWorkId) || null,
    [creatorWorks, selectedWorkId]
  );

  const openNewChapterFlow = () => {
    if (!worksLoaded) return;
    if (creatorWorks.length === 0) {
      navigate('/creator/obras');
      return;
    }
    if (creatorWorks.length === 1) {
      navigate(`/creator/editor?obra=${encodeURIComponent(creatorWorks[0].id)}`);
      return;
    }
    setWorkPickerOpen(true);
  };

  const confirmSelectedWork = () => {
    if (!selectedWorkId) return;
    setWorkPickerOpen(false);
    navigate(`/creator/editor?obra=${encodeURIComponent(selectedWorkId)}`);
  };

  return (
    <div className="creator-frame-page">
      <section className="creator-frame-shell">
        <header className="creator-frame-hero">
          <div>
            <p className="creator-frame-eyebrow">Capítulos do creator</p>
            <h1>Capítulos e publicação</h1>
            <p>
              Escolha a obra, acompanhe a linha editorial e publique capítulos com lançamento normal
              ou early access para membros do seu catálogo de creator.
            </p>
          </div>
          <div className="creator-frame-actions">
            <button
              type="button"
              className="creator-frame-btn"
              onClick={openNewChapterFlow}
              disabled={!worksLoaded}
            >
              Novo capítulo
            </button>
            <button type="button" className="creator-frame-btn is-primary" onClick={() => navigate('/perfil')}>
              Meu perfil
            </button>
          </div>
        </header>

        <section className="creator-frame-notes">
          <article className="creator-frame-note">
            <strong>Cadência</strong>
            <p>Seu ritmo de publicação vive aqui, obra por obra, sem precisar depender do admin.</p>
          </article>
          <article className="creator-frame-note">
            <strong>Early access</strong>
            <p>Capítulos antecipados seguem a regra correta: acesso só para membros do criador correspondente.</p>
          </article>
          <article className="creator-frame-note">
            <strong>Revisão</strong>
            <p>Use este hub para revisar capítulos existentes e entrar rápido no editor quando precisar.</p>
          </article>
        </section>

        <CapitulosAdminHub adminAccess={adminAccess} workspace="creator" />
      </section>

      {workPickerOpen ? (
        <div
          className="creator-frame-modal-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setWorkPickerOpen(false);
          }}
        >
          <div
            className="creator-frame-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="creator-work-picker-title"
          >
            <p className="creator-frame-modal__eyebrow">Novo capítulo</p>
            <h2 id="creator-work-picker-title">Escolha a obra antes de abrir o editor</h2>
            <p className="creator-frame-modal__copy">
              O editor precisa saber em qual obra o capítulo vai nascer. Escolha uma abaixo e a
              gente entra direto no fluxo certo.
            </p>

            <label className="creator-frame-modal__field">
              Obra
              <select value={selectedWorkId} onChange={(e) => setSelectedWorkId(String(e.target.value || ''))}>
                {creatorWorks.map((obra) => (
                  <option key={obra.id} value={obra.id}>
                    {obra.tituloCurto || obra.titulo || obra.id}
                  </option>
                ))}
              </select>
            </label>

            {selectedWork ? (
              <div className="creator-frame-modal__selected" role="status">
                <strong>{selectedWork.titulo || selectedWork.id}</strong>
                <span>{selectedWork.isPublished ? 'Publicada' : 'Ainda oculta'}</span>
              </div>
            ) : null}

            <div className="creator-frame-modal__actions">
              <button type="button" className="creator-frame-btn" onClick={() => setWorkPickerOpen(false)}>
                Voltar ao hub
              </button>
              <button type="button" className="creator-frame-btn" onClick={() => navigate('/creator/obras')}>
                Ir para minhas obras
              </button>
              <button
                type="button"
                className="creator-frame-btn is-primary"
                onClick={confirmSelectedWork}
                disabled={!selectedWorkId}
              >
                Abrir editor
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
