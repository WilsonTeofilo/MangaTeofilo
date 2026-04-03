// src/pages/Perfil/Perfil.jsx
import React, { useState, useEffect, useRef } from 'react';
import { updateProfile } from 'firebase/auth';
import { ref, update, get, onValue } from 'firebase/database';
import { httpsCallable } from 'firebase/functions';
import { useLocation, useNavigate } from 'react-router-dom';

import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { db, functions, storage } from '../../services/firebase';
import CreatorApplicationModal from '../../components/CreatorApplicationModal';
import { submitCreatorApplicationPayload } from '../../utils/creatorApplicationClient';
import { processCreatorProfileImageToWebp } from '../../utils/creatorProfileImage';
import {
  LISTA_AVATARES,
  AVATAR_FALLBACK,
  isAdminUser,
  DISPLAY_NAME_MAX_LENGTH,
  CREATOR_BIO_MAX_LENGTH,
  CREATOR_BIO_MIN_LENGTH,
  CREATOR_BIO_MIN_LENGTH_PUBLISH_ONLY,
} from '../../constants'; // centralizado
import {
  podeUsarAvataresPremiumDaLoja,
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
  parseBirthDateLocal,
} from '../../utils/birthDateAge';
import { buildCreatorRecordForProfileSave } from '../../utils/creatorRecord';
import {
  creatorMonetizationStatusLabel,
  effectiveCreatorMonetizationStatus,
  normalizeCreatorMonetizationPreference,
} from '../../utils/creatorMonetizationUi';
import { BRAZILIAN_STATES, PERFIL_LOJA_DADOS_HASH } from '../../utils/brazilianStates';
import { normalizeBuyerProfile } from '../../utils/storeBuyerProfile';
import { refreshAuthUser } from '../../userProfileSyncV2';
import { validateCreatorSocialLinks } from '../../utils/creatorSocialLinks';
import './Perfil.css';

const creatorSubmitApplication = httpsCallable(functions, 'creatorSubmitApplication');

// Recebe `user` via prop (consistente com App.jsx)
// Nao usa mais auth.currentUser diretamente para evitar dessincronizacao
export default function Perfil({ user, adminAccess = emptyAdminAccess() }) {
  const navigate = useNavigate();
  const location = useLocation();

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
  const [birthDate, setBirthDate] = useState('');
  const [birthDateDraft, setBirthDateDraft] = useState('');
  const [accountType, setAccountType] = useState('comum');
  const [loading, setLoading]                 = useState(false);
  const [mensagem, setMensagem]               = useState({ texto: '', tipo: '' });
  const [perfilDb, setPerfilDb]               = useState(null);
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
  const [creatorApplicationLoading, setCreatorApplicationLoading] = useState(false);
  const [creatorApplyModalOpen, setCreatorApplyModalOpen] = useState(false);
  const [underageMonetizeModalOpen, setUnderageMonetizeModalOpen] = useState(false);
  const mangakaFormAnchorRef = useRef(null);
  const mangakaBirthInputRef = useRef(null);
  const mangakaAvatarPreserveRef = useRef(false);
  useEffect(() => {
    mangakaAvatarPreserveRef.current = adminAccess.isMangaka === true;
  }, [adminAccess.isMangaka]);

  useEffect(() => {
    const hash = String(location.hash || '').replace(/^#/, '');
    if (hash !== PERFIL_LOJA_DADOS_HASH) return undefined;
    const t = window.setTimeout(() => {
      document.getElementById(PERFIL_LOJA_DADOS_HASH)?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    }, 120);
    return () => window.clearTimeout(t);
  }, [location.hash, location.pathname]);

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
      const fromDb = String(perfil.birthDate || '').trim();
      let birthIso = '';
      if (fromDb && parseBirthDateLocal(fromDb)) {
        birthIso = fromDb;
      } else if (typeof perfil.birthYear === 'number' && perfil.birthYear > 1900) {
        birthIso = birthDateFromYearOnly(String(perfil.birthYear));
      }
      setBirthDate(birthIso);
      setBirthDateDraft(birthIso ? formatBirthDateIsoToBr(birthIso) : '');
      setCreatorDisplayName(String(perfil.creatorDisplayName || perfil.userName || user.displayName || '').trim());
      setCreatorBio(String(perfil.creatorBio || '').trim().slice(0, CREATOR_BIO_MAX_LENGTH));
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
      if (ua) {
        setAvatarSelecionado(ua);
      }
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
          if (urls.includes(prev)) return prev;
          const p = String(prev || '').trim();
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
    (adminAccess.isMangaka && String(mangakaAvatarUrlDraft || '').trim()
      ? String(mangakaAvatarUrlDraft).trim()
      : avatarSelecionado);

  const creatorApplicationStatus = String(perfilDb?.creatorApplicationStatus || '').trim().toLowerCase();
  const creatorMonetizationStatus = String(perfilDb?.creatorMonetizationStatus || '').trim().toLowerCase();
  const creatorMonetizationStatusEffective = effectiveCreatorMonetizationStatus(
    creatorMonetizationPreference,
    creatorMonetizationStatus
  );
  const creatorReviewReason = String(perfilDb?.creatorReviewReason || '').trim();
  const creatorMonetizationReviewReason = String(perfilDb?.creatorMonetizationReviewReason || '').trim();
  const creatorModerationAction = String(perfilDb?.creatorModerationAction || '').trim().toLowerCase();
  const creatorSignupIntent = String(perfilDb?.signupIntent || '').trim().toLowerCase();
  const birthIsoEffective =
    parseBirthDateBr(birthDateDraft) || (parseBirthDateLocal(birthDate) ? birthDate : '');
  const birthAge = birthIsoEffective ? ageFromBirthDateLocal(birthIsoEffective) : null;
  const isUnderageByBirthYear = birthAge != null && birthAge < 18;
  const isCreatorCandidate = creatorSignupIntent === 'creator' || creatorApplicationStatus !== '';
  const podeUsarAvatarPremium = podeUsarAvataresPremiumDaLoja(user, perfilDb, accountType);
  const avataresLiberados = listaAvatares.filter((item) => {
    if (normalizarAcessoAvatar(item) === 'publico') return true;
    return podeUsarAvatarPremium;
  });
  const creatorDisplayLabel = String(creatorDisplayName || novoNome || user?.displayName || '').trim() || 'Criador';
  const creatorSupportUrl = user?.uid ? apoieUrlAbsolutaParaCriador(user.uid) : '';
  const creatorPublicPath = user?.uid ? `/criador/${encodeURIComponent(user.uid)}` : '/creator/perfil';
  const mangakaExistingProfileImageUrl =
    adminAccess.isMangaka && perfilDb
      ? (() => {
          const candidates = [
            perfilDb?.creatorApplication?.profileImageUrl,
            perfilDb?.userAvatar,
            mangakaAvatarUrlDraft,
          ];
          for (const raw of candidates) {
            const u = String(raw || '').trim();
            if (/^https:\/\//i.test(u) && u.length >= 12 && u.length <= 2048) return u;
          }
          return '';
        })()
      : '';
  const mangakaCanOpenMonetizeRequestModal =
    adminAccess.isMangaka &&
    creatorMonetizationStatus !== 'active' &&
    creatorMonetizationStatus !== 'pending_review' &&
    creatorMonetizationStatus !== 'blocked_underage';
  const monetizacaoBloqueadaPorIdade =
    creatorMonetizationStatus === 'blocked_underage' || isUnderageByBirthYear;

  const handleMonetizarContaClick = () => {
    if (monetizacaoBloqueadaPorIdade) {
      setUnderageMonetizeModalOpen(true);
      return;
    }
    setCreatorMonetizationPreference('monetize');
    if (mangakaCanOpenMonetizeRequestModal) {
      setCreatorApplyModalOpen(true);
    }
  };
  const creatorStatusLabel = creatorMonetizationStatusLabel(
    creatorMonetizationPreference,
    creatorMonetizationStatus
  );
  const premiumAtivo = false;
  const premiumEntitlement = null;
  const membershipCriadorAtiva = false;
  const membershipsCriadorAtivas = [];
  const formatarTempoRestanteAssinatura = () => ({ ativo: false, texto: '' });
  const formatarDataLongaBr = (value, { seVazio = '—' } = {}) => (value ? String(value) : seVazio);

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
    const iso =
      parseBirthDateBr(birthDateDraft) || (parseBirthDateLocal(birthDate) ? birthDate : '');
    const age = iso ? ageFromBirthDateLocal(iso) : null;
    if (age != null && age < 18) {
      setCreatorMonetizationPreference('publish_only');
    }
  }, [birthDate, birthDateDraft]);

  const handleSalvar = async (e) => {
    e.preventDefault();

    if (!novoNome.trim()) {
      setMensagem({ texto: 'Dê um nome à sua alma!', tipo: 'erro' });
      return;
    }

    const birthIsoForSave =
      parseBirthDateBr(birthDateDraft) || (parseBirthDateLocal(birthDate) ? birthDate : '');
    const birthDraftHasDigits = birthDateDraft.replace(/\D/g, '').length > 0;
    if (birthDraftHasDigits && !parseBirthDateLocal(birthIsoForSave)) {
      setMensagem({ texto: 'Data de nascimento invalida. Use dia/mes/ano (ex.: 28/12/2001).', tipo: 'erro' });
      return;
    }

    const ano = birthIsoForSave && parseBirthDateLocal(birthIsoForSave) ? Number(birthIsoForSave.slice(0, 4)) : NaN;
    const membershipPrice = Number(String(creatorMembershipPriceBRL || '').replace(',', '.'));
    const suggestedDonation = Number(String(creatorDonationSuggestedBRL || '').replace(',', '.'));
    const notificationPrefs = {
      promotionsEmail: notifyPromotions === true,
    };

    const ageIfValid =
      birthIsoForSave && parseBirthDateLocal(birthIsoForSave)
        ? ageFromBirthDateLocal(birthIsoForSave)
        : null;
    const monetizationRequiresValues =
      adminAccess.isMangaka &&
      creatorMonetizationPreference === 'monetize' &&
      ageIfValid != null &&
      ageIfValid >= 18;

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
    if (adminAccess.isMangaka) {
      const bioLen = String(creatorBio || '').trim().length;
      const bioMinMangaka =
        creatorMonetizationPreference === 'monetize' ? CREATOR_BIO_MIN_LENGTH : CREATOR_BIO_MIN_LENGTH_PUBLISH_ONLY;
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

    try {
      let finalAvatar = avatarSelecionado;
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
        if (!/^https:\/\//i.test(u) || u.length > 2048) {
          setMensagem({ texto: 'URL da foto deve ser HTTPS valida.', tipo: 'erro' });
          setLoading(false);
          return;
        }
        finalAvatar = u;
      } else if (adminAccess.isMangaka) {
        const asUrl = String(avatarSelecionado || '').trim();
        if (/^https:\/\//i.test(asUrl) && asUrl.length <= 2048) {
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
            const keep = String(perfilDb?.userAvatar || user?.photoURL || '').trim();
            finalAvatar =
              /^https:\/\//i.test(keep) && keep.length <= 2048 ? keep : AVATAR_FALLBACK;
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

      const creatorPublicName = String(creatorDisplayName || novoNome || '').trim();
      const creatorStatusNext = adminAccess.isMangaka ? 'active' : null;
      const ageForMonet = birthIsoForSave ? ageFromBirthDateLocal(birthIsoForSave) : null;
      const creatorMonetizationRequestNeedsModal =
        adminAccess.isMangaka &&
        creatorMonetizationPreference === 'monetize' &&
        creatorMonetizationStatus !== 'active' &&
        creatorMonetizationStatus !== 'pending_review';
      const creatorMonetizationPreferenceNext = !adminAccess.isMangaka
        ? creatorMonetizationPreference
        : normalizeCreatorMonetizationPreference(creatorMonetizationPreference);
    const creatorMonetizationStatusNext = !adminAccess.isMangaka
      ? null
      : creatorMonetizationPreferenceNext !== 'monetize'
          ? 'disabled'
          : ageForMonet != null && ageForMonet < 18
            ? 'blocked_underage'
            : creatorMonetizationStatus === 'active'
              ? 'active'
              : creatorMonetizationStatus === 'pending_review'
                ? 'pending_review'
                : 'disabled';
      const socialValidation = validateCreatorSocialLinks({
        instagramUrl,
        youtubeUrl,
        requireOne: adminAccess.isMangaka && creatorMonetizationPreferenceNext === 'monetize',
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
            monetizationPreference: creatorMonetizationPreferenceNext,
            monetizationStatus: creatorMonetizationStatusNext,
            now: Date.now(),
          })
        : null;
      const buyerProfile = normalizeBuyerProfile({
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

      // 1. Atualiza no Firebase Auth
      await updateProfile(user, {
        displayName: novoNome.trim(),
        photoURL: finalAvatar,
      });

      // 2. Atualiza no Realtime Database (Leitor.jsx escuta daqui)
      await update(ref(db, `usuarios/${user.uid}`), {
        userName:   novoNome.trim(),
        userAvatar: finalAvatar,
        uid:        user.uid,
        notifyPromotions: notifyPromotions === true,
        notificationPrefs,
        gender,
        birthDate: birthIsoForSave && parseBirthDateLocal(birthIsoForSave) ? birthIsoForSave : null,
        birthYear: birthIsoForSave && parseBirthDateLocal(birthIsoForSave) ? ano : null,
        creatorDisplayName: creatorPublicName,
        creatorTermsAccepted: creatorTermsAccepted === true,
        creatorMonetizationPreference: creatorMonetizationPreferenceNext,
        creatorMonetizationStatus: creatorMonetizationStatusNext,
        creatorBio: String(creatorBio || '').trim(),
        buyerProfile,
        creatorBannerUrl: null,
        instagramUrl: String(instagramUrl || '').trim(),
        youtubeUrl: String(youtubeUrl || '').trim(),
        creatorMembershipEnabled:
          adminAccess.isMangaka &&
          creatorMonetizationPreferenceNext === 'monetize' &&
          (creatorMonetizationStatus === 'active' || creatorMonetizationStatus === 'pending_review')
            ? creatorMembershipEnabled
            : false,
        creatorMembershipPriceBRL:
          adminAccess.isMangaka &&
          creatorMonetizationPreferenceNext === 'monetize' &&
          (creatorMonetizationStatus === 'active' || creatorMonetizationStatus === 'pending_review')
            ? Math.round(membershipPrice * 100) / 100
            : null,
        creatorDonationSuggestedBRL:
          adminAccess.isMangaka &&
          creatorMonetizationPreferenceNext === 'monetize' &&
          (creatorMonetizationStatus === 'active' || creatorMonetizationStatus === 'pending_review')
            ? Math.round(suggestedDonation * 100) / 100
            : null,
        creatorOnboardingCompleted: adminAccess.isMangaka ? true : null,
        creatorOnboardingCompletedAt: adminAccess.isMangaka ? Number(perfilDb?.creatorOnboardingCompletedAt || Date.now()) : null,
        creatorStatus: creatorStatusNext,
        ...(creatorCanonicalDoc ? { creator: creatorCanonicalDoc } : {}),
        creatorProfile: adminAccess.isMangaka ? {
          ...(perfilDb?.creatorProfile && typeof perfilDb.creatorProfile === 'object' ? perfilDb.creatorProfile : {}),
          creatorId: user.uid,
          userId: user.uid,
          displayName: creatorPublicName,
          username: perfilDb?.creatorProfile?.username || perfilDb?.creatorUsername || user.uid,
          bioShort: String(creatorBio || '').trim(),
          bioFull: String(creatorBio || '').trim(),
          avatarUrl: finalAvatar,
          bannerUrl: '',
          socialLinks: {
            instagramUrl: String(instagramUrl || '').trim() || null,
            youtubeUrl: String(youtubeUrl || '').trim() || null,
          },
          monetizationEnabled: creatorMonetizationStatusNext === 'active',
          monetizationPreference: creatorMonetizationPreferenceNext,
          monetizationStatus: creatorMonetizationStatusNext,
          ageVerified: Boolean(birthIsoForSave && parseBirthDateLocal(birthIsoForSave)),
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
        userAvatar: finalAvatar,
        accountType,
        creatorDisplayName: creatorPublicName,
        creatorBio: String(creatorBio || '').trim(),
        creatorBannerUrl: null,
        instagramUrl: String(instagramUrl || '').trim(),
        youtubeUrl: String(youtubeUrl || '').trim(),
        creatorMonetizationPreference: creatorMonetizationPreferenceNext,
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
          avatarUrl: finalAvatar,
          bannerUrl: '',
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

      setAvatarSelecionado(finalAvatar);
      setMangakaAvatarFile(null);
      if (creatorMonetizationRequestNeedsModal) {
        setCreatorMonetizationPreference('publish_only');
      }
      if (listaAvatares.some((i) => i.url === finalAvatar)) {
        setMangakaAvatarUrlDraft('');
      } else if (adminAccess.isMangaka && /^https:\/\//i.test(finalAvatar)) {
        setMangakaAvatarUrlDraft(finalAvatar);
      }

      const savedBirth = birthIsoForSave && parseBirthDateLocal(birthIsoForSave) ? birthIsoForSave : '';
      setBirthDate(savedBirth);
      setBirthDateDraft(savedBirth ? formatBirthDateIsoToBr(savedBirth) : '');

      setMensagem({
        texto: creatorMonetizationRequestNeedsModal
          ? 'Perfil atualizado. Para pedir monetizacao, use o formulario de creator e envie nome legal, CPF e chave PIX; ate la voce continua publicando normalmente sem monetizacao.'
          : 'Perfil atualizado com sucesso!',
        tipo: 'sucesso',
      });
      setTimeout(() => navigate('/perfil', { replace: true }), 900);

    } catch (error) {
      console.error('Erro na forja:', error);
      setMensagem({ texto: 'Erro ao atualizar: ' + error.message, tipo: 'erro' });
    } finally {
      setLoading(false);
    }
  };

  const handleCreatorApplicationModalSubmit = async (payload) => {
    setCreatorApplicationLoading(true);
    setMensagem({ texto: '', tipo: '' });
    try {
      const { data, profileImageUrl } = await submitCreatorApplicationPayload({
        creatorSubmitApplication,
        payload,
        uid: user.uid,
      });
      setCreatorDisplayName(payload.displayName);
      setCreatorBio(payload.bioShort);
      const pbd = String(payload.birthDate || '').trim();
      setBirthDate(parseBirthDateLocal(pbd) ? pbd : '');
      setBirthDateDraft(parseBirthDateLocal(pbd) ? formatBirthDateIsoToBr(pbd) : '');
      setInstagramUrl(payload.instagramUrl);
      setYoutubeUrl(payload.youtubeUrl);
      setCreatorMonetizationPreference(payload.monetizationPreference);
      setCreatorTermsAccepted(payload.acceptTerms);
      setCreatorApplyModalOpen(false);
      setPerfilDb((prev) => {
        const current = prev && typeof prev === 'object' ? prev : {};
        const nextAvatar =
          data?.autoApproved && payload.monetizationPreference === 'publish_only' && profileImageUrl
            ? profileImageUrl
            : current.userAvatar;
        const nextStatus = data?.autoApproved
          ? 'approved'
          : data?.alreadyPending
            ? 'requested'
            : current.creatorApplicationStatus;
        const nextRole = data?.autoApproved ? 'mangaka' : current.role;
        return {
          ...current,
          role: nextRole,
          signupIntent: 'creator',
          creatorApplicationStatus: nextStatus,
          creatorDisplayName: payload.displayName,
          creatorBio: payload.bioShort,
          creatorTermsAccepted: payload.acceptTerms === true,
          creatorMonetizationPreference: payload.monetizationPreference,
          creatorMonetizationStatus:
            payload.monetizationPreference === 'monetize'
              ? (data?.alreadyMangaka ? 'pending_review' : 'pending_review')
              : (data?.autoApproved ? 'disabled' : (current.creatorMonetizationStatus || 'disabled')),
          instagramUrl: payload.instagramUrl || null,
          youtubeUrl: payload.youtubeUrl || null,
          birthDate: parseBirthDateLocal(pbd) ? pbd : current.birthDate || '',
          birthYear: parseBirthDateLocal(pbd) ? Number(pbd.slice(0, 4)) : current.birthYear || null,
          userAvatar: nextAvatar || current.userAvatar || '',
        };
      });
      if (data?.autoApproved && payload.monetizationPreference === 'publish_only' && profileImageUrl) {
        try {
          setAvatarSelecionado(profileImageUrl);
          setMangakaAvatarUrlDraft(profileImageUrl);
          await updateProfile(user, { photoURL: profileImageUrl });
          await refreshAuthUser(user);
        } catch (avErr) {
          console.warn('[Perfil] Nao foi possivel sincronizar avatar local apos candidatura:', avErr);
        }
      }
      if (data?.autoApproved) {
        setMensagem({
          texto: 'Acesso de criador liberado. Atualizando seu perfil para abrir o painel certo...',
          tipo: 'sucesso',
        });
        if (typeof window !== 'undefined') {
          window.setTimeout(() => {
            window.location.assign('/perfil');
          }, 700);
        }
      } else if (data?.alreadyMangaka && data?.monetizationPendingReviewSubmitted) {
        setMensagem({
          texto:
            'Dados de monetizacao enviados. Voce continua publicando normalmente; a equipe revisara antes de ativar repasses.',
          tipo: 'sucesso',
        });
      } else if (data?.alreadyMangaka && data?.monetizationPendingReview) {
        setMensagem({
          texto: 'Sua monetizacao ja esta em analise pela equipe.',
          tipo: 'sucesso',
        });
      } else if (data?.alreadyMangaka && data?.monetizationAlreadyActive) {
        setMensagem({ texto: 'Sua monetizacao ja esta ativa.', tipo: 'sucesso' });
      } else if (data?.alreadyMangaka) {
        setMensagem({ texto: 'Sua conta ja esta aprovada como criador.', tipo: 'sucesso' });
      } else if (data?.alreadyPending) {
        setMensagem({ texto: 'Sua solicitacao de criador ja esta em analise.', tipo: 'sucesso' });
      } else {
        setMensagem({
          texto:
            'Solicitacao enviada com monetizacao. A equipe vai revisar seus dados legais e repasse antes de ativar.',
          tipo: 'sucesso',
        });
      }
    } catch (err) {
      const msg = err?.message || 'Nao foi possivel enviar sua solicitacao agora.';
      setMensagem({ texto: msg, tipo: 'erro' });
      throw new Error(msg);
    } finally {
      setCreatorApplicationLoading(false);
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

  if (!user) return null; // guard enquanto o useEffect redireciona

  if (adminAccess.isMangaka) {
    return (
      <main className="perfil-page perfil-page--creator">
        <div className="perfil-card perfil-card--creator">
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
                <p className="perfil-creator-hero__meta">{creatorStatusLabel}</p>
                <div className="perfil-creator-hero__actions">
                  <button type="button" className="perfil-mangaka-apoio-copy" onClick={() => navigate(creatorPublicPath)}>
                    Ver pagina publica
                  </button>
                  {creatorMonetizationStatusEffective === 'active' ? (
                    <button type="button" className="perfil-mangaka-apoio-copy" onClick={handleCopyCreatorSupportLink}>
                      Copiar link de apoio
                    </button>
                  ) : null}
                  <button type="button" className="perfil-mangaka-apoio-copy" onClick={() => navigate('/creator/dashboard')}>
                    Dashboard
                  </button>
                </div>
                {creatorMonetizationReviewReason ? (
                  <p className="perfil-creator-hero__note">{creatorMonetizationReviewReason}</p>
                ) : null}
              </div>
            </div>
          </section>

          <form onSubmit={handleSalvar} className="perfil-creator-form">
            <div ref={mangakaFormAnchorRef} className="perfil-mangaka-fields-anchor" aria-hidden="true" />

            <section className="perfil-creator-panel">
              <div className="input-group perfil-creator-section-title">
                <label>IDENTIDADE PUBLICA</label>
                <p>Edite apenas o que faz diferenca para leitores e para sua pagina de autor.</p>
              </div>

              <div className="input-group">
                <label>NOME PUBLICO DO CRIADOR</label>
                <input
                  type="text"
                  className="perfil-input"
                  value={creatorDisplayName}
                  onChange={(e) => setCreatorDisplayName(e.target.value)}
                  placeholder="Como seu nome aparece para leitores"
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
                <label>FOTO DE PERFIL</label>
                <p className="perfil-mangaka-apoio-label" style={{ marginBottom: 8 }}>
                  A capa publica reaproveita a mesma imagem com blur. Envie arquivo ou use URL HTTPS.
                </p>
                <input
                  type="url"
                  className="perfil-input"
                  value={mangakaAvatarUrlDraft}
                  onChange={(e) => {
                    setMangakaAvatarUrlDraft(e.target.value);
                    setMangakaAvatarFile(null);
                  }}
                  placeholder="https://..."
                />
                <input
                  type="file"
                  className="perfil-input"
                  style={{ marginTop: 8 }}
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    setMangakaAvatarFile(f || null);
                    if (f) setMangakaAvatarUrlDraft('');
                  }}
                />
              </div>
            </section>

            <section className="perfil-creator-panel">
              <div className="input-group perfil-creator-section-title">
                <label>CONTA E MONETIZACAO</label>
                <p>Somente o essencial para manter sua pagina e seu apoio organizados.</p>
              </div>

              <div className="input-group">
                <label>NOME DE EXIBICAO DA CONTA</label>
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
                    onClick={handleMonetizarContaClick}
                  >
                    Monetizar
                  </button>
                </div>
                {mangakaCanOpenMonetizeRequestModal ? (
                  <p className="perfil-mangaka-apoio-label" style={{ marginTop: 10 }}>
                    Ao tocar em «Monetizar», abrimos o formulário para você enviar nome legal, CPF e PIX à equipe (foto HTTPS
                    do perfil conta como imagem se você não trocar).
                  </p>
                ) : null}
                {monetizacaoBloqueadaPorIdade ? (
                  <p className="perfil-mangaka-apoio-label perfil-mangaka-apoio-label--warn" style={{ marginTop: 10 }}>
                    Monetização não está disponível para menores de 18 anos. Toque em «Monetizar» para ver o motivo e o que
                    você ainda pode fazer na plataforma.
                  </p>
                ) : null}
              </div>

              {creatorMonetizationPreference === 'monetize' ? (
                <>
                  <p className="perfil-mangaka-apoio-label" style={{ marginBottom: 12 }}>
                    Valores e membership abaixo valem depois que a equipe aprovar sua monetizacao. Ate la voce publica
                    normalmente, sem receber repasses.
                  </p>
                  <div className="input-group">
                    <label className="notify-label">
                      <input
                        type="checkbox"
                        checked={creatorMembershipEnabled}
                        onChange={(e) => setCreatorMembershipEnabled(e.target.checked)}
                      />
                      Ativar membership na pagina publica
                    </label>
                  </div>

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

                  <div className="input-group">
                    <label>DOACAO SUGERIDA (R$)</label>
                    <input
                      type="text"
                      className="perfil-input"
                      value={creatorDonationSuggestedBRL}
                      onChange={(e) => setCreatorDonationSuggestedBRL(e.target.value)}
                      placeholder="7,00"
                    />
                  </div>
                </>
              ) : null}

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
            </section>

            <section className="perfil-creator-panel" id={PERFIL_LOJA_DADOS_HASH}>
              <div className="input-group perfil-creator-section-title">
                <label>DADOS DE COMPRA</label>
                <p>Esses dados so ficam obrigatorios quando voce for comprar na loja.</p>
              </div>

              <div className="input-group">
                <label>NOME COMPLETO</label>
                <input type="text" className="perfil-input" value={buyerFullName} onChange={(e) => setBuyerFullName(e.target.value)} placeholder="Nome para entrega" />
              </div>
              <div className="input-group">
                <label>CPF</label>
                <input type="text" inputMode="numeric" className="perfil-input" value={buyerCpf} onChange={(e) => setBuyerCpf(e.target.value.replace(/\D+/g, '').slice(0, 11))} placeholder="Somente numeros" />
              </div>
              <div className="input-group">
                <label>TELEFONE</label>
                <input type="text" inputMode="tel" className="perfil-input" value={buyerPhone} onChange={(e) => setBuyerPhone(e.target.value.replace(/\D+/g, '').slice(0, 11))} placeholder="DDD + numero" />
              </div>
              <div className="input-group">
                <label>CEP</label>
                <input type="text" inputMode="numeric" className="perfil-input" value={buyerPostalCode} onChange={(e) => setBuyerPostalCode(e.target.value.replace(/\D+/g, '').slice(0, 8))} placeholder="Somente numeros" />
              </div>
              <div className="input-group">
                <label>ESTADO</label>
                <select
                  className="perfil-input"
                  value={buyerState}
                  onChange={(e) => setBuyerState(e.target.value)}
                  aria-label="Estado (UF)"
                >
                  <option value="">Selecione o estado</option>
                  {BRAZILIAN_STATES.map(({ uf, name }) => (
                    <option key={uf} value={uf}>
                      {uf} — {name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="input-group">
                <label>CIDADE</label>
                <input type="text" className="perfil-input" value={buyerCity} onChange={(e) => setBuyerCity(e.target.value)} placeholder="Sua cidade" />
              </div>
              <div className="input-group">
                <label>BAIRRO</label>
                <input type="text" className="perfil-input" value={buyerNeighborhood} onChange={(e) => setBuyerNeighborhood(e.target.value)} placeholder="Seu bairro" />
              </div>
              <div className="input-group">
                <label>ENDERECO</label>
                <input type="text" className="perfil-input" value={buyerAddressLine1} onChange={(e) => setBuyerAddressLine1(e.target.value)} placeholder="Rua, numero e complemento principal" />
              </div>
              <div className="input-group">
                <label>COMPLEMENTO</label>
                <input type="text" className="perfil-input" value={buyerAddressLine2} onChange={(e) => setBuyerAddressLine2(e.target.value)} placeholder="Opcional" />
              </div>
            </section>

            {mensagem.texto ? (
              <p className={`feedback-msg ${mensagem.tipo}`}>{mensagem.texto}</p>
            ) : null}

            <div className="perfil-actions">
              <button type="submit" className="btn-save-perfil" disabled={loading}>
                {loading ? 'SALVANDO...' : 'SALVAR PERFIL'}
              </button>
              <button type="button" className="btn-cancel-perfil" onClick={() => navigate('/')}>
                Voltar
              </button>
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
                  Monetização indisponível (idade)
                </h2>
                <div className="perfil-modal__body">
                  <p>
                    Na MangaTeofilo, <strong>repasses financeiros</strong> (CPF, chave PIX, contrato de criador) exigem{' '}
                    <strong>maioridade (18 anos ou mais)</strong>, por exigência legal e política da plataforma.
                  </p>
                  {isUnderageByBirthYear ? (
                    <p>
                      A <strong>data de nascimento</strong> que você informou acima indica menos de 18 anos. Você pode
                      continuar <strong>publicando obras</strong> normalmente; quando for maior de idade, volte aqui e
                      solicite monetização.
                    </p>
                  ) : null}
                  {creatorMonetizationStatus === 'blocked_underage' ? (
                    <p>
                      Sua conta está com monetização <strong>bloqueada por idade</strong> no cadastro. Se a data de
                      nascimento estiver errada, corrija o campo <strong>Data de nascimento</strong> nesta página, salve o
                      perfil e aguarde análise da equipe, se aplicável.
                    </p>
                  ) : null}
                  <p className="perfil-modal__hint">
                    Dúvidas ou correção de dados: use o suporte da plataforma ou fale com a equipe pelo canal oficial.
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

          <CreatorApplicationModal
            open={creatorApplyModalOpen}
            intent="mangaka_monetize"
            onClose={() => {
              if (!creatorApplicationLoading) {
                setCreatorApplyModalOpen(false);
                const pref = String(perfilDb?.creatorMonetizationPreference || 'publish_only').trim().toLowerCase();
                setCreatorMonetizationPreference(pref === 'monetize' ? 'monetize' : 'publish_only');
              }
            }}
            loading={creatorApplicationLoading}
            initial={{
              displayName: creatorDisplayName,
              bio: creatorBio,
              instagramUrl,
              youtubeUrl,
              monetizationPreference: 'monetize',
              termsAccepted: creatorTermsAccepted,
              birthDate: birthDate || perfilDb?.birthDate || '',
              legalFullName: String(perfilDb?.creatorCompliance?.legalFullName || '').trim(),
              taxId: String(perfilDb?.creatorCompliance?.taxId || '').trim(),
              payoutInstructions: String(perfilDb?.creatorCompliance?.payoutInstructions || '').trim(),
              payoutPixType: String(perfilDb?.creatorCompliance?.payoutPixType || '').trim().toLowerCase(),
              profileImageCrop: perfilDb?.creatorApplication?.profileImageCrop || null,
              existingProfileImageUrl: mangakaExistingProfileImageUrl,
            }}
            onSubmit={handleCreatorApplicationModalSubmit}
          />
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
              <div className="perfil-mangaka-apoio-row">
                <button
                  type="button"
                  className="perfil-mangaka-apoio-copy perfil-creator-apply-btn"
                  disabled={creatorApplicationLoading}
                  onClick={() => setCreatorApplyModalOpen(true)}
                >
                  {isCreatorCandidate ? 'Enviar novo pedido de criador' : 'Quero virar criador'}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        <CreatorApplicationModal
          open={creatorApplyModalOpen}
          onClose={() => {
            if (!creatorApplicationLoading) setCreatorApplyModalOpen(false);
          }}
          loading={creatorApplicationLoading}
          initial={{
            displayName: creatorDisplayName,
            bio: creatorBio,
            instagramUrl,
            youtubeUrl,
            monetizationPreference: creatorMonetizationPreference,
            termsAccepted: creatorTermsAccepted,
            birthDate,
            legalFullName: String(perfilDb?.creatorCompliance?.legalFullName || '').trim(),
            taxId: String(perfilDb?.creatorCompliance?.taxId || '').trim(),
            payoutInstructions: String(perfilDb?.creatorCompliance?.payoutInstructions || '').trim(),
            payoutPixType: String(perfilDb?.creatorCompliance?.payoutPixType || '').trim().toLowerCase(),
            profileImageCrop: perfilDb?.creatorApplication?.profileImageCrop || null,
            existingProfileImageUrl: (() => {
              const candidates = [perfilDb?.creatorApplication?.profileImageUrl, perfilDb?.userAvatar];
              for (const raw of candidates) {
                const u = String(raw || '').trim();
                if (/^https:\/\//i.test(u) && u.length >= 12 && u.length <= 2048) return u;
              }
              return '';
            })(),
          }}
          onSubmit={handleCreatorApplicationModalSubmit}
        />

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
            <label>DATA DE NASCIMENTO</label>
            <input
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

          <section id={PERFIL_LOJA_DADOS_HASH} className="perfil-section-loja-dados">
            <div className="input-group perfil-creator-section-title">
              <label>DADOS PARA COMPRA NA LOJA</label>
              <p>Obrigatórios para finalizar pedidos físicos; você pode preencher com calma.</p>
            </div>

            <div className="input-group">
              <label>NOME COMPLETO PARA COMPRA</label>
              <input type="text" className="perfil-input" value={buyerFullName} onChange={(e) => setBuyerFullName(e.target.value)} placeholder="Usado em pedidos da loja" />
            </div>

            <div className="input-group">
              <label>CPF</label>
              <input type="text" inputMode="numeric" className="perfil-input" value={buyerCpf} onChange={(e) => setBuyerCpf(e.target.value.replace(/\D+/g, '').slice(0, 11))} placeholder="Somente numeros" />
            </div>

            <div className="input-group">
              <label>TELEFONE</label>
              <input type="text" inputMode="tel" className="perfil-input" value={buyerPhone} onChange={(e) => setBuyerPhone(e.target.value.replace(/\D+/g, '').slice(0, 11))} placeholder="DDD + numero" />
            </div>

            <div className="input-group">
              <label>CEP</label>
              <input type="text" inputMode="numeric" className="perfil-input" value={buyerPostalCode} onChange={(e) => setBuyerPostalCode(e.target.value.replace(/\D+/g, '').slice(0, 8))} placeholder="Somente numeros" />
            </div>

            <div className="input-group">
              <label>ESTADO</label>
              <select
                className="perfil-input"
                value={buyerState}
                onChange={(e) => setBuyerState(e.target.value)}
                aria-label="Estado (UF)"
              >
                <option value="">Selecione o estado</option>
                {BRAZILIAN_STATES.map(({ uf, name }) => (
                  <option key={uf} value={uf}>
                    {uf} — {name}
                  </option>
                ))}
              </select>
            </div>

            <div className="input-group">
              <label>CIDADE</label>
              <input type="text" className="perfil-input" value={buyerCity} onChange={(e) => setBuyerCity(e.target.value)} placeholder="Sua cidade" />
            </div>

            <div className="input-group">
              <label>BAIRRO</label>
              <input type="text" className="perfil-input" value={buyerNeighborhood} onChange={(e) => setBuyerNeighborhood(e.target.value)} placeholder="Seu bairro" />
            </div>

            <div className="input-group">
              <label>ENDERECO</label>
              <input type="text" className="perfil-input" value={buyerAddressLine1} onChange={(e) => setBuyerAddressLine1(e.target.value)} placeholder="Rua, numero e complemento principal" />
            </div>

            <div className="input-group">
              <label>COMPLEMENTO</label>
              <input type="text" className="perfil-input" value={buyerAddressLine2} onChange={(e) => setBuyerAddressLine2(e.target.value)} placeholder="Opcional" />
            </div>
          </section>

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

          {!adminAccess.isMangaka ? (
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
          ) : (
            <p className="perfil-mangaka-apoio-label" style={{ marginTop: 8 }}>
              Sua foto publica e a enviada acima (arquivo ou URL). Contas criador nao usam a grade de avatares da
              plataforma.
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
