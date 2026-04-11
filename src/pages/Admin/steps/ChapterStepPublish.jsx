import React from 'react';

export default function ChapterStepPublish({ isMangaka }) {
  return (
    <div className="editor-step-panel review-panel">
      <h3>{isMangaka ? 'Publicar capitulo' : 'Publicar capitulo'}</h3>
      <p className="editor-empty">
        {isMangaka
          ? 'Confira tudo e publique sem depender do admin.'
          : 'Confira os dados e clique em publicar. O botao ficara fixo ao final para facilitar.'}
      </p>
    </div>
  );
}
