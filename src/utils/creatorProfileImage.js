import {
  buildResponsiveCropStyle,
  drawResponsiveCropToCanvas,
  getResponsiveCropZoomBounds,
  normalizeResponsiveCropAdjustment,
} from './responsiveCrop';

const IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

export const CREATOR_PROFILE_IMAGE_MAX_INPUT_BYTES = Math.floor(1.2 * 1024 * 1024);
export const CREATOR_PROFILE_IMAGE_TARGET_OUTPUT_BYTES = 300 * 1024;
export const CREATOR_PROFILE_EDITOR_CONFIG = {
  outputW: 900,
  outputH: 1200,
};
export const CREATOR_HERO_EDITOR_CONFIG = {
  outputW: 1600,
  outputH: 900,
};

export function validateCreatorProfileImageFile(file) {
  if (!file) return 'Selecione uma imagem para o perfil.';
  if (!IMAGE_TYPES.includes(file.type)) return 'Use JPG, PNG ou WEBP.';
  if (file.size > CREATOR_PROFILE_IMAGE_MAX_INPUT_BYTES) {
    return 'A foto precisa ter no maximo 1,2MB.';
  }
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

  let quality = 0.9;
  let blob = await canvasToWebpBlob(canvas, quality);
  while (blob.size > CREATOR_PROFILE_IMAGE_TARGET_OUTPUT_BYTES && quality > 0.42) {
    quality -= 0.06;
    blob = await canvasToWebpBlob(canvas, quality);
  }

  if (blob.size > CREATOR_PROFILE_IMAGE_TARGET_OUTPUT_BYTES) {
    const smallerCanvas = document.createElement('canvas');
    smallerCanvas.width = 720;
    smallerCanvas.height = 960;
    const smallerCtx = smallerCanvas.getContext('2d', { alpha: false });
    if (!smallerCtx) throw new Error('Canvas indisponivel.');
    smallerCtx.drawImage(canvas, 0, 0, smallerCanvas.width, smallerCanvas.height);
    quality = 0.84;
    blob = await canvasToWebpBlob(smallerCanvas, quality);
    while (blob.size > CREATOR_PROFILE_IMAGE_TARGET_OUTPUT_BYTES && quality > 0.4) {
      quality -= 0.06;
      blob = await canvasToWebpBlob(smallerCanvas, quality);
    }
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
