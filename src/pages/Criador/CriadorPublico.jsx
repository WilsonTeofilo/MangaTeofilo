import React, { useEffect, useMemo, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { useNavigate, useParams } from 'react-router-dom';

import { CREATOR_BIO_MIN_LENGTH } from '../../constants';
import { db } from '../../services/firebase';
import { apoiePathParaCriador } from '../../utils/creatorSupportPaths';
import { creatorPublicHeroImageUrl } from '../../utils/creatorPublicHero';
import { ensureLegacyShitoObra, obraCreatorId, obraSegmentoUrlPublica } from '../../config/obras';
import { obraVisivelNoCatalogoPublico } from '../../utils/obraCatalogo';
import './CriadorPublico.css';

function toList(data) {
  if (!data || typeof data !== 'object') return [];
  return Object.entries(data).map(([id, value]) => ({ id, ...(value || {}) }));
}

function normalizarRede(url) {
  const valor = String(url || '').trim();
  if (!valor) return '';
  if (/^https?:\/\//i.test(valor)) return valor;
  return `https://${valor}`;
}

function pathObra(obra) {
  return `/work/${encodeURIComponent(obraSegmentoUrlPublica(obra))}`;
}

function formatarPrecoBrl(valor) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return 'R$ 0,00';
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(n);
}

export default function CriadorPublico() {
  const { creatorId } = useParams();
  const navigate = useNavigate();
  const [perfilPublico, setPerfilPublico] = useState(null);
  const [obras, setObras] = useState([]);
  const creatorUid = String(creatorId || '').trim();

  useEffect(() => {
    if (!creatorUid) return () => {};
    const unsub = onValue(ref(db, `usuarios_publicos/${creatorUid}`), (snapshot) => {
      setPerfilPublico(snapshot.exists() ? snapshot.val() : null);
    });
    return () => unsub();
  }, [creatorUid]);

  useEffect(() => {
    const unsub = onValue(ref(db, 'obras'), (snapshot) => {
      const lista = snapshot.exists() ? ensureLegacyShitoObra(toList(snapshot.val())) : [];
      setObras(
        lista
          .filter((obra) => obraVisivelNoCatalogoPublico(obra) && obraCreatorId(obra) === creatorUid)
          .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
      );
    });
    return () => unsub();
  }, [creatorUid]);

  const redes = useMemo(() => {
    const instagramUrl = normalizarRede(perfilPublico?.instagramUrl || perfilPublico?.instagram);
    const youtubeUrl = normalizarRede(perfilPublico?.youtubeUrl || perfilPublico?.youtube);
    return [
      instagramUrl ? { id: 'instagram', label: 'Instagram', href: instagramUrl } : null,
      youtubeUrl ? { id: 'youtube', label: 'YouTube', href: youtubeUrl } : null,
    ].filter(Boolean);
  }, [perfilPublico]);

  const nomeCriador =
    String(perfilPublico?.creatorDisplayName || perfilPublico?.userName || '').trim() ||
    (obras[0]?.creatorName ? String(obras[0].creatorName) : '') ||
    'Criador';

  const bio = String(perfilPublico?.creatorBio || perfilPublico?.bio || '').trim();
  const avatar =
    String(perfilPublico?.creatorProfile?.avatarUrl || perfilPublico?.userAvatar || '').trim() ||
    '/assets/fotos/shito.jpg';
  const heroBackdropUrl = creatorPublicHeroImageUrl(perfilPublico);
  const creatorStatus = String(perfilPublico?.creatorStatus || '').trim().toLowerCase();
  const creatorMonetizationStatus = String(perfilPublico?.creatorMonetizationStatus || '').trim().toLowerCase();
  const membershipEnabled = creatorMonetizationStatus === 'active' && perfilPublico?.creatorMembershipEnabled === true;
  const membershipPrice = Number(perfilPublico?.creatorMembershipPriceBRL || 12);
  const donationSuggested = Number(perfilPublico?.creatorDonationSuggestedBRL || 7);
  const hasPublicBase = avatar.length > 3 && bio.length >= CREATOR_BIO_MIN_LENGTH && redes.length > 0;

  if (!creatorUid) {
    return (
      <main className="criador-page">
        <section className="criador-empty">
          <h1>Criador não encontrado</h1>
          <p>O link público informado está incompleto.</p>
        </section>
      </main>
    );
  }

  if ((creatorStatus && creatorStatus !== 'active') || !hasPublicBase) {
    return (
      <main className="criador-page">
        <section className="criador-empty">
          <h1>{nomeCriador}</h1>
          <p>Este perfil de criador ainda esta em preparacao e nao foi publicado por completo.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="criador-page">
      <section className="criador-hero criador-hero--blur-backdrop">
        <div className="criador-hero__backdrop" aria-hidden="true">
          <div
            className="criador-hero__backdrop-img"
            style={{ backgroundImage: `url(${heroBackdropUrl})` }}
          />
          <div className="criador-hero__backdrop-scrim" />
        </div>
        <div className="criador-hero__foreground">
        <div className="criador-hero__avatar">
          <img src={avatar} alt={nomeCriador} />
        </div>
        <div className="criador-hero__content">
          <span className="criador-hero__pill">Criador</span>
          <h1>{nomeCriador}</h1>
          <p>{bio || 'Criador autoral da plataforma MangaTeofilo.'}</p>
          <div className="criador-hero__actions">
            {membershipEnabled ? (
              <button type="button" onClick={() => navigate(apoiePathParaCriador(creatorUid))}>
                Apoiar o autor
              </button>
            ) : null}
            <button type="button" className="is-secondary" onClick={() => navigate('/works')}>
              Ver catálogo
            </button>
          </div>
          <p className="criador-hero__support-copy">
            Este é o link principal de apoio direto ao criador dentro da plataforma.
          </p>
          {membershipEnabled ? (
            <p className="criador-hero__support-copy">
              Membership do criador: <strong>{formatarPrecoBrl(membershipPrice)}</strong> por 30 dias. Ela libera acesso antecipado somente nas obras deste autor. Doacao sugerida: <strong>{formatarPrecoBrl(donationSuggested)}</strong>.
            </p>
          ) : null}
          {redes.length ? (
            <div className="criador-hero__links">
              {redes.map((rede) => (
                <a key={rede.id} href={rede.href} target="_blank" rel="noreferrer">
                  {rede.label}
                </a>
              ))}
            </div>
          ) : null}
        </div>
        </div>
      </section>

      <section className="criador-section">
        <div className="criador-section__head">
          <h2>Obras do criador</h2>
          <span>{obras.length} obra(s)</span>
        </div>
        {!obras.length ? (
          <p className="criador-section__empty">Nenhuma obra pública cadastrada para este criador ainda.</p>
        ) : (
          <div className="criador-obras-grid">
            {obras.map((obra) => (
              <article
                key={obra.id}
                className="criador-obra-card"
                role="button"
                tabIndex={0}
                onClick={() => navigate(pathObra(obra))}
                onKeyDown={(e) => e.key === 'Enter' && navigate(pathObra(obra))}
              >
                <img src={obra.capaUrl || obra.bannerUrl || '/assets/fotos/shito.jpg'} alt={obra.titulo || obra.id} />
                <div>
                  <strong>{obra.titulo || obra.id}</strong>
                  <span>{obra.status || 'ongoing'}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
