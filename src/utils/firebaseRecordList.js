export function toRecordList(value) {
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).map(([id, row]) => ({ id, ...(row || {}) }));
}
