import React from 'react';

export default function ChapterStepOrganize({
  editandoId,
  paginasExistentes,
  isMangaka,
  PaginaCard,
  PaginaSelecionadaCard,
  arquivosPaginas,
  previewsPaginasSelecionadas,
  handleTrocarPaginaUnica,
  handleReordenarPagina,
  handleReordenarSelecionada,
  handleRemoverSelecionada,
  setErroModal,
  setModalPreview,
}) {
  return (
    <div className="editor-step-panel">
      {editandoId && paginasExistentes.length > 0 && (
        <div className="cirurgia-paginas">
          <div className="cirurgia-header">
            <div className="cirurgia-info">
              <h3>Paginas atuais ({paginasExistentes.length})</h3>
              <p>{isMangaka ? 'Reordene paginas, revise e troque trechos sem perder o fluxo.' : 'Arraste para reordenar, visualize em modal e troque paginas pontuais.'}</p>
            </div>
          </div>
          <div className="paginas-edit-grid">
            {paginasExistentes.map((url, index) => (
              <PaginaCard
                key={`${editandoId}-${url}`}
                index={index}
                url={url}
                total={paginasExistentes.length}
                onTrocar={(file) => handleTrocarPaginaUnica(index, file)}
                onReordenar={handleReordenarPagina}
                onErro={setErroModal}
                onVer={() => setModalPreview({ aberto: true, origem: 'atuais', indice: index })}
              />
            ))}
          </div>
        </div>
      )}

      <div className="cirurgia-paginas">
        <div className="cirurgia-header">
          <div className="cirurgia-info">
            <h3>Pre-visualizacao das novas paginas ({arquivosPaginas.length})</h3>
            <p>{isMangaka ? 'Confira as novas paginas antes de publicar.' : 'Cards com thumbnail, preview em modal, remocao e reorder por arraste.'}</p>
          </div>
        </div>
        {arquivosPaginas.length > 0 ? (
          <div className="paginas-edit-grid">
            {previewsPaginasSelecionadas.map((preview, index) => (
              <PaginaSelecionadaCard
                key={preview.key}
                index={index}
                url={preview.url}
                nome={preview.nome}
                total={previewsPaginasSelecionadas.length}
                onReordenar={handleReordenarSelecionada}
                onRemover={handleRemoverSelecionada}
                onErro={setErroModal}
                onVer={() => setModalPreview({ aberto: true, origem: 'novas', indice: index })}
              />
            ))}
          </div>
        ) : (
          <p className="editor-empty">Nenhuma nova pagina selecionada ainda.</p>
        )}
      </div>
    </div>
  );
}
