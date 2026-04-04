import React, { useMemo } from 'react';

import {
  CREATOR_LEVEL_META,
  computeCreatorLevel,
  getGapsUntilMonetization,
  getProgressTowardsNextLevel,
  meetsMonetizationLevel,
} from '../../utils/creatorProgression';
import './CreatorDashboardPanel.css';

const nf = new Intl.NumberFormat('pt-BR');

/**
 * Card compacto reutilizável (nível + desbloqueios + próximo).
 * @param {{ followers: number, views: number, likes: number, className?: string }} props
 */
export default function CreatorLevelBadgeCard({ followers, views, likes, className = '' }) {
  const metrics = useMemo(() => ({ followers, views, likes }), [followers, views, likes]);
  const level = useMemo(() => computeCreatorLevel(metrics), [metrics]);
  const meta = CREATOR_LEVEL_META[level] || CREATOR_LEVEL_META[0];
  const canEarn = meetsMonetizationLevel(metrics);
  const next = useMemo(() => getProgressTowardsNextLevel(metrics), [metrics]);
  const gapsMono = useMemo(() => getGapsUntilMonetization(metrics), [metrics]);

  const nextMeta = next.nextLevel != null ? CREATOR_LEVEL_META[next.nextLevel] : null;

  const gapLines = useMemo(() => {
    if (next.nextLevel == null) return [];
    if (next.nextLevel === 2) {
      return gapsMono.map((g) => `Faltam ${nf.format(g.left)} ${g.label}`);
    }
    return (next.rows || [])
      .map((r) => {
        const left = Math.max(0, r.target - r.current);
        if (left <= 0) return null;
        return `Faltam ${nf.format(left)} ${String(r.label).toLowerCase()}`;
      })
      .filter(Boolean);
  }, [next, gapsMono]);

  return (
    <div className={`creator-lvl-card ${className}`.trim()}>
      <div className="creator-lvl-card__head">
        <h3 className="creator-lvl-card__title">
          Nível {level} — {meta.title} {level >= 2 ? '🔓' : ''}
        </h3>
      </div>

      {canEarn ? (
        <ul className="creator-lvl-card__unlocks">
          <li>Ganhar com vendas e repasses (com monetização ok)</li>
          <li>Vender mangá físico na loja com repasse</li>
        </ul>
      ) : (
        <p style={{ margin: '0 0 10px', fontSize: '0.86rem', color: '#94a3b8' }}>
          Suba até <strong>Monetizado</strong> nas métricas da plataforma para liberar a loja com repasse.
        </p>
      )}

      {nextMeta && next.nextLevel != null ? (
        <>
          <p className="creator-lvl-card__next">Próximo nível: {nextMeta.title}</p>
          {gapLines.length ? (
            <ul className="creator-lvl-card__gaps">
              {gapLines.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <p className="creator-lvl-card__next" style={{ textTransform: 'none', letterSpacing: 'normal' }}>
          Você está no topo do sistema de níveis por enquanto.
        </p>
      )}
    </div>
  );
}
