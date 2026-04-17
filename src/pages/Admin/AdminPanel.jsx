import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ref as dbRef, onValue, update as dbUpdate, set, push, remove } from 'firebase/database';
import { ref as storageRef, uploadBytes, getDownloadURL, uploadBytesResumable } from 'firebase/storage';
import { httpsCallable } from 'firebase/functions';

import { db, storage, auth, functions } from '../../services/firebase';
import { canAccessAdminPath } from '../../auth/adminPermissions';
import {
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
import {
  safeDeleteStorageObject,
  safeDeleteStorageObjects,
} from '../../utils/storageCleanup';
import { useChapterWizard } from './hooks/useChapterWizard';
import ChapterWizardSteps from './steps/ChapterWizardSteps.jsx';
import ChapterStepUpload from './steps/ChapterStepUpload.jsx';
import ChapterStepOrganize from './steps/ChapterStepOrganize.jsx';
import ChapterStepCover from './steps/ChapterStepCover.jsx';
import ChapterStepReview from './steps/ChapterStepReview.jsx';
import ChapterStepPublish from './steps/ChapterStepPublish.jsx';
import ChapterWizardNav from './steps/ChapterWizardNav.jsx';
import ChapterUploadProgress from './steps/ChapterUploadProgress.jsx';
import './AdminPanel.css';

const IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const MAX_INPUT_IMAGE_SIZE_BYTES = Math.round(3.5 * 1024 * 1024);
const MAX_COMPRESSED_IMAGE_SIZE_BYTES = 500 * 1024;
const TARGET_IMAGE_SIZE_BYTES = 420 * 1024;
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
  const name = String(file.name || '').toLowerCase();
  const extOk = /\.(jpe?g|png|webp)$/.test(name);
  const typeOk = IMAGE_TYPES.includes(file.type);
  if (!typeOk && !extOk) return `${label} inválido. Use JPG, PNG ou WEBP.`;
  if (file.size > MAX_INPUT_IMAGE_SIZE_BYTES) return `${label} excede 3,5 MB.`;
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

function assinaturaArquivo(file) {
  return `${file?.name || ''}|${file?.size || 0}|${file?.lastModified || 0}`;
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
      reject(new Error('Não foi possível ler a imagem enviada.'));
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
    throw new Error('Não foi possível otimizar a imagem para ficar entre 250 KB e 500 KB. Tente outra imagem.');
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
    throw new Error('Não foi possível otimizar a capa para ficar entre 250 KB e 500 KB. Tente outra imagem.');
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
        <div className="modal-header">OPERAÇÃO BLOQUEADA</div>
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
  const formRef = useRef(null);
  const notifyCreatorContentRemoval = useMemo(
    () => httpsCallable(functions, 'notifyCreatorContentRemoval'),
    []
  );
  const user = auth.currentUser;
  const isCreatorWorkspace = workspace === 'creator';
  const isMangaka = Boolean(adminAccess?.isMangaka);
  const workspaceConfig = useMemo(() => {
    if (isCreatorWorkspace) {
      return {
        chaptersHubPath: '/creator/capitulos',
        worksPath: '/creator/obras',
        canAccessWorkspace: isMangaka,
        headerSuffix: ' - ESTÚDIO DE CAPÍTULOS',
        backLabel: 'Voltar para meus capítulos',
        emptyStateTitle: 'Escolha uma obra antes de abrir o editor',
        emptyStateCopy:
          'O fluxo creator precisa de uma obra definida para criar ou editar capítulo. Volte ao hub para escolher uma obra ou entre em Minhas obras para criar a base primeiro.',
      };
    }
    return {
      chaptersHubPath: '/admin/capitulos',
      worksPath: '/admin/obras',
      canAccessWorkspace: canAccessAdminPath('/admin/capitulos', adminAccess),
      headerSuffix: ' - FORJA DO AUTOR',
      backLabel: 'Voltar capítulos',
      emptyStateTitle: 'Selecione uma obra antes de editar',
      emptyStateCopy:
        'O editor precisa de uma obra válida no contexto atual. Volte ao hub de capítulos e abra o fluxo pela obra correta.',
    };
  }, [adminAccess, isCreatorWorkspace, isMangaka]);
  const { chaptersHubPath, worksPath, canAccessWorkspace } = workspaceConfig;
  const obraQueryId = String(searchParams.get('obra') || '').trim();
  const obraIdSelecionada = obraQueryId ? normalizarObraId(obraQueryId) : '';
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
  const [paginasFileLabel, setPaginasFileLabel] = useState('');

  const [capitulos, setCapitulos] = useState([]);
  const [obras, setObras] = useState([]);
  /** Evita redirect falso: antes do 1o snapshot, o fallback da obra copiava creatorId legado (Shito). */
  const [obrasSnapshotReady, setObrasSnapshotReady] = useState(false);
  const [editandoId, setEditandoId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [progressoMsg, setProgressoMsg] = useState('');
  const [porcentagem, setPorcentagem] = useState(0);
  const [dragUploadAtivo, setDragUploadAtivo] = useState(false);
  const [modalPreview, setModalPreview] = useState({ aberto: false, origem: 'novas', indice: 0 });
  const [erroModal, setErroModal] = useState('');
  const [publicReleaseAtInput, setPublicReleaseAtInput] = useState('');
  const [antecipadoMembros, setAntecipadoMembros] = useState(true);
  const [capaFileLabel, setCapaFileLabel] = useState('');

  useEffect(() => {
    if (!canAccessWorkspace) {
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
          setObras([]);
        } else {
          const lista = Object.entries(snapshot.val() || {}).map(([id, valores]) => ({ id, ...(valores || {}) }));
          setObras(lista);
        }
        setObrasSnapshotReady(true);
      },
      () => {
        setObras([]);
        setObrasSnapshotReady(true);
      }
    );

    return () => {
      unsubscribe();
      unsubObras();
    };
  }, [canAccessWorkspace, user, navigate]);

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
    if (!obraIdSelecionada) return null;
    const obra = obras.find((o) => normalizarObraId(o.id) === obraIdSelecionada);
    if (obra) return obra;
    if (isMangaka && !obrasSnapshotReady && user?.uid) {
      return {
        id: obraIdSelecionada,
        slug: obraIdSelecionada,
        titulo: 'Carregando obra...',
        tituloCurto: '',
        creatorId: user.uid,
      };
    }
    return {
      id: obraIdSelecionada,
      slug: obraIdSelecionada,
      titulo: 'Obra não encontrada',
      tituloCurto: '',
      creatorId: '',
    };
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
    if (!obraIdSelecionada) {
      navigate(chaptersHubPath);
      return;
    }
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

  const creatorEditorNeedsWorkSelection =
    isCreatorWorkspace && !obraIdSelecionada;
  const creatorEditorHasUnknownWork =
    isCreatorWorkspace &&
    Boolean(obraIdSelecionada) &&
    obrasSnapshotReady &&
    !obras.some((obra) => normalizarObraId(obra.id) === obraIdSelecionada);

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
  const {
    etapaAtiva,
    setEtapaAtiva,
    checklistPublicacao,
    etapaLiberadaMax,
    irParaEtapa,
    tentarIrParaEtapa,
  } = useChapterWizard({
    capaCapitulo,
    capituloCapaUrl: capituloEditando?.capaUrl,
    totalPaginasAtual,
    titulo,
    numeroCapitulo,
  });
  const tentarIrParaEtapaSeguro = useCallback(
    (destino) => {
      tentarIrParaEtapa(destino, setErroModal);
    },
    [tentarIrParaEtapa]
  );

  useEffect(() => {
    if (etapaAtiva !== 1) return;
    const uploadCompleto = Boolean((capaCapitulo || capituloEditando?.capaUrl) && totalPaginasAtual > 0);
    if (!uploadCompleto) return;
    irParaEtapa(2);
  }, [capaCapitulo, capituloEditando?.capaUrl, etapaAtiva, irParaEtapa, totalPaginasAtual]);

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
  }, [capituloEditQueryId, capitulosDaObra, editandoId, setEtapaAtiva]);

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
      const paginasStoragePathsExistentes = Array.isArray(capituloEditando?.paginasStoragePaths)
        ? [...capituloEditando.paginasStoragePaths]
        : Array.from({ length: paginasExistentes.length }, (_, pathIndex) => (
          Array.isArray(capituloEditando?.paginas) ? capituloEditando.paginas[pathIndex] : ''
        ));
      const arquivoAnterior = paginasStoragePathsExistentes[index]
        || (Array.isArray(capituloEditando?.paginas) ? capituloEditando.paginas[index] : '');

      const novasPaginas = [...paginasExistentes];
      novasPaginas[index] = urlNova;
      paginasStoragePathsExistentes[index] = pathStorage;

      await dbUpdate(dbRef(db, `capitulos/${editandoId}`), {
        paginas: novasPaginas,
        paginasStoragePaths: paginasStoragePathsExistentes,
      });
      await safeDeleteStorageObject(storage, arquivoAnterior);
      setPaginasExistentes(novasPaginas);
    } catch (err) {
      setErroModal("Erro no Upload: " + err.message);
    } finally {
      setLoading(false);
      setProgressoMsg('');
    }
  };

  const handleUploadManga = async (arquivos) => {
    const uploads = [];
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
      uploads.push({
        url: await getDownloadURL(uploadTask.snapshot.ref),
        path: pathStorage,
      });
    }
    return uploads;
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
    setErroModal('');
    setArquivosPaginas((prev) => {
      const existentes = new Set(prev.map(assinaturaArquivo));
      const unicos = novos.filter((file) => !existentes.has(assinaturaArquivo(file)));
      if (!unicos.length) {
        setErroModal('Essas páginas já foram selecionadas. Remova ou troque para enviar outra.');
        return prev;
      }
      const next = [...prev, ...unicos];
      setPaginasFileLabel(`${next.length} página(s) selecionada(s)`);
      return next;
    });
  };

  const handleSelecionarCapa = (file) => {
    if (!file) return;
    const erro = validarImagemUpload(file, 'Capa');
    if (erro) {
      setErroModal(erro);
      return;
    }
    setErroModal('');
    setCapaCapitulo(file);
    setCapaFileLabel(String(file.name || 'arquivo selecionado').trim() || 'arquivo selecionado');
    const ajustePadrao = normalizarCapaAjuste();
    setCapaAjuste(ajustePadrao);
    setCapaAjusteInicial(ajustePadrao);
    if (totalPaginasAtual > 0) {
      irParaEtapa(2);
    }
  };

  useEffect(() => {
    if (arquivosPaginas.length === 0) {
      setPaginasFileLabel('');
      return;
    }
    setPaginasFileLabel(`${arquivosPaginas.length} página(s) selecionada(s)`);
  }, [arquivosPaginas]);

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

  const resetEditorState = useCallback(() => {
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
    setPaginasFileLabel('');
    formRef.current?.reset();
  }, [setEtapaAtiva]);

  const salvarCapitulo = async ({ asDraft = false } = {}) => {
    if (loading) return;
    if (!asDraft && etapaAtiva !== 5) {
      setErroModal('Finalize as etapas até "Publicar" para lançar o capítulo. Se quiser parar agora, use "Salvar rascunho".');
      return;
    }

    setLoading(true);
    setProgressoMsg(asDraft ? 'Salvando rascunho...' : 'Sincronizando...');
    try {
      const numeroNormalizado = parseInt(numeroCapitulo, 10);
      const tituloSanitizado = String(titulo || '').trim();
      if (!tituloSanitizado) {
        throw new Error('Título do capítulo obrigatório.');
      }
      if (!Number.isFinite(numeroNormalizado) || numeroNormalizado <= 0) {
        throw new Error('Número do capítulo inválido.');
      }
      if (!obraIdSelecionada || !obraSelecionada?.id || !obraSelecionada?.titulo) {
        throw new Error('Selecione uma obra válida antes de salvar o capítulo.');
      }
      const creatorIdObra = String(obraCreatorId(obraSelecionada) || '').trim();
      if (!creatorIdObra) {
        throw new Error('A obra selecionada está sem criador vinculado. Corrija a obra antes de salvar o capítulo.');
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
      let capaStoragePath = null;
      let paginasUpload = [];
      const ajusteNormalizado = normalizarCapaAjuste(capaAjuste);
      const capaAnterior = capituloEditando?.capaStoragePath || capituloEditando?.capaUrl || '';

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
        capaStoragePath = capaRef.fullPath;
      }

      if (arquivosPaginas.length > 0) {
        arquivosPaginas.forEach((file, idx) => {
          const erro = validarImagemUpload(file, `Pagina ${idx + 1}`);
          if (erro) throw new Error(erro);
        });
        paginasUpload = await handleUploadManga(arquivosPaginas);
      }

      const dados = {
        titulo: tituloSanitizado,
        numero: numeroNormalizado,
        obraId: obraIdSelecionada,
        workId: obraIdSelecionada,
        obraTitulo: String(obraSelecionada?.tituloCurto || obraSelecionada?.titulo || obraIdSelecionada),
        dataUpload: new Date().toISOString(),
        creatorId: creatorIdObra,
        status: asDraft ? 'draft' : 'published',
        isPublished: !asDraft,
      };

      let publicMs = null;
      if (publicReleaseAtInput?.trim()) {
        const parsed = parseBrDateTimeToMs(publicReleaseAtInput);
        if (parsed == null) {
          throw new Error('Data de lançamento inválida. Use o formato dd/mm/aaaa hh:mm.');
        }
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayStartMs = todayStart.getTime();
        if (parsed < todayStartMs) {
          throw new Error('A data de lançamento deve ser hoje ou uma data futura.');
        }
        const now = Date.now();
        publicMs = parsed < now ? now : parsed;
      }
      dados.publicReleaseAt = publicMs;
      dados.antecipadoMembros = Boolean(antecipadoMembros);

      if (urlCapa) dados.capaUrl = urlCapa;
      if (capaStoragePath) dados.capaStoragePath = capaStoragePath;
      if (urlCapa || capaEditavel) dados.capaAjuste = ajusteNormalizado;
      if (paginasUpload.length > 0) {
        const paginasExistentesUrls = editandoId ? (Array.isArray(paginasExistentes) ? paginasExistentes : []) : [];
        const paginasExistentesPaths = editandoId
          ? (Array.isArray(capituloEditando?.paginasStoragePaths) ? capituloEditando.paginasStoragePaths : [])
          : [];
        dados.paginas = [...paginasExistentesUrls, ...paginasUpload.map((item) => item.url)];
        dados.paginasStoragePaths = [...paginasExistentesPaths, ...paginasUpload.map((item) => item.path)];
      }

      let capituloSalvoId = editandoId;
      if (editandoId) {
        const temCapaFinal = Boolean(dados.capaUrl || capituloEditando?.capaUrl);
        const temPaginasFinal = Boolean(
          (Array.isArray(dados.paginas) && dados.paginas.length > 0) ||
          (Array.isArray(paginasExistentes) && paginasExistentes.length > 0)
        );
        if (!asDraft && !temCapaFinal && !temPaginasFinal) {
          throw new Error('Faltam a capa e as páginas do capítulo.');
        }
        if (!asDraft && !temCapaFinal) {
          throw new Error('Falta a capa do capítulo.');
        }
        if (!asDraft && !temPaginasFinal) {
          throw new Error('Faltam as páginas do capítulo.');
        }
        await dbUpdate(dbRef(db, `capitulos/${editandoId}`), dados);
        if (capaStoragePath) {
          await safeDeleteStorageObject(storage, capaAnterior);
        }
      } else {
        const temCapaFinal = Boolean(urlCapa);
        const temPaginasFinal = paginasUpload.length > 0;
        if (!asDraft && !temCapaFinal && !temPaginasFinal) {
          throw new Error('Faltam a capa e as páginas do capítulo.');
        }
        if (!asDraft && !temCapaFinal) {
          throw new Error('Falta a capa do capítulo.');
        }
        if (!asDraft && !temPaginasFinal) {
          throw new Error('Faltam as páginas do capítulo.');
        }
        const novoRef = push(dbRef(db, 'capitulos'));
        capituloSalvoId = novoRef.key;
        await set(novoRef, dados);
      }

      if (asDraft) {
        setEditandoId(capituloSalvoId || null);
        if (urlCapa) {
          setCapaCapitulo(null);
          setCapaFileLabel('Capa atual no servidor (selecione outra para substituir)');
        }
        if (paginasUpload.length > 0) {
          setPaginasExistentes((prev) => [...prev, ...paginasUpload.map((item) => item.url)]);
          setArquivosPaginas([]);
          setPaginasFileLabel('');
        }
        setProgressoMsg('RASCUNHO SALVO!');
      } else {
        resetEditorState();
        setProgressoMsg('FORJADO COM SUCESSO!');
      }
    } catch (err) {
      setErroModal(err.message);
    } finally {
      setLoading(false);
      setTimeout(() => setProgressoMsg(''), 3000);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    await salvarCapitulo({ asDraft: false });
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
    resetEditorState();
    navigate(chaptersHubPath);
  };

  const apagarCapitulo = async (cap) => {
    if (!cap?.id) return;
    if (!window.confirm(`Apagar capítulo ${cap.numero}?`)) return;
    let removalReason = '';
    if (!isMangaka) {
      removalReason = String(
        window.prompt('Informe o motivo da exclusão (aparece ao criador):', '')
      ).trim();
      if (!removalReason) {
        setErroModal('Exclusão cancelada. Motivo obrigatório para notificar o criador.');
        return;
      }
    }
    setLoading(true);
    setProgressoMsg(`Apagando capítulo ${cap.numero}...`);
    try {
      const arquivos = [
        cap.capaStoragePath,
        cap.capaUrl,
        ...(Array.isArray(cap.paginasStoragePaths) ? cap.paginasStoragePaths : []),
        ...(Array.isArray(cap.paginas) ? cap.paginas : []),
      ];
      await Promise.allSettled([
        safeDeleteStorageObjects(storage, arquivos),
        remove(dbRef(db, `capitulos/${cap.id}`)),
      ]);
      if (!isMangaka && String(cap?.creatorId || '').trim()) {
        await notifyCreatorContentRemoval({
          targetUid: String(cap.creatorId || '').trim(),
          contentType: 'capitulo',
          contentId: cap.id,
          contentTitle: cap.titulo || `Capítulo ${cap.numero || ''}`.trim(),
          reason: removalReason,
        });
      }
      if (editandoId === cap.id) {
        cancelarEdicao();
      }
    } catch (err) {
      setErroModal(`Erro ao apagar: ${err.message || 'Falha ao remover capítulo.'}`);
    } finally {
      setLoading(false);
      setProgressoMsg('');
    }
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
          {isCreatorWorkspace && !isMangaka ? ' - OPERAÇÃO DE CAPÍTULOS' : workspaceConfig.headerSuffix}
        </h1>
        <button className="btn-voltar" onClick={() => navigate(chaptersHubPath)}>
          {isCreatorWorkspace && !isMangaka ? 'Voltar capítulos' : workspaceConfig.backLabel}
        </button>
      </header>

      <main className="admin-container">
        {creatorEditorNeedsWorkSelection ? (
          <section className="admin-editor-empty-state" role="status">
            <div className="admin-editor-empty-state__card">
              <p className="admin-editor-empty-state__eyebrow">Editor creator</p>
              <h2>{workspaceConfig.emptyStateTitle}</h2>
              <p>{workspaceConfig.emptyStateCopy}</p>
              <div className="admin-editor-empty-state__actions">
                <button type="button" className="btn-voltar" onClick={() => navigate(chaptersHubPath)}>
                  Voltar ao hub de capítulos
                </button>
                <button type="button" className="btn-voltar" onClick={() => navigate(worksPath)}>
                  Ir para minhas obras
                </button>
              </div>
            </div>
          </section>
        ) : creatorEditorHasUnknownWork ? (
          <section className="admin-editor-empty-state" role="status">
            <div className="admin-editor-empty-state__card">
              <p className="admin-editor-empty-state__eyebrow">Obra inválida</p>
              <h2>Essa obra não foi resolvida no seu catálogo</h2>
              <p>
                O editor creator não vai salvar nada enquanto a obra não for reconhecida como parte do
                seu catálogo. Volte ao hub e entre pelo fluxo correto.
              </p>
              <div className="admin-editor-empty-state__actions">
                <button type="button" className="btn-voltar" onClick={() => navigate(chaptersHubPath)}>
                  Voltar ao hub de capítulos
                </button>
                <button type="button" className="btn-voltar" onClick={() => navigate(worksPath)}>
                  Ver minhas obras
                </button>
              </div>
            </div>
          </section>
        ) : (
          <>
        <section className="admin-obra-context">
          <p>Obra selecionada</p>
          <strong>{obraSelecionada?.titulo || obraIdSelecionada}</strong>
          <span>Slug: {obraSelecionada?.slug || obraIdSelecionada}</span>
        </section>
        <section className="form-section">
          <h2>
            {editandoId
              ? `${isMangaka ? 'Editar meu capítulo' : 'Editar capítulo'} — ${obraSelecionada?.tituloCurto || obraSelecionada?.titulo}`
              : `${isMangaka ? 'Criar capítulo' : 'Criar capítulo'} — ${obraSelecionada?.tituloCurto || obraSelecionada?.titulo}`}
          </h2>
          
          <form ref={formRef} onSubmit={handleSubmit} className="admin-form" noValidate>
            <div className="input-row">
              <input type="number" placeholder="Nº" value={numeroCapitulo} onChange={(e) => setNumeroCapitulo(e.target.value)} />
              <input type="text" placeholder="Título" value={titulo} onChange={(e) => setTitulo(e.target.value)} />
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
                 ? 'Deixe vazio para publicar agora. Com data futura, o capítulo fica em breve até a abertura pública.'
                 : 'Data vazia = já público. Com data futura, o capítulo fica em breve até o horário. Se a opção abaixo estiver marcada, membros ativos do criador podem ler antes da abertura pública.'}
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

            <ChapterWizardSteps
              etapaAtiva={etapaAtiva}
              etapaLiberadaMax={etapaLiberadaMax}
              onSelect={tentarIrParaEtapaSeguro}
            />

            {etapaAtiva === 1 && (
              <ChapterStepUpload
                dragUploadAtivo={dragUploadAtivo}
                setDragUploadAtivo={setDragUploadAtivo}
                handleSelecionarArquivosPaginas={handleSelecionarArquivosPaginas}
                isMangaka={isMangaka}
                capaFileLabel={capaFileLabel}
                paginasFileLabel={paginasFileLabel}
                handleSelecionarCapa={handleSelecionarCapa}
              />
            )}

            {etapaAtiva === 2 && (
              <ChapterStepOrganize
                editandoId={editandoId}
                paginasExistentes={paginasExistentes}
                isMangaka={isMangaka}
                PaginaCard={PaginaCard}
                PaginaSelecionadaCard={PaginaSelecionadaCard}
                arquivosPaginas={arquivosPaginas}
                previewsPaginasSelecionadas={previewsPaginasSelecionadas}
                handleTrocarPaginaUnica={handleTrocarPaginaUnica}
                handleReordenarPagina={handleReordenarPagina}
                handleReordenarSelecionada={handleReordenarSelecionada}
                handleRemoverSelecionada={handleRemoverSelecionada}
                setErroModal={setErroModal}
                setModalPreview={setModalPreview}
              />
            )}

            {etapaAtiva === 3 && (
              <ChapterStepCover
                isMangaka={isMangaka}
                capaEditorRef={capaEditorRef}
                capaEditavel={capaEditavel}
                iniciarArrasteCapa={iniciarArrasteCapa}
                capaVisualSrc={capaVisualSrc}
                capaEditorImageStyle={capaEditorImageStyle}
                capaCrop={capaCrop}
                capaPreviewFinalUrl={capaPreviewFinalUrl}
                capaZoomBounds={capaZoomBounds}
                capaAjuste={capaAjuste}
                setCapaAjuste={setCapaAjuste}
                normalizarCapaAjuste={normalizarCapaAjuste}
                capaDimensoes={capaDimensoes}
              />
            )}

            {etapaAtiva === 4 && (
              <ChapterStepReview
                isMangaka={isMangaka}
                checklistPublicacao={checklistPublicacao}
                statusRevisao={statusRevisao}
                totalPaginasAtual={totalPaginasAtual}
                novasPaginasCount={arquivosPaginas.length}
                publicReleaseAtInput={publicReleaseAtInput}
                capaPreviewFinalUrl={capaPreviewFinalUrl}
                capaVisualSrc={capaVisualSrc}
                titulo={titulo}
                numeroCapitulo={numeroCapitulo}
              />
            )}

            {etapaAtiva === 5 && (
              <ChapterStepPublish isMangaka={isMangaka} />
            )}

            <ChapterUploadProgress
              loading={loading}
              porcentagem={porcentagem}
              progressoMsg={progressoMsg}
            />

            <ChapterWizardNav
              etapaAtiva={etapaAtiva}
              onPrev={() => tentarIrParaEtapaSeguro(etapaAtiva - 1)}
              onNext={() => tentarIrParaEtapaSeguro(etapaAtiva + 1)}
            />

            <div className="form-actions form-actions--sticky">
              <button type="submit" className="btn-save" disabled={loading}>
                {loading ? 'PROCESSANDO...' : editandoId ? 'SALVAR ALTERAÇÕES' : 'LANÇAR CAPÍTULO'}
              </button>
              <button
                type="button"
                className="btn-cancel"
                disabled={loading}
                onClick={() => salvarCapitulo({ asDraft: true })}
              >
                {loading ? 'PROCESSANDO...' : 'SALVAR RASCUNHO'}
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
          <h2>{isMangaka ? 'Capítulos publicados nesta obra' : 'Capítulos da obra'}</h2>
          <div className="capitulos-grid">
            {capitulosDaObra.length === 0 ? (
              <p className="editor-empty">
                {isMangaka ? 'Nenhum capítulo cadastrado para esta obra ainda.' : 'Nenhum capítulo cadastrado para esta obra.'}
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
                    <span>{`Data: ${dataLabel}`}</span>
                    <span>{`${views} views`}</span>
                    {cap.antecipadoMembros ? <span>Membership antecipada</span> : <span>Membership off</span>}
                  </div>
                </div>
                <div className="cap-actions">
                  <button className="btn-edit" onClick={() => prepararEdicao(cap)}>Editar</button>
                  <button className="btn-delete" onClick={() => apagarCapitulo(cap)}>Apagar</button>
                </div>
              </div>
            );
            })}
          </div>
        </section>
          </>
        )}
      </main>
    </div>
  );
}







