import { useEffect, useMemo, useRef, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { httpsCallable } from 'firebase/functions';

import { db, functions } from '../services/firebase';
import { useCreatorScopedCatalog } from './useCreatorScopedCatalog';
import { computeCreatorLevel, metricsFromUsuarioRow } from '../utils/creatorProgression';
import { buildEngagementCycleViewModel } from '../utils/creatorEngagementCycle';
import { toRecordList } from '../utils/firebaseRecordList';

const commitCreatorEngagementCycleTick = httpsCallable(functions, 'commitCreatorEngagementCycleTick');

/**
 * Dados compartilhados entre Monetização (crescimento), Missões & XP e métricas do criador.
 */
export function useCreatorWorkspaceData(user, perfil) {
  const { obrasVal, capsVal, produtosVal } = useCreatorScopedCatalog(db, user?.uid);
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
    const row = usuarioLive && typeof usuarioLive === 'object' ? usuarioLive : perfil;
    return metricsFromUsuarioRow({
      ...(row || {}),
      creatorsStats: creatorStatsLive || null,
    });
  }, [usuarioLive, perfil, creatorStatsLive]);

  const creatorLevelDash = useMemo(() => computeCreatorLevel(dashMetrics), [dashMetrics]);

  const metrics = useMemo(() => {
    const uid = String(user?.uid || '').trim();
    const obras = toRecordList(obrasVal).filter((obra) => String(obra?.creatorId || '').trim() === uid);
    const obraIds = new Set(obras.map((obra) => String(obra.id || '').trim().toLowerCase()));
    const caps = toRecordList(capsVal).filter((cap) => {
      if (String(cap?.creatorId || '').trim() === uid) return true;
      const obraId = String(cap?.obraId || cap?.mangaId || '').trim().toLowerCase();
      return obraIds.has(obraId);
    });
    const produtos = toRecordList(produtosVal).filter(
      (produto) => String(produto?.creatorId || '').trim() === uid
    );
    return { obras, caps, produtos };
  }, [user?.uid, obrasVal, capsVal, produtosVal]);

  const cycleVm = useMemo(
    () =>
      buildEngagementCycleViewModel(
        usuarioLive?.engagementCycle,
        dashMetrics,
        metrics.caps,
        user?.uid
      ),
    [usuarioLive?.engagementCycle, dashMetrics, metrics.caps, user?.uid]
  );

  useEffect(() => {
    if (!user?.uid) return undefined;
    const d = new Date();
    const visitKey = `${user.uid}:${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (lastVisitCommitRef.current === visitKey) return undefined;
    lastVisitCommitRef.current = visitKey;
    commitCreatorEngagementCycleTick().catch(() => {});
    return undefined;
  }, [user?.uid]);

  return {
    usuarioLive,
    dashMetrics,
    creatorLevelDash,
    metrics,
    cycleVm,
    obrasVal,
    capsVal,
    produtosVal,
  };
}

/**
 * Detecção de transição de nível da plataforma (monetização) para modal de celebração.
 */
export function useCreatorLevel2Celebration(user, creatorLevelDash) {
  const [celebrationOpen, setCelebrationOpen] = useState(false);
  const prevLevelRef = useRef(null);

  useEffect(() => {
    if (!user?.uid) return;
    const k = `mtf_l2_celebration_done_${user.uid}`;
    if (typeof localStorage !== 'undefined' && localStorage.getItem(k)) return;
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
