import { ref, update } from 'firebase/database';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';

import { db, storage } from '../services/firebase';
import {
  processCreatorProfileImageToWebp,
  serializeCreatorProfileCrop,
} from './creatorProfileImage';

/**
 * Envia candidatura a criador (sem banner: o hero público usa a foto de perfil).
 * Garante `usuarios/{uid}/birthDate` no RTDB com a data do formulário (perfil às vezes estava vazio).
 * @param {object} params
 * @param {ReturnType<typeof httpsCallable>} params.creatorSubmitApplication
 * @param {object} params.payload - campos do CreatorApplicationModal onSubmit (sem banner)
 * @param {string} [params.uid] - auth uid (obrigatório para espelhar nascimento no perfil)
 */
export async function submitCreatorApplicationPayload({ creatorSubmitApplication, payload, uid }) {
  const callablePayload = {
    displayName: payload.displayName,
    bioShort: payload.bioShort,
    birthDate: payload.birthDate,
    instagramUrl: payload.instagramUrl,
    youtubeUrl: payload.youtubeUrl,
    monetizationPreference: payload.monetizationPreference,
    acceptTerms: payload.acceptTerms,
    legalFullName: payload.legalFullName,
    taxId: payload.taxId,
    payoutInstructions: payload.payoutInstructions,
    payoutPixType: payload.payoutPixType,
    acceptFinancialTerms: payload.acceptFinancialTerms,
  };

  if (payload?.creatorProfileImageFile && uid) {
    const blob = await processCreatorProfileImageToWebp(
      payload.creatorProfileImageFile,
      payload.creatorProfileImageAdjustment
    );
    const path = `creator_profile/${uid}/creator_application_${Date.now()}.webp`;
    const fileRef = storageRef(storage, path);
    await uploadBytes(fileRef, blob, {
      contentType: 'image/webp',
      cacheControl: 'public,max-age=31536000,immutable',
    });
    callablePayload.profileImageUrl = await getDownloadURL(fileRef);
    callablePayload.profileImageCrop = serializeCreatorProfileCrop(
      payload.creatorProfileImageAdjustment
    );
  } else {
    const pass = String(payload.profileImageUrl || '').trim();
    if (/^https:\/\//i.test(pass) && pass.length >= 12 && pass.length <= 2048) {
      callablePayload.profileImageUrl = pass;
    }
    if (payload.profileImageCrop && typeof payload.profileImageCrop === 'object') {
      callablePayload.profileImageCrop = {
        zoom: Number(payload.profileImageCrop.zoom || 1),
        x: Number(payload.profileImageCrop.x || 0),
        y: Number(payload.profileImageCrop.y || 0),
        mode: 'responsive-fit',
      };
    }
  }

  const { data } = await creatorSubmitApplication(callablePayload);

  const iso = String(payload?.birthDate || '').trim();
  if (uid && /^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const y = parseInt(iso.slice(0, 4), 10);
    try {
      await update(ref(db, `usuarios/${uid}`), {
        birthDate: iso,
        birthYear: Number.isFinite(y) && y >= 1900 ? y : null,
      });
    } catch (e) {
      console.warn('[creatorApplication] Não foi possível sincronizar birthDate no perfil:', e);
    }
  }

  const profileImageUrl =
    String(callablePayload.profileImageUrl || data?.application?.profileImageUrl || '').trim() || '';

  return { data, profileImageUrl };
}
