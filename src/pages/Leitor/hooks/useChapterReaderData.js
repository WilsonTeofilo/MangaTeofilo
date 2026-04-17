import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { equalTo, get, onValue, orderByChild, query, ref } from 'firebase/database';

import { capituloLiberadoParaUsuario } from '../../../utils/capituloLancamento';
import { getAttribution, parseAttributionFromSearch, persistAttribution } from '../../../utils/trafficAttribution';
import {
  normalizarObraId,
  obterObraIdCapitulo,
  obraCreatorId,
  obraSegmentoUrlPublica,
} from '../../../config/obras';
import { apoiePathParaCriador } from '../../../utils/creatorSupportPaths';
import { resolveEffectiveCreatorMonetizationStatusFromDb } from '../../../utils/creatorMonetizationUi';
import { buildPublicProfileFromUsuarioRow } from '../../../utils/publicUserProfile';
import { toRecordList } from '../../../utils/firebaseRecordList';
import { resolvePublicProfilePath } from '../../../utils/publicProfilePaths';
import { collectCreatorIdsFromWorksAndChapters, subscribePublicProfilesMap } from '../../../utils/publicProfilesRealtime';
import { SITE_DEFAULT_IMAGE, SITE_ORIGIN } from '../../../config/site';
import { mergeCapitulosLists } from '../leitorUtils';
import { resolvePublicCreatorIdentity } from '../../../utils/publicCreatorName';

export function useChapterReaderData({ db, id, searchParams, user, perfil }) {
  const [chapterState, setChapterState] = useState({ chapterId: '', chapter: null, loaded: false });
  const [creatorsMap, setCreatorsMap] = useState({});
  const [workContextState, setWorkContextState] = useState({ chapterId: '', creatorUid: null, obraMeta: null });
  const [supportState, setSupportState] = useState({ creatorUid: '', enabled: false });
  const [capsObraState, setCapsObraState] = useState({ workId: '', items: [] });
  const [subscriptionState, setSubscriptionState] = useState({ workId: '', userUid: '', subscribed: false });
  const leituraAttributionRef = useRef({ source: 'normal', campaignId: null, clickId: null });

  const capitulo = chapterState.chapterId === id ? chapterState.chapter : null;
  const carregando = chapterState.chapterId !== id || chapterState.loaded !== true;
  const currentWorkId = obterObraIdCapitulo(capitulo);
  const creatorUidApoio =
    capitulo && workContextState.chapterId === id ? workContextState.creatorUid || null : null;
  const obraMetaLeitor =
    capitulo && workContextState.chapterId === id ? workContextState.obraMeta || null : null;
  const creatorSupportEnabled =
    creatorUidApoio && supportState.creatorUid === creatorUidApoio ? supportState.enabled === true : false;
  const capsObra = useMemo(
    () => (capsObraState.workId === currentWorkId ? capsObraState.items : []),
    [capsObraState, currentWorkId]
  );
  const isSubscribedCurrentWork =
    currentWorkId &&
    subscriptionState.workId === currentWorkId &&
    subscriptionState.userUid === String(user?.uid || '')
      ? subscriptionState.subscribed === true
      : false;

  const setCapitulo = useCallback(
    (nextValue) => {
      setChapterState((current) => {
        if (current.chapterId !== id) return current;
        const nextChapter =
          typeof nextValue === 'function' ? nextValue(current.chapter) : nextValue;
        return {
          ...current,
          chapter: nextChapter,
        };
      });
    },
    [id]
  );

  useEffect(() => {
    if (!capitulo) return () => {};
    const fromCap = String(capitulo.creatorId || '').trim();
    const obraId = obterObraIdCapitulo(capitulo);
    if (!obraId) return () => {};

    let cancelled = false;
    const applyWorkSnapshot = (data) => {
      if (cancelled) return;
      setWorkContextState({
        chapterId: id,
        obraMeta: { id: obraId, ...data },
        creatorUid: fromCap || obraCreatorId({ ...data, id: obraId }) || null,
      });
    };

    get(ref(db, `obras/${obraId}`))
      .then((snapshot) => applyWorkSnapshot(snapshot.exists() ? snapshot.val() || {} : {}))
      .catch(() => {
        if (!cancelled) {
          setWorkContextState({
            chapterId: id,
            obraMeta: { id: obraId },
            creatorUid: fromCap || obraCreatorId({ id: obraId }) || null,
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [capitulo, db, id]);

  useEffect(() => {
    if (!creatorUidApoio) return () => {};
    const unsub = onValue(ref(db, `usuarios/${creatorUidApoio}/publicProfile`), (snapshot) => {
      const row = snapshot.exists()
        ? buildPublicProfileFromUsuarioRow(snapshot.val() || {}, creatorUidApoio)
        : {};
      const monetizationStatus = resolveEffectiveCreatorMonetizationStatusFromDb(row);
      setSupportState({
        creatorUid: creatorUidApoio,
        enabled: monetizationStatus === 'active',
      });
    });
    return () => unsub();
  }, [creatorUidApoio, db]);

  const creatorIdsForLookup = useMemo(
    () => collectCreatorIdsFromWorksAndChapters(obraMetaLeitor ? [obraMetaLeitor] : [], capsObra),
    [obraMetaLeitor, capsObra]
  );

  useEffect(() => subscribePublicProfilesMap(db, creatorIdsForLookup, setCreatorsMap), [creatorIdsForLookup, db]);

  useEffect(() => {
    const attributionFromUrl = parseAttributionFromSearch(searchParams);
    const fallbackAttribution = getAttribution();
    const resolvedAttribution =
      attributionFromUrl || fallbackAttribution || { source: 'normal', campaignId: null, clickId: null };
    leituraAttributionRef.current = resolvedAttribution;
    if (attributionFromUrl) {
      persistAttribution(attributionFromUrl);
    }

    const unsub = onValue(
      ref(db, `capitulos/${id}`),
      (snapshot) => {
        if (!snapshot.exists()) {
          setChapterState({ chapterId: id, chapter: null, loaded: true });
          return;
        }
        setChapterState({
          chapterId: id,
          chapter: { id, ...(snapshot.val() || {}) },
          loaded: true,
        });
      },
      () => {
        setChapterState({ chapterId: id, chapter: null, loaded: true });
      }
    );

    return () => unsub();
  }, [db, id, searchParams]);

  useEffect(() => {
    if (!currentWorkId) return () => {};
    let workList = [];
    let obraList = [];

    const syncCaps = () => {
      setCapsObraState({
        workId: currentWorkId,
        items: mergeCapitulosLists(workList, obraList),
      });
    };

    const unsubWork = onValue(
      query(ref(db, 'capitulos'), orderByChild('workId'), equalTo(currentWorkId)),
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
      query(ref(db, 'capitulos'), orderByChild('obraId'), equalTo(currentWorkId)),
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
  }, [currentWorkId, db]);

  useEffect(() => {
    if (!user?.uid || !currentWorkId) return () => {};
    const unsub = onValue(ref(db, `usuarios/${user.uid}/subscribedWorks/${currentWorkId}`), (snap) => {
      setSubscriptionState({
        workId: currentWorkId,
        userUid: String(user.uid || ''),
        subscribed: snap.exists(),
      });
    });
    return () => unsub();
  }, [currentWorkId, db, user?.uid]);

  const obraCanonical = useMemo(
    () => ({
      id: currentWorkId || obterObraIdCapitulo(capitulo) || '',
      ...(obraMetaLeitor || {}),
      creatorId: String(obraMetaLeitor?.creatorId || capitulo?.creatorId || creatorUidApoio || '').trim(),
    }),
    [capitulo, creatorUidApoio, currentWorkId, obraMetaLeitor]
  );

  const creatorIdentity = useMemo(
    () => resolvePublicCreatorIdentity(obraCanonical, creatorsMap, capsObra),
    [obraCanonical, creatorsMap, capsObra]
  );

  const authorUid = String(
    creatorIdentity?.creatorId || creatorUidApoio || obraCreatorId(obraMetaLeitor || capitulo || {})
  ).trim();

  const authorPublicPath =
    creatorIdentity?.path || (authorUid ? resolvePublicProfilePath({ uid: authorUid }, authorUid) : '');

  const capsLiberadosLista = useMemo(
    () =>
      capsObra.filter((item) =>
        capituloLiberadoParaUsuario({ ...item, id: item.id }, user, perfil)
      ),
    [capsObra, perfil, user]
  );

  const indiceCapituloAtual = useMemo(
    () => capsLiberadosLista.findIndex((item) => item.id === id),
    [capsLiberadosLista, id]
  );

  const anteriorCapituloId = indiceCapituloAtual > 0 ? capsLiberadosLista[indiceCapituloAtual - 1]?.id || '' : '';
  const proximoCapituloId =
    indiceCapituloAtual >= 0 && indiceCapituloAtual < capsLiberadosLista.length - 1
      ? capsLiberadosLista[indiceCapituloAtual + 1]?.id || ''
      : '';

  const chapterSeo = useMemo(() => {
    if (!capitulo) return null;
    const obraSegmento = obraSegmentoUrlPublica({ id: currentWorkId, ...(obraMetaLeitor || {}) });
    const obraPath = `/work/${encodeURIComponent(obraSegmento || normalizarObraId(currentWorkId || ''))}`;
    const obraTitulo = String(obraMetaLeitor?.titulo || obraMetaLeitor?.tituloCurto || '').trim();
    const chapterTitle = String(capitulo?.titulo || `Capítulo ${capitulo?.numero || ''}`).trim();
    const title = obraTitulo ? `${chapterTitle} | ${obraTitulo} | MangaTeofilo` : `${chapterTitle} | MangaTeofilo`;
    const description = obraTitulo
      ? `Leia ${chapterTitle} de ${obraTitulo} no MangaTeofilo.`
      : `Leia ${chapterTitle} no MangaTeofilo.`;
    const shareImage =
      String(capitulo?.capaUrl || '').trim() ||
      String(obraMetaLeitor?.bannerUrl || '').trim() ||
      String(obraMetaLeitor?.capaUrl || '').trim() ||
      SITE_DEFAULT_IMAGE;
    const canonical = `${SITE_ORIGIN}/ler/${encodeURIComponent(id)}`;
    return {
      title,
      description,
      canonical,
      shareImage,
      imageAlt: chapterTitle,
      imgAltPrefix: chapterTitle,
      obraPath,
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: title,
        description,
        image: [shareImage],
        mainEntityOfPage: canonical,
      },
    };
  }, [capitulo, currentWorkId, id, obraMetaLeitor]);

  const apoieComCriadorPath = useMemo(
    () => apoiePathParaCriador(creatorUidApoio || ''),
    [creatorUidApoio]
  );

  return {
    capitulo,
    setCapitulo,
    carregando,
    creatorUidApoio,
    creatorSupportEnabled,
    obraMetaLeitor,
    capsObra,
    currentWorkId,
    creatorIdentity,
    authorUid,
    authorPublicPath,
    capsLiberadosLista,
    anteriorCapituloId,
    proximoCapituloId,
    chapterSeo,
    leituraAttributionRef,
    isSubscribedCurrentWork,
    apoieComCriadorPath,
  };
}
