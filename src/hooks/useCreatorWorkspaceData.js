import { useEffect, useMemo, useRef, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { httpsCallable } from 'firebase/functions';

import { db, functions } from '../services/firebase';
import {
  buildCreatorProgressViewModel,
  metricsFromUsuarioRow,
} from '../utils/creatorProgression';
import { buildEngagementCycleViewModel } from '../utils/creatorEngagementCycle';

const commitCreatorEngagementCycleTick = httpsCallable(functions, 'commitCreatorEngagementCycleTick');

/**
 * Shared creator workspace data. The server is authoritative for engagement
 * cycle transitions; the client only renders the latest snapshot.
 */
export function useCreatorWorkspaceData(user, perfil) {
  const [usuarioLive, setUsuarioLive] = useState(null);
  const [creatorStatsLive, setCreatorStatsLive] = useState(null);
  const lastVisitCommitRef = useRef('');

  useEffect(() => {
    if (!user?.uid) return () => {};
    const unsubMe = onValue(ref(db, `usuarios/${user.uid}`), (snap) => {
      setUsuarioLive(snap.exists() ? snap.val() : null);
    });
    const unsubCreatorStats = onValue(ref(db, `creators/${user.uid}/stats`), (snap) => {
      setCreatorStatsLive(snap.exists() ? snap.val() : null);
    });
    return () => {
      unsubMe();
      unsubCreatorStats();
    };
  }, [user?.uid]);

  const dashMetrics = useMemo(() => {
    const baseRow = usuarioLive && typeof usuarioLive === 'object' ? usuarioLive : perfil;
    return metricsFromUsuarioRow({
      ...(baseRow || {}),
      creatorsStats: creatorStatsLive || baseRow?.creatorsStats || null,
    });
  }, [usuarioLive, perfil, creatorStatsLive]);

  const creatorProgressVm = useMemo(
    () => buildCreatorProgressViewModel(dashMetrics),
    [dashMetrics]
  );

  const cycleVm = useMemo(
    () => buildEngagementCycleViewModel(usuarioLive?.engagementCycle, dashMetrics),
    [usuarioLive?.engagementCycle, dashMetrics]
  );

  useEffect(() => {
    if (!user?.uid) return undefined;
    const date = new Date();
    const visitKey = `${user.uid}:${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    if (lastVisitCommitRef.current === visitKey) return undefined;
    lastVisitCommitRef.current = visitKey;
    commitCreatorEngagementCycleTick().catch(() => {});
    return undefined;
  }, [user?.uid]);

  return {
    usuarioLive,
    creatorStatsLive,
    dashMetrics,
    creatorProgressVm,
    creatorLevelDash: creatorProgressVm.level,
    cycleVm,
  };
}

/**
 * Detects the first transition into level 2 so the UI can celebrate once.
 */
export function useCreatorLevel2Celebration(user, creatorLevelDash) {
  const [celebrationOpen, setCelebrationOpen] = useState(false);
  const prevLevelRef = useRef(null);

  useEffect(() => {
    if (!user?.uid) return;
    const key = `mtf_l2_celebration_done_${user.uid}`;
    if (typeof localStorage !== 'undefined' && localStorage.getItem(key)) return;
    const prev = prevLevelRef.current;
    if (prev !== null && prev < 2 && creatorLevelDash >= 2) {
      queueMicrotask(() => setCelebrationOpen(true));
    }
    prevLevelRef.current = creatorLevelDash;
  }, [user?.uid, creatorLevelDash]);

  const closeCelebration = () => {
    setCelebrationOpen(false);
    if (user?.uid && typeof localStorage !== 'undefined') {
      localStorage.setItem(`mtf_l2_celebration_done_${user.uid}`, '1');
    }
  };

  return { celebrationOpen, closeCelebration };
}
