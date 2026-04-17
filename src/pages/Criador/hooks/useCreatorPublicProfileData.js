import { useEffect, useMemo, useState } from 'react';
import { equalTo, get, onValue, orderByChild, query, ref } from 'firebase/database';
import { getDownloadURL, ref as storageRef } from 'firebase/storage';

import { toRecordList } from '../../../utils/firebaseRecordList';
import { obraCreatorId } from '../../../config/obras';
import { obraVisivelNoCatalogoPublico } from '../../../utils/obraCatalogo';
import { buildPublicProfileFromUsuarioRow } from '../../../utils/publicUserProfile';
import { normalizeUsernameInput } from '../../../utils/usernameValidation';
import {
  isDefaultCreatorWorkCoverUrl,
  resolveWorkKey,
  resolveWorkKeyFromCap,
} from '../creatorPublicProfileUtils';

export function useCreatorPublicProfileData({ db, storage, creatorLookup }) {
  const rawCreatorLookup = String(creatorLookup || '').trim();
  const [creatorLookupState, setCreatorLookupState] = useState({
    source: rawCreatorLookup,
    resolvedUid: '',
    ready: rawCreatorLookup === '',
  });
  const [publicProfileState, setPublicProfileState] = useState({ ownerUid: '', value: null, ready: false });
  const [worksState, setWorksState] = useState({ ownerUid: '', items: [], ready: false });
  const [chaptersState, setChaptersState] = useState({ ownerUid: '', items: [], ready: false });
  const [favoritesState, setFavoritesState] = useState({ ownerUid: '', map: {}, ready: false });
  const [creatorStatsRow, setCreatorStatsRow] = useState({});
  const [workCoverOverrides, setWorkCoverOverrides] = useState({});
  const [chapterCoverOverrides, setChapterCoverOverrides] = useState({});

  useEffect(() => {
    let alive = true;
    if (!rawCreatorLookup) return () => {};

    const normalizedHandle = normalizeUsernameInput(rawCreatorLookup.replace(/^@/, ''));

    (async () => {
      try {
        const directSnapshot = await get(ref(db, `usuarios/${rawCreatorLookup}/publicProfile`));
        if (!alive) return;
        if (directSnapshot.exists()) {
          setCreatorLookupState({ source: rawCreatorLookup, resolvedUid: rawCreatorLookup, ready: true });
          return;
        }

        if (!normalizedHandle) {
          setCreatorLookupState({ source: rawCreatorLookup, resolvedUid: '', ready: true });
          return;
        }

        const handleSnapshot = await get(ref(db, `usernames/${normalizedHandle}`));
        if (!alive) return;
        setCreatorLookupState({
          source: rawCreatorLookup,
          resolvedUid: handleSnapshot.exists() ? String(handleSnapshot.val() || '').trim() : '',
          ready: true,
        });
      } catch {
        if (!alive) return;
        setCreatorLookupState({ source: rawCreatorLookup, resolvedUid: '', ready: true });
      }
    })();

    return () => {
      alive = false;
    };
  }, [rawCreatorLookup, db]);

  const creatorUid = useMemo(
    () => (creatorLookupState.source === rawCreatorLookup ? String(creatorLookupState.resolvedUid || '').trim() : ''),
    [creatorLookupState, rawCreatorLookup]
  );
  const creatorIdentityReady = rawCreatorLookup === '' ? true : creatorLookupState.ready === true;

  useEffect(() => {
    if (!creatorUid) return () => {};
    const unsub = onValue(
      ref(db, `usuarios/${creatorUid}/publicProfile`),
      (snapshot) => {
        setPublicProfileState({
          ownerUid: creatorUid,
          value: snapshot.exists() ? buildPublicProfileFromUsuarioRow(snapshot.val() || {}, creatorUid) : null,
          ready: true,
        });
      },
      () => {
        setPublicProfileState({ ownerUid: creatorUid, value: null, ready: true });
      }
    );
    return () => unsub();
  }, [creatorUid, db]);

  useEffect(() => {
    if (!creatorUid) return () => {};
    const unsub = onValue(
      ref(db, `creators/${creatorUid}/stats`),
      (snapshot) => {
        setCreatorStatsRow(snapshot.exists() ? snapshot.val() || {} : {});
      },
      () => {
        setCreatorStatsRow({});
      }
    );
    return () => unsub();
  }, [creatorUid, db]);

  useEffect(() => {
    if (!creatorUid) return () => {};
    const unsub = onValue(
      query(ref(db, 'obras'), orderByChild('creatorId'), equalTo(creatorUid)),
      (snapshot) => {
        const lista = snapshot.exists() ? toRecordList(snapshot.val()) : [];
        setWorksState({
          ownerUid: creatorUid,
          items: lista
            .filter((obra) => obraVisivelNoCatalogoPublico(obra) && obraCreatorId(obra) === creatorUid)
            .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0)),
          ready: true,
        });
      },
      () => {
        setWorksState({ ownerUid: creatorUid, items: [], ready: true });
      }
    );
    return () => unsub();
  }, [creatorUid, db]);

  useEffect(() => {
    if (!creatorUid) return () => {};
    const unsub = onValue(
      query(ref(db, 'capitulos'), orderByChild('creatorId'), equalTo(creatorUid)),
      (snapshot) => {
        setChaptersState({
          ownerUid: creatorUid,
          items: snapshot.exists() ? toRecordList(snapshot.val()) : [],
          ready: true,
        });
      },
      () => {
        setChaptersState({ ownerUid: creatorUid, items: [], ready: true });
      }
    );
    return () => unsub();
  }, [creatorUid, db]);

  useEffect(() => {
    if (!creatorUid) return () => {};
    const unsub = onValue(
      ref(db, `usuarios/${creatorUid}/favorites`),
      (snapshot) => {
        setFavoritesState({
          ownerUid: creatorUid,
          map: snapshot.exists() ? snapshot.val() || {} : {},
          ready: true,
        });
      },
      () => {
        setFavoritesState({ ownerUid: creatorUid, map: {}, ready: true });
      }
    );
    return () => unsub();
  }, [creatorUid, db]);

  const perfilPublico =
    creatorUid && publicProfileState.ownerUid === creatorUid ? publicProfileState.value : null;
  const publicoReady =
    !creatorUid ? creatorIdentityReady : publicProfileState.ownerUid === creatorUid && publicProfileState.ready === true;
  const obras = useMemo(
    () => (creatorUid && worksState.ownerUid === creatorUid ? worksState.items : []),
    [creatorUid, worksState]
  );
  const obrasReady =
    !creatorUid ? creatorIdentityReady : worksState.ownerUid === creatorUid && worksState.ready === true;
  const capitulos = useMemo(
    () => (creatorUid && chaptersState.ownerUid === creatorUid ? chaptersState.items : []),
    [chaptersState, creatorUid]
  );
  const capitulosReady =
    !creatorUid ? creatorIdentityReady : chaptersState.ownerUid === creatorUid && chaptersState.ready === true;
  const favoritesMap = creatorUid && favoritesState.ownerUid === creatorUid ? favoritesState.map : {};
  const favoritesReady =
    !creatorUid ? creatorIdentityReady : favoritesState.ownerUid === creatorUid && favoritesState.ready === true;

  useEffect(() => {
    if (!obras.length) return () => {};
    let ativo = true;
    const pendentes = obras.filter((obra) => {
      const id = resolveWorkKey(obra);
      if (!id) return false;
      if (workCoverOverrides[id]) return false;
      const cover = String(obra?.capaUrl || obra?.coverUrl || '').trim();
      const banner = String(obra?.bannerUrl || '').trim();
      if (cover && !isDefaultCreatorWorkCoverUrl(cover)) return false;
      if (banner && !isDefaultCreatorWorkCoverUrl(banner)) return false;
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
      if (cover && !isDefaultCreatorWorkCoverUrl(cover)) return false;
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

  return {
    perfilPublico,
    obras,
    capitulos,
    publicoReady,
    obrasReady,
    capitulosReady,
    creatorStatsRow,
    setCreatorStatsRow,
    setPerfilPublico: (nextValue) => {
      setPublicProfileState((current) => ({
        ownerUid: creatorUid,
        ready: current.ready,
        value: typeof nextValue === 'function' ? nextValue(current.value) : nextValue,
      }));
    },
    favoritesMap,
    favoritesReady,
    workCoverOverrides,
    chapterCoverOverrides,
    creatorUid,
    creatorIdentityReady,
  };
}
