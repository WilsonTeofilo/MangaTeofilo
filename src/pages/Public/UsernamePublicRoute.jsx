import React, { useEffect, useState } from 'react';
import { get, ref } from 'firebase/database';
import { Navigate, useParams } from 'react-router-dom';

import LoadingScreen from '../../components/LoadingScreen';
import { db } from '../../services/firebase';
import { normalizeUsernameInput } from '../../utils/usernameValidation';

/**
 * /@username → perfil público em /criador/:uid
 */
export default function UsernamePublicRoute() {
  const { userHandle: raw } = useParams();
  const [dest, setDest] = useState(null);

  useEffect(() => {
    const norm = normalizeUsernameInput(raw);
    if (!norm) {
      setDest('/');
      return undefined;
    }
    let alive = true;
    get(ref(db, `usernames/${norm}`))
      .then((snap) => {
        if (!alive) return;
        if (!snap.exists()) setDest('/');
        else setDest(`/criador/${snap.val()}`);
      })
      .catch(() => {
        if (alive) setDest('/');
      });
    return () => {
      alive = false;
    };
  }, [raw]);

  if (dest === null) return <LoadingScreen />;
  return <Navigate to={dest} replace />;
}
