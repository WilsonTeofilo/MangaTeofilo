import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getDatabase, ref, onValue, push, set, runTransaction, serverTimestamp } from "firebase/database";
import './Leitor.css';

export default function Leitor({ user }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const db = getDatabase();

  const [capitulo, setCapitulo] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [comentarioTexto, setComentarioTexto] = useState('');
  const [filtro, setFiltro] = useState('relevantes'); 
  const [listaComentarios, setListaComentarios] = useState([]);
  const [perfisUsuarios, setPerfisUsuarios] = useState({});
  
  const unsubscribesPerfis = useRef({});

  // --- BUSCA PERFIL (Mantendo o que resolveu seu gargalo) ---
  const escutarPerfil = useCallback((uid) => {
    if (!uid || unsubscribesPerfis.current[uid]) return;

    const userRef = ref(db, `usuarios/${uid}`);
    const unsubscribe = onValue(userRef, (snapshot) => {
      if (snapshot.exists()) {
        const dadosPerfil = snapshot.val();
        setPerfisUsuarios(prev => ({
          ...prev,
          [uid]: dadosPerfil
        }));
      }
    });
    unsubscribesPerfis.current[uid] = unsubscribe;
  }, [db]);

  useEffect(() => {
    const capRef = ref(db, `capitulos/${id}`);
    
    const unsubscribeCap = onValue(capRef, (snapshot) => {
      if (snapshot.exists()) {
        const dados = snapshot.val();
        setCapitulo(dados);

        if (dados.comentarios) {
          const arrayComents = Object.keys(dados.comentarios).map(key => ({
            id: key,
            ...dados.comentarios[key]
          }));
          
          setListaComentarios(arrayComents);
          
          // Mantendo a busca de cada user para não quebrar nomes/fotos
          arrayComents.forEach(c => {
            if (c.userId) escutarPerfil(c.userId);
          });
        } else {
          setListaComentarios([]);
        }
      }
      setCarregando(false);
    });

    return () => {
      unsubscribeCap();
      Object.values(unsubscribesPerfis.current).forEach(unsub => unsub());
      unsubscribesPerfis.current = {};
    };
  }, [id, db, escutarPerfil]);

  // --- AÇÕES (O CORAÇÃO DO LIKE) ---
  const handleEnviarComentario = async (e) => {
    e.preventDefault();
    if (!user) return navigate('/login');
    if (!comentarioTexto.trim()) return;

    try {
      const novoComentRef = push(ref(db, `capitulos/${id}/comentarios`));
      await set(novoComentRef, {
        texto: comentarioTexto.trim(),
        userId: user.uid,
        data: serverTimestamp(),
        likes: 0
      });
      setComentarioTexto('');
    } catch (err) {
      console.error("Erro ao enviar fragmento:", err);
    }
  };

  const handleLike = (comentId) => {
    if (!user) return navigate('/login');
    const likeRef = ref(db, `capitulos/${id}/comentarios/${comentId}`);
    
    runTransaction(likeRef, (post) => {
      if (post) {
        // Inicializa se for a primeira curtida do comentário
        if (!post.usuariosQueCurtiram) {
          post.usuariosQueCurtiram = {};
        }

        if (post.usuariosQueCurtiram[user.uid]) {
          // Já curtiu? Então remove (Toggle)
          post.likes = Math.max(0, (post.likes || 1) - 1);
          delete post.usuariosQueCurtiram[user.uid];
        } else {
          // Não curtiu? Adiciona o carimbo do UID dele
          post.likes = (post.likes || 0) + 1;
          post.usuariosQueCurtiram[user.uid] = true;
        }
      }
      return post;
    });
  };

  const comentariosOrdenados = [...listaComentarios].sort((a, b) => {
    if (filtro === 'relevantes') return (b.likes || 0) - (a.likes || 0);
    return (b.data || 0) - (a.data || 0);
  });

  if (carregando) return <div className="leitor-msg">Sincronizando com a alma do capítulo...</div>;
  if (!capitulo) return <div className="leitor-msg">Capítulo não encontrado.</div>;

  return (
    <div className="leitor-container">
      <button className="btn-voltar-leitor" onClick={() => navigate('/capitulos')}>
        <i className="fa-solid fa-arrow-left"></i> VOLTAR
      </button>

      <header className="leitor-info">
        <h1 className="shito-manga-title">{capitulo.titulo}</h1>
        <div className="leitor-stats-header">
           <span className="stat-badge"><i className="fa-regular fa-eye"></i> {capitulo.visualizacoes || 0} fragmentos</span>
           <span className="stat-badge"><i className="fa-regular fa-comment"></i> {listaComentarios.length} vozes</span>
        </div>
      </header>

      <main className="paginas-lista">
        {capitulo.paginas?.map((url, index) => (
          <img key={index} src={url} alt={`Pág ${index + 1}`} className="manga-page-img" loading="lazy" />
        ))}
      </main>

      <section className="comentarios-section">
        <div className="comentarios-header">
          <h3 className="section-title">
            <i className="fa-solid fa-scroll" style={{ color: '#ffcc00' }}></i> Fragmentos de Alma
          </h3>
          <div className="filtros-comentarios">
            <button className={filtro === 'relevantes' ? 'active' : ''} onClick={() => setFiltro('relevantes')}>RELEVANTES</button>
            <button className={filtro === 'recentes' ? 'active' : ''} onClick={() => setFiltro('recentes')}>RECENTES</button>
          </div>
        </div>

        <form className="comentar-form" onSubmit={handleEnviarComentario}>
          <div className="textarea-wrapper">
            <textarea 
              placeholder={user ? "Deixe sua marca..." : "Acesse sua conta para comentar..."}
              value={comentarioTexto}
              onChange={(e) => setComentarioTexto(e.target.value)}
              onClick={() => !user && navigate('/login')}
              rows="3"
            />
          </div>
          <button type="submit" className="btn-postar" disabled={!comentarioTexto.trim() || !user}>
            LIBERAR <i className="fa-solid fa-paper-plane"></i>
          </button>
        </form>

        <div className="comentarios-lista">
          {comentariosOrdenados.map((c) => {
            const perfil = perfisUsuarios[c.userId];
            // Verificação segura do Like
            const isLiked = c.usuariosQueCurtiram && c.usuariosQueCurtiram[user?.uid];

            return (
              <article key={c.id} className="comentario-item">
                <div className="coment-avatar-wrapper">
                  <img 
                    src={perfil?.userAvatar || '/assets/avatares/ava1.webp'} 
                    alt="Avatar" 
                    className="coment-avatar" 
                  />
                </div>
                <div className="coment-content">
                  <header className="coment-meta">
                    <span className="coment-user">{perfil?.userName || 'Guerreiro'}</span>
                    <span className="coment-date">
                      {c.data ? new Date(c.data).toLocaleDateString('pt-BR') : 'Agora'}
                    </span>
                  </header>
                  <p className="coment-text">{c.texto}</p>
                  <div className="coment-footer-actions">
                    <button 
                      type="button" 
                      className={`btn-like-action ${isLiked ? 'liked' : ''}`} 
                      onClick={() => handleLike(c.id)}
                    >
                      <i className={isLiked ? "fa-solid fa-heart" : "fa-regular fa-heart"}></i>
                      <span className="like-count">{c.likes || 0}</span>
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}