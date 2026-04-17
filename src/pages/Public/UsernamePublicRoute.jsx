import React, { useEffect, useState } from 'react';
import { get, ref } from 'firebase/database';
import { Navigate, useLocation, useParams } from 'react-router-dom';

import LoadingScreen from '../../components/LoadingScreen';
import { db } from '../../services/firebase';
import { resolvePublicProfilePath } from '../../utils/publicProfilePaths';
import { isReaderPublicProfileEffective } from '../../utils/readerPublicProfile';
import {
  buildPublicProfileFromUsuarioRow,
  isCreatorPublicProfile,
} from '../../utils/publicUserProfile';
import { normalizeUsernameInput } from '../../utils/usernameValidation';

/**
 * /@username → perfil público em /criador/:uid
 */
export default function UsernamePublicRoute() {
  const { userHandle: raw } = useParams();
  const location = useLocation();
  const [dest, setDest] = useState(null);
  const norm = normalizeUsernameInput(raw);

  useEffect(() => {
    if (!norm) return undefined;
    let alive = true;
    get(ref(db, `usernames/${norm}`))
      .then(async (snap) => {
        if (!alive) return;
        if (!snap.exists()) setDest('/');
        else {
          const uid = String(snap.val() || '').trim();
          if (!uid) {
            setDest('/');
            return;
          }
          const userSnap = await get(ref(db, `usuarios/${uid}/publicProfile`));
          if (!alive) return;
          const profile = userSnap.exists()
            ? buildPublicProfileFromUsuarioRow(userSnap.val() || {}, uid)
            : { uid };
          const searchParams = new URLSearchParams(location.search || '');
          const currentTab = String(searchParams.get('tab') || '').trim().toLowerCase();
          const defaultTab = isCreatorPublicProfile(profile)
            ? 'works'
            : isReaderPublicProfileEffective(profile)
              ? 'likes'
              : '';
          if (!userSnap.exists()) {
            setDest(`/criador/${encodeURIComponent(uid)}${location.search || ''}`);
            return;
          }
          setDest(resolvePublicProfilePath(profile, uid, { tab: currentTab || defaultTab }));
        }
      })
      .catch(() => {
        if (alive) setDest('/');
      });
    return () => {
      alive = false;
    };
  }, [location.search, norm]);

  if (!norm) return <Navigate to="/" replace />;
  if (dest === null) return <LoadingScreen />;
  return <Navigate to={dest} replace />;
}
