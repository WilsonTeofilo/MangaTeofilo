// src/pages/Perfil/Perfil.jsx
import React, { useState, useEffect } from 'react';
import { updateProfile } from 'firebase/auth';
import { ref, update, get, onValue } from 'firebase/database';
import { useNavigate } from 'react-router-dom';

import { db } from '../../services/firebase';
import { LISTA_AVATARES, AVATAR_FALLBACK, isAdminUser, DISPLAY_NAME_MAX_LENGTH } from '../../constants'; // ✅ centralizado
import { assinaturaPremiumAtiva } from '../../utils/capituloLancamento';
import { formatarTempoRestanteAssinatura } from '../../utils/assinaturaTempoRestante';
import { formatarDataLongaBr } from '../../utils/datasBr';
import './Perfil.css';

// ✅ Recebe `user` via prop (consistente com App.jsx)
// Não usa mais auth.currentUser diretamente para evitar dessincronização
export default function Perfil({ user }) {
  const navigate = useNavigate();

  const [novoNome, setNovoNome]               = useState('');
  const [avatarSelecionado, setAvatarSelecionado] = useState('');
  const [notifyNewChapter, setNotifyNewChapter] = useState(false);
  const [notifyPromotions, setNotifyPromotions] = useState(false);
  const [listaAvatares, setListaAvatares] = useState(
    LISTA_AVATARES.map((url, index) => ({
      id: `legacy-${index}`,
      url,
      access: 'publico',
    }))
  );
  const [gender, setGender] = useState('nao_informado');
  const [birthYear, setBirthYear] = useState('');
  const [accountType, setAccountType] = useState('comum');
  const [loading, setLoading]                 = useState(false);
  const [mensagem, setMensagem]               = useState({ texto: '', tipo: '' });
  const [perfilDb, setPerfilDb]               = useState(null);

  const normalizarAcessoAvatar = (item) => {
    const raw = item?.access;
    if (raw == null || String(raw).trim() === '') return 'publico';
    const v = String(raw).toLowerCase().trim();
    if (v === 'premium' || v === 'vip' || v === 'exclusivo_vip') return 'premium';
    if (v === 'publico' || v === 'public' || v === 'comum' || v === 'free') return 'publico';
    return 'premium';
  };

  useEffect(() => {
    const carregarPerfil = async () => {
      const snap = await get(ref(db, `usuarios/${user.uid}`));
      const perfil = snap.val() || {};
      setPerfilDb(perfil);
      setNotifyNewChapter(Boolean(perfil.notifyNewChapter));
      setNotifyPromotions(Boolean(perfil.notifyPromotions));
      setGender(perfil.gender || 'nao_informado');
      const rawTipo = String(perfil.accountType ?? 'comum').toLowerCase();
      const tipoValido = ['comum', 'membro', 'premium', 'admin'].includes(rawTipo) ? rawTipo : 'comum';
      if (isAdminUser(user)) {
        setAccountType('admin');
      } else {
        setAccountType(tipoValido);
      }
      setBirthYear(
        typeof perfil.birthYear === 'number' && perfil.birthYear > 1900
          ? String(perfil.birthYear)
          : ''
      );
    };

    if (!user) {
      navigate('/login');
      return;
    }
    setNovoNome(user.displayName || '');
    setAvatarSelecionado(user.photoURL || LISTA_AVATARES[0] || AVATAR_FALLBACK);
    carregarPerfil().catch(() => setNotifyNewChapter(false));
  }, [user, navigate]);

  useEffect(() => {
    const unsub = onValue(ref(db, 'avatares'), (snap) => {
      if (!snap.exists()) return;
      const data = Object.entries(snap.val() || {})
        .map(([id, item]) => ({ id, ...item }))
        .filter((item) => item?.active !== false && typeof item?.url === 'string')
        .sort((a, b) => {
          const aOrder = typeof a?.order === 'number' ? a.order : Number.MAX_SAFE_INTEGER;
          const bOrder = typeof b?.order === 'number' ? b.order : Number.MAX_SAFE_INTEGER;
          if (aOrder !== bOrder) return aOrder - bOrder;
          return (b?.createdAt || 0) - (a?.createdAt || 0);
        })
        .map((item) => ({
          id: item.id,
          url: item.url,
          access: normalizarAcessoAvatar(item),
        }));
      if (data.length > 0) {
        setListaAvatares(data);
        const urls = data.map((item) => item.url);
        setAvatarSelecionado((prev) => (urls.includes(prev) ? prev : data[0].url));
      }
    });
    return () => unsub();
  }, []);

  const premiumAtivo = assinaturaPremiumAtiva(perfilDb);
  const podeUsarAvatarPremium = premiumAtivo || isAdminUser(user) || accountType === 'admin';
  const avataresLiberados = listaAvatares.filter((item) => {
    if (normalizarAcessoAvatar(item) === 'publico') return true;
    return podeUsarAvatarPremium;
  });

  useEffect(() => {
    if (!listaAvatares.length) return;
    const selecionado = listaAvatares.find((item) => item.url === avatarSelecionado);
    if (!selecionado) return;
    const bloqueado = normalizarAcessoAvatar(selecionado) === 'premium' && !podeUsarAvatarPremium;
    if (!bloqueado) return;
    const fallbackPublico = listaAvatares.find((item) => normalizarAcessoAvatar(item) === 'publico');
    if (fallbackPublico) {
      setAvatarSelecionado(fallbackPublico.url);
    }
  }, [avatarSelecionado, listaAvatares, podeUsarAvatarPremium]);

  const handleSalvar = async (e) => {
    e.preventDefault();

    if (!novoNome.trim()) {
      setMensagem({ texto: 'Dê um nome à sua alma!', tipo: 'erro' });
      return;
    }

    const anoAtual = new Date().getFullYear();
    const ano = Number(birthYear);
    if (birthYear && (!Number.isInteger(ano) || ano < 1900 || ano > anoAtual)) {
      setMensagem({ texto: 'Informe um ano de nascimento válido.', tipo: 'erro' });
      return;
    }

    setLoading(true);
    setMensagem({ texto: '', tipo: '' });

    try {
      const avatarEscolhido = listaAvatares.find((item) => item.url === avatarSelecionado);
      if (!avatarEscolhido) {
        setMensagem({ texto: 'Escolha um avatar valido da lista.', tipo: 'erro' });
        setLoading(false);
        return;
      }
      if (normalizarAcessoAvatar(avatarEscolhido) === 'premium' && !podeUsarAvatarPremium) {
        setMensagem({ texto: 'Avatar Premium exclusivo para conta Premium ativa.', tipo: 'erro' });
        setLoading(false);
        return;
      }

      // 1. Atualiza no Firebase Auth
      await updateProfile(user, {
        displayName: novoNome.trim(),
        photoURL: avatarSelecionado,
      });

      // 2. Atualiza no Realtime Database (Leitor.jsx escuta daqui)
      await update(ref(db, `usuarios/${user.uid}`), {
        userName:   novoNome.trim(),
        userAvatar: avatarSelecionado,
        uid:        user.uid,
        notifyNewChapter,
        notifyPromotions,
        gender,
        birthYear: birthYear ? ano : null,
        lastLogin: Date.now(),
      });

      await update(ref(db, `usuarios_publicos/${user.uid}`), {
        uid: user.uid,
        userName: novoNome.trim(),
        userAvatar: avatarSelecionado,
        accountType,
        updatedAt: Date.now(),
      });

      setMensagem({ texto: 'Perfil forjado com sucesso!', tipo: 'sucesso' });
      setTimeout(() => navigate('/'), 1500);

    } catch (error) {
      console.error('Erro na forja:', error);
      setMensagem({ texto: 'Erro ao atualizar: ' + error.message, tipo: 'erro' });
    } finally {
      setLoading(false);
    }
  };

  if (!user) return null; // guard enquanto o useEffect redireciona

  return (
    <main className="perfil-page">
      <div className="perfil-card">
        <h1 className="perfil-title">FORJA DE ALMA</h1>
        <p className="perfil-subtitle">Altere sua identidade em Shito</p>

        <form onSubmit={handleSalvar}>
          <div className="avatar-big-preview">
            <div className="circle-wrap">
              <img
                src={avatarSelecionado}
                alt="Preview Avatar"
                onError={(e) => { e.target.src = AVATAR_FALLBACK; }}
              />
            </div>
          </div>

          <div className="input-group">
            <label>NOME DE EXIBIÇÃO</label>
            <input
              type="text"
              className="perfil-input"
              value={novoNome}
              onChange={(e) => setNovoNome(e.target.value)}
              maxLength={DISPLAY_NAME_MAX_LENGTH}
              placeholder="Ex: Guerreiro de Brajiru"
            />
          </div>

          <div className="input-group">
            <label>ANO DE NASCIMENTO</label>
            <input
              type="number"
              className="perfil-input"
              value={birthYear}
              onChange={(e) => setBirthYear(e.target.value)}
              placeholder="Ex: 2001"
              min="1900"
              max={new Date().getFullYear()}
            />
          </div>

          <div className="input-group">
            <label>SEXO</label>
            <select
              className="perfil-input"
              value={gender}
              onChange={(e) => setGender(e.target.value)}
            >
              <option value="nao_informado">Prefiro não informar</option>
              <option value="masculino">Masculino</option>
              <option value="feminino">Feminino</option>
              <option value="outro">Outro</option>
            </select>
          </div>

          <div className="input-group">
            <label>TIPO DE CONTA</label>
            <div
              className={`account-type-badge ${
                accountType === 'admin' ? 'admin' : accountType !== 'comum' ? 'premium' : ''
              }`}
            >
              {accountType === 'admin'
                ? '🛡️ Conta Admin'
                : accountType === 'membro' || accountType === 'premium'
                  ? '👑 Conta Premium'
                  : 'Conta Comum'}
            </div>
          </div>

          {assinaturaPremiumAtiva(perfilDb) && typeof perfilDb?.memberUntil === 'number' && (() => {
            const tempo = formatarTempoRestanteAssinatura(perfilDb.memberUntil);
            return (
            <div className="input-group perfil-premium-linha">
              <label>ASSINATURA PREMIUM</label>
              <p className="perfil-premium-msg">
                Ativa até{' '}
                <strong>
                  {formatarDataLongaBr(perfilDb.memberUntil, { seVazio: '—' })}
                </strong>
                .
              </p>
              {tempo.ativo && (
                <p className="perfil-premium-tempo">{tempo.texto}</p>
              )}
              <p className="perfil-premium-msg perfil-premium-msg--foot">
                Renove em <strong>Apoie a Obra</strong> para somar mais 30 dias ao período atual.
              </p>
            </div>
            );
          })()}

          <div className="avatar-selection-section">
            <label>ESCOLHA SEU NOVO VISUAL</label>
            {!podeUsarAvatarPremium && (
              <p className="avatar-premium-hint">
                Avatares com selo <strong>Premium</strong> aparecem para você visualizar, mas só podem ser usados
                por assinantes ativos.
              </p>
            )}
            <div className="avatar-options-grid">
              {listaAvatares.map((item, i) => {
                const bloqueado = normalizarAcessoAvatar(item) === 'premium' && !podeUsarAvatarPremium;
                const ativo = avatarSelecionado === item.url;
                return (
                <div
                  key={item.id || i}
                  className={`avatar-option-card ${ativo ? 'active' : ''} ${bloqueado ? 'locked' : ''}`}
                  onClick={() => !bloqueado && setAvatarSelecionado(item.url)}
                  title={bloqueado ? 'Disponivel apenas para conta Premium ativa' : 'Selecionar avatar'}
                >
                  <img
                    src={item.url}
                    alt={`Opção ${i + 1}`}
                    onError={(e) => { e.target.src = AVATAR_FALLBACK; }}
                  />
                  {normalizarAcessoAvatar(item) === 'premium' && (
                    <span className="avatar-tier-tag">Premium</span>
                  )}
                  {bloqueado && <span className="avatar-lock">🔒</span>}
                </div>
              );
              })}
            </div>
            <p className="avatar-selection-summary">
              {podeUsarAvatarPremium
                ? `Voce pode usar todos os ${listaAvatares.length} avatares disponiveis.`
                : `Disponiveis para sua conta: ${avataresLiberados.length} de ${listaAvatares.length}.`}
            </p>
          </div>

          <div className="input-group notify-group">
            <label className="notify-label">
              <input
                type="checkbox"
                checked={notifyNewChapter}
                onChange={(e) => setNotifyNewChapter(e.target.checked)}
              />
              Receber notificacoes por e-mail quando novo capitulo for lancado
            </label>
            <label className="notify-label">
              <input
                type="checkbox"
                checked={notifyPromotions}
                onChange={(e) => setNotifyPromotions(e.target.checked)}
              />
              Receber notificacoes por e-mail quando houver promocao de assinatura
            </label>
          </div>

          {mensagem.texto && (
            <p className={`feedback-msg ${mensagem.tipo}`}>{mensagem.texto}</p>
          )}

          <div className="perfil-actions">
            <button type="submit" className="btn-save-perfil" disabled={loading}>
              {loading ? 'SINCRONIZANDO...' : 'SALVAR ALTERAÇÕES'}
            </button>
            <button type="button" className="btn-cancel-perfil" onClick={() => navigate('/')}>
              CANCELAR
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}

