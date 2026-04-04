/**
 * CREATOR DASHBOARD — regra de produto:
 * Barras de progresso e percentagens ficam APENAS aqui (painel completo).
 * Não replicar barras/% em feed, cards de obra, home ou listas públicas.
 */
import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';

import { formatRemainingShort } from '../../utils/creatorEngagementCycle';
import {
  CREATOR_LEVEL_META,
  MONETIZATION_REWARD_LINES,
  computeCreatorLevel,
  getMonetizationProgressRows,
  getPrimaryMonetizationGapPhrase,
  getProgressTowardsNextLevel,
  meetsMonetizationLevel,
} from '../../utils/creatorProgression';
import './CreatorDashboardPanel.css';

const nf = new Intl.NumberFormat('pt-BR');

function barPct(cur, target) {
  const t = Math.max(1, Number(target) || 1);
  return Math.min(100, Math.round((Math.max(0, Number(cur) || 0) / t) * 100));
}

const REWARD_HEADLINE = 'Desbloqueia monetização';

/** @param {{ followers: number, views: number, likes: number, variant?: 'full' | 'compact', cycleVm?: object | null }} props */
export default function CreatorDashboardPanel({ followers, views, likes, variant = 'full', cycleVm = null }) {
  const metrics = useMemo(() => ({ followers, views, likes }), [followers, views, likes]);
  const level = useMemo(() => computeCreatorLevel(metrics), [metrics]);
  const meta = CREATOR_LEVEL_META[level] || CREATOR_LEVEL_META[0];
  const monoRows = useMemo(() => getMonetizationProgressRows(metrics), [metrics]);
  const nudgeMono = useMemo(() => getPrimaryMonetizationGapPhrase(metrics), [metrics]);
  const monetizationReady = useMemo(() => meetsMonetizationLevel(metrics), [metrics]);
  const nextLevel = useMemo(() => getProgressTowardsNextLevel(metrics), [metrics]);
  const nextMeta =
    nextLevel.nextLevel != null ? CREATOR_LEVEL_META[nextLevel.nextLevel] : null;

  const isCompact = variant === 'compact';
  const motivacional = monetizationReady
    ? 'Meta batida — mantenha a monetização ativa no perfil.'
    : nudgeMono || 'Publique com constância e compartilhe seu perfil para chegar lá.';

  const showCycle = Boolean(cycleVm) && !isCompact;

  const boostHeadline = useMemo(() => {
    if (!cycleVm?.boostActive) return null;
    const mul = cycleVm.boostMul.toLocaleString('pt-BR', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
    const rest = formatRemainingShort(cycleVm.boostRemainingMs);
    return `🔥 Boost ${mul}× no feed${rest ? ` (restam ${rest})` : ''}`;
  }, [cycleVm]);

  return (
    <div className={`creator-dash${isCompact ? ' creator-dash--compact' : ''}`}>
      {!isCompact ? (
        <header className="creator-dash__intro">
          <h2 className="creator-dash__intro-title">Painel do criador</h2>
          <p className="creator-dash__intro-sub">Seu progresso, missões e caminho para monetizar</p>
        </header>
      ) : null}

      <div className="creator-dash__surface creator-dash__surface--stack">
        {showCycle ? (
          <>
            <section className="creator-dash__panel creator-dash__panel--hero" aria-labelledby="creator-dash-progress-heading">
              <h2 className="creator-dash__panel-title" id="creator-dash-progress-heading">
                Seu progresso
              </h2>
              <p className="creator-dash__hero-level">
                <span className="creator-dash__hero-level-emoji" aria-hidden="true">
                  {meta.emoji}
                </span>
                <span>
                  Nível na plataforma: <strong>{meta.title}</strong>
                </span>
              </p>
              <p className="creator-dash__hero-cycle">
                Ciclo semanal · Nível <strong>{cycleVm.cycleLevel}</strong> de 5
              </p>
              <div className="creator-dash__cycle-progress-top">
                <span className="creator-dash__cycle-progress-label">Missões deste nível</span>
                <span className="creator-dash__cycle-progress-pct">{cycleVm.pct}%</span>
              </div>
              <div
                className="creator-dash__cycle-bar"
                role="progressbar"
                aria-valuenow={cycleVm.pct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`Missões do ciclo: ${cycleVm.pct} por cento`}
              >
                <div className="creator-dash__cycle-fill" style={{ width: `${cycleVm.pct}%` }} />
              </div>
              <p className="creator-dash__cycle-nudge">{cycleVm.nudge}</p>
              <p className="creator-dash__cycle-xp" aria-hidden="false">
                XP visual (só diversão): +{nf.format(cycleVm.xpVisualTotal)}
              </p>
            </section>

            <section className="creator-dash__panel" aria-label="Missões da semana">
              <h3 className="creator-dash__panel-eyebrow">Missões da semana</h3>
              <p className="creator-dash__missions-hint">
                Complete <strong>{cycleVm.need}</strong> missões para subir de nível no ciclo. Capítulo conta como
                bônus forte, não é obrigatório em todas.
              </p>
              <ul className="creator-dash__mission-list">
                {cycleVm.missions.map((m) => (
                  <li key={m.id} className={`creator-dash__mission-row${m.done ? ' is-done' : ''}`}>
                    <span className="creator-dash__mission-check" aria-hidden="true">
                      {m.done ? '✔' : '□'}
                    </span>
                    <span className="creator-dash__mission-label">{m.label}</span>
                    <span className="creator-dash__mission-xp">+{m.xp} XP</span>
                  </li>
                ))}
              </ul>
              <p className="creator-dash__missions-foot">
                Progresso: {cycleVm.doneCount}/{cycleVm.need} missões completas
              </p>
            </section>

            <section className="creator-dash__panel" aria-label="Próxima recompensa">
              <h3 className="creator-dash__panel-eyebrow">Próxima recompensa</h3>
              <p className="creator-dash__next-reward-sub">
                Ao concluir o nível <strong>{cycleVm.cycleLevel}</strong> do ciclo, você desbloqueia:
              </p>
              <ul className="creator-dash__next-reward-list">
                {cycleVm.nextRewardLines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </section>

            <section className="creator-dash__panel" aria-label="Recompensas ativas">
              <h3 className="creator-dash__panel-eyebrow">Recompensas ativas</h3>
              {cycleVm.boostActive && boostHeadline ? (
                <div className="creator-dash__active-pill creator-dash__active-pill--boost">
                  <div>
                    <strong className="creator-dash__active-boost-line">{boostHeadline}</strong>
                    <p className="creator-dash__active-pill-meta creator-dash__active-pill-meta--muted">
                      Visibilidade extra no feed enquanto durar o boost.
                    </p>
                  </div>
                </div>
              ) : (
                <p className="creator-dash__active-empty">
                  Nenhum boost ativo — avance no ciclo para ganhar destaque no feed.
                </p>
              )}
              {cycleVm.badgeTier > 0 ? (
                <div className="creator-dash__active-pill creator-dash__active-pill--badge">
                  <span aria-hidden="true">🏅</span>
                  <span>
                    Selo de engajamento (tier {cycleVm.badgeTier}) — bônus leve no ranking e no perfil
                  </span>
                </div>
              ) : null}
              {cycleVm.spotlightActive ? (
                <div className="creator-dash__active-pill creator-dash__active-pill--spot">
                  <span aria-hidden="true">✨</span>
                  <span>Destaque temporário na vitrine</span>
                </div>
              ) : null}
            </section>
          </>
        ) : null}

        <section
          className="creator-dash__panel creator-dash__panel--monetization"
          aria-labelledby="creator-dash-money-heading"
        >
          <h3 className="creator-dash__panel-eyebrow" id="creator-dash-money-heading">
            Progresso para monetização
          </h3>
          <p className="creator-dash__mono-lead">
            Sistema separado das missões: usa <strong>seguidores, views e likes</strong> reais da plataforma.
          </p>
          {!isCompact ? (
            <p className="creator-dash__mono-tier">
              <span className="creator-dash__level-emoji" aria-hidden="true">
                {meta.emoji}
              </span>
              Agora: <strong>{meta.title}</strong>
              {nextMeta ? (
                <>
                  {' '}
                  · Próximo: <strong>{nextMeta.title}</strong>
                </>
              ) : null}
            </p>
          ) : (
            <p className="creator-dash__mono-tier creator-dash__mono-tier--compact">
              <strong>{meta.title}</strong>
              {nextMeta ? (
                <>
                  {' '}
                  → {nextMeta.title}
                </>
              ) : null}
            </p>
          )}

          {isCompact ? (
            <ul className="creator-dash__compact-mono-list">
              {monoRows.map((row) => (
                <li key={row.key}>
                  <span className="creator-dash__compact-mono-label">{row.label}</span>
                  <span className="creator-dash__compact-mono-val">
                    {nf.format(row.current)} / {nf.format(row.target)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="creator-dash__metric-grid creator-dash__metric-grid--mono">
              {monoRows.map((row) => {
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
                        <div className="creator-dash__metric-fill creator-dash__metric-fill--yellow" style={{ width: `${p}%` }} />
                      </div>
                      <span className="creator-dash__metric-pct creator-dash__metric-pct--yellow">{p}%</span>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          <p className="creator-dash__motivate" role="status">
            {motivacional}
          </p>
        </section>

        {!isCompact && !monetizationReady ? (
          <section className="creator-dash__unlock" aria-label="Recompensas ao monetizar">
            <p className="creator-dash__unlock-kicker">{REWARD_HEADLINE}</p>
            <p className="creator-dash__unlock-sub">Ao bater as metas acima:</p>
            <ul className="creator-dash__unlock-list">
              {MONETIZATION_REWARD_LINES.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="creator-dash__panel creator-dash__panel--drive" aria-label="Continue publicando">
          <p className="creator-dash__drive-title">Continue evoluindo</p>
          <p className="creator-dash__drive-text">
            Cada capítulo e cada interação aproximam novas recompensas no ciclo e na monetização. Publique com
            ritmo que você sustenta — constância vence sprint quebrada.
          </p>
        </section>

        <footer className="creator-dash__footer">
          {!isCompact ? (
            <Link className="creator-dash__cta" to="/creator/audience">
              Ver como crescer
            </Link>
          ) : (
            <Link className="creator-dash__cta creator-dash__cta--ghost" to="/creator/dashboard#creator-level">
              Abrir painel completo
            </Link>
          )}
          <p className="creator-dash__legal">
            Barras e % de progressão só aparecem neste painel completo. POD com repasse: <strong>Nível 2</strong> +
            monetização aprovada.
          </p>
        </footer>
      </div>
    </div>
  );
}
