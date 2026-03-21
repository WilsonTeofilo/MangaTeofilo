import React, { useState, useEffect } from 'react';
import { getDatabase, ref, onValue, runTransaction } from "firebase/database";
import { useNavigate } from 'react-router-dom';
import './Capitulos.css';

export default function Capitulos() {
  const [listaCapitulos, setListaCapitulos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const navigate = useNavigate();
  const db = getDatabase();

  useEffect(() => {
    const capitulosRef = ref(db, 'capitulos');
    
    const unsubscribe = onValue(capitulosRef, (snapshot) => {
      const dados = snapshot.val();
      if (dados) {
        const arrayCapitulos = Object.keys(dados).map(key => {
          const qtdComentarios = dados[key].comentarios 
            ? Object.keys(dados[key].comentarios).length 
            : 0;

          return {
            id: key,
            ...dados[key],
            totalComentarios: qtdComentarios
          };
        });
        
        // Ordenação por número (mais recente no topo)
        const ordenados = arrayCapitulos.sort((a, b) => b.numero - a.numero);
        setListaCapitulos(ordenados);
      }
      setCarregando(false);
    });

    return () => unsubscribe();
  }, [db]);

  const handleAbrirCapitulo = (capId) => {
    const viewRef = ref(db, `capitulos/${capId}/visualizacoes`);
    
    runTransaction(viewRef, (currentViews) => {
      return (currentViews || 0) + 1;
    });

    navigate(`/ler/${capId}`);
  };

  if (carregando) {
    return (
      <div className="loading-container">
        <div className="shito-loader"></div>
        <p className="loading-text">CONVOCANDO OS FRAGMENTOS...</p>
      </div>
    );
  }

  return (
    <div className="capitulos-page">
      <div className="capitulos-container">
        
        <header className="section-header">
          <div className="header-line"></div>
          <h2 className="shito-title-glitch">BIBLIOTECA DE FRAGMENTOS</h2>
        </header>

        <main className="shueisha-capitulos-list">
          {listaCapitulos.length > 0 ? (
            listaCapitulos.map((cap) => (
              <article 
                key={cap.id} 
                className="shito-cap-row"
                onClick={() => handleAbrirCapitulo(cap.id)}
                role="button"
                tabIndex="0"
              >
                {/* LADO ESQUERDO: Número e Imagem */}
                <div className="cap-left-info">
                  <div className="shito-cap-number-wrapper">
                    <span className="shito-cap-number">
                      #{String(cap.numero || 0).padStart(3, '0')}
                    </span>
                  </div>
                  
                  <div className="cap-main-content">
                    <div className="shito-cap-miniature-wrapper">
                      <img 
                        src={cap.capaUrl} 
                        alt={`Capa do capítulo ${cap.numero}`} 
                        className="shito-cap-miniature" 
                        loading="lazy"
                      />
                    </div>
                    
                    <div className="cap-text-details">
                      <h3 className="shito-cap-title">{cap.titulo}</h3>
                      
                      {/* STATS: Agora com FontAwesome para visual profissional */}
                      <div className="cap-stats-row">
                        <span className="stat-item">
                          <i className="fa-regular fa-eye"></i> {cap.visualizacoes || 0}
                        </span>
                        <span className="stat-item">
                          <i className="fa-regular fa-comment"></i> {cap.totalComentarios}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* LADO DIREITO: Data formatada */}
                <div className="cap-right-info">
                  <time className="shito-cap-date">
                    {cap.dataUpload 
                      ? new Date(cap.dataUpload).toLocaleDateString('pt-BR', { 
                          day: '2-digit', 
                          month: 'short' 
                        }).replace('.', '') // Remove o ponto do mês abreviado
                      : 'Névoa'}
                  </time>
                  <i className="fa-solid fa-chevron-right arrow-mobile"></i>
                </div>
              </article>
            ))
          ) : (
            <div className="no-chapters">
              <i className="fa-solid fa-ghost"></i>
              <p>Nenhum capítulo encontrado na tempestade...</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}