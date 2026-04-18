import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { httpsCallable } from 'firebase/functions';

import { canAccessAdminPath } from '../../auth/adminPermissions';
import { functions } from '../../services/firebase';
import { mensagemErroCallable } from '../../utils/firebaseCallableError';
import { formatarDataHoraBr } from '../../utils/datasBr';
import { lockBodyScroll, unlockBodyScroll } from '../../utils/bodyScrollLock';
import {
  ageFromBirthDateLocal,
  formatBirthDateIsoToBr,
  parseBirthDateLocal,
} from '../../utils/birthDateAge';
import { formatCpfForDisplay, isValidBrazilianCpfDigits } from '../../utils/cpfValidate';
import { evaluateMonetizationComplianceAdmin } from '../../utils/monetizationComplianceGate';
import {
  evaluateCreatorApplicationApprovalGate,
  formatMetricDeltaLine,
} from '../../utils/creatorApplicationGate';
import './FinanceiroAdmin.css';
import './AdminStaff.css';
import './CriadoresAdmin.css';
import { formatUserDisplayFromMixed } from '../../utils/publicCreatorName';

const adminListCreatorApplications = httpsCallable(functions, 'adminListCreatorApplications');
const adminApproveCreatorApplication = httpsCallable(functions, 'adminApproveCreatorApplication');
const adminRejectCreatorApplication = httpsCallable(functions, 'adminRejectCreatorApplication');
const adminApproveCreatorMonetization = httpsCallable(functions, 'adminApproveCreatorMonetization');
const adminRejectCreatorMonetization = httpsCallable(functions, 'adminRejectCreatorMonetization');
const adminRecordCreatorPixPayout = httpsCallable(functions, 'adminRecordCreatorPixPayout');

function brl(v) {
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function statusLabel(status) {
  const norm = String(status || '').trim().toLowerCase();
  if (norm === 'requested') return 'Pendente';
  if (norm === 'approved') return 'Aprovado';
  if (norm === 'rejected') return 'Rejeitado';
  if (norm === 'draft') return 'Rascunho';
  return norm || 'Indefinido';
}

function statusBadgeClass(status) {
  const norm = String(status || '').trim().toLowerCase();
  if (norm === 'requested') return 'criadores-admin-badge criadores-admin-badge--pending';
  if (norm === 'approved') return 'criadores-admin-badge criadores-admin-badge--approved';
  if (norm === 'rejected') return 'criadores-admin-badge criadores-admin-badge--rejected';
  return 'criadores-admin-badge criadores-admin-badge--muted';
}

function wantsMonetization(item) {
  const nestedMon = item?.creatorProfile?.monetization;
  const nestedApplicationStatus = String(nestedMon?.applicationStatus || '').trim().toLowerCase();
  const nestedPreference = String(nestedMon?.preference || '').trim().toLowerCase();
  return (
    nestedApplicationStatus === 'pending' ||
    nestedApplicationStatus === 'approved' ||
    nestedApplicationStatus === 'rejected' ||
    nestedPreference === 'monetize' ||
    String(item?.creatorMonetizationApplicationStatus || '').trim().toLowerCase() === 'pending' ||
    String(item?.creatorMonetizationApplicationStatus || '').trim().toLowerCase() === 'approved' ||
    String(item?.creatorMonetizationApplicationStatus || '').trim().toLowerCase() === 'rejected' ||
    item?.creatorApplication?.monetizationRequested === true ||
    String(item?.creatorMonetizationPreference || '').trim().toLowerCase() === 'monetize'
  );
}

function creatorPublicProfileOf(item) {
  return item?.creatorProfile && typeof item.creatorProfile === 'object' ? item.creatorProfile : {};
}

function creatorMonetizationOf(item) {
  const creatorProfile = creatorPublicProfileOf(item);
  return creatorProfile?.monetization && typeof creatorProfile.monetization === 'object'
    ? creatorProfile.monetization
    : {};
}

function creatorSocialOf(item) {
  const creatorProfile = creatorPublicProfileOf(item);
  const social = creatorProfile?.socialLinks && typeof creatorProfile.socialLinks === 'object'
    ? creatorProfile.socialLinks
    : {};
  return {
    instagramUrl: String(social.instagramUrl || item?.creatorInstagramUrl || '').trim(),
    youtubeUrl: String(social.youtubeUrl || item?.creatorYoutubeUrl || '').trim(),
  };
}

function creatorBannerUrlOf(item) {
  const creatorProfile = creatorPublicProfileOf(item);
  return String(creatorProfile?.bannerUrl || item?.creatorBannerUrl || '').trim();
}

function creatorAvatarUrlOf(item) {
  const creatorProfile = creatorPublicProfileOf(item);
  return String(
    item?.creatorApplication?.profileImageUrl ||
      item?.creatorPendingProfileImageUrl ||
      creatorProfile?.avatarUrl ||
      item?.userAvatar ||
      ''
  ).trim();
}

/** Comparativo Nivel 1 (vitrine) - dados vem do callable ou recalculados se faltar campo. */
function creatorApprovalGateFromItem(item) {
  if (item?.creatorApprovalMetrics && item?.creatorApprovalThresholds) {
    return {
      ok: Boolean(item.creatorApprovalMetricsOk),
      metrics: item.creatorApprovalMetrics,
      thresholds: item.creatorApprovalThresholds,
      shortfalls: item.creatorApprovalShortfalls || { followers: 0, views: 0, likes: 0 },
      surplus: item.creatorApprovalSurplus || { followers: 0, views: 0, likes: 0 },
    };
  }
  return evaluateCreatorApplicationApprovalGate(item, item?.creatorStats || null);
}

function pixTypeLabel(t) {
  const k = String(t || '').toLowerCase();
  const m = { cpf: 'CPF', email: 'E-mail', phone: 'Telefone', random: 'Chave aleatoria' };
  return m[k] || (k ? k : '--');
}

function accountAgeInfo(item) {
  const iso = String(item?.birthDate || '').trim();
  if (iso && parseBirthDateLocal(iso)) {
    const age = ageFromBirthDateLocal(iso);
    return {
      birthDisplay: formatBirthDateIsoToBr(iso),
      age,
      isAdult: age != null && age >= 18,
      approx: false,
    };
  }
  const y = Number(item?.birthYear);
  if (Number.isFinite(y) && y >= 1900) {
    const approx = new Date().getFullYear() - y;
    return {
      birthDisplay: `Somente ano: ${y}`,
      age: approx,
      isAdult: approx >= 18,
      approx: true,
    };
  }
  return { birthDisplay: '--', age: null, isAdult: null, approx: false };
}

function CreatorDetailDrawer({
  item,
  onClose,
  rowBusy,
  rejectReason,
  onRejectReasonChange,
  rejectBan,
  onRejectBanChange,
  monetizationReason,
  onMonetizationReasonChange,
  onApproveApplication,
  onRejectApplication,
  onApproveMonetization,
  onRejectMonetization,
  payoutAmountDraft,
  onPayoutAmountDraftChange,
  payoutTransferId,
  onPayoutTransferIdChange,
  payoutNotes,
  onPayoutNotesChange,
  payoutRequestSelection,
  onSelectPayoutRequest,
  onSubmitPayout,
}) {
  const uid = item.uid;
  const isPending = item.creatorApplicationStatus === 'requested';
  const displayNameRaw = formatUserDisplayFromMixed(item);
  const displayName = displayNameRaw === 'Usuario' ? '--' : displayNameRaw;
  const username = String(item.userHandle || item.creatorUsername || '').trim();
  const accountName = String(item.userName || item.displayName || '').trim();
  const bio = String(item.creatorBio || item.creatorBioShort || '').trim() || '--';
  const ageI = accountAgeInfo(item);
  const mon = wantsMonetization(item);
  const monetizationApplicationStatus = String(item?.creatorMonetizationApplicationStatus || '').trim().toLowerCase();
  const monetizationFinancialStatus = String(item?.creatorFinancialStatus || '').trim().toLowerCase();
  const creatorSocialResolved = creatorSocialOf(item);
  const creatorBannerUrlResolved = creatorBannerUrlOf(item);
  const creatorMonetizationResolved = creatorMonetizationOf(item);
  const creatorMonetizationPreferenceResolved = String(
    creatorMonetizationResolved.preference || item?.creatorMonetizationPreference || 'publish_only'
  ).trim().toLowerCase();
  const monetizationApplicationStatusResolved = String(
    creatorMonetizationResolved.applicationStatus || monetizationApplicationStatus || ''
  ).trim().toLowerCase();
  const monetizationFinancialStatusResolved = String(
    creatorMonetizationResolved.financialStatus || monetizationFinancialStatus || ''
  ).trim().toLowerCase();
  const monetizationStatusResolved = String(
    creatorMonetizationResolved.status || item?.creatorMonetizationStatus || ''
  ).trim().toLowerCase();
  const monetizationPending = monetizationApplicationStatusResolved === 'pending';
  const compliance = item.creatorComplianceAdmin;
  const pendingCreatorPhoto = String(item?.creatorApplication?.profileImageUrl || item?.creatorPendingProfileImageUrl || '').trim();
  const avatarPreviewUrl = creatorAvatarUrlOf(item);
  const taxDigits = compliance?.taxIdDigits ? String(compliance.taxIdDigits).replace(/\D/g, '') : '';
  const cpfOk = taxDigits.length === 11 && isValidBrazilianCpfDigits(taxDigits);
  const complianceGate = mon ? evaluateMonetizationComplianceAdmin(compliance) : { ok: true, reasons: [] };
  const minorMonetizeWarn = mon && ageI.isAdult === false;
  const canLiberarMonetizacao = complianceGate.ok;
  const approvalGate = creatorApprovalGateFromItem(item);
  const canApproveCreatorPending = isPending && approvalGate.ok;
  const balance = item.creatorBalanceAdmin || null;
  const recentPayouts = Array.isArray(item.creatorRecentPayoutsAdmin) ? item.creatorRecentPayoutsAdmin : [];
  const pendingPayoutRequests = Array.isArray(item.creatorPendingPayoutRequestsAdmin)
    ? item.creatorPendingPayoutRequestsAdmin
    : [];
  const availableForPayout = Number(balance?.availableBRL || 0);
  const canRegisterPayout = availableForPayout > 0;

  return createPortal(
    <>
      <div
        className="criadores-admin-drawer-backdrop"
        role="presentation"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className="criadores-admin-drawer"
        role="dialog"
        aria-labelledby="criador-ficha-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="criadores-admin-drawer__head">
          <div>
            <h2 id="criador-ficha-title">Ficha do criador</h2>
            <p>
              {displayName}
              {username ? ` | @${username}` : ''}
              {' | '}
              <span className="criadores-admin-mono">{uid}</span>
            </p>
          </div>
          <button type="button" className="criadores-admin-drawer__close" aria-label="Fechar" onClick={onClose}>
            x
          </button>
        </header>

        <div className="criadores-admin-drawer__body">
          {minorMonetizeWarn ? (
            <p className="criadores-admin-alert criadores-admin-alert--warn" role="alert">
              Menor de idade com pedido de monetizacao. Revise com cuidado e alinhe a politica da plataforma.
            </p>
          ) : null}
          <section className="criadores-admin-section criadores-admin-section--metrics">
            <h3 className="criadores-admin-section__title">Requisitos para aprovar candidatura (Nivel 1)</h3>
            <p className="criadores-admin-compliance-hint" style={{ marginTop: 0 }}>
              Mesmas metas da vitrine POD: seguidores, views e likes na plataforma. O servidor bloqueia aprovacao se
              faltar qualquer uma. Quem ja esta aprovado permanece; a regra vale para novas decisoes.
            </p>
            {!approvalGate.ok ? (
              <div className="criadores-admin-compliance-warn" role="alert">
                <strong>Metas nao atingidas - nao e possivel aprovar esta solicitacao ate o criador cumprir tudo.</strong>
              </div>
            ) : (
              <p className="criadores-admin-alert criadores-admin-alert--ok" role="status" style={{ marginBottom: 12 }}>
                Todas as metas minimas foram atingidas (ou superadas).
              </p>
            )}
            <dl className="criadores-admin-dl criadores-admin-dl--metrics">
              <div>
                <dt>Seguidores</dt>
                <dd>
                  <span className="criadores-admin-mono">
                    {approvalGate.metrics.followers} / {approvalGate.thresholds.followers}
                  </span>
                  <span className={`criadores-admin-pill ${approvalGate.metrics.followers >= approvalGate.thresholds.followers ? 'criadores-admin-pill--ok' : 'criadores-admin-pill--bad'}`}>
                    {formatMetricDeltaLine('followers', approvalGate)}
                  </span>
                </dd>
              </div>
              <div>
                <dt>Views (obras)</dt>
                <dd>
                  <span className="criadores-admin-mono">
                    {approvalGate.metrics.views} / {approvalGate.thresholds.views}
                  </span>
                  <span className={`criadores-admin-pill ${approvalGate.metrics.views >= approvalGate.thresholds.views ? 'criadores-admin-pill--ok' : 'criadores-admin-pill--bad'}`}>
                    {formatMetricDeltaLine('views', approvalGate)}
                  </span>
                </dd>
              </div>
              <div>
                <dt>Likes</dt>
                <dd>
                  <span className="criadores-admin-mono">
                    {approvalGate.metrics.likes} / {approvalGate.thresholds.likes}
                  </span>
                  <span className={`criadores-admin-pill ${approvalGate.metrics.likes >= approvalGate.thresholds.likes ? 'criadores-admin-pill--ok' : 'criadores-admin-pill--bad'}`}>
                    {formatMetricDeltaLine('likes', approvalGate)}
                  </span>
                </dd>
              </div>
            </dl>
          </section>

          <section className="criadores-admin-section criadores-admin-section--profile">
            <h3 className="criadores-admin-section__title">Perfil</h3>
            <dl className="criadores-admin-dl">
              <div>
                <dt>Nome artistico</dt>
                <dd>{displayName}</dd>
              </div>
              <div>
                <dt>Nome da conta</dt>
                <dd>{accountName || '--'}</dd>
              </div>
              <div>
                <dt>Username</dt>
                <dd>{username ? `@${username}` : '--'}</dd>
              </div>
              <div>
                <dt>Bio</dt>
                <dd>{bio}</dd>
              </div>
              <div>
                <dt>Redes</dt>
                <dd>
                  {creatorSocialResolved.instagramUrl ? (
                    <div>Instagram: {creatorSocialResolved.instagramUrl}</div>
                  ) : null}
                    {creatorSocialResolved.youtubeUrl ? <div>YouTube: {creatorSocialResolved.youtubeUrl}</div> : null}
                    {!creatorSocialResolved.instagramUrl && !creatorSocialResolved.youtubeUrl ? '--' : null}
                  </dd>
                </div>
              </dl>
            <div className="criadores-admin-media-row">
              {avatarPreviewUrl ? (
                <div>
                  <p className="criadores-admin-section__title" style={{ margin: '0 0 6px' }}>
                    Foto de perfil
                  </p>
                  <img className="criadores-admin-thumb" src={avatarPreviewUrl} alt="" />
                  {pendingCreatorPhoto ? (
                    <p style={{ margin: '8px 0 0', fontSize: '0.78rem', color: 'rgba(255,255,255,0.58)' }}>
                      Foto pendente que sera ativada quando a solicitacao for aprovada.
                    </p>
                  ) : null}
                </div>
              ) : null}
              {creatorBannerUrlResolved ? (
                <div>
                  <p className="criadores-admin-section__title" style={{ margin: '0 0 6px' }}>
                    Banner
                  </p>
                  <img className="criadores-admin-banner-preview" src={creatorBannerUrlResolved} alt="" />
                </div>
              ) : null}
            </div>
            {!avatarPreviewUrl && !creatorBannerUrlResolved ? (
              <p style={{ margin: '8px 0 0', fontSize: '0.82rem', color: 'rgba(255,255,255,0.5)' }}>
                Sem avatar nem banner cadastrados (o site pode usar so a foto de perfil no hero).
              </p>
            ) : null}
            {avatarPreviewUrl && !creatorBannerUrlResolved ? (
              <p style={{ margin: '8px 0 0', fontSize: '0.82rem', color: 'rgba(255,255,255,0.5)' }}>
                Sem banner separado cadastrado.
              </p>
            ) : null}
          </section>

          <section className="criadores-admin-section criadores-admin-section--account">
            <h3 className="criadores-admin-section__title">Conta</h3>
            <dl className="criadores-admin-dl">
              <div>
                <dt>E-mail</dt>
                <dd>{item.email || '--'}</dd>
              </div>
              <div>
                <dt>Data de nascimento</dt>
                <dd>{ageI.birthDisplay}</dd>
              </div>
              <div>
                <dt>Idade</dt>
                <dd>
                  {ageI.age != null ? (
                    <>
                      {ageI.age} anos{ageI.approx ? ' (aprox.)' : ''}
                      <span
                        className={`criadores-admin-pill ${ageI.isAdult ? 'criadores-admin-pill--ok' : 'criadores-admin-pill--bad'}`}
                      >
                        {ageI.isAdult ? 'Maior de idade' : 'Menor de idade'}
                      </span>
                    </>
                  ) : (
                    '--'
                  )}
                </dd>
              </div>
            </dl>
          </section>

          <section className="criadores-admin-section criadores-admin-section--money">
            <h3 className="criadores-admin-section__title">Monetizacao (resumo)</h3>
            <dl className="criadores-admin-dl">
              <div>
                <dt>Solicitou monetizacao</dt>
                <dd>{mon ? 'Sim' : 'Nao (apenas publicar)'}</dd>
              </div>
              <div>
                <dt>Status / preferencia</dt>
                <dd>
                    {String(monetizationApplicationStatusResolved || monetizationStatusResolved || '-')} ·{' '}
                    {String(creatorMonetizationPreferenceResolved || 'publish_only')} ·{' '}
                  {String(monetizationFinancialStatusResolved || 'inactive')}
                </dd>
              </div>
            </dl>
          </section>

          {mon ? (
            <section className="criadores-admin-section criadores-admin-section--compliance">
              <h3 className="criadores-admin-section__title">Compliance / pagamento</h3>
              {!complianceGate.ok ? (
                <div className="criadores-admin-compliance-warn" role="alert">
                  <strong>Dados de monetizacao incompletos ou invalidos</strong>
                  <ul>
                    {complianceGate.reasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="criadores-admin-alert criadores-admin-alert--ok" role="status" style={{ marginBottom: 12 }}>
                  Dados minimos de identidade e PIX validados para liberacao.
                </p>
              )}
              <dl className="criadores-admin-dl">
                <div>
                  <dt>Nome completo (documento)</dt>
                  <dd>{compliance?.legalFullName?.trim() || '--'}</dd>
                </div>
                <div>
                  <dt>CPF</dt>
                  <dd className="criadores-admin-mono">
                    {taxDigits.length === 11 ? formatCpfForDisplay(taxDigits) : taxDigits || '--'}
                    {taxDigits.length === 11 ? (
                      <span
                        className={`criadores-admin-pill ${cpfOk ? 'criadores-admin-pill--ok' : 'criadores-admin-pill--bad'}`}
                        style={{ marginLeft: 8 }}
                      >
                        {cpfOk ? 'CPF valido' : 'CPF invalido'}
                      </span>
                    ) : (
                      <span className="criadores-admin-pill criadores-admin-pill--bad" style={{ marginLeft: 8 }}>
                        CPF ausente
                      </span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Tipo da chave PIX</dt>
                  <dd>{pixTypeLabel(compliance?.payoutPixType)}</dd>
                </div>
                <div>
                  <dt>Chave PIX (armazenada)</dt>
                  <dd className="criadores-admin-mono">{compliance?.payoutKey?.trim() || '--'}</dd>
                </div>
              </dl>
              <p className="criadores-admin-compliance-hint">
                Confira com documento oficial e com a chave PIX real do criador antes de liberar repasses.
              </p>
            </section>
          ) : null}

          <section className="criadores-admin-section criadores-admin-section--behavior">
            <h3 className="criadores-admin-section__title">Comportamento / pipeline</h3>
            <dl className="criadores-admin-dl">
              <div>
                <dt>Status da solicitacao</dt>
                <dd>{statusLabel(item.creatorApplicationStatus)}</dd>
              </div>
              <div>
                <dt>Pipeline criador</dt>
                <dd>{item.creatorStatus || '--'}</dd>
              </div>
              <div>
                <dt>Intent / role</dt>
                <dd>
                  entrada: {item.signupIntent || '--'} | conta: {item.accountStatus || '--'}
                </dd>
              </div>
              <div>
                <dt>Onboarding completo</dt>
                <dd>{item.creatorOnboardingCompleted ? 'Sim' : 'Nao'}</dd>
              </div>
              {item.creatorReviewReason ? (
                <div>
                  <dt>Motivo (ultima decisao criador)</dt>
                  <dd>{item.creatorReviewReason}</dd>
                </div>
              ) : null}
            </dl>
          </section>

          <section className="criadores-admin-section criadores-admin-section--money">
            <h3 className="criadores-admin-section__title">Saldo e repasse manual</h3>
            <dl className="criadores-admin-dl">
              <div>
                <dt>Saldo disponivel</dt>
                <dd>{brl(balance?.availableBRL || 0)}</dd>
              </div>
              <div>
                <dt>Pendente para repasse</dt>
                <dd>{brl(balance?.pendingPayoutBRL || 0)}</dd>
              </div>
              <div>
                <dt>Liquido acumulado</dt>
                <dd>{brl(balance?.lifetimeNetBRL || 0)}</dd>
              </div>
              <div>
                <dt>Ja repassado</dt>
                <dd>{brl(balance?.paidOutBRL || 0)}</dd>
              </div>
            </dl>
            {balance?.lastPayoutAt ? (
              <p className="criadores-admin-compliance-hint">
                Ultimo repasse registrado em {formatarDataHoraBr(balance.lastPayoutAt)}.
              </p>
            ) : null}
            {pendingPayoutRequests.length ? (
              <>
                <h4 className="criadores-admin-section__title" style={{ marginTop: 12 }}>Solicitacoes pendentes</h4>
                <ul className="admin-staff-stack" style={{ marginTop: 12 }}>
                  {pendingPayoutRequests.map((requestRow) => {
                    const selected = payoutRequestSelection === requestRow.requestId;
                    return (
                      <li key={requestRow.requestId}>
                        <strong>{brl(requestRow.amount || 0)}</strong> | pedido em{' '}
                        {requestRow.requestedAt ? formatarDataHoraBr(requestRow.requestedAt) : 'agora'} | saldo na hora:{' '}
                        {brl(requestRow.availableSnapshotBRL || 0)}
                        {requestRow.notes ? <div style={{ marginTop: 4 }}>{requestRow.notes}</div> : null}
                        <div style={{ marginTop: 8 }}>
                          <button
                            type="button"
                            disabled={rowBusy}
                            onClick={() => onSelectPayoutRequest(uid, requestRow)}
                          >
                            {selected ? 'Solicitacao selecionada' : 'Usar no repasse manual'}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : null}
            <div className="financeiro-grid" style={{ marginTop: 12 }}>
              <label>
                Valor do PIX manual
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  disabled={rowBusy || !canRegisterPayout}
                  value={payoutAmountDraft}
                  onChange={(e) => onPayoutAmountDraftChange(e.target.value)}
                  placeholder={availableForPayout > 0 ? String(availableForPayout.toFixed(2)) : '0.00'}
                />
              </label>
              <label>
                Comprovante / id externo
                <input
                  disabled={rowBusy || !canRegisterPayout}
                  value={payoutTransferId}
                  onChange={(e) => onPayoutTransferIdChange(e.target.value)}
                  placeholder="Opcional"
                />
              </label>
              <label className="financeiro-grid-full">
                Observacoes do repasse
                <textarea
                  className="criadores-admin-textarea"
                  rows={3}
                  disabled={rowBusy || !canRegisterPayout}
                  value={payoutNotes}
                  onChange={(e) => onPayoutNotesChange(e.target.value)}
                  placeholder="Ex.: PIX manual feito no banco X."
                />
              </label>
            </div>
            <div className="criadores-admin-actions-row">
              <button
                type="button"
                disabled={rowBusy || !canRegisterPayout}
                onClick={() => onSubmitPayout(uid)}
              >
                {rowBusy ? 'Salvando...' : 'Marcar PIX manual como pago'}
              </button>
            </div>
            {!canRegisterPayout ? (
              <p className="criadores-admin-compliance-hint">Sem saldo disponivel para repasse neste momento.</p>
            ) : null}
            {recentPayouts.length ? (
              <ul className="admin-staff-stack" style={{ marginTop: 12 }}>
                {recentPayouts.map((payout) => (
                  <li key={payout.payoutId}>
                    <strong>{brl(payout.amount || 0)}</strong> | {payout.status || 'pago'} |{' '}
                    {payout.paidAt ? formatarDataHoraBr(payout.paidAt) : 'sem data'}
                    {payout.pixKeyMasked ? <> | PIX {payout.pixKeyMasked}</> : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        </div>

        <footer className="criadores-admin-drawer__foot">
          {isPending ? (
            <>
              {!canApproveCreatorPending ? (
                <p className="criadores-admin-foot-blocked" role="alert">
                  <strong>Aprovar criador bloqueado:</strong> o candidato ainda nao atingiu seguidores, views e likes
                  minimos (Nivel 1). O botao so libera quando as tres metas estiverem OK.
                </p>
              ) : null}
              <div className="criadores-admin-actions-row">
                <button
                  type="button"
                  disabled={rowBusy || !canApproveCreatorPending}
                  title={
                    !canApproveCreatorPending
                      ? 'Metas Nivel 1 incompletas - veja a secao de requisitos acima'
                      : 'Aprovar candidatura'
                  }
                  onClick={() => onApproveApplication(uid)}
                >
                  {rowBusy ? 'Salvando...' : 'Aprovar criador'}
                </button>
                <button
                  type="button"
                  className="is-danger"
                  disabled={rowBusy}
                  onClick={() => onRejectApplication(uid)}
                >
                  Rejeitar
                </button>
              </div>
              <textarea
                className="criadores-admin-textarea"
                rows={3}
                value={rejectReason}
                onChange={(e) => onRejectReasonChange(e.target.value)}
                placeholder="Motivo obrigatorio ao rejeitar (min. 8 caracteres)"
              />
              <label className="criadores-admin-check">
                <input
                  type="checkbox"
                  checked={rejectBan}
                  onChange={(e) => onRejectBanChange(e.target.checked)}
                />
                <span>Bloquear conta (fraude / troll / abuso)</span>
              </label>
            </>
          ) : (
            <p style={{ margin: 0, fontSize: '0.82rem', color: 'rgba(255,255,255,0.5)' }}>
              Solicitacao de criador ja decidida. Use a area abaixo se a monetizacao estiver pendente.
            </p>
          )}

          {monetizationPending ? (
            <>
              <h3 className="criadores-admin-section__title" style={{ margin: '4px 0 0' }}>
                Revisao de monetizacao
              </h3>
              {!canLiberarMonetizacao ? (
                <p className="criadores-admin-foot-blocked" role="alert">
                  <strong>Liberar monetizacao bloqueado:</strong> corrija ou peca ao criador para completar nome legal, CPF
                  valido e chave PIX no perfil antes de aprovar. O servidor tambem rejeita aprovacao sem esses dados.
                  completo.
                </p>
              ) : null}
              <div className="criadores-admin-actions-row">
                <button
                  type="button"
                  disabled={rowBusy || !canLiberarMonetizacao}
                  title={
                    !canLiberarMonetizacao
                      ? complianceGate.reasons.join(' | ')
                      : 'Aprovar monetizacao (membership ja configurada)'
                  }
                  onClick={() => onApproveMonetization(uid)}
                >
                  {rowBusy ? 'Salvando...' : 'Liberar monetizacao'}
                </button>
                <button
                  type="button"
                  className="is-danger"
                  disabled={rowBusy}
                  onClick={() => onRejectMonetization(uid)}
                >
                  Manter so publicacao
                </button>
              </div>
              <textarea
                className="criadores-admin-textarea"
                rows={3}
                value={monetizationReason}
                onChange={(e) => onMonetizationReasonChange(e.target.value)}
                placeholder="Motivo se nao liberar monetizacao (min. 8 caracteres)"
              />
            </>
          ) : null}
        </footer>
      </aside>
    </>,
    document.body
  );
}

export default function CriadoresAdmin({ adminAccess }) {
  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyUid, setBusyUid] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [rejectReasons, setRejectReasons] = useState({});
  const [rejectAsBan, setRejectAsBan] = useState({});
    const [monetizationReasons, setMonetizationReasons] = useState({});
    const [payoutAmounts, setPayoutAmounts] = useState({});
    const [payoutTransferIds, setPayoutTransferIds] = useState({});
    const [payoutNotesByUid, setPayoutNotesByUid] = useState({});
    const [payoutRequestSelectionByUid, setPayoutRequestSelectionByUid] = useState({});
    const [detailUid, setDetailUid] = useState('');

  const canViewCreatorsAdmin = canAccessAdminPath('/admin/criadores', adminAccess);

  const load = useCallback(async () => {
    if (!canViewCreatorsAdmin) {
      setApplications([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { data } = await adminListCreatorApplications();
      setApplications(Array.isArray(data?.applications) ? data.applications : []);
    } catch (err) {
      setApplications([]);
      setError(mensagemErroCallable(err));
    } finally {
      setLoading(false);
    }
  }, [canViewCreatorsAdmin]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!detailUid) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setDetailUid('');
    };
    document.addEventListener('keydown', onKey);
    lockBodyScroll('admin-creators-drawer');
    return () => {
      document.removeEventListener('keydown', onKey);
      unlockBodyScroll('admin-creators-drawer');
    };
  }, [detailUid]);

  const summary = useMemo(() => {
    const pending = applications.filter((item) => item.creatorApplicationStatus === 'requested').length;
    const approved = applications.filter((item) => item.creatorApplicationStatus === 'approved').length;
    const onboarding = applications.filter((item) => item.creatorStatus === 'onboarding').length;
    const monetizationReview = applications.filter(
      (item) => String(item?.creatorMonetizationApplicationStatus || '').trim().toLowerCase() === 'pending'
    ).length;
      const availablePayout = applications.reduce(
        (acc, item) => acc + Number(item?.creatorBalanceAdmin?.availableBRL || 0),
        0
      );
      const payoutRequestsPending = applications.reduce(
        (acc, item) => acc + (Array.isArray(item?.creatorPendingPayoutRequestsAdmin) ? item.creatorPendingPayoutRequestsAdmin.length : 0),
        0
      );
      return { pending, approved, onboarding, monetizationReview, availablePayout, payoutRequestsPending };
    }, [applications]);

  const detailItem = useMemo(
    () => applications.find((a) => a.uid === detailUid) || null,
    [applications, detailUid]
  );

  if (!canViewCreatorsAdmin) {
    return (
      <main className="admin-empty-page admin-team-page">
        <section className="admin-empty-card admin-team-shell">
          <header className="financeiro-header admin-team-header">
            <div>
              <p className="admin-team-eyebrow">Criadores</p>
              <h1>Solicitacoes de criador</h1>
              <p>Esta area fica restrita para admins chefes da plataforma.</p>
            </div>
          </header>
        </section>
      </main>
    );
  }

  const clearDetailIfUid = (uid) => {
    if (detailUid === uid) setDetailUid('');
  };

  const handleApprove = async (uid) => {
    if (!uid) return;
    setBusyUid(uid);
    setMessage('');
    setError('');
    try {
      await adminApproveCreatorApplication({ uid });
      setMessage('Criador aprovado. O perfil entrou em onboarding guiado.');
      await load();
      clearDetailIfUid(uid);
    } catch (err) {
      setError(mensagemErroCallable(err));
    } finally {
      setBusyUid('');
    }
  };

  const handleReject = async (uid) => {
    if (!uid) return;
    const reason = String(rejectReasons[uid] || '').trim();
    const banUser = rejectAsBan[uid] === true;
    if (reason.length < 8) {
      setError('Informe um motivo com pelo menos 8 caracteres para reprovar o criador.');
      return;
    }
    setBusyUid(uid);
    setMessage('');
    setError('');
    try {
      await adminRejectCreatorApplication({ uid, reason, banUser });
      setMessage(banUser ? 'Conta bloqueada e solicitacao encerrada.' : 'Solicitacao rejeitada.');
      setRejectReasons((prev) => ({ ...prev, [uid]: '' }));
      setRejectAsBan((prev) => ({ ...prev, [uid]: false }));
      await load();
      clearDetailIfUid(uid);
    } catch (err) {
      setError(mensagemErroCallable(err));
    } finally {
      setBusyUid('');
    }
  };

  const handleApproveMonetization = async (uid) => {
    if (!uid) return;
    setBusyUid(uid);
    setMessage('');
    setError('');
    try {
      const { data } = await adminApproveCreatorMonetization({ uid });
      setMessage(
        data?.monetizationStatus === 'blocked_underage'
          ? 'Criador mantido em publicacao apenas. Monetizacao bloqueada por idade.'
          : 'Monetizacao aprovada com sucesso.'
      );
      await load();
      clearDetailIfUid(uid);
    } catch (err) {
      setError(mensagemErroCallable(err));
    } finally {
      setBusyUid('');
    }
  };

  const handleRejectMonetization = async (uid) => {
    if (!uid) return;
    const reason = String(monetizationReasons[uid] || '').trim();
    if (reason.length < 8) {
      setError('Explique com pelo menos 8 caracteres por que a monetizacao vai ficar em apenas publicar.');
      return;
    }
    setBusyUid(uid);
    setMessage('');
    setError('');
    try {
      await adminRejectCreatorMonetization({ uid, reason });
      setMessage('Criador segue em modo apenas publicar.');
      setMonetizationReasons((prev) => ({ ...prev, [uid]: '' }));
      await load();
      clearDetailIfUid(uid);
    } catch (err) {
      setError(mensagemErroCallable(err));
    } finally {
      setBusyUid('');
    }
  };

    const handleSubmitPayout = async (uid) => {
    if (!uid) return;
    const detail = applications.find((item) => item.uid === uid);
    const available = Number(detail?.creatorBalanceAdmin?.availableBRL || 0);
    if (!(available > 0)) {
      setError('Este criador nao possui saldo disponivel para repasse.');
      return;
    }
    const rawAmount = String(payoutAmounts[uid] || '').trim().replace(',', '.');
    const parsedAmount = rawAmount ? Number(rawAmount) : available;
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError('Informe um valor de repasse valido.');
      return;
    }
    setBusyUid(uid);
    setMessage('');
    setError('');
    try {
        const { data } = await adminRecordCreatorPixPayout({
          uid,
          amount: parsedAmount,
          externalTransferId: String(payoutTransferIds[uid] || '').trim() || null,
          notes: String(payoutNotesByUid[uid] || '').trim() || null,
          payoutRequestId: String(payoutRequestSelectionByUid[uid] || '').trim() || null,
        });
      setMessage(
        `Repasse PIX manual registrado em ${brl(data?.amount || parsedAmount)}. Saldo restante: ${brl(data?.remainingAvailableBRL || 0)}.`
      );
        setPayoutAmounts((prev) => ({ ...prev, [uid]: '' }));
        setPayoutTransferIds((prev) => ({ ...prev, [uid]: '' }));
        setPayoutNotesByUid((prev) => ({ ...prev, [uid]: '' }));
        setPayoutRequestSelectionByUid((prev) => ({ ...prev, [uid]: '' }));
        await load();
    } catch (err) {
      setError(mensagemErroCallable(err));
    } finally {
      setBusyUid('');
    }
    };

    const handleSelectPayoutRequest = (uid, requestRow) => {
      if (!uid || !requestRow?.requestId) return;
      setPayoutRequestSelectionByUid((prev) => ({ ...prev, [uid]: requestRow.requestId }));
      setPayoutAmounts((prev) => ({
        ...prev,
        [uid]: requestRow.amount != null ? String(requestRow.amount) : prev[uid] || '',
      }));
      if (String(requestRow.notes || '').trim()) {
        setPayoutNotesByUid((prev) => ({ ...prev, [uid]: String(requestRow.notes || '').trim() }));
      }
    };

  return (
    <main className="admin-empty-page admin-team-page">
      <section className="admin-empty-card admin-team-shell">
        <header className="financeiro-header admin-team-header">
          <div>
            <p className="admin-team-eyebrow">Criadores</p>
            <h1>Solicitacoes de criador</h1>
            <p>Lista resumida e ficha completa para decisao segura (identidade, monetizacao, PIX).</p>
          </div>
        </header>

        {error ? <p className="financeiro-msg financeiro-msg--erro">{error}</p> : null}
        {message ? <p className="financeiro-msg financeiro-msg--ok">{message}</p> : null}

        <section className="admin-team-overview">
          <article className="admin-team-stat-card">
            <span>Pendentes</span>
            <strong>{summary.pending}</strong>
          </article>
          <article className="admin-team-stat-card">
            <span>Aprovados</span>
            <strong>{summary.approved}</strong>
          </article>
          <article className="admin-team-stat-card">
            <span>Em onboarding</span>
            <strong>{summary.onboarding}</strong>
          </article>
          <article className="admin-team-stat-card">
            <span>Monetizacao pendente</span>
            <strong>{summary.monetizationReview}</strong>
          </article>
            <article className="admin-team-stat-card">
              <span>Saldo criadores</span>
              <strong>{brl(summary.availablePayout)}</strong>
            </article>
            <article className="admin-team-stat-card">
              <span>Saques pendentes</span>
              <strong>{summary.payoutRequestsPending}</strong>
            </article>
          </section>

        <section className="admin-team-panel">
          <div className="admin-team-panel-head">
            <div>
              <h2>Candidatos</h2>
              <p>Clique em Ver ficha para dados completos e acoes de aprovacao.</p>
            </div>
          </div>

          {loading ? <p className="admin-staff-loading">Carregando solicitacoes...</p> : null}
          {!loading && applications.length === 0 ? (
            <p className="admin-staff-empty">Nenhuma solicitacao de criador encontrada.</p>
          ) : null}

          {!loading && applications.length > 0 ? (
            <div className="criadores-admin-list-wrap">
              <table className="criadores-admin-list">
                <thead>
                  <tr>
                    <th>Nome</th>
                    <th>E-mail</th>
                    <th>Status</th>
                    <th>Monetizacao</th>
                    <th>Saldo</th>
                    <th>Solicitado</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {applications.map((item) => {
                    const nameRaw = formatUserDisplayFromMixed(item);
                    const name =
                      nameRaw === 'Usuario' ? item.creatorDisplayName || item.userName || item.email || item.uid : nameRaw;
                    const mon = wantsMonetization(item);
                    return (
                      <tr key={item.uid}>
                        <td>
                          <div className="criadores-admin-cell-main">
                            <strong>{name}</strong>
                          </div>
                        </td>
                        <td>
                          <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.82rem' }}>
                            {item.email || '--'}
                          </span>
                        </td>
                        <td>
                          <span className={statusBadgeClass(item.creatorApplicationStatus)}>
                            {statusLabel(item.creatorApplicationStatus)}
                          </span>
                        </td>
                        <td>{mon ? 'Sim' : 'Nao'}</td>
                        <td>{brl(item?.creatorBalanceAdmin?.availableBRL || 0)}</td>
                        <td>
                          {item.creatorRequestedAt
                            ? formatarDataHoraBr(item.creatorRequestedAt)
                            : '--'}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="criadores-admin-btn-ficha"
                            onClick={() => setDetailUid(item.uid)}
                          >
                            Ver ficha
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      </section>

      {detailItem ? (
        <CreatorDetailDrawer
          item={detailItem}
          onClose={() => setDetailUid('')}
          rowBusy={busyUid === detailItem.uid}
          rejectReason={rejectReasons[detailItem.uid] || ''}
          onRejectReasonChange={(v) => setRejectReasons((p) => ({ ...p, [detailItem.uid]: v }))}
          rejectBan={rejectAsBan[detailItem.uid] === true}
          onRejectBanChange={(v) => setRejectAsBan((p) => ({ ...p, [detailItem.uid]: v }))}
          monetizationReason={monetizationReasons[detailItem.uid] || ''}
          onMonetizationReasonChange={(v) => setMonetizationReasons((p) => ({ ...p, [detailItem.uid]: v }))}
          onApproveApplication={handleApprove}
          onRejectApplication={handleReject}
          onApproveMonetization={handleApproveMonetization}
          onRejectMonetization={handleRejectMonetization}
          payoutAmountDraft={payoutAmounts[detailItem.uid] || ''}
          onPayoutAmountDraftChange={(v) => setPayoutAmounts((p) => ({ ...p, [detailItem.uid]: v }))}
            payoutTransferId={payoutTransferIds[detailItem.uid] || ''}
            onPayoutTransferIdChange={(v) => setPayoutTransferIds((p) => ({ ...p, [detailItem.uid]: v }))}
            payoutNotes={payoutNotesByUid[detailItem.uid] || ''}
            onPayoutNotesChange={(v) => setPayoutNotesByUid((p) => ({ ...p, [detailItem.uid]: v }))}
            payoutRequestSelection={payoutRequestSelectionByUid[detailItem.uid] || ''}
            onSelectPayoutRequest={handleSelectPayoutRequest}
            onSubmitPayout={handleSubmitPayout}
          />
      ) : null}
    </main>
  );
}

