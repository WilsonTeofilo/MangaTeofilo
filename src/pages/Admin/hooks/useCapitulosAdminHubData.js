import { useEffect, useMemo, useState } from 'react';
import { equalTo, get, onValue, orderByChild, query, ref as dbRef } from 'firebase/database';

import { obraCreatorId, resolveObraAuthorState } from '../../../config/obras';
import { normalizeUsernameInput } from '../../../utils/usernameValidation';
import {
  buildAdminCreatorDirectory,
  findAdminCreatorLookupMatches,
} from '../../../utils/adminCreatorDirectory';

function toSortedObras(raw) {
  return Object.entries(raw || {})
    .map(([id, data]) => ({ id, ...(data || {}) }))
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
}

function toRecordList(raw) {
  return Object.entries(raw || {}).map(([id, data]) => ({ id, ...(data || {}) }));
}

function capituloDaObra(cap, obraId) {
  const alvo = String(obraId || '').trim().toLowerCase();
  if (!alvo) return true;
  const workId = String(cap?.workId || '').trim().toLowerCase();
  const obraRef = String(cap?.obraId || '').trim().toLowerCase();
  return (workId && workId === alvo) || (obraRef && obraRef === alvo);
}

function buildChapterRowsByWork(allCapitulos = []) {
  const map = new Map();
  (Array.isArray(allCapitulos) ? allCapitulos : []).forEach((cap) => {
    const workId = String(cap?.workId || cap?.obraId || '').trim().toLowerCase();
    if (!workId) return;
    const current = map.get(workId) || [];
    current.push(cap);
    map.set(workId, current);
  });
  return map;
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
    Promise.allSettled([
      get(dbRef(db, 'usernames')),
      get(dbRef(db, 'usuarios')),
      get(dbRef(db, 'usuarios_publicos')),
      get(dbRef(db, 'creators')),
    ])
      .then(([usernamesResult, usuariosResult, usuariosPublicosResult, creatorsResult]) => {
        if (cancelled) return;
        const usernamesSnap =
          usernamesResult.status === 'fulfilled' ? usernamesResult.value : null;
        const usuariosSnap =
          usuariosResult.status === 'fulfilled' ? usuariosResult.value : null;
        const usuariosPublicosSnap =
          usuariosPublicosResult.status === 'fulfilled' ? usuariosPublicosResult.value : null;
        const creatorsSnap =
          creatorsResult.status === 'fulfilled' ? creatorsResult.value : null;
        const usernames = usernamesSnap?.exists() ? usernamesSnap.val() || {} : {};
        const usuarios = usuariosSnap?.exists() ? usuariosSnap.val() || {} : {};
        const usuariosPublicos = usuariosPublicosSnap?.exists() ? usuariosPublicosSnap.val() || {} : {};
        const creators = creatorsSnap?.exists() ? creatorsSnap.val() || {} : {};
        setCreatorLookupByUid(
          buildAdminCreatorDirectory({
            usernames,
            usuarios,
            usuariosPublicos,
            creators,
          }).byUid
        );
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

    const unsubAdmin = onValue(
      dbRef(db, 'capitulos'),
      (snapshot) => {
        const lista = toRecordList(snapshot.exists() ? snapshot.val() : {});
        setAllCapitulos(lista);
      },
      () => {
        setAllCapitulos([]);
      }
    );

    return () => unsubAdmin();
  }, [canAccessWorkspace, db, isCreatorWorkspace, obraId, userUid]);

  const chapterRowsByWork = useMemo(
    () => buildChapterRowsByWork(allCapitulos),
    [allCapitulos]
  );

  const obrasComLookup = useMemo(
    () =>
      obras.map((obra) => {
        const chapterRows = chapterRowsByWork.get(String(obra?.id || '').trim().toLowerCase()) || [];
        const author = resolveObraAuthorState(obra, {
          creatorLookupByUid,
          chapterRows,
        });
        return {
          ...obra,
          ...author,
        };
      }),
    [chapterRowsByWork, creatorLookupByUid, obras]
  );

  const filteredObras = useMemo(() => {
    if (!obraQuery.trim() || isCreatorWorkspace) return obrasComLookup;
    const raw = String(obraQuery || '').trim().toLowerCase();
    const compact = normalizeUsernameInput(obraQuery);
    return obrasComLookup.filter((obra) => {
      const titulo = String(obra.titulo || '').toLowerCase();
      const tituloCurto = String(obra.tituloCurto || '').toLowerCase();
      const slug = String(obra.slug || obra.id || '').toLowerCase();
      const creatorId = String(obra.authorState === 'linked' ? obra.creatorId || '' : '').toLowerCase();
      const creatorHandle = String(obra.authorState === 'linked' ? obra.creatorHandle || '' : '').toLowerCase();
      const creatorDisplayName = String(obra.authorState === 'linked' ? obra.creatorDisplayName || '' : '').toLowerCase();
      const authorLabel = String(obra.authorLabel || '').toLowerCase();
      return (
        titulo.includes(raw) ||
        tituloCurto.includes(raw) ||
        slug.includes(raw) ||
        creatorId === raw ||
        (compact && creatorHandle.includes(compact)) ||
        creatorDisplayName.includes(raw) ||
        authorLabel.includes(raw)
      );
    });
  }, [isCreatorWorkspace, obraQuery, obrasComLookup]);

  const authorLookupMatches = useMemo(() => {
    if (isCreatorWorkspace) return [];
    const raw = String(obraQuery || '').trim();
    const compact = normalizeUsernameInput(raw);
    if (!compact || compact.length < 2) return [];
    const byUid = Object.values(creatorLookupByUid || {});
    return findAdminCreatorLookupMatches(raw, byUid, 6);
  }, [creatorLookupByUid, isCreatorWorkspace, obraQuery]);

  const resolvedObraId = useMemo(() => {
    if (filteredObras.some((obra) => obra.id === obraId)) return obraId;
    return filteredObras[0]?.id || '';
  }, [filteredObras, obraId]);

  const obraAtual = useMemo(
    () => {
      return (
        filteredObras.find((obra) => obra.id === resolvedObraId) ||
        obrasComLookup.find((obra) => obra.id === resolvedObraId) ||
        null
      );
    },
    [filteredObras, obrasComLookup, resolvedObraId]
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
    authorLookupMatches,
  };
}
