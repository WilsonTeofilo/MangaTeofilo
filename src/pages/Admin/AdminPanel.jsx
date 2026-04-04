import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ref as dbRef, onValue, update as dbUpdate, set, push, remove } from 'firebase/database';
import { ref as storageRef, uploadBytes, getDownloadURL, uploadBytesResumable } from 'firebase/storage';

import { db, storage, auth } from '../../services/firebase';
import {
  OBRA_PADRAO_ID,
  OBRA_SHITO_DEFAULT,
  ensureLegacyShitoObra,
  normalizarObraId,
  obterObraIdCapitulo,
  obraCreatorId,
} from '../../config/obras';
import { formatarDataHora24Br, formatarDataBrPartirIsoOuMs } from '../../utils/datasBr';
import {
  applyResponsiveDragDelta,
  buildResponsiveCropStyle,
  createResponsiveDragSnapshot,
  drawResponsiveCropToCanvas,
  getFullCropLayout,
  getResponsiveCropZoomBounds,
  normalizeResponsiveCropAdjustment,
} from '../../utils/responsiveCrop';
import './AdminPanel.css';

const IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const MAX_INPUT_IMAGE_SIZE_BYTES = 7 * 1024 * 1024;
const MAX_COMPRESSED_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
const TARGET_IMAGE_SIZE_BYTES = 2.2 * 1024 * 1024;
const MAX_IMAGE_DIMENSION_PX = 2400;
const CAPA_ASPECT_W = 16;
const CAPA_ASPECT_H = 9;
const CAPA_OUTPUT_WIDTH = 1600;
const CAPA_OUTPUT_HEIGHT = Math.round((CAPA_OUTPUT_WIDTH * CAPA_ASPECT_H) / CAPA_ASPECT_W);

function normalizarCapaAjuste(raw, dims = null) {
  const bounds = getResponsiveCropZoomBounds(dims, CAPA_OUTPUT_WIDTH, CAPA_OUTPUT_HEIGHT);
  const normalized = normalizeResponsiveCropAdjustment(raw, { maxZoom: bounds.maxZoom });
  return {
    ...normalized,
    zoom: Math.max(bounds.coverZoom, Number(normalized.zoom || bounds.coverZoom)),
  };
}

function validarImagemUpload(file, label = 'arquivo') {
  if (!file) return `${label} não encontrado.`;
  if (!IMAGE_TYPES.includes(file.type)) return `${label} invalido. Use JPG, PNG ou WEBP.`;
  if (file.size > MAX_INPUT_IMAGE_SIZE_BYTES) return `${label} excede 7MB.`;
  return '';
}

/** Storage rules exigem extensão .jpg|.png|.webp no último segmento do path. */
function extensaoImagemNoPath(file) {
  const fromName = (file?.name || '').match(/\.(jpe?g|png|webp)$/i);
  if (fromName) return fromName[0].toLowerCase().replace('jpeg', 'jpg');
  const t = file?.type || '';
  if (t === 'image/jpeg' || t === 'image/jpg') return '.jpg';
  if (t === 'image/png') return '.png';
  if (t === 'image/webp') return '.webp';
  return '.jpg';
}

function nomeArquivoComExtensao(name, novaExt) {
  const base = String(name || 'imagem')
    .replace(/\.[^/.]+$/, '')
    .replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${base}${novaExt}`;
}

function sanitizarSegmentoStorage(valor, fallback = 'item') {
  const limpo = String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return limpo || fallback;
}

function segmentoStorageOwnerUid(creatorIdResolved) {
  const raw = String(creatorIdResolved || '').trim();
  if (/^[A-Za-z0-9_-]{2,128}$/.test(raw)) return raw;
  return sanitizarSegmentoStorage(creatorIdResolved, 'shared');
}

function carregarImagem(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Nao foi possivel ler a imagem enviada.'));
    };
    img.src = url;
  });
}

function canvasParaBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Falha ao processar imagem.'));
        return;
      }
      resolve(blob);
    }, type, quality);
  });
}

async function blobWebpComLimite(canvas, maxBytes) {
  let quality = 0.92;
  let blob = await canvasParaBlob(canvas, 'image/webp', quality);
  for (let i = 0; i < 8 && blob.size > maxBytes; i += 1) {
    quality -= 0.08;
    blob = await canvasParaBlob(canvas, 'image/webp', Math.max(0.45, quality));
  }
  return blob;
}

async function comprimirImagemParaUpload(file) {
  if (file.size <= MAX_COMPRESSED_IMAGE_SIZE_BYTES) return file;

  const img = await carregarImagem(file);
  let width = img.naturalWidth || img.width;
  let height = img.naturalHeight || img.height;
  const maiorLado = Math.max(width, height);
  if (maiorLado > MAX_IMAGE_DIMENSION_PX) {
    const scale = MAX_IMAGE_DIMENSION_PX / maiorLado;
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
  }

  let quality = 0.9;
  let melhorBlob = null;
  for (let tentativa = 0; tentativa < 10; tentativa += 1) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Falha ao inicializar compressor de imagem.');
    ctx.drawImage(img, 0, 0, width, height);

    const blob = await canvasParaBlob(canvas, 'image/webp', quality);
    melhorBlob = blob;
    if (blob.size <= TARGET_IMAGE_SIZE_BYTES || blob.size <= MAX_COMPRESSED_IMAGE_SIZE_BYTES) {
      return new File(
        [blob],
        nomeArquivoComExtensao(file.name, '.webp'),
        { type: 'image/webp', lastModified: Date.now() }
      );
    }

    if (quality > 0.58) {
      quality -= 0.08;
    } else {
      width = Math.max(900, Math.round(width * 0.85));
      height = Math.max(900, Math.round(height * 0.85));
    }
  }

  if (!melhorBlob || melhorBlob.size > MAX_COMPRESSED_IMAGE_SIZE_BYTES) {
    throw new Error('Nao foi possivel otimizar a imagem para ate 5MB. Tente outra imagem.');
  }

  return new File(
    [melhorBlob],
    nomeArquivoComExtensao(file.name, '.webp'),
    { type: 'image/webp', lastModified: Date.now() }
  );
}

async function processarCapaParaUpload(file, ajuste = { zoom: 1, x: 0, y: 0 }) {
  const otimizada = await comprimirImagemParaUpload(file);
  const img = await carregarImagem(otimizada);
  const ajusteNormalizado = normalizarCapaAjuste(ajuste);

  let targetW = CAPA_OUTPUT_WIDTH;
  let targetH = CAPA_OUTPUT_HEIGHT;
  let blob = null;

  for (let tentativa = 0; tentativa < 6; tentativa += 1) {
    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Falha ao processar recorte da capa.');
    desenharCapaNoCanvas(ctx, img, targetW, targetH, ajusteNormalizado);

    blob = await blobWebpComLimite(canvas, MAX_COMPRESSED_IMAGE_SIZE_BYTES);
    if (blob && blob.size <= MAX_COMPRESSED_IMAGE_SIZE_BYTES) break;

    targetW = Math.max(960, Math.round(targetW * 0.86));
    targetH = Math.max(540, Math.round(targetH * 0.86));
  }

  if (!blob || blob.size > MAX_COMPRESSED_IMAGE_SIZE_BYTES) {
    throw new Error('Nao foi possivel otimizar a capa para ate 5MB. Tente outra imagem.');
  }

  return new File([blob], nomeArquivoComExtensao(file.name, '.webp'), {
    type: 'image/webp',
    lastModified: Date.now(),
  });
}

function desenharCapaNoCanvas(ctx, img, targetW, targetH, ajuste = { zoom: 1, x: 0, y: 0 }) {
  drawResponsiveCropToCanvas(ctx, img, targetW, targetH, ajuste, {
    backgroundColor: '#0b0d16',
    backgroundAlpha: 0.35,
  });
}

function capaEditorLayout() {
  return getFullCropLayout();
}

function estiloEditorCapa(dim, ajuste = { zoom: 1, x: 0, y: 0 }) {
  return buildResponsiveCropStyle(dim, ajuste, CAPA_OUTPUT_WIDTH, CAPA_OUTPUT_HEIGHT);
}

function maskBrDateTime(raw) {
  const digits = String(raw || '').replace(/\D/g, '').slice(0, 12);
  const dd = digits.slice(0, 2);
  const mm = digits.slice(2, 4);
  const yyyy = digits.slice(4, 8);
  const hh = digits.slice(8, 10);
  const min = digits.slice(10, 12);
  let out = '';
  if (dd) out += dd;
  if (mm) out += `/${mm}`;
  if (yyyy) out += `/${yyyy}`;
  if (hh) out += ` ${hh}`;
  if (min) out += `:${min}`;
  return out;
}

function parseBrDateTimeToMs(br) {
  const v = String(br || '').trim();
  const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?$/);
  if (!m) return null;
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = Number(m[3]);
  const hh = Number(m[4] || 0);
  const min = Number(m[5] || 0);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31 || hh < 0 || hh > 23 || min < 0 || min > 59) {
    return null;
  }
  const dt = new Date(yyyy, mm - 1, dd, hh, min, 0, 0);
  if (
    dt.getFullYear() !== yyyy ||
    dt.getMonth() !== mm - 1 ||
    dt.getDate() !== dd ||
    dt.getHours() !== hh ||
    dt.getMinutes() !== min
  ) {
    return null;
  }
  return dt.getTime();
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

// --- COMPONENTE: CARD DA PÁGINA ---
function PaginaCard({ index, url, onTrocar, onReordenar, total, onErro, onVer }) {
  const [valorInput, setValorInput] = useState(index + 1);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    setValorInput(index + 1);
  }, [index]);

  const validarEReordenar = () => {
    const valorDigitado = parseInt(valorInput, 10);
    if (Number.isNaN(valorDigitado)) {
      setValorInput(index + 1);
      return;
    }
    if (valorDigitado > total || valorDigitado < 1) {
      onErro(`Página ${valorDigitado} não existe! Este capítulo só tem ${total} páginas.`);
      setValorInput(index + 1);
      return;
    }
    const novoIndex = valorDigitado - 1;
    if (novoIndex !== index) onReordenar(index, novoIndex);
  };

  const handleDragStart = (e) => {
    e.dataTransfer.setData('indexOrigem', index);
    setIsDragging(true);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const indexOrigem = parseInt(e.dataTransfer.getData('indexOrigem'), 10);
    setIsDragging(false);
    if (!Number.isNaN(indexOrigem) && indexOrigem !== index) {
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
        <img src={url} alt={`página ${index + 1}`} draggable="false" />
      </div>

      <div className="pagina-card-actions">
        <button type="button" className="btn-revelar" onClick={onVer}>
          Ver página
        </button>
        <label className="btn-trocar">
          Trocar
          <input
            type="file"
            hidden
            accept="image/jpeg,image/jpg,image/png,image/webp"
            onChange={(e) => onTrocar(e.target.files[0])}
          />
        </label>
      </div>
    </div>
  );
}

function PaginaSelecionadaCard({ index, url, nome, total, onReordenar, onRemover, onErro, onVer }) {
  const [valorInput, setValorInput] = useState(index + 1);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    setValorInput(index + 1);
  }, [index]);

  const validarEReordenar = () => {
    const valorDigitado = parseInt(valorInput, 10);
    if (Number.isNaN(valorDigitado)) {
      setValorInput(index + 1);
      return;
    }
    if (valorDigitado > total || valorDigitado < 1) {
      onErro(`Página ${valorDigitado} não existe! Este capítulo só tem ${total} páginas selecionadas.`);
      setValorInput(index + 1);
      return;
    }
    const novoIndex = valorDigitado - 1;
    if (novoIndex !== index) onReordenar(index, novoIndex);
  };

  const handleDragStart = (e) => {
    e.dataTransfer.setData('indexOrigem', index);
    setIsDragging(true);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const indexOrigem = parseInt(e.dataTransfer.getData('indexOrigem'), 10);
    setIsDragging(false);
    if (!Number.isNaN(indexOrigem) && indexOrigem !== index) {
      onReordenar(indexOrigem, index);
    }
  };

  return (
    <div
      className={`pagina-edit-card pagina-edit-card--selecionada ${isDragging ? 'dragging' : ''}`}
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

      <span className="badge-pg">Nova {index + 1}</span>

      <div className="preview-placeholder">
        <img src={url} alt={`selecionada ${index + 1}`} draggable="false" />
      </div>

      <p className="arquivo-selecionado-nome" title={nome}>{nome}</p>
      <div className="pagina-card-actions">
        <button type="button" className="btn-revelar" onClick={onVer}>
          Ver página
        </button>
        <button type="button" className="btn-remover-pagina" onClick={() => onRemover(index)}>
          Remover
        </button>
      </div>
    </div>
  );
}

function ModalPreviewPagina({ aberto, itens, indiceInicial = 0, aoFechar }) {
  const limiteInicial = Math.max(0, (itens?.length || 0) - 1);
  const baseInicial = Number.isFinite(Number(indiceInicial)) ? Number(indiceInicial) : 0;
  const seguroInicial = Math.min(limiteInicial, Math.max(0, baseInicial));
  const [indiceAtual, setIndiceAtual] = useState(seguroInicial);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    if (!aberto || !itens.length) return;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') aoFechar();
      if (e.key === 'ArrowLeft') setIndiceAtual((i) => (i - 1 + itens.length) % itens.length);
      if (e.key === 'ArrowRight') setIndiceAtual((i) => (i + 1) % itens.length);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [aberto, itens.length, aoFechar]);

  if (!aberto || !itens.length) return null;
  const indiceSeguroAtual = Math.min(Math.max(0, indiceAtual), itens.length - 1);
  const atual = itens[indiceSeguroAtual];
  return (
    <div className="modal-preview-overlay" role="dialog" aria-modal="true">
      <div className="modal-preview-card">
        <header className="modal-preview-head">
          <strong>{atual?.nome || `Página ${indiceSeguroAtual + 1}`}</strong>
          <button type="button" className="btn-modal-close" onClick={aoFechar}>Fechar</button>
        </header>
        <div className="modal-preview-body">
          <img
            src={atual?.url}
            alt={atual?.nome || `preview ${indiceSeguroAtual + 1}`}
            style={{ transform: `scale(${zoom})` }}
          />
        </div>
        <footer className="modal-preview-actions">
          <button type="button" className="btn-revelar" onClick={() => setIndiceAtual((i) => (i - 1 + itens.length) % itens.length)}>
            ← Anterior
          </button>
          <span>{indiceSeguroAtual + 1} / {itens.length}</span>
          <button type="button" className="btn-revelar" onClick={() => setIndiceAtual((i) => (i + 1) % itens.length)}>
            Próxima →
          </button>
          <label className="modal-preview-zoom">
            Zoom ({zoom.toFixed(2)}x)
            <input type="range" min="1" max="3" step="0.05" value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
          </label>
        </footer>
      </div>
    </div>
  );
}

// --- COMPONENTE PRINCIPAL ---
export default function AdminPanel({ adminAccess, workspace = 'admin' }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const user = auth.currentUser;
  const chaptersHubPath = workspace === 'creator' ? '/creator/capitulos' : '/admin/capitulos';
  const isCreatorWorkspace = workspace === 'creator';
  const isMangaka = Boolean(adminAccess?.isMangaka);
  const obraIdSelecionada = normalizarObraId(searchParams.get('obra') || OBRA_PADRAO_ID);
  const capituloEditQueryId = String(searchParams.get('edit') || '').trim();

  const [titulo, setTitulo] = useState('');
  const [numeroCapitulo, setNumeroCapitulo] = useState('');
  const [capaCapitulo, setCapaCapitulo] = useState(null);
  const [capaAjuste, setCapaAjuste] = useState(normalizarCapaAjuste());
  const [_capaAjusteInicial, setCapaAjusteInicial] = useState(normalizarCapaAjuste());
  const [capaDimensoes, setCapaDimensoes] = useState(null);
  const [capaPreviewFinalUrl, setCapaPreviewFinalUrl] = useState('');
  const capaEditorRef = useRef(null);
  const dragCapaRef = useRef(null);
  const [arquivosPaginas, setArquivosPaginas] = useState([]);
  const [paginasExistentes, setPaginasExistentes] = useState([]);

  const [capitulos, setCapitulos] = useState([]);
  const [obras, setObras] = useState([]);
  /** Evita redirect falso: antes do 1º snapshot, o fallback da obra copiava creatorId legado (Shito). */
  const [obrasSnapshotReady, setObrasSnapshotReady] = useState(false);
  const [editandoId, setEditandoId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [progressoMsg, setProgressoMsg] = useState('');
  const [porcentagem, setPorcentagem] = useState(0);
  const [etapaAtiva, setEtapaAtiva] = useState(1);
  const [dragUploadAtivo, setDragUploadAtivo] = useState(false);
  const [modalPreview, setModalPreview] = useState({ aberto: false, origem: 'novas', indice: 0 });
  const [erroModal, setErroModal] = useState('');
  const [publicReleaseAtInput, setPublicReleaseAtInput] = useState('');
  const [antecipadoMembros, setAntecipadoMembros] = useState(true);
  const [capaFileLabel, setCapaFileLabel] = useState('');

  useEffect(() => {
    if (!adminAccess?.canAccessAdmin) {
      navigate('/');
      return;
    }

    setObrasSnapshotReady(false);

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
    const unsubObras = onValue(
      dbRef(db, 'obras'),
      (snapshot) => {
        if (!snapshot.exists()) {
          setObras([{ ...OBRA_SHITO_DEFAULT, id: OBRA_PADRAO_ID }]);
        } else {
          const lista = ensureLegacyShitoObra(
            Object.entries(snapshot.val() || {}).map(([id, valores]) => ({ id, ...(valores || {}) }))
          );
          setObras(lista);
        }
        setObrasSnapshotReady(true);
      },
      () => {
        setObras([{ ...OBRA_SHITO_DEFAULT, id: OBRA_PADRAO_ID }]);
        setObrasSnapshotReady(true);
      }
    );

    return () => {
      unsubscribe();
      unsubObras();
    };
  }, [user, navigate, adminAccess?.canAccessAdmin]);

  const previewsPaginasSelecionadas = useMemo(
    () =>
      arquivosPaginas.map((file, idx) => ({
        key: `${file.name}_${file.lastModified}_${file.size}_${idx}`,
        nome: file.name || `pagina_${idx + 1}`,
        url: URL.createObjectURL(file),
      })),
    [arquivosPaginas]
  );

  const capaPreviewUrl = useMemo(() => {
    if (!capaCapitulo) return '';
    return URL.createObjectURL(capaCapitulo);
  }, [capaCapitulo]);
  const capituloEditando = useMemo(
    () => capitulos.find((c) => c.id === editandoId) || null,
    [capitulos, editandoId]
  );
  const obraSelecionada = useMemo(() => {
    const obra = obras.find((o) => normalizarObraId(o.id) === obraIdSelecionada);
    if (obra) return obra;
    if (isMangaka && !obrasSnapshotReady && user?.uid) {
      return {
        id: obraIdSelecionada,
        slug: obraIdSelecionada,
        titulo: 'Carregando obra…',
        tituloCurto: '',
        creatorId: user.uid,
      };
    }
    return { ...OBRA_SHITO_DEFAULT, id: obraIdSelecionada, slug: obraIdSelecionada };
  }, [obras, obraIdSelecionada, isMangaka, obrasSnapshotReady, user?.uid]);
  const ownerUidStorage = useMemo(
    () => segmentoStorageOwnerUid(obraCreatorId(obraSelecionada) || user?.uid),
    [obraSelecionada, user?.uid]
  );
  const obraStorageSegment = useMemo(
    () => sanitizarSegmentoStorage(
      obraSelecionada?.slug || obraSelecionada?.id || obraSelecionada?.tituloCurto || titulo,
      'obra'
    ),
    [obraSelecionada, titulo]
  );

  useEffect(() => {
    if (!adminAccess?.isMangaka || !user?.uid || !obrasSnapshotReady) return;
    const match = obras.find((o) => normalizarObraId(o.id) === obraIdSelecionada);
    if (!match) {
      navigate(chaptersHubPath);
      return;
    }
    if (obraCreatorId(match) !== user.uid) {
      navigate(chaptersHubPath);
    }
  }, [
    adminAccess?.isMangaka,
    user?.uid,
    obrasSnapshotReady,
    obras,
    obraIdSelecionada,
    navigate,
    chaptersHubPath,
  ]);

  const capitulosDaObra = useMemo(
    () =>
      capitulos
        .filter((cap) => obterObraIdCapitulo(cap) === obraIdSelecionada)
        .sort((a, b) => Number(a.numero || 0) - Number(b.numero || 0)),
    [capitulos, obraIdSelecionada]
  );
  const capaVisualSrc = capaPreviewUrl || capituloEditando?.capaUrl || '/assets/fotos/shito.jpg';
  const capaFonteEditavel = capaPreviewUrl || capituloEditando?.capaUrl || '';
  const capaEditavel = Boolean(capaPreviewUrl || capituloEditando?.capaUrl);
  const capaEditorImageStyle = useMemo(
    () => estiloEditorCapa(capaDimensoes, capaAjuste),
    [capaDimensoes, capaAjuste]
  );
  const capaZoomBounds = useMemo(
    () => getResponsiveCropZoomBounds(capaDimensoes, CAPA_OUTPUT_WIDTH, CAPA_OUTPUT_HEIGHT),
    [capaDimensoes]
  );
  const capaCrop = useMemo(() => capaEditorLayout(), []);
  const itensPreviewNovas = useMemo(
    () => previewsPaginasSelecionadas.map((p, idx) => ({ url: p.url, nome: `Nova página ${idx + 1}` })),
    [previewsPaginasSelecionadas]
  );
  const itensPreviewAtuais = useMemo(
    () => paginasExistentes.map((url, idx) => ({ url, nome: `Página ${idx + 1}` })),
    [paginasExistentes]
  );
  const itensModalPreview = modalPreview.origem === 'atuais' ? itensPreviewAtuais : itensPreviewNovas;
  const totalPaginasAtual = paginasExistentes.length + arquivosPaginas.length;
  const statusRevisao = publicReleaseAtInput?.trim()
    ? 'Agendado'
    : (totalPaginasAtual > 0 ? 'Publicado ao salvar' : 'Rascunho');
  const checklistPublicacao = useMemo(() => {
    const etapa1 = Boolean((capaCapitulo || capituloEditando?.capaUrl) && totalPaginasAtual > 0);
    const etapa2 = totalPaginasAtual > 0;
    const etapa3 = Boolean(capaCapitulo || capituloEditando?.capaUrl);
    const etapa4 = Boolean(String(titulo || '').trim() && Number(numeroCapitulo) > 0);
    const etapa5 = etapa1 && etapa2 && etapa3 && etapa4;
    return [
      { id: 1, label: 'Upload (capa e páginas)', ok: etapa1 },
      { id: 2, label: 'Organizar páginas', ok: etapa2 },
      { id: 3, label: 'Ajustar capa', ok: etapa3 },
      { id: 4, label: 'Revisar metadados', ok: etapa4 },
      { id: 5, label: 'Publicar', ok: etapa5 },
    ];
  }, [capaCapitulo, capituloEditando?.capaUrl, numeroCapitulo, titulo, totalPaginasAtual]);
  const etapaUploadCompleta = Boolean((capaCapitulo || capituloEditando?.capaUrl) && totalPaginasAtual > 0);
  const etapaOrganizacaoCompleta = totalPaginasAtual > 0;
  const etapaCapaCompleta = Boolean(capaCapitulo || capituloEditando?.capaUrl);
  const etapaRevisaoCompleta = Boolean(String(titulo || '').trim() && Number(numeroCapitulo) > 0);
  const etapaLiberadaMax = useMemo(() => {
    if (!etapaUploadCompleta) return 1;
    if (!etapaOrganizacaoCompleta) return 2;
    if (!etapaCapaCompleta) return 3;
    if (!etapaRevisaoCompleta) return 4;
    return 5;
  }, [
    etapaCapaCompleta,
    etapaOrganizacaoCompleta,
    etapaRevisaoCompleta,
    etapaUploadCompleta,
  ]);
  const irParaEtapa = useCallback((etapaDestino) => {
    const destino = Math.max(1, Math.min(5, Number(etapaDestino) || 1));
    setEtapaAtiva(Math.min(destino, etapaLiberadaMax));
  }, [etapaLiberadaMax]);

  useEffect(() => {
    return () => {
      previewsPaginasSelecionadas.forEach((p) => URL.revokeObjectURL(p.url));
    };
  }, [previewsPaginasSelecionadas]);

  useEffect(() => {
    return () => {
      if (capaPreviewUrl) URL.revokeObjectURL(capaPreviewUrl);
    };
  }, [capaPreviewUrl]);

  useEffect(() => {
    let ativo = true;
    if (!capaFonteEditavel) {
      setCapaDimensoes(null);
      return () => {};
    }
    const img = new Image();
    img.onload = () => {
      if (!ativo) return;
      setCapaDimensoes({
        w: Number(img.naturalWidth || img.width || 0),
        h: Number(img.naturalHeight || img.height || 0),
      });
    };
    img.onerror = () => {
      if (!ativo) return;
      setCapaDimensoes(null);
    };
    img.src = capaFonteEditavel;
    return () => {
      ativo = false;
    };
  }, [capaFonteEditavel]);

  useEffect(() => {
    if (!capaDimensoes) return;
    setCapaAjuste((prev) => normalizarCapaAjuste(prev, capaDimensoes));
  }, [capaDimensoes]);

  useEffect(() => {
    let ativo = true;
    let objectUrl = '';
    if (!capaFonteEditavel) {
      setCapaPreviewFinalUrl((prev) => {
        if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
        return '';
      });
      return () => {
        ativo = false;
      };
    }
    const img = new Image();
    img.onload = () => {
      if (!ativo) return;
      const canvas = document.createElement('canvas');
      canvas.width = 1280;
      canvas.height = Math.round((1280 * CAPA_ASPECT_H) / CAPA_ASPECT_W);
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) return;
      desenharCapaNoCanvas(ctx, img, canvas.width, canvas.height, capaAjuste);
      canvas.toBlob((blob) => {
        if (!ativo || !blob) return;
        objectUrl = URL.createObjectURL(blob);
        setCapaPreviewFinalUrl((prev) => {
          if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
          return objectUrl;
        });
      }, 'image/webp', 0.9);
    };
    img.onerror = () => {
      if (!ativo) return;
      setCapaPreviewFinalUrl((prev) => {
        if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
        return '';
      });
    };
    img.src = capaFonteEditavel;

    return () => {
      ativo = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [capaFonteEditavel, capaAjuste]);

  useEffect(() => {
    if (!capituloEditQueryId) return;
    const cap = capitulosDaObra.find((item) => item.id === capituloEditQueryId);
    if (!cap) return;
    if (editandoId === cap.id) return;
    setEditandoId(cap.id);
    setTitulo(cap.titulo || '');
    setNumeroCapitulo(cap.numero || '');
    setPaginasExistentes(cap.paginas || []);
    setCapaCapitulo(null);
    const ajusteExistente = normalizarCapaAjuste(cap.capaAjuste);
    setCapaAjuste(ajusteExistente);
    setCapaAjusteInicial(ajusteExistente);
    setEtapaAtiva(2);
    setPublicReleaseAtInput(formatarDataHora24Br(cap.publicReleaseAt));
    setAntecipadoMembros(Boolean(cap.antecipadoMembros));
  }, [capituloEditQueryId, capitulosDaObra, editandoId]);

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
      setProgressoMsg(`Otimizando página ${index + 1}...`);
      const arquivoOtimizado = await comprimirImagemParaUpload(arquivoNovo);
      const pathStorage = `manga/${ownerUidStorage}/${obraStorageSegment}/pg_${index}_${Date.now()}${extensaoImagemNoPath(arquivoOtimizado)}`;
      const fileRef = storageRef(storage, pathStorage);
      await uploadBytes(fileRef, arquivoOtimizado);
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

  const handleUploadManga = async (arquivos) => {
    const urls = [];
    for (let i = 0; i < arquivos.length; i++) {
      const erroArquivo = validarImagemUpload(arquivos[i], `Pagina ${i + 1}`);
      if (erroArquivo) {
        throw new Error(erroArquivo);
      }
      setProgressoMsg(`Otimizando página ${i + 1}/${arquivos.length}...`);
      const arquivoOtimizado = await comprimirImagemParaUpload(arquivos[i]);
      const pathStorage = `manga/${ownerUidStorage}/${obraStorageSegment}/p_${i}_${Date.now()}${extensaoImagemNoPath(arquivoOtimizado)}`;
      const fileRef = storageRef(storage, pathStorage);
      const uploadTask = uploadBytesResumable(fileRef, arquivoOtimizado);
      
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

  const handleSelecionarArquivosPaginas = (fileList) => {
    const novos = Array.from(fileList || []);
    if (!novos.length) return;
    const erros = novos
      .map((file, idx) => validarImagemUpload(file, `Pagina ${idx + 1}`))
      .filter(Boolean);
    if (erros.length) {
      setErroModal(erros[0]);
      return;
    }
    setArquivosPaginas((prev) => [...prev, ...novos]);
    if (capaCapitulo || capituloEditando?.capaUrl) {
      setEtapaAtiva(2);
    }
  };

  const handleSelecionarCapa = (file) => {
    if (!file) return;
    const erro = validarImagemUpload(file, 'Capa');
    if (erro) {
      setErroModal(erro);
      return;
    }
    setCapaCapitulo(file);
    setCapaFileLabel(String(file.name || 'arquivo selecionado').trim() || 'arquivo selecionado');
    const ajustePadrao = normalizarCapaAjuste();
    setCapaAjuste(ajustePadrao);
    setCapaAjusteInicial(ajustePadrao);
    if (totalPaginasAtual > 0) {
      setEtapaAtiva(2);
    }
  };

  const iniciarArrasteCapa = (event) => {
    if (!capaEditavel || !capaEditorRef.current || !capaDimensoes) return;
    event.preventDefault();
    const clientX = event.clientX ?? event.touches?.[0]?.clientX ?? 0;
    const clientY = event.clientY ?? event.touches?.[0]?.clientY ?? 0;
    const box = capaEditorRef.current.getBoundingClientRect();
    const dragSnapshot = createResponsiveDragSnapshot(
      capaDimensoes.w,
      capaDimensoes.h,
      Math.max(1, box.width),
      Math.max(1, box.height),
      capaAjuste,
      { maxZoomCap: capaZoomBounds.maxZoom }
    );
    dragCapaRef.current = {
      startX: clientX,
      startY: clientY,
      ajuste: capaAjuste,
      dragSnapshot,
    };
    document.body.style.userSelect = 'none';
  };

  useEffect(() => {
    const onMove = (event) => {
      if (!dragCapaRef.current) return;
      if (event.cancelable) event.preventDefault();
      const drag = dragCapaRef.current;
      const clientX = event.clientX ?? event.touches?.[0]?.clientX ?? 0;
      const clientY = event.clientY ?? event.touches?.[0]?.clientY ?? 0;
      const deltaX = clientX - drag.startX;
      const deltaY = clientY - drag.startY;
      setCapaAjuste(
        applyResponsiveDragDelta(drag.ajuste, drag.dragSnapshot, deltaX, deltaY, {
          maxZoomCap: capaZoomBounds.maxZoom,
        })
      );
    };

    const onUp = () => {
      if (!dragCapaRef.current) return;
      dragCapaRef.current = null;
      document.body.style.userSelect = '';
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
      document.body.style.userSelect = '';
    };
  }, [capaZoomBounds.maxZoom]);

  const handleReordenarSelecionada = (indexAntigo, indexNovo) => {
    if (indexNovo < 0 || indexNovo >= arquivosPaginas.length) return;
    setArquivosPaginas((prev) => {
      const next = [...prev];
      const [movida] = next.splice(indexAntigo, 1);
      next.splice(indexNovo, 0, movida);
      return next;
    });
  };

  const handleRemoverSelecionada = (index) => {
    setArquivosPaginas((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;
    if (etapaAtiva !== 5) {
      setErroModal('Finalize as etapas até "Publicar" para lançar o capítulo.');
      return;
    }

    setLoading(true);
    setProgressoMsg('Sincronizando...');
    try {
      const numeroNormalizado = parseInt(numeroCapitulo, 10);
      if (!Number.isFinite(numeroNormalizado) || numeroNormalizado <= 0) {
        throw new Error('Número do capítulo inválido.');
      }
      const jaExisteMesmoNumeroNaObra = capitulos.some((cap) => (
        cap.id !== editandoId &&
        Number(cap.numero) === numeroNormalizado &&
        obterObraIdCapitulo(cap) === obraIdSelecionada
      ));
      if (jaExisteMesmoNumeroNaObra) {
        throw new Error(`Já existe capítulo #${numeroNormalizado} nessa obra.`);
      }

      let urlCapa = null;
      let urlsPaginas = [];
      const ajusteNormalizado = normalizarCapaAjuste(capaAjuste);

      if (capaCapitulo) {
        const erroCapa = validarImagemUpload(capaCapitulo, 'Capa');
        if (erroCapa) {
          throw new Error(erroCapa);
        }
        setProgressoMsg('Otimizando e ajustando capa...');
        const capaOtimizada = await processarCapaParaUpload(capaCapitulo, capaAjuste);
        const capaRef = storageRef(
          storage,
          `capas/${ownerUidStorage}/${Date.now()}_${nomeArquivoComExtensao(capaOtimizada.name, '.webp')}`
        );
        await uploadBytes(capaRef, capaOtimizada);
        urlCapa = await getDownloadURL(capaRef);
      }

      if (arquivosPaginas.length > 0) {
        arquivosPaginas.forEach((file, idx) => {
          const erro = validarImagemUpload(file, `Pagina ${idx + 1}`);
          if (erro) throw new Error(erro);
        });
        urlsPaginas = await handleUploadManga(arquivosPaginas);
      }

      const dados = {
        titulo,
        numero: numeroNormalizado,
        obraId: obraIdSelecionada,
        workId: obraIdSelecionada,
        obraTitulo: String(obraSelecionada?.tituloCurto || obraSelecionada?.titulo || obraIdSelecionada),
        dataUpload: new Date().toISOString(),
        creatorId: obraCreatorId(obraSelecionada),
      };

      let publicMs = null;
      if (publicReleaseAtInput?.trim()) {
        const parsed = parseBrDateTimeToMs(publicReleaseAtInput);
        if (parsed == null) {
          throw new Error('Data de lançamento inválida. Use o formato dd/mm/aaaa hh:mm.');
        }
        publicMs = parsed;
      }
      dados.publicReleaseAt = publicMs;
      dados.antecipadoMembros = Boolean(antecipadoMembros);

      if (urlCapa) dados.capaUrl = urlCapa;
      if (urlCapa || capaEditavel) dados.capaAjuste = ajusteNormalizado;
      if (urlsPaginas.length > 0) dados.paginas = urlsPaginas;

      if (editandoId) {
        await dbUpdate(dbRef(db, `capitulos/${editandoId}`), dados);
      } else {
        if (!urlCapa || (urlsPaginas.length === 0 && arquivosPaginas.length === 0)) {
            throw new Error("Obrigatório: Capa + Arquivos.");
        }
        await set(push(dbRef(db, 'capitulos')), dados);
      }

      setEditandoId(null);
      setTitulo('');
      setNumeroCapitulo('');
      setPaginasExistentes([]);
      setArquivosPaginas([]);
      setCapaCapitulo(null);
      const ajustePadrao = normalizarCapaAjuste();
      setCapaAjuste(ajustePadrao);
      setCapaAjusteInicial(ajustePadrao);
      setEtapaAtiva(1);
      setPublicReleaseAtInput('');
      setAntecipadoMembros(true);
      setCapaFileLabel('');
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
    setCapaCapitulo(null);
    setCapaFileLabel(cap.capaUrl ? 'Capa atual no servidor (selecione outra para substituir)' : '');
    const ajusteExistente = normalizarCapaAjuste(cap.capaAjuste);
    setCapaAjuste(ajusteExistente);
    setCapaAjusteInicial(ajusteExistente);
    setEtapaAtiva(2);
    setPublicReleaseAtInput(formatarDataHora24Br(cap.publicReleaseAt));
    setAntecipadoMembros(Boolean(cap.antecipadoMembros));
    window.scrollTo(0, 0);
  };

  const cancelarEdicao = () => {
    const ajustePadrao = normalizarCapaAjuste();
    setEditandoId(null);
    setTitulo('');
    setNumeroCapitulo('');
    setPaginasExistentes([]);
    setArquivosPaginas([]);
    setCapaCapitulo(null);
    setCapaAjuste(ajustePadrao);
    setCapaAjusteInicial(ajustePadrao);
    setEtapaAtiva(1);
    setPublicReleaseAtInput('');
    setAntecipadoMembros(true);
    setCapaFileLabel('');
    navigate(chaptersHubPath);
  };

  return (
    <div className="admin-panel">
      <ModalErro mensagem={erroModal} aoFechar={() => setErroModal('')} />
      {modalPreview.aberto && (
        <ModalPreviewPagina
          key={`${modalPreview.origem}_${modalPreview.indice}_${itensModalPreview.length}`}
          aberto={modalPreview.aberto}
          itens={itensModalPreview}
          indiceInicial={modalPreview.indice}
          aoFechar={() => setModalPreview({ aberto: false, origem: 'novas', indice: 0 })}
        />
      )}

      <header className="admin-header">
        <h1>
          {(obraSelecionada?.tituloCurto || 'Obra').toUpperCase()}
          {isMangaka ? ' - ESTUDIO DE CAPITULOS' : isCreatorWorkspace ? ' - OPERACAO DE CAPITULOS' : ' - FORJA DO AUTOR'}
        </h1>
        <button className="btn-voltar" onClick={() => navigate(chaptersHubPath)}>
          {isMangaka ? 'Voltar para meus capitulos' : 'Voltar capítulos'}
        </button>
      </header>

      <main className="admin-container">
        <section className="admin-obra-context">
          <p>Obra selecionada</p>
          <strong>{obraSelecionada?.titulo || obraIdSelecionada}</strong>
          <span>Slug: {obraSelecionada?.slug || obraIdSelecionada}</span>
        </section>
        <section className="form-section">
          <h2>
            {editandoId
              ? `${isMangaka ? 'Editar meu capitulo' : 'Editar capítulo'} — ${obraSelecionada?.tituloCurto || obraSelecionada?.titulo}`
              : `${isMangaka ? 'Criar capitulo' : 'Criar capítulo'} — ${obraSelecionada?.tituloCurto || obraSelecionada?.titulo}`}
          </h2>
          
          <form onSubmit={handleSubmit} className="admin-form">
            <div className="input-row">
              <input type="number" placeholder="Nº" value={numeroCapitulo} onChange={(e) => setNumeroCapitulo(e.target.value)} required />
              <input type="text" placeholder="Título" value={titulo} onChange={(e) => setTitulo(e.target.value)} required />
            </div>

            <div className="lancamento-block">
              <label className="lancamento-label">
                Lançamento público (opcional)
                <input
                  type="text"
                  inputMode="numeric"
                  className="lancamento-datetime"
                  placeholder="dd/mm/aaaa hh:mm"
                  value={publicReleaseAtInput}
                  onChange={(e) => setPublicReleaseAtInput(maskBrDateTime(e.target.value))}
                />
              </label>
              <p className="lancamento-help">
               {isMangaka
                 ? 'Deixe vazio para publicar agora. Com data futura, o capitulo fica em breve ate a abertura publica.'
                 : 'Data vazia = ja publico. Com data futura, o capitulo fica em breve ate o horario. Se a opcao abaixo estiver marcada, membros ativos do criador podem ler antes da abertura publica.'}
              </p>
              <label className="lancamento-check">
                <input
                  type="checkbox"
                  checked={antecipadoMembros}
                  onChange={(e) => setAntecipadoMembros(e.target.checked)}
                />
                Membros com membership ativa do criador leem antes do horario publico
              </label>
            </div>

            <div className="editor-steps">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`editor-step-chip${etapaAtiva === n ? ' active' : ''}`}
                  disabled={n > etapaLiberadaMax}
                  onClick={() => irParaEtapa(n)}
                >
                  {n === 1 && '1. Upload'}
                  {n === 2 && '2. Organizar'}
                  {n === 3 && '3. Ajustar capa'}
                  {n === 4 && '4. Revisar'}
                  {n === 5 && '5. Publicar'}
                </button>
              ))}
            </div>

            {etapaAtiva === 1 && (
              <div className="editor-step-panel">
                <div
                  className={`upload-dropzone${dragUploadAtivo ? ' is-active' : ''}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragUploadAtivo(true);
                  }}
                  onDragLeave={() => setDragUploadAtivo(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragUploadAtivo(false);
                    handleSelecionarArquivosPaginas(e.dataTransfer.files);
                  }}
                >
                  <h3>Envie as páginas do capítulo</h3>
                  <p>{isMangaka ? 'Arraste paginas aqui para montar seu capitulo.' : 'Arraste e solte imagens aqui, ou use o seletor abaixo.'}</p>
                </div>
                <div className="file-inputs">
                  <label className="admin-capa-file-label">
                    <span className="admin-capa-file-label__text">Capa do capítulo</span>
                    {capaFileLabel ? (
                      <span className="admin-capa-file-name" title={capaFileLabel}>
                        {capaFileLabel}
                      </span>
                    ) : (
                      <span className="admin-capa-file-name admin-capa-file-name--empty">Nenhum arquivo selecionado</span>
                    )}
                    <input
                      type="file"
                      accept="image/jpeg,image/jpg,image/png,image/webp"
                      onChange={(e) => handleSelecionarCapa(e.target.files?.[0])}
                    />
                  </label>
                  <label>
                    Páginas (múltiplas)
                    <input
                      type="file"
                      multiple
                      accept="image/jpeg,image/jpg,image/png,image/webp"
                      onChange={(e) => {
                        handleSelecionarArquivosPaginas(e.target.files);
                        e.target.value = '';
                      }}
                    />
                  </label>
                </div>
              </div>
            )}

            {etapaAtiva === 2 && (
              <div className="editor-step-panel">
                {editandoId && paginasExistentes.length > 0 && (
                  <div className="cirurgia-paginas">
                    <div className="cirurgia-header">
                      <div className="cirurgia-info">
                        <h3>Páginas atuais ({paginasExistentes.length})</h3>
                    <p>{isMangaka ? 'Reordene paginas, revise e troque trechos sem perder o fluxo.' : 'Arraste para reordenar, visualize em modal e troque páginas pontuais.'}</p>
                      </div>
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
                          onErro={setErroModal}
                          onVer={() => setModalPreview({ aberto: true, origem: 'atuais', indice: index })}
                        />
                      ))}
                    </div>
                  </div>
                )}

                <div className="cirurgia-paginas">
                  <div className="cirurgia-header">
                    <div className="cirurgia-info">
                      <h3>Pré-visualização das novas páginas ({arquivosPaginas.length})</h3>
                      <p>{isMangaka ? 'Confira as novas paginas antes de publicar.' : 'Cards com thumbnail, preview em modal, remoção e reorder por arraste.'}</p>
                    </div>
                  </div>
                  {arquivosPaginas.length > 0 ? (
                    <div className="paginas-edit-grid">
                      {previewsPaginasSelecionadas.map((preview, index) => (
                        <PaginaSelecionadaCard
                          key={preview.key}
                          index={index}
                          url={preview.url}
                          nome={preview.nome}
                          total={previewsPaginasSelecionadas.length}
                          onReordenar={handleReordenarSelecionada}
                          onRemover={handleRemoverSelecionada}
                          onErro={setErroModal}
                          onVer={() => setModalPreview({ aberto: true, origem: 'novas', indice: index })}
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="editor-empty">Nenhuma nova página selecionada ainda.</p>
                  )}
                </div>
              </div>
            )}

            {etapaAtiva === 3 && (
              <div className="capa-ajuste-bloco">
                <div className="cirurgia-header">
                  <div className="cirurgia-info">
                    <h3>Ajuste da capa (16:9)</h3>
                    <p>{isMangaka ? 'Ajuste a capa que vai aparecer no catalogo e no leitor.' : 'Arraste na imagem e use sliders de ajuste fino. A prévia final replica o resultado real.'}</p>
                  </div>
                </div>

                <div className="capa-ajuste-grid">
                  <div className="capa-preview-frame">
                    <div
                      ref={capaEditorRef}
                      className={`capa-preview-mask capa-preview-mask--editor${capaEditavel ? ' is-editable' : ''}`}
                      onMouseDown={iniciarArrasteCapa}
                    onTouchStart={iniciarArrasteCapa}
                      title={capaEditavel ? 'Clique e arraste para mover o enquadramento' : 'Selecione uma capa para editar'}
                    >
                      <img
                        src={capaVisualSrc}
                        alt=""
                        aria-hidden="true"
                        className="capa-preview-img capa-preview-img--background"
                      />
                      <img
                        src={capaVisualSrc}
                        alt={capaEditavel ? 'Prévia da capa ajustada' : 'Prévia da capa atual'}
                        className={`capa-preview-img capa-preview-img--foreground${capaEditavel ? '' : ' capa-preview-img--faded'}`}
                        style={capaEditavel ? capaEditorImageStyle : undefined}
                      />
                      <div className="capa-editor-outside-mask" aria-hidden="true">
                        <i style={{ left: 0, top: 0, width: '100%', height: `${capaCrop.topPct}%` }} />
                        <i style={{ left: 0, top: `${capaCrop.topPct + capaCrop.heightPct}%`, width: '100%', height: `${capaCrop.topPct}%` }} />
                        <i style={{ left: 0, top: `${capaCrop.topPct}%`, width: `${capaCrop.leftPct}%`, height: `${capaCrop.heightPct}%` }} />
                        <i style={{ left: `${capaCrop.leftPct + capaCrop.widthPct}%`, top: `${capaCrop.topPct}%`, width: `${capaCrop.leftPct}%`, height: `${capaCrop.heightPct}%` }} />
                      </div>
                      <div
                        className="capa-editor-crop-box"
                        aria-hidden="true"
                        style={{
                          left: `${capaCrop.leftPct}%`,
                          top: `${capaCrop.topPct}%`,
                          width: `${capaCrop.widthPct}%`,
                          height: `${capaCrop.heightPct}%`,
                        }}
                      />
                      <span className="capa-preview-tag">1) Área dentro do quadro = o que vai para a capa</span>
                    </div>

                    <div className="capa-preview-mask capa-preview-mask--resultado">
                      <img
                        src={capaPreviewFinalUrl || capaVisualSrc}
                        alt="Resultado final da capa"
                        className="capa-preview-img capa-preview-img--resultado-main"
                      />
                      <span className="capa-preview-tag">2) Prévia final 16:9 (aba Capítulos)</span>
                    </div>
                  </div>

                  <div className="capa-ajuste-controls">
                    <label>
                      Zoom ({capaAjuste.zoom.toFixed(2)}x)
                      <input
                        type="range"
                        min={capaZoomBounds.coverZoom || capaZoomBounds.minZoom}
                        max={capaZoomBounds.maxZoom}
                        step="0.01"
                        value={capaAjuste.zoom}
                        disabled={!capaEditavel}
                        onChange={(e) =>
                          setCapaAjuste((prev) => normalizarCapaAjuste({ ...prev, zoom: Number(e.target.value) }, capaDimensoes))
                        }
                      />
                    </label>
                    <label>
                      Eixo X ({Math.round(capaAjuste.x)}%)
                      <input
                        type="range"
                        min="-100"
                        max="100"
                        step="1"
                        value={capaAjuste.x}
                        disabled={!capaEditavel}
                        onChange={(e) =>
                          setCapaAjuste((prev) => normalizarCapaAjuste({ ...prev, x: Number(e.target.value) }, capaDimensoes))
                        }
                      />
                    </label>
                    <label>
                      Eixo Y ({Math.round(capaAjuste.y)}%)
                      <input
                        type="range"
                        min="-100"
                        max="100"
                        step="1"
                        value={capaAjuste.y}
                        disabled={!capaEditavel}
                        onChange={(e) =>
                          setCapaAjuste((prev) => normalizarCapaAjuste({ ...prev, y: Number(e.target.value) }, capaDimensoes))
                        }
                      />
                    </label>
                    <p className="capa-ajuste-dica">
                      Dica: você pode arrastar direto na imagem para ajustar X/Y.
                    </p>
                    <button
                      type="button"
                      className="btn-reset-capa"
                      disabled={!capaEditavel}
                      onClick={() => setCapaAjuste(normalizarCapaAjuste({}, capaDimensoes))}
                    >
                      Resetar ajuste
                    </button>
                  </div>
                </div>
              </div>
            )}

            {etapaAtiva === 4 && (
              <div className="editor-step-panel review-panel">
                <h3>{isMangaka ? 'Revisao final do capitulo' : 'Revisão final'}</h3>
                <div className="review-checklist">
                  {checklistPublicacao.map((item) => (
                    <div key={item.id} className={`review-check-item ${item.ok ? 'ok' : 'pendente'}`}>
                      <span>{item.ok ? '✓' : '•'}</span>
                      <p>Etapa {item.id}: {item.label}</p>
                    </div>
                  ))}
                </div>
                <div className="review-kpis">
                  <span><strong>Status:</strong> {statusRevisao}</span>
                  <span><strong>Páginas:</strong> {totalPaginasAtual}</span>
                  <span><strong>Novas páginas:</strong> {arquivosPaginas.length}</span>
                  <span><strong>Lançamento:</strong> {publicReleaseAtInput?.trim() || 'Imediato'}</span>
                </div>
                <div className="capa-preview-mask capa-preview-mask--resultado">
                  <img
                    src={capaPreviewFinalUrl || capaVisualSrc}
                    alt="Prévia final para revisão"
                    className="capa-preview-img capa-preview-img--resultado-main"
                  />
                  <span className="capa-preview-tag">Prévia final pronta para publicar</span>
                </div>
                <div className="review-mobile-preview">
                  <div className="mobile-frame">
                    <header>
                      <strong>{titulo || 'Título do capítulo'}</strong>
                      <span>#{String(numeroCapitulo || 0).padStart(2, '0')}</span>
                    </header>
                    <img
                      src={capaPreviewFinalUrl || capaVisualSrc}
                      alt="Prévia mobile da capa"
                    />
                    <footer>
                      <span>{statusRevisao}</span>
                      <button type="button" disabled>Ler agora</button>
                    </footer>
                  </div>
                </div>
              </div>
            )}

            {etapaAtiva === 5 && (
              <div className="editor-step-panel review-panel">
                <h3>{isMangaka ? 'Publicar capitulo' : 'Publicar capítulo'}</h3>
                <p className="editor-empty">
                  {isMangaka ? 'Confira tudo e publique sem depender do admin.' : 'Confira os dados e clique em publicar. O botão ficará fixo ao final para facilitar.'}
                </p>
              </div>
            )}

            {loading && (
              <div className="progress-container">
                <div className="progress-bar" style={{ width: `${porcentagem}%` }}></div>
                <p>{porcentagem}% - {progressoMsg}</p>
              </div>
            )}

            <div className="step-nav-actions">
              <button
                type="button"
                className="btn-cancel"
                disabled={etapaAtiva <= 1}
                onClick={() => irParaEtapa(etapaAtiva - 1)}
              >
                Etapa anterior
              </button>
              <button
                type="button"
                className="btn-edit"
                disabled={etapaAtiva >= etapaLiberadaMax}
                onClick={() => irParaEtapa(etapaAtiva + 1)}
              >
                Próxima etapa
              </button>
            </div>

            <div className="form-actions form-actions--sticky">
              <button type="submit" className="btn-save" disabled={loading || etapaAtiva !== 5}>
                {loading ? 'PROCESSANDO...' : editandoId ? 'SALVAR ALTERAÇÕES' : 'LANÇAR CAPÍTULO'}
              </button>
              {editandoId && (
                <button
                  type="button"
                  className="btn-cancel"
                  onClick={cancelarEdicao}
                >
                  CANCELAR EDIÇÃO
                </button>
              )}
            </div>
          </form>
        </section>

        <section className="list-section">
          <h2>{isMangaka ? 'Capitulos publicados nesta obra' : 'Capítulos da obra'}</h2>
          <div className="capitulos-grid">
            {capitulosDaObra.length === 0 ? (
              <p className="editor-empty">
                {isMangaka ? 'Nenhum capitulo cadastrado para esta obra ainda.' : 'Nenhum capítulo cadastrado para esta obra.'}
              </p>
            ) : capitulosDaObra.map((cap) => {
              const ehAgendado = cap.publicReleaseAt && Number(cap.publicReleaseAt) > Date.now();
              const ehRascunho = !cap.capaUrl || !Array.isArray(cap.paginas) || cap.paginas.length === 0;
              const status = ehRascunho ? 'Rascunho' : (ehAgendado ? 'Agendado' : 'Publicado');
              const dataLabel = cap.dataUpload
                ? formatarDataBrPartirIsoOuMs(cap.dataUpload)
                : 'Sem data';
              const views = Number(cap.visualizacoes || 0);
              return (
              <div key={cap.id} className="cap-card">
                <div className="cap-info cap-info--rich">
                  <div className="cap-topline">
                    <span className="cap-number">#{cap.numero}</span>
                    <span className="cap-title">{cap.titulo}</span>
                    <span className={`cap-status-pill ${status.toLowerCase()}`}>{status}</span>
                  </div>
                  <div className="cap-meta-row">
                    <span>📅 {dataLabel}</span>
                    <span>👁 {views} views</span>
                    {cap.antecipadoMembros ? <span>👑 Membership antecipada</span> : <span>Membership off</span>}
                  </div>
                </div>
                <div className="cap-actions">
                  <button className="btn-edit" onClick={() => prepararEdicao(cap)}>Editar</button>
                  <button className="btn-delete" onClick={() => {
                    if (window.confirm(`Apagar fragmento ${cap.numero}?`)) remove(dbRef(db, `capitulos/${cap.id}`));
                  }}>Apagar</button>
                </div>
              </div>
            );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}
