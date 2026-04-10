/**
 * Progresso de leitura só no cliente (localStorage).
 * Chaves versionadas para não colidir com outros dados.
 */

export const READ_LAST_KEY = 'mtf_read_last_v1';
export const READ_HISTORY_KEY = 'mtf_read_history_v1';
export const MAX_HISTORY_ENTRIES = 24;

/** @typedef {{ workId: string, chapterId: string, chapterNumber: number, page: number, obraTitulo?: string, chapterTitle?: string, capaUrl?: string, ts: number }} ReadingEntry */

function safeParse(json, fallback) {
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

/**
 * @returns {ReadingEntry | null}
 */
export function getLastRead() {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(READ_LAST_KEY);
    if (!raw) return null;
    const o = safeParse(raw, null);
    if (!o || typeof o !== 'object') return null;
    if (!o.workId || !o.chapterId) return null;
    return {
      workId: String(o.workId).toLowerCase(),
      chapterId: String(o.chapterId),
      chapterNumber: Number(o.chapterNumber) || 0,
      page: Math.max(1, Number(o.page) || 1),
      obraTitulo: o.obraTitulo ? String(o.obraTitulo) : '',
      chapterTitle: o.chapterTitle ? String(o.chapterTitle) : '',
      capaUrl: o.capaUrl ? String(o.capaUrl) : '',
      ts: Number(o.ts) || 0,
    };
  } catch {
    return null;
  }
}

/**
 * @returns {ReadingEntry[]}
 */
export function getReadHistory() {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(READ_HISTORY_KEY);
    if (!raw) return [];
    const arr = safeParse(raw, []);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((o) => o && o.workId && o.chapterId)
      .map((o) => ({
        workId: String(o.workId).toLowerCase(),
        chapterId: String(o.chapterId),
        chapterNumber: Number(o.chapterNumber) || 0,
        page: Math.max(1, Number(o.page) || 1),
        obraTitulo: o.obraTitulo ? String(o.obraTitulo) : '',
        chapterTitle: o.chapterTitle ? String(o.chapterTitle) : '',
        capaUrl: o.capaUrl ? String(o.capaUrl) : '',
        ts: Number(o.ts) || 0,
      }))
      .slice(0, MAX_HISTORY_ENTRIES);
  } catch {
    return [];
  }
}

/**
 * @param {Omit<ReadingEntry, 'ts'> & { ts?: number }} payload
 */
export function recordReadingProgress(payload) {
  if (typeof localStorage === 'undefined') return;
  const ts = payload.ts ?? Date.now();
  const entry = {
    workId: String(payload.workId || '').toLowerCase(),
    chapterId: String(payload.chapterId || ''),
    chapterNumber: Number(payload.chapterNumber) || 0,
    page: Math.max(1, Number(payload.page) || 1),
    obraTitulo: payload.obraTitulo ? String(payload.obraTitulo) : '',
    chapterTitle: payload.chapterTitle ? String(payload.chapterTitle) : '',
    capaUrl: payload.capaUrl ? String(payload.capaUrl) : '',
    ts,
  };
  if (!entry.workId || !entry.chapterId) return;
  try {
    localStorage.setItem(READ_LAST_KEY, JSON.stringify(entry));
    const hist = getReadHistory().filter((h) => h.chapterId !== entry.chapterId);
    hist.unshift(entry);
    localStorage.setItem(READ_HISTORY_KEY, JSON.stringify(hist.slice(0, MAX_HISTORY_ENTRIES)));
    window.dispatchEvent(new CustomEvent('mtf-reading-updated'));
  } catch {
    /* quota / private mode */
  }
}

function buildIdSet(value, normalizer = (v) => v) {
  if (!value) return null;
  if (value instanceof Set) return value;
  const set = new Set();
  for (const item of value) {
    const key = normalizer(item);
    if (key) set.add(key);
  }
  return set;
}

/**
 * Remove entradas orfas (obra/capitulo inexistente) do historico local.
 * @param {{ validWorkIds?: string[] | Set<string>, validChapterIds?: string[] | Set<string> }} payload
 */
export function pruneReadingHistory(payload = {}) {
  if (typeof localStorage === 'undefined') return { changed: false, removed: 0 };
  const workSet = buildIdSet(payload.validWorkIds, (v) => String(v || '').toLowerCase());
  const chapterSet = buildIdSet(payload.validChapterIds, (v) => String(v || '').trim());
  const hist = getReadHistory();
  if (!hist.length) return { changed: false, removed: 0 };
  const filtered = hist.filter((entry) => {
    const workOk = !workSet || workSet.has(String(entry.workId || '').toLowerCase());
    const chapterOk = !chapterSet || chapterSet.has(String(entry.chapterId || '').trim());
    return workOk && chapterOk;
  });
  let changed = filtered.length !== hist.length;
  if (changed) {
    localStorage.setItem(READ_HISTORY_KEY, JSON.stringify(filtered.slice(0, MAX_HISTORY_ENTRIES)));
  }

  const last = getLastRead();
  if (last) {
    const lastWorkOk = !workSet || workSet.has(String(last.workId || '').toLowerCase());
    const lastChapterOk = !chapterSet || chapterSet.has(String(last.chapterId || '').trim());
    if (!lastWorkOk || !lastChapterOk) {
      localStorage.removeItem(READ_LAST_KEY);
      changed = true;
    }
  }

  if (changed) {
    window.dispatchEvent(new CustomEvent('mtf-reading-updated'));
  }

  return { changed, removed: Math.max(0, hist.length - filtered.length) };
}

export function subscribeReadingProgress(cb) {
  if (typeof window === 'undefined') return () => {};
  const fn = () => cb();
  window.addEventListener('mtf-reading-updated', fn);
  return () => window.removeEventListener('mtf-reading-updated', fn);
}
