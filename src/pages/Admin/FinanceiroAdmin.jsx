import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';

import { functions } from '../../services/firebase';
import { mensagemErroCallable } from '../../utils/firebaseCallableError';
import { labelPrecoPremium, PREMIUM_PRECO_BRL } from '../../config/premiumAssinatura';
import './FinanceiroAdmin.css';

const migrateDeprecatedFields = httpsCallable(functions, 'adminMigrateDeprecatedUserFields');
const adminObterPromocaoPremium = httpsCallable(functions, 'adminObterPromocaoPremium');
const adminSalvarPromocaoPremium = httpsCallable(functions, 'adminSalvarPromocaoPremium');
const adminIncrementarDuracaoPromocaoPremium = httpsCallable(functions, 'adminIncrementarDuracaoPromocaoPremium');
const PRECO_BASE = Number(PREMIUM_PRECO_BRL || 23);
const PROMO_TEMPLATES = [
  {
    id: 'flash24',
    nome: 'Flash 24h',
    mensagem: 'Oferta relâmpago para virar Membro Shito nas próximas 24h.',
    dias: 0,
    horas: 24,
    minutos: 0,
    segundos: 0,
    descontoPct: 13,
  },
  {
    id: 'fimSemana',
    nome: 'Fim de semana da Tempestade',
    mensagem: 'Promo de fim de semana para reforçar a base premium.',
    dias: 2,
    horas: 0,
    minutos: 0,
    segundos: 0,
    descontoPct: 18,
  },
  {
    id: 'retomada7d',
    nome: 'Retomada da Guilda (7 dias)',
    mensagem: 'Campanha de retomada para acelerar assinaturas no início do mês.',
    dias: 7,
    horas: 0,
    minutos: 0,
    segundos: 0,
    descontoPct: 10,
  },
];

function toDatetimeLocal(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDateBr(ms) {
  if (!ms) return '--';
  try {
    return new Date(ms).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZone: 'America/Sao_Paulo',
    });
  } catch {
    return '--';
  }
}

export default function FinanceiroAdmin() {
  const navigate = useNavigate();
  const [aba, setAba] = useState('visao');
  const [nowMs, setNowMs] = useState(Date.now());
  const [migrando, setMigrando] = useState(false);
  const [msgMigracao, setMsgMigracao] = useState('');
  const [loadingPromo, setLoadingPromo] = useState(false);
  const [msgPromo, setMsgPromo] = useState('');
  const [promoAtual, setPromoAtual] = useState(null);
  const [promoHistory, setPromoHistory] = useState([]);
  const [lastCampaign, setLastCampaign] = useState(null);
  const [currentPerformance, setCurrentPerformance] = useState(null);
  const [templateAtivo, setTemplateAtivo] = useState('');

  const [promoNome, setPromoNome] = useState('Promoção Membro Shito');
  const [promoMensagem, setPromoMensagem] = useState('');
  const [promoPreco, setPromoPreco] = useState('19.90');
  const [promoInicio, setPromoInicio] = useState(() => toDatetimeLocal(Date.now()));
  const [durDias, setDurDias] = useState('0');
  const [durHoras, setDurHoras] = useState('24');
  const [durMin, setDurMin] = useState('0');
  const [durSeg, setDurSeg] = useState('0');
  const [notifyUsers, setNotifyUsers] = useState(true);
  const [incDias, setIncDias] = useState('0');
  const [incHoras, setIncHoras] = useState('1');
  const [incMin, setIncMin] = useState('0');

  useEffect(() => {
    const temPromoComTempo = Boolean(promoAtual?.startsAt) && Boolean(promoAtual?.endsAt);
    if (aba !== 'visao' || !temPromoComTempo) return undefined;
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      setNowMs(Date.now());
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [aba, promoAtual?.startsAt, promoAtual?.endsAt]);

  const duracaoMs = useMemo(() => {
    const d = Number(durDias || 0);
    const h = Number(durHoras || 0);
    const m = Number(durMin || 0);
    const s = Number(durSeg || 0);
    return (
      Math.max(0, d) * 24 * 60 * 60 * 1000 +
      Math.max(0, h) * 60 * 60 * 1000 +
      Math.max(0, m) * 60 * 1000 +
      Math.max(0, s) * 1000
    );
  }, [durDias, durHoras, durMin, durSeg]);

  const precoNumerico = useMemo(
    () => Number(String(promoPreco || '').replace(',', '.')),
    [promoPreco]
  );

  const rodarMigracaoCampos = async () => {
    setMsgMigracao('');
    setMigrando(true);
    try {
      const { data } = await migrateDeprecatedFields();
      const total = Number(data?.usuariosComPatch || 0) + Number(data?.publicosComPatch || 0);
      setMsgMigracao(
        `Limpeza concluída com sucesso em ${total} cadastro(s). Pode continuar usando o painel normalmente.`
      );
    } catch (err) {
      setMsgMigracao(`Não foi possível finalizar agora. Tente novamente em alguns minutos. Detalhe: ${err.message || String(err)}`);
    } finally {
      setMigrando(false);
    }
  };

  const carregarPromo = async () => {
    setLoadingPromo(true);
    setMsgPromo('');
    try {
      const { data } = await adminObterPromocaoPremium();
      const promo = data?.parsedPromo || null;
      setPromoAtual(promo);
      setPromoHistory(Array.isArray(data?.promoHistory) ? data.promoHistory : []);
      setLastCampaign(data?.lastCampaign || null);
      setCurrentPerformance(data?.currentPerformance || null);
      if (promo) {
        setPromoNome(promo.name || 'Promoção Membro Shito');
        setPromoMensagem(promo.message || '');
        setPromoPreco(String(promo.priceBRL));
        setPromoInicio(toDatetimeLocal(promo.startsAt || Date.now()));
      }
    } catch (err) {
      setMsgPromo(mensagemErroCallable(err));
    } finally {
      setLoadingPromo(false);
    }
  };

  useEffect(() => {
    carregarPromo().catch(() => {});
  }, []);

  const salvarPromo = async () => {
    setLoadingPromo(true);
    setMsgPromo('');
    try {
      const inicio = new Date(promoInicio).getTime();
      if (!Number.isFinite(inicio)) {
        setMsgPromo('Data de início inválida.');
        setLoadingPromo(false);
        return;
      }
      if (duracaoMs <= 0) {
        setMsgPromo('Defina uma duração maior que zero.');
        setLoadingPromo(false);
        return;
      }
      const fim = inicio + duracaoMs;
      const preco = Number(String(promoPreco).replace(',', '.'));
      if (!Number.isFinite(preco) || preco <= 0) {
        setMsgPromo('Preço promocional inválido.');
        setLoadingPromo(false);
        return;
      }
      const { data } = await adminSalvarPromocaoPremium({
        enabled: true,
        name: promoNome,
        message: promoMensagem,
        priceBRL: preco,
        startsAt: inicio,
        endsAt: fim,
        notifyUsers,
      });
      setMsgPromo(
        data?.notifyUsers
          ? `Promoção salva e notificada. Enviados: ${data?.emailStats?.sent || 0}, falhas: ${data?.emailStats?.failed || 0}.`
          : 'Promoção salva em modo silencioso.'
      );
      await carregarPromo();
    } catch (err) {
      setMsgPromo(mensagemErroCallable(err));
    } finally {
      setLoadingPromo(false);
    }
  };

  const encerrarPromo = async ({ agendada = false } = {}) => {
    const pergunta = agendada
      ? 'Deseja cancelar esta campanha agendada?'
      : 'Deseja encerrar esta promoção agora?';
    if (!window.confirm(pergunta)) return;
    setLoadingPromo(true);
    setMsgPromo('');
    try {
      await adminSalvarPromocaoPremium({ enabled: false });
      setPromoAtual(null);
      setMsgPromo(
        agendada
          ? 'Campanha agendada cancelada. O checkout segue no preço base.'
          : 'Promoção encerrada. O checkout voltou ao preço base.'
      );
    } catch (err) {
      setMsgPromo(mensagemErroCallable(err));
    } finally {
      setLoadingPromo(false);
    }
  };

  const incrementarDuracao = async (preset = null) => {
    const dias = Math.max(0, Math.floor(Number(preset?.days ?? incDias ?? 0)));
    const horas = Math.max(0, Math.floor(Number(preset?.hours ?? incHoras ?? 0)));
    const minutos = Math.max(0, Math.floor(Number(preset?.minutes ?? incMin ?? 0)));
    if (!promoAtivaAgora) {
      setMsgPromo('Só é possível incrementar o tempo quando a promoção está ativa.');
      return;
    }
    if (dias + horas + minutos <= 0) {
      setMsgPromo('Informe pelo menos dias, horas ou minutos para incrementar.');
      return;
    }
    setLoadingPromo(true);
    setMsgPromo('');
    try {
      const { data } = await adminIncrementarDuracaoPromocaoPremium({
        days: dias,
        hours: horas,
        minutes: minutos,
      });
      setMsgPromo(
        `Tempo adicionado com sucesso (+${dias}d ${horas}h ${minutos}min). Novo término: ${formatDateBr(data?.endsAt)}.`
      );
      await carregarPromo();
    } catch (err) {
      setMsgPromo(mensagemErroCallable(err));
    } finally {
      setLoadingPromo(false);
    }
  };

  const promoStartMs = Number(promoAtual?.startsAt || 0);
  const promoEndMs = Number(promoAtual?.endsAt || 0);
  const promoAtivaAgora = Boolean(promoAtual && nowMs >= promoStartMs && nowMs <= promoEndMs);
  const promoAgendada = Boolean(promoAtual && nowMs < promoStartMs);
  const promoEncerrada = Boolean(promoAtual && nowMs > promoEndMs);
  const restante = Math.max(0, promoEndMs - nowMs);
  const totalSec = Math.floor(restante / 1000);
  const dd = String(Math.floor(totalSec / 86400)).padStart(2, '0');
  const hh = String(Math.floor((totalSec % 86400) / 3600)).padStart(2, '0');
  const mm = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
  const ss = String(totalSec % 60).padStart(2, '0');
  const timerFormatado = `${dd}:${hh}:${mm}:${ss}`;
  const simulador = useMemo(() => {
    const preco = Number.isFinite(precoNumerico) ? precoNumerico : 0;
    const descontoPct = PRECO_BASE > 0 ? ((PRECO_BASE - preco) / PRECO_BASE) * 100 : 0;
    const baselineAssinaturas = Math.max(
      10,
      Number(lastCampaign?.performance?.payments || currentPerformance?.payments || 10)
    );
    const receitaBase = PRECO_BASE * baselineAssinaturas;
    const cenarios = [
      { id: 'conservador', nome: 'Conservador', lift: 1.1 },
      { id: 'medio', nome: 'Médio', lift: 1.35 },
      { id: 'agressivo', nome: 'Agressivo', lift: 1.6 },
    ].map((c) => {
      const assinaturas = Math.round(baselineAssinaturas * c.lift);
      const receita = assinaturas * preco;
      const delta = receita - receitaBase;
      return {
        ...c,
        assinaturas,
        receita,
        delta,
      };
    });
    const breakEvenAssinaturas = preco > 0 ? Math.ceil(receitaBase / preco) : 0;
    return {
      descontoPct: Math.round(descontoPct * 10) / 10,
      baselineAssinaturas,
      receitaBase,
      breakEvenAssinaturas,
      cenarios,
    };
  }, [precoNumerico, lastCampaign, currentPerformance]);

  const warningsConfig = useMemo(() => {
    const arr = [];
    if (Number.isFinite(precoNumerico) && precoNumerico < PRECO_BASE * 0.6) {
      arr.push('Preço muito baixo: pode reduzir receita se o volume não subir bastante.');
    }
    if (duracaoMs > 30 * 24 * 60 * 60 * 1000) {
      arr.push('Duração acima de 30 dias: pode banalizar o valor percebido da assinatura.');
    }
    if (duracaoMs <= 0) {
      arr.push('Defina uma duração maior que zero para evitar promoção inválida.');
    }
    return arr;
  }, [precoNumerico, duracaoMs]);

  const aplicarTemplate = (tpl) => {
    const precoCalc = PRECO_BASE * (1 - tpl.descontoPct / 100);
    setTemplateAtivo(tpl.id);
    setPromoNome(tpl.nome);
    setPromoMensagem(tpl.mensagem);
    setPromoPreco(String(Math.round(precoCalc * 100) / 100));
    setDurDias(String(tpl.dias));
    setDurHoras(String(tpl.horas));
    setDurMin(String(tpl.minutos));
    setDurSeg(String(tpl.segundos));
    setPromoInicio(toDatetimeLocal(Date.now()));
    setAba('config');
  };

  const duplicarCampanha = (campanha) => {
    if (!campanha) return;
    const spanMs = Math.max(
      3600000,
      Number(campanha.endsAt || 0) - Number(campanha.startsAt || 0)
    );
    const totalSecCopy = Math.floor(spanMs / 1000);
    const diasCopy = Math.floor(totalSecCopy / 86400);
    const horasCopy = Math.floor((totalSecCopy % 86400) / 3600);
    const minCopy = Math.floor((totalSecCopy % 3600) / 60);
    const secCopy = totalSecCopy % 60;
    setPromoNome(`${campanha.name || 'Promoção'} (Cópia)`);
    setPromoMensagem(campanha.message || '');
    setPromoPreco(String(campanha.priceBRL || PRECO_BASE));
    setPromoInicio(toDatetimeLocal(Date.now()));
    setDurDias(String(diasCopy));
    setDurHoras(String(horasCopy));
    setDurMin(String(minCopy));
    setDurSeg(String(secCopy));
    setTemplateAtivo('');
    setAba('config');
  };

  return (
    <main className="admin-empty-page">
      <section className="admin-empty-card financeiro-card">
        <header className="financeiro-header">
          <div>
            <h1>Promoções do Premium</h1>
            <p>Controle de campanhas que impactam diretamente a receita de assinaturas.</p>
          </div>
          <div className="financeiro-header-actions">
            <button type="button" className="financeiro-btn-primary" onClick={() => setAba('config')}>
              Criar nova promoção
            </button>
            <button type="button" onClick={() => navigate('/admin/dashboard')}>
              Voltar ao dashboard
            </button>
          </div>
        </header>

        <div className="financeiro-tabs">
          <button type="button" className={aba === 'visao' ? 'active' : ''} onClick={() => setAba('visao')}>
            Visão geral
          </button>
          <button type="button" className={aba === 'config' ? 'active' : ''} onClick={() => setAba('config')}>
            Criar / editar promoção
          </button>
          <button type="button" className={aba === 'limpeza' ? 'active' : ''} onClick={() => setAba('limpeza')}>
            Limpeza de cadastro
          </button>
        </div>

        {aba === 'visao' && (
          <div className="financeiro-promocao">
            <h2>Estado atual da campanha</h2>
            {promoAtual ? (
              <div className={`promo-banner ${promoAtivaAgora ? 'promo-banner--active' : ''} ${promoEncerrada ? 'promo-banner--ended' : ''}`}>
                <div className="promo-banner-head">
                  <h3>
                    {promoAtivaAgora
                      ? '🔥 Promoção ativa'
                      : promoAgendada
                        ? 'Campanha programada'
                        : 'Campanha encerrada'}
                  </h3>
                  <span className={`promo-status-chip ${promoAtivaAgora ? 'active' : promoAgendada ? 'scheduled' : 'ended'}`}>
                    {promoAtivaAgora ? 'ATIVA' : promoAgendada ? 'AGENDADA' : 'ENCERRADA'}
                  </span>
                </div>
                <p className="promo-campaign-name">{promoAtual.name}</p>
                <p className="promo-price-line">
                  <strong>R$ {promoAtual.priceBRL?.toFixed(2)}</strong>
                  <span>antes {labelPrecoPremium()}</span>
                </p>
                <p className="promo-dates-line">
                  Janela da campanha: {formatDateBr(promoAtual.startsAt)} até {formatDateBr(promoAtual.endsAt)}
                </p>
                {promoAtivaAgora ? (
                  <>
                    <div className="promo-countdown-block">
                      <small>Tempo restante</small>
                      <strong>{timerFormatado}</strong>
                    </div>
                    <div className="promo-incremento">
                      <h4>Incrementar duração da promoção ativa</h4>
                      <div className="promo-incremento-grid">
                        <label>
                          Dias
                          <input type="number" min="0" value={incDias} onChange={(e) => setIncDias(e.target.value)} />
                        </label>
                        <label>
                          Horas
                          <input type="number" min="0" value={incHoras} onChange={(e) => setIncHoras(e.target.value)} />
                        </label>
                        <label>
                          Minutos
                          <input type="number" min="0" value={incMin} onChange={(e) => setIncMin(e.target.value)} />
                        </label>
                      </div>
                      <div className="promo-incremento-acoes">
                        <button type="button" disabled={loadingPromo} onClick={() => incrementarDuracao()}>
                          {loadingPromo ? 'Aplicando...' : 'Aplicar incremento'}
                        </button>
                        <button type="button" disabled={loadingPromo} onClick={() => incrementarDuracao({ minutes: 15 })}>
                          +15 min
                        </button>
                        <button type="button" disabled={loadingPromo} onClick={() => incrementarDuracao({ hours: 1 })}>
                          +1h
                        </button>
                        <button type="button" disabled={loadingPromo} onClick={() => incrementarDuracao({ days: 1 })}>
                          +1 dia
                        </button>
                      </div>
                    </div>
                  </>
                ) : promoAgendada ? (
                  <p className="promo-timer">
                    Promoção cadastrada, aguardando o horário de início.
                  </p>
                ) : (
                  <p className="promo-timer">
                    Esta campanha já finalizou em {formatDateBr(promoAtual.endsAt)}.
                  </p>
                )}
              </div>
            ) : (
              <div className="promo-banner promo-banner--inactive">
                <div className="promo-empty-icon" aria-hidden="true">🧾</div>
                <h3>Nenhuma campanha ativa</h3>
                <p>Crie uma promoção para aplicar preço temporário no checkout Premium e aumentar conversão.</p>
                <button type="button" className="financeiro-btn-primary" onClick={() => setAba('config')}>
                  Criar promoção
                </button>
              </div>
            )}
            <div className="financeiro-acoes">
              <button type="button" className="financeiro-btn-primary" onClick={() => setAba('config')}>
                Editar campanha
              </button>
              <button type="button" disabled={loadingPromo} onClick={carregarPromo}>
                Recarregar estado
              </button>
              {(promoAtivaAgora || promoAgendada) && (
                <button
                  type="button"
                  className="financeiro-btn-encerrar"
                  disabled={loadingPromo || !promoAtual}
                  onClick={() => encerrarPromo({ agendada: promoAgendada })}
                >
                  {promoAgendada ? 'Cancelar campanha' : 'Encerrar agora'}
                </button>
              )}
            </div>
            {msgPromo && <p className="financeiro-migracao-msg">{msgPromo}</p>}

            <section className="financeiro-resultados">
              <h3>Resultado da última campanha</h3>
              {lastCampaign ? (
                <>
                  <div className="financeiro-resultados-head">
                    <p>
                      <strong>{lastCampaign.name}</strong> · {labelPrecoPremium(lastCampaign.priceBRL)} ·{' '}
                      {formatDateBr(lastCampaign.startsAt)} até {formatDateBr(lastCampaign.endsAt)}
                    </p>
                    <button type="button" onClick={() => duplicarCampanha(lastCampaign)}>
                      Duplicar campanha
                    </button>
                  </div>
                  <div className="financeiro-resultados-kpis">
                    <article>
                      <small>Emails enviados</small>
                      <strong>{lastCampaign?.performance?.sentEmails || 0}</strong>
                    </article>
                    <article>
                      <small>Cliques</small>
                      <strong>{lastCampaign?.performance?.clicks || 0}</strong>
                    </article>
                    <article>
                      <small>Checkouts</small>
                      <strong>{lastCampaign?.performance?.checkouts || 0}</strong>
                    </article>
                    <article>
                      <small>Pagamentos</small>
                      <strong>{lastCampaign?.performance?.payments || 0}</strong>
                    </article>
                    <article>
                      <small>Receita</small>
                      <strong>{labelPrecoPremium(lastCampaign?.performance?.revenue || 0)}</strong>
                    </article>
                  </div>
                  <div className="financeiro-mini-funil">
                    {[
                      { id: 'env', label: 'Enviado', value: lastCampaign?.performance?.sentEmails || 0, base: lastCampaign?.performance?.sentEmails || 0 },
                      { id: 'clk', label: 'Clique', value: lastCampaign?.performance?.clicks || 0, base: lastCampaign?.performance?.sentEmails || 0 },
                      { id: 'chk', label: 'Checkout', value: lastCampaign?.performance?.checkouts || 0, base: lastCampaign?.performance?.sentEmails || 0 },
                      { id: 'pay', label: 'Pago', value: lastCampaign?.performance?.payments || 0, base: lastCampaign?.performance?.sentEmails || 0 },
                    ].map((step) => {
                      const pct = step.base > 0 ? Math.max(5, Math.round((step.value / step.base) * 100)) : 5;
                      return (
                        <div key={step.id} className="financeiro-mini-step">
                          <div className="financeiro-mini-step-head">
                            <span>{step.label}</span>
                            <strong>{step.value}</strong>
                          </div>
                          <div className="financeiro-mini-bar">
                            <i style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <p className="promo-timer">Ainda não há campanha concluída com dados de performance.</p>
              )}
            </section>

            <section className="financeiro-historico">
              <div className="financeiro-historico-head">
                <h3>Histórico de campanhas</h3>
                <small>Últimas campanhas salvas para reutilizar e comparar.</small>
              </div>
              <div className="financeiro-historico-list">
                {promoHistory.map((camp) => (
                  <article key={camp.promoId} className="financeiro-historico-item">
                    <div>
                      <h4>{camp.name}</h4>
                      <p>{labelPrecoPremium(camp.priceBRL)} · {formatDateBr(camp.startsAt)} até {formatDateBr(camp.endsAt)}</p>
                      <small>Status: {camp.status || 'registrada'} · Receita: {labelPrecoPremium(camp?.performance?.revenue || 0)}</small>
                    </div>
                    <div className="financeiro-historico-acoes">
                      <button type="button" onClick={() => duplicarCampanha(camp)}>Duplicar</button>
                      <span className="financeiro-history-score">
                        {Number(camp?.performance?.paidFromSentPct || 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}% pago/enviado
                      </span>
                    </div>
                  </article>
                ))}
                {!promoHistory.length && <p className="promo-timer">Sem campanhas anteriores registradas.</p>}
              </div>
            </section>
          </div>
        )}

        {aba === 'config' && (
          <div className="financeiro-promocao">
            <h2>Configuração de promoção Premium</h2>
            <div className="financeiro-form-section">
              <h3>Templates rápidos</h3>
              <div className="financeiro-template-list">
                {PROMO_TEMPLATES.map((tpl) => (
                  <button
                    type="button"
                    key={tpl.id}
                    className={`financeiro-template-chip ${templateAtivo === tpl.id ? 'active' : ''}`}
                    onClick={() => aplicarTemplate(tpl)}
                  >
                    {tpl.nome}
                  </button>
                ))}
              </div>
            </div>

            <div className="financeiro-form-section">
              <h3>Dados da campanha</h3>
              <div className="financeiro-grid">
                <label>
                  Nome da campanha
                  <input value={promoNome} onChange={(e) => setPromoNome(e.target.value)} />
                </label>
                <label>
                  Preço promocional (R$)
                  <input value={promoPreco} onChange={(e) => setPromoPreco(e.target.value)} inputMode="decimal" />
                </label>
              </div>
            </div>

            <div className="financeiro-form-section">
              <h3>Tempo</h3>
              <div className="financeiro-grid">
                <label>
                  Início da promoção
                  <input type="datetime-local" value={promoInicio} onChange={(e) => setPromoInicio(e.target.value)} />
                </label>
                <label>
                  Duração (dias)
                  <input type="number" min="0" value={durDias} onChange={(e) => setDurDias(e.target.value)} />
                </label>
                <label>
                  Duração (horas)
                  <input type="number" min="0" value={durHoras} onChange={(e) => setDurHoras(e.target.value)} />
                </label>
                <label>
                  Duração (minutos)
                  <input type="number" min="0" value={durMin} onChange={(e) => setDurMin(e.target.value)} />
                </label>
                <label>
                  Duração (segundos)
                  <input type="number" min="0" value={durSeg} onChange={(e) => setDurSeg(e.target.value)} />
                </label>
              </div>
            </div>

            <div className="financeiro-form-section">
              <h3>Simulador de impacto</h3>
              <div className="financeiro-simulador-kpis">
                <article>
                  <small>Desconto aplicado</small>
                  <strong>{simulador.descontoPct.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</strong>
                </article>
                <article>
                  <small>Base de referência</small>
                  <strong>{simulador.baselineAssinaturas} assinaturas</strong>
                </article>
                <article>
                  <small>Break-even</small>
                  <strong>{simulador.breakEvenAssinaturas} assinaturas</strong>
                </article>
                <article>
                  <small>Receita base</small>
                  <strong>{labelPrecoPremium(simulador.receitaBase)}</strong>
                </article>
              </div>
              <div className="financeiro-simulador-cenarios">
                {simulador.cenarios.map((c) => (
                  <article key={c.id}>
                    <h4>{c.nome}</h4>
                    <p>{c.assinaturas} assinaturas estimadas</p>
                    <strong>{labelPrecoPremium(c.receita)}</strong>
                    <small className={c.delta >= 0 ? 'ok' : 'bad'}>
                      {c.delta >= 0 ? '+' : ''}{labelPrecoPremium(Math.abs(c.delta))} vs base
                    </small>
                  </article>
                ))}
              </div>
              {!!warningsConfig.length && (
                <ul className="financeiro-alertas">
                  {warningsConfig.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}
            </div>

            <div className="financeiro-form-section">
              <h3>Comunicação</h3>
              <div className="financeiro-grid">
                <label className="financeiro-grid-full">
                  Mensagem do e-mail promocional (opcional)
                  <textarea
                    rows={3}
                    value={promoMensagem}
                    onChange={(e) => setPromoMensagem(e.target.value)}
                    placeholder="Ex.: Promoção relâmpago para virar Nobre da Tempestade."
                  />
                </label>
              </div>
              <label className="financeiro-check">
                <input
                  type="checkbox"
                  checked={notifyUsers}
                  onChange={(e) => setNotifyUsers(e.target.checked)}
                />
                Notificar usuários por e-mail ao salvar esta promoção
              </label>
            </div>

            <div className="financeiro-acoes">
              <button
                type="button"
                className="financeiro-btn-primary"
                disabled={loadingPromo}
                onClick={salvarPromo}
              >
                {loadingPromo ? 'Salvando campanha...' : 'Salvar promoção'}
              </button>
              <button type="button" disabled={loadingPromo} onClick={carregarPromo}>
                Recarregar estado
              </button>
            </div>
            {msgPromo && <p className="financeiro-migracao-msg">{msgPromo}</p>}
          </div>
        )}

        {aba === 'limpeza' && (
          <div className="financeiro-migracao">
            <h2>Organizar cadastros antigos</h2>
            <p className="financeiro-migracao-texto">
              Esse botão faz uma faxina automática em informações antigas dos perfis.
            </p>
            <ul className="financeiro-migracao-list">
              <li>
                Não apaga conta, assinatura, histórico de pagamento ou dados importantes.
              </li>
              <li>
                Serve só para remover campos antigos que não são mais usados.
              </li>
              <li>
                Pode demorar alguns segundos se houver muitos usuários.
              </li>
            </ul>
            <p className="financeiro-migracao-texto">
              Dica: você pode rodar quando quiser para manter tudo organizado.
            </p>
            <button
              type="button"
              className="financeiro-btn-migrar"
              disabled={migrando}
              onClick={rodarMigracaoCampos}
            >
              {migrando ? 'Organizando cadastros...' : 'Fazer limpeza agora'}
            </button>
            {msgMigracao && <p className="financeiro-migracao-msg">{msgMigracao}</p>}
          </div>
        )}
      </section>
    </main>
  );
}
