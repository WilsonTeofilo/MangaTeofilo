import { useEffect, useMemo, useState } from 'react';
import { equalTo, onValue, orderByChild, query, ref as dbRef } from 'firebase/database';

import { db } from '../../../services/firebase';
import { APP_ROLE } from '../../../auth/appRoles';
import { resolveEffectiveCreatorMonetizationStatusFromDb } from '../../../utils/creatorMonetizationUi';
import {
  buildCreatorProgressViewModel,
  metricsFromUsuarioRow,
} from '../../../utils/creatorProgression';
import { SALE_MODEL, computeStorePromoEligibilityClient } from '../../../utils/printOnDemandPricingV2';

export default function usePodCreatorContext({
  user,
  perfil,
  shellRole,
  isMangakaEffective,
  obrasVal,
  capsVal,
  saleModel,
  linkedWorkId,
}) {
  const [rtObras, setRtObras] = useState(null);
  const [rtCaps, setRtCaps] = useState(null);
  const [followerCount, setFollowerCount] = useState(0);
  const [creatorStatsLive, setCreatorStatsLive] = useState(null);

  useEffect(() => {
    if (!user?.uid || (obrasVal != null && capsVal != null)) return undefined;
    const obrasQuery = query(dbRef(db, 'obras'), orderByChild('creatorId'), equalTo(user.uid));
    const capsQuery = query(dbRef(db, 'capitulos'), orderByChild('creatorId'), equalTo(user.uid));
    const uo = onValue(obrasQuery, (snap) => setRtObras(snap.exists() ? snap.val() : {}));
    const uc = onValue(capsQuery, (snap) => setRtCaps(snap.exists() ? snap.val() : {}));
    return () => {
      uo();
      uc();
    };
  }, [capsVal, obrasVal, user?.uid]);

  useEffect(() => {
    if (!user?.uid) return undefined;
    const statsRef = dbRef(db, `creators/${user.uid}/stats`);
    const unsubscribe = onValue(statsRef, (snap) => {
      setCreatorStatsLive(snap.exists() ? snap.val() : null);
    });
    return () => unsubscribe();
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid || saleModel !== SALE_MODEL.STORE_PROMO) return undefined;
    const followersRef = dbRef(db, `creators/${user.uid}/stats/followersCount`);
    const unsub = onValue(followersRef, (snap) => {
      setFollowerCount(snap.exists() ? Number(snap.val() || 0) : 0);
    });
    return () => unsub();
  }, [user?.uid, saleModel]);

  const effectiveObras = user?.uid ? (obrasVal != null ? obrasVal : rtObras) : null;
  const effectiveCaps = user?.uid ? (capsVal != null ? capsVal : rtCaps) : null;
  const creatorStatsAtual = user?.uid ? creatorStatsLive : null;
  const followerCountAtual = user?.uid && saleModel === SALE_MODEL.STORE_PROMO ? followerCount : 0;

  const isMangakaUser = useMemo(() => {
    if (typeof isMangakaEffective === 'boolean') return isMangakaEffective;
    return shellRole === APP_ROLE.CREATOR;
  }, [isMangakaEffective, shellRole]);

  const creatorMonetizationActive = useMemo(
    () => resolveEffectiveCreatorMonetizationStatusFromDb(perfil) === 'active',
    [perfil]
  );

  const creatorProgressMetrics = useMemo(
    () => metricsFromUsuarioRow(perfil || {}, creatorStatsAtual || null),
    [perfil, creatorStatsAtual]
  );
  const creatorProgressVm = useMemo(
    () => buildCreatorProgressViewModel(creatorProgressMetrics),
    [creatorProgressMetrics]
  );
  const monetizationGaps = creatorProgressVm.monetizationGapRows;

  const platformSaleNeedsMonetization =
    isMangakaUser && (perfil == null || !creatorMonetizationActive);
  const platformSaleLevelHintVisible =
    isMangakaUser && creatorMonetizationActive && !creatorProgressVm.monetizationThresholdReached;
  const platformSaleBlocked = platformSaleNeedsMonetization;

  const myWorks = useMemo(() => {
    if (!user?.uid || !effectiveObras || typeof effectiveObras !== 'object') return [];
    const uid = user.uid;
    return Object.entries(effectiveObras)
      .map(([id, row]) => ({ id, ...(row && typeof row === 'object' ? row : {}) }))
      .filter((w) => String(w.creatorId || '').trim() === uid)
      .sort((a, b) =>
        String(a.title || a.titulo || a.nome || a.name || '').localeCompare(
          String(b.title || b.titulo || b.nome || b.name || ''),
          'pt'
        )
      );
  }, [effectiveObras, user?.uid]);

  const storePromoOrderEligible =
    Boolean(user?.uid) && !creatorMonetizationActive && (isMangakaUser || myWorks.length > 0);

  const selectedObraRow = useMemo(() => {
    if (!linkedWorkId || !effectiveObras || typeof effectiveObras !== 'object') return null;
    const row = effectiveObras[linkedWorkId];
    if (!row || typeof row !== 'object') return null;
    return row;
  }, [linkedWorkId, effectiveObras]);

  const storePromoMetrics = useMemo(
    () =>
      computeStorePromoEligibilityClient({
        obra: selectedObraRow,
        workId: linkedWorkId,
        capsVal: effectiveCaps,
        followersCount: followerCountAtual,
      }),
    [selectedObraRow, linkedWorkId, effectiveCaps, followerCountAtual]
  );

  return {
    creatorStatsLive: creatorStatsAtual,
    effectiveObras,
    effectiveCaps,
    followerCount: followerCountAtual,
    isMangakaUser,
    creatorMonetizationActive,
    creatorProgressVm,
    monetizationGaps,
    platformSaleNeedsMonetization,
    platformSaleLevelHintVisible,
    platformSaleBlocked,
    myWorks,
    storePromoOrderEligible,
    selectedObraRow,
    storePromoMetrics,
  };
}
