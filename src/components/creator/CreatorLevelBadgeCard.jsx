import React, { useMemo } from 'react';

import './CreatorDashboardPanel.css';

const nf = new Intl.NumberFormat('pt-BR');

/**
 * Compact level card. It only renders the progress snapshot the UI received.
 */
export default function CreatorLevelBadgeCard({ progressVm, className = '' }) {
  const vm = progressVm;

  if (!vm) return null;

  const nextMeta = vm.nextLevelMeta;
  const gapLines = useMemo(() => {
    if (!nextMeta) return [];
    const rows = vm.nextLevel === 2 ? vm.monetizationGapRows : vm.nextLevelGapRows;
    return rows.map((row) => `Faltam ${nf.format(row.left)} ${row.label}`);
  }, [nextMeta, vm.monetizationGapRows, vm.nextLevel, vm.nextLevelGapRows]);

  return (
    <div className={`creator-lvl-card ${className}`.trim()}>
      <div className="creator-lvl-card__head">
        <h3 className="creator-lvl-card__title">
          Nivel {vm.level} - {vm.meta.title} {vm.level >= 2 ? '💵' : ''}
        </h3>
      </div>

      {vm.monetizationThresholdReached ? (
        <ul className="creator-lvl-card__unlocks">
          <li>Ganhar com vendas e repasses (com monetizacao ok)</li>
          <li>Vender manga fisico na loja com repasse</li>
        </ul>
      ) : (
        <p style={{ margin: '0 0 10px', fontSize: '0.86rem', color: '#94a3b8' }}>
          Suba ate <strong>Monetizado</strong> nas metricas da plataforma para liberar a loja com repasse.
        </p>
      )}

      {nextMeta ? (
        <>
          <p className="creator-lvl-card__next">Proximo nivel: {nextMeta.title}</p>
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
          Voce esta no topo do sistema de niveis por enquanto.
        </p>
      )}
    </div>
  );
}
