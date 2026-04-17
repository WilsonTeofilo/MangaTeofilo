import React from 'react';

import { AVATAR_FALLBACK, DISPLAY_NAME_MAX_LENGTH } from '../../../constants';
import { normalizarAcessoAvatar } from '../../../utils/avatarAccess';
import { formatarDataLongaBr } from '../../../utils/datasBr';
import { suggestUsernameFromDisplayName } from '../../../utils/usernameValidation';
import PerfilBirthDateField from './PerfilBirthDateField.jsx';
import PerfilBuyerDisclosure from './PerfilBuyerDisclosure.jsx';
import PerfilUsernameField from './PerfilUsernameField.jsx';

function formatarTempoRestanteAssinatura(memberUntil) {
  const end = Number(memberUntil);
  if (!Number.isFinite(end) || end <= 0) return { ativo: false, texto: '' };
  const diff = end - Date.now();
  if (diff <= 0) return { ativo: false, texto: '' };
  const totalHours = Math.floor(diff / 3600000);
  const dias = Math.floor(totalHours / 24);
  if (dias >= 1) {
    return { ativo: true, texto: `${dias} dia${dias === 1 ? '' : 's'} restante${dias === 1 ? '' : 's'}` };
  }
  const horas = Math.max(1, totalHours);
  return { ativo: true, texto: `${horas} hora${horas === 1 ? '' : 's'} restante${horas === 1 ? '' : 's'}` };
}

export default function PerfilReaderView(props) {
  const {
    adminAccess,
    navigate,
    handleSalvar,
    perfilAvatarPreviewSrc,
    novoNome,
    setNovoNome,
    userHandleDraft,
    setUserHandleDraft,
    usernameInputRef,
    perfilDb,
    usernameCheck,
    birthDate,
    setBirthDate,
    birthDateDraft,
    setBirthDateDraft,
    mangakaBirthInputRef,
    gender,
    setGender,
    isStaffAdmin,
    premiumAtivo,
    buyerProfileExpanded,
    setBuyerProfileExpanded,
    lojaBuyerInputs,
    premiumEntitlement,
    membershipCriadorAtiva,
    membershipsCriadorAtivas,
    readerProfilePublicDraft,
    setReaderProfilePublicDraft,
    user,
    readerPublicPath,
    podeUsarAvatarPremium,
    listaAvatares,
    avatarSelecionado,
    setAvatarSelecionado,
    setMangakaAvatarFile,
    setMangakaAvatarUrlDraft,
    avataresLiberados,
    notifyPromotions,
    setNotifyPromotions,
    notifyCommentSocial,
    setNotifyCommentSocial,
    mensagem,
    loading,
    creatorApplicationStatus,
    creatorReviewReason,
    creatorModerationAction,
    isCreatorDraft,
    isCreatorCandidate,
  } = props;

  return (
    <main className="perfil-page">
      <div className="perfil-card">
        <h1 className="perfil-title">Meu perfil</h1>
        <p className="perfil-subtitle">Atualize seus dados e preferencias da conta.</p>

        {!adminAccess.isMangaka && !adminAccess.canAccessAdmin ? (
          <div className="perfil-mangaka-apoio">
            <p className="perfil-mangaka-apoio-label">
              Quer publicar por aqui? O perfil de criador abre pagina publica, catalogo seu, capitulos, painel financeiro e
              membership por autor. O cadastro e numa pagina so - sem modal.
            </p>
            {creatorApplicationStatus === 'requested' ? (
              <>
                <p className="perfil-mangaka-apoio-label">
                  Sua solicitacao esta em analise. Voce pode abrir o mesmo fluxo para revisar o que enviou.
                </p>
                <div className="perfil-mangaka-apoio-row">
                  <button
                    type="button"
                    className="perfil-mangaka-apoio-copy perfil-creator-apply-btn"
                    onClick={() => navigate('/creator/onboarding')}
                  >
                    Ver andamento
                  </button>
                </div>
              </>
            ) : null}
            {creatorApplicationStatus === 'approved' ? (
              <p className="perfil-mangaka-apoio-label">
                Seu acesso de criador foi aprovado. Se o painel ainda nao mudou, recarregue a pagina para atualizar as
                permissoes da sua conta.
              </p>
            ) : null}
            {creatorApplicationStatus === 'rejected' ? (
              <>
                <p className="perfil-mangaka-apoio-label">
                  Sua ultima solicitacao foi recusada. {creatorReviewReason ? `Motivo: ${creatorReviewReason}. ` : ''}
                  Ajuste os dados e envie de novo pela pagina de onboarding.
                </p>
                <div className="perfil-mangaka-apoio-row">
                  <button
                    type="button"
                    className="perfil-mangaka-apoio-copy perfil-creator-apply-btn"
                    onClick={() => navigate('/creator/onboarding')}
                  >
                    Nova candidatura
                  </button>
                </div>
              </>
            ) : null}
            {creatorModerationAction === 'banned' ? (
              <p className="perfil-mangaka-apoio-label">
                Sua conta foi bloqueada pela equipe. {creatorReviewReason ? `Motivo registrado: ${creatorReviewReason}.` : ''}
              </p>
            ) : null}
            {creatorModerationAction !== 'banned' &&
            creatorApplicationStatus !== 'requested' &&
            creatorApplicationStatus !== 'approved' &&
            creatorApplicationStatus !== 'rejected' ? (
              <div className="perfil-mangaka-apoio-row perfil-mangaka-apoio-row--stack">
                {isCreatorDraft ? (
                  <p className="perfil-mangaka-apoio-label perfil-mangaka-apoio-label--full">
                    Cadastro de criador em andamento. Pode sair e voltar quando quiser - os dados ficam salvos na sua conta ate
                    voce enviar.
                  </p>
                ) : null}
                <button
                  type="button"
                  className="perfil-mangaka-apoio-copy perfil-creator-apply-btn"
                  onClick={() => navigate('/creator/onboarding')}
                >
                  {isCreatorDraft
                    ? 'Continuar cadastro'
                    : isCreatorCandidate
                      ? 'Enviar novo pedido de criador'
                      : 'Criar perfil de criador'}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        <form onSubmit={handleSalvar}>
          <div className="avatar-big-preview">
            <div className="circle-wrap">
              <img
                src={perfilAvatarPreviewSrc || AVATAR_FALLBACK}
                alt="Preview Avatar"
                onError={(e) => {
                  e.target.src = AVATAR_FALLBACK;
                }}
              />
            </div>
          </div>

          <div className="input-group">
            <label>NOME DE EXIBICAO</label>
            <input
              type="text"
              className="perfil-input"
              value={novoNome}
              onChange={(e) => setNovoNome(e.target.value)}
              maxLength={DISPLAY_NAME_MAX_LENGTH}
              placeholder="Ex.: como voce quer ser chamado na plataforma"
            />
          </div>

          <PerfilUsernameField
            id="username-handle-reader"
            userHandleDraft={userHandleDraft}
            setUserHandleDraft={setUserHandleDraft}
            usernameInputRef={usernameInputRef}
            lockedHandle={perfilDb?.userHandle}
            placeholder="ex: leitor_shonen"
            usernameCheck={usernameCheck}
            helperText="Identificador unico. Nao pode ser alterado depois de salvo. Link:"
            suggestLabel="Sugerir a partir do nome"
            onSuggest={() => {
              const suggested = suggestUsernameFromDisplayName(novoNome);
              if (suggested) setUserHandleDraft(suggested);
            }}
          />

          <PerfilBirthDateField
            birthDate={birthDate}
            setBirthDate={setBirthDate}
            birthDateDraft={birthDateDraft}
            setBirthDateDraft={setBirthDateDraft}
            birthInputRef={mangakaBirthInputRef}
            restorePreviousOnInvalidBlur
          />

          <div className="input-group">
            <label>SEXO</label>
            <select className="perfil-input" value={gender} onChange={(e) => setGender(e.target.value)}>
              <option value="nao_informado">Prefiro nao informar</option>
              <option value="masculino">Masculino</option>
              <option value="feminino">Feminino</option>
              <option value="outro">Outro</option>
            </select>
          </div>

          <div className="input-group">
            <label>TIPO DE CONTA</label>
            <div className={`account-type-badge ${isStaffAdmin ? 'admin' : premiumAtivo ? 'premium' : ''}`}>
              {isStaffAdmin ? 'Conta Admin' : premiumAtivo ? 'Conta Premium' : 'Conta Comum'}
            </div>
          </div>

          <section id="perfil-loja-dados" className="perfil-section-loja-dados">
            <PerfilBuyerDisclosure
              buyerProfileExpanded={buyerProfileExpanded}
              setBuyerProfileExpanded={setBuyerProfileExpanded}
              title="Dados para compra na loja"
              hint="Opcional - so para compras na loja (entrega fisica). Pode salvar o perfil com tudo em branco; na hora de pagar, o checkout exige endereco e documentos validos."
            >
              {lojaBuyerInputs}
            </PerfilBuyerDisclosure>
          </section>

          {premiumAtivo && typeof premiumEntitlement?.memberUntil === 'number'
            ? (() => {
                const tempo = formatarTempoRestanteAssinatura(premiumEntitlement.memberUntil);
                return (
                  <div className="input-group perfil-premium-linha">
                    <label>ASSINATURA PREMIUM</label>
                    <p className="perfil-premium-msg">
                      Ativa ate <strong>{formatarDataLongaBr(premiumEntitlement.memberUntil, { seVazio: '-' })}</strong>.
                    </p>
                    {tempo.ativo ? <p className="perfil-premium-tempo">{tempo.texto}</p> : null}
                    <p className="perfil-premium-msg perfil-premium-msg--foot">
                      Renove pelo checkout Premium da plataforma. Se entrar por um link de criador, a atribuicao financeira pode
                      mudar, mas os beneficios continuam globais.
                    </p>
                  </div>
                );
              })()
            : null}

          {membershipCriadorAtiva ? (
            <div className="input-group perfil-premium-linha">
              <label>MEMBERSHIP DE CRIADOR</label>
              <p className="perfil-premium-msg">
                Voce tem membership ativa de criador. Esse beneficio libera acesso antecipado somente nas obras dos autores
                assinados.
              </p>
              {membershipsCriadorAtivas.length > 0 ? (
                <ul className="perfil-membership-list">
                  {membershipsCriadorAtivas.map((item) => (
                    <li key={item.creatorId}>
                      <strong>{item.creatorName || item.creatorId}</strong> ate{' '}
                      <span>{formatarDataLongaBr(item.memberUntil, { seVazio: '-' })}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {!adminAccess.isMangaka ? (
            <>
              <div className="input-group notify-group">
                <label className="notify-label">
                  <input
                    type="checkbox"
                    checked={readerProfilePublicDraft}
                    onChange={(e) => setReaderProfilePublicDraft(e.target.checked)}
                  />
                  Perfil de leitor visivel publicamente
                </label>
                <p className="perfil-mangaka-apoio-label" style={{ marginTop: 8 }}>
                  Outros usuarios veem seu @username, avatar da loja abaixo e a lista de obras que voce favoritou.
                </p>
                {readerProfilePublicDraft && user?.uid ? (
                  <button
                    type="button"
                    className="perfil-mangaka-apoio-copy"
                    style={{ marginTop: 8 }}
                    onClick={() => navigate(readerPublicPath)}
                  >
                    Abrir meu perfil publico de leitor
                  </button>
                ) : null}
              </div>
              <div className="avatar-selection-section">
                <label>ESCOLHA SEU NOVO VISUAL</label>
                {!podeUsarAvatarPremium ? (
                  <p className="avatar-premium-hint">
                    Avatares com selo <strong>Premium</strong> aparecem para voce visualizar, mas so podem ser usados por
                    assinantes ativos.
                  </p>
                ) : null}
                <div className="avatar-options-grid">
                  {listaAvatares.map((item, index) => {
                    const bloqueado = normalizarAcessoAvatar(item) === 'premium' && !podeUsarAvatarPremium;
                    const ativo = avatarSelecionado === item.url;
                    return (
                      <div
                        key={item.id || index}
                        className={`avatar-option-card ${ativo ? 'active' : ''} ${bloqueado ? 'locked' : ''}`}
                        onClick={() => {
                          if (bloqueado) return;
                          setAvatarSelecionado(item.url);
                          setMangakaAvatarFile(null);
                          setMangakaAvatarUrlDraft('');
                        }}
                        title={bloqueado ? 'Disponivel apenas para conta Premium ativa' : 'Selecionar avatar'}
                      >
                        <img
                          src={item.url}
                          alt={`Opcao ${index + 1}`}
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
                <p className="avatar-selection-summary">
                  {podeUsarAvatarPremium
                    ? `Voce pode usar todos os ${listaAvatares.length} avatares disponiveis.`
                    : `Disponiveis na sua conta: ${avataresLiberados.length} de ${listaAvatares.length}.`}
                </p>
              </div>
            </>
          ) : (
            <p className="perfil-mangaka-apoio-label" style={{ marginTop: 8 }}>
              Criadores usam arquivo enviado por aqui; a grade da loja so aparece em Identidade publica, atras do painel com
              cadeado, para nao sobrescrever sua arte sem querer.
            </p>
          )}

          <div className="input-group notify-group">
            <label className="notify-label">
              <input
                type="checkbox"
                checked={notifyPromotions}
                onChange={(e) => setNotifyPromotions(e.target.checked)}
              />
              Receber promocoes e campanhas por e-mail
            </label>
          </div>
          <div className="input-group notify-group">
            <label className="notify-label">
              <input
                type="checkbox"
                checked={notifyCommentSocial}
                onChange={(e) => setNotifyCommentSocial(e.target.checked)}
              />
              Avisos no app quando alguem curtir ou responder seus comentarios em capitulos
            </label>
          </div>

          {mensagem.texto ? <p className={`feedback-msg ${mensagem.tipo}`}>{mensagem.texto}</p> : null}

          <div className="perfil-actions">
            <button type="submit" className="btn-save-perfil" disabled={loading}>
              {loading ? 'SINCRONIZANDO...' : 'SALVAR ALTERACOES'}
            </button>
            <button type="button" className="btn-cancel-perfil" onClick={() => navigate('/')}>
              CANCELAR
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
