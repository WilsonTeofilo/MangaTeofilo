import React from 'react';

export default function ObrasMediaEditor({
  isMangaka,
  form,
  selecionarCapa,
  selecionarBanner,
  capaEditorRef,
  bannerEditorRef,
  capaEditavel,
  bannerEditavel,
  iniciarArrasteMidia,
  capaPreviewUrl,
  bannerPreviewUrl,
  coverCrop,
  bannerCrop,
  capaEditorImageStyle,
  bannerEditorImageStyle,
  capaZoomBounds,
  bannerZoomBounds,
  capaAjuste,
  bannerAjuste,
  setCapaAjuste,
  setBannerAjuste,
  capaDimensoes,
  bannerDimensoes,
  normalizarAjusteObra,
  coverEditorConfig,
  bannerEditorConfig,
  preview,
  statusLabelById,
  genreLabels,
  setForm,
}) {
  return (
    <section className="obra-block">
      <header className="obra-block-head">
        <h2>Midia</h2>
        <p>{isMangaka ? 'Suba capa e banner com enquadramento pronto para sua pagina publica.' : 'Faca upload da capa/banner e ajuste enquadramento antes de salvar.'}</p>
      </header>
      <div className="obra-media-grid">
        <div className="obra-media-card">
          <h3>Capa (3:4)</h3>
          <input type="file" accept="image/jpeg,image/jpg,image/png,image/webp" onChange={(e) => selecionarCapa(e.target.files?.[0])} />
          <small className="field-help">
            JPG, PNG ou WebP · arquivo ate 1,2 MB · na publicacao vira WebP comprimido (~ate 500 KB)
          </small>
          <div
            ref={capaEditorRef}
            className={`obra-editor-mask obra-editor-mask--cover${capaEditavel ? ' is-editable' : ''}`}
            onMouseDown={(e) => iniciarArrasteMidia(e, 'capa')}
            onTouchStart={(e) => iniciarArrasteMidia(e, 'capa')}
            title={capaEditavel ? 'Arraste para ajustar o enquadramento da capa' : 'Envie uma capa para editar'}
          >
            <img
              src={capaPreviewUrl || form.capaUrl || '/assets/fotos/shito.jpg'}
              alt=""
              aria-hidden="true"
              className="obra-editor-img obra-editor-img--background"
            />
            <img
              src={capaPreviewUrl || form.capaUrl || '/assets/fotos/shito.jpg'}
              alt="Editor da capa"
              className="obra-editor-img obra-editor-img--foreground"
              style={capaEditavel ? capaEditorImageStyle : undefined}
            />
            <div className="obra-editor-outside-mask" aria-hidden="true">
              <i style={{ left: 0, top: 0, width: '100%', height: `${coverCrop.topPct}%` }} />
              <i style={{ left: 0, top: `${coverCrop.topPct + coverCrop.heightPct}%`, width: '100%', height: `${coverCrop.topPct}%` }} />
              <i style={{ left: 0, top: `${coverCrop.topPct}%`, width: `${coverCrop.leftPct}%`, height: `${coverCrop.heightPct}%` }} />
              <i style={{ left: `${coverCrop.leftPct + coverCrop.widthPct}%`, top: `${coverCrop.topPct}%`, width: `${coverCrop.leftPct}%`, height: `${coverCrop.heightPct}%` }} />
            </div>
            <div
              className="obra-editor-crop-box"
              style={{
                left: `${coverCrop.leftPct}%`,
                top: `${coverCrop.topPct}%`,
                width: `${coverCrop.widthPct}%`,
                height: `${coverCrop.heightPct}%`,
              }}
            />
          </div>
          <div className="obra-media-controls">
            <label>Zoom
              <input type="range" min={capaZoomBounds.coverZoom || capaZoomBounds.minZoom} max={capaZoomBounds.maxZoom} step="0.01" value={capaAjuste.zoom} disabled={!capaEditavel} onChange={(e) => setCapaAjuste((p) => normalizarAjusteObra({ ...p, zoom: Number(e.target.value) }, capaDimensoes, coverEditorConfig))} />
            </label>
            <label>Eixo X
              <input type="range" min="-100" max="100" step="1" value={capaAjuste.x} disabled={!capaEditavel} onChange={(e) => setCapaAjuste((p) => normalizarAjusteObra({ ...p, x: Number(e.target.value) }, capaDimensoes, coverEditorConfig))} />
            </label>
            <label>Eixo Y
              <input type="range" min="-100" max="100" step="1" value={capaAjuste.y} disabled={!capaEditavel} onChange={(e) => setCapaAjuste((p) => normalizarAjusteObra({ ...p, y: Number(e.target.value) }, capaDimensoes, coverEditorConfig))} />
            </label>
          </div>
          <details>
            <summary>URL manual da plataforma (opcional)</summary>
            <input
              type="url"
              value={form.capaUrl}
              onChange={(e) => setForm((p) => ({ ...p, capaUrl: e.target.value }))}
              placeholder="Cole apenas uma URL do Storage da plataforma"
            />
            <small className="field-help">
              Links externos foram bloqueados para evitar tracker e troca de arquivo fora da plataforma.
            </small>
          </details>
        </div>
        <div className="obra-media-card">
          <h3>Banner (16:9)</h3>
          <input type="file" accept="image/jpeg,image/jpg,image/png,image/webp" onChange={(e) => selecionarBanner(e.target.files?.[0])} />
          <small className="field-help">
            JPG, PNG ou WebP · arquivo ate 1,2 MB · na publicacao vira WebP comprimido (~ate 500 KB)
          </small>
          <div
            ref={bannerEditorRef}
            className={`obra-editor-mask obra-editor-mask--banner${bannerEditavel ? ' is-editable' : ''}`}
            onMouseDown={(e) => iniciarArrasteMidia(e, 'banner')}
            onTouchStart={(e) => iniciarArrasteMidia(e, 'banner')}
            title={bannerEditavel ? 'Arraste para ajustar o enquadramento do banner' : 'Envie um banner para editar'}
          >
            <img
              src={bannerPreviewUrl || form.bannerUrl || '/assets/fotos/shito.jpg'}
              alt=""
              aria-hidden="true"
              className="obra-editor-img obra-editor-img--background"
            />
            <img
              src={bannerPreviewUrl || form.bannerUrl || '/assets/fotos/shito.jpg'}
              alt="Editor do banner"
              className="obra-editor-img obra-editor-img--foreground"
              style={bannerEditavel ? bannerEditorImageStyle : undefined}
            />
            <div className="obra-editor-outside-mask" aria-hidden="true">
              <i style={{ left: 0, top: 0, width: '100%', height: `${bannerCrop.topPct}%` }} />
              <i style={{ left: 0, top: `${bannerCrop.topPct + bannerCrop.heightPct}%`, width: '100%', height: `${bannerCrop.topPct}%` }} />
              <i style={{ left: 0, top: `${bannerCrop.topPct}%`, width: `${bannerCrop.leftPct}%`, height: `${bannerCrop.heightPct}%` }} />
              <i style={{ left: `${bannerCrop.leftPct + bannerCrop.widthPct}%`, top: `${bannerCrop.topPct}%`, width: `${bannerCrop.leftPct}%`, height: `${bannerCrop.heightPct}%` }} />
            </div>
            <div
              className="obra-editor-crop-box"
              style={{
                left: `${bannerCrop.leftPct}%`,
                top: `${bannerCrop.topPct}%`,
                width: `${bannerCrop.widthPct}%`,
                height: `${bannerCrop.heightPct}%`,
              }}
            />
          </div>
          <div className="obra-media-controls">
            <label>Zoom
              <input type="range" min={bannerZoomBounds.coverZoom || bannerZoomBounds.minZoom} max={bannerZoomBounds.maxZoom} step="0.01" value={bannerAjuste.zoom} disabled={!bannerEditavel} onChange={(e) => setBannerAjuste((p) => normalizarAjusteObra({ ...p, zoom: Number(e.target.value) }, bannerDimensoes, bannerEditorConfig))} />
            </label>
            <label>Eixo X
              <input type="range" min="-100" max="100" step="1" value={bannerAjuste.x} disabled={!bannerEditavel} onChange={(e) => setBannerAjuste((p) => normalizarAjusteObra({ ...p, x: Number(e.target.value) }, bannerDimensoes, bannerEditorConfig))} />
            </label>
            <label>Eixo Y
              <input type="range" min="-100" max="100" step="1" value={bannerAjuste.y} disabled={!bannerEditavel} onChange={(e) => setBannerAjuste((p) => normalizarAjusteObra({ ...p, y: Number(e.target.value) }, bannerDimensoes, bannerEditorConfig))} />
            </label>
          </div>
          <details>
            <summary>URL manual da plataforma (opcional)</summary>
            <input
              type="url"
              value={form.bannerUrl}
              onChange={(e) => setForm((p) => ({ ...p, bannerUrl: e.target.value }))}
              placeholder="Cole apenas uma URL do Storage da plataforma"
            />
            <small className="field-help">
              Links externos foram bloqueados para evitar tracker e troca de arquivo fora da plataforma.
            </small>
          </details>
        </div>
        <aside className="obra-preview obra-preview--in-media">
          <header className="obra-block-head">
            <h2>Preview em tempo real</h2>
            <p>{isMangaka ? 'Veja como os leitores vao encontrar sua obra no site.' : 'Simulacao de exibicao da obra no site.'}</p>
          </header>
          <div
            className="obra-preview-banner"
            style={{ backgroundImage: `linear-gradient(180deg, rgba(8,12,20,0.2), rgba(8,12,20,0.9)), url('${preview.bannerUrl}')` }}
          >
            <span className={`preview-pill ${preview.isPublished ? 'on' : 'off'}`}>
              {preview.isPublished ? 'Publicado' : 'Oculto'}
            </span>
          </div>
          <div className="obra-preview-card">
            <img src={preview.capaUrl} alt={preview.titulo} />
            <div className="obra-preview-card-body">
              <strong>{preview.tituloCurto}</strong>
              <p>{preview.sinopse}</p>
              {preview.genres.length > 0 ? (
                <span className="preview-genres">
                  {preview.genres.map((g) => (
                    <span key={g} className="preview-genre-pill">{genreLabels[g] || g}</span>
                  ))}
                </span>
              ) : null}
              <span className="preview-meta">
                {statusLabelById[preview.status] || 'Em lancamento'}
              </span>
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}
