import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Link, useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { ref, onValue, push, set, get, query, orderByChild, equalTo, runTransaction, serverTimestamp } from 'firebase/database';
import { httpsCallable } from 'firebase/functions';

import { db, functions } from '../../services/firebase';
import { AVATAR_FALLBACK } from '../../constants';
import { capituloLiberadoParaUsuario, formatarDataLancamento } from '../../utils/capituloLancamento';
import { applyChapterCommentDelta, applyChapterReadDelta } from '../../utils/discoveryStats';
import { getLastRead, recordReadingProgress } from '../../utils/readingProgressLocal';
import { getAttribution, parseAttributionFromSearch, persistAttribution } from '../../utils/trafficAttribution';
import {
  buildChapterCampaignId,
  normalizarObraId,
  obterObraIdCapitulo,
  obraCreatorId,
  obraSegmentoUrlPublica,
} from '../../config/obras';
import { apoiePathParaCriador } from '../../utils/creatorSupportPaths';
import { buildLoginUrlWithRedirect } from '../../utils/loginRedirectPath';
import { resolveEffectiveCreatorMonetizationStatusFromDb } from '../../utils/creatorMonetizationUi';
import {
  buildPublicProfileFromUsuarioRow,
  isCreatorPublicProfile,
  resolvePublicProfileAvatarUrl,
} from '../../utils/publicUserProfile';
import { toRecordList } from '../../utils/firebaseRecordList';
import { formatUserDisplayWithHandle, resolvePublicCreatorIdentity } from '../../utils/publicCreatorName';
import { resolvePublicProfilePath } from '../../utils/publicProfilePaths';
import { collectCreatorIdsFromWorksAndChapters, subscribePublicProfilesMap } from '../../utils/publicProfilesRealtime';
import { isReaderPublicProfileEffective } from '../../utils/readerPublicProfile';
import { obterEntitlementPremiumGlobal } from '../../auth/userEntitlements';
import { SITE_DEFAULT_IMAGE, SITE_ORIGIN } from '../../config/site';
import LoadingScreen from '../../components/LoadingScreen';
import BrowserPushPreferenceModal from '../../components/BrowserPushPreferenceModal.jsx';
import ChapterShareBar, { ogImageMimeHint } from '../../components/ChapterShareBar.jsx';
import './Leitor.css';

const registrarAttributionEvento = httpsCallable(functions, 'registrarAttributionEvento');
const upsertNotificationSubscription = httpsCallable(functions, 'upsertNotificationSubscription');
const toggleChapterLikeCallable = httpsCallable(functions, 'toggleChapterLike');

function commentSortTs(c) {
  if (typeof c.data === 'number' && Number.isFinite(c.data)) return c.data;
  return 0;
}

function mergeCapitulosLists(...lists) {
  const map = new Map();
  lists.flat().forEach((item) => {
    const id = String(item?.id || '').trim();
    if (!id) return;
    map.set(id, item);
  });
  return Array.from(map.values()).sort((a, b) => Number(a.numero || 0) - Number(b.numero || 0));
}

/** Perfil público unificado: mesma URL para autor e leitor (abas no `/criador/:uid`). */
function publicCriadorProfilePath(perfilPublico, uid) {
  const u = String(uid || '').trim();
  if (!u || !perfilPublico) return null;
  const readerOk = isReaderPublicProfileEffective(perfilPublico);
  const looksCreator = isCreatorPublicProfile(perfilPublico);
  if (!readerOk && !looksCreator) return null;
  const tab = looksCreator ? 'works' : 'likes';
  return resolvePublicProfilePath(perfilPublico, u, { tab });
}

function buildCommentThreads(flat, filtro) {
  const map = new Map(flat.map((c) => [c.id, { ...c, replies: [] }]));
  const roots = [];
  for (const c of flat) {
    const node = map.get(c.id);
    const pid = c.parentId ? String(c.parentId).trim() : '';
    if (pid && map.has(pid)) {
      map.get(pid).replies.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortRoots = (a, b) =>
    filtro === 'relevantes'
      ? (b.likes || 0) - (a.likes || 0)
      : commentSortTs(b) - commentSortTs(a);
  const sortReplies = (a, b) => commentSortTs(a) - commentSortTs(b);
  roots.sort(sortRoots);
  const walk = (n) => {
    n.replies.sort(sortReplies);
    n.replies.forEach(walk);
  };
  roots.forEach(walk);
  return roots;
}

/** Distintivo nos comentários: apenas para o próprio usuário (entitlement canônico). */
const isContaPremium = (commentUid, currentUser, currentProfile) => {
  if (!currentUser?.uid || !currentProfile) return false;
  if (String(commentUid || '') !== String(currentUser.uid)) return false;
  return obterEntitlementPremiumGlobal(currentProfile).isPremium === true;
};

export default function Leitor({ user, perfil }) {
  const { id }   = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const [capitulo, setCapitulo]            = useState(null);
  const [carregando, setCarregando]        = useState(true);
  const [comentarioTexto, setComentario]   = useState('');
  const [listaComentarios, setComentarios] = useState([]);
  const [perfisUsuarios, setPerfis]        = useState({});
  const [creatorsMap, setCreatorsMap]      = useState({});
  const [filtro, setFiltro]                = useState('relevantes');
  const [enviando, setEnviando]            = useState(false);

  const [modoLeitura, setModoLeitura] = useState(
    () => localStorage.getItem('modoLeitura') || 'vertical'
  );
  const [zoom, setZoom] = useState(
    () => Number(localStorage.getItem('zoom')) || 100
  );
  const [paginaAtual, setPaginaAtual]     = useState(0);
  const [verticalFocusIndex, setVerticalFocusIndex] = useState(0);
  const [mostrarConfig, setMostrarConfig] = useState(false);
  const [modalLoginComentario, setModalLoginComentario] = useState(false);
  const [privateProfileModal, setPrivateProfileModal] = useState(null);
  const [replyingTo, setReplyingTo] = useState(null);
  const [replyDraft, setReplyDraft] = useState('');
  const [replyEnviando, setReplyEnviando] = useState(false);
  const [creatorUidApoio, setCreatorUidApoio] = useState(null);
  const [creatorSupportEnabled, setCreatorSupportEnabled] = useState(false);
  const [isSubscribedCurrentWork, setIsSubscribedCurrentWork] = useState(false);
  const [subscribeCurrentWorkBusy, setSubscribeCurrentWorkBusy] = useState(false);
  const [chapterBrowserPushModalOpen, setChapterBrowserPushModalOpen] = useState(false);
  const [chapterBrowserPushPermission, setChapterBrowserPushPermission] = useState('default');
  const [obraMetaLeitor, setObraMetaLeitor] = useState(null);
  const [capsObra, setCapsObra] = useState([]);
  const [chapterLikeBusy, setChapterLikeBusy] = useState(false);

  const touchStartX          = useRef(0);
  const touchEndX            = useRef(0);
  const unsubPerfis          = useRef({});
  const jaContouVisualizacao = useRef(false);
  const leituraAttributionRef = useRef({ source: 'normal', campaignId: null, clickId: null });
  const capNavErrorTimerRef = useRef(null);
  const profileToastTimerRef = useRef(null);
  const [capNavError, setCapNavError] = useState(false);
  const [profileToast, setProfileToast] = useState('');
  const chapterPageInitRef = useRef('');
  const totalPaginas = capitulo?.paginas?.length || 0;
  const currentWorkId = obterObraIdCapitulo(capitulo);
  const chapterLikesCount = Number(capitulo?.likesCount || 0);
  const chapterLikedByUser = Boolean(user?.uid && capitulo?.usuariosQueCurtiram?.[user.uid]);

  useEffect(() => { localStorage.setItem('modoLeitura', modoLeitura); }, [modoLeitura]);
  useEffect(() => { localStorage.setItem('zoom', zoom); }, [zoom]);

  useEffect(() => {
    if (user) setModalLoginComentario(false);
  }, [user]);

  useEffect(() => {
    if (!privateProfileModal) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setPrivateProfileModal(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [privateProfileModal]);

  useEffect(() => {
    if (!capitulo) {
      setCreatorUidApoio(null);
      setCreatorSupportEnabled(false);
      setObraMetaLeitor(null);
      return () => {};
    }
    const fromCap = String(capitulo.creatorId || '').trim();
    if (fromCap) {
      setCreatorUidApoio(fromCap);
      const oid = obterObraIdCapitulo(capitulo);
      let cancelled = false;
      get(ref(db, `obras/${oid}`))
        .then((snap) => {
          if (cancelled) return;
          const data = snap.exists() ? snap.val() : {};
          setObraMetaLeitor({ id: oid, ...data });
        })
        .catch(() => {
          if (!cancelled) setObraMetaLeitor({ id: oid });
        });
      return () => {
        cancelled = true;
      };
    }
    const oid = obterObraIdCapitulo(capitulo);
    let cancelled = false;
    get(ref(db, `obras/${oid}`))
      .then((snap) => {
        if (cancelled) return;
        const data = snap.exists() ? snap.val() : {};
        setCreatorUidApoio(obraCreatorId({ ...data, id: oid }));
        setObraMetaLeitor({ id: oid, ...data });
      })
      .catch(() => {
        if (!cancelled) {
          setCreatorUidApoio(obraCreatorId({}));
          setObraMetaLeitor({ id: oid });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [capitulo]);

  useEffect(() => {
    if (!creatorUidApoio) {
      setCreatorSupportEnabled(false);
      return () => {};
    }
    const unsub = onValue(ref(db, `usuarios/${creatorUidApoio}/publicProfile`), (snapshot) => {
      const row = snapshot.exists()
        ? buildPublicProfileFromUsuarioRow(snapshot.val() || {}, creatorUidApoio)
        : {};
      const monetizationStatus = resolveEffectiveCreatorMonetizationStatusFromDb(row);
      setCreatorSupportEnabled(monetizationStatus === 'active');
    });
    return () => unsub();
  }, [creatorUidApoio]);

  useEffect(() => {
    if (!modalLoginComentario) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setModalLoginComentario(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modalLoginComentario]);

  const creatorIdsForLookup = useMemo(
    () => collectCreatorIdsFromWorksAndChapters(obraMetaLeitor ? [obraMetaLeitor] : [], capsObra),
    [obraMetaLeitor, capsObra]
  );

  useEffect(() => subscribePublicProfilesMap(db, creatorIdsForLookup, setCreatorsMap), [creatorIdsForLookup]);

  useEffect(() => {
    setCarregando(true);
    setCapitulo(null);
    setComentarios([]);
    setPerfis({});
    setCapsObra([]);
    setPaginaAtual(0);
    setVerticalFocusIndex(0);
    chapterPageInitRef.current = '';
    jaContouVisualizacao.current = false;

    const attributionFromUrl = parseAttributionFromSearch(searchParams);
    const fallbackAttribution = getAttribution();
    const resolvedAttribution = attributionFromUrl || fallbackAttribution || { source: 'normal', campaignId: null, clickId: null };
    leituraAttributionRef.current = resolvedAttribution;
    if (attributionFromUrl) {
      persistAttribution(attributionFromUrl);
    }

    const unsub = onValue(
      ref(db, `capitulos/${id}`),
      (snapshot) => {
        if (!snapshot.exists()) {
          setCapitulo(null);
          setCarregando(false);
          return;
        }
        setCapitulo({ id, ...(snapshot.val() || {}) });
        setCarregando(false);
      },
      () => {
        setCapitulo(null);
        setCarregando(false);
      }
    );

    return () => unsub();
  }, [id, searchParams]);

  useEffect(() => {
    if (!id) return () => {};
    const unsub = onValue(
      ref(db, `capitulos/${id}/comentarios`),
      (snapshot) => {
        const list = toRecordList(snapshot.exists() ? snapshot.val() : {})
          .sort((a, b) => commentSortTs(b) - commentSortTs(a));
        setComentarios(list);
      },
      () => {
        setComentarios([]);
      }
    );
    return () => unsub();
  }, [id]);

  useEffect(() => {
    const targetIds = new Set(
      listaComentarios
        .map((item) => String(item?.userId || '').trim())
        .filter(Boolean)
    );

    for (const [uid, unsub] of Object.entries(unsubPerfis.current)) {
      if (targetIds.has(uid)) continue;
      try {
        unsub();
      } catch {
        /* noop */
      }
      delete unsubPerfis.current[uid];
      setPerfis((prev) => {
        if (!(uid in prev)) return prev;
        const next = { ...prev };
        delete next[uid];
        return next;
      });
    }

    targetIds.forEach((uid) => {
      if (unsubPerfis.current[uid]) return;
      unsubPerfis.current[uid] = onValue(
        ref(db, `usuarios/${uid}/publicProfile`),
        (snapshot) => {
          const perfilPublico = snapshot.exists()
            ? buildPublicProfileFromUsuarioRow(snapshot.val() || {}, uid)
            : { uid, userName: 'Leitor', userAvatar: AVATAR_FALLBACK };
          setPerfis((prev) => ({ ...prev, [uid]: perfilPublico }));
        },
        () => {
          setPerfis((prev) => ({ ...prev, [uid]: { uid, userName: 'Leitor', userAvatar: AVATAR_FALLBACK } }));
        }
      );
    });

    return () => {};
  }, [listaComentarios]);

  useEffect(() => {
    return () => {
      Object.values(unsubPerfis.current).forEach((unsub) => {
        try {
          unsub();
        } catch {
          /* noop */
        }
      });
      unsubPerfis.current = {};
      if (capNavErrorTimerRef.current) clearTimeout(capNavErrorTimerRef.current);
      if (profileToastTimerRef.current) clearTimeout(profileToastTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!currentWorkId) {
      setCapsObra([]);
      return () => {};
    }
    let workList = [];
    let obraList = [];

    const syncCaps = () => {
      setCapsObra(mergeCapitulosLists(workList, obraList));
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
  }, [currentWorkId]);

  const obraCanonical = useMemo(
    () => ({
      id: currentWorkId || obterObraIdCapitulo(capitulo) || '',
      ...(obraMetaLeitor || {}),
      creatorId:
        String(obraMetaLeitor?.creatorId || capitulo?.creatorId || creatorUidApoio || '').trim(),
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
  const capituloParaAcesso = capitulo;
  const capsLiberadosLista = useMemo(
    () =>
      capsObra.filter((item) =>
        capituloLiberadoParaUsuario(
          { ...item, id: item.id },
          user,
          perfil,
          { creatorIdFallback: authorUid || '' }
        )
      ),
    [authorUid, capsObra, perfil, user]
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

  const triggerCapNavError = useCallback(() => {
    if (capNavErrorTimerRef.current) clearTimeout(capNavErrorTimerRef.current);
    setCapNavError(true);
    capNavErrorTimerRef.current = setTimeout(() => setCapNavError(false), 2200);
  }, []);

  const handleCommentProfileOpen = useCallback(
    (perfilPublico, uid) => {
      const publicPath = publicCriadorProfilePath(perfilPublico, uid);
      if (publicPath) {
        navigate(publicPath);
        return;
      }
      setPrivateProfileModal({
        label: formatUserDisplayWithHandle(perfilPublico) || 'Este perfil',
      });
    },
    [navigate]
  );

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

  useEffect(() => {
    if (!capitulo || !currentWorkId) return;
    if (chapterPageInitRef.current === id) return;
    if (location.state?.forceStartAtPageOne === true) {
      setPaginaAtual(0);
      setVerticalFocusIndex(0);
      chapterPageInitRef.current = id;
      return;
    }
    const lastRead = getLastRead();
    if (lastRead?.chapterId === id) {
      const nextPage = Math.max(0, Math.min(totalPaginas - 1, Number(lastRead.page || 1) - 1));
      setPaginaAtual(nextPage);
      setVerticalFocusIndex(nextPage);
      chapterPageInitRef.current = id;
      return;
    }
    setPaginaAtual(0);
    setVerticalFocusIndex(0);
    chapterPageInitRef.current = id;
  }, [capitulo, currentWorkId, id, location.state, totalPaginas]);

  useEffect(() => {
    if (!capitulo || !currentWorkId) return;
    if (chapterPageInitRef.current !== id) return;
    recordReadingProgress({
      workId: currentWorkId,
      chapterId: id,
      chapterNumber: Number(capitulo?.numero || 0),
      page: paginaAtual + 1,
      obraTitulo: String(obraMetaLeitor?.titulo || ''),
      chapterTitle: String(capitulo?.titulo || ''),
      capaUrl: String(capitulo?.capaUrl || obraMetaLeitor?.capaUrl || ''),
    });
  }, [capitulo, currentWorkId, id, obraMetaLeitor, paginaAtual]);

  useEffect(() => {
    if (!capitulo || !currentWorkId) return;
    if (jaContouVisualizacao.current) return;
    if (
      !capituloLiberadoParaUsuario(
        { ...capitulo, id },
        user,
        perfil,
        { creatorIdFallback: authorUid || '' }
      )
    ) {
      return;
    }
    jaContouVisualizacao.current = true;
    applyChapterReadDelta(db, {
      chapterId: id,
      workId: currentWorkId,
      creatorId: authorUid || '',
      viewerUid: String(user?.uid || ''),
      amount: 1,
    }).catch(() => {});
    registrarAttributionEvento({
      eventType: 'chapter_read',
      source: leituraAttributionRef.current?.source || 'normal',
      campaignId:
        leituraAttributionRef.current?.campaignId || buildChapterCampaignId(id, currentWorkId),
      clickId: leituraAttributionRef.current?.clickId || id,
      creatorId: authorUid || null,
      workId: currentWorkId,
      chapterId: id,
    }).catch(() => {});
  }, [authorUid, capitulo, currentWorkId, id, perfil, user]);

  const irProxima = useCallback(
    () => setPaginaAtual((p) => Math.min(p + 1, totalPaginas - 1)),
    [totalPaginas]
  );
  const irAnterior = useCallback(
    () => setPaginaAtual((p) => Math.max(p - 1, 0)),
    []
  );

  const navigateToChapter = useCallback(
    (chapterId, { forceStartAtPageOne = false } = {}) => {
      const nextId = String(chapterId || '').trim();
      if (!nextId || nextId === id) return;
      navigate(`/ler/${nextId}`, {
        state: forceStartAtPageOne ? { forceStartAtPageOne: true } : undefined,
      });
    },
    [id, navigate]
  );

  useEffect(() => {
    if (!user?.uid || !currentWorkId) {
      setIsSubscribedCurrentWork(false);
      return () => {};
    }
    const unsub = onValue(ref(db, `usuarios/${user.uid}/subscribedWorks/${currentWorkId}`), (snap) => {
      setIsSubscribedCurrentWork(snap.exists());
    });
    return () => unsub();
  }, [currentWorkId, user?.uid]);

  useEffect(() => {
    const handleKey = (e) => {
      if (modoLeitura !== 'horizontal') return;
      if (e.key === 'ArrowRight') irProxima();
      if (e.key === 'ArrowLeft')  irAnterior();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [irAnterior, irProxima, modoLeitura]);

  const handleTouchStart = (e) => { touchStartX.current = e.changedTouches[0].screenX; };
  const handleTouchMove  = (e) => { touchEndX.current   = e.changedTouches[0].screenX; };
  const handleTouchEnd   = () => {
    const dist = touchStartX.current - touchEndX.current;
    if (dist >  50) irProxima();
    if (dist < -50) irAnterior();
  };

  const abrirModalComentarioDeslogado = () => {
    if (!user) setModalLoginComentario(true);
  };

  const handleEnviarComentario = async (e) => {
    e.preventDefault();
    if (!user) {
      setModalLoginComentario(true);
      return;
    }
    if (!comentarioTexto.trim()) return;
    if (enviando)                return;

    setEnviando(true);
    const texto = comentarioTexto.trim();
    try {
      await set(push(ref(db, `capitulos/${id}/comentarios`)), {
        texto,
        userId: user.uid,
        data:   serverTimestamp(),
        likes:  0,
      });
      setComentario('');
      await applyChapterCommentDelta(db, {
        chapterId: id,
        workId: obterObraIdCapitulo(capitulo),
        creatorId: creatorUidApoio || obraCreatorId({ creatorId: capitulo?.creatorId || '' }),
        amount: 1,
      });
    } catch (err) {
      console.error('Erro ao comentar:', err);
    } finally {
      setEnviando(false);
    }
  };

  // Qualquer usuário logado pode curtir — sem restrição de status
  const handleLike = async (comentId) => {
    if (!user) {
      navigate(buildLoginUrlWithRedirect(location.pathname, location.search));
      return;
    }
    const tx = await runTransaction(ref(db, `capitulos/${id}/comentarios/${comentId}`), (post) => {
      if (!post) return post;
      if (!post.usuariosQueCurtiram) post.usuariosQueCurtiram = {};
      if (post.usuariosQueCurtiram[user.uid]) {
        post.likes = Math.max(0, (post.likes || 1) - 1);
        delete post.usuariosQueCurtiram[user.uid];
      } else {
        post.likes = (post.likes || 0) + 1;
        post.usuariosQueCurtiram[user.uid] = true;
      }
      return post;
    });
    if (!tx.committed) return;
    // Like de comentário fica só no nó do comentário; não altera likes da obra/capítulo.
  };

  const comentariosEmThreads = useMemo(
    () => buildCommentThreads(listaComentarios, filtro),
    [listaComentarios, filtro]
  );

  const handleEnviarResposta = async (parentId) => {
    if (!user) {
      navigate(buildLoginUrlWithRedirect(location.pathname, location.search));
      return;
    }
    const texto = replyDraft.trim();
    if (!texto || replyEnviando || !parentId) return;
    setReplyEnviando(true);
    try {
      await set(push(ref(db, `capitulos/${id}/comentarios`)), {
        texto,
        userId: user.uid,
        data: serverTimestamp(),
        likes: 0,
        parentId,
      });
      setReplyDraft('');
      setReplyingTo(null);
      await applyChapterCommentDelta(db, {
        chapterId: id,
        workId: obterObraIdCapitulo(capitulo),
        creatorId: creatorUidApoio || obraCreatorId({ creatorId: capitulo?.creatorId || '' }),
        amount: 1,
      });
    } catch (err) {
      console.error('Erro ao responder comentário:', err);
    } finally {
      setReplyEnviando(false);
    }
  };

  const apoieComCriadorPath = useMemo(
    () => apoiePathParaCriador(creatorUidApoio || ''),
    [creatorUidApoio]
  );

  const irParaApoioDoCriador = () => {
    if (!creatorSupportEnabled) return;
    registrarAttributionEvento({
      eventType: 'creator_support_click',
      source: leituraAttributionRef.current?.source || 'normal',
      campaignId: creatorUidApoio ? `creator_${creatorUidApoio}` : null,
      clickId: creatorUidApoio || null,
      chapterId: id,
    }).catch(() => {});
    navigate(apoieComCriadorPath);
  };

  const handleSubscribeCurrentWork = async () => {
    if (!user) {
      navigate(buildLoginUrlWithRedirect(location.pathname, location.search));
      return;
    }
    if (!currentWorkId) return;
    setSubscribeCurrentWorkBusy(true);
    try {
      const nextEnabled = !isSubscribedCurrentWork;
      await upsertNotificationSubscription({
        type: 'work',
        targetId: currentWorkId,
        enabled: nextEnabled,
      });
      if (nextEnabled) {
        const perm =
          typeof window === 'undefined' || typeof Notification === 'undefined'
            ? 'unsupported'
            : Notification.permission;
        setChapterBrowserPushPermission(perm);
        setChapterBrowserPushModalOpen(true);
      }
    } finally {
      setSubscribeCurrentWorkBusy(false);
    }
  };

  const handleChapterLike = async () => {
    if (!user) {
      navigate(buildLoginUrlWithRedirect(location.pathname, location.search));
      return;
    }
    if (!capitulo || chapterLikeBusy) return;
    try {
      setChapterLikeBusy(true);
      const result = await toggleChapterLikeCallable({ chapterId: id });
      const liked = result?.data?.liked === true;
      const likesCount = Number(result?.data?.likesCount || 0);
      setCapitulo((current) => {
        if (!current) return current;
        const currentLikes = current?.usuariosQueCurtiram && typeof current.usuariosQueCurtiram === 'object'
          ? { ...current.usuariosQueCurtiram }
          : {};
        if (liked) currentLikes[user.uid] = true;
        else delete currentLikes[user.uid];
        return {
          ...current,
          likesCount,
          usuariosQueCurtiram: currentLikes,
        };
      });
    } catch (e) {
      console.error('Erro ao curtir capítulo:', e);
      setProfileToast('Não foi possível atualizar o like do capítulo.');
      if (profileToastTimerRef.current) clearTimeout(profileToastTimerRef.current);
      profileToastTimerRef.current = setTimeout(() => setProfileToast(''), 2200);
    } finally {
      setChapterLikeBusy(false);
    }
  };

  if (carregando) return <LoadingScreen />;
  if (!capitulo) {
    return (
      <div className="leitor-container">
        <Helmet prioritizeSeoTags>
          <title>Capítulo não encontrado | MangaTeofilo</title>
          <meta name="robots" content="noindex,follow" />
        </Helmet>
        <div className="leitor-not-found" role="alert">
          Capítulo não encontrado.
        </div>
      </div>
    );
  }

  const capAcesso = { ...(capituloParaAcesso || capitulo), id };
  if (
    !capituloLiberadoParaUsuario(capAcesso, user, perfil, {
      creatorIdFallback: creatorUidApoio || '',
    })
  ) {
    const quando = formatarDataLancamento(capitulo.publicReleaseAt);
    return (
      <div className="leitor-container">
        {chapterSeo ? (
          <Helmet prioritizeSeoTags>
            <title>{chapterSeo.title}</title>
            <meta name="description" content={chapterSeo.description} />
            <meta property="og:type" content="article" />
            <meta property="og:title" content={chapterSeo.title} />
            <meta property="og:description" content={chapterSeo.description} />
            <meta property="og:url" content={chapterSeo.canonical} />
            <meta property="og:image" content={chapterSeo.shareImage} />
            {/^https:\/\//i.test(chapterSeo.shareImage) ? (
              <meta property="og:image:secure_url" content={chapterSeo.shareImage} />
            ) : null}
            <meta property="og:image:type" content={ogImageMimeHint(chapterSeo.shareImage)} />
            <meta property="og:image:alt" content={chapterSeo.imageAlt} />
            <meta name="twitter:card" content="summary_large_image" />
            <meta name="twitter:title" content={chapterSeo.title} />
            <meta name="twitter:description" content={chapterSeo.description} />
            <meta name="twitter:image" content={chapterSeo.shareImage} />
            <meta name="twitter:image:alt" content={chapterSeo.imageAlt} />
            <link rel="canonical" href={chapterSeo.canonical} />
            <meta name="robots" content="noindex,follow" />
          </Helmet>
        ) : null}
        <div className="leitor-lancamento-bloqueado" role="status">
          <h1 className="leitor-lancamento-titulo">{capitulo.titulo || 'Capítulo'}</h1>
          <p className="leitor-lancamento-msg">
            Este fragmento ainda não está liberado para leitura pública.
            {quando ? (
              <>
                {' '}
                Previsão: <strong>{quando}</strong>
              </>
            ) : null}
          </p>
          {capitulo.antecipadoMembros && (
            <p className="leitor-lancamento-hint">
              Quem tem <strong>membership ativa do autor desta obra</strong> pode ler antes do horário público.
            </p>
          )}
          <button
            type="button"
            className="leitor-lancamento-voltar"
            onClick={() => navigate('/works')}
          >
            Voltar à biblioteca
          </button>
          {creatorSupportEnabled ? (
            <button
              type="button"
              className="leitor-lancamento-apoie"
              onClick={irParaApoioDoCriador}
            >
              Apoiar a obra
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  const renderCommentBranch = (c, depth) => {
    const perfilPublico = perfisUsuarios[c.userId];
    const autorLabel = formatUserDisplayWithHandle(perfilPublico);
    const unifiedPublicPath = publicCriadorProfilePath(perfilPublico, c.userId);
    const isLiked = c.usuariosQueCurtiram?.[user?.uid];
      const isPremium = isContaPremium(c.userId, user, perfil);
    const maxDepth = 8;
    const authorProfileButtonLabel = autorLabel || 'Abrir perfil do comentarista';

    return (
      <div
        key={c.id}
        id={`comentario-${c.id}`}
        className={`comentario comentario--thread${depth > 0 ? ' comentario--resposta' : ''}`}
      >
          <div className="comentario-linha">
            <button
              type="button"
              className="comentario-avatar-btn"
              onClick={() => handleCommentProfileOpen(perfilPublico, c.userId)}
              aria-label={authorProfileButtonLabel}
            >
              <img
                src={resolvePublicProfileAvatarUrl(perfilPublico, { fallback: AVATAR_FALLBACK })}
                alt={autorLabel ? `Avatar de ${autorLabel}` : 'Avatar do comentarista'}
                className="avatar-comentario"
                referrerPolicy="no-referrer"
                loading="lazy"
                decoding="async"
                onError={(e) => {
                  e.target.src = AVATAR_FALLBACK;
                }}
              />
            </button>
          <div className="comentario-corpo">
            <div className="comentario-header">
              <strong className="comentario-autor">
                {unifiedPublicPath ? (
                  <Link className="comentario-user-link" to={unifiedPublicPath}>
                    {autorLabel}
                  </Link>
                ) : (
                  <button
                    type="button"
                    className="comentario-user-link comentario-user-link--ghost"
                    onClick={() => handleCommentProfileOpen(perfilPublico, c.userId)}
                  >
                    {autorLabel}
                  </button>
                )}
              </strong>
              {isPremium ? <span className="premium-crown" title="Membro premium">👑</span> : null}
            </div>
            <p className="comentario-texto">{c.texto}</p>
            <div className="comentario-acoes">
              <button
                type="button"
                className={`btn-like ${isLiked ? 'liked' : ''}`}
                onClick={() => handleLike(c.id)}
                title={user ? (isLiked ? 'Remover curtida' : 'Curtir') : 'Faça login para curtir'}
              >
                {isLiked ? '❤' : '♡'} {c.likes || 0}
              </button>
              {user ? (
                <button
                  type="button"
                  className="btn-comentario-responder"
                  onClick={() => {
                    setReplyingTo((prev) => {
                      if (prev?.id === c.id) {
                        setReplyDraft('');
                        return null;
                      }
                      setReplyDraft('');
                      return {
                        id: c.id,
                        label: autorLabel,
                      };
                    });
                  }}
                >
                  {replyingTo?.id === c.id ? 'Fechar' : 'Responder'}
                </button>
              ) : null}
            </div>
            {replyingTo?.id === c.id ? (
              <div className="comentario-resposta-form">
                <p className="comentario-resposta-para">
                  Respondendo a <strong>{replyingTo.label}</strong>
                </p>
                <textarea
                  value={replyDraft}
                  onChange={(e) => setReplyDraft(e.target.value)}
                  placeholder="Escreva sua resposta..."
                  maxLength={500}
                  rows={3}
                  disabled={replyEnviando}
                />
                <div className="comentario-resposta-btns">
                  <button
                    type="button"
                    className="comentario-resposta-cancela"
                    onClick={() => {
                      setReplyingTo(null);
                      setReplyDraft('');
                    }}
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    className="comentario-resposta-envia"
                    disabled={!replyDraft.trim() || replyEnviando}
                    onClick={() => handleEnviarResposta(c.id)}
                  >
                    {replyEnviando ? 'Enviando...' : 'Publicar resposta'}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
        {c.replies?.length > 0 && depth < maxDepth ? (
          <div className="comentario-filhos">
            {c.replies.map((ch) => renderCommentBranch(ch, depth + 1))}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className="leitor-container">
      {profileToast ? (
        <div className="leitor-profile-toast" role="status">
          {profileToast}
        </div>
      ) : null}
      <BrowserPushPreferenceModal
        open={chapterBrowserPushModalOpen}
        permission={chapterBrowserPushPermission}
        title="Avisos no navegador"
        description="Quer receber notificação aqui no navegador quando sair capítulo novo desta obra?"
        onClose={() => setChapterBrowserPushModalOpen(false)}
      />
      {chapterSeo ? (
        <Helmet prioritizeSeoTags>
          <title>{chapterSeo.title}</title>
          <meta name="description" content={chapterSeo.description} />
          <meta property="og:type" content="article" />
          <meta property="og:title" content={chapterSeo.title} />
          <meta property="og:description" content={chapterSeo.description} />
          <meta property="og:url" content={chapterSeo.canonical} />
          <meta property="og:image" content={chapterSeo.shareImage} />
          {/^https:\/\//i.test(chapterSeo.shareImage) ? (
            <meta property="og:image:secure_url" content={chapterSeo.shareImage} />
          ) : null}
          <meta property="og:image:type" content={ogImageMimeHint(chapterSeo.shareImage)} />
          <meta property="og:image:alt" content={chapterSeo.imageAlt} />
          <meta name="twitter:card" content="summary_large_image" />
          <meta name="twitter:title" content={chapterSeo.title} />
          <meta name="twitter:description" content={chapterSeo.description} />
          <meta name="twitter:image" content={chapterSeo.shareImage} />
          <meta name="twitter:image:alt" content={chapterSeo.imageAlt} />
          <link rel="canonical" href={chapterSeo.canonical} />
          <script type="application/ld+json">{JSON.stringify(chapterSeo.jsonLd)}</script>
        </Helmet>
      ) : null}

      <header className="leitor-header">
        <div className="leitor-header-main">
          <h1>{capitulo.titulo}</h1>
          <button
            type="button"
            className={`leitor-chapter-like ${chapterLikedByUser ? 'is-liked' : ''}`}
            onClick={handleChapterLike}
            disabled={chapterLikeBusy}
            title={user ? (chapterLikedByUser ? 'Remover like do capitulo' : 'Curtir capitulo') : 'Faca login para curtir o capitulo'}
          >
            <span className="leitor-chapter-like-icon">{chapterLikedByUser ? '❤' : '♡'}</span>
            <span className="leitor-chapter-like-text">
              {chapterLikeBusy ? 'Salvando...' : (chapterLikedByUser ? 'Descurtir capitulo' : 'Curtir capitulo')}
            </span>
            <span className="leitor-chapter-like-count">{chapterLikesCount}</span>
          </button>
        </div>
        <button
          type="button"
          className="btn-config"
          aria-label="Abrir configurações de leitura"
          aria-expanded={mostrarConfig}
          onClick={() => setMostrarConfig((v) => !v)}
        >
          ⚙
        </button>
      </header>

      {mostrarConfig && (
        <div className="config-panel">
          <button
            type="button"
            aria-pressed={modoLeitura === 'vertical'}
            className={modoLeitura === 'vertical' ? 'active' : ''}
            onClick={() => setModoLeitura('vertical')}
          >
            Vertical
          </button>
          <button
            type="button"
            aria-pressed={modoLeitura === 'horizontal'}
            className={modoLeitura === 'horizontal' ? 'active' : ''}
            onClick={() => setModoLeitura('horizontal')}
          >
            Horizontal
          </button>
          <div>
            <button type="button" onClick={() => setZoom((z) => Math.max(50,  z - 10))}>-</button>
            <span>{zoom}%</span>
            <button type="button" onClick={() => setZoom((z) => Math.min(200, z + 10))}>+</button>
          </div>
        </div>
      )}

      {modoLeitura === 'vertical' ? (
        <main className="paginas-lista">
          {capitulo.paginas?.map((url, index) => (
            <img
              key={index}
              src={url}
              alt={`${chapterSeo?.imgAltPrefix || 'Mangá'} ${index + 1}`}
              referrerPolicy="no-referrer"
              loading="lazy"
              decoding="async"
              style={{ width: `${zoom}%`, display: 'block', margin: '0 auto' }}
            />
          ))}
        </main>
      ) : (
        <div className="horizontal-reader"
          onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}>
          <button type="button" className="seta esquerda" onClick={irAnterior} disabled={paginaAtual === 0}>‹</button>
          <div className="pagina-unica">
            <img
              src={capitulo.paginas?.[paginaAtual]}
              alt={`${chapterSeo?.imgAltPrefix || 'Mangá'} ${paginaAtual + 1}`}
              referrerPolicy="no-referrer"
              loading="lazy"
              decoding="async"
              style={{ width: `${zoom}%`, margin: '0 auto', display: 'block' }}
            />
          </div>
          <button type="button" className="seta direita" onClick={irProxima} disabled={paginaAtual >= totalPaginas - 1}>›</button>
          <div className="contador">{paginaAtual + 1} / {totalPaginas}</div>
        </div>
      )}

      <footer className="leitor-footer">
        <div className={`leitor-cap-nav${capNavError ? ' leitor-cap-nav--error' : ''}`}>
          <button
            type="button"
            className="leitor-cap-nav-btn"
            onClick={() =>
              anteriorCapituloId
                ? (setPaginaAtual(0), setVerticalFocusIndex(0), navigateToChapter(anteriorCapituloId, { forceStartAtPageOne: true }))
                : triggerCapNavError()
            }
          >
            ← Capítulo anterior
          </button>
          {capsLiberadosLista.length > 0 ? (
            <label className="leitor-cap-select-wrap">
              <span className="leitor-cap-select-label">Capítulo</span>
              <select
                className="leitor-cap-select"
                value={id}
                onChange={(e) => {
                  const v = String(e.target.value || '').trim();
                  if (v && v !== id) {
                    setPaginaAtual(0);
                    setVerticalFocusIndex(0);
                    navigateToChapter(v, { forceStartAtPageOne: true });
                  }
                }}
                aria-label="Escolher capítulo para ler"
              >
                {capsLiberadosLista.map((c) => {
                  const n = Number(c.numero || 0);
                  const tituloCurto = String(c.titulo || '').trim();
                  const labBase = tituloCurto || (n ? `Capítulo ${n}` : 'Capítulo');
                  const lab = n ? `#${n} — ${labBase}` : labBase;
                  return (
                    <option key={c.id} value={c.id}>
                      {lab}
                    </option>
                  );
                })}
              </select>
            </label>
          ) : null}
          <button
            type="button"
            className="leitor-cap-nav-btn"
            onClick={() =>
              proximoCapituloId
                ? (setPaginaAtual(0), setVerticalFocusIndex(0), navigateToChapter(proximoCapituloId, { forceStartAtPageOne: true }))
                : triggerCapNavError()
            }
          >
            Próximo capítulo →
          </button>
        </div>
        {authorUid ? (
          <button
            type="button"
            className="leitor-footer-author"
            onClick={() => navigate(authorPublicPath)}
          >
            {creatorIdentity?.avatarUrl ? (
              <img
                src={creatorIdentity.avatarUrl}
                alt={creatorIdentity?.label || 'Autor'}
                className="leitor-footer-author-avatar"
                referrerPolicy="no-referrer"
                loading="lazy"
                decoding="async"
              />
            ) : null}
            <span>{creatorIdentity?.label || 'Perfil do autor'}</span>
          </button>
        ) : null}
        <button type="button" onClick={() => navigate('/works')}>Voltar às obras</button>
        {chapterSeo ? (
          <Link className="leitor-footer-obra-link" to={chapterSeo.obraPath}>
            Ficha da obra
          </Link>
        ) : null}
        {creatorSupportEnabled ? (
          <button type="button" className="leitor-footer-apoie" onClick={irParaApoioDoCriador}>
            Apoiar criador
          </button>
        ) : null}
      </footer>
        <section className="leitor-next-alert">
          <strong>Quer continuar recebendo?</strong>
          <p>Ative o acompanhamento desta obra e os próximos capítulos vão cair automaticamente no seu sino.</p>
          <button
            type="button"
            className="leitor-next-alert-btn"
          disabled={subscribeCurrentWorkBusy}
          onClick={handleSubscribeCurrentWork}
        >
          {subscribeCurrentWorkBusy
            ? 'Salvando...'
            : isSubscribedCurrentWork
              ? 'Você já acompanha esta obra'
              : 'Acompanhar obra'}
        </button>
      </section>

      <ChapterShareBar
        shareUrl={chapterSeo?.canonical}
        chapterTitle={chapterSeo?.title || capitulo?.titulo}
      />

      {/* COMENTÁRIOS */}
      <section className="comentarios-section">
        <h2 className="leitor-comentarios-heading">Comentários ({listaComentarios.length})</h2>

        <div className="filtro-comentarios">
          <button
            type="button"
            aria-pressed={filtro === 'relevantes'}
            className={filtro === 'relevantes' ? 'ativo' : ''}
            onClick={() => setFiltro('relevantes')}
          >
            Relevantes
          </button>
          <button
            type="button"
            aria-pressed={filtro === 'recentes'}
            className={filtro === 'recentes' ? 'ativo' : ''}
            onClick={() => setFiltro('recentes')}
          >
            Recentes
          </button>
        </div>

        <form onSubmit={handleEnviarComentario} className="form-comentario">
          {user && (
            <img
              src={
                String(perfil?.userAvatar || '').trim() ||
                String(perfil?.creatorProfile?.avatarUrl || '').trim() ||
                String(user.photoURL || '').trim() ||
                AVATAR_FALLBACK
              }
              alt="Seu avatar"
              className="avatar-comentario"
              referrerPolicy="no-referrer"
              decoding="async"
              onError={(e) => { e.target.src = AVATAR_FALLBACK; }}
            />
          )}
          <div
            className={`input-comentario-wrapper${!user ? ' input-comentario-wrapper--convite' : ''}`}
            onClick={!user ? abrirModalComentarioDeslogado : undefined}
          >
            <textarea
              value={user ? comentarioTexto : ''}
              onChange={(e) => user && setComentario(e.target.value)}
              placeholder={user ? 'Escreva seu comentário...' : 'Entre na conta para comentar'}
              readOnly={!user}
              disabled={Boolean(user && enviando)}
              maxLength={user ? 500 : undefined}
              onClick={!user ? (e) => { e.stopPropagation(); abrirModalComentarioDeslogado(); } : undefined}
              onFocus={!user ? abrirModalComentarioDeslogado : undefined}
              className={!user ? 'textarea-convite-login' : undefined}
            />
            {user && (
              <button type="submit" disabled={!comentarioTexto.trim() || enviando}>
                {enviando ? 'Enviando...' : 'Comentar'}
              </button>
            )}
          </div>
        </form>

        <div className="lista-comentarios">
          {listaComentarios.length === 0 && (
            <p className="sem-comentarios">Seja o primeiro a comentar!</p>
          )}

          {comentariosEmThreads.map((c) => renderCommentBranch(c, 0))}
        </div>
      </section>

      {modalLoginComentario && !user && (
        <div
          className="leitor-modal-backdrop"
          onClick={() => setModalLoginComentario(false)}
          role="presentation"
        >
          <div
            className="leitor-modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="leitor-modal-login-titulo"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="leitor-modal-fechar"
              onClick={() => setModalLoginComentario(false)}
              aria-label="Fechar"
            >
              ×
            </button>
            <h2 id="leitor-modal-login-titulo" className="leitor-modal-titulo">
              Comentar na obra
            </h2>
            <p className="leitor-modal-texto">
              Deseja fazer login para comentar?
            </p>
            <div className="leitor-modal-acoes">
              <button
                type="button"
                className="leitor-modal-btn leitor-modal-btn--secundario"
                onClick={() => setModalLoginComentario(false)}
              >
                Agora não
              </button>
              <button
                type="button"
                className="leitor-modal-btn leitor-modal-btn--primario"
                onClick={() => {
                  setModalLoginComentario(false);
                  navigate(buildLoginUrlWithRedirect(location.pathname, location.search));
                }}
              >
                Sim, entrar
              </button>
            </div>
          </div>
        </div>
      )}

      {privateProfileModal && (
        <div
          className="leitor-modal-backdrop"
          onClick={() => setPrivateProfileModal(null)}
          role="presentation"
        >
          <div
            className="leitor-modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="leitor-modal-private-profile-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="leitor-modal-fechar"
              onClick={() => setPrivateProfileModal(null)}
              aria-label="Fechar"
            >
              ×
            </button>
            <h2 id="leitor-modal-private-profile-title" className="leitor-modal-titulo">
              Perfil privado
            </h2>
            <p className="leitor-modal-texto">
              {privateProfileModal.label} não deixou o card público disponível no momento.
            </p>
            <div className="leitor-modal-acoes">
              <button
                type="button"
                className="leitor-modal-btn leitor-modal-btn--primario"
                onClick={() => setPrivateProfileModal(null)}
              >
                Entendi
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

