import React, { useEffect, useMemo, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { httpsCallable } from 'firebase/functions';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';

import { db, functions } from '../../services/firebase';
import { emptyAdminAccess } from '../../auth/adminAccess';
import {
  normalizarObraId,
  obterObraIdCapitulo,
  obraCreatorId,
  obraSegmentoUrlPublica,
  resolverObraIdPorSlugOuId,
  slugifyObraSlug,
} from '../../config/obras';
import { getLastRead, subscribeReadingProgress } from '../../utils/readingProgressLocal';
import { capituloLiberadoParaUsuario, formatarDataLancamento } from '../../utils/capituloLancamento';
import { formatarDataBrPartirIsoOuMs } from '../../utils/datasBr';
import { chapterCoverStyle } from '../../utils/chapterCoverStyle';
import { toRecordList } from '../../utils/firebaseRecordList';
import { removeWorkFavoriteBoth, saveWorkFavoriteBoth } from '../../utils/workFavorites';
import { obraEstaArquivada } from '../../utils/obraCatalogo';
import { resolvePublicCreatorIdentity } from '../../utils/publicCreatorName';
import {
  resolvePublicProfileDisplayName,
} from '../../utils/publicUserProfile';
import { collectCreatorIdsFromWorksAndChapters, subscribePublicProfilesMap } from '../../utils/publicProfilesRealtime';
import { buildObraPageSeo } from '../../seo/applyObraPageSeo';
import BrowserPushPreferenceModal from '../../components/BrowserPushPreferenceModal.jsx';
import './ObraDetalhe.css';

function usuarioPodeVerObraArquivada(user, adminAccess, obra) {
  if (!obraEstaArquivada(obra)) return true;
  if (!user?.uid) return false;
  if (adminAccess?.canAccessAdmin && !adminAccess?.isMangaka) return true;
  return obraCreatorId(obra) === user.uid;
}

function chapterSort(a, b) {
  const nA = Number(a?.numero || 0);
  const nB = Number(b?.numero || 0);
  if (nA !== nB) return nA - nB;
  const dA = Date.parse(a?.dataUpload || '');
  const dB = Date.parse(b?.dataUpload || '');
  return (Number.isFinite(dA) ? dA : 0) - (Number.isFinite(dB) ? dB : 0);
}

/** Rota `/work/:slug` (slug ou id). */
export default function ObraDetalhe({ user, perfil, adminAccess = emptyAdminAccess() }) {
  const params = useParams();
  const routeSlug = params.slug;
  const navigate = useNavigate();
  const location = useLocation();

  const [obraId, setObraId] = useState(null);
  const [idResolvido, setIdResolvido] = useState(false);

  const [loading, setLoading] = useState(true);
  const [obra, setObra] = useState(null);
  const [capitulos, setCapitulos] = useState([]);
  const [isFavorito, setIsFavorito] = useState(false);
  const [creatorsMap, setCreatorsMap] = useState({});
  const [isSubscribedWork, setIsSubscribedWork] = useState(false);
  const [workNotificationBusy, setWorkNotificationBusy] = useState(false);
  const [workBrowserPushModalOpen, setWorkBrowserPushModalOpen] = useState(false);
  const [workBrowserPushPermission, setWorkBrowserPushPermission] = useState('default');
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  const [workActionMessage, setWorkActionMessage] = useState('');
  const [lastReadLocal, setLastReadLocal] = useState(() => getLastRead());
  const upsertNotificationSubscription = useMemo(
    () => httpsCallable(functions, 'upsertNotificationSubscription'),
    []
  );

  const obraParaExibir = useMemo(() => {
    if (!obra) return null;
    if (!usuarioPodeVerObraArquivada(user, adminAccess, obra)) return null;
    return obra;
  }, [obra, user, adminAccess]);

  const obraSeo = useMemo(() => {
    if (!obraParaExibir) return null;
    return buildObraPageSeo({ obra: obraParaExibir });
  }, [obraParaExibir]);

  /** Redireciona `/work/{slug}` para `/work/{slug-canônico}` (SEO) sem mudar `obras/shito` no RTDB. */
  useEffect(() => {
    if (loading || !obraParaExibir) return;
    const canon = obraSegmentoUrlPublica(obraParaExibir);
    const target = `/work/${encodeURIComponent(canon)}${location.search || ''}${location.hash || ''}`;
    const parts = String(location.pathname || '').split('/').filter(Boolean);
    if (parts[0] === 'work' && parts[1]) {
      try {
        const curSeg = decodeURIComponent(parts[1]);
        if (slugifyObraSlug(curSeg) === slugifyObraSlug(canon)) return;
      } catch {
        /* segue para redirect */
      }
      navigate(target, { replace: true });
      return;
    }
  }, [
    loading,
    obraParaExibir,
    location.pathname,
    location.search,
    location.hash,
    navigate,
  ]);

  useEffect(() => {
    if (routeSlug) {
      setIdResolvido(false);
      const raw = decodeURIComponent(String(routeSlug || ''));
      const unsub = onValue(ref(db, 'obras'), (snapshot) => {
        const list = snapshot.exists() ? toRecordList(snapshot.val()) : [];
        const resolved = resolverObraIdPorSlugOuId(list, raw);
        setObraId(resolved);
        setIdResolvido(true);
      });
      return () => unsub();
    }
    setObraId(null);
    setIdResolvido(true);
  }, [routeSlug]);

  useEffect(() => {
    if (!idResolvido || !obraId) {
      setLoading(!idResolvido);
      return () => {};
    }

    let loadingObra = true;
    let loadingCap = true;

    const concluir = () => {
      if (!loadingObra && !loadingCap) setLoading(false);
    };

    const obraRef = ref(db, `obras/${obraId}`);
    const unsubObra = onValue(obraRef, (snapshot) => {
      if (snapshot.exists()) {
        setObra({ id: obraId, ...snapshot.val() });
      } else {
        setObra(null);
      }
      loadingObra = false;
      concluir();
    }, () => {
      setObra(null);
      loadingObra = false;
      concluir();
    });

    const capRef = ref(db, 'capitulos');
    const unsubCap = onValue(capRef, (snapshot) => {
      const lista = snapshot.exists() ? toRecordList(snapshot.val()) : [];
      const filtrados = lista
        .filter((cap) => obterObraIdCapitulo(cap) === obraId)
        .sort(chapterSort);
      setCapitulos(filtrados);
      loadingCap = false;
      concluir();
    }, () => {
      setCapitulos([]);
      loadingCap = false;
      concluir();
    });

    return () => {
      unsubObra();
      unsubCap();
    };
  }, [idResolvido, obraId]);

  useEffect(() => {
    if (!user?.uid || !obraId) {
      setIsFavorito(false);
      return () => {};
    }
    const u2 = onValue(ref(db, `usuarios/${user.uid}/favorites/${obraId}`), (s) => {
      setIsFavorito(s.exists());
    });
    return () => {
      u2();
    };
  }, [user?.uid, obraId]);

  useEffect(() => {
    if (!user?.uid || !obraId) {
      setIsSubscribedWork(false);
      return () => {};
    }
    const unsub = onValue(
      ref(db, `usuarios/${user.uid}/subscribedWorks/${obraId}`),
      (snapshot) => {
        setIsSubscribedWork(snapshot.exists());
      }
    );
    return () => unsub();
  }, [obraId, user?.uid]);

  const capitulosResolvidos = useMemo(() => capitulos, [capitulos]);

  const creatorIdsForLookup = useMemo(
    () => collectCreatorIdsFromWorksAndChapters(obra ? [obra] : [], capitulosResolvidos),
    [obra, capitulosResolvidos]
  );

  useEffect(() => subscribePublicProfilesMap(db, creatorIdsForLookup, setCreatorsMap), [creatorIdsForLookup]);

  useEffect(() => subscribeReadingProgress(() => setLastReadLocal(getLastRead())), []);

  const capitulosAsc = useMemo(
    () => [...capitulosResolvidos].sort((a, b) => Number(a?.numero || 0) - Number(b?.numero || 0)),
    [capitulosResolvidos]
  );
  const creatorIdentity = useMemo(
    () => resolvePublicCreatorIdentity(obraParaExibir || obra || {}, creatorsMap, capitulosResolvidos),
    [obraParaExibir, obra, creatorsMap, capitulosResolvidos]
  );

  const primeiroLiberado = useMemo(
    () =>
      capitulosAsc.find((cap) => capituloLiberadoParaUsuario(cap, user, perfil)) || null,
    [capitulosAsc, user, perfil]
  );

  const continuarCap = useMemo(() => {
    if (!lastReadLocal || !obraId) return null;
    if (normalizarObraId(lastReadLocal.workId) !== normalizarObraId(obraId)) return null;
    const cap = capitulosResolvidos.find((c) => c.id === lastReadLocal.chapterId);
    if (!cap) return null;
    if (!capituloLiberadoParaUsuario(cap, user, perfil)) return null;
    return cap;
  }, [lastReadLocal, obraId, capitulosResolvidos, user, perfil]);

  const capMaisRecente = capitulosAsc[capitulosAsc.length - 1] || null;
  const novoCapLabel = useMemo(() => {
    if (!capMaisRecente) return null;
    const ts =
      Number(capMaisRecente.publicReleaseAt) > 0
        ? Number(capMaisRecente.publicReleaseAt)
        : Date.parse(capMaisRecente.dataUpload || '') || 0;
    if (!Number.isFinite(ts) || ts <= 0) return null;
    const diff = Date.now() - ts;
    if (diff < 0) return null;
    const h = diff / 3600000;
    if (h < 1) return 'Capítulo novo há menos de 1h';
    if (h < 48) return `Capítulo novo há ${Math.round(h)}h`;
    return null;
  }, [capMaisRecente]);

  const toggleFavorito = async () => {
    if (!user?.uid) {
      navigate('/login');
      return;
    }
    if (!obraId || favoriteBusy) return;
    const capa =
      String(obraParaExibir?.capaUrl || obra?.capaUrl || obraParaExibir?.coverUrl || obra?.coverUrl || '').trim();
    const slug = String(obraParaExibir?.slug || obra?.slug || obraId || '').trim();
    const payload = {
      obraId,
      workId: obraId,
      creatorId: obraCreatorId(obraParaExibir || obra),
      titulo: obraParaExibir?.titulo || obra?.titulo || obraId,
      slug,
      coverUrl: capa,
      savedAt: Date.now(),
    };
    try {
      setFavoriteBusy(true);
      setWorkActionMessage('');
      if (isFavorito) {
        await removeWorkFavoriteBoth(db, user.uid, obraId);
        setIsFavorito(false);
        return;
      }
      await saveWorkFavoriteBoth(db, user.uid, obraId, payload);
      setIsFavorito(true);
    } catch (error) {
      console.error('Erro ao salvar obra:', error);
      setWorkActionMessage('Não foi possível salvar esta obra agora.');
    } finally {
      setFavoriteBusy(false);
    }
  };

  const abrirComecar = () => {
    if (!primeiroLiberado) return;
    navigate(`/ler/${primeiroLiberado.id}`);
  };

  const abrirContinuar = () => {
    if (!continuarCap) return;
    navigate(`/ler/${continuarCap.id}`);
  };

  const abrirCriador = () => {
    if (!creatorPath) return;
    navigate(creatorPath);
  };

  const salvarAvisosObra = async () => {
    if (!user?.uid) {
      navigate('/login');
      return;
    }
    if (!obraId || workNotificationBusy) return;
    setWorkNotificationBusy(true);
    try {
      setWorkActionMessage('');
      const nextEnabled = !isSubscribedWork;
      await upsertNotificationSubscription({
        type: 'work',
        targetId: obraId,
        enabled: nextEnabled,
      });
      setIsSubscribedWork(nextEnabled);
      if (nextEnabled) {
        const perm =
          typeof window === 'undefined' || typeof Notification === 'undefined'
            ? 'unsupported'
            : Notification.permission;
        setWorkBrowserPushPermission(perm);
        setWorkBrowserPushModalOpen(true);
      }
    } catch (error) {
      console.error('Erro ao acompanhar obra:', error);
      setWorkActionMessage('Não foi possível atualizar o acompanhamento desta obra.');
    } finally {
      setWorkNotificationBusy(false);
    }
  };

  if (!idResolvido) return <div className="shito-app-splash" aria-hidden="true" />;
  if (idResolvido && !obraId) {
    return (
      <main className="obra-page">
        <section className="obra-not-found">
          <h1>Obra não encontrada</h1>
          <p>Confira o link ou volte ao catálogo.</p>
          <button type="button" onClick={() => navigate('/works')}>
            Ver obras
          </button>
        </section>
      </main>
    );
  }

  if (loading) return <div className="shito-app-splash" aria-hidden="true" />;

  if (!obraParaExibir) {
    return (
      <main className="obra-page">
        <section className="obra-not-found">
          <h1>Obra não encontrada</h1>
          <p>
            {obra && obraEstaArquivada(obra)
              ? 'Esta obra foi arquivada e não está mais no catálogo público.'
              : 'Essa obra não existe ou ainda não foi publicada.'}
          </p>
          <button type="button" onClick={() => navigate('/works')}>
            Ver obras
          </button>
        </section>
      </main>
    );
  }

  const creatorUidObra = String(creatorIdentity?.creatorId || obraCreatorId(obraParaExibir) || '').trim();
  const creatorHandle = creatorIdentity?.handle || '';
  const creatorPorLabel = creatorIdentity?.label || 'Autor';
  const creatorDisplayOnly = resolvePublicProfileDisplayName(creatorIdentity?.profile, creatorPorLabel);
  const creatorAvatar = creatorIdentity?.avatarUrl || '/assets/fotos/shito.jpg';
  const creatorPath = creatorIdentity?.path || (creatorUidObra ? `/criador/${encodeURIComponent(creatorUidObra)}` : '');
  const obraViews = Number(obraParaExibir.viewsCount || obraParaExibir.visualizacoes || 0);
  const obraLikes = Number(obraParaExibir.likesCount || obraParaExibir.curtidas || 0);

  return (
    <main className="obra-page">
      <BrowserPushPreferenceModal
        open={workBrowserPushModalOpen}
        permission={workBrowserPushPermission}
        title="Avisos no navegador"
        description="Obra acompanhada. Quer receber notificação aqui no navegador quando sair capítulo novo?"
        onClose={() => setWorkBrowserPushModalOpen(false)}
      />
      {obraSeo ? (
        <Helmet prioritizeSeoTags>
          <title>{obraSeo.title}</title>
          <meta name="description" content={obraSeo.description} />
          <meta property="og:type" content="article" />
          <meta property="og:title" content={obraSeo.title} />
          <meta property="og:description" content={obraSeo.description} />
          <meta property="og:image" content={obraSeo.image} />
          {/^https:\/\//i.test(obraSeo.image) ? (
            <meta property="og:image:secure_url" content={obraSeo.image} />
          ) : null}
          <meta property="og:image:alt" content={obraSeo.title} />
          <meta property="og:url" content={obraSeo.canonical} />
          <meta name="twitter:title" content={obraSeo.title} />
          <meta name="twitter:description" content={obraSeo.description} />
          <meta name="twitter:image" content={obraSeo.image} />
          <meta name="twitter:image:alt" content={obraSeo.title} />
          <link rel="canonical" href={obraSeo.canonical} />
          <script type="application/ld+json">{JSON.stringify(obraSeo.jsonLd)}</script>
        </Helmet>
      ) : null}
      <section className="obra-hero">
        <div
          className="obra-hero-bg"
          style={{
            backgroundImage: `url('${obraParaExibir.bannerUrl || obraParaExibir.capaUrl || '/assets/fotos/shito.jpg'}')`,
          }}
          aria-hidden="true"
        />
        <div className="obra-hero-scrim" aria-hidden="true" />
        <div className="obra-hero-content">
          <img
            className="obra-cover"
            src={obraParaExibir.capaUrl || obraParaExibir.bannerUrl || '/assets/fotos/shito.jpg'}
            alt={`Capa do mangá ${obraParaExibir.titulo || obraId}`}
            referrerPolicy="no-referrer"
            loading="lazy"
            decoding="async"
          />
          <div className="obra-info">
            <h1>{obraParaExibir.titulo || obraId}</h1>
            {novoCapLabel ? <p className="obra-novo-cap">{novoCapLabel}</p> : null}
            <div className="obra-meta">
              <span>Status: {obraParaExibir.status || 'ongoing'}</span>
              <span>Público: {obraParaExibir.publicoAlvo || 'Geral'}</span>
              <span>{capitulosAsc.length} capítulos</span>
              <span className="obra-meta-stats">
                {obraViews > 0 ? `${obraViews.toLocaleString('pt-BR')} views` : null}
                {obraViews > 0 && obraLikes > 0 ? ' · ' : null}
                {obraLikes > 0 ? `${obraLikes.toLocaleString('pt-BR')} likes` : null}
              </span>
            </div>
            {creatorHandle ? (
              <div className="obra-creator-inline">
                <button
                  type="button"
                  className="obra-creator-chip"
                  onClick={abrirCriador}
                  disabled={!creatorPath}
                >
                  <img
                    src={creatorAvatar}
                    alt={creatorPorLabel}
                    referrerPolicy="no-referrer"
                    loading="lazy"
                    decoding="async"
                  />
                  <span>por {creatorDisplayOnly}</span>
                </button>
                <button
                  type="button"
                  className="obra-creator-handle-link"
                  onClick={abrirCriador}
                  disabled={!creatorPath}
                >
                  @{creatorHandle}
                </button>
              </div>
            ) : (
              <button type="button" className="obra-creator-chip" onClick={abrirCriador} disabled={!creatorUidObra}>
                <img
                  src={creatorAvatar}
                  alt={creatorPorLabel}
                  referrerPolicy="no-referrer"
                  loading="lazy"
                  decoding="async"
                />
                <span>por {creatorPorLabel}</span>
              </button>
            )}
            <p className="obra-sinopse-label">Sinopse</p>
            <p className="obra-sinopse">{obraParaExibir.sinopse || 'Sinopse em breve.'}</p>
            <div className="obra-actions obra-actions--dual">
              <button type="button" className="btn-obra-cta btn-obra-cta--sec" onClick={abrirComecar} disabled={!primeiroLiberado}>
                Começar
              </button>
              <button type="button" className="btn-obra-cta" onClick={abrirContinuar} disabled={!continuarCap}>
                Continuar
              </button>
            </div>
            <nav className="obra-seo-nav" aria-label="Navegação do catálogo">
              <Link to="/works">Mais mangás para ler online</Link>
            </nav>
            {user?.uid ? (
              <div className="obra-notify-box">
                <strong>Receber aviso quando lançar</strong>
                <p>Ative para receber notificação quando o autor publicar um capítulo novo.</p>
                <div className="obra-notify-box__options">
                  <button type="button" className="btn-obra-fav-page" onClick={salvarAvisosObra} disabled={workNotificationBusy}>
                    {workNotificationBusy ? 'Salvando...' : isSubscribedWork ? 'Parar avisos' : 'Receber avisos'}
                  </button>
                  <button
                    type="button"
                    className={`btn-obra-fav-page ${isFavorito ? 'is-fav' : ''}`}
                    onClick={toggleFavorito}
                    disabled={favoriteBusy}
                  >
                    {favoriteBusy ? 'Salvando...' : (isFavorito ? 'Remover da biblioteca' : 'Favoritar na biblioteca')}
                  </button>
                </div>
                {workActionMessage ? <p className="obra-notify-box__error">{workActionMessage}</p> : null}
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <section className="obra-capitulos-section">
        <div className="obra-capitulos-head">
          <h2 className="obra-capitulos-title">Lista de capítulos</h2>
        </div>

        {capitulosAsc.length === 0 ? (
          <p className="obra-capitulos-empty">Essa obra ainda não possui capítulos publicados.</p>
        ) : (
          <div className="obra-capitulos-list shueisha-capitulos-list">
            {capitulosAsc.map((cap) => {
              if (!cap) return null;
              const liberado = capituloLiberadoParaUsuario(cap, user, perfil);
              const agendado = Number(cap?.publicReleaseAt || 0) > 0;
              return (
                <article
                  key={cap.id}
                  className={`obra-cap-item shito-cap-row ${liberado ? '' : 'shito-cap-row--bloqueado'}${
                    continuarCap?.id === cap.id ? ' obra-cap-item--continue' : ''
                  }`}
                  onClick={() => navigate(`/ler/${cap.id}`)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && navigate(`/ler/${cap.id}`)}
                >
                  <div className="cap-left-info">
                    <span className="shito-cap-number">#{String(cap.numero || 0).padStart(3, '0')}</span>
                    <div className="cap-main-content">
                      <div className="shito-cap-miniature-wrapper">
                        <img
                          src={cap.capaUrl || '/assets/fotos/shito.jpg'}
                          alt={cap.titulo || `Capítulo ${cap.numero}`}
                          className="shito-cap-miniature"
                          style={chapterCoverStyle(cap.capaAjuste)}
                          referrerPolicy="no-referrer"
                          loading="lazy"
                          decoding="async"
                        />
                      </div>
                      <div className="cap-text-details">
                        <h3 className="shito-cap-title">{cap.titulo || 'Capítulo sem título'}</h3>
                        {!liberado && (
                          <span className="cap-badge-em-breve">
                            Em breve · {formatarDataLancamento(cap.publicReleaseAt)}
                          </span>
                        )}
                        <div className="obra-cap-access">
                          {liberado && <span className="pill publico">Público</span>}
                          {!liberado && cap.antecipadoMembros && (
                            <span className="pill premium">Membership antecipada</span>
                          )}
                          {!liberado && !cap.antecipadoMembros && agendado && (
                            <span className="pill agendado">Agendado</span>
                          )}
                        </div>
                        <div className="cap-stats-row">
                          <span className="stat-item">👁 {Number(cap.viewsCount || cap.visualizacoes || 0)}</span>
                          {Number(cap.likesCount || 0) > 0 ? (
                            <span className="stat-item">♡ {Number(cap.likesCount || 0)}</span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="cap-right-info">
                    <time className="shito-cap-date">{formatarDataBrPartirIsoOuMs(cap.dataUpload)}</time>
                    <span className="arrow-mobile">›</span>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
