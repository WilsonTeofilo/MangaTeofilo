// src/pages/Perfil/Perfil.jsx
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { updateProfile } from 'firebase/auth';
import { ref, update, get, onValue, set, remove } from 'firebase/database';
import { useLocation, useNavigate } from 'react-router-dom';

import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { db, storage } from '../../services/firebase';
import { processCreatorProfileImageToWebp } from '../../utils/creatorProfileImage';
import {
  LISTA_AVATARES,
  AVATAR_FALLBACK,
  isAdminUser,
  DISPLAY_NAME_MAX_LENGTH,
  CREATOR_BIO_MAX_LENGTH,
  CREATOR_BIO_MIN_LENGTH,
  CREATOR_BIO_MIN_LENGTH_PUBLISH_ONLY,
  CREATOR_MEMBERSHIP_PRICE_MAX_BRL,
  CREATOR_MEMBERSHIP_PRICE_MIN_BRL,
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
  parseBirthDateFlexible,
  parseBirthDateLocal,
} from '../../utils/birthDateAge';
import { buildCreatorRecordForProfileSave } from '../../utils/creatorRecord';
import {
  creatorMonetizationStatusLabel,
  effectiveCreatorMonetizationStatus,
  normalizeCreatorMonetizationPreference,
  resolveCreatorMonetizationStatusFromDb,
} from '../../utils/creatorMonetizationUi';
import { BRAZILIAN_STATES, PERFIL_LOJA_DADOS_HASH } from '../../utils/brazilianStates';
import { normalizeBuyerProfile, sanitizeBuyerProfileForSave } from '../../utils/storeBuyerProfile';
import { refreshAuthUser } from '../../userProfileSyncV2';
import { syncReaderPublicFavoritesMirror } from '../../utils/readerPublicProfile';
import { validateCreatorSocialLinks } from '../../utils/creatorSocialLinks';
import {
  normalizeUsernameInput,
  validateUsernameHandle,
  suggestUsernameFromDisplayName,
} from '../../utils/usernameValidation';
import './Perfil.css';

// Recebe `user` via prop (consistente com App.jsx)
// Nao usa mais auth.currentUser diretamente para evitar dessincronizacao
export default function Perfil({
  user,
  adminAccess = emptyAdminAccess(),
  /** Equipe com painel admin: nunca layout creator, só conta leitor. */
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
  const [userHandleDraft, setUserHandleDraft] = useState('');
  const [usernameCheck, setUsernameCheck] = useState({ status: 'idle', message: '' });
  const [underageMonetizeModalOpen, setUnderageMonetizeModalOpen] = useState(false);
  const [readerProfilePublicDraft, setReaderProfilePublicDraft] = useState(false);
  const [readerPublicAvatarUrl, setReaderPublicAvatarUrl] = useState('');
  /** Evita trocar foto de autor por avatar da loja sem intenção (painel fechado + cadeado). */
  const [lojaAvatarAuthorUnlocked, setLojaAvatarAuthorUnlocked] = useState(false);
  const mangakaFormAnchorRef = useRef(null);
  const mangakaBirthInputRef = useRef(null);
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
    const carregarPerfil = async () => {
      const snap = await get(ref(db, `usuarios/${user.uid}`));
      const perfil = snap.val() || {};
      setPerfilDb(perfil);
      setNotifyPromotions(Boolean(perfil.notifyPromotions));
      setNotifyCommentSocial(perfil.notificationPrefs?.commentSocialInApp !== false);
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
      const publicName = String(perfil.creatorDisplayName || perfil.userName || user.displayName || '').trim();
      setCreatorDisplayName(publicName);
      setNovoNome(publicName || String(perfil.userName || user.displayName || '').trim() || '');
      setUserHandleDraft(String(perfil.userHandle || '').trim().toLowerCase());
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
      const authPhoto = String(user.photoURL || '').trim();
      const resolvedAvatar = ua || authPhoto;
      savedUserAvatarRef.current = resolvedAvatar;
      if (resolvedAvatar) {
        setAvatarSelecionado(resolvedAvatar);
      }
      setReaderProfilePublicDraft(
        adminAccess.isMangaka ? true : Boolean(perfil.readerProfilePublic)
      );
      const rpa = String(perfil.readerProfileAvatarUrl || '').trim();
      setReaderPublicAvatarUrl(rpa);
    };

    if (!user) {
      navigate('/login');
      return;
    }
    carregarPerfil().catch(() => setNotifyPromotions(false));
  }, [user, navigate, adminAccess.isMangaka]);

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
  const creatorMonetizationStatusRaw = String(perfilDb?.creatorMonetizationStatus || '').trim().toLowerCase();
  const creatorMonetizationStatusResolved = resolveCreatorMonetizationStatusFromDb(perfilDb || {});
  const creatorMonetizationStatus =
    creatorMonetizationStatusResolved !== '' ? creatorMonetizationStatusResolved : creatorMonetizationStatusRaw;
  const creatorMonetizationStatusEffective = effectiveCreatorMonetizationStatus(
    creatorMonetizationPreference,
    creatorMonetizationStatus
  );
  /** Já aprovado pela equipe (ou equivalente) — religar monetização não pede formulário de novo. */
  const hasMonetizationClearance = useMemo(() => {
    if (perfilDb?.creatorMonetizationApprovedOnce === true) return true;
    if (String(perfilDb?.creatorApplicationStatus || '').toLowerCase() === 'approved') return true;
    return creatorMonetizationStatus === 'active' || creatorMonetizationStatus === 'pending_review';
  }, [perfilDb, creatorMonetizationStatus]);
  const creatorReviewReason = String(perfilDb?.creatorReviewReason || '').trim();
  const creatorMonetizationReviewReason = String(perfilDb?.creatorMonetizationReviewReason || '').trim();
  const creatorModerationAction = String(perfilDb?.creatorModerationAction || '').trim().toLowerCase();
  const creatorSignupIntent = String(perfilDb?.signupIntent || '').trim().toLowerCase();
  const birthIsoEffective = parseBirthDateFlexible(birthDateDraft, birthDate);
  const birthAge = birthIsoEffective ? ageFromBirthDateLocal(birthIsoEffective) : null;
  const isUnderageByBirthYear = birthAge != null && birthAge < 18;
  const isCreatorCandidate = creatorSignupIntent === 'creator' || creatorApplicationStatus !== '';
  const podeUsarAvatarPremium = podeUsarAvataresPremiumDaLoja(user, perfilDb, accountType);
  const avataresLiberados = listaAvatares.filter((item) => {
    if (normalizarAcessoAvatar(item) === 'publico') return true;
    return podeUsarAvatarPremium;
  });
  const creatorDisplayLabel = String(creatorDisplayName || novoNome || user?.displayName || '').trim() || 'Criador';
  const creatorHandleLocked = String(perfilDb?.userHandle || '').trim().toLowerCase();
  const creatorSupportUrl = user?.uid ? apoieUrlAbsolutaParaCriador(user.uid) : '';
  const creatorPublicPath = user?.uid ? `/criador/${encodeURIComponent(user.uid)}` : '/perfil';
  const needsFirstMonetizationApplication =
    adminAccess.isMangaka && !hasMonetizationClearance && creatorMonetizationStatus === 'disabled';
  const monetizacaoBloqueadaPorIdade =
    creatorMonetizationStatus === 'blocked_underage' || isUnderageByBirthYear;

  const handleMonetizarContaClick = () => {
    if (monetizacaoBloqueadaPorIdade) {
      setUnderageMonetizeModalOpen(true);
      return;
    }
    if (!hasMonetizationClearance && creatorMonetizationStatus === 'disabled') {
      navigate('/creator/onboarding?intent=mangaka_monetize');
      return;
    }
    setCreatorMonetizationPreference('monetize');
  };

  const handleDesativarMonetizacaoClick = () => {
    setCreatorMonetizationPreference('publish_only');
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
    setUsernameCheck({ status: 'checking', message: 'Verificando…' });
    const t = window.setTimeout(() => {
      get(ref(db, `usernames/${norm}`))
        .then((snap) => {
          if (snap.exists() && snap.val() !== user.uid) {
            setUsernameCheck({ status: 'taken', message: 'Já em uso' });
          } else {
            setUsernameCheck({ status: 'ok', message: 'Disponível' });
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
        texto: adminAccess.isMangaka ? 'Defina o nome público do criador.' : 'Dê um nome à sua alma!',
        tipo: 'erro',
      });
      return;
    }

    const lockedHandlePreview = String(perfilDb?.userHandle || '').trim().toLowerCase();
    const wantHandlePreview = normalizeUsernameInput(userHandleDraft);
    if (!lockedHandlePreview && !wantHandlePreview && !isAdminUser(user)) {
      setMensagem({
        texto: 'Defina um @username único (só letras minúsculas, números e _). Ele não poderá ser alterado depois.',
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
            texto: 'Para ativar o perfil público de leitor, defina um @username único e salve.',
            tipo: 'erro',
          });
          return;
        }
      }
    }

    const birthIsoForSave = parseBirthDateFlexible(birthDateDraft, birthDate);
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
      commentSocialInApp: notifyCommentSocial === true,
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

    if (
      monetizationRequiresValues &&
      (!Number.isFinite(membershipPrice) ||
        membershipPrice < CREATOR_MEMBERSHIP_PRICE_MIN_BRL ||
        membershipPrice > CREATOR_MEMBERSHIP_PRICE_MAX_BRL)
    ) {
      setMensagem({
        texto: `Defina o valor da membership entre R$ ${CREATOR_MEMBERSHIP_PRICE_MIN_BRL},00 e R$ ${CREATOR_MEMBERSHIP_PRICE_MAX_BRL},00 (acesso antecipado às suas obras).`,
        tipo: 'erro',
      });
      return;
    }
    if (
      monetizationRequiresValues &&
      (!Number.isFinite(suggestedDonation) ||
        suggestedDonation < CREATOR_MEMBERSHIP_PRICE_MIN_BRL ||
        suggestedDonation > CREATOR_MEMBERSHIP_PRICE_MAX_BRL)
    ) {
      setMensagem({
        texto: `Defina a doação sugerida entre R$ ${CREATOR_MEMBERSHIP_PRICE_MIN_BRL},00 e R$ ${CREATOR_MEMBERSHIP_PRICE_MAX_BRL},00.`,
        tipo: 'erro',
      });
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

    let claimedNewHandle = null;
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
          setMensagem({ texto: avErr?.message || 'Não foi possível processar a foto.', tipo: 'erro' });
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

      const readerPub = adminAccess.isMangaka === true || readerProfilePublicDraft === true;
      const readerAvatarSave = readerPub ? finalAvatar : null;

      const creatorPublicName = String(creatorDisplayName || novoNome || '').trim();
      const creatorStatusNext = adminAccess.isMangaka ? 'active' : null;
      const ageForMonet = birthIsoForSave ? ageFromBirthDateLocal(birthIsoForSave) : null;
      const clearanceNow =
        perfilDb?.creatorMonetizationApprovedOnce === true ||
        String(perfilDb?.creatorApplicationStatus || '').toLowerCase() === 'approved' ||
        creatorMonetizationStatus === 'active' ||
        creatorMonetizationStatus === 'pending_review';
      const creatorMonetizationPreferenceNext = !adminAccess.isMangaka
        ? creatorMonetizationPreference
        : normalizeCreatorMonetizationPreference(creatorMonetizationPreference);
      const creatorMonetizationStatusNext = !adminAccess.isMangaka
        ? null
        : creatorMonetizationPreferenceNext !== 'monetize'
          ? ['active', 'pending_review', 'blocked_underage'].includes(creatorMonetizationStatus)
            ? creatorMonetizationStatus
            : 'disabled'
          : ageForMonet != null && ageForMonet < 18
            ? 'blocked_underage'
            : creatorMonetizationStatus === 'pending_review'
              ? 'pending_review'
              : creatorMonetizationStatus === 'blocked_underage'
                ? 'blocked_underage'
                : clearanceNow
                  ? 'active'
                  : 'disabled';
      const creatorMonetizationRequestNeedsModal =
        adminAccess.isMangaka &&
        creatorMonetizationPreferenceNext === 'monetize' &&
        creatorMonetizationStatusNext === 'disabled' &&
        !clearanceNow;
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

      if (!existingHandle && !wantHandle && !isAdminUser(user)) {
        setMensagem({
          texto: 'Defina um @username único (só letras minúsculas, números e _). Ele não poderá ser alterado depois.',
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
        if (!isAdminUser(user) && usernameCheck.status === 'taken') {
          setMensagem({ texto: 'Este @username já está em uso.', tipo: 'erro' });
          setLoading(false);
          return;
        }
        const takenSnap = await get(ref(db, `usernames/${wantHandle}`));
        if (takenSnap.exists() && takenSnap.val() !== user.uid) {
          setMensagem({ texto: 'Este @username já está em uso.', tipo: 'erro' });
          setLoading(false);
          return;
        }
        await set(ref(db, `usernames/${wantHandle}`), user.uid);
        claimedNewHandle = wantHandle;
      }

      const persistedHandle = existingHandle || claimedNewHandle || '';

      // 1. Atualiza no Firebase Auth (mangaka: mesmo texto que nome público)
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
      await update(ref(db, `usuarios/${user.uid}`), {
        userName: accountDisplayName,
        ...(persistedHandle ? { userHandle: persistedHandle } : {}),
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
        ...(creatorMonetizationStatusNext === 'active' ? { creatorMonetizationApprovedOnce: true } : {}),
        creatorBio: String(creatorBio || '').trim(),
        buyerProfile,
        readerProfilePublic: readerPub,
        readerProfileAvatarUrl: readerAvatarSave,
        creatorBannerUrl: null,
        instagramUrl: String(instagramUrl || '').trim(),
        youtubeUrl: String(youtubeUrl || '').trim(),
        creatorMembershipEnabled:
          adminAccess.isMangaka &&
          creatorMonetizationPreferenceNext === 'monetize' &&
          (creatorMonetizationStatusNext === 'active' || creatorMonetizationStatusNext === 'pending_review')
            ? creatorMembershipEnabled
            : false,
        creatorMembershipPriceBRL:
          adminAccess.isMangaka &&
          creatorMonetizationPreferenceNext === 'monetize' &&
          (creatorMonetizationStatusNext === 'active' || creatorMonetizationStatusNext === 'pending_review')
            ? Math.round(membershipPrice * 100) / 100
            : null,
        creatorDonationSuggestedBRL:
          adminAccess.isMangaka &&
          creatorMonetizationPreferenceNext === 'monetize' &&
          (creatorMonetizationStatusNext === 'active' || creatorMonetizationStatusNext === 'pending_review')
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
          username: persistedHandle || perfilDb?.creatorProfile?.username || perfilDb?.creatorUsername || user.uid,
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
        userName: accountDisplayName,
        ...(persistedHandle ? { userHandle: persistedHandle } : {}),
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
          username: persistedHandle || perfilDb?.creatorProfile?.username || perfilDb?.creatorUsername || user.uid,
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
        notificationPrefs,
        updatedAt: Date.now(),
      });

      await syncReaderPublicFavoritesMirror(db, user.uid);

      savedUserAvatarRef.current = String(finalAvatar || '').trim();
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
          ? 'Perfil salvo. Para pedir monetização, use o formulário de creator e envie nome legal, CPF e chave PIX. Até lá, você continua publicando normalmente, só sem repasse financeiro.'
          : 'Perfil atualizado com sucesso!',
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
      setMensagem({ texto: 'Não foi possível copiar o link agora.', tipo: 'erro' });
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
          placeholder="Apenas números"
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
          placeholder="DDD + número (só dígitos)"
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
          placeholder="8 dígitos, sem traço"
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
              {uf} — {name}
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
        <label>Endereço</label>
        <input
          type="text"
          className="perfil-input"
          value={buyerAddressLine1}
          onChange={(e) => setBuyerAddressLine1(e.target.value)}
          placeholder="Rua, número e complemento"
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
          <strong>Opcional</strong> — só para <strong>compras</strong> na loja (entrega física). Pode salvar o perfil com
          tudo em branco; na hora de pagar, o checkout exige endereço e documentos válidos.
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
                    {creatorHandleLocked || normalizeUsernameInput(userHandleDraft) || '…'}
                  </p>
                ) : null}
                <p className="perfil-creator-hero__meta">{creatorStatusLabel}</p>
                <div className="perfil-creator-hero__actions">
                  <button
                    type="button"
                    className="perfil-creator-hero__btn perfil-creator-hero__btn--primary"
                    onClick={() => navigate(creatorPublicPath)}
                  >
                    Ver página pública
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
                {creatorMonetizationReviewReason ? (
                  <p className="perfil-creator-hero__note">{creatorMonetizationReviewReason}</p>
                ) : null}
              </div>
            </div>
          </section>

          <div className="perfil-creator-cta-card perfil-creator-progress-links" id="creator-level">
            <p className="perfil-creator-progress-links__lead">
              Acompanhe seu crescimento na plataforma e complete missões semanais para ganhar destaque.
            </p>
            <div className="perfil-creator-progress-links__row">
              <button type="button" className="perfil-mangaka-apoio-copy" onClick={() => navigate('/creator/monetizacao')}>
                Abrir monetização
              </button>
              <button type="button" className="perfil-mangaka-apoio-copy" onClick={() => navigate('/creator/missoes')}>
                Abrir missões &amp; XP
              </button>
            </div>
          </div>

          <form onSubmit={handleSalvar} className="perfil-creator-form">
            <div ref={mangakaFormAnchorRef} className="perfil-mangaka-fields-anchor" aria-hidden="true" />

            <section className="perfil-creator-section" aria-labelledby="perfil-section-identidade">
              <header className="perfil-creator-section-head">
                <h2 id="perfil-section-identidade" className="perfil-creator-section-heading">
                  Identidade pública
                </h2>
                <p className="perfil-creator-section-sub">
                  O que os leitores veem no seu perfil de autor — nome, bio, redes e foto.
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
                <label>BIO PÚBLICA</label>
                <textarea
                  className="perfil-input"
                  rows={4}
                  value={creatorBio}
                  maxLength={CREATOR_BIO_MAX_LENGTH}
                  onChange={(e) => setCreatorBio(e.target.value.slice(0, CREATOR_BIO_MAX_LENGTH))}
                  placeholder="Conta um pouco do seu universo, do seu traço e do que você publica por aqui."
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

              <section className="perfil-creator-section perfil-creator-section--compact" aria-labelledby="perfil-unified-reader">
                <header className="perfil-creator-section-head">
                  <h2 id="perfil-unified-reader" className="perfil-creator-section-heading">
                    Leituras no mesmo perfil
                  </h2>
                  <p className="perfil-creator-section-sub">
                    Quem te segue vê suas obras na aba <strong>Obras</strong> e o que você curte na aba{' '}
                    <strong>Curtidas</strong> — um único link público, como em perfis de autor em outras plataformas. A
                    foto usada nas curtidas é a mesma da sua identidade de autor (abaixo), salvo se você usar só URL/arquivo
                    próprio.
                  </p>
                  {user?.uid ? (
                    <p className="perfil-mangaka-apoio-label" style={{ marginTop: 10 }}>
                      <button
                        type="button"
                        className="perfil-mangaka-apoio-copy"
                        onClick={() => navigate(`${creatorPublicPath}?tab=likes`)}
                      >
                        Abrir meu perfil público (obras e curtidas)
                      </button>
                    </p>
                  ) : null}
                </header>
              </section>

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
                      ? 'Fechar escolha de avatar da loja'
                      : 'Usar estampa da loja como foto de autor (opcional)'}
                  </span>
                </button>
                {!lojaAvatarAuthorUnlocked ? (
                  <p className="perfil-loja-avatar-gate__hint">
                    Abra só se quiser trocar sua foto atual por um avatar pronto. Quem tem Premium continua podendo usar
                    avatares premium da loja também como membro.
                  </p>
                ) : (
                  <div className="avatar-selection-section perfil-loja-avatar-gate__grid">
                    <p className="perfil-mangaka-apoio-label" style={{ marginBottom: 8 }}>
                      Toque em uma estampa para aplicar na <strong>foto de autor</strong> ao salvar o perfil (substitui
                      URL/arquivo se você escolher uma daqui).
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
                              bloqueado ? 'Disponível apenas para conta Premium ativa' : 'Usar como foto de autor'
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
                  A capa pública reaproveita a mesma foto com um leve blur. Envie arquivo ou cole uma URL HTTPS.
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

            <section className="perfil-creator-section" aria-labelledby="perfil-section-conta">
              <header className="perfil-creator-section-head">
                <h2 id="perfil-section-conta" className="perfil-creator-section-heading">
                  Conta
                </h2>
                <p className="perfil-creator-section-sub">Username único, data de nascimento e e-mail promocional.</p>
              </header>

              <div className="input-group" id="username-handle">
                <label>USERNAME (@)</label>
                <p className="perfil-mangaka-apoio-label" style={{ marginBottom: 8 }}>
                  Único na plataforma. Depois de salvo, não altera. URL:{' '}
                  <strong>mangateofilo.com/@{normalizeUsernameInput(userHandleDraft) || 'seuuser'}</strong>
                </p>
                <input
                  type="text"
                  className="perfil-input"
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
                  Receber promoções e campanhas por e-mail
                </label>
              </div>
              <div className="input-group perfil-creator-notify-row">
                <label className="notify-label">
                  <input
                    type="checkbox"
                    checked={notifyCommentSocial}
                    onChange={(e) => setNotifyCommentSocial(e.target.checked)}
                  />
                  Avisos no app quando alguém curtir ou responder seus comentários em capítulos
                </label>
              </div>
            </section>

            <section className="perfil-creator-section" aria-labelledby="perfil-section-monetizacao">
              <header className="perfil-creator-section-head">
                <h2 id="perfil-section-monetizacao" className="perfil-creator-section-heading">
                  Monetização
                </h2>
                <p className="perfil-creator-section-sub">
                  Aprovação da equipe é feita uma vez. Depois, você liga ou desliga repasses quando quiser.
                </p>
              </header>

              <div className="perfil-creator-monetization-card">
                {creatorMonetizationStatus === 'pending_review' ? (
                  <p className="perfil-creator-monetization-card__status perfil-creator-monetization-card__status--pending">
                    <strong>Status:</strong> em revisão pela equipe.
                  </p>
                ) : creatorMonetizationStatus === 'blocked_underage' || monetizacaoBloqueadaPorIdade ? (
                  <p className="perfil-creator-monetization-card__status perfil-creator-monetization-card__status--warn">
                    <strong>Status:</strong> indisponível por idade (18+ para repasse).
                  </p>
                ) : creatorMonetizationStatusEffective === 'active' ? (
                  <p className="perfil-creator-monetization-card__status perfil-creator-monetization-card__status--on">
                    <strong>Status:</strong> ativa — recebendo repasses.
                  </p>
                ) : hasMonetizationClearance &&
                  normalizeCreatorMonetizationPreference(creatorMonetizationPreference) === 'publish_only' ? (
                  <p className="perfil-creator-monetization-card__status">
                    <strong>Status:</strong> desligada — você só publica; repasse está pausado.
                  </p>
                ) : (
                  <p className="perfil-creator-monetization-card__status">
                    <strong>Status:</strong> desligada — ative para pedir ou concluir cadastro de repasse.
                  </p>
                )}

                <div className="perfil-creator-monetization-card__actions">
                  {creatorMonetizationStatusEffective === 'active' ? (
                    <button
                      type="button"
                      className="perfil-creator-monetization-toggle perfil-creator-monetization-toggle--off"
                      onClick={handleDesativarMonetizacaoClick}
                    >
                      Desativar monetização
                    </button>
                  ) : creatorMonetizationStatus === 'pending_review' ? (
                    <button
                      type="button"
                      className="perfil-creator-monetization-toggle perfil-creator-monetization-toggle--ghost"
                      onClick={handleDesativarMonetizacaoClick}
                    >
                      Voltar a só publicar enquanto aguardo
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="perfil-creator-monetization-toggle perfil-creator-monetization-toggle--on"
                      onClick={handleMonetizarContaClick}
                      disabled={monetizacaoBloqueadaPorIdade}
                    >
                      Ativar monetização
                    </button>
                  )}
                </div>

                {needsFirstMonetizationApplication ? (
                  <p className="perfil-mangaka-apoio-label" style={{ marginTop: 12 }}>
                    Na primeira vez, abrimos o formulário com nome legal, CPF e PIX. Depois de aprovado, não precisa enviar
                    de novo para religar.
                  </p>
                ) : null}
              </div>

              {creatorMonetizationPreference === 'monetize' &&
              (creatorMonetizationStatusEffective === 'active' || creatorMonetizationStatus === 'pending_review') ? (
                <>
                  <p className="perfil-mangaka-apoio-label" style={{ marginBottom: 12 }}>
                    Membership nas suas obras (não é Premium do site). Valores entre R$ {CREATOR_MEMBERSHIP_PRICE_MIN_BRL} e
                    R$ {CREATOR_MEMBERSHIP_PRICE_MAX_BRL}.
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
                      placeholder={`${CREATOR_MEMBERSHIP_PRICE_MIN_BRL},00 a ${CREATOR_MEMBERSHIP_PRICE_MAX_BRL},00`}
                    />
                  </div>

                  <div className="input-group">
                    <label>DOAÇÃO SUGERIDA NO APOIO (R$)</label>
                    <input
                      type="text"
                      className="perfil-input"
                      value={creatorDonationSuggestedBRL}
                      onChange={(e) => setCreatorDonationSuggestedBRL(e.target.value)}
                      placeholder={`${CREATOR_MEMBERSHIP_PRICE_MIN_BRL},00 a ${CREATOR_MEMBERSHIP_PRICE_MAX_BRL},00`}
                    />
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
                  Só para compras físicas na loja. Pode deixar em branco até a hora do checkout.
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

        </div>
      </main>
    );
  }

  return (
    <main className="perfil-page">
      <div className="perfil-card">
        <h1 className="perfil-title">Meu perfil</h1>
        <p className="perfil-subtitle">Atualize seus dados e preferências da conta.</p>

        {!adminAccess.isMangaka && !adminAccess.canAccessAdmin ? (
          <div className="perfil-mangaka-apoio">
            <p className="perfil-mangaka-apoio-label">
              Quer publicar por aqui? O perfil de criador abre página pública, catálogo seu, capítulos, painel
              financeiro e membership por autor. O cadastro é numa página só — sem modal.
            </p>
            {creatorApplicationStatus === 'requested' ? (
              <>
                <p className="perfil-mangaka-apoio-label">
                  Sua solicitação está em análise. Você pode abrir o mesmo fluxo para revisar o que enviou.
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
                Seu acesso de criador foi aprovado. Se o painel ainda não mudou, recarregue a página para atualizar
                as permissões da sua conta.
              </p>
            ) : null}
            {creatorApplicationStatus === 'rejected' ? (
              <>
                <p className="perfil-mangaka-apoio-label">
                  Sua última solicitação foi recusada. {creatorReviewReason ? `Motivo: ${creatorReviewReason}. ` : ''}
                  Ajuste os dados e envie de novo pela página de onboarding.
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
                    Cadastro de criador em andamento. Pode sair e voltar quando quiser — os dados ficam salvos na sua
                    conta até você enviar.
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
            <label>NOME DE EXIBIÇÃO</label>
            <input
              type="text"
              className="perfil-input"
              value={novoNome}
              onChange={(e) => setNovoNome(e.target.value)}
              maxLength={DISPLAY_NAME_MAX_LENGTH}
              placeholder="Ex.: como você quer ser chamado na plataforma"
            />
          </div>

          <div className="input-group" id="username-handle-reader">
            <label>USERNAME (@)</label>
            <p className="perfil-mangaka-apoio-label" style={{ marginBottom: 8 }}>
              Identificador único. Não pode ser alterado depois de salvo. Link:{' '}
              <strong>mangateofilo.com/@{normalizeUsernameInput(userHandleDraft) || 'seuuser'}</strong>
            </p>
            <input
              type="text"
              className="perfil-input"
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
            {lojaBuyerDisclosure}
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
            <>
            <div className="input-group notify-group">
              <label className="notify-label">
                <input
                  type="checkbox"
                  checked={readerProfilePublicDraft}
                  onChange={(e) => setReaderProfilePublicDraft(e.target.checked)}
                />
                Perfil de leitor visível publicamente
              </label>
              <p className="perfil-mangaka-apoio-label" style={{ marginTop: 8 }}>
                Outros usuários veem seu @username, avatar da loja abaixo e a lista de obras que você favoritou.
              </p>
              {readerProfilePublicDraft && user?.uid ? (
                <button
                  type="button"
                  className="perfil-mangaka-apoio-copy"
                  style={{ marginTop: 8 }}
                  onClick={() => navigate(`/criador/${encodeURIComponent(user.uid)}?tab=likes`)}
                >
                  Abrir meu perfil de leitor
                </button>
              ) : null}
            </div>
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
                  ? `Você pode usar todos os ${listaAvatares.length} avatares disponíveis.`
                  : `Disponíveis na sua conta: ${avataresLiberados.length} de ${listaAvatares.length}.`}
              </p>
            </div>
            </>
          ) : (
            <p className="perfil-mangaka-apoio-label" style={{ marginTop: 8 }}>
              Criadores usam arquivo ou URL acima; a grade da loja só aparece em Identidade pública, atrás do painel com
              cadeado, para não sobrescrever sua arte sem querer.
            </p>
          )}

          <div className="input-group notify-group">
            <label className="notify-label">
              <input
                type="checkbox"
                checked={notifyPromotions}
                onChange={(e) => setNotifyPromotions(e.target.checked)}
              />
              Receber promoções e campanhas por e-mail
            </label>
          </div>
          <div className="input-group notify-group">
            <label className="notify-label">
              <input
                type="checkbox"
                checked={notifyCommentSocial}
                onChange={(e) => setNotifyCommentSocial(e.target.checked)}
              />
              Avisos no app quando alguém curtir ou responder seus comentários em capítulos
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
