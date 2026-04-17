import React from 'react';
import { Navigate, useNavigate } from 'react-router-dom';

import { APP_ROLE } from '../../auth/appRoles';
import { canAccessAdminPath } from '../../auth/adminPermissions';
import { CREATOR_FUTURE_PROGRAM } from '../../utils/creatorFutureProgramTeaser';
import { buildLoginUrlWithRedirect } from '../../utils/loginRedirectPath';
import './CreatorsApplyPage.css';

/**
 * Página pública de apresentação do programa. Contas logadas vão para `/creator/onboarding`.
 */
export default function CreatorsApplyPage({
  user,
  adminAccess,
  shellRole = null,
  isMangakaEffective = null,
}) {
  const navigate = useNavigate();

  const resolvedShellRole = shellRole || APP_ROLE.USER;
  const isMangaka =
    typeof isMangakaEffective === 'boolean' ? isMangakaEffective : resolvedShellRole === APP_ROLE.CREATOR;
  const isStaffAdmin = resolvedShellRole === APP_ROLE.ADMIN;

  if (isMangaka) {
    return <Navigate to="/creator" replace />;
  }

  if (isStaffAdmin) {
    const dest = canAccessAdminPath('/admin/criadores', adminAccess) ? '/admin/criadores' : '/admin';
    return <Navigate to={dest} replace />;
  }

  if (user?.uid) {
    return <Navigate to="/creator/onboarding" replace />;
  }

  return (
    <section className="creators-apply-guest" aria-labelledby="creators-apply-guest-title">
      <div className="creators-apply-guest__inner">
        <p className="creators-apply-guest__eyebrow">Programa de criadores</p>
        <h1 id="creators-apply-guest-title">CREATORS</h1>
        <p className="creators-apply-guest__lead">
          Publique histórias na MangaTeofilo, monte seu perfil público e, se for maior de idade, escolha monetizar com a
          equipe. Entre com sua conta para enviar a candidatura — o formulário abre em uma página dedicada para você
          preencher com calma. A capa do perfil usa sua foto de perfil com fundo desfocado.
        </p>
        <ul className="creators-apply-guest__bullets">
          <li>Foto de perfil e identidade de criador</li>
          <li>Publicar sem monetização: acesso liberado na hora</li>
          <li>Monetização com dados legais e PIX passa por revisão da equipe</li>
        </ul>
        <aside className="creators-apply-guest__future" aria-label="Programa futuro para criadores">
          <p className="creators-apply-guest__future-eyebrow">{CREATOR_FUTURE_PROGRAM.eyebrow}</p>
          <p className="creators-apply-guest__future-title">{CREATOR_FUTURE_PROGRAM.title}</p>
          <p className="creators-apply-guest__future-disclaimer">{CREATOR_FUTURE_PROGRAM.disclaimer}</p>
          <ul className="creators-apply-guest__future-list">
            {CREATOR_FUTURE_PROGRAM.perks.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="creators-apply-guest__future-closer">{CREATOR_FUTURE_PROGRAM.closer}</p>
        </aside>
        <div className="creators-apply-guest__actions">
          <button type="button" className="creators-apply-guest__primary" onClick={() => navigate(buildLoginUrlWithRedirect('/creators'))}>
            Entrar ou cadastrar
          </button>
          <button type="button" className="creators-apply-guest__secondary" onClick={() => navigate('/')}>
            Voltar ao início
          </button>
        </div>
      </div>
    </section>
  );
}
