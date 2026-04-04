import React from 'react';

import './OrderTracking.css';

/**
 * @param {{ steps: { key: string, label: string, state: 'done'|'current'|'upcoming', detail?: string }[], layout?: 'horizontal'|'vertical' }} props
 */
export default function OrderTimeline({ steps, layout = 'horizontal' }) {
  const list = Array.isArray(steps) ? steps : [];
  return (
    <ul className={`ot-timeline${layout === 'vertical' ? ' ot-timeline--vertical' : ''}`} role="list" aria-label="Etapas do pedido">
      {list.map((step) => (
        <li
          key={step.key}
          className={`ot-timeline__step ot-timeline__step--${step.state}`}
        >
          {layout === 'horizontal' ? <span className="ot-timeline__dot" aria-hidden="true" /> : null}
          <span className="ot-timeline__label">{step.label}</span>
          {layout === 'vertical' && step.detail ? (
            <span className="ot-timeline__sub">{step.detail}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
