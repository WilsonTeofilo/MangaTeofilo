import { useEffect, useMemo, useState } from 'react';
import { equalTo, onValue, orderByChild, query, ref } from 'firebase/database';

function obraIdsSortedKey(obrasVal) {
  if (!obrasVal || typeof obrasVal !== 'object') return '';
  return Object.keys(obrasVal)
    .slice()
    .sort()
    .join('\0');
}

/**
 * Obras, capítulos e produtos da loja só do criador (queries indexadas), sem subscrever árvores inteiras.
 * Com `uid` vazio devolve `null` nos três (compatível com fallback em `PrintOnDemandPage`).
 */
export function useCreatorScopedCatalog(db, uidRaw) {
  const uid = String(uidRaw || '').trim();
  const [obrasVal, setObrasVal] = useState(null);
  const [capsByCreatorId, setCapsByCreatorId] = useState({});
  const [capsByObra, setCapsByObra] = useState({});
  const [produtosVal, setProdutosVal] = useState(null);

  useEffect(() => {
    if (!uid) return () => {};
    const obrasQ = query(ref(db, 'obras'), orderByChild('creatorId'), equalTo(uid));
    const capsQ = query(ref(db, 'capitulos'), orderByChild('creatorId'), equalTo(uid));
    const prodQ = query(ref(db, 'loja/produtos'), orderByChild('creatorId'), equalTo(uid));
    const uo = onValue(obrasQ, (snap) => setObrasVal(snap.exists() ? snap.val() || {} : {}));
    const uc = onValue(capsQ, (snap) => setCapsByCreatorId(snap.exists() ? snap.val() || {} : {}));
    const up = onValue(prodQ, (snap) => setProdutosVal(snap.exists() ? snap.val() || {} : {}));
    return () => {
      uo();
      uc();
      up();
    };
  }, [db, uid]);

  const obraIdsKey = useMemo(() => obraIdsSortedKey(obrasVal && typeof obrasVal === 'object' ? obrasVal : {}), [obrasVal]);

  useEffect(() => {
    if (!uid || !obraIdsKey) return () => {};
    const obraIds = obraIdsKey.split('\0');
    const chunks = Object.create(null);
    const flush = () => {
      const out = {};
      for (const oid of obraIds) {
        const c = chunks[oid];
        if (c && typeof c === 'object') Object.assign(out, c);
      }
      setCapsByObra(out);
    };
    const unsubs = obraIds.map((oid) =>
      onValue(query(ref(db, 'capitulos'), orderByChild('obraId'), equalTo(oid)), (snap) => {
        chunks[oid] = snap.exists() ? snap.val() || {} : {};
        flush();
      })
    );
    return () => {
      unsubs.forEach((u) => u());
    };
  }, [db, uid, obraIdsKey]);

  const capsVal = useMemo(() => {
    if (!uid) return null;
    return { ...capsByObra, ...capsByCreatorId };
  }, [uid, capsByObra, capsByCreatorId]);

  return { obrasVal: uid ? obrasVal : null, capsVal, produtosVal: uid ? produtosVal : null };
}
