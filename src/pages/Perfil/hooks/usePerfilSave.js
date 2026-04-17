import { updateProfile } from 'firebase/auth';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { get, ref, remove, set, update } from 'firebase/database';

import { AVATAR_FALLBACK, CREATOR_BIO_MAX_LENGTH, CREATOR_BIO_MIN_LENGTH_PUBLISH_ONLY } from '../../../constants';
import { processCreatorProfileImageToWebp } from '../../../utils/creatorProfileImage';
import { normalizarAcessoAvatar } from '../../../utils/avatarAccess';
import { formatBirthDateIsoToBr, parseBirthDateFlexible, parseBirthDateLocal } from '../../../utils/birthDateAge';
import { buildCreatorRecordForProfileSave } from '../../../utils/creatorRecord';
import { resolveStoragePathFromPathOrUrl, safeDeleteStorageObject } from '../../../utils/storageCleanup';
import { sanitizeBuyerProfileForSave } from '../../../utils/storeBuyerProfile';
import { refreshAuthUser } from '../../../userProfileSyncV2';
import { validateCreatorSocialLinks } from '../../../utils/creatorSocialLinks';
import { normalizeUsernameInput, validateUsernameHandle } from '../../../utils/usernameValidation';
import { buildUsuarioPublicProfileRecord } from '../../../config/userProfileSchema';
import { isTrustedPlatformAssetUrl } from '../../../utils/trustedAssetUrls';

function isCreatorProfileStorageAssetForUser(uid, pathOrUrl) {
  const path = resolveStoragePathFromPathOrUrl(pathOrUrl);
  if (!path) return false;
  return path.startsWith(`creator_profile/${uid}/`);
}

export function usePerfilSave({
  adminAccess,
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
  youtubeUrl,
  usernameCheck,
}) {
  const handleSalvar = async (e) => {
    e.preventDefault();

    const isStaffAdmin = adminAccess.canAccessAdmin === true && adminAccess.isMangaka !== true;
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
      const previewValidation = validateUsernameHandle(wantHandlePreview);
      if (!previewValidation.ok) {
        setMensagem({ texto: previewValidation.message, tipo: 'erro' });
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
      if (bioLen < CREATOR_BIO_MIN_LENGTH_PUBLISH_ONLY || bioLen > CREATOR_BIO_MAX_LENGTH) {
        setMensagem({
          texto: `A bio do criador deve ter entre ${CREATOR_BIO_MIN_LENGTH_PUBLISH_ONLY} e ${CREATOR_BIO_MAX_LENGTH} caracteres.`,
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
        } catch (avatarError) {
          setMensagem({ texto: avatarError?.message || 'Nao foi possivel processar a foto.', tipo: 'erro' });
          setLoading(false);
          return;
        }
      } else if (adminAccess.isMangaka && String(mangakaAvatarUrlDraft || '').trim()) {
        const avatarUrl = String(mangakaAvatarUrlDraft || '').trim();
        if (!isTrustedPlatformAssetUrl(avatarUrl, { allowLocalAssets: true }) || avatarUrl.length > 2048) {
          setMensagem({
            texto: 'Escolha uma foto enviada por aqui ou um avatar da plataforma.',
            tipo: 'erro',
          });
          setLoading(false);
          return;
        }
        finalAvatar = avatarUrl;
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
              isTrustedPlatformAssetUrl(persistedAvatar, { allowLocalAssets: true })
                ? persistedAvatar
                : isTrustedPlatformAssetUrl(authAvatar, { allowLocalAssets: true })
                  ? authAvatar
                  : '';
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
        const handleValidation = validateUsernameHandle(wantHandle);
        if (!handleValidation.ok) {
          setMensagem({ texto: handleValidation.message, tipo: 'erro' });
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
      const preservedCreatorBannerUrl = String(
        perfilDb?.creatorBannerUrl ||
          perfilDb?.publicProfile?.creatorBannerUrl ||
          perfilDb?.publicProfile?.creatorProfile?.bannerUrl ||
          perfilDb?.creator?.profile?.bannerUrl ||
          ''
      ).trim();

      await updateProfile(user, {
        displayName: accountDisplayName,
        photoURL: finalAvatar,
      });
      try {
        await refreshAuthUser(user);
      } catch (authReloadError) {
        console.warn('[Perfil] reload auth apos salvar:', authReloadError);
      }

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
        [`usuarios/${user.uid}/creatorBannerUrl`]: preservedCreatorBannerUrl || null,
        [`usuarios/${user.uid}/lastLogin`]: nowTs,
      };
      if (persistedHandle) privatePatch[`usuarios/${user.uid}/userHandle`] = persistedHandle;
      if (adminAccess.isMangaka) privatePatch[`usuarios/${user.uid}/signupIntent`] = 'creator';
      if (creatorCanonicalDoc) {
        privatePatch[`usuarios/${user.uid}/creator/profile/displayName`] = creatorCanonicalDoc.profile.displayName || null;
        privatePatch[`usuarios/${user.uid}/creator/profile/bio`] = creatorCanonicalDoc.profile.bio || null;
        privatePatch[`usuarios/${user.uid}/creator/profile/birthDate`] = creatorCanonicalDoc.profile.birthDate || null;
        privatePatch[`usuarios/${user.uid}/creator/social/instagram`] = creatorCanonicalDoc.social.instagram || null;
        privatePatch[`usuarios/${user.uid}/creator/social/youtube`] = creatorCanonicalDoc.social.youtube || null;
      }
      await update(ref(db), privatePatch);

      const nextPerfilDb = {
        ...(perfilDb || {}),
        uid: user.uid,
        userName: accountDisplayName,
        userAvatar: finalAvatar,
        userHandle: persistedHandle || perfilDb?.userHandle || '',
        creatorApplicationStatus: perfilDb?.creatorApplicationStatus ?? '',
        creatorStatus: perfilDb?.creatorStatus ?? '',
        creatorDisplayName: creatorPublicName,
        creatorBio: String(creatorBio || '').trim(),
        creatorBannerUrl: preservedCreatorBannerUrl,
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
      const creatorProfilePublic = publicProfileRecord.isCreatorProfile === true
        ? publicProfileRecord.creatorProfile || {}
        : {};
      const publicProfilePatch = {
        [`usuarios/${user.uid}/publicProfile/uid`]: publicProfileRecord.uid || user.uid,
        [`usuarios/${user.uid}/publicProfile/userName`]: publicProfileRecord.userName || accountDisplayName,
        [`usuarios/${user.uid}/publicProfile/userHandle`]: publicProfileRecord.userHandle || null,
        [`usuarios/${user.uid}/publicProfile/userAvatar`]: publicProfileRecord.userAvatar || finalAvatar,
        [`usuarios/${user.uid}/publicProfile/isCreatorProfile`]: publicProfileRecord.isCreatorProfile === true,
        [`usuarios/${user.uid}/publicProfile/status`]: publicProfileRecord.status || '',
        [`usuarios/${user.uid}/publicProfile/creatorApplicationStatus`]:
          publicProfileRecord.creatorApplicationStatus || null,
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
        [`usuarios/${user.uid}/publicProfile/creatorStatus`]: publicProfileRecord.creatorStatus || null,
        [`usuarios/${user.uid}/publicProfile/updatedAt`]: publicProfileRecord.updatedAt || nowTs,
        [`usuarios/${user.uid}/publicProfile/creatorProfile/displayName`]:
          publicProfileRecord.isCreatorProfile === true ? creatorProfilePublic.displayName || null : null,
        [`usuarios/${user.uid}/publicProfile/creatorProfile/username`]:
          publicProfileRecord.isCreatorProfile === true ? creatorProfilePublic.username || null : null,
        [`usuarios/${user.uid}/publicProfile/creatorProfile/avatarUrl`]:
          publicProfileRecord.isCreatorProfile === true ? creatorProfilePublic.avatarUrl || finalAvatar : null,
        [`usuarios/${user.uid}/publicProfile/creatorProfile/bannerUrl`]:
          publicProfileRecord.isCreatorProfile === true ? creatorProfilePublic.bannerUrl || null : null,
        [`usuarios/${user.uid}/publicProfile/creatorProfile/bioFull`]:
          publicProfileRecord.isCreatorProfile === true ? creatorProfilePublic.bioFull || null : null,
        [`usuarios/${user.uid}/publicProfile/creatorProfile/socialLinks/instagramUrl`]:
          publicProfileRecord.isCreatorProfile === true ? creatorProfilePublic.socialLinks?.instagramUrl || null : null,
        [`usuarios/${user.uid}/publicProfile/creatorProfile/socialLinks/youtubeUrl`]:
          publicProfileRecord.isCreatorProfile === true ? creatorProfilePublic.socialLinks?.youtubeUrl || null : null,
      };
      await update(ref(db), publicProfilePatch);

      if (previousCreatorProfileAvatar && previousCreatorProfileAvatar !== String(finalAvatar || '').trim()) {
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
      if (listaAvatares.some((item) => item.url === finalAvatar)) {
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
        } catch {
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

  return {
    handleSalvar,
    handleCopyCreatorSupportLink,
  };
}
