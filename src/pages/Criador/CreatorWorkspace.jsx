import React, { useEffect, useMemo, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { useNavigate } from 'react-router-dom';

import { CREATOR_BIO_MIN_LENGTH } from '../../constants';
import { db } from '../../services/firebase';
import {
  buildCreatorOnboardingSteps,
  creatorOnboardingIsRequiredComplete,
  creatorOnboardingPrimaryNextPath,
  onboardingRequiredDoneCount,
  onboardingRequiredTotal,
} from '../../utils/creatorOnboardingProgress';
import { toRecordList } from '../../utils/firebaseRecordList';
import './CreatorWorkspace.css';

function creatorStatusLabel(preference, status) {
  const pref = String(preference || 'publish_only').trim().toLowerCase();
  const norm = String(status || 'disabled').trim().toLowerCase();
  if (pref !== 'monetize') return 'Apenas publicar';
  if (norm === 'active') return 'Monetizacao ativa';
  if (norm === 'pending_review') return 'Em validacao';
  if (norm === 'blocked_underage') return 'Bloqueada por idade';
  return 'Configuracao pendente';
}

export default function CreatorWorkspace({ user, perfil }) {
  const navigate = useNavigate();
  const [obrasVal, setObrasVal] = useState({});
  const [capsVal, setCapsVal] = useState({});
  const [produtosVal, setProdutosVal] = useState({});
  const [audienceStats, setAudienceStats] = useState({});

  useEffect(() => {
    if (!user?.uid) return () => {};
    const unsubObras = onValue(ref(db, 'obras'), (snap) => {
      setObrasVal(snap.exists() ? snap.val() : {});
    });
    const unsubCaps = onValue(ref(db, 'capitulos'), (snap) => {
      setCapsVal(snap.exists() ? snap.val() : {});
    });
    const unsubProdutos = onValue(ref(db, 'loja/produtos'), (snap) => {
      setProdutosVal(snap.exists() ? snap.val() : {});
    });
    const unsubAudience = onValue(ref(db, `creators/${user.uid}/stats`), (snap) => {
      setAudienceStats(snap.exists() ? snap.val() || {} : {});
    });
    return () => {
      unsubObras();
      unsubCaps();
      unsubProdutos();
      unsubAudience();
    };
  }, [user?.uid]);

  const metrics = useMemo(() => {
    const uid = String(user?.uid || '').trim();
    const obras = toRecordList(obrasVal).filter((obra) => String(obra?.creatorId || '').trim() === uid);
    const obraIds = new Set(obras.map((obra) => String(obra.id || '').trim().toLowerCase()));
    const caps = toRecordList(capsVal).filter((cap) => {
      if (String(cap?.creatorId || '').trim() === uid) return true;
      const obraId = String(cap?.obraId || cap?.mangaId || '').trim().toLowerCase();
      return obraIds.has(obraId);
    });
    const produtos = toRecordList(produtosVal).filter((produto) => String(produto?.creatorId || '').trim() === uid);
    return {
      obras,
      caps,
      produtos,
    };
  }, [user?.uid, obrasVal, capsVal, produtosVal]);

  const onboardingSteps = useMemo(
    () =>
      buildCreatorOnboardingSteps({
        uid: user?.uid,
        perfilDb: perfil || {},
        obrasVal,
        capsVal,
        produtosVal,
        storeSkipped: Boolean(perfil?.creatorOnboardingStoreSkipped),
      }),
    [user?.uid, perfil, obrasVal, capsVal, produtosVal]
  );

  const onboardingDone = onboardingRequiredDoneCount(onboardingSteps);
  const onboardingTotal = onboardingRequiredTotal(onboardingSteps);
  const onboardingComplete = creatorOnboardingIsRequiredComplete(onboardingSteps);
  const nextPath = creatorOnboardingPrimaryNextPath(onboardingSteps);
  const creatorName = String(perfil?.creatorDisplayName || perfil?.userName || user?.displayName || 'Criador').trim();
  const monetizationLabel = creatorStatusLabel(
    perfil?.creatorMonetizationPreference,
    perfil?.creatorMonetizationStatus
  );
  const monetizationStatus = String(perfil?.creatorMonetizationStatus || 'disabled').trim().toLowerCase();
  const monetizationPrimaryLabel =
    monetizationStatus === 'active'
      ? 'Abrir ganhos'
      : monetizationStatus === 'pending_review'
        ? 'Ver revisao'
        : monetizationStatus === 'blocked_underage'
          ? 'Entender bloqueio'
          : 'Configurar apoio';

  return (
    <main className="creator-workspace-page">
      <section className="creator-workspace-shell">
        <header className="creator-workspace-hero">
          <div>
            <p className="creator-workspace-eyebrow">Creator</p>
            <h1>{creatorName}</h1>
            <p>
              Seu painel operacional foi reorganizado em identidade, conteudo, monetizacao e operacao para
              deixar a rotina mais clara.
            </p>
          </div>
          <div className="creator-workspace-actions">
            <button type="button" className="creator-workspace-btn" onClick={() => navigate('/creator/audience')}>
              Ver audiência
            </button>
            <button type="button" className="creator-workspace-btn" onClick={() => navigate('/perfil?onboarding=creator')}>
              Editar perfil
            </button>
            <button type="button" className="creator-workspace-btn is-primary" onClick={() => navigate('/creator/obras')}>
              Nova obra
            </button>
          </div>
        </header>

        <section className="creator-workspace-overview">
          <article className="creator-workspace-stat">
            <span>Obras</span>
            <strong>{metrics.obras.length}</strong>
          </article>
          <article className="creator-workspace-stat">
            <span>Capitulos</span>
            <strong>{metrics.caps.length}</strong>
          </article>
          <article className="creator-workspace-stat">
            <span>Produtos</span>
            <strong>{metrics.produtos.length}</strong>
          </article>
          <article className="creator-workspace-stat">
            <span>Monetizacao</span>
            <strong>{monetizationLabel}</strong>
          </article>
        </section>

        <section className="creator-workspace-overview creator-workspace-overview--audience">
          <article className="creator-workspace-stat">
            <span>Seguidores</span>
            <strong>{Number(audienceStats?.followersCount || 0)}</strong>
          </article>
          <article className="creator-workspace-stat">
            <span>Views totais</span>
            <strong>{Number(audienceStats?.totalViews || 0)}</strong>
          </article>
          <article className="creator-workspace-stat">
            <span>Membros</span>
            <strong>{Number(audienceStats?.membersCount || 0)}</strong>
          </article>
          <article className="creator-workspace-stat">
            <span>Receita</span>
            <strong>
              {new Intl.NumberFormat('pt-BR', {
                style: 'currency',
                currency: 'BRL',
              }).format(Number(audienceStats?.revenueTotal || 0))}
            </strong>
          </article>
        </section>

        <section className="creator-workspace-onboarding">
          <div className="creator-workspace-onboarding-head">
            <div>
              <h2>Progresso do criador</h2>
              <p>O onboarding agora guia a ativacao real do perfil e evita conta vazia.</p>
            </div>
            {!onboardingComplete ? (
              <button type="button" className="creator-workspace-btn is-primary" onClick={() => navigate(nextPath)}>
                Continuar onboarding
              </button>
            ) : (
              <button type="button" className="creator-workspace-btn" onClick={() => navigate(`/criador/${encodeURIComponent(user?.uid || '')}`)}>
                Ver perfil publico
              </button>
            )}
          </div>
          <div className="creator-workspace-progress" role="progressbar" aria-valuenow={onboardingDone} aria-valuemin={0} aria-valuemax={onboardingTotal}>
            <div
              className="creator-workspace-progress-fill"
              style={{ width: `${onboardingTotal ? (onboardingDone / onboardingTotal) * 100 : 0}%` }}
            />
          </div>
          <p className="creator-workspace-progress-label">
            {onboardingDone}/{onboardingTotal} obrigatorios
            {onboardingComplete ? ' completos.' : ' concluidos.'}
          </p>
        </section>

        <section className="creator-workspace-grid">
          <article className="creator-pillar-card">
            <div className="creator-pillar-card-head">
              <p>Identidade</p>
              <strong>Perfil publico</strong>
            </div>
            <p className="creator-pillar-copy">
              Ajuste nome publico, avatar, bio e redes para deixar sua pagina pronta para conversao e descoberta.
            </p>
            <ul className="creator-pillar-list">
              <li>{String(perfil?.creatorDisplayName || '').trim() ? 'Nome publico definido' : 'Nome publico pendente'}</li>
              <li>
                {String(perfil?.creatorBio || '').trim().length >= CREATOR_BIO_MIN_LENGTH
                  ? 'Bio pronta'
                  : 'Bio ainda curta'}
              </li>
              <li>{String(perfil?.instagramUrl || '').trim() || String(perfil?.youtubeUrl || '').trim() ? 'Rede social adicionada' : 'Rede social pendente'}</li>
            </ul>
            <button type="button" className="creator-workspace-btn" onClick={() => navigate('/perfil?onboarding=creator')}>
              Abrir identidade
            </button>
          </article>

          <article className="creator-pillar-card">
            <div className="creator-pillar-card-head">
              <p>Conteudo</p>
              <strong>Obras e capitulos</strong>
            </div>
            <p className="creator-pillar-copy">
              Seu catalogo, seus capitulos e a cadencia de publicacao vivem aqui.
            </p>
            <ul className="creator-pillar-list">
              <li>{metrics.obras.length} obra(s) cadastrada(s)</li>
              <li>{metrics.caps.length} capitulo(s) publicado(s)</li>
              <li>{metrics.caps.length > 0 ? 'Ja existe conteudo ativo' : 'Falta publicar o primeiro capitulo'}</li>
            </ul>
            <div className="creator-pillar-actions">
              <button type="button" className="creator-workspace-btn" onClick={() => navigate('/creator/obras')}>
                Minhas obras
              </button>
              <button type="button" className="creator-workspace-btn" onClick={() => navigate('/creator/capitulos')}>
                Capitulos
              </button>
            </div>
          </article>

          <article className="creator-pillar-card">
            <div className="creator-pillar-card-head">
              <p>Monetizacao</p>
              <strong>Apoio e membership</strong>
            </div>
            <p className="creator-pillar-copy">
              Publicar e monetizar sao escolhas separadas. Quando ativada, a monetizacao precisa estar coerente com
              sua configuracao e validacao.
            </p>
            <ul className="creator-pillar-list">
              <li>Modo atual: {monetizationLabel}</li>
              <li>
                {monetizationStatus === 'active'
                  ? 'Membership ativa com leitura de membros e ganhos'
                  : perfil?.creatorMonetizationPreference === 'monetize'
                    ? 'Membership em revisao antes de liberar repasse'
                    : 'Conta em publicacao sem repasse direto'}
              </li>
              <li>
                {perfil?.creatorMonetizationStatus === 'blocked_underage'
                  ? 'Conta menor de idade: pode publicar, sem receber'
                  : monetizationStatus === 'active'
                    ? 'Promocoes, receita e base recorrente aparecem no workspace'
                    : 'A configuracao fica no perfil do criador'}
              </li>
            </ul>
            <div className="creator-pillar-actions">
              <button type="button" className="creator-workspace-btn" onClick={() => navigate('/perfil?onboarding=creator')}>
                Configurar apoio
              </button>
              <button type="button" className="creator-workspace-btn" onClick={() => navigate('/creator/promocoes')}>
                {monetizationPrimaryLabel}
              </button>
            </div>
          </article>

          <article className="creator-pillar-card">
            <div className="creator-pillar-card-head">
              <p>Audiência</p>
              <strong>Leitura e retenção</strong>
            </div>
            <p className="creator-pillar-copy">
              Veja seguidores, views, conversão em membros e retenção entre capítulos sem depender de leitura manual.
            </p>
            <ul className="creator-pillar-list">
              <li>Seguidores e alcance consolidados</li>
              <li>Engajamento por capítulo e retenção por progressão</li>
              <li>Leitura separada entre audiência e monetização</li>
            </ul>
            <button type="button" className="creator-workspace-btn" onClick={() => navigate('/creator/audience')}>
              Abrir audiência
            </button>
          </article>

          <article className="creator-pillar-card">
            <div className="creator-pillar-card-head">
              <p>Operacao</p>
              <strong>Loja e rotina</strong>
            </div>
            <p className="creator-pillar-copy">
              Use este bloco para acompanhar o que ja esta rodando alem dos capitulos, sem misturar com o admin da plataforma.
            </p>
            <ul className="creator-pillar-list">
              <li>{metrics.produtos.length} produto(s) associado(s) ao criador</li>
              <li>{perfil?.creatorOnboardingStoreSkipped ? 'Loja marcada como opcional por enquanto' : 'Loja disponivel para expandir sua operacao'}</li>
              <li>As acoes continuam filtradas pelo seu creatorId</li>
            </ul>
            <button type="button" className="creator-workspace-btn" onClick={() => navigate('/creator/loja')}>
              Abrir operacao
            </button>
          </article>
        </section>
      </section>
    </main>
  );
}
