import React, { useEffect, useMemo, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { httpsCallable } from 'firebase/functions';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';

import { db, functions } from '../../services/firebase';
import { isAdminUser } from '../../constants';
import { emptyAdminAccess } from '../../auth/adminAccess';
import {
  OBRA_PADRAO_ID,
  OBRA_SHITO_DEFAULT,
  ensureLegacyShitoObra,
  normalizarObraId,
  obterObraIdCapitulo,
  obraCreatorId,
  obraSegmentoUrlPublica,
  resolverObraIdPorSlugOuId,
  slugifyObraSlug,
} from '../../config/obras';
import { capituloLiberadoParaUsuario, formatarDataLancamento } from '../../utils/capituloLancamento';
import { formatarDataBrPartirIsoOuMs } from '../../utils/datasBr';
import { chapterCoverStyle } from '../../utils/chapterCoverStyle';
import { toRecordList } from '../../utils/firebaseRecordList';
import { removeWorkFavoriteBoth, saveWorkFavoriteBoth } from '../../utils/workFavorites';
import { obraEstaArquivada } from '../../utils/obraCatalogo';
import { buildObraPageSeo } from '../../seo/applyObraPageSeo';
import BrowserPushPreferenceModal from '../../components/BrowserPushPreferenceModal.jsx';
import './ObraDetalhe.css';

function usuarioPodeVerObraArquivada(user, adminAccess, obra) {
  if (!obraEstaArquivada(obra)) return true;
  if (!user?.uid) return false;
  if (isAdminUser(user)) return true;
  if (adminAccess?.canAccessAdmin && !adminAccess?.isMangaka) return true;
  return obraCreatorId(obra) === user.uid;
}

function chapterSort(a, b) {
  const nA = Number(a?.numero || 0);
  const nB = Number(b?.numero || 0);
  if (nA !== nB) return nB - nA;
  const dA = Date.parse(a?.dataUpload || '');
  const dB = Date.parse(b?.dataUpload || '');
  return (Number.isFinite(dB) ? dB : 0) - (Number.isFinite(dA) ? dA : 0);
}

/** Rota `/obra/:obraId` ou `/work/:slug` (slug ou id). */
export default function ObraDetalhe({ user, perfil, adminAccess = emptyAdminAccess() }) {
  const params = useParams();
  const routeObraId = params.obraId;
  const routeSlug = params.slug;
  const navigate = useNavigate();
  const location = useLocation();

  const [obraId, setObraId] = useState(null);
  const [idResolvido, setIdResolvido] = useState(false);

  const [loading, setLoading] = useState(true);
  const [obra, setObra] = useState(null);
  const [capitulos, setCapitulos] = useState([]);
  const [isFavorito, setIsFavorito] = useState(false);
  const [creatorProfile, setCreatorProfile] = useState(null);
  const [isSubscribedWork, setIsSubscribedWork] = useState(false);
  const [workNotificationBusy, setWorkNotificationBusy] = useState(false);
  const [workBrowserPushModalOpen, setWorkBrowserPushModalOpen] = useState(false);
  const [workBrowserPushPermission, setWorkBrowserPushPermission] = useState('default');
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

  /** Redireciona `/obra/shito`, `/work/shito`, `/work/kokuin` → `/work/{slug-canônico}` (SEO) sem mudar `obras/shito` no RTDB. */
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
    if (parts[0] === 'obra' && parts[1]) {
      const legacyId = normalizarObraId(decodeURIComponent(parts[1]));
      if (legacyId === normalizarObraId(obraParaExibir.id)) {
        navigate(target, { replace: true });
      }
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
    if (routeObraId) {
      setObraId(normalizarObraId(routeObraId));
      setIdResolvido(true);
      return;
    }
    if (routeSlug) {
      setIdResolvido(false);
      const raw = decodeURIComponent(String(routeSlug || ''));
      const unsub = onValue(ref(db, 'obras'), (snapshot) => {
        const list = snapshot.exists() ? ensureLegacyShitoObra(toRecordList(snapshot.val())) : [];
        const resolved = resolverObraIdPorSlugOuId(list, raw);
        setObraId(resolved);
        setIdResolvido(true);
      });
      return () => unsub();
    }
    setObraId(null);
    setIdResolvido(true);
  }, [routeObraId, routeSlug]);

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
      } else if (obraId === OBRA_PADRAO_ID) {
        setObra({ ...OBRA_SHITO_DEFAULT, id: OBRA_PADRAO_ID });
      } else {
        setObra(null);
      }
      loadingObra = false;
      concluir();
    }, () => {
      if (obraId === OBRA_PADRAO_ID) {
        setObra({ ...OBRA_SHITO_DEFAULT, id: OBRA_PADRAO_ID });
      } else {
        setObra(null);
      }
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
    const base = `usuarios/${user.uid}`;
    let leg = false;
    let mod = false;
    const sync = () => setIsFavorito(leg || mod);
    const u1 = onValue(ref(db, `${base}/favoritosObras/${obraId}`), (s) => {
      leg = s.exists();
      sync();
    });
    const u2 = onValue(ref(db, `${base}/favorites/${obraId}`), (s) => {
      mod = s.exists();
      sync();
    });
    return () => {
      u1();
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

  useEffect(() => {
    const creatorId = obraCreatorId(obra);
    if (!creatorId) {
      setCreatorProfile(null);
      return () => {};
    }
    const unsub = onValue(ref(db, `usuarios_publicos/${creatorId}`), (snapshot) => {
      setCreatorProfile(snapshot.exists() ? snapshot.val() || null : null);
    });
    return () => unsub();
  }, [obra]);

  const capitulosResolvidos = useMemo(() => {
    const fallbackCreatorId = obraCreatorId(obra);
    return capitulos.map((cap) => (
      cap?.creatorId ? cap : { ...cap, creatorId: fallbackCreatorId }
    ));
  }, [capitulos, obra]);

  const fallbackCriadorObra = obraCreatorId(obra);
  const capituloCTA = useMemo(
    () =>
      capitulosResolvidos.find((cap) =>
        capituloLiberadoParaUsuario(cap, user, perfil, { creatorIdFallback: fallbackCriadorObra })
      ) ||
      capitulosResolvidos[0] ||
      null,
    [capitulosResolvidos, user, perfil, fallbackCriadorObra]
  );

  const toggleFavorito = async () => {
    if (!user?.uid) {
      navigate('/login');
      return;
    }
    if (!obraId) return;
    const payload = {
      obraId,
      workId: obraId,
      creatorId: obraCreatorId(obraParaExibir || obra),
      titulo: obraParaExibir?.titulo || obra?.titulo || obraId,
      savedAt: Date.now(),
    };
    if (isFavorito) {
      await removeWorkFavoriteBoth(db, user.uid, obraId);
      return;
    }
    await saveWorkFavoriteBoth(db, user.uid, obraId, payload);
  };

  const abrirCTA = () => {
    if (!capituloCTA) return;
    navigate(`/ler/${capituloCTA.id}`);
  };

  const abrirCriador = () => {
    const alvo = obraParaExibir || obra;
    navigate(`/criador/${encodeURIComponent(obraCreatorId(alvo))}`);
  };

  const salvarAvisosObra = async () => {
    if (!user?.uid) {
      navigate('/login');
      return;
    }
    setWorkNotificationBusy(true);
    try {
      const nextEnabled = !isSubscribedWork;
      await upsertNotificationSubscription({
        type: 'work',
        targetId: obraId,
        enabled: nextEnabled,
      });
      if (nextEnabled) {
        const perm =
          typeof window === 'undefined' || typeof Notification === 'undefined'
            ? 'unsupported'
            : Notification.permission;
        setWorkBrowserPushPermission(perm);
        setWorkBrowserPushModalOpen(true);
      }
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

  const creatorUidObra = obraCreatorId(obraParaExibir);

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
          <meta property="og:url" content={obraSeo.canonical} />
          <meta name="twitter:title" content={obraSeo.title} />
          <meta name="twitter:description" content={obraSeo.description} />
          <meta name="twitter:image" content={obraSeo.image} />
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
          />
          <div className="obra-info">
            <h1>{obraParaExibir.titulo || obraId}</h1>
            <div className="obra-meta">
              <span>Status: {obraParaExibir.status || 'ongoing'}</span>
              <span>Público: {obraParaExibir.publicoAlvo || 'Geral'}</span>
              <span>{capitulos.length} capítulos</span>
            </div>
            <button type="button" className="obra-creator-chip" onClick={abrirCriador}>
              <img
                src={creatorProfile?.userAvatar || '/assets/fotos/shito.jpg'}
                alt={creatorProfile?.creatorDisplayName || creatorProfile?.userName || 'Criador'}
              />
              <span>por {creatorProfile?.creatorDisplayName || creatorProfile?.userName || 'Criador'}</span>
            </button>
            <p className="obra-sinopse-label">Sinopse</p>
            <p className="obra-sinopse">{obraParaExibir.sinopse || 'Sinopse em breve.'}</p>
            <div className="obra-actions">
              <button type="button" className="btn-obra-cta" onClick={abrirCTA} disabled={!capituloCTA}>
                Ler agora
              </button>
              <button type="button" className={`btn-obra-fav-page ${isFavorito ? 'is-fav' : ''}`} onClick={toggleFavorito}>
                {isFavorito ? '★ Desfavoritar' : '☆ Favoritar'}
              </button>
              <Link className="btn-obra-fav-page" to={`/criador/${encodeURIComponent(creatorUidObra)}`}>
                Ver criador
              </Link>
            </div>
            <nav className="obra-seo-nav" aria-label="Navegação do catálogo">
              <Link to="/works">Mais mangás para ler online</Link>
              <span aria-hidden="true"> · </span>
              <Link to={`/criador/${encodeURIComponent(creatorUidObra)}`}>Página do autor</Link>
            </nav>
            {user?.uid ? (
              <div className="obra-notify-box">
                <strong>Acompanhar esta obra</strong>
                <p>Quando voce acompanha uma obra, os novos capitulos passam a cair automaticamente no sino.</p>
                <div className="obra-notify-box__options">
                  <button type="button" className="btn-obra-fav-page" onClick={salvarAvisosObra} disabled={workNotificationBusy}>
                    {workNotificationBusy ? 'Salvando...' : isSubscribedWork ? 'Parar de acompanhar' : 'Acompanhar obra'}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <section className="obra-capitulos-section">
        <div className="obra-capitulos-head">
          <h2 className="obra-capitulos-title">Lista de capítulos</h2>
        </div>

        {capitulos.length === 0 ? (
          <p className="obra-capitulos-empty">Essa obra ainda não possui capítulos publicados.</p>
        ) : (
          <div className="obra-capitulos-list shueisha-capitulos-list">
            {capitulosResolvidos.map((cap) => {
              if (!cap) return null;
              const liberado = capituloLiberadoParaUsuario(cap, user, perfil, {
                creatorIdFallback: fallbackCriadorObra,
              });
              const agendado = Number(cap?.publicReleaseAt || 0) > 0;
              return (
                <article
                  key={cap.id}
                  className={`obra-cap-item shito-cap-row ${liberado ? '' : 'shito-cap-row--bloqueado'}`}
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
                          <span className="stat-item">👁 {Number(cap.visualizacoes || 0)}</span>
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
