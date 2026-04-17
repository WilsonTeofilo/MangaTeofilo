import React, { useMemo, useState } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';

import CreatorApplicationModal from '../../components/CreatorApplicationModal';
import { APP_ROLE } from '../../auth/appRoles';
import { canAccessAdminPath } from '../../auth/adminPermissions';
import { CREATOR_BIO_MAX_LENGTH } from '../../constants';
import { SITE_ORIGIN } from '../../config/site';
import { functions } from '../../services/firebase';
import { submitCreatorApplicationPayload } from '../../utils/creatorApplicationClient';
import { resolveCreatorMonetizationPreferenceFromDb } from '../../utils/creatorMonetizationUi';
import { sanitizeCpfDigitsInput } from '../../utils/creatorRecord';
import './CreatorsApplyPage.css';

const creatorSubmitApplication = httpsCallable(functions, 'creatorSubmitApplication');

/**
 * Fluxo dedicado (tela cheia) para liberar acesso de creator ou enviar dados da etapa financeira.
 * Substitui o modal no perfil: mesmo formulario, rota estavel e contexto preservado ao navegar.
 */
export default function CreatorOnboardingPage({
  user,
  perfil,
  adminAccess,
  shellRole = null,
  isMangakaEffective = null,
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(false);

  const intentParam = String(searchParams.get('intent') || '').trim().toLowerCase();
  const isMangakaMonetizeIntent = intentParam === 'mangaka_monetize';

  const resolvedShellRole = shellRole || APP_ROLE.USER;
  const isMangaka =
    typeof isMangakaEffective === 'boolean' ? isMangakaEffective : resolvedShellRole === APP_ROLE.CREATOR;
  const isStaffAdmin = resolvedShellRole === APP_ROLE.ADMIN;

  const initial = useMemo(() => {
    const signupDraft =
      location?.state?.signupDraft && typeof location.state.signupDraft === 'object'
        ? location.state.signupDraft
        : {};
    const creatorProfile =
      perfil?.creator?.profile && typeof perfil.creator.profile === 'object' ? perfil.creator.profile : {};
    const creatorSocial =
      perfil?.creator?.social && typeof perfil.creator.social === 'object' ? perfil.creator.social : {};

    return {
      displayName: String(
        creatorProfile.displayName ||
          signupDraft.displayName ||
          perfil?.userName ||
          user?.displayName ||
          ''
      ).trim(),
      bio: String(creatorProfile.bio || '').trim().slice(0, CREATOR_BIO_MAX_LENGTH),
      instagramUrl: String(creatorSocial.instagram || '').trim(),
      youtubeUrl: String(creatorSocial.youtube || '').trim(),
      monetizationPreference: isMangakaMonetizeIntent
        ? 'monetize'
        : resolveCreatorMonetizationPreferenceFromDb(perfil),
      termsAccepted: Boolean(perfil?.creatorTermsAccepted),
      birthDate: String(perfil?.birthDate || '').trim(),
      legalFullName: String(perfil?.creatorCompliance?.legalFullName || '').trim(),
      taxId: sanitizeCpfDigitsInput(perfil?.creatorCompliance?.taxId),
      payoutInstructions: String(perfil?.creatorCompliance?.payoutInstructions || '').trim(),
      payoutPixType: String(perfil?.creatorCompliance?.payoutPixType || '').trim().toLowerCase(),
      profileImageCrop: perfil?.creatorApplication?.profileImageCrop || null,
      existingProfileImageUrl: (() => {
        const candidates = [
          perfil?.creatorApplication?.profileImageUrl,
          signupDraft.avatarUrl,
          perfil?.readerProfileAvatarUrl,
          perfil?.userAvatar,
          user?.photoURL,
        ];
        for (const raw of candidates) {
          const url = String(raw || '').trim();
          if (!url) continue;
          if (/^https:\/\//i.test(url) && url.length >= 12 && url.length <= 2048) return url;
          if (url.startsWith('/') && !url.startsWith('//') && url.length >= 2 && url.length <= 2048) {
            return `${SITE_ORIGIN}${url}`;
          }
        }
        return '';
      })(),
    };
  }, [perfil, user, isMangakaMonetizeIntent, location.state]);

  const missingBasics = useMemo(() => {
    const missing = [];
    if (!String(perfil?.userHandle || '').trim()) missing.push('@username');
    if (!String(perfil?.userName || '').trim()) missing.push('nome de perfil');
    if (!String(perfil?.birthDate || '').trim()) missing.push('data de nascimento');
    const gender = String(perfil?.gender || '').trim().toLowerCase();
    if (!gender || gender === 'nao_informado') missing.push('genero');
    return missing;
  }, [perfil]);

  if (!user?.uid) {
    return null;
  }

  if (isMangaka && !isMangakaMonetizeIntent) {
    return <Navigate to="/creator" replace />;
  }

  if (isMangakaMonetizeIntent && !isMangaka) {
    return <Navigate to="/perfil" replace />;
  }

  if (isStaffAdmin && !isMangaka) {
    const dest = canAccessAdminPath('/admin/criadores', adminAccess) ? '/admin/criadores' : '/admin';
    return <Navigate to={dest} replace />;
  }

  if (!isMangaka && !isStaffAdmin && missingBasics.length) {
    return (
      <main className="creators-apply-guest">
        <div className="creators-apply-guest__inner">
          <p className="creators-apply-guest__eyebrow">Cadastro obrigatorio</p>
          <h1>Complete seu perfil de leitor</h1>
          <p className="creators-apply-guest__lead">
            Para virar escritor direto, voce precisa preencher os campos basicos do perfil de leitor primeiro.
          </p>
          <ul className="creators-apply-guest__bullets">
            {missingBasics.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <div className="creators-apply-guest__actions">
            <button
              type="button"
              className="creators-apply-guest__primary"
              onClick={() => navigate('/perfil?required=creator_basics')}
            >
              Completar perfil
            </button>
            <button type="button" className="creators-apply-guest__secondary" onClick={() => navigate('/perfil')}>
              Voltar ao perfil
            </button>
          </div>
        </div>
      </main>
    );
  }

  const handleClose = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      navigate(-1);
    } else {
      navigate('/perfil');
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

      if (autoApproved) {
        return {
          successTitle: 'Acesso de creator liberado',
          successBody: 'Seu perfil de creator foi liberado para publicar. Ao continuar, a pagina sera atualizada para abrir o workspace correto.',
          afterDismiss: () => {
            if (typeof window !== 'undefined') window.location.assign('/perfil');
          },
        };
      }
      if (data?.alreadyMangaka && data?.monetizationApprovalRequested) {
        return {
          successTitle: 'Dados enviados',
          successBody:
            'Seus dados de monetizacao foram enviados. A equipe vai revisar os documentos e liberar sua area financeira se estiver tudo certo.',
          afterDismiss: () => navigate('/perfil'),
        };
      }
      if (data?.alreadyMangaka && data?.monetizationAlreadyActive) {
        return {
          successTitle: 'Area financeira ativa',
          successBody: 'Sua monetizacao financeira ja esta ativa nesta conta.',
          afterDismiss: () => navigate('/perfil'),
        };
      }
      if (data?.alreadyMangaka) {
        return {
          successTitle: 'Conta de creator',
          successBody: 'Sua conta ja tem acesso de creator para publicar.',
          afterDismiss: () => navigate('/perfil'),
        };
      }
      if (data?.alreadyPending) {
        return {
          successTitle: 'Pedido em analise',
          successBody: 'Seu pedido de creator ja esta em analise.',
          afterDismiss: () => navigate('/perfil'),
        };
      }

      return {
        successTitle: 'Pedido recebido',
        successBody: isMangakaMonetizeIntent
          ? 'Pedido enviado. A equipe vai revisar seus dados legais e ativar sua area financeira se estiver tudo certo.'
          : 'Recebemos seu pedido de creator. Ao continuar, voce sera levado ao perfil.',
        afterDismiss: () => navigate('/perfil'),
      };
    } catch (err) {
      const msg = err?.message || 'Nao foi possivel enviar sua solicitacao agora.';
      throw new Error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <CreatorApplicationModal
      variant="page"
      open
      intent={isMangakaMonetizeIntent ? 'mangaka_monetize' : 'signup'}
      onClose={handleClose}
      loading={loading}
      initial={initial}
      onSubmit={handleSubmit}
    />
  );
}

