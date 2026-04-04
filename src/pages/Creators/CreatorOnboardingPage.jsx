import React, { useMemo, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';

import CreatorApplicationModal from '../../components/CreatorApplicationModal';
import { CREATOR_BIO_MAX_LENGTH } from '../../constants';
import { canAccessAdminPath } from '../../auth/adminPermissions';
import { functions } from '../../services/firebase';
import { submitCreatorApplicationPayload } from '../../utils/creatorApplicationClient';
import { sanitizeCpfDigitsInput } from '../../utils/creatorRecord';
import './CreatorsApplyPage.css';

const creatorSubmitApplication = httpsCallable(functions, 'creatorSubmitApplication');

/**
 * Fluxo dedicado (tela cheia) para virar criador ou enviar dados de monetização.
 * Substitui o modal no perfil — mesmo formulário, rota estável e contexto preservado ao navegar.
 */
export default function CreatorOnboardingPage({ user, perfil, adminAccess }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(false);

  const intentParam = String(searchParams.get('intent') || '').trim().toLowerCase();
  const isMangakaMonetizeIntent = intentParam === 'mangaka_monetize';

  const isMangaka = adminAccess?.isMangaka === true;
  const isStaffAdmin = adminAccess?.canAccessAdmin === true;

  const initial = useMemo(
    () => ({
      displayName: String(perfil?.creatorDisplayName || perfil?.userName || user?.displayName || '').trim(),
      bio: String(perfil?.creatorBio || '').trim().slice(0, CREATOR_BIO_MAX_LENGTH),
      instagramUrl: String(perfil?.instagramUrl || '').trim(),
      youtubeUrl: String(perfil?.youtubeUrl || '').trim(),
      monetizationPreference: isMangakaMonetizeIntent
        ? 'monetize'
        : String(perfil?.creatorMonetizationPreference || 'publish_only').trim().toLowerCase() === 'monetize'
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
    [perfil, user, isMangakaMonetizeIntent]
  );

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
          successTitle: 'Acesso de criador liberado',
          successBody:
            'Seu perfil de criador foi liberado. Ao continuar, a página será atualizada para abrir o painel correto.',
          afterDismiss: () => {
            if (typeof window !== 'undefined') window.location.assign('/perfil');
          },
        };
      }
      if (data?.alreadyMangaka && data?.monetizationPendingReviewSubmitted) {
        return {
          successTitle: 'Dados enviados',
          successBody:
            'Dados de monetização enviados. Você continua publicando normalmente; a equipe revisará antes de ativar repasses.',
          afterDismiss: () => navigate('/perfil'),
        };
      }
      if (data?.alreadyMangaka && data?.monetizationPendingReview) {
        return {
          successTitle: 'Em análise',
          successBody: 'Sua monetização já está em análise pela equipe.',
          afterDismiss: () => navigate('/perfil'),
        };
      }
      if (data?.alreadyMangaka && data?.monetizationAlreadyActive) {
        return {
          successTitle: 'Monetização ativa',
          successBody: 'Sua monetização já está ativa nesta conta.',
          afterDismiss: () => navigate('/perfil'),
        };
      }
      if (data?.alreadyMangaka) {
        return {
          successTitle: 'Conta de criador',
          successBody: 'Sua conta já está aprovada como criador.',
          afterDismiss: () => navigate('/perfil'),
        };
      }
      if (data?.alreadyPending) {
        return {
          successTitle: 'Já enviado',
          successBody: 'Sua solicitação de criador já está em análise.',
          afterDismiss: () => navigate('/perfil'),
        };
      }

      return {
        successTitle: 'Solicitação recebida',
        successBody: isMangakaMonetizeIntent
          ? 'Solicitação enviada. A equipe vai revisar seus dados legais e repasse antes de ativar.'
          : 'Recebemos sua candidatura. Ao continuar, você será levado ao perfil.',
        afterDismiss: () => navigate('/perfil'),
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
      intent={isMangakaMonetizeIntent ? 'mangaka_monetize' : 'signup'}
      onClose={handleClose}
      loading={loading}
      initial={initial}
      onSubmit={handleSubmit}
    />
  );
}
