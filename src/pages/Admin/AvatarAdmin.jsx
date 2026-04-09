import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, onValue, push, ref as dbRef, remove, set, update } from 'firebase/database';
import { getDownloadURL, ref as storageRef, uploadBytesResumable } from 'firebase/storage';
import { onAuthStateChanged } from 'firebase/auth';

import { auth, db, storage } from '../../services/firebase';
import { AVATAR_FALLBACK, AVATARES_BUNDLED } from '../../constants';
import { canAccessAdminPath } from '../../auth/adminPermissions';
import { emptyAdminAccess } from '../../auth/adminAccess';
import { normalizarAcessoAvatar } from '../../utils/avatarAccess';
import { safeDeleteStorageObject } from '../../utils/storageCleanup';
import './AdminPanel.css';
import './AvatarAdmin.css';

function ModalErro({ mensagem, aoFechar }) {
  if (!mensagem) return null;
  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-header">OPERACAO BLOQUEADA</div>
        <div className="modal-body">
          <p>{mensagem}</p>
        </div>
        <button onClick={aoFechar} className="btn-modal-close">CORRIGIR AGORA</button>
      </div>
    </div>
  );
}

function isBundledAvatarUrl(url) {
  return /^\/assets\/avatares\/ava\d+\.webp$/i.test(String(url || '').trim());
}

function toSafeNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function getAvatarCatalogKey(item) {
  const url = String(item?.url || '').trim();
  const storagePath = String(item?.storagePath || '').trim();
  if (isBundledAvatarUrl(url)) return `bundled:${url}`;
  if (storagePath) return `storage:${storagePath}`;
  if (url) return `url:${url}`;
  return `id:${String(item?.id || '').trim()}`;
}

function preferAvatarRecord(current, candidate) {
  const currentHasUrl = Boolean(String(current?.url || '').trim());
  const candidateHasUrl = Boolean(String(candidate?.url || '').trim());
  if (currentHasUrl !== candidateHasUrl) return candidateHasUrl;

  const currentHasStorage = Boolean(String(current?.storagePath || '').trim());
  const candidateHasStorage = Boolean(String(candidate?.storagePath || '').trim());
  if (currentHasStorage !== candidateHasStorage) return candidateHasStorage;

  const currentUpdated = Math.max(toSafeNumber(current?.updatedAt), toSafeNumber(current?.createdAt));
  const candidateUpdated = Math.max(toSafeNumber(candidate?.updatedAt), toSafeNumber(candidate?.createdAt));
  if (currentUpdated !== candidateUpdated) return candidateUpdated > currentUpdated;

  return String(candidate?.id || '').localeCompare(String(current?.id || '')) < 0;
}

function normalizeAvatarRows(data) {
  const deduped = new Map();
  const staleIds = [];
  const brokenIds = [];

  Object.entries(data || {}).forEach(([id, valores]) => {
    const row = {
      id,
      ...(valores && typeof valores === 'object' ? valores : {}),
    };
    const key = getAvatarCatalogKey(row);
    const hasValidUrl = Boolean(String(row.url || '').trim());
    if (!hasValidUrl) {
      brokenIds.push(id);
    }
    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, row);
      return;
    }
    if (preferAvatarRecord(existing, row)) {
      staleIds.push(existing.id);
      deduped.set(key, row);
      return;
    }
    staleIds.push(id);
  });

  const list = [...deduped.values()]
    .map((item) => ({
      ...item,
      hasValidUrl: Boolean(String(item.url || '').trim()),
      previewUrl: String(item.url || '').trim() || AVATAR_FALLBACK,
    }))
    .sort((a, b) => {
      const aOrder = typeof a.order === 'number' ? a.order : Number.MAX_SAFE_INTEGER;
      const bOrder = typeof b.order === 'number' ? b.order : Number.MAX_SAFE_INTEGER;
      if (aOrder !== bOrder) return aOrder - bOrder;
      const aUpdated = Math.max(toSafeNumber(a.updatedAt), toSafeNumber(a.createdAt));
      const bUpdated = Math.max(toSafeNumber(b.updatedAt), toSafeNumber(b.createdAt));
      return bUpdated - aUpdated;
    });

  return {
    list,
    staleCount: staleIds.length,
    brokenCount: brokenIds.length,
  };
}

export default function AvatarAdmin({ adminAccess = emptyAdminAccess() }) {
  const navigate = useNavigate();
  const [user, setUser] = useState(auth.currentUser);

  const [avatares, setAvatares] = useState([]);
  const [catalogHealth, setCatalogHealth] = useState({ staleCount: 0, brokenCount: 0 });
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
  const replaceInputsRef = useRef({});
  const canManageAvatars = canAccessAdminPath('/admin/avatares', adminAccess);
  const hasBundledGap = useMemo(
    () => AVATARES_BUNDLED.some((item) => !avatares.some((avatar) => String(avatar.url || '').trim() === item.url)),
    [avatares]
  );

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (current) => {
      setUser(current || null);
    });
    return () => unsubAuth();
  }, []);

  useEffect(() => {
    if (user === null) return;
    if (!canManageAvatars) {
      navigate('/');
      return;
    }

    const unsub = onValue(dbRef(db, 'avatares'), (snapshot) => {
      const data = snapshot.val();
      if (!data) {
        setAvatares([]);
        setCatalogHealth({ staleCount: 0, brokenCount: 0 });
        return;
      }
      const normalized = normalizeAvatarRows(data);
      setAvatares(normalized.list);
      setCatalogHealth({
        staleCount: normalized.staleCount,
        brokenCount: normalized.brokenCount,
      });
    });

    return () => unsub();
  }, [canManageAvatars, navigate, user]);

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

  const importarAvataresLocais = async () => {
    if (!canManageAvatars) {
      setErroModal('Sessao de admin invalida para importar avatares locais.');
      return;
    }
    setLoading(true);
    setProgressoMsg('Importando avatares locais do projeto...');
    setPorcentagem(0);
    try {
      const existentesSnap = await get(dbRef(db, 'avatares'));
      const existentes = existentesSnap.val() || {};
      const bundledByUrl = new Map(AVATARES_BUNDLED.map((item) => [item.url, item]));
      const usedByUrl = new Map(
        Object.entries(existentes).map(([id, row]) => [String(row?.url || '').trim(), { id, row: row || {} }])
      );
      const patch = {};
      AVATARES_BUNDLED.forEach((item, index) => {
        const existing = usedByUrl.get(item.url);
        const id = existing?.id || item.id;
        patch[`avatares/${id}`] = {
          ...(existing?.row || {}),
          url: item.url,
          storagePath: null,
          createdAt: Number(existing?.row?.createdAt || Date.now()),
          updatedAt: Date.now(),
          active: true,
          order: index,
          access: item.access,
          source: 'bundled',
          label: item.label,
        };
      });
      Object.entries(existentes).forEach(([id, row]) => {
        const current = row && typeof row === 'object' ? row : {};
        const currentUrl = String(current.url || '').trim();
        const bundledLike =
          current.source === 'bundled' ||
          id.startsWith('bundled_') ||
          isBundledAvatarUrl(currentUrl);
        if (!bundledLike) return;
        if (!currentUrl || !bundledByUrl.has(currentUrl)) {
          patch[`avatares/${id}`] = null;
        }
      });
      await update(dbRef(db), patch);
      setProgressoMsg('Avatares locais importados para o banco.');
      setTimeout(() => setProgressoMsg(''), 2200);
    } catch (err) {
      setErroModal(`Nao foi possivel importar os avatares locais: ${err.message}`);
    } finally {
      setLoading(false);
      setPorcentagem(0);
    }
  };

  const syncAvatarReferences = async ({ oldUrl, nextUrl }) => {
    const avatarUrl = String(oldUrl || '').trim();
    const replacementAvatarUrl = String(nextUrl || '').trim() || AVATAR_FALLBACK;
    if (!avatarUrl || avatarUrl === replacementAvatarUrl) return;

    const usuariosSnap = await get(dbRef(db, 'usuarios'));
    const usuarios = usuariosSnap.val() || {};
    const updates = {};

    Object.entries(usuarios).forEach(([uid, row]) => {
      if (!row || typeof row !== 'object') return;
      if (String(row.userAvatar || '').trim() === avatarUrl) {
        updates[`usuarios/${uid}/userAvatar`] = replacementAvatarUrl;
      }
      if (String(row.readerProfileAvatarUrl || '').trim() === avatarUrl) {
        updates[`usuarios/${uid}/readerProfileAvatarUrl`] = replacementAvatarUrl;
      }
      if (String(row?.publicProfile?.userAvatar || '').trim() === avatarUrl) {
        updates[`usuarios/${uid}/publicProfile/userAvatar`] = replacementAvatarUrl;
      }
      if (String(row?.publicProfile?.readerProfileAvatarUrl || '').trim() === avatarUrl) {
        updates[`usuarios/${uid}/publicProfile/readerProfileAvatarUrl`] = replacementAvatarUrl;
      }
    });

    if (Object.keys(updates).length) {
      await update(dbRef(db), updates);
    }
  };

  const uploadAvatarFileToPath = async ({ file, path }) => {
    const fileRef = storageRef(storage, path);
    const task = uploadBytesResumable(fileRef, file, {
      contentType: 'image/webp',
      customMetadata: {
        uploadedBy: user?.uid || '',
      },
    });
    activeTasksRef.current.push(task);

    await new Promise((resolve, reject) => {
      task.on('state_changed', undefined, reject, resolve);
    });

    const url = await getDownloadURL(task.snapshot.ref);
    return { url, storagePath: path };
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
    if (!canManageAvatars) {
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
      await auth.currentUser?.getIdToken?.(true);
      const avatar = avatares.find((a) => a.id === avatarId);
      if (!avatar) {
        await remove(dbRef(db, `avatares/${avatarId}`));
        setProgressoMsg('Registro de avatar removido.');
        setTimeout(() => setProgressoMsg(''), 2200);
        return;
      }
      const avatarUrl = String(avatar?.url || '').trim();
      const fallbackAvatarUrl =
        String(
          avatares.find((item) => item.id !== avatarId && normalizarAcessoAvatar(item) === 'publico' && item.hasValidUrl)?.url ||
          avatares.find((item) => item.id !== avatarId && item.hasValidUrl)?.url ||
          ''
        ).trim() || AVATAR_FALLBACK;
      const warnings = [];

      try {
        await syncAvatarReferences({ oldUrl: avatarUrl, nextUrl: fallbackAvatarUrl });
      } catch (err) {
        warnings.push(`referencias: ${err.message}`);
      }

      const storageTarget = String(avatar?.storagePath || avatar?.url || '').trim();
      if (storageTarget && !isBundledAvatarUrl(storageTarget)) {
        try {
          await safeDeleteStorageObject(storage, storageTarget);
        } catch (err) {
          warnings.push(`storage: ${err.message}`);
        }
      }
      await remove(dbRef(db, `avatares/${avatarId}`));
      setProgressoMsg(
        warnings.length
          ? `Avatar removido, mas houve limpeza parcial (${warnings.join(' | ')}).`
          : 'Avatar removido com limpeza no Storage e nos perfis.'
      );
      setTimeout(() => setProgressoMsg(''), 2200);
    } catch (err) {
      setErroModal(`Nao foi possivel remover avatar: ${err.message}`);
    }
  };

  const handleSubstituirAvatar = async (avatarId, file) => {
    const erroArquivo = validarAvatarWebp(file);
    if (erroArquivo) {
      setErroModal(erroArquivo);
      return;
    }

    const avatarAtual = avatares.find((item) => item.id === avatarId);
    if (!avatarAtual) {
      setErroModal('Avatar alvo nao encontrado para substituicao.');
      return;
    }

    setLoading(true);
    setProgressoMsg('Substituindo avatar...');
    setPorcentagem(0);
    activeTasksRef.current = [];

    try {
      await auth.currentUser?.getIdToken?.(true);
      const oldUrl = String(avatarAtual.url || '').trim();
      const oldStoragePath = String(avatarAtual.storagePath || '').trim();
      const nextStoragePath = `avatares/${avatarId}_${Date.now()}.webp`;
      const { url: nextUrl, storagePath } = await uploadAvatarFileToPath({
        file,
        path: nextStoragePath,
      });

      await update(dbRef(db), {
        [`avatares/${avatarId}/url`]: nextUrl,
        [`avatares/${avatarId}/storagePath`]: storagePath,
        [`avatares/${avatarId}/updatedAt`]: Date.now(),
      });

      await syncAvatarReferences({ oldUrl, nextUrl });

      if (oldStoragePath && oldStoragePath !== storagePath) {
        await safeDeleteStorageObject(storage, oldStoragePath);
      }

      setProgressoMsg('Avatar substituido com sucesso.');
      setTimeout(() => setProgressoMsg(''), 2200);
    } catch (err) {
      setErroModal(`Nao foi possivel substituir avatar: ${err.message}`);
    } finally {
      activeTasksRef.current = [];
      setLoading(false);
      const input = replaceInputsRef.current[avatarId];
      if (input) input.value = '';
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
      setProgressoMsg(`Avatar marcado como ${acesso === 'premium' ? 'Premium' : 'Publico'}.`);
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
        <h1>KOKUIN - FORJA DE AVATARES</h1>
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
              <strong>{avataresPremium.length}</strong> | Duplicados ocultos:{' '}
              <strong>{catalogHealth.staleCount}</strong> | Registros sem imagem:{' '}
              <strong>{catalogHealth.brokenCount}</strong>
            </p>
            <button
              type="button"
              className="btn-save"
              disabled={loading}
              onClick={importarAvataresLocais}
            >
              {hasBundledGap ? 'IMPORTAR AVATARES LOCAIS' : 'REIMPORTAR AVATARES LOCAIS'}
            </button>
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
                      {item.status === 'sucesso' && 'SUCESSO'}
                      {item.status === 'erro' && 'ERRO'}
                      {item.status === 'cancelado' && 'CANCELADO'}
                      {item.status === 'enviando' && 'UPLOAD...'}
                      {item.status === 'na_fila' && 'NA FILA'}
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
                <img
                  src={item.previewUrl}
                  alt={item.label || 'Avatar'}
                  onError={(e) => {
                    e.currentTarget.src = AVATAR_FALLBACK;
                  }}
                />
                {!item.hasValidUrl && (
                  <small className="avatar-record-warning">Registro sem imagem valida</small>
                )}
                <small className={`avatar-access-badge ${acessoAtual}`}>
                  {acessoAtual === 'premium' ? 'PREMIUM' : 'PUBLICO'}
                </small>
                <small>Posicao: {typeof item.order === 'number' ? item.order + 1 : '-'}</small>
                <label className="avatar-access-select">
                  Acesso:
                  <select
                    disabled={loading}
                    value={acessoAtual}
                    onChange={(e) => handleAlterarAcessoAvatar(item.id, e.target.value)}
                  >
                    <option value="publico">Publico</option>
                    <option value="premium">Premium</option>
                  </select>
                </label>
                <button
                  type="button"
                  className="btn-save"
                  disabled={loading}
                  onClick={() => replaceInputsRef.current[item.id]?.click()}
                >
                  SUBSTITUIR
                </button>
                <input
                  type="file"
                  accept="image/webp"
                  hidden
                  ref={(node) => {
                    replaceInputsRef.current[item.id] = node;
                  }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      handleSubstituirAvatar(item.id, file);
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn-delete"
                  disabled={loading}
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









