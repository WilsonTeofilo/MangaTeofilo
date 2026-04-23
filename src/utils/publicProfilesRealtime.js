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
  const privateRows = {};
  const publicRows = {};

  const emit = () => {
    onChange({ ...state });
  };

  emit();

  const rehydrateUid = (uid) => {
    const privateRow = privateRows[uid];
    const publicRow = publicRows[uid];
    if (privateRow && typeof privateRow === 'object') {
      state[uid] = buildPublicProfileFromUsuarioRow(
        {
          ...publicRow,
          ...privateRow,
        },
        uid
      );
      emit();
      return;
    }
    if (publicRow && typeof publicRow === 'object') {
      state[uid] = buildPublicProfileFromUsuarioRow(publicRow, uid);
      emit();
      return;
    }
    delete state[uid];
    emit();
  };

  const unsubs = ids.flatMap((uid) => ([
    onValue(
      ref(db, `usuarios/${uid}/publicProfile`),
      (snapshot) => {
        if (snapshot.exists()) {
          privateRows[uid] = snapshot.val() || {};
        } else {
          delete privateRows[uid];
        }
        rehydrateUid(uid);
      },
      () => {
        delete privateRows[uid];
        rehydrateUid(uid);
      }
    ),
    onValue(
      ref(db, `usuarios_publicos/${uid}`),
      (snapshot) => {
        if (snapshot.exists()) {
          publicRows[uid] = snapshot.val() || {};
        } else {
          delete publicRows[uid];
        }
        rehydrateUid(uid);
      },
      () => {
        delete publicRows[uid];
        rehydrateUid(uid);
      }
    ),
  ]));

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
