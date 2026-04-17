import React from 'react';

import { formatarPrecoBrl } from '../creatorPublicProfileUtils';

export default function CreatorSupportSection({
  supportEnabled,
  membershipEnabled,
  membershipPrice,
  donationSuggested,
  onSupport,
}) {
  if (!supportEnabled) return null;
  return (
    <section className="criador-section criador-section--support" aria-labelledby="criador-apoio-title">
      <div className="criador-section__head">
        <h2 id="criador-apoio-title">Apoie este escritor</h2>
      </div>
      <div className="criador-support-card">
        {membershipEnabled ? (
          <p>
          <strong>{formatarPrecoBrl(membershipPrice)}</strong> / 30 dias — membros ganham acesso antecipado aos
          capitulos deste autor nas obras vinculadas.
          </p>
        ) : (
          <p>
            Este autor ja pode receber apoio direto. A doacao sugerida agora e{' '}
            <strong>{formatarPrecoBrl(donationSuggested)}</strong>. A membership publica ainda nao foi ativada.
          </p>
        )}
        <ul className="criador-support-benefits">
          <li>Apoio direto ao trabalho autoral</li>
          {membershipEnabled ? <li>Lancamentos antecipados (quando o autor publicar com early access)</li> : null}
          {!membershipEnabled ? <li>Doacao livre vinculada a este perfil</li> : null}
        </ul>
        <button type="button" className="criador-support-cta" onClick={onSupport}>
          Apoie-me
        </button>
      </div>
    </section>
  );
}
