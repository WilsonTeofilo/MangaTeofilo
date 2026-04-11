import React from 'react';

export default function ChapterStepCover({
  isMangaka,
  capaEditorRef,
  capaEditavel,
  iniciarArrasteCapa,
  capaVisualSrc,
  capaEditorImageStyle,
  capaCrop,
  capaPreviewFinalUrl,
  capaZoomBounds,
  capaAjuste,
  setCapaAjuste,
  normalizarCapaAjuste,
  capaDimensoes,
}) {
  return (
    <div className="capa-ajuste-bloco">
      <div className="cirurgia-header">
        <div className="cirurgia-info">
          <h3>Ajuste da capa (16:9)</h3>
          <p>{isMangaka ? 'Ajuste a capa que vai aparecer no catalogo e no leitor.' : 'Arraste na imagem e use sliders de ajuste fino. A previa final replica o resultado real.'}</p>
        </div>
      </div>

      <div className="capa-ajuste-grid">
        <div className="capa-preview-frame">
          <div
            ref={capaEditorRef}
            className={`capa-preview-mask capa-preview-mask--editor${capaEditavel ? ' is-editable' : ''}`}
            onMouseDown={iniciarArrasteCapa}
            onTouchStart={iniciarArrasteCapa}
            title={capaEditavel ? 'Clique e arraste para mover o enquadramento' : 'Selecione uma capa para editar'}
          >
            <img
              src={capaVisualSrc}
              alt=""
              aria-hidden="true"
              className="capa-preview-img capa-preview-img--background"
            />
            <img
              src={capaVisualSrc}
              alt={capaEditavel ? 'Previa da capa ajustada' : 'Previa da capa atual'}
              className={`capa-preview-img capa-preview-img--foreground${capaEditavel ? '' : ' capa-preview-img--faded'}`}
              style={capaEditavel ? capaEditorImageStyle : undefined}
            />
            <div className="capa-editor-outside-mask" aria-hidden="true">
              <i style={{ left: 0, top: 0, width: '100%', height: `${capaCrop.topPct}%` }} />
              <i style={{ left: 0, top: `${capaCrop.topPct + capaCrop.heightPct}%`, width: '100%', height: `${capaCrop.topPct}%` }} />
              <i style={{ left: 0, top: `${capaCrop.topPct}%`, width: `${capaCrop.leftPct}%`, height: `${capaCrop.heightPct}%` }} />
              <i style={{ left: `${capaCrop.leftPct + capaCrop.widthPct}%`, top: `${capaCrop.topPct}%`, width: `${capaCrop.leftPct}%`, height: `${capaCrop.heightPct}%` }} />
            </div>
            <div
              className="capa-editor-crop-box"
              aria-hidden="true"
              style={{
                left: `${capaCrop.leftPct}%`,
                top: `${capaCrop.topPct}%`,
                width: `${capaCrop.widthPct}%`,
                height: `${capaCrop.heightPct}%`,
              }}
            />
            <span className="capa-preview-tag">1) Area dentro do quadro = o que vai para a capa</span>
          </div>

          <div className="capa-preview-mask capa-preview-mask--resultado">
            <img
              src={capaPreviewFinalUrl || capaVisualSrc}
              alt="Resultado final da capa"
              className="capa-preview-img capa-preview-img--resultado-main"
            />
            <span className="capa-preview-tag">2) Previa final 16:9 (aba Capitulos)</span>
          </div>
        </div>

        <div className="capa-ajuste-controls">
          <label>
            Zoom ({capaAjuste.zoom.toFixed(2)}x)
            <input
              type="range"
              min={capaZoomBounds.coverZoom || capaZoomBounds.minZoom}
              max={capaZoomBounds.maxZoom}
              step="0.01"
              value={capaAjuste.zoom}
              disabled={!capaEditavel}
              onChange={(e) =>
                setCapaAjuste((prev) => normalizarCapaAjuste({ ...prev, zoom: Number(e.target.value) }, capaDimensoes))
              }
            />
          </label>
          <label>
            Eixo X ({Math.round(capaAjuste.x)}%)
            <input
              type="range"
              min="-100"
              max="100"
              step="1"
              value={capaAjuste.x}
              disabled={!capaEditavel}
              onChange={(e) =>
                setCapaAjuste((prev) => normalizarCapaAjuste({ ...prev, x: Number(e.target.value) }, capaDimensoes))
              }
            />
          </label>
          <label>
            Eixo Y ({Math.round(capaAjuste.y)}%)
            <input
              type="range"
              min="-100"
              max="100"
              step="1"
              value={capaAjuste.y}
              disabled={!capaEditavel}
              onChange={(e) =>
                setCapaAjuste((prev) => normalizarCapaAjuste({ ...prev, y: Number(e.target.value) }, capaDimensoes))
              }
            />
          </label>
          <p className="capa-ajuste-dica">
            Dica: voce pode arrastar direto na imagem para ajustar X/Y.
          </p>
          <button
            type="button"
            className="btn-reset-capa"
            disabled={!capaEditavel}
            onClick={() => setCapaAjuste(normalizarCapaAjuste({}, capaDimensoes))}
          >
            Resetar ajuste
          </button>
        </div>
      </div>
    </div>
  );
}
