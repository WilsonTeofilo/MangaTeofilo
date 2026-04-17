import React from 'react';

import { AVATAR_FALLBACK } from '../../../constants';
import { applyImageFallback, formatarPrecoBrl } from '../creatorPublicProfileUtils';

export default function CreatorHero({
  profileMode,
  publicLine,
  bio,
  avatar,
  heroBackdropUrl,
  canFollow,
  followBusy,
  isFollowing,
  onToggleFollow,
  supportEnabled,
  onSupport,
  onViewWorks,
  onViewLikes,
  onCatalog,
  followMessage,
  creatorStats,
  obrasCount,
  membershipEnabled,
  membershipPrice,
  donationSuggested,
  readerSinceLabel,
  favoritesCount,
  readerPublic,
  redes,
  onOpenFollowersModal,
}) {
  return (
    <section className={`criador-hero criador-hero--blur-backdrop${profileMode === 'reader' ? ' criador-hero--reader' : ''}`}>
      <div className="criador-hero__backdrop" aria-hidden="true">
        <div
          className="criador-hero__backdrop-img"
          style={{ backgroundImage: `url(${heroBackdropUrl})` }}
        />
        <div className="criador-hero__backdrop-scrim" />
      </div>
      <div className="criador-hero__foreground">
        <div className="criador-hero__avatar">
          <img
            src={avatar}
            alt={publicLine}
            referrerPolicy="no-referrer"
            onError={(e) => applyImageFallback(e, AVATAR_FALLBACK)}
          />
        </div>
        <div className="criador-hero__content">
          <span className={`criador-hero__pill${profileMode === 'reader' ? ' criador-hero__pill--reader' : ''}`}>
            {profileMode === 'writer' ? 'Escritor' : 'Leitor'}
          </span>
          <h1 className="criador-hero__title-line">{publicLine}</h1>
          {bio ? <p className="criador-hero__bio">{bio}</p> : null}
          <div className="criador-hero__actions">
            {canFollow ? (
              <button type="button" className={isFollowing ? 'is-secondary' : ''} disabled={followBusy} onClick={onToggleFollow}>
                {followBusy ? 'Atualizando...' : isFollowing ? 'Seguindo' : 'Seguir'}
              </button>
            ) : null}
            {supportEnabled ? (
              <button type="button" onClick={onSupport}>
                Apoie-me
              </button>
            ) : null}
            {profileMode === 'writer' ? (
              <button type="button" className="is-secondary" onClick={onViewWorks}>
                Ver obras
              </button>
            ) : (
              <button type="button" className="is-secondary is-reader-accent" onClick={onViewLikes}>
                Ver curtidas
              </button>
            )}
            <button type="button" className="is-secondary" onClick={onCatalog}>
              Catalogo geral
            </button>
          </div>
          {followMessage ? <p className="criador-hero__support-copy">{followMessage}</p> : null}
          {profileMode === 'writer' ? (
            <>
              <div className="criador-stats-grid">
                <article>
                  <button type="button" className="criador-stat-button" onClick={onOpenFollowersModal}>
                    <strong>{creatorStats.followersCount}</strong>
                    <span>seguidores</span>
                  </button>
                </article>
                <article>
                  <strong>{obrasCount}</strong>
                  <span>obras publicas</span>
                </article>
                <article>
                  <strong>{creatorStats.totalViews}</strong>
                  <span>views (obras)</span>
                </article>
                <article>
                  <strong>{membershipEnabled ? formatarPrecoBrl(membershipPrice) : '-'}</strong>
                  <span>{membershipEnabled ? 'membership /30d' : 'apoio indisponivel'}</span>
                </article>
              </div>
              <p className="criador-hero__support-copy">
                Seguir este escritor ajuda a plataforma a destacar lancamentos e novidades quando estiverem ativas.
              </p>
              {!supportEnabled ? (
                <p className="criador-hero__support-copy">
                  Este escritor esta em modo &quot;so publicar&quot;. Apoio e membership ainda nao estao disponiveis.
                </p>
              ) : null}
            </>
          ) : (
            <>
              <div className="criador-stats-grid criador-stats-grid--reader">
                <article>
                  <strong>{readerSinceLabel}</strong>
                  <span>membro desde</span>
                </article>
                <article>
                  <strong>{favoritesCount}</strong>
                  <span>obras curtidas</span>
                </article>
                <article>
                  <strong>{readerPublic ? 'ativo' : 'fechado'}</strong>
                  <span>perfil publico</span>
                </article>
              </div>
              <p className="criador-hero__support-copy">
                Este perfil publico de leitor mostra apenas os dados basicos disponibilizados pelo usuario.
              </p>
            </>
          )}
          {membershipEnabled ? (
            <p className="criador-hero__support-copy">
              <strong>Membership:</strong> {formatarPrecoBrl(membershipPrice)} a cada 30 dias - acesso antecipado nas obras
              deste escritor. Doacao sugerida: {formatarPrecoBrl(donationSuggested)}.
            </p>
          ) : null}
          {redes.length ? (
            <div className="criador-hero__links">
              {redes.map((rede) => (
                <a key={rede.id} href={rede.href} target="_blank" rel="noreferrer">
                  {rede.label}
                </a>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
