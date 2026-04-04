/**
 * Ciclo semanal, missões, XP visual, boost — sem metas de monetização da plataforma.
 */
import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';

import { formatRemainingShort } from '../../utils/creatorEngagementCycle';
import './CreatorDashboardPanel.css';

const nf = new Intl.NumberFormat('pt-BR');

export default function CreatorMissionsXpPanel({ cycleVm }) {
  const boostHeadline = useMemo(() => {
    if (!cycleVm?.boostActive) return null;
    const mul = cycleVm.boostMul.toLocaleString('pt-BR', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
    const rest = formatRemainingShort(cycleVm.boostRemainingMs);
    return `Boost ${mul}× no feed${rest ? ` · acaba em ${rest}` : ''}`;
  }, [cycleVm]);

  if (!cycleVm) {
    return (
      <div className="creator-dash creator-dash--missions">
        <p className="creator-dash__mono-lead">Carregando suas missões…</p>
      </div>
    );
  }

  const need = Number(cycleVm.need) || 0;
  const poolSize = Number(cycleVm.poolSize) || cycleVm.missions?.length || 0;
  const doneCount = Number(cycleVm.doneCount) || 0;
  const metaOk = need > 0 && doneCount >= need;
  const pluralNeed = need === 1 ? 'missão' : 'missões';
  const pluralPool = poolSize === 1 ? 'opção' : 'opções';

  return (
    <div className="creator-dash creator-dash--missions">
      <header className="creator-dash__intro creator-dash__intro--missions">
        <h2 className="creator-dash__intro-title">Missões &amp; XP</h2>
        <p className="creator-dash__intro-sub">
          Desafios semanais para manter ritmo e ganhar destaque no feed. Isso aqui não libera dinheiro — é separado das
          metas de monetização.
        </p>
      </header>

      <div className="creator-dash__surface creator-dash__surface--stack creator-dash__surface--missions">
        <section
          className="creator-dash__panel creator-dash__panel--missions-hero"
          aria-labelledby="creator-missions-cycle-heading"
        >
          <p className="creator-missions__kicker" id="creator-missions-cycle-heading">
            Semana do criador
          </p>
          <h2 className="creator-dash__panel-title creator-dash__panel-title--missions">Sua fase agora</h2>
          <p className="creator-dash__hero-cycle">
            Você está na <strong>fase {cycleVm.cycleLevel}</strong> de <strong>5</strong>.
          </p>
          <div className="creator-dash__cycle-progress-top">
            <span className="creator-dash__cycle-progress-label">Andamento da meta desta fase</span>
            <span className="creator-dash__cycle-progress-pct">{cycleVm.pct}%</span>
          </div>
          <div
            className="creator-dash__cycle-bar creator-dash__cycle-bar--cyan"
            role="progressbar"
            aria-valuenow={cycleVm.pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${doneCount} de ${need} missões necessárias concluídas`}
          >
            <div className="creator-dash__cycle-fill creator-dash__cycle-fill--cyan" style={{ width: `${cycleVm.pct}%` }} />
          </div>
          <p className="creator-dash__cycle-nudge">{cycleVm.nudge}</p>
          <p className="creator-dash__cycle-xp">XP que você já somou nesta semana: +{nf.format(cycleVm.xpVisualTotal)}</p>
        </section>

        <section className="creator-dash__panel creator-dash__panel--missions" aria-label="Lista de missões">
          <h3 className="creator-dash__panel-eyebrow">Escolha o que fazer</h3>
          <div className="creator-missions__rule" role="note">
            <strong>
              {need} de {poolSize}
            </strong>
            <p>
              Nesta fase você precisa concluir <strong>{need}</strong> {pluralNeed}. Na lista existem{' '}
              <strong>{poolSize}</strong> {pluralPool} diferentes — <strong>não precisa fazer todas</strong>, só escolher
              as que couberem no seu ritmo (por exemplo capítulo + likes, ou só views e likes).
            </p>
          </div>
          <p className="creator-dash__missions-hint creator-dash__missions-hint--muted">
            Quando cumprir, o sistema marca sozinho. Capítulo novo conta como uma missão inteira.
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
          <p className={`creator-dash__missions-foot${metaOk ? ' is-complete' : ''}`}>
            {metaOk ? (
              <>
                <strong>Meta desta fase cumprida.</strong> Você fechou {doneCount} de {need} {pluralNeed} necessárias
                {poolSize > need ? ` (${poolSize} ${pluralPool} no total).` : '.'}
              </>
            ) : (
              <>
                <strong>
                  {doneCount}/{need}
                </strong>{' '}
                missões necessárias concluídas
                {poolSize > need ? (
                  <>
                    {' '}
                    · na lista há <strong>{poolSize}</strong> {pluralPool} no total
                  </>
                ) : null}
                {need > 0 ? (
                  <>
                    {' '}
                    · faltam <strong>{Math.max(0, need - doneCount)}</strong>
                  </>
                ) : null}
              </>
            )}
          </p>
        </section>

        <section className="creator-dash__panel creator-dash__panel--missions" aria-label="Próxima recompensa">
          <h3 className="creator-dash__panel-eyebrow">Próxima recompensa</h3>
          <p className="creator-dash__next-reward-sub">
            Quando fechar a <strong>fase {cycleVm.cycleLevel}</strong>, você desbloqueia:
          </p>
          <ul className="creator-dash__next-reward-list">
            {cycleVm.nextRewardLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>

        <section className="creator-dash__panel creator-dash__panel--missions" aria-label="Recompensas ativas">
          <h3 className="creator-dash__panel-eyebrow">Recompensas ativas</h3>
          {cycleVm.boostActive && boostHeadline ? (
            <div className="creator-dash__active-pill creator-dash__active-pill--boost creator-dash__active-pill--cyan">
              <div>
                <strong className="creator-dash__active-boost-line">{boostHeadline}</strong>
                <p className="creator-dash__active-pill-meta creator-dash__active-pill-meta--muted">
                  Seu conteúdo aparece com mais força no feed enquanto durar.
                </p>
              </div>
            </div>
          ) : (
            <p className="creator-dash__active-empty">
              Nenhum boost ligado agora. Fechar a fase atual libera o próximo bônus de visibilidade.
            </p>
          )}
          {cycleVm.badgeTier > 0 ? (
            <div className="creator-dash__active-pill creator-dash__active-pill--badge">
              <span aria-hidden="true">🏅</span>
              <span>Selo de engajamento (nível {cycleVm.badgeTier}) — ajuda um pouco no ranking e no perfil</span>
            </div>
          ) : null}
          {cycleVm.spotlightActive ? (
            <div className="creator-dash__active-pill creator-dash__active-pill--spot">
              <span aria-hidden="true">✨</span>
              <span>Destaque temporário na vitrine</span>
            </div>
          ) : null}
        </section>

        <footer className="creator-dash__footer">
          <Link className="creator-dash__cta creator-dash__cta--cyan" to="/creator/monetizacao">
            Metas de monetização (outra tela)
          </Link>
          <p className="creator-dash__legal">
            Missões e XP não liberam repasse. Monetização continua no perfil e nas metas da plataforma.
          </p>
        </footer>
      </div>
    </div>
  );
}
