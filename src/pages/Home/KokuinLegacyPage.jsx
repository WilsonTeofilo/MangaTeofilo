import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import KokuinLegacyLandingSection from '../../components/KokuinLegacyLandingSection';

import './KokuinLegacyPage.css';

function resolveBackTarget(location) {
  const statePath = typeof location.state?.from === 'string' ? location.state.from.trim() : '';
  if (statePath.startsWith('/')) {
    return statePath;
  }
  return '/sobre-autor';
}

export default function KokuinLegacyPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const backTarget = resolveBackTarget(location);

  return (
    <div className="kokuin-legacy-page">
      <button
        type="button"
        className="kokuin-legacy-page__back"
        onClick={() => navigate(backTarget)}
      >
        Voltar ao Sobre
      </button>
      <KokuinLegacyLandingSection fullViewport />
    </div>
  );
}
