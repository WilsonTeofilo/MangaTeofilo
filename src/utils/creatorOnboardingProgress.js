import { obterObraIdCapitulo } from '../config/obras';

function toList(snapshotVal) {
  if (!snapshotVal || typeof snapshotVal !== 'object') return [];
  return Object.entries(snapshotVal).map(([id, data]) => ({ id, ...(data || {}) }));
}

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
  const obras = toList(obrasVal);
  const minhasObras = obras.filter((o) => String(o.creatorId || '').trim() === u);
  const obraIds = new Set(minhasObras.map((o) => String(o.id || '').toLowerCase()));

  const caps = toList(capsVal);
  const capsMeus = caps.filter((c) => {
    if (String(c.creatorId || '').trim() === u) return true;
    const oid = obterObraIdCapitulo(c);
    return obraIds.has(String(oid || '').toLowerCase());
  });

  const bio = String(perfilDb.creatorBio || '').trim();
  const ig = String(perfilDb.instagramUrl || '').trim();
  const yt = String(perfilDb.youtubeUrl || '').trim();
  const publicName = String(perfilDb.creatorDisplayName || perfilDb.userName || '').trim();
  const avatar = String(perfilDb.userAvatar || '').trim();
  const banner = String(perfilDb.creatorBannerUrl || '').trim();
  const hasBio = bio.length >= 24;
  const hasSocial = ig.length > 3 || yt.length > 3;
  const publicOk = publicName.length >= 3 && avatar.length > 3 && banner.length > 3 && hasBio && hasSocial;

  const price = Number(perfilDb.creatorMembershipPriceBRL);
  const donation = Number(perfilDb.creatorDonationSuggestedBRL);
  const membershipEnabled = perfilDb.creatorMembershipEnabled !== false;
  const monetizationPreference = String(perfilDb.creatorMonetizationPreference || 'publish_only')
    .trim()
    .toLowerCase();
  const monetizationStatus = String(perfilDb.creatorMonetizationStatus || '').trim().toLowerCase();
  const monetizationConfigured =
    Number.isFinite(price) &&
    price >= 1 &&
    Number.isFinite(donation) &&
    donation >= 1 &&
    membershipEnabled;
  const monetOk = monetizationPreference !== 'monetize'
    ? true
    : (
      monetizationStatus === 'blocked_underage' ||
      (monetizationConfigured && (monetizationStatus === 'pending_review' || monetizationStatus === 'active'))
    );

  const produtos = toList(produtosVal);
  const meusProdutos = produtos.filter((prod) => String(prod.creatorId || '').trim() === u);
  const lojaOk = meusProdutos.length > 0 || storeSkipped;

  return [
    {
      id: 'publicProfile',
      label: 'Perfil publico',
      hint: 'Nome publico, avatar, banner, bio (24+ caracteres) e pelo menos uma rede social.',
      done: publicOk,
      action: 'form',
    },
    {
      id: 'firstObra',
      label: 'Primeira obra',
      hint: 'Cadastre uma obra com voce como criador.',
      done: minhasObras.length > 0,
      path: '/creator/obras',
    },
    {
      id: 'firstChapter',
      label: 'Primeiro capitulo',
      hint: 'Publique ao menos um capitulo vinculado a sua obra.',
      done: capsMeus.length > 0,
      path: '/creator/capitulos',
    },
    {
      id: 'monetization',
      label: 'Apoio e membership',
      hint: monetizationPreference !== 'monetize'
        ? 'Publicacao sem monetizacao escolhida. Esta etapa ja esta concluida.'
        : monetizationStatus === 'blocked_underage'
          ? 'Monetizacao bloqueada por idade. A conta pode publicar normalmente, sem receber.'
          : monetizationConfigured
            ? 'Configuracao enviada. Sua membership do criador esta pronta para validacao/liberacao.'
            : 'Ative a membership do criador e defina valores de membership e doacao sugerida.',
      done: monetOk,
      action: 'form',
    },
    {
      id: 'store',
      label: 'Loja (opcional)',
      hint: 'Crie um produto seu na loja ou marque como nao aplicavel.',
      done: lojaOk,
      path: '/creator/loja',
      optional: true,
    },
  ];
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
  if (!firstPending) return '/creator/dashboard';
  if (firstPending.path) return firstPending.path;
  return '/perfil?onboarding=creator';
}
