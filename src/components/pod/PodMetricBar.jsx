import React from 'react';

import { fmtCountPt } from '../../pages/Loja/podPageUtils';

export default function PodMetricBar({ label, current, max }) {
  const cap = Math.max(1, Number(max) || 1);
  const cur = Math.max(0, Number(current) || 0);
  const pct = Math.min(100, Math.round((cur / cap) * 100));
  return (
    <div className="pod-metric">
      <div className="pod-metric__head">
        <span className="pod-metric__label">{label}</span>
        <span className="pod-metric__nums">
          {fmtCountPt(cur)} / {fmtCountPt(cap)}
        </span>
      </div>
      <div
        className="pod-metric__bar"
        role="progressbar"
        aria-valuenow={cur}
        aria-valuemin={0}
        aria-valuemax={cap}
        aria-label={`${label}: ${fmtCountPt(cur)} de ${fmtCountPt(cap)}`}
      >
        <div className="pod-metric__fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
