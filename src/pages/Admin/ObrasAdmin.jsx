import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { get, onValue, ref as dbRef, set, update } from 'firebase/database';
import { httpsCallable } from 'firebase/functions';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';

import { auth, db, functions, storage } from '../../services/firebase';
import { canAccessAdminPath } from '../../auth/adminPermissions';
import { formatarDataHoraBr } from '../../utils/datasBr';
import { buildPublicProfileFromUsuarioRow } from '../../utils/publicUserProfile';
import { normalizeUsernameInput } from '../../utils/usernameValidation';
import { isTrustedPlatformAssetUrl } from '../../utils/trustedAssetUrls';
import {
  normalizarObraId,
  obterObraIdCapitulo,
  obraCreatorId,
} from '../../config/obras';
import {
  MAX_COVER_UPLOAD_BYTES,
  OBRAS_WORK_GENRE_IDS,
  OBRAS_WORK_STATUS,
  SEO_KEYWORDS_MAX,
  SEO_TITLE_MAX,
  TITULO_CURTO_MAX,
  isValidCreatorUid,
  normalizeGenreList,
  normalizeStatusForForm,
  normalizeTagsFromInput,
  obraSlugFromTitle,
  parseObraGenreIdsForForm,
  publicoAlvoFromMainGenre,
  tagsToSeoKeywords,
  validateObraWorkForm,
} from '../../config/obraWorkForm';
import { obraEstaArquivada } from '../../utils/obraCatalogo';
import {
  safeDeleteStorageObject,
  safeDeleteStorageFolder,
  safeDeleteStorageObjects,
} from '../../utils/storageCleanup';
import {
  applyResponsiveDragDelta,
  buildResponsiveCropStyle,
  createResponsiveDragSnapshot,
  drawResponsiveCropToCanvas,
  getFullCropLayout,
  getResponsiveCropZoomBounds,
  normalizeResponsiveCropAdjustment,
} from '../../utils/responsiveCrop';
import ObrasEditor from './obras/ObrasEditor.jsx';
import ObrasList from './obras/ObrasList.jsx';
import './ObrasAdmin.css';

const STATUS_LABEL_BY_ID = Object.fromEntries(OBRAS_WORK_STATUS.map((s) => [s.id, s.label]));
STATUS_LABEL_BY_ID.draft = 'Rascunho (legado)';

function mensagemErroFirebase(e) {
  const code = String(e?.code || '');
  if (code === 'PERMISSION_DENIED') {
    return 'Sem permissão para gravar. Confirme login, papel (admin/mangaka) e regras do Firebase.';
  }
  if (code === 'storage/unauthorized') {
    return 'Upload negado pelo servidor. Saia e entre de novo na conta ou tente outra imagem (máx. 1,2 MB).';
  }
  if (code === 'UNAVAILABLE' || /network|offline|failed to fetch/i.test(String(e?.message || ''))) {
    return 'Rede indisponível. Verifique a conexão e tente de novo.';
  }
  return e?.message || 'Erro desconhecido ao comunicar com o servidor.';
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

/** UID do Firebase nas regras do Storage deve bater com `auth.uid` — nao normalizar/lowercase. */
function segmentoStorageOwnerUid(creatorIdResolved) {
  const raw = String(creatorIdResolved || '').trim();
  if (/^[A-Za-z0-9_-]{2,128}$/.test(raw)) return raw;
  return sanitizarSegmentoStorage(creatorIdResolved, 'shared');
}

function nowMs() {
  return Date.now();
}

function normalizarAjusteObra(raw, dims = null, editorConfig = BANNER_EDITOR_CONFIG) {
  const bounds = getResponsiveCropZoomBounds(dims, editorConfig.outputW, editorConfig.outputH);
  const normalized = normalizeResponsiveCropAdjustment(raw, { maxZoom: bounds.maxZoom });
  return {
    ...normalized,
    zoom: Math.max(bounds.coverZoom, Number(normalized.zoom || bounds.coverZoom)),
  };
}

const IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/pjpeg'];
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
/** Meta de peso após processar (~250–500 KB; WebP gerado no navegador; JPG/PNG de entrada ok). */
const OBRA_WEBP_TARGET_MAX = 500 * 1024;
const OBRA_WEBP_HARD_MAX = 560 * 1024;
const COVER_EDITOR_CONFIG = {
  outputW: 1200,
  outputH: 1600,
};
const BANNER_EDITOR_CONFIG = {
  outputW: 1600,
  outputH: 900,
};

function validarImagemUpload(file, label = 'Imagem') {
  if (!file) return `${label} não encontrado.`;
  const fileType = String(file.type || '').trim().toLowerCase();
  const fileName = String(file.name || '').trim().toLowerCase();
  const hasAllowedMime = !fileType || IMAGE_TYPES.includes(fileType);
  const hasAllowedExtension = IMAGE_EXTENSIONS.some((ext) => fileName.endsWith(ext));
  if (!hasAllowedMime && !hasAllowedExtension) return `${label} inválida. Use JPG, PNG ou WEBP.`;
  if (file.size > MAX_COVER_UPLOAD_BYTES) {
    return `${label} é grande demais (máx. 1,2 MB). Comprima ou escolha outra imagem.`;
  }
  return '';
}

function nomeArquivoComExtensao(name, novaExt) {
  const base = String(name || 'imagem')
    .replace(/\.[^/.]+$/, '')
    .replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${base}${novaExt}`;
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

/**
 * Exporta WebP do canvas (~250–500 KB quando possível; teto ~560 KB).
 * Entrada pode ser JPG/PNG/WebP; o arquivo enviado ao Storage continua sendo WebP gerado aqui.
 */
async function exportObraWebpPesoAlvo(sourceCanvas) {
  let canvas = sourceCanvas;
  for (let pass = 0; pass < 10; pass += 1) {
    for (let q = 0.9; q >= 0.34; q -= 0.04) {
      const blob = await canvasParaBlob(canvas, 'image/webp', q);
      if (blob.size <= OBRA_WEBP_TARGET_MAX) {
        return blob;
      }
    }
    const lastTry = await canvasParaBlob(canvas, 'image/webp', 0.32);
    if (lastTry.size <= OBRA_WEBP_HARD_MAX) {
      return lastTry;
    }
    const nw = Math.max(520, Math.round(canvas.width * 0.82));
    const nh = Math.max(520, Math.round(canvas.height * 0.82));
    if (nw >= canvas.width && nh >= canvas.height) {
      break;
    }
    const next = document.createElement('canvas');
    next.width = nw;
    next.height = nh;
    const ctx = next.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Não foi possível processar a imagem.');
    ctx.drawImage(canvas, 0, 0, nw, nh);
    canvas = next;
  }
  throw new Error(
    'Não foi possível comprimir a imagem até ~500 KB. Escolha outro arquivo (máx. 1,2 MB) ou uma foto menos detalhada.'
  );
}

function desenharImagemAjustada(
  ctx,
  img,
  targetW,
  targetH,
  ajuste = { zoom: 1, x: 0, y: 0 }
) {
  drawResponsiveCropToCanvas(ctx, img, targetW, targetH, ajuste, {
    backgroundColor: '#0b0b0b',
    backgroundAlpha: 0.35,
    maxZoomCap: getResponsiveCropZoomBounds(
      { w: img?.width, h: img?.height },
      targetW,
      targetH
    ).maxZoom,
  });
}

async function processarImagemObra(file, ajuste, editorConfig) {
  const img = await carregarImagem(file);
  const natW = img.naturalWidth || img.width;
  const natH = img.naturalHeight || img.height;
  const maxEdge = 4096;
  let source = img;
  if (natW > maxEdge || natH > maxEdge) {
    const scale = Math.min(maxEdge / natW, maxEdge / natH);
    const tw = Math.max(1, Math.round(natW * scale));
    const th = Math.max(1, Math.round(natH * scale));
    const pre = document.createElement('canvas');
    pre.width = tw;
    pre.height = th;
    const pctx = pre.getContext('2d', { alpha: false });
    if (!pctx) throw new Error('Falha ao processar imagem da obra.');
    pctx.drawImage(img, 0, 0, tw, th);
    source = pre;
  }
  const canvas = document.createElement('canvas');
  canvas.width = editorConfig.outputW;
  canvas.height = editorConfig.outputH;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Falha ao processar imagem da obra.');
  desenharImagemAjustada(ctx, source, canvas.width, canvas.height, ajuste, editorConfig);
  const blob = await exportObraWebpPesoAlvo(canvas);
  return new File([blob], nomeArquivoComExtensao(file.name, '.webp'), {
    type: 'image/webp',
    lastModified: Date.now(),
  });
}

function editorLayout(config) {
  return getFullCropLayout(config);
}

function estiloEditorImagem(dim, ajuste = { zoom: 1, x: 0, y: 0 }, editorConfig = BANNER_EDITOR_CONFIG) {
  return buildResponsiveCropStyle(dim, ajuste, editorConfig.outputW, editorConfig.outputH);
}

function buildEmptyForm(defaultCreatorId = '') {
  return {
    id: '',
    titulo: '',
    tituloCurto: '',
    sinopse: '',
    genres: [],
    mainGenre: '',
    tagsRaw: '',
    capaUrl: '',
    bannerUrl: '',
    seoTitle: '',
    seoKeywords: '',
    status: 'ongoing',
    isPublished: false,
    archived: false,
    adminCreatorId: String(defaultCreatorId || '').trim(),
  };
}

function buildCreatorDirectory(rows = {}) {
  const map = new Map();
  Object.entries(rows || {}).forEach(([uid, data]) => {
    const handle = normalizeUsernameInput(uid);
    const ownerUid = String(data || '').trim();
    const entry = {
      uid: ownerUid,
      handle,
      displayName: handle ? '@' + handle : '',
      avatarUrl: '',
      isCreator: false,
    };
    if (entry.uid) map.set(entry.uid, entry);
  });
  return [...map.values()].sort((a, b) =>
    String(a.displayName || a.uid).localeCompare(String(b.displayName || b.uid), 'pt-BR', { sensitivity: 'base' })
  );
}

function formatCreatorLookupOption(entry) {
  if (!entry) return '';
  const handlePart = entry.handle ? '@' + entry.handle : entry.uid;
  const namePart = entry.displayName && entry.displayName !== handlePart ? ' - ' + entry.displayName : '';
  return handlePart + namePart;
}

function normalizeCreatorLookupQuery(rawValue) {
  return String(rawValue || '').trim();
}

function findCreatorLookupMatches(rawValue, directory = []) {
  const raw = normalizeCreatorLookupQuery(rawValue);
  if (!raw) return [];
  const normalized = raw.toLowerCase();
  const compact = normalizeUsernameInput(raw);
  return directory.filter((entry) => {
    if (!entry) return false;
    const uid = String(entry.uid || '').toLowerCase();
    const handle = String(entry.handle || '').toLowerCase();
    const displayName = String(entry.displayName || '').toLowerCase();
    const option = formatCreatorLookupOption(entry).toLowerCase();
    return (
      uid === normalized ||
      (compact && handle.startsWith(compact)) ||
      (compact && handle.includes(compact)) ||
      displayName.includes(normalized) ||
      option.includes(normalized)
    );
  });
}

function resolveCreatorLookupValue(rawValue, directory = []) {
  const raw = normalizeCreatorLookupQuery(rawValue);
  if (!raw) return null;
  const normalized = raw.toLowerCase();
  const compact = normalizeUsernameInput(raw);
  const exact =
    directory.find((entry) => {
      if (!entry) return false;
      if (String(entry.uid || '').toLowerCase() === normalized) return true;
      if (entry.handle && String(entry.handle).toLowerCase() === compact) return true;
      if (entry.displayName && String(entry.displayName).toLowerCase() === normalized) return true;
      if (formatCreatorLookupOption(entry).toLowerCase() === normalized) return true;
      return false;
    }) || null;
  if (exact) return exact;

  const partialMatches = directory.filter((entry) => {
    if (!entry) return false;
    const handle = String(entry.handle || '').toLowerCase();
    const displayName = String(entry.displayName || '').toLowerCase();
    const option = formatCreatorLookupOption(entry).toLowerCase();
    return (
      (compact && handle.startsWith(compact)) ||
      (compact && handle.includes(compact)) ||
      displayName.includes(normalized) ||
      option.includes(normalized)
    );
  });
  if (partialMatches.length === 1) return partialMatches[0];
  return partialMatches[0] || null;
}

export default function ObrasAdmin({ adminAccess, workspace = 'admin' }) {
  const navigate = useNavigate();
  const notifyCreatorContentRemoval = useMemo(
    () => httpsCallable(functions, 'notifyCreatorContentRemoval'),
    []
  );
  const user = auth.currentUser;
  const isMangaka = Boolean(adminAccess?.isMangaka);
  const chaptersPath = workspace === 'creator' ? '/creator/capitulos' : '/admin/capitulos';
  const isCreatorWorkspace = workspace === 'creator';
  const canAccessWorkspace = isCreatorWorkspace
    ? isMangaka
    : canAccessAdminPath('/admin/obras', adminAccess);
  const [loading, setLoading] = useState(true);
  const [obrasSnapshotReady, setObrasSnapshotReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [obras, setObras] = useState([]);
  const [obrasTodas, setObrasTodas] = useState([]);
  const [obraSelecionadaId, setObraSelecionadaId] = useState('');
  const defaultCreatorUid = isMangaka && user?.uid ? user.uid : '';
  const [form, setForm] = useState(() => buildEmptyForm(defaultCreatorUid));
  const [creatorLookupInput, setCreatorLookupInput] = useState(() => String(defaultCreatorUid).trim());
  const [creatorDirectory, setCreatorDirectory] = useState([]);
  const [creatorWorkspaceProfile, setCreatorWorkspaceProfile] = useState(null);
  const [editandoId, setEditandoId] = useState(null);
  const [erro, setErro] = useState('');
  const [ok, setOk] = useState('');
  const [saveAttempted, setSaveAttempted] = useState(false);
  const [saveErrorModal, setSaveErrorModal] = useState({ open: false, lines: [] });
  const [saveToast, setSaveToast] = useState({ visible: false, text: '' });
  const [capaArquivo, setCapaArquivo] = useState(null);
  const [bannerArquivo, setBannerArquivo] = useState(null);
  const [capaAjuste, setCapaAjuste] = useState(() => normalizarAjusteObra());
  const [bannerAjuste, setBannerAjuste] = useState(() => normalizarAjusteObra());
  const [capaDimensoes, setCapaDimensoes] = useState(null);
  const [bannerDimensoes, setBannerDimensoes] = useState(null);
  const [capaPreviewFinalUrl, setCapaPreviewFinalUrl] = useState('');
  const [bannerPreviewFinalUrl, setBannerPreviewFinalUrl] = useState('');
  const capaEditorRef = useRef(null);
  const bannerEditorRef = useRef(null);
  const dragMediaRef = useRef(null);
  const saveInFlightRef = useRef(false);
  const saveToastTimerRef = useRef(null);

  useEffect(() => {
    if (!canAccessWorkspace) {
      navigate('/');
      return;
    }
    setObrasSnapshotReady(false);
    const obrasRef = dbRef(db, 'obras');
    const unsub = onValue(obrasRef, (snapshot) => {
      if (!snapshot.exists()) {
        setObras([]);
        setObrasTodas([]);
        setObraSelecionadaId('');
        setObrasSnapshotReady(true);
        setLoading(false);
        return;
      }
      const raw = snapshot.val() || {};
      const lista = Object.entries(raw).map(([id, data]) => ({
        id,
        ...(data || {}),
      }));
      lista.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
      setObrasTodas(lista);
      const visivel =
        isCreatorWorkspace && user?.uid
          ? lista.filter((o) => obraCreatorId(o) === user.uid)
          : lista;
      setObras(visivel);
      setObraSelecionadaId((curr) => {
        if (!curr) return '';
        if (lista.some((obra) => obra.id === curr)) return curr;
        return '';
      });
      setObrasSnapshotReady(true);
      setLoading(false);
    });
    return () => unsub();
  }, [canAccessWorkspace, isCreatorWorkspace, navigate, user]);

  useEffect(() => {
    if (!canAccessWorkspace || isMangaka) {
      setCreatorDirectory([]);
      return undefined;
    }
    let cancelled = false;
    get(dbRef(db, 'usernames'))
      .then((snapshot) => {
        if (cancelled) return;
        setCreatorDirectory(buildCreatorDirectory(snapshot.val() || {}));
      })
      .catch(() => {
        if (cancelled) return;
        setCreatorDirectory([]);
      });
    return () => {
      cancelled = true;
    };
  }, [canAccessWorkspace, isMangaka]);

  useEffect(() => {
    if (!canAccessWorkspace || !isMangaka || !user?.uid) {
      setCreatorWorkspaceProfile(null);
      return () => {};
    }
    let cancelled = false;
    get(dbRef(db, `usuarios/${user.uid}`))
      .then((snapshot) => {
        if (cancelled) return;
        const perfilPublico = buildPublicProfileFromUsuarioRow(snapshot.val() || {}, user.uid);
        const handle = normalizeUsernameInput(perfilPublico?.userHandle || '');
        const displayName = String(
          perfilPublico?.creatorDisplayName ||
            perfilPublico?.userName ||
            user.displayName ||
            (handle ? '@' + handle : 'Sua conta')
        ).trim();
        setCreatorWorkspaceProfile({
          uid: user.uid,
          handle,
          displayName,
          avatarUrl: String(
            perfilPublico?.userAvatar ||
              perfilPublico?.readerProfileAvatarUrl ||
              user.photoURL ||
              ''
          ).trim(),
          isCreator: perfilPublico?.isCreatorProfile === true,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setCreatorWorkspaceProfile({
          uid: user.uid,
          handle: '',
          displayName: String(user.displayName || 'Sua conta').trim() || 'Sua conta',
          avatarUrl: String(user.photoURL || '').trim(),
          isCreator: true,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [canAccessWorkspace, isMangaka, user?.displayName, user?.photoURL, user?.uid]);

  useEffect(() => {
    if (isMangaka || !form.adminCreatorId) return () => {};
    let cancelled = false;
    get(dbRef(db, `usuarios/${form.adminCreatorId}`))
      .then((snapshot) => {
        if (cancelled || !snapshot.exists()) return;
        const perfilPublico = buildPublicProfileFromUsuarioRow(snapshot.val() || {}, form.adminCreatorId);
        setCreatorDirectory((prev) => {
          const map = new Map(prev.map((entry) => [entry.uid, entry]));
          const current = map.get(form.adminCreatorId) || {
            uid: form.adminCreatorId,
            handle: normalizeUsernameInput(perfilPublico?.userHandle || ''),
          };
          map.set(form.adminCreatorId, {
            ...current,
            displayName:
              String(
                perfilPublico?.creatorDisplayName ||
                  perfilPublico?.userName ||
                  current.displayName ||
                  (current.handle ? '@' + current.handle : form.adminCreatorId)
              ).trim(),
            avatarUrl: String(
              perfilPublico?.userAvatar || perfilPublico?.readerProfileAvatarUrl || current.avatarUrl || ''
            ).trim(),
            isCreator: perfilPublico?.isCreatorProfile === true,
          });
          return [...map.values()].sort((a, b) =>
            String(a.displayName || a.uid).localeCompare(String(b.displayName || b.uid), 'pt-BR', {
              sensitivity: 'base',
            })
          );
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [form.adminCreatorId, isMangaka]);

  const obrasMap = useMemo(() => {
    const map = new Map();
    obras.forEach((obra) => map.set(String(obra.id || ''), obra));
    return map;
  }, [obras]);

  const capaPreviewUrl = useMemo(() => (capaArquivo ? URL.createObjectURL(capaArquivo) : ''), [capaArquivo]);
  const bannerPreviewUrl = useMemo(() => (bannerArquivo ? URL.createObjectURL(bannerArquivo) : ''), [bannerArquivo]);
  const capaFonteEditavel = capaPreviewUrl || String(form.capaUrl || '').trim();
  const bannerFonteEditavel = bannerPreviewUrl || String(form.bannerUrl || '').trim();
  const capaEditavel = Boolean(capaFonteEditavel);
  const bannerEditavel = Boolean(bannerFonteEditavel);
  const capaLiveUrl = capaPreviewFinalUrl || capaPreviewUrl || form.capaUrl || '/assets/fotos/shito.jpg';
  const bannerLiveUrl = bannerPreviewFinalUrl || bannerPreviewUrl || form.bannerUrl || form.capaUrl || '/assets/fotos/shito.jpg';
  const slugPreview = editandoId || obraSlugFromTitle(form.titulo) || '—';

  const validationLive = useMemo(
    () =>
      validateObraWorkForm({
        titulo: form.titulo,
        sinopse: form.sinopse,
        genres: form.genres,
        mainGenre: form.mainGenre,
        tagsRaw: form.tagsRaw,
        status: form.status,
        tituloCurto: form.tituloCurto,
        seoTitle: form.seoTitle,
        hasCapaFile: Boolean(capaArquivo),
        capaUrl: form.capaUrl,
        hasBannerFile: Boolean(bannerArquivo),
        bannerUrl: form.bannerUrl,
        editandoId,
        obrasTodas,
        isMangaka,
        currentUid: user?.uid,
        adminCreatorId: form.adminCreatorId,
      }),
    [
      form.titulo,
      form.sinopse,
      form.genres,
      form.mainGenre,
      form.tagsRaw,
      form.status,
      form.capaUrl,
      form.bannerUrl,
      form.tituloCurto,
      form.seoTitle,
      form.adminCreatorId,
      capaArquivo,
      bannerArquivo,
      editandoId,
      obrasTodas,
      isMangaka,
      user?.uid,
    ]
  );

  const preview = useMemo(() => ({
    titulo: form.titulo || 'Título da Obra',
    tituloCurto: form.tituloCurto || form.titulo || 'Obra',
    sinopse: form.sinopse || 'Sinopse da obra para pré-visualização.',
    capaUrl: capaLiveUrl,
    bannerUrl: bannerLiveUrl,
    status: form.status || 'ongoing',
    isPublished: Boolean(form.isPublished),
    archived: Boolean(form.archived),
    genres: normalizeGenreList(form.genres),
  }), [form, capaLiveUrl, bannerLiveUrl]);
  const capaEditorImageStyle = useMemo(
    () => estiloEditorImagem(capaDimensoes, capaAjuste, COVER_EDITOR_CONFIG),
    [capaDimensoes, capaAjuste]
  );
  const capaZoomBounds = useMemo(
    () => getResponsiveCropZoomBounds(capaDimensoes, COVER_EDITOR_CONFIG.outputW, COVER_EDITOR_CONFIG.outputH),
    [capaDimensoes]
  );
  const bannerEditorImageStyle = useMemo(
    () => estiloEditorImagem(bannerDimensoes, bannerAjuste, BANNER_EDITOR_CONFIG),
    [bannerDimensoes, bannerAjuste]
  );
  const bannerZoomBounds = useMemo(
    () => getResponsiveCropZoomBounds(bannerDimensoes, BANNER_EDITOR_CONFIG.outputW, BANNER_EDITOR_CONFIG.outputH),
    [bannerDimensoes]
  );

  useEffect(() => {
    if (capaDimensoes) {
      setCapaAjuste((prev) => normalizarAjusteObra(prev, capaDimensoes, COVER_EDITOR_CONFIG));
    }
  }, [capaDimensoes]);

  useEffect(() => {
    if (bannerDimensoes) {
      setBannerAjuste((prev) => normalizarAjusteObra(prev, bannerDimensoes, BANNER_EDITOR_CONFIG));
    }
  }, [bannerDimensoes]);

  const clearMsgs = () => {
    setErro('');
    setOk('');
  };

  const closeSaveErrorModal = useCallback(() => {
    setSaveErrorModal({ open: false, lines: [] });
  }, []);

  const openSaveErrorModal = useCallback((lines) => {
    const arr = Array.isArray(lines)
      ? lines.map((s) => String(s || '').trim()).filter(Boolean)
      : [String(lines || '').trim()].filter(Boolean);
    setSaveErrorModal({
      open: true,
      lines: arr.length ? arr : ['Erro desconhecido.'],
    });
  }, []);

  const blockSave = useCallback((reason, lines, extra = {}) => {
    const payload = Array.isArray(lines)
      ? lines.map((item) => String(item || '').trim()).filter(Boolean)
      : [String(lines || '').trim()].filter(Boolean);
    const finalLines = payload.length ? payload : ['Não foi possível salvar a obra.'];
    setSaveAttempted(true);
    setErro(finalLines.join(' '));
    openSaveErrorModal(finalLines);
    console.warn('[ObrasAdmin] save blocked', {
      reason,
      workspace,
      isMangaka,
      editandoId,
      obraSelecionadaId,
      uid: user?.uid || '',
      ...extra,
    });
    return false;
  }, [editandoId, isMangaka, obraSelecionadaId, openSaveErrorModal, user?.uid, workspace]);

  const showSaveToast = useCallback((text) => {
    const t = String(text || '').trim();
    if (!t) return;
    if (saveToastTimerRef.current) clearTimeout(saveToastTimerRef.current);
    setSaveToast({ visible: true, text: t });
    saveToastTimerRef.current = setTimeout(() => {
      setSaveToast({ visible: false, text: '' });
      saveToastTimerRef.current = null;
    }, 4200);
  }, []);

  useEffect(() => {
    return () => {
      if (saveToastTimerRef.current) clearTimeout(saveToastTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!saveErrorModal.open) return undefined;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => {
      if (e.key === 'Escape') closeSaveErrorModal();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [saveErrorModal.open, closeSaveErrorModal]);

  const iniciarNovo = () => {
    clearMsgs();
    setSaveAttempted(false);
    setEditandoId(null);
    setObraSelecionadaId('');
    setForm(buildEmptyForm(defaultCreatorUid));
    setCreatorLookupInput(String(defaultCreatorUid).trim());
    setCapaArquivo(null);
    setBannerArquivo(null);
    setCapaAjuste(normalizarAjusteObra());
    setBannerAjuste(normalizarAjusteObra());
  };

  const resolvedCreatorLookup = useMemo(() => {
    if (isMangaka) return null;
    return resolveCreatorLookupValue(creatorLookupInput || form.adminCreatorId, creatorDirectory);
  }, [creatorDirectory, creatorLookupInput, form.adminCreatorId, isMangaka]);
  const creatorLookupQuery = useMemo(() => normalizeCreatorLookupQuery(creatorLookupInput), [creatorLookupInput]);
  const creatorLookupMatches = useMemo(
    () => (isMangaka ? [] : findCreatorLookupMatches(creatorLookupInput || form.adminCreatorId, creatorDirectory).slice(0, 6)),
    [creatorDirectory, creatorLookupInput, form.adminCreatorId, isMangaka]
  );
  const creatorNeedsSelection = !isMangaka && !!creatorLookupQuery && creatorLookupMatches.length === 0 && !resolvedCreatorLookup;

  const toggleGenre = (genreId) => {
    const id = String(genreId || '').trim().toLowerCase();
    if (!OBRAS_WORK_GENRE_IDS.includes(id)) return;
    setForm((prev) => {
      const has = prev.genres.includes(id);
      const nextGenres = normalizeGenreList(
        has ? prev.genres.filter((g) => g !== id) : [...prev.genres, id]
      );
      const mainGenre = nextGenres.includes(prev.mainGenre) ? prev.mainGenre : '';
      return { ...prev, genres: nextGenres, mainGenre };
    });
  };

  const editarObra = (obraId) => {
    clearMsgs();
    const obra = obrasMap.get(obraId);
    if (!obra) {
      blockSave('missing-work-for-edit', ['A obra selecionada não foi encontrada no catálogo atual. Atualize a lista e tente novamente.'], {
        obraId,
      });
      return;
    }
    if (isMangaka && user?.uid && obraCreatorId(obra) !== user.uid) {
      blockSave('creator-cannot-edit-foreign-work', ['Você só pode editar obras que você criou.'], { obraId });
      return;
    }
    setSaveAttempted(false);
    setEditandoId(obraId);
    setObraSelecionadaId(obraId);
    const genres = parseObraGenreIdsForForm(obra);
    const rawTags = obra.tags;
    const tagsArr = Array.isArray(rawTags) ? rawTags : rawTags && typeof rawTags === 'object' ? Object.values(rawTags) : [];
    const tagsSanitized = normalizeTagsFromInput(tagsArr.join(', '));
    const mainGRaw = String(obra.mainGenre || '').trim().toLowerCase();
      const mainG = OBRAS_WORK_GENRE_IDS.includes(mainGRaw) ? mainGRaw : '';
      const creatorUid = !isMangaka ? obraCreatorId(obra) : '';
      const creatorEntry = !isMangaka ? resolveCreatorLookupValue(creatorUid, creatorDirectory) : null;
    setForm({
      id: obraId,
      titulo: obra.titulo || '',
      tituloCurto: obra.tituloCurto || '',
      sinopse: obra.sinopse || '',
      genres,
      mainGenre: mainG && genres.includes(mainG) ? mainG : genres[0] || '',
      tagsRaw: tagsSanitized.join(', '),
      capaUrl: isTrustedPlatformAssetUrl(obra.capaUrl, { allowLocalAssets: true }) ? obra.capaUrl : '',
      bannerUrl: isTrustedPlatformAssetUrl(obra.bannerUrl, { allowLocalAssets: true }) ? obra.bannerUrl : '',
      seoTitle: obra.seoTitle || '',
      seoKeywords: obra.seoKeywords || tagsToSeoKeywords(tagsSanitized),
      status: normalizeStatusForForm(obra.status),
      isPublished: obra.isPublished === true,
      archived: obraEstaArquivada(obra),
      adminCreatorId: creatorUid,
      });
      if (!isMangaka) {
        setCreatorLookupInput(creatorEntry ? formatCreatorLookupOption(creatorEntry) : '');
      }
    setCapaArquivo(null);
    setBannerArquivo(null);
    setCapaAjuste(normalizarAjusteObra(obra.capaAjuste));
    setBannerAjuste(normalizarAjusteObra(obra.bannerAjuste));
  };

  const handleCreatorLookupChange = (rawValue) => {
    const raw = String(rawValue || '');
    const resolved = resolveCreatorLookupValue(raw, creatorDirectory);
    setCreatorLookupInput(raw);
    setForm((prev) => ({
      ...prev,
      adminCreatorId: resolved?.uid || '',
    }));
  };
  const carregarObraSelecionada = () => {
    if (!obraSelecionadaId) {
      blockSave('missing-selected-work-for-edit', [
        'Selecione uma obra para editar, ou clique em "Criar nova obra".',
      ]);
      return;
    }
    editarObra(String(obraSelecionadaId));
  };

  const salvarObra = async ({ asDraft = false } = {}) => {
    setSaveAttempted(true);
    if (saveInFlightRef.current) {
      blockSave('save-already-running', [
        'Já existe um salvamento em andamento para esta obra.',
        'Espere o processo atual terminar antes de tentar novamente.',
      ], {
        workspace,
        editandoId,
        obraSelecionadaId,
      });
      return;
    }
    clearMsgs();
    if (!canAccessWorkspace) {
      blockSave('workspace-access-denied', ['Sem permissão para salvar neste painel.']);
      return;
    }
    if (!user?.uid) {
      blockSave('missing-auth-user', ['Faça login novamente antes de salvar a obra.']);
      return;
    }
    if (loading) {
      blockSave('catalog-still-loading', ['Aguarde o carregamento do catálogo antes de salvar.']);
      return;
    }
    if (!obrasSnapshotReady) {
      blockSave('obras-snapshot-not-ready', ['Aguarde o carregamento completo das obras antes de salvar.']);
      return;
    }
    if (isMangaka && user?.uid && editandoId && obraCreatorId(obrasMap.get(editandoId)) !== user.uid) {
      blockSave('creator-cannot-save-foreign-work', ['Sem permissão para alterar esta obra.']);
      return;
    }
    const creatorLookupResolved = !isMangaka
      ? resolveCreatorLookupValue(creatorLookupInput || form.adminCreatorId, creatorDirectory)
      : null;
    if (!isMangaka && !creatorLookupResolved) {
      blockSave('missing-author-resolution', [
        'Selecione um autor válido pelo @username antes de salvar.',
        'A obra só pode ser vinculada quando o autor for encontrado no diretório de usernames.',
      ], {
        creatorLookupInput,
      });
      return;
    }
    let creatorIdResolved;
    if (isMangaka && user?.uid) {
      creatorIdResolved = user.uid;
    } else {
      creatorIdResolved = String(creatorLookupResolved?.uid || '').trim();
    }
    if (!isValidCreatorUid(creatorIdResolved)) {
      blockSave('invalid-resolved-author', ['Autor da obra inválido. Resolva um @username válido antes de salvar.'], {
        creatorIdResolved,
      });
      return;
    }
    const tituloTrim = String(form.titulo || '').trim();
    if (!tituloTrim) {
      blockSave(
        asDraft ? 'obra-draft-missing-title' : 'obra-title-required',
        [asDraft ? 'Informe ao menos o título antes de salvar o rascunho.' : 'Informe o título da obra antes de salvar.']
      );
      return;
    }
    const recordSlug = obraSlugFromTitle(tituloTrim);
    if (!recordSlug) {
      blockSave('obra-invalid-slug', ['O título precisa gerar um identificador válido para a obra.']);
      return;
    }
    const v = asDraft
      ? {
          ok: true,
          errors: [],
          genres: normalizeGenreList(form.genres),
          tags: normalizeTagsFromInput(form.tagsRaw),
          slug: recordSlug,
          seoDescription: '',
        }
      : validateObraWorkForm({
          titulo: form.titulo,
          sinopse: form.sinopse,
          genres: form.genres,
          mainGenre: form.mainGenre,
          tagsRaw: form.tagsRaw,
          status: form.status,
          tituloCurto: form.tituloCurto,
          seoTitle: form.seoTitle,
          hasCapaFile: Boolean(capaArquivo),
          capaUrl: form.capaUrl,
          hasBannerFile: Boolean(bannerArquivo),
          bannerUrl: form.bannerUrl,
          editandoId,
          obrasTodas,
          isMangaka,
          currentUid: user?.uid,
          adminCreatorId: form.adminCreatorId,
        });
    if (!v.ok) {
      blockSave('obra-form-validation', v.errors.length ? v.errors : ['Corrija os campos destacados.'], {
        validationErrors: v.errors,
      });
      return;
    }
    const slugNovo = v.slug;
    const ownerUidStorage = segmentoStorageOwnerUid(creatorIdResolved);
    const obraStorageSegment = sanitizarSegmentoStorage(editandoId || slugNovo, 'obra');
    const tagsFinal = v.tags;
    const tituloCurtoTrim = String(form.tituloCurto || '').trim();
    const seoTitleTrim = String(form.seoTitle || '').trim();
    const kwRaw = String(form.seoKeywords || '').trim() || tagsToSeoKeywords(tagsFinal);
    const statusFinal = asDraft ? 'draft' : form.status;
    const isPublishedFinal = asDraft ? false : Boolean(form.isPublished);
    const payload = {
      titulo: tituloTrim,
      tituloCurto: (tituloCurtoTrim || tituloTrim).slice(0, TITULO_CURTO_MAX),
      slug: recordSlug,
      sinopse: String(form.sinopse || '').trim(),
      publicoAlvo: publicoAlvoFromMainGenre(form.mainGenre),
      genres: v.genres,
      mainGenre: String(form.mainGenre || '').trim(),
      tags: tagsFinal,
      capaUrl: isTrustedPlatformAssetUrl(String(form.capaUrl || '').trim(), { allowLocalAssets: true })
        ? String(form.capaUrl || '').trim()
        : '',
      bannerUrl: isTrustedPlatformAssetUrl(String(form.bannerUrl || '').trim(), { allowLocalAssets: true })
        ? String(form.bannerUrl || '').trim()
        : '',
      seoTitle: (seoTitleTrim || tituloTrim).slice(0, SEO_TITLE_MAX),
      seoDescription: asDraft ? '' : v.seoDescription,
      seoKeywords: kwRaw.slice(0, SEO_KEYWORDS_MAX),
      status: statusFinal,
      isPublished: isPublishedFinal,
      archivedAt: form.archived ? Date.now() : null,
      capaAjuste: normalizarAjusteObra(capaAjuste),
      bannerAjuste: normalizarAjusteObra(bannerAjuste),
      updatedAt: nowMs(),
      creatorId: creatorIdResolved,
    };

    saveInFlightRef.current = true;
    setSaving(true);
    try {
      const obraAnterior = editandoId ? obrasMap.get(editandoId) || null : null;
      const previousCoverStorageTarget = String(
        obraAnterior?.capaStoragePath || obraAnterior?.capaUrl || ''
      ).trim();
      const previousBannerStorageTarget = String(
        obraAnterior?.bannerStoragePath || obraAnterior?.bannerUrl || ''
      ).trim();
      if (auth.currentUser) {
        await auth.currentUser.getIdToken(true);
      }
      if (capaArquivo) {
        const file = await processarImagemObra(capaArquivo, capaAjuste, COVER_EDITOR_CONFIG);
        const path = `obras/${ownerUidStorage}/${obraStorageSegment}/capa_${Date.now()}.webp`;
        const fileRef = storageRef(storage, path);
        await uploadBytes(fileRef, file, {
          contentType: 'image/webp',
          cacheControl: 'public,max-age=31536000,immutable',
        });
        payload.capaUrl = await getDownloadURL(fileRef);
        payload.capaStoragePath = path;
      }
      if (bannerArquivo) {
        const file = await processarImagemObra(bannerArquivo, bannerAjuste, BANNER_EDITOR_CONFIG);
        const path = `obras/${ownerUidStorage}/${obraStorageSegment}/banner_${Date.now()}.webp`;
        const fileRef = storageRef(storage, path);
        await uploadBytes(fileRef, file, {
          contentType: 'image/webp',
          cacheControl: 'public,max-age=31536000,immutable',
        });
        payload.bannerUrl = await getDownloadURL(fileRef);
        payload.bannerStoragePath = path;
      }

      if (!editandoId) {
        const jaExisteNoBanco = await get(dbRef(db, `obras/${slugNovo}`));
        if (jaExisteNoBanco.exists()) {
          throw new Error(`Já existe uma obra com o identificador "${slugNovo}". Ajuste o título.`);
        }
        await set(dbRef(db, `obras/${slugNovo}`), {
          ...payload,
          createdAt: nowMs(),
        });
        const okMsg = asDraft ? 'Rascunho salvo com sucesso.' : 'Obra criada com sucesso.';
        setOk(okMsg);
        showSaveToast(okMsg);
        setEditandoId(slugNovo);
        setObraSelecionadaId(slugNovo);
        return;
      }

      await update(dbRef(db, `obras/${editandoId}`), payload);
      const cleanupTasks = [];
      if (
        capaArquivo &&
        previousCoverStorageTarget &&
        previousCoverStorageTarget !== payload.capaStoragePath &&
        previousCoverStorageTarget !== payload.capaUrl
      ) {
        cleanupTasks.push(safeDeleteStorageObject(storage, previousCoverStorageTarget));
      }
      if (
        bannerArquivo &&
        previousBannerStorageTarget &&
        previousBannerStorageTarget !== payload.bannerStoragePath &&
        previousBannerStorageTarget !== payload.bannerUrl
      ) {
        cleanupTasks.push(safeDeleteStorageObject(storage, previousBannerStorageTarget));
      }
      if (cleanupTasks.length) {
        await Promise.allSettled(cleanupTasks);
      }
      const okMsg = asDraft ? 'Rascunho salvo com sucesso.' : 'Obra atualizada com sucesso.';
      setOk(okMsg);
      showSaveToast(okMsg);
    } catch (e) {
      const msg = `Falha ao salvar obra: ${mensagemErroFirebase(e)}`;
      setErro(msg);
      openSaveErrorModal([msg]);
      console.error('[ObrasAdmin] save failed', {
        workspace,
        editandoId,
        obraSelecionadaId,
        uid: user?.uid || '',
        error: e,
      });
    } finally {
      saveInFlightRef.current = false;
      setSaving(false);
    }
  };

  const onTituloChange = (value) => {
    setForm((prev) => ({ ...prev, titulo: value }));
  };

  const selecionarCapa = (file) => {
    if (!file) return;
    const erroValid = validarImagemUpload(file, 'Capa');
    if (erroValid) {
      blockSave('invalid-cover-file', [erroValid]);
      return;
    }
    clearMsgs();
    closeSaveErrorModal();
    setSaveAttempted(false);
    setCapaArquivo(file);
    setCapaAjuste(normalizarAjusteObra());
  };

  const selecionarBanner = (file) => {
    if (!file) return;
    const erroValid = validarImagemUpload(file, 'Banner');
    if (erroValid) {
      blockSave('invalid-banner-file', [erroValid]);
      return;
    }
    clearMsgs();
    closeSaveErrorModal();
    setSaveAttempted(false);
    setBannerArquivo(file);
    setBannerAjuste(normalizarAjusteObra());
  };

  const iniciarArrasteMidia = (event, tipo) => {
    const ref = tipo === 'capa' ? capaEditorRef.current : bannerEditorRef.current;
    if (!ref) return;
    const possuiFonte = tipo === 'capa' ? capaEditavel : bannerEditavel;
    if (!possuiFonte) return;
    const dims = tipo === 'capa' ? capaDimensoes : bannerDimensoes;
    if (!dims) return;
    event.preventDefault();
    const clientX = event.clientX ?? event.touches?.[0]?.clientX ?? 0;
    const clientY = event.clientY ?? event.touches?.[0]?.clientY ?? 0;
    const box = ref.getBoundingClientRect();
    const ajusteAtual = tipo === 'capa' ? capaAjuste : bannerAjuste;
    const dragSnapshot = createResponsiveDragSnapshot(
      dims.w,
      dims.h,
      Math.max(1, box.width),
      Math.max(1, box.height),
      ajusteAtual,
      { maxZoomCap: tipo === 'capa' ? capaZoomBounds.maxZoom : bannerZoomBounds.maxZoom }
    );
    dragMediaRef.current = {
      tipo,
      startX: clientX,
      startY: clientY,
      ajuste: ajusteAtual,
      dragSnapshot,
    };
    document.body.style.userSelect = 'none';
  };

  useEffect(() => {
    const onMove = (event) => {
      if (!dragMediaRef.current) return;
      if (event.cancelable) event.preventDefault();
      const drag = dragMediaRef.current;
      const clientX = event.clientX ?? event.touches?.[0]?.clientX ?? 0;
      const clientY = event.clientY ?? event.touches?.[0]?.clientY ?? 0;
      const deltaX = clientX - drag.startX;
      const deltaY = clientY - drag.startY;
      if (drag.tipo === 'capa') {
        setCapaAjuste(
          applyResponsiveDragDelta(drag.ajuste, drag.dragSnapshot, deltaX, deltaY, {
            maxZoomCap: capaZoomBounds.maxZoom,
          })
        );
      } else {
        setBannerAjuste(
          applyResponsiveDragDelta(drag.ajuste, drag.dragSnapshot, deltaX, deltaY, {
            maxZoomCap: bannerZoomBounds.maxZoom,
          })
        );
      }
    };

    const onUp = () => {
      if (!dragMediaRef.current) return;
      dragMediaRef.current = null;
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
  }, [bannerZoomBounds.maxZoom, capaZoomBounds.maxZoom]);

  useEffect(() => {
    return () => {
      if (capaPreviewUrl) URL.revokeObjectURL(capaPreviewUrl);
    };
  }, [capaPreviewUrl]);

  useEffect(() => {
    return () => {
      if (bannerPreviewUrl) URL.revokeObjectURL(bannerPreviewUrl);
    };
  }, [bannerPreviewUrl]);

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
    img.src = capaFonteEditavel;
    return () => {
      ativo = false;
    };
  }, [capaFonteEditavel]);

  useEffect(() => {
    let ativo = true;
    if (!bannerFonteEditavel) {
      setBannerDimensoes(null);
      return () => {};
    }
    const img = new Image();
    img.onload = () => {
      if (!ativo) return;
      setBannerDimensoes({
        w: Number(img.naturalWidth || img.width || 0),
        h: Number(img.naturalHeight || img.height || 0),
      });
    };
    img.src = bannerFonteEditavel;
    return () => {
      ativo = false;
    };
  }, [bannerFonteEditavel]);

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
      canvas.width = COVER_EDITOR_CONFIG.outputW;
      canvas.height = COVER_EDITOR_CONFIG.outputH;
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) return;
      desenharImagemAjustada(ctx, img, canvas.width, canvas.height, capaAjuste, COVER_EDITOR_CONFIG);
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
    let ativo = true;
    let objectUrl = '';
    if (!bannerFonteEditavel) {
      setBannerPreviewFinalUrl((prev) => {
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
      canvas.width = BANNER_EDITOR_CONFIG.outputW;
      canvas.height = BANNER_EDITOR_CONFIG.outputH;
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) return;
      desenharImagemAjustada(ctx, img, canvas.width, canvas.height, bannerAjuste, BANNER_EDITOR_CONFIG);
      canvas.toBlob((blob) => {
        if (!ativo || !blob) return;
        objectUrl = URL.createObjectURL(blob);
        setBannerPreviewFinalUrl((prev) => {
          if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
          return objectUrl;
        });
      }, 'image/webp', 0.9);
    };
    img.onerror = () => {
      if (!ativo) return;
      setBannerPreviewFinalUrl((prev) => {
        if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
        return '';
      });
    };
    img.src = bannerFonteEditavel;
    return () => {
      ativo = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [bannerFonteEditavel, bannerAjuste]);

  const togglePublish = async (obra) => {
    clearMsgs();
    if (isMangaka && user?.uid && obraCreatorId(obra) !== user.uid) {
      setErro('Sem permissão.');
      return;
    }
    try {
      await update(dbRef(db, `obras/${obra.id}`), {
        isPublished: !(obra.isPublished === true),
        updatedAt: nowMs(),
      });
    } catch (e) {
      setErro(`Falha ao publicar/despublicar: ${mensagemErroFirebase(e)}`);
    }
  };

  const apagarObra = async (obra) => {
    clearMsgs();
    if (isMangaka && user?.uid && obraCreatorId(obra) !== user.uid) {
      setErro('Sem permissão para apagar esta obra.');
      return;
    }
    if (!window.confirm(`Apagar obra "${obra.titulo || obra.id}"?`)) {
      return;
    }
    let removalReason = '';
    if (!isMangaka) {
      removalReason = String(
        window.prompt('Informe o motivo da exclusão (aparece ao criador):', '')
      ).trim();
      if (!removalReason) {
        setErro('Exclusão cancelada. Motivo obrigatório para notificar o criador.');
        return;
      }
    }
    try {
      const obraKey = normalizarObraId(obra.id);
      const capsSnap = await get(dbRef(db, 'capitulos'));
      const capsVal = capsSnap.val() && typeof capsSnap.val() === 'object' ? capsSnap.val() : {};
      const patch = { [`obras/${obraKey}`]: null };
      const ownerUidStorage = segmentoStorageOwnerUid(obraCreatorId(obra));
      const chapterRows = [];
      for (const [capId, cap] of Object.entries(capsVal)) {
        if (obterObraIdCapitulo({ ...cap, id: capId }) === obraKey) {
          patch[`capitulos/${capId}`] = null;
          chapterRows.push({ id: capId, ...(cap || {}) });
        }
      }

      const chapterFileCandidates = chapterRows.flatMap((cap) => {
        const pages = Array.isArray(cap.paginas) ? cap.paginas : [];
        const pagePaths = Array.isArray(cap.paginasStoragePaths) ? cap.paginasStoragePaths : [];
        return [
          cap.capaStoragePath,
          cap.capaUrl,
          ...pagePaths,
          ...pages,
        ];
      });

      await update(dbRef(db), patch);
      await Promise.allSettled([
        safeDeleteStorageObjects(storage, [
          obra.capaStoragePath,
          obra.capaUrl,
          obra.bannerStoragePath,
          obra.bannerUrl,
          ...chapterFileCandidates,
        ]),
        safeDeleteStorageFolder(storage, `obras/${ownerUidStorage}/${obraKey}`),
        safeDeleteStorageFolder(storage, `manga/${ownerUidStorage}/${obraKey}`),
      ]);
      if (!isMangaka && obraCreatorId(obra)) {
        await notifyCreatorContentRemoval({
          targetUid: obraCreatorId(obra),
          contentType: 'obra',
          contentId: obraKey,
          contentTitle: obra.titulo || obra.id,
          reason: removalReason,
        });
      }
      if (editandoId === obra.id) iniciarNovo();
      setOk('Obra e capítulos vinculados removidos do site.');
    } catch (e) {
      setErro(`Falha ao apagar obra: ${mensagemErroFirebase(e)}`);
    }
  };

  if (loading) {
    return <div className="shito-app-splash" aria-hidden="true" />;
  }

  const coverCrop = editorLayout(COVER_EDITOR_CONFIG);
  const bannerCrop = editorLayout(BANNER_EDITOR_CONFIG);

  return (
    <main className="obras-admin-page">
      <header className="obras-admin-head">
        <div>
          <h1>{isMangaka ? 'Minhas obras' : isCreatorWorkspace ? 'Biblioteca de obras' : 'Editor de Obras'}</h1>
          <p>
            {isMangaka
              ? 'Crie, edite e publique apenas as obras do seu proprio catalogo.'
              : isCreatorWorkspace
                ? 'Supervisione o catalogo de criadores sem sair do contexto de conteudo.'
                : 'Gerencie dados, mídia, SEO e publicação com preview em tempo real.'}
          </p>
        </div>
        <div className="obras-admin-head-actions">
          <button type="button" className="btn-sec" onClick={iniciarNovo}>Nova obra</button>
          <button type="button" className="btn-sec" onClick={() => navigate(chaptersPath)}>Ir para capítulos</button>
        </div>
      </header>

      {(erro || ok) && (
        <div className={`obras-msg ${erro ? 'erro' : 'ok'}`}>
          {erro || ok}
        </div>
      )}

      <section className="obras-admin-layout">
        <ObrasEditor
          obras={obras}
          obraSelecionadaId={obraSelecionadaId}
          setObraSelecionadaId={setObraSelecionadaId}
          carregarObraSelecionada={carregarObraSelecionada}
          iniciarNovo={iniciarNovo}
          editandoId={editandoId}
          form={form}
          setForm={setForm}
          validationLive={validationLive}
          saveAttempted={saveAttempted}
          isMangaka={isMangaka}
          creatorLookupInput={creatorLookupInput}
          handleCreatorLookupChange={handleCreatorLookupChange}
        creatorDirectory={creatorDirectory}
        formatCreatorLookupOption={formatCreatorLookupOption}
        resolvedCreatorLookup={resolvedCreatorLookup}
        creatorLookupMatches={creatorLookupMatches}
        creatorNeedsSelection={creatorNeedsSelection}
        creatorWorkspaceProfile={creatorWorkspaceProfile}
          onTituloChange={onTituloChange}
          slugPreview={slugPreview}
          toggleGenre={toggleGenre}
          preview={preview}
          statusLabelById={STATUS_LABEL_BY_ID}
          selecionarCapa={selecionarCapa}
          selecionarBanner={selecionarBanner}
          capaEditorRef={capaEditorRef}
          bannerEditorRef={bannerEditorRef}
          capaEditavel={capaEditavel}
          bannerEditavel={bannerEditavel}
          iniciarArrasteMidia={iniciarArrasteMidia}
          capaPreviewUrl={capaPreviewUrl}
          bannerPreviewUrl={bannerPreviewUrl}
          coverCrop={coverCrop}
          bannerCrop={bannerCrop}
          capaEditorImageStyle={capaEditorImageStyle}
          bannerEditorImageStyle={bannerEditorImageStyle}
          capaZoomBounds={capaZoomBounds}
          bannerZoomBounds={bannerZoomBounds}
          capaAjuste={capaAjuste}
          bannerAjuste={bannerAjuste}
          setCapaAjuste={setCapaAjuste}
          setBannerAjuste={setBannerAjuste}
          capaDimensoes={capaDimensoes}
          bannerDimensoes={bannerDimensoes}
          normalizarAjusteObra={normalizarAjusteObra}
          coverEditorConfig={COVER_EDITOR_CONFIG}
          bannerEditorConfig={BANNER_EDITOR_CONFIG}
          salvarObra={salvarObra}
          saving={saving}
          user={user}
          apagarObra={apagarObra}
        />

        <ObrasList
          obras={obras}
          isMangaka={isMangaka}
          statusLabelById={STATUS_LABEL_BY_ID}
          obraEstaArquivada={obraEstaArquivada}
          formatarDataHoraBr={formatarDataHoraBr}
          editarObra={editarObra}
          togglePublish={togglePublish}
          apagarObra={apagarObra}
        />
      </section>
      {createPortal(
        saveErrorModal.open ? (
          <div
            className="obra-save-modal-overlay"
            role="presentation"
            onClick={(e) => {
              if (e.target === e.currentTarget) closeSaveErrorModal();
            }}
          >
            <div
              className="obra-save-modal-panel is-error"
              role="dialog"
              aria-modal="true"
              aria-labelledby="obra-save-modal-title"
              aria-describedby="obra-save-modal-desc"
            >
              <h2 id="obra-save-modal-title" className="obra-save-modal-title">
                Não foi possível salvar
              </h2>
              <div id="obra-save-modal-desc" className="obra-save-modal-body">
                {saveErrorModal.lines.length === 1 ? (
                  <p>{saveErrorModal.lines[0]}</p>
                ) : (
                  <ul>
                    {saveErrorModal.lines.map((line, i) => (
                      <li key={`${i}-${line.slice(0, 40)}`}>{line}</li>
                    ))}
                  </ul>
                )}
              </div>
              <button type="button" className="btn-pri obra-save-modal-btn" onClick={closeSaveErrorModal}>
                Entendi
              </button>
            </div>
          </div>
        ) : null,
        document.body
      )}
      <div
        className={`obra-save-feedback ${saveToast.visible ? 'show' : ''} ok`}
        role="status"
        aria-live="polite"
      >
        <strong>Salvo</strong>
        <span>{saveToast.text}</span>
      </div>
    </main>
  );
}



