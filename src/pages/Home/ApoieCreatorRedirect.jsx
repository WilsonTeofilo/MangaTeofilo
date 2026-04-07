import React, { useEffect, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { Navigate, useLocation, useParams } from 'react-router-dom';
import { db } from '../../services/firebase';
import { resolveEffectiveCreatorMonetizationStatusFromDb } from '../../utils/creatorMonetizationUi';
import { buildPublicProfileFromUsuarioRow } from '../../utils/publicUserProfile';

/** Redireciona `/apoie/criador/:creatorId` → `/apoie?creatorId=…` */
export default function ApoieCreatorRedirect() {
  const { creatorId } = useParams();
  const location = useLocation();
  const raw = decodeURIComponent(String(creatorId || '').trim());
  const isValidRaw = Boolean(raw && raw.length >= 10 && raw.length <= 128 && /^[a-zA-Z0-9_-]+$/.test(raw));
  const [canSupport, setCanSupport] = useState(null);

  useEffect(() => {
    if (!isValidRaw) return () => {};
    const unsub = onValue(
      ref(db, `usuarios/${raw}`),
      (snapshot) => {
        const row = snapshot.exists() ? buildPublicProfileFromUsuarioRow(snapshot.val() || {}, raw) : {};
        const monetizationStatus = resolveEffectiveCreatorMonetizationStatusFromDb(row);
        setCanSupport(monetizationStatus === 'active');
      },
      () => setCanSupport(false)
    );
    return () => unsub();
  }, [isValidRaw, raw]);
  if (!isValidRaw) {
    return <Navigate to="/apoie" replace />;
  }
  if (canSupport === null) return <div className="shito-app-splash" aria-hidden="true" />;
  if (!canSupport) return <Navigate to={`/criador/${encodeURIComponent(raw)}`} replace />;
  const next = new URLSearchParams(location.search || '');
  next.set('creatorId', raw);
  return <Navigate to={`/apoie?${next.toString()}`} replace />;
}
