import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';

import { functions } from '../../services/firebase';
import { mensagemErroCallable } from '../../utils/firebaseCallableError';
import { labelPrecoPremium } from '../../config/premiumAssinatura';
import './FinanceiroAdmin.css';

const migrateDeprecatedFields = httpsCallable(functions, 'adminMigrateDeprecatedUserFields');
const adminObterPromocaoPremium = httpsCallable(functions, 'adminObterPromocaoPremium');
const adminSalvarPromocaoPremium = httpsCallable(functions, 'adminSalvarPromocaoPremium');

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

  const [promoNome, setPromoNome] = useState('Promoção Membro Shito');
  const [promoMensagem, setPromoMensagem] = useState('');
  const [promoPreco, setPromoPreco] = useState('19.90');
  const [promoInicio, setPromoInicio] = useState(() => toDatetimeLocal(Date.now()));
  const [durDias, setDurDias] = useState('0');
  const [durHoras, setDurHoras] = useState('24');
  const [durMin, setDurMin] = useState('0');
  const [durSeg, setDurSeg] = useState('0');
  const [notifyUsers, setNotifyUsers] = useState(true);

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

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

  const encerrarPromo = async () => {
    setLoadingPromo(true);
    setMsgPromo('');
    try {
      await adminSalvarPromocaoPremium({ enabled: false });
      setPromoAtual(null);
      setMsgPromo('Promoção encerrada. O checkout voltou ao preço base.');
    } catch (err) {
      setMsgPromo(mensagemErroCallable(err));
    } finally {
      setLoadingPromo(false);
    }
  };

  const promoAtivaAgora = Boolean(
    promoAtual && nowMs >= Number(promoAtual.startsAt || 0) && nowMs <= Number(promoAtual.endsAt || 0)
  );
  const restante = Math.max(0, Number(promoAtual?.endsAt || 0) - nowMs);
  const totalSec = Math.floor(restante / 1000);
  const dd = String(Math.floor(totalSec / 86400)).padStart(2, '0');
  const hh = String(Math.floor((totalSec % 86400) / 3600)).padStart(2, '0');
  const mm = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
  const ss = String(totalSec % 60).padStart(2, '0');
  const timerFormatado = `${dd}:${hh}:${mm}:${ss}`;

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
              <div className={`promo-banner ${promoAtivaAgora ? 'promo-banner--active' : ''}`}>
                <div className="promo-banner-head">
                  <h3>{promoAtivaAgora ? '🔥 Promoção ativa' : 'Campanha programada'}</h3>
                  <span className={`promo-status-chip ${promoAtivaAgora ? 'active' : 'scheduled'}`}>
                    {promoAtivaAgora ? 'ATIVA' : 'AGENDADA'}
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
                  <div className="promo-countdown-block">
                    <small>Tempo restante</small>
                    <strong>{timerFormatado}</strong>
                  </div>
                ) : (
                  <p className="promo-timer">Promoção cadastrada, fora da janela ativa no momento.</p>
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
              <button
                type="button"
                className="financeiro-btn-encerrar"
                disabled={loadingPromo || !promoAtual}
                onClick={encerrarPromo}
              >
                Encerrar agora
              </button>
            </div>
            {msgPromo && <p className="financeiro-migracao-msg">{msgPromo}</p>}
          </div>
        )}

        {aba === 'config' && (
          <div className="financeiro-promocao">
            <h2>Configuração de promoção Premium</h2>

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
