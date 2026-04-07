async function buildReaderLikedWorkPayload(db, workIdRaw) {
  const workId = String(workIdRaw || '').trim();
  if (!workId) return null;

  const obraSnap = await db.ref(`obras/${workId}`).get();
  const obra = obraSnap.exists() ? obraSnap.val() || {} : {};

  return {
    workId,
    title: String(obra?.titulo || obra?.title || workId).trim().slice(0, 120) || workId,
    coverUrl: String(obra?.capaUrl || obra?.bannerUrl || '').trim().slice(0, 2048),
    slug: String(obra?.slug || '').trim().slice(0, 80),
    likedAt: Date.now(),
  };
}

export async function syncReaderLikedWorkStateForUser(db, uidRaw, workIdRaw) {
  const uid = String(uidRaw || '').trim();
  const workId = String(workIdRaw || '').trim();
  if (!uid || !workId) return;

  const capsSnap = await db.ref('capitulos').get();
  const caps = capsSnap.exists() ? capsSnap.val() || {} : {};
  let stillLiked = false;

  for (const cap of Object.values(caps)) {
    if (!cap || typeof cap !== 'object') continue;
    const capWorkId = String(cap.obraId || cap.mangaId || '').trim();
    if (capWorkId !== workId) continue;
    if (cap.usuariosQueCurtiram && cap.usuariosQueCurtiram[uid]) {
      stillLiked = true;
      break;
    }
  }

  if (!stillLiked) {
    await db.ref(`usuarios/${uid}/likedWorks/${workId}`).remove().catch(() => {});
    return;
  }

  const payload = await buildReaderLikedWorkPayload(db, workId);
  if (!payload) return;

  await db.ref(`usuarios/${uid}/likedWorks/${workId}`).set(payload);
}
