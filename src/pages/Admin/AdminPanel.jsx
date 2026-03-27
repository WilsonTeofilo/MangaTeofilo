import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref as dbRef, onValue, update as dbUpdate, set, push, remove } from 'firebase/database';
import { ref as storageRef, uploadBytes, getDownloadURL, uploadBytesResumable } from 'firebase/storage';

import { db, storage, auth } from '../../services/firebase'; 
import { isAdminUser } from '../../constants';
import './AdminPanel.css';

const IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

function validarImagemUpload(file, label = 'arquivo') {
  if (!file) return `${label} nao encontrado.`;
  if (!IMAGE_TYPES.includes(file.type)) return `${label} invalido. Use JPG, PNG ou WEBP.`;
  if (file.size > MAX_IMAGE_SIZE_BYTES) return `${label} excede 5MB.`;
  return '';
}

// --- COMPONENTE: MODAL DE ERRO ---
function ModalErro({ mensagem, aoFechar }) {
  if (!mensagem) return null;
  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-header">⚠️ OPERAÇÃO BLOQUEADA</div>
        <div className="modal-body">
          <p>{mensagem}</p>
        </div>
        <button onClick={aoFechar} className="btn-modal-close">CORRIGIR AGORA</button>
      </div>
    </div>
  );
}

// --- COMPONENTE: CARD DA PÁGINA (INPUT + DRAG AND DROP) ---
function PaginaCard({ index, url, onTrocar, onReordenar, total, forcarRevelar, onErro }) {
  const [visivel, setVisivel] = useState(false);
  const [valorInput, setValorInput] = useState(index + 1);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    setValorInput(index + 1);
  }, [index]);

  useEffect(() => {
    if (forcarRevelar) setVisivel(true);
  }, [forcarRevelar]);

  const validarEReordenar = () => {
    const valorDigitado = parseInt(valorInput);
    if (isNaN(valorDigitado)) {
      setValorInput(index + 1);
      return;
    }
    if (valorDigitado > total || valorDigitado < 1) {
      onErro(`Página ${valorDigitado} não existe! Este capítulo só tem ${total} páginas.`);
      setValorInput(index + 1);
      return;
    }
    const novoIndex = valorDigitado - 1;
    if (novoIndex !== index) {
      onReordenar(index, novoIndex);
    }
  };

  // Funções de Arrastar (Drag and Drop)
  const handleDragStart = (e) => {
    e.dataTransfer.setData("indexOrigem", index);
    setIsDragging(true);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const indexOrigem = parseInt(e.dataTransfer.getData("indexOrigem"));
    setIsDragging(false);
    if (indexOrigem !== index) {
      onReordenar(indexOrigem, index);
    }
  };

  return (
    <div 
      className={`pagina-edit-card ${isDragging ? 'dragging' : ''}`}
      draggable="true"
      onDragStart={handleDragStart}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      onDragEnd={() => setIsDragging(false)}
    >
      <div className="reorder-control">
        <label>Posição:</label>
        <input 
          type="number" 
          value={valorInput}
          className="input-reorder"
          onChange={(e) => setValorInput(e.target.value)} 
          onBlur={validarEReordenar}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              validarEReordenar();
            }
          }}
        />
      </div>

      <span className="badge-pg">Pág {index + 1}</span>
      
      <div className="preview-placeholder">
        {visivel ? (
          <img src={url} alt={`página ${index}`} draggable="false" />
        ) : (
          <button type="button" className="btn-revelar" onClick={() => setVisivel(true)}>
            VER PÁGINA
          </button>
        )}
      </div>

      <label className="btn-trocar">
        TROCAR JPG
        <input 
          type="file" 
          hidden 
          accept="image/jpeg,image/jpg,image/png,image/webp"
          onChange={(e) => onTrocar(e.target.files[0])} 
        />
      </label>
    </div>
  );
}

// --- COMPONENTE PRINCIPAL ---
export default function AdminPanel() {
  const navigate = useNavigate();
  const user = auth.currentUser;

  const [titulo, setTitulo] = useState('');
  const [numeroCapitulo, setNumeroCapitulo] = useState('');
  const [capaCapitulo, setCapaCapitulo] = useState(null);
  const [arquivosPaginas, setArquivosPaginas] = useState([]);
  const [paginasExistentes, setPaginasExistentes] = useState([]);

  const [capitulos, setCapitulos] = useState([]);
  const [editandoId, setEditandoId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [progressoMsg, setProgressoMsg] = useState('');
  const [porcentagem, setPorcentagem] = useState(0);
  const [mostrarTodasAsFotos, setMostrarTodasAsFotos] = useState(false);
  const [erroModal, setErroModal] = useState('');

  useEffect(() => {
    if (!isAdminUser(user)) {
      navigate('/');
      return;
    }

    const unsubscribe = onValue(dbRef(db, 'capitulos'), (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const lista = Object.entries(data).map(([id, valores]) => ({
          id, ...valores
        }));
        setCapitulos(lista.sort((a, b) => a.numero - b.numero));
      } else {
        setCapitulos([]);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [user, navigate]);

  const handleReordenarPagina = async (indexAntigo, indexNovo) => {
    if (indexNovo < 0 || indexNovo >= paginasExistentes.length) return;

    setLoading(true);
    setProgressoMsg("Reordenando...");
    try {
      const novasPaginas = [...paginasExistentes];
      const [paginaMovida] = novasPaginas.splice(indexAntigo, 1);
      novasPaginas.splice(indexNovo, 0, paginaMovida);

      await dbUpdate(dbRef(db, `capitulos/${editandoId}`), { paginas: novasPaginas });
      setPaginasExistentes(novasPaginas);
    } catch (err) {
      setErroModal("Erro ao reordenar: " + err.message);
    } finally {
      setLoading(false);
      setProgressoMsg('');
    }
  };

  const handleTrocarPaginaUnica = async (index, arquivoNovo) => {
    if (!arquivoNovo) return;
    const erroArquivo = validarImagemUpload(arquivoNovo, 'Pagina');
    if (erroArquivo) {
      setErroModal(erroArquivo);
      return;
    }
    setLoading(true);
    setProgressoMsg(`Trocando página ${index + 1}...`);
    try {
      const pathStorage = `manga/${titulo || 'edit'}/pg_${index}_${Date.now()}`;
      const fileRef = storageRef(storage, pathStorage);
      await uploadBytes(fileRef, arquivoNovo);
      const urlNova = await getDownloadURL(fileRef);

      const novasPaginas = [...paginasExistentes];
      novasPaginas[index] = urlNova;
      
      await dbUpdate(dbRef(db, `capitulos/${editandoId}`), { paginas: novasPaginas });
      setPaginasExistentes(novasPaginas);
    } catch (err) {
      setErroModal("Erro no Upload: " + err.message);
    } finally {
      setLoading(false);
      setProgressoMsg('');
    }
  };

  const handleUploadManga = async (arquivos, tituloObra) => {
    const urls = [];
    for (let i = 0; i < arquivos.length; i++) {
      const erroArquivo = validarImagemUpload(arquivos[i], `Pagina ${i + 1}`);
      if (erroArquivo) {
        throw new Error(erroArquivo);
      }
      const pathStorage = `manga/${tituloObra}/p_${i}_${Date.now()}`;
      const fileRef = storageRef(storage, pathStorage);
      const uploadTask = uploadBytesResumable(fileRef, arquivos[i]);
      
      await new Promise((res, rej) => {
        uploadTask.on('state_changed', 
          (snap) => {
            const p = Math.round((i * (100 / arquivos.length)) + (snap.bytesTransferred / snap.totalBytes) * (100 / arquivos.length));
            setPorcentagem(p);
          },
          rej, res
        );
      });
      urls.push(await getDownloadURL(uploadTask.snapshot.ref));
    }
    return urls;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;

    setLoading(true);
    setProgressoMsg('Sincronizando...');
    try {
      let urlCapa = null;
      let urlsPaginas = [];

      if (capaCapitulo) {
        const erroCapa = validarImagemUpload(capaCapitulo, 'Capa');
        if (erroCapa) {
          throw new Error(erroCapa);
        }
        const capaRef = storageRef(storage, `capas/${Date.now()}_${capaCapitulo.name}`);
        await uploadBytes(capaRef, capaCapitulo);
        urlCapa = await getDownloadURL(capaRef);
      }

      if (arquivosPaginas.length > 0) {
        arquivosPaginas.forEach((file, idx) => {
          const erro = validarImagemUpload(file, `Pagina ${idx + 1}`);
          if (erro) throw new Error(erro);
        });
        urlsPaginas = await handleUploadManga(arquivosPaginas, titulo);
      }

      const dados = { 
        titulo, 
        numero: parseInt(numeroCapitulo), 
        dataUpload: new Date().toISOString() 
      };

      if (urlCapa) dados.capaUrl = urlCapa;
      if (urlsPaginas.length > 0) dados.paginas = urlsPaginas;

      if (editandoId) {
        await dbUpdate(dbRef(db, `capitulos/${editandoId}`), dados);
      } else {
        if (!urlCapa || (urlsPaginas.length === 0 && arquivosPaginas.length === 0)) {
            throw new Error("Obrigatório: Capa + Arquivos.");
        }
        await set(push(dbRef(db, 'capitulos')), dados);
      }

      setEditandoId(null); setTitulo(''); setNumeroCapitulo(''); setPaginasExistentes([]); 
      setArquivosPaginas([]); setCapaCapitulo(null); setMostrarTodasAsFotos(false);
      e.target.reset();
      setProgressoMsg('FORJADO COM SUCESSO!');
    } catch (err) { 
      setErroModal(err.message); 
    } finally { 
      setLoading(false); 
      setTimeout(() => setProgressoMsg(''), 3000);
    }
  };

  const prepararEdicao = (cap) => {
    setEditandoId(cap.id);
    setTitulo(cap.titulo);
    setNumeroCapitulo(cap.numero);
    setPaginasExistentes(cap.paginas || []);
    setMostrarTodasAsFotos(false);
    window.scrollTo(0, 0);
  };

  return (
    <div className="admin-panel">
      <ModalErro mensagem={erroModal} aoFechar={() => setErroModal('')} />

      <header className="admin-header">
        <h1>SHITO - FORJA DO AUTOR</h1>
        <button className="btn-voltar" onClick={() => navigate('/')}>Sair</button>
      </header>

      <main className="admin-container">
        <section className="form-section">
          <h2>{editandoId ? '🔧 Cirurgia de Fragmento' : '✨ Novo Capítulo'}</h2>
          
          <form onSubmit={handleSubmit} className="admin-form">
            <div className="input-row">
              <input type="number" placeholder="Nº" value={numeroCapitulo} onChange={(e) => setNumeroCapitulo(e.target.value)} required />
              <input type="text" placeholder="Título" value={titulo} onChange={(e) => setTitulo(e.target.value)} required />
            </div>

            {editandoId && paginasExistentes.length > 0 && (
              <div className="cirurgia-paginas">
                <div className="cirurgia-header">
                  <div className="cirurgia-info">
                    <h3>Páginas Atuais</h3>
                    <p>Arraste para reordenar ou use o campo de posição.</p>
                  </div>
                  <button 
                    type="button" 
                    className={`btn-revelar-tudo ${mostrarTodasAsFotos ? 'ativo' : ''}`}
                    onClick={() => setMostrarTodasAsFotos(!mostrarTodasAsFotos)}
                  >
                    {mostrarTodasAsFotos ? 'ESCONDER TUDO' : 'REVELAR TODAS'}
                  </button>
                </div>

                <div className="paginas-edit-grid">
                  {paginasExistentes.map((url, index) => (
                    <PaginaCard 
                      key={`${editandoId}-${url}`} 
                      index={index}
                      url={url}
                      total={paginasExistentes.length}
                      onTrocar={(file) => handleTrocarPaginaUnica(index, file)}
                      onReordenar={handleReordenarPagina}
                      forcarRevelar={mostrarTodasAsFotos}
                      onErro={setErroModal}
                    />
                  ))}
                </div>
              </div>
            )}

            <div className="file-inputs">
              <label>Alterar Capa: <input type="file" accept="image/jpeg,image/jpg,image/png,image/webp" onChange={(e) => setCapaCapitulo(e.target.files[0])} /></label>
              <label>Refazer Capítulo: <input type="file" multiple accept="image/jpeg,image/jpg,image/png,image/webp" onChange={(e) => setArquivosPaginas(Array.from(e.target.files))} /></label>
            </div>

            {loading && (
              <div className="progress-container">
                <div className="progress-bar" style={{ width: `${porcentagem}%` }}></div>
                <p>{porcentagem}% - {progressoMsg}</p>
              </div>
            )}

            <div className="form-actions">
              <button type="submit" className="btn-save" disabled={loading}>
                {loading ? 'PROCESSANDO...' : editandoId ? 'SALVAR ALTERAÇÕES' : 'LANÇAR CAPÍTULO'}
              </button>
              {editandoId && (
                <button type="button" className="btn-cancel" onClick={() => {setEditandoId(null); setPaginasExistentes([]);}}>
                  CANCELAR EDIÇÃO
                </button>
              )}
            </div>
          </form>
        </section>

        <section className="list-section">
          <h2>CRUD - Lista de Capítulos</h2>
          <div className="capitulos-grid">
            {capitulos.map((cap) => (
              <div key={cap.id} className="cap-card">
                <div className="cap-info">
                  <span className="cap-number">#{cap.numero}</span>
                  <span className="cap-title">{cap.titulo}</span>
                </div>
                <div className="cap-actions">
                  <button className="btn-edit" onClick={() => prepararEdicao(cap)}>EDITAR</button>
                  <button className="btn-delete" onClick={() => {
                    if (window.confirm(`Apagar fragmento ${cap.numero}?`)) remove(dbRef(db, `capitulos/${cap.id}`));
                  }}>APAGAR</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}