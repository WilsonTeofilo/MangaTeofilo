import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Link, useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { ref, onValue, push, set, get, runTransaction, serverTimestamp } from 'firebase/database';
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
import { buildPublicProfileFromUsuarioRow } from '../../utils/publicUserProfile';
import { toRecordList } from '../../utils/firebaseRecordList';
import { formatUserDisplayWithHandle, normalizePublicHandle } from '../../utils/publicCreatorName';
import { isReaderPublicProfileEffective } from '../../utils/readerPublicProfile';
import { normalizeUsernameInput } from '../../utils/usernameValidation';
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

/** Perfil pÃºblico unificado: mesma URL para autor e leitor (abas no `/criador/:uid`). */
function publicCriadorProfilePath(perfilPublico, uid) {
  const u = String(uid || '').trim();
  if (!u || !perfilPublico) return null;
  const readerOk = isReaderPublicProfileEffective(perfilPublico);
  const cs = String(perfilPublico.creatorStatus || '').trim().toLowerCase();
  const looksCreator =
    cs === 'active' ||
    cs === 'onboarding' ||
    (perfilPublico.creatorProfile && typeof perfilPublico.creatorProfile === 'object');
  if (!readerOk && !looksCreator) return null;
  const tab = looksCreator ? 'works' : 'likes';
  return `/criador/${encodeURIComponent(u)}?tab=${tab}`;
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

/** Distintivo nos comentÃ¡rios: sÃ³ assinatura Premium paga (nÃ£o doaÃ§Ã£o / membro manual). */
const isContaPremium = (perfilPublico) => {
  const tipo = String(perfilPublico?.accountType ?? 'comum').toLowerCase();
  return tipo === 'premium';
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

  const touchStartX          = useRef(0);
  const touchEndX            = useRef(0);
  const unsubPerfis          = useRef({});
  const jaContouVisualizacao = useRef(false);
  const leituraAttributionRef = useRef({ source: 'normal', campaignId: null, clickId: null });
  const capNavErrorTimerRef = useRef(null);
  const profileToastTimerRef = useRef(null);
  const [capNavError, setCapNavError] = useState(false);
  const [profileToast, setProfileToast] = useState('');

  useEffect(() => { localStorage.setItem('modoLeitura', modoLeitura); }, [modoLeitura]);
  useEffect(() => { localStorage.setItem('zoom', zoom); }, [zoom]);

  useEffect(() => {
    if (user) setModalLoginComentario(false);
  }, [user]);

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
    const unsub = onValue(ref(db, `usuarios/${creatorUidApoio}`), (snapshot) => {
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

  const totalPaginas = capitulo?.paginas?.length || 0;
  const currentWorkId = obterObraIdCapitulo(capitulo);
  const chapterLikesCount = Number(capitulo?.likesCount || 0);
  const chapterLikedByUser = Boolean(user?.uid && capitulo?.usuariosQueCurtiram?.[user.uid]);
  const irProxima = useCallback(
    () => setPaginaAtual((p) => Math.min(p + 1, totalPaginas - 1)),
    [totalPaginas]
  );
  const irAnterior = useCallback(
    () => setPaginaAtual((p) => Math.max(p - 1, 0)),
    []
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

  // âœ… Qualquer usuÃ¡rio logado pode curtir â€” sem restriÃ§Ã£o de status
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
    // Like de comentÃ¡rio fica sÃ³ no nÃ³ do comentÃ¡rio; nÃ£o altera likes da obra/capÃ­tulo.
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
      console.error('Erro ao responder comentÃ¡rio:', err);
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
    if (!capitulo) return;
    try {
      await toggleChapterLikeCallable({ chapterId: id });
    } catch (e) {
      console.error('Erro ao curtir capÃ­tulo:', e);
    }
  };

  if (carregando) return <LoadingScreen />;
  if (!capitulo) {
    return (
      <div className="leitor-container">
        <Helmet prioritizeSeoTags>
          <title>CapÃ­tulo nÃ£o encontrado | MangaTeofilo</title>
          <meta name="robots" content="noindex,follow" />
        </Helmet>
        <div className="leitor-not-found" role="alert">
          CapÃ­tulo nÃ£o encontrado.
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
          <h1 className="leitor-lancamento-titulo">{capitulo.titulo || 'CapÃ­tulo'}</h1>
          <p className="leitor-lancamento-msg">
            Este fragmento ainda nÃ£o estÃ¡ liberado para leitura pÃºblica.
            {quando ? (
              <>
                {' '}
                PrevisÃ£o: <strong>{quando}</strong>
              </>
            ) : null}
          </p>
          {capitulo.antecipadoMembros && (
            <p className="leitor-lancamento-hint">
              Quem tem <strong>membership ativa do autor desta obra</strong> pode ler antes do horÃ¡rio pÃºblico.
            </p>
          )}
          <button
            type="button"
            className="leitor-lancamento-voltar"
            onClick={() => navigate('/works')}
          >
            Voltar Ã  biblioteca
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
    const handle = normalizePublicHandle(perfilPublico);
    const unifiedPublicPath = publicCriadorProfilePath(perfilPublico, c.userId);
    const isLiked = c.usuariosQueCurtiram?.[user?.uid];
    const isPremium = isContaPremium(perfilPublico);
    const maxDepth = 8;

    return (
      <div
        key={c.id}
        id={`comentario-${c.id}`}
        className={`comentario comentario--thread${depth > 0 ? ' comentario--resposta' : ''}`}
      >
        <div className="comentario-linha">
          <img
            src={perfilPublico?.userAvatar || AVATAR_FALLBACK}
            alt={autorLabel ? `Avatar de ${autorLabel}` : 'Avatar do comentarista'}
            className="avatar-comentario"
            onError={(e) => {
              e.target.src = AVATAR_FALLBACK;
            }}
          />
          <div className="comentario-corpo">
            <div className="comentario-header">
              <strong className="comentario-autor">
                {unifiedPublicPath ? (
                  <Link className="comentario-user-link" to={unifiedPublicPath}>
                    {autorLabel}
                  </Link>
                ) : handle ? (
                  <Link
                    className="comentario-user-link"
                    to={`/@${normalizeUsernameInput(handle) || handle}`}
                  >
                    {autorLabel}
                  </Link>
                ) : (
                  <button
                    type="button"
                    className="comentario-user-link comentario-user-link--ghost"
                    onClick={() =>
                      showProfileToast('Este perfil Ã© privado e nÃ£o aceita visitas no momento.')
                    }
                  >
                    {autorLabel}
                  </button>
                )}
              </strong>
              {isPremium ? <span className="premium-crown" title="Membro premium">ðŸ‘‘</span> : null}
            </div>
            <p className="comentario-texto">{c.texto}</p>
            <div className="comentario-acoes">
              <button
                type="button"
                className={`btn-like ${isLiked ? 'liked' : ''}`}
                onClick={() => handleLike(c.id)}
                title={user ? (isLiked ? 'Remover curtida' : 'Curtir') : 'FaÃ§a login para curtir'}
              >
                {isLiked ? 'â¤ï¸' : 'ðŸ¤'} {c.likes || 0}
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
                  placeholder="Escreva sua respostaâ€¦"
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
        description="Quer receber notificaÃ§Ã£o aqui no navegador quando sair capÃ­tulo novo desta obra?"
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
            title={user ? (chapterLikedByUser ? 'Remover like do capitulo' : 'Curtir capitulo') : 'Faca login para curtir o capitulo'}
          >
            <span className="leitor-chapter-like-icon">{chapterLikedByUser ? 'â¤' : 'â™¡'}</span>
            <span className="leitor-chapter-like-text">Curtir capitulo</span>
            <span className="leitor-chapter-like-count">{chapterLikesCount}</span>
          </button>
        </div>
        <button
          type="button"
          className="btn-config"
          aria-label="Abrir configuracoes de leitura"
          aria-expanded={mostrarConfig}
          onClick={() => setMostrarConfig((v) => !v)}
        >
          âš™
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
              alt={`${chapterSeo?.imgAltPrefix || 'MangÃ¡'} ${index + 1}`}
              loading="lazy"
              style={{ width: `${zoom}%`, display: 'block', margin: '0 auto' }}
            />
          ))}
        </main>
      ) : (
        <div className="horizontal-reader"
          onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}>
          <button type="button" className="seta esquerda" onClick={irAnterior} disabled={paginaAtual === 0}>â€¹</button>
          <div className="pagina-unica">
            <img
              src={capitulo.paginas?.[paginaAtual]}
              alt={`${chapterSeo?.imgAltPrefix || 'MangÃ¡'} ${paginaAtual + 1}`}
              loading="lazy"
              style={{ width: `${zoom}%`, margin: '0 auto', display: 'block' }}
            />
          </div>
          <button type="button" className="seta direita" onClick={irProxima} disabled={paginaAtual >= totalPaginas - 1}>â€º</button>
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
                ? navigate(`/ler/${anteriorCapituloId}`)
                : triggerCapNavError()
            }
          >
            â† CapÃ­tulo anterior
          </button>
          {capsLiberadosLista.length > 0 ? (
            <label className="leitor-cap-select-wrap">
              <span className="leitor-cap-select-label">CapÃ­tulo</span>
              <select
                className="leitor-cap-select"
                value={id}
                onChange={(e) => {
                  const v = String(e.target.value || '').trim();
                  if (v && v !== id) navigate(`/ler/${v}`);
                }}
                aria-label="Escolher capÃ­tulo para ler"
              >
                {capsLiberadosLista.map((c) => {
                  const n = Number(c.numero || 0);
                  const tituloCurto = String(c.titulo || '').trim();
                  const labBase = tituloCurto || (n ? `CapÃ­tulo ${n}` : 'CapÃ­tulo');
                  const lab = n ? `#${n} â€” ${labBase}` : labBase;
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
                ? navigate(`/ler/${proximoCapituloId}`)
                : triggerCapNavError()
            }
          >
            PrÃ³ximo capÃ­tulo â†’
          </button>
        </div>
        {authorUid ? (
          <button
            type="button"
            className="leitor-footer-author"
            onClick={() => navigate(`/criador/${encodeURIComponent(authorUid)}`)}
          >
            Perfil do autor
          </button>
        ) : null}
        <button type="button" onClick={() => navigate('/works')}>Voltar Ã s obras</button>
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
          <p>Ative o acompanhamento desta obra e os proximos capitulos vao cair automaticamente no seu sino.</p>
          <button
            type="button"
            className="leitor-next-alert-btn"
          disabled={subscribeCurrentWorkBusy}
          onClick={handleSubscribeCurrentWork}
        >
          {subscribeCurrentWorkBusy
            ? 'Salvando...'
            : isSubscribedCurrentWork
              ? 'Voce ja acompanha esta obra'
              : 'Acompanhar obra'}
        </button>
      </section>

      <ChapterShareBar
        shareUrl={chapterSeo?.canonical}
        chapterTitle={chapterSeo?.title || capitulo?.titulo}
      />

      {/* â”€â”€ COMENTÃRIOS â”€â”€ */}
      <section className="comentarios-section">
        <h2 className="leitor-comentarios-heading">ComentÃ¡rios ({listaComentarios.length})</h2>

        <div className="filtro-comentarios">
          <button
            type="button"
            aria-pressed={filtro === 'relevantes'}
            className={filtro === 'relevantes' ? 'ativo' : ''}
            onClick={() => setFiltro('relevantes')}
          >
            ðŸ”¥ Relevantes
          </button>
          <button
            type="button"
            aria-pressed={filtro === 'recentes'}
            className={filtro === 'recentes' ? 'ativo' : ''}
            onClick={() => setFiltro('recentes')}
          >
            ðŸ•’ Recentes
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
              placeholder={user ? 'Escreva seu comentÃ¡rioâ€¦' : 'Entre na conta para comentar'}
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
            <p className="sem-comentarios">Seja o primeiro a comentar! ðŸ‘‡</p>
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
              Ã—
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
                Agora nÃ£o
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
    </div>
  );
}

