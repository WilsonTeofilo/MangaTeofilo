import React from 'react';
import {
  DESCRIPTION_MAX,
  DESCRIPTION_MIN,
  MAX_GENRES,
  OBRAS_WORK_GENRE_IDS,
  OBRAS_WORK_GENRE_LABELS,
  OBRAS_WORK_STATUS,
  SEO_TITLE_MAX,
  buildSeoDescriptionFromDescription,
} from '../../../config/obraWorkForm';
import { normalizarObraId } from '../../../config/obras';
import ObrasMediaEditor from './ObrasMediaEditor';

export default function ObrasEditor({
  obras,
  obraSelecionadaId,
  setObraSelecionadaId,
  carregarObraSelecionada,
  iniciarNovo,
  editandoId,
  form,
  setForm,
  validationLive,
  saveAttempted,
  isMangaka,
  creatorLookupInput,
  handleCreatorLookupChange,
  creatorDirectory,
  formatCreatorLookupOption,
  resolvedCreatorLookup,
  creatorLookupMatches,
  creatorNeedsSelection,
  creatorWorkspaceProfile,
  onTituloChange,
  slugPreview,
  toggleGenre,
  preview,
  statusLabelById,
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
  salvarObra,
  saving,
  user,
  apagarObra,
}) {
  return (
    <div className="obras-admin-form">
      <section className="obra-block obra-editor-mode">
        <header className="obra-block-head">
          <h2>{isMangaka ? 'Escolha uma obra para continuar' : 'Selecionar obra para edicao'}</h2>
          <p>
            {isMangaka
              ? 'Abra uma obra existente para continuar o trabalho ou comece uma nova sem perder o que ja existe.'
              : 'Escolha uma obra existente para editar, ou inicie uma nova sem sobrescrever.'}
          </p>
        </header>
        <div className="obra-editor-mode-row">
          <label>
            Obra cadastrada
            <select value={obraSelecionadaId} onChange={(e) => setObraSelecionadaId(String(e.target.value || ''))}>
              <option value="">Selecione uma obra para editar</option>
              {obras.map((obra) => (
                <option key={obra.id} value={obra.id}>
                  {obra.tituloCurto || obra.titulo || obra.id}
                </option>
              ))}
            </select>
          </label>
          <div className="obra-editor-mode-actions">
            <button type="button" className="btn-sec" onClick={carregarObraSelecionada}>
              Editar selecionada
            </button>
            <button type="button" className="btn-pri" onClick={iniciarNovo}>
              Criar nova obra
            </button>
          </div>
        </div>
        <p className={`obra-editor-mode-status ${editandoId ? 'is-editing' : 'is-creating'}`}>
          {editandoId
            ? `Modo atual: editando "${form.titulo || editandoId}"`
            : isMangaka
              ? 'Modo atual: preparando uma nova obra para seu catalogo'
              : 'Modo atual: criando nova obra'}
        </p>
      </section>

      <section className="obra-block">
        <header className="obra-block-head">
          <h2>Informacoes basicas</h2>
          <p>{isMangaka ? 'Defina como sua obra vai aparecer para os leitores.' : 'Defina a identidade principal da obra.'}</p>
        </header>
        {!validationLive.ok && validationLive.errors.length > 0 ? (
          <ul
            className="obra-validation-errors"
            aria-live={saveAttempted ? 'assertive' : 'polite'}
            data-save-attempted={saveAttempted ? 'true' : 'false'}
          >
            {validationLive.errors.map((msg) => (
              <li key={msg}>{msg}</li>
            ))}
          </ul>
        ) : null}
        {!isMangaka ? (
          <label className="obra-field-full">
            Autor da obra{!editandoId ? ' *' : ''}
            <input
              type="text"
              list="obra-creator-options"
              autoComplete="off"
              value={creatorLookupInput}
              onChange={(e) => handleCreatorLookupChange(e.target.value)}
              placeholder="Digite o @username do autor"
            />
            <datalist id="obra-creator-options">
              {creatorDirectory.map((entry) => (
                <option key={entry.uid} value={formatCreatorLookupOption(entry)} />
              ))}
            </datalist>
            <small className="field-help">
              {!editandoId
                ? 'Busque por @username ou UID. Se quiser publicar como admin sem autor vinculado, deixe o campo vazio.'
                : 'Voce pode reatribuir a obra buscando por @username ou UID do autor, ou limpar o campo para deixar sem autor vinculado.'}
            </small>
            {resolvedCreatorLookup ? (
              <div className="obra-author-preview" role="status" aria-live="polite">
                <img
                  className="obra-author-preview__avatar"
                  src={resolvedCreatorLookup.avatarUrl || '/assets/fotos/shito.jpg'}
                  alt={resolvedCreatorLookup.displayName || resolvedCreatorLookup.handle || 'Autor selecionado'}
                />
                <div className="obra-author-preview__meta">
                  <strong>{resolvedCreatorLookup.displayName || 'Autor selecionado'}</strong>
                  <span>{resolvedCreatorLookup.handle ? '@' + resolvedCreatorLookup.handle : 'Sem @username publico'}</span>
                  <small>{resolvedCreatorLookup.isCreator ? 'Perfil de creator ativo' : 'Conta encontrada no diretorio'}</small>
                </div>
              </div>
            ) : creatorLookupInput.trim() && creatorLookupMatches.length > 1 ? (
              <small className="field-help">
                Encontramos {creatorLookupMatches.length} autores parecidos. Continue digitando ou escolha um resultado da lista
                para vincular a obra no autor certo.
              </small>
            ) : creatorLookupInput.trim() && creatorLookupInput.trim().length < 3 ? (
              <small className="field-help">
                Digite pelo menos 3 caracteres do @username, ou cole o UID completo do autor.
              </small>
            ) : creatorNeedsSelection && saveAttempted ? (
              <small className="field-help" style={{ color: '#ffb3b3' }}>
                Nenhum autor correspondente foi encontrado. Revise o @username ou UID antes de salvar.
              </small>
            ) : creatorNeedsSelection ? (
              <small className="field-help">
                Ainda nao encontramos um autor com esse texto. Continue digitando ou escolha um resultado valido antes de salvar.
              </small>
            ) : form.adminCreatorId ? (
              <small className="field-help" style={{ color: '#ffb3b3' }}>
                O autor atual desta obra nao foi resolvido no diretorio. Reselecione um autor antes de salvar.
              </small>
            ) : null}
          </label>
        ) : null}
        {isMangaka ? (
          <div className="obra-author-preview obra-field-full" role="status" aria-live="polite" style={{ marginBottom: '12px' }}>
            <img
              className="obra-author-preview__avatar"
              src={creatorWorkspaceProfile?.avatarUrl || '/assets/fotos/shito.jpg'}
              alt={creatorWorkspaceProfile?.displayName || creatorWorkspaceProfile?.handle || 'Autor vinculado'}
            />
            <div className="obra-author-preview__meta">
              <strong>{creatorWorkspaceProfile?.displayName || 'Autor vinculado'}</strong>
              <span>
                {creatorWorkspaceProfile?.handle
                  ? '@' + creatorWorkspaceProfile.handle
                  : 'Sem @username publico'}
              </span>
              <small>Autor vinculado: sua conta. O vinculo tecnico continua salvo so internamente.</small>
            </div>
          </div>
        ) : null}
        <div className="obra-grid">
          <label>
            Titulo *
            <input
              type="text"
              value={form.titulo}
              maxLength={80}
              onChange={(e) => onTituloChange(e.target.value)}
              placeholder="Nome oficial da obra"
            />
            <small className="field-help">{form.titulo.trim().length}/80 · min. 3 caracteres</small>
          </label>
          <label>
            Titulo curto (opcional)
            <input
              type="text"
              value={form.tituloCurto}
              maxLength={40}
              onChange={(e) => setForm((p) => ({ ...p, tituloCurto: e.target.value }))}
              placeholder="Ex: KOKUIN"
            />
          </label>
        </div>
        <div className="obra-slug-preview obra-field-full">
          <span className="obra-slug-preview-label">Slug na URL (automatico, nao editavel)</span>
          <code className="obra-slug-preview-value">/work/{slugPreview}</code>
          <small className="field-help">
            Novas obras usam este identificador como chave no banco. Ao editar, a chave permanece estavel; o campo <code>slug</code> no registro acompanha o titulo para SEO.
          </small>
        </div>
        <fieldset className="obra-genres-fieldset obra-field-full">
          <legend>Generos * (ate {MAX_GENRES})</legend>
          <p className="field-help">Selecione ate tres. O genero principal deve estar entre eles.</p>
          <div className="obra-genre-chips" role="group" aria-label="Generos da obra">
            {OBRAS_WORK_GENRE_IDS.map((gid) => {
              const on = form.genres.includes(gid);
              return (
                <button
                  key={gid}
                  type="button"
                  className={`obra-genre-chip${on ? ' is-on' : ''}`}
                  onClick={() => toggleGenre(gid)}
                  aria-pressed={on}
                >
                  {OBRAS_WORK_GENRE_LABELS[gid] || gid}
                </button>
              );
            })}
          </div>
        </fieldset>
        <div className="obra-grid">
          <label>
            Genero principal *
            <select
              value={form.mainGenre}
              onChange={(e) => setForm((p) => ({ ...p, mainGenre: e.target.value }))}
              disabled={form.genres.length === 0}
            >
              <option value="">{form.genres.length ? 'Escolha entre os generos selecionados' : 'Selecione generos acima'}</option>
              {form.genres.map((gid) => (
                <option key={gid} value={gid}>
                  {OBRAS_WORK_GENRE_LABELS[gid] || gid}
                </option>
              ))}
            </select>
          </label>
          <label>
            Tags (opcional, max. 5, separadas por virgula)
            <input
              type="text"
              value={form.tagsRaw}
              onChange={(e) => setForm((p) => ({ ...p, tagsRaw: e.target.value }))}
              placeholder="ex: magia, escola, amizade"
            />
            <small className="field-help">Normalizadas em minusculas, sem duplicar.</small>
          </label>
        </div>
        <label className="obra-field-full">
          Descricao (sinopse) *
          <textarea
            value={form.sinopse}
            maxLength={DESCRIPTION_MAX}
            onChange={(e) => setForm((p) => ({ ...p, sinopse: e.target.value }))}
            rows={5}
            placeholder={`Resumo da obra para leitores (min. ${DESCRIPTION_MIN} caracteres)`}
          />
          <small className="field-help">
            {form.sinopse.trim().length}/{DESCRIPTION_MAX} · minimo {DESCRIPTION_MIN} caracteres
          </small>
        </label>
      </section>

      <ObrasMediaEditor
        isMangaka={isMangaka}
        form={form}
        setForm={setForm}
        selecionarCapa={selecionarCapa}
        selecionarBanner={selecionarBanner}
        capaEditorRef={capaEditorRef}
        bannerEditorRef={bannerEditorRef}
        capaEditavel={capaEditavel}
        bannerEditavel={bannerEditavel}
        iniciarArrasteMidia={iniciarArrasteMidia}
        capaPreviewUrl={capaPreviewUrl}
        bannerPreviewUrl={bannerPreviewUrl}
        coverCrop={coverCrop}
        bannerCrop={bannerCrop}
        capaEditorImageStyle={capaEditorImageStyle}
        bannerEditorImageStyle={bannerEditorImageStyle}
        capaZoomBounds={capaZoomBounds}
        bannerZoomBounds={bannerZoomBounds}
        capaAjuste={capaAjuste}
        bannerAjuste={bannerAjuste}
        setCapaAjuste={setCapaAjuste}
        setBannerAjuste={setBannerAjuste}
        capaDimensoes={capaDimensoes}
        bannerDimensoes={bannerDimensoes}
        normalizarAjusteObra={normalizarAjusteObra}
        coverEditorConfig={coverEditorConfig}
        bannerEditorConfig={bannerEditorConfig}
        preview={preview}
        statusLabelById={statusLabelById}
        genreLabels={OBRAS_WORK_GENRE_LABELS}
      />

      <section className="obra-block">
        <header className="obra-block-head">
          <h2>SEO</h2>
          <p>Titulo e palavras-chave voce controla; o resumo para busca e gerado a partir da descricao (max. 160 caracteres).</p>
        </header>
        <div className="obra-grid">
          <label>
            Titulo que aparece no Google
            <input
              type="text"
              value={form.seoTitle}
              maxLength={SEO_TITLE_MAX}
              onChange={(e) => setForm((p) => ({ ...p, seoTitle: e.target.value }))}
              placeholder="Ex: Kokuin - Manga brasileiro de fantasia sombria"
            />
            <small className="field-help">{form.seoTitle.length}/{SEO_TITLE_MAX}</small>
          </label>
          <label>
            Palavras-chave (opcional; senao usamos as tags)
            <input
              type="text"
              value={form.seoKeywords}
              onChange={(e) => setForm((p) => ({ ...p, seoKeywords: e.target.value }))}
              placeholder="manga brasileiro, fantasia, acao, kokuin"
            />
          </label>
        </div>
        <div className="obra-seo-readonly obra-field-full">
          <span className="obra-seo-readonly-label">Resumo para Google (automatico)</span>
          <p className="obra-seo-readonly-text">{buildSeoDescriptionFromDescription(form.sinopse) || '—'}</p>
          <small className="field-help">
            {buildSeoDescriptionFromDescription(form.sinopse).length}/160 caracteres
          </small>
        </div>
        <p className="seo-help">
          Dica: na descricao, explique genero e gancho da historia — isso alimenta o snippet de busca.
        </p>
      </section>

      <section className="obra-block">
        <header className="obra-block-head">
          <h2>Status e visibilidade</h2>
          <p>{isMangaka ? 'Controle quando sua obra fica pronta para aparecer no catalogo.' : 'Controle estagio editorial e publicacao para o catalogo.'}</p>
        </header>
        <div className="obra-grid">
          <label>
            Status da obra
            <select
              value={form.status}
              onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))}
            >
              {OBRAS_WORK_STATUS.map((op) => (
                <option key={op.id} value={op.id}>{op.label}</option>
              ))}
            </select>
          </label>
          <label className="check-line">
            <input
              type="checkbox"
              checked={Boolean(form.isPublished)}
              onChange={(e) => setForm((p) => ({ ...p, isPublished: e.target.checked }))}
            />
            Publicada (visivel para usuarios)
          </label>
          <label className="check-line">
            <input
              type="checkbox"
              checked={Boolean(form.archived)}
              onChange={(e) => setForm((p) => ({ ...p, archived: e.target.checked }))}
            />
            Arquivada (fora do catalogo publico; voce e a equipe ainda veem no painel)
          </label>
        </div>
      </section>

      <div className="obra-form-actions">
        <button
          type="button"
          className="btn-pri"
          disabled={saving}
          onClick={() => salvarObra()}
        >
          {saving ? 'Salvando...' : editandoId ? 'Salvar alteracoes' : 'Criar obra'}
        </button>
        <button
          type="button"
          className="btn-sec"
          disabled={saving}
          onClick={() => salvarObra({ asDraft: true })}
        >
          {saving ? 'Salvando...' : 'Salvar rascunho'}
        </button>
        <button type="button" className="btn-sec" onClick={iniciarNovo}>Limpar</button>
        {editandoId ? (
          <button
            type="button"
            className="btn-inline danger"
            onClick={() => apagarObra(
              obras.find((obra) => normalizarObraId(obra.id) === normalizarObraId(editandoId))
              || { id: editandoId, titulo: form.titulo || editandoId, creatorId: form.creatorId || user?.uid || '' }
            )}
          >
            Apagar obra
          </button>
        ) : null}
      </div>
    </div>
  );
}
