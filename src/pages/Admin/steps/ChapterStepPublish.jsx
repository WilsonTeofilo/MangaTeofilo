import React from 'react';

export default function ChapterStepPublish({ isMangaka }) {
  return (
    <div className="editor-step-panel review-panel">
      <h3>{isMangaka ? 'Publicar capitulo' : 'Publicar capitulo'}</h3>
      <p className="editor-empty">
        {isMangaka
          ? 'Confira tudo e publique sem depender do admin. Se ainda nao terminou, salve como rascunho.'
          : 'Confira os dados e clique em publicar. Se ainda nao terminou, use salvar rascunho para continuar depois.'}
      </p>
    </div>
  );
}
