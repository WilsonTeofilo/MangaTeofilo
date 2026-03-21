import React, { useState, useEffect } from 'react';
import { getAuth, updateProfile } from 'firebase/auth';
import { getDatabase, ref, update } from "firebase/database"; // IMPORTANTE: Adicionado para o Database
import { useNavigate } from 'react-router-dom';
import './Perfil.css';

export default function Perfil() {
  const auth = getAuth();
  const navigate = useNavigate();
  const db = getDatabase(); // Inicializa o Database
  const user = auth.currentUser;

  const [novoNome, setNovoNome] = useState('');
  const [avatarSelecionado, setAvatarSelecionado] = useState('');
  const [loading, setLoading] = useState(false);
  const [mensagem, setMensagem] = useState({ texto: '', tipo: '' });

  const listaAvatares = Array.from({ length: 17 }, (_, i) => `/assets/avatares/ava${i + 1}.webp`);

  useEffect(() => {
    if (!user) {
      navigate('/login');
    } else {
      setNovoNome(user.displayName || '');
      setAvatarSelecionado(user.photoURL || listaAvatares[0]);
    }
  }, [user, navigate]);

  const handleSalvar = async (e) => {
    e.preventDefault();
    if (!novoNome.trim()) return setMensagem({ texto: "Dê um nome à sua alma!", tipo: 'erro' });
    
    setLoading(true);
    setMensagem({ texto: '', tipo: '' });

    try {
      // 1. ATUALIZA NO AUTH (Sistema de Login)
      await updateProfile(user, {
        displayName: novoNome.trim(),
        photoURL: avatarSelecionado
      });

      // 2. ATUALIZA NO DATABASE (Para os comentários e chat)
      // É aqui que a mágica acontece para o nome mudar no site todo
      const userRef = ref(db, `usuarios/${user.uid}`);
      await update(userRef, {
        userName: novoNome.trim(),
        userAvatar: avatarSelecionado,
        uid: user.uid
      });

      setMensagem({ texto: "Perfil forjado com sucesso!", tipo: 'sucesso' });
      
      // Delay para o usuário ler a mensagem de sucesso
      setTimeout(() => navigate('/'), 1500);
    } catch (error) {
      console.error("Erro na forja:", error);
      setMensagem({ texto: "Erro ao atualizar: " + error.message, tipo: 'erro' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="perfil-page">
      <div className="perfil-card">
        <h1 className="perfil-title">FORJA DE ALMA</h1>
        <p className="perfil-subtitle">Altere sua identidade em Shito</p>

        <form onSubmit={handleSalvar}>
          <div className="avatar-big-preview">
            <div className="circle-wrap">
              <img src={avatarSelecionado} alt="Preview Avatar" />
            </div>
          </div>

          <div className="input-group">
            <label>NOME DE EXIBIÇÃO</label>
            <input 
              type="text" 
              className="perfil-input" 
              value={novoNome}
              onChange={(e) => setNovoNome(e.target.value)}
              maxLength={25}
              placeholder="Ex: Guerreiro de Brajiru"
            />
          </div>

          <div className="avatar-selection-section">
            <label>ESCOLHA SEU NOVO VISUAL</label>
            <div className="avatar-options-grid">
              {listaAvatares.map((url, i) => (
                <div 
                  key={i} 
                  className={`avatar-option-card ${avatarSelecionado === url ? 'active' : ''}`}
                  onClick={() => setAvatarSelecionado(url)}
                >
                  <img src={url} alt={`Opção ${i + 1}`} />
                </div>
              ))}
            </div>
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