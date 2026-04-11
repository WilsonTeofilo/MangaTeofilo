import React from 'react';

import { formatarPrecoBrl } from '../creatorPublicProfileUtils';

export default function CreatorSupportSection({ membershipEnabled, membershipPrice, onSupport }) {
  if (!membershipEnabled) return null;
  return (
    <section className="criador-section criador-section--support" aria-labelledby="criador-apoio-title">
      <div className="criador-section__head">
        <h2 id="criador-apoio-title">Apoie este escritor</h2>
      </div>
      <div className="criador-support-card">
        <p>
          <strong>{formatarPrecoBrl(membershipPrice)}</strong> / 30 dias — membros ganham acesso antecipado aos
          capitulos deste autor nas obras vinculadas.
        </p>
        <ul className="criador-support-benefits">
          <li>Lancamentos antecipados (quando o autor publicar com early access)</li>
          <li>Apoio direto ao trabalho autoral</li>
        </ul>
        <button type="button" className="criador-support-cta" onClick={onSupport}>
          Apoie-me
        </button>
      </div>
    </section>
  );
}
