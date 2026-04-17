import React, { useEffect, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { Navigate, useNavigate, useParams } from 'react-router-dom';

import { db } from '../../services/firebase';
import { resolvePublicProfilePath } from '../../utils/publicProfilePaths';
import { isReaderPublicProfileEffective } from '../../utils/readerPublicProfile';
import { buildPublicProfileFromUsuarioRow, isCreatorPublicProfile } from '../../utils/publicUserProfile';
import './ReaderPublicProfile.css';

/**
 * Rota legada `/leitor/:uid` — redireciona para o perfil unificado `/criador/:uid?tab=likes`
 * quando o perfil de leitor está público (mesma página com abas Obras / Curtidas / Comentários).
 */
export default function ReaderPublicProfilePage() {
  const { readerUid } = useParams();
  const navigate = useNavigate();
  const uid = String(readerUid || '').trim();
  const [profileState, setProfileState] = useState({ uid: '', pub: null, ready: false });

  useEffect(() => {
    if (!uid) return () => {};
    const unsub = onValue(
      ref(db, `usuarios/${uid}/publicProfile`),
      (snap) => {
        setProfileState({
          uid,
          pub: snap.exists() ? buildPublicProfileFromUsuarioRow(snap.val() || {}, uid) : null,
          ready: true,
        });
      },
      () => {
        setProfileState({ uid, pub: null, ready: true });
      }
    );
    return () => unsub();
  }, [uid]);
  const pub = profileState.uid === uid ? profileState.pub : null;
  const ready = uid ? profileState.uid === uid && profileState.ready === true : true;

  if (!uid) {
    return (
      <main className="reader-public-page">
        <section className="reader-public-empty">
          <h1>Perfil não encontrado</h1>
          <p>Link inválido.</p>
        </section>
      </main>
    );
  }

  if (!ready) {
    return <div className="shito-app-splash" aria-hidden="true" />;
  }

  const isPublic = isReaderPublicProfileEffective(pub);
  if (!isPublic) {
    return (
      <main className="reader-public-page">
        <section className="reader-public-empty">
          <h1>Perfil privado</h1>
          <p>Este leitor optou por não exibir o perfil publicamente.</p>
          <button type="button" className="reader-public-back" onClick={() => navigate('/works')}>
            Voltar ao catálogo
          </button>
        </section>
      </main>
    );
  }

  const tab = isCreatorPublicProfile(pub) ? 'works' : 'likes';
  return <Navigate to={resolvePublicProfilePath(pub, uid, { tab })} replace />;
}
