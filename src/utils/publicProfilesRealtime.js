import { onValue, ref } from 'firebase/database';

import { buildPublicProfileFromUsuarioRow } from './publicUserProfile';

function normalizeUid(raw) {
  return String(raw || '').trim();
}

export function collectCreatorIdsFromWorksAndChapters(works = [], chapters = []) {
  const ids = new Set();
  const pushId = (value) => {
    const uid = normalizeUid(value);
    if (uid) ids.add(uid);
  };

  (Array.isArray(works) ? works : []).forEach((work) => {
    pushId(work?.creatorId);
    pushId(work?.creatorProfile?.creatorId);
    pushId(work?.creatorProfile?.userId);
    pushId(work?.uid);
    pushId(work?.userId);
  });

  (Array.isArray(chapters) ? chapters : []).forEach((chapter) => {
    pushId(chapter?.creatorId);
    pushId(chapter?.creatorProfile?.creatorId);
    pushId(chapter?.creatorProfile?.userId);
    pushId(chapter?.uid);
    pushId(chapter?.userId);
  });

  return [...ids];
}

export function subscribePublicProfilesMap(db, creatorIds, onChange) {
  const ids = [...new Set((Array.isArray(creatorIds) ? creatorIds : []).map(normalizeUid).filter(Boolean))];
  const state = {};

  const emit = () => {
    onChange({ ...state });
  };

  emit();

  const unsubs = ids.map((uid) =>
    onValue(
      ref(db, `usuarios/${uid}/publicProfile`),
      (snapshot) => {
        if (snapshot.exists()) {
          state[uid] = buildPublicProfileFromUsuarioRow(snapshot.val() || {}, uid);
        } else {
          delete state[uid];
        }
        emit();
      },
      () => {
        delete state[uid];
        emit();
      }
    )
  );

  return () => {
    unsubs.forEach((unsub) => {
      try {
        unsub();
      } catch {
        /* noop */
      }
    });
  };
}
