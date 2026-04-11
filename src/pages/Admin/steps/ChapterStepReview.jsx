import React from 'react';

export default function ChapterStepReview({
  isMangaka,
  checklistPublicacao,
  statusRevisao,
  totalPaginasAtual,
  novasPaginasCount,
  publicReleaseAtInput,
  capaPreviewFinalUrl,
  capaVisualSrc,
  titulo,
  numeroCapitulo,
}) {
  return (
    <div className="editor-step-panel review-panel">
      <h3>{isMangaka ? 'Revisao final do capitulo' : 'Revisao final'}</h3>
      <div className="review-checklist">
        {checklistPublicacao.map((item) => (
          <div key={item.id} className={`review-check-item ${item.ok ? 'ok' : 'pendente'}`}>
            <span>{item.ok ? 'OK' : 'Pendente'}</span>
            <p>Etapa {item.id}: {item.label}</p>
          </div>
        ))}
      </div>
      <div className="review-kpis">
        <span><strong>Status:</strong> {statusRevisao}</span>
        <span><strong>Paginas:</strong> {totalPaginasAtual}</span>
        <span><strong>Novas paginas:</strong> {novasPaginasCount}</span>
        <span><strong>Lancamento:</strong> {publicReleaseAtInput?.trim() || 'Imediato'}</span>
      </div>
      <div className="capa-preview-mask capa-preview-mask--resultado">
        <img
          src={capaPreviewFinalUrl || capaVisualSrc}
        alt="Previa final para revisao"
          className="capa-preview-img capa-preview-img--resultado-main"
        />
        <span className="capa-preview-tag">Prévia final pronta para publicar</span>
      </div>
      <div className="review-mobile-preview">
        <div className="mobile-frame">
          <header>
            <strong>{titulo || 'Titulo do capitulo'}</strong>
            <span>#{String(numeroCapitulo || 0).padStart(2, '0')}</span>
          </header>
          <img
            src={capaPreviewFinalUrl || capaVisualSrc}
            alt="Previa mobile da capa"
          />
          <footer>
            <span>{statusRevisao}</span>
            <button type="button" disabled>Ler agora</button>
          </footer>
        </div>
      </div>
    </div>
  );
}
