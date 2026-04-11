import { useEffect, useMemo, useRef, useState } from 'react';
import { equalTo, get, onValue, orderByChild, query, ref } from 'firebase/database';
import { getDownloadURL, ref as storageRef } from 'firebase/storage';

import { toRecordList } from '../../../utils/firebaseRecordList';
import { obraCreatorId } from '../../../config/obras';
import { obraVisivelNoCatalogoPublico } from '../../../utils/obraCatalogo';
import { buildPublicProfileFromUsuarioRow } from '../../../utils/publicUserProfile';
import { normalizeUsernameInput } from '../../../utils/usernameValidation';
import {
  isLegacyDefaultCoverUrl,
  resolveWorkKey,
  resolveWorkKeyFromCap,
} from '../creatorPublicProfileUtils';

export function useCreatorPublicProfileData({ db, storage, creatorLookup }) {
  const [perfilPublico, setPerfilPublico] = useState(null);
  const [obras, setObras] = useState([]);
  const [capitulos, setCapitulos] = useState([]);
  const [publicoReady, setPublicoReady] = useState(false);
  const [obrasReady, setObrasReady] = useState(false);
  const [capitulosReady, setCapitulosReady] = useState(false);
  const [creatorStatsRow, setCreatorStatsRow] = useState({});
  const [favoritesMap, setFavoritesMap] = useState({});
  const [favoritesReady, setFavoritesReady] = useState(false);
  const [workCoverOverrides, setWorkCoverOverrides] = useState({});
  const [chapterCoverOverrides, setChapterCoverOverrides] = useState({});
  const [resolvedCreatorUid, setResolvedCreatorUid] = useState('');
  const [creatorIdentityReady, setCreatorIdentityReady] = useState(false);

  useEffect(() => {
    let alive = true;
    const raw = String(creatorLookup || '').trim();
    if (!raw) {
      setResolvedCreatorUid('');
      setCreatorIdentityReady(true);
      return () => {};
    }

    setCreatorIdentityReady(false);
    const normalizedHandle = normalizeUsernameInput(raw.replace(/^@/, ''));

    (async () => {
      try {
        const directSnapshot = await get(ref(db, `usuarios/${raw}/publicProfile`));
        if (!alive) return;
        if (directSnapshot.exists()) {
          setResolvedCreatorUid(raw);
          setCreatorIdentityReady(true);
          return;
        }

        if (!normalizedHandle) {
          setResolvedCreatorUid('');
          setCreatorIdentityReady(true);
          return;
        }

        const handleSnapshot = await get(ref(db, `usernames/${normalizedHandle}`));
        if (!alive) return;
        setResolvedCreatorUid(handleSnapshot.exists() ? String(handleSnapshot.val() || '').trim() : '');
        setCreatorIdentityReady(true);
      } catch {
        if (!alive) return;
        setResolvedCreatorUid('');
        setCreatorIdentityReady(true);
      }
    })();

    return () => {
      alive = false;
    };
  }, [creatorLookup, db]);

  useEffect(() => {
    if (!resolvedCreatorUid) return () => {};
    setPublicoReady(false);
    const unsub = onValue(
      ref(db, `usuarios/${resolvedCreatorUid}/publicProfile`),
      (snapshot) => {
        setPerfilPublico(
          snapshot.exists() ? buildPublicProfileFromUsuarioRow(snapshot.val() || {}, resolvedCreatorUid) : null
        );
        setPublicoReady(true);
      },
      () => {
        setPerfilPublico(null);
        setPublicoReady(true);
      }
    );
    return () => unsub();
  }, [db, resolvedCreatorUid]);

  useEffect(() => {
    if (!resolvedCreatorUid) return () => {};
    const unsub = onValue(
      ref(db, `creators/${resolvedCreatorUid}/stats`),
      (snapshot) => {
        setCreatorStatsRow(snapshot.exists() ? snapshot.val() || {} : {});
      },
      () => {
        setCreatorStatsRow({});
      }
    );
    return () => unsub();
  }, [db, resolvedCreatorUid]);

  useEffect(() => {
    if (!resolvedCreatorUid) return () => {};
    setObrasReady(false);
    const unsub = onValue(
      query(ref(db, 'obras'), orderByChild('creatorId'), equalTo(resolvedCreatorUid)),
      (snapshot) => {
        const lista = snapshot.exists() ? toRecordList(snapshot.val()) : [];
        setObras(
          lista
            .filter((obra) => obraVisivelNoCatalogoPublico(obra) && obraCreatorId(obra) === resolvedCreatorUid)
            .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
        );
        setObrasReady(true);
      },
      () => {
        setObras([]);
        setObrasReady(true);
      }
    );
    return () => unsub();
  }, [db, resolvedCreatorUid]);

  useEffect(() => {
    if (!resolvedCreatorUid) return () => {};
    setCapitulosReady(false);
    const unsub = onValue(query(ref(db, 'capitulos'), orderByChild('creatorId'), equalTo(resolvedCreatorUid)), (snapshot) => {
      setCapitulos(snapshot.exists() ? toRecordList(snapshot.val()) : []);
      setCapitulosReady(true);
    });
    return () => unsub();
  }, [db, resolvedCreatorUid]);

  useEffect(() => {
    if (!resolvedCreatorUid) return () => {};
    setFavoritesReady(false);
    const unsub = onValue(
      ref(db, `usuarios/${resolvedCreatorUid}/favorites`),
      (snapshot) => {
        setFavoritesMap(snapshot.exists() ? snapshot.val() || {} : {});
        setFavoritesReady(true);
      },
      () => {
        setFavoritesMap({});
        setFavoritesReady(true);
      }
    );
    return () => unsub();
  }, [db, resolvedCreatorUid]);

  useEffect(() => {
    if (!obras.length) return () => {};
    let ativo = true;
    const pendentes = obras.filter((obra) => {
      const id = resolveWorkKey(obra);
      if (!id) return false;
      if (workCoverOverrides[id]) return false;
      const cover = String(obra?.capaUrl || obra?.coverUrl || '').trim();
      const banner = String(obra?.bannerUrl || '').trim();
      if (cover && !isLegacyDefaultCoverUrl(cover)) return false;
      if (banner && !isLegacyDefaultCoverUrl(banner)) return false;
      const path = String(obra?.capaStoragePath || obra?.bannerStoragePath || '').trim();
      return Boolean(path);
    });
    if (!pendentes.length) return () => {};
    Promise.allSettled(
      pendentes.map(async (obra) => {
        const id = resolveWorkKey(obra);
        const path = String(obra?.capaStoragePath || obra?.bannerStoragePath || '').trim();
        if (!id || !path) return null;
        const url = await getDownloadURL(storageRef(storage, path));
        return [id, url];
      })
    ).then((resultados) => {
      if (!ativo) return;
      setWorkCoverOverrides((prev) => {
        const next = { ...prev };
        resultados.forEach((res) => {
          if (res.status !== 'fulfilled' || !res.value) return;
          const [id, url] = res.value;
          if (!id || !url) return;
          next[id] = url;
        });
        return next;
      });
    });
    return () => {
      ativo = false;
    };
  }, [obras, storage, workCoverOverrides]);

  useEffect(() => {
    if (!capitulos.length) return () => {};
    let ativo = true;
    const pendentes = capitulos.filter((cap) => {
      const workId = resolveWorkKeyFromCap(cap);
      if (!workId) return false;
      if (chapterCoverOverrides[workId]) return false;
      const cover = String(cap?.capaUrl || cap?.coverUrl || '').trim();
      if (cover && !isLegacyDefaultCoverUrl(cover)) return false;
      const path = String(cap?.capaStoragePath || '').trim();
      return Boolean(path);
    });
    if (!pendentes.length) return () => {};
    Promise.allSettled(
      pendentes.map(async (cap) => {
        const workId = resolveWorkKeyFromCap(cap);
        const path = String(cap?.capaStoragePath || '').trim();
        if (!workId || !path) return null;
        const url = await getDownloadURL(storageRef(storage, path));
        return [workId, url];
      })
    ).then((resultados) => {
      if (!ativo) return;
      setChapterCoverOverrides((prev) => {
        const next = { ...prev };
        resultados.forEach((res) => {
          if (res.status !== 'fulfilled' || !res.value) return;
          const [id, url] = res.value;
          if (!id || !url) return;
          next[id] = url;
        });
        return next;
      });
    });
    return () => {
      ativo = false;
    };
  }, [capitulos, chapterCoverOverrides, storage]);

  const creatorUid = useMemo(() => String(resolvedCreatorUid || '').trim(), [resolvedCreatorUid]);

  return {
    perfilPublico,
    obras,
    capitulos,
    publicoReady,
    obrasReady,
    capitulosReady,
    creatorStatsRow,
    setCreatorStatsRow,
    setPerfilPublico,
    favoritesMap,
    favoritesReady,
    workCoverOverrides,
    chapterCoverOverrides,
    creatorUid,
    creatorIdentityReady,
  };
}
