import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { onValue, push, ref as dbRef, remove, set, update } from 'firebase/database';
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytesResumable } from 'firebase/storage';
import { onAuthStateChanged } from 'firebase/auth';

import { auth, db, storage } from '../../services/firebase';
import { isAdminUser } from '../../constants';
import './AdminPanel.css';

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

export default function AvatarAdmin() {
  const navigate = useNavigate();
  const [user, setUser] = useState(auth.currentUser);

  const [avatares, setAvatares] = useState([]);
  const [avatarUploads, setAvatarUploads] = useState([]);
  const [loading, setLoading] = useState(false);
  const [progressoMsg, setProgressoMsg] = useState('');
  const [porcentagem, setPorcentagem] = useState(0);
  const [uploadResultados, setUploadResultados] = useState([]);
  const [erroModal, setErroModal] = useState('');
  const [draggingAvatarId, setDraggingAvatarId] = useState(null);
  const [uploadAcesso, setUploadAcesso] = useState('publico');
  const [filtroAcesso, setFiltroAcesso] = useState('todos');
  const activeTasksRef = useRef([]);

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (current) => {
      setUser(current || null);
    });
    return () => unsubAuth();
  }, []);

  useEffect(() => {
    if (user === null) return;
    if (!isAdminUser(user)) {
      navigate('/');
      return;
    }

    const unsub = onValue(dbRef(db, 'avatares'), (snapshot) => {
      const data = snapshot.val();
      if (!data) {
        setAvatares([]);
        return;
      }
      const lista = Object.entries(data)
        .map(([id, valores]) => ({ id, ...valores }))
        .sort((a, b) => {
          const aOrder = typeof a.order === 'number' ? a.order : Number.MAX_SAFE_INTEGER;
          const bOrder = typeof b.order === 'number' ? b.order : Number.MAX_SAFE_INTEGER;
          if (aOrder !== bOrder) return aOrder - bOrder;
          return (b.createdAt || 0) - (a.createdAt || 0);
        });
      setAvatares(lista);
    });

    return () => unsub();
  }, [navigate, user]);

  useEffect(() => {
    if (uploadResultados.length === 0 || loading) return undefined;
    const finalizado = uploadResultados.every((item) =>
      item.status === 'sucesso' || item.status === 'erro' || item.status === 'cancelado'
    );
    if (!finalizado) return undefined;
    const timer = setTimeout(() => {
      setUploadResultados([]);
    }, 10_000);
    return () => clearTimeout(timer);
  }, [uploadResultados, loading]);

  const validarAvatarWebp = (file) => {
    if (!file) return 'Selecione um arquivo.';
    if (file.type !== 'image/webp') return 'Apenas arquivos WebP sao permitidos para avatar.';
    if (file.size > 1024 * 1024) return 'Avatar muito grande. Limite: 1MB.';
    return '';
  };

  const normalizarAcessoAvatar = (item) => {
    const raw = item?.access;
    if (raw == null || String(raw).trim() === '') return 'publico';
    const v = String(raw).toLowerCase().trim();
    if (v === 'premium' || v === 'vip' || v === 'exclusivo_vip') return 'premium';
    if (v === 'publico' || v === 'public' || v === 'comum' || v === 'free') return 'publico';
    return 'premium';
  };

  const handleSelecionarArquivos = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) {
      setAvatarUploads([]);
      setUploadResultados([]);
      return;
    }

    const validos = [];
    const invalidos = [];
    files.forEach((file) => {
      const erro = validarAvatarWebp(file);
      if (erro) {
        invalidos.push({
          nome: file.name,
          status: 'erro',
          progresso: 0,
          detalhe: erro,
        });
      } else {
        validos.push(file);
      }
    });

    setAvatarUploads(validos);
    setUploadResultados([
      ...validos.map((file) => ({ nome: file.name, status: 'na_fila', progresso: 0, detalhe: 'Aguardando upload' })),
      ...invalidos,
    ]);
  };

  const handleUploadAvatar = async (e) => {
    e.preventDefault();
    if (loading) return;
    if (avatarUploads.length === 0) {
      setErroModal('Selecione ao menos um arquivo WebP valido para enviar.');
      return;
    }
    if (!isAdminUser(user)) {
      setErroModal('Sessao de admin invalida para upload. Entre novamente.');
      return;
    }

    setLoading(true);
    setPorcentagem(0);
    setProgressoMsg('Enviando lote de avatares...');
    activeTasksRef.current = [];
    setUploadResultados(
      avatarUploads.map((file) => ({
        nome: file.name,
        status: 'na_fila',
        progresso: 0,
        detalhe: 'Aguardando upload',
      }))
    );
    try {
      const total = avatarUploads.length;
      let concluidos = 0;
      const maxOrderAtual = avatares.reduce((max, item) => {
        if (typeof item.order !== 'number') return max;
        return item.order > max ? item.order : max;
      }, -1);

      for (let i = 0; i < avatarUploads.length; i += 1) {
        const arquivo = avatarUploads[i];
        const id = push(dbRef(db, 'avatares')).key;
        const path = `avatares/${id}.webp`;
        const fileRef = storageRef(storage, path);
        const task = uploadBytesResumable(fileRef, arquivo, {
          contentType: 'image/webp',
          customMetadata: {
            uploadedBy: user.uid,
          },
        });
        activeTasksRef.current.push(task);

        setUploadResultados((prev) =>
          prev.map((item) =>
            item.nome === arquivo.name
              ? { ...item, status: 'enviando', detalhe: `Enviando (${i + 1}/${total})` }
              : item
          )
        );

        try {
          await new Promise((resolve, reject) => {
            task.on(
              'state_changed',
              (snap) => {
                const progressoArquivo = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
                const progressoGlobal = Math.round((((concluidos) + (progressoArquivo / 100)) / total) * 100);
                setPorcentagem(progressoGlobal);
                setUploadResultados((prev) =>
                  prev.map((item) =>
                    item.nome === arquivo.name
                      ? { ...item, progresso: progressoArquivo, detalhe: `Enviando ${progressoArquivo}%` }
                      : item
                  )
                );
              },
              reject,
              resolve
            );
          });

          const url = await getDownloadURL(task.snapshot.ref);
          await set(dbRef(db, `avatares/${id}`), {
            url,
            storagePath: path,
            createdAt: Date.now(),
            active: true,
            order: maxOrderAtual + i + 1,
            access: uploadAcesso,
          });

          concluidos += 1;
          setUploadResultados((prev) =>
            prev.map((item) =>
              item.nome === arquivo.name
                ? { ...item, status: 'sucesso', progresso: 100, detalhe: 'Upload concluido' }
                : item
            )
          );
          setPorcentagem(Math.round((concluidos / total) * 100));
        } catch (err) {
          const cancelado = err?.code === 'storage/canceled';
          const permissaoNegada = err?.code === 'storage/unauthorized';
          setUploadResultados((prev) =>
            prev.map((item) =>
              item.nome === arquivo.name
                ? {
                    ...item,
                    status: cancelado ? 'cancelado' : 'erro',
                    detalhe: cancelado
                      ? 'Upload cancelado'
                      : permissaoNegada
                        ? 'Permissao negada (verifique regra do Storage e sessao admin).'
                        : (err.message || 'Falha no upload'),
                  }
                : item
            )
          );
          if (cancelado) {
            setProgressoMsg('Upload cancelado pelo administrador.');
            break;
          }
        }
      }

      setAvatarUploads([]);
      setProgressoMsg('Processo finalizado. Confira o resultado por arquivo abaixo.');
    } catch (err) {
      setErroModal(`Erro ao subir avatar: ${err.message}`);
    } finally {
      activeTasksRef.current = [];
      setLoading(false);
      setTimeout(() => setProgressoMsg(''), 2500);
    }
  };

  const handleCancelarUpload = () => {
    activeTasksRef.current.forEach((task) => {
      try {
        task.cancel();
      } catch {
        // no-op
      }
    });
  };

  const handleLimparEdicao = () => {
    if (loading) return;
    setAvatarUploads([]);
    setUploadResultados([]);
    setPorcentagem(0);
    setProgressoMsg('');
  };

  const handleRemoverAvatar = async (avatarId) => {
    if (!window.confirm('Remover este avatar da lista?')) return;
    try {
      const avatar = avatares.find((a) => a.id === avatarId);
      if (avatar?.storagePath) {
        await deleteObject(storageRef(storage, avatar.storagePath));
      }
      await remove(dbRef(db, `avatares/${avatarId}`));
    } catch (err) {
      setErroModal(`Nao foi possivel remover avatar: ${err.message}`);
    }
  };

  const persistirOrdemAvatares = async (listaOrdenada) => {
    const updates = {};
    listaOrdenada.forEach((item, index) => {
      updates[`avatares/${item.id}/order`] = index;
    });
    await update(dbRef(db), updates);
  };

  const handleDropAvatar = async (targetId) => {
    if (!draggingAvatarId || draggingAvatarId === targetId) return;
    const origem = avatares.findIndex((item) => item.id === draggingAvatarId);
    const destino = avatares.findIndex((item) => item.id === targetId);
    if (origem < 0 || destino < 0) return;

    const novaLista = [...avatares];
    const [movido] = novaLista.splice(origem, 1);
    novaLista.splice(destino, 0, movido);
    setAvatares(novaLista);

    try {
      await persistirOrdemAvatares(novaLista);
      setProgressoMsg('Ordem dos avatares salva.');
      setTimeout(() => setProgressoMsg(''), 2000);
    } catch (err) {
      setErroModal(`Nao foi possivel salvar ordem: ${err.message}`);
    } finally {
      setDraggingAvatarId(null);
    }
  };

  const handleAlterarAcessoAvatar = async (avatarId, nextAccess) => {
    const acesso = nextAccess === 'premium' ? 'premium' : 'publico';
    try {
      await update(dbRef(db, `avatares/${avatarId}`), { access: acesso });
      setProgressoMsg(`Avatar marcado como ${acesso === 'premium' ? 'Premium' : 'Público'}.`);
      setTimeout(() => setProgressoMsg(''), 1800);
    } catch (err) {
      setErroModal(`Nao foi possivel atualizar acesso do avatar: ${err.message}`);
    }
  };

  const avataresPublicos = avatares.filter((item) => normalizarAcessoAvatar(item) === 'publico');
  const avataresPremium = avatares.filter((item) => normalizarAcessoAvatar(item) === 'premium');
  const avataresFiltrados = avatares.filter((item) => {
    if (filtroAcesso === 'todos') return true;
    return normalizarAcessoAvatar(item) === filtroAcesso;
  });

  return (
    <div className="admin-panel">
      <ModalErro mensagem={erroModal} aoFechar={() => setErroModal('')} />
      <header className="admin-header">
        <h1>SHITO - FORJA DE AVATARES</h1>
        <button className="btn-voltar" onClick={() => navigate('/')}>Sair</button>
      </header>

      <main className="admin-container">
        <section className="list-section avatar-admin-section">
          <h2>CRUD - Avatares (WebP)</h2>
          <form className="avatar-upload-form" onSubmit={handleUploadAvatar}>
            <label>
              Subir Avatares WebP (max 1MB cada):
              <input
                type="file"
                accept="image/webp"
                multiple
                onChange={handleSelecionarArquivos}
              />
            </label>
            <div className="avatar-tier-fieldset" role="group" aria-label="Tipo do avatar enviado">
              <span className="avatar-tier-title">Destino do lote</span>
              <label className={`avatar-tier-chip ${uploadAcesso === 'publico' ? 'active' : ''}`}>
                <input
                  type="radio"
                  name="uploadAcesso"
                  value="publico"
                  checked={uploadAcesso === 'publico'}
                  onChange={() => setUploadAcesso('publico')}
                />
                Publico (todos usam)
              </label>
              <label className={`avatar-tier-chip ${uploadAcesso === 'premium' ? 'active' : ''}`}>
                <input
                  type="radio"
                  name="uploadAcesso"
                  value="premium"
                  checked={uploadAcesso === 'premium'}
                  onChange={() => setUploadAcesso('premium')}
                />
                Premium exclusivo
              </label>
            </div>
            <div className="avatar-upload-actions">
              <button type="submit" className="btn-save" disabled={loading}>
                {loading ? 'UPLOAD...' : 'SUBIR ARQUIVOS'}
              </button>
              {loading ? (
                <button type="button" className="btn-cancel" onClick={handleCancelarUpload}>
                  CANCELAR UPLOAD
                </button>
              ) : (
                <button type="button" className="btn-cancel" onClick={handleLimparEdicao}>
                  CANCELAR EDICAO
                </button>
              )}
            </div>
          </form>

          <div className="avatar-admin-toolbar">
            <p>
              Totais: <strong>{avatares.length}</strong> avatares | Publicos:{' '}
              <strong>{avataresPublicos.length}</strong> | Premium:{' '}
              <strong>{avataresPremium.length}</strong>
            </p>
            <div className="avatar-filter-chips" role="group" aria-label="Filtro por acesso">
              <button
                type="button"
                className={`avatar-filter-chip ${filtroAcesso === 'todos' ? 'active' : ''}`}
                onClick={() => setFiltroAcesso('todos')}
              >
                Todos
              </button>
              <button
                type="button"
                className={`avatar-filter-chip ${filtroAcesso === 'publico' ? 'active' : ''}`}
                onClick={() => setFiltroAcesso('publico')}
              >
                Publicos
              </button>
              <button
                type="button"
                className={`avatar-filter-chip ${filtroAcesso === 'premium' ? 'active' : ''}`}
                onClick={() => setFiltroAcesso('premium')}
              >
                Premium
              </button>
            </div>
          </div>

          {loading && (
            <div className="progress-container">
              <div className="progress-bar" style={{ width: `${porcentagem}%` }} />
              <p>{porcentagem}% - {progressoMsg}</p>
            </div>
          )}

          {!loading && progressoMsg && (
            <div className="progress-container">
              <div className="progress-bar" style={{ width: '100%' }} />
              <p>{progressoMsg}</p>
            </div>
          )}

          {uploadResultados.length > 0 && (
            <div className="avatar-upload-results">
              {uploadResultados.map((item) => (
                <div key={`${item.nome}-${item.status}-${item.detalhe}`} className={`avatar-upload-row ${item.status}`}>
                  <div className="avatar-upload-row-top">
                    <strong title={item.nome}>{item.nome}</strong>
                    <span>
                      {item.status === 'sucesso' && '✅ SUCESSO'}
                      {item.status === 'erro' && '❌ ERRO'}
                      {item.status === 'cancelado' && '⚠️ CANCELADO'}
                      {item.status === 'enviando' && '⏳ UPLOAD...'}
                      {item.status === 'na_fila' && '📦 NA FILA'}
                    </span>
                  </div>
                  {(item.status === 'enviando' || item.status === 'na_fila') && (
                    <div className="avatar-upload-row-progress">
                      <div style={{ width: `${item.progresso || 0}%` }} />
                    </div>
                  )}
                  <small>{item.detalhe}</small>
                </div>
              ))}
            </div>
          )}

          <div className="avatar-admin-grid">
            {avataresFiltrados.map((item) => {
              const acessoAtual = normalizarAcessoAvatar(item);
              return (
              <div
                key={item.id}
                className={`avatar-admin-card ${draggingAvatarId === item.id ? 'dragging' : ''}`}
                draggable
                onDragStart={() => setDraggingAvatarId(item.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleDropAvatar(item.id)}
                onDragEnd={() => setDraggingAvatarId(null)}
                style={{ cursor: 'grab' }}
              >
                <img src={item.url} alt="Avatar" />
                <small className={`avatar-access-badge ${acessoAtual}`}>
                  {acessoAtual === 'premium' ? 'PREMIUM' : 'PUBLICO'}
                </small>
                <small>Posicao: {typeof item.order === 'number' ? item.order + 1 : '-'}</small>
                <label className="avatar-access-select">
                  Acesso:
                  <select
                    value={acessoAtual}
                    onChange={(e) => handleAlterarAcessoAvatar(item.id, e.target.value)}
                  >
                    <option value="publico">Publico</option>
                    <option value="premium">Premium</option>
                  </select>
                </label>
                <button
                  type="button"
                  className="btn-delete"
                  onClick={() => handleRemoverAvatar(item.id)}
                >
                  REMOVER
                </button>
              </div>
            );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}
