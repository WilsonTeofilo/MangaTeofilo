import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Link, useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { httpsCallable } from 'firebase/functions';

import { db, functions } from '../../services/firebase';
import { capituloLiberadoParaUsuario, formatarDataLancamento } from '../../utils/capituloLancamento';
import { applyChapterReadDelta } from '../../utils/discoveryStats';
import { getLastRead, recordReadingProgress } from '../../utils/readingProgressLocal';
import {
  buildChapterCampaignId,
} from '../../config/obras';
import { buildLoginUrlWithRedirect } from '../../utils/loginRedirectPath';
import { formatUserDisplayWithHandle } from '../../utils/publicCreatorName';
import LoadingScreen from '../../components/LoadingScreen';
import BrowserPushPreferenceModal from '../../components/BrowserPushPreferenceModal.jsx';
import ChapterShareBar from '../../components/ChapterShareBar.jsx';
import ChapterSeo from './components/ChapterSeo.jsx';
import ChapterReleaseBlocked from './components/ChapterReleaseBlocked.jsx';
import ChapterHeader from './components/ChapterHeader.jsx';
import ReaderConfigPanel from './components/ReaderConfigPanel.jsx';
import ChapterPages from './components/ChapterPages.jsx';
import ChapterFooterNav from './components/ChapterFooterNav.jsx';
import ChapterFollowCallout from './components/ChapterFollowCallout.jsx';
import ChapterComments from './components/ChapterComments.jsx';
import { useChapterComments } from './hooks/useChapterComments';
import { useReaderControls } from './hooks/useReaderControls';
import { publicCriadorProfilePath } from './leitorUtils';
import { useChapterReaderData } from './hooks/useChapterReaderData';
import './Leitor.css';

const registrarAttributionEvento = httpsCallable(functions, 'registrarAttributionEvento');
const upsertNotificationSubscription = httpsCallable(functions, 'upsertNotificationSubscription');
const toggleChapterLikeCallable = httpsCallable(functions, 'toggleChapterLike');

export default function Leitor({ user, perfil, adminAccess }) {
  const { id }   = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const [privateProfileModal, setPrivateProfileModal] = useState(null);
  const [subscribeCurrentWorkBusy, setSubscribeCurrentWorkBusy] = useState(false);
  const [chapterBrowserPushModalOpen, setChapterBrowserPushModalOpen] = useState(false);
  const [chapterBrowserPushPermission, setChapterBrowserPushPermission] = useState('default');
  const [chapterLikeBusy, setChapterLikeBusy] = useState(false);

  const jaContouVisualizacao = useRef(false);
  const capNavErrorTimerRef = useRef(null);
  const profileToastTimerRef = useRef(null);
  const [capNavError, setCapNavError] = useState(false);
  const [profileToast, setProfileToast] = useState('');
  const chapterPageInitRef = useRef('');
  const {
    capitulo,
    setCapitulo,
    carregando,
    creatorUidApoio,
    creatorSupportEnabled,
    obraMetaLeitor,
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
  } = useChapterReaderData({
    db,
    id,
    searchParams,
    user,
    perfil,
  });
  const totalPaginas = capitulo?.paginas?.length || 0;
  const {
    modoLeitura,
    setModoLeitura,
    zoom,
    setZoom,
    paginaAtual,
    setPaginaAtual,
    setVerticalFocusIndex,
    mostrarConfig,
    setMostrarConfig,
    irProxima,
    irAnterior,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
  } = useReaderControls({ totalPaginas });
  const chapterLikesCount = Number(capitulo?.likesCount || 0);
  const chapterLikedByUser = Boolean(user?.uid && capitulo?.usuariosQueCurtiram?.[user.uid]);
  const {
    comentarioTexto,
    setComentarioTexto,
    listaComentarios,
    perfisUsuarios,
    filtro,
    setFiltro,
    enviando,
    modalLoginComentario,
    setModalLoginComentario,
    replyDraft,
    setReplyDraft,
    replyingTo,
    setReplyingTo,
    replyEnviando,
    comentariosEmThreads,
    openLoginModal,
    handleEnviarComentario,
    handleEnviarResposta,
    handleLikeComment,
    canDeleteComment,
    handleDeleteComment,
    deletingCommentId,
  } = useChapterComments({
    db,
    chapterId: id,
    capitulo,
    creatorUidApoio,
    authorUid,
    adminAccess,
    user,
    onRequireLogin: () =>
      navigate(buildLoginUrlWithRedirect(location.pathname, location.search)),
  });

  useEffect(() => {
    if (!privateProfileModal) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setPrivateProfileModal(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [privateProfileModal]);

  useEffect(() => {
    if (!modalLoginComentario) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setModalLoginComentario(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modalLoginComentario, setModalLoginComentario]);

  useEffect(() => {
    setPaginaAtual(0);
    setVerticalFocusIndex(0);
    chapterPageInitRef.current = '';
    jaContouVisualizacao.current = false;
  }, [id, searchParams, setPaginaAtual, setVerticalFocusIndex]);

  useEffect(() => {
    return () => {
      if (capNavErrorTimerRef.current) clearTimeout(capNavErrorTimerRef.current);
      if (profileToastTimerRef.current) clearTimeout(profileToastTimerRef.current);
    };
  }, []);

  const capituloParaAcesso = useMemo(() => capitulo, [capitulo]);

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
  }, [capitulo, currentWorkId, id, location.state, totalPaginas, setPaginaAtual, setVerticalFocusIndex]);

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
      !capituloLiberadoParaUsuario({ ...capitulo, id }, user, perfil)
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
  }, [authorUid, capitulo, currentWorkId, id, perfil, user, leituraAttributionRef]);

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

  const resetAndNavigate = useCallback(
    (chapterId) => {
      setPaginaAtual(0);
      setVerticalFocusIndex(0);
      navigateToChapter(chapterId, { forceStartAtPageOne: true });
    },
    [navigateToChapter, setPaginaAtual, setVerticalFocusIndex]
  );

  const handleSelectChapter = useCallback(
    (value) => {
      const v = String(value || '').trim();
      if (!v || v === id) return;
      resetAndNavigate(v);
    },
    [id, resetAndNavigate]
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
    !capituloLiberadoParaUsuario(capAcesso, user, perfil)
  ) {
    const quando = formatarDataLancamento(capitulo.publicReleaseAt);
    return (
      <ChapterReleaseBlocked
        capitulo={capitulo}
        chapterSeo={chapterSeo}
        quando={quando}
        creatorSupportEnabled={creatorSupportEnabled}
        onVoltar={() => navigate('/works')}
        onApoiar={irParaApoioDoCriador}
      />
    );
  }

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
      <ChapterSeo chapterSeo={chapterSeo} />

      <ChapterHeader
        title={capitulo.titulo}
        isLoggedIn={Boolean(user)}
        chapterLikedByUser={chapterLikedByUser}
        chapterLikeBusy={chapterLikeBusy}
        chapterLikesCount={chapterLikesCount}
        onToggleLike={handleChapterLike}
        showConfig={mostrarConfig}
        onToggleConfig={() => setMostrarConfig((v) => !v)}
      />

      {mostrarConfig && (
        <ReaderConfigPanel
          modoLeitura={modoLeitura}
          onModoChange={setModoLeitura}
          zoom={zoom}
          onZoomChange={(value) => setZoom(value)}
        />
      )}

      <ChapterPages
        modoLeitura={modoLeitura}
        paginas={capitulo.paginas}
        zoom={zoom}
        paginaAtual={paginaAtual}
        totalPaginas={totalPaginas}
        imgAltPrefix={chapterSeo?.imgAltPrefix}
        onPrev={irAnterior}
        onNext={irProxima}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      />

      <footer className="leitor-footer">
        <ChapterFooterNav
          capNavError={capNavError}
          anteriorCapituloId={anteriorCapituloId}
          proximoCapituloId={proximoCapituloId}
          capsLiberadosLista={capsLiberadosLista}
          currentId={id}
          onNavigateChapter={(chapterId) => (chapterId ? resetAndNavigate(chapterId) : null)}
          onSelectChapter={handleSelectChapter}
          onTriggerError={triggerCapNavError}
        />
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
      <ChapterFollowCallout
        isSubscribedCurrentWork={isSubscribedCurrentWork}
        subscribeCurrentWorkBusy={subscribeCurrentWorkBusy}
        onSubscribe={handleSubscribeCurrentWork}
      />

      <ChapterShareBar
        shareUrl={chapterSeo?.canonical}
        chapterTitle={chapterSeo?.title || capitulo?.titulo}
      />
      <ChapterComments
        user={user}
        perfil={perfil}
        comentarioTexto={comentarioTexto}
        onComentarioChange={setComentarioTexto}
        enviando={enviando}
        openLoginModal={openLoginModal}
        onEnviarComentario={handleEnviarComentario}
        listaComentarios={listaComentarios}
        comentariosEmThreads={comentariosEmThreads}
        filtro={filtro}
        onFiltroChange={setFiltro}
        perfisUsuarios={perfisUsuarios}
        onProfileOpen={handleCommentProfileOpen}
        onLikeComment={handleLikeComment}
        canDeleteComment={canDeleteComment}
        onDeleteComment={handleDeleteComment}
        deletingCommentId={deletingCommentId}
        replyingTo={replyingTo}
        setReplyingTo={setReplyingTo}
        replyDraft={replyDraft}
        onReplyDraftChange={setReplyDraft}
        replyEnviando={replyEnviando}
        onEnviarResposta={handleEnviarResposta}
        modalLoginComentario={modalLoginComentario}
        onCloseLoginModal={() => setModalLoginComentario(false)}
        onLoginRedirect={() => {
          setModalLoginComentario(false);
          navigate(buildLoginUrlWithRedirect(location.pathname, location.search));
        }}
        privateProfileModal={privateProfileModal}
        onClosePrivateProfileModal={() => setPrivateProfileModal(null)}
      />
    </div>
  );
}

