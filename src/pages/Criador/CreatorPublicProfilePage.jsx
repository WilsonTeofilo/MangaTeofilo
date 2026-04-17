import React, { useRef } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { db, functions, storage } from '../../services/firebase';
import BrowserPushPreferenceModal from '../../components/BrowserPushPreferenceModal.jsx';
import CreatorFollowersModal from './components/CreatorFollowersModal.jsx';
import CreatorHero from './components/CreatorHero.jsx';
import CreatorProfileTabs from './components/CreatorProfileTabs.jsx';
import CreatorSupportSection from './components/CreatorSupportSection.jsx';
import CreatorWorksSection from './components/CreatorWorksSection.jsx';
import CreatorFavoritesSection from './components/CreatorFavoritesSection.jsx';
import { useCreatorPublicProfileData } from './hooks/useCreatorPublicProfileData';
import { useCreatorPublicProfileViewModel } from './hooks/useCreatorPublicProfileViewModel';
import './CriadorPublico.css';

export default function CreatorPublicProfilePage({ user }) {
  const { creatorId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const obrasSectionRef = useRef(null);
  const creatorLookup = String(creatorId || '').trim();

  const {
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
  } = useCreatorPublicProfileData({ db, storage, creatorLookup });

  const {
    sortObras,
    setSortObras,
    redes,
    chapterCoverResolved,
    obrasComStats,
    creatorStats,
    readerPublic,
    profileMode,
    publicLine,
    bio,
    avatar,
    heroBackdropUrl,
    supportEnabled,
    membershipEnabled,
    membershipPrice,
    donationSuggested,
    canFollow,
    isFollowing,
    followBusy,
    followMessage,
    followersModalOpen,
    followersBusy,
    followersError,
    followersList,
    privateFollowerModal,
    setPrivateFollowerModal,
    followBrowserPushModalOpen,
    followBrowserPushPermission,
    setFollowBrowserPushModalOpen,
    handleToggleFollow,
    handleOpenFollowersModal,
    handleFollowerProfileOpen,
    closeFollowersModal,
    favoritesList,
    profileTab,
    readerSinceLabel,
    obrasSorted,
    favoritesPublicVisible,
    perfilBloqueado,
    handleSupport,
    handleViewWorks,
    handleViewLikes,
    handleCatalog,
    handleOpenWork,
    handleOpenFavorite,
  } = useCreatorPublicProfileViewModel({
    db,
    functions,
    navigate,
    searchParams,
    setSearchParams,
    user,
    perfilPublico,
    obras,
    capitulos,
    creatorStatsRow,
    setCreatorStatsRow,
    setPerfilPublico,
    favoritesMap,
    chapterCoverOverrides,
    creatorUid,
    obrasSectionRef,
  });

  if (!creatorLookup) {
    return (
      <main className="criador-page">
        <section className="criador-empty">
          <h1>Criador nao encontrado</h1>
          <p>O link publico informado esta incompleto.</p>
        </section>
      </main>
    );
  }

  if (!creatorUid) {
    if (!creatorIdentityReady) {
      return <div className="shito-app-splash" aria-hidden="true" />;
    }
    return (
      <main className="criador-page">
        <section className="criador-empty">
          <h1>Criador nao encontrado</h1>
          <p>Nao encontramos este perfil publico pelo link informado.</p>
          <button type="button" onClick={() => navigate('/works')}>
            Voltar ao catalogo
          </button>
        </section>
      </main>
    );
  }

  if (!publicoReady || !obrasReady || !capitulosReady || !favoritesReady) {
    return <div className="shito-app-splash" aria-hidden="true" />;
  }

  if (perfilBloqueado) {
    return (
      <main className="criador-page">
        <section className="criador-empty">
          <h1>Perfil indisponivel</h1>
          <p>Este perfil publico nao esta acessivel no momento.</p>
        </section>
      </main>
    );
  }

  if (profileMode === 'none') {
    return (
      <main className="criador-page">
        <section className="criador-empty">
          <h1>Perfil privado</h1>
          <p>Este usuario nao deixou o perfil publico disponivel.</p>
        </section>
      </main>
    );
  }

  return (
    <main className={`criador-page${profileMode === 'reader' ? ' criador-page--reader' : ''}`}>
      <BrowserPushPreferenceModal
        open={followBrowserPushModalOpen}
        permission={followBrowserPushPermission}
        title="Avisos no navegador"
        description="Voce passou a seguir este criador. Quer receber notificacao aqui no navegador quando sair capitulo novo?"
        onClose={() => setFollowBrowserPushModalOpen(false)}
      />
      <CreatorFollowersModal
        open={followersModalOpen}
        onClose={closeFollowersModal}
        followersBusy={followersBusy}
        followersError={followersError}
        followersList={followersList}
        followersCountLabel={`${creatorStats.followersCount} perfil(is) acompanhando este escritor.`}
        onFollowerClick={handleFollowerProfileOpen}
        privateFollowerModal={privateFollowerModal}
        onClosePrivateModal={() => setPrivateFollowerModal(null)}
      />
      <CreatorHero
        profileMode={profileMode}
        publicLine={publicLine}
        bio={bio}
        avatar={avatar}
        heroBackdropUrl={heroBackdropUrl}
        canFollow={canFollow}
        followBusy={followBusy}
        isFollowing={isFollowing}
        onToggleFollow={handleToggleFollow}
        supportEnabled={supportEnabled}
        onSupport={handleSupport}
        onViewWorks={handleViewWorks}
        onViewLikes={handleViewLikes}
        onCatalog={handleCatalog}
        followMessage={followMessage}
        creatorStats={creatorStats}
        obrasCount={obrasComStats.length}
        membershipEnabled={membershipEnabled}
        membershipPrice={membershipPrice}
        donationSuggested={donationSuggested}
        readerSinceLabel={readerSinceLabel}
        favoritesCount={favoritesList.length}
        readerPublic={readerPublic}
        redes={redes}
        onOpenFollowersModal={() => handleOpenFollowersModal()}
      />

      <CreatorProfileTabs
        profileMode={profileMode}
        profileTab={profileTab}
        onTabChange={(tab) => setSearchParams({ tab })}
      />

      {profileMode === 'writer' ? (
        <CreatorSupportSection
          supportEnabled={supportEnabled}
          membershipEnabled={membershipEnabled}
          membershipPrice={membershipPrice}
          donationSuggested={donationSuggested}
          onSupport={handleSupport}
        />
      ) : null}

      {profileMode === 'writer' && profileTab === 'works' ? (
        <CreatorWorksSection
          sectionRef={obrasSectionRef}
          obrasSorted={obrasSorted}
          obrasCount={obrasComStats.length}
          sortObras={sortObras}
          onSortChange={setSortObras}
          workCoverOverrides={workCoverOverrides}
          chapterCoverResolved={chapterCoverResolved}
          onOpenWork={handleOpenWork}
        />
      ) : null}

      {profileTab === 'likes' ? (
        <CreatorFavoritesSection
          profileMode={profileMode}
          favoritesPublicVisible={favoritesPublicVisible}
          favoritesList={favoritesList}
          workCoverOverrides={workCoverOverrides}
          chapterCoverResolved={chapterCoverResolved}
          onOpenFavorite={handleOpenFavorite}
        />
      ) : null}
    </main>
  );
}
