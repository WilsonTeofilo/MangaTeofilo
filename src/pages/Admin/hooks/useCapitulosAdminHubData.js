import { useEffect, useMemo, useState } from 'react';
import { equalTo, onValue, orderByChild, query, ref as dbRef } from 'firebase/database';

import { obraCreatorId } from '../../../config/obras';

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

export function useCapitulosAdminHubData({
  db,
  canAccessWorkspace,
  isCreatorWorkspace,
  userUid,
}) {
  const [obrasLoaded, setObrasLoaded] = useState(false);
  const [obras, setObras] = useState([]);
  const [allCapitulos, setAllCapitulos] = useState([]);
  const [obraId, setObraId] = useState('');
  const loading = canAccessWorkspace && !obrasLoaded;

  useEffect(() => {
    if (!canAccessWorkspace) return () => {};

    const unsubObras = onValue(
      dbRef(db, 'obras'),
      (snapshot) => {
        const list = toSortedObras(snapshot.exists() ? snapshot.val() : {});
        const visibleObras =
          isCreatorWorkspace && userUid
            ? list.filter((obra) => obraCreatorId(obra) === userUid)
            : list;

        setObras(visibleObras);
        setObraId((current) => {
          if (visibleObras.some((obra) => obra.id === current)) return current;
          return visibleObras[0]?.id || '';
        });
        setObrasLoaded(true);
      },
      () => {
        setObras([]);
        setObraId('');
        setObrasLoaded(true);
      }
    );

    return () => {
      unsubObras();
    };
  }, [canAccessWorkspace, db, isCreatorWorkspace, userUid]);

  useEffect(() => {
    if (!canAccessWorkspace) return () => {};

    if (isCreatorWorkspace) {
      if (!userUid) return () => {};

      const unsubCreator = onValue(
        query(dbRef(db, 'capitulos'), orderByChild('creatorId'), equalTo(userUid)),
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

    if (!obraId) return () => {};

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
  }, [canAccessWorkspace, db, isCreatorWorkspace, obraId, userUid]);

  const obraAtual = useMemo(
    () => obras.find((obra) => obra.id === obraId) || null,
    [obras, obraId]
  );

  const capitulosObra = useMemo(() => {
    if (!canAccessWorkspace || !obraId) return [];
    const filtrados = allCapitulos.filter((cap) => capituloDaObra(cap, obraId));
    return [...filtrados].sort((a, b) => Number(b.numero || 0) - Number(a.numero || 0));
  }, [allCapitulos, canAccessWorkspace, obraId]);

  const capsSemWorkId = useMemo(
    () => capitulosObra.filter((cap) => !String(cap.workId || '').trim()).length,
    [capitulosObra]
  );

  return {
    loading,
    obras,
    obraId,
    setObraId,
    obraAtual,
    capitulosObra,
    capsSemWorkId,
  };
}
