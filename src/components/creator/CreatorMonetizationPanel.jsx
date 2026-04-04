/**
 * Somente crescimento / metas da plataforma ligadas a monetização (longo prazo).
 * Não incluir XP, missões, boost ou ciclo semanal.
 */
import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';

import {
  CREATOR_LEVEL_META,
  MONETIZATION_REWARD_LINES,
  MONETIZATION_THRESHOLDS,
  computeCreatorLevel,
  getNextLevelProgressPercent,
  getPrimaryNextLevelGapPhrase,
  getProgressTowardsNextLevel,
  meetsMonetizationLevel,
} from '../../utils/creatorProgression';
import './CreatorDashboardPanel.css';

const nf = new Intl.NumberFormat('pt-BR');

function barPct(cur, target) {
  const t = Math.max(1, Number(target) || 1);
  return Math.min(100, Math.round((Math.max(0, Number(cur) || 0) / t) * 100));
}

export default function CreatorMonetizationPanel({ followers, views, likes }) {
  const metrics = useMemo(() => ({ followers, views, likes }), [followers, views, likes]);
  const platformLevel = useMemo(() => computeCreatorLevel(metrics), [metrics]);
  const meta = CREATOR_LEVEL_META[platformLevel] || CREATOR_LEVEL_META[0];
  const monetizationReady = useMemo(() => meetsMonetizationLevel(metrics), [metrics]);
  const nextLevel = useMemo(() => getProgressTowardsNextLevel(metrics), [metrics]);
  const nextMeta =
    nextLevel.nextLevel != null ? CREATOR_LEVEL_META[nextLevel.nextLevel] : null;
  const nextLevelPct = useMemo(() => getNextLevelProgressPercent(metrics), [metrics]);
  const nudgeNextLevel = useMemo(() => getPrimaryNextLevelGapPhrase(metrics), [metrics]);

  const motivacional = useMemo(() => {
    if (nextLevel.nextLevel == null) {
      return monetizationReady
        ? 'Metas de nível máximo. Mantenha ritmo e monetização ativa no perfil para repasses.'
        : nudgeNextLevel;
    }
    return nudgeNextLevel || 'Publique com constância e compartilhe seu perfil para subir de nível na plataforma.';
  }, [nextLevel.nextLevel, monetizationReady, nudgeNextLevel]);

  return (
    <div className="creator-dash">
      <header className="creator-dash__intro">
        <h2 className="creator-dash__intro-title">Monetização na plataforma</h2>
        <p className="creator-dash__intro-sub">
          Crescimento real (seguidores, views e likes) e caminho para liberar recursos financeiros — separado de missões e
          XP.
        </p>
      </header>

      <div className="creator-dash__surface creator-dash__surface--stack">
        <section
          className="creator-dash__panel creator-dash__panel--monetization"
          aria-labelledby="creator-dash-platform-progress"
        >
          <h3 className="creator-dash__panel-eyebrow" id="creator-dash-platform-progress">
            Seu progresso na plataforma
          </h3>
          <p className="creator-dash__mono-tier">
            <span className="creator-dash__level-emoji" aria-hidden="true">
              {meta.emoji}
            </span>
            Nível atual: <strong>{meta.title}</strong>
            {nextMeta ? (
              <>
                {' '}
                · Próximo nível: <strong>{nextMeta.title}</strong>
              </>
            ) : (
              <>
                {' '}
                · <strong>Nível máximo</strong> nas metas
              </>
            )}
          </p>

          {nextLevel.nextLevel != null ? (
            <>
              <div className="creator-dash__next-level-bar-block">
                <div
                  className="creator-dash__metric-bar creator-dash__metric-bar--hero"
                  role="progressbar"
                  aria-valuenow={nextLevelPct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`Progresso médio rumo a ${nextMeta?.title || 'próximo nível'}`}
                >
                  <div
                    className="creator-dash__metric-fill creator-dash__metric-fill--yellow"
                    style={{ width: `${nextLevelPct}%` }}
                  />
                </div>
                <p className="creator-dash__next-level-bar-caption">
                  <strong>{nextLevelPct}%</strong> para {nextMeta ? nextMeta.title : 'o próximo nível'}
                </p>
              </div>
              <div className="creator-dash__metric-grid creator-dash__metric-grid--mono">
                {nextLevel.rows.map((row) => {
                  const p = barPct(row.current, row.target);
                  return (
                    <article key={row.key} className="creator-dash__metric-card">
                      <p className="creator-dash__metric-line">
                        <span className="creator-dash__metric-name">{row.label}</span>
                        <span className="creator-dash__metric-nums">
                          {nf.format(row.current)} / {nf.format(row.target)}
                        </span>
                      </p>
                      <div className="creator-dash__metric-bar-wrap">
                        <div className="creator-dash__metric-bar" aria-hidden="true">
                          <div
                            className="creator-dash__metric-fill creator-dash__metric-fill--yellow"
                            style={{ width: `${p}%` }}
                          />
                        </div>
                        <span className="creator-dash__metric-pct creator-dash__metric-pct--yellow">{p}%</span>
                      </div>
                    </article>
                  );
                })}
              </div>
            </>
          ) : (
            <p className="creator-dash__mono-lead creator-dash__mono-lead--tight">
              Você atingiu o nível máximo de metas (Destaque). Continue publicando para manter alcance.
            </p>
          )}

          <p className="creator-dash__motivate" role="status">
            {motivacional}
          </p>

          <div className="creator-dash__mono-longterm" aria-label="Metas de monetização">
            <h4 className="creator-dash__subhead">Desbloqueio de monetização (Nível 2)</h4>
            <p className="creator-dash__mono-lead creator-dash__mono-lead--tight">
              Alvo para <strong>POD com repasse</strong> e vitrine com repasse — além de{' '}
              <strong>monetização aprovada</strong> no perfil.
            </p>
            <ul className="creator-dash__mono-longterm-metrics">
              <li>Seguidores: {nf.format(MONETIZATION_THRESHOLDS.followers)}</li>
              <li>Views: {nf.format(MONETIZATION_THRESHOLDS.views)}</li>
              <li>Likes: {nf.format(MONETIZATION_THRESHOLDS.likes)}</li>
            </ul>
            {!monetizationReady ? (
              <>
                <p className="creator-dash__unlock-sub creator-dash__unlock-sub--inline">Ao bater essas metas:</p>
                <ul className="creator-dash__unlock-list creator-dash__unlock-list--compact">
                  {MONETIZATION_REWARD_LINES.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="creator-dash__mono-lead creator-dash__mono-lead--tight">
                Nas métricas, você já está no patamar de monetização — siga com a conta e as aprovações no perfil.
              </p>
            )}
          </div>
        </section>

        <section className="creator-dash__panel creator-dash__panel--drive" aria-label="Continue publicando">
          <p className="creator-dash__drive-title">Ritmo sustentável</p>
          <p className="creator-dash__drive-text">
            Cada capítulo te aproxima do próximo nível na plataforma. Consistência {'>'} velocidade.
          </p>
        </section>

        <footer className="creator-dash__footer">
          <Link className="creator-dash__cta" to="/creator/audience">
            Ver analytics
          </Link>
          <Link className="creator-dash__cta creator-dash__cta--ghost" to="/creator/missoes">
            Ir para Missões &amp; XP
          </Link>
          <p className="creator-dash__legal">
            Missões, XP e boost são só engajamento — não liberam dinheiro. POD com repasse: Nível 2 nas métricas +
            monetização aprovada no perfil.
          </p>
        </footer>
      </div>
    </div>
  );
}
