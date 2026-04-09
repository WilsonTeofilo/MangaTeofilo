import React, { useEffect, useMemo, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { useLocation, useNavigate } from 'react-router-dom';

import KokuinLegacyLandingSection from '../../components/KokuinLegacyLandingSection.jsx';
import { db } from '../../services/firebase';
import { isInstitutionalFeaturedWork } from '../../config/institutionalFeaturedWork';
import { obraSegmentoUrlPublica } from '../../config/obras';
import { toRecordList } from '../../utils/firebaseRecordList';
import { obraVisivelNoCatalogoPublico } from '../../utils/obraCatalogo';
import './KokuinLegacyPage.css';

function resolveReadPath(works) {
  const publishedWorks = Array.isArray(works) ? works.filter((obra) => obraVisivelNoCatalogoPublico(obra)) : [];
  const featuredLive = publishedWorks.find((obra) => isInstitutionalFeaturedWork(obra));
  if (!featuredLive) return '';
  return `/work/${encodeURIComponent(obraSegmentoUrlPublica(featuredLive))}`;
}

export default function KokuinLegacyPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [works, setWorks] = useState([]);

  useEffect(() => {
    const unsub = onValue(ref(db, 'obras'), (snapshot) => {
      const list = snapshot.exists() ? toRecordList(snapshot.val()) : [];
      setWorks(list);
    });
    return () => unsub();
  }, []);

  const readPath = useMemo(() => resolveReadPath(works), [works]);
  const backPath = useMemo(() => {
    const fromState = String(location.state?.from || '').trim();
    return fromState || '/sobre-autor';
  }, [location.state]);

  return (
    <div className="kokuin-legacy-page">
      <button
        type="button"
        className="kokuin-legacy-page__back"
        onClick={() => navigate(backPath)}
      >
        VOLTAR
      </button>
      <KokuinLegacyLandingSection fullViewport readPath={readPath} />
    </div>
  );
}
