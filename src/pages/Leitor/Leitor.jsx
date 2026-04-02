import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Link, useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { ref, onValue, push, set, get, runTransaction, serverTimestamp, update } from 'firebase/database';
import { httpsCallable } from 'firebase/functions';

import { db, functions } from '../../services/firebase';
import { AVATAR_FALLBACK } from '../../constants';
import { capituloLiberadoParaUsuario, formatarDataLancamento } from '../../utils/capituloLancamento';
import { applyChapterCommentDelta, applyChapterLikeDelta, applyChapterReadDelta } from '../../utils/discoveryStats';
import { getAttribution, parseAttributionFromSearch, persistAttribution } from '../../utils/trafficAttribution';
import {
  OBRA_PADRAO_ID,
  buildChapterCampaignId,
  normalizarObraId,
  obterObraIdCapitulo,
  obraCreatorId,
  obraSegmentoUrlPublica,
} from '../../config/obras';
import { apoiePathParaCriador } from '../../utils/creatorSupportPaths';
import { buildLoginUrlWithRedirect } from '../../utils/loginRedirectPath';
import LoadingScreen from '../../components/LoadingScreen';
import './Leitor.css';

const registrarAttributionEvento = httpsCallable(functions, 'registrarAttributionEvento');
const upsertNotificationSubscription = httpsCallable(functions, 'upsertNotificationSubscription');

/** Distintivo nos comentários: só assinatura Premium paga (não doação / membro manual). */
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
  const [mostrarConfig, setMostrarConfig] = useState(false);
  const [modalLoginComentario, setModalLoginComentario] = useState(false);
  const [creatorUidApoio, setCreatorUidApoio] = useState(null);
  const [isSubscribedCurrentWork, setIsSubscribedCurrentWork] = useState(false);
  const [subscribeCurrentWorkBusy, setSubscribeCurrentWorkBusy] = useState(false);
  const [obraMetaLeitor, setObraMetaLeitor] = useState(null);

  const touchStartX          = useRef(0);
  const touchEndX            = useRef(0);
  const unsubPerfis          = useRef({});
  const jaContouVisualizacao = useRef(false);
  const leituraAttributionRef = useRef({ source: 'normal', campaignId: null, clickId: null });

  useEffect(() => { localStorage.setItem('modoLeitura', modoLeitura); }, [modoLeitura]);
  useEffect(() => { localStorage.setItem('zoom', zoom); }, [zoom]);

  useEffect(() => {
    if (user) setModalLoginComentario(false);
  }, [user]);

  useEffect(() => {
    if (!capitulo) {
      setCreatorUidApoio(null);
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
    if (!modalLoginComentario) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setModalLoginComentario(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modalLoginComentario]);

  // ✅ Lê de usuarios_publicos (.read = true nas rules)
  // Qualquer visitante, logado ou não, consegue ver nome e avatar
  const escutarPerfil = useCallback((uid) => {
    if (!uid || unsubPerfis.current[uid]) return;
    const unsub = onValue(
      ref(db, `usuarios_publicos/${uid}`),
      (snap) => {
        if (snap.exists()) {
          setPerfis((prev) => ({ ...prev, [uid]: snap.val() }));
        }
      }
    );
    unsubPerfis.current[uid] = unsub;
  }, []);

  useEffect(() => {
    jaContouVisualizacao.current = false;
  }, [id]);

  const chapterSeo = useMemo(() => {
    if (!capitulo || !id) return null;
    const SITE = 'MangaTeofilo';
    const SITE_W = 'https://mangateofilo.com';
    const obraNome = String(capitulo.obraTitulo || capitulo.obraName || '').trim() || 'Mangá autoral';
    const num = Number(capitulo.numero || 0);
    const capTitulo =
      String(capitulo.titulo || '').trim() || (num ? `Capítulo ${num}` : 'Capítulo');
    const numLabel = num > 0 ? String(num) : '?';
    const canonical = `${SITE_W}/ler/${encodeURIComponent(id)}`;
    const title = `Ler ${obraNome} — Cap. ${numLabel}: ${capTitulo} | ${SITE}`;
    const description = `Leia online ${capTitulo} (${obraNome}) — mangá em português, ler mangá grátis. ${SITE}.`;
    const workId = obterObraIdCapitulo(capitulo);
    const meta =
      obraMetaLeitor && normalizarObraId(obraMetaLeitor.id) === normalizarObraId(workId)
        ? obraMetaLeitor
        : {
            id: workId,
            titulo: capitulo.obraTitulo || capitulo.obraName,
            slug: capitulo.obraSlug,
          };
    const workSeg = obraSegmentoUrlPublica(meta);
    const obraPageUrl = `${SITE_W}/work/${encodeURIComponent(workSeg)}`;
    const jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'Chapter',
      name: capTitulo,
      isPartOf: {
        '@type': 'CreativeWorkSeries',
        name: obraNome,
        url: obraPageUrl,
      },
      url: canonical,
      inLanguage: 'pt-BR',
    };
    return {
      title,
      description,
      canonical,
      jsonLd,
      obraNome,
      capTitulo,
      imgAltPrefix: `${obraNome} — ${capTitulo} — página`,
      obraPath: `/work/${encodeURIComponent(workSeg)}`,
    };
  }, [capitulo, id, obraMetaLeitor]);

  const capituloParaAcesso = useMemo(() => {
    if (!capitulo) return null;
    return creatorUidApoio && !capitulo.creatorId
      ? { ...capitulo, creatorId: creatorUidApoio }
      : capitulo;
  }, [capitulo, creatorUidApoio]);

  useEffect(() => {
    const fromUrl = parseAttributionFromSearch(searchParams);
    if (fromUrl) {
      persistAttribution(fromUrl);
      leituraAttributionRef.current = {
        source: fromUrl.source || 'normal',
        campaignId: fromUrl.campaignId || null,
        clickId: fromUrl.clickId || null,
      };
      if (fromUrl.source === 'chapter_email') {
        registrarAttributionEvento({
          eventType: 'chapter_landing',
          source: fromUrl.source,
          campaignId: fromUrl.campaignId || `chapter_${id}`,
          clickId: fromUrl.clickId || null,
          chapterId: id,
        }).catch(() => {});
      }
      return;
    }
    const cached = getAttribution(2 * 24 * 60 * 60 * 1000);
    const chapterCampaignId = buildChapterCampaignId(id, OBRA_PADRAO_ID);
    const isSameChapterCampaign =
      cached?.source === 'chapter_email' &&
      (!cached?.campaignId || cached.campaignId === chapterCampaignId);
    leituraAttributionRef.current = {
      source: isSameChapterCampaign ? 'chapter_email' : 'normal',
      campaignId: isSameChapterCampaign ? cached?.campaignId || chapterCampaignId : null,
      clickId: isSameChapterCampaign ? cached?.clickId || null : null,
    };
  }, [searchParams, id]);

  useEffect(() => {
    if (!id) {
      setCapitulo(null);
      setComentarios([]);
      setCarregando(false);
      return () => {};
    }

    let ativo = true;
    setCarregando(true);
    setCapitulo(null);
    setComentarios([]);
    setPaginaAtual(0);

    const unsub = onValue(
      ref(db, `capitulos/${id}`),
      (snap) => {
        if (!ativo) return;
        if (!snap.exists()) {
          setCapitulo(null);
          setComentarios([]);
          setCarregando(false);
          return;
        }
        const dados = snap.val();
        setCapitulo(dados);

        if (dados.comentarios) {
          const lista = Object.keys(dados.comentarios).map((key) => ({
            id: key,
            ...dados.comentarios[key],
          }));
          setComentarios(lista);
          lista.forEach((c) => { if (c.userId) escutarPerfil(c.userId); });
        } else {
          setComentarios([]);
        }
        setCarregando(false);
      },
      () => {
        if (!ativo) return;
        setCapitulo(null);
        setComentarios([]);
        setCarregando(false);
      }
    );

    return () => {
      ativo = false;
      unsub();
      Object.values(unsubPerfis.current).forEach((u) => u?.());
      unsubPerfis.current = {};
    };
  }, [id, escutarPerfil]);

  useEffect(() => {
    if (!capitulo || !id) return;
    const cap = { ...(capituloParaAcesso || capitulo), id };
    if (
      !capituloLiberadoParaUsuario(cap, user, perfil, { creatorIdFallback: creatorUidApoio || '' })
    ) {
      return;
    }
    if (jaContouVisualizacao.current) return;
    jaContouVisualizacao.current = true;
    runTransaction(ref(db, `capitulos/${id}/visualizacoes`), (v) => (v || 0) + 1);
    applyChapterReadDelta(db, {
      chapterId: id,
      workId: obterObraIdCapitulo(capitulo),
      creatorId: creatorUidApoio || obraCreatorId({ creatorId: capitulo?.creatorId || '' }),
      amount: 1,
      viewerUid: String(user?.uid || '').trim(),
      chapterNumber: Number(capitulo?.numero || 0),
      chapterTitle: String(capitulo?.titulo || '').trim(),
    }).catch(() => {});
    const attrib = leituraAttributionRef.current || { source: 'normal' };
    registrarAttributionEvento({
      eventType: 'chapter_read',
      source: attrib.source || 'normal',
      campaignId:
        attrib.campaignId ||
        (attrib.source === 'chapter_email'
          ? buildChapterCampaignId(id, obterObraIdCapitulo(capitulo))
          : null),
      clickId: attrib.clickId || null,
      chapterId: id,
    }).catch(() => {});
  }, [capitulo, capituloParaAcesso, id, user, perfil, creatorUidApoio]);

  // ✅ Sincroniza perfil público ANTES de comentar
  // Garante que todos os visitantes verão o avatar e nome atualizados
  const sincronizarPerfilPublico = async (usuario) => {
    if (!usuario) return;
    try {
      const tipoSnap = await get(ref(db, `usuarios/${usuario.uid}/accountType`));
      const tipoRaw = tipoSnap.exists() ? String(tipoSnap.val() ?? 'comum').toLowerCase() : 'comum';
      const accountTypePub = ['comum', 'membro', 'premium', 'admin'].includes(tipoRaw)
        ? tipoRaw
        : 'comum';
      await update(ref(db, `usuarios_publicos/${usuario.uid}`), {
        uid:         usuario.uid,
        userName:    usuario.displayName || 'Guerreiro',
        userAvatar:  usuario.photoURL    || AVATAR_FALLBACK,
        accountType: accountTypePub,
        updatedAt:   Date.now(),
      });
    } catch (err) {
      console.warn('Aviso: não foi possível sincronizar perfil público.', err.message);
    }
  };

  const totalPaginas = capitulo?.paginas?.length || 0;
  const currentWorkId = obterObraIdCapitulo(capitulo);
  const chapterLikesCount = Number(capitulo?.likesCount || 0);
  const chapterLikedByUser = Boolean(user?.uid && capitulo?.usuariosQueCurtiram?.[user.uid]);
  const irProxima  = () => setPaginaAtual((p) => Math.min(p + 1, totalPaginas - 1));
  const irAnterior = () => setPaginaAtual((p) => Math.max(p - 1, 0));

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
  }, [modoLeitura, totalPaginas]);

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
    try {
      await sincronizarPerfilPublico(user); // atualiza avatar antes de gravar
      await set(push(ref(db, `capitulos/${id}/comentarios`)), {
        texto:  comentarioTexto.trim(),
        userId: user.uid,
        data:   serverTimestamp(),
        likes:  0,
      });
      await applyChapterCommentDelta(db, {
        chapterId: id,
        workId: obterObraIdCapitulo(capitulo),
        creatorId: creatorUidApoio || obraCreatorId({ creatorId: capitulo?.creatorId || '' }),
        amount: 1,
      });
      setComentario('');
    } catch (err) {
      console.error('Erro ao comentar:', err);
    } finally {
      setEnviando(false);
    }
  };

  // ✅ Qualquer usuário logado pode curtir — sem restrição de status
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

  const comentariosOrdenados = useMemo(
    () => [...listaComentarios].sort((a, b) =>
      filtro === 'relevantes'
        ? (b.likes || 0) - (a.likes || 0)
        : (b.data || 0) - (a.data || 0)
    ),
    [listaComentarios, filtro]
  );

  const apoieComCriadorPath = useMemo(
    () => apoiePathParaCriador(creatorUidApoio || ''),
    [creatorUidApoio]
  );

  const irParaApoioDoCriador = () => {
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
      if (nextEnabled && typeof window !== 'undefined' && typeof Notification !== 'undefined') {
        const wantsBrowserNotifications = window.confirm(
          'Quer ser avisado no navegador quando sair o proximo capitulo desta obra?'
        );
        if (wantsBrowserNotifications && Notification.permission === 'default') {
          await Notification.requestPermission();
        }
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

    const capRef = ref(db, `capitulos/${id}`);
    let snap;
    try {
      snap = await get(capRef);
    } catch (e) {
      console.error('Erro ao ler capítulo para curtir:', e);
      return;
    }
    if (!snap.exists()) return;
    const chapter = snap.val() || {};
    const alreadyLiked = Boolean(chapter.usuariosQueCurtiram?.[user.uid]);
    const currentLikes = Number(chapter.likesCount || 0);
    const workId = obterObraIdCapitulo(capitulo);
    const creatorId = creatorUidApoio || obraCreatorId({ creatorId: capitulo?.creatorId || '' });

    try {
      if (alreadyLiked) {
        await update(capRef, {
          likesCount: Math.max(0, currentLikes - 1),
          [`usuariosQueCurtiram/${user.uid}`]: null,
        });
        await applyChapterLikeDelta(db, {
          chapterId: id,
          workId,
          creatorId,
          amount: -1,
        });
      } else {
        await update(capRef, {
          likesCount: currentLikes + 1,
          [`usuariosQueCurtiram/${user.uid}`]: true,
        });
        await applyChapterLikeDelta(db, {
          chapterId: id,
          workId,
          creatorId,
          amount: 1,
        });
      }
    } catch (e) {
      console.error('Erro ao curtir capítulo:', e);
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
            <meta property="og:title" content={chapterSeo.title} />
            <meta property="og:description" content={chapterSeo.description} />
            <meta property="og:url" content={chapterSeo.canonical} />
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
          <button
            type="button"
            className="leitor-lancamento-apoie"
            onClick={irParaApoioDoCriador}
          >
            Apoiar a obra
          </button>
        </div>
      </div>
    );
  }

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
          <meta name="twitter:title" content={chapterSeo.title} />
          <meta name="twitter:description" content={chapterSeo.description} />
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
            <span className="leitor-chapter-like-icon">{chapterLikedByUser ? '❤' : '♡'}</span>
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
              loading="lazy"
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
              loading="lazy"
              style={{ width: `${zoom}%`, margin: '0 auto', display: 'block' }}
            />
          </div>
          <button type="button" className="seta direita" onClick={irProxima} disabled={paginaAtual >= totalPaginas - 1}>›</button>
          <div className="contador">{paginaAtual + 1} / {totalPaginas}</div>
        </div>
      )}

      <footer className="leitor-footer">
        <button type="button" onClick={() => navigate('/works')}>Voltar às obras</button>
        {chapterSeo ? (
          <Link className="leitor-footer-obra-link" to={chapterSeo.obraPath}>
            Ficha da obra
          </Link>
        ) : null}
        <button type="button" className="leitor-footer-apoie" onClick={irParaApoioDoCriador}>
          Apoiar criador
        </button>
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

      {/* ── COMENTÁRIOS ── */}
      <section className="comentarios-section">
        <h2 className="leitor-comentarios-heading">Comentários ({listaComentarios.length})</h2>

        <div className="filtro-comentarios">
          <button
            type="button"
            aria-pressed={filtro === 'relevantes'}
            className={filtro === 'relevantes' ? 'ativo' : ''}
            onClick={() => setFiltro('relevantes')}
          >
            🔥 Relevantes
          </button>
          <button
            type="button"
            aria-pressed={filtro === 'recentes'}
            className={filtro === 'recentes' ? 'ativo' : ''}
            onClick={() => setFiltro('recentes')}
          >
            🕒 Recentes
          </button>
        </div>

        <form onSubmit={handleEnviarComentario} className="form-comentario">
          {user && (
            <img src={user.photoURL || AVATAR_FALLBACK} alt="Seu avatar"
              className="avatar-comentario"
              onError={(e) => { e.target.src = AVATAR_FALLBACK; }} />
          )}
          <div
            className={`input-comentario-wrapper${!user ? ' input-comentario-wrapper--convite' : ''}`}
            onClick={!user ? abrirModalComentarioDeslogado : undefined}
          >
            <textarea
              value={user ? comentarioTexto : ''}
              onChange={(e) => user && setComentario(e.target.value)}
              placeholder={user ? 'Escreva seu comentário...' : 'Faça login para comentar'}
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
          {comentariosOrdenados.length === 0 && (
            <p className="sem-comentarios">Seja o primeiro a comentar! 👇</p>
          )}

          {comentariosOrdenados.map((c) => {
            const perfilPublico = perfisUsuarios[c.userId];
            const isLiked   = c.usuariosQueCurtiram?.[user?.uid];
            const isPremium = isContaPremium(perfilPublico);

            return (
              <div key={c.id} className="comentario">
                {/* Avatar visível para TODOS */}
                <img
                  src={perfilPublico?.userAvatar || AVATAR_FALLBACK}
                  alt={perfilPublico?.userName ? `Avatar de ${perfilPublico.userName}` : 'Avatar do comentarista'}
                  className="avatar-comentario"
                  onError={(e) => { e.target.src = AVATAR_FALLBACK; }}
                />
                <div className="comentario-corpo">
                  <div className="comentario-header">
                    <strong className="comentario-autor">
                      {perfilPublico?.userName || 'Carregando...'}
                    </strong>
                    {isPremium && <span className="badge-premium" title="Membro premium">👑</span>}
                  </div>
                  <p className="comentario-texto">{c.texto}</p>
                  {/* Like disponível para qualquer usuário logado */}
                  <button
                    type="button"
                    className={`btn-like ${isLiked ? 'liked' : ''}`}
                    onClick={() => handleLike(c.id)}
                    title={user ? (isLiked ? 'Remover curtida' : 'Curtir') : 'Faça login para curtir'}
                  >
                    {isLiked ? '❤️' : '🤍'} {c.likes || 0}
                  </button>
                </div>
              </div>
            );
          })}
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
    </div>
  );
}
