import React from 'react';
import ChapterSeo from './ChapterSeo.jsx';

export default function ChapterReleaseBlocked({
  capitulo,
  chapterSeo,
  quando,
  creatorSupportEnabled,
  onVoltar,
  onApoiar,
}) {
  return (
    <div className="leitor-container">
      <ChapterSeo chapterSeo={chapterSeo} noIndex includeJsonLd={false} />
      <div className="leitor-lancamento-bloqueado" role="status">
        <h1 className="leitor-lancamento-titulo">{capitulo?.titulo || 'Capítulo'}</h1>
        <p className="leitor-lancamento-msg">
          Este capítulo ainda não está liberado para leitura pública.
          {quando ? (
            <>
              {' '}
              Previsão: <strong>{quando}</strong>
            </>
          ) : null}
        </p>
        {capitulo?.antecipadoMembros && (
          <p className="leitor-lancamento-hint">
            Quem tem <strong>membership ativa do autor desta obra</strong> pode ler antes do horário público.
          </p>
        )}
        <button type="button" className="leitor-lancamento-voltar" onClick={onVoltar}>
          Voltar à biblioteca
        </button>
        {creatorSupportEnabled ? (
          <button type="button" className="leitor-lancamento-apoie" onClick={onApoiar}>
            Apoiar a obra
          </button>
        ) : null}
      </div>
    </div>
  );
}
