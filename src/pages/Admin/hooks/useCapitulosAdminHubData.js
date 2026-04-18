import { useEffect, useMemo, useState } from 'react';
import { equalTo, get, onValue, orderByChild, query, ref as dbRef } from 'firebase/database';

import { obraCreatorId } from '../../../config/obras';
import { buildPublicProfileFromUsuarioRow } from '../../../utils/publicUserProfile';
import { normalizeUsernameInput } from '../../../utils/usernameValidation';

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
  const [obraQuery, setObraQuery] = useState('');
  const [creatorLookupByUid, setCreatorLookupByUid] = useState({});
  const loading = canAccessWorkspace && !obrasLoaded;

  useEffect(() => {
    if (!canAccessWorkspace || isCreatorWorkspace) return () => {};

    let cancelled = false;
    Promise.all([
      get(dbRef(db, 'usernames')),
      get(dbRef(db, 'usuarios')),
    ])
      .then(([usernamesSnap, usuariosSnap]) => {
        if (cancelled) return;
        const usernames = usernamesSnap.exists() ? usernamesSnap.val() || {} : {};
        const usuarios = usuariosSnap.exists() ? usuariosSnap.val() || {} : {};
        const byUid = {};

        Object.entries(usernames || {}).forEach(([handleKey, uidValue]) => {
          const uid = String(uidValue || '').trim();
          if (!uid) return;
          const perfil = buildPublicProfileFromUsuarioRow(usuarios?.[uid] || {}, uid);
          const handle = normalizeUsernameInput(handleKey || perfil?.userHandle || '');
          const displayName = String(
            perfil?.creatorDisplayName ||
              perfil?.userName ||
              (handle ? '@' + handle : uid)
          ).trim();
          byUid[uid] = {
            uid,
            handle,
            displayName,
          };
        });

        Object.keys(usuarios || {}).forEach((uid) => {
          const normalizedUid = String(uid || '').trim();
          if (!normalizedUid || byUid[normalizedUid]) return;
          const perfil = buildPublicProfileFromUsuarioRow(usuarios?.[normalizedUid] || {}, normalizedUid);
          const handle = normalizeUsernameInput(perfil?.userHandle || '');
          const displayName = String(
            perfil?.creatorDisplayName ||
              perfil?.userName ||
              (handle ? '@' + handle : normalizedUid)
          ).trim();
          byUid[normalizedUid] = {
            uid: normalizedUid,
            handle,
            displayName,
          };
        });

        setCreatorLookupByUid(byUid);
      })
      .catch(() => {
        if (cancelled) return;
        setCreatorLookupByUid({});
      });

    return () => {
      cancelled = true;
    };
  }, [canAccessWorkspace, db, isCreatorWorkspace]);

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

  const obrasComLookup = useMemo(
    () =>
      obras.map((obra) => {
        const creatorId = String(obraCreatorId(obra) || '').trim();
        const creatorEntry = creatorLookupByUid[creatorId] || null;
        return {
          ...obra,
          creatorId,
          creatorHandle: creatorEntry?.handle || '',
          creatorDisplayName: creatorEntry?.displayName || '',
        };
      }),
    [creatorLookupByUid, obras]
  );

  const filteredObras = useMemo(() => {
    if (!obraQuery.trim() || isCreatorWorkspace) return obrasComLookup;
    const raw = String(obraQuery || '').trim().toLowerCase();
    const compact = normalizeUsernameInput(obraQuery);
    return obrasComLookup.filter((obra) => {
      const titulo = String(obra.titulo || '').toLowerCase();
      const tituloCurto = String(obra.tituloCurto || '').toLowerCase();
      const slug = String(obra.slug || obra.id || '').toLowerCase();
      const creatorId = String(obra.creatorId || '').toLowerCase();
      const creatorHandle = String(obra.creatorHandle || '').toLowerCase();
      const creatorDisplayName = String(obra.creatorDisplayName || '').toLowerCase();
      return (
        titulo.includes(raw) ||
        tituloCurto.includes(raw) ||
        slug.includes(raw) ||
        creatorId === raw ||
        (compact && creatorHandle.includes(compact)) ||
        creatorDisplayName.includes(raw)
      );
    });
  }, [isCreatorWorkspace, obraQuery, obrasComLookup]);

  const resolvedObraId = useMemo(() => {
    if (filteredObras.some((obra) => obra.id === obraId)) return obraId;
    return filteredObras[0]?.id || '';
  }, [filteredObras, obraId]);

  const obraAtual = useMemo(
    () => filteredObras.find((obra) => obra.id === resolvedObraId) || obrasComLookup.find((obra) => obra.id === resolvedObraId) || null,
    [filteredObras, resolvedObraId, obrasComLookup]
  );

  const capitulosObra = useMemo(() => {
    if (!canAccessWorkspace || !resolvedObraId) return [];
    const filtrados = allCapitulos.filter((cap) => capituloDaObra(cap, resolvedObraId));
    return [...filtrados].sort((a, b) => Number(b.numero || 0) - Number(a.numero || 0));
  }, [allCapitulos, canAccessWorkspace, resolvedObraId]);

  const capsSemWorkId = useMemo(
    () => capitulosObra.filter((cap) => !String(cap.workId || '').trim()).length,
    [capitulosObra]
  );

  return {
    loading,
    obras: filteredObras,
    obrasTotal: obrasComLookup.length,
    obraId: resolvedObraId,
    setObraId,
    obraQuery,
    setObraQuery,
    obraAtual,
    capitulosObra,
    capsSemWorkId,
  };
}
