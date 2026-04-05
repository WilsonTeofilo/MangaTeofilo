import { deleteObject, listAll, ref as storageRef } from 'firebase/storage';

function normalizeStoragePath(raw) {
  return String(raw || '').trim().replace(/^\/+/, '');
}

export function extractStoragePathFromDownloadUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  const match = raw.match(/\/o\/([^?]+)/i);
  if (!match) return '';
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return '';
  }
}

export function resolveStoragePathFromPathOrUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) {
    return extractStoragePathFromDownloadUrl(raw);
  }
  return normalizeStoragePath(raw);
}

export async function safeDeleteStorageObject(storage, pathOrUrl) {
  const path = resolveStoragePathFromPathOrUrl(pathOrUrl);
  if (!path) return false;
  try {
    await deleteObject(storageRef(storage, path));
    return true;
  } catch (error) {
    const code = String(error?.code || '');
    if (code === 'storage/object-not-found') return false;
    throw error;
  }
}

export async function safeDeleteStorageObjects(storage, values = []) {
  const uniquePaths = [...new Set((Array.isArray(values) ? values : []).map(resolveStoragePathFromPathOrUrl).filter(Boolean))];
  const results = await Promise.allSettled(
    uniquePaths.map(async (path) => {
      await safeDeleteStorageObject(storage, path);
      return path;
    })
  );
  return {
    deletedPaths: results.filter((item) => item.status === 'fulfilled').map((item) => item.value),
    failed: results
      .filter((item) => item.status === 'rejected')
      .map((item) => ({ message: item.reason?.message || 'Falha ao deletar arquivo do Storage.' })),
  };
}

export async function safeDeleteStorageFolder(storage, folderPath) {
  const base = normalizeStoragePath(folderPath);
  if (!base) return { deletedPaths: [], failed: [] };
  const deletedPaths = [];
  const failed = [];

  async function walk(path) {
    let listed;
    try {
      listed = await listAll(storageRef(storage, path));
    } catch (error) {
      const code = String(error?.code || '');
      if (code === 'storage/object-not-found') return;
      failed.push({ message: error?.message || `Falha ao listar ${path}.` });
      return;
    }

    await Promise.all(
      listed.prefixes.map((prefixRef) => walk(prefixRef.fullPath))
    );

    const deletions = await Promise.allSettled(
      listed.items.map(async (itemRef) => {
        await deleteObject(itemRef);
        deletedPaths.push(itemRef.fullPath);
      })
    );

    deletions.forEach((item) => {
      if (item.status === 'rejected') {
        failed.push({ message: item.reason?.message || `Falha ao deletar item em ${path}.` });
      }
    });
  }

  await walk(base);
  return { deletedPaths, failed };
}
