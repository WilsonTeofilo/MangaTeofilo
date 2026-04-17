import { useEffect, useMemo, useState } from 'react';
import { onValue, ref } from 'firebase/database';

import { db } from '../../../services/firebase';
import {
  creatorMembershipAtiva,
  assinaturaPremiumAtiva,
  listarMembershipsDeCriadorAtivas,
  obterEntitlementCriador,
  obterEntitlementPremiumGlobal,
} from '../../../utils/capituloLancamento';
import { getAttribution } from '../../../utils/trafficAttribution';
import { formatarDataLongaBr } from '../../../utils/datasBr';
import { resolveEffectiveCreatorMonetizationStatusFromDb } from '../../../utils/creatorMonetizationUi';
import {
  buildPublicProfileFromUsuarioRow,
  resolvePublicProfileDisplayName,
} from '../../../utils/publicUserProfile';
import {
  sanitizeCreatorId,
  textoCountdownPromoSegundos,
} from '../apoieUtils';

export default function useApoieEntitlementsAndAttribution({
  perfil,
  searchParams,
  ofertaPremium,
  setValorLivre,
}) {
  const [creatorOffer, setCreatorOffer] = useState(null);

  const premiumAtivo = assinaturaPremiumAtiva(perfil);
  const premiumEntitlement = obterEntitlementPremiumGlobal(perfil);
  const attributionPersistida = useMemo(() => getAttribution(), []);
  const attributionCreatorIdParaCheckout = useMemo(() => {
    const fromUrl = sanitizeCreatorId(searchParams.get('creatorId') || searchParams.get('criador'));
    if (fromUrl) return fromUrl;
    const fromCache = sanitizeCreatorId(attributionPersistida?.creatorId);
    return fromCache || null;
  }, [attributionPersistida, searchParams]);
  const creatorIdNaSessao = attributionCreatorIdParaCheckout || '';
  const membershipCriadorAtiva =
    creatorIdNaSessao && perfil
      ? creatorMembershipAtiva(perfil, creatorIdNaSessao)
      : false;
  const membershipAtualDoCriador = creatorIdNaSessao
    ? obterEntitlementCriador(perfil, creatorIdNaSessao)
    : null;
  const membershipsAtivas = useMemo(() => listarMembershipsDeCriadorAtivas(perfil), [perfil]);
  const fimPremium = formatarDataLongaBr(premiumEntitlement.memberUntil);
  const precoBase = Number.isFinite(ofertaPremium.basePriceBRL) ? ofertaPremium.basePriceBRL : null;
  const precoAtual = Number.isFinite(ofertaPremium.currentPriceBRL) ? ofertaPremium.currentPriceBRL : null;
  const precoSeguro =
    Number.isFinite(precoAtual) && precoAtual > 0
      ? precoAtual
      : Number.isFinite(precoBase) && precoBase > 0
        ? precoBase
        : 23;
  const promoStartsAt = Number(ofertaPremium?.promo?.startsAt || 0);
  const promoEndsAt = Number(ofertaPremium?.promo?.endsAt || 0);
  const promoProgramada = ofertaPremium.promoStatus === 'scheduled' && promoStartsAt > ofertaPremium.now;
  const segundosAteInicio = promoProgramada
    ? Math.floor((promoStartsAt - ofertaPremium.now) / 1000)
    : 0;
  const segundosRestantes =
    ofertaPremium.isPromoActive && promoEndsAt > ofertaPremium.now
      ? Math.floor((promoEndsAt - ofertaPremium.now) / 1000)
      : 0;
  const textoAteInicioPromo = textoCountdownPromoSegundos(segundosAteInicio);
  const textoTerminaPromo = textoCountdownPromoSegundos(segundosRestantes);

  useEffect(() => {
    if (!attributionCreatorIdParaCheckout) return () => {};
    const unsub = onValue(ref(db, `usuarios/${attributionCreatorIdParaCheckout}/publicProfile`), (snapshot) => {
      const row = snapshot.exists()
        ? buildPublicProfileFromUsuarioRow(snapshot.val() || {}, attributionCreatorIdParaCheckout)
        : {};
      const monetizationStatus = resolveEffectiveCreatorMonetizationStatusFromDb(row);
      if (monetizationStatus !== 'active') {
        setCreatorOffer(null);
        return;
      }
      setCreatorOffer({
        creatorId: attributionCreatorIdParaCheckout,
        creatorName: resolvePublicProfileDisplayName(row, 'Criador'),
        creatorSupportOffer:
          row?.creatorProfile?.monetization?.supportOffer &&
          typeof row.creatorProfile.monetization.supportOffer === 'object'
            ? row.creatorProfile.monetization.supportOffer
            : {},
      });
    });
    return () => unsub();
  }, [attributionCreatorIdParaCheckout]);

  useEffect(() => {
    if (!creatorOffer?.creatorSupportOffer?.donationSuggestedBRL) return;
    setValorLivre((prev) =>
      String(prev || '').trim() ? prev : String(creatorOffer.creatorSupportOffer.donationSuggestedBRL)
    );
  }, [creatorOffer?.creatorSupportOffer?.donationSuggestedBRL, setValorLivre]);

  const creatorOfferAtivo = attributionCreatorIdParaCheckout ? creatorOffer : null;

  return {
    premiumAtivo,
    premiumEntitlement,
    attributionPersistida,
    attributionCreatorIdParaCheckout,
    creatorIdNaSessao,
    membershipCriadorAtiva,
    membershipAtualDoCriador,
    membershipsAtivas,
    fimPremium,
    precoBase,
    precoAtual,
    precoSeguro,
    promoProgramada,
    textoAteInicioPromo,
    textoTerminaPromo,
    creatorOffer: creatorOfferAtivo,
  };
}
