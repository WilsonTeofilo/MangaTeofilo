import React, { useEffect, useMemo, useRef, useState } from 'react';
import { get, onValue, ref as dbRef, remove, set, update } from 'firebase/database';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { useNavigate } from 'react-router-dom';

import { auth, db, storage } from '../../services/firebase';
import { PLATFORM_LEGACY_CREATOR_UID } from '../../constants';
import { formatarDataHoraBr } from '../../utils/datasBr';
import { OBRA_PADRAO_ID, OBRA_SHITO_DEFAULT, ensureLegacyShitoObra, obraCreatorId } from '../../config/obras';
import './ObrasAdmin.css';

const STATUS_OPTIONS = [
  { id: 'ongoing', label: 'Em lançamento' },
  { id: 'completed', label: 'Completo' },
  { id: 'draft', label: 'Rascunho' },
  { id: 'hiatus', label: 'Hiato' },
];

function slugify(input) {
  return String(input || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function nowMs() {
  return Date.now();
}

function normalizarAjusteObra(raw) {
  return {
    zoom: Math.min(3, Math.max(1, Number(raw?.zoom ?? 1))),
    x: Math.min(100, Math.max(-100, Number(raw?.x ?? 0))),
    y: Math.min(100, Math.max(-100, Number(raw?.y ?? 0))),
  };
}

const IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const MAX_INPUT_IMAGE_SIZE_BYTES = 7 * 1024 * 1024;
const MAX_COMPRESSED_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
const TARGET_IMAGE_SIZE_BYTES = 2.2 * 1024 * 1024;
const COVER_EDITOR_CONFIG = {
  outputW: 1200,
  outputH: 1600,
  editorW: 16,
  editorH: 10,
  cropWidthRatio: 0.45,
};
const BANNER_EDITOR_CONFIG = {
  outputW: 1600,
  outputH: 900,
  editorW: 16,
  editorH: 10,
  cropWidthRatio: 0.84,
};
const OBRAS_EDITOR_PAN_MARGIN_RATIO = 0.06;
const OBRAS_EDITOR_DRAG_SENSITIVITY = 1.6;

function validarImagemUpload(file, label = 'Imagem') {
  if (!file) return `${label} não encontrado.`;
  if (!IMAGE_TYPES.includes(file.type)) return `${label} inválido. Use JPG, PNG ou WEBP.`;
  if (file.size > MAX_INPUT_IMAGE_SIZE_BYTES) return `${label} excede 7MB.`;
  return '';
}

function calcularGeometriaEditorObra(
  imgW,
  imgH,
  frameW,
  frameH,
  ajuste = { zoom: 1, x: 0, y: 0 }
) {
  const zoom = Math.min(3, Math.max(1, Number(ajuste?.zoom || 1)));
  const eixoX = Math.min(100, Math.max(-100, Number(ajuste?.x || 0)));
  const eixoY = Math.min(100, Math.max(-100, Number(ajuste?.y || 0)));

  const coverScale = Math.max(frameW / imgW, frameH / imgH);
  const minScalePanX = (frameW * (1 + OBRAS_EDITOR_PAN_MARGIN_RATIO * 2)) / imgW;
  const minScalePanY = (frameH * (1 + OBRAS_EDITOR_PAN_MARGIN_RATIO * 2)) / imgH;
  const baseScale = Math.max(coverScale, minScalePanX, minScalePanY);
  const scale = baseScale * zoom;
  const drawW = imgW * scale;
  const drawH = imgH * scale;
  const limiteX = Math.max(0, (drawW - frameW) / 2);
  const limiteY = Math.max(0, (drawH - frameH) / 2);
  const shiftX = (eixoX / 100) * limiteX;
  const shiftY = (eixoY / 100) * limiteY;
  const drawX = (frameW - drawW) / 2 + shiftX;
  const drawY = (frameH - drawH) / 2 + shiftY;

  return { drawW, drawH, drawX, drawY };
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

async function comprimirImagemParaUpload(file) {
  if (file.size <= MAX_COMPRESSED_IMAGE_SIZE_BYTES) return file;
  const img = await carregarImagem(file);
  let width = img.naturalWidth || img.width;
  let height = img.naturalHeight || img.height;
  let quality = 0.9;
  let melhorBlob = null;
  for (let tentativa = 0; tentativa < 9; tentativa += 1) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Falha ao inicializar compressor de imagem.');
    ctx.drawImage(img, 0, 0, width, height);
    const blob = await canvasParaBlob(canvas, 'image/webp', quality);
    melhorBlob = blob;
    if (blob.size <= TARGET_IMAGE_SIZE_BYTES || blob.size <= MAX_COMPRESSED_IMAGE_SIZE_BYTES) {
      return new File([blob], nomeArquivoComExtensao(file.name, '.webp'), { type: 'image/webp', lastModified: Date.now() });
    }
    if (quality > 0.56) quality -= 0.08;
    else {
      width = Math.max(900, Math.round(width * 0.86));
      height = Math.max(900, Math.round(height * 0.86));
    }
  }
  if (!melhorBlob || melhorBlob.size > MAX_COMPRESSED_IMAGE_SIZE_BYTES) {
    throw new Error('Não foi possível otimizar imagem para até 5MB.');
  }
  return new File([melhorBlob], nomeArquivoComExtensao(file.name, '.webp'), { type: 'image/webp', lastModified: Date.now() });
}

function desenharImagemAjustada(
  ctx,
  img,
  targetW,
  targetH,
  ajuste = { zoom: 1, x: 0, y: 0 },
  editorConfig = BANNER_EDITOR_CONFIG
) {
  const frameW = targetW / editorConfig.cropWidthRatio;
  const frameH = frameW * (editorConfig.editorH / editorConfig.editorW);
  const cropX = (frameW - targetW) / 2;
  const cropY = (frameH - targetH) / 2;
  const { drawW, drawH, drawX, drawY } = calcularGeometriaEditorObra(
    Number(img.width || 0),
    Number(img.height || 0),
    frameW,
    frameH,
    ajuste
  );

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#0b0b0b';
  ctx.fillRect(0, 0, targetW, targetH);
  ctx.globalAlpha = 0.35;
  const bgScale = Math.max(frameW / img.width, frameH / img.height);
  const bgW = img.width * bgScale;
  const bgH = img.height * bgScale;
  ctx.drawImage(img, ((frameW - bgW) / 2) - cropX, ((frameH - bgH) / 2) - cropY, bgW, bgH);
  ctx.globalAlpha = 1;
  ctx.drawImage(img, drawX - cropX, drawY - cropY, drawW, drawH);
}

async function processarImagemObra(file, ajuste, editorConfig) {
  const otimizada = await comprimirImagemParaUpload(file);
  const img = await carregarImagem(otimizada);
  const canvas = document.createElement('canvas');
  canvas.width = editorConfig.outputW;
  canvas.height = editorConfig.outputH;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Falha ao processar imagem da obra.');
  desenharImagemAjustada(ctx, img, canvas.width, canvas.height, ajuste, editorConfig);
  const blob = await canvasParaBlob(canvas, 'image/webp', 0.9);
  if (blob.size > MAX_COMPRESSED_IMAGE_SIZE_BYTES) {
    throw new Error('Imagem final excedeu 5MB. Ajuste o arquivo original.');
  }
  return new File([blob], nomeArquivoComExtensao(file.name, '.webp'), {
    type: 'image/webp',
    lastModified: Date.now(),
  });
}

function editorLayout(config) {
  const left = ((1 - config.cropWidthRatio) / 2) * 100;
  const cropHRatio = config.cropWidthRatio * (config.outputH / config.outputW) * (config.editorW / config.editorH);
  const top = ((1 - cropHRatio) / 2) * 100;
  return {
    leftPct: left,
    topPct: top,
    widthPct: config.cropWidthRatio * 100,
    heightPct: cropHRatio * 100,
  };
}

function estiloEditorImagem(dim, ajuste = { zoom: 1, x: 0, y: 0 }, editorConfig = BANNER_EDITOR_CONFIG) {
  const w = Number(dim?.w || 0);
  const h = Number(dim?.h || 0);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return {};
  }
  const frameW = editorConfig.editorW;
  const frameH = editorConfig.editorH;
  const { drawW, drawH, drawX, drawY } = calcularGeometriaEditorObra(w, h, frameW, frameH, ajuste);

  return {
    width: `${(drawW / frameW) * 100}%`,
    height: `${(drawH / frameH) * 100}%`,
    left: `${(drawX / frameW) * 100}%`,
    top: `${(drawY / frameH) * 100}%`,
  };
}

function emptyForm() {
  return {
    id: '',
    titulo: '',
    tituloCurto: '',
    slug: '',
    sinopse: '',
    publicoAlvo: '',
    capaUrl: '',
    bannerUrl: '',
    seoTitle: '',
    seoDescription: '',
    seoKeywords: '',
    status: 'ongoing',
    isPublished: false,
  };
}

export default function ObrasAdmin({ adminAccess }) {
  const navigate = useNavigate();
  const user = auth.currentUser;
  const isMangaka = Boolean(adminAccess?.isMangaka);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [obras, setObras] = useState([]);
  const [obraSelecionadaId, setObraSelecionadaId] = useState('');
  const [form, setForm] = useState(emptyForm());
  const [editandoId, setEditandoId] = useState(null);
  const [erro, setErro] = useState('');
  const [ok, setOk] = useState('');
  const [saveFeedback, setSaveFeedback] = useState({ visible: false, type: 'ok', text: '' });
  const [slugAuto, setSlugAuto] = useState(true);
  const [slugLocked, setSlugLocked] = useState(false);
  const [capaArquivo, setCapaArquivo] = useState(null);
  const [bannerArquivo, setBannerArquivo] = useState(null);
  const [capaAjuste, setCapaAjuste] = useState({ zoom: 1, x: 0, y: 0 });
  const [bannerAjuste, setBannerAjuste] = useState({ zoom: 1, x: 0, y: 0 });
  const [capaDimensoes, setCapaDimensoes] = useState(null);
  const [bannerDimensoes, setBannerDimensoes] = useState(null);
  const [capaPreviewFinalUrl, setCapaPreviewFinalUrl] = useState('');
  const [bannerPreviewFinalUrl, setBannerPreviewFinalUrl] = useState('');
  const capaEditorRef = useRef(null);
  const bannerEditorRef = useRef(null);
  const dragMediaRef = useRef(null);
  const saveFeedbackTimerRef = useRef(null);
  const legacyShitoSeedRef = useRef(false);

  useEffect(() => {
    if (!adminAccess?.canAccessAdmin) {
      navigate('/');
      return;
    }
    const obrasRef = dbRef(db, 'obras');
    const unsub = onValue(obrasRef, (snapshot) => {
      if (!snapshot.exists()) {
        setObras([{ ...OBRA_SHITO_DEFAULT, id: OBRA_PADRAO_ID }]);
        setObraSelecionadaId('');
        setLoading(false);
        return;
      }
      const raw = snapshot.val() || {};
      if (!isMangaka && !raw?.[OBRA_PADRAO_ID] && !legacyShitoSeedRef.current) {
        legacyShitoSeedRef.current = true;
        set(dbRef(db, `obras/${OBRA_PADRAO_ID}`), {
          ...OBRA_SHITO_DEFAULT,
          id: OBRA_PADRAO_ID,
          slug: OBRA_PADRAO_ID,
          isPublished: true,
          createdAt: Number(raw?.[OBRA_PADRAO_ID]?.createdAt || 0),
          updatedAt: nowMs(),
          creatorId: OBRA_SHITO_DEFAULT.creatorId,
        }).catch(() => {
          legacyShitoSeedRef.current = false;
        });
      }
      const lista = ensureLegacyShitoObra(
        Object.entries(raw).map(([id, data]) => ({
          id,
          ...(data || {}),
        }))
      );
      lista.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
      const visivel =
        isMangaka && user?.uid
          ? lista.filter((o) => obraCreatorId(o) === user.uid)
          : lista;
      setObras(visivel);
      setObraSelecionadaId((curr) => {
        if (!curr) return '';
        if (lista.some((obra) => obra.id === curr)) return curr;
        return '';
      });
      setLoading(false);
    });
    return () => unsub();
  }, [navigate, user, adminAccess?.canAccessAdmin, isMangaka]);

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
  const preview = useMemo(() => ({
    titulo: form.titulo || 'Título da Obra',
    tituloCurto: form.tituloCurto || form.titulo || 'Obra',
    sinopse: form.sinopse || 'Sinopse da obra para pré-visualização.',
    capaUrl: capaLiveUrl,
    bannerUrl: bannerLiveUrl,
    status: form.status || 'ongoing',
    isPublished: Boolean(form.isPublished),
  }), [form, capaLiveUrl, bannerLiveUrl]);
  const capaEditorImageStyle = useMemo(
    () => estiloEditorImagem(capaDimensoes, capaAjuste, COVER_EDITOR_CONFIG),
    [capaDimensoes, capaAjuste]
  );
  const bannerEditorImageStyle = useMemo(
    () => estiloEditorImagem(bannerDimensoes, bannerAjuste, BANNER_EDITOR_CONFIG),
    [bannerDimensoes, bannerAjuste]
  );

  const clearMsgs = () => {
    setErro('');
    setOk('');
  };

  const abrirFeedbackSalvar = (type, text, timeoutMs = 3400) => {
    if (saveFeedbackTimerRef.current) clearTimeout(saveFeedbackTimerRef.current);
    setSaveFeedback({ visible: true, type, text });
    saveFeedbackTimerRef.current = setTimeout(() => {
      setSaveFeedback((prev) => ({ ...prev, visible: false }));
      saveFeedbackTimerRef.current = null;
    }, timeoutMs);
  };

  useEffect(() => {
    return () => {
      if (saveFeedbackTimerRef.current) clearTimeout(saveFeedbackTimerRef.current);
    };
  }, []);

  const iniciarNovo = () => {
    clearMsgs();
    setEditandoId(null);
    setObraSelecionadaId('');
    setForm(emptyForm());
    setSlugAuto(true);
    setSlugLocked(false);
    setCapaArquivo(null);
    setBannerArquivo(null);
    setCapaAjuste({ zoom: 1, x: 0, y: 0 });
    setBannerAjuste({ zoom: 1, x: 0, y: 0 });
  };

  const editarObra = (obraId) => {
    clearMsgs();
    const obra = obrasMap.get(obraId);
    if (!obra) return;
    if (isMangaka && user?.uid && obraCreatorId(obra) !== user.uid) {
      setErro('Você só pode editar obras que você criou.');
      return;
    }
    setEditandoId(obraId);
    setObraSelecionadaId(obraId);
    setSlugAuto(false);
    setSlugLocked(true);
    setForm({
      id: obraId,
      titulo: obra.titulo || '',
      tituloCurto: obra.tituloCurto || '',
      slug: obra.slug || obraId,
      sinopse: obra.sinopse || '',
      publicoAlvo: obra.publicoAlvo || '',
      capaUrl: obra.capaUrl || '',
      bannerUrl: obra.bannerUrl || '',
      seoTitle: obra.seoTitle || '',
      seoDescription: obra.seoDescription || '',
      seoKeywords: obra.seoKeywords || '',
      status: obra.status || 'ongoing',
      isPublished: obra.isPublished === true,
    });
    setCapaArquivo(null);
    setBannerArquivo(null);
    setCapaAjuste(normalizarAjusteObra(obra.capaAjuste));
    setBannerAjuste(normalizarAjusteObra(obra.bannerAjuste));
  };

  const carregarObraSelecionada = () => {
    if (!obraSelecionadaId) {
      setErro('Selecione uma obra para editar, ou clique em "Criar nova obra".');
      abrirFeedbackSalvar('erro', 'Selecione uma obra para editar.', 3200);
      return;
    }
    editarObra(String(obraSelecionadaId));
  };

  const validarForm = () => {
    const titulo = String(form.titulo || '').trim();
    const slug = slugify(form.slug || form.id || form.titulo);
    if (!titulo || titulo.length < 2) return 'Título obrigatório (mínimo 2 caracteres).';
    if (!slug || slug.length < 2) return 'Slug inválido.';
    if (!/^[a-z0-9-]{2,40}$/.test(slug)) return 'Slug deve conter apenas letras minúsculas, números e hífen.';
    const jaExiste = obras.some((obra) => obra.id === slug && obra.id !== editandoId);
    if (jaExiste) return `Já existe uma obra com slug "${slug}".`;
    if (!STATUS_OPTIONS.some((s) => s.id === form.status)) return 'Status inválido.';
    if (!String(form.sinopse || '').trim()) return 'Sinopse é obrigatória.';
    if (!String(form.capaUrl || '').trim() && !capaArquivo) return 'Capa é obrigatória (upload ou URL).';
    if (!String(form.bannerUrl || '').trim() && !bannerArquivo) return 'Banner é obrigatório (upload ou URL).';
    return '';
  };

  const salvarObra = async () => {
    clearMsgs();
    const erroValidacao = validarForm();
    if (erroValidacao) {
      setErro(erroValidacao);
      abrirFeedbackSalvar('erro', erroValidacao, 4400);
      return;
    }
    const slug = slugify(form.slug || form.id || form.titulo);
    if (isMangaka && user?.uid && editandoId && obraCreatorId(obrasMap.get(editandoId)) !== user.uid) {
      setErro('Sem permissão para alterar esta obra.');
      return;
    }
    const creatorIdResolved =
      editandoId && obrasMap.has(editandoId)
        ? obraCreatorId(obrasMap.get(editandoId))
        : isMangaka && user?.uid
          ? user.uid
          : PLATFORM_LEGACY_CREATOR_UID;
    const payload = {
      titulo: String(form.titulo || '').trim(),
      tituloCurto: String(form.tituloCurto || '').trim() || String(form.titulo || '').trim(),
      slug,
      sinopse: String(form.sinopse || '').trim(),
      publicoAlvo: String(form.publicoAlvo || '').trim() || 'Geral',
      capaUrl: String(form.capaUrl || '').trim(),
      bannerUrl: String(form.bannerUrl || '').trim(),
      seoTitle: String(form.seoTitle || '').trim() || String(form.titulo || '').trim(),
      seoDescription: String(form.seoDescription || '').trim() || String(form.sinopse || '').trim().slice(0, 160),
      seoKeywords: String(form.seoKeywords || '').trim(),
      status: form.status,
      isPublished: Boolean(form.isPublished),
      capaAjuste: normalizarAjusteObra(capaAjuste),
      bannerAjuste: normalizarAjusteObra(bannerAjuste),
      updatedAt: nowMs(),
      creatorId: creatorIdResolved,
    };

    setSaving(true);
    try {
      if (capaArquivo) {
        const file = await processarImagemObra(capaArquivo, capaAjuste, COVER_EDITOR_CONFIG);
        const path = `obras/${slug}/capa_${Date.now()}.webp`;
        const fileRef = storageRef(storage, path);
        await uploadBytes(fileRef, file);
        payload.capaUrl = await getDownloadURL(fileRef);
      }
      if (bannerArquivo) {
        const file = await processarImagemObra(bannerArquivo, bannerAjuste, BANNER_EDITOR_CONFIG);
        const path = `obras/${slug}/banner_${Date.now()}.webp`;
        const fileRef = storageRef(storage, path);
        await uploadBytes(fileRef, file);
        payload.bannerUrl = await getDownloadURL(fileRef);
      }

      if (!editandoId) {
        const jaExisteNoBanco = await get(dbRef(db, `obras/${slug}`));
        if (jaExisteNoBanco.exists()) {
          throw new Error(`Já existe uma obra com slug "${slug}".`);
        }
        await set(dbRef(db, `obras/${slug}`), {
          ...payload,
          createdAt: nowMs(),
        });
        setOk('Obra criada com sucesso.');
        abrirFeedbackSalvar('ok', 'Obra criada com sucesso.');
        setEditandoId(slug);
        setObraSelecionadaId(slug);
        setSlugLocked(true);
        return;
      }

      if (editandoId === slug) {
        await update(dbRef(db, `obras/${editandoId}`), payload);
        setOk('Obra atualizada com sucesso.');
        abrirFeedbackSalvar('ok', 'Obra atualizada com sucesso.');
        return;
      }

      if (editandoId === OBRA_PADRAO_ID && slug !== OBRA_PADRAO_ID) {
        throw new Error('A obra base "shito" não pode ter slug alterado.');
      }

      const confirmarMigracao = window.confirm(
        `Alterar slug de "${editandoId}" para "${slug}"?\n\nIsso migra a obra para outro ID e remove o ID antigo.`
      );
      if (!confirmarMigracao) {
        throw new Error('Alteração de slug cancelada.');
      }

      const original = obrasMap.get(editandoId);
      await set(dbRef(db, `obras/${slug}`), {
        ...(original || {}),
        ...payload,
        createdAt: Number(original?.createdAt || nowMs()),
      });
      await remove(dbRef(db, `obras/${editandoId}`));
      setEditandoId(slug);
      setObraSelecionadaId(slug);
      setSlugLocked(true);
      setOk('Slug alterado e obra migrada com sucesso.');
      abrirFeedbackSalvar('ok', 'Slug alterado e obra migrada com sucesso.');
    } catch (e) {
      const msg = `Falha ao salvar obra: ${e?.message || 'erro desconhecido'}`;
      setErro(msg);
      abrirFeedbackSalvar('erro', msg, 5200);
    } finally {
      setSaving(false);
    }
  };

  const onTituloChange = (value) => {
    setForm((prev) => {
      const next = { ...prev, titulo: value };
      if (slugAuto) next.slug = slugify(value);
      return next;
    });
  };

  const onSlugChange = (value) => {
    if (editandoId && slugLocked) return;
    setSlugAuto(false);
    setForm((prev) => ({ ...prev, slug: slugify(value) }));
  };

  const selecionarCapa = (file) => {
    if (!file) return;
    const erroValid = validarImagemUpload(file, 'Capa');
    if (erroValid) {
      setErro(erroValid);
      return;
    }
    setErro('');
    setCapaArquivo(file);
    setCapaAjuste({ zoom: 1, x: 0, y: 0 });
  };

  const selecionarBanner = (file) => {
    if (!file) return;
    const erroValid = validarImagemUpload(file, 'Banner');
    if (erroValid) {
      setErro(erroValid);
      return;
    }
    setErro('');
    setBannerArquivo(file);
    setBannerAjuste({ zoom: 1, x: 0, y: 0 });
  };

  const iniciarArrasteMidia = (event, tipo) => {
    const ref = tipo === 'capa' ? capaEditorRef.current : bannerEditorRef.current;
    if (!ref) return;
    const possuiFonte = tipo === 'capa' ? capaEditavel : bannerEditavel;
    if (!possuiFonte) return;
    event.preventDefault();
    const clientX = event.clientX ?? event.touches?.[0]?.clientX ?? 0;
    const clientY = event.clientY ?? event.touches?.[0]?.clientY ?? 0;
    const box = ref.getBoundingClientRect();
    const ajusteAtual = tipo === 'capa' ? capaAjuste : bannerAjuste;
    dragMediaRef.current = {
      tipo,
      startX: clientX,
      startY: clientY,
      eixoX: ajusteAtual.x,
      eixoY: ajusteAtual.y,
      largura: Math.max(1, box.width),
      altura: Math.max(1, box.height),
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
      const novoX = drag.eixoX + ((deltaX / (drag.largura * 0.5)) * 100 * OBRAS_EDITOR_DRAG_SENSITIVITY);
      const novoY = drag.eixoY + ((deltaY / (drag.altura * 0.5)) * 100 * OBRAS_EDITOR_DRAG_SENSITIVITY);
      if (drag.tipo === 'capa') {
        setCapaAjuste((prev) => ({ ...prev, x: Math.max(-100, Math.min(100, novoX)), y: Math.max(-100, Math.min(100, novoY)) }));
      } else {
        setBannerAjuste((prev) => ({ ...prev, x: Math.max(-100, Math.min(100, novoX)), y: Math.max(-100, Math.min(100, novoY)) }));
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
  }, []);

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
      setErro(`Falha ao publicar/despublicar: ${e?.message || 'erro desconhecido'}`);
    }
  };

  const apagarObra = async (obra) => {
    clearMsgs();
    if (isMangaka && user?.uid && obraCreatorId(obra) !== user.uid) {
      setErro('Sem permissão para apagar esta obra.');
      return;
    }
    if (obra.id === OBRA_PADRAO_ID) {
      setErro('A obra padrão (shito) não pode ser apagada por segurança.');
      return;
    }
    if (!window.confirm(`Apagar obra "${obra.titulo || obra.id}"?`)) return;
    try {
      await remove(dbRef(db, `obras/${obra.id}`));
      if (editandoId === obra.id) iniciarNovo();
      setOk('Obra apagada.');
    } catch (e) {
      setErro(`Falha ao apagar obra: ${e?.message || 'erro desconhecido'}`);
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
          <h1>{isMangaka ? 'Minhas obras' : 'Editor de Obras'}</h1>
          <p>
            {isMangaka
              ? 'CRUD apenas das suas obras (multi-tenant).'
              : 'Gerencie dados, mídia, SEO e publicação com preview em tempo real.'}
          </p>
        </div>
        <div className="obras-admin-head-actions">
          <button type="button" className="btn-sec" onClick={iniciarNovo}>Nova obra</button>
          <button type="button" className="btn-sec" onClick={() => navigate('/admin/capitulos')}>Ir para capítulos</button>
        </div>
      </header>

      {(erro || ok) && (
        <div className={`obras-msg ${erro ? 'erro' : 'ok'}`}>
          {erro || ok}
        </div>
      )}

      <section className="obras-admin-layout">
        <div className="obras-admin-form">
          <section className="obra-block obra-editor-mode">
            <header className="obra-block-head">
              <h2>Selecionar obra para edição</h2>
              <p>Escolha uma obra existente para editar, ou inicie uma nova sem sobrescrever.</p>
            </header>
            <div className="obra-editor-mode-row">
              <label>
                Obra cadastrada
                <select value={obraSelecionadaId} onChange={(e) => setObraSelecionadaId(String(e.target.value || ''))}>
                  <option value="">Selecione uma obra para editar</option>
                  {obras.map((obra) => (
                    <option key={obra.id} value={obra.id}>
                      {obra.tituloCurto || obra.titulo || obra.id}
                    </option>
                  ))}
                </select>
              </label>
              <div className="obra-editor-mode-actions">
                <button type="button" className="btn-sec" onClick={carregarObraSelecionada}>
                  Editar selecionada
                </button>
                <button type="button" className="btn-pri" onClick={iniciarNovo}>
                  Criar nova obra
                </button>
              </div>
            </div>
            <p className={`obra-editor-mode-status ${editandoId ? 'is-editing' : 'is-creating'}`}>
              {editandoId ? `Modo atual: editando "${form.titulo || editandoId}"` : 'Modo atual: criando nova obra'}
            </p>
          </section>

          <section className="obra-block">
            <header className="obra-block-head">
              <h2>Informações básicas</h2>
              <p>Defina a identidade principal da obra.</p>
            </header>
            <div className="obra-grid">
              <label>
                Título *
                <input
                  type="text"
                  value={form.titulo}
                  onChange={(e) => onTituloChange(e.target.value)}
                  placeholder="Nome oficial da obra"
                />
              </label>
              <label>
                Título curto
                <input
                  type="text"
                  value={form.tituloCurto}
                  onChange={(e) => setForm((p) => ({ ...p, tituloCurto: e.target.value }))}
                  placeholder="Ex: SHITO"
                />
              </label>
              <label>
                Slug *
                <div className="slug-input-wrap">
                  <input
                    type="text"
                    value={form.slug}
                    disabled={Boolean(editandoId && slugLocked)}
                    onChange={(e) => onSlugChange(e.target.value)}
                    placeholder="slug-da-obra"
                  />
                  {editandoId && slugLocked ? (
                    <button
                      type="button"
                      className="btn-inline"
                      onClick={() => setSlugLocked(false)}
                    >
                      desbloquear
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn-inline"
                      onClick={() => setForm((p) => ({ ...p, slug: slugify(p.titulo) }))}
                    >
                      gerar
                    </button>
                  )}
                </div>
                <small className="field-help">
                  URL pública: <code>/work/{form.slug || 'slug-da-obra'}</code> (legado: <code>/obra/…</code>)
                </small>
                {editandoId ? (
                  <small className="field-help">
                    {slugLocked
                      ? 'Slug travado para evitar sobrescrita acidental. Desbloqueie apenas se quiser migrar a obra.'
                      : 'Slug destravado: salvar pode migrar a obra para outro ID.'}
                  </small>
                ) : null}
              </label>
              <label>
                Público alvo
                <input
                  type="text"
                  value={form.publicoAlvo}
                  onChange={(e) => setForm((p) => ({ ...p, publicoAlvo: e.target.value }))}
                  placeholder="Ex: Seinen, 16+"
                />
              </label>
            </div>
            <label>
              Sinopse *
              <textarea
                value={form.sinopse}
                onChange={(e) => setForm((p) => ({ ...p, sinopse: e.target.value }))}
                rows={4}
                placeholder="Resumo da obra"
              />
            </label>
          </section>

          <section className="obra-block">
            <header className="obra-block-head">
              <h2>Mídia</h2>
              <p>Faça upload da capa/banner e ajuste enquadramento antes de salvar.</p>
            </header>
            <div className="obra-media-grid">
              <div className="obra-media-card">
                <h3>Capa (3:4)</h3>
                <input type="file" accept="image/jpeg,image/jpg,image/png,image/webp" onChange={(e) => selecionarCapa(e.target.files?.[0])} />
                <div
                  ref={capaEditorRef}
                  className={`obra-editor-mask obra-editor-mask--cover${capaEditavel ? ' is-editable' : ''}`}
                  onMouseDown={(e) => iniciarArrasteMidia(e, 'capa')}
                  onTouchStart={(e) => iniciarArrasteMidia(e, 'capa')}
                  title={capaEditavel ? 'Arraste para ajustar o enquadramento da capa' : 'Envie uma capa para editar'}
                >
                  <img
                    src={capaPreviewUrl || form.capaUrl || '/assets/fotos/shito.jpg'}
                    alt="Editor da capa"
                    className="obra-editor-img"
                    style={capaEditavel ? capaEditorImageStyle : undefined}
                  />
                  <div className="obra-editor-outside-mask" aria-hidden="true">
                    <i style={{ left: 0, top: 0, width: '100%', height: `${coverCrop.topPct}%` }} />
                    <i style={{ left: 0, top: `${coverCrop.topPct + coverCrop.heightPct}%`, width: '100%', height: `${coverCrop.topPct}%` }} />
                    <i style={{ left: 0, top: `${coverCrop.topPct}%`, width: `${coverCrop.leftPct}%`, height: `${coverCrop.heightPct}%` }} />
                    <i style={{ left: `${coverCrop.leftPct + coverCrop.widthPct}%`, top: `${coverCrop.topPct}%`, width: `${coverCrop.leftPct}%`, height: `${coverCrop.heightPct}%` }} />
                  </div>
                  <div
                    className="obra-editor-crop-box"
                    style={{
                      left: `${coverCrop.leftPct}%`,
                      top: `${coverCrop.topPct}%`,
                      width: `${coverCrop.widthPct}%`,
                      height: `${coverCrop.heightPct}%`,
                    }}
                  />
                </div>
                <div className="obra-media-controls">
                  <label>Zoom
                    <input type="range" min="1" max="3" step="0.01" value={capaAjuste.zoom} disabled={!capaEditavel} onChange={(e) => setCapaAjuste((p) => ({ ...p, zoom: Number(e.target.value) }))} />
                  </label>
                  <label>Eixo X
                    <input type="range" min="-100" max="100" step="1" value={capaAjuste.x} disabled={!capaEditavel} onChange={(e) => setCapaAjuste((p) => ({ ...p, x: Number(e.target.value) }))} />
                  </label>
                  <label>Eixo Y
                    <input type="range" min="-100" max="100" step="1" value={capaAjuste.y} disabled={!capaEditavel} onChange={(e) => setCapaAjuste((p) => ({ ...p, y: Number(e.target.value) }))} />
                  </label>
                </div>
                <details>
                  <summary>Usar URL externa (opcional)</summary>
                  <input
                    type="url"
                    value={form.capaUrl}
                    onChange={(e) => setForm((p) => ({ ...p, capaUrl: e.target.value }))}
                    placeholder="https://..."
                  />
                </details>
              </div>
              <div className="obra-media-card">
                <h3>Banner (16:9)</h3>
                <input type="file" accept="image/jpeg,image/jpg,image/png,image/webp" onChange={(e) => selecionarBanner(e.target.files?.[0])} />
                <div
                  ref={bannerEditorRef}
                  className={`obra-editor-mask obra-editor-mask--banner${bannerEditavel ? ' is-editable' : ''}`}
                  onMouseDown={(e) => iniciarArrasteMidia(e, 'banner')}
                  onTouchStart={(e) => iniciarArrasteMidia(e, 'banner')}
                  title={bannerEditavel ? 'Arraste para ajustar o enquadramento do banner' : 'Envie um banner para editar'}
                >
                  <img
                    src={bannerPreviewUrl || form.bannerUrl || '/assets/fotos/shito.jpg'}
                    alt="Editor do banner"
                    className="obra-editor-img"
                    style={bannerEditavel ? bannerEditorImageStyle : undefined}
                  />
                  <div className="obra-editor-outside-mask" aria-hidden="true">
                    <i style={{ left: 0, top: 0, width: '100%', height: `${bannerCrop.topPct}%` }} />
                    <i style={{ left: 0, top: `${bannerCrop.topPct + bannerCrop.heightPct}%`, width: '100%', height: `${bannerCrop.topPct}%` }} />
                    <i style={{ left: 0, top: `${bannerCrop.topPct}%`, width: `${bannerCrop.leftPct}%`, height: `${bannerCrop.heightPct}%` }} />
                    <i style={{ left: `${bannerCrop.leftPct + bannerCrop.widthPct}%`, top: `${bannerCrop.topPct}%`, width: `${bannerCrop.leftPct}%`, height: `${bannerCrop.heightPct}%` }} />
                  </div>
                  <div
                    className="obra-editor-crop-box"
                    style={{
                      left: `${bannerCrop.leftPct}%`,
                      top: `${bannerCrop.topPct}%`,
                      width: `${bannerCrop.widthPct}%`,
                      height: `${bannerCrop.heightPct}%`,
                    }}
                  />
                </div>
                <div className="obra-media-controls">
                  <label>Zoom
                    <input type="range" min="1" max="3" step="0.01" value={bannerAjuste.zoom} disabled={!bannerEditavel} onChange={(e) => setBannerAjuste((p) => ({ ...p, zoom: Number(e.target.value) }))} />
                  </label>
                  <label>Eixo X
                    <input type="range" min="-100" max="100" step="1" value={bannerAjuste.x} disabled={!bannerEditavel} onChange={(e) => setBannerAjuste((p) => ({ ...p, x: Number(e.target.value) }))} />
                  </label>
                  <label>Eixo Y
                    <input type="range" min="-100" max="100" step="1" value={bannerAjuste.y} disabled={!bannerEditavel} onChange={(e) => setBannerAjuste((p) => ({ ...p, y: Number(e.target.value) }))} />
                  </label>
                </div>
                <details>
                  <summary>Usar URL externa (opcional)</summary>
                  <input
                    type="url"
                    value={form.bannerUrl}
                    onChange={(e) => setForm((p) => ({ ...p, bannerUrl: e.target.value }))}
                    placeholder="https://..."
                  />
                </details>
              </div>
              <aside className="obra-preview obra-preview--in-media">
                <header className="obra-block-head">
                  <h2>Preview em tempo real</h2>
                  <p>Simulação de exibição da obra no site.</p>
                </header>
                <div
                  className="obra-preview-banner"
                  style={{ backgroundImage: `linear-gradient(180deg, rgba(8,12,20,0.2), rgba(8,12,20,0.9)), url('${preview.bannerUrl}')` }}
                >
                  <span className={`preview-pill ${preview.isPublished ? 'on' : 'off'}`}>
                    {preview.isPublished ? 'Publicado' : 'Oculto'}
                  </span>
                </div>
                <div className="obra-preview-card">
                  <img src={preview.capaUrl} alt={preview.titulo} />
                  <div>
                    <strong>{preview.tituloCurto}</strong>
                    <p>{preview.sinopse}</p>
                    <span className="preview-meta">
                      {STATUS_OPTIONS.find((s) => s.id === preview.status)?.label || 'Em lançamento'}
                    </span>
                  </div>
                </div>
              </aside>
            </div>
          </section>

          <section className="obra-block">
            <header className="obra-block-head">
              <h2>SEO</h2>
              <p>Preencha como se estivesse explicando sua obra para quem nunca te viu.</p>
            </header>
            <div className="obra-grid">
              <label>
                Título que aparece no Google
                <input
                  type="text"
                  value={form.seoTitle}
                  onChange={(e) => setForm((p) => ({ ...p, seoTitle: e.target.value }))}
                  placeholder="Ex: Shito - Mangá brasileiro de fantasia sombria"
                />
              </label>
              <label>
                Palavras-chave (separadas por vírgula)
                <input
                  type="text"
                  value={form.seoKeywords}
                  onChange={(e) => setForm((p) => ({ ...p, seoKeywords: e.target.value }))}
                  placeholder="mangá brasileiro, fantasia, ação, shito"
                />
              </label>
            </div>
            <label>
              Resumo curto para Google (ideal: 140-160 caracteres)
              <textarea
                value={form.seoDescription}
                onChange={(e) => setForm((p) => ({ ...p, seoDescription: e.target.value }))}
                rows={3}
                placeholder="Ex: Acompanhe Shito, uma saga autoral com capítulos semanais, personagens marcantes e acesso antecipado para membros."
              />
            </label>
            <p className="seo-help">
              Dica rápida: use palavras simples, diga o gênero da obra e o que torna ela única.
            </p>
          </section>

          <section className="obra-block">
            <header className="obra-block-head">
              <h2>Status e visibilidade</h2>
              <p>Controle estágio editorial e publicação para o catálogo.</p>
            </header>
            <div className="obra-grid">
              <label>
                Status da obra
                <select
                  value={form.status}
                  onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))}
                >
                  {STATUS_OPTIONS.map((op) => (
                    <option key={op.id} value={op.id}>{op.label}</option>
                  ))}
                </select>
              </label>
              <label className="check-line">
                <input
                  type="checkbox"
                  checked={Boolean(form.isPublished)}
                  onChange={(e) => setForm((p) => ({ ...p, isPublished: e.target.checked }))}
                />
                Publicada (visível para usuários)
              </label>
            </div>
          </section>

          <div className="obra-form-actions">
            <button type="button" className="btn-pri" disabled={saving} onClick={salvarObra}>
              {saving ? 'Salvando...' : editandoId ? 'Salvar alterações' : 'Criar obra'}
            </button>
            <button type="button" className="btn-sec" onClick={iniciarNovo}>Limpar</button>
            {editandoId && editandoId !== OBRA_PADRAO_ID ? (
              <button
                type="button"
                className="btn-inline danger"
                onClick={() => apagarObra({ id: editandoId, titulo: form.titulo || editandoId })}
              >
                Apagar obra
              </button>
            ) : null}
          </div>
        </div>
      </section>

      <section className="obras-admin-list">
        <header className="obra-block-head">
          <h2>Obras cadastradas</h2>
          <p>Edite, alterne visibilidade e acompanhe atualização por obra.</p>
        </header>
        <div className="obra-list-grid">
          {obras.map((obra) => (
            <article key={obra.id} className="obra-list-item">
              <img src={obra.capaUrl || '/assets/fotos/shito.jpg'} alt={obra.titulo || obra.id} />
              <div className="obra-list-body">
                <strong>{obra.titulo || obra.id}</strong>
                <span>{obra.slug || obra.id}</span>
                <span>
                  {STATUS_OPTIONS.find((s) => s.id === obra.status)?.label || 'Em lançamento'} ·{' '}
                  {obra.isPublished ? 'Publicado' : 'Oculto'}
                </span>
                <span>Atualizado em {formatarDataHoraBr(obra.updatedAt, { seVazio: 'Sem data' })}</span>
              </div>
              <div className="obra-list-actions">
                <button type="button" className="btn-inline" onClick={() => editarObra(obra.id)}>Editar</button>
                <button type="button" className="btn-inline" onClick={() => togglePublish(obra)}>
                  {obra.isPublished ? 'Despublicar' : 'Publicar'}
                </button>
                <button type="button" className="btn-inline danger" onClick={() => apagarObra(obra)}>
                  Apagar
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
      <div
        className={`obra-save-feedback ${saveFeedback.visible ? 'show' : ''} ${saveFeedback.type}`}
        role={saveFeedback.type === 'erro' ? 'alert' : 'status'}
        aria-live="polite"
      >
        <strong>{saveFeedback.type === 'erro' ? 'Falha ao salvar' : 'Publicação concluída'}</strong>
        <span>{saveFeedback.text}</span>
      </div>
    </main>
  );
}

