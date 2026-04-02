/**
 * Banner público do criador: proporção 16:9 (mesmo output que capa de obra / redes sociais largas).
 * Entrada até 1,5MB; saída WebP comprimida (~400KB alvo).
 */

import {
  buildResponsiveCropStyle,
  drawResponsiveCropToCanvas,
  getFullCropLayout,
  getResponsiveCropZoomBounds,
  normalizeResponsiveCropAdjustment,
} from './responsiveCrop';

const bannerLayout = getFullCropLayout();

export const CREATOR_BANNER_MAX_INPUT_BYTES = Math.floor(1.5 * 1024 * 1024);
export const CREATOR_BANNER_TARGET_OUTPUT_BYTES = 400 * 1024;
export const CREATOR_BANNER_EDITOR_CONFIG = {
  outputW: 1600,
  outputH: 900,
};

const IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

export function normalizarAjusteBanner(raw) {
  return normalizeResponsiveCropAdjustment(raw);
}

export function validarArquivoBannerInput(file) {
  if (!file) return 'Selecione uma imagem para o banner.';
  if (!IMAGE_TYPES.includes(file.type)) return 'Use JPG, PNG ou WEBP.';
  if (file.size > CREATOR_BANNER_MAX_INPUT_BYTES) {
    return 'Imagem até 1,5MB.';
  }
  return '';
}

function nomeArquivoWebp(name) {
  const base = String(name || 'banner')
    .replace(/\.[^/.]+$/, '')
    .replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${base || 'banner'}.webp`;
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
      reject(new Error('Não foi possível ler a imagem.'));
    };
    img.src = url;
  });
}

/**
 * Baixa imagem por URL (CORS) para uso em canvas — evita novo upload de arquivo no modal.
 */
export async function carregarImagemRemoteUrl(url) {
  const u = String(url || '').trim();
  if (!u) throw new Error('URL do banner vazia.');
  if (u.startsWith('blob:')) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
      img.src = u;
    });
  }
  const res = await fetch(u, { mode: 'cors', credentials: 'omit' });
  if (!res.ok) throw new Error('Não foi possível carregar o banner salvo. Tente enviar de novo.');
  const blob = await res.blob();
  if (!blob.type.startsWith('image/')) throw new Error('O link do banner não é uma imagem válida.');
  const file = new File([blob], 'banner-remote.webp', { type: blob.type || 'image/jpeg' });
  return carregarImagem(file);
}

function canvasParaBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error('Falha ao gerar imagem.'));
        else resolve(blob);
      },
      'image/webp',
      quality
    );
  });
}

async function blobWebpAbaixoDe(canvas, maxBytes) {
  let quality = 0.9;
  let best = null;
  for (let i = 0; i < 14; i += 1) {
    const blob = await canvasParaBlob(canvas, quality);
    best = blob;
    if (blob.size <= maxBytes) return blob;
    quality -= 0.055;
    if (quality < 0.42) break;
  }
  let w = canvas.width;
  let h = canvas.height;
  let q = 0.82;
  for (let pass = 0; pass < 6; pass += 1) {
    w = Math.max(960, Math.round(w * 0.9));
    h = Math.max(540, Math.round(h * 0.9));
    const small = document.createElement('canvas');
    small.width = w;
    small.height = h;
    const sctx = small.getContext('2d', { alpha: false });
    if (!sctx) throw new Error('Falha ao redimensionar banner.');
    sctx.drawImage(canvas, 0, 0, w, h);
    for (let j = 0; j < 10; j += 1) {
      const blob = await canvasParaBlob(small, q);
      if (blob.size <= maxBytes) return blob;
      q -= 0.06;
      if (q < 0.4) break;
    }
  }
  return best;
}

function desenharBanner(ctx, img, targetW, targetH, ajuste) {
  drawResponsiveCropToCanvas(ctx, img, targetW, targetH, ajuste, {
    backgroundColor: '#0b0b0b',
    backgroundAlpha: 0.35,
    maxZoomCap: getResponsiveCropZoomBounds({ w: img?.naturalWidth || img?.width, h: img?.naturalHeight || img?.height }, targetW, targetH).maxZoom,
  });
}

/**
 * @param {HTMLImageElement} img
 * @param {{ zoom?: number, x?: number, y?: number }} ajuste
 * @param {string} [nomeSaida]
 * @returns {Promise<File>}
 */
export async function exportCreatorBannerWebpFromImage(img, ajuste, nomeSaida = 'banner.webp') {
  const { outputW, outputH } = CREATOR_BANNER_EDITOR_CONFIG;
  const canvas = document.createElement('canvas');
  canvas.width = outputW;
  canvas.height = outputH;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Falha ao processar banner.');
  desenharBanner(ctx, img, outputW, outputH, normalizarAjusteBanner(ajuste));
  const blob = await blobWebpAbaixoDe(canvas, CREATOR_BANNER_TARGET_OUTPUT_BYTES);
  return new File([blob], nomeArquivoWebp(nomeSaida), {
    type: 'image/webp',
    lastModified: Date.now(),
  });
}

/**
 * Desenha pré-visualização rápida (mesma lógica do export, resolução menor).
 * @param {HTMLImageElement} img
 * @param {{ zoom?: number, x?: number, y?: number }} ajuste
 * @param {number} [maxW]
 * @returns {string} data URL (image/webp)
 */
export function renderCreatorBannerPreviewDataUrl(img, ajuste, maxW = 480) {
  const ar = CREATOR_BANNER_EDITOR_CONFIG.outputW / CREATOR_BANNER_EDITOR_CONFIG.outputH;
  const w = Math.min(maxW, CREATOR_BANNER_EDITOR_CONFIG.outputW);
  const h = Math.round(w / ar);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return '';
  desenharBanner(ctx, img, w, h, normalizarAjusteBanner(ajuste));
  return canvas.toDataURL('image/webp', 0.82);
}

/**
 * @param {File} file
 * @param {{ zoom?: number, x?: number, y?: number }} ajuste
 * @returns {Promise<File>}
 */
export async function processCreatorBannerToWebp(file, ajuste) {
  const err = validarArquivoBannerInput(file);
  if (err) throw new Error(err);
  const img = await carregarImagem(file);
  return exportCreatorBannerWebpFromImage(img, ajuste, file.name);
}

/**
 * Reprocessa banner já hospedado (sem novo input de arquivo).
 * @param {string} imageUrl
 * @param {{ zoom?: number, x?: number, y?: number }} ajuste
 * @returns {Promise<File>}
 */
export async function processCreatorBannerFromUrlToWebp(imageUrl, ajuste) {
  const img = await carregarImagemRemoteUrl(imageUrl);
  return exportCreatorBannerWebpFromImage(img, ajuste, 'banner.webp');
}

export function layoutBannerEditor() {
  return bannerLayout;
}

export function estiloPreviewBanner(dim, ajuste) {
  return buildResponsiveCropStyle(dim, ajuste, CREATOR_BANNER_EDITOR_CONFIG.outputW, CREATOR_BANNER_EDITOR_CONFIG.outputH);
}

export function zoomBoundsBanner(dimensoes) {
  return getResponsiveCropZoomBounds(
    dimensoes,
    CREATOR_BANNER_EDITOR_CONFIG.outputW,
    CREATOR_BANNER_EDITOR_CONFIG.outputH
  );
}
