// src/pages/Perfil/Perfil.jsx
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { updateProfile } from 'firebase/auth';
import { ref, update, get, onValue } from 'firebase/database';
import { httpsCallable } from 'firebase/functions';
import { useNavigate } from 'react-router-dom';

import { db, functions } from '../../services/firebase';
import { LISTA_AVATARES, AVATAR_FALLBACK, isAdminUser, DISPLAY_NAME_MAX_LENGTH } from '../../constants'; // centralizado
import {
  algumaCreatorMembershipAtiva,
  assinaturaPremiumAtiva,
  listarMembershipsDeCriadorAtivas,
  obterEntitlementPremiumGlobal,
  podeUsarAvataresPremiumDaLoja,
} from '../../utils/capituloLancamento';
import { formatarTempoRestanteAssinatura } from '../../utils/assinaturaTempoRestante';
import { formatarDataLongaBr } from '../../utils/datasBr';
import { emptyAdminAccess } from '../../auth/adminAccess';
import { apoieUrlAbsolutaParaCriador } from '../../utils/creatorSupportPaths';
import {
  buildCreatorOnboardingSteps,
  creatorOnboardingIsRequiredComplete,
  creatorOnboardingPrimaryNextPath,
  onboardingRequiredDoneCount,
  onboardingRequiredTotal,
} from '../../utils/creatorOnboardingProgress';
import './Perfil.css';

const creatorSubmitApplication = httpsCallable(functions, 'creatorSubmitApplication');
const markUserNotificationRead = httpsCallable(functions, 'markUserNotificationRead');

// Recebe `user` via prop (consistente com App.jsx)
// Nao usa mais auth.currentUser diretamente para evitar dessincronizacao
export default function Perfil({ user, adminAccess = emptyAdminAccess() }) {
  const navigate = useNavigate();

  const [novoNome, setNovoNome]               = useState('');
  const [avatarSelecionado, setAvatarSelecionado] = useState('');
  const [notifyPromotions, setNotifyPromotions] = useState(false);
  const [listaAvatares, setListaAvatares] = useState(
    LISTA_AVATARES.map((url, index) => ({
      id: `legacy-${index}`,
      url,
      access: 'publico',
    }))
  );
  const [gender, setGender] = useState('nao_informado');
  const [birthYear, setBirthYear] = useState('');
  const [accountType, setAccountType] = useState('comum');
  const [loading, setLoading]                 = useState(false);
  const [mensagem, setMensagem]               = useState({ texto: '', tipo: '' });
  const [perfilDb, setPerfilDb]               = useState(null);
  const [linkApoioCopiado, setLinkApoioCopiado] = useState(false);
  const [creatorBio, setCreatorBio] = useState('');
  const [creatorDisplayName, setCreatorDisplayName] = useState('');
  const [creatorBannerUrl, setCreatorBannerUrl] = useState('');
  const [instagramUrl, setInstagramUrl] = useState('');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [creatorTermsAccepted, setCreatorTermsAccepted] = useState(false);
  const [creatorMonetizationPreference, setCreatorMonetizationPreference] = useState('publish_only');
  const [notifications, setNotifications] = useState([]);
  const [creatorMembershipEnabled, setCreatorMembershipEnabled] = useState(true);
  const [creatorMembershipPriceBRL, setCreatorMembershipPriceBRL] = useState('12');
  const [creatorDonationSuggestedBRL, setCreatorDonationSuggestedBRL] = useState('7');
  const [creatorApplicationLoading, setCreatorApplicationLoading] = useState(false);
  const [obrasValOnboarding, setObrasValOnboarding] = useState(null);
  const [capsValOnboarding, setCapsValOnboarding] = useState(null);
  const [produtosValOnboarding, setProdutosValOnboarding] = useState(null);
  const [creatorOnboardingChecklistHidden, setCreatorOnboardingChecklistHidden] = useState(false);
  const [creatorOnboardingStoreSkipped, setCreatorOnboardingStoreSkipped] = useState(false);
  const [onboardingUiBusy, setOnboardingUiBusy] = useState(false);
  const mangakaFormAnchorRef = useRef(null);

  const normalizarAcessoAvatar = (item) => {
    const raw = item?.access;
    if (raw == null || String(raw).trim() === '') return 'publico';
    const v = String(raw).toLowerCase().trim();
    if (v === 'premium' || v === 'vip' || v === 'exclusivo_vip') return 'premium';
    if (v === 'publico' || v === 'public' || v === 'comum' || v === 'free') return 'publico';
    return 'premium';
  };

  useEffect(() => {
    const carregarPerfil = async () => {
      const snap = await get(ref(db, `usuarios/${user.uid}`));
      const perfil = snap.val() || {};
      setPerfilDb(perfil);
      setNotifyPromotions(Boolean(perfil.notifyPromotions));
      setGender(perfil.gender || 'nao_informado');
      const rawTipo = String(perfil.accountType ?? 'comum').toLowerCase();
      const tipoValido = ['comum', 'membro', 'premium', 'admin'].includes(rawTipo) ? rawTipo : 'comum';
      if (isAdminUser(user)) {
        setAccountType('admin');
      } else {
        setAccountType(tipoValido);
      }
      setBirthYear(
        typeof perfil.birthYear === 'number' && perfil.birthYear > 1900
          ? String(perfil.birthYear)
          : ''
      );
      setCreatorDisplayName(String(perfil.creatorDisplayName || perfil.userName || user.displayName || '').trim());
      setCreatorBio(String(perfil.creatorBio || '').trim());
      setCreatorBannerUrl(String(perfil.creatorBannerUrl || '').trim());
      setInstagramUrl(String(perfil.instagramUrl || '').trim());
      setYoutubeUrl(String(perfil.youtubeUrl || '').trim());
      setCreatorTermsAccepted(Boolean(perfil.creatorTermsAccepted));
      setCreatorMonetizationPreference(
        String(perfil.creatorMonetizationPreference || 'publish_only').trim().toLowerCase() === 'monetize'
          ? 'monetize'
          : 'publish_only'
      );
      setCreatorMembershipEnabled(perfil.creatorMembershipEnabled !== false);
      setCreatorMembershipPriceBRL(
        perfil.creatorMembershipPriceBRL != null ? String(perfil.creatorMembershipPriceBRL) : '12'
      );
      setCreatorDonationSuggestedBRL(
        perfil.creatorDonationSuggestedBRL != null ? String(perfil.creatorDonationSuggestedBRL) : '7'
      );
      setCreatorOnboardingChecklistHidden(Boolean(perfil.creatorOnboardingChecklistHidden));
      setCreatorOnboardingStoreSkipped(Boolean(perfil.creatorOnboardingStoreSkipped));
    };

    if (!user) {
      navigate('/login');
      return;
    }
    setNovoNome(user.displayName || '');
    setAvatarSelecionado(user.photoURL || LISTA_AVATARES[0] || AVATAR_FALLBACK);
    carregarPerfil().catch(() => setNotifyPromotions(false));
  }, [user, navigate]);

  useEffect(() => {
    if (!user?.uid || !adminAccess.isMangaka) {
      setObrasValOnboarding(null);
      setCapsValOnboarding(null);
      setProdutosValOnboarding(null);
      return () => {};
    }
    const uObras = onValue(ref(db, 'obras'), (snap) => {
      setObrasValOnboarding(snap.exists() ? snap.val() : {});
    });
    const uCaps = onValue(ref(db, 'capitulos'), (snap) => {
      setCapsValOnboarding(snap.exists() ? snap.val() : {});
    });
    const uProd = onValue(ref(db, 'loja/produtos'), (snap) => {
      setProdutosValOnboarding(snap.exists() ? snap.val() : {});
    });
    return () => {
      uObras();
      uCaps();
      uProd();
    };
  }, [user?.uid, adminAccess.isMangaka]);

  useEffect(() => {
    if (!user?.uid) {
      setNotifications([]);
      return () => {};
    }
    const unsub = onValue(ref(db, `usuarios/${user.uid}/notifications`), (snap) => {
      const rows = snap.exists()
        ? Object.entries(snap.val() || {}).map(([id, row]) => ({ id, ...(row || {}) }))
        : [];
      rows.sort((a, b) => {
        const priorityDiff = Number(b.priority || 0) - Number(a.priority || 0);
        if (priorityDiff !== 0) return priorityDiff;
        return Number(b.createdAt || b.updatedAt || 0) - Number(a.createdAt || a.updatedAt || 0);
      });
      setNotifications(rows.slice(0, 8));
    });
    return () => unsub();
  }, [user?.uid]);

  const onboardingSteps = useMemo(
    () =>
      buildCreatorOnboardingSteps({
        uid: user?.uid,
        perfilDb: perfilDb || {},
        obrasVal: obrasValOnboarding,
        capsVal: capsValOnboarding,
        produtosVal: produtosValOnboarding,
        storeSkipped: creatorOnboardingStoreSkipped,
      }),
    [
      user?.uid,
      perfilDb,
      obrasValOnboarding,
      capsValOnboarding,
      produtosValOnboarding,
      creatorOnboardingStoreSkipped,
    ]
  );

  const onboardingRequiredDone = onboardingRequiredDoneCount(onboardingSteps);
  const onboardingRequiredAll = onboardingRequiredTotal(onboardingSteps);
  const onboardingAllRequiredComplete = onboardingRequiredDone >= onboardingRequiredAll;
  const currentOnboardingStep = onboardingSteps.find((step) => !step.optional && !step.done) || null;

  useEffect(() => {
    const unsub = onValue(ref(db, 'avatares'), (snap) => {
      if (!snap.exists()) return;
      const data = Object.entries(snap.val() || {})
        .map(([id, item]) => ({ id, ...item }))
        .filter((item) => item?.active !== false && typeof item?.url === 'string')
        .sort((a, b) => {
          const aOrder = typeof a?.order === 'number' ? a.order : Number.MAX_SAFE_INTEGER;
          const bOrder = typeof b?.order === 'number' ? b.order : Number.MAX_SAFE_INTEGER;
          if (aOrder !== bOrder) return aOrder - bOrder;
          return (b?.createdAt || 0) - (a?.createdAt || 0);
        })
        .map((item) => ({
          id: item.id,
          url: item.url,
          access: normalizarAcessoAvatar(item),
        }));
      if (data.length > 0) {
        setListaAvatares(data);
        const urls = data.map((item) => item.url);
        setAvatarSelecionado((prev) => (urls.includes(prev) ? prev : data[0].url));
      }
    });
    return () => unsub();
  }, []);

  const premiumAtivo = assinaturaPremiumAtiva(perfilDb);
  const premiumEntitlement = obterEntitlementPremiumGlobal(perfilDb);
  const membershipCriadorAtiva = algumaCreatorMembershipAtiva(perfilDb);
  const membershipsCriadorAtivas = listarMembershipsDeCriadorAtivas(perfilDb);
  const creatorApplicationStatus = String(perfilDb?.creatorApplicationStatus || '').trim().toLowerCase();
  const creatorMonetizationStatus = String(perfilDb?.creatorMonetizationStatus || '').trim().toLowerCase();
  const creatorReviewReason = String(perfilDb?.creatorReviewReason || '').trim();
  const creatorMonetizationReviewReason = String(perfilDb?.creatorMonetizationReviewReason || '').trim();
  const creatorModerationAction = String(perfilDb?.creatorModerationAction || '').trim().toLowerCase();
  const creatorSignupIntent = String(perfilDb?.signupIntent || '').trim().toLowerCase();
  const birthYearNumber = Number(birthYear);
  const isUnderageByBirthYear =
    Number.isInteger(birthYearNumber) &&
    birthYearNumber > 1900 &&
    new Date().getFullYear() - birthYearNumber < 18;
  const isCreatorCandidate = creatorSignupIntent === 'creator' || creatorApplicationStatus !== '';
  const podeUsarAvatarPremium = podeUsarAvataresPremiumDaLoja(user, perfilDb, accountType);
  const avataresLiberados = listaAvatares.filter((item) => {
    if (normalizarAcessoAvatar(item) === 'publico') return true;
    return podeUsarAvatarPremium;
  });

  useEffect(() => {
    if (!listaAvatares.length) return;
    const selecionado = listaAvatares.find((item) => item.url === avatarSelecionado);
    if (!selecionado) return;
    const bloqueado = normalizarAcessoAvatar(selecionado) === 'premium' && !podeUsarAvatarPremium;
    if (!bloqueado) return;
    const fallbackPublico = listaAvatares.find((item) => normalizarAcessoAvatar(item) === 'publico');
    if (fallbackPublico) {
      setAvatarSelecionado(fallbackPublico.url);
    }
  }, [avatarSelecionado, listaAvatares, podeUsarAvatarPremium]);

  useEffect(() => {
    const year = Number(birthYear);
    const currentYear = new Date().getFullYear();
    if (Number.isInteger(year) && year > 1900 && currentYear - year < 18) {
      setCreatorMonetizationPreference('publish_only');
    }
  }, [birthYear]);

  const handleSalvar = async (e) => {
    e.preventDefault();

    if (!novoNome.trim()) {
      setMensagem({ texto: 'Dê um nome à sua alma!', tipo: 'erro' });
      return;
    }

    const anoAtual = new Date().getFullYear();
    const ano = Number(birthYear);
    const membershipPrice = Number(String(creatorMembershipPriceBRL || '').replace(',', '.'));
    const suggestedDonation = Number(String(creatorDonationSuggestedBRL || '').replace(',', '.'));
    const notificationPrefs = {
      promotionsEmail: notifyPromotions === true,
    };
    if (birthYear && (!Number.isInteger(ano) || ano < 1900 || ano > anoAtual)) {
      setMensagem({ texto: 'Informe um ano de nascimento válido.', tipo: 'erro' });
      return;
    }

    const monetizationRequiresValues =
      adminAccess.isMangaka &&
      creatorMonetizationPreference === 'monetize' &&
      creatorMonetizationStatus !== 'blocked_underage';

    if (monetizationRequiresValues && (!Number.isFinite(membershipPrice) || membershipPrice < 1 || membershipPrice > 5000)) {
      setMensagem({ texto: 'Defina um valor de membership entre R$ 1,00 e R$ 5.000,00.', tipo: 'erro' });
      return;
    }
    if (monetizationRequiresValues && (!Number.isFinite(suggestedDonation) || suggestedDonation < 1 || suggestedDonation > 5000)) {
      setMensagem({ texto: 'Defina uma doacao sugerida entre R$ 1,00 e R$ 5.000,00.', tipo: 'erro' });
      return;
    }
    if (monetizationRequiresValues && creatorMembershipEnabled !== true) {
      setMensagem({ texto: 'Ative a membership do criador para concluir a monetizacao.', tipo: 'erro' });
      return;
    }

    setLoading(true);
    setMensagem({ texto: '', tipo: '' });

    try {
      const avatarEscolhido = listaAvatares.find((item) => item.url === avatarSelecionado);
      if (!avatarEscolhido) {
        setMensagem({ texto: 'Escolha um avatar valido da lista.', tipo: 'erro' });
        setLoading(false);
        return;
      }
      if (normalizarAcessoAvatar(avatarEscolhido) === 'premium' && !podeUsarAvatarPremium) {
        setMensagem({ texto: 'Avatar Premium exclusivo para conta Premium ativa.', tipo: 'erro' });
        setLoading(false);
        return;
      }

      const creatorPublicName = String(creatorDisplayName || novoNome || '').trim();
      const creatorProfilePatch = {
        creatorDisplayName: creatorPublicName,
        creatorBio: String(creatorBio || '').trim(),
        creatorBannerUrl: String(creatorBannerUrl || '').trim(),
        creatorMonetizationPreference: creatorMonetizationPreference,
        instagramUrl: String(instagramUrl || '').trim(),
        youtubeUrl: String(youtubeUrl || '').trim(),
        creatorMembershipEnabled: adminAccess.isMangaka && creatorMonetizationPreference === 'monetize' ? creatorMembershipEnabled : false,
        creatorMembershipPriceBRL: adminAccess.isMangaka && creatorMonetizationPreference === 'monetize' ? Math.round(membershipPrice * 100) / 100 : null,
        creatorDonationSuggestedBRL: adminAccess.isMangaka && creatorMonetizationPreference === 'monetize' ? Math.round(suggestedDonation * 100) / 100 : null,
        userName: novoNome.trim(),
        userAvatar: avatarSelecionado,
      };
      const projectedPerfil = {
        ...(perfilDb || {}),
        ...creatorProfilePatch,
      };
      const projectedOnboardingSteps = adminAccess.isMangaka
        ? buildCreatorOnboardingSteps({
            uid: user.uid,
            perfilDb: projectedPerfil,
            obrasVal: obrasValOnboarding,
            capsVal: capsValOnboarding,
            produtosVal: produtosValOnboarding,
            storeSkipped: creatorOnboardingStoreSkipped,
          })
        : [];
      const projectedOnboardingComplete = adminAccess.isMangaka
        ? creatorOnboardingIsRequiredComplete(projectedOnboardingSteps)
        : false;
      const nextOnboardingPath = adminAccess.isMangaka
        ? creatorOnboardingPrimaryNextPath(projectedOnboardingSteps)
        : '/';
      const creatorStatusNext = adminAccess.isMangaka
        ? (projectedOnboardingComplete ? 'active' : 'onboarding')
        : null;
      const creatorMonetizationStatusNext = !adminAccess.isMangaka
        ? null
        : creatorMonetizationPreference !== 'monetize'
          ? 'disabled'
          : (Number.isInteger(ano) && anoAtual - ano < 18)
            ? 'blocked_underage'
            : creatorMonetizationStatus === 'active'
              ? 'active'
              : 'pending_review';

      // 1. Atualiza no Firebase Auth
      await updateProfile(user, {
        displayName: novoNome.trim(),
        photoURL: avatarSelecionado,
      });

      // 2. Atualiza no Realtime Database (Leitor.jsx escuta daqui)
      await update(ref(db, `usuarios/${user.uid}`), {
        userName:   novoNome.trim(),
        userAvatar: avatarSelecionado,
        uid:        user.uid,
        notifyPromotions: notifyPromotions === true,
        notificationPrefs,
        gender,
        birthYear: birthYear ? ano : null,
        creatorDisplayName: creatorPublicName,
        creatorTermsAccepted: creatorTermsAccepted === true,
        creatorMonetizationPreference: creatorMonetizationPreference,
        creatorMonetizationStatus: creatorMonetizationStatusNext,
        creatorBio: String(creatorBio || '').trim(),
        creatorBannerUrl: String(creatorBannerUrl || '').trim(),
        instagramUrl: String(instagramUrl || '').trim(),
        youtubeUrl: String(youtubeUrl || '').trim(),
        creatorMembershipEnabled: adminAccess.isMangaka && creatorMonetizationPreference === 'monetize' ? creatorMembershipEnabled : false,
        creatorMembershipPriceBRL: adminAccess.isMangaka && creatorMonetizationPreference === 'monetize' ? Math.round(membershipPrice * 100) / 100 : null,
        creatorDonationSuggestedBRL: adminAccess.isMangaka && creatorMonetizationPreference === 'monetize' ? Math.round(suggestedDonation * 100) / 100 : null,
        creatorOnboardingCompleted: adminAccess.isMangaka ? projectedOnboardingComplete : null,
        creatorOnboardingCompletedAt: adminAccess.isMangaka && projectedOnboardingComplete ? Date.now() : null,
        creatorStatus: creatorStatusNext,
        creatorProfile: adminAccess.isMangaka ? {
          ...(perfilDb?.creatorProfile && typeof perfilDb.creatorProfile === 'object' ? perfilDb.creatorProfile : {}),
          creatorId: user.uid,
          userId: user.uid,
          displayName: creatorPublicName,
          username: perfilDb?.creatorProfile?.username || perfilDb?.creatorUsername || user.uid,
          bioShort: String(creatorBio || '').trim(),
          bioFull: String(creatorBio || '').trim(),
          avatarUrl: avatarSelecionado,
          bannerUrl: String(creatorBannerUrl || '').trim(),
          socialLinks: {
            instagramUrl: String(instagramUrl || '').trim() || null,
            youtubeUrl: String(youtubeUrl || '').trim() || null,
          },
          monetizationEnabled: creatorMonetizationStatusNext === 'active',
          monetizationPreference: creatorMonetizationPreference,
          monetizationStatus: creatorMonetizationStatusNext,
          ageVerified: Number.isInteger(ano) && ano > 1900,
          status: creatorStatusNext,
          stats: {
            followersCount: Number(perfilDb?.creatorProfile?.stats?.followersCount || perfilDb?.stats?.followersCount || 0),
            totalLikes: Number(perfilDb?.creatorProfile?.stats?.totalLikes || perfilDb?.stats?.totalLikes || 0),
            totalViews: Number(perfilDb?.creatorProfile?.stats?.totalViews || perfilDb?.stats?.totalViews || 0),
            totalComments: Number(perfilDb?.creatorProfile?.stats?.totalComments || perfilDb?.stats?.totalComments || 0),
          },
          updatedAt: Date.now(),
        } : null,
        lastLogin: Date.now(),
      });

      await update(ref(db, `usuarios_publicos/${user.uid}`), {
        uid: user.uid,
        userName: novoNome.trim(),
        userAvatar: avatarSelecionado,
        accountType,
        creatorDisplayName: creatorPublicName,
        creatorBio: String(creatorBio || '').trim(),
        creatorBannerUrl: String(creatorBannerUrl || '').trim(),
        instagramUrl: String(instagramUrl || '').trim(),
        youtubeUrl: String(youtubeUrl || '').trim(),
        creatorMonetizationPreference: creatorMonetizationPreference,
        creatorMonetizationStatus: creatorMonetizationStatusNext,
        creatorMembershipEnabled: creatorMonetizationStatusNext === 'active' && creatorMembershipEnabled === true,
        creatorMembershipPriceBRL: creatorMonetizationStatusNext === 'active' ? Math.round(membershipPrice * 100) / 100 : null,
        creatorDonationSuggestedBRL: creatorMonetizationStatusNext === 'active' ? Math.round(suggestedDonation * 100) / 100 : null,
        creatorStatus: creatorStatusNext,
        creatorProfile: adminAccess.isMangaka ? {
          creatorId: user.uid,
          userId: user.uid,
          displayName: creatorPublicName,
          username: perfilDb?.creatorProfile?.username || perfilDb?.creatorUsername || user.uid,
          bioShort: String(creatorBio || '').trim(),
          bioFull: String(creatorBio || '').trim(),
          avatarUrl: avatarSelecionado,
          bannerUrl: String(creatorBannerUrl || '').trim(),
          socialLinks: {
            instagramUrl: String(instagramUrl || '').trim() || null,
            youtubeUrl: String(youtubeUrl || '').trim() || null,
          },
          stats: {
            followersCount: Number(perfilDb?.creatorProfile?.stats?.followersCount || perfilDb?.stats?.followersCount || 0),
            totalLikes: Number(perfilDb?.creatorProfile?.stats?.totalLikes || perfilDb?.stats?.totalLikes || 0),
            totalViews: Number(perfilDb?.creatorProfile?.stats?.totalViews || perfilDb?.stats?.totalViews || 0),
            totalComments: Number(perfilDb?.creatorProfile?.stats?.totalComments || perfilDb?.stats?.totalComments || 0),
          },
          updatedAt: Date.now(),
        } : null,
        stats: adminAccess.isMangaka ? {
          followersCount: Number(perfilDb?.creatorProfile?.stats?.followersCount || perfilDb?.stats?.followersCount || 0),
          totalLikes: Number(perfilDb?.creatorProfile?.stats?.totalLikes || perfilDb?.stats?.totalLikes || 0),
          totalViews: Number(perfilDb?.creatorProfile?.stats?.totalViews || perfilDb?.stats?.totalViews || 0),
          totalComments: Number(perfilDb?.creatorProfile?.stats?.totalComments || perfilDb?.stats?.totalComments || 0),
        } : null,
        followersCount: adminAccess.isMangaka
          ? Number(perfilDb?.creatorProfile?.stats?.followersCount || perfilDb?.stats?.followersCount || 0)
          : null,
        notificationPrefs: {
          promotionsEmail: notifyPromotions === true,
        },
        updatedAt: Date.now(),
      });

      setMensagem({ texto: 'Perfil forjado com sucesso!', tipo: 'sucesso' });
      setTimeout(() => navigate(adminAccess.isMangaka ? nextOnboardingPath : '/'), 1200);

    } catch (error) {
      console.error('Erro na forja:', error);
      setMensagem({ texto: 'Erro ao atualizar: ' + error.message, tipo: 'erro' });
    } finally {
      setLoading(false);
    }
  };

  const handleSolicitarCriador = async () => {
    setCreatorApplicationLoading(true);
    setMensagem({ texto: '', tipo: '' });
    try {
      if (String(creatorDisplayName || '').trim().length < 3) {
        throw new Error('Informe um nome artistico com pelo menos 3 caracteres.');
      }
      if (String(creatorBio || '').trim().length < 20) {
        throw new Error('Escreva uma bio curta com pelo menos 20 caracteres.');
      }
      if (!String(instagramUrl || '').trim() && !String(youtubeUrl || '').trim()) {
        throw new Error('Informe pelo menos uma rede social para solicitar acesso de criador.');
      }
      if (creatorTermsAccepted !== true) {
        throw new Error('Voce precisa aceitar os termos do programa de criadores.');
      }
      const { data } = await creatorSubmitApplication({
        displayName: String(creatorDisplayName || '').trim(),
        bioShort: String(creatorBio || '').trim(),
        instagramUrl: String(instagramUrl || '').trim(),
        youtubeUrl: String(youtubeUrl || '').trim(),
        monetizationPreference: creatorMonetizationPreference,
        acceptTerms: true,
      });
      if (data?.alreadyMangaka) {
        setMensagem({ texto: 'Sua conta ja esta aprovada como criador.', tipo: 'sucesso' });
      } else if (data?.alreadyPending) {
        setMensagem({ texto: 'Sua solicitacao de criador ja esta em analise.', tipo: 'sucesso' });
      } else {
        setMensagem({ texto: 'Solicitacao enviada. A equipe vai revisar seu acesso de criador.', tipo: 'sucesso' });
      }
    } catch (err) {
      setMensagem({ texto: err?.message || 'Nao foi possivel enviar sua solicitacao agora.', tipo: 'erro' });
    } finally {
      setCreatorApplicationLoading(false);
    }
  };

  const persistOnboardingPrefs = async (patch) => {
    if (!user?.uid) return;
    setOnboardingUiBusy(true);
    try {
      await update(ref(db, `usuarios/${user.uid}`), patch);
    } catch (err) {
      setMensagem({ texto: err?.message || 'Nao foi possivel salvar preferencia.', tipo: 'erro' });
    } finally {
      setOnboardingUiBusy(false);
    }
  };

  const handleOcultarOnboardingChecklist = () => {
    setCreatorOnboardingChecklistHidden(true);
    persistOnboardingPrefs({ creatorOnboardingChecklistHidden: true });
  };

  const handleMostrarOnboardingChecklist = () => {
    setCreatorOnboardingChecklistHidden(false);
    persistOnboardingPrefs({ creatorOnboardingChecklistHidden: false });
  };

  const handlePularLojaOnboarding = () => {
    setCreatorOnboardingStoreSkipped(true);
    persistOnboardingPrefs({ creatorOnboardingStoreSkipped: true });
  };

  const handleMarkNotificationRead = async (notificationId) => {
    if (!notificationId) return;
    try {
      await markUserNotificationRead({ notificationId });
    } catch (err) {
      setMensagem({ texto: err?.message || 'Nao foi possivel marcar a notificacao como lida.', tipo: 'erro' });
    }
  };

  const handleMarkAllNotificationsRead = async () => {
    try {
      await markUserNotificationRead({ markAll: true });
    } catch (err) {
      setMensagem({ texto: err?.message || 'Nao foi possivel limpar as notificacoes.', tipo: 'erro' });
    }
  };

  const handleOpenNotification = async (item) => {
    if (!item?.id) return;
    const targetPath = item?.targetPath || item?.data?.readPath || item?.data?.creatorPath || '/perfil';
    await handleMarkNotificationRead(item.id);
    navigate(targetPath);
  };

  const scrollToMangakaFields = () => {
    mangakaFormAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  if (!user) return null; // guard enquanto o useEffect redireciona

  return (
    <main className="perfil-page">
      <div className="perfil-card">
        <h1 className="perfil-title">FORJA DE ALMA</h1>
        <p className="perfil-subtitle">Altere sua identidade em Kokuin</p>

        {adminAccess.isMangaka && user?.uid ? (
          <div className="perfil-mangaka-apoio">
            <p className="perfil-mangaka-apoio-label">
              Seu link de apoio (doações e premium atribuídos a você ao usar este link):
            </p>
            <div className="perfil-mangaka-apoio-row">
              <input
                type="text"
                readOnly
                className="perfil-mangaka-apoio-input"
                value={apoieUrlAbsolutaParaCriador(user.uid)}
                aria-label="URL de apoio com atribuição ao seu perfil"
              />
              <button
                type="button"
                className="perfil-mangaka-apoio-copy"
                onClick={async () => {
                  const url = apoieUrlAbsolutaParaCriador(user.uid);
                  try {
                    await navigator.clipboard.writeText(url);
                    setLinkApoioCopiado(true);
                    setTimeout(() => setLinkApoioCopiado(false), 2500);
                  } catch {
                    setMensagem({ texto: 'Não foi possível copiar. Selecione o link manualmente.', tipo: 'erro' });
                  }
                }}
              >
                {linkApoioCopiado ? 'Copiado' : 'Copiar'}
              </button>
              <button
                type="button"
                className="perfil-mangaka-apoio-copy"
                onClick={() => navigate(`/criador/${encodeURIComponent(user.uid)}`)}
              >
                Ver página pública
              </button>
            </div>
            <p className="perfil-mangaka-apoio-label">
              Monetizacao: <strong>{creatorMonetizationStatus || 'disabled'}</strong>
              {creatorMonetizationStatus === 'blocked_underage'
                ? ' - voce pode publicar, mas nao pode receber por ser menor de idade.'
                : creatorMonetizationStatus === 'active'
                  ? ' - membership e ganhos estao liberados.'
                  : creatorMonetizationStatus === 'pending_review'
                    ? ' - sua monetizacao aguarda validacao da equipe.'
                    : ' - sua conta esta no modo apenas publicar.'}
            </p>
            {creatorMonetizationReviewReason ? (
              <p className="perfil-mangaka-apoio-label">
                Ultima decisao de monetizacao: {creatorMonetizationReviewReason}
              </p>
            ) : null}
            {currentOnboardingStep ? (
              <p className="perfil-mangaka-apoio-label">
                Etapa atual do onboarding: <strong>{currentOnboardingStep.label}</strong>. {currentOnboardingStep.hint}
              </p>
            ) : null}
          </div>
        ) : null}

        {notifications.length > 0 ? (
          <section className="perfil-onboarding" aria-label="Notificacoes">
            <div className="perfil-onboarding-head">
              <h2 className="perfil-onboarding-title">Notificacoes</h2>
              <p className="perfil-onboarding-sub">Atualizacoes da conta e do programa de criadores.</p>
              <div className="perfil-onboarding-step-actions">
                <button type="button" className="perfil-onboarding-btn perfil-onboarding-btn--ghost" onClick={handleMarkAllNotificationsRead}>
                  Marcar todas como lidas
                </button>
              </div>
            </div>
            <ol className="perfil-onboarding-steps">
              {notifications.map((item) => (
                <li key={item.id} className={`perfil-onboarding-step ${item.read ? 'is-done' : ''}`}>
                  <span className="perfil-onboarding-step-status" aria-hidden="true">
                    {item.read ? 'OK' : '!'}
                  </span>
                  <div className="perfil-onboarding-step-body">
                    <div className="perfil-onboarding-step-title-row">
                      <strong>{item.title || 'Atualizacao'}</strong>
                    </div>
                    <p className="perfil-onboarding-step-hint">{item.message || 'Sem detalhes.'}</p>
                    <p className="perfil-onboarding-progress-label">
                      {formatarDataLongaBr(item.createdAt, { seVazio: 'Agora' })}
                    </p>
                    <div className="perfil-onboarding-step-actions">
                      <button
                        type="button"
                        className="perfil-onboarding-btn"
                        onClick={() => handleOpenNotification(item)}
                      >
                        Abrir
                      </button>
                      {!item.read ? (
                        <button type="button" className="perfil-onboarding-btn perfil-onboarding-btn--ghost" onClick={() => handleMarkNotificationRead(item.id)}>
                          Marcar como lida
                        </button>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        {!adminAccess.isMangaka && !adminAccess.canAccessAdmin ? (
          <div className="perfil-mangaka-apoio">
            <p className="perfil-mangaka-apoio-label">
              Quer publicar obras aqui? O perfil de criador libera pagina publica, catalogo proprio, capitulos,
              financeiro e membership por autor.
            </p>
            {creatorApplicationStatus === 'requested' ? (
              <p className="perfil-mangaka-apoio-label">
                Sua solicitacao esta em analise. Quando a equipe aprovar, o painel passa a abrir seu onboarding de
                criador.
              </p>
            ) : null}
            {creatorApplicationStatus === 'approved' ? (
              <p className="perfil-mangaka-apoio-label">
                Seu acesso de criador foi aprovado. Se o painel ainda nao mudou, recarregue a pagina para atualizar
                as permissoes da sua conta.
              </p>
            ) : null}
            {creatorApplicationStatus === 'rejected' ? (
              <p className="perfil-mangaka-apoio-label">
                Sua ultima solicitacao foi recusada. {creatorReviewReason ? `Motivo: ${creatorReviewReason}. ` : ''}Voce pode ajustar o perfil e enviar um novo pedido.
              </p>
            ) : null}
            {creatorModerationAction === 'banned' ? (
              <p className="perfil-mangaka-apoio-label">
                Sua conta foi bloqueada pela equipe. {creatorReviewReason ? `Motivo registrado: ${creatorReviewReason}.` : ''}
              </p>
            ) : null}
            {creatorModerationAction !== 'banned' && creatorApplicationStatus !== 'requested' && creatorApplicationStatus !== 'approved' ? (
              <>
                <div className="input-group">
                  <label>NOME ARTISTICO</label>
                  <input
                    type="text"
                    className="perfil-input"
                    value={creatorDisplayName}
                    onChange={(e) => setCreatorDisplayName(e.target.value)}
                    placeholder="Como voce quer aparecer publicamente"
                    maxLength={60}
                  />
                </div>
                <div className="input-group">
                  <label>BIO CURTA DO CRIADOR</label>
                  <textarea
                    className="perfil-input"
                    rows={3}
                    value={creatorBio}
                    onChange={(e) => setCreatorBio(e.target.value)}
                    placeholder="Explique em 1 ou 2 linhas quem voce e e o que cria."
                  />
                </div>
                <div className="input-group">
                  <label>BANNER PUBLICO</label>
                  <input
                    type="text"
                    className="perfil-input"
                    value={creatorBannerUrl}
                    onChange={(e) => setCreatorBannerUrl(e.target.value)}
                    placeholder="https://..."
                  />
                </div>
                <div className="input-group">
                  <label>MONETIZACAO</label>
                  <div className="perfil-mangaka-apoio-row">
                    <button
                      type="button"
                      className="perfil-mangaka-apoio-copy"
                      onClick={() => setCreatorMonetizationPreference('publish_only')}
                    >
                      Apenas publicar
                    </button>
                    <button
                      type="button"
                      className="perfil-mangaka-apoio-copy"
                      onClick={() => setCreatorMonetizationPreference('monetize')}
                      disabled={isUnderageByBirthYear}
                    >
                      Quero monetizar
                    </button>
                  </div>
                  <p className="perfil-mangaka-apoio-label">
                    {isUnderageByBirthYear
                      ? 'Conta menor de idade: publicacao liberada, monetizacao indisponivel por enquanto.'
                      : 'Publicar e monetizar sao escolhas separadas. Menores de idade podem publicar, mas nao recebem.'}
                  </p>
                </div>
                <div className="perfil-mangaka-apoio-row">
                  <div className="input-group perfil-creator-application-half">
                    <label>INSTAGRAM</label>
                    <input
                      type="text"
                      className="perfil-input"
                      value={instagramUrl}
                      onChange={(e) => setInstagramUrl(e.target.value)}
                      placeholder="instagram.com/seuperfil"
                    />
                  </div>
                  <div className="input-group perfil-creator-application-half">
                    <label>YOUTUBE</label>
                    <input
                      type="text"
                      className="perfil-input"
                      value={youtubeUrl}
                      onChange={(e) => setYoutubeUrl(e.target.value)}
                      placeholder="youtube.com/@seucanal"
                    />
                  </div>
                </div>
                <div className="input-group notify-group">
                  <label className="notify-label">
                    <input
                      type="checkbox"
                      checked={creatorTermsAccepted}
                      onChange={(e) => setCreatorTermsAccepted(e.target.checked)}
                    />
                    Aceito os termos do programa de criadores e entendo que a aprovacao nao substitui o onboarding.
                  </label>
                </div>
                <div className="perfil-mangaka-apoio-row">
                  <button
                    type="button"
                    className="perfil-mangaka-apoio-copy"
                    disabled={creatorApplicationLoading}
                    onClick={handleSolicitarCriador}
                  >
                    {creatorApplicationLoading
                      ? 'Enviando...'
                      : isCreatorCandidate
                        ? 'Enviar novo pedido de criador'
                        : 'Quero virar criador'}
                  </button>
                </div>
              </>
            ) : null}
          </div>
        ) : null}

        {adminAccess.isMangaka ? (
          <>
            {!creatorOnboardingChecklistHidden ? (
              <section className="perfil-onboarding" aria-label="Onboarding do criador">
                <div className="perfil-onboarding-head">
                  <h2 className="perfil-onboarding-title">Checklist do criador</h2>
                  <p className="perfil-onboarding-sub">
                    Conclua os passos para operar com perfil publico, catalogo e monetizacao. O progresso atualiza em
                    tempo real.
                  </p>
                  <div
                    className="perfil-onboarding-progress"
                    role="progressbar"
                    aria-valuenow={onboardingRequiredDone}
                    aria-valuemin={0}
                    aria-valuemax={onboardingRequiredAll}
                  >
                    <div
                      className="perfil-onboarding-progress-fill"
                      style={{
                        width: `${onboardingRequiredAll ? (100 * onboardingRequiredDone) / onboardingRequiredAll : 0}%`,
                      }}
                    />
                  </div>
                  <p className="perfil-onboarding-progress-label">
                    {onboardingRequiredDone}/{onboardingRequiredAll} obrigatorios
                    {onboardingAllRequiredComplete ? ' - tudo pronto para ir ao ar.' : ''}
                  </p>
                </div>
                <ol className="perfil-onboarding-steps">
                  {onboardingSteps.map((step) => (
                    <li
                      key={step.id}
                      className={`perfil-onboarding-step ${step.done ? 'is-done' : ''} ${step.optional ? 'is-optional' : ''}`}
                    >
                      <span className="perfil-onboarding-step-status" aria-hidden="true">
                        {step.done ? 'OK' : step.optional ? 'Opc.' : '-'}
                      </span>
                      <div className="perfil-onboarding-step-body">
                        <div className="perfil-onboarding-step-title-row">
                          <strong>{step.label}</strong>
                          {step.optional ? <span className="perfil-onboarding-optional-tag">Opcional</span> : null}
                        </div>
                        <p className="perfil-onboarding-step-hint">{step.hint}</p>
                        <div className="perfil-onboarding-step-actions">
                          {step.path ? (
                            <button
                              type="button"
                              className="perfil-onboarding-btn"
                              onClick={() => navigate(step.path)}
                            >
                              Abrir
                            </button>
                          ) : null}
                          {step.action === 'form' ? (
                            <button type="button" className="perfil-onboarding-btn" onClick={scrollToMangakaFields}>
                              Ir ao formulario
                            </button>
                          ) : null}
                          {step.id === 'store' && !step.done ? (
                            <button
                              type="button"
                              className="perfil-onboarding-btn perfil-onboarding-btn--ghost"
                              disabled={onboardingUiBusy}
                              onClick={handlePularLojaOnboarding}
                            >
                              Nao vou usar loja agora
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
                <div className="perfil-onboarding-foot">
                  <button
                    type="button"
                    className="perfil-onboarding-btn perfil-onboarding-btn--ghost"
                    disabled={onboardingUiBusy}
                    onClick={handleOcultarOnboardingChecklist}
                  >
                    Ocultar checklist
                  </button>
                  <div className="perfil-onboarding-shortcuts">
                    <button type="button" className="perfil-onboarding-btn" onClick={() => navigate('/creator/obras')}>
                      Obras
                    </button>
                    <button type="button" className="perfil-onboarding-btn" onClick={() => navigate('/creator/capitulos')}>
                      Capitulos
                    </button>
                    <button
                      type="button"
                      className="perfil-onboarding-btn"
                      onClick={() => navigate('/creator/promocoes')}
                    >
                      Monetizacao
                    </button>
                  </div>
                </div>
              </section>
            ) : (
              <div className="perfil-mangaka-apoio">
                <p className="perfil-mangaka-apoio-label">Checklist do criador oculto.</p>
                <div className="perfil-mangaka-apoio-row">
                  <button
                    type="button"
                    className="perfil-mangaka-apoio-copy"
                    disabled={onboardingUiBusy}
                    onClick={handleMostrarOnboardingChecklist}
                  >
                    Mostrar checklist
                  </button>
                  <button type="button" className="perfil-mangaka-apoio-copy" onClick={() => navigate('/creator/obras')}>
                    Obras
                  </button>
                  <button type="button" className="perfil-mangaka-apoio-copy" onClick={() => navigate('/creator/capitulos')}>
                    Capitulos
                  </button>
                </div>
              </div>
            )}
          </>
        ) : null}

        <form onSubmit={handleSalvar}>
          <div className="avatar-big-preview">
            <div className="circle-wrap">
              <img
                src={avatarSelecionado}
                alt="Preview Avatar"
                onError={(e) => { e.target.src = AVATAR_FALLBACK; }}
              />
            </div>
          </div>

          <div className="input-group">
            <label>NOME DE EXIBIÇÃO</label>
            <input
              type="text"
              className="perfil-input"
              value={novoNome}
              onChange={(e) => setNovoNome(e.target.value)}
              maxLength={DISPLAY_NAME_MAX_LENGTH}
              placeholder="Ex: Guerreiro de Brajiru"
            />
          </div>

          <div className="input-group">
            <label>ANO DE NASCIMENTO</label>
            <input
              type="number"
              className="perfil-input"
              value={birthYear}
              onChange={(e) => setBirthYear(e.target.value)}
              placeholder="Ex: 2001"
              min="1900"
              max={new Date().getFullYear()}
            />
          </div>

          <div className="input-group">
            <label>SEXO</label>
            <select
              className="perfil-input"
              value={gender}
              onChange={(e) => setGender(e.target.value)}
            >
              <option value="nao_informado">Prefiro não informar</option>
              <option value="masculino">Masculino</option>
              <option value="feminino">Feminino</option>
              <option value="outro">Outro</option>
            </select>
          </div>

          <div className="input-group">
            <label>TIPO DE CONTA</label>
            <div
              className={`account-type-badge ${
                accountType === 'admin' ? 'admin' : accountType !== 'comum' ? 'premium' : ''
              }`}
            >
              {accountType === 'admin'
                ? 'Conta Admin'
                : accountType === 'membro' || accountType === 'premium'
                  ? 'Conta Premium'
                  : 'Conta Comum'}
            </div>
          </div>

            {adminAccess.isMangaka ? (
              <>
                <div ref={mangakaFormAnchorRef} className="perfil-mangaka-fields-anchor" aria-hidden="true" />
                <div className="input-group">
                  <label>NOME PUBLICO DO CRIADOR</label>
                  <input
                    type="text"
                    className="perfil-input"
                    value={creatorDisplayName}
                    onChange={(e) => setCreatorDisplayName(e.target.value)}
                    placeholder="Como seu nome deve aparecer para leitores"
                    maxLength={60}
                  />
                </div>
                <div className="input-group">
                  <label>MONETIZACAO DO CRIADOR</label>
                  <div className="perfil-mangaka-apoio-row">
                    <button
                      type="button"
                      className="perfil-mangaka-apoio-copy"
                      onClick={() => setCreatorMonetizationPreference('publish_only')}
                    >
                      Apenas publicar
                    </button>
                    <button
                      type="button"
                      className="perfil-mangaka-apoio-copy"
                      onClick={() => setCreatorMonetizationPreference('monetize')}
                      disabled={creatorMonetizationStatus === 'blocked_underage' || isUnderageByBirthYear}
                    >
                      Monetizar
                    </button>
                  </div>
                  <p className="perfil-mangaka-apoio-label">
                    {creatorMonetizationStatus === 'blocked_underage'
                      ? 'Monetizacao bloqueada por idade. Sua conta pode publicar normalmente.'
                      : creatorMonetizationPreference === 'monetize'
                        ? 'Membership e ganhos ficam disponiveis apenas com validacao da equipe.'
                        : 'Modo publicar: voce pode postar normalmente sem receber pelas obras.'}
                  </p>
                </div>

                <div className="input-group">
                <label>BIO PÚBLICA DO CRIADOR</label>
                  <textarea
                  className="perfil-input"
                  rows={4}
                  value={creatorBio}
                  onChange={(e) => setCreatorBio(e.target.value)}
                  placeholder="Apresente seu universo, seu estilo e o que voce publica."
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

              <div className="input-group">
                <label>BANNER PUBLICO</label>
                <input
                  type="text"
                  className="perfil-input"
                  value={creatorBannerUrl}
                  onChange={(e) => setCreatorBannerUrl(e.target.value)}
                  placeholder="https://..."
                />
              </div>

              {creatorMonetizationPreference === 'monetize' ? (
              <div className="input-group">
                <label>MEMBERSHIP DO CRIADOR</label>
                <label className="notify-label">
                  <input
                    type="checkbox"
                    checked={creatorMembershipEnabled}
                    onChange={(e) => setCreatorMembershipEnabled(e.target.checked)}
                  />
                  Ativar assinatura do criador na página pública
                </label>
              </div>
              ) : null}

              {creatorMonetizationPreference === 'monetize' ? (
              <div className="input-group">
                <label>VALOR DA MEMBERSHIP (R$)</label>
                <input
                  type="text"
                  className="perfil-input"
                  value={creatorMembershipPriceBRL}
                  onChange={(e) => setCreatorMembershipPriceBRL(e.target.value)}
                  placeholder="12,00"
                />
              </div>
              ) : null}

              {creatorMonetizationPreference === 'monetize' ? (
              <div className="input-group">
                <label>DOAÇÃO SUGERIDA (R$)</label>
                <input
                  type="text"
                  className="perfil-input"
                  value={creatorDonationSuggestedBRL}
                  onChange={(e) => setCreatorDonationSuggestedBRL(e.target.value)}
                  placeholder="7,00"
                />
              </div>
              ) : null}
            </>
          ) : null}

          {premiumAtivo && typeof premiumEntitlement?.memberUntil === 'number' && (() => {
            const tempo = formatarTempoRestanteAssinatura(premiumEntitlement.memberUntil);
            return (
            <div className="input-group perfil-premium-linha">
              <label>ASSINATURA PREMIUM</label>
              <p className="perfil-premium-msg">
                Ativa até{' '}
                <strong>
                  {formatarDataLongaBr(premiumEntitlement.memberUntil, { seVazio: '—' })}
                </strong>
                .
              </p>
              {tempo.ativo && (
                <p className="perfil-premium-tempo">{tempo.texto}</p>
              )}
              <p className="perfil-premium-msg perfil-premium-msg--foot">
                Renove pelo checkout Premium da plataforma. Se entrar por um link de criador, a atribuicao financeira pode mudar, mas os beneficios continuam globais.
              </p>
            </div>
            );
          })()}

          {membershipCriadorAtiva && (
            <div className="input-group perfil-premium-linha">
              <label>MEMBERSHIP DE CRIADOR</label>
              <p className="perfil-premium-msg">
                Voce tem membership ativa de criador. Esse beneficio libera acesso antecipado somente nas obras dos autores assinados.
              </p>
              {membershipsCriadorAtivas.length > 0 ? (
                <ul className="perfil-membership-list">
                  {membershipsCriadorAtivas.map((item) => (
                    <li key={item.creatorId}>
                      <strong>{item.creatorName || item.creatorId}</strong> ate{' '}
                      <span>{formatarDataLongaBr(item.memberUntil, { seVazio: '—' })}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          )}

          <div className="avatar-selection-section">
            <label>ESCOLHA SEU NOVO VISUAL</label>
            {!podeUsarAvatarPremium && (
              <p className="avatar-premium-hint">
                Avatares com selo <strong>Premium</strong> aparecem para você visualizar, mas só podem ser usados
                por assinantes ativos.
              </p>
            )}
            <div className="avatar-options-grid">
              {listaAvatares.map((item, i) => {
                const bloqueado = normalizarAcessoAvatar(item) === 'premium' && !podeUsarAvatarPremium;
                const ativo = avatarSelecionado === item.url;
                return (
                <div
                  key={item.id || i}
                  className={`avatar-option-card ${ativo ? 'active' : ''} ${bloqueado ? 'locked' : ''}`}
                  onClick={() => !bloqueado && setAvatarSelecionado(item.url)}
                  title={bloqueado ? 'Disponivel apenas para conta Premium ativa' : 'Selecionar avatar'}
                >
                  <img
                    src={item.url}
                    alt={`Opção ${i + 1}`}
                    onError={(e) => { e.target.src = AVATAR_FALLBACK; }}
                  />
                  {normalizarAcessoAvatar(item) === 'premium' && (
                    <span className="avatar-tier-tag">Premium</span>
                  )}
                  {bloqueado && <span className="avatar-lock">Bloq.</span>}
                </div>
              );
              })}
            </div>
            <p className="avatar-selection-summary">
              {podeUsarAvatarPremium
                ? `Voce pode usar todos os ${listaAvatares.length} avatares disponiveis.`
                : `Disponiveis para sua conta: ${avataresLiberados.length} de ${listaAvatares.length}.`}
            </p>
          </div>

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

          {mensagem.texto && (
            <p className={`feedback-msg ${mensagem.tipo}`}>{mensagem.texto}</p>
          )}

          <div className="perfil-actions">
            <button type="submit" className="btn-save-perfil" disabled={loading}>
              {loading ? 'SINCRONIZANDO...' : 'SALVAR ALTERAÇÕES'}
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
