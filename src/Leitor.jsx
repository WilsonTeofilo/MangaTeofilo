import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getDatabase, ref, onValue } from "firebase/database";
import './Leitor.css';

export default function Leitor() {
  const { id } = useParams(); // Pega o ID da URL (/ler/ID-DO-CAPITULO)
  const navigate = useNavigate();
  const [capitulo, setCapitulo] = useState(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    const db = getDatabase();
    const capRef = ref(db, `capitulos/${id}`);

    const unsubscribe = onValue(capRef, (snapshot) => {
      if (snapshot.exists()) {
        setCapitulo(snapshot.val());
      }
      setCarregando(false);
    });

    return () => unsubscribe();
  }, [id]);

  if (carregando) return <div className="leitor-msg">Despertando memórias...</div>;
  if (!capitulo) return <div className="leitor-msg">Capítulo não encontrado na névoa.</div>;

  return (
    <div className="leitor-container">
      {/* Botão flutuante para voltar */}
      <button className="btn-voltar-leitor" onClick={() => navigate('/capitulos')}>
        ← VOLTAR
      </button>

      <header className="leitor-info">
        <h1>{capitulo.titulo}</h1>
        <p>Role para baixo para ler</p>
      </header>

      <main className="paginas-lista">
        {capitulo.paginas && capitulo.paginas.length > 0 ? (
          capitulo.paginas.map((url, index) => (
            <img 
              key={index} 
              src={url} 
              alt={`Página ${index + 1}`} 
              className="manga-page-img"
              loading="lazy" // Carrega conforme o usuário rola (melhora a performance)
            />
          ))
        ) : (
          <p>Este capítulo ainda não tem páginas.</p>
        )}
      </main>

      <footer className="leitor-footer">
        <h3>Fim do {capitulo.titulo}</h3>
        <button className="btn-final" onClick={() => navigate('/capitulos')}>
          VOLTAR PARA A LISTA
        </button>
      </footer>
    </div>
  );
}