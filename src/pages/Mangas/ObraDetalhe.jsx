import React, { useEffect, useMemo, useState } from 'react';
import { onValue, ref, remove, set } from 'firebase/database';
import { useNavigate, useParams } from 'react-router-dom';

import { db } from '../../services/firebase';
import {
  OBRA_PADRAO_ID,
  OBRA_SHITO_DEFAULT,
  normalizarObraId,
  obterObraIdCapitulo,
} from '../../config/obras';
import { capituloLiberadoParaUsuario, formatarDataLancamento } from '../../utils/capituloLancamento';
import './ObraDetalhe.css';

function toList(snapshotVal) {
  if (!snapshotVal || typeof snapshotVal !== 'object') return [];
  return Object.entries(snapshotVal).map(([id, data]) => ({ id, ...(data || {}) }));
}

function chapterSort(a, b) {
  const nA = Number(a?.numero || 0);
  const nB = Number(b?.numero || 0);
  if (nA !== nB) return nB - nA;
  const dA = Date.parse(a?.dataUpload || '');
  const dB = Date.parse(b?.dataUpload || '');
  return (Number.isFinite(dB) ? dB : 0) - (Number.isFinite(dA) ? dA : 0);
}

function formatarDataBR(iso) {
  const ms = Date.parse(iso || '');
  if (!Number.isFinite(ms)) return 'Sem data';
  return new Date(ms).toLocaleDateString('pt-BR');
}

export default function ObraDetalhe({ user, perfil }) {
  const { obraId: obraIdRaw } = useParams();
  const obraId = normalizarObraId(obraIdRaw);
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [obra, setObra] = useState(null);
  const [capitulos, setCapitulos] = useState([]);
  const [isFavorito, setIsFavorito] = useState(false);

  useEffect(() => {
    let loadingObra = true;
    let loadingCap = true;

    const concluir = () => {
      if (!loadingObra && !loadingCap) setLoading(false);
    };

    const obraRef = ref(db, `obras/${obraId}`);
    const unsubObra = onValue(obraRef, (snapshot) => {
      if (snapshot.exists()) {
        setObra({ id: obraId, ...snapshot.val() });
      } else if (obraId === OBRA_PADRAO_ID) {
        setObra({ ...OBRA_SHITO_DEFAULT, id: OBRA_PADRAO_ID });
      } else {
        setObra(null);
      }
      loadingObra = false;
      concluir();
    });

    const capRef = ref(db, 'capitulos');
    const unsubCap = onValue(capRef, (snapshot) => {
      const lista = snapshot.exists() ? toList(snapshot.val()) : [];
      const filtrados = lista
        .filter((cap) => obterObraIdCapitulo(cap) === obraId)
        .sort(chapterSort);
      setCapitulos(filtrados);
      loadingCap = false;
      concluir();
    });

    return () => {
      unsubObra();
      unsubCap();
    };
  }, [obraId]);

  useEffect(() => {
    if (!user?.uid) {
      setIsFavorito(false);
      return () => {};
    }
    const favRef = ref(db, `usuarios/${user.uid}/favoritosObras/${obraId}`);
    const unsub = onValue(favRef, (snapshot) => setIsFavorito(snapshot.exists()));
    return () => unsub();
  }, [user?.uid, obraId]);

  const capituloCTA = useMemo(
    () => capitulos.find((cap) => capituloLiberadoParaUsuario(cap, user, perfil)) || capitulos[0] || null,
    [capitulos, user, perfil]
  );

  const toggleFavorito = async () => {
    if (!user?.uid) {
      navigate('/login');
      return;
    }
    const favRef = ref(db, `usuarios/${user.uid}/favoritosObras/${obraId}`);
    if (isFavorito) {
      await remove(favRef);
      return;
    }
    await set(favRef, {
      obraId,
      titulo: obra?.titulo || obraId,
      savedAt: Date.now(),
    });
  };

  const abrirCTA = () => {
    if (!capituloCTA) return;
    navigate(`/ler/${capituloCTA.id}`);
  };

  if (loading) return <div className="shito-app-splash" aria-hidden="true" />;

  if (!obra) {
    return (
      <main className="obra-page">
        <section className="obra-not-found">
          <h1>Obra não encontrada</h1>
          <p>Essa obra não existe ou ainda não foi publicada.</p>
          <button type="button" onClick={() => navigate('/mangas')}>Voltar para Lista de Mangás</button>
        </section>
      </main>
    );
  }

  return (
    <main className="obra-page">
      <section
        className="obra-hero"
        style={{
          backgroundImage: `linear-gradient(180deg, rgba(6,9,16,0.25), rgba(6,9,16,0.92)), url('${obra.bannerUrl || obra.capaUrl || '/assets/fotos/shito.jpg'}')`,
        }}
      >
        <div className="obra-hero-content">
          <img
            className="obra-cover"
            src={obra.capaUrl || obra.bannerUrl || '/assets/fotos/shito.jpg'}
            alt={obra.titulo || obraId}
          />
          <div className="obra-info">
            <h1>{obra.titulo || obraId}</h1>
            <p className="obra-sinopse">{obra.sinopse || 'Sinopse em breve.'}</p>
            <div className="obra-meta">
              <span>Status: {obra.status || 'ongoing'}</span>
              <span>Público: {obra.publicoAlvo || 'Geral'}</span>
              <span>{capitulos.length} capítulos</span>
            </div>
            <div className="obra-actions">
              <button type="button" className="btn-obra-cta" onClick={abrirCTA} disabled={!capituloCTA}>
                Ler agora
              </button>
              <button type="button" className={`btn-obra-fav-page ${isFavorito ? 'is-fav' : ''}`} onClick={toggleFavorito}>
                {isFavorito ? '★ Desfavoritar' : '☆ Favoritar'}
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="obra-capitulos-section">
        <div className="obra-capitulos-head">
          <h2 className="obra-capitulos-title">Lista de capítulos</h2>
        </div>

        {capitulos.length === 0 ? (
          <p className="obra-capitulos-empty">Essa obra ainda não possui capítulos publicados.</p>
        ) : (
          <div className="obra-capitulos-list shueisha-capitulos-list">
            {capitulos.map((cap) => {
              if (!cap) return null;
              const liberado = capituloLiberadoParaUsuario(cap, user, perfil);
              const agendado = Number(cap?.publicReleaseAt || 0) > Date.now();
              return ( 
                <article
                  key={cap.id}
                  className={`obra-cap-item shito-cap-row ${liberado ? '' : 'shito-cap-row--bloqueado'}`}
                  onClick={() => navigate(`/ler/${cap.id}`)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && navigate(`/ler/${cap.id}`)}
                >
                  <div className="cap-left-info">
                    <span className="shito-cap-number">#{String(cap.numero || 0).padStart(3, '0')}</span>
                    <div className="cap-main-content">
                      <div className="shito-cap-miniature-wrapper">
                        <img
                          src={cap.capaUrl || '/assets/fotos/shito.jpg'}
                          alt={cap.titulo || `Capítulo ${cap.numero}`}
                          className="shito-cap-miniature"
                        />
                      </div>
                      <div className="cap-text-details">
                        <h3 className="shito-cap-title">{cap.titulo || 'Capítulo sem título'}</h3>
                        {!liberado && (
                          <span className="cap-badge-em-breve">
                            Em breve · {formatarDataLancamento(cap.publicReleaseAt)}
                          </span>
                        )}
                        <div className="obra-cap-access">
                          {liberado && <span className="pill publico">Público</span>}
                          {!liberado && cap.antecipadoMembros && (
                            <span className="pill premium">Premium antecipado</span>
                          )}
                          {!liberado && !cap.antecipadoMembros && agendado && (
                            <span className="pill agendado">Agendado</span>
                          )}
                        </div>
                        <div className="cap-stats-row">
                          <span className="stat-item">👁 {Number(cap.visualizacoes || 0)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="cap-right-info">
                    <time className="shito-cap-date">{formatarDataBR(cap.dataUpload)}</time>
                    <span className="arrow-mobile">›</span>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}

