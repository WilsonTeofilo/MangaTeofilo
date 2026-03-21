import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import * as db from 'firebase/database';
import * as storage from 'firebase/storage';
import './AdminPanel.css';

// --- COMPONENTE AUXILIAR: MODO ECONÔMICO (Lazy Load) ---
// Coloquei aqui fora para o React não remontar ele toda hora e gastar banda à toa.
function PaginaCard({ index, url, onTrocar }) {
  const [visivel, setVisivel] = useState(false);

  return (
    <div className="pagina-edit-card">
      <span className="badge-pg">Pág {index + 1}</span>
      <div className="preview-placeholder">
        {visivel ? (
          <img src={url} alt={`página ${index}`} />
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
          accept="image/*"
          onChange={(e) => onTrocar(e.target.files[0])} 
        />
      </label>
    </div>
  );
}

export default function AdminPanel({ user }) {
  const navigate = useNavigate();
  const databaseInstance = db.getDatabase();
  const storageInstance = storage.getStorage();

  // Estados do Form
  const [titulo, setTitulo] = useState('');
  const [numeroCapitulo, setNumeroCapitulo] = useState('');
  const [capaCapitulo, setCapaCapitulo] = useState(null);
  const [arquivosPaginas, setArquivosPaginas] = useState([]);
  const [paginasExistentes, setPaginasExistentes] = useState([]);

  // Estados de Controle
  const [capitulos, setCapitulos] = useState([]);
  const [editandoId, setEditandoId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [progressoMsg, setProgressoMsg] = useState('');
  const [porcentagem, setPorcentagem] = useState(0);

  const ADMIN_UID = "n5JTPLsxpyQPeC5qQtraSrBa4rG3";

  useEffect(() => {
    if (!user || user.uid !== ADMIN_UID) {
      navigate('/');
      return;
    }

    const capitulosRef = db.ref(databaseInstance, 'capitulos');
    db.onValue(capitulosRef, (snapshot) => {
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
  }, [user, navigate, databaseInstance]);

  // FUNÇÃO CIRÚRGICA (Edita apenas UMA página)
  const handleTrocarPaginaUnica = async (index, arquivoNovo) => {
    if (!arquivoNovo) return;
    setLoading(true);
    setProgressoMsg(`Substituindo página ${index + 1}...`);
    try {
      const pathStorage = `manga/${titulo || 'edit'}/pg_${index}_${Date.now()}`;
      const fileRef = storage.ref(storageInstance, pathStorage);
      await storage.uploadBytes(fileRef, arquivoNovo);
      const urlNova = await storage.getDownloadURL(fileRef);

      const updates = {};
      updates[`capitulos/${editandoId}/paginas/${index}`] = urlNova;
      await db.update(db.ref(databaseInstance), updates);

      const novasPaginas = [...paginasExistentes];
      novasPaginas[index] = urlNova;
      setPaginasExistentes(novasPaginas);
      setProgressoMsg('Sucesso!');
    } catch (err) {
      setProgressoMsg('Erro: ' + err.message);
    } finally {
      setLoading(false);
      setTimeout(() => setProgressoMsg(''), 3000);
    }
  };

  const handleUploadManga = async (arquivos, tituloObra) => {
    const urls = [];
    for (let i = 0; i < arquivos.length; i++) {
      const pathStorage = `manga/${tituloObra}/p_${i}_${Date.now()}`;
      const fileRef = storage.ref(storageInstance, pathStorage);
      const uploadTask = storage.uploadBytesResumable(fileRef, arquivos[i]);
      await new Promise((res, rej) => {
        uploadTask.on('state_changed', 
          (snap) => setPorcentagem(Math.round((i * (100 / arquivos.length)) + (snap.bytesTransferred / snap.totalBytes) * (100 / arquivos.length))),
          rej, res
        );
      });
      urls.push(await storage.getDownloadURL(uploadTask.snapshot.ref));
    }
    return urls;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setProgressoMsg('Sincronizando com o Trono...');
    try {
      let urlCapa = null;
      let urlsPaginas = [];
      if (capaCapitulo) {
        const capaRef = storage.ref(storageInstance, `capas/${Date.now()}_${capaCapitulo.name}`);
        await storage.uploadBytes(capaRef, capaCapitulo);
        urlCapa = await storage.getDownloadURL(capaRef);
      }
      if (arquivosPaginas.length > 0) {
        urlsPaginas = await handleUploadManga(arquivosPaginas, titulo);
      }

      const dados = { titulo, numero: parseInt(numeroCapitulo), dataUpload: new Date().toISOString() };
      if (urlCapa) dados.capaUrl = urlCapa;
      if (urlsPaginas.length > 0) dados.paginas = urlsPaginas;

      if (editandoId) {
        await db.update(db.ref(databaseInstance, `capitulos/${editandoId}`), dados);
      } else {
        if (!urlCapa || urlsPaginas.length === 0) throw new Error("Anexe capa e páginas!");
        await db.set(db.push(db.ref(databaseInstance, 'capitulos')), dados);
      }
      setEditandoId(null); setTitulo(''); setNumeroCapitulo(''); setPaginasExistentes([]); e.target.reset();
    } catch (err) { alert(err.message); } finally { setLoading(false); }
  };

  const handleDeletar = async (cap) => {
    if (window.confirm(`Apagar fragmento ${cap.numero}?`)) {
      await db.remove(db.ref(databaseInstance, `capitulos/${cap.id}`));
    }
  };

  const prepararEdicao = (cap) => {
    setEditandoId(cap.id);
    setTitulo(cap.titulo);
    setNumeroCapitulo(cap.numero);
    setPaginasExistentes(cap.paginas || []);
    window.scrollTo(0, 0);
  };

  return (
    <div className="admin-panel">
      <header className="admin-header">
        <h1>SHITO - FORJA DO AUTOR</h1>
        <button className="btn-voltar" onClick={() => navigate('/')}>Sair</button>
      </header>

      <main className="admin-container">
        <section className="form-section">
          <h2>{editandoId ? 'Editar Fragmento' : 'Novo Capítulo'}</h2>
          
          <form onSubmit={handleSubmit} className="admin-form">
            <div className="input-row">
              <input type="number" placeholder="Nº" value={numeroCapitulo} onChange={(e) => setNumeroCapitulo(e.target.value)} required />
              <input type="text" placeholder="Título" value={titulo} onChange={(e) => setTitulo(e.target.value)} required />
            </div>

            {/* EDITOR ECONÔMICO: Só carrega a foto se você clicar */}
            {editandoId && paginasExistentes.length > 0 && (
              <div className="cirurgia-paginas">
                <div className="cirurgia-info">
                  <h3>Edição Cirúrgica de Páginas</h3>
                  <p>Economizando sua banda do Firebase. As fotos só carregam ao clicar em VER.</p>
                </div>
                <div className="paginas-edit-grid">
                  {paginasExistentes.map((url, index) => (
                    <PaginaCard 
                      key={`${editandoId}-${index}`}
                      index={index}
                      url={url}
                      onTrocar={(file) => handleTrocarPaginaUnica(index, file)}
                    />
                  ))}
                </div>
              </div>
            )}

            <div className="file-inputs">
              <label>Capa: <input type="file" accept="image/*" onChange={(e) => setCapaCapitulo(e.target.files[0])} /></label>
              <label>Substituir Cap. Inteiro (Cuidado): <input type="file" multiple accept="image/*" onChange={(e) => setArquivosPaginas(Array.from(e.target.files))} /></label>
            </div>

            {loading && (
              <div className="progress-container">
                <div className="progress-bar" style={{ width: `${porcentagem}%` }}></div>
                <p>{porcentagem}% - {progressoMsg}</p>
              </div>
            )}

            <div className="form-actions">
              <button type="submit" className="btn-save" disabled={loading}>
                {loading ? 'PROCESSANDO...' : editandoId ? 'SALVAR TÍTULO/CAPA' : 'LANÇAR CAPÍTULO'}
              </button>
              {editandoId && (
                <button type="button" className="btn-cancel" onClick={() => {setEditandoId(null); setPaginasExistentes([]);}}>
                  CANCELAR
                </button>
              )}
            </div>
          </form>
        </section>

        <section className="list-section">
          <h2>CRUD de Fragmentos</h2>
          <div className="capitulos-grid">
            {capitulos.map((cap) => (
              <div key={cap.id} className="cap-card">
                <div className="cap-info">
                  <span className="cap-number">#{cap.numero}</span>
                  <span className="cap-title">{cap.titulo}</span>
                </div>
                <div className="cap-actions">
                  <button className="btn-edit" onClick={() => prepararEdicao(cap)}>EDITAR</button>
                  <button className="btn-delete" onClick={() => handleDeletar(cap)}>APAGAR</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}