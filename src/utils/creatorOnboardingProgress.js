import { obterObraIdCapitulo } from '../config/obras';
import {
  resolveCreatorMonetizationPreferenceFromDb,
  resolveCreatorMonetizationStatusFromDb,
} from './creatorMonetizationUi';
import {
  CREATOR_BIO_MIN_LENGTH,
  CREATOR_BIO_MIN_LENGTH_PUBLISH_ONLY,
  CREATOR_MEMBERSHIP_PRICE_MAX_BRL,
  CREATOR_MEMBERSHIP_PRICE_MIN_BRL,
} from '../constants';
import { resolveCreatorMonetizationFlags } from './creatorMonetizationUi';
import { validateCreatorSocialLinks } from './creatorSocialLinks';
import { toRecordList } from './firebaseRecordList';

/**
 * Passos do onboarding do criador. "loja" e opcional.
 */
export function buildCreatorOnboardingSteps({
  uid,
  perfilDb = {},
  obrasVal = null,
  capsVal = null,
  produtosVal = null,
  storeSkipped = false,
}) {
  const u = String(uid || '').trim();
  const obras = toRecordList(obrasVal);
  const minhasObras = obras.filter((o) => String(o.creatorId || '').trim() === u);
  const obraIds = new Set(minhasObras.map((o) => String(o.id || '').toLowerCase()));

  const caps = toRecordList(capsVal);
  const capsMeus = caps.filter((c) => {
    if (String(c.creatorId || '').trim() === u) return true;
    const oid = obterObraIdCapitulo(c);
    return obraIds.has(String(oid || '').toLowerCase());
  });

  const creatorProfile =
    perfilDb?.creator?.profile && typeof perfilDb.creator.profile === 'object'
      ? perfilDb.creator.profile
      : {};
  const creatorSocial =
    perfilDb?.creator?.social && typeof perfilDb.creator.social === 'object'
      ? perfilDb.creator.social
      : {};
  const bio = String(creatorProfile.bio || '').trim();
  const ig = String(creatorSocial.instagram || '').trim();
  const yt = String(creatorSocial.youtube || '').trim();
  const publicName = String(creatorProfile.displayName || perfilDb.userName || '').trim();
  const avatar = String(perfilDb.userAvatar || '').trim();
  const monetizationPreference = resolveCreatorMonetizationPreferenceFromDb(perfilDb);
  const bioMin =
    monetizationPreference === 'monetize' ? CREATOR_BIO_MIN_LENGTH : CREATOR_BIO_MIN_LENGTH_PUBLISH_ONLY;
  const hasBio = bio.length >= bioMin;
  const socialValidation = validateCreatorSocialLinks({
    instagramUrl: ig,
    youtubeUrl: yt,
    requireOne: false,
  });
  const hasSocial = Boolean(socialValidation.instagramUrl || socialValidation.youtubeUrl);
  const publicOk = publicName.length >= 3 && avatar.length > 3 && hasBio && hasSocial;

  const price = Number(perfilDb.creatorMembershipPriceBRL);
  const donation = Number(perfilDb.creatorDonationSuggestedBRL);
  const membershipEnabled = perfilDb.creatorMembershipEnabled !== false;
  const monetizationStatus = resolveCreatorMonetizationStatusFromDb(perfilDb);
  const monetizationFlags = resolveCreatorMonetizationFlags(perfilDb);
  const monetizationActive = monetizationStatus === 'active';
  const monetizationConfigured =
    Number.isFinite(price) &&
    price >= CREATOR_MEMBERSHIP_PRICE_MIN_BRL &&
    price <= CREATOR_MEMBERSHIP_PRICE_MAX_BRL &&
    Number.isFinite(donation) &&
    donation >= CREATOR_MEMBERSHIP_PRICE_MIN_BRL &&
    donation <= CREATOR_MEMBERSHIP_PRICE_MAX_BRL &&
    membershipEnabled;
  const monetOk = monetizationPreference !== 'monetize'
    ? true
    : (
      monetizationStatus === 'blocked_underage' ||
      (monetizationConfigured && (monetizationStatus === 'active' || monetizationFlags.isApproved === true))
    );

  const produtos = toRecordList(produtosVal);
  const meusProdutos = produtos.filter((prod) => String(prod.creatorId || '').trim() === u);
  const lojaOk = meusProdutos.length > 0 || storeSkipped;

  const steps = [
    {
      id: 'publicProfile',
      label: 'Perfil público',
      hint:
        monetizationPreference === 'monetize'
          ? `Nome público, foto, bio com pelo menos ${CREATOR_BIO_MIN_LENGTH} caracteres e pelo menos uma rede social válida.`
          : `Nome público, foto, bio com pelo menos ${CREATOR_BIO_MIN_LENGTH_PUBLISH_ONLY} caracteres e pelo menos uma rede social válida.`,
      done: publicOk,
      action: 'form',
    },
    {
      id: 'firstObra',
      label: 'Primeira obra',
      hint: 'Cadastre uma obra com você como criador.',
      done: minhasObras.length > 0,
      path: '/creator/obras',
    },
    {
      id: 'firstChapter',
      label: 'Primeiro capítulo',
      hint: 'Publique ao menos um capítulo vinculado à sua obra.',
      done: capsMeus.length > 0,
      path: '/creator/capitulos',
    },
    {
      id: 'monetization',
      label: 'Apoio e membership',
      hint: monetizationPreference !== 'monetize'
        ? 'Você escolheu publicar sem monetização por aqui — esta etapa já vale como concluída.'
        : monetizationStatus === 'blocked_underage'
          ? 'Monetização indisponível por idade. Você segue publicando normalmente, sem repasse financeiro.'
          : monetizationConfigured
            ? 'Tudo pronto. Sua membership pode ser ligada assim que a monetização estiver liberada na conta.'
            : `Ative a membership do criador e escolha valores entre R$ ${CREATOR_MEMBERSHIP_PRICE_MIN_BRL} e R$ ${CREATOR_MEMBERSHIP_PRICE_MAX_BRL}.`,
      done: monetOk,
      action: 'form',
    },
    {
      id: 'store',
      label: 'Loja (opcional)',
      hint: 'Crie um produto seu na loja ou marque como não aplicável.',
      done: lojaOk,
      path: '/creator/loja',
      optional: true,
    },
  ];

  return monetizationActive ? steps : steps.filter((step) => step.id !== 'store');
}

export function onboardingRequiredDoneCount(steps) {
  const required = steps.filter((s) => !s.optional);
  return required.filter((s) => s.done).length;
}

export function onboardingRequiredTotal(steps) {
  return steps.filter((s) => !s.optional).length;
}

export function creatorOnboardingIsRequiredComplete(steps) {
  return onboardingRequiredDoneCount(steps) >= onboardingRequiredTotal(steps);
}

export function creatorOnboardingPrimaryNextPath(steps) {
  const firstPending = steps.find((step) => !step.optional && !step.done);
  if (!firstPending) return '/perfil';
  if (firstPending.path) return firstPending.path;
  return '/perfil?onboarding=creator';
}
