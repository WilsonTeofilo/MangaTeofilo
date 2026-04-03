import {
  buildResponsiveCropStyle,
  drawResponsiveCropToCanvas,
  getResponsiveCropZoomBounds,
  normalizeResponsiveCropAdjustment,
} from './responsiveCrop';

const IMAGE_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/pjpeg',
  'image/x-png',
];

export const CREATOR_PROFILE_IMAGE_MAX_INPUT_BYTES = Math.floor(1.5 * 1024 * 1024);
/** Saida WebP: tenta ficar nesta faixa (qualidade sobe se ficar pequeno demais). */
export const CREATOR_PROFILE_IMAGE_OUTPUT_MIN_BYTES = 250 * 1024;
export const CREATOR_PROFILE_IMAGE_OUTPUT_MAX_BYTES = 400 * 1024;
export const CREATOR_PROFILE_EDITOR_CONFIG = {
  outputW: 900,
  outputH: 1200,
};
export const CREATOR_HERO_EDITOR_CONFIG = {
  outputW: 1600,
  outputH: 900,
};

function extensionLooksLikeRasterImage(name) {
  return /\.(jpe?g|png|webp)$/i.test(String(name || ''));
}

export function validateCreatorProfileImageFile(file) {
  if (!file) return 'Selecione uma imagem para o perfil.';
  const size = Number(file.size);
  if (!Number.isFinite(size) || size <= 0) {
    return 'Nao foi possivel ler o arquivo. Tente outra foto ou outro navegador.';
  }
  if (size > CREATOR_PROFILE_IMAGE_MAX_INPUT_BYTES) {
    return 'A foto precisa ter no maximo 1,5 MB.';
  }
  const type = String(file.type || '').trim().toLowerCase();
  const typeOk = IMAGE_TYPES.includes(type);
  const emptyMimeOk = !type && extensionLooksLikeRasterImage(file.name);
  if (!typeOk && !emptyMimeOk) return 'Use JPG, PNG ou WebP.';
  return '';
}

export function getCreatorProfileZoomBounds(dimensions) {
  return getResponsiveCropZoomBounds(
    dimensions,
    CREATOR_PROFILE_EDITOR_CONFIG.outputW,
    CREATOR_PROFILE_EDITOR_CONFIG.outputH
  );
}

export function normalizeCreatorProfileAdjustment(raw, dimensions = null) {
  const bounds = getCreatorProfileZoomBounds(dimensions);
  const normalized = normalizeResponsiveCropAdjustment(raw, { maxZoom: bounds.maxZoom });
  return {
    ...normalized,
    zoom: Math.max(bounds.coverZoom, Number(normalized.zoom || bounds.coverZoom)),
  };
}

export function buildCreatorProfileEditorStyle(dimensions, adjustment) {
  const next = normalizeCreatorProfileAdjustment(adjustment, dimensions);
  return buildResponsiveCropStyle(
    dimensions,
    next,
    CREATOR_PROFILE_EDITOR_CONFIG.outputW,
    CREATOR_PROFILE_EDITOR_CONFIG.outputH,
    { maxZoomCap: getCreatorProfileZoomBounds(dimensions).maxZoom }
  );
}

export function serializeCreatorProfileCrop(adjustment, dimensions = null) {
  const next = normalizeCreatorProfileAdjustment(adjustment, dimensions);
  return {
    zoom: Number(next.zoom.toFixed(3)),
    x: Math.round(next.x),
    y: Math.round(next.y),
    mode: 'responsive-fit',
  };
}

export function loadCreatorProfileImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Nao foi possivel ler a imagem.'));
    };
    img.src = url;
  });
}

/**
 * Carrega imagem remota (ex.: URL HTTPS do Storage) para uso em canvas (crop / preview).
 * Tenta fetch+CORS primeiro; fallback em Image com crossOrigin.
 */
export async function loadCreatorProfileImageFromUrl(url) {
  const u = String(url || '').trim();
  if (!u) throw new Error('URL vazia.');
  try {
    const res = await fetch(u, { mode: 'cors', credentials: 'omit', cache: 'force-cache' });
    if (!res.ok) throw new Error('fetch');
    const blob = await res.blob();
    if (!blob?.size) throw new Error('empty');
    const obj = URL.createObjectURL(blob);
    try {
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error('decode'));
        i.src = obj;
      });
      return img;
    } finally {
      URL.revokeObjectURL(obj);
    }
  } catch {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Nao foi possivel carregar a imagem do perfil.'));
      img.src = u;
    });
  }
}

async function encodeWebpToOutputBand(canvas, startQuality = 0.88) {
  const minB = CREATOR_PROFILE_IMAGE_OUTPUT_MIN_BYTES;
  const maxB = CREATOR_PROFILE_IMAGE_OUTPUT_MAX_BYTES;
  let quality = startQuality;
  let blob = await canvasToWebpBlob(canvas, quality);
  while (blob.size > maxB && quality > 0.42) {
    quality -= 0.05;
    blob = await canvasToWebpBlob(canvas, quality);
  }
  if (blob.size < minB && quality < 0.93) {
    let q = quality;
    while (blob.size < minB && q < 0.95) {
      q = Math.min(0.95, q + 0.04);
      const next = await canvasToWebpBlob(canvas, q);
      if (next.size > maxB) break;
      blob = next;
      quality = q;
    }
  }
  return blob;
}

function canvasToWebpBlob(canvas, quality = 0.88) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error('Nao foi possivel gerar o WebP.'));
        else resolve(blob);
      },
      'image/webp',
      quality
    );
  });
}

function drawProfileCropToCanvas(ctx, img, width, height, adjustment) {
  drawResponsiveCropToCanvas(ctx, img, width, height, adjustment, {
    backgroundColor: '#080d11',
    backgroundAlpha: 0.2,
    backgroundFill: 'none',
    maxZoomCap: getCreatorProfileZoomBounds({
      w: Number(img?.naturalWidth || img?.width || 0),
      h: Number(img?.naturalHeight || img?.height || 0),
    }).maxZoom,
  });
}

function drawHeroPreviewToCanvas(ctx, img, width, height, adjustment) {
  drawResponsiveCropToCanvas(ctx, img, width, height, adjustment, {
    backgroundColor: '#06080c',
    backgroundAlpha: 0.55,
    maxZoomCap: getResponsiveCropZoomBounds(
      { w: Number(img?.naturalWidth || img?.width || 0), h: Number(img?.naturalHeight || img?.height || 0) },
      width,
      height
    ).maxZoom,
  });
}

export async function processCreatorProfileImageToWebp(file, adjustment = null) {
  const err = validateCreatorProfileImageFile(file);
  if (err) throw new Error(err);
  const img = await loadCreatorProfileImageFromFile(file);
  const dimensions = {
    w: Number(img.naturalWidth || img.width || 0),
    h: Number(img.naturalHeight || img.height || 0),
  };
  if (!dimensions.w || !dimensions.h) throw new Error('Imagem invalida.');

  const canvas = document.createElement('canvas');
  canvas.width = CREATOR_PROFILE_EDITOR_CONFIG.outputW;
  canvas.height = CREATOR_PROFILE_EDITOR_CONFIG.outputH;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas indisponivel.');

  drawProfileCropToCanvas(
    ctx,
    img,
    canvas.width,
    canvas.height,
    normalizeCreatorProfileAdjustment(adjustment, dimensions)
  );

  let blob = await encodeWebpToOutputBand(canvas, 0.9);

  if (blob.size > CREATOR_PROFILE_IMAGE_OUTPUT_MAX_BYTES) {
    const smallerCanvas = document.createElement('canvas');
    smallerCanvas.width = 720;
    smallerCanvas.height = 960;
    const smallerCtx = smallerCanvas.getContext('2d', { alpha: false });
    if (!smallerCtx) throw new Error('Canvas indisponivel.');
    smallerCtx.drawImage(canvas, 0, 0, smallerCanvas.width, smallerCanvas.height);
    blob = await encodeWebpToOutputBand(smallerCanvas, 0.84);
  }

  if (blob.size > CREATOR_PROFILE_IMAGE_OUTPUT_MAX_BYTES) {
    const tinyCanvas = document.createElement('canvas');
    tinyCanvas.width = 600;
    tinyCanvas.height = 800;
    const tinyCtx = tinyCanvas.getContext('2d', { alpha: false });
    if (!tinyCtx) throw new Error('Canvas indisponivel.');
    tinyCtx.drawImage(canvas, 0, 0, tinyCanvas.width, tinyCanvas.height);
    blob = await encodeWebpToOutputBand(tinyCanvas, 0.8);
  }

  return blob;
}

export function renderCreatorProfilePreviewDataUrl(img, adjustment, maxHeight = 320) {
  const aspectRatio = CREATOR_PROFILE_EDITOR_CONFIG.outputW / CREATOR_PROFILE_EDITOR_CONFIG.outputH;
  const height = Math.min(maxHeight, CREATOR_PROFILE_EDITOR_CONFIG.outputH);
  const width = Math.round(height * aspectRatio);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return '';
  drawProfileCropToCanvas(
    ctx,
    img,
    width,
    height,
    normalizeCreatorProfileAdjustment(adjustment, {
      w: Number(img?.naturalWidth || img?.width || 0),
      h: Number(img?.naturalHeight || img?.height || 0),
    })
  );
  return canvas.toDataURL('image/webp', 0.84);
}

export function renderCreatorHeroPreviewDataUrl(img, adjustment, maxWidth = 560) {
  const aspectRatio = CREATOR_HERO_EDITOR_CONFIG.outputW / CREATOR_HERO_EDITOR_CONFIG.outputH;
  const width = Math.min(maxWidth, CREATOR_HERO_EDITOR_CONFIG.outputW);
  const height = Math.round(width / aspectRatio);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return '';
  drawHeroPreviewToCanvas(
    ctx,
    img,
    width,
    height,
    normalizeCreatorProfileAdjustment(adjustment, {
      w: Number(img?.naturalWidth || img?.width || 0),
      h: Number(img?.naturalHeight || img?.height || 0),
    })
  );
  return canvas.toDataURL('image/webp', 0.82);
}
