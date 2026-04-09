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
    return `Boost ${mul}x no feed${rest ? ` · acaba em ${rest}` : ''}`;
  }, [cycleVm]);

  if (!cycleVm) {
    return (
      <div className="creator-dash creator-dash--missions">
        <p className="creator-dash__mono-lead">Carregando suas missões...</p>
      </div>
    );
  }

  const need = Number(cycleVm.need) || 0;
  const poolSize = Number(cycleVm.poolSize) || cycleVm.missions?.length || 0;
  const doneCount = Number(cycleVm.doneCount) || 0;
  const metaOk = need > 0 && doneCount >= need;
  const missingCount = Math.max(0, need - doneCount);
  const allDone = poolSize > 0 && doneCount >= poolSize;
  const pluralNeed = need === 1 ? 'missão' : 'missões';
  const pluralPool = poolSize === 1 ? 'opção' : 'opções';

  return (
    <div className="creator-dash creator-dash--missions">
      <header className="creator-dash__intro creator-dash__intro--missions">
        <h2 className="creator-dash__intro-title">Missões e XP</h2>
        <p className="creator-dash__intro-sub">
          Desafios semanais para manter ritmo e ganhar visibilidade. Isso não mexe com monetização:
          aqui você sobe de fase, ganha XP e destrava bônus de destaque.
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
            <span className="creator-dash__cycle-progress-label">Andamento da fase atual</span>
            <span className="creator-dash__cycle-progress-pct">{cycleVm.pct}%</span>
          </div>
          <div
            className="creator-dash__cycle-bar creator-dash__cycle-bar--cyan"
            role="progressbar"
            aria-valuenow={cycleVm.pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${doneCount} de ${need} missões obrigatórias concluídas`}
          >
            <div className="creator-dash__cycle-fill creator-dash__cycle-fill--cyan" style={{ width: `${cycleVm.pct}%` }} />
          </div>
          <p className="creator-dash__cycle-nudge">{cycleVm.nudge}</p>
          <p className="creator-dash__cycle-xp">XP somado nesta semana: +{nf.format(cycleVm.xpVisualTotal)}</p>
        </section>

        <section className="creator-dash__panel creator-dash__panel--missions" aria-label="Lista de missões">
          <h3 className="creator-dash__panel-eyebrow">Escolha o que fazer</h3>
          <div className="creator-missions__rule" role="note">
            <strong>Missões concluídas: {doneCount}/{poolSize}</strong>
            <p>
              Nesta fase existem <strong>{poolSize}</strong> {pluralPool}. Você não precisa fazer todas:
              escolha as que fizerem sentido no seu ritmo.
            </p>
            <p>
              Para subir de nível, precisa fechar <strong>{need}/{poolSize}</strong>. Se completar as{' '}
              <strong>{poolSize}/{poolSize}</strong>, ganha bônus para a próxima fase.
            </p>
          </div>
          <p className="creator-dash__missions-hint creator-dash__missions-hint--muted">
            O sistema marca sozinho quando a meta bate. Capítulo novo conta como uma missão inteira.
          </p>
          <ul className="creator-dash__mission-list">
            {cycleVm.missions.map((m) => (
              <li key={m.id} className={`creator-dash__mission-row${m.done ? ' is-done' : ''}`}>
                <span className="creator-dash__mission-check" aria-hidden="true">
                  {m.done ? '[x]' : '[ ]'}
                </span>
                <span className="creator-dash__mission-label">{m.label}</span>
                <span className="creator-dash__mission-xp">+{m.xp} XP</span>
              </li>
            ))}
          </ul>
          <p className={`creator-dash__missions-foot${metaOk ? ' is-complete' : ''}`}>
            {metaOk ? (
              <>
                <strong>Fase pronta para subir.</strong> Você concluiu {doneCount} de {need} {pluralNeed} obrigatórias.
                {allDone ? ' Bônus extra liberado por fechar todas as opções.' : null}
              </>
            ) : (
              <>
                <strong>{missingCount}</strong> {missingCount === 1 ? 'missão falta' : 'missões faltam'} para subir de
                nível. A lista total desta fase tem <strong>{poolSize}</strong> {pluralPool}.
              </>
            )}
          </p>
        </section>

        <section className="creator-dash__panel creator-dash__panel--missions" aria-label="Próxima recompensa">
          <h3 className="creator-dash__panel-eyebrow">Próxima recompensa</h3>
          <p className="creator-dash__next-reward-sub">
            Quando fechar a <strong>fase {cycleVm.cycleLevel}</strong>, você destrava:
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
              Nenhum boost ativo agora. Fechar a fase atual libera o próximo bônus de visibilidade.
            </p>
          )}
          {cycleVm.badgeTier > 0 ? (
            <div className="creator-dash__active-pill creator-dash__active-pill--badge">
              <span aria-hidden="true">[badge]</span>
              <span>Selo de engajamento (nível {cycleVm.badgeTier}) com impacto leve no ranking e no perfil</span>
            </div>
          ) : null}
          {cycleVm.spotlightActive ? (
            <div className="creator-dash__active-pill creator-dash__active-pill--spot">
              <span aria-hidden="true">[spotlight]</span>
              <span>Destaque temporário na vitrine</span>
            </div>
          ) : null}
        </section>

        <footer className="creator-dash__footer">
          <Link className="creator-dash__cta creator-dash__cta--cyan" to="/creator/monetizacao">
            Metas de monetização
          </Link>
          <p className="creator-dash__legal">
            Missões e XP não liberam repasse financeiro. Monetização continua em outra trilha.
          </p>
        </footer>
      </div>
    </div>
  );
}
