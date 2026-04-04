import React, { useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';

import CreatorApplicationModal from '../../components/CreatorApplicationModal';
import { CREATOR_BIO_MAX_LENGTH } from '../../constants';
import { canAccessAdminPath } from '../../auth/adminPermissions';
import { functions } from '../../services/firebase';
import { submitCreatorApplicationPayload } from '../../utils/creatorApplicationClient';
import { sanitizeCpfDigitsInput } from '../../utils/creatorRecord';
import { CREATOR_FUTURE_PROGRAM } from '../../utils/creatorFutureProgramTeaser';
import { buildLoginUrlWithRedirect } from '../../utils/loginRedirectPath';
import './CreatorsApplyPage.css';

const creatorSubmitApplication = httpsCallable(functions, 'creatorSubmitApplication');

export default function CreatorsApplyPage({ user, perfil, adminAccess }) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  const isMangaka = adminAccess?.isMangaka === true;
  const isStaffAdmin = adminAccess?.canAccessAdmin === true;

  const initial = useMemo(
    () => ({
      displayName: String(perfil?.creatorDisplayName || perfil?.userName || user?.displayName || '').trim(),
      bio: String(perfil?.creatorBio || '').trim().slice(0, CREATOR_BIO_MAX_LENGTH),
      instagramUrl: String(perfil?.instagramUrl || '').trim(),
      youtubeUrl: String(perfil?.youtubeUrl || '').trim(),
      monetizationPreference:
        String(perfil?.creatorMonetizationPreference || 'publish_only').trim().toLowerCase() === 'monetize'
          ? 'monetize'
          : 'publish_only',
      termsAccepted: Boolean(perfil?.creatorTermsAccepted),
      birthDate: String(perfil?.birthDate || '').trim(),
      legalFullName: String(perfil?.creatorCompliance?.legalFullName || '').trim(),
      taxId: sanitizeCpfDigitsInput(perfil?.creatorCompliance?.taxId),
      payoutInstructions: String(perfil?.creatorCompliance?.payoutInstructions || '').trim(),
      payoutPixType: String(perfil?.creatorCompliance?.payoutPixType || '').trim().toLowerCase(),
      profileImageCrop: perfil?.creatorApplication?.profileImageCrop || null,
      existingProfileImageUrl: (() => {
        const site = 'https://mangateofilo.com';
        const candidates = [perfil?.creatorApplication?.profileImageUrl, perfil?.userAvatar, user?.photoURL];
        for (const raw of candidates) {
          const u = String(raw || '').trim();
          if (!u) continue;
          if (/^https:\/\//i.test(u) && u.length >= 12 && u.length <= 2048) return u;
          if (u.startsWith('/') && !u.startsWith('//') && u.length >= 2 && u.length <= 2048) return `${site}${u}`;
        }
        return '';
      })(),
    }),
    [perfil, user]
  );

  if (isMangaka) {
    return <Navigate to="/creator" replace />;
  }

  if (isStaffAdmin) {
    const dest = canAccessAdminPath('/admin/criadores', adminAccess) ? '/admin/criadores' : '/admin';
    return <Navigate to={dest} replace />;
  }

  if (!user?.uid) {
    return (
      <section className="creators-apply-guest" aria-labelledby="creators-apply-guest-title">
        <div className="creators-apply-guest__inner">
          <p className="creators-apply-guest__eyebrow">Programa de criadores</p>
          <h1 id="creators-apply-guest-title">CREATORS</h1>
          <p className="creators-apply-guest__lead">
            Publique histórias na MangaTeofilo, monte seu perfil público e, se for maior de idade, escolha monetizar com
            a equipe. Entre com sua conta para enviar a candidatura — o formulário abre em tela cheia para você preencher com
            calma. A capa do perfil usa sua foto de perfil com fundo desfocado.
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
            <button type="button" className="creators-apply-guest__primary" onClick={() => navigate(buildLoginUrlWithRedirect('/perfil'))}>
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

  const handleClose = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      navigate(-1);
    } else {
      navigate('/');
    }
  };

  const handleSubmit = async (payload) => {
    setLoading(true);
    try {
      const { data } = await submitCreatorApplicationPayload({
        creatorSubmitApplication,
        payload,
        uid: user.uid,
      });
      const autoApproved = data?.autoApproved === true;
      return {
        successTitle: autoApproved ? 'Criador liberado' : 'Solicitação enviada',
        successBody: autoApproved
          ? 'Seu acesso foi liberado. Ao continuar, atualizamos a página do seu perfil.'
          : 'Recebemos sua candidatura. Ao continuar, você será levado ao perfil.',
        afterDismiss: () => {
          if (autoApproved && typeof window !== 'undefined') {
            window.location.assign('/perfil');
          } else {
            navigate('/perfil');
          }
        },
      };
    } catch (err) {
      const msg = err?.message || 'Não foi possível enviar sua solicitação agora.';
      throw new Error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <CreatorApplicationModal
      variant="page"
      open
      onClose={handleClose}
      loading={loading}
      initial={initial}
      onSubmit={handleSubmit}
    />
  );
}
