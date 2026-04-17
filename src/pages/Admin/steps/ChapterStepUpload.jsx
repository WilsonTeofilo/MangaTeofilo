import React from 'react';

export default function ChapterStepUpload({
  dragUploadAtivo,
  setDragUploadAtivo,
  handleSelecionarArquivosPaginas,
  isMangaka,
  capaFileLabel,
  paginasFileLabel,
  handleSelecionarCapa,
}) {
  return (
    <div className="editor-step-panel">
      <div
        className={`upload-dropzone${dragUploadAtivo ? ' is-active' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragUploadAtivo(true);
        }}
        onDragLeave={() => setDragUploadAtivo(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragUploadAtivo(false);
          handleSelecionarArquivosPaginas(e.dataTransfer.files);
        }}
      >
        <h3>Envie as páginas do capítulo</h3>
        <p>{isMangaka ? 'Arraste páginas aqui para montar seu capítulo.' : 'Arraste e solte imagens aqui, ou use o seletor abaixo.'}</p>
      </div>
      <div className="file-inputs">
        <label className="admin-capa-file-label">
          <span className="admin-capa-file-label__text">Capa do capítulo</span>
          {capaFileLabel ? (
            <span className="admin-capa-file-name" title={capaFileLabel}>
              {capaFileLabel}
            </span>
          ) : (
            <span className="admin-capa-file-name admin-capa-file-name--empty">Nenhum arquivo selecionado</span>
          )}
          <input
            type="file"
            accept="image/jpeg,image/jpg,image/png,image/webp"
            onChange={(e) => {
              handleSelecionarCapa(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
        <label className="admin-capa-file-label">
          <span className="admin-capa-file-label__text">Páginas (múltiplas)</span>
          {paginasFileLabel ? (
            <span className="admin-capa-file-name" title={paginasFileLabel}>
              {paginasFileLabel}
            </span>
          ) : (
            <span className="admin-capa-file-name admin-capa-file-name--empty">
              Nenhuma página selecionada
            </span>
          )}
          <input
            type="file"
            multiple
            accept="image/jpeg,image/jpg,image/png,image/webp"
            onChange={(e) => {
              handleSelecionarArquivosPaginas(e.target.files);
              e.target.value = '';
            }}
          />
        </label>
      </div>
    </div>
  );
}
