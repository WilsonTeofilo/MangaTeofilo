import React from 'react';

export default function ChapterStepOrganize(props) {
  const {
    adminEditMode,
    paginasAdminEditaveis,
    editandoId,
    paginasExistentes,
    isMangaka,
    PaginaCard,
    PaginaSelecionadaCard,
    arquivosPaginas,
    previewsPaginasSelecionadas,
    handleTrocarPaginaUnica,
    handleReordenarPagina,
    handleTrocarPaginaAdminEdicao,
    handleReordenarAdminEdicao,
    handleReordenarSelecionada,
    handleRemoverSelecionada,
    handleRemoverAdminEdicao,
    setErroModal,
    setModalPreview,
  } = props;
  const editandoCapitulo = Boolean(editandoId);
  const totalPaginasEditor = adminEditMode
    ? paginasAdminEditaveis.length
    : paginasExistentes.length + arquivosPaginas.length;
  return (
    <div className="editor-step-panel">
      {editandoCapitulo && totalPaginasEditor > 0 && (
        <div className="cirurgia-paginas">
          <div className="cirurgia-header">
            <div className="cirurgia-info">
              <h3>Paginas do capitulo ({totalPaginasEditor})</h3>
              <p>{isMangaka ? 'Mantenha tudo no mesmo fluxo: revise as paginas atuais, troque trechos e confira as novas sem duplicacao visual.' : 'Visualize as paginas atuais e as novas no mesmo bloco para editar sem confusao.'}</p>
            </div>
          </div>
          <div className="paginas-edit-grid">
            {adminEditMode ? paginasAdminEditaveis.map((item, index) => (
              item.kind === 'existing' ? (
                <PaginaCard
                  key={item.key}
                  index={index}
                  url={item.urlVisual}
                  total={paginasAdminEditaveis.length}
                  badgeLabel={`Pág ${index + 1}`}
                  onTrocar={(file) => handleTrocarPaginaAdminEdicao(index, file)}
                  onReordenar={handleReordenarAdminEdicao}
                  onErro={setErroModal}
                  onVer={() => setModalPreview({ aberto: true, origem: 'admin-edicao', indice: index })}
                />
              ) : (
                <PaginaSelecionadaCard
                  key={item.key}
                  index={index}
                  url={item.urlVisual}
                  nome={item.nomeVisual}
                  total={paginasAdminEditaveis.length}
                  badgeLabel={`Pág ${index + 1}`}
                  onReordenar={handleReordenarAdminEdicao}
                  onRemover={handleRemoverAdminEdicao}
                  onErro={setErroModal}
                  onVer={() => setModalPreview({ aberto: true, origem: 'admin-edicao', indice: index })}
                />
              )
            )) : (
              <>
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
              </>
            )}
          </div>
        </div>
      )}

      {!editandoCapitulo && (
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
      )}
    </div>
  );
}
