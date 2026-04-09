/**
 * Only platform growth and monetization goals live here.
 * XP, missions, boost, and the weekly cycle are separate.
 */
import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';

import { MONETIZATION_REWARD_LINES, MONETIZATION_THRESHOLDS } from '../../utils/creatorProgression';
import './CreatorDashboardPanel.css';

const nf = new Intl.NumberFormat('pt-BR');

function barPct(cur, target) {
  const total = Math.max(1, Number(target) || 1);
  return Math.min(100, Math.round((Math.max(0, Number(cur) || 0) / total) * 100));
}

export default function CreatorMonetizationPanel({ progressVm }) {
  const vm = progressVm;

  if (!vm) return null;

  const motivationalLine = useMemo(() => {
    if (vm.nextLevel == null) {
      return vm.monetizationThresholdReached
        ? 'Metas do nível máximo batidas. Mantenha o ritmo e a monetização ativa no perfil para liberar ganhos.'
        : vm.primaryNextLevelGapPhrase;
    }
    return vm.primaryNextLevelGapPhrase || 'Publique com constância e compartilhe seu perfil para subir de nível na plataforma.';
  }, [vm.monetizationThresholdReached, vm.nextLevel, vm.primaryNextLevelGapPhrase]);

  return (
    <div className="creator-dash">
      <header className="creator-dash__intro">
        <h2 className="creator-dash__intro-title">Monetização na plataforma</h2>
        <p className="creator-dash__intro-sub">
          Crescimento real em seguidores, views e likes para liberar ganhos na plataforma, separado de missões e XP.
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
              {vm.meta.emoji}
            </span>
            Nível atual: <strong>{vm.meta.title}</strong>
            {vm.nextLevelMeta ? (
              <>
                {' '}
                · Próximo nível: <strong>{vm.nextLevelMeta.title}</strong>
              </>
            ) : (
              <>
                {' '}
                · <strong>Nível máximo</strong> nas metas
              </>
            )}
          </p>

          {vm.nextLevel != null ? (
            <>
              <div className="creator-dash__next-level-bar-block">
                <div
                  className="creator-dash__metric-bar creator-dash__metric-bar--hero"
                  role="progressbar"
                  aria-valuenow={vm.nextLevelProgressPercent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`Progresso médio rumo a ${vm.nextLevelMeta?.title || 'próximo nível'}`}
                >
                  <div
                    className="creator-dash__metric-fill creator-dash__metric-fill--yellow"
                    style={{ width: `${vm.nextLevelProgressPercent}%` }}
                  />
                </div>
                <p className="creator-dash__next-level-bar-caption">
                  <strong>{vm.nextLevelProgressPercent}%</strong> para {vm.nextLevelMeta ? vm.nextLevelMeta.title : 'o próximo nível'}
                </p>
              </div>
              <div className="creator-dash__metric-grid creator-dash__metric-grid--mono">
                {vm.nextLevelRows.map((row) => {
                  const pct = barPct(row.current, row.target);
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
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="creator-dash__metric-pct creator-dash__metric-pct--yellow">{pct}%</span>
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
            {motivationalLine}
          </p>

          <div className="creator-dash__mono-longterm" aria-label="Metas de monetização">
            <h4 className="creator-dash__subhead">Desbloqueio de monetização (Nível 2)</h4>
            <p className="creator-dash__mono-lead creator-dash__mono-lead--tight">
              Ao bater essas metas, você libera ganhos com a loja, membros e outros recursos financeiros no seu perfil.
            </p>
            <ul className="creator-dash__mono-longterm-metrics">
              <li>Seguidores: {nf.format(MONETIZATION_THRESHOLDS.followers)}</li>
              <li>Views: {nf.format(MONETIZATION_THRESHOLDS.views)}</li>
              <li>Likes: {nf.format(MONETIZATION_THRESHOLDS.likes)}</li>
            </ul>
            {!vm.monetizationThresholdReached ? (
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
                Nas métricas, você já está no patamar de monetização. Agora é só manter a conta pronta e aprovada no perfil.
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
            Missões, XP e boost não liberam ganhos por si só. Para vender na loja e receber pela plataforma, você precisa bater o Nível 2 nas métricas e ter monetização aprovada no perfil.
          </p>
        </footer>
      </div>
    </div>
  );
}
