import React, { useState, useEffect } from 'react';
import { ref, onValue, runTransaction } from "firebase/database";
import { useNavigate } from 'react-router-dom';

// 1. IMPORTAÇÃO CENTRALIZADA (Usa o db do seu service)
import { db } from '../../services/firebase'; 

// 2. CSS LOCAL NA PASTA Capitulos
import './Capitulos.css';

export default function Capitulos() {
  const [listaCapitulos, setListaCapitulos] = useState([]);
  const [buscandoDados, setBuscandoDados] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    // Referência para a coleção de capítulos no Realtime Database
    const capitulosRef = ref(db, 'capitulos');
    
    const unsubscribe = onValue(capitulosRef, (snapshot) => {
      const dados = snapshot.val();
      if (dados) {
        const arrayCapitulos = Object.keys(dados).map(key => {
          // Conta comentários com segurança
          const qtdComentarios = dados[key].comentarios 
            ? Object.keys(dados[key].comentarios).length 
            : 0;

          return {
            id: key,
            ...dados[key],
            totalComentarios: qtdComentarios
          };
        });
        
        // Ordenação: Capítulo mais alto (recente) no topo
        const ordenados = arrayCapitulos.sort((a, b) => (Number(b.numero) || 0) - (Number(a.numero) || 0));
        setListaCapitulos(ordenados);
      }
      setBuscandoDados(false);
    });

    return () => unsubscribe();
  }, []);

  const handleAbrirCapitulo = (capId) => {
    const viewRef = ref(db, `capitulos/${capId}/visualizacoes`);
    
    // Incremento atômico para não bugar se muita gente clicar ao mesmo tempo
    runTransaction(viewRef, (currentViews) => {
      return (currentViews || 0) + 1;
    });

    navigate(`/ler/${capId}`);
  };

  // Se o App.jsx já passou pelo LoadingScreen, mas ainda estamos buscando os capítulos...
  if (buscandoDados) {
    return (
      <div className="capitulos-placeholder">
        <p className="loading-text-shito">CONVOCANDO OS FRAGMENTOS DA TEMPESTADE...</p>
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
                onKeyDown={(e) => e.key === 'Enter' && handleAbrirCapitulo(cap.id)}
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
                        src={cap.capaUrl || '/assets/fotos/shito.jpg'} 
                        alt={`Capa ${cap.numero}`} 
                        className="shito-cap-miniature" 
                        loading="lazy"
                      />
                    </div>
                    
                    <div className="cap-text-details">
                      <h3 className="shito-cap-title">{cap.titulo || "Capítulo sem título"}</h3>
                      
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
                        }).replace('.', '') 
                      : 'Névoa'}
                  </time>
                  <i className="fa-solid fa-chevron-right arrow-mobile"></i>
                </div>
              </article>
            ))
          ) : (
            <div className="no-chapters">
              <i className="fa-solid fa-ghost"></i>
              <p>Nenhum fragmento encontrado nesta era...</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}