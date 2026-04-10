import React, { useEffect, useMemo, useState } from 'react';
import { onValue, query, orderByChild, equalTo, ref as dbRef } from 'firebase/database';
import { useNavigate } from 'react-router-dom';

import { auth, db } from '../../services/firebase';
import { canAccessAdminPath } from '../../auth/adminPermissions';
import { obraCreatorId } from '../../config/obras';
import './CapitulosAdminHub.css';

function toSortedObras(raw) {
  return Object.entries(raw || {})
    .map(([id, data]) => ({ id, ...(data || {}) }))
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
}

function toRecordList(raw) {
  return Object.entries(raw || {}).map(([id, data]) => ({ id, ...(data || {}) }));
}

function mergeCapitulosLists(...lists) {
  const map = new Map();
  lists.flat().forEach((item) => {
    const id = String(item?.id || '').trim();
    if (!id) return;
    map.set(id, item);
  });
  return Array.from(map.values());
}

function capituloDaObra(cap, obraId) {
  const alvo = String(obraId || '').trim().toLowerCase();
  if (!alvo) return true;
  const workId = String(cap?.workId || '').trim().toLowerCase();
  const obraRef = String(cap?.obraId || '').trim().toLowerCase();
  return (workId && workId === alvo) || (obraRef && obraRef === alvo);
}

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
  const [loading, setLoading] = useState(true);
  const [obras, setObras] = useState([]);
  const [allCapitulos, setAllCapitulos] = useState([]);
  const [obraId, setObraId] = useState('');

  useEffect(() => {
    if (!canAccessWorkspace) {
      navigate('/');
      return;
    }

    const unsubObras = onValue(
      dbRef(db, 'obras'),
      (snapshot) => {
        const list = toSortedObras(snapshot.exists() ? snapshot.val() : {});
        const visibleObras =
          isCreatorWorkspace && user?.uid
            ? list.filter((obra) => obraCreatorId(obra) === user.uid)
            : list;

        setObras(visibleObras);
        setObraId((current) => {
          if (visibleObras.some((obra) => obra.id === current)) return current;
          return visibleObras[0]?.id || '';
        });
        setLoading(false);
      },
      () => {
        setObras([]);
        setObraId('');
        setLoading(false);
      }
    );

    return () => {
      unsubObras();
    };
  }, [canAccessWorkspace, isCreatorWorkspace, navigate, user?.uid]);

  useEffect(() => {
    if (!canAccessWorkspace) {
      setAllCapitulos([]);
      return () => {};
    }

    if (isCreatorWorkspace) {
      if (!user?.uid) {
        setAllCapitulos([]);
        return () => {};
      }

      const unsubCreator = onValue(
        query(dbRef(db, 'capitulos'), orderByChild('creatorId'), equalTo(user.uid)),
        (snapshot) => {
          const lista = toRecordList(snapshot.exists() ? snapshot.val() : {});
          setAllCapitulos(lista);
        },
        () => {
          setAllCapitulos([]);
        }
      );

      return () => unsubCreator();
    }

    if (!obraId) {
      setAllCapitulos([]);
      return () => {};
    }

    let workList = [];
    let obraList = [];
    const syncCaps = () => setAllCapitulos(mergeCapitulosLists(workList, obraList));

    const unsubWork = onValue(
      query(dbRef(db, 'capitulos'), orderByChild('workId'), equalTo(obraId)),
      (snapshot) => {
        workList = toRecordList(snapshot.exists() ? snapshot.val() : {});
        syncCaps();
      },
      () => {
        workList = [];
        syncCaps();
      }
    );

    const unsubObra = onValue(
      query(dbRef(db, 'capitulos'), orderByChild('obraId'), equalTo(obraId)),
      (snapshot) => {
        obraList = toRecordList(snapshot.exists() ? snapshot.val() : {});
        syncCaps();
      },
      () => {
        obraList = [];
        syncCaps();
      }
    );

    return () => {
      unsubWork();
      unsubObra();
    };
  }, [canAccessWorkspace, isCreatorWorkspace, obraId, user?.uid]);

  const obraAtual = useMemo(
    () => obras.find((obra) => obra.id === obraId) || null,
    [obras, obraId]
  );

  const capitulosObra = useMemo(() => {
    const filtrados = allCapitulos.filter((cap) => capituloDaObra(cap, obraId));
    return [...filtrados].sort((a, b) => Number(b.numero || 0) - Number(a.numero || 0));
  }, [allCapitulos, obraId]);

  const capsSemWorkId = useMemo(
    () => capitulosObra.filter((cap) => !String(cap.workId || '').trim()).length,
    [capitulosObra]
  );

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
