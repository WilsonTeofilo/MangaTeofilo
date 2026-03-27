// src/pages/Leitor/Leitor.jsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ref, onValue, push, set, runTransaction, serverTimestamp } from 'firebase/database';

import { db } from '../../services/firebase'; // ✅ db centralizado, não getDatabase() local
import { AVATAR_FALLBACK } from '../../constants';
import LoadingScreen from '../../components/LoadingScreen';
import './Leitor.css';

export default function Leitor({ user }) {
  const { id }     = useParams();
  const navigate   = useNavigate();

  /* ── Estados ── */
  const [capitulo, setCapitulo]           = useState(null);
  const [carregando, setCarregando]       = useState(true);
  const [comentarioTexto, setComentario]  = useState('');
  const [listaComentarios, setComentarios] = useState([]);
  const [perfisUsuarios, setPerfis]       = useState({});
  const [filtro, setFiltro]               = useState('relevantes');

  const isContaPremium = (perfil) => {
    const tipo = perfil?.accountType;
    return tipo === 'membro' || tipo === 'premium' || tipo === 'admin';
  };

  /* ── Leitor ── */
  const [modoLeitura, setModoLeitura] = useState(
    () => localStorage.getItem('modoLeitura') || 'vertical'
  );
  const [zoom, setZoom] = useState(
    () => Number(localStorage.getItem('zoom')) || 100
  );
  const [paginaAtual, setPaginaAtual]     = useState(0);
  const [mostrarConfig, setMostrarConfig] = useState(false);

  /* ── Refs ── */
  const touchStartX    = useRef(0);
  const touchEndX      = useRef(0);
  const unsubPerfis    = useRef({});
  // ✅ Controla visualização por sessão para não inflar o contador
  const jaContouVisualizacao = useRef(false);

  /* ── Persistir config ── */
  useEffect(() => { localStorage.setItem('modoLeitura', modoLeitura); }, [modoLeitura]);
  useEffect(() => { localStorage.setItem('zoom', zoom); }, [zoom]);

  /* ── Carregar perfil de comentarista ── */
  const escutarPerfil = useCallback((uid) => {
    if (!uid || unsubPerfis.current[uid]) return;
    const unsub = onValue(
      ref(db, `usuarios_publicos/${uid}`),
      (snap) => {
        if (snap.exists()) {
          setPerfis((prev) => ({ ...prev, [uid]: snap.val() }));
        }
      },
      () => {
        // Se a regra bloquear leitura de perfis, mantém fallback visual.
      }
    );
    unsubPerfis.current[uid] = unsub;
  }, [user]);

  /* ── Carregar capítulo ── */
  useEffect(() => {
    // ✅ Conta visualização apenas uma vez por sessão neste capítulo
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

  /* ── Navegação entre páginas ── */
  const totalPaginas = capitulo?.paginas?.length || 0;

  const irProxima   = () => setPaginaAtual((p) => Math.min(p + 1, totalPaginas - 1));
  const irAnterior  = () => setPaginaAtual((p) => Math.max(p - 1, 0));

  /* ── Teclado ── */
  useEffect(() => {
    const handleKey = (e) => {
      if (modoLeitura !== 'horizontal') return;
      if (e.key === 'ArrowRight') irProxima();
      if (e.key === 'ArrowLeft')  irAnterior();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [modoLeitura, totalPaginas]);

  /* ── Swipe ── */
  const handleTouchStart = (e) => { touchStartX.current = e.changedTouches[0].screenX; };
  const handleTouchMove  = (e) => { touchEndX.current   = e.changedTouches[0].screenX; };
  const handleTouchEnd   = () => {
    const dist = touchStartX.current - touchEndX.current;
    if (dist >  50) irProxima();
    if (dist < -50) irAnterior();
  };

  /* ── Comentar ── */
  const handleEnviarComentario = async (e) => {
    e.preventDefault();
    if (!user) { navigate('/login'); return; }
    if (!comentarioTexto.trim()) return;

    try {
      await set(push(ref(db, `capitulos/${id}/comentarios`)), {
        texto:  comentarioTexto.trim(),
        userId: user.uid,
        data:   serverTimestamp(),
        likes:  0,
      });
      setComentario('');
    } catch (err) {
      console.error('Erro ao comentar:', err);
    }
  };

  /* ── Like ── */
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

  /* ── Ordenar comentários ── */
  const comentariosOrdenados = [...listaComentarios].sort((a, b) =>
    filtro === 'relevantes'
      ? (b.likes || 0) - (a.likes || 0)
      : (b.data  || 0) - (a.data  || 0)
  );

  /* ── Guards ── */
  if (carregando)  return <LoadingScreen />;
  if (!capitulo)   return <div>Capítulo não encontrado</div>;

  /* ── Render ── */
  return (
    <div className="leitor-container">

      <header className="leitor-header">
        <h1>{capitulo.titulo}</h1>
        <button className="btn-config" onClick={() => setMostrarConfig((v) => !v)}>⚙</button>
      </header>

      {mostrarConfig && (
        <div className="config-panel">
          <button className={modoLeitura === 'vertical'    ? 'active' : ''} onClick={() => setModoLeitura('vertical')}>Vertical</button>
          <button className={modoLeitura === 'horizontal'  ? 'active' : ''} onClick={() => setModoLeitura('horizontal')}>Horizontal</button>
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
            <img
              key={index}
              src={url}
              alt={`página ${index + 1}`}
              loading="lazy"
              style={{ width: `${zoom}%`, display: 'block', margin: '0 auto' }}
            />
          ))}
        </main>
      ) : (
        <div
          className="horizontal-reader"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <button type="button" className="seta esquerda" onClick={irAnterior} disabled={paginaAtual === 0}>‹</button>

          <div className="pagina-unica">
            <img
              src={capitulo.paginas?.[paginaAtual]}
              alt={`página ${paginaAtual + 1}`}
              style={{ width: `${zoom}%`, margin: '0 auto', display: 'block' }}
            />
          </div>

          <button type="button" className="seta direita" onClick={irProxima} disabled={paginaAtual >= totalPaginas - 1}>›</button>

          <div className="contador">{paginaAtual + 1} / {totalPaginas}</div>
        </div>
      )}

      <footer className="leitor-footer">
        <button onClick={() => navigate('/capitulos')}>Voltar ao mangá</button>
      </footer>

      <section className="comentarios-section">
        <h3>Comentários</h3>

        <div className="filtro-comentarios">
          <button className={filtro === 'relevantes' ? 'ativo' : ''} onClick={() => setFiltro('relevantes')}>Relevantes</button>
          <button className={filtro === 'recentes'   ? 'ativo' : ''} onClick={() => setFiltro('recentes')}>Recentes</button>
        </div>

        <form onSubmit={handleEnviarComentario}>
          <textarea
            value={comentarioTexto}
            onChange={(e) => setComentario(e.target.value)}
            placeholder={user ? 'Escreva algo...' : 'Faça login para comentar'}
            disabled={!user}
          />
          <button type="submit" disabled={!user}>Enviar</button>
        </form>

        <div>
          {comentariosOrdenados.map((c) => {
            const perfil = perfisUsuarios[c.userId];
            const isLiked = c.usuariosQueCurtiram?.[user?.uid];

            return (
              <div key={c.id} className="comentario">
                <img
                  src={perfil?.userAvatar || AVATAR_FALLBACK}
                  alt="avatar"
                  onError={(e) => { e.target.src = AVATAR_FALLBACK; }}
                />
                <div>
                  <strong className="comentario-author">
                    {perfil?.userName || 'Usuário'}
                    {isContaPremium(perfil) && (
                      <span className="premium-crown" title="Conta premium">👑</span>
                    )}
                  </strong>
                  <p>{c.texto}</p>
                  <button type="button" onClick={() => handleLike(c.id)}>
                    {isLiked ? '❤️' : '🤍'} {c.likes || 0}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

