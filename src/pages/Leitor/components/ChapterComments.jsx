import React from 'react';
import { Link } from 'react-router-dom';

import { AVATAR_FALLBACK } from '../../../constants';
import { formatUserDisplayWithHandle } from '../../../utils/publicCreatorName';
import { resolvePublicProfileAvatarUrl } from '../../../utils/publicUserProfile';
import { isContaPremium, publicCriadorProfilePath } from '../leitorUtils';

export default function ChapterComments({
  user,
  perfil,
  comentarioTexto,
  onComentarioChange,
  enviando,
  openLoginModal,
  onEnviarComentario,
  listaComentarios,
  comentariosEmThreads,
  filtro,
  onFiltroChange,
  perfisUsuarios,
  onProfileOpen,
  onLikeComment,
  replyingTo,
  setReplyingTo,
  replyDraft,
  onReplyDraftChange,
  replyEnviando,
  onEnviarResposta,
  modalLoginComentario,
  onCloseLoginModal,
  onLoginRedirect,
  privateProfileModal,
  onClosePrivateProfileModal,
}) {
  const renderCommentBranch = (c, depth) => {
    const perfilPublico = perfisUsuarios[c.userId];
    const autorLabel = formatUserDisplayWithHandle(perfilPublico);
    const unifiedPublicPath = publicCriadorProfilePath(perfilPublico, c.userId);
    const isLiked = c.usuariosQueCurtiram?.[user?.uid];
    const isPremium = isContaPremium(c.userId, user, perfil);
    const maxDepth = 8;
    const authorProfileButtonLabel = autorLabel || 'Abrir perfil do comentarista';

    return (
      <div
        key={c.id}
        id={`comentario-${c.id}`}
        className={`comentario comentario--thread${depth > 0 ? ' comentario--resposta' : ''}`}
      >
        <div className="comentario-linha">
          <button
            type="button"
            className="comentario-avatar-btn"
            onClick={() => onProfileOpen(perfilPublico, c.userId)}
            aria-label={authorProfileButtonLabel}
          >
            <img
              src={resolvePublicProfileAvatarUrl(perfilPublico, { fallback: AVATAR_FALLBACK })}
              alt={autorLabel ? `Avatar de ${autorLabel}` : 'Avatar do comentarista'}
              className="avatar-comentario"
              referrerPolicy="no-referrer"
              loading="lazy"
              decoding="async"
              onError={(e) => {
                e.target.src = AVATAR_FALLBACK;
              }}
            />
          </button>
          <div className="comentario-corpo">
            <div className="comentario-header">
              <strong className="comentario-autor">
                {unifiedPublicPath ? (
                  <Link className="comentario-user-link" to={unifiedPublicPath}>
                    {autorLabel}
                  </Link>
                ) : (
                  <button
                    type="button"
                    className="comentario-user-link comentario-user-link--ghost"
                    onClick={() => onProfileOpen(perfilPublico, c.userId)}
                  >
                    {autorLabel}
                  </button>
                )}
              </strong>
              {isPremium ? <span className="premium-crown" title="Membro premium">👑</span> : null}
            </div>
            <p className="comentario-texto">{c.texto}</p>
            <div className="comentario-acoes">
              <button
                type="button"
                className={`btn-like ${isLiked ? 'liked' : ''}`}
                onClick={() => onLikeComment(c.id)}
                title={user ? (isLiked ? 'Remover curtida' : 'Curtir') : 'Faça login para curtir'}
              >
                {isLiked ? '❤' : '♡'} {c.likes || 0}
              </button>
              {user ? (
                <button
                  type="button"
                  className="btn-comentario-responder"
                  onClick={() => {
                    setReplyingTo((prev) => {
                      if (prev?.id === c.id) {
                        onReplyDraftChange('');
                        return null;
                      }
                      onReplyDraftChange('');
                      return {
                        id: c.id,
                        label: autorLabel,
                      };
                    });
                  }}
                >
                  {replyingTo?.id === c.id ? 'Fechar' : 'Responder'}
                </button>
              ) : null}
            </div>
            {replyingTo?.id === c.id ? (
              <div className="comentario-resposta-form">
                <p className="comentario-resposta-para">
                  Respondendo a <strong>{replyingTo.label}</strong>
                </p>
                <textarea
                  value={replyDraft}
                  onChange={(e) => onReplyDraftChange(e.target.value)}
                  placeholder="Escreva sua resposta..."
                  maxLength={500}
                  rows={3}
                  disabled={replyEnviando}
                />
                <div className="comentario-resposta-btns">
                  <button
                    type="button"
                    className="comentario-resposta-cancela"
                    onClick={() => {
                      setReplyingTo(null);
                      onReplyDraftChange('');
                    }}
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    className="comentario-resposta-envia"
                    disabled={!replyDraft.trim() || replyEnviando}
                    onClick={() => onEnviarResposta(c.id)}
                  >
                    {replyEnviando ? 'Enviando...' : 'Publicar resposta'}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
        {c.replies?.length > 0 && depth < maxDepth ? (
          <div className="comentario-filhos">
            {c.replies.map((ch) => renderCommentBranch(ch, depth + 1))}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <>
      <section className="comentarios-section">
        <h2 className="leitor-comentarios-heading">Comentários ({listaComentarios.length})</h2>

        <div className="filtro-comentarios">
          <button
            type="button"
            aria-pressed={filtro === 'relevantes'}
            className={filtro === 'relevantes' ? 'ativo' : ''}
            onClick={() => onFiltroChange('relevantes')}
          >
            Relevantes
          </button>
          <button
            type="button"
            aria-pressed={filtro === 'recentes'}
            className={filtro === 'recentes' ? 'ativo' : ''}
            onClick={() => onFiltroChange('recentes')}
          >
            Recentes
          </button>
        </div>

        <form onSubmit={onEnviarComentario} className="form-comentario">
          {user && (
            <img
              src={
                String(perfil?.userAvatar || '').trim() ||
                String(perfil?.creatorProfile?.avatarUrl || '').trim() ||
                String(user.photoURL || '').trim() ||
                AVATAR_FALLBACK
              }
              alt="Seu avatar"
              className="avatar-comentario"
              referrerPolicy="no-referrer"
              decoding="async"
              onError={(e) => { e.target.src = AVATAR_FALLBACK; }}
            />
          )}
          <div
            className={`input-comentario-wrapper${!user ? ' input-comentario-wrapper--convite' : ''}`}
            onClick={!user ? openLoginModal : undefined}
          >
            <textarea
              value={user ? comentarioTexto : ''}
              onChange={(e) => user && onComentarioChange(e.target.value)}
              placeholder={user ? 'Escreva seu comentário...' : 'Entre na conta para comentar'}
              readOnly={!user}
              disabled={Boolean(user && enviando)}
              maxLength={user ? 500 : undefined}
              onClick={!user ? (e) => { e.stopPropagation(); openLoginModal(); } : undefined}
              onFocus={!user ? openLoginModal : undefined}
              className={!user ? 'textarea-convite-login' : undefined}
            />
            {user && (
              <button type="submit" disabled={!comentarioTexto.trim() || enviando}>
                {enviando ? 'Enviando...' : 'Comentar'}
              </button>
            )}
          </div>
        </form>

        <div className="lista-comentarios">
          {listaComentarios.length === 0 && (
            <p className="sem-comentarios">Seja o primeiro a comentar!</p>
          )}

          {comentariosEmThreads.map((c) => renderCommentBranch(c, 0))}
        </div>
      </section>

      {modalLoginComentario && !user && (
        <div className="leitor-modal-backdrop" onClick={onCloseLoginModal} role="presentation">
          <div
            className="leitor-modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="leitor-modal-login-titulo"
            onClick={(e) => e.stopPropagation()}
          >
            <button type="button" className="leitor-modal-fechar" onClick={onCloseLoginModal} aria-label="Fechar">
              ×
            </button>
            <h2 id="leitor-modal-login-titulo" className="leitor-modal-titulo">
              Comentar na obra
            </h2>
            <p className="leitor-modal-texto">
              Deseja fazer login para comentar?
            </p>
            <div className="leitor-modal-acoes">
              <button
                type="button"
                className="leitor-modal-btn leitor-modal-btn--secundario"
                onClick={onCloseLoginModal}
              >
                Agora não
              </button>
              <button
                type="button"
                className="leitor-modal-btn leitor-modal-btn--primario"
                onClick={onLoginRedirect}
              >
                Sim, entrar
              </button>
            </div>
          </div>
        </div>
      )}

      {privateProfileModal && (
        <div className="leitor-modal-backdrop" onClick={onClosePrivateProfileModal} role="presentation">
          <div
            className="leitor-modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="leitor-modal-private-profile-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="leitor-modal-fechar"
              onClick={onClosePrivateProfileModal}
              aria-label="Fechar"
            >
              ×
            </button>
            <h2 id="leitor-modal-private-profile-title" className="leitor-modal-titulo">
              Perfil privado
            </h2>
            <p className="leitor-modal-texto">
              {privateProfileModal.label} não deixou o card público disponível no momento.
            </p>
            <div className="leitor-modal-acoes">
              <button
                type="button"
                className="leitor-modal-btn leitor-modal-btn--primario"
                onClick={onClosePrivateProfileModal}
              >
                Entendi
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
