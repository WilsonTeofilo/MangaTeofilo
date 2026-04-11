// src/pages/Perfil/Perfil.jsx
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { updateProfile } from 'firebase/auth';
import { ref, update, get, onValue, set, remove } from 'firebase/database';
import { useLocation, useNavigate } from 'react-router-dom';

import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { db, storage } from '../../services/firebase';
import { SITE_ORIGIN } from '../../config/site';
import { processCreatorProfileImageToWebp } from '../../utils/creatorProfileImage';
import {
  LISTA_AVATARES,
  AVATAR_FALLBACK,
  DISPLAY_NAME_MAX_LENGTH,
  CREATOR_BIO_MAX_LENGTH,
  CREATOR_BIO_MIN_LENGTH,
  CREATOR_BIO_MIN_LENGTH_PUBLISH_ONLY,
  CREATOR_MEMBERSHIP_PRICE_MAX_BRL,
  CREATOR_MEMBERSHIP_PRICE_MIN_BRL,
} from '../../constants'; // centralizado
import {
  podeUsarAvataresPremiumDaLoja,
  obterEntitlementPremiumGlobal,
} from '../../utils/capituloLancamento';
import { emptyAdminAccess } from '../../auth/adminAccess';
import { apoieUrlAbsolutaParaCriador } from '../../utils/creatorSupportPaths';
import { normalizarAcessoAvatar } from '../../utils/avatarAccess';
import {
  ageFromBirthDateLocal,
  birthDateFromYearOnly,
  formatBirthDateIsoToBr,
  normalizeBirthDateBrTyping,
  parseBirthDateBr,
  parseBirthDateFlexible,
  parseBirthDateLocal,
} from '../../utils/birthDateAge';
import { buildCreatorRecordForProfileSave } from '../../utils/creatorRecord';
import {
  resolveStoragePathFromPathOrUrl,
  safeDeleteStorageObject,
} from '../../utils/storageCleanup';
import {
  effectiveCreatorMonetizationStatus,
  normalizeCreatorMonetizationPreference,
  resolveCreatorMonetizationEligibilityFromDb,
  resolveCreatorMonetizationApplicationStatusFromDb,
  resolveCreatorMonetizationPreferenceFromDb,
  resolveCreatorSupportOfferFromDb,
  resolveCreatorMonetizationStatusFromDb,
  resolveCreatorMonetizationUiState,
} from '../../utils/creatorMonetizationUi';
import { BRAZILIAN_STATES, PERFIL_LOJA_DADOS_HASH } from '../../utils/brazilianStates';
import { normalizeBuyerProfile, sanitizeBuyerProfileForSave } from '../../utils/storeBuyerProfile';
import { refreshAuthUser } from '../../userProfileSyncV2';
import { validateCreatorSocialLinks } from '../../utils/creatorSocialLinks';
import {
  normalizeUsernameInput,
  validateUsernameHandle,
  suggestUsernameFromDisplayName,
} from '../../utils/usernameValidation';
import { buildUsuarioPublicProfileRecord } from '../../config/userProfileSchema';
import { resolvePublicProfilePath } from '../../utils/publicProfilePaths';
import { isTrustedPlatformAssetUrl } from '../../utils/trustedAssetUrls';
import './Perfil.css';

function isCreatorProfileStorageAssetForUser(uid, pathOrUrl) {
  const path = resolveStoragePathFromPathOrUrl(pathOrUrl);
  if (!path) return false;
  return path.startsWith(`creator_profile/${uid}/`);
}

function isTrustedProfileImageUrl(url) {
  return isTrustedPlatformAssetUrl(url, {
    allowLocalAssets: true,
    allowedExtensions: ['.jpg', '.jpeg', '.png', '.webp'],
  });
}

// Recebe `user` via prop (consistente com App.jsx)
// Nao usa mais auth.currentUser diretamente para evitar dessincronizacao
export default function Perfil({
  user,
  adminAccess = emptyAdminAccess(),
  /** Equipe com painel admin: nunca layout creator, so conta leitor. */
  suppressCreatorProfileUi = false,
}) {
  const navigate = useNavigate();
  const location = useLocation();

  const [novoNome, setNovoNome]               = useState('');
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
  const [loading, setLoading]                 = useState(false);
  const [mensagem, setMensagem]               = useState({ texto: '', tipo: '' });
  const [perfilDb, setPerfilDb]               = useState(null);
  const [creatorStatsLive, setCreatorStatsLive] = useState(null);
  const [creatorBio, setCreatorBio] = useState('');
  const [creatorDisplayName, setCreatorDisplayName] = useState('');
  const [mangakaAvatarUrlDraft, setMangakaAvatarUrlDraft] = useState('');
  const [mangakaAvatarFile, setMangakaAvatarFile] = useState(null);
  const [mangakaAvatarLocalPreview, setMangakaAvatarLocalPreview] = useState('');
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
  /** Evita trocar foto de autor por avatar da loja sem intencao (painel fechado + cadeado). */
  const [lojaAvatarAuthorUnlocked, setLojaAvatarAuthorUnlocked] = useState(false);
  const mangakaFormAnchorRef = useRef(null);
  const mangakaBirthInputRef = useRef(null);
  const usernameInputRef = useRef(null);
  const mangakaAvatarPreserveRef = useRef(false);
  const savedUserAvatarRef = useRef('');
  useEffect(() => {
    mangakaAvatarPreserveRef.current = adminAccess.isMangaka === true;
  }, [adminAccess.isMangaka]);

  const [buyerProfileExpanded, setBuyerProfileExpanded] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.location.hash.replace(/^#/, '') === PERFIL_LOJA_DADOS_HASH;
    } catch {
      return false;
    }
  });
  const isStaffAdmin = adminAccess.canAccessAdmin === true && adminAccess.isMangaka !== true;
  const mustCompleteBirthDate =
    new URLSearchParams(location.search || '').get('required') === 'birthDate';
  const mustCompleteUsername =
    new URLSearchParams(location.search || '').get('required') === 'username';

  useEffect(() => {
    const hash = String(location.hash || '').replace(/^#/, '');
    if (hash !== PERFIL_LOJA_DADOS_HASH) return undefined;
    setBuyerProfileExpanded(true);
    const t = window.setTimeout(() => {
      document.getElementById(PERFIL_LOJA_DADOS_HASH)?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    }, 220);
    return () => window.clearTimeout(t);
  }, [location.hash, location.pathname]);

  useEffect(() => {
    if (!mustCompleteBirthDate) return;
    const iso = parseBirthDateFlexible(birthDateDraft, birthDate);
    if (parseBirthDateLocal(iso)) return;
    setMensagem({
      texto: 'Preencha sua data de nascimento para continuar usando a conta.',
      tipo: 'erro',
    });
    const t = window.setTimeout(() => {
      mangakaBirthInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      mangakaBirthInputRef.current?.focus?.();
    }, 220);
    return () => window.clearTimeout(t);
  }, [mustCompleteBirthDate, birthDate, birthDateDraft]);

  useEffect(() => {
    if (!mustCompleteUsername) return;
    const locked = String(perfilDb?.userHandle || '').trim().toLowerCase();
    const wanted = normalizeUsernameInput(userHandleDraft);
    if (locked || wanted) return;
    setMensagem({ texto: 'Defina um @username para continuar.', tipo: 'erro' });
    const t = window.setTimeout(() => {
      usernameInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      usernameInputRef.current?.focus?.();
    }, 220);
    return () => window.clearTimeout(t);
  }, [mustCompleteUsername, userHandleDraft, perfilDb?.userHandle]);

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
      const publicName = String(
        creatorProfileDoc.displayName || perfil.userName || user.displayName || ''
      ).trim();
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
      const ua = String(perfil.userAvatar || '').trim();
      const readerAvatar = String(perfil.readerProfileAvatarUrl || '').trim();
      const authPhoto = String(user.photoURL || '').trim();
      const resolvedAvatar = ua || readerAvatar || authPhoto;
      savedUserAvatarRef.current = resolvedAvatar;
      if (resolvedAvatar) {
        setAvatarSelecionado(resolvedAvatar);
      }
      setReaderProfilePublicDraft(
        adminAccess.isMangaka ? true : Boolean(perfil.readerProfilePublic)
      );
    };

    if (!user) {
      navigate('/login');
      return;
    }
    carregarPerfil().catch(() => setNotifyPromotions(false));
  }, [user, navigate, adminAccess.isMangaka]);

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
          const p = String(prev || '').trim();
          const saved = String(savedUserAvatarRef.current || '').trim();
          if (urls.includes(p)) return p;
          if (!p && saved) return saved;
          if (saved && p === saved) return p;
          if (/^https:\/\//i.test(p) && p.length > 12) return p;
          if (/^https:\/\//i.test(saved) && saved.length > 12) return saved;
          if (mangakaAvatarPreserveRef.current && /^https:\/\//i.test(p) && p.length > 12) return p;
          return data[0].url;
        });
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!mangakaAvatarFile) {
      setMangakaAvatarLocalPreview('');
      return () => {};
    }
    const u = URL.createObjectURL(mangakaAvatarFile);
    setMangakaAvatarLocalPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [mangakaAvatarFile]);

  const perfilAvatarPreviewSrc =
    mangakaAvatarLocalPreview ||
    (adminAccess.isMangaka && isTrustedProfileImageUrl(String(mangakaAvatarUrlDraft || '').trim())
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
  /** Ja aprovado pela equipe (ou equivalente) - religar monetizacao não pede formulário de novo. */
  const creatorReviewReason = String(perfilDb?.creatorReviewReason || '').trim();
  const creatorModerationAction = String(perfilDb?.creatorModerationAction || '').trim().toLowerCase();
  const creatorSignupIntent = String(perfilDb?.signupIntent || '').trim().toLowerCase();
  const birthIsoEffective = parseBirthDateFlexible(birthDateDraft, birthDate);
  const birthAge = birthIsoEffective ? ageFromBirthDateLocal(birthIsoEffective) : null;
  const isUnderageByBirthYear = birthAge != null && birthAge < 18;
  const isCreatorCandidate = creatorSignupIntent === 'creator' || creatorApplicationStatus !== '';
  const podeUsarAvatarPremium = podeUsarAvataresPremiumDaLoja(user, perfilDb);
  const avataresLiberados = listaAvatares.filter((item) => {
    if (normalizarAcessoAvatar(item) === 'publico') return true;
    return podeUsarAvatarPremium;
  });
  const creatorDisplayLabel = String(creatorDisplayName || novoNome || user?.displayName || '').trim() || 'Criador';
  const creatorHandleLocked = String(perfilDb?.userHandle || '').trim().toLowerCase();
  const creatorSupportUrl = user?.uid ? apoieUrlAbsolutaParaCriador(user.uid) : '';
  const publicProfileHandlePreview = creatorHandleLocked || normalizeUsernameInput(userHandleDraft);
  const creatorPublicPath = resolvePublicProfilePath(
    {
      uid: user?.uid || '',
      userHandle: publicProfileHandlePreview,
    },
    user?.uid || ''
  );
  const readerPublicPath = resolvePublicProfilePath(
    {
      uid: user?.uid || '',
      userHandle: publicProfileHandlePreview,
    },
    user?.uid || '',
    { tab: 'likes' }
  );
  const needsFirstMonetizationApplication =
    adminAccess.isMangaka && creatorMonetizationApplicationStatus === 'not_requested';
  const monetizacaoBloqueadaPorIdade =
    creatorMonetizationStatus === 'blocked_underage' || isUnderageByBirthYear;
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
  const formatarTempoRestanteAssinatura = () => ({ ativo: false, texto: '' });
  const formatarDataLongaBr = (value, { seVazio = '-' } = {}) => (value ? String(value) : seVazio);

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
    const iso = parseBirthDateFlexible(birthDateDraft, birthDate);
    const age = iso ? ageFromBirthDateLocal(iso) : null;
    if (age != null && age < 18) {
      setCreatorMonetizationPreference('publish_only');
    }
  }, [birthDate, birthDateDraft]);

  useEffect(() => {
    if (!user?.uid) return undefined;
    const locked = String(perfilDb?.userHandle || '').trim().toLowerCase();
    if (locked) {
      setUsernameCheck({ status: 'idle', message: '' });
      return undefined;
    }
    const norm = normalizeUsernameInput(userHandleDraft);
    if (!norm) {
      setUsernameCheck({ status: 'idle', message: '' });
      return undefined;
    }
    const v = validateUsernameHandle(norm);
    if (!v.ok) {
      setUsernameCheck({ status: 'invalid', message: v.message });
      return undefined;
    }
    setUsernameCheck({ status: 'checking', message: 'Verificando...' });
    const t = window.setTimeout(() => {
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
    return () => window.clearTimeout(t);
  }, [user?.uid, userHandleDraft, perfilDb?.userHandle]);

  const handleSalvar = async (e) => {
    e.preventDefault();

    const accountDisplayName = adminAccess.isMangaka
      ? String(creatorDisplayName || '').trim()
      : String(novoNome || '').trim();
    if (!accountDisplayName) {
      setMensagem({
        texto: adminAccess.isMangaka ? 'Defina o nome publico do criador.' : 'De um nome a sua alma!',
        tipo: 'erro',
      });
      return;
    }

    const lockedHandlePreview = String(perfilDb?.userHandle || '').trim().toLowerCase();
    const wantHandlePreview = normalizeUsernameInput(userHandleDraft);
    if (!lockedHandlePreview && !wantHandlePreview && !isStaffAdmin) {
      setMensagem({
        texto: 'Defina um @username unico (so letras minusculas, numeros e _). Ele nao podera ser alterado depois.',
        tipo: 'erro',
      });
      return;
    }
    if (!lockedHandlePreview && wantHandlePreview) {
      const v0 = validateUsernameHandle(wantHandlePreview);
      if (!v0.ok) {
        setMensagem({ texto: v0.message, tipo: 'erro' });
        return;
      }
    }

    if (readerProfilePublicDraft || adminAccess.isMangaka) {
      if (!adminAccess.isMangaka) {
        const handleOk =
          Boolean(String(perfilDb?.userHandle || '').trim()) || Boolean(normalizeUsernameInput(userHandleDraft));
        if (!handleOk) {
          setMensagem({
            texto: 'Para ativar o perfil publico de leitor, defina um @username unico e salve.',
            tipo: 'erro',
          });
          return;
        }
      }
    }

    const birthIsoForSave = parseBirthDateFlexible(birthDateDraft, birthDate);
    const birthDraftHasDigits = birthDateDraft.replace(/\D/g, '').length > 0;
    if (!isStaffAdmin && !parseBirthDateLocal(birthIsoForSave)) {
      setMensagem({
        texto: 'Data de nascimento obrigatoria. Use dia/mes/ano (ex.: 28/12/2001).',
        tipo: 'erro',
      });
      return;
    }
    if (birthDraftHasDigits && !parseBirthDateLocal(birthIsoForSave)) {
      setMensagem({ texto: 'Data de nascimento invalida. Use dia/mes/ano (ex.: 28/12/2001).', tipo: 'erro' });
      return;
    }

    const ano = birthIsoForSave && parseBirthDateLocal(birthIsoForSave) ? Number(birthIsoForSave.slice(0, 4)) : NaN;
    const notificationPrefs = {
      promotionsEmail: notifyPromotions === true,
      commentSocialInApp: notifyCommentSocial === true,
    };

    if (adminAccess.isMangaka) {
      const bioLen = String(creatorBio || '').trim().length;
      const bioMinMangaka = CREATOR_BIO_MIN_LENGTH_PUBLISH_ONLY;
      if (bioLen < bioMinMangaka || bioLen > CREATOR_BIO_MAX_LENGTH) {
        setMensagem({
          texto: `A bio do criador deve ter entre ${bioMinMangaka} e ${CREATOR_BIO_MAX_LENGTH} caracteres.`,
          tipo: 'erro',
        });
        return;
      }
    }

    setLoading(true);
    setMensagem({ texto: '', tipo: '' });

    let claimedNewHandle = null;
    try {
      let finalAvatar = avatarSelecionado;
      const persistedAvatar = String(perfilDb?.userAvatar || '').trim();
      const authAvatar = String(user?.photoURL || '').trim();
      const previousAvatar = isTrustedPlatformAssetUrl(persistedAvatar, { allowLocalAssets: true })
        ? persistedAvatar
        : isTrustedPlatformAssetUrl(authAvatar, { allowLocalAssets: true })
          ? authAvatar
          : '';
      const previousCreatorProfileAvatar =
        adminAccess.isMangaka && isCreatorProfileStorageAssetForUser(user.uid, previousAvatar)
          ? previousAvatar
          : '';
      if (adminAccess.isMangaka && mangakaAvatarFile) {
        try {
          const blob = await processCreatorProfileImageToWebp(mangakaAvatarFile);
          const path = `creator_profile/${user.uid}/avatar_${Date.now()}.webp`;
          const fileRef = storageRef(storage, path);
          await uploadBytes(fileRef, blob, {
            contentType: 'image/webp',
            cacheControl: 'public,max-age=31536000,immutable',
          });
          finalAvatar = await getDownloadURL(fileRef);
        } catch (avErr) {
          setMensagem({ texto: avErr?.message || 'Nao foi possivel processar a foto.', tipo: 'erro' });
          setLoading(false);
          return;
        }
      } else if (adminAccess.isMangaka && String(mangakaAvatarUrlDraft || '').trim()) {
        const u = String(mangakaAvatarUrlDraft || '').trim();
        if (!isTrustedPlatformAssetUrl(u, { allowLocalAssets: true }) || u.length > 2048) {
          setMensagem({
            texto: 'Escolha uma foto enviada por aqui ou um avatar da plataforma.',
            tipo: 'erro',
          });
          setLoading(false);
          return;
        }
        finalAvatar = u;
      } else if (adminAccess.isMangaka) {
        const asUrl = String(avatarSelecionado || '').trim();
        if (isTrustedPlatformAssetUrl(asUrl, { allowLocalAssets: true }) && asUrl.length <= 2048) {
          finalAvatar = asUrl;
        } else {
          const avatarEscolhido = listaAvatares.find((item) => item.url === avatarSelecionado);
          if (avatarEscolhido) {
            if (normalizarAcessoAvatar(avatarEscolhido) === 'premium' && !podeUsarAvatarPremium) {
              setMensagem({ texto: 'Avatar Premium exclusivo para conta Premium ativa.', tipo: 'erro' });
              setLoading(false);
              return;
            }
            finalAvatar = avatarSelecionado;
          } else {
            const keep =
              isTrustedPlatformAssetUrl(persistedAvatar, { allowLocalAssets: true }) ? persistedAvatar :
              isTrustedPlatformAssetUrl(authAvatar, { allowLocalAssets: true }) ? authAvatar :
              '';
            finalAvatar = keep || AVATAR_FALLBACK;
          }
        }
      } else {
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
        finalAvatar = avatarSelecionado;
      }

      const readerPub = adminAccess.isMangaka === true || readerProfilePublicDraft === true;
      const readerAvatarSave = readerPub ? finalAvatar : null;

      const creatorPublicName = String(creatorDisplayName || novoNome || '').trim();
      const socialValidation = validateCreatorSocialLinks({
        instagramUrl,
        youtubeUrl,
        requireOne: false,
      });
      if (!socialValidation.ok) {
        setMensagem({ texto: socialValidation.message, tipo: 'erro' });
        setLoading(false);
        return;
      }

      const creatorCanonicalDoc = adminAccess.isMangaka
        ? buildCreatorRecordForProfileSave({
            perfilDb,
            birthDateIso: birthIsoForSave && parseBirthDateLocal(birthIsoForSave) ? birthIsoForSave : '',
            displayName: creatorPublicName,
            bio: String(creatorBio || '').trim(),
            instagramUrl: socialValidation.instagramUrl,
            youtubeUrl: socialValidation.youtubeUrl,
            now: Date.now(),
          })
        : null;
      const buyerProfile = sanitizeBuyerProfileForSave({
        fullName: buyerFullName,
        cpf: buyerCpf,
        phone: buyerPhone,
        postalCode: buyerPostalCode,
        state: buyerState,
        city: buyerCity,
        neighborhood: buyerNeighborhood,
        addressLine1: buyerAddressLine1,
        addressLine2: buyerAddressLine2,
      });

      const existingHandle = String(perfilDb?.userHandle || '').trim().toLowerCase();
      const wantHandle = normalizeUsernameInput(userHandleDraft);

      if (!existingHandle && !wantHandle && !isStaffAdmin) {
        setMensagem({
          texto: 'Defina um @username unico (so letras minusculas, numeros e _). Ele nao podera ser alterado depois.',
          tipo: 'erro',
        });
        setLoading(false);
        return;
      }

      if (!existingHandle && wantHandle) {
        const vh = validateUsernameHandle(wantHandle);
        if (!vh.ok) {
          setMensagem({ texto: vh.message, tipo: 'erro' });
          setLoading(false);
          return;
        }
        if (!isStaffAdmin && usernameCheck.status === 'taken') {
          setMensagem({ texto: 'Este @username ja esta em uso.', tipo: 'erro' });
          setLoading(false);
          return;
        }
        const takenSnap = await get(ref(db, `usernames/${wantHandle}`));
        if (takenSnap.exists() && takenSnap.val() !== user.uid) {
          setMensagem({ texto: 'Este @username ja esta em uso.', tipo: 'erro' });
          setLoading(false);
          return;
        }
        await set(ref(db, `usernames/${wantHandle}`), user.uid);
        claimedNewHandle = wantHandle;
      }

      const persistedHandle = existingHandle || claimedNewHandle || '';

      // 1. Atualiza no Firebase Auth (mangaka: mesmo texto que nome publico)
      await updateProfile(user, {
        displayName: accountDisplayName,
        photoURL: finalAvatar,
      });
      try {
        await refreshAuthUser(user);
      } catch (e) {
        console.warn('[Perfil] reload auth apos salvar:', e);
      }

      // 2. Atualiza no Realtime Database (Leitor.jsx escuta daqui)
      const nowTs = Date.now();
      const privatePatch = {
        [`usuarios/${user.uid}/userName`]: accountDisplayName,
        [`usuarios/${user.uid}/userAvatar`]: finalAvatar,
        [`usuarios/${user.uid}/uid`]: user.uid,
        [`usuarios/${user.uid}/notifyPromotions`]: notifyPromotions === true,
        [`usuarios/${user.uid}/notificationPrefs`]: notificationPrefs,
        [`usuarios/${user.uid}/gender`]: gender,
        [`usuarios/${user.uid}/birthDate`]:
          birthIsoForSave && parseBirthDateLocal(birthIsoForSave) ? birthIsoForSave : null,
        [`usuarios/${user.uid}/birthYear`]:
          birthIsoForSave && parseBirthDateLocal(birthIsoForSave) ? ano : null,
        [`usuarios/${user.uid}/creatorTermsAccepted`]: creatorTermsAccepted === true,
        [`usuarios/${user.uid}/buyerProfile`]: buyerProfile,
        [`usuarios/${user.uid}/readerProfilePublic`]: readerPub,
        [`usuarios/${user.uid}/readerProfileAvatarUrl`]: readerAvatarSave,
        [`usuarios/${user.uid}/creatorBannerUrl`]: null,
        [`usuarios/${user.uid}/lastLogin`]: nowTs,
      };
      if (persistedHandle) {
        privatePatch[`usuarios/${user.uid}/userHandle`] = persistedHandle;
      }
      if (adminAccess.isMangaka) {
        privatePatch[`usuarios/${user.uid}/signupIntent`] = 'creator';
      }
      if (creatorCanonicalDoc) {
        privatePatch[`usuarios/${user.uid}/creator/profile`] = creatorCanonicalDoc.profile;
        privatePatch[`usuarios/${user.uid}/creator/social`] = creatorCanonicalDoc.social;
      }
      await update(ref(db), privatePatch);

      const nextPerfilDb = {
        ...(perfilDb || {}),
        uid: user.uid,
        userName: accountDisplayName,
        userAvatar: finalAvatar,
        userHandle: persistedHandle || perfilDb?.userHandle || '',
        signupIntent:
          privatePatch[`usuarios/${user.uid}/signupIntent`] ??
          perfilDb?.signupIntent ??
          'reader',
        creatorStatus: perfilDb?.creatorStatus ?? '',
        creatorDisplayName: creatorPublicName,
        creatorBio: String(creatorBio || '').trim(),
        creatorBannerUrl: null,
        instagramUrl: String(instagramUrl || '').trim(),
        youtubeUrl: String(youtubeUrl || '').trim(),
        readerProfilePublic: readerPub,
        readerProfileAvatarUrl: readerAvatarSave,
        role: perfilDb?.role ?? 'user',
        buyerProfile,
        creator: creatorCanonicalDoc
          ? {
              ...(perfilDb?.creator && typeof perfilDb.creator === 'object' ? perfilDb.creator : {}),
              profile: {
                ...(perfilDb?.creator?.profile && typeof perfilDb.creator.profile === 'object'
                  ? perfilDb.creator.profile
                  : {}),
                ...creatorCanonicalDoc.profile,
                avatarUrl: finalAvatar,
              },
              social: creatorCanonicalDoc.social,
              meta: creatorCanonicalDoc.meta,
              monetization: {
                ...(perfilDb?.creator?.monetization &&
                typeof perfilDb.creator.monetization === 'object'
                  ? perfilDb.creator.monetization
                  : {}),
                application: creatorCanonicalDoc.monetization?.application || null,
                financial: creatorCanonicalDoc.monetization?.financial || null,
                offer: creatorCanonicalDoc.monetization?.offer || null,
                legal: creatorCanonicalDoc.monetization?.legal || null,
                payout: creatorCanonicalDoc.monetization?.payout || null,
              },
            }
          : perfilDb?.creator,
        updatedAt: nowTs,
        lastLogin: nowTs,
      };

      const publicProfileRecord = buildUsuarioPublicProfileRecord(nextPerfilDb, user.uid);
      delete publicProfileRecord.creatorStatus;
      delete publicProfileRecord.creatorMembershipEnabled;
      delete publicProfileRecord.creatorMembershipPriceBRL;
      delete publicProfileRecord.creatorDonationSuggestedBRL;
      const publicProfilePatch = {
        [`usuarios/${user.uid}/publicProfile/uid`]: publicProfileRecord.uid || user.uid,
        [`usuarios/${user.uid}/publicProfile/userName`]: publicProfileRecord.userName || accountDisplayName,
        [`usuarios/${user.uid}/publicProfile/userHandle`]: publicProfileRecord.userHandle || null,
        [`usuarios/${user.uid}/publicProfile/userAvatar`]: publicProfileRecord.userAvatar || finalAvatar,
        [`usuarios/${user.uid}/publicProfile/isCreatorProfile`]: publicProfileRecord.isCreatorProfile === true,
        [`usuarios/${user.uid}/publicProfile/signupIntent`]: publicProfileRecord.signupIntent || 'reader',
        [`usuarios/${user.uid}/publicProfile/status`]: publicProfileRecord.status || '',
        [`usuarios/${user.uid}/publicProfile/creatorDisplayName`]: publicProfileRecord.creatorDisplayName || null,
        [`usuarios/${user.uid}/publicProfile/creatorUsername`]: publicProfileRecord.creatorUsername || null,
        [`usuarios/${user.uid}/publicProfile/creatorBio`]: publicProfileRecord.creatorBio || null,
        [`usuarios/${user.uid}/publicProfile/creatorBannerUrl`]: publicProfileRecord.creatorBannerUrl || null,
        [`usuarios/${user.uid}/publicProfile/instagramUrl`]: publicProfileRecord.instagramUrl || null,
        [`usuarios/${user.uid}/publicProfile/youtubeUrl`]: publicProfileRecord.youtubeUrl || null,
        [`usuarios/${user.uid}/publicProfile/readerProfilePublic`]: publicProfileRecord.readerProfilePublic === true,
        [`usuarios/${user.uid}/publicProfile/readerProfileAvatarUrl`]:
          publicProfileRecord.readerProfileAvatarUrl || finalAvatar,
        [`usuarios/${user.uid}/publicProfile/readerSince`]: publicProfileRecord.readerSince || nowTs,
        [`usuarios/${user.uid}/publicProfile/updatedAt`]: publicProfileRecord.updatedAt || nowTs,
      };
      if (publicProfileRecord.isCreatorProfile === true) {
        publicProfilePatch[`usuarios/${user.uid}/publicProfile/creatorProfile/displayName`] =
          publicProfileRecord?.creatorProfile?.displayName || null;
        publicProfilePatch[`usuarios/${user.uid}/publicProfile/creatorProfile/username`] =
          publicProfileRecord?.creatorProfile?.username || null;
        publicProfilePatch[`usuarios/${user.uid}/publicProfile/creatorProfile/avatarUrl`] =
          publicProfileRecord?.creatorProfile?.avatarUrl || null;
        publicProfilePatch[`usuarios/${user.uid}/publicProfile/creatorProfile/bioFull`] =
          publicProfileRecord?.creatorProfile?.bioFull || null;
        publicProfilePatch[`usuarios/${user.uid}/publicProfile/creatorProfile/socialLinks/instagramUrl`] =
          publicProfileRecord?.creatorProfile?.socialLinks?.instagramUrl || null;
        publicProfilePatch[`usuarios/${user.uid}/publicProfile/creatorProfile/socialLinks/youtubeUrl`] =
          publicProfileRecord?.creatorProfile?.socialLinks?.youtubeUrl || null;
      }
      await update(ref(db), {
        ...publicProfilePatch,
      });

      if (
        previousCreatorProfileAvatar &&
        previousCreatorProfileAvatar !== String(finalAvatar || '').trim()
      ) {
        try {
          await safeDeleteStorageObject(storage, previousCreatorProfileAvatar);
        } catch (cleanupError) {
          console.warn('[Perfil] falha ao limpar avatar antigo do creator:', cleanupError);
        }
      }

      savedUserAvatarRef.current = String(finalAvatar || '').trim();
      setAvatarSelecionado(finalAvatar);
      setPerfilDb(nextPerfilDb);
      setNovoNome(accountDisplayName);
      setCreatorDisplayName(creatorPublicName || accountDisplayName);
      setUserHandleDraft(persistedHandle || '');
      setReaderProfilePublicDraft(readerPub);
      setMangakaAvatarFile(null);
      if (listaAvatares.some((i) => i.url === finalAvatar)) {
        setMangakaAvatarUrlDraft('');
      } else if (adminAccess.isMangaka && /^https:\/\//i.test(finalAvatar)) {
        setMangakaAvatarUrlDraft(finalAvatar);
      }

      const savedBirth = birthIsoForSave && parseBirthDateLocal(birthIsoForSave) ? birthIsoForSave : '';
      setBirthDate(savedBirth);
      setBirthDateDraft(savedBirth ? formatBirthDateIsoToBr(savedBirth) : '');

      setMensagem({
        texto: 'Perfil atualizado com sucesso!',
        tipo: 'sucesso',
      });
      setTimeout(() => navigate('/perfil', { replace: true }), 900);

    } catch (error) {
      console.error('Erro na forja:', error);
      if (claimedNewHandle) {
        try {
          await remove(ref(db, `usernames/${claimedNewHandle}`));
        } catch (_) {
          /* ignore */
        }
      }
      setMensagem({ texto: 'Erro ao atualizar: ' + error.message, tipo: 'erro' });
    } finally {
      setLoading(false);
    }
  };

  const handleCopyCreatorSupportLink = async () => {
    if (!creatorSupportUrl) return;
    try {
      await navigator.clipboard.writeText(creatorSupportUrl);
      setMensagem({ texto: 'Link de apoio copiado.', tipo: 'sucesso' });
    } catch {
      setMensagem({ texto: 'Nao foi possivel copiar o link agora.', tipo: 'erro' });
    }
  };

  const lojaBuyerInputs = (
    <>
      <div className="input-group">
        <label>Nome completo (entrega)</label>
        <input
          type="text"
          className="perfil-input"
          value={buyerFullName}
          onChange={(e) => setBuyerFullName(e.target.value)}
          placeholder="Nome que vai na nota de entrega da loja"
        />
      </div>
      <div className="input-group">
        <label>CPF</label>
        <input
          type="text"
          inputMode="numeric"
          className="perfil-input"
          value={buyerCpf}
          onChange={(e) => setBuyerCpf(e.target.value.replace(/\D+/g, '').slice(0, 11))}
          placeholder="Apenas numeros"
        />
      </div>
      <div className="input-group">
        <label>Telefone</label>
        <input
          type="text"
          inputMode="tel"
          className="perfil-input"
          value={buyerPhone}
          onChange={(e) => setBuyerPhone(e.target.value.replace(/\D+/g, '').slice(0, 11))}
          placeholder="DDD + numero (so digitos)"
        />
      </div>
      <div className="input-group">
        <label>CEP</label>
        <input
          type="text"
          inputMode="numeric"
          className="perfil-input"
          value={buyerPostalCode}
          onChange={(e) => setBuyerPostalCode(e.target.value.replace(/\D+/g, '').slice(0, 8))}
          placeholder="8 digitos, sem traco"
        />
      </div>
      <div className="input-group">
        <label>Estado</label>
        <select
          className="perfil-input"
          value={buyerState}
          onChange={(e) => setBuyerState(e.target.value)}
          aria-label="Estado (UF)"
        >
          <option value="">Selecione o estado</option>
          {BRAZILIAN_STATES.map(({ uf, name }) => (
            <option key={uf} value={uf}>
              {uf} - {name}
            </option>
          ))}
        </select>
      </div>
      <div className="input-group">
        <label>Cidade</label>
        <input
          type="text"
          className="perfil-input"
          value={buyerCity}
          onChange={(e) => setBuyerCity(e.target.value)}
          placeholder="Sua cidade"
        />
      </div>
      <div className="input-group">
        <label>Bairro</label>
        <input
          type="text"
          className="perfil-input"
          value={buyerNeighborhood}
          onChange={(e) => setBuyerNeighborhood(e.target.value)}
          placeholder="Seu bairro"
        />
      </div>
      <div className="input-group">
        <label>Endereco</label>
        <input
          type="text"
          className="perfil-input"
          value={buyerAddressLine1}
          onChange={(e) => setBuyerAddressLine1(e.target.value)}
          placeholder="Rua, numero e complemento"
        />
      </div>
      <div className="input-group">
        <label>Complemento</label>
        <input
          type="text"
          className="perfil-input"
          value={buyerAddressLine2}
          onChange={(e) => setBuyerAddressLine2(e.target.value)}
          placeholder="Opcional"
        />
      </div>
    </>
  );

  const lojaBuyerDisclosureBody = (
    <>
      <button
        type="button"
        className="perfil-loja-dados-toggle"
        aria-expanded={buyerProfileExpanded}
        onClick={() => setBuyerProfileExpanded((v) => !v)}
      >
        {buyerProfileExpanded ? 'Ocultar dados de entrega' : 'Preencher dados de entrega (opcional)'}
      </button>
      {buyerProfileExpanded ? <div className="perfil-loja-dados-fields">{lojaBuyerInputs}</div> : null}
    </>
  );

  const lojaBuyerDisclosure = (
    <>
      <div className="input-group perfil-creator-section-title">
        <label>Dados para compra na loja</label>
        <p className="perfil-loja-dados-hint">
          <strong>Opcional</strong> - so para <strong>compras</strong> na loja (entrega fisica). Pode salvar o perfil com
          tudo em branco; na hora de pagar, o checkout exige endereco e documentos validos.
        </p>
      </div>
      {lojaBuyerDisclosureBody}
    </>
  );

  if (!user) return null; // guard enquanto o useEffect redireciona

  if (adminAccess.isMangaka && !suppressCreatorProfileUi) {
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
                  onError={(e) => { e.target.src = AVATAR_FALLBACK; }}
                />
              </div>
              <div className="perfil-creator-hero__text">
                <p className="perfil-creator-hero__eyebrow">Creator profile</p>
                <h1>{creatorDisplayLabel}</h1>
                {(creatorHandleLocked || normalizeUsernameInput(userHandleDraft)) ? (
                  <p className="perfil-creator-hero__handle">
                    @
                    {creatorHandleLocked || normalizeUsernameInput(userHandleDraft) || '...'}
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
                    const v = e.target.value.slice(0, 60);
                    setCreatorDisplayName(v);
                    setNovoNome(v);
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
                  onClick={() => setLojaAvatarAuthorUnlocked((v) => !v)}
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
                      {listaAvatares.map((item, i) => {
                        const bloqueado = normalizarAcessoAvatar(item) === 'premium' && !podeUsarAvatarPremium;
                        const ativo =
                          String(mangakaAvatarUrlDraft || '').trim() === item.url ||
                          (!mangakaAvatarFile && avatarSelecionado === item.url);
                        return (
                          <div
                            key={`author-shop-${item.id || i}`}
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
                            title={
                              bloqueado ? 'Disponivel apenas para conta Premium ativa' : 'Usar como foto de autor'
                            }
                          >
                            <img
                              src={item.url}
                              alt=""
                              onError={(ev) => {
                                ev.target.src = AVATAR_FALLBACK;
                              }}
                            />
                            {normalizarAcessoAvatar(item) === 'premium' && (
                              <span className="avatar-tier-tag">Premium</span>
                            )}
                            {bloqueado && <span className="avatar-lock">Bloq.</span>}
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
                  Envie uma foto do seu aparelho. A versão pública é ajustada automaticamente para o seu perfil.
                </p>
                <input
                  type="file"
                  className="perfil-input"
                  accept="image/jpeg,image/png,image/webp"
                  aria-label="Enviar foto de perfil"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    setMangakaAvatarFile(f || null);
                    if (f) setMangakaAvatarUrlDraft('');
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

              <div className="input-group" id="username-handle">
                <label>USERNAME (@)</label>
                <p className="perfil-mangaka-apoio-label" style={{ marginBottom: 8 }}>
                  Unico na plataforma. Depois de salvo, nao altera. URL:{' '}
                  <strong>{SITE_ORIGIN.replace(/^https?:\/\//, '')}/@{normalizeUsernameInput(userHandleDraft) || 'seuuser'}</strong>
                </p>
                <input
                  type="text"
                  className="perfil-input"
                  ref={usernameInputRef}
                  autoComplete="username"
                  spellCheck={false}
                  value={userHandleDraft}
                  onChange={(e) => setUserHandleDraft(normalizeUsernameInput(e.target.value))}
                  maxLength={20}
                  disabled={Boolean(String(perfilDb?.userHandle || '').trim())}
                  placeholder="ex: teofilo_manga"
                />
                {!String(perfilDb?.userHandle || '').trim() ? (
                  <button
                    type="button"
                    className="perfil-mangaka-apoio-copy"
                    style={{ marginTop: 8 }}
                    onClick={() => {
                      const s = suggestUsernameFromDisplayName(creatorDisplayName || novoNome);
                      if (s) setUserHandleDraft(s);
                    }}
                  >
                    Sugerir a partir do nome no perfil
                  </button>
                ) : null}
                {usernameCheck.status === 'ok' ? (
                  <p className="perfil-username-status perfil-username-status--ok">{usernameCheck.message}</p>
                ) : null}
                {usernameCheck.status === 'taken' || usernameCheck.status === 'invalid' ? (
                  <p className="perfil-username-status perfil-username-status--bad">{usernameCheck.message}</p>
                ) : null}
                {usernameCheck.status === 'checking' ? (
                  <p className="perfil-username-status">{usernameCheck.message}</p>
                ) : null}
              </div>

              <div className="input-group">
                <label>DATA DE NASCIMENTO</label>
                <input
                  ref={mangakaBirthInputRef}
                  type="text"
                  inputMode="numeric"
                  autoComplete="bday"
                  placeholder="28/12/2001"
                  className="perfil-input"
                  value={birthDateDraft}
                  onChange={(e) => {
                    const d = normalizeBirthDateBrTyping(e.target.value);
                    setBirthDateDraft(d);
                    const iso = parseBirthDateBr(d);
                    if (iso) setBirthDate(iso);
                    else if (!d.replace(/\D/g, '').length) setBirthDate('');
                  }}
                  onBlur={() => {
                    const iso = parseBirthDateBr(birthDateDraft);
                    if (iso) {
                      setBirthDate(iso);
                      setBirthDateDraft(formatBirthDateIsoToBr(iso));
                    } else if (!birthDateDraft.replace(/\D/g, '').length) {
                      setBirthDate('');
                      setBirthDateDraft('');
                    }
                  }}
                />
              </div>

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
                    O formulario documental ja foi liberado para sua conta. Agora envie nome legal, CPF e PIX para a
                    equipe revisar manualmente.
                  </p>
                ) : null}
              </div>

              {creatorMonetizationPreference === 'monetize' &&
              creatorMonetizationStatusEffective === 'active' ? (
                <>
                  <p className="perfil-mangaka-apoio-label" style={{ marginBottom: 12 }}>
                    A parte financeira agora fica separada do perfil publico. O perfil mostra o estado da sua conta, e a
                    equipe registra o repasse no fluxo financeiro quando houver saldo disponivel.
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
              id={PERFIL_LOJA_DADOS_HASH}
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
              {lojaBuyerDisclosureBody}
            </section>

            {mensagem.texto ? (
              <p className={`feedback-msg ${mensagem.tipo}`}>{mensagem.texto}</p>
            ) : null}

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
                      A <strong>data de nascimento</strong> que voce informou acima indica menos de 18 anos. Voce pode
                      continuar <strong>publicando obras</strong> normalmente; quando for maior de idade, volte aqui e
                      solicite monetizacao.
                    </p>
                  ) : null}
                  {creatorMonetizationStatus === 'blocked_underage' ? (
                    <p>
                      Sua conta esta com monetizacao <strong>bloqueada por idade</strong> no cadastro. Se a data de
                      nascimento estiver errada, corrija o campo <strong>Data de nascimento</strong> nesta pagina, salve o
                      perfil e aguarde analise da equipe, se aplicavel.
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

  return (
    <main className="perfil-page">
      <div className="perfil-card">
        <h1 className="perfil-title">Meu perfil</h1>
        <p className="perfil-subtitle">Atualize seus dados e preferencias da conta.</p>

        {!adminAccess.isMangaka && !adminAccess.canAccessAdmin ? (
          <div className="perfil-mangaka-apoio">
            <p className="perfil-mangaka-apoio-label">
              Quer publicar por aqui? O perfil de criador abre pagina publica, catalogo seu, capitulos, painel
              financeiro e membership por autor. O cadastro e numa pagina so - sem modal.
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
                Seu acesso de criador foi aprovado. Se o painel ainda nao mudou, recarregue a pagina para atualizar
                as permissoes da sua conta.
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
                {creatorApplicationStatus === 'draft' ||
                (creatorSignupIntent === 'creator' &&
                  creatorApplicationStatus !== 'requested' &&
                  creatorApplicationStatus !== 'approved' &&
                  creatorApplicationStatus !== 'rejected') ? (
                  <p className="perfil-mangaka-apoio-label perfil-mangaka-apoio-label--full">
                    Cadastro de criador em andamento. Pode sair e voltar quando quiser - os dados ficam salvos na sua
                    conta ate voce enviar.
                  </p>
                ) : null}
                <button
                  type="button"
                  className="perfil-mangaka-apoio-copy perfil-creator-apply-btn"
                  onClick={() => navigate('/creator/onboarding')}
                >
                  {creatorApplicationStatus === 'draft' ||
                  (creatorSignupIntent === 'creator' &&
                    creatorApplicationStatus !== 'requested' &&
                    creatorApplicationStatus !== 'approved' &&
                    creatorApplicationStatus !== 'rejected')
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
                onError={(e) => { e.target.src = AVATAR_FALLBACK; }}
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

          <div className="input-group" id="username-handle-reader">
            <label>USERNAME (@)</label>
            <p className="perfil-mangaka-apoio-label" style={{ marginBottom: 8 }}>
              Identificador unico. Nao pode ser alterado depois de salvo. Link:{' '}
              <strong>{SITE_ORIGIN.replace(/^https?:\/\//, '')}/@{normalizeUsernameInput(userHandleDraft) || 'seuuser'}</strong>
            </p>
            <input
              type="text"
              className="perfil-input"
              ref={usernameInputRef}
              autoComplete="username"
              spellCheck={false}
              value={userHandleDraft}
              onChange={(e) => setUserHandleDraft(normalizeUsernameInput(e.target.value))}
              maxLength={20}
              disabled={Boolean(String(perfilDb?.userHandle || '').trim())}
              placeholder="ex: leitor_shonen"
            />
            {!String(perfilDb?.userHandle || '').trim() ? (
              <button
                type="button"
                className="perfil-mangaka-apoio-copy"
                style={{ marginTop: 8 }}
                onClick={() => {
                  const s = suggestUsernameFromDisplayName(novoNome);
                  if (s) setUserHandleDraft(s);
                }}
              >
                Sugerir a partir do nome
              </button>
            ) : null}
            {usernameCheck.status === 'ok' ? (
              <p className="perfil-username-status perfil-username-status--ok">{usernameCheck.message}</p>
            ) : null}
            {usernameCheck.status === 'taken' || usernameCheck.status === 'invalid' ? (
              <p className="perfil-username-status perfil-username-status--bad">{usernameCheck.message}</p>
            ) : null}
            {usernameCheck.status === 'checking' ? (
              <p className="perfil-username-status">{usernameCheck.message}</p>
            ) : null}
          </div>

          <div className="input-group">
            <label>DATA DE NASCIMENTO</label>
            <input
              ref={mangakaBirthInputRef}
              type="text"
              inputMode="numeric"
              autoComplete="bday"
              placeholder="28/12/2001"
              className="perfil-input"
              value={birthDateDraft}
              onChange={(e) => {
                const d = normalizeBirthDateBrTyping(e.target.value);
                setBirthDateDraft(d);
                const iso = parseBirthDateBr(d);
                if (iso) setBirthDate(iso);
                else if (!d.replace(/\D/g, '').length) setBirthDate('');
              }}
              onBlur={() => {
                const iso = parseBirthDateBr(birthDateDraft);
                if (iso) {
                  setBirthDate(iso);
                  setBirthDateDraft(formatBirthDateIsoToBr(iso));
                } else if (!birthDateDraft.replace(/\D/g, '').length) {
                  setBirthDate('');
                  setBirthDateDraft('');
                } else {
                  setBirthDateDraft(
                    birthDate && parseBirthDateLocal(birthDate) ? formatBirthDateIsoToBr(birthDate) : ''
                  );
                }
              }}
            />
          </div>

          <div className="input-group">
            <label>SEXO</label>
            <select
              className="perfil-input"
              value={gender}
              onChange={(e) => setGender(e.target.value)}
            >
              <option value="nao_informado">Prefiro nao informar</option>
              <option value="masculino">Masculino</option>
              <option value="feminino">Feminino</option>
              <option value="outro">Outro</option>
            </select>
          </div>

          <div className="input-group">
              <label>TIPO DE CONTA</label>
              <div
                className={`account-type-badge ${
                  isStaffAdmin ? 'admin' : premiumAtivo ? 'premium' : ''
                }`}
              >
                {isStaffAdmin
                  ? 'Conta Admin'
                  : premiumAtivo
                    ? 'Conta Premium'
                  : 'Conta Comum'}
              </div>
          </div>

          <section id={PERFIL_LOJA_DADOS_HASH} className="perfil-section-loja-dados">
            {lojaBuyerDisclosure}
          </section>

          {premiumAtivo && typeof premiumEntitlement?.memberUntil === 'number' && (() => {
            const tempo = formatarTempoRestanteAssinatura(premiumEntitlement.memberUntil);
            return (
            <div className="input-group perfil-premium-linha">
              <label>ASSINATURA PREMIUM</label>
              <p className="perfil-premium-msg">
                Ativa ate{' '}
                <strong>
                  {formatarDataLongaBr(premiumEntitlement.memberUntil, { seVazio: '-' })}
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
                      <span>{formatarDataLongaBr(item.memberUntil, { seVazio: '-' })}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          )}

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
              {!podeUsarAvatarPremium && (
                <p className="avatar-premium-hint">
                  Avatares com selo <strong>Premium</strong> aparecem para voce visualizar, mas so podem ser usados
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
                        alt={`Opcao ${i + 1}`}
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
                  ? `Voce pode usar todos os ${listaAvatares.length} avatares disponíveis.`
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

          {mensagem.texto && (
            <p className={`feedback-msg ${mensagem.tipo}`}>{mensagem.texto}</p>
          )}

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



