// src/pages/Perfil/Perfil.jsx
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { ref, get, onValue } from 'firebase/database';
import { useLocation, useNavigate } from 'react-router-dom';

import { db, storage } from '../../services/firebase';
import {
  LISTA_AVATARES,
  AVATAR_FALLBACK,
  CREATOR_BIO_MAX_LENGTH,
  CREATOR_BIO_MIN_LENGTH_PUBLISH_ONLY,
} from '../../constants';
import {
  podeUsarAvataresPremiumDaLoja,
  obterEntitlementPremiumGlobal,
} from '../../utils/capituloLancamento';
import { emptyAdminAccess } from '../../auth/adminAccess';
import { APP_ROLE } from '../../auth/appRoles';
import { apoieUrlAbsolutaParaCriador } from '../../utils/creatorSupportPaths';
import { normalizarAcessoAvatar } from '../../utils/avatarAccess';
import {
  ageFromBirthDateLocal,
  birthDateFromYearOnly,
  formatBirthDateIsoToBr,
  parseBirthDateFlexible,
  parseBirthDateLocal,
} from '../../utils/birthDateAge';
import {
  effectiveCreatorMonetizationStatus,
  resolveCreatorMonetizationEligibilityFromDb,
  resolveCreatorMonetizationApplicationStatusFromDb,
  resolveCreatorMonetizationPreferenceFromDb,
  resolveCreatorSupportOfferFromDb,
  resolveCreatorMonetizationStatusFromDb,
  resolveCreatorMonetizationUiState,
} from '../../utils/creatorMonetizationUi';
import { PERFIL_LOJA_DADOS_HASH } from '../../utils/brazilianStates';
import { normalizeBuyerProfile } from '../../utils/storeBuyerProfile';
import { normalizeUsernameInput, validateUsernameHandle } from '../../utils/usernameValidation';
import { resolvePublicProfilePath } from '../../utils/publicProfilePaths';
import { isTrustedPlatformAssetUrl } from '../../utils/trustedAssetUrls';
import PerfilCreatorView from './components/PerfilCreatorView.jsx';
import PerfilBuyerDeliveryFields from './components/PerfilBuyerDeliveryFields.jsx';
import PerfilReaderView from './components/PerfilReaderView.jsx';
import { usePerfilFormPrompts } from './hooks/usePerfilFormPrompts';
import { usePerfilSave } from './hooks/usePerfilSave';
import './Perfil.css';

function isTrustedProfileImageUrl(url) {
  return isTrustedPlatformAssetUrl(url, {
    allowLocalAssets: true,
    allowedExtensions: ['.jpg', '.jpeg', '.png', '.webp'],
  });
}

export default function Perfil({
  user,
  adminAccess = emptyAdminAccess(),
  shellRole = null,
  isMangakaEffective = null,
  suppressCreatorProfileUi = false,
}) {
  const navigate = useNavigate();
  const location = useLocation();

  const resolvedShellRole = shellRole || APP_ROLE.USER;
  const resolvedIsMangaka =
    typeof isMangakaEffective === 'boolean'
      ? isMangakaEffective
      : resolvedShellRole === APP_ROLE.CREATOR;
  const resolvedAdminAccess = useMemo(() => {
    if (resolvedIsMangaka) {
      return { ...adminAccess, isMangaka: true, canAccessAdmin: false, panelRole: 'mangaka' };
    }
    if (resolvedShellRole === APP_ROLE.ADMIN) {
      return { ...adminAccess, isMangaka: false };
    }
    return { ...adminAccess, isMangaka: false };
  }, [adminAccess, resolvedIsMangaka, resolvedShellRole]);

  const [novoNome, setNovoNome] = useState('');
  const [avatarSelecionado, setAvatarSelecionado] = useState('');
  const [notifyPromotions, setNotifyPromotions] = useState(false);
  const [notifyCommentSocial, setNotifyCommentSocial] = useState(true);
  const [listaAvatares, setListaAvatares] = useState(
    LISTA_AVATARES.map((url, index) => ({
      id: `legacy-${index}`,
      url,
      access: 'publico',
    }))
  );
  const [gender, setGender] = useState('nao_informado');
  const [birthDate, setBirthDate] = useState('');
  const [birthDateDraft, setBirthDateDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [mensagem, setMensagem] = useState({ texto: '', tipo: '' });
  const [perfilDb, setPerfilDb] = useState(null);
  const [creatorStatsLive, setCreatorStatsLive] = useState(null);
  const [creatorBio, setCreatorBio] = useState('');
  const [creatorDisplayName, setCreatorDisplayName] = useState('');
  const [mangakaAvatarUrlDraft, setMangakaAvatarUrlDraft] = useState('');
  const [mangakaAvatarFile, setMangakaAvatarFile] = useState(null);
  const [instagramUrl, setInstagramUrl] = useState('');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [creatorTermsAccepted, setCreatorTermsAccepted] = useState(false);
  const [creatorMonetizationPreference, setCreatorMonetizationPreference] = useState('publish_only');
  const [creatorMembershipEnabled, setCreatorMembershipEnabled] = useState(true);
  const [creatorMembershipPriceBRL, setCreatorMembershipPriceBRL] = useState('12');
  const [creatorDonationSuggestedBRL, setCreatorDonationSuggestedBRL] = useState('7');
  const [buyerFullName, setBuyerFullName] = useState('');
  const [buyerCpf, setBuyerCpf] = useState('');
  const [buyerPhone, setBuyerPhone] = useState('');
  const [buyerPostalCode, setBuyerPostalCode] = useState('');
  const [buyerState, setBuyerState] = useState('');
  const [buyerCity, setBuyerCity] = useState('');
  const [buyerNeighborhood, setBuyerNeighborhood] = useState('');
  const [buyerAddressLine1, setBuyerAddressLine1] = useState('');
  const [buyerAddressLine2, setBuyerAddressLine2] = useState('');
  const [userHandleDraft, setUserHandleDraft] = useState('');
  const [usernameCheck, setUsernameCheck] = useState({ status: 'idle', message: '' });
  const [underageMonetizeModalOpen, setUnderageMonetizeModalOpen] = useState(false);
  const [readerProfilePublicDraft, setReaderProfilePublicDraft] = useState(false);
  const [lojaAvatarAuthorUnlocked, setLojaAvatarAuthorUnlocked] = useState(false);
  const mangakaFormAnchorRef = useRef(null);
  const mangakaBirthInputRef = useRef(null);
  const usernameInputRef = useRef(null);
  const mangakaAvatarPreserveRef = useRef(false);
  const savedUserAvatarRef = useRef('');

  useEffect(() => {
    mangakaAvatarPreserveRef.current = resolvedIsMangaka;
  }, [resolvedIsMangaka]);

  const [buyerProfileExpanded, setBuyerProfileExpanded] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.location.hash.replace(/^#/, '') === PERFIL_LOJA_DADOS_HASH;
    } catch {
      return false;
    }
  });

  const isStaffAdmin = resolvedShellRole === APP_ROLE.ADMIN;

  usePerfilFormPrompts({
    location,
    birthDate,
    birthDateDraft,
    perfilDbHandle: perfilDb?.userHandle,
    userHandleDraft,
    setMensagem,
    setBuyerProfileExpanded,
    mangakaBirthInputRef,
    usernameInputRef,
  });

  useEffect(() => {
    const carregarPerfil = async () => {
      const snap = await get(ref(db, `usuarios/${user.uid}`));
      const perfil = snap.val() || {};
      const creatorProfileDoc =
        perfil?.creator?.profile && typeof perfil.creator.profile === 'object'
          ? perfil.creator.profile
          : {};
      const creatorSocialDoc =
        perfil?.creator?.social && typeof perfil.creator.social === 'object'
          ? perfil.creator.social
          : {};

      setPerfilDb(perfil);
      setNotifyPromotions(Boolean(perfil.notifyPromotions));
      setNotifyCommentSocial(perfil.notificationPrefs?.commentSocialInApp !== false);
      setGender(perfil.gender || 'nao_informado');

      const fromDb = String(perfil.birthDate || '').trim();
      let birthIso = '';
      if (fromDb && parseBirthDateLocal(fromDb)) {
        birthIso = fromDb;
      } else if (typeof perfil.birthYear === 'number' && perfil.birthYear > 1900) {
        birthIso = birthDateFromYearOnly(String(perfil.birthYear));
      }
      setBirthDate(birthIso);
      setBirthDateDraft(birthIso ? formatBirthDateIsoToBr(birthIso) : '');

      const publicName = String(creatorProfileDoc.displayName || perfil.userName || user.displayName || '').trim();
      setCreatorDisplayName(publicName);
      setNovoNome(publicName || String(perfil.userName || user.displayName || '').trim() || '');
      setUserHandleDraft(String(perfil.userHandle || '').trim().toLowerCase());
      setCreatorBio(String(creatorProfileDoc.bio || '').trim().slice(0, CREATOR_BIO_MAX_LENGTH));
      setInstagramUrl(String(creatorSocialDoc.instagram || '').trim());
      setYoutubeUrl(String(creatorSocialDoc.youtube || '').trim());
      setCreatorTermsAccepted(Boolean(perfil.creatorTermsAccepted));
      setCreatorMonetizationPreference(resolveCreatorMonetizationPreferenceFromDb(perfil));

      const creatorSupportOffer = resolveCreatorSupportOfferFromDb(perfil);
      setCreatorMembershipEnabled(creatorSupportOffer.membershipEnabled === true);
      setCreatorMembershipPriceBRL(
        creatorSupportOffer.membershipPriceBRL != null ? String(creatorSupportOffer.membershipPriceBRL) : '12'
      );
      setCreatorDonationSuggestedBRL(
        creatorSupportOffer.donationSuggestedBRL != null ? String(creatorSupportOffer.donationSuggestedBRL) : '7'
      );

      const buyerProfile = normalizeBuyerProfile(perfil.buyerProfile);
      setBuyerFullName(buyerProfile.fullName);
      setBuyerCpf(buyerProfile.cpf);
      setBuyerPhone(buyerProfile.phone);
      setBuyerPostalCode(buyerProfile.postalCode);
      setBuyerState(buyerProfile.state);
      setBuyerCity(buyerProfile.city);
      setBuyerNeighborhood(buyerProfile.neighborhood);
      setBuyerAddressLine1(buyerProfile.addressLine1);
      setBuyerAddressLine2(buyerProfile.addressLine2);

      const ua = isTrustedProfileImageUrl(String(perfil.userAvatar || '').trim())
        ? String(perfil.userAvatar || '').trim()
        : '';
      const readerAvatar = isTrustedProfileImageUrl(String(perfil.readerProfileAvatarUrl || '').trim())
        ? String(perfil.readerProfileAvatarUrl || '').trim()
        : '';
      const authPhoto = isTrustedProfileImageUrl(String(user.photoURL || '').trim())
        ? String(user.photoURL || '').trim()
        : '';
      const resolvedAvatar = ua || readerAvatar || authPhoto;
      savedUserAvatarRef.current = resolvedAvatar;
      if (resolvedAvatar) setAvatarSelecionado(resolvedAvatar);

      setReaderProfilePublicDraft(resolvedIsMangaka ? true : Boolean(perfil.readerProfilePublic));
    };

    if (!user) {
      navigate('/login');
      return;
    }

    carregarPerfil().catch(() => setNotifyPromotions(false));
  }, [user, navigate, resolvedIsMangaka]);

  useEffect(() => {
    if (!user?.uid) return () => {};
    const unsub = onValue(ref(db, `creators/${user.uid}/stats`), (snap) => {
      setCreatorStatsLive(snap.exists() ? snap.val() || null : null);
    });
    return () => unsub();
  }, [user?.uid]);

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
        setAvatarSelecionado((prev) => {
          const current = String(prev || '').trim();
          const saved = String(savedUserAvatarRef.current || '').trim();
          if (isTrustedProfileImageUrl(current) && !urls.includes(current)) return current;
          if (isTrustedProfileImageUrl(saved) && !urls.includes(saved)) return saved;
          if (urls.includes(current)) return current;
          if (!current && saved) return saved;
          if (saved && current === saved) return current;
          if (mangakaAvatarPreserveRef.current && isTrustedProfileImageUrl(current)) return current;
          return data[0].url;
        });
      }
    });
    return () => unsub();
  }, []);

  const mangakaAvatarLocalPreview = useMemo(
    () => (mangakaAvatarFile ? URL.createObjectURL(mangakaAvatarFile) : ''),
    [mangakaAvatarFile]
  );

  useEffect(() => {
    if (!mangakaAvatarLocalPreview) return undefined;
    return () => URL.revokeObjectURL(mangakaAvatarLocalPreview);
  }, [mangakaAvatarLocalPreview]);

  const perfilAvatarPreviewSrc =
    mangakaAvatarLocalPreview ||
    (resolvedIsMangaka && isTrustedProfileImageUrl(String(mangakaAvatarUrlDraft || '').trim())
      ? String(mangakaAvatarUrlDraft).trim()
      : avatarSelecionado);

  const creatorApplicationStatus = String(perfilDb?.creatorApplicationStatus || '').trim().toLowerCase();
  const creatorMonetizationApplicationStatus = resolveCreatorMonetizationApplicationStatusFromDb(perfilDb || {});
  const creatorMonetizationStatus = resolveCreatorMonetizationStatusFromDb(perfilDb || {});
  const perfilComStats = useMemo(() => {
    const base = perfilDb && typeof perfilDb === 'object' ? perfilDb : {};
    if (!creatorStatsLive) return base;
    return { ...base, creatorsStats: creatorStatsLive };
  }, [perfilDb, creatorStatsLive]);

  const creatorMonetizationStatusEffective = effectiveCreatorMonetizationStatus(
    creatorMonetizationPreference,
    creatorMonetizationStatus
  );
  const creatorReviewReason = String(perfilDb?.creatorReviewReason || '').trim();
  const creatorModerationAction = String(perfilDb?.creatorModerationAction || '').trim().toLowerCase();
  const birthIsoEffective = parseBirthDateFlexible(birthDateDraft, birthDate);
  const birthAge = birthIsoEffective ? ageFromBirthDateLocal(birthIsoEffective) : null;
  const isUnderageByBirthYear = birthAge != null && birthAge < 18;
  const isCreatorDraft = creatorApplicationStatus === 'draft';
  const isCreatorCandidate =
    creatorApplicationStatus === 'draft' ||
    creatorApplicationStatus === 'requested' ||
    creatorApplicationStatus === 'rejected' ||
    creatorApplicationStatus === 'approved';
  const podeUsarAvatarPremium = podeUsarAvataresPremiumDaLoja(user, perfilDb, resolvedAdminAccess);
  const avataresLiberados = listaAvatares.filter((item) => {
    if (normalizarAcessoAvatar(item) === 'publico') return true;
    return podeUsarAvatarPremium;
  });
  const creatorDisplayLabel = String(creatorDisplayName || novoNome || user?.displayName || '').trim() || 'Criador';
  const creatorHandleLocked = String(perfilDb?.userHandle || '').trim().toLowerCase();
  const creatorSupportUrl = user?.uid ? apoieUrlAbsolutaParaCriador(user.uid) : '';
  const publicProfileHandlePreview = creatorHandleLocked || normalizeUsernameInput(userHandleDraft);
  const creatorPublicPath = resolvePublicProfilePath(
    { uid: user?.uid || '', userHandle: publicProfileHandlePreview },
    user?.uid || ''
  );
  const readerPublicPath = resolvePublicProfilePath(
    { uid: user?.uid || '', userHandle: publicProfileHandlePreview },
    user?.uid || '',
    { tab: 'likes' }
  );
  const needsFirstMonetizationApplication =
    resolvedIsMangaka && creatorMonetizationApplicationStatus === 'not_requested';
  const monetizacaoBloqueadaPorIdade = creatorMonetizationStatus === 'blocked_underage' || isUnderageByBirthYear;
  const monetizationEligibility = resolveCreatorMonetizationEligibilityFromDb(perfilComStats || {});
  const monetizationUiState = resolveCreatorMonetizationUiState(perfilComStats || {});

  const handleMonetizarContaClick = () => {
    if (monetizacaoBloqueadaPorIdade) {
      setUnderageMonetizeModalOpen(true);
      return;
    }
    if (monetizationUiState.key === 'locked_by_level') {
      navigate('/creator/monetizacao');
      return;
    }
    navigate('/creator/onboarding?intent=mangaka_monetize');
  };

  const handleDesativarMonetizacaoClick = () => {
    navigate('/creator/monetizacao');
  };

  const premiumEntitlement = obterEntitlementPremiumGlobal(perfilDb || {});
  const premiumAtivo = premiumEntitlement.isPremium === true;
  const membershipCriadorAtiva = false;
  const membershipsCriadorAtivas = [];

  useEffect(() => {
    if (!listaAvatares.length) return;
    const selecionado = listaAvatares.find((item) => item.url === avatarSelecionado);
    if (!selecionado) return undefined;
    const bloqueado = normalizarAcessoAvatar(selecionado) === 'premium' && !podeUsarAvatarPremium;
    if (!bloqueado) return undefined;
    const fallbackPublico = listaAvatares.find((item) => normalizarAcessoAvatar(item) === 'publico');
    if (fallbackPublico) {
      const timeoutId = window.setTimeout(() => setAvatarSelecionado(fallbackPublico.url), 0);
      return () => window.clearTimeout(timeoutId);
    }
    return undefined;
  }, [avatarSelecionado, listaAvatares, podeUsarAvatarPremium]);

  useEffect(() => {
    const iso = parseBirthDateFlexible(birthDateDraft, birthDate);
    const age = iso ? ageFromBirthDateLocal(iso) : null;
    if (age != null && age < 18) {
      const timeoutId = window.setTimeout(() => setCreatorMonetizationPreference('publish_only'), 0);
      return () => window.clearTimeout(timeoutId);
    }
    return undefined;
  }, [birthDate, birthDateDraft]);

  useEffect(() => {
    if (!user?.uid) return undefined;
    const locked = String(perfilDb?.userHandle || '').trim().toLowerCase();
    if (locked) {
      const timeoutId = window.setTimeout(() => setUsernameCheck({ status: 'idle', message: '' }), 0);
      return () => window.clearTimeout(timeoutId);
    }
    const norm = normalizeUsernameInput(userHandleDraft);
    if (!norm) {
      const timeoutId = window.setTimeout(() => setUsernameCheck({ status: 'idle', message: '' }), 0);
      return () => window.clearTimeout(timeoutId);
    }
    const validation = validateUsernameHandle(norm);
    if (!validation.ok) {
      const timeoutId = window.setTimeout(
        () => setUsernameCheck({ status: 'invalid', message: validation.message }),
        0
      );
      return () => window.clearTimeout(timeoutId);
    }
    const checkingTimeoutId = window.setTimeout(
      () => setUsernameCheck({ status: 'checking', message: 'Verificando...' }),
      0
    );
    const timeoutId = window.setTimeout(() => {
      get(ref(db, `usernames/${norm}`))
        .then((snap) => {
          if (snap.exists() && snap.val() !== user.uid) {
            setUsernameCheck({ status: 'taken', message: 'Ja em uso' });
          } else {
            setUsernameCheck({ status: 'ok', message: 'Disponivel' });
          }
        })
        .catch(() => setUsernameCheck({ status: 'idle', message: '' }));
    }, 400);
    return () => {
      window.clearTimeout(checkingTimeoutId);
      window.clearTimeout(timeoutId);
    };
  }, [user?.uid, userHandleDraft, perfilDb?.userHandle]);

  const { handleSalvar, handleCopyCreatorSupportLink } = usePerfilSave({
    adminAccess: resolvedAdminAccess,
    avatarSelecionado,
    buyerAddressLine1,
    buyerAddressLine2,
    buyerCity,
    buyerCpf,
    buyerFullName,
    buyerNeighborhood,
    buyerPhone,
    buyerPostalCode,
    buyerState,
    birthDate,
    birthDateDraft,
    creatorBio,
    creatorDisplayName,
    creatorSupportUrl,
    creatorTermsAccepted,
    db,
    gender,
    instagramUrl,
    listaAvatares,
    mangakaAvatarFile,
    mangakaAvatarUrlDraft,
    navigate,
    newDisplayName: novoNome,
    notifyCommentSocial,
    notifyPromotions,
    perfilDb,
    podeUsarAvatarPremium,
    readerProfilePublicDraft,
    savedUserAvatarRef,
    setAvatarSelecionado,
    setBirthDate,
    setBirthDateDraft,
    setCreatorDisplayName,
    setLoading,
    setMangakaAvatarFile,
    setMangakaAvatarUrlDraft,
    setMensagem,
    setNovoNome,
    setPerfilDb,
    setReaderProfilePublicDraft,
    setUserHandleDraft,
    storage,
    user,
    userHandleDraft,
    usernameCheck,
    youtubeUrl,
  });

  const lojaBuyerInputs = (
    <PerfilBuyerDeliveryFields
      buyerFullName={buyerFullName}
      setBuyerFullName={setBuyerFullName}
      buyerCpf={buyerCpf}
      setBuyerCpf={setBuyerCpf}
      buyerPhone={buyerPhone}
      setBuyerPhone={setBuyerPhone}
      buyerPostalCode={buyerPostalCode}
      setBuyerPostalCode={setBuyerPostalCode}
      buyerState={buyerState}
      setBuyerState={setBuyerState}
      buyerCity={buyerCity}
      setBuyerCity={setBuyerCity}
      buyerNeighborhood={buyerNeighborhood}
      setBuyerNeighborhood={setBuyerNeighborhood}
      buyerAddressLine1={buyerAddressLine1}
      setBuyerAddressLine1={setBuyerAddressLine1}
      buyerAddressLine2={buyerAddressLine2}
      setBuyerAddressLine2={setBuyerAddressLine2}
    />
  );

  if (!user) return null;

  if (resolvedIsMangaka && !suppressCreatorProfileUi) {
    return (
      <PerfilCreatorView
        navigate={navigate}
        handleSalvar={handleSalvar}
        handleCopyCreatorSupportLink={handleCopyCreatorSupportLink}
        handleDesativarMonetizacaoClick={handleDesativarMonetizacaoClick}
        handleMonetizarContaClick={handleMonetizarContaClick}
        perfilAvatarPreviewSrc={perfilAvatarPreviewSrc}
        creatorDisplayLabel={creatorDisplayLabel}
        creatorHandleLocked={creatorHandleLocked}
        userHandleDraft={userHandleDraft}
        monetizationUiState={monetizationUiState}
        monetizationEligibility={monetizationEligibility}
        creatorPublicPath={creatorPublicPath}
        creatorMonetizationStatusEffective={creatorMonetizationStatusEffective}
        mangakaFormAnchorRef={mangakaFormAnchorRef}
        creatorDisplayName={creatorDisplayName}
        setCreatorDisplayName={setCreatorDisplayName}
        setNovoNome={setNovoNome}
        creatorBio={creatorBio}
        setCreatorBio={setCreatorBio}
        instagramUrl={instagramUrl}
        setInstagramUrl={setInstagramUrl}
        youtubeUrl={youtubeUrl}
        setYoutubeUrl={setYoutubeUrl}
        lojaAvatarAuthorUnlocked={lojaAvatarAuthorUnlocked}
        setLojaAvatarAuthorUnlocked={setLojaAvatarAuthorUnlocked}
        listaAvatares={listaAvatares}
        podeUsarAvatarPremium={podeUsarAvatarPremium}
        mangakaAvatarUrlDraft={mangakaAvatarUrlDraft}
        mangakaAvatarFile={mangakaAvatarFile}
        avatarSelecionado={avatarSelecionado}
        setMangakaAvatarUrlDraft={setMangakaAvatarUrlDraft}
        setMangakaAvatarFile={setMangakaAvatarFile}
        setAvatarSelecionado={setAvatarSelecionado}
        perfilDb={perfilDb}
        usernameInputRef={usernameInputRef}
        setUserHandleDraft={setUserHandleDraft}
        usernameCheck={usernameCheck}
        novoNome={novoNome}
        birthDate={birthDate}
        setBirthDate={setBirthDate}
        birthDateDraft={birthDateDraft}
        setBirthDateDraft={setBirthDateDraft}
        mangakaBirthInputRef={mangakaBirthInputRef}
        notifyPromotions={notifyPromotions}
        setNotifyPromotions={setNotifyPromotions}
        notifyCommentSocial={notifyCommentSocial}
        setNotifyCommentSocial={setNotifyCommentSocial}
        creatorReviewReason={creatorReviewReason}
        needsFirstMonetizationApplication={needsFirstMonetizationApplication}
        creatorMonetizationPreference={creatorMonetizationPreference}
        creatorMembershipEnabled={creatorMembershipEnabled}
        creatorMembershipPriceBRL={creatorMembershipPriceBRL}
        creatorDonationSuggestedBRL={creatorDonationSuggestedBRL}
        buyerProfileExpanded={buyerProfileExpanded}
        setBuyerProfileExpanded={setBuyerProfileExpanded}
        lojaBuyerInputs={lojaBuyerInputs}
        mensagem={mensagem}
        loading={loading}
        underageMonetizeModalOpen={underageMonetizeModalOpen}
        setUnderageMonetizeModalOpen={setUnderageMonetizeModalOpen}
        isUnderageByBirthYear={isUnderageByBirthYear}
        creatorMonetizationStatus={creatorMonetizationStatus}
      />
    );
  }

  return (
    <PerfilReaderView
      adminAccess={resolvedAdminAccess}
      navigate={navigate}
      handleSalvar={handleSalvar}
      perfilAvatarPreviewSrc={perfilAvatarPreviewSrc}
      novoNome={novoNome}
      setNovoNome={setNovoNome}
      userHandleDraft={userHandleDraft}
      setUserHandleDraft={setUserHandleDraft}
      usernameInputRef={usernameInputRef}
      perfilDb={perfilDb}
      usernameCheck={usernameCheck}
      birthDate={birthDate}
      setBirthDate={setBirthDate}
      birthDateDraft={birthDateDraft}
      setBirthDateDraft={setBirthDateDraft}
      mangakaBirthInputRef={mangakaBirthInputRef}
      gender={gender}
      setGender={setGender}
      isStaffAdmin={isStaffAdmin}
      premiumAtivo={premiumAtivo}
      buyerProfileExpanded={buyerProfileExpanded}
      setBuyerProfileExpanded={setBuyerProfileExpanded}
      lojaBuyerInputs={lojaBuyerInputs}
      premiumEntitlement={premiumEntitlement}
      membershipCriadorAtiva={membershipCriadorAtiva}
      membershipsCriadorAtivas={membershipsCriadorAtivas}
      readerProfilePublicDraft={readerProfilePublicDraft}
      setReaderProfilePublicDraft={setReaderProfilePublicDraft}
      user={user}
      readerPublicPath={readerPublicPath}
      podeUsarAvatarPremium={podeUsarAvatarPremium}
      listaAvatares={listaAvatares}
      avatarSelecionado={avatarSelecionado}
      setAvatarSelecionado={setAvatarSelecionado}
      setMangakaAvatarFile={setMangakaAvatarFile}
      setMangakaAvatarUrlDraft={setMangakaAvatarUrlDraft}
      avataresLiberados={avataresLiberados}
      notifyPromotions={notifyPromotions}
      setNotifyPromotions={setNotifyPromotions}
      notifyCommentSocial={notifyCommentSocial}
      setNotifyCommentSocial={setNotifyCommentSocial}
      mensagem={mensagem}
      loading={loading}
      creatorApplicationStatus={creatorApplicationStatus}
      creatorReviewReason={creatorReviewReason}
      creatorModerationAction={creatorModerationAction}
      isCreatorDraft={isCreatorDraft}
      isCreatorCandidate={isCreatorCandidate}
    />
  );
}
