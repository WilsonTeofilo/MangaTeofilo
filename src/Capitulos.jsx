import React, { useState, useEffect } from 'react';
import { getDatabase, ref, onValue } from "firebase/database";
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
        const arrayCapitulos = Object.keys(dados).map(key => ({
          id: key,
          ...dados[key]
        }));
        
        // Ordenação: O número mais alto (lançamento mais recente) no topo
        const ordenados = arrayCapitulos.sort((a, b) => b.numero - a.numero);
        setListaCapitulos(ordenados);
      }
      setCarregando(false);
    });

    return () => unsubscribe();
  }, [db]);

  if (carregando) {
    return (
      <div className="loading-container">
        <div className="shito-loader"></div>
        <p>CONVOCANDO OS FRAGMENTOS...</p>
      </div>
    );
  }

  return (
    <div className="capitulos-page">
      <div className="capitulos-container">
        
        <header className="section-header">
          <div className="header-line"></div>
          <h2>TODOS OS CAPÍTULOS</h2>
        </header>

        {/* CONTAINER DA LISTA SLIM (Substituindo a antiga manga-grid) */}
        <div className="shueisha-capitulos-list">
          {listaCapitulos.length > 0 ? (
            listaCapitulos.map((cap) => (
              
              <div 
                key={cap.id} 
                className="shito-cap-row"
                onClick={() => navigate(`/ler/${cap.id}`)}
              >
                {/* LADO ESQUERDO: Número e Conteúdo Principal */}
                <div className="cap-left-info">
                  
                  {/* Número formatado: #001, #002... */}
                  <span className="shito-cap-number">
                    #{String(cap.numero || 0).padStart(3, '0')}
                  </span>
                  
                  <div className="cap-main-content">
                    {/* Miniatura discreta */}
                    <div className="shito-cap-miniature-wrapper">
                      <img 
                        src={cap.capaUrl} 
                        alt={cap.titulo} 
                        className="shito-cap-miniature" 
                      />
                    </div>
                    
                    {/* Título do Capítulo */}
                    <span className="shito-cap-title">{cap.titulo}</span>
                  </div>
                </div>

                {/* LADO DIREITO: Data de postagem */}
                <div className="cap-right-info">
                  <span className="shito-cap-date">
                    {cap.dataUpload 
                      ? new Date(cap.dataUpload).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
                      : 'Data oculta'}
                  </span>
                </div>

              </div>
            ))
          ) : (
            <div className="no-chapters">
              <p>Nenhum capítulo encontrado na névoa...</p>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}