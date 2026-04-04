import React from 'react';

import CreatorMissionsXpPanel from '../../components/creator/CreatorMissionsXpPanel';
import { useCreatorWorkspaceData } from '../../hooks/useCreatorWorkspaceData';
import './CreatorWorkspace.css';

export default function CreatorMissionsPage({ user, perfil }) {
  const { cycleVm } = useCreatorWorkspaceData(user, perfil);

  return (
    <main className="creator-workspace-page">
      <section className="creator-workspace-shell">
        <CreatorMissionsXpPanel cycleVm={cycleVm} />
      </section>
    </main>
  );
}
