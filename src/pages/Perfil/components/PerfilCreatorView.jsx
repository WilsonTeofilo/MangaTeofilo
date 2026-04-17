import React from 'react';

import {
  AVATAR_FALLBACK,
  CREATOR_BIO_MAX_LENGTH,
  CREATOR_MEMBERSHIP_PRICE_MIN_BRL,
} from '../../../constants';
import { normalizarAcessoAvatar } from '../../../utils/avatarAccess';
import { normalizeUsernameInput, suggestUsernameFromDisplayName } from '../../../utils/usernameValidation';
import PerfilBirthDateField from './PerfilBirthDateField.jsx';
import PerfilBuyerDisclosure from './PerfilBuyerDisclosure.jsx';
import PerfilUsernameField from './PerfilUsernameField.jsx';

export default function PerfilCreatorView(props) {
  const {
    navigate,
    handleSalvar,
    handleCopyCreatorSupportLink,
    handleDesativarMonetizacaoClick,
    handleMonetizarContaClick,
    perfilAvatarPreviewSrc,
    creatorDisplayLabel,
    creatorHandleLocked,
    userHandleDraft,
    monetizationUiState,
    monetizationEligibility,
    creatorPublicPath,
    creatorMonetizationStatusEffective,
    mangakaFormAnchorRef,
    creatorDisplayName,
    setCreatorDisplayName,
    setNovoNome,
    creatorBio,
    setCreatorBio,
    instagramUrl,
    setInstagramUrl,
    youtubeUrl,
    setYoutubeUrl,
    lojaAvatarAuthorUnlocked,
    setLojaAvatarAuthorUnlocked,
    listaAvatares,
    podeUsarAvatarPremium,
    mangakaAvatarUrlDraft,
    mangakaAvatarFile,
    avatarSelecionado,
    setMangakaAvatarUrlDraft,
    setMangakaAvatarFile,
    setAvatarSelecionado,
    perfilDb,
    usernameInputRef,
    setUserHandleDraft,
    usernameCheck,
    novoNome,
    birthDate,
    setBirthDate,
    birthDateDraft,
    setBirthDateDraft,
    mangakaBirthInputRef,
    notifyPromotions,
    setNotifyPromotions,
    notifyCommentSocial,
    setNotifyCommentSocial,
    creatorReviewReason,
    needsFirstMonetizationApplication,
    creatorMonetizationPreference,
    creatorMembershipEnabled,
    creatorMembershipPriceBRL,
    creatorDonationSuggestedBRL,
    buyerProfileExpanded,
    setBuyerProfileExpanded,
    lojaBuyerInputs,
    mensagem,
    loading,
    underageMonetizeModalOpen,
    setUnderageMonetizeModalOpen,
    isUnderageByBirthYear,
    creatorMonetizationStatus,
  } = props;

  return (
    <main className="perfil-page perfil-page--creator">
      <div className="perfil-creator-shell">
        <section className="perfil-creator-hero">
          <div
            className="perfil-creator-hero__backdrop"
            style={{ backgroundImage: `url(${perfilAvatarPreviewSrc || AVATAR_FALLBACK})` }}
          />
          <div className="perfil-creator-hero__scrim" />
          <div className="perfil-creator-hero__content">
            <div className="perfil-creator-hero__avatar">
              <img
                src={perfilAvatarPreviewSrc || AVATAR_FALLBACK}
                alt={creatorDisplayLabel}
                onError={(e) => {
                  e.target.src = AVATAR_FALLBACK;
                }}
              />
            </div>
            <div className="perfil-creator-hero__text">
              <p className="perfil-creator-hero__eyebrow">Creator profile</p>
              <h1>{creatorDisplayLabel}</h1>
              {(creatorHandleLocked || normalizeUsernameInput(userHandleDraft)) ? (
                <p className="perfil-creator-hero__handle">
                  @{creatorHandleLocked || normalizeUsernameInput(userHandleDraft) || '...'}
                </p>
              ) : null}
              <p className="perfil-creator-hero__meta">
                {monetizationUiState.key === 'locked_by_level'
                  ? `${monetizationUiState.title} · nivel atual ${monetizationEligibility.level}`
                  : monetizationUiState.title}
              </p>
              <div className="perfil-creator-hero__actions">
                <button
                  type="button"
                  className="perfil-creator-hero__btn perfil-creator-hero__btn--primary"
                  onClick={() => navigate(creatorPublicPath)}
                >
                  Ver pagina publica
                </button>
                <div className="perfil-creator-hero__actions-secondary">
                  {creatorMonetizationStatusEffective === 'active' ? (
                    <button
                      type="button"
                      className="perfil-creator-hero__btn perfil-creator-hero__btn--secondary"
                      onClick={handleCopyCreatorSupportLink}
                    >
                      Copiar link de apoio
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="perfil-creator-hero__btn perfil-creator-hero__btn--secondary"
                    onClick={() => navigate('/creator/audience')}
                  >
                    Analytics
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="perfil-creator-cta-card perfil-creator-progress-links" id="creator-level">
          <p className="perfil-creator-progress-links__lead">
            Acompanhe seu crescimento na plataforma e complete missoes semanais para ganhar destaque.
          </p>
          <div className="perfil-creator-progress-links__row">
            <button type="button" className="perfil-mangaka-apoio-copy" onClick={() => navigate('/creator/monetizacao')}>
              Abrir monetizacao
            </button>
            <button type="button" className="perfil-mangaka-apoio-copy" onClick={() => navigate('/creator/missoes')}>
              Abrir missoes &amp; XP
            </button>
          </div>
        </div>

        <form onSubmit={handleSalvar} className="perfil-creator-form">
          <div ref={mangakaFormAnchorRef} className="perfil-mangaka-fields-anchor" aria-hidden="true" />

          <section className="perfil-creator-section" aria-labelledby="perfil-section-identidade">
            <header className="perfil-creator-section-head">
              <h2 id="perfil-section-identidade" className="perfil-creator-section-heading">
                Identidade publica
              </h2>
              <p className="perfil-creator-section-sub">
                O que os leitores veem no seu perfil de autor - nome, bio, redes e foto.
              </p>
            </header>

            <div className="input-group">
              <label>NOME NO PERFIL</label>
              <input
                type="text"
                className="perfil-input"
                value={creatorDisplayName}
                onChange={(e) => {
                  const value = e.target.value.slice(0, 60);
                  setCreatorDisplayName(value);
                  setNovoNome(value);
                }}
                placeholder="Como os leitores te reconhecem no perfil"
                maxLength={60}
              />
            </div>

            <div className="input-group">
              <label>BIO PUBLICA</label>
              <textarea
                className="perfil-input"
                rows={4}
                value={creatorBio}
                maxLength={CREATOR_BIO_MAX_LENGTH}
                onChange={(e) => setCreatorBio(e.target.value.slice(0, CREATOR_BIO_MAX_LENGTH))}
                placeholder="Conta um pouco do seu universo, do seu traco e do que voce publica por aqui."
              />
            </div>

            <div className="input-group">
              <label>INSTAGRAM</label>
              <input
                type="text"
                className="perfil-input"
                value={instagramUrl}
                onChange={(e) => setInstagramUrl(e.target.value)}
                placeholder="instagram.com/seuperfil"
              />
            </div>

            <div className="input-group">
              <label>YOUTUBE</label>
              <input
                type="text"
                className="perfil-input"
                value={youtubeUrl}
                onChange={(e) => setYoutubeUrl(e.target.value)}
                placeholder="youtube.com/@seucanal"
              />
            </div>

            <div className="perfil-loja-avatar-gate">
              <button
                type="button"
                className="perfil-loja-avatar-gate__toggle"
                onClick={() => setLojaAvatarAuthorUnlocked((value) => !value)}
                aria-expanded={lojaAvatarAuthorUnlocked}
              >
                <span className="perfil-loja-avatar-gate__icon" aria-hidden="true">
                  <i className={`fa-solid ${lojaAvatarAuthorUnlocked ? 'fa-unlock' : 'fa-lock'}`} />
                </span>
                <span>
                  {lojaAvatarAuthorUnlocked
                    ? 'Fechar grade de avatares prontos'
                    : 'Usar avatar pronto da loja (opcional)'}
                </span>
              </button>
              {!lojaAvatarAuthorUnlocked ? (
                <p className="perfil-loja-avatar-gate__hint">
                  Abra so se quiser trocar sua foto atual por um avatar pronto. Quem tem Premium continua podendo usar
                  avatares premium da loja tambem como membro.
                </p>
              ) : (
                <div className="avatar-selection-section perfil-loja-avatar-gate__grid">
                  <p className="perfil-mangaka-apoio-label" style={{ marginBottom: 8 }}>
                    Toque em uma estampa para aplicar na <strong>foto de autor</strong> ao salvar o perfil (substitui
                    URL/arquivo se voce escolher uma daqui).
                  </p>
                  <div className="avatar-options-grid">
                    {listaAvatares.map((item, index) => {
                      const bloqueado = normalizarAcessoAvatar(item) === 'premium' && !podeUsarAvatarPremium;
                      const ativo =
                        String(mangakaAvatarUrlDraft || '').trim() === item.url ||
                        (!mangakaAvatarFile && avatarSelecionado === item.url);
                      return (
                        <div
                          key={`author-shop-${item.id || index}`}
                          className={`avatar-option-card ${ativo ? 'active' : ''} ${bloqueado ? 'locked' : ''}`}
                          onClick={() => {
                            if (bloqueado) return;
                            setMangakaAvatarUrlDraft(item.url);
                            setMangakaAvatarFile(null);
                            setAvatarSelecionado(item.url);
                          }}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              if (!bloqueado) {
                                setMangakaAvatarUrlDraft(item.url);
                                setMangakaAvatarFile(null);
                                setAvatarSelecionado(item.url);
                              }
                            }
                          }}
                          title={bloqueado ? 'Disponivel apenas para conta Premium ativa' : 'Usar como foto de autor'}
                        >
                          <img
                            src={item.url}
                            alt=""
                            onError={(e) => {
                              e.target.src = AVATAR_FALLBACK;
                            }}
                          />
                          {normalizarAcessoAvatar(item) === 'premium' ? (
                            <span className="avatar-tier-tag">Premium</span>
                          ) : null}
                          {bloqueado ? <span className="avatar-lock">Bloq.</span> : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="input-group">
              <label>FOTO DE PERFIL</label>
              <p className="perfil-mangaka-apoio-label" style={{ marginBottom: 8 }}>
                Envie uma foto do seu aparelho. A versao publica e ajustada automaticamente para o seu perfil.
              </p>
              <input
                type="file"
                className="perfil-input"
                accept="image/jpeg,image/png,image/webp"
                aria-label="Enviar foto de perfil"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  setMangakaAvatarFile(file || null);
                  if (file) setMangakaAvatarUrlDraft('');
                }}
              />
            </div>
          </section>

          <section className="perfil-creator-section" aria-labelledby="perfil-section-conta">
            <header className="perfil-creator-section-head">
              <h2 id="perfil-section-conta" className="perfil-creator-section-heading">
                Conta
              </h2>
              <p className="perfil-creator-section-sub">Username unico, data de nascimento e e-mail promocional.</p>
            </header>

            <PerfilUsernameField
              id="username-handle"
              userHandleDraft={userHandleDraft}
              setUserHandleDraft={setUserHandleDraft}
              usernameInputRef={usernameInputRef}
              lockedHandle={perfilDb?.userHandle}
              placeholder="ex: teofilo_manga"
              usernameCheck={usernameCheck}
              helperText="Unico na plataforma. Depois de salvo, nao altera. URL:"
              suggestLabel="Sugerir a partir do nome no perfil"
              onSuggest={() => {
                const suggested = suggestUsernameFromDisplayName(creatorDisplayName || novoNome);
                if (suggested) setUserHandleDraft(suggested);
              }}
            />

            <PerfilBirthDateField
              birthDate={birthDate}
              setBirthDate={setBirthDate}
              birthDateDraft={birthDateDraft}
              setBirthDateDraft={setBirthDateDraft}
              birthInputRef={mangakaBirthInputRef}
            />

            <div className="input-group perfil-creator-notify-row">
              <label className="notify-label">
                <input
                  type="checkbox"
                  checked={notifyPromotions}
                  onChange={(e) => setNotifyPromotions(e.target.checked)}
                />
                Receber promocoes e campanhas por e-mail
              </label>
            </div>
            <div className="input-group perfil-creator-notify-row">
              <label className="notify-label">
                <input
                  type="checkbox"
                  checked={notifyCommentSocial}
                  onChange={(e) => setNotifyCommentSocial(e.target.checked)}
                />
                Avisos no app quando alguem curtir ou responder seus comentarios em capitulos
              </label>
            </div>
          </section>

          <section className="perfil-creator-section" aria-labelledby="perfil-section-monetizacao">
            <header className="perfil-creator-section-head">
              <h2 id="perfil-section-monetizacao" className="perfil-creator-section-heading">
                Monetizacao
              </h2>
              <p className="perfil-creator-section-sub">
                Publicar e monetizar sao etapas separadas. A equipe revisa seus dados antes de liberar qualquer repasse.
              </p>
            </header>

            <div className="perfil-creator-monetization-card">
              <p
                className={`perfil-creator-monetization-card__status${
                  monetizationUiState.key === 'financial_active'
                    ? ' perfil-creator-monetization-card__status--on'
                    : monetizationUiState.key === 'blocked_underage' ||
                        monetizationUiState.key === 'documents_rejected'
                      ? ' perfil-creator-monetization-card__status--warn'
                      : ''
                }`}
              >
                <strong>Status:</strong> {monetizationUiState.title}.
              </p>
              <p className="perfil-mangaka-apoio-label" style={{ marginTop: 10 }}>
                {monetizationUiState.detail}
              </p>
              {monetizationUiState.key === 'locked_by_level' ? (
                <p className="perfil-mangaka-apoio-label" style={{ marginTop: 10 }}>
                  Seu nivel atual: <strong>{monetizationEligibility.level}</strong>. A solicitacao documental abre no
                  nivel 2.
                </p>
              ) : null}
              {creatorReviewReason && monetizationUiState.key === 'documents_rejected' ? (
                <p className="perfil-mangaka-apoio-label" style={{ marginTop: 10 }}>
                  Motivo registrado pela equipe: <strong>{creatorReviewReason}</strong>
                </p>
              ) : null}

              <div className="perfil-creator-monetization-card__actions">
                {monetizationUiState.key === 'financial_active' ||
                monetizationUiState.key === 'documents_approved_waiting_activation' ? (
                  <button
                    type="button"
                    className="perfil-creator-monetization-toggle perfil-creator-monetization-toggle--off"
                    onClick={handleDesativarMonetizacaoClick}
                  >
                    Abrir monetizacao
                  </button>
                ) : monetizationUiState.key === 'documents_under_review' ? (
                  <button
                    type="button"
                    className="perfil-creator-monetization-toggle perfil-creator-monetization-toggle--off"
                    onClick={() => navigate('/creator/monetizacao')}
                  >
                    Ver solicitacao
                  </button>
                ) : monetizationUiState.key === 'locked_by_level' ? (
                  <button
                    type="button"
                    className="perfil-creator-monetization-toggle perfil-creator-monetization-toggle--off"
                    onClick={() => navigate('/creator/monetizacao')}
                  >
                    Ver metas
                  </button>
                ) : monetizationUiState.key === 'blocked_underage' ? (
                  <button
                    type="button"
                    className="perfil-creator-monetization-toggle perfil-creator-monetization-toggle--off"
                    onClick={handleMonetizarContaClick}
                  >
                    Ver requisitos
                  </button>
                ) : (
                  <button
                    type="button"
                    className="perfil-creator-monetization-toggle perfil-creator-monetization-toggle--on"
                    onClick={handleMonetizarContaClick}
                    disabled={monetizationUiState.canRequestNow !== true}
                  >
                    {monetizationUiState.cta}
                  </button>
                )}
              </div>

              {needsFirstMonetizationApplication && monetizationUiState.key === 'can_request_documents' ? (
                <p className="perfil-mangaka-apoio-label" style={{ marginTop: 12 }}>
                  O formulario documental ja foi liberado para sua conta. Agora envie nome legal, CPF e PIX para a equipe
                  revisar manualmente.
                </p>
              ) : null}
            </div>

            {creatorMonetizationPreference === 'monetize' && creatorMonetizationStatusEffective === 'active' ? (
              <>
                <p className="perfil-mangaka-apoio-label" style={{ marginBottom: 12 }}>
                  A parte financeira agora fica separada do perfil publico. O perfil mostra o estado da sua conta, e a equipe
                  registra o repasse no fluxo financeiro quando houver saldo disponivel.
                </p>
                <div className="input-group">
                  <label>MEMBERSHIP PUBLICA</label>
                  <p className="perfil-mangaka-apoio-label">
                    {creatorMembershipEnabled
                      ? `Ativa em sua pagina publica por R$ ${creatorMembershipPriceBRL || CREATOR_MEMBERSHIP_PRICE_MIN_BRL}.`
                      : 'Ainda nao publicada na pagina publica.'}
                  </p>
                </div>

                <div className="input-group">
                  <label>DOACAO SUGERIDA</label>
                  <p className="perfil-mangaka-apoio-label">
                    {creatorDonationSuggestedBRL
                      ? `Apoio livre sugerido em R$ ${creatorDonationSuggestedBRL}.`
                      : 'Nenhum valor sugerido configurado no momento.'}
                  </p>
                </div>
              </>
            ) : null}
          </section>

          <section
            className="perfil-creator-section perfil-creator-section--delivery"
            id="perfil-loja-dados"
            aria-labelledby="perfil-section-entrega"
          >
            <header className="perfil-creator-section-head">
              <h2 id="perfil-section-entrega" className="perfil-creator-section-heading">
                Dados de entrega (opcional)
              </h2>
              <p className="perfil-creator-section-sub">
                So para compras fisicas na loja. Pode deixar em branco ate a hora do checkout.
              </p>
            </header>
            <PerfilBuyerDisclosure
              buyerProfileExpanded={buyerProfileExpanded}
              setBuyerProfileExpanded={setBuyerProfileExpanded}
              title="Dados para compra na loja"
              hint="Opcional - so para compras na loja (entrega fisica). Pode salvar o perfil com tudo em branco; na hora de pagar, o checkout exige endereco e documentos validos."
            >
              {lojaBuyerInputs}
            </PerfilBuyerDisclosure>
          </section>

          {mensagem.texto ? <p className={`feedback-msg ${mensagem.tipo}`}>{mensagem.texto}</p> : null}

          <div className="perfil-creator-actions">
            <div className="perfil-actions perfil-actions--creator-save">
              <button type="submit" className="btn-save-perfil btn-save-perfil--creator" disabled={loading}>
                {loading ? 'SALVANDO...' : 'SALVAR PERFIL'}
              </button>
              <button type="button" className="btn-cancel-perfil" onClick={() => navigate('/')}>
                Voltar
              </button>
            </div>
          </div>
        </form>

        {underageMonetizeModalOpen ? (
          <div
            className="perfil-modal-root"
            role="presentation"
            onClick={(e) => e.target === e.currentTarget && setUnderageMonetizeModalOpen(false)}
          >
            <div className="perfil-modal" role="dialog" aria-modal="true" aria-labelledby="perfil-underage-mz-title">
              <h2 id="perfil-underage-mz-title" className="perfil-modal__title">
                Monetizacao indisponivel (idade)
              </h2>
              <div className="perfil-modal__body">
                <p>
                  Na MangaTeofilo, <strong>repasses financeiros</strong> (CPF, chave PIX, contrato de criador) exigem{' '}
                  <strong>maioridade (18 anos ou mais)</strong>, por exigencia legal e politica da plataforma.
                </p>
                {isUnderageByBirthYear ? (
                  <p>
                    A <strong>data de nascimento</strong> que voce informou acima indica menos de 18 anos. Voce pode continuar{' '}
                    <strong>publicando obras</strong> normalmente; quando for maior de idade, volte aqui e solicite monetizacao.
                  </p>
                ) : null}
                {creatorMonetizationStatus === 'blocked_underage' ? (
                  <p>
                    Sua conta esta com monetizacao <strong>bloqueada por idade</strong> no cadastro. Se a data de nascimento
                    estiver errada, corrija o campo <strong>Data de nascimento</strong> nesta pagina, salve o perfil e aguarde
                    analise da equipe, se aplicavel.
                  </p>
                ) : null}
                <p className="perfil-modal__hint">
                  Duvidas ou correcao de dados: use o suporte da plataforma ou fale com a equipe pelo canal oficial.
                </p>
              </div>
              <div className="perfil-modal__actions">
                <button type="button" className="btn-cancel-perfil" onClick={() => setUnderageMonetizeModalOpen(false)}>
                  Fechar
                </button>
                <button
                  type="button"
                  className="btn-save-perfil"
                  onClick={() => {
                    setUnderageMonetizeModalOpen(false);
                    mangakaBirthInputRef.current?.focus?.();
                    mangakaBirthInputRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
                  }}
                >
                  Ir para data de nascimento
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
