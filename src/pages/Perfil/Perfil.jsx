// src/pages/Perfil/Perfil.jsx
import React, { useState, useEffect, useRef } from 'react';
import { updateProfile } from 'firebase/auth';
import { ref, update, get, onValue } from 'firebase/database';
import { httpsCallable } from 'firebase/functions';
import { useNavigate } from 'react-router-dom';

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
import './Perfil.css';

const creatorSubmitApplication = httpsCallable(functions, 'creatorSubmitApplication');

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
  const [creatorApplicationLoading, setCreatorApplicationLoading] = useState(false);
  const [creatorApplyModalOpen, setCreatorApplyModalOpen] = useState(false);
  const mangakaFormAnchorRef = useRef(null);
  const mangakaAvatarPreserveRef = useRef(false);
  /** Evita mandar o usuario de volta a /creators a cada salvamento enquanto candidatura ainda esta em draft. */
  const perfilCreatorsHandoffKeyRef = useRef('');
  useEffect(() => {
    mangakaAvatarPreserveRef.current = adminAccess.isMangaka === true;
  }, [adminAccess.isMangaka]);

  useEffect(() => {
    perfilCreatorsHandoffKeyRef.current =
      user?.uid ? `shito_perfilCreatorsHandoffDone:${user.uid}` : '';
  }, [user?.uid]);

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
  const creatorStatusLabel =
    creatorMonetizationStatus === 'active'
      ? 'Monetizacao ativa'
      : creatorMonetizationStatus === 'pending_review'
        ? 'Monetizacao em revisao'
        : creatorMonetizationStatus === 'blocked_underage'
          ? 'Monetizacao bloqueada por idade'
          : 'Modo apenas publicar';
  const linkApoioCopiado = false;
  const setLinkApoioCopiado = () => {};
  const currentOnboardingStep = null;
  const creatorOnboardingChecklistHidden = true;
  const onboardingRequiredDone = 0;
  const onboardingRequiredAll = 0;
  const onboardingAllRequiredComplete = false;
  const onboardingSteps = [];
  const onboardingUiBusy = false;
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
      if (bioLen < CREATOR_BIO_MIN_LENGTH || bioLen > CREATOR_BIO_MAX_LENGTH) {
        setMensagem({
          texto: `A bio do criador deve ter entre ${CREATOR_BIO_MIN_LENGTH} e ${CREATOR_BIO_MAX_LENGTH} caracteres.`,
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
      const creatorMonetizationStatusNext = !adminAccess.isMangaka
        ? null
        : creatorMonetizationPreference !== 'monetize'
          ? 'disabled'
          : ageForMonet != null && ageForMonet < 18
            ? 'blocked_underage'
            : creatorMonetizationStatus === 'active'
              ? 'active'
              : 'pending_review';

      const creatorCanonicalDoc = adminAccess.isMangaka
        ? buildCreatorRecordForProfileSave({
            perfilDb,
            birthDateIso: birthIsoForSave && parseBirthDateLocal(birthIsoForSave) ? birthIsoForSave : '',
            displayName: creatorPublicName,
            bio: String(creatorBio || '').trim(),
            instagramUrl,
            youtubeUrl,
            monetizationPreference: creatorMonetizationPreference,
            monetizationStatus: creatorMonetizationStatusNext,
            now: Date.now(),
          })
        : null;

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
        creatorMonetizationPreference: creatorMonetizationPreference,
        creatorMonetizationStatus: creatorMonetizationStatusNext,
        creatorBio: String(creatorBio || '').trim(),
        creatorBannerUrl: null,
        instagramUrl: String(instagramUrl || '').trim(),
        youtubeUrl: String(youtubeUrl || '').trim(),
        creatorMembershipEnabled: adminAccess.isMangaka && creatorMonetizationPreference === 'monetize' ? creatorMembershipEnabled : false,
        creatorMembershipPriceBRL: adminAccess.isMangaka && creatorMonetizationPreference === 'monetize' ? Math.round(membershipPrice * 100) / 100 : null,
        creatorDonationSuggestedBRL: adminAccess.isMangaka && creatorMonetizationPreference === 'monetize' ? Math.round(suggestedDonation * 100) / 100 : null,
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
          monetizationPreference: creatorMonetizationPreference,
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
      if (listaAvatares.some((i) => i.url === finalAvatar)) {
        setMangakaAvatarUrlDraft('');
      } else if (adminAccess.isMangaka && /^https:\/\//i.test(finalAvatar)) {
        setMangakaAvatarUrlDraft(finalAvatar);
      }

      const savedBirth = birthIsoForSave && parseBirthDateLocal(birthIsoForSave) ? birthIsoForSave : '';
      setBirthDate(savedBirth);
      setBirthDateDraft(savedBirth ? formatBirthDateIsoToBr(savedBirth) : '');

      setMensagem({ texto: 'Perfil atualizado com sucesso!', tipo: 'sucesso' });
      const handoffKey = perfilCreatorsHandoffKeyRef.current;
      const shouldHandoffToCreators =
        !adminAccess.isMangaka &&
        creatorModerationAction !== 'banned' &&
        handoffKey &&
        typeof sessionStorage !== 'undefined' &&
        !sessionStorage.getItem(handoffKey) &&
        creatorSignupIntent === 'creator' &&
        creatorApplicationStatus === 'draft';
      if (shouldHandoffToCreators) {
        sessionStorage.setItem(handoffKey, '1');
        setTimeout(() => navigate('/creators', { replace: true }), 900);
      } else {
        setTimeout(() => navigate(adminAccess.isMangaka ? '/perfil' : '/'), 1200);
      }

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
      const { data } = await submitCreatorApplicationPayload({
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
      if (data?.alreadyMangaka) {
        setMensagem({ texto: 'Sua conta ja esta aprovada como criador.', tipo: 'sucesso' });
      } else if (data?.alreadyPending) {
        setMensagem({ texto: 'Sua solicitacao de criador ja esta em analise.', tipo: 'sucesso' });
      } else {
        setMensagem({ texto: 'Solicitacao enviada. A equipe vai revisar seu acesso de criador.', tipo: 'sucesso' });
      }
    } catch (err) {
      const msg = err?.message || 'Nao foi possivel enviar sua solicitacao agora.';
      setMensagem({ texto: msg, tipo: 'erro' });
      throw new Error(msg);
    } finally {
      setCreatorApplicationLoading(false);
    }
  };

  const scrollToMangakaFields = () => {
    mangakaFormAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

  const handleOcultarOnboardingChecklist = () => {};
  const handleMostrarOnboardingChecklist = () => {};
  const handlePularLojaOnboarding = () => {};

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
                  <button type="button" className="perfil-mangaka-apoio-copy" onClick={handleCopyCreatorSupportLink}>
                    Copiar link de apoio
                  </button>
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
                    onClick={() => setCreatorMonetizationPreference('monetize')}
                    disabled={isUnderageByBirthYear}
                  >
                    Monetizar
                  </button>
                </div>
              </div>

              {creatorMonetizationPreference === 'monetize' ? (
                <>
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
        </div>
      </main>
    );
  }

  return (
    <main className="perfil-page">
      <div className="perfil-card">
        <h1 className="perfil-title">{adminAccess.isMangaka ? 'Meu perfil de criador' : 'Meu perfil'}</h1>
        <p className="perfil-subtitle">
          {adminAccess.isMangaka ? 'Sua vitrine publica com edicao limpa e direta.' : 'Atualize seus dados e preferencias da conta.'}
        </p>

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
                ? isUnderageByBirthYear
                  ? ' - voce pode publicar, mas nao pode receber por ser menor de idade.'
                  : ' - bloqueio anterior; com 18+ na data do perfil, use Monetizar e salve para revisao.'
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
          }}
          onSubmit={handleCreatorApplicationModalSubmit}
        />

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
                      disabled={isUnderageByBirthYear}
                    >
                      Monetizar
                    </button>
                  </div>
                  <p className="perfil-mangaka-apoio-label">
                    {isUnderageByBirthYear
                      ? 'Monetizacao so para maiores de 18 (conforme a data de nascimento acima).'
                      : creatorMonetizationStatus === 'blocked_underage'
                        ? 'Status anterior era bloqueio por idade. Com 18+ na data acima, escolha Monetizar e salve para solicitar revisao.'
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
                <label>FOTO DE PERFIL (CRIADOR)</label>
                <p className="perfil-mangaka-apoio-label" style={{ marginBottom: 8 }}>
                  O banner publico e gerado automaticamente com desfoque desta imagem. Envie arquivo (WebP otimizado) ou
                  cole URL HTTPS.
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
