const LOCKS_KEY = '__shitoBodyScrollLocks';
const SNAPSHOT_KEY = '__shitoBodyScrollSnapshot';

function getBody() {
  if (typeof document === 'undefined') return null;
  return document.body || null;
}

function getLocks(body) {
  if (!body[LOCKS_KEY]) body[LOCKS_KEY] = new Set();
  return body[LOCKS_KEY];
}

function getSnapshot(body) {
  if (!body[SNAPSHOT_KEY]) {
    body[SNAPSHOT_KEY] = {
      overflow: body.style.overflow || '',
      touchAction: body.style.touchAction || '',
    };
  }
  return body[SNAPSHOT_KEY];
}

export function lockBodyScroll(lockId = 'default', { className = '' } = {}) {
  const body = getBody();
  if (!body) return;

  const locks = getLocks(body);
  if (!locks.size) getSnapshot(body);
  locks.add(String(lockId || 'default'));

  body.style.overflow = 'hidden';
  body.style.touchAction = 'none';
  if (className) body.classList.add(className);
}

export function unlockBodyScroll(lockId = 'default', { className = '' } = {}) {
  const body = getBody();
  if (!body) return;

  const locks = getLocks(body);
  locks.delete(String(lockId || 'default'));
  if (className) body.classList.remove(className);
  if (locks.size) return;

  const snapshot = getSnapshot(body);
  body.style.overflow = snapshot.overflow;
  body.style.touchAction = snapshot.touchAction;
  delete body[SNAPSHOT_KEY];
  delete body[LOCKS_KEY];
}
