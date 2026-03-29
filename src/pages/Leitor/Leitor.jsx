import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ref, onValue, push, set, get, runTransaction, serverTimestamp, update } from 'firebase/database';

import { db } from '../../services/firebase';
import { AVATAR_FALLBACK } from '../../constants';
import LoadingScreen from '../../components/LoadingScreen';
import './Leitor.css';

const isContaPremium = (perfil) => {
  const tipo = String(perfil?.accountType ?? 'comum').toLowerCase();
  if (tipo === 'admin') return false;
  return tipo === 'membro' || tipo === 'premium';
};

export default function Leitor({ user }) {
  const { id }   = useParams();
  const navigate = useNavigate();

  const [capitulo, setCapitulo]            = useState(null);
  const [carregando, setCarregando]        = useState(true);
  const [comentarioTexto, setComentario]   = useState('');
  const [listaComentarios, setComentarios] = useState([]);
  const [perfisUsuarios, setPerfis]        = useState({});
  const [filtro, setFiltro]                = useState('relevantes');
  const [enviando, setEnviando]            = useState(false);

  const [modoLeitura, setModoLeitura] = useState(
    () => localStorage.getItem('modoLeitura') || 'vertical'
  );
  const [zoom, setZoom] = useState(
    () => Number(localStorage.getItem('zoom')) || 100
  );
  const [paginaAtual, setPaginaAtual]     = useState(0);
  const [mostrarConfig, setMostrarConfig] = useState(false);
  const [modalLoginComentario, setModalLoginComentario] = useState(false);

  const touchStartX          = useRef(0);
  const touchEndX            = useRef(0);
  const unsubPerfis          = useRef({});
  const jaContouVisualizacao = useRef(false);

  useEffect(() => { localStorage.setItem('modoLeitura', modoLeitura); }, [modoLeitura]);
  useEffect(() => { localStorage.setItem('zoom', zoom); }, [zoom]);

  useEffect(() => {
    if (user) setModalLoginComentario(false);
  }, [user]);

  useEffect(() => {
    if (!modalLoginComentario) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setModalLoginComentario(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modalLoginComentario]);

  // ✅ Lê de usuarios_publicos (.read = true nas rules)
  // Qualquer visitante, logado ou não, consegue ver nome e avatar
  const escutarPerfil = useCallback((uid) => {
    if (!uid || unsubPerfis.current[uid]) return;
    const unsub = onValue(
      ref(db, `usuarios_publicos/${uid}`),
      (snap) => {
        if (snap.exists()) {
          setPerfis((prev) => ({ ...prev, [uid]: snap.val() }));
        }
      }
    );
    unsubPerfis.current[uid] = unsub;
  }, []);

  useEffect(() => {
    if (!jaContouVisualizacao.current) {
      runTransaction(ref(db, `capitulos/${id}/visualizacoes`), (v) => (v || 0) + 1);
      jaContouVisualizacao.current = true;
    }

    const unsub = onValue(ref(db, `capitulos/${id}`), (snap) => {
      if (!snap.exists()) {
        setCapitulo(null);
        setCarregando(false);
        return;
      }
      const dados = snap.val();
      setCapitulo(dados);

      if (dados.comentarios) {
        const lista = Object.keys(dados.comentarios).map((key) => ({
          id: key,
          ...dados.comentarios[key],
        }));
        setComentarios(lista);
        lista.forEach((c) => { if (c.userId) escutarPerfil(c.userId); });
      } else {
        setComentarios([]);
      }
      setCarregando(false);
    });

    return () => {
      unsub();
      Object.values(unsubPerfis.current).forEach((u) => u?.());
      unsubPerfis.current = {};
    };
  }, [id, escutarPerfil]);

  // ✅ Sincroniza perfil público ANTES de comentar
  // Garante que todos os visitantes verão o avatar e nome atualizados
  const sincronizarPerfilPublico = async (usuario) => {
    if (!usuario) return;
    try {
      const tipoSnap = await get(ref(db, `usuarios/${usuario.uid}/accountType`));
      const tipoRaw = tipoSnap.exists() ? String(tipoSnap.val() ?? 'comum').toLowerCase() : 'comum';
      const accountTypePub = ['comum', 'membro', 'premium', 'admin'].includes(tipoRaw)
        ? tipoRaw
        : 'comum';
      await update(ref(db, `usuarios_publicos/${usuario.uid}`), {
        uid:         usuario.uid,
        userName:    usuario.displayName || 'Guerreiro',
        userAvatar:  usuario.photoURL    || AVATAR_FALLBACK,
        accountType: accountTypePub,
        updatedAt:   Date.now(),
      });
    } catch (err) {
      console.warn('Aviso: não foi possível sincronizar perfil público.', err.message);
    }
  };

  const totalPaginas = capitulo?.paginas?.length || 0;
  const irProxima  = () => setPaginaAtual((p) => Math.min(p + 1, totalPaginas - 1));
  const irAnterior = () => setPaginaAtual((p) => Math.max(p - 1, 0));

  useEffect(() => {
    const handleKey = (e) => {
      if (modoLeitura !== 'horizontal') return;
      if (e.key === 'ArrowRight') irProxima();
      if (e.key === 'ArrowLeft')  irAnterior();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [modoLeitura, totalPaginas]);

  const handleTouchStart = (e) => { touchStartX.current = e.changedTouches[0].screenX; };
  const handleTouchMove  = (e) => { touchEndX.current   = e.changedTouches[0].screenX; };
  const handleTouchEnd   = () => {
    const dist = touchStartX.current - touchEndX.current;
    if (dist >  50) irProxima();
    if (dist < -50) irAnterior();
  };

  const abrirModalComentarioDeslogado = () => {
    if (!user) setModalLoginComentario(true);
  };

  const handleEnviarComentario = async (e) => {
    e.preventDefault();
    if (!user) {
      setModalLoginComentario(true);
      return;
    }
    if (!comentarioTexto.trim()) return;
    if (enviando)                return;

    setEnviando(true);
    try {
      await sincronizarPerfilPublico(user); // atualiza avatar antes de gravar
      await set(push(ref(db, `capitulos/${id}/comentarios`)), {
        texto:  comentarioTexto.trim(),
        userId: user.uid,
        data:   serverTimestamp(),
        likes:  0,
      });
      setComentario('');
    } catch (err) {
      console.error('Erro ao comentar:', err);
    } finally {
      setEnviando(false);
    }
  };

  // ✅ Qualquer usuário logado pode curtir — sem restrição de status
  const handleLike = (comentId) => {
    if (!user) { navigate('/login'); return; }
    runTransaction(ref(db, `capitulos/${id}/comentarios/${comentId}`), (post) => {
      if (!post) return post;
      if (!post.usuariosQueCurtiram) post.usuariosQueCurtiram = {};
      if (post.usuariosQueCurtiram[user.uid]) {
        post.likes = Math.max(0, (post.likes || 1) - 1);
        delete post.usuariosQueCurtiram[user.uid];
      } else {
        post.likes = (post.likes || 0) + 1;
        post.usuariosQueCurtiram[user.uid] = true;
      }
      return post;
    });
  };

  const comentariosOrdenados = [...listaComentarios].sort((a, b) =>
    filtro === 'relevantes'
      ? (b.likes || 0) - (a.likes || 0)
      : (b.data  || 0) - (a.data  || 0)
  );

  if (carregando) return <LoadingScreen />;
  if (!capitulo) {
    return (
      <div className="leitor-container">
        <div className="leitor-not-found" role="alert">
          Capítulo não encontrado.
        </div>
      </div>
    );
  }

  return (
    <div className="leitor-container">

      <header className="leitor-header">
        <h1>{capitulo.titulo}</h1>
        <button className="btn-config" onClick={() => setMostrarConfig((v) => !v)}>⚙</button>
      </header>

      {mostrarConfig && (
        <div className="config-panel">
          <button className={modoLeitura === 'vertical'   ? 'active' : ''} onClick={() => setModoLeitura('vertical')}>Vertical</button>
          <button className={modoLeitura === 'horizontal' ? 'active' : ''} onClick={() => setModoLeitura('horizontal')}>Horizontal</button>
          <div>
            <button onClick={() => setZoom((z) => Math.max(50,  z - 10))}>-</button>
            <span>{zoom}%</span>
            <button onClick={() => setZoom((z) => Math.min(200, z + 10))}>+</button>
          </div>
        </div>
      )}

      {modoLeitura === 'vertical' ? (
        <main className="paginas-lista">
          {capitulo.paginas?.map((url, index) => (
            <img key={index} src={url} alt={`página ${index + 1}`} loading="lazy"
              style={{ width: `${zoom}%`, display: 'block', margin: '0 auto' }} />
          ))}
        </main>
      ) : (
        <div className="horizontal-reader"
          onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}>
          <button type="button" className="seta esquerda" onClick={irAnterior} disabled={paginaAtual === 0}>‹</button>
          <div className="pagina-unica">
            <img src={capitulo.paginas?.[paginaAtual]} alt={`página ${paginaAtual + 1}`}
              style={{ width: `${zoom}%`, margin: '0 auto', display: 'block' }} />
          </div>
          <button type="button" className="seta direita" onClick={irProxima} disabled={paginaAtual >= totalPaginas - 1}>›</button>
          <div className="contador">{paginaAtual + 1} / {totalPaginas}</div>
        </div>
      )}

      <footer className="leitor-footer">
        <button onClick={() => navigate('/capitulos')}>Voltar ao mangá</button>
      </footer>

      {/* ── COMENTÁRIOS ── */}
      <section className="comentarios-section">
        <h3>Comentários ({listaComentarios.length})</h3>

        <div className="filtro-comentarios">
          <button className={filtro === 'relevantes' ? 'ativo' : ''} onClick={() => setFiltro('relevantes')}>🔥 Relevantes</button>
          <button className={filtro === 'recentes'   ? 'ativo' : ''} onClick={() => setFiltro('recentes')}>🕒 Recentes</button>
        </div>

        <form onSubmit={handleEnviarComentario} className="form-comentario">
          {user && (
            <img src={user.photoURL || AVATAR_FALLBACK} alt="Seu avatar"
              className="avatar-comentario"
              onError={(e) => { e.target.src = AVATAR_FALLBACK; }} />
          )}
          <div
            className={`input-comentario-wrapper${!user ? ' input-comentario-wrapper--convite' : ''}`}
            onClick={!user ? abrirModalComentarioDeslogado : undefined}
          >
            <textarea
              value={user ? comentarioTexto : ''}
              onChange={(e) => user && setComentario(e.target.value)}
              placeholder={user ? 'Escreva seu comentário...' : 'Faça login para comentar'}
              readOnly={!user}
              disabled={Boolean(user && enviando)}
              maxLength={user ? 500 : undefined}
              onClick={!user ? (e) => { e.stopPropagation(); abrirModalComentarioDeslogado(); } : undefined}
              onFocus={!user ? abrirModalComentarioDeslogado : undefined}
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
          {comentariosOrdenados.length === 0 && (
            <p className="sem-comentarios">Seja o primeiro a comentar! 👇</p>
          )}

          {comentariosOrdenados.map((c) => {
            const perfil    = perfisUsuarios[c.userId];
            const isLiked   = c.usuariosQueCurtiram?.[user?.uid];
            const isPremium = isContaPremium(perfil);

            return (
              <div key={c.id} className="comentario">
                {/* Avatar visível para TODOS */}
                <img
                  src={perfil?.userAvatar || AVATAR_FALLBACK}
                  alt="avatar"
                  className="avatar-comentario"
                  onError={(e) => { e.target.src = AVATAR_FALLBACK; }}
                />
                <div className="comentario-corpo">
                  <div className="comentario-header">
                    <strong className="comentario-autor">
                      {perfil?.userName || 'Carregando...'}
                    </strong>
                    {isPremium && <span className="badge-premium" title="Membro premium">👑</span>}
                  </div>
                  <p className="comentario-texto">{c.texto}</p>
                  {/* Like disponível para qualquer usuário logado */}
                  <button
                    type="button"
                    className={`btn-like ${isLiked ? 'liked' : ''}`}
                    onClick={() => handleLike(c.id)}
                    title={user ? (isLiked ? 'Remover curtida' : 'Curtir') : 'Faça login para curtir'}
                  >
                    {isLiked ? '❤️' : '🤍'} {c.likes || 0}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {modalLoginComentario && !user && (
        <div
          className="leitor-modal-backdrop"
          onClick={() => setModalLoginComentario(false)}
          role="presentation"
        >
          <div
            className="leitor-modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="leitor-modal-login-titulo"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="leitor-modal-fechar"
              onClick={() => setModalLoginComentario(false)}
              aria-label="Fechar"
            >
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
                onClick={() => setModalLoginComentario(false)}
              >
                Agora não
              </button>
              <button
                type="button"
                className="leitor-modal-btn leitor-modal-btn--primario"
                onClick={() => {
                  setModalLoginComentario(false);
                  navigate('/login');
                }}
              >
                Sim, entrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

