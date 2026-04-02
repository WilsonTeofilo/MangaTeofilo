function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeResponsiveCropAdjustment(raw, options = {}) {
  const maxZoom = Number.isFinite(Number(options.maxZoom)) ? Number(options.maxZoom) : 6;
  return {
    zoom: clamp(Number(raw?.zoom ?? 1), 1, maxZoom),
    x: clamp(Number(raw?.x ?? 0), -100, 100),
    y: clamp(Number(raw?.y ?? 0), -100, 100),
    rendered: raw?.rendered === false ? false : true,
    mode: 'responsive-fit',
  };
}

export function getResponsiveCropZoomBounds(dim, frameW, frameH, options = {}) {
  const w = Number(dim?.w || dim?.width || 0);
  const h = Number(dim?.h || dim?.height || 0);
  const safeFrameW = Math.max(1, Number(frameW || 0));
  const safeFrameH = Math.max(1, Number(frameH || 0));
  const maxZoomCap = Number.isFinite(Number(options.maxZoomCap)) ? Number(options.maxZoomCap) : 6;
  if (!w || !h) {
    return { minZoom: 1, maxZoom: 3, coverZoom: 1 };
  }
  const fitScale = Math.min(safeFrameW / w, safeFrameH / h);
  const coverScale = Math.max(safeFrameW / w, safeFrameH / h);
  const coverZoom = fitScale > 0 ? coverScale / fitScale : 1;
  const maxZoom = clamp(Math.max(3, coverZoom * 1.75), 3, maxZoomCap);
  return {
    minZoom: 1,
    maxZoom: Number(maxZoom.toFixed(2)),
    coverZoom: Number(coverZoom.toFixed(2)),
  };
}

export function computeResponsiveCropGeometry(
  imgW,
  imgH,
  frameW,
  frameH,
  adjustment,
  options = {}
) {
  const safeImgW = Number(imgW || 0);
  const safeImgH = Number(imgH || 0);
  const safeFrameW = Math.max(1, Number(frameW || 0));
  const safeFrameH = Math.max(1, Number(frameH || 0));
  if (!safeImgW || !safeImgH) {
    return {
      drawW: safeFrameW,
      drawH: safeFrameH,
      drawX: 0,
      drawY: 0,
      limitX: 0,
      limitY: 0,
      offsetX: 0,
      offsetY: 0,
    };
  }

  const { maxZoom } = getResponsiveCropZoomBounds(
    { w: safeImgW, h: safeImgH },
    safeFrameW,
    safeFrameH,
    options
  );
  const ajuste = normalizeResponsiveCropAdjustment(adjustment, { maxZoom });
  const fitScale = Math.min(safeFrameW / safeImgW, safeFrameH / safeImgH);
  const scale = fitScale * ajuste.zoom;
  const drawW = safeImgW * scale;
  const drawH = safeImgH * scale;
  const limitX = Math.abs(drawW - safeFrameW) / 2;
  const limitY = Math.abs(drawH - safeFrameH) / 2;
  const offsetX = limitX > 0 ? (ajuste.x / 100) * limitX : 0;
  const offsetY = limitY > 0 ? (ajuste.y / 100) * limitY : 0;

  return {
    drawW,
    drawH,
    drawX: (safeFrameW - drawW) / 2 + offsetX,
    drawY: (safeFrameH - drawH) / 2 + offsetY,
    limitX,
    limitY,
    offsetX,
    offsetY,
  };
}

export function buildResponsiveCropStyle(dim, adjustment, frameW, frameH, options = {}) {
  const w = Number(dim?.w || dim?.width || 0);
  const h = Number(dim?.h || dim?.height || 0);
  if (!w || !h) return {};
  const geometry = computeResponsiveCropGeometry(w, h, frameW, frameH, adjustment, options);
  return {
    width: `${(geometry.drawW / frameW) * 100}%`,
    height: `${(geometry.drawH / frameH) * 100}%`,
    left: `${(geometry.drawX / frameW) * 100}%`,
    top: `${(geometry.drawY / frameH) * 100}%`,
  };
}

export function drawResponsiveCropToCanvas(
  ctx,
  img,
  targetW,
  targetH,
  adjustment,
  options = {}
) {
  const safeTargetW = Math.max(1, Number(targetW || 0));
  const safeTargetH = Math.max(1, Number(targetH || 0));
  const geometry = computeResponsiveCropGeometry(
    Number(img?.width || 0),
    Number(img?.height || 0),
    safeTargetW,
    safeTargetH,
    adjustment,
    options
  );

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = options.backgroundColor || '#0b0b0b';
  ctx.fillRect(0, 0, safeTargetW, safeTargetH);

  if (options.backgroundFill !== 'none') {
    const bgScale = Math.max(safeTargetW / img.width, safeTargetH / img.height);
    const bgW = img.width * bgScale;
    const bgH = img.height * bgScale;
    ctx.save();
    ctx.globalAlpha = Number.isFinite(Number(options.backgroundAlpha))
      ? Number(options.backgroundAlpha)
      : 0.4;
    ctx.drawImage(img, (safeTargetW - bgW) / 2, (safeTargetH - bgH) / 2, bgW, bgH);
    ctx.restore();
  }

  ctx.drawImage(img, geometry.drawX, geometry.drawY, geometry.drawW, geometry.drawH);
}

export function createResponsiveDragSnapshot(
  imgW,
  imgH,
  frameW,
  frameH,
  adjustment,
  options = {}
) {
  const geometry = computeResponsiveCropGeometry(imgW, imgH, frameW, frameH, adjustment, options);
  return {
    limitX: geometry.limitX,
    limitY: geometry.limitY,
    offsetX: geometry.offsetX,
    offsetY: geometry.offsetY,
  };
}

export function applyResponsiveDragDelta(adjustment, snapshot, deltaX, deltaY, options = {}) {
  const nextOffsetX = snapshot.limitX > 0
    ? clamp(snapshot.offsetX + deltaX, -snapshot.limitX, snapshot.limitX)
    : 0;
  const nextOffsetY = snapshot.limitY > 0
    ? clamp(snapshot.offsetY + deltaY, -snapshot.limitY, snapshot.limitY)
    : 0;
  const nextX = snapshot.limitX > 0 ? (nextOffsetX / snapshot.limitX) * 100 : 0;
  const nextY = snapshot.limitY > 0 ? (nextOffsetY / snapshot.limitY) * 100 : 0;
  return normalizeResponsiveCropAdjustment(
    { ...adjustment, x: nextX, y: nextY },
    options
  );
}

export function getFullCropLayout() {
  return {
    leftPct: 0,
    topPct: 0,
    widthPct: 100,
    heightPct: 100,
  };
}
