import React from 'react';

export default function ObrasList({
  obras,
  isMangaka,
  statusLabelById,
  obraEstaArquivada,
  formatarDataHoraBr,
  editarObra,
  togglePublish,
  apagarObra,
}) {
  return (
    <section className="obras-admin-list">
      <header className="obra-block-head">
        <h2>{isMangaka ? 'Seu catalogo' : 'Obras cadastradas'}</h2>
        <p>
          {isMangaka
            ? 'Edite, publique e acompanhe a evolucao de cada obra sua.'
            : 'Edite, alterne visibilidade e acompanhe atualizacao por obra.'}
        </p>
      </header>
      <div className="obra-list-grid">
        {obras.map((obra) => {
          const statusLinha =
            obra.status === 'draft'
              ? 'Rascunho'
              : `${statusLabelById[obra.status] || 'Em lancamento'} · ${
                  obra.isPublished ? 'Publicado' : 'Oculto'
                }`;

          return (
            <article key={obra.id} className="obra-list-item">
              <img src={obra.capaUrl || '/assets/fotos/shito.jpg'} alt={obra.titulo || obra.id} />
              <div className="obra-list-body">
                <strong>{obra.titulo || obra.id}</strong>
                <span>{obra.slug || obra.id}</span>
                {!isMangaka ? (
                  <span>
                    {obra.authorState === 'linked'
                      ? obra.authorLabel
                      : obra.authorState === 'removed'
                        ? 'Autor removido'
                        : 'Sem autor vinculado'}
                  </span>
                ) : null}
                <span>
                  {statusLinha}
                  {obraEstaArquivada(obra) ? ' · Arquivada' : ''}
                </span>
                <span>
                  Atualizado em {formatarDataHoraBr(obra.updatedAt, { seVazio: 'Sem data' })}
                </span>
              </div>
              <div className="obra-list-actions">
                <button type="button" className="btn-inline" onClick={() => editarObra(obra.id)}>
                  Editar
                </button>
                <button type="button" className="btn-inline" onClick={() => togglePublish(obra)}>
                  {obra.isPublished ? 'Despublicar' : 'Publicar'}
                </button>
                <button type="button" className="btn-inline danger" onClick={() => apagarObra(obra)}>
                  Apagar
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
