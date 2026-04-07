import React from 'react';

import CreatorLevelBadgeCard from '../../components/creator/CreatorLevelBadgeCard';
import CreatorMonetizationPanel from '../../components/creator/CreatorMonetizationPanel';
import CreatorUnlockCelebrationModal from '../../components/creator/CreatorUnlockCelebrationModal';
import { useCreatorLevel2Celebration, useCreatorWorkspaceData } from '../../hooks/useCreatorWorkspaceData';
import './CreatorWorkspace.css';

export default function CreatorMonetizationGrowthPage({ user, perfil }) {
  const { creatorProgressVm, creatorLevelDash } = useCreatorWorkspaceData(user, perfil);
  const { celebrationOpen, closeCelebration } = useCreatorLevel2Celebration(user, creatorLevelDash);

  return (
    <main className="creator-workspace-page">
      <CreatorUnlockCelebrationModal open={celebrationOpen} onClose={closeCelebration} />
      <section className="creator-workspace-shell">
        <CreatorMonetizationPanel
          progressVm={creatorProgressVm}
        />
        <div className="creator-workspace-level-row">
          <CreatorLevelBadgeCard progressVm={creatorProgressVm} />
        </div>
      </section>
    </main>
  );
}
