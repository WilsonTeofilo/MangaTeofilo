import React, { useEffect, useMemo, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { useNavigate } from 'react-router-dom';

import { db } from '../../services/firebase';
import {
  OBRA_PADRAO_ID,
  OBRA_SHITO_DEFAULT,
  ensureLegacyShitoObra,
  obterObraIdCapitulo,
} from '../../config/obras';
import { capituloLiberadoParaUsuario } from '../../utils/capituloLancamento';
import { formatarDataBrPartirIsoOuMs } from '../../utils/datasBr';
import { mergeWorkFavoriteMaps, removeWorkFavoriteBoth } from '../../utils/workFavorites';
import './BibliotecaFavoritos.css';

function pathObraPublica(obra, obraIdFallback) {
  const o = obra && typeof obra === 'object' ? obra : null;
  const id = String(o?.id || obraIdFallback || '').toLowerCase();
  const slug = String(o?.slug || '').trim();
  const key = slug || id;
  return `/work/${encodeURIComponent(key)}`;
}

function toList(snapshotVal) {
  if (!snapshotVal || typeof snapshotVal !== 'object') return [];
  return Object.entries(snapshotVal).map(([id, data]) => ({ id, ...(data || {}) }));
}

function capSortDesc(a, b) {
  const nA = Number(a?.numero || 0);
  const nB = Number(b?.numero || 0);
  if (nA !== nB) return nB - nA;
  const dA = Date.parse(a?.dataUpload || '');
  const dB = Date.parse(b?.dataUpload || '');
  return (Number.isFinite(dB) ? dB : 0) - (Number.isFinite(dA) ? dA : 0);
}

export default function BibliotecaFavoritos({ user, perfil }) {
  const navigate = useNavigate();
  const [loadingFavs, setLoadingFavs] = useState(true);
  const [loadingObras, setLoadingObras] = useState(true);
  const [loadingCaps, setLoadingCaps] = useState(true);
  const [favoritosLegacy, setFavoritosLegacy] = useState({});
  const [favoritosCanon, setFavoritosCanon] = useState({});
  const [obras, setObras] = useState([]);
  const [capitulos, setCapitulos] = useState([]);

  useEffect(() => {
    if (!user?.uid) {
      setFavoritosLegacy({});
      setFavoritosCanon({});
      setLoadingFavs(false);
      return () => {};
    }
    setLoadingFavs(true);
    let pending = 2;
    const done = () => {
      pending -= 1;
      if (pending <= 0) setLoadingFavs(false);
    };
    const u1 = onValue(ref(db, `usuarios/${user.uid}/favoritosObras`), (snapshot) => {
      setFavoritosLegacy(snapshot.exists() ? snapshot.val() || {} : {});
      done();
    });
    const u2 = onValue(ref(db, `usuarios/${user.uid}/favorites`), (snapshot) => {
      setFavoritosCanon(snapshot.exists() ? snapshot.val() || {} : {});
      done();
    });
    return () => {
      u1();
      u2();
    };
  }, [user?.uid]);

  const favoritosMap = useMemo(
    () => mergeWorkFavoriteMaps(favoritosLegacy, favoritosCanon),
    [favoritosLegacy, favoritosCanon]
  );

  useEffect(() => {
    const obrasRef = ref(db, 'obras');
    const unsub = onValue(obrasRef, (snapshot) => {
      if (!snapshot.exists()) {
        setObras([{ ...OBRA_SHITO_DEFAULT, id: OBRA_PADRAO_ID }]);
        setLoadingObras(false);
        return;
      }
      const lista = ensureLegacyShitoObra(toList(snapshot.val())).filter((obra) => obra?.isPublished !== false);
      setObras(lista);
      setLoadingObras(false);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const capsRef = ref(db, 'capitulos');
    const unsub = onValue(capsRef, (snapshot) => {
      const lista = snapshot.exists() ? toList(snapshot.val()) : [];
      setCapitulos(lista);
      setLoadingCaps(false);
    });
    return () => unsub();
  }, []);

  const cards = useMemo(() => {
    const favoritosIds = Object.keys(favoritosMap || {});
    if (!favoritosIds.length) return [];
    const obrasMap = new Map(obras.map((o) => [String(o.id || '').toLowerCase(), o]));
    const capitulosPorObra = new Map();
    capitulos.forEach((cap) => {
      const obraId = obterObraIdCapitulo(cap);
      const lista = capitulosPorObra.get(obraId) || [];
      lista.push(cap);
      capitulosPorObra.set(obraId, lista);
    });
    return favoritosIds
      .map((obraIdRaw) => {
        const obraId = String(obraIdRaw || '').toLowerCase();
        const favMeta = favoritosMap?.[obraIdRaw] || favoritosMap?.[obraId] || {};
        const obra = obrasMap.get(obraId) || null;
        const listaCaps = (capitulosPorObra.get(obraId) || []).sort(capSortDesc);
        const capAcessivel = listaCaps.find((cap) => capituloLiberadoParaUsuario(cap, user, perfil)) || null;
        const capUltimo = listaCaps[0] || null;
        const obraExcluida = !obra;
        return {
          obraId,
          favMeta,
          obra,
          obraExcluida,
          totalCapitulos: listaCaps.length,
          capAcessivel,
          capUltimo,
        };
      })
      .sort((a, b) => {
        if (a.obraExcluida !== b.obraExcluida) return a.obraExcluida ? 1 : -1;
        return Number(b?.capUltimo?.numero || 0) - Number(a?.capUltimo?.numero || 0);
      });
  }, [favoritosMap, obras, capitulos, user, perfil]);

  const loading = loadingFavs || loadingObras || loadingCaps;

  const desfavoritarObra = async (obraId) => {
    if (!user?.uid || !obraId) return;
    try {
      await removeWorkFavoriteBoth(db, user.uid, obraId);
    } catch {
      // silencioso: o listener já sincroniza o estado
    }
  };

  if (loading) return <div className="shito-app-splash" aria-hidden="true" />;

  return (
    <main className="biblioteca-page">
      <header className="biblioteca-header">
        <h1>Minha Biblioteca</h1>
        <p>Suas obras favoritadas com atalho direto para continuar leitura.</p>
      </header>

      {cards.length === 0 ? (
        <section className="biblioteca-empty">
          <h2>Você ainda não favoritou nenhuma obra</h2>
          <p>Abra a Lista de Mangás e favorite obras para montar sua biblioteca.</p>
          <button type="button" onClick={() => navigate('/works')}>Ver obras</button>
        </section>
      ) : (
        <section className="biblioteca-grid">
          {cards.map((item) => (
            <article key={item.obraId} className={`biblioteca-card ${item.obraExcluida ? 'is-deleted' : ''}`}>
              <img
                src={
                  item.obraExcluida
                    ? '/assets/mascote/vaquinhaERR.webp'
                    : (item.obra?.capaUrl || item.obra?.bannerUrl || '/assets/fotos/shito.jpg')
                }
                alt={item.obra?.titulo || item.obraId}
                className={item.obraExcluida ? 'biblioteca-card-img biblioteca-card-img--deleted' : 'biblioteca-card-img'}
              />
              <div className="biblioteca-card-body">
                <h3>{item.obra?.titulo || item.favMeta?.titulo || item.obraId}</h3>
                {item.obraExcluida ? (
                  <>
                    <p className="biblioteca-deleted-msg">Obra excluída pelo administrador.</p>
                    <p className="biblioteca-last">Favorito órfão: sem página para abrir.</p>
                  </>
                ) : (
                  <>
                    <p>{item.totalCapitulos} capítulos</p>
                    {item.capUltimo ? (
                      <p className="biblioteca-last">
                        Último: #{item.capUltimo.numero} · {formatarDataBrPartirIsoOuMs(item.capUltimo.dataUpload)}
                      </p>
                    ) : (
                      <p className="biblioteca-last">Sem capítulos ainda</p>
                    )}
                  </>
                )}

                <div className="biblioteca-actions">
                  <button
                    type="button"
                    className="btn-biblioteca-sec"
                    disabled={item.obraExcluida}
                    onClick={() => navigate(pathObraPublica(item.obra, item.obraId))}
                  >
                    {item.obraExcluida ? 'Obra excluída' : 'Ver obra'}
                  </button>
                  <button
                    type="button"
                    className="btn-biblioteca-cta"
                    disabled={!item.capAcessivel || item.obraExcluida}
                    onClick={() => item.capAcessivel && navigate(`/ler/${item.capAcessivel.id}`)}
                  >
                    {item.obraExcluida
                      ? 'Sem acesso'
                      : item.capAcessivel
                        ? `Ler #${item.capAcessivel.numero}`
                        : 'Sem capítulo acessível'}
                  </button>
                  <button
                    type="button"
                    className="btn-biblioteca-remove"
                    onClick={() => desfavoritarObra(item.obraId)}
                  >
                    Desfavoritar
                  </button>
                </div>
              </div>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}

